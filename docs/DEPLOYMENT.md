# 部署与运维基线（M2）

本文件是部署 runbook，不是当前 release 的事实来源。红线以 `TASKS.md` §13.6 为准；本文件
把红线展开为可执行矩阵和检查单。

> 当前代码、运行库与历史测量可能处于不同时间点。求职作品的最新可验证状态以
> [STATUS.md](STATUS.md) 为准；本文件保留带日期的历史性能数据，不用新统计覆盖旧测量。

## 1. 环境配置矩阵

| 维度 | 标准开发 | 零配置作品 Demo | CI | 公开只读作品站 / 业务生产 |
| --- | --- | --- | --- | --- |
| 启动入口 | `pnpm dev` | `pnpm demo` | workflow / Playwright custom server | <https://jamesky.site> / 受控部署流水线 |
| `DATABASE_MODE` | `postgres` | `pglite-demo`；仅 development、显式启用 | `pglite-demo`（e2e job） | `postgres`；两类部署均禁止 `pglite-demo` |
| 数据库 | Supabase/PostgreSQL 开发库 | 进程内 PGlite + 真实 Migration | 进程内 PGlite + 真实 Migration | PostgreSQL；Migration 走受控步骤，应用不自动改 schema（ARCH §14） |
| Seed | 只允许显式 Demo + Natural Earth 目录；真实数据经 Draft → Reviewed → Published | 自动运行显式虚构 Demo Seed | 自动运行 Demo Seed | 不运行 Demo Seed；记录按事实/来源逐条分类 |
| AI provider | `openai-compatible` | 确定性离线模型；只选择已有只读工具 | 不调用外部模型 | 公开站仅处理已公开数据；业务生产仍需 ADR-017/023 批准 |
| AI 模型 | `AI_MODEL` 为文本模型；图片入口另配 `AI_MULTIMODAL_MODEL` | 不读取外部模型配置 | 测试替身 | 两个模型必须位于服务端；视觉模型须同时支持图片输入与 Function Calling（ADR-125） |
| 密钥 | `.env.local`（gitignore） | 无，且不读取数据库或模型凭据 | GitHub Actions 隔离；gitleaks 扫描 | 只进平台 Secret Manager；不进仓库、日志或任务表 |
| 身份 | `ADMIN_ROLE_BINDINGS_JSON` + 本地 Header 注入（仅受控环境，ADR-036） | 不暴露管理写入作为演示流程 | Playwright 注入测试身份 | 公开站反向代理阻断 `/admin`；业务管理端必须使用可信身份代理（ADR-016） |
| 文档存储 | `.data/knowledge`（仅开发） | 临时 `.data/portfolio-demo-knowledge` | `e2e-knowledge` | 业务生产须用私有对象存储；ADR-031 替身不得用于生产 |
| AI 小时准入 | 默认 global/client 10000/30，开发内存后端 | 内存后端 | 内存后端 | 示例显式 300/30；PostgreSQL 原子共享双桶，生产禁止内存后端（见 §6） |
| AI 日准入单位 | dev 默认高阈值内存桶 | 高阈值内存桶；确定性直答不预留 | 可注入内存桶 | 必须显式配置 global/client；PostgreSQL 原子双桶（见 §6） |
| 核验新鲜度 | 默认 90 天；超过阈值只告警 | 固定 3650 天，避免虚构 fixture 干扰流程演示 | `1`（确定性触发 stale 测试） | 按来源分级 SLA 仍待 ADR-019 签核 |
| 错误脱敏 | 公开 API 只返回 schema 校验的通用错误；日志不保留上游原文（ADR-041） | 同左 | 同左 | 同左 |

服务端环境枚举以代码 schema 为准：`AI_PROVIDER` 只接受
`openai-compatible`；`DATABASE_MODE` 只接受 `postgres` / `pglite-demo`，且生产只允许
前者；`AI_CHAT_RATE_LIMIT_BACKEND` 只接受 `memory` / `postgres`（生产强制后者）；
`AI_ENABLE_THINKING`、`AI_INCLUDE_USAGE` 与 `PORTFOLIO_DEMO_MODE` 只接受布尔值；
`AI_CHAT_RATE_LIMIT_GLOBAL_PER_HOUR` 可选、空值或缺省时为 10000；它与
`AI_CHAT_RATE_LIMIT_PER_HOUR` 都必须是 1–10000 的整数，运行时还要求小时 client 不大于
小时 global。两个
`AI_CHAT_ADMISSION_*_PROVIDER_CALL_UNITS_PER_DAY` 的 env 标量必须是 5–2,000,000,000 的安全整数
且为 5 的倍数，否则应用环境初始化失败；日准入运行时配置同样要求 client 不大于 global。生产缺少任一日准入值
或跨字段关系错误时，受支持的 host orchestrator 会在任何本次 state mutation 前拒绝 candidate，
小时准入配置或 backend 不合法也执行同样的候选拒绝；`/api/health/ready` 会用独立
`aiChatAdmission` / `aiChatRateLimit` check 返回 503，model-bound Chat 保留独立失败关闭；
`COUNTRY_STALE_AFTER_DAYS` 为
1–3650 的整数。`APP_VERSION`、`DATABASE_URL`、`KNOWLEDGE_STORAGE_ROOT`、
`AI_BASE_URL`、`AI_MODEL`、`AI_MULTIMODAL_MODEL`、`AI_API_KEY`、
`AI_COST_PROFILE_JSON`、三项
`OPPORTUNITY_SCORE_*_WEIGHT` 与 `ADMIN_ROLE_BINDINGS_JSON` 的用途和非敏感示例见
`.env.example`；生产值只进入受控服务端环境。

`AI_INCLUDE_USAGE=true` 只让 OpenAI-compatible streaming 请求携带标准
`stream_options.include_usage`；它不启用 prompt caching，也不表示供应商必然返回缓存
明细。该开关默认关闭，只有在目标供应商已验证兼容时才开启；供应商拒绝此字段时请求
按普通模型错误失败关闭，不自动删除字段重试。

