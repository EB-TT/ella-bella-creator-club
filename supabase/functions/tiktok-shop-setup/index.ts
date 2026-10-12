// tiktok-shop-setup: saves the TikTok Shop app credentials, once.
//
// POST { token, app_key, app_secret, service_id, region } from the public
// /tiktok-setup page. The person entering them has no app login, so this is
// deployed with JWT verification off and guarded by the TIKTOK_SETUP_TOKEN
// secret instead. It's one-time: once a row exists it refuses to overwrite it.
// To reset, delete the row in SQL.
//
// The app secret is never logged or echoed back.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

type Region = "us" | "global";

const ALLOWED_ORIGINS = new Set(["https://ella-bella-cc.vercel.app", "http://localhost:5173"]);
const MAX_LENGTH = 128;

// Authorisation link base per Partner Center region, or null to have the page
// fall back to "copy the link from Partner Center". Both are null because the
// format couldn't be confirmed from TikTok's own docs. Third-party sources give
// `https://services.tiktokshop.com/open/authorize?service_id=…` for global,
// and disagree on US (`services.us.tiktokshop.com` vs `services.tiktokshops.us`).
// Partner Center's "Copy authorization link" is always correct.
const AUTHORIZE_BASE: Record<Region, string | null> = {
  us: null,
  global: null,
};

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  return {
    ...(ALLOWED_ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function admin(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not available");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Constant-time string comparison: hash both sides so lengths don't leak either. */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const xa = new Uint8Array(x);
  const ya = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < xa.length; i++) diff |= xa[i] ^ ya[i];
  return diff === 0;
}

function field(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  return typeof v === "string" ? v.trim() : "";
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    body = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return json(400, { error: "Body must be JSON" });
  }

  const expected = Deno.env.get("TIKTOK_SETUP_TOKEN") ?? "";
  const token = field(body, "token");
  if (!expected) console.error("setup: TIKTOK_SETUP_TOKEN secret isn't set");
  if (!expected || !token || !(await safeEqual(token, expected))) {
    return json(403, { error: "This setup link isn't valid" });
  }

  const app_key = field(body, "app_key");
  const app_secret = field(body, "app_secret");
  const service_id = field(body, "service_id");
  const region = field(body, "region");

  const labels: [string, string][] = [
    ["App Key", app_key],
    ["App Secret", app_secret],
    ["Service ID", service_id],
  ];
  for (const [label, value] of labels) {
    if (!value) return json(400, { error: `${label} is required` });
    if (/\s/.test(value)) return json(400, { error: `${label} shouldn't contain spaces – check it was copied correctly` });
    if (value.length > MAX_LENGTH) return json(400, { error: `${label} looks too long – check it was copied correctly` });
  }
  if (region !== "us" && region !== "global") {
    return json(400, { error: "Choose which Partner Center you used: US or Global" });
  }

  let db: SupabaseClient;
  try {
    db = admin();
  } catch (err) {
    console.error(`setup: ${(err as Error).message}`);
    return json(500, { error: "Setup is misconfigured – ask DB" });
  }

  // The primary key is the constant `true`, so a second insert conflicts.
  const { error } = await db.from("tiktok_app_credentials").insert({ app_key, app_secret, service_id, region });
  if (error?.code === "23505") {
    return json(409, { error: "Already set up – ask DB if this needs changing" });
  }
  if (error) {
    console.error(`setup: saving credentials failed: ${error.message}`);
    return json(500, { error: "Couldn't save the app details – try again, or ask DB" });
  }

  console.log(`setup: credentials saved (region ${region})`);

  const base = AUTHORIZE_BASE[region];
  const authorize_url = base ? `${base}?service_id=${encodeURIComponent(service_id)}` : null;
  return json(200, { ok: true, authorize_url });
});
