// The valuation run itself: profile → recent posts → comments on the top posts
// → classification → metrics. Ported from tools/creator-valuation-test/run.ts.

import { Classifier, CLASSIFIER_MODEL, promptHash } from "./classify.ts";
import { creatorMetrics, postMetrics, type SampledPost } from "./metrics.ts";
import { adapterFor, type CommentsData, type ListData, type Platform, type Post, type ProfileData } from "./platforms.ts";
import { mapLimit, type SocialFetch } from "./socialfetch.ts";

const WINDOW_DAYS = 90;
const MIN_AGE_DAYS = 7;
const SAMPLE_POSTS = 20;
// Caps list pages so heavy posters still leave credits for comments
// (1 profile + 8 list pages + 20 comment pages = 29, under the 30-credit cap).
const MAX_LIST_PAGES = 8;
export const CREDIT_CAP_PER_RUN = 30;
const MAX_FLAGGED_COMMENTS = 50;
const CONCURRENCY = 4;
const DAY_MS = 86_400_000;

/** A failure with a message that's fit to show the team as-is. */
export class ValuationError extends Error {}

export interface ValuationResults {
  followers: number | null;
  median_views: number | null;
  posts_fetched: number;
  posts_counted: number;
  excluded: Record<string, number>;
  window_truncated: boolean;
  engagement_agg: number | null;
  engagement_mean: number | null;
  tar: number | null;
  tar_posts: number;
  comments_sampled: number;
  comments_flagged: number;
  comments_unclassified: number;
  suggested_rate_low: number | null;
  suggested_rate_high: number | null;
  classifier_model: string;
  prompt_hash: string;
  posts: Array<{
    id: string;
    url: string;
    posted_at: string | null;
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    saves: number | null;
    engagement: number | null;
    sampled: boolean;
    flagged: number | null;
    tar: number | null;
  }>;
  flagged_comments: Array<{ post_id: string; text: string; likes: number | null }>;
}

export interface ValuateDeps {
  sf: SocialFetch;
  anthropicKey: string | undefined;
  log: (msg: string) => void;
}

