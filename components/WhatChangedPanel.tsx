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

      {(data.competitor_gained ?? []).length > 0 && (
        <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 10, background: "rgba(255,93,158,0.06)", border: "1px solid rgba(255,93,158,0.18)" }}>
          <div style={{ fontSize: 11, color: "#ff5d9e", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 6 }}>Competitor movement</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 13 }}>
            {data.competitor_gained!.map((c) => (
              <span key={c.brand_name}>
                <strong style={{ color: "#f4f6fb" }}>{c.brand_name}</strong>{" "}
                <span style={{ color: "#b6f53b", fontWeight: 600 }}>+{c.count}</span>
                <span style={{ color: "#5a6478" }}> new citations</span>
              </span>
            ))}
          </div>
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
