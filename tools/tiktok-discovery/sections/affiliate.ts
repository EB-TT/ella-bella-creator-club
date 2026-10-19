// Section 1: Search Seller Affiliate Orders. Last-30-day aggregation (to compare
// against Seller Center) and a walk back through history to find how far data goes.

import { TikTokApiError, type Client } from "../tiktok.ts";
import {
  count, deepFirst, distTable, inventoryMd, listItems, normUser, table, toNum, iso, log,
} from "../util.ts";
import type { Section } from "./types.ts";

const PATH = "/affiliate_seller/202410/orders/search";
const DAY = 86_400;
const MAX_PAGES = 300;
const HISTORY_FLOOR = Date.UTC(2022, 0, 1) / 1000;

// Line-level fields named in the build plan, used to spot docs/response gaps.
const EXPECTED = [
  "creator_username", "product_id", "sku_id", "quantity", "price", "actual_commission_base",
  "estimated_commission_base", "fully_return", "settlement_status", "content_type", "content_id",
  "currency", "create_time", "delivery_time",
];

function page(client: Client, size: number, ge: number, lt: number, token?: string) {
  const query: [string, string][] = [["page_size", String(size)]];
  if (token) query.push(["page_token", token]);
  return client.request({ method: "POST", path: PATH, query, body: { create_time_ge: ge, create_time_lt: lt } });
}

/** Orders may nest SKU lines under `skus`; flatten to one record per SKU line. */
function toLines(orders: any[]): any[] {
  return orders.flatMap((o) => {
    if (!Array.isArray(o?.skus)) return [o];
    const { skus, ...orderLevel } = o;
    return skus.map((s: any) => ({ ...orderLevel, ...s, order_id: o.order_id ?? o.id ?? s?.order_id }));
  });
}

const money = (n: number) => n.toFixed(2);

export const affiliate: Section = async (client, ctx) => {
  const md: string[] = [];
  const errors: string[] = [];
  const now = Math.floor(Date.now() / 1000);

  // ---- Last 30 days ----
  const orders: any[] = [];
  let pages = 0;
  let reportedTotal: unknown;
  try {
    let token: string | undefined;
    do {
      const { data } = await page(client, 100, now - 30 * DAY, now, token);
      reportedTotal ??= data?.total_count;
      orders.push(...listItems(data));
      token = data?.next_page_token || undefined;
      pages++;
    } while (token && pages < MAX_PAGES);
    if (token) errors.push(`Stopped at ${MAX_PAGES} pages; the last 30 days are incomplete.`);
  } catch (e) {
    if (!(e instanceof TikTokApiError)) throw e;
    errors.push(e.message);
  }

  const lines = toLines(orders);
  const nested = orders.filter((o) => Array.isArray(o?.skus)).length;
  const orderIds = new Set(lines.map((l) => String(l.order_id ?? l.id ?? "")).filter(Boolean));
  const usernames = lines.map((l) => normUser(l.creator_username));
  const distinctCreators = new Set(usernames.filter(Boolean));
  ctx.affiliateUsernames = distinctCreators;

  md.push("### Last 30 days", "");
  md.push(
    table(["measure", "value"], [
      ["pages fetched", pages],
      ["API `total_count` (first page)", String(reportedTotal ?? "(absent)")],
      ["top-level records returned", orders.length],
      ["of which carry a `skus` array", nested],
      ["SKU lines", lines.length],
      ["distinct orders (lines aggregated by order ID)", orderIds.size],
      ["distinct creator_username (normalised)", distinctCreators.size],
      ["lines with empty creator_username", usernames.filter((u) => !u).length],
    ]),
    "",
  );

  const lineField = (l: any, k: string) => l[k] ?? deepFirst(l, [k]);
  md.push("**content_type**", "", distTable("content_type", count(lines, (l) => lineField(l, "content_type"))), "");
  md.push("**fully_return**", "", distTable("fully_return", count(lines, (l) => lineField(l, "fully_return"))), "");
  md.push("**settlement_status**", "", distTable("settlement_status", count(lines, (l) => lineField(l, "settlement_status"))), "");
  md.push("**currency**", "", distTable("currency", count(lines, (l) => lineField(l, "currency"))), "");

  // Top creators by actual commission base (the proposed GMV measure).
  const byCreator = new Map<string, { actual: number; est: number; lines: number; units: number }>();
  for (const l of lines) {
    const u = normUser(l.creator_username) || "(empty)";
    const c = byCreator.get(u) ?? { actual: 0, est: 0, lines: 0, units: 0 };
    c.actual += toNum(l.actual_commission_base);
    c.est += toNum(l.estimated_commission_base);
    c.lines++;
    c.units += toNum(l.quantity);
    byCreator.set(u, c);
  }
  const top = [...byCreator.entries()].sort((a, b) => b[1].actual - a[1].actual).slice(0, 15);
  md.push(
    "**Top 15 creators by summed `actual_commission_base`** (compare with Seller Center affiliate GMV for the same 30 days)",
    "",
    table(
      ["creator", "Σ actual_commission_base", "Σ estimated_commission_base", "lines", "units"],
      top.map(([u, c]) => [u, money(c.actual), money(c.est), c.lines, c.units]),
    ),
    "",
  );

  md.push("### Fields seen in the response (30-day lines)", "", lines.length ? inventoryMd(lines, EXPECTED) : "_No lines._", "");

  // ---- History depth ----
  md.push("### History depth", "", "90-day windows (inside the API's 3-month maximum), newest first, `page_size=1`, reading `total_count` only.", "");
  const rows: (string | number)[][] = [];
  let earliest = "none found";
  try {
    let end = now;
    let emptyRun = 0;
    while (end > HISTORY_FLOOR && emptyRun < 2) {
      const start = Math.max(end - 90 * DAY, HISTORY_FLOOR);
      const { data } = await page(client, 1, start, end);
      const total = data?.total_count === undefined ? listItems(data).length : toNum(data.total_count);
      rows.push([`${iso(start).slice(0, 10)} → ${iso(end).slice(0, 10)}`, total]);
      if (total > 0) {
        earliest = iso(start).slice(0, 10);
        emptyRun = 0;
      } else emptyRun++;
      end = start;
    }
    md.push(table(["window", "total_count"], rows), "");
    md.push(`Earliest window with data starts: **${earliest}**.`, "");
    if (emptyRun >= 2) md.push("Stopped after two consecutive empty windows.", "");
    else md.push("Reached 2022-01-01.", "");
  } catch (e) {
    if (!(e instanceof TikTokApiError)) throw e;
    errors.push(e.message);
    if (rows.length) md.push(table(["window", "total_count"], rows), "");
    md.push(`Earliest window with data so far: **${earliest}** (walk interrupted).`, "");
  }

  if (errors.length) {
    log("  affiliate: stopped with errors");
    md.push("### Errors", "", ...errors.map((e) => `- ${e}`), "");
  }
  return { md: md.join("\n"), samples: lines.slice(0, 3) };
};
