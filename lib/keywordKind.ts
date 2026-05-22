/**
 * Classify a search keyword as "branded" or "non_branded" relative to the
 * client brand. A keyword is BRANDED when it contains the brand name, any
 * brand alias, or the root stem of the client domain — matched case-
 * insensitive with word boundaries on at least one alias.
 *
 * Examples (brand="Citi", aliases=["Citibank","Citicards"], domain="citi.com"):
 *   "citi double cash card"          → branded   (matches "citi")
 *   "citibank login"                 → branded   (matches "citibank")
 *   "citicards rewards"              → branded   (matches "citicards")
 *   "best cash back credit card"     → non_branded
 *   "chase sapphire vs citi"         → branded   (any match wins)
 *
 * Notes:
 *   - The domain stem is taken from the part before the first dot, lower-cased.
 *     Single letters and 2-character stems are skipped (too noisy to match).
 *   - Aliases shorter than 3 chars are also skipped — same reason.
 *   - This is intentionally NOT an LLM call. The brand-name match is well-defined
 *     and we run this on every keyword insert; a regex avoids cost + latency.
 */

export type KeywordKind = "branded" | "non_branded";

export interface BrandIdentity {
  brand_name: string;
  brand_aliases?: string[] | null;
  client_domain?: string | null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Derive a usable brand-stem from a domain like "citi.com" → "citi". Returns
 *  null when the stem is too short or empty to be a safe match. */
function domainStem(domain: string | null | undefined): string | null {
  if (!domain) return null;
  const cleaned = domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
  const dot = cleaned.indexOf(".");
  const stem = dot > 0 ? cleaned.slice(0, dot) : cleaned;
  if (!stem || stem.length < 3) return null;
  return stem;
}

/** Build the set of brand-name candidates we'll regex against. Lower-cased,
 *  filtered, deduplicated. */
export function brandTokens(brand: BrandIdentity): string[] {
  const tokens = new Set<string>();
  const add = (raw: string | undefined | null) => {
    if (!raw) return;
    const s = String(raw).trim().toLowerCase();
    if (s.length >= 3) tokens.add(s);
  };
  add(brand.brand_name);
  for (const a of brand.brand_aliases ?? []) add(a);
  add(domainStem(brand.client_domain));
  return Array.from(tokens);
}

/** Pre-compile a regex that matches any brand token on a word boundary. Returns
 *  null when there's nothing safe to match (e.g. brand is blank). */
export function compileBrandRegex(brand: BrandIdentity): RegExp | null {
  const tokens = brandTokens(brand);
  if (tokens.length === 0) return null;
  const alt = tokens.map(escapeRegex).join("|");
  return new RegExp(`\\b(${alt})\\b`, "i");
}

/** Classify a single keyword. */
export function classifyKeywordKind(keyword: string, brand: BrandIdentity): KeywordKind {
  const re = compileBrandRegex(brand);
  if (!re) return "non_branded";
  return re.test(keyword) ? "branded" : "non_branded";
}

/** Classify many keywords at once. Reuses the compiled regex for speed. */
export function classifyKeywords(keywords: string[], brand: BrandIdentity): KeywordKind[] {
  const re = compileBrandRegex(brand);
  if (!re) return keywords.map(() => "non_branded");
  return keywords.map((k) => (re.test(k) ? "branded" : "non_branded"));
}
