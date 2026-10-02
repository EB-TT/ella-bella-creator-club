// Product-interest comment classification with Claude Haiku via plain fetch.
// Ported from tools/creator-valuation-test/lib/classify.ts without the
// per-comment label cache.

import type { Comment } from "./platforms.ts";
import { sleep } from "./socialfetch.ts";

export const CLASSIFIER_MODEL = "claude-haiku-4-5-20251001";

export const CLASSIFIER_PROMPT = `You label comments left on a social media creator's post, to measure purchase intent for the product featured in the post.

You will receive the creator's handle, the post caption, then the comments as JSON objects with "id", "author" and "text". You can't see the video. If the caption doesn't clearly name a product, assume questions about a product refer to the featured product.

A comment is PRODUCT-INTEREST if the commenter does any of these:
- asks about buying the product: its price, a link, availability, sizes, shades or variants, or where to get it
- asks a question about the product before buying, e.g. whether it works, whether it suits them, how long it lasts, how to use it, or how it compares to something else
- says they want it, need it, or will buy it
- says they have bought it or are using it, unless the comment is a complaint
- tags a friend together with any of the above (e.g. "@sam I need this", "@sam we should get this")

A comment is NOT product-interest if it is only:
- general praise or a reaction ("love this", "so pretty", "obsessed")
- emojis
- tagging friends with no other intent ("@sam", "@sam look")
- a joke, meme or sarcasm
- about the creator (their looks, voice, personality, life) rather than the product
- asking for the creator's own fan card, membership card, VIP card, meetups or meet-and-greets, or personal contact details
- a complaint or negative experience with the product
- spam, self-promotion, collaboration requests, or links to other accounts
- written by the creator or the brand (e.g. "link in bio!", "use code X")

Classify comments in any language.

Respond with JSON only: an array of the "id" strings of the product-interest comments, e.g. ["123","456"]. Respond [] if none qualify. No prose, no code fences.`;

let promptHashMemo: string | null = null;

/** First 12 hex chars of sha256(model + prompt), so results record which prompt labelled them. */
export async function promptHash(): Promise<string> {
  if (promptHashMemo) return promptHashMemo;
  const bytes = new TextEncoder().encode(CLASSIFIER_MODEL + CLASSIFIER_PROMPT);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  promptHashMemo = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 12);
  return promptHashMemo;
}

export type Label = boolean | "unclassified";

export class Classifier {
  apiCalls = 0;
  parseFailures = 0;
  /** Tokens billed across every Anthropic response in this run, for spend tracking. */
  inputTokens = 0;
  outputTokens = 0;

  constructor(
    private readonly apiKey: string | undefined,
    private readonly log: (msg: string) => void,
  ) {}

  get enabled(): boolean {
    return Boolean(this.apiKey);
  }

  /** Returns a label per comment id. One API call per post. */
  async classifyPost(handle: string, postId: string, caption: string, comments: Comment[]): Promise<Map<string, Label>> {
    const labels = new Map<string, Label>();
    if (comments.length === 0) return labels;
    const flagged = this.apiKey ? await this.callModel(handle, postId, caption, comments) : null;
    for (const c of comments) labels.set(c.id, flagged === null ? "unclassified" : flagged.has(c.id));
    return labels;
  }

  private async callModel(handle: string, postId: string, caption: string, comments: Comment[]): Promise<Set<string> | null> {
    const userContent =
      `Creator: @${handle}\n\nPost caption:\n${caption.slice(0, 1000) || "(none)"}\n\nComments:\n` +
      comments.map((c) => JSON.stringify({ id: c.id, author: c.author, text: c.text })).join("\n");

    let text: string | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      let res: Response;
      try {
        res = await fetch("https://api.anthropic.com/v1/messages", {
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
      } catch (err) {
        this.log(`Anthropic request failed on post ${postId}: ${(err as Error).message}. Post left unclassified.`);
        return null;
      }
      this.apiCalls++;
      if (res.status === 429 || res.status === 529 || res.status >= 500) {
        const wait = Math.min(Number(res.headers.get("retry-after")) * 1000 || 2000 * (attempt + 1), 20_000);
        this.log(`Anthropic ${res.status} on post ${postId}; retrying in ${Math.round(wait / 1000)}s`);
        await res.body?.cancel();
        await sleep(wait);
        continue;
      }
      if (!res.ok) {
        this.log(`Anthropic ${res.status} on post ${postId}: ${(await res.text()).slice(0, 300)}. Post left unclassified.`);
        return null;
      }
      const body = (await res.json()) as {
        content: Array<{ type: string; text?: string }>;
        stop_reason: string;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      this.inputTokens += body.usage?.input_tokens ?? 0;
      this.outputTokens += body.usage?.output_tokens ?? 0;
      if (body.stop_reason !== "end_turn") {
        this.log(`Classifier stop_reason=${body.stop_reason} on post ${postId}. Post left unclassified.`);
        this.parseFailures++;
        return null;
      }
      text = body.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
      break;
    }
    if (text === null) {
      this.log(`Classifier gave up on post ${postId} after retries. Post left unclassified.`);
      return null;
    }

    const stripped = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripped);
    } catch {
      this.parseFailures++;
      this.log(`Classifier output for post ${postId} isn't valid JSON. Post left unclassified. Raw: ${text.slice(0, 200)}`);
      return null;
    }
    if (!Array.isArray(parsed)) {
      this.parseFailures++;
      this.log(`Classifier output for post ${postId} isn't an array. Post left unclassified.`);
      return null;
    }
    const known = new Set(comments.map((c) => c.id));
    const ids = parsed.map(String);
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length) this.log(`Classifier returned ${unknown.length} unknown id(s) for post ${postId}: ${unknown.slice(0, 5).join(", ")}`);
    return new Set(ids.filter((id) => known.has(id)));
  }
}
