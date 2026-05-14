import Link from "next/link";
import { listProjects } from "@/lib/db";
import ProjectCard from "@/components/ProjectCard";

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
          <div className="text-base muted">No projects yet.</div>
          <div className="text-xs dim mt-2">Click the lime <strong style={{ color: "var(--text)" }}>+ New project</strong> button above to set up your first one.</div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map((p) => (
          <ProjectCard
            key={p.id}
            project={{
              id: p.id,
              client_domain: p.client_domain ?? null,
              brand_name: p.brand_name,
              segment_l1: p.segment_l1 ?? null,
              segment_l2: p.segment_l2 ?? null,
              segment_l3: p.segment_l3 ?? null,
              regions: p.regions ?? null,
              device: p.device,
            }}
          />
        ))}
      </div>
    </div>
  );
}
