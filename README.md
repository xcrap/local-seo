# Local SEO

Local SEO is a local-first React + SQLite SEO workstation. It runs as a single
local app with SQLite storage, one local admin account, and optional external
data connectors only when you configure them.

## Features

- Single local admin login
- Local SQLite sites, keywords, rank tracking, scans, AI jobs, config, and cache
- Real local crawler data for technical SEO scans
- Real DuckDuckGo suggestions/search results for free keyword ideas and web SERP checks
- Optional self-hosted OpenSERP or SearXNG for free/local SERP and rank checks
- Google Search Console OAuth and performance querying
- Local Codex jobs with medium reasoning by default
- Local MCP JSON-RPC endpoint at `/mcp`
- Shadcn-style React UI with a warm Tracking-inspired design system

## Local Workflows

- **Sites:** saved websites with domain, crawl URL preferences, optional keyword tool defaults, and notes.
- **Keyword research:** real DuckDuckGo suggestions. Volume, CPC, and difficulty stay unavailable unless real metric imports are added later.
- **SERP analysis:** live web result snapshots, active-site ownership, ranking-page tables, and history.
- **Saved keywords:** local canonical keyword list, filtering, managed tags, bulk tag edits, bulk delete, and CSV export.
- **Rank tracking:** local trackers, tracked keyword CRUD, manual checks from real search results, run history, and historical snapshots.
- **Organic research:** local scan pages for the active site. Ranked keywords and traffic estimates are not generated locally.
- **Links and backlinks:** local crawl link graph from scans. Web-wide backlink overview, backlink rows, referring domains, and top linked pages require a real imported backlink index and are not generated locally.
- **Site scans:** local crawler for titles, descriptions, metadata length, H1/H2, heading hierarchy, canonicals, noindex, robots, sitemap indexes, schema, social tags, page response timing, missing/generic/long image alt text, image dimensions, broken links, broken images, broken CSS/JS assets, duplicate titles/descriptions/content, issue groups, progress, detail inspection, and deletion.
- **Brand lookup:** real web-search evidence without generated answer-model claims.
- **Prompt explorer:** local Codex jobs saved in SQLite.
- **Google Search Console:** OAuth connection, property picker, disconnect, search analytics query endpoint, and URL inspection helper.
- **Local AI lab:** Codex-backed SEO coach, clustering, scan prioritization, competitor gaps, and AI visibility jobs.
- **MCP:** local tools for sites, keyword research, saved keywords, organic research, backlinks, SERP, rank trackers, scans, GSC performance, GSC URL inspection, brand lookup, prompt explorer, and Codex jobs.

## Quickstart

```sh
bun install
bun run db:init
bun run dev
```

Open `http://localhost:5173` during development. The API runs on
`http://localhost:3031` by default.

`.env` is optional for the local product. Create it only when connecting
optional data-source credentials such as Google OAuth, a self-hosted OpenSERP
or SearXNG URL, MCP token, or a custom Codex
model. In-app Settings are for app preferences, not secret fields.

The first load lets you create the local admin user in the browser. You can also
create or update it from the terminal:

```sh
bun run admin:create
bun run admin:password
```

## Local Data Model

A site is the website/domain being analyzed. The active site feeds scans,
rank trackers, Search Console, keyword saves, AI jobs, and local history. Each
scan run is stored separately in SQLite, even when multiple scans use the same
domain.

SERP and rank checks can use self-hosted OpenSERP, self-hosted SearXNG, or the
built-in DuckDuckGo fallback. External SEO metrics are never generated locally.
Backlink indexes, Google keyword volumes, CPC, keyword difficulty, and
third-party traffic estimates require future import support or a deliberately
built adapter. Local scans still feed technical pages, internal/external links,
images, assets, sitemap, robots, and response timing into reports. The app shows
unavailable states instead of invented rows.

This app is local-first. Hosted product concerns such as billing, teams/orgs,
hosted auth, queues, and hosted cron workflows are not part of this fresh local
app. The product uses SQLite tables, real local crawls, manual run buttons,
Google OAuth stored locally, and a custom local MCP endpoint.

## MCP

The MCP endpoint is local and custom-built for this app:

```text
POST /mcp
```

In the app, the MCP screen shows the exact local URL for the current port. If a
local MCP token is configured, send:

```text
Authorization: Bearer <MCP_TOKEN>
```

Supported tools include site listing, keyword research, saved keywords,
SERP analysis, site scans, Google Search Console performance, brand lookup,
prompt explorer, and Codex AI job creation.

## Verification

```sh
bun x tsc --noEmit
bun run test:smoke
bun run test:ui
bun run test:waka
bun run --filter web build
```

Smoke and UI tests run against temporary SQLite databases. They do not write to
the local app database at `data/local-seo.sqlite`.
