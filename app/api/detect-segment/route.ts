/**
 * Smart segment detection — POST { url } returns a suggested industry,
 * category, subcategory, region, seed keywords, and competitors.
 *
 * This replaces the legacy taxonomy picker. Free-form output, no enum.
 *
 * Pipeline: fetch URL → strip HTML to ~2KB excerpt → Claude Haiku
 * classifies in structured JSON → return.
 */
import { NextRequest, NextResponse } from "next/server";
import { fetchAndExtract } from "@/lib/web-extract";
import { detectSegment } from "@/lib/llm";
import { verifyDomains } from "@/lib/verify-domain";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  let url: string;
  try {
    const body = await req.json();
    url = String(body?.url ?? "").trim();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  try {
    const extracted = await fetchAndExtract(url);
    if (!extracted.title && !extracted.description && !extracted.text) {
      return NextResponse.json(
        { error: "couldn't extract any text from this URL — possible JS-only site or block" },
        { status: 422 },
      );
    }
    const result = await detectSegment(extracted);

    // Liveness check on the LLM-suggested competitor domains. Anything that
    // doesn't resolve at all gets dropped so the user never sees a dead row.
    // Reachable domains get `verified: true` so the UI can render a ✓.
    if (result.competitors.length > 0) {
      const checks = await verifyDomains(result.competitors.map((c) => c.domain));
      const checkByDomain = new Map(checks.map((c) => [c.domain, c]));
      result.competitors = result.competitors
        .map((c) => {
          const v = checkByDomain.get(c.domain.toLowerCase());
          if (!v) return { ...c, verified: false };
          return { ...c, verified: v.verified };
        })
        // Drop hallucinated/dead domains entirely.
        .filter((c) => c.verified);
    }

    return NextResponse.json({
      ok: true,
      url: extracted.url,
      result,
      excerpt: {
        title: extracted.title,
        description: extracted.description,
        h1: extracted.h1[0] ?? "",
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message ?? "detection failed" },
      { status: 500 },
    );
  }
}
