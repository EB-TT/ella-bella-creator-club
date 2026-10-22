// The six sync streams: affiliate orders, sample applications, sample order
// dates, target collaborations, and the two shop-analytics streams (video and
// LIVE views). Each exports a StreamDef with the passes it runs and a run()
// that works one pass until it finishes or the time budget is spent, saving
// its cursor after every page.
//
// Buyer data: Get Order Detail returns recipient and payment data. The
// sample_orders stream reduces each order to four time fields the moment the
// response arrives; nothing else from it is kept, logged or returned.

import {
  chunk,
  type Db,
  intOrNull,
  isoFromUnix,
  must,
  normUsername,
  numOrNull,
  patchState,
  type Row,
  strOrNull,
  upsertCreators,
  upsertProducts,
  upsertRows,
  type SyncState,
} from "./db.ts";
import { TikTokError, type TikTokApi } from "./tiktok.ts";

export type Pass = "backfill" | "hourly" | "daily";

export interface Ctx {
  db: Db;
  api: TikTokApi;
  state: SyncState;
  deadline: number;
  counts: Row;
  warnings: string[];
}

export interface PassResult {
  complete: boolean;
  /** When the pass began; becomes hourly_last_at / daily_last_at once it completes. */
  started_at: string;
}

export interface StreamDef {
  name: string;
  /** Which incremental passes exist for this stream. */
  passes: ("hourly" | "daily")[];
  /** A daily pass already covers the hourly one (affiliate: 89 days includes 7). */
  dailyCoversHourly?: boolean;
  run(ctx: Ctx, pass: Pass, resume: Row | null): Promise<PassResult>;
}

const hasTime = (ctx: Ctx) => Date.now() < ctx.deadline;
const bump = (ctx: Ctx, key: string, by = 1) => (ctx.counts[key] = (ctx.counts[key] ?? 0) + by);
const saveCursor = (ctx: Ctx, stream: string, cursor: Row) => patchState(ctx.db, stream, { backfill_cursor: cursor });

// ---------------------------------------------------------------------------
// affiliate
// ---------------------------------------------------------------------------

const AFFILIATE_PATH = "/affiliate_seller/202410/orders/search";
const DAY_S = 86_400;
const WINDOW_S = 89 * DAY_S; // inside the API's three-month maximum
const AFFILIATE_START_S = Date.UTC(2024, 1, 1) / 1000;

function affiliateLine(o: Row, s: Row, nowIso: string): Row | null {
  const created = isoFromUnix(o.create_time);
  const orderId = strOrNull(o.id);
  const skuId = strOrNull(s.sku_id);
  if (!created || !orderId || !skuId) return null;
  const username = strOrNull(s.creator_username);
  return {
    order_id: orderId,
    sku_id: skuId,
    line_id: strOrNull(s.id ?? s.line_id),
    creator_username: username,
    username_normalised: username ? normUsername(username) || null : null,
    product_id: strOrNull(s.product_id),
    quantity: intOrNull(s.quantity),
    price_amount: numOrNull(s.price?.amount),
    currency: strOrNull(s.price?.currency ?? s.estimated_commission_base?.currency),
    actual_commission_base: numOrNull(s.actual_commission_base?.amount),
    estimated_commission_base: numOrNull(s.estimated_commission_base?.amount),
    fully_return: s.fully_return === "Yes" ? true : s.fully_return === "No" ? false : null,
    settlement_status: strOrNull(s.settlement_status),
    content_type: strOrNull(s.content_type),
    content_id: strOrNull(s.content_id),
    open_collaboration_id: strOrNull(s.open_collaboration_id),
    target_collaboration_id: strOrNull(s.target_collaboration_id),
    campaign_id: strOrNull(s.campaign_id),
    commission_rate: intOrNull(s.commission_rate),
    shop_ads_commission_rate: intOrNull(s.shop_ads_commission_rate),
    partner_commission_rate: intOrNull(s.partner_commission_rate),
    estimated_paid_commission: numOrNull(s.estimated_paid_commission?.amount),
    actual_paid_commission: numOrNull(s.actual_paid_commission?.amount),
    estimated_paid_shop_ads_commission: numOrNull(s.estimated_paid_shop_ads_commission?.amount),
    actual_paid_shop_ads_commission: numOrNull(s.actual_paid_shop_ads_commission?.amount),
    estimated_paid_partner_commission: numOrNull(s.estimated_paid_partner_commission?.amount),
    actual_paid_partner_commission: numOrNull(s.actual_paid_partner_commission?.amount),
    create_time: created,
    delivery_time: isoFromUnix(o.delivery_time),
    // first_synced_at is left out so it is only ever set by the insert default.
    synced_at: nowIso,
  };
}

