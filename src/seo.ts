import * as cheerio from "cheerio";
import Papa from "papaparse";
import { randomUUID } from "node:crypto";
import { parse as parseDomain } from "tldts";
import { createAiJob } from "./codex";
import { all, get, jsonParse, nowIso, run } from "./db";
import { getConfigValue } from "./config";
import { DEFAULT_KEYWORD_LANGUAGE_CODE, DEFAULT_KEYWORD_LOCATION_CODE } from "./defaults";
import { fetchJson, fetchText } from "./http";
import { clearScans, createIssueIgnore, deleteIssueIgnore, deleteScan, getScan, listAllScans, listIssueIgnores, listScans, sameSiteUrl, startScan } from "./scans";

export { clearScans, createIssueIgnore, deleteIssueIgnore, deleteScan, getScan, listAllScans, listIssueIgnores, listScans, sameSiteUrl, startScan };

export type Site = {
  id: string;
  name: string;
  domain: string;
  notes: string;
  location_code: number;
  language_code: string;
  crawl_protocol: CrawlProtocol;
  crawl_host: CrawlHost;
  crawl_speed: CrawlSpeed;
  crawl_max_pages: number;
  created_at: string;
  updated_at: string;
};

export type CrawlProtocol = "auto" | "https" | "http" | "both";
export type CrawlHost = "auto" | "root" | "www" | "both";
// "auto" follows the app-wide default crawl speed.
export type CrawlSpeed = "auto" | "polite" | "fast";

type KeywordRow = {
  keyword: string;
  searchVolume: number | null;
  difficulty: number | null;
  cpc: number | null;
  intent: string;
};

const tagColors = ["slate", "rose", "amber", "emerald", "sky", "violet", "stone"];

function stableNumber(input: string, min: number, max: number) {
  let hash = 0;
  for (let index = 0; index < input.length; index++) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return min + (hash % (max - min + 1));
}

function normalizeDomain(value: string) {
  return value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

// True when a SERP result host belongs to the tracked domain: exact match or a
// subdomain of it. Dot-boundary check avoids "start.com" matching "art.com".
function hostMatchesDomain(resultHost: string, target: string) {
  const host = normalizeDomain(String(resultHost || ""));
  const domain = normalizeDomain(String(target || ""));
  if (!host || !domain) return false;
  return host === domain || host.endsWith(`.${domain}`);
}

function normalizeCrawlProtocol(value: unknown): CrawlProtocol {
  return value === "https" || value === "http" || value === "both" ? value : "auto";
}

function normalizeCrawlHost(value: unknown): CrawlHost {
  return value === "root" || value === "www" || value === "both" ? value : "auto";
}

export function normalizeCrawlSpeed(value: unknown): CrawlSpeed {
  return value === "polite" || value === "fast" ? value : "auto";
}

export function normalizeCrawlMaxPages(value: unknown) {
  const pages = Math.round(Number(value));
  if (!Number.isFinite(pages) || pages <= 0) return 0;
  return Math.max(10, Math.min(1000, pages));
}

function defaultLocationCode() {
  const value = Number(getConfigValue("default_location_code") || DEFAULT_KEYWORD_LOCATION_CODE);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_KEYWORD_LOCATION_CODE;
}

function defaultLanguageCode() {
  return getConfigValue("default_language_code") || DEFAULT_KEYWORD_LANGUAGE_CODE;
}

function normalizeTagName(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 64);
}

function pickTagColor(name: string) {
  return tagColors[stableNumber(name, 0, tagColors.length - 1)];
}

function parseList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value || "")
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function decodeDuckDuckGoHref(href: string) {
  try {
    const url = new URL(href, "https://duckduckgo.com");
    const uddg = url.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : url.toString();
  } catch {
    return href;
  }
}

type WebSearchResult = {
  rank: number;
  domain: string;
  url: string;
  title: string;
  description: string;
  source: string;
};

function normalizeSearchResult(item: any, rank: number, source: string): WebSearchResult | null {
  const url = String(item.url || item.link || item.href || item.target || "").trim();
  if (!url) return null;
  return {
    rank,
    domain: normalizeDomain(item.domain || url),
    url,
    title: String(item.title || item.name || "").trim(),
    description: String(item.description || item.snippet || item.body || "").trim(),
    source,
  };
}

async function searchOpenSerp(query: string, limit: number, engine = "duckduckgo") {
  const base = (getConfigValue("openserp_url") || process.env.OPENSERP_URL || "").replace(/\/$/, "");
  if (!base) return null;
  const url = `${base}/${encodeURIComponent(engine)}/search?text=${encodeURIComponent(query)}&limit=${limit}`;
  const response = await fetchJson(url);
  if (!response.ok) throw new Error(`OpenSERP ${response.status}`);
  const data = response.data || {};
  const items =
    data.results ||
    data.items ||
    data.organic ||
    data.web ||
    data.data?.results ||
    [];
  return (Array.isArray(items) ? items : [])
    .map((item, index) => normalizeSearchResult(item, index + 1, `openserp:${engine}`))
    .filter(Boolean) as WebSearchResult[];
}

async function searchSearxng(query: string, limit: number) {
  const base = (getConfigValue("searxng_url") || process.env.SEARXNG_URL || "").replace(/\/$/, "");
  if (!base) return null;
  const url = `${base}/search?q=${encodeURIComponent(query)}&format=json`;
  const response = await fetchJson(url);
  if (!response.ok) throw new Error(`SearXNG ${response.status}`);
  const data = response.data || {};
  const items = data.results || data.items || data.organic || [];
  return (Array.isArray(items) ? items : [])
    .map((item, index) => normalizeSearchResult(
      {
        url: item.url || item.link,
        title: item.title,
        description: item.content || item.description || item.snippet,
        domain: item.parsed_url?.[1] || item.domain,
      },
      index + 1,
      "searxng",
    ))
    .filter(Boolean)
    .slice(0, limit) as WebSearchResult[];
}

async function searchDuckDuckGo(query: string, limit: number) {
  const response = await fetchText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
  if (!response.ok) throw new Error(`DuckDuckGo ${response.status}`);
  const $ = cheerio.load(response.text);
  const rows: WebSearchResult[] = [];
  $(".result").each((_, element) => {
    if (rows.length >= limit) return false;
    const link = $(element).find("a.result__a").first();
    const rawHref = link.attr("href") || "";
    const url = decodeDuckDuckGoHref(rawHref);
    const domain = normalizeDomain(url);
    if (!url || !domain) return;
    rows.push({
      rank: rows.length + 1,
      domain,
      url,
      title: link.text().replace(/\s+/g, " ").trim(),
      description: $(element).find(".result__snippet").text().replace(/\s+/g, " ").trim(),
      source: "duckduckgo",
    });
  });
  return rows;
}

async function searchWeb(query: string, limit: number) {
  const openSerpRows = await searchOpenSerp(query, limit).catch(() => null);
  if (openSerpRows?.length) return openSerpRows.slice(0, limit);
  const searxngRows = await searchSearxng(query, limit).catch(() => null);
  if (searxngRows?.length) return searxngRows.slice(0, limit);
  return searchDuckDuckGo(query, limit);
}

export function listSites() {
  return all<Site>("SELECT * FROM sites ORDER BY created_at DESC");
}

export function getSite(siteId: string) {
  return get<Site>("SELECT * FROM sites WHERE id = ?", [siteId]);
}

export function createSite(input: {
  name: string;
  domain?: string;
  notes?: string;
  locationCode?: number;
  languageCode?: string;
  crawlProtocol?: CrawlProtocol | string;
  crawlHost?: CrawlHost | string;
  crawlSpeed?: CrawlSpeed | string;
  crawlMaxPages?: number;
  crawl_protocol?: CrawlProtocol | string;
  crawl_host?: CrawlHost | string;
  crawl_speed?: CrawlSpeed | string;
  crawl_max_pages?: number;
}) {
  const id = randomUUID();
  const domain = normalizeDomain(input.domain || "");
  const name = input.name.trim() || domain || "Untitled site";
  const locationCode = Number(input.locationCode || defaultLocationCode());
  const languageCode = input.languageCode || defaultLanguageCode();
  const crawlProtocol = normalizeCrawlProtocol(
    input.crawlProtocol ?? input.crawl_protocol ?? getConfigValue("default_crawl_protocol"),
  );
  const crawlHost = normalizeCrawlHost(input.crawlHost ?? input.crawl_host ?? getConfigValue("default_crawl_host"));
  const crawlSpeed = normalizeCrawlSpeed(input.crawlSpeed ?? input.crawl_speed);
  const crawlMaxPages = normalizeCrawlMaxPages(input.crawlMaxPages ?? input.crawl_max_pages);
  run(
    `
    INSERT INTO sites (id, name, domain, notes, location_code, language_code, crawl_protocol, crawl_host, crawl_speed, crawl_max_pages)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      id,
      name,
      domain,
      input.notes?.trim() || "",
      locationCode,
      languageCode,
      crawlProtocol,
      crawlHost,
      crawlSpeed,
      crawlMaxPages,
    ],
  );
  return getSite(id)!;
}

export function updateSite(siteId: string, input: Partial<Site>) {
  const existing = getSite(siteId);
  if (!existing) throw new Error("Site not found.");
  const body = input as Partial<Site> & {
    crawlProtocol?: CrawlProtocol | string;
    crawlHost?: CrawlHost | string;
    crawlSpeed?: CrawlSpeed | string;
    crawlMaxPages?: number;
  };
  run(
    `
    UPDATE sites
    SET name = ?, domain = ?, notes = ?, location_code = ?, language_code = ?, crawl_protocol = ?, crawl_host = ?, crawl_speed = ?, crawl_max_pages = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
    [
      input.name ?? existing.name,
      normalizeDomain(input.domain ?? existing.domain),
      input.notes ?? existing.notes,
      input.location_code ?? existing.location_code,
      input.language_code ?? existing.language_code,
      normalizeCrawlProtocol(body.crawl_protocol ?? body.crawlProtocol ?? existing.crawl_protocol),
      normalizeCrawlHost(body.crawl_host ?? body.crawlHost ?? existing.crawl_host),
      normalizeCrawlSpeed(body.crawl_speed ?? body.crawlSpeed ?? existing.crawl_speed),
      normalizeCrawlMaxPages(body.crawl_max_pages ?? body.crawlMaxPages ?? existing.crawl_max_pages),
      siteId,
    ],
  );
  return getSite(siteId)!;
}

