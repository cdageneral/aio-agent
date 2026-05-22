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
// v1.1.32: Renders the entire dashboard to a multi-page PDF by snapshotting
// each top-level <section> (and the header) individually with html2canvas,
// then laying the resulting bitmaps onto Letter-sized PDF pages. Capturing
// per-section (instead of one giant capture) keeps each panel intact across
// page breaks — no charts get sliced in half — and keeps memory bounded on
// long dashboards.
//
// All libs are dynamic-imported so they only ship to the browser when the
// user actually clicks Export. The function expects a DOM element that wraps
// the dashboard panels (Dashboard.tsx attaches a ref via `data-aio-report-root`).

export interface FullReportContext {
  brand_name: string;
  client_url: string;
  region_label: string;
  /** ISO timestamp string. Defaults to now if omitted. */
  generated_at?: string;
}

/**
 * Capture every direct child of `root` that should appear in the report.
 * We grab the immediate children rather than calling html2canvas on the whole
 * tree so a) charts don't get sliced across pages, and b) the .next/Image
 * proxy and sticky overlays inside child panels don't confuse the renderer.
 */
function collectReportSections(root: HTMLElement): HTMLElement[] {
  // Direct children of the Dashboard wrapper are <ProjectHeader>, the inline
  // "Updating…" pill, refresh-message text, and the result <section>s. We
  // filter to anything that's a real renderable block with non-zero size.
  const kids = Array.from(root.children) as HTMLElement[];
  return kids.filter((el) => {
    if (!(el instanceof HTMLElement)) return false;
    // Skip the transient "Updating…" pill and empty text wrappers — they're
    // noise in a report.
    if (el.getAttribute("aria-live") === "polite") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
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

  const sections = collectReportSections(root);
  if (sections.length === 0) {
    throw new Error("No dashboard sections found to export.");
  }

  // Letter portrait, points. 612 x 792 with a 36pt margin all around.
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 36;
  const contentWidth = pageWidth - margin * 2;

  // ── Cover page ──────────────────────────────────────────────────────────
  // Dark background to match the app's aesthetic. Drawn as a filled rect so
  // it covers the whole first page edge-to-edge.
  doc.setFillColor(11, 13, 18);
  doc.rect(0, 0, pageWidth, pageHeight, "F");

  doc.setTextColor(244, 246, 251);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  doc.text("AIO Coverage Report", margin, 140);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(14);
  doc.setTextColor(182, 245, 59);
  doc.text(ctx.brand_name, margin, 172);

  doc.setFontSize(11);
  doc.setTextColor(190, 196, 210);
  doc.text(ctx.client_url, margin, 192);

  const generated = ctx.generated_at ?? new Date().toISOString();
  const stamp = new Date(generated).toLocaleString();
  doc.setFontSize(10);
  doc.setTextColor(140, 148, 165);
  doc.text(`Region: ${ctx.region_label}`, margin, 230);
  doc.text(`Generated: ${stamp}`, margin, 248);
  doc.text(`Sections: ${sections.length}`, margin, 266);

  // Footer brand strip on the cover
  doc.setDrawColor(37, 224, 206);
  doc.setLineWidth(2);
  doc.line(margin, 290, margin + 120, 290);

  // ── Section pages ───────────────────────────────────────────────────────
  // For each section: snapshot to canvas, then paginate the resulting image
  // across as many PDF pages as it needs. Section background is forced to the
  // app's dark surface color so the captured DOM has a consistent look even
  // when individual panels rely on the body background bleeding through.
  for (let i = 0; i < sections.length; i++) {
    const el = sections[i];
    // eslint-disable-next-line no-await-in-loop
    const canvas = await html2canvas(el, {
      backgroundColor: "#0b0d12",
      scale: 2, // retina-ish — keeps charts readable in the PDF
      useCORS: true,
      logging: false,
      // Capturing the natural rendered size avoids quirks where html2canvas
      // measures the window viewport instead of the element.
      windowWidth: el.scrollWidth,
      windowHeight: el.scrollHeight,
    });

    // Convert pixel dims to PDF points, scaled to fit the content width.
    const imgWidthPx = canvas.width;
    const imgHeightPx = canvas.height;
    const renderWidth = contentWidth;
    const renderHeight = (imgHeightPx * contentWidth) / imgWidthPx;

    // How much vertical space is available per page (in points).
    const usableHeight = pageHeight - margin * 2;

    if (renderHeight <= usableHeight) {
      // Fits on one page — just drop it.
      doc.addPage();
      doc.setFillColor(11, 13, 18);
      doc.rect(0, 0, pageWidth, pageHeight, "F");
      const dataUrl = canvas.toDataURL("image/png");
      doc.addImage(dataUrl, "PNG", margin, margin, renderWidth, renderHeight);
      drawPageFooter(doc, ctx.brand_name);
    } else {
      // Section is taller than one page — slice the source canvas vertically
      // and place each slice on its own page. The slice height in source
      // pixels is whatever maps to one usable page in PDF points.
      const sliceHeightPx = Math.floor((usableHeight * imgWidthPx) / contentWidth);
      let yOffsetPx = 0;
      while (yOffsetPx < imgHeightPx) {
        const thisSlicePx = Math.min(sliceHeightPx, imgHeightPx - yOffsetPx);
        // Draw the slice into an off-screen canvas of the slice's size.
        const sliceCanvas = document.createElement("canvas");
        sliceCanvas.width = imgWidthPx;
        sliceCanvas.height = thisSlicePx;
        const sctx = sliceCanvas.getContext("2d");
        if (!sctx) break;
        sctx.fillStyle = "#0b0d12";
        sctx.fillRect(0, 0, imgWidthPx, thisSlicePx);
        sctx.drawImage(
          canvas,
          0, yOffsetPx, imgWidthPx, thisSlicePx,
          0, 0, imgWidthPx, thisSlicePx,
        );

        const sliceRenderHeight = (thisSlicePx * contentWidth) / imgWidthPx;
        doc.addPage();
        doc.setFillColor(11, 13, 18);
        doc.rect(0, 0, pageWidth, pageHeight, "F");
        doc.addImage(sliceCanvas.toDataURL("image/png"), "PNG", margin, margin, renderWidth, sliceRenderHeight);
        drawPageFooter(doc, ctx.brand_name);

        yOffsetPx += thisSlicePx;
      }
    }
  }

  const filename = `aio-full-report-${safeSlug(ctx.brand_name)}-${todayStamp()}.pdf`;
  doc.save(filename);
}

function drawPageFooter(doc: any, brand: string): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageNum = doc.internal.getNumberOfPages?.() ?? 1;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(120, 128, 145);
  doc.text(`AIO Coverage Tracker · ${brand}`, 36, pageHeight - 18);
  doc.text(`Page ${pageNum}`, pageWidth - 36, pageHeight - 18, { align: "right" });
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
