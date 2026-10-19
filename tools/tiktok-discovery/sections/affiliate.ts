// Section 1: Search Seller Affiliate Orders. Last-30-day aggregation (to compare
// against Seller Center) and a walk back through history to find how far data goes.

import { TikTokApiError, type Client } from "../tiktok.ts";
import {
  amountOf, count, deepFirst, distTable, inventoryMd, listItems, normUser, table, toNum, iso, log,
} from "../util.ts";
import type { Section } from "./types.ts";

const PATH = "/affiliate_seller/202410/orders/search";
const DAY = 86_400;
const MAX_PAGES = 300;
const HISTORY_FLOOR = Date.UTC(2022, 0, 1) / 1000;

// Documented leaf fields (docs/tiktok-api/Search Seller Affiliate Orders.md). `id`, `create_time`
// and `delivery_time` are order-level and merged onto each line by toLines().
const EXPECTED = [
  "id", "create_time", "delivery_time", "sku_id", "settlement_status", "creator_username",
  "price.amount", "price.currency", "quantity", "content_type", "content_id", "product_id",
  "estimated_commission_base.amount", "estimated_commission_base.currency",
  "actual_commission_base.amount", "actual_commission_base.currency", "fully_return",
  "commission_rate", "target_collaboration_id", "open_collaboration_id", "campaign_id",
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
  md.push("**price.currency**", "", distTable("currency", count(lines, (l) => l.price?.currency)), "");

  // ---- GMV definitions ----
  // A: settled lines only. B: all lines, estimated. C: B minus fully returned lines.
  // D: actual where present, else estimated unless fully returned.
  const fullyReturned = (l: any) => String(l.fully_return ?? "").trim().toLowerCase() === "yes";
  const notReturned = (l: any) => String(l.fully_return ?? "").trim().toLowerCase() === "no";
  const gmv = (l: any) => {
    const act = amountOf(l.actual_commission_base);
    const est = amountOf(l.estimated_commission_base) ?? 0;
    return { A: act ?? 0, B: est, C: notReturned(l) ? est : 0, D: act ?? (notReturned(l) ? est : 0) };
  };
  type Tot = { A: number; B: number; C: number; D: number; lines: number; units: number; unitsKept: number };
  const blank = (): Tot => ({ A: 0, B: 0, C: 0, D: 0, lines: 0, units: 0, unitsKept: 0 });
  const shop = blank();
  const byCreator = new Map<string, Tot>();
  for (const l of lines) {
    const u = normUser(l.creator_username) || "(empty)";
    const g = gmv(l);
    const q = toNum(l.quantity);
    for (const t of [shop, byCreator.get(u) ?? byCreator.set(u, blank()).get(u)!]) {
      t.A += g.A; t.B += g.B; t.C += g.C; t.D += g.D;
      t.lines++;
      t.units += q;
      if (!fullyReturned(l)) t.unitsKept += q;
    }
  }
  md.push(
    "### GMV definitions, last 30 days",
    "",
    "A = Σ `actual_commission_base.amount` (settled lines only). B = Σ `estimated_commission_base.amount` (all lines). C = B where `fully_return` = No. D = per line, actual if present, else estimated if `fully_return` = No, else 0. Sums are in whatever currency the lines carry (see the currency table above).",
    "",
    table(["scope", "A", "B", "C", "D", "lines", "units (all)", "units (excl. fully returned)"], [
      ["shop total", money(shop.A), money(shop.B), money(shop.C), money(shop.D), shop.lines, shop.units, shop.unitsKept],
    ]),
    "",
  );
  const top = [...byCreator.entries()].sort((a, b) => b[1].D - a[1].D).slice(0, 15);
  md.push(
    "**Top 15 creators by D** (compare A–D with Seller Center affiliate GMV for the same 30 days)",
    "",
    table(
      ["creator", "A", "B", "C", "D", "lines", "units (all)", "units (excl. fully returned)"],
      top.map(([u, c]) => [u, money(c.A), money(c.B), money(c.C), money(c.D), c.lines, c.units, c.unitsKept]),
    ),
    "",
  );

  // settlement_status × whether actual_commission_base is present.
  const statusOf = (l: any) => String(l.settlement_status ?? "(empty)") || "(empty)";
  const xt = new Map<string, { present: number; absent: number }>();
  for (const l of lines) {
    const x = xt.get(statusOf(l)) ?? { present: 0, absent: 0 };
    if (amountOf(l.actual_commission_base) !== undefined) x.present++;
    else x.absent++;
    xt.set(statusOf(l), x);
  }
  md.push(
    "**settlement_status × `actual_commission_base.amount` present**",
    "",
    table(["settlement_status", "actual present", "actual absent", "total"], [...xt.entries()].map(([k, x]) => [k, x.present, x.absent, x.present + x.absent])),
    "",
  );
  md.push("**settlement_status × fully_return**", "", table(["settlement_status", "fully_return", "lines"], [
    ...count(lines, (l) => `${statusOf(l)} | ${l.fully_return ?? "(empty)"}`).entries(),
  ].sort().map(([k, n]) => [...k.split(" | "), n]) as (string | number)[][]), "");

  // INELIGIBLE lines: is actual 0, and how does it compare with estimated?
  const inel = lines.filter((l) => statusOf(l).toUpperCase() === "INELIGIBLE");
  if (inel.length) {
    const act = inel.map((l) => amountOf(l.actual_commission_base));
    md.push(
      "**INELIGIBLE lines: actual vs estimated**",
      "",
      table(["measure", "value"], [
        ["lines", inel.length],
        ["actual present", act.filter((x) => x !== undefined).length],
        ["actual present and = 0", act.filter((x) => x === 0).length],
        ["actual present and > 0", act.filter((x) => x !== undefined && x > 0).length],
        ["Σ actual", money(act.reduce<number>((a, x) => a + (x ?? 0), 0))],
        ["Σ estimated", money(inel.reduce((a, l) => a + (amountOf(l.estimated_commission_base) ?? 0), 0))],
        ["fully_return = Yes", inel.filter(fullyReturned).length],
      ]),
      "",
    );
  } else md.push("No INELIGIBLE lines in the last 30 days.", "");

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
