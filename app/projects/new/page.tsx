"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import RegionSelector, { RegionMode, regionsForMode } from "@/components/RegionSelector";
import { primaryBtnStyle } from "@/components/uiStyles";
import { fetchJson } from "@/lib/fetch-json";

/**
 * New project wizard, post-taxonomy. Minimal inputs: URL + brand + region.
 * The market segment is auto-detected on the dashboard via SmartSegmentDetector
 * once the project exists.
 */
export default function NewProjectPage() {
  const router = useRouter();
  const [clientUrl, setClientUrl] = useState("");
  const [brand, setBrand] = useState("");
  const [aliases, setAliases] = useState("");
  const [region, setRegion] = useState<RegionMode>("us");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErr(null);
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
        Enter the client's website and the region they sell in. We'll auto-detect their market segment, suggest seed keywords, and propose competitors on the dashboard.
      </p>

      <form onSubmit={onSubmit} className="surface p-6 mt-6 space-y-5">
        <div>
          <label className="label">Client website</label>
          <input
            className="input text-base font-semibold"
            placeholder="https://chip.ca"
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
              placeholder="CHIP"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">Brand aliases (optional, comma-separated)</label>
            <input
              className="input"
              placeholder="CHIP Reverse Mortgage, HomeEquity Bank"
              value={aliases}
              onChange={(e) => setAliases(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="label">Region</label>
          <RegionSelector value={region} onChange={setRegion} />
          <p className="text-xs muted mt-2">US, Canada, or both. The smart detector will also suggest a region from the website content, which you can override.</p>
        </div>

        {err && <div className="text-sm" style={{ color: "#ff6464" }}>{err}</div>}
        <div className="flex justify-end">
          <button style={primaryBtnStyle(submitting)} disabled={submitting}>
            {submitting ? "Creating…" : "Create & detect segment →"}
          </button>
        </div>
      </form>
    </div>
  );
}
