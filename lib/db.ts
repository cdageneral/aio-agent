/**
 * Thin DB wrapper around @vercel/postgres. Centralizes all the SQL.
 * Server-only.
 */
import "server-only";
import { sql } from "@vercel/postgres";

export type SuggestedCompetitor = { name: string; domain: string };

export type Project = {
  id: string;
  client_url: string;
  client_domain: string;
  brand_name: string;
  brand_aliases: string[];
  segment_l1: string | null;
  segment_l2: string | null;
  segment_l3: string | null;
  primary_product: string | null;
  custom_seed_keywords: string[] | null;
  detection_confidence: string | null;
  suggested_competitors: SuggestedCompetitor[];
  country: string;            // legacy
  regions: string[];          // ['us'] | ['ca'] | ['us','ca']
  language: string;
  device: string;
  created_at: string;
};

export type Competitor = {
  id: string;
  project_id: string;
  url: string;
  domain: string;
  brand_name: string;
  brand_aliases: string[];
};

export type Keyword = {
  id: string;
  project_id: string;
  keyword: string;
  source: "organic" | "market" | "manual" | "seed";
  monthly_volume: number | null;
  cluster_label: string | null;
  added_at: string;
};

export type Snapshot = {
  id: string;
  project_id: string;
  ran_at: string;
  keywords_count: number;
  aios_triggered: number;
  status: "pending" | "running" | "complete" | "failed";
  error: string | null;
};

// -------- Projects --------
export async function createProject(input: {
  client_url: string;
  client_domain: string;
  brand_name: string;
  brand_aliases?: string[];
  segment_l1?: string | null;
  segment_l2?: string | null;
  segment_l3?: string | null;
  primary_product?: string | null;
  custom_seed_keywords?: string[] | null;
  detection_confidence?: string | null;
  suggested_competitors?: SuggestedCompetitor[];
  regions?: string[];
}): Promise<Project> {
  // brand_aliases is a text[] — pass it through sql.query to get proper PG array binding.
  const regions = input.regions && input.regions.length > 0 ? input.regions : ["us"];
  const { rows } = await sql.query<Project>(
    `INSERT INTO projects (client_url, client_domain, brand_name, brand_aliases,
                           segment_l1, segment_l2, segment_l3,
                           primary_product, custom_seed_keywords, detection_confidence,
                           suggested_competitors,
                           regions)
     VALUES ($1, $2, $3, $4::text[],
             $5, $6, $7,
             $8, $9::text[], $10,
             $11::jsonb,
             $12::text[])
     RETURNING *;`,
    [
      input.client_url,
      input.client_domain,
      input.brand_name,
      input.brand_aliases ?? [],
      input.segment_l1 ?? null,
      input.segment_l2 ?? null,
      input.segment_l3 ?? null,
      input.primary_product ?? null,
      input.custom_seed_keywords ?? null,
      input.detection_confidence ?? null,
      JSON.stringify(input.suggested_competitors ?? []),
      regions,
    ],
  );
  return rows[0];
}

export async function updateProject(
  id: string,
  patch: {
    client_url?: string;
    client_domain?: string;
    brand_name?: string;
    brand_aliases?: string[];
    segment_l1?: string | null;
    segment_l2?: string | null;
    segment_l3?: string | null;
    primary_product?: string | null;
    custom_seed_keywords?: string[] | null;
    detection_confidence?: string | null;
    suggested_competitors?: SuggestedCompetitor[];
    regions?: string[];
  },
): Promise<Project | null> {
  // Build dynamic SET clause for whichever keys are present.
  const sets: string[] = [];
  const vals: any[] = [];
  let i = 1;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (k === "brand_aliases" || k === "regions" || k === "custom_seed_keywords") {
      sets.push(`${k} = $${i}::text[]`);
      vals.push(v);
    } else if (k === "suggested_competitors") {
      sets.push(`${k} = $${i}::jsonb`);
      vals.push(JSON.stringify(v));
    } else {
      sets.push(`${k} = $${i}`);
      vals.push(v);
    }
    i++;
  }
  if (sets.length === 0) return getProject(id);
  vals.push(id);
  const { rows } = await sql.query<Project>(
    `UPDATE projects SET ${sets.join(", ")} WHERE id = $${i} RETURNING *;`,
    vals,
  );
  return rows[0] ?? null;
}

