import type { Context } from "hono";
import { getConfigValue } from "./config";
import { createAiJob, getAiJob } from "./codex";
import {
  createSite,
  brandLookup,
  backlinksOverview,
  getBacklinksProfile,
  getDomainKeywordSuggestions,
  getDomainKeywordsPage,
  getDomainPagesPage,
  getSerpAnalysis,
  domainOverview,
  getAudit,
  getSite,
  listRankTrackers,
  listSites,
  listSavedKeywords,
  querySavedKeywords,
  promptExplorer,
  siteSummary,
  researchKeywords,
  saveKeywords,
  startAudit,
  updateSavedKeywordTags,
} from "./seo";
import { getGscPerformance, inspectGscUrls } from "./gsc";
import { resolveSavedSiteScanUrl, siteScanCandidates } from "./site-target";

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: any;
};

function publicMcpResult(result: any): any {
  if (Array.isArray(result)) return result.map(publicMcpResult);
  if (!result || typeof result !== "object") return result;
  const output: Record<string, any> = {};
  for (const [key, value] of Object.entries(result)) {
    let publicKey = key;
    if (key === "target" && typeof value === "string" && !("domain" in result)) publicKey = "domain";
    if (key === "targetPosition") publicKey = "domainPosition";
    if (key === "isTarget") publicKey = "isDomain";
    output[publicKey] = publicMcpResult(value);
  }
  return output;
}

const siteIdInput = {
  siteId: { type: "string", description: "Local site id." },
};

