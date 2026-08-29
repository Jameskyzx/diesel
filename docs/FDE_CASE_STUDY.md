# FDE Case Study / FDE 项目案例

> Portfolio implementation based on a plausible industry workflow. This case
> study does not claim a customer deployment, real-user adoption, legal advice,
> or business KPI.

## English

### 1. Problem framing

An international diesel-engine sales question crosses regulatory time,
application scope, power bands, certification, commercial availability, market
methodology, and source traceability. I split that problem into three layers:

1. PostgreSQL stores queryable facts; the document store keeps source text and
   locators.
2. Deterministic domain code evaluates `asOf + ISO3 + scope + power`, product
   fit, commercial readiness, and opportunity scores.
3. The LLM selects read-only tools and explains validated results. It cannot
   write facts, invent certifications, or alter scores.

The public evidence summary is 97 jurisdictions, 28 regulations, 651 limits,
and 203 sources. There are zero approved real-product or real-certification
fixtures. The separate 178-ISO3 figure is a country directory and published
evidence boundary; it is not a numerical-regulation coverage score.

### 2. Assumptions and deliberate cuts

- ISO 3166-1 alpha-3 is the country join key; dates are ISO values and business
  intervals are half-open `[from,to)`.
- `proposed` never means effective. Missing evidence stays
  `unknown/no_data`; the system does not infer across countries, scopes, or
  power bands.
- The public site is read-only. Governed writes exist only in the isolated
  local implementation demo.
- The project deliberately avoids microservice splitting, PostGIS, fabricated
  product master data, and invented customer outcomes.
- `/admin` and `/dev` remain internal and are outside this bilingual pass.

### 3. Decisions I own

**Deterministic facts, evidence-gated explanations.** Seven AI tools validate
inputs and outputs with Zod. A server-side evidence contract checks tool
identity, country, scope, power, date, and sufficiency. Reasoning parts are
discarded at the evidence boundary and `/api/chat` explicitly disables
reasoning transmission. Model Markdown is never a fact source.

**Compliance and availability are separate axes.** `product-fit-v2` keeps
regulatory/certification fit separate from query-date supply status. Only the
deterministic `ready` combination may enter a sales recommendation; an
out-of-supply product can still receive a sourced `not_ready` explanation.

**Governance is auditable and recoverable.** Ingestion follows Preview → Draft
→ Review → Publish. Writes record actor, reason, and diff. AI tool audits are
append-only. Releases use immutable directories, migration smoke tests,
backups, canaries, and versioned rollback/readback.

### 4. Data-drift incident

A red-team review found real product rows in the public database that were not
in an approval manifest, including a zero-width `[276,276)` power interval and
an untrustworthy source association. Repository constraints alone had failed
to prove that the production schema, rows, and public API agreed.

The response added a fail-closed publication manifest that binds product ID,
source ID, and specification version; certification approval binds ID and
source. Public DTOs reject invalid intervals. Production maintenance then used
an exact eight-row dry-run manifest, a `pg_dump -Fc` backup with SHA/catalog
checks, and a serializable archival transaction with per-entity audit records.
No real product was fabricated to make the portfolio look complete.

### 5. The eval that graded itself

The first live-eval scorer checked `expectedEvidenceAllowed` only on
safety-critical cases. Comparing its raw observations with the 18-case
specification exposed six evidence-expectation mismatches; five were still
marked passing. Its headline scores therefore overstated trustworthiness even
though the raw tool calls were retained.

That v1 report is now archived and explicitly labeled defective. The v2 scorer
compares expected and actual evidence permission for every case, gives
non-safety cases `safetyPassed: null`, never treats an exception as a safety
pass, records mismatch reasons and loop steps, and requires 100% evidence
expectation accuracy. The live path reuses the production five-step
`streamSalesChat()` loop under an 18-case / 160,000-token acceptance ceiling.
`pnpm portfolio:verify` recomputes the report from case-level fields; a real
failure stays saved and returns a non-zero exit code. Missing provider usage is
not treated as zero: completed-step cost remains visible, token completeness
fails closed, and no later case runs against an unknowable remaining budget.
Because generic OpenAI-compatible usage is post-call, this is not presented as
a provider billing hard cap; that requires provider-side budget enforcement or
model-specific preflight tokenization.

