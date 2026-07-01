import { cloneElement, isValidElement, useEffect, useId, useMemo, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import { BrowserRouter, Link, NavLink, Route, Routes, useNavigate, useParams } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  Cable,
  CalendarDays,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FileSearch,
  FileText,
  FolderKanban,
  Gauge,
  Globe2,
  Image,
  KeyRound,
  ListChecks,
  Link2,
  LogOut,
  ImageOff,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  TableProperties,
  Tags,
  Target,
  Trash2,
  Upload,
  Zap,
} from "lucide-react";
import { api, auth, type KeywordResult, type Site } from "./api";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Calendar,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@/components/ui";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/", label: "Overview", icon: Gauge, end: true },
  { to: "/sites", label: "Sites", icon: FolderKanban },
  { to: "/keywords", label: "Keywords", icon: Search },
  { to: "/serp", label: "SERP analysis", icon: Activity },
  { to: "/saved", label: "Saved keywords", icon: TableProperties },
  { to: "/rank", label: "Rank tracking", icon: Target },
  { to: "/domain", label: "Organic research", icon: Globe2 },
  { to: "/backlinks", label: "Links", icon: Link2 },
  { to: "/brand", label: "Brand lookup", icon: Sparkles },
  { to: "/prompts", label: "Prompt explorer", icon: Bot },
  { to: "/audits", label: "Audits", icon: FileSearch },
  { to: "/gsc", label: "Search Console", icon: BarChart3 },
  { to: "/ai", label: "AI lab", icon: Bot },
  { to: "/mcp", label: "MCP", icon: Cable },
  { to: "/settings", label: "Settings", icon: Settings },
];

const marketOptions = [
  { code: 2840, label: "United States" },
  { code: 2620, label: "Portugal" },
  { code: 2826, label: "United Kingdom" },
  { code: 2724, label: "Spain" },
  { code: 2250, label: "France" },
  { code: 2276, label: "Germany" },
  { code: 2076, label: "Brazil" },
  { code: 2124, label: "Canada" },
];

const languageOptions = [
  { code: "pt", label: "Portuguese" },
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
];

const crawlProtocolOptions = [
  { value: "auto", label: "Auto" },
  { value: "https", label: "HTTPS only" },
  { value: "http", label: "HTTP only" },
  { value: "both", label: "Try HTTP and HTTPS" },
] as const;

const crawlHostOptions = [
  { value: "auto", label: "Auto" },
  { value: "root", label: "Without www" },
  { value: "www", label: "With www" },
  { value: "both", label: "Try both" },
] as const;

type ScanPlanTarget = {
  domain?: string;
  crawl_protocol?: Site["crawl_protocol"];
  crawl_host?: Site["crawl_host"];
};

function defaultLocationCodeFromConfig(config?: any) {
  const code = Number(config?.default_location_code || 2840);
  return marketOptions.some((market) => market.code === code) ? code : 2840;
}

function defaultLanguageCodeFromConfig(config?: any) {
  const code = String(config?.default_language_code || "en");
  return languageOptions.some((language) => language.code === code) ? code : "en";
}

function defaultCrawlProtocolFromConfig(config?: any): Site["crawl_protocol"] {
  const value = String(config?.default_crawl_protocol || "auto");
  return crawlProtocolOptions.some((option) => option.value === value) ? value as Site["crawl_protocol"] : "auto";
}

function defaultCrawlHostFromConfig(config?: any): Site["crawl_host"] {
  const value = String(config?.default_crawl_host || "auto");
  return crawlHostOptions.some((option) => option.value === value) ? value as Site["crawl_host"] : "auto";
}

const activeSiteStorageKey = "local-seo:site";
const legacySiteStorageKey = "local-seo:project";
const legacySelectedAuditStorageKey = "local-seo:selected-audit";
const selectedAuditStoragePrefix = "local-seo:selected-audit";

function selectedAuditStorageKey(siteId: string) {
  return `${selectedAuditStoragePrefix}:${siteId}`;
}

function getSelectedAuditId(siteId: string) {
  return localStorage.getItem(selectedAuditStorageKey(siteId)) || localStorage.getItem(legacySelectedAuditStorageKey) || "";
}

function setSelectedAuditId(siteId: string, auditId: string) {
  localStorage.setItem(selectedAuditStorageKey(siteId), auditId);
  localStorage.removeItem(legacySelectedAuditStorageKey);
}

function clearSelectedAuditId(siteId?: string) {
  if (siteId) localStorage.removeItem(selectedAuditStorageKey(siteId));
  localStorage.removeItem(legacySelectedAuditStorageKey);
}

function marketLabel(code: number) {
  return marketOptions.find((item) => item.code === Number(code))?.label || `Market ${code}`;
}

function languageLabel(code: string) {
  return languageOptions.find((item) => item.code === code)?.label || code;
}

function keywordToolDefaultsLabel(site: Site) {
  return `${marketLabel(site.location_code)} · ${languageLabel(site.language_code)}`;
}

