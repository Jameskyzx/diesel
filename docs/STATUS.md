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
  observedAt=`2026-10-05T19:36+00:00`；`/api/health` readbackAt=`2026-10-05T19:36+00:00` returned `status=ok`,
  `version=30daa51d34bab95e6d729982a19194a4af5352ba`；服务器当前 release 链接解析为
  `/opt/diesel/releases/30daa51d34bab95e6d729982a19194a4af5352ba`。因此当前公开 release ID
  与 Git commit 均为该完整 SHA；同时观测的本地 `master` 和只读
  `git ls-remote origin master` 也均为该 SHA。这是带时间的只读快照，CI 中的
  `portfolio:verify` 只校验已记录对象和等值关系，不联网声称其仍然最新。该记录的证据类型固定为
  `historical-operator-record-only`；它不是外部签名的生产读回，也不能由本地校验器证明来源真实性。
  本轮仅验收用户选择的三项：发布/恢复终态、新版本真实中英对话、严格数据库 TLS。
  原发布仍记录 exit 75；正式前滚验收成功后独立确认 `COMMITTED:PUBLISH_FINALIZED`。
  新进程首次真实聊天、随后六个中英示例、TLS 正负对照和 provider canary 均通过；临时转发已撤销。
  [本轮完整记录](evidence/operations/production-closeout-latest.json) 保留所有失败，不宣称长期稳定性或所有工程维护已完成。
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
    "artifactByteLength": 191060,
    "artifactPath": "docs/evidence/playwright-e2e-latest.json",
    "artifactSha256": "612f056c78c43264c72885f0167bc1402882cea838f0f1b1530e2d47e84e4a6e",
    "baseHeadCommit": "31e52afe8443f371668dc83d28897beb496fc2cc",
    "evaluatedCommit": "31e52afe8443f371668dc83d28897beb496fc2cc",
    "observedAt": "2026-10-06T10:14:58.991Z",
    "runId": "257d6e4b-9a55-4647-82ee-85ea9d33431a",
    "runs": [
      {
        "collected": 453,
        "failed": 0,
        "flaky": 0,
        "passed": 387,
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
      "digest": "39f28519d13af870b93d90eafc4bc5d692024b26f3e7013ac0ce4f7ca0b7aa0b",
      "fileCount": 360
    },
    "version": "diesel-playwright-evidence-v1",
    "worktreeState": "clean"
  },
  "currentPublicRelease": {
    "commit": "30daa51d34bab95e6d729982a19194a4af5352ba",
    "evidenceKind": "historical-operator-record-only",
    "id": "30daa51d34bab95e6d729982a19194a4af5352ba",
    "observedAt": "2026-10-05T19:36+00:00",
    "releasePath": "/opt/diesel/releases/30daa51d34bab95e6d729982a19194a4af5352ba"
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
    "archivePath": "docs/evals/archive/ai-live-eval-20261006T095352525Z-cfad3c13-bf0e-40dc-bb7e-cc5030e121a4.json",
    "attemptCount": 37,
    "complete": true,
    "completedCount": 37,
    "evaluatedAt": "2026-10-06T09:53:52.525Z",
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
    "runId": "cfad3c13-bf0e-40dc-bb7e-cc5030e121a4",
    "sourceFingerprint": {
      "algorithm": "sha256",
      "digest": "6504379f27122ad96a937b473b1048595ab7b6f092834ca980ab73ea323b824e",
      "fileCount": 307,
      "status": "captured"
    },
    "suiteVersion": "sales-chat-live-v26",
    "suiteCaseCount": 18,
    "terminationReason": "completed",
    "thresholdsPassed": true,
    "tokenUsageComplete": true,
    "totalTokens": 101348
  },
  "lastDocumentedRelease": {
    "commit": "38541ac8201e260934fe9eeaab571d2c8a4262ee",
    "id": "20260814144537"
  },
  "publicRuntime": {
    "evidenceKind": "historical-operator-record-only",
    "readbackAt": "2026-10-05T19:36+00:00",
    "status": "ok",
    "version": "30daa51d34bab95e6d729982a19194a4af5352ba"
  },
  "qualitySnapshot": {
    "artifactPath": "docs/evidence/vitest-execution-latest.json",
    "version": "diesel-vitest-execution-evidence-v2"
  },
  "repositoryHead": {
    "local": "30daa51d34bab95e6d729982a19194a4af5352ba",
    "observedAt": "2026-10-05T19:36+00:00",
    "remote": "30daa51d34bab95e6d729982a19194a4af5352ba"
  }
}
```
<!-- portfolio-verification:end -->

- 当前唯一 Vitest 执行证据指针：artifact `docs/evidence/vitest-execution-latest.json`；format `diesel-vitest-execution-evidence-v2`。
  动态测试计数、执行时间、HEAD 与 source fingerprint 仅从该 artifact 派生；`STATUS.md` 不复制这些值。

- 当前 live-eval 证据台账：`passed`；evaluatedAt `2026-10-06T09:53:52.525Z`；run ID `cfad3c13-bf0e-40dc-bb7e-cc5030e121a4`；`18/18 cases`；`complete=true`；`terminationReason=completed`；`37 provider attempts`；`37 completed provider calls`；`37 model steps`；
  `101348 known tokens`；`tokenUsageComplete=true`；`thresholdsPassed=true`；`runError=none`；`suiteVersion=sales-chat-live-v26`；`reportVersion=sales-chat-live-v26`；
  archive `docs/evals/archive/ai-live-eval-20261006T095352525Z-cfad3c13-bf0e-40dc-bb7e-cc5030e121a4.json`；source fingerprint `6504379f27122ad96a937b473b1048595ab7b6f092834ca980ab73ea323b824e` across `307` files。

- 当前浏览器证据快照：format `diesel-playwright-evidence-v1`，run ID `257d6e4b-9a55-4647-82ee-85ea9d33431a`，artifact SHA-256 `612f056c78c43264c72885f0167bc1402882cea838f0f1b1530e2d47e84e4a6e`；
  observedAt `2026-10-06T10:14:58.991Z`，clean worktree / base HEAD `31e52afe8443f371668dc83d28897beb496fc2cc`；
  `public` = `387 passed / 66 skipped / 0 failed / 0 flaky / 453 collected`；
  `demo` = `68 passed / 0 skipped / 0 failed / 0 flaky / 68 collected`；
  `fde` = `2 passed / 2 skipped / 0 failed / 0 flaky / 4 collected`；
  `production-csp` = `2 passed / 0 skipped / 0 failed / 0 flaky / 2 collected`；
  聚合为 459 passed / 68 skipped / 0 failed / 0 flaky / 527 collected。artifact 为 191060 bytes；
  browser source fingerprint 为 360 files / `39f28519d13af870b93d90eafc4bc5d692024b26f3e7013ac0ce4f7ca0b7aa0b`。
  因运行发生在 clean worktree，`evaluatedCommit=31e52afe8443f371668dc83d28897beb496fc2cc`；它证明该本地候选上的浏览器验收，
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
