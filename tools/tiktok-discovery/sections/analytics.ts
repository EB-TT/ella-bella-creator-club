// Section 6: Shop analytics (needs scope data.shop_analytics.public.read). Get Shop Video
// Performance List and Get Shop LIVE Performance List, for tiers that qualify on views:
// is access granted, how many videos/lives, do non-selling ones appear, how far back does
// data go, are `views` per window or cumulative, and do video creators match the
// affiliate/sample creators from earlier sections in the same run.

import { TikTokApiError, type Client, type Query } from "../tiktok.ts";
import { amountOf, inventoryMd, listItems, normUser, sleep, table, toNum, log } from "../util.ts";
import type { Ctx, Section } from "./types.ts";

const VIDEO_PATH = "/analytics/202605/shop_videos/performance";
const LIVE_PATH = "/analytics/202609/shop_lives/performance";
const DAY = 86_400;
const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const HISTORY_FLOOR = Date.UTC(2024, 1, 1) / 1000;
const ACCOUNT_TYPES = ["ALL", "AFFILIATE_ACCOUNTS", "OFFICIAL_ACCOUNTS", "MARKETING_ACCOUNTS"];
const BAD_DATE_CODE = 28001022;
const RETRY_WAITS_MS = [2000, 4000, 8000];
const PROBE_GAP_MS = 1000;

interface Probe {
  days: number;
  size: number;
  sort: "views" | "post_time" | null;
  currency?: string;
}
// Tried in order before paging: the plain page_size=100 views sort returned HTTP 500 / code 36009003.
const PROBES: Probe[] = [
  { days: 60, size: 100, sort: "views" }, // the failing case, as a control
  { days: 60, size: 100, sort: null },
  { days: 60, size: 50, sort: "views" },
  { days: 60, size: 20, sort: "views" },
  { days: 60, size: 20, sort: null },
  { days: 7, size: 100, sort: "views" },
  { days: 7, size: 20, sort: null },
  { days: 60, size: 20, sort: "post_time" },
  { days: 60, size: 100, sort: "views", currency: "LOCAL" }, // #1 plus `currency`, which is otherwise not sent
];
const sortQuery = (sort: Probe["sort"]): Query => (sort ? [["sort_field", sort], ["sort_order", "DESC"]] : []);
const SORT_RANK: Record<string, number> = { views: 0, null: 1, post_time: 2 };

// Documented leaf paths relative to the item (docs/tiktok-api/Get Shop Video Performance List.md).
const VIDEO_EXPECTED = [
  "id", "title", "username", "video_post_time", "duration", "views", "likes", "comments", "shares",
  "new_followers", "product_clicks", "product_impressions", "items_sold", "sku_orders", "avg_customers",
  "click_through_rate", "ctor", "video_finish_rate", "v_to_l_clicks", "v_to_l_rate", "review_type",
  "advertisable", "hash_tags", "products.id", "products.name",
  "gmv.amount", "gmv.currency", "attributed_gmv.amount", "indirect_gmv.amount", "gpm.amount",
  "creator.user_name", "creator.nick_name", "creator.open_id", "creator.creator_id",
  "creator.author_type", "creator.creator_country",
];
// docs/tiktok-api/Get Shop LIVE Performance List.md
const LIVE_EXPECTED = [
  "id", "title", "start_time", "end_time",
  "creator.user_name", "creator.nick_name", "creator.open_id", "creator.author_type", "creator.creator_country",
  "traffic.views", "traffic.viewers", "traffic.acu", "traffic.pcu", "traffic.impressions", "traffic.product_clicks",
  "sales_performance.live_attributed_gmv.amount", "sales_performance.live_gmv.amount",
  "sales_performance.live_indirect_gmv.amount", "sales_performance.live_attributed_items_sold",
  "sales_performance.live_attributed_orders", "sales_performance.attributed_customers",
  "interaction_performance.likes", "interaction_performance.comments", "interaction_performance.new_followers",
];

const ymd = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 10);
const at = (o: any, path: string) => path.split(".").reduce((v, k) => (v == null ? undefined : v[k]), o);

function pct(sorted: number[], q: number): number {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))] : 0;
}
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** p50 / p90 / max (and the zero count) of a numeric measure. */
function distRow(label: string, values: number[]): (string | number)[] {
  const s = [...values].sort((a, b) => a - b);
  return [label, s.length, s.filter((v) => v === 0).length, fmt(pct(s, 0.5)), fmt(pct(s, 0.9)), fmt(s.at(-1) ?? 0)];
}
const DIST_HEAD = ["measure", "items", "= 0", "p50", "p90", "max"];

