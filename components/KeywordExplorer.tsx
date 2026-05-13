"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RegionMode, regionsForMode } from "./RegionSelector";
import { exportDrilldownToCsv, exportDrilldownToPdf, type DrilldownExportRow, type ExportContext } from "@/lib/export";

/**
 * Per-keyword drilldown table. Each row shows quick stance (AIO yes/no, who won,
 * # citations, is the client cited). Clicking a row expands to the full
 * AIO answer text + complete citation list + brand-hit chips.
 *
 * Filters:
 *   - "all"       — every tracked keyword
 *   - "aio"       — keywords that triggered an AIO
 *   - "missing"   — AIOs where the client is NOT cited (the gap list)
 *   - "won"       — AIOs where the client IS cited
 *   - "mentions"  — AIOs where the client is named but not linked
 * Plus free-text search and per-region filter (inherited from dashboard).
 */
type Hit = {
  brand_name: string;
  domain: string;
  kind: "client" | "competitor";
  cited: boolean;
  position: number | null;
  slots: number;
  mentioned: boolean;
};
type Citation = {
  serp_result_id: string;
  position: number;
  domain: string;
  url: string;
  title: string | null;
  source_type: string | null;
};
type KeywordRow = {
  id: string;
  keyword: string;
  country: string;
  source: string | null;
  cluster_label: string | null;
  has_aio: boolean;
  aio_text: string | null;
  citations: Citation[];
  brand_hits: Hit[];
  winner: { brand_name: string; position: number | null; kind: string } | null;
};

type FilterMode = "all" | "aio" | "missing" | "won" | "mentions";

const PALETTE_FOR_KIND: Record<string, string> = { client: "#4f8cff", competitor: "#ff5d9e" };

