import { randomUUID } from "node:crypto";
import Papa from "papaparse";
import { getConfigValue } from "./config";
import { all, get, jsonParse, run } from "./db";
import { getProject } from "./seo";

const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

type GscConnection = {
  id: string;
  project_id: string;
  site_url: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  account_email: string;
};

type GscImportRecord = {
  id: string;
  project_id: string;
  site_url: string;
  source_name: string;
  dimensions_json: string;
  row_count: number;
  totals_json: string;
  rows_json: string;
  created_at: string;
};

type ImportedGscPerformanceRow = {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

const DIMENSION_ALIASES: Record<string, string[]> = {
  query: ["query", "queries", "top query", "top queries", "keyword", "keywords"],
  page: ["page", "pages", "top page", "top pages", "url", "landing page", "landing pages"],
  country: ["country", "countries"],
  device: ["device", "devices"],
  date: ["date", "day"],
};

const DIMENSION_ORDER = ["query", "page", "country", "device", "date"];
const METRIC_ALIASES = {
  clicks: ["clicks"],
  impressions: ["impressions"],
  ctr: ["ctr", "click through rate", "click-through rate"],
  position: ["position", "avg position", "average position"],
};

function googleClientConfig() {
  return {
    clientId: getConfigValue("google_client_id"),
    clientSecret: getConfigValue("google_client_secret"),
  };
}

function redirectUri(baseUrl: string, siteId: string) {
  return `${baseUrl.replace(/\/$/, "")}/api/gsc/callback?siteId=${encodeURIComponent(siteId)}`;
}

export function gscStatus(siteId: string) {
  const connection = get<GscConnection>("SELECT * FROM gsc_connections WHERE project_id = ?", [
    siteId,
  ]);
  const config = googleClientConfig();
  return {
    configured: Boolean(config.clientId && config.clientSecret),
    connected: Boolean(connection?.refresh_token || connection?.access_token),
    connection: connection
      ? {
          siteId,
          siteUrl: connection.site_url,
          accountEmail: connection.account_email,
          expiresAt: connection.expires_at,
        }
      : null,
  };
}

export function createGscAuthUrl(siteId: string, baseUrl: string) {
  const config = googleClientConfig();
  if (!config.clientId || !config.clientSecret) {
    throw new Error("Google client id and secret are required.");
  }
  const state = Buffer.from(JSON.stringify({ siteId, nonce: randomUUID() })).toString("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri(baseUrl, siteId));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GSC_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function handleGscCallback(input: {
  siteId: string;
  code: string;
  baseUrl: string;
}) {
  const config = googleClientConfig();
  if (!config.clientId || !config.clientSecret) {
    throw new Error("Google client id and secret are required.");
  }
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri(input.baseUrl, input.siteId),
      grant_type: "authorization_code",
    }),
  });
  const token = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Google OAuth failed: ${JSON.stringify(token).slice(0, 300)}`);
  }
  saveGscConnection({
    siteId: input.siteId,
    accessToken: String(token.access_token || ""),
    refreshToken: String(token.refresh_token || ""),
    expiresIn: Number(token.expires_in || 3600),
  });
  return gscStatus(input.siteId);
}

function saveGscConnection(input: {
  siteId: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}) {
  const existing = get<GscConnection>("SELECT * FROM gsc_connections WHERE project_id = ?", [
    input.siteId,
  ]);
  const refreshToken = input.refreshToken || existing?.refresh_token || "";
  run(
    `
    INSERT INTO gsc_connections
      (id, project_id, access_token, refresh_token, expires_at, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(project_id) DO UPDATE SET
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expires_at = excluded.expires_at,
      updated_at = CURRENT_TIMESTAMP
    `,
    [
      existing?.id || randomUUID(),
      input.siteId,
      input.accessToken,
      refreshToken,
      Date.now() + input.expiresIn * 1000,
    ],
  );
}

async function getAccessToken(siteId: string) {
  const connection = get<GscConnection>("SELECT * FROM gsc_connections WHERE project_id = ?", [
    siteId,
  ]);
  if (!connection) throw new Error("Google Search Console is not connected.");
  if (connection.access_token && connection.expires_at > Date.now() + 60_000) {
    return connection.access_token;
  }
  if (!connection.refresh_token) throw new Error("Missing Google refresh token.");
  const config = googleClientConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: connection.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const token = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Google token refresh failed: ${JSON.stringify(token).slice(0, 300)}`);
  }
  saveGscConnection({
    siteId,
    accessToken: String(token.access_token || ""),
    refreshToken: connection.refresh_token,
    expiresIn: Number(token.expires_in || 3600),
  });
  return String(token.access_token || "");
}

