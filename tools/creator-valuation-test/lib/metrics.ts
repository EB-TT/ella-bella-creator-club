import type { Comment, Platform, Post } from "./platforms.ts";
import type { Label } from "./classify.ts";

export type Rag = "green" | "amber" | "red";

export interface PostMetrics {
  post: Post;
  engagement: number | null;
  engagementPartial: boolean;
  sampled: boolean;
  sampledComments: number;
  flaggedCount: number | null; // null = not sampled or not classified
  productInterestShare: number | null;
  estProductInterestComments: number | null;
  tar: number | null;
}

export interface SampledPost {
  post: Post;
  comments: Comment[];
  labels: Map<string, Label>;
}

export function postMetrics(platform: Platform, post: Post, sample: SampledPost | undefined): PostMetrics {
  const actions = [post.likes, post.comments, post.shares, post.saves];
  const engagementPartial = platform === "instagram" || actions.some((a) => a === null);
  const engagement = post.views && post.views > 0 ? sum(actions) / post.views : null;

  let flaggedCount: number | null = null;
  let share: number | null = null;
  let estPi: number | null = null;
  const sampledComments = sample?.comments.length ?? 0;
  if (sample && sampledComments > 0) {
    const labels = sample.comments.map((c) => sample.labels.get(c.id) ?? "unclassified");
    if (labels.every((l) => l !== "unclassified")) {
      flaggedCount = labels.filter((l) => l === true).length;
      share = flaggedCount / sampledComments;
      estPi = post.comments !== null ? share * post.comments : null;
    }
  }

  let tar: number | null = null;
  if (platform === "tiktok" && estPi !== null && post.views && post.views > 0) {
    tar = ((post.saves ?? 0) + (post.shares ?? 0) + estPi) / post.views;
  }

  return {
    post,
    engagement,
    engagementPartial,
    sampled: Boolean(sample),
    sampledComments,
    flaggedCount,
    productInterestShare: share,
    estProductInterestComments: estPi,
    tar,
  };
}

export interface CreatorMetrics {
  postsCounted: number;
  medianViews: number | null;
  engagementMean: number | null;
  engagementAggregate: number | null;
  engagementPartial: boolean;
  tar: number | null;
  tarNote: string | null;
  tarPostsUsed: number;
  suggestedRateLow: number | null;
  suggestedRateHigh: number | null;
  quotedRate: number | null;
  cpm: number | null;
  rag: { cpm: Rag | null; engagementAggregate: Rag | null; engagementMean: Rag | null; tar: Rag | null };
}

export function creatorMetrics(platform: Platform, rows: PostMetrics[], rate: number | null, classifierEnabled: boolean): CreatorMetrics {
  const views = rows.map((r) => r.post.views).filter((v): v is number => v !== null);
  const medianViews = median(views);

  const rates = rows.map((r) => r.engagement).filter((e): e is number => e !== null);
  const engagementMean = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
  const withViews = rows.filter((r) => r.post.views && r.post.views > 0);
  const sumViews = withViews.reduce((a, r) => a + (r.post.views ?? 0), 0);
  const sumActions = withViews.reduce((a, r) => a + sum([r.post.likes, r.post.comments, r.post.shares, r.post.saves]), 0);
  const engagementAggregate = sumViews > 0 ? sumActions / sumViews : null;

  let tar: number | null = null;
  let tarNote: string | null = null;
  const tarRows = rows.filter((r) => r.sampled && r.estProductInterestComments !== null && r.post.views && r.post.views > 0);
  if (platform === "instagram") {
    tarNote = "needs Insights (saves/shares not available for Instagram)";
  } else if (!classifierEnabled) {
    tarNote = "classification skipped (no ANTHROPIC_API_KEY)";
  } else if (tarRows.length === 0) {
    tarNote = "no classified sampled posts";
  } else {
    const num = tarRows.reduce((a, r) => a + (r.post.saves ?? 0) + (r.post.shares ?? 0) + (r.estProductInterestComments ?? 0), 0);
    const den = tarRows.reduce((a, r) => a + (r.post.views ?? 0), 0);
    tar = num / den;
  }

  const cpm = rate !== null && medianViews ? (rate / medianViews) * 1000 : null;

  return {
    postsCounted: rows.length,
    medianViews,
    engagementMean,
    engagementAggregate,
    engagementPartial: rows.some((r) => r.engagementPartial),
    tar,
    tarNote,
    tarPostsUsed: tarRows.length,
    suggestedRateLow: medianViews !== null ? (medianViews * 15) / 1000 : null,
    suggestedRateHigh: medianViews !== null ? (medianViews * 50) / 1000 : null,
    quotedRate: rate,
    cpm,
    rag: {
      cpm: cpm === null ? null : cpm <= 15 ? "green" : cpm <= 50 ? "amber" : "red",
      engagementAggregate: ragEngagement(engagementAggregate),
      engagementMean: ragEngagement(engagementMean),
      tar: tar === null ? null : tar > 0.01 ? "green" : "red",
    },
  };
}

function ragEngagement(e: number | null): Rag | null {
  if (e === null) return null;
  return e > 0.1 ? "green" : e >= 0.05 ? "amber" : "red";
}

function sum(xs: Array<number | null>): number {
  return xs.reduce<number>((a, x) => a + (x ?? 0), 0);
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Guess a comment page's sort order from adjacent pairs. */
export function guessCommentOrder(comments: Comment[]): string {
  if (comments.length < 3) return "too few to tell";
  const pairs = comments.length - 1;
  let likesDesc = 0;
  let newestFirst = 0;
  let oldestFirst = 0;
  let datedPairs = 0;
  for (let i = 0; i < pairs; i++) {
    const a = comments[i];
    const b = comments[i + 1];
    if ((a.likes ?? 0) >= (b.likes ?? 0)) likesDesc++;
    const ta = a.createdAt ? Date.parse(a.createdAt) : NaN;
    const tb = b.createdAt ? Date.parse(b.createdAt) : NaN;
    if (!Number.isNaN(ta) && !Number.isNaN(tb)) {
      datedPairs++;
      if (ta >= tb) newestFirst++;
      if (ta <= tb) oldestFirst++;
    }
  }
  const byLikes = likesDesc / pairs >= 0.85;
  const byNewest = datedPairs > 0 && newestFirst / datedPairs >= 0.85;
  const byOldest = datedPairs > 0 && oldestFirst / datedPairs >= 0.85;
  if (byLikes && !byNewest && !byOldest) return "top (likes desc)";
  if (byNewest && !byLikes) return "newest first";
  if (byOldest && !byLikes) return "oldest first";
  if (byLikes && (byNewest || byOldest)) return "ambiguous (likes and date both monotonic)";
  return `mixed (likes-desc ${pct(likesDesc / pairs)}, newest-first ${datedPairs ? pct(newestFirst / datedPairs) : "n/a"})`;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
