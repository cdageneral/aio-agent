# Changelog

All notable changes to this project will be documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [SemVer](https://semver.org/).

## [1.1.17] — 2026-05-13

Fix the delete-project placeholder trap.

### Fixed
- **Delete confirmation input placeholder showed the brand name itself** (e.g., "Empower") so users thought the field was already filled in. They'd click "Delete project" and the button would stay disabled because the input was actually empty. Changed the placeholder to "Type the brand name here…" so it's obvious the user needs to type to fill the field.

### Notes
- Pure copy edit on `components/ProjectCard.tsx`. Confirmation logic itself unchanged — still requires typing the brand name exactly to enable the red Delete button.

## [1.1.16] — 2026-05-13

Make the date-range inputs obviously visible in dark mode.

### Fixed
- **From / To date inputs were invisible.** v1.1.14 added them with native `<input type="date">` styling that blended into the dark canvas — users saw only the preset chips and didn't realize there were date fields they could click.

### Changed
- **Two-row layout.** Date inputs now sit on their own row with a "Custom range" label; preset chips sit below with a "Quick" label. Plenty of breathing room, both rows always visible.
- **Inline calendar icon** inside each date input pill — a small blue calendar SVG that signals "click me, this is a date picker." Visible whether the user has interacted yet or not.
- **Explicit blue-tinted borders** on the inputs (`rgba(79,140,255,0.30)`), explicit dark-mode background, 130px minimum width per input, larger padding. Inputs are now impossible to miss.
- **"Custom range · active" indicator** when the user has dragged the inputs to a non-preset range, so they know the chart is filtered to their hand-picked window.

### Notes
- The date filter logic itself was already correct since v1.1.14 — both charts respect the range, both are inclusive on the bounds, MoM/YoY still compute against the full series. This release is purely visibility / discoverability.

## [1.1.15] — 2026-05-13

Two real bugs: AIO Opportunities + Drilldown showing stale data after refresh, and trash icon still missing on some browsers.

### Fixed
- **AIO Opportunities and Keyword Drilldown weren't refetching after a refresh completes.** Both panels had useEffect deps of just `[load]` (essentially `[projectId, region]`), so they only re-fetched when those changed. After a Refresh button click, Dashboard.load() refreshed the metrics payload (Story panel, pulse cards, clusters), but the two child panels stayed pointed at their pre-refresh fetch. User saw "no opportunities yet" / "no keywords" until clicking Refresh again.
- **Same fix covers auto-cluster latency.** When auto-clustering completes ~3s after the keyword set changes, its `onChanged()` triggers Dashboard.load() — which now also bumps the nonce. So clusters appearing in the metrics payload also pulls fresh AIO Opportunities + Drilldown data in sync.

### Added
- **`refreshNonce` counter on Dashboard.** Increments after every refresh AND every successful metrics reload. Passed down to QuickWinsPanel and KeywordExplorer as a prop; they include it in their useEffect deps, so any nonce change forces a refetch.

### Fixed (icon resilience)
- **ProjectCard trash icon switched from Tabler webfont to inline SVG.** The Tabler CSS @import in globals.css usually loads fine, but if the CDN is slow, blocked by a corporate proxy, or the browser cached a 404, the trash glyph would render as an empty red square — the click handler worked, just the icon was invisible. Inline SVG renders regardless of webfont status; the button is now guaranteed visible in every browser session.

### Notes
- Refresh flow end-to-end now: click Refresh → SerpAPI runs → metrics reload → nonce bumps → AIO Opportunities + Drilldown refetch automatically → seconds later auto-cluster completes → metrics reload again → cluster cards appear AND Opportunities/Drilldown refetch one more time. Everything settles in one user click.
- Other icons (refresh button, edit pencils, info circles) still rely on the Tabler webfont since they're cosmetic-only. The trash icon got the SVG treatment specifically because losing the delete affordance is a much worse user experience than losing a refresh icon.

## [1.1.14] — 2026-05-13

Calendar date-range picker for the AIO Trends + Acquisition Rate charts.

### Added
- **From / To date inputs** above the chart pair. Pick any two dates and both charts immediately filter to that window. Native `<input type="date">` controls, styled for the dark theme via `color-scheme: dark`, so they pop up the platform date picker on click.
- **Quick preset chips** next to the inputs: 30 days · 90 days · 6 months · 1 year · All time. Clicking one populates From and To to that range ending today. The active preset highlights in blue so you know what's currently selected.

### Changed
- `chartUtils.ts` gained `DateRange` type, `filterByDateRange()` function, `presetToRange()` helper, `isoDate()` formatter, and `DEFAULT_RANGE` (last 90 days).
- `GrowthChart` now takes a `range: DateRange` prop instead of `period: Period`.
- `AcquisitionChart` same change.
- `Dashboard` state changed from `const [period, setPeriod]` to `const [range, setRange]`, default = last 90 days.
- `PeriodSelector.tsx` rewritten as the date-range picker (file name preserved so existing imports keep working).

### Notes
- The existing `filterByPeriod` / `Period` types are still exported from chartUtils for any other code that uses them, but Dashboard now uses date-range exclusively.
- MoM and YoY badges on the AIO Trends chart still compute against the **full** series, not the filtered slice, so deltas stay meaningful even when you zoom into a narrow window.

## [1.1.13] — 2026-05-13

Auto-apply and auto-persist detected segment on Detect — no more "Not detected yet" after detection.

### Fixed
- **Detection result wasn't sticking.** The flow was: click Detect → see a big "Suggested segment" review card → click "Use these" → then click "Save changes" to persist. Users were missing one or both of those steps, ending up with "Not detected yet" displayed and no segment saved. Now detection auto-applies AND auto-saves in a single Detect click.

### Changed
- **SmartSegmentDetector.detect()** now applies the segment, region hint, competitor suggestions, and seed keywords inline as soon as the API response lands. The "Current segment" area at the top of the panel updates immediately to show the detected industry / category / subcategory with confidence chip.
- **New `onAutoSave` callback** on SmartSegmentDetector — ProjectHeader provides a handler that PATCHes the project with the segment fields (segment_l1/l2/l3, primary_product, custom_seed_keywords, detection_confidence). Persisted before the user can navigate away or reload.
- **Removed the bulky "Suggested segment" review card.** Replaced with a thin lime confirmation strip below the Current segment area that summarizes what just happened ("Detected and applied · N seed keywords added · M competitors queued · region US"). The "What Claude read" excerpt is preserved as a collapsible inside the strip for debugging.
- **Removed the dead `applySuggestion()` function and `suggestion` / `applying` state** since the manual two-step flow is gone.

### Notes
- Re-detect still works the same way — runs the API, auto-applies, auto-persists, replacing whatever was there. The confirmation strip refreshes with the new detection time.
- The "Save changes" button on ProjectHeader still exists for URL / brand / region edits that aren't detection-driven.

## [1.1.12] — 2026-05-13

Compact density for the Competitor and Keyword lists.

### Changed
- **Competitor list rows** — collapsed from "stacked brand-name-then-domain" two-line layout to a single inline row: brand name (12px, weight 600) and domain (10.5px muted) on one line, "remove" button on the right. Padding dropped from `py-2 px-3` to `5px 9px`. Row gap reduced from 8px to 3px. ~3x more competitors fit on screen.
- **Keyword list rows** — matched density. 12px keyword text, 9px source badge, 4px vertical padding, 1.3 line-height. Single row per keyword with the source chip inline next to the keyword text.
- **Empty-state copy** on the keyword list updated to mention the four ways to add keywords (type, paste with commas, CSV upload, or smart detection).

### Notes
- Pure visual tightening. No logic changes — inline edit still works (click keyword text), remove still works, source badges still show, auto-cluster still fires on changes.

## [1.1.11] — 2026-05-13

Streamline the keyword input — type-and-go one-off add, drop Volumes CSV, snappier auto-cluster.

### Changed
- **Single-line input replaces the multi-line textarea.** Type one keyword, hit Enter, done. The same field still accepts comma-separated values for "let me add a few at once" — no functionality lost, just a much faster path for the common case of "I want to add one keyword."
- **Auto-cluster debounce reduced from 8s to 3s.** Single-keyword adds now trigger clustering in 3 seconds instead of 8. Still long enough that a quick paste of 10-15 keywords coalesces into one cluster call instead of N — bulk add stays cheap.

### Removed
- **Volumes CSV upload link.** Not used in current workflow; the upload function is preserved in code in case anything else calls it, just removed from the UI.

### Confirmed (no code change needed)
- Auto-clustering fires **on initial keyword load** when any keyword lacks a `cluster_label` (per the signature-based check in v1.1.6).
- Auto-clustering fires **when a new keyword is added** (signature changes, debounce schedules cluster).
- Auto-clustering fires **when a keyword is edited** (delete + add-as-manual changes the signature).
- Auto-clustering fires **when a keyword is deleted** (signature changes).
- Auto-clustering is paused during refresh (v1.1.10 fix) so it doesn't race the SerpAPI batch.

### Notes
- Pure UI change. No API contract changes, no schema changes.
- The CSV upload button now sits inline next to the input as a small bordered button, making the row a single horizontal strip: input + Keywords CSV + Add.

## [1.1.10] — 2026-05-13

Fix the "I had to click Refresh several times before data showed up" bug. Three race-condition fixes.

### Fixed
- **Auto-clustering raced the refresh.** Right after a user created a project, the dashboard would auto-cluster the just-inserted seed keywords on an 8-second debounce. If the user hit Refresh inside that window (which most users do), the cluster API call's `onChanged()` refetch raced against the refresh's own `load()`. Whichever resolved last wrote to the dashboard's `data` state — sometimes that was the cluster's metrics call which fired BEFORE the refresh's serp_results had finished writing. Result: refresh "succeeded" but the dashboard showed empty/partial data, prompting the user to click Refresh again. **Fix:** pass `refreshing` from Dashboard down to KeywordPanel; auto-cluster useEffect short-circuits whenever a refresh is in flight, and re-checks `refreshing` right before the 8-second timer fires.
- **Region inference raced the first metrics load.** Dashboard's `load()` used `data === null` as a "first time" gate, but `data` is a closure-captured value that could mis-evaluate during the React render cycle. If a project's saved regions differed from the default "us", the region snap fired a second `load()` while the first was still in flight; whichever resolved second clobbered the state. **Fix:** replace the `data === null` check with a `useRef<boolean>` flag (`didInferRegionRef.current`) that fires exactly once on the very first metrics load.
- **Refresh button had no double-click guard.** Rapid clicks (or simultaneous clicks from the header button + FirstRefreshBanner) could fire two parallel `POST /refresh` requests. Each created a separate snapshot row and each called `load()` after completing; the two `load()` calls raced each other. **Fix:** `if (refreshing) return;` as the first line of `onRefresh`.

### Notes
- All three fixes are client-side only — no API contract changes, no schema changes.
- The lower-priority issue of "stuck `status='running'` snapshots from soft serverless timeouts" is a separate follow-up that requires UI for surfacing stale runs (not addressed here).

## [1.1.9] — 2026-05-13

Load the Tabler Icons font (every icon in the app was invisible) and remove the duplicate "+ New project" button from the global nav header.

### Fixed
- **Tabler Icons font was never loaded.** Every icon throughout the app — `ti ti-trash` on project cards, `ti ti-edit` pencils, `ti ti-refresh` on the dashboard refresh button, `ti ti-file-spreadsheet` / `ti ti-file-text` on the Excel and PDF export buttons, `ti ti-wand` on the smart detector, `ti ti-info-circle` and the chevrons, `ti ti-swords` on the Battleground badge — every single one was rendering as an empty glyph because the webfont wasn't included. The buttons WERE working (the trash button's click handler fires correctly, opens the confirmation modal, etc.) but they looked broken because the icon was invisible. Added `@import url("https://cdn.jsdelivr.net/npm/@tabler/[email protected]/dist/tabler-icons.min.css");` at the top of `app/globals.css` so the webfont loads as part of the CSS bundle.
- **Duplicate "+ New project" button in the global nav.** Layout header had its own lime "+ New project" Link that appeared on every page next to the "Projects" nav link. On the projects list this created a SECOND duplicate of the page-header CTA (v1.1.8 only removed the empty-state one). Removed the nav button — the page-header button on the projects list is now the single contextual entry point.

