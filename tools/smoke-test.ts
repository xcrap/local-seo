import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";

const rootDir = new URL("..", import.meta.url).pathname;
const tempDir = await mkdtemp(path.join(os.tmpdir(), "local-seo-smoke-"));
const dbFileName = "local-seo.sqlite";
const scopeDbDir = path.join(tempDir, "scope");
process.env.DB_PATH = scopeDbDir;
process.env.CODEX_MODEL = "";
process.env.CODEX_REASONING_EFFORT = "";

const { sameSiteUrl } = await import("../src/seo");
const { resourceFailureKind } = await import("../src/scans");
const { fetchWithRedirectTrace } = await import("../src/http");
const { codexModel, codexReasoningEffort } = await import("../src/config");
const { DEFAULT_KEYWORD_LANGUAGE_CODE, DEFAULT_KEYWORD_LOCATION_CODE } = await import("../src/defaults");
if (codexModel() !== "") {
  throw new Error("Codex should use the local CLI default model unless an override is configured.");
}
if (codexReasoningEffort() !== "medium") {
  throw new Error("Codex reasoning should default to medium.");
}
if (!sameSiteUrl("https://www.example.com/about/", "https://example.com")) {
  throw new Error("Root and www variants should share scan scope.");
}
if (!sameSiteUrl("https://example.com/about/", "https://www.example.com")) {
  throw new Error("www and root variants should share scan scope.");
}
if (sameSiteUrl("https://blog.example.com/", "https://example.com")) {
  throw new Error("Unrelated subdomains must not share scan scope.");
}
if (resourceFailureKind("unable to verify the first certificate") !== "tls-certificate") {
  throw new Error("TLS certificate verification failures must stay distinct from broken HTTP links.");
}
const port = 4131 + Math.floor(Math.random() * 400);
const baseUrl = `http://127.0.0.1:${port}`;
const serverDbDir = path.join(tempDir, "smoke");
const serverDbPath = path.join(serverDbDir, dbFileName);
const cookieJar = new Map<string, string>();
let fixtureUrl = "";
let fixtureRevision = 1;
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
            <base href="${fixtureUrl}/base/">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>Short</title>
            <style>.inline-bg { background-image: url("/missing-inline-bg.png"); }</style>
            <link rel="stylesheet" href="/missing.css">
            <link rel="stylesheet" href="/style.css">
            <script src="/missing.js"></script>
          </head>
          <body>
            <h1>Fixture SEO Scan</h1>
	            <p>This local fixture intentionally includes broken scan signals so smoke tests can verify real crawler evidence.</p>
	            <img alt="Missing source example">
	            <img src="/broken-image.png">
	            <img src="/text-image.png" alt="photo" width="820" height="460">
	            <img src="/wrong-extension.jpg" alt="Wrong extension sample" width="820" height="460" loading="lazy" srcset="/wrong-extension.jpg 1x">
	            <img src="/linked-image.jpg" alt="CSS sized thumbnail" class="w-14 h-14 rounded" loading="lazy">
	            <picture>
	              <source srcset="/picture.webp 1x, http:// 2x" type="image/webp">
	              <img alt="Picture without fallback" width="900" height="500">
	            </picture>
	            <div class="inline-bg">Inline background image check</div>
	            <a href="/missing-page">Broken fixture link</a>
	            <a href="base-target">Document base target</a>
	            <a href="/forbidden-html">Forbidden HTML without noindex</a>
	            <a href="/cdn-cgi/l/email-protection#abc123">Protected email helper</a>
	            <a href="/linked-image.jpg">Linked image should not be a page</a>
	            <a href="/query-page/?cat=5">Parameterized category 5</a>
	            <a href="/query-page/?cat=6">Parameterized category 6</a>
              <a href="/redirect-one">Redirect target first reference</a>
              <a href="/redirect-one">Redirect target second reference</a>
              <a href="/redirect-chain-start">Redirect chain</a>
              <a href="/redirect-missing">Redirect to missing page</a>
              <a href="/normalise">Normalisation redirect</a>
              <a href="/redirect-loop-a">Redirect loop</a>
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
          <url><loc>${fixtureUrl}/normalise</loc></url>
          ${fixtureRevision > 1 ? `<url><loc>${fixtureUrl}/base/base-target</loc></url>` : ""}
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
            <meta name="description" content="This orphan page exists only in the sitemap for local scan coverage testing.">
          </head>
          <body>
            <h1>Fixture SEO Scan</h1>
            <p>This page is indexable, sitemap-listed, and intentionally has no internal inlinks from the start page.</p>
          </body>
        </html>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
    if (url.pathname === "/base/base-target") {
      return new Response(
        `<!doctype html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="description" content="${fixtureRevision > 1 ? "This updated description verifies scan-to-scan metadata comparisons with real saved crawl evidence." : "This page verifies relative links honor the document base URL."}">
            <title>${fixtureRevision > 1 ? "Updated Document Base Target" : "Document Base Target"}</title>
            ${fixtureRevision > 1 ? '<meta name="robots" content="noindex">' : ""}
          </head>
          <body>
            <h1>${fixtureRevision > 1 ? "Updated Document Base Target" : "Document Base Target"}</h1>
            ${fixtureRevision > 1 ? "<h1>Second comparison heading</h1>" : ""}
            <p>The scanner should discover this URL through the root page base tag.</p>
            ${fixtureRevision > 1 ? "<p>This second revision adds enough real text to change the saved word-count evidence.</p>" : ""}
            <a href="/redirect-one">Redirect target from a second source page</a>
            <a href="/missing-page">Broken fixture link from a second page</a>
          </body>
        </html>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
    if (url.pathname === "/redirect-one") {
      return new Response(null, { status: 302, headers: { location: "/redirect-final" } });
    }
    if (url.pathname === "/redirect-chain-start") {
      return new Response(null, { status: 301, headers: { location: "/redirect-chain-middle" } });
    }
    if (url.pathname === "/redirect-chain-middle") {
      return new Response(null, { status: 302, headers: { location: "/redirect-final" } });
    }
    if (url.pathname === "/redirect-missing") {
      return new Response(null, { status: 301, headers: { location: "/missing-after-redirect" } });
    }
    if (url.pathname === "/normalise") {
      return new Response(null, { status: 301, headers: { location: "/normalised/" } });
    }
    if (url.pathname === "/invalid-redirect-location") {
      return new Response(null, { status: 302, headers: { location: "http://[invalid" } });
    }
    if (url.pathname === "/normalised/") {
      return new Response(
        `<!doctype html><html><head><meta charset="utf-8"><title>Normalised URL</title><meta name="description" content="The canonical destination for a harmless URL normalisation redirect."><link rel="canonical" href="${fixtureUrl}/normalised/"></head><body><h1>Normalised URL</h1><p>This final page should remain indexable after its redirect source resolves.</p></body></html>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
    const longChainMatch = /^\/long-chain\/(\d+)$/.exec(url.pathname);
    if (longChainMatch) {
      const hop = Number(longChainMatch[1]);
      if (hop < 10) {
        return new Response(null, { status: 302, headers: { location: `/long-chain/${hop + 1}` } });
      }
      return new Response("done", { headers: { "content-type": "text/plain" } });
    }
    if (url.pathname === "/redirect-loop-a") {
      return new Response(null, { status: 302, headers: { location: "/redirect-loop-b" } });
    }
    if (url.pathname === "/redirect-loop-b") {
      return new Response(null, { status: 302, headers: { location: "/redirect-loop-a" } });
    }
    if (url.pathname === "/redirect-final") {
      return new Response(
        `<!doctype html><html><head><meta charset="utf-8"><title>Redirect Destination</title><meta name="description" content="The final destination used to verify redirect status, chains, and link blast radius."><link rel="canonical" href="${fixtureUrl}/redirect-final"></head><body><h1>Redirect Destination</h1><p>This final page resolves after the fixture redirect.</p></body></html>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
    if (url.pathname === "/forbidden-html") {
      return new Response(
        `<!doctype html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="description" content="This page returns HTTP 403 but does not declare a robots noindex directive.">
            <title>Forbidden HTML</title>
          </head>
          <body>
            <h1>Forbidden HTML</h1>
            <p>The scan should report the HTTP error without inventing a noindex directive.</p>
          </body>
        </html>`,
        { status: 403, headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
    if (url.pathname === "/query-page/") {
      return new Response(
        `<!doctype html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="description" content="This page verifies parameterized URLs collapse into a single crawled page.">
            <title>Query Page</title>
          </head>
          <body>
            <h1>Query Page</h1>
            <p>Different query strings should not inflate the main page crawl count.</p>
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
    if (url.pathname === "/linked-image.jpg") {
      return new Response("jpeg-ish", { headers: { "content-type": "image/jpeg", "content-length": "8" } });
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
const exactRedirectLimit = await fetchWithRedirectTrace(`${fixtureUrl}/long-chain/0`, {}, 10);
if (exactRedirectLimit.redirectError || exactRedirectLimit.finalStatus !== 200 || exactRedirectLimit.redirectChain.length !== 10) {
  throw new Error(`Exactly ten redirect hops should resolve when the limit is ten: ${JSON.stringify(exactRedirectLimit)}`);
}
await exactRedirectLimit.response.body?.cancel().catch(() => undefined);
const exceededRedirectLimit = await fetchWithRedirectTrace(`${fixtureUrl}/long-chain/0`, {}, 9);
if (!/exceeds 9 hops/i.test(exceededRedirectLimit.redirectError) || exceededRedirectLimit.redirectChain.length !== 10) {
  throw new Error(`The redirect limit should fail only after the allowed hop count: ${JSON.stringify(exceededRedirectLimit)}`);
}
await exceededRedirectLimit.response.body?.cancel().catch(() => undefined);
const invalidRedirectLocation = await fetchWithRedirectTrace(`${fixtureUrl}/invalid-redirect-location`);
if (
  invalidRedirectLocation.redirected !== true ||
  invalidRedirectLocation.redirectChain.length !== 1 ||
  invalidRedirectLocation.redirectChain[0]?.targetUrl !== "" ||
  !/location is invalid/i.test(invalidRedirectLocation.redirectError)
) {
  throw new Error(`Invalid redirect locations must remain visible in hop evidence: ${JSON.stringify(invalidRedirectLocation)}`);
}
await invalidRedirectLocation.response.body?.cancel().catch(() => undefined);
const emptyEvidenceServer = Bun.serve({
  port: 0,
  fetch() {
    return new Response("stopped before scan");
  },
});
const emptyEvidenceUrl = `http://localhost:${emptyEvidenceServer.port}`;
emptyEvidenceServer.stop(true);
// Answers the pre-flight probe once, then dies — the crawl that follows gets
// no pages, exercising the empty-evidence (0 pages, score 0) report path.
let brokenFixtureRequests = 0;
const brokenFixtureServer = Bun.serve({
  port: 0,
  fetch() {
    brokenFixtureRequests += 1;
    if (brokenFixtureRequests === 1) {
      return new Response("<html><body>probe ok</body></html>", { headers: { "content-type": "text/html" } });
    }
    brokenFixtureServer.stop(true);
    return new Response("gone", { status: 500 });
  },
});
const brokenFixtureUrl = `http://localhost:${brokenFixtureServer.port}`;

const server = Bun.spawn([process.execPath, "src/index.ts"], {
  cwd: rootDir,
  stdout: "pipe",
  stderr: "pipe",
  env: {
    ...process.env,
    API_URL: baseUrl,
    DB_PATH: serverDbDir,
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

async function waitForScan(scanId: string) {
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    const scan = await request(`/api/scans/${scanId}`);
    if (scan?.status === "completed" || scan?.status === "failed") return scan;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Scan ${scanId} did not finish.`);
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
  const initialSites = await request("/api/sites");
  if (initialSites.length !== 0) {
    throw new Error(`Fresh setup should keep the site list empty until the user adds a real site: ${JSON.stringify(initialSites)}`);
  }
  const schemaDb = new Database(serverDbPath, { readonly: true });
  try {
    const tables = new Set(schemaDb.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
    if (!tables.has("sites")) {
      throw new Error(`Fresh SQLite schema should create sites: ${JSON.stringify([...tables].sort())}`);
    }
    if (tables.has("schema_migrations")) {
      throw new Error("Fresh SQLite schema should be final-state tables, not a migration ledger.");
    }
    const siteColumns = schemaDb.query<{ name: string }, []>("PRAGMA table_info(sites)").all().map((row) => row.name);
    if (siteColumns.includes("archived_at")) {
      throw new Error("Fresh sites schema should not keep unused archive state.");
    }
    const siteIndexes = schemaDb.query<{ name: string }, []>("PRAGMA index_list(sites)").all().map((row) => row.name);
    if (siteIndexes.includes("idx_sites_active")) {
      throw new Error("Fresh sites schema should not keep the old archive index.");
    }
    if (tables.has("audits")) {
      throw new Error("Fresh SQLite schema should use scans, not audits.");
    }
    for (const table of ["saved_keywords", "keyword_metric_imports", "scans", "gsc_imports", "domain_snapshots", "organic_imports", "backlink_snapshots", "backlink_imports", "serp_runs"]) {
      const columns = schemaDb.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all().map((row) => row.name);
      if (!columns.includes("site_id")) {
        throw new Error(`Fresh SQLite table ${table} should reference site_id.`);
      }
      if (["domain_snapshots", "organic_imports", "backlink_snapshots", "serp_runs"].includes(table) && columns.includes("target")) {
        throw new Error(`Fresh SQLite table ${table} should use domain, not target.`);
      }
    }
  } finally {
    schemaDb.close();
  }
  const dbSource = await readFile(path.join(rootDir, "src/db.ts"), "utf8");
  if (/DELETE\s+FROM\s+(sites|scans|audits|gsc_imports)\b/i.test(dbSource)) {
    throw new Error("Startup database migrations must not silently delete user-owned sites, scans, or imports.");
  }
  for (const removedSchemaBridge of [
    "schema_migrations",
    "MIGRATIONS_TABLE",
    "function migrate",
    "migrateStep(",
    "idx_sites_active",
    "archived_at",
    "local-fallback",
    "ALTER TABLE audits",
    "CREATE TABLE audits",
  ]) {
    if (dbSource.includes(removedSchemaBridge)) {
      throw new Error(`Fresh app database startup should not keep compatibility code: ${removedSchemaBridge}`);
    }
  }
  const gscSource = await readFile(path.join(rootDir, "src/gsc.ts"), "utf8");
  if (gscSource.includes(".slice(0, 5000)")) {
    throw new Error("Search Console CSV imports must not silently drop rows after 5,000 entries.");
  }
  const readmeSource = await readFile(path.join(rootDir, "README.md"), "utf8");
  const viteConfigSource = await readFile(path.join(rootDir, "web/vite.config.ts"), "utf8");
  if (!viteConfigSource.includes('"^/mcp$"') || viteConfigSource.includes('"/mcp":')) {
    throw new Error("Vite should proxy the JSON-RPC /mcp endpoint exactly so MCP UI routes can refresh.");
  }
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
    throw new Error("Docs should expose free/self-hosted SERP providers.");
  }
  if (/DataForSEO|DATAFORSEO|SEO_METRICS/i.test(envExampleSource + readmeSource)) {
    throw new Error("Docs and env examples should not keep paid SEO metrics provider hooks.");
  }
  const apiServerSource = await readFile(path.join(rootDir, "src/index.ts"), "utf8");
  const mcpSource = await readFile(path.join(rootDir, "src/mcp.ts"), "utf8");
  if (mcpSource.includes("cloudflare:")) {
    throw new Error("Runtime MCP responses should not keep Cloudflare fields.");
  }
  if (/domainOrUrl|body\.domain\s*\|\|\s*body\.url/.test(apiServerSource)) {
    throw new Error("Domain APIs should require domain explicitly instead of keeping old domainOrUrl/url aliases.");
  }
  if (apiServerSource.includes("/api/audits") || apiServerSource.includes("/audits")) {
    throw new Error("Backend routes should expose scans only, with no old audit endpoint aliases.");
  }
  if (/\/api\/projects|\/projects/.test(apiServerSource)) {
    throw new Error("Backend routes should not keep project endpoints in the fresh local Sites app.");
  }
  if (mcpSource.includes('case "start_audit"') || mcpSource.includes('case "get_audit"')) {
    throw new Error("MCP runtime should not keep hidden audit-named tool aliases.");
  }
  const seoSource = await readFile(path.join(rootDir, "src/seo.ts"), "utf8");
  for (const oldScanServiceName of ["startAudit", "getAudit", "listAudits", "listAllAudits", "deleteAudit", "clearAudits", "runLocalAudit"]) {
    if (seoSource.includes(oldScanServiceName)) {
      throw new Error(`Scan service should not keep old audit-era function names: ${oldScanServiceName}`);
    }
  }
  if (/\bAudit[A-Za-z0-9_]*\b|\baudit[A-Za-z0-9_]*\b/.test(seoSource)) {
    throw new Error("Crawler service internals should use scan naming, not audit-era identifiers.");
  }
  if (/dataforseo|DataForSEO|SEO_METRICS|seo_metrics/i.test(seoSource)) {
    throw new Error("Backend SEO services should not keep paid metrics provider hooks in the fresh local app.");
  }
  for (const staleIssueWording of [
    "understand the target",
    "Update the link target",
    "redirect the target URL",
    "target returns crawlable HTML",
    "evidence: { target: candidate.url",
  ]) {
    if (seoSource.includes(staleIssueWording)) {
      throw new Error(`Scan issue copy should name the URL or link destination instead of target: ${staleIssueWording}`);
    }
  }
  if (!seoSource.includes("activeSite:") || !/^\s*sites:/m.test(seoSource)) {
    throw new Error("Dashboard API should return activeSite/sites terminology.");
  }
  if (/slice\(0,\s*5\)/.test(seoSource)) {
    throw new Error("Crawler scan issues should keep full local evidence arrays instead of five-item samples.");
  }
  if (!seoSource.includes("function searchSearxng") || !seoSource.includes("process.env.SEARXNG_URL")) {
    throw new Error("SERP/rank search should support self-hosted SearXNG before falling back to DuckDuckGo.");
  }
  const webApiClient = await readFile(path.join(rootDir, "web/src/api.ts"), "utf8");
  if (webApiClient.includes("/api/audits") || webApiClient.includes("/audits`")) {
    throw new Error("The React API client should use scan-named /api/scans endpoints.");
  }
  if (/\/api\/projects|\/projects/.test(webApiClient)) {
    throw new Error("The React API client should not keep old project endpoints.");
  }
  if (!webApiClient.includes("/api/scans") || !webApiClient.includes("/scans`")) {
    throw new Error("The React API client should call scan-named endpoints.");
  }
  const webAppSources = await Array.fromAsync(
    new Bun.Glob("web/src/**/*.{ts,tsx}").scan({ cwd: rootDir }),
    async (filePath) => readFile(path.join(rootDir, filePath), "utf8"),
  ).then((sources) => sources.join("\n"));
  if (/\bAudit[A-Za-z0-9_]*\b|\baudit[A-Za-z0-9_]*\b|\baudits\b|\bAudits\b/.test(webAppSources)) {
    throw new Error("React app internals should use scan naming, not audit-era identifiers.");
  }
  if (/DataForSEO|DATAFORSEO|seo_metrics|SEO_METRICS/.test(webAppSources)) {
    throw new Error("The React UI should not keep paid metrics provider hooks.");
  }
  if (!webAppSources.includes('path="/links"') || !(webAppSources.includes('to="/links"') || webAppSources.includes('to: "/links"'))) {
    throw new Error("The React app should expose Links at /links.");
  }
  if (!webAppSources.includes('path="/mcp-tools"') || !webAppSources.includes('to: "/mcp-tools"')) {
    throw new Error("The MCP screen should use /mcp-tools so it does not conflict with the JSON-RPC /mcp endpoint.");
  }
  if (webAppSources.includes('path="/mcp"') || webAppSources.includes('to: "/mcp"')) {
    throw new Error("The React app should not use /mcp as a UI route because /mcp is the JSON-RPC endpoint.");
  }
  if (webAppSources.includes('path="/projects"') || webAppSources.includes('to: "/projects"') || webAppSources.includes('to="/projects"')) {
    throw new Error("The React app should not expose the old /projects route or navigation.");
  }
  if (webAppSources.includes('path="/backlinks"') || webAppSources.includes('to="/backlinks"')) {
    throw new Error("The React app should not keep a /backlinks UI route or redirect.");
  }
  if (!webAppSources.includes('path="*" element={<NotFoundPage />}') || !webAppSources.includes("function NotFoundPage")) {
    throw new Error("The React app should render a not-found screen for unknown local routes.");
  }
  if (webAppSources.includes("window.location.href") || webAppSources.includes("window.location.reload")) {
    throw new Error("The app shell should use React Router/app state instead of full-page window.location route changes.");
  }
  for (const silentCapPattern of ["rows.slice(0, 350)", ".slice(0, 150)", ".slice(0, 100)", ".slice(0, 25);", "rows.slice(0, 6)", "runs.slice(0, 8)"]) {
    if (webAppSources.includes(silentCapPattern)) {
      throw new Error(`Evidence tables should not silently cap saved local rows: ${silentCapPattern}`);
    }
  }
  for (const ambiguousMetricPattern of [
    'row.searchVolume || "-"',
    "formatNumber(row.search_volume)",
    "formatNumber(row.keyword_difficulty)",
    'row.cpc ?? "-"',
  ]) {
    if (webAppSources.includes(ambiguousMetricPattern)) {
      throw new Error(`Keyword metric tables should render unavailable metrics explicitly, not with ${ambiguousMetricPattern}.`);
    }
  }
  const site = await request("/api/sites", {
    method: "POST",
    body: JSON.stringify({ name: "Smoke", domain: "example.com" }),
  });
  if (site.crawl_protocol !== "auto" || site.crawl_host !== "auto" || site.crawl_speed !== "auto" || site.crawl_max_pages !== 0) {
    throw new Error("New sites should default to automatic crawl preferences.");
  }
  const preferenceSite = await request("/api/sites", {
    method: "POST",
    body: JSON.stringify({ name: "Preference", domain: "example.org", crawlProtocol: "https", crawlHost: "www", crawlSpeed: "fast", crawlMaxPages: 120 }),
  });
  if (
    preferenceSite.crawl_protocol !== "https" ||
    preferenceSite.crawl_host !== "www" ||
    preferenceSite.crawl_speed !== "fast" ||
    preferenceSite.crawl_max_pages !== 120
  ) {
    throw new Error("Site crawl preferences were not saved on create.");
  }
  const updatedPreference = await request(`/api/sites/${preferenceSite.id}`, {
    method: "PUT",
    body: JSON.stringify({ ...preferenceSite, crawl_protocol: "both", crawl_host: "both", crawl_speed: "polite", crawl_max_pages: 400 }),
  });
  if (
    updatedPreference.crawl_protocol !== "both" ||
    updatedPreference.crawl_host !== "both" ||
    updatedPreference.crawl_speed !== "polite" ||
    updatedPreference.crawl_max_pages !== 400
  ) {
    throw new Error("Site crawl preferences were not saved on update.");
  }
  await request("/api/config", {
    method: "PUT",
    body: JSON.stringify({
      default_location_code: "2620",
      default_language_code: "pt",
      default_crawl_protocol: "https",
      default_crawl_host: "www",
      default_crawl_speed: "fast",
      default_crawl_max_pages: "250",
    }),
  });
  const rejectedSecretConfig = await requestFailure("/api/config", {
    method: "PUT",
    body: JSON.stringify({
      google_client_secret: "should-not-save-here",
    }),
  });
  if (!/App settings cannot save/i.test(String(rejectedSecretConfig.data?.error || ""))) {
    throw new Error(`App settings API should reject secret/data-source keys: ${JSON.stringify(rejectedSecretConfig)}`);
  }
  const defaultsSite = await request("/api/sites", {
    method: "POST",
    body: JSON.stringify({ name: "Configured Defaults", domain: "defaults.example" }),
  });
  if (
    defaultsSite.location_code !== 2620 ||
    defaultsSite.language_code !== "pt" ||
    defaultsSite.crawl_protocol !== "https" ||
    defaultsSite.crawl_host !== "www"
  ) {
    throw new Error(`New site did not use app defaults: ${JSON.stringify(defaultsSite)}`);
  }
  const localConfigStatus = await request("/api/config");
  if (localConfigStatus.default_crawl_speed !== "fast" || Number(localConfigStatus.default_crawl_max_pages) !== 250) {
    throw new Error(`Crawl speed defaults should round-trip through app settings: ${JSON.stringify(localConfigStatus)}`);
  }
  if (
    localConfigStatus.local_db_path !== path.resolve(serverDbPath) ||
    Number(localConfigStatus.local_site_count || 0) < 3
  ) {
    throw new Error(`Config should expose the local SQLite source of truth and counts: ${JSON.stringify(localConfigStatus)}`);
  }
  const siteScan = await request(`/api/sites/${site.id}/scan`, { method: "POST" });
  if (!siteScan.scan?.id) throw new Error("Site scan did not return a scan.");
  if ("audit" in siteScan) {
    throw new Error("Site scan response should not expose legacy audit fields.");
  }
  if (!Array.isArray(siteScan.candidateUrls) || !siteScan.candidateUrls.includes("https://example.com")) {
    throw new Error(`Site scan should return its scan-plan candidate URLs: ${JSON.stringify(siteScan)}`);
  }
  if (!siteScan.related?.some((row: any) => row.key === "technical-scan" && row.label === "Technical scan" && row.route === `/scans/${siteScan.scan.id}`) || !siteScan.related?.some((row: any) => row.key === "links" && row.label === "Links")) {
    throw new Error("Site scan did not return related report statuses.");
  }
  if (!siteScan.related?.some((row: any) => row.key === "page-speed" && row.route === `/scans/${siteScan.scan.id}?tab=speed`)) {
    throw new Error(`Site scan should return a direct speed-report follow-up: ${JSON.stringify(siteScan.related)}`);
  }
  if (!siteScan.related?.some((row: any) => row.key === "links" && row.route === "/links")) {
    throw new Error(`Site scan should send users to the Links route: ${JSON.stringify(siteScan.related)}`);
  }
  const localSite = await request("/api/sites", {
    method: "POST",
    body: JSON.stringify({ name: "Local fixture", domain: `localhost:${fixtureServer.port}`, crawlProtocol: "http", crawlHost: "root" }),
  });
  const localSiteScan = await request(`/api/sites/${localSite.id}/scan`, { method: "POST" });
  if (!localSiteScan.scan?.id) throw new Error("Local saved-site scan did not return a scan.");
  if ("audit" in localSiteScan) {
    throw new Error("Local saved-site scan response should not expose legacy audit fields.");
  }
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
      params: { name: "scan_site", arguments: { siteId: localSite.id } },
    }),
  });
  const mcpScan = localMcpScan.result?.structuredContent || {};
  if ("audit" in mcpScan) {
    throw new Error("MCP scan_site response should not expose legacy audit fields.");
  }
  const mcpScanUrl = mcpScan.scan?.url || mcpScan.scanUrl || "";
  if (!mcpScan.scan?.id || !String(mcpScanUrl).startsWith(fixtureUrl)) {
    throw new Error(`MCP site scan did not resolve through site preferences: ${mcpScanUrl}`);
  }
  if (!Array.isArray(mcpScan.candidateUrls) || mcpScan.candidateUrls[0] !== fixtureUrl) {
    throw new Error(`MCP site scan should return the saved site's scan plan: ${JSON.stringify(mcpScan.candidateUrls)}`);
  }
  const missingSite = await requestFailure("/api/sites/not-a-real-site/scan", { method: "POST" });
  if (missingSite.data?.error !== "Site not found.") {
    throw new Error(`Unexpected missing site error: ${JSON.stringify(missingSite.data)}`);
  }
  const scanResult = await waitForScan(siteScan.scan.id);
  if (!scanResult.result || scanResult.pages_crawled == null || scanResult.issue_count == null) {
    throw new Error("Site scan report was not readable.");
  }
  if (
    !Array.isArray(scanResult.result.issueGroups) ||
    !Array.isArray(scanResult.result.imageInventory) ||
    !Array.isArray(scanResult.result.linkInventory) ||
    typeof scanResult.result.summary?.checkedLinks === "undefined" ||
    typeof scanResult.result.summary?.titleLengthIssues === "undefined"
  ) {
    throw new Error("Site scan report is missing detailed SEO evidence.");
  }
  const fixtureScan = await waitForScan(localSiteScan.scan.id);
  const mcpFixtureScan = await waitForScan(mcpScan.scan.id);
  const fixturePages = Array.isArray(fixtureScan.result?.pages) ? fixtureScan.result.pages : [];
  const fixtureSummary = fixtureScan.result?.summary || {};
  const fixtureIssues = Array.isArray(fixtureScan.result?.issues) ? fixtureScan.result.issues : [];
  const fixtureLinkHrefs = new Set((fixtureScan.result?.linkInventory || []).map((link: any) => link.href));
  const fixtureParameterUrls = Array.isArray(fixtureScan.result?.parameterUrls) ? fixtureScan.result.parameterUrls : [];
  if (!fixtureLinkHrefs.has(`${fixtureUrl}/base/base-target`)) {
    throw new Error("Fixture scan should resolve relative links against the document base URL.");
  }
  if (fixtureLinkHrefs.has(`${fixtureUrl}/base-target`)) {
    throw new Error("Fixture scan resolved a base-relative link against the current page instead of the document base URL.");
  }
  if (fixtureLinkHrefs.has(`${fixtureUrl}/cdn-cgi/l/email-protection`)) {
    throw new Error("Fixture scan should ignore Cloudflare email-protection helper URLs.");
  }
  if (!fixtureLinkHrefs.has(`${fixtureUrl}/linked-image.jpg`)) {
    throw new Error("Fixture scan should keep linked images in link evidence.");
  }
  if (fixturePages.some((page: any) => page.url === `${fixtureUrl}/linked-image.jpg`)) {
    throw new Error("Fixture scan must not count linked images as crawl pages.");
  }
  if (!fixtureLinkHrefs.has(`${fixtureUrl}/query-page/?cat=5`) || !fixtureLinkHrefs.has(`${fixtureUrl}/query-page/?cat=6`)) {
    throw new Error("Fixture scan should keep parameterized URLs in link evidence.");
  }
  if (!fixtureParameterUrls.some((row: any) => row.url === `${fixtureUrl}/query-page/?cat=5` && row.crawlUrl === `${fixtureUrl}/query-page/`)) {
    throw new Error("Fixture scan should store parameterized URL evidence with the clean crawl target.");
  }
  if (!fixturePages.some((page: any) => page.url === `${fixtureUrl}/query-page/`)) {
    throw new Error("Fixture scan should crawl the clean page target for parameterized links.");
  }
  if (fixturePages.some((page: any) => String(page.url).includes("?cat="))) {
    throw new Error("Fixture scan must not count query variants as separate pages.");
  }
  if (fixtureSummary.parameterUrls < 2 || fixtureSummary.parameterUrlTargets < 1) {
    throw new Error(`Fixture scan should summarize parameterized URL variants: ${JSON.stringify(fixtureSummary)}`);
  }
  if (!fixtureIssues.some((issue: any) => issue.url === `${fixtureUrl}/forbidden-html` && issue.type === "page-http-error")) {
    throw new Error("Fixture scan should preserve HTTP error evidence for forbidden HTML pages.");
  }
  if (fixtureIssues.some((issue: any) => issue.url === `${fixtureUrl}/forbidden-html` && issue.type === "noindex")) {
    throw new Error("Fixture scan must not report noindex without an actual robots noindex directive.");
  }
  const indexableRows = fixturePages.filter((page: any) => page.indexable === true).length;
  const nonIndexableRows = fixturePages.filter((page: any) => page.indexable === false).length;
  const unknownIndexabilityRows = fixturePages.filter((page: any) => typeof page.indexable !== "boolean").length;
  if (
    fixtureSummary.indexablePages !== indexableRows ||
    fixtureSummary.nonIndexablePages !== nonIndexableRows ||
    fixtureSummary.unknownIndexabilityPages !== unknownIndexabilityRows ||
    indexableRows + nonIndexableRows + unknownIndexabilityRows !== fixturePages.length
  ) {
    throw new Error("Fixture scan indexability summary does not match page-level evidence.");
  }
  if (fixtureScan.result?.scanVersion !== 2) {
    throw new Error("Fresh scans must identify the crawl semantics used for safe scan-to-scan comparisons.");
  }
  const redirectPage = fixturePages.find((page: any) => page.url === `${fixtureUrl}/redirect-final`);
  if (
    redirectPage?.requestedUrl !== `${fixtureUrl}/redirect-one` ||
    redirectPage?.sourceStatus !== 302 ||
    redirectPage?.status !== 200 ||
    redirectPage?.finalStatus !== 200 ||
    redirectPage?.finalUrl !== `${fixtureUrl}/redirect-final` ||
    redirectPage?.indexable !== true ||
    redirectPage?.indexabilityReason !== "indexable" ||
    redirectPage?.redirectChain?.length !== 1
  ) {
    throw new Error(`Redirect destinations must be the content page while preserving source evidence: ${JSON.stringify(redirectPage)}`);
  }
  if (fixtureIssues.some((issue: any) => issue.url === `${fixtureUrl}/redirect-one` && issue.type === "page-missing-from-sitemap")) {
    throw new Error("Redirecting source URLs must not be reported as indexable pages missing from the sitemap.");
  }
  const redirectChainIssue = fixtureIssues.find(
    (issue: any) => issue.url === `${fixtureUrl}/redirect-chain-start` && issue.type === "redirect-chain",
  );
  const redirectLoopIssue = fixtureIssues.find(
    (issue: any) => issue.url === `${fixtureUrl}/redirect-loop-a` && issue.type === "redirect-loop",
  );
  if (redirectChainIssue?.evidence?.redirectChain?.length !== 2 || !redirectLoopIssue?.evidence?.redirectChain?.length) {
    throw new Error("Fixture scan must detect redirect chains and loops with hop evidence.");
  }
  const normalisedPage = fixturePages.find((page: any) => page.url === `${fixtureUrl}/normalised/`);
  if (
    normalisedPage?.requestedUrl !== `${fixtureUrl}/normalise` ||
    normalisedPage?.sourceStatus !== 301 ||
    normalisedPage?.status !== 200 ||
    normalisedPage?.indexable !== true ||
    normalisedPage?.sitemapListed !== false ||
    normalisedPage?.sitemapSourceListed !== true
  ) {
    throw new Error(`URL normalisation redirects must resolve to one indexable content page: ${JSON.stringify(normalisedPage)}`);
  }
  if (
    fixtureIssues.some(
      (issue: any) =>
        (issue.url === `${fixtureUrl}/normalise` || issue.url === `${fixtureUrl}/normalised/`) &&
        issue.type === "noindex-page-in-sitemap",
    )
  ) {
    throw new Error("A harmless normalisation redirect must not invent a noindex sitemap problem.");
  }
  const redirectErrorPage = fixturePages.find((page: any) => page.url === `${fixtureUrl}/missing-after-redirect`);
  const redirectErrorIssue = fixtureIssues.find(
    (issue: any) => issue.url === `${fixtureUrl}/missing-after-redirect` && issue.type === "page-http-error",
  );
  if (
    redirectErrorPage?.requestedUrl !== `${fixtureUrl}/redirect-missing` ||
    redirectErrorPage?.sourceStatus !== 301 ||
    redirectErrorPage?.status !== 404 ||
    redirectErrorIssue?.evidence?.finalStatus !== 404
  ) {
    throw new Error(`Redirects to HTTP errors must use the final response status: ${JSON.stringify(redirectErrorPage)}`);
  }
  const redirectLink = (fixtureScan.result?.links || []).find((link: any) => link.url === `${fixtureUrl}/redirect-one`);
  if (
    redirectLink?.status !== 302 ||
    redirectLink?.finalStatus !== 200 ||
    redirectLink?.affectedPages !== 2 ||
    redirectLink?.referenceCount !== 3 ||
    !redirectLink?.sourcePages?.includes(`${fixtureUrl}/`) ||
    !redirectLink?.sourcePages?.includes(`${fixtureUrl}/base/base-target`)
  ) {
    throw new Error(`Redirect link blast radius should preserve targets, pages, and references: ${JSON.stringify(redirectLink)}`);
  }
  const redirectSourceIssues = fixtureIssues.filter(
    (issue: any) => issue.type === "internal-link-redirects" && issue.evidence?.linkedUrl === `${fixtureUrl}/redirect-one`,
  );
  if (redirectSourceIssues.length !== 2 || !redirectSourceIssues.every((issue: any) => issue.evidence?.affectedPages === 2)) {
    throw new Error(`Redirect findings must fan out to every affected source page: ${JSON.stringify(redirectSourceIssues)}`);
  }
  const brokenSourceIssues = fixtureIssues.filter(
    (issue: any) => issue.type === "broken-internal-link" && issue.evidence?.linkedUrl === `${fixtureUrl}/missing-page`,
  );
  if (
    brokenSourceIssues.length !== 1 ||
    brokenSourceIssues[0]?.evidence?.affectedPages !== 2 ||
    brokenSourceIssues[0]?.evidence?.totalReferences !== 2
  ) {
    throw new Error(`Broken targets should score once while retaining their full blast radius: ${JSON.stringify(brokenSourceIssues)}`);
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
    throw new Error(`Fixture scan speed summary does not match page-level response timings: ${JSON.stringify(fixtureSummary)}`);
  }
  const localOrganicPages = await request("/api/domain/pages", {
    method: "POST",
    body: JSON.stringify({ siteId: localSite.id, domain: `localhost:${fixtureServer.port}`, pageSize: 10 }),
  });
  if (
    localOrganicPages.source !== "local-scan" ||
    localOrganicPages.pages?.length !== fixturePages.length ||
    localOrganicPages.pages.some((row: any) => row.organicTraffic !== null || row.keywords !== null)
  ) {
    throw new Error(`Organic top pages should fall back to real local scan rows without generated metrics: ${JSON.stringify(localOrganicPages)}`);
  }
  let unreachableScanError = "";
  try {
    await request("/api/scans", {
      method: "POST",
      body: JSON.stringify({ siteId: localSite.id, url: emptyEvidenceUrl }),
    });
  } catch (error) {
    unreachableScanError = error instanceof Error ? error.message : String(error);
  }
  if (!unreachableScanError.includes("Could not reach")) {
    throw new Error(
      `Scans against unreachable URLs must be refused before starting: ${unreachableScanError || "the scan was accepted"}`,
    );
  }
  const emptyEvidenceScan = await request("/api/scans", {
    method: "POST",
    body: JSON.stringify({ siteId: localSite.id, url: brokenFixtureUrl }),
  });
  const emptyEvidenceResult = await waitForScan(emptyEvidenceScan.id);
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
  const fixtureIssueTypes = new Set((fixtureScan.result?.issues || []).map((issue: any) => issue.type));
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
      throw new Error(`Fixture scan did not detect ${expected}.`);
    }
  }
  const missingSrcIssue = (fixtureScan.result?.issues || []).find((issue: any) => issue.type === "image-src-missing");
  const missingSrcSamples: string[] = missingSrcIssue?.evidence?.samples || [];
  if (!missingSrcSamples.some((sample) => String(sample).includes("Missing source example"))) {
    throw new Error(`image-src-missing evidence should identify the offending image tag, got ${JSON.stringify(missingSrcSamples)}.`);
  }
  const cssSizedImage = (fixtureScan.result?.imageInventory || []).find(
    (image: any) => String(image.alt || "") === "CSS sized thumbnail",
  );
  if (cssSizedImage?.cssSized !== true || cssSizedImage.issues.includes("missing size")) {
    throw new Error("Images sized by CSS utility classes must not be flagged as missing dimensions.");
  }
  const unsizedImage = (fixtureScan.result?.imageInventory || []).find(
    (image: any) => String(image.src || "").endsWith("/broken-image.png"),
  );
  if (!unsizedImage?.issues.includes("missing size")) {
    throw new Error("Images with no attribute, inline style, or class sizing must still be flagged.");
  }
  if (!fixtureScan.result?.imageInventory?.length || !fixtureScan.result?.linkInventory?.length) {
    throw new Error("Fixture scan did not save image/link inventory.");
  }
  if (!fixtureScan.result?.summary?.cssImageResources || !fixtureScan.result?.summary?.pictureSourceImages) {
    throw new Error("Fixture scan did not check CSS image URLs and picture source URLs.");
  }
  fixtureRevision = 2;
  const comparisonScanStart = await request("/api/scans", {
    method: "POST",
    body: JSON.stringify({ siteId: localSite.id, url: fixtureUrl }),
  });
  const comparisonScan = await waitForScan(comparisonScanStart.id);
  fixtureRevision = 1;
  const comparison = comparisonScan.result?.comparison;
  if (!comparison?.available || comparison.previousScanId !== mcpFixtureScan.id) {
    throw new Error(`Completed scans must compare with the preceding saved scan: ${JSON.stringify(comparison)}`);
  }
  if (
    !comparison.newIssues?.some((issue: any) => issue.url === `${fixtureUrl}/base/base-target` && issue.type === "noindex") ||
    !comparison.fixedIssues?.some((issue: any) => issue.url === `${fixtureUrl}/base/base-target` && issue.type === "page-missing-from-sitemap")
  ) {
    throw new Error(`Scan comparison must surface new and fixed issue identities: ${JSON.stringify(comparison.summary)}`);
  }
  const comparisonPageTypes = new Set(
    (comparison.pageChanges || [])
      .filter((change: any) => change.url === `${fixtureUrl}/base/base-target`)
      .map((change: any) => change.type),
  );
  for (const expected of [
    "became-non-indexable",
    "title-changed",
    "description-changed",
    "h1-changed",
    "wordCount-changed",
    "page-added-to-sitemap",
  ]) {
    if (!comparisonPageTypes.has(expected)) {
      throw new Error(`Scan comparison did not save ${expected}: ${JSON.stringify([...comparisonPageTypes])}`);
    }
  }
  const comparisonIgnore = await request(`/api/sites/${localSite.id}/issue-ignores`, {
    method: "POST",
    body: JSON.stringify({ type: "noindex" }),
  });
  const filteredComparisonScan = await request(`/api/scans/${comparisonScan.id}`);
  if (
    (filteredComparisonScan.result?.comparison?.newIssues || []).some(
      (issue: any) => issue.type === "noindex",
    ) ||
    filteredComparisonScan.result?.comparison?.summary?.newIssues !== comparison.summary.newIssues - 1
  ) {
    throw new Error("Saved ignore rules must also filter scan-to-scan issue changes and their counts.");
  }
  await request(`/api/sites/${localSite.id}/issue-ignores/${comparisonIgnore.id}`, { method: "DELETE" });
  const initialIgnores = await request(`/api/sites/${localSite.id}/issue-ignores`);
  if (!Array.isArray(initialIgnores) || initialIgnores.length) {
    throw new Error("Fixture site should start with no saved ignore rules.");
  }
  const fixtureHighTypes = [...new Set<string>(
    (fixtureScan.result?.issues || [])
      .filter((issue: any) => issue.severity === "high")
      .map((issue: any) => String(issue.type)),
  )];
  for (const type of ["thin-content", ...fixtureHighTypes]) {
    await request(`/api/sites/${localSite.id}/issue-ignores`, {
      method: "POST",
      body: JSON.stringify({ type }),
    });
  }
  const ignoredScan = await request(`/api/scans/${fixtureScan.id}`);
  const thinIssues = (ignoredScan.result?.issues || []).filter((issue: any) => issue.type === "thin-content");
  if (!thinIssues.length || !thinIssues.every((issue: any) => issue.ignored === true)) {
    throw new Error("Ignored issues must stay saved in the report payload with an ignored flag.");
  }
  if ((ignoredScan.result?.issueGroups || []).some((group: any) => group.type === "thin-content")) {
    throw new Error("Ignored issue types must leave the grouped issue summary.");
  }
  if (ignoredScan.result?.summary?.thinPages !== 0) {
    throw new Error("Ignored issues must leave recomputed summary counts.");
  }
  if (
    !(Number(ignoredScan.ignored_issue_count) > 0) ||
    ignoredScan.issue_count + ignoredScan.ignored_issue_count !== fixtureScan.issue_count
  ) {
    throw new Error("Ignored issues must move from issue_count to ignored_issue_count.");
  }
  if (ignoredScan.score !== 100) {
    throw new Error(`Ignoring every high-severity type should lift the health score to 100, got ${ignoredScan.score}.`);
  }
  const savedIgnores = await request(`/api/sites/${localSite.id}/issue-ignores`);
  if (savedIgnores.length !== fixtureHighTypes.length + 1) {
    throw new Error("Ignore rules must be saved per site so they can be restored.");
  }
  for (const rule of savedIgnores) {
    await request(`/api/sites/${localSite.id}/issue-ignores/${rule.id}`, { method: "DELETE" });
  }
  const restoredScan = await request(`/api/scans/${fixtureScan.id}`);
  if (
    restoredScan.score !== fixtureScan.score ||
    restoredScan.issue_count !== fixtureScan.issue_count ||
    (restoredScan.result?.issues || []).some((issue: any) => issue.ignored)
  ) {
    throw new Error("Deleting ignore rules must restore the saved scan report exactly.");
  }
  const pageIgnore = await request(`/api/sites/${localSite.id}/issue-ignores`, {
    method: "POST",
    body: JSON.stringify({ url: `${fixtureUrl}/` }),
  });
  if (!pageIgnore?.id || pageIgnore.issue_type !== "") {
    throw new Error("Page-wide ignore rules must save with an empty issue type.");
  }
  const pageIgnoredScan = await request(`/api/scans/${fixtureScan.id}`);
  const ignoredPageIssues = (pageIgnoredScan.result?.issues || []).filter((issue: any) => issue.url === `${fixtureUrl}/`);
  if (!ignoredPageIssues.length || !ignoredPageIssues.every((issue: any) => issue.ignored === true)) {
    throw new Error("A page-wide ignore rule must hide every issue on that page.");
  }
  if (!(pageIgnoredScan.result?.issues || []).some((issue: any) => !issue.ignored)) {
    throw new Error("A page-wide ignore rule must not hide other pages' issues.");
  }
  await request(`/api/sites/${localSite.id}/issue-ignores/${pageIgnore.id}`, { method: "DELETE" });
  const pageRestoredScan = await request(`/api/scans/${fixtureScan.id}`);
  if (pageRestoredScan.issue_count !== fixtureScan.issue_count) {
    throw new Error("Removing a page-wide ignore rule must restore the page's issues.");
  }
  // A page-wide ignore must survive URL drift between scans: the same page can be
  // recorded with a toggled trailing slash or a redirect-appended query string
  // (e.g. ?idchain=...), so matching is by normalized page key, not the raw URL
  // string that was saved.
  const driftIgnore = await request(`/api/sites/${localSite.id}/issue-ignores`, {
    method: "POST",
    body: JSON.stringify({ url: `${fixtureUrl}?idchain=999&utm_source=drift` }),
  });
  const driftScan = await request(`/api/scans/${fixtureScan.id}`);
  const driftPageIssues = (driftScan.result?.issues || []).filter((issue: any) => issue.url === `${fixtureUrl}/`);
  if (!driftPageIssues.length || !driftPageIssues.every((issue: any) => issue.ignored === true)) {
    throw new Error("A page-wide ignore must still match after URL drift (trailing slash and appended query params).");
  }
  await request(`/api/sites/${localSite.id}/issue-ignores/${driftIgnore.id}`, { method: "DELETE" });
  // Bulk clear: a single request removes every saved ignore rule for the site.
  await request(`/api/sites/${localSite.id}/issue-ignores`, { method: "POST", body: JSON.stringify({ type: "thin-content" }) });
  await request(`/api/sites/${localSite.id}/issue-ignores`, { method: "POST", body: JSON.stringify({ url: `${fixtureUrl}/` }) });
  const clearResult = await request(`/api/sites/${localSite.id}/issue-ignores`, { method: "DELETE" });
  if (!(Number(clearResult.deleted) >= 2)) {
    throw new Error(`Clearing all ignore rules must delete every saved rule, got ${JSON.stringify(clearResult)}.`);
  }
  const afterClear = await request(`/api/sites/${localSite.id}/issue-ignores`);
  if (!Array.isArray(afterClear) || afterClear.length) {
    throw new Error("No ignore rules should remain after a bulk clear.");
  }
  await requestFailure(`/api/sites/${localSite.id}/issue-ignores`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  const mcpFixtureScanId = localMcpScan.result?.structuredContent?.scan?.id;
  if (mcpFixtureScanId) {
    await waitForScan(mcpFixtureScanId);
  }
  const fixtureScansBeforeClear = await request(`/api/sites/${localSite.id}/scans`);
  if (fixtureScansBeforeClear.length < 2) {
    throw new Error("Fixture site should have multiple scans before clear-history verification.");
  }
  const clearedFixtureScans = await request(`/api/sites/${localSite.id}/scans`, { method: "DELETE" });
  if (clearedFixtureScans.deleted < 2) {
    throw new Error(`Clear history should delete fixture scans, got ${clearedFixtureScans.deleted}.`);
  }
  const fixtureScansAfterClear = await request(`/api/sites/${localSite.id}/scans`);
  if (fixtureScansAfterClear.length !== 0) {
    throw new Error("Clear history did not remove all fixture scans from local SQLite.");
  }
  const siteScans = await request(`/api/sites/${site.id}/scans`);
  if (!siteScans.some((row: any) => row.id === siteScan.scan.id)) {
    throw new Error("Site scans endpoint did not return the scan.");
  }
  const keywordResearch = await request("/api/keywords/research", {
    method: "POST",
    body: JSON.stringify({ siteId: site.id, query: "seo software", limit: 8 }),
  });
  const keywordRows = keywordResearch.rows?.length
    ? keywordResearch.rows
    : [
        { keyword: "seo software", searchVolume: null, difficulty: null, cpc: null, intent: "manual" },
        { keyword: "seo tools", searchVolume: null, difficulty: null, cpc: null, intent: "manual" },
        { keyword: "technical seo scan", searchVolume: null, difficulty: null, cpc: null, intent: "manual" },
      ];
  await request("/api/keywords/save", {
    method: "POST",
    body: JSON.stringify({
      siteId: site.id,
      keywords: keywordRows.slice(0, 3),
      tags: ["smoke", "research"],
      source: "smoke",
    }),
  });
  const saved = await request(`/api/sites/${site.id}/keywords/query`, {
    method: "POST",
    body: JSON.stringify({ tagNames: ["smoke"], pageSize: 50 }),
  });
  if (!saved.rows?.length || !saved.tags?.length) throw new Error("Saved keyword assertions failed.");
  const keywordMetricImport = await request("/api/keywords/import-metrics", {
    method: "POST",
    body: JSON.stringify({
      siteId: site.id,
      sourceName: "keyword-metrics.csv",
      csv: [
        "keyword,search_volume,difficulty,cpc,intent",
        "seo software,1200,44,3.25,commercial",
        "local seo sqlite,90,12,1.10,informational",
      ].join("\n"),
    }),
  });
  if (
    keywordMetricImport.source !== "keyword-metrics-import" ||
    keywordMetricImport.rowCount !== 2 ||
    keywordMetricImport.insertedCount < 1 ||
    keywordMetricImport.updatedCount < 1
  ) {
    throw new Error(`Keyword metric CSV import did not save real local rows: ${JSON.stringify(keywordMetricImport)}`);
  }
  const metricImports = await request(`/api/sites/${site.id}/keyword-metric-imports`);
  if (!metricImports.some((row: any) => row.id === keywordMetricImport.id)) {
    throw new Error("Keyword metric import history was not persisted in SQLite.");
  }
  const savedWithMetrics = await request(`/api/sites/${site.id}/keywords/query`, {
    method: "POST",
    body: JSON.stringify({ search: "seo software", pageSize: 10 }),
  });
  if (
    savedWithMetrics.rows?.[0]?.search_volume !== 1200 ||
    savedWithMetrics.rows?.[0]?.difficulty !== 44 ||
    savedWithMetrics.rows?.[0]?.cpc !== 3.25 ||
    savedWithMetrics.rows?.[0]?.intent !== "commercial"
  ) {
    throw new Error(`Keyword metric import should update saved keyword metrics: ${JSON.stringify(savedWithMetrics)}`);
  }
  await request(`/api/sites/${site.id}/keywords/tags`, {
    method: "POST",
    body: JSON.stringify({ savedKeywordIds: [saved.rows[0].id], addTags: ["priority"] }),
  });
  const serpAnalysis = await request("/api/serp/analyze", {
    method: "POST",
    body: JSON.stringify({ siteId: site.id, keyword: "seo software", domain: "example.com" }),
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
    body: JSON.stringify({ siteId: site.id, domain: "example.com" }),
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
    body: JSON.stringify({ siteId: site.id, domain: "example.com", pageSize: 10 }),
  });
  const organicImport = await request("/api/domain/import", {
    method: "POST",
    body: JSON.stringify({
      siteId: site.id,
      domain: "example.com",
      sourceName: "organic-research.csv",
      csv: [
        "keyword,position,search_volume,traffic,keyword_difficulty,url,title",
        "seo software,3,1200,80,44,https://example.com/seo,SEO Software",
        "local seo sqlite,9,90,12,12,/local-seo,Local SEO SQLite",
      ].join("\n"),
    }),
  });
  if (organicImport.source !== "organic-import" || organicImport.keywordCount !== 2 || organicImport.pageCount !== 2) {
    throw new Error(`Organic import should persist real keyword and page rows: ${JSON.stringify(organicImport)}`);
  }
  const importedOrganicOverview = await request("/api/domain/overview", {
    method: "POST",
    body: JSON.stringify({ siteId: site.id, domain: "example.com" }),
  });
  if (
    importedOrganicOverview.source !== "organic-import" ||
    importedOrganicOverview.organicKeywords !== 2 ||
    importedOrganicOverview.organicTraffic !== 92
  ) {
    throw new Error(`Organic overview should use imported rows: ${JSON.stringify(importedOrganicOverview)}`);
  }
  const importedOrganicKeywords = await request("/api/domain/keywords", {
    method: "POST",
    body: JSON.stringify({ siteId: site.id, domain: "example.com", pageSize: 10 }),
  });
  if (
    importedOrganicKeywords.source !== "organic-import" ||
    importedOrganicKeywords.keywords?.length !== 2 ||
    !importedOrganicKeywords.keywords.some((row: any) => row.keyword === "seo software" && row.searchVolume === 1200)
  ) {
    throw new Error(`Organic keywords should come from imported CSV rows: ${JSON.stringify(importedOrganicKeywords)}`);
  }
  const importedOrganicPages = await request("/api/domain/pages", {
    method: "POST",
    body: JSON.stringify({ siteId: site.id, domain: "example.com", pageSize: 10 }),
  });
  if (
    importedOrganicPages.source !== "organic-import" ||
    importedOrganicPages.pages?.length !== 2 ||
    !importedOrganicPages.pages.some((row: any) => row.page === "https://example.com/seo" && row.organicTraffic === 80)
  ) {
    throw new Error(`Organic pages should come from imported CSV rows: ${JSON.stringify(importedOrganicPages)}`);
  }
  await request("/api/domain/pages", {
    method: "POST",
    body: JSON.stringify({ siteId: site.id, domain: "example.com", pageSize: 10 }),
  });
  const backlinkOverview = await request("/api/backlinks/overview", {
    method: "POST",
    body: JSON.stringify({ siteId: site.id, domain: "example.com" }),
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
  const backlinkImport = await request("/api/backlinks/import", {
    method: "POST",
    body: JSON.stringify({
      siteId: site.id,
      domain: "example.com",
      sourceName: "smoke-backlinks.csv",
      csv: [
        "source_url,target_url,referring_domain,anchor,follow,status,domain_rating,spam_score,first_seen",
        "https://ref.example/a,https://example.com/page,ref.example,Example,true,200,42,2,2026-01-01",
        "https://blog.ref/b,https://example.com/page,nofollow.example,Brand,nofollow,404,12,10,2026-01-02",
        "https://ref.example/c,https://example.com/other,ref.example,Other,dofollow,200,50,1,2026-01-03",
      ].join("\n"),
    }),
  });
  if (backlinkImport.source !== "backlink-import" || backlinkImport.rowCount !== 3 || backlinkImport.summary?.referringDomains !== 2) {
    throw new Error(`Backlink CSV import did not save real local rows: ${JSON.stringify(backlinkImport)}`);
  }
  const importedBacklinkOverview = await request("/api/backlinks/overview", {
    method: "POST",
    body: JSON.stringify({ siteId: site.id, domain: "example.com" }),
  });
  if (
    importedBacklinkOverview.source !== "backlink-import" ||
    importedBacklinkOverview.backlinks !== 3 ||
    importedBacklinkOverview.referringDomains !== 2 ||
    importedBacklinkOverview.dofollowRatio !== 67
  ) {
    throw new Error(`Backlink overview should read imported CSV rows: ${JSON.stringify(importedBacklinkOverview)}`);
  }
  const importedBacklinkRows = await request("/api/backlinks/profile", {
    method: "POST",
    body: JSON.stringify({ siteId: site.id, domain: "example.com", tab: "backlinks", pageSize: 10 }),
  });
  if (importedBacklinkRows.source !== "backlink-import" || importedBacklinkRows.rows?.length !== 3 || importedBacklinkRows.totalCount !== 3) {
    throw new Error(`Backlink rows should come from imported CSV rows: ${JSON.stringify(importedBacklinkRows)}`);
  }
  const importedReferringDomains = await request("/api/backlinks/profile", {
    method: "POST",
    body: JSON.stringify({ siteId: site.id, domain: "example.com", tab: "domains", pageSize: 10 }),
  });
  if (
    importedReferringDomains.rows?.length !== 2 ||
    !importedReferringDomains.rows.some((row: any) => row.domain === "ref.example" && row.backlinks === 2)
  ) {
    throw new Error(`Referring-domain rows should aggregate imported CSV rows: ${JSON.stringify(importedReferringDomains)}`);
  }
  const importedLinkedPages = await request("/api/backlinks/profile", {
    method: "POST",
    body: JSON.stringify({ siteId: site.id, domain: "example.com", tab: "pages", pageSize: 10 }),
  });
  if (
    importedLinkedPages.rows?.length !== 2 ||
    !importedLinkedPages.rows.some((row: any) => row.page === "https://example.com/page" && row.backlinks === 2 && row.brokenBacklinks === 1)
  ) {
    throw new Error(`Top linked pages should aggregate imported CSV rows: ${JSON.stringify(importedLinkedPages)}`);
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
  const smokeDb = new Database(serverDbPath, { readonly: true });
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
    deletionEvidence?.siteRows !== 0 ||
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
    const dashboardWithAiJobs = await request(`/api/dashboard?siteId=${site.id}`);
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
    body: JSON.stringify({ siteId: site.id, domain: "example.com", tab: "domains", pageSize: 10 }),
  });
  if (backlinkProfile.domain !== "example.com" || "target" in backlinkProfile) {
    throw new Error(`Backlink profile should expose domain, not target: ${JSON.stringify(backlinkProfile)}`);
  }
  const tracker = await request("/api/rank-trackers", {
    method: "POST",
    body: JSON.stringify({ siteId: site.id, domain: "example.com", keywords: ["seo software", "seo tools"] }),
  });
  const hydratedRankKeyword = tracker.keywords?.find((row: any) => row.keyword === "seo software");
  if (
    hydratedRankKeyword?.search_volume !== 1200 ||
    hydratedRankKeyword?.keyword_difficulty !== 44 ||
    hydratedRankKeyword?.cpc !== 3.25 ||
    !hydratedRankKeyword?.metrics_fetched_at
  ) {
    throw new Error(`New rank keywords should hydrate from imported keyword metrics: ${JSON.stringify(tracker.keywords)}`);
  }
  const syncedRankMetrics = await request(`/api/rank-trackers/${tracker.id}/sync-metrics`, { method: "POST" });
  if (syncedRankMetrics.source !== "local-keyword-metrics" || syncedRankMetrics.updated < 1) {
    throw new Error(`Rank metrics should sync from local keyword imports: ${JSON.stringify(syncedRankMetrics)}`);
  }
  await request(`/api/rank-trackers/${tracker.id}/check`, { method: "POST" });
  await request(`/api/rank-trackers/${tracker.id}/trend`);
  const brandLookupResult = await request("/api/brand-lookup", {
    method: "POST",
    body: JSON.stringify({ siteId: site.id, query: "Example", competitors: "competitor.com" }),
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
    body: JSON.stringify({ siteId: site.id, prompt: "best seo software", highlightBrand: "Example" }),
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
      .get(site.id);
    if (
      savedPromptRun?.source !== "codex" ||
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
      VALUES (?, ?, ?, 'example.com', ?, ?, 'smoke-history', '{}', ?)
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
      VALUES (?, ?, ?, ?, ?, 'manual', 'smoke-history', ?)
    `);
    const trackerId = randomUUID();
    localHistoryDb
      .prepare(`
        INSERT INTO rank_trackers (id, site_id, domain, location_code, language_code, created_at, updated_at)
        VALUES (?, ?, 'example.com', ?, ?, '2026-06-30 15:00:00', '2026-06-30 15:00:00')
      `)
      .run(trackerId, site.id, DEFAULT_KEYWORD_LOCATION_CODE, DEFAULT_KEYWORD_LANGUAGE_CODE);
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
      insertDomainSnapshot.run(domainId, site.id, `domain-history-${index}.example`, timestamp);
      insertBacklinkSnapshot.run(backlinkId, site.id, `backlink-history-${index}.example`, timestamp);
      insertSerpRun.run(serpId, site.id, `serp history ${index}`, DEFAULT_KEYWORD_LOCATION_CODE, DEFAULT_KEYWORD_LANGUAGE_CODE, timestamp);
      insertBrandRun.run(brandId, site.id, `Brand history ${index}`, timestamp);
      insertPromptRun.run(promptId, site.id, `Prompt history ${index}`, timestamp);
      insertSavedKeyword.run(keywordId, site.id, `smoke history keyword ${index}`, DEFAULT_KEYWORD_LOCATION_CODE, DEFAULT_KEYWORD_LANGUAGE_CODE, timestamp);
      insertRankRun.run(rankRunId, trackerId, timestamp, timestamp);
    }
    const domainHistoryRows = await request(`/api/sites/${site.id}/domain-snapshots`);
    const backlinkHistoryRows = await request(`/api/sites/${site.id}/backlink-snapshots`);
    for (const row of [...domainHistoryRows, ...backlinkHistoryRows]) {
      if ("target" in row || "result_json" in row || "target" in (row.result || {})) {
        throw new Error(`Organic/backlink history should expose domain/site fields, not raw internals: ${JSON.stringify(row)}`);
      }
      if (!row.domain) {
        throw new Error(`Organic/backlink history row should expose the checked domain: ${JSON.stringify(row)}`);
      }
    }
    const historyChecks = [
      { ids: insertedHistoryIds.domain, rows: domainHistoryRows, label: "organic research" },
      { ids: insertedHistoryIds.backlink, rows: backlinkHistoryRows, label: "backlink" },
      { ids: insertedHistoryIds.serp, rows: await request(`/api/sites/${site.id}/serp`), label: "SERP" },
      { ids: insertedHistoryIds.brand, rows: await request(`/api/sites/${site.id}/brand-lookup`), label: "brand lookup" },
      { ids: insertedHistoryIds.prompt, rows: await request(`/api/sites/${site.id}/prompt-explorer`), label: "prompt explorer" },
    ];
    for (const check of historyChecks) {
      const rowIds = new Set((check.rows || []).map((row: any) => row.id));
      for (const id of check.ids) {
        if (!rowIds.has(id)) {
          throw new Error(`${check.label} history should show every saved local row until the user deletes it.`);
        }
      }
    }
    const siteSummaryWithFullHistory = await request(`/api/sites/${site.id}`);
    if (!siteSummaryWithFullHistory.site) {
      throw new Error(`Site summary response should expose site: ${JSON.stringify(siteSummaryWithFullHistory)}`);
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
      if ("target" in row || "target" in (row.result || {})) {
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
    const trackerRows = await request(`/api/sites/${site.id}/rank-trackers`);
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
  const directScan = await request("/api/scans", {
    method: "POST",
    body: JSON.stringify({ siteId: site.id, url: fixtureUrl }),
  });
  await request(`/api/scans/${directScan.id}`);
  const siteScansAfterSecondScan = await request(`/api/sites/${site.id}/scans`);
  if (
    siteScansAfterSecondScan.length < 2 ||
    !siteScansAfterSecondScan.some((row: any) => row.id === siteScan.scan.id) ||
    !siteScansAfterSecondScan.some((row: any) => row.id === directScan.id)
  ) {
    throw new Error("Site scans endpoint should keep every scan for the site until the user deletes it.");
  }
  const otherHistorySite = await request("/api/sites", {
    method: "POST",
    body: JSON.stringify({ name: "Other History Site", domain: "other-history.example" }),
  });
  const otherHistoryScan = await request("/api/scans", {
    method: "POST",
    body: JSON.stringify({ siteId: otherHistorySite.id, url: fixtureUrl }),
  });
  const allSavedScans = await request("/api/scans");
  const allSavedScanIds = new Set((allSavedScans || []).map((row: any) => row.id));
  for (const id of [siteScan.scan.id, directScan.id, otherHistoryScan.id]) {
    if (!allSavedScanIds.has(id)) {
      throw new Error("Global scan ledger should show every saved scan across sites until the user deletes it.");
    }
  }
  if (!allSavedScans.some((row: any) => row.id === otherHistoryScan.id && row.site_name === "Other History Site")) {
    throw new Error("Global scan ledger should include the saved site name for each scan.");
  }
  const scanHistoryDb = new Database(serverDbPath);
  try {
    const insertScan = scanHistoryDb.prepare(`
      INSERT INTO scans (id, site_id, url, status, score, pages_crawled, issue_count, result_json, created_at, updated_at)
      VALUES (?, ?, ?, 'completed', 88, 1, 0, '{}', ?, ?)
    `);
    const insertedScanIds: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      const id = randomUUID();
      const timestamp = `2026-06-30 12:0${index}:00`;
      insertedScanIds.push(id);
      insertScan.run(id, site.id, `https://example.com/history-${index}`, timestamp, timestamp);
    }
    const dashboardWithFullHistory = await request(`/api/dashboard?siteId=${site.id}`);
    if ("latestAudits" in dashboardWithFullHistory || "allAudits" in dashboardWithFullHistory || "auditCount" in dashboardWithFullHistory) {
      throw new Error("Dashboard should expose scan-named fields, not legacy audit fields.");
    }
    const dashboardScanIds = new Set((dashboardWithFullHistory.latestScans || []).map((row: any) => row.id));
    for (const id of [siteScan.scan.id, directScan.id, ...insertedScanIds]) {
      if (!dashboardScanIds.has(id)) {
        throw new Error("Dashboard scan history should include every saved scan until the user deletes it.");
      }
    }
    const dashboardLedgerIds = new Set((dashboardWithFullHistory.allScans || []).map((row: any) => row.id));
    if (!dashboardLedgerIds.has(otherHistoryScan.id)) {
      throw new Error("Dashboard should expose the full local scan ledger, including scans for other saved sites.");
    }
  } finally {
    scanHistoryDb.close();
  }
  await request(`/api/gsc/status/${site.id}`);
  const fullCsvRows = Array.from(
    { length: 5025 },
    (_, index) => `seo query ${index + 1},1,2,50%,${(index % 10) + 1}`,
  ).join("\n");
  const fullGscImport = await request("/api/gsc/import", {
    method: "POST",
    body: JSON.stringify({
      siteId: site.id,
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
    fullGscImport.siteId !== site.id
  ) {
    throw new Error(`GSC CSV import silently dropped rows: ${JSON.stringify({
      rowCount: fullGscImport.rowCount,
      returnedRows: fullGscImport.rows?.length,
      totals: fullGscImport.totals,
      siteId: fullGscImport.siteId,
    })}`);
  }
  const gscImport = await request("/api/gsc/import", {
    method: "POST",
    body: JSON.stringify({
      siteId: site.id,
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
  const gscImports = await request(`/api/gsc/imports/${site.id}`);
  if (!gscImports.length || gscImports[0].id !== gscImport.id || !gscImports.some((row: any) => row.id === fullGscImport.id)) {
    throw new Error("GSC import was not persisted in SQLite.");
  }
  if (gscImports.some((row: any) => row.siteId !== site.id)) {
    throw new Error(`GSC import history should expose siteId: ${JSON.stringify(gscImports[0])}`);
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
      insertGscImport.run(id, site.id, `search-console-${index}.csv`, timestamp);
    }
    const allGscImports = await request(`/api/gsc/imports/${site.id}`);
    const allGscImportIds = new Set((allGscImports || []).map((row: any) => row.id));
    for (const id of [gscImport.id, ...insertedGscImportIds]) {
      if (!allGscImportIds.has(id)) {
        throw new Error("Search Console import history should show every local CSV import until the user deletes it.");
      }
    }
  } finally {
    gscHistoryDb.close();
  }
  const dashboardWithGsc = await request(`/api/dashboard?siteId=${site.id}`);
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
    !toolNames.has("start_scan") ||
    !toolNames.has("scan_site") ||
    !toolNames.has("get_scan") ||
    !toolNames.has("get_backlinks_profile") ||
    !toolNames.has("import_backlinks") ||
    !toolNames.has("import_keyword_metrics") ||
    !toolNames.has("inspect_urls")
  ) {
    throw new Error("Smoke assertions failed.");
  }
  if (toolNames.has("start_audit") || toolNames.has("get_audit")) {
    throw new Error("MCP tools/list should advertise scan-named tools, not audit-named tools.");
  }
  const startScanTool = (mcp.result?.tools || []).find((tool: any) => tool.name === "start_scan");
  if (!startScanTool?.inputSchema?.required?.includes("siteId") || !startScanTool?.inputSchema?.required?.includes("url")) {
    throw new Error("MCP start_scan should require siteId and url.");
  }
  const getScanTool = (mcp.result?.tools || []).find((tool: any) => tool.name === "get_scan");
  if (!getScanTool?.inputSchema?.required?.includes("scanId")) {
    throw new Error("MCP get_scan should require scanId.");
  }
  const scanSiteTool = (mcp.result?.tools || []).find((tool: any) => tool.name === "scan_site");
  if (!scanSiteTool?.inputSchema?.required?.includes("siteId")) {
    throw new Error("MCP scan_site should expose siteId as the required site identifier.");
  }
  if (!/saved scan plan/i.test(scanSiteTool?.description || "")) {
    throw new Error(`MCP scan_site should describe that it uses the saved scan plan: ${scanSiteTool?.description}`);
  }
  const staleDescriptionTool = (mcp.result?.tools || []).find((tool: any) =>
    /workspace|target domain|selected-site/i.test(tool.description || ""),
  );
  if (staleDescriptionTool) {
    throw new Error(`MCP tools/list should not advertise workspace/selected-site copy: ${staleDescriptionTool.name}`);
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
  const importBacklinksTool = (mcp.result?.tools || []).find((row: any) => row.name === "import_backlinks");
  if (!importBacklinksTool?.inputSchema?.required?.includes("siteId") || !importBacklinksTool?.inputSchema?.required?.includes("csv")) {
    throw new Error("MCP import_backlinks should require siteId and csv.");
  }
  const importKeywordMetricsTool = (mcp.result?.tools || []).find((row: any) => row.name === "import_keyword_metrics");
  if (!importKeywordMetricsTool?.inputSchema?.required?.includes("siteId") || !importKeywordMetricsTool?.inputSchema?.required?.includes("csv")) {
    throw new Error("MCP import_keyword_metrics should require siteId and csv.");
  }
  const importOrganicResearchTool = (mcp.result?.tools || []).find((row: any) => row.name === "import_organic_research");
  if (!importOrganicResearchTool?.inputSchema?.required?.includes("siteId") || !importOrganicResearchTool?.inputSchema?.required?.includes("csv")) {
    throw new Error("MCP import_organic_research should require siteId and csv.");
  }
  const mcpDomainOverview = await request("/mcp", {
    method: "POST",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "get_domain_overview",
        arguments: { siteId: site.id, domain: "example.com" },
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
  const mcpBacklinkImport = await request("/mcp", {
    method: "POST",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 203,
      method: "tools/call",
      params: {
        name: "import_backlinks",
        arguments: {
          siteId: site.id,
          domain: "example.com",
          sourceName: "mcp-backlinks.csv",
          csv: [
            "source_url,target_url,referring_domain,anchor,follow,status",
            "https://mcp-ref.example/link,https://example.com/mcp,mcp-ref.example,MCP,true,200",
          ].join("\n"),
        },
      },
    }),
  });
  if (
    mcpBacklinkImport.error ||
    mcpBacklinkImport.result?.structuredContent?.source !== "backlink-import" ||
    mcpBacklinkImport.result?.structuredContent?.rowCount !== 1
  ) {
    throw new Error(`MCP import_backlinks should save real imported rows: ${JSON.stringify(mcpBacklinkImport)}`);
  }
  const mcpKeywordMetricImport = await request("/mcp", {
    method: "POST",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 204,
      method: "tools/call",
      params: {
        name: "import_keyword_metrics",
        arguments: {
          siteId: site.id,
          sourceName: "mcp-keyword-metrics.csv",
          csv: [
            "keyword,search_volume,difficulty,cpc,intent",
            "mcp seo metric,70,11,0.8,informational",
          ].join("\n"),
        },
      },
    }),
  });
  if (
    mcpKeywordMetricImport.error ||
    mcpKeywordMetricImport.result?.structuredContent?.source !== "keyword-metrics-import" ||
    mcpKeywordMetricImport.result?.structuredContent?.rowCount !== 1
  ) {
    throw new Error(`MCP import_keyword_metrics should save real imported rows: ${JSON.stringify(mcpKeywordMetricImport)}`);
  }
  const mcpOrganicImport = await request("/mcp", {
    method: "POST",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 205,
      method: "tools/call",
      params: {
        name: "import_organic_research",
        arguments: {
          siteId: site.id,
          domain: "example.com",
          sourceName: "mcp-organic.csv",
          csv: [
            "keyword,position,search_volume,traffic,url",
            "mcp organic keyword,4,300,22,https://example.com/mcp-organic",
          ].join("\n"),
        },
      },
    }),
  });
  if (
    mcpOrganicImport.error ||
    mcpOrganicImport.result?.structuredContent?.source !== "organic-import" ||
    mcpOrganicImport.result?.structuredContent?.keywordCount !== 1
  ) {
    throw new Error(`MCP import_organic_research should save real imported rows: ${JSON.stringify(mcpOrganicImport)}`);
  }
  const mcpSerpAnalysis = await request("/mcp", {
    method: "POST",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 202,
      method: "tools/call",
      params: {
        name: "analyze_serp",
        arguments: { siteId: site.id, keyword: "seo software", domain: "example.com" },
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
        arguments: { siteId: site.id, query: "seo software", limit: 5 },
      },
    }),
  });
  if (mcpKeywordResearch.error || !Array.isArray(mcpKeywordResearch.result?.structuredContent?.rows)) {
    throw new Error(`MCP research_keywords should return structured keyword rows: ${JSON.stringify(mcpKeywordResearch)}`);
  }
  const mcpGsc = await request("/mcp", {
    method: "POST",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "get_gsc_performance",
        arguments: { siteId: site.id, startDate: "2026-01-01", endDate: "2026-01-31", dimensions: ["query"] },
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
  brokenFixtureServer.stop(true);
  await rm(tempDir, { recursive: true, force: true });
}
