import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";

const rootDir = new URL("..", import.meta.url).pathname;
const tempDir = await mkdtemp(path.join(os.tmpdir(), "local-seo-smoke-"));
process.env.DB_PATH = path.join(tempDir, "scope.sqlite");
process.env.SEO_METRICS_API_KEY = "";
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
const emptyEvidenceServer = Bun.serve({
  port: 0,
  fetch() {
    return new Response("stopped before scan");
  },
});
const emptyEvidenceUrl = `http://localhost:${emptyEvidenceServer.port}`;
emptyEvidenceServer.stop(true);

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
  if (dashboard.activeSite !== null || dashboard.sites?.length !== 0) {
    throw new Error(`Fresh setup should not create a placeholder site: ${JSON.stringify(dashboard)}`);
  }
  if ("activeProject" in dashboard || "projects" in dashboard) {
    throw new Error(`Dashboard response should expose sites, not projects: ${JSON.stringify(dashboard)}`);
  }
  const initialSites = await request("/api/sites");
  if (initialSites.length !== 0) {
    throw new Error(`Fresh setup should keep the site list empty until the user adds a real site: ${JSON.stringify(initialSites)}`);
  }
  const schemaDb = new Database(serverDbPath, { readonly: true });
  try {
    const tables = new Set(schemaDb.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
    if (!tables.has("sites") || tables.has("projects")) {
      throw new Error(`Fresh SQLite schema should create sites, not projects: ${JSON.stringify([...tables].sort())}`);
    }
    const siteColumns = schemaDb.query<{ name: string }, []>("PRAGMA table_info(sites)").all().map((row) => row.name);
    if (siteColumns.includes("archived_at")) {
      throw new Error("Fresh sites schema should not keep unused archive state.");
    }
    const siteIndexes = schemaDb.query<{ name: string }, []>("PRAGMA index_list(sites)").all().map((row) => row.name);
    if (siteIndexes.includes("idx_sites_active")) {
      throw new Error("Fresh sites schema should not keep the old archive index.");
    }
    for (const table of ["saved_keywords", "audits", "gsc_imports", "domain_snapshots", "backlink_snapshots", "serp_runs"]) {
      const columns = schemaDb.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all().map((row) => row.name);
      if (columns.includes("project_id")) {
        throw new Error(`Fresh SQLite table ${table} should use site_id, not project_id.`);
      }
      if (["domain_snapshots", "backlink_snapshots", "serp_runs"].includes(table) && columns.includes("target")) {
        throw new Error(`Fresh SQLite table ${table} should use domain, not target.`);
      }
    }
  } finally {
    schemaDb.close();
  }
  const legacyProjectsResponse = await fetch(`${baseUrl}/api/projects`, {
    headers: cookieJar.size ? { Cookie: cookieHeader() } : {},
  });
  if (legacyProjectsResponse.status !== 404) {
    throw new Error(`Legacy /api/projects route should be gone, got ${legacyProjectsResponse.status}.`);
  }
  const dbSource = await readFile(path.join(rootDir, "src/db.ts"), "utf8");
  if (/DELETE\s+FROM\s+(sites|audits|gsc_imports)\b/i.test(dbSource)) {
    throw new Error("Startup database migrations must not silently delete user-owned sites, audits, or imports.");
  }
  for (const removedSchemaBridge of [
    "004_project_crawl_preferences",
    "007_site_schema_names",
    "ALTER TABLE projects RENAME TO sites",
    "idx_projects_active",
    "project_id",
  ]) {
    if (dbSource.includes(removedSchemaBridge)) {
      throw new Error(`Fresh app database startup should not keep old project-schema compatibility code: ${removedSchemaBridge}`);
    }
  }
  const gscSource = await readFile(path.join(rootDir, "src/gsc.ts"), "utf8");
  if (gscSource.includes(".slice(0, 5000)")) {
    throw new Error("Search Console CSV imports must not silently drop rows after 5,000 entries.");
  }
  for (const gscProjectLeak of ["callback?projectId", "projectId: row.project_id", "projectId, nonce"]) {
    if (gscSource.includes(gscProjectLeak)) {
      throw new Error(`Search Console public surface should use siteId, not ${gscProjectLeak}.`);
    }
  }
  const readmeSource = await readFile(path.join(rootDir, "README.md"), "utf8");
  if (/target domain|target ownership|crawl target preferences/i.test(readmeSource)) {
    throw new Error("README should explain active-site/comparison-site workflows with clear site and crawl URL wording.");
  }
  if (/search market\/language locale/i.test(readmeSource)) {
    throw new Error("README should describe keyword tool defaults, not a site search-language locale.");
  }
  const envExampleSource = await readFile(path.join(rootDir, ".env.example"), "utf8");
  if (/save these in Settings|save .* in Settings/i.test(envExampleSource + readmeSource)) {
    throw new Error("Docs should not imply app Settings are used for secret environment credentials.");
  }
  if (!/^CODEX_MODEL=$/m.test(envExampleSource) || /gpt-5\.5/i.test(envExampleSource)) {
    throw new Error("The env example should leave CODEX_MODEL blank so the local Codex CLI default is used.");
  }
  if (!/OpenSERP/i.test(envExampleSource + readmeSource) || !/SearXNG/i.test(envExampleSource + readmeSource)) {
    throw new Error("Docs should expose free/self-hosted SERP providers before optional paid metrics.");
  }
  if (/DataForSEO|DATAFORSEO/.test(envExampleSource + readmeSource)) {
    throw new Error("Docs and env examples should stay vendor-neutral for optional external metrics sources.");
  }
  const apiServerSource = await readFile(path.join(rootDir, "src/index.ts"), "utf8");
  if (apiServerSource.includes('"/api/projects')) {
    throw new Error("Public API routes should expose /api/sites only, not legacy /api/projects aliases.");
  }
  const mcpSource = await readFile(path.join(rootDir, "src/mcp.ts"), "utf8");
  if (mcpSource.includes("cloudflare:")) {
    throw new Error("Runtime MCP responses should not keep Cloudflare fields.");
  }
  if (/domainOrUrl|body\.domain\s*\|\|\s*body\.url/.test(apiServerSource)) {
    throw new Error("Domain APIs should require domain explicitly instead of keeping old domainOrUrl/url aliases.");
  }
  const seoSource = await readFile(path.join(rootDir, "src/seo.ts"), "utf8");
  if (/\bconst\s+project\s*=\s*getSite\b/.test(seoSource) || /\bconst\s+project\s*=\s*getSite\b/.test(gscSource)) {
    throw new Error("Site service code should use site naming internally, not project variables around getSite.");
  }
  for (const legacySeoName of ["type Project", "createProject", "getProject", "listProjects", "updateProject", "deleteProject", "projectSummary"]) {
    if (seoSource.includes(legacySeoName)) {
      throw new Error(`SEO service should use site-named exports, not ${legacySeoName}.`);
    }
  }
  if (seoSource.includes("activeProject:") || /^\s*projects:/m.test(seoSource)) {
    throw new Error("Dashboard API should return activeSite/sites terminology.");
  }
  if (/slice\(0,\s*5\)/.test(seoSource)) {
    throw new Error("Crawler audit issues should keep full local evidence arrays instead of five-item samples.");
  }
  if (!seoSource.includes("function searchSearxng") || !seoSource.includes("process.env.SEARXNG_URL")) {
    throw new Error("SERP/rank search should support self-hosted SearXNG before falling back to DuckDuckGo.");
  }
  const webApiClient = await readFile(path.join(rootDir, "web/src/api.ts"), "utf8");
  if (webApiClient.includes("/api/projects")) {
    throw new Error("The web client should use /api/sites routes instead of legacy /api/projects routes.");
  }
  for (const legacyWebApiName of ["type Project", "projects:", "project:", "createProject", "updateProject", "deleteProject", "scanProject"]) {
    if (webApiClient.includes(legacyWebApiName)) {
      throw new Error(`The web API client should expose site-named helpers, not ${legacyWebApiName}.`);
    }
  }
  if (webApiClient.includes("JSON.stringify({ projectId")) {
    throw new Error("The web client should send siteId in request bodies instead of projectId.");
  }
  const webAppClient = await readFile(path.join(rootDir, "web/src/App.tsx"), "utf8");
  if (/DataForSEO|DATAFORSEO/.test(webAppClient)) {
    throw new Error("The React UI should not advertise a paid metrics provider by name.");
  }
  if (webAppClient.includes('path="/projects"') || webAppClient.includes('to="/projects"')) {
    throw new Error("The React app should not expose or redirect a legacy /projects route.");
  }
  if (!webAppClient.includes('path="/links"') || !webAppClient.includes('to="/links"')) {
    throw new Error("The React app should expose Links at /links.");
  }
  if (webAppClient.includes('path="/backlinks"') || webAppClient.includes('to="/backlinks"')) {
    throw new Error("The React app should not keep a /backlinks UI route or redirect.");
  }
  if (!webAppClient.includes('path="*" element={<NotFoundPage />}') || !webAppClient.includes("function NotFoundPage")) {
    throw new Error("The React app should render a useful not-found screen for unknown local routes.");
  }
  for (const legacyWebCall of ["api.projects", "api.project", "api.createProject", "api.updateProject", "api.deleteProject", "api.scanProject"]) {
    if (webAppClient.includes(legacyWebCall)) {
      throw new Error(`The app should call site-named API helpers, not ${legacyWebCall}.`);
    }
  }
  if (/type=["']date["']/.test(webAppClient) || !webAppClient.includes("function DatePicker") || !webAppClient.includes("<Calendar")) {
    throw new Error("Date controls should use the shadcn Calendar/Popover date picker instead of native date inputs.");
  }
  if (webAppClient.includes("projectId: project.id")) {
    throw new Error("The app should send siteId for active-site actions.");
  }
  if (/selected-site/i.test(webAppClient)) {
    throw new Error("The app should use active-site wording instead of selected-site implementation copy.");
  }
  if (webAppClient.includes("window.location.href")) {
    throw new Error("The app shell should use React Router navigation instead of full-page window.location.href route changes.");
  }
  if (webAppClient.includes("rows[0] || ledger[0]")) {
    throw new Error("Audit report selection should not hide context by auto-opening the newest global scan.");
  }
  if (/First scan target|target candidates|Resolve target|tries \$\{formatNumber\(candidates\.length\)\} targets|tries \d+ targets/i.test(webAppClient)) {
    throw new Error("The app should present saved-site crawl settings as explicit crawl URLs, not vague target wording.");
  }
  if (!webAppClient.includes("Scan plan")) {
    throw new Error("The main site flow should expose the saved site's scan plan.");
  }
  if (!webAppClient.includes("function siteSelectLabel") || !webAppClient.includes("siteSelectLabel(site)")) {
    throw new Error("The active-site selector should include site name, domain, and scan plan for each saved site.");
  }
  if (!webAppClient.includes("Scan plan preview")) {
    throw new Error("Site create/edit forms should preview the exact scan plan before starting a scan.");
  }
  if (!webAppClient.includes("Every saved scan is still listed below")) {
    throw new Error("Audit page should explain that all saved scans remain visible in the local ledger.");
  }
  if (!webAppClient.includes("Could not load local sites") || !webAppClient.includes("Your SQLite data was not cleared")) {
    throw new Error("Site loading failures should be visible instead of rendering an empty site list that looks like data loss.");
  }
  if (!webAppClient.includes("Saved scan for page evidence") || !webAppClient.includes("Saved scan for link evidence")) {
    throw new Error("Organic and Links pages should expose saved scan selectors instead of hiding older scans behind latest-only evidence.");
  }
  if (/from the latest (site|local) audit|The latest audit did not/i.test(webAppClient)) {
    throw new Error("Audit-derived evidence pages should not present local crawl data as latest-only.");
  }
  for (const legacyTargetLabel of ["Organic target", "External backlink target", "Analyze target", "Custom target"]) {
    if (webAppClient.includes(legacyTargetLabel)) {
      throw new Error(`Organic and Links pages should use active-site/competitor wording, not "${legacyTargetLabel}".`);
    }
  }
  if (webAppClient.includes("target domain")) {
    throw new Error("SERP analysis should not expose vague target-domain placeholder copy.");
  }
  if (webAppClient.includes("appears across AI answers") || webAppClient.includes("save an AI visibility snapshot")) {
    throw new Error("Brand lookup copy should not promise AI-answer evidence when local mode uses web-search evidence.");
  }
  if (seoSource.includes("Target is required")) {
    throw new Error("SEO API errors should ask for a domain, not a vague target.");
  }
  for (const vagueTargetCopy of [
    "competitor target analyzed",
    "Top pages returned for this target",
    "Check a target to load real backlink rows",
    "failing targets from the selected saved audit",
    "failing link targets",
    "HTTP link target",
    "unique link targets checked",
    "unique targets checked",
    "link targets checked",
    "Targets, anchors, redirects",
    "Target: {result.resolvedTarget}",
  ]) {
    if (webAppClient.includes(vagueTargetCopy)) {
      throw new Error(`User-facing copy should name domains, URLs, or HTML windows instead of vague target wording: ${vagueTargetCopy}`);
    }
  }
  for (const specificHistoryLabel of [
    'labelTitle="Research site"',
    'labelTitle="Backlink index site"',
    'labelTitle="Brand or domain"',
    'labelTitle="Prompt"',
  ]) {
    if (!webAppClient.includes(specificHistoryLabel)) {
      throw new Error(`Saved history tables should use specific column labels: ${specificHistoryLabel}`);
    }
  }
  if (!webAppClient.includes("Organic research site") || !webAppClient.includes("Backlink index site") || !webAppClient.includes("SERP ownership site")) {
    throw new Error("Competitive pages should label their domain inputs as site-specific controls.");
  }
  if (/Search defaults|Search market|Keyword language|Default search market|Default keyword language/.test(webAppClient)) {
    throw new Error("Site forms should label market/language as keyword tool defaults, not site search defaults.");
  }
  if (webAppClient.includes("Keyword/rank defaults") || webAppClient.includes("Keyword result language")) {
    throw new Error("Site forms should not make saved websites look like they have one required search language.");
  }
  if (!webAppClient.includes("Keyword tool defaults") || !webAppClient.includes("Audits crawl every page language they find") || !webAppClient.includes('Field label="Result language"')) {
    throw new Error("Keyword market/language controls should be optional keyword-tool defaults, not primary site fields.");
  }
  if (webAppClient.includes("firstLocationCode") || webAppClient.includes("firstLanguageCode")) {
    throw new Error("First-run site scan should not carry hidden keyword market/language fields.");
  }
  if (!webAppClient.includes('<Field label="Website address">') || !webAppClient.includes('<Field label="Site name">')) {
    throw new Error("First-run site forms should use visible labels, not only placeholders.");
  }
  if (!webAppClient.includes("<Pencil /> Edit") || !webAppClient.includes("<Trash2 /> Delete") || !webAppClient.includes('"Scan site"')) {
    throw new Error("Saved-site table actions should be visible text buttons for scan, edit, and delete.");
  }
  for (const explicitDashboardAction of ["Open organic", "Open links", "Open ranks", "Open Search Console", "Open AI lab"]) {
    if (!webAppClient.includes(explicitDashboardAction)) {
      throw new Error(`Dashboard actions should use explicit labels, missing ${explicitDashboardAction}.`);
    }
  }
  if (!webAppClient.includes("<Trash2 /> Delete scan")) {
    throw new Error("Scan history deletion should be a visible Delete scan button, not an icon-only control.");
  }
  if (!webAppClient.includes("<TableHead>URL</TableHead>") || !webAppClient.includes("<TableHead>Window</TableHead>")) {
    throw new Error("Audit link tables should label URL columns and HTML target-window attributes clearly.");
  }
  if (!webAppClient.includes("<TableHead>Inputs</TableHead>") || !webAppClient.includes('required.has(name) ? " required" : ""')) {
    throw new Error("MCP tools table should show all inputs and mark required ones inline.");
  }
  if (!webAppClient.includes("Issue results") || !webAppClient.includes("Show {formatNumber")) {
    throw new Error("Audit issue actions should show an explicit filtered issue result count instead of generic Review buttons.");
  }
  if (webAppClient.includes("Review high") || webAppClient.includes("Use Review to jump") || webAppClient.includes("<ListChecks /> Review")) {
    throw new Error("Audit report actions should say exactly which issues they open, not generic Review.");
  }
  if (webAppClient.includes("rows.slice(0, 350)") || webAppClient.includes("Showing {formatNumber(visible.length)}")) {
    throw new Error("Audit evidence tables should not silently cap local link or image inventory rows.");
  }
  if (webAppClient.includes(".slice(0, 150)") || webAppClient.includes(".slice(0, 100)")) {
    throw new Error("Local link graph should not silently cap audit-derived local evidence rows.");
  }
  if (webAppClient.includes(".slice(0, 25);")) {
    throw new Error("Local organic crawl evidence should not silently cap audit-derived page rows.");
  }
  if (webAppClient.includes("rows.slice(0, 6)") || webAppClient.includes("runs.slice(0, 8)")) {
    throw new Error("Local history widgets should not silently cap saved history rows.");
  }
  for (const hiddenEvidencePattern of [
    "rows.slice(0, 12)",
    "Showing 12 of",
    ".slice(0, 5);",
    "groups.slice(0, 24)",
    "Showing 24 of",
    "Object.entries(issue.evidence || {}).slice(0, 4)",
  ]) {
    if (webAppClient.includes(hiddenEvidencePattern)) {
      throw new Error(`Readable evidence UI should not hide saved rows with ${hiddenEvidencePattern}.`);
    }
  }
  if (webAppClient.includes("rounded-md border bg-background p-3 text-sm") || !webAppClient.includes("HistoryTable")) {
    throw new Error("Local history widgets should render as readable tables instead of mini card stacks.");
  }
  if (
    webAppClient.includes("grid divide-y md:grid-cols-2") ||
    webAppClient.includes("flex min-h-24 items-center justify-between") ||
    webAppClient.includes('columns="lg:grid-cols')
  ) {
    throw new Error("Metric summaries should render as readable evidence tables instead of mini card grids.");
  }
  if (
    webAppClient.includes("function GscInspectionFact") ||
    webAppClient.includes("function AiJobFact") ||
    webAppClient.includes('<div className="grid gap-3 md:grid-cols-3">') ||
    webAppClient.includes("rounded-md border bg-muted/25 p-3 text-sm leading-6")
  ) {
    throw new Error("Search Console inspection, AI metadata, and recommendation rows should render as readable evidence tables, not mini fact cards.");
  }
  if (webAppClient.includes("Clear selected site")) {
    throw new Error("Scan-history deletion should not look like it clears or deletes the selected site.");
  }
  if (webAppClient.includes("\"Deleted site\"") || webAppClient.includes("row.project_domain") || webAppClient.includes("row.project_id")) {
    throw new Error("Audit history should show readable site context and must never fall back to raw internal site IDs.");
  }
  if (webAppClient.includes("local-seo:project") || webAppClient.includes("legacySiteStorageKey") || webAppClient.includes("legacySelectedAuditStorageKey")) {
    throw new Error("Fresh app storage should not preserve legacy project or unscoped scan-selection keys.");
  }
  if (!webAppClient.includes("if (row.site_id) setSelectedAuditId(row.site_id, row.id);")) {
    throw new Error("Audit history should only store selected scan state when a scan row has a site ID.");
  }
  for (const pattern of [
    "row.searchVolume || \"-\"",
    "formatNumber(row.search_volume)",
    "formatNumber(row.keyword_difficulty)",
    "row.cpc ?? \"-\"",
  ]) {
    if (webAppClient.includes(pattern)) {
      throw new Error(`Keyword metric tables should render unavailable metrics explicitly, not with ${pattern}.`);
    }
  }
  if (!webAppClient.includes("show as unavailable unless a real metrics source is connected")) {
    throw new Error("Keyword research copy should explain unavailable metric values clearly.");
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
  const rejectedSecretConfig = await requestFailure("/api/config", {
    method: "PUT",
    body: JSON.stringify({
      seo_metrics_api_key: "should-not-save-here",
    }),
  });
  if (!/App settings cannot save/i.test(String(rejectedSecretConfig.data?.error || ""))) {
    throw new Error(`App settings API should reject secret/data-source keys: ${JSON.stringify(rejectedSecretConfig)}`);
  }
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
  const localConfigStatus = await request("/api/config");
  if (
    localConfigStatus.local_db_path !== path.resolve(serverDbPath) ||
    Number(localConfigStatus.local_site_count || 0) < 3
  ) {
    throw new Error(`Config should expose the local SQLite source of truth and counts: ${JSON.stringify(localConfigStatus)}`);
  }
  const siteScan = await request(`/api/sites/${project.id}/scan`, { method: "POST" });
  if (!siteScan.audit?.id) throw new Error("Site scan did not return an audit.");
  if (!Array.isArray(siteScan.candidateUrls) || !siteScan.candidateUrls.includes("https://example.com")) {
    throw new Error(`Site scan should return its scan-plan candidate URLs: ${JSON.stringify(siteScan)}`);
  }
  if (!siteScan.related?.some((row: any) => row.key === "technical-audit") || !siteScan.related?.some((row: any) => row.key === "links" && row.label === "Links")) {
    throw new Error("Site scan did not return related report statuses.");
  }
  if (!siteScan.related?.some((row: any) => row.key === "links" && row.route === "/links")) {
    throw new Error(`Site scan should send users to the Links route, not a legacy route: ${JSON.stringify(siteScan.related)}`);
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
  if (!Array.isArray(localSiteScan.candidateUrls) || localSiteScan.candidateUrls[0] !== fixtureUrl) {
    throw new Error(`Local saved-site scan did not return the expected scan plan: ${JSON.stringify(localSiteScan.candidateUrls)}`);
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
  const mcpScan = localMcpScan.result?.structuredContent || {};
  const mcpAuditUrl = mcpScan.audit?.url || mcpScan.scanUrl || "";
  if (!mcpScan.audit?.id || !String(mcpAuditUrl).startsWith(fixtureUrl)) {
    throw new Error(`MCP site scan did not resolve through site preferences: ${mcpAuditUrl}`);
  }
  if (!Array.isArray(mcpScan.candidateUrls) || mcpScan.candidateUrls[0] !== fixtureUrl) {
    throw new Error(`MCP site scan should return the saved site's scan plan: ${JSON.stringify(mcpScan.candidateUrls)}`);
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
  const timedFixturePages = fixturePages.filter((page: any) => Number.isFinite(Number(page.loadMs)) && Number(page.loadMs) >= 0);
  if (
    timedFixturePages.length !== fixturePages.length ||
    fixtureSummary.measuredPageLoads !== timedFixturePages.length ||
    !Number.isFinite(Number(fixtureSummary.averagePageLoadMs)) ||
    !Number.isFinite(Number(fixtureSummary.medianPageLoadMs)) ||
    !Number.isFinite(Number(fixtureSummary.p95PageLoadMs)) ||
    Number(fixtureSummary.p95PageLoadMs) < Number(fixtureSummary.medianPageLoadMs)
  ) {
    throw new Error(`Fixture audit speed summary does not match page-level response timings: ${JSON.stringify(fixtureSummary)}`);
  }
  const localOrganicPages = await request("/api/domain/pages", {
    method: "POST",
    body: JSON.stringify({ siteId: localProject.id, domain: `localhost:${fixtureServer.port}`, pageSize: 10 }),
  });
  if (
    localOrganicPages.source !== "local-audit" ||
    localOrganicPages.pages?.length !== fixturePages.length ||
    localOrganicPages.pages.some((row: any) => row.organicTraffic !== null || row.keywords !== null)
  ) {
    throw new Error(`Organic top pages should fall back to real local audit rows without generated metrics: ${JSON.stringify(localOrganicPages)}`);
  }
  const emptyEvidenceAudit = await request("/api/audits", {
    method: "POST",
    body: JSON.stringify({ siteId: localProject.id, url: emptyEvidenceUrl }),
  });
  const emptyEvidenceResult = await waitForAudit(emptyEvidenceAudit.id);
  const emptyEvidenceIssueTypes = new Set((emptyEvidenceResult.result?.issues || []).map((issue: any) => issue.type));
  if (
    emptyEvidenceResult.status !== "completed" ||
    emptyEvidenceResult.pages_crawled !== 0 ||
    emptyEvidenceResult.score !== 0 ||
    !emptyEvidenceIssueTypes.has("no-pages-crawled")
  ) {
    throw new Error(`Empty-evidence scans must not look healthy: ${JSON.stringify({
      status: emptyEvidenceResult.status,
      pages: emptyEvidenceResult.pages_crawled,
      score: emptyEvidenceResult.score,
      issues: [...emptyEvidenceIssueTypes],
    })}`);
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
  const mcpFixtureAuditId = localMcpScan.result?.structuredContent?.audit?.id;
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
    body: JSON.stringify({ siteId: project.id, query: "seo software", limit: 8 }),
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
      siteId: project.id,
      keywords: keywordRows.slice(0, 3),
      tags: ["smoke", "research"],
      source: "smoke",
    }),
  });
  const saved = await request(`/api/sites/${project.id}/keywords/query`, {
    method: "POST",
    body: JSON.stringify({ tagNames: ["smoke"], pageSize: 50 }),
  });
  if (!saved.rows?.length || !saved.tags?.length) throw new Error("Saved keyword assertions failed.");
  await request(`/api/sites/${project.id}/keywords/tags`, {
    method: "POST",
    body: JSON.stringify({ savedKeywordIds: [saved.rows[0].id], addTags: ["priority"] }),
  });
  const serpAnalysis = await request("/api/serp/analyze", {
    method: "POST",
    body: JSON.stringify({ siteId: project.id, keyword: "seo software", domain: "example.com" }),
  });
  if (
    serpAnalysis.domain !== "example.com" ||
    "target" in serpAnalysis ||
    "targetPosition" in serpAnalysis ||
    serpAnalysis.rows?.some((row: any) => "isTarget" in row)
  ) {
    throw new Error(`SERP analysis should expose domain fields, not target fields: ${JSON.stringify(serpAnalysis)}`);
  }
  const organicOverview = await request("/api/domain/overview", {
    method: "POST",
    body: JSON.stringify({ siteId: project.id, domain: "example.com" }),
  });
  if (organicOverview.domain !== "example.com" || "target" in organicOverview) {
    throw new Error(`Organic research should expose domain, not target: ${JSON.stringify(organicOverview)}`);
  }
  if (
    organicOverview.source === "provider-not-configured" &&
    (organicOverview.organicKeywords !== null ||
      organicOverview.organicTraffic !== null ||
      organicOverview.estimatedValue !== null)
  ) {
    throw new Error("Organic provider-not-configured response should keep external metrics null.");
  }
  if (organicOverview.source === "provider-not-configured" && /DataForSEO/i.test(String(organicOverview.providerRequired || ""))) {
    throw new Error(`Missing organic provider response should be vendor-neutral: ${JSON.stringify(organicOverview)}`);
  }
  await request("/api/domain/keywords", {
    method: "POST",
    body: JSON.stringify({ siteId: project.id, domain: "example.com", pageSize: 10 }),
  });
  await request("/api/domain/pages", {
    method: "POST",
    body: JSON.stringify({ siteId: project.id, domain: "example.com", pageSize: 10 }),
  });
  const backlinkOverview = await request("/api/backlinks/overview", {
    method: "POST",
    body: JSON.stringify({ siteId: project.id, domain: "example.com" }),
  });
  if (backlinkOverview.domain !== "example.com" || "target" in backlinkOverview) {
    throw new Error(`Backlink overview should expose domain, not target: ${JSON.stringify(backlinkOverview)}`);
  }
  if (
    backlinkOverview.source === "provider-not-configured" &&
    (backlinkOverview.backlinks !== null ||
      backlinkOverview.referringDomains !== null ||
      backlinkOverview.dofollowRatio !== null)
  ) {
    throw new Error("Backlink provider-not-configured response should keep external metrics null.");
  }
  if (backlinkOverview.source === "provider-not-configured" && /DataForSEO/i.test(String(backlinkOverview.providerRequired || ""))) {
    throw new Error(`Missing backlink provider response should be vendor-neutral: ${JSON.stringify(backlinkOverview)}`);
  }
  const deleteTarget = await request("/api/sites", {
    method: "POST",
    body: JSON.stringify({ name: "Delete Me", domain: "delete-me.example" }),
  });
  await request("/api/keywords/save", {
    method: "POST",
    body: JSON.stringify({
      siteId: deleteTarget.id,
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
      { siteRows: number; keywordRows: number; generatedFallbackRows: number },
      [string, string]
    >(`
      SELECT
        (SELECT count(*) FROM sites WHERE id = ?) AS siteRows,
        (SELECT count(*) FROM saved_keywords WHERE site_id = ?) AS keywordRows,
        (SELECT count(*) FROM domain_snapshots WHERE source = 'local-fallback') +
        (SELECT count(*) FROM backlink_snapshots WHERE source = 'local-fallback') AS generatedFallbackRows
    `)
    .get(deleteTarget.id, deleteTarget.id);
  smokeDb.close();
  if (
    !deletionEvidence ||
    deletionEvidence.siteRows !== 0 ||
    deletionEvidence.keywordRows !== 0
  ) {
    throw new Error(`Deleted sites should not stay hidden in SQLite: ${JSON.stringify(deletionEvidence)}`);
  }
  if (deletionEvidence.generatedFallbackRows !== 0) {
    throw new Error(`Provider-not-configured requests created generated fallback snapshots: ${deletionEvidence.generatedFallbackRows}`);
  }
  const aiHistoryDb = new Database(serverDbPath);
  try {
    const insertAiJob = aiHistoryDb.prepare(`
      INSERT INTO ai_jobs (id, type, prompt, status, message, result_text, created_at, finished_at)
      VALUES (?, 'smoke.ai', ?, 'completed', 'Completed', ?, ?, ?)
    `);
    const insertedAiJobIds: string[] = [];
    for (let index = 0; index < 55; index += 1) {
      const id = randomUUID();
      const timestamp = `2026-06-30 13:${String(index).padStart(2, "0")}:00`;
      insertedAiJobIds.push(id);
      insertAiJob.run(id, `Prompt ${index}`, `Result ${index}`, timestamp, timestamp);
    }
    const aiJobs = await request("/api/ai/jobs");
    const aiJobIds = new Set((aiJobs || []).map((row: any) => row.id));
    for (const id of insertedAiJobIds) {
      if (!aiJobIds.has(id)) {
        throw new Error("AI lab should show every saved local Codex job until the user deletes it.");
      }
    }
    const dashboardWithAiJobs = await request(`/api/dashboard?siteId=${project.id}`);
    const dashboardAiJobIds = new Set((dashboardWithAiJobs.latestAiJobs || []).map((row: any) => row.id));
    for (const id of insertedAiJobIds) {
      if (!dashboardAiJobIds.has(id)) {
        throw new Error("Dashboard should show every saved local Codex job until the user deletes it.");
      }
    }
  } finally {
    aiHistoryDb.close();
  }
  const backlinkProfile = await request("/api/backlinks/profile", {
    method: "POST",
    body: JSON.stringify({ siteId: project.id, domain: "example.com", tab: "domains", pageSize: 10 }),
  });
  if (backlinkProfile.domain !== "example.com" || "target" in backlinkProfile) {
    throw new Error(`Backlink profile should expose domain, not target: ${JSON.stringify(backlinkProfile)}`);
  }
  const tracker = await request("/api/rank-trackers", {
    method: "POST",
    body: JSON.stringify({ siteId: project.id, domain: "example.com", keywords: ["seo software", "seo tools"] }),
  });
  await request(`/api/rank-trackers/${tracker.id}/refresh-metrics`, { method: "POST" });
  await request(`/api/rank-trackers/${tracker.id}/check`, { method: "POST" });
  await request(`/api/rank-trackers/${tracker.id}/trend`);
  const brandLookupResult = await request("/api/brand-lookup", {
    method: "POST",
    body: JSON.stringify({ siteId: project.id, query: "Example", competitors: "competitor.com" }),
  });
  if (
    "resolvedTarget" in brandLookupResult ||
    brandLookupResult.shareOfVoice?.some((row: any) => "target" in row) ||
    !brandLookupResult.resolvedEntity ||
    !brandLookupResult.shareOfVoice?.some((row: any) => row.isPrimary === true)
  ) {
    throw new Error(`AI visibility should expose entity fields, not target fields: ${JSON.stringify(brandLookupResult)}`);
  }
  const promptExplorerResult = await request("/api/prompt-explorer", {
    method: "POST",
    body: JSON.stringify({ siteId: project.id, prompt: "best seo software", highlightBrand: "Example" }),
  });
  if (
    promptExplorerResult.source !== "codex" ||
    promptExplorerResult.results?.length !== 1 ||
    promptExplorerResult.results?.[0]?.model !== "local_codex"
  ) {
    throw new Error(`Local prompt explorer should queue one Codex run instead of external model rows: ${JSON.stringify(promptExplorerResult)}`);
  }
  const localHistoryDb = new Database(serverDbPath);
  try {
    const savedPromptRun = localHistoryDb
      .query<{ source: string; models: string }, [string]>("SELECT source, models FROM prompt_explorer_runs WHERE site_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(project.id);
    if (
      !savedPromptRun ||
      savedPromptRun.source !== "codex" ||
      JSON.stringify(JSON.parse(savedPromptRun.models || "[]")) !== JSON.stringify(["local_codex"])
    ) {
      throw new Error(`Local prompt explorer history should store local_codex only: ${JSON.stringify(savedPromptRun)}`);
    }
    const insertDomainSnapshot = localHistoryDb.prepare(`
      INSERT INTO domain_snapshots (id, site_id, domain, source, result_json, created_at)
      VALUES (?, ?, ?, 'smoke-history', '{}', ?)
    `);
    const insertBacklinkSnapshot = localHistoryDb.prepare(`
      INSERT INTO backlink_snapshots (id, site_id, domain, source, result_json, created_at)
      VALUES (?, ?, ?, 'smoke-history', '{}', ?)
    `);
    const insertSerpRun = localHistoryDb.prepare(`
      INSERT INTO serp_runs (id, site_id, keyword, domain, location_code, language_code, source, result_json, created_at)
      VALUES (?, ?, ?, 'example.com', 2840, 'en', 'smoke-history', '{}', ?)
    `);
    const insertBrandRun = localHistoryDb.prepare(`
      INSERT INTO brand_lookup_runs (id, site_id, query, competitors, source, result_json, created_at)
      VALUES (?, ?, ?, '[]', 'smoke-history', '{}', ?)
    `);
    const insertPromptRun = localHistoryDb.prepare(`
      INSERT INTO prompt_explorer_runs (id, site_id, prompt, highlight_brand, models, source, result_json, created_at)
      VALUES (?, ?, ?, 'Example', '[]', 'smoke-history', '{}', ?)
    `);
    const insertSavedKeyword = localHistoryDb.prepare(`
      INSERT INTO saved_keywords (id, site_id, keyword, location_code, language_code, intent, source, created_at)
      VALUES (?, ?, ?, 2840, 'en', 'manual', 'smoke-history', ?)
    `);
    const trackerId = randomUUID();
    localHistoryDb
      .prepare(`
        INSERT INTO rank_trackers (id, site_id, domain, location_code, language_code, created_at, updated_at)
        VALUES (?, ?, 'example.com', 2840, 'en', '2026-06-30 15:00:00', '2026-06-30 15:00:00')
      `)
      .run(trackerId, project.id);
    const insertRankRun = localHistoryDb.prepare(`
      INSERT INTO rank_runs (id, tracker_id, status, message, started_at, finished_at)
      VALUES (?, ?, 'completed', 'smoke-history', ?, ?)
    `);
    const insertedHistoryIds: Record<string, string[]> = {
      domain: [],
      backlink: [],
      serp: [],
      brand: [],
      prompt: [],
      keyword: [],
      rankRun: [],
    };
    for (let index = 0; index < 30; index += 1) {
      const timestamp = `2026-06-30 15:${String(index).padStart(2, "0")}:00`;
      const domainId = randomUUID();
      const backlinkId = randomUUID();
      const serpId = randomUUID();
      const brandId = randomUUID();
      const promptId = randomUUID();
      const keywordId = randomUUID();
      const rankRunId = randomUUID();
      insertedHistoryIds.domain.push(domainId);
      insertedHistoryIds.backlink.push(backlinkId);
      insertedHistoryIds.serp.push(serpId);
      insertedHistoryIds.brand.push(brandId);
      insertedHistoryIds.prompt.push(promptId);
      insertedHistoryIds.keyword.push(keywordId);
      insertedHistoryIds.rankRun.push(rankRunId);
      insertDomainSnapshot.run(domainId, project.id, `domain-history-${index}.example`, timestamp);
      insertBacklinkSnapshot.run(backlinkId, project.id, `backlink-history-${index}.example`, timestamp);
      insertSerpRun.run(serpId, project.id, `serp history ${index}`, timestamp);
      insertBrandRun.run(brandId, project.id, `Brand history ${index}`, timestamp);
      insertPromptRun.run(promptId, project.id, `Prompt history ${index}`, timestamp);
      insertSavedKeyword.run(keywordId, project.id, `smoke history keyword ${index}`, timestamp);
      insertRankRun.run(rankRunId, trackerId, timestamp, timestamp);
    }
    const domainHistoryRows = await request(`/api/sites/${project.id}/domain-snapshots`);
    const backlinkHistoryRows = await request(`/api/sites/${project.id}/backlink-snapshots`);
    for (const row of [...domainHistoryRows, ...backlinkHistoryRows]) {
      if ("target" in row || "project_id" in row || "result_json" in row || "target" in (row.result || {})) {
        throw new Error(`Organic/backlink history should expose domain/site fields, not target/project internals: ${JSON.stringify(row)}`);
      }
      if (!row.domain) {
        throw new Error(`Organic/backlink history row should expose the checked domain: ${JSON.stringify(row)}`);
      }
    }
    const historyChecks = [
      { ids: insertedHistoryIds.domain, rows: domainHistoryRows, label: "organic research" },
      { ids: insertedHistoryIds.backlink, rows: backlinkHistoryRows, label: "backlink" },
      { ids: insertedHistoryIds.serp, rows: await request(`/api/sites/${project.id}/serp`), label: "SERP" },
      { ids: insertedHistoryIds.brand, rows: await request(`/api/sites/${project.id}/brand-lookup`), label: "brand lookup" },
      { ids: insertedHistoryIds.prompt, rows: await request(`/api/sites/${project.id}/prompt-explorer`), label: "prompt explorer" },
    ];
    for (const check of historyChecks) {
      const rowIds = new Set((check.rows || []).map((row: any) => row.id));
      for (const id of check.ids) {
        if (!rowIds.has(id)) {
          throw new Error(`${check.label} history should show every saved local row until the user deletes it.`);
        }
      }
    }
    const siteSummaryWithFullHistory = await request(`/api/sites/${project.id}`);
    if (!siteSummaryWithFullHistory.site || "project" in siteSummaryWithFullHistory) {
      throw new Error(`Site summary response should expose site, not project: ${JSON.stringify(siteSummaryWithFullHistory)}`);
    }
    for (const row of [
      ...(siteSummaryWithFullHistory.serpRuns || []),
      ...(siteSummaryWithFullHistory.brandLookupRuns || []),
    ]) {
      if ("target" in (row.result || {}) || "targetPosition" in (row.result || {}) || "resolvedTarget" in (row.result || {})) {
        throw new Error(`Site summary SERP/AI rows should expose domain/entity fields: ${JSON.stringify(row)}`);
      }
      if ((row.result?.rows || []).some((resultRow: any) => "isTarget" in resultRow)) {
        throw new Error(`SERP history rows should expose isDomain, not isTarget: ${JSON.stringify(row)}`);
      }
      if ((row.result?.shareOfVoice || []).some((resultRow: any) => "target" in resultRow)) {
        throw new Error(`AI visibility history rows should expose isPrimary, not target: ${JSON.stringify(row)}`);
      }
    }
    for (const row of [
      ...(siteSummaryWithFullHistory.domainSnapshots || []),
      ...(siteSummaryWithFullHistory.backlinkSnapshots || []),
    ]) {
      if ("target" in row || "project_id" in row || "target" in (row.result || {})) {
        throw new Error(`Site summary organic/backlink rows should expose domain/site fields: ${JSON.stringify(row)}`);
      }
    }
    const summaryChecks = [
      { ids: insertedHistoryIds.keyword, rows: siteSummaryWithFullHistory.savedKeywords, label: "saved keyword summary" },
      { ids: insertedHistoryIds.domain, rows: siteSummaryWithFullHistory.domainSnapshots, label: "organic summary" },
      { ids: insertedHistoryIds.backlink, rows: siteSummaryWithFullHistory.backlinkSnapshots, label: "backlink summary" },
    ];
    for (const check of summaryChecks) {
      const rowIds = new Set((check.rows || []).map((row: any) => row.id));
      for (const id of check.ids) {
        if (!rowIds.has(id)) {
          throw new Error(`${check.label} should expose every saved local row until the user deletes it.`);
        }
      }
    }
    const trackerRows = await request(`/api/sites/${project.id}/rank-trackers`);
    const smokeTracker = (trackerRows || []).find((row: any) => row.id === trackerId);
    const rankRunIds = new Set((smokeTracker?.runs || []).map((row: any) => row.id));
    for (const id of insertedHistoryIds.rankRun) {
      if (!rankRunIds.has(id)) {
        throw new Error("Rank tracker history should expose every saved local run until the user deletes it.");
      }
    }
  } finally {
    localHistoryDb.close();
  }
  const audit = await request("/api/audits", {
    method: "POST",
    body: JSON.stringify({ siteId: project.id, url: "https://example.com" }),
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
  const otherHistorySite = await request("/api/sites", {
    method: "POST",
    body: JSON.stringify({ name: "Other History Site", domain: "other-history.example" }),
  });
  const otherHistoryAudit = await request("/api/audits", {
    method: "POST",
    body: JSON.stringify({ siteId: otherHistorySite.id, url: "https://other-history.example" }),
  });
  const allSavedAudits = await request("/api/audits");
  const allSavedAuditIds = new Set((allSavedAudits || []).map((row: any) => row.id));
  for (const id of [siteScan.audit.id, audit.id, otherHistoryAudit.id]) {
    if (!allSavedAuditIds.has(id)) {
      throw new Error("Global scan ledger should show every saved scan across sites until the user deletes it.");
    }
  }
  if (!allSavedAudits.some((row: any) => row.id === otherHistoryAudit.id && row.site_name === "Other History Site")) {
    throw new Error("Global scan ledger should include the saved site name for each scan.");
  }
  if (allSavedAudits.some((row: any) => "project_id" in row || "project_name" in row || "project_domain" in row)) {
    throw new Error(`Public scan ledger should expose site fields, not project fields: ${JSON.stringify(allSavedAudits[0])}`);
  }
  const scanHistoryDb = new Database(serverDbPath);
  try {
    const insertAudit = scanHistoryDb.prepare(`
      INSERT INTO audits (id, site_id, url, status, score, pages_crawled, issue_count, result_json, created_at, updated_at)
      VALUES (?, ?, ?, 'completed', 88, 1, 0, '{}', ?, ?)
    `);
    const insertedAuditIds: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      const id = randomUUID();
      const timestamp = `2026-06-30 12:0${index}:00`;
      insertedAuditIds.push(id);
      insertAudit.run(id, project.id, `https://example.com/history-${index}`, timestamp, timestamp);
    }
    const dashboardWithFullHistory = await request(`/api/dashboard?siteId=${project.id}`);
    const dashboardAuditIds = new Set((dashboardWithFullHistory.latestAudits || []).map((row: any) => row.id));
    for (const id of [siteScan.audit.id, audit.id, ...insertedAuditIds]) {
      if (!dashboardAuditIds.has(id)) {
        throw new Error("Dashboard scan history should include every saved scan until the user deletes it.");
      }
    }
    const dashboardLedgerIds = new Set((dashboardWithFullHistory.allAudits || []).map((row: any) => row.id));
    if (!dashboardLedgerIds.has(otherHistoryAudit.id)) {
      throw new Error("Dashboard should expose the full local scan ledger, including scans for other saved sites.");
    }
  } finally {
    scanHistoryDb.close();
  }
  await request(`/api/gsc/status/${project.id}`);
  const fullCsvRows = Array.from(
    { length: 5025 },
    (_, index) => `seo query ${index + 1},1,2,50%,${(index % 10) + 1}`,
  ).join("\n");
  const fullGscImport = await request("/api/gsc/import", {
    method: "POST",
    body: JSON.stringify({
      siteId: project.id,
      siteUrl: "sc-domain:example.com",
      sourceName: "full-search-console.csv",
      csv: `Top queries,Clicks,Impressions,CTR,Position\n${fullCsvRows}\n`,
    }),
  });
  if (
    fullGscImport.rowCount !== 5025 ||
    fullGscImport.rows?.length !== 5025 ||
    fullGscImport.totals?.clicks !== 5025 ||
    fullGscImport.totals?.impressions !== 10050 ||
    fullGscImport.siteId !== project.id ||
    "projectId" in fullGscImport
  ) {
    throw new Error(`GSC CSV import silently dropped rows: ${JSON.stringify({
      rowCount: fullGscImport.rowCount,
      returnedRows: fullGscImport.rows?.length,
      totals: fullGscImport.totals,
      siteId: fullGscImport.siteId,
      projectId: fullGscImport.projectId,
    })}`);
  }
  const gscImport = await request("/api/gsc/import", {
    method: "POST",
    body: JSON.stringify({
      siteId: project.id,
      siteUrl: "sc-domain:example.com",
      sourceName: "search-console.csv",
      csv: "Top queries,Clicks,Impressions,CTR,Position\nseo software,10,100,10%,3.2\nlocal seo,5,50,10%,4.8\n",
    }),
  });
  if (gscImport.rowCount !== 2 || gscImport.totals?.clicks !== 15 || gscImport.totals?.impressions !== 150) {
    throw new Error(`GSC CSV import totals were not normalized: ${JSON.stringify(gscImport)}`);
  }
  const gscOrderDb = new Database(serverDbPath);
  try {
    gscOrderDb
      .query("UPDATE gsc_imports SET created_at = '2030-01-01 00:00:00' WHERE id = ?")
      .run(gscImport.id);
  } finally {
    gscOrderDb.close();
  }
  const gscImports = await request(`/api/gsc/imports/${project.id}`);
  if (!gscImports.length || gscImports[0].id !== gscImport.id || !gscImports.some((row: any) => row.id === fullGscImport.id)) {
    throw new Error("GSC import was not persisted in SQLite.");
  }
  if (gscImports.some((row: any) => row.projectId || row.siteId !== project.id)) {
    throw new Error(`GSC import history should expose siteId, not projectId: ${JSON.stringify(gscImports[0])}`);
  }
  const gscHistoryDb = new Database(serverDbPath);
  try {
    const insertGscImport = gscHistoryDb.prepare(`
      INSERT INTO gsc_imports
        (id, site_id, site_url, source_name, dimensions_json, row_count, totals_json, rows_json, created_at)
      VALUES (?, ?, 'sc-domain:example.com', ?, '["query"]', 1, '{"clicks":1,"impressions":2}', '[]', ?)
    `);
    const insertedGscImportIds: string[] = [];
    for (let index = 0; index < 25; index += 1) {
      const id = randomUUID();
      const timestamp = `2026-06-30 14:${String(index).padStart(2, "0")}:00`;
      insertedGscImportIds.push(id);
      insertGscImport.run(id, project.id, `search-console-${index}.csv`, timestamp);
    }
    const allGscImports = await request(`/api/gsc/imports/${project.id}`);
    const allGscImportIds = new Set((allGscImports || []).map((row: any) => row.id));
    for (const id of [gscImport.id, ...insertedGscImportIds]) {
      if (!allGscImportIds.has(id)) {
        throw new Error("Search Console import history should show every local CSV import until the user deletes it.");
      }
    }
  } finally {
    gscHistoryDb.close();
  }
  const dashboardWithGsc = await request(`/api/dashboard?siteId=${project.id}`);
  if (dashboardWithGsc.gscImportCount !== 27 || dashboardWithGsc.latestGscImport?.rowCount !== 2) {
    throw new Error(`Dashboard did not expose local GSC import evidence: ${JSON.stringify(dashboardWithGsc.latestGscImport)}`);
  }
  const mcp = await request("/mcp", {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  const mcpWhoami = await request("/mcp", {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 150, method: "tools/call", params: { name: "whoami", arguments: {} } }),
  });
  if (
    mcpWhoami.result?.structuredContent?.hosting !== "local" ||
    "cloudflare" in (mcpWhoami.result?.structuredContent || {})
  ) {
    throw new Error(`MCP whoami should identify local hosting without Cloudflare fields: ${JSON.stringify(mcpWhoami)}`);
  }
  const toolNames = new Set((mcp.result?.tools || []).map((tool: any) => tool.name));
  if (
    !dashboardWithGsc.activeSite ||
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
  if (!/saved scan plan/i.test(scanSiteTool?.description || "")) {
    throw new Error(`MCP scan_site should describe that it uses the saved scan plan: ${scanSiteTool?.description}`);
  }
  for (const legacyName of ["list_projects", "create_project", "get_project_summary"]) {
    if (toolNames.has(legacyName)) {
      throw new Error(`MCP tools/list should not advertise legacy alias ${legacyName}.`);
    }
  }
  const legacyMcp = await request("/mcp", {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 199, method: "tools/call", params: { name: "list_projects", arguments: {} } }),
  });
  if (!legacyMcp.error || !/Unknown tool/i.test(String(legacyMcp.error.message || ""))) {
    throw new Error(`MCP legacy list_projects alias should be unavailable: ${JSON.stringify(legacyMcp)}`);
  }
  const legacyDescriptionTool = (mcp.result?.tools || []).find((tool: any) =>
    /^Legacy alias:/i.test(tool.description || "") || /workspace|target domain|project|selected-site/i.test(tool.description || ""),
  );
  if (legacyDescriptionTool) {
    throw new Error(`MCP tools/list should not advertise legacy project/workspace/selected-site copy: ${legacyDescriptionTool.name}`);
  }
  const projectRequiredTool = (mcp.result?.tools || []).find((tool: any) => tool.inputSchema?.required?.includes("projectId"));
  if (projectRequiredTool) {
    throw new Error(`MCP tools/list still requires projectId: ${projectRequiredTool.name}`);
  }
  const projectPropertyTool = (mcp.result?.tools || []).find((tool: any) => tool.inputSchema?.properties?.projectId);
  if (projectPropertyTool) {
    throw new Error(`MCP tools/list still exposes projectId: ${projectPropertyTool.name}`);
  }
  const targetRequiredTool = (mcp.result?.tools || []).find((tool: any) => tool.inputSchema?.required?.includes("target"));
  if (targetRequiredTool) {
    throw new Error(`MCP tools/list still requires target instead of domain: ${targetRequiredTool.name}`);
  }
  const targetPropertyTool = (mcp.result?.tools || []).find((tool: any) => tool.inputSchema?.properties?.target);
  if (targetPropertyTool) {
    throw new Error(`MCP tools/list still exposes target instead of domain: ${targetPropertyTool.name}`);
  }
  for (const [name, requiredInput] of [
    ["get_domain_overview", "domain"],
    ["get_backlinks_overview", "domain"],
    ["get_backlinks_profile", "domain"],
  ] as const) {
    const tool = (mcp.result?.tools || []).find((row: any) => row.name === name);
    if (!tool?.inputSchema?.required?.includes(requiredInput)) {
      throw new Error(`MCP ${name} should require ${requiredInput}.`);
    }
  }
  const mcpDomainOverview = await request("/mcp", {
    method: "POST",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "get_domain_overview",
        arguments: { siteId: project.id, domain: "example.com" },
      },
    }),
  });
  if (
    mcpDomainOverview.error ||
    mcpDomainOverview.result?.structuredContent?.domain !== "example.com" ||
    "target" in (mcpDomainOverview.result?.structuredContent || {})
  ) {
    throw new Error(`MCP get_domain_overview should accept and return domain fields: ${JSON.stringify(mcpDomainOverview)}`);
  }
  const mcpSerpAnalysis = await request("/mcp", {
    method: "POST",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 202,
      method: "tools/call",
      params: {
        name: "analyze_serp",
        arguments: { siteId: project.id, keyword: "seo software", domain: "example.com" },
      },
    }),
  });
  const mcpSerp = mcpSerpAnalysis.result?.structuredContent || {};
  if (
    mcpSerpAnalysis.error ||
    mcpSerp.domain !== "example.com" ||
    "target" in mcpSerp ||
    "targetPosition" in mcpSerp ||
    mcpSerp.rows?.some((row: any) => "isTarget" in row)
  ) {
    throw new Error(`MCP analyze_serp should expose domain fields, not target fields: ${JSON.stringify(mcpSerpAnalysis)}`);
  }
  const mcpKeywordResearch = await request("/mcp", {
    method: "POST",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 201,
      method: "tools/call",
      params: {
        name: "research_keywords",
        arguments: { siteId: project.id, query: "seo software", limit: 5 },
      },
    }),
  });
  if (mcpKeywordResearch.error || !Array.isArray(mcpKeywordResearch.result?.structuredContent?.rows)) {
    throw new Error(`MCP research_keywords should return structured keyword rows: ${JSON.stringify(mcpKeywordResearch)}`);
  }
  for (const [label, response] of [
    ["scan_site", localMcpScan],
    ["get_domain_overview", mcpDomainOverview],
    ["research_keywords", mcpKeywordResearch],
  ] as const) {
    const structured = response.result?.structuredContent || {};
    const serialized = JSON.stringify(structured);
    if (/"project(?:Id|_id|_name|_domain)"/.test(serialized)) {
      throw new Error(`MCP ${label} structured output should expose site identifiers, not project identifiers: ${serialized}`);
    }
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
