import "./db";
import dotenv from "dotenv";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  createOrReplaceAdmin,
  createSessionToken,
  getAdminByEmail,
  getAdminById,
  getAdminUserCount,
  getAuthConfig,
  publicUser,
  verifyPassword,
  verifySessionToken,
} from "./auth";
import { isAppPreferenceKey, listPublicConfig, setConfigValue } from "./config";
import { createAiJob, getAiJob, listAiJobs, listAiPrompts, saveAiPrompt } from "./codex";
import {
  createGscAuthUrl,
  disconnectGsc,
  gscStatus,
  handleGscCallback,
  importGscPerformance,
  inspectGscUrls,
  listGscImports,
  listGscSites,
  queryGscPerformance,
  setGscSite,
} from "./gsc";
import { handleMcp, mcpToolList } from "./mcp";
import { resolveSavedSiteScanUrl, siteScanUrlCandidates } from "./site-scan-url";
import {
  addRankKeywords,
  backlinksOverview,
  brandLookup,
  clearScans,
  createSite,
  createRankTracker,
  dashboardSummary,
  deleteScan,
  deleteSite,
  deleteSavedKeywordTag,
  domainOverview,
  exportSavedKeywordsCsv,
  getScan,
  getBacklinksProfile,
  getDomainKeywordSuggestions,
  getDomainKeywordsPage,
  getDomainPagesPage,
  getRankKeywordHistory,
  getRankTrackerTrend,
  getSerpAnalysis,
  getSite,
  importBacklinksCsv,
  importKeywordMetricsCsv,
  importOrganicResearchCsv,
  listBacklinkSnapshots,
  listAllScans,
  listScans,
  listBrandLookupRuns,
  listDomainSnapshots,
  listPromptExplorerRuns,
  listSites,
  listRankTrackers,
  listSavedKeywordTags,
  listSavedKeywords,
  listKeywordMetricImports,
  listSerpRuns,
  promptExplorer,
  siteSummary,
  querySavedKeywords,
  researchKeywords,
  syncRankKeywordMetrics,
  removeRankKeywords,
  removeSavedKeywords,
  runRankCheck,
  saveKeywords,
  startScan,
  updateSavedKeywordTag,
  updateSavedKeywordTags,
  updateSite,
} from "./seo";
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

const app = new Hono();
const isDev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT || 3031);
const authConfig = getAuthConfig();

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

async function readJson(c: any) {
  return (await c.req.json().catch(() => ({}))) as Record<string, any>;
}

function siteScopedBody(body: Record<string, any>) {
  return body;
}

async function readSiteScopedJson(c: any) {
  return siteScopedBody(await readJson(c));
}

function domainScopedBody(body: Record<string, any>) {
  const scoped = siteScopedBody(body);
  const domain = body.domain;
  return domain ? { ...scoped, domain } : scoped;
}

async function readDomainScopedJson(c: any) {
  return domainScopedBody(await readJson(c));
}

function siteQueryId(c: any) {
  return c.req.query("siteId");
}

function siteBodyId(body: Record<string, any>) {
  return String(body.siteId || "");
}

function baseUrl(c: any) {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured;
  const url = new URL(c.req.url);
  return `${url.protocol}//${url.host}`;
}

function currentUser(c: any) {
  const userId = verifySessionToken(getCookie(c, authConfig.sessionCookieName), authConfig);
  if (!userId) return null;
  const user = getAdminById(userId);
  return user ? publicUser(user) : null;
}

function safe(handler: (c: any) => Promise<Response> | Response) {
  return async (c: any) => {
    try {
      return await handler(c);
    } catch (error) {
      console.error(error);
      return c.json(
        { error: error instanceof Error ? error.message : "Internal server error" },
        500,
      );
    }
  };
}

