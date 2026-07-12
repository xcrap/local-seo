import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";
import { DEFAULT_KEYWORD_LANGUAGE_CODE, DEFAULT_KEYWORD_LOCATION_CODE } from "./defaults";

const runtimeDbPath = process.env.DB_PATH;

dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

if (runtimeDbPath) {
  process.env.DB_PATH = runtimeDbPath;
}

const DB_FILE_NAME = "local-seo.sqlite";
const DB_DIR = process.env.DB_PATH?.trim() || "./database";
export const dbPath = resolve(DB_DIR, DB_FILE_NAME);

if (!existsSync(DB_DIR)) {
  mkdirSync(DB_DIR, { recursive: true });
}

export const db = new Database(dbPath);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
// Background scans write progress while HTTP handlers write imports, config,
// and sessions. Without a busy timeout, any lock overlap fails immediately with
// SQLITE_BUSY; wait briefly for the current writer to finish instead.
db.exec("PRAGMA busy_timeout = 5000");

db.exec(`
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

  CREATE TABLE IF NOT EXISTS sites (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    domain TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    location_code INTEGER NOT NULL DEFAULT ${DEFAULT_KEYWORD_LOCATION_CODE},
    language_code TEXT NOT NULL DEFAULT '${DEFAULT_KEYWORD_LANGUAGE_CODE}',
    crawl_protocol TEXT NOT NULL DEFAULT 'auto',
    crawl_host TEXT NOT NULL DEFAULT 'auto',
    crawl_speed TEXT NOT NULL DEFAULT 'auto',
    crawl_max_pages INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_sites_created ON sites(created_at DESC);

  CREATE TABLE IF NOT EXISTS keyword_research_runs (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    query TEXT NOT NULL,
    location_code INTEGER NOT NULL,
    language_code TEXT NOT NULL,
    source TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS saved_keywords (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    keyword TEXT NOT NULL,
    location_code INTEGER NOT NULL DEFAULT ${DEFAULT_KEYWORD_LOCATION_CODE},
    language_code TEXT NOT NULL DEFAULT '${DEFAULT_KEYWORD_LANGUAGE_CODE}',
    search_volume INTEGER,
    difficulty INTEGER,
    cpc REAL,
    intent TEXT NOT NULL DEFAULT 'unknown',
    tags TEXT NOT NULL DEFAULT '[]',
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(site_id, keyword, location_code, language_code)
  );

  CREATE TABLE IF NOT EXISTS keyword_metric_imports (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    source_name TEXT NOT NULL DEFAULT '',
    row_count INTEGER NOT NULL DEFAULT 0,
    inserted_count INTEGER NOT NULL DEFAULT 0,
    updated_count INTEGER NOT NULL DEFAULT 0,
    rows_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_keyword_metric_imports_site_created ON keyword_metric_imports(site_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS rank_trackers (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    domain TEXT NOT NULL,
    location_code INTEGER NOT NULL DEFAULT ${DEFAULT_KEYWORD_LOCATION_CODE},
    language_code TEXT NOT NULL DEFAULT '${DEFAULT_KEYWORD_LANGUAGE_CODE}',
    device TEXT NOT NULL DEFAULT 'desktop',
    serp_depth INTEGER NOT NULL DEFAULT 50,
    schedule_interval TEXT NOT NULL DEFAULT 'manual',
    is_active INTEGER NOT NULL DEFAULT 1,
    next_check_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS rank_keywords (
    id TEXT PRIMARY KEY,
    tracker_id TEXT NOT NULL REFERENCES rank_trackers(id) ON DELETE CASCADE,
    keyword TEXT NOT NULL,
    search_volume INTEGER,
    keyword_difficulty INTEGER,
    cpc REAL,
    metrics_fetched_at TEXT,
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
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    domain TEXT NOT NULL,
    source TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS organic_imports (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    domain TEXT NOT NULL,
    source_name TEXT NOT NULL DEFAULT '',
    keyword_count INTEGER NOT NULL DEFAULT 0,
    page_count INTEGER NOT NULL DEFAULT 0,
    summary_json TEXT NOT NULL DEFAULT '{}',
    keywords_json TEXT NOT NULL DEFAULT '[]',
    pages_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_organic_imports_site_domain_created ON organic_imports(site_id, domain, created_at DESC);

  CREATE TABLE IF NOT EXISTS backlink_snapshots (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    domain TEXT NOT NULL,
    source TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS backlink_imports (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    domain TEXT NOT NULL,
    source_name TEXT NOT NULL DEFAULT '',
    row_count INTEGER NOT NULL DEFAULT 0,
    summary_json TEXT NOT NULL DEFAULT '{}',
    rows_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_backlink_imports_site_domain_created ON backlink_imports(site_id, domain, created_at DESC);

  CREATE TABLE IF NOT EXISTS scans (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
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

  CREATE TABLE IF NOT EXISTS scan_issue_ignores (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    issue_type TEXT NOT NULL,
    url TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(site_id, issue_type, url)
  );

  CREATE TABLE IF NOT EXISTS gsc_connections (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    site_url TEXT NOT NULL DEFAULT '',
    access_token TEXT NOT NULL DEFAULT '',
    refresh_token TEXT NOT NULL DEFAULT '',
    expires_at INTEGER NOT NULL DEFAULT 0,
    account_email TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(site_id)
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

  CREATE TABLE IF NOT EXISTS serp_runs (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    keyword TEXT NOT NULL,
    domain TEXT NOT NULL DEFAULT '',
    location_code INTEGER NOT NULL DEFAULT ${DEFAULT_KEYWORD_LOCATION_CODE},
    language_code TEXT NOT NULL DEFAULT '${DEFAULT_KEYWORD_LANGUAGE_CODE}',
    source TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_serp_runs_site_created ON serp_runs(site_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS brand_lookup_runs (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    query TEXT NOT NULL,
    competitors TEXT NOT NULL DEFAULT '[]',
    source TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_brand_lookup_site_created ON brand_lookup_runs(site_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS prompt_explorer_runs (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    prompt TEXT NOT NULL,
    highlight_brand TEXT NOT NULL DEFAULT '',
    models TEXT NOT NULL DEFAULT '[]',
    source TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_prompt_explorer_site_created ON prompt_explorer_runs(site_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS saved_keyword_tags (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT 'slate',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(site_id, name)
  );

  CREATE INDEX IF NOT EXISTS idx_saved_keyword_tags_site ON saved_keyword_tags(site_id, name);

  CREATE TABLE IF NOT EXISTS gsc_imports (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    site_url TEXT NOT NULL DEFAULT '',
    source_name TEXT NOT NULL DEFAULT '',
    dimensions_json TEXT NOT NULL DEFAULT '[]',
    row_count INTEGER NOT NULL DEFAULT 0,
    totals_json TEXT NOT NULL DEFAULT '{}',
    rows_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_gsc_imports_site_created ON gsc_imports(site_id, created_at DESC);
`);

