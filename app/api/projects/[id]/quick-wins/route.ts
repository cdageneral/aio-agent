/**
 * Quick-wins endpoint — surfaces the highest-ROI missing AIOs for the
 * client to attack first.
 *
 * Scoring (v1, no external volume yet):
 *   +50  AIO is triggered AND client is NOT cited                  (the gap)
 *   +30  Keyword came in via "organic" source (client already ranks top-100)
 *   +20  Keyword came in via "market" source (somebody ranks here)
 *   +15  At least one tracked competitor is cited (winnability proof)
 *   +10  Client is mentioned in AIO text but not cited (partial credit)
 *   +5   AIO has ≥4 citation slots (more attempts means more shots on goal)
 *
 * When volume data is wired in (v2 #4) the score becomes
 *   score = base_score * sqrt(monthly_volume) / 100.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { getProject, latestSnapshot, listCompetitors } from "@/lib/db";
import { domainMatches } from "@/lib/domain";

export const runtime = "nodejs";
// v1.1.53: cache-bypass take 3. v1.1.51 used `dynamic = "force-dynamic"`
// which broke metrics in a way we never explained. v1.1.52 reverted that
// and the panels went empty again. This release uses three independent
// layers instead, so no single Vercel/Next.js cache mechanism can freeze
// a null response:
//   (a) `revalidate = 0` — Next's "always re-render" opt-out, different
//       code path from force-dynamic. Safe to use on metrics-style routes.
//   (b) explicit `Cache-Control: no-store` headers on every response —
//       bypasses the Vercel CDN edge cache regardless of what Next does.
//   (c) client appends `?_=<timestamp>` on every fetch — guarantees a fresh
//       URL key even if (a) and (b) are somehow ignored.
// Any one of these is normally enough; stacking all three is defense in
// depth and costs nothing.
export const revalidate = 0;

// v1.1.53: shared response builder so every exit path through this handler
// — success, "no snapshot", error 500 — carries the no-store headers. Easy
// to forget on one branch otherwise.
function noStoreJson(body: any, init?: { status?: number }) {
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "CDN-Cache-Control": "no-store",
      "Vercel-CDN-Cache-Control": "no-store",
    },
  });
}

interface QuickWin {
  keyword: string;
  country: string;
  score: number;
  reasons: string[];
  citation_count: number;
  competitors_cited: { brand_name: string; position: number | null }[];
  client_mentioned: boolean;
  source: string | null;
  cluster_label: string | null;
  serp_result_id: string;
}

export async function GET(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    return await handleGet(req, ctx);
  } catch (err: any) {
    // v1.1.50: surface unexpected failures as a structured 500 instead of
    // letting them propagate and look like "no data" to the client. v1.1.49
    // ate a SQL syntax issue this way — the response shape silently degraded
    // to `{ }` (no opportunities, no diagnostics) and the panel rendered the
    // "No completed snapshot" branch even though the snapshot existed.
    console.error("[/api/projects/[id]/quick-wins] failed:", err);
    return noStoreJson(
      { error: err?.message ?? String(err ?? "quick-wins computation failed") },
      { status: 500 },
    );
  }
}

async function handleGet(req: NextRequest, ctx: { params: { id: string } }) {
  const project = await getProject(ctx.params.id);
  if (!project) return noStoreJson({ error: "project not found" }, { status: 404 });

  const snap = await latestSnapshot(project.id);
  if (!snap) {
    return noStoreJson({
      snapshot: null,
      opportunities: [],
      // v1.1.49: diagnostic block surfaces enough state for the UI's empty
      // copy to be specific about WHY nothing is showing — instead of the
      // generic "every AIO won or no AIOs triggered or wrong region" hand-
      // wave. When there's literally no snapshot, the block is null and the
      // UI says "no snapshot yet, run a refresh."
      diagnostics: null,
    });
  }

  const url = new URL(req.url);
  const regionParam = url.searchParams.get("region");
  const regions = regionParam ? regionParam.split(",").map((r) => r.trim().toLowerCase()) : null;
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "20", 10), 1), 100);
  // v1.1.27: optional ?kind=branded|non_branded — scopes the gap list to one
  // half of the keyword universe.
  const kindParam = url.searchParams.get("kind");
  const kindFilter: "branded" | "non_branded" | null =
    kindParam === "branded" || kindParam === "non_branded" ? kindParam : null;

  const { rows: serps } = await sql<{
    id: string; keyword: string; country: string; has_aio: boolean; aio_text: string | null; source: string | null; cluster_label: string | null; keyword_kind: string | null;
  }>`
    SELECT sr.id, sr.keyword, sr.country, sr.has_aio, sr.aio_text, k.source, k.cluster_label, k.keyword_kind
    FROM serp_results sr
    LEFT JOIN keywords k ON k.project_id = sr.project_id AND k.keyword = sr.keyword
    WHERE sr.snapshot_id = ${snap.id} AND sr.has_aio = TRUE;`;

  const { rows: cites } = await sql<{
    serp_result_id: string; position: number; domain: string;
  }>`
    SELECT serp_result_id, position, domain
    FROM citations
    WHERE snapshot_id = ${snap.id};`;

  const { rows: ments } = await sql<{ serp_result_id: string; brand_name: string; kind: string }>`
    SELECT serp_result_id, brand_name, kind FROM mentions WHERE snapshot_id = ${snap.id};`;

  const citesByResult = new Map<string, typeof cites>();
  for (const c of cites) {
    const arr = citesByResult.get(c.serp_result_id) ?? [];
    arr.push(c);
    citesByResult.set(c.serp_result_id, arr);
  }
  const mentByResult = new Map<string, typeof ments>();
  for (const m of ments) {
    const arr = mentByResult.get(m.serp_result_id) ?? [];
    arr.push(m);
    mentByResult.set(m.serp_result_id, arr);
  }

  const competitors = await listCompetitors(project.id);
  let filtered = regions ? serps.filter((s) => regions.includes(s.country.toLowerCase())) : serps;
  if (kindFilter) {
    filtered = filtered.filter((s) => s.keyword_kind === kindFilter);
  }

  const opportunities: QuickWin[] = [];

  for (const s of filtered) {
    const c = citesByResult.get(s.id) ?? [];
    const m = mentByResult.get(s.id) ?? [];
    const clientCited = c.some((x) => domainMatches(x.domain, project.client_domain));
    if (clientCited) continue; // gap = NOT cited
    const clientMentioned = m.some((x) => x.brand_name === project.brand_name && (x.kind === "mentioned" || x.kind === "both"));

    const competitors_cited: { brand_name: string; position: number | null }[] = [];
    for (const comp of competitors) {
      const owned = c.filter((x) => domainMatches(x.domain, comp.domain)).sort((a, b) => a.position - b.position);
      if (owned.length > 0) competitors_cited.push({ brand_name: comp.brand_name, position: owned[0].position });
    }

    let score = 50; // base: it's a gap
    const reasons: string[] = ["AIO triggered but client uncited"];
    if (s.source === "organic") { score += 30; reasons.push("Client already ranks for this term"); }
    else if (s.source === "market") { score += 20; reasons.push("Tracked brand ranks for this term"); }
    if (competitors_cited.length > 0) { score += 15; reasons.push(`${competitors_cited.length} tracked competitor${competitors_cited.length === 1 ? "" : "s"} cited`); }
    if (clientMentioned) { score += 10; reasons.push("Client name appears in AIO answer text"); }
    if (c.length >= 4) { score += 5; reasons.push(`${c.length} citation slots — multiple shots on goal`); }

    opportunities.push({
      keyword: s.keyword,
      country: s.country,
      score,
      reasons,
      citation_count: c.length,
      competitors_cited,
      client_mentioned: clientMentioned,
      source: s.source,
      cluster_label: s.cluster_label,
      serp_result_id: s.id,
    });
  }

  opportunities.sort((a, b) => b.score - a.score || b.citation_count - a.citation_count);

  // v1.1.49/v1.1.50: snapshot-level diagnostics computed entirely from the
  // already-fetched `serps`/`filtered` arrays — no extra SQL. v1.1.49
  // shipped with a STRING_TO_ARRAY/UNNEST count query that turned out to
  // fail silently on Vercel Postgres and returned the whole endpoint as a
  // 500, which the client then misread as "no snapshot." Same diagnostic
  // information, no separate count query.
  //
  // Fields:
  //   - aios_in_region:    AIO-triggering serps that match the region filter
  //   - aios_won_by_client: of those, how many already cite the client
  //   - aios_open_gaps:    = opportunities.length (the gap list)
  // When opportunities is empty, the UI can show "N AIOs in <region>, all
  // already cited by <brand>" instead of guessing.
  const aios_in_region = filtered.length;
  const aios_won_by_client = filtered.reduce((acc, s) => {
    const c = citesByResult.get(s.id) ?? [];
    return acc + (c.some((x) => domainMatches(x.domain, project.client_domain)) ? 1 : 0);
  }, 0);

  return noStoreJson({
    snapshot: snap,
    opportunities: opportunities.slice(0, limit),
    total_opportunities: opportunities.length,
    diagnostics: {
      snapshot_ran_at: snap.ran_at,
      regions_in_view: regions ?? null,
      aios_in_region,
      aios_won_by_client,
      aios_open_gaps: opportunities.length,
      client_brand: project.brand_name,
    },
  });
}