export function deleteSite(siteId: string) {
  const info = run("DELETE FROM sites WHERE id = ?", [siteId]);
  return { id: siteId, deleted: Number(info.changes || 0) > 0 };
}

function providerRequiredMessage(feature: string) {
  return `${feature} needs a real imported dataset. No generated SEO metrics are shown.`;
}

function emptyProviderResult(feature: string, extra: Record<string, unknown> = {}) {
  return {
    source: "provider-not-configured",
    providerRequired: "imported-dataset",
    warning: providerRequiredMessage(feature),
    ...extra,
  };
}

function publicDomainResult(result: any, fallbackDomain = "") {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  return {
    ...result,
    domain: result.domain || fallbackDomain || "",
  };
}

function publicDomainSnapshotRow(row: any) {
  const { site_id: siteId, domain, result_json, ...rest } = row;
  return {
    ...rest,
    site_id: siteId,
    domain,
    result: publicDomainResult(jsonParse(result_json, {}), domain),
  };
}

function publicSerpResult(result: any) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  return {
    ...result,
    rows: result.rows,
    domain: result.domain || "",
    domainPosition: result.domainPosition ?? null,
  };
}

function publicBrandLookupResult(result: any) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  return {
    ...result,
    resolvedEntity: result.resolvedEntity || "",
    shareOfVoice: result.shareOfVoice,
  };
}

