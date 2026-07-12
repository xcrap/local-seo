import * as cheerio from "cheerio";
import { XMLParser } from "fast-xml-parser";
import { createHash, randomUUID } from "node:crypto";
import { getConfigValue } from "./config";
import { all, get, jsonParse, run } from "./db";
import { fetchText, fetchWithRedirectTrace } from "./http";
import { localHostFirst, probeScanUrl, unreachableScanUrlError } from "./site-scan-url";

const SCAN_RESULT_VERSION = 2;

function getSite(siteId: string) {
  return get<any>("SELECT * FROM sites WHERE id = ?", [siteId]);
}

function publicScanRow(row: any) {
  if (!row) return null;
  const { site_id: siteId, site_name: siteName, site_domain: siteDomain, result_json, ...rest } = row;
  return applyIssueIgnores({
    ...rest,
    site_id: siteId,
    ...(siteName ? { site_name: siteName } : {}),
    ...(siteDomain ? { site_domain: siteDomain } : {}),
    result: jsonParse(result_json, null),
  });
}

// Ignore rules match by page identity, not raw URL string. The same page can be
// recorded with a different URL between scans — a toggled trailing slash, www,
// http/https, or a redirect that appends session/query params (e.g. a booking
// engine's ?idchain=...). Raw string equality silently drops the ignore on the
// next scan; comparing the normalized, query-stripped key keeps it applied.
function ignoreUrlKey(value: string) {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return normalizedUrlKey(url.toString());
  } catch {
    return String(value || "");
  }
}

// A rule with no issue_type ignores every issue on its URL; a rule with no
// URL ignores its issue type site-wide.
function issueMatchesIgnore(issue: any, rules: any[]) {
  const issueKey = ignoreUrlKey(String(issue?.url || ""));
  return rules.some(
    (rule) =>
      (!rule.issue_type || rule.issue_type === issue.type) &&
      (!rule.url || ignoreUrlKey(String(rule.url)) === issueKey),
  );
}

// Saved scan evidence stays untouched in SQLite; ignore rules are applied when
// scans are read, so restoring a rule instantly brings the issues and their
// score impact back on every saved report.
function applyIssueIgnores(row: any) {
  const result = row?.result;
  if (!result || !Array.isArray(result.issues)) return row;
  const rules = all<any>("SELECT * FROM scan_issue_ignores WHERE site_id = ?", [row.site_id]);
  if (!rules.length) return row;
  const issues = result.issues.map((issue: any) =>
    issueMatchesIgnore(issue, rules) ? { ...issue, ignored: true } : issue,
  );
  const activeIssues = issues.filter((issue: any) => !issue.ignored);
  const ignoredCount = issues.length - activeIssues.length;
  const comparison = result.comparison;
  const filteredComparison = comparison
    ? {
        ...comparison,
        newIssues: (comparison.newIssues || []).filter((issue: any) => !issueMatchesIgnore(issue, rules)),
        fixedIssues: (comparison.fixedIssues || []).filter((issue: any) => !issueMatchesIgnore(issue, rules)),
        severityChanges: (comparison.severityChanges || []).filter(
          (issue: any) => !issueMatchesIgnore(issue, rules),
        ),
      }
    : null;
  if (filteredComparison) {
    filteredComparison.summary = {
      ...(comparison.summary || {}),
      newIssues: filteredComparison.newIssues.length,
      fixedIssues: filteredComparison.fixedIssues.length,
      severityChanges: filteredComparison.severityChanges.length,
    };
  }
  const comparisonChanged = Boolean(
    comparison &&
      ((comparison.newIssues || []).length !== filteredComparison?.newIssues.length ||
        (comparison.fixedIssues || []).length !== filteredComparison?.fixedIssues.length ||
        (comparison.severityChanges || []).length !== filteredComparison?.severityChanges.length),
  );
  if (!ignoredCount && !comparisonChanged) return row;
  const pages = Array.isArray(result.pages) ? result.pages : [];
  const flaggedPages = pages.map((page: any) =>
    Array.isArray(page.issues) && page.issues.length
      ? {
          ...page,
          issues: page.issues.map((issue: any) =>
            issueMatchesIgnore(issue, rules) ? { ...issue, ignored: true } : issue,
          ),
        }
      : page,
  );
  return {
    ...row,
    score: row.status === "completed" ? healthScore(pages, activeIssues) : row.score,
    issue_count: activeIssues.length,
    ignored_issue_count: ignoredCount,
    result: {
      ...result,
      summary: scanSummary(
        activeIssues,
        pages,
        result.links || [],
        result.images || [],
        result.assets || [],
        result.imageInventory || [],
        result.linkInventory || [],
        result.parameterUrls || [],
        result.phase || "completed",
      ),
      issues,
      issueGroups: groupIssueSummary(activeIssues),
      pages: flaggedPages,
      ...(filteredComparison ? { comparison: filteredComparison } : {}),
    },
  };
}

export function listIssueIgnores(siteId: string) {
  const site = getSite(siteId);
  if (!site) throw new Error("Site not found.");
  return all<any>("SELECT * FROM scan_issue_ignores WHERE site_id = ? ORDER BY created_at DESC", [site.id]);
}

export function createIssueIgnore(siteId: string, input: { type?: string; url?: string; note?: string }) {
  const site = getSite(siteId);
  if (!site) throw new Error("Site not found.");
  const issueType = String(input?.type || "").trim();
  const url = String(input?.url || "").trim();
  if (!issueType && !url) throw new Error("An issue type or a page URL is required.");
  const note = String(input?.note || "").trim();
  run(
    `
    INSERT INTO scan_issue_ignores (id, site_id, issue_type, url, note)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(site_id, issue_type, url) DO UPDATE SET note = excluded.note
    `,
    [randomUUID(), site.id, issueType, url, note],
  );
  return get<any>("SELECT * FROM scan_issue_ignores WHERE site_id = ? AND issue_type = ? AND url = ?", [
    site.id,
    issueType,
    url,
  ]);
}

export function deleteIssueIgnore(siteId: string, ignoreId: string) {
  const site = getSite(siteId);
  if (!site) throw new Error("Site not found.");
  const info = run("DELETE FROM scan_issue_ignores WHERE id = ? AND site_id = ?", [ignoreId, site.id]);
  return { deleted: Number(info.changes || 0) > 0 };
}

export function clearIssueIgnores(siteId: string) {
  const site = getSite(siteId);
  if (!site) throw new Error("Site not found.");
  const info = run("DELETE FROM scan_issue_ignores WHERE site_id = ?", [site.id]);
  return { deleted: Number(info.changes || 0) };
}

export function listScans(siteId: string) {
  return all<any>("SELECT * FROM scans WHERE site_id = ? ORDER BY created_at DESC", [
    siteId,
  ]).map(publicScanRow);
}

export function listAllScans() {
  return all<any>(`
    SELECT
      scans.*,
      sites.name AS site_name,
      sites.domain AS site_domain
    FROM scans
    LEFT JOIN sites ON sites.id = scans.site_id
    ORDER BY scans.created_at DESC
  `).map(publicScanRow);
}

export function getScan(scanId: string) {
  const row = get<any>("SELECT * FROM scans WHERE id = ?", [scanId]);
  return publicScanRow(row);
}

export function deleteScan(siteId: string, scanId: string) {
  const site = getSite(siteId);
  if (!site) throw new Error("Site not found.");
  const info = run("DELETE FROM scans WHERE id = ? AND site_id = ?", [scanId, site.id]);
  return { deleted: Number(info.changes || 0) > 0 };
}

export function clearScans(siteId: string) {
  const site = getSite(siteId);
  if (!site) throw new Error("Site not found.");
  const info = run("DELETE FROM scans WHERE site_id = ?", [site.id]);
  return { deleted: Number(info.changes || 0) };
}

export async function startScan(siteId: string, url: string) {
  const site = getSite(siteId);
  if (!site) throw new Error("Site not found.");
  const startUrl = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
  const probe = await probeScanUrl(startUrl);
  if (!probe) throw unreachableScanUrlError(startUrl);
  const scanId = randomUUID();
  run(
    "INSERT INTO scans (id, site_id, url, status, updated_at) VALUES (?, ?, ?, 'queued', CURRENT_TIMESTAMP)",
    [scanId, site.id, url.trim()],
  );
  queueMicrotask(() => {
    runLocalScan(scanId).catch((error) => {
      run(
        "UPDATE scans SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [error instanceof Error ? error.message : "Scan failed", scanId],
      );
    });
  });
  return getScan(scanId);
}

type ScanIssueSeverity = "high" | "medium" | "low";
type ScanIssueCategory =
  | "indexability"
  | "metadata"
  | "headings"
  | "content"
  | "links"
  | "images"
  | "assets"
  | "canonicals"
  | "structured-data"
  | "social"
  | "performance"
  | "security"
  | "localization"
  | "sitemap"
  | "robots"
  | "crawl";

const scanLimits = {
  maxPages: 100,
  maxQueuedUrls: 300,
  maxLinksToCheck: 700,
  maxImagesToCheck: 500,
  maxAssetsToCheck: 350,
  maxLinkInventory: 1600,
  maxImageInventory: 1200,
};

