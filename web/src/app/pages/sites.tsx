import { useEffect, useMemo, useState, type ComponentProps, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, BarChart3, Bot, CheckCircle2, ChevronRight, FileSearch, Gauge, Globe2, Link2, Pencil, Plus, Search, Target, Trash2, Zap } from "lucide-react";
import { api, type Site } from "../../api";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Badge, Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Textarea } from "@/components/ui";
import { EmptyState, Field, JobTable, cleanSiteDomain, KeywordToolDefaultsPanel, PageHeader, ProgressBar, ReportSection, ScanPlanPreview, ScanPlanSummary, crawlHostOptions, crawlPreferenceLabel, crawlProtocolOptions, defaultCrawlHostFromConfig, defaultCrawlProtocolFromConfig, defaultKeywordLanguageCode, defaultKeywordLocationCode, defaultLanguageCodeFromConfig, defaultLocationCodeFromConfig, formatMs, formatNumber, keywordToolDefaultsLabel, preferredScanUrl, scanProgress, scanSeverityCounts, scanSpeedMetrics, scanStatusLabel, scanUrlCountLabel, scanUrlShortDetail, scoreBadgeVariant, setSelectedScanId, SiteAvatar, siteActionMessageStorageKey, siteDisplayName, sortScanRows, stashSiteActionMessage, takeSiteActionMessage } from "../shared";
import { cn } from "@/lib/utils";
import { ScanTable } from "./scans";

