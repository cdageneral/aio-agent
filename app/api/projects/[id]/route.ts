import { NextRequest, NextResponse } from "next/server";
import { deleteProject, getProject, updateProject } from "@/lib/db";
import { normalizeDomain } from "@/lib/domain";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: { id: string } }) {
  const p = await getProject(ctx.params.id);
  if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ project: p });
}

export async function PATCH(req: NextRequest, ctx: { params: { id: string } }) {
  const body = await req.json();
  const patch: Parameters<typeof updateProject>[1] = {};
  if (typeof body.client_url === "string") {
    patch.client_url = body.client_url;
    patch.client_domain = normalizeDomain(body.client_url);
  }
  if (typeof body.brand_name === "string") patch.brand_name = body.brand_name;
  if (Array.isArray(body.brand_aliases)) patch.brand_aliases = body.brand_aliases;
  if ("segment_l1" in body) patch.segment_l1 = body.segment_l1 ?? null;
  if ("segment_l2" in body) patch.segment_l2 = body.segment_l2 ?? null;
  if ("segment_l3" in body) patch.segment_l3 = body.segment_l3 ?? null;
  if ("primary_product" in body) patch.primary_product = body.primary_product ?? null;
  if ("custom_seed_keywords" in body) patch.custom_seed_keywords = Array.isArray(body.custom_seed_keywords) ? body.custom_seed_keywords : null;
  if ("detection_confidence" in body) patch.detection_confidence = body.detection_confidence ?? null;
  if ("suggested_competitors" in body && Array.isArray(body.suggested_competitors)) {
    patch.suggested_competitors = body.suggested_competitors;
  }
  if (Array.isArray(body.regions)) patch.regions = body.regions;

  const updated = await updateProject(ctx.params.id, patch);
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ project: updated });
}

export async function DELETE(_req: NextRequest, ctx: { params: { id: string } }) {
  await deleteProject(ctx.params.id);
  return NextResponse.json({ ok: true });
}
