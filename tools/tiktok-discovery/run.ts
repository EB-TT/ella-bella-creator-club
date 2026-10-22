// Phase 0: read-only TikTok Shop discovery. See README.md.
//
//   npx tsx run.ts                 run every section
//   npx tsx run.ts --only samples  run one section
//   npx tsx run.ts --refresh       opt-in token refresh (runs on its own)
//
// Writes only output/findings.md and output/samples/<section>.json.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { refresh } from "./refresh.ts";
import { affiliate } from "./sections/affiliate.ts";
import { analytics } from "./sections/analytics.ts";
import { collabs } from "./sections/collabs.ts";
import { content } from "./sections/content.ts";
import { orderdetail } from "./sections/orderdetail.ts";
import { samples } from "./sections/samples.ts";
import type { Ctx, Section } from "./sections/types.ts";
import { Client } from "./tiktok.ts";
import { OUTPUT_DIR, fmtSecs, log, redact, registerSecrets, scrub, table, writeOut } from "./util.ts";

const SECTIONS: Record<string, Section> = { affiliate, samples, orderdetail, collabs, content, analytics };
const ORDER = Object.keys(SECTIONS);
// Sections that read IDs gathered by the samples section.
const NEEDS_SAMPLES = new Set(["orderdetail", "content"]);

const ENV_KEYS = ["TIKTOK_APP_KEY", "TIKTOK_APP_SECRET", "TIKTOK_ACCESS_TOKEN", "TIKTOK_REFRESH_TOKEN", "TIKTOK_SHOP_CIPHER"] as const;

function fail(msg: string): never {
  console.error(redact(msg));
  process.exit(1);
}

function loadEnv(): Record<(typeof ENV_KEYS)[number], string> {
  try {
    process.loadEnvFile(path.join(import.meta.dirname, ".env"));
  } catch {
    fail("No .env found. Copy .env.example to .env and fill it in (see README.md).");
  }
  const missing = ENV_KEYS.filter((k) => !process.env[k]?.trim());
  if (missing.length) fail(`Missing in .env: ${missing.join(", ")}`);
  const env = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]!.trim()])) as Record<(typeof ENV_KEYS)[number], string>;
  registerSecrets(...Object.values(env));
  return env;
}

// ---- findings.md, merged per section so `--only` doesn't wipe the rest -----

const open = (n: string) => `<!-- section:${n} -->`;
const close = (n: string) => `<!-- /section:${n} -->`;

async function writeFindings(updated: Map<string, string>): Promise<void> {
  const existing = new Map<string, string>();
  try {
    const old = await readFile(path.join(OUTPUT_DIR, "findings.md"), "utf8");
    for (const m of old.matchAll(/<!-- section:(\w+) -->\n([\s\S]*?)\n<!-- \/section:\1 -->/g)) existing.set(m[1], m[2]);
  } catch {
    // first run
  }
  for (const [k, v] of updated) existing.set(k, v);
  const body = ORDER.filter((n) => existing.has(n)).map((n) => `${open(n)}\n${existing.get(n)}\n${close(n)}`);
  // Timing footer, rebuilt from every section's stored timing marker (so `--only` keeps the others' rows).
  const timingRows: (string | number)[][] = [];
  let totalCalls = 0;
  let totalApi = 0;
  let totalWall = 0;
  for (const n of ORDER) {
    const m = existing.get(n)?.match(/<!-- timing:(\d+)\|(\d+)\|(\d+) -->/);
    if (!m) continue;
    const [calls, apiMs, wallMs] = [Number(m[1]), Number(m[2]), Number(m[3])];
    totalCalls += calls;
    totalApi += apiMs;
    totalWall += wallMs;
    timingRows.push([n, calls, fmtSecs(apiMs), fmtSecs(wallMs), calls ? Math.round(apiMs / calls) : 0]);
  }
  timingRows.push(["**total**", totalCalls, fmtSecs(totalApi), fmtSecs(totalWall), totalCalls ? Math.round(totalApi / totalCalls) : 0]);
  const timing = [
    "## Timing",
    "",
    "Sizes the hourly sync against the Edge Function limit (150 s free / 400 s paid). \"API seconds\" is time inside requests; \"wall seconds\" also includes the 300 ms pacing between calls. Rows are from the last run of each section.",
    "",
    table(["section", "calls", "API seconds", "wall seconds", "avg ms per call"], timingRows),
  ].join("\n");
  const head = [
    "# TikTok Shop discovery findings",
    "",
    `Last updated: ${new Date().toISOString()}. Sections re-run this time: ${[...updated.keys()].join(", ")}.`,
    "",
    "> Contains creator usernames and stats. No buyer data and no credentials. Delete `output/` when finished.",
    "",
  ].join("\n");
  await writeOut("findings.md", head + "\n" + body.join("\n\n") + "\n\n" + timing + "\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const onlyIdx = args.indexOf("--only");
  const only = onlyIdx >= 0 ? args[onlyIdx + 1] : undefined;
  const known = new Set(["--only", "--refresh", only ?? ""]);
  const stray = args.filter((a) => !known.has(a));
  if (stray.length) fail(`Unknown argument(s): ${stray.join(" ")}. Usage: run.ts [--only <${ORDER.join("|")}>] [--refresh]`);

  const env = loadEnv();

  if (args.includes("--refresh")) {
    if (only) fail("--refresh runs on its own; don't combine it with --only.");
    await refresh({ appKey: env.TIKTOK_APP_KEY, appSecret: env.TIKTOK_APP_SECRET, refreshToken: env.TIKTOK_REFRESH_TOKEN });
    return;
  }
  if (onlyIdx >= 0 && !(only && only in SECTIONS)) fail(`--only needs one of: ${ORDER.join(", ")} (refresh is the separate --refresh flag)`);

  const plan = only ? [...(NEEDS_SAMPLES.has(only) ? ["samples"] : []), only] : ORDER;
  const client = new Client({
    appKey: env.TIKTOK_APP_KEY,
    appSecret: env.TIKTOK_APP_SECRET,
    accessToken: env.TIKTOK_ACCESS_TOKEN,
    shopCipher: env.TIKTOK_SHOP_CIPHER,
  });
  const ctx: Ctx = {};
  const findings = new Map<string, string>();

  for (const name of plan) {
    log(`\n== ${name}${only && name !== only ? " (needed by " + only + ")" : ""} ==`);
    client.beginSection();
    let md: string;
    let examples: unknown[] = [];
    try {
      const r = await SECTIONS[name](client, ctx);
      md = r.md;
      examples = r.samples;
    } catch (e) {
      const msg = redact(e instanceof Error ? e.message : String(e));
      log(`  section crashed: ${msg}`);
      md = `### Errors\n\n- Section crashed: ${msg}`;
    }
    const t = client.timing();
    findings.set(
      name,
      `## ${name}\n\n${md}\n\n### API calls\n\n${client.summaryMd()}\n\n<!-- timing:${t.calls}|${t.apiMs}|${t.wallMs} -->`,
    );
    if (examples.length) await writeOut(`samples/${name}.json`, JSON.stringify(scrub(examples.slice(0, 3)), null, 2) + "\n");
  }

  await writeFindings(findings);
  log(`\nDone. Read output/findings.md`);
}

main().catch((e) => {
  // Message only: no stack, and always redacted.
  console.error(redact(e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
