"use client";
import { ReactNode, useEffect, useRef, useState } from "react";

/**
 * Section-level (i) info tooltip.
 *
 * Mirrors the per-card tooltip pattern used inside StoryPanel.tsx so the
 * dashboard has one consistent "what is this?" affordance:
 *  - Click the round-bordered (i) to toggle a popover.
 *  - Outside-click or Escape closes it.
 *  - The popover is anchored to the icon and respects the section's accent.
 *
 * Pass `body` as either plain text or rich children for headings + lists.
 */
export default function InfoTooltip({
  label,
  body,
  accent = "#a878ff",
}: {
  /** Short, uppercase label shown at the top of the popover. Usually matches the section title. */
  label: string;
  /** Body of the popover — plain string or JSX. */
  body: ReactNode;
  /** Hex color used for the icon border + popover accent. Defaults to lilac. */
  accent?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={wrapRef} style={{ position: "relative", display: "inline-flex", alignItems: "center", marginLeft: 6 }}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        aria-label={`About ${label}`}
        title={`About ${label}`}
        style={{
          width: 19,
          height: 19,
          borderRadius: "50%",
          background: open ? accent : "transparent",
          color: open ? "#06070b" : accent,
          border: `1px solid ${accent}66`,
          cursor: "pointer",
          fontSize: 12,
          lineHeight: 1,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          opacity: 0.85,
          transition: "background 120ms ease, color 120ms ease, opacity 120ms ease",
          fontFamily: "Georgia, serif",
          fontStyle: "italic",
          fontWeight: 600,
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.85"; }}
      >
        i
      </button>
      {open && (
        <div
          role="tooltip"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            top: 28,
            left: -8,
            width: 340,
            zIndex: 50,
            padding: "12px 14px",
            borderRadius: 10,
            background: "#11151d",
            border: `1px solid ${accent}55`,
            boxShadow: "0 8px 20px rgba(0,0,0,0.50)",
            fontSize: 12.5,
            lineHeight: 1.55,
            color: "#d6dbe6",
            fontWeight: 400,
            textAlign: "left",
            textTransform: "none",
            letterSpacing: "normal",
          }}
        >
          <div style={{ fontSize: 10, color: accent, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
          {body}
        </div>
      )}
    </span>
  );
}
