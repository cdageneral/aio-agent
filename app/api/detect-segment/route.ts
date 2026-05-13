/**
 * Smart segment detection — POST { url } returns a suggested industry,
 * category, subcategory, region, seed keywords, and competitors.
 *
 * Pipeline: fetch URL → strip HTML to ~2KB excerpt → Claude Haiku
 * classifies in structured JSON → verify suggested domains → return.
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
        { error: "Couldn't extract any text from this URL. The site may be JS-only or blocking bots — try a deeper page like /about or /products." },
        { status: 422 },
      );
    }
    const result = await detectSegment(extracted);

    // Liveness check on the LLM-suggested competitor domains.
    if (result.competitors.length > 0) {
      const checks = await verifyDomains(result.competitors.map((c) => c.domain));
      const checkByDomain = new Map(checks.map((c) => [c.domain, c]));
      result.competitors = result.competitors
        .map((c) => {
          const v = checkByDomain.get(c.domain.toLowerCase());
          if (!v) return { ...c, verified: false };
          return { ...c, verified: v.verified };
        })
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
    console.error("[/api/detect-segment] failed:", err);
    return NextResponse.json(
      { ok: false, error: friendlyDetectError(err) },
      { status: 500 },
    );
  }
}

function friendlyDetectError(err: any): string {
  const msg = String(err?.message ?? err ?? "");
  if (/ANTHROPIC_API_KEY/i.test(msg)) {
    return "ANTHROPIC_API_KEY is not set. Add it under Project Settings → Environment Variables and redeploy.";
  }
  if (/401/.test(msg) && /anthropic/i.test(msg)) {
    return "Anthropic API key was rejected. Check the key value in Vercel env vars.";
  }
  if (/Could not fetch/i.test(msg)) {
    return `${msg}. The site may be blocking bots — try without www., try a deeper page, or paste the segment manually via Edit.`;
  }
  if (/did not return JSON/i.test(msg) || /Could not parse/i.test(msg)) {
    return "Claude's response wasn't parseable. Click Detect again — it usually works on the second try.";
  }
  return msg || "Unknown detection error. Check the Vercel deployment logs.";
}
