"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import ProjectHeader from "./ProjectHeader";
import CompetitorPanel from "./CompetitorPanel";
import KeywordPanel from "./KeywordPanel";
import GrowthChart from "./GrowthChart";
import AcquisitionChart from "./AcquisitionChart";
import PeriodSelector from "./PeriodSelector";
import RegionSelector, { RegionMode, regionsForMode } from "./RegionSelector";
import StoryPanel from "./StoryPanel";
import ShareOfVoiceHero from "./ShareOfVoiceHero";
import FirstRefreshBanner from "./FirstRefreshBanner";
import { DateRange, DEFAULT_RANGE, filterByDateRange } from "./chartUtils";
import type { SuggestedCompetitor } from "./SmartSegmentDetector";
import CompetitorTable from "./CompetitorTable";
import KeywordExplorer from "./KeywordExplorer";
import KeywordClusters from "./KeywordClusters";
import QuickWinsPanel from "./QuickWinsPanel";
import WhatChangedPanel from "./WhatChangedPanel";
import OtherDomainsTabs from "./OtherDomainsTabs";
import InfoTooltip from "./InfoTooltip";
import RefreshProgress, { type RefreshProgressData } from "./RefreshProgress";

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
  const [range, setRange] = useState<DateRange>(DEFAULT_RANGE);
  // v1.1.15: monotonically increments after every refresh / auto-cluster /
  // significant project mutation. Child panels (QuickWinsPanel, KeywordExplorer)
  // include it in their useEffect deps so they refetch their data without
  // needing a manual reload.
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [region, setRegion] = useState<RegionMode>("us");
  // Suggested competitors flow from the SmartSegmentDetector down to the
  // CompetitorPanel. Transient — survives in-session, cleared once added or
  // dismissed. Re-detect to repopulate.
  const [suggestedCompetitors, setSuggestedCompetitors] = useState<SuggestedCompetitor[]>([]);
  // Cluster filter is shared across the Cluster cards, AIO Opportunities, and Keyword
  // Drilldown panels. Clicking a card sets it; the dropdowns in the lower
  // panels read it. "all" disables filtering.
  const [clusterFilter, setClusterFilter] = useState<string>("all");
  // v1.1.27: dashboard-wide branded vs non-branded scope. Drives the metrics
  // fetch URL and is passed to QuickWinsPanel + KeywordExplorer so they slice
  // to the same universe. "all" = no filter (default).
  const [kindFilter, setKindFilter] = useState<"all" | "branded" | "non_branded">("all");

  // v1.1.10: gate region inference so it only fires on the very first metrics
  // load. The previous `data === null` check was a stale closure that could
  // mis-fire after onChanged() refetches and cause double-loads to race.
  const didInferRegionRef = useRef(false);

  // v1.1.37: live refresh-progress polling state. Populated by a setInterval
  // that hits /refresh/progress every 2.5s while a refresh is in flight.
  // Cleared when the polled snapshot reaches a terminal state OR when the
  // user starts a brand-new refresh (so we don't show stale numbers).
  const [refreshProgress, setRefreshProgress] = useState<RefreshProgressData | null>(null);
  // Used to identify a "fresh" refresh — we only show progress for snapshots
  // ran_at ≥ the time we clicked Refresh, so historical stalled snapshots
  // from previous runs don't bleed into the current view.
  const refreshStartedAtRef = useRef<number>(0);

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
    if (kindFilter !== "all") params.set("kind", kindFilter);
    const res = await fetch(`/api/projects/${projectId}/metrics?${params.toString()}`, { cache: "no-store" });
    const j = await res.json();
    setData(j);
    // v1.1.10: Snap region to whatever the project actually has configured —
    // but only ONCE, on the very first metrics load. Using a useRef flag
    // avoids the stale-closure race where `data === null` could mis-evaluate
    // mid-flight and trigger a second load with the new region while the
    // first is still in flight (causing stale data to land last).
    if (!didInferRegionRef.current && j?.project?.regions) {
      didInferRegionRef.current = true;
      const inferred = defaultMode(j.project.regions);
      if (inferred !== region) setRegion(inferred);
    }
    // Hydrate suggested competitors from the persisted JSONB column. This is
    // what lets suggestions survive a page reload until the user resolves them.
    if (Array.isArray(j?.project?.suggested_competitors)) {
      setSuggestedCompetitors(j.project.suggested_competitors);
    }
    // v1.1.26: do NOT bump refreshNonce here. The previous design caused a
    // cascade: cluster completes → onChanged → load → nonce++ → child panels
    // refetch. Combined with auto-cluster's own re-trigger pattern, this
    // looked like "refreshing every few seconds." Now nonce only bumps on
    // explicit user Refresh, so cluster cards still update (via setData) but
    // downstream panels don't unnecessarily re-fetch on every cluster cycle.
    setLoading(false);
  }, [projectId, region, kindFilter]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // v1.1.10: hard guard against double-click — without this, rapid clicks
    // (or simultaneous clicks from ProjectHeader + FirstRefreshBanner) fire
    // two parallel POST /refresh requests that create separate snapshot rows
    // and race each other's load() calls.
    if (refreshing) return;
    setRefreshing(true);
    setRefreshMsg(null);
    // v1.1.37: stamp the start time so the polling effect knows to only
    // surface progress for snapshots that started at-or-after this click.
    refreshStartedAtRef.current = Date.now();
    setRefreshProgress(null);
    try {
      // v1.1.47: align the persisted project.regions with the current region
      // toggle BEFORE firing the refresh. The toggle was historically a
      // view-only filter — users would set it to Canada, hit Refresh, and
      // get back a US-only snapshot because the server reads project.regions
      // (not the toggle) to decide what to crawl. Auto-persisting here makes
      // "I selected Canada and clicked Refresh → it crawls Canada" actually
      // true, without forcing the user to find and click a separate "Save
      // changes" button in the header.
      const desiredRegions = regionsForMode(region);
      const persistedRegions = (data?.project?.regions ?? ["us"]).slice().sort();
      const desiredSorted = desiredRegions.slice().sort();
      const regionsChanged =
        persistedRegions.length !== desiredSorted.length ||
        persistedRegions.some((r: string, i: number) => r !== desiredSorted[i]);
      if (regionsChanged) {
        const patchRes = await fetch(`/api/projects/${projectId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ regions: desiredRegions }),
        });
        if (!patchRes.ok) {
          // Don't block the refresh on a persist failure — fall through and
          // crawl whatever the server thinks the regions are. The user just
          // won't get the new region until next time.
          const j = await patchRes.json().catch(() => ({}));
          console.warn("[onRefresh] failed to persist region change:", j);
        }
      }
      const res = await fetch(`/api/projects/${projectId}/refresh`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Refresh failed");
      setRefreshMsg(`Snapshot saved — ${j.aios_triggered} AIO(s) detected${j.failed ? `, ${j.failed} errored` : ""}.`);
      await load();
      // v1.1.15: nudge child panels (Quick Wins, Drilldown) so they refetch
      // their own data with the new snapshot rather than show stale state.
      setRefreshNonce((n) => n + 1);
    } catch (e: any) {
      setRefreshMsg(`Error: ${e.message}`);
    } finally {
      setRefreshing(false);
    }
  }

  // v1.1.37/v1.1.40: poll /refresh/progress so the bar surfaces a live
  // refresh regardless of whether the user just clicked the button or just
  // reloaded the page mid-refresh.
  //
  // v1.1.40 fixes two bugs from the original v1.1.37 wiring:
  //   1. The effect used to bail when `refreshing === false`, so reloading
  //      the page while a refresh was running on the server showed no bar
  //      at all — exactly the moment the user expects to come back and
  //      check on it. We now ALWAYS poll on mount.
  //   2. The freshness filter compared the snapshot's `ran_at` (server
  //      clock) against `refreshStartedAtRef.current` (client clock). Any
  //      clock skew — common across Vercel regions — could incorrectly
  //      exclude a just-created snapshot. We now use the server-computed
  //      `elapsed_sec` to decide whether a snapshot is fresh enough to
  //      display, eliminating the client/server clock dependency.
  //
  // Recency rule: show the snapshot if status === "running" (server thinks
  // work is happening — stall detection inside the endpoint will catch
  // zombies) OR if it finished within the last 10 minutes (so the user can
  // see the final state briefly after completion). Older terminal snapshots
  // are stale UI noise and are hidden.
  //
  // Polling lifecycle: poll once on mount. If a fresh snapshot is found and
  // it's still running, keep polling at 2.5s cadence. Once the snapshot is
  // terminal we stop the interval but leave the final state visible. When
  // the user clicks Refresh, this effect re-runs (refreshing is in the dep
  // array) and resumes polling.
  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    const stopInterval = () => {
      if (interval) { clearInterval(interval); interval = null; }
    };
    const startInterval = () => {
      if (cancelled || interval) return;
      interval = setInterval(tick, 2500);
    };

    const tick = async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/refresh/progress`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const j = await res.json();
        if (cancelled) return;

        const snap = j.snapshot;
        if (!snap) {
          // No snapshot exists yet. If user is actively refreshing, keep
          // polling — the server is about to create one. Otherwise nothing
          // to show.
          if (!refreshing) {
            setRefreshProgress(null);
            stopInterval();
          }
          return;
        }

        // v1.1.45: defense-in-depth zombie filter. The progress endpoint
        // auto-fails snapshots stuck in 'running' beyond ZOMBIE_THRESHOLD
        // (10 min), but on the very first poll after a long absence the
        // status flip may not have happened yet. Belt-and-suspenders: also
        // refuse to treat a 'running' snapshot older than 10 minutes as
        // fresh on the client.
        const elapsedSec = snap.elapsed_sec ?? 0;
        const isLiveRunning = snap.status === "running" && elapsedSec <= 600;
        const isRecentTerminal = snap.status !== "running" && elapsedSec < 600;
        const isFresh = isLiveRunning || isRecentTerminal;

        if (!isFresh) {
          // v1.1.46: critical fix. If `refreshing` is true the user JUST
          // kicked off POST /refresh and the new snapshot is incoming on
          // the server; the only snapshot the endpoint can return on this
          // tick is whatever was latest BEFORE the click (frequently a
          // recently-auto-failed zombie). Stopping the interval here would
          // mean we never see the new snapshot appear. Keep polling — the
          // next tick will catch the new running snapshot. We still hide
          // the bar in the meantime so the user doesn't see a phantom
          // "stalled" banner during the gap.
          setRefreshProgress(null);
          if (!refreshing) stopInterval();
          return;
        }

        setRefreshProgress(snap);

        if (isLiveRunning || refreshing) {
          // Keep polling while there's a live snapshot OR the user is
          // mid-refresh (so we can swap in the new snapshot the moment
          // the server creates it).
          startInterval();
        } else {
          // Terminal status (or auto-failed zombie) AND no refresh in
          // flight — keep the result on screen for the freshness window
          // but stop polling.
          stopInterval();
        }
      } catch { /* swallow — transient network errors during polling are fine */ }
    };

    // Initial check on mount, project change, or when user starts a refresh.
    tick();
    // If user just kicked off a refresh, start the interval even before the
    // first tick returns — the snapshot may not exist yet on the server, and
    // we want to be polling as soon as it does.
    if (refreshing) startInterval();

    return () => {
      cancelled = true;
      stopInterval();
    };
  }, [projectId, refreshing]);

  // v1.1.29: only collapse to the full-page loader on the very FIRST load (when
  // data is still null). Subsequent refetches — scope toggle, region change,
  // any onChanged() trigger — keep the existing dashboard rendered with the
  // previous data so the user's scroll position survives. A subtle inline
  // "Updating…" pill near the top signals the refetch is in flight.
  if (!data) return <div className="text-sm muted">Loading…</div>;
  const { project, competitors, latest, series, growth } = data;

  // v1.1.32: human label for the active region scope. Surfaced on the
  // Full-Report PDF cover page so the print is self-describing months later.
  const regionLabel = region === "us" ? "United States" : region === "ca" ? "Canada" : "United States + Canada";

  return (
    <div className="space-y-8" data-aio-report-root="true">
      <ProjectHeader
        project={project}
        onSaved={load}
        onRefresh={onRefresh}
        refreshing={refreshing}
        region={region}
        onRegionChange={setRegion}
        regionLabel={regionLabel}
        latestMetrics={latest}
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

      {/* v1.1.37: live refresh progress. Shown whenever we have a polled
          snapshot object — covers both the actively-running case and the
          recently-completed/failed case so the final counts stay visible. */}
      {refreshProgress && (
        <RefreshProgress
          data={refreshProgress}
          // v1.1.45: dismiss button on the progress strip. Clearing
          // refreshProgress hides the bar immediately (no waiting for the
          // 10-min freshness window). The button only renders for terminal
          // statuses so an in-flight refresh can't accidentally be hidden.
          onDismiss={() => setRefreshProgress(null)}
        />
      )}

      {refreshMsg && <div className="text-sm muted">{refreshMsg}</div>}

      {/* v1.1.29: silent-refresh indicator. Appears when a refetch is in flight
          on top of already-rendered data (e.g. user toggled scope). Sits high
          enough to be acknowledged but doesn't reflow the layout, so the
          user's scroll position is preserved through the toggle. */}
      {loading && (
        <div
          aria-live="polite"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "5px 11px",
            borderRadius: 999,
            background: "rgba(37,224,206,0.10)",
            border: "1px solid rgba(37,224,206,0.35)",
            fontSize: 12,
            color: "#25e0ce",
            fontWeight: 500,
            width: "fit-content",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 9, height: 9, borderRadius: "50%",
              background: "#25e0ce",
              animation: "aio-pulse 1.2s ease-in-out infinite",
              display: "inline-block",
            }}
          ></span>
          Updating…
          <style>{`@keyframes aio-pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.3 } }`}</style>
        </div>
      )}

      {/* v1.1.28: the scope toggle was moved out of this top area and embedded
          inside StoryPanel, sitting directly above the pulse-card strip — it
          was getting lost up here, and pairing it with the metrics makes the
          cause/effect of toggling obvious. State stays in Dashboard so child
          panels (QuickWinsPanel, KeywordExplorer) still get a single source. */}

      {/* Inputs grouped together — all "things to configure before running a refresh"
          sit at the top, all results (Story, charts, clusters, drilldown) sit below. */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <CompetitorPanel
          projectId={projectId}
          competitors={competitors}
          onChanged={load}
          suggested={suggestedCompetitors}
          onSuggestionAdded={(domain) => persistSuggestions(suggestedCompetitors.filter((c) => c.domain !== domain))}
          onSuggestionDismissed={(domain) => persistSuggestions(suggestedCompetitors.filter((c) => c.domain !== domain))}
        />
        <KeywordPanel projectId={projectId} onChanged={load} refreshing={refreshing} />
      </section>

      <FirstRefreshBanner
        keywordsCount={data.keywords_count ?? 0}
        region={region}
        refreshing={refreshing}
        hasSnapshots={(data.snapshots ?? []).some((s: any) => s.status === "complete")}
        onRefresh={onRefresh}
      />

      <StoryPanel
        project={project}
        latest={latest}
        growth={growth}
        region={region}
        kindFilter={kindFilter}
        onKindFilterChange={setKindFilter}
      />

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
            {(() => {
              // v1.1.22: visible filter feedback. With only 2-3 snapshots, the
              // chart looks identical at most ranges so users think the filter
              // isn't working — make it obvious that the count IS reactive.
              const filteredCount = filterByDateRange(series, range).length;
              const totalCount = series.length;
              const inRange = filteredCount === totalCount
                ? `${totalCount} snapshot${totalCount === 1 ? "" : "s"} (all in range)`
                : `${filteredCount} of ${totalCount} snapshot${totalCount === 1 ? "" : "s"} in selected range`;
              return (
                <p className="text-xs muted mt-0.5">
                  {inRange} · timeline applies to both charts
                  {filteredCount === 0 && totalCount > 0 && (
                    <span style={{ color: "#ff6464", marginLeft: 8 }}>
                      ← no data in this window, try a wider range or click <strong>All time</strong>
                    </span>
                  )}
                </p>
              );
            })()}
          </div>
          <PeriodSelector value={range} onChange={setRange} />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="surface-2 p-4">
            <div className="text-sm font-semibold">AIOs triggered</div>
            <p className="text-xs muted mb-2">How often Google is surfacing an AIO across tracked queries — market volume, not brand-specific.</p>
            <GrowthChart series={series} range={range} />
          </div>
          <div className="surface-2 p-4">
            {/* v1.1.42: renamed from "Acquisition rate" — the prior name was
                vague and didn't make clear this is the time-series view of
                the same "Your position" number in the executive summary.
                Caption now also calls out that each plotted point corresponds
                to one refresh snapshot, not a fixed daily/weekly cadence. */}
            <div className="text-sm font-semibold">Your position over time</div>
            <p className="text-xs muted mb-2">
              Citation rate per refresh snapshot — {project.brand_name} (blue) vs tracked competitors. Each point = one refresh.
            </p>
            <AcquisitionChart series={series} range={range} project={project} />
          </div>
        </div>
      </section>

      <section className="surface p-5">
        <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
          <div>
            <h2 className="h2">Topic clusters</h2>
            <p className="text-xs muted mt-0.5">Keywords grouped by intent. Click any cluster to filter AIO Opportunities &amp; Drilldown to that topic.</p>
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
          projectId={projectId}
          onChanged={load}
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
            <span style={{ color: "#5a6478" }}>· AIO Opportunities &amp; Drilldown below are filtered</span>
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
            <h2 className="h2" style={{ display: "inline-flex", alignItems: "center" }}>
              AIO Opportunities
              <InfoTooltip
                label="AIO Opportunities"
                accent="#b6f53b"
                body={
                  <div>
                    <p style={{ margin: "0 0 8px" }}>
                      Keywords where Google is showing an AI Overview today but your client is <strong style={{ color: "#f4f6fb" }}>not</strong> cited. The gap you can attack.
                    </p>
                    <div style={{ fontSize: 10, color: "#b6f53b", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", margin: "10px 0 4px" }}>Priority Score formula</div>
                    <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 12, lineHeight: 1.6 }}>
                      <li><strong style={{ color: "#f4f6fb" }}>+50</strong> base — AIO triggered, client uncited (the gap itself)</li>
                      <li><strong style={{ color: "#f4f6fb" }}>+30</strong> client already ranks organic for this keyword</li>
                      <li><strong style={{ color: "#f4f6fb" }}>+20</strong> a tracked brand ranks for it (territory is owned)</li>
                      <li><strong style={{ color: "#f4f6fb" }}>+15</strong> a tracked competitor is cited (winnability proof)</li>
                      <li><strong style={{ color: "#f4f6fb" }}>+10</strong> client mentioned in AIO text but not linked</li>
                      <li><strong style={{ color: "#f4f6fb" }}>+5</strong> AIO has 4+ citation slots (more shots on goal)</li>
                    </ul>
                    <p style={{ margin: "10px 0 0", color: "#8a93a6" }}>
                      Higher score = more winnable. The chips in the <strong style={{ color: "#f4f6fb" }}>Why</strong> column show which bonuses applied — the score is never a black box.
                    </p>
                  </div>
                }
              />
            </h2>
            <p className="text-xs muted mt-0.5">Gettable AIO citations ranked by priority score — start here.</p>
          </div>
        </div>
        <QuickWinsPanel
          projectId={projectId}
          region={region}
          clientBrand={project.brand_name}
          clusterFilter={clusterFilter}
          onClusterFilterChange={setClusterFilter}
          kindFilter={kindFilter}
          refreshNonce={refreshNonce}
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
          kindFilter={kindFilter}
          refreshNonce={refreshNonce}
        />
      </section>

      <section className="surface p-5">
        <h2 className="h2 mb-3">Brand comparison</h2>
        <CompetitorTable latest={latest} />
      </section>

      <section className="surface p-5" id="section-other-domains">
        <h2 className="h2 mb-3">Other domains in AIOs</h2>
        <OtherDomainsTabs latest={latest} />
      </section>
    </div>
  );
}

// v1.1.28: BrandedToggle moved into StoryPanel.tsx so it lives directly above
// the pulse-card strip. State still lives in Dashboard (passed down as a
// controlled prop) so QuickWinsPanel + KeywordExplorer read the same value.
