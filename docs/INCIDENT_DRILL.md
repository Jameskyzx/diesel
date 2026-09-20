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
| Bad application release or public-boundary drift | Release preflight, exact health version, or Demo-only product canary fails; no database rollback is inferred from an app rollback | Traffic returns to the recorded previous immutable release; the site does not claim a mismatched SHA or unapproved real product as healthy | On VPS run `scripts/deploy/rollback-host-release.sh <failed-release-id> --check`, then `--apply`; verify the restored release ID, update the machine-readable STATUS only from verified state, and rerun the public canary |
| Crash after V1 anchor but before `HOST_ACTIVATION_PENDING` | The same release has a valid anchor-only ledger; no live host mutation is authorized and every other release is blocked | Existing traffic remains on the recorded previous release | Rerun that release's full `--begin-activation` preflight under FD 8; do not delete the anchor or initialize a different release |
| Crash with `PENDING:none` before governance publication | The rollback basis remains bound to the pending ledger; direct abort must restore and read back env, Nginx, `current`, exact live/dump PM2 identity, and the enumerated disk/loaded/MainPID identity of `pm2-root.service` before `PENDING` becomes `ROLLED_BACK`. This does not replace a real reboot drill or prove the default boot transaction. | Traffic either remains on, or converges back to, the recorded previous release | Rerun `--abort-if-uncommitted` under a newly acquired lifecycle lock; failure must leave PENDING active for another retry |
| Crash at `ROLLED_BACK:HOST_ROLLBACK_REQUIRED` | Database restoration has been proven, but host completion is still active and blocks another release | Public traffic must not be described as recovered merely from the host marker | Rerun `recover-required` through the maintenance wrapper; it must repeat idempotent host restore, deep-compare the database, and verify `current`/lock before HREQ becomes HCOMP |
| Crash at `PENDING:PUBLISH_FINALIZED` | The governance commit is irreversible but host finalization is incomplete; host rollback is forbidden | The committed release remains the only valid traffic target, although production status must stay unverified | Rerun `finalize-committed`; repeat host/public/current/lock proofs, then make `COMMITTED:PUBLISH_FINALIZED` the final terminal pair |

## Evidence exercised

- Readiness, chat error, and evidence-gap branches are covered by Vitest route and
  AI stream tests.
- `scripts/deploy/rollback-host-release.sh` is syntax-checked and its fail-closed
  target/release invariants are covered by `tests/deploy-scripts.test.ts` and
  `tests/deployment-config.test.ts`.
- The host-activation scenarios above are local fixture and fault-injection
  exercises only. Tests cover the one-time immutable cutoff manifest, legal
  two-ledger state matrix, anchor-only same-release resume, repair replay from
  `ROLLED_BACK:HOST_ROLLBACK_REQUIRED`, forward-only finalization, and refusal of
  direct host-activation-ledger state-mutation modes in its public CLI. They are not evidence that these faults
  occurred, or were recovered from, on the production host.
- For an explicit external `CANARY_BASE_URL`, `pnpm ops:canary` reads the full
  expected release SHA from the STATUS portfolio block (or an explicit
  `CANARY_EXPECTED_VERSION`), requires liveness/readiness to return that exact
  version, checks the CHN decision summary, and requires the public product list
  to contain only the two approved fictional Demo configurations and zero real
  or Demo/source-mismatched products. Every run also exercises the no-provider
  deterministic chat SSE contract; `CANARY_CHECK_AI=true` independently adds
  the paid provider SSE probe. Initialization failures persist a sanitized v3
  report with a stable failure stage.

This record is a local controlled drill. A future production drill must record
the actual release IDs, timestamps, operator, alert path, recovery duration, and
post-incident actions separately.