export async function listGscSites(siteId: string) {
  const accessToken = await getAccessToken(siteId);
  const response = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`GSC sites failed: ${JSON.stringify(data).slice(0, 300)}`);
  return data.siteEntry || [];
}

export function setGscSite(siteId: string, siteUrl: string) {
  run(
    "UPDATE gsc_connections SET site_url = ?, updated_at = CURRENT_TIMESTAMP WHERE project_id = ?",
    [siteUrl, siteId],
  );
  return gscStatus(siteId);
}

export async function queryGscPerformance(input: {
  siteId?: string;
  projectId?: string;
  siteUrl?: string;
  startDate: string;
  endDate: string;
  dimensions?: string[];
  rowLimit?: number;
}) {
  const siteId = String(input.siteId || input.projectId || "");
  if (!siteId) throw new Error("Site id is required.");
  const connection = get<GscConnection>("SELECT * FROM gsc_connections WHERE project_id = ?", [
    siteId,
  ]);
  const siteUrl = input.siteUrl || connection?.site_url;
  if (!siteUrl) throw new Error("Choose a Search Console property first.");
  const accessToken = await getAccessToken(siteId);
  const response = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate: input.startDate,
        endDate: input.endDate,
        dimensions: input.dimensions || ["query"],
        rowLimit: input.rowLimit || 100,
      }),
    },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`GSC performance failed: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function findValue(row: Record<string, unknown>, aliases: string[]) {
  const entries = Object.entries(row);
  for (const alias of aliases) {
    const target = normalizeHeader(alias);
    const match = entries.find(([key]) => normalizeHeader(key) === target);
    if (match && match[1] !== null && match[1] !== undefined) {
      return String(match[1]).trim();
    }
  }
  return "";
}

function parseMetricNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  let raw = String(value ?? "").trim();
  if (!raw || raw === "-") return 0;
  raw = raw.replace(/\s+/g, "").replace(/%$/, "");
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw) || /^-?\d+,\d+$/.test(raw)) {
    raw = raw.replace(/\./g, "").replace(",", ".");
  } else {
    raw = raw.replace(/,/g, "");
  }
  const number = Number(raw);
  return Number.isFinite(number) ? number : 0;
}

function parseCtr(value: unknown) {
  const raw = String(value ?? "").trim();
  const number = parseMetricNumber(value);
  if (!Number.isFinite(number)) return 0;
  return raw.includes("%") || number > 1 ? number / 100 : number;
}

function canonicalDimension(value: string) {
  const normalized = normalizeHeader(value);
  return DIMENSION_ORDER.find((dimension) =>
    [dimension, ...(DIMENSION_ALIASES[dimension] || [])].some(
      (alias) => normalizeHeader(alias) === normalized,
    ),
  );
}

function inferGscDimensions(rows: Record<string, unknown>[]) {
  const sample = rows[0] || {};
  if (Array.isArray((sample as { keys?: unknown }).keys)) return ["query"];
  const headers = new Set(Object.keys(sample).map(normalizeHeader));
  const dimensions = DIMENSION_ORDER.filter((dimension) =>
    DIMENSION_ALIASES[dimension].some((alias) => headers.has(normalizeHeader(alias))),
  );
  return dimensions.length ? dimensions : ["query"];
}

function normalizeGscDimensions(
  dimensions: string[] | string | undefined,
  rows: Record<string, unknown>[],
) {
  const raw = Array.isArray(dimensions)
    ? dimensions
    : String(dimensions || "")
        .split(/[,|]/)
        .map((item) => item.trim())
        .filter(Boolean);
  const canonical = raw.map(canonicalDimension).filter(Boolean) as string[];
  return canonical.length ? [...new Set(canonical)] : inferGscDimensions(rows);
}

function normalizeGscImportRow(
  row: Record<string, unknown>,
  dimensions: string[],
): ImportedGscPerformanceRow {
  const keys = Array.isArray((row as { keys?: unknown[] }).keys)
    ? ((row as { keys: unknown[] }).keys || []).map((key) => String(key || "").trim())
    : dimensions.map((dimension) => findValue(row, DIMENSION_ALIASES[dimension] || [dimension]));
  return {
    keys,
    clicks: parseMetricNumber((row as { clicks?: unknown }).clicks ?? findValue(row, METRIC_ALIASES.clicks)),
    impressions: parseMetricNumber(
      (row as { impressions?: unknown }).impressions ?? findValue(row, METRIC_ALIASES.impressions),
    ),
    ctr: parseCtr((row as { ctr?: unknown }).ctr ?? findValue(row, METRIC_ALIASES.ctr)),
    position: parseMetricNumber(
      (row as { position?: unknown }).position ?? findValue(row, METRIC_ALIASES.position),
    ),
  };
}

function rowHasGscEvidence(row: ImportedGscPerformanceRow) {
  return (
    row.keys.some(Boolean) ||
    row.clicks > 0 ||
    row.impressions > 0 ||
    row.ctr > 0 ||
    row.position > 0
  );
}

function computeGscTotals(rows: ImportedGscPerformanceRow[]) {
  const totals = rows.reduce(
    (acc, row) => {
      acc.clicks += row.clicks;
      acc.impressions += row.impressions;
      acc.weightedPosition += row.position * row.impressions;
      if (row.position > 0) {
        acc.positionCount += 1;
        acc.positionSum += row.position;
      }
      return acc;
    },
    { clicks: 0, impressions: 0, weightedPosition: 0, positionCount: 0, positionSum: 0 },
  );
  const ctr = totals.impressions ? totals.clicks / totals.impressions : 0;
  const position = totals.impressions
    ? totals.weightedPosition / totals.impressions
    : totals.positionCount
      ? totals.positionSum / totals.positionCount
      : 0;
  return {
    clicks: Math.round(totals.clicks),
    impressions: Math.round(totals.impressions),
    ctr,
    position,
  };
}

function parseGscCsv(csv: string) {
  const parsed = Papa.parse<Record<string, unknown>>(csv, {
    header: true,
    skipEmptyLines: true,
  });
  return parsed.data.filter((row) => Object.values(row).some((value) => String(value ?? "").trim()));
}

function mapGscImport(row: GscImportRecord) {
  return {
    id: row.id,
    siteId: row.project_id,
    siteUrl: row.site_url,
    sourceName: row.source_name,
    dimensions: jsonParse<string[]>(row.dimensions_json, []),
    rowCount: row.row_count,
    totals: jsonParse<Record<string, number>>(row.totals_json, {}),
    rows: jsonParse<ImportedGscPerformanceRow[]>(row.rows_json, []),
    createdAt: row.created_at,
  };
}

export function listGscImports(siteId: string) {
  return all<GscImportRecord>(
    "SELECT * FROM gsc_imports WHERE project_id = ? ORDER BY created_at DESC",
    [siteId],
  ).map(mapGscImport);
}

export function importGscPerformance(input: {
  siteId?: string;
  projectId?: string;
  siteUrl?: string;
  sourceName?: string;
  dimensions?: string[] | string;
  csv?: string;
  rows?: Record<string, unknown>[];
}) {
  const siteId = String(input.siteId || input.projectId || "");
  if (!siteId) throw new Error("Site id is required.");
  const project = getProject(siteId);
  if (!project) throw new Error("Site not found.");
  const rawRows = input.csv ? parseGscCsv(input.csv) : input.rows || [];
  if (!rawRows.length) {
    throw new Error("Import file has no Search Console rows.");
  }
  const dimensions = normalizeGscDimensions(input.dimensions, rawRows);
  const rows = rawRows
    .map((row) => normalizeGscImportRow(row, dimensions))
    .filter(rowHasGscEvidence);
  if (!rows.length) {
    throw new Error("Import must include Search Console columns such as query/page, clicks, impressions, CTR, and position.");
  }
  const id = randomUUID();
  const sourceName = String(input.sourceName || "Search Console CSV").trim().slice(0, 180);
  const siteUrl = String(input.siteUrl || project.domain || "").trim();
  const totals = computeGscTotals(rows);
  run(
    `
    INSERT INTO gsc_imports
      (id, project_id, site_url, source_name, dimensions_json, row_count, totals_json, rows_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      id,
      project.id,
      siteUrl,
      sourceName,
      JSON.stringify(dimensions),
      rows.length,
      JSON.stringify(totals),
      JSON.stringify(rows),
    ],
  );
  const record = get<GscImportRecord>("SELECT * FROM gsc_imports WHERE id = ?", [id]);
  if (!record) throw new Error("Failed to save Search Console import.");
  return mapGscImport(record);
}

