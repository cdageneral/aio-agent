"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RegionMode, regionsForMode } from "./RegionSelector";

interface QuickWin {
  keyword: string;
  country: string;
  score: number;
  reasons: string[];
  citation_count: number;
  competitors_cited: { brand_name: string; position: number | null }[];
  client_mentioned: boolean;
  source: string | null;
  cluster_label: string | null;
  serp_result_id: string;
}

/**
 * Top-N gettable AIO citations the client is currently missing. Sorted by
 * score (gap + organic-rank + competitor-presence + mention partial credit).
 * Each row carries its rationale chips — explainability is the whole point.
 */
export default function QuickWinsPanel({
  projectId,
  region,
  clientBrand,
  clusterFilter,
  onClusterFilterChange,
  kindFilter = "all",
  refreshNonce = 0,
}: {
  projectId: string;
  region: RegionMode;
  clientBrand: string;
  /** Controlled cluster filter — Dashboard owns this so clicking a cluster card pushes through here. */
  clusterFilter: string;
  onClusterFilterChange: (v: string) => void;
  /** v1.1.27: branded/non-branded scope. "all" = no filter. */
  kindFilter?: "all" | "branded" | "non_branded";
  /** v1.1.15: increments when the parent's metrics reload OR a refresh
   *  completes. Listening here forces a re-fetch so AIO Opportunities
   *  reflects the just-landed snapshot instead of stale data. */
  refreshNonce?: number;
}) {
  const [wins, setWins] = useState<QuickWin[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  // v1.1.49/v1.1.50: snapshot diagnostics — populated alongside `wins` from
  // the same /quick-wins response. Lets the empty state render specific copy
  // ("16 AIOs in Canada, all 16 already cited by CHIP") instead of the
  // generic three-causes hand-wave. v1.1.50 dropped the
  // total_serps_in_snapshot / serps_in_region_total fields because their
  // SQL was flaky on Vercel Postgres and was bringing down the whole
  // endpoint.
  const [diagnostics, setDiagnostics] = useState<{
    snapshot_ran_at: string;
    regions_in_view: string[] | null;
    aios_in_region: number;
    aios_won_by_client: number;
    aios_open_gaps: number;
    client_brand: string;
  } | null>(null);
  // v1.1.50: surface server errors instead of silently degrading to "no
  // completed snapshot." v1.1.49 had a SQL syntax issue that made every
  // quick-wins call 500; the client's old code did `j = await res.json()`
  // with no `res.ok` check, so the 500's `{error: …}` shape parsed without
  // throwing but without `opportunities` or `diagnostics`, and the empty
  // state rendered the most-pessimistic branch. Tracking serverError lets
  // us tell the user "the endpoint is broken, here's the message" instead.
  const [serverError, setServerError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setServerError(null);
    const params = new URLSearchParams({ region: regionsForMode(region).join(","), limit: "60" });
    if (kindFilter !== "all") params.set("kind", kindFilter);
    try {
      const res = await fetch(`/api/projects/${projectId}/quick-wins?${params.toString()}`, { cache: "no-store" });
      let j: any = null;
      try {
        j = await res.json();
      } catch {
        const body = await res.text().catch(() => "");
        throw new Error(
          `Server returned ${res.status} ${res.statusText} (unparseable response${body ? `: ${body.slice(0, 160)}` : ""})`,
        );
      }
      if (!res.ok) throw new Error(j?.error ?? `Server returned ${res.status} ${res.statusText}`);
      setWins(j.opportunities ?? []);
      setTotal(j.total_opportunities ?? 0);
      setDiagnostics(j.diagnostics ?? null);
    } catch (e: any) {
      setServerError(e?.message ?? String(e));
      // Force the empty-state branch to render so the error surfaces.
      setWins([]);
      setDiagnostics(null);
    } finally {
      setLoading(false);
    }
  }, [projectId, region, kindFilter]);

  useEffect(() => { load(); }, [load, refreshNonce]);

  const clusterOptions = useMemo(() => {
    if (!wins) return { entries: [] as [string, number][], unclustered: 0 };
    const counts = new Map<string, number>();
    let unclustered = 0;
    for (const w of wins) {
      if (w.cluster_label) counts.set(w.cluster_label, (counts.get(w.cluster_label) ?? 0) + 1);
      else unclustered += 1;
    }
    return { entries: Array.from(counts.entries()).sort((a, b) => b[1] - a[1]), unclustered };
  }, [wins]);

  const filteredWins = useMemo(() => {
    if (!wins) return [];
    if (clusterFilter === "all") return wins.slice(0, 12);
    if (clusterFilter === "__unclustered") return wins.filter((w) => !w.cluster_label).slice(0, 12);
    return wins.filter((w) => w.cluster_label === clusterFilter).slice(0, 12);
  }, [wins, clusterFilter]);

  // v1.1.29: only show the "Scoring opportunities…" placeholder on the FIRST
  // load (when wins is still null). On subsequent refetches (scope toggle,
  // refresh nonce bump) keep the existing list rendered so the page doesn't
  // shrink and snap the user's scroll position upward.
  if (loading && !wins) return <div className="text-sm muted">Scoring opportunities…</div>;
  if (!wins || wins.length === 0) {
    // v1.1.44/v1.1.49/v1.1.50: data-driven empty state. Picks copy based on
    // what the server actually reported, with serverError taking top priority
    // so a broken endpoint can't masquerade as "no data."
    const regionLabel = region === "us" ? "USA" : region === "ca" ? "Canada" : "USA + Canada";
    if (serverError) {
      return (
        <div
          role="alert"
          style={{
            margin: 18,
            padding: "12px 14px",
            borderRadius: 10,
            background: "rgba(255,100,100,0.08)",
            border: "1px solid rgba(255,100,100,0.40)",
            color: "#ffb1b1",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <div style={{ fontWeight: 600, color: "#ff6464", marginBottom: 4 }}>
            AIO Opportunities couldn&apos;t load
          </div>
          <div style={{ overflowWrap: "anywhere" }}>{serverError}</div>
        </div>
      );
    }
    let diagnosis: React.ReactNode;
    if (!diagnostics) {
      diagnosis = (
        <>No completed snapshot for this project yet. Run a refresh first.</>
      );
    } else if (diagnostics.aios_in_region === 0) {
      // Either the region wasn't crawled or no AIOs triggered. Without an
      // extra "serps in region" count we can't tell which — but the action
      // is the same: refresh with this region, or check that the universe
      // has AIO-prone keywords.
      diagnosis = (
        <>
          The latest snapshot has 0 AIOs in <strong style={{ color: "#f4f6fb" }}>{regionLabel}</strong>. Either the region wasn&apos;t crawled, or none of the tracked queries trigger an AIO here right now. Try switching the region toggle and clicking Run refresh.
        </>
      );
    } else if (diagnostics.aios_open_gaps === 0) {
      // AIOs exist but every one is already won by the client.
      diagnosis = (
        <>
          <strong style={{ color: "#f4f6fb" }}>{diagnostics.aios_in_region.toLocaleString()}</strong> AIO{diagnostics.aios_in_region === 1 ? "" : "s"} in <strong style={{ color: "#f4f6fb" }}>{regionLabel}</strong>, all already cited by <strong style={{ color: "#f4f6fb" }}>{diagnostics.client_brand}</strong>. No gaps to chase — defend what you have.
        </>
      );
    } else {
      // Server reported open gaps but client got 0 rows — probably a client-
      // side filter (cluster, kind) that excluded everything.
      diagnosis = (
        <>
          {diagnostics.aios_open_gaps.toLocaleString()} open gap{diagnostics.aios_open_gaps === 1 ? "" : "s"} in <strong style={{ color: "#f4f6fb" }}>{regionLabel}</strong>, but none match the current cluster/kind filters. Clear the filters above to see them.
        </>
      );
    }
    return (
      <div className="text-sm muted" style={{ padding: 18, lineHeight: 1.5 }}>
        <div>No gettable opportunities for <strong style={{ color: "#f4f6fb" }}>{regionLabel}</strong> in the latest snapshot.</div>
        <div style={{ fontSize: 12, color: "#8a93a6", marginTop: 8 }}>{diagnosis}</div>
      </div>
    );
  }

  const max = filteredWins[0]?.score ?? wins[0]?.score ?? 100;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <p className="text-xs muted">
          Showing top {filteredWins.length} of <strong style={{ color: "#f4f6fb" }}>{total}</strong> gap opportunities — AIOs you're not in but could win.
        </p>
        <div className="flex items-center gap-3 text-xs muted flex-wrap">
          {clusterOptions.entries.length > 0 && (
            <select
              value={clusterFilter}
              onChange={(e) => onClusterFilterChange(e.target.value)}
              className="input"
              style={{
                fontSize: 11.5, padding: "5px 24px 5px 10px",
                background: clusterFilter !== "all" ? "rgba(168,120,255,0.10)" : "#11151d",
                border: clusterFilter !== "all" ? "1px solid rgba(168,120,255,0.40)" : "1px solid rgba(255,255,255,0.07)",
                color: clusterFilter !== "all" ? "#a878ff" : "#f4f6fb",
                fontWeight: clusterFilter !== "all" ? 600 : 400,
              }}
            >
              <option value="all">All clusters</option>
              {clusterOptions.entries.map(([name, n]) => (
                <option key={name} value={name}>{name} ({n})</option>
              ))}
              {clusterOptions.unclustered > 0 && (
                <option value="__unclustered">Unclustered ({clusterOptions.unclustered})</option>
              )}
            </select>
          )}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 8, height: 8, background: "#b6f53b", borderRadius: 2 }} />priority score
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 8, height: 8, background: "rgba(255,255,255,0.10)", borderRadius: 2 }} />remaining
          </span>
        </div>
      </div>

      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {filteredWins.length === 0 && (
          <li style={{ fontSize: 12, color: "#8a93a6", padding: 14, textAlign: "center" }}>
            No opportunities in this cluster.
          </li>
        )}
        {filteredWins.map((w, i) => (
          <li key={w.serp_result_id} style={{
            background: "#0c0f15",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 12,
            padding: "12px 14px",
            position: "relative",
            overflow: "hidden",
          }}>
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(182,245,59,0.08) 0%, transparent 100%)", width: `${Math.min(100, (w.score / max) * 100)}%`, pointerEvents: "none" }} />
            <div style={{ position: "relative", display: "grid", gridTemplateColumns: "40px 1fr auto", gap: 14, alignItems: "center" }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "#5a6478", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>#</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#b6f53b" }}>{i + 1}</div>
              </div>

              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#f4f6fb", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {w.keyword}
                  </div>
                  <RegionBadge c={w.country} />
                  {w.source && (
                    <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 999, background: "rgba(255,255,255,0.05)", color: "#8a93a6", fontWeight: 600 }}>{w.source}</span>
                  )}
                  {w.cluster_label && (
                    <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 999, background: "rgba(168,120,255,0.14)", color: "#a878ff", fontWeight: 600 }}>
                      {w.cluster_label}
                    </span>
                  )}
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {w.reasons.slice(0, 3).map((r, j) => (
                    <span key={j} style={{ fontSize: 10.5, color: "#8a93a6", background: "rgba(255,255,255,0.04)", padding: "2px 7px", borderRadius: 4 }}>{r}</span>
                  ))}
                </div>

                {w.competitors_cited.length > 0 && (
                  <div style={{ marginTop: 6, fontSize: 11, color: "#8a93a6" }}>
                    <span style={{ color: "#ff5d9e", fontWeight: 600 }}>Cited:</span>{" "}
                    {w.competitors_cited.map((c, j) => (
                      <span key={c.brand_name}>
                        {j > 0 && <span style={{ color: "#3a414f" }}> · </span>}
                        <span style={{ color: "#d6dbe6" }}>{c.brand_name}</span>
                        {c.position != null && <span style={{ color: "#5a6478" }}> #{c.position}</span>}
                      </span>
                    ))}
                  </div>
                )}
                {w.client_mentioned && (
                  <div style={{ marginTop: 4, fontSize: 11, color: "#ff5d9e" }}>
                    <i className="ti ti-quote" style={{ fontSize: 12, verticalAlign: -1, marginRight: 4 }} aria-hidden="true"></i>
                    {clientBrand} is named in the AIO text but not cited — partial-credit opportunity.
                  </div>
                )}
              </div>

              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 10, color: "#5a6478", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>priority<br/>score</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#b6f53b", lineHeight: 1, fontVariantNumeric: "tabular-nums", marginTop: 2 }}>{w.score}</div>
                <div style={{ fontSize: 10, color: "#8a93a6", marginTop: 2 }}>{w.citation_count} slots open</div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RegionBadge({ c }: { c: string }) {
  const isUS = c.toLowerCase() === "us";
  return (
    <span style={{
      padding: "1px 7px", borderRadius: 4, fontSize: 9.5, fontWeight: 700,
      background: isUS ? "rgba(79,140,255,0.18)" : "rgba(255,184,70,0.18)",
      color: isUS ? "#4f8cff" : "#ffb846",
      letterSpacing: "0.04em",
    }}>{c.toUpperCase()}</span>
  );
}
