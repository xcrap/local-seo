import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Activity, CheckCircle2, Download, Plus, RefreshCw, Search, Tags, Target, Trash2, Upload } from "lucide-react";
import { api, type KeywordResult, type Site } from "../../api";
import { Badge, Button, Checkbox, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from "@/components/ui";
import { EmptyState, Field, HistoryList, HistoryTable, InfoTip, PageHeader, ReportSection, SiteDomainField, StatusDot, TagList, formatDate, formatMetricStatus, formatNumber, keywordMetricClass, sourceLabel, sourceVariant } from "../shared";

function SourceMeta({ source, extra }: { source?: string; extra?: ReactNode }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
      <StatusDot tone={sourceVariant(source) as any} />
      <span>{sourceLabel(source)}</span>
      {extra}
    </span>
  );
}

export function KeywordsPage({ site }: { site: Site }) {
  const [query, setQuery] = useState(site.domain || "");
  const [limit, setLimit] = useState(25);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const selectedCount = Object.values(selected).filter(Boolean).length;

  useEffect(() => {
    setQuery(site.domain || "");
  }, [site.id, site.domain]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const data = await api.researchKeywords({ siteId: site.id, query, limit });
      setResult(data);
      setSelected(Object.fromEntries(data.rows.slice(0, 10).map((row) => [row.keyword, true])));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Keyword research failed");
    } finally {
      setLoading(false);
    }
  }

  async function saveSelected() {
    const rows = (result?.rows || []).filter((row: KeywordResult) => selected[row.keyword]);
    if (!rows.length) return;
    setError("");
    setMessage("");
    try {
      await api.saveKeywords({ siteId: site.id, keywords: rows, source: result?.source || "research" });
      setMessage(`Saved ${rows.length} keywords.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save selected keywords");
    }
  }

  return (
    <>
      <PageHeader title="Keyword research" description="Find real keyword suggestions. Volume, CPC, and difficulty stay unavailable unless you import real metrics later." />
      <section className="rounded-2xl border border-border/70 bg-card p-5">
        <form className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_140px_auto] lg:items-end" onSubmit={submit}>
          <Field label="Seed keyword">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={site.domain || "seed keyword"} />
          </Field>
          <Field label="Suggestion limit">
            <Input
              value={limit}
              type="number"
              min={1}
              max={100}
              onChange={(e) => {
                const next = Number(e.target.value);
                setLimit(e.target.value === "" || Number.isNaN(next) ? 1 : Math.max(1, Math.min(100, next)));
              }}
            />
          </Field>
          <Button disabled={loading || !query.trim()}><Search /> {loading ? "Researching" : "Research"}</Button>
        </form>
        {error ? <p className="mt-3 rounded-lg bg-bad-soft/50 px-3.5 py-2.5 text-sm text-destructive">{error}</p> : null}
        {message ? <p className="mt-3 rounded-lg bg-primary/[0.07] px-3.5 py-2.5 text-sm text-primary">{message}</p> : null}
      </section>
      <div className="mt-6">
        {result ? (
          <ReportSection
            title="Results"
            meta={
              <SourceMeta
                source={result.source}
                extra={
                  <>
                    <span>· {formatNumber(result.rows?.length || 0)} suggestions</span>
                    {result.warning ? <InfoTip label="Result warning">{result.warning}</InfoTip> : null}
                  </>
                }
              />
            }
            action={
              <Button variant="secondary" size="sm" onClick={saveSelected} disabled={!result.rows?.length || selectedCount === 0}>
                <CheckCircle2 /> Save {selectedCount || "selected"}
              </Button>
            }
          >
            {result.rows?.length ? <KeywordTable rows={result.rows} selected={selected} setSelected={setSelected} /> : <EmptyState title="No keyword suggestions" text={result.warning || "No suggestions came back for this seed."} />}
          </ReportSection>
        ) : (
          <EmptyState title="No research run" text="Enter a seed keyword to build the first keyword set." />
        )}
      </div>
    </>
  );
}

function KeywordTable({
  rows,
  selected,
  setSelected,
}: {
  rows: KeywordResult[];
  selected?: Record<string, boolean>;
  setSelected?: (value: Record<string, boolean>) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {selected && <TableHead className="w-10"></TableHead>}
          <TableHead>Keyword</TableHead>
          <TableHead>Volume</TableHead>
          <TableHead>Difficulty</TableHead>
          <TableHead>CPC</TableHead>
          <TableHead>Intent</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.keyword}>
            {selected && setSelected && (
              <TableCell>
                <Checkbox checked={Boolean(selected[row.keyword])} onCheckedChange={(checked) => setSelected({ ...selected, [row.keyword]: checked === true })} />
              </TableCell>
            )}
            <TableCell className="font-medium">{row.keyword}</TableCell>
            <TableCell className={keywordMetricClass(row.searchVolume)}>{formatMetricStatus(row.searchVolume)}</TableCell>
            <TableCell className={keywordMetricClass(row.difficulty)}>{formatMetricStatus(row.difficulty)}</TableCell>
            <TableCell className={keywordMetricClass(row.cpc)}>{formatMetricStatus(row.cpc)}</TableCell>
            <TableCell><Badge variant="outline">{row.intent}</Badge></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function SavedPage({ site }: { site: Site }) {
  const [rows, setRows] = useState<any[]>([]);
  const [tags, setTags] = useState<any[]>([]);
  const [metricImports, setMetricImports] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const selectedIds = Object.entries(selected).filter(([, checked]) => checked).map(([id]) => id);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await api.querySavedKeywords(site.id, {
        search,
        tagNames: tagFilter ? [tagFilter] : [],
        pageSize: 100,
        sort: "created_at",
        order: "desc",
      });
      setRows(data.rows || []);
      setTags(data.tags || await api.keywordTags(site.id));
      setMetricImports(await api.keywordMetricImports(site.id));
      setSelected({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load saved keywords");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch(console.error);
  }, [site.id]);

  async function applyTags(mode: "add" | "remove") {
    if (!selectedIds.length || !tagInput.trim()) return;
    setError("");
    setMessage("");
    try {
      await api.updateKeywordTags(site.id, {
        savedKeywordIds: selectedIds,
        ...(mode === "add" ? { addTags: tagInput.split(/\n|,/) } : { removeTagNames: tagInput.split(/\n|,/) }),
      });
      setMessage(mode === "add" ? "Tags added." : "Tags removed.");
      setTagInput("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update tags");
    }
  }

  async function removeSelected() {
    if (!selectedIds.length) return;
    setError("");
    setMessage("");
    try {
      await api.removeSavedKeywords(site.id, selectedIds);
      setMessage(`Deleted ${selectedIds.length} keywords.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete selected keywords");
    }
  }

  async function importMetricsCsv(event: FormEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setImporting(true);
    setError("");
    setMessage("");
    try {
      const csv = await file.text();
      const imported = await api.importKeywordMetrics({
        siteId: site.id,
        sourceName: file.name,
        csv,
      });
      setMessage(`Imported ${formatNumber(imported.rowCount || imported.row_count || 0)} keyword metric rows from ${file.name}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import keyword metrics CSV");
    } finally {
      input.value = "";
      setImporting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Saved keywords"
        description="The local canonical keyword list for clustering, rank tracking, MCP tools, and Codex briefs."
        action={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary">
              <a href={api.savedKeywordsCsvUrl(site.id)}>
                <Download />
                Export CSV
              </a>
            </Button>
            <Button variant="outline" onClick={load} disabled={loading}><RefreshCw /> {loading ? "Refreshing" : "Refresh"}</Button>
          </div>
        }
      />
      <section className="mb-6 rounded-2xl border border-border/70 bg-card p-5">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_auto] lg:items-end">
          <Field label="Search keywords">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search saved keywords" />
          </Field>
          <Field label="Tag filter">
            <Select value={tagFilter || "__all"} onValueChange={(value) => setTagFilter(value === "__all" ? "" : value)}>
              <SelectTrigger><SelectValue placeholder="Tag" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All tags</SelectItem>
                {tags.map((tag) => <SelectItem key={tag.id} value={tag.name}>{tag.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Button onClick={load} disabled={loading}><Search /> {loading ? "Loading" : "Apply"}</Button>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-border/60 pt-4">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <span>Keyword metrics</span>
              <InfoTip label="About keyword metrics imports">
                Import real keyword, volume, difficulty, CPC, and intent columns. Rows update the saved keyword list and matching rank tracker keywords.
              </InfoTip>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <StatusDot tone={metricImports.length ? "good" : "outline"} />
              <span>{metricImports.length ? `${formatNumber(metricImports.length)} imports saved` : "No metrics imported yet"}</span>
            </div>
          </div>
          <div className="w-full sm:w-80">
            <Field label="Import metrics CSV">
              <Input type="file" accept=".csv,text/csv" onChange={importMetricsCsv} disabled={importing} />
            </Field>
          </div>
        </div>
      </section>
      {error ? <p className="mb-4 rounded-lg bg-bad-soft/50 px-3.5 py-2.5 text-sm text-destructive">{error}</p> : null}
      {message ? <p className="mb-4 rounded-lg bg-primary/[0.07] px-3.5 py-2.5 text-sm text-primary">{message}</p> : null}
      {selectedIds.length > 0 && (
        <section className="mb-6 rounded-2xl border border-primary/25 bg-primary/[0.03] p-5 sm:p-6">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto] lg:items-end">
            <Field label="Tag names">
              <Input value={tagInput} onChange={(event) => setTagInput(event.target.value)} placeholder="tag names, comma separated" />
            </Field>
            <Button variant="secondary" onClick={() => applyTags("add")}><Tags /> Add tags</Button>
            <Button variant="outline" onClick={() => applyTags("remove")}>Remove tags</Button>
            <Button variant="destructive" onClick={removeSelected}><Trash2 /> Delete {selectedIds.length}</Button>
          </div>
        </section>
      )}
      <ReportSection title="Saved keyword list" meta={`${formatNumber(rows.length)} shown`}>
        {rows.length ? (
          <SavedKeywordsTable rows={rows} selected={selected} setSelected={setSelected} />
        ) : (
          <EmptyState
            title={loading ? "Loading keywords" : "No saved keywords"}
            text={loading ? "Reading the local keyword list." : "Save keywords from research or through the MCP tool."}
            action={!loading ? <Button asChild><Link to="/keywords"><Search /> Research keywords</Link></Button> : undefined}
          />
        )}
      </ReportSection>
      <div className="mt-6">
        <HistoryList title="Keyword metric imports" rows={metricImports} labelKey="sourceName" labelTitle="Source file" />
      </div>
    </>
  );
}

function SavedKeywordsTable({
  rows,
  selected,
  setSelected,
}: {
  rows: any[];
  selected: Record<string, boolean>;
  setSelected: (value: Record<string, boolean>) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10"></TableHead>
          <TableHead>Keyword</TableHead>
          <TableHead>Volume</TableHead>
          <TableHead>Difficulty</TableHead>
          <TableHead>CPC</TableHead>
          <TableHead>Intent</TableHead>
          <TableHead>Tags</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>
              <Checkbox checked={Boolean(selected[row.id])} onCheckedChange={(checked) => setSelected({ ...selected, [row.id]: checked === true })} />
            </TableCell>
            <TableCell className="font-medium">{row.keyword}</TableCell>
            <TableCell className={keywordMetricClass(row.search_volume)}>{formatMetricStatus(row.search_volume)}</TableCell>
            <TableCell className={keywordMetricClass(row.difficulty)}>{formatMetricStatus(row.difficulty)}</TableCell>
            <TableCell className={keywordMetricClass(row.cpc)}>{formatMetricStatus(row.cpc)}</TableCell>
            <TableCell><Badge variant="outline">{row.intent}</Badge></TableCell>
            <TableCell><TagList tags={row.tags || []} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function SerpPage({ site }: { site: Site }) {
  const [keyword, setKeyword] = useState("");
  const [domain, setDomain] = useState(site.domain);
  const [result, setResult] = useState<any>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setDomain(site.domain);
  }, [site.id, site.domain]);

  async function load() {
    try {
      setRuns(await api.serpRuns(site.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load SERP history");
    }
  }
  useEffect(() => {
    load().catch(console.error);
  }, [site.id]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = await api.analyzeSerp({ siteId: site.id, keyword, domain, depth: 20 });
      setResult(data);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "SERP analysis failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageHeader title="SERP analysis" description="Inspect ranking pages, active-site ownership, intent mix, and content opportunities for one query." />
      <section className="rounded-2xl border border-border/70 bg-card p-5">
        <form className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end" onSubmit={submit}>
          <Field label="Search query">
            <Input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="best local seo tool" required />
          </Field>
          <SiteDomainField
            label="Ranking domain"
            value={domain}
            siteDomain={site.domain}
            hint="Use the active site to check its rankings, or enter a competitor domain to compare."
            onChange={setDomain}
          />
          <Button disabled={loading || !keyword.trim()}><Activity /> {loading ? "Analyzing" : "Analyze SERP"}</Button>
        </form>
        {error ? <p className="mt-3 rounded-lg bg-bad-soft/50 px-3.5 py-2.5 text-sm text-destructive">{error}</p> : null}
      </section>
      <div className="mt-6 grid gap-6 2xl:grid-cols-[minmax(0,1fr)_460px]">
        <ReportSection
          title="Ranking pages"
          meta={
            result ? (
              <SourceMeta
                source={result.source}
                extra={
                  <>
                    <span>· Active site position: {result.domainPosition || "not found"}</span>
                    {result.warning ? <InfoTip label="Result warning">{result.warning}</InfoTip> : null}
                  </>
                }
              />
            ) : undefined
          }
        >
          {result?.rows?.length ? <SerpTable rows={result.rows} /> : <EmptyState title="No SERP yet" text="Analyze a keyword to save a local SERP run." />}
        </ReportSection>
        <ReportSection title="SERP history" meta={`${formatNumber(runs.length)} saved`}>
          {runs.length ? (
            <HistoryTable rows={runs} labelKey="keyword" labelTitle="Query" />
          ) : (
            <EmptyState title="No history" text="Analyze a keyword to create the first saved SERP run." />
          )}
        </ReportSection>
      </div>
    </>
  );
}

function SerpTable({ rows }: { rows: any[] }) {
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Rank</TableHead><TableHead>Domain</TableHead><TableHead>Title</TableHead><TableHead>URL</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={`${row.rank}:${row.url}`} className={row.isDomain ? "bg-accent/45" : ""}>
            <TableCell className="nums font-medium">{row.rank}</TableCell>
            <TableCell>{row.domain}</TableCell>
            <TableCell className="max-w-md truncate">{row.title}</TableCell>
            <TableCell className="max-w-xs truncate text-muted-foreground">{row.url}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function RankPage({ site }: { site: Site }) {
  const [trackers, setTrackers] = useState<any[]>([]);
  const [form, setForm] = useState({ domain: site.domain, keywords: "" });
  const [keywordDrafts, setKeywordDrafts] = useState<Record<string, string>>({});
  const [selectedKeywords, setSelectedKeywords] = useState<Record<string, Record<string, boolean>>>({});
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setForm((current) => ({ ...current, domain: site.domain }));
  }, [site.id, site.domain]);

  async function load() {
    try {
      setTrackers(await api.rankTrackers(site.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load rank trackers");
    }
  }
  useEffect(() => {
    load().catch(console.error);
  }, [site.id]);

  async function create(event: FormEvent) {
    event.preventDefault();
    setLoading("create");
    setError("");
    setMessage("");
    try {
      await api.createRankTracker({
        siteId: site.id,
        domain: form.domain,
        keywords: form.keywords.split(/\n|,/).map((item) => item.trim()).filter(Boolean),
      });
      setForm({ domain: site.domain, keywords: "" });
      setMessage("Rank tracker created.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create rank tracker");
    } finally {
      setLoading("");
    }
  }

  async function check(id: string) {
    setLoading(id);
    setError("");
    setMessage("");
    try {
      await api.runRankCheck(id);
      setMessage("Rank check finished.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rank check failed");
    } finally {
      setLoading("");
    }
  }

  async function addKeywords(trackerId: string) {
    const keywords = (keywordDrafts[trackerId] || "").split(/\n|,/).map((item) => item.trim()).filter(Boolean);
    if (!keywords.length) return;
    setLoading(`add-${trackerId}`);
    setError("");
    setMessage("");
    try {
      await api.addRankKeywords(trackerId, keywords);
      setKeywordDrafts({ ...keywordDrafts, [trackerId]: "" });
      setMessage(`Added ${keywords.length} keywords.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add keywords");
    } finally {
      setLoading("");
    }
  }

  async function removeKeywords(trackerId: string) {
    const ids = Object.entries(selectedKeywords[trackerId] || {}).filter(([, checked]) => checked).map(([id]) => id);
    if (!ids.length) return;
    setLoading(`remove-${trackerId}`);
    setError("");
    setMessage("");
    try {
      await api.removeRankKeywords(trackerId, ids);
      setSelectedKeywords({ ...selectedKeywords, [trackerId]: {} });
      setMessage(`Removed ${ids.length} keywords.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove keywords");
    } finally {
      setLoading("");
    }
  }

  async function syncMetrics(trackerId: string) {
    setLoading(`metrics-${trackerId}`);
    setError("");
    setMessage("");
    try {
      const result = await api.syncRankMetrics(trackerId);
      setMessage(`Synced imported metrics for ${formatNumber(result.updated || 0)} keywords${result.skipped ? `; ${formatNumber(result.skipped)} still need CSV metrics` : ""}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sync keyword metrics");
    } finally {
      setLoading("");
    }
  }

  return (
    <>
      <PageHeader title="Rank tracking" description="Track keyword positions from real search results. Checks use a connected search data source when available, OpenSERP when configured, or DuckDuckGo live results." />
      <div className="grid gap-6 2xl:grid-cols-[420px_minmax(0,1fr)]">
        <ReportSection title="New tracker">
          <form className="space-y-4" onSubmit={create}>
            <Field label="Domain"><Input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} required /></Field>
            <Field label="Keywords"><Textarea value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} placeholder="one per line" /></Field>
            <Button type="submit" disabled={loading === "create"}><Plus /> {loading === "create" ? "Adding" : "Add tracker"}</Button>
          </form>
          {error ? <p className="mt-4 rounded-lg bg-bad-soft/50 px-3.5 py-2.5 text-sm text-destructive">{error}</p> : null}
          {message ? <p className="mt-4 rounded-lg bg-primary/[0.07] px-3.5 py-2.5 text-sm text-primary">{message}</p> : null}
        </ReportSection>
        <div className="space-y-4">
          {trackers.length ? trackers.map((tracker) => (
            <ReportSection
              key={tracker.id}
              title={tracker.domain}
              meta={`${formatNumber(tracker.keywords.length)} keywords · depth ${tracker.serp_depth}`}
              action={
                <Button variant="secondary" size="sm" onClick={() => check(tracker.id)} disabled={loading === tracker.id}>
                  <Target /> {loading === tracker.id ? "Checking" : "Run check"}
                </Button>
              }
            >
              <Tabs defaultValue="latest">
                <TabsList>
                  <TabsTrigger value="latest">Latest</TabsTrigger>
                  <TabsTrigger value="keywords">Keywords</TabsTrigger>
                  <TabsTrigger value="runs">Runs</TabsTrigger>
                </TabsList>
                <TabsContent value="latest">
                  {tracker.latest?.length ? <RankTable rows={tracker.latest} /> : <EmptyState title="No snapshots" text="Run a check to create the first local rank snapshot." />}
                </TabsContent>
                <TabsContent value="keywords">
                  <div className="mb-4 space-y-3">
                    <Field label="Add tracked keywords">
                      <Textarea value={keywordDrafts[tracker.id] || ""} onChange={(event) => setKeywordDrafts({ ...keywordDrafts, [tracker.id]: event.target.value })} placeholder="add keywords, one per line" />
                    </Field>
                    <div className="flex flex-wrap gap-3">
                      <Button variant="secondary" onClick={() => addKeywords(tracker.id)} disabled={loading === `add-${tracker.id}`}><Plus /> {loading === `add-${tracker.id}` ? "Adding keywords" : "Add keywords"}</Button>
                      <Button variant="outline" onClick={() => syncMetrics(tracker.id)} disabled={loading === `metrics-${tracker.id}`}><RefreshCw /> {loading === `metrics-${tracker.id}` ? "Syncing metrics" : "Sync imported metrics"}</Button>
                      <Button asChild variant="outline"><Link to="/saved"><Upload /> Import metrics</Link></Button>
                      <Button variant="destructive" onClick={() => removeKeywords(tracker.id)} disabled={loading === `remove-${tracker.id}`}><Trash2 /> Remove selected</Button>
                    </div>
                  </div>
                  <RankKeywordTable
                    rows={tracker.keywords || []}
                    selected={selectedKeywords[tracker.id] || {}}
                    setSelected={(value) => setSelectedKeywords({ ...selectedKeywords, [tracker.id]: value })}
                  />
                </TabsContent>
                <TabsContent value="runs">
                  {tracker.runs?.length ? <RankRunsTable rows={tracker.runs} /> : <EmptyState title="No runs" text="Run a rank check to create history." />}
                </TabsContent>
              </Tabs>
            </ReportSection>
          )) : (
            <EmptyState
              title="No rank trackers"
              text="Create a tracker for this site, add keywords, then run a local rank check."
            />
          )}
        </div>
      </div>
    </>
  );
}

