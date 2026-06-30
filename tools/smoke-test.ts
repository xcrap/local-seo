import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";

const rootDir = new URL("..", import.meta.url).pathname;
const tempDir = await mkdtemp(path.join(os.tmpdir(), "local-seo-smoke-"));
process.env.DB_PATH = path.join(tempDir, "scope.sqlite");
process.env.DATAFORSEO_API_KEY = "";
process.env.CODEX_MODEL = "";
process.env.CODEX_REASONING_EFFORT = "";
const { sameSiteUrl } = await import("../src/seo");
const { codexModel, codexReasoningEffort } = await import("../src/config");
if (codexModel() !== "") {
  throw new Error("Codex should use the local CLI default model unless an override is configured.");
}
if (codexReasoningEffort() !== "medium") {
  throw new Error("Codex reasoning should default to medium.");
}
if (!sameSiteUrl("https://www.waka.pt/about/", "https://waka.pt")) {
  throw new Error("Root and www variants should share audit scope.");
}
if (!sameSiteUrl("https://waka.pt/about/", "https://www.waka.pt")) {
  throw new Error("www and root variants should share audit scope.");
}
if (sameSiteUrl("https://blog.waka.pt/", "https://waka.pt")) {
  throw new Error("Unrelated subdomains must not share audit scope.");
}
const port = 4131 + Math.floor(Math.random() * 400);
const baseUrl = `http://localhost:${port}`;
const serverDbPath = path.join(tempDir, "smoke.sqlite");
const cookieJar = new Map<string, string>();
let fixtureUrl = "";
const fixtureServer = Bun.serve({
  port: 0,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      return new Response(
        `<!doctype html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>Short</title>
            <style>.inline-bg { background-image: url("/missing-inline-bg.png"); }</style>
            <link rel="stylesheet" href="/missing.css">
            <link rel="stylesheet" href="/style.css">
            <script src="/missing.js"></script>
          </head>
          <body>
            <h1>Fixture SEO Audit</h1>
	            <p>This local fixture intentionally includes broken audit signals so smoke tests can verify real crawler evidence.</p>
	            <img alt="Missing source example">
	            <img src="/broken-image.png">
	            <img src="/text-image.png" alt="photo" width="820" height="460">
	            <img src="/wrong-extension.jpg" alt="Wrong extension sample" width="820" height="460" loading="lazy" srcset="/wrong-extension.jpg 1x">
	            <picture>
	              <source srcset="/picture.webp 1x, http:// 2x" type="image/webp">
	              <img alt="Picture without fallback" width="900" height="500">
	            </picture>
	            <div class="inline-bg">Inline background image check</div>
	            <a href="/missing-page">Broken fixture link</a>
            <a href="https://example.com" target="_blank">External target</a>
          </body>
        </html>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
    if (url.pathname === "/robots.txt") {
      return new Response(`User-agent: *\nAllow: /\nSitemap: ${fixtureUrl}/sitemap.xml\n`, {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    if (url.pathname === "/sitemap.xml") {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>${fixtureUrl}/</loc></url>
          <url><loc>${fixtureUrl}/orphan-page</loc></url>
        </urlset>`,
        { headers: { "content-type": "application/xml; charset=utf-8" } },
      );
    }
    if (url.pathname === "/orphan-page") {
      return new Response(
        `<!doctype html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>Short</title>
            <meta name="description" content="This orphan page exists only in the sitemap for local audit coverage testing.">
          </head>
          <body>
            <h1>Fixture SEO Audit</h1>
            <p>This page is indexable, sitemap-listed, and intentionally has no internal inlinks from the start page.</p>
          </body>
        </html>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
    if (url.pathname === "/text-image.png") {
      return new Response("not an image", { headers: { "content-type": "text/plain" } });
    }
    if (url.pathname === "/wrong-extension.jpg") {
      return new Response("png-ish", { headers: { "content-type": "image/png", "content-length": "7" } });
    }
    if (url.pathname === "/picture.webp") {
      return new Response("webp-ish", { headers: { "content-type": "image/webp", "content-length": "8" } });
    }
    if (url.pathname === "/style.css") {
      return new Response(".hero{background-image:url('/missing-external-bg.jpg')}", {
        headers: { "content-type": "text/css; charset=utf-8" },
      });
    }
    return new Response("missing", { status: 404, headers: { "content-type": "text/plain" } });
  },
});
fixtureUrl = `http://localhost:${fixtureServer.port}`;

const server = Bun.spawn([process.execPath, "src/index.ts"], {
  cwd: rootDir,
  stdout: "pipe",
  stderr: "pipe",
  env: {
    ...process.env,
    PORT: String(port),
    DB_PATH: serverDbPath,
    AUTH_SESSION_SECRET: "smoke-test-secret-000000000000000000000",
  },
});

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    try {
      const response = await fetch(`${baseUrl}/api/auth/me`);
      if (response.status === 401) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Smoke API did not start.");
}

function cookieHeader() {
  return [...cookieJar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

function storeCookies(response: Response) {
  const raw = response.headers.get("set-cookie");
  if (!raw) return;
  const [pair] = raw.split(";");
  const index = pair.indexOf("=");
  if (index > 0) {
    cookieJar.set(pair.slice(0, index), pair.slice(index + 1));
  }
}

async function request(pathname: string, options: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(cookieJar.size ? { Cookie: cookieHeader() } : {}),
      ...(options.headers || {}),
    },
  });
  storeCookies(response);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${pathname} returned non-JSON: ${response.status} ${text.slice(0, 500)}`);
  }
  if (!response.ok) {
    throw new Error(`${pathname} failed: ${response.status} ${text}`);
  }
  return data;
}

async function requestFailure(pathname: string, options: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(cookieJar.size ? { Cookie: cookieHeader() } : {}),
      ...(options.headers || {}),
    },
  });
  storeCookies(response);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${pathname} returned non-JSON: ${response.status} ${text.slice(0, 500)}`);
  }
  if (response.ok) {
    throw new Error(`${pathname} unexpectedly succeeded.`);
  }
  return { status: response.status, data };
}