async function duckDuckGoSuggestions(query: string, limit: number): Promise<KeywordRow[]> {
  const response = await fetchJson(`https://duckduckgo.com/ac/?q=${encodeURIComponent(query)}&type=list`);
  if (!response.ok) throw new Error(`DuckDuckGo suggestions ${response.status}`);
  const rows = Array.isArray(response.data) ? response.data : [];
  const seen = new Set<string>();
  return rows
    .map((item: any) => String(item.phrase || item.text || item.value || "").trim())
    .filter((keyword) => {
      const key = keyword.toLowerCase();
      if (!keyword || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map((keyword) => ({
      keyword,
      searchVolume: null,
      difficulty: null,
      cpc: null,
      intent: "unknown",
    }));
}

export async function researchKeywords(input: {
  siteId: string;
  query: string;
  locationCode?: number;
  languageCode?: string;
  limit?: number;
}) {
  const site = getSite(input.siteId);
  if (!site) throw new Error("Site not found.");
  const query = input.query.trim();
  if (!query) throw new Error("Keyword query is required.");
  const locationCode = input.locationCode || site.location_code;
  const languageCode = input.languageCode || site.language_code;
  const limit = Math.max(5, Math.min(100, input.limit || 25));
  let source = "duckduckgo-suggest";
  let rows: KeywordRow[] = [];
  let warning = "Keyword suggestions are real. Volume, CPC, and difficulty are unavailable because this local app does not generate third-party metrics.";

  try {
    rows = await duckDuckGoSuggestions(query, limit);
  } catch (error) {
    source = "suggest-error";
    warning = error instanceof Error ? error.message : "Keyword suggestions failed";
  }

  const id = randomUUID();
  run(
    `
    INSERT INTO keyword_research_runs
      (id, site_id, query, location_code, language_code, source, result_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [id, site.id, query, locationCode, languageCode, source, JSON.stringify(rows)],
  );
  return { id, siteId: site.id, query, source, rows, warning, createdAt: nowIso() };
}

export function saveKeywords(input: {
  siteId: string;
  keywords: Array<KeywordRow | string>;
  tags?: string[];
  tagMode?: "append" | "replace";
  source?: string;
}) {
  const site = getSite(input.siteId);
  if (!site) throw new Error("Site not found.");
  const tagNames = parseList(input.tags).map(normalizeTagName).filter(Boolean);
  for (const tag of tagNames) ensureSavedKeywordTag(site.id, tag);
  const saved = [];
  for (const row of input.keywords) {
    const keywordRow: KeywordRow =
      typeof row === "string"
        ? {
            keyword: row,
            searchVolume: null,
            difficulty: null,
            cpc: null,
            intent: "unknown",
          }
        : row;
    if (!keywordRow.keyword?.trim()) continue;
    const id = randomUUID();
    const existing = get<any>(
      "SELECT * FROM saved_keywords WHERE site_id = ? AND keyword = ? AND location_code = ? AND language_code = ?",
      [site.id, keywordRow.keyword, site.location_code, site.language_code],
    );
    const existingTags = jsonParse<string[]>(existing?.tags, []);
    // Only replace tags when the caller explicitly supplied some in replace mode;
    // re-saving research rows (no tags) must not wipe imported/manual tags.
    const nextTags =
      input.tagMode === "append"
        ? Array.from(new Set([...existingTags, ...tagNames]))
        : tagNames.length
          ? tagNames
          : existingTags;
    run(
      `
      INSERT INTO saved_keywords
        (id, site_id, keyword, location_code, language_code, search_volume, difficulty, cpc, intent, tags, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(site_id, keyword, location_code, language_code) DO UPDATE SET
        search_volume = COALESCE(excluded.search_volume, saved_keywords.search_volume),
        difficulty = COALESCE(excluded.difficulty, saved_keywords.difficulty),
        cpc = COALESCE(excluded.cpc, saved_keywords.cpc),
        intent = CASE WHEN excluded.intent = 'unknown' THEN saved_keywords.intent ELSE excluded.intent END,
        tags = excluded.tags,
        source = excluded.source
      `,
      [
        id,
        site.id,
        keywordRow.keyword,
        site.location_code,
        site.language_code,
        keywordRow.searchVolume,
        keywordRow.difficulty,
        keywordRow.cpc,
        keywordRow.intent || "unknown",
        JSON.stringify(nextTags),
        input.source || "research",
      ],
    );
    saved.push(keywordRow.keyword);
  }
  return { saved };
}

type ImportedKeywordMetricRow = {
  keyword: string;
  searchVolume: number | null;
  difficulty: number | null;
  cpc: number | null;
  intent: string;
};

function parseKeywordMetricsCsv(csv: string) {
  const parsed = Papa.parse<Record<string, unknown>>(csv, {
    header: true,
    skipEmptyLines: true,
  });
  if (parsed.errors.length) {
    const firstError = parsed.errors[0];
    throw new Error(`Keyword metrics CSV could not be parsed: ${firstError.message}`);
  }
  return parsed.data.filter((row) => Object.values(row).some((value) => String(value ?? "").trim()));
}

function normalizeImportedKeywordMetricRow(raw: Record<string, unknown>): ImportedKeywordMetricRow | null {
  const row = normalizedCsvRow(raw);
  const keyword = csvField(row, ["keyword", "query", "search term", "search_term", "term"]);
  if (!keyword) return null;
  return {
    keyword,
    searchVolume: csvNumber(row, ["search volume", "search_volume", "volume", "avg monthly searches", "monthly searches", "impressions"]),
    difficulty: csvNumber(row, ["difficulty", "keyword difficulty", "keyword_difficulty", "kd", "seo difficulty"]),
    cpc: csvNumber(row, ["cpc", "cost per click", "cost_per_click", "avg cpc", "average cpc"]),
    intent: csvField(row, ["intent", "search intent", "main intent"]) || "unknown",
  };
}

function mapKeywordMetricImport(row: any) {
  return {
    id: row.id,
    siteId: row.site_id,
    source: "keyword-metrics-import",
    sourceName: row.source_name,
    source_name: row.source_name,
    rowCount: row.row_count,
    row_count: row.row_count,
    insertedCount: row.inserted_count,
    inserted_count: row.inserted_count,
    updatedCount: row.updated_count,
    updated_count: row.updated_count,
    rows: jsonParse<ImportedKeywordMetricRow[]>(row.rows_json, []),
    createdAt: row.created_at,
    created_at: row.created_at,
  };
}

export function listKeywordMetricImports(siteId: string) {
  return all<any>(
    "SELECT * FROM keyword_metric_imports WHERE site_id = ? ORDER BY created_at DESC",
    [siteId],
  ).map(mapKeywordMetricImport);
}

export function importKeywordMetricsCsv(input: {
  siteId?: string;
  sourceName?: string;
  csv?: string;
  rows?: Record<string, unknown>[];
}) {
  const site = getSite(String(input.siteId || ""));
  if (!site) throw new Error("Site not found.");
  const rawRows = input.csv ? parseKeywordMetricsCsv(input.csv) : input.rows || [];
  const rows = rawRows
    .map(normalizeImportedKeywordMetricRow)
    .filter((row): row is ImportedKeywordMetricRow => Boolean(row));
  if (!rows.length) throw new Error("Import file has no keyword metric rows.");

  let insertedCount = 0;
  let updatedCount = 0;
  for (const row of rows) {
    const existing = get<any>(
      "SELECT * FROM saved_keywords WHERE site_id = ? AND lower(keyword) = lower(?) AND location_code = ? AND language_code = ?",
      [site.id, row.keyword, site.location_code, site.language_code],
    );
    const nextIntent = row.intent && row.intent !== "unknown" ? row.intent : existing?.intent || "unknown";
    if (existing) {
      run(
        `
        UPDATE saved_keywords
        SET search_volume = ?, difficulty = ?, cpc = ?, intent = ?, source = ?
        WHERE id = ?
        `,
        [
          row.searchVolume ?? existing.search_volume,
          row.difficulty ?? existing.difficulty,
          row.cpc ?? existing.cpc,
          nextIntent,
          "keyword-metrics-import",
          existing.id,
        ],
      );
      updatedCount += 1;
    } else {
      run(
        `
        INSERT INTO saved_keywords
          (id, site_id, keyword, location_code, language_code, search_volume, difficulty, cpc, intent, tags, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?)
        `,
        [
          randomUUID(),
          site.id,
          row.keyword,
          site.location_code,
          site.language_code,
          row.searchVolume,
          row.difficulty,
          row.cpc,
          nextIntent,
          "keyword-metrics-import",
        ],
      );
      insertedCount += 1;
    }
    run(
      `
      UPDATE rank_keywords
      SET search_volume = COALESCE(?, search_volume),
          keyword_difficulty = COALESCE(?, keyword_difficulty),
          cpc = COALESCE(?, cpc),
          metrics_fetched_at = CURRENT_TIMESTAMP
      WHERE lower(keyword) = lower(?)
        AND tracker_id IN (
          SELECT id FROM rank_trackers
          WHERE site_id = ?
            AND location_code = ?
            AND language_code = ?
        )
      `,
      [row.searchVolume, row.difficulty, row.cpc, row.keyword, site.id, site.location_code, site.language_code],
    );
  }

  const id = randomUUID();
  run(
    `
    INSERT INTO keyword_metric_imports
      (id, site_id, source_name, row_count, inserted_count, updated_count, rows_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      id,
      site.id,
      String(input.sourceName || "Keyword metrics CSV").slice(0, 160),
      rows.length,
      insertedCount,
      updatedCount,
      JSON.stringify(rows),
    ],
  );
  return mapKeywordMetricImport(get<any>("SELECT * FROM keyword_metric_imports WHERE id = ?", [id]));
}

export function listSavedKeywords(siteId: string) {
  return all<any>(
    "SELECT * FROM saved_keywords WHERE site_id = ? ORDER BY created_at DESC",
    [siteId],
  ).map((row) => ({ ...row, tags: jsonParse<string[]>(row.tags, []) }));
}

export function ensureSavedKeywordTag(siteId: string, name: string, color?: string) {
  const cleanName = normalizeTagName(name);
  if (!cleanName) throw new Error("Tag name is required.");
  const existing = get<any>(
    "SELECT * FROM saved_keyword_tags WHERE site_id = ? AND lower(name) = lower(?)",
    [siteId, cleanName],
  );
  if (existing) return existing;
  const id = randomUUID();
  run(
    `
    INSERT INTO saved_keyword_tags (id, site_id, name, color)
    VALUES (?, ?, ?, ?)
    `,
    [id, siteId, cleanName, color || pickTagColor(cleanName)],
  );
  return get<any>("SELECT * FROM saved_keyword_tags WHERE id = ?", [id])!;
}

export function listSavedKeywordTags(siteId: string) {
  const tags = all<any>(
    "SELECT * FROM saved_keyword_tags WHERE site_id = ? ORDER BY name",
    [siteId],
  );
  const keywords = listSavedKeywords(siteId);
  return tags.map((tag) => ({
    ...tag,
    keyword_count: keywords.filter((keyword) => keyword.tags.includes(tag.name)).length,
  }));
}

export function querySavedKeywords(input: {
  siteId: string;
  search?: string;
  includeTerms?: string[];
  excludeTerms?: string[];
  minVolume?: number | null;
  maxVolume?: number | null;
  minDifficulty?: number | null;
  maxDifficulty?: number | null;
  minCpc?: number | null;
  maxCpc?: number | null;
  tagNames?: string[];
  page?: number;
  pageSize?: number;
  sort?: string;
  order?: string;
}) {
  const site = getSite(input.siteId);
  if (!site) throw new Error("Site not found.");
  const search = String(input.search || "").trim().toLowerCase();
  const includeTerms = parseList(input.includeTerms).map((item) => item.toLowerCase());
  const excludeTerms = parseList(input.excludeTerms).map((item) => item.toLowerCase());
  const tagNames = parseList(input.tagNames).map(normalizeTagName);
  let rows = listSavedKeywords(site.id);

  rows = rows.filter((row) => {
    const keyword = String(row.keyword || "").toLowerCase();
    if (search && !keyword.includes(search)) return false;
    if (includeTerms.some((term) => !keyword.includes(term))) return false;
    if (excludeTerms.some((term) => keyword.includes(term))) return false;
    if (tagNames.length > 0 && !tagNames.every((tag) => row.tags.includes(tag))) return false;
    if (typeof input.minVolume === "number" && Number(row.search_volume || 0) < input.minVolume) return false;
    if (typeof input.maxVolume === "number" && Number(row.search_volume || 0) > input.maxVolume) return false;
    if (typeof input.minDifficulty === "number" && Number(row.difficulty || 0) < input.minDifficulty) return false;
    if (typeof input.maxDifficulty === "number" && Number(row.difficulty || 0) > input.maxDifficulty) return false;
    if (typeof input.minCpc === "number" && Number(row.cpc || 0) < input.minCpc) return false;
    if (typeof input.maxCpc === "number" && Number(row.cpc || 0) > input.maxCpc) return false;
    return true;
  });

  const sort = input.sort || "created_at";
  const order = input.order === "asc" ? 1 : -1;
  const sortValue = (row: any) => {
    switch (sort) {
      case "keyword":
        return String(row.keyword || "");
      case "search_volume":
      case "volume":
        return Number(row.search_volume || 0);
      case "difficulty":
        return Number(row.difficulty || 0);
      case "cpc":
        return Number(row.cpc || 0);
      default:
        return String(row.created_at || "");
    }
  };
  rows.sort((a, b) => {
    const left = sortValue(a);
    const right = sortValue(b);
    if (left < right) return -1 * order;
    if (left > right) return 1 * order;
    return 0;
  });

  const total = rows.length;
  const pageSize = Math.max(10, Math.min(250, Number(input.pageSize || 50)));
  const page = Math.max(1, Number(input.page || 1));
  const offset = (page - 1) * pageSize;
  return {
    rows: rows.slice(offset, offset + pageSize),
    total,
    page,
    pageSize,
    tags: listSavedKeywordTags(site.id),
  };
}

export function updateSavedKeywordTags(input: {
  siteId: string;
  savedKeywordIds: string[];
  addTags?: string[] | string;
  removeTagNames?: string[] | string;
  removeTagIds?: string[];
}) {
  const site = getSite(input.siteId);
  if (!site) throw new Error("Site not found.");
  const addTags = parseList(input.addTags).map(normalizeTagName).filter(Boolean);
  const removeTagNames = new Set(parseList(input.removeTagNames).map(normalizeTagName));
  for (const tagId of input.removeTagIds || []) {
    const tag = get<any>("SELECT * FROM saved_keyword_tags WHERE id = ? AND site_id = ?", [tagId, site.id]);
    if (tag) removeTagNames.add(tag.name);
  }
  for (const tag of addTags) ensureSavedKeywordTag(site.id, tag);
  let updated = 0;
  for (const id of input.savedKeywordIds || []) {
    const row = get<any>("SELECT * FROM saved_keywords WHERE id = ? AND site_id = ?", [id, site.id]);
    if (!row) continue;
    const current = new Set(jsonParse<string[]>(row.tags, []));
    for (const tag of addTags) current.add(tag);
    for (const tag of removeTagNames) current.delete(tag);
    run("UPDATE saved_keywords SET tags = ? WHERE id = ?", [JSON.stringify(Array.from(current)), id]);
    updated += 1;
  }
  return { updated, tags: listSavedKeywordTags(site.id) };
}

export function updateSavedKeywordTag(input: {
  siteId: string;
  tagId: string;
  name?: string;
  color?: string | null;
}) {
  const site = getSite(input.siteId);
  if (!site) throw new Error("Site not found.");
  const tag = get<any>("SELECT * FROM saved_keyword_tags WHERE id = ? AND site_id = ?", [
    input.tagId,
    site.id,
  ]);
  if (!tag) throw new Error("Tag not found.");
  const nextName = input.name ? normalizeTagName(input.name) : tag.name;
  const nextColor = input.color || tag.color || pickTagColor(nextName);
  run(
    "UPDATE saved_keyword_tags SET name = ?, color = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [nextName, nextColor, input.tagId],
  );
  if (nextName !== tag.name) {
    for (const keyword of listSavedKeywords(site.id)) {
      if (!keyword.tags.includes(tag.name)) continue;
      const tags = keyword.tags.map((item: string) => (item === tag.name ? nextName : item));
      run("UPDATE saved_keywords SET tags = ? WHERE id = ?", [JSON.stringify(Array.from(new Set(tags))), keyword.id]);
    }
  }
  return get<any>("SELECT * FROM saved_keyword_tags WHERE id = ?", [input.tagId]);
}

export function deleteSavedKeywordTag(input: { siteId: string; tagId: string }) {
  const site = getSite(input.siteId);
  if (!site) throw new Error("Site not found.");
  const tag = get<any>("SELECT * FROM saved_keyword_tags WHERE id = ? AND site_id = ?", [
    input.tagId,
    site.id,
  ]);
  if (!tag) throw new Error("Tag not found.");
  for (const keyword of listSavedKeywords(site.id)) {
    if (!keyword.tags.includes(tag.name)) continue;
    const tags = keyword.tags.filter((item: string) => item !== tag.name);
    run("UPDATE saved_keywords SET tags = ? WHERE id = ?", [JSON.stringify(tags), keyword.id]);
  }
  run("DELETE FROM saved_keyword_tags WHERE id = ? AND site_id = ?", [input.tagId, site.id]);
  return { deleted: true };
}

export function removeSavedKeywords(siteId: string, savedKeywordIds: string[]) {
  const site = getSite(siteId);
  if (!site) throw new Error("Site not found.");
  let removed = 0;
  for (const id of savedKeywordIds || []) {
    const info = run("DELETE FROM saved_keywords WHERE id = ? AND site_id = ?", [id, site.id]);
    removed += Number(info.changes || 0);
  }
  return { removed };
}

export function listRankTrackers(siteId: string) {
  const trackers = all<any>(
    "SELECT * FROM rank_trackers WHERE site_id = ? ORDER BY created_at DESC",
    [siteId],
  );
  return trackers.map((tracker) => ({
    ...tracker,
    keywords: all<any>("SELECT * FROM rank_keywords WHERE tracker_id = ? ORDER BY keyword", [
      tracker.id,
    ]),
    runs: all<any>(
      "SELECT * FROM rank_runs WHERE tracker_id = ? ORDER BY started_at DESC",
      [tracker.id],
    ),
    latest: all<any>(
      `
      SELECT rs.*
      FROM rank_snapshots rs
      JOIN (
        SELECT keyword, max(checked_at) AS checked_at
        FROM rank_snapshots
        WHERE tracker_id = ?
        GROUP BY keyword
      ) latest ON latest.keyword = rs.keyword AND latest.checked_at = rs.checked_at
      WHERE rs.tracker_id = ?
      ORDER BY rs.position IS NULL, rs.position ASC
      `,
      [tracker.id, tracker.id],
    ),
  }));
}

export function createRankTracker(input: {
  siteId: string;
  domain: string;
  keywords: string[];
  locationCode?: number;
  languageCode?: string;
  device?: string;
  depth?: number;
}) {
  const site = getSite(input.siteId);
  if (!site) throw new Error("Site not found.");
  const id = randomUUID();
  run(
    `
    INSERT INTO rank_trackers
      (id, site_id, domain, location_code, language_code, device, serp_depth)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      id,
      site.id,
      normalizeDomain(input.domain || site.domain),
      input.locationCode || site.location_code,
      input.languageCode || site.language_code,
      input.device || "desktop",
      input.depth || 50,
    ],
  );
  addRankKeywords(id, input.keywords);
  return listRankTrackers(site.id).find((tracker) => tracker.id === id);
}

function savedKeywordMetricsForTracker(tracker: any, keyword: string) {
  return get<any>(
    `
    SELECT search_volume, difficulty, cpc
    FROM saved_keywords
    WHERE site_id = ?
      AND lower(keyword) = lower(?)
      AND location_code = ?
      AND language_code = ?
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [tracker.site_id, keyword, tracker.location_code, tracker.language_code],
  );
}

function hasImportedKeywordMetrics(metrics: any) {
  return metrics && (metrics.search_volume != null || metrics.difficulty != null || metrics.cpc != null);
}

export function addRankKeywords(trackerId: string, keywords: string[]) {
  const tracker = get<any>("SELECT * FROM rank_trackers WHERE id = ?", [trackerId]);
  if (!tracker) throw new Error("Tracker not found.");
  for (const raw of keywords) {
    const keyword = raw.trim();
    if (!keyword) continue;
    const metrics = savedKeywordMetricsForTracker(tracker, keyword);
    const hasMetrics = hasImportedKeywordMetrics(metrics);
    run(
      `
      INSERT INTO rank_keywords
        (id, tracker_id, keyword, search_volume, keyword_difficulty, cpc, metrics_fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END)
      ON CONFLICT(tracker_id, keyword) DO NOTHING
      `,
      [
        randomUUID(),
        trackerId,
        keyword,
        metrics?.search_volume ?? null,
        metrics?.difficulty ?? null,
        metrics?.cpc ?? null,
        hasMetrics ? 1 : 0,
      ],
    );
  }
}

export function removeRankKeywords(trackerId: string, keywordIds: string[]) {
  const tracker = get<any>("SELECT * FROM rank_trackers WHERE id = ?", [trackerId]);
  if (!tracker) throw new Error("Tracker not found.");
  let removed = 0;
  for (const id of keywordIds || []) {
    const info = run("DELETE FROM rank_keywords WHERE id = ? AND tracker_id = ?", [id, trackerId]);
    removed += Number(info.changes || 0);
  }
  return { removed, tracker: listRankTrackers(tracker.site_id).find((item) => item.id === trackerId) };
}

export function getRankKeywordHistory(input: { trackerId: string; keywordId: string; sinceDays?: number }) {
  const tracker = get<any>("SELECT * FROM rank_trackers WHERE id = ?", [input.trackerId]);
  if (!tracker) throw new Error("Tracker not found.");
  const sinceDays = Math.max(1, Math.min(730, input.sinceDays || 365));
  return all<any>(
    `
    SELECT position, url, title, checked_at
    FROM rank_snapshots
    WHERE tracker_id = ?
      AND keyword_id = ?
      AND checked_at >= datetime('now', ?)
    ORDER BY checked_at ASC
    `,
    [input.trackerId, input.keywordId, `-${sinceDays} days`],
  );
}

export function getRankTrackerTrend(trackerId: string, sinceDays = 365) {
  const tracker = get<any>("SELECT * FROM rank_trackers WHERE id = ?", [trackerId]);
  if (!tracker) throw new Error("Tracker not found.");
  const runs = all<any>(
    `
    SELECT * FROM rank_runs
    WHERE tracker_id = ?
      AND started_at >= datetime('now', ?)
    ORDER BY started_at ASC
    `,
    [trackerId, `-${Math.max(1, Math.min(730, sinceDays))} days`],
  );
  return runs.map((rankRun) => {
    const rows = all<any>("SELECT * FROM rank_snapshots WHERE run_id = ?", [rankRun.id]);
    return {
      runId: rankRun.id,
      checkedAt: rankRun.finished_at || rankRun.started_at,
      top3: rows.filter((row) => row.position != null && row.position <= 3).length,
      top10: rows.filter((row) => row.position != null && row.position <= 10).length,
      top20: rows.filter((row) => row.position != null && row.position <= 20).length,
      notRanking: rows.filter((row) => row.position == null).length,
    };
  });
}

export function syncRankKeywordMetrics(trackerId: string) {
  const tracker = get<any>("SELECT * FROM rank_trackers WHERE id = ?", [trackerId]);
  if (!tracker) throw new Error("Tracker not found.");
  const keywords = all<any>("SELECT * FROM rank_keywords WHERE tracker_id = ?", [trackerId]);
  let updated = 0;
  const missingKeywords: string[] = [];
  for (const keyword of keywords) {
    const metrics = savedKeywordMetricsForTracker(tracker, keyword.keyword);
    if (!hasImportedKeywordMetrics(metrics)) {
      missingKeywords.push(keyword.keyword);
      continue;
    }
    run(
      `
      UPDATE rank_keywords
      SET search_volume = COALESCE(?, search_volume),
          keyword_difficulty = COALESCE(?, keyword_difficulty),
          cpc = COALESCE(?, cpc),
          metrics_fetched_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [metrics.search_volume, metrics.difficulty, metrics.cpc, keyword.id],
    );
    updated += 1;
  }
  return {
    updated,
    skipped: missingKeywords.length,
    source: "local-keyword-metrics",
    warning: missingKeywords.length
      ? "Some tracked keywords do not have imported metrics yet. Import a keyword metrics CSV from Saved keywords."
      : "",
    missingKeywords,
    tracker: listRankTrackers(tracker.site_id).find((item) => item.id === trackerId),
  };
}

async function serpPosition(keyword: string, tracker: any) {
  const target = normalizeDomain(tracker.domain);
  // Do not swallow provider failures into a false "not ranking" result — let the
  // error propagate so the run is marked failed instead of fabricating a drop.
  const rows = await searchWeb(keyword, Math.max(10, tracker.serp_depth));
  const match = rows.find((row) => hostMatchesDomain(row.domain, target));
  if (match) return { position: match.rank, url: match.url, title: match.title };
  return { position: null, url: "", title: "" };
}

export async function runRankCheck(trackerId: string) {
  const tracker = get<any>("SELECT * FROM rank_trackers WHERE id = ?", [trackerId]);
  if (!tracker) throw new Error("Tracker not found.");
  const keywords = all<any>("SELECT * FROM rank_keywords WHERE tracker_id = ?", [trackerId]);
  const runId = randomUUID();
  run("INSERT INTO rank_runs (id, tracker_id, status, message) VALUES (?, ?, ?, ?)", [
    runId,
    trackerId,
    "running",
    "Checking SERPs",
  ]);
  try {
    for (const keyword of keywords) {
      const result = await serpPosition(keyword.keyword, tracker);
      run(
        `
        INSERT INTO rank_snapshots
          (id, run_id, tracker_id, keyword_id, keyword, position, url, title)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          randomUUID(),
          runId,
          trackerId,
          keyword.id,
          keyword.keyword,
          result.position,
          result.url,
          result.title,
        ],
      );
    }
    run(
      "UPDATE rank_runs SET status = 'completed', message = 'Completed', finished_at = CURRENT_TIMESTAMP WHERE id = ?",
      [runId],
    );
  } catch (error) {
    run(
      "UPDATE rank_runs SET status = 'failed', message = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?",
      [error instanceof Error ? error.message : "Rank check failed", runId],
    );
    throw error;
  }
  return { runId, tracker: listRankTrackers(tracker.site_id).find((item) => item.id === trackerId) };
}

export async function domainOverview(input: { siteId: string; domain?: string }) {
  const site = getSite(input.siteId);
  if (!site) throw new Error("Site not found.");
  const domain = normalizeDomain(input.domain || site.domain);
  if (!domain) throw new Error("Domain is required.");
  const imported = latestOrganicImport(site.id, domain);
  if (imported) {
    return {
      source: "organic-import",
      domain,
      organicKeywords: imported.summary.organicKeywords,
      organicTraffic: imported.summary.organicTraffic,
      estimatedValue: imported.summary.estimatedValue,
      competitors: [],
      topPages: imported.pages.slice(0, 10),
      importId: imported.id,
      sourceName: imported.sourceName,
      importedAt: imported.createdAt,
    };
  }
  return emptyProviderResult("Organic research", {
    domain,
    organicKeywords: null,
    organicTraffic: null,
    estimatedValue: null,
    competitors: [],
    topPages: [],
  });
}

function relativePath(url: string) {
  try {
    const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return null;
  }
}

function localScanPagesForDomain(siteId: string, domain: string, page: number, pageSize: number, search: string) {
  const scope = `https://${domain}`;
  const scans = all<any>(
    `
    SELECT * FROM scans
    WHERE site_id = ? AND status = 'completed' AND result_json IS NOT NULL
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 10
    `,
    [siteId],
  );

  for (const scan of scans) {
    const result = jsonParse<any>(scan.result_json, null);
    const pages = Array.isArray(result?.pages) ? result.pages : [];
    const rows = pages
      .filter((row: any) => sameSiteUrl(String(row.finalUrl || row.url || ""), scope))
      .map((row: any) => {
        const pageUrl = String(row.finalUrl || row.url || "");
        return {
          page: pageUrl,
          relativePath: relativePath(pageUrl),
          organicTraffic: null,
          keywords: null,
          title: String(row.title || ""),
          issues: Array.isArray(row.issues) ? row.issues.length : 0,
          source: "local-scan",
          scanId: scan.id,
          scannedAt: scan.updated_at || scan.created_at,
        };
      });
    if (!rows.length) continue;

    const filtered = search
      ? rows.filter((row: any) =>
        `${row.page} ${row.relativePath || ""} ${row.title || ""}`.toLowerCase().includes(search),
      )
      : rows;
    const offset = (page - 1) * pageSize;
    return {
      domain,
      page,
      pageSize,
      totalCount: filtered.length,
      hasMore: offset + pageSize < filtered.length,
      pages: filtered.slice(offset, offset + pageSize),
      fetchedAt: nowIso(),
      warning: "Showing real pages from the latest local scan. Traffic and keyword counts stay unavailable without an imported organic dataset.",
    };
  }

  return null;
}

type ImportedOrganicKeywordRow = {
  keyword: string;
  position: number | null;
  searchVolume: number | null;
  traffic: number | null;
  keywordDifficulty: number | null;
  cpc: number | null;
  url: string;
  relativeUrl: string | null;
  intent: string;
};

type ImportedOrganicPageRow = {
  page: string;
  relativePath: string | null;
  title: string;
  organicTraffic: number | null;
  keywords: number | null;
  value: number | null;
  source: string;
};

function parseOrganicCsv(csv: string) {
  const parsed = Papa.parse<Record<string, unknown>>(csv, {
    header: true,
    skipEmptyLines: true,
  });
  if (parsed.errors.length) {
    const firstError = parsed.errors[0];
    throw new Error(`Organic research CSV could not be parsed: ${firstError.message}`);
  }
  return parsed.data.filter((row) => Object.values(row).some((value) => String(value ?? "").trim()));
}

function organicUrl(value: string, domain: string) {
  const clean = value.trim();
  if (!clean) return "";
  if (/^https?:\/\//i.test(clean)) return clean;
  if (clean.startsWith("/")) return `https://${domain}${clean}`;
  if (clean.includes(".") && !clean.includes(" ")) return `https://${clean}`;
  return "";
}

function normalizeImportedOrganicRow(raw: Record<string, unknown>, domain: string) {
  const row = normalizedCsvRow(raw);
  const keyword = csvField(row, ["keyword", "query", "search term", "search_term", "term"]);
  const rawUrl = csvField(row, [
    "url",
    "page",
    "ranking url",
    "ranking_url",
    "ranking page",
    "top page",
    "landing page",
    "target url",
    "page url",
  ]);
  const url = organicUrl(rawUrl, domain);
  const acceptsUrl = !url || sameSiteUrl(url, `https://${domain}`);
  const traffic = csvNumber(row, ["traffic", "organic traffic", "organic_traffic", "clicks", "estimated traffic"]);
  const keywordCount = csvNumber(row, ["keywords", "keyword count", "keyword_count", "ranking keywords"]);
  const page: ImportedOrganicPageRow | null = url && acceptsUrl
    ? {
        page: url,
        relativePath: relativePath(url),
        title: csvField(row, ["title", "page title", "meta title"]),
        organicTraffic: traffic,
        keywords: keywordCount || (keyword ? 1 : null),
        value: csvNumber(row, ["value", "traffic value", "estimated value", "cost"]),
        source: "organic-import",
      }
    : null;
  const keywordRow: ImportedOrganicKeywordRow | null = keyword && acceptsUrl
    ? {
        keyword,
        position: csvNumber(row, ["position", "rank", "ranking position", "current position"]),
        searchVolume: csvNumber(row, ["search volume", "search_volume", "volume", "avg monthly searches", "monthly searches", "impressions"]),
        traffic,
        keywordDifficulty: csvNumber(row, ["keyword difficulty", "keyword_difficulty", "difficulty", "kd", "seo difficulty"]),
        cpc: csvNumber(row, ["cpc", "cost per click", "cost_per_click"]),
        url,
        relativeUrl: url ? relativePath(url) : null,
        intent: csvField(row, ["intent", "search intent"]) || "unknown",
      }
    : null;
  return { keyword: keywordRow, page };
}

function mergeOrganicPages(rows: ImportedOrganicPageRow[]) {
  const byPage = new Map<string, ImportedOrganicPageRow>();
  for (const row of rows) {
    const key = row.page;
    const current = byPage.get(key);
    if (!current) {
      byPage.set(key, { ...row });
      continue;
    }
    current.title ||= row.title;
    current.organicTraffic = (Number(current.organicTraffic || 0) + Number(row.organicTraffic || 0)) || null;
    current.keywords = (Number(current.keywords || 0) + Number(row.keywords || 0)) || null;
    current.value = (Number(current.value || 0) + Number(row.value || 0)) || null;
  }
  return [...byPage.values()].sort((a, b) => Number(b.organicTraffic || 0) - Number(a.organicTraffic || 0));
}

function organicSummary(keywords: ImportedOrganicKeywordRow[], pages: ImportedOrganicPageRow[]) {
  const keywordSet = new Set(keywords.map((row) => row.keyword.toLowerCase()).filter(Boolean));
  const organicKeywords = keywordSet.size || keywords.length || pages.reduce((total, row) => total + Number(row.keywords || 0), 0);
  return {
    organicKeywords,
    organicTraffic: pages.reduce((total, row) => total + Number(row.organicTraffic || 0), 0) || keywords.reduce((total, row) => total + Number(row.traffic || 0), 0) || null,
    estimatedValue: pages.reduce((total, row) => total + Number(row.value || 0), 0) || null,
  };
}

function mapOrganicImport(row: any) {
  const keywords = jsonParse<ImportedOrganicKeywordRow[]>(row.keywords_json, []);
  const pages = jsonParse<ImportedOrganicPageRow[]>(row.pages_json, []);
  const summary = jsonParse<Record<string, any>>(row.summary_json, {});
  return {
    id: row.id,
    siteId: row.site_id,
    domain: row.domain,
    source: "organic-import",
    sourceName: row.source_name,
    source_name: row.source_name,
    keywordCount: row.keyword_count,
    keyword_count: row.keyword_count,
    pageCount: row.page_count,
    page_count: row.page_count,
    rowCount: Number(row.keyword_count || 0) + Number(row.page_count || 0),
    row_count: Number(row.keyword_count || 0) + Number(row.page_count || 0),
    summary,
    keywords,
    pages,
    result: { source: "organic-import", domain: row.domain, ...summary },
    createdAt: row.created_at,
    created_at: row.created_at,
  };
}

function latestOrganicImport(siteId: string, domain: string) {
  const row = get<any>(
    "SELECT * FROM organic_imports WHERE site_id = ? AND domain = ? ORDER BY created_at DESC LIMIT 1",
    [siteId, domain],
  );
  return row ? mapOrganicImport(row) : null;
}

export function listOrganicImports(siteId: string) {
  return all<any>(
    "SELECT * FROM organic_imports WHERE site_id = ? ORDER BY created_at DESC",
    [siteId],
  ).map(mapOrganicImport);
}

export function importOrganicResearchCsv(input: {
  siteId?: string;
  domain?: string;
  sourceName?: string;
  csv?: string;
  rows?: Record<string, unknown>[];
}) {
  const site = getSite(String(input.siteId || ""));
  if (!site) throw new Error("Site not found.");
  const domain = normalizeDomain(input.domain || site.domain);
  if (!domain) throw new Error("Domain is required.");
  const rawRows = input.csv ? parseOrganicCsv(input.csv) : input.rows || [];
  const normalized = rawRows.map((row) => normalizeImportedOrganicRow(row, domain));
  const keywords = normalized.map((row) => row.keyword).filter((row): row is ImportedOrganicKeywordRow => Boolean(row));
  const pages = mergeOrganicPages(normalized.map((row) => row.page).filter((row): row is ImportedOrganicPageRow => Boolean(row)));
  if (!keywords.length && !pages.length) {
    throw new Error("Import file has no organic keyword or page rows for this domain.");
  }
  const summary = organicSummary(keywords, pages);
  const id = randomUUID();
  run(
    `
    INSERT INTO organic_imports
      (id, site_id, domain, source_name, keyword_count, page_count, summary_json, keywords_json, pages_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      id,
      site.id,
      domain,
      String(input.sourceName || "Organic research CSV").slice(0, 160),
      keywords.length,
      pages.length,
      JSON.stringify(summary),
      JSON.stringify(keywords),
      JSON.stringify(pages),
    ],
  );
  return mapOrganicImport(get<any>("SELECT * FROM organic_imports WHERE id = ?", [id]));
}

export async function getDomainKeywordSuggestions(input: {
  siteId: string;
  domain?: string;
  limit?: number;
}) {
  const site = getSite(input.siteId);
  if (!site) throw new Error("Site not found.");
  const target = normalizeDomain(input.domain || site.domain);
  const limit = Math.max(5, Math.min(100, input.limit || 25));
  const page = await getDomainKeywordsPage({
    siteId: site.id,
    domain: target,
    page: 1,
    pageSize: limit,
    sortMode: "traffic",
    sortOrder: "desc",
  });
  return page.keywords.slice(0, limit);
}

export async function getDomainKeywordsPage(input: {
  siteId: string;
  domain?: string;
  includeSubdomains?: boolean;
  page?: number;
  pageSize?: number;
  sortMode?: string;
  sortOrder?: string;
  search?: string;
}) {
  const site = getSite(input.siteId);
  if (!site) throw new Error("Site not found.");
  const target = normalizeDomain(input.domain || site.domain);
  if (!target) throw new Error("Domain is required.");
  const page = Math.max(1, Number(input.page || 1));
  const pageSize = Math.max(10, Math.min(200, Number(input.pageSize || 50)));
  const search = String(input.search || "").trim().toLowerCase();
  const imported = latestOrganicImport(site.id, target);
  if (imported) {
    const rows = (search
      ? imported.keywords.filter((row) => `${row.keyword} ${row.url}`.toLowerCase().includes(search))
      : imported.keywords
    ).sort((a, b) => Number(a.position || 999999) - Number(b.position || 999999));
    const paged = paginateRows(rows, page, pageSize);
    return {
      source: "organic-import",
      domain: target,
      page,
      pageSize,
      totalCount: paged.totalCount,
      hasMore: paged.hasMore,
      keywords: paged.rows,
      fetchedAt: nowIso(),
      importId: imported.id,
      sourceName: imported.sourceName,
    };
  }
  return {
    source: "provider-not-configured",
    domain: target,
    page,
    pageSize,
    totalCount: 0,
    hasMore: false,
    keywords: [],
    fetchedAt: nowIso(),
    warning: providerRequiredMessage("Ranked domain keywords"),
  };
}

export async function getDomainPagesPage(input: {
  siteId: string;
  domain?: string;
  includeSubdomains?: boolean;
  page?: number;
  pageSize?: number;
  sortMode?: string;
  sortOrder?: string;
  search?: string;
}) {
  const site = getSite(input.siteId);
  if (!site) throw new Error("Site not found.");
  const target = normalizeDomain(input.domain || site.domain);
  if (!target) throw new Error("Domain is required.");
  const page = Math.max(1, Number(input.page || 1));
  const pageSize = Math.max(10, Math.min(200, Number(input.pageSize || 50)));
  const search = String(input.search || "").trim().toLowerCase();
  const imported = latestOrganicImport(site.id, target);
  if (imported?.pages.length) {
    const rows = search
      ? imported.pages.filter((row) => `${row.page} ${row.relativePath || ""} ${row.title || ""}`.toLowerCase().includes(search))
      : imported.pages;
    const paged = paginateRows(rows, page, pageSize);
    return {
      source: "organic-import",
      domain: target,
      page,
      pageSize,
      totalCount: paged.totalCount,
      hasMore: paged.hasMore,
      pages: paged.rows,
      fetchedAt: nowIso(),
      importId: imported.id,
      sourceName: imported.sourceName,
    };
  }
  if (sameSiteUrl(`https://${target}`, `https://${site.domain}`)) {
    const localPages = localScanPagesForDomain(site.id, target, page, pageSize, search);
    if (localPages) {
      return { source: "local-scan", ...localPages };
    }
  }
  return {
    source: "provider-not-configured",
    domain: target,
    page,
    pageSize,
    totalCount: 0,
    hasMore: false,
    pages: [],
    fetchedAt: nowIso(),
    warning: providerRequiredMessage("Domain top pages"),
  };
}

export function listDomainSnapshots(siteId: string) {
  const snapshots = all<any>(
    "SELECT * FROM domain_snapshots WHERE site_id = ? ORDER BY created_at DESC",
    [siteId],
  ).map(publicDomainSnapshotRow);
  return [...listOrganicImports(siteId), ...snapshots].sort(
    (a, b) => new Date(b.created_at || b.createdAt || 0).getTime() - new Date(a.created_at || a.createdAt || 0).getTime(),
  );
}

export async function backlinksOverview(input: { siteId: string; domain?: string }) {
  const site = getSite(input.siteId);
  if (!site) throw new Error("Site not found.");
  const domain = normalizeDomain(input.domain || site.domain);
  if (!domain) throw new Error("Domain is required.");
  const imported = latestBacklinkImport(site.id, domain);
  if (imported) {
    return {
      source: "backlink-import",
      domain,
      ...imported.summary,
      importId: imported.id,
      sourceName: imported.sourceName,
      createdAt: imported.createdAt,
    };
  }
  return emptyProviderResult("Backlink index data", {
    domain,
    backlinks: null,
    referringDomains: null,
    dofollowRatio: null,
    topAnchors: [],
    prospects: [],
  });
}

export async function getBacklinksProfile(input: {
  siteId: string;
  domain?: string;
  scope?: "domain" | "page";
  tab?: "backlinks" | "domains" | "pages";
  page?: number;
  pageSize?: number;
  sortField?: string;
  sortOrder?: string;
  mode?: string;
}) {
  const site = getSite(input.siteId);
  if (!site) throw new Error("Site not found.");
  const domain = normalizeDomain(input.domain || site.domain);
  if (!domain) throw new Error("Domain is required.");
  const tab = input.tab || "backlinks";
  const page = Math.max(1, Number(input.page || 1));
  const pageSize = Math.max(10, Math.min(200, Number(input.pageSize || 50)));
  let source = "provider-not-configured";
  let result: any = {
    rows: [],
    totalCount: 0,
    hasMore: false,
    page,
    pageSize,
    fetchedAt: nowIso(),
    warning: providerRequiredMessage("Backlink index data"),
  };

  const imported = latestBacklinkImport(site.id, domain);
  if (imported) {
    const importedRows = imported.rows as ImportedBacklinkRow[];
    const rows: any[] =
      tab === "domains"
        ? backlinkDomainRows(importedRows)
        : tab === "pages"
          ? backlinkPageRows(importedRows)
          : [...importedRows].sort((a, b) => Number(b.rank || 0) - Number(a.rank || 0));
    const pageRows = paginateRows(rows, page, pageSize);
    source = "backlink-import";
    result = {
      ...pageRows,
      page,
      pageSize,
      fetchedAt: nowIso(),
      importId: imported.id,
      sourceName: imported.sourceName,
    };
  }

  return { source, domain, tab, ...result };
}

export function listBacklinkSnapshots(siteId: string) {
  const snapshots = all<any>(
    "SELECT * FROM backlink_snapshots WHERE site_id = ? ORDER BY created_at DESC",
    [siteId],
  ).map(publicDomainSnapshotRow);
  return [...listBacklinkImports(siteId), ...snapshots].sort(
    (a, b) => new Date(b.created_at || b.createdAt || 0).getTime() - new Date(a.created_at || a.createdAt || 0).getTime(),
  );
}

type ImportedBacklinkRow = {
  domainFrom: string;
  urlFrom: string;
  urlTo: string;
  anchor: string;
  itemType: string;
  isDofollow: boolean | null;
  relAttributes: string[];
  rank: number | null;
  domainFromRank: number | null;
  pageFromRank: number | null;
  spamScore: number | null;
  firstSeen: string | null;
  lastSeen: string | null;
  isLost: boolean;
  isBroken: boolean;
  linksCount: number | null;
};

function normalizeCsvHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizedCsvRow(row: Record<string, unknown>) {
  const normalized = new Map<string, unknown>();
  for (const [key, value] of Object.entries(row)) {
    normalized.set(normalizeCsvHeader(key), value);
  }
  return normalized;
}

function csvField(row: Map<string, unknown>, aliases: string[]) {
  for (const alias of aliases) {
    const value = row.get(normalizeCsvHeader(alias));
    const text = cleanText(String(value ?? ""));
    if (text) return text;
  }
  return "";
}

function csvNumber(row: Map<string, unknown>, aliases: string[]) {
  const value = csvField(row, aliases);
  if (!value) return null;
  const match = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

function csvBoolean(row: Map<string, unknown>, aliases: string[]) {
  const value = csvField(row, aliases).toLowerCase();
  if (!value) return null;
  if (/(nofollow|false|no|lost|removed|0)\b/.test(value)) return false;
  if (/(dofollow|follow|true|yes|live|active|1)\b/.test(value)) return true;
  return null;
}

function backlinkDomainFromRow(row: Map<string, unknown>, urlFrom: string) {
  const domain = csvField(row, [
    "domain_from",
    "domain from",
    "source_domain",
    "source domain",
    "referring_domain",
    "referring domain",
    "linking_domain",
    "linking domain",
  ]);
  return normalizeDomain(domain || urlFrom);
}

function normalizeImportedBacklinkRow(raw: Record<string, unknown>, fallbackDomain: string): ImportedBacklinkRow | null {
  const row = normalizedCsvRow(raw);
  const urlFrom =
    csvField(row, [
      "url_from",
      "url from",
      "source_url",
      "source url",
      "source page",
      "referring page",
      "referring url",
      "backlink url",
      "from",
    ]) || "";
  const domainFrom = backlinkDomainFromRow(row, urlFrom);
  if (!urlFrom && !domainFrom) return null;
  const urlTo =
    csvField(row, [
      "url_to",
      "url to",
      "target_url",
      "target url",
      "target",
      "destination_url",
      "destination url",
      "linked_url",
      "linked url",
      "landing page",
      "to",
    ]) || `https://${fallbackDomain}`;
  const relAttributes = parseList(csvField(row, ["rel", "rel attributes", "attributes", "link rel"]));
  const relText = relAttributes.join(" ").toLowerCase();
  const isDofollow = relText.includes("nofollow") ? false : csvBoolean(row, ["dofollow", "follow", "type", "link type"]);
  const status = csvField(row, ["status", "link status", "http status"]).toLowerCase();
  const statusCode = csvNumber(row, ["status", "link status", "http status"]);
  return {
    domainFrom,
    urlFrom: urlFrom || `https://${domainFrom}`,
    urlTo,
    anchor: csvField(row, ["anchor", "anchor text", "text", "link text"]),
    itemType: csvField(row, ["item type", "item_type", "type", "link type"]) || "link",
    isDofollow,
    relAttributes,
    rank: csvNumber(row, ["rank", "domain rank", "domain rating", "dr", "authority", "page rank"]),
    domainFromRank: csvNumber(row, ["domain_from_rank", "domain from rank", "domain rank", "domain rating", "dr"]),
    pageFromRank: csvNumber(row, ["page_from_rank", "page from rank", "url rating", "ur", "page rank"]),
    spamScore: csvNumber(row, ["spam score", "spam_score", "toxicity", "toxic score"]),
    firstSeen: csvField(row, ["first seen", "first_seen", "first found", "date first seen"]) || null,
    lastSeen: csvField(row, ["last seen", "last_seen", "last found", "date last seen"]) || null,
    isLost: /(lost|removed|deleted|missing)/.test(status),
    isBroken: Boolean((statusCode && statusCode >= 400) || /(broken|error|404|5\d\d)/.test(status)),
    linksCount: csvNumber(row, ["links count", "links_count", "count"]) || 1,
  };
}

function parseBacklinkCsv(csv: string) {
  const parsed = Papa.parse<Record<string, unknown>>(csv, {
    header: true,
    skipEmptyLines: true,
  });
  if (parsed.errors.length) {
    const firstError = parsed.errors[0];
    throw new Error(`Backlink CSV could not be parsed: ${firstError.message}`);
  }
  return parsed.data.filter((row) => Object.values(row).some((value) => String(value ?? "").trim()));
}

function backlinkSummary(rows: ImportedBacklinkRow[]) {
  const referringDomains = new Set(rows.map((row) => row.domainFrom).filter(Boolean));
  const dofollowRows = rows.filter((row) => row.isDofollow === true).length;
  const anchorCounts = new Map<string, number>();
  for (const row of rows) {
    const anchor = row.anchor || "(empty anchor)";
    anchorCounts.set(anchor, (anchorCounts.get(anchor) || 0) + 1);
  }
  return {
    backlinks: rows.length,
    referringDomains: referringDomains.size,
    dofollowRatio: rows.length ? Math.round((dofollowRows / rows.length) * 100) : null,
    topAnchors: [...anchorCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([anchor, count]) => ({ anchor, count })),
    lostBacklinks: rows.filter((row) => row.isLost).length,
    brokenBacklinks: rows.filter((row) => row.isBroken).length,
    prospects: [],
  };
}

function mapBacklinkImport(row: any) {
  const rows = jsonParse<ImportedBacklinkRow[]>(row.rows_json, []);
  const summary = jsonParse<Record<string, unknown>>(row.summary_json, {});
  return {
    id: row.id,
    siteId: row.site_id,
    domain: row.domain,
    source: "backlink-import",
    sourceName: row.source_name,
    source_name: row.source_name,
    rowCount: row.row_count,
    row_count: row.row_count,
    summary,
    rows,
    createdAt: row.created_at,
    created_at: row.created_at,
  };
}

function latestBacklinkImport(siteId: string, domain: string) {
  const row = get<any>(
    "SELECT * FROM backlink_imports WHERE site_id = ? AND domain = ? ORDER BY created_at DESC LIMIT 1",
    [siteId, domain],
  );
  return row ? mapBacklinkImport(row) : null;
}

export function listBacklinkImports(siteId: string) {
  return all<any>(
    "SELECT * FROM backlink_imports WHERE site_id = ? ORDER BY created_at DESC",
    [siteId],
  ).map(mapBacklinkImport);
}

export function importBacklinksCsv(input: {
  siteId?: string;
  domain?: string;
  sourceName?: string;
  csv?: string;
  rows?: Record<string, unknown>[];
}) {
  const site = getSite(String(input.siteId || ""));
  if (!site) throw new Error("Site not found.");
  const domain = normalizeDomain(input.domain || site.domain);
  if (!domain) throw new Error("Domain is required.");
  const rawRows = input.csv ? parseBacklinkCsv(input.csv) : input.rows || [];
  const rows = rawRows
    .map((row) => normalizeImportedBacklinkRow(row, domain))
    .filter((row): row is ImportedBacklinkRow => Boolean(row))
    .filter((row) => !row.urlTo || sameSiteUrl(row.urlTo, `https://${domain}`));
  if (!rows.length) {
    throw new Error("Import file has no backlink rows for this domain.");
  }
  const summary = backlinkSummary(rows);
  const id = randomUUID();
  run(
    `
    INSERT INTO backlink_imports
      (id, site_id, domain, source_name, row_count, summary_json, rows_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      id,
      site.id,
      domain,
      String(input.sourceName || "Backlink CSV").slice(0, 160),
      rows.length,
      JSON.stringify(summary),
      JSON.stringify(rows),
    ],
  );
  return mapBacklinkImport(get<any>("SELECT * FROM backlink_imports WHERE id = ?", [id]));
}

function paginateRows<T>(rows: T[], page: number, pageSize: number) {
  const totalCount = rows.length;
  const start = (page - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    totalCount,
    hasMore: start + pageSize < totalCount,
  };
}

function backlinkDomainRows(rows: ImportedBacklinkRow[]) {
  const byDomain = new Map<string, any>();
  for (const row of rows) {
    if (!row.domainFrom) continue;
    const entry = byDomain.get(row.domainFrom) || {
      domain: row.domainFrom,
      backlinks: 0,
      referringPageSet: new Set<string>(),
      rank: null,
      spamScore: null,
      firstSeen: row.firstSeen,
      brokenBacklinks: 0,
      brokenPageSet: new Set<string>(),
    };
    entry.backlinks += 1;
    entry.referringPageSet.add(row.urlFrom);
    entry.rank = Math.max(Number(entry.rank || 0), Number(row.domainFromRank || row.rank || 0)) || null;
    entry.spamScore = Math.max(Number(entry.spamScore || 0), Number(row.spamScore || 0)) || null;
    if (row.isBroken) {
      entry.brokenBacklinks += 1;
      entry.brokenPageSet.add(row.urlTo);
    }
    byDomain.set(row.domainFrom, entry);
  }
  return [...byDomain.values()]
    .map((row) => ({
      domain: row.domain,
      backlinks: row.backlinks,
      referringPages: row.referringPageSet.size,
      rank: row.rank,
      spamScore: row.spamScore,
      firstSeen: row.firstSeen,
      brokenBacklinks: row.brokenBacklinks,
      brokenPages: row.brokenPageSet.size,
    }))
    .sort((a, b) => b.backlinks - a.backlinks);
}

function backlinkPageRows(rows: ImportedBacklinkRow[]) {
  const byPage = new Map<string, any>();
  for (const row of rows) {
    const page = row.urlTo || "/";
    const entry = byPage.get(page) || {
      page,
      backlinks: 0,
      domainSet: new Set<string>(),
      rank: null,
      brokenBacklinks: 0,
    };
    entry.backlinks += 1;
    if (row.domainFrom) entry.domainSet.add(row.domainFrom);
    entry.rank = Math.max(Number(entry.rank || 0), Number(row.rank || row.pageFromRank || 0)) || null;
    if (row.isBroken) entry.brokenBacklinks += 1;
    byPage.set(page, entry);
  }
  return [...byPage.values()]
    .map((row) => ({
      page: row.page,
      backlinks: row.backlinks,
      referringDomains: row.domainSet.size,
      rank: row.rank,
      brokenBacklinks: row.brokenBacklinks,
    }))
    .sort((a, b) => b.backlinks - a.backlinks);
}

function emptySerpResult(keyword: string, domain: string) {
  const normalizedDomain = normalizeDomain(domain);
  return {
    keyword,
    domain: normalizedDomain,
    domainPosition: null,
    rows: [],
    intentMix: null,
    opportunities: [
      "Compare headings from the top three pages before drafting content.",
      "Look for recurring entities and questions in SERP titles.",
      normalizedDomain
        ? "Improve internal links to the ranking URL when this domain is outside the top 5."
        : "Set a site domain to track ownership in ranking rows.",
    ],
  };
}

export async function getSerpAnalysis(input: {
  siteId: string;
  keyword: string;
  domain?: string;
  depth?: number;
}) {
  const site = getSite(input.siteId);
  if (!site) throw new Error("Site not found.");
  const keyword = input.keyword.trim();
  if (!keyword) throw new Error("Keyword is required.");
  const domain = normalizeDomain(input.domain || site.domain);
  const depth = Math.max(10, Math.min(100, input.depth || 20));
  let source = "duckduckgo";
  let result: any = emptySerpResult(keyword, domain);

  try {
    const rows = await searchWeb(keyword, depth);
    result = {
      ...result,
      rows: rows.map((row) => ({
        ...row,
        isDomain: domain ? hostMatchesDomain(row.domain, domain) : false,
      })),
    };
    result.domainPosition = result.rows.find((row: any) => row.isDomain)?.rank ?? null;
    source = rows[0]?.source || "duckduckgo";
  } catch (error) {
    source = "search-error";
    result.warning = error instanceof Error ? error.message : "Search failed";
  }

  const id = randomUUID();
  run(
    `
    INSERT INTO serp_runs
      (id, site_id, keyword, domain, location_code, language_code, source, result_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      id,
      site.id,
      keyword,
      domain,
      site.location_code,
      site.language_code,
      source,
      JSON.stringify(result),
    ],
  );
  return { id, source, ...result };
}

export function listSerpRuns(siteId: string) {
  return all<any>(
    "SELECT * FROM serp_runs WHERE site_id = ? ORDER BY created_at DESC",
    [siteId],
  ).map((row) => ({ ...row, result: publicSerpResult(jsonParse(row.result_json, {})) }));
}

function splitCompetitors(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.map(normalizeDomain).filter(Boolean);
  return String(value || "")
    .split(/\n|,/)
    .map(normalizeDomain)
    .filter(Boolean);
}

export async function brandLookup(input: {
  siteId: string;
  query: string;
  competitors?: string[] | string;
}) {
  const site = getSite(input.siteId);
  if (!site) throw new Error("Site not found.");
  const query = (input.query || site.domain || site.name).trim();
  if (!query) throw new Error("Brand or domain is required.");
  const competitors = splitCompetitors(input.competitors);
  let source = "web-search";
  const result: any = {
    query,
    resolvedEntity: normalizeDomain(query) || query,
    platforms: [],
    shareOfVoice: [],
    citations: [],
    recommendations: [
      "Use Search Console and crawl evidence before asking Codex for recommendations.",
      "Create citation-worthy comparison, definition, and proof pages.",
      "Keep entity names consistent in titles, headings, schema, and organization profiles.",
    ],
  };

  try {
    const labels = [query, ...competitors];
    const rowsByLabel = await Promise.all(
      labels.map(async (label) => ({
        label,
        isPrimary: label === query,
        rows: await searchWeb(`"${label}"`, 10),
      })),
    );
    result.citations = rowsByLabel[0]?.rows || [];
    result.shareOfVoice = rowsByLabel
      .map((item) => ({ label: item.label, value: item.rows.length, isPrimary: item.isPrimary }))
      .sort((a, b) => b.value - a.value);
    result.platforms = [
      {
        platform: "web_search",
        visibility: result.citations.length,
        mentions: result.citations.length,
        citations: result.citations,
      },
    ];
  } catch (error) {
    source = "search-error";
    result.warning = error instanceof Error ? error.message : "Brand lookup search failed";
  }

  const id = randomUUID();
  run(
    `
    INSERT INTO brand_lookup_runs
      (id, site_id, query, competitors, source, result_json)
    VALUES (?, ?, ?, ?, ?, ?)
    `,
    [id, site.id, query, JSON.stringify(competitors), source, JSON.stringify(result)],
  );
  return { id, source, ...publicBrandLookupResult(result) };
}

export function listBrandLookupRuns(siteId: string) {
  return all<any>(
    "SELECT * FROM brand_lookup_runs WHERE site_id = ? ORDER BY created_at DESC",
    [siteId],
  ).map((row) => ({
    ...row,
    competitors: jsonParse<string[]>(row.competitors, []),
    result: publicBrandLookupResult(jsonParse(row.result_json, {})),
  }));
}

export async function promptExplorer(input: {
  siteId: string;
  prompt: string;
  highlightBrand?: string;
  models?: string[];
}) {
  const site = getSite(input.siteId);
  if (!site) throw new Error("Site not found.");
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("Prompt is required.");
  const highlightBrand = input.highlightBrand?.trim() || site.domain || site.name;
  const models = ["local_codex"];
  const source = "codex";
  const result: any = {
    prompt,
    highlightBrand,
    fetchedAt: nowIso(),
    results: [],
  };

  const job = createAiJob({
    type: "prompt.explorer",
    prompt: [
      "Analyze this prompt for SEO and AI-answer visibility using only real evidence supplied in the prompt.",
      "Do not invent rankings, citations, traffic, or model mentions.",
      `Prompt: ${prompt}`,
      `Brand/domain to watch: ${highlightBrand}`,
      `Site domain: ${site.domain || "not set"}`,
    ].join("\n"),
  });
  result.jobId = job.id;
  result.results = [
    {
      model: "local_codex",
      status: job.status,
      brandMentioned: null,
      text: "Queued a local Codex analysis job. Open AI lab to read the result when it completes.",
      citations: [],
      fanOutQueries: [
        `${prompt} ${highlightBrand}`,
        `best sources for ${prompt}`,
        `${highlightBrand} reviews`,
      ],
    },
  ];

  const id = randomUUID();
  run(
    `
    INSERT INTO prompt_explorer_runs
      (id, site_id, prompt, highlight_brand, models, source, result_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [id, site.id, prompt, highlightBrand, JSON.stringify(models), source, JSON.stringify(result)],
  );
  return { id, source, ...result };
}

export function listPromptExplorerRuns(siteId: string) {
  return all<any>(
    "SELECT * FROM prompt_explorer_runs WHERE site_id = ? ORDER BY created_at DESC",
    [siteId],
  ).map((row) => ({
    ...row,
    models: jsonParse<string[]>(row.models, []),
    result: jsonParse(row.result_json, {}),
  }));
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function exportSavedKeywordsCsv(siteId: string) {
  const rows = listSavedKeywords(siteId);
  const header = ["keyword", "search_volume", "difficulty", "cpc", "intent", "tags", "source", "created_at"];
  return [
    header.join(","),
    ...rows.map((row) =>
      [
        row.keyword,
        row.search_volume ?? "",
        row.difficulty ?? "",
        row.cpc ?? "",
        row.intent,
        Array.isArray(row.tags) ? row.tags.join("|") : "",
        row.source,
        row.created_at,
      ]
        .map(csvCell)
        .join(","),
    ),
  ].join("\n");
}

export function dashboardSummary(siteId?: string) {
  const sites = listSites();
  const site = siteId ? getSite(siteId) || sites[0] : sites[0];
  if (!site) {
    return {
      activeSite: null,
      sites: [],
      savedKeywordCount: 0,
      trackerCount: 0,
      scanCount: 0,
      serpRunCount: 0,
      brandLookupCount: 0,
      promptExplorerCount: 0,
      gscImportCount: 0,
      latestGscImport: null,
      latestScans: [],
      allScans: [],
      latestAiJobs: all<any>("SELECT * FROM ai_jobs ORDER BY created_at DESC"),
    };
  }
  const latestGscImport = get<any>(
    "SELECT * FROM gsc_imports WHERE site_id = ? ORDER BY created_at DESC LIMIT 1",
    [site.id],
  );
  return {
    activeSite: site,
    sites: sites,
    savedKeywordCount: get<{ count: number }>(
      "SELECT count(*) AS count FROM saved_keywords WHERE site_id = ?",
      [site.id],
    )?.count || 0,
    trackerCount:
      get<{ count: number }>("SELECT count(*) AS count FROM rank_trackers WHERE site_id = ?", [
        site.id,
      ])?.count || 0,
    scanCount:
      get<{ count: number }>("SELECT count(*) AS count FROM scans WHERE site_id = ?", [
        site.id,
      ])?.count || 0,
    serpRunCount:
      get<{ count: number }>("SELECT count(*) AS count FROM serp_runs WHERE site_id = ?", [
        site.id,
      ])?.count || 0,
    brandLookupCount:
      get<{ count: number }>(
        "SELECT count(*) AS count FROM brand_lookup_runs WHERE site_id = ?",
        [site.id],
      )?.count || 0,
    promptExplorerCount:
      get<{ count: number }>(
        "SELECT count(*) AS count FROM prompt_explorer_runs WHERE site_id = ?",
        [site.id],
      )?.count || 0,
    gscImportCount:
      get<{ count: number }>("SELECT count(*) AS count FROM gsc_imports WHERE site_id = ?", [
        site.id,
      ])?.count || 0,
    latestGscImport: latestGscImport
      ? {
          id: latestGscImport.id,
          siteUrl: latestGscImport.site_url,
          sourceName: latestGscImport.source_name,
          rowCount: latestGscImport.row_count,
          totals: jsonParse(latestGscImport.totals_json, {}),
          createdAt: latestGscImport.created_at,
        }
      : null,
    latestScans: listScans(site.id),
    allScans: listAllScans(),
    latestAiJobs: all<any>("SELECT * FROM ai_jobs ORDER BY created_at DESC"),
  };
}

export function siteSummary(siteId: string) {
  const site = getSite(siteId);
  if (!site) throw new Error("Site not found.");
  return {
    site: site,
    savedKeywords: listSavedKeywords(siteId),
    keywordMetricImports: listKeywordMetricImports(siteId),
    rankTrackers: listRankTrackers(siteId),
    scans: listScans(siteId),
    domainSnapshots: listDomainSnapshots(siteId),
    backlinkSnapshots: listBacklinkSnapshots(siteId),
    serpRuns: listSerpRuns(siteId),
    brandLookupRuns: listBrandLookupRuns(siteId),
    promptExplorerRuns: listPromptExplorerRuns(siteId),
  };
}

export function domainFromUrl(value: string) {
  const parsed = parseDomain(value);
  return parsed.domain || normalizeDomain(value);
}
