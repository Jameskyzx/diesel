# Development history evidence

> Status: local, unpublished archive. The 2026-08-20 secret-scan claim remains
> an operator record without its raw report. A separate 2026-09-05 scan now has
> repository-contained logs, reports, and a manifest; these preserve a dated
> observation, not a current scanner replay or signed source attestation.
> Separately retained dependency records cover the historical locked identities,
> but are not full-text license review or redistribution approval. The
> public-redistribution license gate remains blocked. The canonical, deployable
> code line is `master`.

The public `master` history begins with a consolidated project snapshot. A
separate local branch, `codex/fde-multimodal-global-regulations`, preserves the
earlier incremental implementation history: 50 commits rooted at `a2810e6`.
The two branches have unrelated Git histories, so the archive must never be
merged into, rebased onto, or treated as the release source for `master`.

## Representative milestones

Once the audited archive branch is published, these commits are the shortest
review path through the implementation process:

| Commit | Evidence |
| --- | --- |
| `592d8ed` | First M3 slice: governed publication of signed facts and explicit coverage states. |
| `77eaa07` | M4 user slice: shareable filter URLs, source freshness, loading, empty, and error states. |
| `47c453b` | Follow-up that addresses 16 findings from an adversarial review of the M4 diff. |
| `b50dae6` | Zero-configuration portfolio demo using the real migration and service boundaries. |
| `6be0289` | Simulated persona workflow hardening and the final state of the archived line. |

These milestones are process evidence, not proof that the archived code is
currently secure, deployable, or synchronized with production.

## Publication gate

The archive may be pushed only after all of the following are true:

1. A full-history secret scan passes using the same pinned gitleaks policy as
   CI, including the synthetic-secret canary.
2. Historical binary assets, copied material, and source licenses have been
   reviewed for public redistribution.
3. The remote branch is named `codex/fde-development-history-archive` and is
   labelled in repository documentation as non-canonical and non-deployable.
4. `README.md` links only the representative milestones above and continues to
   identify `master` and `docs/STATUS.md` as the current code and release truth.

If any check fails, the branch remains local and the failed item is documented;
the history must not be published merely to improve the portfolio narrative.

### 2026-09-12 bounded material review

The [dated human-review summary](evidence/fde-development-history-human-review-2026-09-12.md)
now preserves the completed local map/component, visual, nine-source market-policy
and selected dependency-body observations. Only the summary is retained here;
original local reports, upstream text copies and inspection archives are not
bundled with it. It is not a license grant, complete rights review, new scanner
run or publication approval. The five existing blockers remain unchanged.
Release-evidence verification binds this document's exact bytes, not its legal
conclusions. The older scan manifests retain their original scopes.

## Replaying the read-only verification

From the canonical `master` worktree, with the authoritative local source ref
still present, run:

```bash
pnpm history:verify
```

The verifier pins the authoritative source ref to full commit
`6be02895643a3fdf8dcee1a5876c5f3d70d03036`, requires both the local archive ref
and its `origin` remote-tracking ref to remain absent, resolves every documented
milestone, recounts all commits and non-merge patches, proves that no merge base
with `master` exists, and rejects source/archive ref mentions outside its static
documentation-and-verifier allowlist. It also validates
`scripts/history/fde-development-history-audit.json`, recomputes from Git objects
that no LICENSE or NOTICE path ever existed in the source history, and checks
every historical `package.json` revision for absent `license` and `licenses`
fields. The v3 artifact keeps publication explicitly blocked and preserves both
2026-08-20 scan claims as historical operator records without their raw reports.
Its separate `retainedSecretScan` entry binds the 2026-09-05 manifest and permits
recomputation of the saved log/report checks. `retainedDependencyLicenseScan`
separately binds the dated dependency evidence below. The bounded raw-data
decoder treats retained scripts and paths only as data: it does not execute
scripts, extract files to recorded paths, install packages, or contact a registry.
The verifier uses only read-only Git commands and does not create, move, publish,
check out, merge, or rebase a ref. A passing result proves the blocking facts and
consistency of the retained outputs; it neither reruns gitleaks or pnpm nor
upgrades the earlier operator claims.

