/**
 * Trigger a SERP refresh for all keywords in the project's universe.
 * Creates one snapshot row, fetches AIO data for each keyword, persists
 * serp_results + citations + mentions, then marks the snapshot complete.
 *
 * Notes:
 *  - Sequential fetch with a small concurrency limit. SerpAPI is generally
 *    okay with parallel requests, but staying gentle keeps cost predictable
 *    and avoids 429s on shared accounts.
 *  - All metric math happens at read time in /api/projects/[id]/metrics.
 *
 * v1.1.63: chunked-refresh support. Large universes (300+ keywords at
 * CONCURRENCY=8 still brush the 300 s Pro ceiling) are now split into
 * client-driven batches of ~50 keywords each. The client makes multiple
 * sequential POST calls, passing back the snapshotId from the first
 * response so all chunks write into a single snapshot row. Each individual
 * HTTP call completes in ≈15–20 s, well inside any proxy or Vercel limit.
 *
 * Request body (all fields optional):
 *   { snapshotId?: string,  // undefined = first chunk, create new snapshot
 *     kwOffset?:  number,   // 0-based keyword index (default 0)
 *     kwLimit?:   number }  // max keywords this call (undefined = all)
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

// v1.1.62: raised from 4 → 8 to halve wall-clock time on large universes.
// v1.1.63: with chunking, each HTTP call only processes ~50 keywords so this
// is a safety net rather than a primary lever, but keep it high for speed.
const CONCURRENCY = 8;

// v1.1.62: per-keyword hard timeout.  A single stalled SerpAPI call (network
// hiccup, async follow-up that never resolves) can pin one of the N pool slots
// for the entire remaining duration, effectively reducing concurrency and
// extending wall-clock time.  15 s is generous for a typical SERP fetch
// (p99 < 5 s in practice) but safely below the 60 s Hobby limit, so even the
// worst-case scenario — every slot stalling simultaneously — still finishes
// before a Hobby timeout kills the function.
const KW_TIMEOUT_MS = 15_000;

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
  const project = await getProject(ctx.params.id);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  // v1.1.63: parse optional chunking params from request body.
  // All fields are optional — a body-less POST (or an empty JSON body) behaves
  // identically to pre-v1.1.63: creates a new snapshot and processes everything.
  let body: { snapshotId?: string; kwOffset?: number; kwLimit?: number } = {};
  try {
    body = await req.json();
  } catch {
    // No body / invalid JSON — treat as first chunk with no limit.
  }
  const { snapshotId: existingSnapshotId, kwOffset = 0, kwLimit } = body;

  const [allKeywords, competitors] = await Promise.all([
    listKeywords(ctx.params.id),
    listCompetitors(ctx.params.id),
  ]);
  if (allKeywords.length === 0) {
    return NextResponse.json({ error: "no keywords in universe — add some first" }, { status: 400 });
  }

  const regions = (project.regions && project.regions.length > 0 ? project.regions : ["us"]).map((r) => r.toLowerCase());

  // v1.1.63: slice the keyword list to this chunk's window.
  // isLastChunk is true when this call will process the final keyword.
  const effectiveKeywords = kwLimit
    ? allKeywords.slice(kwOffset, kwOffset + kwLimit)
    : allKeywords;
  const isLastChunk = !kwLimit || (kwOffset + kwLimit >= allKeywords.length);

  // v1.1.63: reuse an existing snapshot on chunks 2+; create one on chunk 1.
  // The total keywords_count is always set to the FULL universe size × regions
  // so the progress bar denominator is correct from the moment the snapshot is
  // created, even though the first API call only processes a fraction of it.
  let snapshot;
  if (existingSnapshotId) {
    snapshot = await getSnapshot(existingSnapshotId);
    if (!snapshot) return NextResponse.json({ error: "snapshot not found" }, { status: 404 });
  } else {
    snapshot = await createSnapshot(ctx.params.id, allKeywords.length * regions.length);
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

  let aios = 0;
  let failed = 0;

  try {
    // Cross-join this chunk's keywords × regions so each region gets its own SERP fetch + row.
    const tasks: { keyword: string; country: string }[] = [];
    for (const kw of effectiveKeywords) for (const c of regions) tasks.push({ keyword: kw.keyword, country: c });

    await pool(tasks, CONCURRENCY, async (t) => {
      try {
        const aio = await fetchAio(t.keyword, { gl: t.country, timeoutMs: KW_TIMEOUT_MS });
        const hasAio = !!aio?.hasAio;
        const aioText = aio?.text ?? null;
        const serpId = await saveSerpResult({
          snapshot_id: snapshot.id,
          project_id: project.id,
          keyword: t.keyword,
          country: t.country,
          has_aio: hasAio,
          aio_text: aioText,
          raw: aio?.raw,
        });
        if (hasAio) aios += 1;

        if (aio && aio.references.length > 0) {
          const trackedDomains = tracked.map((t) => t.domain);
          await saveCitations(
            aio.references.map((r, idx) => ({
              serp_result_id: serpId,
              snapshot_id: snapshot.id,
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
                snapshot_id: snapshot.id,
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
        failed += 1;
        // best-effort: still record the no-AIO row so missing keywords don't go silent
        await saveSerpResult({
          snapshot_id: snapshot.id,
          project_id: project.id,
          keyword: t.keyword,
          country: t.country,
          has_aio: false,
          aio_text: null,
          raw: { error: (err as Error).message },
        });
      }
    });

    // v1.1.63: only finalize the snapshot on the last chunk. Intermediate chunks
    // return early with the snapshotId so the client can continue. The progress
    // endpoint continues to work between chunks — it reads serp_results rows
    // regardless of snapshot status, so the bar updates in real time throughout.
    if (isLastChunk) {
      // Use the DB's authoritative count (accumulated across all chunks) rather
      // than the local `aios` variable which only covers this chunk.
      const { aios_so_far } = await snapshotProgress(snapshot.id);
      await finalizeSnapshot(
        snapshot.id,
        aios_so_far,
        "complete",
        failed ? `${failed} keyword(s) errored` : undefined,
      );
      return NextResponse.json({
        snapshot_id: snapshot.id,
        aios_triggered: aios_so_far,
        total_aios: aios_so_far,
        failed,
        is_last_chunk: true,
      });
    }

    return NextResponse.json({
      snapshot_id: snapshot.id,
      aios_triggered: aios,
      total_aios: aios, // partial — client accumulates; last chunk returns DB total
      failed,
      is_last_chunk: false,
    });
  } catch (err) {
    // On any unhandled error, fail the snapshot if this was the first chunk
    // (it was just created). On subsequent chunks, leave it in 'running' —
    // the zombie auto-fail in /refresh/progress will clean it up.
    if (!existingSnapshotId) {
      await finalizeSnapshot(snapshot.id, aios, "failed", (err as Error).message);
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
