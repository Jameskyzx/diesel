# Project status / 当前项目状态

这是 README、部署文档和历史任务记录之间的当前状态索引。历史 ADR 和任务日志保留
当时的计数，不回写历史；判断“现在是什么状态”时以本文件、代码 fixture 和运行库
接口为准。

## Verifiable portfolio snapshot / 可验证作品快照

This machine-readable block is the single current source for the observed
repository/public-runtime lineage, the last fully documented timestamped
release, Vitest execution-evidence pointer, browser-run artifact, live-eval contract and
public evidence summary. `pnpm portfolio:verify` resolves every recorded Git SHA without making
network requests, checks the recorded lineage and canonical release/evidence
prose for internal consistency and uniqueness outside comments/code fences,
requires the checked-in CI workflow to retain the exact final merge-blocking
job inventory, evidence-producing `quality` job and fail-closed
`Required CI gate` block,
validates the canonical Vitest execution artifact, independently lists its current test
inventory and recomputes its source fingerprint, recomputes the fixture closure and approval manifests, and
validates the retained history secret-scan outputs and bounded dependency-license
archive. The latter recomputes six completed installs, twelve platform reports,
and 175 registry declarations while keeping redistribution explicitly blocked. It also
recalculates the persisted live-eval summary and judgements from its case-level
fields. It strictly parses the canonical four-run Playwright artifact, closes
per-project/run totals, verifies its STATUS hash/byte mirror, and recomputes the
current browser-source fingerprint. It also requires the latest report to byte-match its archive and be the
newest canonical modern archive by `(evaluatedAt, runId)`; only five named
pre-run-ID legacy files are excluded. It cannot replay discarded model text or
raw tool results. The optional `pnpm portfolio:verify -- --release-evidence`
mode additionally requires the portfolio documents, latest/archive pair,
browser artifact, screenshot manifest and its two assets to be tracked and
byte-identical across HEAD, index and worktree. That mode is wired into CI and
intentionally fails for merely local or staged evidence.

<!-- portfolio-verification:start -->
```json
{
  "browserSnapshot": {
    "artifactByteLength": 177128,
    "artifactPath": "docs/evidence/playwright-e2e-latest.json",
    "artifactSha256": "c7d4dfabbc50ac2ac84059740a9ae8ad61279ca1cd268a916725fc215c147aa9",
    "baseHeadCommit": "0be6898790b891fbc59fe40b61305cd558bbbc13",
    "evaluatedCommit": "0be6898790b891fbc59fe40b61305cd558bbbc13",
    "observedAt": "2026-09-29T11:48:37.615Z",
    "runId": "4d17260d-5cfd-479c-9e40-8cfd837cca77",
    "runs": [
      {
        "collected": 413,
        "failed": 0,
        "flaky": 0,
        "passed": 348,
        "skipped": 65,
        "id": "public"
      },
      {
        "collected": 68,
        "failed": 0,
        "flaky": 0,
        "passed": 68,
        "skipped": 0,
        "id": "demo"
      },
      {
        "collected": 4,
        "failed": 0,
        "flaky": 0,
        "passed": 2,
        "skipped": 2,
        "id": "fde"
      },
      {
        "collected": 2,
        "failed": 0,
        "flaky": 0,
        "passed": 2,
        "skipped": 0,
        "id": "production-csp"
      }
    ],
    "sourceFingerprint": {
      "algorithm": "sha256",
      "digest": "6a443085ca4a0ff58f15fced062e16206aaf7791b384ac608bfe814d8e3ad521",
      "fileCount": 344
    },
    "version": "diesel-playwright-evidence-v1",
    "worktreeState": "clean"
  },
  "currentPublicRelease": {
    "commit": "5b35ced1e6e52ca1df9fec9d46f355b73b033ec6",
    "evidenceKind": "historical-operator-record-only",
    "id": "5b35ced1e6e52ca1df9fec9d46f355b73b033ec6",
    "observedAt": "2026-08-20T01:29+08:00",
    "releasePath": "/opt/diesel/releases/5b35ced1e6e52ca1df9fec9d46f355b73b033ec6"
  },
  "evidenceSummary": {
    "approvedRealCertifications": 0,
    "approvedRealProducts": 0,
    "jurisdictions": 97,
    "limits": 651,
    "regulations": 28,
    "sources": 203
  },
  "liveEval": {
    "archivePath": "docs/evals/archive/ai-live-eval-20260929T121241562Z-4813db2e-a696-47f1-a4e6-bf8335389f89.json",
    "attemptCount": 37,
    "complete": true,
    "completedCount": 37,
    "evaluatedAt": "2026-09-29T12:12:41.562Z",
    "expectedModelId": "server-openai-compatible/deepseek-flash",
    "expectedProviderProfile": {
      "adapter": "@ai-sdk/openai-compatible",
      "adapterContractVersion": 4,
      "enableThinking": false,
      "endpointSha256": "a34e2a4708ed1c61008a151688838dcf1c44d4e7f08054633e72ba7c0b16cfc1",
      "includeUsage": true
    },
    "latestOutcome": "passed",
    "latestSampleCount": 18,
    "modelStepCount": 37,
    "reportVersion": "sales-chat-live-v25",
    "runError": null,
    "runId": "4813db2e-a696-47f1-a4e6-bf8335389f89",
    "sourceFingerprint": {
      "algorithm": "sha256",
      "digest": "dbe1b2a111925e794e1f82aaa2d736b516ae2c93e13f1a10840bd0acd9535865",
      "fileCount": 298,
      "status": "captured"
    },
    "suiteVersion": "sales-chat-live-v25",
    "suiteCaseCount": 18,
    "terminationReason": "completed",
    "thresholdsPassed": true,
    "tokenUsageComplete": true,
    "totalTokens": 97047
  },
  "lastDocumentedRelease": {
    "commit": "38541ac8201e260934fe9eeaab571d2c8a4262ee",
    "id": "20260814144537"
  },
  "publicRuntime": {
    "evidenceKind": "historical-operator-record-only",
    "readbackAt": "2026-08-20T01:29+08:00",
    "status": "ok",
    "version": "5b35ced1e6e52ca1df9fec9d46f355b73b033ec6"
  },
  "qualitySnapshot": {
    "artifactPath": "docs/evidence/vitest-execution-latest.json",
    "version": "diesel-vitest-execution-evidence-v1"
  },
  "repositoryHead": {
    "local": "5b35ced1e6e52ca1df9fec9d46f355b73b033ec6",
    "observedAt": "2026-08-20T01:29+08:00",
    "remote": "5b35ced1e6e52ca1df9fec9d46f355b73b033ec6"
  }
}
```
<!-- portfolio-verification:end -->

The 178 ISO3 entries are a country directory and published evidence boundary,
not a claim that all 178 countries have numerical diesel limits.

## 状态日期

- 2026-09-29 12:08 UTC：冻结 `d68f46d` 的全量运行真实失败：8,056 passed / 5 skipped /
  1 failed，失败为活动用例进度集成回归。六次独立诊断均通过，不能据此消除完整运行失败。
  安装源码中的 Vitest throttle 在 99/100ms 回调边界保留过期 handle；可控时钟直接执行
  实际依赖函数复现两项失败。现仅以锁定补丁在回调前清除 handle，三项边界回归及原集成
  测试通过，所有断言和期限不变。不声称解释所有历史波动；依赖输入变化要求重新采集
  受影响截图、真实 eval、浏览器和完整 Vitest，尚未推送或部署。旧远端 `5239b02` 的公共
  浏览器和生产 CSP 已完整通过，但 Linux/Demo 失败仍使 Required CI gate 失败。
- 2026-09-29 11:49 UTC：候选 `0be6898` 的四套浏览器重采完成，420 passed /
  67 skipped / 0 failed / 0 flaky；修复后的中英文、桌面/移动 Demo 用例均首试通过。
  lint、typecheck、build 和 57 项定向回归通过。现在冻结源码、文档和浏览器证据进行
  全量 Vitest 重采；仍须新候选远端门禁和正式部署，不把本地结果视为上线。
- 2026-09-29 11:35 UTC：继续修复尚未通过的 Linux 交接：隔离 fixture 现按正式 ledger
  流程创建回滚基线、持有 FD 8 生命周期锁并进入真实 PENDING，不跳过生产合同。
  同一候选 Demo CI 为 67 passed / 1 flaky（首试卡片超时、重试通过），仍是失败。
  trace 确认测试专用缓冲传输约 4.5 秒；仅为该传输增加完成同步后再开始原卡片断言，
  不放宽单例/断言时限。本轮仍须重采浏览器与完整测试证据并通过远端门禁，生产未切换。
- 2026-09-29 11:25 UTC：候选 `5239b02` 的远端质量、数据库、安全与部署契约通过，
  Linux 实际交接的后台子进程和退出码 23 canary 均通过；SIGTERM canary 仍失败。
  VPS 隔离诊断确认正常退出与 SIGTERM 都可为 `active/exited` 且 cgroup 已回收。
  空 cgroup 规则现覆盖两种明确终态并继续要求路径消失，回归直接验证保留 0、23、143。
  诊断均清理完成；最初内联信号探测只产生 exit 1，不作为原始信号证据。新修复仍须
  全量测试和远端交接通过。旧版 readiness 在 11:03 一次 503 后于 11:04 独立读回 200，
  数据库探针约 1.25 秒；未通过重启或改配置掩盖这一间歇性观察，生产仍未切换。
- 2026-09-29 10:58 UTC：预算调整后的英文截图已核验并绑定源码，真实模型结果已写入
  下方唯一评估台账；完整四套浏览器重采为 420 passed / 67 skipped / 0 failed /
  0 flaky，生产构建与 CSP 检查通过。当前正在冻结全部证据并重采最终 Vitest，尚未
  推送此修复链、通过新的远端 CI 或切换生产。
- 2026-09-29 10:40 UTC：候选 `78e75f2` 的公共浏览器 CI 真实结果为 272 passed /
  18 skipped / 123 did not run；25 分钟 suite 和 teardown 总超时导致失败，没有已失败
  断言。仅把完整矩阵预算改为 50 分钟、任务上限 60 分钟，保留每例时限、重试、单 worker
  和全部项目。cgroup 修复后的完整 Vitest 已通过 8,052 passed / 5 skipped；新的 CI
  合同修改会改变证据指纹，须重采受影响证据后再推送并等待远端验证，生产仍未切换。
  上述是 Playwright 控制台计数；保留的逐例 failure diagnostic 独立汇总为
  272 passed / 19 skipped / 122 notRun，并明确标记 timedout、2 global errors、退出码 1。
  两种终止时观察均保留，不将其中任何一种当作完整通过证据。
- 2026-09-29 10:27 UTC：cgroup 修复的聚焦运行中新增 8 项通过，lint、typecheck 和
  build 通过。整组部署回归为 541 passed / 4 skipped / 44 failed；44 项共享失败原因
  是执行沙箱拒绝本地 HTTP fixture 的 `127.0.0.1` 监听（`listen EPERM`），不能记为
  应用验证成功。保留失败日志，完整证据采集须在允许本地测试端口的环境重新执行，
  不修改或跳过测试断言。
- 2026-09-29 10:16 UTC：候选 `78e75f2` 的远端应用覆盖率/构建、数据库、部署契约、
  安全审计、Demo 与 FDE 浏览器任务已通过，public Playwright 尚在运行。Linux 实际
  交接已通过后台子进程 canary，但退出码 canary 把已回收 cgroup 的失败终态误判为身份
  漂移；独立 VPS 无密钥诊断复现 `failed/failed`、空 `ControlGroup`、原始退出码 23，
  诊断单元及进程均已清理。修复只接受已证明 cgroup 不存在的这一终态，仍需完整回归
  和新远端门禁；没有切换生产或写入候选模型密钥。此前全量报告器复验已通过，旧失败
  记录保留；本次发布脚本改动要求重新生成全量 Vitest 证据。
- 2026-09-29 09:50 UTC：测试准备修复后的首次全量采集为 8,043 passed / 5 skipped /
  1 failed，唯一失败位于报告器活动心跳的子进程回归；旧成功 artifact 未替换。该测试随后
  独立一次及正式采集器相同隔离环境下连续三次均通过，尚未确定此次失败的唯一原因。
  保留失败操作日志，不修改报告器断言、时限或结果；后续完整采集仍须独立通过。
- 2026-09-29 09:27 UTC：候选 `4d81aa4` 的远端数据库、安全和部署契约通过；应用覆盖率
  测试仅一项触发默认 5 秒超时，下游未运行。七工具结果集成测试此前还包含首次 PGlite
  WASM、迁移与 seed 初始化；该准备工作现移到 `beforeAll`，保留原测试超时和所有断言。
  本地完整应用覆盖率复验为 7,290 passed / 1 skipped，语句 91.86%、分支 87.42%，
  既定门槛通过。须重采全量测试并通过远端门禁后才能部署，未把原超时记为通过。
- 2026-09-29 09:04 UTC：最终英文截图与源码绑定后的四套浏览器收据已采集，
  420 passed / 67 skipped / 0 failed / 0 flaky，生产构建及 CSP 检查通过。全量 Vitest
  收据须以此干净提交重新生成；远端 CI 与 VPS 新版本发布尚未完成。
- 2026-09-29 08:51 UTC：候选 `dd43612` 已推送；远端 PostgreSQL、依赖/密钥审计和
  Linux 脚本契约通过，质量门检出旧正文断言、台账重复陈述和截图源码漂移，下游交接未运行。
  本地四套浏览器为 420 passed / 67 skipped / 0 failed / 0 flaky。正文断言现精确比较
  含服务端日期的公开文本，文档只在唯一台账记录当前模型结果，240 项相关回归通过。
  英文截图已重新采集并视觉检查；截图改变 public 指纹，最终浏览器及 Vitest 证据须重采。
- 2026-09-29 08:37 UTC：日期消息块修复已提交；真实模型结果只见下方唯一评估台账，
  历史失败报告原样保留。构建及完整历史密钥扫描通过；浏览器与全量 Vitest 证据重采中，
  仍不代表远端 CI 或生产发布完成。
- 2026-09-29 08:34 UTC：日期脚注首次浏览器复验暴露额外 Markdown 块回归；public
  348 passed / 65 skipped，Demo 36 passed / 32 failed，采集正确以 1 退出且未替换旧成功证据。
  现将已验证日期合并到原回答末尾，不改变证据门或 case 期望；295 项定向测试、lint、
  typecheck 与桌面/移动端 Demo 68 项均通过。完整浏览器、Vitest 和真实模型证据仍待重采。
- 2026-09-29 08:16 UTC：历史 live eval 曾因销售简报正文遗漏日期而失败，历史报告
  原样保留。服务端公开边界只在完整证据校验通过后，从工具的 `informationAsOf` 补齐
  本地化日期，不改 case 期望或门槛。323 项定向回归及 lint/typecheck/build 通过。
  浏览器与全量 Vitest 证据仍需更新至本次代码，远端 CI 与生产发布尚未完成。
- 2026-09-29 08:07 UTC：备份失败已定位为 8 条旧产品归档审计的二次编码 JSON 对象。
  候选修复只让恢复快照无损保留此历史格式；74 项快照定向测试、lint、typecheck 和 build
  已通过，未修改生产数据库。只读十表快照已在工作站成功导出并通过 SHA/dry-run 校验，
  40,139,956 bytes 原样复制至 VPS root-only 审计目录且哈希一致；它不是完整 PostgreSQL
  备份。须在经 CI 批准的候选提交上再次验证才可迁移协议。新本地四套浏览器证据为
  420 passed / 67 skipped / 0 failed / 0 flaky；全量 Vitest 与远端 Required CI gate 待完成。
  当前生产 SHA、环境文件、旧备份根均未切换，未轮换模型密钥尚未写入生产候选环境。
- 2026-09-29 07:50 UTC：发布候选 `e5b390d` 的远端 CI 质量、Linux 脚本契约、
  PostgreSQL、secret/dependency checks 与 FDE 浏览器验收通过；Required CI gate 仍失败。
  Linux 实际交接演练未通过，public Playwright 达到 job 超时，Demo 的 68 项断言虽通过，
  但未忽略的生成 HTML 导致证据工作区校验失败。候选修复保留全部门禁和断言，须经新 CI
  验证，不将本地结果替代远端通过。最新本地四套浏览器结果为 420 passed / 67 skipped /
  0 failed / 0 flaky。旧生产 SHA 与旧备份根均未切换；fresh 数据库恢复快照尚未取得，
  正在只读排查，失败的备份文件不作为恢复证据。用户授权临时部署现有未轮换模型密钥，
  不等同于密钥已轮换，也不等同于部署已经完成。
- 2026-09-29 06:03 UTC：发布候选的真实 PostgreSQL CI 已通过；Linux 应用覆盖率与构建
  也已通过，当前 CI 仍被尚待重新采集的 Vitest 证据计数拦住，不能视为 gate 成功。
  本地最新四套浏览器验收为 420 passed / 67 skipped / 0 failed / 0 flaky；此前一次
  native modified-click 新标签页超时保留在操作日志中，单独复现及连续五轮均通过，未删断言。
  用户已授权 Diesel 与 `jamesky-api` 的短暂维护；PM2/systemd 固定路径迁移完成，两服务
  均恢复 online、原端口与 HTTP 读回匹配。旧应用 SHA 未切换；15 个旧备份目录、68 个文件
  的独立副本已逐文件核对，历史材料不声明为已完成 V1 事务。此记录不是新版本上线声明。
- 2026-09-29：网络恢复后的官方依赖审计发现 fast-uri 3.1.6 两项新增高危；
  已精确升级到 3.1.7 并同步安装边界和 CI 摘要链，实际安装路径 12 条回归通过。
  安全门禁现为零高危、零严重，仍有 3 项中危，详见 `DEPENDENCY_SECURITY.md`。
  未新增风险豁免、依赖、schema 或业务行为；新锁文件的完整证据需重新采集。
  此记录不是远端 Required CI gate 或生产部署成功声明。
- 代码与本地数据基线：2026-08-11；稳定 33 国数据纠错已通过本地 fixture 验收，见
  `ACCEPTANCE.md` #166–#198 与 ADR-126/127；MAR/KEN source-only currentness
  纠错已签核为 #199–#200 与 ADR-128，QAT/KWT/OMN/JOR source-only currentness
  纠错已签核为 #201–#204 与 ADR-129，IRN/IRQ/LBN/SYR source-only currentness
  纠错已签核为 #205–#208 与 ADR-130；GUY/HTI/JAM/BLZ/CUB 至
  CAF/COD/COG/GIN/DJI 的七批 35 国 source-currentness 已签核为 #209–#243 与
  ADR-131。MAR/KEN/QAT/KWT/OMN/JOR 使用
  `verifiedAt=2026-08-10T18:48:04Z`，IRN/IRQ/LBN/SYR 使用
  `verifiedAt=2026-08-10T18:55:45Z`；七批新增 refresh 依次使用
  `2026-08-10T19:36:45Z`、`2026-08-10T19:46:12Z`、`2026-08-10T20:09:01Z`、
  `2026-08-10T20:20:37Z`、`2026-08-10T20:39:16Z`、`2026-08-10T20:50:58Z`、
  `2026-08-10T21:00:43Z`。35 国仅 URY 保留既有道路
  1 regulation / 18 limits（底层 regulation `effectiveFrom=2023-05-14`；V5
  publishedOn 纠正为 `2025-11-13`，当前程序版本自 `2025-11-17` 启用）；其余
  34 国四 scope no-data、零 regulation/limit。AUS/PNG/CAN/USA 的 #244–#247 /
  ADR-133 保留当时完整性轨迹；其中 CAN/USA partial 非道路边界已由 #263–#264 /
  ADR-136 supersede。AUS 道路切换为 9→12 条、PNG truck 为 9 条；CAN 当前 target
  48 limits（road 8 + nonroad 40），USA 为 70（road 30 + nonroad 40），两国完整
  §1039 功率带统一 `verifiedAt=2026-08-11T05:21:45.000Z`。法定展示仍为 P<8…
  130≤P≤560 六带；§1039.140 / §1065.20(e) ties-to-even 对三位 raw 查询的翻译为
  `[0,7.5)`、`[7.5,18.501)`、`[18.501,36.501)`、`[36.501,55.5)`、
  `[55.5,129.5)`、`[129.5,560.501)`，故 560/560.001/560.500 kW 同属最高带、
  560.501 kW 无结果；加拿大 §1(4) 也纳入 calculation methods。ARE #173 的 2026 通用
  numeric 边界也由 #262 纠正为 regulation metadata 自 `2026-01-01`、普通 numeric
  自 `2027-07-01`。BRN/BTN/SLB/TLS/MWI/SLE/SOM/SSD/TCD/SLV/SUR/TTO
  已以 #248–#259 / ADR-134 固定为每国恰好两条当前 source、四 scope no-data，
  统一 `verifiedAt=2026-08-10T23:08:11Z`。
- 公开只读演示：<https://jamesky.site>。只读核验中，
  observedAt=`2026-08-20T01:29+08:00`；`/api/health` readbackAt=`2026-08-20T01:29+08:00` returned `status=ok`,
  `version=5b35ced1e6e52ca1df9fec9d46f355b73b033ec6`；服务器当前 release 链接解析为
  `/opt/diesel/releases/5b35ced1e6e52ca1df9fec9d46f355b73b033ec6`。因此当前公开 release ID
  与 Git commit 均为该完整 SHA；同时观测的本地 `master` 和只读
  `git ls-remote origin master` 也均为该 SHA。这是带时间的只读快照，CI 中的
  `portfolio:verify` 只校验已记录对象和等值关系，不联网声称其仍然最新。该记录的证据类型固定为
  `historical-operator-record-only`；它不是外部签名的生产读回，也不能由本地校验器证明来源真实性。
- 最后一个完整记录了发布步骤与独立读回的时间戳 release lineage 仍是
  release `20260814144537` / Git
  `38541ac8201e260934fe9eeaab571d2c8a4262ee`。它于 2026-08-14 完成仅代码的
  版本化发布，不执行数据库写入；当时的独立读回复核 `/api/health`、PM2 降权进程、
  PM2 systemd 复活链路、Nginx、首页、聊天页、代表国家页、地图 Demo 清理、公开产品
  API 及真实 AI SSE 均通过。该 lineage 是历史文档基准，不是当前公开运行版本。
- 运行库覆盖数量：2026-08-12 04:36 CST 从公开 `/api/countries` 读回 178 个唯一
  ISO3，全部为 `covered`；本轮 97 个目标国家均完成目标图与 scope 验收。`covered`
  只表示已发布核验边界，不表示四个 scope 都存在数值法规。
- `ACCEPTANCE.md` #166–#264 已随 release `20260812031745` 发布；选择闭包为
  `97 jurisdictions / 28 regulations / 651 limits / 203 sources`。DZA/ETH/NGA 旧 numeric
  图已按合同治理，LIE/SGP/MLT 运行库图已补齐，AUS/PNG/CAN/USA/CHN/MLT 的数值或
  成员边界均通过生产聚焦验收。签核表中保留的“本地 accepted / 待部署”文字是发布前
  审计轨迹，由本状态快照统一 supersede。

代码提交、公开站点和 PostgreSQL 治理发布是三个独立状态。站点运行相同代码并不
保证目标数据库已经发布该提交中所有 accepted fixtures；因此 README 不再用历史
Seed 计数代表线上覆盖。

## 安全与演示加固（2026-08-14，代码已发布）

- 公网走查曾发现运行库中的未签核真实产品会进入公开产品选项，且至少有一条
  功率区间/来源关联异常。当前本地代码已在产品列表、点名适配与认证出口统一实施
  fail-closed publication manifest；真实产品同时绑定实体、来源与规格版本，真实认证绑定
  实体与来源，两份 manifest 当前均为空。公开 DTO 也拒绝空/倒置功率或供应期区间。
- 首页原“结构化覆盖率”已改为“证据边界核验率”，并明示它不代表存在数值法规；
  零配置 Demo 另显示为“虚构演示切片”。首页 API 或地图 GeoJSON 失败时现在有独立错误与
  重试状态，不再继续显示“在线”或误导图例。
- AI evidence contract 对带 scope/power 的 1–5 国法规查询统一要求
  `compareRegulations`；同时询问法规与产品时必须分别取得法规比较与产品适配结果，
  无关国家 profile 不能解锁模型文字。工具拒绝、错误或畸形结果也有终态 UI，不再无限显示
  “正在执行”。AI 普通文本现以受限 GFM Markdown 渲染，支持标题、列表、表格、链接和
  代码块；结构化工具结果仍优先使用可复核卡片，不退化为纯 Markdown。
- 地图快捷入口上限为 8，国家抽屉打开时接管焦点，关闭/Escape 后返回实际触发控件；
  Demo `.invalid` 来源保留标题但不再渲染为死链。三分钟脚本也已将安装/启动移到计时前，
  并与公开 DTO 不展示 proposed 的实际边界对齐。

上述代码已随 release `20260814144537` 发布。发布后 `/api/products` 只返回
`DEMO-ENG-100` 与 `DEMO-ENG-200`，未签核真实产品不再进入公开出口。2026-08-15 的生产
维护又在 PG17 custom-format 全量备份、SHA256/catalog 校验和精确 dry-run 后，原样归档了
8 条等宽功率的未签核真实产品并逐条写入治理审计；没有改写规格或归档来源。Migration
`0011_temporal_memberships_and_product_power` 会对所有活动产品强制
`power_max_kw > power_min_kw`，仅允许已归档的历史脏记录保留原值；`0013` 让已经应用旧版
0011 的环境收敛到同一最终约束。目标库是否完成迁移必须以版本化 production readback 的
完整时间/hash lineage、约束定义和零条活动非法产品为准，不能只依赖本文描述。目标 journal
还保留一条 2026-08-03 放宽为 `>=` 的孤儿迁移审计记录；readback 只接受该精确时间/hash，
不删除历史，也不把任意额外 migration 当作正常状态。

## 地图 Demo 公共出口清理（2026-08-14，代码已发布）

- 公开 PostgreSQL 国家地图与详情已排除 Demo 分类事实：Demo 国家摘要降为
  `no_data`，Demo 国家详情失败关闭；非 Demo 国家中的 Demo 辖区、成员关系、法规、市场
  指标或来源也不会进入国家详情及复用该 service 的 AI 国家画像。
- `pnpm demo` 的 PGlite fixture 保留，求职者仍可离线演示完整流程；本次不删除或修改
  生产数据库记录。地图图例改为中性的“有可查看数据”，不再把 Demo 与已核验数据并列。
- 修改前公网基线：CHN 含 1 个 Demo 辖区、2 条 Demo 法规、1 条 Demo 市场指标；BRA 含
  1 个 Demo 辖区、1 条 Demo 法规、1 条 Demo 市场指标。release `20260814144537` 已对
  这两国以及 `/api/countries` 做公开读回，国家地图与详情不再返回 Demo 分类事实。

## AI 证据边界加固（2026-08-15 阶段记录；当前版本见下文）

- `sales-chat-system-v3` 把检索正文和其中 URL 明确标为不可信外部数据；知识查询主题词
  必须与用户请求绑定，低相关度候选在 service 和工具结果两层失败关闭。
