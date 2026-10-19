// TikTok Shop API client for the discovery script: signing (ported from
// supabase/functions/tiktok-shop-callback/tiktok.ts to Node), pacing, and a
// per-section record of every call so findings can show status codes,
// request IDs, timings and any rate-limit headers.
//
// URLs are never logged: they carry the signature, app key and shop cipher.
// Only the path is.

import { createHmac } from "node:crypto";
import { log, redact, sleep, table } from "./util.ts";

export const API_HOST = "https://open-api.tiktokglobalshop.com";
const MIN_GAP_MS = 300;

export interface Creds {
  appKey: string;
  appSecret: string;
  accessToken: string;
  shopCipher: string;
}

export type Query = [string, string][];

export class TikTokApiError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly httpStatus?: number,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "TikTokApiError";
  }
}

/**
 * TikTok's request signature (HMAC-SHA256, lowercase hex):
 *   1. query params except `sign` and `access_token`, sorted by key
 *   2. concatenated as key + value (repeated keys keep their given order)
 *   3. prepend the path; append the JSON body if there is one
 *   4. wrap with the app secret at both ends
 *   5. HMAC-SHA256 keyed with the app secret, hex-encoded
 */
export function sign(appSecret: string, path: string, query: Query, body?: string): string {
  const params = query
    .filter(([k]) => k !== "sign" && k !== "access_token")
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => k + v)
    .join("");
  const payload = appSecret + path + params + (body ?? "") + appSecret;
  return createHmac("sha256", appSecret).update(payload).digest("hex");
}

interface CallRecord {
  path: string;
  status: number | string;
  code: number | string;
  message: string;
  requestId: string;
  ms: number;
}

export interface ApiResult {
  data: any;
  requestId: string;
}

export class Client {
  private calls: CallRecord[] = [];
  private rateHeaders = new Map<string, Set<string>>();
  private lastStart = 0;
  private sectionStart = Date.now();
  // Whether an empty `{}` body is included in the signature. Flips to false
  // (once) if TikTok rejects the signature on an empty-body POST.
  signEmptyBody = true;
  emptyBodySigningNote = "";

  constructor(private creds: Creds) {}

  beginSection(): void {
    this.sectionStart = Date.now();
    this.calls = [];
    this.rateHeaders = new Map();
  }

  async request(opts: { method: "GET" | "POST"; path: string; query?: Query; body?: object }): Promise<ApiResult> {
    const bodyStr = opts.method === "POST" ? JSON.stringify(opts.body ?? {}) : undefined;
    try {
      return await this.attempt(opts.method, opts.path, opts.query ?? [], bodyStr, bodyStr !== "{}" || this.signEmptyBody);
    } catch (e) {
      if (e instanceof TikTokApiError && bodyStr === "{}" && this.signEmptyBody && /sign/i.test(e.message)) {
        this.signEmptyBody = false;
        this.emptyBodySigningNote = "Empty `{}` POST bodies are signed WITHOUT the body (the with-body signature was rejected).";
        log("  signature rejected on empty body; retrying with the body left out of the signature");
        return await this.attempt(opts.method, opts.path, opts.query ?? [], bodyStr, false);
      }
      throw e;
    }
  }

  private async attempt(
    method: "GET" | "POST",
    path: string,
    query: Query,
    body: string | undefined,
    signBody: boolean,
  ): Promise<ApiResult> {
    const wait = this.lastStart + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastStart = Date.now();

    const q: Query = [
      ...query,
      ["app_key", this.creds.appKey],
      ["shop_cipher", this.creds.shopCipher],
      ["timestamp", String(Math.floor(Date.now() / 1000))],
    ];
    q.push(["sign", sign(this.creds.appSecret, path, q, signBody ? body : undefined)]);

    const url = new URL(path, API_HOST);
    url.search = new URLSearchParams(q).toString();

    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { "x-tts-access-token": this.creds.accessToken, "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      const msg = redact(e instanceof Error ? e.message : String(e));
      this.record({ path, status: "network", code: "-", message: msg, requestId: "-", ms: Date.now() - started });
      throw new TikTokApiError(`network error: ${msg}`);
    }

    res.headers.forEach((value, name) => {
      if (/ratelimit|rate-limit|retry/i.test(name)) {
        const set = this.rateHeaders.get(name) ?? new Set<string>();
        set.add(value);
        this.rateHeaders.set(name, set);
      }
    });

    const json = (await res.json().catch(() => null)) as
      | { code?: number; message?: string; request_id?: string; data?: unknown }
      | null;
    const ms = Date.now() - started;
    const requestId = json?.request_id ?? res.headers.get("x-tt-logid") ?? "-";
    const code = json?.code ?? "-";
    const message = redact(json?.message ?? (json ? "" : "non-JSON response"));
    this.record({ path, status: res.status, code, message, requestId, ms });

    if (!res.ok || !json || json.code !== 0) {
      throw new TikTokApiError(
        `${path}: code ${code} "${message}" (HTTP ${res.status}, request_id ${requestId})`,
        typeof json?.code === "number" ? json.code : undefined,
        res.status,
        requestId,
      );
    }
    return { data: json.data, requestId };
  }

  private record(r: CallRecord): void {
    this.calls.push(r);
    log(`  ${r.path} -> HTTP ${r.status} code=${r.code} "${r.message}" request_id=${r.requestId} ${r.ms}ms`);
  }

  /** This section's call count, summed API time and wall-clock time (which includes the 300 ms pacing). */
  timing(): { calls: number; apiMs: number; wallMs: number } {
    return { calls: this.calls.length, apiMs: this.calls.reduce((a, c) => a + c.ms, 0), wallMs: Date.now() - this.sectionStart };
  }

  /** Markdown summary of this section's calls and any rate-limit headers. */
  summaryMd(): string {
    const byPath = new Map<string, CallRecord[]>();
    for (const c of this.calls) {
      const key = c.path.replace(/\/\d{6,}$/, "/{id}");
      byPath.set(key, [...(byPath.get(key) ?? []), c]);
    }
    const rows = [...byPath.entries()].map(([p, cs]) => {
      const uniq = (f: (c: CallRecord) => string | number) => [...new Set(cs.map(f))].join(", ");
      const ms = cs.map((c) => c.ms);
      return [p, cs.length, uniq((c) => c.status), uniq((c) => c.code), Math.round(ms.reduce((a, b) => a + b, 0) / ms.length), Math.max(...ms)];
    });
    let md = rows.length
      ? table(["endpoint", "calls", "HTTP", "code(s)", "avg ms", "max ms"], rows)
      : "_No API calls made._";
    const failures = this.calls.filter((c) => c.code !== 0);
    if (failures.length) {
      md += "\n\n**Failed calls**\n\n" + table(
        ["endpoint", "HTTP", "code", "message", "request_id"],
        failures.slice(0, 20).map((c) => [c.path, c.status, c.code, c.message, c.requestId]),
      );
    }
    md += "\n\n**Rate-limit-looking response headers:** ";
    md += this.rateHeaders.size
      ? "\n\n" + table(
          ["header", "values seen"],
          [...this.rateHeaders.entries()].map(([h, v]) => [h, [...v].slice(0, 6).join(" ; ")]),
        )
      : "none seen.";
    if (this.emptyBodySigningNote) md += `\n\n${this.emptyBodySigningNote}`;
    return md;
  }
}
