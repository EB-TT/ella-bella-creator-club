// tiktok-shop-sync: pulls TikTok Shop data into the tiktok_* tables.
//
// POST { stream?: "affiliate" | "samples" | "sample_orders" | "target_collabs", force?: boolean }
// Responds 202 straight away; the work carries on in the background. With no
// stream, every stream that is due runs, in order: token check -> affiliate ->
// samples -> sample_orders -> target_collabs.
//
// Deployed with JWT verification OFF and authenticated here instead:
//   - scheduled calls send header x-sync-secret = the TIKTOK_SYNC_SECRET secret
//   - "Sync now" from the app sends a signed-in user's JWT
// Anything else gets 401.
//
// pg_cron calls this every 5 minutes; this function decides what is due. It
// writes only to tiktok_* tables (and tokens in tiktok_shop_connections). After
// a run that wrote anything it calls the tiktok_derive() database function,
// which links, creates and recomputes creators from the stored data.

import {
  admin,
  claimLease,
  type Db,
  loadState,
  patchState,
  type Row,
  redact,
  releaseLease,
  type SyncState,
} from "./db.ts";
import {
  type Connection,
  type Credentials,
  loadConnections,
  loadCredentials,
  needsRefresh,
  RateLimitedError,
  refreshConnection,
  TikTokApi,
} from "./tiktok.ts";
import { type Ctx, type Pass, STREAMS, type StreamDef } from "./streams.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// A hair under the nominal period so a run isn't pushed an extra 5 minutes by scheduling jitter.
const HOURLY_MS = 55 * 60_000;
const DAILY_MS = 23 * 3600_000;
const DEFAULT_BUDGET_MS = 110_000;
// Derive picks up anything synced since the run began, with margin for clock skew between this function and the database.
const DERIVE_LOOKBACK_MS = 5 * 60_000;
// Counts that mean a stream stored or changed rows (the rest are bookkeeping).
const WRITE_COUNTS = ["lines", "applications", "orders_updated", "collab_creators_stored", "stale_checked"];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/** Constant-time comparison (of the SHA-256 digests, so length doesn't leak). */
async function secretMatches(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function authorised(req: Request, db: Db): Promise<boolean> {
  const expected = Deno.env.get("TIKTOK_SYNC_SECRET");
  const given = req.headers.get("x-sync-secret");
  if (given && expected && await secretMatches(given, expected)) return true;

  // The anon key is a valid JWT too, so require a real signed-in user.
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const { data } = await db.auth.getUser(token);
  return !!data.user;
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  let db: Db;
  try {
    db = admin();
  } catch (err) {
    console.error(`sync: ${(err as Error).message}`);
    return json(500, { error: "Function is misconfigured" });
  }
  if (!await authorised(req, db)) return json(401, { error: "Not authorised" });

  let body: { stream?: unknown; force?: unknown } = {};
  const raw = await req.text();
  if (raw.trim()) {
    try {
      body = JSON.parse(raw);
    } catch {
      return json(400, { error: "Body must be JSON: { stream?, force? }" });
    }
  }
  const names = STREAMS.map((s) => s.name);
  if (body.stream !== undefined && (typeof body.stream !== "string" || !names.includes(body.stream))) {
    return json(400, { error: `stream must be one of: ${names.join(", ")}` });
  }
  const stream = body.stream as string | undefined;
  const force = body.force === true;

  EdgeRuntime.waitUntil(
    runSync(db, stream, force).catch((err) => console.error(`sync: run failed: ${redact((err as Error).message)}`)),
  );
  return json(202, { accepted: true });
});

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function runSync(db: Db, only: string | undefined, force: boolean): Promise<void> {
  const runStart = Date.now();
  const budget = Number(Deno.env.get("TIKTOK_SYNC_BUDGET_MS")) || DEFAULT_BUDGET_MS;
  const deadline = runStart + budget;

  const session = await tokenStep(db);
  if (!session) return;
  const { creds, conn } = session;
  const api = new TikTokApi(creds, conn);

  const todo: { def: StreamDef; passes: Pass[] }[] = [];
  for (const def of STREAMS) {
    if (only && def.name !== only) continue;
    const passes = duePasses(def, await loadState(db, def.name), Date.now(), force);
    if (passes.length) todo.push({ def, passes });
  }

  let wrote = false;
  for (let i = 0; i < todo.length; i++) {
    // Each stream gets an equal share of what's left, so a long backfill can't starve the others.
    const share = (deadline - Date.now()) / (todo.length - i);
    if (share <= 1000) break;
    const out = await runStream(db, api, todo[i].def, todo[i].passes, Date.now() + share);
    if (out.wrote) wrote = true;
    // The limit is per app, so the next stream would only hit it too.
    if (out.rateLimited) break;
  }

  if (wrote) await deriveStep(db, new Date(runStart - DERIVE_LOOKBACK_MS));
}

