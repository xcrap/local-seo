import { cloneElement, isValidElement, useEffect, useId, useMemo, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes, useNavigate, useParams } from "react-router-dom";
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
  Zap,
} from "lucide-react";
import { api, auth, type KeywordResult, type Project } from "./api";
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

const activeSiteStorageKey = "local-seo:site";
const legacyProjectStorageKey = "local-seo:project";
const selectedAuditStorageKey = "local-seo:selected-audit";

function marketLabel(code: number) {
  return marketOptions.find((item) => item.code === Number(code))?.label || `Market ${code}`;
}

function languageLabel(code: string) {
  return languageOptions.find((item) => item.code === code)?.label || code;
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
  const clean = String(domain || "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  if (!clean) return "";
  return `${localSiteHost(clean) ? "http" : "https"}://${clean}`;
}

function preferredAuditUrl(project?: Project | null) {
  const clean = String(project?.domain || "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  if (!clean) return "";
  const root = clean.replace(/^www\./i, "");
  const protocol = project?.crawl_protocol === "http" ? "http" : localSiteHost(root) ? "http" : "https";
  const host = project?.crawl_host === "www" && !localSiteHost(root) ? `www.${root}` : root;
  return `${protocol}://${host}`;
}

function crawlPreferenceLabel(project?: Project | null) {
  const protocol = crawlProtocolOptions.find((item) => item.value === (project?.crawl_protocol || "auto"))?.label || "Auto";
  const host = crawlHostOptions.find((item) => item.value === (project?.crawl_host || "auto"))?.label || "Auto";
  return `${protocol} · ${host}`;
}

function isPlaceholderSite(project?: Project | null) {
  return Boolean(project && !project.domain && project.name === "Add your site");
}

function siteDisplayName(project?: Project | null) {
  if (!project) return "No site";
  return isPlaceholderSite(project) ? "No site yet" : project.name;
}

function ActiveSiteSelect({
  sites,
  activeSiteId,
  onSelect,
}: {
  sites: Project[];
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
      <SelectTrigger>
        <SelectValue placeholder="Select site" />
      </SelectTrigger>
      <SelectContent>
        {sites.map((site) => (
          <SelectItem key={site.id} value={site.id}>
            {siteDisplayName(site)}
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
  columns = "lg:grid-cols-3 2xl:grid-cols-4",
}: {
  title?: string;
  text?: string;
  items: StatItem[];
  columns?: string;
}) {
  return (
    <section className="rounded-md border bg-background">
      {title || text ? (
        <div className="border-b px-5 py-4">
          {title ? <h2 className="text-lg font-semibold">{title}</h2> : null}
          {text ? <p className="mt-1 text-sm leading-6 text-muted-foreground">{text}</p> : null}
        </div>
      ) : null}
      <div className={cn("grid divide-y md:grid-cols-2 md:divide-x md:divide-y-0", columns)}>
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.title} className="flex min-h-24 items-center justify-between gap-5 p-5">
              <div className="min-w-0">
                <div className="text-sm font-medium text-muted-foreground">{item.title}</div>
                <div className="nums mt-2 text-3xl font-semibold leading-none">{formatNumber(item.value)}</div>
                {item.detail ? <div className="mt-2 text-sm text-muted-foreground">{item.detail}</div> : null}
              </div>
              {Icon ? (
                <Icon className="size-5 shrink-0 text-muted-foreground" />
              ) : null}
            </div>
          );
        })}
      </div>
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
    "web-search": "Web search",
    codex: "Local Codex",
    "search-error": "Search error",
    "suggest-error": "Suggest error",
  };
  return labels[source || ""] || source || "No source";
}

