/**
 * Snapshot diff endpoint — compares the latest completed snapshot to the
 * one before it. Surfaces the headline movements that should land in a
 * weekly digest:
 *   - newly_won:     keywords where the client was uncited last snap and is cited now
 *   - newly_lost:    keywords where the client was cited last snap and isn't now
 *   - moved_up:      keywords where the client's citation position improved
 *   - moved_down:    keywords where the client's citation position worsened
 *   - new_aios:      keywords that didn't trigger an AIO before but do now
 *   - competitor_gained: per-competitor count of newly-won citations
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { getProject, listCompetitors, listSnapshots } from "@/lib/db";
import { domainMatches } from "@/lib/domain";

export const runtime = "nodejs";

interface KwState {
  serp_id: string;
  keyword: string;
  country: string;
  has_aio: boolean;
  citations: { domain: string; position: number }[];
}

async function loadSnapshot(snapshotId: string): Promise<Map<string, KwState>> {
  const { rows: serps } = await sql<{ id: string; keyword: string; country: string; has_aio: boolean }>`
    SELECT id, keyword, country, has_aio FROM serp_results WHERE snapshot_id = ${snapshotId};`;
  const { rows: cites } = await sql<{ serp_result_id: string; domain: string; position: number }>`
    SELECT serp_result_id, domain, position FROM citations WHERE snapshot_id = ${snapshotId};`;
  const cm = new Map<string, { domain: string; position: number }[]>();
  for (const c of cites) {
    const a = cm.get(c.serp_result_id) ?? [];
    a.push({ domain: c.domain, position: c.position });
    cm.set(c.serp_result_id, a);
  }
  const out = new Map<string, KwState>();
  for (const s of serps) {
    out.set(`${s.keyword}|${s.country}`, {
      serp_id: s.id,
      keyword: s.keyword,
      country: s.country,
      has_aio: s.has_aio,
      citations: cm.get(s.id) ?? [],
    });
  }
  return out;
}

function bestPosition(state: KwState | undefined, domain: string): number | null {
  if (!state) return null;
  const owned = state.citations.filter((c) => domainMatches(c.domain, domain)).sort((a, b) => a.position - b.position);
  return owned[0]?.position ?? null;
}

export async function GET(req: NextRequest, ctx: { params: { id: string } }) {
  const project = await getProject(ctx.params.id);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });

  const url = new URL(req.url);
  const regionParam = url.searchParams.get("region");
  const regions = regionParam ? new Set(regionParam.split(",").map((r) => r.trim().toLowerCase())) : null;

  const all = (await listSnapshots(project.id)).filter((s) => s.status === "complete");
  if (all.length < 2) {
    return NextResponse.json({ enough_history: false, message: "Need at least 2 completed snapshots." });
  }
  const cur = all[all.length - 1];
  const prev = all[all.length - 2];

  const [curState, prevState] = await Promise.all([loadSnapshot(cur.id), loadSnapshot(prev.id)]);
  const competitors = await listCompetitors(project.id);
  const clientDomain = project.client_domain;
  const clientBrand = project.brand_name;

  const newly_won: { keyword: string; country: string; position: number }[] = [];
  const newly_lost: { keyword: string; country: string; lost_position: number }[] = [];
  const moved_up: { keyword: string; country: string; from: number; to: number }[] = [];
  const moved_down: { keyword: string; country: string; from: number; to: number }[] = [];
  const new_aios: { keyword: string; country: string; citation_count: number }[] = [];
  const competitor_gained = new Map<string, number>();

  const keys = new Set<string>([...curState.keys(), ...prevState.keys()]);
  for (const k of keys) {
    const c = curState.get(k);
    const p = prevState.get(k);
    if (regions && c && !regions.has(c.country.toLowerCase())) continue;
    if (regions && !c && p && !regions.has(p.country.toLowerCase())) continue;

    const cPos = bestPosition(c, clientDomain);
    const pPos = bestPosition(p, clientDomain);

    if (cPos != null && pPos == null) newly_won.push({ keyword: (c ?? p)!.keyword, country: (c ?? p)!.country, position: cPos });
    if (cPos == null && pPos != null) newly_lost.push({ keyword: (c ?? p)!.keyword, country: (c ?? p)!.country, lost_position: pPos });
    if (cPos != null && pPos != null && cPos < pPos) moved_up.push({ keyword: c!.keyword, country: c!.country, from: pPos, to: cPos });
    if (cPos != null && pPos != null && cPos > pPos) moved_down.push({ keyword: c!.keyword, country: c!.country, from: pPos, to: cPos });
    if (c?.has_aio && !p?.has_aio) new_aios.push({ keyword: c.keyword, country: c.country, citation_count: c.citations.length });

    // Competitor newly-cited tracking
    for (const comp of competitors) {
      const newPos = bestPosition(c, comp.domain);
      const oldPos = bestPosition(p, comp.domain);
      if (newPos != null && oldPos == null) {
        competitor_gained.set(comp.brand_name, (competitor_gained.get(comp.brand_name) ?? 0) + 1);
      }
    }
  }

  // Sort & cap each list for digestible output.
  const limit = 25;
  newly_won.sort((a, b) => a.position - b.position);
  newly_lost.sort((a, b) => a.lost_position - b.lost_position);
  moved_up.sort((a, b) => (a.from - a.to) > (b.from - b.to) ? -1 : 1);
  moved_down.sort((a, b) => (a.to - a.from) > (b.to - b.from) ? -1 : 1);

  return NextResponse.json({
    enough_history: true,
    client_brand: clientBrand,
    current: { id: cur.id, ran_at: cur.ran_at, aios: cur.aios_triggered },
    previous: { id: prev.id, ran_at: prev.ran_at, aios: prev.aios_triggered },
    newly_won: newly_won.slice(0, limit),
    newly_lost: newly_lost.slice(0, limit),
    moved_up: moved_up.slice(0, limit),
    moved_down: moved_down.slice(0, limit),
    new_aios: new_aios.slice(0, limit),
    counts: {
      newly_won: newly_won.length,
      newly_lost: newly_lost.length,
      moved_up: moved_up.length,
      moved_down: moved_down.length,
      new_aios: new_aios.length,
    },
    competitor_gained: Array.from(competitor_gained.entries()).map(([brand_name, count]) => ({ brand_name, count })).sort((a, b) => b.count - a.count),
  });
}
