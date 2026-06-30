import { mkdtemp, rm } from "node:fs/promises";
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
  fetch(request) {
    const url = new URL(request.url);
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
    await page.getByPlaceholder("example.com").fill(`localhost:${fixtureServer.port}`);
    await page.getByPlaceholder("Site name (optional)").fill("Fixture Site");
    await page.getByText("Protocol").waitFor();
    await page.getByText("Hostname").waitFor();
    await page.getByRole("button", { name: /Add site and scan/i }).click();

    await page.getByRole("heading", { name: /Audit report/i }).waitFor({ timeout: 20_000 });
    await page.getByText("completed").first().waitFor({ timeout: 60_000 });
    await page.getByText("Checked image URLs").first().waitFor();
    if (await page.getByText("0 chars").count()) {
      throw new Error("Audit report still shows standalone 0 chars badges.");
    }

    await page.goto(webUrl, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: /Site control/i }).waitFor();
    await page.getByText("Technical audit").waitFor();
    await page.getByText("Scan site").waitFor();
    if (await page.getByText("Workspace totals").count()) {
      throw new Error("Overview still renders the old metric-card totals section.");
    }

    await page.getByRole("link", { name: /Sites/i }).click();
    await page.getByRole("heading", { name: /^Sites$/ }).waitFor();
    await page.getByText("Scan target").waitFor();
    await page.getByRole("button", { name: /Edit Fixture Site/i }).click();
    await page.getByRole("heading", { name: /Edit site/i }).waitFor();
    await page.getByText("Protocol").waitFor();
    await page.getByText("Hostname").waitFor();
  } finally {
    await browser.close();
  }
  console.log("UI smoke test passed.");
} finally {
  await cleanup();
}

export {};
