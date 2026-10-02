// Post- and creator-level metrics. Ported from
// tools/creator-valuation-test/lib/metrics.ts. CPM and RAG are left to the
// frontend so a quoted rate edited later stays correct without a re-run.

import type { Comment, Platform, Post } from "./platforms.ts";
import type { Label } from "./classify.ts";

export const LOW_CPM = 15;
export const HIGH_CPM = 50;

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
  tar: number | null;
  tarPostsUsed: number;
  suggestedRateLow: number | null;
  suggestedRateHigh: number | null;
}

export function creatorMetrics(platform: Platform, rows: PostMetrics[], classifierEnabled: boolean): CreatorMetrics {
  const views = rows.map((r) => r.post.views).filter((v): v is number => v !== null);
  const medianViews = median(views);

  const rates = rows.map((r) => r.engagement).filter((e): e is number => e !== null);
  const engagementMean = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
  const withViews = rows.filter((r) => r.post.views && r.post.views > 0);
  const sumViews = withViews.reduce((a, r) => a + (r.post.views ?? 0), 0);
  const sumActions = withViews.reduce((a, r) => a + sum([r.post.likes, r.post.comments, r.post.shares, r.post.saves]), 0);
  const engagementAggregate = sumViews > 0 ? sumActions / sumViews : null;

  let tar: number | null = null;
  const tarRows = rows.filter((r) => r.sampled && r.estProductInterestComments !== null && r.post.views && r.post.views > 0);
  if (platform === "tiktok" && classifierEnabled && tarRows.length > 0) {
    const num = tarRows.reduce((a, r) => a + (r.post.saves ?? 0) + (r.post.shares ?? 0) + (r.estProductInterestComments ?? 0), 0);
    const den = tarRows.reduce((a, r) => a + (r.post.views ?? 0), 0);
    tar = num / den;
  }

  return {
    postsCounted: rows.length,
    medianViews,
    engagementMean,
    engagementAggregate,
    tar,
    tarPostsUsed: tar === null ? 0 : tarRows.length,
    suggestedRateLow: medianViews !== null ? (medianViews * LOW_CPM) / 1000 : null,
    suggestedRateHigh: medianViews !== null ? (medianViews * HIGH_CPM) / 1000 : null,
  };
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