- 模型 Markdown 外链只允许使用同一助手消息中的结构化 citation URL；站内链接仍可用。
- 模型输出限制为 2048 tokens，证据边界最多缓冲 16000 字符；输入历史最多保留最近
  12 条用户消息且总计 12000 字符。超限输出不向用户释放。
- 以上是 v3 阶段的历史边界记录；当前工作树继续继承这些约束，实际 prompt 版本与
  待发布观测状态以“FDE 作品强化”一节为准。

## AI 对话 Harness 与循环工程（2026-08-14，代码已发布）

- system instruction 已提取为 `sales-chat-system-v2`，以事实来源、工具路由、循环策略、
  回答契约和附件边界分段；没有增加模型作为法规、产品、市场或评分事实来源的权限。
- 工具循环现在按 evidence contract 动态收窄 active tools。缺少多项证据时只保留尚未满足
  的工具并继续 required；证据齐全、失败/不足、执行异常、缺参或纯附件概述后关闭工具，
  不继续消耗无关步骤。最终模型文字仍经过原有流级 evidence boundary。
- 新增 `pnpm ai:eval` 离线 harness，当前 20 个 golden cases 覆盖问候、缺参、单国/
  跨国法规、市场、产品、混合意图、机会分、销售简报、来源、附件与空证据合同。它不调用
  外部模型；另有 1 条 system-prompt version/section 合同测试，共 21/21，不得表述为真实模型
  任务成功率。发布后已用公开 `/api/chat` 完成真实模型与
  `searchKnowledgeBase` 的 SSE 读回；首次读回发现内部相对下载路径不能作为公开绝对来源
  URL，已由 `38541ac` 改为仅暴露已核验外部来源 URL，再次读回为结构化 `ok`。
- 该发布当时记录的质量门（历史快照）：`pnpm lint`、`pnpm typecheck`、48 个文件 / 944 条 Vitest、
  `pnpm ai:eval` 14/14、`pnpm build` 全部通过；完整 Playwright 为 71 passed / 7 skipped
  （桌面与 Pixel 7）。

## FDE 作品强化（本地待发布）

### 本轮交付边界

2026-09-28 上线收尾将仓库根 `/tmp` 的本地备份、候选副本与编译缓存排除在 ESLint
源码检查之外，与现有 Git 忽略边界一致；不排除 `src`、`scripts`、`tests` 或源码内的
同名 `tmp` 目录。回归直接使用 ESLint 的实际路径判定。此配置修复不代表安全审计、
远端 CI 或生产发布已经通过，当前生产状态仍以前述带时间的读回为准。

2026-09-20 收尾候选复现了干净提交上的浏览器证据生命周期问题：公开套件的
348 passed / 65 skipped 用例全部通过，但记录器在 Next web-server setup 后才采集
起始状态，临时生成的两个 `next-env.d.ts` 使起点为 dirty；teardown 已恢复 clean，
因此首轮采集正确地非零退出，不计为成功浏览器证据。记录器现于构造时、服务启动前
捕获源码基线，`onEnd` 仍要求 HEAD、源码指纹和工作树状态一致；不忽略类型文件改动，
不把未恢复文件或 setup 期间的源码/HEAD 漂移当作成功。五条新增回归覆盖可恢复临时
生成、三类真实漂移及非采集模式；本次验收结果仍以下方 canonical artifacts 为准。
此候选仍是本地收尾过程，不代表远端 CI、安全审计、历史再分发授权或生产发布完成。

“4 天 FDE 面试优化冲刺”的核心本地实现已完成；确定性本地验证是否闭环，只由本节引用的
canonical artifacts 与 `pnpm portfolio:verify` 共同判定，任一证据过期或不兼容时不得称验证闭环。
本节仍统一标记为“本地待发布”，不代表当前公开运行版本已经包含这些变化。当前大型工作树还交织了原计划明确列为后续阶段的
强化项：管理 dashboard 数据最小化（现已在本地完成）、真实 PostgreSQL 治理并发 smoke、Markdown
部署流程迁移、成本/延迟与 usage 观测，以及 Linux release handoff、systemd/cgroup 和额外 canary
基础设施。这些内容不得计入本轮 4 天计划的完成度或面试效果声明，也不能在未拆分审查、远端
CI 和目标环境读回前称为已发布能力；为避免破坏既有工作，本状态文件保留并如实描述其本地
进度。本轮没有因此新增国家、产品、数据库 schema 或未经授权的真实产品 fixture。

完成公开闭环仍需质量与外部条件：在授权模型上实际运行当前源码与评分合同绑定的 live eval，
如实保存成功或失败结果，并核对报告自洽与实际退出码。原四天计划不以漂亮分数或全部案例通过
作为交付前提；失败报告不能被宣称为模型质量通过，也不能以禁用模型或重贴旧指纹代替真实执行。
评估报告一致性、模型质量结果与生产上线是独立维度。仍需部署当前代码并
复核 `/api/health`、语言切换、CHN 决策 schema、关键页面和普通 AI SSE；先把当前工作树拆分、
审查并合入 `master`，再让该 exact SHA 的新版 `Required CI gate` 成功；解决 FDE 历史再分发许可证门后，才可创建并发布
不可部署的 archive 分支。在这些条件满足前，本文不得把相应项目写成生产完成。

- 2026-09-18 将已复现的 Next 静态文件断连修复窄范围迁入原工作区：pnpm 补丁只改
  Next 16.3.3 的 CJS/ESM `serve-static.js`，先注册终态监听再开始 I/O；取消结束等待，
  不伪造 finish 或完整送达，真实异常仍失败。原目录修复前 30 条回归为 18 失败 / 12 通过，
  修复后全部通过；补丁、安装前校验、截图及浏览器证据相关的 368 条定向测试通过。
  安装边界绑定补丁字节，截图与浏览器 source closure 纳入补丁；两张英文截图已真实重拍。
  随后的四套正式浏览器采集与其生产构建通过，结果仅见下方当前浏览器证据快照；完整单测
  仍以唯一执行 artifact 及其当前源码校验为准。未搬入隔离候选的其他框架补丁、评估报告或
  测试成绩，保留原工作区 v25 模型证据及其他既有改动；没有提交、推送、部署、模型调用或
  数据库 schema 变更。本记录不是真实模型通过、exact-commit CI 或生产上线证明。
- 本地知识导入与草稿重新处理已修复章节 locator 漂移：form-feed 分页保留活动标题及父级，
  跳级 Markdown 标题按实际级别替换同级、退出下级，不再由标题栈长度推断父子关系。
  页码、页内段落编号与来源语言保持独立；既有测试中把跨页父标题丢失当作正确结果的
  期望已按该规则纠正。回归覆盖跨页续文、空页、页尾标题、跳级同级标题与哈希校验后的
  草稿重新处理。UTF-8 提取同时保留源文件首尾分页符，仅在判空时使用 trim，避免开头
  空页被删除后将第 2/3 页错误重编号为第 1 页；上传→检索浏览器流程核对显示页码和
  下载原文分页符。纯空白、无效 UTF-8 和不支持的格式仍被拒绝；不自动重写既有文档或
  已发布证据，不修改 schema、live-eval 案例或历史报告。
- 长段落分块已修复 UTF-16 代理对截断：补充平面汉字、emoji 等码点恰好位于长度
  边界时，分割点向左移动一个 code unit，避免各块分别编码为 UTF-8 后把原字符变成
  两个替换字符。正文 1,200 code units 上限与既有句子/空格优先规则不变；边界回归
  同时验证片段编码往返、原段落字节重组、页码/章节定位及重新处理的内容哈希。
  本项不回写已存文档，不扩展成字素簇分割或完整 Markdown 解析器。
- 知识导入与草稿重处理新增分块生成预算：活动标题路径不超过 2,048 个 UTF-16
  单元，单文档不超过 5,000 块，所有块正文/标题字段/locator 合计不超过 16 Mi 个
  单元。此前 16,604 字节本地虚构样本会生成 4,812,292 字节重复文本字段；该样本
  只调用纯分块函数，没有 embedding、数据库写入或生产负载观测。现在超限明确
  失败且不返回部分块；新导入保留原文件，ready 草稿重处理失败不替换既有证据。
  预算不是进程内存或超时保证，不截断来源文本，不改变数据库 schema 或历史评估报告。
- 文档持久化现按最多 1,000 块顺序分批，开发导入、治理上传与草稿重处理均保留单一
  外层事务。此前本地 21,846 字节虚构文本生成的 3,641 块会编译成 65,538 个参数，超过
  安装驱动的 `>= 65,534` 拒绝阈值；该复现仅编译 SQL，不是生产数据库故障观测。
  新增 SQL 编译回归覆盖至 5,000 块，每条语句在当前 schema 下最多 18,000 个参数；
  PGlite + pgvector 回归验证三条路径的 1,001 块有序写入、第二批失败时整体回滚及
  治理请求重放不重复插入。空 ready 集合仍失败，failed 结果仍不插入 chunk；未增加
  逐批提交、重试、schema 或依赖。这是本地修复，不宣称真实 PostgreSQL 吞吐或并发通过。
- 文档文本持久化边界已补齐：隔离 PGlite 复现表明，合法 UTF-8 中的 NUL 会触发 `22021`，
  未配对 UTF-16 metadata 则不能原样编码往返。正文 NUL 现进入明确的 `failed` 结果，原文
  字节/hash 保留、零 chunk、无 embedding；治理上传不再到 chunk INSERT 才抛错。文档
  metadata 和文件名/MIME 描述中的 NUL 或未配对代理项由 Zod 在落盘前拒绝，重处理 patch
  在读取原文件前拒绝；`ready` 原文仍不被失败处理结果替换。合法中文、emoji、显式 U+FFFD
  和来源分页不变，不静默清洗文本、不回写历史文档、不修改数据库 schema 或模型报告。
- 开发原件下载现按数据库登记 SHA-256 验证单次读取的原始字节，再返回同一份内容。
  本地真实 Route/Service/PGlite 仓储加受控存储故障注入复现了等长替换、截断、空文件及
  错文件仍返回 200 的缺口；修复后内容寻址路径和旧文件名路径均失败关闭，且不以路径
  中的 hash 替代登记值。错误沿用脱敏 500，不回写文档、chunk、来源、草稿、审计或文件；
  提取失败文档仍可下载哈希匹配的二进制/NUL 原件。浏览器回归核对完整原文和下载响应头。
  本项仍是开发环境能力与本地故障注入证据，不宣称生产故障、不可变存储或跨介质事务保证。
- 本地文档存储不再用无上限 `readFile()` 读取原件：下载、草稿重处理、保存前复用与
  发布后校验统一使用既有 5 MiB 文件预算。读取先检查同一句柄的普通文件类型和大小，
  再持续短读至 EOF；工作 Buffer 最大为 `5 MiB + 1 byte`，即使初始 stat 为零、随后
  文件增长到 10 MiB，也最多读取上限外一个字节即失败，不返回截断内容。超大写入在
  创建目录前拒绝；真实 5 MiB 原件仍完整读写，命名管道在独立限时子进程中快速拒绝。
  句柄在成功及异常路径关闭，下载/重处理保持原错误契约，不自动修复或删除最终文件。
  这是本地字节预算与故障注入回归，不宣称 OS I/O 时间、进程 RSS 或并发总内存已受硬限。
- `product-fit-v2` 已把法规/认证适配与查询日供应状态拆成双轴，并按
  `[availableFrom,availableTo)` 组合 `commercialReadiness`；销售简报只推荐 `ready`
  产品，缺失或区间外供应证据进入风险/缺口。
- 产品缺口的英文固定提示现在与中文“没有确定的适配结论”等价：表达证据不足以形成确定
  结论，不再用“没有确定性适配结果”描述已经返回的 `unknown` 评估。实际既有 Demo 的
  DEMO-ENG-100 仍为 fit/ready 并放行，DEMO-ENG-200 与不存在型号仍为 unknown 并拒绝正文；
  国家、用途、功率、日期、来源与免责声明不变。这是本地文案修正，不改 v17 评估合同、
  18 个案例期望或旧 v13 模型观测，也不新增资料、schema、依赖或付费调用。
- 固定证据缺口提示已在本地按七类工具的 `status=error` 区分执行失败与真正无数据：
  服务抛错返回的合法错误结果不再被描述成数据库缺少匹配资料。中英提示均保留失败关闭、
  去重的重试建议与免责声明；正常 `no_data` 缺口和成功卡片不变。本项不改变工具状态、
  v17 评分规则、18 个案例期望或旧 v13 实测报告；模拟服务异常不是生产故障观测。
- 上述双语异常回归另发现并修复英文国家列表分段问题：`CHN and BRA` 及逗号连接的
  相邻国家不再被拆掉一国，从而误报跨国比较缺参。独立任务动作仍划分各自国家角色；
  原英文请求及其双国期望保留，不用改写用例规避生产入口问题。
- 离线 Demo 的浏览器对照进一步暴露指标代码漏传：市场工具虽返回可比数据，仍因未保留
  用户指定代码被最终边界拒绝。Demo 现复用生产按任务指标绑定，覆盖市场比较、机会分和
  简报的显式代码、同任务追问与替换，并保留不同任务间隔离；不改实际数据或放宽证据校验。
- 现有目录名称的运行检查另复现四个嵌套国名误识别，以及完整国名内部 `and` 被法规、市场
  或来源分句拆掉的问题。国家识别现保留最左、同起点最长的不重叠名称区间；
  `South Sudan` 不再额外要求 SDN，`Trinidad and Tobago` 内部连接词不会丢失。
  真实独立提及的短国名、不同任务国家角色及多轮 scope/power/date 继承继续保留。
  本项只修复现有目录身份解析；目录名称不代表法规覆盖，无匹配 Demo 法规仍失败关闭。
  不增加国家、资料、schema 或依赖，不改变 v17 案例期望，也不回写旧 v13 模型报告。
- 市场比较卡的本地展示已补齐已有证据条件：成功和无数据结果都显示请求国家、用途与
  指标代码；每条观测保留统计期（起点包含、终点不含）、口径、方法版本、币种、用途及
  原始来源标题。数值复用字符串精确格式化；缺失值标为未记录，不推断为不适用。
  十一类 typed 可比性问题逐指标给出双语说明，重复最新观测仍逐条保留；组件不改变确定性
  状态或证据门槛。负向浏览器回归还修复空指标占位被误算为“缺引用事实”的客户端拒绝：
  合法零观测 `no_data` 现在显示空状态，任何实际观测、伪造名称与肯定结论仍受原引用和
  确定性校验约束。小屏工具状态徽标不再逐字挤压。没有新增资料、schema、依赖或模型调用；
  本地 UI 测试不构成真实模型成绩。
- 本地比较规则补齐既有必填依据的完整性检查：单位、口径或方法版本为空/纯空白时，分别
  返回 `MISSING_UNIT`、`MISSING_DEFINITION`、`MISSING_METHODOLOGY`，状态为
  `insufficient_data`。两国都缺失不再被当作相同依据；保留观测、来源及其他已知 mismatch，
  该指标不贡献市场潜力分（`null`，不是 0），独立的产品/法规分与推荐继续按原规则计算。
  客户端只允许缺失单位出现在确定性标为数据不足的指标中；缺失标签不能为完整观测制造拒绝。
  数值后的缺单位状态显式写为“（单位未记录）”，不把已有数值误标为缺失。
  真实服务到公开 SSE 的中英 mock 回归验证正文失败关闭；浏览器负向场景仅在测试传输层
  清空实际 Demo 响应的依据，不写数据库，也不是线上存在坏数据的观测。
- 本地回归复现并修复证据顺序依赖运行环境语言的问题：同一份合法 Demo 法规比较从英文
  服务端传入中文浏览器时，过去会因默认 collation 不同被误拒绝。证据生产、领域规则和客户端
  现在按相同的 UTF-16 code-unit key 排序；产品 service 也规范数据库返回顺序，知识检索同分
  ID 使用相同规则。原名称、来源和分数不变，重排仍拒绝；中英对照只使用内存/传输层 Demo
  变体，不新增 accepted fixture，不构成真实模型或生产观察。v17 案例期望与旧 v13 报告不变。
- AI 审计键加入服务端 turn/request ID 并改为 append-only；公共 API、管理写入和 AI
  完成事件只输出 strict JSON 白名单字段，`X-Request-Id` 可用于故障关联。
- 管理 dashboard 已拆为独立 10 表只读仓储，并完全移除未消费的 import batch 历史查询与
  响应字段：完整治理快照、CSV 文件名/预览/校验明细、内容哈希及内部关联字段不再发送到
  editor 浏览器。认证 principal 现在从 route 贯穿 service/repository/admission：Editor 的 SQL
  只读取本人未归档 Draft/Reviewed 与本人三状态计数，完全不执行全局 audit 查询，并移除 baseline
  publisher；Reviewer/Admin 保留全局队列、精确计数与最近 30 条 audit。Published 历史不再占用
  100 条活动队列，独立 `workflowCounts` 会显示窗口外总数；published baseline 用 `DISTINCT ON`
  每个实体只取最高版本。Dashboard route 现在还会在 `NextResponse.json` 前规范化合法数据库日期，并以
  完整 strict wire schema 校验 envelope 与所有嵌套对象；额外字段、非法日期、非 JSON 值、
  accessor/Proxy、数组 subclass/稀疏数组、特殊对象或循环引用统一脱敏为 500，不能在客户端
  schema 拒绝前先出网。当前/baseline payload 还按 8 类实体复用既有 strict schema，并验证
  entityKey 与 payload 主键一致；队列只接受 Draft/Reviewed，action、email、计数和数组均有边界。
  Editor admission 和客户端纵深校验会拒绝全局 audit、他人 draft 或非空 baseline publisher。
  current draft 只返回 8 个消费字段，published
  baseline 只有 payload/version/published actor/time；audit 查询下沉为 30 条，API JSON 不再重复
  返回 principal。公共管理 route 在完成认证后的响应（包括 handler 5xx）以严格响应头绑定服务端
  本次认证出的 email/role；Dashboard 客户端用 Zod 校验并以此更新当前身份，SSR principal 只作为
  首次加载的 bootstrap。401/403、写入时
  失权或任一 HTTP 响应缺失/畸形身份绑定会清空并卸载 dashboard、完整 payload、CSV/文件输入、
  审核理由和发布确认；只有显式绑定同一身份的 5xx 或无 HTTP 响应的网络失败才保留最后可信快照并
  明确标为陈旧，已认证的新身份遇到 5xx、非 JSON 或 schema 非法响应则清除旧身份快照。workspace
  generation 还会丢弃身份切换后迟到的旧 action preview/通知/错误，成功 action 响应也必须绑定发起
  principal 并通过结构化 schema；同身份的畸形 2xx 也会卸载可写工作区。管理 mutation 发送发起时的
  expected email/role，服务端在 body/handler 前与可信 principal 精确比较，漂移以 409 且 handler 零
  调用失败关闭；CSV 换文件/重试使用独立 selection generation，旧 batch/错误不能在新文件下复活。
  七个管理 mutation 出口现在只投影界面实际消费的 strict DTO：上传为
  `{status,draftCreated}`，重处理、草稿创建/审核/发布、来源核验和实体归档均只有 `{status}`；
  service 返回的完整 draft、文档摘要、内容 hash、原文件名、处理错误、actor 与存储行不会进入
  HTTP 响应。CSV preview/confirm 保留其界面确实消费的结构化字段，但客户端同样拒绝额外键。
  CSV confirm 还在同一事务的 `FOR UPDATE` 查询中把 batch ID、`created_by` 与 `previewed` 状态
  绑定到当前认证 principal；其他 Editor、Reviewer 或 Admin 即使从全局 audit 看见 batch UUID，
  也不能确认或拒绝原创建者的预览。creator mismatch、缺失和已结算批次返回同一脱敏冲突，
  valid/invalid 两条最终更新再次带相同谓词；表驱动数据库回归证明越权尝试不改变 batch、draft、
  fact 或 audit，且原创建者随后仍可完成确认。
  畸形认证邮箱统一失败为 401，而不是落入业务输入 400；角色绑定配置的坏 JSON/schema/email 和
  规范化重复键统一脱敏为 500，响应与日志不回显私有 allowlist email/role。真实数据库 characterization 锁定 root 与 dependency 的
  active/archived/missing/unpublished 语义；101 条 Editor 活动修订锁定精确计数与 100 条显示窗口，
  100 条更新的 Published 历史不能挤掉活动项，多版 baseline 只返回最高 published version。
- 管理非只读 API 现于 body 解析前拒绝跨站或畸形 `Origin` / `Sec-Fetch-Site`，同时保留
  两项 Header 均缺失的受控非浏览器客户端边界；生产代理仍必须剥离外部身份 Header。
  observer 只接收固定 route template，超长动态 pathname 不再把受控响应升级为二次异常。
  所有管理响应（含 401/403/409/500）在 observer 完成后统一覆盖为 private no-store 与
  no-cache；handler 误设 public cache 也不能绕过。
  文档上传还会在 source/document/chunk 导入前校验 `changeReason`，无效理由不会留下
  ready document、孤儿草稿或阻塞重试的内容 hash。
- 治理文档上传现先完成无数据库写入的文件准备，再由单一事务提交 source、最终态
  document、chunks、draft 与审计；duplicate 只在有效 Draft 缺失草稿时幂等自愈。v1 上传
  审计严格绑定完整 metadata、document、draft、source、内容 hash 和处理状态；v2+ 重处理
  只信任严格 `document_reprocessed` marker，provenance 缺失、重复、畸形或漂移时失败关闭。
  commit 以 source/hash/status、完整 source fingerprint、active draft 与 audit ID 作 CAS，在
  同一事务轮换 draft、替换证据并写两条关联审计；旧 draft 无法审核新内容，actor+reason+
  内容指纹一致的响应丢失重试不会重复建来源。管理表单未提交的 country/scope/URL/有效期/
  许可 metadata 会从当前修订保留，ready 文档的准备失败不会覆盖原证据；界面按 ready、
  failed、duplicate 显示真实结果。
- release archive 传输现显式保留主机预建 `root:diesel` 0750 根目录并在 rsync 后复查；真实
  rsync 测试同时锁定普通/可执行文件和相对 symlink 语义。root-side prepare 在构建前验证
  runtime/builder 的数字 UID/GID 与双向 group 隔离，以 root-only 全局锁串行化所有 SHA，并把
  builder 放入 retained transient systemd `Type=exec` service。成功必须匹配 manager 的
  `Result/ExecMainCode/ExecMainStatus` 三元组；signal 不会因 `systemd-run` 返回 0 被误判。unit
  stop 后以 cgroup v2、精确 `/proc` membership 和 builder UID 做两轮零残留证明，完成前不能
  冻结或复制工件；proof 失败保留 per-release HOME/workspace 并返回 70。冻结后还会 byte-compare
  input manifest；对于 Next 会改写的 tracked `next-env.d.ts`，builder 在第二次输入校验前恢复
  HOME 快照，root 则在 cgroup/UID 归零并冻结后从 canonical release 再恢复一次。之后才由
  release 根中 root-owned 的 input/artifact verifier 绝对路径复核，root
  不再执行 workspace 内可被 builder 替换的 verifier。artifact verifier
  复用单个 1 MiB buffer 且不再用大型数组 spread，manifest 格式与摘要不变。当前代码与
  fixture/静态合同已接线，但尚未观察远端真实 systemd run，也未在目标 VPS 演练，因此仍不把
  这一边界称为已验证的生产进程沙箱。
- TypeScript 增量状态已从仓库根移入 `.next/cache`；E2E 生成配置会确定性覆写到
  `.next-e2e/cache`，避免普通 typecheck/build 与 Playwright 共享或泄漏缓存。部署回归测试会让
  fake Next 改写 `next-env.d.ts`，并要求其在第二次输入校验前逐字节恢复；失败取证目录可保留
  生成文件与快照，但它们不能进入候选 release。
- 本地 CI workflow 已新增 merge-blocking `linux-release-handoff`：从 clean commit archive
  创建 input manifest，在只允许 GitHub-hosted 的固定 Ubuntu 24.04 runner 上用真实 PID 1
  systemd/cgroup v2、GNU 工具、独立数字 UID/GID、Corepack/pnpm、Next build 和版本化
  root-side prepare 完成交接，并要求 unit/cgroup、runtime/builder 进程与临时身份/目录精确
  清理；真实 build 前的后台 child canary 还必须被判为 70 并由 control-group stop 收口。
  两个额外 transient canary 会在真实 systemd 上校验普通 `exit 23` 和 SIGTERM→143，而非只依赖
  函数级 metadata mock；主成功路径还会独立要求 deterministic cgroup path 已消失。
  checkout 凭据不持久化，root helper
  只接收 `env -i` 白名单。该 job 已成为 `Required CI gate` dependency，但 workflow 仍随本地
  分支待合入，首个远端 run 尚未观察，因此当前只称“已接线”，不称“Linux 演练已通过”；
  它也不替代真实 VPS、SSH、PM2/Nginx/PostgreSQL 或目标主机 systemd/cgroup 演练。
- PostgreSQL 治理维护 wrapper 对短于首次 heartbeat 的子任务也执行最终 session/双锁
  证明，并校验两把显式解锁均由原 session 成功完成；探针超时后的失锁路径跳过可能排队
  的 unlock，清理与 owning-session teardown 均有 5 秒上限，失锁不能随子进程 0 退出码
  误报成功或无限挂起。
- AI `ai.completion` strict log 以 provider-call completion 作为唯一计费台账，再用 completed
  step 补充工具数与完整 step 延迟：记录基础 token、provider response/step/首 output 延迟、
  缓存字段可用性与完整性，不保存 raw usage。provider 已返回 finish/usage、但随后工具执行被
  abort 或 timeout 时，已知 token 仍作为 lower bound 保留且不与 step 重复相加，同时明确
  `tokenUsageComplete=false`、成本不估算。OpenAI-compatible raw
  必须实际包含且自洽地匹配三项基础 token；只有 raw 中实际存在合法 `cached_tokens` 才计算
  cache read，adapter 默认 0 不作为证据。attempt/completed call 分开计数，因此 retry、请求
  abort 和响应租约超时都无法伪装成完整用量，且均只发出一次完成日志。`AI_INCLUDE_USAGE`
  是默认关闭的 usage 请求兼容开关，不启用 prompt caching，也未加入任何未经验证的缓存
  参数。可选 strict 价格快照要求精确模型、版本、UTC `asOf` 与包含端点的
  `validThrough`；模型不匹配优先报告 `model_mismatch`，匹配模型但事件 UTC 日期晚于
  `validThrough` 时报告 `stale_profile` 并保持成本为 `null`。只有 profile 当日仍有效且 usage
  完整时才计算 micro-USD 工程估算。strict log 将 profile 日期绑定到事件的 UTC 日，但不保存
  私有费率；费率也不进入 provider body 或 live-eval 报告，默认状态为 `not_configured`。
  Provider base URL 只接受公开 HTTPS origin/path，拒绝账号、密码、query 与 fragment；认证
  只从独立服务端 API-key 字段发送，避免 endpoint 摘要固化误放在 URL 中的秘密。
  任一 completed step 的延迟缺失、`NaN`、Infinity 或负值时，合法 step 的延迟和仍作为
  known lower bound 保留，但聚合字段不再标为 fully reported，且
  `modelPerformanceComplete=false`；这不会把独立且完整的 token ledger 或成本估算误降级。