/**
 * Fetch one page; once a listing has succeeded at least once, a failed page is retried after 2 s, 4 s
 * and 8 s. Returns the data, or the final error after the retries. `notes` collects what was retried.
 */
async function pageRetry(
  what: string,
  retriable: boolean,
  notes: string[],
  fn: () => Promise<{ data: any }>,
): Promise<{ data: any } | TikTokApiError> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof TikTokApiError)) throw e;
      if (!retriable || i >= RETRY_WAITS_MS.length) {
        if (i > 0) notes.push(`${what}: gave up after ${i} retries (last: HTTP ${e.httpStatus ?? "-"}, code ${e.code ?? "-"}, request ID ${e.requestId ?? "-"}).`);
        return e;
      }
      notes.push(`${what}: HTTP ${e.httpStatus ?? "-"}, code ${e.code ?? "-"}, request ID ${e.requestId ?? "-"}; retry ${i + 1} after ${RETRY_WAITS_MS[i] / 1000}s.`);
      log(`  ${what} failed; retrying in ${RETRY_WAITS_MS[i] / 1000}s`);
      await sleep(RETRY_WAITS_MS[i]);
    }
  }
}

/** Status, TikTok code, message and request ID, plus the likely cause when it looks like a permissions/token failure. */
function accessFailure(what: string, e: TikTokApiError): string[] {
  const looksAuth = e.httpStatus === 401 || e.httpStatus === 403 || /scope|permission|author|token|access/i.test(e.message);
  const out = [
    `**${what}: access check failed.** HTTP ${e.httpStatus ?? "(none)"}, TikTok code ${e.code ?? "(none)"}, request ID ${e.requestId ?? "(none)"}.`,
    "",
    `> ${e.message}`,
    "",
  ];
  if (looksAuth) {
    out.push(
      "This looks like a permissions/token failure. The most likely cause is that `.env` still holds the access token from before the shop re-authorised with `data.shop_analytics.public.read`. Re-run the SQL query in README \"Setup\" in the Supabase SQL editor and refresh `TIKTOK_ACCESS_TOKEN` (and `TIKTOK_REFRESH_TOKEN`) in `.env`, then re-run `npx tsx run.ts --only analytics`.",
      "",
    );
  }
  out.push("Stopped this part of the section.", "");
  return out;
}

const identityRows = (
  creators: Set<string>,
  openIds: Set<string>,
  ctx: Ctx,
): (string | number)[][] => {
  const inSet = (s: Set<string> | undefined) => (s?.size ? [...creators].filter((u) => s.has(u)).length : "n/a (section not run in this invocation)");
  const eitherSet = ctx.affiliateUsernames?.size || ctx.sampleUsernames?.size
    ? [...creators].filter((u) => ctx.affiliateUsernames?.has(u) || ctx.sampleUsernames?.has(u)).length
    : "n/a";
  return [
    ["distinct creators (normalised user_name)", creators.size],
    ["…matching an affiliate-order creator_username (30 days)", inSet(ctx.affiliateUsernames)],
    ["…matching a sample-application username", inSet(ctx.sampleUsernames)],
    ["…matching either", eitherSet],
    ["distinct non-empty creator.open_id", openIds.size],
    [
      "…matching a sample-application creator_open_id",
      ctx.sampleOpenIds?.size ? [...openIds].filter((o) => ctx.sampleOpenIds!.has(o)).length : "n/a (samples not run in this invocation)",
    ],
  ];
};