function sourceVariant(source?: string) {
  if (source === "dataforseo" || source === "duckduckgo" || source === "duckduckgo-suggest" || source === "web-search" || source === "codex") return "good";
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
    target: "Resolving scan target",
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

function pageIssueTypeCount(page: any, type: string) {
  return (page.issues || []).filter((issue: any) => issue.type === type).length;
}

function pageIssueTypesCount(page: any, types: string[]) {
  return (page.issues || []).filter((issue: any) => types.includes(issue.type)).length;
}

function latestCompletedAudit(rows: any[]) {
  return (rows || []).find((audit) => audit?.status === "completed" && audit?.result) || null;
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

function Workspace() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState(
    localStorage.getItem(activeSiteStorageKey) || localStorage.getItem(legacyProjectStorageKey) || "",
  );
  const [shellScanning, setShellScanning] = useState(false);
  const [shellScanError, setShellScanError] = useState("");
  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) || projects[0],
    [projects, activeProjectId],
  );
  const visibleSites = useMemo(() => projects.filter((project) => !isPlaceholderSite(project)), [projects]);

  async function loadProjects() {
    const rows = await api.projects();
    setProjects(rows);
    if (rows.length > 0 && !rows.some((project) => project.id === activeProjectId)) {
      const nextActive = rows.find((project) => !isPlaceholderSite(project)) || rows[0];
      setActiveProjectId(nextActive.id);
      localStorage.setItem(activeSiteStorageKey, nextActive.id);
      localStorage.removeItem(legacyProjectStorageKey);
    }
  }

  useEffect(() => {
    loadProjects().catch(console.error);
  }, []);

  function selectProject(id: string) {
    setActiveProjectId(id);
    localStorage.setItem(activeSiteStorageKey, id);
    localStorage.removeItem(legacyProjectStorageKey);
    setShellScanError("");
  }

  async function scanActiveSite() {
    if (!activeProject?.domain) {
      window.location.href = "/sites";
      return;
    }
    setShellScanning(true);
    setShellScanError("");
    try {
      const result = await api.scanProject(activeProject.id);
      if (result.audit?.id) {
        localStorage.setItem(selectedAuditStorageKey, result.audit.id);
        window.location.href = `/audits/${result.audit.id}`;
      } else {
        window.location.href = "/audits";
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
    <BrowserRouter>
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
            <ActiveSiteSelect sites={visibleSites} activeSiteId={activeProject?.id || ""} onSelect={selectProject} />
          </div>

          {activeProject?.domain ? (
            <div className="mt-3 rounded-md border bg-card p-3">
              <div className="text-xs font-medium text-muted-foreground">Scan target</div>
              <div className="mt-1 break-all text-sm font-medium">{preferredAuditUrl(activeProject)}</div>
              <div className="mt-1 text-xs text-muted-foreground">{crawlPreferenceLabel(activeProject)}</div>
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
            <ActiveSiteSelect sites={visibleSites} activeSiteId={activeProject?.id || ""} onSelect={selectProject} />
            {activeProject?.domain ? (
              <Button size="sm" onClick={scanActiveSite} disabled={shellScanning}>
                <FileSearch /> {shellScanning ? "Starting" : "Scan"}
              </Button>
            ) : (
              <Button asChild size="sm"><Link to="/sites"><Plus /> Add</Link></Button>
            )}
          </div>
          <div className="mt-2">
            <Select onValueChange={(path) => (window.location.href = path)}>
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
            {activeProject ? (
              <Routes key={activeProject.id}>
                <Route path="/" element={<Overview project={activeProject} reloadProjects={loadProjects} selectProject={selectProject} />} />
                <Route path="/sites" element={<ProjectsPage projects={projects} reloadProjects={loadProjects} activeProjectId={activeProject.id} selectProject={selectProject} />} />
                <Route path="/projects" element={<Navigate to="/sites" replace />} />
                <Route path="/keywords" element={<KeywordsPage project={activeProject} />} />
                <Route path="/serp" element={<SerpPage project={activeProject} />} />
                <Route path="/saved" element={<SavedPage project={activeProject} />} />
                <Route path="/rank" element={<RankPage project={activeProject} />} />
                <Route path="/domain" element={<DomainPage project={activeProject} />} />
                <Route path="/backlinks" element={<BacklinksPage project={activeProject} />} />
                <Route path="/brand" element={<BrandLookupPage project={activeProject} />} />
                <Route path="/prompts" element={<PromptExplorerPage project={activeProject} />} />
                <Route path="/audits" element={<AuditsPage project={activeProject} />} />
                <Route path="/audits/:auditId" element={<AuditReportRoute />} />
                <Route path="/gsc" element={<GscPage project={activeProject} />} />
                <Route path="/ai" element={<AiPage project={activeProject} />} />
                <Route path="/mcp" element={<McpPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Routes>
            ) : (
              <ProjectsPage projects={projects} reloadProjects={loadProjects} activeProjectId="" selectProject={selectProject} />
            )}
          </div>
        </main>
      </div>
    </BrowserRouter>
  );
}

function Overview({
  project,
  reloadProjects,
  selectProject,
}: {
  project: Project;
  reloadProjects: () => Promise<void>;
  selectProject: (id: string) => void;
}) {
  const [summary, setSummary] = useState<any>(null);
  const [scan, setScan] = useState<any>(null);
  const [scanAudit, setScanAudit] = useState<any>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [firstDomain, setFirstDomain] = useState("");
  const [firstName, setFirstName] = useState("");
  const [firstCrawlProtocol, setFirstCrawlProtocol] = useState<Project["crawl_protocol"]>("auto");
  const [firstCrawlHost, setFirstCrawlHost] = useState<Project["crawl_host"]>("auto");
  const [firstScanError, setFirstScanError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    api.dashboard(project.id).then(setSummary).catch(console.error);
  }, [project.id]);

  async function scanSite() {
    setScanning(true);
    setScanError("");
    try {
      const result = await api.scanProject(project.id);
      setScan(result);
      setScanAudit(result.audit);
      if (result.audit?.id) {
        localStorage.setItem(selectedAuditStorageKey, result.audit.id);
        navigate(`/audits/${result.audit.id}`);
      }
      setSummary(await api.dashboard(project.id));
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Could not start site scan");
    } finally {
      setScanning(false);
    }
  }

  function openAuditReport(auditId: string) {
    localStorage.setItem(selectedAuditStorageKey, auditId);
    navigate(`/audits/${auditId}`);
  }

  async function createSiteAndScan(event: FormEvent) {
    event.preventDefault();
    const domain = firstDomain.trim();
    if (!domain) return;
    setScanning(true);
    setFirstScanError("");
    try {
      const created = await api.createProject({
        name: firstName.trim() || domain,
        domain,
        locationCode: project.location_code || 2840,
        languageCode: project.language_code || "en",
        crawlProtocol: firstCrawlProtocol,
        crawlHost: firstCrawlHost,
      } as any);
      selectProject(created.id);
      const result = await api.scanProject(created.id);
      if (result.audit?.id) {
        localStorage.setItem(selectedAuditStorageKey, result.audit.id);
      }
      await reloadProjects();
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
        setSummary(await api.dashboard(project.id));
      }
    }, 1500);
    return () => window.clearInterval(interval);
  }, [scanAudit?.id, scanAudit?.status]);

  return (
    <>
      <PageHeader
        eyebrow="Site overview"
        title={siteDisplayName(project)}
        description={project.domain ? "Reports, audits, crawl links, rankings, and Search Console use this site." : "Add a site to unlock scans, reports, rankings, and Search Console."}
        action={<Badge>{project.domain || "No site yet"}</Badge>}
      />
      {!project.domain ? (
        <section className="mb-6 rounded-md border border-primary/40 bg-background p-5">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">Start with a site scan</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">Add the domain once. The scan report opens automatically and stays saved locally.</p>
          </div>
          <form className="space-y-3" onSubmit={createSiteAndScan}>
            <div className="grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
              <Input value={firstDomain} onChange={(event) => setFirstDomain(event.target.value)} placeholder="example.com" required />
              <Input value={firstName} onChange={(event) => setFirstName(event.target.value)} placeholder="Site name (optional)" />
              <Button type="submit" disabled={scanning}>
                <FileSearch /> {scanning ? "Starting" : "Add site and scan"}
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Protocol">
                <Select value={firstCrawlProtocol} onValueChange={(value) => setFirstCrawlProtocol(value as Project["crawl_protocol"])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {crawlProtocolOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Hostname">
                <Select value={firstCrawlHost} onValueChange={(value) => setFirstCrawlHost(value as Project["crawl_host"])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {crawlHostOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </form>
          {firstScanError && <p className="mt-3 rounded-md border border-destructive/40 bg-muted/30 p-3 text-sm text-destructive">{firstScanError}</p>}
        </section>
      ) : null}
      {scanError && <p className="mb-6 rounded-md border border-destructive/40 bg-muted/30 p-3 text-sm text-destructive">{scanError}</p>}
      {project.domain ? (
        <section className="mb-6 rounded-md border bg-background p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-sm font-medium text-muted-foreground">Selected website</div>
              <div className="mt-1 text-2xl font-semibold">{project.domain || "Add a domain"}</div>
              <p className="mt-1 text-sm text-muted-foreground">
                Scan target: {preferredAuditUrl(project)} · {crawlPreferenceLabel(project)} · Market: {marketLabel(project.location_code)} · Language: {languageLabel(project.language_code)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={!project.domain || scanning} onClick={scanSite}>
                <FileSearch /> {scanning ? "Scanning" : `Scan ${project.domain || "site"}`}
              </Button>
              <Button asChild variant="secondary" disabled={!project.domain}>
                <Link to="/domain"><Globe2 /> Organic research</Link>
              </Button>
              <Button asChild variant="secondary" disabled={!project.domain}>
                <Link to="/backlinks"><Link2 /> Links</Link>
              </Button>
              <Button asChild variant="outline" disabled={!project.domain}>
                <Link to="/rank"><Target /> Track rankings</Link>
              </Button>
            </div>
          </div>
        </section>
      ) : null}
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
      <SiteCommandCenter project={project} summary={summary} scanning={scanning} onScan={scanSite} />
      <div className="mt-6 grid gap-6 2xl:grid-cols-[minmax(0,1.1fr)_minmax(520px,0.9fr)]">
        <section className="rounded-md border bg-background">
          <div className="border-b px-5 py-4">
            <h2 className="text-lg font-semibold">Recent audits</h2>
            <p className="mt-1 text-sm text-muted-foreground">Technical crawl runs stored in local SQLite.</p>
          </div>
          <div className="p-5">
            {summary?.latestAudits?.length ? (
              <AuditTable rows={summary.latestAudits} onInspect={openAuditReport} />
            ) : (
              <EmptyState
                title="No audits yet"
                text={project.domain ? "Start a technical scan for this site." : "Add a domain to start scanning."}
                action={
                  project.domain ? (
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
            <h2 className="text-lg font-semibold">Recent Codex jobs</h2>
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
  project,
  summary,
  scanning,
  onScan,
}: {
  project: Project;
  summary: any;
  scanning: boolean;
  onScan: () => void;
}) {
  const latestAudit = summary?.latestAudits?.[0];
  const latestAuditSummary = latestAudit?.result?.summary || {};
  const rows = [
    {
      key: "audit",
      area: "Technical audit",
      status: latestAudit ? latestAudit.status : "not run",
      evidence: latestAudit
        ? `${formatNumber(latestAudit.pages_crawled)} pages · ${formatNumber(latestAudit.issue_count)} issues · ${formatNumber(latestAuditSummary.checkedLinks || 0)} links checked`
        : "No crawl evidence saved yet.",
      action: project.domain ? (
        <Button size="sm" onClick={onScan} disabled={scanning}>
          <FileSearch /> {scanning ? "Starting" : "Scan site"}
        </Button>
      ) : (
        <Button asChild size="sm"><Link to="/sites"><Plus /> Add site</Link></Button>
      ),
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
      action: <Button asChild size="sm" variant="secondary"><Link to="/domain"><Globe2 /> Open</Link></Button>,
      secondary: null,
    },
    {
      key: "links",
      area: "Links",
      status: latestAudit ? "local graph" : "needs scan",
      evidence: latestAudit
        ? `${formatNumber(latestAuditSummary.linkTags || 0)} link tags · ${formatNumber(latestAuditSummary.brokenLinks || 0)} broken`
        : "Run a site scan to build the local link graph.",
      action: <Button asChild size="sm" variant="secondary"><Link to="/backlinks"><Link2 /> Open</Link></Button>,
      secondary: null,
    },
    {
      key: "rank",
      area: "Rank tracking",
      status: summary?.trackerCount ? "tracking" : "manual",
      evidence: `${formatNumber(summary?.trackerCount || 0)} trackers · ${formatNumber(summary?.serpRunCount || 0)} SERP runs`,
      action: <Button asChild size="sm" variant="secondary"><Link to="/rank"><Target /> Open</Link></Button>,
      secondary: null,
    },
    {
      key: "gsc",
      area: "Search Console",
      status: "local OAuth",
      evidence: "Connect a real Google property for performance and inspection data.",
      action: <Button asChild size="sm" variant="secondary"><Link to="/gsc"><BarChart3 /> Open</Link></Button>,
      secondary: null,
    },
    {
      key: "ai",
      area: "AI lab",
      status: summary?.latestAiJobs?.length ? "has jobs" : "ready",
      evidence: `${formatNumber(summary?.latestAiJobs?.length || 0)} recent Codex jobs · runs locally with medium reasoning`,
      action: <Button asChild size="sm" variant="secondary"><Link to="/ai"><Bot /> Open</Link></Button>,
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
          {project.domain ? <Badge variant="outline">{preferredAuditUrl(project)}</Badge> : null}
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
              <TableCell><Badge variant={row.status === "needs scan" || row.status === "not run" ? "warn" : "outline"}>{row.status}</Badge></TableCell>
              <TableCell className="text-sm text-muted-foreground">{row.evidence}</TableCell>
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
                <Link to={row.route}>Open</Link>
              </Button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ProjectsPage({
  projects,
  reloadProjects,
  activeProjectId,
  selectProject,
}: {
  projects: Project[];
  reloadProjects: () => Promise<void>;
  activeProjectId: string;
  selectProject: (id: string) => void;
}) {
  type ProjectForm = {
    name: string;
    domain: string;
    notes: string;
    locationCode: number;
    languageCode: string;
    crawlProtocol: Project["crawl_protocol"];
    crawlHost: Project["crawl_host"];
  };
  type ProjectEditForm = {
    name: string;
    domain: string;
    notes: string;
    location_code: number;
    language_code: string;
    crawl_protocol: Project["crawl_protocol"];
    crawl_host: Project["crawl_host"];
  };
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ProjectForm>({
    name: "",
    domain: "",
    notes: "",
    locationCode: 2840,
    languageCode: "en",
    crawlProtocol: "auto",
    crawlHost: "auto",
  });
  const [editing, setEditing] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [editForm, setEditForm] = useState<ProjectEditForm>({
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
  const visibleSites = projects.filter((project) => !isPlaceholderSite(project));

  async function createSite(scanAfterCreate: boolean) {
    if (!form.domain.trim()) {
      setError("Enter a domain before saving the site.");
      return;
    }
    setError("");
    setCreatingAction(scanAfterCreate ? "scan" : "save");
    try {
      const created = await api.createProject({
        ...form,
        name: form.name.trim() || form.domain.trim() || "Untitled site",
      });
      selectProject(created.id);
      setOpen(false);
      setForm({ name: "", domain: "", notes: "", locationCode: 2840, languageCode: "en", crawlProtocol: "auto", crawlHost: "auto" });
      if (scanAfterCreate) {
        const result = await api.scanProject(created.id);
        if (result.audit?.id) {
          localStorage.setItem(selectedAuditStorageKey, result.audit.id);
        }
        await reloadProjects();
        if (result.audit?.id) navigate(`/audits/${result.audit.id}`);
        else navigate("/audits");
        return;
      }
      await reloadProjects();
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

  function startEdit(project: Project) {
    setEditing(project);
    setEditForm({
      name: project.name,
      domain: project.domain || "",
      notes: project.notes || "",
      location_code: project.location_code || 2840,
      language_code: project.language_code || "en",
      crawl_protocol: project.crawl_protocol || "auto",
      crawl_host: project.crawl_host || "auto",
    });
  }

  async function submitEdit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setError("");
    try {
      await api.updateProject(editing.id, editForm);
      setEditing(null);
      await reloadProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update site");
    }
  }

  async function deleteProject(project: Project) {
    setError("");
    try {
      await api.deleteProject(project.id);
      setDeleting(null);
      await reloadProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete site");
    }
  }

  async function scanProject(project: Project) {
    if (!project.domain) return;
    setError("");
    setScanningSiteId(project.id);
    try {
      const result = await api.scanProject(project.id);
      if (result.audit?.id) {
        localStorage.setItem(selectedAuditStorageKey, result.audit.id);
      }
      setScanningSiteId("");
      selectProject(project.id);
      if (result.audit?.id) navigate(`/audits/${result.audit.id}`);
      else navigate("/audits");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start site scan");
      setScanningSiteId("");
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Websites"
        title="Sites"
        description="Add each website once. The selected site is used by scans, reports, crawl links, rankings, and Search Console."
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus /> Add site</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add site</DialogTitle>
                <DialogDescription>Add the website once, choose the crawl variant when needed, and start a local audit immediately.</DialogDescription>
              </DialogHeader>
              <form className="space-y-4" onSubmit={submit}>
                <Field label="Site name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Optional" /></Field>
                <Field label="Domain"><Input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="example.com" required /></Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Market">
                    <Select value={String(form.locationCode)} onValueChange={(value) => setForm({ ...form, locationCode: Number(value) })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {marketOptions.map((market) => <SelectItem key={market.code} value={String(market.code)}>{market.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Language">
                    <Select value={form.languageCode} onValueChange={(value) => setForm({ ...form, languageCode: value })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {languageOptions.map((language) => <SelectItem key={language.code} value={language.code}>{language.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Protocol">
                    <Select value={form.crawlProtocol} onValueChange={(value) => setForm({ ...form, crawlProtocol: value as Project["crawl_protocol"] })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {crawlProtocolOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Hostname">
                    <Select value={form.crawlHost} onValueChange={(value) => setForm({ ...form, crawlHost: value as Project["crawl_host"] })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {crawlHostOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
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
      {visibleSites.length === 0 ? (
        <section className="rounded-md border border-primary/40 bg-background p-5">
          <h2 className="text-lg font-semibold">No sites yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">Add one domain and start the first local audit.</p>
          <Button className="mt-4" onClick={() => setOpen(true)}><FileSearch /> Add site and scan</Button>
        </section>
      ) : (
        <section className="rounded-md border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Site</TableHead>
                <TableHead>Scan target</TableHead>
                <TableHead>Market</TableHead>
                <TableHead>Language</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleSites.map((project) => (
                <TableRow key={project.id} className={activeProjectId === project.id ? "bg-accent/35" : ""}>
                  <TableCell className="min-w-64">
                    <div className="font-medium">{project.name}</div>
                    <div className="text-xs text-muted-foreground">{project.domain || "Add a domain"}</div>
                  </TableCell>
                  <TableCell className="min-w-56">
                    <div className="font-medium">{preferredAuditUrl(project) || "Set domain"}</div>
                    <div className="text-xs text-muted-foreground">{crawlPreferenceLabel(project)}</div>
                  </TableCell>
                  <TableCell><Badge variant="outline">{marketLabel(project.location_code)}</Badge></TableCell>
                  <TableCell><Badge variant="outline">{languageLabel(project.language_code)}</Badge></TableCell>
                  <TableCell className="max-w-md">
                    <div className="line-clamp-2 text-sm text-muted-foreground">{project.notes || "No notes yet."}</div>
                  </TableCell>
                  <TableCell>{activeProjectId === project.id ? <Badge variant="good">Active</Badge> : <Badge variant="outline">Available</Badge>}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      {activeProjectId !== project.id ? (
                        <Button size="sm" variant="secondary" onClick={() => selectProject(project.id)}>
                          Use
                        </Button>
                      ) : null}
                      {project.domain ? (
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`Scan ${project.name}`}
                          title={`Scan ${project.domain}`}
                          disabled={scanningSiteId === project.id}
                          onClick={() => scanProject(project)}
                        >
                          <FileSearch /> {scanningSiteId === project.id ? "Starting" : "Scan"}
                        </Button>
                      ) : null}
                      <Button size="icon" variant="outline" aria-label={`Edit ${project.name}`} onClick={() => startEdit(project)}>
                        <Pencil />
                      </Button>
                      <Button size="icon" variant="destructive" aria-label={`Delete ${project.name}`} onClick={() => setDeleting(project)}>
                        <Trash2 />
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
            <DialogDescription>Changes apply to this saved site.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submitEdit}>
            <Field label="Site name"><Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required /></Field>
            <Field label="Domain"><Input value={editForm.domain} onChange={(e) => setEditForm({ ...editForm, domain: e.target.value })} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Market">
                <Select value={String(editForm.location_code)} onValueChange={(value) => setEditForm({ ...editForm, location_code: Number(value) })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {marketOptions.map((market) => <SelectItem key={market.code} value={String(market.code)}>{market.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Language">
                <Select value={editForm.language_code} onValueChange={(value) => setEditForm({ ...editForm, language_code: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {languageOptions.map((language) => <SelectItem key={language.code} value={language.code}>{language.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Protocol">
                <Select value={editForm.crawl_protocol} onValueChange={(value) => setEditForm({ ...editForm, crawl_protocol: value as Project["crawl_protocol"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {crawlProtocolOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Hostname">
                <Select value={editForm.crawl_host} onValueChange={(value) => setEditForm({ ...editForm, crawl_host: value as Project["crawl_host"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {crawlHostOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </div>
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
              This removes "{deleting?.name}" from the active site list. Its saved keywords, scans, trackers, and local history are hidden with the site.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction type="button" onClick={() => deleting && deleteProject(deleting)}>
              Delete site
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function KeywordsPage({ project }: { project: Project }) {
  const [query, setQuery] = useState(project.domain || "");
  const [limit, setLimit] = useState(25);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const selectedCount = Object.values(selected).filter(Boolean).length;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const data = await api.researchKeywords({ projectId: project.id, query, limit });
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
      await api.saveKeywords({ projectId: project.id, keywords: rows, source: result?.source || "research" });
      setMessage(`Saved ${rows.length} keywords.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save selected keywords");
    }
  }

  return (
    <>
      <PageHeader eyebrow="Research" title="Keyword research" description="Find real keyword suggestions. Volume, CPC, and difficulty stay blank unless a real metrics source is connected." />
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
            <TableCell className="nums">{row.searchVolume || "-"}</TableCell>
            <TableCell className="nums">{row.difficulty || "-"}</TableCell>
            <TableCell className="nums">{row.cpc ?? "-"}</TableCell>
            <TableCell><Badge variant="outline">{row.intent}</Badge></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function SavedPage({ project }: { project: Project }) {
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
      const data = await api.querySavedKeywords(project.id, {
        search,
        tagNames: tagFilter ? [tagFilter] : [],
        pageSize: 100,
        sort: "created_at",
        order: "desc",
      });
      setRows(data.rows || []);
      setTags(data.tags || await api.keywordTags(project.id));
      setSelected({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load saved keywords");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch(console.error);
  }, [project.id]);

  async function applyTags(mode: "add" | "remove") {
    if (!selectedIds.length || !tagInput.trim()) return;
    setError("");
    setMessage("");
    try {
      await api.updateKeywordTags(project.id, {
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
      await api.removeSavedKeywords(project.id, selectedIds);
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
              <a href={api.savedKeywordsCsvUrl(project.id)}>
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
            <TableCell className="nums">{formatNumber(row.search_volume)}</TableCell>
            <TableCell className="nums">{formatNumber(row.difficulty)}</TableCell>
            <TableCell className="nums">{row.cpc ?? "-"}</TableCell>
            <TableCell><Badge variant="outline">{row.intent}</Badge></TableCell>
            <TableCell><TagList tags={row.tags || []} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function SerpPage({ project }: { project: Project }) {
  const [keyword, setKeyword] = useState("");
  const [target, setTarget] = useState(project.domain);
  const [result, setResult] = useState<any>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    try {
      setRuns(await api.serpRuns(project.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load SERP history");
    }
  }
  useEffect(() => {
    load().catch(console.error);
  }, [project.id]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = await api.analyzeSerp({ projectId: project.id, keyword, target, depth: 20 });
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
      <PageHeader eyebrow="SERP" title="SERP analysis" description="Inspect ranking pages, target ownership, intent mix, and content opportunities for one query." />
      <section className="rounded-md border bg-background p-5">
        <form className="grid gap-3 lg:grid-cols-[1fr_1fr_auto]" onSubmit={submit}>
          <Input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="keyword" required />
          <Input value={target} onChange={(event) => setTarget(event.target.value)} placeholder="target domain" />
          <Button disabled={loading}><Activity /> {loading ? "Analyzing" : "Analyze SERP"}</Button>
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
                <span>Target position: {result.targetPosition || "not found"}</span>
                {result.warning ? <span>{result.warning}</span> : null}
              </span>
            ) : "Run a query to inspect the SERP."
          }
        >
          {result?.rows?.length ? <SerpTable rows={result.rows} /> : <EmptyState title="No SERP yet" text="Analyze a keyword to save a local SERP run." />}
        </ReportSection>
        <ReportSection title="History">
          <div className="space-y-2">
            {runs.length ? runs.slice(0, 8).map((run) => (
              <div key={run.id} className="rounded-md border bg-background p-3 text-sm">
                <div className="font-medium">{run.keyword}</div>
                <div className="text-xs text-muted-foreground">{run.source} · {run.created_at}</div>
              </div>
            )) : <EmptyState title="No history" text="Analyze a keyword to create the first saved SERP run." />}
          </div>
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

function RankPage({ project }: { project: Project }) {
  const [trackers, setTrackers] = useState<any[]>([]);
  const [form, setForm] = useState({ domain: project.domain, keywords: "" });
  const [keywordDrafts, setKeywordDrafts] = useState<Record<string, string>>({});
  const [selectedKeywords, setSelectedKeywords] = useState<Record<string, Record<string, boolean>>>({});
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    try {
      setTrackers(await api.rankTrackers(project.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load rank trackers");
    }
  }
  useEffect(() => {
    load().catch(console.error);
  }, [project.id]);

  async function create(event: FormEvent) {
    event.preventDefault();
    setLoading("create");
    setError("");
    setMessage("");
    try {
      await api.createRankTracker({
        projectId: project.id,
        domain: form.domain,
        keywords: form.keywords.split(/\n|,/).map((item) => item.trim()).filter(Boolean),
      });
      setForm({ domain: project.domain, keywords: "" });
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
            <TableCell className="nums">{formatNumber(row.search_volume)}</TableCell>
            <TableCell className="nums">{formatNumber(row.keyword_difficulty)}</TableCell>
            <TableCell className="nums">{row.cpc ?? "-"}</TableCell>
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

function DomainPage({ project }: { project: Project }) {
  const navigate = useNavigate();
  const [target, setTarget] = useState(project.domain);
  const [overview, setOverview] = useState<any>(null);
  const [keywords, setKeywords] = useState<any>(null);
  const [pages, setPages] = useState<any>(null);
  const [latestAudit, setLatestAudit] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [tab, setTab] = useState("keywords");
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");

  async function loadHistory() {
    const [snapshots, audits] = await Promise.all([
      api.domainSnapshots(project.id),
      api.audits(project.id),
    ]);
    setHistory(snapshots);
    setLatestAudit(latestCompletedAudit(audits));
  }
  useEffect(() => {
    loadHistory().catch(console.error);
  }, [project.id]);

  async function run(event?: FormEvent) {
    event?.preventDefault();
    setLoading(true);
    setError("");
    const body = { projectId: project.id, domain: target, target, pageSize: 50 };
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
    if (!project.domain) {
      navigate("/sites");
      return;
    }
    setScanning(true);
    setError("");
    try {
      const result = await api.scanProject(project.id);
      if (result.audit?.id) {
        localStorage.setItem(selectedAuditStorageKey, result.audit.id);
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
      <PageHeader eyebrow="Competitive" title="Organic research" description="Ranked keywords and top pages for the selected site or a competitor target." />
      <section className="rounded-md border bg-background p-5">
        <form className="grid gap-3 lg:grid-cols-[1fr_auto]" onSubmit={run}>
          <Field label="Target domain">
            <Input value={target} onChange={(event) => setTarget(event.target.value)} placeholder={project.domain || "example.com"} />
          </Field>
          <div className="flex items-end">
            <Button disabled={loading || !target.trim()}><Globe2 /> {loading ? "Analyzing" : "Analyze target"}</Button>
          </div>
        </form>
        {error ? <p className="mt-3 rounded-md border border-destructive/40 bg-muted/30 p-3 text-sm text-destructive">{error}</p> : null}
      </section>
      <div className="mt-6 grid gap-6 2xl:grid-cols-[minmax(0,1fr)_460px]">
        <div className="space-y-6">
          <LocalOrganicEvidence audit={latestAudit} siteDomain={project.domain} onScan={scanSite} scanning={scanning} />
          {overview?.warning ? (
            <ProviderNotice title="External ranked-keyword dataset unavailable" text={overview.warning} source={overview.source} />
          ) : null}
          {overview?.source === "dataforseo" ? (
            <StatsBand
              title="Connected organic dataset"
              items={[
                { title: "Organic keywords", value: overview.organicKeywords || 0, icon: Search },
                { title: "Organic traffic", value: overview.organicTraffic || 0, icon: BarChart3 },
                { title: "Traffic value", value: overview.estimatedValue || 0, icon: Gauge },
                { title: "Top pages", value: overview.topPages?.length || pages?.pages?.length || 0, icon: Globe2 },
              ]}
              columns="lg:grid-cols-4"
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
                {keywords?.keywords?.length ? <DomainKeywordsTable rows={keywords.keywords} /> : <EmptyState title="No keyword rows" text={keywords?.warning || "Analyze a target domain to load ranked keyword data."} />}
              </ReportSection>
            </TabsContent>
            <TabsContent value="pages">
              <ReportSection title="Top pages" description={pages ? <SourceBadge source={pages.source} /> : "Run an analysis to load rows."}>
                {pages?.pages?.length ? <DomainPagesTable rows={pages.pages} /> : <EmptyState title="No page rows" text={pages?.warning || "Analyze a target domain to load top page data."} />}
              </ReportSection>
            </TabsContent>
            <TabsContent value="snapshot">
              {overview ? <OrganicSnapshot result={overview} target={target} keywordRows={keywords?.keywords?.length || 0} pageRows={pages?.pages?.length || 0} /> : <EmptyState title="No snapshot" text="Run an analysis to save the first organic research snapshot." />}
            </TabsContent>
          </Tabs>
        </div>
        <HistoryList title="Organic research history" rows={history} labelKey="target" />
      </div>
    </>
  );
}

function LocalOrganicEvidence({
  audit,
  siteDomain,
  onScan,
  scanning,
}: {
  audit: any;
  siteDomain: string;
  onScan: () => void;
  scanning: boolean;
}) {
  const pages = audit?.result?.pages || [];
  const rows = [...pages]
    .sort((a, b) => auditIssueCount(b) - auditIssueCount(a))
    .slice(0, 25);
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
              Real page evidence from the latest site audit. No external keyword or traffic estimates are generated here.
            </p>
          </div>
          {audit ? <Badge variant="good">{formatDate(audit.created_at)}</Badge> : null}
        </div>
      </div>
      <div className="space-y-4 p-5">
        {!audit ? (
          <EmptyState
            title="No local crawl yet"
            text={siteDomain ? "Run a site audit once to fill this page with real crawl evidence." : "Add a site domain and run an audit to fill this page."}
            action={siteDomain ? (
              <Button variant="secondary" onClick={onScan} disabled={scanning}>
                <FileSearch /> {scanning ? "Starting scan" : `Scan ${siteDomain}`}
              </Button>
            ) : (
              <Button asChild variant="secondary"><Link to="/sites"><Plus /> Add site</Link></Button>
            )}
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
            {rows.length ? <LocalOrganicPagesTable rows={rows} /> : <EmptyState title="No page rows" text="The latest audit did not save page rows." />}
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
  return (
    <ReportSection
      title="Snapshot"
      description={<><SourceBadge source={result.source} /> {result.createdAt ? <span className="ml-2">{formatDate(result.createdAt)}</span> : null}</>}
    >
      <StatusEvidenceTable
        rows={[
          { title: "Target", status: target || result.target || "-", tone: "good", text: "The selected site or competitor target analyzed in this run." },
          { title: "Keyword rows", status: formatNumber(keywordRows), tone: keywordRows ? "good" : "warn", text: "Rows returned by the real organic search dataset." },
          { title: "Page rows", status: formatNumber(pageRows), tone: pageRows ? "good" : "warn", text: "Top pages returned for this target." },
          { title: "Organic keywords", status: formatNumber(result.organicKeywords || 0), tone: result.organicKeywords ? "good" : "warn", text: "Connected data-source metric. Blank or zero when no dataset is connected." },
          { title: "Organic traffic", status: formatNumber(result.organicTraffic || 0), tone: result.organicTraffic ? "good" : "warn", text: "Estimate from the connected organic dataset." },
          { title: "Traffic value", status: formatNumber(result.estimatedValue || 0), tone: result.estimatedValue ? "good" : "warn", text: "Estimate from the connected organic dataset." },
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

function BacklinksPage({ project }: { project: Project }) {
  const navigate = useNavigate();
  const [target, setTarget] = useState(project.domain);
  const [overview, setOverview] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [config, setConfig] = useState<any>(null);
  const [latestAudit, setLatestAudit] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [tab, setTab] = useState("backlinks");
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const backlinkIndexConnected = Boolean(config?.dataforseo_api_key);

  async function loadHistory() {
    const [snapshots, audits, appConfig] = await Promise.all([
      api.backlinkSnapshots(project.id),
      api.audits(project.id),
      api.config(),
    ]);
    setHistory(snapshots);
    setLatestAudit(latestCompletedAudit(audits));
    setConfig(appConfig);
  }
  useEffect(() => {
    loadHistory().catch(console.error);
  }, [project.id]);

  async function run(nextTab = tab) {
    if (!backlinkIndexConnected) {
      setOverview(null);
      setProfile(null);
      setError("A web-wide backlink index is not connected. Use the local link graph from the latest audit, or connect a real backlink index before running this analysis.");
      return;
    }
    setLoading(true);
    setError("");
    const body = { projectId: project.id, target, tab: nextTab, pageSize: 50 };
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
    if (!project.domain) {
      navigate("/sites");
      return;
    }
    setScanning(true);
    setError("");
    try {
      const result = await api.scanProject(project.id);
      if (result.audit?.id) {
        localStorage.setItem(selectedAuditStorageKey, result.audit.id);
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
          <Field label="External backlink target">
            <Input value={target} onChange={(event) => setTarget(event.target.value)} placeholder={project.domain || "example.com"} />
          </Field>
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
          <LocalLinkEvidence audit={latestAudit} siteDomain={project.domain} onScan={scanSite} scanning={scanning} />
          {overview?.warning ? (
            <ProviderNotice title="External backlink index unavailable" text={overview.warning} source={overview.source} />
          ) : null}
          {overview?.source === "dataforseo" ? (
            <StatsBand
              title="Connected backlink index"
              items={[
                { title: "Backlinks", value: overview.backlinks || overview.summary?.backlinks || 0, icon: Link2 },
                { title: "Ref. domains", value: overview.referringDomains || overview.summary?.referringDomains || 0, icon: Globe2 },
                { title: "Dofollow %", value: overview.dofollowRatio || 0, icon: CheckCircle2 },
              ]}
              columns="lg:grid-cols-3"
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
                {profile?.tab === "backlinks" && profile.rows?.length ? <BacklinksRowsTable rows={profile.rows} /> : <EmptyState title={backlinkIndexConnected ? "No backlink rows" : "No external backlink index connected"} text={profile?.warning || (backlinkIndexConnected ? "Check a target to load real backlink rows." : "Local audits do not invent web-wide backlinks. Use the local link graph above until a real backlink index is connected.")} />}
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
        <HistoryList title="External backlink history" rows={history} labelKey="target" />
      </div>
    </>
  );
}

function LocalLinkEvidence({
  audit,
  siteDomain,
  onScan,
  scanning,
}: {
  audit: any;
  siteDomain: string;
  onScan: () => void;
  scanning: boolean;
}) {
  const result = audit?.result || {};
  const linkInventory = result.linkInventory || [];
  const checkedLinks = result.links || [];
  const pages = result.pages || [];
  const checkedByUrl = new Map(checkedLinks.map((link: any) => [link.url, link]));
  const externalLinks = linkInventory.filter((link: any) => link.type === "external").slice(0, 150);
  const brokenLinks = checkedLinks.filter((link: any) => !link.ok).slice(0, 150);
  const pageRows = [...pages]
    .sort((a, b) => Number(b.internalInlinks || 0) - Number(a.internalInlinks || 0))
    .slice(0, 100);
  return (
    <section className="rounded-md border bg-background">
      <div className="border-b px-5 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Local link graph</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Real internal links, external links, and failing targets from the latest local audit.
            </p>
          </div>
          {audit ? <Badge variant="good">{formatDate(audit.created_at)}</Badge> : null}
        </div>
      </div>
      <div className="space-y-4 p-5">
        {!audit ? (
          <EmptyState
            title="No local link graph yet"
            text={siteDomain ? "Run a site audit once to collect internal links, external links, and broken link evidence." : "Add a site domain and run an audit to collect link evidence."}
            action={siteDomain ? (
              <Button variant="secondary" onClick={onScan} disabled={scanning}>
                <FileSearch /> {scanning ? "Starting scan" : `Scan ${siteDomain}`}
              </Button>
            ) : (
              <Button asChild variant="secondary"><Link to="/sites"><Plus /> Add site</Link></Button>
            )}
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
                {externalLinks.length ? <LocalExternalLinksTable rows={externalLinks} checkedByUrl={checkedByUrl} /> : <EmptyState title="No external links" text="The latest audit did not find external links." />}
              </TabsContent>
              <TabsContent value="broken">
                {brokenLinks.length ? <AuditLinksTable rows={brokenLinks} /> : <EmptyState title="No broken links" text="The latest audit did not find failing link targets." />}
              </TabsContent>
              <TabsContent value="internal">
                {pageRows.length ? <LocalInternalGraphTable rows={pageRows} /> : <EmptyState title="No internal graph" text="The latest audit did not save page link rows." />}
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
          <TableHead>Target</TableHead>
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
  const backlinks = result.backlinks || result.summary?.backlinks || 0;
  const referringDomains = result.referringDomains || result.summary?.referringDomains || 0;
  return (
    <ReportSection
      title="Snapshot"
      description={<><SourceBadge source={result.source} /> {result.createdAt ? <span className="ml-2">{formatDate(result.createdAt)}</span> : null}</>}
    >
      <StatusEvidenceTable
        rows={[
          { title: "Target", status: target || result.target || "-", tone: "good", text: "The domain or URL analyzed in this run." },
          { title: "Visible rows", status: formatNumber(rows), tone: rows ? "good" : "warn", text: `Rows currently loaded in the ${tab} tab.` },
          { title: "Backlinks", status: formatNumber(backlinks), tone: backlinks ? "good" : "warn", text: "Total backlinks from the connected index." },
          { title: "Referring domains", status: formatNumber(referringDomains), tone: referringDomains ? "good" : "warn", text: "Unique linking domains from the connected index." },
          { title: "Dofollow %", status: formatNumber(result.dofollowRatio || 0), tone: result.dofollowRatio ? "good" : "warn", text: "Dofollow ratio reported by the connected index." },
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

function BrandLookupPage({ project }: { project: Project }) {
  const [query, setQuery] = useState(project.domain || project.name);
  const [competitors, setCompetitors] = useState("");
  const [result, setResult] = useState<any>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setRuns(await api.brandLookupRuns(project.id));
  }
  useEffect(() => {
    load().catch(console.error);
  }, [project.id]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      const data = await api.brandLookup({ projectId: project.id, query, competitors });
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
          <HistoryList title="Recent lookups" rows={runs} labelKey="query" />
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
        description={<><SourceBadge source={result.source} /> {result.resolvedTarget ? <span className="ml-2">Target: {result.resolvedTarget}</span> : null}</>}
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
          columns="lg:grid-cols-3"
        />
      ) : null}
      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_460px]">
        <ReportSection title="Citations" description="Real web evidence used for this lookup.">
          {citationRows.length ? <CitationList rows={citationRows} /> : <EmptyState title="No citations" text="No citation rows came back for this lookup." />}
        </ReportSection>
        <ReportSection title="Next actions" description="Grounded recommendations saved with this lookup.">
          {recommendationRows.length ? (
            <div className="space-y-2">
              {recommendationRows.map((item: string) => (
                <div key={item} className="rounded-md border bg-muted/25 p-3 text-sm leading-6">{item}</div>
              ))}
            </div>
          ) : <EmptyState title="No recommendations" text="Recommendations appear when the lookup source returns them." />}
        </ReportSection>
      </div>
    </div>
  );
}

function CitationList({ rows }: { rows: any[] }) {
  return (
    <div className="space-y-2">
      {rows.slice(0, 12).map((citation, index) => (
        <a
          key={`${citation.url || citation.link || citation.title}:${index}`}
          href={citation.url || citation.link}
          target="_blank"
          rel="noreferrer"
          className="block rounded-md border bg-background p-3 transition-colors hover:bg-muted/35"
        >
          <div className="line-clamp-1 font-medium">{citation.title || citation.url || citation.link || "Citation"}</div>
          <div className="mt-1 break-all text-xs text-muted-foreground">{citation.url || citation.link || "-"}</div>
          {citation.snippet || citation.description ? <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{citation.snippet || citation.description}</p> : null}
        </a>
      ))}
      {rows.length > 12 ? <p className="text-xs text-muted-foreground">Showing 12 of {formatNumber(rows.length)} citations.</p> : null}
    </div>
  );
}

function PromptExplorerPage({ project }: { project: Project }) {
  const [prompt, setPrompt] = useState(`What are the best options for ${project.domain || project.name}?`);
  const [highlightBrand, setHighlightBrand] = useState(project.domain || project.name);
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
    setRuns(await api.promptExplorerRuns(project.id));
  }
  useEffect(() => {
    load().catch(console.error);
  }, [project.id]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      const selectedModels = Object.entries(models).filter(([, enabled]) => enabled).map(([model]) => model);
      const data = await api.promptExplorer({ projectId: project.id, prompt, highlightBrand, models: selectedModels });
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
          <HistoryList title="Recent prompts" rows={runs} labelKey="prompt" />
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

function HistoryList({ title, rows, labelKey }: { title: string; rows: any[]; labelKey: string }) {
  return (
    <ReportSection title={title}>
      <div className="space-y-2">
        {rows.length ? rows.slice(0, 6).map((row) => (
          <div key={row.id} className="rounded-md border bg-background p-3 text-sm">
            <div className="truncate font-medium">{row[labelKey]}</div>
            <div className="text-xs text-muted-foreground">{row.source} · {row.created_at}</div>
          </div>
        )) : <EmptyState title="No history" text="Runs are saved locally." />}
      </div>
    </ReportSection>
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
            localStorage.removeItem(selectedAuditStorageKey);
            if (interval) {
              window.clearInterval(interval);
              interval = undefined;
            }
            return;
          }
          localStorage.setItem(selectedAuditStorageKey, row.id);
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

function AuditsPage({ project }: { project: Project }) {
  const [url, setUrl] = useState(preferredAuditUrl(project));
  const [audits, setAudits] = useState<any[]>([]);
  const [detail, setDetail] = useState<any>(null);
  const [deletingAudit, setDeletingAudit] = useState<any>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [showCustomUrl, setShowCustomUrl] = useState(false);
  async function load() {
    const rows = await api.audits(project.id);
    setAudits(rows);
    if (detail?.id) {
      const nextDetail = rows.find((row) => row.id === detail.id);
      if (nextDetail) setDetail(nextDetail);
    } else {
      const selectedAuditId = localStorage.getItem(selectedAuditStorageKey);
      const selectedAudit = rows.find((row) => row.id === selectedAuditId);
      if (selectedAudit) setDetail(selectedAudit);
    }
    return rows;
  }
  useEffect(() => {
    load().catch(console.error);
  }, [project.id]);
  useEffect(() => {
    setUrl(preferredAuditUrl(project));
    setError("");
    setShowCustomUrl(false);
  }, [project.id, project.domain, project.crawl_protocol, project.crawl_host]);
  useEffect(() => {
    const hasActiveScan = audits.some((audit) => audit.status === "queued" || audit.status === "running");
    if (!hasActiveScan) return;
    const interval = window.setInterval(() => {
      load().catch(console.error);
    }, 1500);
    return () => window.clearInterval(interval);
  }, [project.id, audits, detail?.id]);
  async function start(event: FormEvent) {
    event.preventDefault();
    setError("");
    setStarting(true);
    try {
      const audit = await api.startAudit({ projectId: project.id, url });
      setDetail(audit);
      if (audit?.id) localStorage.setItem(selectedAuditStorageKey, audit.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start scan");
    } finally {
      setStarting(false);
    }
  }
  async function startSelectedSite() {
    if (!project.domain) return;
    setError("");
    setStarting(true);
    try {
      const result = await api.scanProject(project.id);
      setDetail(result.audit);
      if (result.audit?.id) localStorage.setItem(selectedAuditStorageKey, result.audit.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start site scan");
    } finally {
      setStarting(false);
    }
  }
  async function inspect(id: string) {
    localStorage.setItem(selectedAuditStorageKey, id);
    setDetail(await api.audit(id));
  }
  async function remove(id: string) {
    await api.deleteAudit(project.id, id);
    if (localStorage.getItem(selectedAuditStorageKey) === id) {
      localStorage.removeItem(selectedAuditStorageKey);
    }
    setDetail(null);
    await load();
  }
  return (
    <>
      <PageHeader eyebrow="Technical" title="Site audits" description="Scan the selected website and open the report when it completes." />
      <section className="rounded-md border bg-background p-5">
        <div className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-sm font-medium text-muted-foreground">Selected site</div>
              <div className="mt-1 text-xl font-semibold">{project.domain || "Add a domain"}</div>
              {project.domain ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  Scan target: {preferredAuditUrl(project)} · {crawlPreferenceLabel(project)}
                </p>
              ) : null}
            </div>
            {project.domain ? (
              <Button disabled={starting} onClick={startSelectedSite}>
                <FileSearch /> {starting ? "Starting" : `Scan ${project.domain}`}
              </Button>
            ) : (
              <Button asChild><Link to="/sites"><Plus /> Add site</Link></Button>
            )}
          </div>
          <div className="border-t pt-4">
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowCustomUrl((value) => !value)}>
              <FileSearch /> {showCustomUrl ? "Hide URL scan" : "Scan a specific URL"}
            </Button>
            {showCustomUrl ? (
              <form className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto]" onSubmit={start}>
                <Field label="URL to scan">
                  <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={`${preferredAuditUrl(project) || "https://example.com"}/page`} />
                </Field>
                <div className="flex items-end">
                  <Button variant="secondary" disabled={starting || !url.trim()}><FileSearch /> Scan URL</Button>
                </div>
              </form>
            ) : null}
          </div>
          {error && <p className="rounded-md border border-destructive/40 bg-muted/30 p-3 text-sm text-destructive">{error}</p>}
        </div>
      </section>
      <div className="mt-6 space-y-6">
        <section className="space-y-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-normal">Scan report</h2>
              <p className="text-sm text-muted-foreground">Technical evidence, broken assets, metadata, indexability, and fixes from the selected scan.</p>
            </div>
            {detail ? <Badge variant={detail.status === "completed" ? "good" : detail.status === "failed" ? "bad" : "warn"}>{detail.status}</Badge> : null}
          </div>
          {detail ? <AuditDetail audit={detail} /> : (
            <EmptyState title="No scan selected" text={audits.length ? "Open any saved scan below." : "Start a scan to see the report."} />
          )}
        </section>

        <section className="rounded-md border bg-background">
          <div className="border-b px-5 py-4">
            <h2 className="text-lg font-semibold">Scan history</h2>
            <p className="mt-1 text-sm text-muted-foreground">Saved local audit runs for this site.</p>
          </div>
          <div className="p-5">
            {audits.length ? (
              <AuditTable rows={audits} selectedId={detail?.id} onInspect={inspect} onDelete={(id) => setDeletingAudit(audits.find((audit) => audit.id === id) || { id })} />
            ) : (
              <EmptyState
                title="No audits yet"
                text={project.domain ? "Start a technical scan for this site." : "Add a site before running an audit."}
                action={project.domain ? (
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
            <AlertDialogAction type="button" onClick={() => deletingAudit && remove(deletingAudit.id).then(() => setDeletingAudit(null))}>
              Delete scan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function AuditTable({
  rows,
  selectedId,
  onInspect,
  onDelete,
}: {
  rows: any[];
  selectedId?: string;
  onInspect?: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Run</TableHead><TableHead>Status</TableHead><TableHead>Progress</TableHead><TableHead>Score</TableHead><TableHead>Issues</TableHead><TableHead>Pages</TableHead>{(onInspect || onDelete) && <TableHead></TableHead>}</TableRow></TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={row.id}
            className={cn(onInspect ? "cursor-pointer" : "", selectedId === row.id ? "bg-accent/45" : "")}
            onClick={() => onInspect?.(row.id)}
          >
            <TableCell className="max-w-md">
              <div className="truncate font-medium">{row.url}</div>
              <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="size-3" /> {formatDate(row.created_at || row.updated_at)}
              </div>
            </TableCell>
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
                          localStorage.setItem(selectedAuditStorageKey, row.id);
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
                      onClick={(event) => { event.stopPropagation(); onDelete(row.id); }}
                    >
                      <Trash2 />
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
  return (
    <div className="space-y-5">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="flex flex-wrap">
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
                  <Button size="sm" variant="outline" onClick={() => selectSeverity("high")}>Review high</Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => selectSeverity("all")}>Open issues</Button>
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
            {(severityFilter !== "all" || categoryFilter !== "all" || typeFilter !== "all" || selectedCheckLabel) ? (
              <Button size="sm" variant="ghost" onClick={() => { setSeverityFilter("all"); setCategoryFilter("all"); setTypeFilter("all"); setSelectedCheckTypes([]); setSelectedCheckLabel(""); showIssues(); }}>
                Clear filters
              </Button>
            ) : null}
          </div>
          {filteredIssues.length ? filteredIssues.map((issue: any, index: number) => (
            <IssueCard key={issue.id || `${issue.url}:${issue.message}:${index}`} issue={issue} />
          )) : <EmptyState title="No matching issues" text={audit.status === "completed" ? "This filter has no issues." : "Issues will appear while the scan runs."} />}
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
              <AuditSection title="Checked links" text="Every unique HTTP link target that the crawler verified. Broken and redirecting links are highlighted in the Status column.">
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
        <TabsContent value="crawl" className="grid gap-4 xl:grid-cols-3">
          <div className="rounded-md border bg-background p-4">
            <h3 className="font-medium">Robots</h3>
            <div className="mt-3 space-y-2 text-sm">
              <div>Status: <Badge variant={result.robots?.exists ? "good" : "warn"}>{result.robots?.exists ? "Found" : "Missing"}</Badge></div>
              <div className="break-all text-muted-foreground">{result.robots?.url || `${result.origin}/robots.txt`}</div>
              <div>Disallow rules: {formatNumber(result.robots?.disallowCount || 0)}</div>
              <div>Sitemaps declared: {formatNumber(result.robots?.sitemaps?.length || 0)}</div>
            </div>
          </div>
          <div className="rounded-md border bg-background p-4">
            <h3 className="font-medium">Sitemap</h3>
            <div className="mt-3 space-y-2 text-sm">
              <div>URLs found: {formatNumber(result.sitemap?.urls?.length || 0)}</div>
              {(result.sitemap?.sitemaps || []).map((sitemap: any) => (
                <div key={sitemap.url} className="rounded-md border p-2">
                  <div className="break-all font-medium">{sitemap.url}</div>
                  <div className="text-muted-foreground">status {sitemap.status || "-"} · {formatNumber(sitemap.urlCount || 0)} URLs</div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-md border bg-background p-4">
            <h3 className="font-medium">Coverage</h3>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3"><span>Indexable pages</span><Badge variant="outline">{formatNumber(coverage.indexablePages)}</Badge></div>
              <div className="flex items-center justify-between gap-3"><span>Missing from sitemap</span><Badge variant={coverage.pagesMissingFromSitemap ? "warn" : "good"}>{formatNumber(coverage.pagesMissingFromSitemap)}</Badge></div>
              <div className="flex items-center justify-between gap-3"><span>Noindex in sitemap</span><Badge variant={coverage.noindexPagesInSitemap ? "warn" : "good"}>{formatNumber(coverage.noindexPagesInSitemap)}</Badge></div>
              <div className="flex items-center justify-between gap-3"><span>Orphan pages</span><Badge variant={coverage.orphanPages ? "warn" : "good"}>{formatNumber(coverage.orphanPages)}</Badge></div>
              <div className="flex items-center justify-between gap-3"><span>Deep pages</span><Badge variant={coverage.deepPages ? "warn" : "good"}>{formatNumber(coverage.deepPages)}</Badge></div>
            </div>
          </div>
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
      label: "Resolve target",
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
      detail: `${formatNumber(coverage.checkedLinks)} unique targets checked`,
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
  const scopeRows = [
    ["Pages crawled", coverage.pages],
    ["Indexable", coverage.indexablePages],
    ["Noindex/non-indexable", coverage.nonIndexablePages],
    ["Indexability unknown", coverage.unknownIndexabilityPages],
    ["Sitemap-listed pages", coverage.sitemapUrls],
    ["Orphan pages", coverage.orphanPages],
    ["Deep pages", coverage.deepPages],
    ["Link tags found", coverage.linkTags],
    ["Image tags found", coverage.imageTags],
    ["CSS/JS refs found", coverage.assetTags],
  ];
  const resourceRows = [
    ["Checked links", coverage.checkedLinks, coverage.brokenLinks],
    ["Checked image URLs", coverage.checkedImages, coverage.brokenImages],
    ["Checked CSS/JS", coverage.checkedAssets, coverage.brokenAssets],
    ["Redirecting links", coverage.redirectedLinks, null],
    ["Redirecting images", coverage.redirectedImages, null],
    ["CSS image URLs", coverage.cssImageResources, null],
    ["Large images", coverage.largeImages, null],
  ];
  return (
    <div className="rounded-md border bg-background p-5">
      <div className="grid gap-6 2xl:grid-cols-[280px_1fr]">
        <div className="space-y-4">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Audit health</div>
          <div className="flex items-end gap-3">
            <div className="nums text-7xl font-semibold leading-none">{audit.status === "completed" ? audit.score : auditProgress(audit)}</div>
            <Badge variant={scoreVariant as any}>{audit.status}</Badge>
          </div>
          <ProgressBar value={auditProgress(audit)} />
          <div className="text-xs text-muted-foreground">{auditPhaseLabel(audit)}</div>
        </div>
        <div className="space-y-3">
          <div>
            <div className="break-all text-xl font-semibold">{audit.url}</div>
            <div className="text-sm text-muted-foreground">{formatDate(audit.created_at)} · {formatNumber(audit.issue_count)} issues</div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <ImpactPill label="High" value={severityCounts.high} tone="bad" active={activeSeverity === "high"} onClick={() => onSeveritySelect("high")} />
            <ImpactPill label="Medium" value={severityCounts.medium} tone="warn" active={activeSeverity === "medium"} onClick={() => onSeveritySelect("medium")} />
            <ImpactPill label="Low" value={severityCounts.low} tone="outline" active={activeSeverity === "low"} onClick={() => onSeveritySelect("low")} />
          </div>
          {(audit.status === "running" || audit.status === "queued") ? (
            <p className="text-sm text-muted-foreground">Scanning is still running. Results update automatically.</p>
          ) : null}
          {audit.error ? <p className="text-sm text-destructive">{audit.error}</p> : null}
        </div>
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <div className="rounded-md border">
          <div className="border-b px-4 py-3 text-sm font-semibold">Crawl scope</div>
          <div className="divide-y">
            {scopeRows.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-5 px-4 py-3">
                <span className="text-sm text-muted-foreground">{label}</span>
                <span className="nums text-lg font-semibold">{formatNumber(value)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-md border">
          <div className="border-b px-4 py-3 text-sm font-semibold">Checked resources</div>
          <div className="divide-y">
            {resourceRows.map(([label, value, failures]) => (
              <div key={label} className="flex items-center justify-between gap-5 px-4 py-3">
                <span className="text-sm text-muted-foreground">{label}</span>
                <div className="flex items-center gap-3">
                  <span className="nums text-lg font-semibold">{formatNumber(value)}</span>
                  {failures != null ? <Badge variant={Number(failures || 0) ? "bad" : "outline"}>{formatNumber(failures)} failing</Badge> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
            </div>
  );
}

function ImpactPill({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number;
  tone: "bad" | "warn" | "outline";
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "rounded-md border bg-muted/25 p-3 text-left transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "border-primary bg-primary/10" : "",
      )}
      onClick={onClick}
    >
      <div className="text-sm font-medium text-muted-foreground">{label} issues</div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <span className="nums text-3xl font-semibold leading-none">{formatNumber(value)}</span>
        <Badge variant={tone}>{value ? "review" : "clear"}</Badge>
      </div>
    </button>
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
    .filter((group) => group.severity === "high" || group.severity === "medium")
    .slice(0, 5);
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
    <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
      <section className="rounded-md border bg-background">
        <div className="border-b px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Fix first</h2>
              <p className="mt-1 text-sm text-muted-foreground">Grouped issues with the highest crawl and search impact.</p>
            </div>
            <Badge variant={audit.status === "completed" ? "good" : "warn"}>{audit.status}</Badge>
          </div>
        </div>
        <div className="p-5">
          {priorityGroups.length ? (
            <div className="space-y-2">
              {priorityGroups.map((group) => (
                <button
                  key={group.key}
                  type="button"
                  className="w-full rounded-md border bg-muted/20 p-3 text-left transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onSelectGroup(group)}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={severityVariant(group.severity) as any}>{group.severity}</Badge>
                    <Badge variant="outline">{issueCategoryLabel(group.category)}</Badge>
                    <Badge variant="outline">{String(group.type || "").replaceAll("-", " ")}</Badge>
                    <span className="nums text-xs text-muted-foreground">{formatNumber(group.count)} affected</span>
                  </div>
                  <div className="mt-2 font-medium">{group.message}</div>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{group.recommendation}</p>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState title="No priority blockers" text={audit.status === "completed" ? "High and medium issue groups are clear." : "Priority issues appear while the scan runs."} />
          )}
        </div>
      </section>
      <section className="rounded-md border bg-background">
        <div className="border-b px-5 py-4">
          <h2 className="text-lg font-semibold">Audit coverage</h2>
          <p className="mt-1 text-sm text-muted-foreground">What this local run actually checked.</p>
        </div>
        <div className="space-y-4 p-5">
          <div className="divide-y rounded-md border bg-background">
            {checks.map((check) => (
              <div key={check.label} className="flex items-center justify-between gap-4 px-4 py-3">
                <div>
                  <div className="text-sm font-medium">{check.label}</div>
                  <div className="text-xs text-muted-foreground">{check.detail}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="nums text-2xl font-semibold">{formatNumber(check.value)}</span>
                  <Badge variant={(Number(check.value) ? check.tone : "good") as any}>{Number(check.value) ? "issues" : "clear"}</Badge>
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-md border bg-muted/25 p-3">
            <div className="grid gap-2 text-sm">
              {coverageRows.map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">{row.label}</div>
                    <div className="text-xs text-muted-foreground">{row.detail}</div>
                  </div>
                  <div className="nums text-lg font-semibold">{formatNumber(row.value)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
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
  const sections = [
    {
      title: "Metadata",
      text: "Titles, descriptions, snippets",
      icon: FileText,
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
      icon: ListChecks,
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
      icon: Image,
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
      text: "Targets, anchors, redirects",
      icon: Network,
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
      icon: ShieldCheck,
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
      icon: Globe2,
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
      icon: Zap,
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
      icon: Tags,
      rows: [
        { label: "Schema issues", value: summary.schemaIssues, problem: true, severity: "warn", category: "structured-data", types: ["structured-data-missing", "structured-data-invalid"] },
        { label: "Open Graph issues", value: issueTypesCount(issues, ["open-graph-incomplete", "open-graph-image-missing", "open-graph-image-invalid"]), problem: true, severity: "warn", category: "social", types: ["open-graph-incomplete", "open-graph-image-missing", "open-graph-image-invalid"] },
        { label: "Twitter/X card missing", value: issueTypeCount(issues, "twitter-card-missing"), problem: true, severity: "warn", category: "social", types: ["twitter-card-missing"] },
        { label: "Security issues", value: summary.securityIssues, problem: true, severity: "bad", category: "security", types: ["page-not-https", "external-blank-missing-noopener"] },
      ],
    },
  ];

  return (
    <div className="space-y-4">
      {sections.map((section) => {
        const Icon = section.icon;
        return (
          <div key={section.title} className="grid gap-5 rounded-md border bg-background p-5 xl:grid-cols-[260px_1fr]">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Icon className="size-5" />
              </div>
              <div>
                <div className="font-semibold">{section.title}</div>
                <p className="mt-1 text-sm text-muted-foreground">{section.text}</p>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
              {section.rows.map((row) => <AuditCheckRow key={row.label} row={row} onSelect={onSelectCheck} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AuditCheckRow({ row, onSelect }: { row: AuditCheckRowModel; onSelect: (row: AuditCheckRowModel) => void }) {
  const value = Number(row.value || 0);
  const variant = row.problem ? (value > 0 ? row.severity || "warn" : "good") : "outline";
  const clickable = Boolean(row.problem && row.types?.length);
  return (
    <button
      type="button"
      className={cn(
        "flex min-h-14 w-full items-center justify-between gap-4 rounded-md bg-muted/35 px-4 py-3 text-left transition-colors",
        clickable ? "hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" : "cursor-default",
      )}
      onClick={() => clickable ? onSelect(row) : undefined}
      disabled={!clickable}
    >
      <span className="text-sm font-medium">{row.label}</span>
      <div className="flex items-center gap-2">
        <span className="nums text-xl font-semibold">{formatNumber(value)}</span>
        {row.problem ? <Badge variant={variant as any}>{value ? "issues" : "clear"}</Badge> : null}
      </div>
    </button>
  );
}

function AuditIssueGroups({ groups, onSelect }: { groups: any[]; onSelect: (group: any) => void }) {
  return (
    <div className="rounded-md border bg-background p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="font-medium">Priority work queue</div>
          <p className="text-sm text-muted-foreground">Grouped by issue type so repeated failures become one clear task.</p>
        </div>
        <Badge variant="outline">{formatNumber(groups.length)} groups</Badge>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {groups.slice(0, 12).map((group) => (
          <button
            key={group.key}
            type="button"
            className="rounded-md border bg-muted/20 p-3 text-left transition-colors hover:bg-muted/45"
            onClick={() => onSelect(group)}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={severityVariant(group.severity) as any}>{group.severity}</Badge>
              <Badge variant="outline">{issueCategoryLabel(group.category)}</Badge>
              <Badge variant="outline">{String(group.type || "").replaceAll("-", " ")}</Badge>
              <span className="nums text-xs text-muted-foreground">{formatNumber(group.count)} URLs</span>
            </div>
            <div className="mt-2 font-medium">{group.message}</div>
            <div className="mt-1 line-clamp-2 text-sm text-muted-foreground">{group.recommendation}</div>
          </button>
        ))}
      </div>
    </div>
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

function IssueCard({ issue }: { issue: any }) {
  return (
    <div className="rounded-md border bg-background p-4 text-sm">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <AlertTriangle className={cn("size-4", issue.severity === "high" ? "text-destructive" : "text-muted-foreground")} />
          <Badge variant={issue.severity === "high" ? "bad" : issue.severity === "medium" ? "warn" : "outline"}>{issue.severity}</Badge>
          <Badge variant="outline">{issueCategoryLabel(issue.category)}</Badge>
          <Badge variant="outline">{issue.type}</Badge>
          <span className="font-medium">{issue.message}</span>
        </div>
        {issue.url ? (
          <a className="inline-flex items-center gap-1 text-xs text-primary" href={issue.url} target="_blank" rel="noreferrer">
            Open <ExternalLink className="size-3" />
          </a>
        ) : null}
      </div>
      <div className="mt-2 break-all text-xs text-muted-foreground">{issue.url}</div>
      <div className="mt-3 rounded-md bg-muted/50 p-3">
        <div className="text-xs font-semibold uppercase text-muted-foreground">Fix</div>
        <div className="mt-1">{issue.recommendation || "Review this item and update the affected page."}</div>
      </div>
      {issue.evidence ? <EvidenceList value={issue.evidence} /> : null}
    </div>
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

function EvidenceList({ value }: { value: Record<string, unknown> }) {
  const entries = Object.entries(value || {});
  if (!entries.length) return null;
  return (
    <div className="mt-3 rounded-md border bg-muted/25 p-3">
      <div className="text-xs font-semibold uppercase text-muted-foreground">Evidence</div>
      <div className="mt-2 grid gap-2">
        {entries.map(([key, entry]) => (
          <div key={key} className="grid gap-1 text-xs sm:grid-cols-[150px_1fr]">
            <span className="font-medium text-foreground">{key}</span>
            <span className="break-all text-muted-foreground">{evidenceText(entry)}</span>
          </div>
        ))}
      </div>
    </div>
  );
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
      <TableHeader><TableRow><TableHead>Target</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Anchor</TableHead><TableHead>Final URL</TableHead><TableHead>From</TableHead></TableRow></TableHeader>
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
  const visible = rows.slice(0, 350);
  return (
    <div className="space-y-2">
      <Table>
        <TableHeader><TableRow><TableHead>Image</TableHead><TableHead>Problems</TableHead><TableHead>Alt</TableHead><TableHead>Class</TableHead><TableHead>Size attrs</TableHead><TableHead>Sources</TableHead><TableHead>Loading</TableHead><TableHead>From</TableHead></TableRow></TableHeader>
        <TableBody>
          {visible.map((row, index) => (
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
      {rows.length > visible.length ? <p className="text-xs text-muted-foreground">Showing {formatNumber(visible.length)} of {formatNumber(rows.length)} image tags.</p> : null}
    </div>
  );
}

function AuditLinkInventoryTable({ rows }: { rows: any[] }) {
  const visible = rows.slice(0, 350);
  return (
    <div className="space-y-2">
      <Table>
        <TableHeader><TableRow><TableHead>Target</TableHead><TableHead>Type</TableHead><TableHead>Anchor</TableHead><TableHead>Rel</TableHead><TableHead>Target</TableHead><TableHead>From</TableHead></TableRow></TableHeader>
        <TableBody>
          {visible.map((row, index) => (
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
      {rows.length > visible.length ? <p className="text-xs text-muted-foreground">Showing {formatNumber(visible.length)} of {formatNumber(rows.length)} links.</p> : null}
    </div>
  );
}

function GscPage({ project }: { project: Project }) {
  const [status, setStatus] = useState<any>(null);
  const [sites, setSites] = useState<any[]>([]);
  const [performance, setPerformance] = useState<any>(null);
  const [inspectUrls, setInspectUrls] = useState(project.domain ? `https://${project.domain}/` : "");
  const [inspection, setInspection] = useState<any>(null);
  const [dimension, setDimension] = useState("query");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState("");
  const today = new Date();
  const defaultEndDate = today.toISOString().slice(0, 10);
  const defaultStartDate = new Date(today.getTime() - 28 * 86400000).toISOString().slice(0, 10);
  const [dateRange, setDateRange] = useState({ startDate: defaultStartDate, endDate: defaultEndDate });

  async function load() {
    setStatus(await api.gscStatus(project.id));
  }
  useEffect(() => {
    load().catch(console.error);
  }, [project.id]);

  async function connect() {
    setError("");
    try {
      const { url } = await api.gscStart(project.id);
      window.open(url, "_blank", "width=680,height=780");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start Google connection");
    }
  }
  async function loadSites() {
    setLoading("sites");
    setError("");
    try {
      setSites(await api.gscSites(project.id));
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
      setStatus(await api.gscSetSite(project.id, siteUrl));
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
        projectId: project.id,
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
  async function inspect() {
    setLoading("inspection");
    setError("");
    try {
      setInspection(await api.gscInspect({ projectId: project.id, urls: inspectUrls }));
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
      await api.gscDisconnect(project.id);
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
        description="Connect one property per site, read performance rows, and inspect index coverage from your real Search Console account."
        action={<Badge variant={status?.connected ? "good" : status?.configured ? "warn" : "outline"}>{status?.connected ? "Connected" : status?.configured ? "Ready to connect" : "OAuth missing"}</Badge>}
      />
      {error ? <p className="mb-4 rounded-md border border-destructive/40 bg-muted/30 p-3 text-sm text-destructive">{error}</p> : null}
      <div className="grid gap-6 2xl:grid-cols-[420px_minmax(0,1fr)]">
        <section className="rounded-md border bg-background">
          <div className="border-b px-5 py-4">
            <h2 className="text-lg font-semibold">Connection</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {status?.configured ? "OAuth is available in this local runtime." : "OAuth keys are missing from this local runtime."}
            </p>
          </div>
          <div className="space-y-3 p-5">
            <StatusEvidenceTable
              rows={[
                { title: "Google account", status: status?.connected ? "Connected" : "Not connected", tone: status?.connected ? "good" : "warn", text: status?.connection?.accountEmail || "Connect once, then choose the matching property." },
                { title: "Selected property", status: status?.connection?.siteUrl ? "Selected" : "None", tone: status?.connection?.siteUrl ? "good" : "warn", text: status?.connection?.siteUrl || "Load properties and pick the property for this site." },
              ]}
            />
            <Button className="w-full" onClick={connect} disabled={!status?.configured}>Connect Google</Button>
            <Button className="w-full" variant="secondary" onClick={loadSites} disabled={!status?.connected || loading === "sites"}>{loading === "sites" ? "Loading" : "Load properties"}</Button>
            <Button className="w-full" variant="outline" onClick={disconnect} disabled={!status?.connected || loading === "disconnect"}>Disconnect</Button>
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
        </section>
        <section className="rounded-md border bg-background">
          <div className="border-b px-5 py-4">
            <h2 className="text-lg font-semibold">Performance</h2>
            <p className="mt-1 text-sm text-muted-foreground">Clicks, impressions, CTR, and average position from the selected property.</p>
          </div>
          <div className="space-y-4 p-5">
            <div className="grid gap-3 md:grid-cols-[1fr_1fr_180px_auto]">
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
                <Button onClick={query} disabled={!status?.connection?.siteUrl || loading === "performance"}><BarChart3 /> {loading === "performance" ? "Querying" : "Query"}</Button>
              </div>
            </div>
            {performance?.rows?.length ? (
              <div className="space-y-4">
                <GscPerformanceSummary rows={performance.rows} />
                <GscPerformanceTable rows={performance.rows} dimension={dimension} />
              </div>
            ) : (
              <EmptyState
                title="No performance rows"
                text={status?.connection?.siteUrl ? "Query Search Console to load real performance rows." : "Connect Google and choose a property first."}
              />
            )}
          </div>
        </section>
      </div>
      <section className="mt-6 rounded-md border bg-background">
        <div className="border-b px-5 py-4">
          <h2 className="text-lg font-semibold">URL inspection</h2>
          <p className="mt-1 text-sm text-muted-foreground">Inspect up to 20 URLs against the selected property.</p>
        </div>
        <div className="space-y-4 p-5">
          <Textarea value={inspectUrls} onChange={(event) => setInspectUrls(event.target.value)} placeholder="https://example.com/page" />
          <Button onClick={inspect} disabled={!status?.connection?.siteUrl || loading === "inspection"}><ExternalLink /> {loading === "inspection" ? "Inspecting" : "Inspect URLs"}</Button>
          {inspection?.rows?.length ? <GscInspectionResults rows={inspection.rows} /> : null}
        </div>
      </section>
    </>
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
      columns="lg:grid-cols-4"
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
    <div className="grid gap-3 lg:grid-cols-2">
      {rows.map((row) => {
        const index = row.result?.indexStatusResult || {};
        const rich = row.result?.richResultsResult || {};
        return (
          <div key={row.inspectionUrl} className="rounded-md border bg-background p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="break-all font-medium">{row.inspectionUrl}</div>
                {row.error ? <p className="mt-1 text-sm text-destructive">{row.error}</p> : <p className="mt-1 text-sm text-muted-foreground">{index.coverageState || "Coverage state unavailable"}</p>}
              </div>
              <Badge variant={gscVerdictTone(index.verdict || row.error) as any}>{row.error ? "Error" : index.verdict || "Unknown"}</Badge>
            </div>
            {!row.error ? (
              <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                <GscInspectionFact label="Indexing" value={index.indexingState} />
                <GscInspectionFact label="Page fetch" value={index.pageFetchState} />
                <GscInspectionFact label="Robots" value={index.robotsTxtState} />
                <GscInspectionFact label="Last crawl" value={index.lastCrawlTime ? formatDate(index.lastCrawlTime) : "-"} />
                <GscInspectionFact label="Google canonical" value={index.googleCanonical} wide />
                <GscInspectionFact label="User canonical" value={index.userCanonical} wide />
                <GscInspectionFact label="Rich results" value={rich.verdict || "-"} />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function GscInspectionFact({ label, value, wide }: { label: string; value?: string; wide?: boolean }) {
  return (
    <div className={cn("rounded-md bg-muted/35 p-3", wide ? "sm:col-span-2" : "")}>
      <div className="text-xs font-semibold uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 break-all">{value || "-"}</div>
    </div>
  );
}

function AiPage({ project }: { project: Project }) {
  const [prompts, setPrompts] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [type, setType] = useState("seo.coach");
  const [context, setContext] = useState(`Site: ${project.name}\nDomain: ${project.domain}`);

  async function load() {
    setPrompts(await api.aiPrompts());
    setJobs(await api.aiJobs());
  }
  useEffect(() => {
    load().catch(console.error);
  }, [project.id]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const prompt = prompts.find((item) => item.key === type)?.template?.replace("{{context}}", context) || context;
    await api.createAiJob({ type, prompt });
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
        <ReportSection title="Jobs">
          {jobs.length ? <JobTable rows={jobs} /> : <EmptyState title="No jobs" text="Start a local Codex workflow." />}
        </ReportSection>
      </div>
    </>
  );
}

function JobTable({ rows }: { rows: any[] }) {
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Message</TableHead><TableHead>Created</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="font-medium">{row.type}</TableCell>
            <TableCell><Badge variant={row.status === "completed" ? "good" : row.status === "failed" ? "bad" : "warn"}>{row.status}</Badge></TableCell>
            <TableCell className="max-w-md truncate text-muted-foreground">{row.error || row.message || row.result_text}</TableCell>
            <TableCell className="text-muted-foreground">{row.created_at}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function McpPage() {
  const [tools, setTools] = useState<any[]>([]);
  useEffect(() => {
    api.mcpTools().then((data) => setTools(data.tools || [])).catch(console.error);
  }, []);
  const endpoint = `${window.location.origin}/mcp`;
  const visibleTools = useMemo(() => tools.filter((tool) => !mcpLegacyAlias(tool.name, tool.description)), [tools]);
  const groupedTools = useMemo(() => {
    return visibleTools.reduce<Record<string, any[]>>((acc, tool) => {
      const group = mcpToolGroup(tool.name);
      acc[group] = acc[group] || [];
      acc[group].push(tool);
      return acc;
    }, {});
  }, [visibleTools]);
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
  ];
  return (
    <>
      <PageHeader
        eyebrow="Agents"
        title="MCP"
        description="Local JSON-RPC tools for sites, scans, keywords, rank tracking, Search Console, AI jobs, and reports."
        action={<Badge variant="good">{formatNumber(visibleTools.length)} tools</Badge>}
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
          <TableHead>Required inputs</TableHead>
          <TableHead>Description</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((tool) => {
          const required = Array.isArray(tool.inputSchema?.required) ? tool.inputSchema.required : [];
          return (
            <TableRow key={tool.name}>
              <TableCell className="min-w-52 font-medium">{tool.name}</TableCell>
              <TableCell className="min-w-44">
                <div className="flex flex-wrap gap-1">
                  {required.length ? required.map((name: string) => <Badge key={name} variant="outline">{name}</Badge>) : <Badge variant="outline">none</Badge>}
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

function mcpLegacyAlias(name: string, description?: string) {
  return /^Legacy alias:/i.test(description || "") || ["list_projects", "create_project", "get_project_summary"].includes(name);
}

function mcpToolGroup(name: string) {
  if (/site|project|whoami/.test(name)) return "Sites";
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
      codex_model: data.codex_model || "gpt-5.5",
      codex_reasoning_effort: data.codex_reasoning_effort || "medium",
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
    });
    await load();
  }

  return (
    <>
      <PageHeader eyebrow="Local" title="App settings" description="Preferences for the local app. Data sources are shown as status, not secret fields." />
      <div className="grid gap-6 2xl:grid-cols-[460px_minmax(0,1fr)]">
        <ReportSection title="Codex" description="Local AI jobs use these app preferences.">
          <form className="space-y-4" onSubmit={save}>
            <Field label="Model"><Input value={form.codex_model || ""} onChange={(e) => setForm({ ...form, codex_model: e.target.value })} /></Field>
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
            <Button><Settings /> Save app settings</Button>
          </form>
        </ReportSection>
        <ReportSection title="Data sources" description="What the app can run locally now and what needs a real connected source.">
          <StatusEvidenceTable
            rows={[
              { title: "Technical audits", status: "Active", tone: "good", text: "Local crawler checks metadata, images, links, robots, sitemap, indexability, headings, content, schema, and social tags." },
              { title: "Keyword ideas", status: "Active", tone: "good", text: "DuckDuckGo suggestions provide real query ideas. Volume, CPC, and difficulty stay blank unless a metrics source is connected." },
              { title: "SERP and rank checks", status: config.openserp_url ? "OpenSERP" : "DuckDuckGo", tone: "good", text: "Uses OpenSERP when available, otherwise live DuckDuckGo results. The source is shown on each report." },
              { title: "Search Console", status: config.google_client_id && config.google_client_secret ? "Available" : "Connect on Search Console page", tone: config.google_client_id && config.google_client_secret ? "good" : "warn", text: "Connect per site from the Search Console screen to read real GSC performance and inspection data." },
              { title: "Backlink index", status: config.dataforseo_api_key ? "Connected" : "Not connected", tone: config.dataforseo_api_key ? "good" : "warn", text: "No generated backlink rows are shown. Backlinks require a real backlink index or imported data." },
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

  return <Workspace />;
}
