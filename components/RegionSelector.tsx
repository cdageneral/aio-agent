"use client";
import { segToggleWrap, segToggleBtn } from "./uiStyles";

export type RegionMode = "us" | "ca" | "both";

const OPTIONS: { value: RegionMode; label: string }[] = [
  { value: "us", label: "USA" },
  { value: "ca", label: "Canada" },
  { value: "both", label: "Both" },
];

export default function RegionSelector({
  value,
  onChange,
}: {
  value: RegionMode;
  onChange: (v: RegionMode) => void;
}) {
  return (
    <div style={segToggleWrap} role="tablist" aria-label="Region">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          style={segToggleBtn(value === o.value)}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function regionsForMode(m: RegionMode): string[] {
  if (m === "us") return ["us"];
  if (m === "ca") return ["ca"];
  return ["us", "ca"];
}