### Notes
- Net effect: trash icons on project cards now show correctly, delete confirmation modal opens on click, every other icon in the app finally renders. No code changes to ProjectCard.tsx — the delete flow worked all along, just looked broken because the icon was missing.
- The nav still has the "Projects" link to navigate back to the projects list from anywhere.

## [1.1.8] — 2026-05-13

Remove the duplicate "+ New project" CTA on the projects list.

### Fixed
- **Two lime CTAs were stacked on the empty projects page** — one in the header ("+ New project"), one in the empty-state card ("Create your first project"). Both linked to `/projects/new`, both styled identically. Confusing when both were visible at once.

### Changed
- Empty state card now shows just a helpful pointer message ("Click the lime + New project button above to set up your first one.") with no second button.
- Header "+ New project" button remains the single, always-visible CTA — present whether the list is empty or full.

### Notes
- Pure markup + copy edit on `app/page.tsx`. No schema, no API, no dependency changes.

## [1.1.7] — 2026-05-13

Streamline the Keyword Universe panel — manual + CSV only.

### Removed
- **Source tab picker** (Manual / CSV · Pull from client organic · Shared market set · Seed → related). The three SerpAPI-heavy expansion paths are gone. Smart detection on the ProjectHeader already populates seed keywords automatically, and paste / CSV upload covers everything else. The tab state, the seed-text state, and all the organic/market/seed submit code paths in `submit()` are removed.

