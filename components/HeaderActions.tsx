"use client";
/**
 * v1.1.55: Renders the Copy PPT Prompt / Export Full Report / Run refresh
 * buttons in the global app header (app/layout.tsx), next to the
 * "All Projects" link. Only renders content when a project Dashboard has
 * registered handlers via `setHeaderActions`; on the Projects index (or any
 * other route) this collapses to nothing.
 *
 * Buttons keep the same look and disabled-state logic they had inside
 * ProjectHeader so users see a 1:1 relocation, not a redesign.
 */
import { useHeaderActions } from "@/lib/headerActionsStore";
import { ghostBtnStyle, primaryBtnStyle } from "./uiStyles";
import { useState } from "react";

export default function HeaderActions() {
  const actions = useHeaderActions();
  const [copying, setCopying] = useState(false);
  const [exporting, setExporting] = useState(false);

  if (!actions) return null;

  const copyDisabled = copying || !actions.hasMetrics;
  const exportDisabled = exporting;
  const refreshDisabled = actions.refreshing;

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        // Slightly smaller buttons than the original to fit the header row
        // without bloating the nav height.
      }}
    >
      <button
        style={{ ...ghostBtnStyle(copyDisabled), padding: "7px 12px", fontSize: 13 }}
        disabled={copyDisabled}
        onClick={async () => {
          if (copyDisabled) return;
          setCopying(true);
          try {
            await actions.onCopyPptPrompt();
          } finally {
            setCopying(false);
          }
        }}
        title={
          actions.hasMetrics
            ? "Copy a slide-generation prompt for 3 slides — AIO Landscape, Cluster Opportunity Map, and Keyword-Level Opportunity + AIO Drill-Down. Paste into Claude/Copilot/ChatGPT inside PowerPoint."
            : "Run a refresh first — there's no snapshot data to build a prompt from yet."
        }
      >
        <i className="ti ti-clipboard-text" style={{ fontSize: 14 }} aria-hidden="true"></i>
        {copying ? "Copying…" : "Copy PPT Prompt"}
      </button>

      <button
        style={{ ...ghostBtnStyle(exportDisabled), padding: "7px 12px", fontSize: 13 }}
        disabled={exportDisabled}
        onClick={async () => {
          if (exportDisabled) return;
          setExporting(true);
          try {
            await actions.onExportReport();
          } finally {
            setExporting(false);
          }
        }}
        title="Export the full dashboard (all panels) as a multi-page PDF report"
      >
        <i className="ti ti-file-download" style={{ fontSize: 14 }} aria-hidden="true"></i>
        {exporting ? "Building PDF…" : "Export Full Report"}
      </button>

      <button
        style={{ ...primaryBtnStyle(refreshDisabled), padding: "7px 14px", fontSize: 13 }}
        disabled={refreshDisabled}
        onClick={actions.onRunRefresh}
      >
        {actions.refreshing ? "Refreshing…" : "Run refresh"}
      </button>
    </div>
  );
}