- `/api/chat` 现先取得每客户 2 / 全局 4 的 admission lease，再访问 PostgreSQL 共享限流；
  3 秒应用 deadline 结束 HTTP 后仍把 lease 保留到底层 Promise settle，配合事务级
  lock/statement/idle timeout 和公共池连接上限，避免数据库退化时挂起查询绕过并发门。
  `DATABASE_URL` 不能再以 timeout/options 参数或 decoded C0/DEL 控制字符覆盖这些上限。
  客户端取消也已贯穿 body reader、图片/PDF 预处理和模型；HTTP 可先返回 408 或结束超时流，
  但未完成的 reader/page/PDF loading-task destroy 或 provider stream cancel 会继续保留
  admission lease，实际 settle 后才恢复槽位，且请求前置取消后不会创建审计会话。工具异常
  日志与审计不再信任可变 `Error.name`，
  无效工具 JSON 的未知键名也不持久化；上述均有 secret marker、pending limiter、deadline、
  abort 与资源清理对抗回归。本节仍是本地待发布状态。
- PostgreSQL 小时准入已在本地升级为 global + client 双桶，并保持按 epoch 对齐的一小时固定窗口。
  `AI_CHAT_RATE_LIMIT_GLOBAL_PER_HOUR` 可选且缺省 10000；它与 per-client 值都限制在 1–10000，
  client 必须不大于 global，生产示例显式使用 300/30 与 PostgreSQL backend。共享数据库事务按
  global → client 固定顺序做条件 UPSERT：global 满不触碰 client，client 满回滚 global 暂增，
  拒绝不提交 `limit + 1` 或孤立的 `updated_at` 写入；成功准入后即使解析、配置、审计或 provider
  失败也不退款。原始 client identity 不落库，仅保存 SHA-256 摘要。Repository/PGlite 与 route
  回归已覆盖不同 client 共同耗尽 global、失败回滚和后续路径计数；required CI 现已加入只接受
  loopback `diesel_ci` 的真实 PostgreSQL smoke，并在运行时断言 monitor + 四个 repository pool
  使用五个不同 backend PID。当前工作区尚无该远端执行回执，极端热点吞吐仍未验证。
- 小时桶 cleanup 仍仅用于 retention，并已退出请求判定事务：每进程 single-flight 调度器至多每
  60 秒 fire-and-forget 一次维护，使用数据库 `statement_timestamp()`、10 分钟 grace、稳定顺序、
  500 行固定批次与 `FOR UPDATE SKIP LOCKED`。global 小时上限现已限制每窗成功请求及可创建的
  client 桶数量，但它不是 DDoS 防护；拒绝洪泛、窗口边界、cleanup 停摆、backlog 和 autovacuum
  压力仍须监控。本节全部仍是本地待发布状态，不是现网已升级的证据。
- model-bound `/api/chat` 在确定性 direct response 后先校验预算配置，并在模型能力、附件和
  消息校验通过后、审计/provider 之前执行 `estimated-provider-call-v1` 日准入：因公开 route
  固定零 SDK retry、最多五个 provider step，每次一次性预留 5 个应用侧潜在调用单位。生产在
  既有 PostgreSQL 桶中按 global → client
  固定锁序原子预留，client 不足会回滚 global，commit 后下游失败或 usage 缺失也不退款；原始
  client/IP 只进入域分离 SHA-256。两项生产日限额缺失或通过 env 标量校验后的关系无效时，
  model-bound 请求会在模型配置前脱敏 503；非法标量本身由应用环境初始化直接拒绝。预算数据库
  失败也不会进入审计/provider；耗尽为带 UTC 日界 `Retry-After` 的 429。direct response、模型
  配置失败和附件校验失败不写日预算桶。该边界不计
  token/成本，不是 provider hard cap，也不覆盖 provider 内部行为、其他 API-key 消费者或绕过
  route 的调用；requested-output 维度尚未实现。实现与本地确定性/静态测试已接线，真实多实例
  PostgreSQL 并发结果和生产配置尚待发布流程验证，因此仍是本地待发布状态。
- Chat 工具资源所有权已在本地收口：七个 executor 在首个 await 前同步取得工作 token，token
  覆盖 service、审计与最终 schema parse，invalid-input repair audit 也不能脱离 lease。正常 EOF
  seal tracker；cancel、response timeout 和 reader error 先 abort 再 seal，所有已启动 token settle
  前不释放 admission。signal 已贯穿 country/product/marketing/market/knowledge 数据路径，已启动
  的 compatible products、评分、简报、法规比较与 country detail fan-out 使用稳定顺序的
  `allSettled` barrier。route setup 的 audit repository/session 初始化共用 10 秒绝对期限，PDFJS
  resolution/loading/page/read 与 Sharp metadata/toBuffer 也从原始 Promise 创建前取得 token；
  abort 后 cleanup 另行登记，不能代替原操作 settlement。Drizzle/附件库不能强制取消所有已执行
  工作；永久 pending 会保守地持续占用原 lease。
  本节仍是本地待发布状态。
- Chat 多轮提示注入边界已改为按单轮和跨轮连接序列检查实际保留并重新发送给 provider 的
  全部用户历史；旧轮攻击或拆到相邻两轮的指令，即使被新一轮“继续”覆盖为最新意图，也不会重新开放
  模型正文。SDK 内部流现在先完整记录 reasoning、provider metadata 与原始 tool-call ID，供同一请求的
  后续 provider step 延续上下文；该私有 continuation 不经过浏览器接口。SDK event processor 之后再由
  单次、有界的 single-pump replay/broadcast public hub 投影，供 `fullStream`、公开 `text` 与真实
  `POST /api/chat` SSE 共同消费。每个消费者取消时只移除自身订阅，不能等待或阻塞其他公开消费者；
  晚到消费者可重放同一份已投影事件。hub 最多保留 1,024 个公开事件，超限或底层源异常时当前与
  后续消费者都取得同一固定公开错误，同时后台继续排空私有 SDK 流，使 provider callback、审计与
  指标可以结算而不泄露原始错误。因此三条
  公开路径都要求在工具证据充分时仍丢弃 provider marker，只返回证据缺口。provider 把 reasoning
  降级成普通 text 时也会在完整缓冲区上执行 NFKC、移除
  Unicode `Default_Ignorable_Code_Point`，并以最多 16 轮白名单解码 `amp/lt/gt` 与合法 numeric
  character reference，再对完整 `think/thinking/analysis/reasoning` 标签失败关闭；标签名内或分隔
  位置的其他 named entity、单层/双重/混合 numeric、过深受支持实体、零宽、全角和自闭合标签均
  不能绕过，同时不引入通用 HTML 解码，普通业务句中的 analysis/reasoning 词不受影响。
  `tool-input-start/delta/end` 现按 call ID 缓冲到完整调用；递归检查与 SDK schema
  解析通过后，只从最终已解析 input 重建 start / 单个 canonical JSON delta / end，不回放原始 delta，
  污染调用及同 ID 后续结果/错误全部丢弃并返回固定缺口，知识查询还在执行前拒绝相同 marker。
  `fullStream` 与真实 Route SSE 都证明工具参数 marker、伪结论和输入进度不可见，正常工具调用
  顺序与结构化结果保持不变。provider 的 `custom` / 普通 `file` / `source` / `raw`
  也不再依赖 UI converter 的默认开关：销售聊天将它们作为协议外输出失败关闭，递归命中私有
  推理时显示专用缺口，无 marker 时显示通用执行缺口，其后模型正文一并不释放。表驱动
  `fullStream` 回归覆盖 custom/file/source，真实 Route SSE 回归覆盖 custom metadata；AI SDK 当前
  默认不把 raw chunk 传入 `fullStream`，因此 `raw` 是防御性分支，不伪造不可达的集成证据。
  provider-executed tool result/error 与顶层 error 的原文也已关闭；本地 result 只有 strict
  schema 通过才公开，公开 output 使用 Zod 的 `parsed.data` 而不是原对象，畸形输出转为固定终态
  error，服务端 observer 仍可取得原始诊断。工具 input/call/result/error/output-denied 由边界显式
  DTO 重建，统一使用 `sales-chat-tool-N`，并要求 incoming result、accepted-call ledger 与 parsed
  output 三方 toolName 一致；input 只取 ledger 中的已解析值，不传播 provider/tool metadata、title、
  preliminary 或错误原文。provider-executed、dynamic 与协议外 part 不进入公开卡片；本地执行能力仍
  只来自服务端声明的静态 tools、Zod 参数和受审计 executor，不能由公开投影扩张。
  `start-step` / `finish-step` / `finish` / `abort` 保留协议事件，但
  request/body、warnings、provider response identity/headers/metadata 及 raw/abort reason 不进入公开流。
  模型正文 part 的 provider ID 也不再回显，而是在证据边界内重建为递增的
  `sales-chat-text-N`；每个 step response ID 重建为递增的 `sales-chat-step-N`。`finish-step` / `finish`
  的 usage 与 performance 只按标准字段显式投影，删除 `usage.raw`；`toolExecutionMs` 只接受已进入
  accepted-call ledger 的原始 key，并改写为同一 `sales-chat-tool-N`，未知 key 丢弃并失败关闭。
  内部 step metrics、token/cache 完整性和 live-eval typed tool getters 仍使用投影前的私有 SDK
  结果，但报告与浏览器都不序列化 raw usage、reasoning 或 provider ID。Mock V4 回归已实际注入
  finish response ID/model/metadata/header/raw marker、marker-free tool metadata、重复 JSON key 中被解析丢弃的值，
  以及 text ID、`usage.raw`、timing key marker；两步并发回归还证明第二次 provider prompt 保留
  reasoning/metadata/raw tool ID，而 `fullStream`、公开 `text` 与 SSE 全部不可见，即使调用方请求
  `sendReasoning=true` 也会被强制关闭。
  生产流同时用不含原始 payload 的稳定分类上报无效/动态/provider-executed
  调用、不完整输入、孤立或畸形结果、工具错误、输出拒绝、协议外 part 与最终缓冲 reasoning；
  observer 异常不影响公开流；live eval 只消费“发生过拒绝”这一布尔事实，不落盘分类、call ID 或
  原始 payload，并将任一此类拒绝记为 `TOOL_RESULT_ERROR`，不能把边界已丢弃的调用算作正常完成。
  本节仍是本地待发布状态。
- AI 结构化事实的可信边界已从“有 citation”升级为双向精确身份与确定性重放：七类结果要求
  每个可见事实/分析来源都有匹配 citation，且每条 citation 必须由事实或来源拥有；freshness
  按时间 instant 从全部 citation 重算。国家详情还验证 adoptedOn 的存在性与查询日边界，并重算半开法规/成员生命周期、
  coverage/Demo 配对、辖区投影、market country ownership/正期间/decimal、ID 唯一性和无重复
  source 闭包；pre-epoch 核验时间按真实 instant 参与最大值。applicability summary 非空时必须
  映射回同一宽画像，存在可见限值时验证 power；scope 只保留声明，当前 DTO 不证明其真值。
  本节仍是本地待发布状态。