async function waitForAudit(auditId: string) {
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    const audit = await request(`/api/audits/${auditId}`);
    if (audit?.status === "completed" || audit?.status === "failed") return audit;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Audit ${auditId} did not finish.`);
}

try {
  await waitForServer();
  await request("/api/auth/setup", {
    method: "POST",
    body: JSON.stringify({ email: "admin@example.com", password: "local-password-123" }),
  });
  const dashboard = await request("/api/dashboard");
  if (dashboard.activeProject !== null || dashboard.projects?.length !== 0) {
    throw new Error(`Fresh setup should not create a placeholder site: ${JSON.stringify(dashboard)}`);
  }
  const initialSites = await request("/api/sites");
  if (initialSites.length !== 0) {
    throw new Error(`Fresh setup should keep the site list empty until the user adds a real site: ${JSON.stringify(initialSites)}`);
  }
  const project = await request("/api/sites", {
    method: "POST",
    body: JSON.stringify({ name: "Smoke", domain: "example.com" }),
  });
  if (project.crawl_protocol !== "auto" || project.crawl_host !== "auto") {
    throw new Error("New sites should default to automatic crawl preferences.");
  }
  const preferenceProject = await request("/api/sites", {
    method: "POST",
    body: JSON.stringify({ name: "Preference", domain: "example.org", crawlProtocol: "https", crawlHost: "www" }),
  });
  if (preferenceProject.crawl_protocol !== "https" || preferenceProject.crawl_host !== "www") {
    throw new Error("Site crawl preferences were not saved on create.");
  }
  const updatedPreference = await request(`/api/sites/${preferenceProject.id}`, {
    method: "PUT",
    body: JSON.stringify({ ...preferenceProject, crawl_protocol: "both", crawl_host: "both" }),
  });
  if (updatedPreference.crawl_protocol !== "both" || updatedPreference.crawl_host !== "both") {
    throw new Error("Site crawl preferences were not saved on update.");
  }
  await request("/api/config", {
    method: "PUT",
    body: JSON.stringify({
      default_location_code: "2620",
      default_language_code: "pt",
      default_crawl_protocol: "https",
      default_crawl_host: "www",
    }),
  });
  const defaultsProject = await request("/api/sites", {
    method: "POST",
    body: JSON.stringify({ name: "Configured Defaults", domain: "defaults.example" }),
  });
  if (
    defaultsProject.location_code !== 2620 ||
    defaultsProject.language_code !== "pt" ||
    defaultsProject.crawl_protocol !== "https" ||
    defaultsProject.crawl_host !== "www"
  ) {
    throw new Error(`New site did not use app defaults: ${JSON.stringify(defaultsProject)}`);
  }
  const siteScan = await request(`/api/sites/${project.id}/scan`, { method: "POST" });
  if (!siteScan.audit?.id) throw new Error("Site scan did not return an audit.");
  if (!siteScan.related?.some((row: any) => row.key === "technical-audit") || !siteScan.related?.some((row: any) => row.key === "links" && row.label === "Links")) {
    throw new Error("Site scan did not return related report statuses.");
  }
  const localProject = await request("/api/sites", {
    method: "POST",
    body: JSON.stringify({ name: "Local fixture", domain: `localhost:${fixtureServer.port}`, crawlProtocol: "http", crawlHost: "root" }),
  });
  const localSiteScan = await request(`/api/sites/${localProject.id}/scan`, { method: "POST" });
  if (!localSiteScan.audit?.id) throw new Error("Local saved-site scan did not return an audit.");
  if (!String(localSiteScan.scanUrl || "").startsWith(fixtureUrl)) {
    throw new Error(`Local saved-site scan did not resolve to the reachable HTTP fixture: ${localSiteScan.scanUrl}`);
  }
  const localMcpScan = await request("/mcp", {
    method: "POST",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "scan_site", arguments: { siteId: localProject.id } },
    }),
  });
  const mcpAuditUrl = localMcpScan.result?.structuredContent?.url || "";
  if (!localMcpScan.result?.structuredContent?.id || !String(mcpAuditUrl).startsWith(fixtureUrl)) {
    throw new Error(`MCP site scan did not resolve through site preferences: ${mcpAuditUrl}`);
  }
  const missingSite = await requestFailure("/api/sites/not-a-real-site/scan", { method: "POST" });
  if (missingSite.data?.error !== "Site not found.") {
    throw new Error(`Unexpected missing site error: ${JSON.stringify(missingSite.data)}`);
  }
  const scanAudit = await waitForAudit(siteScan.audit.id);
  if (!scanAudit.result || scanAudit.pages_crawled == null || scanAudit.issue_count == null) {
    throw new Error("Site scan audit report was not readable.");
  }
  if (
    !Array.isArray(scanAudit.result.issueGroups) ||
    !Array.isArray(scanAudit.result.imageInventory) ||
    !Array.isArray(scanAudit.result.linkInventory) ||
    typeof scanAudit.result.summary?.checkedLinks === "undefined" ||
    typeof scanAudit.result.summary?.titleLengthIssues === "undefined"
  ) {
    throw new Error("Site scan audit report is missing detailed SEO evidence.");
  }
  const fixtureAudit = await waitForAudit(localSiteScan.audit.id);
  const fixturePages = Array.isArray(fixtureAudit.result?.pages) ? fixtureAudit.result.pages : [];
  const fixtureSummary = fixtureAudit.result?.summary || {};
  const indexableRows = fixturePages.filter((page: any) => page.indexable === true).length;
  const nonIndexableRows = fixturePages.filter((page: any) => page.indexable === false).length;
  const unknownIndexabilityRows = fixturePages.filter((page: any) => typeof page.indexable !== "boolean").length;
  if (
    fixtureSummary.indexablePages !== indexableRows ||
    fixtureSummary.nonIndexablePages !== nonIndexableRows ||
    fixtureSummary.unknownIndexabilityPages !== unknownIndexabilityRows ||
    indexableRows + nonIndexableRows + unknownIndexabilityRows !== fixturePages.length
  ) {
    throw new Error("Fixture audit indexability summary does not match page-level evidence.");
  }
  const fixtureIssueTypes = new Set((fixtureAudit.result?.issues || []).map((issue: any) => issue.type));
  for (const expected of [
	    "description-missing",
	    "title-length",
	    "image-src-missing",
	    "image-alt-missing",
    "image-alt-generic",
    "image-fallback-src-missing",
    "image-srcset-invalid",
    "broken-image",
    "image-invalid-content-type",
    "image-extension-mismatch",
    "broken-internal-link",
    "broken-css",
    "broken-javascript",
    "external-blank-missing-noopener",
    "page-not-https",
    "html-lang-missing",
    "image-srcset-missing",
    "image-lazy-loading-missing",
    "render-blocking-javascript",
    "duplicate-h1",
    "orphan-page",
  ]) {
    if (!fixtureIssueTypes.has(expected)) {
      throw new Error(`Fixture audit did not detect ${expected}.`);
    }
  }
  if (!fixtureAudit.result?.imageInventory?.length || !fixtureAudit.result?.linkInventory?.length) {
    throw new Error("Fixture audit did not save image/link inventory.");
  }
  if (!fixtureAudit.result?.summary?.cssImageResources || !fixtureAudit.result?.summary?.pictureSourceImages) {
    throw new Error("Fixture audit did not check CSS image URLs and picture source URLs.");
  }
  const mcpFixtureAuditId = localMcpScan.result?.structuredContent?.id;
  if (mcpFixtureAuditId) {
    await waitForAudit(mcpFixtureAuditId);
  }
  const fixtureAuditsBeforeClear = await request(`/api/sites/${localProject.id}/audits`);
  if (fixtureAuditsBeforeClear.length < 2) {
    throw new Error("Fixture site should have multiple scans before clear-history verification.");
  }
  const clearedFixtureAudits = await request(`/api/sites/${localProject.id}/audits`, { method: "DELETE" });
  if (clearedFixtureAudits.deleted < 2) {
    throw new Error(`Clear history should delete fixture scans, got ${clearedFixtureAudits.deleted}.`);
  }
  const fixtureAuditsAfterClear = await request(`/api/sites/${localProject.id}/audits`);
  if (fixtureAuditsAfterClear.length !== 0) {
    throw new Error("Clear history did not remove all fixture scans from local SQLite.");
  }
  const siteAudits = await request(`/api/sites/${project.id}/audits`);
  if (!siteAudits.some((row: any) => row.id === siteScan.audit.id)) {
    throw new Error("Site audits endpoint did not return the scan.");
  }
  const keywordResearch = await request("/api/keywords/research", {
    method: "POST",
    body: JSON.stringify({ projectId: project.id, query: "seo software", limit: 8 }),
  });
  const keywordRows = keywordResearch.rows?.length
    ? keywordResearch.rows
    : [
        { keyword: "seo software", searchVolume: null, difficulty: null, cpc: null, intent: "manual" },
        { keyword: "seo tools", searchVolume: null, difficulty: null, cpc: null, intent: "manual" },
        { keyword: "technical seo audit", searchVolume: null, difficulty: null, cpc: null, intent: "manual" },
      ];
  await request("/api/keywords/save", {
    method: "POST",
    body: JSON.stringify({
      projectId: project.id,
      keywords: keywordRows.slice(0, 3),
      tags: ["smoke", "research"],
      source: "smoke",
    }),
  });
  const saved = await request(`/api/projects/${project.id}/keywords/query`, {
    method: "POST",
    body: JSON.stringify({ tagNames: ["smoke"], pageSize: 50 }),
  });
  if (!saved.rows?.length || !saved.tags?.length) throw new Error("Saved keyword assertions failed.");
  await request(`/api/projects/${project.id}/keywords/tags`, {
    method: "POST",
    body: JSON.stringify({ savedKeywordIds: [saved.rows[0].id], addTags: ["priority"] }),
  });
  await request("/api/serp/analyze", {
    method: "POST",
    body: JSON.stringify({ projectId: project.id, keyword: "seo software", target: "example.com" }),
  });
  const organicOverview = await request("/api/domain/overview", {
    method: "POST",
    body: JSON.stringify({ projectId: project.id, target: "example.com" }),
  });
  if (
    organicOverview.source === "provider-not-configured" &&
    (organicOverview.organicKeywords !== null ||
      organicOverview.organicTraffic !== null ||
      organicOverview.estimatedValue !== null)
  ) {
    throw new Error("Organic provider-not-configured response should keep external metrics null.");
  }
  await request("/api/domain/keywords", {
    method: "POST",
    body: JSON.stringify({ projectId: project.id, domain: "example.com", pageSize: 10 }),
  });
  await request("/api/domain/pages", {
    method: "POST",
    body: JSON.stringify({ projectId: project.id, domain: "example.com", pageSize: 10 }),
  });
  const backlinkOverview = await request("/api/backlinks/overview", {
    method: "POST",
    body: JSON.stringify({ projectId: project.id, target: "example.com" }),
  });
  if (
    backlinkOverview.source === "provider-not-configured" &&
    (backlinkOverview.backlinks !== null ||
      backlinkOverview.referringDomains !== null ||
      backlinkOverview.dofollowRatio !== null)
  ) {
    throw new Error("Backlink provider-not-configured response should keep external metrics null.");
  }
  const deleteTarget = await request("/api/sites", {
    method: "POST",
    body: JSON.stringify({ name: "Delete Me", domain: "delete-me.example" }),
  });
  await request("/api/keywords/save", {
    method: "POST",
    body: JSON.stringify({
      projectId: deleteTarget.id,
      keywords: [{ keyword: "delete me keyword", intent: "manual" }],
      source: "smoke-delete",
    }),
  });
  const deletedSite = await request(`/api/sites/${deleteTarget.id}`, { method: "DELETE" });
  if (!deletedSite.deleted) {
    throw new Error("Site delete endpoint should hard-delete the SQLite row.");
  }
  const smokeDb = new Database(path.join(tempDir, "smoke.sqlite"), { readonly: true });
  const deletionEvidence = smokeDb
    .query<
      { projectRows: number; keywordRows: number; archivedRows: number; generatedFallbackRows: number },
      [string, string]
    >(`
      SELECT
        (SELECT count(*) FROM projects WHERE id = ?) AS projectRows,
        (SELECT count(*) FROM saved_keywords WHERE project_id = ?) AS keywordRows,
        (SELECT count(*) FROM projects WHERE archived_at IS NOT NULL) AS archivedRows,
        (SELECT count(*) FROM domain_snapshots WHERE source = 'local-fallback') +
        (SELECT count(*) FROM backlink_snapshots WHERE source = 'local-fallback') AS generatedFallbackRows
    `)
    .get(deleteTarget.id, deleteTarget.id);
  smokeDb.close();
  if (
    !deletionEvidence ||
    deletionEvidence.projectRows !== 0 ||
    deletionEvidence.keywordRows !== 0 ||
    deletionEvidence.archivedRows !== 0
  ) {
    throw new Error(`Deleted sites should not stay hidden in SQLite: ${JSON.stringify(deletionEvidence)}`);
  }
  if (deletionEvidence.generatedFallbackRows !== 0) {
    throw new Error(`Provider-not-configured requests created generated fallback snapshots: ${deletionEvidence.generatedFallbackRows}`);
  }
  await request("/api/backlinks/profile", {
    method: "POST",
    body: JSON.stringify({ projectId: project.id, target: "example.com", tab: "domains", pageSize: 10 }),
  });
  const tracker = await request("/api/rank-trackers", {
    method: "POST",
    body: JSON.stringify({ projectId: project.id, domain: "example.com", keywords: ["seo software", "seo tools"] }),
  });
  await request(`/api/rank-trackers/${tracker.id}/refresh-metrics`, { method: "POST" });
  await request(`/api/rank-trackers/${tracker.id}/check`, { method: "POST" });
  await request(`/api/rank-trackers/${tracker.id}/trend`);
  await request("/api/brand-lookup", {
    method: "POST",
    body: JSON.stringify({ projectId: project.id, query: "Example", competitors: "competitor.com" }),
  });
  await request("/api/prompt-explorer", {
    method: "POST",
    body: JSON.stringify({ projectId: project.id, prompt: "best seo software", highlightBrand: "Example" }),
  });
  const audit = await request("/api/audits", {
    method: "POST",
    body: JSON.stringify({ projectId: project.id, url: "https://example.com" }),
  });
  await request(`/api/audits/${audit.id}`);
  const projectAuditsAfterSecondScan = await request(`/api/sites/${project.id}/audits`);
  if (
    projectAuditsAfterSecondScan.length < 2 ||
    !projectAuditsAfterSecondScan.some((row: any) => row.id === siteScan.audit.id) ||
    !projectAuditsAfterSecondScan.some((row: any) => row.id === audit.id)
  ) {
    throw new Error("Site audits endpoint should keep every scan for the site until the user deletes it.");
  }
  const scanHistoryDb = new Database(serverDbPath);
  try {
    const insertAudit = scanHistoryDb.prepare(`
      INSERT INTO audits (id, project_id, url, status, score, pages_crawled, issue_count, result_json, created_at, updated_at)
      VALUES (?, ?, ?, 'completed', 88, 1, 0, '{}', ?, ?)
    `);
    const insertedAuditIds: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      const id = randomUUID();
      const timestamp = `2026-06-30 12:0${index}:00`;
      insertedAuditIds.push(id);
      insertAudit.run(id, project.id, `https://example.com/history-${index}`, timestamp, timestamp);
    }
    const dashboardWithFullHistory = await request(`/api/dashboard?projectId=${project.id}`);
    const dashboardAuditIds = new Set((dashboardWithFullHistory.latestAudits || []).map((row: any) => row.id));
    for (const id of [siteScan.audit.id, audit.id, ...insertedAuditIds]) {
      if (!dashboardAuditIds.has(id)) {
        throw new Error("Dashboard scan history should include every saved scan until the user deletes it.");
      }
    }
  } finally {
    scanHistoryDb.close();
  }
  await request(`/api/gsc/status/${project.id}`);
  const gscImport = await request("/api/gsc/import", {
    method: "POST",
    body: JSON.stringify({
      projectId: project.id,
      siteUrl: "sc-domain:example.com",
      sourceName: "search-console.csv",
      csv: "Top queries,Clicks,Impressions,CTR,Position\nseo software,10,100,10%,3.2\nlocal seo,5,50,10%,4.8\n",
    }),
  });
  if (gscImport.rowCount !== 2 || gscImport.totals?.clicks !== 15 || gscImport.totals?.impressions !== 150) {
    throw new Error(`GSC CSV import totals were not normalized: ${JSON.stringify(gscImport)}`);
  }
  const gscImports = await request(`/api/gsc/imports/${project.id}`);
  if (!gscImports.length || gscImports[0].id !== gscImport.id) {
    throw new Error("GSC import was not persisted in SQLite.");
  }
  const dashboardWithGsc = await request(`/api/dashboard?projectId=${project.id}`);
  if (dashboardWithGsc.gscImportCount !== 1 || dashboardWithGsc.latestGscImport?.rowCount !== 2) {
    throw new Error(`Dashboard did not expose local GSC import evidence: ${JSON.stringify(dashboardWithGsc.latestGscImport)}`);
  }
  const mcp = await request("/mcp", {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  const toolNames = new Set((mcp.result?.tools || []).map((tool: any) => tool.name));
  if (
    !dashboardWithGsc.activeProject ||
    !Array.isArray(mcp.result?.tools) ||
    !toolNames.has("list_sites") ||
    !toolNames.has("scan_site") ||
    !toolNames.has("get_backlinks_profile") ||
    !toolNames.has("inspect_urls")
  ) {
    throw new Error("Smoke assertions failed.");
  }
  const scanSiteTool = (mcp.result?.tools || []).find((tool: any) => tool.name === "scan_site");
  if (!scanSiteTool?.inputSchema?.required?.includes("siteId")) {
    throw new Error("MCP scan_site should expose siteId as the required site identifier.");
  }
  for (const legacyName of ["list_projects", "create_project", "get_project_summary"]) {
    if (toolNames.has(legacyName)) {
      throw new Error(`MCP tools/list should not advertise legacy alias ${legacyName}.`);
    }
  }
  const legacyDescriptionTool = (mcp.result?.tools || []).find((tool: any) =>
    /^Legacy alias:/i.test(tool.description || "") || /workspace/i.test(tool.description || ""),
  );
  if (legacyDescriptionTool) {
    throw new Error(`MCP tools/list should not advertise legacy project/workspace copy: ${legacyDescriptionTool.name}`);
  }
  const projectRequiredTool = (mcp.result?.tools || []).find((tool: any) => tool.inputSchema?.required?.includes("projectId"));
  if (projectRequiredTool) {
    throw new Error(`MCP tools/list still requires projectId: ${projectRequiredTool.name}`);
  }
  const projectPropertyTool = (mcp.result?.tools || []).find((tool: any) => tool.inputSchema?.properties?.projectId);
  if (projectPropertyTool) {
    throw new Error(`MCP tools/list still exposes projectId: ${projectPropertyTool.name}`);
  }
  const mcpGsc = await request("/mcp", {
    method: "POST",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "get_gsc_performance",
        arguments: { siteId: project.id, startDate: "2026-01-01", endDate: "2026-01-31", dimensions: ["query"] },
      },
    }),
  });
  if (mcpGsc.result?.structuredContent?.source !== "local_gsc_import" || mcpGsc.result?.structuredContent?.totals?.clicks !== 15) {
    throw new Error(`MCP GSC performance did not read the local import: ${JSON.stringify(mcpGsc)}`);
  }
  console.log("Smoke test passed.");
} finally {
  server.kill();
  await server.exited.catch(() => undefined);
  fixtureServer.stop(true);
  await rm(tempDir, { recursive: true, force: true });
}

export {};
