// Section 4: Target collaborations. Volume per status, then detail for a few
// collaborations to see who was invited, who accepted and who posted.

import { TikTokApiError, type Client } from "../tiktok.ts";
import {
  count, deepFirst, distTable, inventoryMd, isEmpty, listItems, normUser, table, toNum,
} from "../util.ts";
import type { Section } from "./types.ts";

const SEARCH = "/affiliate_seller/202508/target_collaborations/search";
const STATUSES = ["VALID", "COMPLETED"];

/** The array of invited creators inside a detail response. */
function creatorsOf(data: any): any[] {
  const hit = (a: unknown): a is any[] =>
    Array.isArray(a) && a.length > 0 && typeof a[0] === "object" &&
    ["showcase_product_count", "content_product_count", "username", "creator_username"].some((k) => k in a[0]);
  const walk = (n: any, depth: number): any[] | undefined => {
    if (hit(n)) return n;
    if (!n || typeof n !== "object" || depth > 4) return undefined;
    for (const v of Object.values(n)) {
      const r = walk(v, depth + 1);
      if (r) return r;
    }
    return undefined;
  };
  return walk(data, 0) ?? [];
}

/** collaboration_status isn't documented as body or query in our notes; try body, then query. */
async function search(client: Client, status: string, notes: string[]) {
  const query: [string, string][] = [["page_size", "50"]];
  try {
    const r = await client.request({ method: "POST", path: SEARCH, query, body: { collaboration_status: status } });
    notes.push(`${status}: \`collaboration_status\` accepted in the request body`);
    return r.data;
  } catch (e) {
    if (!(e instanceof TikTokApiError)) throw e;
    notes.push(`${status}: body form rejected (${e.message}); trying as a query parameter`);
    const r = await client.request({ method: "POST", path: SEARCH, query: [...query, ["collaboration_status", status]], body: {} });
    notes.push(`${status}: \`collaboration_status\` accepted as a query parameter`);
    return r.data;
  }
}

export const collabs: Section = async (client, ctx) => {
  const md: string[] = [];
  const errors: string[] = [];
  const notes: string[] = [];
  const lists = new Map<string, any[]>();
  const totals: (string | number)[][] = [];

  for (const status of STATUSES) {
    try {
      const data = await search(client, status, notes);
      const items = listItems(data);
      lists.set(status, items);
      totals.push([status, String(data?.total_count ?? "(absent)"), items.length]);
    } catch (e) {
      if (!(e instanceof TikTokApiError)) throw e;
      errors.push(e.message);
      break;
    }
  }

  md.push(table(["collaboration_status filter", "total_count", "items on first page"], totals), "");
  if (notes.length) md.push(...notes.map((n) => `- ${n}`), "");

  const idOf = (c: any) => {
    const v = deepFirst(c, ["id", "target_collaboration_id", "collaboration_id"]);
    return v === undefined ? "" : String(v);
  };
  const allItems = [...lists.values()].flat();
  if (allItems.length) {
    md.push("**Status values on returned collaborations**", "", distTable("collaboration_status", count(allItems, (c) => deepFirst(c, ["collaboration_status", "status"]))), "");
  }

  // Up to 5 collaborations, alternating between the status lists.
  const queues = [...lists.values()].map((l) => [...l]);
  const chosen: string[] = [];
  while (chosen.length < 5 && queues.some((q) => q.length)) {
    for (const q of queues) {
      const next = q.shift();
      if (next && idOf(next) && chosen.length < 5) chosen.push(idOf(next));
    }
  }

  const creators: any[] = [];
  const perCollab: (string | number)[][] = [];
  for (const id of chosen) {
    try {
      const { data } = await client.request({ method: "GET", path: `/affiliate_seller/202508/target_collaborations/${id}` });
      const cs = creatorsOf(data);
      creators.push(...cs);
      perCollab.push([
        id, cs.length,
        cs.filter((c) => toNum(c.showcase_product_count) > 0).length,
        cs.filter((c) => toNum(c.content_product_count) > 0).length,
      ]);
    } catch (e) {
      if (!(e instanceof TikTokApiError)) throw e;
      errors.push(e.message);
      break;
    }
  }

  if (perCollab.length) {
    md.push(
      `### Detail for ${perCollab.length} collaboration(s)`, "",
      table(["collaboration id", "creators", "accepted (showcase_product_count > 0)", "posted (content_product_count > 0)"], perCollab),
      "",
    );
    const accepted = creators.filter((c) => toNum(c.showcase_product_count) > 0).length;
    const posted = creators.filter((c) => toNum(c.content_product_count) > 0).length;
    const users = new Set(creators.map((c) => normUser(deepFirst(c, ["creator_username", "username"]))).filter(Boolean));
    const matches = (set?: Set<string>) => (set ? `${[...users].filter((u) => set.has(u)).length} of ${users.size}` : "n/a (section not run in this invocation)");
    md.push(
      table(["measure", "value"], [
        ["creators across these collaborations", creators.length],
        ["accepted", accepted],
        ["posted", posted],
        ["distinct creator usernames", users.size],
        ["matching an affiliate-order creator_username", matches(ctx.affiliateUsernames)],
        ["matching a sample-application creator username", matches(ctx.sampleUsernames)],
      ]),
      "",
    );
    md.push("**Creator-level status values**", "", distTable("status", count(creators, (c) => deepFirst(c, ["status", "collaboration_status"]))), "");
    md.push("**showcase_product_count**", "", distTable("value", count(creators, (c) => c.showcase_product_count)), "");
    md.push("**content_product_count**", "", distTable("value", count(creators, (c) => c.content_product_count)), "");
    md.push("### Fields seen on invited creators", "", creators.length ? inventoryMd(creators) : "_None._", "");
  }

  if (errors.length) md.push("### Errors", "", ...errors.map((e) => `- ${e}`), "");
  const exampleItems = [...allItems.slice(0, 1), ...creators.slice(0, 2)].filter((x) => !isEmpty(x));
  return { md: md.join("\n"), samples: exampleItems };
};
