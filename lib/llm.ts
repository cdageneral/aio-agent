/**
 * Anthropic SDK wrapper for the segment-detection pipeline.
 *
 * Uses Haiku for cost/latency — a single detection is ~300 tokens in,
 * ~400 tokens out, so well under $0.005 even at heavy use.
 *
 * We force structured output by asking the model to emit only JSON inside
 * a <classification> tag. That's more reliable than free-form prompting and
 * cheaper than tool-use round-tripping for this single-shot use case.
 */
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { PageExtract } from "./web-extract";

export interface SuggestedCompetitor {
  name: string;
  domain: string;
  /** Set by the /api/detect-segment route after a liveness check on the domain. */
  verified?: boolean;
}

export interface SegmentSuggestion {
  industry: string;
  category: string;
  subcategory: string;
  primary_product: string;
  region_hint: "us" | "ca" | "both" | "unknown";
  confidence: "high" | "medium" | "low";
  seed_keywords: string[];
  competitors: SuggestedCompetitor[];
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    client = new Anthropic({ apiKey });
  }
  return client;
}

const SYSTEM_PROMPT = `You are an AI assistant for an SEO competitive intelligence tool that tracks brand presence in Google AI Overviews.

Your job: read a website excerpt and classify the business behind it so the tool can auto-seed a keyword universe, identify competitors, and set the right region.

You must respond with a single <classification> XML block containing ONLY valid JSON. Do not write any prose outside the block. Do not wrap the JSON in markdown fences.

JSON shape (every field required):
{
  "industry": string,           // Broad vertical: "Finance", "Retail", "Travel", "Tech & SaaS", "Health & Wellness", "B2B Services", "Automotive", "Food & Beverage", "Education", etc. Make one up if none fit.
  "category": string,           // Subdomain within the industry: "Lending", "Apparel", "AI Tools", "Insurance", etc.
  "subcategory": string,        // The specific product line: "Reverse Mortgages", "Footwear", "Project Management", "Pet Insurance", etc. Be SPECIFIC — this is what differentiates them.
  "primary_product": string,    // One sentence describing what they actually sell, in plain language. Include the audience if obvious.
  "region_hint": "us" | "ca" | "both" | "unknown",  // Use "ca" if Canadian-only, "us" for US-focused, "both" for cross-border, "unknown" if not clear.
  "confidence": "high" | "medium" | "low",  // How certain you are.
  "seed_keywords": string[],    // 10-15 search queries a prospect would type that this business would want to rank for. Include head terms AND longer-tail informational queries. Lowercase. Avoid the brand name itself.
  "competitors": [{             // 3-5 direct competitor objects. Real companies that fight for the same SERP queries.
    "name": string,             //   Their brand name (e.g. "HomeEquity Bank")
    "domain": string            //   Their primary registered domain, lowercase, no scheme or path (e.g. "homeequitybank.com")
  }]
}

Quality guidance:
- subcategory should be specific enough that someone in the industry would recognize it. "Mortgages" is too broad; "Reverse Mortgages" is right.
- seed_keywords should be queries that drive commercial intent traffic to this kind of business. Mix "best X", "X near me", "how does X work", "X calculator", "X rates".
- competitors must be real companies with verifiable domains. If you're not certain a brand exists at a given domain, omit it. Fewer correct entries beats more guesses. Normalize domains to lowercase, no www., no scheme, no path.
- region_hint: look for currency symbols, country names, address info, language markers.`;

export async function detectSegment(extract: PageExtract): Promise<SegmentSuggestion> {
  const ai = getClient();

  const userContent = `URL: ${extract.url}
TITLE: ${extract.title}
META DESCRIPTION: ${extract.description}
H1: ${extract.h1.join(" | ")}
H2: ${extract.h2.join(" | ")}
H3: ${extract.h3.join(" | ")}

BODY EXCERPT:
${extract.text}`;

  const resp = await ai.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  const text = resp.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n");

  // Pull the JSON out of the <classification> block (or fall back to the first {...} object).
  const inner = text.match(/<classification>\s*([\s\S]*?)\s*<\/classification>/i)?.[1] ?? text;
  const json = inner.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error("LLM did not return JSON");

  let parsed: any;
  try {
    parsed = JSON.parse(json);
  } catch (e: any) {
    throw new Error(`Could not parse LLM JSON: ${e.message}`);
  }

  // Coerce/validate the response shape so the API doesn't return junk.
  const out: SegmentSuggestion = {
    industry: String(parsed.industry ?? "").trim(),
    category: String(parsed.category ?? "").trim(),
    subcategory: String(parsed.subcategory ?? "").trim(),
    primary_product: String(parsed.primary_product ?? "").trim(),
    region_hint: ["us", "ca", "both", "unknown"].includes(parsed.region_hint) ? parsed.region_hint : "unknown",
    confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "medium",
    seed_keywords: Array.isArray(parsed.seed_keywords) ? parsed.seed_keywords.map((s: any) => String(s).trim()).filter(Boolean).slice(0, 20) : [],
    competitors: Array.isArray(parsed.competitors)
      ? parsed.competitors
          .map((c: any): SuggestedCompetitor | null => {
            // Tolerate both legacy string entries and the new {name,domain} shape.
            if (typeof c === "string") {
              const name = c.trim();
              return name ? { name, domain: "" } : null;
            }
            if (c && typeof c === "object") {
              const name = String(c.name ?? "").trim();
              const domain = normalizeDomain(String(c.domain ?? "").trim());
              if (!name || !domain) return null;
              return { name, domain };
            }
            return null;
          })
          .filter((c: SuggestedCompetitor | null): c is SuggestedCompetitor => c !== null)
          .slice(0, 8)
      : [],
  };
  return out;
}

