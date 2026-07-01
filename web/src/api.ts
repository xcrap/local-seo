export type Site = {
  id: string;
  name: string;
  domain: string;
  notes: string;
  location_code: number;
  language_code: string;
  crawl_protocol: "auto" | "https" | "http" | "both";
  crawl_host: "auto" | "root" | "www" | "both";
};

export type KeywordResult = {
  keyword: string;
  searchVolume: number | null;
  difficulty: number | null;
  cpc: number | null;
  intent: string;
};

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.error || `${response.status} ${response.statusText}`);
  }
  return data as T;
}

export const auth = {
  me: () => request<{ authenticated: boolean; setupRequired: boolean; user?: { email: string } }>("/api/auth/me"),
  setup: (email: string, password: string) =>
    request("/api/auth/setup", { method: "POST", body: JSON.stringify({ email, password }) }),
  login: (email: string, password: string, remember: boolean) =>
    request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password, remember }) }),
  logout: () => request("/api/auth/logout", { method: "POST" }),
};

export const api = {
  dashboard: (siteId?: string) => request<any>(siteId ? `/api/dashboard?siteId=${encodeURIComponent(siteId)}` : "/api/dashboard"),
  config: () => request<any>("/api/config"),
  saveConfig: (body: Record<string, string>) =>
    request<any>("/api/config", { method: "PUT", body: JSON.stringify(body) }),
  sites: () => request<Site[]>("/api/sites"),
  site: (id: string) => request<any>(`/api/sites/${id}`),
  createSite: (body: Partial<Site>) =>
    request<Site>("/api/sites", { method: "POST", body: JSON.stringify(body) }),
  updateSite: (id: string, body: Partial<Site>) =>
    request<Site>(`/api/sites/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteSite: (id: string) =>
    request<any>(`/api/sites/${id}`, { method: "DELETE" }),
  scanSite: (id: string) =>
    request<any>(`/api/sites/${id}/scan`, { method: "POST" }),
  researchKeywords: (body: any) =>
    request<{ id: string; source: string; rows: KeywordResult[] }>("/api/keywords/research", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  saveKeywords: (body: any) =>
    request<any>("/api/keywords/save", { method: "POST", body: JSON.stringify(body) }),
  savedKeywords: (siteId: string) => request<any[]>(`/api/sites/${siteId}/keywords`),
  querySavedKeywords: (siteId: string, body: any) =>
    request<any>(`/api/sites/${siteId}/keywords/query`, { method: "POST", body: JSON.stringify(body) }),
  keywordTags: (siteId: string) => request<any[]>(`/api/sites/${siteId}/keyword-tags`),
  updateKeywordTags: (siteId: string, body: any) =>
    request<any>(`/api/sites/${siteId}/keywords/tags`, { method: "POST", body: JSON.stringify(body) }),
  updateKeywordTag: (siteId: string, tagId: string, body: any) =>
    request<any>(`/api/sites/${siteId}/keyword-tags/${tagId}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteKeywordTag: (siteId: string, tagId: string) =>
    request<any>(`/api/sites/${siteId}/keyword-tags/${tagId}`, { method: "DELETE" }),
  removeSavedKeywords: (siteId: string, savedKeywordIds: string[]) =>
    request<any>(`/api/sites/${siteId}/keywords/remove`, {
      method: "POST",
      body: JSON.stringify({ savedKeywordIds }),
    }),
  savedKeywordsCsvUrl: (siteId: string) => `/api/sites/${siteId}/keywords.csv`,
  keywordMetricImports: (siteId: string) => request<any[]>(`/api/sites/${siteId}/keyword-metric-imports`),
  importKeywordMetrics: (body: any) =>
    request<any>("/api/keywords/import-metrics", { method: "POST", body: JSON.stringify(body) }),
  serpRuns: (siteId: string) => request<any[]>(`/api/sites/${siteId}/serp`),
  analyzeSerp: (body: any) =>
    request<any>("/api/serp/analyze", { method: "POST", body: JSON.stringify(body) }),
  rankTrackers: (siteId: string) => request<any[]>(`/api/sites/${siteId}/rank-trackers`),
  createRankTracker: (body: any) =>
    request<any>("/api/rank-trackers", { method: "POST", body: JSON.stringify(body) }),
  addRankKeywords: (trackerId: string, keywords: string[]) =>
    request<any>(`/api/rank-trackers/${trackerId}/keywords`, {
      method: "POST",
      body: JSON.stringify({ keywords }),
    }),
  removeRankKeywords: (trackerId: string, keywordIds: string[]) =>
    request<any>(`/api/rank-trackers/${trackerId}/keywords/remove`, {
      method: "POST",
      body: JSON.stringify({ keywordIds }),
    }),
  syncRankMetrics: (trackerId: string) =>
    request<any>(`/api/rank-trackers/${trackerId}/sync-metrics`, { method: "POST" }),
  rankTrend: (trackerId: string) => request<any[]>(`/api/rank-trackers/${trackerId}/trend`),
  rankKeywordHistory: (trackerId: string, keywordId: string) =>
    request<any[]>(`/api/rank-trackers/${trackerId}/keywords/${keywordId}/history`),
  runRankCheck: (trackerId: string) =>
    request<any>(`/api/rank-trackers/${trackerId}/check`, { method: "POST" }),
  domainOverview: (body: any) =>
    request<any>("/api/domain/overview", { method: "POST", body: JSON.stringify(body) }),
  domainSnapshots: (siteId: string) => request<any[]>(`/api/sites/${siteId}/domain-snapshots`),
  domainKeywordSuggestions: (body: any) =>
    request<any>("/api/domain/keyword-suggestions", { method: "POST", body: JSON.stringify(body) }),
  domainKeywords: (body: any) =>
    request<any>("/api/domain/keywords", { method: "POST", body: JSON.stringify(body) }),
  domainPages: (body: any) =>
    request<any>("/api/domain/pages", { method: "POST", body: JSON.stringify(body) }),
  importOrganicResearch: (body: any) =>
    request<any>("/api/domain/import", { method: "POST", body: JSON.stringify(body) }),
  backlinksOverview: (body: any) =>
    request<any>("/api/backlinks/overview", { method: "POST", body: JSON.stringify(body) }),
  backlinkSnapshots: (siteId: string) => request<any[]>(`/api/sites/${siteId}/backlink-snapshots`),
  backlinksProfile: (body: any) =>
    request<any>("/api/backlinks/profile", { method: "POST", body: JSON.stringify(body) }),
  importBacklinks: (body: any) =>
    request<any>("/api/backlinks/import", { method: "POST", body: JSON.stringify(body) }),
  brandLookupRuns: (siteId: string) => request<any[]>(`/api/sites/${siteId}/brand-lookup`),
  brandLookup: (body: any) =>
    request<any>("/api/brand-lookup", { method: "POST", body: JSON.stringify(body) }),
  promptExplorerRuns: (siteId: string) => request<any[]>(`/api/sites/${siteId}/prompt-explorer`),
  promptExplorer: (body: any) =>
    request<any>("/api/prompt-explorer", { method: "POST", body: JSON.stringify(body) }),
  allScans: () => request<any[]>("/api/scans"),
  scans: (siteId: string) => request<any[]>(`/api/sites/${siteId}/scans`),
  scan: (id: string) => request<any>(`/api/scans/${id}`),
  startScan: (body: any) =>
    request<any>("/api/scans", { method: "POST", body: JSON.stringify(body) }),
  clearScans: (siteId: string) =>
    request<any>(`/api/sites/${siteId}/scans`, { method: "DELETE" }),
  deleteScan: (siteId: string, scanId: string) =>
    request<any>(`/api/sites/${siteId}/scans/${scanId}`, { method: "DELETE" }),
  aiPrompts: () => request<any[]>("/api/ai/prompts"),
  aiJobs: () => request<any[]>("/api/ai/jobs"),
  createAiJob: (body: any) =>
    request<any>("/api/ai/jobs", { method: "POST", body: JSON.stringify(body) }),
  gscStatus: (siteId: string) => request<any>(`/api/gsc/status/${siteId}`),
  gscImports: (siteId: string) => request<any[]>(`/api/gsc/imports/${siteId}`),
  gscStart: (siteId: string) =>
    request<{ url: string }>("/api/gsc/start", { method: "POST", body: JSON.stringify({ siteId }) }),
  gscSites: (siteId: string) => request<any[]>(`/api/gsc/sites/${siteId}`),
  gscSetSite: (siteId: string, siteUrl: string) =>
    request<any>("/api/gsc/site", { method: "POST", body: JSON.stringify({ siteId, siteUrl }) }),
  gscPerformance: (body: any) =>
    request<any>("/api/gsc/performance", { method: "POST", body: JSON.stringify(body) }),
  gscImport: (body: any) =>
    request<any>("/api/gsc/import", { method: "POST", body: JSON.stringify(body) }),
  gscInspect: (body: any) =>
    request<any>("/api/gsc/inspect", { method: "POST", body: JSON.stringify(body) }),
  gscDisconnect: (siteId: string) =>
    request<any>("/api/gsc/disconnect", { method: "POST", body: JSON.stringify({ siteId }) }),
  mcpTools: () => request<any>("/api/mcp/tools"),
};
