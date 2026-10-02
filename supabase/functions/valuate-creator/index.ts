// valuate-creator: values a creator from their last 90 days of content.
//
// POST { id } for a `pending` row in public.creator_valuations. The row is
// claimed (pending → running), the function responds 202, and the run carries
// on in the background, writing results/status back with the service role.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { SocialFetch } from "./socialfetch.ts";
import { CREDIT_CAP_PER_RUN, valuate, ValuationError } from "./valuate.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const TABLE = "creator_valuations";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ValuationRow {
  id: string;
  platform: "tiktok" | "instagram";
  handle: string;
}

// Runs still going in this worker, so a shutdown can mark them failed.
const inFlight = new Map<string, SocialFetch>();
let adminClient: SupabaseClient | null = null;

function admin(): SupabaseClient {
  if (adminClient) return adminClient;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not available");
  adminClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return adminClient;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  let db: SupabaseClient;
  try {
    db = admin();
  } catch (err) {
    console.error(err);
    return json(500, { error: "Function is misconfigured" });
  }

  // The gateway checks the JWT signature, but the public anon key is a valid
  // JWT too, so also require a real signed-in user.
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  const { data: auth } = token ? await db.auth.getUser(token) : { data: { user: null } };
  if (!auth.user) return json(401, { error: "Sign in required" });

  let id: unknown;
  try {
    id = (await req.json())?.id;
  } catch {
    return json(400, { error: "Body must be JSON: { id }" });
  }
  if (typeof id !== "string" || !UUID_RE.test(id)) return json(400, { error: "id must be a valuation uuid" });

  // Claim atomically: only one invocation can move a row out of pending.
  const { data: row, error } = await db
    .from(TABLE)
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")
    .select("id, platform, handle")
    .maybeSingle<ValuationRow>();
  if (error) {
    console.error(`claim ${id} failed:`, error.message);
    return json(500, { error: "Couldn't claim the valuation" });
  }
  if (!row) return json(409, { error: "Valuation not found, already running or finished" });

  EdgeRuntime.waitUntil(run(db, row));
  return json(202, { id: row.id, status: "running" });
});

async function run(db: SupabaseClient, row: ValuationRow): Promise<void> {
  const log = (msg: string) => console.log(`[${row.id} ${row.platform}/@${row.handle}] ${msg}`);
  const apiKey = Deno.env.get("SOCIALFETCH_API_KEY") ?? "";
  const sf = new SocialFetch({ apiKey, creditCap: CREDIT_CAP_PER_RUN, log });
  inFlight.set(row.id, sf);
  try {
    if (!apiKey) throw new ValuationError("SOCIALFETCH_API_KEY secret isn't set");
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") || undefined;
    if (!anthropicKey) log("ANTHROPIC_API_KEY not set; comments will be left unclassified");

    const results = await valuate(row.platform, row.handle, { sf, anthropicKey, log });
    await finish(db, row.id, { status: "complete", results, credits_used: sf.creditsUsed, error: null });
    log(`complete, ${sf.creditsUsed} credit(s)`);
  } catch (err) {
    log(`failed: ${(err as Error)?.stack ?? err}`);
    try {
      await finish(db, row.id, { status: "failed", error: errorMessage(err), credits_used: sf.creditsUsed });
    } catch (writeErr) {
      log(`couldn't record failure: ${(writeErr as Error).message}`);
    }
  } finally {
    inFlight.delete(row.id);
  }
}

async function finish(db: SupabaseClient, id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await db
    .from(TABLE)
    .update({ ...patch, completed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "running");
  if (error) throw new Error(error.message);
}

function errorMessage(err: unknown): string {
  if (err instanceof ValuationError) return err.message;
  const msg = err instanceof Error ? err.message : String(err);
  return `Unexpected error: ${msg}`.slice(0, 300);
}

// Best effort: if the worker is shut down mid-run (e.g. wall-clock limit),
// don't leave rows stuck in `running`.
addEventListener("beforeunload", (ev) => {
  const reason = (ev as Event & { detail?: { reason?: string } }).detail?.reason ?? "shutdown";
  for (const [id, sf] of inFlight) {
    console.error(`[${id}] worker stopping (${reason}) mid-run`);
    finish(admin(), id, {
      status: "failed",
      error: `Stopped before finishing (${reason}) – try again`,
      credits_used: sf.creditsUsed,
    }).catch(() => {});
  }
});
