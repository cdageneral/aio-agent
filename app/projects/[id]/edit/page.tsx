import { notFound } from "next/navigation";
import { getProject } from "@/lib/db";
import EditProjectClient from "@/components/EditProjectClient";

export const dynamic = "force-dynamic";

export default async function EditProjectPage({ params }: { params: { id: string } }) {
  const project = await getProject(params.id);
  if (!project) notFound();
  return (
    <main>
      <EditProjectClient projectId={project.id} />
    </main>
  );
}
