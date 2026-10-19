// Database helpers for the TikTok sync: the service-role client, sync-state
// rows with their lease, and the shared upserts (creators, products).
//
// Nothing here logs row contents.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export type Db = SupabaseClient;
// deno-lint-ignore no-explicit-any
export type Row = Record<string, any>;

export const LEASE_MS = 5 * 60_000;

const RETRY_BASE_MS = 5 * 60_000;
const RETRY_MAX_MS = 6 * 3600_000;

/** State patch for a stream whose run just ended in error: 5, 10, 20, 40, 80, 160 min, then 6 h. */
export function failurePatch(previousFailures: number, now = Date.now()): Row {
  const n = Math.max(0, previousFailures) + 1;
  const wait = Math.min(RETRY_BASE_MS * 2 ** Math.min(n - 1, 20), RETRY_MAX_MS);
  return { consecutive_failures: n, next_retry_at: new Date(now + wait).toISOString() };
}

/** State patch for a run that didn't end in error. */
export const SUCCESS_PATCH: Row = { consecutive_failures: 0, next_retry_at: null };

/** True while a stream is waiting out its back-off. */
export function backedOff(state: SyncState, now = Date.now()): boolean {
  return !!state.next_retry_at && new Date(state.next_retry_at).getTime() > now;
}

export function admin(): Db {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not available");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Throws a readable error if a Supabase call failed; returns its data. */
export function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Lowercase, trimmed, leading "@"s removed. Same rule as the discovery script. */
export function normUsername(v: unknown): string {
  return typeof v === "string" ? v.trim().replace(/^@+/, "").trim().toLowerCase() : "";
}

/** TikTok unix seconds (number or numeric string) -> ISO string, or null when absent/zero. */
export function isoFromUnix(v: unknown): string | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
}

/** "12.50" -> 12.5; empty/absent/non-numeric -> null. */
export function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function intOrNull(v: unknown): number | null {
  const n = numOrNull(v);
  return n === null ? null : Math.trunc(n);
}

/** Non-empty string or null. */
export function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** Removes URLs (they carry the signature, app key and shop cipher) from text before it is stored or logged. */
export function redact(text: string): string {
  return text.replace(/https?:\/\/\S+/gi, "[url]");
}

// ---------------------------------------------------------------------------
// Sync state
// ---------------------------------------------------------------------------

export interface SyncState {
  stream: string;
  backfill_cursor: Row | null;
  backfill_done: boolean;
  last_run_started_at: string | null;
  last_run_finished_at: string | null;
  last_status: string | null;
  last_error: string | null;
  last_counts: Row | null;
  rate_limited_count: number;
  lease_until: string | null;
  hourly_last_at: string | null;
  daily_last_at: string | null;
  last_success_at: string | null;
  more_to_do: boolean;
  warnings: string[] | null;
  consecutive_failures: number;
  next_retry_at: string | null;
}

export async function loadState(db: Db, stream: string): Promise<SyncState> {
  const data = must(
    await db.from("tiktok_sync_state").select("*").eq("stream", stream).maybeSingle<SyncState>(),
    `read sync state ${stream}`,
  );
  if (!data) throw new Error(`No tiktok_sync_state row for ${stream} (run migration 008)`);
  return data;
}

export async function patchState(db: Db, stream: string, patch: Row): Promise<void> {
  must(await db.from("tiktok_sync_state").update(patch).eq("stream", stream), `update sync state ${stream}`);
}

