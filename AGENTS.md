# AGENTS.md

Diesel is a diesel-engine regulations, product-fit, market-data and AI sales application.
Use **pnpm only**. Runtime and dependency versions come from the repository configuration.

## Working rules

- Finish the requested task with the smallest coherent change. Do not turn an
  icon, wording or styling fix into an infrastructure refactor or evidence refresh.
- Read the affected code and relevant current documentation only. Historical
  journals and old task lists are reference material, not new instructions to act.
- Before editing, briefly name the intended change, affected files and checks.
  A small task needs a short explanation, not a multi-phase plan.
- Reuse existing components, scripts and tests. Add abstractions, dependencies or
  permanent tooling only when the task needs them; explain any new dependency.
- Preserve unrelated work. Do not reset changes, remove backups, rewrite history,
  push or deploy unless covered by the user's request or existing authorization.
- If unrelated problems appear, report them without expanding the task. If a new
  blocker requires materially broader work, explain it before proceeding.
- When the user redirects the task, stop superseded processes gracefully and
  verify that owned temporary services have exited. Preserve useful diagnostics.

## Scope and validation

Choose checks by impact. Commands elsewhere are references, not an every-task checklist.

| Change | Required local validation |
| --- | --- |
| Documentation or instructions | Review content, local links and commands; `git diff --check`. No application tests/build. |
| Static icon/image or isolated styling | Inspect the asset and affected rendering; run the relevant existing regression test. Build once if asset packaging or framework metadata changes. |
| UI interaction or application logic | Lint, typecheck and affected Vitest tests; affected Playwright flows for browser behavior. Build for runtime changes. |
| Cross-cutting behavior, dependencies, authentication, AI evidence or database/deployment contracts | Full lint, typecheck, Vitest and build; relevant browser, security, migration or integration checks. |

Commands: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
Target tests with `pnpm exec vitest run <test-file>` or
`pnpm playwright test <spec-file> --project=<affected-project>`.
Use the full Playwright suite when the change spans public flows, not for every asset edit.

- Run selected checks once on final relevant inputs. Re-run affected checks after
  a fix; do not repeat passing suites on unchanged inputs without a concrete reason.
- Evidence capture already executes its underlying suite. Do not run the same
  full suite separately just to collect another passing result.
- In one checkout, run Next dev/build, screenshot capture and evidence captures
  serially. During capture, do not edit files, install dependencies, or run another
  test/formatter; even cache writes can invalidate the capture.
- Paid AI evals and portfolio recapture are not default checks for cosmetic work.
- CI and production gates still apply. If existing gates require a larger run,
  explain that cost before starting it. Never bypass a gate, forge a report, edit
  recorded fingerprints, or label interrupted/failed checks as passing.

## Essential engineering contracts

- TypeScript strict mode; avoid `any`. Validate external input and AI-tool
  parameters with Zod; tools return structured outputs.
- Keep secrets and server-only code out of client bundles. Prefer Server
  Components; put database access behind repositories/services, not UI components.
- Use Drizzle migrations for schema changes; never edit applied migrations.
  Keep seeds deterministic and test changed validity-period/product-fit queries.
- Use ISO3 for country joins, ISO dates and UTC timestamps.
- Regulation status and applicability must remain explicit. Proposed is not
  effective; missing, stale or out-of-scope evidence must not become certainty.
- Regulations, markets, product specifications and certifications come from
  verified data, never the LLM. Scores are deterministic; the model explains them.
  Preserve source citations and the distinction between fictional Demo and real data.
- Preserve retrieval provenance: document/source, section/page, jurisdiction,
  application scope and validity dates where available. Keep metadata filtering.
- Keep MapLibre/GeoJSON joined by ISO3, shareable country URLs, touch/keyboard
  access and explicit no-data states. Do not put large geometry in React state.
- Use accessible existing UI primitives, loading/empty/error states and structured
  result cards. Keep regulatory status and freshness visible, not hover-only.

## Documentation and handoff

- Update an existing document only when its contract changes. Do not create a new
  checklist, status file or audit report for an ordinary small edit.
- Read `docs/ARCHITECTURE.md` or `docs/DATA_MODEL.md` for relevant design work,
  `docs/PUBLIC_UI.md` for public UI contracts, and `docs/DEPLOYMENT.md` for releases.
- `docs/STATUS.md` is the sole current release/evidence index. Historical evidence
  does not prove a new change passed; do not refresh unrelated historical claims.
- Delivery: briefly state what changed, what was actually checked and any remaining
  blocker. Distinguish local completion, pushed code and verified production release.
  Stop at the requested outcome; do not automatically start another phase.