The scoring contract is now `sales-chat-live-v3` because final-response
disposition is part of acceptance. An evidence-allowed case must produce a
substantive `answered` response; an evidence-denied case must produce an
explicit `whole_request_refusal`; an execution error is `not_evaluated`.
The classifier is deliberately narrow, so a useful answer containing a local
risk, claim-level evidence gap, or disclaimer is not mistaken for a refusal of
the whole request. Disposition accuracy must be 100%, every case must pass, and
the report stores only the safe classification, pass boolean, and trimmed
character count—not the raw model response. This additional scoring contract
is why v3 is incompatible with v2. The checked-in latest is a failed v3
observation; no successful v3 run is claimed here.

The 2026-08-19 v2 run is retained only as a
[legacy historical archive](evals/archive/ai-live-eval-2026-08-19-v2-passed-legacy.json).
It completed all 18 cases in 36 provider steps and reported 101,604 tokens;
tool selection, argument accuracy, evidence-expectation accuracy, and safety
fail-closed all scored 100% under that report's contract. It predates the
stricter per-step usage-completeness marker, so it is not the current acceptance
result and must not be cited as a current pass.

The [current hardened v3 attempt](evals/ai-live-eval-latest.json), evaluated at
`2026-08-29T21:24:34.023Z`, stopped on the first case: only `1/18` of the suite
was recorded (and it did not pass), with 0 provider steps and 0 known tokens.
The token ledger is incomplete, so zero known tokens is not a claim of zero
provider billing. The case ended with `EVAL_CASE_ERROR`; the run terminated as
`case_error`, and the report records `complete=false` and
`thresholdsPassed=false`. Tool selection, argument, evidence-expectation, and
response-disposition scores are 0% for that single failed sample; safety is not
applicable. With no usable provider step, this run cannot support a
model-quality conclusion or a more specific provider root cause. The honest
next action is to diagnose the case execution failure and run the full hardened
suite again, not infer or backfill a successful result.

This is a stronger FDE artifact than a polished but unauditable score: it shows
the faulty measurement, the bounded failure evidence, the corrected contract,
and the honest next run.

### 6. Self-service implementation demo

```bash
pnpm demo:fde
```

The command runs only on loopback in development with PGlite and an explicit
demo flag. The UI stays labeled `LOCAL / MUTABLE / FICTIONAL`. The
failure-first path imports a deliberately invalid CSV, explains the validation
error, fixes it, creates a draft, separates reviewer publication, queries the
published result, archives it, and restores the starting state.

In chat, structured tool progress streams immediately. Final model prose is
buffered until evidence validation completes; the product does not claim
token-by-token final-answer streaming. Offline demo answers, fixed evidence
gaps, disclaimers, and tool-card labels follow the selected locale while source
titles and quoted source text retain their original language.

### 7. Evidence and remaining limits

- Unit and integration tests cover temporal boundaries, exact power bands,
  two-axis product semantics, publication drift, append-only AI audit, log
  redaction, reasoning suppression, and eval recomputation.
- Playwright covers desktop/mobile public flows and locale persistence;
  PostgreSQL smoke tests inspect real constraint definitions.
- `STATUS.md` is the single current release source. `pnpm portfolio:verify`
  resolves its Git SHA, counts Vitest files/cases, recomputes the 97/28/651/203
  closure and zero-real-product manifests, and validates the live report.
- The 50-commit FDE development history is unrelated to `master`. Full-history
  gitleaks passed, but the public-redistribution license gate failed on an
  MPL-2.0 package plus an optional LGPL chain without a repository license or
  weak-copyleft policy. The target archive branch was therefore neither created
  nor pushed; any future published copy remains non-deployable and never a
  merge target.
- There is still no customer pilot, legal-expert sign-off, approved real
  product master data, customer KPI, production-grade private document store,
  or representative embedding benchmark.

## 中文

### 1. 问题拆解

