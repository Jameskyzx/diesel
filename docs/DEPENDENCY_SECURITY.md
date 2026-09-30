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
together. The command also requires a complete, schema-valid pnpm audit report:
signals, malformed or error-envelope JSON, unexpected exit codes, and a non-zero
exit without reported advisories all fail closed. Exit code 1 is accepted only
as pnpm's documented advisory result and is still evaluated by this policy. The
gate also recomputes every `info`/`low`/`moderate`/`high`/`critical` count from
the advisory rows and rejects metadata drift. Informational, low, and moderate
rows remain visible but do not require a high-severity exception.

Dependabot opens weekly pnpm/npm and GitHub Actions updates. A dependency update
must pass lint, typecheck, application coverage, the independent Linux
deployment-script contracts, the empty PostgreSQL + pgvector migration smoke,
the production build, the public, zero-config Demo, and failure-first FDE
Playwright suites, plus the production CSP contract, before merge. The single
`Required CI gate` fails unless every merge-blocking job succeeds.

The allowlist also accepts exact test assignment/serialization lines for the
three deterministic UUID lock/receipt fixtures ending in `4000`, `4001`, and
`4002`. It does not exempt test files or arbitrary UUIDs, API-key assignments,
or lines containing additional values. The synthetic PAT canary remains required.

The secret-scanning job keeps gitleaks 8.21.2 and its reviewed release-archive
SHA-256. A dependency-free, SHA-256-bound `scripts/ci/run-gitleaks.py` validates
the actual scan outcome: this release can report a Git scan error and still
exit zero with an empty report. The guard explicitly scans all fetched refs
with root and separate merge diffs; it requires exit zero, an empty JSON array,
one positive scanner commit count, completion and no-leaks diagnostics, and no
error diagnostics. The scanner's count is not `git rev-list` cardinality: empty,
binary-only and deletion-only changes can be omitted. It is not a proof that
every reachable commit contributed a scannable fragment.
The independent synthetic-token canary must exit exactly 97 and report exactly
the expected redacted GitHub PAT finding; a crash or initialization error is
never detection success. Both scans use the same checked-in policy, no ambient
ignore file, bounded process waits and temporary redacted reports. Failure
messages do not echo arbitrary scanner output or findings. These controls do
not replace review of the policy, binary provenance, or history redistribution
rights, and do not attest untracked working-tree files.

Every CI job that will invoke pnpm, setup-node, or repository Node code runs the
SHA-256-pinned, dependency-free `scripts/ci/verify-install-boundary.py` guard
immediately after checkout. It rejects root install lifecycle scripts,
repository `.npmrc` / `.pnpmfile.cjs`, non-canonical package metadata, and drift
in the reviewed pnpm workspace execution config. Ordinary workflow installs use
`--frozen-lockfile --ignore-scripts --ignore-pnpmfile`; native dependency setup
is not silently re-enabled. The Linux production-build handoff retains only the
workspace `allowBuilds` boundary exercised by the real release path, so those
allowlisted dependency lifecycles remain third-party code and must be reviewed
when their locked versions or the workspace hash changes.

### Pinned Next static-file cancellation correction

`patches/next@16.3.6.patch` changes only the installed CJS and ESM
`serve-static.js` handlers. The original implementation settled on `finish`
but could wait indefinitely when the client disconnected before delivery.
The correction registers finish/close/error listeners before file I/O and
settles once. Cancellation ends the handler's ownership without manufacturing
a finish event or claiming delivery. Actual source/response/pipe errors before
settlement still reject; late source errors remain handled after cancellation.
Already closed/destroyed/finished responses do not start another file read.

The patch is registered through pnpm and the lockfile. It was originally applied
to 16.3.3 without changing the package version, dependency, lifecycle hook or
cleanup deadline. The 2026-09-30 security update retargets the byte-identical
patch to 16.3.6; the two installed patched handlers are byte-identical across
these versions. The pre-install CI
guard binds both the workspace configuration and the exact patch bytes, and
its digest remains pinned by every relevant workflow job. Missing, changed or
symlinked patch files fail before pnpm setup. The 30 installed-runtime
regressions exercise native HTTP byte delivery, HEAD/304/range responses,
missing files, disconnects and terminal races. The ESM body is transpiled by
the test harness; this is not a claim of native Node ESM execution. The original
working tree reproduced 18 failures / 12 passes before this fix. Other framework
corrections in the isolated candidate are not implicitly included here.

