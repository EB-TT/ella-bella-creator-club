// Section 3: Get Order Detail for a handful of sample orders. The docs
// (Get Order Detail.md) say `ids` is a comma-separated query list, max 50.
// Tries the documented form first, then older/alternative forms, stopping at the
// first that returns orders. If none do, falls back to Get Order List.
//
// Only shipping/delivery timing fields are kept; everything else in an order
// (address, buyer, payment) is dropped as soon as the response is read.

import { TikTokApiError, type Client, type Query } from "../tiktok.ts";
import { count, distTable, iso, listItems, table, toNum } from "../util.ts";
import type { Ctx, Section } from "./types.ts";

const PRIORITY = ["SHIPPED", "CONTENT_PENDING", "COMPLETED"];
const KEEP = ["is_sample_order", "status", "create_time", "rts_time", "collection_time", "delivery_time", "update_time"] as const;
const LIST_KEEP = ["id", ...KEEP] as const;
const LIST_PATH = "/order/202309/orders/search";
const DAY = 86_400;
const LIST_PAGES = 10;

type Kept = Record<string, unknown>;

const comma = (ids: string[]): Query => [["ids", ids.join(",")]];
const json = (ids: string[]): Query => [["ids", JSON.stringify(ids)]];

const ATTEMPTS: { version: string; encoding: string; build: (ids: string[]) => Query; n: number }[] = [
  { version: "202507", encoding: "comma-separated", build: comma, n: 1 },
  { version: "202507", encoding: "comma-separated", build: comma, n: 10 },
  { version: "202309", encoding: "comma-separated", build: comma, n: 1 },
  { version: "202309", encoding: "comma-separated", build: comma, n: 10 },
  { version: "202309", encoding: "JSON array string", build: json, n: 1 },
  { version: "202309", encoding: "JSON array string", build: json, n: 10 },
];

/** Up to 10 order IDs, round-robin across the preferred statuses. */
function pickOrders(all: { orderId: string; status: string }[]): string[] {
  const buckets = PRIORITY.map((s) => all.filter((o) => o.status === s));
  const picked: string[] = [];
  for (let i = 0; picked.length < 10 && buckets.some((b) => i < b.length); i++) {
    for (const b of buckets) if (i < b.length && picked.length < 10 && !picked.includes(b[i].orderId)) picked.push(b[i].orderId);
  }
  return picked;
}

const pick = (o: any, keys: readonly string[]): Kept => Object.fromEntries(keys.map((k) => [k, o?.[k]]));
const has = (v: unknown) => toNum(v) > 0;

function timingShares(kept: Kept[]) {
  const n = kept.length;
  return table(["share of orders", "count"], [
    ["is_sample_order = true", `${kept.filter((o) => o.is_sample_order === true).length}/${n}`],
    ["have rts_time", `${kept.filter((o) => has(o.rts_time)).length}/${n}`],
    ["have collection_time", `${kept.filter((o) => has(o.collection_time)).length}/${n}`],
    ["have a ship time (rts_time or collection_time)", `${kept.filter((o) => has(o.rts_time) || has(o.collection_time)).length}/${n}`],
    ["have delivery_time", `${kept.filter((o) => has(o.delivery_time)).length}/${n}`],
  ]);
}