function RankTable({ rows }: { rows: any[] }) {
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Keyword</TableHead><TableHead>Position</TableHead><TableHead>URL</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={`${row.keyword}:${row.checked_at}`}>
            <TableCell className="font-medium">{row.keyword}</TableCell>
            <TableCell className="nums">{row.position || "Not found"}</TableCell>
            <TableCell className="max-w-md truncate text-muted-foreground">{row.url || "-"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function RankKeywordTable({
  rows,
  selected,
  setSelected,
}: {
  rows: any[];
  selected: Record<string, boolean>;
  setSelected: (value: Record<string, boolean>) => void;
}) {
  if (!rows.length) return <EmptyState title="No keywords" text="Add keywords to track positions." />;
  return (
    <Table>
      <TableHeader><TableRow><TableHead className="w-10"></TableHead><TableHead>Keyword</TableHead><TableHead>Volume</TableHead><TableHead>KD</TableHead><TableHead>CPC</TableHead><TableHead>Metrics</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell><Checkbox checked={Boolean(selected[row.id])} onCheckedChange={(checked) => setSelected({ ...selected, [row.id]: checked === true })} /></TableCell>
            <TableCell className="font-medium">{row.keyword}</TableCell>
            <TableCell className={keywordMetricClass(row.search_volume)}>{formatMetricStatus(row.search_volume)}</TableCell>
            <TableCell className={keywordMetricClass(row.keyword_difficulty)}>{formatMetricStatus(row.keyword_difficulty)}</TableCell>
            <TableCell className={keywordMetricClass(row.cpc)}>{formatMetricStatus(row.cpc)}</TableCell>
            <TableCell className="text-muted-foreground">{row.metrics_fetched_at ? formatDate(row.metrics_fetched_at) : "-"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function RankRunsTable({ rows }: { rows: any[] }) {
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Status</TableHead><TableHead>Message</TableHead><TableHead>Started</TableHead><TableHead>Finished</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell><Badge variant={row.status === "completed" ? "good" : row.status === "failed" ? "bad" : "warn"}>{row.status}</Badge></TableCell>
            <TableCell>{row.message}</TableCell>
            <TableCell className="text-muted-foreground">{formatDate(row.started_at)}</TableCell>
            <TableCell className="text-muted-foreground">{row.finished_at ? formatDate(row.finished_at) : "-"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