### Changed
- **Single-purpose input.** The panel now shows one textarea ("Paste keywords here — one per line or comma-separated") plus a compact row with two upload links (Keywords CSV, Volumes CSV) and the Add button. No mode switching, no conditional rendering.
- **Tighter spacing.** Upload links shrunk to 11px font and renamed to short labels ("Keywords CSV", "Volumes CSV") so the row fits on one line at typical viewport widths. Textarea min-height reduced from 100px to 76px. Status message font dropped from 12px to 11px.

### Notes
- Existing keywords ingested via the removed paths (source = "organic", "market", "seed") still show up in the keyword list with their original source badge — only the *ingestion UI* is gone, the historical data is preserved.
- The API route still accepts `method: "organic"`, `"market"`, and `"seed"` POSTs in case anything still calls them — purely a UI removal.

## [1.1.6] — 2026-05-13

Fix the auto-clustering loop introduced in v1.1.5.

### Fixed
- **Auto-clustering was running in a continuous loop.** The v1.1.5 effect compared `keywords.length` against a `lastClusteredCountRef`, which was correct in theory but fragile in practice — `onChanged()` after a cluster run triggered a parent re-render that passed back a fresh keyword array reference. Even though the length hadn't changed, the cascade caused repeat cluster API calls in some cases.

