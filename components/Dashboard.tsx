"use client";
import { useCallback, useEffect, useState } from "react";
import ProjectHeader from "./ProjectHeader";
import CompetitorPanel from "./CompetitorPanel";
import KeywordPanel from "./KeywordPanel";
import KpiCards from "./KpiCards";
import GrowthChart from "./GrowthChart";
import AcquisitionChart from "./AcquisitionChart";
import PeriodSelector from "./PeriodSelector";
import RegionSelector, { RegionMode, regionsForMode } from "./RegionSelector";
import StoryPanel from "./StoryPanel";
import ShareOfVoiceHero from "./ShareOfVoiceHero";
import FirstRefreshBanner from "./FirstRefreshBanner";
import { Period } from "./chartUtils";
import type { SuggestedCompetitor } from "./SmartSegmentDetector";
import CompetitorTable from "./CompetitorTable";
import KeywordExplorer from "./KeywordExplorer";
import KeywordClusters from "./KeywordClusters";
import QuickWinsPanel from "./QuickWinsPanel";
import WhatChangedPanel from "./WhatChangedPanel";
import OtherDomainsTabs from "./OtherDomainsTabs";

export interface MetricsPayload {
  project: any;
  competitors: any[];
  snapshots: any[];
  latest: any | null;
  series: any[];
  growth: any | null;
  regions_in_view: string[];
  keywords_count?: number;
}

function defaultMode(regions: string[] | undefined): RegionMode {
  const set = new Set((regions ?? ["us"]).map((r) => r.toLowerCase()));
  if (set.has("us") && set.has("ca")) return "both";
  if (set.has("ca")) return "ca";
  return "us";
}

