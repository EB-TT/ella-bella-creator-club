// TikTok Shop client for the sync: credentials, token refresh, request
// signing and a paced HTTP client with 429 backoff.
//
// Signing and the refresh call mirror tiktok-shop-callback/tiktok.ts (this
// function is deployed on its own, so it can't import from there).
//
// Nothing in this file logs, and no error message it builds contains a URL,
// token, app secret or signature. Response bodies are never logged.

import { type Db, must, type Row } from "./db.ts";

const AUTH_HOST = "https://auth.tiktok-shops.com";
const API_HOST = "https://open-api.tiktokglobalshop.com";

// TikTok codes for "too many requests" (app limit, user limit).
const RATE_LIMIT_CODES = new Set([36009002, 36009037]);
const BACKOFF_MS = [2000, 4000, 8000];
const MIN_GAP_MS = 500;
const REFRESH_WINDOW_MS = 24 * 3600_000;

export class TikTokError extends Error {
  readonly code?: number;
  constructor(message: string, code?: number) {
    super(message);
    this.name = "TikTokError";
    this.code = code;
  }
}

/** Thrown after the third backoff still gets a 429: the stream defers to the next run. */
export class RateLimitedError extends Error {
  constructor() {
    super("TikTok rate limit: backed off 2s, 4s, 8s and still limited");
    this.name = "RateLimitedError";
  }
}

export interface Credentials {
  app_key: string;
  app_secret: string;
}

export interface Connection {
  shop_id: string;
  shop_cipher: string;
  access_token: string;
  access_token_expires_at: string;
  refresh_token: string;
  refresh_token_expires_at: string;
}

export async function loadCredentials(db: Db): Promise<Credentials> {
  const data = must(
    await db.from("tiktok_app_credentials").select("app_key, app_secret").eq("id", true).maybeSingle<Credentials>(),
    "read credentials",
  );
  if (!data) throw new Error("TikTok app credentials aren't set up yet");
  return data;
}

