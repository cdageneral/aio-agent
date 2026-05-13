"use client";
import { useEffect, useState } from "react";
import { primaryBtnStyle } from "./uiStyles";

type ClusterSummary = { name: string; description: string; count: number };

type Keyword = { id: string; keyword: string; source: string };

export default function KeywordPanel({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [max, setMax] = useState(500);
  const [tab, setTab] = useState<"manual" | "organic" | "market" | "seed">("manual");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [clustering, setClustering] = useState(false);
  const [lastClusterSummary, setLastClusterSummary] = useState<ClusterSummary[] | null>(null);

  // form state per tab
  const [manualText, setManualText] = useState("");
  const [seedText, setSeedText] = useState("");

  async function load() {
    const res = await fetch(`/api/projects/${projectId}/keywords`);
    const j = await res.json();
    setKeywords(j.keywords ?? []);
    setMax(j.max ?? 500);
  }
  useEffect(() => { load(); }, [projectId]);

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      let body: any = { method: tab };
      if (tab === "manual") {
        body.keywords = manualText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
      } else if (tab === "seed") {
        body.seeds = seedText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
      } else if (tab === "organic" || tab === "market") {
        body.seedKeywords = seedText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
      }
      const res = await fetch(`/api/projects/${projectId}/keywords`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed");
      setMsg(`Added ${j.added} keyword(s).`);
      setManualText(""); setSeedText("");
      await load();
      onChanged();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadCsv(file: File) {
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("method", "manual");
      const res = await fetch(`/api/projects/${projectId}/keywords`, { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed");
      setMsg(`Added ${j.added} keyword(s) from CSV.`);
      await load();
      onChanged();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadVolumes(file: File) {
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch(`/api/projects/${projectId}/keywords/volumes`, { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed");
      setMsg(`Volume set on ${j.updated} keyword(s).`);
      await load();
      onChanged();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await fetch(`/api/projects/${projectId}/keywords?keyword_id=${id}`, { method: "DELETE" });
    await load();
    onChanged();
  }

  async function runClustering() {
    if (keywords.length === 0) return;
    setClustering(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/cluster-keywords`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Clustering failed");
      setLastClusterSummary(j.clusters ?? null);
      setMsg(`Clustered ${j.assigned} keyword${j.assigned === 1 ? "" : "s"} into ${j.clusters?.length ?? 0} topic group${(j.clusters?.length ?? 0) === 1 ? "" : "s"}.`);
      onChanged();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setClustering(false);
    }
  }

  const usage = keywords.length;
  const sourcesCount = keywords.reduce<Record<string, number>>((acc, k) => {
    acc[k.source] = (acc[k.source] ?? 0) + 1;
    return acc;
  }, {});

  const tabBtn = (k: typeof tab, label: string) => (
    <button
      onClick={() => setTab(k)}
      className="text-xs px-2.5 py-1 rounded-md"
      style={tab === k
        ? { background: "var(--accent-blue-soft)", color: "var(--accent-blue)", border: "1px solid var(--accent-blue)" }
        : { background: "var(--surface-2)", color: "var(--muted)", border: "1px solid var(--line)" }}
    >
      {label}
    </button>
  );

  return (
    <div className="surface p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="h2">Keyword universe</h2>
        <div className="text-xs muted">{usage} / {max} keywords</div>
      </div>
      <div className="text-xs mt-1 space-x-2">
        {Object.entries(sourcesCount).map(([k, v]) => <span key={k} className="tag">{k}: {v}</span>)}
      </div>

      {/* Cluster trigger — separates the "manage keywords" surface from the
          "analyze them" surface. Disabled when there's nothing to cluster. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10, padding: "8px 11px", borderRadius: 9, background: "rgba(168,120,255,0.06)", border: "1px solid rgba(168,120,255,0.20)" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#a878ff", letterSpacing: "0.05em", textTransform: "uppercase", display: "inline-flex", alignItems: "center", gap: 5 }}>
            <i className="ti ti-layers-subtract" style={{ fontSize: 12 }} aria-hidden="true"></i>Topic clustering
          </div>
          <div style={{ fontSize: 11, color: "#8a93a6", marginTop: 2 }}>
            Group keywords into 5-8 topic buckets so you can see which topics you're winning vs losing.
          </div>
        </div>
        <button
          onClick={runClustering}
          disabled={clustering || keywords.length === 0}
          style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "6px 11px", borderRadius: 8,
            background: clustering || keywords.length === 0 ? "rgba(168,120,255,0.18)" : "#a878ff",
            color: "#06070b", fontSize: 12, fontWeight: 600, border: "none",
            cursor: clustering || keywords.length === 0 ? "not-allowed" : "pointer", whiteSpace: "nowrap",
          }}
        >
          <i className={`ti ${clustering ? "ti-loader-2" : "ti-wand"}`} style={{ fontSize: 13 }} aria-hidden="true"></i>
          {clustering ? "Clustering…" : "Cluster keywords"}
        </button>
      </div>
      {lastClusterSummary && lastClusterSummary.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 11, color: "#8a93a6" }}>
          Last run: {lastClusterSummary.map((c) => `${c.name} (${c.count})`).join(" · ")}
        </div>
      )}

      <div className="flex gap-2 mt-4 flex-wrap">
        {tabBtn("manual", "Manual / CSV")}
        {tabBtn("organic", "Pull from client organic")}
        {tabBtn("market", "Shared market set")}
        {tabBtn("seed", "Seed → related")}
      </div>

      <div className="mt-3">
        {tab === "manual" && (
          <div className="space-y-2">
            <textarea
              className="input min-h-[100px]"
              placeholder="One keyword per line, or comma-separated."
              value={manualText}
              onChange={(e) => setManualText(e.target.value)}
            />
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-4">
                <label className="text-xs muted cursor-pointer hover:text-white transition">
                  <i className="ti ti-upload" style={{ fontSize: 12, marginRight: 4, verticalAlign: -1 }} aria-hidden="true"></i>
                  Upload keywords (CSV)
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadCsv(f); }}
                  />
                </label>
                <label className="text-xs cursor-pointer hover:text-white transition" style={{ color: "#ffb846" }}>
                  <i className="ti ti-chart-bar" style={{ fontSize: 12, marginRight: 4, verticalAlign: -1 }} aria-hidden="true"></i>
                  Upload volumes (CSV: keyword, monthly_volume)
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadVolumes(f); }}
                  />
                </label>
              </div>
              <button style={primaryBtnStyle(busy || !manualText.trim())} disabled={busy || !manualText.trim()} onClick={submit}>Add</button>
            </div>
          </div>
        )}
        {(tab === "organic" || tab === "market" || tab === "seed") && (
          <div className="space-y-2">
            <textarea
              className="input min-h-[100px]"
              placeholder={tab === "seed" ? "Seed keywords for related-search expansion." : "Seed keywords (we'll expand via related searches, then keep what matches)."}
              value={seedText}
              onChange={(e) => setSeedText(e.target.value)}
            />
            <div className="text-xs muted">
              {tab === "organic" && "Keeps only seeds/related where the client domain ranks top-100."}
              {tab === "market" && "Keeps seeds/related where any tracked brand (client + competitors) ranks top-100."}
              {tab === "seed" && "Stores related-search/PAA expansions as-is, no rank filter."}
            </div>
            <div className="flex justify-end">
              <button style={primaryBtnStyle(busy || !seedText.trim())} disabled={busy || !seedText.trim()} onClick={submit}>Discover</button>
            </div>
          </div>
        )}
      </div>

      {msg && <div className="mt-3 text-xs muted">{msg}</div>}

      {keywords.length > 0 && (
        <details className="mt-4">
          <summary className="text-xs muted cursor-pointer hover:text-white transition">View keywords ({keywords.length})</summary>
          <ul className="mt-2 max-h-60 overflow-auto text-sm" style={{ borderTop: "1px solid var(--line)" }}>
            {keywords.map((k) => (
              <li key={k.id} className="flex items-center justify-between py-1.5" style={{ borderBottom: "1px solid var(--line)" }}>
                <div className="truncate">
                  <span>{k.keyword}</span>
                  <span className="ml-2 tag">{k.source}</span>
                </div>
                <button className="text-xs" style={{ color: "var(--accent-red)" }} onClick={() => remove(k.id)}>remove</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
