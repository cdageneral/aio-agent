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
  const project = await getProject(ctx.params.id);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  const snap = await latestSnapshot(project.id);
  if (!snap) return NextResponse.json({ snapshot: null, opportunities: [] });

  const url = new URL(req.url);
  const regionParam = url.searchParams.get("region");
  const regions = regionParam ? regionParam.split(",").map((r) => r.trim().toLowerCase()) : null;
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "20", 10), 1), 100);

  const { rows: serps } = await sql<{
    id: string; keyword: string; country: string; has_aio: boolean; aio_text: string | null; source: string | null; cluster_label: string | null;
  }>`
    SELECT sr.id, sr.keyword, sr.country, sr.has_aio, sr.aio_text, k.source, k.cluster_label
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
  const filtered = regions ? serps.filter((s) => regions.includes(s.country.toLowerCase())) : serps;

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

  return NextResponse.json({
    snapshot: snap,
    opportunities: opportunities.slice(0, limit),
    total_opportunities: opportunities.length,
  });
}
