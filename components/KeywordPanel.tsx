"use client";
import { useEffect, useState } from "react";
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
  // v1.1.35/v1.1.38: confirm modal for destructive delete actions. Two-step
  // confirmation — first click opens the modal, second click actually fires.
  // v1.1.38 generalizes the modal so the same component handles both the
  // global "Delete all" wipe and the per-source ("Delete all manual",
  // "Delete all organic", …) wipes triggered by the trash icons on each
  // source tag. `confirm.kind` decides which copy + endpoint we use.
  const [confirm, setConfirm] = useState<
    | { kind: "all" }
    | { kind: "source"; source: string; count: number }
    | null
  >(null);
  const [wiping, setWiping] = useState(false);

  // v1.1.7: only manual entry remains. The organic/market/seed expansion paths
  // were removed — smart detection on the project header populates seed
  // keywords automatically, and bulk paste / CSV covers everything else.
  const [manualText, setManualText] = useState("");

  // v1.1.5: inline edit state — track which keyword id is being edited and what
  // the in-flight text value is. Only one row is editable at a time.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  // v1.1.38: clustering is no longer auto-triggered by keyword-set changes.
  // It now fires exactly once after each successful manual add / CSV upload
  // (see submit() and uploadCsv()), and otherwise only on the manual
  // "Cluster now" button. The signature/cooldown bookkeeping from prior
  // versions has been removed — it was guarding against the loop bug in the
  // useEffect-driven auto-cluster path, which no longer exists.

  async function load() {
    const res = await fetch(`/api/projects/${projectId}/keywords`);
    const j = await res.json();
    setKeywords(j.keywords ?? []);
    // v1.1.34: `j.max` is now `null` from the API (uncapped). The previous
    // setMax(...) call has been removed along with the local `max` state.
  }
  useEffect(() => { load(); }, [projectId]);

  /**
   * v1.1.38: one-shot cluster trigger used by submit() and uploadCsv() after
   * a successful add. Quiet failure mode — if the cluster call errors we don't
   * surface it through `msg` (the add itself already succeeded), but we do
   * clear the spinner. Skipped when the projected universe size is under 5
   * (the clustering endpoint requires a minimum) or while a refresh is in
   * flight (refresh path does its own data load — the two would race).
   *
   * `addedCount` comes from the POST response, NOT from local state, because
   * `keywords` state hasn't been re-rendered yet at the point this fires.
   * Using the response avoids a fragile second GET.
   */
  async function autoClusterAfterAdd(addedCount: number) {
    if (refreshing) return;
    const projected = keywords.length + addedCount;
    if (projected < 5) return;
    setClustering(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/cluster-keywords`, { method: "POST" });
      if (res.ok) {
        const j = await res.json();
        setLastClusterSummary(j.clusters ?? null);
        // Refresh local keyword list so cluster_label values land in the UI.
        await load();
        onChanged();
      }
    } catch { /* swallow — the add already succeeded, don't shout */ }
    finally { setClustering(false); }
  }

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
      // v1.1.38: one-shot auto-cluster after the add lands.
      if ((j.added ?? 0) > 0) await autoClusterAfterAdd(j.added ?? 0);
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
      // v1.1.38: one-shot auto-cluster after the upload lands.
      if ((j.added ?? 0) > 0) await autoClusterAfterAdd(j.added ?? 0);
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
   * v1.1.35/v1.1.38: execute whichever destructive delete the user has staged
   * in `confirm`. "all" hits `?all=true`; "source" hits `?source=<name>` and
   * only removes keywords from that ingestion source. Snapshots are preserved
   * at the DB level (only the keywords table is touched) so the user's
   * historical AIO-coverage view doesn't disappear. Cluster tracking refs are
   * reset whenever the keyword *set* changes so the next add re-clusters from
   * scratch rather than being skipped by the "already clustered this
   * signature" guard.
   */
  async function runConfirmedDelete() {
    if (wiping || !confirm) return;
    setWiping(true);
    setMsg(null);
    try {
      const url =
        confirm.kind === "all"
          ? `/api/projects/${projectId}/keywords?all=true`
          : `/api/projects/${projectId}/keywords?source=${encodeURIComponent(confirm.source)}`;
      const res = await fetch(url, { method: "DELETE" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed to delete keywords");
      // v1.1.38: clear the cached cluster summary so the banner doesn't keep
      // showing stale topic counts after the universe shrinks or empties.
      // (The prior ref-based bookkeeping is gone now that auto-cluster only
      // fires on add/upload.)
      setLastClusterSummary(null);
      const n = j.deleted ?? 0;
      const noun = `keyword${n === 1 ? "" : "s"}`;
      setMsg(
        confirm.kind === "all"
          ? `Removed ${n} ${noun}. Universe is empty — add keywords to start over.`
          : `Removed ${n} ${confirm.source} ${noun}.`,
      );
      setConfirm(null);
      await load();
      onChanged();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      // v1.1.39: belt-and-suspenders. Reset every gating flag, not just
      // `wiping`. If a prior pipeline (an upload whose cluster step was
      // killed by Vercel's function timeout, a manual cluster the user
      // navigated away from, etc.) left `busy` or `clustering` stuck true,
      // the post-delete UI would be unresponsive — buttons disabled, file
      // picks silently dropped — until a browser refresh. The delete is a
      // good "clear the deck" moment so we explicitly clear those too.
      // These setters are no-ops when the values are already false.
      setWiping(false);
      setBusy(false);
      setClustering(false);
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
      setMsg(`Clustered ${j.assigned} keyword${j.assigned === 1 ? "" : "s"} into ${j.clusters?.length ?? 0} topic group${(j.clusters?.length ?? 0) === 1 ? "" : "s"}.`);
      // v1.1.38: refresh the local keyword list so the new cluster_label
      // values render immediately — the prior signature-ref bookkeeping is
      // gone now that auto-cluster is one-shot per add/upload.
      await load();
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
              onClick={() => setConfirm({ kind: "all" })}
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

      {/* v1.1.35/v1.1.38: Confirm modal for destructive wipes. Renders as a
          fixed overlay so it sits on top of everything regardless of scroll.
          Body copy + button label adapt to whether the staged delete is the
          global "all" wipe or a single-source wipe. The Confirm button still
          calls runConfirmedDelete() — we don't trust the modal alone to gate
          behavior. */}
      {confirm && (() => {
        const targetCount =
          confirm.kind === "all" ? usage : confirm.count;
        const targetLabel =
          confirm.kind === "all"
            ? `all ${targetCount.toLocaleString("en-US")} keyword${targetCount === 1 ? "" : "s"}`
            : `${targetCount.toLocaleString("en-US")} ${confirm.source} keyword${targetCount === 1 ? "" : "s"}`;
        const title =
          confirm.kind === "all"
            ? "Delete all keywords?"
            : `Delete all "${confirm.source}" keywords?`;
        const ctaLabel = wiping
          ? "Deleting…"
          : `Delete ${targetCount.toLocaleString("en-US")} keyword${targetCount === 1 ? "" : "s"}`;
        return (
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
              if (e.target === e.currentTarget && !wiping) setConfirm(null);
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
                <div style={{ fontSize: 15, fontWeight: 700, color: "#f4f6fb" }}>{title}</div>
              </div>
              <p style={{ fontSize: 13, color: "#d6dbe6", lineHeight: 1.5, marginBottom: 14 }}>
                This removes {targetLabel.includes("keyword") ? <>
                  <strong style={{ color: "#f4f6fb" }}>{targetLabel}</strong>
                </> : targetLabel} from this project, including their cluster labels and any per-keyword volumes.
                {confirm.kind === "source" && (
                  <> Other sources are untouched.</>
                )}
              </p>
              <p style={{ fontSize: 12, color: "#8a93a6", lineHeight: 1.5, marginBottom: 18 }}>
                Past <strong style={{ color: "#d6dbe6" }}>snapshots are preserved</strong> — the AIO-coverage history stays available for what-changed comparisons. Only the keyword universe is wiped.
              </p>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  onClick={() => setConfirm(null)}
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
                  onClick={runConfirmedDelete}
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
                  {ctaLabel}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
      {/* v1.1.38: each source tag now gets a small trash button so users can
          delete one "set" (e.g. an accidentally pasted CSV import) without
          nuking other sources. Same two-step confirmation pattern as the
          global Delete all button — clicking the trash stages the delete in
          `confirm`, the modal collects the second click. The trash button is
          disabled while another op (refresh / cluster / wipe / busy) is in
          flight so we never tear out a source mid-cluster. */}
      <div className="text-xs mt-1" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {Object.entries(sourcesCount).map(([k, v]) => {
          const opInFlight = refreshing || clustering || wiping || busy;
          return (
            <span
              key={k}
              className="tag"
              style={{ display: "inline-flex", alignItems: "center", gap: 4, paddingRight: 4 }}
            >
              {k}: {v}
              <button
                type="button"
                onClick={() => setConfirm({ kind: "source", source: k, count: v })}
                disabled={opInFlight}
                title={
                  opInFlight
                    ? (refreshing ? "Wait for refresh to finish first" : clustering ? "Wait for clustering to finish first" : "Please wait…")
                    : `Delete all ${v} ${k} keyword${v === 1 ? "" : "s"}`
                }
                aria-label={`Delete all ${k} keywords`}
                style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  width: 16, height: 16, padding: 0,
                  borderRadius: 4,
                  border: "none",
                  background: "transparent",
                  color: opInFlight ? "rgba(255,100,100,0.35)" : "#ff6464",
                  cursor: opInFlight ? "not-allowed" : "pointer",
                  lineHeight: 1,
                }}
              >
                <i className="ti ti-x" style={{ fontSize: 11 }} aria-hidden="true"></i>
              </button>
            </span>
          );
        })}
      </div>

      {/* v1.1.11: single-line input for one-off keyword adds. Enter submits;
          comma-separated values still work for adding 2-3 at once. Bulk CSV
          upload sits next to it for true bulk imports. Volumes CSV removed —
          not used in the current workflow. */}
      {/* v1.1.38: two equally-weighted primary CTAs. "Add manual" handles
          single keywords and short comma-separated pastes via the text input.
          "Upload CSV" handles bulk imports — it used to be a small ghost
          label, which made it look secondary; users repeatedly missed it. The
          file input lives inside the label so the whole button is the
          target. Both buttons disable while busy / wiping so a slow add or
          delete can't race a CSV upload. */}
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
          <button
            style={{
              ...primaryBtnStyle(busy || !manualText.trim()),
              display: "inline-flex", alignItems: "center", gap: 6,
              whiteSpace: "nowrap",
            }}
            disabled={busy || !manualText.trim()}
            onClick={submit}
            title="Add the keyword(s) typed in the field"
          >
            <i className="ti ti-plus" style={{ fontSize: 13 }} aria-hidden="true"></i>
            Add manual
          </button>
          <label
            className="inline-flex items-center"
            aria-disabled={busy || wiping}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "9px 14px", borderRadius: 6,
              background: busy || wiping ? "rgba(55, 138, 221, 0.15)" : "#102a3d",
              color: busy || wiping ? "rgba(133, 183, 235, 0.45)" : "#85b7eb",
              border: "1px solid #185fa5",
              fontSize: 13, fontWeight: 600,
              whiteSpace: "nowrap",
              cursor: busy || wiping ? "not-allowed" : "pointer",
            }}
            title={busy || wiping ? "Please wait…" : "Bulk-import from a CSV file (one keyword per row)"}
          >
            <i className="ti ti-upload" style={{ fontSize: 13 }} aria-hidden="true"></i>
            Upload CSV
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              disabled={busy || wiping}
              onChange={(e) => {
                const f = e.target.files?.[0];
                // v1.1.39: never silently drop an upload. Previously, if the
                // user picked a file while `busy` or `wiping` was true (e.g.
                // a slow delete that hadn't finished yet), the file was
                // discarded with no UI feedback and the user thought the
                // app was broken. Now we surface a clear message so they
                // know to retry once the current op finishes.
                if (f) {
                  if (busy || wiping) {
                    setMsg("Please wait for the current operation to finish, then try the upload again.");
                  } else {
                    uploadCsv(f);
                  }
                }
                // Reset so picking the same file twice re-triggers onChange.
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </div>

      {msg && <div className="mt-2 text-[11px] muted">{msg}</div>}

      {/* v1.1.38: clustering policy. Auto-cluster fires exactly once after
          each successful manual add or CSV upload (in submit / uploadCsv).
          Edits, deletes, and initial mount no longer trigger it. The "Cluster
          now" button always works for explicit re-runs. Minimum 5 keywords. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16, padding: "8px 11px", borderRadius: 9, background: "rgba(168,120,255,0.06)", border: "1px solid rgba(168,120,255,0.20)", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#a878ff", letterSpacing: "0.05em", textTransform: "uppercase", display: "inline-flex", alignItems: "center", gap: 5 }}>
            <i className={`ti ${clustering ? "ti-loader-2" : "ti-layers-subtract"}`} style={{ fontSize: 12, animation: clustering ? "spin 0.8s linear infinite" : undefined }} aria-hidden="true"></i>
            {clustering ? "Clustering…" : "Topic clustering · auto-runs once after each add"}
          </div>
          <div style={{ fontSize: 11, color: "#8a93a6", marginTop: 2 }}>
            {keywords.length < 5
              ? `Need at least 5 keywords to cluster. Currently ${keywords.length}.`
              : clustering
              ? "Grouping keywords into 5-8 topic buckets…"
              : lastClusterSummary && lastClusterSummary.length > 0
              ? `Clustered into ${lastClusterSummary.length} topic${lastClusterSummary.length === 1 ? "" : "s"}: ${lastClusterSummary.map((c) => `${c.name} (${c.count})`).join(" · ")}. Click Cluster now to re-run.`
              : "Add or upload keywords and they'll be clustered once automatically. Use Cluster now for any re-runs."}
          </div>
        </div>
        {/* v1.1.38: Cluster now is now the user's primary lever for re-runs —
            auto-cluster only fires once per add/upload, so this button is how
            you re-cluster after edits, deletes, or any time you want a fresh
            topic grouping. */}
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
