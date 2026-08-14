# Dependency security policy

The lockfile is scanned on every push and pull request, once a week, and on
manual workflow dispatch. `critical` advisories fail CI immediately. High
advisories must be triaged within two business days and either remediated within
14 days or recorded below with reachability, compensating controls, owner, and a
dated re-review. Exceptions never suppress secret scanning and never permit a
critical advisory.

The machine-readable register is
`.github/dependency-audit-allowlist.json`. `pnpm audit:security` rejects every
new high advisory, every expired exception, and every critical advisory. This
document explains the corresponding human review; both records must be updated
together.

Dependabot opens weekly pnpm/npm and GitHub Actions updates. A dependency update
must pass lint, typecheck, coverage, the empty PostgreSQL + pgvector migration
smoke, the production build, and both Playwright suites before merge.

`@axe-core/playwright` is a development-only dependency used to run WCAG smoke
checks in Chromium and WebKit; it must never enter application bundles or become
a substitute for manual keyboard/screen-reader review. `@vitest/coverage-v8` is
a development-only Vitest reporter used solely for the repository coverage gate
and artifacts; production code must not import it.

## Current high-advisory register (reviewed 2026-08-15)

| Advisory | Path / exposure | Current control | Owner | Re-review |
| --- | --- | --- | --- | --- |
| None | The 2026-08-15 audit reports no high or critical advisory. | Keep the empty machine register and fail CI on any new high/critical result. | maintainer | next weekly audit |

The weekly audit is a discovery mechanism, not a substitute for this register.
When the audit reports a new high advisory, the workflow output must be reviewed
and this table updated or the dependency fixed before unrelated release work.

The application directly decodes untrusted chat images with `sharp`. Both the
direct dependency and Next.js optional dependency are therefore pinned through
the pnpm override to patched `sharp@0.35.3`; a runtime-reachable image decoder
advisory may not be accepted as a build-only exception.

The same workspace override file narrowly replaces only the vulnerable locked
versions of PostCSS, brace-expansion, fast-uri, js-yaml, and nanoid with their
patched same-major releases. This keeps upstream dependency ranges observable:
if a future lockfile selects a different vulnerable version, the override will
not silently cover it and the audit gate will fail again.
