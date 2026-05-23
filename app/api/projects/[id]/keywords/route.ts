/**
 * Keyword universe management. Supports all 4 ingestion methods:
 *   POST body shape:
 *     { method: "manual",  keywords: ["k1","k2"] }
 *     { method: "organic", seedKeywords?: ["..."] }   // expands via SerpAPI, filters by client domain rank
 *     { method: "seed",    seeds: ["..."], limitPerSeed?: 25 }
 *     { method: "market",  shared: true }             // recomputes union across all tracked brands' organic
 */
import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import {
  addKeywords,
  deleteAllKeywords,
  deleteKeyword,
  deleteKeywordsBySource,
  getProject,
  listCompetitors,
  listKeywords,
} from "@/lib/db";

// v1.1.38: whitelist of valid source values for the per-source delete path.
// Keep in sync with the Keyword.source union in lib/db.ts.
const VALID_SOURCES = new Set(["manual", "organic", "market", "seed"]);
import { discoverOrganicKeywordsSeed, rankFor } from "@/lib/serpapi";

export const runtime = "nodejs";
export const maxDuration = 60;

// v1.1.34: keyword universe is uncapped. The prior MAX_KEYWORDS_PER_REFRESH=500
// cost guardrail was removed at user request — the clustering route now batches
// large universes automatically, and SerpAPI cost is the user's call to manage.
// Per-call discovery still has a soft ceiling (see seed/organic/market branches
// below) to avoid one POST blowing through every SerpAPI credit at once.
const PER_CALL_DISCOVERY_CEILING = Number(process.env.MAX_KEYWORDS_PER_CALL ?? 2000);

export async function GET(_req: NextRequest, ctx: { params: { id: string } }) {
  const keywords = await listKeywords(ctx.params.id);
  // `max: null` signals "unbounded" to the UI. Keeping the field in the response
  // shape so older clients don't crash on a missing property.
  return NextResponse.json({ keywords, max: null });
}

