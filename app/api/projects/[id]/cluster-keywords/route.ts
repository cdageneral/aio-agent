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
  // v1.1.21: wrap in try/catch and surface real error messages so the user
  // gets actionable feedback instead of a bare 500.
  try {
    const project = await getProject(ctx.params.id);
    if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

    const keywords = await listKeywords(ctx.params.id);
    if (keywords.length === 0) {
      return NextResponse.json({ error: "no keywords to cluster — add some to the universe first" }, { status: 400 });
    }
    if (keywords.length < 5) {
      return NextResponse.json({ error: `clustering needs at least 5 keywords; you have ${keywords.length}` }, { status: 400 });
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
      return NextResponse.json({ error: "Claude returned no clusters — try again, or verify the keyword set is meaningful" }, { status: 500 });
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
  } catch (err: any) {
    console.error("[/api/projects/[id]/cluster-keywords POST] failed:", err);
    return NextResponse.json({ error: friendlyClusterError(err) }, { status: 500 });
  }
}

/**
 * v1.1.21: translate the most common cluster-keywords failures into actionable
 * one-liners. Falls back to the raw error message if nothing matches.
 */
function friendlyClusterError(err: any): string {
  const msg = String(err?.message ?? err ?? "");
  if (/ANTHROPIC_API_KEY/i.test(msg)) {
    return "Clustering needs the ANTHROPIC_API_KEY environment variable. Add it under Vercel → Project Settings → Environment Variables and redeploy.";
  }
  if (/401|unauthorized|invalid.*key/i.test(msg)) {
    return "Anthropic API rejected the request — the ANTHROPIC_API_KEY value may be invalid or revoked. Regenerate the key and update it in Vercel env vars.";
  }
  if (/429|rate[_ -]?limit/i.test(msg)) {
    return "Anthropic rate-limited the cluster call. Wait a minute and try again.";
  }
  if (/credit|balance|insufficient/i.test(msg)) {
    return "Anthropic account is out of credits. Add credits at console.anthropic.com → Billing.";
  }
  if (/model.*(not|unknown|deprecated)/i.test(msg)) {
    return "Cluster model not available on this Anthropic account. The route uses claude-haiku-4-5-20251001 — check the model is enabled for your org.";
  }
  if (/cluster JSON|parse|JSON/i.test(msg)) {
    return `Claude returned a response we couldn't parse. Usually transient — try again. (raw: ${msg.slice(0, 120)})`;
  }
  if (/POSTGRES|relation|column/i.test(msg)) {
    return "Database error while saving cluster labels. Schema may be out of date — re-run db/schema.sql in the Neon console.";
  }
  return msg || "Unknown cluster error. Check Vercel deployment logs for the full stack trace.";
}
