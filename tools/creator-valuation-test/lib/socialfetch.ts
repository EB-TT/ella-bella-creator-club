// Minimal Social Fetch client: plain fetch, disk cache, credit tracking.
// Every raw response is cached to disk so re-runs cost 0 credits
// (Social Fetch's own cache still bills full price).

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const SOCIALFETCH_BASE_URL = "https://api.socialfetch.dev";
const MAX_503_RETRIES = 3;

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

export interface SfRequestLog {
  path: string;
  params: Record<string, string>;
  source: "cache" | "api" | "planned" | "skipped";
  creditsCharged: number;
  note?: string;
}

export type HaltReason = "credit_cap" | "out_of_credits" | null;

interface CachedFile<T> {
  request: { path: string; params: Record<string, string> };
  fetchedAt: string;
  httpStatus: number;
  body: SfEnvelope<T>;
}

export interface SocialFetchOptions {
  apiKey?: string;
  cacheRoot: string; // e.g. cache/<platform>/<handle>
  dryRun: boolean;
  creditCap: number;
  log: (msg: string) => void;
}

export class SocialFetch {
  creditsUsed = 0;
  halted: HaltReason = null;
  readonly requests: SfRequestLog[] = [];

  constructor(private readonly opts: SocialFetchOptions) {}

  /**
   * GET a metered route. Returns null when the response isn't available:
   * dry-run with no cache entry, the per-creator credit cap was hit, or the
   * account is out of credits (see `halted`).
   */
  async get<T>(
    path: string,
    params: Record<string, string | undefined> = {},
    expectedCost = 1,
  ): Promise<SfEnvelope<T> | null> {
    const clean = cleanParams(params);
    const file = this.cachePath(path, clean);

    const cached = await readJson<CachedFile<T>>(file);
    if (cached) {
      this.requests.push({ path, params: clean, source: "cache", creditsCharged: 0 });
      return cached.body;
    }

    if (this.opts.dryRun) {
      this.requests.push({ path, params: clean, source: "planned", creditsCharged: 0, note: `~${expectedCost} credit` });
      return null;
    }

    if (this.halted) {
      this.requests.push({ path, params: clean, source: "skipped", creditsCharged: 0, note: this.halted });
      return null;
    }

    if (this.creditsUsed + expectedCost > this.opts.creditCap) {
      this.halted = "credit_cap";
      this.opts.log(`  ! Credit cap reached (${this.creditsUsed}/${this.opts.creditCap}). No further API requests for this creator.`);
      this.requests.push({ path, params: clean, source: "skipped", creditsCharged: 0, note: "credit_cap" });
      return null;
    }

    if (!this.opts.apiKey) throw new Error("SOCIALFETCH_API_KEY is not set");

    const url = buildUrl(path, clean);
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { headers: { "x-api-key": this.opts.apiKey } });

      if (res.status === 503 && attempt < MAX_503_RETRIES) {
        const waitMs = retryAfterMs(res.headers.get("retry-after"));
        this.opts.log(`  503 from ${path}; retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${MAX_503_RETRIES})`);
        await res.body?.cancel();
        await sleep(waitMs);
        continue;
      }

      if (res.status === 402) {
        this.halted = "out_of_credits";
        const body = await safeText(res);
        this.opts.log(`  ! 402 out of credits on ${path}. Stopping API requests. ${body}`);
        this.requests.push({ path, params: clean, source: "skipped", creditsCharged: 0, note: "402 out_of_credits" });
        return null;
      }

      if (res.status !== 200) {
        throw new Error(`Social Fetch ${res.status} on ${path}: ${await safeText(res)}`);
      }

      const body = (await res.json()) as SfEnvelope<T>;
      let charged = body.meta?.creditsCharged;
      let note: string | undefined;
      if (typeof charged !== "number") {
        charged = expectedCost;
        note = "meta.creditsCharged missing; assumed documented cost";
        this.opts.log(`  ! ${note} (${path})`);
      }
      this.creditsUsed += charged;
      this.requests.push({ path, params: clean, source: "api", creditsCharged: charged, note });

      const toCache: CachedFile<T> = {
        request: { path, params: clean },
        fetchedAt: new Date().toISOString(),
        httpStatus: res.status,
        body,
      };
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(toCache, null, 2));
      return body;
    }
  }

  /** GET /v1/balance is free. Never cached. Returns null in dry-run or on failure. */
  async balance(): Promise<number | null> {
    if (this.opts.dryRun || !this.opts.apiKey) return null;
    try {
      const res = await fetch(buildUrl("/v1/balance", {}), { headers: { "x-api-key": this.opts.apiKey } });
      if (res.status !== 200) {
        this.opts.log(`  ! /v1/balance returned ${res.status}: ${await safeText(res)}`);
        return null;
      }
      const body = (await res.json()) as SfEnvelope<{ balance: number; billingAlert?: string }>;
      if (body.data.billingAlert && body.data.billingAlert !== "none") {
        this.opts.log(`  ! billingAlert: ${body.data.billingAlert}`);
      }
      return body.data.balance;
    } catch (err) {
      this.opts.log(`  ! /v1/balance failed: ${(err as Error).message}`);
      return null;
    }
  }

  private cachePath(path: string, params: Record<string, string>): string {
    const slug = path.replace(/^\/v1\//, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/-+$/, "");
    const key = createHash("sha256").update(path + "?" + new URLSearchParams(params).toString()).digest("hex").slice(0, 16);
    return join(this.opts.cacheRoot, `${slug}__${key}.json`);
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
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
