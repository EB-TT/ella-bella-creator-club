import type { Client } from "../tiktok.ts";

export interface SectionResult {
  md: string;
  /** Candidate example items; run.ts keeps at most 3 and scrubs them. */
  samples: unknown[];
}

/** Data handed from one section to the next within a single run. */
export interface Ctx {
  affiliateUsernames?: Set<string>;
  sampleUsernames?: Set<string>;
  sampleOrders?: { orderId: string; status: string }[];
  /** Product IDs from sample applications, most frequent first. */
  productIds?: string[];
  samplesRan?: boolean;
}

export type Section = (client: Client, ctx: Ctx) => Promise<SectionResult>;