- 知识检索现在在 service、server/client schema 和最终模型文字 contract 重放 query/filter echo、
  半开有效期、页码、limit、唯一 chunk、连续 rank、`0.5/0.5` 六位小数 score、相关度与 canonical
  排序，并精确重建 hit/outer warning。AI 正文必须具有恰好的 untrusted excerpt wrapper，外层
  country/asOf 必须与 filter 一致；模型专用输入 schema 不再公开 jurisdictionId/limit，SDK 与
  公开 tool-call 边界及客户端工具卡拒绝额外字段，直接执行端仍固定为 `null/5`。通用检索和旧 live-eval
  参数观察 schema 保持不变；旧报告中 provider 自选参数仍由原 scorer 如实判为不匹配。
  query 必须完整覆盖可信问题中已登记的中英文业务概念 alias，其余有效业务/字面词精确绑定；
  普通交付提示词可省略，但实际原文、引用及请求定位必须通过独立交付校验。数字重合、
  过窄泛词或追加无关词均失败关闭。
  仓储关键词通道新增固定英文单复数扩展，以解决英文复数与现有 `simple` 词向量不匹配的
  漏召回；仅改写已解析的 tsquery，保留关键词表达式的短语、布尔和否定结构，并保护复合
  标识符。原始 query、来源内容、embedding、混合权重、门槛和 metadata/发布过滤不变。
  其边界与向量通道限制见 [数据模型](DATA_MODEL.md#9-来源文档与知识库)。离线回归不能
  证明留存模型观测所未覆盖的后续源码效果；需新的授权运行重新建立 provider 证据绑定。
  本节仍是本地待发布状态。
- 机会分与销售简报已改为完整可重放 typed provenance：scorecard 携带原始 market/regulation
  comparison 和逐国 product-fit evaluations，三维分数、typed gaps、权重、贡献、总分、覆盖率、
  国家/component/product 顺序与无重复精确 source closure 全部重算；国家沿 query、component
  固定 market/product/regulatory、产品按 model code + ID、法规按 canonical name + ID、限值按
  pollutant/power/date/ID、市场观测按 query 国家后接 period 降序 + ID。`CertificationEvidence` 和认证来源同时
  绑定 product ID、model code 与 regulation ID；简报精确重建 ready 推荐产品、认证集合及有序
  opportunity/risk/action rule-code 投影，不再接收自由摘要、解释或证据 ID 文案。显式 metric code
  仍与可信 user 文本完全绑定。国家详情的宽画像与可选 applicability summary 已进一步收口到
  同一个只读 repeatable-read 事务，两个仓储均由同一 transaction 创建，事务内不会二次取连接；
  事务对象测试与 PGlite 设置/拒写测试已本地通过；真实 PostgreSQL 双连接更新竞争 smoke 已接入
  CI，当前环境没有本地 PostgreSQL runtime，其实际结果以 CI job 为准。
  机会分/简报的市场、法规和产品读取仍彼此独立；上述保证也不覆盖 DTO 未携带的 DB 候选、
  来源/embedding 真值或运行时 stale 时钟，不是来源真实性或数据库完整性证明。本节仍是本地待发布状态。
- 七类 ToolResult 的 warnings 已改为从 typed facts 精确重建；error 只接受无 citation、无事实、
  无建议的 canonical 占位，search 固定 `jurisdiction=null/limit=5`，comparison 不携带伪缺口，
  score/brief 仅保留 typed execution-failed gap。server/client/evidence 三层拒绝 warning、状态、
  query 内部关系或 error payload 漂移，UI error 卡不渲染 ToolFacts。本节仍是本地待发布状态。
- 七类完整 ToolResult 继续原样进入 audit、SSE/UI 与 evidence boundary；模型下一 step 统一改用
  `sales-chat-model-tool-output-v4` strict 投影。v4 的 score/brief 摘要新增原始 `definition`，
  与完整市场投影一起重算可比性。
  这是模型摘要格式的不兼容升级，七类投影拒绝旧 v3 标记；不是 live-eval v17 评分合同的改写。
  Knowledge 保留完整 untrusted excerpt，country profile 只开放请求主题；product-fit 保留供应期、
  商业准备度、负面 reason/check、法规和认证，法规/市场
  比较保留完整限值、定义与方法版本，score/brief 保留可重放 typed digest、确定性分数、缺口、
  推荐 ID 和全部规则。投影还精确绑定 query/date/scope/power/metric 顺序、citation/source closure
  与 freshness，但删除下载路径、原文件名、embedding/排序内部字段和未请求国家主题。
  单结果上限为 48,000 UTF-8 bytes；每 step 最多 8 个结果/96,000 bytes，每 turn 累计最多
  128,000 bytes。任何 non-JSON、非 strict v4、畸形 history 或超限都会在下一 provider 调用前锁存
  停止：完整成功卡与真实 success audit 保留，模型文字被丢弃，公开流只补固定本地化证据缺口，
  completion/observer 记录稳定错误类别；失败投影不会把真实 ToolResult 改写成 canonical error。
  brief 直接复用 scorecard provenance，不再重复法规/产品读取；浏览器只上传最近 12 条/12,000 字
  内的有序 user text 与最新附件，以白名单重建请求，不回传历史 assistant/tool/metadata 大 payload。
  完成卡继续绑定 SDK tool identity、input 与 output；error 不标为事实，market 顶层 current date
  只称结果生成日。字节上限不是 tokenizer 或 provider 账单证明，投影 schema 也不认证任意独立
  JSON 的来源真实性。本节仍是本地待发布状态。
- host rollback 已收敛到版本化 `rollback-host-release.sh` 单一状态机：发布 trap、治理失败
  与人工回滚不再各自复制命令；commit marker 必须通过权限、结构与 snapshot hash 校验，
  direct CLI 只接受完整小写 40 位 SHA，并在 source 前把入口绑定到参数指定的目标 release、
  验证目录链与 entry/ledger 只处于 staged/normalized 的 canonical 单链接 executable 闭包；受支持的
  10 参数生产状态机和 production-main 函数入口在 sourced 调用时以 64 拒绝，13 参数 fixture seam
  也拒绝字面量、重复/尾随斜杠形式，以及由固定 `/usr/bin/realpath -e` 解析到 `/opt/diesel` 的既存
  alias。Bash 内部函数不私有，因此这是误用保护而不是 shell 权限边界。
  外层只读 committed-state 验证与 trap abort 语义分离；未提交路径可从切换前/后及半回滚
  状态幂等收敛。旧 release 的 root ownership/只读入口在执行前校验，Nginx candidate
  无效时会从不消费的 master 副本原子恢复尝试前文件；恢复再失败会保留并输出绝对恢复
  路径。最终 verifier 在清空环境后复用旧 release 的完整验收。临时目录行为测试覆盖坏
  权限/软链接零写入、commit 后保持、Nginx 部分恢复失败、PM2 异常状态和 verifier 首次
  失败后的重跑。
- 新 release 的 root-side build handoff 已迁入版本化
  `scripts/deploy/prepare-release-runtime.sh`：input manifest v2 绑定 executable bit，build marker
  v2 聚合绑定 `.next` / `node_modules` 的内容、类型、安全 symlink 与计数；builder workspace
  冻结后以禁用 reflink 的 root copy 生成新 inode，`.next/cache` 从不可变闭包排除并以
  `diesel:diesel` 0750 重建。目标端全量复算后才生成 `root:diesel` 0640 的 deploy-ready
  marker，首次切换前还必须由固定 Node 执行 `check-ready`。该命令现会重新哈希实际
  `.next` / `node_modules`，逐文件重验 input manifest 的 tracked 文件/目录集合、内容、大小与 executable
  bit；生产 CLI 强制 root controller 与 distinct non-root runtime profile，并以显式数值身份重验
  immutable `root:diesel` 与 runtime `diesel:diesel` 的 owner/group/mode。deploy root、`releases`
  和 release 根也会在完整检查前后保持 controller/immutable 对应的真实目录与固定 metadata。
  `shared` 必须是真实中间目录，环境目标固定 0640 单链接，数据目标与唯一可变 cache 固定 0750；
  candidate 交接还拒绝 nested filesystem，依次 `sync -f` release/父层 filesystem、fsync marker/
  工件根/父目录并从 durable bytes 再次全量 `check-ready`，成功后才清理 workspace；handoff 失败
  保留冻结 workspace/HOME 供人工取证。finalize 后工件、Nginx、ecosystem、额外输入、空目录、
  权限/所有权或链接漂移均失败关闭，不再只比较两份 marker。历史 rollback 继续接受旧 release
  的普通 readiness 文件并运行其自带 verifier。该摘要只代表单次构建交接完整性，不是签名、
  SBOM 或可复现构建证明；本节仍是本地待发布状态。
  CLI 主入口先 realpath 后再判断是否执行，因而通过 symlink 启动也会进入参数/生产 profile 校验，
  不会静默返回 0；非 root 完整路径测试只使用测试进程内联 harness，仓库不再包含可执行的宽松 fixture CLI。
- post-build-ready 的 Nginx / `current` / PM2 激活已在本地迁入版本化
  `scripts/deploy/activate-host-release.sh`；runbook 不再内联复制这一段 root Shell。生产 CLI 只接受
  严格小写 40 位 SHA 并固定所有主机路径，且必须在同一发布 shell 中继承已锁定的 FD 8 与
  `PENDING:none`；source-only 的 12 参数入口只供隔离 fixture 使用。父 shell 现以前台
  `/usr/bin/env -i` 和固定 `/bin/bash --noprofile --norc` 启动 clean child，只保留 HOME/locale/PATH
  与 FD 8 marker；已经打开并持锁的 OFD 继续继承，`BASH_ENV`、exported functions、startup hook、
  服务秘密与测试 seam 不进入 child。脚本在首次写入前重新执行完整 `check-ready`，复核 previous
  `current` 和 ledger 绑定的 Nginx rollback basis；两份 Nginx 配置先在同一 sites 目录 staged，
  完成 canonical owner/mode/单链接/字节校验与成对离线 `nginx -t`，再在重验 live inode/basis 后
  分别 atomic rename，避免原地截断 hardlink 或跟随 raced symlink，并完成 post-check、正常
  `nginx -t` 与 fsync。`current.next` cleanup 在创建前已生效；SIGKILL/掉电残留只有在 raw/resolved
  target、root-owned 单链接 metadata、同 release `PENDING:none`、previous current 与 rollback
  basis 全部闭合时才自动删除并 fsync deploy root；host orchestrator 的 rollback terminalizer 也会在未提交的 PENDING/HREQ
  分支、首次 host restore mutation 前验证并收敛同一对象，check 模式保持只读。其他对象保留并失败关闭。其后仍按原子 current
  切换、clean-env PM2 重建、进程身份、有界 loopback readiness、durable PM2/systemd readback 和
  Nginx reload 的固定顺序失败关闭。它不执行任何 ledger transition，也不清除 orchestrator 的 rollback trap；
  失败由既有版本化 host rollback 收敛，成功仍须完成治理 publish/finalize。本轮安全审计修复不改变
  commit point、ledger protocol 或数据库 schema；尚未部署到 VPS，也不构成生产激活、回滚或断电
  恢复演练证据。
- normal path 的 backup→环境候选安装→prepare→activation→governance publish→finalize 已进一步在本地
  收口到目标 release 的版本化 `scripts/deploy/host-release-orchestrator.sh`；runbook 只以前台
  `/usr/bin/env -i` 调用该入口，不再拥有跨 Markdown block 的 trap 或状态分派。orchestrator 单一 root
  进程持有 durable rollback basis、FD 8、`--begin-activation`、候选安装/readback、controller 调用与
  abort/recovery terminalizer。新环境只接受预先创建于固定 release input 目录、`root:root` 0600、
  单链接、非 symlink 且不超过 1 MiB 的候选文件；它以 O_NOFOLLOW 读取并校验 UTF-8/env/生产
  `DATABASE_URL`。本地新增的 release 内 dependency-free 合同还会在任何本次 state mutation 前
  分别校验 AI 日准入与小时准入：日 global/client 两值必须存在、为安全整数和 5 的倍数且
  client 不大于 global；小时 global 可缺省为 10000，小时 global/client 都必须为 1–10000 的整数且
  client 不大于 global。staging 及安装后 live readback 再次校验；显式 rate-limit backend 必须为
  `postgres`，缺省沿用生产默认值，失败不输出环境原值。安装后把 backup/candidate/live 三方数据库
  身份逐字节绑定，关键区间不再依赖交互 shell 的导出状态。controller 只以前台 clean child
  串行调用现有组件，每个边界重验 V1 `PENDING:none` / current，并在 publish 返回后复用 strict
  ledger parser，不再用 Markdown 中的裸 marker 存在性判断。只有 exact
  `COMMITTED:PUBLISH_FINALIZED` 才可能返回 0；已有 terminal 的 retry 还必须 fresh finalize 返回 0，
  不能让旧 tombstone 掩盖 live host/public/current/lock 失败。controller main/wrapper/reconciler
  三层 signal supervisor 已分别用真实 detached process-group SIGTERM 回归；测试覆盖 pre-commit
  143、commit-shaped 75、finalize 未收敛 75 与 fresh durable terminal 胜出为 0。外层 orchestrator
  在可能写入 PENDING 前已安装 HUP/INT/TERM/EXIT trap 并 armed rollback，begin/controller 都作为
  独立 process group 受监督；父 PID 单独收到信号时，trap 与注册后补发共用单条 arithmetic claim，
  因而每次 supervised child 恰好转发一次，并在终态分类后恰好 rollback 一次或保留现场。动态故障
  注入覆盖 spawn→PID 登记、登记→补发两个窗口、HUP/INT/TERM、controller 0/75/其他、FD 先关闭再
  abort/recovery、毒化环境和错误输出不含秘密。fresh staged `root:root` 与 normalized
  `root:diesel` 输入按目录、可执行和普通文件的精确 0755/0750/0644/0640 闭集验证；preparer fixture
  模拟 metadata 转换顺序，本地非 root 测试不声称执行了真实 chown。publication 启动还先用绝对
  `/usr/bin/stat`/`realpath` 和 Bash `EUID` 证明固定 Node/本地命令目录，再让 root 编排只搜索
  system PATH；固定 Node 与 canonical PM2 脚本均由绝对路径执行，完整 application PATH 只进入
  非特权 child 或期望状态校验。maintenance wrapper 与 governance child 也绑定目标 release 的
  绝对路径。六个生产特权 direct CLI 现都在首次 source 版本化 sibling 前绑定严格 SHA 与各自的
  `/opt/diesel/releases/<sha>/scripts/deploy/...` 入口，并用不依赖 sibling 的 validator 先闭合目录链、
  entry 及 ledger/helper 的 canonical、非 symlink、owner/mode 与单链接要求。controller/prepare
  接受 staged 或 normalized 二态；受支持的 production direct activation 只接受 normalized release，
  并在其合法 source rollback 前同时验证 rollback 与嵌套 ledger。production deploy root 不可覆盖；
  source 后显式调用的 bootstrap 与 primary seam 均以 64 拒绝字面量 `/opt/diesel`，
  这些 guard 加 controller 三个实际 child runner 还会识别重复/尾随斜杠和由固定 realpath 解析出的
  既存 production-root alias；alias 分类除固定 realpath 外先于 bootstrap metadata/path validator 与
  后续 dependency source。poison-marker 回归证明目标依赖验证失败不会执行待加载 sibling 顶层代码。
  脚本最初作为库被 source 时会传播相邻 sibling 的原始非零；source 后显式调用 bootstrap 时则分别
  映射为 controller 75、prepare/activation 70，不会被 cleanup 吞掉。
  这些 sourceable seam 只供隔离 fixture，guard 仅减少误用；Bash helper/变量可被 root 重定义或直接
  调用，source 模式不是 capability 隔离。受支持生产路径仍只允许 orchestrator bootstrap 后的 clean-env direct
  CLI。controller 的 executable
  inventory 也包含 rollback helper，使该文件在 host mutation 前发生 metadata 漂移时按 ledger 状态
  失败关闭。由于 entry 无法在 Bash 打开自己之前自证字节，normal path 还在创建本次 state 或执行
  首个目标 release child 前，由 orchestrator bootstrap 在不加载 sibling 代码时重验固定主机目录、
  自身加其余六个 executable、maintenance wrapper、live env、lock、backups 与 Nginx 的 canonical
  非 symlink metadata；文件还要求单链接。固定命令闭集包含 ledger 所需的 `/usr/bin/find`，direct CLI
  在读取任何 root-only 路径前先以 EUID 拒绝非 root。该检查与此前 manifest/digest 读回及 root-owned
  不可写交接共同构成 entry→sibling
  信任链。该检查不是同 FD 执行，也不声称抵御并发 root 修改或遗留可写 FD。严格分类前失败保守返回 75，已知
  commit-shaped 后的任意非零 reconciler 结果也归一为 75。明确 pre-commit 失败由 orchestrator 恢复，
  publish 后 commit-shaped、无法严格分类或 finalize 未收敛则返回专用 75；orchestrator 对 75 关闭 FD
  并保留现场，不自动 rollback，供人工前向修复。
  controller 不迁移 ledger、不 rollback/recover、不关闭 FD 8；publish/finalize 的两个 maintenance
  session、唯一 commit point 与锁释放窗口均未改变。该改动仍是本地待发布，不表示目标 VPS 已执行。
- 当前中英文等价 system instruction 为 `sales-chat-system-v7`；来源标题和引用原文保持
  原始语言；live eval 评分合同定义并版本化为 `sales-chat-live-v25`。v5 起还要求全部稳定事实/带极性决策/免责声明 anchor 与
  请求语言匹配；产品 ready 同时要求合规适配通过和供应就绪，否定候选不能借关键词通过。
  v6 强制远端 adapter 请求流式 usage，将每次模型调用的 retry 固定为 0；v7 再把单次输出
  限制为 1,024 token，记录 18 × 5 次调用的 92,160 最大潜在输出，并把 160,000 总 token
  策略明确标为 `post_usage_acceptance`。v8 进一步要求安全关键型拒绝同时满足证据关闭、
  整题拒绝处置与回答 grounding，并拒绝“先拒绝、后附加强肯定业务结论”的矛盾回答。
  v9 再把任何 observer 已报告的 provider stream error 固定判为
  `EVAL_CASE_ERROR/not_evaluated`，即使 SDK 便利 Promise 随后以 fallback 值正常 resolve；
  已知 token ledger 会保留，但 fallback 文本不能参与评分。知识检索 `query` 落盘时只保留
  字符数与 SHA-256 摘要，原文仅在进程内供工具和参数判定使用，不进入 latest 或 archive。
  v10 会先以对应生产 Zod schema 校验每次工具输入；其中模型知识检索由生产聊天与 eval 共用
  同一额外拒绝私有推理标签的 schema，再把 `query`、产品型号、指标代码和非空
  辖区 ID 等 provider 可控自由字符串按 canonical 值替换为字符数与 SHA-256 摘要；知识检索还
  只保存命中、缺失和命中禁用项的有限契约 ID。query 规范化移除默认可忽略字符，Latin token
  只在 Latin/数字/下划线边界上失败，允许普通中英脚本切换。runner 即使已有其他参数错误也独立
  保存并校验该观察，verifier 从 canonical group ID 重算；原始词面仍不会落盘。无效输入只保存
  `{}`，且 v10 schema 将该哨兵绑定到 `TOOL_RESULT_ERROR`。产品型号上限按 canonical Unicode
  code point 计数；大小写扩张可能让合法 100-code-unit 输入形成最多 300 个指纹字符。
  v11 再保存生产流已归一化的逐 step 基础/cache token、provider response、完整 step 和
  模型首输出时间，并从这些行重算 case aggregate、attempt coverage、performance completeness
  及报告级 nearest-rank p50/p95/max。缺失或部分缓存/时间字段保持缺失或部分；不保存
  prompt、回答、原始 usage、endpoint 或 pricing profile，也不新增 provider 私有缓存参数或任意
  延迟/命中率门槛。v11 原子 schema 从保留字段独立重算 step token completeness、cache-status
  兼容性及 completed call/ledger/step 的五步算术，拒绝矛盾行。v12 保留 v11 字段集合，但把
  `tokenUsage.ledger` 明确定义为已完成 provider-call 的唯一计费行，把
  `modelObservability.steps` 定义为实际完成的 SDK step 行；正常路径二者一一对齐，provider 已完成
  但随后工具/流终止时允许计费行恰好多一条，反向关系或差值大于一均判为不合法。模型名与最终
  report model ID 共用 strict 合同，runner 在持久化前解析整份报告；verifier 对全部现代 v3–v25 归档执行版本化
  strict parse，两份早期现代 v2 只以冻结全文 SHA-256 兼容。最新运行身份与结果只以上方受控台账为准；
  报告自洽性通过本身不形成 provider 模型质量证据。
- v13 评分合同规定：ISO 日期及应用自身的中英文 UTC 日期表达等价；
  数字边界拒绝把其他年份或日期的子串计为命中。日期锚点仍要求同一天，证据期望和全部门槛
  不变，也不回写 v12 历史判定；变更理由与误判复现见 [评估说明](evals/README.md)。
- v14 修正另一个已离线复现的日期误判：生产 Zod transform 会在 SDK 返回工具调用前补上
  `getCountryProfile.asOf`，v13 却把该应用补全字段当作模型多传参数。v14 仅为未明确期待日期的
  国家画像调用补入当次 UTC 日期作为必需期望字段；错误日期、缺失补全字段、显式用户日期
  漂移与其他额外筛选仍失败。18 个案例、用户请求、证据期望及门槛不变。
  生产聊天与每个评估案例均捕获一次 server-only `runtimeContext`，提示、工具和证据合同共用
  该 UTC 时钟；报告与 sidecar 保存并绑定它，重算不读取当前墙钟或报告结束日，跨午夜也保留
  原查询日期。schema 拒绝日期/时间不一致、倒序或晚于报告完成的时钟。
  不新增公开请求字段或数据库列。当时保留的 v13 失败报告不证明该日期修复已调用模型
  或通过验收；旧报告不补造时钟、不改分，最新观测仅见规范台账。详见 [评估说明](evals/README.md)。
- v15 修正另两类离线复现的评分缺陷：明确请求非道路来源的两个案例现在要求相同 metadata scope，
  不再同时出现“省略 scope 才能参数通过、传入 scope 才能证据通过”的矛盾。无范围请求的 sentinel
  不增加过滤条件；18 个案例的用户原文、证据允许/拒绝期望与阈值均不变。
  回复评分区分可见文本、原子值与引用/代码/删除线示例，保留移除内容的边界；型号、词语及功率
  不再采用无边界子串匹配，普通强调格式及等值十进制功率仍可通过。明确否定、假设和未确认的
  产品/供应结论不能冒充肯定结论；既有矛盾结论与整题拒绝检查保留。该合同是有输入/工作量上限的
  确定性词法检查，不宣称通用 Markdown/NLI 或完整事实正确性。v14 历史 schema 保留；该修复
  当时只保留 v13 的失败观测，没有补造 v15 模型成绩或重算旧报告。
- 历史 v16 曾把原文、章节和来源提示词拆为三个必选 query 组，以对齐当时的生产门槛；该规格
  用旧门槛作为正确性依据，未核实实际交付是否已经相同，现由 v17 明确纠正，旧 schema 仍可读取。
- v25 为现行法规核对补入有限主题短语 `现行法规`。v24 国家切换案例的公开回答已说明
  BRA 在指定日期/用途/功率下的适用现行法规、生效状态和限值；该请求更正到单个国家，
  并不要求跨国比较。普通法规名称或状态标签仍不足以命中主题，引号/代码里的示例不算回答。
  独立国家、用途、功率、日期、免责声明及整题拒绝检查继续绑定；18 条原始请求、期望工具/
  参数、证据期望和全部阈值不变。v24 实测 `1a779346-c4b2-42fd-b741-1c957b872fa4`
  的原始字节及 13/18 失败结果保留，不恢复未保存的 query 或同次 locale 标题名单，不重评分；
  v25 必须获得新观测，实际执行身份/结果只以上方受控台账为准。
  同批分离可信来源请求里的明确末尾停止控制句和完整声明的粘贴不可信数据段；只投影请求侧，
  不忽略模型实际 query 中的新增词，也不解除基于完整 userTexts 的安全拒绝。完整 term 检索
  包装保留上下文/字面词，原生约束和实际来源交付要求不变。合成对照证明解析冲突，但 v24
  两个工具错误的原始无效参数未保存，不据此宣称已确定那两次错误的直接原因。
  locale 评分仅中和同次可信完整标题在受支持来源字段中的字节，保留技术字段/locator/ID/
  正文的原比例；仅含已识别 citation 容器和固定免责声明的回答仍是 indeterminate。
  未知/变形/后缀标题、任意括号正文及外层引用/代码不获豁免，不下调语言或其他门槛。
  v25 实测 `618021e3-2a3c-494c-8cb4-7d7c75c2314d` 首次 provider 请求返回 HTTP 403，
  无已完成调用/step，首例记为 `EVAL_CASE_ERROR/not_evaluated` 并停止，未重试。
  usage 未返回，已知下界 0 不等于零消费；该不完整失败不构成模型质量成绩，也不证明拒绝原因。
  2026-09-14T07:21:52.676Z 的另一次独立最小访问诊断使用相同模型和北京端点，关闭思考、
  最多输出 1 token、不重试；450 ms 后收到 HTTP 403 / `AllocationQuota.FreeTierOnly`。
  这明确了该次请求的免费额度限制，但不反推原 v25 拒绝的具体错误码；未收到 usage，不能
  称为零消费。该诊断不属于 eval、不产生模型质量成绩，原 latest/archive 字节保持不变；
  账号认证及免费额度用完即停设置尚未检查或修改。
- v24 纠正两项额外评分缺陷：完整引号/反引号中的 HTTP(S) URL 不能再由路径假补缺失的
  国家或日期；原子 URL 整段省略并保留屏障，正常 inline 型号、日期、功率及可见链接标签不丢弃。
  同次 v23 实测 `c436f8a3-5bd9-47af-b011-54e2bae4fad6` 的完整回答已明确确认适配与
  supply availability confirmed，并说明查询日落在供应期内、可用性检查通过；商业 ready 定义
  即 fit + availability pass，不要求逐字复述字段名。等价供应短语的支持必须同时拒绝
  “确认不可用”、随后撤回确认及商业状态 unknown；不以裸 availability/日期区间/generic pass
  代替供应肯定，也不改事实、独立 fit、免责声明、证据门、18 条案例或阈值。
  v23 来源案例的主题约束失败与此不同，不推测已丢弃 query。原始 v23 字节/16 条通过结果
  原样保留，不重算或改标；新版本需独立观测，当前实际结果仍仅见规范台账。
  同批将既有来源业务词完整性检查复用于动态模型输入边界，保留最终证据门。新建的明确合成
  缺主题查询证明旧路径会先执行检索再拒绝；并非恢复 v23 原始 query。模型 schema 以有界数据
  提示可信保留请求，检索前拒绝缺主题或额外无关词，普通交付 cue 的可选规则与原生查询约束不变。
  不拼补参数，不引入 eval 专属词表，不洗白原始错误审计，也不宣称后续正确调用可擦除同轮失败。
  集成检验同时修正原有中文请求包装误识别：`查询` 不再残留 `询`；明确日期 metadata 的窄连接
  `的` 和普通交付 cue 之间的 `与` 不作为业务词，不增加全局停用字，也不丢弃引号/标识符/正文
  的相同字符；原中英 SSE 来源字段测试的请求、fixture 和内容期望不变。
  拒绝输入测试还复现了完成日志误分类：`invalid_projection` 过去被记成预算超额，现仍停止与
  拒答但记为 `TOOL_RESULT_ERROR`；真实 step/turn bytes 或 result count 超量仍记预算码，
  不更改 provider 调用或已知 token 账本。
- v23 修复 v22 实测 `e65628f1-14ce-4985-bb21-5b35f733e2c3` 已公开完整回答中的裸 URL 边界误判：
  来源链接紧邻右括号与下一处 inline 标题时，不再吞掉后续反引号并误报整段代码未闭合；
  同类离线反例中紧邻链接的中文否定更正也必须保留，不能被 URL 遮蔽。链接地址仍不提供事实
  anchor，移除边界仍不拼接事实，真实未闭合 inline span 仍整份失败关闭。未新增主题/决策词表，
  未改案例、事实或门槛；v22 原失败报告不重算、不改标，新版本需独立实测。
  同批修复 v22 排序投影使既有中文来源纠正流程在桌面/移动浏览器失败的回归，不改浏览器期望。
  同一实际 Demo 查询的候选仍存在，但原始完整分数 0.307207 被投影降至 0.224570；现仅在
  内部投影确实改变 query 时保留两路各 top-100 候选，以同一 SQL/治理快照及原约束获取最多
  200 行内部候选。每路独立按原权重和相关度门判定，再按 chunk 选择较好的完整分数对，
  平局优先原查询；不跨路径拼 keyword/vector 高分，公开排序/limit 不变，内部路径标记不出网。
  默认/无变化/保护查询仍单路，不增加模型或远端 embedding 调用，不改数据/schema/存储向量。
  失败采集没有替换原有成功浏览器证据；当前代码验收情况必须以重新执行并绑定源码的证据为准。
- v22 修复 v21 实测 `828326f9-615e-454b-8d80-84c7cda21f41` 已公开回答中的嵌套列表误判：
  合法父项下的“生效法规”不再被当作缩进代码丢弃；同样保留后续子项的否定否决。
  有界无序列表最多 16 层，代码、引用、HTML、示例/假设语境仍受约束；跨列表项不拼造
  功率等事实，超深或解析预算耗尽则整份回答失败关闭。没有新增词表、改案例预期或降门槛。
  同批另经真实离线数据库成对复现：仅追加 sections 交付提示会使已有来源候选跌出相关度门槛。
  v22 AI 来源工具以固定内部选项，仅在 keyword/查询向量排序文本中中和既有交付提示；
  原 query、原生约束、metadata、返回查询、审计及正文/locator 证据门全部保留，复杂操作符
  查询保守不投影，开发知识台默认不变。没有更改 0.25 阈值、权重、存储文档及其 embedding。
  这是独立复现，不推定为 v21 丢弃 query 的原始原因；历史报告原样保留，新实测仅以上方台账为准。
- v21 修正同次 v20 实测 `759491f1-a601-429f-b96b-8fa971bdae5d` 暴露的三条评分误拒：
  两条中文正文按要求保留大量英文来源标题，导致字符比例误判；现在仅在语言投影中中和
  同次通过 Zod 与证据合同的 citation title/sourceTitle 的完整配对 inline 引文。标题数量/
  字节有界，裸文本、locator、状态值、未知标题、较大引文、跨行和代码块不剥离；语言阈值不变，
  原始正文继续用于事实、决策极性与免责声明评分。runner/verifier 独立从工具结果派生标题集合。
  另补实测已有的“法规详情”主题词，所有具体事实仍独立校验。该 v20 实际为 14/18，
  还有一条来源证据拒绝不能归因于评分误拒；不猜测已丢弃的原 query，不反转案例期望。
  v20 原字节与判定保留，v21 需要独立新实测；未改 fixture、prompt、工具参数、证据期望或门槛。
- v20 修正 v19 部分实测暴露的错误报告表示缺陷：一个带工具步骤完成后，下一次 provider
  调用超时，runner 保留已知步骤及 token，但完整工具轨迹被 SDK 失败清空；旧 verifier
  因为“有工具步骤但无工具身份”拒绝该报告。新行显式记录 `toolTraceStatus`：正常完成
  必须 `complete` 并保留原工具不变量；只有完整执行异常哨兵可为 `unavailable`，要求工具/
  参数/命中锚点为空、回答 `not_evaluated`、正文长度 0、无通过指标、usage incomplete。
  已知步骤和账本不归零，未知工具身份不猜测，步数与零重试调用上限继续校验；业务案例、
  证据期望、回答锚点及门槛不变。v19 原失败报告和校验缺陷按原字节保留，不回填或改标。
- v19 修正 v18 后另一独立定向观察复现的法规主题误拒：混合请求的公开回答已用“现行有效法规”
  及“法规状态”区分 effective 与未来 adopted 法规并说明产品适配，但主题锚点仍拒绝。
  现在仅补 有效法规 / 法规状态 两个等价主题词；它们本身不证明法规状态正确，结构化证据和
  国家、功率、日期、产品、适配结论及免责声明仍须独立满足。引用/代码不能提供主题，错误
  事实仍失败。18 个案例、工具参数、证据期望、指标 ID、阈值、prompt 和 fixture 均不变。
  后续诊断命中市场指标 ID 不推翻 v18 原失败；v18 原字节/判定保留，不改分、不改标。
  同轮生产来源工具把唯一明确用户 scope 收窄为必填单值，不自动补参数；正确首轮取证后
  既有 loop 关闭工具。中文交付 cue“章节和来源证据”之间的普通“和”不再被误当必需业务词，
  仅修正证据词投影；实际 query、其他业务/引号/符号/ID 词、检索阈值及来源定位要求不变。
  无新数据、schema 或依赖；这些代码修正不回填 v18 历史成绩。
- v18 修正独立定向生产路径观察中复现的回答锚点误拒：已经表达的 market data、market metrics、
  生效法规，以及明确的 regulatory fit / commercial readiness marked as ready 不再只因措辞等价
  而失败。双轴结论仍必须同时成立，否定、未知、假设、整句引用、后续反向断言与词边界仍有
  对照回归；国家、功率、日期、工具参数、证据期望、案例身份、语言、阈值和 prompt v6 不变。
  这是有界词法合同的修正，不是通用语义判定或法规事实认证；新观察不能还原旧报告丢弃的正文。
  v17 报告仍按原字节与原判定保留，禁止改标或回填；当前是否存在对应版本的新实测以台账为准。
- v17 区分业务检索词与来源交付要求。既有虚构 Demo 的实际工具对照表明：省略普通交付提示词
  时原文、document、page/section 和引用完全相同，旧门槛仍过度拒绝；高重合查询要求第 2 页/
  section 2 时却能带着仅第 1 页/DEMO-SECTION-1 的结果通过。低召回查询全部无数据并不能发现后者。
  现在正文放行必须有实际非空 untrusted 原文、相同 chunk/document/source 及定位的引用，明确
  页码区间须无空洞覆盖，明确章节只匹配专用 locator metadata；不能用 query 回显、高向量分、
  正文数字或不同命中的原文/定位拼接替代。普通交付提示词可省略，但业务主题、引号/带符号字面词、
  ID、精确引用、国家/scope/asOf、原生语法与发布/相关度边界保留。该规则不证明来源真实性、
  全文完整性或任意定位格式等价。单测、实际 Demo 工具、生产 SSE mock 与中英桌面/移动回归
  分别检查参数、检索和交付；不能把这些控制称为真实模型成绩。
  18 个案例的原文、工具/参数、证据期望、locale、回答合同、安全标记和阈值不变；仅移除普通交付
  提示词的 query 必选组，业务组、sentinel 与注入/外传排除组不变。时钟/ledger、system v6 与
  observation v2 格式不变，生产交付门同时用于当前 observation 重放。没有新增资料、schema、
  依赖或付费调用；该修复当时保留的 v13 失败观测不重算，最新观测仅见规范台账。详见 [评估说明](evals/README.md)。
- 非道路英文来源检索修复 `nonroad` / `non-road` / `non road` 的拼写不一致：
  原先无连字符写法既无法命中现有 Demo 文档，也不被生产证据词校验视为等价。现在仅对
  独立普通词增加一次参数化 native parse，在有界 AST 上展开完整短语，保留否定、词序、
  间距和复合标识符；超限或不支持的语法整体退回原生查询，数据库异常和取消不吞掉。
  实际工具回归验证三种写法都能返回同一既有来源与章节，原文、embedding、元数据过滤、
  来源概念要求及相关度门槛不变。未新增 fixture、schema、依赖或付费调用；18 个案例的
  当时规格为 v16（当前已升级为 v17），当时保留的模型观测为 v13，不能把本地检索修复称为新的模型成绩。
  对话上下文同步绑定新增拼写的明确 scope，国家追问保留功率和日期；Unicode 标识符
  不触发额外拼写解析。浏览器回归明确检查查询卡的非道路条件，不只检查引用是否出现。
  成功的知识检索卡现在也展示既有双语查询摘要（国家、scope、日期与原始检索词），修复
  摘要组件已支持知识检索、但原先只在失败卡上渲染的遗漏；明确 scope 的请求不得接受省略
  该筛选条件的工具结果，即使结果仍带同一组来源引用。
  扩充后的桌面/移动 Demo 用例共享 loopback 客户端桶，Playwright 的本地离线服务显式配置
  每小时 global/client 10000 容量；不修改生产限流默认值、配额实现或限流安全测试。
- 来源查询补上两层原生约束：生产多步流在工具执行前拒绝模型对排除、明确短语和 OR 分支的
  非等价改写，并保留一次失败审计；检索候选在向量排名前应用相同硬约束，不能凭高相似度
  返回被明确排除的文档。普通正向词仍允许语义召回；既有词形/非道路拼写和 native 布尔语义
  保留，结构等价检查不宣称通用自然语言或布尔代数等价。数据库异常与取消失败关闭。
  本地原生数据库、Mock 生产多步流与 API SSE 回归覆盖拒绝路径及等价改写正常放行；未新增
  fixture、schema、依赖或付费模型请求，历史模型报告与生产 release 状态不变。
- 应用场景识别不再让产品 ID、URL 或 `reconstruction` 等普通词中的子串覆盖明确用途。
  有界中英文否定与更正支持 `not marine`、`不是船用`、`actually use non-road`、`改为非道路`；
  被否定的更正不会反向切换用途。互斥用途及无法表达的排除形成内部 scope conflict，
  后续只换国家不能恢复旧 scope，来源检索也不能把冲突误当成无筛选条件。
  明确一个用途后解除筛选冲突，国家、功率和日期按字段保留；描述层级允许“非道路工程机械”，
  但 `non-road or construction` 不擅自缩窄。它不是通用语义理解，也不扩展法规适用性。
  实际既有 Demo 工具与生产多步流回归验证否定/更正后的充分证据可放行；英中文桌面/移动
  回归验证先澄清再恢复精确法规查询。没有新增真实产品、schema、依赖或模型调用；
  未修改评估案例、门槛或既有模型报告，数值仍只以上方受控台账为准。
- 本地来源追问现在共享完整主题重建：只换国家、修正用途或续查章节时保留原文、章节和来源
  交付要求；独立国家名称与用途可以更新，文档 ID、URL 和引号内日期不被替换。
  `section.1` 与 `v2.1` 的独立简写按类别更新，复合文档编号保持精确匹配。
  Demo 剥离受控检索命令与已由 `asOf` 约束的日期短语，不把这些控制语混入全文检索；
  保留原 OR、引号和排除词，不降低相关性或证据门槛，不截断超长查询。
  中英禁止用途转换与用途排除分开处理，已有冲突仍需用户明确解决。
  真实只读工具回归覆盖既有虚构资料的命中与缺失交付要求的拒绝；中英桌面/移动流程覆盖
  先无资料、修正后有证据、禁止转换后保持条件及再换国家无资料。
  这些结果仅为本地修复证据，全量验收以受控工件为准；旧模型报告保持原样，未发起新收费调用或部署。
- 来源查询的应用重建现在保护引号内字面内容：国家 alias、用途、章节、功率和日期只从
  引号外推导/更新过滤上下文。修复前，`"China non-road"` 会被改成 `"CHN non-road"`，原本
  不匹配的查询由此命中现有虚构来源，而且被改写的期望同样能通过模型守卫。
  现在字面引用与普通可更新引用分开；跨行/未闭合引号内日期不被删除，新关键词不会追加进
  未闭合短语。普通控制型追问仍能更新明确参数；中文弯引号的字面保护不冒充原生短语检索。
  真实只读 Demo 工具、Mock 生产流与中英桌面/移动回归同时验证拒绝路径和用户显式新查询的
  正常命中。没有新增数据、schema、依赖、提示版本、付费调用或模型成绩，历史报告保持不变。
- 来源查询进一步保留带符号词元。修复前，`-China` 被改成 `- CHN`，使既有 Demo 的有证据
  查询变成无结果；`-BRA` 还会错误增加巴西 requirement。现在这些词不参与国家、用途、
  日期或章节筛选推导/改写，双负号也保留原字面词，并由完整查询词合同继续约束。
  简单来源追问追加的排除词随原主题保留；OR 分支或夹带新检索文字的歧义追问要求用户
  重述完整查询，不能静默丢词或只修改末尾分支。中英澄清复用服务端直接响应路径，
  evidence contract 独立失败关闭。进一步修复了追问中排除词紧贴逗号/分号日期短语时，
  先截取词元会把 `as` / `截至` 拼进排除条件的问题；既有 Demo 中本应排除的资料曾因此返回。
  现在首问与追问都先处理完整日期短语再截取词元，独立 `asOf` 及引号内字面日期保持各自语义；
  删除短语时保留词间边界，后接的未知文字不得粘进排除条件，仍走完整查询澄清。
  真实检索与生产流回归同时要求正确排除和有证据查询正常放行。没有修改数据库、资料、依赖、eval 案例/版本/门槛或
  既有模型报告；仅为本地待发布修复，不构成新的模型效果或生产发布证明。
- 国家深链在 scope + power 齐全时服务端渲染确定性决策摘要；完整 UUID、辖区与来源
  追溯默认折叠。`pnpm demo:fde` 可在隔离 PGlite 中演示 CSV → Draft → Review →
  Publish → Query → Archive，始终标记 `LOCAL / MUTABLE / FICTIONAL`。
- [本地证据练习](LOCAL_EVIDENCE_LAB.md) 提供中英双语自助请求、预期结果、错误定位与
  交接清单，仅使用现有离线 Demo，不构成真实用户交接或采用效果证明。逐条试跑发现并
  修复了离线模型的单国法规路由偏差：有 scope + power 的查询现在选择生产合同要求的
  `compareRegulations`，不再调用未开放的宽泛 `getCountryProfile`；FJI 的合法无数据
  结果可显示完整查询卡和具体证据缺口。生产证据门槛、目录/产品 fixture 与 schema 均未改变。
- 本地待发布的 `ai:eval:live` 由不加载应用代码的纯 ESM bootstrap 启动；在 fork 前固定
  PGlite、远程模型 adapter、streaming usage 与内存 rate-limit 环境。runner 自身也先设置
  同样的变量，再动态导入应用配置，修复 sales-chat 静态导入使 `src/env.ts` 提前
  缓存旧 usage/Demo 值的启动顺序错误。真实 Node ESM 子进程回归使用合成凭据，覆盖
  继承冲突值和缺省值，确认配置解析一致且无网络调用、数据库初始化或报告写入。
  `.env.local`、tsx loader
  与 runner 均位于可捕获边界之后。固定 watchdog 把 provider 前初始化限制为 60 秒，把 provider
  运行限制为 `18 × 90 秒 + 120 秒`。隔离 deep verifier 的执行上限为 5 秒，完整 receipt 阶段为
  10 秒，runner 等待 report ACK 为 20 秒，ACK 后退出为 5 秒；超时先 SIGTERM，2 秒后升级
  SIGKILL，再过 2 秒无法确认回收也由 parent 非零结束。首次合法 provider 边界在 ACK 前不可逆
  提交；未知、畸形或乱序 IPC 会标记协议失信。child 对已持久化 canonical JSON bytes 发送只含
  版本、运行身份、长度和 SHA-256 的 UUID-matched receipt。parent 对 archive/latest 使用 8 MiB
  上限读回并核对 canonical encoding、digest、最小 envelope 与 latest 关系，再把同一份 receipt
  绑定 bytes 交给清除 provider/database/proxy 环境的独立 verifier child；该 child 复用
  `portfolio:verify` 的当前 suite 纯一致性入口，重算逐例判定、score、threshold、token ledger、
  termination 与 observability；它从 STATUS 读取静态 model/profile/version/suite，成功候选必须重算为
  complete、threshold true 与 18 cases，且绑定 current HEAD、dirty/clean evaluated commit 和 clean
  commit-tree fingerprint。verifier 使用固定 system-only PATH 与可信 system Git，不继承 caller PATH。
  parent 只在 verifier strict
  receipt、实际 exit 0 与最终 archive/latest 二次读回均成立后推导 `0 | 1` ACK，再核对 runner
  实际退出码。只有 runner 已确认退出、从未观察到 provider boundary 或 receipt、且协议未失信，
  bootstrap 才可写零调用初始化报告；其他失败均不得虚构零调用历史。
  可能 ACK0 的报告还必须通过 IPC v2 提供不落盘、无 user prompt/expected judgement 的
  `sales-chat-live-observations-v2` 内存 sidecar，并与 report identity、canonical byte length 和 digest
  双向绑定；失败报告必须使用 `null`。isolated verifier 从 canonical 18 cases 重算正文、tool/result、
  evidence/judgement、token 与 observability，固定 8 MiB 总上限及各 case/response/tool/step 数量上限均
  失败关闭。该 sidecar 只证明 scorer/report 没有意外漂移，不证明 provider 真实调用，也不防同权限
  runner 同时伪造 report 与 sidecar。
  sidecar 每 case 还含有界去重的 boundary-rejection 稳定枚举与 stream completed/error 布尔值，不含
  原始错误；ACK0 要求 completed=true、error=false、boundary=[]，并由 verifier 推导 error/evidence。
  持久化在首次创建 archive 目录后 `fsync` eval 父目录，并在 archive hard-link、临时名删除和
  latest rename 后同步对应目录；只有 latest 目录项同步成功才声明更新完成。
- 当前 live-eval 证据台账：`passed`；evaluatedAt `2026-09-29T12:12:41.562Z`；run ID `4813db2e-a696-47f1-a4e6-bf8335389f89`；`18/18 cases`；`complete=true`；`terminationReason=completed`；`37 provider attempts`；`37 completed provider calls`；`37 model steps`；
  `97047 known tokens`；`tokenUsageComplete=true`；`thresholdsPassed=true`；`runError=none`；`suiteVersion=sales-chat-live-v25`；`reportVersion=sales-chat-live-v25`；
  archive `docs/evals/archive/ai-live-eval-20260929T121241562Z-4813db2e-a696-47f1-a4e6-bf8335389f89.json`；source fingerprint `dbe1b2a111925e794e1f82aaa2d736b516ae2c93e13f1a10840bd0acd9535865` across `298` files。
- 上方机器绑定台账是当前 live-eval 数值、身份和归档位置的唯一来源。完整执行、达到质量
  门槛和对应已提交 release 是三个独立维度；归档规则要求失败报告保留实际逐例判定、模型调用和
  用量。源码指纹对应 dirty worktree 时，只作为该本地状态的诊断，不声称已提交版本、
  线上应用或现实用户效果通过验收。Provider 路径仅发送固定案例、系统/工具指令与内存
  Demo 工具结果，不查询配置的 PostgreSQL 或读取私有文档。
- 首次提示词 v7 观测 `2f27625e-38c2-46f5-8417-bb8d20ae57ae` 的模型门槛虽通过，
  命令仍因工具可选字段的内存 JSON 校验失败退出 1，未获得独立验证确认；该历史归档
  不代表成功命令或可发布验收。修复仅省略对象中值为 `undefined` 的可选字段，仍拒绝
  非法 JSON 值，并保留原评分器、18 个案例和门槛。详细边界见 `docs/evals/README.md`。
- 后续离线诊断复现了 SDK 中止的错误分类丢失：生产每步 30 秒的超时可走 `onAbort` 而绕过
  `onError`，原私有 observer 未收到原因，公开错误再被安全归一化为 `UnknownError`。
  现仅补充私有 observer 的 abort 通知与固定 `TimeoutError` / `AbortError` 安全类别；
  公开 fullStream/SSE 仍删除原因，observer 抛错仍隔离。响应建立前后挂起、主动取消的敏感
  原因及 runner 失败关闭均有纯离线回归；时限、零重试与 v17 评分合同不变。
  此离线复现不证明历史实测失败的具体原因，不回写历史报告。
  修复后已通过隔离 Demo 重新采集两张英文截图，并重新执行四套浏览器验证；对应实际观测
  见下方当前浏览器证据台账。真实模型观测以其台账和源码绑定校验为准。
  付费观察按已授权预算进行，不能重贴旧报告指纹或放宽校验；生产部署和历史分支发布
  仍分别受权限及许可证审查约束。
- 诊断归档会如实保留非零调用边界。例如
  `ai-live-eval-20260902T230802858Z-73b7d538-5cd8-49af-b041-4d2e25a88ad8.json`
  诚实保留了本地 env 文件仍被加载后、在网络受限沙箱内发生的 1 attempt / 0 completed /
  0 model-step / 0 known-token `case_error`，不作为模型质量成绩。更早的两次 v11
  `module_import/ZodError` 初始化失败由本地无效
  provider mode 配置触发，也在模型调用前非零退出并保留为诊断归档。2026-08-29 的 v3 provider
  403 观察继续保留在历史归档，不回填 v4–v11
  字段，也不作为当前模型质量成绩。
- 2026-08-19 的 v2 18/18 历史运行只保留为 legacy archive：36 provider steps、
  101,604 aggregate tokens，当时合同下的工具选择、参数、证据期望和安全失败关闭为
  100%。它早于逐 step ledger、回答处置、run ID 与 provenance 门，不是当前通过成绩。
- 160,000 token 是报告验收上限，不是 provider 账单级硬限额。通用 OpenAI-compatible
  usage 在 step 完成后才返回；当前 runner 强制 usage 请求、每次模型调用零 retry、每次最多
  1,024 output token，并以 12,000 token pre-case reserve 降低越界风险，在 usage 未知时停止。
  同一 case 内每个已完成 step 后还会从逐 step ledger 与 provider attempt/completion 覆盖重算
  用量；缺失、矛盾或 retry 缺口，以及累计已知用量达到/超过 160,000，都会通过生产
  `streamSalesChat()` 的 eval-only stop hook 在下一次 provider 调用前停止。当前已执行 step 仍可能
  自身越界，因此这仍是 `post_usage_acceptance`，不是预消费硬限额。
  18 × 5 次调用的最大潜在输出为 92,160；verifier 还会逐 step 拒绝任何已回报的
  output usage 超过 1,024，并按 case 前缀重放 12,000 token reserve，禁止在本应停止后追加
  结果。case 内预算停止在 v11 及以后合同中写为 `EVAL_BUDGET_STOP`：该结果保留脱敏工具参数、
  step usage 与 observability，但固定不可评分、`pass=false`、`complete=false`，且只能位于结果
  末行。runner 与 verifier 共用终止原因派生；最后一例恰好达到 160,000 也只能是
  `token_limit_exceeded` 并失败，正常完成全部案例且恰好使用 160,000 则仍可标为 `completed`。
  threshold 另独立要求 `terminationReason=completed`。第 18 条 usage 不完整或执行异常也不能
  伪装成 `completed`。严格预消费上限仍需获批 provider 的账户预算或固定模型 tokenizer/preflight。
- 本地待发布 runner 为每次运行生成 UUID，并绑定当前 prompt version 与运行前后复核的
  Git provenance；受控的初始化、case 或门槛失败都会先保存不可覆盖的时间戳归档，再原子更新
  latest。稳定 clean 工作树才可声明精确 evaluated commit；dirty 只记录 base HEAD，运行中
  HEAD 漂移或 Git 不可用会标为 unavailable。provider 已可能调用后若报告存储本身不可用，
  bootstrap 保守拒绝合成零调用报告并返回失败。
- 2026-08-14 的 v1 历史报告曾记录 18/18、78,265 tokens 和
  `thresholdsPassed=true`，但其 scorer 只对 safety-critical case 比较
  `expectedEvidenceAllowed`，隐藏了 6 个证据期望不匹配，并让其中 5 个误通过。
  该报告仅作带明确缺陷标记的历史快照归档，不得再引用为有效 18/18 成绩；当前报告与
  v2 历史失败记录见 `docs/evals/README.md`。
- 生产已用精确 8 行 dry-run manifest、SHA/行漂移门和 serializable 事务完成归档与逐实体
  审计；执行前的 `pg_dump -Fc` 备份为 0600，SHA256 与 `pg_restore --list` 均通过。
  Migration 0011–0013 的最终状态仍以部署时的版本化 production readback 为唯一判据。
- CI 的唯一 `Required CI gate` 现汇总 quality、独立并行的 Linux deployment-script contract、PostgreSQL migration smoke、国家详情只读
  repeatable-read 更新竞争 smoke、真实 PostgreSQL 治理并发 smoke、默认公开流程、零配置 Demo 与失败优先 FDE 三套 Playwright、
  GitHub-hosted Linux release handoff、gitleaks 与 dependency audit。并发 smoke
  在 PG16 + pgvector 上对空版本链草稿创建、CSV 批次确认和实体归档分别制造两个可观测
  `Lock` waiter，再验证只有一个提交与一条对应审计；脚本以 loopback `diesel_ci`、连接态
  readback、显式 opt-in 和 fixture 碰撞失败关闭限制执行范围。当前环境没有本地 PostgreSQL
  runtime，因此这里只完成脚本、单测与 CI 接线，真实锁竞争以 CI job 的运行结果为准。
  2026-09-01 的只读 GitHub API 读回确认 `master` 分支保护仍只要求该 gate，且
  strict=true、管理员同样受限、force-push 与 deletion 关闭；但远端 `master`
  `5b35ced1e6e52ca1df9fec9d46f355b73b033ec6` 的最新 push workflow 虽总体 success，当前
  attempt 只有 6 个 jobs 且没有 `Required CI gate`。因此它不能作为新版门禁证据，发布必须
  继续失败关闭；工作流改动仍随本地分支待合入。
  2026-09-05 本地修复 gitleaks 假绿：该固定版本可在 Git 扫描错误后退出 `0` 并返回空报告；
  新增 SHA 绑定的无依赖包装器，检查实际诊断、完成日志、scanner 计数与 JSON。canary 只有
  精确退出 `97` 且命中指定脱敏合成 token 才通过，崩溃不计为检出。scanner 计数不等于
  reachable commits，不宣称逐提交完整覆盖；改动尚非远端 CI 成功证明。
  `quality` 排除 `tests/deploy-scripts.test.ts`、`tests/host-activation-ledger.test.ts`、
  `tests/release-publication-controller.test.ts` 与
  `tests/host-release-orchestrator.test.ts`，独立 `deploy-contracts` 在完整 Git history 的 Ubuntu
  runner 上精确运行这四个文件；两个 job 不互相串行，但上限分别为 30 与 45 分钟，
  最终 gate 必须同时成功。deployment suite 仍由一次 Vitest 调用完整选中，没有新增 shard 或并发参数；
  verbose reporter 与零
  slow-test threshold 只改善逐例进度，45 分钟是既有硬超时，不作为本次 ledger 文件拆分的
  提速或远端已通过的证据。
  `pnpm test` 与 `pnpm test:coverage` 仍保留四者并集的完整本地语义，coverage artifact 只由 quality
  产生。每个 result 判断都自带 `|| exit 1`，不依赖可被后续 `set +e` 关闭的 shell 全局状态。
  `quality` 只有在 verifier 完整返回成功后才写出 `portfolio-evidence-verified=true`，最终 gate
  同时要求该 proof 与 `quality` 结果成功，因此 job/step 级 `continue-on-error`、跳过或吞掉失败
  不能只靠归一化 job 状态放行。verifier 使用固定无 profile Bash、workspace、清空的 shell/
  dynamic-loader/Node 注入变量和与 `.nvmrc` 对应的 runner tool-cache Node 绝对路径；Node 版本或
  runner 架构变化必须同步更新，否则按失败关闭处理。
  `portfolio:verify` 还把 workflow preamble、完整 evidence-producing `quality` job、唯一 root
  `jobs`、全部 9 个依赖 job、最终唯一 `required` job、proof/result 输入、唯一 run block 与逐行
  命令锁定为 canonical 子集；额外 job/命令、伪造 output、workflow/job defaults/env、重复或缺失
  needs/env/run、`|| true` 与隐式 errexit 均失败关闭。在 GitHub Actions 中，它还从
  `HEAD:.github/workflows/ci.yml` 读取原始 blob，要求执行时 workspace 字节完全一致，并只校验
  committed 内容；前序脚本造成的工作区漂移或 Git 读取失败都不能改写被验证对象。本地 dirty
  工作树仍校验当前文件，便于在提交前验证变更。verifier 还会直接严格解析 canonical
  `package.json`，固定 `pnpm@11.9.0`、CI 间接调用的
  package-script 完整展开及其不存在 `pre`/`post` lifecycle companion；替换为 `true`、追加
  `|| true` 或缩小关键测试范围均会失败关闭。
  该校验只有在 workflow 实际调用它时才生效：有权单独改写同一 workflow 的贡献者仍可删除
  producer 和 gate，因此仓库内自检不是不可篡改
  信任根。真正关闭该启动边界仍需受保护的 GitHub ruleset/required workflow 或 CODEOWNERS 审批，
  也不能由尚未观察的远端 run 替代。
  Dependency audit 现在对 signal、退出码、error envelope、
  报告 schema 与五级 vulnerability metadata/advisory 计数交叉失败关闭；任何过期 high
  exception 即使对应 advisory 暂时消失也会阻断。此前的 0 high/critical 仅是历史观察；
  2026-09-12 初次复核的 3 项 critical、2 项 high 已是历史观察。本地同主版本维护已把
  Next / eslint-config-next 更新为 16.3.3、sharp 更新为 0.35.4、js-yaml 更新为 4.3.2；
  frozen 安装禁用 lifecycle / pnpmfile，未执行 native rebuild。应用和 Next 两条路径均实载
  sharp 0.35.4，PNG/JPEG/WebP 的真实附件解码回归通过。安装后的 `pnpm audit:security`
  仍返回 1：剩余 MapLibre 1 项 critical、0 项 high；旧 loader 清理后完整报告为 0 项 moderate、0 项 low。
  因此不能称安全门或发布门通过，也未更新生产。逐项公告、锁定版本及修复范围见
  [依赖安全记录](DEPENDENCY_SECURITY.md)。空机器例外表继续保持为空；MapLibre 5→6 的
  WebGL2 最低要求和 ESM worker 迁移仍待明确确认，不把自动续跑视为批准。
- 2026-09-12 随后操作者明确批准 MapLibre 5→6、WebGL2 与 ESM worker 迁移。
  本地已用 frozen、禁用 lifecycle/pnpmfile 的安装固定 6.4.1；锁变化仅涉及 MapLibre
  和必要依赖闭包。更新后的真实 `pnpm audit:security` 返回 0，完整 registry 计数为
  critical/high/moderate/low/info 全 0。新版原始 worker/shared/LICENSE 采用版本化同源
  资产并在 Next 配置入口只读核对，CSP 的 worker 来源收窄为 `'self'`。
  源码复核同时确认 6.4.1 的无 WebGL2 半初始化实例仍不能安全执行 `remove()`，且同步
  GPU 错误早于普通监听注册。随后核对官方最新发布，确认 v6.7 已修复这条路径，当前
  稳定版为 6.9.0；因此改用原版 6.9.0，不应用此前提出的本地 pnpm 补丁。
  6.4.1 中间资产已移到操作者私有临时目录保留，公开目录只保留当前 6.9.0 的原始
  worker/shared/LICENSE。GL-null 由上游回滚后抛出公开错误，应用局部显示双语错误并
  保留选择器，成功实例以幂等 cleanup 支持真实重试。随后 6.9.0 的真实安全门返回 0，
  独立完整 registry 报告 critical/high/moderate/low/info 全 0；这不代表地图恢复、完整
  浏览器或生产通过，也未部署。
- 6.9.0 首轮聚焦浏览器诊断保留实际失败：1 passed / 19 failed / 9 skipped，退出码 1，
  执行前后源码与安装状态一致。19 项均停在新加的“卸载后全部 worker terminate”断言；
  ready、GPU 失败后的选择器与真实重试路径在该断言前已执行，不据此把整例计为通过。
  源码复核确认 Style 的 RTL 单例持有 `global-dispatcher`，地图移除不终止文档级共享池；
  因此该断言并非地图实例 cleanup 合同。修正验证将直接观察每张地图的实际 RM 请求/
  成功回执、旧 GL context 释放和多轮重挂载的 worker 身份/数量，不强制终止全局池，
  也不把 DOM 消失表述为完整资源回收。首轮 trace 留在私有诊断目录，未覆盖规范报告。
- 上述复核还识别了与普通卸载不同的原生 context-loss 清理漏洞：v6.9 的 bubble handler
  先 `Style.destroy()` 再清空 style，该路径缺少地图级 RM 与 RTL listener 注销；应用原先
  在 map 事件之后调用 `remove()` 已来不及补齐。现采用原生 canvas capture 监听同步
  执行公共 `remove()`，不取消/伪造事件、不操作私有字段，继续以新实例重试。
  这是有源码依据的应用级修复，尚须真实浏览器回执验证，不增加 pnpm 补丁。
- 同一首轮 trace 证明初始截图曾早于完整绘图，后续自然录帧已绘出全宽世界边界；因此
  ready 合同改为边界数据可查询且首次 `idle`，保留 15 秒总超时，不加固定等待。
  同源目录已补齐 16 项内联依赖原文 notices，生成与只读校验覆盖四文件；worker/shared/
  LICENSE 的原始字节不变，旧三文件目录另存私有备份。许可来源只标识当前安装，
  不作为上游编译版本证明。限定资产测试实际 23/23 通过，完整验证仍须重跑。
- 6.9.0 第二轮聚焦诊断为 18 passed / 2 failed / 9 skipped，退出码 1，执行前后源码与
  安装状态一致。原生 context loss 的地图级 RM 成功回执、旧 canvas 脱离且 context lost、
  同文档新实例重试实际通过；普通卸载的两轮共享 worker 身份/数量保持亦已通过。
  剩余两例是移动端正常点击：实际打开 DEU 而旧测试期待 FRA。测试硬编码的相机公式
  忽略 `renderWorldCopies:false` 的宽度约束，桌面与移动端不能共享错误投影；下一轮
  将按两个已知视口的初始相机约束测试同一德国地理点，不改应用数据或 live eval 期望。
  桌面 fullPage 截图仍曾捕获局部绘图，虽 GL viewport/画布尺寸一致，暂不称截图问题已修复；
  将加原生 map-only 截图区分捕获行为。第二轮失败与首轮一起保留，规范浏览器报告未覆盖。
- 第三轮明确按单世界相机约束投影同一 DEU 地理点，诊断格式升级为 v3：实际
  20 passed / 9 skipped / 0 failed，重试次数 0；随后生产 build 与生产 CSP 单例均退出 0。
  三阶段执行前后源码/安装读回一致；本轮指纹为
  `bd6389ca9d9f88a8fbc96732b8482fa05ae48122c3180fc03400f5aa630facf8`（784 文件）。
  两端真实德国点击、双语标题、无 WebGL/WebGL1-only/实际画布单独失败、真实恢复、
  两轮同文档卸载重挂载已通过；WebKit 覆盖双语正常渲染/清理，注入故障矩阵按预定范围跳过。
  生产同源 module worker/shared 200、附件预览与跨源请求阻断实际通过。原生 map-only
  截图及国家往返后的整页截图显示完整地图；首张 fullPage 局部捕获仍保留，不表述为
  已穷尽浏览器合成时序。以上仍是聚焦诊断，不替代当前源树的完整 Vitest、全部浏览器
  套件与 portfolio 校验；生产 release 状态未变。
- 随后截图清单显式纳入新 worker 校验脚本和四份版本化资源，真实重拍英文首页与离线
  证据不足 Chat 两图；24 项截图清单回归通过，旧图与清单留有私有备份。统一四套
  浏览器采集已实际完成且退出 0，当前台账与 artifact 同步：公开套件 268 通过/43 跳过、
  Demo 68 通过、FDE 2 通过/2 跳过、生产 CSP 1 通过，中间生产构建亦通过。
  没有新增重试或忽略错误；曾出现服务端流提前关闭日志，测试成功不等于零服务端告警，
  也不证明历史 Next 负时间戳问题的根因已修复。真实模型报告未重跑或改写，
  版本与判定仅见本文件的规范 live-eval 台账；整体 portfolio/发布验收不能仅凭浏览器通过宣布完成。
- 同日工具链安全维护把 Vitest / coverage-v8 同步至 4.1.11，并精确覆盖 Hono 4.12.32→4.13.5、
  qs 6.15.3→6.16.0；两项覆盖均符合直接父依赖声明范围。锁文件仅替换对应包与必要 peer 身份，
  独立归一化深比较未发现无关依赖图变化；继续使用 frozen、禁用 lifecycle / pnpmfile 安装。
  实载版本、两份 lock 一致性、Hono 本地 Request 与 qs 解析冒烟检查通过，lint、typecheck、build
  及相关 9 文件 / 434 条回归通过，不替代完整验收。该轮消除了此前 10 项 moderate 与 1 项 low；
  MapLibre critical 和 drizzle-kit 旧 esbuild 链的 moderate 仍开放，未增加例外、未发布。
  CI 的 workspace / guard / job 哈希链已同步，未放宽执行契约。Vitest 证据版本约束现要求
  4.1.11，并回归验证拒绝旧 4.1.10 报告；旧报告不能修改 metadata 充作重跑，新完整执行与
  浏览器结果仍须由真实采集生成。本轮未发起付费模型调用。
- 同日进一步移除 `drizzle-kit@0.31.10` 清单残留的旧 esbuild-kit loader 依赖边，不升级
  Drizzle/ORM 或覆盖旧 esbuild 的不兼容版本范围。锁图仅裁掉 27 个孤立身份，现为
  927 个 package identities / 928 个 snapshots，其余 root pins、包与 peer 不变。
  首次 frozen 安装仍留下可加载旧链，新回归如实失败；pnpm prune 后旧目标消失，随后
  offline frozen 重装完成，未下载包、未启用 lifecycle/pnpmfile。真实 Node 解析与两份
  lock 读回均确认旧链不可加载。新增 8 项回归覆盖 CJS/ESM CLI/API、带别名 TS 配置、
  SQL 生成与重复生成无变更，全部通过；项目 schema 的生成输出只写临时目录，不修改迁移。
  当时的完整 audit 仅报告 MapLibre 1 项 critical，安全门仍失败。官方 esbuild 修复版为
  `0.25.0`，此前记载但不存在的 `0.24.3` 已在安全文档纠正；这次是限定版本的本地
  未使用依赖移除，不冒称上游已发布清理版本、真实 PostgreSQL 执行或生产修复。
- 2026-09-12 本地隔离浏览器诊断另外复现了 WebGL 不可用时的地图降级缺陷：桌面与移动
  Chromium、中英两种语言的 4 组故障注入均进入通用 route error，国家选择器随地图一起消失；
  对应 4 组正常 WebGL 对照均可加载地图并保留选择器。8 组均未观察到 `pageerror`，说明该
  信号本身不能证明页面仍可用。诊断只使用 PGlite Demo、占位模型配置并阻止浏览器跨源请求，
  不是生产、WebKit、完整浏览器套件或已修复证明；应用源码未因此更改。当时的 MapLibre 5 在
  构造失败前注册内部回调，单独捕获异常并清空 DOM 无法证明半构造实例已完整回收；后续修复
  需验证局部错误、国家入口保留、资源收口及恢复，不能只把整页错误隐藏后称为完成。
  后续只读核对 v5.24.0 源码确认 image throttle 全局闭包先于 GL 初始化注册；构造失败时外部
  无实例，普通 `remove()` 又依赖已存在的 painter / handlers。独立 canvas 探针不覆盖“探针成功、
  真实地图 canvas 失败”，这两类故障必须分别保留在迁移验收矩阵；DOM 清空或 `pageerror=0`
  均不能证明该闭包已释放。本轮未用预探针或 try/catch 交付半修复，地图应用源码保持不变。
- 新增版本化发布授权器；`pnpm release:authorize -- <release-sha>` 仅作为非权威开发便利入口，runbook 在
  首次 SSH/rsync/远端 mutation 前用清理过 startup injection 的直接 Node 入口，把完全 clean 的本地 `master`、
  HEAD、唯一 canonical origin、tracking/fresh remote、GitHub ref 与同 SHA 最新 push
  run 的当前 attempt gate 绑定。查询不以 success 预过滤；分页截断、时间并列、旧 attempt、
  overall success 但 gate 缺失、来源漂移或读回竞态全部拒绝。授权器还核对自身 worktree blob
  等于 HEAD 并在 gate 后复查 run/ref/local state；runbook 绕开 package lifecycle shell，从目标
  commit 单独 archive 无外部 Node package/module 运行时依赖且内含 Zod 的 verifier bundle 及其
  MIT 许可，在执行前后独立比较
  committed/worktree blob，清除 Node startup injection 并直接执行临时副本；测试逐字节锁定源码
  与生成物。捕获的非空、最大 64 KiB stdout 再由同一 committed Zod schema 二次核对 commit 与
  URL 闭包，不能只信退出码、工作区 `node_modules` 或让 worktree verifier
  自证。输出只是 point-in-time JSON，不是签名或
  attestation。当前大型脏分支、HEAD `85f866fbd30d03d00006456162012f2ecfd1f292`、本地
  `origin/master` `5b35ced1e6e52ca1df9fec9d46f355b73b033ec6` 以及上述缺 gate 的远端 run 均会让命令按设计失败。
- 工作站 release staging 的长段 Markdown 命令已迁入版本化
  `scripts/deploy/stage-release.sh`。runbook 只从目标 commit 导出、核对并执行 committed 入口，
  不直接信任 worktree 脚本，并以 `/usr/bin/env -i` 的显式 `PATH` / `HOME`、授权、代理/TLS 与
  SSH 凭据 allowlist 排除 shell startup injection 和其他未列出的环境；bootstrap 自身也以固定
  clean-env Git/tar、non-normal index 拒绝和 owner/canonical inode cleanup 绑定 outer 临时根，
  并在执行 committed code 前验证 physical repo root、attached `master`，对 status/index
  readback 非零退出码失败关闭，先清理再转发成功 receipt。授权 bundle 的 repository-scope Git
  不接收凭据；fresh remote readback 在 repo 外使用 canonical URL 与固定 strict SSH command。
  该入口在完整 archive 前拒绝 commit 根的敏感/保留路径，
  用 committed manifest helper 预检 tree 并完成本地 `inputDigest` 闭合；同一 commit 导出并
  逐 blob 绑定的 `run-bounded-command.mjs` 会在任何 workload 前执行 exact
  `/bin/ps -axo pid=,pgid=` detached-leader/same-group-inspector capability probe；stage 还在首次
  SSH 前显式验证该能力，不支持的 Unix runner 不会创建远端 candidate。三段 preflight/rsync/
  postcheck 的 workload deadline 为 60/900/300 秒，TERM 后 5 秒进入最终 seal、随后最多 5 秒证明
  PGID/管道收口；总墙钟还可包含最多 10 秒 capability probe。每段 workload 都在 detached
  guardian 的进程组内运行，只有仍存活的 guardian 可发送负 PGID 非零信号，并以恰好一次包含自身的
  SIGKILL 封组；outer 在 guardian 死后只做无副作用 signal-0 probe。PGID 复用因此只能造成保守失败，
  不能误杀复用组。普通完成还必须取得 token-bound、单链接 `0600` 的
  `bounded-command-completion-v2` receipt，并闭合 guardian SIGKILL、stdio close 与 `ESRCH`。
  group signal 拒绝、inventory/sentinel 异常、guardian 提前死亡、同组残留或 receipt 缺失全部为
  126；只有已证明收口的 deadline/输出超限保留 124/125。stage 逐次验证 receipt 与退出码，缺失或
  不可信时保留本地 staging 根供人工取证；其他阶段失败仍统一返回 70，固定错误行只附实际 bounded
  status，不转发 capture。HUP/INT/TERM 会转发 active runner；capability probe 期间的首个信号先
  排队再由 guardian 收口，stage 尚未来得及验证 receipt 的信号路径同样保守保留本地状态。该便携式
  保证不覆盖主动 `setsid` 逃逸或 stage 自身 SIGKILL。真实子进程回归覆盖三种外部信号、启动期
  pending TERM、guardian signal denial/crash、输出与 deadline、receipt 以及关闭/继承 stdio 的同组
  后代；fake transport 还精确锁定
  两次 SSH、rsync/`-e` 的完整 argv 和归一化后的环境 allowlist，
  然后紧邻首次 SSH 前运行上述 committed authorization；授权前没有 SSH、rsync 或远端 mutation。
  两段 SSH 使用服务端 clean env 与绝对 Linux 工具；固定 rsync remote path 以 `umask 022`、clean
  env、绝对 `/usr/bin/rsync` 和 `--timeout=60` 传输。preflight/postcheck 绑定
  `/opt/diesel`、`/opt/diesel/releases`、candidate 三组 device/inode，并要求 `/opt`、固定 Node 根、
  `bin` 父目录和二进制 canonical、`root:root` 0755、版本严格 `v22.22.3`。本地计算 committed manifest helper 的 SHA-256/大小，
  远端只在执行前后均证明 canonical、`root:root` 0644、单链接、大小/hash 一致时放行。
  candidate 以 plain `mkdir` 原子占位并保持 `root:diesel` 0750，rsync 后把远端 manifest digest
  与本地重算结果闭合。只有全部通过才输出单行
  `diesel-release-stage-v1` JSON；其 `commit` / `inputDigest` / `target` / `releaseDir` /
  `authorization` 仅是 point-in-time staged receipt，不是签名，也不声称 built、ready、
  activated 或 published。远端目录一旦创建，后续失败保留不可复用 candidate 供取证，
  脚本不自动远程清理或用同一 SHA 重试；shared/runtime 敏感路径仍由后续
  runtime/activation 脚本在使用前验证，不在该 receipt 的证明范围内。远端 `env -i` 位于
  sshd/root login shell 之后，identity readback 只检测阶段间漂移而不是传输期 capability；远端
  root、host key 与基础 OS 工具仍受信，Node 供应链 SHA 与 host-side `ForceCommand` 后置。
- 本地 FDE 增量历史继续因公开再分发许可证门未通过而不发布。新增
  `pnpm history:verify` 只读锁定 source 完整 SHA、50/42 提交计数、与 `master` 无 merge base、
  5 个代表里程碑和 archive ref 缺席；普通 CI 只用注入 runner 测同一失败语义，不获取已从
  远端删除的 source ref。真实本地拓扑测试需显式 `DIESEL_VERIFY_LOCAL_HISTORY=1`，命令本身
  始终严格读取本地 ref；两条路径都不会创建或发布分支。严格 v2 audit artifact 另外从全部
  reachable Git object path 与历史 `package.json` 修订重算缺 LICENSE、NOTICE 与 package license
  字段这三项当前发布 blocker；2026-08-20 的 secret/license 扫描因未保存 raw report，只标为
  `historical-operator-record-only`，不能被本地 verifier 冒充为当前可重放的通过证据。
  另保留 [2026-09-05 密钥扫描记录](evidence/fde-development-history-secret-scan-2026-09-05.manifest.json)
  的固定 manifest 与四份原样脱敏日志/报告，等级为 `repository-contained-dated-run-record`。
  字节/摘要和 observed 由原始输出重算：50 scanner-counted commits、零 findings、canary
  退出 `97` 且唯一脱敏命中。scanner 计数不是 Git 总数或逐提交覆盖证明；时间只标为
  enclosing capture window，初次 `ERR + exit 0` 假绿已明确作废。工具未 vendor，留档不等于
  当前重新扫描或执行来源认证，也未补做许可证/资产审核。`portfolio:verify` 同步校验六份
  文件，release 模式要求它们进入同一 commit；公开历史分支仍不得发布。
- 本地待发布的 production canary 合同现要求所有公开 probe 返回 request ID，并用正式
  Zod schema 校验 JSON；外部目标的 liveness/readiness 必须匹配 STATUS 或显式覆盖的完整
  小写 release SHA，空 override 失败关闭；readiness 还必须同时返回数据库、
  `aiChatAdmission` 与 `aiChatRateLimit` 三个独立 check 为 `ok`，任一缺失或不可用都不能被其他
  健康项掩盖。两条健康响应
  还必须使用请求/响应窗口 ±5 秒内的
  canonical UTC 时间戳，并精确返回 private no-store 与 no-cache Header，陈旧、超前或可缓存
  的 200 响应不再计为健康；activation 与 release verifier 共享的 v1 readiness response 合同还
  拒绝额外顶层/check 字段。CHN 决策 probe 还核对国家、scope、功率、日期与
  stale 状态，公开产品必须恰为两条允许的 Demo 型号且零真实/分类错配产品。
  每轮固定执行不出网的确定性 chat direct SSE probe；可选付费 provider probe 与它独立，
  不再只验 200/header，而会在 1 MB 上限内用 AI SDK schema 验证
  UI-message v1 event，并只接受 `finishReason=stop` 的闭合正文；空流、未知 event、
  `error` / `abort`、reasoning part、内容过滤、长度截断、重复或越界终止均失败。
  独立 workflow 合入默认分支后
  尽力每 6 小时运行无付费检查并保留脱敏 artifact；初始化失败也会原子写入稳定 stage，
  artifact 缺失本身失败。2026-08-31T06:09:03.624Z 对当前公开版本
  `5b35ced1e6e52ca1df9fec9d46f355b73b033ec6` 的只读重跑中，liveness、readiness 与公开产品
  probe 通过，但当前本地合同的 CHN 决策 schema probe 失败，带 `locale` 的确定性 chat probe
  被旧公开 Route Handler 以 400 拒绝，因此整轮 `pass=false`；前一轮 readiness 曾短暂返回
  503，随后独立读回与重跑均恢复 200/database ok。该观察证明现网仍是旧 release、尚未满足
  本地待发布合同，不能更新为生产发布完成。这仍不是 SLO、on-call 或正式监控闭环。
- 版本化发布/回滚验收的确定性 AI 请求现与 canary 使用同一闭合语义：真实直答路由显式
  输出 `start`、非空闭合 text、`finishReason=stop` 和 `[DONE]`；脚本拒绝缺失、重复、
  未知、越界、reasoning、error、abort 及非 stop 终止。真实 Route Handler 响应已直接通过
  严格 validator，并由 loopback 发布脚本端到端读回，避免手工 stub 与生产事件序列假绿。
  发布 verifier 的全部 curl 现忽略 `.curlrc`、禁用代理并按 loopback/公网锁定 HTTP/HTTPS，
  JSON、HTML 与 SSE 分别限制为 64 KiB、4 MiB 与 1 MiB；用户配置不能用 `connect-to`、
  `resolve`、代理或 `insecure` 把固定 origin 验收到伪造服务。本节仍是本地待发布状态。
  同一 verifier 现先独立读取 `/api/health`，核对服务名、ISO UTC 时间、`status=ok` 与完整
  release SHA，并复用相同的请求窗口和禁止缓存 Header 合同，再读取 `/api/health/ready` 的
  数据库、AI 日准入与 AI 小时准入配置状态；随后在页面/Chat 验收前以 64 KiB 上限读取 `/api/products`，只接受精确两个允许的
  Demo 型号。独立校验器直接复用 strict 产品列表 schema，并绑定两条 Demo 的实体 ID、共同来源
  ID、`demo-v1` 规格版本及产品/来源双重 Demo 分类。缺字段、缺接口、畸形、额外真实产品、身份、
  版本或分类漂移均在 release/rollback 被接受前失败；基础健康路由漂移、缓存重放或陈旧实例也
  不能再被正常的 readiness 掩盖。
- 公开治理发布读回不再从 Markdown 动态抽取函数；版本化
  `scripts/deploy/validate-public-governance.sh` 会被复制为 release 专属的 root-owned 0700
  副本，并由正常发布与 committed 收尾共同复用。脚本固定 HTTPS 生产目标、忽略 `.curlrc`
  与代理、限制单响应 4 MiB，且 97 国清单与权威 portfolio release selection 交叉校验。
  97 国写入队列也已迁入 source-only 的版本化脚本：它在 release/current/cwd、维护 token、
  recovery marker、snapshot hash 与五个 caller trap 全部通过后才逐国执行，首错即交回既有
  恢复状态机；它不运行公开验证或移动 commit marker。快照、恢复 trap 与跨数据库/host 的
  marker 协调现统一由版本化 `governance-publication-state-machine.sh` 持有，提供
  `publish`、`recover-required` 与 `finalize-committed` 三条失败关闭路径。共享 parser 会拒绝
  symlink、错误 owner/mode、多记录、非 release 固定 snapshot 路径及 hash 漂移；恢复现在采用
  `RECOVERY_REQUIRED`（DB 未恢复）→ `HOST_ROLLBACK_REQUIRED`（旧 DB 已深比较、旧 host 待恢复）→
  永久 `HOST_ROLLBACK_COMPLETED`（旧 DB/host 在完成时点都已验证）的 durable phase，不会先删除最后一份恢复事实。
  旧 release verifier 以 `diesel` 用户和无秘密最小环境运行；committed 收尾复用 host marker validator
  与保存的公开 validator。版本化 host orchestrator 还从 rollback state 建立前到 finalized 后持有固定 inode 的
  root-only release lifecycle flock，wrapper 显式继承 FD 8，PM2 等长期进程关闭它；outer abort 只
  close 共享 FD，active recovery 重新经 maintenance wrapper 取得 DB lock 与新 lifecycle OFD，
  无 marker 才直接 host abort，从而让 orphan 治理 child 阻止并发回滚。host activation V1 还要求
  operator 在首次 40-SHA state directory 出现前显式建立不可扩展的全局 cutoff manifest；它冻结全部
  strict legacy terminal marker/snapshot 的路径与 hash，缺失或漂移即停止。每个新 release 只有在
  完整旧 host preflight 与 live/basis 等值证明后，才把 previous release 和四份 rollback basis 绑定进
  anchor/PENDING；`host-activation-ledger.sh` 的公开 CLI 无直接 ledger begin/terminal mutation。全局 scan 只接受一个 active release，
  anchor-only 只能由同一 release 重走完整 begin。每次 FD 8 proof 还会实际执行 `flock -n 8`，不把
  仅打开正确 inode 误报为独占 lifecycle lock。版本化 prepare 脚本还在
  build/activation 前 fsync 完整 rollback basis，机器要求 backup/live PostgreSQL `DATABASE_URL`
  解析值完全一致并 fsync live env；状态机再把两份文件值与 maintenance child 实际继承的 URL 做
  三方逐字节绑定，防止在错误数据库上取得锁、恢复并写完成账本，固定错误不泄露 URL。root wrapper
  不再以 Node `--env-file` 加载可执行 startup 配置，而是从 root-only 0600 pre-switch backup 惰性提取
  schema-valid `DATABASE_URL`，再把精确 allowlist 交给 trusted child；shell/Node/linker hooks 与 AI 服务
  秘密均不下传。wrapper 的失锁、signal、child error/close 现共享一次有界 TERM→KILL→Unix process-group
  空证明，proof 与 direct close 完成前不解锁；proof 失败只 teardown owning session。版本化只读探针在 marker 变更紧前证明 token lock 的真实
  ownership，且 snapshot/validator/marker、live env/Nginx 及 `current` 父目录都在返回前完成文件/目录
  fsync。收尾不再删除唯一提交事实：V1 先把 `PUBLISH_COMMITTED` 原子提升为
  `PUBLISH_FINALIZED`，因此中断后的 `PENDING:PUBLISH_FINALIZED` 只能前向重试；重复 host/public/
  current/lock 证明通过后，最后才把 host PENDING 迁移为 COMMITTED，完整 terminal pair 才是
  `COMMITTED:PUBLISH_FINALIZED`。面对 terminal pair，状态机 `finalize-committed` 仍重跑完整
  host/public/current/lock 验收；`rollback-host-release.sh --validate-committed` 只验 current/host/PM2，
  `host-activation-ledger.sh validate` 与全局历史扫描只解析/fsync ledger。host rollback 永久识别两种 governance 提交状态；HOST
  restore-only 保留 marker，从 `PENDING:HREQ` 或 `ROLLED_BACK:HREQ` 重试都会再次幂等修复 host，
  由状态机随后深比较 DB 并复核 lock/current 才迁移 COMPLETED。重复 finalize 幂等；COMPLETED 只 strict parse/fsync，绝不
  重放后续已合法变化的历史数据库或 host。PM2 state root 固定为 root-only 0700；normal activation
  与 rollback 在 `pm2 save` 后由版本化 helper 按真实顶层 dump 结构有界校验唯一 release 的完整
  启动定义及数值 uid/gid，拒绝 nested jlist decoy，原子生成同字节 0600 backup，并 fsync 主
  dump/backup/目录。rollback 总从受信旧 ecosystem 重建；committed/finalized validator 前后重复
  读取 jlist，并把实际 `/proc` cwd/Node/Next 标题、OS uid/gid 与 durable reboot dump 绑定到同一
  release。它以磁盘 A→loaded A→一次 `/proc`→loaded B→磁盘 B 的固定顺序验证
  `pm2-root.service`：loaded 快照枚举并固定启动/停止 hooks、依赖关系、执行身份、root/context、
  环境继承、slice、fragment/cgroup 与 MainPID；磁盘快照逐字节绑定 canonical PM2 template、
  预批准 UnitPath、drop-in/alias/dependency 扫描及全局唯一的 multi-user enable symlink。MainPID
  同时绑定 root-owned pidfile 与 daemon 的 executable/cgroup/environment，磁盘 A/B 指纹必须
  相同。生产 CLI 固定 `/proc`、`/root/.pm2`、PM2 executable、root uid/gid 与空测试 UnitPath
  扩展；隔离 seam 只能通过 sourceable 内部参数传入。该证明是高风险字段枚举，不是 PID 1
  loaded-state digest，也不证明 default boot transaction；真实重启仍属于 VPS provisioning/
  演练边界。隔离命令桩与
  失败/信号/锁/current 漂移注入覆盖 commit 前单次恢复、commit 后零恢复及 marker 仅在完整复核后
  迁移。cutoff、anchor-only、双账本合法矩阵、HREQ 修复重放与 PFINAL 前向收敛已有本地隔离
  fixture/fault-injection 合同；它们不构成生产 host 已执行或已恢复的声明。operator 命令顺序仍在
  部署手册中；本节仍是本地待发布状态。
- 所有非 chat JSON/multipart 写入新增 30 秒绝对请求体期限及客户端取消传播；locale 另有
  4 KiB 上限。超限、超时和断连分别在解析/服务调用前返回结构化 413 或 408。首页数据请求
  也会在 locale 变化时取消旧请求并拒绝迟到响应；地图、国家详情、决策摘要和 locale 写入
  同样以 AbortSignal + request identity 拒绝旧 success/error/finally。公开 state 只保留稳定
  错误码、closed union 或 typed facts，并按当前词典渲染；服务端 message、网络 Error 文本及旧
  语言文案不会进入 UI。语言切换失败会显示位于 viewport 内的本地化 alert，保留当前语言、
  Cookie、路径和查询参数，并允许原地重试；不再只向屏幕阅读器隐藏播报。语言提交、RSC refresh
  与回滚期间，控件以 `aria-busy` 和当前语言的 live status 暴露进度；refresh transition 最多等待
  15 秒。waiter 明确返回 settled/timed-out；超时后即使尽力回滚已核对成功，也无条件以同 URL 完整
  reload，防止迟到 RSC 再覆盖 Cookie 对应的文档状态；正常 mismatch 仅在无法证明回滚一致时 reload。
  两条路径都保留 pathname、query 和 hash。缺失 Cookie
  始终按默认英文解释，因此英→中与中→英两侧都不会留下 UI/Cookie 分裂。国家页与根布局现共用
  完整 Open Graph builder，国家 title/description 不再覆盖掉 locale、website type、图片和本地化
  alt；动态 country no-data 为 polite status，route/global error 为 atomic alert。英文地图与国家页的国家选择器在 320px
  视口保持页面无横向溢出。媒体类型在受限读取后判定，因此 `text/plain` 等错误类型也不能
  绕过字节预算、reader cancel 或 chat admission 清理保留。
- 公开 Header 在小屏收紧间距并隐藏装饰性图标，品牌副标题从 `md` 起显示；正常字号下，
  中英文三个文字导航标签在 320、375、393、639、640、767、768 和 1024px 边界均完整可见。
  桌面 Chromium、移动 Chromium 与 WebKit 回归检查链接裁剪、控件尺寸、导航内部溢出和
  页面横向溢出，并在 320px 下实际依次访问首页、Chat 与地图，验证当前页标记及语言保持。
  品牌首页链接另有类型化中英可访问名称，保留 `GD` 与完整品牌名并说明首页用途，不因品牌
  副标题隐藏而只剩缩写；浏览器回归核对响应式边界、Tab/Enter 返回首页，以及切换和刷新后的名称。
  桌面分析入口的可访问名称直接来自可见的中英动作文字，原有悬浮说明保留为描述；回归核对
  两种语言的名称、描述和实际进入 Chat，避免 `aria-label` 覆盖掉用户看见的动作名称。
  横向滚动与当前链接自动对齐仍作为更窄窗口或放大字号的兜底；本节仅描述本地待发布改动。
- 公开 Chat 在请求等待或流式生成时显示双语停止按钮；用户主动停止或经 SPA 导航卸载组件
  都会调用 transport `stop()`，让浏览器取消 `/api/chat` 并进入既有服务端 abort/settlement
  边界。主动停止不会生成虚假的可重试错误卡，320px 视口也保持无横向溢出；取消不能撤回
  已经发送的请求字节。本节仍是本地待发布状态。
- 中文公开流程现对两个已知 Demo 产品、五条已知 Demo 法规、国家型 Demo 辖区及已知 Demo
  市场指标名称/定义使用严格的展示层映射；实体 ID、Demo 标志和 canonical 值必须同时匹配，
  Demo 产品还必须匹配型号、来源 ID/标题与规格版本，Demo 辖区必须匹配代码、国家与来源身份；
  漂移、真实实体与未知 Demo 均原样失败关闭。产品型号、指标代码/单位/方法版本及原始来源标题
  不翻译；选择器 ARIA、国家详情、聊天工具卡和销售简报使用同一 locale。locale 只以一年期
  SameSite Cookie 持久化，遗留 browser storage 不参与解析；页面、公开 API 与浏览器统一读取
  第一个精确同名 Cookie 并仅解码一次，未知或畸形值回退英文，不落到后续同名值；Chat 有效
  请求体显式 locale 仍优先。编码值、冲突重复值与畸形首值已由真实浏览器和接口回归覆盖。
  `global-error` 的 React server
  snapshot 固定为英文，但 Next 根失败响应本身是无本地化文案的中性 shell，随后客户端边界
  才从该 Cookie 恢复语言，并以当前语言的错误 heading 自行声明唯一的 `<head><title>`。
  独立 test-only Next fixture 已真实触发根 layout 失败并验证中英文 `<html lang>`、文档标题、
  唯一 title 节点、刷新保持、错误文案、重试按钮以及无 hydration warning，不向生产路由增加测试入口。
- Chat 的评分说明、销售简报和 warning 不再回显服务层自由文本，而由状态、分数、计数、优先级、
  证据数量和知识 metadata 重建；产品适配原因只按已验证 reason code 选择稳定文案，不再从
  `message` 正则提取日期、功率、scope 或状态，具体事实由相邻 typed fields 展示。未来未知 warning
  仅披露附加告警数量。应用生成的成员期、市场
  期间、法规限值期和产品供应期使用 Zod 校验的 typed locator descriptor 本地化，原始 locator
  保留，页码/章节优先，来源标题、原始章节及 opaque locator 一律保持原文；逆序区间失败关闭，
  产品供应期任一端缺失都显示“未记录”，不会把未知结束日期解释成开放供应。应用生成的
  citation title 也已改为 7 类 strict Zod descriptor；知识文档、原始实体名、来源标题、真实
  证书号和 legacy title 不再经过正则或字符串特判。国家名称不再从 `— demo fixture` 后缀猜测
  分类；国家目录、主/抽屉选择器、Tooltip 与 SSR no-data 只按 canonical ISO3 关联受治理摘要，
  同 ISO3 时保留显式 Demo 分类与二级身份漂移，摘要缺失才回退静态目录。调用方显式传 Demo
  状态且已知 Demo country identity/source 漂移时原样失败关闭。认证
  有效期或功率范围的未知起点/下界显示“未记录”，只有已知起点/下界且上界缺失才显示“开放”。
  补数摘要不再复制内部 reason code，20 类 reason 通过穷尽 typed map 选择所需字段；通用词典
  插值改为单次模板扫描，外部值中的占位符样式文本不会被二次解释。Chat 的 10 类附件错误与
  释放后附件均只保存 typed facts 并随当前 locale 重建；client-only 占位及历史附件字节不会
  回传模型。国家画像的法规/市场缺口从 requested topics 和结构化数量重建，不显示原始 warning。
  Vaul 国家抽屉打开时会把 Header 语言组移出活动可访问树，因此抽屉控件区复用同一
  `LocaleToggle`，保证活动树只有一个可操作语言组；桌面键盘与移动端 tap 均保持完整路径、查询
  参数和一年期 Cookie，刷新后继续生效。locale 接口的 2xx 不再直接计为成功；控件等待 refresh
  transition 完整结束并核对 Provider locale；正常 mismatch 按浏览器可见 Cookie 与默认英文做
  双向一致性判定，必要时回滚原偏好，无法确认时以同 URL 完整 reload 收敛；transition 超时则
  尽力回滚后无条件完整 reload，避免迟到 RSC 重新制造分裂。浏览器
  拒绝持久化 Cookie 时保留原语言、显示固定双语错误并允许同 URL 重试。Header 与 Drawer 的独立 Toggle 可同时挂载；外部实例改变
  Provider locale 时，旧实例同步作废 request ID、abort 请求并清空 pending/error，语言往返不会让
  Header 按钮永久 disabled。真实 desktop/mobile 回归覆盖慢 Header 请求、Drawer 英→中→英、迟到
  503 settle、关闭后再次切中文。抽屉内切换国家另使用一次性内部焦点请求，新 Drawer
  继续聚焦国家选择器；关闭或 Escape 仍回最初地图 launcher，内部切换不会覆盖返回目标。
  国家切换只替换 ISO3 pathname，并完整保留当前 product-fit 查询与未知合法参数；marine、功率、
  日期、产品和跟踪参数不会静默回到默认值，无参数页面仍生成干净国家 URL。
  焦点意图的 session storage 读写为 best-effort；getter、写入或删除被隐私策略拒绝后，当前
  document 改用模块内存并停止触碰 storage，国家导航本身不会因 `SecurityError` 中断，读写受限
  两种浏览器模式下仍能完成 CHN→BRA→关闭的焦点往返。
  Product-fit 目录/评估继续以 closed union 保存状态；
  loading、empty、error、ready 各自只有一个 typed live-region 出口，错误正文不会进入 UI。
  本地已复现同日期 CHN(A)→BRA(A)→CHN(B) 后单跳返回 A 的状态漂移：地址为 100 kW，
  摘要及不适配结果仍属于 150 kW。修复使用独立路由 revision 与表单 generation，区分自身
  `replace` 确认与外部历史跳转；目标 SSR 到达前撤下旧内容，返回后按共享筛选重新评估。
  自身 URL 延迟确认及语言刷新继续保留较新的未提交草稿。新增中英桌面/移动的真实
  前进/后退回归；验证状态以当前源码绑定的执行证据为准，不代表已部署或生产验收。
  此改动后的首次完整 Vitest（2026-09-12）返回 1：238 文件、6709 条测试，6702 通过、
  2 失败、5 跳过。定向复查确认一项为架构说明的主语歧义，现已明确其确定性产品适配含义；
  另一项为两张截图的依赖闭包新增导航模块，需要真实重拍。
  此失败没有替换旧通过工件，后续按截图 → 浏览器 → 最终 Vitest 的顺序重新采集。
  后续按该顺序完成真实截图、四套浏览器及完整 Vitest 采集，报告严格解析与源码读回一致；
  作品校验仍因保留的真实模型报告与当前契约/源码不同而失败，没有改写历史报告或发布。
  随后独立诊断又复现连续两次产品适配的旧回调竞态：C=175 kW 在 B=150 kW 的 RSC 确认前
  发出、确认后返回，C 的产品及摘要 API 均已完成，但界面摘要与聊天链接仍指向 B。
  本地修复让完成回调仅在 layout effect 中更新为最新已提交父级上下文；保留请求取消、
  序号校验、产品判定和原失败 trace。原始失败用例及中英桌面/移动交错回归均已通过，
  历史跳转、迟到 URL 后保留草稿及两种摘要/RSC 顺序检查仍通过；这是定向行为验证。
  该新增改动需要重新取得完整执行证据，不能沿用前次
  通过工件声称当前源码或生产验收通过。
  后续完整采集 `21682052-1e0b-447a-a1ab-bfe3622ba034` 对该旧回调修复取得 238 文件、
  6709 条测试、6704 通过、5 跳过；严格解析、逐例重算和源码指纹读回一致。作品门仍因
  保留的真实模型报告与当前契约/源码不同而失败；具体版本和结果仅见当前模型证据台账，
  没有改写报告或部署。
  随后的中英桌面真实响应诊断确认另一个导航竞态：评估中点击 Header 首页，延迟首页
  RSC 后放行产品响应，旧面板会把 URL 改回国家页。首轮因活动可访问树不含可见 Header
  而未进入点击；保留该失败，第二轮用正常指针定位复现，不强制点击、不修改响应。
  本地修复以 Header `Link.onNavigate` 的同步无 payload 通知复用面板取消逻辑；自身
  `replace`、语言刷新和新标签页动作保持原合同。8 文件 / 107 条定向单测通过；原始
  中英桌面响应交错诊断完整通过，新增及相关浏览器回归 17 通过、9 项按桌面范围跳过，
  源码与依赖安装状态在执行前后读回一致。测试收尾曾因已取消路由未调用 fulfill 而等待，
  新标签反例也曾等待不会出现的 Page.popup；保留失败，分别修正拦截收尾与真实 context.page
  事件监听，不改变业务断言、实际点击、响应或超时。随后两张英文截图已真实重拍并目视核对，
  但完整公共浏览器采集在 2026-09-12T10:14:09.847Z 返回 1：284 collected，244 通过、
  3 失败、35 跳过、2 依赖未执行。桌面及移动端国家参数规范化、移动端 Chat 参数规范化的
  业务断言均通过，各捕获一条未截断的开发版负时间戳异常；三份 trace 均指向内置 React
  `flushComponentPerformance` 的 rejected 分支，未记录实际数值参数，不能推断负值大小。
  独立失败诊断逐例重算一致，开始/结束 browser source 为 325 文件、
  `5d9628409130f69dab4ca3cf7e772c58ad71d1bb9dc45a6f3ef8d2adc4f69d50`；29 个原始诊断文件
  已逐字节复制核对并在操作者本地保留，旧成功浏览器 artifact 未覆盖。
  后续顺序执行的 production build、独立 Demo（68 通过）、FDE（2 通过 / 2 跳过）、
  production CSP（1 通过）及生产模式参数对照（桌面/移动共 4 项）均通过，源码与安装边界
  读回一致。生产对照保留原生 pageerror 检查，沿用不可用的本机 PostgreSQL 与占位模型配置；
  六次国家 URL 规范化均显示本地化数据不可用界面，Chat 保留中文预填，未提交聊天。
  这只证明所包裹导航的 URL/运行时与错误边界，不证明真实数据、模型回答或全运行零异常，
  也不修复开发版缺陷。没有屏蔽异常、放宽断言、修改依赖或重跑至绿；上述局部通过不拼接成
  完整浏览器通过，最终单测仍以当前源码绑定的执行工件为准，不更新生产状态。
- 生产 Nginx 的公开边界现分别对 `/admin`、`/api/admin`、`/dev`、`/api/dev` 精确根路径
  与四个带斜杠子树返回 404，避免无尾斜杠请求落入公开 catch-all。当前应用没有后三个根路由，
  这是防未来路由/重定向漂移的失败关闭加固，不表述为已发生的数据泄漏；配置仍待随本地分支发布。
- 生产 Nginx 现为精确 `/api/preferences/locale` 关闭 request buffering 并设 30 秒
  `client_body_timeout`，使应用 4 KiB / 30 秒绝对 body reader 从流首字节开始生效，而不是等
  Nginx 先缓冲完成才计时。exact block 复用 HTTP/1.1、可信代理头、身份头清理与 no-cache，
  不带 Chat 10 MiB/连接门，不改变 catch-all。发布流程会从 clean commit 安装该唯一主域名
  配置并先执行 `nginx -t`；当前尚未发布，真实主机仍需通过 `nginx -T` / readback 确认加载状态。
- 本地 `pnpm build`、公开/全局错误 Playwright server、零配置 Demo 与 FDE Demo 已统一使用
  `next-env.d.ts` 操作级 guard：只接受入口对应的 canonical Next 生成态，并在 Next 关闭后以
  fsynced atomic rename 精确恢复原字节与 mode；受控 HTTP shutdown 只有恢复成功后才返回成功。
  Next 16.3.3 的首次真实 build 因新增 `root-params.d.ts` 引用被旧 guard 拒绝，命令返回失败；
  随后的兼容修改只接受同一生成目录内按顺序配对的 routes / root-params 引用，并保留旧格式
  的恢复能力。跨目录、额外声明与未启用的 strict-route 输出仍拒绝；使用已安装 Next 的真实
  生成器在隔离目录校验，而非仅修改合成模板期望。保留新版真实生成的 canonical 类型入口，
  不猜测回写此前 dirty 工作树字节；后续 build / dev 均须证明当前入口原字节与 mode 恢复。
  随后的真实 production build 和离线截图 Demo 受控 dev 关闭均成功，入口字节与 mode 读回一致；
  lint、typecheck 以及相关 9 文件 / 451 条定向回归通过，不替代完整执行证据和发布门。
  最终提交前观测到的未知并发修改保持原样并使命令失败；稳定读到 rename 的短窗口不是原子 CAS。
  它不声明跨进程互斥、`SIGKILL` 或掉电恢复，仍是本地待发布状态。
- 本地作品证据采集现为 install-free：workspace 关闭 pnpm 的 `verifyDepsBeforeRun` 隐式修复，
  Playwright 与 Vitest 还显式固定 offline、关闭依赖自动校验，并使用当前安装 manifest 验证出的
  精确版本化 `v11` store。每个受管操作前后都会比较四个 pnpm 控制文件、两份逐字节一致的 lock
  以及完整 `node_modules` metadata closure；Vitest list/test 同时关闭 cache。依赖缺失或任何
  install/relink/cache 漂移都会令采集失败，只能通过显式 reviewed `pnpm install` 修复。这是依赖
  mutation 检测，不 hash package bytes、不递归证明 store 内容，也不构成供应链真实性证明。
  Vitest 的 HOME/TMP/XDG、user/global npm config 与 PATH 均为私有 allowlist，tool/report/inventory
  只在 physical `/tmp` 的 `0700` 随机目录中创建；workspace `.npmrc` / `.pnpmfile.cjs` 持续缺失，
  `envDir: false` 阻止 ignored `.env*` 进入 Vite 测试环境。macOS 的 shared `/private/tmp` 会让新目录
  继承 `wheel` 组，因此 Vitest tool hierarchy 在创建每一级后还显式绑定当前 POSIX UID/GID 并在使用
  前复核；部署安全夹具也显式规范自身模拟身份和外部祖先权限，不再依赖宿主 TMPDIR 的偶然 mode/GID。
- Vitest execution capture lock 已升级为 `vitest-execution-capture-lock-v2` owner 文件并位于 Git
  common directory。canonical 与 publication candidate 在完整持锁周期保持同 inode 的双链接，
  后者作为 lifecycle guard；只删除 canonical 会留下孤立 guard 并继续阻断 acquire。冲突时永不自动回收：即使同机同平台且 owner PID 明确不存在，
  acquire 也失败关闭，因为父进程消失不能证明 Vitest 子工作负载已停止。只有操作者在核对进程树后
  显式确认“无后代工作负载”才可进入 stale recovery；恢复前以 hard link 留存 digest-named
  quarantine，并以 `O_EXCL` recovery claim 串行恢复；锁龄不参与判定。live、权限拒绝、未知、异地主机、
  畸形、symlink、legacy directory、遗留 claim 与孤立 candidate 全部保留并失败关闭；inspection
  报告后两者精确路径，只能在人工核对无相关工作负载后移除。capture/verify 都先在锁外要求 Unix
  runner 通过 exact `/bin/ps -axo pid=,pgid=` detached capability probe；verify 在受监督的
  `vitest list` 与一致性校验全程持有同一把锁。若 v2 containment receipt 不成立，锁、guard、私有
  tool/report/inventory 目录会保留，仓库内孤立 `.vitest-execution-*.tmp` 也会阻断下一次运行。
  若 evidence rename 后任何 source、sink 或 pnpm 安装状态终检失败，同样保留 canonical candidate、
  锁、guard 与临时目录，防止后续 verifier 把已明确失败的候选重新当成可信 canonical；precommit
  失败仍保持旧 evidence 并释放锁。它不扩大 execution artifact 的证明范围，也不构成对非协作
  写入者的事务隔离。
- Vitest 采集失败时，经过严格校验的 reporter 最多输出五条排障摘要：稳定测试 ID、仓内
  文件位置、执行耗时、首条错误的固定类别，以及可识别的 -1 到 255 整数 equality 或
  test/hook timeout 数值；其余断言只标为 assertion，其他错误标为 unclassified。摘要不输出测试标题、原始断言文本或
  stack，也不从耗时推断失败原因。失败仍保留旧成功证据并清理受控临时报告；这些摘要
  只用于命令诊断，不进入公开成功 artifact，不改变其格式或验收门槛。
  采集专用 JSON reporter 还会将经过 Zod 校验的私有报告与 Vitest 结构化结果按文件、用例
  顺序、嵌套标题、位置和状态对齐；对于可识别的首条 test/hook 超时，还核对原始错误一致性，
  再从结构化 message 恢复固定超时行，避免 Vitest 4.1.10 的占位 stack 丢失错误类别。
  不匹配即停止写报告，未识别的错误保持原样；它不修改 runner 对象、通过/失败判定或计数。
  双 reporter 实际回归同时覆盖数值断言、test/hook 超时、同名参数化用例、通过、跳过与 todo。
- 当前唯一 Vitest 执行证据指针：artifact `docs/evidence/vitest-execution-latest.json`；format `diesel-vitest-execution-evidence-v1`。
  动态测试计数、执行时间、HEAD 与 source fingerprint 仅从该 artifact 派生；`STATUS.md` 不复制这些值。
- 2026-09-29 回答修复后的首次全量采集以 1 退出，旧成功 artifact 未替换。两条失败均为
  `tests/live-eval-readme-snapshot.test.ts` 的文档一致性断言：新中文历史说明缺少明确的
  历史归档定位，被识别为台账外的当前结果声明。仅修正文案的历史边界，不改测试、
  评分器、阈值或报告；随后重新执行完整采集，最终状态仍只看上述执行证据指针。
- 2026-09-13 私有 abort 诊断修复后的首次完整采集返回 1。工作负载正常结束，结束进度记录
  含一条测试失败；采集器还检测到 `node_modules/.vite/vitest/.../results.json` 改变。
  操作者在全量采集期间另跑了 `pnpm ai:eval`，该命令更新的缓存条目及时间与漂移吻合。
  依赖边界错误先于报告归一化抛出，因此详细失败摘要未被保留；不能仅凭已独立确认的
  旧截图 source drift 断言它是该次测试失败的唯一原因。旧成功 artifact 字节未变，受控
  临时文件按既有失败流程清理；不改写原结果、不忽略缓存漂移，也不放宽通过标准。
  后续先完成真实截图与浏览器采集、同步文档，再执行最终全量；全量期间不并行运行任何
  Vitest 命令，也不修改源码、文档、依赖或其他证据文件。
- 2026-09-12 同主版本安全维护后的首次完整 canonical 采集返回 1：所有文件完成，但
  `tests/deploy-scripts.test.ts` 有一条用例触发 5 秒 test timeout。旧成功 artifact 字节未变，
  采集锁已正常释放；定向回归、构建和浏览器通过不能覆盖这次失败。随后 `pnpm portfolio:verify`
  同样返回 1，在新增测试尚无完整通过证据的 inventory drift 处停止，后续校验阶段未执行。
  该次失败保留为失败，后续运行须独立完成全量采集；不放宽超时、不跳过用例或重写旧报告。
- 独立定位到 prepare preflight 的预存在 `.deploy-ready` symlink 拒绝用例；两次原样定向重跑均通过，
  不能据此认定完整套件已通过或唯一超时原因已确定。该夹具在拒绝前重复启动 Node 做路径解析，
  测试专用 shim 因此收窄为 fresh native identity fast path：仅规范绝对路径且原生命令成功返回
  与输入逐字相同的路径才直接使用；链接改写、`.` / `..`、非规范路径和原生错误仍走原 Node
  `realpathSync`，不缓存解析结果。Darwin BSD 与 Linux GNU 的参数分开并检查严格存在能力；
  不可用时保持 Node fallback，原有 `/proc/*/fd/8` 模拟不变。此修改不涉及生产部署脚本，
  不宣称原生命令与 Node 对所有 symlink / `..` 组合语义等价，也不把 macOS 运行当作 Linux 运行证明。
  新增原 CLI 返回值对照回归通过；原 file / symlink 两例保持断言和默认 5 秒限制，单次无缓存
  重跑分别用时 2.239 / 1.652 秒。此前同 symlink 两次局部重跑约为 2.54 / 2.133 秒；这不是稳定
  性能基准，也不覆盖首次全量失败。后续完整结果仍以新采集 artifact 和实际 verifier 退出码为准。
- 2026-09-11 浏览器运行时错误检查这一轮的完整 canonical Vitest 采集未通过：测试工作负载达到
  既定 30 分钟上限并以状态 124 结束，未生成完整 JSON reporter 输出；采集命令返回 1，
  旧的成功 artifact 原样保留，采集锁已释放。新增检查及相关定向回归通过不替代完整执行证据。
  随后的 `pnpm portfolio:verify` 返回 1，在当前测试清单与保留证据不一致处停止；后续校验阶段
  未执行。该次运行不构成完整质量门或发布通过；随后先定位全量测试耗时，不放宽超时或重写旧报告。
- 同日后续诊断发现 ledger 测试夹具每次 stat 查询会重复启动 Node。夹具已改为每次 fresh native
  metadata 读取，保留低九位权限与模拟 owner 语义，并补双方言、漂移和链接合同；信号 harness
  同时清理 completion timer、为尚未写完的 ready marker 保留退避。两条相同 ledger 用例的
  单次无缓存对照从 7.563/17.356 秒降为 5.153/11.602 秒；未改动的激活对照从 10.618 秒到
  9.889 秒。这是局部测量，不是稳定性能基准、全量提速保证或上次超时唯一原因的证明；
  完整验证仍须使用原有 30 分钟上限和全部测试，不通过时继续保留旧 evidence。
- 该优化后的完整采集仍未通过：2026-09-11 08:23 UTC 开始的 workload 在约 30 分钟后终止，
  外层监督器报告 `bounded-command-v2:residual-group`、状态 126，且没有 completion receipt
  或最终 Vitest JSON。它不是一次已证明清理完成的普通 124 超时；采集按协议保留锁、guard 和
  私有诊断目录，旧成功 artifact 的 SHA-256 读回未变化。09:05 UTC 再次核对原 PGID、已知后代、
  相关目录占用和公开 lock inspector 后，操作者通过既有 quarantine API 恢复锁；旧 owner 字节
  与失败诊断仍保留。当前已无相关进程的观察不反向证明当时成功收口，也不能确定当时 residual
  是 worker、服务进程还是正在退出的子进程。后续采集先补增量活动诊断，不修改通过标准。
- 采集 reporter 已增加有界、脱敏的五秒进度快照，包含并发活动用例和模块内 collection ordinal，
  不依赖最终 JSON 已生成。真实正常结束的集成用例验证“先观察到活动记录、后生成原完整报告”；
  独立临时夹具还在 8 秒 watchdog 中断下观察到 5 秒 heartbeat、最终 JSON 缺失、状态 124 的
  v2 completion receipt 和原 worker 已退出。这个受控实验只验证失败时的诊断可用性，不构成
  完整测试通过，也不能解释先前 126 的具体 residual 来源。普通无 outputFile 用法仍保留纯 JSON
  stdout；原全量上限、失败判定、artifact 格式及发布条件均未放宽。
- 上述进度诊断后的完整采集已生成新的成功 artifact；严格解析、逐例计数重算和当前源码绑定
  校验通过。该成功只对应 artifact 记录的源码快照。随后 `pnpm portfolio:verify` 返回 1：
  保留的真实模型报告仍为 v13，与当前 v17 契约及源码指纹不一致；旧报告保持原样。
  后续模型知识检索输入 schema 收窄属于新改动；每次源码变动都要求重新采集完整执行证据，
  不能沿用上一次成功证明新源码或发布已通过。模型调用中的实际 JSON schema、非法额外参数
  在检索前拒绝、fullStream/SSE/audit 不泄露 marker，以及合法调用固定 `null/5` 均有回归测试；
  这不替代新契约下的真实模型表现评估。
- 当前浏览器证据快照：format `diesel-playwright-evidence-v1`，run ID `4d17260d-5cfd-479c-9e40-8cfd837cca77`，artifact SHA-256 `c7d4dfabbc50ac2ac84059740a9ae8ad61279ca1cd268a916725fc215c147aa9`；
  observedAt `2026-09-29T11:48:37.615Z`，clean worktree / base HEAD `0be6898790b891fbc59fe40b61305cd558bbbc13`；
  `public` = `348 passed / 65 skipped / 0 failed / 0 flaky / 413 collected`；
  `demo` = `68 passed / 0 skipped / 0 failed / 0 flaky / 68 collected`；
  `fde` = `2 passed / 2 skipped / 0 failed / 0 flaky / 4 collected`；
  `production-csp` = `2 passed / 0 skipped / 0 failed / 0 flaky / 2 collected`；
  聚合为 420 passed / 67 skipped / 0 failed / 0 flaky / 487 collected。artifact 为 177128 bytes；
  browser source fingerprint 为 344 files / `6a443085ca4a0ff58f15fced062e16206aaf7791b384ac608bfe814d8e3ad521`。
  因运行发生在 clean worktree，`evaluatedCommit=0be6898790b891fbc59fe40b61305cd558bbbc13`；它证明该本地候选提交上的浏览器验收，
  不冒充远端 CI、安全审计、生产部署或现实用户成效证据。
- v25 本批完整浏览器采集在 `2026-09-13T17:22:23.170Z` 返回 1：public 为 311 collected，
  264 通过、2 失败、43 跳过、2 未执行；后续三个套件未由该采集执行。桌面及移动端
  `canonicalizes and strips invalid filter params` 各捕获 3 条未截断 pageerror，栈均指向
  bundled React webpack 开发版 `flushComponentPerformance` 的 rejected 分支；原 URL
  规范化与页面可见性断言通过。trace 中原始请求为 HTTP 200，HTML 含 meta refresh 与
  `NEXT_REDIRECT;...;307`，不是实际 HTTP 307 响应；未记录测量实参数值，不推测负值大小。
  失败诊断的开始/结束 browser source 一致：335 files /
  `1ab15345e6a79d58ff9c762b9000abb972c92ee53b4397d512bc59b4c2b1421e`；诊断 95475 bytes /
  `48b21f17240bbe88f8f291fbc89bf6439ca8dcd0ef7783ad054c7c6055ead7f4`。
  26 个原始诊断文件已逐字节复制核对，保留在操作者本地，不是发布/CI artifact；旧成功
  浏览器工件未覆盖，不能代表本批当前输入验收通过。未屏蔽错误或重跑至绿。
  后续单独顺序执行 Demo（68 通过）、FDE（2 通过 / 2 跳过）、production build 与 CSP
  （1 通过）均返回 0；源码和依赖安装边界及三个独立回执校验通过。这些局部结果不拼接
  为完整浏览器通过，也不是本次国家规范化动作的生产模式对照或 React 缺陷修复。
- 2026-09-14 截图会话补强了两条发布前边界：identity/shutdown JSON 改为读取时累计实际
  字节的 4 KiB 上限，共用请求 deadline；超限/abort 不等待挂起的 cancel。探针禁用 redirect，
  不使用的响应 body 主动取消。clean child exit 后，超时、reset、其他 HTTP 错误和畸形
  identity 不再当作 endpoint 已消失；只接受连接拒绝、404/410 或 strict schema 的不同 nonce。
  4 文件 / 105 条聚焦回归通过，包含原停机和回滚测试；随后真实隔离 Demo 截图采集返回 0，
  两张英文图及 manifest 通过完整发布验证并目视核对。此局部结果不是全量质量门或生产发布证明；
  全量执行与源码绑定仍由对应 canonical artifact 和 verifier 判定。
- 2026-09-14 后续优化 ledger / governance publication 测试中的 SHA-256 包装器，
  未改生产脚本、校验次数、fsync 或超时。固定 OpenSSL 的二进制摘要和 `od` 先做能力验证，
  每次 fresh 读取；非零、畸形或不可用时静默回退到原 Node，不缓存路径或内容。
  本机 Darwin arm64 / Node v22.22.3 上对最终生成脚本分别交替测量 4 KiB / 256 KiB
  二进制夹具，每种后端每种大小 3 次预热、40 次记录；Node 中位数为 22.321 / 22.349 ms，
  native pipeline 为 4.636 / 4.745 ms，所有输出逐字一致，单次 native 能力准备为 5.688 ms。
  此结果是单次摘要微基准，不是全量套件或 Linux 性能承诺；新的完整执行结果仍以 canonical
  artifact 及当前源码绑定为准，不沿用先前成功快照证明新改动或发布通过。
  同批把 publication 的 Node-only realpath 包装器接入已有严格原生助手，保留 FD 8 输出后的
  `realpath-fd8` 日志顺序，普通路径不新增审计事件；默认调用者行为与原 Node 回退不变。
- 2026-09-14 业务边界复核复现并修复字符串功率在校验前被浮点舍入的问题：
  `55.999999999999999999` 不再变成 56，`100000.000000000001` 不再变成 100000，
  `±1e-999` 不再作为零送往查询服务。先检查原始十进制/科学计数法的精确整数瓦数与
  既有 0–100000 kW 上限；合法科学计数法和尾零仍可规范化，URL 首值规则不变。
  已解析的 JSON Number 不保留原词法精度，这不是无损 JSON 数字解析器。
  同批修复全部认证失败时的理由汇总：明确 scope、功率或日期不覆盖优先于同一认证的
  unknown 项，不再生成 unknown 代码配 fail 状态的矛盾解释；原始理由、合规结果、供应轴
  和评分规则不变，未知控制仍未知。存在 unknown 候选时，缺口理由只取自这些候选，
  不再误选已明确 fail 认证的 unknown 子项。Case Study 中英两版也区分公开代理阻断、标准服务端
  身份/RBAC 治理写入与隔离的本地 FDE 自助演示，不再把整个治理实现描述为 Demo-only。
- 2026-09-14 后续修复未知分享型号留下的自动评估资格：目录首次就绪时即结算该次
  尝试，未知型号不自动评估回退产品；手动结果的迟到 RSC 确认不再提交未确认草稿。
  中英回归先复现 150 kW 手动结果被 175 kW 草稿替换，再核对修复后仅有一次 POST，
  草稿仍为 175、已提交 URL/摘要/聊天上下文仍为 150。外部导航、目录错误重试和合法
  共享链接的自动复现保持原规则，不增加产品或接口。
  同批 publication 测试夹具将 mode/nlink/size 合为一次 fresh native stat 读取；GNU
  使用 `%a:%h:%s`，BSD 使用 `%OMp%03OLp:%l:%z`，修复旧 `%Lp` 遗漏特殊权限位的
  夹具差异。模拟属主、故障标志、lstat 链接语义及生产校验/fsync/回滚调用保持不变。
  本机 Darwin arm64 / Node v22.22.3 交替测量各格式每后端 3 次预热、40 次记录，普通
  权限夹具的全部输出一致：nlink/size 中位数由 10.674/10.769 ms 降至 7.281/7.224 ms；
  owner+mode/mode 则由 6.980/6.773 ms 变为 7.339/7.221 ms，未宣称所有格式都变快。
  这只是单次调用微基准，不代表完整测试套件或 Linux 性能；特殊权限位差异单独由正确性
  回归验证，不混入等价输出的耗时对照。
  随后的全量单元执行真实返回 1：260 文件 / 7818 条，7812 通过、1 失败、5 跳过；失败位于
  SHA-256 夹具的 `valid-digest-nonzero` 能力测试，模拟后端调用日志为零，耗时 2013.516 ms。
  这与 2 秒探测边界一致，但原报告未保存底层 spawn 错误，不能断言其具体原因；新 stat
  回归没有失败。原始报告（2762638 bytes /
  `61537c2efbc7e55e1075d01535c7cb2ae5952d8d9c28e40e0c5d841bc19fe6b4`）
  保留于操作者本地，旧成功 canonical artifact 未覆盖，不能证明
  本批通过。后续仅将能力拒绝决策单测改为明确执行且核对全部探测参数的受控 runner，
  保留默认真实探测边界与真实后端/运行时回退测试，不将未执行的分支算作覆盖，也不改生产脚本。
  临时移除非零退出检查时，新 `valid-digest-nonzero` 决策用例按预期失败；恢复助手并核对
  字节一致后，SHA-256（84 条）、stat（41 条）及 STATUS 合同共 3 文件 / 337 条聚焦回归
  通过。该局部结果不代替后续完整 canonical 单元执行或作品发布门。
- 2026-09-14 聊天入口的原生 anchor 增加点击意图判断：Ctrl/Meta 等修饰点击不再取消
  原页面正在进行的产品评估，普通主键点击与键盘 Enter 保留完整 document 导航和旧请求
  取消。中英桌面 Chromium 的可信修复前对照为 2 项新标签页误取消失败 / 4 项同页控制通过，
  最小接线后 6 项全部通过；新标签页使用已提交的 100 kW，原页面随后仅一次真实 POST
  完成 150 kW 结果并保留重复跟踪参数，不改已打开聊天页。此前几次测试装置失败及 trace
  原样保留：原生导航挂起时 DOM 求值会等待，改以 frame commit 观测；首次开发编译刷新
  则在无评估时预热真实跨文档路径后再开始受控请求。未屏蔽 runtime error 或变更业务期待。
  这些定向结果不替代本批完整质量门、canonical 浏览器/单元证据或生产发布验收。
  同批再复现并修复目录迟到的自动运行竞态：点击 Header 首页后，旧面板在目录返回时
  仍会启动分享链接评估；修复前中英均观察到应为零却出现一次的真实 POST，无导航正对照
  均通过。导航现在同时退休初始资格并递增 epoch，已排队任务在执行前核对 epoch；
  effect cleanup 只 abort，避免 StrictMode 错误消费正常资格。修复后四项真实浏览器回归
  与 32 项点击/通知/接线单测通过；手动编辑和重试保持原语义，不新增永久导航封锁或路由层。
  随后的完整单元采集真实返回 1：260 文件 / 7852 条，7846 通过、1 失败、5 跳过。
  唯一失败是公开事实镜像检查：架构文档把产品适配请求称为“完成中的新评估”，被保守的
  模型成绩校验识别为结果声明。原始 JSON（2774606 bytes /
  `a978dfa3c607f955f146401d826e6a8121e2557fdd0ffa191c8fc96ad496a75e`）
  保留于操作者本地，旧成功单元 artifact 未替换。修正仅明确文档主语为待返回的确定性产品
  适配请求，不放宽成绩校验器、不修改测试期待，也不改此前仅作为候选排查的子进程超时。
  该失败记录不代表后续完整执行已通过；当前通过证据仍只由 canonical artifact 与源码绑定判定。
- 2026-09-15 本地浏览器复现并修复跨标签页语言不一致：旧根布局保留原语言，新的 Chat
  RSC 已使用另一标签页保存的 Cookie，导致正文/metadata 与 Header/输入框不同语言。
  单一语言控制器在 route commit 与重新聚焦时按共享 Cookie 执行只读刷新，Header 与 Drawer
  不再各自拥有独立异步写入者；显式重选仍可覆盖已变化的 Cookie。进一步的双向回归真实挂起
  目标语言 Chat RSC，另一标签页切回原语言再释放：修复前两方向都在标题/正文一致性断言失败，
  Cookie、html 和输入框却已一致。公开服务端页面现提交语言回执，与根布局和当前 Cookie
  一起核对；不只修改客户端词典，不增加数据库、偏好来源或模型调用。初次加回执后的
  10 项局部浏览器回归通过，包含原有 Drawer 恢复；这不代替随后完整质量门及源码绑定。
  修复前同次运行另有 1 项冷开发加载失败：没有任何偏好 POST，trace 显示点击早于布局
  客户端脚本下载，单独保留为 hydration 就绪问题，不归入上述两项竞态。按钮 SSR 阶段
  禁用、接线后启用，并增加独立回归；旧失败报告及 trace 保留于操作者本地。
  回执提交引用与 hydration 修复后的 44 项局部浏览器回归全部通过，含默认语言、Cookie
  持久化、页面/抽屉切换、原刷新超时恢复与产品状态。另修正新增 SSR 单测的 createElement
  写法以满足 lint，不屏蔽规则；完整证据仍须重新采集。
  当前模型 403 原报告保持不变，局部界面检查不表示作品门或生产发布已通过。
- 2026-09-14 国家 URL 后续修复把 GET / HEAD 的目录内单段 ISO3 与筛选规范化提前到
  Next 请求入口，返回同源 HTTP 307；页面复用同一解析函数并保留防御校验。原先的已知首值、
  未知多值、无默认日期和未知国家 404 规则保持不变；API、写方法及其他路径不纳入。
  原 `canonicalizes and strips invalid filter params` 的浏览器 pageerror 检查保持原样，
  不把绕开一个 redirect 渲染路径描述为 React 开发计时根因已修复。
  本批未改变模型访问配置；此前首请求 HTTP 403 的报告及 archive 原样保留，不因源码变化
  重复付费调用来刷新分数。该历史观察不绑定本批新源码，后续作品门须如实拒绝过期模型证据。
  首次定向浏览器运行 18 通过 / 4 失败，四项都是新增用例错误假设 HTTP 能保留
  `__proto__`；本地 Next 16.3.3 的 query 对象往返及实际响应证明该键在 Proxy 之前丢失。
  普通未知分析参数仍按原规则保留；新增负向用例与纯函数保留测试分别表达边界，
  不改 Next 配置或原 pageerror 断言。首次定向脚本还误开启完整 evidence 标志，报告器
  正确拒绝非 canonical CLI；修正仅限本地定向脚本，正式采集合同不变。原始失败 trace
  已逐字节保存在操作者本地，不能作为发布 artifact 或整体通过证据。
  修正定向脚本和上述测试边界后，同一组原始 pageerror 断言与新增中英 HTTP / 硬导航 /
  真实选择器软导航检查共 26 项通过；软导航观察实际 RSC 307、内部 `_rsc` 不进入目标、
  document marker 保留，源码与依赖安装前后核对一致。这仍是局部开发模式结果；生产模式
  另加 GET / HEAD 307 的安全头检查，完整结果以随后正式四套采集为准。
  随后的完整四套采集返回 0，并生成上方当前快照：public 294 通过 / 43 跳过、Demo 68
  通过、FDE 2 通过 / 2 跳过、production-CSP 2 通过。生产构建与生产 GET / HEAD 的真实
  307 / 严格安全头检查通过。根布局故障注入夹具仍按设计产生日志异常；这不是全运行零
  错误日志声明，也不证明 React 底层计时或真实 PostgreSQL 国家页面体验已验证。
- 2026-09-08 的一次本地公共浏览器运行中，移动端国家页无效参数规范化用例附近记录了
  三条 `Performance.measure` / `CountryPage cannot have a negative time stamp` 开发服务器
  浏览器异常。该用例的 URL 断言通过；尚未取得异常调用栈、确认根因或在生产环境复现。
  此观察作为独立待定位问题保留，以上通过计数不等于“零浏览器运行时异常”。
- 2026-09-11 独立重跑原始移动端地图/Chat 文件：37 通过、10 跳过，服务日志未复现负
  时间戳异常；这不是根因确认或修复证明。国家页与 Chat 参数规范化用例现显式检查所包裹
  导航期间的 `pageerror`：出现未处理异常即失败，并附独立 JSON 诊断（最多 10 个样本，
  每个 name/message/stack 分别最多 200/2,000/8,000 个 UTF-16 单元，完整错误数单独保留）。
  原断言失败及附件写入失败不会被覆盖成通过；监听在检查结束后移除。不改动应用重定向、
  React/Next 依赖或历史模型报告，也不宣称所有浏览器用例已无运行时异常。
- 2026-09-12 旧 Drizzle loader 清理后的完整浏览器采集再次复现上述问题，并由新增运行时
  检查正确阻断：公共套件 232 通过、1 失败、29 跳过、2 未执行；失败为移动端
  `canonicalizes and strips invalid filter params`，包含 3 条 pageerror。整体采集返回 1，
  reporter 因未执行项拒绝生成完整回执，未覆盖当时保留的成功 artifact；它不能证明当前
  依赖输入通过浏览器验收。该次 trace SHA-256 为
  `2cb6e5d5cea51c8aa5017df2a379d7bdb80088fbf8b526bc8ae66d1b7f5e519d`，原 trace
  与错误上下文保留在操作者本地诊断目录，不是已发布的 CI artifact。
  此次已取得调用栈：3 个 URL 均给出正确的服务端规范化重定向；异常出自 Next 16.3.3
  内置 React webpack 开发版 `flushComponentPerformance` 的 rejected 组件分支，传入原生
  `performance.measure` 的 end 缺少非负检查。应用没有设置该时间戳；trace 未记录参数值，
  不能断言具体值就是 `-Infinity` 或时钟漂移就是根因。上游
  [Next issue 86060](https://github.com/vercel/next.js/issues/86060) 与
  [React PR 37563](https://github.com/react/react/pull/37563) 对应该路径；复核时 React 修复
  仍为 open / review required，Next 的早期编译产物补丁曾被维护者要求先修复 React 根因。
  本轮未引入未合并的框架补丁，未关闭开发计时、屏蔽 pageerror、添加等待或重跑至绿。
  依赖漏洞清理的通过结果不覆盖这次完整浏览器失败，后续独立套件也不能拼成整体通过。
  后续独立 Demo 的 68 项行为通过；首次 FDE 行为通过后，安装保护检测到并行 Vitest
  写入缓存而使监督操作失败。停止并行后重新顺序执行，FDE 2 通过 / 2 跳过，生产 CSP
  1 通过，安装前后检查与资源清理均通过。它们不替代公共套件，也不证明国家页重定向的
  生产对照已完成；没有利用这些局部结果重写保留的完整浏览器 artifact。
- 2026-09-12 国家详情另一个同日筛选同步缺陷已先用真实浏览器复现：产品匹配、摘要 API
  和 RSC / URL 均切到 `marine / 150 kW / 2026-01-20` 后，页面仍稳定显示旧
  `non-road / 100 kW` 摘要，原回归返回 1。原因是 Drawer 仅缓存首次 SSR 响应，而
  新筛选上下文又使客户端摘要失效。当前本地修复每次采用最新 SSR 基线，客户端缓存绑定
  ISO3 / scope / power / asOf，摘要 loading / result / error 同属查询上下文，换代取消
  旧请求；不重挂同日产品表单，不修改匹配判定、数据库或 fixture。新增 23 条状态选择
  回归通过；真实摘要 API 早于 / 晚于 RSC 的两条浏览器回归均通过，另验证只发出一次
  匹配 POST、Chat 链接保留已提交查询，以及切中文后保留 175 kW 草稿而摘要仍为已评估
  的 150 kW。局部验证使用本地 Demo，最终完整验证仍以本次源码对应的真实执行 artifact
  为准。这不是上述 React
  开发计时异常的修复，也不覆盖尚未验证的同日外部软导航表单同步或跨日期重挂行为。
- 同次修复后的完整浏览器采集产生了当时的快照（run ID `cb533d77-1c3f-4c66-9d98-53d9a8fdfcdd`），四套回执及安装边界均通过。原
  CountryPage 规范化用例此次未复现负时间戳；故意触发根布局故障的独立测试夹具仍在
  日志中记录 `FixtureLayout cannot have a negative time stamp`，另观察到服务端
  `The destination stream closed early`。通过计数只证明各用例实际断言通过，不等于
  全运行零错误日志，也不证明 React 计时缺陷已修复；旧失败 trace 与记录继续保留。
- 本轮随后发现证据采集顺序错误：浏览器通过后更新截图 manifest，仍会使浏览器输入
  指纹变化；不能把先前的通过报告当作最终输入的通过。两版 README 已明确改为
  截图 → 浏览器 → 更新 STATUS / 冻结源码 → 完整 Vitest → verify，并用回归锁定顺序。
  已启动的那次 Vitest 由操作者主动向已核对的监督器发送 SIGTERM，监督退出 143、
  capture 返回 1，没有完整 reporter JSON，也未替换旧 Vitest artifact；正常释放锁，
  两个已知采集/监督进程退出。它不是测试通过或超时失败；后续重新按依赖顺序采集，
  不改写旧报告指纹、不放宽任何断言或超时。
- 截图输入冻结后的第二次完整浏览器采集在 2026-09-12 再次返回 1，public 耗时约 6.7 分钟：
  234 通过、1 失败、31 跳过、2 未执行（268 collected），后续三套未运行。
  同一个移动端参数规范化用例记录 3 条 `CountryPage cannot have a negative time stamp`
  pageerror；trace SHA-256 为 `93ee0e0faaefd2bc15b4b44ef2e58c3da033b371fdfd4ae7917af9928913b91b`。
  reporter 再次因未执行项拒绝生成回执，旧成功浏览器/Vitest artifact 未替换。当时保留的成功快照
  是历史测量，并不绑定该次最终截图输入或其后新增代码；不能据此宣称当时完整验收通过。
- 该失败暴露的报告缺口现已修复为独立 `diesel-playwright-failure-v1` 诊断：失败及未执行项
  可留逐例结构化记录，`finalStatus=null / notRun` 与声明 skip 分离；计数按实际结果重算，
  provenance 读回失败明确为 null。成功 receipt/aggregate 的严格合同未放宽，诊断始终标为
  execution-only 且 reporter exit 1，不进入发布证据。真实隔离 Playwright 夹具已验证
  3 通过 / 1 故意失败 / 4 声明跳过 / 2 依赖未执行，子命令返回 1 且保留诊断；外围回归通过。
  这不修复 React 计时异常，也不把先前失败日志补写成新报告；原 trace 和成功快照继续保留。
  本轮 lint、typecheck、production build 通过，7 文件 311 条聚焦回归和 21 条离线 AI eval
  通过；这些局部检查不替代当前源码的完整 Vitest 执行工件或仍未通过的浏览器验收。
- 随后完整 Vitest 采集正常结束并返回 1：236 文件、6639 条测试，6633 通过、1 失败、
  5 跳过，耗时约 22.2 分钟；没有替换旧执行 artifact，采集锁正常释放。这不是超时或取消。
  唯一失败已独立复现：文档检查器把上条明确标注的“离线 AI eval”误当成需要进入真实
  模型结果台账的成绩。修复只排除紧邻的明确离线评估主体，保留否定、混合模式、同句
  其他主体及跨句承接检查，并补中英文红转绿回归；没有删除真实离线成绩或修改模型报告。
  修复后 lint、typecheck、production build、7 文件 348 条聚焦回归及 21 条离线 AI eval
  均通过；聚焦回归包含 37 条新增中英文范围判断及否定/混合模式检查。
  当时的 `portfolio:verify` 因测试清单与旧执行 artifact 不一致返回 1。随后完整采集返回 0，
  新工件已按逐例结果重算，源码指纹读回一致、采集锁释放；作品校验转而在保留的浏览器工件
  源码指纹不匹配处返回 1。没有替换浏览器或模型报告，也不据此宣称生产验收通过。
- 后续仅让 host activation ledger 测试夹具复用既有严格 native realpath 助手；每次重新解析，
  仅返回原样规范绝对路径时使用原生命令，其余仍回退 Node，FD 8 模拟不变。
  生产脚本、断言、测试数量和超时均未更改。同一 macOS 主机按相同命令顺序执行三次无缓存
  前后对照，历史终态清单成功路径中位数由 9.844 秒变为 7.646 秒；符号链接拒绝路径由
  1.777 秒变为 1.588 秒，六次均通过。后者由 find 拒绝链接，不替代助手自身的链接/路径
  语义回归。这是两个用例的局部观测，不是稳定性能基准、Linux 实测或完整套件提速保证。
  lint、production build、287 条聚焦回归与 21 条离线 AI eval 通过。独立 typecheck 曾与 build
  并行，因 `.next/types` 被重建而返回 2；构建结束后按顺序重跑返回 0，没有修改类型规则。
  随后该夹具调整后的完整采集返回 0，逐例重算与源码指纹读回一致，采集锁正常释放；作品校验
  仍因保留浏览器工件的源码指纹不匹配返回 1。此结果不证明浏览器或生产验收通过。
- Case Study 的中英文曾把历史评分合同及初始化失败观察误述为当前状态，且固定的历史 schema
  范围已落后于实际注册表。现成对明确历史演进、版本专属解析与当前台账的边界；初始化失败
  说明改为条件句，明确历史观察继续保留。文档镜像测试已先捕获旧文案；不改写模型报告、
  验收分数或生产状态。上述完整工件只绑定这次文档及测试修正前的输入，修正后仍需重新验证。

- 2026-09-15 本地测试调度优化：从 `deploy-scripts.test.ts` 完整提取 37 条 host activation
  ledger 用例，保留原文件 558 条；共享夹具每次仍隔离创建临时目录，测试体、断言、争用场景、
  真实子进程及超时不变。CI 显式选择和 coverage 排除列表同步包含新文件，校验器拒绝旧列表
  漏掉提取套件；两条新增负向回归先观察到实际失败，再随合同更新通过。最近拆分前完整报告
  中，原 595 条文件耗时约 1,310.81 秒，ledger 组 37 条耗时合计约 158.31 秒；后者不是
  已实现的墙钟节省。本项不改生产代码、数据或发布状态，最终执行结果以 canonical 工件为准。
  首次浏览器采集的 public 用例为 348 passed / 65 skipped，但并行运行的离线 AI 评估
  改写了 Vitest results cache，安装目录一致性检查因此非零退出且保留旧 artifact。
  停止并行测试后隔离重采，四套 aggregate 和生产构建通过；当前浏览器快照只指向该次
  完整采集，不将先前被拒绝的采集当作成功证据。采集期间不得并行运行其他测试或包管理命令。

- 2026-09-15 面试演示入口修正：中英文 Demo 脚本均提供同参数的本地首页、CHN 深链和
  AI 工作区入口，明确默认端口、更换端口和所选环境一致性；避免本地演示误用尚未升级的
  托管版深链。两条语言回归先捕获缺失入口再修正。两版 README 和部署手册同步四个部署
  测试文件的选择/coverage 排除事实；普通文件级调度不再误述为 suite 并发不变。
- 2026-09-15 GitHub 只读复核：远端 `master` 仍指向 currentPublicRelease 所记录的提交，
  branch 响应显示 protected、唯一 `Required CI gate` 和 `app_id=null`。完整 protection
  接口因集成缺少管理读取权限返回 403，因此没有重新证明 strict、管理员和删除/强推设置。
  [2026-09-14 scheduled CI](https://github.com/Jameskyzx/diesel/actions/runs/34825255065)
  已结束并因 dependency audit 非零退出；其中三项 critical 对应本地安全文档已经记录、但
  尚未部署的 Next/MapLibre 修复。该 run 使用远端旧 workflow，未执行 quality/浏览器等
  非定时套件，也没有新版汇总 gate。它不是当前工作树 CI 或 VPS 读回，生产状态不变。
  本地 `pnpm audit:security` 重查在 60 秒期限后超时并返回 1，没有取得新 registry 报告；
  2026-09-12 的零告警结果仍只作为历史观察，不能改称本次审计通过。

## 历史材料审查记录入库（2026-09-12）

日期化人工审查摘要现由 [DEVELOPMENT_HISTORY.md](DEVELOPMENT_HISTORY.md) 的中英文入口
引用，纳入 release-evidence 的精确路径/提交字节校验。摘要覆盖已完成的有限观察；不包含
原始临时报告、上游许可证全文或下载包体，不构成版权批准或新的密钥扫描。旧 audit schema、
留档哈希、五项归档阻塞及生产状态保持不变。新增回归约束双语入口、来源集合、阻塞边界，
并拒绝摘要仅在工作树或 index 更新而未进入 release HEAD 的情况。当前全量测试证据仍由
上方 qualitySnapshot 指向的实际执行工件记录，不以本段手工填写测试成绩。

## 三角色模拟评估与本地修复（2026-08-12）

- 三个 subagent 分别模拟海外销售/区域销售、法规/合规工程师和产品/应用工程师，
  走查零配置 Demo 与相关查询链路；完整场景、证据和 P0/P1/P2 见
  [SIMULATED_USER_EVALUATION.md](SIMULATED_USER_EVALUATION.md)。这是内部 AI 角色模拟，
  不是现实用户试点、法规专家签核或 KPI 测量。
- 模拟发现的 P0 历史时态问题已在当前本地工作树修复：`asOf` 派生
  `statusAtAsOf`，保留 `recordStatus`；现在 superseded 的记录可在其历史有效期返回，
  但必须有闭合的 `effectiveTo`；未来 adopted 必须有 `adoptedOn <= asOf`。空采纳日或
  未闭合 superseded 的异常数据 fail-closed，proposed 永不进入 effective 集合。详情、
  比较、product-fit 与 AI citation 的 DTO/测试同步调整。
- Demo 首屏降级、unknown 补数摘要、详情筛选进入 chat、聊天证据折叠/状态中文化/
  数值格式化、点名产品筛选、最近完整比较上下文、确定性销售简报路由及
  Demo/covered/verified 解释已实现。
- AI 对话当前本地工作树已进一步实现字段级多轮上下文（任务、比较组、目标国、scope、
  功率、日期、产品与国家资料主题）、查询参数 evidence contract、点名产品评分/简报、
  工具卡查询摘要，以及失败后显式原样/编辑重试；空契约、错误工具或错误参数失败关闭，
  附件内容不参与契约推导。Demo 销售简报会从已校验结构化结果直接提取机会分、首要风险
  和第一行动；详情页刚完成的产品查询也会立即同步到对话链接。该上下文仅限当前页面会话，
  不是长期记忆。
- 本轮质量门通过：`pnpm lint`、`pnpm typecheck`、46 个文件 / 910 条 Vitest、
  `pnpm build`；默认 Playwright 桌面/移动端 71 passed / 7 skipped，最终 Markdown
  桌面/Pixel 7 聚焦回归另有 2 passed。这些是工程回归结果，不是用户效果 KPI。
- 上述 AI 对话、证据门、详情链路、公开产品隔离和 Markdown 渲染曾包含在历史提交
  `a77631bcdefbf5066dfc1b25082fd9c5f12afc2a`；它不是当前公开 release，公开站点运行状态
  仅以前述带时间的生产 readback 为准。

## 代码与数据基线

### 2026-09-29 DeepSeek provider-switch baseline / 模型切换基线

The local candidate now selects official DeepSeek V4.1 Flash (`deepseek-flash`),
using adapter contract v2 with thinking disabled and streaming usage enabled.
The initial retained v25 observation completed the original 18 cases and 36 provider
calls with complete usage (81,712 tokens). Tool selection, argument accuracy,
evidence expectations, response disposition and safety fail-closed each scored
100%; response grounding anchors and locale each scored 77.78%. Seven cases
failed at least one response contract. The command correctly exited 1. No case,
threshold or scorer was changed, and no Qwen archive was relabeled. A separate
9-token connectivity probe is not part of that benchmark. This is local
candidate evidence, not a new production deployment or a passed AI quality gate.

本地候选已切换到 DeepSeek V4.1 Flash，关闭思考并开启流式 usage。原 18 例完整运行，
36 次调用共 81,712 tokens；工具、参数、证据预期、回答/拒绝判定和安全失败关闭均为
100%，结论要点锚点与语言一致性均为 77.78%，共有 7 例至少一项回答合同不通过。
命令如实退出 1；不修改 case、门槛或评分器，不重标 Qwen 历史结果。另有 9-token
连通性探测，不计入基准。本记录不代表生产已切换，也不代表 AI 质量门槛通过。

### 2026-09-29 response and provider repair / 回答与工具调用修复

The local candidate now uses system prompt v7 and DeepSeek adapter contract v4.
Public explanations are concise and localized; fit and recorded availability
are separate, evidence-bound conclusions. Tool observations omit only undefined
optional object fields at the JSON boundary. DeepSeek required-tool requests
name one permitted tool and require one call per step; the production loop then
collects the remaining evidence. No case, scorer, threshold, dependency or database
schema changed. Historical failures remain unchanged in the eval archive.

Run `aca383eb-e4e8-4f5f-8cfe-d107d3d04008` passed all 18 cases and all score
thresholds with 37 calls / 97,352 tokens; independent verification completed and
the command exited 0. This is local candidate evidence only. Screenshots, browser
and full-unit execution are represented by their current evidence artifacts, not
by this model result. Production release/readback remains the earlier recorded
release until an actual deployment and readback occur.

本地候选使用提示词 v7、DeepSeek 适配合同 v4：简洁双语说明、适配与供应期双轴结论，
JSON 边界仅省略对象中的可选 undefined 字段。DeepSeek 每步只请求一个必要工具并明确
只调用一次，再由原生产循环继续取证；不改 case、评分器、门槛、依赖或数据库 schema。
上述完整评估 18/18 通过、37 次调用、97,352 tokens，经独立验证后退出 0；历史失败保留。
截图、浏览器和全量单测分别以当前证据 artifact 为准；本地模型通过不等于生产已部署。

| 项目 | 当前代码状态 | 语义 |
| --- | --- | --- |
| 国家目录 | 178 个 ISO3 目录记录 | 目录覆盖不等于存在法规数值 |
| 地图几何 | 177 个唯一 ISO3 feature | 用于国家选择，不用于法律边界判断；仅 MUS 无几何 |
| 法规验收 | `docs/ACCEPTANCE.md` #1–#264；发布选择闭包 97 jurisdictions / 28 regulations / 651 limits / 203 sources | #166–#264 已由 release `20260812031745` 发布并完成生产聚焦验收。ECU/PHL/PAK/SAU/ARE/ISR/ZAF/RWA 与 LKA 保留已闭合路径；LKA 自 2018-07-13 保留道路 5+5 与工程 24 条、agriculture no-data；UGA 为 effective metadata-only；KHM/LAO/MMR/MNG 及其余未闭合 scope 失败关闭。DZA/ETH/NGA 旧 numeric 图已治理；#263–#264 取代 CAN/USA partial 非道路边界；MLT/CHN、ARE 日期与 CAN/USA ties-to-even raw 查询翻译均已生产读回。 |
| 市场观测 | 24 条签核 fixture | CHN/USA/DEU/BRA 的 2022/2023 观测与确定性同比 |
| 真实产品/认证 | 0 条获准公开 fixture | 产品适配的本地示例仍为显式虚构 Demo |
| Demo 产品 | 2 个稳定配置 | 只验证 `fit/not_fit/unknown` 和证据链 |

`data_coverage_status=covered` 表示该国家的已核验来源边界已经通过治理发布；它不保证
卡车、客车、工程和农业四个 scope 都有可发布法规。具体事实仍由带 `asOf`、scope 和
功率的 Repository 查询及其 `no_data` 结果决定。

## 三种运行模式

| 模式 | 命令 / 地址 | 数据 | AI | 用途 |
| --- | --- | --- | --- | --- |
| 零配置作品 Demo | `pnpm demo` | 进程内 PGlite + 虚构 fixture | 确定性离线模拟，仍调用只读工具 | 招聘方本地快速体验 |
| 标准开发 | `pnpm dev` | PostgreSQL / Supabase | 可选服务端 OpenAI-compatible | 开发、真实治理发布与检索 |
| 公开只读演示 | <https://jamesky.site> | PostgreSQL 中已发布事实 + 明确 Demo | 服务端模型，只读工具 | 作品展示，不是业务生产系统 |

零配置 Demo 只能在 `NODE_ENV=development`、`DATABASE_MODE=pglite-demo` 下启用；
生产误设 `PORTFOLIO_DEMO_MODE=true` 会失败关闭。

## 已完成能力

- MapLibre 世界地图、键盘/触控入口和可分享国家 URL；
- 状态/有效期/核验时间分离的法规查询；
- 本地查询从 `asOf` 派生 `statusAtAsOf` 并保留 `recordStatus`，历史有效期可返回
  当前已 superseded 的法规；该能力尚不构成完整 `knownAsOf` 双时态；
- 确定性 product-fit、市场可比性和机会评分；
- 七个 Zod 只读 AI 工具、流式证据门和结构化来源卡片；
- 受限图片/PDF/文本附件入口：图片仅在视觉模型可用时开放并验证结构/像素，PDF 按流
  在页数、字符、15 秒与资源清理边界内提取；发送后释放原始 base64，纯附件概述与
  法规/认证/产品/市场事实意图分门，上传内容不能绕过事实证据门；
- 文档导入、分块、元数据过滤和混合检索开发台；
- Draft → Reviewed → Published、职责分离、CSV Preview、软归档和审计；
- 治理数据 v4 十表快照（含 `market_metrics`）、SHA/引用闭包 dry-run 与 serializable
  单事务恢复；PGlite 已覆盖
  六位微秒、原始 JSONB 高精度数、目标自然键/外部副作用写前检查、advisory maintenance
  lock、物理精确恢复和中途失败整单回滚（ADR-132）；
- CI、桌面/移动 Playwright、密钥扫描、依赖审计和部署代理边界。

## 尚未完成 / 不应过度声明

- 没有获准公开的真实产品主数据和认证，因此不能证明真实商业可售性；
- 公开演示不是正式法规服务或业务生产环境；
- 尚无外部法规专家独立签字和真实销售用户试点 KPI；
- 三角色 subagent 模拟不能替代上述签字、试点或 KPI；
- 正式 embedding 基准、私有对象存储、监控、生产快照恢复与 Migration
  回滚演练仍待业务生产化；
- source-only 覆盖不能描述成该国已经存在完整排放限值。

## 更新规则

以下变化必须同步更新本文件，而不是继续修改 README 中的固定数字：

1. 国家目录或地图 feature 数变化；
2. `ACCEPTANCE.md` 签核行数变化；
3. 真实产品/认证首次发布；
4. 公开站点运行模式或 URL 变化；
5. 公开演示升级为业务试点或生产系统。
