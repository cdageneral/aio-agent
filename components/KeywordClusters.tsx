"use client";

/**
 * Topic-cluster card grid. One card per cluster, ranked by AIO count (the
 * fattest battleground first). Each card surfaces:
 *
 *  - Cluster name + keyword count
 *  - AIO penetration % within the cluster (cyan bar fill on the right edge)
 *  - Client's citation rate as the headline number
 *  - The top tracked-brand winner in this topic (could be the client)
 *  - A stacked SOV bar across all tracked brands so the user can eyeball
 *    who's eating the most citation slots inside this cluster
 *
 * Visual logic: when the client is the top winner, the card edge glows lime;
 * when a competitor leads, it glows pink. Neutral when nobody's cited yet.
 */

const PALETTE = ["#ff5d9e", "#ffb846", "#b6f53b", "#a878ff", "#ff7a59", "#7ad7ff"];

export interface ClusterMetrics {
  name: string;
  keyword_count: number;
  aio_count: number;
  aio_penetration: number;
  total_citation_slots: number;
  client_aios_acquired: number;
  client_citation_rate: number;
  top_winner: { brand_name: string; kind: "client" | "competitor"; aios_acquired: number; citation_rate: number } | null;
  brand_shares: { brand_name: string; kind: "client" | "competitor"; slots: number; share: number }[];
}