const tools = [
  {
    name: "whoami",
    description: "Return local MCP server information.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_sites",
    description: "List local SEO sites.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_site",
    description: "Create a local SEO site.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        domain: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "get_site_summary",
    description: "Get saved keywords, trackers, audits, and snapshots for a site.",
    inputSchema: {
      type: "object",
      properties: siteIdInput,
      required: ["siteId"],
    },
  },
  {
    name: "research_keywords",
    description: "Run local keyword research from real DuckDuckGo suggestions, with metrics only when a real metrics source is configured.",
    inputSchema: {
      type: "object",
      properties: {
        ...siteIdInput,
        query: { type: "string" },
        limit: { type: "number" },
      },
      required: ["siteId", "query"],
    },
  },
  {
    name: "analyze_serp",
    description: "Analyze one Google SERP for a keyword and check ownership for the active site or a comparison site.",
    inputSchema: {
      type: "object",
      properties: {
        ...siteIdInput,
        keyword: { type: "string" },
        domain: { type: "string", description: "Optional active-site or competitor domain to highlight in the ranking rows." },
        depth: { type: "number" },
      },
      required: ["siteId", "keyword"],
    },
  },
  {
    name: "list_saved_keywords",
    description: "List saved keywords for a site.",
    inputSchema: {
      type: "object",
      properties: siteIdInput,
      required: ["siteId"],
    },
  },
  {
    name: "query_saved_keywords",
    description: "Filter, sort, and paginate saved keywords for a site.",
    inputSchema: {
      type: "object",
      properties: {
        ...siteIdInput,
        search: { type: "string" },
        tagNames: { type: "array", items: { type: "string" } },
        page: { type: "number" },
        pageSize: { type: "number" },
      },
      required: ["siteId"],
    },
  },
  {
    name: "save_keywords",
    description: "Save keyword rows to a site.",
    inputSchema: {
      type: "object",
      properties: {
        ...siteIdInput,
        keywords: { type: "array" },
      },
      required: ["siteId", "keywords"],
    },
  },
  {
    name: "update_saved_keyword_tags",
    description: "Add or remove tags on saved keywords.",
    inputSchema: {
      type: "object",
      properties: {
        ...siteIdInput,
        savedKeywordIds: { type: "array", items: { type: "string" } },
        addTags: { type: "array", items: { type: "string" } },
        removeTagNames: { type: "array", items: { type: "string" } },
      },
      required: ["siteId", "savedKeywordIds"],
    },
  },
  {
    name: "get_domain_overview",
    description: "Get domain overview metrics and save a local snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        ...siteIdInput,
        domain: { type: "string" },
      },
      required: ["siteId", "domain"],
    },
  },
  {
    name: "get_domain_keyword_suggestions",
    description: "Get keyword suggestions from a domain's ranked keyword set.",
    inputSchema: {
      type: "object",
      properties: {
        ...siteIdInput,
        domain: { type: "string" },
        limit: { type: "number" },
      },
      required: ["siteId"],
    },
  },
  {
    name: "get_domain_keywords_page",
    description: "Get a paginated domain ranked-keywords table.",
    inputSchema: {
      type: "object",
      properties: {
        ...siteIdInput,
        domain: { type: "string" },
        page: { type: "number" },
        pageSize: { type: "number" },
        sortMode: { type: "string" },
        sortOrder: { type: "string" },
      },
      required: ["siteId"],
    },
  },
  {
    name: "get_domain_pages_page",
    description: "Get a paginated domain top-pages table.",
    inputSchema: {
      type: "object",
      properties: {
        ...siteIdInput,
        domain: { type: "string" },
        page: { type: "number" },
        pageSize: { type: "number" },
      },
      required: ["siteId"],
    },
  },
  {
    name: "get_backlinks_overview",
    description: "Get backlink overview metrics and save a local snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        ...siteIdInput,
        domain: { type: "string" },
      },
      required: ["siteId", "domain"],
    },
  },
  {
    name: "get_backlinks_profile",
    description: "Get backlink rows, referring domains, or top linked pages.",
    inputSchema: {
      type: "object",
      properties: {
        ...siteIdInput,
        domain: { type: "string" },
        tab: { type: "string", enum: ["backlinks", "domains", "pages"] },
        page: { type: "number" },
        pageSize: { type: "number" },
      },
      required: ["siteId", "domain"],
    },
  },
  {
    name: "get_rank_tracker",
    description: "Get rank tracking configs, keywords, latest snapshots, runs, and trend for a site or tracker.",
    inputSchema: {
      type: "object",
      properties: {
        ...siteIdInput,
        trackerId: { type: "string" },
      },
      required: ["siteId"],
    },
  },
  {
    name: "start_audit",
    description: "Start a local crawl audit for a site URL.",
    inputSchema: {
      type: "object",
      properties: {
        ...siteIdInput,
        url: { type: "string" },
      },
      required: ["siteId", "url"],
    },
  },
  {
    name: "scan_site",
    description: "Start a local crawl audit for a saved site using its saved scan plan unless a URL is supplied.",
    inputSchema: {
      type: "object",
      properties: {
        ...siteIdInput,
        url: { type: "string" },
      },
      required: ["siteId"],
    },
  },
  {
    name: "get_audit",
    description: "Read an audit by id.",
    inputSchema: {
      type: "object",
      properties: { auditId: { type: "string" } },
      required: ["auditId"],
    },
  },
  {
    name: "get_gsc_performance",
    description: "Read Search Console performance for a saved site from Google OAuth or the latest local CSV import.",
    inputSchema: {
      type: "object",
      properties: {
        ...siteIdInput,
        startDate: { type: "string" },
        endDate: { type: "string" },
        dimensions: { type: "array", items: { type: "string" } },
      },
      required: ["siteId", "startDate", "endDate"],
    },
  },
  {
    name: "inspect_urls",
    description: "Inspect URLs through Google Search Console URL Inspection API.",
    inputSchema: {
      type: "object",
      properties: {
        ...siteIdInput,
        urls: { type: "array", items: { type: "string" } },
        siteUrl: { type: "string" },
      },
      required: ["siteId", "urls"],
    },
  },
  {
    name: "brand_lookup",
    description: "Run AI visibility brand lookup with share of voice and citation recommendations.",
    inputSchema: {
      type: "object",
      properties: {
        ...siteIdInput,
        query: { type: "string" },
        competitors: { type: "array", items: { type: "string" } },
      },
      required: ["siteId", "query"],
    },
  },
  {
    name: "prompt_explorer",
    description: "Run one prompt across AI answer models and inspect brand mentions/citations.",
    inputSchema: {
      type: "object",
      properties: {
        ...siteIdInput,
        prompt: { type: "string" },
        highlightBrand: { type: "string" },
        models: { type: "array", items: { type: "string" } },
      },
      required: ["siteId", "prompt"],
    },
  },
  {
    name: "start_ai_job",
    description: "Start a local Codex medium job.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string" },
        prompt: { type: "string" },
      },
      required: ["type", "prompt"],
    },
  },
  {
    name: "get_ai_job",
    description: "Read a local Codex job.",
    inputSchema: {
      type: "object",
      properties: { jobId: { type: "string" } },
      required: ["jobId"],
    },
  },
];