### Changed
- **Now uses a keyword-set signature.** On every render, KeywordPanel builds a stable signature from the sorted, lowercased keyword strings and compares it against the last clustered signature. Same set → no re-cluster. Different set (add / edit / delete) → schedule a debounced re-cluster.
- **First-mount detection**: if every keyword in the loaded set already has a `cluster_label` from the database, the previous clustering still applies — we just memoize the signature and skip the API call. Page reloads with already-clustered universes cost zero Claude credits.

### Behavior the user will see
- Cluster runs **once** at the beginning when keywords are first added (or on a project that hasn't been clustered yet).
- Cluster runs **on add / edit / delete** of keywords, debounced 8 seconds.
- Cluster does **not** run repeatedly while nothing has actually changed.

### Notes
- Surfaced the `cluster_label` field on the local Keyword type so the signature-based check can read it without a cast.

## [1.1.5] — 2026-05-13

Rework the keyword flow: detected keywords flow straight into the universe, the keyword list is always visible with inline edit, clustering happens automatically.

### Changed
- **Detected seed keywords auto-apply.** When you click Detect or Re-detect, the suggested keywords are pushed directly into the Keyword Universe panel below — no chip preview drawer under the segment, no second "Use these" click required for keywords. The detection card now shows a small "Added N seed keywords to the universe below" confirmation line instead of a chip list. The Keyword Universe is the single source of truth; review, edit, or delete there.
- **Keyword list is always visible.** Replaced the `<details>` collapsible "View keywords" with an always-visible scrollable section so you can see every tracked keyword without expanding anything.
- **Inline keyword edit.** Click any keyword text in the list to turn it into an input. Press Enter or click away to save, Escape to cancel. Save replaces the old keyword (delete + add-as-manual) so the universe count stays consistent. Remove button still lives on the right.
- **The "Use these" button** now only confirms segment + competitors + region (keywords are already applied on detect). Subtext updated to match.

### Added
- **Auto-clustering.** Topic clustering now fires automatically on a debounced timer whenever the keyword count changes. 8-second debounce so bulk pastes don't thrash the Claude API; minimum 5 keywords required to trigger. The explicit "Cluster keywords" button is gone — replaced with a status indicator showing the current state ("Topic clustering · automatic" / "Auto-clustering…" / list of current clusters).

### Notes
- No schema changes. Uses existing endpoints: POST `/api/projects/{id}/keywords` (add), DELETE `/api/projects/{id}/keywords?keyword_id=…` (remove), POST `/api/projects/{id}/cluster-keywords` (cluster). Inline edit uses delete + re-add since there's no PATCH endpoint for individual keywords.
- Cost note: auto-clustering will fire after detection completes (since detection adds 10-15 keywords at once, crossing the 5-keyword threshold), and again whenever you add or remove keywords. Each cluster call to Claude Haiku is ~$0.01. The 8-second debounce keeps it from spamming.

## [1.1.4] — 2026-05-13

Reorganize the dashboard so inputs are grouped at the top and results sit together below.

### Changed
- **Competitors + Keyword Universe panels moved up** to sit directly under ProjectHeader, before the FirstRefreshBanner. This groups all configurable inputs in one band at the top of the page — domain, brand, segment detection, competitors, keyword universe, region, clustering trigger — so the user can finish setup before scrolling into results.
- **Results stack stays in the same order below**: Story → Share of Voice → What Changed → AIO Trends → Topic Clusters → AIO Opportunities → Keyword Drilldown → Other Domains.

### Notes
- Pure section reorder, no logic changes. Same data flow, same endpoints. The CompetitorPanel still gets its `suggested` prop, the KeywordPanel still calls `onChanged={load}` to refresh the metrics payload when the universe changes.
- Workflow read now flows top-to-bottom: configure → cluster → refresh → read the story → drill into the drilldown.

## [1.1.3] — 2026-05-13

Add an "Acquisition · {client}" pulse card so the client's number reads side-by-side against "Top brand · {leader}."

### Added
- **Acquisition · {client.brand_name}** card (blue accent) at position 1 of row 2. Uses the same denominator and formula as Top Brand (`aios_acquired / total_keywords`), formatted identically so the two numbers are directly comparable. Sub-text says "you lead the field" when the client is #1, otherwise shows ranked position like "you're 3rd of 8."
- Row 2 grid expanded from 4 → 5 cards with responsive breakpoints: `grid-cols-2 md:grid-cols-3 lg:grid-cols-5`.

### Changed
- Citation Share's tooltip rewritten to clarify it shows the **same number** as the new Acquisition card — Citation Share is the generic/template framing of the metric, Acquisition is the personalized framing. Useful in different contexts (template reports vs. executive read).
- Top Brand and Brand Mentions tooltips now reference "the Acquisition card" instead of "Citation Share" where they were establishing the read-across pattern.

### Notes
- Pure presentation. The metric was already in the payload; we're just surfacing it twice with different framings so an executive scanning the dashboard sees their own brand named explicitly next to the leader's name.
- Why two cards with the same number: the visual paired read of "Acquisition · CITI 4.5% / Top brand · CHASE 54.5%" is instantly readable; the generic "Citation share 4.5%" remains for template/report contexts where you don't want to hard-name the client.

## [1.1.2] — 2026-05-13

Split the Story pulse strip into two visual rows so SERP-level metrics sit above client-placement metrics.

### Added
- **Top row · SERP saturation (2 elevated cards):**
  - **Available AIOs** *(new card)* — the raw count of AI Overviews currently surfacing across your tracked queries (e.g. "423"). The absolute size of the AIO battleground.
  - **AIO Penetration in SERP** *(renamed from "AIO penetration")* — the percentage of tracked queries with an AIO present. How saturated the SERP is.
  - Both cards use cyan accent, larger value font, more padding, and a subtle accent-tinted shadow so they read as a clear "headline tier" above the placement row.
- **`emphasis` prop on `<Pulse>`** — opt-in flag that scales the value font from 24px → 36px, bumps padding, strengthens the border, and adds a soft accent-colored shadow ring. Reusable for any future card we want to elevate.

### Changed
- **Bottom row · client placement (4 normal-size cards):** Brand Mentions · Citation Share · Top Brand · X · Others. Same metrics as before, but now framed as "given AIOs are happening, here's where you sit."
- Tooltip on the Available AIOs card explains it's the absolute count and how to read it. Tooltip on AIO Penetration in SERP rewritten to emphasize the SERP-saturation framing.

### Notes
- Pure presentation. No schema, no API, no metric definition changes — `latest.total_aios_triggered` was already in the payload, we're just rendering it as its own card now.
- The visual hierarchy makes the read-order obvious: "is this a market with AIOs?" → "given it is, where do you stand?"

## [1.1.1] — 2026-05-13

Reorder the Keyword Universe panel so the input is at the top.

### Changed
- **Tabs + textarea + upload buttons now sit directly below the panel header**, so the most common action (paste keywords, click Add, or upload a CSV) is visible without scrolling past anything else.
- **Topic clustering card moved below the input surfaces.** Clustering is an analytical step that only makes sense once keywords exist, so it now sits where it belongs in the workflow order: enter keywords → cluster them → review the clusters.

### Notes
- Pure reorder, no logic changes. Same component, same endpoints, same data — just a more sensible top-to-bottom reading order.

## [1.1.0] — 2026-05-13

Two-step new-project wizard with detection up front and auto-add competitors. This is the big onboarding refactor: by the time you land on the dashboard, segment, competitors, and seed keywords are all in place — your first refresh covers everything in **one** SerpAPI pass instead of two.

### Added
- **Two-step wizard** at `/projects/new` with a visible step indicator:
  - **Step 1 — Brand basics:** client URL + brand + aliases + region (the existing form, now sized for a single-purpose page).
  - **Detecting state:** spinner while Claude reads the URL.
  - **Step 2 — Review & confirm:** detected segment with confidence chip, region hint badge, suggested competitors (checkbox list, all checked by default, with verified badges), seed keywords (chip list with per-chip remove), region override, and Back / Create.
- **Auto-add checked competitors** — when you click "Create project," the project is created and every checked competitor is added as a tracked brand in one flow. No more "Use these" → switch to dashboard → click Add on each row.
- **Select all / Select none** buttons for the competitor list when there are more than 1.
- **Per-chip remove** on the seed keyword list — trim what Claude proposed before it hits your keyword universe.
- **Region auto-suggestion** — if the detector returns a region hint and you haven't changed the default (US), the wizard switches to the suggested region quietly. You can override again on Step 2.

### Changed
- The dashboard's CompetitorPanel "From smart detection" suggestion strip is still there — it's still the path for re-detecting mid-project — but the primary onboarding flow no longer relies on it.

### Fixed
- The brittle "detect on dashboard → click Use these → suggestions sit in a separate strip → click Add per row" path that was easy to abandon midway. New projects now have competitors set up before the dashboard ever loads.

### Backend
- No new endpoints, no schema changes. The wizard uses the existing `/api/detect-segment` (no project needed), `/api/projects` POST (which already accepts segment fields + seed keywords), and `/api/projects/{id}/competitors` POST.
- Skip-detection fallback: if you click "Skip detection" on Step 1 or detection fails, the project still gets created with just the brand basics — the dashboard's existing Detect button can re-run detection later.

### Notes
- Existing projects are unaffected. The redesign only changes the new-project flow.
- Why this matters cost-wise: SerpAPI charges per (keyword × region) query, and a refresh has to capture citations for **every** tracked brand to compute share of voice. Adding a competitor after the first refresh means re-running the whole batch to include them. Adding them before the first refresh means one batch covers everyone.

## [1.0.9] — 2026-05-13

Generic placeholders on the new-project form — no more hardcoded CHIP examples.

### Changed
- Client website placeholder: `https://chip.ca` → `https://www.yourdomain.com`
- Brand name placeholder: `CHIP` → `Your brand name`
- Brand aliases placeholder: `CHIP Reverse Mortgage, HomeEquity Bank` → `Your Brand Inc., Your Brand Co.`

### Notes
- Placeholders only — they vanish the moment the user types anything, so this doesn't affect anyone with a project already created. Pure copy edit on `app/projects/new/page.tsx`.
- Confirmed via grep that no other components, copy strings, or default state values still reference CHIP or chip.ca. The app is now fully brand-agnostic.

## [1.0.8] — 2026-05-13

Delete a project from the projects list.

### Added
- **Trash icon on every project card** (top-right corner, red-on-hover). Click opens a confirmation modal.
- **Type-to-confirm modal** — to avoid accidental deletes, the user must type the project's brand name exactly before the "Delete project" button enables. Plus an explicit Cancel button and Escape-to-close. The button shows a spinner during the network call.
- New `components/ProjectCard.tsx` client component — extracted from `app/page.tsx` so the server-rendered project list can host per-card interactivity without converting the whole page to a client component.

### Notes
- **Backend was already complete** — `DELETE /api/projects/[id]` has been live since v1.0.0, `lib/db.ts#deleteProject` executes `DELETE FROM projects WHERE id = ?`, and the schema has `ON DELETE CASCADE` on every foreign key referencing `projects(id)`. So a single DELETE atomically wipes the project plus all dependent rows: keywords, competitors, snapshots, serp_results, citations, mentions. No partial state, no orphan rows.
- After a successful delete the page calls `router.refresh()` so the server-rendered list re-fetches without a hard reload.
- No schema, env-var, or dependency changes.

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
