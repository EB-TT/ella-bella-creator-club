// Section 4: Target collaborations. Volume per status, then detail for a few
// collaborations to see who was invited, who accepted and who posted.

import { TikTokApiError, type Client } from "../tiktok.ts";
import {
  bucket, count, deepFirst, distTable, inventoryMd, iso, isEmpty, listItems, normUser, table, toNum,
} from "../util.ts";
import type { Section } from "./types.ts";

const SEARCH = "/affiliate_seller/202508/target_collaborations/search";

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

const DAY = 86_400;
const PAGE_CAP = 100;
// docs/tiktok-api/Query Target Collaboration Detail.md, creators[] leaves.
const EXPECTED_CREATOR = [
  "username", "creator_open_id", "showcase_product_count", "content_product_count", "collaboration_status", "product_effective_status",
];

// Docs list `collaboration_status` as a body field; fall back to the query string if that's rejected.
let statusInQuery = false;

/** One page of the collaboration list for a status. */
async function search(client: Client, status: string, size: number, token: string | undefined, notes: string[]) {
  const query: [string, string][] = [["page_size", String(size)]];
  if (token) query.push(["page_token", token]);
  if (statusInQuery) {
    return (await client.request({ method: "POST", path: SEARCH, query: [...query, ["collaboration_status", status]], body: {} })).data;
  }
  try {
    return (await client.request({ method: "POST", path: SEARCH, query, body: { collaboration_status: status } })).data;
  } catch (e) {
    if (!(e instanceof TikTokApiError) || token) throw e;
    notes.push(`${status}: body form rejected (${e.message}); trying as a query parameter`);
    const r = await client.request({ method: "POST", path: SEARCH, query: [...query, ["collaboration_status", status]], body: {} });
    statusInQuery = true;
    notes.push(`${status}: \`collaboration_status\` accepted as a query parameter`);
    return r.data;
  }
}

/** Every page of a status's list. */
async function listAll(client: Client, status: string, notes: string[], errors: string[]) {
  const items: any[] = [];
  let total: unknown;
  let pages = 0;
  try {
    let token: string | undefined;
    do {
      const data = await search(client, status, 100, token, notes);
      total ??= data?.total_count;
      items.push(...listItems(data));
      token = data?.next_page_token || undefined;
      pages++;
    } while (token && pages < PAGE_CAP);
    if (token) errors.push(`${status}: stopped at ${PAGE_CAP} pages; the list is incomplete.`);
  } catch (e) {
    if (!(e instanceof TikTokApiError)) throw e;
    errors.push(e.message);
  }
  return { items, total, pages };
}

export const collabs: Section = async (client, ctx) => {
  const md: string[] = [];
  const errors: string[] = [];
  const notes: string[] = [];
  const now = Math.floor(Date.now() / 1000);

  // VALID: the whole list. COMPLETED: first page, for its total_count only.
  const valid = await listAll(client, "VALID", notes, errors);
  const totals: (string | number)[][] = [["VALID", String(valid.total ?? "(absent)"), valid.items.length, valid.pages]];
  if (!errors.length) {
    try {
      const data = await search(client, "COMPLETED", 20, undefined, notes);
      totals.push(["COMPLETED", String(data?.total_count ?? "(absent)"), "(first page only)", 1]);
    } catch (e) {
      if (!(e instanceof TikTokApiError)) throw e;
      errors.push(e.message);
    }
  }
  md.push(table(["collaboration_status filter", "total_count", "items read", "pages"], totals), "");
  if (notes.length) md.push(...notes.map((n) => `- ${n}`), "");

  const idOf = (c: any) => (isEmpty(c?.id) ? "" : String(c.id));
  const items = valid.items;

  // ---- Sizing "detail only for collabs updated since last run" ----
  if (items.length) {
    const upd = items.map((c) => toNum(c.update_time));
    const within = (days: number) => upd.filter((t) => t >= now - days * DAY).length;
    md.push(
      "### VALID list: `update_time` and creators per collaboration",
      "",
      table(["measure", "value"], [
        ["VALID collaborations read", items.length],
        ["with an `update_time`", upd.filter((t) => t > 0).length],
        ["updated in the last 1 day", within(1)],
        ["updated in the last 7 days", within(7)],
        ["updated in the last 30 days", within(30)],
        ["oldest update_time", iso(Math.min(...upd.filter((t) => t > 0)))],
        ["newest update_time", iso(Math.max(...upd))],
      ]),
      "",
    );
    // The docs spell the list field `creator_inivited_count`; accept the corrected spelling too.
    const invited = (c: any) => toNum(c.creator_inivited_count ?? c.creator_invited_count);
    const buckets = ["0", "1", "2-5", "6-20", "21+"];
    const dist = new Map<string, number>();
    for (const c of items) dist.set(bucket(invited(c)), (dist.get(bucket(invited(c))) ?? 0) + 1);
    md.push(
      "**Creators invited per collaboration** (from `creator_inivited_count` on the list items)",
      "",
      table(["creators", "collaborations"], buckets.map((b) => [b, dist.get(b) ?? 0])),
      "",
      table(["measure", "value"], [
        ["Σ invited creators across VALID collaborations", items.reduce((a, c) => a + invited(c), 0)],
        ["Σ showcase_creator_count", items.reduce((a, c) => a + toNum(c.showcase_creator_count), 0)],
        ["Σ content_creator_count", items.reduce((a, c) => a + toNum(c.content_creator_count), 0)],
        ["max invited in one collaboration", Math.max(...items.map(invited))],
      ]),
      "",
    );
    md.push("**Status values on returned collaborations**", "", distTable("collaboration_status", count(items, (c) => c.collaboration_status)), "");
    md.push("**type**", "", distTable("type", count(items, (c) => c.type)), "");
  }

  // 10 VALID collaborations spread across the list ordered by update_time (newest first).
  const ordered = [...items].filter((c) => idOf(c)).sort((a, b) => toNum(b.update_time) - toNum(a.update_time));
  const step = Math.max(1, Math.floor(ordered.length / 10));
  const chosen = Array.from({ length: Math.min(10, ordered.length) }, (_, i) => ordered[i * step]);

  const creators: any[] = [];
  const perCollab: (string | number)[][] = [];
  for (const c of chosen) {
    try {
      const { data } = await client.request({ method: "GET", path: `/affiliate_seller/202508/target_collaborations/${idOf(c)}` });
      const cs = creatorsOf(data);
      creators.push(...cs);
      perCollab.push([
        idOf(c), iso(c.update_time).slice(0, 10), toNum(c.creator_inivited_count ?? c.creator_invited_count), cs.length,
        cs.filter((x) => toNum(x.showcase_product_count) > 0).length,
        cs.filter((x) => toNum(x.content_product_count) > 0).length,
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
      table(
        ["collaboration id", "list update_time", "creators per list", "creators in detail", "accepted (showcase_product_count > 0)", "posted (content_product_count > 0)"],
        perCollab,
      ),
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
    md.push("### Fields seen on invited creators", "", creators.length ? inventoryMd(creators, EXPECTED_CREATOR) : "_None._", "");
  }

  if (errors.length) md.push("### Errors", "", ...errors.map((e) => `- ${e}`), "");
  const exampleItems = [...items.slice(0, 1), ...creators.slice(0, 2)].filter((x) => !isEmpty(x));
  return { md: md.join("\n"), samples: exampleItems };
};