async function runAffiliate(ctx: Ctx, pass: Pass, resume: Row | null): Promise<PassResult> {
  const backfill = pass === "backfill";
  const nowS = () => Math.floor(Date.now() / 1000);

  let cur: Row;
  if (resume) {
    cur = resume;
  } else if (backfill) {
    cur = { pass, started_at: new Date().toISOString(), lines_total: 0 };
    Object.assign(cur, nextBackfillWindow(AFFILIATE_START_S, nowS()));
  } else {
    const end = nowS();
    cur = {
      pass,
      started_at: new Date().toISOString(),
      window_start: end - (pass === "hourly" ? 7 : 89) * DAY_S,
      window_end: end,
      final: true,
    };
  }

  while (hasTime(ctx)) {
    const query: Record<string, string> = { page_size: "100" };
    if (cur.page_token) query.page_token = cur.page_token;
    // Explicit bounds on every page keep the paging stable (per the docs).
    const data = await ctx.api.call({
      method: "POST",
      path: AFFILIATE_PATH,
      query,
      body: { create_time_ge: cur.window_start, create_time_lt: cur.window_end },
    });

    const nowIso = new Date().toISOString();
    const lines: Row[] = [];
    const creators = new Map<string, { username: string }>();
    for (const o of (data.orders ?? []) as Row[]) {
      for (const s of (o.skus ?? []) as Row[]) {
        const line = affiliateLine(o, s, nowIso);
        if (!line) {
          bump(ctx, "skipped_lines");
          continue;
        }
        lines.push(line);
        if (line.creator_username) creators.set(line.username_normalised, { username: line.creator_username });
      }
    }
    const written = await upsertRows(ctx.db, "tiktok_affiliate_lines", lines, "order_id,sku_id");
    const cr = await upsertCreators(ctx.db, [...creators.values()]);
    bump(ctx, "pages");
    bump(ctx, "lines", written);
    bump(ctx, "creators_seen", creators.size);
    bump(ctx, "handle_changes", cr.handle_changes);
    bump(ctx, "creator_conflicts", cr.conflicts);
    if (backfill) cur.lines_total = (cur.lines_total ?? 0) + written;

    const next = strOrNull(data.next_page_token);
    if (next) {
      cur.page_token = next;
    } else if (cur.final) {
      return { complete: true, started_at: cur.started_at };
    } else {
      delete cur.page_token;
      Object.assign(cur, nextBackfillWindow(cur.window_end, nowS()));
    }
    await saveCursor(ctx, "affiliate", cur);
  }
  return { complete: false, started_at: cur.started_at };
}

/** The next backfill window from `start`, capped at now (then it is the final one). */
function nextBackfillWindow(start: number, now: number): Row {
  const capped = start + WINDOW_S >= now;
  return { window_start: start, window_end: capped ? now : start + WINDOW_S, final: capped };
}

// ---------------------------------------------------------------------------
// samples
// ---------------------------------------------------------------------------

const SAMPLES_PATH = "/affiliate_seller/202508/sample_applications/search";
const HOURLY_STATUSES = ["PENDING", "AWAITING_SHIPMENT", "SHIPPED", "CONTENT_PENDING"];
const DAILY_STATUSES = [
  "COMPLETED",
  "UNFULFILL_CANCELLED",
  "UNFULFILLABLE_CANCELLED",
  "OPS_CANCELLED",
  "OPS_FAILED",
  "OPS_COMPLETED",
];
// Never paged (never shipped): OVERDUE_CANCELLED, WITHDRAW_CANCELLED, REJECT_CANCELLED,
// SELLER_NOT_SHIP_CANCELLED, DEL_OPEN_COLLAB. Rows already stored are still updated by
// the stale pending check.
const SEARCH_CAP = 9_999;
const STALE_CAP = 200;
const STALE_MAX_AGE_MS = 3 * 3600_000;

async function processSamples(ctx: Ctx, apps: Row[]): Promise<void> {
  const byId = new Map<string, Row>();
  for (const a of apps) if (strOrNull(a.id)) byId.set(String(a.id), a);
  if (!byId.size) return;

  const existing = new Map<string, Row>();
  for (const part of chunk([...byId.keys()], 100)) {
    const rows = must(
      await ctx.db.from("tiktok_samples").select("id, status, status_changed_at, order_id").in("id", part),
      "read samples",
    ) as Row[];
    for (const r of rows) existing.set(r.id, r);
  }

  const nowIso = new Date().toISOString();
  const fresh: Row[] = [];
  const known: Row[] = [];
  const creators: Parameters<typeof upsertCreators>[1] = [];
  const products: { product_id: string; title: string | null }[] = [];

  for (const [id, a] of byId) {
    const c: Row = a.creator ?? {};
    const p: Row = a.product ?? {};
    const username = strOrNull(c.username);
    const orderId = strOrNull(a.order_id);
    const realOrderId = orderId && !/^0+$/.test(orderId) ? orderId : null;
    const prev = existing.get(id);

    const row: Row = {
      id,
      creator_open_id: strOrNull(c.creator_open_id),
      username,
      username_normalised: username ? normUsername(username) || null : null,
      product_id: strOrNull(p.id),
      product_title: strOrNull(p.title),
      sku_id: strOrNull(p.sku_id),
      sku_name: strOrNull(p.sku_name),
      status: String(a.status ?? "UNKNOWN"),
      fulfillment_status: strOrNull(a.fulfillment_status),
      commission_rate: numOrNull(a.commission_rate),
      synced_at: nowIso,
    };
    if (prev) {
      row.order_id = realOrderId ?? prev.order_id ?? null;
      row.status_changed_at = prev.status !== row.status ? nowIso : prev.status_changed_at;
      known.push(row);
    } else {
      row.order_id = realOrderId;
      row.status_changed_at = null;
      row.first_seen_at = nowIso;
      // Replaced by the sample order's create time once sample_orders knows it.
      row.requested_at = nowIso;
      fresh.push(row);
    }

    if (username) {
      creators.push({
        username,
        open_id: row.creator_open_id,
        nickname: strOrNull(c.nickname),
        stats: {
          follower_count: intOrNull(c.follower_count),
          gmv_30d: numOrNull(c.gmv?.amount),
          gmv_30d_currency: strOrNull(c.gmv?.currency),
          fulfillment_percentage: numOrNull(c.fulfillment_percentage),
          // content_count is deliberately not stored.
          ec_video_view: intOrNull(c.ec_video_view),
        },
      });
    }
    if (row.product_id) products.push({ product_id: row.product_id, title: row.product_title });
  }

  await upsertRows(ctx.db, "tiktok_samples", fresh, "id");
  await upsertRows(ctx.db, "tiktok_samples", known, "id");
  const cr = await upsertCreators(ctx.db, creators);
  await upsertProducts(ctx.db, products);
  bump(ctx, "applications", byId.size);
  bump(ctx, "new_applications", fresh.length);
  bump(ctx, "handle_changes", cr.handle_changes);
  bump(ctx, "creator_conflicts", cr.conflicts);
}

