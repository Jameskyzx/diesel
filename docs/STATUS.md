# Project status / 当前项目状态

This is the only current release/evidence index. Historical implementation notes are retained in
[the frozen journal](STATUS-HISTORY-2026-10-04.md); their “pending” labels are historical, not current work items.
本文件只保留当前状态、验收入口和未解决事项。历史过程不再混入当前清单。

## Release status / 发布状态

- 2026-10-04 的失败尝试留档：PR #55 / `cf86edca3a33e087d4e5b88b54171b7010f5bb41` 已合并，但部署失败并回滚。
  SSH 返回 255；原远端退出码未知，未完成治理快照和发布，不能称部署成功。
  失败候选为终态 `ROLLED_BACK:none`；只能用新的 CI-approved SHA 发布，禁止重用失败候选。
  [完整脱敏失败记录](evidence/operations/deployment-failure-2026-10-04.json)。
- 收尾代码包含独立 admission 连接池、真实示例端到端验收、付费 AI 定时巡检，以及健康快照 reader 复用。
  代码存在不等于线上验收通过；生产执行结果另见[本轮操作记录](evidence/operations/production-closeout-latest.json)，
  完整本地证据以本文唯一台账为准。
- 生产聊天故障已复现为数据库入口超过 3 秒，而非模型报错。只读对照诊断支持冷连接/类型发现开销这一原因；
  修复必须通过新版本真实请求验收，不能以单次健康 200 或单元测试替代。
- 2026-10-04 用户批准仅将聊天小时准入等待从 3 秒改为 8 秒；配额、并发门、数据库超时与失败关闭不变。
  这是等待时间合同的调整，不是数据库提速；新版本的冷连接首次请求仍须真实验收，旧版三次 503 不被覆盖。
- VPS 已仅清理 14 个非活动版本的可重建缓存，全部备份与运行文件保留。
  [清理记录](evidence/operations/cache-cleanup-2026-10-04.json)。

以下为带时间的历史生产观测，不声明仓库当前 HEAD 等于线上版本：