export default function KeywordExplorer({
  projectId,
  region,
  projectBrand,
  clusterFilter,
  onClusterFilterChange,
}: {
  projectId: string;
  region: RegionMode;
  projectBrand: string;
  /** Controlled cluster filter, owned by Dashboard. */
  clusterFilter: string;
  onClusterFilterChange: (v: string) => void;
}) {
  const [data, setData] = useState<{ keywords: KeywordRow[]; tracked: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterMode>("aio");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState<null | "csv" | "pdf">(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ region: regionsForMode(region).join(",") });
    const res = await fetch(`/api/projects/${projectId}/keywords/detail?${params.toString()}`, { cache: "no-store" });
    const j = await res.json();
    setData({ keywords: j.keywords ?? [], tracked: j.tracked ?? [] });
    setLoading(false);
  }, [projectId, region]);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    let r = data.keywords;
    if (filter === "aio") r = r.filter((k) => k.has_aio);
    if (filter === "missing") r = r.filter((k) => k.has_aio && !k.brand_hits.find((b) => b.kind === "client")?.cited);
    if (filter === "won") r = r.filter((k) => k.has_aio && !!k.brand_hits.find((b) => b.kind === "client")?.cited);
    if (filter === "mentions") r = r.filter((k) => k.has_aio && !!k.brand_hits.find((b) => b.kind === "client")?.mentioned && !k.brand_hits.find((b) => b.kind === "client")?.cited);
    if (clusterFilter !== "all") {
      r = clusterFilter === "__unclustered"
        ? r.filter((k) => !k.cluster_label)
        : r.filter((k) => k.cluster_label === clusterFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter((k) => k.keyword.toLowerCase().includes(q));
    }
    return r;
  }, [data, filter, clusterFilter, search]);

  // Distinct cluster labels in the loaded universe, sorted by frequency desc.
  const clusterOptions = useMemo<{ entries: [string, number][]; unclustered: number }>(() => {
    if (!data) return { entries: [], unclustered: 0 };
    const counts = new Map<string, number>();
    let unclustered = 0;
    for (const k of data.keywords) {
      if (k.cluster_label) counts.set(k.cluster_label, (counts.get(k.cluster_label) ?? 0) + 1);
      else unclustered += 1;
    }
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    return { entries: sorted, unclustered };
  }, [data]);

  const counts = useMemo(() => {
    if (!data) return { all: 0, aio: 0, missing: 0, won: 0, mentions: 0 };
    const aio = data.keywords.filter((k) => k.has_aio);
    const won = aio.filter((k) => !!k.brand_hits.find((b) => b.kind === "client")?.cited).length;
    const missing = aio.length - won;
    const mentions = aio.filter((k) => !!k.brand_hits.find((b) => b.kind === "client")?.mentioned && !k.brand_hits.find((b) => b.kind === "client")?.cited).length;
    return { all: data.keywords.length, aio: aio.length, missing, won, mentions };
  }, [data]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Map the currently-filtered rows into the flat shape the exporter expects.
  // This re-derives whenever filters change, so a download always reflects
  // what the user is actually looking at.
  const exportRows = useMemo<DrilldownExportRow[]>(() => {
    return rows.map((k) => {
      const clientHit = k.brand_hits.find((b) => b.kind === "client");
      let status = "no AIO";
      if (k.has_aio) {
        if (clientHit?.cited) status = `cited #${clientHit.position}`;
        else if (clientHit?.mentioned) status = "mentioned (not cited)";
        else status = "missing";
      }
      return {
        keyword: k.keyword,
        country: k.country,
        cluster: k.cluster_label,
        has_aio: k.has_aio,
        citations_count: k.citations.length,
        top_winner: k.winner?.brand_name ?? null,
        top_winner_position: k.winner?.position ?? null,
        client_status: status,
      };
    });
  }, [rows]);

  const exportCtx = useMemo<ExportContext>(() => {
    const filterLabel =
      filter === "all" ? "all keywords" :
      filter === "aio" ? "AIOs only" :
      filter === "won" ? "won" :
      filter === "missing" ? "missing" :
      "mention only";
    const regionLabel = region === "us" ? "US" : region === "ca" ? "Canada" : "US + Canada";
    const clusterLabel =
      clusterFilter === "all" ? "all clusters" :
      clusterFilter === "__unclustered" ? "unclustered" :
      clusterFilter;
    return { brand_name: projectBrand, filter_label: filterLabel, region_label: regionLabel, cluster_label: clusterLabel };
  }, [filter, region, clusterFilter, projectBrand]);

  async function handleExport(kind: "csv" | "pdf") {
    if (exportRows.length === 0) return;
    setExporting(kind);
    try {
      if (kind === "csv") {
        exportDrilldownToCsv(exportRows, exportCtx);
      } else {
        await exportDrilldownToPdf(exportRows, exportCtx);
      }
    } catch (e) {
      console.error("Export failed", e);
      // eslint-disable-next-line no-alert
      alert("Export failed. Check the console for details.");
    } finally {
      setExporting(null);
    }
  }

  if (loading) return <div className="text-sm muted">Loading keyword detail…</div>;
  if (!data || data.keywords.length === 0) {
    return <div className="text-sm muted">No keyword data yet. Run a refresh first.</div>;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <FilterChip active={filter === "aio"} label={`AIOs (${counts.aio})`} accent="#25e0ce" onClick={() => setFilter("aio")} />
        <FilterChip active={filter === "missing"} label={`Missing (${counts.missing})`} accent="#ff6464" onClick={() => setFilter("missing")} />
        <FilterChip active={filter === "won"} label={`Won (${counts.won})`} accent="#b6f53b" onClick={() => setFilter("won")} />
        <FilterChip active={filter === "mentions"} label={`Mention only (${counts.mentions})`} accent="#ff5d9e" onClick={() => setFilter("mentions")} />
        <FilterChip active={filter === "all"} label={`All (${counts.all})`} accent="#8a93a6" onClick={() => setFilter("all")} />

        {clusterOptions.entries.length > 0 && (
          <select
            value={clusterFilter}
            onChange={(e) => onClusterFilterChange(e.target.value)}
            className="input"
            style={{
              maxWidth: 220, fontSize: 12, padding: "6px 28px 6px 11px",
              background: clusterFilter !== "all" ? "rgba(168,120,255,0.10)" : "#11151d",
              border: clusterFilter !== "all" ? "1px solid rgba(168,120,255,0.40)" : "1px solid rgba(255,255,255,0.07)",
              color: clusterFilter !== "all" ? "#a878ff" : "#f4f6fb",
              fontWeight: clusterFilter !== "all" ? 600 : 400,
            }}
          >
            <option value="all">All clusters</option>
            {clusterOptions.entries.map(([name, n]) => (
              <option key={name} value={name}>{name} ({n})</option>
            ))}
            {clusterOptions.unclustered > 0 && (
              <option value="__unclustered">Unclustered ({clusterOptions.unclustered})</option>
            )}
          </select>
        )}

        <input
          className="input"
          placeholder="Search keyword…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 220, marginLeft: "auto" }}
        />

        <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <ExportButton
            label="Excel"
            icon="ti-file-spreadsheet"
            disabled={exportRows.length === 0 || exporting !== null}
            loading={exporting === "csv"}
            onClick={() => handleExport("csv")}
            accent="#84cc16"
            title={`Download ${exportRows.length} row${exportRows.length === 1 ? "" : "s"} as a CSV (opens in Excel / Google Sheets)`}
          />
          <ExportButton
            label="PDF"
            icon="ti-file-text"
            disabled={exportRows.length === 0 || exporting !== null}
            loading={exporting === "pdf"}
            onClick={() => handleExport("pdf")}
            accent="#ff6464"
            title={`Download ${exportRows.length} row${exportRows.length === 1 ? "" : "s"} as a printable PDF report`}
          />
        </div>
      </div>

      <div style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.07)", overflow: "hidden" }}>
        <div style={{
          display: "grid",
          gridTemplateColumns: "1.7fr 60px 70px 90px 1fr 100px 28px",
          gap: 10,
          padding: "10px 14px",
          background: "#11151d",
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "#8a93a6",
          fontWeight: 600,
        }}>
          <div>Keyword</div>
          <div>Region</div>
          <div>AIO</div>
          <div>Citations</div>
          <div>Top winner</div>
          <div>{projectBrand}</div>
          <div></div>
        </div>

        {rows.length === 0 && (
          <div style={{ padding: 24, textAlign: "center", color: "#8a93a6", fontSize: 13 }}>
            No keywords match this filter.
          </div>
        )}

        {rows.map((k) => {
          const clientHit = k.brand_hits.find((b) => b.kind === "client");
          const isOpen = expanded.has(k.id);
          return (
            <div key={k.id} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <div
                onClick={() => toggle(k.id)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.7fr 60px 70px 90px 1fr 100px 28px",
                  gap: 10,
                  padding: "12px 14px",
                  fontSize: 13,
                  cursor: "pointer",
                  alignItems: "center",
                  background: isOpen ? "rgba(79,140,255,0.06)" : "transparent",
                  transition: "background 120ms ease",
                }}
              >
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <span style={{ fontWeight: 500 }}>{k.keyword}</span>
                  {k.source && <span className="tag" style={{ marginLeft: 8 }}>{k.source}</span>}
                  {k.cluster_label && (
                    <span
                      style={{
                        marginLeft: 6, fontSize: 9.5, padding: "1px 7px", borderRadius: 999,
                        background: "rgba(168,120,255,0.14)", color: "#a878ff", fontWeight: 600,
                      }}
                      title="Topic cluster"
                    >
                      {k.cluster_label}
                    </span>
                  )}
                </div>
                <div><RegionBadge country={k.country} /></div>
                <div>{k.has_aio
                  ? <span style={{ color: "#25e0ce", fontWeight: 600 }}>Yes</span>
                  : <span style={{ color: "#5a6478" }}>—</span>}</div>
                <div style={{ color: "#d6dbe6" }}>{k.has_aio ? k.citations.length : "—"}</div>
                <div>
                  {k.winner ? (
                    <WinnerChip name={k.winner.brand_name} pos={k.winner.position} kind={k.winner.kind} />
                  ) : k.has_aio ? <span style={{ color: "#5a6478" }}>none tracked</span> : null}
                </div>
                <div>
                  {clientHit?.cited ? (
                    <span style={{ color: "#b6f53b", fontWeight: 600, fontSize: 12 }}>#{clientHit.position}</span>
                  ) : clientHit?.mentioned ? (
                    <span style={{ color: "#ff5d9e", fontWeight: 600, fontSize: 11 }}>mentioned</span>
                  ) : k.has_aio ? (
                    <span style={{ color: "#ff6464", fontWeight: 600, fontSize: 11 }}>missing</span>
                  ) : <span style={{ color: "#5a6478" }}>—</span>}
                </div>
                <div style={{ color: "#8a93a6", textAlign: "right" }}>
                  <i className={`ti ${isOpen ? "ti-chevron-up" : "ti-chevron-down"}`} style={{ fontSize: 14 }} aria-hidden="true"></i>
                </div>
              </div>

              {isOpen && <KeywordDetail row={k} projectBrand={projectBrand} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ExportButton({
  label, icon, disabled, loading, onClick, accent, title,
}: {
  label: string;
  icon: string;
  disabled: boolean;
  loading: boolean;
  onClick: () => void;
  accent: string;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "6px 11px",
        borderRadius: 8,
        fontSize: 12,
        fontWeight: 600,
        background: "transparent",
        color: disabled ? "#5a6478" : accent,
        border: `1px solid ${disabled ? "rgba(255,255,255,0.07)" : accent + "55"}`,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled && !loading ? 0.55 : 1,
        transition: "background 120ms ease, border-color 120ms ease",
      }}
      onMouseEnter={(e) => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = `${accent}12`; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
    >
      <i className={`ti ${loading ? "ti-loader-2" : icon}`} style={{ fontSize: 13, animation: loading ? "spin 0.8s linear infinite" : undefined }} aria-hidden="true"></i>
      <span>{loading ? "Preparing…" : label}</span>
    </button>
  );
}

function FilterChip({ active, label, accent, onClick }: { active: boolean; label: string; accent: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 12px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        background: active ? accent : "transparent",
        color: active ? "#06070b" : "#d6dbe6",
        border: active ? "1px solid transparent" : "1px solid rgba(255,255,255,0.12)",
        cursor: "pointer",
        transition: "background 120ms ease, color 120ms ease",
      }}
    >
      {label}
    </button>
  );
}

function RegionBadge({ country }: { country: string }) {
  const c = country.toUpperCase();
  const bg = c === "US" ? "rgba(79,140,255,0.18)" : "rgba(255,184,70,0.18)";
  const color = c === "US" ? "#4f8cff" : "#ffb846";
  return <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700, background: bg, color, letterSpacing: "0.04em" }}>{c}</span>;
}

