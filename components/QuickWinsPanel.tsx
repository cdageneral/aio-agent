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
}: {
  projectId: string;
  region: RegionMode;
  clientBrand: string;
  /** Controlled cluster filter — Dashboard owns this so clicking a cluster card pushes through here. */
  clusterFilter: string;
  onClusterFilterChange: (v: string) => void;
}) {
  const [wins, setWins] = useState<QuickWin[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    // Pull a bigger window so client-side cluster filtering has enough rows
    // to slice. Display still caps at the top N after filtering.
    const params = new URLSearchParams({ region: regionsForMode(region).join(","), limit: "60" });
    const res = await fetch(`/api/projects/${projectId}/quick-wins?${params.toString()}`, { cache: "no-store" });
    const j = await res.json();
    setWins(j.opportunities ?? []);
    setTotal(j.total_opportunities ?? 0);
    setLoading(false);
  }, [projectId, region]);

  useEffect(() => { load(); }, [load]);

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

  if (loading) return <div className="text-sm muted">Scoring opportunities…</div>;
  if (!wins || wins.length === 0) {
    return (
      <div className="text-sm muted" style={{ padding: 18 }}>
        No gettable opportunities right now — either every AIO is already won, or no AIOs are triggered yet.
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
            <span style={{ width: 8, height: 8, background: "#b6f53b", borderRadius: 2 }} />score
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
                <div style={{ fontSize: 10, color: "#5a6478", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>score</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#b6f53b", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{w.score}</div>
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
