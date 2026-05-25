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

// ── Full-report PDF (dashboard capture) ───────────────────────────────────
//
// v1.1.62 rewrite: printable white-paper layout.
//   • Cover sheet — white background with client name, scope metadata, and a
//     small visual executive summary (4 KPI tiles drawn natively via jsPDF
//     primitives so the cover renders crisply even though the dashboard
//     proper is captured as bitmaps).
//   • Section order is fixed and user-prescribed (executive summary cards →
//     tracked-brand comparison → what changed → position-over-time chart →
//     topic clusters → cluster prioritization → keyword drilldown). The
//     exporter looks up each section by its `data-export-section` attribute
//     instead of walking direct children, which was order-coupled to the JSX.
//   • Print mode — the report root gets `data-aio-export-print="true"`
//     stamped on it while the capture pass runs. CSS rules in globals.css
//     repaint surfaces white and bump muted text to print-readable grey
//     during that window. The attribute is removed in a finally block so a
//     failed capture can't leave the live dashboard repainted.
//   • CitationLandscape only shows one tab at a time; the user asked for the
//     "Tracked brands" table specifically. We dispatch the panel's own
//     SHOW_TAB_EVENT to flip it to that tab before capturing the section.
//
// All libs are dynamic-imported so they only ship to the browser when the
// user actually clicks Export.

export interface FullReportContext {
  brand_name: string;
  client_url: string;
  region_label: string;
  /** ISO timestamp string. Defaults to now if omitted. */
  generated_at?: string;
  /** v1.1.62: latest snapshot payload — used to render the cover-page
   *  executive summary tiles via jsPDF primitives. May be null when no
   *  snapshot exists yet; the cover then renders without the tiles. */
  latest?: any | null;
}

/** The user-prescribed section order for the printable export. Each entry
 *  pairs the `data-export-section` value with a display title shown on the
 *  section's title banner. If the matching node isn't on the page (e.g.
 *  no snapshot yet so a panel is hidden), it's silently skipped. */
const PRINT_SECTION_ORDER: { key: string; title: string }[] = [
  { key: "story",          title: "Executive summary" },
  { key: "brands",         title: "Tracked brand comparison" },
  { key: "what-changed",   title: "What changed — client and competitors" },
  { key: "position-chart", title: "Your position over time" },
  { key: "clusters",       title: "Topic clusters" },
  { key: "prioritization", title: "Cluster prioritization — AIO opportunities" },
  { key: "drilldown",      title: "Keyword drilldown" },
];

/** Resolve the desired sections in print order. Skips any that aren't
 *  currently in the DOM (no warning — the panel is simply absent in the
 *  PDF if the user hasn't run a refresh yet). */
function collectPrintSections(root: HTMLElement): { el: HTMLElement; title: string }[] {
  const out: { el: HTMLElement; title: string }[] = [];
  for (const { key, title } of PRINT_SECTION_ORDER) {
    const el = root.querySelector<HTMLElement>(`[data-export-section="${key}"]`);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    out.push({ el, title });
  }
  return out;
}

/** Pull cover-sheet metrics off the `latest` payload. Returns null when the
 *  snapshot is missing or empty so the cover knows to skip the KPI strip. */
interface CoverKpi { label: string; value: string; sub: string; accent: [number, number, number]; }
function deriveCoverKpis(latest: any | null, brandName: string): CoverKpi[] | null {
  if (!latest || !latest.total_keywords) return null;
  const totalKw = latest.total_keywords ?? 0;
  const totalAios = latest.total_aios_triggered ?? 0;
  const totalSlots = latest.total_citation_slots ?? 0;
  const triggerPct = totalKw > 0 ? totalAios / totalKw : 0;
  const client = (latest.brands ?? []).find((b: any) => b.kind === "client");
  const ranked = [...(latest.brands ?? [])].sort(
    (a: any, b: any) => (b.citation_rate ?? 0) - (a.citation_rate ?? 0),
  );
  const topBrand = ranked[0];
  const clientCitationRate = client?.citation_rate ?? 0;
  const clientShare = totalKw ? (client?.aios_acquired ?? 0) / totalKw : 0;

  // RGB tuples for the accent stripes — same semantic mapping the live
  // dashboard uses (cyan = market, blue = client, lime = positive growth,
  // pink = competition).
  const KPI_CYAN: [number, number, number] = [37, 178, 165];
  const KPI_BLUE: [number, number, number] = [31, 79, 196];
  const KPI_LIME: [number, number, number] = [61, 122, 20];
  const KPI_PINK: [number, number, number] = [196, 47, 116];

  return [
    {
      label: "AIO PENETRATION",
      value: `${(triggerPct * 100).toFixed(1)}%`,
      sub: `${totalAios.toLocaleString()} of ${totalKw.toLocaleString()} queries`,
      accent: KPI_CYAN,
    },
    {
      label: "YOUR POSITION",
      value: `${(clientCitationRate * 100).toFixed(1)}%`,
      sub: `${brandName} citation rate`,
      accent: KPI_BLUE,
    },
    {
      label: "CITATION SHARE",
      value: `${(clientShare * 100).toFixed(1)}%`,
      sub: `${(client?.aios_acquired ?? 0).toLocaleString()} of ${totalKw.toLocaleString()} citations`,
      accent: KPI_LIME,
    },
    {
      label: "TOP BRAND",
      value: topBrand ? `${((topBrand.citation_rate ?? 0) * 100).toFixed(1)}%` : "—",
      sub: topBrand ? `${topBrand.brand_name}${topBrand.kind === "client" ? " · you lead" : ""}` : "—",
      accent: KPI_PINK,
    },
  ];
}

