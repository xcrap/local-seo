import { useEffect, useState, type SyntheticEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowUpRight, CheckCircle2, ExternalLink, FileSearch, ListChecks, Plus, Trash2 } from "lucide-react";
import { api, type Site } from "../../api";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Badge, Button, Popover, PopoverContent, PopoverTrigger, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Input, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tabs, TabsContent, TabsList, TabsTrigger, ToggleGroup, ToggleGroupItem, toast } from "@/components/ui";
import { CountUp, EmptyState, Field, FilteredRows, Hint, IndexabilityBadge, LengthBadge, MetricTile, MetricTileGrid, MetricTileProps, PageHeader, ProgressBar, ReportSection, ScanCheckRowModel, ScanCheckSectionModel, ScanLinksTable, ScoreDial, StatusDot, StatusEvidenceTable, clearSelectedScanId, formatBytes, formatDate, formatMs, formatNumber, getSelectedScanId, issueCategoryLabel, issueTypeCount, issueTypesCount, JsonBlock, pageH1Status, pageIssueTypeCount, pageIssueTypesCount, preferredScanUrl, scanCoverageMetrics, scanIsActive, scanPhaseKey, scanPhaseLabel, scanProgress, scanSeverityCounts, scanStatusLabel, scanSiteName, scanUrlShortDetail, scoreTone, scoreVerdict, setSelectedScanId, sortScanRows, upsertScanRow } from "../shared";
import { cn } from "@/lib/utils";

function scanStatusTone(status?: string): "good" | "warn" | "bad" {
  if (status === "completed") return "good";
  if (status === "failed") return "bad";
  return "warn";
}

