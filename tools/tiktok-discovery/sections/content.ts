// Section 5: Open collaboration creator content details, for a few of the
// products seen in sample applications.

import { TikTokApiError } from "../tiktok.ts";
import { bucket, listItems, table, toNum, inventoryMd } from "../util.ts";
import type { Section } from "./types.ts";

const PATH = "/affiliate_seller/202508/open_collaborations/creator_content_details";
const PAGE_CAP = 5;

export const content: Section = async (client, ctx) => {
  const md: string[] = [];
  const errors: string[] = [];
  const products = (ctx.productIds ?? []).slice(0, 3);
  if (!products.length) return { md: "_Skipped: no product IDs available (the samples section found none)._", samples: [] };

  const rows: (string | number)[][] = [];
  const dists: string[] = [];
  const examples: any[] = [];
  let sawItems: any[] = [];

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
    rows.push([productId, String(total ?? "(absent)"), items.length]);
    examples.push(...items.slice(0, 1));
    sawItems = sawItems.concat(items);

    // Distribution of every video/live count-looking numeric field.
    const keys = new Set<string>();
    for (const it of items) for (const [k, v] of Object.entries(it ?? {})) if (/(video|live)/i.test(k) && /count|num|total/i.test(k) && typeof v !== "object") keys.add(k);
    for (const k of keys) {
      const m = new Map<string, number>();
      for (const it of items) m.set(bucket(toNum(it[k])), (m.get(bucket(toNum(it[k]))) ?? 0) + 1);
      dists.push(`product ${productId} · \`${k}\`: ` + ["0", "1", "2-5", "6-20", "21+"].map((b) => `${b}: ${m.get(b) ?? 0}`).join(", "));
    }
  }

  md.push(table(["product id", "API total_count", "creators read"], rows), "");
  md.push("**Video / live count distributions** (creators per bucket)", "", dists.length ? dists.map((d) => `- ${d}`).join("\n") : "_No video/live count fields found._", "");
  md.push("### Fields seen", "", sawItems.length ? inventoryMd(sawItems) : "_No creators._", "");
  if (errors.length) md.push("### Errors", "", ...errors.map((e) => `- ${e}`), "");
  return { md: md.join("\n"), samples: examples };
};