export async function getGscPerformance(input: {
  projectId?: string;
  siteId?: string;
  siteUrl?: string;
  startDate?: string;
  endDate?: string;
  dimensions?: string[];
  rowLimit?: number;
}) {
  const siteId = String(input.siteId || input.projectId || "");
  if (!siteId) throw new Error("Site id is required.");
  const status = gscStatus(siteId);
  if (status.connected && (input.siteUrl || status.connection?.siteUrl)) {
    return {
      source: "google_search_console",
      ...(await queryGscPerformance({
        siteId,
        siteUrl: input.siteUrl,
        startDate: String(input.startDate || ""),
        endDate: String(input.endDate || ""),
        dimensions: input.dimensions,
        rowLimit: input.rowLimit,
      })),
    };
  }
  const latest = listGscImports(siteId)[0];
  if (latest) {
    return {
      source: "local_gsc_import",
      siteUrl: latest.siteUrl,
      dimensions: latest.dimensions,
      totals: latest.totals,
      rows: latest.rows,
      importedAt: latest.createdAt,
      sourceName: latest.sourceName,
    };
  }
  throw new Error("No Search Console data yet. Connect Google or import a Search Console CSV.");
}

export function listGscConnections() {
  return all<GscConnection>("SELECT * FROM gsc_connections ORDER BY updated_at DESC").map(
    (row) => ({
      siteId: row.project_id,
      siteUrl: row.site_url,
      connected: Boolean(row.refresh_token || row.access_token),
      expiresAt: row.expires_at,
    }),
  );
}