export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  const project = await getProject(ctx.params.id);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  const ct = req.headers.get("content-type") ?? "";
  let body: any = {};
  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    const method = String(form.get("method") ?? "manual");
    if (file && file instanceof Blob) {
      const text = await file.text();
      const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
      const keywords = parsed.data
        .map((row) => (Array.isArray(row) ? row[0] : String(row)))
        .filter(Boolean);
      body = { method, keywords };
    }
  } else {
    body = await req.json();
  }

  const method = body.method ?? "manual";
  // v1.1.34: no universe cap. `remainingCap` is now a per-call ceiling for
  // discovery methods only — it prevents a single "organic" or "market" POST
  // from spending thousands of SerpAPI credits. Manual paste / CSV upload are
  // entirely unbounded.
  const remainingCap = PER_CALL_DISCOVERY_CEILING;

  let toAdd: { keyword: string; source: "organic" | "market" | "manual" | "seed" }[] = [];

  if (method === "manual") {
    const kws: string[] = Array.isArray(body.keywords) ? body.keywords : [];
    toAdd = kws.map((k) => ({ keyword: String(k).trim(), source: "manual" as const })).filter((k) => k.keyword);
  } else if (method === "seed") {
    const seeds: string[] = Array.isArray(body.seeds) ? body.seeds : [];
    const limit = Math.min(50, Number(body.limitPerSeed ?? 25));
    const out = new Set<string>();
    for (const s of seeds) {
      const more = await discoverOrganicKeywordsSeed(s, limit);
      more.forEach((m) => out.add(m));
      if (out.size >= remainingCap) break;
    }
    toAdd = Array.from(out).map((k) => ({ keyword: k, source: "seed" as const }));
  } else if (method === "organic") {
    // Expand seeds → SerpAPI related → keep only those where the client's domain
    // currently ranks somewhere in the top 100. Light-touch "organic footprint" discovery.
    // If no seed keywords are provided, fall back to the project's
    // smart-detected seed keywords (populated by /api/detect-segment).
    let seeds: string[] = Array.isArray(body.seedKeywords) ? body.seedKeywords : [];
    if (seeds.length === 0) {
      seeds = (project as any).custom_seed_keywords ?? [];
    }
    const candidatesSet = new Set<string>(seeds);
    for (const s of seeds.slice(0, 10)) {
      const expanded = await discoverOrganicKeywordsSeed(s, 25);
      expanded.forEach((e) => candidatesSet.add(e));
    }
    const candidates = Array.from(candidatesSet).slice(0, Math.min(remainingCap * 2, 100));
    const matched: string[] = [];
    for (const c of candidates) {
      if (matched.length >= remainingCap) break;
      const pos = await rankFor(c, project.client_domain);
      if (pos != null) matched.push(c);
    }
    toAdd = matched.map((k) => ({ keyword: k, source: "organic" as const }));
  } else if (method === "market") {
    // Shared market set: organic keywords for client + each competitor → union.
    const comps = await listCompetitors(ctx.params.id);
    let seeds: string[] = Array.isArray(body.seedKeywords) ? body.seedKeywords : [];
    if (seeds.length === 0) {
      seeds = (project as any).custom_seed_keywords ?? [];
    }
    const candidatesSet = new Set<string>(seeds);
    for (const s of seeds.slice(0, 10)) {
      const expanded = await discoverOrganicKeywordsSeed(s, 25);
      expanded.forEach((e) => candidatesSet.add(e));
    }
    const candidates = Array.from(candidatesSet).slice(0, Math.min(remainingCap * 2, 150));
    const matched = new Set<string>();
    const targetDomains = [project.client_domain, ...comps.map((c) => c.domain)];
    for (const c of candidates) {
      if (matched.size >= remainingCap) break;
      for (const d of targetDomains) {
        const pos = await rankFor(c, d);
        if (pos != null) {
          matched.add(c);
          break;
        }
      }
    }
    toAdd = Array.from(matched).map((k) => ({ keyword: k, source: "market" as const }));
  } else {
    return NextResponse.json({ error: `unknown method ${method}` }, { status: 400 });
  }

  // v1.1.34: only discovery methods (organic / seed / market) are bounded by
  // PER_CALL_DISCOVERY_CEILING — they're the ones that burn SerpAPI credits.
  // Manual paste and CSV upload are unbounded; the user has already typed/
  // chosen exactly what they want to add.
  if (method === "organic" || method === "seed" || method === "market") {
    toAdd = toAdd.slice(0, remainingCap);
  }
  const added = await addKeywords(ctx.params.id, toAdd);
  return NextResponse.json({ added, attempted: toAdd.length });
}

export async function DELETE(req: NextRequest, ctx: { params: { id: string } }) {
  const { searchParams } = new URL(req.url);
  // v1.1.35: bulk wipe path — `?all=true` deletes every keyword on the project.
  // Snapshots are preserved (see deleteAllKeywords doc for rationale). The
  // single-keyword path (`?keyword_id=…`) is unchanged so existing callers
  // (per-row Remove buttons) keep working.
  if (searchParams.get("all") === "true") {
    const project = await getProject(ctx.params.id);
    if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });
    const deleted = await deleteAllKeywords(ctx.params.id);
    return NextResponse.json({ ok: true, deleted });
  }

  // v1.1.38: scoped wipe — `?source=manual|organic|market|seed` deletes every
  // keyword on the project that came from a specific ingestion source. Backs
  // the per-source trash icons in KeywordPanel. Validated against the same
  // enum the schema uses so a bad value never reaches the DB.
  const source = searchParams.get("source");
  if (source) {
    if (!VALID_SOURCES.has(source)) {
      return NextResponse.json({ error: `invalid source: ${source}` }, { status: 400 });
    }
    const project = await getProject(ctx.params.id);
    if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });
    const deleted = await deleteKeywordsBySource(
      ctx.params.id,
      source as "manual" | "organic" | "market" | "seed",
    );
    return NextResponse.json({ ok: true, deleted, source });
  }

  const kid = searchParams.get("keyword_id");
  if (!kid) return NextResponse.json({ error: "keyword_id, ?source=…, or ?all=true required" }, { status: 400 });
  await deleteKeyword(kid);
  return NextResponse.json({ ok: true });
}