export async function loadConnections(db: Db): Promise<Connection[]> {
  const rows = must(
    await db
      .from("tiktok_shop_connections")
      .select("shop_id, shop_cipher, access_token, access_token_expires_at, refresh_token, refresh_token_expires_at")
      .order("connected_at", { ascending: true }),
    "read shop connections",
  ) as Connection[];
  if (!rows.length) throw new Error("No TikTok shop is connected yet");
  return rows;
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

/**
 * The `*_expire_in` fields are unix timestamps in current sources and the
 * callback treats them so, but the name says "duration". Small numbers are
 * read as seconds-from-now; the raw value and the reading are logged to the
 * token row so this question is settled from data.
 */
function readExpiry(raw: unknown): { date: Date; kind: "unix_timestamp" | "duration" } {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new TikTokError("TikTok returned an invalid token expiry");
  return n > 1_000_000_000
    ? { date: new Date(n * 1000), kind: "unix_timestamp" }
    : { date: new Date(Date.now() + n * 1000), kind: "duration" };
}

export interface RefreshOutcome {
  refreshed: boolean;
  /** Raw expiry fields and how they were read. Never contains a token. */
  details: Row;
}

export function needsRefresh(conn: Connection): boolean {
  return new Date(conn.access_token_expires_at).getTime() - Date.now() < REFRESH_WINDOW_MS;
}

/** Refreshes one connection and writes both new tokens and expiries back before returning. */
export async function refreshConnection(db: Db, creds: Credentials, conn: Connection): Promise<RefreshOutcome> {
  if (new Date(conn.refresh_token_expires_at).getTime() < Date.now()) {
    throw new TikTokError("The refresh token has expired – the shop needs to be re-authorised");
  }
  const url = new URL("/api/v2/token/refresh", AUTH_HOST);
  url.search = new URLSearchParams({
    app_key: creds.app_key,
    app_secret: creds.app_secret,
    refresh_token: conn.refresh_token,
    grant_type: "refresh_token",
  }).toString();

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    throw new TikTokError(`Token refresh failed: ${(e instanceof Error ? e.name : "network error")}`);
  }
  const body = (await res.json().catch(() => null)) as
    | {
      code: number;
      message: string;
      data?: {
        access_token: string;
        access_token_expire_in: number;
        refresh_token: string;
        refresh_token_expire_in: number;
      };
    }
    | null;
  if (!body) throw new TikTokError(`Token refresh: unexpected response from TikTok (HTTP ${res.status})`);
  if (body.code !== 0 || !body.data?.access_token || !body.data.refresh_token) {
    throw new TikTokError(`Token refresh refused: ${body.message || "unknown error"}`, body.code);
  }

  const d = body.data;
  const access = readExpiry(d.access_token_expire_in);
  const refresh = readExpiry(d.refresh_token_expire_in);

  must(
    await db
      .from("tiktok_shop_connections")
      .update({
        access_token: d.access_token,
        access_token_expires_at: access.date.toISOString(),
        refresh_token: d.refresh_token,
        refresh_token_expires_at: refresh.date.toISOString(),
      })
      .eq("shop_id", conn.shop_id),
    "save refreshed tokens",
  );
  conn.access_token = d.access_token;
  conn.access_token_expires_at = access.date.toISOString();
  conn.refresh_token = d.refresh_token;
  conn.refresh_token_expires_at = refresh.date.toISOString();

  return {
    refreshed: true,
    details: {
      access_token_expire_in_raw: d.access_token_expire_in,
      access_token_expire_in_reads_as: access.kind,
      refresh_token_expire_in_raw: d.refresh_token_expire_in,
      refresh_token_expire_in_reads_as: refresh.kind,
      access_expires_at_after: access.date.toISOString(),
      refresh_expires_at_after: refresh.date.toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Signing and the API client
// ---------------------------------------------------------------------------

/** HMAC-SHA256 signature: secret + path + sorted key/value query (minus sign, access_token) + body + secret. */
async function sign(secret: string, path: string, query: Record<string, string>, body?: string): Promise<string> {
  const params = Object.keys(query)
    .filter((k) => k !== "sign" && k !== "access_token")
    .sort()
    .map((k) => k + query[k])
    .join("");
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(secret + path + params + (body ?? "") + secret));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface ApiStats {
  calls: number;
  retries_429: number;
}

export class TikTokApi {
  readonly stats: ApiStats = { calls: 0, retries_429: 0 };
  private lastStart = 0;

  constructor(private creds: Credentials, private conn: Connection) {}

  /** One signed call; returns `data`. Paces at >= 500 ms, backs off on 429, throws on any other failure. */
  async call(opts: { method: "GET" | "POST"; path: string; query?: Record<string, string>; body?: object }): Promise<Row> {
    const bodyStr = opts.method === "POST" ? JSON.stringify(opts.body ?? {}) : undefined;

    for (let attempt = 0;; attempt++) {
      const wait = this.lastStart + MIN_GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastStart = Date.now();
      this.stats.calls++;

      const q: Record<string, string> = {
        ...(opts.query ?? {}),
        app_key: this.creds.app_key,
        shop_cipher: this.conn.shop_cipher,
        timestamp: String(Math.floor(Date.now() / 1000)),
      };
      q.sign = await sign(this.creds.app_secret, opts.path, q, bodyStr);
      const url = new URL(opts.path, API_HOST);
      url.search = new URLSearchParams(q).toString();

      let res: Response;
      try {
        res = await fetch(url, {
          method: opts.method,
          headers: { "x-tts-access-token": this.conn.access_token, "content-type": "application/json" },
          body: bodyStr,
          signal: AbortSignal.timeout(45_000),
        });
      } catch (e) {
        // fetch errors can embed the URL, so only the error type is kept.
        throw new TikTokError(`Network error calling ${opts.path}: ${e instanceof Error ? e.name : "unknown"}`);
      }
      const json = (await res.json().catch(() => null)) as
        | { code?: number; message?: string; request_id?: string; data?: Row }
        | null;

      const limited = res.status === 429 || (json?.code !== undefined && RATE_LIMIT_CODES.has(json.code));
      if (limited) {
        if (attempt >= BACKOFF_MS.length) throw new RateLimitedError();
        this.stats.retries_429++;
        await sleep(BACKOFF_MS[attempt]);
        continue;
      }
      if (!res.ok || !json || json.code !== 0) {
        const msg = (json?.message ?? (json ? "" : "non-JSON response")).replace(/https?:\/\/\S+/gi, "[url]");
        throw new TikTokError(
          `${opts.path}: code ${json?.code ?? "-"} "${msg}" (HTTP ${res.status}, request_id ${json?.request_id ?? "-"})`,
          typeof json?.code === "number" ? json.code : undefined,
        );
      }
      return (json.data ?? {}) as Row;
    }
  }
}