export async function valuate(platform: Platform, handle: string, { sf, anthropicKey, log }: ValuateDeps): Promise<ValuationResults> {
  const adapter = adapterFor(platform);
  const now = Date.now();
  const cutoffOld = new Date(now - WINDOW_DAYS * DAY_MS);
  const cutoffNew = new Date(now - MIN_AGE_DAYS * DAY_MS);

  // 1. Profile
  const profile = await sf.get<ProfileData>(adapter.profilePath(handle));
  if (!profile) throw haltedError(sf);
  const status = profile.data.lookupStatus;
  if (status !== "found") throw new ValuationError(`Profile lookup returned "${status}" – check the handle`);
  log(`profile found, followers ${profile.data.metrics?.followers ?? "?"}`);

  // 2. Posts, latest first, until older than the window or the page cap
  const route = adapter.listRoute(handle);
  const allPosts: Post[] = [];
  let cursor: string | undefined;
  let windowTruncated = false;
  for (let page = 0; ; page++) {
    if (page >= MAX_LIST_PAGES) {
      windowTruncated = true;
      break;
    }
    const res = await sf.get<ListData>(route.path, { ...route.params, cursor });
    if (!res) {
      if (sf.halted === "out_of_credits") throw haltedError(sf);
      windowTruncated = true;
      break;
    }
    if (res.data.lookupStatus && res.data.lookupStatus !== "found") {
      if (page === 0) throw new ValuationError(`Post list lookup returned "${res.data.lookupStatus}"`);
      break;
    }
    const items = adapter.listItems(res.data).map((raw) => adapter.normalisePost(raw, handle));
    allPosts.push(...items);
    log(`list page ${page + 1}: ${items.length} items, hasMore=${res.data.page?.hasMore}`);
    if (items.length === 0 || !res.data.page?.hasMore || !res.data.page.nextCursor) break;
    // Pinned posts can be old and sit at the top, so judge by the last non-pinned item.
    const lastChrono = [...items].reverse().find((p) => !p.pinned && p.date);
    if (lastChrono?.date && lastChrono.date < cutoffOld) break;
    cursor = res.data.page.nextCursor;
  }

  // Eligibility: 7–90 days old, with a view count
  const excluded: Record<string, number> = { under_7_days: 0, older_than_90_days: 0, no_views: 0 };
  const exclude = (why: string) => (excluded[why] = (excluded[why] ?? 0) + 1);
  const seen = new Set<string>();
  const unique: Post[] = [];
  const eligible: Post[] = [];
  for (const p of allPosts) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    unique.push(p);
    const reason = adapter.ineligibleReason(p);
    if (!p.date) exclude("unparseable_date");
    else if (p.date < cutoffOld) exclude("older_than_90_days");
    else if (p.date > cutoffNew) exclude("under_7_days");
    else if (reason) exclude(reason);
    else if (p.views === null) exclude("no_views");
    else eligible.push(p);
  }
  log(`fetched ${unique.length}, eligible ${eligible.length}`);

  // 3. Comments: one page for each of the top posts by views
  const sample = [...eligible].sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, SAMPLE_POSTS);
  const sampled = new Map<string, SampledPost>();
  await mapLimit(sample, CONCURRENCY, async (post) => {
    const res = await sf.get<CommentsData>(adapter.commentsPath(), { url: post.url });
    if (!res) return;
    if (res.data.lookupStatus !== "found") {
      log(`comments for ${post.id}: lookupStatus=${res.data.lookupStatus}`);
      return;
    }
    const comments = (res.data.comments ?? []).map((c) => adapter.normaliseComment(c));
    sampled.set(post.id, { post, comments, labels: new Map() });
  });
  if (sf.halted) log(`comment fetching stopped early (${sf.halted}); ${sampled.size}/${sample.length} posts sampled`);

  // 4. Classification
  const classifier = new Classifier(anthropicKey, log);
  await mapLimit([...sampled.values()], CONCURRENCY, async (s) => {
    s.labels = await classifier.classifyPost(s.post.id, s.post.caption, s.comments);
  });

  // Metrics
  const rows = eligible.map((p) => postMetrics(platform, p, sampled.get(p.id)));
  const m = creatorMetrics(platform, rows, classifier.enabled);

  let commentsSampled = 0;
  let commentsUnclassified = 0;
  const flagged: ValuationResults["flagged_comments"] = [];
  for (const s of sampled.values()) {
    for (const c of s.comments) {
      commentsSampled++;
      const label = s.labels.get(c.id) ?? "unclassified";
      if (label === "unclassified") commentsUnclassified++;
      else if (label) flagged.push({ post_id: s.post.id, text: c.text, likes: c.likes });
    }
  }
  flagged.sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0));

  log(`classifier: ${classifier.apiCalls} call(s), ${classifier.parseFailures} parse failure(s); ${flagged.length}/${commentsSampled} flagged`);

  return {
    followers: profile.data.metrics?.followers ?? null,
    median_views: m.medianViews,
    posts_fetched: unique.length,
    posts_counted: m.postsCounted,
    excluded,
    window_truncated: windowTruncated,
    engagement_agg: m.engagementAggregate,
    engagement_mean: m.engagementMean,
    tar: m.tar,
    tar_posts: m.tarPostsUsed,
    comments_sampled: commentsSampled,
    comments_flagged: flagged.length,
    comments_unclassified: commentsUnclassified,
    suggested_rate_low: m.suggestedRateLow,
    suggested_rate_high: m.suggestedRateHigh,
    classifier_model: CLASSIFIER_MODEL,
    prompt_hash: await promptHash(),
    posts: rows
      .map((r) => ({
        id: r.post.id,
        url: r.post.url,
        posted_at: r.post.createdAt,
        views: r.post.views,
        likes: r.post.likes,
        comments: r.post.comments,
        shares: r.post.shares,
        saves: r.post.saves,
        engagement: r.engagement,
        sampled: r.sampled,
        flagged: r.flaggedCount,
        tar: r.tar,
      }))
      .sort((a, b) => (b.posted_at ?? "").localeCompare(a.posted_at ?? "")),
    flagged_comments: flagged.slice(0, MAX_FLAGGED_COMMENTS),
  };
}

function haltedError(sf: SocialFetch): ValuationError {
  if (sf.halted === "out_of_credits") return new ValuationError("Social Fetch account is out of credits – top up and run again");
  if (sf.halted === "credit_cap") return new ValuationError(`Hit the ${CREDIT_CAP_PER_RUN}-credit cap for one valuation`);
  return new ValuationError("Social Fetch returned no data");
}
