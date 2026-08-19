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
`streamSalesChat()` loop under an 18-case / 160,000-token ceiling.
`pnpm portfolio:verify` recomputes the report from case-level fields; a real
failure stays saved and returns a non-zero exit code.

The final v2 run completed all 18 cases in 36 provider steps and 101,604
tokens. Tool selection, argument accuracy, evidence-expectation accuracy, and
safety fail-closed all scored 100%. Three earlier failed v2 runs remain
archived, so the final result is reviewable as a progression rather than a
rewritten success story. This remains an internal provider eval, not a customer
outcome.

This is a stronger FDE artifact than a polished but unauditable score: it shows
the faulty measurement, the root cause, the corrected contract, and the honest
next run.

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
- The 50-commit FDE development history is unrelated to `master`. It remains
  local until full-history secret and license checks pass; any published copy
  will be a clearly non-deployable archive, never a merge target.
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
`streamSalesChat()` 循环，并设置 18 case / 160,000 token 总上限。
`pnpm portfolio:verify` 从逐例字段重算报告；真实失败仍会保存并以非零退出码返回。

最终 v2 运行以 36 个 provider steps、101,604 tokens 完整执行 18 条 case；工具选择、
参数准确率、证据期望准确率与安全失败关闭均为 100%。此前三次失败的 v2 运行仍保留在
归档中，因此最终结果呈现的是可复核的修复过程，而不是重写后的成功故事。它仍是内部
provider eval，不是客户效果。

与一份漂亮但不可审计的分数相比，这更能证明 FDE 能力：保留错误测量、解释根因、修正
合同，并诚实记录下一次运行。

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
- FDE 的 50 个增量提交与 `master` 是独立历史；完整历史密钥与许可证检查通过前保持本地。
  如发布，只会作为明确不可部署的 archive，永不作为合并目标。
- 项目仍没有客户试点、法规专家签核、获准真实产品主数据、客户 KPI、生产级私有文档库或
  代表性 embedding 基准。