// Explicit migrations for databases created before these columns existed.
const siteColumns = new Set(
  (db.prepare("PRAGMA table_info(sites)").all() as { name: string }[]).map((column) => column.name),
);
if (!siteColumns.has("crawl_speed")) {
  db.exec("ALTER TABLE sites ADD COLUMN crawl_speed TEXT NOT NULL DEFAULT 'auto'");
}
if (!siteColumns.has("crawl_max_pages")) {
  db.exec("ALTER TABLE sites ADD COLUMN crawl_max_pages INTEGER NOT NULL DEFAULT 0");
}

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

// Scan and AI-job execution lives only in the running process. If the server
// restarts mid-run, those rows would stay 'running'/'queued' forever and the UI
// would poll them indefinitely — mark them failed on boot so they resolve.
export function recoverInterruptedJobs() {
  const scans = db
    .prepare(
      "UPDATE scans SET status = 'failed', error = CASE WHEN error = '' THEN 'Interrupted by a server restart before the scan finished.' ELSE error END, updated_at = CURRENT_TIMESTAMP WHERE status IN ('queued', 'running')",
    )
    .run();
  const jobs = db
    .prepare(
      "UPDATE ai_jobs SET status = 'failed', error = CASE WHEN error = '' THEN 'Interrupted by a server restart before the job finished.' ELSE error END, finished_at = CURRENT_TIMESTAMP WHERE status IN ('queued', 'running')",
    )
    .run();
  return { scans: scans.changes, jobs: jobs.changes };
}

if (import.meta.main) {
  console.log(`Database initialized at ${dbPath}`);
}