/** Draw a small KPI tile on the cover page. Pure jsPDF primitives — no
 *  bitmap, so the cover scales crisply on print. Tile is `width` pt wide,
 *  ~88 pt tall, with a 3 pt accent stripe down the left edge. */
function drawCoverKpi(
  doc: any,
  kpi: CoverKpi,
  x: number,
  y: number,
  width: number,
): void {
  const height = 86;
  // Tile background — very light grey fill, hairline border.
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(216, 221, 230);
  doc.setLineWidth(0.6);
  doc.roundedRect(x, y, width, height, 6, 6, "FD");

  // Accent stripe on the left edge.
  doc.setFillColor(kpi.accent[0], kpi.accent[1], kpi.accent[2]);
  doc.rect(x, y, 3, height, "F");

  // Uppercase label.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(kpi.accent[0], kpi.accent[1], kpi.accent[2]);
  doc.text(kpi.label, x + 12, y + 18);

  // Big value — the headline number/percentage.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(26, 29, 36);
  doc.text(kpi.value, x + 12, y + 48);

  // Sub-caption — context line under the value. Wrap if needed.
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(112, 122, 140);
  const wrapped = doc.splitTextToSize(kpi.sub, width - 18) as string[];
  doc.text(wrapped.slice(0, 2), x + 12, y + 64);
}

/** Draw the printable cover sheet. White background, client name in large
 *  type, then a small visual executive summary at the bottom. */
function drawPrintCover(doc: any, ctx: FullReportContext, sectionsCount: number): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 48;

  // White paper canvas.
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, pageWidth, pageHeight, "F");

  // Header eyebrow — small report-type label, sits above the title.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(31, 79, 196);
  doc.text("AIO COVERAGE REPORT", margin, 96, { charSpace: 1.5 });

  // Hairline accent under the eyebrow.
  doc.setDrawColor(31, 79, 196);
  doc.setLineWidth(2);
  doc.line(margin, 104, margin + 36, 104);

  // Client name — the dominant element on the cover.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(36);
  doc.setTextColor(20, 22, 28);
  doc.text(ctx.brand_name, margin, 154);

  // Client URL — secondary, dim grey.
  doc.setFont("helvetica", "normal");
  doc.setFontSize(13);
  doc.setTextColor(90, 100, 120);
  doc.text(ctx.client_url, margin, 178);

  // Scope metadata block.
  const generated = ctx.generated_at ?? new Date().toISOString();
  const stamp = new Date(generated).toLocaleString();
  doc.setFontSize(10.5);
  doc.setTextColor(74, 84, 102);
  doc.text(`Region:  ${ctx.region_label}`, margin, 218);
  doc.text(`Generated:  ${stamp}`, margin, 236);
  doc.text(`Sections:  ${sectionsCount}`, margin, 254);

  // ── Small visual executive summary ─────────────────────────────────────
  const kpis = deriveCoverKpis(ctx.latest ?? null, ctx.brand_name);
  if (kpis) {
    // Section divider above the KPI strip — visual break between the
    // identity block and the data block.
    doc.setDrawColor(216, 221, 230);
    doc.setLineWidth(0.5);
    doc.line(margin, 308, pageWidth - margin, 308);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(74, 84, 102);
    doc.text("EXECUTIVE SUMMARY", margin, 332, { charSpace: 1.2 });

    // 2 × 2 grid of KPI tiles. 2-up keeps each tile readable on Letter
    // portrait — a 4-up strip would crush the value font.
    const gridGap = 12;
    const contentWidth = pageWidth - margin * 2;
    const tileWidth = (contentWidth - gridGap) / 2;
    const tileTop = 350;
    const rowHeight = 86 + gridGap;
    kpis.forEach((kpi, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = margin + col * (tileWidth + gridGap);
      const y = tileTop + row * rowHeight;
      drawCoverKpi(doc, kpi, x, y, tileWidth);
    });
  } else {
    // No snapshot yet — note the absence so the cover doesn't look broken.
    doc.setFont("helvetica", "italic");
    doc.setFontSize(11);
    doc.setTextColor(140, 148, 165);
    doc.text(
      "No snapshot data available yet — run a refresh to populate the executive summary.",
      margin, 332,
    );
  }

  // Footer signature on the cover.
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(140, 148, 165);
  doc.text("AIO Coverage Tracker · Printable report", margin, pageHeight - 36);
}