/** Atomically takes the stream's lease if it is free or expired. False if another run holds it. */
export async function claimLease(db: Db, stream: string, ms = LEASE_MS): Promise<boolean> {
  const now = new Date();
  const rows = must(
    await db
      .from("tiktok_sync_state")
      .update({ lease_until: new Date(now.getTime() + ms).toISOString() })
      .eq("stream", stream)
      .or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`)
      .select("stream"),
    `claim lease ${stream}`,
  );
  return (rows?.length ?? 0) > 0;
}

export async function releaseLease(db: Db, stream: string): Promise<void> {
  await db.from("tiktok_sync_state").update({ lease_until: null }).eq("stream", stream);
}

// ---------------------------------------------------------------------------
// Generic upsert
// ---------------------------------------------------------------------------

/**
 * Upserts in chunks, keeping the last row for any duplicate key within the
 * call (Postgres refuses to touch one row twice in a statement). Every row
 * must carry the same columns: columns left out are not updated, but a key
 * missing from only some rows would be sent as null.
 */
export async function upsertRows(
  db: Db,
  table: string,
  rows: Row[],
  onConflict: string,
  size = 200,
): Promise<number> {
  if (!rows.length) return 0;
  const keys = onConflict.split(",").map((k) => k.trim());
  const byKey = new Map<string, Row>();
  for (const r of rows) byKey.set(keys.map((k) => String(r[k])).join("\u0000"), r);
  const unique = [...byKey.values()];
  for (const part of chunk(unique, size)) {
    must(await db.from(table).upsert(part, { onConflict }), `upsert ${table}`);
  }
  return unique.length;
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

// Products already written this run, so a page of 100 lines for 3 products
// costs one call, not 100. short_name is never part of the payload.
const productsSeen = new Map<string, string>();

export async function upsertProducts(db: Db, products: { product_id: string; title: string | null }[]): Promise<void> {
  const rows: Row[] = [];
  for (const p of products) {
    if (!p.product_id || !p.title) continue;
    if (productsSeen.get(p.product_id) === p.title) continue;
    productsSeen.set(p.product_id, p.title);
    rows.push({ product_id: p.product_id, title: p.title });
  }
  await upsertRows(db, "tiktok_products", rows, "product_id");
}

// ---------------------------------------------------------------------------
// tiktok_creators
// ---------------------------------------------------------------------------

export interface CreatorRec {
  username: string;
  open_id?: string | null;
  nickname?: string | null;
  // Present for sample applications only.
  stats?: {
    follower_count: number | null;
    gmv_30d: number | null;
    gmv_30d_currency: string | null;
    fulfillment_percentage: number | null;
    ec_video_view: number | null;
  };
}

export interface CreatorResult {
  written: number;
  handle_changes: number;
  conflicts: number;
}

/**
 * Upserts creators. Matching is by username_normalised. When an open ID is
 * already stored under a different username, that row is renamed (a handle
 * change) rather than duplicated. Rare cases go row by row; the common case
 * is one bulk upsert per shape of row.
 */
export async function upsertCreators(db: Db, recs: CreatorRec[]): Promise<CreatorResult> {
  const result: CreatorResult = { written: 0, handle_changes: 0, conflicts: 0 };
  const now = new Date().toISOString();

  // One record per username; prefer the one that knows the open ID / stats.
  const byNorm = new Map<string, CreatorRec>();
  for (const r of recs) {
    const norm = normUsername(r.username);
    if (!norm) continue;
    const prev = byNorm.get(norm);
    byNorm.set(norm, prev ? { ...prev, ...r, open_id: r.open_id ?? prev.open_id, stats: r.stats ?? prev.stats } : r);
  }
  const list = [...byNorm.entries()];
  if (!list.length) return result;

  // Existing rows by open ID, to spot handle changes.
  const openIds = [...new Set(list.map(([, r]) => r.open_id).filter((v): v is string => !!v))];
  const existingByOpen = new Map<string, Row>();
  for (const part of chunk(openIds, 50)) {
    const rows = must(
      await db.from("tiktok_creators").select("id, username_normalised, open_id").in("open_id", part),
      "read creators by open id",
    ) as Row[];
    for (const r of rows) existingByOpen.set(r.open_id, r);
  }
  const norms = list.map(([n]) => n);
  const existingByNorm = new Map<string, Row>();
  for (const part of chunk(norms, 50)) {
    const rows = must(
      await db.from("tiktok_creators").select("id, username_normalised, open_id").in("username_normalised", part),
      "read creators by username",
    ) as Row[];
    for (const r of rows) existingByNorm.set(r.username_normalised, r);
  }

  const bulkOpen: Row[] = [];
  const bulkNoOpen: Row[] = [];

  for (const [norm, r] of list) {
    const payload: Row = { username: r.username.trim().replace(/^@+/, ""), username_normalised: norm, last_seen_at: now };
    if (r.nickname) payload.nickname = r.nickname;
    if (r.stats) Object.assign(payload, r.stats, { stats_at: now });

    const byOpen = r.open_id ? existingByOpen.get(r.open_id) : undefined;
    const byName = existingByNorm.get(norm);

    if (r.open_id && byOpen && byOpen.username_normalised !== norm) {
      // Same open ID under another username: a handle change.
      if (byName && byName.open_id && byName.open_id !== r.open_id) {
        result.conflicts++; // The new handle belongs to a different creator; leave both alone.
        continue;
      }
      // An affiliate-only stub already holds the new handle; drop it so the rename fits.
      if (byName) must(await db.from("tiktok_creators").delete().eq("id", byName.id), "remove duplicate creator stub");
      must(await db.from("tiktok_creators").update(payload).eq("id", byOpen.id), "rename creator");
      result.handle_changes++;
      result.written++;
      continue;
    }
    if (r.open_id && byName && byName.open_id && byName.open_id !== r.open_id) {
      result.conflicts++; // Handle already recorded with another open ID.
      continue;
    }
    if (r.open_id) {
      payload.open_id = r.open_id;
      bulkOpen.push(payload);
    } else {
      bulkNoOpen.push(payload);
    }
  }

  // Rows in a bulk call must share the same columns: split by whether stats are present too.
  for (const group of [bulkOpen, bulkNoOpen]) {
    const withStats = group.filter((p) => "stats_at" in p);
    const noStats = group.filter((p) => !("stats_at" in p));
    for (const part of [withStats, noStats]) {
      // Nickname is optional per record, so split once more rather than send nulls over known values.
      const withNick = part.filter((p) => "nickname" in p);
      const noNick = part.filter((p) => !("nickname" in p));
      for (const rows of [withNick, noNick]) {
        result.written += await upsertRows(db, "tiktok_creators", rows, "username_normalised");
      }
    }
  }
  return result;
}
