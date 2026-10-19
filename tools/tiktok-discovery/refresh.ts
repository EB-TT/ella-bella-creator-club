// Opt-in token refresh (`--refresh`). Refreshing may invalidate the old tokens
// immediately, so this prints the new ones to the terminal ONLY, as a ready-to-run
// SQL update. It never writes tokens to disk and never goes through findings.md.
//
// This is the one place credentials are printed on purpose, so it uses
// console.log directly rather than the redacting log().

import { createInterface } from "node:readline/promises";
import { redact } from "./util.ts";

const SHOP_ID = "7495062708001868729";

export async function refresh(env: { appKey: string; appSecret: string; refreshToken: string }): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    "This calls TikTok's token refresh. The OLD access and refresh tokens may stop working straight away,\n" +
      "so you must apply the SQL it prints. Type 'yes' to continue: ",
  );
  rl.close();
  if (answer.trim() !== "yes") {
    console.log("Cancelled. Nothing was called.");
    return;
  }

  const url = new URL("https://auth.tiktok-shops.com/api/v2/token/refresh");
  url.search = new URLSearchParams({
    app_key: env.appKey,
    app_secret: env.appSecret,
    refresh_token: env.refreshToken,
    grant_type: "refresh_token",
  }).toString();

  let json: { code?: number; message?: string; request_id?: string; data?: Record<string, unknown> } | null;
  let status: number;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    status = res.status;
    json = await res.json().catch(() => null);
  } catch (e) {
    console.error(`Refresh request failed: ${redact(e instanceof Error ? e.message : String(e))}`);
    process.exitCode = 1;
    return;
  }

  const d = json?.data;
  if (!json || json.code !== 0 || !d || typeof d.access_token !== "string" || typeof d.refresh_token !== "string") {
    console.error(`Refresh failed: HTTP ${status}, code ${json?.code ?? "-"}, "${redact(json?.message ?? "no JSON body")}", request_id ${json?.request_id ?? "-"}`);
    console.error("Nothing was changed. Your existing tokens are untouched (unless TikTok already rotated them; check the app).");
    process.exitCode = 1;
    return;
  }

  console.log(`\nHTTP ${status}, code ${json.code}, request_id ${json.request_id ?? "-"}\n`);
  console.log("Non-token fields exactly as returned:");
  for (const [k, v] of Object.entries(d)) {
    if (k === "access_token" || k === "refresh_token") continue;
    let note = "";
    if (/expire/i.test(k) && typeof v === "number") {
      note = v > 1_000_000_000
        ? `  <- looks like a unix TIMESTAMP (${new Date(v * 1000).toISOString()})`
        : `  <- looks like a DURATION in seconds (~${(v / 86400).toFixed(1)} days)`;
    }
    console.log(`  ${k}: ${JSON.stringify(v)}${note}`);
  }

  const expr = (k: string) => {
    const v = d[k];
    if (typeof v !== "number") return "null";
    return v > 1_000_000_000 ? `to_timestamp(${v})` : `now() + interval '${v} seconds'`;
  };
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

  console.log("\n==================================================================");
  console.log("RUN THIS SQL IMMEDIATELY. The old tokens may stop working.");
  console.log("==================================================================\n");
  console.log(
    `update public.tiktok_shop_connections set access_token = ${q(d.access_token)}, access_token_expires_at = ${expr("access_token_expire_in")}, refresh_token = ${q(d.refresh_token)}, refresh_token_expires_at = ${expr("refresh_token_expire_in")}, updated_at = now() where shop_id = '${SHOP_ID}';\n`,
  );
  console.log("Then update TIKTOK_ACCESS_TOKEN and TIKTOK_REFRESH_TOKEN in .env with the new values.");
  console.log("Tokens were not written to disk by this script. Clear your terminal scrollback when done.");
}
