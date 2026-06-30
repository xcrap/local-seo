import { randomUUID } from "node:crypto";
import { getConfigValue } from "./config";
import { all, get, run } from "./db";

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

function googleClientConfig() {
  return {
    clientId: getConfigValue("google_client_id"),
    clientSecret: getConfigValue("google_client_secret"),
  };
}

function redirectUri(baseUrl: string, projectId: string) {
  return `${baseUrl.replace(/\/$/, "")}/api/gsc/callback?projectId=${encodeURIComponent(projectId)}`;
}

export function gscStatus(projectId: string) {
  const connection = get<GscConnection>("SELECT * FROM gsc_connections WHERE project_id = ?", [
    projectId,
  ]);
  const config = googleClientConfig();
  return {
    configured: Boolean(config.clientId && config.clientSecret),
    connected: Boolean(connection?.refresh_token || connection?.access_token),
    connection: connection
      ? {
          projectId,
          siteUrl: connection.site_url,
          accountEmail: connection.account_email,
          expiresAt: connection.expires_at,
        }
      : null,
  };
}

export function createGscAuthUrl(projectId: string, baseUrl: string) {
  const config = googleClientConfig();
  if (!config.clientId || !config.clientSecret) {
    throw new Error("Google client id and secret are required.");
  }
  const state = Buffer.from(JSON.stringify({ projectId, nonce: randomUUID() })).toString("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri(baseUrl, projectId));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GSC_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function handleGscCallback(input: {
  projectId: string;
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
      redirect_uri: redirectUri(input.baseUrl, input.projectId),
      grant_type: "authorization_code",
    }),
  });
  const token = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Google OAuth failed: ${JSON.stringify(token).slice(0, 300)}`);
  }
  saveGscConnection({
    projectId: input.projectId,
    accessToken: String(token.access_token || ""),
    refreshToken: String(token.refresh_token || ""),
    expiresIn: Number(token.expires_in || 3600),
  });
  return gscStatus(input.projectId);
}

function saveGscConnection(input: {
  projectId: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}) {
  const existing = get<GscConnection>("SELECT * FROM gsc_connections WHERE project_id = ?", [
    input.projectId,
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
      input.projectId,
      input.accessToken,
      refreshToken,
      Date.now() + input.expiresIn * 1000,
    ],
  );
}

async function getAccessToken(projectId: string) {
  const connection = get<GscConnection>("SELECT * FROM gsc_connections WHERE project_id = ?", [
    projectId,
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
    projectId,
    accessToken: String(token.access_token || ""),
    refreshToken: connection.refresh_token,
    expiresIn: Number(token.expires_in || 3600),
  });
  return String(token.access_token || "");
}

export async function listGscSites(projectId: string) {
  const accessToken = await getAccessToken(projectId);
  const response = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`GSC sites failed: ${JSON.stringify(data).slice(0, 300)}`);
  return data.siteEntry || [];
}

export function setGscSite(projectId: string, siteUrl: string) {
  run(
    "UPDATE gsc_connections SET site_url = ?, updated_at = CURRENT_TIMESTAMP WHERE project_id = ?",
    [siteUrl, projectId],
  );
  return gscStatus(projectId);
}

export async function queryGscPerformance(input: {
  projectId: string;
  siteUrl?: string;
  startDate: string;
  endDate: string;
  dimensions?: string[];
  rowLimit?: number;
}) {
  const connection = get<GscConnection>("SELECT * FROM gsc_connections WHERE project_id = ?", [
    input.projectId,
  ]);
  const siteUrl = input.siteUrl || connection?.site_url;
  if (!siteUrl) throw new Error("Choose a Search Console property first.");
  const accessToken = await getAccessToken(input.projectId);
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

export function listGscConnections() {
  return all<GscConnection>("SELECT * FROM gsc_connections ORDER BY updated_at DESC").map(
    (row) => ({
      projectId: row.project_id,
      siteUrl: row.site_url,
      connected: Boolean(row.refresh_token || row.access_token),
      expiresAt: row.expires_at,
    }),
  );
}

export function disconnectGsc(projectId: string) {
  run("DELETE FROM gsc_connections WHERE project_id = ?", [projectId]);
  return { connected: false };
}

export async function inspectGscUrls(input: {
  projectId: string;
  urls: string[] | string;
  siteUrl?: string;
}) {
  const connection = get<GscConnection>("SELECT * FROM gsc_connections WHERE project_id = ?", [
    input.projectId,
  ]);
  const siteUrl = input.siteUrl || connection?.site_url;
  if (!siteUrl) throw new Error("Choose a Search Console property first.");
  const urls = Array.isArray(input.urls)
    ? input.urls
    : String(input.urls || "")
        .split(/\n|,/)
        .map((url) => url.trim())
        .filter(Boolean);
  const accessToken = await getAccessToken(input.projectId);
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
