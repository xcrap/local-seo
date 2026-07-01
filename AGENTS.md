# Agent Instructions

## Project Overview
- This is a local-first SEO workstation, not a hosted SaaS clone.
- The app runs locally with a Bun/Hono API, React/Vite frontend, and SQLite storage.
- SQLite is the source of truth for sites, scans, keywords, Search Console imports, AI jobs, MCP state, and app settings.
- Do not add Cloudflare workers, hosted queues, hosted auth, billing, teams, or fake hosted-product assumptions.
- Do not generate fake SEO metrics, fake backlinks, fake organic traffic, fake keyword volume, or placeholder audit evidence.

## Stack
- Bun for runtime, package management, scripts, and tests.
- Hono API in `src/`.
- React 19 + Vite app in `web/`.
- Shadcn-style local UI components in `web/src/components/ui`.
- Tailwind CSS v4 in the web app.
- SQLite database in `data/`.
- Biome for JavaScript/TypeScript linting.
- TypeScript strict unused checks are enabled through root and web `tsconfig.json`.

## Repository Layout
- `src/` contains the local API, database access, crawlers, Search Console helpers, Codex jobs, and MCP endpoint.
- `src/scans.ts` owns local site scanning and crawl persistence.
- `src/seo.ts` owns SEO research, keywords, rank tracking, imports, backlinks, and site-level application behavior.
- `web/src/App.tsx` owns shell/routing only; page-level UI belongs under `web/src/app/pages/`.
- `web/src/app/shared.tsx` is for shared app UI helpers, formatters, scan/site helpers, and reusable report widgets.
- `tools/` contains smoke, UI, Waka crawl, and admin utility scripts.
- `data/` contains local SQLite files. Do not delete local app data unless the user explicitly asks.

## Workflow
- Keep changes focused on the requested behavior.
- Prefer existing local patterns over new abstractions.
- Do not reintroduce giant page files or mixed-responsibility modules.
- When adding UI, use the existing shadcn-style component layer and the current design system.
- Do not hide user data by default. If data is obsolete, expose a clear delete action rather than silently removing it.
- Do not change user defaults or site preferences unless explicitly asked.
- If schema or persistence behavior changes, update the relevant tests and keep SQLite migrations/data handling explicit.

## Data Rules
- Real local crawl evidence is required for audit/scanning data.
- Backlinks and organic metrics must come from real imports or real providers. Show unavailable/import-needed states instead of made-up rows.
- Google Search Console data must come from OAuth/API or CSV imports stored locally.
- Local Codex jobs run through the Codex CLI and should be saved in SQLite.
- MCP tools should use the local app API/data layer, not a parallel storage path.

## Biome
- `bun run lint` runs `biome lint .`.
- `bun run lint:fix` runs `biome lint --write .`.
- Biome is for linting JavaScript/TypeScript/JSON source. Formatting remains separate unless explicitly requested.
- Keep Biome scoped to source/config files and exclude generated/build/database artifacts.

## Verification
- Run `bun run lint` after JavaScript, TypeScript, TSX, or JSON changes.
- Run `bun x tsc -p tsconfig.json` after backend TypeScript changes.
- Run `bun x tsc -p web/tsconfig.json` after frontend TypeScript/TSX changes.
- Run `bun run test:smoke` after route, API, app-shell, scan-report, or source-guard changes.
- Run `bun run test:ui` after UI/navigation/workflow changes.
- Run `bun run test:waka` after crawler, sitemap, resource, page-speed, scan scoring, or scan report changes.
- Run `bun run build` before shipping frontend-impacting changes.

## Style Preferences
- Prefer simple, direct code.
- Avoid duplicate logic and remove dead code.
- Keep React page files modular and readable.
- Use `for...of` where it reads better than callback iteration.
- Keep UI tables/lists readable at real desktop and mobile widths.
- Ask before changing architecture, data deletion behavior, or provider assumptions that are not clearly requested.
