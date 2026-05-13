import { NextRequest, NextResponse } from "next/server";
import { addCompetitor, deleteCompetitor, listCompetitors } from "@/lib/db";
import { normalizeDomain } from "@/lib/domain";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: { id: string } }) {
  const competitors = await listCompetitors(ctx.params.id);
  return NextResponse.json({ competitors });
}

export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  const { url, brand_name, brand_aliases } = await req.json();
  if (!url || !brand_name) {
    return NextResponse.json({ error: "url and brand_name required" }, { status: 400 });
  }
  const domain = normalizeDomain(url);
  if (!domain) return NextResponse.json({ error: "invalid url" }, { status: 400 });
  const competitor = await addCompetitor({
    project_id: ctx.params.id,
    url,
    domain,
    brand_name,
    brand_aliases: Array.isArray(brand_aliases) ? brand_aliases : [],
  });
  return NextResponse.json({ competitor }, { status: 201 });
}

export async function DELETE(req: NextRequest, _ctx: { params: { id: string } }) {
  const { searchParams } = new URL(req.url);
  const cid = searchParams.get("competitor_id");
  if (!cid) return NextResponse.json({ error: "competitor_id required" }, { status: 400 });
  await deleteCompetitor(cid);
  return NextResponse.json({ ok: true });
}
