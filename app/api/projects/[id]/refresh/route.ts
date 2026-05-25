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
 */
import { NextRequest, NextResponse } from "next/server";
import {
  createSnapshot,
  finalizeSnapshot,
  getProject,
  listCompetitors,
  listKeywords,
  saveCitations,
  saveMentions,
  saveSerpResult,
} from "@/lib/db";
import { fetchAio } from "@/lib/serpapi";
import { classifyDomain } from "@/lib/classify";
import { domainMatches, normalizeDomain } from "@/lib/domain";

export const runtime = "nodejs";
export const maxDuration = 300; // Vercel hobby = 60s, pro = 300s

const CONCURRENCY = 4;

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

export async function POST(_req: NextRequest, ctx: { params: { id: string } }) {
  const project = await getProject(ctx.params.id);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  const [keywords, competitors] = await Promise.all([
    listKeywords(ctx.params.id),
    listCompetitors(ctx.params.id),
  ]);
  if (keywords.length === 0) {
    return NextResponse.json({ error: "no keywords in universe — add some first" }, { status: 400 });
  }

  const regions = (project.regions && project.regions.length > 0 ? project.regions : ["us"]).map((r) => r.toLowerCase());
  // Each (keyword × region) pair counts toward the snapshot's keyword count.
  const snapshot = await createSnapshot(ctx.params.id, keywords.length * regions.length);

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
    // Cross-join keywords × regions so each region gets its own SERP fetch + row.
    const tasks: { keyword: string; country: string }[] = [];
    for (const kw of keywords) for (const c of regions) tasks.push({ keyword: kw.keyword, country: c });

    await pool(tasks, CONCURRENCY, async (t) => {
      try {
        const aio = await fetchAio(t.keyword, { gl: t.country });
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

    await finalizeSnapshot(snapshot.id, aios, "complete", failed ? `${failed} keyword(s) errored` : undefined);
    return NextResponse.json({ snapshot_id: snapshot.id, aios_triggered: aios, failed });
  } catch (err) {
    await finalizeSnapshot(snapshot.id, aios, "failed", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