/** Footer drawn on every section page. Dark text on white for print. */
function drawPrintFooter(doc: any, ctx: FullReportContext): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageNum = doc.internal.getNumberOfPages?.() ?? 1;
  doc.setDrawColor(216, 221, 230);
  doc.setLineWidth(0.5);
  doc.line(36, pageHeight - 30, pageWidth - 36, pageHeight - 30);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(112, 122, 140);
  doc.text(`AIO Coverage Tracker · ${ctx.brand_name}`, 36, pageHeight - 16);
  doc.text(`Page ${pageNum}`, pageWidth - 36, pageHeight - 16, { align: "right" });
}

/** Draw a section title banner at a given y in points. Returns the y where
 *  the banner ends so the caller knows where to start the bitmap. */
function drawSectionBanner(doc: any, title: string, x: number, y: number, width: number): number {
  const height = 28;
  // Banner background — light blue tint.
  doc.setFillColor(241, 244, 251);
  doc.roundedRect(x, y, width, height, 4, 4, "F");
  // Left accent bar.
  doc.setFillColor(31, 79, 196);
  doc.rect(x, y, 4, height, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12.5);
  doc.setTextColor(26, 29, 36);
  doc.text(title, x + 14, y + 18);
  return y + height + 10;
}

/** html2canvas onclone hook — runs inside the cloned DOM right before
 *  bitmap rasterization. Belt-and-suspenders to the print-mode CSS in
 *  globals.css: rewrites hardcoded dark inline `background-color` and
 *  `color` values that the StoryPanel and CitationLandscape components
 *  set via inline style. CSS variable overrides handle the rest. */
function recolorClonedTreeForPrint(_doc: Document, root: HTMLElement): void {
  // Make sure the clone is print-flagged even if the source page hadn't
  // propagated the attribute by the time html2canvas snapshotted it.
  const reportRoot = root.closest<HTMLElement>('[data-aio-report-root="true"]') ?? root;
  reportRoot.setAttribute("data-aio-export-print", "true");

  // Source-of-truth maps: known dark colors → print-friendly replacements.
  // Browsers normalize inline `style.backgroundColor` to "rgb(...)" form,
  // so we match against the rgb spelling rather than the hex.
  const DARK_BG_TO_LIGHT: Record<string, string> = {
    "rgb(12, 15, 21)":  "#ffffff", // surface --   #0c0f15
    "rgb(17, 21, 29)":  "#f7f8fa", // surface-2 -- #11151d
    "rgb(6, 7, 11)":    "#ffffff", // bg --        #06070b
    "rgb(11, 13, 18)":  "#ffffff", // legacy cover bg
    "rgb(20, 24, 32)":  "#f7f8fa", // scope toggle tile bg
  };
  const NEAR_WHITE_TO_INK: Record<string, string> = {
    "rgb(244, 246, 251)": "#1a1d24", // --text
    "rgb(214, 219, 230)": "#1a1d24", // segmented control inactive text
  };
  const MUTED_GREY_TO_PRINT: Record<string, string> = {
    "rgb(138, 147, 166)": "#4a5466", // --muted
    "rgb(90, 100, 120)":  "#707a8c", // --dim
  };

  const all = root.querySelectorAll<HTMLElement>("*");
  all.forEach((n) => {
    if (!(n instanceof HTMLElement)) return;

    const bg = n.style.backgroundColor;
    if (bg && DARK_BG_TO_LIGHT[bg]) {
      n.style.backgroundColor = DARK_BG_TO_LIGHT[bg];
      // The borders set alongside these dark backgrounds use translucent
      // white that disappears on white paper — bump them to a hairline
      // print grey so panels still have visible edges.
      if (n.style.borderColor && n.style.borderColor.includes("255")) {
        n.style.borderColor = "rgba(0,0,0,0.10)";
      }
    }
    // Translucent white-on-dark overlays (rgba(255,255,255,0.0x)) vanish on
    // a white page. Repaint to a faint cool grey so the layout still reads.
    if (bg && bg.startsWith("rgba(255, 255, 255")) {
      n.style.backgroundColor = "#f7f8fa";
    }

    const fg = n.style.color;
    if (fg && NEAR_WHITE_TO_INK[fg]) {
      n.style.color = NEAR_WHITE_TO_INK[fg];
    } else if (fg && MUTED_GREY_TO_PRINT[fg]) {
      n.style.color = MUTED_GREY_TO_PRINT[fg];
    }

    // Translucent dark borders (rgba(255,255,255,0.0x)) — same fix as bg.
    const bc = n.style.borderColor;
    if (bc && bc.startsWith("rgba(255, 255, 255")) {
      n.style.borderColor = "rgba(0,0,0,0.10)";
    }
  });
}

