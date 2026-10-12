// tiktok-shop-callback: the Redirect URL registered in TikTok Partner Center.
//
// After the shop owner clicks Authorise, TikTok sends their browser here with
// a one-time `code`. We swap it for tokens, look up the authorised shop(s)
// and store one row per shop in public.tiktok_shop_connections.
//
// Deployed with JWT verification off: TikTok's redirect carries no Supabase
// auth. Responses are plain text because a person reads them in a browser tab
// (and Supabase serves function HTML as plain text anyway).
//
// `state`: our flow never sets one (the link comes from Partner Center), so
// it's ignored if present and not required. That's acceptable here because
// this is a Custom app that only the linked seller can authorise, and a code
// is useless without the app secret, which never leaves the server.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { exchangeAuthCode, getAuthorizedShops, loadCredentials, TikTokError } from "./tiktok.ts";

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

function admin(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not available");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

Deno.serve(async (req) => {
  if (req.method !== "GET") return text(405, "Method not allowed");

  const params = new URL(req.url).searchParams;
  const code = (params.get("code") || params.get("auth_code") || "").trim();
  if (!code) return text(400, "Authorisation code missing");

  let db: SupabaseClient;
  try {
    db = admin();
  } catch (err) {
    console.error(`callback: ${(err as Error).message}`);
    return text(500, "Couldn't save the connection");
  }

  let creds;
  try {
    creds = await loadCredentials(db);
  } catch (err) {
    const message = (err as Error).message;
    console.error(`callback: ${message}`);
    if (message !== "Not set up yet") return text(500, "Couldn't save the connection");
    return text(409, "Not set up yet – enter the app details on the setup page first, then click Authorise again");
  }

  let tokens;
  try {
    tokens = await exchangeAuthCode(creds, code);
  } catch (err) {
    const message = (err as Error).message;
    console.error(`callback: token exchange failed (${(err as TikTokError).code ?? "no code"}): ${message}`);
    return text(400, `TikTok rejected the code: ${message} – click Authorise again`);
  }

  let shops;
  try {
    shops = await getAuthorizedShops(creds, tokens.access_token);
  } catch (err) {
    const message = (err as Error).message;
    console.error(`callback: get authorized shops failed (${(err as TikTokError).code ?? "no code"}): ${message}`);
    return text(502, `TikTok didn't return the shop: ${message} – click Authorise again`);
  }
  if (shops.length === 0) {
    console.error("callback: token exchange worked but no authorised shops came back");
    return text(502, "TikTok didn't return any authorised shop – click Authorise again");
  }

  // One authorisation covers every shop it lists, so they all share the tokens.
  const rows = shops.map((shop) => ({
    shop_id: shop.id,
    shop_cipher: shop.cipher,
    shop_name: shop.name || null,
    shop_code: shop.code || null,
    region: shop.region || null,
    seller_type: shop.seller_type || null,
    seller_name: tokens.seller_name,
    open_id: tokens.open_id,
    access_token: tokens.access_token,
    access_token_expires_at: tokens.access_token_expires_at.toISOString(),
    refresh_token: tokens.refresh_token,
    refresh_token_expires_at: tokens.refresh_token_expires_at.toISOString(),
    granted_scopes: tokens.granted_scopes,
  }));

  const { error } = await db.from("tiktok_shop_connections").upsert(rows, { onConflict: "shop_id" });
  if (error) {
    console.error(`callback: saving connection failed: ${error.message}`);
    return text(500, "Couldn't save the connection");
  }

  for (const shop of shops) {
    console.log(
      `callback: connected shop ${shop.id} (${shop.region}); access token expires ` +
        `${tokens.access_token_expires_at.toISOString()}, refresh token expires ` +
        `${tokens.refresh_token_expires_at.toISOString()}`,
    );
  }

  const names = shops.map((s) => `${s.name || s.id} (${s.region || "unknown region"})`).join(", ");
  return text(200, `Connected: ${names}. All done – you can close this tab.`);
});
