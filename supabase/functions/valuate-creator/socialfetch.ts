// Minimal Social Fetch client: plain fetch, credit tracking, per-run credit cap.
// Ported from tools/creator-valuation-test/lib/socialfetch.ts without the disk
// cache or dry-run mode.

export const SOCIALFETCH_BASE_URL = "https://api.socialfetch.dev";
const MAX_503_RETRIES = 3;
// Edge Functions have a wall-clock limit, so don't honour very long Retry-After values.
const MAX_RETRY_WAIT_MS = 30_000;

export interface SfMeta {
  requestId?: string;
  creditsCharged?: number;
  version?: string;
  cached?: boolean;
}

export interface SfEnvelope<T> {
  data: T;
  meta: SfMeta;
}

export type HaltReason = "credit_cap" | "out_of_credits" | null;

export interface SocialFetchOptions {
  apiKey: string;
  creditCap: number;
  log: (msg: string) => void;
}

export class SocialFetch {
  creditsUsed = 0;
  halted: HaltReason = null;
  // Credits reserved by requests still in flight, so concurrent requests can't overshoot the cap.
  private reserved = 0;

  constructor(private readonly opts: SocialFetchOptions) {}

  /**
   * GET a metered route. Returns null when the response isn't available:
   * the per-run credit cap was hit, or the account is out of credits (see `halted`).
   */
  async get<T>(
    path: string,
    params: Record<string, string | undefined> = {},
    expectedCost = 1,
  ): Promise<SfEnvelope<T> | null> {
    if (this.halted) return null;

    if (this.creditsUsed + this.reserved + expectedCost > this.opts.creditCap) {
      this.halted = "credit_cap";
      this.opts.log(`credit cap reached (${this.creditsUsed}/${this.opts.creditCap}); no further Social Fetch requests`);
      return null;
    }

    this.reserved += expectedCost;
    try {
      const url = buildUrl(path, cleanParams(params));
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(url, { headers: { "x-api-key": this.opts.apiKey } });

        if (res.status === 503 && attempt < MAX_503_RETRIES) {
          const waitMs = Math.min(retryAfterMs(res.headers.get("retry-after")), MAX_RETRY_WAIT_MS);
          this.opts.log(`503 from ${path}; retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${MAX_503_RETRIES})`);
          await res.body?.cancel();
          await sleep(waitMs);
          continue;
        }

        if (res.status === 402) {
          this.halted = "out_of_credits";
          this.opts.log(`402 out of credits on ${path}: ${await safeText(res)}`);
          return null;
        }

        if (res.status !== 200) {
          throw new Error(`Social Fetch ${res.status} on ${path}: ${await safeText(res)}`);
        }

        const body = (await res.json()) as SfEnvelope<T>;
        let charged = body.meta?.creditsCharged;
        if (typeof charged !== "number") {
          charged = expectedCost;
          this.opts.log(`meta.creditsCharged missing on ${path}; assumed documented cost`);
        }
        this.creditsUsed += charged;
        return body;
      }
    } finally {
      this.reserved -= expectedCost;
    }
  }
}

function cleanParams(params: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(params).sort()) {
    const v = params[k];
    if (v !== undefined && v !== "") out[k] = v;
  }
  return out;
}

function buildUrl(path: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return `${SOCIALFETCH_BASE_URL}${path}${qs ? `?${qs}` : ""}`;
}

function retryAfterMs(header: string | null): number {
  if (!header) return 5_000;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : 5_000;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "";
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run `fn` over `items` with at most `limit` in flight, preserving order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