- 公开只读演示：<https://diesel.jamesky.site>。只读核验中，
  observedAt=`2026-10-06T21:45+00:00`；`/api/health` readbackAt=`2026-10-06T21:45+00:00` returned `status=ok`,
  `version=0f51a9dfd14f874d3dfa5713d172fb3462d48874`；服务器当前 release 链接解析为
  `/opt/diesel/releases/0f51a9dfd14f874d3dfa5713d172fb3462d48874`。因此当前公开 release ID
  与 Git commit 均为该完整 SHA；同时观测的本地 `master` 和只读
  `git ls-remote origin master` 也均为该 SHA。这是带时间的只读快照，CI 中的
  `portfolio:verify` 只校验已记录对象和等值关系，不联网声称其仍然最新。该记录的证据类型固定为
  `historical-operator-record-only`；它不是外部签名的生产读回，也不能由本地校验器证明来源真实性。
  2026-10-05 的上一轮仅验收用户选择的三项：发布/恢复终态、新版本真实中英对话、严格数据库 TLS。
  该轮原发布仍记录 exit 75；正式前滚验收成功后独立确认 `COMMITTED:PUBLISH_FINALIZED`。
  该轮新进程首次真实聊天、随后六个中英示例、TLS 正负对照和 provider canary 均通过；临时转发已撤销。
  [上一轮完整记录](evidence/operations/production-closeout-latest.json) 保留所有失败，不宣称长期稳定性或所有工程维护已完成。
  2026-10-06 的新候选 `361dabc48216103fd7f37cd02be18499c3138935` 已通过 master CI，但在隔离构建中因 VPS 缺少 pnpm shim 失败，
  原始 exit 70 与 `ROLLED_BACK:none` 保留；`2026-10-06T13:00:47.733Z` 独立健康读回仍为上述旧版 `30daa51`。
  现有官方 Corepack 的 pnpm 入口已补齐，构建用户的固定版本 registry 查询通过；这不是新版本上线声明。
  [失败及主机修复记录](evidence/operations/deployment-failure-and-pnpm-recovery-2026-10-06.json)。后续只能以新的 CI-approved SHA 走完整发布，不重用失败候选。
  同日后续候选 `5f1d6a73719dcc3179b9b24279bf4959f0a3a58f` 的 master CI 也全部通过，但必需 Next 包的官方 registry 下载超时，
  原始 exit 70 与第二个 `ROLLED_BACK:none` 保留；`2026-10-06T15:04:41.132Z` 独立健康读回仍为旧版 `30daa51`。
  [第二次失败与有界传输探针](evidence/operations/deployment-network-failure-2026-10-06.json)。该失败时的小文件探针不证明完整构建成功。
  后续 `0f51a9dfd14f874d3dfa5713d172fb3462d48874` 的精确 master CI 10/10 通过，完整发布于 `2026-10-06T21:34:17.537Z` 以 exit 0 完成；
  独立严格账本与 committed-host 校验确认 `COMMITTED:PUBLISH_FINALIZED`。本次包含既有 97 国闭包的受控重新发布，未增加国家、schema 或真实产品。
  新备份与真实恢复演练、loopback/public 中英页面及 SSE、7/7 provider-inclusive canary、零重试的中英桌面/移动端 6/6 真实示例均通过。
  实际浏览器另确认国家替换保留原日期/场景/功率、刷新恢复、语言持久化、市场单位/观测期/相关来源，以及首页 `97/28/651/203/0` 与 `178` 目录分离。
  原 SSH observer 的 exit 255 原样保留；已有 durable worker 未重启，独立终态读回与验收才证明发布成功，不宣称首次冷请求或长期稳定性。
  实测余量约 4.35 GiB，低于下一次完整发布的 5 GiB 起始门槛；所有备份、失败版本与归档均保留，未使用临时数据库转发，`jamesky-api` 原 PID 未变。
  一次额外模型解释出现摘要与后文不一致，结构化事实卡片正确；该解释质量问题未在本次部署中修复，不宣称模型文本永不出错。
  [本次上线与独立验收完整记录](evidence/operations/production-ux-release-2026-10-06.json) 保留上述通过、失败与残余边界。
  2026-10-09 的 PR #77 已合并，候选 `bf9af3de97e2e3be827dc55ec34f0416924d5c0a` 的精确 master CI 为 10/10 通过，
  但完整发布在治理备份/恢复验证阶段中断，durable worker 以 exit 70 结束；不能声明保存分析、独立比较页及证据审阅改进已上线。
  数据与主机已自动回滚，独立严格账本和回滚校验均通过，终态为 `ROLLED_BACK:HOST_ROLLBACK_COMPLETED`。
  `2026-10-09T18:45:40.586Z` 公网 readiness 及服务器 current 仍为 `0f51a9dfd14f874d3dfa5713d172fb3462d48874`；
  回滚后内网/公网中英页面、Demo 产品边界及确定性 SSE 验收均通过，不代表本次重新验证了模型生成路径。
  当前只读连接对照正常，现有日志未记录具体中断分支；没有证据将此次失败确定归因于网络或内存。
  失败候选、日志与备份保留；只能在阻塞处理后用新的 CI-approved SHA 发布。
  [本次部署失败及回滚验收记录](evidence/operations/deployment-maintenance-failure-2026-10-09.json)。
  2026-10-10 的修复 PR #78 已合并；新候选 `1a74dd5be5564a58ef4e59fb5856ecb84c66eebd` 的精确 master CI 为 10/10 通过，
  不可变 staging 成功，完整发布已于 `2026-10-10T04:50:10.966Z` 单次启动，继续使用 VPS 原数据库链路，没有建立转发。
  截至 `2026-10-10T05:03:42Z`，观察连接自 `04:56:59Z` 后未更新，公网 HTTPS 握手与未登录 SSH 欢迎信息均超时；
  原因及 worker 当前状态均未确认，尚未取得完成回执或独立终态验收，不得声明上线成功或已经回滚。
  该观察时点未重启主机、未重复部署、未删除备份。
  随后在京东云控制台核对同一 IP；用户明确授权后执行一次重启，`2026-10-10T05:24:20.711Z` SSH 读回确认新 boot，
  Nginx/PM2 active，`diesel-demo` 与 `jamesky-api` 均 online、重启计数为 0，服务器 current 仍为旧稳定版 `0f51a9d`。
  `05:25:23.213Z` 公网 readiness 返回 HTTP 200，数据库及两项 AI 准入探针均为 ok；这是旧版恢复检查，不是新版发布验收。
  新候选的严格账本为 `active:PENDING:none`，worker unit 已不存在且缺少完成回执；发布中断、尚待按协议收敛，未重复启动或伪造终态。
  随后版本化回滚预检及 `--abort-if-uncommitted` 均 exit 0；`2026-10-10T05:41:37.637Z` 独立严格账本确认 `terminal:ROLLED_BACK:none`。
  旧版恢复验收通过，`jamesky-api` PID 仍为 1033；中断构建未进入数据库发布，候选、日志与备份保留，不重用该 SHA。
  [本次发布观察中断记录](evidence/operations/deployment-observation-interruption-2026-10-10.json) 保留候选、任务 ID、CI 与连接诊断。
  随后 PR #79 / `6e8368abaacc998ea775bc71d43bf4efb8ca2d8c` 的精确 master CI 10/10 通过，限额构建成功，
  但数据库备份首个 worker 在有进度时触及 45 分钟上限，第二个 worker 以 exit 1 退出且旧诊断未保留具体错误。
  完整发布于 `2026-10-10T09:30:37.523Z` 以 exit 70 结束，没有进入数据库发布；独立严格账本为 `terminal:ROLLED_BACK:none`。
  `09:32:20.039Z` 旧版公网 readiness、回滚检查及内外网验收通过，`jamesky-api` PID 1033 未变。
  [备份失败与回滚记录](evidence/operations/deployment-snapshot-failure-2026-10-10.json) 保留真实失败；不能声明新版功能已上线，也不重用失败 SHA。
