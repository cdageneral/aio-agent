"use client";
import { DateRange, Period, PERIOD_OPTIONS, presetToRange } from "./chartUtils";

/**
 * Date-range picker for the AIO Trends + Acquisition Rate charts.
 *
 * v1.1.16 redesign: explicit, prominent styling for the date inputs so they
 * stand out clearly against the dark canvas. v1.1.14's inline-style approach
 * left them invisible-looking in dark mode — users would see only the preset
 * chips and not realize the From/To fields existed. Now the inputs have
 * obvious borders, calendar icons, and a "Custom range" label.
 *
 * (File still named PeriodSelector so existing imports work; behavior is
 * date-range based since v1.1.14.)
 */
export default function PeriodSelector({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (r: DateRange) => void;
}) {
  const inputStyle: React.CSSProperties = {
    background: "#0c0f15",
    border: "1px solid rgba(79,140,255,0.30)",
    borderRadius: 7,
    color: "#f4f6fb",
    padding: "6px 10px",
    fontSize: 12,
    fontFamily: "inherit",
    colorScheme: "dark",
    minWidth: 130,
    fontWeight: 500,
    cursor: "pointer",
  };
  const presetStyle = (active: boolean): React.CSSProperties => ({
    fontSize: 11,
    padding: "5px 10px",
    borderRadius: 999,
    background: active ? "rgba(79,140,255,0.16)" : "transparent",
    border: active ? "1px solid rgba(79,140,255,0.40)" : "1px solid rgba(255,255,255,0.10)",
    color: active ? "#4f8cff" : "#8a93a6",
    cursor: "pointer",
    whiteSpace: "nowrap",
    fontWeight: active ? 600 : 400,
  });
  const isPreset = (p: Period): boolean => {
    const expected = presetToRange(p);
    return expected.from === value.from && expected.to === value.to;
  };
  const isAllTime = !value.from && !value.to;
  const isCustom = !isAllTime && !PERIOD_OPTIONS.some((o) => isPreset(o.value));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
      {/* Date inputs row */}
      <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>
          Custom range{isCustom && <span style={{ color: "#4f8cff", marginLeft: 6 }}>· active</span>}
        </span>
        <DateField label="From" value={value.from} onChange={(v) => onChange({ ...value, from: v })} inputStyle={inputStyle} />
        <span style={{ color: "#5a6478", fontSize: 14 }}>→</span>
        <DateField label="To" value={value.to} onChange={(v) => onChange({ ...value, to: v })} inputStyle={inputStyle} />
      </div>

      {/* Quick preset chips row */}
      <div style={{ display: "inline-flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", marginRight: 4 }}>
          Quick
        </span>
        {PERIOD_OPTIONS.map((o) => {
          const active = o.value === "all" ? isAllTime : isPreset(o.value);
          return (
            <button
              key={o.value}
              onClick={() => onChange(presetToRange(o.value))}
              style={presetStyle(active)}
              title={`Set range to ${o.label.toLowerCase()}`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DateField({
  label, value, onChange, inputStyle,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  inputStyle: React.CSSProperties;
}) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
      <span style={{ fontSize: 10, color: "#8a93a6", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>{label}</span>
      <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
        {/* Inline SVG calendar icon — sits inside the input pill so the user
            sees a clickable calendar affordance even before clicking. */}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#4f8cff"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ position: "absolute", left: 10, pointerEvents: "none" }}
        >
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        <input
          type="date"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          style={{ ...inputStyle, paddingLeft: 30 }}
        />
      </span>
    </label>
  );
}
