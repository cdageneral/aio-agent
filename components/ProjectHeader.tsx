"use client";
import { useEffect, useState } from "react";
import { SuggestedCompetitor } from "./SmartSegmentDetector";
import RegionSelector, { RegionMode, regionsForMode } from "./RegionSelector";
import { accentBtnStyle } from "./uiStyles";

/**
 * Top-of-dashboard control surface. Hosts the primary client URL input,
 * brand name, and region toggle.
 *
 * v1.1.63: Removed SmartSegmentDetector / "Detect from website" button —
 * market segment auto-detection is no longer surfaced here. Keywords are
 * uploaded at project-creation time via the new project wizard.
 *
 * v1.1.55: The Copy PPT Prompt / Export Full Report / Run refresh buttons
 * previously rendered here have been relocated to the GLOBAL app header
 * (rendered by `HeaderActions` in app/layout.tsx). Dashboard owns the
 * handlers now and registers them with `headerActionsStore` so they sit
 * next to the "All Projects" nav link. ProjectHeader keeps the Save
 * changes button only — it's tied to local form dirty-state and doesn't
 * make sense in the global header.
 */
export default function ProjectHeader({
  project,
  onSaved,
  region,
  onRegionChange,
  onCompetitorsSuggested,
  onSeedKeywordsApplied,
}: {
  project: any;
  onSaved: () => void;
  region: RegionMode;
  onRegionChange: (m: RegionMode) => void;
  onCompetitorsSuggested?: (c: SuggestedCompetitor[]) => void;
  onSeedKeywordsApplied?: (seeds: string[]) => Promise<void> | void;
}) {
  const [clientUrl, setClientUrl] = useState(project.client_url);
  const [brand, setBrand] = useState(project.brand_name);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  useEffect(() => {
    setClientUrl(project.client_url);
    setBrand(project.brand_name);
  }, [project.id, project.client_url, project.brand_name]);

  const persistedRegionsCSV = (project.regions ?? ["us"]).slice().sort().join(",");
  const selectedRegionsCSV = regionsForMode(region).slice().sort().join(",");
  const regionDirty = persistedRegionsCSV !== selectedRegionsCSV;

  const dirty =
    clientUrl !== project.client_url ||
    brand !== project.brand_name ||
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

      {/* v1.1.55: only the Save changes CTA lives here now. */}
      {dirty && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button
            style={accentBtnStyle(saving)}
            disabled={saving}
            onClick={save}
            title="Persist your edits to client URL, brand, or region without firing a SerpAPI run"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      )}

      {saveMsg && <div className="text-xs muted mt-3">{saveMsg}</div>}
    </div>
  );
}