export async function listProjects(): Promise<Project[]> {
  const { rows } = await sql<Project>`SELECT * FROM projects ORDER BY created_at DESC;`;
  return rows;
}

export async function getProject(id: string): Promise<Project | null> {
  const { rows } = await sql<Project>`SELECT * FROM projects WHERE id = ${id};`;
  return rows[0] ?? null;
}

export async function deleteProject(id: string): Promise<void> {
  await sql`DELETE FROM projects WHERE id = ${id};`;
}

// -------- Competitors --------
export async function addCompetitor(input: {
  project_id: string;
  url: string;
  domain: string;
  brand_name: string;
  brand_aliases?: string[];
}): Promise<Competitor> {
  const { rows } = await sql.query<Competitor>(
    `INSERT INTO competitors (project_id, url, domain, brand_name, brand_aliases)
     VALUES ($1, $2, $3, $4, $5::text[])
     ON CONFLICT (project_id, domain) DO UPDATE SET brand_name = EXCLUDED.brand_name
     RETURNING *;`,
    [input.project_id, input.url, input.domain, input.brand_name, input.brand_aliases ?? []],
  );
  return rows[0];
}

export async function listCompetitors(project_id: string): Promise<Competitor[]> {
  const { rows } = await sql<Competitor>`SELECT * FROM competitors WHERE project_id = ${project_id} ORDER BY created_at;`;
  return rows;
}

export async function deleteCompetitor(id: string): Promise<void> {
  await sql`DELETE FROM competitors WHERE id = ${id};`;
}

