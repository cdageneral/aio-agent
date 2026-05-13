/**
 * Domain normalization helpers. Used everywhere we compare a citation domain
 * to a tracked brand domain. Keeps subdomain handling consistent.
 */

export function normalizeDomain(input: string | undefined | null): string {
  if (!input) return "";
  let s = String(input).trim().toLowerCase();
  // Strip scheme
  s = s.replace(/^https?:\/\//, "");
  // Strip path / query / hash
  s = s.split(/[\/?#]/)[0];
  // Strip leading www.
  s = s.replace(/^www\./, "");
  return s;
}

/**
 * Returns true if `candidate` is the same as or a subdomain of `target`.
 * normalizeDomain both first.
 */
export function domainMatches(candidate: string, target: string): boolean {
  const c = normalizeDomain(candidate);
  const t = normalizeDomain(target);
  if (!c || !t) return false;
  return c === t || c.endsWith(`.${t}`);
}

/**
 * Pull a likely registrable root domain — useful when we want to roll up
 * subdomain citations to a single brand.
 */
export function rootDomain(input: string): string {
  const d = normalizeDomain(input);
  if (!d) return "";
  const parts = d.split(".");
  if (parts.length <= 2) return d;
  // Handle a few common 2-part TLDs.
  const twoPartTlds = new Set(["co.uk", "com.au", "co.jp", "com.br", "co.in"]);
  const tail2 = parts.slice(-2).join(".");
  const tail3 = parts.slice(-3).join(".");
  if (twoPartTlds.has(tail2)) return tail3;
  return tail2;
}
