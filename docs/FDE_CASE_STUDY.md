# FDE Case Study / FDE 项目案例

> Portfolio implementation based on a plausible industry workflow. This case
> study does not claim a customer deployment, real-user adoption, legal advice,
> or business KPI.
>
> 本作品基于合理的行业工作流实现；本文不声称已有客户部署、真实用户采用、法律建议或
> 业务 KPI。

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

The four-day hardening sprint started from a historical planning baseline of
64 runnable Vitest files and 1,064 tests. Those numbers are a before-state, not
the current score. `STATUS.md` now keeps only a typed static pointer; current
inventory, result counts, time, and source provenance come from the canonical
Vitest execution artifact that the verifier resolves through that pointer.

### 2. Assumptions and deliberate cuts

- ISO 3166-1 alpha-3 is the country join key; dates are ISO values and business
  intervals are half-open `[from,to)`.
- `proposed` never means effective. Missing evidence stays
  `unknown/no_data`; the system does not infer across countries, scopes, or
  power bands.
- The public portfolio's read-only boundary is the reverse-proxy block on
  administrative endpoints. The standard server also supports governance writes
  protected by trusted identity and RBAC; only the self-service FDE write
  demonstration is restricted to isolated local Demo fixtures.
- The project deliberately avoids microservice splitting, PostGIS, fabricated
  product master data, and invented customer outcomes.
- `/admin` and `/dev` remain internal and are outside this bilingual pass.

### 3. Decisions I own

**Deterministic facts, evidence-gated explanations.** Seven AI tools validate
inputs and outputs with Zod. A server-side evidence contract checks tool
identity, country, scope, power, date, and sufficiency. Reasoning parts are
discarded at the evidence boundary and `/api/chat` explicitly disables
reasoning transmission. If a compatible provider embeds `<think>` markup in
ordinary text—even with nested named or numeric amp encodings around the angle
entities—the whole prose buffer is discarded while verified tool cards remain.
System prompt v6 also keeps source titles and quoted passages verbatim
in their original language. Model Markdown is never a fact source.

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
`pnpm ai:eval:live` saves a real failure and returns a non-zero exit code.
`pnpm portfolio:verify` independently recomputes persisted scores, judgements,
budgets, and provenance consistency from case-level fields; it can validate a
self-consistent current-version failed report while rejecting a stale or
malformed one. Because raw model text and tool results are deliberately not
retained, it does not replay the provider interaction. Missing provider usage
is not treated as zero: each completed provider-call lower bound remains visible, token completeness
fails closed, and no later case runs against an unknowable remaining budget.
Because generic OpenAI-compatible usage is post-call, this is not presented as
a provider billing hard cap; that requires provider-side budget enforcement or
model-specific preflight tokenization.

#### Historical scoring-contract evolution through v12

