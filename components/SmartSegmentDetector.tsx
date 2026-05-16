"use client";
import { useState } from "react";
import { accentBtnStyle, ghostBtnStyle } from "./uiStyles";

/**
 * SmartSegmentDetector — fetches the client URL, runs it through the
 * detection endpoint, and surfaces a free-text segment + seed keywords
 * + suggested competitors + region hint as a one-click apply.
 *
 * The fast-track taxonomy was removed; this is the only segment input now.
 * `value` represents whatever's currently saved on the project; users
 * can detect, edit free-text, or skip entirely.
 */

export interface SuggestedCompetitor {
  name: string;
  domain: string;
  verified?: boolean;
}

export interface SegmentValue {
  l1: string | null;            // industry
  l2: string | null;            // category
  l3: string | null;            // subcategory
  primary_product?: string | null;
  seed_keywords?: string[];
  competitors?: SuggestedCompetitor[];
  confidence?: "high" | "medium" | "low" | null;
}

interface Suggestion {
  industry: string;
  category: string;
  subcategory: string;
  primary_product: string;
  region_hint: "us" | "ca" | "both" | "unknown";
  confidence: "high" | "medium" | "low";
  seed_keywords: string[];
  competitors: SuggestedCompetitor[];
}

export default function SmartSegmentDetector({
  clientUrl,
  value,
  onChange,
  onRegionHint,
  onCompetitorsSuggested,
  onSeedKeywordsApplied,
  onAutoSave,
}: {
  clientUrl: string;
  value: SegmentValue;
  onChange: (v: SegmentValue) => void;
  onRegionHint?: (r: "us" | "ca" | "both") => void;
  onCompetitorsSuggested?: (competitors: SuggestedCompetitor[]) => void;
  /** Called with the suggested seed keywords when user accepts. Dashboard
   *  uses this to POST them into the keyword universe immediately. */
  onSeedKeywordsApplied?: (seeds: string[]) => Promise<void> | void;
  /** v1.1.13: called with the detected segment so the parent can persist it
   *  to the database. Without this, a fresh detect would update UI state but
   *  the user had to manually click "Save changes" to make it stick — easy
   *  to miss. */
  onAutoSave?: (seg: SegmentValue) => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [excerpt, setExcerpt] = useState<{ title: string; description: string; h1: string } | null>(null);
  const [editing, setEditing] = useState(false);

  // Free-text edit buffer mirrors `value` until Save. We re-seed these from
  // the latest `value` whenever the user clicks the top-level Edit button so
  // that opening the edit panel after a successful Use-these (or after a fresh
  // page load) doesn't show empty fields and accidentally wipe them on Save.
  const [editL1, setEditL1] = useState(value.l1 ?? "");
  const [editL2, setEditL2] = useState(value.l2 ?? "");
  const [editL3, setEditL3] = useState(value.l3 ?? "");
  const [editProduct, setEditProduct] = useState(value.primary_product ?? "");
  const [editSeeds, setEditSeeds] = useState((value.seed_keywords ?? []).join(", "));

  /** Pre-fill the edit form from the currently-saved value. Called by the
   *  top-level Edit button so the user isn't editing a phantom blank form. */
  function openEditFromValue() {
    setEditL1(value.l1 ?? "");
    setEditL2(value.l2 ?? "");
    setEditL3(value.l3 ?? "");
    setEditProduct(value.primary_product ?? "");
    setEditSeeds((value.seed_keywords ?? []).join(", "));
    setEditing(true);
  }

  async function detect() {
    if (!clientUrl) {
      setErr("Enter the client website first.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/detect-segment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: clientUrl }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error ?? "Detection failed");
      const result: Suggestion = j.result;
      setExcerpt(j.excerpt);

      // v1.1.13: auto-apply everything immediately. No more "Suggested segment"
      // review card — the detected segment lands in the Current segment area
      // and gets persisted to the database in one shot. Users were missing the
      // "Use these" + "Save changes" two-step and ending up with empty state.

      const nextSeg: SegmentValue = {
        l1: result.industry || null,
        l2: result.category || null,
        l3: result.subcategory || null,
        primary_product: result.primary_product || null,
        seed_keywords: result.seed_keywords,
        competitors: result.competitors,
        confidence: result.confidence,
      };
      onChange(nextSeg);

      // Region hint flows out so the parent can flip the region toggle.
      if (result.region_hint && result.region_hint !== "unknown") {
        onRegionHint?.(result.region_hint);
      }

      // Competitor suggestions flow to the CompetitorPanel strip (existing path).
      if (result.competitors?.length) {
        onCompetitorsSuggested?.(result.competitors);
      }

      // Seed keywords flow into the keyword universe (existing v1.1.5 path).
      if (result.seed_keywords?.length && onSeedKeywordsApplied) {
        try { await onSeedKeywordsApplied(result.seed_keywords); } catch {}
      }

      // Persist segment fields to the database so the detection survives
      // page reloads without the user clicking Save changes.
      if (onAutoSave) {
        try { await onAutoSave(nextSeg); } catch {}
      }

      // Build a short confirmation summary for the inline note (replaces the
      // old "Suggested segment" review card).
      setLastDetection({
        when: Date.now(),
        seedCount: result.seed_keywords?.length ?? 0,
        compCount: result.competitors?.length ?? 0,
        regionHint: result.region_hint,
      });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  // v1.1.13: small in-memory marker for the inline "just detected" hint.
  const [lastDetection, setLastDetection] = useState<{ when: number; seedCount: number; compCount: number; regionHint: string } | null>(null);

  function saveEdit() {
    onChange({
      l1: editL1 || null,
      l2: editL2 || null,
      l3: editL3 || null,
      primary_product: editProduct || null,
      seed_keywords: editSeeds.split(",").map((s) => s.trim()).filter(Boolean),
      competitors: value.competitors,
      confidence: value.confidence,
    });
    setEditing(false);
  }

  const hasSegment = !!(value.l1 || value.l2 || value.l3);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header row: current state + Detect button */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {hasSegment ? (
            <div>
              <div style={{ fontSize: 10, color: "#8a93a6", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 4 }}>
                Current segment
                {value.confidence && (
                  <ConfidenceChip level={value.confidence} />
                )}
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#f4f6fb", letterSpacing: "-0.01em" }}>
                {[value.l1, value.l2, value.l3].filter(Boolean).join(" › ")}
              </div>
              {value.primary_product && (
                <div style={{ fontSize: 12, color: "#8a93a6", marginTop: 2 }}>{value.primary_product}</div>
              )}
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 10, color: "#8a93a6", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 4 }}>Market segment</div>
              <div style={{ fontSize: 13, color: "#8a93a6" }}>
                Not detected yet. Click <strong style={{ color: "#f4f6fb" }}>Detect from website</strong> to have Claude read the homepage and propose a segment.
              </div>
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          {hasSegment && !editing && (
            <button style={ghostBtnStyle()} onClick={openEditFromValue}>
              <i className="ti ti-edit" style={{ fontSize: 14 }} aria-hidden="true"></i>Edit
            </button>
          )}
          <button style={accentBtnStyle(busy)} disabled={busy} onClick={detect}>
            <i className={`ti ${busy ? "ti-loader-2" : "ti-wand"}`} style={{ fontSize: 14 }} aria-hidden="true"></i>
            {busy ? "Detecting…" : hasSegment ? "Re-detect" : "Detect from website"}
          </button>
        </div>
      </div>

      {err && (
        <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(255,100,100,0.08)", border: "1px solid rgba(255,100,100,0.25)", color: "#ff6464", fontSize: 12 }}>
          {err}
        </div>
      )}

      {/* v1.1.13: inline confirmation after auto-applied detection. The big
          review card is gone — segment + competitors + keywords + region all
          flow through automatically, the Current segment area above shows the
          result, and this thin lime strip just acknowledges what happened. */}
      {lastDetection && (
        <div style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(132,204,22,0.08)", border: "1px solid rgba(132,204,22,0.25)", fontSize: 12, color: "#d6dbe6", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <i className="ti ti-check" aria-hidden="true" style={{ fontSize: 13, color: "#84cc16" }}></i>
          <span>
            Detected and applied · <strong style={{ color: "#84cc16" }}>{lastDetection.seedCount}</strong> seed keyword{lastDetection.seedCount === 1 ? "" : "s"} added to universe
            {lastDetection.compCount > 0 && <> · <strong style={{ color: "#ff5d9e" }}>{lastDetection.compCount}</strong> competitor{lastDetection.compCount === 1 ? "" : "s"} queued</>}
            {lastDetection.regionHint !== "unknown" && <> · region <strong style={{ color: "#ffb846" }}>{lastDetection.regionHint.toUpperCase()}</strong></>}
          </span>
          {excerpt?.title && (
            <details style={{ marginLeft: "auto" }}>
              <summary style={{ fontSize: 11, color: "#5a6478", cursor: "pointer" }}>What Claude read</summary>
              <div style={{ marginTop: 6, padding: "8px 10px", borderRadius: 8, background: "#11151d", border: "1px solid rgba(255,255,255,0.06)", fontSize: 11.5, color: "#d6dbe6", lineHeight: 1.55, maxWidth: 460 }}>
                <div><span style={{ color: "#5a6478" }}>title:</span> {excerpt.title}</div>
                {excerpt.description && <div><span style={{ color: "#5a6478" }}>desc:</span> {excerpt.description}</div>}
                {excerpt.h1 && <div><span style={{ color: "#5a6478" }}>h1:</span> {excerpt.h1}</div>}
              </div>
            </details>
          )}
        </div>
      )}

      {/* Free-text edit panel */}
      {editing && (
        <div style={{ padding: "14px 16px", borderRadius: 12, background: "#11151d", border: "1px solid rgba(255,255,255,0.07)" }}>
          <div style={{ fontSize: 10, color: "#8a93a6", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 10 }}>Custom segment</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div>
              <label className="label">Industry</label>
              <input className="input" placeholder="Finance" value={editL1} onChange={(e) => setEditL1(e.target.value)} />
            </div>
            <div>
              <label className="label">Category</label>
              <input className="input" placeholder="Lending" value={editL2} onChange={(e) => setEditL2(e.target.value)} />
            </div>
            <div>
              <label className="label">Subcategory</label>
              <input className="input" placeholder="Reverse Mortgages" value={editL3} onChange={(e) => setEditL3(e.target.value)} />
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <label className="label">Primary product (one sentence)</label>
            <input className="input" placeholder="Reverse mortgage for Canadian homeowners 55+" value={editProduct} onChange={(e) => setEditProduct(e.target.value)} />
          </div>
          <div style={{ marginTop: 10 }}>
            <label className="label">Seed keywords (comma-separated, used by the Discover flow)</label>
            <textarea className="input" rows={3} value={editSeeds} onChange={(e) => setEditSeeds(e.target.value)} />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button onClick={saveEdit} style={{ padding: "7px 13px", borderRadius: 9, background: "#4f8cff", color: "#06070b", fontSize: 12.5, fontWeight: 600, border: "none", cursor: "pointer" }}>Save</button>
            <button onClick={() => setEditing(false)} style={{ padding: "7px 13px", borderRadius: 9, background: "transparent", color: "#8a93a6", fontSize: 12.5, fontWeight: 500, border: "1px solid rgba(255,255,255,0.10)", cursor: "pointer" }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ConfidenceChip({ level }: { level: "high" | "medium" | "low" }) {
  const cfg = {
    high: { bg: "rgba(182,245,59,0.16)", color: "#b6f53b" },
    medium: { bg: "rgba(255,184,70,0.14)", color: "#ffb846" },
    low: { bg: "rgba(255,100,100,0.14)", color: "#ff6464" },
  }[level];
  return (
    <span style={{ marginLeft: 6, fontSize: 9.5, padding: "2px 8px", borderRadius: 999, background: cfg.bg, color: cfg.color, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>
      {level} confidence
    </span>
  );
}
