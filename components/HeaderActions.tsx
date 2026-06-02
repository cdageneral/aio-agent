"use client";
/**
 * v1.1.55: Renders the Copy PPT Prompt / Export Full Report / Run refresh
 * buttons in the global app header (app/layout.tsx), next to the
 * "All Projects" link. Only renders content when a project Dashboard has
 * registered handlers via `setHeaderActions`; on the Projects index (or any
 * other route) this collapses to nothing.
 *
 * v1.1.63: Added "Edit Project" link that appears between "All Projects" and
 * the action buttons whenever a project is active. Links to /projects/[id]/edit
 * using the projectId registered in the store by Dashboard.
 */
import { useHeaderActions } from "@/lib/headerActionsStore";
import { ghostBtnStyle, primaryBtnStyle } from "./uiStyles";
import { useState } from "react";
import Link from "next/link";

export default function HeaderActions() {
  const actions = useHeaderActions();
  const [copying, setCopying] = useState(false);
  const [exporting, setExporting] = useState(false);

  if (!actions) return null;

  const copyDisabled = copying || !actions.hasMetrics;
  const exportDisabled = exporting;
  const refreshDisabled = actions.refreshing;

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {/* Edit Project — only shown when a projectId is registered */}
      {actions.projectId && (
        <Link
          href={`/projects/${actions.projectId}/edit`}
          style={{
            ...ghostBtnStyle(false),
            padding: "7px 12px",
            fontSize: 13,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            textDecoration: "none",
          }}
          title="Edit project settings, competitors, and keywords"
        >
          <i className="ti ti-edit" style={{ fontSize: 14 }} aria-hidden="true"></i>
          Edit Project
        </Link>
      )}

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
            ? "Copy a slide-generation prompt for AIO Landscape + Cluster Opportunity Map. Paste into Claude/Copilot/ChatGPT inside PowerPoint."
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
