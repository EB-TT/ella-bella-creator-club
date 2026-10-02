// Creator valuation – Phase 0 test script.
//
//   npx tsx run.ts --platform tiktok --handle somecreator --rate 500
//   npx tsx run.ts --platform instagram --handle somecreator [--ig-source posts|reels]
//   add --dry-run to print planned requests without calling any API
//
// Throwaway validation of Social Fetch data + Haiku comment classification.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Classifier, CLASSIFIER_MODEL, type Label } from "./lib/classify.ts";
import { creatorMetrics, guessCommentOrder, postMetrics, type SampledPost } from "./lib/metrics.ts";
import {
  commentsPath,
  listItems,
  listRoute,
  normaliseComment,
  normalisePost,
  profilePath,
  type CommentsData,
  type IgSource,
  type ListData,
  type Platform,
  type Post,
  type ProfileData,
} from "./lib/platforms.ts";
import { SocialFetch } from "./lib/socialfetch.ts";

const WINDOW_DAYS = 90;
const MIN_AGE_DAYS = 7;
const SAMPLE_POSTS = 20;
const CREDIT_CAP_PER_CREATOR = 30;
const DAY_MS = 86_400_000;

const here = dirname(fileURLToPath(import.meta.url));
const log = (msg = "") => console.log(msg);

// ---------- CLI + env ----------

const { values: args } = parseArgs({
  options: {
    platform: { type: "string" },
    handle: { type: "string" },
    rate: { type: "string" },
    "ig-source": { type: "string", default: "posts" },
    "dry-run": { type: "boolean", default: false },
  },
});

const platform = args.platform as Platform;
if (platform !== "tiktok" && platform !== "instagram") fail("--platform must be tiktok or instagram");
const handle = (args.handle ?? "").trim().replace(/^@/, "");
if (!handle) fail("--handle is required");
const rate = args.rate !== undefined ? Number(args.rate) : null;
if (rate !== null && !(rate > 0)) fail("--rate must be a positive number");
const igSource = args["ig-source"] as IgSource;
if (igSource !== "posts" && igSource !== "reels") fail("--ig-source must be posts or reels");
const dryRun = args["dry-run"] === true;

try {
  process.loadEnvFile(join(here, ".env"));
} catch {
  // no .env file; fall back to the process environment
}
const SOCIALFETCH_API_KEY = process.env.SOCIALFETCH_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!dryRun && !SOCIALFETCH_API_KEY) fail("SOCIALFETCH_API_KEY missing (set it in tools/creator-valuation-test/.env)");

const safeHandle = handle.replace(/[^a-zA-Z0-9._-]/g, "_");
const sf = new SocialFetch({
  apiKey: SOCIALFETCH_API_KEY,
  cacheRoot: join(here, "cache", platform, safeHandle),
  dryRun,
  creditCap: CREDIT_CAP_PER_CREATOR,
  log,
});

// ---------- Run ----------

const now = new Date();
const cutoffOld = new Date(now.getTime() - WINDOW_DAYS * DAY_MS);
const cutoffNew = new Date(now.getTime() - MIN_AGE_DAYS * DAY_MS);

log(`\n=== Creator valuation test: ${platform} @${handle}${dryRun ? "  [DRY RUN]" : ""} ===`);
if (platform === "instagram") log(`Instagram source: /${igSource}`);
const balanceBefore = await sf.balance();
if (!dryRun) log(`Balance before: ${balanceBefore ?? "unknown"}`);

const checks = {
  postsPerPage: [] as number[],
  postPages: 0,
  stoppedPaginationBecause: "" as string,
  dateParseFailures: 0,
  outOfOrderDates: 0,
  commentsPerPage: [] as Array<{ postId: string; returned: number; totalReported: number | null; hasMore: boolean; order: string }>,
  missingFields: {} as Record<string, number>,
  missingFieldsOnPostsChecked: 0,
  notes: [] as string[],
};

// 1. Profile
log(`\n[1/4] Profile`);
const profile = await sf.get<ProfileData>(profilePath(platform, handle));
if (!profile) {
  finishDryRun(`profile not cached; would then list ${platform === "tiktok" ? "videos" : igSource} until older than ${WINDOW_DAYS} days, then fetch 1 comment page for each of the top ${SAMPLE_POSTS} posts`);
}
const status = profile!.data.lookupStatus;
log(`  lookupStatus: ${status}${profile!.data.metrics ? `, followers: ${profile!.data.metrics.followers}, posts: ${profile!.data.metrics.posts}` : ""}`);
if (status !== "found") {
  log(`  Profile is "${status}". Stopping for this creator (videos not fetched).`);
  await finish({ stopped: `profile lookupStatus=${status}` });
}

