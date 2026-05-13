"use client";
import { useEffect, useState } from "react";
import SmartSegmentDetector, { SegmentValue, SuggestedCompetitor } from "./SmartSegmentDetector";
import RegionSelector, { RegionMode, regionsForMode } from "./RegionSelector";
import { primaryBtnStyle, accentBtnStyle } from "./uiStyles";

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
}: {
  project: any;
  onSaved: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  region: RegionMode;
  onRegionChange: (m: RegionMode) => void;
  onCompetitorsSuggested?: (c: SuggestedCompetitor[]) => void;
  onSeedKeywordsApplied?: (seeds: string[]) => Promise<void> | void;
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
        />
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
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
    </div>
  );
}
