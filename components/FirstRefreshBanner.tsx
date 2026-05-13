"use client";
import { RegionMode, regionsForMode } from "./RegionSelector";

/**
 * "Run your first refresh" CTA. Renders only when:
 *  - the keyword universe has at least one keyword AND
 *  - the project has zero completed snapshots
 *
 * Shows the user exactly what's about to happen — query count, cost estimate,
 * and time estimate — so they consent before burning SerpAPI quota. Once a
 * snapshot exists, the banner self-dismisses and the regular Run refresh
 * button in the header is enough.
 */

// SerpAPI's developer plan is ~$0.005 per SERP. Cheaper plans exist but this
// is the safe upper bound to quote to the user.
const COST_PER_QUERY_USD = 0.005;
// 4-concurrency pool inside the refresh route, ~1.5s per query on average.
const SECONDS_PER_QUERY = 1.5 / 4;

export default function FirstRefreshBanner({
  keywordsCount,
  region,
  refreshing,
  hasSnapshots,
  onRefresh,
}: {
  keywordsCount: number;
  region: RegionMode;
  refreshing: boolean;
  hasSnapshots: boolean;
  onRefresh: () => void;
}) {
  if (hasSnapshots) return null;
  if (keywordsCount <= 0) return null;

  const regionCount = regionsForMode(region).length;
  const queries = keywordsCount * regionCount;
  const cost = queries * COST_PER_QUERY_USD;
  const seconds = Math.max(15, Math.ceil(queries * SECONDS_PER_QUERY));

  return (
    <div
      style={{
        position: "relative",
        padding: "18px 20px",
        borderRadius: 14,
        background: "linear-gradient(135deg, rgba(182,245,59,0.10), rgba(37,224,206,0.08))",
        border: "1px solid rgba(182,245,59,0.30)",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 20, alignItems: "center" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 11, color: "#b6f53b", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>
            <i className="ti ti-sparkles" style={{ fontSize: 13 }} aria-hidden="true"></i>
            Ready for your first refresh
          </div>
          <h3 style={{ fontSize: 20, fontWeight: 600, color: "#f4f6fb", letterSpacing: "-0.015em", margin: 0 }}>
            Pull AI Overviews for {keywordsCount.toLocaleString()} keyword{keywordsCount === 1 ? "" : "s"}
            {regionCount > 1 && <> across {regionCount} regions</>}
          </h3>
          <p style={{ fontSize: 13, color: "#d6dbe6", margin: "6px 0 0", lineHeight: 1.55 }}>
            We'll fire one SerpAPI query per keyword × region, parse the AIO from each SERP, and store everything as your first snapshot. Once it lands, the dashboard fills in — KPIs, share-of-voice, quick wins, the works.
          </p>

          <div style={{ display: "flex", gap: 18, marginTop: 12, flexWrap: "wrap", fontSize: 12 }}>
            <Spec label="Queries" value={queries.toLocaleString()} sub={`${keywordsCount} × ${regionCount} region${regionCount === 1 ? "" : "s"}`} />
            <Spec label="Est. cost" value={`~$${cost.toFixed(2)}`} sub="SerpAPI" />
            <Spec label="Est. time" value={fmtDuration(seconds)} sub="4-way parallel" />
            <Spec label="Snapshots so far" value="0" sub="this is #1" />
          </div>
        </div>

        <button
          onClick={onRefresh}
          disabled={refreshing}
          style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "12px 22px", borderRadius: 11,
            background: refreshing ? "rgba(182,245,59,0.20)" : "#b6f53b",
            color: "#06070b", fontSize: 14, fontWeight: 700,
            border: "none", cursor: refreshing ? "wait" : "pointer",
            whiteSpace: "nowrap",
            boxShadow: refreshing ? "none" : "0 0 0 1px rgba(182,245,59,0.40)",
          }}
        >
          <i className={`ti ${refreshing ? "ti-loader-2" : "ti-player-play"}`} style={{ fontSize: 16 }} aria-hidden="true"></i>
          {refreshing ? "Running…" : "Run your first refresh"}
        </button>
      </div>
    </div>
  );
}

function Spec({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <div style={{ fontSize: 9.5, color: "#8a93a6", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: "#f4f6fb", marginTop: 1, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ fontSize: 10.5, color: "#5a6478", marginTop: 2 }}>{sub}</div>
    </div>
  );
}

function fmtDuration(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m} min` : `${m}m ${r}s`;
}
