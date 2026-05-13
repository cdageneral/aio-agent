"use client";
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";
import { Period, filterByPeriod, periodGrowth, fmtPctSigned, fmtDate } from "./chartUtils";

/**
 * Volume-only AIO trend chart. Plots:
 *   - total AIOs triggered across the full keyword universe (market)
 *   - total AIOs triggered across the client's organic footprint
 *
 * Brand acquisition lives in AcquisitionChart. The shared `period` prop
 * drives both charts so the timeline picker stays in sync.
 */
export default function GrowthChart({ series, period }: { series: any[]; period: Period }) {
  const filtered = filterByPeriod(series, period);

  if (!filtered || filtered.length === 0) {
    return <div className="text-sm text-gray-500">No snapshots in this range.</div>;
  }

  const data = filtered.map((s) => ({
    ran_at: fmtDate(s.ran_at),
    market: s.total_aios_triggered,
    footprint: s.total_aios_triggered_organic,
  }));

  // MoM / YoY computed over the full series (not the filtered slice) so deltas
  // stay meaningful even if the user is zoomed into a tight window.
  const mom = periodGrowth(series, 30, "total_aios_triggered");
  const yoy = periodGrowth(series, 365, "total_aios_triggered");

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
        <DeltaBadge label="MoM" value={mom} />
        <DeltaBadge label="YoY" value={yoy} />
        <span className="dim">market AIO triggering volume</span>
      </div>
      <div className="w-full h-60">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="ran_at" tick={{ fontSize: 11, fill: "#8a93a6" }} axisLine={{ stroke: "rgba(255,255,255,0.08)" }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "#8a93a6" }} allowDecimals={false} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: "#11151d", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, color: "#f4f6fb", fontSize: 12 }} cursor={{ stroke: "rgba(255,255,255,0.08)" }} />
            <Line type="monotone" dataKey="market" name="Market" stroke="#25e0ce" strokeWidth={2.5} dot={false} />
            <Line type="monotone" dataKey="footprint" name="Footprint" stroke="#ffb846" strokeWidth={1.75} strokeDasharray="5 4" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function DeltaBadge({ label, value }: { label: string; value: number | null }) {
  let bg = "rgba(255,255,255,0.05)", color = "#8a93a6";
  if (value != null && value > 0) { bg = "var(--accent-lime-soft)"; color = "var(--accent-lime)"; }
  else if (value != null && value < 0) { bg = "var(--accent-red-soft)"; color = "var(--accent-red)"; }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-semibold" style={{ background: bg, color, fontSize: 11 }}>
      <span style={{ opacity: 0.65 }}>{label}</span>
      <span>{fmtPctSigned(value)}</span>
    </span>
  );
}