app.use("/api/*", async (c, next) => {
  c.header("Access-Control-Allow-Origin", isDev ? "http://localhost:5173" : c.req.header("origin") || "");
  c.header("Access-Control-Allow-Credentials", "true");
  c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (c.req.method === "OPTIONS") return c.body(null, 204);
  await next();
});

app.get("/api/auth/me", (c) => {
  const setupRequired = getAdminUserCount() === 0;
  const user = currentUser(c);
  if (!user) {
    return c.json({ authenticated: false, setupRequired }, 401);
  }
  return c.json({ authenticated: true, setupRequired: false, user });
});

app.post(
  "/api/auth/setup",
  safe(async (c) => {
    if (getAdminUserCount() > 0) {
      return c.json({ error: "Admin user already exists." }, 409);
    }
    const body = await readJson(c);
    const user = createOrReplaceAdmin(String(body.email || ""), String(body.password || ""));
    const token = createSessionToken(user.id, authConfig, authConfig.rememberSessionTtlSeconds);
    setCookie(c, authConfig.sessionCookieName, token, {
      httpOnly: true,
      sameSite: "Lax",
      secure: !isDev,
      path: "/",
      maxAge: authConfig.rememberSessionTtlSeconds,
    });
    return c.json({ success: true, user });
  }),
);

