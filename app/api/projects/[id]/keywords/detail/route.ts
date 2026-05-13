/**
 * Per-keyword drilldown payload for the latest completed snapshot.
 *
 * Returns one row per (keyword × country) with:
 *   - has_aio + aio_text
 *   - full citation list (position, domain, url, title, source_type)
 *   - per-tracked-brand hit summary (cited?, mentioned?, position-if-cited)
 *   - which brand "won" the keyword (most prominent tracked brand by position)
 *
 * Optional ?region=us|ca|us,ca to filter.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { getProject, latestSnapshot, listCompetitors } from "@/lib/db";
import { domainMatches } from "@/lib/domain";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: { id: string } }) {
  const project = await getProject(ctx.params.id);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  const snap = await latestSnapshot(project.id);
  if (!snap) {
    return NextResponse.json({ snapshot: null, keywords: [], brands: [] });
  }

  const url = new URL(req.url);
  const regionParam = url.searchParams.get("region");
  const regions = regionParam
    ? regionParam.split(",").map((r) => r.trim().toLowerCase()).filter(Boolean)
    : null;

  // Pull every serp_result row + its keyword source + region + cluster label.
  const { rows: serps } = await sql<{
    id: string; keyword: string; country: string; has_aio: boolean; aio_text: string | null; source: string | null; cluster_label: string | null;
  }>`
    SELECT sr.id, sr.keyword, sr.country, sr.has_aio, sr.aio_text, k.source, k.cluster_label
    FROM serp_results sr
    LEFT JOIN keywords k ON k.project_id = sr.project_id AND k.keyword = sr.keyword
    WHERE sr.snapshot_id = ${snap.id}
    ORDER BY sr.keyword ASC, sr.country ASC;`;

  const { rows: cites } = await sql<{
    serp_result_id: string; position: number; domain: string; url: string; title: string | null; source_type: string | null;
  }>`
    SELECT serp_result_id, position, domain, url, title, source_type
    FROM citations
    WHERE snapshot_id = ${snap.id}
    ORDER BY serp_result_id, position;`;

  const { rows: ments } = await sql<{
    serp_result_id: string; brand_name: string; brand_kind: string; kind: string;
  }>`
    SELECT serp_result_id, brand_name, brand_kind, kind
    FROM mentions
    WHERE snapshot_id = ${snap.id};`;

  const citesByResult = new Map<string, typeof cites>();
  for (const c of cites) {
    const arr = citesByResult.get(c.serp_result_id) ?? [];
    arr.push(c);
    citesByResult.set(c.serp_result_id, arr);
  }
  const mentsByResult = new Map<string, typeof ments>();
  for (const m of ments) {
    const arr = mentsByResult.get(m.serp_result_id) ?? [];
    arr.push(m);
    mentsByResult.set(m.serp_result_id, arr);
  }

  const competitors = await listCompetitors(project.id);
  const tracked = [
    { brand_name: project.brand_name, domain: project.client_domain, kind: "client" as const },
    ...competitors.map((c) => ({ brand_name: c.brand_name, domain: c.domain, kind: "competitor" as const })),
  ];

  const filtered = regions ? serps.filter((s) => regions.includes(s.country.toLowerCase())) : serps;

  const keywords = filtered.map((s) => {
    const citations = citesByResult.get(s.id) ?? [];
    const mentions = mentsByResult.get(s.id) ?? [];

    // For each tracked brand, find their best citation (lowest position) and whether they're mentioned in text.
    const brand_hits = tracked.map((b) => {
      const owned = citations
        .filter((c) => domainMatches(c.domain, b.domain))
        .sort((a, b2) => a.position - b2.position);
      const best = owned[0];
      const mention = mentions.find((m) => m.brand_name === b.brand_name);
      return {
        brand_name: b.brand_name,
        domain: b.domain,
        kind: b.kind,
        cited: owned.length > 0,
        position: best?.position ?? null,
        slots: owned.length,
        mentioned: !!mention && (mention.kind === "mentioned" || mention.kind === "both"),
      };
    });

    // The "winner" is the tracked brand with the best (lowest) citation position. Falls back to null if none.
    const cited = brand_hits.filter((b) => b.cited);
    const winner = cited.length > 0
      ? cited.reduce((a, b) => (a.position! < b.position! ? a : b))
      : null;

    return {
      id: s.id,
      keyword: s.keyword,
      country: s.country,
      source: s.source,
      cluster_label: s.cluster_label,
      has_aio: s.has_aio,
      aio_text: s.aio_text,
      citations,
      brand_hits,
      winner: winner ? { brand_name: winner.brand_name, position: winner.position, kind: winner.kind } : null,
    };
  });

  return NextResponse.json({
    snapshot: snap,
    project_brand: project.brand_name,
    tracked,
    keywords,
  });
}