// -------- Keywords --------
export async function addKeywords(
  project_id: string,
  items: { keyword: string; source: Keyword["source"] }[],
): Promise<number> {
  if (items.length === 0) return 0;
  // Bulk insert with ON CONFLICT DO NOTHING.
  const values = items.map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3})`).join(", ");
  const params: any[] = [project_id];
  for (const it of items) params.push(it.keyword.trim(), it.source);
  const { rowCount } = await sql.query(
    `INSERT INTO keywords (project_id, keyword, source) VALUES ${values}
     ON CONFLICT (project_id, keyword) DO NOTHING;`,
    params,
  );
  return rowCount ?? 0;
}

export async function listKeywords(project_id: string): Promise<Keyword[]> {
  const { rows } = await sql<Keyword>`SELECT * FROM keywords WHERE project_id = ${project_id} ORDER BY added_at;`;
  return rows;
}

export async function deleteKeyword(id: string): Promise<void> {
  await sql`DELETE FROM keywords WHERE id = ${id};`;
}

export async function countKeywords(project_id: string): Promise<number> {
  const { rows } = await sql<{ c: number }>`SELECT COUNT(*)::int AS c FROM keywords WHERE project_id = ${project_id};`;
  return rows[0]?.c ?? 0;
}

// -------- Snapshots --------
export async function createSnapshot(project_id: string, keywords_count: number): Promise<Snapshot> {
  const { rows } = await sql<Snapshot>`
    INSERT INTO snapshots (project_id, keywords_count, status)
    VALUES (${project_id}, ${keywords_count}, 'running')
    RETURNING *;
  `;
  return rows[0];
}

export async function finalizeSnapshot(id: string, aios_triggered: number, status: "complete" | "failed", error?: string) {
  await sql`UPDATE snapshots SET aios_triggered = ${aios_triggered}, status = ${status}, error = ${error ?? null} WHERE id = ${id};`;
}

export async function listSnapshots(project_id: string): Promise<Snapshot[]> {
  const { rows } = await sql<Snapshot>`
    SELECT * FROM snapshots WHERE project_id = ${project_id} ORDER BY ran_at ASC;`;
  return rows;
}

export async function latestSnapshot(project_id: string): Promise<Snapshot | null> {
  const { rows } = await sql<Snapshot>`
    SELECT * FROM snapshots WHERE project_id = ${project_id} AND status = 'complete' ORDER BY ran_at DESC LIMIT 1;`;
  return rows[0] ?? null;
}

// -------- SERP results + citations + mentions --------
export async function saveSerpResult(input: {
  snapshot_id: string;
  project_id: string;
  keyword: string;
  country: string;
  has_aio: boolean;
  aio_text: string | null;
  raw?: unknown;
}): Promise<string> {
  const { rows } = await sql<{ id: string }>`
    INSERT INTO serp_results (snapshot_id, project_id, keyword, country, has_aio, aio_text, raw)
    VALUES (${input.snapshot_id}, ${input.project_id}, ${input.keyword}, ${input.country}, ${input.has_aio}, ${input.aio_text}, ${input.raw ? JSON.stringify(input.raw) : null}::jsonb)
    RETURNING id;
  `;
  return rows[0].id;
}

export async function saveCitations(rows: {
  serp_result_id: string;
  snapshot_id: string;
  project_id: string;
  position: number;
  url: string;
  domain: string;
  title?: string | null;
  source_type?: string | null;
}[]) {
  if (rows.length === 0) return;
  const values = rows.map(
    (_, i) =>
      `($${i * 8 + 1}, $${i * 8 + 2}, $${i * 8 + 3}, $${i * 8 + 4}, $${i * 8 + 5}, $${i * 8 + 6}, $${i * 8 + 7}, $${i * 8 + 8})`,
  ).join(", ");
  const params: any[] = [];
  for (const r of rows) {
    params.push(r.serp_result_id, r.snapshot_id, r.project_id, r.position, r.url, r.domain, r.title ?? null, r.source_type ?? null);
  }
  await sql.query(
    `INSERT INTO citations (serp_result_id, snapshot_id, project_id, position, url, domain, title, source_type) VALUES ${values};`,
    params,
  );
}

export async function saveMentions(rows: {
  serp_result_id: string;
  snapshot_id: string;
  project_id: string;
  brand_name: string;
  brand_kind: "client" | "competitor";
  kind: "cited" | "mentioned" | "both";
}[]) {
  if (rows.length === 0) return;
  const values = rows.map(
    (_, i) =>
      `($${i * 6 + 1}, $${i * 6 + 2}, $${i * 6 + 3}, $${i * 6 + 4}, $${i * 6 + 5}, $${i * 6 + 6})`,
  ).join(", ");
  const params: any[] = [];
  for (const r of rows) {
    params.push(r.serp_result_id, r.snapshot_id, r.project_id, r.brand_name, r.brand_kind, r.kind);
  }
  await sql.query(
    `INSERT INTO mentions (serp_result_id, snapshot_id, project_id, brand_name, brand_kind, kind) VALUES ${values};`,
    params,
  );
}

export async function loadSnapshotDetail(snapshot_id: string) {
  const { rows: serps } = await sql<{
    id: string; keyword: string; country: string; has_aio: boolean; aio_text: string | null; source: string | null; monthly_volume: number | null; cluster_label: string | null;
  }>`
    SELECT sr.id, sr.keyword, sr.country, sr.has_aio, sr.aio_text, k.source, k.monthly_volume, k.cluster_label
    FROM serp_results sr
    LEFT JOIN keywords k ON k.project_id = sr.project_id AND k.keyword = sr.keyword
    WHERE sr.snapshot_id = ${snapshot_id};`;

  const { rows: cites } = await sql<{
    serp_result_id: string; position: number; domain: string; url: string; title: string | null;
  }>`
    SELECT serp_result_id, position, domain, url, title
    FROM citations
    WHERE snapshot_id = ${snapshot_id}
    ORDER BY position ASC;`;

  return { serps, cites };
}