export async function exportFullReportToPdf(
  root: HTMLElement,
  ctx: FullReportContext,
): Promise<void> {
  const [{ default: jsPDF }, html2canvasMod] = await Promise.all([
    import("jspdf"),
    import("html2canvas"),
  ]);
  const html2canvas = (html2canvasMod as any).default ?? html2canvasMod;

  // ── Pre-capture setup ───────────────────────────────────────────────────
  // 1. Flip the report root into print mode so the CSS overrides in
  //    globals.css repaint surfaces white.
  // 2. Force the Citation landscape panel to its "brands" tab — the user
  //    asked for the tracked-brand comparison table specifically, and
  //    CitationLandscape only renders one tab at a time. We dispatch the
  //    panel's own SHOW_TAB_EVENT (defined in CitationLandscape.tsx).
  // 3. Wait one paint frame so React has a chance to re-render before we
  //    start snapshotting.
  root.setAttribute("data-aio-export-print", "true");
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("aio:citation-landscape-show-tab", { detail: { tab: "brands" } }),
    );
  }
  // Two animation frames + a microtask — empirically enough for Recharts
  // to settle on the new CSS-var-driven text fills.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));

  try {
    const sections = collectPrintSections(root);
    if (sections.length === 0) {
      throw new Error("No dashboard sections found to export.");
    }

    // Letter portrait, points. 612 x 792 with a 48 pt margin all around for
    // the cover and a 36 pt margin for content pages (more breathable cover).
    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const contentMargin = 36;
    const contentWidth = pageWidth - contentMargin * 2;

    // ── Cover page ────────────────────────────────────────────────────────
    drawPrintCover(doc, ctx, sections.length);

    // ── Section pages ─────────────────────────────────────────────────────
    // For each section: snapshot to a white canvas, then lay it out on its
    // own page (or slice across pages if it's taller than one page). Each
    // section starts on a fresh page with a title banner above the bitmap.
    for (let i = 0; i < sections.length; i++) {
      const { el, title } = sections[i];
      // eslint-disable-next-line no-await-in-loop
      const canvas = await html2canvas(el, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        logging: false,
        windowWidth: el.scrollWidth,
        windowHeight: el.scrollHeight,
        onclone: (clonedDoc: Document, clonedEl: HTMLElement) => {
          recolorClonedTreeForPrint(clonedDoc, clonedEl);
        },
      });

      const imgWidthPx = canvas.width;
      const imgHeightPx = canvas.height;
      const bannerHeight = 38; // banner + spacing under it
      const usableHeight = pageHeight - contentMargin * 2 - 24; // reserve room for footer
      const firstPageImgHeight = usableHeight - bannerHeight;

      // Scale: fit canvas to contentWidth, see how tall the rendered image is.
      const renderWidth = contentWidth;
      const renderHeight = (imgHeightPx * contentWidth) / imgWidthPx;

      if (renderHeight <= firstPageImgHeight) {
        // Whole section fits on one page below the title banner.
        doc.addPage();
        doc.setFillColor(255, 255, 255);
        doc.rect(0, 0, pageWidth, pageHeight, "F");
        const imgY = drawSectionBanner(doc, title, contentMargin, contentMargin, contentWidth);
        doc.addImage(
          canvas.toDataURL("image/png"),
          "PNG",
          contentMargin, imgY,
          renderWidth, renderHeight,
        );
        drawPrintFooter(doc, ctx);
      } else {
        // Section is taller than one page — slice the source canvas vertically
        // and place each slice on its own page. The first page carries the
        // title banner; subsequent pages give the full usable height to the
        // bitmap continuation (no repeated banner).
        const firstSlicePx = Math.floor((firstPageImgHeight * imgWidthPx) / contentWidth);
        const subsequentSlicePx = Math.floor((usableHeight * imgWidthPx) / contentWidth);

        let yOffsetPx = 0;
        let isFirst = true;
        while (yOffsetPx < imgHeightPx) {
          const slicePx = isFirst ? firstSlicePx : subsequentSlicePx;
          const thisSlicePx = Math.min(slicePx, imgHeightPx - yOffsetPx);
          const sliceCanvas = document.createElement("canvas");
          sliceCanvas.width = imgWidthPx;
          sliceCanvas.height = thisSlicePx;
          const sctx = sliceCanvas.getContext("2d");
          if (!sctx) break;
          sctx.fillStyle = "#ffffff";
          sctx.fillRect(0, 0, imgWidthPx, thisSlicePx);
          sctx.drawImage(
            canvas,
            0, yOffsetPx, imgWidthPx, thisSlicePx,
            0, 0, imgWidthPx, thisSlicePx,
          );

          const sliceRenderHeight = (thisSlicePx * contentWidth) / imgWidthPx;
          doc.addPage();
          doc.setFillColor(255, 255, 255);
          doc.rect(0, 0, pageWidth, pageHeight, "F");
          let imgY = contentMargin;
          if (isFirst) {
            imgY = drawSectionBanner(doc, title, contentMargin, contentMargin, contentWidth);
          }
          doc.addImage(
            sliceCanvas.toDataURL("image/png"),
            "PNG",
            contentMargin, imgY,
            renderWidth, sliceRenderHeight,
          );
          drawPrintFooter(doc, ctx);

          yOffsetPx += thisSlicePx;
          isFirst = false;
        }
      }
    }

    const filename = `aio-full-report-${safeSlug(ctx.brand_name)}-${todayStamp()}.pdf`;
    doc.save(filename);
  } finally {
    // Always clear print mode, even if capture threw — otherwise the live
    // dashboard would stay repainted in light theme until next reload.
    root.removeAttribute("data-aio-export-print");
  }
}

