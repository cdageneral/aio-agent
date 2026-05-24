# Changelog

All notable changes to this project will be documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [SemVer](https://semver.org/).

## [1.1.54] — 2026-05-23

Progress bar now actually updates during a refresh — closes the last gap in v1.1.53's cache-bypass coverage.

### Fixed
- **Refresh progress bar updates live again.** After clicking Run refresh, the strip above the dashboard sections was rendering as just the dark background until the run completed — the bar wasn't visibly progressing from 0% → 100% the way it's supposed to. The completion banner (`Snapshot saved — N AIO(s) detected.`) still appeared correctly because that copy comes from the POST `/refresh` response, not from the polling endpoint. Symptom was masked as "the bar just doesn't work" instead of the underlying cache issue it actually was.

### Root cause
v1.1.51 added `dynamic = "force-dynamic"` to several read routes including `/api/projects/[id]/refresh/progress`. v1.1.52 reverted that because of the metrics regression. v1.1.53 replaced `force-dynamic` with the safer three-layer pattern (`revalidate = 0` + `Cache-Control: no-store` + client `?_=<timestamp>`) on `/quick-wins` and `/keywords/detail` — but the same pattern was never applied to `/refresh/progress`. So the polling endpoint silently went back to the v1.1.50 caching behavior: Vercel's data cache froze the very first response of the poll cycle (`status: "running", done: 0, pct: 0%`) and served that same frozen body for every subsequent 2.5s poll, so the bar stayed pinned at its initial state until the page re-rendered at completion. Same class of bug as the v1.1.51 ticket, different route.

### How (same three-layer pattern, applied to refresh/progress)
1. **`export const revalidate = 0`** added to `app/api/projects/[id]/refresh/progress/route.ts` — Next.js "always re-render" opt-out, the same code path that's working on `/quick-wins` and `/keywords/detail` in v1.1.53.
2. **`noStoreJson()` helper** added to that route, mirroring the helper in `quick-wins/route.ts`. Every exit path through the GET handler — null-snapshot, normal progress, zombie auto-failed — now returns `Cache-Control: no-store, no-cache, must-revalidate, max-age=0` plus `CDN-Cache-Control: no-store` and `Vercel-CDN-Cache-Control: no-store`. Bypasses Vercel's edge cache regardless of what Next does upstream.
3. **Client cache-bust** — `Dashboard.tsx` now appends `?_=<Date.now()>` to every poll. Each request hits a unique URL key, so even if (1) and (2) are somehow ignored the CDN has no key under which to coalesce stale responses.

### Verification
After deploying, click Run refresh on a project with a non-trivial keyword count. The progress strip should now visibly tick — percentage going up, processed count climbing, elapsed time growing, ETA shrinking — at a roughly 2.5s cadence (the poll interval). DevTools → Network → filter to `refresh/progress` should show one request every ~2.5s, each with a unique `_=...` query param and response headers `cache-control: no-store, no-cache, must-revalidate, max-age=0`. The "Refresh complete" green banner at the end is unchanged — that was already working.

### Notes
- No server-side behavior changed beyond response headers and the `revalidate` flag — payload shape is identical to v1.1.53.
- `/api/projects/[id]/refresh` (the POST that actually does the work) was never affected by this issue — its response is what populates the completion banner. No changes to that route in this release.
- If you see the bar still stuck after this deploy, hard-reload the browser once to evict the previous (cached) JS bundle so the new client-side cache-bust query param takes effect.

## [1.1.53] — 2026-05-23

Cache-bypass take 3 — finally repopulates AIO Opportunities and Keyword Drilldown without re-breaking metrics.

### Fixed
- **AIO Opportunities and Keyword Drilldown panels now actually populate.** Both panels were stuck rendering "No completed snapshot for this project yet. Run a refresh first." even when the executive summary on the same page (powered by `/api/projects/[id]/metrics`) showed a complete snapshot from minutes earlier. Root cause is the same one v1.1.51 identified: Vercel's data cache was freezing the first response from each route handler — including `{snapshot: null}` if the first hit happened before a snapshot existed. v1.1.51 fixed it with `export const dynamic = "force-dynamic"` but that broke `metrics`. v1.1.52 reverted that, restoring metrics but leaving the original bug.

### How (three independent layers)
This release uses three stacked cache-bypass mechanisms on `/quick-wins` and `/keywords/detail`, so no single Vercel/Next.js caching layer can freeze a null response again:
1. **`export const revalidate = 0`** on each route — a different opt-out code path from `force-dynamic`. Marks the route as "always re-render" without triggering whatever bundling/initialization side effect made v1.1.51's flag break `latestSnapshot()` on the `metrics` route.
2. **Explicit `Cache-Control: no-store, no-cache, must-revalidate` headers** (plus `CDN-Cache-Control: no-store` and `Vercel-CDN-Cache-Control: no-store`) on every response shape — success, no-snapshot, 404, and the 500 from the error handler. Bypasses Vercel's edge/CDN cache regardless of what Next.js does upstream. A small `noStoreJson()` helper at the top of each route ensures every exit path gets the headers — easy to forget on one branch otherwise.
3. **Client-side timestamp cache-bust** — `QuickWinsPanel` and `KeywordExplorer` now append `&_=<Date.now()>` to every fetch. The URL itself is unique per request, so even if (1) and (2) are somehow ignored the CDN has no key under which to "freeze" a stale response.

Any one of these is normally enough to fix the issue. Stacking them is defense in depth and costs essentially nothing.

### Why this approach (and not the obvious one)
The obvious fix is "just use `dynamic = 'force-dynamic'` again, like v1.1.51 did." We didn't, because v1.1.51 was the deploy where `latestSnapshot()` in the `metrics` handler started returning `null` for snapshots that `listSnapshots()` in the same handler was returning intact. We never fully explained that interaction, so re-applying `force-dynamic` would carry the same unknown risk. `revalidate = 0` is documented as an equivalent opt-out for cached route responses without that specific failure mode, and it's applied here only to the two routes that were actually broken — `metrics` is untouched.

### Verification
After deploying, the AIO Opportunities panel should populate on first load with the highest-priority gaps and Keyword Drilldown should show the per-keyword table for the latest snapshot. The empty-state diagnostic copy from v1.1.49/v1.1.50 still works as a fallback for the legitimate empty cases (no snapshot, region not crawled, all AIOs won). If you see an empty panel after this deploy, it now genuinely means one of those scenarios — not a cache problem.

### Notes
- `metrics` is intentionally not changed in this release. It was working in v1.1.52 and the changes here only touch `quick-wins` and `keywords/detail`. If `metrics` starts misbehaving again the cause is not this release.
- Browser DevTools → Network tab is the fastest way to confirm the fix: a hit on `/api/projects/<id>/quick-wins?...&_=…` should return real `opportunities`/`diagnostics`, and the response headers should show `cache-control: no-store, no-cache, must-revalidate, max-age=0`.

## [1.1.52] — 2026-05-23

Emergency revert of v1.1.51.

### Reverted
- **All `export const dynamic = "force-dynamic"` lines added in v1.1.51** are removed. v1.1.51's hypothesis was that Vercel's data cache was freezing null responses from quick-wins / drilldown. After deploying, `metrics` also started returning `latest: null` — even though `listSnapshots()` in the same handler returned the same complete snapshots that `latestSnapshot()` was now refusing to find. The whole dashboard went empty. Root cause of how `force-dynamic` interacts with this app's setup is still unknown — but reverting restores production.

### State after this release
- We're back to v1.1.50's behavior. The executive summary, charts, clusters, and brand comparison should populate again on the next deploy. AIO Opportunities and Keyword Drilldown will return to the pre-v1.1.51 broken state (showing the original null/cache symptom). The caching issue is still open; needs a different approach.

### Next investigation paths (for future me)
- Try `revalidate = 0` instead of `dynamic = "force-dynamic"` — different Next.js opt-out mechanism with potentially different side effects.
- Try client-side cache busting: add a unique timestamp query param on each fetch.
- Check Vercel deployment logs for v1.1.51 for any build warnings related to the dynamic flag.

## [1.1.51] — 2026-05-23

The root cause of every "panels are empty even though the snapshot has data" symptom: Vercel's data cache was freezing the first response from each route handler and serving it forever.

### Fixed
- **`export const dynamic = "force-dynamic"` added to every GET route that reads database state.** Without this opt-out, Next.js + Vercel can freeze a route handler's first response as a cacheable static response. When the first hit happened during initial setup (no snapshot yet existed), the cache locked in `{snapshot: null}` as the canonical response. Every subsequent request to `/api/projects/[id]/quick-wins` and `/api/projects/[id]/keywords/detail` returned that frozen null even after refreshes successfully created complete snapshots in the database. The `/metrics` route happened to escape the cache (likely because of its heavier computation pattern or its multi-table query mix), which is why the dashboard's executive summary showed real data while the AIO Opportunities and Keyword Drilldown panels stayed empty.
- Applied to: `quick-wins`, `keywords/detail`, `metrics`, `refresh/progress`, `changes`. Mutation routes (POST/DELETE) are already dynamic; this is for the read paths.

### Why
The reporter pasted two API responses side by side: `metrics` returned a complete snapshot from 18:53 with 81 AIOs and CHIP at 21% citation rate; `quick-wins` returned `{snapshot: null}`; `keywords/detail` also returned `{snapshot: null}`. Same DB, same `latestSnapshot()` helper, two routes disagreeing with a third. The only mechanism that can produce that pattern is response caching that's per-route — which is exactly what Next.js + Vercel will do for routes that don't explicitly opt out. Adding `force-dynamic` reverts those endpoints to running fresh per request.

### Notes
- After deploying this, you should refresh the project page in your browser once. The cached null responses are baked into Vercel's CDN; they may take a few seconds to fully clear, but every request after this deploy goes to a fresh function invocation.
- If you somehow still see empty panels after the v1.1.51 deploy, hit the quick-wins URL directly in your browser once and confirm it now returns the real opportunities. From there everything else falls into place.
- This is genuinely the missing piece. Every "the snapshot exists but the panel is empty" symptom for the past several releases ladders back to this caching gap.

## [1.1.50] — 2026-05-23

Hot-fix on a hot-fix: v1.1.49's diagnostic SQL was breaking the quick-wins endpoint, and the client was eating the resulting 500 as "no completed snapshot."

### Fixed
- **Removed flaky `STRING_TO_ARRAY` / `UNNEST` SQL in the diagnostic block.** v1.1.49 added two extra COUNT(*) queries to compute `total_serps_in_snapshot` and `serps_in_region_total`. The region-filtered count used `LOWER(country) IN (SELECT UNNEST(STRING_TO_ARRAY($2, ',')))` to work around `@vercel/postgres`'s missing support for `= ANY($::text[])` with a JS-array binding. The trick worked in TypeScript but failed at runtime on Vercel Postgres, throwing inside the request handler. Without a try/catch wrapper, the failure propagated as an unhandled exception → 500 response. The remaining diagnostic fields (`aios_in_region`, `aios_won_by_client`, `aios_open_gaps`) are now computed entirely from the in-memory `filtered` array. No extra SQL. The "snapshot doesn't include this region" branch is replaced by "0 AIOs in this region" — same actionable signal, no flaky query.
- **Wrapped the whole quick-wins handler in try/catch.** Any unexpected failure now returns `{ error: "..." }` with status 500 instead of crashing silently. Defense-in-depth so the next flaky SQL doesn't masquerade as missing data.
- **Client now surfaces server errors visibly.** `QuickWinsPanel.load()` previously called `await res.json()` without checking `res.ok`, so a 500's `{ error: ... }` body parsed cleanly into a response with no `opportunities` and no `diagnostics`. The panel rendered the most-pessimistic empty-state branch ("No completed snapshot") even when a perfectly good snapshot existed. The fetch now checks `res.ok`, falls back to `res.text()` if JSON parse fails, and stores the error in a new `serverError` state. The empty state branches on `serverError` first — a red banner with the exact failure message — so a broken endpoint can never again look like missing data.

### Why
The reporter installed v1.1.49 and saw the AIO Opportunities panel say "No completed snapshot for this project yet" while the executive summary at the top of the same page was showing populated data. Both panels call `latestSnapshot()` and should agree. The contradiction was: metrics worked, quick-wins was 500-ing, and the client was silently degrading the 500 into the "no diagnostics" empty-state branch. This release stops that pattern in both directions — the server doesn't crash, and even if it did the client would tell you so.

### Notes
- If you see the red "AIO Opportunities couldn't load" banner after installing this, paste me the error text — that's a server problem we can fix.
- If you see a normal empty-state diagnostic ("0 AIOs in Canada" or "all AIOs already cited by CHIP"), that's the genuine state of your data and we can act on it.

## [1.1.49] — 2026-05-23

The AIO Opportunities empty state now tells you exactly why it's empty.

### Added
- **Diagnostic block in `/api/projects/[id]/quick-wins`.** Response now carries a `diagnostics` object: `snapshot_ran_at`, `regions_in_view`, `total_serps_in_snapshot`, `serps_in_region_total`, `aios_in_region`, `aios_won_by_client`, `aios_open_gaps`, `client_brand`. Server-computed against the same filtered set the opportunities loop runs on, so the numbers always match the panel's reality.

### Changed
- **`QuickWinsPanel` empty state now selects copy based on the diagnostic block.** Five distinct messages map to the five ways the panel can legitimately be empty:
  - **No completed snapshot** (`!diagnostics`): "Run a refresh first."
  - **Region not in snapshot** (`serps_in_region_total === 0`): "Latest snapshot didn't include [region] — 0 queries crawled here. Switch the region toggle or click Run refresh."
  - **Region crawled but no AIOs** (`aios_in_region === 0`): "Crawled N queries in [region] — 0 triggered an AIO."
  - **All AIOs already won** (`aios_open_gaps === 0`): "N AIOs in [region], all already cited by [brand]. No gaps to chase — defend what you have."
  - **Filter exclusion** (gaps exist server-side but the client got 0 rows): "N open gaps in [region] but none match the current cluster/kind filters."

### Why
The reporter has now seen the empty-state copy three times across v1.1.44 → v1.1.47 → v1.1.48, each time after a different change, and we've been guessing what the actual snapshot contains. This release stops the guessing — the next time the panel renders an empty state, the message itself will tell us which of the five scenarios is actually happening. From there the fix path is obvious.

### Notes
- KeywordExplorer (drilldown) is deliberately NOT updated in this release. Quick-wins is the cleaner instrument because it computes both "what's in the snapshot" and "what's a gap." Once we know what the quick-wins diagnostic reports, the drilldown empty state will follow.
- The `serps_in_region_total` count uses a small extra `SELECT COUNT(*)` query, gated by region. Net DB cost is one indexed count per quick-wins request, negligible.

## [1.1.48] — 2026-05-23

Diagnostic release: refresh failures are now impossible to miss.

### Changed
- **`refreshMsg` renders as a prominent banner.** Previously it was tiny gray `text-sm muted` text after the progress bar. A near-instant refresh failure (e.g., function crash, missing SerpAPI key, Vercel returning HTML instead of JSON) would land here as something like "Error: Unexpected token < in JSON at position 0" and the user would see no visible feedback at all because the message blended into the rest of the layout. Now success and error states each get their own banner — green/lime with a checkmark for "Refresh complete", red with a warning icon for "Refresh failed" — with the actual error text rendered in body copy and a dismiss ✕ for clearing.
- **`onRefresh()` parses the refresh response defensively.** A server-side crash that returns HTML or an empty body would previously have caused `await res.json()` itself to throw, which got swallowed into a generic "Refresh failed" message that hid the real cause. We now try-catch the JSON parse; if it fails, we fall back to `res.text()` and surface the first 200 chars of the body along with the HTTP status. So if Vercel returns a 500 with an HTML error page, the user sees `Server returned 500 — <html><head>…` instead of a meaningless `Refresh failed`.

### Why
The reporter clicked Refresh after installing v1.1.47 and saw "no progress bar or the words saved anywhere." The Refresh API was failing in ~1–2 seconds (vs the expected 30–60s for a real run), but the failure message rendered too quietly to be noticed. This release doesn't fix any underlying refresh-route bug — it just surfaces the bug so we can read what it actually is.

### Notes
- After installing this, click Refresh once. If it fails fast again, the red banner will tell you exactly what the server returned — share that with me and we can fix the root cause. If it succeeds (full 100% progress bar, "Snapshot saved" banner), we're past the diagnostic phase and your detail panels will populate.

## [1.1.47] — 2026-05-23

The region toggle on the dashboard now actually controls what gets crawled when you click Refresh.

### Changed
- **`onRefresh()` auto-persists the region toggle before firing the refresh.** Previously the toggle was a view-only filter — users would set it to Canada, click Refresh, and get back a US-only snapshot because the server reads `project.regions` (not the toggle) to decide what to crawl. The toggle's intent was always "show me this region," not "crawl this region," but in practice users expected one click to do both. A separate "Save changes" button in the header could persist the toggle, but it was easy to miss and required a two-step dance: toggle → save → refresh. Now `onRefresh()` checks whether the toggle's `regionsForMode()` differs from the persisted `project.regions`, and if so, PATCHes the project with the new regions before posting `/refresh`. The dance becomes one step.

### Why
The reporter walked through "set toggle to Canada → click Refresh → still see no Canadian data" and it took the new diagnostic empty-state messages (v1.1.44) to surface that the project itself hadn't been crawled with Canada. Fixing the empty-state messaging was a partial fix; aligning the toggle's behavior with user expectation is the real fix.

### Notes
- The PATCH happens before `POST /refresh` and is non-fatal: if the persist fails for a transient reason, we still fire the refresh with whatever the server thinks the regions are. The user will see the warning in the console and the toggle change will simply not take effect this refresh — they can try again.
- Header's "Save changes" button still works for users who want to persist region (or other settings) without firing a refresh. The two paths just stay aligned now.
- This does mean toggling the region selector and clicking Refresh is irreversible-without-another-refresh — you can't preview Canada-only without committing the project to crawling Canada. If anyone needs a true "view-only" override later we can re-introduce it with a separate control.

## [1.1.46] — 2026-05-23

Hot-fix: v1.1.45 fixed the zombie progress bar by auto-failing old `running` snapshots, but introduced a regression where clicking Run Refresh after a zombie cleanup showed no progress bar at all.

### Fixed
- **Polling no longer stops on the auto-failed zombie response.** When the user clicks Refresh while a stale zombie snapshot is still the most-recent row in the DB, the very first poll happens in a tiny window before the server's `POST /refresh` has called `createSnapshot`. The endpoint returns the zombie, the auto-fail kicks in, the now-failed zombie comes back as stale (status='failed', elapsed > 600s), and the v1.1.45 client correctly hid it — but it also called `stopInterval()`. Subsequent polls never fired, so the new running snapshot the server was about to create never appeared, and the bar stayed hidden. The Dashboard polling tick now keeps the interval alive while `refreshing === true`, even if the current snapshot reads as stale; the next 2.5s tick catches the new snapshot the moment the server makes it.

### Why
The v1.1.45 design assumed "snapshot is stale → nothing to show → stop polling." That's the right rule when the user lands on the page cold. It's the wrong rule mid-refresh, because the staleness is transient — a new snapshot is incoming. Tying the interval-lifetime to BOTH the snapshot freshness AND the user's refresh state closes the gap.

### Notes
- No API or DB changes. The progress endpoint's zombie auto-fail logic from v1.1.45 is unchanged.
- After installing: clicking Run Refresh should now show the progress bar within ~2.5 seconds (one polling tick), regardless of what zombies the project has lying around.
- If you still don't see a bar after Refresh, hard-reload the page once — there's a one-time bundle cache invalidation needed for the new effect to register.

## [1.1.45] — 2026-05-23

Hot-fix: zombie progress bars. A snapshot stuck in `running` status from a long-killed Vercel invocation would keep appearing as a stalled refresh on every page load — hours or days after the actual function had died. Three layers of fix.

### Fixed
- **Server-side zombie auto-fail.** `GET /api/projects/[id]/refresh/progress` now permanently marks any `running` snapshot older than 10 minutes as `failed` via `finalizeSnapshot`, with a synthetic error message explaining what happened. Vercel's hard max for a function is 60s (Hobby) or 300s (Pro) — a snapshot still showing as `running` ten minutes after `ran_at` is definitively a zombie, not a live job. One DB write per zombie on the first poll past the threshold; thereafter the row reads as `failed` and gets filtered out by the existing 10-minute terminal-freshness window. Net effect: a stale "Refresh stalled" banner that survived across page reloads now self-cleans on the next visit.
- **Client-side age cap (defense-in-depth).** Dashboard's polling tick no longer trusts `status === "running"` alone — it also requires `elapsed_sec ≤ 600`. So even if the server-side auto-fail hasn't run yet (race on the very first poll, transient DB issue), the client refuses to render a 13-hour-old "running" snapshot as live.

### Added
- **Dismiss button on the refresh progress strip.** Small ✕ in the top-right corner of `RefreshProgress`. Click to clear the bar immediately without waiting for the freshness window to close. Renders only for terminal statuses (`complete` / `failed` / stalled) so an actively running refresh can't be hidden by accident.

### Why
The reporter walked into an existing project and saw a "Refresh stalled" banner for an old 5,615-keyword run that died 13 hours ago, even though the current keyword universe is only 109. The progress endpoint was correctly reading the most-recent snapshot regardless of status (that's how mid-refresh polls work), but had no way to recognize when a `running` snapshot was clearly dead. Auto-failing past the Vercel-time-limit threshold turns the data into the truth — that snapshot is failed — and every downstream consumer (this endpoint, the snapshots list, the dashboard polling effect, anywhere else that touches snapshot status) gets the right answer.

### Notes
- Once you load a project after this fix, the zombie snapshot from your earlier session will be auto-failed on the first poll (one quick DB write) and the bar will disappear. No data is lost — `serp_results` rows from the partial run stay in place; only the snapshot's `status` flips from `running` to `failed`.
- The "stalled" callout that fires inside an active refresh (status still `running`, no progress in 60s) is unchanged — that's still useful while a refresh is genuinely in flight.

## [1.1.44] — 2026-05-23

Hot-fix: the region toggle wasn't applied consistently across the dashboard, so the exec summary and the detail panels could disagree on whether there was data.

### Fixed
- **Region filter applied to the latest-snapshot metrics computation** in `app/api/projects/[id]/metrics/route.ts`. Previously this call passed only `{ kind }` while the historical-series computation a few lines above passed `{ regions, kind }`. The result: a user with the region selector set to Canada-only would see the executive summary, KPI cards, and story panel happily showing all-region data, while AIO Opportunities and Keyword Drilldown — both of which correctly respected the filter — returned empty. Same snapshot, two views, opposite verdicts. Now every consumer of the latest payload sees the same region-scoped picture.

### Changed
- **More diagnostic empty-state messages** in `QuickWinsPanel.tsx` and `KeywordExplorer.tsx`. Previously the messages were either "No gettable opportunities right now…" or "No keyword data yet. Run a refresh first." — both correct but not actionable. The new copy names the region in play ("No gettable opportunities for **Canada** in the latest snapshot.") and surfaces region-filter mismatch as the most common cause, so the user's next move ("switch region toggle or re-refresh with Canada included") is obvious. The drilldown also splits its empty state into "no completed snapshot at all" vs "snapshot exists but is empty for this region" so the two failure modes don't share one message.

### Why
The reporter's symptom was "the exec summary shows populated data but AIO Opportunities and Keyword Drilldown are empty — what's going on?" The exec summary was unintentionally showing US data while the detail panels honestly reported zero rows for the selected Canada filter. Once both halves of the dashboard agree on what region they're scoped to, the situation becomes legible: "this snapshot doesn't cover Canada — refresh it to see Canadian results."

### Notes
- No database schema or API contract changes. Pure behavior fix in two TypeScript files, plus prose tweaks in two components.
- If you previously relied on the exec summary showing all-region data regardless of the toggle, you'll now see it filter. Set the region selector to **Both** to restore the prior all-region view.

## [1.1.43] — 2026-05-23

The COMPETITOR MOVEMENT strip ("Edward Jones CAN +16 new citations") was great for a glance but a dead end if you wanted to know *which* 16 keywords. Now each competitor is click-through.

### Added
- **Click-through competitor movement.** Each brand chip in the strip is now a button. Clicking it expands an inline accordion below the strip with two stacked lists: **Gained** (keywords the competitor newly got cited on) and **Lost** (keywords they were cited on last snapshot but aren't now). Each row shows keyword + country + position + an AIO-answer snippet excerpt for context. Click a different brand to swap; click the same brand again to collapse.
- **Losses tracked, not just gains.** The previous diff only counted competitors gaining new citations. v1.1.43 also tracks competitors *losing* citations between snapshots. Chips show `+N` (green) for gains and `−N` (red) for losses; brands with either kind of movement are clickable. Brands that ONLY had losses now surface in the strip too (previously hidden because the only signal was `competitor_gained`).
- **AIO snippet helper.** New `snippet()` utility on the server normalises whitespace and trims AIO answer text to ~160 characters before sending — keeps the accordion rows scannable instead of walls of text.

### Changed
- **/api/projects/[id]/changes endpoint** now returns a new `competitor_movement` field shaped as `[{brand_name, net, gained_count, lost_count, gained: [...], lost: [...]}]`. The legacy `competitor_gained` (counts only) is still emitted for backward compat — the digest-copy Slack template still uses it.
- **Snapshot load query** now pulls `aio_text` from `serp_results` so the snippet can be rendered without a second fetch. Same query, one more column.

### Notes
- Each accordion list caps at 25 rows server-side. If a brand has more movement than that, the chip-side count is the real total and the in-panel list shows "top 25 shown".
- The accordion uses the existing region filter, so toggling US / Canada updates the lists.
- No database schema changes. Pure read-side computation off the two snapshots already being diffed.
- The PDF export and digest copier are untouched in this release — they still summarise *just gains* via the legacy field. Wiring the new richer detail into either is a follow-up.

## [1.1.42] — 2026-05-23

Make the relationship between the executive-summary "Your position" tile and the trend chart underneath obvious.

### Changed
- **"Acquisition rate" trend chart renamed to "Your position over time."** The previous label was vague and gave no hint that the chart was the time-series view of the same metric shown in the exec-summary tile. The new name makes the connection one-to-one.
- **Trend-chart caption rewritten.** Was "Citation rate over time — {brand} vs tracked competitors." Now reads "Citation rate per refresh snapshot — {brand} (blue) vs tracked competitors. Each point = one refresh." Spells out that the X-axis is per-snapshot (not daily / weekly / on a fixed cadence) so users don't have to guess.
- **Your-Position trend pill now shows absolute pt change.** Was "8% vs prior" — a growth rate of the raw acquired-count, which forced the user to mentally translate "8% growth in the underlying count" into "what does that mean for my citation rate?" Now reads "1.7 pts vs prior snapshot" — the literal point change in citation rate, using the `citation_rate_delta` field the metrics route already computed. The threshold for showing the pill drops from 1% relative change to 0.5 absolute pts; same rough sensitivity, more honest unit.

### Why
The user reported confusion about how "Your position" (point-in-time, 21.4% in their data) related to the trend chart underneath. Three concrete pain points came out of the conversation: the chart label was opaque, the time axis cadence was unstated, and the "Your position" card had no direct trend signal so users had to scan the chart below to know which direction the number was moving. This release addresses the first three together — same numbers, much clearer narrative.

### Notes
- No data shapes or API responses changed. `growth.brands[i].citation_rate_delta` was already in the metrics payload; we just started reading it.
- The legacy `aios_acquired` growth-rate field on `growth.brands[i]` is still emitted by the metrics route — left alone in case anything else consumes it (PDF export, what-changed digest) and to avoid a wider blast radius for what's a UI-only fix.

## [1.1.41] — 2026-05-23

Cosmetic cleanup: the "AIO coverage" tile in the executive summary was duplicating the signal already carried by the headline.

### Removed
- **AIO coverage tile** from the 4-insight grid in `StoryPanel.tsx`. The tile showed `triggerPct` (total AIOs triggered / total keywords) with a "84 of 109 tracked queries" subtitle. The same number drives the headline copy that sits directly above it — "AIOs dominate this SERP" at ≥50%, "AIOs are reshaping this SERP" at ≥30%, "AIOs are emerging in this SERP" below that — so the tile was restating the headline's basis as a number. With the tile gone the at-a-glance signal is unchanged and the grid feels less crowded.

### Notes
- The grid uses `grid-template-columns: repeat(auto-fit, minmax(220px, 1fr))`, so the remaining three insights (Your position, Strongest cluster, Weakest cluster / Biggest battleground) reflow naturally on every viewport.
- `triggerPct` itself stays computed — the headline still references it. No exported data shapes or downstream consumers (PDF export, what-changed digest, etc.) are touched.

## [1.1.40] — 2026-05-23

Hot-fix: the v1.1.37 refresh-progress bar wasn't appearing on click *or* on page reload mid-refresh. Two bugs in the polling wiring stacked together.

### Fixed
- **Polling never ran on mount.** The polling `useEffect` in `Dashboard.tsx` bailed early when `refreshing === false`, which is the initial state on every fresh page render. If the user reloaded the dashboard while a long refresh was running on the server — exactly the moment they'd want to come back and check on it — there was nothing polling and the progress bar never appeared. The effect now always polls on mount, with the cadence controlled by what the first poll returns.
- **Freshness filter compared client clock against server clock.** The original `if (snapStartedMs + 5000 < refreshStartedAtRef.current) return;` filter compared the snapshot's `ran_at` (server clock) against `refreshStartedAtRef.current = Date.now()` (client clock). Any clock skew between Vercel and the browser — common across regions, especially when the user's machine is suspended/resumed — could incorrectly exclude a just-created snapshot. We now use the server-computed `elapsed_sec` directly, which removes the client/server clock dependency entirely.

### Changed
- **Recency rule is now status- and age-based.** The polling tick shows a snapshot when `status === "running"` (server thinks work is happening — stall detection inside the endpoint still catches zombies) OR when it finished within the last 10 minutes (so the user can see the final state briefly after completion). Older terminal snapshots are no longer surfaced — they'd be stale UI noise.
- **Polling lifecycle is now self-managing.** Initial tick fires on mount. If the snapshot is `running`, the interval starts and runs at 2.5s cadence. Once the snapshot reaches a terminal status the interval stops but the final state stays visible. When the user clicks Refresh, the effect re-runs (because `refreshing` is in its dep array) and the interval resumes. Net effect: no wasted DB queries when nothing is happening, but the bar appears immediately when something starts — whether the user clicked it on this page load or on a previous one.

### Removed
- The `refreshStartedAtRef.current` filter check inside the polling tick. The ref is still set by `onRefresh()` (harmless) but no longer gates anything; the next pass can drop it entirely.

### Why
The user reported "I am not seeing the progress bar that we built show up when I refresh or when the system is running." Both phrasings point at the same gap — the bar relies on a click-triggered state flip (`refreshing`) to start polling, and a clock-comparison filter that's fragile across machines. The fix removes both fragile dependencies in favor of a server-driven recency signal (`elapsed_sec`) and a mount-time poll that doesn't care how the refresh started.

### Notes
- Server-side changes: none. The `/api/projects/[id]/refresh/progress` endpoint and `snapshotProgress` / `latestSnapshotAnyStatus` DB helpers are unchanged.
- If you're staring at the dashboard during a long refresh and don't see the bar within ~3 seconds, hard-refresh once — there's a one-time cache invalidation needed for the new effect to register, but nothing persistent.

## [1.1.39] — 2026-05-23

Hot-fix: after deleting keywords, the next CSV upload appeared to do nothing until the user refreshed the browser. Two contributing causes addressed.

### Fixed
- **Silent-drop on CSV upload during transient state.** The file input's `onChange` previously checked `if (f && !busy && !wiping) uploadCsv(f)` and reset `e.target.value` regardless of whether the upload was kicked off. When `busy` or `wiping` was still settling (e.g., a slow delete or a background cluster call that hadn't fully resolved), the user's file pick was discarded with zero feedback — the file picker closed, no message appeared, and the user reasonably assumed the app was broken. Now the same gate surfaces a clear `setMsg("Please wait for the current operation to finish, then try the upload again.")` so the user knows to retry instead of refreshing.
- **State left stuck after delete.** `runConfirmedDelete` only reset `wiping` in its `finally` block. If any prior pipeline (an upload whose cluster step was killed by Vercel's `maxDuration`, a manual cluster the user navigated away from mid-call, etc.) left `busy` or `clustering` stuck `true`, the post-delete UI was unresponsive — Add manual, Upload CSV, and the source-trash buttons would all stay disabled — until a browser refresh wiped React state. The `finally` now resets all three gating flags (`wiping`, `busy`, `clustering`). The setters are no-ops when the values are already false, so the happy path is unchanged.

### Why
The reproducer ("after I deleted, I could not upload until I refreshed") points squarely at client-side stuck state — browser refresh resets all React state, which is exactly the failure surface here. The silent-drop fix removes the worst part of the failure mode (no feedback at all) for any user who encounters it; the belt-and-suspenders state reset prevents the underlying stuck state from biting when delete is the next action.

### Notes
- Neither change touches the API or the database. Hot-fix is client-only — `components/KeywordPanel.tsx` is the only file modified.
- If you see "Please wait for the current operation to finish…" right after clicking Upload CSV, that's the new message firing. Wait a moment for the in-flight op to finish, then try the upload again. If the message appears with no visible operation running, that's a bug worth flagging.

## [1.1.38] — 2026-05-23

Make the keyword universe easier to manage: delete a single source as a "set", give CSV upload equal billing with manual entry, and stop re-clustering on every tiny change.

### Added
- **Per-source delete control** — each source tag in `KeywordPanel` (e.g. `manual: 5,625`, `organic: 312`) now has a small trash button. Clicking it opens the existing destructive-action confirm modal, scoped to that source ("Delete all 5,625 manual keywords? Other sources are untouched."). Only the keywords with that source are removed; other sources, snapshots, and project settings are untouched.
- **`lib/db.ts` → `deleteKeywordsBySource(project_id, source)`** new helper. Single `DELETE FROM keywords WHERE project_id = … AND source = …` returning row count.
- **`DELETE /api/projects/[id]/keywords?source=<name>`** new scoped delete path. Source is validated against the `manual | organic | market | seed` enum so a bad value can't reach the DB. The existing `?all=true` and `?keyword_id=…` paths are unchanged.

### Changed
- **Add manual + Upload CSV are now equally-weighted primary CTAs.** Previously the CSV upload was a small ghost-styled label that read as secondary; users repeatedly missed it. Both buttons now have full primary styling — green/plus for "Add manual", blue/upload for "Upload CSV" — sitting side-by-side in the input row.
- **The CSV `<input type="file">` now resets its value after each pick**, so re-uploading the same filename actually re-triggers the upload. Previously a same-name re-pick was a no-op.
- **Auto-clustering is now one-shot per add/upload.** The previous behavior auto-clustered on a 3s debounce whenever the keyword *set signature* changed — initial mount, edits, deletes, every add. That generated surprising re-cluster runs and forced two layers of guards (signature ref + 30s cooldown ref) to avoid loops. The new policy: clustering fires automatically *exactly once* after a successful manual add or CSV upload, and never automatically otherwise. Edits, deletes, page loads, and per-source wipes no longer trigger clustering. The manual "Cluster now" button is unchanged.
- **Confirm modal is now shared** between the global "Delete all" wipe and the per-source wipes. Title, body copy, and CTA label adapt to whether the staged delete is `{ kind: "all" }` or `{ kind: "source", source, count }`.
- **Cluster banner copy** updated to reflect the new policy: "Topic clustering · auto-runs once after each add" with a "Click Cluster now to re-run" hint after a successful cluster.

### Removed
- **Signature-based auto-cluster guards** (`lastClusteredSigRef`, `lastClusteredAtRef`) and the 30-second cooldown logic from v1.1.26. They were defensive scaffolding around the useEffect-driven auto-cluster loop bug, which no longer exists now that clustering is event-driven rather than state-driven. `useRef` import dropped from `KeywordPanel.tsx`.

### Why
Three pain points stacked up. (1) Users with mixed-source universes had no way to drop just one source — only "delete this single keyword" or "wipe everything". The trash-on-tag pattern reuses the existing confirm-modal flow so the destructive UX stays consistent. (2) Hiding CSV upload behind a ghost label made bulk imports invisible to new users — multiple support pings about "how do I upload?". Promoting it to a real primary button is a one-line discoverability fix. (3) Auto-clustering on every keyword-set change burned Anthropic credits, surfaced as visible spinner churn during routine editing, and required a knotted set of guards to stay correct. Tying clustering to the actual user intent ("I just added new keywords, group them") is simpler, cheaper, and matches user expectation.

### Notes
- **Snapshots are still preserved.** Same rationale as v1.1.35 — only the `keywords` table is touched by either wipe path.
- **Edits no longer re-cluster.** If you edit a keyword and want the new text re-grouped, click "Cluster now". Same for after deletes.
- **First-time-loading existing unclustered universes won't auto-cluster.** This is intentional — the old auto-cluster-on-mount behavior is gone. If you open a project where keywords have no `cluster_label` (e.g., legacy projects pre-v1.1.6), click "Cluster now" once to populate them.

## [1.1.37] — 2026-05-22

Add a live refresh progress bar so the user can tell whether a long SerpAPI run is moving or hung.

### Added
- **`RefreshProgress` component** — sticky strip above the dashboard sections during a refresh. Shows a colored progress bar (lime for healthy, amber/red for stalled or failed), the count "Processed 1,234 / 6,436", real-time AIO hit count, error count, elapsed time, throughput (kw/s), and ETA. Status pill flips between "live", "complete", "failed", and "stalled".
- **`GET /api/projects/[id]/refresh/progress`** new endpoint. Returns the latest snapshot's status + count of `serp_results` rows written so far + computed `pct`, `elapsed_sec`, `stalled` heuristic.
- **Stall detection** — if a snapshot has been in `running` status for >60s with zero rows written, or its overall rate is below 0.05 keywords/sec after 5 minutes, the UI flags it as stalled. Most common cause: Vercel function exceeded its execution time limit and was killed mid-run.
- **`lib/db.ts` → `latestSnapshotAnyStatus()` + `snapshotProgress()`** new helpers backing the progress endpoint.
- **Dashboard polling** — when `refreshing` is true, polls `/refresh/progress` every 2.5s. Only surfaces progress for snapshots that started at-or-after the user's last Run-refresh click, so stale `running` snapshots from previous sessions don't appear when the page is reloaded.

### Why
For a large keyword universe (1,000+), a refresh takes many minutes — and on Vercel the function will almost certainly hit its execution time limit before finishing. Without a progress display, the user can't tell whether the refresh is making progress, has stalled, or completed silently. The progress bar surfaces all three states honestly.

### Known limitation (not fixed in this release)
A single Vercel serverless function CANNOT complete a refresh of 1,000+ keywords on Hobby (60s) or even Pro (300s). The progress bar will accurately show that the function died partway through. The proper fix is a background-job pattern (cron-triggered chunked refresh, or an external worker) — this is on the roadmap but requires a more involved architectural change. For now, the progress bar at least makes the failure mode visible instead of leaving the user staring at a spinning button forever.

## [1.1.36] — 2026-05-22

Make 10k-keyword uploads actually work end-to-end.

### Changed
- **`addKeywords` now batches INSERTs in chunks of 500 rows.** Previously the whole upload was a single INSERT with `4 × rowCount` parameters in one statement — fine for 500 rows, broken for 10,000. Two failure modes were waiting:
  1. **Postgres parameter limit** — 65,535 max per statement, and Vercel Postgres / PgBouncer get unhappy well below that. A 10k upload generated ~40k parameters in one statement.
  2. **Vercel function timeout** — a single 10k-row INSERT can take 30+ seconds on cold serverless. Combined with CSV parse + brand classification time, hitting the 60s Hobby limit was likely.
- Batches of 500 keep each statement under 2,000 parameters and complete in well under a second each, regardless of universe size.
- `ON CONFLICT DO NOTHING` is now applied per batch — dedup semantics across the whole upload are preserved (the table-level unique constraint catches duplicates between batches).

### Why
The v1.1.34 cap removal eliminated the *route-level* gate, but `addKeywords` itself was never tested at scale and would have failed silently on a 10k upload — either with a Postgres error returned as 500 (which the frontend then surfaces as the unhelpful "Unexpected token 'A'" JSON parse error from the earlier debug session) or with a Vercel function timeout. This release closes that loop so the uncapped universe is actually usable.

## [1.1.35] — 2026-05-22

Add "Delete all keywords" so a project can be re-seeded from scratch without recreating it.

### Added
- **`Delete all` button** in the `KeywordPanel` header, next to the keyword count. Hidden when the universe is empty. Disabled while a refresh or cluster is in flight so the rug doesn't get pulled out from under another operation.
- **Confirm modal** — fixed overlay with a red destructive-action style. Shows the exact count being deleted ("Delete 438 keywords"), notes that snapshots are preserved, and requires an explicit confirm click. Backdrop click cancels (but not mid-delete).
- **`lib/db.ts` → `deleteAllKeywords(project_id)`** new helper. Single `DELETE FROM keywords WHERE project_id = …` returning row count.
- **`DELETE /api/projects/[id]/keywords?all=true`** bulk delete path. The existing `?keyword_id=…` single-row delete is unchanged — per-row Remove buttons still work.

### Why
Users wanted to refine a project's keyword set by starting over (e.g., replacing a draft CSV with a curated one) without losing the project's snapshot history, segment detection, competitors, or settings. Deleting the whole project to get a clean slate was overkill. Per-row delete on 438 keywords was painful.

### Notes
- **Snapshots are intentionally preserved.** The wipe only touches the `keywords` table — historical AIO-coverage data remains queryable for "what changed" comparisons across past keyword sets. If the new universe diverges entirely from the old, those comparisons get less meaningful, but the data is still there.
- After wipe, the auto-cluster signature ref is reset so the next set of keywords triggers a fresh cluster pass (otherwise the "already clustered this signature" guard would block clustering of the new universe).

## [1.1.34] — 2026-05-22

Remove the 500-keyword universe ceiling. Add chunked clustering so any-size universes can be grouped into topics in one click.

### Changed
- **`MAX_KEYWORDS_PER_REFRESH=500` is gone.** The keyword universe is now uncapped. The legacy env var is removed from `.env.example`. The keyword `POST` route no longer rejects when the existing count exceeds a ceiling; manual paste and CSV upload accept any size payload.
- **`KeywordPanel` no longer shows `X / 500`.** The header now reads "1,847 keywords" — a plain count with thousands separators — and the `max` state has been removed.
- **`/api/projects/[id]/keywords` returns `max: null`** to signal "unbounded" while keeping the field present so older clients don't crash.
- **Cluster route is now batched.** The hard `keywords.length > 500` rejection in `/api/projects/[id]/cluster-keywords` has been replaced with automatic chunking — the universe is sorted alphabetically, split into batches of 400, each batch is clustered by Haiku, and the resulting clusters are merged by case-insensitive name across batches. A 2,000-keyword universe now clusters in 5 Anthropic calls instead of being rejected outright.
- **Response shape updated** to include `batches` and `batch_size` so the UI can show "Clustered 2,000 keywords across 5 batches" instead of leaving the user to wonder why a single call took 20 seconds.
- **`maxDuration` on the cluster route bumped from 60s → 300s** because batched clustering for large universes can cumulatively run past a minute.

### Added
- **`MAX_KEYWORDS_PER_CALL`** new optional env var (default 2000). Caps a single *discovery* POST (`organic` / `market` / `seed`) to prevent one click from spending a ton of SerpAPI credits. Manual paste and CSV upload are unaffected.

### Why
The 500-keyword ceiling was originally a cost guardrail for SerpAPI burn. In practice it forced analysts to manually chop their universe into chunks and lose the unified view. The cost concern is better solved by per-call discovery limits (where the cost is incurred at add-time, not view-time) than by capping how many keywords a project can track. Clustering had its own technical reason for the 500 cap (Haiku response token budget) — chunked clustering with name-based merge solves that without making the analyst do the math.

### Migration
Existing deployments: any `MAX_KEYWORDS_PER_REFRESH` value in your Vercel env vars is now ignored. You can delete the var (it won't break anything either way). If you previously hit the cap and worked around it by chopping your universe, you can now consolidate everything into a single project. Re-cluster after consolidating — clustering will batch automatically.

## [1.1.33] — 2026-05-22

Add a "Copy PPT Prompt" button that emits a fully-populated slide-generation prompt for the active deck.

### Added
- **Copy PPT Prompt button** in `ProjectHeader`, sitting to the left of *Export Full Report*. One click builds a long-form natural-language prompt from the live snapshot and writes it to the clipboard. The user pastes it into Claude / Copilot / ChatGPT inside PowerPoint to generate two slides:
  - **Slide A — "AIO landscape"** — title bar with universe label, 7-card KPI strip (Available AIOs, AIO Penetration, Acquisition, Brand Mentions, Citation Share, Top Brand, Others), then a three-column bottom: featured brand highlight tile, full citation-share-by-brand bars (tracked brands + non-brand buckets), top non-brand domains by AIO count.
  - **Slide B — "AIO opportunity map"** — three summary cards (LEADS / TRAILS / WIDE OPEN), full cluster grid with status badges, per-cluster numbers (kw, AIOs, penetration, client citation rate, caption), and an orange "THE READ" insight strip.
- **`lib/export.ts` → `buildPptPrompt(latest, ctx)`** new pure function. Pulls KPIs from the SnapshotMetrics payload (totals, client brand metrics, full share-of-voice, top non-brand domains, every cluster's stats) and stitches them into a prompt with explicit style instructions telling the receiving AI to **match the active deck** (fonts, colors, masters) rather than hard-coding a look — so the button works regardless of which client deck is open.
- **Toast confirmation** ("Prompt copied — paste into Claude/Copilot/ChatGPT inside PowerPoint") that auto-dismisses after 4 seconds, plus a clipboard-unavailable fallback that opens the prompt in a new tab.
- **`Dashboard.tsx`** now passes `latestMetrics={latest}` into `ProjectHeader` so the prompt builder has live snapshot data without an extra fetch.

### Why
Users wanted a fast bridge from the dashboard into client decks. PDF export covers shareable artifacts, but PPT requires editable, on-brand slides — and every client deck has its own master. Rather than build a server-side PPT generator that can't know any given client's style, the prompt path lets the in-PowerPoint AI infer the deck's look automatically while the prompt itself carries every concrete number the slides need. The button stays disabled until a snapshot exists, with an explanatory tooltip.

### Notes
- Universe label in the slide title is derived from `project.segment_l3 ?? segment_l2 ?? segment_l1` so a TRT/HRT project lands as "AIO landscape — TRT/HRT keyword set" automatically.
- The "THE READ" insight on slide 2 is generated heuristically from the cluster shape (e.g. "Empower leads in 8 clusters but at 5–25% citation rate — we win where no one tries hard. The 10 open clusters are the land grab.") so the slide ships with a usable narrative, not just data.

## [1.1.32] — 2026-05-22

Add a full-dashboard PDF export, anchored in the project header.

### Added
- **Export Full Report button** in `ProjectHeader`, sitting alongside Save changes and Run refresh. One click captures the entire dashboard — Story, Share of Voice, What Changed, AIO Trends + Acquisition charts, Topic Clusters, AIO Opportunities, Keyword Drilldown, Brand Comparison, and Other Domains — into a multi-page PDF.
- **Dedicated cover page** with brand name, client URL, region scope, generated-at timestamp, and a section count.
- **`lib/export.ts` → `exportFullReportToPdf(root, ctx)`** new helper that snapshots each top-level section of the dashboard individually via `html2canvas` and lays the bitmaps onto Letter-portrait PDF pages. Per-section capture (rather than one giant capture) preserves chart/panel integrity across page breaks. Long sections are automatically sliced across pages.
- **`data-aio-report-root="true"`** attribute on the `Dashboard` wrapper, used by the exporter as a stable capture target rather than relying on selectors that could drift.
- **html2canvas** added to `package.json` dependencies (was already vendored in `node_modules` from prior work but not declared).

### Why
Users wanted a single shareable artifact of the full report — not just a keyword drilldown — to send to clients and stakeholders without screen-recording the dashboard. Client-side `html2canvas` + `jsPDF` was chosen over server-side Puppeteer to avoid a heavy headless-Chrome dependency, and over `@react-pdf/renderer` to avoid rebuilding every chart as PDF primitives. The "what you see is what you print" approach guarantees the PDF matches what the user is looking at when they click Export.

### Notes
- Both libs are dynamic-imported, so the bundle only loads when the user actually clicks Export.
- Cover page and page backgrounds use the app's dark surface color (`#0b0d12`) so the output matches the on-screen aesthetic.
- Filename pattern: `aio-full-report-<brand-slug>-YYYY-MM-DD.pdf`.

## [1.1.31] — 2026-05-22

Restructure the Story panel as a contained executive briefing card.

### Changed
- **Story panel is now a framed briefing card.** Replaces the prose-paragraph layout with a clearly bordered container that has a header strip ("Executive summary · SERP impact · US · Snapshot date") at the top and a structured 4-insight grid in the body.
- **Four insight blocks** in a responsive grid, mapping 1:1 to the four things a CMO wants in 5 seconds:
  1. **AIO coverage** — how "infected" is the SERP (e.g. 44.4% — 202 of 455 queries)
  2. **Your position** — your citation rate, rank vs leader, gap, and trend chip
  3. **Strongest cluster** — your best-performing topic with citation rate and lead status
  4. **Weakest cluster** — your worst-performing topic with the competitor who owns it (or "Biggest battleground" as a fallback when there's only one meaningful cluster)
- **Disciplined color palette.** Body text is white and muted gray throughout. Only the trend chip uses color (lime ↑ for positive, red ↓ for negative). Eliminated the previous rainbow of cyan, amber, pink, lime, and red emphasis colors scattered across the prose.
- **Removed standalone Wikipedia/Reddit sentence and editorial flourishes.** The non-brand citation share is now exposed in the Other Domains panel further down, not in the executive summary.

### Why
The prose layout was reading as chaotic — too many colors, too many sentences, important numbers buried inside paragraph text. The framed grid lets a CMO scan the four critical facts in two seconds without parsing prose.

## [1.1.30] — 2026-05-22

Rename projects + CMO-tone rewrite of the Story panel.

### Added
- **Rename project from the project list.** New pencil icon sits next to the trash on each project card. Opens a modal with the current name pre-filled, Enter or Save name commits via `PATCH /api/projects/[id]` with the new `brand_name`. Triggers the v1.1.27 `reclassifyKeywords` side effect automatically so branded/non-branded labels stay in sync.

### Fixed
- **"Closest threat below you" was showing the leader.** The `trailing` lookup in StoryPanel was `ranked[clientRank - 2]`, which for a 2nd-place client returns `ranked[0]` — i.e. the brand AHEAD, not behind. The new copy doesn't need this concept and uses the leader directly when the client isn't first, and only mentions the runner-up when the client IS the leader.
- **Raw decimal in citation-count delta.** "Citation count is -0.0625" was the growth rate leaking into the prose as if it were a count. Now formatted as a percentage with an arrow ("↓ 6% vs prior snapshot") and only shown when the change is ≥1% (otherwise it's noise).

### Changed
- **CMO-tone Story rewrite.** Reduced 4 verbose paragraphs to 3 crisp lines that answer exactly three questions: (1) how big is the AIO battleground? (2) where do I rank and which way am I moving? (3) what's the topic I should attack or defend? Removed the "zero-click authority that's eating attention nobody is monetizing" editorial flourish — the Wikipedia/Reddit slot share is now one short clause inside the rank line.
- **Suppressed noisy edge cases.** The "organic footprint" sentence is gone (it added confusion when projects had no organic-source keywords). The branded-vs-non-branded line is hidden when either side has fewer than 10 keywords (the comparison is statistical noise at that scale — was showing "1 of 2 branded queries" before).
- **Headlines tightened.** "AIOs dominate this SERP" / "AIOs are reshaping this SERP" / "AIOs are emerging in this SERP" — present tense, one fewer word each.

## [1.1.29] — 2026-05-22

Preserve scroll position when toggling scope or any other refetch.

### Fixed
- **Dashboard scroll snap on toggle.** `Dashboard.tsx` was collapsing the entire page to a single-line `<div>Loading…</div>` placeholder every time `load()` ran — including when the user toggled the scope filter from down inside the page. The page would shrink to one line, the user would jump to the top, then the data would land and the page would re-expand. Now the full-page loader only renders on the very first load (`!data`). Subsequent refetches keep the existing dashboard rendered.
- **Same fix in QuickWinsPanel and KeywordExplorer.** Both panels had the same anti-pattern (`if (loading) return ...`). Switched to `if (loading && !data) return ...` so the panels keep their previous list rendered while a refetch is in flight.

### Added
- **Inline "Updating…" pill** that appears at the top of the dashboard while a refetch is in flight (replaces the disappearing full-page loader). Small cyan rounded pill with a pulsing dot — non-disruptive, doesn't reflow the layout, but acknowledges that the request is happening.

### Why
The scope toggle felt jarring because every click sent the user back to the top of the page. Now toggling scope rescopes the data in place, the metrics cards re-populate, and the scroll position stays exactly where the user left it.

## [1.1.28] — 2026-05-22

Relocate + refocus the branded/non-branded scope toggle.

### Changed
- **Moved the scope toggle out of the top-of-page area** (under the refresh banner in v1.1.27) and embedded it inside `StoryPanel`, directly above the pulse-card strip. Pairing the control with the metrics it affects makes the cause/effect of toggling obvious — toggling rescopes "Available AIOs" and "AIO Penetration in SERP" right beneath it.
- **Redesigned with much more visual weight:**
  - Wrapped in a soft surface card with subtle top-light gradient + 1px border so it reads as its own UI module, not chrome.
  - "Scope · view by query type" amber section header.
  - One-line plain-English explainer: "Branded queries inflate citation rates because you already rank #1 organically. Toggle to non-branded to see where AIO is actually competing for clicks."
  - Three larger pill buttons in a 3-column grid with primary label, secondary "what it means" subtitle, and the count badge.
  - Active state adds a 1.5px brand-accent border + 3px soft glow ring + filled background tint — impossible to mistake which option is selected.
  - When in a filtered state, an amber "Filtered view active" pill appears on the right side of the section header.

### Why
v1.1.27's toggle sat under the refresh banner, well above any data — users scrolled past it. Putting it adjacent to the first metric cards makes it impossible to miss and self-documenting.

### Notes
- State still lives in `Dashboard.tsx` and flows down through props — `QuickWinsPanel` and `KeywordExplorer` continue to receive `kindFilter` exactly as before. No API or schema changes, no DB migration needed.

## [1.1.27] — 2026-05-22

Branded vs non-branded keyword scope — see how AIO coverage looks for the queries that matter.

### Added
- **`keyword_kind` column** on `keywords` table — every keyword is now classified as `branded` or `non_branded` based on whether the keyword text contains the client's brand name, brand alias, or domain stem on a word boundary. Idempotent SQL migration; no manual step required.
- **`lib/keywordKind.ts`** classifier — pure regex, case-insensitive, word-bounded. Skips 1–2 character brand stems to avoid false positives (e.g. won't match "X" inside random words). Verified with 12 test cases (CITI, Citibank, "citizen watch" false-match avoidance, etc.).
- **Auto-classification on every keyword insert** — `addKeywords()` pulls the project's brand identity and sets `keyword_kind` inline.
- **Re-classification on project PATCH** — when `brand_name`, `brand_aliases`, or `client_domain` changes, every existing keyword for that project gets re-evaluated. Called as a non-fatal side effect — the patch succeeds even if reclassify fails.
- **Opportunistic backfill in `/api/projects/[id]/metrics`** — if any rows have NULL `keyword_kind` (legacy projects), runs `reclassifyKeywords()` once. Idempotent + cheap; no UI step needed.
- **Branded vs non-branded scope toggle** in Dashboard — three buttons (All / Non-branded / Branded) with live counts. Drives the metrics fetch URL plus `kindFilter` props on `QuickWinsPanel` and `KeywordExplorer` so the entire dashboard slices to the same universe. Toggle stays visible above the chart panel.
- **Story strip split line** — when scope is "All", adds a line showing AIO coverage for both halves of the universe ("AIOs appear on X% of non-branded queries, vs Y% of branded queries"). Hidden when scope is already narrowed.
- **Metrics payload now reports** `total_keywords_branded`, `total_keywords_non_branded`, `total_aios_triggered_branded`, `total_aios_triggered_non_branded`, and `kind_in_view`. The split counts are always on the FULL region-scoped universe so the toggle counts stay honest even when filtered.
- **`?kind=branded|non_branded`** query parameter on `/api/projects/[id]/metrics`, `/api/projects/[id]/keywords/detail`, and `/api/projects/[id]/quick-wins`. Defaults to "all" (no filtering) — fully backward compatible.

### Why
Branded queries ("citi double cash card") almost always rank you #1 organically and trigger AIO less often, so they inflate "coverage" metrics without representing real competitive risk. Non-branded queries ("best cash back credit card") are where AIO actually steals clicks and where your share matters. Mixing them hid the real story.

### Notes
- Classification is pure regex against `brand_name + brand_aliases + domain_stem` — no LLM, no extra cost.
- Manual override (per-keyword re-label) is intentionally NOT in this release. If the classifier mis-labels a keyword you care about, edit the brand_aliases on the project to add a missing variant — every keyword reclassifies on patch.

## [1.1.26] — 2026-05-13

Stop the post-cluster cascade — dashboard no longer refreshes everything every few seconds.

### Fixed
- **`Dashboard.load()` was incrementing `refreshNonce` on every call**, which triggered QuickWinsPanel and KeywordExplorer to refetch their own data. Combined with the auto-cluster's `onChanged → load → nonce++ → child refetch` chain (and any cluster re-trigger), the user saw visible re-fetch activity every few seconds. Removed the nonce bump from `load()`. Nonce now only increments on explicit user Refresh — auto-cluster cycles update metrics + cluster cards via `setData(j)` but no longer cascade into downstream panels.

### Added
- **30-second hard cooldown** on KeywordPanel's auto-cluster useEffect. Even if the keyword signature differs from the last clustered version, refuses to schedule another cluster within 30 seconds of the previous one. Defends against any cause-chain that produces repeat clusters — signature flicker during state transitions, retry logic, etc.
- The cooldown ref is also stamped by the manual "Cluster now" button so clicking it pauses the auto-cluster effect for 30 seconds afterward too.

### Notes
- Trade-off: AIO Opportunities and Keyword Drilldown won't auto-refetch when only clustering has changed. Cluster_label tags on those rows may show as the previous cluster name briefly until the next explicit Refresh. In practice this only matters if the user re-clusters mid-session AND then immediately drills down — uncommon flow.

## [1.1.25] — 2026-05-13

Fix cluster JSON truncation — verified with five test cases before shipping.

### Root cause
The "Could not parse cluster JSON: Expected ',' or ']' after array element in JSON at position 15079" error was Claude's response being cut off mid-JSON because `max_tokens: 4096` is too small for cluster outputs with 50-100+ keywords. The strict `JSON.parse` couldn't recover from a truncated string.

### Fixed
- **Bumped `max_tokens` from 4096 → 8192** in `lib/llm.ts` clusterKeywords. Covers all normal-sized keyword sets cleanly.
- **Added `tryRepairTruncatedClusterJson()` fallback.** Walks the response brace-by-brace, properly handles strings + escape sequences, finds the last cleanly-closed cluster object, and rebuilds valid JSON by appending `]}` to close the array + root object. If strict parse fails, repair attempts to recover whatever complete clusters did make it through.
- **Tested with five scenarios before shipping**:
  1. Truncated mid-cluster (position past last complete `}`) → recovers all complete clusters ✓
  2. Complete JSON → strict parse handles it directly ✓
  3. Truncated before any complete cluster → returns null, throws a real error ✓
  4. String containing `{` or `}` (brace inside cluster name) → doesn't confuse depth tracking ✓
  5. Escaped quotes inside keyword strings → string-boundary detection is robust ✓
- **Surfaces `stop_reason` and response length** in the error message when repair fails too, so the next failure mode (if any) is diagnosable.
- **Logs a console.warn** when repair successfully recovered a truncated response, so Vercel logs show which calls hit the limit.

### Notes
- Repair logic is mechanical (no LLM round-trip), so when it activates the user still gets clusters — just possibly fewer than Claude intended to produce. The console warning makes it visible in Vercel logs.
- If the universe is so large that even 8192 tokens + repair can't return useful clusters, the error message now tells the user to "try clustering with fewer keywords" instead of just a bare 500.

## [1.1.24] — 2026-05-13

Make the Update button always clickable + flash green "Applied" on click.

### Fixed
- **Update button felt like it wasn't doing anything.** v1.1.23's `disabled={!dirty}` pattern is technically correct (button greys when there's nothing to apply) but in practice it's confusing — users click an enabled-looking button, the range is already in sync, nothing visible changes, they assume it broke. Three changes to clear it up:

### Changed
- **Update button is now always clickable.** `onChange(pending)` is idempotent so calling it when pending===value just re-commits the same range. Functions as a "force re-render charts" trigger when the user wants to nudge them.
- **Brief lime "Applied ✓" flash for 1.2 seconds after every click.** The button visibly turns lime, icon switches from refresh to checkmark, then fades back to its normal state. Users see the click registered.
- **Background color clearly distinguishes three states**: solid purple = unsaved changes pending, muted purple = synced (no pending changes), lime = just applied (confirmation flash).

### Notes
- If the chart line still doesn't visibly change after clicking Update, that's because all your snapshots fall within both the old and new ranges. The X-of-Y snapshot counter and the latest-value strip on each chart (from v1.1.22 and v1.1.23) will confirm whether the filter is doing anything.

## [1.1.23] — 2026-05-13

Update button on the date picker, removed MoM/YoY, visible dots on trend lines.

### Added
- **Update button** next to the From/To date inputs. Date inputs now track local pending state; the new range commits to the charts only when Update is clicked. Update highlights solid purple when there's an unsaved edit, muted purple when in sync. Preset chips (30 days · 90 days · 6m · 1y · All time) still apply immediately on click since they're a one-click action.
- **Latest-value summary** above the AIOs Triggered chart: shows "Market 423 · Footprint 287 · N snapshots plotted" so users see actual numbers even when the line is short.

### Removed
- **MoM and YoY delta badges** from the AIOs Triggered chart. User said they're not needed there. The badges only ever populated with 30+ days of snapshot history anyway, which most fresh projects don't have, so they were usually dashes.

### Changed
- **Visible data-point dots** on both charts (radius 3-4px, larger on the client/market series, even larger on hover via `activeDot`). With only 1-2 snapshots in a series, the line was nearly invisible — explicit dots make each plotted point obvious.
- **No-data callout** on both charts rewritten: "No snapshots in this range. Try a wider window or click All time."

### Notes
- The "AIO Trends aren't populating" symptom is most likely caused by a series with only 1-2 snapshots — the chart was rendering correctly but the line was barely visible. The new visible dots + numeric summary make the data legible even in that case.

## [1.1.22] — 2026-05-13

Visible "X of Y snapshots in range" feedback above the trend charts.

### Fixed (UX, not functionality)
- **User reported the date picker "doesn't update"** but the wiring is correct — range state flows from PeriodSelector to both charts, both call filterByDateRange. With only 2-3 snapshots, both data points fall within almost any range tested, so the chart looks identical and the filter felt broken. Now there's an explicit counter so users can see the filter IS reactive.

### Added
- **Live snapshot count next to "AIO trends" title** updates in real time as the user changes From/To dates or clicks a preset. Reads as either "5 snapshots (all in range)" when nothing is filtered, or "3 of 5 snapshots in selected range" when the filter excludes some.
- **Red callout** when the range matches zero snapshots: "← no data in this window, try a wider range or click All time." Visible right next to the snapshot count so it's hard to miss.

### Notes
- No functional change to the filter logic itself. This is pure visible feedback so users can verify their date pick is doing something even when the chart line doesn't visibly differ.

## [1.1.21] — 2026-05-13

Surface the real cluster-keywords error instead of a bare 500.

### Fixed
- **`/api/projects/[id]/cluster-keywords` had no try/catch** around the Anthropic call. Any failure — missing `ANTHROPIC_API_KEY`, invalid key, rate limit, model deprecated, malformed JSON response, schema mismatch on the cluster_label column — became a generic 500 with no body. User saw "Server returned 500" with no clue how to fix.

### Added
- **Top-level try/catch** with `console.error` for Vercel logs + a JSON error response so the client surface shows the real cause.
- **`friendlyClusterError()`** translator for the most common cases:
  - Missing `ANTHROPIC_API_KEY` → "Add it under Vercel → Project Settings → Environment Variables and redeploy."
  - 401/invalid key → "Anthropic API rejected the request — regenerate the key."
  - 429/rate limit → "Anthropic rate-limited the cluster call. Wait a minute and try again."
  - Insufficient credits → "Add credits at console.anthropic.com → Billing."
  - Model unavailable → "Check the model is enabled for your org."
  - JSON parse error → "Claude returned a response we couldn't parse. Usually transient — try again."
  - Postgres schema error → "Re-run db/schema.sql in the Neon console."
  - Unknown → raw error message.
- **Better validation copy** for known input failures (e.g., "clustering needs at least 5 keywords; you have 3").

### Notes
- This release just makes the failure mode visible — it doesn't fix whatever was causing your specific 500. After deploying, click "Cluster keywords now" again and the modal will tell you exactly what went wrong. Most common in fresh deployments: ANTHROPIC_API_KEY is missing from Vercel env vars.

## [1.1.20] — 2026-05-13

Add manual cluster-now fallback button. Fix stale "Click Cluster keywords" copy.

### Fixed
- **KeywordClusters empty-state copy** referenced a "Cluster keywords" button that no longer existed (removed in v1.1.5 when clustering went automatic). Updated copy + added a real "Cluster keywords now" button that POSTs to `/cluster-keywords` directly when clicked.
- **Surfaces clustering errors** instead of silently swallowing them. If the manual button fails (Claude API issue, etc.) you'll see a red error message right inside the cluster panel.

### Added
- **"Cluster now" button** in the Keyword Universe panel's auto-cluster status strip. Auto-cluster still runs on a 3s debounce, but if you want to force a run immediately (or auto-cluster stalled out for any reason) you can click this. Disabled until you have 5+ keywords.
- **`projectId` + `onChanged` props** threaded through to KeywordClusters so the empty-state button can trigger clustering directly and bump the metrics reload.

### Notes
- Auto-clustering still triggers automatically on initial load (when keywords lack cluster_label) and on add/edit/delete of keywords. The manual buttons are belt-and-suspenders fallbacks for the rare case auto-cluster doesn't kick in.

## [1.1.19] — 2026-05-13

Bust the Next.js full-route cache after a delete attempt — ghost projects disappear.

### Root cause confirmed
v1.1.18's diagnostic surfaced "No project matched that ID" — meaning the DELETE SQL ran against a project that was no longer in the database. The list was showing a **ghost row** rendered from Next.js's full-route cache for `/` (which `export const dynamic = "force-dynamic"` should disable but in practice can still hold stale HTML between sessions).

### Fixed
- **`DELETE /api/projects/[id]` now calls `revalidatePath("/")` and `revalidatePath("/projects/[id]")` on both success AND 0-rows paths.** The next page render under either path will refetch fresh from `listProjects` instead of serving the cached HTML.
- **Client treats 0-rows as soft-success.** If the SQL matched zero rows, the row is already gone — the user's intent is satisfied. ProjectCard closes the modal and hard-navigates to `/` exactly like the genuine-success path, so the user lands on an accurate list immediately instead of staring at a "ghost" error.

### Notes
- Combined v1.1.18 + v1.1.19: any future delete click ends with the projects list correctly reflecting what's in the database, regardless of whether the SQL actually deleted a row or the row was already gone.
- Real errors (5xx, network failures, FK violations on cascade columns) still surface in the modal with a meaningful message.

## [1.1.18] — 2026-05-13

Harden project delete so it actually deletes and the list re-renders without the row.

### Changed
- **`deleteProject` in `lib/db.ts`** now uses `DELETE … RETURNING id` and returns the count of affected rows (Promise<number> instead of void). Lets callers distinguish "deleted 1 row" from "matched 0 rows" — the previous void return swallowed that signal.
- **`DELETE /api/projects/[id]`** now wraps the call in try/catch, returns `{ok, deleted, error}`, and serves a 404 with an explicit error message if `deleted === 0` (i.e., the row was already gone or the ID didn't match anything). Any SQL exception surfaces with a real message to the client instead of disappearing into a silent 500.
- **`ProjectCard.doDelete`** parses the response and additionally rejects if `deleted === 0`. After a confirmed success it hard-navigates with `window.location.assign("/?ts=…")` instead of `router.refresh()` — forces a full server-side re-fetch with a cache-busting query param, defeating any client / edge cache that might be serving a stale projects list.

### Why
- User reported: trash icon clicked, modal opens, brand name typed, Delete button enables, click → modal closes → projects list re-renders with the project still showing, even after a manual page refresh.
- Two possible causes from the symptom: (1) the SQL matched 0 rows (silent ID mismatch) and the route still returned 200, or (2) something downstream of the SQL was caching the projects list. The diagnostics + hard navigation cover both.

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
