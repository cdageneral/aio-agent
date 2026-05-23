/**
 * v1.1.37: Refresh progress endpoint.
 *
 * The POST /refresh route runs synchronously and only returns when the entire
 * job finishes — for large universes (1000+ keywords) that's many minutes,
 * and on Vercel the function will likely time out long before completion.
 *
 * This GET endpoint exists so the UI can show "X of Y processed" while a
 * refresh is in flight (or, after a timeout, surface where it died). Reads
 * the latest snapshot for the project and counts how many serp_results rows
 * have been written to it.
 *
 * Response shape:
 *   { snapshot: null }                        — never refreshed
 *   { snapshot: { id, status, ran_at, total, done, aios_so_far, failed_so_far,
 *                  pct, elapsed_sec, stalled } }
 *
 * `stalled` is a heuristic — true when status === 'running' but no new
 * serp_result has landed in the last 60s. Usually means the Vercel function
 * was killed by the runtime time limit.
 */
import { NextRequest, NextResponse } from "next/server";
import { latestSnapshotAnyStatus, snapshotProgress } from "@/lib/db";

export const runtime = "nodejs";
// Light read-only endpoint — default 10s is plenty.

export async function GET(_req: NextRequest, ctx: { params: { id: string } }) {
  const snap = await latestSnapshotAnyStatus(ctx.params.id);
  if (!snap) return NextResponse.json({ snapshot: null });

  const { done, aios_so_far, failed_so_far } = await snapshotProgress(snap.id);
  const total = snap.keywords_count ?? 0;
  const pct = total > 0 ? Math.min(1, done / total) : 0;
  const ranAtMs = new Date(snap.ran_at).getTime();
  const elapsed_sec = Math.max(0, Math.round((Date.now() - ranAtMs) / 1000));

  // Stall detection: if status is still 'running' but no progress in 60s,
  // the underlying serverless invocation almost certainly died. The UI
  // surfaces this as a warning so the user isn't left guessing.
  // We approximate "no progress in 60s" by checking elapsed time vs done —
  // if done === 0 and we're past 60s, or if rate has fallen to ~0, it's stalled.
  // For a more robust check we'd need a per-result inserted_at timestamp, but
  // we don't have one and adding one is invasive — this approximation catches
  // the common cases.
  let stalled = false;
  if (snap.status === "running") {
    if (done === 0 && elapsed_sec > 60) stalled = true;
    // If we've been running > 5min and overall rate is below 0.05/s (3 per minute),
    // probably stuck — most installs do at least ~2 per second.
    if (elapsed_sec > 300 && done > 0 && (done / elapsed_sec) < 0.05) stalled = true;
  }

  return NextResponse.json({
    snapshot: {
      id: snap.id,
      status: snap.status,
      ran_at: snap.ran_at,
      total,
      done,
      aios_so_far,
      failed_so_far,
      pct,
      elapsed_sec,
      stalled,
      error: snap.error ?? null,
    },
  });
}