- 最后一个完整记录了发布步骤与独立读回的时间戳 release lineage 仍是
  release `20260814144537` / Git
  `38541ac8201e260934fe9eeaab571d2c8a4262ee`。它于 2026-08-14 完成仅代码的
  版本化发布，不执行数据库写入；当时的独立读回复核 `/api/health`、PM2 降权进程、
  PM2 systemd 复活链路、Nginx、首页、聊天页、代表国家页、地图 Demo 清理、公开产品
  API 及真实 AI SSE 均通过。该 lineage 是历史文档基准，不是当前公开运行版本。

## Public evidence boundary / 公开证据边界

- `ACCEPTANCE.md` #166–#264 已随 release `20260812031745` 发布；选择闭包为
  `97 jurisdictions / 28 regulations / 651 limits / 203 sources`。DZA/ETH/NGA 旧 numeric
  图已按合同治理，LIE/SGP/MLT 运行库图已补齐，AUS/PNG/CAN/USA/CHN/MLT 的数值或
  成员边界均通过生产聚焦验收。签核表中保留的“本地 accepted / 待部署”文字是发布前
  审计轨迹，由本状态快照统一 supersede。

| 项目 | 当前代码状态 | 边界 |
| --- | --- | --- |
| 国家目录 | 178 个 ISO3；177 个地图 feature | 目录/几何不代表数值法规覆盖 |
| 真实产品/认证 | 0 条获准公开 fixture | 不宣称真实商业可售性 |
| Demo 产品 | 2 个虚构配置 | 仅用于展示证据链 |
| 市场观测 | 24 条签核 fixture | CHN/USA/DEU/BRA 的 2022/2023 观测，不冒充实时市场 |

工具进度流式传输；最终模型文本缓冲到证据验证完成。公开 SSE 不包含 reasoning。
`covered` 表示发布了核验边界，不保证每个 scope 都有排放限值。

## Verification ledger / 验证台账

`pnpm portfolio:verify` 重算受控工件及源码指纹；旧成功记录不证明本地修改已通过。
`--release-evidence` 还要求证据在 HEAD、index 与 worktree 中字节一致。