async function runSamples(ctx: Ctx, pass: Pass, resume: Row | null): Promise<PassResult> {
  const statuses = pass === "hourly"
    ? HOURLY_STATUSES
    : pass === "daily"
    ? DAILY_STATUSES
    : [...HOURLY_STATUSES, ...DAILY_STATUSES];
  const cur: Row = resume ?? { pass, started_at: new Date().toISOString(), stage: "statuses", status_idx: 0 };
  const totals: Row = (ctx.counts.status_totals ??= {});

  if (cur.stage === "statuses") {
    while (cur.status_idx < statuses.length) {
      if (!hasTime(ctx)) return { complete: false, started_at: cur.started_at };
      const status = statuses[cur.status_idx];
      const query: Record<string, string> = { page_size: "50" };
      if (cur.page_token) query.page_token = cur.page_token;
      const data = await ctx.api.call({ method: "POST", path: SAMPLES_PATH, query, body: { status } });

      if (!cur.page_token) {
        const total = Number(data.total_count);
        totals[status] = total;
        if (total >= SEARCH_CAP) {
          ctx.warnings.push(`Sample status ${status} has total_count ${total} (search caps at ${SEARCH_CAP}); some applications may be missing`);
        }
      }
      await processSamples(ctx, (data.sample_applications ?? []) as Row[]);
      bump(ctx, "pages");

      const next = strOrNull(data.next_page_token);
      if (next) {
        cur.page_token = next;
      } else {
        delete cur.page_token;
        cur.status_idx++;
      }
      await saveCursor(ctx, "samples", cur);
    }
    if (pass === "daily") {
      cur.stage = "stale";
      cur.stale_done = 0;
      await saveCursor(ctx, "samples", cur);
    } else {
      return { complete: true, started_at: cur.started_at };
    }
  }

  return await staleCheck(ctx, cur);
}

/**
 * Daily: PENDING / AWAITING_SHIPMENT rows the last hourly pass didn't see have
 * left those lists (shipped, cancelled, withdrawn). Look each up by creator and
 * product to learn what happened. Capped per day, oldest first.
 */
async function staleCheck(ctx: Ctx, cur: Row): Promise<PassResult> {
  const hourlyAt = ctx.state.hourly_last_at;
  if (!hourlyAt || Date.now() - new Date(hourlyAt).getTime() > STALE_MAX_AGE_MS) {
    ctx.warnings.push("Stale pending check skipped: no hourly sample pass in the last 3 hours");
    return { complete: true, started_at: cur.started_at };
  }
  const stale = () =>
    ctx.db.from("tiktok_samples").select("id, creator_open_id, username, product_id", { count: "exact" })
      .in("status", ["PENDING", "AWAITING_SHIPMENT"]).lt("synced_at", hourlyAt).order("synced_at", { ascending: true });

  while ((cur.stale_done ?? 0) < STALE_CAP) {
    if (!hasTime(ctx)) return { complete: false, started_at: cur.started_at };
    const rows = must(await stale().limit(10), "read stale samples") as Row[];
    if (!rows.length) break;
    for (const r of rows) {
      if (!hasTime(ctx) || cur.stale_done >= STALE_CAP) return { complete: cur.stale_done >= STALE_CAP, started_at: cur.started_at };
      const body: Row = {};
      if (r.creator_open_id) body.creator_user_oepn_id = r.creator_open_id; // spelled as in TikTok's docs
      else if (r.username) body.username = r.username;
      else {
        cur.stale_done++;
        continue;
      }
      if (r.product_id) body.product_id = r.product_id;
      const data = await ctx.api.call({ method: "POST", path: SAMPLES_PATH, query: { page_size: "50" }, body });
      const apps = (data.sample_applications ?? []) as Row[];
      await processSamples(ctx, apps);
      if (!apps.some((a) => String(a.id) === r.id)) {
        // Not returned: mark it checked so it doesn't come back today.
        must(await ctx.db.from("tiktok_samples").update({ synced_at: new Date().toISOString() }).eq("id", r.id), "mark sample checked");
        bump(ctx, "stale_not_found");
      }
      cur.stale_done++;
      bump(ctx, "stale_checked");
      await saveCursor(ctx, "samples", cur);
    }
  }
  const { count } = await stale().limit(1);
  ctx.counts.stale_remaining = count ?? 0;
  return { complete: true, started_at: cur.started_at };
}

