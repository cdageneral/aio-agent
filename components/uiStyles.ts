/**
 * Inline-style objects for the critical interactive surfaces. Using inline
 * styles (instead of CSS classes) defeats every cascade / preflight issue we
 * hit with Tailwind's @tailwind base layer clobbering custom class backgrounds.
 *
 * All colors are hard-coded here intentionally — no CSS variables — so the
 * components render correctly even if globals.css fails to load.
 */
import type { CSSProperties } from "react";

const baseBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "9px 14px",
  borderRadius: 10,
  fontSize: 14,
  fontWeight: 500,
  lineHeight: 1,
  cursor: "pointer",
  border: "1px solid transparent",
  transition: "background-color 120ms ease, border-color 120ms ease",
};

export function primaryBtnStyle(disabled = false): CSSProperties {
  return disabled
    ? { ...baseBtn, background: "rgba(182,245,59,0.18)", color: "rgba(6,7,11,0.55)", fontWeight: 600, cursor: "not-allowed" }
    : { ...baseBtn, background: "#b6f53b", color: "#06070b", fontWeight: 600 };
}

export function accentBtnStyle(disabled = false): CSSProperties {
  return disabled
    ? { ...baseBtn, background: "rgba(79,140,255,0.30)", color: "rgba(6,7,11,0.6)", fontWeight: 600, cursor: "not-allowed" }
    : { ...baseBtn, background: "#4f8cff", color: "#06070b", fontWeight: 600 };
}

export function ghostBtnStyle(disabled = false): CSSProperties {
  return disabled
    ? { ...baseBtn, background: "transparent", color: "rgba(244,246,251,0.45)", borderColor: "rgba(255,255,255,0.10)", cursor: "not-allowed" }
    : { ...baseBtn, background: "transparent", color: "#f4f6fb", borderColor: "rgba(255,255,255,0.18)" };
}

export const segToggleWrap: CSSProperties = {
  display: "inline-flex",
  padding: 3,
  borderRadius: 10,
  background: "#11151d",
  border: "1px solid rgba(255,255,255,0.07)",
};

export function segToggleBtn(active: boolean): CSSProperties {
  return active
    ? {
        padding: "7px 16px",
        borderRadius: 7,
        fontSize: 13,
        fontWeight: 600,
        color: "#06070b",
        background: "#4f8cff",
        border: "none",
        cursor: "pointer",
        transition: "background-color 120ms ease, color 120ms ease",
      }
    : {
        padding: "7px 16px",
        borderRadius: 7,
        fontSize: 13,
        fontWeight: 500,
        color: "#d6dbe6",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        transition: "background-color 120ms ease, color 120ms ease",
      };
}

export const periodWrap: CSSProperties = {
  display: "inline-flex",
  borderRadius: 10,
  background: "#11151d",
  border: "1px solid rgba(255,255,255,0.07)",
  overflow: "hidden",
};

export function periodBtn(active: boolean, isFirst: boolean): CSSProperties {
  return {
    padding: "7px 13px",
    fontSize: 12,
    fontWeight: active ? 600 : 500,
    color: active ? "#4f8cff" : "#d6dbe6",
    background: active ? "rgba(79,140,255,0.20)" : "transparent",
    border: "none",
    borderLeft: isFirst ? "none" : "1px solid rgba(255,255,255,0.07)",
    cursor: "pointer",
  };
}