export default function KeywordClusters({
  clusters,
  clientBrand,
  activeCluster,
  onClusterSelect,
}: {
  clusters: ClusterMetrics[];
  clientBrand: string;
  /** Currently selected cluster filter, or "all". Owned by Dashboard. */
  activeCluster?: string;
  /** Called when a cluster card is clicked. Toggles selection. */
  onClusterSelect?: (name: string) => void;
}) {
  if (!clusters || clusters.length === 0) {
    return (
      <div className="text-sm muted" style={{ padding: 14 }}>
        Topics haven't been clustered yet. Click <strong style={{ color: "#f4f6fb" }}>Cluster keywords</strong> in the Keyword universe panel to group everything into 5-8 topical buckets.
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
      {clusters.map((c) => (
        <ClusterCard
          key={c.name}
          cluster={c}
          clientBrand={clientBrand}
          active={activeCluster === c.name}
          onClick={onClusterSelect ? () => onClusterSelect(c.name) : undefined}
        />
      ))}
    </div>
  );
}

function ClusterCard({
  cluster, clientBrand, active, onClick,
}: {
  cluster: ClusterMetrics; clientBrand: string; active?: boolean; onClick?: () => void;
}) {
  const isClientLeading = cluster.top_winner?.kind === "client";
  const isContestedLoss = cluster.top_winner && cluster.top_winner.kind === "competitor";
  const accent = isClientLeading ? "#b6f53b" : isContestedLoss ? "#ff5d9e" : "rgba(255,255,255,0.15)";
  const clickable = !!onClick;

  return (
    <div
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      style={{
        position: "relative",
        background: active ? "rgba(168,120,255,0.06)" : "#0c0f15",
        border: active ? "1px solid rgba(168,120,255,0.50)" : "1px solid rgba(255,255,255,0.07)",
        borderRadius: 12,
        padding: "13px 14px 12px",
        overflow: "hidden",
        cursor: clickable ? "pointer" : "default",
        transition: "background-color 120ms ease, border-color 120ms ease, transform 80ms ease",
      }}
      onMouseDown={clickable ? (e) => { (e.currentTarget as HTMLDivElement).style.transform = "scale(0.99)"; } : undefined}
      onMouseUp={clickable ? (e) => { (e.currentTarget as HTMLDivElement).style.transform = "scale(1)"; } : undefined}
      onMouseLeave={clickable ? (e) => { (e.currentTarget as HTMLDivElement).style.transform = "scale(1)"; } : undefined}
    >
      <div style={{ position: "absolute", inset: 0, width: 3, background: accent }} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "#f4f6fb", letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cluster.name}</div>
          <div style={{ fontSize: 10.5, color: "#8a93a6", marginTop: 1 }}>
            {cluster.keyword_count} kw · {cluster.aio_count} AIO{cluster.aio_count === 1 ? "" : "s"} · {(cluster.aio_penetration * 100).toFixed(0)}% penetration
          </div>
        </div>
        {active ? (
          <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 999, background: "rgba(168,120,255,0.20)", color: "#a878ff", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", display: "inline-flex", alignItems: "center", gap: 3 }}>
            <i className="ti ti-filter" style={{ fontSize: 11 }} aria-hidden="true"></i>Filtering
          </span>
        ) : isClientLeading ? (
          <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 999, background: "rgba(182,245,59,0.16)", color: "#b6f53b", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>
            Leading
          </span>
        ) : isContestedLoss ? (
          <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 999, background: "rgba(255,93,158,0.14)", color: "#ff5d9e", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>
            Trailing
          </span>
        ) : null}
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6 }}>
        <div style={{ fontSize: 26, fontWeight: 600, color: "#f4f6fb", letterSpacing: "-0.015em", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
          {(cluster.client_citation_rate * 100).toFixed(0)}%
        </div>
        <div style={{ fontSize: 10.5, color: "#8a93a6" }}>
          {clientBrand} citation rate · {cluster.client_aios_acquired} of {cluster.aio_count}
        </div>
      </div>

      {cluster.top_winner && (
        <div style={{ fontSize: 11, color: "#d6dbe6", marginTop: 6 }}>
          <span style={{ color: "#8a93a6" }}>Leader: </span>
          <strong style={{ color: cluster.top_winner.kind === "client" ? "#b6f53b" : "#f4f6fb" }}>{cluster.top_winner.brand_name}</strong>
          <span style={{ color: "#5a6478" }}> ({(cluster.top_winner.citation_rate * 100).toFixed(0)}%)</span>
        </div>
      )}

      {/* Discoverability hint — only shows when the card is interactive but unselected. */}
      {clickable && !active && (
        <div style={{ fontSize: 10, color: "#5a6478", marginTop: 6, display: "inline-flex", alignItems: "center", gap: 3 }}>
          <i className="ti ti-cursor-arrow" style={{ fontSize: 11 }} aria-hidden="true"></i>
          Click to filter Quick Wins &amp; Drilldown
        </div>
      )}
      {active && (
        <div style={{ fontSize: 10, color: "#a878ff", marginTop: 6, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 3 }}>
          <i className="ti ti-check" style={{ fontSize: 11 }} aria-hidden="true"></i>
          Filtering downstream — click again to clear
        </div>
      )}

      {/* Stacked SOV bar — citation slots within this cluster only. */}
      {cluster.total_citation_slots > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", height: 6, borderRadius: 4, overflow: "hidden", background: "rgba(255,255,255,0.04)" }}>
            {cluster.brand_shares
              .filter((b) => b.share > 0)
              .map((b, i) => (
                <div
                  key={b.brand_name}
                  style={{
                    width: `${b.share * 100}%`,
                    background: b.kind === "client" ? "#4f8cff" : PALETTE[i % PALETTE.length],
                  }}
                  title={`${b.brand_name}: ${b.slots} slot${b.slots === 1 ? "" : "s"} (${(b.share * 100).toFixed(1)}%)`}
                />
              ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 5, fontSize: 10 }}>
            {cluster.brand_shares
              .filter((b) => b.share > 0)
              .slice(0, 4)
              .map((b, i) => (
                <span key={b.brand_name} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 1.5, background: b.kind === "client" ? "#4f8cff" : PALETTE[i % PALETTE.length] }} />
                  <span style={{ color: b.kind === "client" ? "#f4f6fb" : "#8a93a6", fontWeight: b.kind === "client" ? 600 : 500 }}>
                    {b.brand_name}
                  </span>
                  <span style={{ color: "#5a6478" }}>{(b.share * 100).toFixed(0)}%</span>
                </span>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