固定 Next 补丁仅改 CJS/ESM 静态文件处理器：先监听终态，再开始文件读取，
断连后结束等待但不伪造 finish 或完整送达；真实异常仍失败，取消后的晚到源错误仍被处理。
pnpm 配置、锁文件和安装前 CI 校验共同绑定补丁字节；缺失、篡改或符号链接会失败关闭。
三十条已安装运行时回归在原目录修复前为 18 失败 / 12 通过。未迁入隔离候选的其他
框架补丁；原修复未升级依赖、增加脚本或放宽关闭期限。2026-09-30 安全更新将原样补丁
转至 16.3.6，两版安装后的处理器字节相同；具体执行结果以本轮检查记录为准。

### Pinned Vitest task-event timer correction

`patches/@vitest__runner@4.1.11.patch` clears the expired throttle timer handle
before invoking its callback. In the installed runner, a callback firing at or
just before the 100ms boundary retained that handle, so queued task events could
remain undelivered until another event arrived. A deterministic clock regression
executes the installed dependency's actual function at 99/100/101ms: the first
two failed before the correction; all three pass afterwards. The original
active-test heartbeat integration assertion and its deadlines remain unchanged.
This proves the timer defect, not that every historical intermittent failure
has the same cause.

This is a patch to an existing development dependency, not a version upgrade or
new dependency. It changes no assertions, results, application code, or model
behavior. pnpm's lockfile and the pre-install guard bind its exact bytes;
missing, changed, and symlinked patches fail closed. Future runner upgrades must
re-evaluate the patch and retain the installed-runtime boundary regressions.

固定 Vitest 补丁只在计时器回调执行前清除失效 handle，避免 99/100ms 边界不再排队。
回归直接执行已安装依赖的函数，修复前两个边界失败、修复后三个边界通过；真实活动用例
进度断言和全部超时不变。不新增依赖、不改应用/模型行为，补丁字节受锁文件和安装前校验
约束。此前间歇性失败仍保留，不声称这个竞态已经解释所有旧失败。

Local portfolio evidence capture is install-free. The workspace disables
`verifyDepsBeforeRun`, while Playwright and Vitest capture additionally pin pnpm
offline mode, dependency verification off, and the exact validated versioned
store directory. Managed operations compare the pnpm control files and a
complete metadata-only `node_modules` closure before and after execution;
Vitest list/test also disable caching. Their child processes use private
HOME/TMP/XDG and empty user/global npm configuration, reject workspace `.npmrc`
and `.pnpmfile.cjs`, and disable Vite env-file loading. A missing or mismatched
installation fails closed and must be repaired by an explicit reviewed
`pnpm install`.
This closure does not hash package bytes or recursively attest the store, so it
must not be described as package provenance or signature verification. pnpm's
offline flag also does not prove that arbitrary test subprocesses cannot use
the network.

## Historical dependency-license evidence (collected 2026-09-05)

The history audit's v3 `retainedDependencyLicenseScan` binds the
[dependency manifest](evidence/fde-development-history-dependency-licenses-2026-09-05.manifest.json)
and its bounded gzip JSON/base64 record. It retains 810 files, including all
807 originally inventoried raw files, the original bundle manifest, README, and
packaging script. Verification consumes these only as data, without executing
retained scripts, installing packages, or accessing original collection paths
or a registry.

Six historical input tuples represent three locked graphs. Six frozen installs
and twelve Darwin arm64 production/all-dependency license reports completed;
the all-dependency identity counts are 680/681/682. A separate set of 175 exact
registry-declared license records matches locked name, version, and integrity,
closing the combined identity counts to 855/856/857. Platform metadata and
registry declarations are separately identified, not interchangeable evidence
of license-text review or cross-platform installation. Full compound license
expressions, including Apache/LGPL/MIT combinations, remain intact.

