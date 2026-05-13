# AIO Coverage Tracker

Track Google **AI Overview** coverage of a brand vs its competitors.

## What it does

- Define a **client brand** (URL + name + aliases) and add competitors.
- Build a **keyword universe** via four methods:
  - `manual` — paste or upload a CSV.
  - `organic` — seed keywords, expand via Google related searches, keep only the ones where the client's domain ranks top-100.
  - `market` — same idea, but keep keywords where *any* tracked brand ranks (fair head-to-head).
  - `seed` — seed → related search / PAA expansion, no rank filter.
- Click **Run refresh** to fetch SerpAPI results for every keyword. AI Overviews are detected, citations parsed (including the async `page_token` follow-up), and brand mentions extracted from AIO answer text.
- Dashboard shows:
  - **AIOs triggered** — organic-footprint and market-wide.
  - **AIOs acquired**, **citation rate**, and **brand mention rate** for the client and each competitor.
  - **Historical growth chart** (one point per snapshot) and **growth rate** vs the previous snapshot.
  - **Other domains** in three tabs: Top-10, full long-tail (filterable by source type), and source-type buckets (Wikipedia / Reddit / News / Industry / Other).

## v1 scope

- Geo: **US**, Language: **English**, Device: **Desktop**.
- Universe ceiling: **500 keywords per refresh** (cost control — ~$25 / refresh at SerpAPI rates).
- Refresh: **on-demand only**. Each click writes an immutable snapshot row.

## Local setup

```bash
npm install
cp .env.example .env.local
# Fill in SERPAPI_KEY + POSTGRES_URL (e.g. from `vercel env pull`)
npm run db:init   # bootstraps the schema
npm run dev
```

Open <http://localhost:3000>.

## Environment variables

| Var | Required | Notes |
| --- | --- | --- |
| `SERPAPI_KEY` | yes | https://serpapi.com/manage-api-key |
| `ANTHROPIC_API_KEY` | yes | https://console.anthropic.com/settings/keys — powers smart segment detection |
| `POSTGRES_URL` | yes | Vercel Postgres connection string |
| `POSTGRES_URL_NON_POOLING` | optional | Set automatically by Vercel |
| `MAX_KEYWORDS_PER_REFRESH` | optional | Default 500 |
| `DEFAULT_GL` / `DEFAULT_HL` / `DEFAULT_DEVICE` | optional | Defaults `us`/`en`/`desktop` |

## Deploy to Vercel

1. Push this repo to GitHub.
2. In Vercel: **Add New → Project**, import the repo.
3. **Storage → Create → Postgres** → link to the project. Vercel injects `POSTGRES_URL` automatically.
4. Project Settings → **Environment Variables** → add `SERPAPI_KEY`.
5. Deploy.
6. Once deployed, initialize the schema:
   - Easiest path: pull env locally and run the script.
     ```bash
     vercel env pull .env.local
     npm run db:init
     ```
   - Or paste `db/schema.sql` into the Vercel Postgres SQL Editor.

## Cost notes

- One refresh ≈ `keywords × $0.0~ per query` on SerpAPI's plans. Default cap (500 kws) is ~$25 per refresh. The `organic` and `market` keyword discovery flows also burn SerpAPI calls — each rank check is one query.
- Discovery is one-time per universe; refresh is the recurring cost. Don't run `organic` / `market` discovery on every page load.

## Folder layout

```
app/
  api/projects/...        REST routes
  projects/new/page.tsx   new-project wizard
  projects/[id]/page.tsx  dashboard
components/               client components (Dashboard, panels, charts)
lib/
  serpapi.ts              SerpAPI client + AIO parsing (handles page_token)
  metrics.ts              pure metric calculators
  db.ts                   Vercel Postgres wrappers
  classify.ts             source-type bucketing for "Other domains"
  domain.ts               domain normalization
db/schema.sql             Postgres DDL
scripts/init-db.mjs       schema bootstrapper
```

## Roadmap (out of v1)

- Multi-country / mobile-desktop matrix.
- Scheduled refresh via Vercel Cron (`vercel.json`).
- SerpAPI Archive backfill for instant history.
- Citation-position metric and citation-share-of-voice charts.
- Multi-tenant auth (Supabase / Clerk) if this leaves single-user mode.
