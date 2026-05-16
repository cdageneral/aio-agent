"use client";
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";
import { DateRange, filterByDateRange, fmtDate } from "./chartUtils";

/**
 * Volume-only AIO trend chart. Plots:
 *   - total AIOs triggered across the full keyword universe (market)
 *   - total AIOs triggered across the client's organic footprint
 *
 * Brand acquisition lives in AcquisitionChart. The shared `range` prop drives
 * both charts so the date-range picker stays in sync.
 *
 * v1.1.23: dropped MoM/YoY delta badges (user request). Added visible dots
 * on each data point so even sparse series (1-2 snapshots) render as clearly
 * plotted markers, not just a faint line.
 */
export default function GrowthChart({ series, range }: { series: any[]; range: DateRange }) {
  const filtered = filterByDateRange(series, range);

  if (!filtered || filtered.length === 0) {
    return (
      <div className="text-sm" style={{ color: "#8a93a6", padding: "20px 0", textAlign: "center" }}>
        No snapshots in this range. Try a wider window or click <strong style={{ color: "#f4f6fb" }}>All time</strong>.
      </div>
    );
  }

  const data = filtered.map((s) => ({
    ran_at: fmtDate(s.ran_at),
    market: s.total_aios_triggered ?? 0,
    footprint: s.total_aios_triggered_organic ?? 0,
  }));

  // Surface the latest value as a small number so users see SOMETHING numeric
  // even when the line is short. Helpful for projects with 1-2 snapshots.
  const latest = data[data.length - 1];

  return (
    <div>
      <div className="flex items-center gap-3 mb-3 text-xs flex-wrap">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: "#25e0ce" }} />
          <span style={{ color: "#cbd5e1" }}>Market</span>
          <span style={{ color: "#f4f6fb", fontWeight: 600 }}>{Number(latest.market).toLocaleString()}</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: "#ffb846" }} />
          <span style={{ color: "#cbd5e1" }}>Footprint</span>
          <span style={{ color: "#f4f6fb", fontWeight: 600 }}>{Number(latest.footprint).toLocaleString()}</span>
        </span>
        <span style={{ color: "#5a6478", marginLeft: "auto" }}>{filtered.length} snapshot{filtered.length === 1 ? "" : "s"} plotted</span>
      </div>
      <div className="w-full h-60">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="ran_at" tick={{ fontSize: 11, fill: "#8a93a6" }} axisLine={{ stroke: "rgba(255,255,255,0.08)" }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "#8a93a6" }} allowDecimals={false} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: "#11151d", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, color: "#f4f6fb", fontSize: 12 }} cursor={{ stroke: "rgba(255,255,255,0.08)" }} />
            <Line type="monotone" dataKey="market" name="Market" stroke="#25e0ce" strokeWidth={2.5} dot={{ r: 4, strokeWidth: 0, fill: "#25e0ce" }} activeDot={{ r: 6 }} />
            <Line type="monotone" dataKey="footprint" name="Footprint" stroke="#ffb846" strokeWidth={1.75} strokeDasharray="5 4" dot={{ r: 3.5, strokeWidth: 0, fill: "#ffb846" }} activeDot={{ r: 5.5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
