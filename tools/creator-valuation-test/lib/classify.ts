// Product-interest comment classification with Claude Haiku via plain fetch
// (no SDK, so it ports to a Deno edge function unchanged).

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Comment } from "./platforms.ts";
import { readJson, sleep } from "./socialfetch.ts";

export const CLASSIFIER_MODEL = "claude-haiku-4-5-20251001";

export const CLASSIFIER_PROMPT = `You label comments left on a social media creator's post, to measure purchase intent for the product featured in the post.

A comment is PRODUCT-INTEREST if the commenter does any of these:
- asks about buying the product, its price, a link, availability, sizes/shades/variants, or where to get it
- says they want it, need it, or will buy it
- says they have bought it

A comment is NOT product-interest if it is only:
- general praise or a reaction ("love this", "so pretty", "obsessed")
- emojis
- tagging friends (e.g. "@sam", "@sam look")
- a joke or meme
- about the creator (their looks, voice, personality, life) rather than the product

You will receive the post caption for context, then the comments as JSON objects with "id" and "text".

Respond with JSON only: an array of the "id" strings of the product-interest comments, e.g. ["123","456"]. Respond [] if none qualify. No prose, no code fences.`;

const PROMPT_HASH = createHash("sha256").update(CLASSIFIER_MODEL + CLASSIFIER_PROMPT).digest("hex").slice(0, 12);

interface CacheEntry {
  productInterest: boolean;
  promptHash: string;
  classifiedAt: string;
}
type CacheFile = Record<string, CacheEntry>;

export type Label = boolean | "unclassified";

export class Classifier {
  private cache: CacheFile = {};
  apiCalls = 0;
  cacheHits = 0;
  parseFailures = 0;

  constructor(
    private readonly apiKey: string | undefined,
    private readonly cacheFile: string,
    private readonly log: (msg: string) => void,
  ) {}

  get enabled(): boolean {
    return Boolean(this.apiKey);
  }

  async load(): Promise<void> {
    this.cache = (await readJson<CacheFile>(this.cacheFile)) ?? {};
  }

  /** Returns a label per comment id. One API call per post, only for uncached comments. */
  async classifyPost(postId: string, caption: string, comments: Comment[]): Promise<Map<string, Label>> {
    const labels = new Map<string, Label>();
    const todo: Comment[] = [];
    for (const c of comments) {
      const hit = this.cache[c.id];
      if (hit && hit.promptHash === PROMPT_HASH) {
        labels.set(c.id, hit.productInterest);
        this.cacheHits++;
      } else {
        todo.push(c);
      }
    }
    if (todo.length === 0) return labels;
    if (!this.apiKey) {
      for (const c of todo) labels.set(c.id, "unclassified");
      return labels;
    }

    const flagged = await this.callModel(postId, caption, todo);
    const now = new Date().toISOString();
    for (const c of todo) {
      if (flagged === null) {
        labels.set(c.id, "unclassified");
      } else {
        const pi = flagged.has(c.id);
        labels.set(c.id, pi);
        this.cache[c.id] = { productInterest: pi, promptHash: PROMPT_HASH, classifiedAt: now };
      }
    }
    if (flagged !== null) await this.save();
    return labels;
  }

  private async callModel(postId: string, caption: string, comments: Comment[]): Promise<Set<string> | null> {
    const userContent =
      `Post caption:\n${caption.slice(0, 1000) || "(none)"}\n\nComments:\n` +
      comments.map((c) => JSON.stringify({ id: c.id, text: c.text })).join("\n");

    let text: string | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey!,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: CLASSIFIER_MODEL,
          max_tokens: 4096,
          temperature: 0,
          system: CLASSIFIER_PROMPT,
          messages: [{ role: "user", content: userContent }],
        }),
      });
      this.apiCalls++;
      if (res.status === 429 || res.status === 529 || res.status >= 500) {
        const wait = Number(res.headers.get("retry-after")) * 1000 || 2000 * (attempt + 1);
        this.log(`  Anthropic ${res.status} on post ${postId}; retrying in ${Math.round(wait / 1000)}s`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) {
        this.log(`  ! Anthropic ${res.status} on post ${postId}: ${(await res.text()).slice(0, 300)}. Post left unclassified.`);
        return null;
      }
      const body = (await res.json()) as { content: Array<{ type: string; text?: string }>; stop_reason: string };
      if (body.stop_reason !== "end_turn") {
        this.log(`  ! Classifier stop_reason=${body.stop_reason} on post ${postId}. Post left unclassified.`);
        this.parseFailures++;
        return null;
      }
      text = body.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
      break;
    }
    if (text === null) {
      this.log(`  ! Classifier gave up on post ${postId} after retries. Post left unclassified.`);
      return null;
    }

    const stripped = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripped);
    } catch {
      this.parseFailures++;
      this.log(`  ! Classifier output for post ${postId} isn't valid JSON. Post left unclassified. Raw: ${text.slice(0, 200)}`);
      return null;
    }
    if (!Array.isArray(parsed)) {
      this.parseFailures++;
      this.log(`  ! Classifier output for post ${postId} isn't an array. Post left unclassified.`);
      return null;
    }
    const known = new Set(comments.map((c) => c.id));
    const ids = parsed.map(String);
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length) this.log(`  ! Classifier returned ${unknown.length} unknown id(s) for post ${postId}: ${unknown.slice(0, 5).join(", ")}`);
    return new Set(ids.filter((id) => known.has(id)));
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.cacheFile), { recursive: true });
    await writeFile(this.cacheFile, JSON.stringify(this.cache, null, 2));
  }
}
