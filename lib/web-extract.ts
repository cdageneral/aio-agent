/**
 * Lightweight HTML → text extractor for the detection pipeline.
 *
 * We don't need a full DOM parser — just enough signal to feed an LLM
 * classifier. Pull: <title>, meta description, h1/h2/h3 contents, and a
 * truncated body excerpt with chrome (scripts/styles/nav/footer) stripped.
 *
 * Caps the body at 2 KB so the prompt stays cheap. Marketing homepages
 * almost always say what they do in the first paragraph — anything past
 * that is filler.
 */

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; AIOCoverageBot/1.0; +https://aio-tracker.dev)",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
};

export interface PageExtract {
  url: string;
  title: string;
  description: string;
  h1: string[];
  h2: string[];
  h3: string[];
  text: string;
}

export async function fetchAndExtract(url: string): Promise<PageExtract> {
  const safeUrl = url.startsWith("http") ? url : `https://${url}`;
  const res = await fetch(safeUrl, { headers: FETCH_HEADERS, redirect: "follow" });
  if (!res.ok) throw new Error(`Could not fetch ${safeUrl} (HTTP ${res.status})`);
  const html = await res.text();
  return extract(safeUrl, html);
}

export function extract(url: string, html: string): PageExtract {
  const title = match1(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description =
    match1(html, /<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
    match1(html, /<meta\s+[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i) ||
    match1(html, /<meta\s+[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);

  const h1 = matchAll(html, /<h1[^>]*>([\s\S]*?)<\/h1>/gi).slice(0, 4);
  const h2 = matchAll(html, /<h2[^>]*>([\s\S]*?)<\/h2>/gi).slice(0, 8);
  const h3 = matchAll(html, /<h3[^>]*>([\s\S]*?)<\/h3>/gi).slice(0, 6);

  // Body — strip the heavy chrome, then convert to plain text.
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ");

  const text = clean(stripTags(stripped)).slice(0, 2000);

  return {
    url,
    title: clean(title),
    description: clean(description),
    h1: h1.map(clean).filter(Boolean),
    h2: h2.map(clean).filter(Boolean),
    h3: h3.map(clean).filter(Boolean),
    text,
  };
}

function match1(s: string, re: RegExp): string {
  return (s.match(re)?.[1] ?? "").trim();
}
function matchAll(s: string, re: RegExp): string[] {
  return Array.from(s.matchAll(re)).map((m) => m[1]);
}
function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ");
}
function clean(s: string): string {
  return s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
}