The ordinary `pnpm test` suite does not require or fetch this local-only ref.
It exercises the same contract with an injected read-only Git runner, including
missing-ref and topology-drift failures. The test that reads the real archive
topology runs only when explicitly requested with
`DIESEL_VERIFY_LOCAL_HISTORY=1`; `pnpm history:verify` always performs the
strict real-ref check and exits non-zero when the source ref is unavailable.
Neither path creates or downloads the archive history in CI.

### 2026-08-20 operator audit record

The following is a dated operator record, not a repository-local attestation.
The machine-readable artifact preserves that distinction with
`evidenceLevel: historical-operator-record-only` and `rawReportPresent: false`.

- The official gitleaks 8.21.2 Darwin arm64 archive matched its published
  checksum. With the repository policy and redaction enabled, it reported no
  findings across all 42 non-merge patches reachable from the 50-commit branch;
  the other eight commits are merges. A synthetic-secret canary was detected
  and returned the configured non-zero exit code.
- All six distinct `package.json` / `pnpm-lock.yaml` states installed in
  isolation with pnpm 11.9.0, `--frozen-lockfile`, and `--ignore-scripts`.
  Dependency metadata contained no unknown or strong-copyleft licenses. It did
  include MPL-2.0 components and the optional sharp/libvips binary chain under
  LGPL-3.0-or-later.
- The archived history has no project `LICENSE` or `NOTICE`, no package license
  declaration, and no written policy for weak-copyleft binaries or required
  notices. Dependency metadata scanning therefore passed, but the overall
  public-redistribution license gate did not. The target remote branch was not
  created or pushed.

### 2026-09-05 retained secret-scan record

The [retained manifest](evidence/fde-development-history-secret-scan-2026-09-05.manifest.json)
has evidence level `repository-contained-dated-run-record`. It binds four
saved outputs:

- [History process log](evidence/fde-development-history-secret-scan-2026-09-05.history-log.json)
  and [history findings report](evidence/fde-development-history-secret-scan-2026-09-05.history-report.json).
- [Canary process log](evidence/fde-development-history-secret-scan-2026-09-05.canary-log.json)
  and [canary findings report](evidence/fde-development-history-secret-scan-2026-09-05.canary-report.json).

The retained history invocation exited 0, recorded no scanner error diagnostic,
reported 50 scanner-counted commits, and saved zero findings. The source history
also contains 50 Git commits, but equality in this observation does not make
the two counters interchangeable: empty commits and commits without a textual
fragment can be omitted from the scanner's diagnostic count. Neither count
proves that every commit's content was scanned. The canary exited with the
configured findings code 97 and retained one `github-pat` finding for
`canary.env`, with its secret redacted.

An initial attempt had exited 0 with an empty report while logging
`ERR failed to scan Git repository`; that attempt was invalidated and is not
accepted as a clean scan. The retained record comes from the subsequent run
whose diagnostics and reports were checked together.

The fixed gitleaks 8.21.2 executable remains an external tool and is not vendored
in this repository. Recomputing the saved output checks establishes record
consistency; it is not a current replay, an authenticated source signature,
per-commit coverage proof, or a license approval. It also does not reconstruct
the missing 2026-08-20 raw evidence. The archive remains unpublished: missing
project `LICENSE`, `NOTICE`, and package license fields, unfinished historical
asset/copied-material review, and the weak-copyleft/notice policy still block
public redistribution.

### 2026-09-05 retained dependency-license record

The [dependency manifest](evidence/fde-development-history-dependency-licenses-2026-09-05.manifest.json)
binds a [bounded gzip JSON/base64 data record](evidence/fde-development-history-dependency-licenses-2026-09-05.raw.json.gz)
containing 810 files: the original bundle's 807 inventoried files, its manifest,
README, and packaging script. Raw inputs, capture scripts, process receipts,
stdout/stderr, run manifests, and the completed install's policy journal retain
their original bytes. The original README describes the collection-time local
bundle; its statement that it was not yet integrated is a dated record, not the
current repository integration status.

