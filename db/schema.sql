-- AIO Coverage Tracker schema
-- Vercel Postgres compatible (standard Postgres 15+).
-- Each on-demand "refresh" creates one snapshot row + per-keyword serp_result rows.
-- All metrics are derived at read time from these immutable snapshots.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------
-- projects: one tracked client brand
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_url   TEXT NOT NULL,            -- e.g. https://acme.com
  client_domain TEXT NOT NULL,           -- normalized: acme.com
  brand_name   TEXT NOT NULL,            -- "Acme" — used for mention detection
  brand_aliases TEXT[] DEFAULT '{}',     -- ["Acme Inc", "Acme Corp"]
  segment_l1   TEXT,                     -- e.g. "Finance"
  segment_l2   TEXT,                     -- e.g. "Lending"
  segment_l3   TEXT,                     -- e.g. "Home loans / Mortgages"
  country      TEXT NOT NULL DEFAULT 'us',     -- legacy single-region field, kept for back-compat
  regions      TEXT[] NOT NULL DEFAULT ARRAY['us'],
  language     TEXT NOT NULL DEFAULT 'en',
  device       TEXT NOT NULL DEFAULT 'desktop',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent column-adds for incremental upgrades (older deployments).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS segment_l1 TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS segment_l2 TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS segment_l3 TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS regions TEXT[] NOT NULL DEFAULT ARRAY['us'];
ALTER TABLE projects ADD COLUMN IF NOT EXISTS primary_product TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS custom_seed_keywords TEXT[];
ALTER TABLE projects ADD COLUMN IF NOT EXISTS detection_confidence TEXT;
-- Pending competitor suggestions from smart detection. Array of {name, domain}.
-- Drains as the user clicks Add (moves to competitors table) or Dismiss.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS suggested_competitors JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ----------------------------------------------------------------
-- competitors: brands the user wants to compare against
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS competitors (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url          TEXT NOT NULL,
  domain       TEXT NOT NULL,
  brand_name   TEXT NOT NULL,
  brand_aliases TEXT[] DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_competitors_project ON competitors(project_id);

-- ----------------------------------------------------------------
-- keywords: the universe being tracked
-- source distinguishes how the keyword entered the universe.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS keywords (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  keyword       TEXT NOT NULL,
  source        TEXT NOT NULL CHECK (source IN ('organic','market','manual','seed')),
  monthly_volume INTEGER,                 -- optional, user-supplied search volume
  added_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, keyword)
);

ALTER TABLE keywords ADD COLUMN IF NOT EXISTS monthly_volume INTEGER;
-- Topical cluster label, set by LLM clustering. NULL until the user clusters.
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS cluster_label TEXT;

CREATE INDEX IF NOT EXISTS idx_keywords_project ON keywords(project_id);
CREATE INDEX IF NOT EXISTS idx_keywords_cluster ON keywords(project_id, cluster_label);

-- ----------------------------------------------------------------
-- snapshots: one per refresh click. Aggregate row.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ran_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  keywords_count  INTEGER NOT NULL DEFAULT 0,
  aios_triggered  INTEGER NOT NULL DEFAULT 0,  -- # of keywords whose SERP had an AIO
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','complete','failed')),
  error           TEXT,
  notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_snapshots_project_time ON snapshots(project_id, ran_at DESC);

-- ----------------------------------------------------------------
-- serp_results: per (snapshot, keyword) AIO record
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS serp_results (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id   UUID NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  keyword       TEXT NOT NULL,
  country       TEXT NOT NULL DEFAULT 'us',
  has_aio       BOOLEAN NOT NULL DEFAULT FALSE,
  aio_text      TEXT,                       -- the AIO answer body (may be null if not extractable)
  raw           JSONB                       -- trimmed SerpAPI payload for debugging
);

ALTER TABLE serp_results ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'us';

CREATE INDEX IF NOT EXISTS idx_serp_snapshot ON serp_results(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_serp_project_kw ON serp_results(project_id, keyword);
CREATE INDEX IF NOT EXISTS idx_serp_country ON serp_results(snapshot_id, country);

-- ----------------------------------------------------------------
-- citations: each citation slot inside an AIO
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS citations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  serp_result_id UUID NOT NULL REFERENCES serp_results(id) ON DELETE CASCADE,
  snapshot_id   UUID NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,           -- 1-based slot in the AIO source list
  url           TEXT NOT NULL,
  domain        TEXT NOT NULL,              -- normalized
  title         TEXT,
  source_type   TEXT                         -- wikipedia | reddit | news | industry | other
);

CREATE INDEX IF NOT EXISTS idx_citations_snapshot ON citations(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_citations_domain ON citations(project_id, domain);

-- ----------------------------------------------------------------
-- mentions: each detected brand-name occurrence inside AIO answer text
-- (cited brands are also recorded here with kind='cited' for unified queries)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mentions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  serp_result_id UUID NOT NULL REFERENCES serp_results(id) ON DELETE CASCADE,
  snapshot_id   UUID NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  brand_name    TEXT NOT NULL,
  brand_kind    TEXT NOT NULL CHECK (brand_kind IN ('client','competitor')),
  kind          TEXT NOT NULL CHECK (kind IN ('cited','mentioned','both'))
);

CREATE INDEX IF NOT EXISTS idx_mentions_snapshot ON mentions(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_mentions_project_brand ON mentions(project_id, brand_name);