// 2. Posts
log(`\n[2/4] Posts (latest first, until older than ${WINDOW_DAYS} days)`);
const route = listRoute(platform, handle, igSource);
const allPosts: Post[] = [];
let cursor: string | undefined;
let lastSeen: Date | null = null;
for (;;) {
  const res = await sf.get<ListData>(route.path, { ...route.params, cursor });
  if (!res) {
    checks.stoppedPaginationBecause = dryRun ? "dry run: next page not cached" : `halted (${sf.halted})`;
    break;
  }
  checks.postPages++;
  if (res.data.lookupStatus && res.data.lookupStatus !== "found") {
    checks.stoppedPaginationBecause = `list lookupStatus=${res.data.lookupStatus}`;
    break;
  }
  const items = listItems(platform, res.data, igSource).map((raw) => normalisePost(platform, raw, handle, igSource));
  checks.postsPerPage.push(items.length);
  for (const p of items) {
    if (!p.date) checks.dateParseFailures++;
    if (!p.pinned && p.date) {
      if (lastSeen && p.date > lastSeen) checks.outOfOrderDates++;
      lastSeen = p.date;
    }
  }
  allPosts.push(...items);
  log(`  page ${checks.postPages}: ${items.length} items, hasMore=${res.data.page?.hasMore}, oldest non-pinned=${lastSeen?.toISOString().slice(0, 10) ?? "n/a"}`);

  if (items.length === 0) {
    checks.stoppedPaginationBecause = "empty page";
    break;
  }
  if (!res.data.page?.hasMore || !res.data.page.nextCursor) {
    checks.stoppedPaginationBecause = "hasMore=false";
    break;
  }
  // Pinned posts can be old and sit at the top, so judge by the last non-pinned item.
  const lastChrono = [...items].reverse().find((p) => !p.pinned && p.date);
  if (lastChrono?.date && lastChrono.date < cutoffOld) {
    checks.stoppedPaginationBecause = `reached posts older than ${WINDOW_DAYS} days`;
    break;
  }
  cursor = res.data.page.nextCursor;
}
log(`  stopped: ${checks.stoppedPaginationBecause}`);

// Eligibility
const excluded: Record<string, number> = {};
const exclude = (why: string) => (excluded[why] = (excluded[why] ?? 0) + 1);
const seen = new Set<string>();
const eligible: Post[] = [];
for (const p of allPosts) {
  if (seen.has(p.id)) {
    exclude("duplicate id");
    continue;
  }
  seen.add(p.id);
  if (!p.date) exclude("unparseable date");
  else if (p.date < cutoffOld) exclude(`older than ${WINDOW_DAYS} days`);
  else if (p.date > cutoffNew) exclude(`under ${MIN_AGE_DAYS} days old`);
  else if (platform === "instagram" && p.mediaType !== "video") exclude(`not a reel/video (${p.mediaType ?? "unknown"})`);
  else if (p.views === null) exclude("no view count");
  else eligible.push(p);
}
for (const p of allPosts) {
  checks.missingFieldsOnPostsChecked++;
  for (const f of ["views", "likes", "comments", "shares", "saves"] as const) {
    if (p[f] === null) checks.missingFields[f] = (checks.missingFields[f] ?? 0) + 1;
  }
}
log(`  fetched ${allPosts.length}, eligible ${eligible.length}`);
for (const [why, n] of Object.entries(excluded)) log(`  excluded ${n}: ${why}`);

// 3. Comments
const sample = [...eligible].sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, SAMPLE_POSTS);
log(`\n[3/4] Comments: 1 page for each of the top ${sample.length} posts by views`);
const sampled = new Map<string, SampledPost>();
let commentsPlanned = 0;
for (const post of sample) {
  const res = await sf.get<CommentsData>(commentsPath(platform), { url: post.url });
  if (!res) {
    commentsPlanned++;
    continue;
  }
  if (res.data.lookupStatus !== "found") {
    log(`  ${post.id}: comments lookupStatus=${res.data.lookupStatus}`);
    checks.commentsPerPage.push({ postId: post.id, returned: 0, totalReported: null, hasMore: false, order: res.data.lookupStatus });
    continue;
  }
  const comments = (res.data.comments ?? []).map((c) => normaliseComment(platform, c));
  const order = guessCommentOrder(comments);
  checks.commentsPerPage.push({
    postId: post.id,
    returned: comments.length,
    totalReported: res.data.totalComments ?? null,
    hasMore: res.data.page?.hasMore ?? false,
    order,
  });
  log(`  ${post.id}: ${comments.length} comments (post says ${post.comments ?? "?"}), order: ${order}`);
  sampled.set(post.id, { post, comments, labels: new Map() });
}
if (commentsPlanned) log(`  ${commentsPlanned} comment page(s) not fetched (${dryRun ? "planned" : sf.halted})`);

