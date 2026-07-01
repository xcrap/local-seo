import { cloneElement, isValidElement, useId, useMemo, useState, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Activity, BarChart3, Bot, Cable, CalendarDays, FileSearch, Gauge, Globe2, Info, Link2, Plus, Search, Sparkles, TableProperties, Target, Zap } from "lucide-react";
import type { Site } from "../api";
import { Badge, Button, Calendar, Input, Label, Popover, PopoverContent, PopoverTrigger, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui";
import { cn } from "@/lib/utils";

export const navGroups: { label: string; items: { to: string; label: string; icon: any }[] }[] = [
  { label: "Workspace", items: [{ to: "/overview", label: "Overview", icon: Gauge }] },
  {
    label: "Research",
    items: [
      { to: "/keywords", label: "Keywords", icon: Search },
      { to: "/serp", label: "SERP analysis", icon: Activity },
      { to: "/saved", label: "Saved keywords", icon: TableProperties },
      { to: "/domain", label: "Organic research", icon: Globe2 },
    ],
  },
  {
    label: "Rankings",
    items: [
      { to: "/rank", label: "Rank tracking", icon: Target },
      { to: "/gsc", label: "Search Console", icon: BarChart3 },
    ],
  },
  {
    label: "Technical",
    items: [
      { to: "/scans", label: "Site scans", icon: FileSearch },
      { to: "/links", label: "Links", icon: Link2 },
    ],
  },
  {
    label: "AI & discovery",
    items: [
      { to: "/brand", label: "Brand lookup", icon: Sparkles },
      { to: "/prompts", label: "Prompt explorer", icon: Bot },
      { to: "/ai", label: "AI lab", icon: Zap },
      { to: "/mcp-tools", label: "MCP", icon: Cable },
    ],
  },
];
export const navItems = navGroups.flatMap((group) => group.items);

export const defaultKeywordLocationCode = 2840;
export const defaultKeywordLanguageCode = "en";

export const marketOptions = [
  { code: defaultKeywordLocationCode, label: "United States" },
  { code: 2620, label: "Portugal" },
  { code: 2826, label: "United Kingdom" },
  { code: 2724, label: "Spain" },
  { code: 2250, label: "France" },
  { code: 2276, label: "Germany" },
  { code: 2076, label: "Brazil" },
  { code: 2124, label: "Canada" },
];

export const languageOptions = [
  { code: "pt", label: "Portuguese" },
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
];

export const crawlProtocolOptions = [
  { value: "auto", label: "Auto" },
  { value: "https", label: "HTTPS only" },
  { value: "http", label: "HTTP only" },
  { value: "both", label: "Try HTTP and HTTPS" },
] as const;

export const crawlHostOptions = [
  { value: "auto", label: "Auto" },
  { value: "root", label: "Without www" },
  { value: "www", label: "With www" },
  { value: "both", label: "Try both" },
] as const;

export type ScanUrlPlan = {
  domain?: string;
  crawl_protocol?: Site["crawl_protocol"];
  crawl_host?: Site["crawl_host"];
};

export function defaultLocationCodeFromConfig(config?: any) {
  const code = Number(config?.default_location_code || defaultKeywordLocationCode);
  return marketOptions.some((market) => market.code === code) ? code : defaultKeywordLocationCode;
}

export function defaultLanguageCodeFromConfig(config?: any) {
  const code = String(config?.default_language_code || defaultKeywordLanguageCode);
  return languageOptions.some((language) => language.code === code) ? code : defaultKeywordLanguageCode;
}

export function defaultCrawlProtocolFromConfig(config?: any): Site["crawl_protocol"] {
  const value = String(config?.default_crawl_protocol || "auto");
  return crawlProtocolOptions.some((option) => option.value === value) ? value as Site["crawl_protocol"] : "auto";
}

export function defaultCrawlHostFromConfig(config?: any): Site["crawl_host"] {
  const value = String(config?.default_crawl_host || "auto");
  return crawlHostOptions.some((option) => option.value === value) ? value as Site["crawl_host"] : "auto";
}

export const activeSiteStorageKey = "local-seo:site";
export const selectedScanStoragePrefix = "local-seo:selected-scan";
export const siteActionMessageStorageKey = "local-seo:site-action-message";

export function selectedScanStorageKey(siteId: string) {
  return `${selectedScanStoragePrefix}:${siteId}`;
}

export function getSelectedScanId(siteId: string) {
  return localStorage.getItem(selectedScanStorageKey(siteId)) || "";
}

export function setSelectedScanId(siteId: string, scanId: string) {
  localStorage.setItem(selectedScanStorageKey(siteId), scanId);
}

export function clearSelectedScanId(siteId?: string) {
  if (siteId) localStorage.removeItem(selectedScanStorageKey(siteId));
}

export function takeSiteActionMessage() {
  const message = sessionStorage.getItem(siteActionMessageStorageKey) || "";
  if (message) sessionStorage.removeItem(siteActionMessageStorageKey);
  return message;
}

export function stashSiteActionMessage(message: string) {
  sessionStorage.setItem(siteActionMessageStorageKey, message);
}

export function marketLabel(code: number) {
  return marketOptions.find((item) => item.code === Number(code))?.label || `Market ${code}`;
}

export function languageLabel(code: string) {
  return languageOptions.find((item) => item.code === code)?.label || code;
}

export function keywordToolDefaultsLabel(site: Site) {
  return `${marketLabel(site.location_code)} · ${languageLabel(site.language_code)}`;
}

export function KeywordToolDefaultsPanel({
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
    <div className="rounded-xl bg-muted/40">
      <Button
        type="button"
        variant="ghost"
        className="h-auto w-full justify-between gap-4 rounded-none px-4 py-3 text-left hover:bg-muted/40"
        onClick={onToggle}
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold">Keyword tool defaults</span>
          <span className="mt-1 block text-xs leading-5 text-muted-foreground">
            Optional. Used by keyword research, SERP checks, and rank tracking. Site scans crawl every page language they find.
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

export function localSiteHost(domain: string) {
  const host = (
    domain.startsWith("[") && domain.includes("]")
      ? domain.slice(1, domain.indexOf("]"))
      : domain.split(":")[0]
  )?.toLowerCase() || "";
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
}

export function cleanSiteDomain(domain?: string) {
  return String(domain || "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
}

export function domainKey(domain?: string) {
  return cleanSiteDomain(domain).replace(/^www\./i, "").toLowerCase();
}

export function hostFromUrl(value?: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).host.toLowerCase();
  } catch {
    return cleanSiteDomain(raw);
  }
}

export function scanSiteName(row: any) {
  return row.site_name || row.site_domain || hostFromUrl(row.url) || "Unlinked saved site";
}

export function scanSiteDetail(row: any) {
  if (row.site_domain) return row.site_domain;
  const host = hostFromUrl(row.url);
  return host ? `Scan URL host: ${host}` : "Saved site record unavailable";
}

export function scanHostCandidates(domain: string, crawlHost?: Site["crawl_host"]) {
  const root = domain.replace(/^www\./i, "");
  if (!root || localSiteHost(root)) return root ? [root] : [];
  const www = `www.${root}`;
  if (crawlHost === "root") return [root];
  if (crawlHost === "www") return [www];
  return [root, www];
}

export function scanProtocolCandidates(domain: string, crawlProtocol?: Site["crawl_protocol"]) {
  if (crawlProtocol === "https") return ["https"];
  if (crawlProtocol === "http") return ["http"];
  return localSiteHost(domain) ? ["http", "https"] : ["https", "http"];
}

export function scanUrlCandidates(site?: ScanUrlPlan | null) {
  const clean = cleanSiteDomain(site?.domain);
  if (!clean) return [];
  const hosts = scanHostCandidates(clean, site?.crawl_host || "auto");
  const protocols = scanProtocolCandidates(clean, site?.crawl_protocol || "auto");
  const urls = protocols.flatMap((protocol) => hosts.map((host) => `${protocol}://${host}`));
  return Array.from(new Set(urls));
}

export function preferredScanUrl(site?: ScanUrlPlan | null) {
  return scanUrlCandidates(site)[0] || "";
}

export function crawlPreferenceLabel(site?: ScanUrlPlan | null) {
  const protocol = crawlProtocolOptions.find((item) => item.value === (site?.crawl_protocol || "auto"))?.label || "Auto";
  const host = crawlHostOptions.find((item) => item.value === (site?.crawl_host || "auto"))?.label || "Auto";
  return `${protocol} · ${host}`;
}

export function scanUrlDetail(site?: ScanUrlPlan | null) {
  const candidates = scanUrlCandidates(site);
  if (!candidates.length) return "Set a website address to scan.";
  if (candidates.length === 1) return `${crawlPreferenceLabel(site)} · ${candidates[0]}`;
  return `${crawlPreferenceLabel(site)} · ${formatNumber(candidates.length)} possible crawl URLs`;
}

export function scanUrlShortDetail(site?: ScanUrlPlan | null) {
  const candidates = scanUrlCandidates(site);
  if (!candidates.length) return "No crawl URL";
  return `${crawlPreferenceLabel(site)} · ${formatNumber(candidates.length)} crawl URL${candidates.length === 1 ? "" : "s"}`;
}

export function scanUrlCountLabel(site?: ScanUrlPlan | null) {
  const count = scanUrlCandidates(site).length;
  return `${formatNumber(count)} crawl URL${count === 1 ? "" : "s"}`;
}

export function ScanUrlPills({
  site,
  compact = false,
}: {
  site?: ScanUrlPlan | null;
  compact?: boolean;
}) {
  const candidates = scanUrlCandidates(site);
  if (!candidates.length) return <span className="text-sm text-muted-foreground">Set a website address</span>;
  return (
    <div className={cn("flex flex-wrap gap-2", compact ? "gap-1.5" : "")}>
      {candidates.map((candidate, index) => (
        <span
          key={candidate}
          className={cn(
            "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-card px-2.5 py-1 text-xs font-medium",
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

export function ScanPlanSummary({
  site,
  compact = false,
}: {
  site?: ScanUrlPlan | null;
  compact?: boolean;
}) {
  return (
    <div className={cn("space-y-2", compact ? "space-y-1.5" : "")}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{scanUrlCountLabel(site)}</Badge>
        <Badge variant="outline">{crawlPreferenceLabel(site)}</Badge>
      </div>
      <ScanUrlPills site={site} compact={compact} />
    </div>
  );
}

export function ScanPlanPreview({ site }: { site?: ScanUrlPlan | null }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl bg-muted/40 px-3.5 py-2.5">
      <span className="eyebrow-muted inline-flex items-center gap-1.5">
        Scan plan
        <InfoTip>The scan tries these URLs in this order and starts from the first one that responds.</InfoTip>
      </span>
      <ScanUrlPills site={site} compact />
    </div>
  );
}

export function siteDisplayName(site?: Site | null) {
  if (!site) return "No site";
  return site.name;
}

export function siteSelectLabel(site: Site) {
  const domain = site.domain || "No website address";
  return `${siteDisplayName(site)} · ${domain} · ${scanUrlShortDetail(site)}`;
}

export function ActiveSiteSelect({
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
        <Link to="/"><Plus /> Add site</Link>
      </Button>
    );
  }
  return (
    <Select value={activeSiteId} onValueChange={onSelect}>
      <SelectTrigger className="min-w-0 [&_[data-slot=select-value]]:truncate">
        <SelectValue placeholder="Choose active site" />
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

export function Field({
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

export function FilteredRows({
  rows,
  placeholder = "Filter rows…",
  minRows = 6,
  children,
}: {
  rows: any[];
  placeholder?: string;
  minRows?: number;
  children: (rows: any[]) => ReactNode;
}) {
  const [query, setQuery] = useState("");
  const trimmed = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!trimmed) return rows;
    return rows.filter((row) => JSON.stringify(row).toLowerCase().includes(trimmed));
  }, [rows, trimmed]);
  if (rows.length < minRows) return <>{children(rows)}</>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-8 max-w-72 text-[13px]"
        />
        <span className="whitespace-nowrap text-[13px] text-muted-foreground">
          {trimmed ? `${formatNumber(filtered.length)} of ${formatNumber(rows.length)}` : `${formatNumber(rows.length)} rows`}
        </span>
      </div>
      {filtered.length ? children(filtered) : <EmptyState title="No matching rows" text="Nothing in this table matches the filter." />}
    </div>
  );
}

export function InfoTip({ children, label = "More detail" }: { children: ReactNode; label?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex shrink-0 items-center text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 rounded-sm"
        >
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{children}</TooltipContent>
    </Tooltip>
  );
}

export function Hint({ tip, children, className }: { tip: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("has-tip", className)}>{children}</span>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

export function SiteDomainField({
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
      <div className="flex items-center justify-between gap-2">
        <Label className="inline-flex items-center gap-1.5">
          {label}
          {hint ? <InfoTip label={`About ${label}`}>{hint}</InfoTip> : null}
        </Label>
        {siteDomain && !usingSelectedSite ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => onChange(siteDomain)}
          >
            Use active site
          </Button>
        ) : null}
      </div>
      <Input aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} placeholder={siteDomain || "example.com"} />
      {siteDomain && !usingSelectedSite ? (
        <p className="text-xs text-muted-foreground">Comparing against the active site, {siteDomain}.</p>
      ) : null}
    </div>
  );
}

export function parseDateInput(value: string) {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function formatDateInput(date?: Date) {
  if (!date || Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDateLabel(value: string) {
  const date = parseDateInput(value);
  if (!date) return "Pick date";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function DatePicker({
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

export function EmptyState({ title, text, action, icon }: { title: string; text: string; action?: ReactNode; icon?: any }) {
  const Icon = icon;
  return (
    <div className="flex flex-col items-center rounded-xl bg-muted/45 px-6 py-9 text-center">
      {Icon ? <Icon className="mb-2.5 size-5 text-muted-foreground/50" /> : null}
      <p className="font-heading text-base">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">{text}</p>
      {action ? <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export type StatItem = {
  title: string;
  value: unknown;
  icon?: any;
  detail?: ReactNode;
};

export function StatsBand({
  title,
  text,
  items,
}: {
  title?: string;
  text?: string;
  items: StatItem[];
}) {
  return (
    <section>
      {title ? (
        <div className="mb-3 flex items-center gap-2">
          <h2 className="font-heading text-lg leading-tight">{title}</h2>
          {text ? <InfoTip>{text}</InfoTip> : null}
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-[repeat(auto-fit,minmax(10.5rem,1fr))]">
        {items.map((item) => (
          <div key={item.title} className="min-w-0 rounded-xl bg-muted/55 px-4 py-3.5">
            <div className="flex items-center gap-1.5">
              <span className="eyebrow-muted truncate">{item.title}</span>
              {item.detail ? <InfoTip label={`About ${item.title}`}>{item.detail}</InfoTip> : null}
            </div>
            <div className="metric mt-1.5 text-[1.7rem] leading-none">
              {formatNumber(item.value)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function ReportSection({
  title,
  description,
  meta,
  action,
  children,
}: {
  title: string;
  description?: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border/70 bg-card">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 pt-4.5 pb-3.5">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <h2 className="font-heading text-[15px] leading-tight">{title}</h2>
          {description ? <InfoTip label={`About ${title}`}>{description}</InfoTip> : null}
          {meta ? <span className="text-[13px] text-muted-foreground">{meta}</span> : null}
        </div>
        {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
      </div>
      <div className="px-5 pb-5">{children}</div>
    </section>
  );
}

export function ProviderNotice({ title, text, source }: { title: string; text: string; source?: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 px-3.5 py-2.5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant={sourceVariant(source) as any}>{sourceLabel(source)}</Badge>
        <span className="font-medium">{title}</span>
      </div>
      <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{text}</p>
    </div>
  );
}

export type StatusEvidenceRow = {
  title: string;
  status: ReactNode;
  tone?: "default" | "secondary" | "outline" | "good" | "warn" | "bad";
  text: ReactNode;
};

export function StatusDot({ tone = "outline", className }: { tone?: StatusEvidenceRow["tone"]; className?: string }) {
  const color =
    tone === "good" ? "var(--good)" : tone === "warn" ? "var(--gold)" : tone === "bad" ? "var(--bad)" : "color-mix(in oklch, var(--muted-foreground) 45%, transparent)";
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", className)} style={{ backgroundColor: color }} />;
}

export function StatusEvidenceTable({ rows }: { rows: StatusEvidenceRow[] }) {
  return (
    <div className="@container">
      <div className="divide-y divide-border/60">
        {rows.map((row) => (
          <div
            key={row.title}
            className="grid gap-x-4 gap-y-1 py-2.5 @2xl:grid-cols-[minmax(10rem,14rem)_minmax(8rem,12rem)_1fr] @2xl:items-baseline"
          >
            <div className="text-sm font-medium">{row.title}</div>
            <div className="flex items-center gap-2 text-sm">
              <StatusDot tone={row.tone} />
              <span className="min-w-0 break-words">{row.status}</span>
            </div>
            <div className="min-w-0 text-[13px] leading-5 text-muted-foreground">{row.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-[420px] overflow-auto rounded-xl bg-muted/50 p-4 text-xs leading-relaxed text-foreground/80">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function formatNumber(value: unknown) {
  if (value == null || value === "") return "-";
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat().format(number) : String(value);
}

export function formatMs(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? `${formatNumber(Math.round(number))} ms` : "-";
}

export function metricValue(...values: unknown[]) {
  return values.find((value) => value !== null && value !== undefined && value !== "") ?? null;
}

export function hasMetric(value: unknown) {
  return value !== null && value !== undefined && value !== "";
}

export function formatMetricStatus(value: unknown) {
  return hasMetric(value) ? formatNumber(value) : "Not available";
}

export function keywordMetricClass(value: unknown) {
  return cn("nums", !hasMetric(value) && "text-left text-xs text-muted-foreground");
}

export function formatBytes(value: unknown) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatPercent(value: unknown) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "-";
  return `${(number * 100).toFixed(1)}%`;
}

export function formatPosition(value: unknown) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return "-";
  return number.toFixed(1);
}

export function formatDate(value: string) {
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

export function sourceLabel(source?: string) {
  const labels: Record<string, string> = {
    "provider-not-configured": "Not connected",
    "duckduckgo-suggest": "DuckDuckGo suggest",
    duckduckgo: "DuckDuckGo",
    searxng: "SearXNG",
    "local-scan": "Local scan",
    "organic-import": "Organic import",
    "backlink-import": "Backlink import",
    "keyword-metrics-import": "Keyword metrics import",
    "web-search": "Web search",
    codex: "Local Codex",
    "search-error": "Search error",
    "suggest-error": "Suggest error",
  };
  if (source?.startsWith("openserp:")) return `OpenSERP ${source.split(":")[1] || ""}`.trim();
  return labels[source || ""] || source || "No source";
}

export function sourceVariant(source?: string) {
  if (
    source === "duckduckgo" ||
    source === "duckduckgo-suggest" ||
    source === "searxng" ||
    source === "local-scan" ||
    source === "organic-import" ||
    source === "backlink-import" ||
    source === "keyword-metrics-import" ||
    source === "web-search" ||
    source === "codex" ||
    source?.startsWith("openserp:")
  ) return "good";
  if (source?.includes("error")) return "bad";
  if (source === "provider-not-configured") return "warn";
  return "outline";
}

export function TagList({ tags }: { tags: string[] }) {
  if (!tags?.length) return <span className="text-muted-foreground">-</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <Badge key={tag} variant="outline">{tag}</Badge>
      ))}
    </div>
  );
}

export function SourceBadge({ source }: { source?: string }) {
  return <Badge variant={sourceVariant(source) as any}>{sourceLabel(source)}</Badge>;
}

export function serpProviderStatus(config: any) {
  if (config?.openserp_url) return "OpenSERP";
  if (config?.searxng_url) return "SearXNG";
  return "DuckDuckGo";
}

export function scanStatusLabel(status?: string) {
  if (status === "needs-provider") return "Not connected";
  if (!status) return "pending";
  return status.replaceAll("-", " ");
}

export function ProgressBar({ value, tone = "primary" }: { value: number; tone?: "primary" | "good" | "warn" | "bad" }) {
  const toneColor =
    tone === "good" ? "var(--good)" : tone === "warn" ? "var(--gold)" : tone === "bad" ? "var(--bad)" : "var(--primary)";
  return (
    <div className="h-2 overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${Math.max(4, Math.min(100, value))}%`, backgroundColor: toneColor }}
      />
    </div>
  );
}

export function Tip({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-gold/[0.12] px-3 py-2 text-xs leading-5 text-gold-foreground">
      <Sparkles className="mt-0.5 size-3.5 shrink-0 opacity-70" />
      <span>{children}</span>
    </div>
  );
}

export type MetricTileProps = { label: string; value: ReactNode; hint?: ReactNode; tone?: "default" | "good" | "warn" | "bad"; icon?: any };

export function MetricTile({ label, value, hint, tone = "default" }: MetricTileProps) {
  const valueColor =
    tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : tone === "bad" ? "text-bad" : "text-foreground";
  return (
    <div className="min-w-0 rounded-xl bg-muted/55 px-4 py-3.5">
      <div className="eyebrow-muted truncate">{label}</div>
      <div className={cn("metric mt-1.5 text-[1.7rem] leading-none", valueColor)}>{value}</div>
      {hint ? <div className="mt-1.5 truncate text-xs leading-5 text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

export function MetricTileGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-2.5 sm:grid-cols-[repeat(auto-fit,minmax(10.5rem,1fr))]", className)}>
      {children}
    </div>
  );
}

export function scanProgress(scan: any) {
  if (!scan) return 0;
  if (scan.status === "completed" || scan.status === "failed") return 100;
  const limit = Number(scan.result?.limits?.maxPages || 100);
  const pageProgress = Math.min(70, Math.round((Number(scan.pages_crawled || 0) / Math.max(1, limit)) * 70));
  const phase = scan.result?.phase || "";
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

export function scanIsActive(scan: any) {
  return scan?.status === "queued" || scan?.status === "running";
}

export function sortScanRows(rows: any[]) {
  return [...rows].sort((a, b) => {
    const bTime = new Date(b.created_at || b.updated_at || 0).getTime();
    const aTime = new Date(a.created_at || a.updated_at || 0).getTime();
    return bTime - aTime;
  });
}

export function upsertScanRow(rows: any[], scan: any) {
  if (!scan?.id) return rows;
  return sortScanRows([scan, ...rows.filter((row) => row.id !== scan.id)]);
}

export function scanPhaseKey(scan: any) {
  const phase = String(scan?.result?.phase || scan?.result?.summary?.phase || "").toLowerCase();
  if (scan?.status === "queued") return "queued";
  if (scan?.status === "failed") return "failed";
  if (scan?.status === "completed" || phase === "completed") return "completed";
  if (phase.includes("deduplicating")) return "report";
  if (phase.includes("css images")) return "images";
  if (phase.includes("assets")) return "assets";
  if (phase.includes("images")) return "images";
  if (phase.includes("links")) return "links";
  if (phase.includes("crawl")) return "crawl";
  if (phase.includes("robots")) return "robots";
  return "resolve";
}

export function scanPhaseLabel(scan: any) {
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
    resolve: "Resolving start URL",
  };
  return labels[scanPhaseKey(scan)] || "Scanning";
}

export function scanSeverityCounts(scan: any) {
  const summary = scan?.result?.summary?.bySeverity || {};
  const flatSummary = scan?.result?.summary || {};
  const issues = Array.isArray(scan?.result?.issues) ? scan.result.issues : [];
  return {
    high: Number(summary.high || flatSummary.high || issues.filter((issue: any) => issue.severity === "high").length || 0),
    medium: Number(summary.medium || flatSummary.medium || issues.filter((issue: any) => issue.severity === "medium").length || 0),
    low: Number(summary.low || flatSummary.low || issues.filter((issue: any) => issue.severity === "low").length || 0),
  };
}

export function maxCount(...values: unknown[]) {
  const numbers = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 0);
  return numbers.length ? Math.max(...numbers) : 0;
}

export function metricNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function hasIndexabilityEvidence(page: any) {
  return typeof page?.indexable === "boolean";
}

export function IndexabilityBadge({ page }: { page: any }) {
  if (!hasIndexabilityEvidence(page)) {
    return <Badge variant="outline">Unknown</Badge>;
  }
  return <Badge variant={page.indexable ? "good" : "bad"}>{page.indexable ? "Yes" : "No"}</Badge>;
}

export function scanCoverageMetrics(scan: any, result: any = {}, summary: any = {}) {
  const pages = Array.isArray(result.pages) ? result.pages : [];
  const links = Array.isArray(result.links) ? result.links : [];
  const linkInventory = Array.isArray(result.linkInventory) ? result.linkInventory : [];
  const images = Array.isArray(result.images) ? result.images : [];
  const imageInventory = Array.isArray(result.imageInventory) ? result.imageInventory : [];
  const assets = Array.isArray(result.assets) ? result.assets : [];
  const sitemapUrls = Array.isArray(result.sitemap?.urls) ? result.sitemap.urls : [];
  const loadTimes = pages
    .map((page: any) => Number(page.loadMs))
    .filter((value: number) => Number.isFinite(value) && value >= 0)
    .sort((a: number, b: number) => a - b);
  const loadPercentile = (percentile: number) => {
    if (!loadTimes.length) return 0;
    const index = Math.min(loadTimes.length - 1, Math.max(0, Math.ceil((percentile / 100) * loadTimes.length) - 1));
    return loadTimes[index] || 0;
  };
  const averageLoadMs = loadTimes.length
    ? Math.round(loadTimes.reduce((sum: number, value: number) => sum + value, 0) / loadTimes.length)
    : 0;
  const pageCount = maxCount(summary.pages, scan?.pages_crawled, pages.length);
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
    measuredPageLoads: maxCount(summary.measuredPageLoads, loadTimes.length),
    averagePageLoadMs: metricNumber(summary.averagePageLoadMs, averageLoadMs),
    medianPageLoadMs: metricNumber(summary.medianPageLoadMs, loadPercentile(50)),
    p95PageLoadMs: metricNumber(summary.p95PageLoadMs, loadPercentile(95)),
    slowestPageLoadMs: metricNumber(summary.slowestPageLoadMs, loadTimes[loadTimes.length - 1] || 0),
    slowPages: maxCount(summary.slowPages, loadTimes.filter((value: number) => value > 2000).length),
    verySlowPages: maxCount(summary.verySlowPages, loadTimes.filter((value: number) => value > 4000).length),
    cssImageResources: maxCount(summary.cssImageResources, images.filter((image: any) => image.purpose === "css-url" || image.purpose === "external-css-url").length),
    brokenLinks: maxCount(summary.brokenLinks, links.filter((link: any) => link.ok === false).length),
    brokenImages: maxCount(summary.brokenImages, images.filter((image: any) => image.ok === false).length),
    brokenAssets: maxCount(summary.brokenAssets, assets.filter((asset: any) => asset.ok === false).length),
    redirectedLinks: maxCount(summary.redirectedLinks, links.filter((link: any) => link.redirected || (link.finalUrl && link.finalUrl !== link.url)).length),
    redirectedImages: maxCount(summary.redirectedImages, images.filter((image: any) => image.redirected || (image.finalUrl && image.finalUrl !== image.url)).length),
    largeImages: maxCount(summary.largeImages, images.filter((image: any) => Number(image.contentLength || 0) > 500_000).length),
  };
}

export function scanSpeedMetrics(scan: any) {
  const result = scan?.result || {};
  const coverage = scanCoverageMetrics(scan, result, result.summary || {});
  return {
    measuredPageLoads: Number(coverage.measuredPageLoads || 0),
    averagePageLoadMs: Number(coverage.averagePageLoadMs || 0),
    medianPageLoadMs: Number(coverage.medianPageLoadMs || 0),
    p95PageLoadMs: Number(coverage.p95PageLoadMs || 0),
    slowestPageLoadMs: Number(coverage.slowestPageLoadMs || 0),
    slowPages: Number(coverage.slowPages || 0),
    verySlowPages: Number(coverage.verySlowPages || 0),
  };
}

export function scanSpeedHistoryRows(scans: any[]) {
  return sortScanRows(scans)
    .filter((scan) => scan.status === "completed")
    .map((scan) => ({ scan, metrics: scanSpeedMetrics(scan) }))
    .filter((row) => row.metrics.measuredPageLoads > 0);
}

export function speedDeltaLabel(current: number, previous?: number) {
  if (!Number.isFinite(Number(previous))) return "first measured scan";
  const delta = Math.round(Number(current) - Number(previous));
  if (delta === 0) return "unchanged";
  return delta < 0 ? `${formatMs(Math.abs(delta))} faster` : `${formatMs(delta)} slower`;
}

export function speedDeltaVariant(current: number, previous?: number) {
  if (!Number.isFinite(Number(previous))) return "outline";
  const delta = Number(current) - Number(previous);
  if (delta <= -100) return "good";
  if (delta >= 250) return "warn";
  return "outline";
}

export function issueTypeCount(issues: any[], type: string) {
  return issues.filter((issue) => issue.type === type).length;
}

export function issueTypesCount(issues: any[], types: string[]) {
  return issues.filter((issue) => types.includes(issue.type)).length;
}

export type ScanCheckRowModel = {
  label: string;
  value: unknown;
  problem?: boolean;
  severity?: string;
  category?: string;
  types?: string[];
};

export type ScanCheckSectionModel = {
  title: string;
  text: string;
  rows: ScanCheckRowModel[];
};

export function pageIssueTypeCount(page: any, type: string) {
  return (page.issues || []).filter((issue: any) => issue.type === type).length;
}

export function pageIssueTypesCount(page: any, types: string[]) {
  return (page.issues || []).filter((issue: any) => types.includes(issue.type)).length;
}

export function latestCompletedScan(rows: any[]) {
  return (rows || []).find((scan) => scan?.status === "completed" && scan?.result) || null;
}

export function defaultEvidenceScan(rows: any[]) {
  const sorted = sortScanRows(rows || []);
  return latestCompletedScan(sorted) || sorted[0] || null;
}

export function scanIssueCount(row: any) {
  return Number(row?.issues?.length || 0);
}

export function issueCategoryLabel(value: string) {
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

export function PageHeader({
  title,
  description,
  meta,
  action,
}: {
  title: string;
  description?: string;
  meta?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <h1 className="page-title text-[1.9rem]">{title}</h1>
          {description ? <InfoTip label={`About ${title}`}>{description}</InfoTip> : null}
        </div>
        {meta ? <div className="mt-1.5 text-sm text-muted-foreground">{meta}</div> : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function HistoryList({
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
    <ReportSection title={title} meta={`${formatNumber(rows.length)} saved`}>
      {rows.length ? <HistoryTable rows={rows} labelKey={labelKey} labelTitle={labelTitle} /> : <EmptyState title="No history" text="Runs are saved locally." />}
    </ReportSection>
  );
}

export function HistoryTable({
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

export function lengthVariant(value: number, min: number, max: number) {
  if (!value) return "bad";
  if (value < min || value > max) return "warn";
  return "good";
}

export function textLength(value: unknown, savedLength: unknown) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  const stored = Number(savedLength || 0);
  if (stored > 0 || !normalized) return stored;
  return normalized.length;
}

export function LengthBadge({
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

export function pageH1Text(page: any) {
  const fromString = String(page.h1 || "").replace(/\s+/g, " ").trim();
  if (fromString) return fromString;
  const fromArray = Array.isArray(page.h1s)
    ? page.h1s.map((item: unknown) => String(item || "").replace(/\s+/g, " ").trim()).find(Boolean)
    : "";
  return fromArray || "";
}

export function pageH1Count(page: any) {
  const stored = Number(page.h1Count || 0);
  if (stored > 0) return stored;
  return Array.isArray(page.h1s) ? page.h1s.filter((item: unknown) => String(item || "").trim()).length : 0;
}

export function pageH1Status(page: any) {
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

export function ScanLinksTable({ rows }: { rows: any[] }) {
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

export function JobTable({
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

export function scoreTone(score: number) {
  if (score >= 85) return "var(--good)";
  if (score >= 60) return "var(--gold)";
  return "var(--bad)";
}

export function scoreBadgeVariant(score: number): ComponentProps<typeof Badge>["variant"] {
  if (score >= 85) return "good";
  if (score >= 60) return "warn";
  return "bad";
}

export function ScoreDial({
  score,
  size = 96,
  label,
  className,
  color,
  suffix,
}: {
  score: number;
  size?: number;
  label?: string;
  className?: string;
  color?: string;
  suffix?: string;
}) {
  const value = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
  return (
    <div
      className={cn("score-ring relative flex shrink-0 items-center justify-center rounded-full", className)}
      style={{ width: size, height: size, ["--ring-value" as any]: value, ["--ring-color" as any]: color || scoreTone(value) }}
    >
      <div className="flex flex-col items-center leading-none">
        <span className="metric flex items-baseline" style={{ fontSize: size * 0.3 }}>
          {value}
          {suffix ? <span style={{ fontSize: size * 0.14 }} className="ml-0.5 text-muted-foreground">{suffix}</span> : null}
        </span>
        {label ? <span className="mt-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</span> : null}
      </div>
    </div>
  );
}

export function siteInitials(name?: string) {
  const clean = String(name || "").trim();
  if (!clean) return "•";
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function SiteAvatar({ site, className }: { site?: Site | null; className?: string }) {
  return (
    <div
      className={cn(
        "font-heading flex items-center justify-center rounded-lg bg-primary/10 text-sm text-primary ring-1 ring-inset ring-primary/15",
        className,
      )}
    >
      {siteInitials(site?.name || site?.domain)}
    </div>
  );
}