export const analytics: Section = async (client, ctx) => {
  const md: string[] = [];
  const errors: string[] = [];
  const todaySec = Math.floor(Date.now() / 1000 / DAY) * DAY;
  let winDays = 60;
  const examples: unknown[] = [];

  const videoCall = (acct: string, ge: number, lt: number, size: number, extra: Query = []) =>
    client.request({
      method: "GET",
      path: VIDEO_PATH,
      query: [["start_date_ge", ymd(ge)], ["end_date_lt", ymd(lt)], ["account_type", acct], ["page_size", String(size)], ...extra],
    });
  const liveCall = (ge: number, lt: number, size: number, extra: Query = []) =>
    client.request({
      method: "GET",
      path: LIVE_PATH,
      query: [["start_date_ge", ymd(ge)], ["end_date_lt", ymd(lt)], ["account_type", "AFFILIATE_ACCOUNTS"], ["page_size", String(size)], ...extra],
    });
  const videoList = (data: any): any[] => (Array.isArray(data?.videos) ? data.videos : listItems(data));
  const liveList = (data: any): any[] => (Array.isArray(data?.live_stream_sessions) ? data.live_stream_sessions : listItems(data));
  const totalOf = (data: any, list: any[]) => (data?.total_count === undefined ? list.length : toNum(data.total_count));

  // ==== Videos ====
  md.push("### Videos: access check", "");
  let videoOk = false;
  try {
    await videoCall("AFFILIATE_ACCOUNTS", todaySec - 30 * DAY, todaySec, 1);
    videoOk = true;
    md.push("Access works: last 30 days, `AFFILIATE_ACCOUNTS`, `page_size=1` returned code 0.", "");
  } catch (e) {
    if (!(e instanceof TikTokApiError)) throw e;
    errors.push(`videos access check: ${e.message}`);
    md.push(...accessFailure("Get Shop Video Performance List", e));
  }

  if (videoOk) {
    try {
      // ---- Volume ----
      const win = () => [todaySec - winDays * DAY, todaySec] as const;
      const volume: (string | number)[][] = [];
      for (const acct of ACCOUNT_TYPES) {
        let res;
        try {
          res = await videoCall(acct, ...win(), 1);
        } catch (e) {
          // The 60-day cap may be exclusive of a full 60 days; fall back once to 59 and say so.
          if (e instanceof TikTokApiError && e.code === BAD_DATE_CODE && winDays === 60) {
            winDays = 59;
            md.push("_A 60-day window was rejected as an invalid date range (code 28001022); using 59-day windows from here._", "");
            res = await videoCall(acct, ...win(), 1);
          } else throw e;
        }
        volume.push([acct, totalOf(res.data, videoList(res.data)), res.data?.latest_available_date ?? "(absent)"]);
      }
      md.push(
        `### Videos: volume, ${ymd(win()[0])} → ${ymd(win()[1])}`,
        "",
        table(["account_type", "total_count", "latest_available_date"], volume),
        "",
      );

      // ---- Probe: find a request shape that doesn't 500 ----
      const probeRows: (string | number)[][] = [];
      const okProbes: { i: number; p: Probe; days: number }[] = [];
      for (const [i, p] of PROBES.entries()) {
        if (i > 0) await sleep(PROBE_GAP_MS);
        const days = Math.min(p.days, winDays);
        const extra: Query = [...sortQuery(p.sort), ...(p.currency ? [["currency", p.currency] as [string, string]] : [])];
        let http: string | number = 200;
        let code: string | number = 0;
        let rid = "-";
        let note = "";
        try {
          const r = await videoCall("AFFILIATE_ACCOUNTS", todaySec - days * DAY, todaySec, p.size, extra);
          rid = r.requestId;
          note = `ok, ${videoList(r.data).length} rows`;
          okProbes.push({ i, p, days });
        } catch (e) {
          if (!(e instanceof TikTokApiError)) throw e;
          http = e.httpStatus ?? "-";
          code = e.code ?? "-";
          rid = e.requestId ?? "-";
          note = e.message.replace(/^[^:]*:\s*/, "").slice(0, 80);
        }
        probeRows.push([i + 1, `${days}d`, p.size, p.sort ? `${p.sort} DESC` : "default", p.currency ?? "(not sent)", http, code, rid, note]);
      }
      // Preference among successes: a views sort, then the longest window, then the largest page size, then probe order.
      const chosen = [...okProbes].sort(
        (x, y) => SORT_RANK[String(x.p.sort)] - SORT_RANK[String(y.p.sort)] || y.days - x.days || y.p.size - x.p.size || x.i - y.i,
      )[0];
      md.push(
        "### Videos: request-shape probe",
        "",
        "`AFFILIATE_ACCOUNTS`, one request per row, at least 1 s apart. Probe 1 (page_size=100, sort views DESC, 60 days) returned HTTP 500 / code 36009003 on earlier runs.",
        "",
        table(["#", "window", "page_size", "sort", "currency", "HTTP", "code", "request ID", "result"], probeRows),
        "",
      );
      if (!chosen) {
        const ids = probeRows.map((r) => r[7]).filter((r) => r !== "-").join(", ");
        errors.push("videos probe: no list request shape succeeded");
        md.push(
          "**None of the nine request shapes succeeded.** Paging, the zero-sale share, views semantics and identity matching are skipped. The `page_size=1` volume and history calls still work, so access is fine and this looks like a TikTok-side fault on list reads.",
          "",
          `Request IDs to give TikTok support: ${ids || "(none returned)"}.`,
          "",
        );
      } else {
        const how = chosen.p.sort ? `${chosen.p.sort} DESC` : "default order (gmv DESC)";
        md.push(
          `Using probe #${chosen.i + 1}: ${chosen.days}-day window, page_size ${chosen.p.size}, sort ${how}${chosen.p.currency ? `, currency=${chosen.p.currency}` : ""}.`,
          "",
        );
        if (chosen.p.sort !== "views") {
          md.push(`**No sort by views succeeded**, so the zero-sale and percentile figures below come from the ${how} ordering, not the top videos by views.`, "");
        }
      }
      const pageDays = chosen?.days ?? winDays;
      const pageSize = chosen?.p.size ?? PAGE_SIZE;
      const pageExtra = (): Query => [...sortQuery(chosen?.p.sort ?? null), ...(chosen?.p.currency ? [["currency", chosen.p.currency] as [string, string]] : [])];
      const retryNotes: string[] = [];

      // ---- Zero-sale videos + views distribution ----
      const videos: any[] = [];
      let pages = 0;
      let token: string | undefined;
      let reported = 0;
      if (chosen) {
        do {
          const extra: Query = pageExtra();
          if (token) extra.push(["page_token", token]);
          const r = await pageRetry(`videos page ${pages + 1}`, pages > 0, retryNotes, () =>
            videoCall("AFFILIATE_ACCOUNTS", todaySec - pageDays * DAY, todaySec, pageSize, extra),
          );
          if (r instanceof TikTokApiError) {
            errors.push(`videos paging, page ${pages + 1}: ${r.message}`);
            retryNotes.push(`Paging stopped at page ${pages + 1}; continuing with the ${videos.length} videos read so far.`);
            break;
          }
          reported ||= totalOf(r.data, []);
          videos.push(...videoList(r.data));
          token = r.data?.next_page_token || undefined;
          pages++;
        } while (token && pages < MAX_PAGES);
      }
      examples.push(...videos.slice(0, 2));

      const gmvOf = (v: any) => amountOf(v?.gmv) ?? 0;
      const views = videos.map((v) => toNum(v.views));
      const zeroGmv = videos.filter((v) => gmvOf(v) === 0);
      const zeroAttr = videos.filter((v) => (amountOf(v?.attributed_gmv) ?? 0) === 0);
      const nameOf = (v: any) => normUser(v?.creator?.user_name ?? v?.username);
      const creators = new Set(videos.map(nameOf).filter(Boolean));
      const openIds = new Set(videos.map((v) => String(v?.creator?.open_id ?? "")).filter(Boolean));
      const truncated = token !== undefined;

      if (chosen) md.push(
        `### Videos: AFFILIATE_ACCOUNTS, last ${pageDays} days, sorted by ${chosen.p.sort ? chosen.p.sort + " DESC" : "default order (gmv DESC)"}`,
        "",
        table(["measure", "value"], [
          [`pages fetched (page_size ${pageSize}, cap ${MAX_PAGES})`, pages],
          ["API `total_count`", reported],
          ["videos read", videos.length],
          ["videos with `gmv` = 0 (or absent)", `${zeroGmv.length} (${videos.length ? Math.round((zeroGmv.length / videos.length) * 100) : 0}%)`],
          ["videos with `attributed_gmv` = 0 (or absent)", zeroAttr.length],
          ["videos with `items_sold` = 0", videos.filter((v) => toNum(v.items_sold) === 0).length],
        ]),
        "",
        truncated || videos.length < reported
          ? `_Only the first ${videos.length} of ${reported} videos in this ordering were read (${MAX_PAGES}-page cap${videos.length < reported && !truncated ? " or a paging error" : ""}), so the zero-GMV share and view percentiles describe the start of the list, not all videos._`
          : "_Every video in the window was read._",
        "",
        table(DIST_HEAD, [
          distRow("views", views),
          distRow("gmv.amount", videos.map(gmvOf)),
        ]),
        "",
        zeroGmv.length
          ? "Non-selling videos **are** included in the list."
          : videos.length
            ? "No zero-GMV videos in what was read: the list may only contain videos with sales."
            : "No videos returned.",
        "",
      );

      // ---- Identity ----
      if (chosen) md.push(
        "### Videos: creator identity",
        "",
        table(["measure", "value"], [
          ...identityRows(creators, openIds, ctx),
          ["videos with non-empty creator.open_id", videos.filter((v) => String(v?.creator?.open_id ?? "") !== "").length],
          ["videos where `username` ≠ `creator.user_name` (normalised)", videos.filter((v) => normUser(v?.username) !== normUser(v?.creator?.user_name)).length],
        ]),
        "",
      );

      // ---- Posting vs selling ----
      if (!chosen) {
        // nothing was read
      } else if (ctx.affiliateUsernames?.size) {
        const noSales = [...creators].filter((u) => !ctx.affiliateUsernames!.has(u));
        md.push(
          "### Videos: posting vs selling",
          "",
          `Of **${creators.size}** distinct video creators, **${noSales.length}** have no affiliate order line in the affiliate section's last-30-day data. (The video window is ${pageDays} days against 30 for orders, and only the first ${videos.length} videos in the ${chosen.p.sort ?? "gmv"} ordering were read, so treat this as an upper bound.)`,
          "",
        );
      } else {
        md.push("### Videos: posting vs selling", "", "_Skipped: the affiliate section did not run (or returned no creators) in this invocation. Run everything, or `affiliate` then `analytics`, in one go._", "");
      }

      // ---- Field inventory ----
      md.push("### Videos: fields seen", "", videos.length ? inventoryMd(videos, VIDEO_EXPECTED) : "_No videos read._", "");
      if (retryNotes.length) md.push("### Videos: paging retries", "", ...retryNotes.map((n) => `- ${n}`), "");

      // ---- History depth ----
      md.push(
        "### Videos: history depth",
        "",
        `${winDays}-day windows, newest first, \`AFFILIATE_ACCOUNTS\`, \`page_size=1\`, \`total_count\` only. Floor ${ymd(HISTORY_FLOOR)}.`,
        "",
      );
      const rows: (string | number)[][] = [];
      let earliest = "none found";
      let emptyRun = 0;
      let stopped = "";
      for (let end = todaySec; end > HISTORY_FLOOR && emptyRun < 2; ) {
        const start = Math.max(end - winDays * DAY, HISTORY_FLOOR);
        try {
          const { data } = await videoCall("AFFILIATE_ACCOUNTS", start, end, 1);
          const total = totalOf(data, videoList(data));
          rows.push([`${ymd(start)} → ${ymd(end)}`, total]);
          if (total > 0) {
            earliest = ymd(start);
            emptyRun = 0;
          } else emptyRun++;
        } catch (e) {
          if (!(e instanceof TikTokApiError)) throw e;
          errors.push(`videos history ${ymd(start)} → ${ymd(end)}: ${e.message}`);
          stopped = `Stopped at ${ymd(start)} → ${ymd(end)}: code ${e.code ?? "-"} "${e.message}"${e.code === BAD_DATE_CODE ? " (date likely too old or invalid)" : ""}.`;
          break;
        }
        end = start;
      }
      md.push(rows.length ? table(["window", "total_count"], rows) : "_No windows read._", "");
      md.push(`Earliest window with data starts: **${earliest}**.`, "");
      if (stopped) md.push(stopped, "");
      else if (emptyRun >= 2) md.push("Stopped after two consecutive empty windows.", "");
      else md.push(`Reached ${ymd(HISTORY_FLOOR)}.`, "");

      // ---- Views semantics (uses the probed window, page size and sort) ----
      if (chosen) {
        md.push("### Videos: are `views` per window or cumulative?", "");
        const thisWin = new Map(videos.map((v) => [String(v.id), v]));
        const curStart = todaySec - pageDays * DAY;
        const prevStart = todaySec - 2 * pageDays * DAY;
        const prevEnd = curStart;
        const both: { prev: any; cur: any }[] = [];
        let prevToken: string | undefined;
        let prevPages = 0;
        for (; prevPages < 3 && both.length < 3; ) {
          const extra: Query = pageExtra();
          if (prevToken) extra.push(["page_token", prevToken]);
          const r = await pageRetry(`earlier-window page ${prevPages + 1}`, prevPages > 0, retryNotes, () =>
            videoCall("AFFILIATE_ACCOUNTS", prevStart, prevEnd, pageSize, extra),
          );
          if (r instanceof TikTokApiError) {
            errors.push(`videos earlier window, page ${prevPages + 1}: ${r.message}`);
            break;
          }
          prevPages++;
          for (const pv of videoList(r.data)) {
            const cur = thisWin.get(String(pv.id));
            if (cur && both.length < 3) both.push({ prev: pv, cur });
          }
          prevToken = r.data?.next_page_token || undefined;
          if (!prevToken) break;
        }
        if (both.length) {
          md.push(
            `Videos found in both ${ymd(prevStart)} → ${ymd(prevEnd)} and ${ymd(curStart)} → ${ymd(todaySec)} (the earlier window's first ${prevPages * pageSize} videos in the same ordering, matched on video ID):`,
            "",
            table(
              ["video id", "creator", "video_post_time", `views ${ymd(prevStart)}→${ymd(prevEnd)}`, `views ${ymd(curStart)}→${ymd(todaySec)}`],
              both.map(({ prev, cur }) => [String(prev.id), nameOf(prev), prev.video_post_time ?? "(absent)", toNum(prev.views), toNum(cur.views)]),
            ),
            "",
            "If the two numbers differ and neither looks like a running total of the other, views are per window and need summing across windows. If the later window is always ≥ the earlier one for videos posted before both, they are cumulative.",
            "",
          );
        } else {
          md.push(`_No video from the earlier window's first ${prevPages * pageSize} also appears in the latest window's list, so this could not be tested._`, "");
        }
        const older = videos.filter((v) => Date.parse(String(v.video_post_time ?? "").replace(" ", "T") + "Z") < curStart * 1000);
        md.push(
          `Of the ${videos.length} videos read for the latest window, **${older.length}** were posted before the window started (${ymd(curStart)}), and **${older.filter((v) => toNum(v.views) > 0).length}** of those still show views > 0. Views therefore count activity in the window, not only on the post date.`,
          "",
        );
      }
    } catch (e) {
      if (!(e instanceof TikTokApiError)) throw e;
      errors.push(`videos: ${e.message}`);
      md.push(`_Videos part stopped on an error: ${e.message}_`, "");
    }
  }

  // ==== Lives ====
  md.push("### Lives: access check", "");
  let liveOk = false;
  try {
    await liveCall(todaySec - 30 * DAY, todaySec, 1);
    liveOk = true;
    md.push("Access works: last 30 days, `AFFILIATE_ACCOUNTS`, `page_size=1` returned code 0.", "");
  } catch (e) {
    if (!(e instanceof TikTokApiError)) throw e;
    errors.push(`lives access check: ${e.message}`);
    md.push(...accessFailure("Get Shop LIVE Performance List", e));
  }

  if (liveOk) {
    try {
      const lives: any[] = [];
      let pages = 0;
      let token: string | undefined;
      let reported = 0;
      const lStart = todaySec - winDays * DAY;
      const liveRetries: string[] = [];
      do {
        const extra: Query = token ? [["page_token", token]] : [];
        const r = await pageRetry(`lives page ${pages + 1}`, pages > 0, liveRetries, () => liveCall(lStart, todaySec, PAGE_SIZE, extra));
        if (r instanceof TikTokApiError) {
          errors.push(`lives paging, page ${pages + 1}: ${r.message}`);
          liveRetries.push(`Paging stopped at page ${pages + 1}; continuing with the ${lives.length} sessions read so far.`);
          break;
        }
        reported ||= totalOf(r.data, []);
        lives.push(...liveList(r.data));
        token = r.data?.next_page_token || undefined;
        pages++;
      } while (token && pages < MAX_PAGES);
      if (liveRetries.length) md.push("### Lives: paging retries", "", ...liveRetries.map((n) => `- ${n}`), "");
      examples.push(...lives.slice(0, 1));

      const nameOf = (s: any) => normUser(s?.creator?.user_name);
      const creators = new Set(lives.map(nameOf).filter(Boolean));
      const openIds = new Set(lives.map((s) => String(s?.creator?.open_id ?? "")).filter(Boolean));
      const gmv = (s: any) => amountOf(at(s, "sales_performance.live_attributed_gmv")) ?? 0;

      md.push(
        `### Lives: AFFILIATE_ACCOUNTS, ${ymd(lStart)} → ${ymd(todaySec)}`,
        "",
        table(["measure", "value"], [
          ["pages fetched (page_size 100, cap 20)", pages],
          ["API `total_count`", reported],
          ["sessions read", lives.length],
          ["distinct creators", creators.size],
          ["sessions with zero (or absent) `live_attributed_gmv`", `${lives.filter((s) => gmv(s) === 0).length} (${lives.length ? Math.round((lives.filter((s) => gmv(s) === 0).length / lives.length) * 100) : 0}%)`],
        ]),
        "",
        token !== undefined || lives.length < reported
          ? `_Only ${lives.length} of ${reported} sessions were read (20-page cap; sorted by attributed GMV DESC), so the percentiles describe the top of the distribution._`
          : "_Every session in the window was read._",
        "",
        table(DIST_HEAD, [
          distRow("traffic.views", lives.map((s) => toNum(at(s, "traffic.views")))),
          distRow("traffic.viewers", lives.map((s) => toNum(at(s, "traffic.viewers")))),
          distRow("sales_performance.live_attributed_gmv", lives.map(gmv)),
        ]),
        "",
        lives.some((s) => gmv(s) === 0) ? "Sessions with zero attributed GMV **do** appear." : lives.length ? "No zero-GMV sessions in what was read." : "No sessions returned.",
        "",
        "**Creator identity**",
        "",
        table(["measure", "value"], identityRows(creators, openIds, ctx)),
        "",
        "**Fields seen**",
        "",
        lives.length ? inventoryMd(lives, LIVE_EXPECTED) : "_No sessions._",
        "",
      );

      // ---- History depth ----
      md.push("### Lives: history depth", "", `The doc states no maximum range, so first try one call for ${ymd(HISTORY_FLOOR)} → ${ymd(todaySec)} (\`page_size=1\`, \`total_count\` only).`, "");
      let fullRange: number | undefined;
      try {
        const { data } = await liveCall(HISTORY_FLOOR, todaySec, 1);
        fullRange = totalOf(data, liveList(data));
        md.push(`Accepted. \`total_count\` for the full range: **${fullRange}**.`, "");
      } catch (e) {
        if (!(e instanceof TikTokApiError)) throw e;
        md.push(`Rejected: code ${e.code ?? "-"} "${e.message}" (HTTP ${e.httpStatus ?? "-"}, request ID ${e.requestId ?? "-"}). Walking back in ${winDays}-day windows instead.`, "");
        const rows: (string | number)[][] = [];
        let earliest = "none found";
        let emptyRun = 0;
        let stopped = "";
        for (let end = todaySec; end > HISTORY_FLOOR && emptyRun < 2; ) {
          const start = Math.max(end - winDays * DAY, HISTORY_FLOOR);
          try {
            const { data } = await liveCall(start, end, 1);
            const total = totalOf(data, liveList(data));
            rows.push([`${ymd(start)} → ${ymd(end)}`, total]);
            if (total > 0) {
              earliest = ymd(start);
              emptyRun = 0;
            } else emptyRun++;
          } catch (e2) {
            if (!(e2 instanceof TikTokApiError)) throw e2;
            errors.push(`lives history ${ymd(start)} → ${ymd(end)}: ${e2.message}`);
            stopped = `Stopped at ${ymd(start)} → ${ymd(end)}: code ${e2.code ?? "-"} "${e2.message}"${e2.code === BAD_DATE_CODE ? " (date likely too old or invalid)" : ""}.`;
            break;
          }
          end = start;
        }
        md.push(rows.length ? table(["window", "total_count"], rows) : "_No windows read._", "");
        md.push(`Earliest window with data starts: **${earliest}**.`, "");
        if (stopped) md.push(stopped, "");
        else if (emptyRun >= 2) md.push("Stopped after two consecutive empty windows.", "");
        else md.push(`Reached ${ymd(HISTORY_FLOOR)}.`, "");
      }
    } catch (e) {
      if (!(e instanceof TikTokApiError)) throw e;
      errors.push(`lives: ${e.message}`);
      md.push(`_Lives part stopped on an error: ${e.message}_`, "");
    }
  }

  if (errors.length) {
    log("  analytics: stopped with errors");
    md.push("### Errors", "", ...errors.map((e) => `- ${e}`), "");
  }
  return { md: md.join("\n"), samples: examples };
};