// 4. Classification
log(`\n[4/4] Classification (${CLASSIFIER_MODEL})`);
const classifier = new Classifier(dryRun ? undefined : ANTHROPIC_API_KEY, join(here, "cache", "classifications", `${platform}.json`), log);
await classifier.load();
if (!dryRun && !classifier.enabled) log("  ANTHROPIC_API_KEY missing: skipping classification (cached labels still used).");
for (const s of sampled.values()) {
  if (s.comments.length === 0) continue;
  s.labels = await classifier.classifyPost(s.post.id, s.post.caption, s.comments);
}
const unclassified = [...sampled.values()].reduce((a, s) => a + [...s.labels.values()].filter((l) => l === "unclassified").length, 0);
log(`  API calls: ${classifier.apiCalls}, cached labels: ${classifier.cacheHits}, unclassified comments: ${unclassified}, parse failures: ${classifier.parseFailures}`);

if (dryRun) finishDryRun(`${unclassified} comment(s) would be sent to ${CLASSIFIER_MODEL}`);

// ---------- Metrics + output ----------

const rows = eligible.map((p) => postMetrics(platform, p, sampled.get(p.id)));
const creator = creatorMetrics(platform, rows, rate, classifier.enabled || classifier.cacheHits > 0);
await finish({});

// ---------- helpers ----------

async function finish(opts: { stopped?: string }): Promise<never> {
  const balanceAfter = await sf.balance();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const outDir = join(here, "output", `${platform}_${safeHandle}_${date}`);
  await mkdir(outDir, { recursive: true });

  const haveMetrics = !opts.stopped;
  const summary = {
    platform,
    handle,
    runAt: now.toISOString(),
    window: { from: cutoffOld.toISOString(), to: cutoffNew.toISOString(), note: `posts ${MIN_AGE_DAYS}-${WINDOW_DAYS} days old` },
    stopped: opts.stopped ?? (sf.halted ? `API requests halted: ${sf.halted}` : null),
    profile: profile?.data ? { lookupStatus: profile.data.lookupStatus, followers: profile.data.metrics?.followers ?? null } : null,
    instagramSource: platform === "instagram" ? igSource : undefined,
    posts: haveMetrics ? { fetched: allPosts.length, counted: eligible.length, sampledForComments: sampled.size, excluded } : null,
    metrics: haveMetrics ? creator : null,
    classifier: haveMetrics ? { model: CLASSIFIER_MODEL, enabled: classifier.enabled, apiCalls: classifier.apiCalls, cachedLabels: classifier.cacheHits, parseFailures: classifier.parseFailures, unclassifiedComments: unclassified } : null,
    credits: { usedThisRun: sf.creditsUsed, cap: CREDIT_CAP_PER_CREATOR, capped: sf.halted === "credit_cap", balanceBefore, balanceAfter },
    requests: sf.requests,
    dataChecks: checks,
  };
  await writeFile(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));

  if (haveMetrics) {
    await writeCsv(
      join(outDir, "posts.csv"),
      ["id", "date", "url", "views", "likes", "comments", "shares", "saves", "engagement", "sampled", "flagged_count", "tar"],
      rows.map((r) => [r.post.id, r.post.createdAt, r.post.url, r.post.views, r.post.likes, r.post.comments, r.post.shares, r.post.saves, r.engagement === null ? null : r.engagement.toFixed(5), r.sampled ? "y" : "n", r.flaggedCount, r.tar === null ? null : r.tar.toFixed(5)]),
    );
    const commentRows: unknown[][] = [];
    for (const s of sampled.values()) {
      for (const c of s.comments) {
        const l: Label = s.labels.get(c.id) ?? "unclassified";
        commentRows.push([s.post.id, c.id, c.text, c.likes, String(l)]);
      }
    }
    await writeCsv(join(outDir, "comments.csv"), ["post_id", "comment_id", "text", "likes", "product_interest"], commentRows);
    printSummary();
  }

  printDataChecks(balanceAfter);
  log(`\nOutput: ${outDir}`);
  process.exit(0);
}