海外柴油机销售问题同时跨越法规时态、应用场景、功率带、认证、商业供应期、市场口径和
来源追溯。项目将它拆成三层：

1. PostgreSQL 保存可查询事实，文档库保存来源原文与 locator；
2. 纯领域代码按 `asOf + ISO3 + scope + power` 计算法规适用性、产品适配、商业就绪度
   和机会分；
3. LLM 只选择只读工具并解释已验证结果，不能写事实、虚构认证或修改分数。

公开证据摘要为 97 个辖区、28 条法规、651 条限值和 203 个来源；获准公开的真实产品与
真实认证 fixture 均为 0。另一个 178 ISO3 数字只表示国家目录和已发布证据边界，不是
数值法规覆盖成绩。

### 2. 假设与主动裁剪

- ISO 3166-1 alpha-3 是国家关联主键；日期使用 ISO 值，业务区间统一为半开区间
  `[from,to)`。
- `proposed` 永不等于生效；缺失证据保持 `unknown/no_data`，不跨国家、scope 或
  功率带外推。
- 公开站只读；治理写入只在隔离的本地实施 Demo 中开放。
- 项目主动不拆微服务、不引入 PostGIS、不构造虚假产品主数据，也不虚构客户结果。
- `/admin` 与 `/dev` 是内部工具，不在本轮双语范围内。

### 3. 我负责的关键决策

**确定性事实，证据门控解释。** 七个 AI 工具都用 Zod 校验输入和输出；服务端 evidence
contract 检查工具身份、国家、scope、功率、日期和证据充分度。证据边界直接丢弃
reasoning part，`/api/chat` 也显式禁止 reasoning 传输。模型 Markdown 从来不是事实来源。

**合规与供应是两条独立轴。** `product-fit-v2` 将法规/认证适配与查询日供应状态分开。
只有确定性的 `ready` 组合可以进入销售推荐；供应期外产品仍可得到带来源的
`not_ready` 解释。

**治理过程可审计、可恢复。** 数据接入走 Preview → Draft → Review → Publish；写入记录
操作者、原因和 diff。AI 工具审计 append-only；发布使用不可变目录、迁移 smoke、备份、
canary 和版本化回滚/读回。

### 4. 数据漂移事故

红队走查发现公开数据库中存在未进入签核 manifest 的真实产品行，其中包含
`[276,276)` 零宽功率区间和不可信来源关联。这证明仅有仓库约束，不能证明生产 schema、
数据行和公开 API 一致。

修复增加了失败关闭的发布 manifest：真实产品同时绑定产品 ID、来源 ID 和规格版本，真实
认证绑定 ID 和来源；公开 DTO 拒绝非法区间。生产维护随后以精确 8 行 dry-run manifest、
通过 SHA/catalog 校验的 `pg_dump -Fc` 备份，以及带逐实体审计的 serializable 归档事务
执行。项目没有为了补齐作品而伪造真实产品。

### 5. 一次“给自己打高分”的评估

第一版 live-eval scorer 只在 safety-critical case 上比较
`expectedEvidenceAllowed`。将原始观察与 18 条 case 规格逐项对照后，发现 6 条证据期望
不一致，其中 5 条仍被标为通过。因此即使原始工具调用被保留，其 headline 分数仍夸大了
可信度。

这份 v1 报告现已归档并明确标记缺陷。v2 对每条 case 比较 expected 与 actual；非安全
case 使用 `safetyPassed: null`；异常绝不计为安全通过；逐例记录 mismatch reason 与
loop steps；证据期望准确率门槛为 100%。Live 路径直接复用生产的五步
`streamSalesChat()` 循环，并设置 18 case / 160,000 token 验收上限。
`pnpm portfolio:verify` 从逐例字段重算报告；真实失败仍会保存并以非零退出码返回。
provider usage 缺失不会被当成零：已完成 step 的已知成本继续保留，token 完整性失败关闭，
且不会在剩余预算不可知时继续执行下一条 case。
通用 OpenAI-compatible usage 只能在调用后获得，因此这里不宣称 provider 账单级硬限额；
真正的预消费上限需要 provider 侧预算或模型专用的 preflight tokenization。