export default function Dashboard({ projectId }: { projectId: string }) {
  const [data, setData] = useState<MetricsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("90d");
  const [region, setRegion] = useState<RegionMode>("us");
  // Suggested competitors flow from the SmartSegmentDetector down to the
  // CompetitorPanel. Transient — survives in-session, cleared once added or
  // dismissed. Re-detect to repopulate.
  const [suggestedCompetitors, setSuggestedCompetitors] = useState<SuggestedCompetitor[]>([]);
  // Cluster filter is shared across the Cluster cards, Quick Wins, and Keyword
  // Drilldown panels. Clicking a card sets it; the dropdowns in the lower
  // panels read it. "all" disables filtering.
  const [clusterFilter, setClusterFilter] = useState<string>("all");

  function pickCluster(name: string) {
    // Toggle off if user re-clicks the active card.
    setClusterFilter((prev) => (prev === name ? "all" : name));
    // Scroll the user's eye toward where the filter takes effect.
    if (typeof window !== "undefined") {
      setTimeout(() => {
        document.getElementById("section-quick-wins")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ region: regionsForMode(region).join(",") });
    const res = await fetch(`/api/projects/${projectId}/metrics?${params.toString()}`, { cache: "no-store" });
    const j = await res.json();
    setData(j);
    // On first load, snap region to whatever the project actually has configured.
    if (j?.project?.regions) {
      const inferred = defaultMode(j.project.regions);
      if (inferred !== region && data === null) setRegion(inferred);
    }
    // Hydrate suggested competitors from the persisted JSONB column. This is
    // what lets suggestions survive a page reload until the user resolves them.
    if (Array.isArray(j?.project?.suggested_competitors)) {
      setSuggestedCompetitors(j.project.suggested_competitors);
    }
    setLoading(false);
  }, [projectId, region]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Persist the current suggested-competitors array to the project. Called
   *  whenever the user accepts, adds, or dismisses a suggestion so the DB
   *  stays in sync. */
  async function persistSuggestions(next: SuggestedCompetitor[]) {
    setSuggestedCompetitors(next);
    try {
      await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ suggested_competitors: next }),
      });
    } catch {
      /* non-fatal — UI stays correct; next reload will re-sync */
    }
  }

  /** Push the LLM-suggested seed keywords into the keyword universe right
   *  away as `manual` source so the user lands on a populated panel. */
  async function applySeedKeywords(seeds: string[]) {
    if (!seeds.length) return;
    const res = await fetch(`/api/projects/${projectId}/keywords`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: "manual", keywords: seeds }),
    });
    if (res.ok) {
      const j = await res.json();
      setRefreshMsg(`Universe seeded — ${j.added} keyword(s) added. Click Run refresh to fetch AIOs.`);
      await load();
    }
  }

  useEffect(() => { load(); }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    setRefreshMsg(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/refresh`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Refresh failed");
      setRefreshMsg(`Snapshot saved — ${j.aios_triggered} AIO(s) detected${j.failed ? `, ${j.failed} errored` : ""}.`);
      await load();
    } catch (e: any) {
      setRefreshMsg(`Error: ${e.message}`);
    } finally {
      setRefreshing(false);
    }
  }

  if (loading || !data) return <div className="text-sm muted">Loading…</div>;
  const { project, competitors, latest, series, growth } = data;

  return (
    <div className="space-y-8">
      <ProjectHeader
        project={project}
        onSaved={load}
        onRefresh={onRefresh}
        refreshing={refreshing}
        region={region}
        onRegionChange={setRegion}
        onCompetitorsSuggested={(c) => {
          // De-dupe against currently tracked competitors AND the existing suggestion list.
          const trackedDomains = new Set<string>(competitors.map((x: any) => (x.domain ?? "").toLowerCase()));
          const existingDomains = new Set(suggestedCompetitors.map((x) => x.domain.toLowerCase()));
          const fresh = c.filter((x) => x.domain && !trackedDomains.has(x.domain.toLowerCase()) && !existingDomains.has(x.domain.toLowerCase()));
          if (fresh.length === 0) return;
          persistSuggestions([...suggestedCompetitors, ...fresh]);
        }}
        onSeedKeywordsApplied={applySeedKeywords}
      />

      {refreshMsg && <div className="text-sm muted">{refreshMsg}</div>}

      <FirstRefreshBanner
        keywordsCount={data.keywords_count ?? 0}
        region={region}
        refreshing={refreshing}
        hasSnapshots={(data.snapshots ?? []).some((s: any) => s.status === "complete")}
        onRefresh={onRefresh}
      />

      <StoryPanel project={project} latest={latest} growth={growth} region={region} />

      {latest && latest.share_of_voice && latest.total_citation_slots > 0 && (() => {
        // When a cluster filter is active, scope the donut + legend to that
        // cluster's slices/AIO count. Otherwise show the global view.
        const cluster = clusterFilter !== "all"
          ? (latest.clusters ?? []).find((c: any) => c.name === clusterFilter)
          : null;
        const slices = cluster ? cluster.share_of_voice : latest.share_of_voice;
        const totalSlots = cluster ? cluster.total_citation_slots : latest.total_citation_slots;
        const totalAios = cluster ? cluster.aio_count : latest.total_aios_triggered;
        if (!slices || slices.length === 0 || totalSlots === 0) return null;
        return (
          <ShareOfVoiceHero
            slices={slices}
            totalSlots={totalSlots}
            totalAios={totalAios}
            clientLabel={project.brand_name}
            growth={growth?.brands}
            clusterName={cluster ? cluster.name : null}
            onClearCluster={cluster ? () => setClusterFilter("all") : undefined}
          />
        );
      })()}

      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <CompetitorPanel
          projectId={projectId}
          competitors={competitors}
          onChanged={load}
          suggested={suggestedCompetitors}
          onSuggestionAdded={(domain) => persistSuggestions(suggestedCompetitors.filter((c) => c.domain !== domain))}
          onSuggestionDismissed={(domain) => persistSuggestions(suggestedCompetitors.filter((c) => c.domain !== domain))}
        />
        <KeywordPanel projectId={projectId} onChanged={load} />
      </section>

      <KpiCards latest={latest} growth={growth} project={project} />

      <section className="surface p-5">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="h2">What changed</h2>
          <span className="text-xs muted">Snapshot diff · digest-ready summary you can ship to Slack.</span>
        </div>
        <WhatChangedPanel projectId={projectId} region={region} />
      </section>

      <section className="surface p-5">
        <div className="flex items-baseline justify-between flex-wrap gap-3 mb-4">
          <div>
            <h2 className="h2">AIO trends</h2>
            <p className="text-xs muted mt-0.5">{series.length} snapshot{series.length === 1 ? "" : "s"} · timeline applies to both charts</p>
          </div>
          <PeriodSelector value={period} onChange={setPeriod} />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="surface-2 p-4">
            <div className="text-sm font-semibold">AIOs triggered</div>
            <p className="text-xs muted mb-2">How often Google is surfacing an AIO across tracked queries — market volume, not brand-specific.</p>
            <GrowthChart series={series} period={period} />
          </div>
          <div className="surface-2 p-4">
            <div className="text-sm font-semibold">Acquisition rate</div>
            <p className="text-xs muted mb-2">Citation rate over time — {project.brand_name} vs tracked competitors.</p>
            <AcquisitionChart series={series} period={period} project={project} />
          </div>
        </div>
      </section>

      <section className="surface p-5">
        <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
          <div>
            <h2 className="h2">Topic clusters</h2>
            <p className="text-xs muted mt-0.5">Keywords grouped by intent. Click any cluster to filter Quick Wins &amp; Drilldown to that topic.</p>
          </div>
          {latest?.clusters?.length > 0 && (
            <span className="text-xs muted">{latest.clusters.length} cluster{latest.clusters.length === 1 ? "" : "s"}</span>
          )}
        </div>
        <KeywordClusters
          clusters={latest?.clusters ?? []}
          clientBrand={project.brand_name}
          activeCluster={clusterFilter}
          onClusterSelect={pickCluster}
        />
      </section>

      {clusterFilter !== "all" && (
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: 12, padding: "10px 14px", borderRadius: 10,
            background: "rgba(168,120,255,0.10)",
            border: "1px solid rgba(168,120,255,0.30)",
            position: "sticky", top: 8, zIndex: 5,
          }}
        >
          <div style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 8 }}>
            <i className="ti ti-filter" style={{ fontSize: 14, color: "#a878ff" }} aria-hidden="true"></i>
            <span style={{ color: "#8a93a6" }}>Filtering to cluster</span>
            <strong style={{ color: "#a878ff" }}>{clusterFilter}</strong>
            <span style={{ color: "#5a6478" }}>· Quick Wins &amp; Drilldown below are filtered</span>
          </div>
          <button
            onClick={() => setClusterFilter("all")}
            style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "5px 11px", borderRadius: 8,
              background: "transparent", color: "#a878ff",
              fontSize: 12, fontWeight: 600,
              border: "1px solid rgba(168,120,255,0.40)", cursor: "pointer",
            }}
          >
            <i className="ti ti-x" style={{ fontSize: 12 }} aria-hidden="true"></i>Clear filter
          </button>
        </div>
      )}

      <section className="surface p-5" id="section-quick-wins">
        <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
          <div>
            <h2 className="h2">Quick wins</h2>
            <p className="text-xs muted mt-0.5">Gettable AIO citations ranked by opportunity score — start here.</p>
          </div>
        </div>
        <QuickWinsPanel
          projectId={projectId}
          region={region}
          clientBrand={project.brand_name}
          clusterFilter={clusterFilter}
          onClusterFilterChange={setClusterFilter}
        />
      </section>

      <section className="surface p-5">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="h2">Keyword drilldown</h2>
          <span className="text-xs muted">Click any row to expand the AIO answer, citation list, and brand-hit breakdown.</span>
        </div>
        <KeywordExplorer
          projectId={projectId}
          region={region}
          projectBrand={project.brand_name}
          clusterFilter={clusterFilter}
          onClusterFilterChange={setClusterFilter}
        />
      </section>

      <section className="surface p-5">
        <h2 className="h2 mb-3">Brand comparison</h2>
        <CompetitorTable latest={latest} />
      </section>

      <section className="surface p-5">
        <h2 className="h2 mb-3">Other domains in AIOs</h2>
        <OtherDomainsTabs latest={latest} />
      </section>
    </div>
  );
}
