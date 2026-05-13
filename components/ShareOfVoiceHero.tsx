"use client";
import { useEffect, useRef } from "react";

/**
 * Share-of-voice hero — large doughnut showing every tracked brand's slice
 * of citation slots plus bucketed "other" (Wikipedia / Reddit / News /
 * Industry / Other). The client always renders in brand blue and is sorted
 * first; competitors cycle through the pink/amber/lime palette; buckets
 * sit in neutral grays so they read as "background noise" by default.
 *
 * Uses Chart.js doughnut via window.Chart (injected by a <script> tag in
 * the host page). Falls back to an SVG legend list if Chart.js isn't ready.
 */

declare global { interface Window { Chart?: any } }

const COMP_PALETTE = ["#ff5d9e", "#ffb846", "#b6f53b", "#a878ff", "#ff7a59", "#7ad7ff"];
const BUCKET_COLORS: Record<string, string> = {
  Wikipedia: "#5a6478",
  Reddit: "#4a5263",
  News: "#3f4654",
  Industry: "#353b46",
  Other: "#2b303a",
};

export interface SovSlice {
  label: string;
  kind: "client" | "competitor" | "bucket";
  slots: number;
  share: number;
}

export default function ShareOfVoiceHero({
  slices,
  totalSlots,
  totalAios,
  clientLabel,
  growth,
  clusterName,
  onClearCluster,
}: {
  slices: SovSlice[];
  totalSlots: number;
  totalAios: number;
  clientLabel: string;
  growth?: { brand_name: string; citation_rate_delta: number }[];
  /** When set, the header and copy switch to cluster-scoped framing. */
  clusterName?: string | null;
  /** Called when the user clicks the cluster chip to return to global view. */
  onClearCluster?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<any>(null);

  // Sort: client first, competitors by share desc, then buckets by share desc.
  const ordered = [
    ...slices.filter((s) => s.kind === "client"),
    ...slices.filter((s) => s.kind === "competitor").sort((a, b) => b.share - a.share),
    ...slices.filter((s) => s.kind === "bucket").sort((a, b) => b.share - a.share),
  ];

  const colors = ordered.map((s, i) => {
    if (s.kind === "client") return "#4f8cff";
    if (s.kind === "competitor") {
      const idx = ordered.filter((x, j) => x.kind === "competitor" && j <= i).length - 1;
      return COMP_PALETTE[idx % COMP_PALETTE.length];
    }
    return BUCKET_COLORS[s.label] ?? "#3f4654";
  });

  useEffect(() => {
    if (!canvasRef.current || typeof window === "undefined" || !window.Chart) return;
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
    chartRef.current = new window.Chart(canvasRef.current, {
      type: "doughnut",
      data: {
        labels: ordered.map((s) => s.label),
        datasets: [{
          data: ordered.map((s) => s.slots),
          backgroundColor: colors,
          borderColor: "#0c0f15",
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "68%",
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#11151d",
            borderColor: "rgba(255,255,255,0.12)",
            borderWidth: 1,
            titleColor: "#f4f6fb",
            bodyColor: "#f4f6fb",
            callbacks: {
              label: (c: any) => `${c.label}: ${c.parsed} slots (${((c.parsed / totalSlots) * 100).toFixed(1)}%)`,
            },
          },
        },
      },
    });
    return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [ordered, colors, totalSlots]);

  const clientSlice = ordered.find((s) => s.kind === "client");
  const ranked = ordered.filter((s) => s.kind !== "bucket").sort((a, b) => b.share - a.share);
  const clientRank = clientSlice ? ranked.findIndex((s) => s === clientSlice) + 1 : 0;
  const leader = ranked[0];

  return (
    <div className="surface" style={{ padding: "1.25rem" }}>
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <div>
          <h2 className="h2" style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            Share of voice
            {clusterName && (
              <span style={{ fontSize: 11, color: "#5a6478", fontWeight: 500 }}>in</span>
            )}
            {clusterName && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13, padding: "2px 9px", borderRadius: 999, background: "rgba(168,120,255,0.12)", color: "#a878ff", border: "1px solid rgba(168,120,255,0.30)", fontWeight: 600 }}>
                <i className="ti ti-filter" style={{ fontSize: 12 }} aria-hidden="true"></i>
                {clusterName}
                {onClearCluster && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onClearCluster(); }}
                    title="Clear cluster filter"
                    style={{ background: "transparent", border: "none", color: "#a878ff", cursor: "pointer", padding: 0, marginLeft: 2, display: "inline-flex" }}
                  >
                    <i className="ti ti-x" style={{ fontSize: 12 }} aria-hidden="true"></i>
                  </button>
                )}
              </span>
            )}
          </h2>
          <p className="text-xs muted mt-0.5">
            {clusterName
              ? <>Citation slots within this cluster · {totalAios.toLocaleString()} AIOs · {totalSlots.toLocaleString()} total slots</>
              : <>Citation slots across {totalAios.toLocaleString()} AIOs · {totalSlots.toLocaleString()} total slots</>}
          </p>
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          {clientSlice && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, background: "rgba(79,140,255,0.16)", color: "#4f8cff", fontSize: 12, fontWeight: 600 }}>
              <i className="ti ti-award" style={{ fontSize: 14 }} aria-hidden="true"></i>
              {clientLabel} ranks #{clientRank}{clusterName ? " in cluster" : ""} · {(clientSlice.share * 100).toFixed(1)}% SOV
            </span>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr", gap: 24, alignItems: "center" }}>
        <div style={{ position: "relative", width: "100%", height: 260 }}>
          <canvas ref={canvasRef} role="img" aria-label={`Doughnut chart of share of voice — ${ordered.map(s => `${s.label} ${(s.share*100).toFixed(0)}%`).join(", ")}`}>
            Share of voice: {ordered.map(s => `${s.label} ${(s.share*100).toFixed(1)}%`).join(", ")}
          </canvas>
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
            <div style={{ fontSize: 11, color: "#8a93a6", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>{clientLabel}</div>
            <div style={{ fontSize: 32, fontWeight: 600, color: "#f4f6fb", letterSpacing: "-0.02em", lineHeight: 1 }}>
              {clientSlice ? (clientSlice.share * 100).toFixed(1) + "%" : "—"}
            </div>
            <div style={{ fontSize: 11, color: "#5a6478", marginTop: 4 }}>of all citations</div>
          </div>
        </div>

        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {ordered.map((s, i) => {
            const g = growth?.find((b) => b.brand_name === s.label);
            const delta = g?.citation_rate_delta;
            return (
              <li key={s.label + i} style={{ display: "grid", gridTemplateColumns: "12px 1fr auto auto", gap: 10, alignItems: "center", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: colors[i] }} />
                <span style={{ fontSize: 13, color: s.kind === "client" ? "#f4f6fb" : s.kind === "bucket" ? "#8a93a6" : "#d6dbe6", fontWeight: s.kind === "client" ? 600 : 500 }}>
                  {s.label}
                  {s.kind === "client" && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: "#4f8cff", padding: "1px 6px", borderRadius: 4, background: "rgba(79,140,255,0.15)", letterSpacing: "0.05em" }}>YOU</span>}
                  {s.kind === "bucket" && <span style={{ marginLeft: 6, fontSize: 10, color: "#5a6478" }}>non-brand</span>}
                </span>
                <span style={{ fontSize: 13, color: "#f4f6fb", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{(s.share * 100).toFixed(1)}%</span>
                <span style={{ fontSize: 11, color: "#5a6478", fontVariantNumeric: "tabular-nums", minWidth: 50, textAlign: "right" }}>{s.slots} slots</span>
              </li>
            );
          })}
        </ul>
      </div>

      {leader && clientSlice && leader.kind !== "client" && (
        <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 10, background: "rgba(255,93,158,0.08)", border: "1px solid rgba(255,93,158,0.20)", fontSize: 12.5, color: "#d6dbe6" }}>
          <strong style={{ color: "#ff5d9e" }}>{leader.label}</strong> is ahead of you by{" "}
          <strong style={{ color: "#f4f6fb" }}>{((leader.share - clientSlice.share) * 100).toFixed(1)} pts</strong>{" "}
          ({leader.slots - clientSlice.slots} more citation slots).
        </div>
      )}
    </div>
  );
}
