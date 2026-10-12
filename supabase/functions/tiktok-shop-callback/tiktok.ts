// TikTok Shop Open API helpers: credentials, token exchange, request signing
// and the authorised-shops lookup. The callback uses these now; the order/GMV
// sync will reuse them later, so nothing here is callback-specific.
//
// Nothing in this file logs. Callers decide what to log, and must never log
// tokens, the app secret or the auth code.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type Region = "us" | "global";

export interface Credentials {
  app_key: string;
  app_secret: string;
  service_id: string;
  region: Region;
}

// Hosts per Partner Center region. Every source we could check uses the same
// auth and API hosts for US and global apps, so both regions share them. The
// official docs pages (partner.tiktokshop.com/docv2) don't render outside a
// browser, so this hasn't been confirmed there. If a US app's token exchange
// fails with a host or DNS error, check the US docs and change the `us` entry.
export const HOSTS: Record<Region, { auth: string; api: string }> = {
  us: { auth: "https://auth.tiktok-shops.com", api: "https://open-api.tiktokglobalshop.com" },
  global: { auth: "https://auth.tiktok-shops.com", api: "https://open-api.tiktokglobalshop.com" },
};

export class TikTokError extends Error {
  readonly code?: number;

  constructor(message: string, code?: number) {
    super(message);
    this.name = "TikTokError";
    this.code = code;
  }
}

/** Reads the single credentials row. Throws "Not set up yet" if there isn't one. */
export async function loadCredentials(supabase: SupabaseClient): Promise<Credentials> {
  const { data, error } = await supabase
    .from("tiktok_app_credentials")
    .select("app_key, app_secret, service_id, region")
    .eq("id", true)
    .maybeSingle<Credentials>();
  if (error) throw new Error(`Couldn't read credentials: ${error.message}`);
  if (!data) throw new Error("Not set up yet");
  return data;
}

export interface Tokens {
  access_token: string;
  access_token_expires_at: Date;
  refresh_token: string;
  refresh_token_expires_at: Date;
  open_id: string | null;
  seller_name: string | null;
  granted_scopes: string[] | null;
}

interface TokenResponse {
  code: number;
  message: string;
  data?: {
    access_token: string;
    access_token_expire_in: number;
    refresh_token: string;
    refresh_token_expire_in: number;
    open_id?: string;
    seller_name?: string;
    granted_scopes?: string[];
  };
}

/**
 * The `*_expire_in` fields are, despite the name, absolute unix timestamps in
 * seconds, not durations. A small value is treated as seconds-from-now so a
 * change on TikTok's side can't produce 1970 expiry dates.
 */
function expiryToDate(value: number): Date {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new TikTokError("TikTok returned an invalid token expiry");
  return n > 1_000_000_000 ? new Date(n * 1000) : new Date(Date.now() + n * 1000);
}

function toTokens(data: NonNullable<TokenResponse["data"]>): Tokens {
  return {
    access_token: data.access_token,
    access_token_expires_at: expiryToDate(data.access_token_expire_in),
    refresh_token: data.refresh_token,
    refresh_token_expires_at: expiryToDate(data.refresh_token_expire_in),
    open_id: data.open_id || null,
    seller_name: data.seller_name || null,
    granted_scopes: Array.isArray(data.granted_scopes) ? data.granted_scopes : null,
  };
}

async function tokenRequest(creds: Credentials, path: string, params: Record<string, string>): Promise<Tokens> {
  const url = new URL(path, HOSTS[creds.region].auth);
  url.search = new URLSearchParams({ app_key: creds.app_key, app_secret: creds.app_secret, ...params }).toString();

  const res = await fetch(url);
  const body = (await res.json().catch(() => null)) as TokenResponse | null;
  if (!body) throw new TikTokError(`Unexpected response from TikTok (HTTP ${res.status})`);
  if (body.code !== 0 || !body.data) throw new TikTokError(body.message || "Unknown error", body.code);
  return toTokens(body.data);
}

/** Swaps the one-time auth code from the redirect for access + refresh tokens. */
export function exchangeAuthCode(creds: Credentials, code: string): Promise<Tokens> {
  return tokenRequest(creds, "/api/v2/token/get", { auth_code: code, grant_type: "authorized_code" });
}

/** Gets fresh tokens before the access token expires. For the sync. */
export function refreshTokens(creds: Credentials, refreshToken: string): Promise<Tokens> {
  return tokenRequest(creds, "/api/v2/token/refresh", { refresh_token: refreshToken, grant_type: "refresh_token" });
}

/**
 * TikTok's request signature (HMAC-SHA256, lowercase hex):
 *   1. take the query params except `sign` and `access_token`, sorted by key
 *   2. concatenate them as key + value
 *   3. prepend the request path; append the JSON body if there is one
 *      (not for multipart uploads, which this helper doesn't support)
 *   4. wrap the whole string with the app secret at both ends
 *   5. HMAC-SHA256 it, keyed with the app secret, and hex-encode
 */
export async function signRequest(
  creds: Credentials,
  path: string,
  query: Record<string, string>,
  body?: string,
): Promise<string> {
  const params = Object.keys(query)
    .filter((k) => k !== "sign" && k !== "access_token")
    .sort()
    .map((k) => k + query[k])
    .join("");
  const payload = creds.app_secret + path + params + (body ?? "") + creds.app_secret;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(creds.app_secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface Shop {
  id: string;
  name: string;
  region: string;
  seller_type: string;
  cipher: string;
  code: string;
}

/**
 * Lists the shops this access token is authorised for. Each shop's `cipher`
 * must be sent as `shop_cipher` on every later shop-scoped call. This
 * endpoint itself takes no shop_cipher.
 */
export async function getAuthorizedShops(creds: Credentials, accessToken: string): Promise<Shop[]> {
  const path = "/authorization/202309/shops";
  const query: Record<string, string> = {
    app_key: creds.app_key,
    timestamp: String(Math.floor(Date.now() / 1000)),
  };
  query.sign = await signRequest(creds, path, query);

  const url = new URL(path, HOSTS[creds.region].api);
  url.search = new URLSearchParams(query).toString();

  const res = await fetch(url, {
    headers: { "x-tts-access-token": accessToken, "content-type": "application/json" },
  });
  const body = (await res.json().catch(() => null)) as
    | { code: number; message: string; data?: { shops?: Shop[] } }
    | null;
  if (!body) throw new TikTokError(`Unexpected response from TikTok (HTTP ${res.status})`);
  if (body.code !== 0) throw new TikTokError(body.message || "Unknown error", body.code);
  return body.data?.shops ?? [];
}
