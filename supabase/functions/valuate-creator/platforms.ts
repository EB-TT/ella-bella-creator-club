// Route + field mapping per platform, taken from the Social Fetch OpenAPI
// schemas. Ported from tools/creator-valuation-test/lib/platforms.ts.

export type Platform = "tiktok" | "instagram";

export interface Post {
  id: string;
  createdAt: string | null;
  date: Date | null;
  url: string;
  caption: string;
  pinned: boolean; // TikTok only; Instagram doesn't mark pinned posts
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
}

export interface Comment {
  id: string;
  author: string | null; // commenter's handle
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

export interface RawComment {
  id?: string | number;
  text?: string | null;
  createdAt?: string;
  likes?: number; // TikTok
  likeCount?: number; // Instagram
  author?: { handle?: string } | null;
}

export interface CommentsData {
  lookupStatus: string;
  comments?: RawComment[];
  page?: { nextCursor: string | null; hasMore: boolean };
  totalComments?: number | null;
}

export interface PlatformAdapter {
  profilePath(handle: string): string;
  listRoute(handle: string): { path: string; params: Record<string, string> };
  listItems(data: ListData): unknown[];
  normalisePost(raw: unknown, handle: string): Post;
  /** Platform-specific eligibility rule beyond the date window, or null if eligible. */
  ineligibleReason(post: Post): string | null;
  /** Leading list items that may be pinned without being marked, so can't be used to judge the 90-day stop. */
  unmarkedPinnedSlots: number;
  commentsPath(): string;
  normaliseComment(raw: RawComment): Comment;
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
  unmarkedPinnedSlots: 0, // TikTok marks pinned videos
  commentsPath: () => "/v1/tiktok/videos/comments",
  normaliseComment: (c) => ({
    id: String(c.id),
    author: c.author?.handle ?? null,
    text: c.text ?? "",
    likes: num(c.likes),
    createdAt: c.createdAt ?? null,
  }),
};

// ---- Instagram ----
// Uses /reels rather than /posts: on /posts, images and carousels have no
// view count, while every reel has playCount. Shares and saves aren't in the
// Instagram schema at all, so they stay null (not 0).

interface IgReel {
  id: string;
  shortcode: string;
  caption: string | null;
  createdAt: string;
  url: string;
  likeCount?: number;
  commentCount?: number;
  playCount?: number;
}

const instagram: PlatformAdapter = {
  profilePath: (handle) => `/v1/instagram/profiles/${encodeURIComponent(handle)}`,
  listRoute: (handle) => ({ path: `/v1/instagram/profiles/${encodeURIComponent(handle)}/reels`, params: {} }),
  listItems: (data) => (data.reels as IgReel[] | undefined) ?? [],
  normalisePost(raw) {
    const m = raw as IgReel;
    return {
      id: String(m.id),
      createdAt: m.createdAt ?? null,
      date: parseDate(m.createdAt),
      url: m.url ?? `https://www.instagram.com/reel/${m.shortcode}/`,
      caption: m.caption ?? "",
      pinned: false,
      views: num(m.playCount),
      likes: num(m.likeCount),
      comments: num(m.commentCount),
      shares: null,
      saves: null,
    };
  },
  ineligibleReason: () => null,
  // Up to 3 posts can be pinned to the top of a profile, unmarked in the API.
  unmarkedPinnedSlots: 3,
  commentsPath: () => "/v1/instagram/posts/comments",
  normaliseComment: (c) => ({
    id: String(c.id),
    author: c.author?.handle ?? null,
    text: c.text ?? "",
    likes: num(c.likeCount),
    createdAt: c.createdAt ?? null,
  }),
};

const ADAPTERS: Record<Platform, PlatformAdapter> = { tiktok, instagram };

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
