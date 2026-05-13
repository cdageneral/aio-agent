"use client";
import { useState } from "react";
import { primaryBtnStyle } from "./uiStyles";
import type { SuggestedCompetitor } from "./SmartSegmentDetector";

export default function CompetitorPanel({
  projectId,
  competitors,
  onChanged,
  suggested = [],
  onSuggestionAdded,
  onSuggestionDismissed,
}: {
  projectId: string;
  competitors: any[];
  onChanged: () => void;
  suggested?: SuggestedCompetitor[];
  onSuggestionAdded?: (domain: string) => void;
  onSuggestionDismissed?: (domain: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [brand, setBrand] = useState("");
  const [aliases, setAliases] = useState("");
  const [busy, setBusy] = useState(false);
  // Per-suggestion add-in-flight tracker so each row spinner is independent.
  const [adding, setAdding] = useState<Record<string, boolean>>({});

  async function postCompetitor(input: { url: string; brand_name: string; brand_aliases?: string[] }) {
    return fetch(`/api/projects/${projectId}/competitors`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  }

  async function addCompetitor(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await postCompetitor({
        url,
        brand_name: brand,
        brand_aliases: aliases.split(",").map((s) => s.trim()).filter(Boolean),
      });
      if (res.ok) {
        setUrl(""); setBrand(""); setAliases("");
        onChanged();
      }
    } finally {
      setBusy(false);
    }
  }

  async function acceptSuggestion(c: SuggestedCompetitor) {
    setAdding((a) => ({ ...a, [c.domain]: true }));
    try {
      const res = await postCompetitor({
        url: c.domain.startsWith("http") ? c.domain : `https://${c.domain}`,
        brand_name: c.name,
      });
      if (res.ok) {
        onSuggestionAdded?.(c.domain);
        onChanged();
      }
    } finally {
      setAdding((a) => { const { [c.domain]: _, ...rest } = a; return rest; });
    }
  }

  async function remove(id: string) {
    await fetch(`/api/projects/${projectId}/competitors?competitor_id=${id}`, { method: "DELETE" });
    onChanged();
  }

  // Hide suggestions whose domain is already tracked (defensive — Dashboard
  // already de-dupes, but we re-check on render in case of a race.)
  const trackedDomains = new Set(competitors.map((c) => (c.domain ?? "").toLowerCase()));
  const visibleSuggestions = suggested.filter((s) => !trackedDomains.has(s.domain.toLowerCase()));

  return (
    <div className="surface p-5">
      <h2 className="h2">Competitors</h2>
      <p className="text-xs muted mt-1">Tracked brands. Anything outside this list shows in “Other domains”.</p>

      {visibleSuggestions.length > 0 && (
        <div
          style={{
            marginTop: 14,
            padding: "10px 12px",
            borderRadius: 10,
            background: "rgba(79,140,255,0.06)",
            border: "1px solid rgba(79,140,255,0.20)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: "#4f8cff", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", display: "inline-flex", alignItems: "center", gap: 5 }}>
              <i className="ti ti-wand" style={{ fontSize: 12 }} aria-hidden="true"></i>
              From smart detection
            </div>
            <span style={{ fontSize: 11, color: "#8a93a6" }}>{visibleSuggestions.length} suggestion{visibleSuggestions.length === 1 ? "" : "s"}</span>
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {visibleSuggestions.map((s) => {
              const inFlight = !!adding[s.domain];
              return (
                <li
                  key={s.domain}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    background: "#11151d",
                    border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: 8,
                    padding: "8px 10px",
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#f4f6fb", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 5 }}>
                      {s.verified && (
                        <i className="ti ti-rosette-discount-check" style={{ fontSize: 14, color: "#b6f53b" }} aria-hidden="true" title="Domain verified — site is reachable"></i>
                      )}
                      {s.name}
                    </div>
                    <div style={{ fontSize: 11, color: "#8a93a6" }}>{s.domain}</div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <button
                      onClick={() => acceptSuggestion(s)}
                      disabled={inFlight}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        padding: "5px 10px", borderRadius: 7,
                        background: inFlight ? "rgba(182,245,59,0.18)" : "#b6f53b",
                        color: "#06070b", fontSize: 11, fontWeight: 600,
                        border: "none", cursor: inFlight ? "wait" : "pointer",
                      }}
                    >
                      <i className={`ti ${inFlight ? "ti-loader-2" : "ti-plus"}`} style={{ fontSize: 12 }} aria-hidden="true"></i>
                      {inFlight ? "Adding…" : "Add"}
                    </button>
                    <button
                      onClick={() => onSuggestionDismissed?.(s.domain)}
                      style={{
                        padding: "5px 8px", borderRadius: 7,
                        background: "transparent",
                        color: "#8a93a6", fontSize: 11, fontWeight: 500,
                        border: "1px solid rgba(255,255,255,0.10)", cursor: "pointer",
                      }}
                      title="Dismiss this suggestion"
                    >
                      <i className="ti ti-x" style={{ fontSize: 12 }} aria-hidden="true"></i>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <form onSubmit={addCompetitor} className="grid grid-cols-1 sm:grid-cols-4 gap-2 mt-4">
        <input className="input sm:col-span-2" placeholder="https://competitor.com" value={url} onChange={(e) => setUrl(e.target.value)} required />
        <input className="input" placeholder="Brand name" value={brand} onChange={(e) => setBrand(e.target.value)} required />
        <button style={primaryBtnStyle(busy)} disabled={busy}>{busy ? "Adding…" : "Add"}</button>
        <input className="input sm:col-span-4" placeholder="Aliases (comma-separated, optional)" value={aliases} onChange={(e) => setAliases(e.target.value)} />
      </form>

      <ul className="mt-4 space-y-2">
        {competitors.length === 0 && <li className="text-sm muted">No competitors yet.</li>}
        {competitors.map((c) => (
          <li key={c.id} className="flex items-center justify-between text-sm rounded-lg px-3 py-2" style={{ background: "var(--surface-2)", border: "1px solid var(--line)" }}>
            <div>
              <div className="font-medium">{c.brand_name}</div>
              <div className="text-xs muted">{c.domain}</div>
            </div>
            <button className="text-xs" style={{ color: "var(--accent-red)" }} onClick={() => remove(c.id)}>remove</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