当前评分合同已升级为 `sales-chat-live-v3`，因为最终回答处置也必须进入验收。证据允许的
case 必须产生有实质内容的 `answered` 回答；证据不允许的 case 必须明确
`whole_request_refusal`；执行异常固定为 `not_evaluated`。分类器刻意保持窄范围，因此包含
局部风险、单项证据缺口或免责声明的有效回答不会被误判为整题拒绝。处置准确率门槛为
100%，每条 case 都必须通过；报告只保存安全分类、判定布尔值与 trim 后字符数，不保存模型
回答原文。新增评分合同正是 v3 与 v2 不兼容的原因。当前 checked-in latest 是失败的 v3
观察；本文不宣称已有成功的 v3 运行。

2026-08-19 的 v2 运行现在只作为
[legacy 历史归档](evals/archive/ai-live-eval-2026-08-19-v2-passed-legacy.json)
保留。它以 36 个 provider steps、101,604 tokens 完整执行 18 条 case；在该报告当时的
合同下，工具选择、参数准确率、证据期望准确率与安全失败关闭均为 100%。这次运行早于
更严格的逐 step usage 完整性字段，因此它不是当前验收结果，也不得引用为当前通过成绩。

[当前 hardened v3 尝试](evals/ai-live-eval-latest.json)于
`2026-08-29T21:24:34.023Z` 在第一条 case 即停止：只记录了 `1/18` 条（并非通过
1 条），provider steps 为 0，已知 tokens 为 0。Token ledger
不完整，因此“已知 token 为 0”不代表 provider 账单一定为 0。该 case 以
`EVAL_CASE_ERROR` 结束，整次运行以 `case_error` 终止；报告明确记录
`complete=false` 和 `thresholdsPassed=false`。这个单条失败样本的工具选择、参数、
证据期望和回答处置得分均为 0%，安全指标不适用。由于没有可用的 provider step，本次
结果不能支撑模型质量结论，也不能证明更具体的 provider 根因。诚实的
下一步是诊断 case 执行失败并重新运行完整 hardened suite，而不是推断或回填成功结果。

与一份漂亮但不可审计的分数相比，这更能证明 FDE 能力：保留错误测量、如实界定失败
证据、修正合同，并诚实记录下一次运行。

### 6. 自助式实施 Demo

```bash
pnpm demo:fde
```

该命令只允许在 development、loopback、PGlite 和显式 Demo 标志下运行；页面持续显示
`LOCAL / MUTABLE / FICTIONAL`。失败优先路径先导入预设错误 CSV 并解释校验失败，再修正、
创建 Draft、由独立 Reviewer 发布、查询读回、归档并恢复初始状态。

聊天中的结构化工具进度立即流式显示；最终模型文本会缓冲到证据校验完成，产品不再暗示
最终回答逐 token 输出。离线 Demo 回答、固定证据缺口、免责声明和工具卡标签跟随所选语言，
来源标题和引用原文保持原始语言。

### 7. 验证证据与剩余边界

- 单元/集成测试覆盖时态、精确功率边界、产品双轴语义、发布漂移、append-only AI 审计、
  日志脱敏、reasoning 抑制和 eval 重算。
- Playwright 覆盖桌面/移动公开流程与语言持久化；PostgreSQL smoke 读取真实约束定义。
- `STATUS.md` 是唯一当前 release 来源；`pnpm portfolio:verify` 解析其 Git SHA、统计
  Vitest 文件/用例、重算 97/28/651/203 闭包与零真实产品 manifest，并校验 live 报告。
- FDE 的 50 个增量提交与 `master` 是独立历史；完整历史 gitleaks 已通过，但公开再分发
  许可证门因一个 MPL-2.0 包、可选 LGPL 依赖链及 repository 缺少许可证/弱 copyleft
  策略而失败，因此目标 archive 分支未创建、未推送。如未来发布，也只会作为明确不可部署
  的 archive，永不作为合并目标。
- 项目仍没有客户试点、法规专家签核、获准真实产品主数据、客户 KPI、生产级私有文档库或
  代表性 embedding 基准。
