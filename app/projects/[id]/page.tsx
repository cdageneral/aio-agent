import { notFound } from "next/navigation";
import { getProject } from "@/lib/db";
import Dashboard from "@/components/Dashboard";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: { id: string } }) {
  const project = await getProject(params.id);
  if (!project) notFound();
  return <Dashboard projectId={project.id} />;
}