export function disconnectGsc(siteId: string) {
  run("DELETE FROM gsc_connections WHERE project_id = ?", [siteId]);
  return { connected: false };
}

export async function inspectGscUrls(input: {
  siteId?: string;
  projectId?: string;
  urls: string[] | string;
  siteUrl?: string;
}) {
  const siteId = String(input.siteId || input.projectId || "");
  if (!siteId) throw new Error("Site id is required.");
  const connection = get<GscConnection>("SELECT * FROM gsc_connections WHERE project_id = ?", [
    siteId,
  ]);
  const siteUrl = input.siteUrl || connection?.site_url;
  if (!siteUrl) throw new Error("Choose a Search Console property first.");
  const urls = Array.isArray(input.urls)
    ? input.urls
    : String(input.urls || "")
        .split(/\n|,/)
        .map((url) => url.trim())
        .filter(Boolean);
  const accessToken = await getAccessToken(siteId);
  const rows = [];
  for (const inspectionUrl of urls.slice(0, 20)) {
    const response = await fetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inspectionUrl, siteUrl }),
    });
    const data = await response.json().catch(() => ({}));
    rows.push(
      response.ok
        ? { inspectionUrl, result: data.inspectionResult || data }
        : { inspectionUrl, error: data.error?.message || `HTTP ${response.status}` },
    );
  }
  return { siteUrl, rows };
}
