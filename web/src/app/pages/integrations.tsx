import { useEffect, useMemo, useState, type ChangeEvent, type SyntheticEvent } from "react";
import { BarChart3, Bot, ExternalLink, RefreshCw, Settings, Upload } from "lucide-react";
import { api, type Site } from "../../api";
import { Badge, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, toast } from "@/components/ui";
import { DatePicker, EmptyState, Field, InfoTip, JobTable, PageHeader, ReportSection, StatsBand, StatusDot, StatusEvidenceTable, cleanSiteDomain, crawlHostOptions, crawlProtocolOptions, crawlSpeedOptions, defaultCrawlHostFromConfig, defaultCrawlMaxPagesFromConfig, defaultCrawlProtocolFromConfig, defaultCrawlSpeedFromConfig, defaultKeywordLanguageCode, defaultKeywordLocationCode, defaultLanguageCodeFromConfig, defaultLocationCodeFromConfig, formatDate, formatDateInput, formatNumber, formatPercent, formatPosition, languageOptions, marketOptions, preferredScanUrl, serpProviderStatus } from "../shared";
import { cn } from "@/lib/utils";

export function GscPage({ site }: { site: Site }) {
  const defaultInspectionUrl = site.domain ? `${preferredScanUrl(site).replace(/\/$/, "")}/` : "";
  const defaultGscProperty = site.domain ? `sc-domain:${cleanSiteDomain(site.domain).replace(/^www\./i, "")}` : "";
  const [status, setStatus] = useState<any>(null);
  const [sites, setSites] = useState<any[]>([]);
  const [imports, setImports] = useState<any[]>([]);
  const [performance, setPerformance] = useState<any>(null);
  const [inspectUrls, setInspectUrls] = useState(defaultInspectionUrl);
  const [inspection, setInspection] = useState<any>(null);
  const [dimension, setDimension] = useState("query");
  const [importSiteUrl, setImportSiteUrl] = useState(defaultGscProperty);
  const [loading, setLoading] = useState("");
  const [gscTab, setGscTab] = useState("performance");
  const today = new Date();
  const defaultEndDate = formatDateInput(today);
  const defaultStartDate = formatDateInput(new Date(today.getTime() - 28 * 86400000));
  const [dateRange, setDateRange] = useState({ startDate: defaultStartDate, endDate: defaultEndDate });
  const latestImport = imports[0];
  const selectedGscProperty = status?.connection?.siteUrl || "";
  const connectionTone = status?.connected || imports.length ? "good" : status?.configured ? "warn" : "outline";
  const connectionLabel = status?.connected ? "Connected" : imports.length ? "Local imports" : status?.configured ? "Ready to connect" : "OAuth missing";

  async function load() {
    const [nextStatus, nextImports] = await Promise.all([
      api.gscStatus(site.id),
      api.gscImports(site.id),
    ]);
    setStatus(nextStatus);
    setImports(nextImports);
    if (nextImports[0]) {
      showImport(nextImports[0]);
    } else {
      setPerformance(null);
    }
  }
  useEffect(() => {
    setImportSiteUrl(defaultGscProperty);
    setInspectUrls(defaultInspectionUrl);
    load().catch(console.error);
  }, [site.id, site.domain, site.crawl_protocol, site.crawl_host]);

  function showImport(row: any) {
    setPerformance({ source: "import", import: row, rows: row.rows || [] });
    setDimension(row.dimensions?.[0] || "query");
  }

  async function connect() {
    try {
      const { url } = await api.gscStart(site.id);
      window.open(url, "_blank", "width=680,height=780");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start Google connection");
    }
  }
  async function loadSites() {
    setLoading("sites");
    try {
      setSites(await api.gscSites(site.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load Search Console properties");
    } finally {
      setLoading("");
    }
  }
  async function selectSite(siteUrl: string) {
    setLoading("site");
    try {
      setStatus(await api.gscSetSite(site.id, siteUrl));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not select property");
    } finally {
      setLoading("");
    }
  }
  async function query() {
    setLoading("performance");
    try {
      setPerformance(await api.gscPerformance({
        siteId: site.id,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        dimensions: [dimension],
        rowLimit: 100,
      }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not query Search Console performance");
    } finally {
      setLoading("");
    }
  }
  async function importCsv(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setLoading("import");
    try {
      const csv = await file.text();
      const result = await api.gscImport({
        siteId: site.id,
        siteUrl: importSiteUrl || site.domain,
        sourceName: file.name,
        csv,
      });
      setImports((rows) => [result, ...rows.filter((row) => row.id !== result.id)]);
      showImport(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not import Search Console CSV");
    } finally {
      input.value = "";
      setLoading("");
    }
  }
  async function inspect() {
    setLoading("inspection");
    try {
      setInspection(await api.gscInspect({ siteId: site.id, urls: inspectUrls }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not inspect URLs");
    } finally {
      setLoading("");
    }
  }
  async function disconnect() {
    setLoading("disconnect");
    try {
      await api.gscDisconnect(site.id);
      setSites([]);
      setPerformance(null);
      setInspection(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not disconnect Search Console");
    } finally {
      setLoading("");
    }
  }

  return (
    <>
      <PageHeader
        title="Search Console"
        description="Connect Google when OAuth is available, or import a Search Console CSV into local SQLite."
        meta={
          <span className="flex flex-wrap items-center gap-x-2">
            <span className="inline-flex items-center gap-1.5">
              <StatusDot tone={connectionTone} /> {connectionLabel}
            </span>
            {imports.length ? (
              <>
                <span className="text-border">·</span>
                <span>{formatNumber(imports.length)} local {imports.length === 1 ? "import" : "imports"}</span>
              </>
            ) : null}
          </span>
        }
      />
      <Tabs value={gscTab} onValueChange={setGscTab} className="space-y-5">
        <TabsList>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="import">Local import</TabsTrigger>
          <TabsTrigger value="inspection">URL inspection</TabsTrigger>
          <TabsTrigger value="connection">Connection</TabsTrigger>
        </TabsList>
        <TabsContent value="performance" className="space-y-5">
          <ReportSection
            title="Performance rows"
            description="Clicks, impressions, CTR, and average position from Search Console."
            meta={performance?.source === "import" ? `Viewing ${performance.import?.sourceName || "local import"} · ${formatDate(performance.import?.createdAt)}` : undefined}
          >
            <div className="mb-5 grid gap-3 md:grid-cols-[1fr_1fr_180px_auto_auto]">
              <Field label="Start date">
                <DatePicker value={dateRange.startDate} onChange={(startDate) => setDateRange({ ...dateRange, startDate })} />
              </Field>
              <Field label="End date">
                <DatePicker value={dateRange.endDate} onChange={(endDate) => setDateRange({ ...dateRange, endDate })} />
              </Field>
              <Field label="Dimension">
                <Select value={dimension} onValueChange={setDimension}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="query">Queries</SelectItem>
                    <SelectItem value="page">Pages</SelectItem>
                    <SelectItem value="country">Countries</SelectItem>
                    <SelectItem value="device">Devices</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <div className="flex items-end">
                <Button onClick={query} disabled={!status?.connection?.siteUrl || loading === "performance"}><BarChart3 /> {loading === "performance" ? "Querying" : "Query live"}</Button>
              </div>
              <div className="flex items-end">
                <Button variant="secondary" onClick={() => latestImport && showImport(latestImport)} disabled={!latestImport}><Upload /> Latest import</Button>
              </div>
            </div>
            {performance?.rows?.length ? (
              <div className="space-y-4">
                <GscPerformanceSummary rows={performance.rows} />
                <GscPerformanceTable rows={performance.rows} dimension={dimension} />
              </div>
            ) : (
              <EmptyState
                title="No Search Console rows"
                text="Import a CSV locally or connect Google and query a property."
              />
            )}
          </ReportSection>
        </TabsContent>
        <TabsContent value="import" className="space-y-5">
          <ReportSection
            title="Local CSV import"
            description="Export Search Console performance as CSV and store it in this app's SQLite database. Saved imports reopen without Google OAuth."
            meta={imports.length ? `${formatNumber(imports.length)} saved` : undefined}
          >
            <div className="grid gap-4 lg:grid-cols-[minmax(260px,360px)_minmax(260px,1fr)]">
              <Field label="Property label">
                <Input value={importSiteUrl} onChange={(event) => setImportSiteUrl(event.target.value)} placeholder="sc-domain:example.com" />
              </Field>
              <Field label="CSV file">
                <Input type="file" accept=".csv,text/csv" onChange={importCsv} disabled={loading === "import"} />
              </Field>
            </div>
            {imports.length ? (
              <GscImportHistory rows={imports} onOpen={showImport} />
            ) : (
              <div className="mt-5">
                <EmptyState title="No imports yet" text="Choose a Search Console CSV export to save real performance evidence locally." />
              </div>
            )}
          </ReportSection>
        </TabsContent>
        <TabsContent value="inspection" className="space-y-5">
          <ReportSection
            title="URL inspection"
            description="Inspect up to 20 URLs against a connected Google Search Console property."
          >
            <div className="space-y-4">
              <StatusEvidenceTable
                rows={[
                  {
                    title: "Inspection source",
                    status: selectedGscProperty ? "Google API ready" : "Google property required",
                    tone: selectedGscProperty ? "good" : "warn",
                    text: selectedGscProperty
                      ? `Live inspection uses ${selectedGscProperty}.`
                      : "Local CSV imports cover performance rows only; live URL inspection needs a connected Google property.",
                  },
                ]}
              />
              <Field label="URLs to inspect">
                <Textarea value={inspectUrls} onChange={(event) => setInspectUrls(event.target.value)} placeholder="https://example.com/page" />
              </Field>
              <Button
                onClick={selectedGscProperty ? inspect : () => setGscTab("connection")}
                disabled={loading === "inspection"}
              >
                <ExternalLink /> {loading === "inspection" ? "Inspecting" : selectedGscProperty ? "Inspect URLs" : "Open connection"}
              </Button>
              {inspection?.rows?.length ? <GscInspectionResults rows={inspection.rows} /> : null}
            </div>
          </ReportSection>
        </TabsContent>
        <TabsContent value="connection" className="space-y-5">
          <ReportSection
            title="Google connection"
            description="Connect once for live performance queries and URL inspection. Local CSV import works without Google."
          >
            <div className="space-y-4">
              <StatusEvidenceTable
                rows={[
                  {
                    title: "Google account",
                    status: status?.connected ? "Connected" : "Not connected",
                    tone: status?.connected ? "good" : "warn",
                    text:
                      status?.connection?.accountEmail ||
                      (status?.configured
                        ? "Connect once, then choose the matching property."
                        : "OAuth is not configured in this local runtime; local CSV import still works."),
                  },
                  { title: "Selected property", status: status?.connection?.siteUrl ? "Selected" : "None", tone: status?.connection?.siteUrl ? "good" : "warn", text: status?.connection?.siteUrl || "Load properties and pick the property for this site." },
                ]}
              />
              <div className="flex flex-wrap gap-3">
                <Button onClick={connect} disabled={!status?.configured}>Connect Google</Button>
                <Button variant="secondary" onClick={loadSites} disabled={!status?.connected || loading === "sites"}>{loading === "sites" ? "Loading" : "Load properties"}</Button>
                <Button variant="outline" onClick={disconnect} disabled={!status?.connected || loading === "disconnect"}>Disconnect</Button>
              </div>
              {sites.length > 0 ? (
                <Field label="Property">
                  <Select value={status?.connection?.siteUrl || ""} onValueChange={selectSite}>
                    <SelectTrigger><SelectValue placeholder="Choose property" /></SelectTrigger>
                    <SelectContent>
                      {sites.map((site) => <SelectItem key={site.siteUrl} value={site.siteUrl}>{site.siteUrl}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}
            </div>
          </ReportSection>
        </TabsContent>
      </Tabs>
    </>
  );
}

function GscImportHistory({ rows, onOpen }: { rows: any[]; onOpen: (row: any) => void }) {
  return (
    <div className="mt-5">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Import</TableHead>
            <TableHead>Property</TableHead>
            <TableHead>Rows</TableHead>
            <TableHead>Clicks</TableHead>
            <TableHead>Impressions</TableHead>
            <TableHead>Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.id}
              className="cursor-pointer"
              onClick={() => onOpen(row)}
            >
              <TableCell className="font-medium">
                <button
                  type="button"
                  className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 rounded-sm"
                  onClick={(event) => { event.stopPropagation(); onOpen(row); }}
                >
                  {row.sourceName || "Search Console CSV"}
                </button>
              </TableCell>
              <TableCell className="break-all text-sm text-muted-foreground">{row.siteUrl || "-"}</TableCell>
              <TableCell className="nums">{formatNumber(row.rowCount)}</TableCell>
              <TableCell className="nums">{formatNumber(row.totals?.clicks || 0)}</TableCell>
              <TableCell className="nums">{formatNumber(row.totals?.impressions || 0)}</TableCell>
              <TableCell>{formatDate(row.createdAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function GscPerformanceSummary({ rows }: { rows: any[] }) {
  const totals = rows.reduce((acc, row) => {
    const impressions = Number(row.impressions || 0);
    acc.clicks += Number(row.clicks || 0);
    acc.impressions += impressions;
    acc.weightedPosition += Number(row.position || 0) * impressions;
    return acc;
  }, { clicks: 0, impressions: 0, weightedPosition: 0 });
  const ctr = totals.impressions ? totals.clicks / totals.impressions : 0;
  const position = totals.impressions ? totals.weightedPosition / totals.impressions : 0;
  return (
    <StatsBand
      items={[
        { title: "Clicks", value: totals.clicks },
        { title: "Impressions", value: totals.impressions },
        { title: "CTR %", value: Number((ctr * 100).toFixed(1)) },
        { title: "Avg. position", value: Number(position.toFixed(1)) },
      ]}
    />
  );
}

function GscPerformanceTable({ rows, dimension }: { rows: any[]; dimension: string }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{dimension === "query" ? "Query" : dimension === "page" ? "Page" : dimension}</TableHead>
          <TableHead>Clicks</TableHead>
          <TableHead>Impressions</TableHead>
          <TableHead>CTR</TableHead>
          <TableHead>Position</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={`${row.keys?.join(":") || index}:${index}`}>
            <TableCell className="max-w-xl break-all font-medium">{row.keys?.join(" / ") || "-"}</TableCell>
            <TableCell className="nums">{formatNumber(row.clicks)}</TableCell>
            <TableCell className="nums">{formatNumber(row.impressions)}</TableCell>
            <TableCell className="nums">{formatPercent(row.ctr)}</TableCell>
            <TableCell className="nums">{formatPosition(row.position)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function gscVerdictTone(value?: string) {
  if (/pass|indexed|verdict_pass/i.test(value || "")) return "good";
  if (/partial|neutral|unspecified/i.test(value || "")) return "warn";
  return value ? "bad" : "outline";
}

function GscInspectionResults({ rows }: { rows: any[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>URL</TableHead>
          <TableHead>Verdict</TableHead>
          <TableHead>Coverage</TableHead>
          <TableHead>Indexing</TableHead>
          <TableHead>Fetch</TableHead>
          <TableHead>Robots</TableHead>
          <TableHead>Canonical evidence</TableHead>
          <TableHead>Rich results</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const index = row.result?.indexStatusResult || {};
          const rich = row.result?.richResultsResult || {};
          return (
            <TableRow key={row.inspectionUrl}>
              <TableCell className="max-w-sm break-all font-medium">
                <div>{row.inspectionUrl}</div>
                <div className="mt-1 text-xs text-muted-foreground">{index.lastCrawlTime ? `Last crawl ${formatDate(index.lastCrawlTime)}` : "Last crawl unavailable"}</div>
              </TableCell>
              <TableCell>
                <Badge variant={gscVerdictTone(index.verdict || row.error) as any}>{row.error ? "Error" : index.verdict || "Unknown"}</Badge>
              </TableCell>
              <TableCell className={cn("max-w-xs text-sm", row.error ? "text-destructive" : "text-muted-foreground")}>
                {row.error || index.coverageState || "Coverage state unavailable"}
              </TableCell>
              <TableCell className="text-muted-foreground">{index.indexingState || "-"}</TableCell>
              <TableCell className="text-muted-foreground">{index.pageFetchState || "-"}</TableCell>
              <TableCell className="text-muted-foreground">{index.robotsTxtState || "-"}</TableCell>
              <TableCell className="max-w-sm text-sm text-muted-foreground">
                <div className="break-all">Google: {index.googleCanonical || "-"}</div>
                <div className="mt-1 break-all">User: {index.userCanonical || "-"}</div>
              </TableCell>
              <TableCell className="text-muted-foreground">{rich.verdict || "-"}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export function AiPage({ site }: { site: Site }) {
  const [prompts, setPrompts] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [type, setType] = useState("seo.coach");
  const [context, setContext] = useState(`Site: ${site.name}\nDomain: ${site.domain}`);
  const [activeJobId, setActiveJobId] = useState("");
  const [starting, setStarting] = useState(false);
  const activeJob = jobs.find((job) => job.id === activeJobId) || jobs[0] || null;

  async function load() {
    const [nextPrompts, nextJobs] = await Promise.all([
      api.aiPrompts(),
      api.aiJobs(),
    ]);
    setPrompts(nextPrompts);
    setJobs(nextJobs);
    setActiveJobId((current) => current && nextJobs.some((job: any) => job.id === current) ? current : nextJobs[0]?.id || "");
  }
  useEffect(() => {
    setContext(`Site: ${site.name}\nDomain: ${site.domain}`);
    load().catch(console.error);
  }, [site.id, site.name, site.domain]);
  useEffect(() => {
    if (!jobs.some((job) => job.status === "queued" || job.status === "running")) return;
    const interval = window.setInterval(() => {
      load().catch(console.error);
    }, 1500);
    return () => window.clearInterval(interval);
  }, [jobs]);

  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    if (starting) return;
    setStarting(true);
    try {
      const prompt = prompts.find((item) => item.key === type)?.template?.replace("{{context}}", context) || context;
      const job = await api.createAiJob({ type, prompt });
      if (job?.id) setActiveJobId(job.id);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start the Codex job. Is the local Codex CLI available?");
    } finally {
      setStarting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="AI lab"
        description="SEO coach, keyword clustering, scan prioritization, competitor gaps, and AI visibility through local Codex medium jobs."
        meta={`${formatNumber(jobs.length)} saved ${jobs.length === 1 ? "job" : "jobs"}`}
      />
      <div className="grid gap-6 2xl:grid-cols-[460px_minmax(0,1fr)]">
        <ReportSection title="Run Codex" description="Jobs are queued in SQLite and run through your local Codex CLI.">
          <form className="space-y-4" onSubmit={submit}>
            <Field label="Workflow">
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{prompts.map((prompt) => <SelectItem key={prompt.key} value={prompt.key}>{prompt.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Context"><Textarea className="min-h-48" value={context} onChange={(e) => setContext(e.target.value)} /></Field>
            <Button disabled={starting}><Bot /> {starting ? "Starting job" : "Start job"}</Button>
          </form>
        </ReportSection>
        <div className="space-y-6">
          <ReportSection
            title="Jobs"
            meta="Saved local Codex runs from SQLite."
            action={
              <Button size="sm" variant="outline" type="button" onClick={() => load().catch(console.error)}>
                <RefreshCw /> Refresh
              </Button>
            }
          >
            {jobs.length ? <JobTable rows={jobs} selectedId={activeJob?.id || ""} onSelect={setActiveJobId} /> : <EmptyState title="No jobs" text="Start a local Codex workflow." />}
          </ReportSection>
          <AiJobOutput job={activeJob} />
        </div>
      </div>
    </>
  );
}

function AiJobOutput({ job }: { job: any }) {
  return (
    <ReportSection
      title="Job output"
      meta={job ? `${job.type} · ${formatDate(job.created_at)}` : undefined}
    >
      {job ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="inline-flex items-center gap-2 font-medium">
              <StatusDot tone={job.status === "completed" ? "good" : job.status === "failed" ? "bad" : "warn"} />
              {job.status || "-"}
            </span>
            <span className="text-muted-foreground">
              {job.started_at ? `· started ${formatDate(job.started_at)}` : "· not started"}
              {job.finished_at ? ` · finished ${formatDate(job.finished_at)}` : ""}
            </span>
          </div>
          {job.error ? (
            <pre className="max-h-[520px] overflow-auto rounded-lg bg-bad-soft/40 p-4 text-sm leading-6 text-destructive whitespace-pre-wrap">{job.error}</pre>
          ) : job.result_text ? (
            <pre className="max-h-[520px] overflow-auto rounded-lg bg-muted/45 p-4 text-sm leading-6 whitespace-pre-wrap">{job.result_text}</pre>
          ) : (
            <EmptyState title={job.status === "queued" || job.status === "running" ? "Codex is working" : "No output yet"} text={job.message || "The saved job has not produced text yet."} />
          )}
        </div>
      ) : (
        <EmptyState title="No job selected" text="Start or select a local Codex job to read the complete output here." />
      )}
    </ReportSection>
  );
}

export function McpPage({ site }: { site: Site }) {
  const [tools, setTools] = useState<any[]>([]);
  useEffect(() => {
    api.mcpTools().then((data) => setTools(data.tools || [])).catch(console.error);
  }, []);
  const endpoint = `${window.location.origin}/mcp`;
  const exampleDomain = cleanSiteDomain(site.domain);
  const exampleSiteId = site.id;
  const exampleScanUrl = site.domain ? preferredScanUrl(site) : "https://example.com";
  const exampleKeyword = exampleDomain ? `${exampleDomain} seo scan` : `${site.name || "site"} seo scan`;
  const groupedTools = useMemo(() => {
    return tools.reduce<Record<string, any[]>>((acc, tool) => {
      const group = mcpToolGroup(tool.name);
      acc[group] = acc[group] || [];
      acc[group].push(tool);
      return acc;
    }, {});
  }, [tools]);
  const examples = [
    {
      title: "List tools",
      body: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    },
    {
      title: "Scan a site",
      body: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "scan_site", arguments: { siteId: exampleSiteId } } },
    },
    {
      title: "Scan a URL",
      body: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "start_scan", arguments: { siteId: exampleSiteId, url: exampleScanUrl } } },
    },
    {
      title: "Read Search Console",
      body: { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_gsc_performance", arguments: { siteId: exampleSiteId, startDate: "2026-06-01", endDate: "2026-06-30", dimensions: ["query"] } } },
    },
    ...(exampleDomain
      ? [
          {
            title: "Read organic domain",
            body: { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_domain_overview", arguments: { siteId: exampleSiteId, domain: exampleDomain } } },
          },
          {
            title: "Read link index",
            body: { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "get_backlinks_profile", arguments: { siteId: exampleSiteId, domain: exampleDomain, tab: "domains" } } },
          },
          {
            title: "Analyze SERP",
            body: { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "analyze_serp", arguments: { siteId: exampleSiteId, keyword: exampleKeyword, domain: exampleDomain } } },
          },
        ]
      : []),
  ];
  return (
    <>
      <PageHeader
        title="MCP"
        description="Local JSON-RPC tools for sites, scans, keywords, rank tracking, Search Console, AI jobs, and reports."
        meta={`${formatNumber(tools.length)} local tools · calls prefilled for ${site.name || exampleDomain || "the active site"}`}
      />
      <div className="grid gap-6 2xl:grid-cols-[460px_minmax(0,1fr)]">
        <div className="space-y-6">
          <ReportSection title="Endpoint" description="Use this from local agents and scripts. If a local token is configured, include an Authorization: Bearer header with the request.">
            <code className="block break-all rounded-md bg-secondary px-3 py-2 text-sm">{`POST ${endpoint}`}</code>
          </ReportSection>
          <ReportSection title="Common calls" description="Known-good JSON-RPC request shapes, prefilled with this site's siteId and domain.">
            <div className="space-y-4">
              {examples.map((example) => <McpExample key={example.title} title={example.title} value={example.body} />)}
            </div>
          </ReportSection>
        </div>
        <div className="space-y-6">
          {Object.entries(groupedTools).map(([group, rows]) => (
            <ReportSection key={group} title={group} meta={`${formatNumber(rows.length)} tools`}>
              <McpToolTable rows={rows} />
            </ReportSection>
          ))}
        </div>
      </div>
    </>
  );
}

function McpToolTable({ rows }: { rows: any[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Tool</TableHead>
          <TableHead>Inputs</TableHead>
          <TableHead>Description</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((tool) => {
          const required = new Set(Array.isArray(tool.inputSchema?.required) ? tool.inputSchema.required : []);
          const properties = Object.keys(tool.inputSchema?.properties || {});
          return (
            <TableRow key={tool.name}>
              <TableCell className="min-w-52 font-medium">{tool.name}</TableCell>
              <TableCell className="min-w-64">
                <div className="flex flex-wrap gap-1">
                  {properties.length ? properties.map((name: string) => (
                    <Badge key={name} variant={required.has(name) ? "good" : "outline"}>
                      {name}{required.has(name) ? " required" : ""}
                    </Badge>
                  )) : <Badge variant="outline">none</Badge>}
                </div>
              </TableCell>
              <TableCell className="min-w-96 text-sm leading-6 text-muted-foreground">{tool.description}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function mcpToolGroup(name: string) {
  if (/scan/.test(name)) return "Site scans";
  if (/site|whoami/.test(name)) return "Sites";
  if (/keyword|serp|rank/.test(name)) return "Keywords and ranks";
  if (/domain|backlink/.test(name)) return "Competitive data";
  if (/gsc|inspect/.test(name)) return "Search Console";
  if (/brand|prompt|ai/.test(name)) return "AI visibility";
  return "Other";
}

function McpExample({ title, value }: { title: string; value: unknown }) {
  return (
    <div>
      <div className="text-sm font-medium">{title}</div>
      <pre className="mt-1.5 overflow-auto rounded-md bg-secondary p-3 text-xs leading-relaxed text-secondary-foreground">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

export function SettingsPage() {
  const [config, setConfig] = useState<any>({});
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);

  async function load() {
    const data = await api.config();
    setConfig(data);
    setForm({
      codex_model: data.codex_model || "",
      codex_reasoning_effort: data.codex_reasoning_effort || "medium",
      default_location_code: defaultLocationCodeFromConfig(data),
      default_language_code: defaultLanguageCodeFromConfig(data),
      default_crawl_protocol: defaultCrawlProtocolFromConfig(data),
      default_crawl_host: defaultCrawlHostFromConfig(data),
      default_crawl_speed: defaultCrawlSpeedFromConfig(data),
      default_crawl_max_pages: defaultCrawlMaxPagesFromConfig(data),
    });
  }
  useEffect(() => {
    load().catch(console.error);
  }, []);

  async function save(event: SyntheticEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await api.saveConfig({
        codex_model: String(form.codex_model || "").trim(),
        codex_reasoning_effort: String(form.codex_reasoning_effort || "medium").trim(),
        default_location_code: String(form.default_location_code || defaultKeywordLocationCode),
        default_language_code: String(form.default_language_code || defaultKeywordLanguageCode),
        default_crawl_protocol: String(form.default_crawl_protocol || "auto"),
        default_crawl_host: String(form.default_crawl_host || "auto"),
        default_crawl_speed: form.default_crawl_speed === "fast" ? "fast" : "polite",
        default_crawl_max_pages: String(Math.max(10, Math.min(1000, Number(form.default_crawl_max_pages) || 100))),
      });
      await load();
      toast.success("App settings saved locally.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save app settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader title="Settings" description="Local app preferences. Data sources are shown as status, not secret fields." />
      <div className="grid gap-6 2xl:grid-cols-[460px_minmax(0,1fr)]">
        <ReportSection title="App preferences" description="Defaults used when a new site is added. Existing sites keep their own saved settings.">
          <form className="space-y-5" onSubmit={save}>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Keyword tool defaults</h3>
              <InfoTip>Used for keyword research, SERP checks, and rank tracking. They do not restrict multilingual site scans.</InfoTip>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Default keyword market">
                <Select value={String(form.default_location_code || defaultKeywordLocationCode)} onValueChange={(value) => setForm({ ...form, default_location_code: Number(value) })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {marketOptions.map((market) => <SelectItem key={market.code} value={String(market.code)}>{market.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Default keyword result language">
                <Select value={form.default_language_code || defaultKeywordLanguageCode} onValueChange={(value) => setForm({ ...form, default_language_code: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {languageOptions.map((language) => <SelectItem key={language.code} value={language.code}>{language.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Default scan protocol">
                <Select value={form.default_crawl_protocol || "auto"} onValueChange={(value) => setForm({ ...form, default_crawl_protocol: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {crawlProtocolOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Default host variant">
                <Select value={form.default_crawl_host || "auto"} onValueChange={(value) => setForm({ ...form, default_crawl_host: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {crawlHostOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Default crawl speed">
                <Select value={form.default_crawl_speed || "polite"} onValueChange={(value) => setForm({ ...form, default_crawl_speed: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {crawlSpeedOptions.filter((option) => option.value !== "auto").map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Default max pages per scan">
                <Input
                  type="number"
                  min={10}
                  max={1000}
                  value={form.default_crawl_max_pages ?? 100}
                  onChange={(event) => setForm({ ...form, default_crawl_max_pages: event.target.value })}
                />
              </Field>
            </div>
            <div className="border-t pt-5">
              <div className="mb-3 flex items-center gap-2">
                <h3 className="text-sm font-semibold">Codex defaults</h3>
                <InfoTip>Local AI jobs run through the Codex CLI with medium reasoning. Leave the model empty to use your Codex CLI default.</InfoTip>
              </div>
              <div className="space-y-4">
                <Field label="Model override"><Input value={form.codex_model || ""} onChange={(e) => setForm({ ...form, codex_model: e.target.value })} placeholder="Codex CLI default" /></Field>
                <Field label="Reasoning">
                  <Select value={form.codex_reasoning_effort || "medium"} onValueChange={(value) => setForm({ ...form, codex_reasoning_effort: value })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </div>
            <Button disabled={saving}><Settings /> {saving ? "Saving settings" : "Save app settings"}</Button>
          </form>
        </ReportSection>
        <ReportSection title="Data sources" description="What the app can run locally now and what needs real imported data or a local provider.">
          <StatusEvidenceTable
            rows={[
              {
                title: "Local SQLite database",
                status: "Source of truth",
                tone: "good",
                text: (
                  <span className="break-all">
                    {config.local_db_path || "Database path unavailable"} · {formatNumber(config.local_site_count || 0)} sites · {formatNumber(config.local_scan_count || 0)} scans · {formatNumber(config.local_gsc_import_count || 0)} Search Console imports
                  </span>
                ),
              },
              { title: "Technical scans", status: "Active", tone: "good", text: "Local crawler checks metadata, images, links, robots, sitemap, indexability, headings, content, schema, and social tags." },
              { title: "Keyword ideas", status: "CSV import ready", tone: "good", text: "DuckDuckGo suggestions provide real query ideas; import keyword metrics CSVs on the Saved keywords page for volume, CPC, and difficulty." },
              { title: "SERP and rank checks", status: serpProviderStatus(config), tone: "good", text: "Uses local/self-hosted OpenSERP or SearXNG when configured, otherwise live DuckDuckGo results." },
              { title: "Search Console", status: "Local import ready", tone: "good", text: "Import Search Console CSVs locally; the Google connection is optional for live performance and URL inspection." },
              { title: "Backlink index", status: "CSV import ready", tone: "good", text: "Import backlink CSVs on the Links page; no backlink rows are ever generated." },
              { title: "MCP endpoint", status: "Local", tone: "good", text: "Local JSON-RPC endpoint, documented on the MCP screen." },
            ]}
          />
        </ReportSection>
      </div>
    </>
  );
}