export function Overview({
  site,
  reloadSites,
  selectSite,
}: {
  site: Site;
  reloadSites: () => Promise<void>;
  selectSite: (id: string) => void;
}) {
  const [summary, setSummary] = useState<any>(null);
  const [scan, setScan] = useState<any>(null);
  const [scanRun, setScanRun] = useState<any>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [firstDomain, setFirstDomain] = useState("");
  const [firstName, setFirstName] = useState("");
  const [firstCrawlProtocol, setFirstCrawlProtocol] = useState<Site["crawl_protocol"]>("auto");
  const [firstCrawlHost, setFirstCrawlHost] = useState<Site["crawl_host"]>("auto");
  const [firstScanError, setFirstScanError] = useState("");
  const navigate = useNavigate();
  const scanLedgerRows = sortScanRows(summary?.allScans || summary?.latestScans || []);

  useEffect(() => {
    api.dashboard(site.id).then(setSummary).catch(console.error);
  }, [site.id]);

  useEffect(() => {
    let cancelled = false;
    api.config()
      .then((data) => {
        if (cancelled) return;
        setFirstCrawlProtocol(defaultCrawlProtocolFromConfig(data));
        setFirstCrawlHost(defaultCrawlHostFromConfig(data));
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, []);

  async function scanSite() {
    setScanning(true);
    setScanError("");
    try {
      const result = await api.scanSite(site.id);
      setScan(result);
      setScanRun(result.scan);
      if (result.scan?.id) {
        setSelectedScanId(site.id, result.scan.id);
        navigate(`/scans/${result.scan.id}`);
      }
      setSummary(await api.dashboard(site.id));
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Could not start site scan");
    } finally {
      setScanning(false);
    }
  }

  function openScanReport(scanId: string, row?: any) {
    setSelectedScanId(row?.site_id || site.id, scanId);
    navigate(`/scans/${scanId}`);
  }

  async function createSiteAndScan(event: FormEvent) {
    event.preventDefault();
    const domain = firstDomain.trim();
    if (!domain) return;
    setScanning(true);
    setFirstScanError("");
    try {
      const created = await api.createSite({
        name: firstName.trim() || domain,
        domain,
        crawlProtocol: firstCrawlProtocol,
        crawlHost: firstCrawlHost,
      } as any);
      selectSite(created.id);
      const result = await api.scanSite(created.id);
      if (result.scan?.id) {
        setSelectedScanId(created.id, result.scan.id);
      }
      await reloadSites();
      if (result.scan?.id) navigate(`/scans/${result.scan.id}`);
      else navigate("/scans");
    } catch (err) {
      setFirstScanError(err instanceof Error ? err.message : "Could not start the first scan");
    } finally {
      setScanning(false);
    }
  }

  useEffect(() => {
    if (!scanRun || (scanRun.status !== "queued" && scanRun.status !== "running")) return;
    const interval = window.setInterval(async () => {
      const nextScan = await api.scan(scanRun.id);
      setScanRun(nextScan);
      if (nextScan?.status === "completed" || nextScan?.status === "failed") {
        setSummary(await api.dashboard(site.id));
      }
    }, 1500);
    return () => window.clearInterval(interval);
  }, [scanRun?.id, scanRun?.status]);

  const firstScanPlan = {
    domain: firstDomain,
    crawl_protocol: firstCrawlProtocol,
    crawl_host: firstCrawlHost,
  };

  return (
    <>
      <PageHeader
        title={siteDisplayName(site)}
        description={site.domain ? undefined : "Add a site to unlock scans, reports, rankings, and Search Console."}
        action={<Badge variant="outline">{site.domain || "No site yet"}</Badge>}
      />
      {!site.domain ? (
        <section className="mb-6 rounded-xl border border-primary/30 bg-primary/[0.03] p-5 sm:p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">Start with a site scan</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">Add the website address once. The scan report opens automatically and stays saved locally.</p>
          </div>
          <form className="space-y-3" onSubmit={createSiteAndScan}>
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
              <Field label="Website address">
                <Input value={firstDomain} onChange={(event) => setFirstDomain(event.target.value)} placeholder="example.com" required />
              </Field>
              <Field label="Site name">
                <Input value={firstName} onChange={(event) => setFirstName(event.target.value)} placeholder="Site name (optional)" />
              </Field>
              <Button type="submit" disabled={scanning} className="lg:mb-px">
                <FileSearch /> {scanning ? "Starting" : "Add site and scan"}
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Scan protocol">
                <Select value={firstCrawlProtocol} onValueChange={(value) => setFirstCrawlProtocol(value as Site["crawl_protocol"])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {crawlProtocolOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Host variant">
                <Select value={firstCrawlHost} onValueChange={(value) => setFirstCrawlHost(value as Site["crawl_host"])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {crawlHostOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <ScanPlanPreview site={firstScanPlan} />
          </form>
          {firstScanError && <p className="mt-3 rounded-md border border-destructive/40 bg-muted/30 p-3 text-sm text-destructive">{firstScanError}</p>}
        </section>
      ) : null}
      {scanError && <p className="mb-6 rounded-md border border-destructive/40 bg-muted/30 p-3 text-sm text-destructive">{scanError}</p>}
      {scan && (
        <section className="mb-6 rounded-xl border border-primary/30 bg-primary/[0.03] p-5 sm:p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">
              {scanRun?.status === "completed" ? "Scan complete" : scanRun?.status === "failed" ? "Scan failed" : "Scan running"} for {scan.scanUrl || scanRun?.url || scan.site}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {scanRun?.pages_crawled || 0} pages scanned · {scanRun?.issue_count || 0} issues found
            </p>
          </div>
          <div className="space-y-4">
            <ProgressBar value={scanProgress(scanRun)} />
            {scan.related?.length ? <ScanCoverageList rows={scan.related} scanStatus={scanRun?.status} /> : null}
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="secondary">
                <Link to={scanRun?.id ? `/scans/${scanRun.id}` : "/scans"}>Open scan report</Link>
              </Button>
              <Button asChild variant="secondary"><Link to="/domain">View organic research</Link></Button>
              <Button asChild variant="secondary"><Link to="/links">View links</Link></Button>
            </div>
          </div>
        </section>
      )}
      <div className="mb-6">
        <SiteCommandCenter site={site} summary={summary} scanning={scanning} onScan={scanSite} />
      </div>
      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1.1fr)_minmax(520px,0.9fr)]">
        <ReportSection title="Scan history" description={`${formatNumber(scanLedgerRows.length)} saved scans in local SQLite.`}>
          {scanLedgerRows.length ? (
            <div className="-mx-5 -mb-5">
              <ScanTable rows={scanLedgerRows} showSite activeSiteId={site.id} onInspect={openScanReport} />
            </div>
          ) : (
            <EmptyState
              icon={FileSearch}
              title="No scans yet"
              text={site.domain ? "Start a technical scan for this site." : "Add a website address to start scanning."}
              action={
                site.domain ? (
                  <Button onClick={scanSite} disabled={scanning}>
                    <FileSearch /> {scanning ? "Starting" : "Scan website"}
                  </Button>
                ) : (
                  <Button asChild><Link to="/"><Plus /> Add site</Link></Button>
                )
              }
            />
          )}
        </ReportSection>
        <ReportSection title="Codex job history" description="Local AI work runs through the Codex CLI with medium reasoning.">
          {summary?.latestAiJobs?.length ? (
            <JobTable rows={summary.latestAiJobs} />
          ) : (
            <EmptyState
              icon={Bot}
              title="No AI jobs yet"
              text="Start a local Codex workflow when you need analysis or prioritization."
              action={<Button asChild variant="secondary"><Link to="/ai"><Bot /> Open AI lab</Link></Button>}
            />
          )}
        </ReportSection>
      </div>
    </>
  );
}

function SiteCommandCenter({
  site,
  summary,
  scanning,
  onScan,
}: {
  site: Site;
  summary: any;
  scanning: boolean;
  onScan: () => void;
}) {
  const latestScan = summary?.latestScans?.[0];
  const latestScanSummary = latestScan?.result?.summary || {};
  const latestScanSpeed = latestScan ? scanSpeedMetrics(latestScan) : null;
  const latestGscImport = summary?.latestGscImport;
  const rows = [
    {
      key: "site",
      area: "Active site",
      status: site.domain || "Needs website address",
      evidence: site.domain
        ? `Scan plan: ${scanUrlShortDetail(site)} · starts at ${preferredScanUrl(site)} · Keyword tools: ${keywordToolDefaultsLabel(site)}`
        : "Add a site before running scans, rankings, Search Console imports, or AI work.",
      action: site.domain ? (
        <Button size="sm" onClick={onScan} disabled={scanning}>
          <FileSearch /> {scanning ? "Starting" : "Scan website"}
        </Button>
      ) : (
        <Button asChild size="sm"><Link to="/"><Plus /> Add site</Link></Button>
      ),
      secondary: site.domain ? (
        <Button asChild size="sm" variant="outline"><Link to="/"><Pencil /> Edit site</Link></Button>
      ) : null,
    },
    {
      key: "scan",
      area: "Technical scan",
      status: latestScan ? scanStatusLabel(latestScan.status) : "Needs scan",
      evidence: latestScan
        ? `${formatNumber(latestScan.pages_crawled)} pages · ${formatNumber(latestScan.issue_count)} issues · ${formatNumber(latestScanSummary.checkedLinks || 0)} links checked`
        : "No crawl evidence saved yet.",
      action: <Button asChild size="sm" variant="secondary"><Link to="/scans"><FileSearch /> Open site scans</Link></Button>,
      secondary: latestScan ? (
        <Button asChild size="sm" variant="outline">
          <Link to={`/scans/${latestScan.id}`}><FileSearch /> Open scan report</Link>
        </Button>
      ) : null,
    },
    {
      key: "speed",
      area: "Page speed",
      status: latestScanSpeed?.measuredPageLoads ? "Timing measured" : "Needs scan",
      evidence: latestScanSpeed?.measuredPageLoads
        ? `${formatNumber(latestScanSpeed.measuredPageLoads)} pages timed · average ${formatMs(latestScanSpeed.averagePageLoadMs)} · p95 ${formatMs(latestScanSpeed.p95PageLoadMs)} · ${formatNumber(latestScanSpeed.slowPages)} slow`
        : "Run a site scan to record response timings for every crawled HTML page.",
      action: latestScanSpeed?.measuredPageLoads ? (
        <Button asChild size="sm" variant="secondary">
          <Link to={`/scans/${latestScan.id}?tab=speed`}><Zap /> Open speed report</Link>
        </Button>
      ) : site.domain ? (
        <Button size="sm" variant="secondary" onClick={onScan} disabled={scanning}>
          <Zap /> {scanning ? "Starting" : "Scan website"}
        </Button>
      ) : (
        <Button asChild size="sm" variant="secondary"><Link to="/"><Plus /> Add site</Link></Button>
      ),
      secondary: latestScan ? (
        <Button asChild size="sm" variant="outline"><Link to="/scans"><FileSearch /> Open scan history</Link></Button>
      ) : null,
    },
    {
      key: "organic",
      area: "Organic research",
      status: summary?.savedKeywordCount ? "Keywords saved" : "Ready for research",
      evidence: `${formatNumber(summary?.savedKeywordCount || 0)} saved keywords · local crawl pages feed this screen`,
      action: <Button asChild size="sm" variant="secondary"><Link to="/domain"><Globe2 /> Open organic research</Link></Button>,
      secondary: null,
    },
    {
      key: "links",
      area: "Links",
      status: latestScan ? "Local graph ready" : "Needs scan",
      evidence: latestScan
        ? `${formatNumber(latestScanSummary.linkTags || 0)} link tags · ${formatNumber(latestScanSummary.brokenLinks || 0)} broken`
        : "Run a site scan to build the local link graph.",
      action: <Button asChild size="sm" variant="secondary"><Link to="/links"><Link2 /> Open local link graph</Link></Button>,
      secondary: null,
    },
    {
      key: "rank",
      area: "Rank tracking",
      status: summary?.trackerCount ? "Tracking keywords" : "Manual checks",
      evidence: `${formatNumber(summary?.trackerCount || 0)} trackers · ${formatNumber(summary?.serpRunCount || 0)} SERP runs`,
      action: <Button asChild size="sm" variant="secondary"><Link to="/rank"><Target /> Open rank tracking</Link></Button>,
      secondary: null,
    },
    {
      key: "gsc",
      area: "Search Console",
      status: summary?.gscImportCount ? "Local CSV imports" : "Ready for import",
      evidence: summary?.gscImportCount
        ? `${formatNumber(summary.gscImportCount)} CSV imports · latest has ${formatNumber(latestGscImport?.rowCount || 0)} rows and ${formatNumber(latestGscImport?.totals?.clicks || 0)} clicks`
        : "Import a Search Console CSV locally, or connect Google for live performance and inspection.",
      action: <Button asChild size="sm" variant="secondary"><Link to="/gsc"><BarChart3 /> Open Search Console</Link></Button>,
      secondary: null,
    },
    {
      key: "ai",
      area: "AI lab",
      status: summary?.latestAiJobs?.length ? "Jobs saved" : "Ready for Codex",
      evidence: `${formatNumber(summary?.latestAiJobs?.length || 0)} saved Codex jobs · runs locally with medium reasoning`,
      action: <Button asChild size="sm" variant="secondary"><Link to="/ai"><Bot /> Open AI lab</Link></Button>,
      secondary: null,
    },
  ];

  const iconByKey: Record<string, any> = {
    site: Globe2,
    scan: FileSearch,
    speed: Zap,
    organic: Search,
    links: Link2,
    rank: Target,
    gsc: BarChart3,
    ai: Bot,
  };

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="eyebrow-muted">Site control</h2>
        {site.domain ? <Badge variant="outline">{scanUrlShortDetail(site)}</Badge> : null}
      </div>
      <div className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border bg-card">
        {rows.map((row) => {
          const Icon = iconByKey[row.key] || Gauge;
          return (
            <div key={row.key} className="flex flex-col gap-3 px-4 py-3.5 transition-colors hover:bg-accent/30 sm:flex-row sm:items-center sm:gap-4">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-inset ring-primary/12">
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{row.area}</span>
                    <Badge variant={siteCommandStatusVariant(row.status)}>{row.status}</Badge>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-muted-foreground">{row.evidence}</p>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                {row.action}
                {row.secondary}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function siteCommandStatusVariant(status: string): ComponentProps<typeof Badge>["variant"] {
  return /^Needs/i.test(status) ? "warn" : "outline";
}

function ScanCoverageList({ rows, scanStatus }: { rows: any[]; scanStatus?: string }) {
  return (
    <div className="divide-y rounded-xl border border-border bg-card shadow-[0_1px_2px_0_rgb(38_32_20/0.04)]">
      {rows.map((row) => {
        const status = row.key === "technical-scan" && scanStatus ? scanStatus : row.status;
        const variant = status === "completed" || status === "queued" || status === "running" || status === "local" ? "good" : status === "needs-provider" ? "warn" : "outline";
        const actionLabel = row.key === "technical-scan"
          ? "Open live report"
          : row.key === "page-speed"
            ? "Open speed report"
            : `Open ${String(row.label || "").toLowerCase()}`;
        return (
          <div key={row.key} className="grid gap-3 p-4 lg:grid-cols-[220px_1fr_auto] lg:items-center">
            <div className="flex items-center gap-3">
              <Badge variant={variant as any}>{scanStatusLabel(status)}</Badge>
              <div className="font-medium">{row.label}</div>
            </div>
            <p className="text-sm leading-6 text-muted-foreground">{row.message}</p>
            {row.route ? (
              <Button asChild size="sm" variant="outline">
                <Link to={row.route}>{actionLabel}</Link>
              </Button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function SitesManager({
  variant,
  sites,
  reloadSites,
  activeSiteId,
  selectSite,
}: {
  variant: "home" | "settings";
  sites: Site[];
  reloadSites: () => Promise<void>;
  activeSiteId: string;
  selectSite: (id: string) => void;
}) {
  type SiteForm = {
    name: string;
    domain: string;
    notes: string;
    locationCode: number;
    languageCode: string;
    crawlProtocol: Site["crawl_protocol"];
    crawlHost: Site["crawl_host"];
  };
  type SiteEditForm = {
    name: string;
    domain: string;
    notes: string;
    location_code: number;
    language_code: string;
    crawl_protocol: Site["crawl_protocol"];
    crawl_host: Site["crawl_host"];
  };
  const initialSiteForm: SiteForm = {
    name: "",
    domain: "",
    notes: "",
    locationCode: defaultKeywordLocationCode,
    languageCode: defaultKeywordLanguageCode,
    crawlProtocol: "auto",
    crawlHost: "auto",
  };
  const [open, setOpen] = useState(false);
  const [showKeywordDefaults, setShowKeywordDefaults] = useState(false);
  const [showEditKeywordDefaults, setShowEditKeywordDefaults] = useState(false);
  const [siteDefaults, setSiteDefaults] = useState<SiteForm>(initialSiteForm);
  const [form, setForm] = useState<SiteForm>(initialSiteForm);
  const [editing, setEditing] = useState<Site | null>(null);
  const [deleting, setDeleting] = useState<Site | null>(null);
  const [editForm, setEditForm] = useState<SiteEditForm>({
    name: "",
    domain: "",
    notes: "",
    location_code: defaultKeywordLocationCode,
    language_code: defaultKeywordLanguageCode,
    crawl_protocol: "auto",
    crawl_host: "auto",
  });
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState(takeSiteActionMessage);
  const [scanningSiteId, setScanningSiteId] = useState("");
  const [creatingAction, setCreatingAction] = useState<"scan" | "save" | "">("");
  const [deletingSiteId, setDeletingSiteId] = useState("");
  const [editingSiteId, setEditingSiteId] = useState("");
  const [allScans, setAllScans] = useState<any[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    if (variant !== "home") return;
    let cancelled = false;
    api.allScans()
      .then((rows) => {
        if (!cancelled) setAllScans(Array.isArray(rows) ? rows : []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [variant, sites.length]);

  const healthBySite = useMemo(() => {
    const map = new Map<string, any>();
    for (const scan of sortScanRows(allScans)) {
      const key = scan.site_id;
      if (key && !map.has(key)) map.set(key, scan);
    }
    return map;
  }, [allScans]);

  function showActionMessage(message: string, persistForRemount = false) {
    if (persistForRemount) stashSiteActionMessage(message);
    setActionMessage(message);
  }

  function clearActionMessage() {
    sessionStorage.removeItem(siteActionMessageStorageKey);
    setActionMessage("");
  }

  useEffect(() => {
    let cancelled = false;
    api.config()
      .then((data) => {
        if (cancelled) return;
        const defaults = {
          ...initialSiteForm,
          locationCode: defaultLocationCodeFromConfig(data),
          languageCode: defaultLanguageCodeFromConfig(data),
          crawlProtocol: defaultCrawlProtocolFromConfig(data),
          crawlHost: defaultCrawlHostFromConfig(data),
        };
        setSiteDefaults(defaults);
        setForm((current) =>
          current.name || current.domain || current.notes ? current : defaults,
        );
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, []);

  async function createSite(scanAfterCreate: boolean) {
    if (!form.domain.trim()) {
      setError("Enter a website address before saving the site.");
      return;
    }
    setError("");
    clearActionMessage();
    setCreatingAction(scanAfterCreate ? "scan" : "save");
    try {
      const created = await api.createSite({
        ...form,
        name: form.name.trim() || form.domain.trim() || "Untitled site",
      });
      selectSite(created.id);
      setOpen(false);
      setForm(siteDefaults);
      if (scanAfterCreate) {
        const result = await api.scanSite(created.id);
        if (result.scan?.id) {
          setSelectedScanId(created.id, result.scan.id);
        }
        await reloadSites();
        if (result.scan?.id) navigate(`/scans/${result.scan.id}`);
        else navigate("/scans");
        return;
      }
      await reloadSites();
      showActionMessage(`${cleanSiteDomain(created.domain) || created.name || "Site"} saved locally.`, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : scanAfterCreate ? "Could not add and scan site" : "Could not add site");
    } finally {
      setCreatingAction("");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    await createSite(true);
  }

  function startEdit(site: Site) {
    setEditing(site);
    setShowEditKeywordDefaults(false);
    setError("");
    clearActionMessage();
    setEditForm({
      name: site.name,
      domain: site.domain || "",
      notes: site.notes || "",
      location_code: site.location_code || defaultKeywordLocationCode,
      language_code: site.language_code || defaultKeywordLanguageCode,
      crawl_protocol: site.crawl_protocol || "auto",
      crawl_host: site.crawl_host || "auto",
    });
  }

  async function submitEdit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setError("");
    setEditingSiteId(editing.id);
    try {
      const updated = await api.updateSite(editing.id, editForm);
      setEditing(null);
      await reloadSites();
      showActionMessage(`${cleanSiteDomain(updated.domain) || updated.name || "Site"} updated locally.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update site");
    } finally {
      setEditingSiteId("");
    }
  }

  async function deleteSite(site: Site) {
    setError("");
    clearActionMessage();
    setDeletingSiteId(site.id);
    try {
      const message = `${cleanSiteDomain(site.domain) || site.name || "Site"} deleted locally.`;
      if (site.id === activeSiteId) stashSiteActionMessage(message);
      await api.deleteSite(site.id);
      setDeleting(null);
      await reloadSites();
      showActionMessage(message);
    } catch (err) {
      sessionStorage.removeItem(siteActionMessageStorageKey);
      setError(err instanceof Error ? err.message : "Could not delete site");
    } finally {
      setDeletingSiteId("");
    }
  }

  async function scanSite(site: Site) {
    if (!site.domain) return;
    setError("");
    clearActionMessage();
    setScanningSiteId(site.id);
    try {
      const result = await api.scanSite(site.id);
      if (result.scan?.id) {
        setSelectedScanId(site.id, result.scan.id);
      }
      setScanningSiteId("");
      selectSite(site.id);
      if (result.scan?.id) navigate(`/scans/${result.scan.id}`);
      else navigate("/scans");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start site scan");
      setScanningSiteId("");
    }
  }

  const formScanPlan = {
    domain: form.domain,
    crawl_protocol: form.crawlProtocol,
    crawl_host: form.crawlHost,
  };
  const editScanPlan = {
    domain: editForm.domain,
    crawl_protocol: editForm.crawl_protocol,
    crawl_host: editForm.crawl_host,
  };
  function siteActions(site: Site, layout: "mobile" | "desktop" = "desktop") {
    const mobile = layout === "mobile";
    const buttonClass = mobile ? "h-11 min-w-32 flex-1 sm:flex-none" : undefined;
    return (
      <div className={cn("flex flex-wrap gap-2", mobile ? "" : "justify-end")}>
        {activeSiteId !== site.id ? (
          <Button size={mobile ? "default" : "sm"} variant="secondary" className={buttonClass} onClick={() => selectSite(site.id)}>
            Make active
          </Button>
        ) : null}
        {site.domain ? (
          <Button
            size={mobile ? "default" : "sm"}
            variant="outline"
            className={buttonClass}
            aria-label={`Scan ${site.name}`}
            title={`Scan ${site.domain}`}
            disabled={scanningSiteId === site.id}
            onClick={() => scanSite(site)}
          >
            <FileSearch /> {scanningSiteId === site.id ? "Starting" : "Scan website"}
          </Button>
        ) : null}
        <Button size={mobile ? "default" : "sm"} variant="outline" className={buttonClass} aria-label={`Edit ${site.name}`} onClick={() => startEdit(site)}>
          <Pencil /> Edit
        </Button>
        <Button size={mobile ? "default" : "sm"} variant="destructive" className={buttonClass} aria-label={`Delete ${site.name}`} onClick={() => setDeleting(site)}>
          <Trash2 /> Delete
        </Button>
      </div>
    );
  }

  const banners = (
    <>
      {actionMessage ? (
        <p className="mb-4 flex items-center gap-2 rounded-lg border border-good/20 bg-good-soft/60 px-3.5 py-2.5 text-sm text-good">
          <CheckCircle2 className="size-4 shrink-0" /> {actionMessage}
        </p>
      ) : null}
      {error && (
        <p className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/30 bg-bad-soft/60 px-3.5 py-2.5 text-sm text-destructive">
          <AlertTriangle className="size-4 shrink-0" /> {error}
        </p>
      )}
    </>
  );

  const onboarding = (
    <section className="rounded-2xl border border-dashed border-primary/40 bg-primary/[0.035] p-6 sm:p-9">
      <div className="mx-auto max-w-2xl text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/15">
          <Globe2 className="size-6" />
        </div>
        <h2 className="page-title mt-4 text-2xl font-medium">Add your first website</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          Save the address once. The technical scan runs immediately and everything — score, issues, speed, links — stays in local SQLite.
        </p>
      </div>
      <form className="mx-auto mt-6 max-w-2xl space-y-4" onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] sm:items-end">
          <Field label="Website address">
            <Input value={form.domain} onChange={(event) => setForm({ ...form, domain: event.target.value })} placeholder="example.com" required />
          </Field>
          <Field label="Site name">
            <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Optional" />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Scan protocol">
            <Select value={form.crawlProtocol} onValueChange={(value) => setForm({ ...form, crawlProtocol: value as Site["crawl_protocol"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {crawlProtocolOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Host variant">
            <Select value={form.crawlHost} onValueChange={(value) => setForm({ ...form, crawlHost: value as Site["crawl_host"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {crawlHostOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <ScanPlanPreview site={formScanPlan} />
        <div className="flex justify-center">
          <Button type="submit" size="lg" disabled={Boolean(creatingAction)}>
            <FileSearch /> {creatingAction === "scan" ? "Starting scan…" : "Add site and scan"}
          </Button>
        </div>
      </form>
    </section>
  );

  function renderSiteRow(site: Site) {
    const scan = healthBySite.get(site.id);
    const scanned = Boolean(scan);
    const score = Number(scan?.score || 0);
    const isActive = activeSiteId === site.id;
    const sev = scanned ? scanSeverityCounts(scan) : { high: 0, medium: 0, low: 0 };
    const openWorkspace = () => {
      selectSite(site.id);
      navigate("/overview");
    };
    return (
      <div
        key={site.id}
        className={cn("group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/35", isActive ? "bg-primary/[0.045]" : "")}
      >
        <button type="button" onClick={openWorkspace} className="flex min-w-0 flex-1 items-center gap-3 text-left" title={`Open ${site.name}`}>
          <SiteAvatar site={site} className="size-10 text-sm" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium transition-colors group-hover:text-primary">{site.name}</span>
              {isActive ? <Badge variant="good">Active</Badge> : null}
            </div>
            <div className="truncate text-sm text-muted-foreground">{site.domain || "No website address"}</div>
          </div>
        </button>

        {site.domain ? (
          <div className="hidden min-w-0 max-w-[20rem] flex-1 lg:block">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline">{crawlPreferenceLabel(site)}</Badge>
              <Badge variant="outline">{scanUrlCountLabel(site)}</Badge>
            </div>
            <div className="mt-1 truncate text-xs text-muted-foreground">{preferredScanUrl(site)}</div>
          </div>
        ) : null}

        <div className="hidden items-center gap-3 xl:flex">
          {scanned ? (
            <>
              <Badge variant={scoreBadgeVariant(score)}>{formatNumber(score)} health</Badge>
              <span className="whitespace-nowrap text-xs text-muted-foreground">
                <span className={sev.high ? "font-medium text-bad" : ""}>{formatNumber(sev.high)}</span> high ·{" "}
                <span className={sev.medium ? "font-medium text-warn" : ""}>{formatNumber(sev.medium)}</span> med · {formatNumber(scan.pages_crawled)} pages
              </span>
            </>
          ) : (
            <Badge variant="outline">Not scanned</Badge>
          )}
        </div>

        {site.domain ? (
          <Button size="sm" variant="outline" className="hidden sm:inline-flex" disabled={scanningSiteId === site.id} onClick={() => scanSite(site)}>
            <FileSearch /> {scanningSiteId === site.id ? "Starting" : "Scan"}
          </Button>
        ) : null}
        <div className="flex items-center opacity-60 transition-opacity group-hover:opacity-100">
          <Button size="icon" variant="ghost" className="size-8 text-muted-foreground" aria-label={`Edit ${site.name}`} onClick={() => startEdit(site)}>
            <Pencil />
          </Button>
          <Button size="icon" variant="ghost" className="size-8 text-muted-foreground hover:text-destructive" aria-label={`Delete ${site.name}`} onClick={() => setDeleting(site)}>
            <Trash2 />
          </Button>
        </div>
        <Button size="sm" variant="ghost" className="text-muted-foreground group-hover:text-foreground" onClick={openWorkspace}>
          Open <ChevronRight />
        </Button>
      </div>
    );
  }

  const addDialog = (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setShowKeywordDefaults(false);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add site</DialogTitle>
          <DialogDescription>Add the website once, choose exactly how it should be reached, and start a local scan immediately.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <Field label="Site name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Optional" /></Field>
          <Field label="Website address"><Input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="example.com" required /></Field>
          <KeywordToolDefaultsPanel
            expanded={showKeywordDefaults}
            locationCode={form.locationCode}
            languageCode={form.languageCode}
            onToggle={() => setShowKeywordDefaults((value) => !value)}
            onLocationCodeChange={(value) => setForm({ ...form, locationCode: value })}
            onLanguageCodeChange={(value) => setForm({ ...form, languageCode: value })}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Scan protocol">
              <Select value={form.crawlProtocol} onValueChange={(value) => setForm({ ...form, crawlProtocol: value as Site["crawl_protocol"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {crawlProtocolOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Host variant">
              <Select value={form.crawlHost} onValueChange={(value) => setForm({ ...form, crawlHost: value as Site["crawl_host"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {crawlHostOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <ScanPlanPreview site={formScanPlan} />
          <Field label="Notes"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" disabled={Boolean(creatingAction)} onClick={() => createSite(false)}>
              <Plus /> {creatingAction === "save" ? "Saving" : "Save site only"}
            </Button>
            <Button type="submit" disabled={Boolean(creatingAction)}>
              <FileSearch /> {creatingAction === "scan" ? "Starting scan" : "Add site and scan"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );

  const editDialog = (
    <Dialog open={Boolean(editing)} onOpenChange={(nextOpen) => !nextOpen && setEditing(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit site</DialogTitle>
          <DialogDescription>Changes apply to this saved website address and future scans.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submitEdit}>
          <Field label="Site name"><Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required /></Field>
          <Field label="Website address"><Input value={editForm.domain} onChange={(e) => setEditForm({ ...editForm, domain: e.target.value })} /></Field>
          <KeywordToolDefaultsPanel
            expanded={showEditKeywordDefaults}
            locationCode={editForm.location_code}
            languageCode={editForm.language_code}
            onToggle={() => setShowEditKeywordDefaults((value) => !value)}
            onLocationCodeChange={(value) => setEditForm({ ...editForm, location_code: value })}
            onLanguageCodeChange={(value) => setEditForm({ ...editForm, language_code: value })}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Scan protocol">
              <Select value={editForm.crawl_protocol} onValueChange={(value) => setEditForm({ ...editForm, crawl_protocol: value as Site["crawl_protocol"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {crawlProtocolOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Host variant">
              <Select value={editForm.crawl_host} onValueChange={(value) => setEditForm({ ...editForm, crawl_host: value as Site["crawl_host"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {crawlHostOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <ScanPlanPreview site={editScanPlan} />
          <Field label="Notes"><Textarea value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} /></Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={Boolean(editingSiteId)}>
            <Pencil /> {editingSiteId ? "Saving changes" : "Save changes"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );

  const deleteDialog = (
    <AlertDialog open={Boolean(deleting)} onOpenChange={(nextOpen) => !nextOpen && setDeleting(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete site?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes "{deleting?.name}" and its saved scans, keywords, trackers, Search Console imports, and local history from SQLite.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={Boolean(deletingSiteId)}>Cancel</AlertDialogCancel>
          <AlertDialogAction type="button" disabled={Boolean(deletingSiteId)} onClick={() => deleting && deleteSite(deleting)}>
            {deletingSiteId ? "Deleting site" : "Delete site"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (variant === "home") {
    return (
      <>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border/70 pb-4">
          <div className="min-w-0">
            <h1 className="page-title text-[1.7rem] leading-tight">Your sites</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatNumber(sites.length)} {sites.length === 1 ? "site" : "sites"} · open one to enter its workspace
            </p>
          </div>
          {sites.length ? (
            <Button onClick={() => setOpen(true)}>
              <Plus /> Add site
            </Button>
          ) : null}
        </div>
        {banners}
        {sites.length === 0 ? (
          onboarding
        ) : (
          <div className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_2px_0_rgb(38_32_20/0.04)]">
            {sites.map((site) => renderSiteRow(site))}
          </div>
        )}
        {addDialog}
        {editDialog}
        {deleteDialog}
      </>
    );
  }

  return (
    <>
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_2px_0_rgb(38_32_20/0.04),0_10px_28px_-20px_rgb(38_32_20/0.2)]">
        <div className="flex flex-col gap-3 border-b border-border/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-heading text-lg font-semibold">Sites</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">Saved website addresses and their crawl preferences. The active site drives every workspace screen.</p>
          </div>
          <Button size="sm" onClick={() => setOpen(true)}><Plus /> Add site</Button>
        </div>
        <div className="p-5">
          {banners}
          {sites.length === 0 ? (
            onboarding
          ) : (
            <>
              <div className="space-y-3 md:hidden">
                {sites.map((site) => (
                  <div key={site.id} className={cn("space-y-4 rounded-xl border p-4", activeSiteId === site.id ? "border-primary/30 bg-primary/[0.03]" : "border-border")}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <SiteAvatar site={site} className="size-10" />
                        <div className="min-w-0">
                          <div className="break-words font-heading text-base font-semibold">{site.name}</div>
                          <div className="mt-0.5 break-all text-sm text-muted-foreground">{site.domain || "Add a website address"}</div>
                        </div>
                      </div>
                      {activeSiteId === site.id ? <Badge variant="good">Active</Badge> : <Badge variant="outline">Available</Badge>}
                    </div>
                    <ScanPlanSummary site={site} compact />
                    {site.notes ? <p className="text-sm leading-6 text-muted-foreground">{site.notes}</p> : null}
                    {siteActions(site, "mobile")}
                  </div>
                ))}
              </div>
              <div className="-mx-5 -mb-5 hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-5">Site</TableHead>
                      <TableHead>Scan plan</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="pr-5 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sites.map((site) => (
                      <TableRow key={site.id} className={activeSiteId === site.id ? "bg-primary/[0.04]" : ""}>
                        <TableCell className="min-w-64 pl-5">
                          <div className="flex items-center gap-3">
                            <SiteAvatar site={site} className="size-9" />
                            <div className="min-w-0">
                              <div className="font-medium">{site.name}</div>
                              <div className="text-xs text-muted-foreground">{site.domain || "Add a website address"}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="min-w-56">
                          <ScanPlanSummary site={site} compact />
                        </TableCell>
                        <TableCell className="max-w-md">
                          <div className="line-clamp-2 text-sm text-muted-foreground">{site.notes || "No notes yet."}</div>
                        </TableCell>
                        <TableCell>{activeSiteId === site.id ? <Badge variant="good">Active</Badge> : <Badge variant="outline">Available</Badge>}</TableCell>
                        <TableCell className="pr-5">{siteActions(site)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </div>
      </section>
      {addDialog}
      {editDialog}
      {deleteDialog}
    </>
  );
}
