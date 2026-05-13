# Changelog

All notable changes to this project will be documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [SemVer](https://semver.org/).

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