function scanLimitsFor(maxPages: number): typeof scanLimits {
  const factor = Math.max(1, maxPages / scanLimits.maxPages);
  return {
    maxPages,
    maxQueuedUrls: Math.round(scanLimits.maxQueuedUrls * factor),
    maxLinksToCheck: Math.round(scanLimits.maxLinksToCheck * factor),
    maxImagesToCheck: Math.round(scanLimits.maxImagesToCheck * factor),
    maxAssetsToCheck: Math.round(scanLimits.maxAssetsToCheck * factor),
    maxLinkInventory: Math.round(scanLimits.maxLinkInventory * factor),
    maxImageInventory: Math.round(scanLimits.maxImageInventory * factor),
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function absoluteHttpUrl(value: string, baseUrl: string) {
  const trimmed = value.trim();
  if (!trimmed || /^(mailto:|tel:|javascript:|data:)/i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed, baseUrl);
    if (!/^https?:$/i.test(url.protocol)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function urlLike(value: string) {
  const trimmed = value.trim();
  return new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
}

function rootEquivalentHostname(hostname: string) {
  return hostname.trim().toLowerCase().replace(/^www\./i, "");
}

function siteHostKey(value: string) {
  try {
    const url = urlLike(value);
    const hostname = rootEquivalentHostname(url.hostname);
    const renderedHost = hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname;
    return `${renderedHost}${url.port ? `:${url.port}` : ""}`;
  } catch {
    return "";
  }
}

export function sameSiteUrl(url: string, scope: string) {
  const targetKey = siteHostKey(url);
  const scopeKey = siteHostKey(scope);
  return Boolean(targetKey && scopeKey && targetKey === scopeKey);
}

function normalizedUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    return url.toString();
  } catch {
    return value;
  }
}

function normalizedUrlKey(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.searchParams.sort();
    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    const hostname = rootEquivalentHostname(url.hostname);
    const renderedHost = hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname;
    return `${url.protocol.toLowerCase()}//${renderedHost}${url.port ? `:${url.port}` : ""}${url.pathname}${url.search}`;
  } catch {
    return value;
  }
}

function hasQueryParams(value: string) {
  try {
    return new URL(value).searchParams.size > 0;
  } catch {
    return value.includes("?");
  }
}

function withoutQueryUrl(value: string) {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

function isHttpOnHttpsPage(value: string, pageUrl: string) {
  try {
    return new URL(pageUrl).protocol === "https:" && new URL(value).protocol === "http:";
  } catch {
    return false;
  }
}

function isLikelyPageUrl(value: string) {
  try {
    const pathname = new URL(value).pathname.toLowerCase();
    return !/\.(?:avif|bmp|css|csv|docx?|eot|gif|gz|ico|jpe?g|js|json|m4v|map|mov|mp3|mp4|ogg|otf|pdf|png|pptx?|rar|svg|tar|ttf|txt|wav|webm|webp|woff2?|xlsx?|xml|zip)$/i.test(pathname);
  } catch {
    return true;
  }
}

function isIgnoredCrawlUrl(value: string) {
  try {
    const url = new URL(value);
    return url.pathname === "/cdn-cgi/l/email-protection";
  } catch {
    return false;
  }
}

function pageCrawlTarget(value: string, startUrl: string) {
  if (!isLikelyPageUrl(value) || isIgnoredCrawlUrl(value)) return null;
  const parameterized = hasQueryParams(value);
  const exactStartUrl = normalizedUrlKey(value) === normalizedUrlKey(startUrl);
  const url = parameterized && !exactStartUrl ? withoutQueryUrl(value) : value;
  return {
    url,
    key: normalizedUrlKey(url),
    parameterized,
  };
}

function parseSrcsetUrls(value: string, baseUrl: string) {
  return value
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .map((candidate) => absoluteHttpUrl(candidate, baseUrl))
    .filter(Boolean) as string[];
}

function srcsetCandidateCount(value: string) {
  return value
    .split(",")
    .map((candidate) => candidate.trim())
    .filter(Boolean).length;
}

function cssUrlValues(value: string, baseUrl: string) {
  const urls = new Set<string>();
  const pattern = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    const raw = cleanText(match[2] || "");
    if (!raw || /^(data:|about:|#)/i.test(raw)) continue;
    const absolute = absoluteHttpUrl(raw, baseUrl);
    if (absolute && isLikelyImageUrl(absolute)) urls.add(absolute);
  }
  return [...urls];
}

function isLikelyImageUrl(value: string) {
  try {
    const pathname = new URL(value).pathname.toLowerCase();
    return /\.(avif|gif|jpe?g|png|svg|webp)(?:$|\?)/i.test(pathname);
  } catch {
    return /\.(avif|gif|jpe?g|png|svg|webp)(?:$|\?)/i.test(value);
  }
}

function expectedImageMime(value: string) {
  try {
    const pathname = new URL(value).pathname.toLowerCase();
    if (/\.avif$/i.test(pathname)) return "image/avif";
    if (/\.gif$/i.test(pathname)) return "image/gif";
    if (/\.jpe?g$/i.test(pathname)) return "image/jpeg";
    if (/\.png$/i.test(pathname)) return "image/png";
    if (/\.svg$/i.test(pathname)) return "image/svg+xml";
    if (/\.webp$/i.test(pathname)) return "image/webp";
  } catch {
    return "";
  }
  return "";
}

function imageClassification(input: {
  src: string;
  width: string;
  height: string;
  role: string;
  ariaHidden: string;
}) {
  const width = Number.parseInt(input.width || "0", 10);
  const height = Number.parseInt(input.height || "0", 10);
  const src = input.src.toLowerCase();
  if (
    (width > 0 && width <= 2 && height > 0 && height <= 2) ||
    /(pixel|beacon|tracking|analytics|collect|transparent|spacer)/i.test(src)
  ) {
    return "tracking";
  }
  if (/^(presentation|none)$/i.test(input.role) || input.ariaHidden === "true") {
    return "decorative";
  }
  return "content";
}

// Static crawls cannot resolve external stylesheets, so CSS sizing is accepted
// from the evidence available in the HTML itself: inline styles and
// Tailwind-style utility classes. Mirrors the intent of Lighthouse's
// unsized-images audit, which passes images sized via CSS, not just attributes.
function imageIsCssSized(className: string, style: string) {
  const styleText = style.toLowerCase();
  const styleWidth = /(?:^|[;\s])width\s*:/.test(styleText);
  const styleHeight = /(?:^|[;\s])height\s*:/.test(styleText);
  const styleAspect = /aspect-ratio\s*:/.test(styleText);
  const tokens = className
    .split(/\s+/)
    .map((token) => token.split(":").pop() || "")
    .filter(Boolean);
  const hasToken = (pattern: RegExp) => tokens.some((token) => pattern.test(token));
  const classWidth = hasToken(/^(?:w-(?:\d|px|full|screen|\[)|size-)/);
  const classHeight = hasToken(/^(?:h-(?:\d|px|full|screen|\[)|size-)/);
  const classAspect = hasToken(/^aspect-/);
  const absoluteFill = hasToken(/^(?:absolute|fixed)$/) && hasToken(/^inset-/);
  return ((styleWidth || classWidth) && (styleHeight || classHeight)) || styleAspect || classAspect || absoluteFill;
}

function contentFingerprint(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length < 300) return "";
  return createHash("sha1").update(normalized).digest("hex");
}

function firstH1Fingerprint(value: string) {
  return cleanText(value).toLowerCase();
}

function isGenericAltText(value: string, src: string) {
  const alt = cleanText(value).toLowerCase();
  if (!alt) return false;
  if (/^(image|photo|picture|graphic|banner|logo|icon|screenshot|thumbnail)$/i.test(alt)) return true;
  try {
    const path = new URL(src).pathname;
    const filename = decodeURIComponent(path.split("/").filter(Boolean).pop() || "")
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[-_]+/g, " ")
      .trim()
      .toLowerCase();
    return Boolean(filename && alt === filename);
  } catch {
    return false;
  }
}

function isLikelyTrackingUrl(value: string) {
  try {
    const url = new URL(value);
    return [...url.searchParams.keys()].some((key) =>
      /^(utm_|fbclid$|gclid$|msclkid$|mc_cid$|mc_eid$|igshid$|ref$|source$)/i.test(key),
    );
  } catch {
    return false;
  }
}

function isValidLangCode(value: string) {
  return /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(value);
}

// Ahrefs-style health score: (pages without errors / pages) × 100, where
// only high-severity issues count as errors. Medium and low findings
// inform the report but never move the score — matching
// https://help.ahrefs.com/en/articles/1424673
function healthScore(pages: any[], issues: any[]) {
  const pageKeys = new Set(pages.map((page) => normalizedUrlKey(page.url)));
  const highPages = new Set<string>();
  for (const issue of issues) {
    if (issue.severity !== "high") continue;
    const key = normalizedUrlKey(issue.url || "");
    if (pageKeys.has(key)) highPages.add(key);
  }
  return pages.length === 0
    ? 0
    : Math.max(0, Math.min(100, Math.round((100 * (pages.length - highPages.size)) / pages.length)));
}

function severityCounts(rows: any[]) {
  return {
    high: rows.filter((issue) => issue.severity === "high").length,
    medium: rows.filter((issue) => issue.severity === "medium").length,
    low: rows.filter((issue) => issue.severity === "low").length,
  };
}

function issuePriority(severity: ScanIssueSeverity) {
  return severity === "high" ? 3 : severity === "medium" ? 2 : 1;
}

function pushScanIssue(
  issues: any[],
  pageIssues: any[] | undefined,
  issue: {
    url: string;
    severity: ScanIssueSeverity;
    category: ScanIssueCategory;
    type: string;
    message: string;
    recommendation: string;
    evidence?: Record<string, unknown>;
  },
) {
  const row = {
    id: randomUUID(),
    ...issue,
  };
  issues.push(row);
  pageIssues?.push(row);
  return row;
}

function groupDuplicateValues(pages: any[], key: string) {
  const map = new Map<string, any[]>();
  for (const page of pages) {
    const value = cleanText(String(page[key] || ""));
    if (!value) continue;
    const rows = map.get(value) || [];
    rows.push(page);
    map.set(value, rows);
  }
  return [...map.entries()].filter(([, rows]) => rows.length > 1);
}

function groupIssueSummary(issues: any[]) {
  const groups = new Map<string, any>();
  for (const issue of issues) {
    const key = `${issue.category}:${issue.type}`;
    const existing = groups.get(key) || {
      key,
      category: issue.category,
      type: issue.type,
      severity: issue.severity,
      message: issue.message,
      recommendation: issue.recommendation,
      count: 0,
      urls: [],
    };
    existing.count += 1;
    if (issuePriority(issue.severity) > issuePriority(existing.severity)) {
      existing.severity = issue.severity;
      existing.message = issue.message;
      existing.recommendation = issue.recommendation;
    }
    if (issue.url && existing.urls.length < 8 && !existing.urls.includes(issue.url)) {
      existing.urls.push(issue.url);
    }
    groups.set(key, existing);
  }
  return [...groups.values()].sort((a, b) => {
    const severityDelta = issuePriority(b.severity) - issuePriority(a.severity);
    if (severityDelta) return severityDelta;
    return b.count - a.count;
  });
}

function issueComparisonKey(issue: any) {
  const evidence = issue?.evidence || {};
  const subject = evidence.linkedUrl || evidence.image || evidence.asset || evidence.canonical || evidence.finalUrl || "";
  return [normalizedUrlKey(String(issue?.url || "")), String(issue?.type || ""), normalizedUrlKey(String(subject))].join("|");
}

function comparisonIssue(issue: any, change: string, extra: Record<string, unknown> = {}) {
  const evidence = issue?.evidence || {};
  return {
    change,
    url: issue?.url || "",
    category: issue?.category || "",
    type: issue?.type || "",
    severity: issue?.severity || "low",
    message: issue?.message || String(issue?.type || "Issue").replaceAll("-", " "),
    subject: evidence.linkedUrl || evidence.image || evidence.asset || evidence.canonical || evidence.finalUrl || "",
    ...extra,
  };
}

function emptyScanComparison(reason: string, previousScan?: any) {
  return {
    available: false,
    reason,
    previousScanId: previousScan?.id || null,
    previousCreatedAt: previousScan?.created_at || null,
    summary: { newIssues: 0, fixedIssues: 0, severityChanges: 0, regressions: 0, pageChanges: 0 },
    newIssues: [],
    fixedIssues: [],
    severityChanges: [],
    pageChanges: [],
  };
}

function buildScanComparison(previousScan: any, pages: any[], issues: any[], limits: typeof scanLimits) {
  const previousResult = jsonParse<any>(previousScan?.result_json, null);
  if (!previousScan || !previousResult) {
    return emptyScanComparison("no-previous-scan");
  }
  if (Number(previousResult.scanVersion || 0) !== SCAN_RESULT_VERSION) {
    return emptyScanComparison("incompatible-version", previousScan);
  }
  if (Number(previousResult.limits?.maxPages || 0) !== Number(limits.maxPages || 0)) {
    return emptyScanComparison("scope-changed", previousScan);
  }

  const previousPages = Array.isArray(previousResult.pages) ? previousResult.pages : [];
  const previousPageMap = new Map<string, any>(
    previousPages.map((page: any) => [normalizedUrlKey(String(page.url || "")), page]),
  );
  const currentPageMap = new Map<string, any>(
    pages.map((page: any) => [normalizedUrlKey(String(page.url || "")), page]),
  );
  const previousIssues = Array.isArray(previousResult.issues) ? previousResult.issues : [];
  const previousIssueMap = new Map<string, any>(previousIssues.map((issue: any) => [issueComparisonKey(issue), issue]));
  const currentIssueMap = new Map<string, any>(issues.map((issue: any) => [issueComparisonKey(issue), issue]));
  const newIssues = [...currentIssueMap.entries()]
    .filter(([key]) => !previousIssueMap.has(key))
    .map(([, issue]) => comparisonIssue(issue, "new"));
  const fixedIssues = [...previousIssueMap.entries()]
    .filter(([key, issue]) => {
      if (currentIssueMap.has(key)) return false;
      const pageKey = normalizedUrlKey(String(issue?.url || ""));
      return !previousPageMap.has(pageKey) || currentPageMap.has(pageKey);
    })
    .map(([, issue]) => comparisonIssue(issue, "fixed"));
  const severityChanges = [...currentIssueMap.entries()].flatMap(([key, issue]) => {
    const previous = previousIssueMap.get(key);
    if (!previous || previous.severity === issue.severity) return [];
    return [
      comparisonIssue(issue, "severity-changed", {
        previousSeverity: previous.severity || "low",
        currentSeverity: issue.severity || "low",
      }),
    ];
  });

  const pageChanges: any[] = [];
  const addPageChange = (
    type: string,
    label: string,
    url: string,
    field: string,
    before: unknown,
    after: unknown,
    regression = false,
  ) => {
    pageChanges.push({ type, label, url, field, before, after, regression });
  };

  for (const [key, page] of currentPageMap) {
    const previous = previousPageMap.get(key);
    if (!previous) {
      addPageChange("page-added", "Page discovered", page.url, "Page", "Not crawled", "Crawled");
      continue;
    }
    if (typeof previous.indexable === "boolean" && typeof page.indexable === "boolean" && previous.indexable !== page.indexable) {
      addPageChange(
        page.indexable ? "became-indexable" : "became-non-indexable",
        page.indexable ? "Page became indexable" : "Page became non-indexable",
        page.url,
        "Indexability",
        previous.indexable ? "Indexable" : "Non-indexable",
        page.indexable ? "Indexable" : "Non-indexable",
        !page.indexable,
      );
    }
    const previousStatus = Number(previous.status || 0);
    const currentStatus = Number(page.status || 0);
    if (previousStatus !== currentStatus) {
      addPageChange(
        "http-status-changed",
        "HTTP status changed",
        page.url,
        "HTTP status",
        previousStatus || "Unknown",
        currentStatus || "Unknown",
        (previousStatus < 300 && currentStatus >= 300) || (previousStatus < 400 && currentStatus >= 400),
      );
    }
    const previousFinalUrl = normalizedUrl(String(previous.finalUrl || previous.url || ""));
    const currentFinalUrl = normalizedUrl(String(page.finalUrl || page.url || ""));
    if (previousFinalUrl !== currentFinalUrl) {
      addPageChange("redirect-target-changed", "Redirect destination changed", page.url, "Final URL", previousFinalUrl, currentFinalUrl, true);
    }
    const fields = [
      { key: "title", label: "Title changed", field: "Title" },
      { key: "description", label: "Meta description changed", field: "Meta description" },
      { key: "h1", label: "H1 changed", field: "H1" },
      { key: "wordCount", label: "Word count changed", field: "Word count" },
    ];
    for (const item of fields) {
      const before = previous[item.key] ?? "";
      const after = page[item.key] ?? "";
      if (String(before) !== String(after)) {
        addPageChange(`${item.key}-changed`, item.label, page.url, item.field, before, after);
      }
    }
    if (Boolean(previous.sitemapListed) !== Boolean(page.sitemapListed)) {
      addPageChange(
        page.sitemapListed ? "page-added-to-sitemap" : "page-removed-from-sitemap",
        page.sitemapListed ? "Page added to sitemap" : "Page removed from sitemap",
        page.url,
        "Sitemap",
        previous.sitemapListed ? "Listed" : "Not listed",
        page.sitemapListed ? "Listed" : "Not listed",
        !page.sitemapListed && page.indexable === true,
      );
    }
  }
  for (const [key, page] of previousPageMap) {
    if (!currentPageMap.has(key)) {
      addPageChange("page-removed", "Page no longer crawled", page.url, "Page", "Crawled", "Not crawled", true);
    }
  }

  return {
    available: true,
    previousScanId: previousScan.id,
    previousCreatedAt: previousScan.created_at,
    summary: {
      newIssues: newIssues.length,
      fixedIssues: fixedIssues.length,
      severityChanges: severityChanges.length,
      regressions: pageChanges.filter((change) => change.regression).length,
      pageChanges: pageChanges.length,
    },
    newIssues,
    fixedIssues,
    severityChanges,
    pageChanges,
  };
}

export function resourceFailureKind(error: unknown) {
  const message = String(error || "");
  if (/(certificate|cert\b|issuer|self[- ]signed|ssl|tls|unable to verify)/i.test(message)) return "tls-certificate";
  if (/(abort|timeout|timed out)/i.test(message)) return "timeout";
  if (/(dns|enotfound|name.*resolve|host.*not found)/i.test(message)) return "dns";
  return "request";
}

async function checkResource(url: string, method: "HEAD" | "GET" = "HEAD") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    let trace = await fetchWithRedirectTrace(url, {
      method,
      signal: controller.signal,
      headers: {
        "User-Agent": "LocalSEO/0.1 (+https://localhost)",
        Accept: "*/*",
        ...(method === "GET" ? { Range: "bytes=0-2048" } : {}),
      },
    });
    if (method === "HEAD" && [403, 405, 501].includes(trace.finalStatus)) {
      trace = await fetchWithRedirectTrace(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          "User-Agent": "LocalSEO/0.1 (+https://localhost)",
          Accept: "*/*",
          Range: "bytes=0-2048",
        },
      });
    }
    const { response } = trace;
    // A ranged GET reports the partial length in Content-Length; the true total
    // is in Content-Range ("bytes 0-2048/524288"). Prefer that so size checks work.
    const rangeTotal = Number((response.headers.get("content-range") || "").split("/")[1]) || null;
    const partialLength = Number(response.headers.get("content-length") || 0) || null;
    return {
      ok: response.status < 400 && !trace.redirectError,
      status: trace.originalStatus,
      finalStatus: trace.finalStatus,
      finalUrl: trace.finalUrl,
      redirected: trace.redirected,
      redirectChain: trace.redirectChain,
      redirectLoop: trace.redirectLoop,
      redirectError: trace.redirectError,
      contentType: response.headers.get("content-type") || "",
      contentLength: response.status === 206 ? rangeTotal ?? partialLength : partialLength,
      contentEncoding: response.headers.get("content-encoding") || "",
      error: trace.redirectError,
      failureKind: trace.redirectError ? "redirect" : "",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    return {
      ok: false,
      status: null,
      finalStatus: null,
      finalUrl: url,
      redirected: false,
      redirectChain: [],
      redirectLoop: false,
      redirectError: "",
      contentType: "",
      contentLength: null,
      error: message,
      failureKind: resourceFailureKind(message),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseRobots(text: string) {
  const sitemaps: string[] = [];
  let disallowCount = 0;
  let blocksAll = false;
  let crawlDelaySeconds = 0;
  // Track the user-agent group each directive belongs to. `Disallow: /` only
  // blocks our crawl when it applies to `*` (or all agents), so a targeted block
  // like `User-agent: GPTBot\nDisallow: /` must not flag the whole site.
  let currentAgents: string[] = [];
  let sawDirectiveInGroup = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "sitemap" && value) {
      if (value) sitemaps.push(value);
      continue;
    }
    if (key === "user-agent") {
      // Consecutive user-agent lines share the same following directive block.
      if (sawDirectiveInGroup) {
        currentAgents = [];
        sawDirectiveInGroup = false;
      }
      currentAgents.push(value.toLowerCase());
      continue;
    }
    if (key === "disallow") {
      sawDirectiveInGroup = true;
      const appliesToAll = currentAgents.length === 0 || currentAgents.includes("*");
      if (appliesToAll) {
        disallowCount += 1;
        if (value === "/") blocksAll = true;
      }
    } else if (key === "allow") {
      sawDirectiveInGroup = true;
    } else if (key === "crawl-delay") {
      sawDirectiveInGroup = true;
      const appliesToAll = currentAgents.length === 0 || currentAgents.includes("*");
      const seconds = Number(value);
      if (appliesToAll && Number.isFinite(seconds) && seconds > 0) {
        crawlDelaySeconds = Math.max(crawlDelaySeconds, seconds);
      }
    }
  }
  return { sitemaps: [...new Set(sitemaps)], disallowCount, blocksAll, crawlDelaySeconds };
}

async function readRobots(origin: string) {
  const url = `${origin}/robots.txt`;
  try {
    const response = await fetchText(url);
    if (!response.ok) {
      return {
        exists: false,
        url,
        status: response.finalStatus,
        sourceStatus: response.status,
        redirectChain: response.redirectChain,
        sitemaps: [],
        disallowCount: 0,
        blocksAll: false,
      };
    }
    return {
      exists: true,
      url,
      status: response.finalStatus,
      sourceStatus: response.status,
      redirectChain: response.redirectChain,
      ...parseRobots(response.text),
    };
  } catch (error) {
    return {
      exists: false,
      url,
      status: null,
      sitemaps: [],
      disallowCount: 0,
      blocksAll: false,
      error: error instanceof Error ? error.message : "Could not fetch robots.txt",
    };
  }
}

function collectXmlLocs(node: any, locs = new Set<string>()) {
  if (!node || typeof node !== "object") return locs;
  if (typeof node.loc === "string") locs.add(node.loc.trim());
  if (Array.isArray(node.loc)) {
    for (const loc of node.loc) if (typeof loc === "string") locs.add(loc.trim());
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((item) => collectXmlLocs(item, locs));
    else if (value && typeof value === "object") collectXmlLocs(value, locs);
  }
  return locs;
}

async function readSitemaps(origin: string, robotsSitemaps: string[]) {
  const candidates = [...new Set([
    ...robotsSitemaps.map((item) => {
      try {
        return new URL(item, origin).toString();
      } catch {
        return item;
      }
    }),
    `${origin}/sitemap.xml`,
  ])];
  const parser = new XMLParser({ ignoreAttributes: false });
  const sitemaps = [];
  const urls = new Set<string>();
  const queue = [...candidates];
  const seen = new Set<string>();
  while (queue.length > 0 && sitemaps.length < 25) {
    const sitemapUrl = queue.shift()!;
    if (seen.has(sitemapUrl)) continue;
    seen.add(sitemapUrl);
    try {
      const response = await fetchText(sitemapUrl);
      if (!response.ok) {
        sitemaps.push({
          url: sitemapUrl,
          status: response.finalStatus,
          sourceStatus: response.status,
          redirectChain: response.redirectChain,
          ok: false,
          urlCount: 0,
        });
        continue;
      }
      const parsed = parser.parse(response.text);
      const nestedSitemaps = [...collectXmlLocs(parsed.sitemapindex || {})].filter((loc) => /^https?:\/\//i.test(loc));
      const urlLocs = [...collectXmlLocs(parsed.urlset || {})].filter((loc) => /^https?:\/\//i.test(loc));
      const fallbackLocs = !nestedSitemaps.length && !urlLocs.length ? [...collectXmlLocs(parsed)].filter(Boolean) : [];
      for (const nested of nestedSitemaps) {
        if (!seen.has(nested) && queue.length + sitemaps.length < 25) queue.push(nested);
      }
      for (const loc of [...urlLocs, ...fallbackLocs]) {
        if (/^https?:\/\//i.test(loc)) urls.add(loc);
      }
      sitemaps.push({
        url: sitemapUrl,
        status: response.finalStatus,
        sourceStatus: response.status,
        redirectChain: response.redirectChain,
        ok: true,
        type: nestedSitemaps.length ? "index" : "urlset",
        urlCount: urlLocs.length || fallbackLocs.length,
        childSitemapCount: nestedSitemaps.length,
      });
    } catch (error) {
      sitemaps.push({
        url: sitemapUrl,
        status: null,
        ok: false,
        urlCount: 0,
        error: error instanceof Error ? error.message : "Could not parse sitemap",
      });
    }
  }
  return { sitemaps, urls: [...urls] };
}

function scanSummary(
  issues: any[],
  pages: any[],
  checkedLinks: any[],
  checkedImages: any[],
  checkedAssets: any[],
  imageInventory: any[],
  linkInventory: any[],
  parameterUrls: any[],
  phase: string,
) {
  const bySeverity = severityCounts(issues);
  const byCategory = issues.reduce<Record<string, number>>((acc, issue) => {
    acc[issue.category] = (acc[issue.category] || 0) + 1;
    return acc;
  }, {});
  const pageLoadTimes = pages
    .map((page) => Number(page.loadMs))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  const loadPercentile = (percentile: number) => {
    if (!pageLoadTimes.length) return 0;
    const index = Math.min(pageLoadTimes.length - 1, Math.max(0, Math.ceil((percentile / 100) * pageLoadTimes.length) - 1));
    return pageLoadTimes[index] || 0;
  };
  const averagePageLoadMs = pageLoadTimes.length
    ? Math.round(pageLoadTimes.reduce((sum, value) => sum + value, 0) / pageLoadTimes.length)
    : 0;
  const redirectingLinks = checkedLinks.filter(
    (link) => link.redirected || (link.finalUrl && link.finalUrl !== link.url),
  );
  const redirectingLinkPages = new Set(
    redirectingLinks.flatMap((link) =>
      Array.isArray(link.sourcePages) && link.sourcePages.length ? link.sourcePages : link.from ? [link.from] : [],
    ),
  );
  const unverifiedLinks = checkedLinks.filter((link) => link.ok === false && link.failureKind === "tls-certificate");
  const unverifiedImages = checkedImages.filter(
    (image) => image.ok === false && image.failureKind === "tls-certificate",
  );
  const unverifiedAssets = checkedAssets.filter(
    (asset) => asset.ok === false && asset.failureKind === "tls-certificate",
  );
  return {
    phase,
    pages: pages.length,
    measuredPageLoads: pageLoadTimes.length,
    averagePageLoadMs,
    medianPageLoadMs: loadPercentile(50),
    p95PageLoadMs: loadPercentile(95),
    slowestPageLoadMs: pageLoadTimes[pageLoadTimes.length - 1] || 0,
    slowPages: pageLoadTimes.filter((value) => value > 2000).length,
    verySlowPages: pageLoadTimes.filter((value) => value > 4000).length,
    indexabilityKnownPages: pages.filter((page) => typeof page.indexable === "boolean").length,
    indexablePages: pages.filter((page) => page.indexable === true).length,
    nonIndexablePages: pages.filter((page) => page.indexable === false).length,
    unknownIndexabilityPages: pages.filter((page) => typeof page.indexable !== "boolean").length,
    thinPages: issues.filter((issue) => issue.type === "thin-content").length,
    noH1Pages: issues.filter((issue) => issue.type === "h1-count" && /Missing H1/i.test(issue.message)).length,
    duplicateH1Pages: issues.filter((issue) => issue.type === "duplicate-h1").length,
    duplicateContentPages: issues.filter((issue) => issue.type === "duplicate-content").length,
    orphanPages: issues.filter((issue) => issue.type === "orphan-page").length,
    deepPages: issues.filter((issue) => issue.type === "crawl-depth-deep").length,
    sitemapUrls: [...new Set(pages.flatMap((page) => page.sitemapListed ? [page.url] : []))].length,
    pagesMissingFromSitemap: issues.filter((issue) => issue.type === "page-missing-from-sitemap").length,
    noindexPagesInSitemap: issues.filter((issue) => issue.type === "noindex-page-in-sitemap").length,
    checkedLinks: checkedLinks.length,
    brokenLinks: checkedLinks.filter((link) => !link.ok && link.failureKind !== "tls-certificate").length,
    unverifiedLinks: unverifiedLinks.length,
    checkedImages: checkedImages.length,
    brokenImages: checkedImages.filter((image) => !image.ok && image.failureKind !== "tls-certificate").length,
    unverifiedImages: unverifiedImages.length,
    redirectedImages: checkedImages.filter((image) => image.redirected || (image.finalUrl && image.finalUrl !== image.url)).length,
    cssImageResources: checkedImages.filter((image) => image.purpose === "css-url" || image.purpose === "external-css-url").length,
    pictureSourceImages: checkedImages.filter((image) => image.purpose === "picture-source" || image.purpose === "source-srcset").length,
    largeImages: issues.filter((issue) => issue.type === "large-image").length,
    imageExtensionMismatches: issues.filter((issue) => issue.type === "image-extension-mismatch").length,
    checkedAssets: checkedAssets.length,
    brokenAssets: checkedAssets.filter((asset) => !asset.ok && asset.failureKind !== "tls-certificate").length,
    unverifiedAssets: unverifiedAssets.length,
    largeAssets: issues.filter((issue) => issue.type === "large-css" || issue.type === "large-javascript").length,
    renderBlockingScripts: issues.filter((issue) => issue.type === "render-blocking-javascript").length,
    redirectedLinks: redirectingLinks.length,
    redirectedLinkTargets: redirectingLinks.length,
    redirectedLinkPages: redirectingLinkPages.size,
    redirectedLinkReferences: redirectingLinks.reduce(
      (total, link) => total + Math.max(1, Number(link.referenceCount || 0)),
      0,
    ),
    linkTags: Math.max(
      linkInventory.length,
      pages.reduce(
        (total, page) => total + Number(page.internalLinks || 0) + Number(page.externalLinks || 0),
        0,
      ),
    ),
    internalLinks: linkInventory.filter((link) => link.type === "internal").length,
    externalLinks: linkInventory.filter((link) => link.type === "external").length,
    parameterUrls: parameterUrls.length,
    parameterUrlTargets: new Set(parameterUrls.map((row) => row.crawlUrl || row.path || row.url)).size,
    emptyAnchorLinks: issues.filter((issue) => issue.type === "empty-anchor-text").length,
    internalNofollowLinks: issues.filter((issue) => issue.type === "internal-nofollow").length,
    imageTags: imageInventory.length,
    imageTagsWithIssues: imageInventory.filter((image) => image.issues?.length).length,
    imagesMissingDimensions: issues.filter((issue) => issue.type === "image-dimensions-missing").length,
    imagesMissingSrcset: issues.filter((issue) => issue.type === "image-srcset-missing").length,
    imagesMissingLazyLoading: issues.filter((issue) => issue.type === "image-lazy-loading-missing").length,
    imageIssues: issues.filter((issue) => issue.category === "images").length,
    assetIssues: issues.filter((issue) => issue.category === "assets").length,
    metadataIssues: issues.filter((issue) => issue.category === "metadata").length,
    duplicateIssues: issues.filter((issue) => issue.type.startsWith("duplicate-")).length,
    missingTitles: issues.filter((issue) => issue.type === "title-missing").length,
    titleLengthIssues: issues.filter((issue) => issue.type === "title-length").length,
    missingDescriptions: issues.filter((issue) => issue.type === "description-missing").length,
    descriptionLengthIssues: issues.filter((issue) => issue.type === "description-length").length,
    missingAlt: issues.filter((issue) => issue.type === "image-alt-missing" || issue.type === "image-alt-empty").length,
    genericAlt: issues.filter((issue) => issue.type === "image-alt-generic").length,
    longAlt: issues.filter((issue) => issue.type === "image-alt-too-long").length,
    schemaIssues: issues.filter((issue) => issue.category === "structured-data").length,
    socialIssues: issues.filter((issue) => issue.category === "social").length,
    securityIssues: issues.filter((issue) => issue.category === "security").length,
    performanceIssues: issues.filter((issue) => issue.category === "performance" || issue.category === "assets").length,
    bySeverity,
    byCategory,
  };
}

function scanResult(input: {
  startUrl: string;
  origin: string;
  phase: string;
  pages: any[];
  issues: any[];
  checkedLinks: any[];
  checkedImages: any[];
  checkedAssets: any[];
  imageInventory: any[];
  linkInventory: any[];
  parameterUrls: any[];
  robots: any;
  sitemap: any;
  limits: typeof scanLimits;
  comparison?: any;
}) {
  const sortedIssues = [...input.issues].sort((a, b) => issuePriority(b.severity) - issuePriority(a.severity));
  return {
    scanVersion: SCAN_RESULT_VERSION,
    startUrl: input.startUrl,
    origin: input.origin,
    phase: input.phase,
    limits: input.limits,
    summary: scanSummary(
      sortedIssues,
      input.pages,
      input.checkedLinks,
      input.checkedImages,
      input.checkedAssets,
      input.imageInventory,
      input.linkInventory,
      input.parameterUrls,
      input.phase,
    ),
    robots: input.robots,
    sitemap: input.sitemap,
    pages: input.pages,
    issues: sortedIssues,
    issueGroups: groupIssueSummary(sortedIssues),
    links: input.checkedLinks,
    linkInventory: input.linkInventory,
    images: input.checkedImages,
    imageInventory: input.imageInventory,
    assets: input.checkedAssets,
    parameterUrls: input.parameterUrls,
    ...(input.comparison ? { comparison: input.comparison } : {}),
  };
}

async function runLocalScan(scanId: string) {
  const scan = get<any>("SELECT * FROM scans WHERE id = ?", [scanId]);
  if (!scan) return;
  run("UPDATE scans SET status = 'running', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [
    scanId,
  ]);
  const startUrl = /^https?:\/\//i.test(scan.url) ? scan.url : `https://${scan.url}`;
  const origin = new URL(startUrl).origin;
  const site = getSite(scan.site_id);
  const siteSpeed = site?.crawl_speed === "polite" || site?.crawl_speed === "fast" ? site.crawl_speed : "";
  const defaultSpeed = getConfigValue("default_crawl_speed") === "fast" ? "fast" : "polite";
  const crawlSpeed = siteSpeed || defaultSpeed;
  const siteMaxPages = Math.round(Number(site?.crawl_max_pages || 0));
  const defaultMaxPages = Math.round(Number(getConfigValue("default_crawl_max_pages") || 0));
  const maxPages = Math.max(10, Math.min(1000, siteMaxPages > 0 ? siteMaxPages : defaultMaxPages > 0 ? defaultMaxPages : scanLimits.maxPages));
  const limits = scanLimitsFor(maxPages);
  // Pacing only matters against real remote hosts; localhost targets crawl at full speed.
  const politeTarget = crawlSpeed === "polite" && !localHostFirst(new URL(startUrl).hostname);
  let pageDelayMs = 400;
  let consecutiveRateLimits = 0;
  const startKey = normalizedUrlKey(startUrl);
  const visited = new Set<string>();
  const processedContent = new Set<string>();
  const queued = new Set<string>([startKey]);
  const queue = [startUrl];
  const depthByUrl = new Map<string, number>([[startKey, 0]]);
  const discoveryByUrl = new Map<string, string>([[startKey, "start-url"]]);
  const internalInlinks = new Map<string, number>();
  const pages: any[] = [];
  const issues: any[] = [];
  const checkedLinks: any[] = [];
  const checkedImages: any[] = [];
  const checkedAssets: any[] = [];
  const imageInventory: any[] = [];
  const linkInventory: any[] = [];
  const parameterUrls: any[] = [];
  const parameterUrlKeys = new Set<string>();
  const linksToCheck = new Map<string, any>();
  const imagesToCheck = new Map<string, any>();
  const assetsToCheck = new Map<string, any>();
  const pageIssueMap = new Map<string, any[]>();
  let phase = "starting";
  let robots: any = { exists: false, sitemaps: [] };
  let sitemap: any = { sitemaps: [], urls: [] };

  const pageBucket = (url: string) => {
    const existing = pageIssueMap.get(url);
    if (existing) return existing;
    const next: any[] = [];
    pageIssueMap.set(url, next);
    return next;
  };

  const recordRedirectIssues = (url: string, pageIssues: any[], response: any) => {
    if (response.redirected) {
      const temporaryRedirect = response.status === 302 || response.status === 307;
      pushScanIssue(issues, pageIssues, {
        url,
        severity: "low",
        category: "crawl",
        type: temporaryRedirect ? "temporary-redirect" : "redirected-url",
        message: temporaryRedirect
          ? `URL uses a temporary HTTP ${response.status} redirect`
          : `URL redirects with HTTP ${response.status}`,
        recommendation: temporaryRedirect
          ? "Use 301 or 308 when the move is permanent; keep the temporary redirect only when the original URL will return."
          : "Link directly to the final URL to reduce crawl waste and latency.",
        evidence: {
          status: response.status,
          finalStatus: response.finalStatus,
          finalUrl: response.url,
          redirectChain: response.redirectChain,
        },
      });
    }
    if (response.redirectChain.length > 1 && !response.redirectLoop) {
      pushScanIssue(issues, pageIssues, {
        url,
        severity: "medium",
        category: "crawl",
        type: "redirect-chain",
        message: `URL follows a ${response.redirectChain.length}-hop redirect chain`,
        recommendation: "Redirect directly to the final destination in one hop.",
        evidence: { finalUrl: response.url, redirectChain: response.redirectChain },
      });
    }
    if (response.redirectLoop) {
      pushScanIssue(issues, pageIssues, {
        url,
        severity: "high",
        category: "crawl",
        type: "redirect-loop",
        message: "URL is trapped in a redirect loop",
        recommendation: "Break the redirect cycle so the URL resolves to one final response.",
        evidence: { redirectChain: response.redirectChain, error: response.redirectError },
      });
    } else if (response.redirectError) {
      pushScanIssue(issues, pageIssues, {
        url,
        severity: "high",
        category: "crawl",
        type: "redirect-failed",
        message: response.redirectError,
        recommendation: "Fix the redirect location or shorten the chain so the URL reaches a final response.",
        evidence: { redirectChain: response.redirectChain, error: response.redirectError },
      });
    }
  };

  const addParameterUrl = (url: string, source: string, from?: string, crawlUrl?: string) => {
    if (!hasQueryParams(url)) return;
    const key = normalizedUrlKey(url);
    if (parameterUrlKeys.has(key)) return;
    parameterUrlKeys.add(key);
    try {
      const parsed = new URL(url);
      parameterUrls.push({
        url,
        from,
        source,
        path: `${parsed.origin}${parsed.pathname}`,
        query: parsed.search.replace(/^\?/, ""),
        crawlUrl: crawlUrl || withoutQueryUrl(url),
      });
    } catch {
      parameterUrls.push({ url, from, source, crawlUrl: crawlUrl || withoutQueryUrl(url) });
    }
  };

  const persistProgress = (status = "running") => {
    const result = scanResult({
      startUrl,
      origin,
      phase,
      pages,
      issues,
      checkedLinks,
      checkedImages,
      checkedAssets,
      imageInventory,
      linkInventory,
      parameterUrls,
      robots,
      sitemap,
      limits,
    });
    run(
      `
      UPDATE scans
      SET status = ?,
          pages_crawled = ?,
          issue_count = ?,
          result_json = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [status, pages.length, issues.length, JSON.stringify(result), scanId],
    );
  };

  phase = "robots";
  robots = await readRobots(origin);
  const robotsDelaySeconds = Number((robots as any).crawlDelaySeconds || 0);
  if (politeTarget && robotsDelaySeconds > 0) {
    pageDelayMs = Math.max(pageDelayMs, Math.min(robotsDelaySeconds * 1000, 10_000));
  }
  sitemap = await readSitemaps(origin, robots.sitemaps || []);
  const sitemapUrlSet = new Set((sitemap.urls || []).map((url: string) => {
    const absolute = absoluteHttpUrl(String(url), origin);
    return absolute ? pageCrawlTarget(absolute, startUrl)?.key || normalizedUrlKey(absolute) : normalizedUrlKey(url);
  }));
  for (const sitemapUrl of sitemap.urls || []) {
    const absolute = absoluteHttpUrl(String(sitemapUrl), origin);
    const target = absolute ? pageCrawlTarget(absolute, startUrl) : null;
    if (absolute && target?.parameterized) addParameterUrl(absolute, "sitemap", undefined, target.url);
    if (
      absolute &&
      sameSiteUrl(absolute, startUrl) &&
      target &&
      target.key !== startKey &&
      !queued.has(target.key) &&
      queue.length + visited.size < limits.maxQueuedUrls
    ) {
      queued.add(target.key);
      queue.push(target.url);
      depthByUrl.set(target.key, 0);
      discoveryByUrl.set(target.key, "sitemap");
    }
  }
  if (!robots.exists) {
    pushScanIssue(issues, undefined, {
      url: `${origin}/robots.txt`,
      severity: "low",
      category: "robots",
      type: "robots-missing",
      message: "robots.txt was not found",
      recommendation: "Add robots.txt so crawlers can discover sitemap locations and crawl rules.",
      evidence: { status: robots.status, error: robots.error },
    });
  } else if (robots.blocksAll) {
    pushScanIssue(issues, undefined, {
      url: robots.url,
      severity: "high",
      category: "robots",
      type: "robots-blocks-all",
      message: "robots.txt contains Disallow: /",
      recommendation: "Remove the global block unless the entire site should be hidden from crawlers.",
      evidence: { disallowCount: robots.disallowCount },
    });
  }
  if (robots.exists && !(robots.sitemaps || []).length) {
    pushScanIssue(issues, undefined, {
      url: robots.url,
      severity: "low",
      category: "robots",
      type: "robots-sitemap-missing",
      message: "robots.txt does not declare a sitemap",
      recommendation: "Add a Sitemap directive to robots.txt so crawlers discover the preferred sitemap location quickly.",
      evidence: { disallowCount: robots.disallowCount },
    });
  }
  for (const item of sitemap.sitemaps || []) {
    if (!item.ok) {
      pushScanIssue(issues, undefined, {
        url: item.url,
        severity: "medium",
        category: "sitemap",
        type: "sitemap-fetch-failed",
        message: "Sitemap URL could not be fetched or parsed",
        recommendation: "Fix the sitemap response, XML syntax, or robots.txt sitemap reference.",
        evidence: { status: item.status, error: item.error },
      });
    }
  }
  if (!sitemap.urls.length) {
    pushScanIssue(issues, undefined, {
      url: `${origin}/sitemap.xml`,
      severity: "medium",
      category: "sitemap",
      type: "sitemap-missing-or-empty",
      message: "No sitemap URLs were found",
      recommendation: "Publish an XML sitemap and reference it from robots.txt.",
      evidence: { sitemaps: sitemap.sitemaps },
    });
  }
  if ((sitemap.urls || []).length > limits.maxQueuedUrls) {
    pushScanIssue(issues, undefined, {
      url: `${origin}/sitemap.xml`,
      severity: "low",
      category: "sitemap",
      type: "sitemap-larger-than-crawl-limit",
      message: `Sitemap has more URLs than this local scan will crawl (${(sitemap.urls || []).length})`,
      recommendation: "Raise the local crawl limit for a full-site run, or scan important sections separately.",
      evidence: { sitemapUrls: (sitemap.urls || []).length, crawlLimit: limits.maxQueuedUrls },
    });
  }
  persistProgress();

  phase = "crawling";
  while (queue.length > 0 && visited.size < limits.maxPages) {
    const requestedUrl = queue.shift()!;
    const requestedKey = normalizedUrlKey(requestedUrl);
    queued.delete(requestedKey);
    if (visited.has(requestedKey) || processedContent.has(requestedKey)) continue;
    visited.add(requestedKey);
    let current = requestedUrl;
    let currentKey = requestedKey;
    const requestedPageIssues = pageBucket(requestedUrl);
    let pageIssues = requestedPageIssues;
    let currentDepth = depthByUrl.get(requestedKey) ?? 0;

    try {
      let startedAt = Date.now();
      let response = await fetchText(requestedUrl);
      let loadMs = Date.now() - startedAt;
      if (response.finalStatus === 429 || response.finalStatus === 503) {
        // Back off once, honoring Retry-After, before recording the response.
        const retrySeconds = Math.min(Math.max(Number(response.retryAfter) || 5, 1), 30);
        await sleep(retrySeconds * 1000);
        startedAt = Date.now();
        response = await fetchText(requestedUrl);
        loadMs = Date.now() - startedAt;
      }
      consecutiveRateLimits =
        response.finalStatus === 429 || response.finalStatus === 503 ? consecutiveRateLimits + 1 : 0;
      if (response.redirectError) {
        recordRedirectIssues(requestedUrl, requestedPageIssues, response);
        const finalUrl = response.url || requestedUrl;
        pages.push({
          url: requestedUrl,
          finalUrl,
          status: response.status,
          finalStatus: response.finalStatus,
          redirected: response.redirected,
          redirectChain: response.redirectChain,
          redirectLoop: response.redirectLoop,
          redirectError: response.redirectError,
          contentType: response.contentType,
          loadMs,
          indexable: false,
          finalIndexable: false,
          indexabilityReason: response.redirectLoop ? "redirect-loop" : "redirect-failed",
          depth: currentDepth,
          discovery: discoveryByUrl.get(requestedKey) || "internal-link",
          internalInlinks: internalInlinks.get(requestedKey) || 0,
          sitemapListed: sitemapUrlSet.has(requestedKey) || sitemapUrlSet.has(normalizedUrlKey(finalUrl)),
          internalLinks: 0,
          externalLinks: 0,
          images: 0,
          assets: 0,
          issues: pageIssues,
        });
        persistProgress();
        if (consecutiveRateLimits >= 5) {
          throw new Error(
            "The site keeps rate limiting the crawl (HTTP 429/503). Wait a while and scan again, or keep the polite crawl speed.",
          );
        }
        if (politeTarget && queue.length > 0 && visited.size < limits.maxPages) {
          await sleep(pageDelayMs * (0.75 + Math.random() * 0.5));
        }
        continue;
      }
      const finalUrl = response.url || requestedUrl;
      const finalKey = normalizedUrlKey(finalUrl);
      if (response.redirected) recordRedirectIssues(requestedUrl, requestedPageIssues, response);
      if (processedContent.has(finalKey)) {
        persistProgress();
        if (politeTarget && queue.length > 0 && visited.size < limits.maxPages) {
          await sleep(pageDelayMs * (0.75 + Math.random() * 0.5));
        }
        continue;
      }
      processedContent.add(finalKey);
      if (finalKey !== requestedKey) {
        current = finalUrl;
        currentKey = finalKey;
        pageIssues = pageBucket(current);
        const finalDepth = depthByUrl.get(finalKey);
        currentDepth = Math.min(currentDepth, finalDepth ?? currentDepth);
        depthByUrl.set(finalKey, currentDepth);
        if (!discoveryByUrl.has(finalKey)) {
          discoveryByUrl.set(finalKey, discoveryByUrl.get(requestedKey) || "internal-link");
        }
        internalInlinks.set(
          finalKey,
          Math.max(internalInlinks.get(finalKey) || 0, internalInlinks.get(requestedKey) || 0),
        );
      }
      const isHtml = /text\/html|application\/xhtml\+xml/i.test(response.contentType) || response.text.includes("<html");
      const $ = cheerio.load(response.text);
      const baseHref = cleanText($("base[href]").first().attr("href") || "");
      const documentBaseUrl = baseHref ? absoluteHttpUrl(baseHref, finalUrl) || finalUrl : finalUrl;
      const title = cleanText($("title").first().text());
      const titleCount = $("title").length;
      const description = cleanText($('meta[name="description"]').attr("content") || "");
      const descriptionCount = $('meta[name="description"]').length;
      const h1s = $("h1").map((_, item) => cleanText($(item).text())).get().filter(Boolean);
      const emptyH1Count = $("h1").length - h1s.length;
      const h2Count = $("h2").length;
      const headings = $("h1,h2,h3,h4,h5,h6").map((_, item) => ({
        level: Number(item.tagName.replace(/^h/i, "")),
        text: cleanText($(item).text()),
      })).get();
      const emptyHeadingCount = headings.filter((heading) => !heading.text).length;
      const headingJumps = headings.filter((heading, index) => {
        if (index === 0) return false;
        const previous = headings[index - 1];
        return heading.level > previous.level + 1;
      });
      const canonicalRaw = $('link[rel="canonical"]').attr("href") || "";
      const canonical = canonicalRaw ? absoluteHttpUrl(canonicalRaw, documentBaseUrl) || canonicalRaw : "";
      const canonicalCount = $('link[rel="canonical"]').length;
      const robotsMeta = cleanText($('meta[name="robots"]').attr("content") || "");
      const xRobotsTag = cleanText(response.xRobotsTag || "");
      const robotDirectives = `${robotsMeta},${xRobotsTag}`
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
      const hasNoindexDirective = robotDirectives.some((item) => item === "noindex" || item === "none");
      const finalIndexable = !hasNoindexDirective && response.finalStatus < 400 && !response.redirectError;
      const indexable = finalIndexable;
      const lang = cleanText($("html").attr("lang") || "");
      const viewport = cleanText($('meta[name="viewport"]').attr("content") || "");
      const charset = cleanText($("meta[charset]").attr("charset") || $('meta[http-equiv="content-type"]').attr("content") || "");
      const metaRefresh = cleanText($("meta").filter((_, item) => /^refresh$/i.test($(item).attr("http-equiv") || "")).first().attr("content") || "");
      const faviconCount = $('link[rel~="icon"], link[rel="shortcut icon"]').length;
      const schemaCount = $('script[type="application/ld+json"]').length;
      const schemaParseErrors: string[] = [];
      $('script[type="application/ld+json"]').each((_, script) => {
        const text = $(script).contents().text().trim();
        if (!text) return;
        try {
          JSON.parse(text);
        } catch (error) {
          schemaParseErrors.push(error instanceof Error ? error.message : "Invalid JSON-LD");
        }
      });
      const ogTitle = cleanText($('meta[property="og:title"]').attr("content") || "");
      const ogDescription = cleanText($('meta[property="og:description"]').attr("content") || "");
      const ogImageRaw = cleanText($('meta[property="og:image"]').attr("content") || "");
      const ogImage = ogImageRaw ? absoluteHttpUrl(ogImageRaw, documentBaseUrl) || ogImageRaw : "";
      if (/^https?:\/\//i.test(ogImage) && imagesToCheck.size < limits.maxImagesToCheck && !imagesToCheck.has(ogImage)) {
        imagesToCheck.set(ogImage, { url: ogImage, from: current, purpose: "og:image" });
      }
      const twitterCard = cleanText($('meta[name="twitter:card"]').attr("content") || "");
      const hreflangs = $('link[rel="alternate"][hreflang]').map((_, item) => ({
        lang: cleanText($(item).attr("hreflang") || ""),
        href: $(item).attr("href") || "",
      })).get();
      const hreflangCount = hreflangs.length;
      const hreflangCodes = hreflangs.map((item) => item.lang.toLowerCase()).filter(Boolean);
      const imageRows: any[] = [];
      const linkRows: any[] = [];
      const assetRows: any[] = [];

      const addAsset = (url: string, type: "css" | "js", meta: Record<string, unknown> = {}) => {
        if (assetsToCheck.size >= limits.maxAssetsToCheck || assetsToCheck.has(url)) return;
        assetsToCheck.set(url, { url, from: current, type, ...meta });
      };

      const addImageToCheck = (url: string, meta: Record<string, unknown> = {}) => {
        if (imagesToCheck.size >= limits.maxImagesToCheck || imagesToCheck.has(url)) return;
        imagesToCheck.set(url, { url, from: current, ...meta });
      };

      $("img").each((imageIndex, img) => {
        const src = $(img).attr("src") || $(img).attr("data-src") || "";
        const imgSrcsetRaw = $(img).attr("srcset") || "";
        const pictureSourceSrcsets = $(img)
          .closest("picture")
          .find("source[srcset]")
          .map((_, source) => $(source).attr("srcset") || "")
          .get()
          .filter(Boolean);
        const imgSrcsetUrls = parseSrcsetUrls(imgSrcsetRaw, documentBaseUrl);
        const pictureSrcsetUrls = pictureSourceSrcsets.flatMap((srcset) => parseSrcsetUrls(srcset, documentBaseUrl));
        const srcsetUrls = [...imgSrcsetUrls, ...pictureSrcsetUrls];
        const invalidSrcsetCandidates =
          srcsetCandidateCount(imgSrcsetRaw) +
          pictureSourceSrcsets.reduce((count, srcset) => count + srcsetCandidateCount(srcset), 0) -
          srcsetUrls.length;
        const absolute = absoluteHttpUrl(src, documentBaseUrl) || srcsetUrls[0] || null;
        const alt = $(img).attr("alt");
        const altText = cleanText(alt || "");
        const role = cleanText($(img).attr("role") || "");
        const ariaHidden = cleanText($(img).attr("aria-hidden") || "");
        const width = $(img).attr("width") || "";
        const height = $(img).attr("height") || "";
        const cssSized = imageIsCssSized($(img).attr("class") || "", $(img).attr("style") || "");
        const row = {
          from: current,
          src: absolute || src,
          alt: alt ?? null,
          altPreview: altText.slice(0, 160),
          altState: typeof alt !== "string" ? "missing" : alt.trim() ? "present" : "empty",
          width,
          height,
          loading: $(img).attr("loading") || "",
          position: imageIndex + 1,
          srcsetCount: srcsetUrls.length,
          pictureSourceCount: pictureSrcsetUrls.length,
          invalidSrcsetCandidates: Math.max(0, invalidSrcsetCandidates),
          role,
          ariaHidden,
          classification: imageClassification({ src: absolute || src, width, height, role, ariaHidden }),
          cssSized,
          snippet: "",
          issues: [] as string[],
        };
        if (!src && pictureSrcsetUrls.length) row.issues.push("missing fallback src");
        if (!row.src) {
          row.issues.push("missing src");
          row.snippet = cleanText($.html(img)).slice(0, 200);
        }
        if (row.invalidSrcsetCandidates > 0) row.issues.push("invalid srcset");
        if (row.classification === "content" && row.altState === "missing") row.issues.push("missing alt");
        if (row.classification === "content" && row.altState === "empty") row.issues.push("empty alt");
        if (row.classification === "content" && altText.length > 125) row.issues.push("alt too long");
        if (row.classification === "content" && isGenericAltText(altText, row.src || "")) row.issues.push("generic alt");
        if (row.src && (!row.width || !row.height) && !row.cssSized) row.issues.push("missing size");
        if (row.classification === "content" && imageIndex > 1 && String(row.loading).toLowerCase() !== "lazy") row.issues.push("not lazy loaded");
        if (row.classification === "content" && Number.parseInt(row.width || "0", 10) >= 600 && row.srcsetCount === 0) row.issues.push("missing srcset");
        if (row.src && isHttpOnHttpsPage(row.src, current)) row.issues.push("mixed content");
        imageRows.push(row);
        if (imageInventory.length < limits.maxImageInventory) imageInventory.push(row);
        for (const imageUrl of [absolute, ...srcsetUrls].filter(Boolean) as string[]) {
          addImageToCheck(imageUrl, { purpose: pictureSrcsetUrls.includes(imageUrl) ? "picture-source" : "img" });
        }
      });

      $("source[srcset]").each((_, source) => {
        const urls = parseSrcsetUrls($(source).attr("srcset") || "", documentBaseUrl);
        for (const imageUrl of urls) addImageToCheck(imageUrl, { purpose: "source-srcset" });
      });

      $("[style]").each((_, item) => {
        for (const imageUrl of cssUrlValues($(item).attr("style") || "", documentBaseUrl)) {
          addImageToCheck(imageUrl, { purpose: "css-url" });
        }
      });
      $("style").each((_, item) => {
        for (const imageUrl of cssUrlValues($(item).contents().text() || "", documentBaseUrl)) {
          addImageToCheck(imageUrl, { purpose: "css-url" });
        }
      });

      $("a[href]").each((_, link) => {
        const href = $(link).attr("href") || "";
        const absolute = absoluteHttpUrl(href, documentBaseUrl);
        if (!absolute) return;
        if (isIgnoredCrawlUrl(absolute)) return;
        const isInternal = sameSiteUrl(absolute, startUrl);
        const imageAlt = cleanText($(link).find("img[alt]").first().attr("alt") || "");
        const accessibleName = cleanText($(link).attr("aria-label") || $(link).attr("title") || imageAlt);
        const anchor = cleanText($(link).text());
        const row = {
          from: current,
          href: absolute,
          anchor,
          accessibleName,
          rel: cleanText($(link).attr("rel") || ""),
          target: cleanText($(link).attr("target") || ""),
          type: isInternal ? "internal" : "external",
        };
        linkRows.push(row);
        if (linkInventory.length < limits.maxLinkInventory) linkInventory.push(row);
        let linkCandidate = linksToCheck.get(absolute);
        if (!linkCandidate && linksToCheck.size < limits.maxLinksToCheck) {
          linkCandidate = {
            url: absolute,
            type: row.type,
            anchor: row.anchor,
            rel: row.rel,
            referenceCount: 0,
            sources: new Map<string, any>(),
          };
          linksToCheck.set(absolute, linkCandidate);
        }
        if (linkCandidate) {
          linkCandidate.referenceCount += 1;
          const source = linkCandidate.sources.get(current) || {
            from: current,
            anchor: row.anchor,
            rel: row.rel,
            references: 0,
          };
          source.references += 1;
          if (!source.anchor && row.anchor) source.anchor = row.anchor;
          linkCandidate.sources.set(current, source);
        }
        const target = isInternal ? pageCrawlTarget(absolute, startUrl) : null;
        if (target?.parameterized) addParameterUrl(absolute, "internal-link", current, target.url);
        if (target) {
          internalInlinks.set(target.key, (internalInlinks.get(target.key) || 0) + 1);
          const nextDepth = currentDepth + 1;
          if (!depthByUrl.has(target.key) || nextDepth < Number(depthByUrl.get(target.key))) {
            depthByUrl.set(target.key, nextDepth);
          }
          if (!discoveryByUrl.has(target.key)) discoveryByUrl.set(target.key, "internal-link");
        }
        if (
          target &&
          !visited.has(target.key) &&
          !queued.has(target.key) &&
          queue.length + visited.size < limits.maxQueuedUrls
        ) {
          queued.add(target.key);
          queue.push(target.url);
        }
      });

      $('link[rel~="stylesheet"][href]').each((_, item) => {
        const href = absoluteHttpUrl($(item).attr("href") || "", documentBaseUrl);
        if (!href) return;
        assetRows.push({ type: "css", url: href });
        addAsset(href, "css", { placement: "head" });
      });
      $("script[src]").each((_, item) => {
        const src = absoluteHttpUrl($(item).attr("src") || "", documentBaseUrl);
        if (!src) return;
        const scriptMeta = {
          type: "js",
          url: src,
          async: typeof $(item).attr("async") === "string",
          defer: typeof $(item).attr("defer") === "string",
          module: cleanText($(item).attr("type") || "").toLowerCase() === "module",
          placement: $(item).parents("head").length ? "head" : "body",
        };
        assetRows.push(scriptMeta);
        addAsset(src, "js", scriptMeta);
      });

      $("script,style,noscript,svg").remove();
      const bodyText = cleanText($("body").text());
      const wordCount = bodyText ? bodyText.split(/\s+/).filter(Boolean).length : 0;

      if (response.finalStatus >= 400) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "high",
          category: "crawl",
          type: "page-http-error",
          message: `Page returns HTTP ${response.finalStatus}`,
          recommendation: "Fix the URL or redirect it to a live equivalent.",
          evidence: {
            status: response.status,
            finalStatus: response.finalStatus,
            requestedUrl,
            redirectChain: response.redirectChain,
          },
        });
      }
      if (!isHtml) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "medium",
          category: "crawl",
          type: "non-html-page",
          message: "Crawled URL is not HTML",
          recommendation: "Keep non-HTML files out of primary crawl paths unless they are intentionally linked.",
          evidence: { contentType: response.contentType },
        });
      }
      if (current.length > 115) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: current.length > 160 ? "medium" : "low",
          category: "crawl",
          type: "url-too-long",
          message: `URL is ${current.length} characters`,
          recommendation: "Keep important URLs short, readable, and stable. Remove unnecessary parameters where possible.",
          evidence: { length: current.length },
        });
      }
      if (metaRefresh) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "medium",
          category: "crawl",
          type: "meta-refresh",
          message: "Page uses a meta refresh redirect",
          recommendation: "Use an HTTP redirect instead of a client-side meta refresh.",
          evidence: { metaRefresh },
        });
      }
      if (new URL(current).protocol !== "https:") {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "high",
          category: "security",
          type: "page-not-https",
          message: "Page is served over HTTP",
          recommendation: "Serve public pages over HTTPS and redirect HTTP URLs to their HTTPS equivalents.",
          evidence: { url: current },
        });
      }
      if (isLikelyTrackingUrl(current)) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "crawl",
          type: "tracking-parameters-in-url",
          message: "URL contains tracking parameters",
          recommendation: "Keep crawlable canonical URLs clean. Strip tracking parameters from internal links and canonicalize parameter variants.",
          evidence: { url: current },
        });
      }
      if (currentDepth > 3) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "crawl",
          type: "crawl-depth-deep",
          message: `Page is ${currentDepth} clicks deep`,
          recommendation: "Important pages should usually be reachable within three clicks from crawl entry points.",
          evidence: { depth: currentDepth, discovery: discoveryByUrl.get(currentKey) },
        });
      }
      if (!title) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "high",
          category: "metadata",
          type: "title-missing",
          message: "Missing title tag",
          recommendation: "Add a unique title tag that describes the page and primary search intent.",
        });
      } else if (titleCount > 1) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "medium",
          category: "metadata",
          type: "title-multiple",
          message: `Multiple title tags found (${titleCount})`,
          recommendation: "Keep one title tag per page so crawlers and browsers have a single canonical title.",
          evidence: { titleCount },
        });
      } else if (title.length > 60 || title.length < 30) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: title.length > 70 ? "medium" : "low",
          category: "metadata",
          type: "title-length",
          message: `Title length is ${title.length} characters`,
          recommendation: "Keep important title copy around 30-60 characters and make every page title unique.",
          evidence: { title, length: title.length },
        });
      }
      if (!description) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "high",
          category: "metadata",
          type: "description-missing",
          message: "Missing meta description",
          recommendation: "Add a unique meta description that summarizes the page and includes the main value.",
        });
      } else if (descriptionCount > 1) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "medium",
          category: "metadata",
          type: "description-multiple",
          message: `Multiple meta descriptions found (${descriptionCount})`,
          recommendation: "Keep one meta description per page.",
          evidence: { descriptionCount },
        });
      } else if (description.length > 160 || description.length < 70) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "metadata",
          type: "description-length",
          message: `Meta description length is ${description.length} characters`,
          recommendation: "Use concise descriptions around 70-160 characters.",
          evidence: { description, length: description.length },
        });
      }
      if (h1s.length === 0 || h1s.length > 1) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "medium",
          category: "headings",
          type: "h1-count",
          message: h1s.length === 0 ? "Missing H1" : `Multiple H1 tags found (${h1s.length})`,
          recommendation: "Use one descriptive H1 that matches the page intent.",
          evidence: { h1s },
        });
      }
      if (emptyH1Count > 0) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "headings",
          type: "h1-empty",
          message: `${emptyH1Count} H1 tags are empty`,
          recommendation: "Remove empty headings or add meaningful heading text.",
          evidence: { emptyH1Count },
        });
      }
      if (emptyHeadingCount > emptyH1Count) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "headings",
          type: "heading-empty",
          message: `${emptyHeadingCount - emptyH1Count} non-H1 headings are empty`,
          recommendation: "Remove empty heading tags or add meaningful text.",
          evidence: { emptyHeadingCount },
        });
      }
      if (headingJumps.length > 0) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "headings",
          type: "heading-hierarchy-jump",
          message: `${headingJumps.length} headings skip hierarchy levels`,
          recommendation: "Keep headings in a logical outline so crawlers and assistive technology can understand the page structure.",
          evidence: { samples: headingJumps },
        });
      }
      if (wordCount > 300 && h2Count === 0) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "headings",
          type: "h2-missing",
          message: "Long page has no H2 sections",
          recommendation: "Break long content into descriptive H2 sections.",
          evidence: { wordCount },
        });
      }
      if (!canonical) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "medium",
          category: "canonicals",
          type: "canonical-missing",
          message: "Missing canonical URL",
          recommendation: "Add a canonical URL so crawlers understand the preferred version.",
        });
      } else if (canonicalRaw && !absoluteHttpUrl(canonicalRaw, documentBaseUrl)) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "medium",
          category: "canonicals",
          type: "canonical-invalid",
          message: "Canonical URL is invalid",
          recommendation: "Use a valid absolute or root-relative canonical URL.",
          evidence: { canonical: canonicalRaw },
        });
      } else if (canonicalCount > 1) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "medium",
          category: "canonicals",
          type: "canonical-multiple",
          message: `Multiple canonical tags found (${canonicalCount})`,
          recommendation: "Keep one canonical tag per page.",
          evidence: { canonicalCount },
        });
      } else if (isHttpOnHttpsPage(canonical, current)) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "medium",
          category: "canonicals",
          type: "canonical-http-on-https",
          message: "Canonical URL uses HTTP on an HTTPS page",
          recommendation: "Point canonical tags to the HTTPS version of the preferred URL.",
          evidence: { canonical },
        });
      } else if (!sameSiteUrl(canonical, startUrl)) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "medium",
          category: "canonicals",
          type: "canonical-cross-domain",
          message: "Canonical points to another domain",
          recommendation: "Confirm cross-domain canonicalization is intentional.",
          evidence: { canonical },
        });
      } else if (
        response.redirectChain.some((hop) => normalizedUrl(hop.url) === normalizedUrl(canonical))
      ) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "canonicals",
          type: "canonical-points-to-redirect",
          message: "Canonical points to a redirecting URL",
          recommendation: "Point the canonical directly to the final indexable URL.",
          evidence: { canonical, finalUrl, redirectChain: response.redirectChain },
        });
      } else if (finalIndexable && normalizedUrl(canonical) !== normalizedUrl(finalUrl)) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "canonicals",
          type: "canonical-not-self",
          message: "Indexable page canonicals to a different URL",
          recommendation: "Use a self-referencing canonical unless this page is intentionally consolidated into another URL.",
          evidence: { canonical, finalUrl },
        });
      }
      if (hasNoindexDirective) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "high",
          category: "indexability",
          type: "noindex",
          message: "Page is marked noindex",
          recommendation: "Remove noindex directives from pages that should appear in search.",
          evidence: { robotsMeta, xRobotsTag },
        });
      }
      if (robotDirectives.includes("nofollow")) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "medium",
          category: "indexability",
          type: "meta-robots-nofollow",
          message: "Page tells crawlers not to follow links",
          recommendation: "Remove nofollow from page-level robots directives unless all links on this page should be excluded from crawl flow.",
          evidence: { robotsMeta, xRobotsTag },
        });
      }
      if (robotDirectives.includes("noarchive") || robotDirectives.includes("nosnippet")) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "indexability",
          type: "restrictive-snippet-directive",
          message: "Page uses restrictive snippet/archive directives",
          recommendation: "Confirm noarchive or nosnippet is intentional; these directives can reduce search-result usefulness.",
          evidence: { robotsMeta, xRobotsTag },
        });
      }
      if (!lang) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "indexability",
          type: "html-lang-missing",
          message: "HTML lang attribute is missing",
          recommendation: "Set the page language on the html element.",
        });
      } else if (!isValidLangCode(lang)) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "localization",
          type: "html-lang-invalid",
          message: "HTML lang attribute does not look valid",
          recommendation: "Use a valid BCP 47 language tag such as en, en-US, pt, or pt-PT.",
          evidence: { lang },
        });
      }
      if (!charset) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "indexability",
          type: "charset-missing",
          message: "Charset declaration is missing",
          recommendation: "Declare UTF-8 early in the document head.",
        });
      }
      if (!faviconCount) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "metadata",
          type: "favicon-missing",
          message: "Favicon link is missing",
          recommendation: "Add a site icon so browser tabs, bookmarks, and search surfaces have a clear visual identity.",
        });
      }
      if (!viewport) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "medium",
          category: "performance",
          type: "viewport-missing",
          message: "Viewport meta tag is missing",
          recommendation: "Add a responsive viewport meta tag for mobile rendering.",
        });
      } else if (!/width\s*=\s*device-width/i.test(viewport)) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "performance",
          type: "viewport-not-responsive",
          message: "Viewport meta tag does not include width=device-width",
          recommendation: "Use a responsive viewport such as width=device-width, initial-scale=1.",
          evidence: { viewport },
        });
      }
      if (loadMs > 4000) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "medium",
          category: "performance",
          type: "slow-page",
          message: `Page took ${loadMs}ms to respond`,
          recommendation: "Investigate server response time, redirects, heavy HTML, blocking assets, and caching.",
          evidence: { loadMs },
        });
      } else if (loadMs > 2000) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "performance",
          type: "page-response-slow",
          message: `Page response took ${loadMs}ms`,
          recommendation: "Keep important pages fast enough for users and crawlers.",
          evidence: { loadMs },
        });
      }
      if (response.contentLength && response.contentLength > 1000000) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "performance",
          type: "heavy-html",
          message: "HTML response is larger than 1 MB",
          recommendation: "Reduce server-rendered payload, unused markup, and inline data where possible.",
          evidence: { bytes: response.contentLength },
        });
      }
      if (wordCount < 150) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "medium",
          category: "content",
          type: "thin-content",
          message: `Page has ${wordCount} visible words`,
          recommendation: "Add useful body content when this page is intended to rank or convert.",
          evidence: { wordCount },
        });
      }
      const imagesMissingSrc = imageRows.filter((image) => !image.src);
      const missingFallbackSrc = imageRows.filter((image) => image.issues.includes("missing fallback src")).length;
      const invalidSrcset = imageRows.filter((image) => image.issues.includes("invalid srcset")).length;
      const missingAlt = imageRows.filter((image) => image.classification === "content" && image.altState === "missing").length;
      const emptyAlt = imageRows.filter((image) => image.classification === "content" && image.altState === "empty").length;
      const missingDimensions = imageRows.filter((image) => image.issues.includes("missing size"));
      if (imagesMissingSrc.length > 0) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "high",
          category: "images",
          type: "image-src-missing",
          message: `${imagesMissingSrc.length} image tags have no source`,
          recommendation: "Remove empty image tags or point them to a valid image file.",
          evidence: {
            count: imagesMissingSrc.length,
            samples: imagesMissingSrc.map((image) => (image.snippet ? `img #${image.position} · ${image.snippet}` : `img #${image.position}`)),
          },
        });
      }
      if (missingFallbackSrc > 0) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "images",
          type: "image-fallback-src-missing",
          message: `${missingFallbackSrc} picture images are missing fallback src values`,
          recommendation: "Keep a valid img src fallback inside picture elements so older clients, crawlers, and parsers still find an image.",
          evidence: { count: missingFallbackSrc },
        });
      }
      if (invalidSrcset > 0) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "medium",
          category: "images",
          type: "image-srcset-invalid",
          message: `${invalidSrcset} image srcset entries could not be resolved`,
          recommendation: "Fix malformed srcset candidates and keep responsive image URLs valid.",
          evidence: { count: invalidSrcset },
        });
      }
      if (missingAlt > 0) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "medium",
          category: "images",
          type: "image-alt-missing",
          message: `${missingAlt} content images are missing alt attributes`,
          recommendation: "Add useful alt text for meaningful images. Mark decorative or tracking images explicitly when they should be ignored.",
          evidence: { count: missingAlt },
        });
      }
      if (emptyAlt > 0) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "images",
          type: "image-alt-empty",
          message: `${emptyAlt} content images have empty alt text`,
          recommendation: "Add descriptive alt text or mark the image as decorative with role=\"presentation\" or aria-hidden=\"true\".",
          evidence: { count: emptyAlt },
        });
      }
      const genericAlt = imageRows.filter((image) => image.classification === "content" && image.issues.includes("generic alt"));
      if (genericAlt.length > 0) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "images",
          type: "image-alt-generic",
          message: `${genericAlt.length} content images use generic alt text`,
          recommendation: "Write alt text that describes the specific image and its purpose on the page.",
          evidence: { count: genericAlt.length, samples: genericAlt.map((image) => ({ src: image.src, alt: image.altPreview })) },
        });
      }
      const longAlt = imageRows.filter((image) => image.classification === "content" && image.issues.includes("alt too long"));
      if (longAlt.length > 0) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "images",
          type: "image-alt-too-long",
          message: `${longAlt.length} content images have very long alt text`,
          recommendation: "Keep alt text concise and useful. Move long explanations into visible page copy.",
          evidence: { count: longAlt.length, samples: longAlt.map((image) => ({ src: image.src, length: String(image.alt || "").length })) },
        });
      }
      const duplicateAltTexts = [...new Set(imageRows
        .filter((image) => image.classification === "content" && image.altPreview)
        .map((image) => image.altPreview.toLowerCase())
        .filter((alt, index, alts) => alts.indexOf(alt) !== index))];
      if (duplicateAltTexts.length > 0) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "images",
          type: "image-alt-duplicate",
          message: "Multiple content images use the same alt text",
          recommendation: "Use distinct alt text when images convey different information. Repeated decorative images should be marked decorative.",
          evidence: { duplicateAltTexts },
        });
      }
      if (missingDimensions.length > 0) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "images",
          type: "image-dimensions-missing",
          message: `${missingDimensions.length} images are not sized by attributes, inline styles, or sizing classes`,
          recommendation: "Set width/height attributes, CSS dimensions, or an aspect ratio so the browser can reserve space and avoid layout shift.",
          evidence: { count: missingDimensions.length, samples: missingDimensions.map((image) => image.src) },
        });
      }
      const missingSrcset = imageRows.filter((image) => image.issues.includes("missing srcset"));
      if (missingSrcset.length > 0) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "images",
          type: "image-srcset-missing",
          message: `${missingSrcset.length} large content images have no srcset`,
          recommendation: "Use responsive image sources so mobile users do not download oversized images.",
          evidence: { count: missingSrcset.length, samples: missingSrcset.map((image) => image.src) },
        });
      }
      const missingLazyLoading = imageRows.filter((image) => image.issues.includes("not lazy loaded"));
      if (missingLazyLoading.length > 0) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "performance",
          type: "image-lazy-loading-missing",
          message: `${missingLazyLoading.length} lower-page images are not lazy loaded`,
          recommendation: "Lazy-load images that are not needed for the initial viewport.",
          evidence: { count: missingLazyLoading.length, samples: missingLazyLoading.map((image) => image.src) },
        });
      }
      const mixedImages = imageRows.filter((image) => image.src && isHttpOnHttpsPage(image.src, current));
      if (mixedImages.length > 0) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "medium",
          category: "images",
          type: "mixed-content-images",
          message: `${mixedImages.length} images use HTTP on an HTTPS page`,
          recommendation: "Serve image assets over HTTPS to avoid browser blocking and security warnings.",
          evidence: { count: mixedImages.length, samples: mixedImages.map((image) => image.src) },
        });
      }
      const mixedLinks = linkRows.filter((link) => isHttpOnHttpsPage(link.href, current));
      if (mixedLinks.length > 0) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "links",
          type: "mixed-content-links",
          message: `${mixedLinks.length} links use HTTP on an HTTPS page`,
          recommendation: "Update links to HTTPS versions where available.",
          evidence: { count: mixedLinks.length, samples: mixedLinks.map((link) => link.href) },
        });
      }
      const emptyAnchorLinks = linkRows.filter((link) => !link.anchor && !link.accessibleName);
      if (emptyAnchorLinks.length > 0) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "links",
          type: "empty-anchor-text",
          message: `${emptyAnchorLinks.length} links have no readable anchor text`,
          recommendation: "Add visible anchor text or accessible labels so users and crawlers understand the linked URL.",
          evidence: { count: emptyAnchorLinks.length, samples: emptyAnchorLinks.map((link) => link.href) },
        });
      }
      const internalNofollowLinks = linkRows.filter((link) => link.type === "internal" && /\bnofollow\b/i.test(link.rel));
      if (internalNofollowLinks.length > 0) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "links",
          type: "internal-nofollow",
          message: `${internalNofollowLinks.length} internal links are nofollow`,
          recommendation: "Remove nofollow from internal links unless crawl flow should intentionally be blocked.",
          evidence: { count: internalNofollowLinks.length, samples: internalNofollowLinks.map((link) => link.href) },
        });
      }
      const unsafeBlankLinks = linkRows.filter((link) => link.type === "external" && link.target.toLowerCase() === "_blank" && !/\b(noopener|noreferrer)\b/i.test(link.rel));
      if (unsafeBlankLinks.length > 0) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "security",
          type: "external-blank-missing-noopener",
          message: `${unsafeBlankLinks.length} external links open in a new tab without noopener`,
          recommendation: "Add rel=\"noopener\" or rel=\"noreferrer\" to external target=\"_blank\" links.",
          evidence: { count: unsafeBlankLinks.length, samples: unsafeBlankLinks.map((link) => link.href) },
        });
      }
      if (linkRows.filter((link) => link.type === "internal").length === 0) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "medium",
          category: "links",
          type: "no-internal-links",
          message: "No internal links found on the page",
          recommendation: "Add internal links so users and crawlers can move through the site.",
        });
      }
      if (linkRows.length > 150) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "links",
          type: "too-many-links",
          message: `Page has ${linkRows.length} links`,
          recommendation: "Keep navigation and body links focused so crawl equity and users are not diluted by excessive targets.",
          evidence: { linkCount: linkRows.length },
        });
      }
      const trackingInternalLinks = linkRows.filter((link) => link.type === "internal" && isLikelyTrackingUrl(link.href));
      if (trackingInternalLinks.length > 0) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "links",
          type: "internal-links-with-tracking-parameters",
          message: `${trackingInternalLinks.length} internal links contain tracking parameters`,
          recommendation: "Remove tracking parameters from internal links and keep analytics tagging for inbound campaigns.",
          evidence: { samples: trackingInternalLinks.map((link) => link.href) },
        });
      }
      if (!schemaCount) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "structured-data",
          type: "structured-data-missing",
          message: "No JSON-LD structured data found",
          recommendation: "Add relevant schema such as Organization, WebSite, BreadcrumbList, Article, Product, or LocalBusiness.",
        });
      }
      if (schemaParseErrors.length > 0) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "medium",
          category: "structured-data",
          type: "structured-data-invalid",
          message: `${schemaParseErrors.length} JSON-LD blocks are invalid`,
          recommendation: "Fix JSON-LD syntax so search engines can parse structured data.",
          evidence: { errors: schemaParseErrors },
        });
      }
      if (!ogTitle || !ogDescription) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "social",
          type: "open-graph-incomplete",
          message: "Open Graph title or description is missing",
          recommendation: "Add Open Graph metadata so shared URLs render clearly.",
          evidence: { ogTitle: Boolean(ogTitle), ogDescription: Boolean(ogDescription) },
        });
      }
      if (!ogImage) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "social",
          type: "open-graph-image-missing",
          message: "Open Graph image is missing",
          recommendation: "Add og:image for pages that may be shared or discovered socially.",
        });
      } else if (!/^https?:\/\//i.test(ogImage)) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "social",
          type: "open-graph-image-invalid",
          message: "Open Graph image URL is invalid",
          recommendation: "Use a valid absolute Open Graph image URL.",
          evidence: { ogImage },
        });
      }
      if (!twitterCard) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "social",
          type: "twitter-card-missing",
          message: "Twitter/X card metadata is missing",
          recommendation: "Add twitter:card metadata for pages that are likely to be shared.",
        });
      }
      const invalidHreflangs = hreflangs.filter((item) => !item.lang || !absoluteHttpUrl(item.href, documentBaseUrl));
      if (invalidHreflangs.length > 0) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "medium",
          category: "localization",
          type: "hreflang-invalid",
          message: `${invalidHreflangs.length} hreflang links are invalid`,
          recommendation: "Use valid hreflang codes and valid alternate URLs.",
          evidence: { invalidHreflangs },
        });
      }
      const malformedHreflangs = hreflangs.filter((item) => item.lang && item.lang.toLowerCase() !== "x-default" && !isValidLangCode(item.lang));
      if (malformedHreflangs.length > 0) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "medium",
          category: "localization",
          type: "hreflang-code-invalid",
          message: `${malformedHreflangs.length} hreflang codes do not look valid`,
          recommendation: "Use valid language or language-region codes, plus x-default when needed.",
          evidence: { samples: malformedHreflangs },
        });
      }
      const duplicateHreflangCodes = [...new Set(hreflangCodes.filter((code, index) => hreflangCodes.indexOf(code) !== index))];
      if (duplicateHreflangCodes.length > 0) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "localization",
          type: "hreflang-duplicate",
          message: "Duplicate hreflang codes found",
          recommendation: "Keep one alternate URL for each hreflang value.",
          evidence: { duplicateHreflangCodes },
        });
      }
      if (hreflangCount > 1 && !hreflangCodes.includes("x-default")) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "localization",
          type: "hreflang-x-default-missing",
          message: "Hreflang set has no x-default URL",
          recommendation: "Add x-default when the site has a default language selector or global fallback URL.",
          evidence: { hreflangCount },
        });
      }
      const mixedAssets = assetRows.filter((asset) => isHttpOnHttpsPage(asset.url, current));
      if (mixedAssets.length > 0) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "medium",
          category: "assets",
          type: "mixed-content-assets",
          message: `${mixedAssets.length} CSS/JS assets use HTTP on an HTTPS page`,
          recommendation: "Serve CSS and JavaScript over HTTPS.",
          evidence: { count: mixedAssets.length, samples: mixedAssets },
        });
      }
      const renderBlockingScripts = assetRows.filter((asset) =>
        asset.type === "js" &&
        asset.placement === "head" &&
        !asset.async &&
        !asset.defer &&
        !asset.module
      );
      if (renderBlockingScripts.length > 0) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "performance",
          type: "render-blocking-javascript",
          message: `${renderBlockingScripts.length} head scripts can block rendering`,
          recommendation: "Defer, async-load, module-load, or move non-critical scripts out of the document head.",
          evidence: { samples: renderBlockingScripts.map((asset) => asset.url) },
        });
      }
      if (assetRows.length > 60) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "performance",
          type: "too-many-assets",
          message: `Page references ${assetRows.length} CSS/JS assets`,
          recommendation: "Bundle, remove, or defer non-critical CSS and JavaScript to reduce request overhead.",
          evidence: { assetCount: assetRows.length },
        });
      }
      if (response.contentLength && response.contentLength > 50000 && !response.contentEncoding) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "performance",
          type: "html-compression-missing",
          message: "Large HTML response does not advertise compression",
          recommendation: "Enable Brotli or gzip compression for HTML responses.",
          evidence: { bytes: response.contentLength },
        });
      }

      const page = {
        url: current,
        finalUrl,
        requestedUrl,
        sourceStatus: response.status,
        status: response.finalStatus,
        finalStatus: response.finalStatus,
        redirected: response.redirected,
        redirectChain: response.redirectChain,
        redirectLoop: response.redirectLoop,
        contentType: response.contentType,
        contentEncoding: response.contentEncoding,
        contentLength: response.contentLength,
        loadMs,
        urlLength: current.length,
        title,
        titleLength: title.length,
        titleCount,
        description,
        descriptionLength: description.length,
        descriptionCount,
        h1s,
        h1: h1s[0] || "",
        h1Count: h1s.length,
        emptyH1Count,
        h2Count,
        headingCount: headings.length,
        emptyHeadingCount,
        headingJumps: headingJumps.length,
        canonical,
        canonicalCount,
        robotsMeta,
        xRobotsTag,
        indexable,
        finalIndexable,
        indexabilityReason: hasNoindexDirective ? "noindex" : response.finalStatus >= 400 ? "http-error" : "indexable",
        lang,
        viewport,
        charset,
        metaRefresh,
        faviconCount,
        wordCount,
        depth: currentDepth,
        discovery: discoveryByUrl.get(currentKey) || "internal-link",
        internalInlinks: internalInlinks.get(currentKey) || 0,
        sitemapListed:
          sitemapUrlSet.has(currentKey) || sitemapUrlSet.has(normalizedUrlKey(finalUrl)),
        sitemapSourceListed:
          requestedKey !== currentKey && sitemapUrlSet.has(requestedKey),
        contentFingerprint: contentFingerprint(bodyText),
        schemaCount,
        schemaParseErrors,
        hreflangCount,
        openGraph: { title: ogTitle, description: ogDescription },
        ogImage,
        twitterCard,
        internalLinks: linkRows.filter((link) => link.type === "internal").length,
        externalLinks: linkRows.filter((link) => link.type === "external").length,
        images: imageRows.length,
        imagesMissingAlt: missingAlt,
        imagesEmptyAlt: emptyAlt,
        imagesMissingSrc: imagesMissingSrc.length,
        imagesMissingFallbackSrc: missingFallbackSrc,
        imagesInvalidSrcset: invalidSrcset,
        imagesMissingDimensions: missingDimensions.length,
        assets: assetRows.length,
        cssAssets: assetRows.filter((asset) => asset.type === "css").length,
        jsAssets: assetRows.filter((asset) => asset.type === "js").length,
        issues: pageIssues,
      };
      pages.push(page);
      persistProgress();
    } catch (error) {
      pushScanIssue(issues, pageIssues, {
        url: current,
        severity: "high",
        category: "crawl",
        type: "crawl-failed",
        message: error instanceof Error ? error.message : "Failed to crawl URL",
        recommendation: "Check DNS, TLS, firewall, redirects, and server availability.",
      });
      persistProgress();
    }
    if (consecutiveRateLimits >= 5) {
      throw new Error(
        "The site keeps rate limiting the crawl (HTTP 429/503). Wait a while and scan again, or keep the polite crawl speed.",
      );
    }
    if (politeTarget && queue.length > 0 && visited.size < limits.maxPages) {
      await sleep(pageDelayMs * (0.75 + Math.random() * 0.5));
    }
  }
  for (const page of pages) {
    const pageKey = normalizedUrlKey(page.url);
    const finalKey = normalizedUrlKey(page.finalUrl || page.url);
    const requestedKey = normalizedUrlKey(page.requestedUrl || page.url);
    page.internalInlinks = Math.max(
      Number(page.internalInlinks || 0),
      internalInlinks.get(pageKey) || 0,
      internalInlinks.get(finalKey) || 0,
      internalInlinks.get(requestedKey) || 0,
    );
    page.depth = Math.min(
      Number.isFinite(Number(page.depth)) ? Number(page.depth) : 999,
      depthByUrl.get(pageKey) ?? 999,
      depthByUrl.get(finalKey) ?? 999,
      depthByUrl.get(requestedKey) ?? 999,
    );
    if (page.depth === 999) page.depth = 0;
    page.discovery =
      discoveryByUrl.get(pageKey) ||
      discoveryByUrl.get(finalKey) ||
      discoveryByUrl.get(requestedKey) ||
      page.discovery ||
      "internal-link";
    page.sitemapListed = sitemapUrlSet.has(pageKey) || sitemapUrlSet.has(finalKey);
    page.sitemapSourceListed = requestedKey !== pageKey && sitemapUrlSet.has(requestedKey);
  }

  const politeResourcePause = async (url: string) => {
    if (politeTarget && sameSiteUrl(url, startUrl)) await sleep(120 + Math.random() * 180);
  };

  phase = "checking links";
  for (const candidate of [...linksToCheck.values()]) {
    await politeResourcePause(candidate.url);
    const result = await checkResource(candidate.url);
    const sources = [...candidate.sources.values()];
    const sourcePages = sources.map((source) => source.from);
    const row = {
      url: candidate.url,
      type: candidate.type,
      anchor: candidate.anchor,
      rel: candidate.rel,
      from: sourcePages[0] || "",
      affectedPages: sourcePages.length,
      referenceCount: candidate.referenceCount,
      sourcePages,
      ...result,
    };
    checkedLinks.push(row);
    if (!row.ok) {
      const firstSource = sources[0];
      const certificateFailure = row.failureKind === "tls-certificate";
      const redirectLoop = row.redirectLoop === true;
      pushScanIssue(issues, firstSource ? pageBucket(firstSource.from) : undefined, {
        url: firstSource?.from || candidate.url,
        severity: certificateFailure ? "medium" : candidate.type === "internal" ? "high" : "medium",
        category: "links",
        type: redirectLoop
          ? "link-redirect-loop"
          : certificateFailure
            ? `${candidate.type}-link-certificate-error`
            : candidate.type === "internal"
              ? "broken-internal-link"
              : "broken-external-link",
        message: redirectLoop
          ? `${candidate.type === "internal" ? "Internal" : "External"} link has a redirect loop`
          : certificateFailure
            ? `${candidate.type === "internal" ? "Internal" : "External"} link certificate could not be verified`
            : `${candidate.type === "internal" ? "Internal" : "External"} link is failing`,
        recommendation: certificateFailure
          ? "Verify the destination certificate in a browser or another trusted client before treating the URL as unavailable."
          : redirectLoop
            ? "Fix the redirect cycle or link directly to a working final destination."
            : "Update the linked URL, remove the link, or redirect that URL to a live page.",
        evidence: {
          linkedUrl: candidate.url,
          status: row.status,
          finalStatus: row.finalStatus,
          error: row.error,
          failureKind: row.failureKind,
          redirectChain: row.redirectChain,
          affectedPages: sourcePages.length,
          totalReferences: row.referenceCount,
          sourcePages,
        },
      });
    } else if (row.redirected || (row.finalUrl && row.finalUrl !== candidate.url)) {
      for (const source of sources) {
        pushScanIssue(issues, pageBucket(source.from), {
          url: source.from,
          severity: candidate.type === "internal" ? "medium" : "low",
          category: "links",
          type: candidate.type === "internal" ? "internal-link-redirects" : "external-link-redirects",
          message: `${candidate.type === "internal" ? "Internal" : "External"} link redirects with HTTP ${row.status}`,
          recommendation: "Link directly to the final destination when the redirect is permanent and intentional.",
          evidence: {
            linkedUrl: candidate.url,
            finalUrl: row.finalUrl,
            status: row.status,
            finalStatus: row.finalStatus,
            redirectChain: row.redirectChain,
            affectedPages: sourcePages.length,
            totalReferences: row.referenceCount,
            referencesOnPage: source.references,
          },
        });
      }
    }
    if (checkedLinks.length % 25 === 0) persistProgress();
  }

  const checkedImageUrls = new Set<string>();
  async function checkQueuedImages() {
    for (const candidate of [...imagesToCheck.values()]) {
      if (checkedImageUrls.has(candidate.url)) continue;
      checkedImageUrls.add(candidate.url);
      await politeResourcePause(candidate.url);
      const result = await checkResource(candidate.url);
      const row = { ...candidate, ...result };
      checkedImages.push(row);
      if (!row.ok) {
        const certificateFailure = row.failureKind === "tls-certificate";
        pushScanIssue(issues, pageBucket(candidate.from), {
          url: candidate.from,
          severity: certificateFailure ? "medium" : "high",
          category: "images",
          type: certificateFailure ? "image-certificate-error" : "broken-image",
          message: certificateFailure ? "Image certificate could not be verified" : "Image URL is failing",
          recommendation: certificateFailure
            ? "Verify the image host certificate in a trusted client before treating the image as unavailable."
            : "Replace the image URL or restore the missing image asset.",
          evidence: {
            image: candidate.url,
            status: row.status,
            finalStatus: row.finalStatus,
            error: row.error,
            failureKind: row.failureKind,
            redirectChain: row.redirectChain,
            purpose: candidate.purpose,
          },
        });
      } else if (row.redirected || (row.finalUrl && row.finalUrl !== candidate.url)) {
        pushScanIssue(issues, pageBucket(candidate.from), {
          url: candidate.from,
          severity: "low",
          category: "images",
          type: "image-redirects",
          message: "Image URL redirects before loading",
          recommendation: "Point image tags directly at the final image URL to reduce request overhead.",
          evidence: { image: candidate.url, finalUrl: row.finalUrl, status: row.status, purpose: candidate.purpose },
        });
      } else if (row.contentType && !/^image\//i.test(row.contentType)) {
        pushScanIssue(issues, pageBucket(candidate.from), {
          url: candidate.from,
          severity: "medium",
          category: "images",
          type: "image-invalid-content-type",
          message: "Image URL does not return an image content type",
          recommendation: "Fix the image source so it serves a valid image file.",
          evidence: { image: candidate.url, contentType: row.contentType, purpose: candidate.purpose },
        });
      } else {
        const expectedMime = expectedImageMime(candidate.url);
        if (expectedMime && row.contentType && !row.contentType.toLowerCase().includes(expectedMime)) {
          pushScanIssue(issues, pageBucket(candidate.from), {
            url: candidate.from,
            severity: "low",
            category: "images",
            type: "image-extension-mismatch",
            message: "Image file extension does not match the response content type",
            recommendation: "Serve images with the correct file extension and Content-Type so browsers, caches, and crawlers classify them correctly.",
            evidence: { image: candidate.url, expectedMime, contentType: row.contentType, purpose: candidate.purpose },
          });
        }
        if (row.contentLength && row.contentLength > 500000) {
          pushScanIssue(issues, pageBucket(candidate.from), {
            url: candidate.from,
            severity: "low",
            category: "images",
            type: "large-image",
            message: "Image file is larger than 500 KB",
            recommendation: "Compress, resize, or serve a modern responsive image.",
            evidence: { image: candidate.url, bytes: row.contentLength, purpose: candidate.purpose },
          });
        }
      }
      if (checkedImages.length % 25 === 0) persistProgress();
    }
  }

  phase = "checking images";
  await checkQueuedImages();

  phase = "checking assets";
  for (const candidate of [...assetsToCheck.values()]) {
    await politeResourcePause(candidate.url);
    const result = await checkResource(candidate.url);
    const row = { ...candidate, ...result };
    checkedAssets.push(row);
    if (!row.ok) {
      const certificateFailure = row.failureKind === "tls-certificate";
      pushScanIssue(issues, pageBucket(candidate.from), {
        url: candidate.from,
        severity: certificateFailure ? "medium" : "high",
        category: "assets",
        type: certificateFailure
          ? "asset-certificate-error"
          : candidate.type === "css"
            ? "broken-css"
            : "broken-javascript",
        message: certificateFailure
          ? `${candidate.type.toUpperCase()} asset certificate could not be verified`
          : `${candidate.type.toUpperCase()} asset is failing`,
        recommendation: certificateFailure
          ? "Verify the asset host certificate in a trusted client before treating the asset as unavailable."
          : "Restore the asset, fix the URL, or remove the reference.",
        evidence: {
          asset: candidate.url,
          status: row.status,
          finalStatus: row.finalStatus,
          error: row.error,
          failureKind: row.failureKind,
          redirectChain: row.redirectChain,
        },
      });
    } else if (candidate.type === "css" && row.contentType && !/(text\/css|octet-stream)/i.test(row.contentType)) {
      pushScanIssue(issues, pageBucket(candidate.from), {
        url: candidate.from,
        severity: "medium",
        category: "assets",
        type: "css-invalid-content-type",
        message: "Stylesheet URL does not return CSS",
        recommendation: "Fix the stylesheet URL or response Content-Type.",
        evidence: { asset: candidate.url, contentType: row.contentType },
      });
    } else if (candidate.type === "js" && row.contentType && !/(javascript|ecmascript|octet-stream|text\/plain)/i.test(row.contentType)) {
      pushScanIssue(issues, pageBucket(candidate.from), {
        url: candidate.from,
        severity: "medium",
        category: "assets",
        type: "javascript-invalid-content-type",
        message: "JavaScript URL does not return a script content type",
        recommendation: "Fix the script URL or response Content-Type.",
        evidence: { asset: candidate.url, contentType: row.contentType },
      });
    } else if (row.contentLength && row.contentLength > 500000) {
      pushScanIssue(issues, pageBucket(candidate.from), {
        url: candidate.from,
        severity: "low",
        category: "assets",
        type: candidate.type === "css" ? "large-css" : "large-javascript",
        message: `${candidate.type.toUpperCase()} asset is larger than 500 KB`,
        recommendation: "Split, minify, compress, or defer heavy assets.",
        evidence: { asset: candidate.url, bytes: row.contentLength },
      });
    }
    if (
      candidate.type === "css" &&
      row.ok &&
      (!row.contentType || /(text\/css|octet-stream|text\/plain)/i.test(row.contentType)) &&
      (!row.contentLength || row.contentLength <= 1000000)
    ) {
      const cssResponse = await fetchText(candidate.url, 8000).catch(() => null);
      if (cssResponse?.ok) {
        for (const imageUrl of cssUrlValues(cssResponse.text, cssResponse.url || candidate.url)) {
          if (imagesToCheck.size >= limits.maxImagesToCheck || imagesToCheck.has(imageUrl)) continue;
          imagesToCheck.set(imageUrl, { url: imageUrl, from: candidate.from, purpose: "external-css-url", css: candidate.url });
        }
      }
    }
    if (checkedAssets.length % 25 === 0) persistProgress();
  }

  phase = "checking CSS images";
  await checkQueuedImages();

  phase = "deduplicating";
  for (const [title, rows] of groupDuplicateValues(pages.filter((page) => page.indexable), "title")) {
    for (const page of rows) {
      pushScanIssue(issues, pageBucket(page.url), {
        url: page.url,
        severity: "medium",
        category: "metadata",
        type: "duplicate-title",
        message: "Duplicate title tag",
        recommendation: "Write a unique title for each indexable page.",
        evidence: { title, duplicates: rows.map((row) => row.url) },
      });
    }
  }
  for (const [description, rows] of groupDuplicateValues(pages.filter((page) => page.indexable), "description")) {
    for (const page of rows) {
      pushScanIssue(issues, pageBucket(page.url), {
        url: page.url,
        severity: "low",
        category: "metadata",
        type: "duplicate-description",
        message: "Duplicate meta description",
        recommendation: "Write a unique description for each important page.",
        evidence: { description, duplicates: rows.map((row) => row.url) },
      });
    }
  }
  for (const [h1, rows] of groupDuplicateValues(pages.filter((page) => page.indexable), "h1")) {
    if (!firstH1Fingerprint(h1)) continue;
    for (const page of rows) {
      pushScanIssue(issues, pageBucket(page.url), {
        url: page.url,
        severity: "low",
        category: "headings",
        type: "duplicate-h1",
        message: "Duplicate H1 across multiple pages",
        recommendation: "Use a distinct H1 that reflects the unique purpose of each page.",
        evidence: { h1, duplicates: rows.map((row) => row.url) },
      });
    }
  }
  for (const [, rows] of groupDuplicateValues(pages.filter((page) => page.indexable && page.wordCount >= 120), "contentFingerprint")) {
    for (const page of rows) {
      pushScanIssue(issues, pageBucket(page.url), {
        url: page.url,
        severity: "medium",
        category: "content",
        type: "duplicate-content",
        message: "Page body content is duplicated",
        recommendation: "Canonicalize, consolidate, or rewrite duplicate pages so each important URL has a distinct purpose.",
        evidence: { duplicates: rows.map((row) => row.url) },
      });
    }
  }
  if (sitemapUrlSet.size > 0) {
    for (const page of pages.filter((item) => item.indexable)) {
      if (!sitemapUrlSet.has(normalizedUrlKey(page.finalUrl || page.url)) && !sitemapUrlSet.has(normalizedUrlKey(page.url))) {
        pushScanIssue(issues, pageBucket(page.url), {
          url: page.url,
          severity: "low",
          category: "sitemap",
          type: "page-missing-from-sitemap",
          message: "Indexable crawled page is missing from sitemap",
          recommendation: "Add important indexable pages to the XML sitemap.",
        });
      }
    }
    for (const page of pages.filter((item) => item.indexabilityReason === "noindex")) {
      if (sitemapUrlSet.has(normalizedUrlKey(page.finalUrl || page.url)) || sitemapUrlSet.has(normalizedUrlKey(page.url))) {
        pushScanIssue(issues, pageBucket(page.url), {
          url: page.url,
          severity: "medium",
          category: "sitemap",
          type: "noindex-page-in-sitemap",
          message: "Noindex page is listed in the sitemap",
          recommendation: "Remove non-indexable pages from XML sitemaps.",
        });
      }
    }
  }
  for (const page of pages.filter((item) => item.indexable && item.discovery === "sitemap" && Number(item.internalInlinks || 0) === 0)) {
    if (normalizedUrlKey(page.url) === normalizedUrlKey(startUrl)) continue;
    pushScanIssue(issues, pageBucket(page.url), {
      url: page.url,
      severity: "medium",
      category: "crawl",
      type: "orphan-page",
      message: "Indexable page was found from the sitemap but has no internal inlinks",
      recommendation: "Add internal links from relevant pages so users and crawlers can discover this URL naturally.",
      evidence: { discovery: page.discovery, sitemapListed: page.sitemapListed },
    });
  }
  if (pages.length === 0) {
    pushScanIssue(issues, pageBucket(startUrl), {
      url: startUrl,
      severity: "high",
      category: "crawl",
      type: "no-pages-crawled",
      message: "No HTML pages were crawled",
      recommendation: "Check the scan URL, redirects, DNS, TLS, firewall rules, and whether the URL returns crawlable HTML.",
      evidence: {
        visitedUrls: visited.size,
        sitemapUrls: (sitemap.urls || []).length,
        checkedLinks: checkedLinks.length,
        checkedImages: checkedImages.length,
        checkedAssets: checkedAssets.length,
      },
    });
  }

  phase = "completed";
  const score = healthScore(pages, issues);
  const previousCandidate = all<any>(
    `
    SELECT id, created_at, url FROM scans
    WHERE site_id = ?
      AND status = 'completed'
      AND rowid < (SELECT rowid FROM scans WHERE id = ?)
    ORDER BY rowid DESC
    LIMIT 50
    `,
    [scan.site_id, scanId],
  ).find((row) => {
    const candidate = String(row.url || "");
    const candidateUrl = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
    return normalizedUrlKey(candidateUrl) === normalizedUrlKey(startUrl);
  });
  const previousResultRow = previousCandidate
    ? get<any>("SELECT result_json FROM scans WHERE id = ?", [previousCandidate.id])
    : null;
  const previousScan = previousCandidate && previousResultRow
    ? { ...previousCandidate, result_json: previousResultRow.result_json }
    : null;
  const comparison = buildScanComparison(previousScan, pages, issues, limits);
  const result = scanResult({
    startUrl,
    origin,
    phase,
    pages,
    issues,
    checkedLinks,
    checkedImages,
    checkedAssets,
    imageInventory,
    linkInventory,
    parameterUrls,
    robots,
    sitemap,
    limits,
    comparison,
  });
  run(
    `
    UPDATE scans
    SET status = 'completed',
        score = ?,
        pages_crawled = ?,
        issue_count = ?,
        result_json = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
    [score, pages.length, issues.length, JSON.stringify(result), scanId],
  );
}
