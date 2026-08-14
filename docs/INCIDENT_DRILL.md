# Local Failure Drill Record

## Scope

- Date: 2026-08-15
- Environment: local test runner, PGlite fixtures, mocked model/provider, and
  deployment-script preflight only
- Production impact: none
- Goal: verify public failure states and recovery commands without writing to the
  public database or claiming a production incident exercise

## Scenarios

| Fault | Expected service state | Expected user-visible behavior | Recovery / verification |
| --- | --- | --- | --- |
| Database readiness timeout/failure | `/api/health/ready` returns 503 and structured `DATABASE_NOT_READY` log metadata; liveness remains independent | UI/API reports data unavailable and does not claim “online” | Restore DB connectivity, run `pnpm ops:canary`, and require readiness 200 before traffic |
| Model configuration/provider failure | Chat fails with a sanitized configuration/stream error and `X-Request-Id`; no provider body, key, prompt, IP, or DB URL is logged | User sees an actionable temporary AI failure; deterministic pages remain usable | Restore server-only model variables, restart the versioned release, then run the optional AI canary |
| Evidence insufficient | Tool result remains `no_data` or `evidenceSufficient=false`; the stream gate does not release unsupported factual prose | User sees the precise evidence gap and any successful structured cards, not an invented answer | Refine country/scope/power/date or publish reviewed evidence; rerun the same golden case |
| Bad application release | Release preflight or post-switch canary fails; no database rollback is inferred from an app rollback | Traffic returns to the recorded previous immutable release | On VPS run `scripts/deploy/rollback-host-release.sh <failed-release-id> --check`, then `--apply`; rerun readiness and public canary |

## Evidence exercised

- Readiness, chat error, and evidence-gap branches are covered by Vitest route and
  AI stream tests.
- `scripts/deploy/rollback-host-release.sh` is syntax-checked and its fail-closed
  target/release invariants are covered by `tests/deploy-scripts.test.ts` and
  `tests/deployment-config.test.ts`.
- `pnpm ops:canary` checks liveness, readiness, the CHN decision summary and the
  public product list; `CANARY_CHECK_AI=true` adds one paid SSE probe.

This record is a local controlled drill. A future production drill must record
the actual release IDs, timestamps, operator, alert path, recovery duration, and
post-incident actions separately.
