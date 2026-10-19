// Section 2: Search Sample Applications. Volume, status mix, creator identity
// (username vs open ID), which creator-stat fields are actually populated, and
// what `order_id` holds per status. Keeps sample order IDs and product IDs in
// ctx for the next sections.

import { TikTokApiError, type Client } from "../tiktok.ts";
import {
  count, distTable, inventoryMd, isEmpty, listItems, normUser, orderIdKind, table, toNum,
} from "../util.ts";
import type { Section } from "./types.ts";

const PATH = "/affiliate_seller/202508/sample_applications/search";
const PAGE_SIZE = 50;
const FULL_SCAN_LIMIT = 3000;
const PAGE_CAP = 60;
// Statuses whose applications should have a real sample order behind them.
const SHIPPED_PLUS = ["SHIPPED", "CONTENT_PENDING", "COMPLETED"];
const WANT_ORDER_IDS = 10;
const TOPUP_PAGES_PER_STATUS = 5;

// docs/tiktok-api/Search Sample Applications.md, `status` request filter.
const STATUSES = [
  "PENDING", "AWAITING_SHIPMENT", "SHIPPED", "CONTENT_PENDING", "REJECT_CANCELLED", "OVERDUE_CANCELLED",
  "UNFULFILL_CANCELLED", "DEL_OPEN_COLLAB", "SELLER_NOT_SHIP_CANCELLED", "WITHDRAW_CANCELLED",
  "UNFULFILLABLE_CANCELLED", "OPS_CANCELLED", "OPS_FAILED", "OPS_COMPLETED", "COMPLETED",
];

const STATS = ["creator.gmv.amount", "creator.content_count", "creator.fulfillment_percentage", "creator.ec_video_view"];
// Documented leaf paths, for the field-inventory check.
const EXPECTED = [
  "id", "commission_rate", "status", "order_id", "fulfillment_status", "tracking_number",
  "creator.creator_open_id", "creator.username", "creator.nickname", "creator.follower_count",
  "creator.gmv.amount", "creator.gmv.currency", "creator.content_count", "creator.fulfillment_percentage",
  "creator.ec_video_view", "product.id", "product.title", "product.sku_id",
];

function search(client: Client, query: [string, string][], body: object) {
  return client.request({ method: "POST", path: PATH, query, body });
}

const at = (o: any, path: string) => path.split(".").reduce((v, k) => (v == null ? undefined : v[k]), o);