- Six distinct historical input tuples represent three dependency graphs. All
  six isolated, frozen installs completed with Node 22.22.3 and pnpm 11.9.0;
  twelve raw license reports cover production-only and all dependencies for
  Darwin arm64. The all-dependency reports contain 680, 681, and 682 unique
  package-version identities across the three graphs.
- Exact-version public registry queries supplement the same 175 identities
  omitted from each platform report. Every returned name, version, and integrity
  string matches its lockfile entry. Combined with the platform reports, these
  account for all 855, 856, and 857 locked identities, respectively. Of the 175,
  166 have incompatible platform constraints; nine are indirect dependencies of
  omitted optional WebAssembly packages, not directly incompatible packages.
- The two evidence sources remain distinct: pnpm's platform license metadata
  and registry-declared metadata for the additional versions. Neither is a
  license-text or bundled-content inspection, a cross-platform installation,
  legal approval, or authenticated tool-origin proof. MPL-2.0,
  LGPL-3.0-or-later, and compound Apache/LGPL/MIT declarations remain review
  items; compound expressions must not be reduced to a permissive component.
- Package bodies came from a private cache copy. `--offline` did not prevent
  pnpm from requesting public registry supply-chain metadata; that network
  access was separately authorized. `--ignore-scripts` left native builds
  pending, so completed installs do not prove the historical app runs.
- Failed store-symlink validation, an offline-metadata timeout, and a numeric
  registry-parameter failure are retained as failures. The earlier license-only
  attempt remains installation-unverified; synthetic reported paths are not
  evidence of installed files. Only the subsequent completed runs support the
  installation and metadata counts above.

Lengths, hashes, strict parsing, and set comparisons support record consistency,
not signatures or a fresh scan. Package bodies, stores, and tool/runtime binaries
are not vendored. The 2026-08-20 claims remain unchanged, and all five publication
blockers remain: missing project LICENSE, NOTICE, and package license fields;
incomplete historical asset/copied-material review; and a missing approved
weak-copyleft/notice policy. No archive publication is authorized by this record.

### 2026-09-06 local historical map-origin review