/** Fallback: Get Order List by update time. Only counts and the allow-listed fields survive each page. */
async function orderListFallback(client: Client, ctx: Ctx, md: string[], errors: string[]): Promise<Kept[]> {
  md.push("### Fallback: Get Order List (last 30 days by `update_time_ge`)", "");
  const now = Math.floor(Date.now() / 1000);
  const sampleOrders: Kept[] = [];
  let read = 0;
  let pages = 0;
  let total: unknown;
  let more = false;
  try {
    let token: string | undefined;
    do {
      const query: Query = [["page_size", "100"]];
      if (token) query.push(["page_token", token]);
      const { data } = await client.request({ method: "POST", path: LIST_PATH, query, body: { update_time_ge: now - 30 * DAY } });
      total ??= data?.total_count;
      // Reduce immediately; the raw page (buyer data) is not kept anywhere.
      for (const o of listItems(data)) {
        read++;
        if (o?.is_sample_order === true) sampleOrders.push(pick(o, LIST_KEEP));
      }
      token = data?.next_page_token || undefined;
      pages++;
      more = Boolean(token);
    } while (token && pages < LIST_PAGES);
  } catch (e) {
    if (!(e instanceof TikTokApiError)) throw e;
    errors.push(e.message);
  }

  const appIds = ctx.sampleOrderIds ?? new Set<string>();
  const matched = sampleOrders.filter((o) => appIds.has(String(o.id))).length;
  md.push(
    table(["measure", "value"], [
      ["pages fetched", pages],
      ["API `total_count`", String(total ?? "(absent)")],
      ["orders read", read],
      ["orders with is_sample_order = true", sampleOrders.length],
      ["of those, order ID matches a sample application `order_id`", `${matched}/${sampleOrders.length}`],
      ["real-looking sample application order IDs available to match against", appIds.size],
    ]),
    "",
  );
  if (more) md.push(`Stopped at ${LIST_PAGES} pages; the 30-day window is incomplete.`, "");
  if (sampleOrders.length) {
    md.push("**is_sample_order orders: status**", "", distTable("status", count(sampleOrders, (o) => o.status)), "");
    md.push(timingShares(sampleOrders), "");
    md.push(
      "**3 sanitised examples** (allow-listed fields only)",
      "",
      table(
        ["id", "status", "create_time", "rts_time", "collection_time", "delivery_time", "update_time"],
        sampleOrders.slice(0, 3).map((o) => [
          String(o.id), String(o.status ?? ""), iso(o.create_time), iso(o.rts_time), iso(o.collection_time), iso(o.delivery_time), iso(o.update_time),
        ]),
      ),
      "",
    );
  }
  return sampleOrders.slice(0, 3);
}

export const orderdetail: Section = async (client, ctx) => {
  const md: string[] = [];
  const errors: string[] = [];
  const ids = pickOrders(ctx.sampleOrders ?? []);

  const attempts: (string | number)[][] = [];
  let kept: Kept[] = [];
  let worked = "";

  if (!ids.length) {
    md.push("No real-looking order IDs from SHIPPED / CONTENT_PENDING / COMPLETED applications were available, so the Get Order Detail attempts were skipped.", "");
  } else {
    md.push(`${ids.length} real-looking sample order IDs available (statuses: ${PRIORITY.join(", ")}). Docs: \`ids\` is a comma-separated query list, max 50.`, "");
    for (const a of ATTEMPTS) {
      const batch = ids.slice(0, a.n);
      if (batch.length < a.n) {
        attempts.push([a.version, a.encoding, a.n, "skipped", `only ${ids.length} IDs available`]);
        continue;
      }
      const label = `/order/${a.version}/orders`;
      try {
        const { data } = await client.request({ method: "GET", path: label, query: a.build(batch) });
        const orders = listItems(data);
        attempts.push([a.version, a.encoding, a.n, "accepted", `${orders.length} of ${batch.length} orders returned`]);
        if (orders.length > 0) {
          // Keep the allow-listed timing fields only; the rest is dropped here.
          kept = orders.map((o) => pick(o, KEEP));
          worked = `\`${label}\`, ${a.encoding}, ${a.n} ID(s)`;
          break;
        }
      } catch (e) {
        if (!(e instanceof TikTokApiError)) throw e;
        attempts.push([a.version, a.encoding, a.n, "rejected", e.message]);
      }
    }
    md.push("**Get Order Detail attempts**", "", table(["version", "`ids` encoding", "IDs sent", "result", "detail"], attempts), "");
  }

  let examples: Kept[] = [];
  if (worked) {
    md.push(`**Worked:** ${worked}`, "");
    md.push(
      table(
        ["#", "is_sample_order", "status", "create_time", "rts_time", "collection_time", "delivery_time", "update_time"],
        kept.map((o, i) => [
          i + 1, String(o.is_sample_order), String(o.status ?? ""),
          iso(o.create_time), iso(o.rts_time), iso(o.collection_time), iso(o.delivery_time), iso(o.update_time),
        ]),
      ),
      "",
      timingShares(kept),
      "",
    );
    examples = kept;
  } else {
    if (ids.length) md.push("**No Get Order Detail variant returned orders.**", "");
    examples = await orderListFallback(client, ctx, md, errors);
  }
  if (errors.length) md.push("### Errors", "", ...errors.map((e) => `- ${e}`), "");
  return { md: md.join("\n"), samples: examples };
};
