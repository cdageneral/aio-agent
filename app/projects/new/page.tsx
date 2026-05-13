"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import RegionSelector, { RegionMode, regionsForMode } from "@/components/RegionSelector";
import { primaryBtnStyle, ghostBtnStyle, accentBtnStyle } from "@/components/uiStyles";
import { fetchJson } from "@/lib/fetch-json";
import type { SuggestedCompetitor } from "@/components/SmartSegmentDetector";

/**
 * Two-step new-project wizard.
 *
 * Step 1 (input): client URL + brand + aliases + region. Submit runs
 *   detection BEFORE the project is created so the user can review and
 *   trim suggestions on Step 2.
 *
 * Detecting: spinner while POST /api/detect-segment runs against the URL.
 *
 * Step 2 (review): show the detected segment, region hint, suggested
 *   competitors (checkbox list, all checked by default), and suggested
 *   seed keywords (deletable chip list). User can uncheck any competitor,
 *   prune seeds, or skip detection entirely. Submit creates the project,
 *   adds every CHECKED competitor as a tracked brand, and navigates to
 *   the dashboard with everything in place so the first refresh covers
 *   all brands in a single SerpAPI pass.
 */

type Phase = "input" | "detecting" | "review";

interface DetectionResult {
  industry: string;
  category: string;
  subcategory: string;
  primary_product: string;
  region_hint: "us" | "ca" | "both" | "unknown";
  confidence: "high" | "medium" | "low";
  seed_keywords: string[];
  competitors: SuggestedCompetitor[];
}