// ---------------------------------------------------------------------------
// sample_orders
// ---------------------------------------------------------------------------

const ORDER_DETAIL_PATH = "/order/202507/orders";
const CANCELLATION_STATUSES = [
  "REJECT_CANCELLED",
  "OVERDUE_CANCELLED",
  "UNFULFILL_CANCELLED",
  "DEL_OPEN_COLLAB",
  "SELLER_NOT_SHIP_CANCELLED",
  "WITHDRAW_CANCELLED",
  "UNFULFILLABLE_CANCELLED",
  "OPS_CANCELLED",
  "OPS_FAILED",
];

async function runSampleOrders(ctx: Ctx, pass: Pass, resume: Row | null): Promise<PassResult> {
  const cur: Row = resume ?? { pass, started_at: new Date().toISOString() };

  while (hasTime(ctx)) {
    // Not delivered yet (and not cancelled), or the order date is still unknown.
    let q = ctx.db.from("tiktok_samples").select("id, order_id")
      .not("order_id", "is", null)
      .or(`and(delivered_at.is.null,status.not.in.(${CANCELLATION_STATUSES.join(",")})),order_created_at.is.null`)
      .order("id", { ascending: true })
      .limit(50);
    if (cur.last_id) q = q.gt("id", cur.last_id);
    const rows = must(await q, "read samples needing order dates") as Row[];
    if (!rows.length) return { complete: true, started_at: cur.started_at };

    const ids = [...new Set(rows.map((r) => String(r.order_id)))];
    const data = await ctx.api.call({ method: "GET", path: ORDER_DETAIL_PATH, query: { ids: ids.join(",") } });

    // Reduce each order to the allowed time fields straight away; the rest of the
    // response (recipient, buyer, payment) goes out of scope here and is never stored.
    const times = new Map<string, Row>();
    for (const o of (data.orders ?? []) as Row[]) {
      const created = isoFromUnix(o.create_time);
      if (!o.id || !created) continue;
      const t: Row = { order_created_at: created, requested_at: created };
      const rts = isoFromUnix(o.rts_time);
      const collected = isoFromUnix(o.collection_time);
      const delivered = isoFromUnix(o.delivery_time);
      if (rts) t.shipped_at = rts;
      if (collected) t.collected_at = collected;
      if (delivered) t.delivered_at = delivered;
      times.set(String(o.id), t);
    }

    for (const part of chunk(ids, 10)) {
      await Promise.all(part.map(async (id) => {
        const t = times.get(id);
        if (!t) {
          bump(ctx, "orders_not_found");
          return;
        }
        must(await ctx.db.from("tiktok_samples").update(t).eq("order_id", id), "save sample order times");
        bump(ctx, "orders_updated");
      }));
    }

    bump(ctx, "pages");
    cur.last_id = rows[rows.length - 1].id;
    await saveCursor(ctx, "sample_orders", cur);
  }
  return { complete: false, started_at: cur.started_at };
}

// ---------------------------------------------------------------------------
// target_collabs
// ---------------------------------------------------------------------------

const COLLAB_SEARCH_PATH = "/affiliate_seller/202508/target_collaborations/search";
const COLLAB_DETAIL_PATH = "/affiliate_seller/202508/target_collaborations";
const DETAIL_ATTEMPTS = 3;