function normalizeDomain(d: string): string {
  return d.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[\/?#]/)[0];
}

// -----------------------------------------------------------------------------
// Keyword clustering
// -----------------------------------------------------------------------------

export interface KeywordCluster {
  name: string;        // 2-4 words, sentence case, e.g. "Refinancing"
  description: string; // one-line intent description
  keywords: string[];  // every keyword that belongs in this bucket
}

const CLUSTER_SYSTEM_PROMPT = `You group keywords into topical clusters for an SEO competitive intelligence tool.

Given a list of keywords, return 5-8 semantically coherent clusters. Each cluster must have:
  - name: 2-4 words, sentence case ("Refinancing", "First-time buyers", "Brand & reviews"). Specific and descriptive.
  - description: one short sentence describing the user intent / topic.
  - keywords: array of input keywords that belong in this cluster.

Critical rules:
  - EVERY input keyword MUST appear in exactly one cluster. Don't drop any, don't duplicate.
  - Don't invent new keywords. Only assign the inputs you were given.
  - Cluster by intent + topic, not by surface word similarity. "best rates" and "compare rates" belong together; "best rates" and "best lender" belong in different clusters.
  - 5-8 clusters total. Fewer is fine if the universe is small. Don't make singletons unless absolutely necessary.

Output format: ONE <clusters> XML block containing valid JSON only. No markdown fences, no prose:
<clusters>
{
  "clusters": [
    { "name": "...", "description": "...", "keywords": ["...", "..."] }
  ]
}
</clusters>`;

export async function clusterKeywords(input: {
  keywords: string[];
  brand_name: string;
  segment?: string;
}): Promise<KeywordCluster[]> {
  const ai = getClient();
  const userContent = `Brand: ${input.brand_name}${input.segment ? `\nSegment: ${input.segment}` : ""}

Keywords to cluster (${input.keywords.length}):
${input.keywords.join("\n")}`;

  const resp = await ai.messages.create({
    model: "claude-haiku-4-5-20251001",
    // v1.1.25: bumped from 4096 → 8192. Cluster output for 50-100+ keywords
    // was exceeding 4K tokens and getting truncated mid-JSON, which the
    // strict JSON.parse couldn't recover from. 8192 covers normal sets;
    // the repair fallback below handles edge cases that still overrun.
    max_tokens: 8192,
    system: CLUSTER_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  const text = resp.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
  const inner = text.match(/<clusters>\s*([\s\S]*?)\s*<\/clusters>/i)?.[1] ?? text;
  const json = inner.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error("LLM did not return cluster JSON");

  // v1.1.25: strict parse first; if truncation broke it, try a brace-walking
  // repair before giving up. This recovers the clusters that DID complete
  // even when the tail of the response got cut off.
  let parsed: any;
  try {
    parsed = JSON.parse(json);
  } catch (e: any) {
    const stopReason = (resp as any)?.stop_reason ?? "unknown";
    const repaired = tryRepairTruncatedClusterJson(json);
    if (!repaired) {
      throw new Error(
        `Could not parse cluster JSON (${e.message}). stop_reason=${stopReason}, length=${json.length}. ` +
        `Response likely hit max_tokens — try clustering with fewer keywords.`,
      );
    }
    try {
      parsed = JSON.parse(repaired);
    } catch (e2: any) {
      throw new Error(`Cluster JSON repair failed: ${e2.message} (stop_reason=${stopReason})`);
    }
    console.warn(`[clusterKeywords] response was truncated (stop_reason=${stopReason}); repaired to recover ${parsed?.clusters?.length ?? 0} clusters`);
  }
  if (!Array.isArray(parsed.clusters)) throw new Error("LLM response missing clusters array");

  const clusters: KeywordCluster[] = parsed.clusters
    .map((c: any) => ({
      name: String(c.name ?? "").trim(),
      description: String(c.description ?? "").trim(),
      keywords: Array.isArray(c.keywords) ? c.keywords.map((k: any) => String(k).trim()).filter(Boolean) : [],
    }))
    .filter((c: KeywordCluster) => c.name && c.keywords.length > 0);

  return clusters;
}

/**
 * v1.1.25: salvage a truncated cluster JSON response. Walks the string
 * brace-by-brace, tracks string boundaries + escapes, finds the last cleanly-
 * closed cluster object, and rebuilds valid JSON by appending `]}` to close
 * the clusters array + root object. Returns null if no complete cluster was
 * found (response was too short to recover anything useful).
 */
function tryRepairTruncatedClusterJson(json: string): string | null {
  const clustersKey = json.indexOf('"clusters"');
  if (clustersKey < 0) return null;
  const arrStart = json.indexOf("[", clustersKey);
  if (arrStart < 0) return null;

  let depth = 0;
  let inStr = false;
  let escape = false;
  let lastCompleteClusterEnd = -1;

  for (let i = arrStart; i < json.length; i++) {
    const c = json[i];
    if (escape) { escape = false; continue; }
    if (inStr) {
      if (c === "\\") escape = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      // depth === 0 means we just closed a cluster object back to array level.
      // (We don't count `[` in our depth, so depth=0 is "inside the array,
      // between cluster objects.") Each such position is a safe truncation
      // point — everything up to and including this `}` is a complete cluster.
      if (depth === 0) lastCompleteClusterEnd = i;
    }
  }

  if (lastCompleteClusterEnd < 0) return null;
  return json.slice(0, lastCompleteClusterEnd + 1) + "]}";
}
