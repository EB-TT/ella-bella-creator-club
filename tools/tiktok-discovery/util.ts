// Shared helpers: secret redaction, logging, output writing, and the small
// generic readers used because the exact response shapes are what Phase 0
// is here to discover.
//
// Everything printed or written goes through redact(), so a credential can't
// reach the terminal, findings.md or a sample file by accident.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const secrets = new Set<string>();

/** Registers credential values to be masked wherever they appear in text. */
export function registerSecrets(...values: (string | undefined)[]): void {
  for (const v of values) if (v && v.length >= 6) secrets.add(v);
}

const SECRET_PARAM = /\b(sign|access_token|refresh_token|app_secret|app_key|shop_cipher)=[^&\s"'<>]+/gi;
const URL_WITH_QUERY = /(https?:\/\/[^\s"'?<>]+)\?[^\s"'<>]*/gi;

export function redact(text: string): string {
  let out = text.replace(SECRET_PARAM, "$1=[redacted]").replace(URL_WITH_QUERY, "$1?[query removed]");
  for (const s of secrets) out = out.split(s).join("[redacted]");
  return out;
}

export function log(msg = ""): void {
  console.log(redact(msg));
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const OUTPUT_DIR = path.join(import.meta.dirname, "output");

export async function writeOut(rel: string, content: string): Promise<void> {
  const file = path.join(OUTPUT_DIR, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, redact(content));
}

// ---- Generic readers ------------------------------------------------------

export function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.every(isEmpty);
  if (typeof v === "object") return Object.values(v as object).every(isEmpty);
  return false;
}

/** Breadth-first: the shallowest non-empty value for the first matching key. */
export function deepFirst(root: unknown, keys: string[]): any {
  let level: unknown[] = [root];
  for (let depth = 0; depth < 6 && level.length; depth++) {
    const next: unknown[] = [];
    for (const node of level) {
      if (Array.isArray(node)) {
        next.push(...node);
      } else if (node && typeof node === "object") {
        const o = node as Record<string, unknown>;
        for (const k of keys) if (k in o && !isEmpty(o[k])) return o[k];
        next.push(...Object.values(o));
      }
    }
    level = next;
  }
  return undefined;
}

/** Every non-empty value of `key` anywhere in the tree. */
export function deepAll(root: unknown, key: string): any[] {
  const found: any[] = [];
  const walk = (n: unknown) => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === "object") {
      for (const [k, v] of Object.entries(n as object)) {
        if (k === key && !isEmpty(v)) found.push(v);
        else walk(v);
      }
    }
  };
  walk(root);
  return found;
}

const LIST_KEYS = [
  "orders",
  "creator_content_details",
  "sample_applications",
  "applications",
  "target_collaborations",
  "collaborations",
  "creators",
  "items",
  "list",
];

/** The array of records in a response's `data`, wherever TikTok put it. */
export function listItems(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  for (const k of LIST_KEYS) if (Array.isArray(data[k])) return data[k];
  for (const v of Object.values(data)) if (Array.isArray(v) && v.some((x) => x && typeof x === "object")) return v as any[];
  return [];
}

export function toNum(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  if (v && typeof v === "object") return toNum(deepFirst(v, ["amount", "value"]));
  return 0;
}

/** Lowercase, strip @, trim. Same rule the sync will use to match creators. */
export function normUser(v: unknown): string {
  return typeof v === "string" ? v.trim().replace(/^@+/, "").trim().toLowerCase() : "";
}

export function iso(sec: unknown): string {
  const n = toNum(sec);
  return n > 0 ? new Date(n * 1000).toISOString().replace(/\.\d+Z$/, "Z") : "—";
}

export function count<T>(items: T[], key: (x: T) => unknown): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) {
    const raw = key(it);
    const k = raw === undefined || raw === null || raw === "" ? "(empty)" : String(raw);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

export function bucket(n: number): string {
  return n <= 0 ? "0" : n === 1 ? "1" : n <= 5 ? "2-5" : n <= 20 ? "6-20" : "21+";
}

// ---- Markdown -------------------------------------------------------------

export function table(header: string[], rows: (string | number)[][]): string {
  const esc = (c: string | number) => String(c).replace(/\|/g, "\\|").replace(/\n/g, " ");
  return [
    `| ${header.map(esc).join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.map(esc).join(" | ")} |`),
  ].join("\n");
}

export function distTable(label: string, m: Map<string, number>): string {
  const rows = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => [k, n]);
  return table([label, "count"], rows.length ? rows : [["(none)", 0]]);
}

