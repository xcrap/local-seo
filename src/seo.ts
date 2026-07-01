import * as cheerio from "cheerio";
import Papa from "papaparse";
import { XMLParser } from "fast-xml-parser";
import { createHash, randomUUID } from "node:crypto";
import { parse as parseDomain } from "tldts";
import { createAiJob } from "./codex";
import { all, get, jsonParse, nowIso, run } from "./db";
import { getConfigValue } from "./config";
import { DEFAULT_KEYWORD_LANGUAGE_CODE, DEFAULT_KEYWORD_LOCATION_CODE } from "./defaults";

export type Site = {
  id: string;
  name: string;
  domain: string;
  notes: string;
  location_code: number;
  language_code: string;
  crawl_protocol: CrawlProtocol;
  crawl_host: CrawlHost;
  created_at: string;
  updated_at: string;
};

export type CrawlProtocol = "auto" | "https" | "http" | "both";
export type CrawlHost = "auto" | "root" | "www" | "both";

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

function normalizeCrawlProtocol(value: unknown): CrawlProtocol {
  return value === "https" || value === "http" || value === "both" ? value : "auto";
}

function normalizeCrawlHost(value: unknown): CrawlHost {
  return value === "root" || value === "www" || value === "both" ? value : "auto";
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

async function fetchText(url: string, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "LocalSEO/0.1 (+https://localhost)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    return {
      ok: response.ok,
      status: response.status,
      url: response.url,
      redirected: response.redirected,
      contentType: response.headers.get("content-type") || "",
      contentLength: Number(response.headers.get("content-length") || 0) || null,
      contentEncoding: response.headers.get("content-encoding") || "",
      xRobotsTag: response.headers.get("x-robots-tag") || "",
      text: await response.text(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url: string, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "LocalSEO/0.1 (+https://localhost)",
        Accept: "application/json,text/plain,*/*",
      },
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      url: response.url,
      data: text ? JSON.parse(text) : null,
    };
  } finally {
    clearTimeout(timeout);
  }
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
  crawl_protocol?: CrawlProtocol | string;
  crawl_host?: CrawlHost | string;
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
  run(
    `
    INSERT INTO sites (id, name, domain, notes, location_code, language_code, crawl_protocol, crawl_host)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
  };
  run(
    `
    UPDATE sites
    SET name = ?, domain = ?, notes = ?, location_code = ?, language_code = ?, crawl_protocol = ?, crawl_host = ?, updated_at = CURRENT_TIMESTAMP
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
    const nextTags =
      input.tagMode === "append"
        ? Array.from(new Set([...existingTags, ...tagNames]))
        : tagNames;
    run(
      `
      INSERT INTO saved_keywords
        (id, site_id, keyword, location_code, language_code, search_volume, difficulty, cpc, intent, tags, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(site_id, keyword, location_code, language_code) DO UPDATE SET
        search_volume = excluded.search_volume,
        difficulty = excluded.difficulty,
        cpc = excluded.cpc,
        intent = excluded.intent,
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
  const rows = await searchWeb(keyword, Math.max(10, tracker.serp_depth)).catch(() => []);
  const match = rows.find((row) => target && row.domain.includes(target));
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

function publicScanRow(row: any) {
  if (!row) return null;
  const { site_id: siteId, site_name: siteName, site_domain: siteDomain, result_json, ...rest } = row;
  return {
    ...rest,
    site_id: siteId,
    ...(siteName ? { site_name: siteName } : {}),
    ...(siteDomain ? { site_domain: siteDomain } : {}),
    result: jsonParse(result_json, null),
  };
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

export function startScan(siteId: string, url: string) {
  const site = getSite(siteId);
  if (!site) throw new Error("Site not found.");
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
        isDomain: domain ? row.domain.includes(domain) : false,
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
  let result: any = {
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
  let source = "codex";
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

function isHttpOnHttpsPage(value: string, pageUrl: string) {
  try {
    return new URL(pageUrl).protocol === "https:" && new URL(value).protocol === "http:";
  } catch {
    return false;
  }
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

async function checkResource(url: string, method: "HEAD" | "GET" = "HEAD") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    let response = await fetch(url, {
      method,
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "LocalSEO/0.1 (+https://localhost)",
        Accept: "*/*",
        ...(method === "GET" ? { Range: "bytes=0-2048" } : {}),
      },
    });
    if (method === "HEAD" && [403, 405, 501].includes(response.status)) {
      response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent": "LocalSEO/0.1 (+https://localhost)",
          Accept: "*/*",
          Range: "bytes=0-2048",
        },
      });
    }
    return {
      ok: response.status < 400,
      status: response.status,
      finalUrl: response.url,
      redirected: response.redirected,
      contentType: response.headers.get("content-type") || "",
      contentLength: Number(response.headers.get("content-length") || 0) || null,
      contentEncoding: response.headers.get("content-encoding") || "",
      error: "",
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      finalUrl: url,
      contentType: "",
      contentLength: null,
      error: error instanceof Error ? error.message : "Request failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseRobots(text: string) {
  const sitemaps: string[] = [];
  let disallowCount = 0;
  let blocksAll = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "sitemap" && value) sitemaps.push(value);
    if (key === "disallow") {
      disallowCount += 1;
      if (value === "/") blocksAll = true;
    }
  }
  return { sitemaps: [...new Set(sitemaps)], disallowCount, blocksAll };
}

async function readRobots(origin: string) {
  const url = `${origin}/robots.txt`;
  try {
    const response = await fetchText(url);
    if (!response.ok) {
      return { exists: false, url, status: response.status, sitemaps: [], disallowCount: 0, blocksAll: false };
    }
    return { exists: true, url, status: response.status, ...parseRobots(response.text) };
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
        sitemaps.push({ url: sitemapUrl, status: response.status, ok: false, urlCount: 0 });
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
        status: response.status,
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
    brokenLinks: checkedLinks.filter((link) => !link.ok).length,
    checkedImages: checkedImages.length,
    brokenImages: checkedImages.filter((image) => !image.ok).length,
    redirectedImages: checkedImages.filter((image) => image.redirected || (image.finalUrl && image.finalUrl !== image.url)).length,
    cssImageResources: checkedImages.filter((image) => image.purpose === "css-url" || image.purpose === "external-css-url").length,
    pictureSourceImages: checkedImages.filter((image) => image.purpose === "picture-source" || image.purpose === "source-srcset").length,
    largeImages: issues.filter((issue) => issue.type === "large-image").length,
    imageExtensionMismatches: issues.filter((issue) => issue.type === "image-extension-mismatch").length,
    checkedAssets: checkedAssets.length,
    brokenAssets: checkedAssets.filter((asset) => !asset.ok).length,
    largeAssets: issues.filter((issue) => issue.type === "large-css" || issue.type === "large-javascript").length,
    renderBlockingScripts: issues.filter((issue) => issue.type === "render-blocking-javascript").length,
    redirectedLinks: checkedLinks.filter((link) => link.redirected || (link.finalUrl && link.finalUrl !== link.url)).length,
    linkTags: linkInventory.length,
    internalLinks: linkInventory.filter((link) => link.type === "internal").length,
    externalLinks: linkInventory.filter((link) => link.type === "external").length,
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
  robots: any;
  sitemap: any;
  limits: typeof scanLimits;
}) {
  const sortedIssues = [...input.issues].sort((a, b) => issuePriority(b.severity) - issuePriority(a.severity));
  return {
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
  const startKey = normalizedUrlKey(startUrl);
  const visited = new Set<string>();
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
      robots,
      sitemap,
      limits: scanLimits,
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
  sitemap = await readSitemaps(origin, robots.sitemaps || []);
  const sitemapUrlSet = new Set((sitemap.urls || []).map((url: string) => normalizedUrlKey(url)));
  for (const sitemapUrl of sitemap.urls || []) {
    const absolute = absoluteHttpUrl(String(sitemapUrl), origin);
    const absoluteKey = absolute ? normalizedUrlKey(absolute) : "";
    if (
      absolute &&
      sameSiteUrl(absolute, startUrl) &&
      absoluteKey !== startKey &&
      !queued.has(absoluteKey) &&
      queue.length + visited.size < scanLimits.maxQueuedUrls
    ) {
      queued.add(absoluteKey);
      queue.push(absolute);
      depthByUrl.set(absoluteKey, 0);
      discoveryByUrl.set(absoluteKey, "sitemap");
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
  if ((sitemap.urls || []).length > scanLimits.maxQueuedUrls) {
    pushScanIssue(issues, undefined, {
      url: `${origin}/sitemap.xml`,
      severity: "low",
      category: "sitemap",
      type: "sitemap-larger-than-crawl-limit",
      message: `Sitemap has more URLs than this local scan will crawl (${(sitemap.urls || []).length})`,
      recommendation: "Raise the local crawl limit for a full-site run, or scan important sections separately.",
      evidence: { sitemapUrls: (sitemap.urls || []).length, crawlLimit: scanLimits.maxQueuedUrls },
    });
  }
  persistProgress();

  phase = "crawling";
  while (queue.length > 0 && visited.size < scanLimits.maxPages) {
    const current = queue.shift()!;
    const currentKey = normalizedUrlKey(current);
    queued.delete(currentKey);
    if (visited.has(currentKey)) continue;
    visited.add(currentKey);
    const pageIssues = pageBucket(current);
    const currentDepth = depthByUrl.get(currentKey) ?? 0;

    try {
      const startedAt = Date.now();
      const response = await fetchText(current);
      const loadMs = Date.now() - startedAt;
      const isHtml = /text\/html|application\/xhtml\+xml/i.test(response.contentType) || response.text.includes("<html");
      const $ = cheerio.load(response.text);
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
      const canonical = canonicalRaw ? absoluteHttpUrl(canonicalRaw, response.url || current) || canonicalRaw : "";
      const canonicalCount = $('link[rel="canonical"]').length;
      const robotsMeta = cleanText($('meta[name="robots"]').attr("content") || "");
      const xRobotsTag = cleanText(response.xRobotsTag || "");
      const robotDirectives = `${robotsMeta},${xRobotsTag}`
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
      const indexable = !robotDirectives.some((item) => item === "noindex" || item === "none") && response.status < 400;
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
      const ogImage = ogImageRaw ? absoluteHttpUrl(ogImageRaw, response.url || current) || ogImageRaw : "";
      if (/^https?:\/\//i.test(ogImage) && imagesToCheck.size < scanLimits.maxImagesToCheck && !imagesToCheck.has(ogImage)) {
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
        if (assetsToCheck.size >= scanLimits.maxAssetsToCheck || assetsToCheck.has(url)) return;
        assetsToCheck.set(url, { url, from: current, type, ...meta });
      };

      const addImageToCheck = (url: string, meta: Record<string, unknown> = {}) => {
        if (imagesToCheck.size >= scanLimits.maxImagesToCheck || imagesToCheck.has(url)) return;
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
        const imgSrcsetUrls = parseSrcsetUrls(imgSrcsetRaw, response.url || current);
        const pictureSrcsetUrls = pictureSourceSrcsets.flatMap((srcset) => parseSrcsetUrls(srcset, response.url || current));
        const srcsetUrls = [...imgSrcsetUrls, ...pictureSrcsetUrls];
        const invalidSrcsetCandidates =
          srcsetCandidateCount(imgSrcsetRaw) +
          pictureSourceSrcsets.reduce((count, srcset) => count + srcsetCandidateCount(srcset), 0) -
          srcsetUrls.length;
        const absolute = absoluteHttpUrl(src, response.url || current) || srcsetUrls[0] || null;
        const alt = $(img).attr("alt");
        const altText = cleanText(alt || "");
        const role = cleanText($(img).attr("role") || "");
        const ariaHidden = cleanText($(img).attr("aria-hidden") || "");
        const width = $(img).attr("width") || "";
        const height = $(img).attr("height") || "";
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
          issues: [] as string[],
        };
        if (!src && pictureSrcsetUrls.length) row.issues.push("missing fallback src");
        if (!row.src) row.issues.push("missing src");
        if (row.invalidSrcsetCandidates > 0) row.issues.push("invalid srcset");
        if (row.classification === "content" && row.altState === "missing") row.issues.push("missing alt");
        if (row.classification === "content" && row.altState === "empty") row.issues.push("empty alt");
        if (row.classification === "content" && altText.length > 125) row.issues.push("alt too long");
        if (row.classification === "content" && isGenericAltText(altText, row.src || "")) row.issues.push("generic alt");
        if (row.src && (!row.width || !row.height)) row.issues.push("missing size");
        if (row.classification === "content" && imageIndex > 1 && String(row.loading).toLowerCase() !== "lazy") row.issues.push("not lazy loaded");
        if (row.classification === "content" && Number.parseInt(row.width || "0", 10) >= 600 && row.srcsetCount === 0) row.issues.push("missing srcset");
        if (row.src && isHttpOnHttpsPage(row.src, current)) row.issues.push("mixed content");
        imageRows.push(row);
        if (imageInventory.length < scanLimits.maxImageInventory) imageInventory.push(row);
        for (const imageUrl of [absolute, ...srcsetUrls].filter(Boolean) as string[]) {
          addImageToCheck(imageUrl, { purpose: pictureSrcsetUrls.includes(imageUrl) ? "picture-source" : "img" });
        }
      });

      $("source[srcset]").each((_, source) => {
        const urls = parseSrcsetUrls($(source).attr("srcset") || "", response.url || current);
        for (const imageUrl of urls) addImageToCheck(imageUrl, { purpose: "source-srcset" });
      });

      $("[style]").each((_, item) => {
        for (const imageUrl of cssUrlValues($(item).attr("style") || "", response.url || current)) {
          addImageToCheck(imageUrl, { purpose: "css-url" });
        }
      });
      $("style").each((_, item) => {
        for (const imageUrl of cssUrlValues($(item).contents().text() || "", response.url || current)) {
          addImageToCheck(imageUrl, { purpose: "css-url" });
        }
      });

      $("a[href]").each((_, link) => {
        const href = $(link).attr("href") || "";
        const absolute = absoluteHttpUrl(href, response.url || current);
        if (!absolute) return;
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
        if (linkInventory.length < scanLimits.maxLinkInventory) linkInventory.push(row);
        if (linksToCheck.size < scanLimits.maxLinksToCheck && !linksToCheck.has(absolute)) {
          linksToCheck.set(absolute, { url: absolute, from: current, type: row.type, anchor: row.anchor, rel: row.rel });
        }
        const absoluteKey = normalizedUrlKey(absolute);
        if (isInternal) {
          internalInlinks.set(absoluteKey, (internalInlinks.get(absoluteKey) || 0) + 1);
          const nextDepth = currentDepth + 1;
          if (!depthByUrl.has(absoluteKey) || nextDepth < Number(depthByUrl.get(absoluteKey))) {
            depthByUrl.set(absoluteKey, nextDepth);
          }
          if (!discoveryByUrl.has(absoluteKey)) discoveryByUrl.set(absoluteKey, "internal-link");
        }
        if (
          isInternal &&
          !visited.has(absoluteKey) &&
          !queued.has(absoluteKey) &&
          queue.length + visited.size < scanLimits.maxQueuedUrls
        ) {
          queued.add(absoluteKey);
          queue.push(absolute);
        }
      });

      $('link[rel~="stylesheet"][href]').each((_, item) => {
        const href = absoluteHttpUrl($(item).attr("href") || "", response.url || current);
        if (!href) return;
        assetRows.push({ type: "css", url: href });
        addAsset(href, "css", { placement: "head" });
      });
      $("script[src]").each((_, item) => {
        const src = absoluteHttpUrl($(item).attr("src") || "", response.url || current);
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

      if (response.status >= 400) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "high",
          category: "crawl",
          type: "page-http-error",
          message: `Page returns HTTP ${response.status}`,
          recommendation: "Fix the URL or redirect it to a live equivalent.",
          evidence: { status: response.status },
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
      if (response.url && response.url !== current) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "crawl",
          type: "redirected-url",
          message: "URL redirects before rendering",
          recommendation: "Link directly to the final URL to reduce crawl waste and latency.",
          evidence: { finalUrl: response.url },
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
      } else if (canonicalRaw && !absoluteHttpUrl(canonicalRaw, response.url || current)) {
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
      } else if (indexable && normalizedUrl(canonical) !== normalizedUrl(response.url || current)) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "canonicals",
          type: "canonical-not-self",
          message: "Indexable page canonicals to a different URL",
          recommendation: "Use a self-referencing canonical unless this page is intentionally consolidated into another URL.",
          evidence: { canonical, finalUrl: response.url || current },
        });
      }
      if (!indexable) {
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
      const imageMissingSrc = imageRows.filter((image) => !image.src).length;
      const missingFallbackSrc = imageRows.filter((image) => image.issues.includes("missing fallback src")).length;
      const invalidSrcset = imageRows.filter((image) => image.issues.includes("invalid srcset")).length;
      const missingAlt = imageRows.filter((image) => image.classification === "content" && image.altState === "missing").length;
      const emptyAlt = imageRows.filter((image) => image.classification === "content" && image.altState === "empty").length;
      const missingDimensions = imageRows.filter((image) => image.src && (!image.width || !image.height)).length;
      if (imageMissingSrc > 0) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "high",
          category: "images",
          type: "image-src-missing",
          message: `${imageMissingSrc} image tags have no source`,
          recommendation: "Remove empty image tags or point them to a valid image file.",
          evidence: { count: imageMissingSrc },
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
      if (missingDimensions > 0) {
        pushScanIssue(issues, pageIssues, {
          url: current,
          severity: "low",
          category: "images",
          type: "image-dimensions-missing",
          message: `${missingDimensions} images are missing width or height attributes`,
          recommendation: "Set image dimensions or CSS aspect ratios to reduce layout shift.",
          evidence: { count: missingDimensions },
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
          recommendation: "Add visible anchor text or accessible labels so users and crawlers understand the target.",
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
      const invalidHreflangs = hreflangs.filter((item) => !item.lang || !absoluteHttpUrl(item.href, response.url || current));
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
        finalUrl: response.url,
        status: response.status,
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
        lang,
        viewport,
        charset,
        metaRefresh,
        faviconCount,
        wordCount,
        depth: currentDepth,
        discovery: discoveryByUrl.get(currentKey) || "internal-link",
        internalInlinks: internalInlinks.get(currentKey) || 0,
        sitemapListed: sitemapUrlSet.has(currentKey) || sitemapUrlSet.has(normalizedUrlKey(response.url || current)),
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
        imagesMissingSrc: imageMissingSrc,
        imagesMissingFallbackSrc: missingFallbackSrc,
        imagesInvalidSrcset: invalidSrcset,
        imagesMissingDimensions: missingDimensions,
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
  }
  for (const page of pages) {
    const pageKey = normalizedUrlKey(page.url);
    const finalKey = normalizedUrlKey(page.finalUrl || page.url);
    page.internalInlinks = Math.max(
      Number(page.internalInlinks || 0),
      internalInlinks.get(pageKey) || 0,
      internalInlinks.get(finalKey) || 0,
    );
    page.depth = Math.min(
      Number.isFinite(Number(page.depth)) ? Number(page.depth) : 999,
      depthByUrl.get(pageKey) ?? 999,
      depthByUrl.get(finalKey) ?? 999,
    );
    if (page.depth === 999) page.depth = 0;
    page.discovery = discoveryByUrl.get(pageKey) || discoveryByUrl.get(finalKey) || page.discovery || "internal-link";
    page.sitemapListed = sitemapUrlSet.has(pageKey) || sitemapUrlSet.has(finalKey);
  }

  phase = "checking links";
  for (const candidate of [...linksToCheck.values()]) {
    const result = await checkResource(candidate.url);
    const row = { ...candidate, ...result };
    checkedLinks.push(row);
    if (!row.ok) {
      pushScanIssue(issues, pageBucket(candidate.from), {
        url: candidate.from,
        severity: candidate.type === "internal" ? "high" : "medium",
        category: "links",
        type: candidate.type === "internal" ? "broken-internal-link" : "broken-external-link",
        message: `${candidate.type === "internal" ? "Internal" : "External"} link is failing`,
        recommendation: "Update the link target, remove it, or redirect the target URL to a live page.",
        evidence: { target: candidate.url, status: row.status, error: row.error },
      });
    } else if (row.redirected || (row.finalUrl && row.finalUrl !== candidate.url)) {
      pushScanIssue(issues, pageBucket(candidate.from), {
        url: candidate.from,
        severity: candidate.type === "internal" ? "medium" : "low",
        category: "links",
        type: candidate.type === "internal" ? "internal-link-redirects" : "external-link-redirects",
        message: `${candidate.type === "internal" ? "Internal" : "External"} link redirects`,
        recommendation: "Link directly to the final destination when the redirect is permanent and intentional.",
        evidence: { target: candidate.url, finalUrl: row.finalUrl, status: row.status },
      });
    }
    if (checkedLinks.length % 25 === 0) persistProgress();
  }

  const checkedImageUrls = new Set<string>();
  async function checkQueuedImages() {
    for (const candidate of [...imagesToCheck.values()]) {
      if (checkedImageUrls.has(candidate.url)) continue;
      checkedImageUrls.add(candidate.url);
      const result = await checkResource(candidate.url);
      const row = { ...candidate, ...result };
      checkedImages.push(row);
      if (!row.ok) {
        pushScanIssue(issues, pageBucket(candidate.from), {
          url: candidate.from,
          severity: "high",
          category: "images",
          type: "broken-image",
          message: "Image URL is failing",
          recommendation: "Replace the image URL or restore the missing image asset.",
          evidence: { image: candidate.url, status: row.status, error: row.error, purpose: candidate.purpose },
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
    const result = await checkResource(candidate.url);
    const row = { ...candidate, ...result };
    checkedAssets.push(row);
    if (!row.ok) {
      pushScanIssue(issues, pageBucket(candidate.from), {
        url: candidate.from,
        severity: "high",
        category: "assets",
        type: candidate.type === "css" ? "broken-css" : "broken-javascript",
        message: `${candidate.type.toUpperCase()} asset is failing`,
        recommendation: "Restore the asset, fix the URL, or remove the reference.",
        evidence: { asset: candidate.url, status: row.status, error: row.error },
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
          if (imagesToCheck.size >= scanLimits.maxImagesToCheck || imagesToCheck.has(imageUrl)) continue;
          imagesToCheck.set(imageUrl, { url: imageUrl, from: candidate.from, purpose: "external-css-url", css: candidate.url });
        }
      }
    }
    if (checkedAssets.length % 25 === 0) persistProgress();
  }

  phase = "checking CSS images";
  await checkQueuedImages();

  phase = "deduplicating";
  for (const [title, rows] of groupDuplicateValues(pages, "title")) {
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
  for (const [description, rows] of groupDuplicateValues(pages, "description")) {
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
  for (const [h1, rows] of groupDuplicateValues(pages, "h1")) {
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
  for (const [, rows] of groupDuplicateValues(pages.filter((page) => page.wordCount >= 120), "contentFingerprint")) {
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
    for (const page of pages.filter((item) => !item.indexable)) {
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
      recommendation: "Check the scan URL, redirects, DNS, TLS, firewall rules, and whether the target returns crawlable HTML.",
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
  const high = issues.filter((issue) => issue.severity === "high").length;
  const medium = issues.filter((issue) => issue.severity === "medium").length;
  const low = issues.filter((issue) => issue.severity === "low").length;
  const score = pages.length === 0 ? 0 : Math.max(0, Math.min(100, 100 - high * 8 - medium * 3 - low));
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
    robots,
    sitemap,
    limits: scanLimits,
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
