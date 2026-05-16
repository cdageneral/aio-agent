"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * One project tile on the home page. Pulled out of `app/page.tsx` so the
 * server-rendered list can host an interactive delete affordance per card.
 *
 * Delete UX:
 *   - Small trash icon sits top-right, subtle red-on-hover.
 *   - Click opens a confirmation modal that names the project and lists
 *     what will be cascade-deleted (keywords, snapshots, citations).
 *   - User must type the brand name OR click the typed-match "Delete"
 *     button. Defaults to disabled so accidental Enter-key submission
 *     can't wipe a project.
 *   - On success: router.refresh() re-runs the server-side listProjects.
 */
export interface ProjectListItem {
  id: string;
  client_domain: string | null;
  brand_name: string;
  segment_l1: string | null;
  segment_l2: string | null;
  segment_l3: string | null;
  regions: string[] | null;
  device: string;
}

export default function ProjectCard({ project }: { project: ProjectListItem }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Close confirm on Escape.
  useEffect(() => {
    if (!confirming) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape" && !deleting) closeConfirm(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirming, deleting]);

  function openConfirm(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setTyped("");
    setError(null);
    setConfirming(true);
  }

  function closeConfirm() {
    setConfirming(false);
    setTyped("");
    setError(null);
  }

  async function doDelete() {
    setDeleting(true);
    setError(null);
    try {
      // v1.1.18: cache-bust the DELETE so no intermediary caches it.
      const res = await fetch(`/api/projects/${project.id}?ts=${Date.now()}`, {
        method: "DELETE",
        cache: "no-store",
      });
      const j = await res.json().catch(() => ({} as any));
      // v1.1.19: treat the 404/0-rows case as soft-success — the row is already
      // gone from the DB (it was a ghost from a stale cache), and the route
      // already revalidated `/` so the next render will be fresh. Hard-navigate
      // either way so the user lands on an accurate projects list.
      const wasDeleted = res.ok && j.ok && (typeof j.deleted !== "number" || j.deleted >= 1);
      const wasGhost = res.status === 404 && j.deleted === 0;
      if (!wasDeleted && !wasGhost) {
        throw new Error(j.error || `Server returned ${res.status}`);
      }
      closeConfirm();
      if (typeof window !== "undefined") {
        window.location.assign(`/?ts=${Date.now()}`);
      } else {
        router.refresh();
      }
    } catch (e) {
      setError((e as Error).message || "Delete failed");
      setDeleting(false);
    }
  }

  const segment = [project.segment_l1, project.segment_l2, project.segment_l3].filter(Boolean).join(" › ");
  const canDelete = typed.trim().toLowerCase() === project.brand_name.trim().toLowerCase();

  return (
    <div style={{ position: "relative" }}>
      <Link
        href={`/projects/${project.id}`}
        className="surface p-5 hover:border-white/20 transition"
        style={{ display: "block", paddingRight: 46 }}
      >
        <div className="text-xs dim">{project.client_domain}</div>
        <div className="text-lg font-semibold mt-1">{project.brand_name}</div>
        {segment && (
          <div className="text-xs muted mt-1">{segment}</div>
        )}
        <div className="mt-3 flex items-center gap-2">
          {(project.regions ?? ["us"]).map((r) => (
            <span key={r} className="tag tag-accent">{r.toUpperCase()}</span>
          ))}
          <span className="tag">{project.device}</span>
        </div>
      </Link>

      <button
        onClick={openConfirm}
        aria-label={`Delete project ${project.brand_name}`}
        title={`Delete ${project.brand_name}`}
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          width: 30,
          height: 30,
          borderRadius: 8,
          background: "rgba(255,100,100,0.06)",
          color: "#ff6464",
          border: "1px solid rgba(255,100,100,0.20)",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          opacity: 0.7,
          transition: "background 120ms ease, opacity 120ms ease",
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,100,100,0.18)"; (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,100,100,0.06)"; (e.currentTarget as HTMLButtonElement).style.opacity = "0.7"; }}
      >
        {/* v1.1.15: inline SVG trash icon — guaranteed to render even if the
            Tabler webfont fails to load (CDN hiccup, blocked, or cached miss). */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
        </svg>
      </button>

      {confirming && (
        <div
          onClick={closeConfirm}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.65)",
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Confirm delete"
            style={{
              width: "100%",
              maxWidth: 460,
              background: "#0c0f15",
              border: "1px solid rgba(255,100,100,0.30)",
              borderRadius: 14,
              padding: 22,
              boxShadow: "0 20px 60px rgba(0,0,0,0.60)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div style={{ width: 34, height: 34, borderRadius: "50%", background: "rgba(255,100,100,0.14)", color: "#ff6464", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <i className="ti ti-alert-triangle" style={{ fontSize: 18 }} aria-hidden="true"></i>
              </div>
              <div style={{ fontSize: 17, fontWeight: 600, color: "#f4f6fb", letterSpacing: "-0.01em" }}>
                Delete project?
              </div>
            </div>

            <p style={{ fontSize: 13.5, color: "#d6dbe6", lineHeight: 1.55, margin: "0 0 14px" }}>
              You're about to delete <strong style={{ color: "#f4f6fb" }}>{project.brand_name}</strong>
              {project.client_domain ? <> ({project.client_domain})</> : null}. This is permanent and cascades to every snapshot,
              keyword, citation, mention, and competitor record attached to this project.
            </p>

            <p style={{ fontSize: 12, color: "#8a93a6", margin: "0 0 6px" }}>
              Type <strong style={{ color: "#ff6464" }}>{project.brand_name}</strong> to confirm:
            </p>
            <input
              autoFocus
              type="text"
              value={typed}
              disabled={deleting}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && canDelete && !deleting) doDelete(); }}
              placeholder="Type the brand name here…"
              style={{
                width: "100%",
                padding: "9px 12px",
                background: "#11151d",
                border: canDelete ? "1px solid rgba(255,100,100,0.45)" : "1px solid rgba(255,255,255,0.08)",
                borderRadius: 8,
                color: "#f4f6fb",
                fontSize: 14,
                outline: "none",
                fontFamily: "inherit",
              }}
            />

            {error && (
              <div style={{ marginTop: 10, padding: "8px 11px", borderRadius: 8, background: "rgba(255,100,100,0.10)", border: "1px solid rgba(255,100,100,0.30)", fontSize: 12, color: "#ff6464" }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
              <button
                onClick={closeConfirm}
                disabled={deleting}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  background: "transparent",
                  color: "#d6dbe6",
                  border: "1px solid rgba(255,255,255,0.14)",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: deleting ? "not-allowed" : "pointer",
                  opacity: deleting ? 0.55 : 1,
                }}
              >
                Cancel
              </button>
              <button
                onClick={doDelete}
                disabled={!canDelete || deleting}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  background: canDelete && !deleting ? "#ff6464" : "rgba(255,100,100,0.20)",
                  color: canDelete && !deleting ? "#06070b" : "#ff6464",
                  border: "1px solid " + (canDelete && !deleting ? "#ff6464" : "rgba(255,100,100,0.30)"),
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: canDelete && !deleting ? "pointer" : "not-allowed",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  opacity: canDelete || deleting ? 1 : 0.7,
                }}
              >
                <i className={`ti ${deleting ? "ti-loader-2" : "ti-trash"}`} style={{ fontSize: 13, animation: deleting ? "spin 0.8s linear infinite" : undefined }} aria-hidden="true"></i>
                {deleting ? "Deleting…" : "Delete project"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