export async function handleMcp(c: Context) {
  const token = getConfigValue("mcp_token");
  if (token) {
    const auth = c.req.header("authorization") || "";
    if (auth !== `Bearer ${token}`) {
      return c.json({ error: "Unauthorized" }, 401);
    }
  }

  const request = (await c.req.json().catch(() => ({}))) as JsonRpcRequest;
  const id = request.id ?? null;
  try {
    if (request.method === "initialize") {
      return c.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "local-seo", version: "0.1.0" },
          capabilities: { tools: {} },
        },
      });
    }
    if (request.method === "tools/list") {
      return c.json({ jsonrpc: "2.0", id, result: { tools } });
    }
    if (request.method === "tools/call") {
      const name = request.params?.name;
      const args = request.params?.arguments || {};
      const result = publicMcpResult(await callTool(name, args));
      return c.json({
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
            },
          ],
          structuredContent: typeof result === "object" ? result : undefined,
        },
      });
    }
    return c.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
  } catch (error) {
    return c.json({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : "Tool failed",
      },
    });
  }
}

async function callTool(name: string, args: any) {
  if ("projectId" in (args || {})) throw new Error("Use siteId.");
  if ("target" in (args || {})) throw new Error("Use domain.");
  const withDomainInput = (input: any) => {
    const domain = input?.domain;
    return domain ? { ...input, domain } : input;
  };
  switch (name) {
    case "whoami":
      return { server: "local-seo", mode: "local-sqlite", cloudflare: false };
    case "list_sites":
      return listSites();
    case "create_site":
      return createSite(args);
    case "get_site_summary":
      return siteSummary(args.siteId);
    case "research_keywords":
      return researchKeywords(args);
    case "analyze_serp":
      return getSerpAnalysis(withDomainInput(args));
    case "list_saved_keywords":
      return listSavedKeywords(args.siteId);
    case "query_saved_keywords":
      return querySavedKeywords(args);
    case "save_keywords":
      return saveKeywords(args);
    case "update_saved_keyword_tags":
      return updateSavedKeywordTags(args);
    case "get_domain_overview":
      return domainOverview(withDomainInput(args));
    case "get_domain_keyword_suggestions":
      return getDomainKeywordSuggestions(args);
    case "get_domain_keywords_page":
      return getDomainKeywordsPage(withDomainInput(args));
    case "get_domain_pages_page":
      return getDomainPagesPage(withDomainInput(args));
    case "get_backlinks_overview":
      return backlinksOverview(withDomainInput(args));
    case "get_backlinks_profile":
      return getBacklinksProfile(withDomainInput(args));
    case "get_rank_tracker": {
      const trackers = listRankTrackers(args.siteId);
      return args.trackerId ? trackers.find((tracker) => tracker.id === args.trackerId) || null : trackers;
    }
    case "start_audit":
      return startAudit(args.siteId, args.url);
    case "scan_site": {
      const siteId = args.siteId;
      const site = getSite(siteId);
      if (!site) throw new Error("Site not found.");
      const candidateUrls = args.url ? [String(args.url)] : site.domain ? siteScanCandidates(site) : [];
      const url = args.url || (site.domain ? await resolveSavedSiteScanUrl(site) : "");
      if (!url) throw new Error("Set a site domain or pass a URL.");
      const audit = startAudit(site.id, url);
      return {
        site: site.domain,
        audit,
        scanUrl: url,
        candidateUrls,
        scanPreferences: {
          protocol: site.crawl_protocol || "auto",
          host: site.crawl_host || "auto",
        },
        message: `Started site scan for ${site.domain || url}.`,
      };
    }
    case "get_audit":
      return getAudit(args.auditId);
    case "get_gsc_performance":
      return getGscPerformance(args);
    case "inspect_urls":
      return inspectGscUrls(args);
    case "brand_lookup":
      return brandLookup(args);
    case "prompt_explorer":
      return promptExplorer(args);
    case "start_ai_job":
      return createAiJob(args);
    case "get_ai_job":
      return getAiJob(args.jobId);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export function mcpToolList() {
  return tools;
}
