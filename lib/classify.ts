/**
 * Source-type classifier for citation domains.
 * Powers the "Bucket other domains" tab.
 */
import { normalizeDomain } from "./domain";

export type SourceType = "wikipedia" | "reddit" | "news" | "industry" | "other";

const REDDIT = new Set(["reddit.com", "old.reddit.com"]);
const WIKIPEDIA_SUFFIX = ".wikipedia.org";

const NEWS_DOMAINS = new Set([
  "nytimes.com", "wsj.com", "washingtonpost.com", "bbc.com", "bbc.co.uk",
  "cnn.com", "foxnews.com", "reuters.com", "apnews.com", "bloomberg.com",
  "ft.com", "theguardian.com", "forbes.com", "businessinsider.com",
  "cnbc.com", "axios.com", "politico.com", "usatoday.com", "nbcnews.com",
  "abcnews.go.com", "cbsnews.com", "npr.org", "vox.com", "theatlantic.com",
  "wired.com", "techcrunch.com", "theverge.com", "arstechnica.com",
  "engadget.com", "mashable.com",
]);

const FORUM_DOMAINS = new Set([
  "stackoverflow.com", "stackexchange.com", "quora.com",
  "ycombinator.com", "news.ycombinator.com", "medium.com",
]);

/**
 * Classify a citation domain into a coarse bucket.
 * `industry` is the catch-all for the user's own brand + competitors + niche
 * domains; treat it as "credible brand-relevant source" rather than literal industry.
 */
export function classifyDomain(
  raw: string,
  context: { trackedDomains?: string[] } = {},
): SourceType {
  const d = normalizeDomain(raw);
  if (!d) return "other";

  if (d === "wikipedia.org" || d.endsWith(WIKIPEDIA_SUFFIX)) return "wikipedia";
  if (REDDIT.has(d) || d.endsWith(".reddit.com")) return "reddit";
  if (NEWS_DOMAINS.has(d)) return "news";
  if (FORUM_DOMAINS.has(d)) return "other";

  const tracked = (context.trackedDomains ?? []).map(normalizeDomain);
  if (tracked.includes(d) || tracked.some((t) => d.endsWith(`.${t}`))) return "industry";

  return "other";
}
