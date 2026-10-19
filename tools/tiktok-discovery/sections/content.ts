// Section 5: Open collaboration creator content details, for a few of the
// 3 products with the most sample applications.

import { TikTokApiError } from "../tiktok.ts";
import { bucket, inventoryMd, listItems, normUser, table, toNum } from "../util.ts";
import type { Section } from "./types.ts";

const PATH = "/affiliate_seller/202508/open_collaborations/creator_content_details";
const PAGE_CAP = 5;
const EXPECTED = ["creator_profile.username", "creator_profile.creator_open_id", "video_count", "live_count", "promotion_status", "promotion_end_time"];

export const content: Section = async (client, ctx) => {
  const md: string[] = [];
  const errors: string[] = [];
  const products = (ctx.productIds ?? []).slice(0, 3);
  if (!products.length) return { md: "_Skipped: no product IDs available (the samples section found none)._", samples: [] };

  const rows: (string | number)[][] = [];
  const dists: string[] = [];
  const examples: any[] = [];
  let sawItems: any[] = [];
  const allUsers = new Set<string>();
  const userOf = (it: any) => normUser(it?.creator_profile?.username);
  const matchOf = (users: Set<string>, set?: Set<string>) => (set ? `${[...users].filter((u) => set.has(u)).length} of ${users.size}` : "n/a (section not run in this invocation)");

  for (const productId of products) {
    const items: any[] = [];
    let total: unknown;
    try {
      let token: string | undefined;
      let pages = 0;
      do {
        const query: [string, string][] = [["product_id", productId], ["page_size", "100"]];
        if (token) query.push(["page_token", token]);
        const { data } = await client.request({ method: "GET", path: PATH, query });
        total ??= data?.total_count;
        items.push(...listItems(data));
        token = data?.next_page_token || undefined;
      } while (token && ++pages < PAGE_CAP);
    } catch (e) {
      if (!(e instanceof TikTokApiError)) throw e;
      errors.push(`product ${productId}: ${e.message}`);
    }
    const users = new Set(items.map(userOf).filter(Boolean));
    users.forEach((u) => allUsers.add(u));
    rows.push([
      productId, String(total ?? "(absent)"), items.length, users.size,
      matchOf(users, ctx.affiliateUsernames), matchOf(users, ctx.sampleUsernames),
    ]);
    examples.push(...items.slice(0, 1));
    sawItems = sawItems.concat(items);

    // Distribution of every video/live count-looking numeric field.
    const keys = new Set<string>();
    for (const it of items) for (const [k, v] of Object.entries(it ?? {})) if (/^(video|live)_count$/.test(k) && typeof v !== "object") keys.add(k);
    for (const k of keys) {
      const m = new Map<string, number>();
      for (const it of items) m.set(bucket(toNum(it[k])), (m.get(bucket(toNum(it[k]))) ?? 0) + 1);
      dists.push(`product ${productId} · \`${k}\`: ` + ["0", "1", "2-5", "6-20", "21+"].map((b) => `${b}: ${m.get(b) ?? 0}`).join(", "));
    }
  }

  md.push(
    `Products: the ${products.length} with the most sample applications. Up to ${PAGE_CAP} pages of 100 creators each are read per product.`,
    "",
    table(
      ["product id", "API total_count", "creators read", "distinct usernames", "match affiliate usernames", "match sample-application usernames"],
      rows,
    ),
    "",
    `Across all ${products.length} products: ${allUsers.size} distinct creators; matching affiliate usernames: **${matchOf(allUsers, ctx.affiliateUsernames)}**; matching sample-application usernames: **${matchOf(allUsers, ctx.sampleUsernames)}**.`,
    "",
  );
  md.push("**Video / live count distributions** (creators per bucket)", "", dists.length ? dists.map((d) => `- ${d}`).join("\n") : "_No video/live count fields found._", "");
  md.push("### Fields seen", "", sawItems.length ? inventoryMd(sawItems, EXPECTED) : "_No creators._", "");
  if (errors.length) md.push("### Errors", "", ...errors.map((e) => `- ${e}`), "");
  return { md: md.join("\n"), samples: examples };
};