Package bodies were cache-only, but pnpm's supply-chain checks still requested
public registry metadata despite `--offline`; that access was separately
authorized. `--ignore-scripts` left native builds pending and establishes no
runtime readiness. Failed attempts and the earlier installation-unverified
metadata-only run remain retained as such, not credited as successful installs.
These records neither approve public redistribution nor upgrade the missing
2026-08-20 raw evidence. Missing project LICENSE, NOTICE, and package license
fields, incomplete historical asset/copied-material review, and the missing
weak-copyleft/notice policy still block publication. See
[Development history evidence](DEVELOPMENT_HISTORY.md) for the dated scope and
limits; this license record is not a current vulnerability audit.

### 历史依赖许可证证据（采集于 2026-09-05）

历史审计 v3 的 `retainedDependencyLicenseScan` 绑定上述依赖 manifest 及有界 gzip
JSON/base64 数据记录，留存 810 份文件，包括原清单的全部 807 份原始文件、原证据包
manifest、README 和打包脚本。校验只读取数据，不执行留档脚本、不安装包、不访问原采集
路径或 registry。

六个历史输入状态对应三张锁定依赖图；六次 frozen 安装及十二份 Darwin arm64 生产/全部
依赖许可证报告已完成，全部依赖身份数分别为 680/681/682。另行补查的 175 项 registry
许可证声明逐项匹配锁定包名、版本和完整性摘要，使合并身份数闭合到 855/856/857。平台
元数据与 registry 声明单独标识，不得混同为许可证全文审阅或跨平台安装；Apache/LGPL/MIT
等完整复合表达式保留不变。

包体只来自缓存，但 pnpm 的供应链检查在 `--offline` 下仍请求公开 registry 元数据，
该访问另行获批。`--ignore-scripts` 留下未完成的原生构建，不证明运行就绪。失败尝试与
较早 installation-unverified 的仅元数据运行原样保留，不计为成功安装。这些记录既不
批准公开再分发，也不提升缺少 2026-08-20 原始证据的旧结论。项目 LICENSE、NOTICE、
package license 字段缺失、历史资产/复制材料人工复核未完成，以及弱 copyleft/NOTICE
政策缺失，仍共同阻止发布。日期化范围和限制见[开发历史证据](DEVELOPMENT_HISTORY.md)；
这份许可证记录不是当前漏洞审计。

## CI dependency and action controls

Every remote GitHub Action and reusable workflow is pinned to a full immutable
commit SHA. The adjacent release-version comment records the reviewed tag for
review, while `pnpm audit:actions` rejects movable tags, branch names, short
SHAs, and Docker actions or service/job-container images without a `sha256`
digest. Candidate Action pins must be resolved from the action's official
repository; candidate container pins must be resolved from the official registry
and checked as the intended manifest or index before either kind is changed.
The adjacent `pg16` comment on the pgvector service image is only an update hint;
the reviewed OCI index digest is the executed identity. Dependabot remains
responsible for proposing future updates.

`@axe-core/playwright` is a development-only dependency used to run WCAG smoke
checks in Chromium and WebKit; it must never enter application bundles or become
a substitute for manual keyboard/screen-reader review. `@vitest/coverage-v8` is
a development-only Vitest reporter used solely for the repository coverage gate
and artifacts; production code must not import it.

## Current advisory review (2026-09-30)

