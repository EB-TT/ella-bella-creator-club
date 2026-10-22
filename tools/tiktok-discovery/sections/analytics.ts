// Section 6: Shop analytics (needs scope data.shop_analytics.public.read). Get Shop Video
// Performance List and Get Shop LIVE Performance List, for tiers that qualify on views:
// is access granted, how many videos/lives, do non-selling ones appear, how far back does
// data go, are `views` per window or cumulative, and do video creators match the
// affiliate/sample creators from earlier sections in the same run.

import { TikTokApiError, type Client, type Query } from "../tiktok.ts";
import { amountOf, inventoryMd, listItems, normUser, table, toNum, log } from "../util.ts";
import type { Ctx, Section } from "./types.ts";

const VIDEO_PATH = "/analytics/202605/shop_videos/performance";
const LIVE_PATH = "/analytics/202609/shop_lives/performance";
const DAY = 86_400;
const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const HISTORY_FLOOR = Date.UTC(2024, 1, 1) / 1000;
const ACCOUNT_TYPES = ["ALL", "AFFILIATE_ACCOUNTS", "OFFICIAL_ACCOUNTS", "MARKETING_ACCOUNTS"];
const BAD_DATE_CODE = 28001022;

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

      // ---- Zero-sale videos + views distribution (AFFILIATE_ACCOUNTS, sorted by views) ----
      const videos: any[] = [];
      let pages = 0;
      let token: string | undefined;
      let reported = 0;
      do {
        const extra: Query = [["sort_field", "views"], ["sort_order", "DESC"]];
        if (token) extra.push(["page_token", token]);
        const { data } = await videoCall("AFFILIATE_ACCOUNTS", ...win(), PAGE_SIZE, extra);
        reported ||= totalOf(data, []);
        videos.push(...videoList(data));
        token = data?.next_page_token || undefined;
        pages++;
      } while (token && pages < MAX_PAGES);
      examples.push(...videos.slice(0, 2));

      const gmvOf = (v: any) => amountOf(v?.gmv) ?? 0;
      const views = videos.map((v) => toNum(v.views));
      const zeroGmv = videos.filter((v) => gmvOf(v) === 0);
      const zeroAttr = videos.filter((v) => (amountOf(v?.attributed_gmv) ?? 0) === 0);
      const nameOf = (v: any) => normUser(v?.creator?.user_name ?? v?.username);
      const creators = new Set(videos.map(nameOf).filter(Boolean));
      const openIds = new Set(videos.map((v) => String(v?.creator?.open_id ?? "")).filter(Boolean));
      const truncated = token !== undefined;

      md.push(
        `### Videos: AFFILIATE_ACCOUNTS, last ${winDays} days, sorted by views DESC`,
        "",
        table(["measure", "value"], [
          ["pages fetched (page_size 100, cap 20)", pages],
          ["API `total_count`", reported],
          ["videos read", videos.length],
          ["videos with `gmv` = 0 (or absent)", `${zeroGmv.length} (${videos.length ? Math.round((zeroGmv.length / videos.length) * 100) : 0}%)`],
          ["videos with `attributed_gmv` = 0 (or absent)", zeroAttr.length],
          ["videos with `items_sold` = 0", videos.filter((v) => toNum(v.items_sold) === 0).length],
        ]),
        "",
        truncated || videos.length < reported
          ? `_Only the top ${videos.length} of ${reported} videos by views were read (20-page cap), so the zero-GMV share and view percentiles describe the top of the distribution, not all videos._`
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
      md.push(
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
      if (ctx.affiliateUsernames?.size) {
        const noSales = [...creators].filter((u) => !ctx.affiliateUsernames!.has(u));
        md.push(
          "### Videos: posting vs selling",
          "",
          `Of **${creators.size}** distinct video creators, **${noSales.length}** have no affiliate order line in the affiliate section's last-30-day data. (The video window is ${winDays} days against 30 for orders, and only the top ${videos.length} videos by views were read, so treat this as an upper bound.)`,
          "",
        );
      } else {
        md.push("### Videos: posting vs selling", "", "_Skipped: the affiliate section did not run (or returned no creators) in this invocation. Run everything, or `affiliate` then `analytics`, in one go._", "");
      }

      // ---- Field inventory ----
      md.push("### Videos: fields seen", "", videos.length ? inventoryMd(videos, VIDEO_EXPECTED) : "_No videos._", "");

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

      // ---- Views semantics ----
      md.push("### Videos: are `views` per window or cumulative?", "");
      const thisWin = new Map(videos.map((v) => [String(v.id), v]));
      const prevStart = todaySec - 2 * winDays * DAY;
      const prevEnd = todaySec - winDays * DAY;
      const both: { prev: any; cur: any }[] = [];
      let prevToken: string | undefined;
      for (let p = 0; p < 3 && both.length < 3; p++) {
        const extra: Query = [["sort_field", "views"], ["sort_order", "DESC"]];
        if (prevToken) extra.push(["page_token", prevToken]);
        const { data } = await videoCall("AFFILIATE_ACCOUNTS", prevStart, prevEnd, PAGE_SIZE, extra);
        for (const pv of videoList(data)) {
          const cur = thisWin.get(String(pv.id));
          if (cur && both.length < 3) both.push({ prev: pv, cur });
        }
        prevToken = data?.next_page_token || undefined;
        if (!prevToken) break;
      }
      if (both.length) {
        md.push(
          `Videos found in both ${ymd(prevStart)} → ${ymd(prevEnd)} and ${ymd(todaySec - winDays * DAY)} → ${ymd(todaySec)} (the earlier window's top videos by views, matched on video ID):`,
          "",
          table(
            ["video id", "creator", "video_post_time", `views ${ymd(prevStart)}→${ymd(prevEnd)}`, `views ${ymd(todaySec - winDays * DAY)}→${ymd(todaySec)}`],
            both.map(({ prev, cur }) => [String(prev.id), nameOf(prev), prev.video_post_time ?? "(absent)", toNum(prev.views), toNum(cur.views)]),
          ),
          "",
          "If the two numbers differ and neither looks like a running total of the other, views are per window and need summing across windows. If the later window is always ≥ the earlier one for videos posted before both, they are cumulative.",
          "",
        );
      } else {
        md.push("_No video from the earlier window's top 300 by views also appears in the latest window's list, so this could not be tested._", "");
      }
      const winStart = todaySec - winDays * DAY;
      const older = videos.filter((v) => Date.parse(String(v.video_post_time ?? "").replace(" ", "T") + "Z") < winStart * 1000);
      md.push(
        `Of the ${videos.length} videos read for the latest window, **${older.length}** were posted before the window started (${ymd(winStart)}), and **${older.filter((v) => toNum(v.views) > 0).length}** of those still show views > 0. Views therefore count activity in the window, not only on the post date.`,
        "",
      );
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
      do {
        const extra: Query = token ? [["page_token", token]] : [];
        const { data } = await liveCall(lStart, todaySec, PAGE_SIZE, extra);
        reported ||= totalOf(data, []);
        lives.push(...liveList(data));
        token = data?.next_page_token || undefined;
        pages++;
      } while (token && pages < MAX_PAGES);
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
