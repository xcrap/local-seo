# Local SEO

Local SEO is a local-first React + SQLite SEO workspace inspired by OpenSEO.
It has no Cloudflare runtime, no D1/KV/R2, no hosted billing, and no external
auth service.

## Features

- Single local admin login
- Local SQLite sites, keywords, rank tracking, audits, AI jobs, config, and cache
- Real local crawler data for technical SEO audits
- Real DuckDuckGo suggestions/search results for free keyword ideas and web SERP checks
- Optional DataForSEO-backed SEO datasets when a real API key is configured
- Google Search Console OAuth and performance querying
- Local Codex jobs with medium reasoning by default
- Local MCP JSON-RPC endpoint at `/mcp`
- Shadcn-style React UI with a warm Tracking-inspired design system

## OpenSEO-Inspired Local Workflows

- **Sites:** local website workspaces with domain, market, language, notes, and archived state.
- **Keyword research:** real DuckDuckGo suggestions, with DataForSEO metrics when configured.
- **SERP analysis:** live web result snapshots, target ownership, ranking-page tables, and history.
- **Saved keywords:** local canonical keyword list, filtering, managed tags, bulk tag edits, bulk delete, and CSV export.
- **Rank tracking:** local trackers, tracked keyword CRUD, manual checks from real search results, run history, and historical snapshots.
- **Organic research:** ranked keywords and top pages for a target domain when a real organic dataset is connected; otherwise no generated traffic/ranking numbers are shown.
- **Backlinks:** backlink overview, backlink rows, referring domains, and top linked pages only from a real backlink index.
- **Site audits:** local crawler for titles, descriptions, metadata length, H1/H2, heading hierarchy, canonicals, noindex, robots, sitemap indexes, schema, social tags, missing/generic/long image alt text, image dimensions, broken links, broken images, broken CSS/JS assets, duplicate titles/descriptions/content, issue groups, progress, detail inspection, and deletion.
- **Brand lookup:** real web-search evidence and optional AI visibility datasets when connected.
- **Prompt explorer:** local Codex jobs or optional real AI visibility data-source responses.
- **Google Search Console:** OAuth connection, property picker, disconnect, search analytics query endpoint, and URL inspection helper.
- **Local AI lab:** Codex-backed SEO coach, clustering, audit prioritization, competitor gaps, and AI visibility jobs.
- **MCP:** local tools for sites, keyword research, saved keywords, organic research, backlinks, SERP, rank trackers, audits, GSC performance, GSC URL inspection, brand lookup, prompt explorer, and Codex jobs.

## Quickstart

```sh
bun install
bun run db:init
bun run dev
```

Open `http://localhost:5173` during development. The API runs on
`http://localhost:3031` by default.

`.env` is optional for the local product. Create it only when connecting
optional data-source credentials such as Google OAuth, DataForSEO, MCP token, or a custom
Codex model.

The first load lets you create the local admin user in the browser. You can also
create or update it from the terminal:

```sh
bun run admin:create
bun run admin:password
```

## Local Data Model

A site is the website/domain being analyzed. The selected site feeds scans,
rank trackers, Search Console, keyword saves, AI jobs, and local history. Each
audit run is stored separately in SQLite, even when multiple scans use the same
domain.

External SEO datasets are never generated locally. Backlink indexes, Google
keyword volumes, CPC, keyword difficulty, and third-party traffic estimates
require a real data source or imported data. The app shows not-connected states
instead of invented rows.

This project is local-first and intentionally removes OpenSEO hosted features:
billing, teams/orgs, hosted auth, Cloudflare Workers, D1, KV, R2, queues, and
hosted cron workflows. The local replacements are SQLite tables, real local
crawls, manual run buttons, Google OAuth stored locally, and a custom local MCP
endpoint.

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
