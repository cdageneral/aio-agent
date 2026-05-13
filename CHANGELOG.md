# Changelog

All notable changes to this project will be documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [SemVer](https://semver.org/).

## [1.0.7] — 2026-05-13

Download the Keyword Drilldown as Excel (CSV) or PDF.

### Added
- **Excel and PDF download buttons** in the Keyword Drilldown filter row, right of the search box. The export always reflects the **currently active filters** — tab (All / AIOs / Won / Missing / Mention only) + cluster filter + free-text search — so what you download matches exactly what's on screen.
- **CSV export** (lime accent, `ti-file-spreadsheet` icon) — zero new dependencies, ships instantly. Opens directly in Excel, Numbers, and Google Sheets. Includes a UTF-8 BOM so non-ASCII characters render correctly in Excel.
- **PDF export** (red accent, `ti-file-text` icon) — generates a landscape Letter PDF with a title block, filter context line, paginated table, and page-N-of-M footer. Uses `jspdf` + `jspdf-autotable` via **dynamic import**, so the ~280KB of PDF library only loads when the user actually clicks the PDF button.
- **Self-describing files** — both exports carry a header block with brand name, filter mode, region scope, cluster filter, export timestamp, and row count. Open the file in 6 months and you'll still know exactly what slice of data it represents.
- **Smart filenames** — `aio-drilldown-{brand}-{filter}-{YYYY-MM-DD}.{ext}`. E.g. `aio-drilldown-chip-missing-2026-05-13.csv` for the "Missing" filter on CHIP. No naming collisions across exports.
- **Loading state** — the active button swaps its icon for a spinner and "Preparing…" while the PDF library streams in. Buttons disable when the filtered row count is 0.

### Changed
- New helper file `lib/export.ts` owns the export logic — small enough to keep, generic enough that Quick Wins / Brand Comparison / Other Domains can adopt the same pattern in future releases.
- Added `@keyframes spin` to `app/globals.css` so the loading icon rotates without a `tailwindcss-animate` dependency.

### Dependencies
- `jspdf` ^2.5.2 — client-side PDF generation, MIT-licensed, ~250KB.
- `jspdf-autotable` ^3.8.4 — table-layout plugin for jspdf, MIT-licensed, ~30KB.
- Both are listed in `dependencies` so Vercel's auto-install picks them up on next deploy. No env-var or schema changes.

### Notes
- The PDF deliberately uses a light theme (white background, dark text) so it prints and shares cleanly. The on-screen drilldown stays dark.
- Future v1.1: add export to the AIO Opportunities panel and Other Domains panel using the same `lib/export.ts` helpers.

## [1.0.6] — 2026-05-13

Rename Quick Wins → AIO Opportunities, score → priority score, and add a section-level info tooltip.

### Added
- **`InfoTooltip` component** (`components/InfoTooltip.tsx`) — reusable (i) info button + popover. Same interaction model as the per-card tooltips inside StoryPanel (click to toggle, outside-click closes, Escape closes, `role="tooltip"` + `aria-label`). Accepts plain text or rich JSX so the popover can include headings, lists, and bolded copy.
- **(i) icon next to the "AIO Opportunities" heading.** Click to read the plain-English explanation: what an AIO Opportunity is (gap = AIO triggered, client uncited), the full priority-score formula (+50 base, +30 organic rank, +20 market rank, +15 competitor cited, +10 mention partial credit, +5 multi-slot AIO), and what the "Why" chips mean.

### Changed
- **"Quick wins" → "AIO Opportunities"** everywhere it appears in the UI: Dashboard section heading, sticky cluster-filter banner, cluster-card click-to-filter hint, FirstRefreshBanner body copy.
- **"Score" → "Priority Score"** in the per-row right-rail label and the panel's score-bar legend.
- The per-row priority score number stays lime green to preserve the "this is the rank-by metric" visual hierarchy.

### Notes
- Visual + copy release. No schema, no API contract changes. The `/api/projects/[id]/quick-wins/route.ts` endpoint and internal `QuickWin` TypeScript type are unchanged — purely a UI relabel. Vercel will redeploy in ~30 seconds after upload.

## [1.0.5] — 2026-05-12

Remove redundant KPI card row.

### Removed
- The six-card KPI strip that lived below the Story panel (AIOs Triggered Market / Footprint, AIOs Acquired, Acquired Rate, Total Brand Mentions, Brand Mention Rate). Story panel's five pulse cards (with tooltips) now cover the same information with cleaner framing — AIO Penetration, Brand Mentions, Citation Share, Top Brand, Others.
- `KpiCards` import is dropped from `Dashboard.tsx`. The component file itself is left in place (zero-cost, dormant) in case we want to repurpose it later for a per-cluster KPI strip or other surfaces.

### Notes
- Visual cleanup only — no schema, backend, or behavioral changes. Dashboard scrolls shorter, the Story panel is now the unmistakable headline section, then "What changed" / charts / clusters / quick wins / drilldown flow downward.

## [1.0.4] — 2026-05-12

Add info-icon tooltips to every Story pulse card.

### Added
- Small **(i) icon** in the upper-right corner of each Pulse card (AIO Penetration, Brand Mentions, Citation Share, Top Brand, Others). Click to toggle a 280px popover anchored to the card with a plain-English explanation of what the card measures, how to read it, and what the number means strategically.
- Popover styling matches each card's accent color — cyan tooltip for the cyan card, lime tooltip for the lime card, etc. The (i) icon flips from outlined-accent to solid-accent when active so you can see which card is open at a glance.
- Outside-click and Escape key both close the open tooltip.
- Each tooltip has accessibility plumbing: `role="tooltip"`, `aria-label` on the icon button, and keyboard support (Tab to focus, Enter to toggle).

### Notes
- Pure presentation — no schema or backend changes. Drop the new `StoryPanel.tsx` (plus the bumped version files) onto GitHub and Vercel redeploys in ~30 seconds.

## [1.0.3] — 2026-05-12

Add a Brand Mentions card to the Story pulse strip.

### Added
- **Card 2 — Brand Mentions:** new pulse card inserted between AIO Penetration and Citation Share. Shows the percentage of tracked queries where the client's brand name appears in the AIO answer text (with or without a citation link). Sub-text follows the same `X of Y brand mentions` pattern. Uses lime accent (positive brand-awareness signal).

### Changed
- Pulse grid moved from 4 columns to 5 (`grid-cols-2 md:grid-cols-3 lg:grid-cols-5`) to accommodate the new card without cramping on smaller viewports.

### Notes
- The underlying `mention_count` metric was already computed in `lib/metrics.ts` — this release just exposes it in the Story panel as its own pulse card. No backend or schema changes.

## [1.0.2] — 2026-05-12

Story panel pulse-card relabel + new clickable Others card.

### Changed
- **Card 1 — AIO Penetration:** sub now reads `13 of 15 queries` (the actual fraction) instead of just `of 15 queries`. Same denominator math, more legible framing.
- **Card 2 — Citation Share** (renamed from "[Brand] Acquired"): now shows a percentage as the headline, with `8 of 15 citations` as the sub. Denominator is total queries (15), not total AIOs (13), so the math reconciles cleanly with the sub text.
- **Card 3 — Top Brand · [Brand]** (renamed from "vs [Leader]"): label names the leading brand inline. Sub reads "you lead" when the client is the top brand, or "leads the field" when a competitor is. Same denominator as card 2 so the two cards converge when you're the leader.
- **Card 4 — Others** (renamed from "Non-brand Share"): now covers *every* non-tracked source, not just Wikipedia + Reddit. Card is now **clickable** — click to smooth-scroll to the existing "Other domains in AIOs" section further down the page, which has the full filterable / paginated domain list.
- The `Pulse` component now accepts an optional `onClick` prop with proper accessibility (role="button", tabIndex, Enter/Space keyboard handlers, hover border state).

### Notes
- If you upload this version to GitHub, the Vercel auto-redeploy will pick up the new pulse cards within ~30 seconds. No DB migration, no env-var changes required.

## [1.0.1] — 2026-05-12

Bug-fix release. No new features.

### Fixed
- "Failed to execute 'json' on 'Response': Unexpected end of JSON input" error on project creation when the server returned an empty 500. Routes now always return a JSON body with a friendly diagnostic.
- New helper `lib/fetch-json.ts` for all client fetches — never throws on empty / non-JSON responses. Instead returns `{ ok, status, data, error }` with a human-readable error string. Used in the new-project page; other surfaces can adopt incrementally.
- `/api/projects` POST and `/api/detect-segment` POST now wrap their work in try/catch and use a `friendlyDbError()` / `friendlyDetectError()` translator that turns common Postgres and Anthropic errors into actionable hints — e.g. "Database tables haven't been created yet. Open your Postgres → Query tab in Vercel and run the contents of db/schema.sql."
- **Segment wipe on Edit + Save:** the top-level Edit button (the one visible *after* a segment is already saved) opened the edit form with empty Industry/Category/Subcategory fields, which then got saved as `null` and made the segment disappear. New `openEditFromValue()` helper pre-fills the form from the currently-saved value before showing it. Editing seeds and clicking Save now preserves the segment label.

### Notes
- If you saw the "Unexpected end of JSON input" error before, the underlying cause was almost always the database schema not being initialized. Run `db/schema.sql` in Vercel's Postgres Query tab as a one-time setup step.

## [1.0.0] — 2026-05-12

First production-ready release. Everything below ships in this package.

### Onboarding
- **Smart segment detection** — paste a client URL, Claude Haiku reads the homepage and proposes industry / category / subcategory + primary product + region hint + confidence rating
- **Suggested seed keywords** — 10-15 search queries per detection, auto-applied to the keyword universe on accept
- **Suggested competitors** — 3-5 competitor brand names + domains, with a parallel HTTPS liveness check that filters hallucinated URLs before they reach the UI
- **One-click adds** — suggested competitors surface in the CompetitorPanel as a purple strip with Add / Dismiss buttons per row
- **Persistence** — suggestions and seeds round-trip to Postgres (JSONB column + TEXT[] column) so a page reload doesn't lose pending setup state
- **Free-text override** — every detection field is editable; the LLM is a starting point, not a constraint
- **First-refresh CTA** — prominent lime banner with query count, cost estimate, time estimate that appears until the project has its first completed snapshot

### Data sources
- **SerpAPI** — AI Overview detection, citation parsing (including async `page_token` follow-up), organic rank discovery, related-search expansion
- **Anthropic API (Haiku)** — segment detection + keyword clustering
- **Vercel Postgres** — projects, competitors, keywords, snapshots, serp_results, citations, mentions

### Scope and regions
- US + Canada regional toggle with three modes (US / CA / Both)
- Each refresh fires one SerpAPI query per keyword × region
- Region-aware metrics throughout — every panel respects the active region filter

### Metrics & analysis
- Six KPI cards: AIOs triggered (market), AIOs triggered (footprint), AIOs acquired, Acquired rate, Brand mentions, Mention rate — each with delta vs prior snapshot
- **Share-of-voice donut** — citation slots across tracked brands + bucketed source types (Wikipedia / Reddit / News / Industry / Other)
- **Volume-weighted metrics** — optional CSV upload of (keyword, monthly_volume) unlocks share-of-AIO-triggered-search-volume calculations
- **Citation rate (market + organic footprint)** computed per brand
- **Brand mention rate** — regex-based detection of brand names in AIO answer text (catches mentions without citations)

### Trends and changes
- **AIO trend chart** — market volume line (cyan) + footprint volume line (amber dashed), with MoM and YoY badges
- **Acquisition rate trend** — per-brand citation rate over time, client highlighted in blue
- **What-changed panel** — snapshot-over-snapshot diff: newly won, newly lost, position improved, position worsened, new AIOs, competitor movement
- **Copy digest** — one-click Slack/email-ready summary of the period diff

### Drilldown
- **Per-keyword drilldown** — table with filters (AIOs, Missing, Won, Mention only, All), search, expand-to-detail rows
- **Inside each row** — full AIO answer text, complete citation list with positions, tracked brand hit chips
- **Other domains panel** — top 10, full long-tail with type filter + pagination, by-source-type buckets

### Topic clusters
- **LLM clustering** — Haiku groups 500-keyword universes into 5-8 named topical buckets in one ~$0.01 call
- **Cluster cards** — name, keyword count, AIO penetration, client citation rate, leader, stacked SOV bar within cluster
- **Click-to-filter navigation** — clicking a cluster card filters SOV donut, Quick Wins, Keyword Drilldown all at once
- **Sticky active-filter banner** with X to clear
- **Cluster-scoped SOV donut** — when filter is active, the donut redraws to that cluster's citation slots, rank recalculates within cluster
- **Per-cluster topical narrative** in the Story panel — strongest cluster, weakest cluster, biggest battleground

### Opportunity scoring
- **Quick wins panel** — scored gap opportunities (AIO triggered, client uncited) with rationale chips
- Score weights: gap + organic-rank presence + competitor-cited presence + mention partial-credit + slot count

### UX foundations
- Dark canvas with six-color semantic accent ramp (blue=client, cyan=market volume, amber=footprint, lime=positive growth, pink=competition, red=warning)
- Smart segment detector replaces the previous taxonomy picker — no pre-defined market list to maintain
- All critical buttons use inline styles to defeat any `@tailwind base` preflight conflicts

### Known limitations
- Cron / scheduled refresh deliberately not included (on-command only)
- Single-user (no auth / multi-tenant)
- Snapshot history accrues forward — no backfill from SerpAPI Archive yet
- Volume data is user-upload-only (no automatic enrichment via DataForSEO / SEMrush)

[1.0.0]: initial production release
