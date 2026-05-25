"use client";
import { useEffect, useState } from "react";
import RegionSelector, { RegionMode, regionsForMode } from "./RegionSelector";
import { accentBtnStyle } from "./uiStyles";

/**
 * Top-of-dashboard control surface. Hosts the primary client URL input,
 * brand name, and region toggle.
 *
 * v1.1.55: The Copy PPT Prompt / Export Full Report / Run refresh buttons
 * previously rendered here have been relocated to the GLOBAL app header
 * (rendered by `HeaderActions` in app/layout.tsx). Dashboard owns the
 * handlers now and registers them with `headerActionsStore` so they sit
 * next to the "All Projects" nav link. ProjectHeader keeps the Save
 * changes button only — it's tied to local form dirty-state and doesn't
 * make sense in the global header.
 *
 * v1.1.66: the SmartSegmentDetector block ("Market segment / Detect from
 * website") was removed at user request — same rationale as removing the
 * detect step from the new-project wizard (see app/projects/new/page.tsx).
 * The segment_l1/l2/l3, primary_product, custom_seed_keywords, and
 * detection_confidence columns on the project row are NOT touched by this
 * change — they stay in the DB schema and the project payload, just
 * aren't editable from the dashboard anymore. The save() PATCH no longer
 * sends them, so existing values are preserved on update. The
 * SmartSegmentDetector.tsx component and the /api/detect-segment route
 * are kept on disk so re-enabling is a single import + JSX block.
 */
export default function ProjectHeader({
  project,
  onSaved,
  region,
  onRegionChange,
}: {
  project: any;
  onSaved: () => void;
  region: RegionMode;
  onRegionChange: (m: RegionMode) => void;
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

      {/* v1.1.55: only the Save changes CTA lives here now — Copy PPT Prompt,
          Export Full Report, and Run refresh moved to the global header so
          users can fire them without scrolling back to the top of the page. */}
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
