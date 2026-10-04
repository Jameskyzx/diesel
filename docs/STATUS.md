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
- VPS 已仅清理 14 个非活动版本的可重建缓存，全部备份与运行文件保留。
  [清理记录](evidence/operations/cache-cleanup-2026-10-04.json)。

以下为带时间的历史生产观测，不声明仓库当前 HEAD 等于线上版本：

- 公开只读演示：<https://diesel.jamesky.site>。只读核验中，
  observedAt=`2026-10-03T22:02+00:00`；`/api/health` readbackAt=`2026-10-03T22:02+00:00` returned `status=ok`,
  `version=e5c3249f067692a483d4133a313bd5883b166642`；服务器当前 release 链接解析为
  `/opt/diesel/releases/e5c3249f067692a483d4133a313bd5883b166642`。因此当前公开 release ID
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
    "artifactByteLength": 184816,
    "artifactPath": "docs/evidence/playwright-e2e-latest.json",
    "artifactSha256": "8f68d786f2d96848d8abad09587d101ee6f416df2282bfc501091a364660fab6",
    "baseHeadCommit": "5f0f5e2b06718f8869753d5056726e658e5b6510",
    "evaluatedCommit": "5f0f5e2b06718f8869753d5056726e658e5b6510",
    "observedAt": "2026-10-04T08:50:30.443Z",
    "runId": "994fea43-48b9-445e-949f-4526f8d664bd",
    "runs": [
      {
        "collected": 435,
        "failed": 0,
        "flaky": 0,
        "passed": 370,
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
      "digest": "f2520d69a9a3614d658d1b8ca931a40a9fa28d1b016718848d521ba606de034d",
      "fileCount": 354
    },
    "version": "diesel-playwright-evidence-v1",
    "worktreeState": "clean"
  },
  "currentPublicRelease": {
    "commit": "e5c3249f067692a483d4133a313bd5883b166642",
    "evidenceKind": "historical-operator-record-only",
    "id": "e5c3249f067692a483d4133a313bd5883b166642",
    "observedAt": "2026-10-03T22:02+00:00",
    "releasePath": "/opt/diesel/releases/e5c3249f067692a483d4133a313bd5883b166642"
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
    "archivePath": "docs/evals/archive/ai-live-eval-20261004T085231228Z-b76ab06d-aeb3-4202-bce1-da4881c005cf.json",
    "attemptCount": 37,
    "complete": false,
    "completedCount": 36,
    "evaluatedAt": "2026-10-04T08:52:31.228Z",
    "expectedModelId": "server-openai-compatible/deepseek-flash",
    "expectedProviderProfile": {
      "adapter": "@ai-sdk/openai-compatible",
      "adapterContractVersion": 5,
      "enableThinking": false,
      "endpointSha256": "a34e2a4708ed1c61008a151688838dcf1c44d4e7f08054633e72ba7c0b16cfc1",
      "includeUsage": true
    },
    "latestOutcome": "failed",
    "latestSampleCount": 18,
    "modelStepCount": 36,
    "reportVersion": "sales-chat-live-v25",
    "runError": null,
    "runId": "b76ab06d-aeb3-4202-bce1-da4881c005cf",
    "sourceFingerprint": {
      "algorithm": "sha256",
      "digest": "c48aec31788ea0398e5d901b5a75d9764937c3f7a29818bc5fc872d8850633e8",
      "fileCount": 302,
      "status": "captured"
    },
    "suiteVersion": "sales-chat-live-v25",
    "suiteCaseCount": 18,
    "terminationReason": "case_error",
    "thresholdsPassed": false,
    "tokenUsageComplete": false,
    "totalTokens": 99959
  },
  "lastDocumentedRelease": {
    "commit": "38541ac8201e260934fe9eeaab571d2c8a4262ee",
    "id": "20260814144537"
  },
  "publicRuntime": {
    "evidenceKind": "historical-operator-record-only",
    "readbackAt": "2026-10-03T22:02+00:00",
    "status": "ok",
    "version": "e5c3249f067692a483d4133a313bd5883b166642"
  },
  "qualitySnapshot": {
    "artifactPath": "docs/evidence/vitest-execution-latest.json",
    "version": "diesel-vitest-execution-evidence-v2"
  },
  "repositoryHead": {
    "local": "e5c3249f067692a483d4133a313bd5883b166642",
    "observedAt": "2026-10-03T22:02+00:00",
    "remote": "e5c3249f067692a483d4133a313bd5883b166642"
  }
}
```
<!-- portfolio-verification:end -->

- 当前唯一 Vitest 执行证据指针：artifact `docs/evidence/vitest-execution-latest.json`；format `diesel-vitest-execution-evidence-v2`。
  动态测试计数、执行时间、HEAD 与 source fingerprint 仅从该 artifact 派生；`STATUS.md` 不复制这些值。

- 当前 live-eval 证据台账：`failed`；evaluatedAt `2026-10-04T08:52:31.228Z`；run ID `b76ab06d-aeb3-4202-bce1-da4881c005cf`；`18/18 cases`；`complete=false`；`terminationReason=case_error`；`37 provider attempts`；`36 completed provider calls`；`36 model steps`；
  `99959 known tokens`；`tokenUsageComplete=false`；`thresholdsPassed=false`；`runError=none`；`suiteVersion=sales-chat-live-v25`；`reportVersion=sales-chat-live-v25`；
  archive `docs/evals/archive/ai-live-eval-20261004T085231228Z-b76ab06d-aeb3-4202-bce1-da4881c005cf.json`；source fingerprint `c48aec31788ea0398e5d901b5a75d9764937c3f7a29818bc5fc872d8850633e8` across `302` files。

- 当前浏览器证据快照：format `diesel-playwright-evidence-v1`，run ID `994fea43-48b9-445e-949f-4526f8d664bd`，artifact SHA-256 `8f68d786f2d96848d8abad09587d101ee6f416df2282bfc501091a364660fab6`；
  observedAt `2026-10-04T08:50:30.443Z`，clean worktree / base HEAD `5f0f5e2b06718f8869753d5056726e658e5b6510`；
  `public` = `370 passed / 65 skipped / 0 failed / 0 flaky / 435 collected`；
  `demo` = `68 passed / 0 skipped / 0 failed / 0 flaky / 68 collected`；
  `fde` = `2 passed / 2 skipped / 0 failed / 0 flaky / 4 collected`；
  `production-csp` = `2 passed / 0 skipped / 0 failed / 0 flaky / 2 collected`；
  聚合为 442 passed / 67 skipped / 0 failed / 0 flaky / 509 collected。artifact 为 184816 bytes；
  browser source fingerprint 为 354 files / `f2520d69a9a3614d658d1b8ca931a40a9fa28d1b016718848d521ba606de034d`。
  因运行发生在 clean worktree，`evaluatedCommit=5f0f5e2b06718f8869753d5056726e658e5b6510`；它证明该本地候选上的浏览器验收，
  不冒充远端 CI、安全审计、生产部署或现实用户成效证据。

## Acceptance and operations / 验收与运维

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
