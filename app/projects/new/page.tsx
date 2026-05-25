"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import RegionSelector, { RegionMode, regionsForMode } from "@/components/RegionSelector";
import { primaryBtnStyle } from "@/components/uiStyles";
import { fetchJson } from "@/lib/fetch-json";

/**
 * Single-step new-project form.
 *
 * v1.1.66: the previous two-step "detect → review → create" wizard was
 * removed at user request. The auto-detection step (POST /api/detect-segment)
 * was being skipped in practice — when it ran it inferred segment / region
 * hint / suggested competitors / seed keywords from the website homepage,
 * which sounded useful but was rarely accurate enough to act on without
 * editing. Users would either skip detection entirely or accept the
 * detection then immediately rework the suggestions on the dashboard. The
 * detector also added 15-30s of latency to project creation and burned
 * Anthropic tokens on output the user usually discarded. We're keeping the
 * /api/detect-segment route and the SmartSegmentDetector component on disk
 * (dead code) so re-enabling is a one-import change if the detection
 * quality ever improves; for now, project creation collects the same
 * minimal inputs the old "Skip detection" path did and goes straight to
 * the dashboard.
 *
 * Form: client URL + brand + aliases + region → create project → redirect
 * to dashboard. Tracked competitors and keywords are added from the
 * dashboard panels after creation.
 */
export default function NewProjectPage() {
  const router = useRouter();

  const [clientUrl, setClientUrl] = useState("");
  const [brand, setBrand] = useState("");
  const [aliases, setAliases] = useState("");
  const [region, setRegion] = useState<RegionMode>("us");

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
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

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-semibold tracking-tight">New project</h1>
      <p className="text-sm muted mt-1">
        Enter the client's website, brand name, and the region they sell in. You'll add tracked competitors and seed keywords from the dashboard after the project is created.
      </p>

      {err && (
        <div style={{ marginTop: 14, padding: "10px 12px", borderRadius: 10, background: "rgba(255,100,100,0.08)", border: "1px solid rgba(255,100,100,0.25)", color: "#ff6464", fontSize: 13 }}>
          {err}
        </div>
      )}

      <form onSubmit={onCreate} className="surface p-6 mt-6 space-y-5">
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
          <p className="text-xs muted mt-2">US, Canada, or both. You can change this later from the dashboard.</p>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting || !clientUrl || !brand}
            style={primaryBtnStyle(submitting)}
          >
            {submitting ? "Creating…" : "Create project →"}
          </button>
        </div>
      </form>
    </div>
  );
}
