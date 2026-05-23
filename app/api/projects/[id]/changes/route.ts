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
// v1.1.51: opt out of Vercel's static-response cache — same reasoning as the
// quick-wins route. Snapshot diff must reflect the latest two completed
// snapshots, not whatever the CDN cached on first hit.
export const dynamic = "force-dynamic";

interface KwState {
  serp_id: string;
  keyword: string;
  country: string;
  has_aio: boolean;
  // v1.1.43: AIO answer text carried through so the competitor click-through
  // can show a snippet alongside each gained/lost keyword. Nullable for
  // historical rows that predate AIO storage.
  aio_text: string | null;
  citations: { domain: string; position: number }[];
}

async function loadSnapshot(snapshotId: string): Promise<Map<string, KwState>> {
  const { rows: serps } = await sql<{ id: string; keyword: string; country: string; has_aio: boolean; aio_text: string | null }>`
    SELECT id, keyword, country, has_aio, aio_text FROM serp_results WHERE snapshot_id = ${snapshotId};`;
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
      aio_text: s.aio_text,
      citations: cm.get(s.id) ?? [],
    });
  }
  return out;
}

// v1.1.43: shared helper — trims an AIO answer to a short, scan-friendly
// snippet for inline display. Aggressive cap because the click-through panel
// shows up to 25 rows per competitor; a verbose paragraph per row would be a
// wall of text.
function snippet(text: string | null): string | null {
  if (!text) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= 160) return clean;
  return clean.slice(0, 157).trimEnd() + "…";
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

  // v1.1.43: per-competitor keyword-level movement. The legacy
  // competitor_gained Map (counts only) is kept for backward compat with the
  // digest copier; this new structure carries the full keyword list so the
  // UI can click-through a brand name and see which queries drove the
  // delta. Both directions (gained AND lost) are tracked.
  type CompMoveRow = {
    keyword: string;
    country: string;
    position: number;
    aio_snippet: string | null;
  };
  type CompLostRow = {
    keyword: string;
    country: string;
    lost_position: number;
    aio_snippet: string | null;
  };
  const compGainedKeywords = new Map<string, CompMoveRow[]>();
  const compLostKeywords = new Map<string, CompLostRow[]>();

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

    // Competitor movement tracking — both directions, with keyword-level
    // detail so the UI can drill into "which 16 keywords did Edward Jones
    // newly win?". Snippet comes from whichever side actually has an AIO.
    for (const comp of competitors) {
      const newPos = bestPosition(c, comp.domain);
      const oldPos = bestPosition(p, comp.domain);
      if (newPos != null && oldPos == null) {
        // Gained: newly cited this snapshot.
        competitor_gained.set(comp.brand_name, (competitor_gained.get(comp.brand_name) ?? 0) + 1);
        const arr = compGainedKeywords.get(comp.brand_name) ?? [];
        arr.push({
          keyword: (c ?? p)!.keyword,
          country: (c ?? p)!.country,
          position: newPos,
          aio_snippet: snippet(c?.aio_text ?? null),
        });
        compGainedKeywords.set(comp.brand_name, arr);
      } else if (newPos == null && oldPos != null) {
        // Lost: was cited last snapshot, isn't now.
        const arr = compLostKeywords.get(comp.brand_name) ?? [];
        arr.push({
          keyword: (c ?? p)!.keyword,
          country: (c ?? p)!.country,
          lost_position: oldPos,
          aio_snippet: snippet(p?.aio_text ?? c?.aio_text ?? null),
        });
        compLostKeywords.set(comp.brand_name, arr);
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
    // v1.1.43: full per-competitor movement with keyword lists, so the UI can
    // click-through a competitor name and see which queries drove the delta.
    // Includes brands that only had losses (count > 0 in lost map but missing
    // from gained map) so a brand that's slipping shows up too.
    competitor_movement: (() => {
      const brandNames = new Set<string>([
        ...compGainedKeywords.keys(),
        ...compLostKeywords.keys(),
      ]);
      const rows = Array.from(brandNames).map((brand_name) => {
        const gained = (compGainedKeywords.get(brand_name) ?? []).slice().sort((a, b) => a.position - b.position);
        const lost = (compLostKeywords.get(brand_name) ?? []).slice().sort((a, b) => a.lost_position - b.lost_position);
        return {
          brand_name,
          net: gained.length - lost.length,
          gained_count: gained.length,
          lost_count: lost.length,
          gained: gained.slice(0, limit),
          lost: lost.slice(0, limit),
        };
      });
      // Sort by absolute movement so the noisiest brands surface first.
      return rows.sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || b.gained_count - a.gained_count);
    })(),
  });
}