<!-- portfolio-verification:start -->
```json
{
  "browserSnapshot": {
    "artifactByteLength": 201436,
    "artifactPath": "docs/evidence/playwright-e2e-latest.json",
    "artifactSha256": "0ad252e2839684221ce72cb559f244ef1ae553e886b03ee0f7ac7a4538f2b9d4",
    "baseHeadCommit": "86402aeae8a91413e4122b07d8685ef29b714ea1",
    "evaluatedCommit": "86402aeae8a91413e4122b07d8685ef29b714ea1",
    "observedAt": "2026-10-10T10:23:20.264Z",
    "runId": "9a747181-dedb-41ad-9b43-d2f32662609d",
    "runs": [
      {
        "collected": 483,
        "failed": 0,
        "flaky": 0,
        "passed": 417,
        "skipped": 66,
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
      "digest": "fa9fbde2ec109b76aff7d5f689ab703604954673c13411b3d5653dd94daa76c9",
      "fileCount": 376
    },
    "version": "diesel-playwright-evidence-v1",
    "worktreeState": "clean"
  },
  "currentPublicRelease": {
    "commit": "0f51a9dfd14f874d3dfa5713d172fb3462d48874",
    "evidenceKind": "historical-operator-record-only",
    "id": "0f51a9dfd14f874d3dfa5713d172fb3462d48874",
    "observedAt": "2026-10-06T21:45+00:00",
    "releasePath": "/opt/diesel/releases/0f51a9dfd14f874d3dfa5713d172fb3462d48874"
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
    "archivePath": "docs/evals/archive/ai-live-eval-20261010T100325769Z-ac60fdf0-92a4-4354-bbf6-1e8fd2e446d4.json",
    "attemptCount": 37,
    "complete": true,
    "completedCount": 37,
    "evaluatedAt": "2026-10-10T10:03:25.769Z",
    "expectedModelId": "server-openai-compatible/deepseek-flash",
    "expectedProviderProfile": {
      "adapter": "@ai-sdk/openai-compatible",
      "adapterContractVersion": 5,
      "enableThinking": false,
      "endpointSha256": "a34e2a4708ed1c61008a151688838dcf1c44d4e7f08054633e72ba7c0b16cfc1",
      "includeUsage": true
    },
    "latestOutcome": "passed",
    "latestSampleCount": 18,
    "modelStepCount": 37,
    "reportVersion": "sales-chat-live-v26",
    "runError": null,
    "runId": "ac60fdf0-92a4-4354-bbf6-1e8fd2e446d4",
    "sourceFingerprint": {
      "algorithm": "sha256",
      "digest": "9c1b583c74ec5ddbe7819d00a53e5cdc435b9e50ec11a3cf5651481bd07b2b34",
      "fileCount": 320,
      "status": "captured"
    },
    "suiteVersion": "sales-chat-live-v26",
    "suiteCaseCount": 18,
    "terminationReason": "completed",
    "thresholdsPassed": true,
    "tokenUsageComplete": true,
    "totalTokens": 101561
  },
  "lastDocumentedRelease": {
    "commit": "38541ac8201e260934fe9eeaab571d2c8a4262ee",
    "id": "20260814144537"
  },
  "publicRuntime": {
    "evidenceKind": "historical-operator-record-only",
    "readbackAt": "2026-10-06T21:45+00:00",
    "status": "ok",
    "version": "0f51a9dfd14f874d3dfa5713d172fb3462d48874"
  },
  "qualitySnapshot": {
    "artifactPath": "docs/evidence/vitest-execution-latest.json",
    "version": "diesel-vitest-execution-evidence-v2"
  },
  "repositoryHead": {
    "local": "0f51a9dfd14f874d3dfa5713d172fb3462d48874",
    "observedAt": "2026-10-06T21:45+00:00",
    "remote": "0f51a9dfd14f874d3dfa5713d172fb3462d48874"
  }
}
```
<!-- portfolio-verification:end -->

- 当前唯一 Vitest 执行证据指针：artifact `docs/evidence/vitest-execution-latest.json`；format `diesel-vitest-execution-evidence-v2`。
  动态测试计数、执行时间、HEAD 与 source fingerprint 仅从该 artifact 派生；`STATUS.md` 不复制这些值。

