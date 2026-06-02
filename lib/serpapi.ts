/**
 * SerpAPI client — AIO detection, citation parsing, organic-keyword discovery.
 *
 * v1 scope: US, desktop, English (locked in env defaults).
 *
 * SerpAPI's AI Overview block can arrive in two shapes:
 *   1. INLINE — `ai_overview.text_blocks` + `ai_overview.references` are present in the SERP response.
 *   2. ASYNC — `ai_overview.page_token` is present; you must hit
 *      `engine=google_ai_overview&page_token=...` to retrieve the full block.
 * This module normalizes both into a single `ParsedAio | null` result.
 */

import { normalizeDomain } from "./domain";

const SERPAPI_BASE = "https://serpapi.com/search.json";

export interface AioReference {
  index: number;
  title?: string;
  link: string;
  domain: string;
  source?: string;
}

export interface ParsedAio {
  hasAio: boolean;
  text: string;                 // concatenated AIO answer text
  references: AioReference[];   // ordered by position (1-based externally; index here is SerpAPI's 0-based)
  raw?: unknown;                // trimmed payload for debugging
}

export interface SerpFetchOptions {
  gl?: string;
  hl?: string;
  device?: "desktop" | "mobile" | "tablet";
  location?: string;
  /** Skip the async page_token follow-up. Useful for cheap presence-only checks. */
  shallow?: boolean;
}

function apiKey(): string {
  const k = process.env.SERPAPI_KEY;
  if (!k) throw new Error("SERPAPI_KEY is not set");
  return k;
}

function defaults(): Required<Pick<SerpFetchOptions, "gl" | "hl" | "device">> {
  return {
    gl: process.env.DEFAULT_GL ?? "us",
    hl: process.env.DEFAULT_HL ?? "en",
    device: (process.env.DEFAULT_DEVICE as "desktop" | "mobile") ?? "desktop",
  };
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`SerpAPI ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  }
  return res.json();
}

/**
 * Build the AI Overview block from a SERP payload, following the page_token
 * async pattern if needed.
 */
async function resolveAio(serp: any, shallow: boolean): Promise<ParsedAio | null> {
  const ai = serp?.ai_overview;
  if (!ai) return null;

  // Async case: only a page_token is present. Follow up.
  if (ai.page_token && (!ai.text_blocks || ai.text_blocks.length === 0)) {
    if (shallow) {
      // We know an AIO exists but skip the deep fetch.
      return { hasAio: true, text: "", references: [], raw: { page_token: ai.page_token } };
    }
    const follow = `${SERPAPI_BASE}?engine=google_ai_overview&page_token=${encodeURIComponent(
      ai.page_token,
    )}&api_key=${encodeURIComponent(apiKey())}`;
    const data = await getJson(follow);
    return parseAioBlock(data?.ai_overview);
  }

  return parseAioBlock(ai);
}

function parseAioBlock(ai: any): ParsedAio | null {
  if (!ai) return null;
  const textBlocks: any[] = ai.text_blocks ?? [];
  const text = textBlocks
    .map((b) => collectBlockText(b))
    .filter(Boolean)
    .join("\n\n");

  const refs: AioReference[] = (ai.references ?? []).map((r: any, i: number) => ({
    index: typeof r.index === "number" ? r.index : i,
    title: r.title,
    link: r.link ?? r.source_link ?? "",
    domain: normalizeDomain(r.link ?? r.source ?? ""),
    source: r.source,
  }));

  return {
    hasAio: textBlocks.length > 0 || refs.length > 0,
    text,
    references: refs,
    raw: { text_blocks: textBlocks.length, references: refs.length },
  };
}

function collectBlockText(b: any): string {
  if (!b) return "";
  if (typeof b.snippet === "string") return b.snippet;
  if (Array.isArray(b.list)) {
    return b.list.map((item: any) => item.snippet ?? "").filter(Boolean).join("\n");
  }
  return "";
}

/**
 * Fetch a single SERP and return a normalized AIO result.
 */
export async function fetchAio(keyword: string, opts: SerpFetchOptions = {}): Promise<ParsedAio | null> {
  const d = defaults();
  const params = new URLSearchParams({
    engine: "google",
    q: keyword,
    gl: opts.gl ?? d.gl,
    hl: opts.hl ?? d.hl,
    device: opts.device ?? d.device,
    api_key: apiKey(),
  });
  if (opts.location) params.set("location", opts.location);

  const serp = await getJson(`${SERPAPI_BASE}?${params.toString()}`);
  return resolveAio(serp, opts.shallow ?? false);
}

/**
 * Fetch SerpAPI organic_results for a domain to discover the keywords it ranks for.
 * Uses Google Search results filtered by `site:` — a free, scrappy approach.
 * For richer keyword discovery, swap to a dedicated rank-tracking API later.
 */
export async function discoverOrganicKeywordsSeed(seed: string, limit = 50): Promise<string[]> {
  const d = defaults();
  const params = new URLSearchParams({
    engine: "google",
    q: seed,
    gl: d.gl,
    hl: d.hl,
    device: d.device,
    num: String(Math.min(100, limit)),
    api_key: apiKey(),
  });
  const serp = await getJson(`${SERPAPI_BASE}?${params.toString()}`);
  const related: string[] = [
    ...(serp.related_searches ?? []).map((r: any) => r.query),
    ...(serp.related_questions ?? []).map((r: any) => r.question),
    ...((serp.inline_questions ?? []) as any[]).map((r) => r.question ?? r.text),
  ].filter(Boolean);
  // De-dupe and cap.
  return Array.from(new Set(related)).slice(0, limit);
}

/**
 * Quick rank check for a domain on a keyword. Returns position 1-100 or null.
 * Used by the "pull client's organic ranking keywords" pathway when paired
 * with a seed-keyword expansion list.
 */
export async function rankFor(keyword: string, domain: string): Promise<number | null> {
  const d = defaults();
  const params = new URLSearchParams({
    engine: "google",
    q: keyword,
    gl: d.gl,
    hl: d.hl,
    device: d.device,
    num: "100",
    api_key: apiKey(),
  });
  const serp = await getJson(`${SERPAPI_BASE}?${params.toString()}`);
  const organic: any[] = serp.organic_results ?? [];
  const target = normalizeDomain(domain);
  for (const r of organic) {
    const rd = normalizeDomain(r.link ?? r.displayed_link ?? "");
    if (rd === target || rd.endsWith(`.${target}`)) return r.position ?? null;
  }
  return null;
}
