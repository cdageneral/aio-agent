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
// v1.1.34: bumped from 60s — large universes (1000+ kw) split into multiple
// Anthropic calls and the cumulative wall time can exceed a minute.
export const maxDuration = 300;

// v1.1.34: per-batch ceiling. The Anthropic clustering call is bounded by
// max_tokens=8192 on the response. ~400 keywords fits comfortably; above that,
// the model starts truncating output mid-cluster. We chunk anything larger and
// merge clusters by name across batches.
const CLUSTER_BATCH_SIZE = 400;

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
    // v1.1.34: the prior `keywords.length > 500` hard cap was removed. Large
    // universes are now batched (see chunked clustering below) so an analyst
    // can cluster the whole set without manual chopping.

    const segment = [project.segment_l1, project.segment_l2, project.segment_l3].filter(Boolean).join(" › ");
    const allKw = keywords.map((k) => k.keyword);

    // ── Chunk → cluster each batch → merge by name ────────────────────────
    // Keywords are sorted alphabetically before chunking so the same input
    // produces the same batches across runs. The LLM is asked to use stable
    // cluster names, which is what makes the post-merge work: a batch that
    // produces "Pricing & Billing" and a later batch that also produces
    // "Pricing & Billing" get unioned into one cluster.
    const sorted = [...allKw].sort((a, b) => a.localeCompare(b));
    const batches: string[][] = [];
    for (let i = 0; i < sorted.length; i += CLUSTER_BATCH_SIZE) {
      batches.push(sorted.slice(i, i + CLUSTER_BATCH_SIZE));
    }

    type ClusterAccumulator = { name: string; description: string; keywords: string[] };
    const merged = new Map<string, ClusterAccumulator>();
    let batchesProcessed = 0;
    for (const batch of batches) {
      const part = await clusterKeywords({
        keywords: batch,
        brand_name: project.brand_name,
        segment: segment || undefined,
      });
      for (const c of part) {
        // Case-insensitive name match for the merge key so "Pricing & Billing"
        // and "pricing & billing" coalesce.
        const key = c.name.trim().toLowerCase();
        const existing = merged.get(key);
        if (existing) {
          // Keep the first-seen description (it's just a label); union the
          // keyword lists, de-duping case-insensitively.
          const seen = new Set(existing.keywords.map((k) => k.toLowerCase()));
          for (const k of c.keywords) {
            if (!seen.has(k.toLowerCase())) {
              existing.keywords.push(k);
              seen.add(k.toLowerCase());
            }
          }
        } else {
          merged.set(key, { name: c.name.trim(), description: c.description, keywords: [...c.keywords] });
        }
      }
      batchesProcessed += 1;
    }
    const clusters = Array.from(merged.values());

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
      // v1.1.34: surface how the universe was batched. Single batch for sets
      // ≤ CLUSTER_BATCH_SIZE; multiple for larger universes that got merged.
      batches: batchesProcessed,
      batch_size: CLUSTER_BATCH_SIZE,
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