The post-merge CI run for `cd81849473fccdf63ad365436a603755ed74ab80`
was blocked by critical
[GHSA-vcvr-r3jv-pc5j](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j),
covering Node.js `next/og` ImageResponse with attacker-controlled SVG content.
The affected line is `next >=16.2.0 <16.3.6`; the official
[16.3.6 release](https://github.com/vercel/next.js/releases/tag/v16.3.6)
contains the fix. The registry observation before this update had one critical,
zero high and seven moderate advisory rows. No direct `next/og` or
`ImageResponse` use was found in current application source or the previous
deployed source; this does not prove absence of indirect reachability and is
not grounds for bypassing the critical gate.

Next, its env/SWC packages and eslint-config-next/plugin are now aligned at
16.3.6; no unrelated locked identities changed. The existing static-file
cancellation patch remains byte-identical. The script-disabled frozen install
and `pnpm audit:security` passed at 2026-09-30 16:32 UTC. The exception register
remains empty. A complete follow-up registry report at 16:33 UTC contains zero
critical/high and seven moderate rows (ip-address, fast-uri, brace-expansion);
those moderate findings remain visible and are not waived or silently upgraded.
The 371 focused regressions, including all 30 installed static-file tests, pass.
The local build also exposed that TypeScript included the ignored root `tmp`
backup checkout, mixing Next versions. Its source selection now excludes only
that root temporary directory, with a real TypeScript-config regression retaining
maintained source, tests, generated Next types and nested source `tmp` directories.
No backup is removed. This dependency result does not establish completed runtime
validation, deployment, or zero vulnerabilities. Lock-bound evidence must be
recaptured; earlier failing CI and live-eval observations remain retained.

2026-09-30：合并后的安全门禁发现 Next OG 严重漏洞，现仅升级现有 Next 及配套包至
官方 16.3.6，原静态文件取消补丁原样保留。安装边界与 CI 摘要同步，冻结安装和安全
审计通过；不增加豁免、不改 CI 门槛、不据此声称已部署或零漏洞。旧失败记录保留，
锁文件相关证据必须重新采集。未发现直接 OG 使用不等于证明无法间接触达。

### Earlier 2026-09-30 brace-expansion observation

PR #40's dependency gate reported two high findings on the existing
`brace-expansion@1.1.18` and `5.0.9` installation edges:
[nested expansion recursion](https://github.com/advisories/GHSA-qhr7-859c-m2p7)
and [comma-parser recursion and argument overflow](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p).
The exact overrides now select the official same-major patches `1.1.20` and
`5.0.11`. Only those two dependency identities change in the lockfile; no root
dependency, lifecycle permission, schema or advisory exception is added. The
workspace, pre-install guard and affected CI job digests are updated together;
the required gate is unchanged and the failed run remains failed.

Twelve real-installation regressions traverse ESLint/minimatch and
typescript-estree/minimatch, check the resolved patches, exercise both advisory
payload families and preserve ordinary nested alternatives/ranges. The original
installation failed ten and passed two; the patched installation passes all
twelve. Script-disabled frozen installation and `pnpm audit:security` passed
at 2026-09-30 05:57 UTC. No high/critical finding is accepted by the policy;
this is not a zero-vulnerability or production-exploitability claim. Evidence
bound to the lockfile must be recaptured before release.

2026-09-30：PR #40 安全门禁被 brace-expansion 两项高危阻断，现只更新现有间接依赖
至官方同主版本补丁 1.1.20 / 5.0.11，并同步安装边界和 CI 摘要链。实际安装路径的
12 项回归由 10 失败 / 2 通过变为全部通过，冻结安装及安全审计通过；没有新增依赖、
风险豁免或绕过 CI，也不据此声称零漏洞、线上可被利用或部署完成。

### Earlier 2026-09-30 undici observation

PR #39's dependency gate subsequently reported two high findings against
`undici@7.29.0`: [unrequested WebSocket subprotocol denial of service](https://github.com/nodejs/undici/security/advisories/GHSA-rfgv-xxqx-mfg5)
and [BalancedPool dropping function-valued TLS/connection options](https://github.com/nodejs/undici/security/advisories/GHSA-w293-vg96-wgc3).
The official patch in the existing major line is `7.29.1`. The exact override
updates both installed shadcn and dotenvx edges, without a new dependency or
risk exception. The installation configuration, pre-install guard and all
affected canonical CI job digests are reviewed together. The normal required
gate remains blocking; the failed run is not relabeled or bypassed.

The frozen, script-disabled installation and `pnpm audit:security` passed at
2026-09-30 00:37 UTC, with no high/critical advisory accepted by the policy.
This is not a zero-vulnerability claim. Eight installed-edge regressions verify
the patched version and retention of custom connector/TLS verification callbacks.
No production exploitability or successful deployment is inferred from these
dependency-level results. Lock-sensitive release evidence must be recaptured.

2026-09-30：PR #39 新一轮安全门禁被 undici 的两项高危阻断；精确升级至官方同主版本
补丁 7.29.1，同时更新安装配置及 CI 摘要链，不新增依赖或风险豁免。冻结安装与安全
审计通过，8 项实际安装路径回归通过；这不代表零漏洞、线上可被利用或已发布。

### Earlier 2026-09-29 observation

The fresh official-registry audit reported two high advisories in
`fast-uri@3.1.6`: [authority injection through ports](https://github.com/fastify/fast-uri/security/advisories/GHSA-qw65-cvwx-89v3)
and [unbalanced authority brackets](https://github.com/fastify/fast-uri/security/advisories/GHSA-58mr-gqgx-xq4g).
Both name `3.1.7` as the patched release in the existing major line. Exact
overrides for the previously locked `3.1.4`, `3.1.5`, and `3.1.6` now resolve to
`3.1.7`. The lock diff replaces only this dependency identity, integrity and AJV
edge; no root dependency, lifecycle permission, schema or risk exception changes.
The workspace, install guard and CI contract hashes are updated together.

After a frozen installation with lifecycle scripts and pnpmfile disabled,
`pnpm audit:security` exits zero with **0 critical and 0 high**. This is not a
zero-advisory report: **3 moderate** advisories remain in `undici@7.29.0`
([decompression error](https://github.com/nodejs/undici/security/advisories/GHSA-3wwx-pv8p-q78v))
and `ip-address@10.3.1`
([link-local classification](https://github.com/beaugunderson/ip-address/security/advisories/GHSA-rpw4-54j3-4h4q),
[NAT64 classification](https://github.com/beaugunderson/ip-address/security/advisories/GHSA-2vr4-cq9g-pvrc)).
They arrive through shadcn and are not exempted as development-only. Official
same-major fixes are `undici@7.29.1` and `ip-address@10.5.1`; this bounded change
addresses the high-severity release blocker only. The exception register stays empty.

Twelve real-installation regressions traverse shadcn's MCP SDK and dotenvx/conf
AJV paths, check the resolved patch, reject malformed host/port inputs and retain
valid DNS/IPv6 behavior. The original installation fails ten and passes two;
the patched installation passes all twelve. These are dependency regressions,
not a claim that a production application endpoint was exploitable or that the
candidate has been deployed. Full evidence must be recaptured for the new lock.

2026-09-29 官方审计发现 fast-uri 的两项新增高危，现仅升级到同主版本 3.1.7，
精确覆盖与 CI 摘要链同步，未增加依赖、安装脚本权限或风险豁免。实际安装路径的
12 条回归由 10 失败 / 2 通过变为全部通过；安全门禁零高危、零严重，但仍有上述
3 项中危，不得称为零漏洞或已部署。锁文件变化后的完整证据需重新采集。

## Historical high/critical advisory register (reviewed 2026-09-12)

After the explicitly approved MapLibre 5-to-6 migration, the latest
observed `pnpm audit:security` exited **0** with official stable
`maplibre-gl@6.9.0` installed. The earlier intermediate `6.4.1` audit also
passed; neither audit substitutes for runtime verification.
The complete registry report contains **0 critical, 0 high, 0 moderate, 0 low,
and 0 info** advisory rows. This is dependency-audit evidence, not a passing
map-runtime, full browser, release, or deployment receipt.
The earlier three-critical/two-high observation and the intermediate
one-critical/eleven-moderate/one-low observation and the later
one-critical/one-moderate observation are historical. The four
Next/sharp/js-yaml high/critical findings below are no longer reported against
the installed lock. The machine-readable exception register remains empty;
its review date does not imply a passing audit or an exception.

| Advisory | Severity | Current locked package | Official fixed version for this package line | Local triage |
| --- | --- | --- | --- | --- |
| [GHSA-p293-qw3h-jr36](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36) | critical | `next@16.3.3` | `16.3.3` | Patched locally from `16.2.12`; no longer reported by the post-install audit. Not yet deployed. |
| [GHSA-2xp9-vwfh-vxw4](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4) | critical | `next@16.3.3` | `16.3.3` | Patched locally from `16.2.12`; Next's optional sharp resolves to `0.35.4`. Not yet deployed. |
| [GHSA-jrc7-96c5-q579](https://github.com/maplibre/maplibre-gl-js/security/advisories/GHSA-jrc7-96c5-q579) | critical | `maplibre-gl@6.9.0` | `6.4.1` (cross-major) | Upgraded from `5.24.0` after explicit WebGL2/ESM compatibility approval. Both intermediate 6.4.1 and current 6.9.0 audits passed; runtime verification is separate. Not deployed. |
| [GHSA-rgj7-g3m4-5g8c](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c) | high | `sharp@0.35.4` | `0.35.4` | Direct and Next decoder paths both load patched `0.35.4`; real PNG/JPEG/WebP attachment regressions pass. Not yet deployed. |
| [GHSA-2883-xcg3-v3hh](https://github.com/nodeca/js-yaml/security/advisories/GHSA-2883-xcg3-v3hh) | high | `js-yaml@4.3.2` | `4.3.2` | Exact selectors for previous `4.3.0` and `4.3.1` locks resolve to `4.3.2`; no longer reported by the post-install audit. |

The maintainer explicitly approved MapLibre 5-to-6, including the WebGL2 minimum
and ESM worker change, on 2026-09-12. That approval does not authorize publishing
or deployment. The earlier same-major maintenance and failing MapLibre audit
remain historical observations. All findings require re-review before release.
MapLibre's [v6 migration](https://github.com/maplibre/maplibre-gl-js/releases/tag/v6.0.0)
requires WebGL2 and changes its ESM/worker distribution, so it cannot be treated
as a patch-only lockfile replacement. Validation must include actual map
interactions, initialization failure/recovery, localization, mobile behavior,
and the production CSP contract. Existing passing test receipts do not establish
that v6 is compatible or that production has received these local patches.
The intermediate 6.4.1 source returned a partially initialized Map when WebGL2
creation fails, emits that error synchronously before ordinary post-constructor
listeners can subscribe, and dereferences the missing painter/handlers in
`remove()` before releasing its image-throttle callback. This is a separately
identified runtime cleanup defect, not covered by the sanitizer fix. A minimal
pnpm patch was proposed but not applied. A subsequent official-release check
found the upstream fix in [v6.7.0](https://github.com/maplibre/maplibre-gl-js/releases/tag/v6.7.0)
and current stable [v6.9.0](https://github.com/maplibre/maplibre-gl-js/releases/tag/v6.9.0).
The migration now uses unmodified 6.9.0: for the observed GL-null path, the
constructor rolls back its container and throws `GPUInitializationError` before
registering throttle callbacks, handlers, or workers. The application catches
that public error locally, without probing another canvas or touching private
fields; successful instances are disposed exactly once before retry/unmount.
This source review does not prove arbitrary Painter failures release all GPU
resources or replace real browser failure/recovery tests.

The 6.9.0 native context-loss path has a separate cleanup gap: its bubble
handler calls `Style.destroy()` and clears the style before emitting the map
event; that destroy path does not send map-specific `RM` or unregister the
global RTL listener. Since the application discards lost contexts, it handles
the native canvas event in the capture phase and synchronously calls the
public `Map.remove()` before that bubble handler. It neither cancels the event
nor accesses private library fields. Browser validation must observe real
map-specific removal acknowledgements and a lost, detached old canvas; shared
workers legitimately remain owned by MapLibre's document-level RTL singleton.
This is not a claim about garbage collection or arbitrary GPU failure modes.

The update used `pnpm install --lockfile-only --ignore-scripts --ignore-pnpmfile`
followed by a frozen install with the same script restrictions. No lifecycle
scripts or native rebuilds were enabled. Installed Darwin arm64 decoder readback
reports sharp `0.35.4`, libvips `8.18.6`, and libheif `1.23.2`; this is local
runtime evidence, not cross-platform or package-provenance attestation.
Next and eslint-config-next are aligned at `16.3.3`. The updated Next lint plugin
adds its exact `@eslint-community/eslint-utils@4.9.1` dependency, and lock
resolution reuses the existing `axe-core@4.13.0` for the accessibility lint
plugin. Those same-major updates did not change MapLibre; the subsequent
approved v6 installs changed only MapLibre and its necessary lock closure;
6.9.0 adds upstream's `bidi-js` text-shaping dependency, not a new application feature.
The migration's worker and relative shared module are served together from the
same-origin, versioned `public/maplibre/6.9.0/` directory, with the unchanged
package license and `THIRD-PARTY-NOTICES.txt` containing 16 bundled dependencies'
original notice texts. The bounded generator compares the related sourcemap
source set and embedded text with the installed notice sources and recomputes
the notices deterministically. Installed versions identify notice sources;
they are not independent proof of upstream bundle build versions.
They are copied without code changes and checked byte-for-byte against the
installed package by the Next configuration boundary. Normal dev/build commands
only verify these source assets; `pnpm map:prepare-assets` explicitly prepares
a new version directory. No CDN or lifecycle installation hook is introduced.

The subsequent toolchain update aligned `vitest` and `@vitest/coverage-v8` at
`4.1.11`, including the transitive mocker fix for
[GHSA-82fw-gwwq-j7x9](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9).
The advisory concerns redirect mocks in development-server file serving; this
record does not claim that the application's production server was exploited.
The patch also restores upstream test-lifecycle concurrency handling, so the
actual reporter, inventory and timeout regressions must run on the new version;
changing a version constant alone is not evidence. See the
[4.1.11 release](https://github.com/vitest-dev/vitest/releases/tag/v4.1.11).

Exact overrides replace `hono@4.12.32` with `4.13.5` and `qs@6.15.3` with
`6.16.0`. These remain within the consuming SDK, node-server, Express and
body-parser dependency/peer ranges. They address the remaining
[Hono fixes](https://github.com/honojs/hono/releases/tag/v4.13.5) and
[qs denial-of-service advisory](https://github.com/ljharb/qs/security/advisories/GHSA-4mjr-xmp4-gh2g).
The packages arrive through shadcn's MCP SDK dependency; no direct application
imports were found, but shadcn is a production dependency, not an audit exemption.
Post-install audit no longer reports these Hono, qs or Vitest findings.

Before the loader cleanup below, the lock retained 954 package identities and
955 snapshots: nine Vitest-family
packages plus Hono and qs are replaced, with the necessary node-server Hono peer
snapshot change. Independent normalized comparison found no unrelated graph
changes. Frozen installation again disabled lifecycle scripts and pnpmfile.
Installed version and lock readback, Hono's local Request handling and qs query
parsing passed; these smoke checks do not simulate every advisory exploit.
The evidence contract now requires Vitest `4.1.11` and rejects `4.1.10` reports.
Old report bytes must not be relabeled; full test and browser evidence must be
recaptured for the updated dependency inputs. CI's workspace/guard/job hash
chain was recomputed without changing job behavior or audit exceptions.

The previously remaining moderate issue was
[GHSA-67mh-4wv8-2f99](https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99)
in `esbuild@0.18.20`, retained by drizzle-kit's deprecated esbuild-kit chain.
The upstream advisory names `>=0.25.0` as patched; `0.24.3` was not published.
The previously recorded `0.24.3` threshold incorrectly treated the complement
of the vulnerable range as a released fix. This is not a patch in the installed
pre-1.0 minor line. No blanket override or risk exception was introduced.

The exact pnpm override `drizzle-kit@0.31.10>@esbuild-kit/esm-loader: "-"`
now removes that unused dependency edge. This uses pnpm's documented
[dependency-removal setting](https://pnpm.io/11.x/settings/dependency-resolution#overrides),
not an upstream dependency-cleanup release or an out-of-range esbuild upgrade.
The registry's stable Kit version remains `0.31.10`; its
[release notes](https://github.com/drizzle-team/drizzle-orm/releases/tag/drizzle-kit%400.31.10)
describe the migration to tsx. Inspection of all seven shipped runtime files
found no legacy loader reference. The CLI uses its bundled tsx registration
with esbuild `0.25.12`; the public API uses external tsx `4.23.1` with esbuild
`0.28.1`. Both supported paths remain unchanged.

The lock now contains 927 package identities and 928 snapshots. Only the 27
orphaned legacy-chain identities and the single Drizzle dependency edge were
removed; independent normalized comparison found no other package, peer or
root dependency changes. No new dependency or database schema was introduced.
The override is deliberately limited to Kit `0.31.10` and must be reviewed
again when that version changes, especially if configuration starts using the
removed loader directly.

The first frozen installation left the old loader reachable even though both
lockfiles were clean; the new runtime-resolution regression correctly failed.
`pnpm prune --ignore-scripts --config.ignore-pnpmfile=true` removed its target,
and a subsequent offline frozen reinstall also completed with lifecycle scripts
and pnpmfile disabled, downloading no packages. Final normal Node resolution
cannot load the old loader/core-utils chain. At that post-cleanup checkpoint,
the registry audit no longer reported the esbuild advisory; MapLibre still
blocked the security gate before the subsequent v6 migration.

The new eight-case toolchain regression executes real CJS/ESM CLI and public
API paths, aliased TypeScript config/schema imports, generate/check/export,
unchanged second generation, and the real project schema with output confined
to a temporary directory. It also rejects nonzero exits and error diagnostics
with zero exits. The seven behavioral cases passed before and after cleanup;
the eighth, actual dependency absence, only passed after the installation was
repaired. This verifies configuration and SQL generation, not PostgreSQL
execution, every optional driver, Bun/Deno or cross-platform compatibility.

The first real Next 16.3.3 build compiled successfully but the overall command
failed: the file-restoration guard rejected the newly generated
`root-params.d.ts` import. The compatibility update admits only the exact,
ordered routes/root-params pair in the same allowlisted generated directory,
keeps legacy output restorable, and rejects extra strict-route declarations.
Tests use the installed Next generator in isolated directories. The subsequent
real production build and offline screenshot Demo's controlled dev shutdown
both completed successfully; readback preserved the current type-entry bytes
and mode. The failed first build remains a failure, not passing evidence.

When updating overrides, preserve the reviewed install-execution policy and
synchronize the workspace hash, install-boundary script hash, CI references, and
verifier contract. Update the actual installation as well as the lockfile, then
rerun the required checks. Do not relabel historical evidence or add exceptions
to make this gate pass.

### Historical remediation (2026-09-03)

That audit initially found four `fast-uri@3.1.5` high advisories through the
`shadcn` CLI dependency chain. The lock was remediated to `fast-uri@3.1.6`; no
exception was added. The former zero-high/critical result is a dated historical
observation, not the current security status.

The weekly audit is a discovery mechanism, not a substitute for this register.
When the audit reports a new high advisory, the workflow output must be reviewed
and this table updated or the dependency fixed before unrelated release work.

The application directly decodes untrusted chat images with `sharp`. Both the
direct dependency and Next.js optional dependency are now pinned through the
pnpm override to `sharp@0.35.4`. The earlier `0.35.3` pin was affected; a
runtime-reachable image decoder advisory may not be accepted as a build-only
exception.

The same workspace override file narrowly replaces only the vulnerable locked
versions of PostCSS, brace-expansion, fast-uri, js-yaml, and nanoid with the
same-major releases selected in earlier remediations. Those selections still
require current advisory review. The earlier two explicit fast-uri selectors covered both the
previous `3.1.4` lock and the subsequently selected `3.1.5`; both resolved to
`3.1.6`, which remediated the four 2026-09-02 high advisories. The current
2026-09-29 review above supersedes that patch selection. This keeps
upstream dependency ranges observable: if a future lockfile selects a different
vulnerable version, the override will not silently cover it and the audit gate
will fail again.
