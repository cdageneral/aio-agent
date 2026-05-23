/**
 * Dashboard data:
 *   - latest snapshot metrics
 *   - historical series (one point per completed snapshot) for the growth chart
 *   - growth rate vs prior snapshot
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import {
  countKeywords,
  getProject,
  latestSnapshot,
  listCompetitors,
  listSnapshots,
  loadSnapshotDetail,
  reclassifyKeywords,
} from "@/lib/db";
import { computeSnapshotMetrics, growthRate, BrandSpec, CitationRow, SerpResultRow } from "@/lib/metrics";
import type { KeywordKind } from "@/lib/keywordKind";

export const runtime = "nodejs";
// v1.1.52: removed v1.1.51's force-dynamic. It caused latestSnapshot() to
// return null even when listSnapshots() returned the same complete snapshot
// rows. Root cause is still unclear — possibly an interaction between
// force-dynamic and the sql template caching, possibly a Next.js bundling
// issue. Reverting for now to restore production.

/** v1.1.27: parse ?kind= into one of three modes. Defaults to "all". */
function parseKind(raw: string | null): "all" | KeywordKind {
  if (raw === "branded" || raw === "non_branded") return raw;
  return "all";
}

export async function GET(req: NextRequest, ctx: { params: { id: string } }) {
  const project = await getProject(ctx.params.id);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  // ?region=us | ?region=ca | ?region=us,ca (default: all of project.regions)
  const url = new URL(req.url);
  const regionParam = url.searchParams.get("region");
  const regions = regionParam
    ? regionParam.split(",").map((r) => r.trim().toLowerCase()).filter(Boolean)
    : (project.regions ?? ["us"]);

  // v1.1.27: ?kind=all|branded|non_branded (default all)
  const kindFilter = parseKind(url.searchParams.get("kind"));

  // v1.1.27: opportunistic backfill. Older projects (created before this column
  // existed) will have NULL keyword_kind on their existing rows; classify them
  // once now so the toggle works without forcing the user to re-add keywords.
  // Idempotent + cheap: only runs the UPDATE when nulls actually exist.
  try {
    const { rows: nullCount } = await sql<{ c: number }>`
      SELECT COUNT(*)::int AS c FROM keywords
      WHERE project_id = ${project.id} AND keyword_kind IS NULL;`;
    if ((nullCount[0]?.c ?? 0) > 0) {
      await reclassifyKeywords(project.id);
    }
  } catch (e) {
    // Non-fatal — dashboard still loads; toggle just shows everything as
    // non-branded until the next keyword insert / PATCH triggers a real pass.
    console.error("[metrics] kind backfill failed (non-fatal):", e);
  }

  const [competitors, snapshots, keywords_count] = await Promise.all([
    listCompetitors(project.id),
    listSnapshots(project.id),
    countKeywords(project.id),
  ]);
  const completed = snapshots.filter((s) => s.status === "complete");

  const brands: BrandSpec[] = [
    {
      brand_name: project.brand_name,
      brand_aliases: project.brand_aliases ?? [],
      domain: project.client_domain,
      kind: "client",
    },
    ...competitors.map((c) => ({
      brand_name: c.brand_name,
      brand_aliases: c.brand_aliases ?? [],
      domain: c.domain,
      kind: "competitor" as const,
    })),
  ];

  // Build per-snapshot metrics for the historical series.
  const series = [] as {
    snapshot_id: string;
    ran_at: string;
    total_aios_triggered: number;
    total_aios_triggered_organic: number;
    brand_aios: { brand_name: string; kind: string; aios_acquired: number; citation_rate: number; mention_rate: number }[];
  }[];

  for (const snap of completed) {
    const { serps, cites } = await loadSnapshotDetail(snap.id);
    const citesById = new Map<string, CitationRow[]>();
    for (const c of cites) {
      const arr = citesById.get(c.serp_result_id) ?? [];
      arr.push(c);
      citesById.set(c.serp_result_id, arr);
    }
    const m = computeSnapshotMetrics(serps as SerpResultRow[], citesById, brands, { regions, kind: kindFilter });
    series.push({
      snapshot_id: snap.id,
      ran_at: snap.ran_at,
      total_aios_triggered: m.total_aios_triggered,
      total_aios_triggered_organic: m.total_aios_triggered_organic,
      brand_aios: m.brands.map((b) => ({
        brand_name: b.brand_name,
        kind: b.kind,
        aios_acquired: b.aios_acquired,
        citation_rate: b.citation_rate,
        mention_rate: b.mention_rate,
      })),
    });
  }

  // Latest detailed metrics (full breakdown, other-domains, etc.)
  let latest = null as Awaited<ReturnType<typeof computeSnapshotMetrics>> | null;
  const last = await latestSnapshot(project.id);
  if (last) {
    const { serps, cites } = await loadSnapshotDetail(last.id);
    const citesById = new Map<string, CitationRow[]>();
    for (const c of cites) {
      const arr = citesById.get(c.serp_result_id) ?? [];
      arr.push(c);
      citesById.set(c.serp_result_id, arr);
    }
    // v1.1.44: pass the region filter through to the latest computation so the
    // executive summary, story panel, KPI cards, etc. stay consistent with
    // the rest of the dashboard. Previously this call omitted `regions`,
    // which meant a user with the region selector set to Canada-only would
    // see populated all-region data in the exec summary while quick-wins
    // and the drilldown — both of which DO respect the filter — returned
    // empty. Same data, two views, contradictory output. Bringing this call
    // into line with the historical-series computation (line ~99) fixes it.
    latest = computeSnapshotMetrics(serps as SerpResultRow[], citesById, brands, { regions, kind: kindFilter });
  }

  // Period-over-period growth (latest vs previous completed)
  let growth: any = null;
  if (series.length >= 2) {
    const cur = series[series.length - 1];
    const prev = series[series.length - 2];
    growth = {
      total_aios: growthRate(cur.total_aios_triggered, prev.total_aios_triggered),
      total_aios_organic: growthRate(cur.total_aios_triggered_organic, prev.total_aios_triggered_organic),
      brands: cur.brand_aios.map((b) => {
        const p = prev.brand_aios.find((x) => x.brand_name === b.brand_name);
        return {
          brand_name: b.brand_name,
          aios_acquired: growthRate(b.aios_acquired, p?.aios_acquired ?? 0),
          citation_rate_delta: b.citation_rate - (p?.citation_rate ?? 0),
          mention_rate_delta: b.mention_rate - (p?.mention_rate ?? 0),
        };
      }),
    };
  }

  return NextResponse.json({
    project,
    competitors,
    snapshots,
    latest,
    series,
    growth,
    regions_in_view: regions,
    kind_in_view: kindFilter,
    keywords_count,
  });
}