function KeywordToolDefaultsPanel({
  expanded,
  locationCode,
  languageCode,
  onToggle,
  onLocationCodeChange,
  onLanguageCodeChange,
}: {
  expanded: boolean;
  locationCode: number;
  languageCode: string;
  onToggle: () => void;
  onLocationCodeChange: (value: number) => void;
  onLanguageCodeChange: (value: string) => void;
}) {
  return (
    <div className="rounded-md border bg-muted/15">
      <Button
        type="button"
        variant="ghost"
        className="h-auto w-full justify-between gap-4 rounded-none px-4 py-3 text-left hover:bg-muted/40"
        onClick={onToggle}
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold">Keyword tool defaults</span>
          <span className="mt-1 block text-xs leading-5 text-muted-foreground">
            Optional. Used by keyword research, SERP checks, and rank tracking. Audits crawl every page language they find.
          </span>
        </span>
        <Badge variant="outline" className="shrink-0">
          {marketLabel(locationCode)} · {languageLabel(languageCode)}
        </Badge>
      </Button>
      {expanded ? (
        <div className="grid gap-4 border-t p-4 sm:grid-cols-2">
          <Field label="Market">
            <Select value={String(locationCode)} onValueChange={(value) => onLocationCodeChange(Number(value))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {marketOptions.map((market) => <SelectItem key={market.code} value={String(market.code)}>{market.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Result language">
            <Select value={languageCode} onValueChange={onLanguageCodeChange}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {languageOptions.map((language) => <SelectItem key={language.code} value={language.code}>{language.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </div>
      ) : null}
    </div>
  );
}

function localSiteHost(domain: string) {
  const host = (
    domain.startsWith("[") && domain.includes("]")
      ? domain.slice(1, domain.indexOf("]"))
      : domain.split(":")[0]
  )?.toLowerCase() || "";
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
}

function defaultAuditUrl(domain?: string) {
  const clean = cleanSiteDomain(domain);
  if (!clean) return "";
  return `${localSiteHost(clean) ? "http" : "https"}://${clean}`;
}

function cleanSiteDomain(domain?: string) {
  return String(domain || "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
}

function hostFromUrl(value?: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).host.toLowerCase();
  } catch {
    return cleanSiteDomain(raw);
  }
}

function auditSiteName(row: any) {
  return row.project_name || row.project_domain || hostFromUrl(row.url) || "Unlinked saved site";
}

function auditSiteDetail(row: any) {
  if (row.project_domain) return row.project_domain;
  const host = hostFromUrl(row.url);
  return host ? `Scan URL host: ${host}` : "Saved site record unavailable";
}

function scanHostCandidates(domain: string, crawlHost?: Site["crawl_host"]) {
  const root = domain.replace(/^www\./i, "");
  if (!root || localSiteHost(root)) return root ? [root] : [];
  const www = `www.${root}`;
  if (crawlHost === "root") return [root];
  if (crawlHost === "www") return [www];
  return [root, www];
}

function scanProtocolCandidates(domain: string, crawlProtocol?: Site["crawl_protocol"]) {
  if (crawlProtocol === "https") return ["https"];
  if (crawlProtocol === "http") return ["http"];
  return localSiteHost(domain) ? ["http", "https"] : ["https", "http"];
}

function scanTargetCandidates(site?: ScanPlanTarget | null) {
  const clean = cleanSiteDomain(site?.domain);
  if (!clean) return [];
  const hosts = scanHostCandidates(clean, site?.crawl_host || "auto");
  const protocols = scanProtocolCandidates(clean, site?.crawl_protocol || "auto");
  const urls = protocols.flatMap((protocol) => hosts.map((host) => `${protocol}://${host}`));
  return Array.from(new Set(urls));
}

function preferredAuditUrl(site?: ScanPlanTarget | null) {
  return scanTargetCandidates(site)[0] || "";
}

function crawlPreferenceLabel(site?: ScanPlanTarget | null) {
  const protocol = crawlProtocolOptions.find((item) => item.value === (site?.crawl_protocol || "auto"))?.label || "Auto";
  const host = crawlHostOptions.find((item) => item.value === (site?.crawl_host || "auto"))?.label || "Auto";
  return `${protocol} · ${host}`;
}

function scanTargetDetail(site?: ScanPlanTarget | null) {
  const candidates = scanTargetCandidates(site);
  if (!candidates.length) return "Set a website address to scan.";
  if (candidates.length === 1) return `${crawlPreferenceLabel(site)} · ${candidates[0]}`;
  return `${crawlPreferenceLabel(site)} · ${formatNumber(candidates.length)} possible crawl URLs`;
}

function scanTargetShortDetail(site?: ScanPlanTarget | null) {
  const candidates = scanTargetCandidates(site);
  if (!candidates.length) return "No crawl URL";
  return `${crawlPreferenceLabel(site)} · ${formatNumber(candidates.length)} crawl URL${candidates.length === 1 ? "" : "s"}`;
}

function scanTargetCountLabel(site?: ScanPlanTarget | null) {
  const count = scanTargetCandidates(site).length;
  return `${formatNumber(count)} crawl URL${count === 1 ? "" : "s"}`;
}

function ScanTargetPills({
  site,
  compact = false,
}: {
  site?: ScanPlanTarget | null;
  compact?: boolean;
}) {
  const candidates = scanTargetCandidates(site);
  if (!candidates.length) return <span className="text-sm text-muted-foreground">Set a website address</span>;
  return (
    <div className={cn("flex flex-wrap gap-2", compact ? "gap-1.5" : "")}>
      {candidates.map((candidate, index) => (
        <span
          key={candidate}
          className={cn(
            "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border bg-background px-2.5 py-1 text-xs font-medium",
            compact ? "px-2 py-0.5" : "",
          )}
        >
          <span className="text-muted-foreground">{index + 1}</span>
          <span className="min-w-0 truncate">{candidate}</span>
        </span>
      ))}
    </div>
  );
}

function ScanPlanSummary({
  site,
  compact = false,
}: {
  site?: ScanPlanTarget | null;
  compact?: boolean;
}) {
  return (
    <div className={cn("space-y-2", compact ? "space-y-1.5" : "")}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{scanTargetCountLabel(site)}</Badge>
        <Badge variant="outline">{crawlPreferenceLabel(site)}</Badge>
      </div>
      <ScanTargetPills site={site} compact={compact} />
    </div>
  );
}

function ScanPlanPreview({ site }: { site?: ScanPlanTarget | null }) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Scan plan preview</div>
          <div className="mt-0.5 text-xs text-muted-foreground">The scan button will try these URLs in this order.</div>
        </div>
        <Badge variant="outline">{scanTargetCountLabel(site)}</Badge>
      </div>
      <ScanTargetPills site={site} compact />
    </div>
  );
}

function siteDisplayName(site?: Site | null) {
  if (!site) return "No site";
  return site.name;
}

function siteSelectLabel(site: Site) {
  const domain = site.domain || "No website address";
  return `${siteDisplayName(site)} · ${domain} · ${scanTargetShortDetail(site)}`;
}

function ActiveSiteSelect({
  sites,
  activeSiteId,
  onSelect,
}: {
  sites: Site[];
  activeSiteId: string;
  onSelect: (id: string) => void;
}) {
  if (!sites.length) {
    return (
      <Button asChild variant="secondary" className="w-full justify-start">
        <Link to="/sites"><Plus /> Add site</Link>
      </Button>
    );
  }
  return (
    <Select value={activeSiteId} onValueChange={onSelect}>
      <SelectTrigger className="min-w-0 [&_[data-slot=select-value]]:truncate">
        <SelectValue placeholder="Select site" />
      </SelectTrigger>
      <SelectContent className="max-w-[min(34rem,calc(100vw-2rem))]">
        {sites.map((site) => (
          <SelectItem key={site.id} value={site.id} className="whitespace-normal leading-snug">
            {siteSelectLabel(site)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const generatedId = useId();
  const fallbackId = `field-${generatedId.replace(/:/g, "")}`;
  const childId = isValidElement(children) ? ((children.props as { id?: string }).id || fallbackId) : undefined;
  const field = isValidElement(children)
    ? cloneElement(children as ReactElement<{ id?: string }>, { id: childId })
    : children;
  return (
    <div className="space-y-2">
      <Label htmlFor={childId}>{label}</Label>
      {field}
    </div>
  );
}

function SiteTargetField({
  label,
  value,
  siteDomain,
  hint,
  onChange,
}: {
  label: string;
  value: string;
  siteDomain: string;
  hint?: string;
  onChange: (value: string) => void;
}) {
  const usingSelectedSite = cleanSiteDomain(value) === cleanSiteDomain(siteDomain);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label>{label}</Label>
        {siteDomain ? (
          <div className="flex items-center gap-2">
            <Badge variant={usingSelectedSite ? "good" : "outline"}>
              {usingSelectedSite ? "Selected site" : "Competitor/custom site"}
            </Badge>
            {!usingSelectedSite ? (
              <Button type="button" size="sm" variant="ghost" onClick={() => onChange(siteDomain)}>
                Use selected site
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <Input aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} placeholder={siteDomain || "example.com"} />
      {siteDomain ? <p className="text-xs text-muted-foreground">Selected site: {siteDomain}</p> : null}
      {hint ? <p className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function parseDateInput(value: string) {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function formatDateInput(date?: Date) {
  if (!date || Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateLabel(value: string) {
  const date = parseDateInput(value);
  if (!date) return "Pick date";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function DatePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="w-full justify-start text-left font-normal">
          <CalendarDays className="size-4" />
          {formatDateLabel(value)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-3">
        <Calendar
          mode="single"
          selected={parseDateInput(value)}
          onSelect={(date) => date && onChange(formatDateInput(date))}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}

function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed bg-muted/30 p-8 text-center">
      <p className="font-medium">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{text}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

type StatItem = {
  title: string;
  value: unknown;
  icon?: any;
  detail?: ReactNode;
};

function StatsBand({
  title,
  text,
  items,
}: {
  title?: string;
  text?: string;
  items: StatItem[];
}) {
  return (
    <section className="rounded-md border bg-background">
      {title || text ? (
        <div className="border-b px-5 py-4">
          {title ? <h2 className="text-lg font-semibold">{title}</h2> : null}
          {text ? <p className="mt-1 text-sm leading-6 text-muted-foreground">{text}</p> : null}
        </div>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Metric</TableHead>
            <TableHead>Value</TableHead>
            <TableHead>Evidence</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <TableRow key={item.title}>
                <TableCell className="min-w-56">
                  <div className="flex items-center gap-2 font-medium">
                    {Icon ? <Icon className="size-4 text-muted-foreground" /> : null}
                    {item.title}
                  </div>
                </TableCell>
                <TableCell className="min-w-40">
                  <span className="nums text-2xl font-semibold">{formatNumber(item.value)}</span>
                </TableCell>
                <TableCell className="min-w-80 text-sm leading-6 text-muted-foreground">
                  {item.detail || "Measured from the saved run."}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}

function ReportSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-md border bg-background">
      <div className="border-b px-5 py-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        {description ? <div className="mt-1 text-sm text-muted-foreground">{description}</div> : null}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function ProviderNotice({ title, text, source }: { title: string; text: string; source?: string }) {
  return (
    <div className="rounded-md border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={sourceVariant(source) as any}>{sourceLabel(source)}</Badge>
        <span className="font-medium">{title}</span>
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p>
    </div>
  );
}

type StatusEvidenceRow = {
  title: string;
  status: ReactNode;
  tone?: "default" | "secondary" | "outline" | "good" | "warn" | "bad";
  text: ReactNode;
};

function StatusEvidenceTable({ rows }: { rows: StatusEvidenceRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Area</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Evidence</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.title}>
            <TableCell className="min-w-48 font-medium">{row.title}</TableCell>
            <TableCell className="min-w-40">
              <Badge variant={(row.tone || "outline") as any} className="max-w-xs break-all whitespace-normal text-left">
                {row.status}
              </Badge>
            </TableCell>
            <TableCell className="min-w-80 text-sm leading-6 text-muted-foreground">{row.text}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-[420px] overflow-auto rounded-md bg-secondary p-4 text-xs leading-relaxed text-secondary-foreground">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function formatNumber(value: unknown) {
  if (value == null || value === "") return "-";
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat().format(number) : String(value);
}

function metricValue(...values: unknown[]) {
  return values.find((value) => value !== null && value !== undefined && value !== "") ?? null;
}

function hasMetric(value: unknown) {
  return value !== null && value !== undefined && value !== "";
}

function formatMetricStatus(value: unknown) {
  return hasMetric(value) ? formatNumber(value) : "Not available";
}

function keywordMetricClass(value: unknown) {
  return cn("nums", !hasMetric(value) && "text-left text-xs text-muted-foreground");
}

function formatBytes(value: unknown) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatPercent(value: unknown) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "-";
  return `${(number * 100).toFixed(1)}%`;
}

function formatPosition(value: unknown) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return "-";
  return number.toFixed(1);
}

function formatDate(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function sourceLabel(source?: string) {
  const labels: Record<string, string> = {
    dataforseo: "DataForSEO",
    "provider-not-configured": "Not connected",
    "dataforseo-error": "Data source error",
    "duckduckgo-suggest": "DuckDuckGo suggest",
    duckduckgo: "DuckDuckGo",
    searxng: "SearXNG",
    "web-search": "Web search",
    codex: "Local Codex",
    "search-error": "Search error",
    "suggest-error": "Suggest error",
  };
  if (source?.startsWith("openserp:")) return `OpenSERP ${source.split(":")[1] || ""}`.trim();
  return labels[source || ""] || source || "No source";
}

function sourceVariant(source?: string) {
  if (
    source === "dataforseo" ||
    source === "duckduckgo" ||
    source === "duckduckgo-suggest" ||
    source === "searxng" ||
    source === "web-search" ||
    source === "codex" ||
    source?.startsWith("openserp:")
  ) return "good";
  if (source?.includes("error")) return "bad";
  if (source === "provider-not-configured") return "warn";
  return "outline";
}

function TagList({ tags }: { tags: string[] }) {
  if (!tags?.length) return <span className="text-muted-foreground">-</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <Badge key={tag} variant="outline">{tag}</Badge>
      ))}
    </div>
  );
}

function SourceBadge({ source }: { source?: string }) {
  return <Badge variant={sourceVariant(source) as any}>{sourceLabel(source)}</Badge>;
}

function serpProviderStatus(config: any) {
  if (config?.openserp_url) return "OpenSERP";
  if (config?.searxng_url) return "SearXNG";
  return "DuckDuckGo";
}

function scanStatusLabel(status?: string) {
  if (status === "needs-provider") return "Not connected";
  if (!status) return "pending";
  return status.replaceAll("-", " ");
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-primary transition-all"
        style={{ width: `${Math.max(4, Math.min(100, value))}%` }}
      />
    </div>
  );
}

function auditProgress(audit: any) {
  if (!audit) return 0;
  if (audit.status === "completed" || audit.status === "failed") return 100;
  const limit = Number(audit.result?.limits?.maxPages || 100);
  const pageProgress = Math.min(70, Math.round((Number(audit.pages_crawled || 0) / Math.max(1, limit)) * 70));
  const phase = audit.result?.phase || "";
  const phaseProgress = phase.includes("links")
    ? 76
    : phase.includes("images")
      ? 84
      : phase.includes("assets")
        ? 90
        : phase.includes("deduplicating")
          ? 94
          : 8;
  return Math.min(96, Math.max(8, pageProgress, phaseProgress));
}

function auditIsActive(audit: any) {
  return audit?.status === "queued" || audit?.status === "running";
}

function sortAuditRows(rows: any[]) {
  return [...rows].sort((a, b) => {
    const bTime = new Date(b.created_at || b.updated_at || 0).getTime();
    const aTime = new Date(a.created_at || a.updated_at || 0).getTime();
    return bTime - aTime;
  });
}

function upsertAuditRow(rows: any[], audit: any) {
  if (!audit?.id) return rows;
  return sortAuditRows([audit, ...rows.filter((row) => row.id !== audit.id)]);
}

function auditPhaseKey(audit: any) {
  const phase = String(audit?.result?.phase || audit?.result?.summary?.phase || "").toLowerCase();
  if (audit?.status === "queued") return "queued";
  if (audit?.status === "failed") return "failed";
  if (audit?.status === "completed" || phase === "completed") return "completed";
  if (phase.includes("deduplicating")) return "report";
  if (phase.includes("css images")) return "images";
  if (phase.includes("assets")) return "assets";
  if (phase.includes("images")) return "images";
  if (phase.includes("links")) return "links";
  if (phase.includes("crawl")) return "crawl";
  if (phase.includes("robots")) return "robots";
  return "target";
}

function auditPhaseLabel(audit: any) {
  const labels: Record<string, string> = {
    queued: "Queued",
    failed: "Failed",
    completed: "Completed",
    report: "Building report",
    assets: "Checking CSS and JavaScript",
    images: "Checking images",
    links: "Checking links",
    crawl: "Crawling pages",
    robots: "Reading robots and sitemap",
    target: "Resolving start URL",
  };
  return labels[auditPhaseKey(audit)] || "Scanning";
}

function auditSeverityCounts(audit: any) {
  const summary = audit?.result?.summary?.bySeverity || {};
  const flatSummary = audit?.result?.summary || {};
  const issues = Array.isArray(audit?.result?.issues) ? audit.result.issues : [];
  return {
    high: Number(summary.high || flatSummary.high || issues.filter((issue: any) => issue.severity === "high").length || 0),
    medium: Number(summary.medium || flatSummary.medium || issues.filter((issue: any) => issue.severity === "medium").length || 0),
    low: Number(summary.low || flatSummary.low || issues.filter((issue: any) => issue.severity === "low").length || 0),
  };
}

function maxCount(...values: unknown[]) {
  const numbers = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 0);
  return numbers.length ? Math.max(...numbers) : 0;
}

function hasIndexabilityEvidence(page: any) {
  return typeof page?.indexable === "boolean";
}

function IndexabilityBadge({ page }: { page: any }) {
  if (!hasIndexabilityEvidence(page)) {
    return <Badge variant="outline">Unknown</Badge>;
  }
  return <Badge variant={page.indexable ? "good" : "bad"}>{page.indexable ? "Yes" : "No"}</Badge>;
}

function auditCoverageMetrics(audit: any, result: any = {}, summary: any = {}) {
  const pages = Array.isArray(result.pages) ? result.pages : [];
  const links = Array.isArray(result.links) ? result.links : [];
  const linkInventory = Array.isArray(result.linkInventory) ? result.linkInventory : [];
  const images = Array.isArray(result.images) ? result.images : [];
  const imageInventory = Array.isArray(result.imageInventory) ? result.imageInventory : [];
  const assets = Array.isArray(result.assets) ? result.assets : [];
  const sitemapUrls = Array.isArray(result.sitemap?.urls) ? result.sitemap.urls : [];
  const pageCount = maxCount(summary.pages, audit?.pages_crawled, pages.length);
  const indexabilityKnownPages = pages.filter(hasIndexabilityEvidence).length;
  const indexablePages = maxCount(summary.indexablePages, pages.filter((page: any) => page.indexable === true).length);
  const nonIndexablePages = maxCount(summary.nonIndexablePages, pages.filter((page: any) => page.indexable === false).length);
  const checkedLinks = maxCount(summary.checkedLinks, links.length);
  const checkedImages = maxCount(summary.checkedImages, images.length);
  const checkedAssets = maxCount(summary.checkedAssets, assets.length);
  const indexabilityUnknownFromRows = Math.max(0, pageCount - indexabilityKnownPages);
  const unknownIndexabilityPages = Number.isFinite(Number(summary.unknownIndexabilityPages))
    ? Number(summary.unknownIndexabilityPages)
    : indexabilityUnknownFromRows;

  return {
    pages: pageCount,
    indexablePages: pages.length ? pages.filter((page: any) => page.indexable === true).length : indexablePages,
    nonIndexablePages: pages.length ? pages.filter((page: any) => page.indexable === false).length : nonIndexablePages,
    unknownIndexabilityPages,
    sitemapUrls: maxCount(summary.sitemapUrls, sitemapUrls.length, pages.filter((page: any) => page.sitemapListed).length),
    pagesMissingFromSitemap: maxCount(summary.pagesMissingFromSitemap, pages.filter((page: any) => page.sitemapListed === false).length),
    noindexPagesInSitemap: maxCount(summary.noindexPagesInSitemap, pages.filter((page: any) => page.sitemapListed && page.indexable === false).length),
    orphanPages: maxCount(summary.orphanPages, pages.filter((page: any) => Number(page.depth || 0) > 0 && Number(page.internalInlinks || 0) === 0).length),
    deepPages: maxCount(summary.deepPages, pages.filter((page: any) => Number(page.depth || 0) >= 4).length),
    linkTags: maxCount(summary.linkTags, linkInventory.length, pages.reduce((total: number, page: any) => total + Number(page.internalLinks || 0) + Number(page.externalLinks || 0), 0)),
    imageTags: maxCount(summary.imageTags, imageInventory.length, pages.reduce((total: number, page: any) => total + Number(page.images || 0), 0)),
    assetTags: maxCount(summary.assetTags, pages.reduce((total: number, page: any) => total + Number(page.assets || 0), 0), checkedAssets),
    checkedLinks,
    checkedImages,
    checkedAssets,
    cssImageResources: maxCount(summary.cssImageResources, images.filter((image: any) => image.purpose === "css-url" || image.purpose === "external-css-url").length),
    brokenLinks: maxCount(summary.brokenLinks, links.filter((link: any) => link.ok === false).length),
    brokenImages: maxCount(summary.brokenImages, images.filter((image: any) => image.ok === false).length),
    brokenAssets: maxCount(summary.brokenAssets, assets.filter((asset: any) => asset.ok === false).length),
    redirectedLinks: maxCount(summary.redirectedLinks, links.filter((link: any) => link.redirected || (link.finalUrl && link.finalUrl !== link.url)).length),
    redirectedImages: maxCount(summary.redirectedImages, images.filter((image: any) => image.redirected || (image.finalUrl && image.finalUrl !== image.url)).length),
    largeImages: maxCount(summary.largeImages, images.filter((image: any) => Number(image.contentLength || 0) > 500_000).length),
  };
}

function issueTypeCount(issues: any[], type: string) {
  return issues.filter((issue) => issue.type === type).length;
}

function issueTypesCount(issues: any[], types: string[]) {
  return issues.filter((issue) => types.includes(issue.type)).length;
}

type AuditCheckRowModel = {
  label: string;
  value: unknown;
  problem?: boolean;
  severity?: string;
  category?: string;
  types?: string[];
};

type AuditCheckSectionModel = {
  title: string;
  text: string;
  rows: AuditCheckRowModel[];
};

function pageIssueTypeCount(page: any, type: string) {
  return (page.issues || []).filter((issue: any) => issue.type === type).length;
}

function pageIssueTypesCount(page: any, types: string[]) {
  return (page.issues || []).filter((issue: any) => types.includes(issue.type)).length;
}

function latestCompletedAudit(rows: any[]) {
  return (rows || []).find((audit) => audit?.status === "completed" && audit?.result) || null;
}

function defaultEvidenceAudit(rows: any[]) {
  const sorted = sortAuditRows(rows || []);
  return latestCompletedAudit(sorted) || sorted[0] || null;
}

function auditIssueCount(row: any) {
  return Number(row?.issues?.length || 0);
}

function issueCategoryLabel(value: string) {
  const labels: Record<string, string> = {
    indexability: "Indexability",
    metadata: "Metadata",
    headings: "Headings",
    content: "Content",
    links: "Links",
    images: "Images",
    assets: "CSS/JS assets",
    canonicals: "Canonicals",
    "structured-data": "Structured data",
    social: "Social",
    performance: "Performance",
    security: "Security",
    localization: "Localization",
    sitemap: "Sitemap",
    robots: "Robots",
    crawl: "Crawl",
  };
  return labels[value] || value;
}

function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">{eyebrow}</div>
        <h1 className="page-title mt-2 text-3xl font-semibold">{title}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

function LoginScreen({ setupRequired, onSuccess }: { setupRequired: boolean; onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      if (setupRequired) await auth.setup(email, password);
      else await auth.login(email, password, remember);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grain flex min-h-screen items-center justify-center px-5">
      <Card className="relative z-10 w-full max-w-md">
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <ShieldCheck className="size-5" />
            </div>
            <div>
              <CardTitle className="text-xl">Local SEO</CardTitle>
              <CardDescription>
                {setupRequired ? "Create the single local admin." : "Sign in to your local SEO app."}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            <Field label="Email">
              <Input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
            </Field>
            <Field label="Password">
              <Input value={password} onChange={(event) => setPassword(event.target.value)} type="password" required minLength={10} />
            </Field>
            {!setupRequired && (
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Checkbox checked={remember} onCheckedChange={(checked) => setRemember(checked === true)} />
                Keep me signed in
              </label>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button className="w-full" type="submit" disabled={loading}>
              <KeyRound />
              {loading ? "Working..." : setupRequired ? "Create admin" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function AppWorkspace() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}

function AppShell() {
  const [sites, setSites] = useState<Site[]>([]);
  const [activeSiteId, setActiveSiteId] = useState(
    localStorage.getItem(activeSiteStorageKey) || localStorage.getItem(legacySiteStorageKey) || "",
  );
  const [sitesLoading, setSitesLoading] = useState(true);
  const [sitesError, setSitesError] = useState("");
  const [shellScanning, setShellScanning] = useState(false);
  const [shellScanError, setShellScanError] = useState("");
  const navigate = useNavigate();
  const activeSite = useMemo(
    () => sites.find((site) => site.id === activeSiteId) || sites[0],
    [sites, activeSiteId],
  );

  async function loadSites() {
    if (!sites.length) setSitesLoading(true);
    setSitesError("");
    try {
      const rows = await api.sites();
      setSites(rows);
      if (rows.length === 0) {
        setActiveSiteId("");
        localStorage.removeItem(activeSiteStorageKey);
        localStorage.removeItem(legacySiteStorageKey);
        return;
      }
      if (rows.length > 0 && !rows.some((site) => site.id === activeSiteId)) {
        const nextActive = rows[0];
        setActiveSiteId(nextActive.id);
        localStorage.setItem(activeSiteStorageKey, nextActive.id);
        localStorage.removeItem(legacySiteStorageKey);
      }
    } catch (err) {
      setSitesError(err instanceof Error ? err.message : "Could not load local sites");
      throw err;
    } finally {
      setSitesLoading(false);
    }
  }

  useEffect(() => {
    loadSites().catch(console.error);
  }, []);

  function selectSite(id: string) {
    setActiveSiteId(id);
    localStorage.setItem(activeSiteStorageKey, id);
    localStorage.removeItem(legacySiteStorageKey);
    setShellScanError("");
  }

  async function scanActiveSite() {
    if (!activeSite?.domain) {
      navigate("/sites");
      return;
    }
    setShellScanning(true);
    setShellScanError("");
    try {
      const result = await api.scanSite(activeSite.id);
      if (result.audit?.id) {
        setSelectedAuditId(activeSite.id, result.audit.id);
        navigate(`/audits/${result.audit.id}`);
      } else {
        navigate("/audits");
      }
    } catch (err) {
      setShellScanError(err instanceof Error ? err.message : "Could not start site scan");
    } finally {
      setShellScanning(false);
    }
  }

  async function logout() {
    await auth.logout().catch(() => undefined);
    window.location.reload();
  }

  return (
    <div className="grain min-h-screen">
        <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r bg-background/90 px-4 py-6 backdrop-blur lg:block">
          <Link to="/" className="flex items-center gap-3 px-2">
            <div className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Activity className="size-4" />
            </div>
            <div>
              <div className="text-sm font-bold uppercase tracking-[0.18em]">Local SEO</div>
              <div className="text-xs text-muted-foreground">Local SQLite</div>
            </div>
          </Link>

          <div className="mt-6 space-y-2">
            <Label>Active site</Label>
            <ActiveSiteSelect sites={sites} activeSiteId={activeSite?.id || ""} onSelect={selectSite} />
          </div>

          {activeSite?.domain ? (
            <div className="mt-3 rounded-md border bg-card p-3">
              <div className="text-xs font-medium text-muted-foreground">Scan plan</div>
              <div className="mt-2">
                <ScanPlanSummary site={activeSite} compact />
              </div>
              <Button className="mt-3 w-full justify-start" size="sm" onClick={scanActiveSite} disabled={shellScanning}>
                <FileSearch /> {shellScanning ? "Starting scan" : "Scan website"}
              </Button>
              {shellScanError ? <p className="mt-2 text-xs text-destructive">{shellScanError}</p> : null}
            </div>
          ) : (
            <Button asChild className="mt-3 w-full justify-start" size="sm">
              <Link to="/sites"><Plus /> Add website</Link>
            </Button>
          )}

          <nav className="mt-6 space-y-1">
            {nav.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    isActive ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:bg-card/70 hover:text-foreground",
                  )
                }
              >
                <Icon className="size-4" />
                {label}
              </NavLink>
            ))}
          </nav>

          <Button variant="ghost" className="absolute bottom-5 left-4 right-4 justify-start" onClick={logout}>
            <LogOut />
            Sign out
          </Button>
        </aside>

        <header className="sticky top-0 z-20 border-b bg-background/90 px-4 py-3 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between">
            <Link to="/" className="font-bold uppercase tracking-[0.18em]">Local SEO</Link>
            <Button size="sm" variant="outline" onClick={logout}>
              <LogOut />
            </Button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <ActiveSiteSelect sites={sites} activeSiteId={activeSite?.id || ""} onSelect={selectSite} />
            {activeSite?.domain ? (
              <Button size="sm" onClick={scanActiveSite} disabled={shellScanning}>
                <FileSearch /> {shellScanning ? "Starting" : "Scan"}
              </Button>
            ) : (
              <Button asChild size="sm"><Link to="/sites"><Plus /> Add</Link></Button>
            )}
          </div>
          <div className="mt-2">
            <Select onValueChange={(path) => navigate(path)}>
              <SelectTrigger>
                <SelectValue placeholder="Navigate" />
              </SelectTrigger>
              <SelectContent>
                {nav.map((item) => (
                  <SelectItem key={item.to} value={item.to}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {shellScanError ? <p className="mt-2 text-xs text-destructive">{shellScanError}</p> : null}
        </header>

        <main className="relative z-10 px-4 py-6 lg:ml-64 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-[1800px]">
            {sitesError ? (
              <EmptyState
                title="Could not load local sites"
                text={`${sitesError}. Your SQLite data was not cleared; the app could not read it from the local API.`}
                action={
                  <Button type="button" onClick={() => loadSites().catch(console.error)}>
                    <RefreshCw /> Retry
                  </Button>
                }
              />
            ) : sitesLoading ? (
              <div className="flex min-h-[50vh] items-center justify-center">
                <Badge>Loading local SQLite sites</Badge>
              </div>
            ) : activeSite ? (
              <Routes key={activeSite.id}>
                <Route path="/" element={<Overview site={activeSite} reloadSites={loadSites} selectSite={selectSite} />} />
                <Route path="/sites" element={<SitesPage sites={sites} reloadSites={loadSites} activeSiteId={activeSite.id} selectSite={selectSite} />} />
                <Route path="/keywords" element={<KeywordsPage site={activeSite} />} />
                <Route path="/serp" element={<SerpPage site={activeSite} />} />
                <Route path="/saved" element={<SavedPage site={activeSite} />} />
                <Route path="/rank" element={<RankPage site={activeSite} />} />
                <Route path="/domain" element={<DomainPage site={activeSite} />} />
                <Route path="/backlinks" element={<BacklinksPage site={activeSite} />} />
                <Route path="/brand" element={<BrandLookupPage site={activeSite} />} />
                <Route path="/prompts" element={<PromptExplorerPage site={activeSite} />} />
                <Route path="/audits" element={<AuditsPage site={activeSite} />} />
                <Route path="/audits/:auditId" element={<AuditReportRoute />} />
                <Route path="/gsc" element={<GscPage site={activeSite} />} />
                <Route path="/ai" element={<AiPage site={activeSite} />} />
                <Route path="/mcp" element={<McpPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Routes>
            ) : (
              <SitesPage sites={sites} reloadSites={loadSites} activeSiteId="" selectSite={selectSite} />
            )}
          </div>
        </main>
    </div>
  );
}

function Overview({
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
  const [scanAudit, setScanAudit] = useState<any>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [firstDomain, setFirstDomain] = useState("");
  const [firstName, setFirstName] = useState("");
  const [firstCrawlProtocol, setFirstCrawlProtocol] = useState<Site["crawl_protocol"]>("auto");
  const [firstCrawlHost, setFirstCrawlHost] = useState<Site["crawl_host"]>("auto");
  const [firstScanError, setFirstScanError] = useState("");
  const navigate = useNavigate();
  const scanLedgerRows = sortAuditRows(summary?.allAudits || summary?.latestAudits || []);

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
      setScanAudit(result.audit);
      if (result.audit?.id) {
        setSelectedAuditId(site.id, result.audit.id);
        navigate(`/audits/${result.audit.id}`);
      }
      setSummary(await api.dashboard(site.id));
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Could not start site scan");
    } finally {
      setScanning(false);
    }
  }

  function openAuditReport(auditId: string, row?: any) {
    setSelectedAuditId(row?.project_id || site.id, auditId);
    navigate(`/audits/${auditId}`);
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
      if (result.audit?.id) {
        setSelectedAuditId(created.id, result.audit.id);
      }
      await reloadSites();
      if (result.audit?.id) navigate(`/audits/${result.audit.id}`);
      else navigate("/audits");
    } catch (err) {
      setFirstScanError(err instanceof Error ? err.message : "Could not start the first scan");
    } finally {
      setScanning(false);
    }
  }

  useEffect(() => {
    if (!scanAudit || (scanAudit.status !== "queued" && scanAudit.status !== "running")) return;
    const interval = window.setInterval(async () => {
      const nextAudit = await api.audit(scanAudit.id);
      setScanAudit(nextAudit);
      if (nextAudit?.status === "completed" || nextAudit?.status === "failed") {
        setSummary(await api.dashboard(site.id));
      }
    }, 1500);
    return () => window.clearInterval(interval);
  }, [scanAudit?.id, scanAudit?.status]);

  const firstScanPlan = {
    domain: firstDomain,
    crawl_protocol: firstCrawlProtocol,
    crawl_host: firstCrawlHost,
  };

  return (
    <>
      <PageHeader
        eyebrow="Site overview"
        title={siteDisplayName(site)}
        description={site.domain ? "Reports, audits, crawl links, rankings, and Search Console use this site." : "Add a site to unlock scans, reports, rankings, and Search Console."}
        action={<Badge>{site.domain || "No site yet"}</Badge>}
      />
      {!site.domain ? (
        <section className="mb-6 rounded-md border border-primary/40 bg-background p-5">
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
        <section className="mb-6 rounded-md border border-primary/40 bg-background p-5">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">
              {scanAudit?.status === "completed" ? "Scan complete" : scanAudit?.status === "failed" ? "Scan failed" : "Scan running"} for {scan.scanUrl || scanAudit?.url || scan.site}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {scanAudit?.pages_crawled || 0} pages scanned · {scanAudit?.issue_count || 0} issues found
            </p>
          </div>
          <div className="space-y-4">
            <ProgressBar value={auditProgress(scanAudit)} />
            {scan.related?.length ? <ScanCoverageList rows={scan.related} auditStatus={scanAudit?.status} /> : null}
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="secondary">
                <Link to={scanAudit?.id ? `/audits/${scanAudit.id}` : "/audits"}>Open scan report</Link>
              </Button>
              <Button asChild variant="secondary"><Link to="/domain">View organic research</Link></Button>
              <Button asChild variant="secondary"><Link to="/backlinks">View links</Link></Button>
            </div>
          </div>
        </section>
      )}
      <SiteCommandCenter site={site} summary={summary} scanning={scanning} onScan={scanSite} />
      <div className="mt-6 grid gap-6 2xl:grid-cols-[minmax(0,1.1fr)_minmax(520px,0.9fr)]">
        <section className="rounded-md border bg-background">
          <div className="border-b px-5 py-4">
            <h2 className="text-lg font-semibold">Scan history</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatNumber(scanLedgerRows.length)} saved scans in local SQLite.
            </p>
          </div>
          <div className="p-5">
            {scanLedgerRows.length ? (
              <AuditTable rows={scanLedgerRows} showSite onInspect={openAuditReport} />
            ) : (
              <EmptyState
                title="No audits yet"
                text={site.domain ? "Start a technical scan for this site." : "Add a website address to start scanning."}
                action={
                  site.domain ? (
                    <Button onClick={scanSite} disabled={scanning}>
                      <FileSearch /> {scanning ? "Starting" : "Scan site now"}
                    </Button>
                  ) : (
                    <Button asChild><Link to="/sites"><Plus /> Add site</Link></Button>
                  )
                }
              />
            )}
          </div>
        </section>
        <section className="rounded-md border bg-background">
          <div className="border-b px-5 py-4">
            <h2 className="text-lg font-semibold">Codex job history</h2>
            <p className="mt-1 text-sm text-muted-foreground">Local AI work runs through the Codex CLI with medium reasoning.</p>
          </div>
          <div className="p-5">
            {summary?.latestAiJobs?.length ? (
              <JobTable rows={summary.latestAiJobs} />
            ) : (
              <EmptyState
                title="No AI jobs yet"
                text="Start a local Codex workflow when you need analysis or prioritization."
                action={<Button asChild variant="secondary"><Link to="/ai"><Bot /> Open AI lab</Link></Button>}
              />
            )}
          </div>
        </section>
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
  const latestAudit = summary?.latestAudits?.[0];
  const latestAuditSummary = latestAudit?.result?.summary || {};
  const latestGscImport = summary?.latestGscImport;
  const rows = [
    {
      key: "site",
      area: "Selected site",
      status: site.domain || "missing",
      evidence: site.domain
        ? `Scan plan: ${scanTargetShortDetail(site)} · starts at ${preferredAuditUrl(site)} · Keyword tools: ${keywordToolDefaultsLabel(site)}`
        : "Add a site before running audits, rankings, Search Console imports, or AI work.",
      action: site.domain ? (
        <Button size="sm" onClick={onScan} disabled={scanning}>
          <FileSearch /> {scanning ? "Starting" : "Scan website"}
        </Button>
      ) : (
        <Button asChild size="sm"><Link to="/sites"><Plus /> Add site</Link></Button>
      ),
      secondary: site.domain ? (
        <Button asChild size="sm" variant="outline"><Link to="/sites"><Pencil /> Edit site</Link></Button>
      ) : null,
    },
    {
      key: "audit",
      area: "Technical audit",
      status: latestAudit ? latestAudit.status : "not run",
      evidence: latestAudit
        ? `${formatNumber(latestAudit.pages_crawled)} pages · ${formatNumber(latestAudit.issue_count)} issues · ${formatNumber(latestAuditSummary.checkedLinks || 0)} links checked`
        : "No crawl evidence saved yet.",
      action: <Button asChild size="sm" variant="secondary"><Link to="/audits"><FileSearch /> Open audits</Link></Button>,
      secondary: latestAudit ? (
        <Button asChild size="sm" variant="outline">
          <Link to={`/audits/${latestAudit.id}`}><FileSearch /> Open report</Link>
        </Button>
      ) : null,
    },
    {
      key: "organic",
      area: "Organic research",
      status: summary?.savedKeywordCount ? "has keywords" : "ready",
      evidence: `${formatNumber(summary?.savedKeywordCount || 0)} saved keywords · local crawl pages feed this screen`,
      action: <Button asChild size="sm" variant="secondary"><Link to="/domain"><Globe2 /> Open organic</Link></Button>,
      secondary: null,
    },
    {
      key: "links",
      area: "Links",
      status: latestAudit ? "local graph" : "needs scan",
      evidence: latestAudit
        ? `${formatNumber(latestAuditSummary.linkTags || 0)} link tags · ${formatNumber(latestAuditSummary.brokenLinks || 0)} broken`
        : "Run a site scan to build the local link graph.",
      action: <Button asChild size="sm" variant="secondary"><Link to="/backlinks"><Link2 /> Open links</Link></Button>,
      secondary: null,
    },
    {
      key: "rank",
      area: "Rank tracking",
      status: summary?.trackerCount ? "tracking" : "manual",
      evidence: `${formatNumber(summary?.trackerCount || 0)} trackers · ${formatNumber(summary?.serpRunCount || 0)} SERP runs`,
      action: <Button asChild size="sm" variant="secondary"><Link to="/rank"><Target /> Open ranks</Link></Button>,
      secondary: null,
    },
    {
      key: "gsc",
      area: "Search Console",
      status: summary?.gscImportCount ? "local import" : "ready",
      evidence: summary?.gscImportCount
        ? `${formatNumber(summary.gscImportCount)} CSV imports · latest has ${formatNumber(latestGscImport?.rowCount || 0)} rows and ${formatNumber(latestGscImport?.totals?.clicks || 0)} clicks`
        : "Import a Search Console CSV locally, or connect Google for live performance and inspection.",
      action: <Button asChild size="sm" variant="secondary"><Link to="/gsc"><BarChart3 /> Open Search Console</Link></Button>,
      secondary: null,
    },
    {
      key: "ai",
      area: "AI lab",
      status: summary?.latestAiJobs?.length ? "has jobs" : "ready",
      evidence: `${formatNumber(summary?.latestAiJobs?.length || 0)} saved Codex jobs · runs locally with medium reasoning`,
      action: <Button asChild size="sm" variant="secondary"><Link to="/ai"><Bot /> Open AI lab</Link></Button>,
      secondary: null,
    },
  ];

  return (
    <section className="rounded-md border bg-background">
      <div className="border-b px-5 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Site control</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              One selected site feeds audits, local link evidence, rankings, Search Console, and AI work.
            </p>
          </div>
          {site.domain ? <Badge variant="outline">{scanTargetShortDetail(site)}</Badge> : null}
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Area</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Local evidence</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableCell className="font-medium">{row.area}</TableCell>
              <TableCell className="min-w-36"><Badge variant={row.status === "needs scan" || row.status === "not run" || row.status === "missing" ? "warn" : "outline"}>{row.status}</Badge></TableCell>
              <TableCell className="min-w-96 break-words text-sm text-muted-foreground">{row.evidence}</TableCell>
              <TableCell>
                <div className="flex justify-end gap-2">
                  {row.secondary}
                  {row.action}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

function ScanCoverageList({ rows, auditStatus }: { rows: any[]; auditStatus?: string }) {
  return (
    <div className="divide-y rounded-md border bg-background">
      {rows.map((row) => {
        const status = row.key === "technical-audit" && auditStatus ? auditStatus : row.status;
        const variant = status === "completed" || status === "queued" || status === "running" || status === "local" ? "good" : status === "needs-provider" ? "warn" : "outline";
        return (
          <div key={row.key} className="grid gap-3 p-4 lg:grid-cols-[220px_1fr_auto] lg:items-center">
            <div className="flex items-center gap-3">
              <Badge variant={variant as any}>{scanStatusLabel(status)}</Badge>
              <div className="font-medium">{row.label}</div>
            </div>
            <p className="text-sm leading-6 text-muted-foreground">{row.message}</p>
            {row.route ? (
              <Button asChild size="sm" variant="outline">
                <Link to={row.route}>{row.key === "technical-audit" ? "Open report" : `Open ${String(row.label || "").toLowerCase()}`}</Link>
              </Button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function SitesPage({
  sites,
  reloadSites,
  activeSiteId,
  selectSite,
}: {
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
    locationCode: 2840,
    languageCode: "en",
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
    location_code: 2840,
    language_code: "en",
    crawl_protocol: "auto",
    crawl_host: "auto",
  });
  const [error, setError] = useState("");
  const [scanningSiteId, setScanningSiteId] = useState("");
  const [creatingAction, setCreatingAction] = useState<"scan" | "save" | "">("");
  const navigate = useNavigate();

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
        if (result.audit?.id) {
          setSelectedAuditId(created.id, result.audit.id);
        }
        await reloadSites();
        if (result.audit?.id) navigate(`/audits/${result.audit.id}`);
        else navigate("/audits");
        return;
      }
      await reloadSites();
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
    setEditForm({
      name: site.name,
      domain: site.domain || "",
      notes: site.notes || "",
      location_code: site.location_code || 2840,
      language_code: site.language_code || "en",
      crawl_protocol: site.crawl_protocol || "auto",
      crawl_host: site.crawl_host || "auto",
    });
  }

  async function submitEdit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setError("");
    try {
      await api.updateSite(editing.id, editForm);
      setEditing(null);
      await reloadSites();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update site");
    }
  }

  async function deleteSite(site: Site) {
    setError("");
    try {
      await api.deleteSite(site.id);
      setDeleting(null);
      await reloadSites();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete site");
    }
  }

  async function scanSite(site: Site) {
    if (!site.domain) return;
    setError("");
    setScanningSiteId(site.id);
    try {
      const result = await api.scanSite(site.id);
      if (result.audit?.id) {
        setSelectedAuditId(site.id, result.audit.id);
      }
      setScanningSiteId("");
      selectSite(site.id);
      if (result.audit?.id) navigate(`/audits/${result.audit.id}`);
      else navigate("/audits");
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

  return (
    <>
      <PageHeader
        eyebrow="Websites"
        title="Sites"
        description="A site is one saved website address plus its crawl URL preferences. The selected site feeds scans, reports, crawl links, rankings, and Search Console."
        action={
          <Dialog open={open} onOpenChange={(nextOpen) => {
            setOpen(nextOpen);
            if (!nextOpen) setShowKeywordDefaults(false);
          }}>
            <DialogTrigger asChild>
              <Button><Plus /> Add site</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add site</DialogTitle>
                <DialogDescription>Add the website once, choose exactly how it should be reached, and start a local audit immediately.</DialogDescription>
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
        }
      />
      {error && <p className="mb-4 rounded-md border border-destructive/40 bg-muted/30 p-3 text-sm text-destructive">{error}</p>}
      {sites.length === 0 ? (
        <section className="rounded-md border border-primary/40 bg-background p-5">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">Start with a site scan</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">Add the website address once. The scan report opens automatically and stays saved locally.</p>
          </div>
          <form className="space-y-4" onSubmit={submit}>
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
              <Field label="Website address">
                <Input value={form.domain} onChange={(event) => setForm({ ...form, domain: event.target.value })} placeholder="example.com" required />
              </Field>
              <Field label="Site name">
                <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Site name (optional)" />
              </Field>
              <Button type="submit" disabled={Boolean(creatingAction)} className="lg:mb-px">
                <FileSearch /> {creatingAction === "scan" ? "Starting scan" : "Add site and scan"}
              </Button>
            </div>
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
          </form>
        </section>
      ) : (
        <section className="rounded-md border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Site</TableHead>
                <TableHead>Scan plan</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sites.map((site) => (
                <TableRow key={site.id} className={activeSiteId === site.id ? "bg-accent/35" : ""}>
                  <TableCell className="min-w-64">
                    <div className="font-medium">{site.name}</div>
                    <div className="text-xs text-muted-foreground">{site.domain || "Add a website address"}</div>
                  </TableCell>
                  <TableCell className="min-w-56">
                    <ScanPlanSummary site={site} compact />
                  </TableCell>
                  <TableCell className="max-w-md">
                    <div className="line-clamp-2 text-sm text-muted-foreground">{site.notes || "No notes yet."}</div>
                  </TableCell>
                  <TableCell>{activeSiteId === site.id ? <Badge variant="good">Active</Badge> : <Badge variant="outline">Available</Badge>}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap justify-end gap-2">
                      {activeSiteId !== site.id ? (
                        <Button size="sm" variant="secondary" onClick={() => selectSite(site.id)}>
                          Select site
                        </Button>
                      ) : null}
                      {site.domain ? (
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`Scan ${site.name}`}
                          title={`Scan ${site.domain}`}
                          disabled={scanningSiteId === site.id}
                          onClick={() => scanSite(site)}
                        >
                          <FileSearch /> {scanningSiteId === site.id ? "Starting" : "Scan site"}
                        </Button>
                      ) : null}
                      <Button size="sm" variant="outline" aria-label={`Edit ${site.name}`} onClick={() => startEdit(site)}>
                        <Pencil /> Edit
                      </Button>
                      <Button size="sm" variant="destructive" aria-label={`Delete ${site.name}`} onClick={() => setDeleting(site)}>
                        <Trash2 /> Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}
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
            <Button type="submit"><Pencil /> Save changes</Button>
          </form>
        </DialogContent>
      </Dialog>
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
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction type="button" onClick={() => deleting && deleteSite(deleting)}>
              Delete site
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function KeywordsPage({ site }: { site: Site }) {
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
      <PageHeader eyebrow="Research" title="Keyword research" description="Find real keyword suggestions. Volume, CPC, and difficulty show as unavailable unless a real metrics source is connected." />
      <section className="rounded-md border bg-background p-5">
        <form className="grid gap-3 lg:grid-cols-[1fr_120px_auto]" onSubmit={submit}>
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="seed keyword" />
          <Input value={limit} type="number" onChange={(e) => setLimit(Number(e.target.value))} />
          <Button disabled={loading}><Search /> {loading ? "Researching" : "Research"}</Button>
        </form>
        {error ? <p className="mt-3 rounded-md border border-destructive/40 bg-muted/30 p-3 text-sm text-destructive">{error}</p> : null}
        {message ? <p className="mt-3 rounded-md border border-primary/30 bg-muted/30 p-3 text-sm text-primary">{message}</p> : null}
      </section>
      <div className="mt-6">
        {result ? (
          <ReportSection title="Results" description={<><SourceBadge source={result.source} /> {result.warning ? <span className="ml-2">{result.warning}</span> : null}</>}>
            <div className="mb-4 flex justify-end">
              <Button variant="secondary" onClick={saveSelected} disabled={!result.rows?.length || selectedCount === 0}><CheckCircle2 /> Save {selectedCount || "selected"}</Button>
            </div>
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

function SavedPage({ site }: { site: Site }) {
  const [rows, setRows] = useState<any[]>([]);
  const [tags, setTags] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
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

  return (
    <>
      <PageHeader
        eyebrow="Repository"
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
      <section className="mb-6 rounded-md border bg-background p-5">
        <div className="grid gap-3 lg:grid-cols-[1fr_220px_auto]">
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search saved keywords" />
          <Select value={tagFilter || "__all"} onValueChange={(value) => setTagFilter(value === "__all" ? "" : value)}>
            <SelectTrigger><SelectValue placeholder="Tag" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All tags</SelectItem>
              {tags.map((tag) => <SelectItem key={tag.id} value={tag.name}>{tag.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={load} disabled={loading}><Search /> {loading ? "Loading" : "Apply"}</Button>
        </div>
      </section>
      {error ? <p className="mb-4 rounded-md border border-destructive/40 bg-muted/30 p-3 text-sm text-destructive">{error}</p> : null}
      {message ? <p className="mb-4 rounded-md border border-primary/30 bg-muted/30 p-3 text-sm text-primary">{message}</p> : null}
      {selectedIds.length > 0 && (
        <section className="mb-6 rounded-md border border-primary/40 bg-background p-5">
          <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto_auto]">
            <Input value={tagInput} onChange={(event) => setTagInput(event.target.value)} placeholder="tag names, comma separated" />
            <Button variant="secondary" onClick={() => applyTags("add")}><Tags /> Add tags</Button>
            <Button variant="outline" onClick={() => applyTags("remove")}>Remove tags</Button>
            <Button variant="destructive" onClick={removeSelected}><Trash2 /> Delete {selectedIds.length}</Button>
          </div>
        </section>
      )}
      <ReportSection title="Saved keyword list">
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

function SerpPage({ site }: { site: Site }) {
  const [keyword, setKeyword] = useState("");
  const [target, setTarget] = useState(site.domain);
  const [result, setResult] = useState<any>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setTarget(site.domain);
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
      const data = await api.analyzeSerp({ siteId: site.id, keyword, target, depth: 20 });
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
      <PageHeader eyebrow="SERP" title="SERP analysis" description="Inspect ranking pages, selected-site ownership, intent mix, and content opportunities for one query." />
      <section className="rounded-md border bg-background p-5">
        <form className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end" onSubmit={submit}>
          <Field label="Search query">
            <Input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="best local seo tool" required />
          </Field>
          <SiteTargetField
            label="SERP ownership site"
            value={target}
            siteDomain={site.domain}
            hint="Use the selected site or enter a competitor domain to highlight matching ranking rows."
            onChange={setTarget}
          />
          <Button disabled={loading || !keyword.trim()}><Activity /> {loading ? "Analyzing" : "Analyze SERP"}</Button>
        </form>
        {error ? <p className="mt-3 rounded-md border border-destructive/40 bg-muted/30 p-3 text-sm text-destructive">{error}</p> : null}
      </section>
      <div className="mt-6 grid gap-6 2xl:grid-cols-[minmax(0,1fr)_460px]">
        <ReportSection
          title="Ranking pages"
          description={
            result ? (
              <span className="flex flex-wrap items-center gap-2">
                <SourceBadge source={result.source} />
                <span>Selected site position: {result.targetPosition || "not found"}</span>
                {result.warning ? <span>{result.warning}</span> : null}
              </span>
            ) : "Run a query to inspect the SERP."
          }
        >
          {result?.rows?.length ? <SerpTable rows={result.rows} /> : <EmptyState title="No SERP yet" text="Analyze a keyword to save a local SERP run." />}
        </ReportSection>
        <ReportSection title="SERP history" description={`${formatNumber(runs.length)} saved local runs`}>
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
          <TableRow key={`${row.rank}:${row.url}`} className={row.isTarget ? "bg-accent/45" : ""}>
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

function RankPage({ site }: { site: Site }) {
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

  async function refreshMetrics(trackerId: string) {
    setLoading(`metrics-${trackerId}`);
    setError("");
    setMessage("");
    try {
      await api.refreshRankMetrics(trackerId);
      setMessage("Keyword metrics refreshed where a real metrics source is available.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh keyword metrics");
    } finally {
      setLoading("");
    }
  }

  return (
    <>
      <PageHeader eyebrow="SERP" title="Rank tracking" description="Track keyword positions from real search results. Checks use a connected search data source when available, OpenSERP when configured, or DuckDuckGo live results." />
      <div className="grid gap-6 2xl:grid-cols-[420px_minmax(0,1fr)]">
        <ReportSection title="New tracker" description="Add a domain and the keywords you want checked.">
          <form className="space-y-4" onSubmit={create}>
            <Field label="Domain"><Input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} required /></Field>
            <Field label="Keywords"><Textarea value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} placeholder="one per line" /></Field>
            <Button type="submit" disabled={loading === "create"}><Plus /> {loading === "create" ? "Adding" : "Add tracker"}</Button>
          </form>
          {error ? <p className="mt-4 rounded-md border border-destructive/40 bg-muted/30 p-3 text-sm text-destructive">{error}</p> : null}
          {message ? <p className="mt-4 rounded-md border border-primary/30 bg-muted/30 p-3 text-sm text-primary">{message}</p> : null}
        </ReportSection>
        <div className="space-y-4">
          {trackers.length ? trackers.map((tracker) => (
            <ReportSection
              key={tracker.id}
              title={tracker.domain}
              description={`${tracker.keywords.length} keywords · depth ${tracker.serp_depth}`}
            >
              <div className="mb-4 flex justify-end">
                <Button variant="secondary" onClick={() => check(tracker.id)} disabled={loading === tracker.id}>
                  <Target /> {loading === tracker.id ? "Checking" : "Run check"}
                </Button>
              </div>
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
                  <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_auto_auto_auto]">
                    <Textarea value={keywordDrafts[tracker.id] || ""} onChange={(event) => setKeywordDrafts({ ...keywordDrafts, [tracker.id]: event.target.value })} placeholder="add keywords, one per line" />
                    <Button variant="secondary" onClick={() => addKeywords(tracker.id)} disabled={loading === `add-${tracker.id}`}><Plus /> {loading === `add-${tracker.id}` ? "Adding" : "Add"}</Button>
                    <Button variant="outline" onClick={() => refreshMetrics(tracker.id)} disabled={loading === `metrics-${tracker.id}`}><RefreshCw /> {loading === `metrics-${tracker.id}` ? "Refreshing" : "Metrics"}</Button>
                    <Button variant="destructive" onClick={() => removeKeywords(tracker.id)} disabled={loading === `remove-${tracker.id}`}><Trash2 /> Remove</Button>
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
            <TableCell className="text-muted-foreground">{row.metrics_fetched_at || "-"}</TableCell>
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
            <TableCell className="text-muted-foreground">{row.started_at}</TableCell>
            <TableCell className="text-muted-foreground">{row.finished_at || "-"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function DomainPage({ site }: { site: Site }) {
  const navigate = useNavigate();
  const [target, setTarget] = useState(site.domain);
  const [overview, setOverview] = useState<any>(null);
  const [keywords, setKeywords] = useState<any>(null);
  const [pages, setPages] = useState<any>(null);
  const [auditRows, setAuditRows] = useState<any[]>([]);
  const [selectedAuditId, setSelectedAuditIdState] = useState("");
  const [history, setHistory] = useState<any[]>([]);
  const [tab, setTab] = useState("keywords");
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const selectedAudit = useMemo(
    () => auditRows.find((audit) => audit.id === selectedAuditId) || defaultEvidenceAudit(auditRows),
    [auditRows, selectedAuditId],
  );

  useEffect(() => {
    setTarget(site.domain);
    setOverview(null);
    setKeywords(null);
    setPages(null);
    setError("");
  }, [site.id, site.domain]);

  async function loadHistory() {
    const [snapshots, audits] = await Promise.all([
      api.domainSnapshots(site.id),
      api.audits(site.id),
    ]);
    setHistory(snapshots);
    const rows = sortAuditRows(audits);
    setAuditRows(rows);
    setSelectedAuditIdState((currentId) => {
      if (currentId && rows.some((audit) => audit.id === currentId)) return currentId;
      return defaultEvidenceAudit(rows)?.id || "";
    });
  }
  useEffect(() => {
    loadHistory().catch(console.error);
  }, [site.id]);

  async function run(event?: FormEvent) {
    event?.preventDefault();
    setLoading(true);
    setError("");
    const body = { siteId: site.id, domain: target, target, pageSize: 50 };
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

  async function scanSite() {
    if (!site.domain) {
      navigate("/sites");
      return;
    }
    setScanning(true);
    setError("");
    try {
      const result = await api.scanSite(site.id);
      if (result.audit?.id) {
        setSelectedAuditId(site.id, result.audit.id);
        navigate(`/audits/${result.audit.id}`);
      } else {
        navigate("/audits");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start site scan");
    } finally {
      setScanning(false);
    }
  }

  return (
    <>
      <PageHeader eyebrow="Competitive" title="Organic research" description="Ranked keywords and top pages for the selected site or a competitor site." />
      <section className="rounded-md border bg-background p-5">
        <form className="grid gap-3 lg:grid-cols-[1fr_auto]" onSubmit={run}>
          <SiteTargetField
            label="Organic research site"
            value={target}
            siteDomain={site.domain}
            hint="Use the selected site or enter a competitor domain. Local crawl evidence below comes from saved audits."
            onChange={setTarget}
          />
          <div className="flex items-end">
            <Button disabled={loading || !target.trim()}><Globe2 /> {loading ? "Analyzing" : "Analyze organic site"}</Button>
          </div>
        </form>
        {error ? <p className="mt-3 rounded-md border border-destructive/40 bg-muted/30 p-3 text-sm text-destructive">{error}</p> : null}
      </section>
      <div className="mt-6 grid gap-6 2xl:grid-cols-[minmax(0,1fr)_460px]">
        <div className="space-y-6">
          <LocalOrganicEvidence
            audit={selectedAudit}
            audits={auditRows}
            selectedAuditId={selectedAudit?.id || ""}
            onAuditChange={setSelectedAuditIdState}
            siteDomain={site.domain}
            onScan={scanSite}
            scanning={scanning}
          />
          {overview?.warning ? (
            <ProviderNotice title="External ranked-keyword dataset unavailable" text={overview.warning} source={overview.source} />
          ) : null}
          {overview?.source === "dataforseo" ? (
            <StatsBand
              title="Connected organic dataset"
              items={[
                { title: "Organic keywords", value: metricValue(overview.organicKeywords), icon: Search },
                { title: "Organic traffic", value: metricValue(overview.organicTraffic), icon: BarChart3 },
                { title: "Traffic value", value: metricValue(overview.estimatedValue), icon: Gauge },
                { title: "Top pages", value: metricValue(pages?.pages?.length, overview.topPages?.length), icon: Globe2 },
              ]}
            />
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
              {overview ? <OrganicSnapshot result={overview} target={target} keywordRows={keywords?.keywords?.length || 0} pageRows={pages?.pages?.length || 0} /> : <EmptyState title="No snapshot" text="Run an analysis to save the first organic research snapshot." />}
            </TabsContent>
          </Tabs>
        </div>
        <HistoryList title="Organic research history" rows={history} labelKey="target" labelTitle="Research site" />
      </div>
    </>
  );
}

function AuditRunPicker({
  label,
  audits,
  selectedAuditId,
  onAuditChange,
}: {
  label: string;
  audits: any[];
  selectedAuditId: string;
  onAuditChange: (auditId: string) => void;
}) {
  if (!audits.length) return null;
  const selected = audits.find((audit) => audit.id === selectedAuditId) || audits[0];
  return (
    <div className="w-full space-y-2 lg:w-[440px]">
      <Label>{label}</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Select value={selected?.id || ""} onValueChange={onAuditChange}>
          <SelectTrigger aria-label={label} className="min-w-0 flex-1">
            <SelectValue placeholder="Choose saved scan" />
          </SelectTrigger>
          <SelectContent>
            {audits.map((audit) => (
              <SelectItem key={audit.id} value={audit.id}>
                {formatDate(audit.created_at || audit.updated_at)} · {scanStatusLabel(audit.status)} · {formatNumber(audit.pages_crawled || 0)} pages · {audit.url}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button asChild variant="outline">
          <Link to={`/audits/${selected.id}`}><FileSearch /> Open report</Link>
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {formatNumber(audits.length)} saved scan{audits.length === 1 ? "" : "s"} available for this site.
      </p>
    </div>
  );
}

function LocalOrganicEvidence({
  audit,
  audits,
  selectedAuditId,
  onAuditChange,
  siteDomain,
  onScan,
  scanning,
}: {
  audit: any;
  audits: any[];
  selectedAuditId: string;
  onAuditChange: (auditId: string) => void;
  siteDomain: string;
  onScan: () => void;
  scanning: boolean;
}) {
  const pages = audit?.result?.pages || [];
  const rows = [...pages]
    .sort((a, b) => auditIssueCount(b) - auditIssueCount(a));
  const indexableCount = pages.filter((page: any) => page.indexable === true).length;
  const unknownIndexabilityCount = pages.filter((page: any) => !hasIndexabilityEvidence(page)).length;
  const missingTitleCount = pages.filter((page: any) => !page.title).length;
  const missingDescriptionCount = pages.filter((page: any) => !page.description).length;
  const h1IssueCount = pages.reduce((total: number, page: any) => total + pageIssueTypesCount(page, ["h1-count", "h1-empty"]), 0);
  return (
    <section className="rounded-md border bg-background">
      <div className="border-b px-5 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Local crawl pages</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Real page evidence from the selected saved audit. No external keyword or traffic estimates are generated here.
            </p>
          </div>
          <AuditRunPicker label="Saved scan for page evidence" audits={audits} selectedAuditId={selectedAuditId} onAuditChange={onAuditChange} />
        </div>
      </div>
      <div className="space-y-4 p-5">
        {!audit ? (
          <EmptyState
            title="No local crawl yet"
            text={siteDomain ? "Run a site audit once to fill this page with real crawl evidence." : "Add a website address and run an audit to fill this page."}
            action={siteDomain ? (
              <Button variant="secondary" onClick={onScan} disabled={scanning}>
                <FileSearch /> {scanning ? "Starting scan" : `Scan ${siteDomain}`}
              </Button>
            ) : (
              <Button asChild variant="secondary"><Link to="/sites"><Plus /> Add site</Link></Button>
            )}
          />
        ) : !audit.result ? (
          <EmptyState
            title={auditIsActive(audit) ? "Selected scan is still running" : "Selected scan has no crawl evidence"}
            text={auditIsActive(audit) ? "Open the scan report to watch progress. Evidence appears here after crawl data is saved." : audit.error || "This saved scan did not include crawl rows."}
            action={<Button asChild variant="secondary"><Link to={`/audits/${audit.id}`}><FileSearch /> Open scan report</Link></Button>}
          />
        ) : (
          <>
            <div className="divide-y rounded-md border bg-background">
              {[
                ["Pages crawled", pages.length],
                ["Indexable pages", indexableCount],
                ["Indexability unknown", unknownIndexabilityCount],
                ["Missing titles", missingTitleCount],
                ["Missing descriptions", missingDescriptionCount],
                ["H1 issues", h1IssueCount],
                ["Total crawl issues", audit.issue_count],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-4 px-4 py-3">
                  <span className="text-sm font-medium">{label}</span>
                  <span className="nums text-xl font-semibold">{formatNumber(value)}</span>
                </div>
              ))}
            </div>
            {rows.length ? <LocalOrganicPagesTable rows={rows} /> : <EmptyState title="No page rows" text="The selected scan did not save page rows." />}
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
              <Badge variant={auditIssueCount(page) ? "warn" : "good"}>{formatNumber(auditIssueCount(page))}</Badge>
            </TableCell>
          </TableRow>
        );
        })}
      </TableBody>
    </Table>
  );
}

function OrganicSnapshot({ result, target, keywordRows, pageRows }: { result: any; target: string; keywordRows: number; pageRows: number }) {
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
          { title: "Research site", status: target || result.target || "-", tone: "good", text: "The selected site or competitor domain analyzed in this run." },
          { title: "Keyword rows", status: formatNumber(keywordRows), tone: keywordRows ? "good" : "warn", text: "Rows returned by the real organic search dataset." },
          { title: "Page rows", status: formatNumber(pageRows), tone: pageRows ? "good" : "warn", text: "Top pages returned for this domain." },
          { title: "Organic keywords", status: formatMetricStatus(organicKeywords), tone: hasMetric(organicKeywords) ? "good" : "warn", text: "Metric returned by the connected organic dataset." },
          { title: "Organic traffic", status: formatMetricStatus(organicTraffic), tone: hasMetric(organicTraffic) ? "good" : "warn", text: "Estimate from the connected organic dataset." },
          { title: "Traffic value", status: formatMetricStatus(estimatedValue), tone: hasMetric(estimatedValue) ? "good" : "warn", text: "Estimate from the connected organic dataset." },
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
      <TableHeader><TableRow><TableHead>Page</TableHead><TableHead>Traffic</TableHead><TableHead>Keywords</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.page}>
            <TableCell className="max-w-xl truncate font-medium">{row.relativePath || row.page}</TableCell>
            <TableCell className="nums">{formatNumber(row.organicTraffic)}</TableCell>
            <TableCell className="nums">{formatNumber(row.keywords)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function BacklinksPage({ site }: { site: Site }) {
  const navigate = useNavigate();
  const [target, setTarget] = useState(site.domain);
  const [overview, setOverview] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [config, setConfig] = useState<any>(null);
  const [auditRows, setAuditRows] = useState<any[]>([]);
  const [selectedAuditId, setSelectedAuditIdState] = useState("");
  const [history, setHistory] = useState<any[]>([]);
  const [tab, setTab] = useState("backlinks");
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const backlinkIndexConnected = Boolean(config?.dataforseo_api_key);
  const selectedAudit = useMemo(
    () => auditRows.find((audit) => audit.id === selectedAuditId) || defaultEvidenceAudit(auditRows),
    [auditRows, selectedAuditId],
  );

  useEffect(() => {
    setTarget(site.domain);
    setOverview(null);
    setProfile(null);
    setError("");
  }, [site.id, site.domain]);

  async function loadHistory() {
    const [snapshots, audits, appConfig] = await Promise.all([
      api.backlinkSnapshots(site.id),
      api.audits(site.id),
      api.config(),
    ]);
    setHistory(snapshots);
    const rows = sortAuditRows(audits);
    setAuditRows(rows);
    setSelectedAuditIdState((currentId) => {
      if (currentId && rows.some((audit) => audit.id === currentId)) return currentId;
      return defaultEvidenceAudit(rows)?.id || "";
    });
    setConfig(appConfig);
  }
  useEffect(() => {
    loadHistory().catch(console.error);
  }, [site.id]);

  async function run(nextTab = tab) {
    if (!backlinkIndexConnected) {
      setOverview(null);
      setProfile(null);
      setError("A web-wide backlink index is not connected. Use the local link graph from a saved audit, or connect a real backlink index before running this analysis.");
      return;
    }
    setLoading(true);
    setError("");
    const body = { siteId: site.id, target, tab: nextTab, pageSize: 50 };
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

  async function changeTab(value: string) {
    setTab(value);
    if (overview && value !== "snapshot") await run(value);
  }

  async function scanSite() {
    if (!site.domain) {
      navigate("/sites");
      return;
    }
    setScanning(true);
    setError("");
    try {
      const result = await api.scanSite(site.id);
      if (result.audit?.id) {
        setSelectedAuditId(site.id, result.audit.id);
        navigate(`/audits/${result.audit.id}`);
      } else {
        navigate("/audits");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start site scan");
    } finally {
      setScanning(false);
    }
  }

  return (
    <>
      <PageHeader eyebrow="Authority" title="Links" description="Local crawl links are available from audits. Web-wide backlinks are shown only when a real backlink index is connected." />
      <section className="rounded-md border bg-background p-5">
        <form className="grid gap-3 lg:grid-cols-[1fr_auto]" onSubmit={submit}>
          <SiteTargetField
            label="Backlink index site"
            value={target}
            siteDomain={site.domain}
            hint="Use the selected site or enter a competitor domain. Local link evidence below comes from saved audits."
            onChange={setTarget}
          />
          <div className="flex items-end">
            <Button disabled={loading || !target.trim() || !backlinkIndexConnected}><Link2 /> {loading ? "Checking" : backlinkIndexConnected ? "Check backlink index" : "Backlink index not connected"}</Button>
          </div>
        </form>
        <div className="mt-4 rounded-md border bg-muted/25">
          <div className="grid gap-0 md:grid-cols-[220px_1fr_auto]">
            <div className="border-b px-4 py-3 md:border-b-0 md:border-r">
              <div className="text-sm font-medium">External backlink index</div>
              <Badge className="mt-2" variant={backlinkIndexConnected ? "good" : "warn"}>{backlinkIndexConnected ? "Connected" : "Not connected"}</Badge>
            </div>
            <div className="border-b px-4 py-3 text-sm leading-6 text-muted-foreground md:border-b-0 md:border-r">
              {backlinkIndexConnected
                ? "Backlink rows, referring domains, and top linked pages will come from the connected real index."
                : "No web-wide backlink rows are generated locally. The usable local data on this screen is the crawl link graph below."}
            </div>
            <div className="flex items-center px-4 py-3">
              <Button asChild size="sm" variant="outline"><Link to="/settings"><Settings /> Settings</Link></Button>
            </div>
          </div>
        </div>
        {error ? <p className="mt-3 rounded-md border border-destructive/40 bg-muted/30 p-3 text-sm text-destructive">{error}</p> : null}
      </section>
      <div className="mt-6 grid gap-6 2xl:grid-cols-[minmax(0,1fr)_460px]">
        <div className="space-y-6">
          <LocalLinkEvidence
            audit={selectedAudit}
            audits={auditRows}
            selectedAuditId={selectedAudit?.id || ""}
            onAuditChange={setSelectedAuditIdState}
            siteDomain={site.domain}
            onScan={scanSite}
            scanning={scanning}
          />
          {overview?.warning ? (
            <ProviderNotice title="External backlink index unavailable" text={overview.warning} source={overview.source} />
          ) : null}
          {overview?.source === "dataforseo" ? (
            <StatsBand
              title="Connected backlink index"
              items={[
                { title: "Backlinks", value: metricValue(overview.backlinks, overview.summary?.backlinks), icon: Link2 },
                { title: "Ref. domains", value: metricValue(overview.referringDomains, overview.summary?.referringDomains), icon: Globe2 },
                { title: "Dofollow %", value: metricValue(overview.dofollowRatio), icon: CheckCircle2 },
              ]}
            />
          ) : null}
          <Tabs value={tab} onValueChange={changeTab}>
            <TabsList>
              <TabsTrigger value="backlinks">Backlinks</TabsTrigger>
              <TabsTrigger value="domains">Domains</TabsTrigger>
              <TabsTrigger value="pages">Pages</TabsTrigger>
              <TabsTrigger value="snapshot">Snapshot</TabsTrigger>
            </TabsList>
            <TabsContent value="backlinks">
              <ReportSection title="External backlinks" description={profile ? <SourceBadge source={profile.source} /> : "Connect a real backlink index, then run a check."}>
                {profile?.tab === "backlinks" && profile.rows?.length ? <BacklinksRowsTable rows={profile.rows} /> : <EmptyState title={backlinkIndexConnected ? "No backlink rows" : "No external backlink index connected"} text={profile?.warning || (backlinkIndexConnected ? "Check a domain to load real backlink rows." : "Local audits do not invent web-wide backlinks. Use the local link graph above until a real backlink index is connected.")} />}
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
              {overview ? <BacklinkSnapshot result={overview} target={target} rows={profile?.rows?.length || 0} tab={profile?.tab || tab} /> : <EmptyState title="No snapshot" text="Run an analysis to save the first backlink snapshot." />}
            </TabsContent>
          </Tabs>
        </div>
        <HistoryList title="External backlink history" rows={history} labelKey="target" labelTitle="Backlink index site" />
      </div>
    </>
  );
}

function LocalLinkEvidence({
  audit,
  audits,
  selectedAuditId,
  onAuditChange,
  siteDomain,
  onScan,
  scanning,
}: {
  audit: any;
  audits: any[];
  selectedAuditId: string;
  onAuditChange: (auditId: string) => void;
  siteDomain: string;
  onScan: () => void;
  scanning: boolean;
}) {
  const result = audit?.result || {};
  const linkInventory = result.linkInventory || [];
  const checkedLinks = result.links || [];
  const pages = result.pages || [];
  const checkedByUrl = new Map(checkedLinks.map((link: any) => [link.url, link]));
  const externalLinks = linkInventory.filter((link: any) => link.type === "external");
  const brokenLinks = checkedLinks.filter((link: any) => !link.ok);
  const pageRows = [...pages]
    .sort((a, b) => Number(b.internalInlinks || 0) - Number(a.internalInlinks || 0));
  return (
    <section className="rounded-md border bg-background">
      <div className="border-b px-5 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Local link graph</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Real internal links, external links, and failing URLs from the selected saved audit.
            </p>
          </div>
          <AuditRunPicker label="Saved scan for link evidence" audits={audits} selectedAuditId={selectedAuditId} onAuditChange={onAuditChange} />
        </div>
      </div>
      <div className="space-y-4 p-5">
        {!audit ? (
          <EmptyState
            title="No local link graph yet"
            text={siteDomain ? "Run a site audit once to collect internal links, external links, and broken link evidence." : "Add a website address and run an audit to collect link evidence."}
            action={siteDomain ? (
              <Button variant="secondary" onClick={onScan} disabled={scanning}>
                <FileSearch /> {scanning ? "Starting scan" : `Scan ${siteDomain}`}
              </Button>
            ) : (
              <Button asChild variant="secondary"><Link to="/sites"><Plus /> Add site</Link></Button>
            )}
          />
        ) : !audit.result ? (
          <EmptyState
            title={auditIsActive(audit) ? "Selected scan is still running" : "Selected scan has no link evidence"}
            text={auditIsActive(audit) ? "Open the scan report to watch progress. Link evidence appears here after crawl data is saved." : audit.error || "This saved scan did not include link rows."}
            action={<Button asChild variant="secondary"><Link to={`/audits/${audit.id}`}><FileSearch /> Open scan report</Link></Button>}
          />
        ) : (
          <>
            <div className="divide-y rounded-md border bg-background">
              {[
                ["Link tags found", linkInventory.length],
                ["External links found", linkInventory.filter((link: any) => link.type === "external").length],
                ["Checked links", checkedLinks.length],
                ["Broken links", checkedLinks.filter((link: any) => !link.ok).length],
                ["Pages with no inlinks", pages.filter((page: any) => Number(page.internalInlinks || 0) === 0).length],
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
                {externalLinks.length ? <LocalExternalLinksTable rows={externalLinks} checkedByUrl={checkedByUrl} /> : <EmptyState title="No external links" text="The selected scan did not find external links." />}
              </TabsContent>
              <TabsContent value="broken">
                {brokenLinks.length ? <AuditLinksTable rows={brokenLinks} /> : <EmptyState title="No broken links" text="The selected scan did not find failing link URLs." />}
              </TabsContent>
              <TabsContent value="internal">
                {pageRows.length ? <LocalInternalGraphTable rows={pageRows} /> : <EmptyState title="No internal graph" text="The selected scan did not save page link rows." />}
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
            <TableCell><Badge variant={auditIssueCount(page) ? "warn" : "good"}>{formatNumber(auditIssueCount(page))}</Badge></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function BacklinkSnapshot({ result, target, rows, tab }: { result: any; target: string; rows: number; tab: string }) {
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
          { title: "Backlink index site", status: target || result.target || "-", tone: "good", text: "The domain or URL checked in this run." },
          { title: "Visible rows", status: formatNumber(rows), tone: rows ? "good" : "warn", text: `Rows currently loaded in the ${tab} tab.` },
          { title: "Backlinks", status: formatMetricStatus(backlinks), tone: hasMetric(backlinks) ? "good" : "warn", text: "Total backlinks from the connected index." },
          { title: "Referring domains", status: formatMetricStatus(referringDomains), tone: hasMetric(referringDomains) ? "good" : "warn", text: "Unique linking domains from the connected index." },
          { title: "Dofollow %", status: formatMetricStatus(dofollowRatio), tone: hasMetric(dofollowRatio) ? "good" : "warn", text: "Dofollow ratio reported by the connected index." },
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

function BrandLookupPage({ site }: { site: Site }) {
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
      <PageHeader eyebrow="AI visibility" title="Brand lookup" description="Measure how a brand or domain appears across AI answers, citations, and share-of-voice competitors." />
      <div className="grid gap-6 2xl:grid-cols-[460px_minmax(0,1fr)]">
        <ReportSection title="Lookup" description="Competitors can be comma-separated or one per line.">
          <form className="space-y-4" onSubmit={submit}>
            <Field label="Brand or domain"><Input value={query} onChange={(event) => setQuery(event.target.value)} required /></Field>
            <Field label="Competitors"><Textarea value={competitors} onChange={(event) => setCompetitors(event.target.value)} placeholder="competitor.com, otherbrand" /></Field>
            <Button disabled={loading}><Sparkles /> {loading ? "Looking up" : "Run lookup"}</Button>
          </form>
        </ReportSection>
        <div className="space-y-6">
          {result ? <BrandLookupResult result={result} /> : <EmptyState title="No lookup yet" text="Run a brand lookup to save an AI visibility snapshot." />}
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
        description={<><SourceBadge source={result.source} /> {result.resolvedTarget ? <span className="ml-2">Resolved entity: {result.resolvedTarget}</span> : null}</>}
      >
        <div className="space-y-3">
          {shareRows.length ? shareRows.map((row: any) => {
            const percent = totalShare ? Math.round((Number(row.value || 0) / totalShare) * 100) : Number(row.value || 0);
            return (
              <div key={row.label} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className={row.target ? "font-semibold" : ""}>{row.label}</span>
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

function PromptExplorerPage({ site }: { site: Site }) {
  const [prompt, setPrompt] = useState(`What are the best options for ${site.domain || site.name}?`);
  const [highlightBrand, setHighlightBrand] = useState(site.domain || site.name);
  const [models, setModels] = useState<Record<string, boolean>>({
    chat_gpt: true,
    claude: true,
    gemini: true,
    perplexity: true,
  });
  const [result, setResult] = useState<any>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setRuns(await api.promptExplorerRuns(site.id));
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
      const selectedModels = Object.entries(models).filter(([, enabled]) => enabled).map(([model]) => model);
      const data = await api.promptExplorer({ siteId: site.id, prompt, highlightBrand, models: selectedModels });
      setResult(data);
      await load();
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageHeader eyebrow="AI answers" title="Prompt explorer" description="Run a prompt across answer models and inspect brand mentions, citations, and fan-out queries." />
      <div className="grid gap-6 2xl:grid-cols-[480px_minmax(0,1fr)]">
        <ReportSection title="Prompt" description="Use this for AI visibility and citation testing.">
          <form className="space-y-4" onSubmit={submit}>
            <Field label="Prompt"><Textarea className="min-h-32" value={prompt} onChange={(event) => setPrompt(event.target.value)} required /></Field>
            <Field label="Highlight brand"><Input value={highlightBrand} onChange={(event) => setHighlightBrand(event.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-2">
              {Object.keys(models).map((model) => (
                <label key={model} className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm">
                  <Checkbox checked={models[model]} onCheckedChange={(checked) => setModels({ ...models, [model]: checked === true })} />
                  {model.replaceAll("_", " ")}
                </label>
              ))}
            </div>
            <Button disabled={loading}><Bot /> {loading ? "Exploring" : "Explore prompt"}</Button>
          </form>
        </ReportSection>
        <div className="space-y-6">
          {result ? <PromptResult result={result} /> : <EmptyState title="No prompt run" text="Run a prompt to compare AI answer surfaces." />}
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
              { title: "Models", status: formatNumber(result.results?.length || 0), tone: "good", text: "Each section below is a connected AI data-source response or a local Codex job state." },
              { title: "Local job", status: result.jobId ? "Queued" : "None", tone: result.jobId ? "warn" : "good", text: result.jobId ? "Open AI lab to read the Codex result when it finishes." : "No local Codex job was needed for this run." },
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

function HistoryList({
  title,
  rows,
  labelKey,
  labelTitle = "Saved run",
}: {
  title: string;
  rows: any[];
  labelKey: string;
  labelTitle?: string;
}) {
  return (
    <ReportSection title={title} description={`${formatNumber(rows.length)} saved local rows`}>
      {rows.length ? <HistoryTable rows={rows} labelKey={labelKey} labelTitle={labelTitle} /> : <EmptyState title="No history" text="Runs are saved locally." />}
    </ReportSection>
  );
}

function HistoryTable({
  rows,
  labelKey,
  labelTitle = "Run",
}: {
  rows: any[];
  labelKey: string;
  labelTitle?: string;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{labelTitle}</TableHead>
          <TableHead>Source</TableHead>
          <TableHead>Saved</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="max-w-md truncate font-medium">{row[labelKey] || "-"}</TableCell>
            <TableCell><SourceBadge source={row.source} /></TableCell>
            <TableCell className="text-muted-foreground">{formatDate(row.created_at || row.createdAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function AuditReportRoute() {
  const { auditId } = useParams();
  const [audit, setAudit] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let interval: number | undefined;
    async function load() {
      if (!auditId) return;
      setError("");
      try {
        const row = await api.audit(auditId);
        if (!cancelled) {
          setAudit(row);
          if (!row) {
            clearSelectedAuditId();
            if (interval) {
              window.clearInterval(interval);
              interval = undefined;
            }
            return;
          }
          setSelectedAuditId(row.project_id, row.id);
          if (row.status !== "queued" && row.status !== "running" && interval) {
            window.clearInterval(interval);
            interval = undefined;
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load audit report");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    setLoading(true);
    load().catch(console.error);
    interval = window.setInterval(() => {
      if (!auditId) return;
      load().catch(console.error);
    }, 1500);
    return () => {
      cancelled = true;
      if (interval) window.clearInterval(interval);
    };
  }, [auditId]);

  return (
    <>
      <PageHeader
        eyebrow="Technical"
        title="Audit report"
        description="Technical evidence, broken assets, metadata, indexability, and fixes from this saved local scan."
        action={<Button asChild variant="outline"><Link to="/audits"><FileSearch /> Back to audits</Link></Button>}
      />
      {error ? <p className="rounded-md border border-destructive/40 bg-muted/30 p-3 text-sm text-destructive">{error}</p> : null}
      {loading ? (
        <EmptyState title="Loading report" text="Reading the saved audit from local SQLite." />
      ) : audit ? (
        <AuditDetail audit={audit} />
      ) : (
        <EmptyState title="Scan not found" text="This saved scan no longer exists in local SQLite." action={<Button asChild><Link to="/audits"><FileSearch /> Open audits</Link></Button>} />
      )}
    </>
  );
}

function AuditsPage({ site }: { site: Site }) {
  const [url, setUrl] = useState(preferredAuditUrl(site));
  const [audits, setAudits] = useState<any[]>([]);
  const [allAudits, setAllAudits] = useState<any[]>([]);
  const [detail, setDetail] = useState<any>(null);
  const [deletingAudit, setDeletingAudit] = useState<any>(null);
  const [clearingAudits, setClearingAudits] = useState(false);
  const [confirmClearAudits, setConfirmClearAudits] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [showCustomUrl, setShowCustomUrl] = useState(false);
  const [manualLedgerAuditId, setManualLedgerAuditId] = useState("");
  const [manualLedgerSiteId, setManualLedgerSiteId] = useState("");
  const activeAudit = auditIsActive(detail) ? detail : allAudits.find(auditIsActive);
  async function load() {
    const [siteRows, ledgerRows] = await Promise.all([
      api.audits(site.id),
      api.allAudits(),
    ]);
    const rows = sortAuditRows(siteRows);
    const ledger = sortAuditRows(ledgerRows);
    setAudits(rows);
    setAllAudits(ledger);
    const currentDetail = detail?.id ? ledger.find((row) => row.id === detail.id) : null;
    const currentDetailBelongsToSite = currentDetail?.project_id === site.id;
    const manualAudit = manualLedgerAuditId && manualLedgerSiteId === site.id
      ? ledger.find((row) => row.id === manualLedgerAuditId)
      : null;
    const selectedAuditId = getSelectedAuditId(site.id);
    const selectedAudit = selectedAuditId ? rows.find((row) => row.id === selectedAuditId) : null;
    const nextDetail = manualAudit || (currentDetailBelongsToSite ? currentDetail : null) || selectedAudit || rows[0] || null;
    setDetail(nextDetail);
    if (nextDetail?.id) setSelectedAuditId(nextDetail.project_id || site.id, nextDetail.id);
    else clearSelectedAuditId(site.id);
    if (manualLedgerAuditId && !manualAudit) {
      setManualLedgerAuditId("");
      setManualLedgerSiteId("");
    }
    return rows;
  }
  useEffect(() => {
    load().catch(console.error);
  }, [site.id]);
  useEffect(() => {
    setUrl(preferredAuditUrl(site));
    setError("");
    setShowCustomUrl(false);
  }, [site.id, site.domain, site.crawl_protocol, site.crawl_host]);
  useEffect(() => {
    const hasActiveScan = allAudits.some(auditIsActive);
    if (!hasActiveScan) return;
    const interval = window.setInterval(() => {
      load().catch(console.error);
    }, 1500);
    return () => window.clearInterval(interval);
  }, [site.id, allAudits, detail?.id]);
  useEffect(() => {
    if (!detail?.id || !auditIsActive(detail)) return;
    let cancelled = false;
    async function refreshSelectedAudit() {
      try {
        const nextAudit = await api.audit(detail.id);
        if (cancelled || !nextAudit) return;
        setDetail(nextAudit);
        setAudits((rows) => upsertAuditRow(rows, nextAudit));
        setAllAudits((rows) => upsertAuditRow(rows, nextAudit));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not refresh scan progress");
      }
    }
    const interval = window.setInterval(() => {
      refreshSelectedAudit().catch(console.error);
    }, 1000);
    refreshSelectedAudit().catch(console.error);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [detail?.id, detail?.status]);
  async function start(event: FormEvent) {
    event.preventDefault();
    setError("");
    setStarting(true);
    setManualLedgerAuditId("");
    setManualLedgerSiteId("");
    try {
      const audit = await api.startAudit({ siteId: site.id, url });
      setDetail(audit);
      setAudits((rows) => upsertAuditRow(rows, audit));
      setAllAudits((rows) => upsertAuditRow(rows, audit));
      if (audit?.id) setSelectedAuditId(site.id, audit.id);
      load().catch(console.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start scan");
    } finally {
      setStarting(false);
    }
  }
  async function startSelectedSite() {
    if (!site.domain) return;
    setError("");
    setStarting(true);
    setManualLedgerAuditId("");
    setManualLedgerSiteId("");
    try {
      const result = await api.scanSite(site.id);
      setDetail(result.audit);
      setAudits((rows) => upsertAuditRow(rows, result.audit));
      setAllAudits((rows) => upsertAuditRow(rows, result.audit));
      if (result.audit?.id) setSelectedAuditId(site.id, result.audit.id);
      load().catch(console.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start site scan");
    } finally {
      setStarting(false);
    }
  }
  async function inspect(id: string, row?: any) {
    setManualLedgerAuditId(id);
    setManualLedgerSiteId(site.id);
    setSelectedAuditId(row?.project_id || site.id, id);
    setDetail(await api.audit(id));
  }
  async function remove(id: string, row?: any) {
    const siteId = row?.project_id || site.id;
    await api.deleteAudit(siteId, id);
    if (getSelectedAuditId(siteId) === id) {
      clearSelectedAuditId(siteId);
    }
    if (detail?.id === id) setDetail(null);
    if (manualLedgerAuditId === id) {
      setManualLedgerAuditId("");
      setManualLedgerSiteId("");
    }
    await load();
  }
  async function clearHistory() {
    setError("");
    setClearingAudits(true);
    try {
      await api.clearAudits(site.id);
      clearSelectedAuditId(site.id);
      setManualLedgerAuditId("");
      setManualLedgerSiteId("");
      setDetail(null);
      setConfirmClearAudits(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clear scan history");
    } finally {
      setClearingAudits(false);
    }
  }
  return (
    <>
      <PageHeader eyebrow="Technical" title="Site audits" description="Scan the selected website and open the report when it completes." />
      <section className="border-y bg-background/40 px-4 py-4 sm:px-5">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium uppercase tracking-[0.14em] text-muted-foreground">Scan plan</span>
              {site.domain ? <Badge variant="outline">{scanTargetShortDetail(site)}</Badge> : null}
            </div>
            <div className="mt-3">
              {site.domain ? <ScanTargetPills site={site} /> : <p className="text-xl font-semibold">Add a website address</p>}
            </div>
            {site.domain ? <p className="mt-2 text-sm text-muted-foreground">{scanTargetDetail(site)}</p> : null}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row xl:justify-end">
            {site.domain ? (
              <Button disabled={starting} onClick={startSelectedSite}>
                <FileSearch /> {starting ? "Starting" : `Scan ${site.domain}`}
              </Button>
            ) : (
              <Button asChild><Link to="/sites"><Plus /> Add site</Link></Button>
            )}
            <Button type="button" variant="outline" onClick={() => setShowCustomUrl((value) => !value)}>
              <FileSearch /> {showCustomUrl ? "Hide URL scan" : "Specific URL"}
            </Button>
          </div>
        </div>
        {showCustomUrl ? (
          <form className="mt-4 grid gap-3 border-t pt-4 lg:grid-cols-[1fr_auto]" onSubmit={start}>
            <Field label="URL to scan">
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={`${preferredAuditUrl(site) || "https://example.com"}/page`} />
            </Field>
            <div className="flex items-end">
              <Button variant="secondary" disabled={starting || !url.trim()}><FileSearch /> Scan URL</Button>
            </div>
          </form>
        ) : null}
        {error ? (
          <p className="mt-4 rounded-md border border-destructive/40 bg-muted/30 p-3 text-sm text-destructive">{error}</p>
        ) : null}
      </section>
      <div className="mt-6 space-y-6">
        {activeAudit ? <ActiveScanBanner audit={activeAudit} /> : null}
        <section className="space-y-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-normal">Scan report</h2>
              <p className="text-sm text-muted-foreground">Technical evidence, broken assets, metadata, indexability, and fixes from the selected scan.</p>
            </div>
            {detail ? <Badge variant={detail.status === "completed" ? "good" : detail.status === "failed" ? "bad" : "warn"}>{detail.status}</Badge> : null}
          </div>
          {detail ? <AuditDetail audit={detail} /> : (
            <EmptyState
              title={allAudits.length ? "No selected-site scan open" : "No scan report yet"}
              text={allAudits.length ? "Every saved scan is still listed below. Open a row to inspect it, or run a scan for the selected site." : "Start a local site scan to fill this report with crawl evidence."}
              action={
                !allAudits.length
                  ? site.domain
                    ? (
                      <Button onClick={startSelectedSite} disabled={starting}>
                        <FileSearch /> {starting ? "Starting" : "Scan site now"}
                      </Button>
                    )
                    : <Button asChild><Link to="/sites"><Plus /> Add site</Link></Button>
                  : undefined
              }
            />
          )}
        </section>

        <section className="rounded-md border bg-background">
          <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">All scan history</h2>
              <p className="mt-1 text-sm text-muted-foreground">Every saved scan in local SQLite stays visible until you delete it.</p>
            </div>
            {audits.length ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirmClearAudits(true)}
                disabled={clearingAudits}
              >
                <Trash2 /> Delete selected-site scans
              </Button>
            ) : null}
          </div>
          <div className="p-5">
            {allAudits.length ? (
              <AuditTable rows={allAudits} showSite selectedId={detail?.id} onInspect={inspect} onDelete={(id) => setDeletingAudit(allAudits.find((audit) => audit.id === id) || { id })} />
            ) : (
              <EmptyState
                title="No audits yet"
                text={site.domain ? "Start a technical scan for this site." : "Add a website address before running an audit."}
                action={site.domain ? (
                  <Button onClick={startSelectedSite} disabled={starting}>
                    <FileSearch /> {starting ? "Starting" : "Scan site now"}
                  </Button>
                ) : (
                  <Button asChild><Link to="/sites"><Plus /> Add site</Link></Button>
                )}
              />
            )}
          </div>
        </section>
      </div>
      <AlertDialog open={Boolean(deletingAudit)} onOpenChange={(nextOpen) => !nextOpen && setDeletingAudit(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete scan?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the saved report for {deletingAudit?.url || "this scan"} from local SQLite. Other scans for the same site stay available.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction type="button" onClick={() => deletingAudit && remove(deletingAudit.id, deletingAudit).then(() => setDeletingAudit(null))}>
              Delete scan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={confirmClearAudits} onOpenChange={setConfirmClearAudits}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete selected-site scans?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes all saved scan reports for {site.domain || site.name} from local SQLite. The saved site, keywords, rankings, and settings stay in place.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearingAudits}>Keep scans</AlertDialogCancel>
            <AlertDialogAction type="button" onClick={clearHistory} disabled={clearingAudits}>
              {clearingAudits ? "Deleting scans" : "Delete selected-site scans"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ActiveScanBanner({ audit }: { audit: any }) {
  const progress = auditProgress(audit);
  return (
    <section className="rounded-md border border-primary/40 bg-primary/5 p-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="warn" className="gap-1"><Activity className="size-3" /> Scan running</Badge>
            <span className="text-sm font-medium">{auditPhaseLabel(audit)}</span>
          </div>
          <div className="mt-3 max-w-4xl break-all text-lg font-semibold">{audit.url}</div>
          <div className="mt-2 grid gap-2 text-sm text-muted-foreground sm:grid-cols-3">
            <span>{formatNumber(audit.pages_crawled || 0)} pages crawled</span>
            <span>{formatNumber(audit.issue_count || 0)} issues found</span>
            <span>{formatNumber(progress)}% complete</span>
          </div>
          <div className="mt-4 max-w-3xl">
            <ProgressBar value={progress} />
          </div>
        </div>
        <Button asChild variant="secondary">
          <Link to={`/audits/${audit.id}`}><FileSearch /> Open live report</Link>
        </Button>
      </div>
    </section>
  );
}

function AuditTable({
  rows,
  showSite,
  selectedId,
  onInspect,
  onDelete,
}: {
  rows: any[];
  showSite?: boolean;
  selectedId?: string;
  onInspect?: (id: string, row: any) => void;
  onDelete?: (id: string, row: any) => void;
}) {
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Run</TableHead>{showSite ? <TableHead>Site</TableHead> : null}<TableHead>Status</TableHead><TableHead>Progress</TableHead><TableHead>Score</TableHead><TableHead>Issues</TableHead><TableHead>Pages</TableHead>{(onInspect || onDelete) && <TableHead></TableHead>}</TableRow></TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={row.id}
            className={cn(onInspect ? "cursor-pointer" : "", selectedId === row.id ? "bg-accent/45" : "")}
            onClick={() => onInspect?.(row.id, row)}
          >
            <TableCell className="max-w-md">
              <div className="truncate font-medium">{row.url}</div>
              <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="size-3" /> {formatDate(row.created_at || row.updated_at)}
              </div>
            </TableCell>
            {showSite ? (
              <TableCell className="min-w-44">
                <div className="font-medium">{auditSiteName(row)}</div>
                <div className="mt-1 break-all text-xs text-muted-foreground">{auditSiteDetail(row)}</div>
              </TableCell>
            ) : null}
            <TableCell><Badge variant={row.status === "completed" ? "good" : row.status === "failed" ? "bad" : "warn"}>{row.status}</Badge></TableCell>
            <TableCell className="min-w-36">
              <div className="space-y-1">
                <ProgressBar value={auditProgress(row)} />
                <div className="text-xs text-muted-foreground">{auditPhaseLabel(row)}</div>
              </div>
            </TableCell>
            <TableCell className="nums font-medium">{row.status === "completed" ? row.score : "-"}</TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                <Badge variant={auditSeverityCounts(row).high ? "bad" : "outline"}>{auditSeverityCounts(row).high} high</Badge>
                <Badge variant={auditSeverityCounts(row).medium ? "warn" : "outline"}>{auditSeverityCounts(row).medium} med</Badge>
                <Badge variant="outline">{auditSeverityCounts(row).low} low</Badge>
              </div>
            </TableCell>
            <TableCell className="nums">{row.pages_crawled}</TableCell>
            {(onInspect || onDelete) && (
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  {onInspect && (
                    <Button size="sm" variant="outline" asChild>
                      <Link
                        to={`/audits/${row.id}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (row.project_id) setSelectedAuditId(row.project_id, row.id);
                        }}
                      >
                        <FileSearch /> Open report
                      </Link>
                    </Button>
                  )}
                  {onDelete && (
                    <Button
                      size="sm"
                      variant="destructive"
                      aria-label={`Delete scan report for ${row.url}`}
                      onClick={(event) => { event.stopPropagation(); onDelete(row.id, row); }}
                    >
                      <Trash2 /> Delete scan
                    </Button>
                  )}
                </div>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function lengthVariant(value: number, min: number, max: number) {
  if (!value) return "bad";
  if (value < min || value > max) return "warn";
  return "good";
}

function textLength(value: unknown, savedLength: unknown) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  const stored = Number(savedLength || 0);
  if (stored > 0 || !normalized) return stored;
  return normalized.length;
}

function LengthBadge({
  value,
  savedLength,
  min,
  max,
}: {
  value: unknown;
  savedLength: unknown;
  min: number;
  max: number;
}) {
  const length = textLength(value, savedLength);
  return <Badge variant={lengthVariant(length, min, max) as any}>{length ? `${length} chars` : "missing"}</Badge>;
}

function pageH1Text(page: any) {
  const fromString = String(page.h1 || "").replace(/\s+/g, " ").trim();
  if (fromString) return fromString;
  const fromArray = Array.isArray(page.h1s)
    ? page.h1s.map((item: unknown) => String(item || "").replace(/\s+/g, " ").trim()).find(Boolean)
    : "";
  return fromArray || "";
}

function pageH1Count(page: any) {
  const stored = Number(page.h1Count || 0);
  if (stored > 0) return stored;
  return Array.isArray(page.h1s) ? page.h1s.filter((item: unknown) => String(item || "").trim()).length : 0;
}

function pageH1Status(page: any) {
  const text = pageH1Text(page);
  const count = pageH1Count(page);
  const hasEmptyIssue = pageIssueTypeCount(page, "h1-empty") > 0;
  const hasCountIssue = pageIssueTypeCount(page, "h1-count") > 0;
  if (text) {
    return {
      label: text,
      badge: `${formatNumber(count || 1)} H1`,
      variant: count === 1 && !hasCountIssue && !hasEmptyIssue ? "good" : "warn",
    };
  }
  if (hasEmptyIssue) {
    return { label: "Empty H1", badge: `${formatNumber(count || 1)} H1`, variant: "warn" };
  }
  if (hasCountIssue && count !== 1) {
    return { label: count > 1 ? `${formatNumber(count)} H1 tags` : "Missing", badge: `${formatNumber(count)} H1`, variant: "warn" };
  }
  if (count > 0) {
    return { label: `${formatNumber(count)} H1`, badge: "counted", variant: "good" };
  }
  return { label: "Missing", badge: "0 H1", variant: "warn" };
}

function AuditDetail({ audit }: { audit: any }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selectedCheckTypes, setSelectedCheckTypes] = useState<string[]>([]);
  const [selectedCheckLabel, setSelectedCheckLabel] = useState("");
  const result = audit.result || {};
  const pages = result.pages || [];
  const issues = result.issues || [];
  const links = result.links || [];
  const linkInventory = result.linkInventory || [];
  const images = result.images || [];
  const imageInventory = result.imageInventory || [];
  const assets = result.assets || [];
  const summary = result.summary || {};
  const issueGroups = result.issueGroups || [];
  const severityCounts = auditSeverityCounts(audit);
  const coverage = auditCoverageMetrics(audit, result, summary);
  const categories = Object.keys(summary.byCategory || {}).sort();
  const issueTypes = Array.from(new Set<string>(issues.map((issue: any) => String(issue.type || "")).filter(Boolean))).sort();
  const categoryEntries = Object.entries(summary.byCategory || {}).sort((a: any, b: any) => b[1] - a[1]);
  const titleProblems = Number(summary.missingTitles || 0) + Number(summary.titleLengthIssues || 0) + issueTypeCount(issues, "title-multiple") + issueTypeCount(issues, "duplicate-title");
  const descriptionProblems = Number(summary.missingDescriptions || 0) + Number(summary.descriptionLengthIssues || 0) + issueTypeCount(issues, "description-multiple") + issueTypeCount(issues, "duplicate-description");
  const altProblems = Number(summary.missingAlt || 0) + Number(summary.genericAlt || 0) + Number(summary.longAlt || 0);
  const showIssues = () => setActiveTab("issues");
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
  const selectAuditCheck = (row: AuditCheckRowModel) => {
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
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="flex h-auto w-full justify-start overflow-x-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="issues">Issues</TabsTrigger>
          <TabsTrigger value="checks">Checks</TabsTrigger>
          <TabsTrigger value="metadata">Metadata</TabsTrigger>
          <TabsTrigger value="pages">Pages</TabsTrigger>
          <TabsTrigger value="links">Links</TabsTrigger>
          <TabsTrigger value="images">Images</TabsTrigger>
          <TabsTrigger value="assets">Assets</TabsTrigger>
          <TabsTrigger value="crawl">Robots/Sitemap</TabsTrigger>
          <TabsTrigger value="raw">Evidence</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="space-y-5">
          <AuditProgressPanel audit={audit} result={result} coverage={coverage} />

          <AuditReportOverview
            audit={audit}
            result={result}
            summary={summary}
            coverage={coverage}
            severityCounts={severityCounts}
            activeSeverity={severityFilter}
            onSeveritySelect={selectSeverity}
          />

          <AuditEvidenceSnapshot
            rows={[
              {
                area: "Impact",
                status: (
                  <div className="flex flex-wrap gap-1">
                    <Badge variant={severityCounts.high ? "bad" : "outline"}>{formatNumber(severityCounts.high)} high</Badge>
                    <Badge variant={severityCounts.medium ? "warn" : "outline"}>{formatNumber(severityCounts.medium)} medium</Badge>
                    <Badge variant="outline">{formatNumber(severityCounts.low)} low</Badge>
                  </div>
                ),
                evidence: `${formatNumber(audit.issue_count)} total issues from ${formatNumber(coverage.pages)} crawled pages`,
                action: severityCounts.high ? (
                  <Button size="sm" variant="outline" onClick={() => selectSeverity("high")}>Show high issues</Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => selectSeverity("all")}>Show all issues</Button>
                ),
              },
              {
                area: "Metadata",
                status: `${formatNumber(titleProblems)} title · ${formatNumber(descriptionProblems)} description`,
                evidence: "Title, description, duplicate, and length checks for every crawled page.",
                action: <Button size="sm" variant="outline" onClick={() => selectCategory("metadata")}>Open metadata</Button>,
              },
              {
                area: "Images",
                status: `${formatNumber(coverage.imageTags)} tags · ${formatNumber(coverage.checkedImages)} checked`,
                evidence: `${formatNumber(altProblems)} alt issues · ${formatNumber(coverage.brokenImages)} broken image URLs · ${formatNumber(coverage.largeImages)} large images`,
                action: <Button size="sm" variant="outline" onClick={() => setActiveTab("images")}>Open images</Button>,
              },
              {
                area: "Links and assets",
                status: `${formatNumber(coverage.linkTags)} links · ${formatNumber(coverage.assetTags)} CSS/JS refs`,
                evidence: `${formatNumber(coverage.checkedLinks)} checked links · ${formatNumber(coverage.brokenLinks)} broken · ${formatNumber(coverage.checkedAssets)} CSS/JS checked`,
                action: <Button size="sm" variant="outline" onClick={() => setActiveTab("links")}>Open links</Button>,
              },
              {
                area: "Indexing and sitemap",
                status: `${formatNumber(coverage.indexablePages)} indexable · ${formatNumber(coverage.nonIndexablePages)} non-indexable`,
                evidence: `${formatNumber(coverage.sitemapUrls)} sitemap URLs · ${formatNumber(coverage.pagesMissingFromSitemap)} pages missing from sitemap · ${formatNumber(coverage.unknownIndexabilityPages)} unknown`,
                action: <Button size="sm" variant="outline" onClick={() => setActiveTab("crawl")}>Open crawl</Button>,
              },
            ]}
          />

          <AuditActionBoard audit={audit} summary={summary} coverage={coverage} issues={issues} issueGroups={issueGroups} onSelectGroup={selectIssueGroup} />
        </TabsContent>
        <TabsContent value="issues" className="space-y-2">
          <div className="rounded-md border bg-muted/20 px-4 py-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-sm font-medium">Issue results</div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Showing {formatNumber(filteredIssues.length)} of {formatNumber(issues.length)} saved issues
                  {activeIssueFilters.length ? ` for ${activeIssueFilters.join(" · ")}` : "."}
                </p>
              </div>
              {activeIssueFilters.length ? (
                <Button size="sm" variant="outline" onClick={resetIssueFilters}>
                  Clear filters
                </Button>
              ) : null}
            </div>
          </div>
          {issueGroups.length ? <AuditIssueGroups groups={issueGroups} onSelect={selectIssueGroup} /> : null}
          {categoryEntries.length ? (
            <div className="flex flex-wrap gap-2 pb-2">
              {categoryEntries.map(([category, count]: any) => (
                <Button
                  key={category}
                  size="sm"
                  variant={categoryFilter === category ? "default" : "outline"}
                  onClick={() => selectCategory(category)}
                >
                  {issueCategoryLabel(category)} <span className="nums">{count}</span>
                </Button>
              ))}
              <Button size="sm" variant={categoryFilter === "all" ? "default" : "outline"} onClick={() => selectCategory("all")}>
                All
              </Button>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2 pb-2">
            {["all", "high", "medium", "low"].map((severity) => (
              <Button
                key={severity}
                size="sm"
                variant={severityFilter === severity ? "default" : "outline"}
                onClick={() => selectSeverity(severity)}
              >
                {severity === "all" ? "All severities" : severity}
              </Button>
            ))}
            <Select value={categoryFilter} onValueChange={selectCategory}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category} value={category}>{issueCategoryLabel(category)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={(value) => { setTypeFilter(value); setSelectedCheckTypes([]); setSelectedCheckLabel(""); showIssues(); }}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All issue types</SelectItem>
                {issueTypes.map((type) => (
                  <SelectItem key={type} value={type}>{type.replaceAll("-", " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedCheckLabel ? <Badge variant="outline">Showing {selectedCheckLabel}</Badge> : null}
          </div>
          {filteredIssues.length ? <AuditIssuesTable rows={filteredIssues} /> : <EmptyState title="No matching issues" text={audit.status === "completed" ? "This filter has no issues." : "Issues will appear while the scan runs."} />}
        </TabsContent>
        <TabsContent value="checks">
          <AuditCheckMatrix summary={summary} coverage={coverage} issues={issues} onSelectCheck={selectAuditCheck} />
        </TabsContent>
        <TabsContent value="metadata">
          {pages.length ? <AuditMetadataTable rows={pages} /> : <EmptyState title="No metadata yet" text="Metadata appears as soon as pages are crawled." />}
        </TabsContent>
        <TabsContent value="pages">
          {pages.length ? <AuditPagesTable rows={pages} /> : <EmptyState title="No pages yet" text="Pages will appear while the scan runs." />}
        </TabsContent>
        <TabsContent value="links">
          <div className="space-y-4">
            {links.length ? (
              <AuditSection title="Checked links" text="Every unique HTTP URL that the crawler verified. Broken and redirecting links are highlighted in the Status column.">
                <AuditLinksTable rows={links} />
              </AuditSection>
            ) : <EmptyState title="No links checked yet" text="Links are checked after the page crawl finishes." />}
            {linkInventory.length ? (
              <AuditSection title="Link inventory" text="All link tags found during the crawl, including anchor text, rel attributes, and source page.">
                <AuditLinkInventoryTable rows={linkInventory} />
              </AuditSection>
            ) : null}
          </div>
        </TabsContent>
        <TabsContent value="images" className="space-y-4">
          {pages.some((page: any) => page.images > 0) ? (
            <AuditSection title="Image summary by page" text="Missing src, alt text, and size attributes grouped by affected page.">
              <AuditImageSummaryTable rows={pages} />
            </AuditSection>
          ) : null}
          {imageInventory.length ? (
            <AuditSection title="Image tag inventory" text="Every image tag collected from the crawl, including content/decorative classification and tag-level problems.">
              <AuditImageInventoryTable rows={imageInventory} />
            </AuditSection>
          ) : null}
          {images.length ? (
            <AuditSection title="Checked image URLs" text="Image resources fetched by the crawler, including Open Graph images when present.">
              <AuditImagesTable rows={images} />
            </AuditSection>
          ) : <EmptyState title="No images checked yet" text="Images are checked after the page crawl finishes." />}
        </TabsContent>
        <TabsContent value="assets" className="space-y-4">
          {assets.length ? (
            <AuditSection title="Checked CSS and JavaScript" text="Stylesheet and script URLs fetched during the scan with status, content type, and size.">
              <AuditAssetsTable rows={assets} />
            </AuditSection>
          ) : <EmptyState title="No CSS or JavaScript assets checked yet" text="Assets are checked after links and images." />}
        </TabsContent>
        <TabsContent value="crawl" className="space-y-4">
          <AuditCrawlEvidence result={result} coverage={coverage} />
        </TabsContent>
        <TabsContent value="raw">
          <AuditSection title="Complete scan evidence" text="The full saved crawl payload for export, debugging, and MCP/AI workflows.">
            <JsonBlock value={result} />
          </AuditSection>
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

function AuditCrawlEvidence({
  result,
  coverage,
}: {
  result: any;
  coverage: ReturnType<typeof auditCoverageMetrics>;
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
    { metric: "Image tags found", count: coverage.imageTags, detail: `${formatNumber(coverage.checkedImages)} image URLs checked` },
    { metric: "CSS/JS refs found", count: coverage.assetTags, detail: `${formatNumber(coverage.checkedAssets)} CSS/JS assets checked` },
  ];
  return (
    <div className="space-y-4">
      <ReportSection title="Robots and sitemap evidence" description="What the crawler actually discovered before and during the page crawl.">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Area</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Evidence</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {evidenceRows.map((row) => (
              <TableRow key={row.area}>
                <TableCell className="min-w-44 font-medium">{row.area}</TableCell>
                <TableCell><Badge variant={row.tone as any}>{row.status}</Badge></TableCell>
                <TableCell className="min-w-96 break-all text-sm text-muted-foreground">{row.evidence}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
                  <TableCell className="nums text-lg font-semibold">{formatNumber(row.count)}</TableCell>
                  <TableCell><Badge variant={tone as any}>{row.problem ? (count ? "inspect" : "clear") : "measured"}</Badge></TableCell>
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

function AuditEvidenceSnapshot({
  rows,
}: {
  rows: Array<{
    area: string;
    status: ReactNode;
    evidence: ReactNode;
    action?: ReactNode;
  }>;
}) {
  return (
    <section className="rounded-md border bg-background">
      <div className="border-b px-5 py-4">
        <h2 className="text-lg font-semibold">Audit snapshot</h2>
        <p className="mt-1 text-sm text-muted-foreground">Key evidence from this saved crawl run.</p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Area</TableHead>
            <TableHead>Counts</TableHead>
            <TableHead>Evidence</TableHead>
            <TableHead className="text-right">Open</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.area}>
              <TableCell className="font-medium">{row.area}</TableCell>
              <TableCell className="min-w-56">{row.status}</TableCell>
              <TableCell className="min-w-96 text-sm text-muted-foreground">{row.evidence}</TableCell>
              <TableCell>
                <div className="flex justify-end">{row.action}</div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

type AuditScanStepState = "complete" | "running" | "pending" | "failed";

function auditStepIndex(audit: any) {
  const order: Record<string, number> = {
    target: 0,
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
  const key = auditPhaseKey(audit);
  if (key === "failed") {
    const phase = String(audit?.result?.phase || audit?.result?.summary?.phase || "").toLowerCase();
    if (phase.includes("deduplicating")) return 6;
    if (phase.includes("assets")) return 5;
    if (phase.includes("images") || phase.includes("css images")) return 4;
    if (phase.includes("links")) return 3;
    if (phase.includes("crawl")) return 2;
    if (phase.includes("robots")) return 1;
  }
  return order[key] ?? 0;
}

function auditStepState(audit: any, index: number): AuditScanStepState {
  if (audit?.status === "completed") return "complete";
  const activeIndex = auditStepIndex(audit);
  if (audit?.status === "failed") return index < activeIndex ? "complete" : index === activeIndex ? "failed" : "pending";
  if (index < activeIndex) return "complete";
  if (index === activeIndex) return "running";
  return "pending";
}

function AuditStepBadge({ state }: { state: AuditScanStepState }) {
  if (state === "complete") {
    return <Badge variant="good" className="gap-1"><CheckCircle2 className="size-3" /> Done</Badge>;
  }
  if (state === "failed") {
    return <Badge variant="bad" className="gap-1"><AlertTriangle className="size-3" /> Failed</Badge>;
  }
  if (state === "running") {
    return <Badge variant="warn" className="gap-1"><Activity className="size-3" /> Running</Badge>;
  }
  return <Badge variant="outline" className="gap-1"><Clock className="size-3" /> Pending</Badge>;
}

function AuditProgressPanel({
  audit,
  result,
  coverage,
}: {
  audit: any;
  result: any;
  coverage: ReturnType<typeof auditCoverageMetrics>;
}) {
  const robotsFound = result.robots?.exists ? "robots.txt found" : "robots.txt missing";
  const sitemapFiles = Array.isArray(result.sitemap?.sitemaps) ? result.sitemap.sitemaps.length : 0;
  const progress = auditProgress(audit);
  const steps = [
    {
      label: "Resolve start URL",
      detail: result.startUrl || audit.url,
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
      detail: audit.status === "completed" ? `Score ${formatNumber(audit.score || 0)}` : audit.status === "failed" ? "Report did not finish" : "Grouping issues",
      evidence: `${formatNumber(audit.issue_count || 0)} issues saved in local SQLite.`,
    },
  ];
  return (
    <section className="rounded-md border bg-background">
      <div className="border-b px-5 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Scan progress</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {auditPhaseLabel(audit)} · {formatNumber(coverage.pages)} pages · {formatNumber(audit.issue_count || 0)} issues
            </p>
          </div>
          <Badge variant={audit.status === "completed" ? "good" : audit.status === "failed" ? "bad" : "warn"}>{scanStatusLabel(audit.status)}</Badge>
        </div>
        <div className="mt-4 space-y-2">
          <ProgressBar value={progress} />
          <div className="flex flex-col gap-1 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span className="break-all">{result.startUrl || audit.url}</span>
            <span className="nums">{formatNumber(progress)}%</span>
          </div>
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Step</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Evidence</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {steps.map((step, index) => (
            <TableRow key={step.label}>
              <TableCell className="min-w-52">
                <div className="font-medium">{step.label}</div>
                <div className="mt-1 break-all text-xs text-muted-foreground">{step.detail}</div>
              </TableCell>
              <TableCell className="min-w-32"><AuditStepBadge state={auditStepState(audit, index)} /></TableCell>
              <TableCell className="min-w-96 text-sm text-muted-foreground">{step.evidence}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

function AuditReportOverview({
  audit,
  result,
  summary,
  coverage,
  severityCounts,
  activeSeverity,
  onSeveritySelect,
}: {
  audit: any;
  result: any;
  summary: any;
  coverage: ReturnType<typeof auditCoverageMetrics>;
  severityCounts: { high: number; medium: number; low: number };
  activeSeverity: string;
  onSeveritySelect: (severity: string) => void;
}) {
  const score = audit.status === "completed" ? Number(audit.score || 0) : auditProgress(audit);
  const scoreVariant = audit.status === "failed" ? "bad" : score >= 85 ? "good" : score >= 60 ? "warn" : "bad";
  const sourceUrl = result.startUrl || audit.url;
  const canonicalTarget = result.pages?.find((page: any) => page.finalUrl)?.finalUrl || sourceUrl;
  const rows = [
    {
      area: "Issue impact",
      status: (
        <div className="flex flex-wrap gap-1">
          <Badge variant={severityCounts.high ? "bad" : "outline"}>{formatNumber(severityCounts.high)} high</Badge>
          <Badge variant={severityCounts.medium ? "warn" : "outline"}>{formatNumber(severityCounts.medium)} medium</Badge>
          <Badge variant="outline">{formatNumber(severityCounts.low)} low</Badge>
        </div>
      ),
      evidence: `${formatNumber(audit.issue_count || 0)} saved issues from ${formatNumber(coverage.pages)} crawled pages.`,
      action: (
        <div className="flex flex-wrap justify-end gap-2">
          {["high", "medium", "low"].map((severity) => (
            <Button
              key={severity}
              size="sm"
              variant={activeSeverity === severity ? "default" : "outline"}
              onClick={() => onSeveritySelect(severity)}
            >
              <ListChecks /> {severity}
            </Button>
          ))}
        </div>
      ),
    },
    {
      area: "Crawl scope",
      status: `${formatNumber(coverage.pages)} pages`,
      evidence: `${formatNumber(coverage.indexablePages)} indexable · ${formatNumber(coverage.nonIndexablePages)} non-indexable · ${formatNumber(coverage.unknownIndexabilityPages)} unknown · ${formatNumber(coverage.sitemapUrls)} sitemap-listed.`,
      action: <Badge variant={coverage.unknownIndexabilityPages || coverage.nonIndexablePages ? "warn" : "good"}>{coverage.unknownIndexabilityPages ? "needs checking" : "measured"}</Badge>,
    },
    {
      area: "Resources",
      status: `${formatNumber(coverage.linkTags)} links · ${formatNumber(coverage.imageTags)} images · ${formatNumber(coverage.assetTags)} CSS/JS`,
      evidence: `${formatNumber(coverage.checkedLinks)} link URLs checked (${formatNumber(coverage.brokenLinks)} failing) · ${formatNumber(coverage.checkedImages)} image URLs checked (${formatNumber(coverage.brokenImages)} failing) · ${formatNumber(coverage.checkedAssets)} CSS/JS checked (${formatNumber(coverage.brokenAssets)} failing).`,
      action: <Badge variant={coverage.brokenLinks || coverage.brokenImages || coverage.brokenAssets ? "bad" : "good"}>{coverage.brokenLinks || coverage.brokenImages || coverage.brokenAssets ? "failures" : "reachable"}</Badge>,
    },
    {
      area: "Metadata",
      status: `${formatNumber(summary.missingTitles || 0)} missing titles · ${formatNumber(summary.missingDescriptions || 0)} missing descriptions`,
      evidence: `${formatNumber(summary.titleLengthIssues || 0)} title length issues · ${formatNumber(summary.descriptionLengthIssues || 0)} description length issues · ${formatNumber(issueTypeCount(result.issues || [], "duplicate-title"))} duplicate titles.`,
      action: <Badge variant={summary.missingTitles || summary.missingDescriptions || summary.titleLengthIssues || summary.descriptionLengthIssues ? "warn" : "good"}>{summary.missingTitles || summary.missingDescriptions ? "fix" : "checked"}</Badge>,
    },
    {
      area: "Images",
      status: `${formatNumber(summary.missingAlt || 0)} alt issues · ${formatNumber(summary.imagesMissingDimensions || 0)} size issues`,
      evidence: `${formatNumber(summary.cssImageResources || 0)} CSS image URLs · ${formatNumber(summary.imagesMissingLazyLoading || 0)} lazy-loading issues · ${formatNumber(summary.largeImages || coverage.largeImages || 0)} large images.`,
      action: <Badge variant={summary.imageIssues || coverage.brokenImages ? "warn" : "good"}>{summary.imageIssues || coverage.brokenImages ? "inspect" : "clear"}</Badge>,
    },
    {
      area: "Start URL",
      status: audit.status,
      evidence: (
        <span className="break-all">
          Started at {sourceUrl}. Final home evidence: {canonicalTarget}.
        </span>
      ),
      action: <Badge variant={scoreVariant as any}>{formatNumber(score)} score</Badge>,
    },
  ];
  return (
    <ReportSection
      title="Audit health"
      description={`${auditPhaseLabel(audit)} · ${formatDate(audit.created_at)} · stored in local SQLite`}
    >
      <div className="grid gap-6 xl:grid-cols-[260px_1fr]">
        <div className="space-y-4 border-b pb-5 xl:border-b-0 xl:border-r xl:pb-0 xl:pr-6">
          <div>
            <div className="text-sm font-medium text-muted-foreground">Score</div>
            <div className="mt-2 flex items-end gap-3">
              <div className="nums text-7xl font-semibold leading-none">{formatNumber(score)}</div>
              <Badge variant={scoreVariant as any}>{scanStatusLabel(audit.status)}</Badge>
            </div>
          </div>
          <ProgressBar value={auditProgress(audit)} />
          <div className="text-sm leading-6 text-muted-foreground">
            {audit.status === "running" || audit.status === "queued"
              ? "This scan is still running and the evidence updates automatically."
              : `${formatNumber(audit.issue_count || 0)} issues saved for this run.`}
          </div>
          {audit.error ? <p className="rounded-md border border-destructive/40 bg-muted/30 p-3 text-sm text-destructive">{audit.error}</p> : null}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Area</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Evidence</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.area}>
                <TableCell className="min-w-44 font-medium">{row.area}</TableCell>
                <TableCell className="min-w-56">{row.status}</TableCell>
                <TableCell className="min-w-96 text-sm leading-6 text-muted-foreground">{row.evidence}</TableCell>
                <TableCell className="text-right">{row.action}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </ReportSection>
  );
}

function AuditActionBoard({
  audit,
  summary,
  coverage,
  issues,
  issueGroups,
  onSelectGroup,
}: {
  audit: any;
  summary: any;
  coverage: ReturnType<typeof auditCoverageMetrics>;
  issues: any[];
  issueGroups: any[];
  onSelectGroup: (group: any) => void;
}) {
  const priorityGroups = issueGroups
    .filter((group) => group.severity === "high" || group.severity === "medium");
  const checks = [
    { label: "Titles", value: Number(summary.missingTitles || 0) + Number(summary.titleLengthIssues || 0) + issueTypeCount(issues, "duplicate-title"), detail: `${formatNumber(coverage.pages)} pages checked`, tone: "bad" },
    { label: "Descriptions", value: Number(summary.missingDescriptions || 0) + Number(summary.descriptionLengthIssues || 0) + issueTypeCount(issues, "duplicate-description"), detail: `${formatNumber(coverage.pages)} pages checked`, tone: "bad" },
    { label: "Images", value: Number(summary.imageIssues || 0) + Number(coverage.brokenImages || 0), detail: `${formatNumber(coverage.imageTags)} tags · ${formatNumber(coverage.checkedImages)} URLs checked`, tone: "warn" },
    { label: "Links", value: Number(coverage.brokenLinks || 0) + Number(coverage.redirectedLinks || 0) + Number(summary.emptyAnchorLinks || 0), detail: `${formatNumber(coverage.linkTags)} tags · ${formatNumber(coverage.checkedLinks)} checked`, tone: "warn" },
    { label: "Indexing", value: Number(coverage.nonIndexablePages || 0) + Number(coverage.unknownIndexabilityPages || 0) + Number((summary.byCategory || {}).canonicals || 0), detail: coverage.unknownIndexabilityPages ? `${formatNumber(coverage.unknownIndexabilityPages)} pages need a fresh scan` : `${formatNumber(coverage.indexablePages)} of ${formatNumber(coverage.pages)} indexable`, tone: "bad" },
    { label: "Speed", value: Number(summary.performanceIssues || 0) + Number(coverage.largeImages || 0), detail: `${formatNumber(coverage.checkedAssets)} CSS/JS checked`, tone: "warn" },
  ];
  const coverageRows = [
    { label: "Pages crawled", value: coverage.pages, detail: coverage.unknownIndexabilityPages ? `${formatNumber(coverage.unknownIndexabilityPages)} unknown indexability` : `${formatNumber(coverage.indexablePages)} indexable` },
    { label: "Sitemap URLs reached", value: coverage.sitemapUrls, detail: `${formatNumber(coverage.pagesMissingFromSitemap)} missing from sitemap` },
    { label: "Links checked", value: coverage.checkedLinks, detail: `${formatNumber(coverage.brokenLinks)} failing` },
    { label: "Image URLs checked", value: coverage.checkedImages, detail: `${formatNumber(coverage.brokenImages)} failing` },
    { label: "CSS image URLs", value: coverage.cssImageResources, detail: "background and stylesheet URLs" },
    { label: "CSS/JS checked", value: coverage.checkedAssets, detail: `${formatNumber(coverage.brokenAssets)} failing` },
    { label: "Orphan pages", value: coverage.orphanPages, detail: `${formatNumber(coverage.deepPages)} deep URLs` },
  ];
  return (
    <div className="space-y-5">
      <ReportSection
        title="Fix first"
        description={
          <div className="flex flex-wrap items-center gap-2">
            <span>Grouped issues with the highest crawl and search impact.</span>
            <Badge variant={audit.status === "completed" ? "good" : "warn"}>{scanStatusLabel(audit.status)}</Badge>
          </div>
        }
      >
          {priorityGroups.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Severity</TableHead>
                  <TableHead>Issue</TableHead>
                  <TableHead>Affected</TableHead>
                  <TableHead>Fix</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {priorityGroups.map((group) => (
                  <TableRow key={group.key}>
                    <TableCell><Badge variant={severityVariant(group.severity) as any}>{group.severity}</Badge></TableCell>
                    <TableCell className="min-w-80">
                      <div className="font-medium">{group.message}</div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <Badge variant="outline">{issueCategoryLabel(group.category)}</Badge>
                        <Badge variant="outline">{String(group.type || "").replaceAll("-", " ")}</Badge>
                      </div>
                    </TableCell>
                    <TableCell className="nums text-lg font-semibold">{formatNumber(group.count)}</TableCell>
                    <TableCell className="min-w-96 text-sm leading-6 text-muted-foreground">{group.recommendation}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => onSelectGroup(group)}>
                        <ListChecks /> Show {formatNumber(group.count)} issues
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState title="No priority blockers" text={audit.status === "completed" ? "High and medium issue groups are clear." : "Priority issues appear while the scan runs."} />
          )}
      </ReportSection>
      <ReportSection title="Audit coverage" description="What this local run actually checked.">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Area</TableHead>
              <TableHead>Problems</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Evidence</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {checks.map((check) => (
              <TableRow key={check.label}>
                <TableCell className="min-w-44 font-medium">{check.label}</TableCell>
                <TableCell className="nums text-lg font-semibold">{formatNumber(check.value)}</TableCell>
                <TableCell><Badge variant={(Number(check.value) ? check.tone : "good") as any}>{Number(check.value) ? "issues" : "clear"}</Badge></TableCell>
                <TableCell className="min-w-96 text-sm text-muted-foreground">{check.detail}</TableCell>
              </TableRow>
            ))}
            {coverageRows.map((row) => (
              <TableRow key={row.label}>
                <TableCell className="min-w-44 font-medium">{row.label}</TableCell>
                <TableCell className="nums text-lg font-semibold">{formatNumber(row.value)}</TableCell>
                <TableCell><Badge variant="outline">measured</Badge></TableCell>
                <TableCell className="min-w-96 text-sm text-muted-foreground">{row.detail}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ReportSection>
    </div>
  );
}

function AuditCheckMatrix({
  summary,
  coverage,
  issues,
  onSelectCheck,
}: {
  summary: any;
  coverage: ReturnType<typeof auditCoverageMetrics>;
  issues: any[];
  onSelectCheck: (row: AuditCheckRowModel) => void;
}) {
  const byCategory = summary.byCategory || {};
  const sections: AuditCheckSectionModel[] = [
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
      ] satisfies AuditCheckRowModel[],
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
    <ReportSection title="Audit checks" description="Every local check grouped into one readable table. Use the issue buttons to open the matching rows.">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Area</TableHead>
            <TableHead>Check</TableHead>
            <TableHead>Count</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Issue types</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => <AuditCheckRow key={`${row.area}:${row.label}`} row={row} onSelect={onSelectCheck} />)}
        </TableBody>
      </Table>
    </ReportSection>
  );
}

function AuditCheckRow({ row, onSelect }: { row: AuditCheckRowModel & { area?: string; areaText?: string }; onSelect: (row: AuditCheckRowModel) => void }) {
  const value = Number(row.value || 0);
  const variant = row.problem ? (value > 0 ? row.severity || "warn" : "good") : "outline";
  const clickable = Boolean(row.problem && value > 0 && row.types?.length);
  return (
    <TableRow>
      <TableCell className="min-w-44">
        <div className="font-medium">{row.area}</div>
        <div className="mt-1 text-xs text-muted-foreground">{row.areaText}</div>
      </TableCell>
      <TableCell className="min-w-56 font-medium">{row.label}</TableCell>
      <TableCell className="nums text-lg font-semibold">{formatNumber(value)}</TableCell>
      <TableCell>
        {row.problem ? (
          <Badge variant={variant as any}>{value ? "issues" : "clear"}</Badge>
        ) : (
          <Badge variant="outline">evidence</Badge>
        )}
      </TableCell>
      <TableCell className="min-w-64">
        {row.types?.length ? (
          <div className="flex flex-wrap gap-1">
            {row.types.map((type) => <Badge key={type} variant="outline">{type.replaceAll("-", " ")}</Badge>)}
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">Measured evidence</span>
        )}
      </TableCell>
      <TableCell className="text-right">
        {clickable ? (
          <Button size="sm" variant="outline" onClick={() => onSelect(row)}>
            <ListChecks /> Show {formatNumber(value)} issues
          </Button>
        ) : row.problem ? (
          <Badge variant="good">No issues</Badge>
        ) : (
          <Badge variant="outline">Evidence</Badge>
        )}
      </TableCell>
    </TableRow>
  );
}

function AuditIssueGroups({ groups, onSelect }: { groups: any[]; onSelect: (group: any) => void }) {
  return (
    <ReportSection
      title="Priority work queue"
      description={
        <div className="flex flex-wrap items-center gap-2">
          <span>Grouped by issue type so repeated failures become one clear task.</span>
          <Badge variant="outline">{formatNumber(groups.length)} groups</Badge>
        </div>
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Severity</TableHead>
            <TableHead>Issue group</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Affected</TableHead>
            <TableHead>Recommended fix</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((group) => (
            <TableRow key={group.key}>
              <TableCell><Badge variant={severityVariant(group.severity) as any}>{group.severity}</Badge></TableCell>
              <TableCell className="min-w-72">
                <div className="font-medium">{group.message}</div>
                <div className="mt-1 text-xs text-muted-foreground">{String(group.type || "").replaceAll("-", " ")}</div>
              </TableCell>
              <TableCell className="min-w-36">
                <Badge variant="outline">{issueCategoryLabel(group.category)}</Badge>
              </TableCell>
              <TableCell className="nums text-lg font-semibold">{formatNumber(group.count)}</TableCell>
              <TableCell className="min-w-96 text-sm leading-6 text-muted-foreground">{group.recommendation}</TableCell>
              <TableCell className="text-right">
                <Button size="sm" variant="outline" onClick={() => onSelect(group)}>
                  <ListChecks /> Show {formatNumber(group.count)} issues
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ReportSection>
  );
}

function AuditSection({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <div className="space-y-3">
      <div>
        <div className="font-medium">{title}</div>
        <p className="text-sm text-muted-foreground">{text}</p>
      </div>
      {children}
    </div>
  );
}

function AuditIssuesTable({ rows }: { rows: any[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Severity</TableHead>
          <TableHead>Page</TableHead>
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
              <TableCell><Badge variant={severityVariant(issue.severity) as any}>{issue.severity}</Badge></TableCell>
              <TableCell className="min-w-72">
                <div className="break-all font-medium">{issue.url || "-"}</div>
              </TableCell>
              <TableCell className="min-w-72">
                <div className="font-medium">{issue.message}</div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Badge variant="outline">{issueCategoryLabel(issue.category)}</Badge>
                  <Badge variant="outline">{String(issue.type || "").replaceAll("-", " ")}</Badge>
                </div>
              </TableCell>
              <TableCell className="min-w-96 text-sm leading-6 text-muted-foreground">
                {issue.recommendation || "Inspect this item and update the affected page."}
              </TableCell>
              <TableCell className="min-w-80 text-xs leading-5 text-muted-foreground">
                {evidence.length ? evidence.map(([key, value]) => (
                  <div key={key} className="grid gap-1 py-0.5 sm:grid-cols-[120px_1fr]">
                    <span className="font-medium text-foreground">{key}</span>
                    <span className="break-all">{evidenceText(value)}</span>
                  </div>
                )) : "-"}
              </TableCell>
              <TableCell className="text-right">
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

function evidenceText(value: unknown) {
  if (value == null || value === "") return "-";
  if (Array.isArray(value)) {
    return value.map((item) => typeof item === "string" || typeof item === "number" ? String(item) : JSON.stringify(item)).join(", ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function AuditMetadataTable({ rows }: { rows: any[] }) {
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

function AuditPagesTable({ rows }: { rows: any[] }) {
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Page</TableHead><TableHead>Status</TableHead><TableHead>Indexable</TableHead><TableHead>Depth</TableHead><TableHead>Found by</TableHead><TableHead>Inlinks</TableHead><TableHead>Sitemap</TableHead><TableHead>Title</TableHead><TableHead>Description</TableHead><TableHead>H1/H2</TableHead><TableHead>Load</TableHead><TableHead>Links</TableHead><TableHead>Images</TableHead><TableHead>Words</TableHead><TableHead>Issues</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map((page) => (
          <TableRow key={page.url}>
            <TableCell className="max-w-xs">
              <div className="truncate font-medium">{page.title || page.url}</div>
              <div className="truncate text-xs text-muted-foreground">{page.url}</div>
            </TableCell>
            <TableCell><Badge variant={page.status >= 400 ? "bad" : page.status >= 300 ? "warn" : "good"}>{page.status}</Badge></TableCell>
            <TableCell><IndexabilityBadge page={page} /></TableCell>
            <TableCell className="nums">{page.depth ?? 0}</TableCell>
            <TableCell><Badge variant={page.discovery === "sitemap" ? "warn" : "outline"}>{page.discovery || "crawl"}</Badge></TableCell>
            <TableCell className="nums">{formatNumber(page.internalInlinks || 0)}</TableCell>
            <TableCell><Badge variant={page.sitemapListed ? "good" : "warn"}>{page.sitemapListed ? "Listed" : "Missing"}</Badge></TableCell>
            <TableCell className="nums">{textLength(page.title, page.titleLength)}</TableCell>
            <TableCell className="nums">{textLength(page.description, page.descriptionLength)}</TableCell>
            <TableCell className="nums">{pageH1Count(page)} / {page.h2Count || 0}</TableCell>
            <TableCell className="nums">{page.loadMs ? `${formatNumber(page.loadMs)} ms` : "-"}</TableCell>
            <TableCell className="nums">{formatNumber((page.internalLinks || 0) + (page.externalLinks || 0))}</TableCell>
            <TableCell className="nums">{page.images || 0}</TableCell>
            <TableCell className="nums">{formatNumber(page.wordCount)}</TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                <Badge variant={(page.issues || []).some((issue: any) => issue.severity === "high") ? "bad" : "outline"}>{(page.issues || []).filter((issue: any) => issue.severity === "high").length} high</Badge>
                <Badge variant={(page.issues || []).some((issue: any) => issue.severity === "medium") ? "warn" : "outline"}>{(page.issues || []).filter((issue: any) => issue.severity === "medium").length} med</Badge>
                <Badge variant="outline">{(page.issues || []).filter((issue: any) => issue.severity === "low").length} low</Badge>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function AuditImageSummaryTable({ rows }: { rows: any[] }) {
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

function AuditLinksTable({ rows }: { rows: any[] }) {
  return (
    <Table>
      <TableHeader><TableRow><TableHead>URL</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Anchor</TableHead><TableHead>Final URL</TableHead><TableHead>From</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={`${row.url}:${index}`}>
            <TableCell className="max-w-sm break-all font-medium">{row.url}</TableCell>
            <TableCell><Badge variant="outline">{row.type}</Badge></TableCell>
            <TableCell><Badge variant={!row.ok ? "bad" : row.redirected || row.finalUrl !== row.url ? "warn" : "good"}>{row.status || row.error || "failed"}</Badge></TableCell>
            <TableCell className="max-w-xs truncate text-muted-foreground">{row.anchor || "-"}</TableCell>
            <TableCell className="max-w-xs truncate text-muted-foreground">{row.finalUrl && row.finalUrl !== row.url ? row.finalUrl : "-"}</TableCell>
            <TableCell className="max-w-xs truncate text-muted-foreground">{row.from}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function AuditAssetsTable({ rows }: { rows: any[] }) {
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

function AuditImagesTable({ rows }: { rows: any[] }) {
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

function AuditImageInventoryTable({ rows }: { rows: any[] }) {
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

function AuditLinkInventoryTable({ rows }: { rows: any[] }) {
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

function GscPage({ site }: { site: Site }) {
  const defaultInspectionUrl = site.domain ? `${preferredAuditUrl(site).replace(/\/$/, "")}/` : "";
  const defaultGscProperty = site.domain ? `sc-domain:${cleanSiteDomain(site.domain).replace(/^www\./i, "")}` : "";
  const [status, setStatus] = useState<any>(null);
  const [sites, setSites] = useState<any[]>([]);
  const [imports, setImports] = useState<any[]>([]);
  const [performance, setPerformance] = useState<any>(null);
  const [inspectUrls, setInspectUrls] = useState(defaultInspectionUrl);
  const [inspection, setInspection] = useState<any>(null);
  const [dimension, setDimension] = useState("query");
  const [importSiteUrl, setImportSiteUrl] = useState(defaultGscProperty);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState("");
  const today = new Date();
  const defaultEndDate = today.toISOString().slice(0, 10);
  const defaultStartDate = new Date(today.getTime() - 28 * 86400000).toISOString().slice(0, 10);
  const [dateRange, setDateRange] = useState({ startDate: defaultStartDate, endDate: defaultEndDate });
  const latestImport = imports[0];

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
    setError("");
    try {
      const { url } = await api.gscStart(site.id);
      window.open(url, "_blank", "width=680,height=780");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start Google connection");
    }
  }
  async function loadSites() {
    setLoading("sites");
    setError("");
    try {
      setSites(await api.gscSites(site.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load Search Console properties");
    } finally {
      setLoading("");
    }
  }
  async function selectSite(siteUrl: string) {
    setLoading("site");
    setError("");
    try {
      setStatus(await api.gscSetSite(site.id, siteUrl));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not select property");
    } finally {
      setLoading("");
    }
  }
  async function query() {
    setLoading("performance");
    setError("");
    try {
      setPerformance(await api.gscPerformance({
        siteId: site.id,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        dimensions: [dimension],
        rowLimit: 100,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not query Search Console performance");
    } finally {
      setLoading("");
    }
  }
  async function importCsv(event: FormEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setLoading("import");
    setError("");
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
      setError(err instanceof Error ? err.message : "Could not import Search Console CSV");
    } finally {
      input.value = "";
      setLoading("");
    }
  }
  async function inspect() {
    setLoading("inspection");
    setError("");
    try {
      setInspection(await api.gscInspect({ siteId: site.id, urls: inspectUrls }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not inspect URLs");
    } finally {
      setLoading("");
    }
  }
  async function disconnect() {
    setLoading("disconnect");
    setError("");
    try {
      await api.gscDisconnect(site.id);
      setSites([]);
      setPerformance(null);
      setInspection(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect Search Console");
    } finally {
      setLoading("");
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Google"
        title="Search Console"
        description="Connect Google when OAuth is available, or import a Search Console CSV into local SQLite."
        action={<Badge variant={status?.connected || imports.length ? "good" : status?.configured ? "warn" : "outline"}>{status?.connected ? "Connected" : imports.length ? "Local imports" : status?.configured ? "Ready to connect" : "OAuth missing"}</Badge>}
      />
      {error ? <p className="mb-4 rounded-md border border-destructive/40 bg-muted/30 p-3 text-sm text-destructive">{error}</p> : null}
      <Tabs defaultValue="performance" className="space-y-5">
        <TabsList>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="import">Local import</TabsTrigger>
          <TabsTrigger value="inspection">URL inspection</TabsTrigger>
          <TabsTrigger value="connection">Connection</TabsTrigger>
        </TabsList>
        <TabsContent value="performance" className="space-y-5">
          <ReportSection
            title="Performance rows"
            description={performance?.source === "import" ? `Viewing ${performance.import?.sourceName || "local import"} from ${formatDate(performance.import?.createdAt)}` : "Clicks, impressions, CTR, and average position from Search Console."}
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
            description="Export Search Console performance as CSV and store it in this app's SQLite database."
          >
            <div className="grid gap-4 lg:grid-cols-[minmax(260px,360px)_minmax(260px,1fr)]">
              <Field label="Property label">
                <Input value={importSiteUrl} onChange={(event) => setImportSiteUrl(event.target.value)} placeholder="sc-domain:example.com" />
              </Field>
              <Field label="CSV file">
                <Input type="file" accept=".csv,text/csv" onChange={importCsv} disabled={loading === "import"} />
              </Field>
            </div>
            <div className="mt-5">
              {latestImport ? (
                <StatusEvidenceTable
                  rows={[
                    { title: "Latest import", status: "Saved", tone: "good", text: `${latestImport.sourceName || "Search Console CSV"} · ${formatDate(latestImport.createdAt)}` },
                    { title: "Rows", status: formatNumber(latestImport.rowCount), tone: "good", text: `${formatNumber(latestImport.totals?.clicks || 0)} clicks · ${formatNumber(latestImport.totals?.impressions || 0)} impressions` },
                    { title: "Storage", status: "SQLite", tone: "good", text: "Rows are stored locally and can be reopened without Google OAuth." },
                  ]}
                />
              ) : (
                <EmptyState title="No imports yet" text="Choose a Search Console CSV export to save real performance evidence locally." />
              )}
            </div>
            {imports.length ? <GscImportHistory rows={imports} onOpen={showImport} /> : null}
          </ReportSection>
        </TabsContent>
        <TabsContent value="inspection" className="space-y-5">
          <ReportSection title="URL inspection" description="Inspect up to 20 URLs against the selected Google property.">
            <div className="space-y-4">
              <Textarea value={inspectUrls} onChange={(event) => setInspectUrls(event.target.value)} placeholder="https://example.com/page" />
              <Button onClick={inspect} disabled={!status?.connection?.siteUrl || loading === "inspection"}><ExternalLink /> {loading === "inspection" ? "Inspecting" : "Inspect URLs"}</Button>
              {inspection?.rows?.length ? <GscInspectionResults rows={inspection.rows} /> : null}
            </div>
          </ReportSection>
        </TabsContent>
        <TabsContent value="connection" className="space-y-5">
          <ReportSection
            title="Google connection"
            description={status?.configured ? "OAuth is available in this local runtime." : "OAuth is not configured; local CSV import still works."}
          >
            <div className="space-y-4">
              <StatusEvidenceTable
                rows={[
                  { title: "Google account", status: status?.connected ? "Connected" : "Not connected", tone: status?.connected ? "good" : "warn", text: status?.connection?.accountEmail || "Connect once, then choose the matching property." },
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
    <div className="mt-5 overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Import</TableHead>
            <TableHead>Property</TableHead>
            <TableHead>Rows</TableHead>
            <TableHead>Clicks</TableHead>
            <TableHead>Impressions</TableHead>
            <TableHead>Date</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-medium">{row.sourceName || "Search Console CSV"}</TableCell>
              <TableCell className="break-all text-sm text-muted-foreground">{row.siteUrl || "-"}</TableCell>
              <TableCell className="nums">{formatNumber(row.rowCount)}</TableCell>
              <TableCell className="nums">{formatNumber(row.totals?.clicks || 0)}</TableCell>
              <TableCell className="nums">{formatNumber(row.totals?.impressions || 0)}</TableCell>
              <TableCell>{formatDate(row.createdAt)}</TableCell>
              <TableCell className="text-right">
                <Button size="sm" variant="outline" onClick={() => onOpen(row)}>Open</Button>
              </TableCell>
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
      title="Performance totals"
      items={[
        { title: "Clicks", value: totals.clicks, icon: Activity },
        { title: "Impressions", value: totals.impressions, icon: Search },
        { title: "CTR %", value: Number((ctr * 100).toFixed(1)), icon: Gauge },
        { title: "Avg. position", value: Number(position.toFixed(1)), icon: Target },
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

function AiPage({ site }: { site: Site }) {
  const [prompts, setPrompts] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [type, setType] = useState("seo.coach");
  const [context, setContext] = useState(`Site: ${site.name}\nDomain: ${site.domain}`);
  const [activeJobId, setActiveJobId] = useState("");
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

  async function submit(event: FormEvent) {
    event.preventDefault();
    const prompt = prompts.find((item) => item.key === type)?.template?.replace("{{context}}", context) || context;
    const job = await api.createAiJob({ type, prompt });
    if (job?.id) setActiveJobId(job.id);
    await load();
  }

  return (
    <>
      <PageHeader eyebrow="Local Codex" title="AI lab" description="SEO coach, keyword clustering, audit prioritization, competitor gaps, and AI visibility through local Codex medium jobs." />
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
            <Button><Bot /> Start job</Button>
          </form>
        </ReportSection>
        <div className="space-y-6">
          <ReportSection
            title="Jobs"
            description={
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span>Saved local Codex runs from SQLite.</span>
                <Button size="sm" variant="outline" type="button" onClick={() => load().catch(console.error)}>
                  <RefreshCw /> Refresh
                </Button>
              </div>
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

function JobTable({
  rows,
  selectedId,
  onSelect,
}: {
  rows: any[];
  selectedId?: string;
  onSelect?: (id: string) => void;
}) {
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Workflow</TableHead><TableHead>Status</TableHead><TableHead>Message</TableHead><TableHead>Created</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={row.id}
            className={cn(onSelect ? "cursor-pointer" : "", selectedId === row.id ? "bg-accent/45" : "")}
            onClick={() => onSelect?.(row.id)}
          >
            <TableCell className="font-medium">{row.type}</TableCell>
            <TableCell><Badge variant={row.status === "completed" ? "good" : row.status === "failed" ? "bad" : "warn"}>{row.status}</Badge></TableCell>
            <TableCell className="max-w-md truncate text-muted-foreground">{row.error || row.message || row.result_text || "-"}</TableCell>
            <TableCell className="text-muted-foreground">{row.created_at}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function AiJobOutput({ job }: { job: any }) {
  return (
    <ReportSection
      title="Job output"
      description={job ? `${job.type} · ${formatDate(job.created_at)}` : "Select a saved Codex job to read its full local result."}
    >
      {job ? (
        <div className="space-y-4">
          <StatusEvidenceTable
            rows={[
              { title: "Status", status: job.status || "-", tone: job.status === "completed" ? "good" : job.status === "failed" ? "bad" : "warn", text: job.message || "Local Codex job state." },
              { title: "Started", status: job.started_at ? formatDate(job.started_at) : "-", tone: "outline", text: "Timestamp stored in local SQLite for this job." },
              { title: "Finished", status: job.finished_at ? formatDate(job.finished_at) : "-", tone: job.finished_at ? "good" : "outline", text: "Completion timestamp from the saved job row." },
            ]}
          />
          {job.error ? (
            <pre className="max-h-[520px] overflow-auto rounded-md border border-destructive/40 bg-muted/30 p-4 text-sm leading-6 text-destructive whitespace-pre-wrap">{job.error}</pre>
          ) : job.result_text ? (
            <pre className="max-h-[520px] overflow-auto rounded-md border bg-muted/30 p-4 text-sm leading-6 whitespace-pre-wrap">{job.result_text}</pre>
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

function McpPage() {
  const [tools, setTools] = useState<any[]>([]);
  useEffect(() => {
    api.mcpTools().then((data) => setTools(data.tools || [])).catch(console.error);
  }, []);
  const endpoint = `${window.location.origin}/mcp`;
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
      body: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "scan_site", arguments: { siteId: "site-id" } } },
    },
    {
      title: "Read Search Console",
      body: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_gsc_performance", arguments: { siteId: "site-id", startDate: "2026-06-01", endDate: "2026-06-30", dimensions: ["query"] } } },
    },
    {
      title: "Read organic domain",
      body: { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_domain_overview", arguments: { siteId: "site-id", domain: "example.com" } } },
    },
    {
      title: "Read link index",
      body: { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_backlinks_profile", arguments: { siteId: "site-id", domain: "example.com", tab: "domains" } } },
    },
  ];
  return (
    <>
      <PageHeader
        eyebrow="Agents"
        title="MCP"
        description="Local JSON-RPC tools for sites, scans, keywords, rank tracking, Search Console, AI jobs, and reports."
        action={<Badge variant="good">{formatNumber(tools.length)} tools</Badge>}
      />
      <div className="grid gap-6 2xl:grid-cols-[460px_minmax(0,1fr)]">
        <div className="space-y-4">
          <ReportSection title="Endpoint" description="Use this from local agents and scripts.">
            <div className="space-y-3">
              <code className="block break-all rounded-md bg-secondary px-3 py-2 text-sm">{`POST ${endpoint}`}</code>
              <p className="text-sm text-muted-foreground">If a local token is configured, include `Authorization: Bearer ...` with the request.</p>
            </div>
          </ReportSection>
          <ReportSection title="Common calls" description="Known-good JSON-RPC request shapes.">
            <div className="space-y-3">
              {examples.map((example) => <McpExample key={example.title} title={example.title} value={example.body} />)}
            </div>
          </ReportSection>
        </div>
        <div className="space-y-4">
          {Object.entries(groupedTools).map(([group, rows]) => (
            <ReportSection
              key={group}
              title={group}
              description={`${formatNumber(rows.length)} local MCP tools`}
            >
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
  if (/site|whoami/.test(name)) return "Sites";
  if (/keyword|serp|rank/.test(name)) return "Keywords and ranks";
  if (/audit|scan/.test(name)) return "Audits";
  if (/domain|backlink/.test(name)) return "Competitive data";
  if (/gsc|inspect/.test(name)) return "Search Console";
  if (/brand|prompt|ai/.test(name)) return "AI visibility";
  return "Other";
}

function McpExample({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="font-medium">{title}</div>
      <pre className="mt-2 overflow-auto rounded-md bg-secondary p-3 text-xs leading-relaxed text-secondary-foreground">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function SettingsPage() {
  const [config, setConfig] = useState<any>({});
  const [form, setForm] = useState<any>({});

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
    });
  }
  useEffect(() => {
    load().catch(console.error);
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    await api.saveConfig({
      codex_model: String(form.codex_model || "").trim(),
      codex_reasoning_effort: String(form.codex_reasoning_effort || "medium").trim(),
      default_location_code: String(form.default_location_code || 2840),
      default_language_code: String(form.default_language_code || "en"),
      default_crawl_protocol: String(form.default_crawl_protocol || "auto"),
      default_crawl_host: String(form.default_crawl_host || "auto"),
    });
    await load();
  }

  return (
    <>
      <PageHeader eyebrow="Local" title="App settings" description="Preferences for the local app. Data sources are shown as status, not secret fields." />
      <div className="grid gap-6 2xl:grid-cols-[460px_minmax(0,1fr)]">
        <ReportSection title="App preferences" description="Defaults used when a new site is added. Existing sites keep their own saved settings.">
          <form className="space-y-5" onSubmit={save}>
            <div>
              <h3 className="text-sm font-semibold">Keyword tool defaults</h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Used for keyword research, SERP checks, and rank tracking. They do not restrict multilingual site audits.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Default keyword market">
                <Select value={String(form.default_location_code || 2840)} onValueChange={(value) => setForm({ ...form, default_location_code: Number(value) })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {marketOptions.map((market) => <SelectItem key={market.code} value={String(market.code)}>{market.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Default keyword result language">
                <Select value={form.default_language_code || "en"} onValueChange={(value) => setForm({ ...form, default_language_code: value })}>
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
            </div>
            <div className="border-t pt-5">
              <div className="mb-3">
                <h3 className="font-semibold">Codex defaults</h3>
                <p className="mt-1 text-sm text-muted-foreground">Local AI jobs use medium reasoning. Leave the model empty to use your Codex CLI default.</p>
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
            <Button><Settings /> Save app settings</Button>
          </form>
        </ReportSection>
        <ReportSection title="Data sources" description="What the app can run locally now and what needs a real connected source.">
          <StatusEvidenceTable
            rows={[
              {
                title: "Local SQLite database",
                status: "Source of truth",
                tone: "good",
                text: (
                  <span className="break-all">
                    {config.local_db_path || "Database path unavailable"} · {formatNumber(config.local_site_count || 0)} sites · {formatNumber(config.local_audit_count || 0)} scans · {formatNumber(config.local_gsc_import_count || 0)} Search Console imports
                  </span>
                ),
              },
              { title: "Technical audits", status: "Active", tone: "good", text: "Local crawler checks metadata, images, links, robots, sitemap, indexability, headings, content, schema, and social tags." },
              { title: "Keyword ideas", status: "Active", tone: "good", text: "DuckDuckGo suggestions provide real query ideas. Volume, CPC, and difficulty stay blank unless a metrics source is connected." },
              { title: "SERP and rank checks", status: serpProviderStatus(config), tone: "good", text: "Uses local/self-hosted OpenSERP or SearXNG when configured, otherwise live DuckDuckGo results. The source is shown on each report." },
              { title: "Search Console", status: "Local import ready", tone: "good", text: "Import Search Console CSVs locally. Google connection is optional for live performance and URL inspection." },
              { title: "Backlink index", status: config.dataforseo_api_key ? "Connected" : "Not connected", tone: config.dataforseo_api_key ? "good" : "warn", text: "No generated backlink rows are shown. Web-wide backlink rows require a real backlink index." },
              { title: "MCP endpoint", status: "Local", tone: "good", text: "The local JSON-RPC endpoint is available from the MCP screen." },
            ]}
          />
        </ReportSection>
      </div>
    </>
  );
}

export default function App() {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);

  async function check() {
    try {
      const status = await auth.me();
      setAuthenticated(status.authenticated);
      setSetupRequired(Boolean(status.setupRequired));
    } catch (error: any) {
      setAuthenticated(false);
      setSetupRequired(Boolean(error?.message?.includes("401")));
      try {
        const response = await fetch("/api/auth/me", { credentials: "include" });
        const data = await response.json();
        setSetupRequired(Boolean(data.setupRequired));
      } catch {
        setSetupRequired(false);
      }
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    check();
  }, []);

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Badge>Loading local data</Badge>
      </div>
    );
  }

  if (!authenticated) {
    return <LoginScreen setupRequired={setupRequired} onSuccess={() => setAuthenticated(true)} />;
  }

  return <AppWorkspace />;
}