A read-only comparison covered all three `public/geo/world-countries.geojson`
blobs reachable from the fixed archive tip. It fetched only the pinned Natural
Earth revision `ca96624a56bd078437bca8184e78163e5039ad19` and verified the Git
object identities for its
[license](https://github.com/nvkelso/natural-earth-vector/blob/ca96624a56bd078437bca8184e78163e5039ad19/LICENSE.md),
[1:110 million countries](https://github.com/nvkelso/natural-earth-vector/blob/ca96624a56bd078437bca8184e78163e5039ad19/geojson/ne_110m_admin_0_countries.geojson),
and [1:10 million countries](https://github.com/nvkelso/natural-earth-vector/blob/ca96624a56bd078437bca8184e78163e5039ad19/geojson/ne_10m_admin_0_countries.geojson)
files before comparing geometry and names:

- V1 has 174 features; every geometry matches the pinned 1:110 million source.
  156 names match `NAME` and 18 match that same source feature's `NAME_EN`.
- V2 adds Singapore with the exact pinned 1:10 million geometry and a
  five-point rectangular Liechtenstein placeholder. The placeholder matches
  neither pinned source scale. That version's README disclosed only Singapore
  as a 1:10 million exception while still describing geometry as unchanged.
- V3 adds Malta and replaces Liechtenstein; Singapore, Liechtenstein, and Malta
  now match the exact pinned 1:10 million features, while the other 174
  geometries remain the exact 1:110 million subset. Its README explicitly says
  that the former Liechtenstein placeholder was not a source feature.

All three lightweight indexes have the same unique ISO3/name set as their
corresponding geometry file. The V2 omission is therefore a historical
provenance defect, not an index mismatch. V2 and V3 also retain a collection
`name` that says only `1:110m` despite their mixed-scale content.

The fixed upstream license states that Natural Earth raster and vector map data
are public domain. This is a dated public-source observation, not a legal
opinion or authenticated source signature. The comparison report remains in
local temporary evidence rather than being promoted into the repository, so it
does not clear the manual material-review blocker or authorize archive
publication. The historical V2 object is preserved rather than rewritten.

---

# 开发历史证据

> 状态：本地、未发布归档。2026-08-20 的密钥扫描结论仍是没有原始报告的操作记录。
> 另一次 2026-09-05 扫描现已在仓库中保留日志、报告与 manifest；这些保存的是特定日期的
> 观察，不代表当前重新执行扫描或带签名的来源证明。另行留档的依赖记录覆盖历史锁定
> 身份，但不等于许可证全文审阅或再分发批准。公开再分发许可证门仍处于阻断状态；
> 唯一可部署的规范代码线仍是 `master`。

公开 `master` 以一次项目快照开始；本地分支
`codex/fde-multimodal-global-regulations` 保留了更早的 50 个增量提交，根提交为
`a2810e6`。两条分支的 Git 历史互不相关，因此不得把归档分支合并或 rebase 到
`master`，也不得把它作为生产 release 来源。

归档发布前必须通过与 CI 相同的全历史密钥扫描、历史资产与许可证复核，并以
`codex/fde-development-history-archive` 发布。README 只链接上表中的代表性里程碑，
同时明确这些提交证明的是迭代过程，不代表旧代码仍然安全、可部署或与生产一致。
任何检查失败时都应保持本地归档并记录原因，不能为了作品叙事强行公开。

### 2026-09-12 有限材料审查摘要

[日期化人工审查摘要](evidence/fde-development-history-human-review-2026-09-12.md)
现已保留地图/组件、视觉素材、九项市场来源政策及选定依赖包体的本地观察。入库的是
摘要，不包含原始临时报告、上游全文副本或下载包体；它不是许可证授权、完整权利审阅、
重新扫描或归档发布批准。既有五项阻塞不变，发布证据校验只绑定摘要的提交字节，不验证
法律结论；旧扫描 manifest 的证据范围也不变。

可在保留权威本地 source ref 的 `master` 工作树中运行 `pnpm history:verify`
重放只读校验。该命令会把权威 source ref 锁定到完整 SHA
`6be02895643a3fdf8dcee1a5876c5f3d70d03036`，要求本地 archive ref 及其 `origin`
remote-tracking ref 均不存在，重新解析里程碑、统计总提交与非 merge
补丁、证明它与 `master` 没有 merge base，并检查 source/archive ref 只能出现在静态
白名单路径中。它还会校验 `scripts/history/fde-development-history-audit.json`，从 Git
对象重算整个 source 历史从未出现 LICENSE/NOTICE 路径，并逐个检查所有历史
`package.json` 状态均无 `license`/`licenses` 字段。v3 机器 artifact 明确保持禁止发布，
保留两项 2026-08-20 扫描为缺少原始报告的历史操作记录；另设 `retainedSecretScan`
绑定 2026-09-05 manifest，并重算已保存日志与报告的检查结果。
`retainedDependencyLicenseScan` 单独绑定下文的日期化依赖证据。有界原始数据解码器只把
留档脚本与路径作为数据，不执行脚本、不向记录路径解压文件、不安装包，也不联系 registry。
命令只使用只读 Git 操作，不会创建、移动、发布、checkout、merge 或 rebase 任何 ref；
通过证明的是阻断事实和已保存输出的一致性，不会重新运行 gitleaks 或 pnpm，也不会提升
先前操作记录的证据等级。

普通 `pnpm test` 不要求也不会拉取这个仅存在于本地的 ref；它通过注入的只读 Git
runner 覆盖相同契约，包括 ref 缺失和拓扑漂移的失败语义。只有显式设置
`DIESEL_VERIFY_LOCAL_HISTORY=1` 时，Vitest 才读取真实归档拓扑；
`pnpm history:verify` 则始终严格检查真实本地 ref，source ref 不存在时明确以非零码
退出。CI 中的两条路径都不会创建或下载归档历史。

2026-08-20 操作审计记录（不是仓库内可重放的证明；machine artifact 使用
`evidenceLevel: historical-operator-record-only` 与 `rawReportPresent: false` 标明此
限制）：官方 gitleaks 8.21.2 二进制 checksum 一致；50 个提交中 42 个
非合并补丁全部扫描且无命中，另 8 个为 merge，合成 secret canary 能正确失败。六个
不同依赖快照均使用 pnpm 11.9.0、frozen lockfile 和 ignore-scripts 在隔离目录安装并
生成许可证清单；Unknown 与强 copyleft 均为 0，但存在 MPL-2.0 组件及
LGPL-3.0-or-later 的可选 sharp/libvips 二进制链。该历史从未包含项目 LICENSE、NOTICE、
package license 字段或弱 copyleft/NOTICE 政策，因此第三方依赖元数据扫描通过，但公开
再分发总门禁不能判为通过；目标远端 archive 分支未创建、未推送。

### 2026-09-05 已留档密钥扫描记录

[留档 manifest](evidence/fde-development-history-secret-scan-2026-09-05.manifest.json)
的证据等级为 `repository-contained-dated-run-record`，绑定以下四份已保存输出：

- [历史扫描进程日志](evidence/fde-development-history-secret-scan-2026-09-05.history-log.json)
  与[历史扫描发现报告](evidence/fde-development-history-secret-scan-2026-09-05.history-report.json)。
- [Canary 进程日志](evidence/fde-development-history-secret-scan-2026-09-05.canary-log.json)
  与[Canary 发现报告](evidence/fde-development-history-secret-scan-2026-09-05.canary-report.json)。

留档的历史扫描调用退出码为 0，没有 scanner 错误诊断，日志记录 50 个 scanner-counted
commits，保存的发现数为 0。源历史也有 50 个 Git 提交，但这次数字相同不代表两种计数
可以互换：空提交或没有文本片段的提交可能不进入 scanner 的诊断计数；任何一种计数
都不能证明每个提交的内容均已扫描。Canary 以约定的 findings 退出码 97 结束，报告保留
`canary.env` 的一条 `github-pat` 命中，secret 已脱敏。

首次尝试曾在退出 0、报告为空的同时记录 `ERR failed to scan Git repository`，该尝试已
作废，不算作无问题扫描。留档记录来自随后同时核对诊断日志与报告的那次运行。

固定版本 gitleaks 8.21.2 可执行工具仍在仓库外，未 vendor 到项目中。重算保存输出只证明
记录一致性，不等于当前重放、经过认证的来源签名、逐提交扫描覆盖证明或许可证通过，
也不能重建缺失的 2026-08-20 原始证据。归档仍未发布：项目 LICENSE、NOTICE、package
license 字段缺失，历史资产/复制材料人工复核未完成，弱 copyleft/NOTICE 政策也仍待明确，
这些条件继续阻止公开再分发。

### 2026-09-05 已留档依赖许可证记录

[依赖 manifest](evidence/fde-development-history-dependency-licenses-2026-09-05.manifest.json)
绑定一份[有界 gzip JSON/base64 数据记录](evidence/fde-development-history-dependency-licenses-2026-09-05.raw.json.gz)，
包含 810 份文件：原证据包清单中的 807 份文件，以及原 manifest、README 与打包脚本。
原始输入、采集脚本、进程回执、stdout/stderr、运行 manifest 和成功安装的 policy journal
均保留原始字节。原 README 描述的是采集时的本地证据包；其中“尚未集成”的措辞是日期化
记录，不代表目前的仓库集成状态。

- 六个不同历史输入状态对应三张依赖图。使用 Node 22.22.3 和 pnpm 11.9.0 的六次隔离、
  frozen 安装全部完成；十二份原始许可证报告分别覆盖 Darwin arm64 平台的生产依赖与
  全部依赖。三张图的全部依赖报告分别包含 680、681、682 个唯一包版本身份。
- 精确版本的公开 registry 查询补齐各平台报告遗漏的同一组 175 个身份；返回的包名、版本
  和完整性摘要均与锁文件条目一致。两类记录合并后分别覆盖全部 855、856、857 个锁定身份。
  其中 166 项具有不兼容的平台约束，另外九项是被裁剪的可选 WebAssembly 包的间接依赖，
  不能把九项也说成直接不兼容的包。
- 两种证据保持区分：pnpm 当前平台许可证元数据，以及补查版本的 registry 声明元数据。
  二者都不是许可证全文或包内材料审阅、跨平台安装、法律批准或工具来源认证。
  MPL-2.0、LGPL-3.0-or-later 与 Apache/LGPL/MIT 复合声明仍需审阅；不得把复合表达式
  简化为其中的宽松许可部分。
- 包体来自私有缓存副本。`--offline` 没有阻止 pnpm 请求公开 registry 的供应链元数据；
  该联网访问另行获批。`--ignore-scripts` 留下尚未完成的原生构建，因此安装完成不证明
  历史应用可以运行。
- store 符号链接校验失败、离线元数据超时以及 registry 数值参数类型错误均作为失败留存。
  较早的仅许可证查询仍明确为 installation-unverified；合成报告路径不证明存在安装文件。
  只有后续完成的运行支撑上述安装和元数据计数。

长度、哈希、严格解析与集合比较支持记录一致性，不等于签名或重新扫描；仓库没有 vendor
包体、store 或工具/运行时二进制。2026-08-20 的旧结论不变，五项发布阻塞也全部保留：
项目 LICENSE、NOTICE、package license 字段缺失，历史资产/复制材料人工审阅未完成，
且没有经批准的弱 copyleft/NOTICE 政策。这份记录不授予归档发布许可。

### 2026-09-06 本地历史地图来源复核

本次只读比较覆盖固定归档 tip 可达的三版
`public/geo/world-countries.geojson`。联网读取范围仅为 Natural Earth 的固定提交
`ca96624a56bd078437bca8184e78163e5039ad19`；在比较几何和名称前，先校验其
[许可证](https://github.com/nvkelso/natural-earth-vector/blob/ca96624a56bd078437bca8184e78163e5039ad19/LICENSE.md)、
[1:110 million 国家数据](https://github.com/nvkelso/natural-earth-vector/blob/ca96624a56bd078437bca8184e78163e5039ad19/geojson/ne_110m_admin_0_countries.geojson)
及[1:10 million 国家数据](https://github.com/nvkelso/natural-earth-vector/blob/ca96624a56bd078437bca8184e78163e5039ad19/geojson/ne_10m_admin_0_countries.geojson)
的 Git 对象身份。

- V1 有 174 个 feature，几何全部精确匹配固定的 1:110 million 来源；156 个名称匹配
  `NAME`，另外 18 个匹配同一来源 feature 的 `NAME_EN`。
- V2 新增的新加坡精确匹配固定的 1:10 million 几何，但列支敦士登是五点闭合矩形
  placeholder，与固定提交中两个尺度的来源均不匹配。该版 README 只披露新加坡使用
  1:10 million，却仍笼统声明几何未改变。
- V3 新增马耳他并替换列支敦士登；新加坡、列支敦士登和马耳他均精确匹配固定的
  1:10 million feature，其余 174 个几何仍是精确的 1:110 million 子集。该版 README
  明确承认旧列支敦士登 placeholder 不是来源 feature。

三版轻量 index 都与对应 GeoJSON 的唯一 ISO3/名称集合完全一致，因此 V2 的问题是历史
来源说明缺陷，不是 index 错配。V2 与 V3 的 FeatureCollection `name` 仍只写 `1:110m`，
也没有表达实际混合尺度。

固定上游许可证声明 Natural Earth 的 raster 与 vector 地图数据属于 public domain；这里
只记录特定日期的公开来源观察，不构成法律意见或经认证的来源签名。比较报告保留在本地
临时证据中，没有提升为仓库发布证据，因此不会解除材料人工复核 blocker，也不授权发布
归档。历史 V2 Git 对象按原样保留，不回写修正。
