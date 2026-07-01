import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Bot, ExternalLink, Sparkles } from "lucide-react";
import { api, type Site } from "../../api";
import { Badge, Button, Input, Label, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Textarea } from "@/components/ui";
import { EmptyState, Field, HistoryList, PageHeader, ProviderNotice, ReportSection, SourceBadge, StatsBand, StatusEvidenceTable } from "../shared";

export function BrandLookupPage({ site }: { site: Site }) {
  const [query, setQuery] = useState(site.domain || site.name);
  const [competitors, setCompetitors] = useState("");
  const [result, setResult] = useState<any>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setRuns(await api.brandLookupRuns(site.id));
  }
  useEffect(() => {
    setQuery(site.domain || site.name);
    setResult(null);
    load().catch(console.error);
  }, [site.id, site.domain, site.name]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      const data = await api.brandLookup({ siteId: site.id, query, competitors });
      setResult(data);
      await load();
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageHeader eyebrow="Visibility" title="Brand lookup" description="Check real web-search evidence for a brand or domain. The app does not invent answer-model visibility." />
      <div className="grid gap-6 2xl:grid-cols-[460px_minmax(0,1fr)]">
        <ReportSection title="Lookup" description="Competitors can be comma-separated or one per line. Local mode compares real search evidence and saves the run in SQLite.">
          <form className="space-y-4" onSubmit={submit}>
            <Field label="Brand or domain"><Input value={query} onChange={(event) => setQuery(event.target.value)} required /></Field>
            <Field label="Competitors"><Textarea value={competitors} onChange={(event) => setCompetitors(event.target.value)} placeholder="competitor.com, otherbrand" /></Field>
            <Button disabled={loading}><Sparkles /> {loading ? "Looking up" : "Run lookup"}</Button>
          </form>
        </ReportSection>
        <div className="space-y-6">
          {result ? <BrandLookupResult result={result} /> : <EmptyState title="No lookup yet" text="Run a brand lookup to save local visibility evidence." />}
          <HistoryList title="Lookup history" rows={runs} labelKey="query" labelTitle="Brand or domain" />
        </div>
      </div>
    </>
  );
}

