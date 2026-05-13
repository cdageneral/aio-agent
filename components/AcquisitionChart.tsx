"use client";
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";
import { Period, filterByPeriod, fmtDate } from "./chartUtils";

const PALETTE = ["#ff5d9e", "#ffb846", "#b6f53b", "#25e0ce", "#a878ff", "#ff7a59", "#ffd84d", "#7ad7ff"];

/**
 * Acquisition-rate trend per tracked brand. Y-axis is citation rate (% of
 * triggered AIOs the brand was cited in). Client is highlighted in brand blue
 * with a heavier stroke; competitors cycle through the palette.
 */
export default function AcquisitionChart({
  series,
  period,
  project,
}: {
  series: any[];
  period: Period;
  project: any;
}) {
  const filtered = filterByPeriod(series, period);

  if (!filtered || filtered.length === 0) {
    return <div className="text-sm text-gray-500">No snapshots in this range.</div>;
  }

  const brands = Array.from(new Set(filtered.flatMap((s) => s.brand_aios.map((b: any) => b.brand_name))));
  const data = filtered.map((s) => {
    const row: Record<string, any> = { ran_at: fmtDate(s.ran_at) };
    for (const b of s.brand_aios) {
      row[b.brand_name] = Number((b.citation_rate * 100).toFixed(1));
    }
    return row;
  });

  return (
    <div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs mb-3">
        {brands.map((b, i) => (
          <span key={b} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm"
              style={{ background: b === project.brand_name ? "#4f8cff" : PALETTE[i % PALETTE.length] }}
            />
            <span className={b === project.brand_name ? "font-semibold" : "muted"} style={{ color: b === project.brand_name ? "var(--text)" : undefined }}>
              {b}
            </span>
          </span>
        ))}
      </div>
      <div className="w-full h-60">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="ran_at" tick={{ fontSize: 11, fill: "#8a93a6" }} axisLine={{ stroke: "rgba(255,255,255,0.08)" }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "#8a93a6" }} tickFormatter={(v) => `${v}%`} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: "#11151d", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, color: "#f4f6fb", fontSize: 12 }} formatter={(v: any) => `${v}%`} cursor={{ stroke: "rgba(255,255,255,0.08)" }} />
            {brands.map((b, i) => (
              <Line
                key={b}
                type="monotone"
                dataKey={b}
                stroke={b === project.brand_name ? "#4f8cff" : PALETTE[i % PALETTE.length]}
                strokeWidth={b === project.brand_name ? 2.75 : 1.75}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
