/**
 * Trigger a SERP refresh for all keywords in the project's universe.
 *
 * v1.1.64: rewritten as a CHUNKED endpoint to dodge Vercel's per-function
 * 300-second cap on Pro plans. For universes past ~400-500 keywords the
 * old single-call refresh would predictably 504: 600 keywords × ~3s per
 * SerpAPI call ÷ concurrency 4 = ~450s of wall-clock work, which overruns
 * the 300s function limit (the edge proxy returns a 504 once the underlying
 * function dies). Now the same total work is split across multiple POSTs,
 * each one processing a slice of the (keyword × region) task list. The
 * client (Dashboard.tsx) iterates chunks sequentially and continues using
 * /refresh/progress to drive the live progress widget — that endpoint reads
 * serp_results row counts, which tick up smoothly across chunks since each
 * chunk inserts rows into the same snapshot.
 *
 * Request shape:
 *   POST /api/projects/[id]/refresh
 *     (no params)              — start a new refresh; processes chunk 0
 *     ?snapshotId=X&chunk=N    — continue snapshot X by processing chunk N
 *
 * Response shape (always):
 *   {
 *     snapshot_id, chunk, total_chunks, chunk_size, total_tasks,
 *     tasks_processed_this_chunk, aios_this_chunk, failed_this_chunk,
 *     cumulative_aios, cumulative_failed,
 *     is_final, aios_triggered (only on is_final), failed (only on is_final)
 *   }
 *
 * Backward compat: a single POST with no params for a SMALL universe
 * (≤CHUNK_SIZE tasks) finishes in one call with is_final=true on the very
 * first response, so existing callers that read snapshot_id + aios_triggered
 * still work for small projects.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  createSnapshot,
  finalizeSnapshot,
  getProject,
  getSnapshot,
  listCompetitors,
  listKeywords,
  saveCitations,
  saveMentions,
  saveSerpResult,
  snapshotProgress,
} from "@/lib/db";
import { fetchAio } from "@/lib/serpapi";
import { classifyDomain } from "@/lib/classify";
import { domainMatches, normalizeDomain } from "@/lib/domain";

export const runtime = "nodejs";
export const maxDuration = 300; // Vercel hobby = 60s, pro = 300s

const CONCURRENCY = 4;

/**
 * v1.1.64: tasks per chunk. Sized so a typical chunk finishes well inside
 * the 300s Vercel-Pro cap with headroom for SerpAPI latency spikes.
 *
 *   200 tasks ÷ concurrency 4 = 50 sequential batches of 4
 *   50 batches × ~3s per SerpAPI batch ≈ 150s wall-clock
 *   + ~10-20s for DB writes and edge overhead
 *   = ~165-180s per chunk, comfortably under 300s.
 *
 * Tuneable by clients via ?chunkSize=N (capped at MAX_CHUNK_SIZE so a buggy
 * caller can't request a 5000-task chunk and trip the timeout).
 */
const DEFAULT_CHUNK_SIZE = 200;
const MAX_CHUNK_SIZE = 400;