function WinnerChip({ name, pos, kind }: { name: string; pos: number | null; kind: string }) {
  const dot = PALETTE_FOR_KIND[kind] ?? "#8a93a6";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, background: dot, display: "inline-block" }} />
      <span style={{ color: "#f4f6fb", fontWeight: kind === "client" ? 600 : 500 }}>{name}</span>
      {pos != null && <span style={{ color: "#8a93a6" }}>#{pos}</span>}
    </span>
  );
}

function KeywordDetail({ row, projectBrand }: { row: KeywordRow; projectBrand: string }) {
  return (
    <div style={{ padding: "14px 20px 20px", background: "rgba(0,0,0,0.20)", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 18 }}>
        <div>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: "#8a93a6", fontWeight: 600, marginBottom: 6 }}>AI Overview answer</div>
          {row.aio_text ? (
            <div style={{ fontSize: 13.5, lineHeight: 1.7, color: "#d6dbe6", background: "#11151d", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "12px 14px", maxHeight: 280, overflowY: "auto", whiteSpace: "pre-wrap" }}>
              {row.aio_text}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: "#8a93a6" }}>{row.has_aio ? "AIO body wasn't captured." : "No AIO triggered for this keyword."}</div>
          )}

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: "#8a93a6", fontWeight: 600, marginBottom: 8 }}>Tracked brand hits</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {row.brand_hits.map((b) => <BrandHitChip key={b.domain} hit={b} />)}
            </div>
          </div>
        </div>

        <div>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: "#8a93a6", fontWeight: 600, marginBottom: 6 }}>
            Citations ({row.citations.length})
          </div>
          <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {row.citations.map((c) => (
              <li key={`${c.position}-${c.domain}`} style={{ display: "grid", gridTemplateColumns: "28px 1fr", gap: 8, padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#8a93a6", textAlign: "right" }}>#{c.position}</div>
                <div style={{ minWidth: 0 }}>
                  <a href={c.url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: "#f4f6fb", textDecoration: "none", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.title || c.domain}
                  </a>
                  <div style={{ fontSize: 11, color: "#8a93a6", display: "flex", gap: 6, alignItems: "center", marginTop: 1 }}>
                    <span>{c.domain}</span>
                    {c.source_type && <span className="tag" style={{ fontSize: 9, padding: "1px 6px" }}>{c.source_type}</span>}
                  </div>
                </div>
              </li>
            ))}
            {row.citations.length === 0 && <li style={{ fontSize: 12, color: "#8a93a6" }}>No citations parsed.</li>}
          </ol>
        </div>
      </div>
    </div>
  );
}

function BrandHitChip({ hit }: { hit: Hit }) {
  const dot = PALETTE_FOR_KIND[hit.kind];
  let label = "no hit";
  let color = "#8a93a6";
  let bg = "rgba(255,255,255,0.05)";
  if (hit.cited) {
    label = `cited #${hit.position}${hit.mentioned ? " · mentioned" : ""}`;
    color = "#b6f53b";
    bg = "rgba(182,245,59,0.10)";
  } else if (hit.mentioned) {
    label = "mentioned only";
    color = "#ff5d9e";
    bg = "rgba(255,93,158,0.10)";
  } else {
    label = "absent";
    color = "#ff6464";
    bg = "rgba(255,100,100,0.08)";
  }
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 8, background: bg, border: `1px solid ${color}22` }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, background: dot }} />
      <span style={{ fontSize: 12, color: "#f4f6fb", fontWeight: hit.kind === "client" ? 600 : 500 }}>{hit.brand_name}</span>
      <span style={{ fontSize: 11, color, fontWeight: 600 }}>{label}</span>
    </div>
  );
}
