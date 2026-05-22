"use client";
import { useEffect, useRef, useState } from "react";
import { primaryBtnStyle } from "./uiStyles";

type ClusterSummary = { name: string; description: string; count: number };

type Keyword = { id: string; keyword: string; source: string; cluster_label?: string | null };

export default function KeywordPanel({ projectId, onChanged, refreshing = false }: { projectId: string; onChanged: () => void; refreshing?: boolean }) {
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  // v1.1.34: keyword universe is uncapped — the prior `max` state is gone.
  // The UI now shows a plain count instead of "X / 500".
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [clustering, setClustering] = useState(false);
  const [lastClusterSummary, setLastClusterSummary] = useState<ClusterSummary[] | null>(null);
  // v1.1.35: confirm modal for the destructive "Delete all" action. Two-step
  // confirmation — first click opens the modal, second click in the modal
  // actually fires the wipe. The button is wired to refuse to enable while a
  // refresh or cluster is in flight, so we never tear out the universe mid-op.
  const [confirmingWipe, setConfirmingWipe] = useState(false);
  const [wiping, setWiping] = useState(false);

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
  const lastClusteredSigRef = useRef<string>("");
  // v1.1.26: hard time-based cooldown. Even if the signature differs from the
  // last clustered version, refuse to auto-trigger another cluster within 30
  // seconds of the previous one. Belt-and-suspenders against any cause-chain
  // that produces repeat clusters (e.g., signature flicker during a state
  // transition, retry logic, etc.).
  const lastClusteredAtRef = useRef<number>(0);

  async function load() {
    const res = await fetch(`/api/projects/${projectId}/keywords`);
    const j = await res.json();
    setKeywords(j.keywords ?? []);
    // v1.1.34: `j.max` is now `null` from the API (uncapped). The previous
    // setMax(...) call has been removed along with the local `max` state.
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

    // v1.1.10: never auto-cluster while a refresh is in flight. The cluster
    // API + its onChanged() refetch was racing the refresh's own load() and
    // landing stale data on screen. Pausing during refresh means the user has
    // to click Refresh only once instead of two or three times.
    if (refreshing) return;

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

    // v1.1.26: hard time-based cooldown. Refuse to schedule a new cluster
    // within 30 seconds of the last one regardless of signature changes.
    const elapsedSinceLastCluster = Date.now() - lastClusteredAtRef.current;
    if (lastClusteredAtRef.current > 0 && elapsedSinceLastCluster < 30_000) {
      return;
    }

    // v1.1.11: 3s debounce (was 8s). Short enough that single-keyword adds
    // feel immediate; long enough to coalesce a quick paste of 5-15 keywords
    // into one cluster call instead of N.
    const timer = setTimeout(async () => {
      if (refreshing) return;
      // One more cooldown check at fire time in case anything raced.
      if (Date.now() - lastClusteredAtRef.current < 30_000 && lastClusteredAtRef.current > 0) return;
      setClustering(true);
      try {
        const res = await fetch(`/api/projects/${projectId}/cluster-keywords`, { method: "POST" });
        if (res.ok) {
          const j = await res.json();
          lastClusteredSigRef.current = sig;
          lastClusteredAtRef.current = Date.now();
          setLastClusterSummary(j.clusters ?? null);
          onChanged();
        }
      } catch { /* swallow — auto-cluster shouldn't surface errors */ }
      finally { setClustering(false); }
    }, 3000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keywords, projectId, refreshing]);

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
   * v1.1.35: wipe the entire keyword universe for this project. Snapshots are
   * preserved at the DB level (only the keywords table is touched) so the
   * user's historical AIO-coverage view doesn't disappear. The cluster
   * tracking refs are reset here too so the next set of keywords gets
   * auto-clustered from a clean slate rather than being skipped by the
   * "already clustered this signature" guard.
   */
  async function wipeAll() {
    if (wiping) return;
    setWiping(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/keywords?all=true`, { method: "DELETE" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed to delete keywords");
      // Reset auto-cluster bookkeeping so the next keyword add re-clusters
      // from scratch (otherwise the empty-signature shortcut blocks it).
      lastClusteredSigRef.current = "";
      lastClusteredAtRef.current = 0;
      setLastClusterSummary(null);
      setMsg(`Removed ${j.deleted ?? 0} keyword${(j.deleted ?? 0) === 1 ? "" : "s"}. Universe is empty — add keywords to start over.`);
      setConfirmingWipe(false);
      await load();
      onChanged();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setWiping(false);
    }
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
      // v1.1.26: stamp the same cooldown refs so the auto-cluster effect knows
      // a manual cluster just happened and respects the cooldown window.
      lastClusteredAtRef.current = Date.now();
      const sig = keywords.map((k) => k.keyword.toLowerCase().trim()).sort().join("|");
      lastClusteredSigRef.current = sig;
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
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h2 className="h2">Keyword universe</h2>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          {/* v1.1.34: no universe cap. Show plain count. */}
          <div className="text-xs muted">{usage.toLocaleString("en-US")} keyword{usage === 1 ? "" : "s"}</div>
          {/* v1.1.35: Delete-all entry point. Hidden when the universe is
              empty (nothing to delete), disabled mid-refresh / mid-cluster
              so we never tear the rug out from under another operation. */}
          {usage > 0 && (
            <button
              onClick={() => setConfirmingWipe(true)}
              disabled={refreshing || clustering || wiping || busy}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "4px 9px", borderRadius: 6,
                background: "transparent",
                color: refreshing || clustering || wiping || busy ? "rgba(255,100,100,0.40)" : "#ff6464",
                fontSize: 11, fontWeight: 600,
                border: "1px solid rgba(255,100,100,0.30)",
                cursor: refreshing || clustering || wiping || busy ? "not-allowed" : "pointer",
              }}
              title={refreshing ? "Wait for refresh to finish first" : clustering ? "Wait for clustering to finish first" : "Delete every keyword in this project (snapshots are preserved)"}
            >
              <i className="ti ti-trash" style={{ fontSize: 12 }} aria-hidden="true"></i>
              Delete all
            </button>
          )}
        </div>
      </div>

      {/* v1.1.35: Confirm modal for the destructive wipe. Renders as a fixed
          overlay so it sits on top of everything regardless of scroll. The
          actual click handler on the Confirm button still calls wipeAll() —
          we don't trust the modal alone to gate behavior. */}
      {confirmingWipe && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed", inset: 0, zIndex: 100,
            background: "rgba(0,0,0,0.70)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 20,
          }}
          onClick={(e) => {
            // Backdrop-click closes the modal (but not while wiping is in
            // flight — would otherwise leave the user wondering if it worked).
            if (e.target === e.currentTarget && !wiping) setConfirmingWipe(false);
          }}
        >
          <div
            style={{
              background: "#0e1118",
              border: "1px solid rgba(255,100,100,0.40)",
              borderRadius: 12,
              padding: 22,
              maxWidth: 440, width: "100%",
              boxShadow: "0 18px 60px rgba(0,0,0,0.50)",
            }}
          >
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <i className="ti ti-alert-triangle" style={{ fontSize: 18, color: "#ff6464" }} aria-hidden="true"></i>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#f4f6fb" }}>Delete all keywords?</div>
            </div>
            <p style={{ fontSize: 13, color: "#d6dbe6", lineHeight: 1.5, marginBottom: 14 }}>
              This removes all <strong style={{ color: "#f4f6fb" }}>{usage.toLocaleString("en-US")}</strong> keyword{usage === 1 ? "" : "s"} from this project, including their cluster labels and any per-keyword volumes.
            </p>
            <p style={{ fontSize: 12, color: "#8a93a6", lineHeight: 1.5, marginBottom: 18 }}>
              Past <strong style={{ color: "#d6dbe6" }}>snapshots are preserved</strong> — the AIO-coverage history stays available for what-changed comparisons. Only the keyword universe is wiped.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => setConfirmingWipe(false)}
                disabled={wiping}
                style={{
                  padding: "7px 13px", borderRadius: 8,
                  background: "transparent",
                  color: wiping ? "rgba(244,246,251,0.40)" : "#f4f6fb",
                  fontSize: 13, fontWeight: 500,
                  border: "1px solid rgba(255,255,255,0.15)",
                  cursor: wiping ? "not-allowed" : "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={wipeAll}
                disabled={wiping}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "7px 13px", borderRadius: 8,
                  background: wiping ? "rgba(255,100,100,0.30)" : "#ff6464",
                  color: "#0a0c10",
                  fontSize: 13, fontWeight: 700,
                  border: "none",
                  cursor: wiping ? "not-allowed" : "pointer",
                }}
              >
                <i className={`ti ${wiping ? "ti-loader-2" : "ti-trash"}`} style={{ fontSize: 13, animation: wiping ? "spin 0.8s linear infinite" : undefined }} aria-hidden="true"></i>
                {wiping ? "Deleting…" : `Delete ${usage.toLocaleString("en-US")} keyword${usage === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="text-xs mt-1 space-x-2">
        {Object.entries(sourcesCount).map(([k, v]) => <span key={k} className="tag">{k}: {v}</span>)}
      </div>

      {/* v1.1.11: single-line input for one-off keyword adds. Enter submits;
          comma-separated values still work for adding 2-3 at once. Bulk CSV
          upload sits next to it for true bulk imports. Volumes CSV removed —
          not used in the current workflow. */}
      <div className="mt-3">
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            className="input"
            style={{ flex: 1, minWidth: 200 }}
            placeholder="Type a keyword and press Enter — or paste several separated by commas."
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && manualText.trim() && !busy) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <label
            className="cursor-pointer hover:text-white transition inline-flex items-center"
            style={{ color: "var(--muted)", fontSize: 11, padding: "8px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.10)", whiteSpace: "nowrap" }}
            title="Bulk-import from a CSV file (one keyword per row)"
          >
            <i className="ti ti-upload" style={{ fontSize: 12, marginRight: 4 }} aria-hidden="true"></i>
            Keywords CSV
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadCsv(f); }}
            />
          </label>
          <button
            style={primaryBtnStyle(busy || !manualText.trim())}
            disabled={busy || !manualText.trim()}
            onClick={submit}
          >Add</button>
        </div>
      </div>

      {msg && <div className="mt-2 text-[11px] muted">{msg}</div>}

      {/* Auto-clustering status. Clustering fires automatically:
          - on initial load if any keyword lacks a cluster_label
          - whenever a keyword is added, edited, or deleted
          - debounced 3s so quick bulk adds coalesce into one call
          - paused while a refresh is in flight (avoid the race in v1.1.10)
          Minimum 5 keywords. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16, padding: "8px 11px", borderRadius: 9, background: "rgba(168,120,255,0.06)", border: "1px solid rgba(168,120,255,0.20)", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
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
        {/* v1.1.20: manual fallback. Auto-cluster usually fires on a 3s debounce
            but if the user wants to trigger it immediately or auto-cluster
            stalled out for any reason, this button forces a run right now. */}
        <button
          onClick={runClustering}
          disabled={clustering || keywords.length < 5}
          style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "5px 11px", borderRadius: 7,
            background: clustering || keywords.length < 5 ? "rgba(168,120,255,0.15)" : "#a878ff",
            color: clustering || keywords.length < 5 ? "#a878ff" : "#06070b",
            fontSize: 11, fontWeight: 600,
            border: "none", whiteSpace: "nowrap",
            cursor: clustering || keywords.length < 5 ? "not-allowed" : "pointer",
          }}
          title={keywords.length < 5 ? "Add at least 5 keywords first" : "Run clustering now"}
        >
          <i className={`ti ${clustering ? "ti-loader-2" : "ti-wand"}`} style={{ fontSize: 12, animation: clustering ? "spin 0.8s linear infinite" : undefined }} aria-hidden="true"></i>
          Cluster now
        </button>
      </div>

      {keywords.length > 0 ? (
        <div className="mt-3">
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-xs muted">Keywords ({keywords.length})</div>
            <div className="text-[10px] dim">Click any keyword to edit · click remove to delete</div>
          </div>
          {/* v1.1.12: compact density — one line per row, tight padding, smaller
              source badge. Matches the CompetitorPanel row density. */}
          <ul style={{ maxHeight: 320, overflowY: "auto", borderTop: "1px solid var(--line)", fontSize: 12 }}>
            {keywords.map((k) => (
              <li
                key={k.id}
                className="flex items-center justify-between gap-2"
                style={{ padding: "4px 0", borderBottom: "1px solid var(--line)", lineHeight: 1.3 }}
              >
                <div className="truncate" style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: 7 }}>
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
                        width: "100%", padding: "2px 7px",
                        background: "#0c0f15",
                        border: "1px solid rgba(79,140,255,0.40)",
                        borderRadius: 5,
                        color: "#f4f6fb",
                        fontSize: 12,
                        outline: "none",
                        fontFamily: "inherit",
                      }}
                    />
                  ) : (
                    <>
                      <span
                        onClick={() => startEdit(k.id, k.keyword)}
                        style={{ cursor: "text", color: "var(--text)" }}
                        title="Click to edit"
                      >
                        {k.keyword}
                      </span>
                      <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, background: "rgba(255,255,255,0.04)", color: "var(--muted)" }}>{k.source}</span>
                    </>
                  )}
                </div>
                {editingId === k.id ? (
                  <button
                    className="text-[10.5px]"
                    style={{ color: "var(--muted)", flexShrink: 0 }}
                    onClick={() => { setEditingId(null); setEditText(""); }}
                  >cancel</button>
                ) : (
                  <button
                    className="text-[10.5px]"
                    style={{ color: "var(--accent-red)", flexShrink: 0 }}
                    onClick={() => remove(k.id)}
                  >remove</button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="text-xs muted mt-3" style={{ padding: "10px 0" }}>
          No keywords yet. Add them above (type one, paste several with commas, upload a CSV, or run smart detection on the project header).
        </div>
      )}
    </div>
  );
}