async function runTargetCollabs(ctx: Ctx, pass: Pass, resume: Row | null): Promise<PassResult> {
  const backfill = pass === "backfill";
  const cur: Row = resume ?? { pass, started_at: new Date().toISOString(), phase: "list" };

  // Phase 1: list every VALID collaboration and flag the ones whose update_time changed.
  if (cur.phase === "list") {
    while (true) {
      if (!hasTime(ctx)) return { complete: false, started_at: cur.started_at };
      const query: Record<string, string> = { page_size: "100" };
      if (cur.page_token) query.page_token = cur.page_token;
      const data = await ctx.api.call({
        method: "POST",
        path: COLLAB_SEARCH_PATH,
        query,
        body: { collaboration_status: "VALID" },
      });
      const list = ((data.target_collaborations ?? []) as Row[]).filter((c) => strOrNull(c.id));

      const prev = new Map<string, Row>();
      for (const part of chunk(list.map((c) => String(c.id)), 100)) {
        const rows = must(
          await ctx.db.from("tiktok_target_collabs").select("collab_id, list_update_time, needs_detail, detail_failures").in("collab_id", part),
          "read collabs",
        ) as Row[];
        for (const r of rows) prev.set(r.collab_id, r);
      }
      const nowIso = new Date().toISOString();
      const rows = list.map((c) => {
        const id = String(c.id);
        const updated = isoFromUnix(c.update_time);
        const old = prev.get(id);
        const changed = !old || (old.list_update_time ? new Date(old.list_update_time).getTime() : null) !== (updated ? new Date(updated).getTime() : null);
        return {
          collab_id: id,
          name: strOrNull(c.name),
          list_update_time: updated,
          needs_detail: changed || old?.needs_detail === true,
          detail_failures: changed ? 0 : old?.detail_failures ?? 0,
          last_listed_at: cur.started_at,
          synced_at: nowIso,
        };
      });
      await upsertRows(ctx.db, "tiktok_target_collabs", rows, "collab_id");
      bump(ctx, "pages");
      bump(ctx, "collabs_listed", rows.length);

      const next = strOrNull(data.next_page_token);
      if (next) {
        cur.page_token = next;
      } else {
        delete cur.page_token;
        cur.phase = "detail";
      }
      await saveCursor(ctx, "target_collabs", cur);
      if (!next) break;
    }
  }

  // Phase 2: detail for the flagged collaborations. The work list lives in the table, so a
  // run that stops half way simply picks the rest up next time.
  while (hasTime(ctx)) {
    const todo = must(
      await ctx.db.from("tiktok_target_collabs").select("collab_id, name, list_update_time, detail_failures")
        .eq("needs_detail", true).gte("last_listed_at", cur.started_at).lt("detail_failures", DETAIL_ATTEMPTS)
        .order("collab_id", { ascending: true }).limit(10),
      "read collabs needing detail",
    ) as Row[];
    if (!todo.length) {
      const { count } = await ctx.db.from("tiktok_target_collabs").select("collab_id", { count: "exact", head: true }).eq("needs_detail", true).gte("last_listed_at", cur.started_at);
      if (count) ctx.warnings.push(`${count} collaboration(s) skipped after ${DETAIL_ATTEMPTS} failed detail attempts`);
      return { complete: true, started_at: cur.started_at };
    }
    for (const c of todo) {
      if (!hasTime(ctx)) return { complete: false, started_at: cur.started_at };
      try {
        await syncCollabDetail(ctx, c, backfill);
      } catch (e) {
        // Count the failure so one bad collaboration can't block the stream for ever, then stop this run.
        await ctx.db.from("tiktok_target_collabs").update({ detail_failures: (c.detail_failures ?? 0) + 1 }).eq("collab_id", c.collab_id);
        throw e;
      }
    }
  }
  return { complete: false, started_at: cur.started_at };
}

async function syncCollabDetail(ctx: Ctx, c: Row, backfill: boolean): Promise<void> {
  const data = await ctx.api.call({ method: "GET", path: `${COLLAB_DETAIL_PATH}/${c.collab_id}` });
  const tc: Row = data.target_collaboration ?? {};
  const updateIso = isoFromUnix(tc.update_time) ?? c.list_update_time;
  const nowIso = new Date().toISOString();

  const kept = ((tc.creators ?? []) as Row[]).filter((cr) =>
    strOrNull(cr.username) && (Number(cr.showcase_product_count) > 0 || Number(cr.content_product_count) > 0)
  );

  const existing = new Map<string, Row>();
  const rows = must(
    await ctx.db.from("tiktok_target_collab_creators").select("username_normalised, accepted_at").eq("collab_id", c.collab_id),
    "read collab creators",
  ) as Row[];
  for (const r of rows) existing.set(r.username_normalised, r);

  const out: Row[] = [];
  for (const cr of kept) {
    const norm = normUsername(cr.username);
    if (!norm) continue;
    const showcase = intOrNull(cr.showcase_product_count) ?? 0;
    let acceptedAt: string | null = existing.get(norm)?.accepted_at ?? null;
    if (!acceptedAt && showcase > 0) {
      // Backfill can't know when they accepted; the collaboration's update_time is the best guess.
      acceptedAt = backfill ? updateIso : nowIso;
      if (backfill) bump(ctx, "accepted_at_approximate");
    }
    out.push({
      collab_id: c.collab_id,
      username_normalised: norm,
      open_id: strOrNull(cr.creator_open_id),
      username: String(cr.username).trim().replace(/^@+/, ""),
      collab_name: strOrNull(tc.name) ?? c.name ?? null,
      showcase_product_count: showcase,
      content_product_count: intOrNull(cr.content_product_count) ?? 0,
      creator_collab_status: strOrNull(cr.collaboration_status),
      accepted_at: acceptedAt,
      collab_update_time: updateIso,
      synced_at: nowIso,
    });
  }
  await upsertRows(ctx.db, "tiktok_target_collab_creators", out, "collab_id,username_normalised");

  const cr = await upsertCreators(
    ctx.db,
    kept.map((k) => ({ username: String(k.username), open_id: strOrNull(k.creator_open_id), nickname: strOrNull(k.nickname) })),
  );
  await upsertProducts(
    ctx.db,
    ((tc.products ?? []) as Row[]).map((p) => ({ product_id: String(p.id ?? ""), title: strOrNull(p.title) })),
  );

  must(
    await ctx.db.from("tiktok_target_collabs").update({ needs_detail: false, detail_failures: 0, detail_synced_at: nowIso }).eq("collab_id", c.collab_id),
    "mark collab synced",
  );
  bump(ctx, "details");
  bump(ctx, "collab_creators_stored", out.length);
  bump(ctx, "handle_changes", cr.handle_changes);
  bump(ctx, "creator_conflicts", cr.conflicts);
}