// ── PPT Prompt Builder ────────────────────────────────────────────────────
//
// v1.1.33: Generates a long-form natural-language prompt the user can paste
// into Claude/ChatGPT/Copilot inside PowerPoint. The receiving AI is told to
// match the style of whatever deck the user currently has open, and is given
// every concrete number it needs to fill in two slides identical in
// information density to the reference layouts:
//
//   Slide A — "AIO landscape" — KPI strip + share of voice + top non-brand domains
//   Slide B — "AIO opportunity map" — 3 summary cards + cluster grid
//
// The function is pure: pass in the SnapshotMetrics-shaped `latest` payload
// (plus a small context object) and it returns a string. The caller is
// responsible for getting it onto the clipboard.

export interface PptPromptContext {
  brand_name: string;
  client_url: string;
  region_label: string;
  /** ISO timestamp. Defaults to now if omitted. */
  generated_at?: string;
  /** Optional human label for the keyword universe theme — e.g. "TRT/HRT". */
  universe_label?: string;
}

/** Loose shape — keeps the helper independent of the lib/metrics types so
 *  callers (which receive `latest` as `any` from /api/.../metrics) can pass
 *  it straight through without casting hoops. */
interface PptPromptLatest {
  total_keywords?: number;
  total_aios_triggered?: number;
  total_citation_slots?: number;
  brands?: Array<{
    brand_name: string;
    kind: "client" | "competitor";
    citation_slots?: number;
    citation_rate?: number;
    mention_count?: number;
    mention_rate?: number;
    aios_acquired?: number;
  }>;
  share_of_voice?: Array<{
    label: string;
    kind: "client" | "competitor" | "bucket";
    slots: number;
    share: number;
  }>;
  other_domains?: Array<{ domain: string; count: number; source_type?: string }>;
  clusters?: Array<{
    name: string;
    keyword_count: number;
    aio_count: number;
    aio_penetration: number;
    client_citation_rate: number;
    top_winner: { brand_name: string; kind: "client" | "competitor"; citation_rate: number } | null;
    brand_shares?: Array<{ brand_name: string; kind: "client" | "competitor"; share: number }>;
  }>;
}

