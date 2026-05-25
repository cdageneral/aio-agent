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
// every concrete number it needs to fill the reference layouts.
//
// v1.1.62: bumped from a 2-slide prompt to a 3-slide prompt so a single paste
// produces the full executive AIO storyboard:
//
//   Slide 1 — "AIO landscape" — 2 hero KPI cards on top + the 6-card metric
//             strip from the StoryPanel (Your position · Brand mentions ·
//             Citation share · Avg citation position · Top brand · Others).
//   Slide 2 — "AIO opportunity map" — 3 cluster-summary cards on top + the
//             full cluster grid (LEAD/TRAIL/OPEN).
//   Slide 3 — "Keyword-level opportunity & AIO drill-down" — split layout:
//             left column = top 17 keywords (mixed wins + losses, highest
//             citation-count first) with cluster, citation count, top brand,
//             and client status. Right column = two real AIO examples — one
//             where the client is cited (best win, highlight the rank) and
//             one where the client is missing (worst miss, show competitor
//             citations) — both with the AIO answer text + citation list.
//
// The function is pure: pass in the SnapshotMetrics-shaped `latest` payload,
// the optional keyword-detail rows from /api/projects/[id]/keywords/detail
// (needed for slide 3), and a small context object — and it returns a string.
// The caller is responsible for getting it onto the clipboard. When the
// keyword-detail rows are omitted (e.g. an older caller that only fetched
// metrics), slide 3 emits a fallback line telling the receiving AI to skip
// it; slides 1 and 2 are unchanged. This keeps any legacy invocation safe.

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
    /** v1.1.57: best-position-averaged-across-cited-AIOs. Surfaced as a
     *  pulse card on the dashboard; included in slide 1 KPI strip. */
    avg_citation_position?: number | null;
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

/** v1.1.62: shape of the keyword-detail rows the Dashboard fetches from
 *  /api/projects/[id]/keywords/detail. We accept only the fields slide 3
 *  needs — the route returns more (full citation objects with titles, etc.)
 *  but the prompt only quotes a couple of those rows back at the receiving
 *  AI, so we keep the surface tight. */
export interface PptPromptKeywordRow {
  keyword: string;
  country: string;
  cluster_label?: string | null;
  has_aio: boolean;
  aio_text?: string | null;
  citations?: Array<{
    position: number;
    domain: string;
    url?: string;
    title?: string | null;
  }>;
  brand_hits?: Array<{
    brand_name: string;
    kind: "client" | "competitor";
    cited: boolean;
    position: number | null;
    mentioned?: boolean;
  }>;
  winner?: { brand_name: string; position: number | null; kind: string } | null;
}

function pct(n: number | undefined, digits = 1): string {
  if (n == null || isNaN(n)) return "0%";
  return `${(n * 100).toFixed(digits)}%`;
}

function intFmt(n: number | undefined): string {
  if (n == null || isNaN(n)) return "0";
  return n.toLocaleString("en-US");
}

/** Truncate AIO answer text for the prompt — full text bloats the clipboard
 *  payload and the receiving AI only needs the gist to render the example
 *  panel. 600 chars is long enough to convey the answer's substance but
 *  short enough that two examples + their citations still fit comfortably. */
function trimAio(text: string | null | undefined, max = 600): string {
  if (!text) return "(no AIO text captured)";
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + "…";
}