DeepSeek V4.1 Flash uses the official model ID `deepseek-flash` at
`https://api.deepseek.com` (also accepts the `/v1` base path). Set
`AI_ENABLE_THINKING=false` and `AI_INCLUDE_USAGE=true`; the existing image route
can use the same model via `AI_MULTIMODAL_MODEL=deepseek-flash`. Only these exact
official endpoints use adapter contract v4: `thinking: { type: "disabled" }`
and a named choice for the first currently required tool. The production loop
then narrows to remaining evidence tools on subsequent steps (still at most five
steps). This avoids the observed malformed second parallel-call arguments;
invalid arguments are never repaired or retried. A request-local system rule
requires exactly one call, preserving requested parameters instead of repeating
the same tool to simulate parallelism. Historical v2/v3 reports remain unchanged.
An omitted thinking flag also disables thinking; explicit `true` fails before a
provider request because DeepSeek thinking mode rejects the required tool choice
used by this application's tool loop. Other endpoints retain the v1
`enable_thinking` contract. Keys stay server-side and public SSE never includes
reasoning. Changing providers requires a new live report, not relabeling an old
one. Sources: [model API](https://api-docs.deepseek.com/zh-cn/) and
[thinking/tool compatibility](https://api-docs.deepseek.com/guides/thinking_mode/)
and [named tool choice](https://api-docs.deepseek.com/api/create-chat-completion/).

DeepSeek V4.1 Flash 的官方模型 ID 是 `deepseek-flash`，地址为
`https://api.deepseek.com`（亦接受 `/v1`）。设置 `AI_ENABLE_THINKING=false`、
`AI_INCLUDE_USAGE=true`；已有图片入口可将 `AI_MULTIMODAL_MODEL` 同样设为
`deepseek-flash`。仅上述官方地址使用 v4 适配合同的 `thinking.type=disabled`，并在每步
指定首个仍需取证的工具，后续步骤继续动态收窄，最多五步；避免已观测到的第二个并行
调用参数 JSON 损坏。请求级系统规则明确本步只调用一次、保留用户参数，不重复调用同一
工具模拟并行，不猜修参数、不额外重试。历史 v2/v3 报告保持不变；
未设置时也关闭思考，显式开启则在出网前拒绝，因为当前必选工具流程不兼容其思考模式。
其他地址保留 v1 的 `enable_thinking`。密钥只留服务端，公开 SSE 不含 reasoning；
切换供应商必须重新评估，不改写历史报告。

`AI_CHAT_RATE_LIMIT_GLOBAL_PER_HOUR` 与 `AI_CHAT_RATE_LIMIT_PER_HOUR` 配置按 epoch
对齐的一小时固定窗口。为保留旧环境兼容性，全局值可省略并缺省为 10000；公开生产示例仍应
显式写出 global/client `300/30` 与 `AI_CHAT_RATE_LIMIT_BACKEND=postgres`，避免把兼容性上限
误当成容量选择。PostgreSQL 在共享数据库的同一事务内固定先预留 global、再预留 client：global
已满时不访问 client 桶，client 已满时回滚 global 暂增；条件 UPSERT 保证拒绝不提交
`limit + 1` 或只更新 `updated_at`。请求一旦准入，后续解析、配置、审计或 provider 失败也不
退款。原始 client identity 不落库，只保留 SHA-256 摘要。该配置与原子合同已在本地接线，当前
公开版本是否包含它只能由 `STATUS.md` 与发布后读回证明。

`AI_CHAT_ADMISSION_GLOBAL_PROVIDER_CALL_UNITS_PER_DAY` 和
`AI_CHAT_ADMISSION_CLIENT_PROVIDER_CALL_UNITS_PER_DAY` 配置
`estimated-provider-call-v1` 应用侧 UTC 日窗。公开 route 固定 `maxRetries=0`、最多五个 provider
step，故每个 provider-ready 请求在模型能力、附件和消息校验完成后、审计/provider 前一次预留
5 单位；确定性 direct response、模型配置失败和附件校验失败不预留。
这两个数字不是 token、成本或 provider 账户限额。应先按可承受的最坏应用调用次数设置，再在
provider 控制台另设独立 spend ceiling；不能用它们替代供应商预算告警。

`AI_COST_PROFILE_JSON` 默认不配置，只用于服务端 strict runtime log 的估算成本，不会进入
provider 请求或 live-eval JSON。它必须是无额外字段的 JSON object，并包含精确的完整
`modelId`、`version`、不晚于事件 UTC 日期的 `asOf`、不早于 `asOf` 的包含端点
`validThrough`、`pricingMode` 和
`ratesMicroUsdPerMillionTokens`。`flat` 模式只接受整数 `input/output` 费率；
`cache-tiered` 只接受整数 `noCache/cacheRead/cacheWrite/output` 费率。单位均为每百万 token
的 micro-USD。私有合同费率只放 Secret Manager，不提交仓库；日志只记录 profile 版本、日期、
状态与派生估算，不记录费率。模型不精确匹配时优先报告 `model_mismatch`；模型匹配但事件
UTC 日期已经晚于 `validThrough` 时报告 `stale_profile`。两者以及 usage 不完整、缓存明细部分
缺失或结果溢出时估算为 `null`。OpenAI-compatible 三项基础 token 缺失、与 SDK 不一致、存在未完成 retry
attempt、请求 abort 或响应租约超时同样视为 usage 不完整。这是 completed provider calls 的
工程估算，不是供应商账单。

### 1.1 零配置作品 Demo

```bash
pnpm install
pnpm demo
```

该入口只绑定 loopback，启动时强制 `development + pglite-demo`，从真实 Migration
建库并使用显式虚构 fixture。离线模型只负责选择现有只读工具；工具输出、引用、
结构化卡片、审计和证据失败关闭仍走正式应用链路。它不代表 PostgreSQL、外部模型、
生产身份或真实产品认证已经完成，面试演示步骤见 [DEMO.md](DEMO.md)。

### 1.2 本地 FDE 实施 Demo 与 synthetic canary

`pnpm demo:fde` 在零配置 Demo 之上开放隔离的 Editor / Reviewer / Admin 实施向导；
只允许 loopback、development、PGlite 和显式 FDE Demo 标志组合。身份由本地专用 cookie
映射后在 server 内注入，不能复用到生产认证；公开 Nginx `/admin` 404 边界不变。

部署前后可运行无外部监控依赖的 canary：

```bash
CANARY_BASE_URL=https://jamesky.site pnpm ops:canary
CANARY_BASE_URL=https://jamesky.site CANARY_EXPECTED_VERSION=<40-char-release-sha> pnpm ops:canary
CANARY_BASE_URL=https://jamesky.site CANARY_CHECK_AI=true pnpm ops:canary
```

显式设置 `CANARY_BASE_URL` 时，默认从 `CANARY_STATUS_PATH`（缺省
`docs/STATUS.md`）的 portfolio machine block 读取 `publicRuntime.version`；该值必须是完整
40 位小写 Git SHA。`CANARY_EXPECTED_VERSION` 可为受控发布显式覆盖该来源，但空值、短值或
大写 SHA 均失败关闭，不能用于停用版本绑定。liveness 与
readiness 除通用合同外还必须返回完全相同的 version；健康时间戳必须落在实际请求开始至
响应接收的窗口内（两端仅允许 5 秒时钟偏差），并精确返回
`Cache-Control: private, no-store, max-age=0` 与 `Pragma: no-cache`。陈旧、过度超前或可缓存
的 200 响应全部失败关闭。报告顶层记录该 expectedVersion。
未显式设置外部 base URL 的本地默认 probe 不强制 repository release SHA。

无付费检查覆盖 liveness、readiness、CHN 决策摘要、公开产品列表和确定性
`chat-direct-sse`；后者使用不调用模型供应商的能力说明直答路径，持续验证公开 chat route、
request ID、SSE header 与闭合 UI-message v1 正文。产品列表必须恰好包含
`DEMO-ENG-100`、`DEMO-ENG-200`，两条产品及其来源都标为 Demo，且真实/分类错配产品数为
0。这是当前作品站“零获批真实产品”边界，不是永久的通用产品目录合同；未来只有在产品
证据获得批准并同步修改 canary、publication manifest 与发布验收后才能改变。真实 provider
的 `chat-provider-sse` 是独立的显式付费选项，不控制上述确定性 chat probe。
所有检查都要求可追踪的 request ID；JSON 会按公开 Zod 合同解析，CHN probe 还会核对
国家、scope、功率和日期，并把服务计算的 stale 状态视为失败。AI probe 会完整读取最多
1 MB 的 UI-message v1 SSE，逐 event 复用 AI SDK schema，要求
start/text/`finishReason=stop`/`[DONE]` 闭合；`error`、`abort`、reasoning part、未知
event、内容过滤、长度截断、空流或截断流全部失败关闭。输出只含路径、状态、耗时、
错误码和 request ID。初始化阶段失败也会以稳定 stage 和 `INITIALIZATION_ERROR` 原子写入
脱敏报告，不记录异常正文、凭据或响应体。上述语义以 `synthetic-canary-v3` 写入报告；旧版本结果不能
解释为已验证 SSE 正文或 finish reason。

`.github/workflows/production-canary.yml` 在合入默认分支后以 GitHub schedule 尽力每 6 小时
运行一次上述无付费检查，并显式设置 `CANARY_STATUS_PATH=docs/STATUS.md`。失败 job 与保留
14 天的脱敏 JSON artifact 是当前告警信号；artifact 缺失本身也会令 workflow 失败。
`workflow_dispatch` 才能显式打开付费 AI probe。GitHub schedule 可能延迟或停用，因此这只是
轻量外部 canary，不代表已建立 SLO、on-call 或独立监控供应商。故障预期与恢复命令见
[INCIDENT_DRILL.md](INCIDENT_DRILL.md)。

## 2. 分支保护与合并门（仓库设置）

CI 工作流（`.github/workflows/ci.yml`）把 quality、独立并行的 Linux deployment-script contracts、PostgreSQL migration smoke、
默认公开流程、零配置 Demo 与失败优先 FDE 三套 Playwright、真实 GitHub-hosted Linux release
handoff、gitleaks 与 dependency audit 汇总到唯一
merge-blocking context：`Required CI gate`。分支保护只要求该汇总检查，避免新增或加强的
上游 job 未同步加入保护规则。

`quality` 运行 `pnpm test:coverage:app`，只从 coverage job 排除
`tests/deploy-scripts.test.ts`、`tests/host-activation-ledger.test.ts`、
`tests/release-publication-controller.test.ts` 与
`tests/host-release-orchestrator.test.ts`；独立 `deploy-contracts` 在完整 Git history 的
Ubuntu runner 上运行 `pnpm test:deploy:contracts`。两项 job 并行：`quality` 的硬超时为
30 分钟，`deploy-contracts` 为 45 分钟（ADR-268；实际配置以工作流为准），但
`Required CI gate` 对二者分别执行
`success` 判定，因此拆分只缩短/稳定关键路径，不减少测试闭包。完整的 `pnpm test` 与
`pnpm test:coverage` 本地命令保持不变。

回滚测试的 `stat` 替身将 mode、link count 和 size 合并为一次原生读取，保留 GNU → BSD
回退；每次调用重新读取，不缓存路径元数据。真实文件变更、硬链接、悬空符号链接、缺失路径、
所有权/权限故障注入及外部祖先模拟均由直接回归测试覆盖。该优化只减少测试夹具的子进程开销，
不修改生产部署脚本、测试选择、断言、并发或超时，也不代表已验证远端 runner 耗时。

**平台限制（已于 2026-07-30 解除）**：仓库已更名为 `Jameskyzx/diesel`
并公开。2026-09-01 的只读外部观测确认 `master` 保护仍为唯一
`Required CI gate` + strict，管理员同样受限，禁止 force-push / deletion；当前 check 的
`app_id=null`，不能描述为已绑定 GitHub Actions app。远端旧 master workflow 虽总体 success
却没有该 gate job，因此不构成新版发布授权。单人作品未要求 PR 评审。仓库设置不是代码内的
持续保证，发布前必须由 `release:authorize` 重新读回。如需重建：

```bash
gh api -X PUT repos/Jameskyzx/diesel/branches/master/protection \
  -H "Accept: application/vnd.github+json" \
  -F 'required_status_checks[strict]=true' \
  -f 'required_status_checks[contexts][]=Required CI gate' \
  -F enforce_admins=true \
  -F required_pull_request_reviews=null \
  -F restrictions=null \
  -F allow_force_pushes=false \
  -F allow_deletions=false
```

（`required_pull_request_reviews` 与 `restrictions` 必须显式提供，可为
null；`-F` 发送类型化值，`-f` 发送字符串，括号键必须加引号以免被 shell
当作 glob。）

或在 GitHub 网页：Settings → Branches → Add classic branch protection rule：
分支 `master`；勾选 Require status checks to pass before merging（Strict，
只选择 `Required CI gate`）；勾选 Include administrators；勾选 Do not allow force
pushes / deletions。单人作品仓库可不要求 PR review。

PostgreSQL concurrency smoke row-set assertions compare `Array.from(result)`
with the expected rows. postgres.js returns an Array subclass (`Result`) with
driver metadata; its prototype is not a database fact. Cardinality, row order,
field types/values, extra fields and microsecond timestamp differences remain
strictly checked. The initial 2026-09-29 release PR run exposed this assertion
mismatch; a local mock pass is not a substitute for a successful real PostgreSQL
CI rerun.
Microsecond fixture parameters are bound as text before PostgreSQL casts them
to `timestamptz`; inferring a timestamp parameter would invoke the driver's
millisecond-only JavaScript Date serializer. Expected precision is not reduced.

PostgreSQL 并发 smoke 将驱动的 `Result` 行集转成普通数组后严格比较，排除驱动原型和
元数据差异；行数、顺序、字段类型/值、额外字段及微秒时间差仍严格校验。2026-09-29
首次发布 PR 运行暴露了该断言问题；本地替身通过不能替代真实 PostgreSQL CI 重跑。
微秒 fixture 参数先绑定为 text，再由 PostgreSQL 转为 timestamptz，避免驱动按时间戳
参数推断时经过 JavaScript Date 而丢失微秒；不降低预期精度。

The evidence tool resolver also supports pnpm/action-setup's
`node_modules/.bin/pnpm` shell-shim layout. It never executes that shim: it
selects the adjacent package's JS entrypoint and retains the exact package name,
version, declared-bin and bounded runtime-version checks. A broken first PATH
candidate is still fatal. Two full-repository screenshot fingerprint tests have
an explicit 30-second disk/coverage budget; their assertions are unchanged.

证据工具定位兼容 CI 的 pnpm shell 包装入口，但不执行包装脚本；只解析相邻 pnpm 包的
JS 入口，继续严格核对包名、固定版本、声明入口和有界版本读回。首个 PATH 候选损坏仍
直接失败。两项全仓库截图指纹扫描明确使用 30 秒测试预算，不改变任何内容断言。

Linux process inventory accepts PGID zero only for unrelated rows, such as
kernel threads. Both sentinels must still belong to the positive guardian PGID;
negative/malformed IDs, duplicate PIDs and missing sentinels still fail closed.
Linux 进程列表允许无关行（如内核线程）的 PGID 为零；两个 sentinel 仍必须属于正数
guardian PGID，负数/畸形 ID、重复 PID 与 sentinel 缺失继续失败关闭。

The chat SSE integration suite initializes its real PGlite database in a
bounded 30-second setup hook. Cold WASM startup, migrations and deterministic
seed loading are not charged to the request assertion's unchanged five-second
deadline. Native query-constraint SQL and all rejection assertions remain real.
Chat SSE 集成测试以独立、最多 30 秒的准备 hook 初始化真实 PGlite；WASM 冷启动、migration
与确定性 seed 不再挤占请求断言原有的 5 秒预算。原生查询约束 SQL 与拒绝断言均保留。

## 3. GitHub 原生密钥扫描

CI 的 gitleaks job 覆盖历史扫描。原生 Secret scanning 与 push protection
已于 2026-07-30 随仓库公开启用（Settings → Code security and analysis，
公开仓库免费）；如需重建：

```bash
gh api -X PATCH repos/Jameskyzx/diesel \
  -f 'security_and_analysis[secret_scanning][status]=enabled' \
  -f 'security_and_analysis[secret_scanning_push_protection][status]=enabled'
```

## 4. 公开发布前检查单

下列检查单面向真实业务试点。公开求职作品站最后于 2026-08-20 读回为以只读、管理路由
阻断和逐条数据分类的受限方式在线；当前状态以 `STATUS.md` 的时间戳为准。这不等于业务
生产门已经关闭。

- [x] CI 质量门、Playwright、Linux release handoff、gitleaks 密钥扫描、依赖审计已接线；
      Linux handoff 合入默认分支后的首个远端 run 仍待观察
- [x] `/api/chat` 小时准入已在本地升级为共享 global + client 双桶；固定 global → client
      原子顺序、无 `limit + 1` 拒绝写入和准入后不退款均有回归，生产示例为 300/30；required CI
      已接入五个独立 backend session 的真实 PostgreSQL 竞争 smoke，当前改动仍待远端执行回执与
      VPS 发布（ADR-264）
- [x] PostgreSQL 限流桶回收已从请求计数事务拆出且仅承担 retention：每进程 single-flight、最短 60 秒、
      数据库时钟 + 10 分钟 grace、稳定顺序、500 行批次及 `SKIP LOCKED`；回收错误不改变
      已完成的请求判定（ADR-262）
- [x] `/api/chat` model-bound 路径的应用侧 UTC 日准入双桶已接线；发布环境仍须在 Secret/
      Config Manager 显式设置 global/client provider-call units，并保留 provider 账户预算
- [x] HTTPS 主站对精确 `/api/chat` 设置 10 MiB、关闭请求体缓冲并承接应用 9 MiB
      流式门，其他路由保留较小默认上限；代理以 `$remote_addr` 覆盖
      客户端 `X-Forwarded-For`；IP/备用 HTTP 主机只 301 到规范 HTTPS 域名，不接收
      明文附件；生产配额由 PostgreSQL 在实例间原子共享。应用 admission 先于共享限流
      数据库调用，限流检查与事务分别有应用、锁、语句和 idle-in-transaction deadline；
      HTTP 先超时或取消时，lease 保留到底层数据库 Promise 实际 settle；`DATABASE_URL`
      禁止用 timeout/options 查询参数覆盖应用上限，并拒绝 decoded URL 组件中的 C0/DEL
      控制字符，防止 PostgreSQL startup-message 参数注入（ADR-155）
- [x] 精确 `/api/preferences/locale` 使用 HTTP/1.1 流式转发并关闭 request buffering，
      Nginx client-body idle timeout 与应用绝对 reader deadline 均为 30 秒；这使应用能从
      body 首字节开始执行 4 KiB/超时合同并返回结构化 413/408。该 exact location 不继承
      Chat 10 MiB 上限或连接限流，catch-all 仍保留 request buffering（ADR-208）
- [x] 对话附件数量、解码后字节、媒体类型/结构/像素、PDF 页数、15 秒解析 deadline
      与 30,000/40,000 增量字符预算；图片按需切换服务端视觉模型，纯附件意图与事实
      工具门分离，提取内容保持未核验信任边界；客户端取消会贯穿 body reader、附件资源
      清理与 provider。声明或实读超限会启动 body cancel 并立即返回 413；HTTP 也可立即
      返回 408 或结束超时流，但未完成的 body/PDF/provider
      stream 清理仍保留 admission lease 直至实际 settle，防止断连请求在后台无限叠加
      （ADR-125/156/158）
- [x] API JSON/multipart 请求体在解析前按实际流字节限制；低报
      `Content-Length` 返回结构化 413，不能进入 Zod/服务/Repository；非 chat 写入
      统一使用 30 秒绝对接收期限并传播客户端取消，慢流或断连取消 reader 后返回
      408 `REQUEST_TIMEOUT`；JSON 写入只接受 `application/json` 或 `application/*+json`
- [x] 站点与 README 求职作品免责声明；业务记录逐条标注 Demo / 已核验来源，
      且明确要求复核原始来源、范围和有效期
- [x] 2026-09-01 最后观测的 `master` 分支保护与合并门（§2）+ GitHub 原生 Secret
      scanning（§3）；当前仓库设置待发布前复核
- [ ] 生产身份代理接入：剥离客户端身份 Header、注入已认证邮箱；`/admin`
      不暴露公网（ADR-016/036）
- [x] 治理数据 v4 十表快照（含 `market_metrics`）：只读 repeatable-read 导出、六位
      微秒与原始 `jsonb::text`、
      SHA-256/严格结构 dry-run、serializable 物理精确恢复与 PGlite 故障回滚演练
- [ ] 生产数据库：责任人确认、生产快照恢复演练、Migration 回滚演练、数据纠错流程
- [ ] 正式 AI 模型、区域、预算与保留策略批准（ADR-017/023）；真实法规文档
      与内部产品资料在批准前不发送给模型
- [ ] 正式 Embedding 与检索基准（ADR-018）；生产私有对象存储替换本地存储
- [ ] 来源许可与法规专家核验完成前，数据不标记 `verified`、不用于销售承诺
- [ ] 监控与告警（健康检查、来源 freshness、审计日志导出）
- [ ] 性能与可访问性复核（bundle、地图加载、查询计划）
- [ ] 依赖公告处置（README「已知依赖风险」中的 high 级工具链公告随上游修复）

### 4.1 待应用 Migration `0007`–`0010` 预检

`0007`–`0010` 会为已有表创建唯一索引或立即校验 CHECK。应用到任何非空数据库前，
先在目标环境只读执行以下查询；每个查询都必须返回 0 行。若有结果，先由数据 owner
确认应保留的实体和修订路径，不得为了让 Migration 通过而静默删除、改标或合并事实。

```sql
-- 0007：同 scope 的市场观测自然键重复。
select country_iso3, metric_code, application_scope, period_start, period_end,
       data_source_id, count(*) as duplicate_count
from market_metrics
where application_scope is not null
group by country_iso3, metric_code, application_scope, period_start, period_end,
         data_source_id
having count(*) > 1;

-- 0007：global scope（NULL）的市场观测自然键重复。
select country_iso3, metric_code, period_start, period_end, data_source_id,
       count(*) as duplicate_count
from market_metrics
where application_scope is null
group by country_iso3, metric_code, period_start, period_end, data_source_id
having count(*) > 1;

-- 0008：国家型辖区必须有 country_iso3，区域/国际辖区必须没有。
select id, code, type, country_iso3
from jurisdictions
where not (
  (type = 'country' and country_iso3 is not null)
  or (type <> 'country' and country_iso3 is null)
);

-- 0009：国家覆盖词表及 Demo 双向分类。
select iso3, data_coverage_status, is_demo
from countries
where data_coverage_status not in ('none', 'demo', 'planned', 'no_data', 'covered')
   or is_demo <> (data_coverage_status = 'demo');

-- 0010：来源类型与 Demo 标志双向分类。
select id, source_type, is_demo
from data_sources
where is_demo <> (source_type = 'demo');
```

通过预检后仍需先完成备份与恢复演练，再按顺序应用 Migration；应用后重新运行这些
查询、`pnpm db:check` 和目标库验收查询。公开作品库已经应用至 `0010`；新增
Migration 必须先通过 CI 的空库 pgvector smoke 与上一版本脏数据 upgrade smoke，生产
是否已应用以 `drizzle.__drizzle_migrations` 读回为准，不能沿用本文历史版本号推断。

### 4.1.1 Migration `0011` / `0012` 前的非法产品精确归档

`0011` 会在存在未归档且 `power_max_kw <= power_min_kw` 的产品时原子停止。已归档记录
作为审计历史保留原始规格；数据库 CHECK 只允许这类历史记录例外，所有活动产品仍必须
满足严格的 `power_max_kw > power_min_kw`。当前已知运营修复
只能归档 dry-run 精确确认的 8 条未签核、非 Demo、未归档产品及其活动认证；不得改写
功率、来源或规格，也不得归档来源。必须在同一受控发布会话按以下顺序执行：

```bash
cd "${release_dir}"
backup_path="/opt/diesel/backups/${release_id}/pre-0011.dump"
manifest_path="/opt/diesel/backups/${release_id}/invalid-products.json"
database_environment_path="/opt/diesel/backups/${release_id}/env.production.local.pre-switch"
root_system_path="/usr/sbin:/usr/bin:/sbin:/bin"
node_binary="/opt/node-v22.22.3-linux-x64/bin/node"
export PATH="${root_system_path}"
for runtime_directory in \
  /opt /opt/node-v22.22.3-linux-x64 \
  /opt/node-v22.22.3-linux-x64/bin; do
  test -d "${runtime_directory}"
  test ! -L "${runtime_directory}"
  test "$(/usr/bin/realpath -e -- "${runtime_directory}")" = "${runtime_directory}"
  test "$(/usr/bin/stat -c '%u:%g:%a' -- "${runtime_directory}")" = "0:0:755"
done
test -f "${node_binary}"
test ! -L "${node_binary}"
test "$(/usr/bin/stat -c '%u:%g:%a:%h' -- "${node_binary}")" = "0:0:755:1"
test "$("${node_binary}" --version)" = "v22.22.3"
test -f "${database_environment_path}"
test ! -L "${database_environment_path}"
test "$(/usr/bin/stat -c '%U:%G:%a:%h' -- \
  "${database_environment_path}")" = "root:root:600:1"

run_database_command() {
  /usr/bin/env -i HOME=/root PATH="${root_system_path}" \
    NODE_ENV=production DATABASE_MODE=postgres release_id="${release_id}" \
    "${node_binary}" --import tsx \
    "${release_dir}/scripts/db/with-governance-maintenance-lock.ts" \
    --database-env-file="${database_environment_path}" -- \
    "${node_binary}" "$@"
}

run_production_readback() {
  /usr/bin/env -i HOME=/root PATH="${root_system_path}" \
    NODE_ENV=production DATABASE_MODE=postgres release_id="${release_id}" \
    "${node_binary}" --import tsx \
    "${release_dir}/scripts/db/with-governance-maintenance-lock.ts" \
    --database-env-file="${database_environment_path}" -- \
    /usr/bin/env DIESEL_VERIFY_PRODUCTION=1 "${node_binary}" "$@"
}

run_database_command --conditions=react-server --import tsx \
  scripts/db/backup-postgres.ts --output="${backup_path}"
test "$(/usr/bin/stat -c '%a' "${backup_path}")" = "600"
test "$(/usr/bin/stat -c '%a' "${backup_path}.sha256")" = "600"
/usr/bin/pg_restore --list "${backup_path}" >/dev/null
/usr/bin/sha256sum --check "${backup_path}.sha256"

run_database_command --conditions=react-server --import tsx \
  scripts/db/archive-invalid-unpublished-products.ts \
  --output="${manifest_path}"
test "$(/usr/bin/stat -c '%a' "${manifest_path}")" = "600"
```

由数据负责人离线确认 manifest 中恰好 8 个 product ID、型号、原始 numeric、产品来源
和全部 certification/source；manifest SHA 不匹配、计数改变、任一实体进入公开批准清单
或出现 Demo 分类都必须停止。确认后在治理维护锁内执行一次：

```bash
run_database_command --conditions=react-server --import tsx \
  scripts/db/archive-invalid-unpublished-products.ts --apply \
  --manifest="${manifest_path}" \
  --actor-email="<operator>" \
  --reason="Archive eight unsigned invalid products confirmed by release dry-run"

run_database_command --conditions=react-server --import tsx \
  scripts/db/migrate.ts
run_production_readback --conditions=react-server --import tsx \
  scripts/db/verify-production-readback.ts
```

Apply 使用 serializable transaction，先归档认证再归档产品并逐实体追加治理审计；任何
affected ID 漂移或归档后仍有非法活动产品都会 rollback。最终读回必须同时证明 14 条
repository Migration、仅对已归档历史开放例外的严格活动产品功率 CHECK、活动成员
exclusion、共享限流表和零条活动非法产品。生产 journal 可额外保留 2026-08-03 已审计的
`products_power_check >=` 孤儿迁移，但 readback 必须同时精确匹配它的时间与 SHA256；
未知额外 migration、已知时间上的未知 hash 或任一 repository migration 缺失仍失败关闭。
读回入口在解析数据库连接前精确要求上述三项环境门；`db:verify-production` package script
不会隐式加载 `.env.local`，以免把开发库的成功误记为生产证据。

### 4.2 VPS 版本化发布与回滚

当前生产应用固定使用 Node 22、PM2 与 Nginx；PM2 可继续由 root 管理，但 ecosystem
必须把公开 Next.js 进程降权为无登录的 `diesel:diesel`，附件解析器不得以 root 运行。
controller、prepare、activation、governance 与 rollback 的生产 root 进程只使用
`PATH=/usr/sbin:/usr/bin:/sbin:/bin`。Node 固定通过
`/opt/node-v22.22.3-linux-x64/bin/node` 执行；root 管理 PM2 时固定执行该 Node 加
`/opt/node-v22.22.3-linux-x64/lib/node_modules/pm2/bin/pm2`，`bin/pm2` 只作为必须精确解析到
该 canonical 文件的受验 symlink。完整 application PATH 只进入非特权 builder/runtime/verifier
child，或作为 PM2/systemd 期望状态进行校验，不参与特权命令查找。
每次发布创建不可变的
`/opt/diesel/releases/<release-id>`，并通过 `/opt/diesel/current` 原子软链接切换。
不得把运行时 `.env.local`/`.env.production*`、数据库转储、`.git`、本地
`node_modules`、`.next`、`.data`、测试报告/附件或用户文件复制进 release。发布输入只取
当前 Git 提交中的受跟踪文件；工作站授权门会先拒绝任何 tracked/untracked 漂移及任意
assume-unchanged、skip-worktree 或非 normal index entry。开始前记录当前软链接
和 Nginx 配置备份路径；这些值是本次回滚凭据。

先在已通过完整门禁的工作站执行；`release_id` 是 clean `master` HEAD 的完整 commit SHA，不是秘密，
后续 VPS shell 必须复用同一个值。这样构建期 `APP_VERSION`、release 目录、STATUS 与外部
canary 都绑定同一版本。版本化授权器会以 GitHub REST 和 fresh `ls-remote` 读回
证明本地 HEAD、唯一 canonical origin、`origin/master` 与 GitHub `master` 都是该 SHA；同时
要求 branch protection 仍为 strict、管理员受限、禁止 force-push/deletion，且只要求
`Required CI gate`。它只接受 active 的固定 CI workflow，并在不按成功状态过滤的 exact-SHA
push runs 中选择唯一最新 `created_at`，再从该 run 当前 attempt 的 jobs 读取唯一成功 gate。
读取后会复查 run/attempt、远端 ref、本地 HEAD、工作区和授权器自身 blob，任何竞态、分页截断、
总体 workflow 成功但缺 gate、旧 attempt 成功或来源漂移都失败关闭。成功 JSON 是本次命令的
point-in-time readback，不是签名、attestation 或可跨提交复用的授权文件；当前 protection 的
`app_id=null` 也不应描述为已绑定 GitHub Actions app，gate 来源由本次 Actions run/job 读回独立证明。
发布调用不经过 pnpm lifecycle shell。runbook 只从目标 commit 导出最小的
`stage-release.sh` 入口，核对 committed/extracted/worktree blob 后执行 committed 副本；
不能直接运行可能被 skip-worktree/assume-unchanged 隐藏替换的 worktree 脚本。
bootstrap 在导出前还必须证明当前目录就是 physical repository root、分支精确为
`master`，并显式传播 `git status` / index readback 的非零退出码；空 stdout 不能把失败误判为
clean。
该 committed 入口先在任何完整 payload archive 或 SSH 前拒绝 commit 根的敏感/保留路径，
再使用从同一 commit 单独导出并按 blob 绑定的 committed manifest helper 预检 Git tree、生成完整
release archive 并在本地闭合 `inputDigest`。这些是无远端副作用的本地准备，不是发布
授权。同批导出的 committed `run-bounded-command.mjs` 只以清理过的本地 Node 22 运行，负责
远端阶段的绝对 deadline、分流有界捕获与进程组终止；每次使用前都会再次比较 committed blob。
本地 export 通过后，脚本紧邻首次 SSH 之前才从同一 commit 单独导出不依赖外部
Node package/module 的 verifier bundle 及其 Zod MIT 许可；独立比较 blob 后，在
`/usr/bin/env -i` 只传递工作站工具查找所需的 `PATH` / `HOME` 及授权、代理/TLS、SSH
凭据的明文 allowlist 内用 Node 22 直接执行。这同时排除 `BASH_ENV` / `ENV`、exported shell
functions、`SHELLOPTS` / `BASHOPTS` 和其他未列出的 startup injection。bundle 已内含 Zod，运行时不解析
工作区 `node_modules`；源码与生成物的逐字节一致性由测试锁定。package command 只是非权威的
开发便利入口，不能替代 runbook。授权 stdout 必须是 1–65,536 字节，并由同一
committed bundle 的 strict Zod schema 二次解析、核对 format/commit/origin/run/job URL 闭包；
解析后再次比较 committed/worktree blob。授权通过之前不得执行 SSH、rsync、远端
`mkdir` 或其他 host mutation，也不能把“进程提前 0 退出但没有授权 JSON”当成通过。
bundle 的 repository-scope Git 子进程只得到无凭据的最小环境，并用 command-scope 配置关闭
fsmonitor、hooksPath 和 external diff；`GH_TOKEN`、代理/TLS 与 SSH agent 只进入实际需要它们
的 `gh` 或 isolated remote readback。fresh `ls-remote` 在 repository 之外以已核对的
canonical URL 和固定 strict SSH command 执行，不读取 `.git/config` 来选择网络目标或
upload-pack。仓库本地配置仍是不受信输入；repository-scope Git 不从子进程环境继承授权凭据，
也不能改写 isolated remote readback 的目标。
最终 release 目录必须此前不存在；远端使用不带 `-p` 的 `mkdir` 原子创建并确认目录为空，
同名目录或任何残留内容都必须让发布立即失败，不能复用失败发布的目录。空目录通过检查后、
rsync 前必须确认 `diesel` 组存在，并把 release 根目录固定为 `root:diesel` 0750；传输后
这里只保证 candidate 根仍为 `root:diesel` 0750，子项由 root 控制并由 manifest 绑定 mode/
内容。后续 runtime preparer 才会在复制到隔离 build workspace 前规范化 immutable input 的
owner/group/read-only 边界，
由无生产密钥读取权限的 `diesel-build` 用户构建，再只把构建产物复制到新的 root-owned
inode 并恢复为
`root:diesel`。不能让构建用户获得 release 根目录写权限；pnpm 11 会在工作目录创建原子
临时文件，直接在 `root:diesel-build:750` 的 release 根目录运行会以 `EACCES` 失败。
运行用户 `diesel` 与构建用户必须是不同的非 root UID、使用不同的非 root 主 GID，且各自的
supplementary groups 不得包含对方主组；版本化 runtime 准备脚本会在创建 workspace 前按数字
UID/GID 失败关闭：

```bash
set +x
set +v
set -Eeuo pipefail
umask 077
IFS=$' \t\n'
bootstrap_git=(
  /usr/bin/env -i
  HOME=/nonexistent
  LANG=C
  LC_ALL=C
  PATH=/usr/bin:/bin
  GIT_CONFIG_GLOBAL=/dev/null
  GIT_CONFIG_NOSYSTEM=1
  GIT_NO_REPLACE_OBJECTS=1
  GIT_OPTIONAL_LOCKS=0
  GIT_TERMINAL_PROMPT=0
  NO_COLOR=1
  /usr/bin/git
  -c core.fsmonitor=false
  -c core.hooksPath=/dev/null
  -c diff.external=
)
assert_bootstrap_repo_state() {
  local branch_ref
  local index_entry
  local index_state
  local repo_root
  local status
  repo_root="$("${bootstrap_git[@]}" rev-parse --show-toplevel)" || return 1
  repo_root="$(CDPATH= cd -- "${repo_root}" && pwd -P)" || return 1
  test "$(pwd -P)" = "${repo_root}"
  branch_ref="$("${bootstrap_git[@]}" symbolic-ref --quiet HEAD)" || return 1
  test "${branch_ref}" = "refs/heads/master"
  status="$(
    "${bootstrap_git[@]}" status --porcelain=v1 \
      --untracked-files=all --ignore-submodules=none
  )" || return 1
  test -z "${status}"
  index_state="$("${bootstrap_git[@]}" -c core.quotePath=true ls-files -v)" || return 1
  while IFS= read -r index_entry; do
    test -z "${index_entry}" || test "${index_entry#H }" != "${index_entry}"
  done <<< "${index_state}"
}
assert_bootstrap_repo_state
release_id="$("${bootstrap_git[@]}" rev-parse --verify 'HEAD^{commit}')"
[[ "${release_id}" =~ ^[0-9a-f]{40}$ ]]
stage_script_path="scripts/deploy/stage-release.sh"
stage_script_blob="$(
  "${bootstrap_git[@]}" rev-parse --verify \
    "${release_id}:${stage_script_path}"
)"
[[ "${stage_script_blob}" =~ ^[0-9a-f]{40}$ ]]
test "$("${bootstrap_git[@]}" ls-tree "${release_id}" -- "${stage_script_path}")" = \
  "100755 blob ${stage_script_blob}"$'\t'"${stage_script_path}"
stage_tmp_dir=""
stage_tmp_dir_canonical=""
stage_tmp_dir_identity=""
stage_bootstrap_uid="$(/usr/bin/id -u)"
stage_tmp_identity() {
  local identity
  if identity="$(/usr/bin/stat -f '%u:%Lp:%d:%i' "$1" 2>/dev/null)"; then
    :
  else
    identity="$(/usr/bin/stat -c '%u:%a:%d:%i' -- "$1")"
  fi
  [[ "${identity}" =~ ^[0-9]+:700:[0-9]+:[0-9]+$ ]]
  printf '%s\n' "${identity}"
}
remove_stage_bootstrap() {
  local current_identity
  local current_path
  test -z "${stage_tmp_dir}" && return 0
  test -d "${stage_tmp_dir}"
  test ! -L "${stage_tmp_dir}"
  current_path="$(CDPATH= cd -- "${stage_tmp_dir}" && pwd -P)"
  current_identity="$(stage_tmp_identity "${stage_tmp_dir}")"
  test "${current_path}" = "${stage_tmp_dir}"
  test "${current_identity}" = "${stage_tmp_dir_identity}"
  test "${current_identity%%:*}" = "${stage_bootstrap_uid}"
  /bin/rm -rf -- "${stage_tmp_dir}"
  test ! -e "${stage_tmp_dir}"
  test ! -L "${stage_tmp_dir}"
  stage_tmp_dir=""
}
cleanup_stage_bootstrap_on_exit() {
  local status="$?"
  local cleanup_status
  trap - EXIT HUP INT TERM
  set +e
  remove_stage_bootstrap
  cleanup_status="$?"
  if [[ "${status}" -eq 0 && "${cleanup_status}" -ne 0 ]]; then
    status=70
  fi
  exit "${status}"
}
trap cleanup_stage_bootstrap_on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
stage_tmp_dir="$(/usr/bin/mktemp -d /tmp/diesel-stage-bootstrap.XXXXXXXX)"
stage_tmp_dir_canonical="$(CDPATH= cd -- "${stage_tmp_dir}" && pwd -P)"
stage_tmp_dir="${stage_tmp_dir_canonical}"
stage_tmp_dir_identity="$(stage_tmp_identity "${stage_tmp_dir}")"
test "${stage_tmp_dir_identity%%:*}" = "${stage_bootstrap_uid}"
stage_archive_path="${stage_tmp_dir}/stage-entry.tar"
committed_stage_script="${stage_tmp_dir}/${stage_script_path}"
"${bootstrap_git[@]}" archive --format=tar --output="${stage_archive_path}" \
  "${release_id}" -- "${stage_script_path}"
/usr/bin/env -i LANG=C LC_ALL=C PATH=/usr/bin:/bin \
  /usr/bin/tar -xf "${stage_archive_path}" -C "${stage_tmp_dir}"
test -f "${committed_stage_script}"
test ! -L "${committed_stage_script}"
test -x "${committed_stage_script}"
test "$(
  "${bootstrap_git[@]}" hash-object --no-filters "${committed_stage_script}"
)" = "${stage_script_blob}"
test "$(
  "${bootstrap_git[@]}" hash-object --no-filters "${stage_script_path}"
)" = "${stage_script_blob}"
assert_bootstrap_repo_state
test "$("${bootstrap_git[@]}" rev-parse --verify 'HEAD^{commit}')" = "${release_id}"
stage_env=(
  /usr/bin/env -i
  "HOME=${HOME:-/nonexistent}"
  "PATH=${PATH:-/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin}"
  "GH_CONFIG_DIR=${GH_CONFIG_DIR:-}"
  "GH_TOKEN=${GH_TOKEN:-}"
  "GITHUB_TOKEN=${GITHUB_TOKEN:-}"
  "HTTPS_PROXY=${HTTPS_PROXY:-}"
  "HTTP_PROXY=${HTTP_PROXY:-}"
  "NO_PROXY=${NO_PROXY:-}"
  "SSL_CERT_DIR=${SSL_CERT_DIR:-}"
  "SSL_CERT_FILE=${SSL_CERT_FILE:-}"
  "SSH_AUTH_SOCK=${SSH_AUTH_SOCK:-}"
  "XDG_CONFIG_HOME=${XDG_CONFIG_HOME:-}"
)
stage_receipt="$(
  "${stage_env[@]}" \
    /bin/bash --noprofile --norc "${committed_stage_script}" "${release_id}"
)"
test -n "${stage_receipt}"
test "${#stage_receipt}" -le 70000
[[ "${stage_receipt}" != *$'\n'* ]]
remove_stage_bootstrap
trap - EXIT
printf '%s\n' "${stage_receipt}"
```

`stage-release.sh` 只负责把经本地闭合并在首次远端动作前完成授权的 commit 安全暂存为新
candidate，不构建、迁移数据库、
链接运行时环境、切换 `current`、修改 Nginx/PM2、发布治理数据或激活 release。它在本地
用完整 commit archive 和 archive 内的 committed `release-input-manifest.mjs` 创建、重验
`diesel-release-input-v2`；manifest 以 bytewise path 顺序绑定每个普通 tracked file 的
Git mode、SHA-256、大小、完整 commit SHA 与整体 `inputDigest`。该 helper 在完整 archive 前
拒绝所有根名以 `.env` 开头的输入，唯一例外是路径精确等于普通文件 `.env.example`；
`.env.example/...` 目录树同样拒绝。固定拒绝根还包括 `.data`、`.git`、`.next`、
`.next-e2e`、`.pnpm-store`、`backups`、`coverage`、`node_modules`、`out`、
`playwright-report`、`test-results`、`tmp` 这些固定根路径；还拒绝 release manifest/
build/deploy marker 保留名与所有 symlink/submodule/非普通 Git entry。工作区与未跟踪字节不是
payload 来源，`.git` 不进入 commit archive。其他数据库 dump、附件或用户文件仍不得被跟踪到
release commit；固定 root-name admission 不是通用内容分类器。

远端任何 candidate 写入前，脚本先用固定 SSH target 失败关闭地核对
`/opt/diesel`、`/opt/diesel/releases` 的类型、canonical path、owner 和 mode，并要求
目标 SHA 对 `-e` / `-L` 都不存在。preflight 与 postcheck 都在 SSH 连接内通过
`/usr/bin/env -i`、固定 `HOME` / locale / `PATH`、`/bin/bash --noprofile --norc` 和绝对
Linux 工具路径运行；该 clean-env 边界发生在 sshd 已调用 root login shell 之后，不能表述为
约束了此前的服务端启动过程。preflight 还在 `mkdir` 前要求 `/opt`、固定 Node 根、`bin` 父目录
与二进制均 canonical、`root:root` 0755，且版本精确为 `v22.22.3`；postcheck 在执行 helper 前
再次验证同一合同。
shared/runtime 敏感路径仍由后续 runtime/activation 脚本在使用前验证，staging receipt 不覆盖它们。

release 目录只能用不带 `-p` 的 `mkdir` 创建一次，确认为空后固定为 `root:diesel` 0750。
preflight 在创建前绑定 `/opt/diesel`、`/opt/diesel/releases` 的 device/inode，创建后再核对并将
两组 parent 与 candidate 共三组 device/inode 传给 postcheck；postcheck 在 manifest 验证前后
逐组重验。该 readback 只检测阶段间路径漂移，不是在 rsync 全程持有目录 inode 的 filesystem
capability。传输固定使用 `rsync -a --no-owner --no-group --no-perms --timeout=60`，远端
`--rsync-path` 先设 `umask 022`，再以 clean env 执行绝对 `/usr/bin/rsync`，从而既不继承远端
rsync 环境，又保留 manifest 所需的普通/可执行文件 mode。传输后还要重验 candidate metadata
和远端 `inputDigest`。

本地在传输前直接计算已按 commit blob 绑定的 archived manifest helper 的 SHA-256 与大小；
postcheck 在执行它前后都要求 helper 为 canonical、`root:root` 0644、单链接普通文件，且大小和
`/usr/bin/sha256sum` 结果精确匹配。postcheck 另要求 `.next`、`node_modules`、
`.build-complete`、`.deploy-ready` 仍不存在，不能利用 manifest 为后续 build 有意保留的
排除规则夹带预构建输出。文件缺失、额外文件、symlink、mode/内容漂移、commit 或 digest
不一致都不得返回成功。

三个远端阶段都由 committed bounded runner 执行。它要求 Unix 主机允许精确执行
`/bin/ps -axo pid=,pgid=`，先以 detached capability leader 验证自身与同组 inspector 两个
sentinel（1 MiB 上限、单次 inventory 最长 5 秒）；stage 会在首次 SSH 前显式运行该检查。每次
preflight、rsync、postcheck workload 又分别在新的 detached guardian 进程组内运行，本地执行
deadline 为 60、900、300 秒。超时或输出超限先请求 guardian 向自身锚定的组发送 TERM，5 秒后
outer 要求最终 seal；guardian 恰好一次向包含自身的 PGID 发送 SIGKILL，outer 最多再给 5 秒等待
stdio close 与 signal-0 `ESRCH`。这些 deadline 不包含最多 10 秒 capability probe 及终止/证明窗口。

所有负 PGID 非零信号只由仍存活的 guardian 发出；outer 在 guardian 死后只做无副作用 signal-0
probe，因此 PGID 复用只能导致保守失败，不能误发修改信号。workload close 时，guardian 用与
capability probe 相同的 parser 要求 guardian/inspector sentinel，并标记其他同组成员为 residual；
无论正常或异常，最终都必须 self-SIGKILL 封组。只有 guardian 以 SIGKILL 关闭、stdio close、原
PGID 缺席，且 token-bound、单链接 `0600` 的 `bounded-command-completion-v2` receipt 原子发布，
才传播已证明的退出状态。124、125 分别表示已收口的 deadline 与输出上限；group signal 拒绝、
inventory/sentinel 错误、guardian crash、同组残留、receipt 缺失或证明不闭合均为 126。

workload 关闭后的同组 inventory 检查期间，guardian 暂存收到的 HUP/INT/TERM（按信号去重，
最多三项），等 inspector 关闭后、发送 terminal record 前再转发，避免超限信号终止自身检查进程。
最终 seal 不排队，仍按原 kill grace 立即执行自包含 SIGKILL；检查挂起不会延长终止期限。
检查实际失败或暂存信号转发被拒绝仍返回 126，且不发布成功 receipt。同步屏障回归覆盖 stdout/
stderr 超限、检查正常完成、检查挂起、畸形 inventory 与信号拒绝，并核对信号顺序、输出上限和
receipt 的完整收口证明；这不是对真实主机 inventory capability 的替代验证。

stage 会为每次调用生成独立 token 并严格验证 receipt 内容、文件身份和实际退出码。receipt 缺失或
不可信时，stage 把 bounded status 固定为 126，保留本地 staging 根供人工核查，且不会在潜在存活
的 SSH/rsync 与 cleanup 之间制造竞跑；其他远端阶段非零仍统一返回 70，只在固定错误行附 bounded
status，不转发 capture。runner 在 capability probe 期间收到的首个 HUP/INT/TERM 会排队并在
guardian 就绪后收口；stage 信号路径若尚未完成 receipt 验证，同样保守保留本地状态。stdout/stderr
上限分别为 512/8192、65536/65536、128/8192 字节。SSH 的 connect/keepalive 与 rsync 的 60 秒
I/O timeout 仍是较早失败边界，不能替代执行 deadline。主动新建 session/PGID 的逃逸后代不在
该便携式进程组保证内；对 staging 入口自身直接发送 SIGKILL 也无法运行 signal trap。远端 root、SSH
host key/credential 与基础 OS 工具仍是显式信任边界；Node 二进制供应链 SHA 和 host-side
`ForceCommand` 尚未固定，留作后续加固。manifest 不是签名、SBOM、attestation 或可复现构建成绩。

只有授权、本地 archive/manifest 验证、远端原子占位、rsync 和传输后读回全部成功时，
脚本才输出一行有界的 `diesel-release-stage-v1` JSON receipt，精确包含 `format`、
`commit`、`inputDigest`、`target`、`releaseDir` 和已验证的 `authorization`。receipt 只是本次暂存的 point-in-time
readback，不是可跨时间复用的授权，也不证明 candidate 已 built、ready、activated 或
published。一旦远端 `mkdir` 成功，后续任意失败都必须保留该不可复用 candidate 供取证；脚本只在
所有已启动 bounded command 的 containment receipt 均已验证时清理自己精确创建的本地临时目录，
证明缺失时也保留本地状态；它不远程删除、覆盖或以同一 SHA 自动重试。
新文件是否可执行仍来自 archive，随后还会由输入 manifest v2 和 root-side runtime 准备
脚本再次验证并规范化权限。

最小 bootstrap 自身也不信任继承的 Git 重定向变量或 PATH 中的同名工具：它经
`/usr/bin/env -i` 调用固定 Git/tar，拒绝所有 non-normal index entry，并按调用 UID、0700、
canonical path、device/inode 验证自己唯一的临时根。它有界捕获 inner receipt，先安全清理
该 outer 临时根，最后才把单行成功 JSON 写到 stdout；outer cleanup 失败不得先显示成功。

首次启用 host-activation V1 时，必须在任何本次 40-SHA backup/state 目录出现之前单独执行一次
protocol 初始化。它在自己的 FD 8 lifecycle critical section 中枚举整个 backup 根；symlink、临时/
未知 marker、basis-only 或任何 active legacy 状态都会失败，只有 strict
`HOST_ROLLBACK_COMPLETED` / `PUBLISH_FINALIZED` 可按 release 排序冻结进全局 manifest。普通发布
绝不能在 manifest 缺失时自动重建或扩展 allowlist；若该文件后来缺失，立即停止并按事故处理：

```bash
set -euo pipefail
release_id="<首次启用 V1 的完整 release-id>"
release_dir="/opt/diesel/releases/${release_id}"
test ! -e "/opt/diesel/backups/${release_id}"
test ! -L "/opt/diesel/backups/${release_id}"
test ! -e /opt/diesel/backups/HOST_ACTIVATION_PROTOCOL_V1
test ! -L /opt/diesel/backups/HOST_ACTIVATION_PROTOCOL_V1
"${release_dir}/scripts/deploy/host-activation-ledger.sh" \
  initialize-protocol "${release_id}"
test -f /opt/diesel/backups/HOST_ACTIVATION_PROTOCOL_V1
test ! -L /opt/diesel/backups/HOST_ACTIVATION_PROTOCOL_V1
test "$(stat -c '%U:%G:%a:%h' \
  /opt/diesel/backups/HOST_ACTIVATION_PROTOCOL_V1)" = "root:root:600:1"
```

初始化成功后该 manifest 永久保留；已存在时只允许读回、fsync 和精确验证，不再执行上述初始化
命令。每次普通发布在创建本次 state 目录前都先要求它存在，随后 `--begin-activation` 才能为
当前 release 建立 V1 anchor/PENDING。

普通发布不得先修改 `/opt/diesel/shared/.env.production.local`。先完成一次性的主机
provisioning 与只读 preflight；本次 rollback basis、FD 8、ledger、candidate 安装和 traps 全部由
后述版本化 `host-release-orchestrator.sh` 在单一前台 root 进程中持有。`shared` 根目录由
`root:diesel` 以 0750 持有，环境文件保持 `root:diesel` 0640；只有 `shared/.data` 由
`diesel:diesel` 持有并可写，因此降权进程无法替换或重指向环境文件。持久 `.data` 从 shared
链入 release，也不把用户文件复制进不可变 release：

```bash
set -euo pipefail
root_system_path="/usr/sbin:/usr/bin:/sbin:/bin"
export PATH="${root_system_path}"
release_id="<与工作站相同的 release-id>"
release_dir="/opt/diesel/releases/${release_id}"

if ! getent group diesel >/dev/null 2>&1; then
  groupadd --system diesel
fi
if ! id -u diesel >/dev/null 2>&1; then
  useradd --system --gid diesel --home-dir /opt/diesel/shared --shell /usr/sbin/nologin diesel
fi
if ! getent group diesel-build >/dev/null 2>&1; then
  groupadd --system diesel-build
fi
if ! id -u diesel-build >/dev/null 2>&1; then
  useradd --system --gid diesel-build --home-dir /opt/diesel/build --shell /usr/sbin/nologin diesel-build
fi
node_binary="/opt/node-v22.22.3-linux-x64/bin/node"
pm2_launcher="/opt/node-v22.22.3-linux-x64/bin/pm2"
pm2_exec="/opt/node-v22.22.3-linux-x64/lib/node_modules/pm2/bin/pm2"
for runtime_directory in \
  /opt /opt/node-v22.22.3-linux-x64 \
  /opt/node-v22.22.3-linux-x64/bin \
  /opt/node-v22.22.3-linux-x64/lib \
  /opt/node-v22.22.3-linux-x64/lib/node_modules \
  /opt/node-v22.22.3-linux-x64/lib/node_modules/pm2 \
  /opt/node-v22.22.3-linux-x64/lib/node_modules/pm2/bin \
  /usr/local /usr/local/sbin /usr/local/bin; do
  test -d "${runtime_directory}"
  test ! -L "${runtime_directory}"
  test "$(/usr/bin/realpath -e -- "${runtime_directory}")" = "${runtime_directory}"
  test "$(/usr/bin/stat -c '%u:%g:%a' -- "${runtime_directory}")" = "0:0:755"
done
test -f "${node_binary}"
test ! -L "${node_binary}"
test "$(/usr/bin/stat -c '%u:%g:%a:%h' -- "${node_binary}")" = "0:0:755:1"
test "$("${node_binary}" --version)" = "v22.22.3"
test -f "${pm2_exec}"
test ! -L "${pm2_exec}"
test "$(/usr/bin/stat -c '%u:%g:%a:%h' -- "${pm2_exec}")" = "0:0:755:1"
test -L "${pm2_launcher}"
test "$(/usr/bin/stat -c '%u:%g:%a:%h' -- "${pm2_launcher}")" = "0:0:777:1"
test "$(/usr/bin/readlink -- "${pm2_launcher}")" = "../lib/node_modules/pm2/bin/pm2"
test "$(/usr/bin/realpath -e -- "${pm2_launcher}")" = "${pm2_exec}"
if ! /usr/bin/systemctl cat pm2-root.service >/dev/null 2>&1; then
  /usr/bin/env -i HOME=/root PATH="${root_system_path}" \
    "${node_binary}" "${pm2_exec}" startup systemd -u root --hp /root
  /usr/bin/systemctl daemon-reload
  /usr/bin/systemctl enable --now pm2-root
fi
/usr/bin/systemctl is-enabled --quiet pm2-root
/usr/bin/systemctl is-active --quiet pm2-root
pm2_state_root="/root/.pm2"
test -d /root
test ! -L /root
test "$(realpath -- /root)" = "/root"
test "$(stat -c '%U:%G:%a' /root)" = "root:root:700"
if [ ! -e "${pm2_state_root}" ] && [ ! -L "${pm2_state_root}" ]; then
  install -d -m 0700 -o root -g root "${pm2_state_root}"
fi
test -d "${pm2_state_root}"
test ! -L "${pm2_state_root}"
test "$(realpath -- "${pm2_state_root}")" = "${pm2_state_root}"
chown root:root "${pm2_state_root}"
chmod 700 "${pm2_state_root}"
test "$(stat -c '%U:%G:%a' "${pm2_state_root}")" = "root:root:700"
/opt/node-v22.22.3-linux-x64/bin/node -e '
  const { closeSync, fsyncSync, openSync } = require("node:fs");
  for (const path of process.argv.slice(1)) {
    const descriptor = openSync(path, "r");
    try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
  }
' -- "${pm2_state_root}" /root 8>&-
test -d /opt/diesel
test ! -L /opt/diesel
test "$(stat -c '%U:%G:%a' /opt/diesel)" = "root:root:755"
test -d /opt/diesel/releases
test ! -L /opt/diesel/releases
test "$(stat -c '%U:%G:%a' /opt/diesel/releases)" = "root:root:755"
install -d -m 0750 -o root -g diesel /opt/diesel/shared
install -d -m 0750 -o diesel -g diesel /opt/diesel/shared/.data
install -d -m 0710 -o root -g diesel-build /opt/diesel/build
release_build_lock_path="/opt/diesel/.release-build.lock"
release_lifecycle_lock_path="/opt/diesel/.release-lifecycle.lock"
for immutable_lock_path in \
  "${release_build_lock_path}" \
  "${release_lifecycle_lock_path}"; do
  if [ ! -e "${immutable_lock_path}" ] && [ ! -L "${immutable_lock_path}" ]; then
    # noclobber performs a one-time O_EXCL-style creation. Never replace or
    # unlink a lock inode after it may have been opened by another release.
    (umask 077; set -o noclobber; : >"${immutable_lock_path}") 2>/dev/null || true
  fi
  test -f "${immutable_lock_path}"
  test ! -L "${immutable_lock_path}"
  test "$(stat -c '%U:%G:%a' "${immutable_lock_path}")" = "root:root:600"
done
install -d -m 0700 -o root -g root /opt/diesel/release-inputs
test ! -L /opt/diesel/release-inputs
test "$(stat -c '%U:%G:%a' /opt/diesel/release-inputs)" = "root:root:700"
```

以上仅是独立的 host provisioning/preflight，不属于某次发布事务；缺失任一事实时先修复
主机，不要在发布关键区间创建用户、修改 PM2 service 或修正权限。每个 release 的新环境先从
root-only 来源复制到按 SHA 固定的 candidate。candidate 内容不得进入环境变量、命令行、终端
输出或工单；目录必须全新，且文件由 root 独占、普通、非 symlink、单链接、非空并不超过
1 MiB：

```bash
set -euo pipefail
release_id="<与工作站相同的完整 release-id>"
[[ "${release_id}" =~ ^[0-9a-f]{40}$ ]]
candidate_source="/root/diesel-env-candidates/${release_id}.env.production.local"
candidate_dir="/opt/diesel/release-inputs/${release_id}"
candidate_path="${candidate_dir}/env.production.local"

test -f "${candidate_source}"
test ! -L "${candidate_source}"
test "$(stat -c '%U:%G:%a:%h' "${candidate_source}")" = "root:root:600:1"
test ! -e "${candidate_dir}"
test ! -L "${candidate_dir}"
install -d -m 0700 -o root -g root "${candidate_dir}"
install -m 0600 -o root -g root "${candidate_source}" "${candidate_path}"
test -f "${candidate_path}"
test ! -L "${candidate_path}"
test "$(realpath -e -- "${candidate_path}")" = "${candidate_path}"
test "$(stat -c '%U:%G:%a:%h' "${candidate_path}")" = "root:root:600:1"
test "$(stat -c '%s' "${candidate_path}")" -gt 0
test "$(stat -c '%s' "${candidate_path}")" -le 1048576
```

版本化 orchestrator 会在任何本次 state mutation 前再次验证 candidate、固定 entry 与全部
sibling，并使用 release 内无外部依赖的合同分别校验 AI 日准入与小时准入。两项日准入值必须
存在、为安全整数且为 5 的倍数且 client 不大于 global；小时 global 可缺省为 10000，小时
global/client 都必须是 1–10000 的整数且 client 不大于 global；显式 backend 必须为 `postgres`
（字段缺省沿用生产默认值）；
随后由同一前台 root 进程依次持有 FD 8、创建并 fsync 四份 rollback basis、在
`--begin-activation` 前安装 one-shot terminalizer、严格读回 ledger、原子安装 candidate、
复核 backup/candidate/live 的 `DATABASE_URL` 完全相同，并再次校验 candidate 与安装后 live
的 AI 日准入、小时准入及 backend 合同，再运行 publication controller。失败信息只给出配置类别，
不打印原值。
这里不提前修改 live environment，也不依赖后续交互 shell 变量。

`HOST_ACTIVATION_V1` anchor 与单一 host state marker 共同绑定上述四份 rollback basis。V1 的
governance marker 共存合同是封闭集合，不得把未知组合当作空闲或为了继续发布而删除 marker：

| 分类 | 唯一允许的 host / governance 组合 | 允许的收敛方向 |
| --- | --- | --- |
| Active | `PENDING:none` | 继续 build/activation，或完整 host abort 后转 `ROLLED_BACK:none` |
| Active | `PENDING:RECOVERY_REQUIRED` | 仅可在 maintenance lock 内恢复数据库 |
| Active | `PENDING:HOST_ROLLBACK_REQUIRED` | 幂等恢复 host，深比较 DB/current/lock 后转 `ROLLED_BACK:HREQ`，再写 HCOMP |
| Active | `ROLLED_BACK:HOST_ROLLBACK_REQUIRED` | 仍须重放幂等 host restore 和全部 readback，再写 HCOMP |
| Active | `PENDING:PUBLISH_COMMITTED` | 仅可执行 committed finalize |
| Active | `PENDING:PUBLISH_FINALIZED` | commit 已不可逆；只能重复验证并前向转 `COMMITTED:PUBLISH_FINALIZED` |
| Terminal | `ROLLED_BACK:none` | 只读复验；不得重新激活 |
| Terminal | `ROLLED_BACK:HOST_ROLLBACK_COMPLETED` | 只读复验完成账本；不得重放旧 snapshot/host |
| Terminal | `COMMITTED:PUBLISH_FINALIZED` | 全局扫描与 `host-activation-ledger.sh validate` 只读复验账本；`rollback-host-release.sh --validate-committed` 只验 current/host/PM2；只有状态机 `finalize-committed` 重跑完整 host/public/current/lock 验收；任何 rollback 都拒绝 |

`--begin-activation` 在写 anchor 前完成旧 release、PM2/systemd、两份 Nginx backup、旧 verifier、
`current=previous` 以及 live/basis 字节一致性预检；anchor-only 中断只能由同一 release 重新运行同一
完整入口。写入 PENDING 后还会再次证明 live/basis、FD 8 和 ledger，才向 outer shell 返回。
FD 8 的路径相等不单独算持锁证明；每个 helper proof 都重做 `flock -n 8`，以拒绝另一个 OFD 已持锁
但当前 caller 只打开了 lock inode 的伪 capability。
`host-activation-ledger.sh` 的公开 CLI 只有一次性 `initialize-protocol` 与 `validate`；不得直接调用
内部 begin、mark-rolled-back 或 mark-committed 绕过上述工作流。

candidate 必须包含当前服务端数据库、模型和 `AI_MULTIMODAL_MODEL` 配置；不得在
终端、日志或工单中打印其值。应用 release 不得同时轮换 `DATABASE_URL` 的端点、用户名或凭据：
host rollback 会先恢复旧 env 再切旧 `current`，只有发布前 backup、candidate 与安装后的 live
连接串完全相同，任一中断点的新旧应用才都能访问 snapshot 所属的同一数据库。数据库凭据/端点
轮换必须作为独立、已演练的受控操作完成，并在稳定后再创建新 release candidate。
orchestrator 使用固定 Node 22 `parseEnv`、UTF-8/大小/owner/mode/单链接检查和不输出值的
identity proof；candidate 先经 `O_NOFOLLOW` source FD 与前后 `fstat`/SHA-256 绑定，再写同目录
`O_EXCL` 临时文件、fsync、原子 rename，并 fsync live 文件与 shared 目录。任一 proof 失败都只
输出固定错误；若 ledger 仍是 `PENDING:none`，one-shot terminalizer 恰好一次走版本化回滚。

构建用户不属于 `diesel`
组，且 runtime/builder 两个身份都不得有任何 supplementary group，因此不能借 docker、sudo
或敏感 socket group 越过文件边界；release 在构建完成前也不得链接该文件或 `.data`。随后只调用
版本化的 `scripts/deploy/prepare-release-runtime.sh` 完成 root 侧准备；该脚本持有部署根下
root-only 的全局 build lock，再以确定性的 `diesel-build-<release-id>.service` transient
systemd service 调用 `scripts/deploy/build-release.sh`。service 使用 `Type=exec`、`env -i`、
`KillMode=control-group`、45 分钟 runtime 上限和 30 秒 stop 上限，且不把 root shell 的 stdin
传给 builder。每个 commit 使用独立的 `/opt/diesel/build/<release-id>` HOME，不复用上一轮
Corepack/pnpm 用户态缓存；脚本在复制 release 前确认 `corepack` 可用并设置
`COREPACK_ENABLE_DOWNLOAD_PROMPT=0`，不能在无人值守发布中临时询问是否下载。安装强制使用
pnpm `--package-import-method=copy`，避免构建 workspace 中的文件通过 hardlink 影响共享 store；
连续发布必须继续使用同一隔离边界。

controller 不信任 `systemd-run` 的返回码，而是在 retained unit 上同时核验 `Result`、
`ExecMainCode` 和 `ExecMainStatus`；只有严格的 `success / CLD_EXITED / 0` 才算成功，普通非零、
signal、OOM 和 timeout 都保持非零。主进程结束后先 stop 精确 unit，再用 cgroup v2
`populated`、`/proc/*/cgroup` 精确路径和 builder UID 完成两轮零残留证明，之后才允许冻结、
摘要或复制工件。冻结后 root 先要求 workspace input manifest 与 release 中的可信 manifest
逐字节相同。Next build 会改写受版本控制的 `next-env.d.ts`：builder 在独立 HOME 中保存快照并在
自己的第二次输入校验前恢复；cgroup 与 builder UID 归零且 workspace 冻结后，root controller
仍会从 builder 不可访问的 canonical release 再覆盖一次该文件，才执行可信 input verifier。
随后只执行 release 根中预先验证为 `root:diesel` 的 input/artifact verifier 绝对路径；
这些 root verifier 也通过 `env -i` 清除 `NODE_OPTIONS`/`NODE_PATH` 等继承注入面，绝不执行
builder 可写 workspace 中的 verifier 脚本。builder 失败时，EXIT cleanup 只删除经过 commit SHA、
canonical parent 和非 symlink 三重校验的本轮 workspace 与 HOME，并保留原失败码；候选工件
handoff 一旦开始，后续失败则保留已经冻结的 workspace 与 HOME，避免在未证明 candidate durable
时丢失唯一可核查的构建源。unit stop、
metadata、cgroup 或目录 cleanup 任一无法证明时则把发布提升为 70，并保留 workspace 与 HOME
供取证。此时 workspace 中的 `next-env.d.ts` 或 HOME 快照可能保持失败现场，但绝不会被提升到
候选 release；手工排障不能把保留目录当作可部署工件。`/opt/diesel/build` 本身保持
`root:diesel-build` 0710，builder 只能写本轮 root 创建的
HOME，不能替换顶层路径。若 root controller 被 SIGKILL 或主机掉电，磁盘目录可能保留；下一轮
会因同名 unit、builder 进程或本轮目录已存在而失败关闭，必须先人工核查，不能把 stale 状态
自动当作安全重试。构建日志保留在该 unit 的 journal 中。
若首个 bounded `systemctl stop` 本身超时或失败，controller 只会在 unit 的 26 项身份/隔离属性
已完整验证后，对该精确 unit 执行 `systemctl kill --kill-who=all --signal=SIGKILL` 并重试 stop；
命令返回码仍不构成清理证明，最终必须通过 unload、cgroup path 消失与两轮 residual proof。
从 rollback basis 建立到 §4.3 公开验收收敛，只由目标 release 的版本化
`host-release-orchestrator.sh` 这一个前台 root 进程拥有状态机。它在写入本次
state 前完成只读 bootstrap，先持有 FD 8，再持久化并 fsync 四份 rollback
basis；在调用可能写入 `PENDING` 的 `--begin-activation` 前已安装
`HUP/INT/TERM/EXIT` one-shot terminalizer。显式可捕获中断会转发给当前 begin/controller
child，随后只按 strict ledger 分类回滚或保留现场；`SIGKILL` 或掉电仍依赖
durable ledger 与后文恢复流程。回滚脚本继续用受信旧 ecosystem/validator 恢复
`current`、环境、Nginx 和 PM2，且不放宽历史 root-runtime 安全边界。

VPS 当前不预设 `pg_dump`；§4.3 会在同一个治理维护锁内完成 fresh JSON 快照、SHA-256
校验、dry-run、无净变化的 `--apply` 恢复演练、97 国写入和公开验收。生产 install 只信任
当前 Git 提交中已在工作站通过完整门禁的版本控制 lockfile，使用
`--frozen-lockfile --trust-lockfile`，避免 pnpm 11 在 registry TLS 故障时卡在逐项在线 lockfile
供应链验证。registry 默认仍为 `https://registry.npmjs.org`；当前 normal path 不从
交互 shell 继承 `PNPM_REGISTRY` 或全局 pnpm/npm 配置。若必须使用受控镜像，先对
版本化的 clean-environment 输入合同单独评审和测试，不得在发布关键区间临时修改。

`diesel-release-input-v2` 除路径、大小与内容 SHA-256 外，还绑定 Git
`100644` / `100755` executable bit。构建成功并再次验证输入后，
`diesel-build-complete-v2` 对固定的 `.next` 与 `node_modules` 工件闭包保存聚合摘要、条目计数、
总字节、commit、input digest 与 Next BUILD_ID；普通文件绑定内容和 executable bit，目录、
安全的闭包内相对 symlink 也进入摘要，hardlink、特殊节点、破损或逃逸 symlink 均失败关闭。
manifest 保持有界，不会为 `node_modules` 的每个文件生成一条大型 JSON 记录。
主 TypeScript 增量状态固定写入 `.next/cache/tsconfig.tsbuildinfo`，Playwright 生成的
`tsconfig.e2e.json` 会把它改写到 `.next-e2e/cache/tsconfig.tsbuildinfo`；两者不会在仓库根
生成 `tsconfig.tsbuildinfo`，也不会跨普通构建与 E2E 构建共享状态。

root 侧脚本把 builder workspace 放在 `root:diesel-build` 0710 的
`/opt/diesel/build-workspaces` 下，而不是可由构建用户替换的 HOME 子目录；build 返回后先把
workspace 冻结为 `root:root` 并重算 v2 摘要。随后删除明确排除在不可变摘要之外的
`.next/cache`，使用不跟随 symlink、禁用 reflink 的复制把 `.next`、`node_modules` 与 marker
写入新的 root-controlled inode，避免残留 lifecycle 进程凭旧 writable file descriptor 修改
候选 release。目标端随后以 `diesel:diesel` 0750 重建可变 cache 并链接共享环境与数据；再次
全量重算 immutable 工件成功后才生成 `diesel-deploy-ready-v1`，readiness marker 最终必须是
`root:diesel` 0640。prepare 随后以不跟随 symlink 的树扫描拒绝 candidate 内的 nested filesystem，
对 candidate、release root 与 deploy root 的 containing filesystem 执行 `sync -f`，并对两个
marker、`.next`、`node_modules`、release 目录及两个父目录逐一 `fsync`；同步完成后再执行一次
metadata 与全量 `check-ready`，之后才报告 runtime-ready。成功时 workspace 与 per-release HOME
按精确路径清理；handoff 或 durability 失败时保留冻结副本供人工取证，不得把它手工当成可部署工件。
`check-ready` 不是 marker-only 比较：每次调用都会重新读取 `.next` / `node_modules` 全闭包并与
build marker 比较，再按 input manifest 的精确路径、内容 SHA-256、大小和 executable bit 重验
全部 tracked release 输入；文件和目录集合都必须精确，因此新增空目录也会失败。生产 CLI 自身要求
以 `root:root` controller 执行，并拒绝 root runtime、相同 immutable/runtime UID 或不一致的 runtime
group；调用者还必须显式传入 immutable `root:diesel` 与 runtime `diesel:diesel` 的数值 UID/GID。
deploy root 与 `releases` 必须保持 controller-owned 0755 真实目录，并与 release 根一起在检查末尾
复验 inode/metadata；release、tracked 输入、
control files 及 immutable 工件会按 `0750` / `0640`（可执行文件为 `0750`）重验 owner、group、
mode 和普通文件单链接属性。除两个工件根和三个 control file 外，只允许
`.env.production.local` 与 `.data` 两个运行时入口；前者必须解析到同一 deploy root 下的
真实 `shared/.env.production.local`、保持 `root:diesel` 0640 且单链接，后者必须解析到
`diesel:diesel` 0750 的真实 `shared/.data`；`shared` 本身也不能是 symlink。唯一允许运行用户拥有的
工件内路径是 `.next/cache`，它必须与 `.data` 使用相同 runtime identity 和 0750。额外文件/目录、
Nginx/ecosystem 漂移、权限或所有权漂移、链接替换或 finalize 后工件漂移都会在首次切换前失败关闭。
这个摘要只证明一次构建到候选 release 的交接完整性；它不是签名、SBOM
或可复现构建证明，同一 commit 因 Next BUILD_ID、平台产物或嵌入的绝对路径不同可以得到不同
artifact digest。

CI 的 `linux-release-handoff` job 会在不持久化 checkout 凭据的固定 GitHub-hosted Ubuntu
24.04 runner 上，从当前 commit 重新导出 archive/manifest，并用 `sudo /usr/bin/env -i` 调用
`scripts/ci/linux-release-handoff-smoke.sh`。它在 `${RUNNER_TEMP}` 中创建真实但临时的独立
runtime/builder 用户，要求真实 PID 1 systemd 与 cgroup v2，执行 GNU rsync、Corepack/pnpm
frozen install、transient build service、Next build、root-side prepare 与 `check-ready`，并把
unit/cgroup、身份、进程和临时根清理也作为门禁的一部分；workflow 为生产 45 分钟 build 上限
预留 60 分钟。fixture 为 live/backup 写入同一个 `postgresql://database.invalid/diesel` 和合法的
两项 AI 日准入值，只用于在数据库联网前闭合静态环境合同，不声称数据库可连接。真实构建前还会
启动一个后台 `sleep` canary：main 成功退出但 cgroup 仍有 child
时必须返回 70，stop 后 unit、cgroup 和 UID 必须全部归零；另外两个轻量 transient canary
必须从真实 manager 元数据分别保留普通 `exit 23` 与原始 SIGTERM→143，并完成同样清理。
activation metadata canary 还会依次把 `releases`、deploy root 和一个 immutable artifact 临时改成
runtime-owned 或 group-writable，要求全部拒绝，逐项恢复后再要求 clean candidate 通过。该 job 已在本地
workflow 接线并成为 `Required CI gate` 的 dependency；首个远端 Actions 成功出现前，不得写成
“Linux 演练已通过”。即使远端通过，它也不覆盖真实 `/opt/diesel`、SSH、PM2/Nginx、数据库、
生产凭据或目标 VPS 的 systemd/cgroup 配置，VPS 发布仍必须执行本节完整演练。

工作站完整门禁通过后，normal path 不再由运维人员分别拼接 environment backup、
begin、prepare、activation 与 governance 命令。下文只从 clean environment 前台调用
目标 release 的版本化 `host-release-orchestrator.sh`；该单一 root 进程拥有
rollback basis、FD 8、`--begin-activation`、candidate 安装、所有 traps 与终态决策。
它再以 clean foreground child 调用同一 release 的
`release-publication-controller.sh`，由 controller 按固定顺序执行
`prepare-release-runtime.sh`、`activate-host-release.sh`、治理 `publish` 与
`finalize-committed`。`/opt/diesel`、两份 Nginx live 路径、固定 Node 22、`/proc`、
PM2 state root、PM2 executable 与 systemd unit fragment 都由版本化脚本固定，不能由
发布 shell 环境覆盖。

controller 调用 activation 时，orchestrator 已经持有固定 FD 8、已经建立并复验
`HOST_ACTIVATION_PENDING`，且已经安装 `HUP/INT/TERM/EXIT` terminalizer。activation 会重验
`.deploy-ready`、rollback basis、PENDING 与 lifecycle-lock capability，然后完成 Nginx 安装与
`nginx -t`、`current` 原子切换、PM2 clean start、内网 readiness、durable PM2 state 和 Nginx
reload。它不创建、重命名或删除 host/governance ledger marker，也不自行声明 commit；任何非零退出
都由 controller 分类并交给 orchestrator 按既有 `--abort-if-uncommitted` / governance recovery 分支收敛。
不得把 activation 成功当作跨数据库/主机 commit point，也不得跳过 prepare、治理发布或
finalization。

`command /usr/bin/env -i` 与固定 `/usr/bin/bash --noprofile --norc` 同时构成 orchestrator、
controller 和其 activation child 的启动边界：
它显式保留同一个已锁定的 FD 8 及其 marker，但不继承 `BASH_ENV` / `ENV`、exported shell
functions、`SHELLOPTS` / `BASHOPTS`、dynamic-loader 变量、`NODE_OPTIONS`、数据库/AI/PM2
秘密或测试 seam。环境清理不会关闭 file descriptor；该命令必须前台运行，不能改成 `exec`、
管道或后台任务。最外层 clean invocation 不继承 FD 8；它由 orchestrator 在同一进程内
打开并持锁，对 begin/controller child 显式传递。这个边界不能阻止有 root 权限的
并发进程或底层存储失信。

脚本对两份 live Nginx 文件在首次写入前重验 canonical path、owner/mode、单硬链接与 ledger
backup bytes；目标配置先在同一 root-owned Nginx 目录中形成受校验的临时文件、离线执行
`nginx -t`，再分别用 atomic rename 替换 live 目录项，因此不会原地截断 hardlink 或跟随 raced
destination symlink。两个文件不是一个跨文件原子事务：第二次 rename 前后的故障仍保持
`PENDING`，由 orchestrator rollback 收敛。`current.next` 的 EXIT cleanup 在创建前即已生效；若不可捕获的
SIGKILL/掉电留下精确指向同一 target release 的 root-owned 单链接 symlink，同一 release 的
activation 只有在 PENDING、current=previous 且 Nginx rollback basis 全部重新证明后才会删除并
fsync；更常见的 orchestrator `--abort-if-uncommitted` / governance host rollback 则会在首次 host restore
mutation 前验证同一对象，删除并 fsync，再重验 ledger/current。`--check` 只验证而不删除，新的
`--begin-activation` 要求对象完全不存在。其他对象、目标或 metadata 一律保留现场并失败关闭。

PM2 替换进程定义时的 CLI 环境只允许 `HOME` / `PATH` / `APP_VERSION` /
`NODE_ENV`；不得继承 root shell 里的 `DATABASE_URL`、`AI_*` 或其他秘密。
ecosystem 再作第二层防护：`interpreter: "none"` 以 `/usr/bin/env -i` 启动固定的
Node 22，只注入明文 allowlist，并用 `--env-file=.env.production.local` 让 Next.js
进程从当前 release 中由 root 管理的软链接加载服务端配置。因此即使
root 所有的 PM2 daemon 保留了旧环境，实际应用也不会继承。发布时先删除同名的旧
PM2 进程定义，再从目标 ecosystem 启动；这是为了确保首次从旧的 Next CLI 定义迁移到
`/usr/bin/env -i` 定义时不会把新参数误传给旧脚本。每次启动后必须在
`pm2 save` 前确认恰好一个
`diesel-demo` 处于 `online`。版本化 host validator 还会在检查前后各读取一次 `pm2 jlist`，
要求两次 PID 相同，且 `pm2_env` 中的 name、`APP_VERSION`、`pm_cwd`、`pm_exec_path`、
`exec_interpreter`、精确 args、fork/autorestart/memory 合同及数值 uid/gid 全部等于目标
ecosystem；两次之间及之后读取 `/proc/<pid>/cwd`、`exe` 与有界 `cmdline`，分别绑定实际
release、固定 Node binary 和由目标 release 的 Next package version 推导的进程标题。
实际 OS uid/gid 也必须等于 `diesel`。内部测试可显式传隔离 proc root，但生产 CLI 永远固定
`/proc`，不能由环境覆盖。VPS 若尚无 `pm2-root.service`，先以清洁 CLI 环境执行一次
`pm2 startup systemd -u root --hp /root`；每次保存 dump 后都 fail-closed 确认该 unit
不只是 `enabled`/`active`：版本化 validator 用两次 `systemctl show` 精确绑定
`pm2-root.service` 的 loaded/running/enabled、forking/root、仅 PATH 与
`PM2_HOME=/root/.pm2` 的环境、无 EnvironmentFile/drop-in、固定 PIDFile、
`/opt/node-v22.22.3-linux-x64/lib/node_modules/pm2/bin/pm2 resurrect`、
`Restart=on-failure`、固定 fragment 与 cgroup；loaded `Wants`/`Upholds` 必须为空，
`Requires` 只能是目标 Ubuntu 24.04 的隐式 `system.slice` 与 `sysinit.target`。condition、
start pre/post、stop post、Requisite/BindsTo、success/failure、PartOf、身份切换、root image/
directory 与环境继承字段都必须为空；reload/stop 命令、shutdown conflict、slice、dynamic-user
和空 working-directory 配置也逐项固定。证明顺序固定为
磁盘 A、loaded A、一次 `/proc`、loaded B、磁盘 B：中间把 MainPID 与
`/root/.pm2/pm2.pid`、root-owned `/proc/<pid>` 的固定 Node executable、cgroup 和 NUL
分隔实际环境交叉绑定，前后 loaded PID 必须相同。

两次磁盘证明都会按固定官方 PM2 systemd 模板逐字节验证
`/etc/systemd/system/pm2-root.service`，以 `O_NOFOLLOW` 打开并绑定 path/FD inode、metadata、
单硬链接及 root-only 权限；同时把 manager 实际 `UnitPath` 绑定到固定环境下
`systemd-analyze --system unit-paths` 的预批准编译路径，扫描所有潜在 path。任何 exact、
dash-truncated、type-wide 或指向该 unit 的 alias drop-in，以及相应
`.wants`/`.requires`/`.upholds` 非空目录都失败；跨 path 的 dangling/chained alias 也按词法
symlink 图失败关闭。持久 enable 证明还要求
`multi-user.target.wants/pm2-root.service` 是 root-owned symlink，词法和 realpath 都回到固定
fragment。磁盘 A/B 指纹必须完全相等；整个 validator 只读，不执行 `daemon-reload`。这证明
canonical multi-user enable link 与当前 loaded daemon 一致，但默认 boot transaction 仍属于
VPS provisioning 信任边界，必须以真实重启演练验证，不能仅凭此声称重启必然拉起。
这是高风险字段枚举与双快照，不是 PID 1 loaded state 的完整 digest；仍信任 root/PID 1 actor
不会在快照间以保留 metadata 的方式篡改未枚举状态。任一漂移都不能建立或复验 commit。
既有 unit 不满足该合同必须受控重建，不能只靠手工启动的
正确 PM2 daemon 掩盖错误的 reboot 路径。PM2 state root 必须是
固定 `/root/.pm2` 的非 symlink `root:root` 0700 目录；`/root` 也必须是真实的 root-only 0700
目录，初始化或规范化 state root 后两者都在使用前 fsync。每次 `pm2 save` 后必须
调用 release 内版本化 persistence helper。真实 `dump.pm2` 是 PM2 `pm2_env` 对象的顶层数组，
不是 `jlist` 的 `{ pid, pm2_env }` 包装；helper 因此只接受该真实结构，并拒绝 nested decoy。
唯一 `diesel-demo` 必须同时匹配正式版本字段、完整启动定义及数值 uid/gid。helper 限制 dump
为 16 MiB、规范化主 dump 为单链接 `root:root` 0600，原子生成同字节 backup，并在返回前
复验、fsync 两份 dump 与目录。helper 或 systemd identity 失败时不得 reload Nginx、建立治理
commit 或迁移恢复账本。

发布验收至少包括：内网与公网 `/api/health` 均返回服务 `ok` 和新 `APP_VERSION`，且
`/api/health/ready` 均返回数据库、`aiChatAdmission` 与 `aiChatRateLimit` 三个独立探针 `ok`
和同一版本。readiness 在 AI 侧只验证生产日限额、小时 global/client 关系与 PostgreSQL backend
的配置合同，不预留预算、不消费小时请求、不连接 provider；
在数据库侧使用 2.5 秒 statement timeout，并在应用进程内对未完成探针 single-flight、对快速失败
短暂冷却，避免公网重复健康请求在数据库故障时累积连接或查询。首页、
`/chat`、代表国家页返回 200；HTTP IP/备用域名跳转到 `https://jamesky.site`；主域名
发送超过 1 MiB 但仍在应用 9 MiB 上限内的合法附件时，请求必须到达应用而不是返回
Nginx 413 HTML；1×1 图片应由应用返回结构化 400，至少 11×11 的有效图片必须进入已配置
视觉模型路径；超限、损坏图片和超页 PDF 也应返回应用的结构化 4xx。法规数据发布还要
完成 §4.3 的目标国四 scope 与公开 API 读回。

基础应用验收统一调用版本化脚本：

```bash
scripts/deploy/verify-release.sh http://127.0.0.1:8788 "${release_id}"
scripts/deploy/verify-release.sh https://jamesky.site "${release_id}"
```

该脚本先独立校验 `/api/health` 的服务名、canonical ISO UTC 时间、`status=ok` 与目标
`APP_VERSION`，并要求时间戳落在请求/响应窗口 ±5 秒且两个禁止缓存 Header 精确、唯一；
再由 release 内版本化且无外部依赖的 `readiness-response-contract.cjs` 以 exact 顶层字段、exact
`checks` 字段及相同时间/缓存合同失败关闭校验 readiness 的数据库、AI 日准入、AI 小时准入
配置探针和同一版本。额外字段、缺失或陈旧时间戳、可缓存响应均不能放行。页面与 Chat 验收前，
脚本还读取 `/api/products`，由 `validate-public-products.ts` 直接按 strict
`productListResponseSchema` 校验完整 DTO，并要求公开列表恰好为 `DEMO-ENG-100`、
`DEMO-ENG-200`；两条产品必须匹配受控 Demo 实体 ID、共同来源 ID、`demo-v1` 规格版本，且
产品及来源都显式为 Demo。接口缺失、畸形、缺字段、额外产品、实体/来源/版本或任一层分类
漂移都会停止发布。随后
实际读回 `/`、`/map`、`/chat`、`/countries/CHN`：无偏好时各页必须输出 `<html lang="en">`；
通过 `POST /api/preferences/locale` 设置一年期、`Path=/`、`SameSite=Lax`、`Secure`
的 `diesel_locale=zh-CN` 并由 curl cookie jar 持久化后，同一路径集合必须输出
`<html lang="zh-CN">`。公网 HTTPS 使用 jar 回放；内网 HTTP 在确认响应属性和 jar
落盘后显式提交同一 Cookie 值，避免依赖 curl 对 loopback Secure Cookie 的版本差异；
内网 origin 只接受 `127.0.0.1` 的 1–65535 数字端口。所有 curl 调用都以首参数
`--disable` 忽略用户级 `.curlrc`，用 `--noproxy '*'` 禁用代理，并按 origin 锁定
`--proto '=http'` 或 `--proto '=https'`；health/products/locale JSON、页面 HTML 和 Chat SSE
分别限制为 64 KiB、4 MiB 和 1 MiB，不能让环境配置改写真实目标或让无界响应进入内存/临时盘。脚本还向
`POST /api/chat` 发送固定的能力问答；该问答命中应用内的确定性直接回复分支，不初始化
外部模型。验收要求响应为 AI SDK UI-message v1 SSE，并按
`start` → 闭合的非空文本 part → `finishReason=stop` → `[DONE]` 顺序完成；缺失、重复、
越界或未知 event，以及 `error`、`abort` 和任何 `reasoning-*` part 均失败关闭。这一检查证明公开 SSE 传输和无 reasoning
响应边界可读回；它不证明模型供应商连通性、工具循环或模型生成路径，后者仍须由获批的
live eval 和对应发布检查单独验证。

更新 `STATUS.md` 的生产状态前，还必须在明确批准一次付费 provider 调用后执行真实模型/
工具路径读回；未获批准或检查失败时，生产状态必须继续标记为“provider path 未验证”：

```bash
CANARY_BASE_URL=https://jamesky.site \
CANARY_EXPECTED_VERSION="${release_id}" \
CANARY_CHECK_AI=true \
CANARY_REPORT_PATH=artifacts/post-release-provider-canary.json \
pnpm ops:canary
```

该命令不会替代 clean-worktree 的 18-case live eval；它只证明当前 release 的普通 AI SSE
能够走完 provider、工具与证据验证路径。报告仍按 canary v3 脱敏合同保存，不得记录模型
原文、凭据、URL credentials 或响应体。

任何一项失败都回滚应用和配置。将 `current` 原子指回持久化文件中的发布前
release，原子恢复同一 `release_id` 状态目录中的共享环境文件与两份 Nginx
备份，核对环境文件为 `root:diesel` 0640，校验 Nginx 与旧 PM2；发生漂移时才修复并
reload，最后用旧 release 的版本化脚本重新跑上述健康/页面检查。验收完成前不得删除前一
release、共享环境备份或 Nginx 备份；数据库迁移和法规治理发布必须按各自备份/纠错流程回滚，不能靠
应用软链接假装撤销数据库状态。

回滚执行旧 ecosystem 或 verifier 前，会逐级要求旧 release 目录/入口由 root 持有、group
仅为 root 或 diesel，且 group/world 不可写；verifier 还必须能由 `diesel` 用户执行。verifier
通过 `runuser -u diesel` 在清空后仅保留固定 `HOME`/`PATH` 的环境中运行，不继承发布 shell 的
数据库、模型密钥或 lifecycle FD。需要恢复 Nginx
时，脚本先保存尝试前文件，把 rollback candidate 原子放到 live 路径并执行 `nginx -t`；
candidate 无效会在触碰共享环境、`current` 或 PM2 前原子恢复尝试前文件并重新校验，随后
失败退出。恢复过程不会消费尝试前的 master 副本；只有两份配置均恢复且重新通过
`nginx -t` 后才删除副本。若原子恢复本身中断，脚本会失败关闭并在 stderr 输出仍保留的
绝对恢复路径，供人工核对和恢复。这样修正 backup 后可安全重跑，也不会在部分恢复失败时
丢失最后一份已知配置。

`check-ready` 是新 candidate 激活前的完整重验合同，而不是只比较两份 marker；不能反向施加给早于
`diesel-build-complete-v2` 的历史 release。host rollback 对旧 release 的 `.deploy-ready`
继续只做受信路径、普通文件和不可写权限检查（手工恢复片段也保留 `test -f`）；随后必须运行
该旧 release 自带的完整 verifier。这样保留时间戳 release 的可恢复性，但不会放宽任何新
release 在首次激活前的 v2 marker 与 `root:diesel:640` 要求。

host-only 回滚先用版本化脚本做无副作用预检，再显式应用；`--check` 与
`--apply` 在 `PUBLISH_COMMITTED` 或 `PUBLISH_FINALIZED` 存在时拒绝执行，治理提交后的恢复必须走 §4.3
数据恢复协议。预检会通过仅存在于 `/tmp` 的 0600 顶层配置加载两份持久化 Nginx backup
并执行 `nginx -t`，不会先替换 live 配置；备份 pair 无效时在共享环境、软链接、PM2 或
Nginx live state 发生任何变化前失败关闭。发布 trap 使用同一脚本的
`--abort-if-uncommitted` 模式：有效 committed/finalized
marker 会在校验权限、单行 payload、snapshot 路径/hash 与 `current` 后保持已提交状态并安全退出，
所有治理恢复 marker 都缺失时才执行幂等主机恢复；遇到 `RECOVERY_REQUIRED`、
`HOST_ROLLBACK_REQUIRED` 或 terminal `HOST_ROLLBACK_COMPLETED` 时一律拒绝。只有 maintenance-locked
状态机可调用 `--restore-governance-host`；该模式恢复并验证旧 host，但刻意保留
`HOST_ROLLBACK_REQUIRED`，无权声明数据库恢复完成。
所有 live 环境/Nginx 文件及父目录、`current` 的父目录和 ledger 目录都会在成功返回前无条件
`fsync`，以关闭上次已经 rename 但尚未同步就中断的窗口。二者同时存在或
损坏或可疑 marker 一律失败关闭：

治理恢复可能在 host 已修复、但 HREQ 尚未改名时停在 `ROLLED_BACK:HREQ`。重试不能据此跳过
host：`recover-required` 对 `PENDING:HREQ` 与 `ROLLED_BACK:HREQ` 都再次调用 restore-only host
路径，复验 env、Nginx、`current`、PM2 与 durable dump，再在同一 maintenance session 内重新导出
并深比较数据库、复核 lifecycle lock，最后才把 HREQ 改名为 HCOMP。相反，finalize 会先把
`PUBLISH_COMMITTED` 改名为 PFINAL；若之后失败，`PENDING:PFINAL` 是不可回滚的前向恢复状态，
重跑 `finalize-committed` 完成两轮 host/public/current/lock 证明后，最后才把 PENDING 改名为
COMMITTED。任何失败都保留当前 durable pair，不能把单个 marker 当成完整成功证明。

```bash
release_lifecycle_lock_path="/opt/diesel/.release-lifecycle.lock"
test -f "${release_lifecycle_lock_path}"
test ! -L "${release_lifecycle_lock_path}"
test "$(stat -c '%U:%G:%a' "${release_lifecycle_lock_path}")" = "root:root:600"
exec 8<>"${release_lifecycle_lock_path}"
flock -n 8
export DIESEL_RELEASE_LIFECYCLE_LOCK_FD=8
"/opt/diesel/releases/${release_id}/scripts/deploy/rollback-host-release.sh" \
  "${release_id}" --check
"/opt/diesel/releases/${release_id}/scripts/deploy/rollback-host-release.sh" \
  "${release_id}" --apply
exec 8>&-
unset DIESEL_RELEASE_LIFECYCLE_LOCK_FD
```

### 4.3 按国家定向发布法规 fixture

Repository fixture/source closure 只证明预期输入；生产发布仍必须由目标 release 绑定的数据库、
API、host 与 ledger readback 证明。sourceable shell seam 与 fake-command fixture 只验证控制流、
故障注入和失败关闭合同，不证明目标 VPS 的 root metadata、canonical Node/PM2 或 systemd 边界
已经真实执行。

#### 可重复执行合同：2026-08-11 的 97 国 accepted 闭包（KEN 去重）

以下命令是每个新 release 必须从头执行的定向发布/归档合同；不得因
`20260812031745` 已成功执行而在未来发布中跳段。先完成备份与恢复演练，再逐国运行；
DZA、ETH、NGA 会由脚本归档已发布的 retired regulation/limit，再发布当前
no-data 图。LKA 应读回 `2018-07-13` 起道路 5+5 与工程 24 条，农业 no-data；
KHM、LAO、MMR、MNG 应各读回两条精确来源且四 scope no-data。每条命令后必须
记录目标库四 scope 查询、治理归档结果和公开 API/页面读回，
成功前不得更新 `STATUS.md` 的运行库快照。

ACCEPTANCE #199–#200 / ADR-128 另要求在基础 35 条后重新定向发布 MAR、KEN：MAR
只把第二条主 source 从咨询矩阵替换为 BO n°7028 / Arrêté 2251-21；KEN 只把 LN180
刷新为 `eng@2025-03-24` 最新合并表达式并保留 LN13。两次 refresh 不改变两国
四 scope no-data、regulation/limit 图或稳定 33 国计数，且不得因重复出现 KEN 命令而
误解为两项不同法规结论。

ACCEPTANCE #201–#204 / ADR-129 再在 MAR/KEN 后追加 QAT、KWT、OMN、JOR 四次
定向 source refresh。四国各发布恰好两条 accepted source，统一
`verifiedAt=2026-08-10T18:48:04Z`，membership `validFrom` 保持 `2026-08-09`；
每国仍为四 scope no-data、零 regulation/limits。不得用 GSO MY2026 国家标签推断
国内 Euro V 已实施，也不得把旧 portal/固定源/在用车来源重新写回当前双源图。

ACCEPTANCE #205–#208 / ADR-130 再在 QAT/KWT/OMN/JOR 后追加 IRN、IRQ、LBN、SYR
四次定向 source refresh。四国各发布恰好两条 accepted source，统一
`verifiedAt=2026-08-10T18:55:45Z`，membership `validFrom=2026-08-10`；每国仍为
四 scope no-data、零 regulation/limits。IRN Article 4 日程已确认可读，但仍不得从
Euro/Stage 标签补全表与循环；IRQ 未公开 TR 167 排放附件，LBN 的在用车实施缺口和
SYR 的进口/车龄政策也不得升级为新发动机法规。YEM 本轮 no-change。

ACCEPTANCE #209–#243 / ADR-131 再按 GUY/HTI/JAM/BLZ/CUB、LBR/LBY/MLI/MRT/NER、
GTM/HND/NIC/PRY/URY、PRK/PSE/SDN/PRI/NCL、ERI/GAB/GMB/GNB/GNQ、
MOZ/LSO/MDG/MUS/FJI、CAF/COD/COG/GIN/DJI 的顺序追加 35 次 current source
定向刷新。每国发布恰好两条 accepted source；除 URY 保留既有 1 regulation / 18 limits
外，其余 34 国均四 scope no-data、零 regulation/limit。URY 只纠正 V5 source 的
`publishedOn=2025-11-13`；底层 Decree/首版 homologation regulation 继续保持
`effectiveFrom=2023-05-14` 与 9+9 道路限值。`2025-11-17` 仅是当前 V5 程序版本启用日，
不得覆写为底层 regulation 的生效日。

基础 35 个国家命令已经包含 KEN；#200 的 KEN source refresh 必须由该既有 KEN 命令
完成，不得再追加重复命令。既有 44 条与 #209–#243 的 35 条无 ISO3 重复，去重后的
上述 79 国是追加完整性/当前双源收口前的历史小计。ACCEPTANCE #244–#247 /
ADR-133 再追加 AUS、PNG、CAN、USA 的数值完整性发布；#248–#259 / ADR-134
追加 BRN、BTN、SLB、TLS、MWI、SLE、SOM、SSD、TCD、SLV、SUR、TTO 的 current
双源图。ACCEPTANCE #262–#264 / ADR-136 进一步将 ARE 通用 numeric 生效日纠正为
`2027-07-01`（2026 只保留 new-model regulation metadata），并补齐 USA/CAN 40 CFR
1039.101 法定展示的全部 P<8…130≤P≤560 variable-speed 功率带。按 §1039.140 / §1065.20(e) ties-to-even，
三位 raw 查询翻译依次为 `[0,7.5)`、`[7.5,18.501)`、
`[18.501,36.501)`、`[36.501,55.5)`、`[55.5,129.5)`、`[129.5,560.501)`；
raw bounds 不替代法定展示标签，560、560.001 与 560.500 kW 均命中最高带，
560.501 kW 无结果。
加拿大 SOR/2020-258 §1(4) 同时纳入 calculation methods。CAN/USA 以
`2026-08-11T05:21:45.000Z` 重新签核，target 分别为 48/70 limits。这三国已在既有队列中，
不增加命令。最后按 ACCEPTANCE #260–#261 / ADR-135 追加 CHN 与 MLT，分别发布 GB 20891
完整历史/当前功率带与可寻址 EU-27 成员图。按 target-selection 代码顺序追加后，
本节当前清单合计 97 个唯一国家命令。

公开 `/api/countries` 的部署前快照只有 175 国；与 178 国代码目录只读对比后确认缺少
LIE、SGP、MLT。LIE/SGP 均已有更早批次签核的完整 fixture（LIE：2 regulations / 80 limits；
SGP：2 regulations / 40 limits），不是本轮新研究结论；本次只追加两条定向同步命令，
MLT 则按 #260 新增目录、1:10m 几何和 EU 成员关系。发布后公开目录必须达到 178 国。

以下代码必须在 §4.2 保留的同一 VPS shell、同一 `release_dir` 中执行。维护锁 wrapper
使用 PostgreSQL advisory lock 覆盖整个子进程生命周期；拿不到锁即失败关闭，持锁期间管理
后台或另一发布进程不得并行治理写入。子 shell 的 `ERR`、`INT`、`TERM`、`HUP`、`EXIT`
trap 会在
任一国家发布或后续公开验收失败/中断时，只执行一次已校验的 `snapshot_path` /
`snapshot_sha256` 事务恢复并以非零状态停止；恢复输出也必须进入发布记录。97 国写入、公开
目录计数、97 个国家页面和代表性语义读回全部成功后，子进程才把 0600
`RECOVERY_REQUIRED` 在同一状态目录原子重命名为 0600 `PUBLISH_COMMITTED`；这次
rename 及其目录 `fsync` 是数据库与 host 之间唯一的跨域 commit point。commit 前任何失败都恢复旧快照，随后
把 `RECOVERY_REQUIRED` 原子持久迁移为 `HOST_ROLLBACK_REQUIRED`。外层随后必须重新取得同一
PostgreSQL maintenance lock 与新的 lifecycle-lock OFD，由状态机调用 restore-only host rollback
恢复旧环境、Nginx、`current` 和 PM2；rollback 始终保留 HOST marker。旧 host verifier 成功后，
状态机还要在同一 DB lock 内重新导出并深比较旧 snapshot、复核 `current=previous-release` 和 lock，
才原子持久迁移为永久 `HOST_ROLLBACK_COMPLETED` tombstone；任何阶段都不会先删除最后一份恢复事实。
commit 后即使 wrapper heartbeat 或父 shell 再失败，child trap 与 host trap 也都
禁止恢复旧状态，必须保留新应用 + 新治理图。`RECOVERY_REQUIRED` 覆盖无法捕获的 wrapper
`SIGKILL`、主机重启或连接会话丢失：出现该 marker 时不得开始下一次发布，必须由新维护锁
会话使用其中对应的 snapshot/SHA 完成人工恢复并重新验收。
此处 `DATABASE_URL` 必须直连 PostgreSQL 或使用 session pooling，不得指向 transaction
pooling 端点。同一应用 release 禁止改变该值；`prepare-release-runtime.sh` 会在任何 build/systemd/
activation mutation 前机器比较 pre-switch backup 与 live env，并 fsync rollback basis、live env
和父目录。状态机的 publish/finalize 及 active RECOVERY/HOST 阶段还会再次验证文件 metadata、
PostgreSQL 协议，并要求 pre-switch、live env 与 maintenance child 实际继承的 `DATABASE_URL`
三方解析值逐字节相等，固定错误不泄露 URL。COMPLETED terminal 不施加该历史值，
因此后续独立凭据轮换与新 release 不会重放旧恢复。wrapper 只启用一个连接，关闭 idle/max-lifetime 回收并以 15 秒 TCP keepalive
固定持锁会话；它每 10 秒核验 backend PID、两把 session advisory lock 的原持有状态及可重入/
平衡解锁结果。PID 变化、锁丢失、查询失败或 30 秒探针超时都会立即启动共享且幂等的 process-group
终止流程：先给独立 Unix process group 发送 `SIGTERM`，5 秒后仍存在则升级 `SIGKILL`，再用
5 秒证明整组为空；wrapper 的 HUP/INT/TERM、child `error` 与正常 `close` 复用同一流程，且必须
同时等到 direct child `close`。无法证明整组为空时禁止显式 advisory unlock，只关闭数据库
session 并失败；数据库写入 grandchild 不能在锁会话丢失后继续存活。
不要把 `DATABASE_URL` 或其他秘密拼入命令行。root 治理入口必须由 `env -i` 清除父 Shell 的同名或
陈旧变量，只显式注入 `HOME`、system-only root `PATH`、`NODE_ENV=production`、
`DATABASE_MODE=postgres`、非秘密 `release_id` 与固定值
`DIESEL_RELEASE_LIFECYCLE_LOCK_FD=8`，并以固定绝对 Node 执行 `--import tsx`；禁止在 root 治理入口或
它的数据库 child 上使用 Node `--env-file`。wrapper 的 `--database-env-file` 只接受本 release
已持久化的 pre-switch 环境备份：以 `O_NOFOLLOW` 打开，要求 `root:root` 0600、单链接、1 MiB
上限、稳定 metadata 与严格 UTF-8，再用 `parseEnv` 把它当惰性数据读取；只有经统一 schema 校验的
`DATABASE_URL` 会留在 wrapper 内存并进入精确 child allowlist。特权 child 只继承 HOME、
system-only root PATH；只有非特权应用 readback 才使用经过验证的 application PATH。两类 child
的其余 allowlist 只包含 production/postgres、release ID、FD 8、maintenance token 与可选安全知识存储子目录；
`BASH_ENV`、`ENV`、`SHELLOPTS`、`NODE_OPTIONS`、`NODE_PATH`、`LD_*`、`AI_*` 及其他服务秘密都不会
跨过边界。显式 production/postgres 值也确保恢复授权不能被开发/PGlite 分支旁路。维护锁内先扫描
`/opt/diesel/backups/**/RECOVERY_REQUIRED`、`HOST_ROLLBACK_REQUIRED` 与
`PUBLISH_COMMITTED`，任意未收敛 marker 都会在
fresh 快照前失败关闭。历史普通 `PUBLISH_FINALIZED` 是不可逆提交账本，不阻塞其他 release，
历史普通 `HOST_ROLLBACK_COMPLETED` 是恢复完成账本，同样不阻塞其他 release；但同一 release
不得再次发布，任何 ledger symlink 或冲突组合仍会失败关闭。
host orchestrator 在建立任何本次备份前，以固定 FD 8 持有 root-only 的
`/opt/diesel/.release-lifecycle.lock`，并跨 host activation、治理 wrapper 与 finalization 保持
同一 inode。锁文件只允许一次性 noclobber 创建，之后绝不能 replace/unlink。wrapper 显式把
FD 8 映射给 detached child；PM2 与所有可能长期存活的进程都关闭 FD 8。错误 trap 在调用
rollback 前只关闭自己的 FD（绝不对共享 open-file-description 执行 `flock -u`）并清除 capability，
让 rollback 以新 descriptor 竞争同一 inode；若 orphan 治理 child 仍存活，rollback 必须因拿不到锁
失败关闭，而不能与它并发恢复。
版本化的 `scripts/deploy/governance-publication-state-machine.sh` 是治理发布状态机的唯一
入口；`publish`、`recover-required` 与 `finalize-committed` 都必须是
`with-governance-maintenance-lock.ts` 的直接 child，不能再用 heredoc 或中间 shell 拼装状态机。
orchestrator、controller、prepare、activation、governance 与 rollback 六个生产 CLI 都只接受完整小写 40 位
SHA，并在首次 source 版本化代码前绑定参数指定的
`/opt/diesel/releases/<sha>/scripts/deploy/...` 绝对入口；worktree、相对路径、`current` 别名或其他
release 均失败关闭。每个入口都先用不依赖 sibling 的 bootstrap validator 验证 `/opt`、deploy/
releases、目标 release、scripts/deploy 目录链，以及自身和将被 source 的 ledger/helper 为 canonical、
非 symlink、root-owned、不可写且单链接。controller 与 prepare 容许 rsync 后的 staged
`root:root:755` 或 retry 的 normalized `root:diesel:750` executable；受支持的 production direct
activation 发生在 prepare 后，只接受 normalized 状态，并在其合法 source rollback 前同时验完
rollback 与 rollback 将加载的 ledger。
controller 在尚未执行 ledger、因而无法严格分类 commit 边界时返回 75 保留现场；其余入口的
bootstrap 拒绝返回 70。隔离 fixture 可调用同一 sourceable bootstrap seam，但生产 CLI 的 deploy
root 固定为字面量 `/opt/diesel`，不接受环境或额外参数覆盖。脚本被 source 后再显式调用 controller、
prepare 或 activation 的三个 bootstrap 函数时，字面量生产 root 会以 64 拒绝；五个 primary
runtime/state-machine seam 也拒绝字面量生产 root。
上述 guard 与 controller 的 `run_prepare`、`run_activate`、`run_governance_mode` 三个实际 child runner
还会拒绝重复/尾随斜杠形式，以及在固定 `/usr/bin/realpath -e` 下已存在且解析到 `/opt/diesel` 的 alias；
alias 分类除该固定 realpath 外仍先于 bootstrap metadata/path validator 和后续 dependency source。
这些检查只减少测试接口的误用：显式 bootstrap guard 不会把最初 source 动作本身变成 pre-source
trust proof，Bash helper/变量也不私有，root/source caller 可以重定义或直接调用内部函数。脚本最初
作为库被 source 时会传播相邻 sibling 的原始非零状态；source 后显式调用 bootstrap 时，controller
将 dependency source 失败映射为 75，prepare/activation 映射为 70。source 不是 shell capability；
受支持的生产路径必须始终使用上方 clean-env orchestrator direct CLI。
orchestrator 在任何本次 state 目录或 FD 8 生命周期之前，用不加载 sibling 的 bootstrap
验证完整目录链、自身及其余六个版本化 executable、maintenance wrapper 与
SHA-bound root-only candidate 的 staged/normalized metadata。内容来源继续由更早的 commit input
manifest、传输后 digest 读回和 root-owned 不可写交接承担。脚本内检查只约束已打开
entry 之后的 metadata 与 sibling source 边界，不是 entry 的自签名；也不防并发 root 修改、
旧可写 FD 或底层文件系统失信。
64 位 token 的格式本身不是授权；版本化的
`scripts/db/assert-governance-maintenance-lock.ts` 会在 publish commit、recovery phase 迁移及
finalize 状态迁移紧前，以只读事务证明该 token 对应的 session advisory lock 仍由 wrapper
持有。伪造 token、锁丢失或连接漂移一律在 marker 变更前失败关闭。
它的共享 marker/snapshot parser 会失败关闭：拒绝 symlink、非 `root:root:600` marker、
多行 marker、偏离 `/opt/diesel/backups/<release-id>/governance-before.json` 的路径，以及
snapshot SHA-256 不匹配；snapshot、validator、marker 与每次 marker rename 都在返回前
完成文件/目录 `fsync`。版本化的 `validate-public-governance.sh` 仍会在快照建立前复制为该
release 专属的 root-owned 0700 脚本；正常发布和 `finalize-committed` 复用同一份不可变副本。
当前/旧 release verifier 都由 `runuser -u diesel` 在只有 `HOME`/固定 `PATH` 的 `env -i`
环境中执行；保存的公开 validator 也不继承数据库/模型秘密或维护 token。需要复用 lifecycle
锁的 host committed validator 使用专用 allowlist，只额外保留固定 FD 8 capability，避免父进程
持锁时自我死锁。
`recover-required` 使用发布前 snapshot 的 v4 十表深比较契约，不要求恢复后的旧状态满足
post-publish 覆盖数。遇到 `RECOVERY_REQUIRED` 时先恢复并深比较数据库，再 durable 转为
`HOST_ROLLBACK_REQUIRED`；遇到后者时先重新导出并深比较，证明数据库已经是旧快照。随后只能
调用对应 release 的 versioned restore-only host rollback，把 `current`、环境、Nginx 与 PM2
收敛到持久化的 `previous-release`，以旧 release verifier 读回；rollback 不移动 ledger。状态机
在 host 后进行第二次 DB 深比较和 lock/current 复核，最后才 durable 转为
`HOST_ROLLBACK_COMPLETED`。COMPLETED 是恢复完成时点的 terminal 审计事实：后续合法治理写入或
新 release 不会触发旧 snapshot/host 重放；重复命令只严格解析并重新 fsync tombstone 后返回。
`finalize-committed` 对 V1 先把已存在的 `PUBLISH_COMMITTED` 原子重命名并 fsync 为
`PUBLISH_FINALIZED`，从而让其后的任意中断只能前向收敛；随后两次复用
`rollback-host-release.sh --validate-committed` 和已保存的完整公开 validator，并紧邻最终 host
迁移重新验证 `current`/maintenance lock，最后才把 PENDING 改名为 COMMITTED。若已是
`COMMITTED:PUBLISH_FINALIZED`，显式 finalize 仍重跑当前 host/public/current/lock 验收，只跳过
两次 rename；历史 terminal 的全局扫描则只解析/fsync 账本，不把旧 release 重新施加给当前 host。
任何失败都保留新 host、新数据库和 committed/finalized marker，供修复后重试。
刚完成 rsync 的版本化输入保持 `root:root` 0644/0755；controller 的 publication preflight 只接受
目录/可执行的 `root:root` 0755 或 `root:diesel` 0750，以及普通文件的对应 0644/0640 精确二态，
文件还必须单链接。controller 的 executable inventory 包含 prepare、activation、rollback、
governance、ledger 与 controller 自身；preparer 在递归规范化前对 entry 与将被 source 的 ledger
执行同一精确二态检查，随后
执行既有 `chown -hR root:diesel` / `chmod -R u=rwX,g=rX,o=`，并在启动 builder/systemd 前复验
ledger、build script 与 manifest helper 等关键执行输入的 normalized metadata。fixture 通过受控
`stat/chown/chmod` seam 模拟该转换顺序；非 root 本地测试不声称完成真实 owner 变更。
controller 在 publication 当下先用绝对 `/usr/bin/stat`/`realpath` 与 Bash `EUID` 验证 `/opt`、固定
Node 目录链、Node binary、`/usr/local` 命令目录、单链接及 `v22.22.3`，不能让尚未验证的 Node/local
PATH 反过来伪造 bootstrap proof。root controller/preparer 之后只从 system PATH 解析宿主命令；
固定应用 PATH 仅作为非特权 builder/runtime/verifier child，或期望状态校验的显式环境。activation 与 governance 的
生产 CLI 也在 source/业务命令前建立相同目录与 Node 边界。poison-marker fixture 进一步证明
entry/helper/ledger 任一验证失败时都不会执行 sibling 顶层代码，并以全通过分支证明 source 发生在
最后一次依赖验证之后。
版本化 `release-publication-controller.sh` 在 publish wrapper 无论以零或非零返回后，都调用共享
ledger parser 校验 owner/mode、单链接、marker payload、snapshot hash 与 host/governance 封闭组合；
normal path 不再用裸 `[ -e marker ]` 猜测 commit。publish 非零但 strict ledger 已是
`PENDING:PUBLISH_COMMITTED`、`PENDING:PUBLISH_FINALIZED` 或
`COMMITTED:PUBLISH_FINALIZED` 时，controller 必须按已提交处理并调用幂等
`finalize-committed`；publish 零退出却仍是 pre-commit 组合属于协议违例。若 marker
冲突、symlink、内容漂移或其他原因使 commit 边界无法严格分类，controller 返回专用
75；这不是提交成功声明。

orchestrator 只接受 controller 的三类结果：0 表示 controller 已严格读回
`COMMITTED:PUBLISH_FINALIZED`，75 表示解除自动 rollback、关闭 FD 8 并保留现场前向
修复，其他状态才会按 strict ledger 决定直接 host abort 或取得新 maintenance/lifecycle
locks 执行 `recover-required`。在 recovery marker 存在时绝不并发猜测或降级成直接
host rollback；commit-shaped、未知或 ledger 无法读回的状态一律返回 75。主机回滚失败
使整次发布以 70 停止。普通非零失败归一为 70；可捕获的 HUP/INT/TERM 分别保留为
129/130/143，活动 child 的 137 退出形状也在安全回滚成功后保留。controller 已收敛为 0 或 75 时，其 strict
terminal/preserve 结果优先于并发到达 orchestrator 的可捕获信号。

orchestrator 的 parent-only HUP/INT/TERM trap 会把首个信号确定性转发给活动 child
process group，并在 child spawn 后到 PID 登记间的窗口补做转发；trap 与登记后补发共用单条
Bash arithmetic claim，先执行的一方把计数从 0 改为 1，另一方只能观察后续值，因此不会重复
转发。之后等待 child 结束并
重读 strict ledger，不会让外层 Bash 先退出而丢失 75 分类。每个失败 cutoff、
parent-only signal、controller 0/75/其他状态、恰好一次 rollback、FD 关闭顺序和无秘密输出
均有动态回归。`SIGKILL` 或主机掉电仍不可捕获，依赖 durable ledger 与恢复手册。
publish 与 finalize 仍是两个独立 PostgreSQL maintenance session；controller 与 orchestrator
缩小并固定编排面，但不宣称消除两个 session 之间的锁释放窗口，也不改变唯一跨域
commit point。

```bash
set -euo pipefail
release_id="<与工作站相同的完整 release-id>"
[[ "${release_id}" =~ ^[0-9a-f]{40}$ ]]
release_dir="/opt/diesel/releases/${release_id}"
root_system_path="/usr/sbin:/usr/bin:/sbin:/bin"
candidate_path="/opt/diesel/release-inputs/${release_id}/env.production.local"
orchestrator_path="${release_dir}/scripts/deploy/host-release-orchestrator.sh"

command /usr/bin/env -i \
  HOME=/root \
  LANG=C \
  LC_ALL=C \
  PATH="${root_system_path}" \
  /usr/bin/bash --noprofile --norc -- \
    "${orchestrator_path}" "${release_id}" "${candidate_path}"
```

若 controller / wrapper 被 `SIGKILL`、主机重启或 session heartbeat 失败而留下
`RECOVERY_REQUIRED` 或 `HOST_ROLLBACK_REQUIRED`，先停止管理写入，
在对应 release 目录执行下列恢复。恢复目标是发布前快照，不能套用发布后的 178 国/97 国
`covered` 验收；同一新维护锁会话必须在 restore 后重新导出 v4 十表快照，并对原 snapshot 的
`tableCounts` 与 `tables` 做深比较。状态机随后必须读取持久化的 `previous-release`，调用失败
release 自带的 versioned rollback，把 host 收敛到该旧 release，并以旧 release 的
`verify-release.sh` 做安全读回。全部成功后才把 required marker 原子迁移为永久
`HOST_ROLLBACK_COMPLETED`；任一步失败都保留 required/completed 恢复事实。若进程在 DB 恢复后
中断，重跑会从 `HOST_ROLLBACK_REQUIRED` 重新证明旧 DB；若在完成迁移后中断，COMPLETED 只作为
terminal 审计账本严格解析/fsync，不会因后续合法 DB 或 host 变化重放旧状态：

```bash
set -euo pipefail
release_id="<marker 对应的 release-id>"
[[ "${release_id}" =~ ^[0-9a-f]{40}$ ]]
release_dir="/opt/diesel/releases/${release_id}"
governance_database_environment="/opt/diesel/backups/${release_id}/env.production.local.pre-switch"
root_system_path="/usr/sbin:/usr/bin:/sbin:/bin"
node_binary="/opt/node-v22.22.3-linux-x64/bin/node"
export PATH="${root_system_path}"
for runtime_directory in \
  /opt /opt/node-v22.22.3-linux-x64 \
  /opt/node-v22.22.3-linux-x64/bin; do
  test -d "${runtime_directory}"
  test ! -L "${runtime_directory}"
  test "$(/usr/bin/realpath -e -- "${runtime_directory}")" = "${runtime_directory}"
  test "$(/usr/bin/stat -c '%u:%g:%a' -- "${runtime_directory}")" = "0:0:755"
done
test -f "${node_binary}"
test ! -L "${node_binary}"
test "$(/usr/bin/stat -c '%u:%g:%a:%h' -- "${node_binary}")" = "0:0:755:1"
test "$("${node_binary}" --version)" = "v22.22.3"
test -d "${release_dir}"
test -f "${release_dir}/.deploy-ready"
test -f "${governance_database_environment}"
test ! -L "${governance_database_environment}"
test "$(stat -c '%U:%G:%a:%h' "${governance_database_environment}")" = "root:root:600:1"
cd "${release_dir}"
release_lifecycle_lock_path="/opt/diesel/.release-lifecycle.lock"
test -f "${release_lifecycle_lock_path}"
test ! -L "${release_lifecycle_lock_path}"
test "$(stat -c '%U:%G:%a' "${release_lifecycle_lock_path}")" = "root:root:600"
exec 8<>"${release_lifecycle_lock_path}"
flock -n 8
export DIESEL_RELEASE_LIFECYCLE_LOCK_FD=8
governance_env=(
  /usr/bin/env -i
  HOME=/root
  PATH="${root_system_path}"
  NODE_ENV=production
  DATABASE_MODE=postgres
  DIESEL_RELEASE_LIFECYCLE_LOCK_FD=8
  release_id="${release_id}"
)
"${governance_env[@]}" "${node_binary}" --import tsx \
  "${release_dir}/scripts/db/with-governance-maintenance-lock.ts" \
  --database-env-file="${governance_database_environment}" -- \
  /bin/bash --noprofile --norc -- \
    "${release_dir}/scripts/deploy/governance-publication-state-machine.sh" \
    recover-required "${release_id}"
exec 8>&-
unset DIESEL_RELEASE_LIFECYCLE_LOCK_FD
```

若遗留的是 `PUBLISH_COMMITTED` 或 `PUBLISH_FINALIZED`，数据库与新应用已经越过 commit point；绝不能再执行上述
snapshot restore，也不能把 `current` 回指旧 release。只调用状态机的
`finalize-committed`。完成前置 metadata、数据库身份与 marker 检查后，它先把
`PUBLISH_COMMITTED` 原子重命名并 fsync 为 `PUBLISH_FINALIZED`；随后复用 host rollback 脚本的
无副作用 committed 验证、运行发布时保存的完整公开 validator，并紧邻最终 host 状态迁移再次
验证 current、maintenance lock、host 与 public。全部通过后最后才把 host `PENDING` 原子迁移为
`COMMITTED`。因此 `PENDING:PUBLISH_FINALIZED` 表示尚未完成验收、但 commit 已不可逆，只能前滚；
已 finalized/terminal 时会幂等重验并只跳过已完成的 rename。验证失败则保留当时已有的 marker，
并修复/前滚新 host 后重试，禁止恢复旧快照。该操作也必须在新的维护锁会话中执行：

```bash
set -euo pipefail
release_id="<commit marker 对应的 release-id>"
[[ "${release_id}" =~ ^[0-9a-f]{40}$ ]]
release_dir="/opt/diesel/releases/${release_id}"
governance_database_environment="/opt/diesel/backups/${release_id}/env.production.local.pre-switch"
root_system_path="/usr/sbin:/usr/bin:/sbin:/bin"
node_binary="/opt/node-v22.22.3-linux-x64/bin/node"
export PATH="${root_system_path}"
for runtime_directory in \
  /opt /opt/node-v22.22.3-linux-x64 \
  /opt/node-v22.22.3-linux-x64/bin; do
  test -d "${runtime_directory}"
  test ! -L "${runtime_directory}"
  test "$(/usr/bin/realpath -e -- "${runtime_directory}")" = "${runtime_directory}"
  test "$(/usr/bin/stat -c '%u:%g:%a' -- "${runtime_directory}")" = "0:0:755"
done
test -f "${node_binary}"
test ! -L "${node_binary}"
test "$(/usr/bin/stat -c '%u:%g:%a:%h' -- "${node_binary}")" = "0:0:755:1"
test "$("${node_binary}" --version)" = "v22.22.3"
test -d "${release_dir}"
test -f "${governance_database_environment}"
test ! -L "${governance_database_environment}"
test "$(stat -c '%U:%G:%a:%h' "${governance_database_environment}")" = "root:root:600:1"
cd "${release_dir}"
release_lifecycle_lock_path="/opt/diesel/.release-lifecycle.lock"
test -f "${release_lifecycle_lock_path}"
test ! -L "${release_lifecycle_lock_path}"
test "$(stat -c '%U:%G:%a' "${release_lifecycle_lock_path}")" = "root:root:600"
exec 8<>"${release_lifecycle_lock_path}"
flock -n 8
export DIESEL_RELEASE_LIFECYCLE_LOCK_FD=8
governance_env=(
  /usr/bin/env -i
  HOME=/root
  PATH="${root_system_path}"
  NODE_ENV=production
  DATABASE_MODE=postgres
  DIESEL_RELEASE_LIFECYCLE_LOCK_FD=8
  release_id="${release_id}"
)
"${governance_env[@]}" "${node_binary}" --import tsx \
  "${release_dir}/scripts/db/with-governance-maintenance-lock.ts" \
  --database-env-file="${governance_database_environment}" -- \
  /bin/bash --noprofile --norc -- \
    "${release_dir}/scripts/deploy/governance-publication-state-machine.sh" \
    finalize-committed "${release_id}"
exec 8>&-
unset DIESEL_RELEASE_LIFECYCLE_LOCK_FD
```

上述 97 个唯一国家命令已于 2026-08-12 在 release `20260812031745` 中执行：前 33 条属于 #166–#198（其中第 13 条 KEN 同时
发布 #200 的最新 source 图），第 34–35 条补齐 LIE/SGP 既有签核图的运行库目录缺口，
第 36 条执行 #199 的 MAR source-only refresh，第 37–40 条执行 #201–#204 的
QAT/KWT/OMN/JOR refresh，第 41–44 条执行 #205–#208 的 IRN/IRQ/LBN/SYR refresh，
第 45–79 条依序执行 #209–#243 的 35 国 source-currentness refresh；第 80–81 条执行
#244–#245 的 AUS/PNG 完整性发布，第 82–93 条执行 #248–#259 的十二国双源刷新，
第 94–95 条执行 #246–#247 的 CAN/USA 完整性发布，并包含 ADR-136 的六功率带及
ties-to-even raw 查询端点纠错（560/560.001/560.500 kW 同属最高带，560.501 kW
无结果）；
第 96–97 条执行 #261 CHN 与 #260 MLT 的完整图发布。ARE 的第 8 条命令同时
应用 ADR-136 的 `2027-07-01` 通用 numeric 边界。
五国新增来源的 `verifiedAt` 为 `2026-08-10T17:38:18Z`；MAR/KEN 刷新来源的
`verifiedAt` 为 `2026-08-10T18:48:04Z`；QAT/KWT/OMN/JOR 八条刷新来源也统一为
该时刻；IRN/IRQ/LBN/SYR 八条刷新来源统一为 `2026-08-10T18:55:45Z`。#209–#243
七批来源的 `verifiedAt` 依次为 `2026-08-10T19:36:45Z`、
`2026-08-10T19:46:12Z`、`2026-08-10T20:09:01Z`、`2026-08-10T20:20:37Z`、
`2026-08-10T20:39:16Z`、`2026-08-10T20:50:58Z`、`2026-08-10T21:00:43Z`。
最终定向/full selection 闭包为
`97 jurisdictions / 28 regulations / 651 limits / 203 sources`。本次发布已完成目标库、
公开 API/页面与覆盖状态读回。

#### 2026-08-12 生产执行记录

- release：`20260812031745`；Git：`a779901`；当前软链接、内部/公网 health 均返回该版本。
- governance v3：fresh snapshot、SHA dry-run、serializable `--apply` 恢复演练、第二份
  snapshot 深比较、97 国逐项发布与目标图/scope 验收全部通过；跨域 commit marker 已
  原子提交；该历史执行发生在 durable finalized tombstone 协议引入前，因此当时在公开验收后
  清理，未遗留 `RECOVERY_REQUIRED` 或 `PUBLISH_COMMITTED`。当前流程不得照此删除提交事实。
- 公网：178 个唯一国家目录当时均返回 `covered`；该字段只表示已发布的目录/证据边界，
  不表示 178 国均有数值法规。97 个本轮目标国家页面/API 与代表性法规语义通过；CHN
  当时 3 条有效法规（含保留 Demo）及 CN-MEE/HJ 1014 来源链读回正确。
- 运行：应用由 `diesel` uid 执行，Nginx 与 PM2 持久化检查通过；多模态边界及真实视觉
  流式请求通过。共享环境文件仍为 root 管理的 0640 普通文件，未输出任何秘密。

#### Superseded 历史操作说明（保留审计文本；非当前生产状态、不得执行下方历史样例命令）

新增国家法规或来源边界时使用 ISO 3166-1 alpha-3 参数，只发布该国家依赖的来源、
辖区成员关系、可用法规、限值和覆盖状态，并运行聚焦验收：

```bash
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=NGA

# 只有官方来源、没有可发布限值的国家分别定向发布
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=EGY
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=GHA
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=ISR
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=PAK
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=QAT
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=KWT
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=OMN
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=JOR
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=KHM
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=LAO
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=LKA
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=MNG
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=CRI
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=ECU
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=DOM
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=DZA
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=TUN
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=ETH
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=GTM
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=HND
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=PAN
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=URY
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=ZMB
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=ZWE
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=RWA
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=CIV
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=CMR
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=SEN
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=MOZ
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=SWZ
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=LSO
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=MDG
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=MUS
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=MWI
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=FJI
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=BLZ
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=BRN
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=BTN
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=CAF
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=COD
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=COG
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=CUB
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=JAM
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=LBN
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=LBR
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=LBY
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=PRK
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=PRY
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=PSE
pnpm exec tsx --env-file=.env.local scripts/db/ingest-accepted-fixtures.ts --country=SDN
```

参数由 Zod 校验；`--country` 不能重复、不能与 `--market-only` 同用，目标国家必须已有
目录和完整辖区成员关系。存在法规时每条法规必须有至少一条限值；没有法规时发布后会
验证四个 scope 均为 no-data。该模式不绕过未来核验时间校验，也不会处理其他国家，
因此一国的合法记录不会被无关的未来日期阻断。

> **Superseded 历史发布记录**：以下 2026-08-09/10 叙述保留用于审计轨迹，不能证明
> #166–#243 当前 accepted 事实已进入生产。尤其 DZA、ETH、NGA 的旧 numeric 结论与
> RWA/PHL/SAU/ARE/ZAF/ISR 的旧 no-data 结论均已被 ADR-126 覆盖；KHM/LAO/LKA/MMR/MNG
> 的旧日期或发布状态已被 ADR-127 覆盖；MAR/KEN 的旧 source currentness 已被
> ADR-128 覆盖；QAT/KWT/OMN/JOR 的旧 portal/source 组合已被 ADR-129 覆盖；
> IRN/IRQ/LBN/SYR 的旧 source 组合与证据表述已被 ADR-130 覆盖。本轮仅以本节的
> “当前待执行清单”为部署指令；#209–#243 的 35 国 current source 与 URY 日期纠错
> 由 ADR-131 覆盖，仍未进入生产。

2026-08-09 已按上述流程完成 CRI、ECU、DOM、DZA 的 Supabase 定向发布与公开站读回。
CRI、ECU、DOM 均发布精确官方来源边界并保持四个 scope no-data；DZA 发布 1 条现行法规、
28 条车辆级限值。四国目标图、覆盖状态与聚焦验收均通过，公开 API 返回 `available` /
`covered`，`/countries/CRI`、`/countries/ECU`、`/countries/DOM`、`/countries/DZA`
均返回 HTTP 200。

2026-08-10 已完成 TUN、ETH、GTM、HND、PAN、URY 的 Supabase 定向治理发布与公开站
读回。TUN/GTM/HND/PAN 发布精确来源边界并通过四 scope no-data 验收；ETH 发布
Directive 1051/2025 / ES 6725:2022 及 3 条 N2/N3 限值；URY 发布 Decreto 135/021
及卡车/客车共 18 条 ESC/ETC 限值。六国目标图与 `covered` 状态全部通过，公开国家
API 均返回 `available`；ETH/URY 返回对应现行法规，六个 `/countries/{ISO3}` 页面均
返回 HTTP 200。

2026-08-10 已完成 CMR、SEN、MOZ、SWZ 的 Supabase 定向治理发布与公开站读回。四国
均发布精确官方来源边界，通过目标图、`covered` 和四 scope no-data 验收；公开国家
API 返回 `available`、统一核验时间 `2026-08-10T04:26:52Z` 与新来源链，四个
`/countries/{ISO3}` 页面均返回 HTTP 200。当前公开材料不足以发布新重型发动机数值，
因此四国 `currentEffectiveRegulations` 均为空是预期结果，不是发布遗漏。

2026-08-10 已完成 LSO、MDG、MUS、MWI 的 Supabase 定向治理发布与公开站读回。四国
均通过目标图、`covered` 和四 scope no-data 验收；公开国家 API 返回 `available`、
统一核验时间 `2026-08-10T04:44:14Z` 与八条精确来源，四个 `/countries/{ISO3}` 页面
均返回 HTTP 200。MUS 在远程目录中尚不存在，首次运行于两条来源发布后按活跃父记录
校验失败；定向脚本现会对缺失的静态目录国家先用治理流程发布 `planned`，完整目标图
成功后才提升为 `covered`，幂等重试通过。四国 `currentEffectiveRegulations` 为空是
已核验的法规边界，不是发布遗漏。

2026-08-10 已完成 FJI、BLZ、BRN、BTN 的 Supabase 定向治理发布与公开站读回。四国
均通过目标图、`covered` 和四 scope no-data 验收；公开国家 API 返回 `available`、
统一核验时间 `2026-08-10T05:06:30Z` 与八条精确来源，四个 `/countries/{ISO3}` 页面
均返回 HTTP 200。FJI 的 FRCS 进口法律解释/Euro 4 准入、BLZ 的部长后续规定、BRN/BTN 的适行性/在用车
HSU 数值均未升级为新发动机限值，故 `currentEffectiveRegulations` 为空是预期结果。

2026-08-10 已完成 CAF、COD、COG、CUB 的 Supabase 定向治理发布与公开站读回。四国
均通过目标图、`covered` 和四 scope no-data 验收；公开国家 API 返回 `available`、
统一核验时间 `2026-08-10T05:38:27Z` 与八条精确来源，四个 `/countries/{ISO3}` 页面
均返回 HTTP 200。项目柴油烟雾缓解、空气污染授权和车辆尾气/不透光度周期检查均未
升级为新发动机型式认证限值，故四国 `currentEffectiveRegulations` 为空是预期结果。

2026-08-10 已依次执行 `--country=DJI`、`--country=ERI`、`--country=GAB`、
`--country=GIN` 四次 Supabase 定向治理发布。四国均通过目标图、`covered` 和四 scope
 no-data 验收；公开国家 API 读回统一核验时间 `2026-08-10T06:21:10Z` 与八条精确
来源，`/countries/DJI`、`/countries/ERI`、`/countries/GAB`、`/countries/GIN` 均返回
HTTP 200。环境法中的一般义务/后续标准授权和车辆尾气、烟度、适行性检查均未升级为
新发动机型式认证限值，故四国 `currentEffectiveRegulations` 为空是预期结果。

2026-08-10 已依次执行 `--country=GMB`、`--country=GNB`、`--country=GNQ`、
`--country=GRL` 四次 Supabase 定向治理发布。四国均通过目标图、`covered` 和四 scope
no-data 验收；公开国家 API 读回统一核验时间 `2026-08-10T06:44:56Z` 与八条精确
来源，`/countries/GMB`、`/countries/GNB`、`/countries/GNQ`、`/countries/GRL` 均返回
HTTP 200。环境空气浓度、专门立法授权、内阁审议方案、目视/在用车检查与定性烟气
义务均未升级为新发动机型式认证限值，故四国 `currentEffectiveRegulations` 为空是
预期结果。

2026-08-10 已依次执行 `--country=GUY`、`--country=HTI`、`--country=IRN`、
`--country=IRQ` 四次 Supabase 定向治理发布。四国均通过目标图、`covered` 和四 scope
no-data 验收；公开国家 API 读回统一核验时间 `2026-08-10T07:34:48Z` 与八条精确
来源，`/countries/GUY`、`/countries/HTI`、`/countries/IRN`、`/countries/IRQ` 均返回
HTTP 200。后续车辆标准授权、适行性/进口检查、Euro 标签、当时未完整读回的法规日程、环境
空气/活动排放及车辆尾气监测职责均未升级为新发动机型式认证限值，故四国
`currentEffectiveRegulations` 为空是预期结果。

2026-08-10 已依次执行 `--country=JAM`、`--country=LBN`、`--country=LBR`、
`--country=LBY` 四次 Supabase 定向治理发布。四国均通过目标图、`covered` 和四 scope
no-data 验收；公开国家 API 读回统一核验时间 `2026-08-10T07:58:42Z` 与八条精确
来源，`/countries/JAM`、`/countries/LBN`、`/countries/LBR`、`/countries/LBY` 均返回
HTTP 200。旧车型/进口车辆表、一般标准委托、政策材料、未公开法规汇编和车辆检查
授权均未泛化为当前新重型发动机型式认证限值，故四国 `currentEffectiveRegulations`
为空是预期结果。VPS 健康接口同时确认运行 `multimodal-20260810071517`，公网 `/chat`
服务端页面读回文件/图片入口与附件格式说明。

2026-08-10 已依次执行 `--country=MLI`、`--country=MMR`、`--country=MRT`、
`--country=NCL` 四次 Supabase 定向治理发布。四国均通过目标图、`covered` 和四 scope
no-data 验收；公开国家 API 读回统一核验时间 `2026-08-10T08:31:37Z` 与八条精确
来源，`/countries/MLI`、`/countries/MMR`、`/countries/MRT`、`/countries/NCL` 均返回
HTTP 200。在用车尾气/烟度检查、固定源/项目限值、框架法实施授权、环境空气监测和
车辆检查周期均未升级为新重型发动机型式认证限值，故四国
`currentEffectiveRegulations` 为空是预期结果。

2026-08-10 已依次执行 `--country=NER`、`--country=NIC`、`--country=PNG`、
`--country=PRI` 四次 Supabase 定向治理发布。四国均通过目标图与 `covered` 验收；
NER/NIC/PRI 四 scope no-data 通过，PNG 发布仅限 2012+、GVW >4,500 kg 柴油卡车的
ADR 80/03 代表路径 8 条，客车/工程/农业维持 no-data。公开国家 API 读回统一核验
时间 `2026-08-10T09:11:38Z`，仅 PNG 返回现行法规，四个 `/countries/{ISO3}` 页面
均返回 HTTP 200。工作树快照在 VPS 以版本 `country-20260810093046` 完成生产构建、
原子软链接切换和 PM2 reload；内网及公网 `/api/health` 均返回该版本与 `ok`，首页、
`/chat` 和四国页面均为 200，公网对话页读回文件选择入口及图片/PDF/文本接受类型。

2026-08-10 已依次执行 `--country=PRK`、`--country=PRY`、`--country=PSE`、
`--country=SDN` 四次 Supabase 定向治理发布。四国均通过目标图、`covered` 与四 scope
no-data 验收；公开国家 API 读回统一核验时间 `2026-08-10T09:48:06Z` 及八条精确
来源，PRK 不再包含韩国 `.go.kr` 来源，四个 `/countries/{ISO3}` 页面均返回 HTTP 200。
本批只更新运行库数据，现有网页代码会动态读取 PostgreSQL，因此无需再次构建或切换 VPS
版本；一般标准授权、车辆/进口检查与交通减缓政策均未升级为发动机型式认证限值，四国
`currentEffectiveRegulations` 为空是预期结果。

2026-08-10 已依次执行 `--country=SLB`、`--country=SLE`、`--country=SLV`、
`--country=SOM` 四次 Supabase 定向治理发布。四国均通过目标图、`covered` 与四 scope
no-data 验收；公开国家 API 读回统一核验时间 `2026-08-10T10:20:51Z` 及八条精确
来源，四个 `/countries/{ISO3}` 页面均返回 HTTP 200。本批只更新运行库数据，现有网页
代码会动态读取 PostgreSQL，因此无需再次构建或切换 VPS 版本；整车许可/检查、气候 KPI、
Euro 提案/情景假设、在用车 opacity 检查、后续标准授权和未来政策方向均未升级为新重型
发动机型式认证限值，四国 `currentEffectiveRegulations` 为空是预期结果。

2026-08-10 已依次执行 `--country=SSD`、`--country=SUR`、`--country=SYR`、
`--country=TCD` 四次 Supabase 定向治理发布。四国均通过目标图、`covered` 与四 scope
no-data 验收；公开国家 API 读回统一核验时间 `2026-08-10T10:54:10Z`、各自两条精确
边界来源及空的 `currentEffectiveRegulations` / `futureAdoptedRegulations`，
`/countries/SSD`、`/countries/SUR`、`/countries/SYR`、`/countries/TCD` 均返回
HTTP 200。本批只更新运行库数据，现有网页动态读取 PostgreSQL，因此无需再次构建或切换
VPS 版本；一般标准授权、复检设施、在用车/车队政策、噪声 homologation、清单排放因子
和未来减缓措施均未升级为新重型柴油发动机认证限值。

2026-08-10 已依次执行 `--country=TGO`、`--country=TLS`、`--country=TTO`、
`--country=TWN` 四次 Supabase 定向治理发布。四国均通过目标图和 `covered` 验收；
TGO/TLS/TTO 四 scope no-data 通过，TWN 发布 regulation `0464` 及道路卡车/客车各
16 条 WHSC/WHTC/WNTE 代表路径限值，共 32 条，工程与农业保持 no-data。公开国家 API
读回统一核验时间 `2026-08-10T11:21:32Z`、八条精确来源及台湾当前有效法规；
`/countries/TGO`、`/countries/TLS`、`/countries/TTO`、`/countries/TWN` 与
`/api/health` 均返回 HTTP 200。本批只更新运行库数据，网页动态读取 PostgreSQL，
无需再次构建或切换 VPS 版本；发布前完整 `lint`、`typecheck`、498 项测试和生产构建均
通过。另补齐四国在无参数全量 ingest 的 `coveredCountryIso3`，避免全量路径漏升覆盖状态。

2026-08-10 已依次执行 `--country=VEN`、`--country=VUT`、`--country=YEM`、
`--country=ATA`、`--country=ATF`、`--country=ESH`、`--country=FLK` 七次 Supabase
定向治理发布。VEN 发布 regulation `0465` 与道路卡车/客车各 5 条 fixture limit，共
10 条；生产读回进一步验证 1999-12-31 无结果、MY2000 归一化边界、85/85.001 kW 两侧
PM `0.612/0.36 g/kWh`、CO/HC/NOx 值、Directive 91/542/EEC 代表路径及两个非道路
scope 空结果。VUT/YEM 与 ATA/ATF/ESH/FLK 均通过四 scope no-data、精确来源图和
`covered` 验收；特殊地区只发布国际/属地治理边界，不推断主权归属。公开国家 API 读回
统一核验时间 `2026-08-10T11:58:54Z`、十条精确来源和预期法规状态，七个
`/countries/{ISO3}` 页面及 `/api/health` 均返回 HTTP 200。发布前最终 `lint`、
`typecheck`、506 项测试和生产构建均通过。本批只更新运行库数据，网页动态读取
PostgreSQL，因此无需重建或切换 VPS；健康接口继续运行 `country-20260810093046`。

2026-08-10 已完成 ARG、CHL、COL、ISL、IDN、MYS、NZL、NGA、NOR、PER、RUS、CHE、
GBR、VNM 共 14 国 accepted fixture 图的生产数据库同步。同步沿用各自既有签核的 source、
jurisdiction、membership、regulation/limit 与 no-data 边界，不重算限值、不改变代表路径，
也不因 `covered` 状态把空 scope 补成法规。本项是运行库数据同步；网页动态读取 PostgreSQL，
无需为相同代码重新构建或切换 VPS 版本。

2026-08-10 已完成 IND、PHL、SAU、ZAF、ARE 的生产定向治理发布。IND 同步已签核的
BS VI、CEV-IV/V 与 TREM-IV/V 图；PHL、SAU、ZAF、ARE 同步精确官方来源和四 scope
no-data 图。后四国的 `covered` 只表示来源边界已发布，不表示已取得完整的新重型柴油
发动机型式认证数值；不得从 DAO/GSO/SANS/ECE 引用、机械安全规则或标准目录补值。

2026-08-10 已完成 UKR、MDA 的生产定向治理发布。UKR 发布 Law No. 2739-IV / Order
No. 521 国内链与 `[2016-01-01, 2027-01-01)` Euro V B2 压燃机道路代表路径，卡车、
客车各 9 条，construction/agriculture no-data；2027-01-01 到达 Euro VI 法定门槛时
Euro V 记录停止，完整乌克兰 Euro VI 技术链发布前失败关闭。MDA 只发布 2026-07-01
主法 draft 公告与 2026-07-17 配套草案咨询，四 scope no-data，不创建 regulation。
两国来源实际核验时刻分别为 `2026-08-10T12:59:02Z`、
`2026-08-10T13:04:28Z`。

2026-08-10 已完成 THA、ALB、SRB、BIH、MKD、MNE、NPL 七次生产定向治理发布与
发布后验收。实际发布图为：
THA 自 2024-01-01 道路各 9 条；BIH 自 2019-06-01 道路各 12 条；MNE 自
2018-10-15、P>15 kW 道路各 16 条（schema 边界 15.001 kW）；NPL 自
2025-06-23、GVW >3,500 kg 道路各 16 条；ALB/SRB/MKD 四 scope no-data，四个道路
法规国家的 construction/agriculture 亦 no-data。七国目标图、`covered` 与定向查询均
通过；公网 `/api/countries/{ISO3}` 全部返回 `available/covered`，THA/BIH/MNE/NPL 各
显示 1 条当前有效法规，ALB/SRB/MKD 显示 0 条；七个 `/countries/{ISO3}` 页面均返回
HTTP 200。随后幂等重发 UKR/MDA，使生产签核时间分别刷新为
`2026-08-10T12:59:02Z` 与 `2026-08-10T13:04:28Z`。本次公开总表快照为 175 国：
156 `covered`、19 `no_data`。

2026-08-10 已依次完成 ARM、AZE、GEO、UZB、KAZ、TJK、KGZ、TKM、AFG、
AGO、BDI、BEN、BFA、BGD、BHS、BLR、BOL、MAR、KEN 最终 19 国的生产定向
治理发布（ACCEPTANCE #147–#165，ADR-124）。每国均通过目标图、`covered` 与
scope/date/power 语义验收；实际图为 20 个 jurisdiction、12 个 regulation、157 条
limit 与 40 个精确来源。ARM/BLR/KAZ/KGZ 道路各 9 条与农业四功率带，GEO 道路
各 9 条，UZB 仅农业 H 带 3 条，BGD/BOL 道路各 4 条，其余未闭合 scope 保持 no-data。

发布前审查修复了共享 EAEU 法域的替换语义：单国发布 regional/international
jurisdiction 时保留全部已签核成员，避免后发国家归档先前成员；公网读回确认 ARM、
BLR、KAZ、KGZ、RUS 五个 EAEU membership 均活跃，日期分别为 2015-01-02、
2015-01-01、2015-01-01、2015-08-12、2015-01-01。公开 `/api/countries` 返回
175 国、175 `covered` / 0 `no_data`；19 个详情 API、19 个 `/countries/{ISO3}` 页面、
首页与 `/api/health` 均返回成功。网页动态读取 PostgreSQL，本批无需重建或切换 VPS。

## 5. 性能、许可与可访问性基线（历史测量）

以下数字是 2026-07-30 至 2026-08-05 的带日期快照，不是当前运行库计数。最新目录、
几何、fixture 与公开站状态见 [STATUS.md](STATUS.md)。

- **客户端 bundle**：2026-08-05 已用 `next/dynamic` 将 MapLibre GL 拆为纯客户端
  按需 chunk，并通过页面 `react-loadable-manifest` 验证。拆分前地图 chunk 为
  1.40 MB / gzip 370 KB；拆分后为 1.04 MB / gzip 275 KB，且不再属于首页同步
  模块。地图数据 API 完成后加载该 chunk，期间显示固定高度的初始化状态，避免
  布局跳动。
- **地图数据（2026-07-30）**：`world-countries.geojson` 252 KB / gzip 约 92 KB（174 个
  ISO3 要素，仅保留 ISO3 + name 属性）；`world-countries-index.json`
  5.9 KB / gzip 1.7 KB。
- **数据库查询计划（2026-07-30，seeded PGlite，174 行目录）**：`listMapSummaries`
  约 1 ms（174 行排序 + 6 来源连接）；`findByIso3` 走 `countries_pkey`
  约 0.02 ms；市场指标走 `market_metrics_country_period_idx`；法规走
  `country_jurisdictions` 索引嵌套循环。无病态计划。生产 PostgreSQL 依赖
  autovacuum ANALYZE 维持统计信息（PGlite 无统计，计划器行数估计偏低但
  不影响本规模结论）。
- **生产依赖许可审计**（`pnpm licenses list --prod`）：全部为宽松许可
  （MIT 300 / ISC 27 / Apache-2.0 22 / BSD 系 16 / 0BSD、BlueOak、Unlicense、
  CC-BY-4.0、Python-2.0 等）；唯一 copyleft 为 `@img/sharp-libvips-*`
  （LGPL-3.0-or-later，既供 Next 图像优化，也供聊天图片附件的服务端格式/尺寸核验与
  强制像素解码；原生二进制不进浏览器 bundle，自托管容器分发时按 LGPL 动态链接
  义务处理）。
- **可访问性**：键盘国家选择器、焦点管理与触控流程已被 Playwright 覆盖，首页与
  对话核心页在 Chromium/WebKit 执行 axe serious/critical smoke；完整人工键盘与
  屏幕阅读器审计仍是业务试点门。

## 6. 已知限制

- 开发、测试和作品 Demo 使用进程内固定窗口；生产强制 PostgreSQL 后端，以
  `(scope, key_hash, window_start)` 在共享数据库中原子维护 global + client 多实例配额。
  固定小时按 epoch 对齐；global 缺省 10000，两个值的合法范围都是 1–10000 且
  client ≤ global。数据库不可用时请求失败关闭，因而限流可用性与主数据库 readiness 一致。
- 生产小时桶的当前请求事务不执行 TTL 删除。成功判定后，每个 Node 进程至多每 60 秒异步
  启动一个回收事务；数据库只选择 `statement_timestamp()` 前已额外过期 10 分钟的最旧 500 行，
  并以稳定顺序和 `FOR UPDATE SKIP LOCKED` 删除。回收失败只写脱敏错误类型，不能把已算出的
  allow/deny 改为 503。发布后应监控 `api_rate_limit_buckets` 总行数、超过 grace 的 backlog、
  cleanup 错误和 autovacuum。required CI 的 `db:smoke:rate-limit-concurrency` 会在专用 loopback
  PG16 数据库上证明五个不同 backend session 的小时 global/client 竞争与回滚；本地工作区尚无
  该远端执行回执，且 cleanup `SKIP LOCKED`、极端热点吞吐与 backlog 清零仍待受控验证。cleanup
  仅是 retention，不参与 allow/deny，也不提供入口容量；global 小时
  上限现已约束成功请求以及每窗最多能创建的 client 桶，但拒绝洪泛、整点突发、cleanup 停摆和
  autovacuum 压力仍须监控，不能称为 DDoS 防护。按最大 global=10000 粗略摊平时，小时 client
  行的新增上界约为 167/分钟；若全部请求又是不同 client 的 model-bound 请求，UTC 日准入的独立
  client scope 最多再增加约 167/分钟，合计约 334/分钟，仍低于每进程 500 行/分钟的名义单批次
  能力；显式 300/hour 示例的对应合计约为 10/分钟。这只是容量算术，不保证 cleanup 能每分钟
  完成，也不是实际 PostgreSQL 吞吐或 backlog 清零证明。窗口键由应用实例时钟计算；多主机须
  保持时间同步，否则真实整点附近可能短暂分散到相邻窗口。
- 限流按 `x-forwarded-for` 首段识别客户端：无代理直连时客户端可伪造该头
  绕过按客户端限流。限流是滥用缓解，不是访问控制；公开部署必须位于可信
  代理之后。
- 只有先取得 admission lease 的 `POST /api/chat` 才访问共享限流桶；被应用并发门直接
  429 拒绝的请求不消耗持久小时配额。进入共享桶后，无论后续请求最终是否成功（包括
  400 与 503）都计数。这是有意设计：路由在解析/配置/审计之前先限流，以保护后续的
  数据库写入与模型调用。该事务固定先 global、后 client；global 满不创建或更新 client，client
  满会回滚 global 暂增，任一拒绝都不会提交 `limit + 1`。成功准入不退款，因此 AI 配置故障期间
  激进重试可能在修复后仍占用 global 或 client 配额至多一小时。运维须等待窗口滚动或通过受控
  配置变更同时维持 `AI_CHAT_RATE_LIMIT_PER_HOUR <= AI_CHAT_RATE_LIMIT_GLOBAL_PER_HOUR`。
  原始 client identity 不落库，仅其 SHA-256 摘要参与键；无代理部署时所有无头客户端共享
  `unknown-client` 的摘要桶。
- 小时限流通过且请求完成白名单/确定性分流后，只有 model-bound 请求才进入
  `estimated-provider-call-v1` 日准入。每次固定预留 5 个潜在 provider-call 单位；生产事务始终
  先锁 global、后锁 client，任一不足全部回滚，成功后永不退款。两个桶使用域分离哈希，原始
  client/IP 不落库；无可信代理时 per-client 边界仍可被伪造或退化成共享 `unknown-client`。
  该机制只闭包经过此 route 与此数据库的应用 attempt，不覆盖 provider 隐藏行为、其他 API
  key 消费者或旁路调用；当前也没有 requested-output/token/cost 预留，因此不能称 provider
  hard cap。发布必须同时设置
  `AI_CHAT_ADMISSION_GLOBAL_PROVIDER_CALL_UNITS_PER_DAY` 与
  `AI_CHAT_ADMISSION_CLIENT_PROVIDER_CALL_UNITS_PER_DAY`，并在 provider 侧保留独立消费上限。
- gitleaks 使用固定版本且只允许精确占位值；依赖门禁拒绝任一 critical、新 high
  或已过期 high 例外，机器登记与处置时限见 `docs/DEPENDENCY_SECURITY.md`。

## 7. 2026-08-13 历史代码发布记录

> 本节是带日期的历史记录，已被后续发布取代。当前生产 release ID 与 Git SHA
> 只在 [STATUS.md](STATUS.md) 的 machine-readable snapshot 中维护。

2026-08-13 已将 Git `832563d85ca42faf1bcf2fb26713224a088173e0` 版本化发布至
`/opt/diesel/releases/832563d85ca42faf1bcf2fb26713224a088173e0`。该提交相对此前在役
`379b138b377f710b92ed04741f49946acb1ec62e` 仅修改首页产品文案及其 E2E 断言；本次不含
Migration、fixture 或数据库写入，因此保留既有 PostgreSQL 治理图，未重跑 §4.3 的定向治理
发布。发布过程创建 0600 的环境/Nginx/旧 release 回滚备份，远端冻结安装和生产构建通过，
`current` 原子切换后 PM2 仅一个 `diesel-demo` 进程以 `diesel` uid 运行且零重启；内网与公网
`/api/health` 均返回目标 Git 版本。公网 `/`、`/map`、`/chat`、`/countries/CHN` 为 200，
`/api/countries` 返回 178 个目录记录且当时全部标为 `covered`；这里的 `covered` 仅是
目录/证据边界状态，不代表每国都有数值法规。首页新标题读回成功；IP 与 VPS 内部备用 Host
均 301 到 `https://jamesky.site`，未遗留 `RECOVERY_REQUIRED` 或 `PUBLISH_COMMITTED`。
