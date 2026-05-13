import { NextRequest, NextResponse } from "next/server";
import { createProject, listProjects } from "@/lib/db";
import { normalizeDomain } from "@/lib/domain";

export const runtime = "nodejs";

export async function GET() {
  const projects = await listProjects();
  return NextResponse.json({ projects });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { client_url, brand_name, brand_aliases } = body ?? {};
  if (!client_url || !brand_name) {
    return NextResponse.json({ error: "client_url and brand_name are required" }, { status: 400 });
  }
  const domain = normalizeDomain(client_url);
  if (!domain) {
    return NextResponse.json({ error: "could not parse a domain from client_url" }, { status: 400 });
  }
  const project = await createProject({
    client_url,
    client_domain: domain,
    brand_name,
    brand_aliases: Array.isArray(brand_aliases) ? brand_aliases : [],
    segment_l1: body.segment_l1 ?? null,
    segment_l2: body.segment_l2 ?? null,
    segment_l3: body.segment_l3 ?? null,
    primary_product: body.primary_product ?? null,
    custom_seed_keywords: Array.isArray(body.custom_seed_keywords) ? body.custom_seed_keywords : null,
    detection_confidence: body.detection_confidence ?? null,
    regions: Array.isArray(body.regions) ? body.regions : undefined,
  });
  return NextResponse.json({ project }, { status: 201 });
}