export const samples: Section = async (client, ctx) => {
  const md: string[] = [];
  const errors: string[] = [];
  const apps: any[] = [];
  let total: number | undefined;
  let pages = 0;
  let capped = false;

  try {
    let token: string | undefined;
    do {
      const query: [string, string][] = [["page_size", String(PAGE_SIZE)]];
      if (token) query.push(["page_token", token]);
      const { data } = await search(client, query, {});
      if (total === undefined) total = toNum(data?.total_count);
      apps.push(...listItems(data));
      token = data?.next_page_token || undefined;
      pages++;
      if (token && (total > FULL_SCAN_LIMIT ? pages >= PAGE_CAP : false)) {
        capped = true;
        break;
      }
    } while (token);
  } catch (e) {
    if (!(e instanceof TikTokApiError)) throw e;
    errors.push(e.message);
  }

  const username = (a: any) => normUser(a?.creator?.username);
  const openId = (a: any): string => String(a?.creator?.creator_open_id ?? "");
  const statusOf = (a: any) => String(a?.status ?? "(empty)");

  const usernames = new Set(apps.map(username).filter(Boolean));
  const openIds = new Set(apps.map(openId).filter(Boolean));
  ctx.sampleUsernames = usernames;
  ctx.samplesRan = true;

  // ---- Products (product.id / product.title) ----
  const productCount = new Map<string, number>();
  const productTitle = new Map<string, string>();
  for (const a of apps) {
    const id = a?.product?.id;
    if (isEmpty(id)) continue;
    productCount.set(String(id), (productCount.get(String(id)) ?? 0) + 1);
    if (!productTitle.has(String(id)) && !isEmpty(a.product.title)) productTitle.set(String(id), String(a.product.title));
  }
  const productsRanked = [...productCount.entries()].sort((a, b) => b[1] - a[1]);
  ctx.productIds = productsRanked.map(([id]) => id);

  // ---- order_id by status ----
  type Kinds = { empty: number; zero: number; real: number; other: number; examples: string[] };
  const byStatus = new Map<string, Kinds>();
  for (const a of apps) {
    const s = statusOf(a);
    const k = byStatus.get(s) ?? { empty: 0, zero: 0, real: 0, other: 0, examples: [] };
    const kind = orderIdKind(a.order_id);
    k[kind]++;
    const shown = JSON.stringify(a.order_id ?? null);
    // Examples: prefer real IDs, but show the odd values too since they're the point.
    if (k.examples.length < 2 && !k.examples.includes(shown) && (kind === "real" || k.examples.length === 0)) k.examples.push(shown);
    byStatus.set(s, k);
  }
  const realIds = new Set<string>();
  const pool = new Map<string, string>(); // orderId -> status, SHIPPED+ only
  for (const a of apps) {
    if (orderIdKind(a.order_id) !== "real") continue;
    realIds.add(String(a.order_id));
    if (SHIPPED_PLUS.includes(statusOf(a))) pool.set(String(a.order_id), statusOf(a));
  }

  // ---- Real volume per status (page_size=1, total_count only) ----
  const volume: (string | number)[][] = [];
  let volumeSum = 0;
  let volumeFailures = 0;
  for (const status of STATUSES) {
    try {
      const { data } = await search(client, [["page_size", "1"]], { status });
      const n = toNum(data?.total_count);
      volumeSum += n;
      volume.push([status, n]);
    } catch (e) {
      if (!(e instanceof TikTokApiError)) throw e;
      errors.push(`status filter ${status}: ${e.message}`);
      volume.push([status, "error"]);
      if (++volumeFailures >= 3) break;
    }
  }

  // ---- Top up SHIPPED+ order IDs with the status filter if the first read had too few ----
  let toppedUp = 0;
  for (const status of SHIPPED_PLUS) {
    if (pool.size >= WANT_ORDER_IDS) break;
    try {
      let token: string | undefined;
      for (let p = 0; p < TOPUP_PAGES_PER_STATUS && pool.size < WANT_ORDER_IDS; p++) {
        const query: [string, string][] = [["page_size", String(PAGE_SIZE)]];
        if (token) query.push(["page_token", token]);
        const { data } = await search(client, query, { status });
        for (const a of listItems(data)) {
          if (orderIdKind(a.order_id) !== "real") continue;
          realIds.add(String(a.order_id));
          if (!pool.has(String(a.order_id))) toppedUp++;
          pool.set(String(a.order_id), status);
        }
        token = data?.next_page_token || undefined;
        if (!token) break;
      }
    } catch (e) {
      if (!(e instanceof TikTokApiError)) throw e;
      errors.push(`top-up (${status}): ${e.message}`);
      break;
    }
  }
  ctx.sampleOrders = [...pool.entries()].map(([orderId, status]) => ({ orderId, status }));
  ctx.sampleOrderIds = realIds;

  md.push(
    table(["measure", "value"], [
      ["API `total_count` (unfiltered)", String(total ?? "(absent)")],
      ["pages fetched", pages],
      ["applications read", apps.length],
      ["applications with a real-looking `order_id`", apps.filter((a) => orderIdKind(a.order_id) === "real").length],
      ["distinct creators by username", usernames.size],
      ["distinct creators by open ID", openIds.size],
      ["distinct products (`product.id`)", productCount.size],
      ["SHIPPED / CONTENT_PENDING / COMPLETED order IDs available for order-detail tests", `${pool.size} (${toppedUp} fetched via status filter)`],
    ]),
    "",
  );
  if (capped) md.push(`**Not a full scan:** unfiltered total_count is ${total}, so reading stopped at ${PAGE_CAP} pages (${apps.length} applications).`, "");

  md.push("**status** (applications read)", "", distTable("status", count(apps, statusOf)), "");
  const unknownStatuses = [...new Set(apps.map(statusOf))].filter((s) => !STATUSES.includes(s));
  if (unknownStatuses.length) md.push(`Statuses seen that are not in the documented list: ${unknownStatuses.map((s) => `\`${s}\``).join(", ")}`, "");
  md.push("**fulfillment_status**", "", distTable("fulfillment_status", count(apps, (a) => a?.fulfillment_status)), "");

  // Real volume.
  md.push(
    "### Real volume per status",
    "",
    "One search per documented `status` value with `page_size=1`, reading `total_count`.",
    "",
    table(["status", "total_count"], volume),
    "",
  );
  if (volumeFailures < 3) {
    const cappedStatuses = volume.filter((r) => r[1] === 9999).map((r) => r[0]);
    const verdict =
      total === 9999 && volumeSum !== 9999
        ? `**Yes, 9999 was a cap.** The per-status counts sum to ${volumeSum}.`
        : total === volumeSum
          ? `No: the per-status counts sum to ${volumeSum}, the same as the unfiltered total_count.`
          : `The per-status counts sum to ${volumeSum} against an unfiltered total_count of ${total}; not an exact 9999 cap, but the two disagree.`;
    md.push(`Sum of per-status counts: **${volumeSum}**. ${verdict}`, "");
    if (cappedStatuses.length) md.push(`Per-status counts of exactly 9999 (possibly capped themselves): ${cappedStatuses.join(", ")}`, "");
  } else md.push("Per-status counting stopped after 3 errors (see Errors); the sum is incomplete.", "");

  // order_id by status.
  md.push(
    "### `order_id` by status",
    "",
    "empty = missing / null / blank; \"0\" = all zeros; real = 10+ digits; other = anything else. Order IDs aren't sensitive.",
    "",
    table(
      ["status", "empty", "\"0\"", "real-looking", "other", "example values (JSON)"],
      [...byStatus.entries()].sort().map(([s, k]) => [s, k.empty, k.zero, k.real, k.other, k.examples.join(", ")]),
    ),
    "",
  );

  // Products.
  md.push(
    `### Products (${productCount.size} distinct)`,
    "",
    table(
      ["product id", "title", "applications"],
      productsRanked.slice(0, 20).map(([id, n]) => [id, (productTitle.get(id) ?? "(no title)").slice(0, 60), n]),
    ),
    productsRanked.length > 20 ? `\n_${productsRanked.length - 20} more products not shown._\n` : "",
  );

  // Identity checks.
  if (usernames.size) {
    const matchLine = (set?: Set<string>) =>
      set ? `${[...usernames].filter((u) => set.has(u)).length} of ${usernames.size}` : "n/a (affiliate section was not run in this invocation)";
    md.push(`Sample creators whose username exactly matches an affiliate-order \`creator_username\` (normalised): **${matchLine(ctx.affiliateUsernames)}**`, "");
  }
  const namesByOpenId = new Map<string, Set<string>>();
  const idsByName = new Map<string, Set<string>>();
  for (const a of apps) {
    const u = username(a);
    const o = openId(a);
    if (!u || !o) continue;
    namesByOpenId.set(o, (namesByOpenId.get(o) ?? new Set()).add(u));
    idsByName.set(u, (idsByName.get(u) ?? new Set()).add(o));
  }
  const multiName = [...namesByOpenId.values()].filter((s) => s.size > 1);
  const multiId = [...idsByName.entries()].filter(([, s]) => s.size > 1);
  md.push(
    `Open IDs seen with more than one username: **${multiName.length}**${multiName.length ? " (" + multiName.slice(0, 5).map((s) => [...s].join(" / ")).join("; ") + ")" : ""}`,
    "",
    `Usernames seen with more than one open ID: **${multiId.length}**`,
    "",
  );

  // Creator-stat population.
  const statRows = STATS.map((k) => {
    const vals = apps.map((a) => at(a, k));
    const populated = vals.filter((v) => !isEmpty(v));
    const zero = populated.filter((v) => toNum(v) === 0 && (typeof v !== "string" || /^\s*0+(\.0+)?\s*$/.test(v))).length;
    return [k, `${populated.length}/${apps.length}`, apps.length - populated.length, zero];
  });
  md.push("**Creator-stat fields**", "", table(["field", "populated", "empty", "populated but zero"], statRows), "");
  const cc = apps.map((a) => at(a, "creator.content_count"));
  const ccZero = cc.filter((v) => !isEmpty(v) && toNum(v) === 0).length;
  md.push(
    apps.length && ccZero === apps.length
      ? `\`creator.content_count\` is 0 on **every** application read (${apps.length}), so it looks unusable.`
      : `\`creator.content_count\` is 0 on ${ccZero} of ${apps.length} applications; non-zero on ${cc.filter((v) => !isEmpty(v) && toNum(v) > 0).length}.`,
    "",
  );

  md.push("### Fields seen in the response", "", apps.length ? inventoryMd(apps, EXPECTED) : "_No applications._", "");
  if (errors.length) md.push("### Errors", "", ...errors.map((e) => `- ${e}`), "");
  return { md: md.join("\n"), samples: apps.slice(0, 3) };
};
