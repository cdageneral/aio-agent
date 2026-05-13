/**
 * Cheap liveness check for LLM-suggested competitor domains.
 *
 * Goal: filter out hallucinated URLs ("competitorthatdoesntexist.com") and
 * mark the survivors as verified so the UI can show them with confidence.
 *
 * Approach: parallel GETs with a hard 4s timeout. Treat any 2xx, 3xx, or 4xx
 * response as "alive" (some sites 403 bots but still exist) — only DNS
 * failures and total timeouts mark the domain dead. This errs toward
 * keeping real domains rather than aggressively filtering.
 *
 * No API cost — just network. Whole verification pass usually completes in
 * under 2 seconds even for 5 domains thanks to parallelism.
 */

const TIMEOUT_MS = 4000;

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; AIOCoverageBot/1.0)",
  Accept: "text/html,application/xhtml+xml",
};

export interface VerifyResult {
  domain: string;
  verified: boolean;
  status?: number;
  reason?: string;
}

export async function verifyDomains(domains: string[]): Promise<VerifyResult[]> {
  return Promise.all(domains.map(verifyOne));
}

async function verifyOne(domain: string): Promise<VerifyResult> {
  const clean = domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[\/?#]/)[0];
  if (!clean || !clean.includes(".")) {
    return { domain, verified: false, reason: "invalid domain" };
  }
  const url = `https://${clean}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "GET", headers: HEADERS, redirect: "follow", signal: ctrl.signal });
    // 2xx/3xx/4xx all indicate the host resolved and responded. 5xx is also "alive".
    return { domain: clean, verified: true, status: res.status };
  } catch (err: any) {
    const reason = err?.name === "AbortError" ? "timeout" : err?.cause?.code ?? err?.message ?? "fetch failed";
    return { domain: clean, verified: false, reason };
  } finally {
    clearTimeout(t);
  }
}