app.post(
  "/api/auth/login",
  safe(async (c) => {
    const body = await readJson(c);
    const email = String(body.email || "");
    const password = String(body.password || "");
    const remember = body.remember === true;
    const user = getAdminByEmail(email);
    if (!user || !verifyPassword(user, password)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const ttl = remember ? authConfig.rememberSessionTtlSeconds : authConfig.sessionTtlSeconds;
    const token = createSessionToken(user.id, authConfig, ttl);
    setCookie(c, authConfig.sessionCookieName, token, {
      httpOnly: true,
      sameSite: "Lax",
      secure: !isDev,
      path: "/",
      maxAge: ttl,
    });
    return c.json({ success: true, user: publicUser(user) });
  }),
);

app.post("/api/auth/logout", (c) => {
  deleteCookie(c, authConfig.sessionCookieName, { path: "/" });
  return c.json({ success: true });
});

app.use("/api/*", async (c, next) => {
  const allowed = ["/api/auth/me", "/api/auth/login", "/api/auth/setup", "/api/gsc/callback"];
  if (allowed.some((path) => c.req.path.startsWith(path))) {
    await next();
    return;
  }
  if (!currentUser(c)) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

app.post("/mcp", handleMcp);
app.get("/api/mcp/tools", (c) => c.json({ tools: mcpToolList() }));

app.get("/api/dashboard", safe((c) => c.json(dashboardSummary(siteQueryId(c)))));

app.get("/api/config", safe((c) => c.json(listPublicConfig())));
app.put(
  "/api/config",
  safe(async (c) => {
    const body = await readJson(c);
    const unsupportedKeys = Object.keys(body).filter((key) => !isAppPreferenceKey(key));
    if (unsupportedKeys.length) {
      return c.json(
        {
          error: `App settings cannot save data-source credentials or environment keys: ${unsupportedKeys.join(", ")}.`,
        },
        400,
      );
    }
    for (const [key, value] of Object.entries(body)) {
      setConfigValue(key, String(value ?? ""));
    }
    return c.json(listPublicConfig());
  }),
);

async function startSavedSiteScan(c: any) {
  const site = getSite(c.req.param("id"));
  if (!site) return c.json({ error: "Site not found." }, 404);
  if (!site.domain) return c.json({ error: "Set a site domain first." }, 400);
  const candidateUrls = siteScanUrlCandidates(site);
  const url = await resolveSavedSiteScanUrl(site);
  const scan = startScan(site.id, url);
  return c.json({
    site: site.domain,
    scan,
    related: [
      {
        key: "technical-scan",
        label: "Technical scan",
        status: "running",
        route: `/scans/${scan.id}`,
        message: `Local crawler is checking ${url} for pages, metadata, links, images, assets, robots, and sitemap.`,
      },
      {
        key: "page-speed",
        label: "Page speed",
        status: "running",
        route: `/scans/${scan.id}?tab=speed`,
        message: "Crawler response timings, HTML weight, compression, and CSS/JS evidence are saved in this scan.",
      },
      {
        key: "domain-intelligence",
        label: "Organic research",
        status: "local",
        route: "/domain",
        message: "Local crawl page evidence will be available from this scan. Third-party ranked keywords and traffic estimates are not generated locally.",
      },
      {
        key: "links",
        label: "Links",
        status: "local",
        route: "/links",
        message: "Local internal, external, and broken-link evidence will be available from this scan. Web-wide backlinks require a real imported index.",
      },
    ],
    scanUrl: url,
    candidateUrls,
    scanPreferences: {
      protocol: site.crawl_protocol || "auto",
      host: site.crawl_host || "auto",
    },
    message: `Started site scan for ${site.domain}.`,
  });
}

app.get("/api/sites", safe((c) => c.json(listSites())));
app.post(
  "/api/sites",
  safe(async (c) => c.json(createSite((await readJson(c)) as any))),
);
app.get("/api/sites/:id", safe((c) => c.json(siteSummary(c.req.param("id")))));
app.put(
  "/api/sites/:id",
  safe(async (c) => c.json(updateSite(c.req.param("id"), await readJson(c)))),
);
app.delete("/api/sites/:id", safe((c) => c.json(deleteSite(c.req.param("id")))));
app.post("/api/sites/:id/scan", safe(startSavedSiteScan));

app.post(
  "/api/keywords/research",
  safe(async (c) => c.json(await researchKeywords((await readSiteScopedJson(c)) as any))),
);
app.get(
  "/api/sites/:id/keywords",
  safe((c) => c.json(listSavedKeywords(c.req.param("id")))),
);
app.post(
  "/api/sites/:id/keywords/query",
  safe(async (c) => c.json(querySavedKeywords({ siteId: c.req.param("id"), ...(await readJson(c)) }))),
);
app.get(
  "/api/sites/:id/keyword-tags",
  safe((c) => c.json(listSavedKeywordTags(c.req.param("id")))),
);
app.post(
  "/api/sites/:id/keywords/tags",
  safe(async (c) =>
    c.json(updateSavedKeywordTags({ siteId: c.req.param("id"), ...(await readJson(c)) } as any)),
  ),
);
app.put(
  "/api/sites/:id/keyword-tags/:tagId",
  safe(async (c) =>
    c.json(updateSavedKeywordTag({ siteId: c.req.param("id"), tagId: c.req.param("tagId"), ...(await readJson(c)) })),
  ),
);
app.delete(
  "/api/sites/:id/keyword-tags/:tagId",
  safe((c) => c.json(deleteSavedKeywordTag({ siteId: c.req.param("id"), tagId: c.req.param("tagId") }))),
);
app.post(
  "/api/sites/:id/keywords/remove",
  safe(async (c) => {
    const body = await readJson(c);
    return c.json(removeSavedKeywords(c.req.param("id"), body.savedKeywordIds || body.ids || []));
  }),
);
app.get(
  "/api/sites/:id/keywords.csv",
  safe((c) => {
    const csv = exportSavedKeywordsCsv(c.req.param("id"));
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="local-seo-keywords-${c.req.param("id")}.csv"`,
      },
    });
  }),
);
app.get(
  "/api/sites/:id/keyword-metric-imports",
  safe((c) => c.json(listKeywordMetricImports(c.req.param("id")))),
);
app.post(
  "/api/keywords/import-metrics",
  safe(async (c) => c.json(importKeywordMetricsCsv((await readSiteScopedJson(c)) as any))),
);
app.post(
  "/api/keywords/save",
  safe(async (c) => c.json(saveKeywords((await readSiteScopedJson(c)) as any))),
);
app.get(
  "/api/sites/:id/serp",
  safe((c) => c.json(listSerpRuns(c.req.param("id")))),
);
app.post(
  "/api/serp/analyze",
  safe(async (c) => c.json(await getSerpAnalysis((await readDomainScopedJson(c)) as any))),
);

app.get(
  "/api/sites/:id/rank-trackers",
  safe((c) => c.json(listRankTrackers(c.req.param("id")))),
);
app.post(
  "/api/rank-trackers",
  safe(async (c) => c.json(createRankTracker((await readSiteScopedJson(c)) as any))),
);
app.post(
  "/api/rank-trackers/:id/keywords",
  safe(async (c) => {
    const body = await readJson(c);
    addRankKeywords(c.req.param("id"), body.keywords || []);
    return c.json({ success: true });
  }),
);
app.post(
  "/api/rank-trackers/:id/keywords/remove",
  safe(async (c) => {
    const body = await readJson(c);
    return c.json(removeRankKeywords(c.req.param("id"), body.keywordIds || []));
  }),
);
app.post(
  "/api/rank-trackers/:id/sync-metrics",
  safe((c) => c.json(syncRankKeywordMetrics(c.req.param("id")))),
);
app.get(
  "/api/rank-trackers/:id/trend",
  safe((c) => c.json(getRankTrackerTrend(c.req.param("id"), Number(c.req.query("sinceDays") || 365)))),
);
app.get(
  "/api/rank-trackers/:id/keywords/:keywordId/history",
  safe((c) =>
    c.json(
      getRankKeywordHistory({
        trackerId: c.req.param("id"),
        keywordId: c.req.param("keywordId"),
        sinceDays: Number(c.req.query("sinceDays") || 365),
      }),
    ),
  ),
);
app.post(
  "/api/rank-trackers/:id/check",
  safe(async (c) => c.json(await runRankCheck(c.req.param("id")))),
);

app.post("/api/domain/overview", safe(async (c) => c.json(await domainOverview((await readDomainScopedJson(c)) as any))));
app.get(
  "/api/sites/:id/domain-snapshots",
  safe((c) => c.json(listDomainSnapshots(c.req.param("id")))),
);
app.post(
  "/api/domain/keyword-suggestions",
  safe(async (c) => c.json(await getDomainKeywordSuggestions((await readDomainScopedJson(c)) as any))),
);
app.post(
  "/api/domain/keywords",
  safe(async (c) => c.json(await getDomainKeywordsPage((await readDomainScopedJson(c)) as any))),
);
app.post(
  "/api/domain/pages",
  safe(async (c) => c.json(await getDomainPagesPage((await readDomainScopedJson(c)) as any))),
);
app.post(
  "/api/domain/import",
  safe(async (c) => c.json(importOrganicResearchCsv((await readDomainScopedJson(c)) as any))),
);
app.post(
  "/api/backlinks/overview",
  safe(async (c) => c.json(await backlinksOverview((await readDomainScopedJson(c)) as any))),
);
app.get(
  "/api/sites/:id/backlink-snapshots",
  safe((c) => c.json(listBacklinkSnapshots(c.req.param("id")))),
);
app.post(
  "/api/backlinks/profile",
  safe(async (c) => c.json(await getBacklinksProfile((await readDomainScopedJson(c)) as any))),
);
app.post(
  "/api/backlinks/import",
  safe(async (c) => c.json(importBacklinksCsv((await readDomainScopedJson(c)) as any))),
);
app.get(
  "/api/sites/:id/brand-lookup",
  safe((c) => c.json(listBrandLookupRuns(c.req.param("id")))),
);
app.post(
  "/api/brand-lookup",
  safe(async (c) => c.json(await brandLookup((await readSiteScopedJson(c)) as any))),
);
app.get(
  "/api/sites/:id/prompt-explorer",
  safe((c) => c.json(listPromptExplorerRuns(c.req.param("id")))),
);
app.post(
  "/api/prompt-explorer",
  safe(async (c) => c.json(await promptExplorer((await readSiteScopedJson(c)) as any))),
);

const listSiteScansHandler = safe((c: any) => c.json(listScans(c.req.param("id"))));
const listAllScansHandler = safe((c: any) => c.json(listAllScans()));
const getScanHandler = safe((c: any) => c.json(getScan(c.req.param("id"))));
const clearSiteScansHandler = safe((c: any) => c.json(clearScans(c.req.param("id"))));
const deleteSiteScanHandler = safe((c: any) => c.json(deleteScan(c.req.param("siteId"), c.req.param("id"))));
const startScanHandler = safe(async (c: any) => {
  const body = await readJson(c);
  return c.json(startScan(siteBodyId(body), String(body.url)));
});

app.get("/api/sites/:id/scans", listSiteScansHandler);
app.get("/api/scans", listAllScansHandler);
app.get("/api/scans/:id", getScanHandler);
app.delete("/api/sites/:id/scans", clearSiteScansHandler);
app.delete("/api/sites/:siteId/scans/:id", deleteSiteScanHandler);
app.post("/api/scans", startScanHandler);

app.get("/api/ai/prompts", safe((c) => c.json(listAiPrompts())));
app.put(
  "/api/ai/prompts/:key",
  safe(async (c) => {
    const body = await readJson(c);
    saveAiPrompt(c.req.param("key"), String(body.template || ""));
    return c.json({ success: true });
  }),
);
app.get("/api/ai/jobs", safe((c) => c.json(listAiJobs())));
app.get("/api/ai/jobs/:id", safe((c) => c.json(getAiJob(c.req.param("id")))));
app.post(
  "/api/ai/jobs",
  safe(async (c) => c.json(createAiJob((await readJson(c)) as any))),
);

app.get("/api/gsc/status/:siteId", safe((c) => c.json(gscStatus(c.req.param("siteId")))));
app.get("/api/gsc/imports/:siteId", safe((c) => c.json(listGscImports(c.req.param("siteId")))));
app.post(
  "/api/gsc/start",
  safe(async (c) => {
    const body = await readJson(c);
    return c.json({ url: createGscAuthUrl(siteBodyId(body), baseUrl(c)) });
  }),
);
app.get(
  "/api/gsc/callback",
  safe(async (c) => {
    const siteId = c.req.query("siteId") || "";
    const code = c.req.query("code") || "";
    await handleGscCallback({ siteId, code, baseUrl: baseUrl(c) });
    return new Response(
      "<html><body><script>window.close()</script><p>Google Search Console connected. You can close this tab.</p></body></html>",
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }),
);
app.get("/api/gsc/sites/:siteId", safe(async (c) => c.json(await listGscSites(c.req.param("siteId")))));
app.post(
  "/api/gsc/site",
  safe(async (c) => {
    const body = await readJson(c);
    return c.json(setGscSite(siteBodyId(body), String(body.siteUrl)));
  }),
);
app.post(
  "/api/gsc/performance",
  safe(async (c) => c.json(await queryGscPerformance((await readSiteScopedJson(c)) as any))),
);
app.post(
  "/api/gsc/import",
  safe(async (c) => c.json(importGscPerformance((await readSiteScopedJson(c)) as any))),
);
app.post(
  "/api/gsc/inspect",
  safe(async (c) => c.json(await inspectGscUrls((await readSiteScopedJson(c)) as any))),
);
app.post(
  "/api/gsc/disconnect",
  safe(async (c) => {
    const body = await readJson(c);
    return c.json(disconnectGsc(siteBodyId(body)));
  }),
);

if (!isDev) {
  app.use("/*", serveStatic({ root: "./web/dist" }));
  app.get("/*", serveStatic({ root: "./web/dist", path: "index.html" }));
}

console.log(`Local SEO API running on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