function pct(n: number | undefined, digits = 1): string {
  if (n == null || isNaN(n)) return "0%";
  return `${(n * 100).toFixed(digits)}%`;
}

function intFmt(n: number | undefined): string {
  if (n == null || isNaN(n)) return "0";
  return n.toLocaleString("en-US");
}

export function buildPptPrompt(latest: PptPromptLatest | null, ctx: PptPromptContext): string {
  const brand = ctx.brand_name;
  const universe = ctx.universe_label ? ` (${ctx.universe_label})` : "";
  const generated = ctx.generated_at ?? new Date().toISOString();
  const stampHuman = new Date(generated).toLocaleString();

  if (!latest) {
    return [
      `# PowerPoint slide-generation prompt — AIO Coverage Tracker`,
      ``,
      `No snapshot data is available yet for **${brand}**. Run a refresh first, then click "Copy PPT Prompt" again.`,
    ].join("\n");
  }

  const totalKw = latest.total_keywords ?? 0;
  const totalAios = latest.total_aios_triggered ?? 0;
  const totalSlots = latest.total_citation_slots ?? 0;
  const penetration = totalKw > 0 ? totalAios / totalKw : 0;

  // Pull client brand metrics
  const clientBrand = latest.brands?.find((b) => b.kind === "client");
  const competitorBrands = (latest.brands ?? []).filter((b) => b.kind === "competitor");
  const clientCitationRate = clientBrand?.citation_rate ?? 0;
  const clientMentionRate = clientBrand?.mention_rate ?? 0;
  const clientMentions = clientBrand?.mention_count ?? 0;
  const clientSlots = clientBrand?.citation_slots ?? 0;

  // Top brand (by citation_rate, excluding any with 0)
  const allBrandsSorted = [...(latest.brands ?? [])].sort(
    (a, b) => (b.citation_rate ?? 0) - (a.citation_rate ?? 0),
  );
  const topBrand = allBrandsSorted[0];
  const topBrandIsClient = topBrand?.kind === "client";

  // Brand-only share of voice rank for the client
  const trackedSov = (latest.share_of_voice ?? []).filter((s) => s.kind !== "bucket");
  const trackedSovSorted = [...trackedSov].sort((a, b) => b.slots - a.slots);
  const clientRank = trackedSovSorted.findIndex((s) => s.label === brand) + 1;

  // Non-brand share (sum of bucket slices)
  const nonBrandShare = (latest.share_of_voice ?? [])
    .filter((s) => s.kind === "bucket")
    .reduce((acc, s) => acc + s.share, 0);

  // Top non-brand domains (raw count of AIOs each appears in)
  const topDomains = (latest.other_domains ?? []).slice(0, 8);

  // Cluster slicing
  const clusters = latest.clusters ?? [];
  const leadClusters = clusters.filter((c) => c.top_winner?.kind === "client");
  const trailClusters = clusters.filter((c) => c.top_winner && c.top_winner.kind === "competitor");
  const openClusters = clusters.filter((c) => !c.top_winner || c.aio_count === 0);

  // Top trailing competitor (for the summary card subtitle)
  const trailWinnerCounts = new Map<string, number>();
  for (const c of trailClusters) {
    const w = c.top_winner?.brand_name;
    if (w) trailWinnerCounts.set(w, (trailWinnerCounts.get(w) ?? 0) + 1);
  }
  const topTrailingCompetitor = [...trailWinnerCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const trailExamples = trailClusters.slice(0, 2).map((c) => c.name).join(" & ");

  // Lines

  const kpiLines = [
    `1. AVAILABLE AIOs — number: ${intFmt(totalAios)} — caption: "AI Overviews across ${intFmt(totalKw)} tracked queries"`,
    `2. AIO PENETRATION IN SERP — number: ${pct(penetration)} — caption: "${intFmt(totalAios)} of ${intFmt(totalKw)} queries trigger an AIO"`,
    `3. ACQUISITION — number: ${pct(clientCitationRate)} — caption: "${brand} ${topBrandIsClient ? "leads the field" : `trails ${topBrand?.brand_name ?? "competitors"}`}"`,
    `4. BRAND MENTIONS — number: ${pct(clientMentionRate)} — caption: "${intFmt(clientMentions)} of ${intFmt(totalKw)} mentions"`,
    `5. CITATION SHARE — number: ${pct(clientSlots && totalSlots ? clientSlots / totalSlots : 0)} — caption: "${intFmt(clientSlots)} of ${intFmt(totalSlots)} citations"`,
    `6. TOP BRAND — number: ${pct(topBrand?.citation_rate ?? 0)} — caption: "${topBrand?.brand_name ?? "—"} ranks #1"`,
    `7. OTHERS — number: ${pct(nonBrandShare)} — caption: "non-brand share"`,
  ].join("\n");

  const sovBrandLines = trackedSovSorted.map((s) => {
    const isClient = s.label === brand;
    return `  - ${s.label}${isClient ? " (highlight as YOU)" : ""}: ${pct(s.share)} · ${intFmt(s.slots)} slots`;
  }).join("\n");

  const sovBucketLines = (latest.share_of_voice ?? [])
    .filter((s) => s.kind === "bucket")
    .sort((a, b) => b.slots - a.slots)
    .map((s) => `  - ${s.label}: ${pct(s.share)} · ${intFmt(s.slots)} slots`)
    .join("\n");

  const domainLines = topDomains.map((d) => `  - ${d.domain}: ${intFmt(d.count)} AIOs`).join("\n");

  const clusterLines = clusters.map((c, i) => {
    let status: "LEAD" | "TRAIL" | "OPEN";
    let caption: string;
    if (c.top_winner?.kind === "client") {
      status = "LEAD";
      caption = "we lead";
    } else if (c.top_winner?.kind === "competitor") {
      status = "TRAIL";
      caption = `${c.top_winner.brand_name} ${pct(c.top_winner.citation_rate)}`;
    } else {
      status = "OPEN";
      caption = c.aio_count === 0 ? "no AIOs yet" : "no winner";
    }
    return [
      `${i + 1}. ${c.name} — STATUS: ${status}`,
      `   - meta: ${intFmt(c.keyword_count)} kw · ${intFmt(c.aio_count)} AIOs · ${pct(c.aio_penetration, 0)} penetration`,
      `   - big number: ${pct(c.client_citation_rate, 0)} (${brand} citation rate within cluster)`,
      `   - caption under number: "${caption}"`,
    ].join("\n");
  }).join("\n");

  // Insight line for the orange "THE READ" callout on slide 2
  const insight = (() => {
    if (clusters.length === 0) return `Clusters haven't been generated for this snapshot yet — run a cluster pass first.`;
    const avgLead = leadClusters.length > 0
      ? leadClusters.reduce((a, c) => a + c.client_citation_rate, 0) / leadClusters.length
      : 0;
    if (leadClusters.length > 0 && openClusters.length > 0) {
      return `${brand} leads in ${leadClusters.length} cluster${leadClusters.length === 1 ? "" : "s"} but at ${pct(avgLead, 0)} avg citation rate — we win where no one tries hard. The ${openClusters.length} open cluster${openClusters.length === 1 ? "" : "s"} are the land grab.`;
    }
    if (trailClusters.length > 0) {
      return `${topTrailingCompetitor ?? "Competitors"} dominate${topTrailingCompetitor ? "s" : ""} ${trailClusters.length} cluster${trailClusters.length === 1 ? "" : "s"} — opportunity to displace.`;
    }
    return `Cluster picture is wide open — ${openClusters.length} of ${clusters.length} have no winner yet.`;
  })();

  const trailSubtitle = topTrailingCompetitor && trailExamples
    ? `${topTrailingCompetitor} owns ${trailExamples}`
    : trailClusters.length === 0
      ? "no clusters trailing"
      : "competitors lead";

  // Final assembled prompt
  return `# PowerPoint slide-generation prompt — AIO Coverage Tracker
# Brand: ${brand}${universe} · Region: ${ctx.region_label} · Generated: ${stampHuman}

You are generating two PowerPoint slides inside the deck I currently have open.

────────────────────────────────────────────────────────────
STYLE INSTRUCTIONS (READ FIRST)
────────────────────────────────────────────────────────────
- MATCH THE ACTIVE DECK. Infer typography, color palette, header/banner treatment, accent colors, card styles, and spacing from the master slide and existing slides in this deck. Do NOT introduce colors or fonts that aren't already present in the deck's theme.
- Reuse the deck's existing title-bar / header style for both slides.
- Use the deck's primary heading font for big numbers, secondary font for captions.
- If the deck uses status colors (positive / negative / neutral), use those for LEAD / TRAIL / OPEN respectively. If not, use green / red / gray as a fallback.
- Information density should be HIGH but legible — these are executive reference slides, not minimalist hero slides. Use thin colored accent bars above KPI tiles to organize the eye.
- Both slides are 16:9. Use the deck's standard margin/safe-area.

────────────────────────────────────────────────────────────
SLIDE 1 — "AIO landscape${universe ? ` —${universe.replace(/[()]/g, "")} keyword set` : ""}"
────────────────────────────────────────────────────────────
TITLE: AIO landscape${universe ? ` —${universe.replace(/[()]/g, "")} keyword set` : ` — ${brand} keyword set`}
SUBTITLE: ${intFmt(totalAios)} AI Overviews across ${intFmt(totalKw)} tracked queries · ${intFmt(totalSlots)} citation slots · who Google trusts vs. who's invisible

TOP REGION — KPI ROW (7 stat cards in a single horizontal strip, each with a thin colored accent bar above the label):
${kpiLines}

BOTTOM REGION — Three columns:

LEFT COLUMN — Featured highlight tile titled "${brand.toUpperCase()}":
  - Big number: ${pct(clientSlots && totalSlots ? clientSlots / totalSlots : 0)}
  - Sublabel: "of all citations"
  - Detail line: "${intFmt(clientSlots)} slots / ${intFmt(totalSlots)}"
  - Footer line: "${clientRank > 0 ? `Ranks #${clientRank} brand-only` : "Not yet ranked"}"

MIDDLE COLUMN — "CITATION SHARE BY BRAND" horizontal bar chart:
  Brand bars (in order, longest first):
${sovBrandLines || "  (no tracked brand citations yet)"}
  Divider labeled "NON-BRAND", then bucket bars:
${sovBucketLines || "  (no non-brand citations yet)"}

RIGHT COLUMN — "TOP NON-BRAND DOMAINS · WHO GOOGLE TRUSTS" horizontal bar chart:
${domainLines || "  (no non-brand domains yet)"}

FOOTER on slide: "Source: ${brand} AIO crawl, ${ctx.universe_label ? ctx.universe_label + " " : ""}keyword universe (${intFmt(totalKw)} queries), ${stampHuman}. Citation slots = distinct domains cited per AIO, summed across all ${intFmt(totalAios)} AIOs."

────────────────────────────────────────────────────────────
SLIDE 2 — "AIO opportunity map — ${clusters.length} ${ctx.universe_label ?? brand} clusters"
────────────────────────────────────────────────────────────
TITLE: AIO opportunity map — ${clusters.length} ${ctx.universe_label ?? brand} cluster${clusters.length === 1 ? "" : "s"}
SUBTITLE: Where ${brand} is already winning AIO citations · where competitors lead · where the whole category is wide open

TOP REGION — 3 summary cards (each with a thin colored accent bar above):
  1. CLUSTERS WHERE ${brand.toUpperCase()} LEADS — accent: positive/green
     - Big number: ${leadClusters.length} of ${clusters.length}
     - Caption: "we already win the citation race"
  2. CLUSTERS WHERE WE TRAIL — accent: negative/red
     - Big number: ${trailClusters.length} of ${clusters.length}
     - Caption: "${trailSubtitle}"
  3. CLUSTERS WIDE OPEN (NO ONE WINS) — accent: neutral/gray
     - Big number: ${openClusters.length} of ${clusters.length}
     - Caption: "everyone at 0% — land grab"

BOTTOM REGION — Cluster grid (lay out as 4 rows × 5 columns, or whatever fits the deck; cards in this order):
${clusterLines || "  (no clusters yet — run a cluster pass first)"}

ORANGE CALLOUT STRIP at the bottom of slide 2, labeled "THE READ":
"${insight}"

────────────────────────────────────────────────────────────
FINAL REMINDERS
────────────────────────────────────────────────────────────
- Numbers must match exactly as given above — do not round differently or recalculate.
- LEAD = positive color, TRAIL = negative color, OPEN = neutral/muted.
- Keep both slides on the deck's master so they pick up any future theme changes automatically.
- After generating, briefly confirm in chat which slide layout/master you applied so I can verify.`;
}