function printSummary(): void {
  const m = creator;
  const money = (x: number | null) => (x === null ? "n/a" : `$${x.toFixed(2)}`);
  const pctOrNa = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(2)}%`);
  const tag = (r: string | null) => (r ? ` [${r.toUpperCase()}]` : "");
  log(`\n--- Summary: ${platform} @${handle} ---`);
  log(`Posts counted:        ${m.postsCounted} (of ${allPosts.length} fetched)`);
  log(`Median views:         ${m.medianViews ?? "n/a"}`);
  log(`Engagement (agg):     ${pctOrNa(m.engagementAggregate)}${tag(m.rag.engagementAggregate)}${m.engagementPartial ? "  (partial: no shares/saves)" : ""}`);
  log(`Engagement (mean):    ${pctOrNa(m.engagementMean)}${tag(m.rag.engagementMean)}`);
  log(`TAR (sampled agg):    ${m.tar === null ? `n/a – ${m.tarNote}` : `${pctOrNa(m.tar)}${tag(m.rag.tar)} over ${m.tarPostsUsed} posts`}`);
  log(`Suggested rate:       ${money(m.suggestedRateLow)} – ${money(m.suggestedRateHigh)}`);
  if (m.quotedRate !== null) log(`Quoted rate / CPM:    ${money(m.quotedRate)} → CPM ${money(m.cpm)}${tag(m.rag.cpm)}`);
}

function printDataChecks(balanceAfter: number | null): void {
  const c = checks;
  const counts = c.commentsPerPage.map((x) => x.returned);
  const orders: Record<string, number> = {};
  for (const x of c.commentsPerPage) orders[x.order] = (orders[x.order] ?? 0) + 1;
  log(`\n--- Data checks ---`);
  log(`Posts per page:       ${c.postsPerPage.length ? c.postsPerPage.join(", ") : "n/a"} (${c.postPages} page(s); stopped: ${c.stoppedPaginationBecause || "n/a"})`);
  log(`90-day filter:        ${c.dateParseFailures} unparseable date(s), ${c.outOfOrderDates} out-of-order non-pinned post(s)`);
  log(`Comments per page:    ${counts.length ? `${counts.join(", ")} (min ${Math.min(...counts)}, max ${Math.max(...counts)})` : "n/a"}`);
  log(`Comment sort order:   ${Object.entries(orders).map(([k, v]) => `${k} ×${v}`).join("; ") || "n/a"}`);
  const missing = Object.entries(c.missingFields).map(([k, v]) => `${k} ${v}/${c.missingFieldsOnPostsChecked}`);
  log(`Missing fields (${platform}): ${missing.length ? missing.join(", ") : "none"}${platform === "instagram" ? "  (shares/saves not in Social Fetch Instagram schema)" : ""}`);
  log(`Credits this run:     ${sf.creditsUsed}${sf.halted ? ` (halted: ${sf.halted})` : ""}`);
  log(`Balance:              before ${balanceBefore ?? "n/a"}, after ${balanceAfter ?? "n/a"}`);
}

function finishDryRun(next: string): never {
  log(`\n--- Dry run: requests ---`);
  for (const r of sf.requests) {
    const qs = new URLSearchParams(r.params).toString();
    log(`  ${r.source.padEnd(7)} GET ${r.path}${qs ? `?${qs}` : ""}${r.note ? `  (${r.note})` : ""}`);
  }
  const cached = sf.requests.filter((r) => r.source === "cache").length;
  const planned = sf.requests.filter((r) => r.source === "planned").length;
  log(`\n  ${cached} cached (0 credits), ${planned} planned at ~1 credit each.`);
  log(`  Then: ${next}.`);
  log(`  Per-creator cap: ${CREDIT_CAP_PER_CREATOR} credits. Typical uncached run: 1 profile + 1–4 list pages + up to ${SAMPLE_POSTS} comment pages ≈ 22–25 credits.`);
  log(`  No API was called and no output was written.`);
  process.exit(0);
}

async function writeCsv(file: string, header: string[], rows: unknown[][]): Promise<void> {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(","));
  // BOM so Excel reads emoji/UTF-8 correctly
  await writeFile(file, "﻿" + lines.join("\r\n") + "\r\n");
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // Stop Excel treating "@handle" / "=..." comments as formulas
  if (/^[=+\-@]/.test(s) && typeof v === "string") s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function fail(msg: string): never {
  console.error(`Error: ${msg}`);
  process.exit(1);
}