// ---------------------------------------------------------------------------
// Derive
// ---------------------------------------------------------------------------

/** Link, auto-create and recompute creators from what this run stored. A failure is recorded, never thrown. */
async function deriveStep(db: Db, since: Date): Promise<void> {
  const startedAt = new Date();
  try {
    const { data, error } = await db.rpc("tiktok_derive", { p_since: since.toISOString() });
    if (error) throw new Error(error.message);
    const finishedAt = new Date();
    await patchState(db, "derive", {
      last_run_started_at: startedAt.toISOString(),
      last_run_finished_at: finishedAt.toISOString(),
      last_status: "ok",
      last_error: null,
      last_success_at: finishedAt.toISOString(),
      last_counts: { ...(data as Row), since: since.toISOString(), elapsed_ms: finishedAt.getTime() - startedAt.getTime() },
    });
  } catch (err) {
    const message = redact((err as Error).message);
    console.error(`sync: derive failed: ${message}`);
    try {
      await patchState(db, "derive", {
        last_run_started_at: startedAt.toISOString(),
        last_run_finished_at: new Date().toISOString(),
        last_status: "error",
        last_error: message,
      });
    } catch (err2) {
      console.error(`sync: couldn't record derive state: ${redact((err2 as Error).message)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Token check
// ---------------------------------------------------------------------------

/** Refreshes any token expiring within 24h. Returns null (and records why) if the run must stop. */
async function tokenStep(db: Db): Promise<{ creds: Credentials; conn: Connection } | null> {
  const startedAt = new Date().toISOString();
  let creds: Credentials;
  let conns: Connection[];
  try {
    creds = await loadCredentials(db);
    conns = await loadConnections(db);
  } catch (err) {
    await recordToken(db, startedAt, "error", redact((err as Error).message), {});
    return null;
  }

  const due = conns.filter(needsRefresh);
  const details: Row = {
    checked_at: startedAt,
    shops: conns.length,
    access_expires_at: conns[0].access_token_expires_at,
    refresh_expires_at: conns[0].refresh_token_expires_at,
  };
  if (conns.length > 1) details.note = "More than one shop is connected; the sync uses the first only";

  if (!due.length) {
    await recordToken(db, startedAt, "ok", null, details);
    return { creds, conn: conns[0] };
  }

  // Refresh tokens may rotate, so two overlapping runs must not both refresh.
  if (!await claimLease(db, "token", 2 * 60_000)) {
    console.log("sync: another run is refreshing the token; skipping this run");
    return null;
  }
  try {
    for (const c of due) {
      const before = { access: c.access_token_expires_at, refresh: c.refresh_token_expires_at };
      const out = await refreshConnection(db, creds, c);
      if (c.shop_id === conns[0].shop_id) {
        Object.assign(details, out.details, {
          refreshed: true,
          access_expires_at_before: before.access,
          refresh_expires_at_before: before.refresh,
          access_expires_at: c.access_token_expires_at,
          refresh_expires_at: c.refresh_token_expires_at,
        });
      }
    }
    await recordToken(db, startedAt, "refreshed", null, details);
    return { creds, conn: conns[0] };
  } catch (err) {
    await recordToken(db, startedAt, "error", redact((err as Error).message), details);
    return null;
  } finally {
    await releaseLease(db, "token");
  }
}

async function recordToken(db: Db, startedAt: string, status: string, error: string | null, details: Row): Promise<void> {
  try {
    const prev = (await loadState(db, "token")).last_counts ?? {};
    // Keep the last refresh's raw expiry fields until the next refresh replaces them.
    const counts = { ...prev, ...details };
    await patchState(db, "token", {
      last_run_started_at: startedAt,
      last_run_finished_at: new Date().toISOString(),
      last_status: status,
      last_error: error,
      last_counts: counts,
      ...(error ? {} : { last_success_at: new Date().toISOString() }),
    });
  } catch (err) {
    console.error(`sync: couldn't record token state: ${redact((err as Error).message)}`);
  }
  if (error) console.error(`sync: token step failed: ${error}`);
}

// ---------------------------------------------------------------------------
// Due logic
// ---------------------------------------------------------------------------

const age = (iso: string | null, now: number) => (iso ? now - new Date(iso).getTime() : Infinity);

function duePasses(def: StreamDef, state: SyncState, now: number, force: boolean): Pass[] {
  if (!state.backfill_done) return ["backfill"];

  const hourlyDue = def.passes.includes("hourly") && (force || age(state.hourly_last_at, now) >= HOURLY_MS);
  const dailyDue = def.passes.includes("daily") && (force || age(state.daily_last_at, now) >= DAILY_MS);
  const resume = state.backfill_cursor?.pass as Pass | undefined;
  const out: Pass[] = [];

  if (def.dailyCoversHourly && dailyDue) return ["daily"];
  // An unfinished pass resumes first, whether or not its schedule has come round again.
  if (resume === "hourly" || resume === "daily") {
    if (def.passes.includes(resume)) out.push(resume);
  }
  if (hourlyDue && !out.includes("hourly")) out.push("hourly");
  if (dailyDue && !out.includes("daily")) out.push("daily");
  // Hourly before daily: the daily stale-pending check relies on a fresh hourly pass.
  return out.sort((a, b) => (a === b ? 0 : a === "hourly" ? -1 : 1));
}

// ---------------------------------------------------------------------------
// One stream
// ---------------------------------------------------------------------------

/** `rateLimited`: the stream was deferred by a rate limit. `wrote`: it stored or changed rows. */
async function runStream(
  db: Db,
  api: TikTokApi,
  def: StreamDef,
  passes: Pass[],
  deadline: number,
): Promise<{ rateLimited: boolean; wrote: boolean }> {
  const name = def.name;
  if (!await claimLease(db, name)) {
    console.log(`sync: ${name} is already running; skipped`);
    return { rateLimited: false, wrote: false };
  }

  const startedAt = new Date();
  const ctx: Ctx = { db, api, state: await loadState(db, name), deadline, counts: {}, warnings: [] };
  const patch: Row = { last_run_started_at: startedAt.toISOString(), last_status: "running" };
  let rateLimited = false;
  let completedAny = false;
  let allComplete = true;
  const passLog: string[] = [];

  try {
    await patchState(db, name, patch);
    for (const pass of passes) {
      const cursor = ctx.state.backfill_cursor;
      const resume = cursor && cursor.pass === pass ? cursor : null;
      const result = await def.run(ctx, pass, resume);
      passLog.push(`${pass}:${result.complete ? "complete" : "partial"}`);
      if (!result.complete) {
        allComplete = false;
        break;
      }
      completedAny = true;

      // Persist each finished pass straight away.
      const passStart = result.started_at;
      const done: Row = { backfill_cursor: null };
      if (pass === "backfill") {
        done.backfill_done = true;
        done.hourly_last_at = passStart;
        done.daily_last_at = passStart;
      } else {
        done[`${pass}_last_at`] = passStart;
        if (pass === "daily" && def.dailyCoversHourly) done.hourly_last_at = passStart;
      }
      await patchState(db, name, done);
      ctx.state = await loadState(db, name);
    }
    Object.assign(patch, {
      last_status: allComplete ? "ok" : "partial",
      last_error: null,
      more_to_do: !allComplete,
      ...(allComplete ? { last_success_at: new Date().toISOString() } : {}),
    });
  } catch (err) {
    allComplete = false;
    const message = redact((err as Error).message);
    if (err instanceof RateLimitedError) {
      rateLimited = true;
      Object.assign(patch, { last_status: "rate_limited", last_error: message, more_to_do: true });
      await db.from("tiktok_sync_state").update({ rate_limited_count: ctx.state.rate_limited_count + 1 }).eq("stream", name);
    } else {
      Object.assign(patch, { last_status: "error", last_error: message, more_to_do: true });
    }
    console.error(`sync: ${name}: ${message}`);
  } finally {
    ctx.counts.passes = passLog;
    ctx.counts.api_calls = ctx.api.stats.calls;
    ctx.counts.retries_429 = ctx.api.stats.retries_429;
    ctx.counts.elapsed_ms = Date.now() - startedAt.getTime();
    const final: Row = {
      ...patch,
      last_run_finished_at: new Date().toISOString(),
      last_counts: ctx.counts,
      lease_until: null,
    };
    // Keep a warning until a pass finishes cleanly without it.
    if (ctx.warnings.length) final.warnings = ctx.warnings;
    else if (completedAny) final.warnings = null;
    try {
      await patchState(db, name, final);
    } catch (err) {
      console.error(`sync: ${name}: couldn't save run state: ${redact((err as Error).message)}`);
      await releaseLease(db, name);
    }
  }
  return { rateLimited, wrote: WRITE_COUNTS.some((k) => Number(ctx.counts[k]) > 0) };
}
