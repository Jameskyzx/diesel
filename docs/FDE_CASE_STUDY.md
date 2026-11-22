# FDE Case Study / FDE 项目案例

> Portfolio implementation based on a plausible industry workflow. This case
> study does not claim a customer deployment, real-user adoption, legal advice,
> or business KPI.
>
> 本作品基于合理的行业工作流实现；本文不声称已有客户部署、真实用户采用、法律建议或
> 业务 KPI。

[中文](#中文) · Current numbers and the latest eval run are in [STATUS.md](STATUS.md);
the full decision log is [DECISIONS.md](DECISIONS.md).

## English

### 1. Problem

Before quoting a diesel engine abroad, a salesperson has to answer three
questions: which emission rules apply in that country today, which of our
models meet them, and how to explain it to the customer. The answer depends on
the query date, application scope, power band, certification and supply
status, and each fact needs a source. An LLM that answers this from memory
will sound right and be wrong.

### 2. Design: three layers

1. **Facts** live in PostgreSQL. Source text and its locators live in the
   document store.
2. **Rules** are deterministic domain code. It evaluates
   `asOf + ISO3 + scope + power` and returns regulation applicability, product
   fit, commercial readiness and the opportunity score.
3. **The LLM** only selects read-only tools and explains validated results. It
   cannot write facts, invent a certification or change a score.

### 3. Three decisions I own

**Evidence gates the answer.** The seven AI tools validate input and output
with Zod. A server-side evidence contract checks the tool, country, scope,
power, date and sufficiency of each result. Model prose is buffered until that
check passes. When evidence is missing, the server renders a fixed
evidence-gap reply and the model's text is discarded.

**Unknown stays unknown.** `proposed` never means effective. Intervals are
half-open `[from, to)`. Missing evidence returns `unknown` or `no_data`; the
system does not infer across countries, scopes or power bands. Compliance fit
and supply status are separate axes, and only the deterministic `ready`
combination may enter a sales recommendation.

**Data changes are governed.** Ingestion follows Preview → Draft → Review →
Publish. Each write records the actor, the reason and the diff, and AI tool
calls go to an append-only audit table.

### 4. Two incidents

**Data drift.** A review found real product rows in the public database that
were not in any approval manifest. One had a zero-width `[276, 276)` power
interval. Repository constraints had not proved that the production rows and
the public API agreed. I added a fail-closed publication manifest that binds
product ID, source ID and specification version, made public DTOs reject
invalid intervals, and archived the eight rows in one serializable transaction
after a verified backup. I did not invent real products to fill the gap; the
public catalogue is 24 fictional `DEMO-` models.

**The eval that graded itself.** The first live-eval scorer compared the
expected evidence permission only on safety-critical cases. Checking its raw
observations against the 18-case specification showed six mismatches, five of
them marked as passing. The scorer now compares every case, never counts an
exception as a safety pass, and judges grounding only on server-rendered
evidence, so the model's own narrative cannot satisfy an anchor. A failing run
is saved as a failure and exits non-zero.

### 5. Known limits

- No customer pilot, no legal-expert sign-off and no approved real product
  data. Regulation fixtures are reviewed against public sources by me only.
- Knowledge search combines PostgreSQL full-text search with a 128-dimension
  local hash embedding. That embedding is lexical, not semantic: it has no
  external model behind it and there is no retrieval benchmark. Metadata
  filters and the keyword channel carry the retrieval quality today.
- The live AI eval is 18 bilingual cases on one model. It measures tool
  selection and fail-closed behaviour, not open-ended answer quality.
- Try it locally with `pnpm demo` (read-only) or `pnpm demo:fde` (the import →
  review → publish flow on fictional data); see [DEMO.md](DEMO.md).

## 中文

### 1. 问题

给海外客户报一台柴油机之前，销售要先回答三个问题：这个国家现在执行什么排放法规、我们
哪些机型满足、怎么向客户讲清楚。答案取决于查询日期、应用场景、功率段、认证和供应状态，
而且每条事实都要有出处。让大模型凭记忆回答，听起来对，实际会错。

### 2. 设计：三层

1. **事实**存在 PostgreSQL；来源原文和定位信息存在文档库。
2. **规则**是确定性的领域代码，按 `asOf + ISO3 + scope + power` 计算法规适用性、产品
   适配、商业就绪度和机会分。
3. **大模型**只选择只读工具并解释已校验的结果，不能写入事实、虚构认证或修改分数。

### 3. 我负责的三个决策

**先有证据，才有回答。** 七个 AI 工具的输入和输出都用 Zod 校验。服务端的证据契约检查
每个结果的工具、国家、场景、功率、日期和证据是否充分。模型文字先缓冲，校验通过才发出；
证据缺失时由服务端输出固定的证据缺口说明，模型文字被丢弃。

**未知就是未知。** `proposed` 不等于生效；区间统一用半开区间 `[from, to)`。缺少证据时
返回 `unknown` 或 `no_data`，不跨国家、场景或功率段外推。合规适配和供应状态是两条独立
的轴，只有确定性的 `ready` 组合可以进入销售推荐。

**数据变更受治理。** 数据接入走 Preview → Draft → Review → Publish。每次写入记录操作
者、原因和 diff，AI 工具调用写入只追加的审计表。

### 4. 两次事故

**数据漂移。** 一次走查发现公开数据库里有未进入签核清单的真实产品行，其中一行的功率
区间是零宽的 `[276, 276)`。这说明仓库里的约束并不能证明生产数据和公开 API 一致。我增加
了失败关闭的发布清单，同时绑定产品 ID、来源 ID 和规格版本；公开 DTO 拒绝非法区间；在
校验过的备份之后，用一个 serializable 事务归档了这 8 行。我没有为了补齐作品去编造真实
产品，公开目录是 24 个虚构的 `DEMO-` 型号。

**给自己打高分的评测。** 第一版实测评分器只在安全关键用例上比较“是否允许给出证据”。
把原始观测和 18 条用例规格逐条对照后，发现 6 条不一致，其中 5 条被标为通过。现在评分
器逐条比较，异常不算安全通过，并且只在服务端渲染的证据上判定落地，模型自己的叙述不能
满足任何锚点。失败的运行会如实保存并以非零退出码结束。

### 5. 已知边界

- 没有客户试点、没有法规专家签核、没有获准公开的真实产品数据。法规数据只由我本人对照
  公开来源核对过。
- 知识检索由 PostgreSQL 全文检索和 128 维本地哈希向量组成。这个向量是词法的，不是语义
  的：背后没有外部模型，也没有检索基准。目前的检索质量靠元数据过滤和关键词通道保证。
- AI 实测是单一模型上的 18 条中英文用例，衡量的是工具选择和失败关闭，不是开放式的回答
  质量。
- 本地体验：`pnpm demo`（只读）或 `pnpm demo:fde`（在虚构数据上走一遍导入 → 审核 →
  发布），见 [DEMO.md](DEMO.md)。
