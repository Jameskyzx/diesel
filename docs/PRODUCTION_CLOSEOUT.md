# Production closeout / 生产收尾

Current deployment truth remains in [STATUS.md](STATUS.md). This is the bounded
engineering checklist, not a claim that a passing local test means production is fixed.

## Admission latency

The failed production starter returned `RATE_LIMIT_TIMEOUT` after 3013 ms before
any provider call. A read-only comparison on the VPS reproduced a 3204 ms cold
transaction with the shared client's default type discovery and 20-second idle
eviction. A separate retained client with type discovery disabled took 1394 ms
cold and 574 ms after 25 seconds idle. These sequential samples support the
connection-overhead diagnosis, but are not a controlled load benchmark or an SLO.
See [raw sanitized timings](evidence/operations/database-latency-2026-10-04.json).

Hourly rate limits and daily provider-call reservations now share an isolated
two-connection PostgreSQL pool. Built-in scalar types do not require catalog
discovery. Idle connections are retained, with a 30-minute maximum lifetime.
Business queries and readiness retain their independent pools. No quota, SQL
atomicity, fail-closed behavior, SQL deadline, or schema is relaxed. The
PostgreSQL concurrency smoke uses the same connection options as production.

The retained pool did not eliminate cold admission failures: the deployed
`eb85fe4c40b5aff8274f835494a65770af8af611` process recorded three chat HTTP 503s,
including its first recorded chat request. Those failures remain in the
[historical observation](evidence/operations/production-closeout-latest.json).
On 2026-10-04 the user approved increasing only the hourly-admission application
wait from 3,000 to 8,000 ms. Slow legitimate decisions now have five more seconds
to settle, including connection setup and transaction round trips. This can
increase failure latency and admission-slot occupancy; it is not a faster
database or an availability guarantee. At eight seconds the request still
fails closed, and unfinished database work retains its in-flight lease until
settled. Daily admission/audit setup remains 10 seconds; SQL lock/statement/idle
limits remain 1.5/2.5/5 seconds, and readiness remains three seconds. Quotas and
the four-global/two-per-client concurrency bounds are unchanged. Production
acceptance of the new wait budget is still required before claiming it fixed.

Acceptance must include a cold first chat request, another after at least 25
seconds idle, all six real starter clicks, and the provider-inclusive canary.
Any 429/503, incomplete SSE, missing evidence or wrong release remains a failure.

## Evidence and operations

- Production browser suite: `e2e-live/chat-starters.spec.ts`, opt-in only,
  exact release, desktop Chinese/mobile English, no API mocks and no retries.
- Provider canary: one real sourced starter every six hours; uses existing
  public quotas, stores sanitized failure metadata, no model key in GitHub.
- The current status index is separated from the frozen historical journal.
- Only explicitly enumerated, inactive `.next/cache` contents were removed;
  all database backups, release artifacts and incident logs remain intact.
- Versioned lifecycle/rollback checks and the required CI gate remain mandatory.
- Governance snapshot batches now retain a healthy reader connection after the
  existing protocol-drain/probe barriers. Each batch still imports the same
  exported snapshot into its own read-only repeatable-read transaction. A failed
  reader is closed before retry; the final retained lease is explicitly closed.
  Batch sizes, exact timestamp/raw-JSON preservation, deadlines and snapshot
  validation are unchanged. This removes repeated connection setup, not backup
  or recovery checks. Actual production timing remains to be measured.

## Required engineering acceptance

- New-source full checks, strict evidence capture, protected merge and deployment.
  The [production observation](evidence/operations/production-closeout-latest.json)
  records their actual completion or failure; this checklist alone is not proof.
- Verify the deployed admission fix under real network conditions; a good
  read-only sample cannot substitute for real quota writes and chat execution.
- App/data release decoupling needs a separately versioned, tested state-machine
  change. The existing `PUBLISH_FINALIZED` marker must never be fabricated for a
  release that skipped publication. Until that change is reviewed, use the
  existing complete release protocol and preserve failures.
- Vitest evidence v2 distinguishes the four STATUS release-observation fields
  and their two mirrored bullets from execution inputs. The verifier still
  validates their original bytes, resolved commits and consistency on every run.
  `docs/evidence/operations/*.json` are explicitly historical operator records,
  not execution inputs or signed release evidence. All code, tests, model/browser
  evidence, fixture counts, ordinary prose and deployment instructions remain
  fingerprinted. Pending document edits still make the worktree dirty; strict
  release verification requires committed bytes. Other documentation edits still
  require recapture when they change an execution/documentation contract.

## External acceptance

Approved real products/certifications, independent regulatory signoff, customer
pilot results and history redistribution rights remain external inputs. Private
document storage and a representative retrieval benchmark require an authorized
document set and a storage/access decision. No synthetic fixture, local test or
agent review is evidence of those approvals. These gates are not silently
converted to completed work.