function BrandLookupResult({ result }: { result: any }) {
  const shareRows = result.shareOfVoice || [];
  const totalShare = shareRows.reduce((sum: number, row: any) => sum + Number(row.value || 0), 0);
  const citationRows = result.citations || [];
  const recommendationRows = result.recommendations || [];
  return (
    <div className="space-y-6">
      {result.warning ? <ProviderNotice title="Lookup warning" text={result.warning} source={result.source} /> : null}
      <ReportSection
        title="Share of voice"
        description={<><SourceBadge source={result.source} /> {result.resolvedEntity ? <span className="ml-2">Resolved entity: {result.resolvedEntity}</span> : null}</>}
      >
        <div className="space-y-3">
          {shareRows.length ? shareRows.map((row: any) => {
            const percent = totalShare ? Math.round((Number(row.value || 0) / totalShare) * 100) : Number(row.value || 0);
            return (
              <div key={row.label} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className={row.isPrimary ? "font-semibold" : ""}>{row.label}</span>
                  <span className="nums">{percent}%</span>
                </div>
                <div className="h-2 rounded-full bg-muted">
                  <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.min(100, percent)}%` }} />
                </div>
              </div>
            );
          }) : <EmptyState title="No share data" text="Run with competitors or connect a visibility data source to compare entities." />}
        </div>
      </ReportSection>
      {result.platforms?.length ? (
        <StatsBand
          title="Platform visibility"
          items={(result.platforms || []).map((platform: any) => ({
            title: platform.platform.replaceAll("_", " "),
            value: `${platform.visibility}%`,
            detail: `${platform.mentions} mentions`,
          }))}
        />
      ) : null}
      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_460px]">
        <ReportSection title="Citations" description="Real web evidence used for this lookup.">
          {citationRows.length ? <CitationList rows={citationRows} /> : <EmptyState title="No citations" text="No citation rows came back for this lookup." />}
        </ReportSection>
        <ReportSection title="Next actions" description="Grounded recommendations saved with this lookup.">
          {recommendationRows.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">#</TableHead>
                  <TableHead>Recommended action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
              {recommendationRows.map((item: string, index: number) => (
                <TableRow key={item}>
                  <TableCell className="nums text-muted-foreground">{index + 1}</TableCell>
                  <TableCell className="text-sm leading-6">{item}</TableCell>
                </TableRow>
              ))}
              </TableBody>
            </Table>
          ) : <EmptyState title="No recommendations" text="Recommendations appear when the lookup source returns them." />}
        </ReportSection>
      </div>
    </div>
  );
}

function CitationList({ rows }: { rows: any[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Citation</TableHead>
          <TableHead>URL</TableHead>
          <TableHead>Evidence</TableHead>
          <TableHead className="text-right">Open</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((citation, index) => {
          const href = citation.url || citation.link || "";
          return (
            <TableRow key={`${href || citation.title}:${index}`}>
              <TableCell className="min-w-72">
                <div className="font-medium">{citation.title || href || "Citation"}</div>
              </TableCell>
              <TableCell className="min-w-72 break-all text-xs text-muted-foreground">{href || "-"}</TableCell>
              <TableCell className="min-w-96 text-sm leading-6 text-muted-foreground">
                {citation.snippet || citation.description || "-"}
              </TableCell>
              <TableCell className="text-right">
                {href ? (
                  <Button asChild size="sm" variant="outline">
                    <a href={href} target="_blank" rel="noreferrer">
                      <ExternalLink /> Open
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

export function PromptExplorerPage({ site }: { site: Site }) {
  const [prompt, setPrompt] = useState(`What are the best options for ${site.domain || site.name}?`);
  const [highlightBrand, setHighlightBrand] = useState(site.domain || site.name);
  const [result, setResult] = useState<any>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    const history = await api.promptExplorerRuns(site.id);
    setRuns(history);
  }
  useEffect(() => {
    setPrompt(`What are the best options for ${site.domain || site.name}?`);
    setHighlightBrand(site.domain || site.name);
    setResult(null);
    load().catch(console.error);
  }, [site.id, site.domain, site.name]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      const data = await api.promptExplorer({ siteId: site.id, prompt, highlightBrand, models: ["local_codex"] });
      setResult(data);
      await load();
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageHeader eyebrow="AI answers" title="Prompt explorer" description="Run prompts through local Codex. The app does not invent model-specific external answer data." />
      <div className="grid gap-6 2xl:grid-cols-[480px_minmax(0,1fr)]">
        <ReportSection title="Prompt" description="Local mode queues one Codex medium job and saves the result in SQLite.">
          <form className="space-y-4" onSubmit={submit}>
            <Field label="Prompt"><Textarea className="min-h-32" value={prompt} onChange={(event) => setPrompt(event.target.value)} required /></Field>
            <Field label="Highlight brand"><Input value={highlightBrand} onChange={(event) => setHighlightBrand(event.target.value)} /></Field>
            <StatusEvidenceTable
              rows={[
                {
                  title: "Local runner",
                  status: "Local Codex",
                  tone: "good",
                  text: "Prompt explorer queues one local Codex job and saves the run in SQLite.",
                },
                {
                  title: "Reasoning",
                  status: "Medium",
                  tone: "outline",
                  text: "Matches the app AI default. The full job output is read from the AI lab when complete.",
                },
              ]}
            />
            <Button disabled={loading}><Bot /> {loading ? "Exploring" : "Explore prompt"}</Button>
          </form>
        </ReportSection>
        <div className="space-y-6">
          {result ? <PromptResult result={result} /> : <EmptyState title="No prompt run" text="Run a prompt to queue local Codex analysis." />}
          <HistoryList title="Prompt history" rows={runs} labelKey="prompt" labelTitle="Prompt" />
        </div>
      </div>
    </>
  );
}

function PromptResult({ result }: { result: any }) {
  return (
    <div className="space-y-4">
      {result.warning ? <ProviderNotice title="Prompt warning" text={result.warning} source={result.source} /> : null}
      <ReportSection
        title="Run summary"
        description={<><SourceBadge source={result.source} /> {result.highlightBrand ? <span className="ml-2">Watching: {result.highlightBrand}</span> : null}</>}
      >
        <div className="space-y-4">
          <StatusEvidenceTable
            rows={[
              { title: "Prompt", status: "Saved", tone: "good", text: result.prompt || "Prompt saved with this run." },
              { title: "Runner", status: "Local Codex", tone: "good", text: "This run uses the local Codex job queue." },
              { title: "Local job", status: result.jobId ? "Queued" : "None", tone: result.jobId ? "warn" : "good", text: result.jobId ? "Open AI lab to read the Codex result when it finishes." : "No local Codex job was queued for this run." },
            ]}
          />
          {result.jobId ? <Button asChild variant="secondary"><Link to="/ai"><Bot /> Open AI lab</Link></Button> : null}
        </div>
      </ReportSection>
      <div className="grid gap-4 xl:grid-cols-2">
      {(result.results || []).map((row: any) => (
        <ReportSection
          key={row.model}
          title={row.model.replaceAll("_", " ")}
          description={row.warning || row.status}
        >
          <div className="space-y-4">
            <Badge variant={row.brandMentioned ? "good" : "outline"}>
              {row.brandMentioned ? "Mentioned" : "Not mentioned"}
            </Badge>
            <p className="text-sm leading-6">{row.text}</p>
            {row.fanOutQueries?.length ? (
              <div className="space-y-2">
                <Label>Fan-out queries</Label>
                <div className="flex flex-wrap gap-2">
                  {row.fanOutQueries.map((query: string) => <Badge key={query} variant="outline">{query}</Badge>)}
                </div>
              </div>
            ) : null}
            {row.citations?.length ? (
              <div className="space-y-1">
                <Label>Citations</Label>
                {row.citations.map((citation: any) => (
                  <a key={citation.url || citation.link || citation.title} href={citation.url || citation.link} target="_blank" rel="noreferrer" className="block truncate text-sm text-primary">{citation.title || citation.url || citation.link}</a>
                ))}
              </div>
            ) : null}
          </div>
        </ReportSection>
      ))}
      </div>
    </div>
  );
}
