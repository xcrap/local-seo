import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tempDir = await mkdtemp(path.join(os.tmpdir(), "local-seo-waka-"));
process.env.DB_PATH = path.join(tempDir, "waka.sqlite");

function expect(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

try {
  const seo = await import("../src/seo");
  const { resolveSavedSiteScanUrl } = await import("../src/site-target");
  expect(seo.sameSiteUrl("https://www.waka.pt/about/", "https://waka.pt"), "Root and www Waka URLs must share crawl scope.");

  const project = seo.createProject({
    name: "Waka live audit",
    domain: "waka.pt",
    locationCode: 2620,
    languageCode: "pt",
    crawlProtocol: "https",
    crawlHost: "both",
  });
  const resolvedScanUrl = await resolveSavedSiteScanUrl(project);
  expect(
    resolvedScanUrl.startsWith("https://www.waka.pt"),
    `Expected saved-site scan resolver to prefer Waka's live www HTTPS target, got ${resolvedScanUrl}.`,
  );
  const started = seo.startAudit(project.id, resolvedScanUrl);
  expect(started?.id, "Could not start Waka audit.");

  const startedAt = Date.now();
  let audit = started;
  while (Date.now() - startedAt < 120_000) {
    audit = seo.getAudit(started.id);
    if (audit?.status === "completed" || audit?.status === "failed") break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  expect(audit?.status === "completed", `Waka audit did not complete: ${audit?.status || "missing"} ${audit?.error || ""}`);

  const result = audit.result || {};
  const summary = result.summary || {};
  const sitemapUrls = result.sitemap?.urls || [];
  const pages = result.pages || [];

  expect(sitemapUrls.length >= 8, `Expected at least 8 Waka sitemap URLs, got ${sitemapUrls.length}.`);
  expect(pages.length >= 8, `Expected at least 8 crawled Waka pages, got ${pages.length}.`);
  expect(summary.indexablePages >= 8, `Expected Waka pages to be indexable, got ${summary.indexablePages || 0}.`);
  expect(summary.nonIndexablePages === 0, `Expected Waka scan to avoid false non-indexable pages, got ${summary.nonIndexablePages || 0}.`);
  expect(summary.sitemapUrls >= 8, `Expected Waka crawled pages to match the sitemap, got ${summary.sitemapUrls || 0}.`);
  expect(summary.linkTags > 0, "Expected Waka link inventory to be greater than zero.");
  expect(summary.checkedLinks > 0, "Expected Waka checked links to be greater than zero.");
  expect(summary.checkedAssets > 0, "Expected Waka checked CSS/JS assets to be greater than zero.");
  expect(summary.checkedImages > 0, "Expected Waka checked image resources to be greater than zero.");
  expect(summary.cssImageResources > 0, "Expected Waka CSS image resources to be checked.");
  expect(summary.indexablePages === pages.filter((page: any) => page.indexable === true).length, "Waka indexable summary must match page evidence.");
  expect(summary.nonIndexablePages === pages.filter((page: any) => page.indexable === false).length, "Waka non-indexable summary must match page evidence.");
  expect(summary.unknownIndexabilityPages === pages.filter((page: any) => typeof page.indexable !== "boolean").length, "Waka unknown indexability summary must match page evidence.");
  const timedPages = pages.filter((page: any) => Number.isFinite(Number(page.loadMs)) && Number(page.loadMs) >= 0);
  expect(timedPages.length === pages.length, "Expected every Waka crawled page to include response timing.");
  expect(summary.measuredPageLoads === timedPages.length, "Waka speed summary must match page response timing evidence.");
  expect(Number.isFinite(Number(summary.averagePageLoadMs)), "Expected Waka average response timing to be saved.");
  expect(Number(summary.p95PageLoadMs) >= Number(summary.medianPageLoadMs), "Expected Waka p95 response timing to be at least the median.");

  console.log(JSON.stringify({
    status: audit.status,
    score: audit.score,
    pagesCrawled: audit.pages_crawled,
    issues: audit.issue_count,
    sitemapUrls: sitemapUrls.length,
    sitemapListedPages: summary.sitemapUrls,
    linkTags: summary.linkTags,
    checkedLinks: summary.checkedLinks,
    imageTags: summary.imageTags,
    checkedImages: summary.checkedImages,
    cssImageResources: summary.cssImageResources,
    checkedAssets: summary.checkedAssets,
    measuredPageLoads: summary.measuredPageLoads,
    averagePageLoadMs: summary.averagePageLoadMs,
    p95PageLoadMs: summary.p95PageLoadMs,
    resolvedScanUrl,
    startedUrl: result.startUrl,
    finalHomeUrl: pages[0]?.finalUrl,
  }, null, 2));
  console.log("Waka live audit test passed.");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

export {};
