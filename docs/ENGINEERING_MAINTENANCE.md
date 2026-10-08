# Engineering maintenance / 工程维护

This describes the new implementation contracts, not production acceptance.
The current deployed SHA and verification evidence remain in [STATUS.md](STATUS.md).
此文不是“全部完成”声明；线上安装、Linux 演练、合并与部署必须有实际回执。

## Routine work boundary / 日常工作边界

[AGENTS.md](../AGENTS.md#scope-and-validation) is the single policy for choosing
day-to-day checks. This document is a reference for maintenance/release work,
not a checklist to execute for every code, copy or icon edit. Historical incident
notes do not authorize a new migration, cleanup or evidence-refresh task.

Current limitation: CI still runs `portfolio:verify --release-evidence`, which
binds browser and Vitest artifacts to their source inputs; the screenshot inputs
currently include `src/app/icon.svg`. Local scoped checks do not remove that
coupling. Changing it requires a separate reviewed implementation, not rewriting
old report hashes, omitting a failing job or claiming this documentation changed
the release gate. Existing protection, backups and rollback guarantees remain.

日常检查只按 `AGENTS.md` 分级选择；本文件按维护任务查阅，不作为每次修改的必跑清单。
当前 CI 仍将发布与源码绑定的作品证据关联，截图输入也包含 favicon。本次规则整理没有
解除这种程序级关联，也不允许伪造报告、跳过失败检查或删除恢复依据。

## 1. Durable release execution / 持久化发布

After the normal exact-master/Required CI gate authorization and immutable
release staging, invoke the staged `scripts/deploy/durable-release.bundle.mjs`
with the fixed Node 22.22.3 runtime. `start <sha>` submits the full protocol;
`start-application <sha>` explicitly selects the application-only protocol.
`status <sha>` independently reads the system service and private receipts.

The root system service is `diesel-release-<sha>.service`: no attached SSH pipe,
no automatic restart, six-hour maximum runtime and control-group termination.
One atomic operation claim is allowed per SHA. An ambiguous start is inspected,
never blindly retried. Receipts bind the input manifest, runner hash, operation
UUID, systemd invocation ID, worker PID, child exit code and timestamps.
Completion needs both the worker receipt and the same systemd invocation's
normal exit. `deploymentVerified` is always false here: independent public,
host, ledger, browser and provider acceptance is still mandatory.

Each private stdout/stderr file is capped at 16 MiB; overflow is drained and
explicitly marked truncated. No raw logs, environment or credentials are printed
by status. A disk write error cannot become success. Files survive a broken SSH
session; a reboot or killed worker without a completion receipt remains failed
or unknown, not a success. The Linux CI smoke uses a synthetic orchestrator to
exercise caller HUP, duplicate submission, exit 37 and worker SIGKILL. It does not
substitute for a real deployment/rollback rehearsal.

The synthetic Git archive pins `tar.umask=0022` at the command boundary. Root
tar otherwise preserves Git's default group-writable directory/file modes,
which the production controller correctly rejects before submission. Regression
tests execute the shipped export pipeline with permissive extraction and hostile
repository masks, checking directory 0755, regular-file 0644, executable 0755
and unchanged bytes. This fixes only the CI fixture; trusted-path checks are
not relaxed, and local permission tests do not replace the full Linux run.

以前两次 SSH 255 的根因仍未被证明。本改动消除“SSH 连接必须持续存在”的执行依赖，
不是把旧失败改写为成功，也不关闭主机信号、锁或恢复检查。

## 2. Application-only protocol v2 / 代码与数据发布分离

The first maintenance release still uses the full protocol: its dependencies
and protected server/database source have changed. A subsequent eligible
presentation/engineering-only release may select `start-application`.

- Both complete input manifests are reverified against immutable on-disk bytes.
  The predecessor must have a terminal COMMITTED host ledger.
- `application-release-contract.ts` denies by default: migrations, schema, seed,
  server/domain logic, ingestion scripts, signoff records, dependency manifests,
  patches and any new unclassified source root must be identical. Only the
  enumerated presentation, public asset, test, documentation and maintenance
  paths can differ. This is intentionally narrower than “all code changes.”
  The exact static metadata asset `src/app/icon.svg` is also presentation-only;
  executable icon handlers, layouts and other app routes remain protected.
- The lifecycle lock remains held. After building, the governance maintenance
  lock spans before-read, activation and verification. Database identity and
  complete migration lineage must match. Read-only repeatable-read transactions
  compare bounded SHA-256 row multisets for the 14 business/governance tables
  plus the migration ledger. Operational AI/quota counters are excluded.
  Raw documents and row values are not exported to these receipts.
- No migrations, seed/publication writes, full backup export or database restore
  run on this path. The public 97-jurisdiction readback and durable host/PM2
  verification remain required. A failed after-read requests preservation.
- New `APPLICATION_VERIFIED_V2` binds the activation anchor and both private
  fingerprint receipts. It never creates `PUBLISH_COMMITTED`/`PUBLISH_FINALIZED`.
  Valid pairs are PENDING/APPLICATION_VERIFIED_V2 (forward repair only) and
  COMMITTED/APPLICATION_VERIFIED_V2 (terminal). Application and publication
  markers cannot coexist; tampering or missing proof fails closed.
- The permanent `HOST_ACTIVATION_PROTOCOL_V1` inventory is not rewritten.
  All subsequent maintenance must use the new parser; old release scripts do
  not understand the extension and must not be used to bypass it.

Before the application marker exists, an ordinary pre-activation failure may
use the existing host rollback. After the marker exists, preserve and use the
maintenance-locked `finalize-application` path through the controller; no unsafe
automatic rollback. Unknown data state, unreadable ledgers, or receipt drift
always requires review. A failed SHA is not recycled.

## 3. Admission measurements / 准入测量

`scripts/ops/admission-benchmark.ts` requires explicit
`DIESEL_RUN_ADMISSION_BENCHMARK=true`, uses the real production repository and
pool options, and runs 20–200 samples (default 40): three fresh connections,
four warm requests, a request after at least 25 idle seconds, and concurrency
four over two retained connections. Isolated UUID scopes are forcibly rolled
back; a final query requires zero residual benchmark buckets. No model calls or
public quota usage. The report records every sample, failures and recomputable
nearest-rank p50/p95/p99, with a three-minute run budget. A pre-existing output
file is refused before connecting. Failures cannot be silently dropped.

The gate is all samples below the actual eight-second admission deadline, all
phases present, complete sample count and no execution/rollback/close error.
It measures connection plus repository/savepoint/rollback time, not HTTP/model
latency, quota saturation throughput or an availability SLO. CI's dedicated
PostgreSQL concurrency smoke remains the atomicity/saturation check.

2026-10-05 的本机→生产库 40 次观测：0 失败，p95 2169.896 ms，max 2651.336 ms，
闲置后 1174.139 ms；是一次约 53 秒实验，不是 VPS 网络测量或长期可用率。
生产网络复验、真实中英聊天和已有每六小时 provider canary 仍需分别读取结果。
至少积累 28 天观测，并明确统计缺失/失败的调度窗口，才能讨论长期稳定性；
不能把尚未经过的时间补成漂亮分数。
Canary artifacts are retained for 35 days: the 28-day observation window plus
seven days for review. Retention does not fill missing runs or turn failures
into passing observations.

The existing canary history is not all green: on 2026-10-05 the latest scheduled
run failed readiness (503) while its provider SSE check passed. A VPS-local
readback reproduced one 503 followed by three 200s. Direct runs of the deployed
read-only probe measured cold requests at 3239/2239/1446 ms and warm requests at
465/122/123 ms. This branch therefore gives the HTTP readiness envelope eight
seconds for connection establishment while keeping its independent SQL limit
at 2500 ms, single-flight, no success cache and no retries. This is a changed,
explicit readiness latency budget, not a claim that a 3-second SLO now passes.
Deployment and subsequent scheduled observations must verify the adjustment.

## 4. Backup retention and capacity / 备份与容量

All database backups, activation/incident records, runtime releases and the
immediate rollback basis are retained. This change does not authorize deletion
of backups or purchase/configure an unapproved offsite service.

`capacity` reports available (not root-reserved) bytes and free inodes. New
durable submissions require at least 5 GiB available, 20,000 free inodes and
less than 95% usage. Warnings begin below 8 GiB or at 85% usage. Existing running
services are not stopped by a warning. The optional `diesel-capacity.timer`
runs a read-only hourly check with a randomized delay; its failure and sanitized
JSON are visible in systemd/journal, not an external paging/on-call service.
Install the checked-in service/timer only after the new release is deployed and
verify the first invocation and next timer run. No application/model secret is
required or logged.

Routine cleanup is limited to inactive, explicitly reviewed rebuildable caches;
current/rollback/failed-candidate caches and all backups stay protected. Separately,
the user approved lossless archival of closed historical system journal files on
2026-10-05. This operation excludes the active journal: each archive must be fully
decompressed, SHA-256 compared, and checked with `journalctl --verify` before its
exact original can be removed. Private archives retain original metadata and
recovery instructions; the resulting operation receipt records actual completion,
not this authorization alone. Journal contents are never published in Git.
[The 2026-10-05 archive receipt](evidence/operations/journal-archive-2026-10-05.json)
records the completed per-file restore checks and independent second readback.

If capacity is still insufficient, pause new releases and approve external archival
with checksum and restore testing, or expand the disk. Retaining every backup on a
finite local disk is not an unlimited-capacity strategy. The user storage decision
is kept separate from the implemented warning/interlock.

## 5. Dependency queue / 依赖积压

This branch incorporates the exact npm versions proposed in PRs 59/60 and the
reviewed immutable Action pins in PRs 62–65. They are not declared merged until
the replacement PR passes the full gate. Node runtime remains 22.22.3 and pnpm
11.9.0. PR 61's Node 26 types are intentionally not applied: types must describe
the deployed runtime. Dependabot still proposes Node 22 updates; only its major
type upgrades are held until the runtime migration is reviewed.

Action references were checked against their upstream releases:
[checkout 7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1),
[setup-node 7.0.0](https://github.com/actions/setup-node/releases/tag/v7.0.0),
[upload-artifact 7.0.1](https://github.com/actions/upload-artifact/releases/tag/v7.0.1),
[pnpm setup 6.1.0](https://github.com/pnpm/action-setup/releases/tag/v6.1.0).
The exact workflow contracts and install-boundary hashes are updated together;
the mutation tests and unique Required CI gate are retained, not disabled.

Upgrade adaptations: check database URL controls before Zod normalization;
report a model stream's first private error only once while continuing to drain
usage; retain the Drizzle legacy-loader exclusion; bind the SDK's new undici
edge to reviewed 7.29.1; regenerate same-origin MapLibre assets and all bundled
licenses; update Playwright's execution-version contract and recapture evidence.
The real map tests use the canonical worker URL instead of a retired version.
The offline Demo model also honors repeated required-tool choices and uses unique
call IDs. Missing page/section evidence can consume the shared five-step bound
before the deterministic refusal; it must not produce premature prose or an SDK
tool-choice error. Full-stream, SSE and bilingual desktop/mobile checks cover it.
Removed MapLibre 6.9.0 copies are recoverable from Git; replacement 6.11.2 assets
retain their complete license/notice files.

The public deadline browser test also runs at normal and eightfold CPU slowdown.
React development Strict Mode may expose an already-aborted first-mount country
GET to interception. The test requires exactly one still-pending country GET and
one locale POST, then zero pending requests after the unchanged 15-second deadline.
It still rejects duplicate locale writes, checks error/disabled-state recovery,
and releases every held route even on failure; raw total request count is not a
portable proxy for current work. No production request behavior is changed.

Native modified-click navigation tests retain validated modifier/focus/default-
prevention metadata, without changing input or navigation behavior. One local
Chinese new-tab timeout remains an unproven historical observation despite six
passing focused diagnostic repetitions; a fresh full-suite pass does not rewrite
that failure or establish that its root cause is permanently fixed.

No country, regulatory fixture, real product, database schema or business effect
claim is added. External product approval, regulatory expert signoff and real
customer outcomes are not engineering-maintenance completions.
