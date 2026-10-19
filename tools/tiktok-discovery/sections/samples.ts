// Section 2: Search Sample Applications. Volume, status mix, creator identity
// (username vs open ID), and which creator-stat fields are actually populated.
// Keeps sample order IDs and product IDs in ctx for the next sections.

import { TikTokApiError } from "../tiktok.ts";
import {
  count, deepAll, deepFirst, distTable, inventoryMd, isEmpty, listItems, normUser, table, toNum,
} from "../util.ts";
import type { Section } from "./types.ts";

const PATH = "/affiliate_seller/202508/sample_applications/search";
const PAGE_SIZE = 50;
const FULL_SCAN_LIMIT = 3000;
const PAGE_CAP = 60;

const STATS = ["gmv", "content_count", "fulfillment_percentage", "ec_video_view"];

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
      const { data } = await client.request({ method: "POST", path: PATH, query, body: {} });
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

  const creatorOf = (a: any) => a?.creator ?? a?.creator_info ?? a;
  const username = (a: any) => normUser(deepFirst(creatorOf(a), ["creator_username", "username", "user_name"]));
  const openId = (a: any): string => {
    const v = deepFirst(creatorOf(a), ["open_id", "creator_open_id", "creator_id", "user_id"]);
    return v === undefined ? "" : String(v);
  };

  const usernames = new Set(apps.map(username).filter(Boolean));
  const openIds = new Set(apps.map(openId).filter(Boolean));
  ctx.sampleUsernames = usernames;
  ctx.samplesRan = true;

  const orderIds = apps.map((a) => deepAll(a, "order_id")[0]).filter((x) => x !== undefined).map(String);
  ctx.sampleOrders = apps.flatMap((a) => {
    const id = deepAll(a, "order_id")[0];
    return id === undefined ? [] : [{ orderId: String(id), status: String(deepFirst(a, ["status"]) ?? "") }];
  });
  const productFreq = count(apps.flatMap((a) => [...new Set(deepAll(a, "product_id").map(String))]), (x) => x);
  productFreq.delete("(empty)");
  ctx.productIds = [...productFreq.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);

  md.push(
    table(["measure", "value"], [
      ["API `total_count`", String(total ?? "(absent)")],
      ["pages fetched", pages],
      ["applications read", apps.length],
      ["applications with an `order_id`", orderIds.length],
      ["distinct creators by username", usernames.size],
      ["distinct creators by open ID", openIds.size],
      ["distinct product IDs", ctx.productIds.length],
    ]),
    "",
  );
  if (capped) md.push(`**Not a full scan:** total_count is over ${FULL_SCAN_LIMIT}, so reading stopped at ${PAGE_CAP} pages.`, "");

  md.push("**status**", "", distTable("status", count(apps, (a) => deepFirst(a, ["status"]))), "");
  md.push("**fulfillment_status**", "", distTable("fulfillment_status", count(apps, (a) => deepFirst(a, ["fulfillment_status"]))), "");

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
    const vals = apps.map((a) => deepFirst(a, [k]));
    const populated = vals.filter((v) => !isEmpty(v));
    const zero = populated.filter((v) => toNum(v) === 0 && (typeof v !== "string" || /^\s*0+(\.0+)?\s*$/.test(v))).length;
    return [k, `${populated.length}/${apps.length}`, apps.length - populated.length, zero];
  });
  md.push("**Creator-stat fields**", "", table(["field", "populated", "empty", "populated but zero"], statRows), "");

  md.push("### Fields seen in the response", "", apps.length ? inventoryMd(apps) : "_No applications._", "");
  if (errors.length) md.push("### Errors", "", ...errors.map((e) => `- ${e}`), "");
  return { md: md.join("\n"), samples: apps.slice(0, 3) };
};
