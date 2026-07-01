import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FileSearch, Globe2, Link2, Plus } from "lucide-react";
import { api, type Site } from "../../api";
import { Badge, Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import { EmptyState, Field, HistoryList, IndexabilityBadge, PageHeader, ProviderNotice, ReportSection, SiteDomainField, SourceBadge, StatusEvidenceTable, defaultEvidenceScan, domainKey, formatDate, formatMetricStatus, formatNumber, hasMetric, LengthBadge, ScanLinksTable, hasIndexabilityEvidence, metricValue, pageH1Status, pageIssueTypesCount, scanIsActive, scanIssueCount, scanStatusLabel, sourceLabel, sourceVariant, setSelectedScanId, sortScanRows } from "../shared";

export function DomainPage({ site }: { site: Site }) {
  const navigate = useNavigate();
  const [domain, setDomain] = useState(site.domain);
  const [overview, setOverview] = useState<any>(null);
  const [keywords, setKeywords] = useState<any>(null);
  const [pages, setPages] = useState<any>(null);
  const [scanRows, setScanRows] = useState<any[]>([]);
  const [selectedScanId, setSelectedScanIdState] = useState("");
  const [history, setHistory] = useState<any[]>([]);
  const [tab, setTab] = useState("keywords");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const selectedScan = useMemo(
    () => scanRows.find((scan) => scan.id === selectedScanId) || defaultEvidenceScan(scanRows),
    [scanRows, selectedScanId],
  );

  useEffect(() => {
    setDomain(site.domain);
    setOverview(null);
    setKeywords(null);
    setPages(null);
    setError("");
    setMessage("");
  }, [site.id, site.domain]);

  async function loadHistory() {
    const [snapshots, scans] = await Promise.all([
      api.domainSnapshots(site.id),
      api.scans(site.id),
    ]);
    setHistory(snapshots);
    const rows = sortScanRows(scans);
    setScanRows(rows);
    setSelectedScanIdState((currentId) => {
      if (currentId && rows.some((scan) => scan.id === currentId)) return currentId;
      return defaultEvidenceScan(rows)?.id || "";
    });
  }
  useEffect(() => {
    loadHistory().catch(console.error);
  }, [site.id]);

  async function run(event?: FormEvent) {
    event?.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    const body = { siteId: site.id, domain, pageSize: 50 };
    try {
      const [overviewData, keywordData, pageData] = await Promise.all([
        api.domainOverview(body),
        api.domainKeywords(body),
        api.domainPages(body),
      ]);
      setOverview(overviewData);
      setKeywords(keywordData);
      setPages(pageData);
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Organic research failed");
    } finally {
      setLoading(false);
    }
  }

  async function importOrganicCsv(event: FormEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setImporting(true);
    setError("");
    setMessage("");
    try {
      const csv = await file.text();
      const imported = await api.importOrganicResearch({
        siteId: site.id,
        domain,
        sourceName: file.name,
        csv,
      });
      setMessage(`Imported ${formatNumber(imported.keywordCount || 0)} keyword rows and ${formatNumber(imported.pageCount || 0)} page rows from ${file.name}.`);
      const body = { siteId: site.id, domain, pageSize: 50 };
      const [overviewData, keywordData, pageData] = await Promise.all([
        api.domainOverview(body),
        api.domainKeywords(body),
        api.domainPages(body),
      ]);
      setOverview(overviewData);
      setKeywords(keywordData);
      setPages(pageData);
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import organic research CSV");
    } finally {
      input.value = "";
      setImporting(false);
    }
  }

  async function scanSite() {
    if (!site.domain) {
      navigate("/");
      return;
    }
    setScanning(true);
    setError("");
    try {
      const result = await api.scanSite(site.id);
      if (result.scan?.id) {
        setSelectedScanId(site.id, result.scan.id);
        navigate(`/scans/${result.scan.id}`);
      } else {
        navigate("/scans");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start site scan");
    } finally {
      setScanning(false);
    }
  }

  return (
    <>
      <PageHeader eyebrow="Competitive" title="Organic research" description="Import ranked keywords and top pages for the active site or a competitor site." />
      <section className="rounded-xl border border-border bg-card shadow-[0_1px_2px_0_rgb(38_32_20/0.04)] p-5">
        <form className="grid gap-3 lg:grid-cols-[1fr_auto]" onSubmit={run}>
          <SiteDomainField
            label="Research domain"
            value={domain}
            siteDomain={site.domain}
            hint="Use the active site or enter a competitor domain. CSV imports provide organic rows; saved scans provide local crawl evidence below."
            onChange={setDomain}
          />
          <div className="flex items-end">
            <Button disabled={loading || !domain.trim()}><Globe2 /> {loading ? "Loading" : "Load organic research"}</Button>
          </div>
        </form>
        <div className="mt-4 rounded-md border bg-muted/20">
          <div className="grid gap-0 md:grid-cols-[220px_minmax(0,1fr)_280px]">
            <div className="border-b px-4 py-3 md:border-b-0 md:border-r">
              <div className="text-sm font-medium">Organic CSV</div>
              <Badge className="mt-2" variant={history.some((row) => row.source === "organic-import" && domainKey(row.domain) === domainKey(domain)) ? "good" : "outline"}>
                {history.some((row) => row.source === "organic-import" && domainKey(row.domain) === domainKey(domain)) ? "Imported" : "CSV ready"}
              </Badge>
            </div>
            <div className="border-b px-4 py-3 text-sm leading-6 text-muted-foreground md:border-b-0 md:border-r">
              Import real keyword, position, volume, traffic, difficulty, URL, page, and title columns. Rows are stored in SQLite and used by the tables below.
            </div>
            <div className="px-4 py-3">
              <Field label="Import organic CSV">
                <Input type="file" accept=".csv,text/csv" onChange={importOrganicCsv} disabled={importing || !domain.trim()} />
              </Field>
            </div>
          </div>
        </div>
        {error ? <p className="mt-3 rounded-md border border-destructive/40 bg-muted/30 p-3 text-sm text-destructive">{error}</p> : null}
        {message ? <p className="mt-3 rounded-md border border-primary/30 bg-muted/30 p-3 text-sm text-primary">{message}</p> : null}
      </section>
      <div className="mt-6 space-y-6">
        <LocalOrganicEvidence
          scan={selectedScan}
          scans={scanRows}
          selectedScanId={selectedScan?.id || ""}
          onScanChange={setSelectedScanIdState}
          siteDomain={site.domain}
          onScan={scanSite}
          scanning={scanning}
        />
        {overview?.warning ? (
          <ProviderNotice title="Organic CSV import needed" text={overview.warning} source={overview.source} />
        ) : null}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="keywords">Keywords</TabsTrigger>
            <TabsTrigger value="pages">Pages</TabsTrigger>
            <TabsTrigger value="snapshot">Snapshot</TabsTrigger>
          </TabsList>
          <TabsContent value="keywords">
            <ReportSection title="Ranked keywords" description={keywords ? <SourceBadge source={keywords.source} /> : "Run an analysis to load rows."}>
              {keywords?.keywords?.length ? <DomainKeywordsTable rows={keywords.keywords} /> : <EmptyState title="No keyword rows" text={keywords?.warning || "Analyze an organic research site to load ranked keyword data."} />}
            </ReportSection>
          </TabsContent>
          <TabsContent value="pages">
            <ReportSection title="Top pages" description={pages ? <SourceBadge source={pages.source} /> : "Run an analysis to load rows."}>
              {pages?.pages?.length ? <DomainPagesTable rows={pages.pages} /> : <EmptyState title="No page rows" text={pages?.warning || "Analyze an organic research site to load top page data."} />}
            </ReportSection>
          </TabsContent>
          <TabsContent value="snapshot">
            {overview ? <OrganicSnapshot result={overview} domain={domain} keywordRows={keywords?.keywords?.length || 0} pageRows={pages?.pages?.length || 0} /> : <EmptyState title="No snapshot" text="Run an analysis to save the first organic research snapshot." />}
          </TabsContent>
        </Tabs>
        <HistoryList title="Organic research history" rows={history} labelKey="domain" labelTitle="Research site" />
      </div>
    </>
  );
}

function ScanRunPicker({
  label,
  scans,
  selectedScanId,
  onScanChange,
}: {
  label: string;
  scans: any[];
  selectedScanId: string;
  onScanChange: (scanId: string) => void;
}) {
  if (!scans.length) return null;
  const selected = scans.find((scan) => scan.id === selectedScanId) || scans[0];
  return (
    <div className="w-full space-y-2 lg:w-[440px]">
      <Label>{label}</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Select value={selected?.id || ""} onValueChange={onScanChange}>
          <SelectTrigger aria-label={label} className="min-w-0 flex-1">
            <SelectValue placeholder="Choose saved scan" />
          </SelectTrigger>
          <SelectContent>
            {scans.map((scan) => (
              <SelectItem key={scan.id} value={scan.id}>
                {formatDate(scan.created_at || scan.updated_at)} · {scanStatusLabel(scan.status)} · {formatNumber(scan.pages_crawled || 0)} pages · {scan.url}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button asChild variant="outline">
          <Link to={`/scans/${selected.id}`}><FileSearch /> Open scan report</Link>
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {formatNumber(scans.length)} saved scan{scans.length === 1 ? "" : "s"} available for this site.
      </p>
    </div>
  );
}

function LocalOrganicEvidence({
  scan,
  scans,
  selectedScanId,
  onScanChange,
  siteDomain,
  onScan,
  scanning,
}: {
  scan: any;
  scans: any[];
  selectedScanId: string;
  onScanChange: (scanId: string) => void;
  siteDomain: string;
  onScan: () => void;
  scanning: boolean;
}) {
  const pages = scan?.result?.pages || [];
  const rows = [...pages]
    .sort((a, b) => scanIssueCount(b) - scanIssueCount(a));
  const indexableCount = pages.filter((page: any) => page.indexable === true).length;
  const unknownIndexabilityCount = pages.filter((page: any) => !hasIndexabilityEvidence(page)).length;
  const missingTitleCount = pages.filter((page: any) => !page.title).length;
  const missingDescriptionCount = pages.filter((page: any) => !page.description).length;
  const h1IssueCount = pages.reduce((total: number, page: any) => total + pageIssueTypesCount(page, ["h1-count", "h1-empty"]), 0);
  return (
    <section className="rounded-xl border border-border bg-card shadow-[0_1px_2px_0_rgb(38_32_20/0.04)]">
      <div className="border-b px-5 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Local crawl pages</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Real page evidence from the saved scan shown below. No external keyword or traffic estimates are generated here.
            </p>
          </div>
          <ScanRunPicker label="Saved scan for page evidence" scans={scans} selectedScanId={selectedScanId} onScanChange={onScanChange} />
        </div>
      </div>
      <div className="space-y-4 p-5">
        {!scan ? (
          <EmptyState
            title="No local crawl yet"
            text={siteDomain ? "Run a site scan once to fill this page with real crawl evidence." : "Add a website address and run a scan to fill this page."}
            action={siteDomain ? (
              <Button variant="secondary" onClick={onScan} disabled={scanning}>
                <FileSearch /> {scanning ? "Starting scan" : `Scan ${siteDomain}`}
              </Button>
            ) : (
              <Button asChild variant="secondary"><Link to="/"><Plus /> Add site</Link></Button>
            )}
          />
        ) : !scan.result ? (
          <EmptyState
            title={scanIsActive(scan) ? "This saved scan is still running" : "This saved scan has no crawl evidence"}
            text={scanIsActive(scan) ? "Open the scan report to watch progress. Evidence appears here after crawl data is saved." : scan.error || "This saved scan did not include crawl rows."}
            action={<Button asChild variant="secondary"><Link to={`/scans/${scan.id}`}><FileSearch /> Open scan report</Link></Button>}
          />
        ) : (
          <>
            <div className="divide-y rounded-xl border border-border bg-card shadow-[0_1px_2px_0_rgb(38_32_20/0.04)]">
              {[
                ["Pages crawled", pages.length],
                ["Indexable pages", indexableCount],
                ["Indexability unknown", unknownIndexabilityCount],
                ["Missing titles", missingTitleCount],
                ["Missing descriptions", missingDescriptionCount],
                ["H1 issues", h1IssueCount],
                ["Total crawl issues", scan.issue_count],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-4 px-4 py-3">
                  <span className="text-sm font-medium">{label}</span>
                  <span className="nums text-xl font-semibold">{formatNumber(value)}</span>
                </div>
              ))}
            </div>
            {rows.length ? <LocalOrganicPagesTable rows={rows} /> : <EmptyState title="No page rows" text="This saved scan did not save page rows." />}
          </>
        )}
      </div>
    </section>
  );
}

function LocalOrganicPagesTable({ rows }: { rows: any[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Page</TableHead>
          <TableHead>Indexable</TableHead>
          <TableHead>Title</TableHead>
          <TableHead>Description</TableHead>
          <TableHead>H1</TableHead>
          <TableHead>Words</TableHead>
          <TableHead>Inlinks</TableHead>
          <TableHead>Issues</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((page) => {
          const h1 = pageH1Status(page);
          return (
          <TableRow key={page.url}>
            <TableCell className="max-w-md">
              <div className="truncate font-medium">{page.finalUrl || page.url}</div>
              <div className="text-xs text-muted-foreground">{page.discovery || "crawl"} · depth {page.depth ?? 0}</div>
            </TableCell>
            <TableCell><IndexabilityBadge page={page} /></TableCell>
            <TableCell className="min-w-56">
              <div className="line-clamp-2">{page.title || "Missing"}</div>
              <LengthBadge value={page.title} savedLength={page.titleLength} min={30} max={60} />
            </TableCell>
            <TableCell className="min-w-64">
              <div className="line-clamp-2">{page.description || "Missing"}</div>
              <LengthBadge value={page.description} savedLength={page.descriptionLength} min={70} max={160} />
            </TableCell>
            <TableCell className="max-w-xs">
              <div className="line-clamp-2">{h1.label}</div>
              <Badge variant={h1.variant as any}>{h1.badge}</Badge>
            </TableCell>
            <TableCell className="nums">{formatNumber(page.wordCount)}</TableCell>
            <TableCell className="nums">{formatNumber(page.internalInlinks || 0)}</TableCell>
            <TableCell>
              <Badge variant={scanIssueCount(page) ? "warn" : "good"}>{formatNumber(scanIssueCount(page))}</Badge>
            </TableCell>
          </TableRow>
        );
        })}
      </TableBody>
    </Table>
  );
}

function OrganicSnapshot({ result, domain, keywordRows, pageRows }: { result: any; domain: string; keywordRows: number; pageRows: number }) {
  const organicKeywords = metricValue(result.organicKeywords);
  const organicTraffic = metricValue(result.organicTraffic);
  const estimatedValue = metricValue(result.estimatedValue);
  return (
    <ReportSection
      title="Snapshot"
      description={<><SourceBadge source={result.source} /> {result.createdAt ? <span className="ml-2">{formatDate(result.createdAt)}</span> : null}</>}
    >
      <StatusEvidenceTable
        rows={[
          { title: "Research site", status: domain || result.domain || "-", tone: "good", text: "The active site or competitor domain analyzed in this run." },
          { title: "Keyword rows", status: formatNumber(keywordRows), tone: keywordRows ? "good" : "warn", text: "Rows returned by the real organic search dataset." },
          { title: "Page rows", status: formatNumber(pageRows), tone: pageRows ? "good" : "warn", text: "Top pages returned for this domain." },
          { title: "Organic keywords", status: formatMetricStatus(organicKeywords), tone: hasMetric(organicKeywords) ? "good" : "warn", text: "Metric from an imported organic dataset when available." },
          { title: "Organic traffic", status: formatMetricStatus(organicTraffic), tone: hasMetric(organicTraffic) ? "good" : "warn", text: "External estimate from an imported organic dataset when available." },
          { title: "Traffic value", status: formatMetricStatus(estimatedValue), tone: hasMetric(estimatedValue) ? "good" : "warn", text: "External estimate from an imported organic dataset when available." },
        ]}
      />
    </ReportSection>
  );
}

function DomainKeywordsTable({ rows }: { rows: any[] }) {
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Keyword</TableHead><TableHead>Position</TableHead><TableHead>Volume</TableHead><TableHead>Traffic</TableHead><TableHead>KD</TableHead><TableHead>URL</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={`${row.keyword}:${row.url}`}>
            <TableCell className="font-medium">{row.keyword}</TableCell>
            <TableCell className="nums">{formatNumber(row.position)}</TableCell>
            <TableCell className="nums">{formatNumber(row.searchVolume)}</TableCell>
            <TableCell className="nums">{formatNumber(row.traffic)}</TableCell>
            <TableCell className="nums">{formatNumber(row.keywordDifficulty)}</TableCell>
            <TableCell className="max-w-sm truncate text-muted-foreground">{row.relativeUrl || row.url}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function DomainPagesTable({ rows }: { rows: any[] }) {
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Page</TableHead><TableHead>Traffic</TableHead><TableHead>Keywords</TableHead><TableHead>Evidence</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.page}>
            <TableCell className="max-w-xl">
              <div className="truncate font-medium">{row.relativePath || row.page}</div>
              {row.title ? <div className="mt-1 truncate text-xs text-muted-foreground">{row.title}</div> : null}
            </TableCell>
            <TableCell className="nums">{formatNumber(row.organicTraffic)}</TableCell>
            <TableCell className="nums">{formatNumber(row.keywords)}</TableCell>
            <TableCell className="min-w-56">
              {row.source === "local-scan" ? (
                <div className="flex flex-wrap gap-1">
                  <Badge variant="good">crawl evidence</Badge>
                  <Badge variant={row.issues ? "warn" : "outline"}>{formatNumber(row.issues || 0)} issues</Badge>
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">Imported organic dataset</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function LinksPage({ site }: { site: Site }) {
  const navigate = useNavigate();
  const [domain, setDomain] = useState(site.domain);
  const [overview, setOverview] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [scanRows, setScanRows] = useState<any[]>([]);
  const [selectedScanId, setSelectedScanIdState] = useState("");
  const [history, setHistory] = useState<any[]>([]);
  const [tab, setTab] = useState("backlinks");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const matchingImport = useMemo(
    () => history.find((row) => domainKey(row.domain) === domainKey(domain)) || null,
    [history, domain],
  );
  const backlinkIndexAvailable = Boolean(matchingImport);
  const selectedScan = useMemo(
    () => scanRows.find((scan) => scan.id === selectedScanId) || defaultEvidenceScan(scanRows),
    [scanRows, selectedScanId],
  );

  useEffect(() => {
    setDomain(site.domain);
    setOverview(null);
    setProfile(null);
    setError("");
  }, [site.id, site.domain]);

  async function loadHistory() {
    const [snapshots, scans] = await Promise.all([
      api.backlinkSnapshots(site.id),
      api.scans(site.id),
    ]);
    setHistory(snapshots);
    const rows = sortScanRows(scans);
    setScanRows(rows);
    setSelectedScanIdState((currentId) => {
      if (currentId && rows.some((scan) => scan.id === currentId)) return currentId;
      return defaultEvidenceScan(rows)?.id || "";
    });
  }
  useEffect(() => {
    loadHistory().catch(console.error);
  }, [site.id]);

  async function run(nextTab = tab) {
    if (!backlinkIndexAvailable) {
      setOverview(null);
      setProfile(null);
      setError("Import a backlink CSV for this domain before running web-wide backlink tables. Local scan links are available below.");
      return;
    }
    setLoading(true);
    setError("");
    const body = { siteId: site.id, domain, tab: nextTab, pageSize: 50 };
    try {
      const [overviewData, profileData] = await Promise.all([
        api.backlinksOverview(body),
        api.backlinksProfile(body),
      ]);
      setOverview(overviewData);
      setProfile(profileData);
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Backlink analysis failed");
    } finally {
      setLoading(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    await run();
  }

  async function importBacklinkCsv(event: FormEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setImporting(true);
    setError("");
    setImportMessage("");
    try {
      const csv = await file.text();
      const imported = await api.importBacklinks({
        siteId: site.id,
        domain,
        sourceName: file.name,
        csv,
      });
      await loadHistory();
      setImportMessage(`Imported ${formatNumber(imported.rowCount || imported.row_count || 0)} backlink rows from ${file.name}.`);
      const body = { siteId: site.id, domain, tab, pageSize: 50 };
      const [overviewData, profileData] = await Promise.all([
        api.backlinksOverview(body),
        api.backlinksProfile(body),
      ]);
      setOverview(overviewData);
      setProfile(profileData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import backlink CSV");
    } finally {
      input.value = "";
      setImporting(false);
    }
  }

  async function changeTab(value: string) {
    setTab(value);
    if (overview && value !== "snapshot") await run(value);
  }

  async function scanSite() {
    if (!site.domain) {
      navigate("/");
      return;
    }
    setScanning(true);
    setError("");
    try {
      const result = await api.scanSite(site.id);
      if (result.scan?.id) {
        setSelectedScanId(site.id, result.scan.id);
        navigate(`/scans/${result.scan.id}`);
      } else {
        navigate("/scans");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start site scan");
    } finally {
      setScanning(false);
    }
  }

  return (
    <>
      <PageHeader eyebrow="Authority" title="Links" description="Local crawl links come from saved scans. Web-wide backlink tables come from CSV imports saved in SQLite." />
      <section className="rounded-xl border border-border bg-card shadow-[0_1px_2px_0_rgb(38_32_20/0.04)] p-5">
        <form className="grid gap-3 lg:grid-cols-[1fr_auto]" onSubmit={submit}>
          <SiteDomainField
            label="Web-wide backlink domain"
            value={domain}
            siteDomain={site.domain}
            hint="Saved site scans provide the usable local link evidence below."
            onChange={setDomain}
          />
          <div className="flex items-end">
            <Button disabled={loading || !domain.trim() || !backlinkIndexAvailable}><Link2 /> {loading ? "Checking" : backlinkIndexAvailable ? "Check imported backlinks" : "Import CSV first"}</Button>
          </div>
        </form>
        <div className="mt-4 rounded-md border bg-muted/25">
          <div className="grid gap-0 md:grid-cols-[220px_minmax(0,1fr)_260px]">
            <div className="border-b px-4 py-3 md:border-b-0 md:border-r">
              <div className="text-sm font-medium">Web-wide backlink index</div>
              <Badge className="mt-2" variant={backlinkIndexAvailable ? "good" : "warn"}>{backlinkIndexAvailable ? "Imported" : "Needs CSV"}</Badge>
            </div>
            <div className="border-b px-4 py-3 text-sm leading-6 text-muted-foreground md:border-b-0 md:border-r">
              {backlinkIndexAvailable
                ? `${formatNumber(matchingImport.rowCount || matchingImport.row_count || 0)} real rows from ${matchingImport.sourceName || matchingImport.source_name || "backlink CSV"} are available for ${domainKey(domain)}.`
                : "Import a backlink CSV with source URL, linked URL, referring domain, anchor, follow/nofollow, and status columns. No web-wide backlinks are generated locally."}
            </div>
            <div className="px-4 py-3">
              <Field label="Import backlink CSV">
                <Input type="file" accept=".csv,text/csv" onChange={importBacklinkCsv} disabled={importing || !domain.trim()} />
              </Field>
            </div>
          </div>
        </div>
        {importMessage ? <p className="mt-3 rounded-md border border-primary/30 bg-muted/30 p-3 text-sm text-primary">{importMessage}</p> : null}
        {error ? <p className="mt-3 rounded-md border border-destructive/40 bg-muted/30 p-3 text-sm text-destructive">{error}</p> : null}
      </section>
      <div className="mt-6 space-y-6">
        <LocalLinkEvidence
          scan={selectedScan}
          scans={scanRows}
          selectedScanId={selectedScan?.id || ""}
          onScanChange={setSelectedScanIdState}
          siteDomain={site.domain}
          onScan={scanSite}
          scanning={scanning}
        />
        {overview?.warning ? (
          <ProviderNotice title="External backlink index unavailable" text={overview.warning} source={overview.source} />
        ) : null}
        <Tabs value={tab} onValueChange={changeTab}>
          <TabsList>
            <TabsTrigger value="backlinks">Backlinks</TabsTrigger>
            <TabsTrigger value="domains">Domains</TabsTrigger>
            <TabsTrigger value="pages">Pages</TabsTrigger>
            <TabsTrigger value="snapshot">Snapshot</TabsTrigger>
          </TabsList>
          <TabsContent value="backlinks">
            <ReportSection title="External backlinks" description={profile ? <SourceBadge source={profile.source} /> : "Import a backlink CSV, then run this table."}>
              {profile?.tab === "backlinks" && profile.rows?.length ? <BacklinksRowsTable rows={profile.rows} /> : <EmptyState title="No web-wide backlink index" text={profile?.warning || "Import a backlink CSV above to populate this table. Local scans do not invent web-wide backlinks."} />}
            </ReportSection>
          </TabsContent>
          <TabsContent value="domains">
            <ReportSection title="Referring domains">
              {profile?.tab === "domains" && profile.rows?.length ? <ReferringDomainsTable rows={profile.rows} /> : <EmptyState title="No domain rows" text={profile?.warning || "Switch tabs after running a backlink analysis."} />}
            </ReportSection>
          </TabsContent>
          <TabsContent value="pages">
            <ReportSection title="Top linked pages">
              {profile?.tab === "pages" && profile.rows?.length ? <BacklinkPagesTable rows={profile.rows} /> : <EmptyState title="No page rows" text={profile?.warning || "Switch tabs after running a backlink analysis."} />}
            </ReportSection>
          </TabsContent>
          <TabsContent value="snapshot">
            {overview ? <BacklinkSnapshot result={overview} domain={domain} rows={profile?.rows?.length || 0} tab={profile?.tab || tab} /> : <EmptyState title="No snapshot" text="Import a backlink CSV and run an analysis to save the first backlink snapshot." />}
          </TabsContent>
        </Tabs>
        <HistoryList title="Backlink imports" rows={history} labelKey="domain" labelTitle="Backlink domain" />
      </div>
    </>
  );
}

function LocalLinkEvidence({
  scan,
  scans,
  selectedScanId,
  onScanChange,
  siteDomain,
  onScan,
  scanning,
}: {
  scan: any;
  scans: any[];
  selectedScanId: string;
  onScanChange: (scanId: string) => void;
  siteDomain: string;
  onScan: () => void;
  scanning: boolean;
}) {
  const result = scan?.result || {};
  const linkInventory = result.linkInventory || [];
  const checkedLinks = result.links || [];
  const pages = result.pages || [];
  const checkedByUrl = new Map(checkedLinks.map((link: any) => [link.url, link]));
  const externalLinks = linkInventory.filter((link: any) => link.type === "external");
  const brokenLinks = checkedLinks.filter((link: any) => !link.ok);
  const pageRows = [...pages]
    .sort((a, b) => Number(b.internalInlinks || 0) - Number(a.internalInlinks || 0));
  return (
    <section className="rounded-xl border border-border bg-card shadow-[0_1px_2px_0_rgb(38_32_20/0.04)]">
      <div className="border-b px-5 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Local link graph</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Real internal links, external links, and failing URLs from the saved scan shown below.
            </p>
          </div>
          <ScanRunPicker label="Saved scan for link evidence" scans={scans} selectedScanId={selectedScanId} onScanChange={onScanChange} />
        </div>
      </div>
      <div className="space-y-4 p-5">
        {!scan ? (
          <EmptyState
            title="No local link graph yet"
            text={siteDomain ? "Run a site scan once to collect internal links, external links, and broken link evidence." : "Add a website address and run a scan to collect link evidence."}
            action={siteDomain ? (
              <Button variant="secondary" onClick={onScan} disabled={scanning}>
                <FileSearch /> {scanning ? "Starting scan" : `Scan ${siteDomain}`}
              </Button>
            ) : (
              <Button asChild variant="secondary"><Link to="/"><Plus /> Add site</Link></Button>
            )}
          />
        ) : !scan.result ? (
          <EmptyState
            title={scanIsActive(scan) ? "This saved scan is still running" : "This saved scan has no link evidence"}
            text={scanIsActive(scan) ? "Open the scan report to watch progress. Link evidence appears here after crawl data is saved." : scan.error || "This saved scan did not include link rows."}
            action={<Button asChild variant="secondary"><Link to={`/scans/${scan.id}`}><FileSearch /> Open scan report</Link></Button>}
          />
        ) : (
          <>
            <div className="divide-y rounded-xl border border-border bg-card shadow-[0_1px_2px_0_rgb(38_32_20/0.04)]">
              {[
                ["Link tags found", linkInventory.length],
                ["External links found", linkInventory.filter((link: any) => link.type === "external").length],
                ["Checked links", checkedLinks.length],
                ["Broken links", checkedLinks.filter((link: any) => !link.ok).length],
                ["Pages with no inlinks", pages.filter((page: any) => Number(page.internalInlinks || 0) === 0).length],
                ["Internal links found", linkInventory.filter((link: any) => link.type === "internal").length],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-4 px-4 py-3">
                  <span className="text-sm font-medium">{label}</span>
                  <span className="nums text-xl font-semibold">{formatNumber(value)}</span>
                </div>
              ))}
            </div>
            <Tabs defaultValue="external">
              <TabsList>
                <TabsTrigger value="external">External links</TabsTrigger>
                <TabsTrigger value="broken">Broken links</TabsTrigger>
                <TabsTrigger value="internal">Internal graph</TabsTrigger>
              </TabsList>
              <TabsContent value="external">
                {externalLinks.length ? <LocalExternalLinksTable rows={externalLinks} checkedByUrl={checkedByUrl} /> : <EmptyState title="No external links" text="This saved scan did not find external links." />}
              </TabsContent>
              <TabsContent value="broken">
                {brokenLinks.length ? <ScanLinksTable rows={brokenLinks} /> : <EmptyState title="No broken links" text="This saved scan did not find failing link URLs." />}
              </TabsContent>
              <TabsContent value="internal">
                {pageRows.length ? <LocalInternalGraphTable rows={pageRows} /> : <EmptyState title="No internal graph" text="This saved scan did not save page link rows." />}
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </section>
  );
}

function LocalExternalLinksTable({ rows, checkedByUrl }: { rows: any[]; checkedByUrl: Map<any, any> }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>URL</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Anchor</TableHead>
          <TableHead>Rel</TableHead>
          <TableHead>From</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => {
          const checked = checkedByUrl.get(row.href);
          return (
            <TableRow key={`${row.from}:${row.href}:${index}`}>
              <TableCell className="max-w-md break-all font-medium">{row.href}</TableCell>
              <TableCell>
                {checked ? (
                  <Badge variant={!checked.ok ? "bad" : checked.redirected || checked.finalUrl !== checked.url ? "warn" : "good"}>
                    {checked.status || checked.error || "checked"}
                  </Badge>
                ) : (
                  <Badge variant="outline">not checked</Badge>
                )}
              </TableCell>
              <TableCell className="max-w-xs">
                <div className="line-clamp-2">{row.anchor || row.accessibleName || "-"}</div>
              </TableCell>
              <TableCell className="text-muted-foreground">{row.rel || "-"}</TableCell>
              <TableCell className="max-w-xs truncate text-muted-foreground">{row.from}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function LocalInternalGraphTable({ rows }: { rows: any[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Page</TableHead>
          <TableHead>Depth</TableHead>
          <TableHead>Inlinks</TableHead>
          <TableHead>Internal out</TableHead>
          <TableHead>External out</TableHead>
          <TableHead>Sitemap</TableHead>
          <TableHead>Issues</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((page) => (
          <TableRow key={page.url}>
            <TableCell className="max-w-md">
              <div className="truncate font-medium">{page.title || page.url}</div>
              <div className="truncate text-xs text-muted-foreground">{page.url}</div>
            </TableCell>
            <TableCell className="nums">{page.depth ?? 0}</TableCell>
            <TableCell className="nums">{formatNumber(page.internalInlinks || 0)}</TableCell>
            <TableCell className="nums">{formatNumber(page.internalLinks || 0)}</TableCell>
            <TableCell className="nums">{formatNumber(page.externalLinks || 0)}</TableCell>
            <TableCell><Badge variant={page.sitemapListed ? "good" : "warn"}>{page.sitemapListed ? "Listed" : "Missing"}</Badge></TableCell>
            <TableCell><Badge variant={scanIssueCount(page) ? "warn" : "good"}>{formatNumber(scanIssueCount(page))}</Badge></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function BacklinkSnapshot({ result, domain, rows, tab }: { result: any; domain: string; rows: number; tab: string }) {
  const backlinks = metricValue(result.backlinks, result.summary?.backlinks);
  const referringDomains = metricValue(result.referringDomains, result.summary?.referringDomains);
  const dofollowRatio = metricValue(result.dofollowRatio);
  return (
    <ReportSection
      title="Snapshot"
      description={<><SourceBadge source={result.source} /> {result.createdAt ? <span className="ml-2">{formatDate(result.createdAt)}</span> : null}</>}
    >
      <StatusEvidenceTable
        rows={[
          { title: "Backlink domain", status: domain || result.domain || "-", tone: "good", text: "The domain or URL checked in this run." },
          { title: "Visible rows", status: formatNumber(rows), tone: rows ? "good" : "warn", text: `Rows currently loaded in the ${tab} tab.` },
          { title: "Backlinks", status: formatMetricStatus(backlinks), tone: hasMetric(backlinks) ? "good" : "warn", text: "Total backlinks from the imported rows." },
          { title: "Referring domains", status: formatMetricStatus(referringDomains), tone: hasMetric(referringDomains) ? "good" : "warn", text: "Unique linking domains from the imported rows." },
          { title: "Dofollow %", status: formatMetricStatus(dofollowRatio), tone: hasMetric(dofollowRatio) ? "good" : "warn", text: "Dofollow ratio computed from the imported rows." },
          { title: "Source", status: sourceLabel(result.source), tone: sourceVariant(result.source) as any, text: result.warning || "Snapshot saved locally in SQLite." },
        ]}
      />
    </ReportSection>
  );
}

function BacklinksRowsTable({ rows }: { rows: any[] }) {
  return (
    <Table>
      <TableHeader><TableRow><TableHead>From</TableHead><TableHead>Anchor</TableHead><TableHead>Rank</TableHead><TableHead>Spam</TableHead><TableHead>Type</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={`${row.urlFrom}:${index}`}>
            <TableCell className="max-w-sm truncate font-medium">{row.domainFrom || row.urlFrom}</TableCell>
            <TableCell className="max-w-xs truncate">{row.anchor || "-"}</TableCell>
            <TableCell className="nums">{formatNumber(row.rank)}</TableCell>
            <TableCell className="nums">{formatNumber(row.spamScore)}</TableCell>
            <TableCell><Badge variant={row.isDofollow ? "good" : "outline"}>{row.isDofollow ? "follow" : "nofollow"}</Badge></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ReferringDomainsTable({ rows }: { rows: any[] }) {
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Domain</TableHead><TableHead>Backlinks</TableHead><TableHead>Pages</TableHead><TableHead>Rank</TableHead><TableHead>Spam</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.domain}>
            <TableCell className="font-medium">{row.domain}</TableCell>
            <TableCell className="nums">{formatNumber(row.backlinks)}</TableCell>
            <TableCell className="nums">{formatNumber(row.referringPages)}</TableCell>
            <TableCell className="nums">{formatNumber(row.rank)}</TableCell>
            <TableCell className="nums">{formatNumber(row.spamScore)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function BacklinkPagesTable({ rows }: { rows: any[] }) {
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Page</TableHead><TableHead>Backlinks</TableHead><TableHead>Ref. domains</TableHead><TableHead>Rank</TableHead><TableHead>Broken</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.page}>
            <TableCell className="max-w-xl truncate font-medium">{row.page}</TableCell>
            <TableCell className="nums">{formatNumber(row.backlinks)}</TableCell>
            <TableCell className="nums">{formatNumber(row.referringDomains)}</TableCell>
            <TableCell className="nums">{formatNumber(row.rank)}</TableCell>
            <TableCell className="nums">{formatNumber(row.brokenBacklinks)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
