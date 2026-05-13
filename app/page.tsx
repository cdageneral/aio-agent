import Link from "next/link";
import { listProjects } from "@/lib/db";

const cta: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "9px 16px", borderRadius: 10,
  background: "#b6f53b", color: "#06070b",
  fontWeight: 600, fontSize: 14, textDecoration: "none",
};

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let projects: Awaited<ReturnType<typeof listProjects>> = [];
  let dbError: string | null = null;
  try {
    projects = await listProjects();
  } catch (e) {
    dbError = (e as Error).message;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm muted mt-1">Track Google AI Overview coverage for a brand and its competitive set.</p>
        </div>
        <Link href="/projects/new" style={cta}>+ New project</Link>
      </div>

      {dbError && (
        <div className="surface p-4" style={{ borderColor: "rgba(255,100,100,0.35)" }}>
          <div className="font-medium mb-1" style={{ color: "var(--accent-red)" }}>Database not initialized</div>
          <div className="text-sm muted">{dbError}</div>
          <div className="mt-2 text-xs dim">
            Run <code className="px-1 py-0.5 rounded" style={{ background: "var(--surface-2)" }}>npm run db:init</code> after linking a Vercel Postgres store.
          </div>
        </div>
      )}

      {!dbError && projects.length === 0 && (
        <div className="surface p-10 text-center">
          <div className="text-base muted mb-3">No projects yet.</div>
          <Link href="/projects/new" style={cta}>Create your first project</Link>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map((p) => (
          <Link key={p.id} href={`/projects/${p.id}`} className="surface p-5 hover:border-white/20 transition" style={{ display: "block" }}>
            <div className="text-xs dim">{p.client_domain}</div>
            <div className="text-lg font-semibold mt-1">{p.brand_name}</div>
            {p.segment_l1 && (
              <div className="text-xs muted mt-1">
                {[p.segment_l1, p.segment_l2, p.segment_l3].filter(Boolean).join(" › ")}
              </div>
            )}
            <div className="mt-3 flex items-center gap-2">
              {(p.regions ?? ["us"]).map((r) => (
                <span key={r} className="tag tag-accent">{r.toUpperCase()}</span>
              ))}
              <span className="tag">{p.device}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