/** Same ordinal formatter the StoryPanel uses ("1st", "2nd", "3rd", …) so
 *  the slide-1 "Your position" subtitle reads the same as the pulse card. */
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function buildPptPrompt(
  latest: PptPromptLatest | null,
  ctx: PptPromptContext,
  /** v1.1.62: keyword-detail rows from /api/projects/[id]/keywords/detail.
   *  Optional so older callers that only fetched metrics still get the first
   *  two slides correctly; slide 3 gracefully degrades when this is omitted. */
  keywords: PptPromptKeywordRow[] | null = null,
): string {
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
  const clientCitationRate = clientBrand?.citation_rate ?? 0;
  const clientMentionRate = clientBrand?.mention_rate ?? 0;
  const clientMentions = clientBrand?.mention_count ?? 0;
  const clientSlots = clientBrand?.citation_slots ?? 0;
  const clientAcquired = clientBrand?.aios_acquired ?? 0;
  const clientAvgPos = clientBrand?.avg_citation_position ?? null;
  // v1.1.62: "Citation share" pulse card uses aios_acquired / total_keywords
  // (NOT citation_slots / total_citation_slots). Mirror that exact formula so
  // slide 1's "Citation share" KPI equals what the dashboard pulse shows.
  const citationShareRate = totalKw > 0 ? clientAcquired / totalKw : 0;
  // "Brand mentions" pulse card uses mention_count / total_keywords too.
  const brandMentionShareRate = totalKw > 0 ? clientMentions / totalKw : 0;

  // Top brand (by citation_rate, excluding any with 0)
  const allBrandsSorted = [...(latest.brands ?? [])].sort(
    (a, b) => (b.citation_rate ?? 0) - (a.citation_rate ?? 0),
  );
  const topBrand = allBrandsSorted[0];
  const topBrandIsClient = topBrand?.kind === "client";
  const topBrandShare = totalKw && topBrand
    ? (topBrand.aios_acquired ?? 0) / totalKw
    : 0;
  // The "runner up" subtitle on the "Your position" pulse card.
  const runnerUp = topBrandIsClient ? allBrandsSorted[1] : null;
  // Rank inside the brand-by-citation-rate ordering for the "Your position"
  // subtitle. "Nth behind X (Y%)" when client isn't the top brand.
  const clientPositionRank = allBrandsSorted.findIndex((b) => b.kind === "client") + 1;

  // Brand-only share of voice rank for the client (used for slide-1 footer
  // context — distinct from the "Your position" rank above because SoV uses
  // citation slot counts, not citation rate).
  const trackedSov = (latest.share_of_voice ?? []).filter((s) => s.kind !== "bucket");
  const trackedSovSorted = [...trackedSov].sort((a, b) => b.slots - a.slots);

  // "Others" pulse card = non-tracked citation slots / total citation slots.
  const otherSlots = (latest.share_of_voice ?? [])
    .filter((s) => s.kind === "bucket")
    .reduce((acc, s) => acc + (s.slots ?? 0), 0);
  const othersShare = totalSlots > 0 ? otherSlots / totalSlots : 0;

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

  // ── Slide-1 KPI lines ──────────────────────────────────────────────────
  // Two hero cards on top + six metric cards below them. The six match the
  // app's bottom-row pulse strip EXACTLY (Your position · Brand mentions ·
  // Citation share · Avg citation position · Top brand · Others) so a
  // stakeholder looking at the slide can read it side-by-side with the
  // dashboard and confirm the numbers tie out.

  const yourPositionSubtitle = topBrandIsClient && runnerUp
    ? `${brand} leads — ${runnerUp.brand_name} ${pct(runnerUp.citation_rate ?? 0)}`
    : topBrandIsClient
      ? `${brand} leads the field`
      : clientPositionRank > 0 && topBrand
        ? `${ordinal(clientPositionRank)} behind ${topBrand.brand_name} (${pct(topBrand.citation_rate ?? 0)})`
        : `not yet ranked`;

  const topBrandSubtitle = topBrandIsClient ? "you lead" : "leads the field";

  const heroKpiLines = [
    `1. AVAILABLE AIOs — big number: ${intFmt(totalAios)} — caption: "AI Overviews across ${intFmt(totalKw)} tracked queries" — accent: cyan/positive · EMPHASIZED tile (larger, glow border)`,
    `2. AIO PENETRATION — big number: ${pct(penetration)} — caption: "${intFmt(totalAios)} of ${intFmt(totalKw)} queries trigger an AIO" — accent: cyan/positive · EMPHASIZED tile (larger, glow border)`,
  ].join("\n");

  const metricKpiLines = [
    `1. YOUR POSITION — number: ${pct(clientCitationRate)} — caption: "${yourPositionSubtitle}" — accent: blue`,
    `2. BRAND MENTIONS — number: ${pct(brandMentionShareRate)} — caption: "${intFmt(clientMentions)} of ${intFmt(totalKw)} brand mentions" — accent: lime/green`,
    `3. CITATION SHARE — number: ${pct(citationShareRate)} — caption: "${intFmt(clientAcquired)} of ${intFmt(totalKw)} citations" — accent: blue`,
    `4. AVG CITATION POSITION — number: ${clientAvgPos != null ? clientAvgPos.toFixed(1) : "—"} — caption: "${clientAvgPos == null ? "no citations yet" : `across ${intFmt(clientAcquired)} cited AIO${clientAcquired === 1 ? "" : "s"}`}" — accent: cyan · note: LOWER is better, 1.0 = first cited source`,
    `5. TOP BRAND · ${topBrand?.brand_name ?? "—"} — number: ${pct(topBrandShare)} — caption: "${topBrandSubtitle}" — accent: pink`,
    `6. OTHERS — number: ${pct(othersShare)} — caption: "non-tracked sources (Wikipedia, Reddit, news, etc.)" — accent: amber`,
  ].join("\n");

  // ── Slide-2 cluster grid lines ─────────────────────────────────────────
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

  const trailSubtitle = topTrailingCompetitor && trailExamples
    ? `${topTrailingCompetitor} owns ${trailExamples}`
    : trailClusters.length === 0
      ? "no clusters trailing"
      : "competitors lead";

  // ── Slide-3 keyword + drilldown lines ──────────────────────────────────
  //
  // Selection logic (per user spec): "Mixed: highest-priority wins +
  // losses". We bucket the AIO-triggered keywords by client status, sort
  // each bucket by citation count desc (the visible "CITES" column from the
  // app), then interleave wins and losses until we have 17 rows. This gives
  // a balanced executive view — biggest wins next to biggest open holes —
  // instead of e.g. an all-wins or all-losses ranking that doesn't reflect
  // the actual gap conversation. Mentions-only and "no AIO" rows are
  // excluded because the slide is meant to surface the actionable list, not
  // the long tail.
  const aioKeywords = (keywords ?? []).filter((k) => k.has_aio);
  const winRows = aioKeywords
    .filter((k) => (k.brand_hits ?? []).some((b) => b.kind === "client" && b.cited))
    .sort((a, b) => (b.citations?.length ?? 0) - (a.citations?.length ?? 0));
  const lossRows = aioKeywords
    .filter((k) => !(k.brand_hits ?? []).some((b) => b.kind === "client" && b.cited))
    .sort((a, b) => (b.citations?.length ?? 0) - (a.citations?.length ?? 0));

  const TOP_N = 17;
  const interleaved: PptPromptKeywordRow[] = [];
  for (let i = 0; interleaved.length < TOP_N && (winRows[i] || lossRows[i]); i++) {
    if (winRows[i]) interleaved.push(winRows[i]);
    if (interleaved.length >= TOP_N) break;
    if (lossRows[i]) interleaved.push(lossRows[i]);
  }
  // Backfill from whichever bucket still has rows, in case one side is short
  // (e.g. an all-wins universe or an all-losses one).
  if (interleaved.length < TOP_N) {
    const remaining = (winRows.length >= lossRows.length ? winRows : lossRows).slice(
      Math.ceil(interleaved.length / 2),
    );
    for (const r of remaining) {
      if (interleaved.length >= TOP_N) break;
      if (!interleaved.includes(r)) interleaved.push(r);
    }
  }
  const top17 = interleaved.slice(0, TOP_N);

  function rowStatus(k: PptPromptKeywordRow): { status: string; chipLabel: string } {
    const ch = (k.brand_hits ?? []).find((b) => b.kind === "client");
    if (ch?.cited) return { status: `#${ch.position}`, chipLabel: `CHIP #${ch.position}` };
    if (ch?.mentioned) return { status: "mentioned", chipLabel: "MENTION" };
    return { status: "missing", chipLabel: "MISSING" };
  }

  const top17Lines = top17.length === 0
    ? `  (no AIO-triggered keywords yet — run a refresh)`
    : top17.map((k, i) => {
        const winner = k.winner?.brand_name ?? "—";
        const cites = k.citations?.length ?? 0;
        const { status, chipLabel } = rowStatus(k);
        return [
          `${(i + 1).toString().padStart(2, " ")}. "${k.keyword}"`,
          `    - cluster: ${k.cluster_label ?? "—"}`,
          `    - cites: ${cites}  ·  top brand: ${winner}  ·  ${brand} status: ${status} (chip label: ${chipLabel})`,
        ].join("\n");
      }).join("\n");

  // Pick the best win = highest CHIP rank (lowest position number) tie-broken
  // by most citations, and the worst miss = highest citation count where
  // CHIP is missing (most visible gap).
  const bestWin = winRows.length
    ? [...winRows].sort((a, b) => {
        const ap = (a.brand_hits ?? []).find((x) => x.kind === "client")?.position ?? 99;
        const bp = (b.brand_hits ?? []).find((x) => x.kind === "client")?.position ?? 99;
        if (ap !== bp) return ap - bp;
        return (b.citations?.length ?? 0) - (a.citations?.length ?? 0);
      })[0]
    : null;
  const worstMiss = lossRows[0] ?? null;

  function renderDrilldown(label: string, k: PptPromptKeywordRow | null, kind: "win" | "miss"): string {
    if (!k) {
      return `${label}: (no ${kind === "win" ? "wins" : "misses"} in this snapshot)`;
    }
    const ch = (k.brand_hits ?? []).find((b) => b.kind === "client");
    const headerChip = kind === "win"
      ? `CHIP CITED — RANK #${ch?.position ?? "?"}`
      : `CHIP MISSING — gap to close`;
    const citationList = (k.citations ?? []).slice(0, 5).map((c, i) => {
      const isClient = (k.brand_hits ?? []).some(
        (b) => b.kind === "client" && b.cited && b.position === c.position,
      );
      const star = isClient ? " ★ CHIP" : "";
      const title = c.title ? `"${c.title}"` : c.url ?? "(no title)";
      return `    #${c.position}  ${c.domain}  —  ${title}${star}`;
    }).join("\n");
    return [
      `${label}:`,
      `  AIO QUERY: "${k.keyword}"  (cluster: ${k.cluster_label ?? "—"})`,
      `  HEADER CHIP: ${headerChip}  ·  accent: ${kind === "win" ? "positive/green" : "negative/red"}`,
      `  AIO ANSWER TEXT (paraphrase if needed for length): "${trimAio(k.aio_text)}"`,
      `  CITATIONS (top ${Math.min(5, (k.citations ?? []).length)} of ${(k.citations ?? []).length}):`,
      citationList || `    (no citations captured)`,
    ].join("\n");
  }

  // ── Insight callout for slide 2 ────────────────────────────────────────
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

  // ── Slide-3 fallback when keyword detail wasn't fetched ────────────────
  const slide3Available = top17.length > 0;
  const slide3Section = slide3Available
    ? `────────────────────────────────────────────────────────────
SLIDE 3 — "Keyword-level opportunity & AIO drill-down"
────────────────────────────────────────────────────────────
TITLE: Keyword-level opportunity — what we win, where we lose
SUBTITLE: ${winRows.length} won · ${lossRows.length} missing · top 17 by citation volume, interleaved wins + losses

TWO-COLUMN LAYOUT (≈58% left / 42% right).

LEFT COLUMN — "KEYWORD-LEVEL OPPORTUNITY" data table:
  - Header eyebrow (small uppercase, orange/accent): "KEYWORD-LEVEL OPPORTUNITY"
  - Section title (large): "What we win, where we lose, and what's open"
  - Table columns: KEYWORD · CLUSTER · CITES · TOP BRAND · ${brand.toUpperCase()}
  - Status chip color rules for the final column:
      · Green pill "#N" when ${brand} is cited (lower N = better)
      · Orange pill "MENTION" when mentioned but not cited
      · Red pill "MISSING" when ${brand} is absent
  - Row data (top 17, in this exact order):
${top17Lines}
  - Footer line under the table (small, muted): "Subset of full keyword list. Full list available upon request."

RIGHT COLUMN — "AIO DRILL-DOWN · What the AI Overview actually shows":
  - Header eyebrow (small uppercase, orange/accent): "AIO DRILL-DOWN"
  - Section title (large): "What the AI Overview actually shows"
  - Stack two example panels vertically. Each panel has its own header chip
    in the top-right corner (green for the win, red for the miss).

  EXAMPLE 1 — BEST WIN (panel border-top: green accent line):
${renderDrilldown("    PANEL", bestWin, "win")}
    HIGHLIGHT: The ★ CHIP row in the citations list is the row to bold —
    make it visually unmistakable that ${brand} owns rank #${(bestWin?.brand_hits ?? []).find((b) => b.kind === "client")?.position ?? "?"} in this AIO.

  EXAMPLE 2 — WORST MISS (panel border-top: red accent line):
${renderDrilldown("    PANEL", worstMiss, "miss")}
    HIGHLIGHT: Add a one-line caption under the citations list reading
    "CHIP is absent — competitors own all ${(worstMiss?.citations ?? []).length} citation slots."

FOOTER on slide: "Source: ${brand} AIO crawl, ${ctx.universe_label ? ctx.universe_label + " " : ""}keyword universe (${intFmt(totalKw)} queries), ${stampHuman}. Top 17 selected by citation volume, interleaving wins and losses for balance."
`
    : `────────────────────────────────────────────────────────────
SLIDE 3 — "Keyword-level opportunity & AIO drill-down"
────────────────────────────────────────────────────────────
SKIP THIS SLIDE — no keyword-detail data was passed to the prompt builder
(${keywords == null ? "the keywords parameter was null" : "no AIO-triggered keywords in scope"}).
Re-trigger Copy PPT Prompt after a successful refresh that includes a
keyword detail fetch.
`;

  // Final assembled prompt
  return `# PowerPoint slide-generation prompt — AIO Coverage Tracker
# Brand: ${brand}${universe} · Region: ${ctx.region_label} · Generated: ${stampHuman}

You are generating three PowerPoint slides inside the deck I currently have open.

────────────────────────────────────────────────────────────
STYLE INSTRUCTIONS (READ FIRST — APPLY TO ALL THREE SLIDES)
────────────────────────────────────────────────────────────
- MATCH THE ACTIVE DECK. Infer typography, color palette, header/banner treatment, accent colors, card styles, spacing, and margins from the master slide and existing slides in this deck. Do NOT introduce colors or fonts that aren't already in the deck's theme.
- Reuse the deck's existing title-bar / header style for all three slides so they feel like a single insert, not three different templates.
- Use the deck's primary heading font for big numbers, secondary font for labels and captions.
- If the deck uses status colors (positive / negative / neutral), use those for LEAD / TRAIL / OPEN respectively and for CHIP WIN / CHIP MISS on slide 3. If not, use green / red / gray as a fallback.
- Information density should be HIGH but legible — these are executive reference slides, not minimalist hero slides. Use thin colored accent bars above each KPI tile and panel to organize the eye (the orange divider style in the source dashboard works well).
- All three slides are 16:9. Use the deck's standard margin/safe-area.
- Numbers must match EXACTLY as given below — do not round differently or recalculate.

────────────────────────────────────────────────────────────
SLIDE 1 — "AIO landscape${universe ? ` —${universe.replace(/[()]/g, "")} keyword set` : ""}"
────────────────────────────────────────────────────────────
TITLE: AIO landscape${universe ? ` —${universe.replace(/[()]/g, "")} keyword set` : ` — ${brand} keyword set`}
SUBTITLE: ${intFmt(totalAios)} AI Overviews across ${intFmt(totalKw)} tracked queries · ${intFmt(totalSlots)} citation slots · who Google trusts vs. who's invisible

ROW 1 — Two large hero KPI cards, side-by-side, spanning the full slide width:
${heroKpiLines}

ROW 2 — Six metric cards in a single horizontal strip directly below the hero row (each with a thin colored accent bar above the label):
${metricKpiLines}

FOOTER on slide: "Source: ${brand} AIO crawl, ${ctx.universe_label ? ctx.universe_label + " " : ""}keyword universe (${intFmt(totalKw)} queries), ${stampHuman}. Citation slots = distinct domains cited per AIO, summed across all ${intFmt(totalAios)} AIOs."

────────────────────────────────────────────────────────────
SLIDE 2 — "AIO opportunity map — ${clusters.length} ${ctx.universe_label ?? brand} cluster${clusters.length === 1 ? "" : "s"}"
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

${slide3Section}
────────────────────────────────────────────────────────────
FINAL REMINDERS
────────────────────────────────────────────────────────────
- Numbers must match exactly as given above — do not round differently or recalculate.
- LEAD = positive color, TRAIL = negative color, OPEN = neutral/muted.
- On slide 3, the ★ CHIP row in the BEST WIN citations list MUST be visually distinct (bold + accent color) so the rank is unmistakable.
- Keep all three slides on the deck's master so they pick up any future theme changes automatically.
- After generating, briefly confirm in chat which slide layout/master you applied so I can verify.`;
}
