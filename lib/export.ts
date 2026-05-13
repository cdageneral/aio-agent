/**
 * Drilldown export helpers — CSV (zero deps) and PDF (dynamic-imported
 * jsPDF so the library only ships when the user actually clicks PDF).
 *
 * Both formats:
 *  - Respect the caller's active filters (tab + cluster + search).
 *  - Include a metadata header so the file is self-describing months later.
 *  - Encode the filter context into the filename for tidy organization.
 */

export interface DrilldownExportRow {
  keyword: string;
  country: string;
  cluster: string | null;
  has_aio: boolean;
  citations_count: number;
  top_winner: string | null;
  top_winner_position: number | null;
  /** Plain-English client status: "cited #N" / "mentioned" / "missing" / "no AIO". */
  client_status: string;
}

export interface ExportContext {
  brand_name: string;
  filter_label: string;
  region_label: string;
  cluster_label: string;
}

// ── shared helpers ─────────────────────────────────────────────────────────

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function safeSlug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function buildFilename(ctx: ExportContext, ext: "csv" | "pdf") {
  return `aio-drilldown-${safeSlug(ctx.brand_name)}-${safeSlug(ctx.filter_label)}-${todayStamp()}.${ext}`;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── CSV (zero deps) ────────────────────────────────────────────────────────

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function exportDrilldownToCsv(rows: DrilldownExportRow[], ctx: ExportContext): void {
  const headers = [
    "Keyword",
    "Region",
    "Cluster",
    "AIO triggered",
    "Citations",
    "Top winner",
    "Winner position",
    `${ctx.brand_name} status`,
  ];
  const meta = [
    `# AIO Coverage Tracker — Keyword Drilldown export`,
    `# Brand: ${ctx.brand_name}`,
    `# Filter: ${ctx.filter_label}  ·  Region: ${ctx.region_label}  ·  Cluster: ${ctx.cluster_label}`,
    `# Exported: ${new Date().toISOString()}`,
    `# Rows: ${rows.length}`,
    ``,
  ];
  const body = rows.map((r) => [
    csvCell(r.keyword),
    csvCell(r.country.toUpperCase()),
    csvCell(r.cluster ?? "—"),
    csvCell(r.has_aio ? "yes" : "no"),
    csvCell(r.has_aio ? r.citations_count : ""),
    csvCell(r.top_winner ?? "—"),
    csvCell(r.top_winner_position ?? ""),
    csvCell(r.client_status),
  ].join(","));

  // UTF-8 BOM so Excel reads accents/unicode characters cleanly.
  const csv = "﻿" + [...meta, headers.map(csvCell).join(","), ...body].join("\n");
  triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8" }), buildFilename(ctx, "csv"));
}

// ── PDF (dynamic-imported) ────────────────────────────────────────────────

export async function exportDrilldownToPdf(rows: DrilldownExportRow[], ctx: ExportContext): Promise<void> {
  // Dynamic import keeps these out of the main bundle — they only load when
  // the user actually clicks the PDF button.
  const [{ default: jsPDF }, autoTableMod] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const autoTable = (autoTableMod as any).default ?? autoTableMod;

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();

  // Title block
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(20, 20, 20);
  doc.text("AIO Coverage Tracker — Keyword Drilldown", 40, 44);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(90, 90, 90);
  doc.text(
    `Brand: ${ctx.brand_name}   ·   Filter: ${ctx.filter_label}   ·   Region: ${ctx.region_label}   ·   Cluster: ${ctx.cluster_label}`,
    40, 62,
  );
  doc.text(`${rows.length} keyword${rows.length === 1 ? "" : "s"}   ·   Exported ${todayStamp()}`, 40, 76);

  autoTable(doc, {
    startY: 92,
    head: [["Keyword", "Region", "Cluster", "AIO", "Cites", "Top winner", `${ctx.brand_name} status`]],
    body: rows.map((r) => [
      r.keyword,
      r.country.toUpperCase(),
      r.cluster ?? "—",
      r.has_aio ? "yes" : "no",
      r.has_aio ? String(r.citations_count) : "",
      r.top_winner
        ? r.top_winner_position
          ? `${r.top_winner} #${r.top_winner_position}`
          : r.top_winner
        : "—",
      r.client_status,
    ]),
    styles: { fontSize: 9, cellPadding: 5, overflow: "linebreak" },
    headStyles: { fillColor: [17, 21, 29], textColor: [240, 246, 255], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [246, 247, 250] },
    columnStyles: {
      0: { cellWidth: 200 },
      1: { cellWidth: 50, halign: "center" },
      2: { cellWidth: 110 },
      3: { cellWidth: 40, halign: "center" },
      4: { cellWidth: 45, halign: "center" },
      5: { cellWidth: 160 },
      6: { cellWidth: "auto" },
    },
    margin: { left: 40, right: 40 },
    didDrawPage: (data: any) => {
      const pageCount = (doc as any).internal.getNumberOfPages?.() ?? 1;
      const current = data.pageNumber;
      doc.setFontSize(8);
      doc.setTextColor(140, 140, 140);
      doc.text(
        `Page ${current} of ${pageCount}`,
        pageWidth - 40,
        doc.internal.pageSize.getHeight() - 20,
        { align: "right" },
      );
    },
  });

  doc.save(buildFilename(ctx, "pdf"));
}
