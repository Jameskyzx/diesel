# FDE Case Study / FDE 项目案例

> This is a portfolio implementation based on a plausible industry workflow. It
> does not claim a customer deployment, real-user adoption, or business KPI.

## 中文

### 1. 问题拆解

海外柴油机销售问题通常同时跨越法规时态、应用场景、功率带、认证、产品供应期、
市场口径和来源追溯。这个项目把它拆成三层：

1. 关系数据库保存可查询的结构化事实，文档库保存原文与 locator；
2. 纯领域代码按 `asOf + ISO3 + scope + power` 计算法规适用性、产品适配和机会分；
3. LLM 只负责选择只读工具并解释已验证结果，不能写事实或修改分数。

### 2. 假设与范围裁剪

- 目标是展示 FDE 的需求拆解、数据治理、失败关闭、交付与运维能力，不是假装已有客户。
- ISO 3166-1 alpha-3 是国家主键；日期使用 ISO 格式，业务区间统一为 `[from,to)`。
- `proposed` 永不等于生效；数据缺失保持 `unknown/no_data`，不做地域或功率外推。
- 当前公开站是只读作品站；管理写入只在受限本地实施 Demo 中演示。
- 暂不拆微服务、不引入 PostGIS、不构造虚假产品主数据，也不宣称业务收益。

### 3. 三项关键决策

**确定性事实层，LLM 解释层。** 七个 AI 工具都有 Zod 输入/输出，服务端 evidence
contract 检查工具、国家、scope、power、日期和证据充分度。模型生成的 Markdown 不是
事实来源；证据不足时丢弃肯定文本。

**法规与供应双轴。** `product-fit-v2` 的 `status` 只表示法规/认证适配；供应期单独按
`[availableFrom,availableTo)` 计算，组合为 `commercialReadiness`。只有 `ready` 产品才能
进入销售简报推荐，避免“合规”被误读为“查询日可售”。

**治理操作可审计、可回滚。** 数据接入走 Preview → Draft → Review → Publish，管理
写入记录 diff、原因和操作者。AI 工具调用采用每轮唯一键并 append-only；部署使用不可变
release、数据库备份、迁移 smoke、canary 和版本化回滚。

### 4. 一次严重问题与修复

红队走查发现：公开数据库曾出现未进入签核 manifest 的真实型号，其中一条功率区间为
`[276,276)`，且来源关联不可信。这说明“仓库约束正确”并不能证明生产 schema、数据和
公开出口一致。

修复分为三层：公开 Repository 仅允许签核 manifest 或严格 Demo 实体；DTO 对非法区间
失败关闭；生产维护脚本必须以精确 dry-run manifest、8 条计数、完整备份和 serializable
事务为门。该事故也促成部署后读回公开产品集合与数据库约束的 canary。生产清理证据未
完成前，本项目不会宣称该运营问题已经关闭。

### 5. AI 辅助边界

AI 编程代理用于代码生成、机械性整理和对抗审查。作者负责需求边界、schema、ADR、验收
标准、来源发布决策和最终合并。外部模型 live eval 使用虚构 PGlite 数据，报告不保存
prompt、完整输出或密钥；普通 CI 只跑确定性 harness。

### 6. 可操作实施 Demo

```bash
pnpm demo:fde
```

该入口只允许 loopback + development + PGlite + 显式 Demo 标志。页面持续显示
`LOCAL / MUTABLE / FICTIONAL`，可完成错误 CSV Preview、修正后建 Draft、Reviewer
发布、CHN 查询读回、Admin 归档并恢复原状态。每次启动创建新的进程内数据库，不接触
公开站或开发者真实库。

### 7. 验证证据与未完成风险

- 单元/集成测试覆盖时态、功率边界、双轴产品语义、append-only AI 审计和日志脱敏。
- Playwright 覆盖桌面完整治理向导，以及移动端 persona、Preview 和可访问性关键路径。
- PostgreSQL 空库与升级 smoke 读取真实 constraint definition，不只检查迁移文件存在。
- 18 条 live eval 有请求数、token 和单例超时硬门；未达到阈值的报告保留为失败证据。
- 仍待完成：真实产品资料签核、正式法规专家复核、生产级对象存储/embedding、持续告警，
  以及在生产清理后完成备份、迁移和公网读回。

## English

### Problem and framing

An international diesel sales question spans regulatory time, application
scope, power bands, certification, commercial availability, market methodology,
and source traceability. I split the solution into a structured fact layer, a
deterministic decision layer, and an LLM explanation layer. The LLM cannot write
facts, invent a certification, or alter a score.

This is deliberately a portfolio implementation, not a fabricated customer
story. The scope favors reviewable failure modes and deployment evidence over
microservices, speculative spatial infrastructure, or invented KPIs.

### Three decisions I own

1. **Evidence-gated AI:** Zod-validated read-only tools plus a server-side
   evidence contract fail closed on missing or mismatched facts.
2. **Two-axis product semantics:** compliance fit and query-date availability
   remain separate; only their deterministic `ready` combination is recommendable.
3. **Governed delivery:** data changes move through preview, draft, review, and
   publish; tool audits are append-only; releases are immutable and verified by
   database smoke tests and synthetic canaries.

### Serious issue and response

A red-team review found unsigned real product rows in the public database,
including an invalid zero-width power interval and an unrelated source link.
That was a production-drift failure, not a cosmetic bug. The response combines a
public allowlist, fail-closed DTO validation, an exact-manifest cleanup procedure,
a full database backup, serializable archival, migrations, and post-deploy
readback. I do not mark the operational incident closed until those production
checks have evidence.

### Implementation demo, evaluation, and limits

`pnpm demo:fde` runs a loopback-only, mutable, fictional PGlite workflow for CSV
validation, governance review, publish, query, and archive. The live model eval
uses 18 versioned fictional cases with strict request, token, and timeout budgets;
the saved report contains only normalized tool calls, scores, latency, token use,
and error codes.

The remaining gaps are explicit: no customer adoption claim, no approved real
product master data, no legal-expert sign-off, and no production-grade private
document store or representative embedding benchmark yet.
