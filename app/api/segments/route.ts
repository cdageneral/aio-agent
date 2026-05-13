/**
 * Deprecated. The taxonomy was removed in favor of /api/detect-segment.
 * Returns 410 Gone to flag any lingering callers.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    { error: "Endpoint removed. Use POST /api/detect-segment instead." },
    { status: 410 },
  );
}
