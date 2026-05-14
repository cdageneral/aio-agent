"use client";
import { useEffect, useRef, useState } from "react";
import { primaryBtnStyle } from "./uiStyles";

type ClusterSummary = { name: string; description: string; count: number };

type Keyword = { id: string; keyword: string; source: string; cluster_label?: string | null };

export default function KeywordPanel({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [max, setMax] = useState(500);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [clustering, setClustering] = useState(false);
  const [lastClusterSummary, setLastClusterSummary] = useState<ClusterSummary[] | null>(null);

  // v1.1.7: only manual entry remains. The organic/market/seed expansion paths
  // were removed — smart detection on the project header populates seed
  // keywords automatically, and bulk paste / CSV covers everything else.
  const [manualText, setManualText] = useState("");

  // v1.1.5: inline edit state — track which keyword id is being edited and what
  // the in-flight text value is. Only one row is editable at a time.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  // v1.1.6: auto-clustering bookkeeping. We compare a signature of the current
  // keyword SET (sorted, lowercased) against the signature we last clustered.
  // This handles add / edit / delete uniformly — any of them produces a new
  // signature — and avoids spurious re-cluster loops when onChanged() causes
  // the parent to re-fetch and pass back a fresh-reference-but-same-content
  // keyword array.
  const lastClusteredSigRef = useRef<string>("");

  async function load() {
    const res = await fetch(`/api/projects/${projectId}/keywords`);
    const j = await res.json();
    setKeywords(j.keywords ?? []);
    setMax(j.max ?? 500);
  }
  useEffect(() => { load(); }, [projectId]);

  // v1.1.6: auto-cluster on a debounce when the keyword set changes.
  // Triggers on initial mount (if keywords aren't already clustered) and
  // any time keywords are added, edited, or deleted. Skips re-runs when the
  // current set matches what we last clustered (avoids the loop bug from
  // v1.1.5 where onChanged() refetches caused repeated clustering even
  // though the keyword set hadn't changed).
  useEffect(() => {
    if (keywords.length < 5) return;

    // Build a stable signature: sorted lowercase keyword strings joined.
    // Same strings → same cluster result, regardless of array reference or order.
    const sig = keywords.map((k) => k.keyword.toLowerCase().trim()).sort().join("|");

    // Already clustered this exact set in-session → nothing to do.
    if (sig === lastClusteredSigRef.current) return;

    // First time we're seeing this set this session. If the database already
    // has cluster_label on every keyword, the previous clustering still applies
    // and we should NOT re-run. Just memo the sig and exit.
    const firstRun = lastClusteredSigRef.current === "";
    if (firstRun && keywords.every((k) => !!k.cluster_label)) {
      lastClusteredSigRef.current = sig;
      return;
    }

    // Otherwise schedule a debounced cluster — long enough that bulk pastes
    // and detect-driven seed flushes don't thrash the Claude API.
    const timer = setTimeout(async () => {
      setClustering(true);
      try {
        const res = await fetch(`/api/projects/${projectId}/cluster-keywords`, { method: "POST" });
        if (res.ok) {
          const j = await res.json();
          lastClusteredSigRef.current = sig;
          setLastClusterSummary(j.clusters ?? null);
          onChanged();
        }
      } catch { /* swallow — auto-cluster shouldn't surface errors */ }
      finally { setClustering(false); }
    }, 8000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keywords, projectId]);

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      const keywords = manualText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
      const res = await fetch(`/api/projects/${projectId}/keywords`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: "manual", keywords }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed");
      setMsg(`Added ${j.added} keyword(s).`);
      setManualText("");
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

  /**
   * v1.1.5: inline edit a keyword. We don't have a PATCH endpoint for
   * individual keywords, so the simple-but-correct path is delete + re-add
   * as a manual entry. Same project, same surface, no schema changes.
   */
  async function saveEdit(oldId: string, newKeywordRaw: string) {
    const newKeyword = newKeywordRaw.trim();
    if (!newKeyword) { setEditingId(null); return; }
    // No change → just close the editor.
    const existing = keywords.find((k) => k.id === oldId);
    if (existing && existing.keyword === newKeyword) { setEditingId(null); return; }
    setBusy(true);
    try {
      await fetch(`/api/projects/${projectId}/keywords?keyword_id=${oldId}`, { method: "DELETE" });
      await fetch(`/api/projects/${projectId}/keywords`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: "manual", keywords: [newKeyword] }),
      });
      await load();
      onChanged();
    } finally {
      setBusy(false);
      setEditingId(null);
      setEditText("");
    }
  }

  function startEdit(id: string, current: string) {
    setEditingId(id);
    setEditText(current);
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

  return (
    <div className="surface p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="h2">Keyword universe</h2>
        <div className="text-xs muted">{usage} / {max} keywords</div>
      </div>
      <div className="text-xs mt-1 space-x-2">
        {Object.entries(sourcesCount).map(([k, v]) => <span key={k} className="tag">{k}: {v}</span>)}
      </div>

      {/* v1.1.7: streamlined input — single textarea for manual paste plus
          inline CSV uploads. Detected keywords flow in automatically via the
          ProjectHeader's Detect button, so the panel only needs manual + CSV. */}
      <div className="mt-3">
        <textarea
          className="input"
          style={{ minHeight: 76 }}
          placeholder="Paste keywords here — one per line or comma-separated."
          value={manualText}
          onChange={(e) => setManualText(e.target.value)}
        />
        <div className="flex items-center justify-between flex-wrap gap-2 mt-2">
          <div className="flex items-center gap-3 text-[11px]">
            <label className="cursor-pointer hover:text-white transition" style={{ color: "var(--muted)" }}>
              <i className="ti ti-upload" style={{ fontSize: 12, marginRight: 3, verticalAlign: -1 }} aria-hidden="true"></i>
              Keywords CSV
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadCsv(f); }}
              />
            </label>
            <label className="cursor-pointer hover:text-white transition" style={{ color: "#ffb846" }}>
              <i className="ti ti-chart-bar" style={{ fontSize: 12, marginRight: 3, verticalAlign: -1 }} aria-hidden="true"></i>
              Volumes CSV
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

      {msg && <div className="mt-2 text-[11px] muted">{msg}</div>}

      {/* v1.1.5: Auto-clustering status. Clustering fires automatically when
          the universe size changes (debounced 8s, minimum 5 keywords). The
          user no longer needs to click anything to trigger it. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16, padding: "8px 11px", borderRadius: 9, background: "rgba(168,120,255,0.06)", border: "1px solid rgba(168,120,255,0.20)" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#a878ff", letterSpacing: "0.05em", textTransform: "uppercase", display: "inline-flex", alignItems: "center", gap: 5 }}>
            <i className={`ti ${clustering ? "ti-loader-2" : "ti-layers-subtract"}`} style={{ fontSize: 12, animation: clustering ? "spin 0.8s linear infinite" : undefined }} aria-hidden="true"></i>
            {clustering ? "Auto-clustering…" : "Topic clustering · automatic"}
          </div>
          <div style={{ fontSize: 11, color: "#8a93a6", marginTop: 2 }}>
            {keywords.length < 5
              ? `Need at least 5 keywords to cluster. Currently ${keywords.length}.`
              : clustering
              ? "Grouping keywords into 5-8 topic buckets…"
              : lastClusterSummary && lastClusterSummary.length > 0
              ? `Clustered into ${lastClusterSummary.length} topic${lastClusterSummary.length === 1 ? "" : "s"}: ${lastClusterSummary.map((c) => `${c.name} (${c.count})`).join(" · ")}`
              : "Keywords will be auto-clustered shortly after you add them."}
          </div>
        </div>
      </div>

      {keywords.length > 0 ? (
        <div className="mt-4">
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-xs muted">Keywords ({keywords.length})</div>
            <div className="text-[10px] dim">Click any keyword to edit · click remove to delete</div>
          </div>
          <ul className="text-sm" style={{ maxHeight: 320, overflowY: "auto", borderTop: "1px solid var(--line)" }}>
            {keywords.map((k) => (
              <li key={k.id} className="flex items-center justify-between py-1.5 gap-2" style={{ borderBottom: "1px solid var(--line)" }}>
                <div className="truncate flex-1" style={{ minWidth: 0 }}>
                  {editingId === k.id ? (
                    <input
                      autoFocus
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); saveEdit(k.id, editText); }
                        else if (e.key === "Escape") { setEditingId(null); setEditText(""); }
                      }}
                      onBlur={() => saveEdit(k.id, editText)}
                      style={{
                        width: "100%", padding: "3px 8px",
                        background: "#0c0f15",
                        border: "1px solid rgba(79,140,255,0.40)",
                        borderRadius: 5,
                        color: "#f4f6fb",
                        fontSize: 13,
                        outline: "none",
                        fontFamily: "inherit",
                      }}
                    />
                  ) : (
                    <>
                      <span
                        onClick={() => startEdit(k.id, k.keyword)}
                        style={{ cursor: "text" }}
                        title="Click to edit"
                      >
                        {k.keyword}
                      </span>
                      <span className="ml-2 tag" style={{ fontSize: 9 }}>{k.source}</span>
                    </>
                  )}
                </div>
                {editingId === k.id ? (
                  <button
                    className="text-xs"
                    style={{ color: "var(--muted)" }}
                    onClick={() => { setEditingId(null); setEditText(""); }}
                  >cancel</button>
                ) : (
                  <button className="text-xs" style={{ color: "var(--accent-red)" }} onClick={() => remove(k.id)}>remove</button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="text-sm muted mt-4" style={{ padding: "12px 0" }}>
          No keywords yet. Add them above (paste, CSV upload, or run smart detection on the project header).
        </div>
      )}
    </div>
  );
}
