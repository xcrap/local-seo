import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const rootDir = new URL("..", import.meta.url).pathname;
const tempDir = await mkdtemp(path.join(os.tmpdir(), "local-seo-ui-"));
const apiPort = 4510 + Math.floor(Math.random() * 300);
const webPort = apiPort + 700;
const webUrl = `http://127.0.0.1:${webPort}`;
const screenshotDir = process.env.SCREENSHOT_DIR || "";
let fixtureUrl = "";
let scanReportPath = "";

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

async function assertNoHorizontalOverflow(page: any, label: string) {
  const widths = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  if (widths.document > widths.viewport + 2 || widths.body > widths.viewport + 2) {
    throw new Error(`${label} should not create page-level horizontal scroll: ${JSON.stringify(widths)}.`);
  }
}

async function capture(page: any, label: string) {
  if (!screenshotDir) return;
  await mkdir(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, `${label}.png`), fullPage: true });
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
    await page.getByText("One local admin account for this install.").waitFor();
    await page.getByText("SQLite is the source of truth on this machine.").waitFor();
    await page.getByText("No hosted auth service is required.").waitFor();
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

    await page.getByRole("heading", { name: /Scan report/i }).waitFor({ timeout: 20_000 });
    scanReportPath = new URL(page.url()).pathname;
    if (!scanReportPath.startsWith("/scans/")) {
      throw new Error(`First scan should open on the /scans route, got ${scanReportPath}.`);
    }
    await page.getByRole("heading", { name: /Scan progress/i }).waitFor();
    if (await page.getByRole("heading", { name: /^Scan health$/ }).count()) {
      throw new Error("A running first scan should open on progress before the health overview.");
    }
    await page.getByRole("tab", { name: /^Overview$/ }).click();
    await page.getByRole("heading", { name: /^Live scan progress$|^Scan health$/ }).waitFor();
    if (await page.getByRole("heading", { name: /^Live scan progress$/ }).count()) {
      await page.getByText("The final health score appears after the crawl, resource checks, and report build finish.").waitFor();
      if (await page.getByText(/\bscore\b/i).filter({ hasText: /% live|running/ }).count()) {
        throw new Error("Running scan overview should show live progress instead of final-score wording.");
      }
    }
    await capture(page, "scan-report-overview");
    if (await page.getByRole("heading", { name: /^Audit snapshot$/ }).count()) {
      throw new Error("Overview should not duplicate the old audit snapshot table.");
    }
    await page.getByRole("tab", { name: /^Progress$/ }).click();
    await page.getByRole("heading", { name: /Scan progress/i }).waitFor();
    await capture(page, "scan-report-progress");
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
    await page.getByRole("heading", { name: /^Scan checks$/ }).waitFor();
    await capture(page, "scan-report-checks");
    await page.getByRole("columnheader", { name: /^Issue types$/ }).waitFor();
    const clearScanCheckRow = page.getByRole("row").filter({ hasText: "No issues" }).first();
    await clearScanCheckRow.waitFor();
    if (await clearScanCheckRow.getByRole("button", { name: /Show \d+ issues/i }).count()) {
      throw new Error("Clear scan checks should not expose an issue-opening button.");
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
    await page.getByRole("heading", { name: /^Scan health$/ }).waitFor();
    await page.getByRole("row", { name: /Resources.*image URLs checked/i }).waitFor();
    await page.getByRole("row", { name: /Page speed.*average response/i }).waitFor();
    if (await page.getByText("0 chars").count()) {
      throw new Error("Scan report still shows standalone 0 chars badges.");
    }

    await page.goto(webUrl, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: /Site control/i }).waitFor();
    await capture(page, "overview");
    const visibleOverviewScanPlan = await page.getByText("Scan plan", { exact: true }).evaluateAll((nodes) =>
      nodes.some((node) => {
        const element = node as HTMLElement;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }),
    );
    if (!visibleOverviewScanPlan) {
      throw new Error("Overview should show visible scan-plan evidence.");
    }
    await page.getByText(/2 crawl URLs/i).first().waitFor();
    await page.getByText(fixtureUrl).first().waitFor();
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: new RegExp(`Fixture Site.*localhost:${fixtureServer.port}.*2 crawl URLs`, "i") }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("row", { name: /Active site.*Scan website/i }).getByRole("button", { name: /Scan website/i }).click();
    await page.getByRole("heading", { name: /Scan report/i }).waitFor({ timeout: 20_000 });
    await page.getByText("completed").first().waitFor({ timeout: 60_000 });

    await page.goto(webUrl, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: /Site control/i }).waitFor();
    await page.getByRole("row", { name: /Technical scan/i }).waitFor();
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
    const siteControl = page.locator("section", { hasText: "Site control" });
    await siteControl.getByRole("row", { name: /Active site.*Keyword tools:/i }).waitFor();
    await siteControl.getByRole("row", { name: /Page speed.*Timing measured.*pages timed/i }).waitFor();
    await siteControl.getByRole("row", { name: /Links.*Local graph ready/i }).waitFor();
    await siteControl.getByRole("row", { name: /Rank tracking.*Manual checks/i }).waitFor();
    await siteControl.getByRole("row", { name: /Search Console.*Ready for import/i }).waitFor();
    await siteControl.getByRole("row", { name: /AI lab.*Ready for Codex/i }).waitFor();
    if (await page.getByText(/Search defaults|Search locale/i).count()) {
      throw new Error("Overview still presents keyword tool defaults as site search defaults or a site locale.");
    }
    if (await siteControl.getByText(/has keywords|has jobs|needs scan|not run/i).count() || await siteControl.getByText("manual", { exact: true }).count()) {
      throw new Error("Overview still exposes vague internal status labels.");
    }
    await siteControl.getByRole("link", { name: /^Open site scans$/ }).waitFor();
    await siteControl.getByRole("link", { name: /^Open speed report$/ }).waitFor();
    await siteControl.getByRole("link", { name: /^Open organic research$/ }).waitFor();
    await siteControl.getByRole("link", { name: /^Open local link graph$/ }).waitFor();
    await siteControl.getByRole("link", { name: /^Open rank tracking$/ }).waitFor();
    await siteControl.getByRole("link", { name: /^Open Search Console$/ }).waitFor();
    await siteControl.getByRole("link", { name: /^Open AI lab$/ }).waitFor();
    await siteControl.getByRole("link", { name: /^Open speed report$/ }).click();
    await page.getByRole("heading", { name: /^Page speed evidence$/ }).waitFor();
    if (!new URL(page.url()).searchParams.has("tab") || new URL(page.url()).searchParams.get("tab") !== "speed") {
      throw new Error(`Open speed report should deep-link to the speed tab, got ${page.url()}.`);
    }
    await page.goto(webUrl, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: /Site control/i }).waitFor();

    await page.setViewportSize({ width: 1280, height: 820 });
    const desktopNavigation = page.getByRole("navigation").first();
    const signOutButton = page.getByRole("button", { name: /^Sign out$/ });
    const desktopNavigationBox = await desktopNavigation.boundingBox();
    const signOutBox = await signOutButton.boundingBox();
    if (!desktopNavigationBox || !signOutBox || desktopNavigationBox.y + desktopNavigationBox.height > signOutBox.y) {
      throw new Error(`Desktop sidebar navigation overlaps sign out: nav=${JSON.stringify(desktopNavigationBox)} signOut=${JSON.stringify(signOutBox)}.`);
    }
    await desktopNavigation.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await desktopNavigation.getByRole("link", { name: /^Settings$/ }).waitFor();
    await desktopNavigation.evaluate((element) => { element.scrollTop = 0; });

    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.getByRole("navigation").getByRole("link", { name: /^Keywords$/ }).click();
    await page.getByRole("heading", { name: /^Keyword research$/ }).waitFor();
    await page.getByLabel("Seed keyword").waitFor();
    await page.getByLabel("Suggestion limit").waitFor();
    await page.getByRole("navigation").getByRole("link", { name: /^Saved keywords$/ }).click();
    await page.getByRole("heading", { name: /^Saved keywords$/ }).waitFor();
    await page.getByLabel("Search keywords").waitFor();
    await page.getByText("Tag filter").waitFor();
    await page.getByLabel("Import metrics CSV").waitFor();
    const keywordMetricsCsvPath = path.join(tempDir, "keyword-metrics-ui.csv");
    await writeFile(
      keywordMetricsCsvPath,
      [
        "keyword,search_volume,difficulty,cpc,intent",
        "fixture imported keyword,55,8,0.4,informational",
        "fixture seo,1400,33,2.2,commercial",
      ].join("\n"),
    );
    await page.getByLabel("Import metrics CSV").setInputFiles(keywordMetricsCsvPath);
    await page.getByText(/Imported 2 keyword metric rows/i).waitFor();
    await page.getByLabel("Search keywords").fill("fixture imported keyword");
    await page.getByRole("button", { name: /^Apply$/ }).click();
    await page.getByRole("row", { name: /fixture imported keyword.*55.*8.*0\.4.*informational/i }).waitFor();
    await page.getByRole("heading", { name: /^Keyword metric imports$/ }).waitFor();
    await page.getByRole("cell", { name: "keyword-metrics-ui.csv", exact: true }).waitFor();
    await capture(page, "saved-keywords");

    await page.getByRole("navigation").getByRole("link", { name: /^Organic research$/ }).click();
    await page.getByRole("heading", { name: /^Organic research$/ }).waitFor();
    await page.getByLabel("Saved scan for page evidence").waitFor();
    await page.getByText(/saved scans? available for this site/i).first().waitFor();
    const localCrawlPagesSection = page.locator("section").filter({ hasText: "Local crawl pages" }).first();
    const localCrawlPagesBox = await localCrawlPagesSection.boundingBox();
    if (!localCrawlPagesBox || localCrawlPagesBox.width < 1000) {
      throw new Error(`Organic crawl evidence should use the full desktop width, got ${localCrawlPagesBox?.width}.`);
    }
    await page.getByLabel("Research domain").waitFor();
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
    await page.getByText("Web-wide backlink index", { exact: true }).waitFor();
    await page.getByRole("button", { name: /Import CSV first/i }).waitFor();
    await page.getByText("Needs CSV").waitFor();
    await page.getByLabel("Import backlink CSV").waitFor();
    const backlinkCsvPath = path.join(tempDir, "backlinks-ui.csv");
    await writeFile(
      backlinkCsvPath,
      [
        "source_url,target_url,referring_domain,anchor,follow,status,domain_rating",
        `https://ref.example/link,${fixtureUrl}/page,ref.example,Fixture,true,200,30`,
        `https://other.example/link,${fixtureUrl}/page,other.example,Fixture,nofollow,200,20`,
      ].join("\n"),
    );
    await page.getByLabel("Import backlink CSV").setInputFiles(backlinkCsvPath);
    await page.getByText(/Imported 2 backlink rows/i).waitFor();
    await page.getByRole("button", { name: /Check imported backlinks/i }).click();
    await page.getByRole("cell", { name: /ref\.example/i }).waitFor();
    await capture(page, "links");
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
    await page.getByLabel("URLs to inspect").waitFor();
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
    await page.getByRole("row", { name: /Search Console/i }).getByText("Local CSV imports").waitFor();
    if (await page.getByText("local OAuth").count()) {
      throw new Error("Overview still labels Search Console as local OAuth.");
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(webUrl, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: /Site control/i }).waitFor();
    await page.getByRole("banner").getByRole("button", { name: /^Scan website$/ }).waitFor();
    await page.getByRole("main").getByRole("button", { name: /^Scan website$/ }).waitFor();
    await page.getByRole("link", { name: /^Open Search Console$/ }).waitFor();
    await page
      .locator("section", { hasText: "Scan history" })
      .getByRole("link", { name: /^Open scan report$/ })
      .first()
      .waitFor();
    await assertNoHorizontalOverflow(page, "Mobile populated overview");
    await page.setViewportSize({ width: 1600, height: 1000 });

    await page.getByRole("link", { name: /Sites/i }).click();
    await page.getByRole("heading", { name: /^Sites$/ }).waitFor();
    await capture(page, "sites");
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

    await page.getByRole("navigation").getByRole("link", { name: /^Site scans$/ }).click();
    if (new URL(page.url()).pathname !== "/scans") {
      throw new Error(`Site scans navigation should use /scans, got ${page.url()}.`);
    }
    await page.getByRole("heading", { name: /^Page speed tracking$/ }).waitFor();
    await capture(page, "scans");
    await page.getByText(/Latest avg .*ms/i).waitFor();
    await page.getByRole("columnheader", { name: /^P95$/ }).waitFor();
    await page.getByRole("heading", { name: /^All scan history$/ }).waitFor();
    await page.getByText(/Active site: \d+ saved scans\. Local database: \d+ total scans visible below\./).waitFor();
    await page.locator("section", { hasText: "All scan history" }).getByText("Active site").first().waitFor();
    await page.getByRole("button", { name: /Delete scan/i }).first().waitFor();
    const scanHistoryTable = page.locator("section", { hasText: "All scan history" }).locator("table").first();
    const scanHistoryBox = await scanHistoryTable.boundingBox();
    const scanHistoryViewport = page.viewportSize();
    if (
      !scanHistoryBox ||
      !scanHistoryViewport ||
      scanHistoryBox.x + scanHistoryBox.width > scanHistoryViewport.width
    ) {
      throw new Error(`Scan history table should fit the viewport, got ${JSON.stringify(scanHistoryBox)} in ${JSON.stringify(scanHistoryViewport)}.`);
    }
    if (scanReportPath) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${webUrl}${scanReportPath}`, { waitUntil: "networkidle" });
      await page.getByRole("heading", { name: /Scan report/i }).waitFor();
      await page.getByRole("heading", { name: /^Scan health$|^Scan progress$/ }).waitFor();
      await page.getByText(/link URLs checked/i).first().waitFor();
      await page.getByText(/pages timed.*median/i).first().waitFor();
      await page.getByText(/Serve public pages over HTTPS/i).first().waitFor();
      await page.getByRole("button", { name: /Show \d+ issues/i }).first().waitFor();
      await capture(page, "scan-report-mobile");
      await assertNoHorizontalOverflow(page, "Mobile scan report");
      await page.setViewportSize({ width: 1600, height: 1000 });
      await page.goto(`${webUrl}/scans`, { waitUntil: "networkidle" });
      await page.getByRole("heading", { name: /^Page speed tracking$/ }).waitFor();
    }
    await page.goto(`${webUrl}/audits`, { waitUntil: "networkidle" });
    if (new URL(page.url()).pathname !== "/audits") {
      throw new Error(`Old /audits route should not redirect, got ${page.url()}.`);
    }
    await page.getByRole("heading", { name: /^Page not found$/ }).waitFor();
    await page.goto(`${webUrl}/projects`, { waitUntil: "networkidle" });
    if (new URL(page.url()).pathname !== "/projects") {
      throw new Error(`Legacy /projects route should not redirect, got ${page.url()}.`);
    }
    await page.getByRole("heading", { name: /^Page not found$/ }).waitFor();
    await page.goto(`${webUrl}/scans`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Delete scans for this site$/ }).click();
    await page.getByRole("heading", { name: /^Delete scans for this site\?$/ }).waitFor();
    await page.getByRole("button", { name: /^Delete scans for this site$/ }).click();
    await page.getByText("No scan report yet").waitFor();
    await page.getByRole("button", { name: /^Scan site now$/ }).first().waitFor();
    await page.getByText("No scans yet").waitFor();
    await page.getByRole("button", { name: /^Scan site now$/ }).first().click();
    await page.getByText("Scan running").waitFor({ timeout: 5000 });
    await page.locator("section", { hasText: "Scan running" }).getByText(/pages crawled/i).first().waitFor();
    await page.getByRole("link", { name: /Open live report/i }).waitFor();
    await page.getByText("completed").first().waitFor({ timeout: 60_000 });

    await page.getByRole("navigation").getByRole("link", { name: /^MCP$/ }).click();
    await page.getByRole("heading", { name: /^MCP$/ }).waitFor();
    await capture(page, "mcp");
    await page.getByRole("columnheader", { name: /^Inputs$/i }).first().waitFor();
    await page.getByRole("cell", { name: "start_scan" }).waitFor();
    await page.getByRole("cell", { name: "scan_site" }).waitFor();
    await page.getByRole("cell", { name: "get_scan" }).waitFor();
    if (await page.getByRole("cell", { name: /^start_audit$|^get_audit$/ }).count()) {
      throw new Error("MCP screen should show scan-named tools, not audit-named tools.");
    }
    const activeSiteId = await page.evaluate(() => localStorage.getItem("local-seo:site") || "");
    if (!activeSiteId) {
      throw new Error("MCP page test could not read the active site ID from local storage.");
    }
    await page.getByText(activeSiteId).first().waitFor();
    await page.getByText(`localhost:${fixtureServer.port}`).first().waitFor();
    const mcpCommonCalls = page.locator("section").filter({ hasText: "Common calls" }).first();
    if (await mcpCommonCalls.getByText("site-id").count()) {
      throw new Error("MCP page exposes a placeholder site ID instead of the active site.");
    }
    if (await mcpCommonCalls.getByText(/\bexample\.com\b/i).count()) {
      throw new Error("MCP page exposes a placeholder domain instead of the active site domain.");
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
    await capture(page, "settings");
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
    await page.getByText("App settings saved locally.").waitFor();

    await page.getByRole("navigation").getByRole("link", { name: /^Sites$/ }).click();
    await page.getByRole("heading", { name: /^Sites$/ }).waitFor();
    await page.getByRole("button", { name: /^Add site$/ }).click();
    const addSiteDialog = page.getByRole("dialog", { name: /^Add site$/ });
    await addSiteDialog.getByText("Keyword tool defaults").waitFor();
    await addSiteDialog.getByText("Site scans crawl every page language they find.").waitFor();
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
    await page.getByText("second.test saved locally.").waitFor();
    await page.getByRole("button", { name: /Edit second.test/i }).click();
    await page.getByRole("heading", { name: /^Edit site$/ }).waitFor();
    await Promise.all([
      page.waitForResponse((response) => response.url().includes("/api/sites/") && response.request().method() === "PUT"),
      page.getByRole("button", { name: /^Save changes$/ }).click(),
    ]);
    await page.getByText("second.test updated locally.").waitFor();
    await page.getByRole("navigation").getByRole("link", { name: /^Organic research$/ }).click();
    await page.getByLabel("Research domain").waitFor();
    if (await page.getByLabel("Research domain").inputValue() !== "second.test") {
      throw new Error("Research domain field did not follow the newly active site.");
    }
    await page.getByRole("navigation").getByRole("link", { name: /^Links$/ }).click();
    await page.getByLabel("Backlink domain").waitFor();
    if (await page.getByLabel("Backlink domain").inputValue() !== "second.test") {
      throw new Error("Backlink domain field did not follow the newly active site.");
    }
    await page.getByRole("navigation").getByRole("link", { name: /^SERP analysis$/ }).click();
    await page.getByLabel("Ranking domain").waitFor();
    if (await page.getByLabel("Ranking domain").inputValue() !== "second.test") {
      throw new Error("Ranking domain did not follow the newly active site.");
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${webUrl}/sites`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: /^Sites$/ }).waitFor();
    await page.getByRole("button", { name: /Scan second.test/i }).waitFor();
    await page.getByRole("button", { name: /Edit second.test/i }).waitFor();
    await page.getByRole("button", { name: /Delete second.test/i }).waitFor();
    const visibleSitesScanPlan = await page.getByText("Scan plan", { exact: true }).evaluateAll((nodes) =>
      nodes.some((node) => {
        const element = node as HTMLElement;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }),
    );
    if (!visibleSitesScanPlan) {
      throw new Error("Mobile Sites rows should show the scan plan without relying on hidden desktop table headers.");
    }
    await assertNoHorizontalOverflow(page, "Mobile sites with saved rows");
    const mobileRoutes: [string, string][] = [
      ["overview", "/"],
      ["sites", "/sites"],
      ["scans", "/scans"],
      ["organic research", "/domain"],
      ["links", "/links"],
      ["settings", "/settings"],
    ];
    for (const [label, route] of mobileRoutes) {
      await page.goto(`${webUrl}${route}`, { waitUntil: "networkidle" });
      await assertNoHorizontalOverflow(page, `Mobile ${label}`);
    }
    await page.goto(`${webUrl}/sites`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Delete second.test/i }).click();
    await page.getByRole("heading", { name: /^Delete site\?$/ }).waitFor();
    await page.getByText(/saved scans, keywords, trackers, Search Console imports, and local history/i).waitFor();
    await page.getByRole("button", { name: /^Delete site$/ }).click();
    await page.getByText("second.test deleted locally.").waitFor();
    if (await page.getByRole("button", { name: /Delete second.test/i }).count()) {
      throw new Error("Deleted site still appears in the Sites UI.");
    }
  } finally {
    await browser.close();
  }
  if (screenshotDir) {
    console.log(`UI smoke screenshots: ${screenshotDir}`);
  }
  console.log("UI smoke test passed.");
} finally {
  await cleanup();
}

export {};