export default function NewProjectPage() {
  const router = useRouter();

  // ── Step 1 state ──────────────────────────────────────────────────────
  const [clientUrl, setClientUrl] = useState("");
  const [brand, setBrand] = useState("");
  const [aliases, setAliases] = useState("");
  const [region, setRegion] = useState<RegionMode>("us");

  // ── Wizard state ──────────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>("input");
  const [err, setErr] = useState<string | null>(null);
  const [detection, setDetection] = useState<DetectionResult | null>(null);

  // ── Step 2 editable state ────────────────────────────────────────────
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [seeds, setSeeds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Step 1 → detection
  async function onDetect(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setPhase("detecting");
    try {
      const r = await fetch("/api/detect-segment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: clientUrl }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        throw new Error(j.error || "Detection failed");
      }
      const result: DetectionResult = j.result;
      setDetection(result);
      // Default-checked: every suggested competitor with a domain.
      const initialChecked: Record<string, boolean> = {};
      for (const c of result.competitors ?? []) {
        if (c.domain) initialChecked[c.domain] = true;
      }
      setChecked(initialChecked);
      setSeeds(result.seed_keywords ?? []);
      // If the detector suggested a region different from the selected one,
      // and the selected one is the default "us", switch quietly.
      if (result.region_hint && result.region_hint !== "unknown" && region === "us") {
        setRegion(result.region_hint);
      }
      setPhase("review");
    } catch (e: any) {
      setErr(e.message || "Detection failed");
      setPhase("input");
    }
  }

  // Skip detection → just create the project bare-bones (legacy path)
  async function onSkipDetection() {
    setErr(null);
    setSubmitting(true);
    const r = await fetchJson<{ project: { id: string } }>("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_url: clientUrl,
        brand_name: brand,
        brand_aliases: aliases.split(",").map((s) => s.trim()).filter(Boolean),
        regions: regionsForMode(region),
      }),
    });
    if (!r.ok || !r.data?.project) {
      setErr(r.error ?? "Failed to create project");
      setSubmitting(false);
      return;
    }
    router.push(`/projects/${r.data.project.id}`);
  }

  // Step 2 → create project + add checked competitors
  async function onCreateProject() {
    if (!detection) return;
    setErr(null);
    setSubmitting(true);

    // Create the project with detection-derived fields baked in.
    const createRes = await fetchJson<{ project: { id: string } }>("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_url: clientUrl,
        brand_name: brand,
        brand_aliases: aliases.split(",").map((s) => s.trim()).filter(Boolean),
        regions: regionsForMode(region),
        segment_l1: detection.industry || null,
        segment_l2: detection.category || null,
        segment_l3: detection.subcategory || null,
        primary_product: detection.primary_product || null,
        detection_confidence: detection.confidence,
        custom_seed_keywords: seeds,
      }),
    });

    if (!createRes.ok || !createRes.data?.project) {
      setErr(createRes.error ?? "Failed to create project");
      setSubmitting(false);
      return;
    }
    const projectId = createRes.data.project.id;

    // Iterate every checked competitor and add it. We swallow individual
    // failures so a single bad domain doesn't block landing on the dashboard.
    const toAdd = (detection.competitors ?? []).filter((c) => c.domain && checked[c.domain]);
    const failures: string[] = [];
    for (const c of toAdd) {
      try {
        const res = await fetch(`/api/projects/${projectId}/competitors`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            url: c.domain.startsWith("http") ? c.domain : `https://${c.domain}`,
            brand_name: c.name,
          }),
        });
        if (!res.ok) failures.push(c.domain);
      } catch {
        failures.push(c.domain);
      }
    }

    // Even with partial failures, land on the dashboard. The CompetitorPanel
    // there still allows manual adds. We could surface a toast, but for now
    // we'll log and proceed silently — the user will see which made it in.
    if (failures.length > 0) {
      console.warn("Some competitors failed to add:", failures);
    }
    router.push(`/projects/${projectId}`);
  }

  function toggle(domain: string) {
    setChecked((prev) => ({ ...prev, [domain]: !prev[domain] }));
  }

  function removeSeed(k: string) {
    setSeeds((prev) => prev.filter((s) => s !== k));
  }

  const checkedCount = Object.values(checked).filter(Boolean).length;

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-semibold tracking-tight">New project</h1>
      <p className="text-sm muted mt-1">
        {phase === "review"
          ? "Review what Claude detected. Anything checked here is set up before the first refresh — one SerpAPI pass covers your brand and competitors."
          : "Enter the client's website and the region they sell in. We'll auto-detect their market segment, suggest seed keywords, and propose competitors next."}
      </p>

      {/* Step indicator */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 18, fontSize: 11, color: "#8a93a6", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>
        <StepDot active={phase === "input" || phase === "detecting"} done={phase === "review"} label="1 · Brand basics" />
        <span style={{ flex: "0 0 24px", height: 1, background: "rgba(255,255,255,0.10)" }} />
        <StepDot active={phase === "review"} done={false} label={phase === "detecting" ? "2 · Detecting…" : "2 · Review & confirm"} />
      </div>

      {err && (
        <div style={{ marginTop: 14, padding: "10px 12px", borderRadius: 10, background: "rgba(255,100,100,0.08)", border: "1px solid rgba(255,100,100,0.25)", color: "#ff6464", fontSize: 13 }}>
          {err}
        </div>
      )}

      {/* ─── STEP 1 ──────────────────────────────────────────────────── */}
      {phase === "input" && (
        <form onSubmit={onDetect} className="surface p-6 mt-6 space-y-5">
          <div>
            <label className="label">Client website</label>
            <input
              className="input text-base font-semibold"
              placeholder="https://www.yourdomain.com"
              value={clientUrl}
              onChange={(e) => setClientUrl(e.target.value)}
              required
              style={{ fontSize: 15 }}
            />
            <p className="text-xs muted mt-1">
              We'll read this URL with Claude to figure out what they sell. No login required, no taxonomy pick-list to navigate.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Brand name</label>
              <input
                className="input"
                placeholder="Your brand name"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label">Brand aliases (optional, comma-separated)</label>
              <input
                className="input"
                placeholder="Your Brand Inc., Your Brand Co."
                value={aliases}
                onChange={(e) => setAliases(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="label">Region</label>
            <RegionSelector value={region} onChange={setRegion} />
            <p className="text-xs muted mt-2">US, Canada, or both. The smart detector will also suggest a region from the website content; you can override on the next step.</p>
          </div>

          <div className="flex justify-between items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={onSkipDetection}
              disabled={submitting || !clientUrl || !brand}
              style={ghostBtnStyle()}
              title="Create the project without detection — you can detect later from the dashboard"
            >
              Skip detection
            </button>
            <button type="submit" style={accentBtnStyle(false)}>
              <i className="ti ti-wand" style={{ fontSize: 14 }} aria-hidden="true"></i>
              Detect &amp; continue →
            </button>
          </div>
        </form>
      )}

      {/* ─── DETECTING ──────────────────────────────────────────────── */}
      {phase === "detecting" && (
        <div className="surface p-10 mt-6" style={{ textAlign: "center" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 10, fontSize: 14, color: "#d6dbe6" }}>
            <i className="ti ti-loader-2" style={{ fontSize: 18, animation: "spin 0.8s linear infinite" }} aria-hidden="true"></i>
            Reading {hostnameFrom(clientUrl)} with Claude…
          </div>
          <p className="text-xs muted mt-3">Detecting segment, seed keywords, and competitor brands.</p>
        </div>
      )}

      {/* ─── STEP 2 ─────────────────────────────────────────────────── */}
      {phase === "review" && detection && (
        <div className="space-y-4 mt-6">
          {/* Segment card */}
          <div className="surface p-5">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 10, color: "#4f8cff", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>Detected segment</span>
              <ConfidenceChip level={detection.confidence} />
              {detection.region_hint !== "unknown" && (
                <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 999, background: "rgba(255,184,70,0.16)", color: "#ffb846", fontWeight: 700, letterSpacing: "0.04em" }}>
                  region · {detection.region_hint.toUpperCase()}
                </span>
              )}
            </div>
            <div style={{ fontSize: 17, fontWeight: 600, color: "#f4f6fb" }}>
              {detection.industry} › {detection.category} › <span style={{ color: "#b6f53b" }}>{detection.subcategory}</span>
            </div>
            {detection.primary_product && (
              <div style={{ fontSize: 13, color: "#8a93a6", marginTop: 4 }}>{detection.primary_product}</div>
            )}
          </div>

          {/* Competitors */}
          <div className="surface p-5">
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#f4f6fb" }}>
                  Tracked competitors
                  {detection.competitors.length > 0 && (
                    <span style={{ color: "#8a93a6", fontWeight: 400, marginLeft: 6 }}>
                      ({checkedCount} of {detection.competitors.length} selected)
                    </span>
                  )}
                </div>
                <div className="text-xs muted mt-0.5">
                  These get added to the project so your first refresh covers your brand and competitors in one pass.
                </div>
              </div>
              {detection.competitors.length > 1 && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => {
                      const next: Record<string, boolean> = {};
                      for (const c of detection.competitors) if (c.domain) next[c.domain] = true;
                      setChecked(next);
                    }}
                    style={{ fontSize: 11, padding: "4px 10px", borderRadius: 7, background: "transparent", color: "#8a93a6", border: "1px solid rgba(255,255,255,0.10)", cursor: "pointer" }}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={() => setChecked({})}
                    style={{ fontSize: 11, padding: "4px 10px", borderRadius: 7, background: "transparent", color: "#8a93a6", border: "1px solid rgba(255,255,255,0.10)", cursor: "pointer" }}
                  >
                    Select none
                  </button>
                </div>
              )}
            </div>

            {detection.competitors.length === 0 ? (
              <div className="text-sm muted" style={{ padding: "12px 0" }}>
                Claude didn't suggest any competitors for this domain. You can add competitors manually from the dashboard after creation.
              </div>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                {detection.competitors.map((c) => {
                  const isChecked = !!checked[c.domain];
                  return (
                    <li
                      key={c.domain || c.name}
                      onClick={() => c.domain && toggle(c.domain)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "10px 12px",
                        borderRadius: 9,
                        background: isChecked ? "rgba(79,140,255,0.08)" : "#11151d",
                        border: isChecked ? "1px solid rgba(79,140,255,0.35)" : "1px solid rgba(255,255,255,0.06)",
                        cursor: c.domain ? "pointer" : "default",
                        transition: "background 100ms ease, border-color 100ms ease",
                      }}
                    >
                      <div style={{
                        width: 18, height: 18, borderRadius: 5,
                        background: isChecked ? "#4f8cff" : "transparent",
                        border: isChecked ? "1px solid #4f8cff" : "1px solid rgba(255,255,255,0.20)",
                        display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                      }}>
                        {isChecked && <i className="ti ti-check" style={{ fontSize: 12, color: "#06070b", fontWeight: 700 }} aria-hidden="true"></i>}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: "#f4f6fb", display: "inline-flex", alignItems: "center", gap: 5 }}>
                          {c.verified && (
                            <i className="ti ti-rosette-discount-check" style={{ fontSize: 14, color: "#b6f53b" }} aria-hidden="true" title="Domain verified — site is reachable"></i>
                          )}
                          {c.name}
                        </div>
                        <div style={{ fontSize: 11.5, color: "#8a93a6", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.domain}</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Seed keywords */}
          <div className="surface p-5">
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#f4f6fb" }}>
                  Seed keywords
                  <span style={{ color: "#8a93a6", fontWeight: 400, marginLeft: 6 }}>({seeds.length})</span>
                </div>
                <div className="text-xs muted mt-0.5">
                  Starter queries for the keyword universe. You can add more from the dashboard later — these get you to a first refresh quickly.
                </div>
              </div>
            </div>
            {seeds.length === 0 ? (
              <div className="text-sm muted" style={{ padding: "8px 0" }}>
                No seed keywords suggested. You'll add them manually from the dashboard.
              </div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {seeds.map((k) => (
                  <span
                    key={k}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      fontSize: 11.5, padding: "4px 10px", borderRadius: 999,
                      background: "rgba(255,255,255,0.05)", color: "#d6dbe6",
                      border: "1px solid rgba(255,255,255,0.07)",
                    }}
                  >
                    {k}
                    <button
                      onClick={() => removeSeed(k)}
                      aria-label={`Remove ${k}`}
                      title={`Remove ${k}`}
                      style={{
                        background: "transparent", border: "none", padding: 0,
                        color: "#5a6478", cursor: "pointer", display: "inline-flex",
                        alignItems: "center", lineHeight: 1,
                      }}
                    >
                      <i className="ti ti-x" style={{ fontSize: 11 }} aria-hidden="true"></i>
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Region — let the user override if they want */}
          <div className="surface p-5">
            <label className="label">Region</label>
            <RegionSelector value={region} onChange={setRegion} />
            <p className="text-xs muted mt-2">
              {detection.region_hint !== "unknown" && (
                <>Smart detector suggested <strong style={{ color: "#ffb846" }}>{detection.region_hint.toUpperCase()}</strong>. </>
              )}
              You can change this any time from the dashboard.
            </p>
          </div>

          {/* Actions */}
          <div className="flex justify-between items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => { setPhase("input"); setDetection(null); }}
              style={ghostBtnStyle()}
              disabled={submitting}
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={onCreateProject}
              disabled={submitting}
              style={primaryBtnStyle(submitting)}
            >
              {submitting
                ? "Creating…"
                : checkedCount > 0
                ? `Create project with ${checkedCount} competitor${checkedCount === 1 ? "" : "s"} →`
                : "Create project →"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StepDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  const color = done ? "#b6f53b" : active ? "#4f8cff" : "#5a6478";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color, fontWeight: 700 }}>
      <span style={{
        width: 8, height: 8, borderRadius: "50%",
        background: color,
        opacity: active || done ? 1 : 0.5,
      }} />
      {label}
    </span>
  );
}

function ConfidenceChip({ level }: { level: "high" | "medium" | "low" }) {
  const cfg = {
    high: { bg: "rgba(182,245,59,0.16)", color: "#b6f53b" },
    medium: { bg: "rgba(255,184,70,0.14)", color: "#ffb846" },
    low: { bg: "rgba(255,100,100,0.14)", color: "#ff6464" },
  }[level];
  return (
    <span style={{ fontSize: 9.5, padding: "2px 8px", borderRadius: 999, background: cfg.bg, color: cfg.color, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>
      {level} confidence
    </span>
  );
}

function hostnameFrom(url: string): string {
  try { return new URL(url.startsWith("http") ? url : `https://${url}`).hostname; }
  catch { return url; }
}
