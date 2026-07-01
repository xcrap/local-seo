import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const rootDir = new URL("..", import.meta.url).pathname;
const tempDir = await mkdtemp(path.join(os.tmpdir(), "local-seo-ui-"));
const apiPort = 4510 + Math.floor(Math.random() * 300);
const webPort = apiPort + 700;
const webUrl = `http://127.0.0.1:${webPort}`;
let fixtureUrl = "";

const fixtureServer = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/about/" || url.pathname === "/styles.css") {
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    if (url.pathname === "/") {
      return new Response(
        `<!doctype html>
        <html lang="en">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>Fixture Local SEO Site</title>
            <meta name="description" content="A local UI smoke fixture for technical SEO scan workflow verification.">
            <link rel="canonical" href="${fixtureUrl}/">
            <link rel="stylesheet" href="/styles.css">
            <script defer src="/app.js"></script>
          </head>
          <body>
            <h1>Fixture Local SEO Site</h1>
            <main>
              <p>This page gives the UI test real crawl evidence without touching external sites.</p>
              <img src="/hero.png" alt="Fixture hero" width="960" height="540">
              <a href="/about/">About</a>
              <a href="/missing-page">Broken page</a>
            </main>
          </body>
        </html>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
    if (url.pathname === "/about/") {
      return new Response(
        `<!doctype html>
        <html lang="en">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>About Fixture Local SEO Site</title>
            <meta name="description" content="About page for the local UI smoke fixture.">
            <link rel="canonical" href="${fixtureUrl}/about/">
          </head>
          <body>
            <h1>About Fixture</h1>
            <a href="/">Home</a>
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
          <url><loc>${fixtureUrl}/about/</loc></url>
        </urlset>`,
        { headers: { "content-type": "application/xml; charset=utf-8" } },
      );
    }
    if (url.pathname === "/styles.css") {
      return new Response(".hero{background-image:url('/bg.png')}", {
        headers: { "content-type": "text/css; charset=utf-8" },
      });
    }
    if (url.pathname === "/app.js") {
      return new Response("window.fixture=true;", {
        headers: { "content-type": "application/javascript; charset=utf-8" },
      });
    }
    if (url.pathname === "/hero.png" || url.pathname === "/bg.png") {
      return new Response("png", { headers: { "content-type": "image/png", "content-length": "3" } });
    }
    return new Response("missing", { status: 404, headers: { "content-type": "text/plain" } });
  },
});
fixtureUrl = `http://localhost:${fixtureServer.port}`;

const api = Bun.spawn([process.execPath, "src/index.ts"], {
  cwd: rootDir,
  stdout: "pipe",
  stderr: "pipe",
  env: {
    ...process.env,
    PORT: String(apiPort),
    DB_PATH: path.join(tempDir, "ui.sqlite"),
    AUTH_SESSION_SECRET: "ui-smoke-secret-000000000000000000000",
    SEO_METRICS_API_KEY: "",
  },
});

const web = Bun.spawn([process.execPath, "x", "vite", "--host", "127.0.0.1", "--port", String(webPort)], {
  cwd: path.join(rootDir, "web"),
  stdout: "pipe",
  stderr: "pipe",
  env: {
    ...process.env,
    WEB_PORT: String(webPort),
    VITE_API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
  },
});

async function waitFor(url: string, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function cleanup() {
  web.kill();
  api.kill();
  await Promise.allSettled([web.exited, api.exited]);
  fixtureServer.stop(true);
  await rm(tempDir, { recursive: true, force: true });
}

try {
  await waitFor(`http://127.0.0.1:${apiPort}/api/auth/me`);
  await waitFor(webUrl);

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await page.goto(webUrl, { waitUntil: "networkidle" });
    await page.getByLabel("Email").fill("admin@example.com");
    await page.getByLabel("Password").fill("local-password-123");
    await page.getByRole("button", { name: /Create admin/i }).click();

    await page.getByRole("heading", { name: /Start with a site scan/i }).waitFor();
    await page.getByLabel("Website address").fill(`localhost:${fixtureServer.port}`);
    await page.getByLabel("Site name").fill("Fixture Site");
    await page.getByText("Scan protocol").waitFor();
    await page.getByText("Host variant").waitFor();
    await page.getByText("Scan plan preview").waitFor();
    await page.getByText(fixtureUrl).first().waitFor();
    await page.getByRole("button", { name: /Add site and scan/i }).click();

    await page.getByRole("heading", { name: /Audit report/i }).waitFor({ timeout: 20_000 });
    await page.getByRole("heading", { name: /Scan progress/i }).waitFor();
    if (await page.getByRole("heading", { name: /^Audit health$/ }).count()) {
      throw new Error("A running first scan should open on progress before the health overview.");
    }
    await page.getByRole("tab", { name: /^Overview$/ }).click();
    await page.getByRole("heading", { name: /^Audit health$/ }).waitFor();
    if (await page.getByRole("heading", { name: /^Audit snapshot$/ }).count()) {
      throw new Error("Overview should not duplicate the audit snapshot table.");
    }
    await page.getByRole("tab", { name: /^Progress$/ }).click();
    await page.getByRole("heading", { name: /Scan progress/i }).waitFor();
    await page.getByText("Resolve start URL").waitFor();
    await page.getByText("Read robots and sitemap").waitFor();
    await page.getByText("Crawl pages").waitFor();
    await page.getByText("Check links").waitFor();
    await page.getByText("Check images").waitFor();
    await page.getByText("Check CSS/JS").waitFor();
    await page.getByText("Build report").waitFor();
    await page.getByText("completed").first().waitFor({ timeout: 60_000 });
    await page.getByRole("tab", { name: /^Overview$/ }).click();
    await page.getByRole("row", { name: /Resources.*image URLs checked/i }).waitFor();
    await page.getByRole("tab", { name: /^Issues$/ }).click();
    await page.getByRole("heading", { name: /^Priority work queue$/ }).waitFor();
    await page.getByRole("columnheader", { name: /^Recommended fix$/ }).waitFor();
	    await page.getByRole("button", { name: /Show \d+ issues/i }).first().click();
	    await page.getByText(/Issue results/i).waitFor();
	    await page.getByText(/Showing \d+ of \d+ saved issues for/i).waitFor();
	    const issueResultsTable = page.locator("table").last();
	    const issueResultsTableBox = await issueResultsTable.boundingBox();
	    const issueResultsViewport = page.viewportSize();
	    if (
	      !issueResultsTableBox ||
	      !issueResultsViewport ||
	      issueResultsTableBox.x + issueResultsTableBox.width > issueResultsViewport.width
	    ) {
	      throw new Error(`Issue results table should fit the viewport, got ${JSON.stringify(issueResultsTableBox)} in ${JSON.stringify(issueResultsViewport)}.`);
	    }
	    await page.getByRole("button", { name: /Clear filters/i }).waitFor();
	    await page.getByRole("button", { name: /Clear filters/i }).click();
	    await page.getByRole("columnheader", { name: /^Fix$/ }).waitFor();
	    await page.getByRole("columnheader", { name: /^Evidence$/ }).waitFor();
    await page.getByRole("tab", { name: /^Overview$/ }).click();
    await page.getByRole("tab", { name: /^Images$/ }).click();
    await page.getByText("Image tag inventory").waitFor();
    await page.getByRole("tab", { name: /^Speed$/ }).click();
    await page.getByRole("heading", { name: /^Page speed evidence$/ }).waitFor();
    await page.getByRole("heading", { name: /^Page response timings$/ }).waitFor();
    await page.getByRole("row", { name: /about.*ms/i }).waitFor();
    await page.getByRole("heading", { name: /^Performance issues$/ }).waitFor();
    await page.getByRole("tab", { name: /^Overview$/ }).click();
    await page.getByRole("tab", { name: /^Checks$/ }).click();
    await page.getByRole("heading", { name: /^Audit checks$/ }).waitFor();
    await page.getByRole("columnheader", { name: /^Issue types$/ }).waitFor();
    const clearAuditCheckRow = page.getByRole("row").filter({ hasText: "No issues" }).first();
    await clearAuditCheckRow.waitFor();
    if (await clearAuditCheckRow.getByRole("button", { name: /Show \d+ issues/i }).count()) {
      throw new Error("Clear audit checks should not expose an issue-opening button.");
    }
    await page.getByRole("row", { name: /Broken links/i }).getByRole("button", { name: /Show \d+ issues/i }).click();
    await page.getByText("Showing Broken links").waitFor();
    await page.getByRole("tab", { name: /^Overview$/ }).click();
    await page.getByRole("tab", { name: /^Robots\/Sitemap$/ }).click();
    await page.getByRole("heading", { name: /^Robots and sitemap evidence$/ }).waitFor();
    await page.getByRole("heading", { name: /^Sitemap files$/ }).waitFor();
    await page.getByRole("heading", { name: /^Crawl coverage$/ }).waitFor();
    await page.getByRole("cell", { name: /sitemap\.xml/i }).last().waitFor();
    await page.getByRole("tab", { name: /^Overview$/ }).click();
    await page.getByRole("heading", { name: /^Audit health$/ }).waitFor();
    await page.getByRole("row", { name: /Resources.*image URLs checked/i }).waitFor();
    await page.getByRole("row", { name: /Page speed.*average response/i }).waitFor();
    if (await page.getByText("0 chars").count()) {
      throw new Error("Audit report still shows standalone 0 chars badges.");
    }

    await page.goto(webUrl, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: /Site control/i }).waitFor();
    await page.getByText("Scan plan").first().waitFor();
    await page.getByText(/2 crawl URLs/i).first().waitFor();
    await page.getByText(fixtureUrl).first().waitFor();
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: new RegExp(`Fixture Site.*localhost:${fixtureServer.port}.*2 crawl URLs`, "i") }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("row", { name: /Active site.*Scan website/i }).getByRole("button", { name: /Scan website/i }).click();
    await page.getByRole("heading", { name: /Audit report/i }).waitFor({ timeout: 20_000 });
    await page.getByText("completed").first().waitFor({ timeout: 60_000 });

    await page.goto(webUrl, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: /Site control/i }).waitFor();
    await page.getByText("Technical audit").waitFor();
    await page.getByRole("row", { name: /Active site.*Scan website/i }).waitFor();
    if (await page.getByText("Workspace totals").count()) {
      throw new Error("Overview still renders the old metric-card totals section.");
    }
    if (await page.getByText(/workspace/i).count()) {
      throw new Error("Main site flow still exposes workspace wording.");
    }
    if (await page.getByText(/\b2840\b/).count()) {
      throw new Error("Main site flow exposes a raw location code.");
    }
    await page.getByText(/Keyword tools:/i).waitFor();
    if (await page.getByText(/Search defaults|Search locale/i).count()) {
      throw new Error("Overview still presents keyword tool defaults as site search defaults or a site locale.");
    }
    const siteControl = page.locator("section", { hasText: "Site control" });
    await siteControl.getByRole("link", { name: /^Open organic$/ }).waitFor();
    await siteControl.getByRole("link", { name: /^Open links$/ }).waitFor();
    await siteControl.getByRole("link", { name: /^Open ranks$/ }).waitFor();
    await siteControl.getByRole("link", { name: /^Open Search Console$/ }).waitFor();
    await siteControl.getByRole("link", { name: /^Open AI lab$/ }).waitFor();

    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.getByRole("navigation").getByRole("link", { name: /^Organic research$/ }).click();
    await page.getByRole("heading", { name: /^Organic research$/ }).waitFor();
    await page.getByLabel("Saved scan for page evidence").waitFor();
    await page.getByText(/saved scans? available for this site/i).first().waitFor();
    const localCrawlPagesSection = page.locator("section").filter({ hasText: "Local crawl pages" }).first();
    const localCrawlPagesBox = await localCrawlPagesSection.boundingBox();
    if (!localCrawlPagesBox || localCrawlPagesBox.width < 1000) {
      throw new Error(`Organic crawl evidence should use the full desktop width, got ${localCrawlPagesBox?.width}.`);
    }
    await page.getByLabel("Organic research site").waitFor();
    await page.getByRole("button", { name: /^Analyze organic site$/ }).click();
    await page.getByText("External ranked-keyword dataset unavailable").waitFor();
    await page.getByRole("tab", { name: /^Snapshot$/ }).click();
    await page.getByRole("heading", { name: /^Snapshot$/ }).waitFor();
    const organicKeywordsRow = await page.getByRole("row", { name: /Organic keywords/i }).textContent();
    const normalizedOrganicKeywordsRow = (organicKeywordsRow || "").replace(/\s+/g, " ").trim();
    if (!normalizedOrganicKeywordsRow.includes("Not available")) {
      throw new Error(`Missing organic metric should render as unavailable, got: ${normalizedOrganicKeywordsRow}`);
    }
    if (/Organic keywords 0\b/.test(normalizedOrganicKeywordsRow)) {
      throw new Error("Missing organic metric rendered as a measured zero.");
    }

    await page.getByRole("navigation").getByRole("link", { name: /^Links$/ }).click();
    await page.getByRole("heading", { name: /^Links$/ }).waitFor();
    if (!page.url().includes("/links") || page.url().includes("/backlinks")) {
      throw new Error(`Links navigation should use /links only, got ${page.url()}.`);
    }
    await page.getByRole("heading", { name: /^Local link graph$/ }).waitFor();
    await page.getByLabel("Saved scan for link evidence").waitFor();
    await page.getByText(/saved scans? available for this site/i).first().waitFor();
    const localLinkGraphSection = page.locator("section").filter({ hasText: "Local link graph" }).first();
    const localLinkGraphBox = await localLinkGraphSection.boundingBox();
    if (!localLinkGraphBox || localLinkGraphBox.width < 1000) {
      throw new Error(`Local link graph should use the full desktop width, got ${localLinkGraphBox?.width}.`);
    }
    await page.getByText("External backlink index", { exact: true }).waitFor();
    await page.getByRole("button", { name: /Backlink index not connected/i }).waitFor();
    await page.getByText("No web-wide backlink rows are generated locally").waitFor();
    await page.goto(`${webUrl}/backlinks`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: /^Page not found$/ }).waitFor();
    await page.getByRole("link", { name: /^Open overview$/ }).click();
    await page.getByRole("heading", { name: /Site control/i }).waitFor();

    const gscCsvPath = path.join(tempDir, "search-console-ui.csv");
    await writeFile(
      gscCsvPath,
      "Top queries,Clicks,Impressions,CTR,Position\nfixture seo,12,120,10%,2.4\nlocal crawler,3,30,10%,5.2\n",
    );
    await page.getByRole("navigation").getByRole("link", { name: /^Search Console$/ }).click();
    await page.getByRole("heading", { name: /^Search Console$/ }).waitFor();
    await page.getByRole("tab", { name: /^URL inspection$/ }).click();
    if (await page.getByPlaceholder("https://example.com/page").inputValue() !== `${fixtureUrl}/`) {
      throw new Error("Search Console inspection URL did not use the active site's saved crawl URL.");
    }
    await page.getByRole("tab", { name: /^Local import$/ }).click();
    await page.getByLabel("CSV file").setInputFiles(gscCsvPath);
    await page.getByRole("cell", { name: "search-console-ui.csv", exact: true }).waitFor();
    await page.getByRole("tab", { name: /^Performance$/ }).click();
    await page.getByRole("cell", { name: "fixture seo" }).waitFor();
    await page.getByRole("cell", { name: "local crawler" }).waitFor();
    await page.getByRole("navigation").getByRole("link", { name: /^Overview$/ }).click();
    await page.getByRole("heading", { name: /Site control/i }).waitFor();
    await page.getByRole("row", { name: /Search Console/i }).getByText("local import").waitFor();
    await page.getByRole("row", { name: /Search Console/i }).getByText(/CSV imports/i).waitFor();
    if (await page.getByText("local OAuth").count()) {
      throw new Error("Overview still labels Search Console as local OAuth.");
    }

    await page.getByRole("link", { name: /Sites/i }).click();
    await page.getByRole("heading", { name: /^Sites$/ }).waitFor();
    await page.getByText("A site is one saved website address").waitFor();
    await page.getByRole("columnheader", { name: /Scan plan/i }).waitFor();
    if (await page.getByRole("columnheader", { name: /^Keyword\/rank defaults$/ }).count()) {
      throw new Error("Sites table should not show keyword defaults as a primary site column.");
    }
    await page.getByText(/2 crawl URLs/i).first().waitFor();
    if (await page.getByText(/First scan target/i).count()) {
      throw new Error("Sites flow still exposes the old first-target wording.");
    }
    if (await page.getByText(/tries \d+ targets/i).count()) {
      throw new Error("Sites flow still hides the scan plan behind tries-targets wording.");
    }
    if (await page.getByText(/target candidates|Resolve target/i).count()) {
      throw new Error("Sites flow still exposes crawl setup as vague scan targets.");
    }
    await page.getByRole("button", { name: /Scan Fixture Site/i }).waitFor();
    await page.getByRole("button", { name: /Delete Fixture Site/i }).waitFor();
    await page.getByRole("button", { name: /Edit Fixture Site/i }).click();
    await page.getByRole("heading", { name: /Edit site/i }).waitFor();
    await page.getByText("Scan protocol").waitFor();
    await page.getByText("Host variant").waitFor();
    await page.getByRole("dialog", { name: /Edit site/i }).getByText("Scan plan preview").waitFor();
    await page.getByRole("dialog", { name: /Edit site/i }).getByText(fixtureUrl).waitFor();
    await page.keyboard.press("Escape");

    await page.getByRole("navigation").getByRole("link", { name: /^Audits$/ }).click();
    await page.getByRole("heading", { name: /^Page speed tracking$/ }).waitFor();
    await page.getByText(/Latest avg .*ms/i).waitFor();
    await page.getByRole("columnheader", { name: /^P95$/ }).waitFor();
    await page.getByRole("heading", { name: /^All scan history$/ }).waitFor();
    await page.getByRole("button", { name: /Delete scan/i }).first().waitFor();
    await page.getByRole("button", { name: /^Delete scans for this site$/ }).click();
    await page.getByRole("heading", { name: /^Delete scans for this site\?$/ }).waitFor();
    await page.getByRole("button", { name: /^Delete scans for this site$/ }).click();
    await page.getByText("No scan report yet").waitFor();
    await page.getByRole("button", { name: /^Scan site now$/ }).first().waitFor();
    await page.getByText("No audits yet").waitFor();
    await page.getByRole("button", { name: /^Scan site now$/ }).first().click();
    await page.getByText("Scan running").waitFor({ timeout: 5000 });
    await page.locator("section", { hasText: "Scan running" }).getByText(/pages crawled/i).first().waitFor();
    await page.getByRole("link", { name: /Open live report/i }).waitFor();
    await page.getByText("completed").first().waitFor({ timeout: 60_000 });

    await page.getByRole("navigation").getByRole("link", { name: /^MCP$/ }).click();
    await page.getByRole("heading", { name: /^MCP$/ }).waitFor();
    await page.getByRole("columnheader", { name: /^Inputs$/i }).first().waitFor();
    await page.getByRole("cell", { name: "scan_site" }).waitFor();
    if (await page.getByText(/\bprojectId\b/).count()) {
      throw new Error("MCP page exposes legacy projectId wording.");
    }
    if (await page.getByText("list_projects").count()) {
      throw new Error("MCP page exposes legacy list_projects alias.");
    }
    if (await page.getByText(/workspace/i).count()) {
      throw new Error("MCP page exposes workspace wording.");
    }
    if (await page.getByText(/\btarget\b/i).count()) {
      throw new Error("MCP page exposes target wording instead of domain/site/url inputs.");
    }
    await page.getByRole("row", { name: /analyze_serp.*domain/i }).waitFor();
    await page.getByRole("row", { name: /get_domain_overview.*domain/i }).waitFor();
    await page.getByRole("row", { name: /get_backlinks_profile.*domain/i }).waitFor();
    await page.goto(`${webUrl}/mcp-tools`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: /^MCP$/ }).waitFor();
    if (page.url().endsWith("/mcp")) {
      throw new Error("MCP UI should not use the JSON-RPC endpoint route.");
    }

    await page.getByRole("navigation").getByRole("link", { name: /^AI lab$/ }).click();
    await page.getByRole("heading", { name: /^AI lab$/ }).waitFor();
    await page.getByRole("heading", { name: /^Jobs$/ }).waitFor();
    await page.getByRole("heading", { name: /^Job output$/ }).waitFor();
    await page.getByText("Saved local Codex runs from SQLite.").waitFor();
    await page.getByText("Start or select a local Codex job to read the complete output here.").waitFor();

    await page.getByRole("navigation").getByRole("link", { name: /^Prompt explorer$/ }).click();
    await page.getByRole("heading", { name: /^Prompt explorer$/ }).waitFor();
    await page.getByRole("row", { name: /Local runner.*Local Codex/i }).waitFor();
    await page.getByRole("row", { name: /Reasoning.*Medium/i }).waitFor();
    if (await page.getByLabel(/chat gpt/i).count()) {
      throw new Error("Prompt explorer should not expose external model checkboxes in local Codex mode.");
    }

    await page.getByRole("navigation").getByRole("link", { name: /^Settings$/ }).click();
    await page.getByRole("heading", { name: /^App settings$/ }).waitFor();
    await page.getByRole("heading", { name: /^Data sources$/ }).waitFor();
    await page.getByRole("columnheader", { name: /^Evidence$/ }).waitFor();
    await page.getByRole("row", { name: /Local SQLite database.*Source of truth/i }).waitFor();
    await page.getByRole("row", { name: /SERP and rank checks.*DuckDuckGo.*OpenSERP.*SearXNG/i }).waitFor();
    if (await page.getByText(/API key|ENV|Environment variables/i).count()) {
      throw new Error("Settings page exposes secret/env configuration copy.");
    }
    await page.getByPlaceholder("Codex CLI default").waitFor();
    if (await page.locator('input[value="gpt-5.5"]').count()) {
      throw new Error("Settings page should not force a hard-coded Codex model override.");
    }
    const appPreferences = page.locator("section", { hasText: "App preferences" });
    await appPreferences.getByText("Default scan protocol").waitFor();
    await appPreferences.getByText("Default host variant").waitFor();
    await appPreferences.getByRole("combobox").nth(0).click();
    await page.getByRole("option", { name: "Portugal" }).click();
    await appPreferences.getByRole("combobox").nth(1).click();
    await page.getByRole("option", { name: "Portuguese" }).click();
    await appPreferences.getByRole("combobox").nth(2).click();
    await page.getByRole("option", { name: "HTTPS only" }).click();
    await appPreferences.getByRole("combobox").nth(3).click();
    await page.getByRole("option", { name: "With www" }).click();
    await Promise.all([
      page.waitForResponse((response) => response.url().includes("/api/config") && response.request().method() === "PUT"),
      page.getByRole("button", { name: /^Save app settings$/ }).click(),
    ]);

    await page.getByRole("navigation").getByRole("link", { name: /^Sites$/ }).click();
    await page.getByRole("heading", { name: /^Sites$/ }).waitFor();
    await page.getByRole("button", { name: /^Add site$/ }).click();
    const addSiteDialog = page.getByRole("dialog", { name: /^Add site$/ });
    await addSiteDialog.getByText("Keyword tool defaults").waitFor();
    await addSiteDialog.getByText("Audits crawl every page language they find.").waitFor();
    await addSiteDialog.getByText("Portugal · Portuguese").waitFor();
    await addSiteDialog.getByRole("button", { name: /Keyword tool defaults/i }).click();
    await addSiteDialog.getByText("Market").waitFor();
    await addSiteDialog.getByText("Result language").waitFor();
    await addSiteDialog.locator("[data-slot='select-value']").filter({ hasText: "Portugal" }).first().waitFor();
    await addSiteDialog.locator("[data-slot='select-value']").filter({ hasText: "Portuguese" }).first().waitFor();
    await addSiteDialog.locator("[data-slot='select-value']").filter({ hasText: "HTTPS only" }).first().waitFor();
    await addSiteDialog.locator("[data-slot='select-value']").filter({ hasText: "With www" }).first().waitFor();
    await addSiteDialog.getByLabel("Website address").fill("second.test");
    await addSiteDialog.getByText("Scan plan preview").waitFor();
    await addSiteDialog.getByText("https://www.second.test").waitFor();
    await Promise.all([
      page.waitForResponse((response) => response.url().includes("/api/sites") && response.request().method() === "POST"),
      addSiteDialog.getByRole("button", { name: /^Save site only$/ }).click(),
    ]);
    await page.getByRole("navigation").getByRole("link", { name: /^Organic research$/ }).click();
    await page.getByLabel("Organic research site").waitFor();
    if (await page.getByLabel("Organic research site").inputValue() !== "second.test") {
      throw new Error("Organic research domain field did not follow the newly active site.");
    }
    await page.getByRole("navigation").getByRole("link", { name: /^Links$/ }).click();
    await page.getByLabel("Backlink index site").waitFor();
    if (await page.getByLabel("Backlink index site").inputValue() !== "second.test") {
      throw new Error("Links domain field did not follow the newly active site.");
    }
    await page.getByRole("navigation").getByRole("link", { name: /^SERP analysis$/ }).click();
    await page.getByLabel("SERP ownership site").waitFor();
    if (await page.getByLabel("SERP ownership site").inputValue() !== "second.test") {
      throw new Error("SERP ownership site did not follow the newly active site.");
    }
  } finally {
    await browser.close();
  }
  console.log("UI smoke test passed.");
} finally {
  await cleanup();
}

export {};
