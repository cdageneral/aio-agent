"use client";
import { Period, PERIOD_OPTIONS } from "./chartUtils";
import { periodWrap, periodBtn } from "./uiStyles";

export default function PeriodSelector({
  value,
  onChange,
}: {
  value: Period;
  onChange: (p: Period) => void;
}) {
  return (
    <div style={periodWrap}>
      {PERIOD_OPTIONS.map((o, i) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          style={periodBtn(value === o.value, i === 0)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
