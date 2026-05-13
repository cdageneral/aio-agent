/**
 * Bulk-set monthly search volume for keywords by CSV upload.
 * Accepts multipart/form-data with `file` containing rows: keyword, monthly_volume.
 * Header row optional. Matching is case-insensitive.
 */
import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import { sql } from "@vercel/postgres";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  const form = await req.formData();
  const file = form.get("file");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }
  const text = await file.text();
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
  const rows: { keyword: string; volume: number }[] = [];
  for (const row of parsed.data) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const kw = String(row[0]).trim();
    const vol = Number(String(row[1]).replace(/[^\d.]/g, ""));
    if (!kw || kw.toLowerCase() === "keyword") continue;
    if (!Number.isFinite(vol)) continue;
    rows.push({ keyword: kw, volume: Math.round(vol) });
  }
  if (rows.length === 0) return NextResponse.json({ updated: 0 });

  let updated = 0;
  for (const r of rows) {
    const { rowCount } = await sql.query(
      `UPDATE keywords SET monthly_volume = $1 WHERE project_id = $2 AND lower(keyword) = lower($3);`,
      [r.volume, ctx.params.id, r.keyword],
    );
    updated += rowCount ?? 0;
  }
  return NextResponse.json({ updated, attempted: rows.length });
}