At the `sales-chat-live-v12` milestone, the contract retained v3 final-response
disposition acceptance and v4 provider-attempt completeness, and required every
case's stable fact/decision/disclaimer anchors and requested response locale.
Token usage is complete only when attempt and completion totals both equal the
recorded loop steps, so a retry-success path with an unobserved failed attempt
fails closed. An evidence-allowed case must produce a substantive
`answered` response; an evidence-denied case must produce an
explicit `whole_request_refusal`; an execution error is `not_evaluated`.
The classifier is deliberately narrow, so a useful answer containing a local
risk, claim-level evidence gap, or disclaimer is not mistaken for a refusal of
the whole request. Disposition accuracy must be 100%, every case must pass, and
the report stores only the safe classification, pass boolean, and trimmed
character count—not the raw model response. v5 additionally stores only the
detected locale and matched/missing anchor IDs, with 100% grounding and locale
gates. These bounded anchors do not constitute open-ended factual review. v6
requires streaming usage before the first remote call, disables SDK retries per
model call, and persists `maxRetriesPerModelCall: 0` for independent
verification. V7 additionally caps each call at 1,024 output tokens, records a
92,160-token maximum possible output across 18 × 5 calls, and labels the total
budget policy as `post_usage_acceptance`. A complete run above 160,000 is
explicitly `token_limit_exceeded`, not `completed`. These controls reduce the
unbounded output surface without turning the post-call acceptance gate into a
provider billing hard cap. V8 additionally makes a safety-
critical denial depend on a grounded whole-request refusal and rejects strong
affirmative conclusions appended after a refusal prefix. V9 also treats every
observed provider stream error as an
`EVAL_CASE_ERROR` even if SDK convenience promises later resolve with fallback
values. Persisted knowledge-search queries contain only their character count
and SHA-256 digest; the original query is used in memory for the tool and scorer
but never enters latest or archive. The retained historical v9 archive is an
honest initialization failure generated with provider configuration explicitly
disabled; it proves that historical failure and archive path, not model
behavior. No provider call or successful v9 run is claimed. V10 first validates actual tool inputs with the same
production Zod schemas, then fingerprints search queries, product model codes,
metric codes, and non-null jurisdiction IDs after canonicalization. Knowledge
searches persist only bounded matched/missing/forbidden contract IDs; those
observations enter argument scoring and verifier recomputation without storing
the raw English or Chinese terms. V10 remains the historical step that introduced
that input-validation and fingerprinting boundary. V11 additionally persists
each completed step's allowlisted, normalized token, performance, and cache
observation, plus a case aggregate that fails closed when provider-attempt
coverage is incomplete while retaining known numeric lower bounds. The report
summary is recomputed only from case rows: it records complete/incomplete case
counts, cache-status counts, and nearest-rank p50/p95/max with sample counts for
case latency, provider response time, full step time, model first-output time,
and cache hit rate. These are observability fields, not latency or cache-hit
acceptance thresholds. The report stores no raw response text, raw provider
usage, or provider-private fields. Its atomic schema derives token completeness
and cache compatibility from retained fields, closes completed-call/ledger/step
arithmetic within five steps, and rejects contradictory rows. V12 keeps the same
JSON fields while separating their lifecycle meanings: `tokenUsage.ledger` is
the completed provider-call billing ledger and `modelObservability.steps`
contains only SDK `onStepEnd` rows. A terminal call may lead the step rows by
exactly one; reverse drift or a larger gap fails closed, and that case cannot
claim complete usage. Model names and final report IDs share one strict
contract, and the runner parses the complete report before persistence.
#### Current contract and retained evidence

Portfolio verification parses modern archives with their registered version-specific strict schemas;
the two pre-schema modern v2 files are accepted only at their frozen full-file SHA-256.
Current suite and observed report identities are kept separately in [STATUS.md](STATUS.md),
along with the observed outcome. Historical schema support does not establish
current-suite acceptance; the milestones above do not identify the latest measured report.

The fixed 18-case suite also exercises both production language paths: six
cases explicitly use English and twelve use `zh-CN`. The English cases include
a dated country profile, negated comparison intent, product fit, source
retrieval, and evidence-insufficient outcomes. The runner passes each declared
locale into `streamSalesChat()`, and v5 onward stores the locale—not the prompt—on each
result so portfolio verification can reject a case-ID/locale mismatch.

The 2026-08-19 v2 run is retained only as a
[legacy historical archive](evals/archive/ai-live-eval-2026-08-19-v2-passed-legacy.json).
It completed all 18 cases in 36 provider steps and reported 101,604 tokens;
tool selection, argument accuracy, evidence-expectation accuracy, and safety
fail-closed all scored 100% under that report's contract. It predates the
stricter per-step usage-completeness marker, so it is not the current acceptance
result and must not be cited as a current pass.

The [canonical report file](evals/ai-live-eval-latest.json) is paired with a
controlled ledger. Its exact report identity, result, counts, provenance, and archive path are recorded only in
[STATUS.md](STATUS.md), where `portfolio:verify` binds the machine ledger and
visible summary to the report. For a run that fails during initialization,
the artifact validates only the fail-closed report/archive/verifier path; it does not constitute a provider
call or a model-quality, latency, cost, or cache result. The prior 2026-08-29 v3 provider-403 observation
remains in the historical archive. The honest next action is still an authorized
clean-worktree provider run, not an inferred or backfilled success.

The live command now starts from a plain-ESM bootstrap and uses UUID-acknowledged
IPC around both the provider boundary and report receipt. Pre-provider loader
failures can leave a zero-call artifact; after that boundary, a storage crash
must fail without inventing one.

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
titles and quoted source text retain their original language. Retained client
errors and released-attachment placeholders store typed facts rather than
translated text, so a locale change cannot leave stale-language errors; those
client-only placeholders and historical attachment bytes are removed before the
next model request.