// ---------------------------------------------------------------------------
// video_views and live_views (shop analytics)
//
// Both endpoints report activity inside the requested date range only, so a
// video's total views is the sum over NON-overlapping windows. The two streams
// tile 60-day windows from the lookback floor (the oldest start date TikTok
// accepts, found by probing) up to latest_available_date + 1, one window at a
// time and page by page. `progress.covered_until` is the exclusive end of the
// last window fully fetched; the next window always starts there, so a range
// is never fetched twice. The daily pass is the same loop: it fetches whatever
// lies between covered_until and latest_available_date + 1.
//
// Durable state is in tiktok_sync_state.progress (the sync clears
// backfill_cursor when a pass completes): lookback_floor, backfill_windows_done,
// covered_until, latest_available_date. backfill_cursor holds only the
// in-progress window and page token.
// ---------------------------------------------------------------------------

const ANALYTICS_SCOPE = "data.shop_analytics.public.read";
const VIDEO_PERF_PATH = "/analytics/202605/shop_videos/performance";
const LIVE_PERF_PATH = "/analytics/202609/shop_lives/performance";
const ANALYTICS_WINDOW_DAYS = 60;
const ANALYTICS_PAGE_SIZE = 100;
// TikTok rejects older start dates with 28001022 ("must stay within the lookback window"): about 120-180 days.
const LOOKBACK_REJECTED = 28001022;
const FLOOR_FIRST_GUESS_DAYS = 180;
const FLOOR_STEP_DAYS = 7;
// The data runs about 2 days behind; used only if a response doesn't say.
const FALLBACK_LAG_DAYS = 2;
const DAY_MS = DAY_S * 1000;

/** The shop hasn't granted the analytics scope yet. The stream waits (no error, no back-off). */
export class WaitingForScopeError extends Error {
  constructor() {
    super(`Waiting for scope ${ANALYTICS_SCOPE}`);
    this.name = "WaitingForScopeError";
  }
}

const parseDay = (d: string) => Date.parse(`${d}T00:00:00Z`);
const fmtDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => fmtDay(parseDay(d) + n * DAY_MS);

