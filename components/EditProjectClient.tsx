"use client";
/**
 * v1.1.63: Edit Project client page. Consolidates all project configuration
 * that previously lived scattered across the dashboard top section:
 *   - ProjectHeader  (client URL, brand name, region, smart segment detector)
 *   - CompetitorPanel (tracked competitors + suggested competitors)
 *   - KeywordPanel    (keyword universe management)
 *
 * Accessed via the "Edit Project" button in the global header, which links to
 * /projects/[id]/edit. A "← Back to dashboard" breadcrumb returns the user.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import ProjectHeader from "./ProjectHeader";
import CompetitorPanel from "./CompetitorPanel";
import KeywordPanel from "./KeywordPanel";
import RegionSelector, { RegionMode, regionsForMode } from "./RegionSelector";
import type { SuggestedCompetitor } from "./SmartSegmentDetector";

interface MetricsPayload {
  project: any;
  competitors: any[];
  regions_in_view: string[];
}

function defaultMode(regions: string[] | undefined): RegionMode {
  const set = new Set((regions ?? ["us"]).map((r) => r.toLowerCase()));
  if (set.has("us") && set.has("ca")) return "both";
  if (set.has("ca")) return "ca";
  return "us";
}

export default function EditProjectClient({ projectId }: { projectId: string }) {
  const [data, setData] = useState<MetricsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [region, setRegion] = useState<RegionMode>("us");
  const didInferRef = useState(false);
  const [suggestedCompetitors, setSuggestedCompetitors] = useState<SuggestedCompetitor[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ region: regionsForMode(region).join(",") });
    const res = await fetch(`/api/projects/${projectId}/metrics?${params.toString()}`, { cache: "no-store" });
    const j = await res.json();
    setData(j);
    if (!didInferRef[0] && j?.project?.regions) {
      (didInferRef as any)[0] = true;
      const inferred = defaultMode(j.project.regions);
      if (inferred !== region) setRegion(inferred);
    }
    if (Array.isArray(j?.project?.suggested_competitors)) {
      setSuggestedCompetitors(j.project.suggested_competitors);
    }
    setLoading(false);
  }, [projectId, region]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  async function persistSuggestions(next: SuggestedCompetitor[]) {
    setSuggestedCompetitors(next);
    try {
      await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ suggested_competitors: next }),
      });
    } catch { /* non-fatal */ }
  }

  async function applySeedKeywords(seeds: string[]) {
    if (!seeds.length) return;
    await fetch(`/api/projects/${projectId}/keywords`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: "manual", keywords: seeds }),
    });
    await load();
  }

  const project = data?.project;
  const competitors = data?.competitors ?? [];

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      {/* Breadcrumb */}
      <div style={{ marginBottom: 24, display: "flex", alignItems: "center", gap: 8 }}>
        <Link
          href={`/projects/${projectId}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            color: "var(--muted)",
            textDecoration: "none",
            padding: "5px 0",
            transition: "color 0.12s",
          }}
          className="muted hover:text-white transition"
        >
          <i className="ti ti-arrow-left" style={{ fontSize: 14 }} aria-hidden="true" />
          Back to dashboard
        </Link>
        <span style={{ color: "var(--muted)", fontSize: 13 }}>·</span>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>
          {project?.brand_name ?? "Edit Project"}
        </span>
      </div>

      <h1
        style={{
          fontSize: 20,
          fontWeight: 600,
          color: "var(--fg)",
          marginBottom: 6,
          letterSpacing: "-0.2px",
        }}
      >
        Edit Project
      </h1>
      <p className="text-sm muted" style={{ marginBottom: 28 }}>
        Update your client details, tracked competitors, and keyword universe.
      </p>

      {loading && !data && (
        <div className="text-sm muted">Loading…</div>
      )}

      {project && (
        <div className="space-y-6">
          {/* Project basics + region + segment detector */}
          <ProjectHeader
            project={project}
            onSaved={load}
            region={region}
            onRegionChange={setRegion}
            onCompetitorsSuggested={(c) => {
              const trackedDomains = new Set<string>(competitors.map((x: any) => (x.domain ?? "").toLowerCase()));
              const existingDomains = new Set(suggestedCompetitors.map((x) => x.domain.toLowerCase()));
              const fresh = c.filter(
                (x) => x.domain && !trackedDomains.has(x.domain.toLowerCase()) && !existingDomains.has(x.domain.toLowerCase()),
              );
              if (fresh.length === 0) return;
              persistSuggestions([...suggestedCompetitors, ...fresh]);
            }}
            onSeedKeywordsApplied={applySeedKeywords}
          />

          {/* Competitor management */}
          <CompetitorPanel
            projectId={projectId}
            competitors={competitors}
            onChanged={load}
            suggested={suggestedCompetitors}
            onSuggestionAdded={(domain) =>
              persistSuggestions(suggestedCompetitors.filter((c) => c.domain !== domain))
            }
            onSuggestionDismissed={(domain) =>
              persistSuggestions(suggestedCompetitors.filter((c) => c.domain !== domain))
            }
          />

          {/* Keyword universe */}
          <KeywordPanel projectId={projectId} onChanged={load} refreshing={false} />
        </div>
      )}
    </div>
  );
}
