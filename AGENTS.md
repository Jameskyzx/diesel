# AGENTS.md

## Project

This repository contains a global diesel-engine regulations, product-fit, market-data, and AI sales-analysis application.

## Package manager

Use pnpm only.

## Setup

```bash
pnpm install
pnpm dev
```

## Required checks

Run the relevant checks after every implementation task:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run Playwright when changing user-facing flows:

```bash
pnpm playwright test
```

Do not report a task as complete when required checks are failing.

## Engineering rules

* Use TypeScript strict mode.
* Avoid `any`.
* Validate external input with Zod.
* Keep server-only code outside client components.
* Never expose database service keys or model API keys to the browser.
* Prefer Server Components unless browser interaction requires a Client Component.
* Keep database access behind repository or service functions.
* Do not query Supabase directly from arbitrary UI components.
* Prefer small composable functions.
* Do not introduce a dependency without documenting its purpose.
* Do not silently change database schemas.
* All schema changes require a migration.
* Use ISO 3166-1 alpha-3 codes as the canonical country join key.
* Store dates in ISO format and UTC where timestamps are required.
* Keep regulation status explicit: proposed, adopted, effective, superseded.
* Never treat proposed regulations as effective regulations.
* Never use the LLM as the source of truth for regulations, market metrics, product specifications, or certifications.
* All AI tools must use Zod-validated parameters and structured outputs.
* AI answers involving regulations must include sources when available.
* Marketing scores must be calculated by deterministic application code.
* The LLM may explain a score but may not invent or modify it.

## Map rules

* Use MapLibre GL JS.
* Use GeoJSON features joined by ISO3.
* Support hover for pointer devices.
* Support click for touch devices.
* Clicking a country must produce a shareable URL.
* Countries without data must display an explicit no-data state.
* Do not store large world geometry in application state.
* Do not add PostGIS queries unless the feature genuinely requires spatial calculation.

## Knowledge-base rules

* Structured facts belong in relational tables.
* Source documents and explanatory text belong in the document store.
* Every chunk should preserve document ID, source, heading, page or section, jurisdiction, country, application scope and validity dates when available.
* Retrieval must support metadata filtering.
* Prefer hybrid keyword and vector retrieval.
* Retrieved evidence must be traceable to its source.
* Do not answer from a retrieved chunk that is outside its effective date or application scope without warning the user.

## Database rules

* Use Drizzle migrations.
* Do not edit an applied migration.
* Add indexes for frequently filtered foreign keys and date/status columns.
* Add vector indexes only after representative data and retrieval tests exist.
* Seed data must be deterministic.
* Test validity-period and product-fit queries.

## UI rules

* Use accessible semantic HTML.
* Use shadcn/ui primitives where appropriate.
* Include loading, empty and error states.
* Avoid hiding critical information only in hover interactions.
* Regulatory status and source freshness must remain visible.
* AI output should render as structured cards when structured data exists, not only as Markdown paragraphs.

## Task workflow

Before coding:

1. Read relevant files in `docs/`.
2. Inspect existing code and migrations.
3. State the implementation plan.
4. Identify files expected to change.

During coding:

1. Work only on the requested phase.
2. Keep changes narrow.
3. Add or update tests.
4. Update documentation when architecture or behavior changes.

After coding:

1. Run required checks.
2. Fix failures caused by the change.
3. Summarize changed files.
4. Report tests and commands executed.
5. Report unresolved risks or assumptions.
6. Suggest only the next smallest logical task.

Do not independently implement future phases.
