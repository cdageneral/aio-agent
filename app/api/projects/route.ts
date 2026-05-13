import { NextRequest, NextResponse } from "next/server";
import { createProject, listProjects } from "@/lib/db";
import { normalizeDomain } from "@/lib/domain";

export const runtime = "nodejs";

export async function GET() {
  try {
    const projects = await listProjects();
    return NextResponse.json({ projects });
  } catch (err: any) {
    return NextResponse.json(
      { error: friendlyDbError(err) },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { client_url, brand_name, brand_aliases } = body ?? {};
  if (!client_url || !brand_name) {
    return NextResponse.json({ error: "client_url and brand_name are required" }, { status: 400 });
  }
  const domain = normalizeDomain(client_url);
  if (!domain) {
    return NextResponse.json({ error: "could not parse a domain from client_url" }, { status: 400 });
  }

  try {
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
  } catch (err: any) {
    // Log to Vercel logs for diagnostics; return a clean JSON error to the client.
    console.error("[/api/projects POST] failed:", err);
    return NextResponse.json(
      { error: friendlyDbError(err) },
      { status: 500 },
    );
  }
}

/**
 * Translate the most common Postgres / Vercel errors into actionable hints
 * so the user sees "your database isn't set up" instead of a raw stack trace.
 */
function friendlyDbError(err: any): string {
  const msg = String(err?.message ?? err ?? "");
  if (/POSTGRES_URL/i.test(msg)) {
    return "Postgres connection not configured. Make sure your Vercel project is linked to a Postgres database in the Storage tab.";
  }
  if (/relation .* does not exist/i.test(msg) || /undefined_table/i.test(msg)) {
    return "Database tables haven't been created yet. Open your Postgres → Query tab in Vercel and run the contents of db/schema.sql.";
  }
  if (/column .* does not exist/i.test(msg) || /undefined_column/i.test(msg)) {
    return "Database schema is out of date. Re-run db/schema.sql in your Postgres → Query tab to add the missing columns.";
  }
  if (/ANTHROPIC_API_KEY/i.test(msg)) {
    return "ANTHROPIC_API_KEY is not set. Add it under Project Settings → Environment Variables and redeploy.";
  }
  if (/SERPAPI_KEY/i.test(msg)) {
    return "SERPAPI_KEY is not set. Add it under Project Settings → Environment Variables and redeploy.";
  }
  return msg || "Unknown server error. Check the Vercel deployment logs.";
}
