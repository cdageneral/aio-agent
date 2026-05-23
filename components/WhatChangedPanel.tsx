"use client";
import { useCallback, useEffect, useState } from "react";
import { RegionMode, regionsForMode } from "./RegionSelector";

interface ChangesPayload {
  enough_history: boolean;
  message?: string;
  client_brand?: string;
  current?: { ran_at: string; aios: number };
  previous?: { ran_at: string; aios: number };
  newly_won?: { keyword: string; country: string; position: number }[];
  newly_lost?: { keyword: string; country: string; lost_position: number }[];
  moved_up?: { keyword: string; country: string; from: number; to: number }[];
  moved_down?: { keyword: string; country: string; from: number; to: number }[];
  new_aios?: { keyword: string; country: string; citation_count: number }[];
  counts?: { newly_won: number; newly_lost: number; moved_up: number; moved_down: number; new_aios: number };
  competitor_gained?: { brand_name: string; count: number }[];
  // v1.1.43: per-competitor keyword-level movement for the click-through.
  // gained/lost arrays carry keyword + country + position + AIO snippet so the
  // accordion can render the rows without re-fetching anything per-brand.
  competitor_movement?: {
    brand_name: string;
    net: number;
    gained_count: number;
    lost_count: number;
    gained: { keyword: string; country: string; position: number; aio_snippet: string | null }[];
    lost: { keyword: string; country: string; lost_position: number; aio_snippet: string | null }[];
  }[];
}

/**
 * Snapshot-over-snapshot diff panel. Renders the digest-ready story: what
 * the client gained, lost, who moved, and which competitors gained ground.
 * Click "Copy digest" to put a Slack/email-friendly summary on the clipboard.
 */
