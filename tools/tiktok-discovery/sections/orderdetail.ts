// Section 3: Get Order Detail for a handful of sample orders. Works out how the
// `ids` list has to be encoded, and keeps ONLY the shipping/delivery timing
// fields. Nothing else from the order (address, buyer, payment) is retained.

import { TikTokApiError, type Query } from "../tiktok.ts";
import { iso, listItems, table, toNum } from "../util.ts";
import type { Section } from "./types.ts";

const PATH = "/order/202507/orders";
const PRIORITY = ["SHIPPED", "CONTENT_PENDING", "COMPLETED"];
const KEEP = ["is_sample_order", "status", "create_time", "rts_time", "collection_time", "delivery_time", "update_time"] as const;

const ENCODINGS: { name: string; build: (ids: string[]) => Query }[] = [
  { name: "comma-separated (`ids=1,2,3`)", build: (ids) => [["ids", ids.join(",")]] },
  { name: "JSON array string (`ids=[\"1\",\"2\"]`)", build: (ids) => [["ids", JSON.stringify(ids)]] },
  { name: "repeated params (`ids=1&ids=2`)", build: (ids) => ids.map((id): [string, string] => ["ids", id]) },
];

/** Up to 10 order IDs, round-robin across the preferred statuses first. */
function pickOrders(all: { orderId: string; status: string }[]): string[] {
  const buckets = PRIORITY.map((s) => all.filter((o) => o.status === s));
  buckets.push(all.filter((o) => !PRIORITY.includes(o.status)));
  const picked: string[] = [];
  for (let i = 0; picked.length < 10 && buckets.some((b) => i < b.length); i++) {
    for (const b of buckets) if (i < b.length && picked.length < 10 && !picked.includes(b[i].orderId)) picked.push(b[i].orderId);
  }
  return picked;
}

export const orderdetail: Section = async (client, ctx) => {
  const md: string[] = [];
  const ids = pickOrders(ctx.sampleOrders ?? []);
  if (!ids.length) return { md: "_Skipped: no sample order IDs available (the samples section found none)._", samples: [] };

  const attempts: (string | number)[][] = [];
  let kept: Record<string, unknown>[] = [];
  let worked = "";

  for (const enc of ENCODINGS) {
    try {
      const { data } = await client.request({ method: "GET", path: PATH, query: enc.build(ids) });
      const orders = listItems(data);
      attempts.push([enc.name, "accepted", `${orders.length} of ${ids.length} orders returned`]);
      if (orders.length > 0) {
        // Keep the allow-listed timing fields only; the rest is dropped here.
        kept = orders.map((o) => Object.fromEntries(KEEP.map((k) => [k, o?.[k]])));
        worked = enc.name;
        break;
      }
    } catch (e) {
      if (!(e instanceof TikTokApiError)) throw e;
      attempts.push([enc.name, "rejected", e.message]);
    }
  }

  md.push(`Requested ${ids.length} sample order IDs (status mix preferred: ${PRIORITY.join(", ")}).`, "");
  md.push("**`ids` encoding attempts**", "", table(["encoding", "result", "detail"], attempts), "");
  md.push(worked ? `**Worked:** ${worked}` : "**No encoding returned orders.**", "");
  if (!kept.length) return { md: md.join("\n"), samples: [] };

  md.push(
    table(
      ["#", "is_sample_order", "status", "create_time", "rts_time", "collection_time", "delivery_time", "update_time"],
      kept.map((o, i) => [
        i + 1, String(o.is_sample_order), String(o.status ?? ""),
        iso(o.create_time), iso(o.rts_time), iso(o.collection_time), iso(o.delivery_time), iso(o.update_time),
      ]),
    ),
    "",
  );
  const n = kept.length;
  const shipped = kept.filter((o) => toNum(o.rts_time) > 0 || toNum(o.collection_time) > 0).length;
  const delivered = kept.filter((o) => toNum(o.delivery_time) > 0).length;
  const samplesFlagged = kept.filter((o) => o.is_sample_order === true).length;
  md.push(
    table(["share of returned orders", "count"], [
      ["is_sample_order = true", `${samplesFlagged}/${n}`],
      ["have a ship time (rts_time or collection_time)", `${shipped}/${n}`],
      ["have a delivery_time", `${delivered}/${n}`],
    ]),
    "",
  );
  return { md: md.join("\n"), samples: kept };
};