- 当前 live-eval 证据台账：`passed`；evaluatedAt `2026-10-10T10:03:25.769Z`；run ID `ac60fdf0-92a4-4354-bbf6-1e8fd2e446d4`；`18/18 cases`；`complete=true`；`terminationReason=completed`；`37 provider attempts`；`37 completed provider calls`；`37 model steps`；
  `101561 known tokens`；`tokenUsageComplete=true`；`thresholdsPassed=true`；`runError=none`；`suiteVersion=sales-chat-live-v26`；`reportVersion=sales-chat-live-v26`；
  archive `docs/evals/archive/ai-live-eval-20261010T100325769Z-ac60fdf0-92a4-4354-bbf6-1e8fd2e446d4.json`；source fingerprint `9c1b583c74ec5ddbe7819d00a53e5cdc435b9e50ec11a3cf5651481bd07b2b34` across `320` files。

- 当前浏览器证据快照：format `diesel-playwright-evidence-v1`，run ID `9a747181-dedb-41ad-9b43-d2f32662609d`，artifact SHA-256 `0ad252e2839684221ce72cb559f244ef1ae553e886b03ee0f7ac7a4538f2b9d4`；
  observedAt `2026-10-10T10:23:20.264Z`，clean worktree / base HEAD `86402aeae8a91413e4122b07d8685ef29b714ea1`；
  `public` = `417 passed / 66 skipped / 0 failed / 0 flaky / 483 collected`；
  `demo` = `68 passed / 0 skipped / 0 failed / 0 flaky / 68 collected`；
  `fde` = `2 passed / 2 skipped / 0 failed / 0 flaky / 4 collected`；
  `production-csp` = `2 passed / 0 skipped / 0 failed / 0 flaky / 2 collected`；
  聚合为 489 passed / 68 skipped / 0 failed / 0 flaky / 557 collected。artifact 为 201436 bytes；
  browser source fingerprint 为 376 files / `fa9fbde2ec109b76aff7d5f689ab703604954673c13411b3d5653dd94daa76c9`。
  因运行发生在 clean worktree，`evaluatedCommit=86402aeae8a91413e4122b07d8685ef29b714ea1`；它证明该本地候选上的浏览器验收，
  不冒充远端 CI、安全审计、生产部署或现实用户成效证据。

## Acceptance and operations / 验收与运维

- 工程维护的实现合同见 [ENGINEERING_MAINTENANCE.md](ENGINEERING_MAINTENANCE.md)；
  CI、发布、容量与真实测量的落地状态见[维护操作台账](evidence/operations/engineering-maintenance-latest.json)。
  代码实现、实验结果与生产验收分别记录，不能互相替代。
- 本地：lint、typecheck、完整 Vitest、build、离线 AI eval、四套浏览器测试及 portfolio verifier。
- 线上：健康/就绪版本绑定、语言切换、关键页面、真实中英六个示例和 provider-inclusive canary；不得用 mock 测试代替。
- `pnpm test:e2e:live` 需要显式付费验收开关和精确 release SHA；零重试、失败保存报告，不放宽证据门槛。
- 生产 canary 每 6 小时运行一次真实 AI 示例并保存脱敏失败记录；GitHub schedule 是尽力执行，不构成 SLO/on-call。
- 部署和恢复只执行 [DEPLOYMENT.md](DEPLOYMENT.md) 的版本化入口；不删除失败账本、备份或跳过 CI。
- 2026-09-01 的只读 GitHub API 读回确认 `master` 只要求唯一 `Required CI gate`，开启 strict 与管理员约束；发布前必须重新读回。

## External gates / 不能由代码替代的外部门槛

| 门槛 | 状态 | 完成所需材料 |
| --- | --- | --- |
| 真实产品与认证 | 未获批准 | 产品所有者授权、规格版本与可追溯认证来源 |
| 法规专家验收 | 未完成 | 外部专家对日期、scope、数值和来源的独立签核 |
| 真实销售试点 | 未开展 | 真实参与者、基线、任务记录、反馈及效果测量 |
| FDE 历史公开归档 | 禁止发布 | LICENSE/NOTICE、资产权利与 copyleft 再分发复核，见 [历史审查](DEVELOPMENT_HISTORY.md) |
| 私有知识库业务化 | 未配置 | 授权文档、私有存储策略、代表性检索/embedding 基准 |

本站是公开只读作品演示，不是正式法规服务或已验证的业务生产系统。密钥事项按用户要求不在本轮处理。