async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (true) {
        const idx = i++;
        if (idx >= items.length) return;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  const url = new URL(req.url);
  const snapshotIdParam = url.searchParams.get("snapshotId");
  const chunkRaw = parseInt(url.searchParams.get("chunk") ?? "", 10);
  const chunk = Number.isFinite(chunkRaw) && chunkRaw >= 0 ? chunkRaw : 0;
  const chunkSizeRaw = parseInt(url.searchParams.get("chunkSize") ?? "", 10);
  const chunkSize = Number.isFinite(chunkSizeRaw) && chunkSizeRaw > 0
    ? Math.min(chunkSizeRaw, MAX_CHUNK_SIZE)
    : DEFAULT_CHUNK_SIZE;

  const project = await getProject(ctx.params.id);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  const [keywordsRaw, competitors] = await Promise.all([
    listKeywords(ctx.params.id),
    listCompetitors(ctx.params.id),
  ]);
  if (keywordsRaw.length === 0) {
    return NextResponse.json({ error: "no keywords in universe — add some first" }, { status: 400 });
  }

  // Deterministic task ordering: every chunk POST re-derives the SAME task
  // list and slices it by chunk index. listKeywords already returns rows
  // ordered by added_at, but added_at ties on bulk inserts can shuffle the
  // order subtly across calls. Belt-and-suspenders sort by keyword text so
  // chunk N processes the same 200 tasks every time it's called, even if
  // the underlying DB query plan changes between calls.
  const keywords = [...keywordsRaw].sort((a, b) => a.keyword.localeCompare(b.keyword));
  const regions = (project.regions && project.regions.length > 0 ? project.regions : ["us"]).map((r) => r.toLowerCase());

  const tasks: { keyword: string; country: string }[] = [];
  for (const kw of keywords) for (const c of regions) tasks.push({ keyword: kw.keyword, country: c });

  const totalTasks = tasks.length;
  const totalChunks = Math.max(1, Math.ceil(totalTasks / chunkSize));

  if (chunk >= totalChunks) {
    return NextResponse.json(
      { error: `chunk ${chunk} is out of range — total_chunks=${totalChunks}` },
      { status: 400 },
    );
  }

  // Get-or-create the snapshot row this chunk should append into.
  let snapshotId: string;
  if (snapshotIdParam) {
    const existing = await getSnapshot(snapshotIdParam);
    if (!existing) {
      return NextResponse.json({ error: "snapshotId not found" }, { status: 404 });
    }
    if (existing.project_id !== project.id) {
      return NextResponse.json({ error: "snapshotId belongs to a different project" }, { status: 403 });
    }
    if (existing.status !== "running") {
      return NextResponse.json(
        { error: `snapshot is already ${existing.status}; start a fresh refresh` },
        { status: 409 },
      );
    }
    snapshotId = snapshotIdParam;
  } else {
    if (chunk !== 0) {
      return NextResponse.json(
        { error: "chunk > 0 requires snapshotId — start with chunk 0 (or no params)" },
        { status: 400 },
      );
    }
    // First chunk for a brand-new refresh — create the snapshot now. Its
    // keywords_count is the TOTAL across all chunks so the progress
    // endpoint's "done / total" math is correct from poll 1.
    const newSnapshot = await createSnapshot(ctx.params.id, totalTasks);
    snapshotId = newSnapshot.id;
  }

  const tracked = [
    {
      brand_name: project.brand_name,
      brand_aliases: project.brand_aliases ?? [],
      domain: project.client_domain,
      kind: "client" as const,
    },
    ...competitors.map((c) => ({
      brand_name: c.brand_name,
      brand_aliases: c.brand_aliases ?? [],
      domain: c.domain,
      kind: "competitor" as const,
    })),
  ];

  // Slice the task list for THIS chunk.
  const start = chunk * chunkSize;
  const end = Math.min(start + chunkSize, totalTasks);
  const chunkTasks = tasks.slice(start, end);
  const isFinal = end >= totalTasks;

  let chunkAios = 0;
  let chunkFailed = 0;

  try {
    await pool(chunkTasks, CONCURRENCY, async (t) => {
      try {
        const aio = await fetchAio(t.keyword, { gl: t.country });
        const hasAio = !!aio?.hasAio;
        const aioText = aio?.text ?? null;
        const serpId = await saveSerpResult({
          snapshot_id: snapshotId,
          project_id: project.id,
          keyword: t.keyword,
          country: t.country,
          has_aio: hasAio,
          aio_text: aioText,
          raw: aio?.raw,
        });
        if (hasAio) chunkAios += 1;

        if (aio && aio.references.length > 0) {
          const trackedDomains = tracked.map((t) => t.domain);
          await saveCitations(
            aio.references.map((r, idx) => ({
              serp_result_id: serpId,
              snapshot_id: snapshotId,
              project_id: project.id,
              position: idx + 1,
              url: r.link,
              domain: normalizeDomain(r.domain || r.link),
              title: r.title ?? null,
              source_type: classifyDomain(r.domain || r.link, { trackedDomains }),
            })),
          );
        }

        // Mentions: each tracked brand whose name appears in AIO text OR whose domain is cited.
        const mentionRows: {
          serp_result_id: string;
          snapshot_id: string;
          project_id: string;
          brand_name: string;
          brand_kind: "client" | "competitor";
          kind: "cited" | "mentioned" | "both";
        }[] = [];
        if (aioText || aio?.references?.length) {
          for (const b of tracked) {
            const cited = (aio?.references ?? []).some((r) => domainMatches(r.domain, b.domain));
            const aliases = [b.brand_name, ...(b.brand_aliases ?? [])].filter(Boolean);
            const re = new RegExp(
              `\\b(${aliases.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
              "i",
            );
            const mentioned = !!aioText && re.test(aioText);
            if (cited || mentioned) {
              mentionRows.push({
                serp_result_id: serpId,
                snapshot_id: snapshotId,
                project_id: project.id,
                brand_name: b.brand_name,
                brand_kind: b.kind,
                kind: cited && mentioned ? "both" : cited ? "cited" : "mentioned",
              });
            }
          }
        }
        if (mentionRows.length) await saveMentions(mentionRows);
      } catch (err) {
        chunkFailed += 1;
        // best-effort: still record the no-AIO row so missing keywords don't go silent
        await saveSerpResult({
          snapshot_id: snapshotId,
          project_id: project.id,
          keyword: t.keyword,
          country: t.country,
          has_aio: false,
          aio_text: null,
          raw: { error: (err as Error).message },
        });
      }
    });

    // Pull cumulative counts from the DB — this is the SAME query the
    // progress endpoint uses, so the numbers the client sees in the response
    // match what the polling widget displays. Important because chunkAios
    // and chunkFailed are only this-chunk counts; the client wants the
    // running total for its "Snapshot saved — N AIO(s) detected" banner.
    const cumulative = await snapshotProgress(snapshotId);

    if (isFinal) {
      await finalizeSnapshot(
        snapshotId,
        cumulative.aios_so_far,
        "complete",
        cumulative.failed_so_far ? `${cumulative.failed_so_far} keyword(s) errored` : undefined,
      );
    }

    return NextResponse.json({
      snapshot_id: snapshotId,
      chunk,
      total_chunks: totalChunks,
      chunk_size: chunkSize,
      total_tasks: totalTasks,
      tasks_processed_this_chunk: chunkTasks.length,
      aios_this_chunk: chunkAios,
      failed_this_chunk: chunkFailed,
      cumulative_aios: cumulative.aios_so_far,
      cumulative_failed: cumulative.failed_so_far,
      is_final: isFinal,
      // Back-compat for callers that read the single-call response shape —
      // these are only meaningful on the final chunk but always present so
      // TypeScript callers don't need conditional unwrapping.
      aios_triggered: isFinal ? cumulative.aios_so_far : null,
      failed: isFinal ? cumulative.failed_so_far : null,
    });
  } catch (err) {
    // A hard failure in chunk processing kills the whole snapshot. We
    // finalize as 'failed' so subsequent /refresh/progress polls treat the
    // snapshot as terminal and the client surfaces an error banner.
    await finalizeSnapshot(snapshotId, chunkAios, "failed", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
