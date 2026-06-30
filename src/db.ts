import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import dotenv from "dotenv";

const runtimeDbPath = process.env.DB_PATH;

dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

if (runtimeDbPath) {
  process.env.DB_PATH = runtimeDbPath;
}

const DB_PATH = process.env.DB_PATH || "./data/local-seo.sqlite";
const MIGRATIONS_TABLE = "schema_migrations";

if (!existsSync(dirname(DB_PATH))) {
  mkdirSync(dirname(DB_PATH), { recursive: true });
}

export const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

function migrate(name: string, sql: string) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  const existing = db
    .prepare(`SELECT name FROM ${MIGRATIONS_TABLE} WHERE name = ?`)
    .get(name);
  if (existing) return;

  const apply = db.transaction(() => {
    db.exec(sql);
    db.prepare(`INSERT INTO ${MIGRATIONS_TABLE} (name) VALUES (?)`).run(name);
  });
  apply();
}

migrate(
  "001_local_seo_init",
  `
  CREATE TABLE IF NOT EXISTS admin_users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    secret INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    domain TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    location_code INTEGER NOT NULL DEFAULT 2840,
    language_code TEXT NOT NULL DEFAULT 'en',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    archived_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_projects_active ON projects(archived_at, created_at DESC);

  CREATE TABLE IF NOT EXISTS keyword_research_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    query TEXT NOT NULL,
    location_code INTEGER NOT NULL,
    language_code TEXT NOT NULL,
    source TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS saved_keywords (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    keyword TEXT NOT NULL,
    location_code INTEGER NOT NULL DEFAULT 2840,
    language_code TEXT NOT NULL DEFAULT 'en',
    search_volume INTEGER,
    difficulty INTEGER,
    cpc REAL,
    intent TEXT NOT NULL DEFAULT 'unknown',
    tags TEXT NOT NULL DEFAULT '[]',
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, keyword, location_code, language_code)
  );

  CREATE TABLE IF NOT EXISTS rank_trackers (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    domain TEXT NOT NULL,
    location_code INTEGER NOT NULL DEFAULT 2840,
    language_code TEXT NOT NULL DEFAULT 'en',
    device TEXT NOT NULL DEFAULT 'desktop',
    serp_depth INTEGER NOT NULL DEFAULT 50,
    schedule_interval TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS rank_keywords (
    id TEXT PRIMARY KEY,
    tracker_id TEXT NOT NULL REFERENCES rank_trackers(id) ON DELETE CASCADE,
    keyword TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tracker_id, keyword)
  );

  CREATE TABLE IF NOT EXISTS rank_runs (
    id TEXT PRIMARY KEY,
    tracker_id TEXT NOT NULL REFERENCES rank_trackers(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TEXT
  );

  CREATE TABLE IF NOT EXISTS rank_snapshots (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES rank_runs(id) ON DELETE CASCADE,
    tracker_id TEXT NOT NULL REFERENCES rank_trackers(id) ON DELETE CASCADE,
    keyword_id TEXT REFERENCES rank_keywords(id) ON DELETE SET NULL,
    keyword TEXT NOT NULL,
    position INTEGER,
    url TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_rank_snapshots_tracker_keyword ON rank_snapshots(tracker_id, keyword, checked_at DESC);

  CREATE TABLE IF NOT EXISTS domain_snapshots (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    target TEXT NOT NULL,
    source TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS backlink_snapshots (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    target TEXT NOT NULL,
    source TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS audits (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    status TEXT NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    pages_crawled INTEGER NOT NULL DEFAULT 0,
    issue_count INTEGER NOT NULL DEFAULT 0,
    result_json TEXT,
    error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS gsc_connections (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    site_url TEXT NOT NULL DEFAULT '',
    access_token TEXT NOT NULL DEFAULT '',
    refresh_token TEXT NOT NULL DEFAULT '',
    expires_at INTEGER NOT NULL DEFAULT 0,
    account_email TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id)
  );

  CREATE TABLE IF NOT EXISTS ai_jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    prompt TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    result_text TEXT NOT NULL DEFAULT '',
    result_json TEXT,
    error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TEXT,
    finished_at TEXT
  );

  CREATE TABLE IF NOT EXISTS ai_prompts (
    key TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    template TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS cache_entries (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `,
);

migrate(
  "002_feature_depth",
  `
  CREATE TABLE IF NOT EXISTS serp_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    keyword TEXT NOT NULL,
    target TEXT NOT NULL DEFAULT '',
    location_code INTEGER NOT NULL DEFAULT 2840,
    language_code TEXT NOT NULL DEFAULT 'en',
    source TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_serp_runs_project_created ON serp_runs(project_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS brand_lookup_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    query TEXT NOT NULL,
    competitors TEXT NOT NULL DEFAULT '[]',
    source TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_brand_lookup_project_created ON brand_lookup_runs(project_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS prompt_explorer_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    prompt TEXT NOT NULL,
    highlight_brand TEXT NOT NULL DEFAULT '',
    models TEXT NOT NULL DEFAULT '[]',
    source TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_prompt_explorer_project_created ON prompt_explorer_runs(project_id, created_at DESC);
  `,
);

migrate(
  "003_openseo_local_parity",
  `
  CREATE TABLE IF NOT EXISTS saved_keyword_tags (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT 'slate',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, name)
  );

  CREATE INDEX IF NOT EXISTS idx_saved_keyword_tags_project ON saved_keyword_tags(project_id, name);

  ALTER TABLE rank_trackers ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE rank_trackers ADD COLUMN next_check_at TEXT;
  ALTER TABLE rank_keywords ADD COLUMN search_volume INTEGER;
  ALTER TABLE rank_keywords ADD COLUMN keyword_difficulty INTEGER;
  ALTER TABLE rank_keywords ADD COLUMN cpc REAL;
  ALTER TABLE rank_keywords ADD COLUMN metrics_fetched_at TEXT;
  `,
);

migrate(
  "004_project_crawl_preferences",
  `
  ALTER TABLE projects ADD COLUMN crawl_protocol TEXT NOT NULL DEFAULT 'auto';
  ALTER TABLE projects ADD COLUMN crawl_host TEXT NOT NULL DEFAULT 'auto';
  `,
);

migrate(
  "005_gsc_imports",
  `
  CREATE TABLE IF NOT EXISTS gsc_imports (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    site_url TEXT NOT NULL DEFAULT '',
    source_name TEXT NOT NULL DEFAULT '',
    dimensions_json TEXT NOT NULL DEFAULT '[]',
    row_count INTEGER NOT NULL DEFAULT 0,
    totals_json TEXT NOT NULL DEFAULT '{}',
    rows_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_gsc_imports_project_created ON gsc_imports(project_id, created_at DESC);
  `,
);

migrate(
  "006_remove_generated_fallback_snapshots",
  `
  DELETE FROM domain_snapshots WHERE source = 'local-fallback';
  DELETE FROM backlink_snapshots WHERE source = 'local-fallback';
  `,
);

migrate(
  "007_delete_archived_sites",
  `
  DELETE FROM projects WHERE archived_at IS NOT NULL;
  `,
);

export function all<T = Record<string, unknown>>(sql: string, params: any[] = []): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function get<T = Record<string, unknown>>(sql: string, params: any[] = []): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, params: any[] = []) {
  return db.prepare(sql).run(...params);
}

export function nowIso() {
  return new Date().toISOString();
}

export function jsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

if (import.meta.main) {
  console.log(`Database initialized at ${DB_PATH}`);
}
