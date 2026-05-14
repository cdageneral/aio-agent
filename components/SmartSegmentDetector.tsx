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
}: {
  clientUrl: string;
  value: SegmentValue;
  onChange: (v: SegmentValue) => void;
  onRegionHint?: (r: "us" | "ca" | "both") => void;
  onCompetitorsSuggested?: (competitors: SuggestedCompetitor[]) => void;
  /** Called with the suggested seed keywords when user accepts. Dashboard
   *  uses this to POST them into the keyword universe immediately. */
  onSeedKeywordsApplied?: (seeds: string[]) => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
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
    setSuggestion(null);
    try {
      const res = await fetch("/api/detect-segment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: clientUrl }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error ?? "Detection failed");
      setSuggestion(j.result);
      setExcerpt(j.excerpt);
      // v1.1.5: auto-apply detected seed keywords directly to the universe so
      // they show up in the Keyword panel below — no chip preview, no extra
      // click. The user reviews / edits / deletes them in the universe panel
      // where keywords actually live.
      if (j.result.seed_keywords?.length && onSeedKeywordsApplied) {
        try { await onSeedKeywordsApplied(j.result.seed_keywords); } catch {}
      }
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const [applying, setApplying] = useState(false);

  async function applySuggestion() {
    if (!suggestion) return;
    setApplying(true);
    try {
      // Apply the segment fields. Seed keywords were already pushed to the
      // universe on detect (v1.1.5) so we only mirror them in segment state
      // for downstream "what was suggested" memory — not for a second push.
      onChange({
        l1: suggestion.industry || null,
        l2: suggestion.category || null,
        l3: suggestion.subcategory || null,
        primary_product: suggestion.primary_product || null,
        seed_keywords: suggestion.seed_keywords,
        competitors: suggestion.competitors,
        confidence: suggestion.confidence,
      });
      if (suggestion.region_hint && suggestion.region_hint !== "unknown") {
        onRegionHint?.(suggestion.region_hint);
      }
      if (suggestion.competitors?.length) {
        onCompetitorsSuggested?.(suggestion.competitors);
      }
      setSuggestion(null);
      setExcerpt(null);
    } finally {
      setApplying(false);
    }
  }

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

      {/* Suggestion card — only when a fresh suggestion is pending */}
      {suggestion && (
        <div style={{ padding: "14px 16px", borderRadius: 12, background: "rgba(79,140,255,0.06)", border: "1px solid rgba(79,140,255,0.22)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, color: "#4f8cff", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>Suggested segment</span>
            <ConfidenceChip level={suggestion.confidence} />
            {suggestion.region_hint !== "unknown" && (
              <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 999, background: "rgba(255,184,70,0.16)", color: "#ffb846", fontWeight: 700, letterSpacing: "0.04em" }}>
                region · {suggestion.region_hint.toUpperCase()}
              </span>
            )}
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#f4f6fb" }}>
            {suggestion.industry} › {suggestion.category} › <span style={{ color: "#b6f53b" }}>{suggestion.subcategory}</span>
          </div>
          {suggestion.primary_product && (
            <div style={{ fontSize: 12.5, color: "#8a93a6", marginTop: 4 }}>{suggestion.primary_product}</div>
          )}

          {excerpt?.title && (
            <details style={{ marginTop: 10 }}>
              <summary style={{ fontSize: 11, color: "#5a6478", cursor: "pointer" }}>What Claude read</summary>
              <div style={{ marginTop: 6, padding: "8px 10px", borderRadius: 8, background: "#11151d", border: "1px solid rgba(255,255,255,0.06)", fontSize: 11.5, color: "#d6dbe6", lineHeight: 1.55 }}>
                <div><span style={{ color: "#5a6478" }}>title:</span> {excerpt.title}</div>
                {excerpt.description && <div><span style={{ color: "#5a6478" }}>desc:</span> {excerpt.description}</div>}
                {excerpt.h1 && <div><span style={{ color: "#5a6478" }}>h1:</span> {excerpt.h1}</div>}
              </div>
            </details>
          )}

          {suggestion.seed_keywords.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 11, color: "#84cc16", display: "inline-flex", alignItems: "center", gap: 5 }}>
              <i className="ti ti-check" aria-hidden="true" style={{ fontSize: 12 }}></i>
              Added {suggestion.seed_keywords.length} seed keyword{suggestion.seed_keywords.length === 1 ? "" : "s"} to the universe below — review, edit, or delete them in the Keyword Universe panel.
            </div>
          )}

          {suggestion.competitors.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 10, color: "#8a93a6", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 6 }}>
                Suggested competitors ({suggestion.competitors.length}) <span style={{ color: "#5a6478", fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>· verified domains shown below · one-click add in the Competitors panel</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {suggestion.competitors.map((c) => (
                  <span key={c.domain || c.name} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, padding: "3px 9px", borderRadius: 999, background: "rgba(255,93,158,0.14)", color: "#ff5d9e", fontWeight: 600 }}>
                    {c.verified && <i className="ti ti-rosette-discount-check" style={{ fontSize: 13, color: "#b6f53b" }} aria-hidden="true"></i>}
                    {c.name}
                    {c.domain && <span style={{ color: "rgba(255,93,158,0.55)", fontWeight: 400 }}>{c.domain}</span>}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
            <button
              onClick={applySuggestion}
              disabled={applying}
              style={{
                padding: "8px 14px", borderRadius: 9,
                background: applying ? "rgba(182,245,59,0.18)" : "#b6f53b",
                color: "#06070b", fontSize: 13, fontWeight: 600, border: "none",
                cursor: applying ? "wait" : "pointer",
                display: "inline-flex", alignItems: "center", gap: 6,
              }}
            >
              <i className={`ti ${applying ? "ti-loader-2" : "ti-check"}`} style={{ fontSize: 14 }} aria-hidden="true"></i>
              {applying ? "Applying…" : "Use these"}
            </button>
            <span style={{ fontSize: 10.5, color: "#5a6478" }}>
              Sets segment · queues {suggestion.competitors.length} competitor{suggestion.competitors.length === 1 ? "" : "s"}
              {suggestion.region_hint !== "unknown" && ` · sets region ${suggestion.region_hint.toUpperCase()}`}
            </span>
            <button
              onClick={() => {
                setEditL1(suggestion.industry);
                setEditL2(suggestion.category);
                setEditL3(suggestion.subcategory);
                setEditProduct(suggestion.primary_product);
                setEditSeeds(suggestion.seed_keywords.join(", "));
                setEditing(true);
                setSuggestion(null);
              }}
              style={ghostBtnStyle()}
            >
              <i className="ti ti-edit" style={{ fontSize: 14 }} aria-hidden="true"></i>Edit
            </button>
            <button
              onClick={() => { setSuggestion(null); setExcerpt(null); }}
              style={{ padding: "8px 12px", borderRadius: 9, background: "transparent", color: "#8a93a6", fontSize: 13, fontWeight: 500, border: "1px solid rgba(255,255,255,0.10)", cursor: "pointer" }}
            >
              Skip
            </button>
          </div>
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
