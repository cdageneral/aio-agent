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
import { finalizeSnapshot, latestSnapshotAnyStatus, snapshotProgress } from "@/lib/db";

export const runtime = "nodejs";
// v1.1.52: removed v1.1.51's force-dynamic — see quick-wins for context.
// Light read-only endpoint — default 10s is plenty.

// v1.1.45: hard age cap on 'running' snapshots. Vercel function max is 60s
// (Hobby) or 300s (Pro). A snapshot still in 'running' status 10+ minutes
// after ran_at is definitely a zombie — the serverless invocation that owned
// it was killed by the runtime time limit and we never got to call
// finalizeSnapshot. Anything past this threshold is auto-failed so the row
// stops being returned as a "live" refresh on subsequent polls.
const ZOMBIE_THRESHOLD_SEC = 600;

export async function GET(_req: NextRequest, ctx: { params: { id: string } }) {
  let snap = await latestSnapshotAnyStatus(ctx.params.id);
  if (!snap) return NextResponse.json({ snapshot: null });

  const { done, aios_so_far, failed_so_far } = await snapshotProgress(snap.id);
  const total = snap.keywords_count ?? 0;
  const pct = total > 0 ? Math.min(1, done / total) : 0;
  const ranAtMs = new Date(snap.ran_at).getTime();
  const elapsed_sec = Math.max(0, Math.round((Date.now() - ranAtMs) / 1000));

  // v1.1.45: auto-fail zombie snapshots. If status is still 'running' but
  // elapsed is well past the Vercel max function duration, the underlying
  // invocation is dead — no amount of polling will ever flip it to
  // 'complete'. Permanently mark it failed so the row stops being treated
  // as a live refresh by every consumer (this endpoint, the snapshots list,
  // the dashboard polling effect, etc.). One DB write per zombie, only on
  // the first poll that crosses the threshold; subsequent polls find it
  // already-failed and skip the update.
  if (snap.status === "running" && elapsed_sec > ZOMBIE_THRESHOLD_SEC) {
    try {
      await finalizeSnapshot(
        snap.id,
        done,
        "failed",
        `Auto-failed after ${Math.round(elapsed_sec / 60)} minutes in 'running' state — the serverless function was almost certainly killed by Vercel's execution time limit before it could finalize.`,
      );
      // Re-fetch so the response reflects the just-updated status. Cheap
      // (latest-row by ran_at) and keeps the client from seeing 'running'
      // for one more poll cycle.
      const refreshed = await latestSnapshotAnyStatus(ctx.params.id);
      if (!refreshed) return NextResponse.json({ snapshot: null });
      snap = refreshed;
    } catch (e) {
      // Non-fatal — if the update fails (transient DB issue), we'll still
      // return the snapshot in its pre-fail state; client-side guards
      // (defense-in-depth in Dashboard.tsx) will treat overly-old running
      // snapshots as stale anyway.
      console.error("[refresh/progress] zombie auto-fail update failed:", e);
    }
  }

  // Stall detection: if status is still 'running' but no progress in 60s,
  // the underlying serverless invocation almost certainly died. The UI
  // surfaces this as a warning so the user isn't left guessing.
  // We approximate "no progress in 60s" by checking elapsed time vs done —
  // if done === 0 and we're past 60s, or if rate has fallen to ~0, it's stalled.
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