// ---- PII scrub for sample files ------------------------------------------

const PII_KEY = /address|phone|email|recipient|buyer|payment|postal|zip|first_name|last_name|full_name|district|street/i;

/** Drops buyer-looking fields at any depth. Creator fields are left alone. */
export function scrub<T>(v: T): T {
  if (Array.isArray(v)) return v.map(scrub) as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as object)) if (!PII_KEY.test(k)) out[k] = scrub(val);
    return out as T;
  }
  return v;
}

// ---- Field inventory ------------------------------------------------------

/**
 * Per leaf path: how many items have it, and how many have it non-empty. Names
 * and counts only, never values. Objects are reported through their leaves
 * (`price.amount`, not `price`): an object is "present"/"non-empty" when any of
 * its leaves is. An empty `{}` or `""` where other items have leaves under the
 * same path counts as that leaf being absent/empty, not as a separate row.
 */
export function inventory(items: any[]): Map<string, { present: number; populated: number }> {
  const perItem: Map<string, boolean>[] = [];
  const parents = new Set<string>();
  for (const item of items) {
    const leaves = new Map<string, boolean>();
    const walk = (v: unknown, p: string) => {
      if (Array.isArray(v)) {
        if (v.length === 0) leaves.set(p, leaves.get(p) ?? false);
        else parents.add(p);
        v.forEach((e) => walk(e, p + "[]"));
      } else if (v && typeof v === "object" && Object.keys(v).length) {
        parents.add(p);
        for (const [k, val] of Object.entries(v)) walk(val, p ? `${p}.${k}` : k);
      } else {
        leaves.set(p, (leaves.get(p) ?? false) || !isEmpty(v));
      }
    };
    walk(item, "");
    perItem.push(leaves);
  }
  const agg = new Map<string, { present: number; populated: number }>();
  for (const leaves of perItem) {
    for (const [p, populated] of leaves) {
      if (parents.has(p)) continue;
      const a = agg.get(p) ?? { present: 0, populated: 0 };
      a.present++;
      if (populated) a.populated++;
      agg.set(p, a);
    }
  }
  return agg;
}

/** `expected` are documented leaf paths relative to the item, e.g. `price.amount`. */
export function inventoryMd(items: any[], expected: string[] = []): string {
  const inv = inventory(items);
  const paths = [...inv.keys()].sort();
  const shown = paths.slice(0, 150);
  const rows = shown.map((p) => [p, `${inv.get(p)!.present}/${items.length}`, `${inv.get(p)!.populated}/${items.length}`]);
  let md = table(["leaf path", "items with field", "items non-empty"], rows);
  if (paths.length > shown.length) md += `\n\n_${paths.length - shown.length} more paths not shown._`;
  const missing: string[] = [];
  const alwaysEmpty: string[] = [];
  for (const e of expected) {
    const hits = paths.filter((p) => {
      const bare = p.replace(/\[\]/g, "");
      return bare === e || bare.endsWith("." + e);
    });
    if (!hits.length) missing.push(e);
    else if (hits.every((h) => inv.get(h)!.populated === 0)) alwaysEmpty.push(e);
  }
  if (expected.length) {
    const fmt = (l: string[]) => (l.length ? l.map((m) => `\`${m}\``).join(", ") : "none");
    md += `\n\nDocumented fields never present: ${fmt(missing)}`;
    md += `\n\nDocumented fields present but always empty: ${fmt(alwaysEmpty)}`;
  }
  return md;
}

// ---- Money / classification helpers ---------------------------------------

/** The numeric `.amount` of a `{ amount, currency }` object, or undefined when absent or empty. */
export function amountOf(v: any): number | undefined {
  const a = v && typeof v === "object" ? v.amount : undefined;
  if (a === undefined || a === null || (typeof a === "string" && a.trim() === "")) return undefined;
  const n = Number(a);
  return Number.isFinite(n) ? n : undefined;
}

/** How a sample application's `order_id` looks: empty, the placeholder "0", a plausible real ID, or something else. */
export function orderIdKind(v: unknown): "empty" | "zero" | "real" | "other" {
  if (v === undefined || v === null) return "empty";
  const s = String(v).trim();
  if (s === "") return "empty";
  if (/^0+$/.test(s)) return "zero";
  return /^\d{10,}$/.test(s) ? "real" : "other";
}

/** Short section timing for the findings footer; parsed back out by run.ts. */
export const fmtSecs = (ms: number) => (ms / 1000).toFixed(1);