export default function WhatChangedPanel({
  projectId,
  region,
}: {
  projectId: string;
  region: RegionMode;
}) {
  const [data, setData] = useState<ChangesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  // v1.1.43: which competitor's keyword-level movement is currently expanded
  // in the Competitor Movement strip. null = collapsed; a brand name = its
  // accordion is open. Click the same name to collapse.
  const [expandedBrand, setExpandedBrand] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ region: regionsForMode(region).join(",") });
    const res = await fetch(`/api/projects/${projectId}/changes?${params.toString()}`, { cache: "no-store" });
    const j = await res.json();
    setData(j);
    setLoading(false);
  }, [projectId, region]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="text-sm muted">Computing changes…</div>;
  if (!data) return null;
  if (!data.enough_history) {
    return <div className="text-sm muted" style={{ padding: 18 }}>{data.message ?? "Need more snapshot history to compare."}</div>;
  }

  const dCur = new Date(data.current!.ran_at);
  const dPrev = new Date(data.previous!.ran_at);
  const counts = data.counts!;

  async function copyDigest() {
    if (!data) return;
    const lines: string[] = [];
    lines.push(`*AIO weekly digest — ${data.client_brand}*`);
    lines.push(`Comparing ${dCur.toLocaleDateString()} vs ${dPrev.toLocaleDateString()}`);
    lines.push("");
    lines.push(`🏆 Won this period: ${counts.newly_won}`);
    lines.push(`📉 Lost this period: ${counts.newly_lost}`);
    lines.push(`📈 Position improved: ${counts.moved_up}`);
    lines.push(`📊 Position worsened: ${counts.moved_down}`);
    lines.push(`✨ New AIOs in your space: ${counts.new_aios}`);
    if (data.competitor_gained?.length) {
      lines.push("");
      lines.push("*Competitors gaining ground:*");
      for (const c of data.competitor_gained.slice(0, 5)) {
        lines.push(`• ${c.brand_name}: +${c.count} new citations`);
      }
    }
    if ((data.newly_won ?? []).length) {
      lines.push("");
      lines.push("*Top wins:*");
      for (const w of data.newly_won!.slice(0, 5)) lines.push(`• ${w.keyword} — cited #${w.position} (${w.country.toUpperCase()})`);
    }
    if ((data.newly_lost ?? []).length) {
      lines.push("");
      lines.push("*Top losses:*");
      for (const l of data.newly_lost!.slice(0, 5)) lines.push(`• ${l.keyword} — was #${l.lost_position} (${l.country.toUpperCase()})`);
    }
    await navigator.clipboard.writeText(lines.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <p className="text-xs muted">
          Comparing <strong style={{ color: "#f4f6fb" }}>{dCur.toLocaleDateString()}</strong> vs <strong style={{ color: "#f4f6fb" }}>{dPrev.toLocaleDateString()}</strong>
        </p>
        <button
          onClick={copyDigest}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "6px 12px", borderRadius: 8,
            background: copied ? "rgba(182,245,59,0.16)" : "rgba(79,140,255,0.16)",
            color: copied ? "#b6f53b" : "#4f8cff",
            fontSize: 12, fontWeight: 600, border: "1px solid transparent", cursor: "pointer",
          }}
        >
          <i className={`ti ${copied ? "ti-check" : "ti-clipboard"}`} style={{ fontSize: 14 }} aria-hidden="true"></i>
          {copied ? "Copied!" : "Copy digest"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginBottom: 14 }}>
        <DeltaTile label="Won" value={counts.newly_won} color="#b6f53b" icon="ti-trophy" />
        <DeltaTile label="Lost" value={counts.newly_lost} color="#ff6464" icon="ti-trending-down" />
        <DeltaTile label="Up" value={counts.moved_up} color="#25e0ce" icon="ti-arrow-up" />
        <DeltaTile label="Down" value={counts.moved_down} color="#ffb846" icon="ti-arrow-down" />
        <DeltaTile label="New AIOs" value={counts.new_aios} color="#4f8cff" icon="ti-sparkles" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <ChangeList title="🏆 Newly won" items={(data.newly_won ?? []).map(w => ({ keyword: w.keyword, country: w.country, detail: `cited #${w.position}` }))} accent="#b6f53b" empty="No new wins this period." />
        <ChangeList title="📉 Newly lost" items={(data.newly_lost ?? []).map(w => ({ keyword: w.keyword, country: w.country, detail: `was #${w.lost_position}` }))} accent="#ff6464" empty="No citations lost this period." />
        <ChangeList title="📈 Position improved" items={(data.moved_up ?? []).map(w => ({ keyword: w.keyword, country: w.country, detail: `#${w.from} → #${w.to}` }))} accent="#25e0ce" empty="No upward moves." />
        <ChangeList title="📊 Position worsened" items={(data.moved_down ?? []).map(w => ({ keyword: w.keyword, country: w.country, detail: `#${w.from} → #${w.to}` }))} accent="#ffb846" empty="No drops in position." />
      </div>

      {/* v1.1.43: Competitor movement is now click-through. Each brand chip
          is a button; clicking it expands an inline accordion below the
          strip with the keyword-level breakdown (Gained / Lost) plus AIO
          snippets. Prefer `competitor_movement` (richer payload) when
          present; fall back to the legacy `competitor_gained` counts for
          older snapshots that haven't been re-diffed.
          Strip shows whenever EITHER source has rows so we don't lose
          backward compat on historical diffs. */}
      {((data.competitor_movement ?? []).length > 0 || (data.competitor_gained ?? []).length > 0) && (
        <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 10, background: "rgba(255,93,158,0.06)", border: "1px solid rgba(255,93,158,0.18)" }}>
          <div style={{ fontSize: 11, color: "#ff5d9e", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
            Competitor movement
            <span style={{ fontSize: 10, color: "#8a93a6", fontWeight: 500, letterSpacing: 0, textTransform: "none" }}>
              click a brand to see the keywords
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 13 }}>
            {(data.competitor_movement && data.competitor_movement.length > 0
              ? data.competitor_movement
              : (data.competitor_gained ?? []).map((c) => ({
                  brand_name: c.brand_name,
                  net: c.count,
                  gained_count: c.count,
                  lost_count: 0,
                  gained: [],
                  lost: [],
                }))
            ).map((c) => {
              const isOpen = expandedBrand === c.brand_name;
              const gain = c.gained_count;
              const loss = c.lost_count;
              const clickable = gain > 0 || loss > 0;
              return (
                <button
                  key={c.brand_name}
                  type="button"
                  onClick={() => clickable && setExpandedBrand(isOpen ? null : c.brand_name)}
                  disabled={!clickable}
                  aria-expanded={isOpen}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    padding: "5px 10px", borderRadius: 7,
                    background: isOpen ? "rgba(255,93,158,0.18)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${isOpen ? "rgba(255,93,158,0.50)" : "rgba(255,255,255,0.08)"}`,
                    color: "#f4f6fb", fontSize: 13, fontWeight: 500,
                    cursor: clickable ? "pointer" : "default",
                    transition: "background-color 120ms ease, border-color 120ms ease",
                  }}
                  title={clickable ? `Click to see the ${gain ? `${gain} gained` : ""}${gain && loss ? " / " : ""}${loss ? `${loss} lost` : ""} keyword${gain + loss === 1 ? "" : "s"}` : "No keyword detail for this brand"}
                >
                  <strong style={{ color: "#f4f6fb", fontWeight: 600 }}>{c.brand_name}</strong>
                  {gain > 0 && <span style={{ color: "#b6f53b", fontWeight: 600 }}>+{gain}</span>}
                  {loss > 0 && <span style={{ color: "#ff6464", fontWeight: 600 }}>−{loss}</span>}
                  {clickable && (
                    <i className={`ti ${isOpen ? "ti-chevron-up" : "ti-chevron-down"}`} style={{ fontSize: 12, color: "#8a93a6" }} aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Expanded accordion — shows for the currently-clicked brand. */}
          {expandedBrand && (() => {
            const c = (data.competitor_movement ?? []).find((m) => m.brand_name === expandedBrand);
            if (!c) return null;
            const showCap = (lst: { length: number } | undefined) =>
              lst && lst.length === 25 ? " (top 25 shown)" : "";
            return (
              <div
                style={{
                  marginTop: 12,
                  padding: "12px 14px",
                  background: "rgba(0,0,0,0.30)",
                  border: "1px solid rgba(255,93,158,0.22)",
                  borderRadius: 9,
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                  gap: 14,
                }}
              >
                <CompMoveList
                  title={`Gained · ${c.gained_count}${showCap(c.gained)}`}
                  accent="#b6f53b"
                  empty={`${c.brand_name} did not newly gain any keywords this snapshot.`}
                  rows={c.gained.map((g) => ({
                    keyword: g.keyword,
                    country: g.country,
                    position: g.position,
                    direction: "gained" as const,
                    aio_snippet: g.aio_snippet,
                  }))}
                />
                <CompMoveList
                  title={`Lost · ${c.lost_count}${showCap(c.lost)}`}
                  accent="#ff6464"
                  empty={`${c.brand_name} did not drop from any keywords this snapshot.`}
                  rows={c.lost.map((l) => ({
                    keyword: l.keyword,
                    country: l.country,
                    position: l.lost_position,
                    direction: "lost" as const,
                    aio_snippet: l.aio_snippet,
                  }))}
                />
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function DeltaTile({ label, value, color, icon }: { label: string; value: number; color: string; icon: string }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${color}22`, borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ fontSize: 10, color: "#8a93a6", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 4 }}>
        <i className={`ti ${icon}`} style={{ fontSize: 12, color }} aria-hidden="true"></i>{label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color, marginTop: 2, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{value}</div>
    </div>
  );
}

function ChangeList({ title, items, accent, empty }: { title: string; items: { keyword: string; country: string; detail: string }[]; accent: string; empty: string }) {
  return (
    <div style={{ background: "#0c0f15", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ fontSize: 11, color: accent, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 8 }}>{title}</div>
      {items.length === 0 && <div style={{ fontSize: 12, color: "#5a6478" }}>{empty}</div>}
      <ul style={{ listStyle: "none", padding: 0, margin: 0, maxHeight: 180, overflowY: "auto" }}>
        {items.slice(0, 8).map((it, i) => (
          <li key={i} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: 12.5, gap: 8 }}>
            <span style={{ color: "#d6dbe6", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.keyword}</span>
            <span style={{ color: accent, fontWeight: 600, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{it.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * v1.1.43: keyword-detail list rendered inside the Competitor Movement
 * accordion. Each row is a keyword the selected competitor either newly
 * gained citations on (`direction = "gained"`, position is current) or
 * dropped from (`direction = "lost"`, position is the prior snapshot's).
 * AIO snippet is rendered as a second line under the keyword for context
 * — capped server-side at ~160 chars so the row isn't a wall of text.
 */
function CompMoveList({
  title,
  accent,
  empty,
  rows,
}: {
  title: string;
  accent: string;
  empty: string;
  rows: {
    keyword: string;
    country: string;
    position: number;
    direction: "gained" | "lost";
    aio_snippet: string | null;
  }[];
}) {
  return (
    <div style={{ background: "#0c0f15", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ fontSize: 11, color: accent, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 8 }}>{title}</div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: "#5a6478", lineHeight: 1.5 }}>{empty}</div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, maxHeight: 280, overflowY: "auto" }}>
          {rows.map((r, i) => (
            <li
              key={`${r.keyword}|${r.country}|${i}`}
              style={{
                padding: "8px 0",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
                fontSize: 12.5,
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                <span style={{ color: "#d6dbe6", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>
                  {r.keyword}
                </span>
                <span style={{ color: accent, fontWeight: 600, flexShrink: 0, fontVariantNumeric: "tabular-nums", fontSize: 11.5 }}>
                  {r.country.toUpperCase()} · {r.direction === "gained" ? `cited #${r.position}` : `was #${r.position}`}
                </span>
              </div>
              {r.aio_snippet && (
                <div style={{ marginTop: 4, fontSize: 11.5, color: "#8a93a6", lineHeight: 1.5 }}>
                  {r.aio_snippet}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