/** "2025-01-01 00:00:00" (video_post_time) -> ISO, read as UTC; null if unreadable. */
function videoPostTime(v: unknown): string | null {
  const s = strOrNull(v);
  if (!s) return null;
  const ms = Date.parse(s.includes("T") ? s : s.replace(" ", "T") + "Z");
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

// The LIVE endpoint documents start_time/end_time as unix seconds but actually returns shop-local
// "YYYY-MM-DD HH:MM:SS" strings (the discovery run: "2026-09-29 14:38:46"). The shop's clock is UTC-8:
// the session ID's embedded creation time (top 32 bits = unix seconds) is 22:37:26 UTC for that
// session, 80 s before its 14:38:46 start_time. Verify with the start_time-vs-ID query after a refetch.
const SHOP_UTC_OFFSET_HOURS = -8;

/** LIVE start_time/end_time -> ISO. Accepts unix seconds, a zoned datetime, or the shop-local "YYYY-MM-DD HH:MM:SS". */
function liveTime(v: unknown): string | null {
  const s = strOrNull(v);
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return isoFromUnix(s);
  const local = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(s);
  const ms = local
    ? Date.parse(`${local[1]}T${local[2]}Z`) - SHOP_UTC_OFFSET_HOURS * 3_600_000
    : /(Z|[+-]\d{2}:?\d{2})$/i.test(s) ? Date.parse(s.replace(" ", "T")) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

interface AnalyticsKind {
  name: "video_views" | "live_views";
  path: string;
  listKey: string;
  query: Record<string, string>;
  /** Stores one page of items for the window. */
  store(ctx: Ctx, items: Row[], win: { start: string; end: string }): Promise<void>;
}

async function storeVideos(ctx: Ctx, items: Row[], win: { start: string; end: string }): Promise<void> {
  const nowIso = new Date().toISOString();
  const videos: Row[] = [];
  const windows: Row[] = [];
  const creators = new Map<string, { username: string }>();
  for (const v of items) {
    const id = strOrNull(v.id);
    const username = strOrNull(v.creator?.user_name ?? v.username);
    const norm = username ? normUsername(username) : "";
    if (!id || !norm) {
      bump(ctx, "skipped_videos");
      continue;
    }
    videos.push({
      video_id: id,
      username_normalised: norm,
      username: username!.replace(/^@+/, "").trim(),
      post_time: videoPostTime(v.video_post_time),
      title: strOrNull(v.title),
      duration: intOrNull(v.duration),
      products: ((v.products ?? []) as Row[])
        .map((p) => ({ id: strOrNull(p.id), name: strOrNull(p.name) }))
        .filter((p) => p.id),
      last_seen_at: nowIso,
    });
    windows.push({
      video_id: id,
      window_start: win.start,
      window_end: win.end,
      views: intOrNull(v.views) ?? 0,
      likes: intOrNull(v.likes),
      comments: intOrNull(v.comments),
      shares: intOrNull(v.shares),
      gmv: numOrNull(v.gmv?.amount),
      items_sold: intOrNull(v.items_sold),
      fetched_at: nowIso,
    });
    creators.set(norm, { username: username! });
  }
  // first_seen_at is left out so it is only ever set by the insert default.
  const nv = await upsertRows(ctx.db, "tiktok_videos", videos, "video_id");
  const nw = await upsertRows(ctx.db, "tiktok_video_window_views", windows, "video_id,window_start");
  const cr = await upsertCreators(ctx.db, [...creators.values()]);
  bump(ctx, "videos", nv);
  bump(ctx, "video_windows", nw);
  bump(ctx, "creators_seen", creators.size);
  bump(ctx, "handle_changes", cr.handle_changes);
  bump(ctx, "creator_conflicts", cr.conflicts);
}

async function storeLives(ctx: Ctx, items: Row[], _win: { start: string; end: string }): Promise<void> {
  const nowIso = new Date().toISOString();
  const lives: Row[] = [];
  const creators = new Map<string, { username: string }>();
  for (const s of items) {
    const id = strOrNull(s.id);
    const username = strOrNull(s.creator?.user_name);
    const norm = username ? normUsername(username) : "";
    if (!id || !norm) {
      bump(ctx, "skipped_lives");
      continue;
    }
    // Upserted by session id, so a session that shows up in two windows is stored once (the later fetch wins).
    const startTime = liveTime(s.start_time);
    const endTime = liveTime(s.end_time);
    if ((strOrNull(s.start_time) && !startTime) || (strOrNull(s.end_time) && !endTime)) bump(ctx, "live_times_unreadable");
    lives.push({
      live_id: id,
      username_normalised: norm,
      username: username!.replace(/^@+/, "").trim(),
      start_time: startTime,
      end_time: endTime,
      views: intOrNull(s.traffic?.views) ?? 0,
      viewers: intOrNull(s.traffic?.viewers),
      live_attributed_gmv: numOrNull(s.sales_performance?.live_attributed_gmv?.amount),
      // 017: whether our product was shown or sold decides if the session counts
      product_impressions: intOrNull(s.traffic?.product_impressions),
      products_sold: intOrNull(s.sales_performance?.products_sold),
      product_clicks: intOrNull(s.traffic?.product_clicks),
      fetched_at: nowIso,
    });
    creators.set(norm, { username: username! });
  }
  const n = await upsertRows(ctx.db, "tiktok_lives", lives, "live_id");
  const cr = await upsertCreators(ctx.db, [...creators.values()]);
  bump(ctx, "lives", n);
  bump(ctx, "creators_seen", creators.size);
  bump(ctx, "handle_changes", cr.handle_changes);
  bump(ctx, "creator_conflicts", cr.conflicts);
}

const VIDEO_KIND: AnalyticsKind = {
  name: "video_views",
  path: VIDEO_PERF_PATH,
  listKey: "videos",
  // Sorted by views, as the discovery run did (page_size=100 with this sort works).
  query: { sort_field: "views", sort_order: "DESC" },
  store: storeVideos,
};
const LIVE_KIND: AnalyticsKind = {
  name: "live_views",
  path: LIVE_PERF_PATH,
  listKey: "live_stream_sessions",
  query: {},
  store: storeLives,
};

async function runAnalytics(kind: AnalyticsKind, ctx: Ctx, pass: Pass, resume: Row | null): Promise<PassResult> {
  if (!ctx.api.hasScope(ANALYTICS_SCOPE)) throw new WaitingForScopeError();

  const stream = kind.name;
  const progress: Row = { ...(ctx.state.progress ?? {}) };
  const cur: Row = resume ?? { pass, started_at: new Date().toISOString() };
  const todayMs = Math.floor(Date.now() / DAY_MS) * DAY_MS;
  const saveProgress = async () => {
    ctx.counts.covered_until = progress.covered_until ?? null;
    ctx.counts.lookback_floor = progress.lookback_floor ?? null;
    await patchState(ctx.db, stream, { progress });
  };

  const fetchPage = (start: string, end: string, size: number, token?: string): Promise<Row> =>
    ctx.api.call({
      method: "GET",
      path: kind.path,
      analytics: true,
      query: {
        start_date_ge: start,
        end_date_lt: end,
        account_type: "AFFILIATE_ACCOUNTS",
        page_size: String(size),
        ...kind.query,
        ...(token ? { page_token: token } : {}),
      },
    });

  /** The lookback has moved past a start date we still needed: carry on from `start` and say so. */
  const moveFloor = async (start: string, why: string): Promise<void> => {
    const oldCovered = progress.covered_until as string | undefined;
    progress.lookback_floor = !progress.lookback_floor || parseDay(start) > parseDay(progress.lookback_floor) ? start : progress.lookback_floor;
    if (!oldCovered || parseDay(start) > parseDay(oldCovered)) {
      if (oldCovered) ctx.warnings.push(`${stream}: ${why}; ${oldCovered} to ${start} is outside TikTok's lookback and was not fetched`);
      progress.covered_until = start;
    }
    await saveProgress();
  };

  /**
   * One small call that (a) finds the lookback floor on the first run, stepping forward 7 days from 180 days
   * ago while TikTok answers 28001022, and (b) reads latest_available_date. Returns the exclusive end date
   * to fetch up to (latest_available_date + 1).
   */
  const probe = async (): Promise<string> => {
    let start = progress.lookback_floor
      ? fmtDay(Math.max(parseDay(progress.lookback_floor), parseDay(progress.covered_until ?? progress.lookback_floor) - DAY_MS))
      : fmtDay(todayMs - FLOOR_FIRST_GUESS_DAYS * DAY_MS);
    for (let rejected = 0;; rejected++) {
      // Only after a rejection: a first attempt at covered_until - 1 day is legitimately close to today.
      if (rejected > 0 && parseDay(start) >= todayMs - FALLBACK_LAG_DAYS * DAY_MS) {
        throw new Error(`${stream}: TikTok accepted no start date up to ${start} (lookback floor not found)`);
      }
      try {
        const data = await fetchPage(start, addDays(start, 1), 1);
        if (!progress.lookback_floor) {
          progress.lookback_floor = start;
          progress.covered_until = start;
          progress.backfill_windows_done = 0;
        }
        const latest = strOrNull(data.latest_available_date) ?? fmtDay(todayMs - FALLBACK_LAG_DAYS * DAY_MS);
        progress.latest_available_date = latest;
        await saveProgress();
        return addDays(latest, 1);
      } catch (e) {
        if (!(e instanceof TikTokError) || e.code !== LOOKBACK_REJECTED) throw e;
        start = addDays(start, FLOOR_STEP_DAYS);
        if (progress.lookback_floor) await moveFloor(start, "the lookback window moved");
      }
    }
  };

  let endExclusive: string | undefined;
  while (Date.now() < ctx.deadline) {
    // Pick the next window: it starts where the last one ended.
    if (!cur.window_start) {
      endExclusive ??= await probe();
      const covered = progress.covered_until as string;
      if (parseDay(covered) >= parseDay(endExclusive)) {
        await saveProgress();
        return { complete: true, started_at: cur.started_at };
      }
      cur.window_start = covered;
      cur.window_end = fmtDay(Math.min(parseDay(covered) + ANALYTICS_WINDOW_DAYS * DAY_MS, parseDay(endExclusive)));
      delete cur.page_token;
      // The bounds are saved before the first page, so a resumed window is always re-fetched with the same bounds.
      await saveCursor(ctx, stream, cur);
    }

    let data: Row;
    try {
      data = await fetchPage(cur.window_start, cur.window_end, ANALYTICS_PAGE_SIZE, cur.page_token);
    } catch (e) {
      if (e instanceof TikTokError && e.code === LOOKBACK_REJECTED && !cur.page_token) {
        // The lookback moved past this window's start while the backfill was paused.
        const start = addDays(cur.window_start, FLOOR_STEP_DAYS);
        if (parseDay(start) >= parseDay(cur.window_end)) {
          await moveFloor(cur.window_end, "the lookback window moved");
          delete cur.window_start;
          delete cur.window_end;
        } else {
          await moveFloor(start, "the lookback window moved");
          cur.window_start = start;
        }
        await saveCursor(ctx, stream, cur);
        continue;
      }
      throw e;
    }

    const items = (data[kind.listKey] ?? []) as Row[];
    if (!Array.isArray(data[kind.listKey]) && Object.keys(data).some((k) => Array.isArray(data[k]))) {
      const msg = `${stream}: response has no "${kind.listKey}" list; its lists are ${Object.keys(data).filter((k) => Array.isArray(data[k])).join(", ")}`;
      if (!ctx.warnings.includes(msg)) ctx.warnings.push(msg);
    }
    const latest = strOrNull(data.latest_available_date);
    if (latest) progress.latest_available_date = latest;
    await kind.store(ctx, items, { start: cur.window_start, end: cur.window_end });
    bump(ctx, "pages");

    const next = strOrNull(data.next_page_token);
    if (next) {
      cur.page_token = next;
      await saveCursor(ctx, stream, cur);
      continue;
    }
    // Window done. Progress first, then the cursor: a crash between the two just re-fetches the last page (idempotent).
    if (parseDay(progress.covered_until ?? cur.window_start) < parseDay(cur.window_end)) {
      progress.covered_until = cur.window_end;
      progress.backfill_windows_done = (progress.backfill_windows_done ?? 0) + 1;
      bump(ctx, "windows_completed");
    }
    await saveProgress();
    delete cur.window_start;
    delete cur.window_end;
    delete cur.page_token;
    await saveCursor(ctx, stream, cur);
  }
  return { complete: false, started_at: cur.started_at };
}

// ---------------------------------------------------------------------------

export const STREAMS: StreamDef[] = [
  { name: "affiliate", passes: ["hourly", "daily"], dailyCoversHourly: true, run: runAffiliate },
  { name: "samples", passes: ["hourly", "daily"], run: runSamples },
  { name: "sample_orders", passes: ["hourly"], run: runSampleOrders },
  { name: "target_collabs", passes: ["daily"], run: runTargetCollabs },
  { name: "video_views", passes: ["daily"], run: (ctx, pass, resume) => runAnalytics(VIDEO_KIND, ctx, pass, resume) },
  { name: "live_views", passes: ["daily"], run: (ctx, pass, resume) => runAnalytics(LIVE_KIND, ctx, pass, resume) },
];
