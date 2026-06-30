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

export type Project = Site;

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
  dashboard: (projectId?: string) => request<any>(projectId ? `/api/dashboard?projectId=${encodeURIComponent(projectId)}` : "/api/dashboard"),
  config: () => request<any>("/api/config"),
  saveConfig: (body: Record<string, string>) =>
    request<any>("/api/config", { method: "PUT", body: JSON.stringify(body) }),
  projects: () => request<Project[]>("/api/sites"),
  project: (id: string) => request<any>(`/api/sites/${id}`),
  createProject: (body: Partial<Project>) =>
    request<Project>("/api/sites", { method: "POST", body: JSON.stringify(body) }),
  updateProject: (id: string, body: Partial<Project>) =>
    request<Project>(`/api/sites/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteProject: (id: string) =>
    request<any>(`/api/sites/${id}`, { method: "DELETE" }),
  scanProject: (id: string) =>
    request<any>(`/api/sites/${id}/scan`, { method: "POST" }),
  researchKeywords: (body: any) =>
    request<{ id: string; source: string; rows: KeywordResult[] }>("/api/keywords/research", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  saveKeywords: (body: any) =>
    request<any>("/api/keywords/save", { method: "POST", body: JSON.stringify(body) }),
  savedKeywords: (projectId: string) => request<any[]>(`/api/projects/${projectId}/keywords`),
  querySavedKeywords: (projectId: string, body: any) =>
    request<any>(`/api/projects/${projectId}/keywords/query`, { method: "POST", body: JSON.stringify(body) }),
  keywordTags: (projectId: string) => request<any[]>(`/api/projects/${projectId}/keyword-tags`),
  updateKeywordTags: (projectId: string, body: any) =>
    request<any>(`/api/projects/${projectId}/keywords/tags`, { method: "POST", body: JSON.stringify(body) }),
  updateKeywordTag: (projectId: string, tagId: string, body: any) =>
    request<any>(`/api/projects/${projectId}/keyword-tags/${tagId}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteKeywordTag: (projectId: string, tagId: string) =>
    request<any>(`/api/projects/${projectId}/keyword-tags/${tagId}`, { method: "DELETE" }),
  removeSavedKeywords: (projectId: string, savedKeywordIds: string[]) =>
    request<any>(`/api/projects/${projectId}/keywords/remove`, {
      method: "POST",
      body: JSON.stringify({ savedKeywordIds }),
    }),
  savedKeywordsCsvUrl: (projectId: string) => `/api/projects/${projectId}/keywords.csv`,
  serpRuns: (projectId: string) => request<any[]>(`/api/projects/${projectId}/serp`),
  analyzeSerp: (body: any) =>
    request<any>("/api/serp/analyze", { method: "POST", body: JSON.stringify(body) }),
  rankTrackers: (projectId: string) => request<any[]>(`/api/projects/${projectId}/rank-trackers`),
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
  refreshRankMetrics: (trackerId: string) =>
    request<any>(`/api/rank-trackers/${trackerId}/refresh-metrics`, { method: "POST" }),
  rankTrend: (trackerId: string) => request<any[]>(`/api/rank-trackers/${trackerId}/trend`),
  rankKeywordHistory: (trackerId: string, keywordId: string) =>
    request<any[]>(`/api/rank-trackers/${trackerId}/keywords/${keywordId}/history`),
  runRankCheck: (trackerId: string) =>
    request<any>(`/api/rank-trackers/${trackerId}/check`, { method: "POST" }),
  domainOverview: (body: any) =>
    request<any>("/api/domain/overview", { method: "POST", body: JSON.stringify(body) }),
  domainSnapshots: (projectId: string) => request<any[]>(`/api/projects/${projectId}/domain-snapshots`),
  domainKeywordSuggestions: (body: any) =>
    request<any>("/api/domain/keyword-suggestions", { method: "POST", body: JSON.stringify(body) }),
  domainKeywords: (body: any) =>
    request<any>("/api/domain/keywords", { method: "POST", body: JSON.stringify(body) }),
  domainPages: (body: any) =>
    request<any>("/api/domain/pages", { method: "POST", body: JSON.stringify(body) }),
  backlinksOverview: (body: any) =>
    request<any>("/api/backlinks/overview", { method: "POST", body: JSON.stringify(body) }),
  backlinkSnapshots: (projectId: string) => request<any[]>(`/api/projects/${projectId}/backlink-snapshots`),
  backlinksProfile: (body: any) =>
    request<any>("/api/backlinks/profile", { method: "POST", body: JSON.stringify(body) }),
  brandLookupRuns: (projectId: string) => request<any[]>(`/api/projects/${projectId}/brand-lookup`),
  brandLookup: (body: any) =>
    request<any>("/api/brand-lookup", { method: "POST", body: JSON.stringify(body) }),
  promptExplorerRuns: (projectId: string) => request<any[]>(`/api/projects/${projectId}/prompt-explorer`),
  promptExplorer: (body: any) =>
    request<any>("/api/prompt-explorer", { method: "POST", body: JSON.stringify(body) }),
  audits: (projectId: string) => request<any[]>(`/api/sites/${projectId}/audits`),
  audit: (id: string) => request<any>(`/api/audits/${id}`),
  startAudit: (body: any) =>
    request<any>("/api/audits", { method: "POST", body: JSON.stringify(body) }),
  clearAudits: (projectId: string) =>
    request<any>(`/api/sites/${projectId}/audits`, { method: "DELETE" }),
  deleteAudit: (projectId: string, auditId: string) =>
    request<any>(`/api/sites/${projectId}/audits/${auditId}`, { method: "DELETE" }),
  aiPrompts: () => request<any[]>("/api/ai/prompts"),
  aiJobs: () => request<any[]>("/api/ai/jobs"),
  createAiJob: (body: any) =>
    request<any>("/api/ai/jobs", { method: "POST", body: JSON.stringify(body) }),
  gscStatus: (projectId: string) => request<any>(`/api/gsc/status/${projectId}`),
  gscImports: (projectId: string) => request<any[]>(`/api/gsc/imports/${projectId}`),
  gscStart: (projectId: string) =>
    request<{ url: string }>("/api/gsc/start", { method: "POST", body: JSON.stringify({ projectId }) }),
  gscSites: (projectId: string) => request<any[]>(`/api/gsc/sites/${projectId}`),
  gscSetSite: (projectId: string, siteUrl: string) =>
    request<any>("/api/gsc/site", { method: "POST", body: JSON.stringify({ projectId, siteUrl }) }),
  gscPerformance: (body: any) =>
    request<any>("/api/gsc/performance", { method: "POST", body: JSON.stringify(body) }),
  gscImport: (body: any) =>
    request<any>("/api/gsc/import", { method: "POST", body: JSON.stringify(body) }),
  gscInspect: (body: any) =>
    request<any>("/api/gsc/inspect", { method: "POST", body: JSON.stringify(body) }),
  gscDisconnect: (projectId: string) =>
    request<any>("/api/gsc/disconnect", { method: "POST", body: JSON.stringify({ projectId }) }),
  mcpTools: () => request<any>("/api/mcp/tools"),
};
