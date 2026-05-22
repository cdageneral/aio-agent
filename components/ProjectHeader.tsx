"use client";
import { useEffect, useState } from "react";
import SmartSegmentDetector, { SegmentValue, SuggestedCompetitor } from "./SmartSegmentDetector";
import RegionSelector, { RegionMode, regionsForMode } from "./RegionSelector";
import { primaryBtnStyle, accentBtnStyle, ghostBtnStyle } from "./uiStyles";
import { exportFullReportToPdf, buildPptPrompt } from "@/lib/export";

/**
 * Top-of-dashboard control surface. Hosts the primary client URL input,
 * brand name, region toggle, smart segment detector, and refresh button.
 * All edits route through PATCH /api/projects/[id].
 */
export default function ProjectHeader({
  project,
  onSaved,
  onRefresh,
  refreshing,
  region,
  onRegionChange,
  onCompetitorsSuggested,
  onSeedKeywordsApplied,
  regionLabel,
  latestMetrics,
}: {
  project: any;
  onSaved: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  region: RegionMode;
  onRegionChange: (m: RegionMode) => void;
  onCompetitorsSuggested?: (c: SuggestedCompetitor[]) => void;
  onSeedKeywordsApplied?: (seeds: string[]) => Promise<void> | void;
  /** v1.1.32: human-readable region label, passed through from Dashboard so
   *  the Export Full Report PDF cover page can show it without re-deriving. */
  regionLabel?: string;
  /** v1.1.33: latest SnapshotMetrics — used by the Copy PPT Prompt button to
   *  build a fully-populated slide-generation prompt. Typed loosely (`any`)
   *  to avoid coupling the header to the metrics module. */
  latestMetrics?: any;
}) {
  const [clientUrl, setClientUrl] = useState(project.client_url);
  const [brand, setBrand] = useState(project.brand_name);
  const [seg, setSeg] = useState<SegmentValue>({
    l1: project.segment_l1 ?? null,
    l2: project.segment_l2 ?? null,
    l3: project.segment_l3 ?? null,
    primary_product: project.primary_product ?? null,
    seed_keywords: project.custom_seed_keywords ?? [],
    confidence: project.detection_confidence ?? null,
  });
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  // v1.1.32: full-report PDF export state. Lives at the header level so the
  // button can show a loading label without re-rendering the whole dashboard.
  const [exportingReport, setExportingReport] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  // v1.1.33: PPT prompt copy state. Same pattern — local UI state so the
  // toast-style confirmation doesn't bounce render through the whole tree.
  const [copyingPrompt, setCopyingPrompt] = useState(false);
  const [promptMsg, setPromptMsg] = useState<string | null>(null);

  useEffect(() => {
    setClientUrl(project.client_url);
    setBrand(project.brand_name);
    setSeg({
      l1: project.segment_l1 ?? null,
      l2: project.segment_l2 ?? null,
      l3: project.segment_l3 ?? null,
      primary_product: project.primary_product ?? null,
      seed_keywords: project.custom_seed_keywords ?? [],
      confidence: project.detection_confidence ?? null,
    });
  }, [project.id, project.client_url, project.brand_name, project.segment_l1, project.segment_l2, project.segment_l3, project.primary_product]);

  const persistedRegionsCSV = (project.regions ?? ["us"]).slice().sort().join(",");
  const selectedRegionsCSV = regionsForMode(region).slice().sort().join(",");
  const regionDirty = persistedRegionsCSV !== selectedRegionsCSV;

  const persistedSeedsCSV = (project.custom_seed_keywords ?? []).slice().sort().join("|");
  const currentSeedsCSV = (seg.seed_keywords ?? []).slice().sort().join("|");
  const seedsDirty = persistedSeedsCSV !== currentSeedsCSV;

  const dirty =
    clientUrl !== project.client_url ||
    brand !== project.brand_name ||
    seg.l1 !== (project.segment_l1 ?? null) ||
    seg.l2 !== (project.segment_l2 ?? null) ||
    seg.l3 !== (project.segment_l3 ?? null) ||
    (seg.primary_product ?? null) !== (project.primary_product ?? null) ||
    seedsDirty ||
    regionDirty;

  async function save() {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_url: clientUrl,
          brand_name: brand,
          segment_l1: seg.l1,
          segment_l2: seg.l2,
          segment_l3: seg.l3,
          primary_product: seg.primary_product ?? null,
          custom_seed_keywords: seg.seed_keywords ?? [],
          detection_confidence: seg.confidence ?? null,
          regions: regionsForMode(region),
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Save failed");
      setSaveMsg("Saved.");
      onSaved();
    } catch (e: any) {
      setSaveMsg(e.message);
    } finally {
      setSaving(false);
    }
  }

  /**
   * v1.1.32: Snapshot the entire dashboard panel container to a multi-page
   * PDF. We locate the dashboard wrapper via the data-aio-report-root attribute
   * that Dashboard.tsx attaches to its root element. Capturing per-section
   * (handled inside exportFullReportToPdf) keeps charts intact across page
   * breaks.
   */
  async function exportReport() {
    if (exportingReport) return;
    setExportingReport(true);
    setExportMsg(null);
    try {
      const root = typeof document !== "undefined"
        ? (document.querySelector('[data-aio-report-root="true"]') as HTMLElement | null)
        : null;
      if (!root) throw new Error("Dashboard not found on page.");
      await exportFullReportToPdf(root, {
        brand_name: project.brand_name,
        client_url: project.client_url,
        region_label: regionLabel ?? "—",
      });
      setExportMsg("Report exported.");
    } catch (e: any) {
      console.error("Full report export failed", e);
      setExportMsg(`Export failed: ${e.message ?? "unknown error"}`);
    } finally {
      setExportingReport(false);
    }
  }

  /**
   * v1.1.33: Build a PPT slide-generation prompt from the live snapshot and
   * write it to the clipboard so the user can paste it into Claude / Copilot
   * / ChatGPT inside PowerPoint. The prompt tells the receiving AI to MATCH
   * THE ACTIVE DECK's style (fonts, colors, masters) rather than hardcoding
   * a look — that way a single button works regardless of which client deck
   * the user is editing.
   *
   * Auto-clears the toast after 4s so the header doesn't accumulate stale
   * confirmation text on repeat clicks.
   */
  async function copyPptPrompt() {
    if (copyingPrompt) return;
    setCopyingPrompt(true);
    setPromptMsg(null);
    try {
      const prompt = buildPptPrompt(latestMetrics ?? null, {
        brand_name: project.brand_name,
        client_url: project.client_url,
        region_label: regionLabel ?? "—",
        // Light-touch universe hint: derive from segment l3 / l2 / l1 if present.
        // The receiving AI uses this in the slide title, e.g. "AIO landscape — TRT/HRT keyword set".
        universe_label: project.segment_l3 ?? project.segment_l2 ?? project.segment_l1 ?? undefined,
      });
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(prompt);
        setPromptMsg("Prompt copied — paste into Claude/Copilot/ChatGPT inside PowerPoint.");
      } else {
        // Fallback: surface the prompt in a new tab as plaintext so the user can copy it manually.
        const w = typeof window !== "undefined" ? window.open("", "_blank") : null;
        if (w) {
          w.document.write(`<pre style="white-space:pre-wrap;font:14px monospace;padding:20px">${prompt.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] ?? c))}</pre>`);
          setPromptMsg("Clipboard unavailable — prompt opened in a new tab to copy manually.");
        } else {
          throw new Error("Clipboard unavailable and popup blocked.");
        }
      }
      // Auto-clear toast after 4s
      setTimeout(() => setPromptMsg(null), 4000);
    } catch (e: any) {
      console.error("PPT prompt copy failed", e);
      setPromptMsg(`Copy failed: ${e.message ?? "unknown error"}`);
    } finally {
      setCopyingPrompt(false);
    }
  }

  return (
    <div className="surface p-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-end">
        <div className="lg:col-span-6">
          <label className="label">Client website</label>
          <input
            className="input text-base font-semibold"
            value={clientUrl}
            onChange={(e) => setClientUrl(e.target.value)}
            placeholder="https://chip.ca"
            style={{ fontSize: 15 }}
          />
        </div>
        <div className="lg:col-span-3">
          <label className="label">Brand name</label>
          <input className="input" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="CHIP" />
        </div>
        <div className="lg:col-span-3 flex flex-col gap-1">
          <label className="label">Region</label>
          <div className="flex items-center gap-2 flex-wrap">
            <RegionSelector value={region} onChange={onRegionChange} />
            {regionDirty && (
              <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 999, background: "rgba(255,184,70,0.14)", color: "#ffb846", fontWeight: 700, letterSpacing: "0.04em" }}>unsaved</span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-5" style={{ paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <SmartSegmentDetector
          clientUrl={clientUrl}
          value={seg}
          onChange={setSeg}
          onRegionHint={(r) => onRegionChange(r)}
          onCompetitorsSuggested={onCompetitorsSuggested}
          onSeedKeywordsApplied={onSeedKeywordsApplied}
          // v1.1.13: persist detection result immediately so the segment shows
          // up on the next page load instead of disappearing back into
          // "Not detected yet." The detector calls this with the just-applied
          // segment fields; we PATCH the project record directly without
          // waiting for the user to click "Save changes."
          onAutoSave={async (nextSeg) => {
            try {
              await fetch(`/api/projects/${project.id}`, {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  segment_l1: nextSeg.l1,
                  segment_l2: nextSeg.l2,
                  segment_l3: nextSeg.l3,
                  primary_product: nextSeg.primary_product ?? null,
                  custom_seed_keywords: nextSeg.seed_keywords ?? [],
                  detection_confidence: nextSeg.confidence ?? null,
                }),
              });
              onSaved();
            } catch { /* non-fatal — local state still has the segment */ }
          }}
        />
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
        {/* v1.1.33: Copy a PPT slide-generation prompt to clipboard. Pulls
            live snapshot data and emits a long-form prompt the user pastes
            into Claude / Copilot / ChatGPT inside PowerPoint to spin up two
            slides (AIO Landscape + Cluster Opportunity Map) that match the
            currently-open deck's style. */}
        <button
          style={ghostBtnStyle(copyingPrompt || !latestMetrics)}
          disabled={copyingPrompt || !latestMetrics}
          onClick={copyPptPrompt}
          title={latestMetrics
            ? "Copy a slide-generation prompt for AIO Landscape + Cluster Opportunity Map. Paste into Claude/Copilot/ChatGPT inside PowerPoint."
            : "Run a refresh first — there's no snapshot data to build a prompt from yet."}
        >
          <i className="ti ti-clipboard-text" style={{ fontSize: 14 }} aria-hidden="true"></i>
          {copyingPrompt ? "Copying…" : "Copy PPT Prompt"}
        </button>
        {/* v1.1.32: Export full report — captures the whole dashboard (Story,
            Share of Voice, Charts, Clusters, AIO Opportunities, Drilldown,
            Brand Comparison, etc.) to a multi-page PDF using a per-section
            html2canvas snapshot. Ghost-style so it doesn't compete with the
            primary "Run refresh" CTA. */}
        <button
          style={ghostBtnStyle(exportingReport)}
          disabled={exportingReport}
          onClick={exportReport}
          title="Export the full dashboard (all panels) as a multi-page PDF report"
        >
          <i className="ti ti-file-download" style={{ fontSize: 14 }} aria-hidden="true"></i>
          {exportingReport ? "Building PDF…" : "Export Full Report"}
        </button>
        {dirty && (
          <button
            style={accentBtnStyle(saving)}
            disabled={saving}
            onClick={save}
            title="Persist your edits to client URL, brand, segment, or region without firing a SerpAPI run"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        )}
        <button style={primaryBtnStyle(refreshing)} disabled={refreshing} onClick={onRefresh}>
          {refreshing ? "Refreshing…" : "Run refresh"}
        </button>
      </div>

      {saveMsg && <div className="text-xs muted mt-3">{saveMsg}</div>}
      {exportMsg && <div className="text-xs muted mt-2">{exportMsg}</div>}
      {promptMsg && (
        <div
          aria-live="polite"
          style={{
            marginTop: 8,
            padding: "6px 11px",
            borderRadius: 8,
            background: "rgba(37,224,206,0.08)",
            border: "1px solid rgba(37,224,206,0.30)",
            color: "#25e0ce",
            fontSize: 12,
            fontWeight: 500,
            width: "fit-content",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            marginLeft: "auto",
            float: "right",
          }}
        >
          <i className="ti ti-clipboard-check" style={{ fontSize: 14 }} aria-hidden="true"></i>
          {promptMsg}
        </div>
      )}
    </div>
  );
}