### 7. Evidence and remaining limits

- Unit and integration tests cover temporal boundaries, exact power bands,
  two-axis product semantics, publication drift, append-only AI audit, log
  redaction, reasoning suppression, and eval recomputation.
- Playwright covers desktop/mobile public flows and locale persistence;
  PostgreSQL smoke tests inspect real constraint definitions.
- `STATUS.md` is the single current release source. `pnpm portfolio:verify`
  resolves its Git SHA, counts Vitest files/cases, recomputes the 97/28/651/203
  closure and zero-real-product manifests, and validates the live report. This
  is an offline repository check; it does not inspect the production database
  or VPS.
- Sourceable deployment seams and fake commands test control flow and
  fail-closed behavior. They do not prove production root metadata, canonical
  Node/PM2, systemd state, or execution on the target VPS.
- The 50-commit FDE development history is unrelated to `master`. Its
  2026-08-20 secret-scan claim remains an operator record without raw evidence.
  A separate [2026-09-05 retained scan](DEVELOPMENT_HISTORY.md#2026-09-05-retained-secret-scan-record)
  now binds a manifest, history/canary logs, and reports at evidence level
  `repository-contained-dated-run-record`. It records 50 scanner-counted
  commits, zero findings, and canary exit 97 with one redacted `github-pat`
  finding; an earlier exit-zero attempt with a scanner error was invalidated.
  Scanner counts are not Git traversal totals. The fixed external tool is not
  vendored, and recomputing saved outputs proves neither a current replay,
  source authenticity, per-commit coverage, nor license approval. Missing
  project LICENSE/NOTICE/package declarations and unfinished asset and
  weak-copyleft/notice review still block redistribution. The target archive
  branch remains neither created nor pushed; any future published copy stays
  non-deployable and never a merge target.
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

这次四天加固冲刺的历史规划基线是 64 个可运行 Vitest 文件、1,064 条测试；这只是改造前
数字，不是当前成绩。`STATUS.md` 现在只保留类型化静态指针；当前清单、结果计数、时间和源码
provenance 均来自 verifier 经该指针解析的 canonical Vitest 执行 artifact。

### 2. 假设与主动裁剪

- ISO 3166-1 alpha-3 是国家关联主键；日期使用 ISO 值，业务区间统一为半开区间
  `[from,to)`。
- `proposed` 永不等于生效；缺失证据保持 `unknown/no_data`，不跨国家、scope 或
  功率带外推。
- 公开作品站的只读边界由反向代理阻断管理端点来保障。标准服务端也支持受可信身份与
  RBAC 保护的治理写入；仅自助体验的 FDE 写入演示限定在隔离的本地 Demo fixture 中。
- 项目主动不拆微服务、不引入 PostGIS、不构造虚假产品主数据，也不虚构客户结果。
- `/admin` 与 `/dev` 是内部工具，不在本轮双语范围内。

### 3. 我负责的关键决策

**确定性事实，证据门控解释。** 七个 AI 工具都用 Zod 校验输入和输出；服务端 evidence
contract 检查工具身份、国家、scope、功率、日期和证据充分度。证据边界直接丢弃
reasoning part，`/api/chat` 也显式禁止 reasoning 传输。兼容服务商若把 `<think>` 标记
夹在普通文本中，即使尖括号外还有多层 named/numeric amp 实体编码，整段自然语言缓冲也会
被丢弃，已验证工具卡仍保留。system prompt v6
同时要求来源标题和引用原文逐字保留原始语言。模型 Markdown 从来不是事实来源。

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
`pnpm ai:eval:live` 会保存真实失败并以非零退出码返回；`pnpm portfolio:verify` 则从逐例
字段独立重算持久化的分数、判定、预算和 provenance 一致性，可接受自洽的当前版本失败
报告，但会拒绝陈旧或畸形报告。由于模型文本与工具原始结果不会留存，它不能重放 provider
交互。provider usage 缺失不会被当成零：已完成 provider call 的已知下界继续保留，token 完整性
失败关闭，且不会在剩余预算不可知时继续执行下一条 case。
通用 OpenAI-compatible usage 只能在调用后获得，因此这里不宣称 provider 账单级硬限额；
真正的预消费上限需要 provider 侧预算或模型专用的 preflight tokenization。

#### 截至 v12 的历史评分合同演进

在 `sales-chat-live-v12` 这一历史阶段，合同保留了 v3 的最终回答处置验收与 v4 的
provider attempt 完整性，并要求每条 case 命中稳定的事实/决策/免责声明 anchor 且回答语言
符合请求 locale；只有 attempt 与 completed call 都等于 `loopSteps` 时 token usage 才完整，
因此发生过无 usage 的失败 attempt 后即使 retry 成功也会失败关闭。证据允许的 case 必须产生
有实质内容的 `answered` 回答；证据不允许的 case 必须明确
`whole_request_refusal`；执行异常固定为 `not_evaluated`。分类器刻意保持窄范围，因此包含
局部风险、单项证据缺口或免责声明的有效回答不会被误判为整题拒绝。处置准确率门槛为
100%，每条 case 都必须通过；报告只保存安全分类、判定布尔值与 trim 后字符数，不保存模型
回答原文。v5 还只保存 detected locale 与 matched/missing anchor ID，两项门槛均为 100%；
这种受限 anchor 合同不等于开放式事实评审。v6 在首次远端调用前要求流式 usage，把每次
模型调用的 SDK retry 固定为 0，并持久化 `maxRetriesPerModelCall: 0` 供独立复核；这会消除
不可观测的重试消耗。v7 再把单次输出限制为 1,024 token，记录 18 × 5 次调用的 92,160
最大潜在输出，并把总预算策略标为 `post_usage_acceptance`；完整运行一旦超过 160,000，
termination 必须是 `token_limit_exceeded` 而不是 `completed`。这些控制会缩小输出侧越界空间，
但不会把调用后核对的门包装成 provider 账单硬限额。v8 进一步要求安全关键型拒绝同时满足
证据门、整题拒绝处置与回答 grounding，并用强肯定结论的反向 anchor 拒绝“先拒绝、后肯定”
的矛盾回答。v9 还会把任何已观察到的 provider stream error 判为
`EVAL_CASE_ERROR`，即使 SDK 的便利 Promise 随后以 fallback 值正常 resolve；落盘的知识
检索 query 只保留字符数与 SHA-256 摘要，原 query 仅在内存中供工具和 scorer 使用，不进入
latest 或 archive。保留的历史 v9 归档是显式禁用 provider 后生成的诚实初始化失败，
只证明当时的失败与归档路径；它没有发起 provider 调用，本文也不宣称成功的 v9 运行。v10 会先
用同一套生产 Zod schema 校验实际工具输入，再把 query、产品型号、
指标代码和非空辖区 ID 按 canonical 值替换为指纹。知识检索只保存命中、缺失或命中禁用项的
有限契约 ID；这些观测进入参数评分与 verifier 重算，但不保存中英文原始词面。v10 作为引入
输入校验和指纹边界的历史演进继续保留。v11 进一步持久化每个 completed step 经白名单归一化
后的 token、性能和缓存观测，以及逐 case aggregate；provider attempt coverage 不完整时会
失败关闭，同时保留已知数值下界。报告 summary 只从逐 case 行重算：记录 complete/incomplete
case 数、四类 cache status 数，以及 case latency、provider response time、完整 step time、
model first-output time 与 cache hit rate 的 nearest-rank p50/p95/max 和 sample count。这些只是
可观测字段，不构成延迟或缓存命中率验收门槛；报告不保存模型回答原文、raw provider usage 或
provider 私有字段。原子 schema 从保留字段推导 token completeness 和 cache 兼容性，将
completed call、ledger 与 step 算术闭合在 5 步内，并拒绝矛盾行。v12 保持相同 JSON 字段，但将
两类行恢复为真实生命周期语义：`tokenUsage.ledger` 是已完成 provider call 的计费台账，
`modelObservability.steps` 只包含到达 SDK `onStepEnd` 的行。终态调用最多可领先一个 step；
反向漂移或差值大于 1 均失败关闭，该 case 也不能宣称 usage 完整。模型名与最终 report ID 共用
strict 合同，runner 在持久化前解析完整报告。

#### 当前合同与保留证据

Portfolio verifier 使用已注册的版本专属 strict schema 解析现代归档；
两份早于该 schema 的现代 v2 文件只以冻结全文 SHA-256 兼容。
当前 suite 与已观察报告的身份分别记录在 [STATUS.md](STATUS.md)，观察结果也以该台账为准。
支持历史 schema 不等于通过当前 suite 验收；以上历史里程碑并不标识最新实测报告。

固定的 18 条 case 也覆盖两条生产语言路径：6 条显式使用英文，12 条使用 `zh-CN`。
英文 case 包括带日期的国家画像、否定跨国比较意图、产品适配、来源检索和证据不足结果。
runner 将每条声明的 locale 传入 `streamSalesChat()`；v5 起逐结果只保存 locale、不保存
prompt，因此 portfolio 校验可以拒绝 case ID 与 locale 不一致的报告。

2026-08-19 的 v2 运行现在只作为
[legacy 历史归档](evals/archive/ai-live-eval-2026-08-19-v2-passed-legacy.json)
保留。它以 36 个 provider steps、101,604 tokens 完整执行 18 条 case；在该报告当时的
合同下，工具选择、参数准确率、证据期望准确率与安全失败关闭均为 100%。这次运行早于
更严格的逐 step usage 完整性字段，因此它不是当前验收结果，也不得引用为当前通过成绩。

[canonical 报告文件](evals/ai-live-eval-latest.json)与受控台账配对；报告的精确身份、结果、
计数、provenance 与归档路径只记录在 [STATUS.md](STATUS.md)；`portfolio:verify` 会把其中的
机器台账和可见摘要绑定到报告。
若某次运行在初始化阶段失败，其工件只能证明报告、归档与 verifier 的失败关闭路径，不能构成 provider 调用或
模型质量、延迟、成本、缓存成绩。此前 2026-08-29 的 v3 provider 403 观察仍保留在历史归档；
诚实的下一步仍是获批后在 clean worktree 上运行完整 hardened suite，而不是推断或回填
成功结果。

live 命令现由纯 ESM bootstrap 启动，并以 UUID 双向 ACK 绑定 provider 边界与报告回执。
provider 前 loader 失败可留下零调用证据；跨过该边界后若存储崩溃，则必须失败且不能虚构
零调用报告。

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
保留在客户端的错误与已释放附件占位符只存类型化事实，不存翻译后的文本，因此语言切换
不会留下旧语言错误；这些仅客户端占位符与历史附件字节也会在下一次模型请求前移除。

### 7. 验证证据与剩余边界

- 单元/集成测试覆盖时态、精确功率边界、产品双轴语义、发布漂移、append-only AI 审计、
  日志脱敏、reasoning 抑制和 eval 重算。
- Playwright 覆盖桌面/移动公开流程与语言持久化；PostgreSQL smoke 读取真实约束定义。
- `STATUS.md` 是唯一当前 release 来源；`pnpm portfolio:verify` 解析其 Git SHA、统计
  Vitest 文件/用例、重算 97/28/651/203 闭包与零真实产品 manifest，并校验 live 报告；这是离线
  repository 校验，不访问生产数据库或 VPS。
- sourceable 部署 seam 与 fake command 只验证控制流和失败关闭合同，不证明生产 root metadata、
  canonical Node/PM2、systemd 状态或目标 VPS 已执行。
- FDE 的 50 个增量提交与 `master` 是独立历史；2026-08-20 密钥扫描结论仍是缺少原始
  证据的操作记录。另一次 [2026-09-05 留档扫描](DEVELOPMENT_HISTORY.md#2026-09-05-已留档密钥扫描记录)
  现已绑定 manifest、历史扫描/Canary 日志与报告，证据等级为
  `repository-contained-dated-run-record`。它记录 50 个 scanner-counted commits、0 命中，
  以及 Canary 退出 97 和一条已脱敏 `github-pat` 命中；先前退出 0 却含 scanner 错误的
  尝试已作废。Scanner 计数不等于 Git 遍历总数。固定外部工具未 vendor，重算保存输出
  不证明当前重放、来源真实性、逐提交覆盖或许可证通过。项目 LICENSE/NOTICE/package
  许可声明缺失，资产与弱 copyleft/NOTICE 人工复核也未完成，因此仍禁止再分发；目标
  archive 分支仍未创建、未推送。如未来发布，也只会作为明确不可部署的 archive，
  永不作为合并目标。
- 项目仍没有客户试点、法规专家签核、获准真实产品主数据、客户 KPI、生产级私有文档库或
  代表性 embedding 基准。
