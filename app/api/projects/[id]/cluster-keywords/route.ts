/**
 * Cluster the project's keyword universe into 5-8 topical buckets via Claude
 * Haiku, then persist each keyword's bucket as `cluster_label` so downstream
 * metrics queries can group by topic.
 *
 * Idempotent — running it again replaces existing labels with whatever the
 * LLM returns this time. The user controls when to re-cluster.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { getProject, listKeywords } from "@/lib/db";
import { clusterKeywords } from "@/lib/llm";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(_req: NextRequest, ctx: { params: { id: string } }) {
  const project = await getProject(ctx.params.id);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  const keywords = await listKeywords(ctx.params.id);
  if (keywords.length === 0) {
    return NextResponse.json({ error: "no keywords to cluster" }, { status: 400 });
  }
  if (keywords.length > 500) {
    return NextResponse.json({ error: "too many keywords (cap is 500 per cluster run)" }, { status: 400 });
  }

  const segment = [project.segment_l1, project.segment_l2, project.segment_l3].filter(Boolean).join(" › ");
  const clusters = await clusterKeywords({
    keywords: keywords.map((k) => k.keyword),
    brand_name: project.brand_name,
    segment: segment || undefined,
  });
  if (clusters.length === 0) {
    return NextResponse.json({ error: "clustering produced no clusters" }, { status: 500 });
  }

  // Write the cluster_label back per keyword. Match case-insensitively against
  // the persisted keyword text so trailing whitespace / case differences from
  // the LLM don't drop assignments.
  let assigned = 0;
  for (const cluster of clusters) {
    if (cluster.keywords.length === 0) continue;
    const { rowCount } = await sql.query(
      `UPDATE keywords
         SET cluster_label = $1
       WHERE project_id = $2
         AND lower(keyword) = ANY($3::text[]);`,
      [cluster.name, ctx.params.id, cluster.keywords.map((k) => k.toLowerCase())],
    );
    assigned += rowCount ?? 0;
  }

  const summary = clusters.map((c) => ({
    name: c.name,
    description: c.description,
    count: c.keywords.length,
  }));

  return NextResponse.json({
    ok: true,
    total_keywords: keywords.length,
    assigned,
    unclustered: keywords.length - assigned,
    clusters: summary,
  });
}
