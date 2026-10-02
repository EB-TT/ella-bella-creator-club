// Route + field mapping per platform, taken from the Social Fetch OpenAPI
// schemas. Ported from tools/creator-valuation-test/lib/platforms.ts.
//
// Only TikTok is wired up. To add Instagram, write an adapter for it (the
// test harness has the routes and field mapping) and add it to ADAPTERS.

export type Platform = "tiktok" | "instagram";

export interface Post {
  id: string;
  createdAt: string | null;
  date: Date | null;
  url: string;
  caption: string;
  pinned: boolean; // TikTok only
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
}

export interface Comment {
  id: string;
  text: string;
  likes: number | null;
  createdAt: string | null;
}

export interface ProfileData {
  lookupStatus: string;
  profile: { handle: string; displayName: string | null; privateAccount?: boolean } | null;
  metrics: { followers: number; posts: number } | null;
}

export interface ListData {
  lookupStatus?: string;
  page: { nextCursor: string | null; hasMore: boolean };
  [key: string]: unknown;
}

export interface CommentsData {
  lookupStatus: string;
  comments: Array<{ id: string; text: string; createdAt?: string; likes?: number; likeCount?: number }>;
  page: { nextCursor: string | null; hasMore: boolean };
  totalComments?: number | null;
}

export interface PlatformAdapter {
  profilePath(handle: string): string;
  listRoute(handle: string): { path: string; params: Record<string, string> };
  listItems(data: ListData): unknown[];
  normalisePost(raw: unknown, handle: string): Post;
  /** Platform-specific eligibility rule beyond the date window, or null if eligible. */
  ineligibleReason(post: Post): string | null;
  commentsPath(): string;
  normaliseComment(raw: CommentsData["comments"][number]): Comment;
}

// ---- TikTok ----

interface TikTokVideo {
  id: string;
  caption: string | null;
  createdAt: string | null;
  url: string | null;
  pinned: boolean;
  stats?: { views?: number; likes?: number; comments?: number; shares?: number; saves?: number };
}

const tiktok: PlatformAdapter = {
  profilePath: (handle) => `/v1/tiktok/profiles/${encodeURIComponent(handle)}`,
  listRoute: (handle) => ({ path: `/v1/tiktok/profiles/${encodeURIComponent(handle)}/videos`, params: { sortBy: "latest" } }),
  listItems: (data) => (data.videos as TikTokVideo[] | undefined) ?? [],
  normalisePost(raw, handle) {
    const v = raw as TikTokVideo;
    const s = v.stats ?? {};
    return {
      id: String(v.id),
      createdAt: v.createdAt,
      date: parseDate(v.createdAt),
      url: v.url ?? `https://www.tiktok.com/@${handle}/video/${v.id}`,
      caption: v.caption ?? "",
      pinned: v.pinned === true,
      views: num(s.views),
      likes: num(s.likes),
      comments: num(s.comments),
      shares: num(s.shares),
      saves: num(s.saves),
    };
  },
  ineligibleReason: () => null,
  commentsPath: () => "/v1/tiktok/videos/comments",
  normaliseComment: (c) => ({
    id: String(c.id),
    text: c.text ?? "",
    likes: num(c.likes),
    createdAt: c.createdAt ?? null,
  }),
};

const ADAPTERS: Partial<Record<Platform, PlatformAdapter>> = { tiktok };

export function adapterFor(p: string): PlatformAdapter {
  const a = ADAPTERS[p as Platform];
  if (!a) throw new Error(`${p} valuations aren't supported yet`);
  return a;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
