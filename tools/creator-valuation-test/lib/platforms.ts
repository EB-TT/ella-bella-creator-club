// Route + field mapping per platform, taken from the Social Fetch OpenAPI
// schemas (llms-tiktok.txt / llms-instagram.txt / openapi.json).

export type Platform = "tiktok" | "instagram";
export type IgSource = "posts" | "reels";

export interface Post {
  id: string;
  createdAt: string | null;
  date: Date | null;
  url: string;
  caption: string;
  mediaType: string | null; // Instagram /posts only
  pinned: boolean; // TikTok only; Instagram doesn't expose it
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

// ---- Raw response shapes (only the fields we read) ----

interface TikTokVideo {
  id: string;
  caption: string | null;
  createdAt: string | null;
  url: string | null;
  pinned: boolean;
  stats?: { views?: number; likes?: number; comments?: number; shares?: number; saves?: number };
}

interface IgMedia {
  id: string;
  shortcode: string;
  mediaType?: "image" | "video" | "sidecar" | "unknown";
  caption: string | null;
  createdAt: string;
  url: string;
  likeCount?: number;
  commentCount?: number;
  playCount?: number;
}

export interface ProfileData {
  lookupStatus: string;
  profile: { handle: string; displayName: string | null; privateAccount?: boolean } | null;
  metrics: { followers: number; posts: number } | null;
}

export interface ListData {
  lookupStatus?: string; // Instagram list routes only
  videos?: TikTokVideo[];
  posts?: IgMedia[];
  reels?: IgMedia[];
  page: { nextCursor: string | null; hasMore: boolean };
}

export interface CommentsData {
  lookupStatus: string;
  comments: Array<{ id: string; text: string; createdAt?: string; likes?: number; likeCount?: number }>;
  page: { nextCursor: string | null; hasMore: boolean };
  totalComments?: number | null; // TikTok only
}

// ---- Routes ----

export function profilePath(p: Platform, handle: string): string {
  return `/v1/${p}/profiles/${encodeURIComponent(handle)}`;
}

export function listRoute(p: Platform, handle: string, igSource: IgSource): { path: string; params: Record<string, string> } {
  const h = encodeURIComponent(handle);
  if (p === "tiktok") return { path: `/v1/tiktok/profiles/${h}/videos`, params: { sortBy: "latest" } };
  return { path: `/v1/instagram/profiles/${h}/${igSource}`, params: {} };
}

export function commentsPath(p: Platform): string {
  return p === "tiktok" ? "/v1/tiktok/videos/comments" : "/v1/instagram/posts/comments";
}

// ---- Normalisers ----

export function listItems(p: Platform, data: ListData, igSource: IgSource): unknown[] {
  if (p === "tiktok") return data.videos ?? [];
  return (igSource === "reels" ? data.reels : data.posts) ?? [];
}

export function normalisePost(p: Platform, raw: unknown, handle: string, igSource: IgSource): Post {
  if (p === "tiktok") {
    const v = raw as TikTokVideo;
    const s = v.stats ?? {};
    return {
      id: v.id,
      createdAt: v.createdAt,
      date: parseDate(v.createdAt),
      url: v.url ?? `https://www.tiktok.com/@${handle}/video/${v.id}`,
      caption: v.caption ?? "",
      mediaType: null,
      pinned: v.pinned === true,
      views: num(s.views),
      likes: num(s.likes),
      comments: num(s.comments),
      shares: num(s.shares),
      saves: num(s.saves),
    };
  }
  const m = raw as IgMedia;
  return {
    id: m.id,
    createdAt: m.createdAt ?? null,
    date: parseDate(m.createdAt),
    url: m.url,
    caption: m.caption ?? "",
    mediaType: igSource === "reels" ? "video" : (m.mediaType ?? null),
    pinned: false,
    views: num(m.playCount),
    likes: num(m.likeCount),
    comments: num(m.commentCount),
    shares: null, // not exposed by Social Fetch for Instagram
    saves: null, // not exposed by Social Fetch for Instagram
  };
}

export function normaliseComment(p: Platform, c: CommentsData["comments"][number]): Comment {
  return {
    id: String(c.id),
    text: c.text ?? "",
    likes: num(p === "tiktok" ? c.likes : c.likeCount),
    createdAt: c.createdAt ?? null,
  };
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