export function ScanReportRoute({ activeSiteId }: { activeSiteId?: string }) {
  const { scanId } = useParams();
  const navigate = useNavigate();
  const [scan, setReportScan] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let interval: number | undefined;
    async function load() {
      if (!scanId) return;
      setError("");
      try {
        const row = await api.scan(scanId);
        if (!cancelled) {
          if (row?.site_id && activeSiteId && row.site_id !== activeSiteId) {
            navigate("/scans", { replace: true });
            return;
          }
          setReportScan(row);
          if (!row) {
            clearSelectedScanId();
            if (interval) {
              window.clearInterval(interval);
              interval = undefined;
            }
            return;
          }
          setSelectedScanId(row.site_id, row.id);
          if (row.status !== "queued" && row.status !== "running" && interval) {
            window.clearInterval(interval);
            interval = undefined;
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load scan report");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    setLoading(true);
    load().catch(console.error);
    interval = window.setInterval(() => {
      if (!scanId) return;
      load().catch(console.error);
    }, 1500);
    return () => {
      cancelled = true;
      if (interval) window.clearInterval(interval);
    };
  }, [scanId, activeSiteId, navigate]);

  return (
    <>
      <PageHeader
        title="Scan report"
        description="Technical evidence, broken assets, metadata, indexability, and fixes from this saved local scan."
        meta={scan ? (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="min-w-0 max-w-full break-all">{scan.url}</span>
            <span className="text-border">·</span>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <StatusDot tone={scanStatusTone(scan.status)} />
              {scanStatusLabel(scan.status)} · {formatDate(scan.created_at || scan.updated_at)} · stored locally
            </span>
          </span>
        ) : undefined}
        action={<Button asChild variant="outline"><Link to="/scans"><FileSearch /> Back to scans</Link></Button>}
      />
      {error ? <p className="rounded-lg bg-bad-soft/50 px-3.5 py-2.5 text-sm text-destructive">{error}</p> : null}
      {loading ? (
        <ScanReportSkeleton />
      ) : scan ? (
        <ScanDetail scan={scan} />
      ) : (
        <EmptyState title="Scan not found" text="This saved scan no longer exists in local SQLite." action={<Button asChild><Link to="/scans"><FileSearch /> Open scans</Link></Button>} />
      )}
    </>
  );
}

export function ScansPage({ site }: { site: Site }) {
  const [url, setUrl] = useState(preferredScanUrl(site));
  const [scans, setScans] = useState<any[]>([]);
  const [allScans, setAllScans] = useState<any[]>([]);
  const [detail, setDetail] = useState<any>(null);
  const [deletingScan, setDeletingScan] = useState<any>(null);
  const [clearingScans, setClearingScans] = useState(false);
  const [confirmClearScans, setConfirmClearScans] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [showCustomUrl, setShowCustomUrl] = useState(false);
  const [manualLedgerScanId, setManualLedgerScanId] = useState("");
  const [manualLedgerSiteId, setManualLedgerSiteId] = useState("");
  async function load() {
    const [siteRows, ledgerRows] = await Promise.all([
      api.scans(site.id),
      api.allScans(),
    ]);
    const rows = sortScanRows(siteRows);
    const ledger = sortScanRows(ledgerRows);
    setScans(rows);
    setAllScans(ledger);
    const currentDetail = detail?.id ? ledger.find((row) => row.id === detail.id) : null;
    const currentDetailBelongsToSite = currentDetail?.site_id === site.id;
    const manualScan = manualLedgerScanId && manualLedgerSiteId === site.id
      ? ledger.find((row) => row.id === manualLedgerScanId)
      : null;
    const selectedScanId = getSelectedScanId(site.id);
    const selectedScan = selectedScanId ? rows.find((row) => row.id === selectedScanId) : null;
    const nextDetail = manualScan || (currentDetailBelongsToSite ? currentDetail : null) || selectedScan || rows[0] || null;
    setDetail(nextDetail);
    if (nextDetail?.id) setSelectedScanId(nextDetail.site_id || site.id, nextDetail.id);
    else clearSelectedScanId(site.id);
    if (manualLedgerScanId && !manualScan) {
      setManualLedgerScanId("");
      setManualLedgerSiteId("");
    }
    return rows;
  }
  useEffect(() => {
    load().catch(console.error);
  }, [site.id]);
  useEffect(() => {
    setUrl(preferredScanUrl(site));
    setError("");
    setShowCustomUrl(false);
  }, [site.id, site.domain, site.crawl_protocol, site.crawl_host]);
  useEffect(() => {
    const hasActiveScan = allScans.some(scanIsActive);
    if (!hasActiveScan) return;
    const interval = window.setInterval(() => {
      load().catch(console.error);
    }, 1500);
    return () => window.clearInterval(interval);
  }, [site.id, allScans, detail?.id]);
  useEffect(() => {
    if (!detail?.id || !scanIsActive(detail)) return;
    let cancelled = false;
    async function refreshSelectedScan() {
      try {
        const nextScan = await api.scan(detail.id);
        if (cancelled || !nextScan) return;
        if (nextScan.site_id && nextScan.site_id !== site.id) return;
        setDetail(nextScan);
        setScans((rows) => upsertScanRow(rows, nextScan));
        setAllScans((rows) => upsertScanRow(rows, nextScan));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not refresh scan progress");
      }
    }
    const interval = window.setInterval(() => {
      refreshSelectedScan().catch(console.error);
    }, 1000);
    refreshSelectedScan().catch(console.error);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [detail?.id, detail?.status, site.id]);
  async function start(event: SyntheticEvent) {
    event.preventDefault();
    setError("");
    setStarting(true);
    setManualLedgerScanId("");
    setManualLedgerSiteId("");
    try {
      const scan = await api.startScan({ siteId: site.id, url });
      setDetail(scan);
      setScans((rows) => upsertScanRow(rows, scan));
      setAllScans((rows) => upsertScanRow(rows, scan));
      if (scan?.id) setSelectedScanId(site.id, scan.id);
      setShowCustomUrl(false);
      load().catch(console.error);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start scan");
    } finally {
      setStarting(false);
    }
  }
  async function startSelectedSite() {
    if (!site.domain) return;
    setError("");
    setStarting(true);
    setManualLedgerScanId("");
    setManualLedgerSiteId("");
    try {
      const result = await api.scanSite(site.id);
      setDetail(result.scan);
      setScans((rows) => upsertScanRow(rows, result.scan));
      setAllScans((rows) => upsertScanRow(rows, result.scan));
      if (result.scan?.id) setSelectedScanId(site.id, result.scan.id);
      load().catch(console.error);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start site scan");
    } finally {
      setStarting(false);
    }
  }
  async function inspect(id: string, row?: any) {
    setManualLedgerScanId(id);
    setManualLedgerSiteId(site.id);
    setSelectedScanId(row?.site_id || site.id, id);
    setDetail(await api.scan(id));
  }
  async function remove(id: string, row?: any) {
    const siteId = row?.site_id || site.id;
    setError("");
    try {
      await api.deleteScan(siteId, id);
      if (getSelectedScanId(siteId) === id) {
        clearSelectedScanId(siteId);
      }
      if (detail?.id === id) setDetail(null);
      if (manualLedgerScanId === id) {
        setManualLedgerScanId("");
        setManualLedgerSiteId("");
      }
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete the saved scan.");
    } finally {
      setDeletingScan(null);
    }
  }
  async function clearHistory() {
    setError("");
    setClearingScans(true);
    try {
      await api.clearScans(site.id);
      clearSelectedScanId(site.id);
      setManualLedgerScanId("");
      setManualLedgerSiteId("");
      setDetail(null);
      setConfirmClearScans(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clear scan history");
    } finally {
      setClearingScans(false);
    }
  }
  return (
    <>
      <PageHeader
        title="Site scans"
        description="Scan the active site's saved crawl URL and open the report when it completes."
        meta={site.domain ? (
          <span className="flex flex-wrap items-center gap-x-2">
            <span>{site.domain}</span>
            <span className="text-border">·</span>
            <Hint tip={`Crawl starts at ${preferredScanUrl(site)}`}>{scanUrlShortDetail(site)}</Hint>
          </span>
        ) : (
          "No website address yet"
        )}
        action={
          <>
            {site.domain ? (
              <Button disabled={starting} onClick={startSelectedSite}>
                <FileSearch /> {starting ? "Starting" : `Scan ${site.domain}`}
              </Button>
            ) : (
              <Button asChild><Link to="/"><Plus /> Add site</Link></Button>
            )}
            <Popover open={showCustomUrl} onOpenChange={setShowCustomUrl}>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline">Specific URL</Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)]">
                <form className="space-y-3" onSubmit={start}>
                  <Field label="URL to scan">
                    <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={`${preferredScanUrl(site) || "https://example.com"}/page`} />
                  </Field>
                  <Button className="w-full" variant="secondary" disabled={starting || !url.trim()}>
                    <FileSearch /> {starting ? "Starting" : "Scan URL"}
                  </Button>
                </form>
              </PopoverContent>
            </Popover>
          </>
        }
      />
      {error ? (
        <p className="mb-6 rounded-lg bg-bad-soft/50 px-3.5 py-2.5 text-sm text-destructive">{error}</p>
      ) : null}
      <div className="space-y-8">
        <section>
          <div className="mb-4 flex flex-wrap items-baseline gap-2.5">
            <h2 className="font-heading text-lg leading-tight">Scan report</h2>
            {detail ? (
              <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
                <StatusDot tone={scanStatusTone(detail.status)} />
                {scanStatusLabel(detail.status)} · {formatDate(detail.created_at || detail.updated_at)}
              </span>
            ) : null}
          </div>
          {detail ? <ScanDetail scan={detail} /> : (
            <TabCard>
              <EmptyState
                title={scans.length ? "No scan report open for this site" : "No scan report yet"}
                text={scans.length ? "Every saved scan for this site is still listed below. Open a row to view it, or run a new scan." : "Start a local site scan to fill this report with crawl evidence."}
                action={
                  !scans.length
                    ? site.domain
                      ? (
                        <Button onClick={startSelectedSite} disabled={starting}>
                          <FileSearch /> {starting ? "Starting" : "Scan website"}
                        </Button>
                      )
                      : <Button asChild><Link to="/"><Plus /> Add site</Link></Button>
                    : undefined
                }
              />
            </TabCard>
          )}
        </section>
        <ReportSection
          title="Scan history"
          meta={`${formatNumber(scans.length)} for this site · ${formatNumber(allScans.length)} total in the local database`}
          action={scans.length ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-muted-foreground hover:text-bad"
              onClick={() => setConfirmClearScans(true)}
              disabled={clearingScans}
            >
              <Trash2 /> Delete scans for this site
            </Button>
          ) : undefined}
        >
          {scans.length ? (
            <ScanTable rows={scans} activeSiteId={site.id} selectedId={detail?.id} onInspect={inspect} onDelete={(id) => setDeletingScan(scans.find((scan) => scan.id === id) || { id })} />
          ) : (
            <EmptyState
              title="No scans yet"
              text={site.domain ? "Start a technical scan for this site." : "Add a website address before running a scan."}
              action={site.domain ? (
                <Button onClick={startSelectedSite} disabled={starting}>
                  <FileSearch /> {starting ? "Starting" : "Scan website"}
                </Button>
              ) : (
                <Button asChild><Link to="/"><Plus /> Add site</Link></Button>
              )}
            />
          )}
        </ReportSection>
      </div>
      <AlertDialog open={Boolean(deletingScan)} onOpenChange={(nextOpen) => !nextOpen && setDeletingScan(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete scan?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the saved report for {deletingScan?.url || "this scan"} from local SQLite. Other scans for the same site stay available.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction type="button" onClick={() => deletingScan && remove(deletingScan.id, deletingScan)}>
              Delete scan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={confirmClearScans} onOpenChange={setConfirmClearScans}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete scans for this site?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes all saved scan reports for {site.domain || site.name} from local SQLite. The saved site, keywords, rankings, and settings stay in place.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearingScans}>Keep scans</AlertDialogCancel>
            <AlertDialogAction type="button" onClick={clearHistory} disabled={clearingScans}>
              {clearingScans ? "Deleting scans" : "Delete scans for this site"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function ScanTable({
  rows,
  showSite,
  activeSiteId,
  selectedId,
  onInspect,
  onDelete,
}: {
  rows: any[];
  showSite?: boolean;
  activeSiteId?: string;
  selectedId?: string;
  onInspect?: (id: string, row: any) => void;
  onDelete?: (id: string, row: any) => void;
}) {
  return (
    <div className="divide-y divide-border/60">
      {rows.map((row) => {
        const counts = scanSeverityCounts(row);
        const running = scanIsActive(row);
        const completed = row.status === "completed";
        const score = Number(row.score || 0);
        const showSiteName = Boolean(showSite && (!activeSiteId || row.site_id !== activeSiteId));
        const scanCell = (
          <>
            <div className="truncate font-medium">{row.url}</div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {formatDate(row.created_at || row.updated_at)}
              {showSiteName ? ` · ${scanSiteName(row)}` : ""}
            </div>
          </>
        );
        const rowContent = (
          <>
            {onInspect ? (
              <button
                type="button"
                className="min-w-0 flex-1 cursor-pointer rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                title={`Open scan report for ${row.url}`}
                onClick={() => onInspect(row.id, row)}
              >
                {scanCell}
              </button>
            ) : (
              <div className="min-w-0 flex-1">{scanCell}</div>
            )}
            {running ? (
              <div className="w-28 shrink-0">
                <div className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
                  <StatusDot tone="warn" /> {scanPhaseLabel(row)}
                </div>
                <div className="mt-1.5"><ProgressBar value={scanProgress(row)} /></div>
              </div>
            ) : completed ? (
              <div className="flex shrink-0 items-baseline gap-2.5">
                <span className="metric w-12 shrink-0 text-right text-xl leading-none" style={{ color: scoreTone(score) }}>{formatNumber(score)}</span>
                <span className="w-56 shrink-0 truncate whitespace-nowrap text-xs text-muted-foreground">
                  {formatNumber(counts.high)} high · {formatNumber(counts.medium)} med · {formatNumber(counts.low)} low · {formatNumber(row.pages_crawled || 0)} pages
                </span>
              </div>
            ) : (
              <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs font-medium">
                <StatusDot tone={scanStatusTone(row.status)} /> {scanStatusLabel(row.status)}
              </span>
            )}
            {(onInspect || onDelete) ? (
              <div className="flex shrink-0 items-center">
                {onInspect ? (
                  <Button asChild size="icon" variant="ghost" className="size-8 text-muted-foreground hover:text-foreground">
                    <Link
                      to={`/scans/${row.id}`}
                      aria-label={`Open scan report for ${row.url}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (row.site_id) setSelectedScanId(row.site_id, row.id);
                      }}
                    >
                      <ArrowUpRight />
                    </Link>
                  </Button>
                ) : null}
                {onDelete ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8 text-muted-foreground hover:text-destructive"
                    aria-label={`Delete scan report for ${row.url}`}
                    onClick={(event) => { event.stopPropagation(); onDelete(row.id, row); }}
                  >
                    <Trash2 />
                  </Button>
                ) : null}
              </div>
            ) : null}
          </>
        );
        return (
          <div
            key={row.id}
            className={cn(
              "relative flex items-center gap-3 rounded-xl px-3 py-3 transition-colors",
              onInspect ? "hover:bg-accent/60" : "",
              selectedId === row.id
                ? "bg-accent before:absolute before:bottom-2.5 before:left-0 before:top-2.5 before:w-[3px] before:rounded-full before:bg-primary"
                : "",
            )}
          >
            {rowContent}
          </div>
        );
      })}
    </div>
  );
}

function defaultScanTab(scan: any) {
  return scanIsActive(scan) ? "progress" : "overview";
}

const scanTabValues = new Set([
  "overview",
  "progress",
  "issues",
  "checks",
  "metadata",
  "pages",
  "links",
  "images",
  "assets",
  "speed",
  "crawl",
  "raw",
]);

function scanTabFromSearch(value: string | null, scan: any) {
  return value && scanTabValues.has(value) ? value : defaultScanTab(scan);
}

function ScanDetail({ scan }: { scan: any }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = scanTabFromSearch(searchParams.get("tab"), scan);
  const [activeTab, setActiveTab] = useState(requestedTab);
  const [severityFilter, setSeverityFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selectedCheckTypes, setSelectedCheckTypes] = useState<string[]>([]);
  const [selectedCheckLabel, setSelectedCheckLabel] = useState("");
  const result = scan.result || {};
  const pages = result.pages || [];
  const issues = result.issues || [];
  const links = result.links || [];
  const linkInventory = result.linkInventory || [];
  const images = result.images || [];
  const imageInventory = result.imageInventory || [];
  const assets = result.assets || [];
  const summary = result.summary || {};
  const issueGroups = result.issueGroups || [];
  const severityCounts = scanSeverityCounts(scan);
  const coverage = scanCoverageMetrics(scan, result, summary);
  const categories = Object.keys(summary.byCategory || {}).sort();
  const issueTypes = Array.from(new Set<string>(issues.map((issue: any) => String(issue.type || "")).filter(Boolean))).sort();
  const categoryCounts: Record<string, number> = summary.byCategory || {};
  useEffect(() => {
    setActiveTab(requestedTab);
  }, [scan.id, requestedTab]);
  // Reset issue filters when a different scan is opened from the ledger, so a
  // filter from the previous scan doesn't hide the new scan's issues.
  useEffect(() => {
    setSeverityFilter("all");
    setCategoryFilter("all");
    setTypeFilter("all");
    setSelectedCheckTypes([]);
    setSelectedCheckLabel("");
  }, [scan.id]);
  const changeScanTab = (value: string) => {
    setActiveTab(value);
    const next = new URLSearchParams(searchParams);
    if (value === defaultScanTab(scan)) {
      next.delete("tab");
    } else {
      next.set("tab", value);
    }
    setSearchParams(next, { replace: true });
  };
  const showIssues = () => changeScanTab("issues");
  const selectSeverity = (severity: string) => {
    setSeverityFilter(severity);
    setCategoryFilter("all");
    setTypeFilter("all");
    setSelectedCheckTypes([]);
    setSelectedCheckLabel("");
    showIssues();
  };
  const selectCategory = (category: string) => {
    setCategoryFilter(category);
    setTypeFilter("all");
    setSelectedCheckTypes([]);
    setSelectedCheckLabel("");
    showIssues();
  };
  const selectIssueGroup = (group: any) => {
    setSeverityFilter("all");
    setCategoryFilter(group.category || "all");
    setTypeFilter(group.type || "all");
    setSelectedCheckTypes(group.type ? [group.type] : []);
    setSelectedCheckLabel(String(group.type || ""));
    showIssues();
  };
  const selectScanCheck = (row: ScanCheckRowModel) => {
    const types = row.types || [];
    setSeverityFilter("all");
    setCategoryFilter(row.category || "all");
    setTypeFilter(types.length === 1 ? types[0] : "all");
    setSelectedCheckTypes(types);
    setSelectedCheckLabel(row.label);
    showIssues();
  };
  const filteredIssues = issues.filter((issue: any) => {
    const severityOk = severityFilter === "all" || issue.severity === severityFilter;
    const categoryOk = categoryFilter === "all" || issue.category === categoryFilter;
    const typeOk = typeFilter === "all" || issue.type === typeFilter;
    const checkOk = selectedCheckTypes.length === 0 || selectedCheckTypes.includes(issue.type);
    return severityOk && categoryOk && typeOk && checkOk;
  });
  const activeIssueFilters = [
    severityFilter !== "all" ? `${severityFilter} severity` : "",
    categoryFilter !== "all" ? issueCategoryLabel(categoryFilter) : "",
    typeFilter !== "all" ? typeFilter.replaceAll("-", " ") : "",
    selectedCheckLabel,
  ].filter(Boolean);
  const resetIssueFilters = () => {
    setSeverityFilter("all");
    setCategoryFilter("all");
    setTypeFilter("all");
    setSelectedCheckTypes([]);
    setSelectedCheckLabel("");
    showIssues();
  };
  return (
    <div className="space-y-5">
      <Tabs value={activeTab} onValueChange={changeScanTab} className="space-y-4">
        <TabsList className="flex h-auto w-full justify-start overflow-x-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="progress">Progress</TabsTrigger>
          <TabsTrigger value="issues">Issues</TabsTrigger>
          <TabsTrigger value="checks">Checks</TabsTrigger>
          <TabsTrigger value="metadata">Metadata</TabsTrigger>
          <TabsTrigger value="pages">Pages</TabsTrigger>
          <TabsTrigger value="links">Links</TabsTrigger>
          <TabsTrigger value="images">Images</TabsTrigger>
          <TabsTrigger value="assets">Assets</TabsTrigger>
          <TabsTrigger value="speed">Speed</TabsTrigger>
          <TabsTrigger value="crawl">Robots/Sitemap</TabsTrigger>
          <TabsTrigger value="raw">Evidence</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="space-y-5">
          <ScanReportOverview
            scan={scan}
            result={result}
            summary={summary}
            coverage={coverage}
            severityCounts={severityCounts}
            activeSeverity={severityFilter}
            onSeveritySelect={selectSeverity}
          />
          <ScanActionBoard scan={scan} issueGroups={issueGroups} onSelectGroup={selectIssueGroup} />
        </TabsContent>
        <TabsContent value="progress">
          <ScanProgressPanel scan={scan} result={result} coverage={coverage} />
        </TabsContent>
        <TabsContent value="issues">
          <TabCard className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup
              type="single"
              value={severityFilter}
              onValueChange={(value) => selectSeverity(value || "all")}
            >
              {["all", "high", "medium", "low"].map((severity) => (
                <ToggleGroupItem key={severity} value={severity} aria-label={severity === "all" ? "All severities" : `${severity} severity`}>
                  {severity === "all" ? "All severities" : severity}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <Select value={categoryFilter} onValueChange={selectCategory}>
              <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category} value={category}>
                    {issueCategoryLabel(category)}
                    {categoryCounts[category] ? ` (${formatNumber(categoryCounts[category])})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={(value) => { setTypeFilter(value); setSelectedCheckTypes([]); setSelectedCheckLabel(""); showIssues(); }}>
              <SelectTrigger className="h-8 w-52 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All issue types</SelectItem>
                {issueTypes.map((type) => (
                  <SelectItem key={type} value={type}>{type.replaceAll("-", " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedCheckLabel ? <Badge variant="outline">Showing {selectedCheckLabel}</Badge> : null}
            <div className="ml-auto flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <span>
                Showing {formatNumber(filteredIssues.length)} of {formatNumber(issues.length)} saved issues
                {activeIssueFilters.length ? ` for ${activeIssueFilters.join(" · ")}` : ""}
              </span>
              {activeIssueFilters.length ? (
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={resetIssueFilters}>
                  Clear filters
                </Button>
              ) : null}
            </div>
          </div>
          {filteredIssues.length ? <ScanIssuesTable rows={filteredIssues} /> : <EmptyState title="No matching issues" text={scan.status === "completed" ? "This filter has no issues." : "Issues will appear while the scan runs."} />}
          </TabCard>
        </TabsContent>
        <TabsContent value="checks">
          <ScanCheckMatrix summary={summary} coverage={coverage} issues={issues} onSelectCheck={selectScanCheck} />
        </TabsContent>
        <TabsContent value="metadata">
          <TabCard>
            {pages.length ? (
              <FilteredRows rows={pages} placeholder="Filter pages…">
                {(rows) => <ScanMetadataTable rows={rows} />}
              </FilteredRows>
            ) : <EmptyState title="No metadata yet" text="Metadata appears as soon as pages are crawled." />}
          </TabCard>
        </TabsContent>
        <TabsContent value="pages">
          <TabCard>
            {pages.length ? (
              <FilteredRows rows={pages} placeholder="Filter pages…">
                {(rows) => <ScanPagesTable rows={rows} />}
              </FilteredRows>
            ) : <EmptyState title="No pages yet" text="Pages will appear while the scan runs." />}
          </TabCard>
        </TabsContent>
        <TabsContent value="links">
          <div className="space-y-4">
            {links.length ? (
              <ScanSection title="Checked links" text="Every unique HTTP URL that the crawler verified. Broken and redirecting links are highlighted in the Status column.">
                <FilteredRows rows={links} placeholder="Filter links…">
                  {(rows) => <ScanLinksTable rows={rows} />}
                </FilteredRows>
              </ScanSection>
            ) : <EmptyState title="No links checked yet" text="Links are checked after the page crawl finishes." />}
            {linkInventory.length ? (
              <ScanSection title="Link inventory" text="All link tags found during the crawl, including anchor text, rel attributes, and source page.">
                <FilteredRows rows={linkInventory} placeholder="Filter link tags…">
                  {(rows) => <ScanLinkInventoryTable rows={rows} />}
                </FilteredRows>
              </ScanSection>
            ) : null}
          </div>
        </TabsContent>
        <TabsContent value="images" className="space-y-4">
          {pages.some((page: any) => page.images > 0) ? (
            <ScanSection title="Image summary by page" text="Missing src, alt text, and size attributes grouped by affected page.">
              <FilteredRows rows={pages.filter((page: any) => page.images > 0)} placeholder="Filter pages…">
                {(rows) => <ScanImageSummaryTable rows={rows} />}
              </FilteredRows>
            </ScanSection>
          ) : null}
          {imageInventory.length ? (
            <ScanSection title="Image tag inventory" text="Every image tag collected from the crawl, including content/decorative classification and tag-level problems.">
              <FilteredRows rows={imageInventory} placeholder="Filter image tags…">
                {(rows) => <ScanImageInventoryTable rows={rows} />}
              </FilteredRows>
            </ScanSection>
          ) : null}
          {images.length ? (
            <ScanSection title="Checked image URLs" text="Image resources fetched by the crawler, including Open Graph images when present.">
              <FilteredRows rows={images} placeholder="Filter image URLs…">
                {(rows) => <ScanImagesTable rows={rows} />}
              </FilteredRows>
            </ScanSection>
          ) : <EmptyState title="No images checked yet" text="Images are checked after the page crawl finishes." />}
        </TabsContent>
        <TabsContent value="assets" className="space-y-4">
          {assets.length ? (
            <ScanSection title="Checked CSS and JavaScript" text="Stylesheet and script URLs fetched during the scan with status, content type, and size.">
              <FilteredRows rows={assets} placeholder="Filter assets…">
                {(rows) => <ScanAssetsTable rows={rows} />}
              </FilteredRows>
            </ScanSection>
          ) : <EmptyState title="No CSS or JavaScript assets checked yet" text="Assets are checked after links and images." />}
        </TabsContent>
        <TabsContent value="speed" className="space-y-4">
          <ScanSpeedReport pages={pages} issues={issues} assets={assets} summary={summary} coverage={coverage} />
        </TabsContent>
        <TabsContent value="crawl" className="space-y-4">
          <ScanCrawlEvidence result={result} coverage={coverage} />
        </TabsContent>
        <TabsContent value="raw">
          <ScanSection title="Complete scan evidence" text="The full saved crawl payload for export, debugging, and MCP/AI workflows.">
            <JsonBlock value={result} />
          </ScanSection>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function severityVariant(severity: string) {
  if (severity === "high") return "bad";
  if (severity === "medium") return "warn";
  return "outline";
}

function ScanCrawlEvidence({
  result,
  coverage,
}: {
  result: any;
  coverage: ReturnType<typeof scanCoverageMetrics>;
}) {
  const sitemapRows = Array.isArray(result.sitemap?.sitemaps) ? result.sitemap.sitemaps : [];
  const evidenceRows = [
    {
      area: "Robots.txt",
      status: result.robots?.exists ? "Found" : "Missing",
      tone: result.robots?.exists ? "good" : "warn",
      evidence: result.robots?.url || `${result.origin || result.startUrl || ""}/robots.txt`,
    },
    {
      area: "Disallow rules",
      status: formatNumber(result.robots?.disallowCount || 0),
      tone: "outline",
      evidence: "Rules discovered in robots.txt.",
    },
    {
      area: "Sitemaps declared",
      status: formatNumber(result.robots?.sitemaps?.length || 0),
      tone: result.robots?.sitemaps?.length ? "good" : "warn",
      evidence: result.robots?.sitemaps?.length ? result.robots.sitemaps.join(", ") : "No sitemap directive found in robots.txt.",
    },
    {
      area: "Sitemap URLs found",
      status: formatNumber(result.sitemap?.urls?.length || 0),
      tone: result.sitemap?.urls?.length ? "good" : "warn",
      evidence: "URLs loaded from sitemap files and used for crawl discovery.",
    },
  ];
  const coverageRows = [
    { metric: "Pages crawled", count: coverage.pages, detail: `${formatNumber(coverage.sitemapUrls)} sitemap-listed pages` },
    { metric: "Indexable pages", count: coverage.indexablePages, detail: `${formatNumber(coverage.nonIndexablePages)} noindex/non-indexable · ${formatNumber(coverage.unknownIndexabilityPages)} unknown` },
    { metric: "Missing from sitemap", count: coverage.pagesMissingFromSitemap, detail: "Indexable crawled pages not listed in XML sitemaps", problem: true },
    { metric: "Noindex in sitemap", count: coverage.noindexPagesInSitemap, detail: "Non-indexable pages that still appear in XML sitemaps", problem: true },
    { metric: "Orphan pages", count: coverage.orphanPages, detail: "Sitemap-discovered pages with no internal inlinks", problem: true },
    { metric: "Deep pages", count: coverage.deepPages, detail: "Pages at crawl depth 4 or deeper", problem: true },
    { metric: "Link tags found", count: coverage.linkTags, detail: `${formatNumber(coverage.checkedLinks)} unique link URLs checked` },
    { metric: "Parameterized URLs", count: coverage.parameterUrls, detail: `${formatNumber(coverage.parameterUrlTargets)} clean page targets. Query variants are checked as links, not counted as separate pages.` },
    { metric: "Image tags found", count: coverage.imageTags, detail: `${formatNumber(coverage.checkedImages)} image URLs checked` },
    { metric: "CSS/JS refs found", count: coverage.assetTags, detail: `${formatNumber(coverage.checkedAssets)} CSS/JS assets checked` },
  ];
  return (
    <div className="space-y-4">
      <ReportSection title="Robots and sitemap evidence" description="What the crawler actually discovered before and during the page crawl.">
        <StatusEvidenceTable
          rows={evidenceRows.map((row) => ({
            title: row.area,
            status: row.status,
            tone: row.tone as any,
            text: <span className="break-all">{row.evidence}</span>,
          }))}
        />
      </ReportSection>

      <ReportSection title="Sitemap files" description="Each sitemap file fetched and parsed during the scan.">
        {sitemapRows.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sitemap</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>URLs</TableHead>
                <TableHead>Child sitemaps</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sitemapRows.map((sitemap: any) => (
                <TableRow key={sitemap.url}>
                  <TableCell className="min-w-96 break-all font-medium">{sitemap.url}</TableCell>
                  <TableCell><Badge variant={sitemap.ok === false ? "bad" : "good"}>{sitemap.status || "-"}</Badge></TableCell>
                  <TableCell><Badge variant="outline">{sitemap.type || "-"}</Badge></TableCell>
                  <TableCell className="nums text-lg font-semibold">{formatNumber(sitemap.urlCount || 0)}</TableCell>
                  <TableCell className="nums">{formatNumber(sitemap.childSitemapCount || 0)}</TableCell>
                  <TableCell className="max-w-md break-all text-sm text-muted-foreground">{sitemap.error || "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState title="No sitemap files parsed" text="The crawler did not find a sitemap file for this scan." />
        )}
      </ReportSection>

      <ReportSection title="Crawl coverage" description="Page discovery, indexability, sitemap fit, and resource inventory from this scan.">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Metric</TableHead>
              <TableHead>Count</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Evidence</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {coverageRows.map((row) => {
              const count = Number(row.count || 0);
              const tone = row.problem ? (count ? "warn" : "good") : "outline";
              return (
                <TableRow key={row.metric}>
                  <TableCell className="font-medium">{row.metric}</TableCell>
                  <TableCell className="metric text-lg">{formatNumber(row.count)}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm">
                      <StatusDot tone={tone as any} />
                      {row.problem ? (count ? "inspect" : "clear") : "measured"}
                    </span>
                  </TableCell>
                  <TableCell className="min-w-96 text-sm text-muted-foreground">{row.detail}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </ReportSection>
    </div>
  );
}

type ScanStepState = "complete" | "running" | "pending" | "failed";

function scanStepIndex(scan: any) {
  const order: Record<string, number> = {
    resolve: 0,
    queued: 0,
    robots: 1,
    crawl: 2,
    links: 3,
    images: 4,
    assets: 5,
    report: 6,
    completed: 6,
    failed: 0,
  };
  const key = scanPhaseKey(scan);
  if (key === "failed") {
    const phase = String(scan?.result?.phase || scan?.result?.summary?.phase || "").toLowerCase();
    if (phase.includes("deduplicating")) return 6;
    if (phase.includes("assets")) return 5;
    if (phase.includes("images") || phase.includes("css images")) return 4;
    if (phase.includes("links")) return 3;
    if (phase.includes("crawl")) return 2;
    if (phase.includes("robots")) return 1;
  }
  return order[key] ?? 0;
}

function scanStepState(scan: any, index: number): ScanStepState {
  if (scan?.status === "completed") return "complete";
  const activeIndex = scanStepIndex(scan);
  if (scan?.status === "failed") return index < activeIndex ? "complete" : index === activeIndex ? "failed" : "pending";
  if (index < activeIndex) return "complete";
  if (index === activeIndex) return "running";
  return "pending";
}

const scanStepStatusLabel: Record<ScanStepState, string> = {
  complete: "Done",
  running: "Running",
  pending: "Pending",
  failed: "Failed",
};

const scanStepStatusTone: Record<ScanStepState, "good" | "warn" | "bad" | "outline"> = {
  complete: "good",
  running: "warn",
  pending: "outline",
  failed: "bad",
};

function ScanProgressPanel({
  scan,
  result,
  coverage,
}: {
  scan: any;
  result: any;
  coverage: ReturnType<typeof scanCoverageMetrics>;
}) {
  const robotsFound = result.robots?.exists ? "robots.txt found" : "robots.txt missing";
  const sitemapFiles = Array.isArray(result.sitemap?.sitemaps) ? result.sitemap.sitemaps.length : 0;
  const progress = scanProgress(scan);
  const steps = [
    {
      label: "Resolve start URL",
      detail: result.startUrl || scan.url,
      evidence: "Saved scan URL and crawl scope.",
    },
    {
      label: "Read robots and sitemap",
      detail: `${robotsFound} · ${formatNumber(sitemapFiles)} sitemap files`,
      evidence: `${formatNumber(coverage.sitemapUrls)} sitemap URLs available for discovery.`,
    },
    {
      label: "Crawl pages",
      detail: `${formatNumber(coverage.pages)} pages crawled`,
      evidence: `${formatNumber(coverage.linkTags)} link tags · ${formatNumber(coverage.imageTags)} image tags · ${formatNumber(coverage.assetTags)} CSS/JS refs.`,
    },
    {
      label: "Check links",
      detail: `${formatNumber(coverage.checkedLinks)} unique URLs checked`,
      evidence: `${formatNumber(coverage.brokenLinks)} failing · ${formatNumber(coverage.redirectedLinks)} redirecting.`,
    },
    {
      label: "Check images",
      detail: `${formatNumber(coverage.checkedImages)} image URLs checked`,
      evidence: `${formatNumber(coverage.brokenImages)} failing · ${formatNumber(coverage.redirectedImages)} redirecting · ${formatNumber(coverage.largeImages)} large.`,
    },
    {
      label: "Check CSS/JS",
      detail: `${formatNumber(coverage.checkedAssets)} assets checked`,
      evidence: `${formatNumber(coverage.brokenAssets)} failing · ${formatNumber(coverage.cssImageResources)} CSS image URLs found.`,
    },
    {
      label: "Build report",
      detail: scan.status === "completed" ? `Score ${formatNumber(scan.score || 0)}` : scan.status === "failed" ? "Report did not finish" : "Grouping issues",
      evidence: `${formatNumber(scan.issue_count || 0)} issues saved in local SQLite.`,
    },
  ];
  return (
    <ReportSection
      title="Scan progress"
      meta={`${scanPhaseLabel(scan)} · ${formatNumber(coverage.pages)} pages · ${formatNumber(scan.issue_count || 0)} issues`}
    >
      <div className="space-y-2">
        <ProgressBar value={progress} />
        <div className="flex flex-col gap-1 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span className="break-all">{result.startUrl || scan.url}</span>
          <span className="nums">{formatNumber(progress)}%</span>
        </div>
      </div>
      <div className="mt-4">
        <StatusEvidenceTable
          rows={steps.map((step, index) => {
            const state = scanStepState(scan, index);
            return {
              title: step.label,
              status: scanStepStatusLabel[state],
              tone: scanStepStatusTone[state],
              text: <span className="break-words">{step.detail} — {step.evidence}</span>,
            };
          })}
        />
      </div>
    </ReportSection>
  );
}

function ScanReportOverview({
  scan,
  result,
  summary,
  coverage,
  severityCounts,
  activeSeverity,
  onSeveritySelect,
}: {
  scan: any;
  result: any;
  summary: any;
  coverage: ReturnType<typeof scanCoverageMetrics>;
  severityCounts: { high: number; medium: number; low: number };
  activeSeverity: string;
  onSeveritySelect: (severity: string) => void;
}) {
  const isActive = scanIsActive(scan);
  const isCompleted = scan.status === "completed";
  const isFailed = scan.status === "failed";
  const finalScore = Number(scan.score || 0);
  const progress = scanProgress(scan);
  const dialColor = isFailed ? "var(--bad)" : isActive ? "var(--primary)" : undefined;
  const sourceUrl = result.startUrl || scan.url;
  const metaIssues = Number(summary.missingTitles || 0) + Number(summary.missingDescriptions || 0);
  const imageAltIssues = Number(summary.missingAlt || 0) + Number(summary.imagesMissingDimensions || 0);
  const resourceFailures = coverage.brokenLinks || coverage.brokenImages || coverage.brokenAssets;

  const tiles: MetricTileProps[] = [
    {
      label: "Pages crawled",
      value: <CountUp value={coverage.pages} />,
      hint: `${formatNumber(coverage.indexablePages)} indexable · ${formatNumber(coverage.nonIndexablePages)} noindex · ${formatNumber(coverage.sitemapUrls)} in sitemap`,
    },
    {
      label: "Links checked",
      value: <CountUp value={coverage.checkedLinks} />,
      tone: coverage.brokenLinks ? "bad" : "default",
      hint: `${formatNumber(coverage.brokenLinks)} broken · ${formatNumber(coverage.redirectedLinks)} redirecting`,
    },
    {
      label: "Images checked",
      value: <CountUp value={coverage.checkedImages} />,
      tone: coverage.brokenImages ? "bad" : coverage.largeImages ? "warn" : "default",
      hint: `${formatNumber(coverage.brokenImages)} broken · ${formatNumber(coverage.largeImages || 0)} large`,
    },
    {
      label: "Avg response",
      value: coverage.measuredPageLoads ? <CountUp value={coverage.averagePageLoadMs} format={formatMs} /> : "—",
      tone: coverage.verySlowPages ? "bad" : coverage.slowPages ? "warn" : "default",
      hint: coverage.measuredPageLoads
        ? `p95 ${formatMs(coverage.p95PageLoadMs)} · ${formatNumber(coverage.slowPages)} slow pages`
        : "No timing captured yet",
    },
    {
      label: "Metadata gaps",
      value: <CountUp value={metaIssues} />,
      tone: metaIssues ? "warn" : "default",
      hint: `${formatNumber(summary.titleLengthIssues || 0)} title · ${formatNumber(summary.descriptionLengthIssues || 0)} description length`,
    },
    {
      label: "Image alt/size",
      value: <CountUp value={imageAltIssues} />,
      tone: imageAltIssues ? "warn" : "default",
      hint: `${formatNumber(summary.imagesMissingLazyLoading || 0)} lazy · ${formatNumber(summary.cssImageResources || 0)} CSS images`,
    },
  ];

  return (
    <ReportSection
      title={isActive ? "Live scan progress" : "Scan health"}
      description={
        isActive
          ? undefined
          : "The percentage of crawled pages without high-severity issues. Medium and low findings are listed for review but never lower the score."
      }
    >
      <div className="grid gap-6 xl:grid-cols-[248px_minmax(0,1fr)]">
        <div className="flex flex-col items-center gap-4 pb-6 text-center xl:pb-0 xl:pr-6">
          <ScoreDial
            score={isCompleted || isFailed ? finalScore : progress}
            size={148}
            color={dialColor}
            suffix={isActive ? "%" : undefined}
            label={isCompleted ? scoreVerdict(finalScore) : isFailed ? "score" : "progress"}
          />
          {isActive ? (
            <div className="w-full space-y-2">
              <ProgressBar value={progress} />
              <p className="text-xs leading-5 text-muted-foreground">The final health score appears after the crawl, resource checks, and report build finish.</p>
            </div>
          ) : (
            <div className="w-full space-y-3">
              <div className="flex items-start justify-center gap-7">
                {[
                  { key: "high", label: "High", count: severityCounts.high, labelClass: "text-bad" },
                  { key: "medium", label: "Medium", count: severityCounts.medium, labelClass: "text-warn" },
                  { key: "low", label: "Low", count: severityCounts.low, labelClass: "text-muted-foreground" },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => onSeveritySelect(item.key)}
                    className="group rounded-md text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  >
                    <span className="metric block text-xl leading-none">
                      <CountUp value={item.count} />
                    </span>
                    <span
                      className={cn(
                        "mt-1 block text-[11px] font-semibold uppercase tracking-[0.08em] underline-offset-4 transition-colors",
                        item.labelClass,
                        activeSeverity === item.key ? "underline decoration-2" : "group-hover:underline",
                      )}
                    >
                      {item.label}
                    </span>
                  </button>
                ))}
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                <Hint tip="Tap a severity to filter the issue list.">
                  {formatNumber(scan.issue_count || 0)} issues · {formatNumber(coverage.pages)} pages
                </Hint>
              </p>
            </div>
          )}
          {scan.error ? <p className="w-full rounded-lg bg-bad-soft/60 p-3 text-left text-xs text-destructive">{scan.error}</p> : null}
        </div>

        <div className="space-y-3">
          <MetricTileGrid>
            {tiles.map((tile) => (
              <MetricTile key={tile.label} {...tile} />
            ))}
          </MetricTileGrid>
          <p className="text-xs leading-5 text-muted-foreground">
            {resourceFailures
              ? `Resource failures detected — ${formatNumber(coverage.brokenLinks)} links, ${formatNumber(coverage.brokenImages)} images and ${formatNumber(coverage.brokenAssets)} assets need attention. `
              : "All checked links, images and assets responded. "}
            Crawl started at <span className="break-all font-medium">{sourceUrl}</span>.
          </p>
        </div>
      </div>
    </ReportSection>
  );
}

function ScanActionBoard({
  scan,
  issueGroups,
  onSelectGroup,
}: {
  scan: any;
  issueGroups: any[];
  onSelectGroup: (group: any) => void;
}) {
  const priorityGroups = issueGroups
    .filter((group) => group.severity === "high" || group.severity === "medium")
    .sort((a, b) => (a.severity === b.severity ? Number(b.count || 0) - Number(a.count || 0) : a.severity === "high" ? -1 : 1));
  return (
    <ReportSection
      title="Fix first"
      description="Grouped issues with the highest crawl and search impact — ranked by severity, then reach."
    >
      {priorityGroups.length ? (
        <div className="divide-y divide-border/60">
          {priorityGroups.map((group, index) => (
            <div key={group.key} className="flex flex-col gap-4 py-5 first:pt-0 last:pb-0 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 gap-4">
                <div className="metric flex size-7.5 shrink-0 items-center justify-center rounded-[9px] border border-border/70 bg-muted text-[13px] text-muted-foreground">
                  {index + 1}
                </div>
                <div className="min-w-0">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2.5">
                    <Badge variant={severityVariant(group.severity) as any} className="text-[10.5px] font-semibold uppercase tracking-[0.06em]">
                      {group.severity}
                    </Badge>
                    <span className="text-[15px] font-semibold leading-snug tracking-[-0.01em]">{group.message}</span>
                  </div>
                  <p className="max-w-3xl text-[13px] leading-5 text-muted-foreground">{group.recommendation}</p>
                  <p className="mt-1 text-[11.5px] text-muted-foreground/60">
                    {issueCategoryLabel(group.category)} · {String(group.type || "").replaceAll("-", " ")}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-4 lg:flex-col lg:items-end lg:gap-3">
                <div className="text-right leading-none">
                  <div className="metric text-[26px] font-bold"><CountUp value={group.count} /></div>
                  <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Affected</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => onSelectGroup(group)}>
                  Show issues
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={CheckCircle2}
          title="No priority blockers"
          text={scan.status === "completed" ? "High and medium issue groups are clear. Nice work." : "Priority issues appear while the scan runs."}
        />
      )}
    </ReportSection>
  );
}

const speedIssueTypes = [
  "slow-page",
  "page-response-slow",
  "viewport-missing",
  "viewport-not-responsive",
  "heavy-html",
  "html-compression-missing",
  "image-lazy-loading-missing",
  "broken-css",
  "broken-javascript",
  "css-invalid-content-type",
  "javascript-invalid-content-type",
  "large-css",
  "large-javascript",
  "render-blocking-javascript",
  "too-many-assets",
];

function speedVariant(loadMs: unknown) {
  const value = Number(loadMs);
  if (!Number.isFinite(value)) return "outline";
  if (value > 4000) return "bad";
  if (value > 2000) return "warn";
  return "good";
}

function ScanSpeedReport({
  pages,
  issues,
  assets,
  summary,
  coverage,
}: {
  pages: any[];
  issues: any[];
  assets: any[];
  summary: any;
  coverage: ReturnType<typeof scanCoverageMetrics>;
}) {
  const timedPages = [...pages]
    .filter((page) => Number.isFinite(Number(page.loadMs)))
    .sort((a, b) => Number(b.loadMs || 0) - Number(a.loadMs || 0));
  const speedIssues = issues.filter((issue) =>
    issue.category === "performance" ||
    issue.category === "assets" ||
    speedIssueTypes.includes(String(issue.type || "")),
  );
  return (
    <div className="space-y-4">
      <ReportSection
        title="Page speed evidence"
        description="Crawler response timings, HTML weight, compression, and performance issues from this scan."
      >
        <StatusEvidenceTable
          rows={[
            {
              title: "Measured pages",
              status: formatNumber(coverage.measuredPageLoads),
              tone: coverage.measuredPageLoads ? "good" : "outline",
              text: `${formatNumber(coverage.pages)} pages crawled. ${formatNumber(coverage.measuredPageLoads)} HTML responses include timing evidence.`,
            },
            {
              title: "Average response",
              status: coverage.measuredPageLoads ? formatMs(coverage.averagePageLoadMs) : "not measured",
              tone: speedVariant(coverage.averagePageLoadMs) as any,
              text: `Median ${formatMs(coverage.medianPageLoadMs)} · p95 ${formatMs(coverage.p95PageLoadMs)} · slowest ${formatMs(coverage.slowestPageLoadMs)}.`,
            },
            {
              title: "Slow pages",
              status: formatNumber(coverage.slowPages),
              tone: coverage.verySlowPages ? "bad" : coverage.slowPages ? "warn" : "good",
              text: `${formatNumber(coverage.verySlowPages)} pages above 4,000 ms. ${formatNumber(coverage.slowPages)} pages above 2,000 ms.`,
            },
            {
              title: "CSS/JS requests",
              status: formatNumber(coverage.checkedAssets),
              tone: coverage.brokenAssets ? "bad" : coverage.checkedAssets ? "good" : "outline",
              text: `${formatNumber(coverage.brokenAssets)} failing · ${formatNumber(summary.largeAssets || 0)} large · ${formatNumber(summary.renderBlockingScripts || 0)} render-blocking scripts.`,
            },
            {
              title: "Image loading",
              status: formatNumber(summary.imagesMissingLazyLoading || 0),
              tone: summary.imagesMissingLazyLoading ? "warn" : "good",
              text: "Lower-page content images without lazy loading increase page weight before users need them.",
            },
          ]}
        />
      </ReportSection>

      <ReportSection title="Page response timings" description="Slowest pages first, with response size and compression evidence.">
        {timedPages.length ? <ScanSpeedPagesTable rows={timedPages} /> : <EmptyState title="No page timings" text="Run a fresh scan to record response timing for each HTML page." />}
      </ReportSection>

      <ReportSection title="Performance issues" description="Only speed, payload, viewport, lazy-loading, and CSS/JS findings.">
        {speedIssues.length ? <ScanIssuesTable rows={speedIssues} /> : <EmptyState title="No speed issues" text="The scan did not find slow pages or performance blockers." />}
      </ReportSection>

      {assets.length ? (
        <ReportSection title="CSS and JavaScript requests" description="Fetched stylesheet and script URLs with status, type, and size.">
          <ScanAssetsTable rows={assets} />
        </ReportSection>
      ) : null}
    </div>
  );
}

function ScanSpeedPagesTable({ rows }: { rows: any[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Page</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Response</TableHead>
          <TableHead>Size</TableHead>
          <TableHead>Compression</TableHead>
          <TableHead>Timing issue</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((page) => {
          const timingIssues = pageIssueTypesCount(page, ["slow-page", "page-response-slow"]);
          return (
            <TableRow key={page.url}>
              <TableCell className="min-w-96">
                <div className="break-all font-medium">{page.finalUrl || page.url}</div>
                <div className="mt-1 text-xs text-muted-foreground">{page.title || "Untitled page"}</div>
              </TableCell>
              <TableCell><Badge variant={page.status >= 400 ? "bad" : page.status >= 300 ? "warn" : "good"}>{page.status || "-"}</Badge></TableCell>
              <TableCell><Badge variant={speedVariant(page.loadMs) as any}>{formatMs(page.loadMs)}</Badge></TableCell>
              <TableCell className="nums">{formatBytes(page.contentLength)}</TableCell>
              <TableCell><Badge variant={page.contentEncoding ? "good" : page.contentLength ? "warn" : "outline"}>{page.contentEncoding || "not advertised"}</Badge></TableCell>
              <TableCell><Badge variant={timingIssues ? "warn" : "good"}>{timingIssues ? `${formatNumber(timingIssues)} issue${timingIssues === 1 ? "" : "s"}` : "clear"}</Badge></TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function ScanCheckMatrix({
  summary,
  coverage,
  issues,
  onSelectCheck,
}: {
  summary: any;
  coverage: ReturnType<typeof scanCoverageMetrics>;
  issues: any[];
  onSelectCheck: (row: ScanCheckRowModel) => void;
}) {
  const byCategory = summary.byCategory || {};
  const sections: ScanCheckSectionModel[] = [
    {
      title: "Metadata",
      text: "Titles, descriptions, snippets",
      rows: [
        { label: "Missing titles", value: summary.missingTitles, problem: true, severity: "bad", category: "metadata", types: ["title-missing"] },
        { label: "Title length", value: summary.titleLengthIssues, problem: true, severity: "warn", category: "metadata", types: ["title-length"] },
        { label: "Multiple title tags", value: issueTypeCount(issues, "title-multiple"), problem: true, severity: "warn", category: "metadata", types: ["title-multiple"] },
        { label: "Duplicate titles", value: issueTypeCount(issues, "duplicate-title"), problem: true, severity: "warn", category: "metadata", types: ["duplicate-title"] },
        { label: "Missing descriptions", value: summary.missingDescriptions, problem: true, severity: "bad", category: "metadata", types: ["description-missing"] },
        { label: "Description length", value: summary.descriptionLengthIssues, problem: true, severity: "warn", category: "metadata", types: ["description-length"] },
        { label: "Multiple descriptions", value: issueTypeCount(issues, "description-multiple"), problem: true, severity: "warn", category: "metadata", types: ["description-multiple"] },
        { label: "Duplicate descriptions", value: issueTypeCount(issues, "duplicate-description"), problem: true, severity: "warn", category: "metadata", types: ["duplicate-description"] },
        { label: "Missing favicon", value: issueTypeCount(issues, "favicon-missing"), problem: true, severity: "warn", category: "metadata", types: ["favicon-missing"] },
      ] satisfies ScanCheckRowModel[],
    },
    {
      title: "Content",
      text: "Headings, body copy, duplication",
      rows: [
        { label: "H1 problems", value: issueTypeCount(issues, "h1-count"), problem: true, severity: "warn", category: "headings", types: ["h1-count"] },
        { label: "Empty headings", value: issueTypesCount(issues, ["h1-empty", "heading-empty"]), problem: true, severity: "warn", category: "headings", types: ["h1-empty", "heading-empty"] },
        { label: "Heading jumps", value: issueTypeCount(issues, "heading-hierarchy-jump"), problem: true, severity: "warn", category: "headings", types: ["heading-hierarchy-jump"] },
        { label: "Missing H2 sections", value: issueTypeCount(issues, "h2-missing"), problem: true, severity: "warn", category: "headings", types: ["h2-missing"] },
        { label: "Thin pages", value: summary.thinPages, problem: true, severity: "warn", category: "content", types: ["thin-content"] },
        { label: "Duplicate H1", value: summary.duplicateH1Pages, problem: true, severity: "warn", category: "headings", types: ["duplicate-h1"] },
        { label: "Duplicate content", value: summary.duplicateContentPages, problem: true, severity: "bad", category: "content", types: ["duplicate-content"] },
      ],
    },
    {
      title: "Images",
      text: "Tags, alts, sources, files",
      rows: [
        { label: "Image tags", value: coverage.imageTags },
        { label: "Checked image URLs", value: coverage.checkedImages },
        { label: "CSS images checked", value: summary.cssImageResources },
        { label: "Picture sources checked", value: summary.pictureSourceImages },
        { label: "Missing src", value: issueTypeCount(issues, "image-src-missing"), problem: true, severity: "bad", category: "images", types: ["image-src-missing"] },
        { label: "Missing picture fallback", value: issueTypeCount(issues, "image-fallback-src-missing"), problem: true, severity: "warn", category: "images", types: ["image-fallback-src-missing"] },
        { label: "Invalid srcset", value: issueTypeCount(issues, "image-srcset-invalid"), problem: true, severity: "bad", category: "images", types: ["image-srcset-invalid"] },
        { label: "Missing or empty alt", value: summary.missingAlt, problem: true, severity: "warn", category: "images", types: ["image-alt-missing", "image-alt-empty"] },
        { label: "Generic alt", value: summary.genericAlt, problem: true, severity: "warn", category: "images", types: ["image-alt-generic"] },
        { label: "Alt too long", value: summary.longAlt, problem: true, severity: "warn", category: "images", types: ["image-alt-too-long"] },
        { label: "Duplicate alt", value: issueTypeCount(issues, "image-alt-duplicate"), problem: true, severity: "warn", category: "images", types: ["image-alt-duplicate"] },
        { label: "Missing size", value: summary.imagesMissingDimensions, problem: true, severity: "warn", category: "images", types: ["image-dimensions-missing"] },
        { label: "Missing srcset", value: summary.imagesMissingSrcset, problem: true, severity: "warn", category: "images", types: ["image-srcset-missing"] },
        { label: "No lazy loading", value: summary.imagesMissingLazyLoading, problem: true, severity: "warn", category: "performance", types: ["image-lazy-loading-missing"] },
        { label: "Broken image URLs", value: coverage.brokenImages, problem: true, severity: "bad", category: "images", types: ["broken-image"] },
        { label: "Redirecting image URLs", value: coverage.redirectedImages, problem: true, severity: "warn", category: "images", types: ["image-redirects"] },
        { label: "Large images", value: coverage.largeImages, problem: true, severity: "warn", category: "images", types: ["large-image"] },
        { label: "Wrong content type", value: issueTypeCount(issues, "image-invalid-content-type"), problem: true, severity: "bad", category: "images", types: ["image-invalid-content-type"] },
        { label: "Extension mismatch", value: summary.imageExtensionMismatches, problem: true, severity: "warn", category: "images", types: ["image-extension-mismatch"] },
        { label: "Mixed image content", value: issueTypeCount(issues, "mixed-content-images"), problem: true, severity: "bad", category: "images", types: ["mixed-content-images"] },
      ],
    },
    {
      title: "Links",
      text: "URLs, anchors, redirects",
      rows: [
        { label: "Links found", value: coverage.linkTags },
        { label: "Checked links", value: coverage.checkedLinks },
        { label: "Broken links", value: coverage.brokenLinks, problem: true, severity: "bad", category: "links", types: ["broken-internal-link", "broken-external-link"] },
        { label: "Redirecting links", value: coverage.redirectedLinks, problem: true, severity: "warn", category: "links", types: ["internal-link-redirects", "external-link-redirects"] },
        { label: "Empty anchors", value: summary.emptyAnchorLinks, problem: true, severity: "warn", category: "links", types: ["empty-anchor-text"] },
        { label: "Internal nofollow", value: summary.internalNofollowLinks, problem: true, severity: "warn", category: "links", types: ["internal-nofollow"] },
        { label: "Tracked internal links", value: issueTypeCount(issues, "internal-links-with-tracking-parameters"), problem: true, severity: "warn", category: "links", types: ["internal-links-with-tracking-parameters"] },
        { label: "Mixed content links", value: issueTypeCount(issues, "mixed-content-links"), problem: true, severity: "warn", category: "links", types: ["mixed-content-links"] },
        { label: "Unsafe new-tab links", value: issueTypeCount(issues, "external-blank-missing-noopener"), problem: true, severity: "warn", category: "security", types: ["external-blank-missing-noopener"] },
        { label: "Too many links", value: issueTypeCount(issues, "too-many-links"), problem: true, severity: "warn", category: "links", types: ["too-many-links"] },
        { label: "No internal links", value: issueTypeCount(issues, "no-internal-links"), problem: true, severity: "warn", category: "links", types: ["no-internal-links"] },
      ],
    },
    {
      title: "Indexability",
      text: "Robots, canonicals, language",
      rows: [
        { label: "Noindex pages", value: issueTypeCount(issues, "noindex"), problem: true, severity: "bad", category: "indexability", types: ["noindex"] },
        { label: "Page nofollow", value: issueTypeCount(issues, "meta-robots-nofollow"), problem: true, severity: "warn", category: "indexability", types: ["meta-robots-nofollow"] },
        { label: "Snippet restrictions", value: issueTypeCount(issues, "restrictive-snippet-directive"), problem: true, severity: "warn", category: "indexability", types: ["restrictive-snippet-directive"] },
        { label: "Canonical issues", value: byCategory.canonicals, problem: true, severity: "warn", category: "canonicals", types: ["canonical-missing", "canonical-invalid", "canonical-multiple", "canonical-http-on-https", "canonical-cross-domain", "canonical-not-self"] },
        { label: "HTTP pages", value: issueTypeCount(issues, "page-not-https"), problem: true, severity: "bad", category: "security", types: ["page-not-https"] },
        { label: "Lang or charset issues", value: issueTypesCount(issues, ["html-lang-missing", "html-lang-invalid", "charset-missing"]), problem: true, severity: "warn", category: "indexability", types: ["html-lang-missing", "html-lang-invalid", "charset-missing"] },
        { label: "Hreflang issues", value: byCategory.localization, problem: true, severity: "warn", category: "localization", types: ["hreflang-invalid", "hreflang-code-invalid", "hreflang-duplicate", "hreflang-x-default-missing"] },
      ],
    },
    {
      title: "Crawl",
      text: "Sitemap, robots, discovery",
      rows: [
        { label: "Pages crawled", value: coverage.pages },
        { label: "Page crawl failures", value: issueTypesCount(issues, ["crawl-failed", "page-http-error", "non-html-page"]), problem: true, severity: "bad", category: "crawl", types: ["crawl-failed", "page-http-error", "non-html-page"] },
        { label: "Redirected pages", value: issueTypeCount(issues, "redirected-url"), problem: true, severity: "warn", category: "crawl", types: ["redirected-url"] },
        { label: "Meta refresh", value: issueTypeCount(issues, "meta-refresh"), problem: true, severity: "warn", category: "crawl", types: ["meta-refresh"] },
        { label: "Long URLs", value: issueTypeCount(issues, "url-too-long"), problem: true, severity: "warn", category: "crawl", types: ["url-too-long"] },
        { label: "Tracked URLs", value: issueTypeCount(issues, "tracking-parameters-in-url"), problem: true, severity: "warn", category: "crawl", types: ["tracking-parameters-in-url"] },
        { label: "Orphan pages", value: coverage.orphanPages, problem: true, severity: "warn", category: "crawl", types: ["orphan-page"] },
        { label: "Deep pages", value: coverage.deepPages, problem: true, severity: "warn", category: "crawl", types: ["crawl-depth-deep"] },
        { label: "Missing from sitemap", value: coverage.pagesMissingFromSitemap, problem: true, severity: "warn", category: "sitemap", types: ["page-missing-from-sitemap"] },
        { label: "Noindex in sitemap", value: summary.noindexPagesInSitemap, problem: true, severity: "warn", category: "sitemap", types: ["noindex-page-in-sitemap"] },
        { label: "Robots issues", value: byCategory.robots, problem: true, severity: "warn", category: "robots", types: ["robots-missing", "robots-blocks-all", "robots-sitemap-missing"] },
        { label: "Sitemap issues", value: byCategory.sitemap, problem: true, severity: "warn", category: "sitemap", types: ["sitemap-fetch-failed", "sitemap-missing-or-empty", "sitemap-larger-than-crawl-limit"] },
      ],
    },
    {
      title: "Speed",
      text: "Performance and CSS/JS",
      rows: [
        { label: "Slow pages", value: issueTypesCount(issues, ["slow-page", "page-response-slow"]), problem: true, severity: "warn", category: "performance", types: ["slow-page", "page-response-slow"] },
        { label: "Viewport issues", value: issueTypesCount(issues, ["viewport-missing", "viewport-not-responsive"]), problem: true, severity: "warn", category: "performance", types: ["viewport-missing", "viewport-not-responsive"] },
        { label: "Heavy HTML", value: issueTypesCount(issues, ["heavy-html", "html-compression-missing"]), problem: true, severity: "warn", category: "performance", types: ["heavy-html", "html-compression-missing"] },
        { label: "Broken CSS/JS", value: coverage.brokenAssets, problem: true, severity: "bad", category: "assets", types: ["broken-css", "broken-javascript"] },
        { label: "Wrong CSS/JS type", value: issueTypesCount(issues, ["css-invalid-content-type", "javascript-invalid-content-type"]), problem: true, severity: "warn", category: "assets", types: ["css-invalid-content-type", "javascript-invalid-content-type"] },
        { label: "Large CSS/JS", value: summary.largeAssets, problem: true, severity: "warn", category: "assets", types: ["large-css", "large-javascript"] },
        { label: "Render-blocking JS", value: summary.renderBlockingScripts, problem: true, severity: "warn", category: "performance", types: ["render-blocking-javascript"] },
        { label: "Too many CSS/JS files", value: issueTypeCount(issues, "too-many-assets"), problem: true, severity: "warn", category: "performance", types: ["too-many-assets"] },
      ],
    },
    {
      title: "Structured",
      text: "Schema, social tags, sharing",
      rows: [
        { label: "Schema issues", value: summary.schemaIssues, problem: true, severity: "warn", category: "structured-data", types: ["structured-data-missing", "structured-data-invalid"] },
        { label: "Open Graph issues", value: issueTypesCount(issues, ["open-graph-incomplete", "open-graph-image-missing", "open-graph-image-invalid"]), problem: true, severity: "warn", category: "social", types: ["open-graph-incomplete", "open-graph-image-missing", "open-graph-image-invalid"] },
        { label: "Twitter/X card missing", value: issueTypeCount(issues, "twitter-card-missing"), problem: true, severity: "warn", category: "social", types: ["twitter-card-missing"] },
        { label: "Security issues", value: summary.securityIssues, problem: true, severity: "bad", category: "security", types: ["page-not-https", "external-blank-missing-noopener"] },
      ],
    },
  ];
  const rows = sections.flatMap((section) => section.rows.map((row) => ({ ...row, area: section.title, areaText: section.text })));

  return (
    <ReportSection title="Scan checks" description="Every local check grouped into one readable table. Use the issue buttons to open the matching rows.">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Area</TableHead>
            <TableHead>Check</TableHead>
            <TableHead>Count</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => <ScanCheckRow key={`${row.area}:${row.label}`} row={row} onSelect={onSelectCheck} />)}
        </TableBody>
      </Table>
    </ReportSection>
  );
}

function ScanCheckRow({ row, onSelect }: { row: ScanCheckRowModel & { area?: string; areaText?: string }; onSelect: (row: ScanCheckRowModel) => void }) {
  const value = Number(row.value || 0);
  const tone = row.problem ? (value > 0 ? (row.severity === "bad" ? "bad" : "warn") : "good") : "outline";
  const clickable = Boolean(row.problem && value > 0 && row.types?.length);
  return (
    <TableRow>
      <TableCell className="min-w-40">
        <div className="font-medium">{row.area}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{row.areaText}</div>
      </TableCell>
      <TableCell className="min-w-56">
        <div className="font-medium">{row.label}</div>
        {row.types?.length ? (
          <div className="mt-0.5 text-xs text-muted-foreground">{row.types.map((type) => type.replaceAll("-", " ")).join(" · ")}</div>
        ) : null}
      </TableCell>
      <TableCell className="metric text-lg">{formatNumber(value)}</TableCell>
      <TableCell>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm">
          <StatusDot tone={tone} />
          {row.problem ? (value ? "issues" : "clear") : "evidence"}
        </span>
      </TableCell>
      <TableCell className="text-right">
        {clickable ? (
          <Button size="sm" variant="outline" onClick={() => onSelect(row)}>
            <ListChecks /> Show {formatNumber(value)} issues
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

function TabCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-2xl border border-border/70 bg-card p-5", className)}>{children}</div>;
}

function ScanReportSkeleton() {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-8 w-20" />
        ))}
      </div>
      <div className="rounded-2xl border border-border/70 bg-card p-5">
        <Skeleton className="h-5 w-40" />
        <div className="mt-5 grid gap-6 xl:grid-cols-[248px_minmax(0,1fr)]">
          <Skeleton className="mx-auto size-[148px] rounded-full xl:mx-0" />
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-20 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ScanSection({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <ReportSection title={title} description={text}>
      {children}
    </ReportSection>
  );
}

function ScanIssuesTable({ rows }: { rows: any[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Severity</TableHead>
          <TableHead>Issue</TableHead>
          <TableHead>Fix</TableHead>
          <TableHead>Evidence</TableHead>
          <TableHead className="text-right">Open</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((issue, index) => {
          const evidence = Object.entries(issue.evidence || {});
          return (
            <TableRow key={issue.id || `${issue.url}:${issue.message}:${index}`}>
              <TableCell className="align-top"><Badge variant={severityVariant(issue.severity) as any}>{issue.severity}</Badge></TableCell>
              <TableCell className="min-w-72 max-w-lg align-top">
                <div className="font-medium">{issue.message}</div>
                <div className="mt-1 break-all text-xs leading-5 text-muted-foreground">{issue.url || "No page URL saved"}</div>
                <div className="mt-1.5 text-xs text-muted-foreground">{issueCategoryLabel(issue.category)} · {String(issue.type || "").replaceAll("-", " ")}</div>
              </TableCell>
              <TableCell className="min-w-64 max-w-sm align-top text-sm leading-6 text-muted-foreground">
                {issue.recommendation || "Inspect this item and update the affected page."}
              </TableCell>
              <TableCell className="min-w-72 max-w-md align-top text-xs leading-5 text-muted-foreground">
                {evidence.length ? evidence.map(([key, value]) => (
                  <div key={key} className="grid gap-1 py-1 sm:grid-cols-[90px_1fr]">
                    <span className="font-medium text-foreground">{key}</span>
                    <EvidenceValue value={value} />
                  </div>
                )) : "-"}
              </TableCell>
              <TableCell className="align-top text-right">
                {issue.url ? (
                  <Button asChild size="sm" variant="outline">
                    <a href={issue.url} target="_blank" rel="noreferrer">
                      <ExternalLink /> Page
                    </a>
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function EvidenceValue({ value }: { value: unknown }) {
  if (value == null || value === "") return <span>-</span>;
  if (Array.isArray(value)) {
    const items = value.map((item) => evidenceText(item)).filter((item) => item !== "-");
    if (!items.length) return <span>-</span>;
    const visible = items.slice(0, 3);
    return (
      <span className="block space-y-1">
        {visible.map((item, index) => (
          <span key={`${item}:${index}`} className="block break-all">{item}</span>
        ))}
        {items.length > visible.length ? (
          <Badge variant="outline">+{formatNumber(items.length - visible.length)} more in saved evidence</Badge>
        ) : null}
      </span>
    );
  }
  return <span className="break-all">{evidenceText(value)}</span>;
}

function evidenceText(value: unknown) {
  if (value == null || value === "") return "-";
  if (Array.isArray(value)) {
    return value.map((item) => typeof item === "string" || typeof item === "number" ? String(item) : JSON.stringify(item)).join(", ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function ScanMetadataTable({ rows }: { rows: any[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Page</TableHead>
          <TableHead>Title</TableHead>
          <TableHead>Description</TableHead>
          <TableHead>H1</TableHead>
          <TableHead>Canonical</TableHead>
          <TableHead>Indexable</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((page) => {
          const h1 = pageH1Status(page);
          return (
          <TableRow key={page.url}>
            <TableCell className="max-w-xs">
              <div className="truncate font-medium">{page.title || page.url}</div>
              <div className="truncate text-xs text-muted-foreground">{page.url}</div>
            </TableCell>
            <TableCell className="min-w-64">
              <div className="line-clamp-2 text-sm">{page.title || "Missing"}</div>
              <LengthBadge value={page.title} savedLength={page.titleLength} min={30} max={60} />
            </TableCell>
            <TableCell className="min-w-72">
              <div className="line-clamp-2 text-sm">{page.description || "Missing"}</div>
              <LengthBadge value={page.description} savedLength={page.descriptionLength} min={70} max={160} />
            </TableCell>
            <TableCell className="min-w-56">
              <div className="line-clamp-2 text-sm">{h1.label}</div>
              <Badge variant={h1.variant as any}>{h1.badge}</Badge>
            </TableCell>
            <TableCell className="max-w-xs">
              <div className="truncate text-xs text-muted-foreground">{page.canonical || "Missing"}</div>
              <Badge variant={page.canonical ? "good" : "warn"}>{page.canonicalCount || 0}</Badge>
            </TableCell>
            <TableCell><IndexabilityBadge page={page} /></TableCell>
          </TableRow>
        );
        })}
      </TableBody>
    </Table>
  );
}

function SeverityInline({ issues }: { issues: any[] }) {
  const list = Array.isArray(issues) ? issues : [];
  const high = list.filter((issue: any) => issue.severity === "high").length;
  const med = list.filter((issue: any) => issue.severity === "medium").length;
  const low = list.filter((issue: any) => issue.severity === "low").length;
  if (!high && !med && !low) {
    return <span className="inline-flex items-center gap-1 text-xs text-good"><CheckCircle2 className="size-3.5" /> clean</span>;
  }
  return (
    <div className="flex items-center gap-2.5 whitespace-nowrap text-xs tabular-nums">
      {high ? <span className="inline-flex items-center gap-1 font-medium text-bad"><span className="size-1.5 rounded-full bg-bad" />{high}</span> : null}
      {med ? <span className="inline-flex items-center gap-1 font-medium text-warn"><span className="size-1.5 rounded-full bg-warn" />{med}</span> : null}
      {low ? <span className="inline-flex items-center gap-1 text-muted-foreground"><span className="size-1.5 rounded-full bg-muted-foreground/50" />{low}</span> : null}
    </div>
  );
}

function ScanPagesTable({ rows }: { rows: any[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Page</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Indexable</TableHead>
          <TableHead>Sitemap</TableHead>
          <TableHead className="text-right">Response</TableHead>
          <TableHead className="text-right">Words</TableHead>
          <TableHead className="text-right">Links·Img</TableHead>
          <TableHead>Issues</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((page) => (
          <TableRow key={page.url}>
            <TableCell className="max-w-sm">
              <div className="truncate font-medium">{page.title || page.url}</div>
              <div className="truncate text-xs text-muted-foreground">{page.url}</div>
            </TableCell>
            <TableCell><Badge variant={page.status >= 400 ? "bad" : page.status >= 300 ? "warn" : "good"}>{page.status}</Badge></TableCell>
            <TableCell><IndexabilityBadge page={page} /></TableCell>
            <TableCell><Badge variant={page.sitemapListed ? "good" : "warn"}>{page.sitemapListed ? "Listed" : "Missing"}</Badge></TableCell>
            <TableCell className="text-right nums tabular-nums">{formatMs(page.loadMs)}</TableCell>
            <TableCell className="text-right nums tabular-nums">{formatNumber(page.wordCount)}</TableCell>
            <TableCell className="whitespace-nowrap text-right text-muted-foreground nums tabular-nums">
              {formatNumber((page.internalLinks || 0) + (page.externalLinks || 0))} · {formatNumber(page.images || 0)}
            </TableCell>
            <TableCell><SeverityInline issues={page.issues} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ScanImageSummaryTable({ rows }: { rows: any[] }) {
  const pages = rows.filter((page) => page.images > 0);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Page</TableHead>
          <TableHead>Images</TableHead>
          <TableHead>Missing src</TableHead>
          <TableHead>Missing fallback</TableHead>
          <TableHead>Invalid srcset</TableHead>
          <TableHead>Missing alt</TableHead>
          <TableHead>Empty alt</TableHead>
          <TableHead>Missing size</TableHead>
          <TableHead>Missing srcset</TableHead>
          <TableHead>No lazy load</TableHead>
          <TableHead>Broken files</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {pages.map((page) => (
          <TableRow key={page.url}>
            <TableCell className="max-w-xs">
              <div className="truncate font-medium">{page.title || page.url}</div>
              <div className="truncate text-xs text-muted-foreground">{page.url}</div>
            </TableCell>
            <TableCell className="nums">{page.images || 0}</TableCell>
            <TableCell><Badge variant={page.imagesMissingSrc ? "bad" : "good"}>{page.imagesMissingSrc || 0}</Badge></TableCell>
            <TableCell><Badge variant={page.imagesMissingFallbackSrc ? "warn" : "good"}>{page.imagesMissingFallbackSrc || 0}</Badge></TableCell>
            <TableCell><Badge variant={page.imagesInvalidSrcset ? "bad" : "good"}>{page.imagesInvalidSrcset || 0}</Badge></TableCell>
            <TableCell><Badge variant={page.imagesMissingAlt ? "warn" : "good"}>{page.imagesMissingAlt || 0}</Badge></TableCell>
            <TableCell><Badge variant={page.imagesEmptyAlt ? "warn" : "good"}>{page.imagesEmptyAlt || 0}</Badge></TableCell>
            <TableCell><Badge variant={page.imagesMissingDimensions ? "warn" : "good"}>{page.imagesMissingDimensions || 0}</Badge></TableCell>
            <TableCell><Badge variant={pageIssueTypeCount(page, "image-srcset-missing") ? "warn" : "good"}>{pageIssueTypeCount(page, "image-srcset-missing")}</Badge></TableCell>
            <TableCell><Badge variant={pageIssueTypeCount(page, "image-lazy-loading-missing") ? "warn" : "good"}>{pageIssueTypeCount(page, "image-lazy-loading-missing")}</Badge></TableCell>
            <TableCell><Badge variant={pageIssueTypeCount(page, "broken-image") ? "bad" : "good"}>{pageIssueTypeCount(page, "broken-image")}</Badge></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ScanAssetsTable({ rows }: { rows: any[] }) {
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Asset</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Loading</TableHead><TableHead>Content type</TableHead><TableHead>Size</TableHead><TableHead>From</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={`${row.url}:${index}`}>
            <TableCell className="max-w-sm break-all font-medium">{row.url}</TableCell>
            <TableCell><Badge variant="outline">{row.type}</Badge></TableCell>
            <TableCell><Badge variant={row.ok ? "good" : "bad"}>{row.status || row.error || "failed"}</Badge></TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {row.type === "js" && row.placement === "head" && !row.async && !row.defer && !row.module ? <Badge variant="warn">blocking</Badge> : null}
                {row.async ? <Badge variant="good">async</Badge> : null}
                {row.defer ? <Badge variant="good">defer</Badge> : null}
                {row.module ? <Badge variant="outline">module</Badge> : null}
                <Badge variant="outline">{row.placement || "-"}</Badge>
              </div>
            </TableCell>
            <TableCell className="text-muted-foreground">{row.contentType || "-"}</TableCell>
            <TableCell className="nums">{formatBytes(row.contentLength)}</TableCell>
            <TableCell className="max-w-xs truncate text-muted-foreground">{row.from}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ScanImagesTable({ rows }: { rows: any[] }) {
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Image</TableHead><TableHead>Status</TableHead><TableHead>Type</TableHead><TableHead>Size</TableHead><TableHead>Purpose</TableHead><TableHead>Final URL</TableHead><TableHead>From</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={`${row.url}:${index}`}>
            <TableCell className="max-w-sm break-all font-medium">{row.url}</TableCell>
            <TableCell><Badge variant={!row.ok ? "bad" : row.redirected || row.finalUrl !== row.url ? "warn" : "good"}>{row.status || row.error || "failed"}</Badge></TableCell>
            <TableCell className="text-muted-foreground">{row.contentType || "-"}</TableCell>
            <TableCell className="nums">{formatBytes(row.contentLength)}</TableCell>
            <TableCell><Badge variant="outline">{row.purpose || "img"}</Badge></TableCell>
            <TableCell className="max-w-xs truncate text-muted-foreground">{row.finalUrl && row.finalUrl !== row.url ? row.finalUrl : "-"}</TableCell>
            <TableCell className="max-w-xs truncate text-muted-foreground">{row.from}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ScanImageInventoryTable({ rows }: { rows: any[] }) {
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Image</TableHead><TableHead>Problems</TableHead><TableHead>Alt</TableHead><TableHead>Class</TableHead><TableHead>Size attrs</TableHead><TableHead>Sources</TableHead><TableHead>Loading</TableHead><TableHead>From</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={`${row.from}:${row.src}:${index}`}>
            <TableCell className="max-w-sm break-all font-medium">{row.src || "Missing src"}</TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {row.issues?.length ? row.issues.map((issue: string) => <Badge key={issue} variant={issue.includes("missing") || issue.includes("mixed") ? "warn" : "outline"}>{issue}</Badge>) : <Badge variant="good">Clean tag</Badge>}
              </div>
            </TableCell>
            <TableCell className="max-w-xs">
              <div className="line-clamp-2 text-sm">{row.altPreview || (row.altState === "missing" ? "Missing" : "Empty")}</div>
              <Badge variant={row.altState === "present" ? "good" : row.classification === "content" ? "warn" : "outline"}>{row.altState}</Badge>
            </TableCell>
            <TableCell><Badge variant="outline">{row.classification}</Badge></TableCell>
            <TableCell className="nums">{row.width || "-"} x {row.height || "-"}</TableCell>
            <TableCell className="nums">
              <div className="flex flex-wrap gap-1">
                <Badge variant={row.srcsetCount ? "outline" : "warn"}>{row.srcsetCount || 0} srcset</Badge>
                {row.pictureSourceCount ? <Badge variant="outline">{row.pictureSourceCount} picture</Badge> : null}
              </div>
            </TableCell>
            <TableCell className="text-muted-foreground">{row.loading || "-"}</TableCell>
            <TableCell className="max-w-xs truncate text-muted-foreground">{row.from}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ScanLinkInventoryTable({ rows }: { rows: any[] }) {
  return (
    <Table>
      <TableHeader><TableRow><TableHead>URL</TableHead><TableHead>Type</TableHead><TableHead>Anchor</TableHead><TableHead>Rel</TableHead><TableHead>Window</TableHead><TableHead>From</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={`${row.from}:${row.href}:${index}`}>
            <TableCell className="max-w-sm break-all font-medium">{row.href}</TableCell>
            <TableCell><Badge variant="outline">{row.type}</Badge></TableCell>
            <TableCell className="max-w-xs">
              <div className="line-clamp-2 text-sm">{row.anchor || row.accessibleName || "No readable anchor"}</div>
              {!row.anchor && !row.accessibleName ? <Badge variant="warn">empty</Badge> : null}
            </TableCell>
            <TableCell className="max-w-xs truncate text-muted-foreground">{row.rel || "-"}</TableCell>
            <TableCell className="text-muted-foreground">{row.target || "-"}</TableCell>
            <TableCell className="max-w-xs truncate text-muted-foreground">{row.from}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
