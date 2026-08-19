# Three-minute interview demo / 三分钟面试演示

This script starts with the failure mode because the most important product
claim is not that the model can produce prose; it is that the system refuses to
invent a regulation when the evidence contract is not satisfied.

Tool progress is streamed as it happens. Model prose is intentionally buffered
until the tool loop finishes and the server has validated the complete evidence
set, so the final narrative appears at once rather than token by token.

## English

### Before the timer

- Hosted path: open the [home page](https://jamesky.site), a
  [CHN 100 kW deep link](https://jamesky.site/countries/CHN?applicationScope=non-road&powerKw=100&asOf=2026-08-13),
  and the [AI workspace](https://jamesky.site/chat?countryIso3=CHN&applicationScope=non-road&powerKw=100&asOf=2026-08-13).
- Zero-configuration path: run `pnpm install` and `pnpm demo`, then open
  <http://127.0.0.1:3000>. Installation and startup are not part of the timer.
- Select English in the header before the walkthrough.

### 0:00–0:30 — Frame the user problem

> International sales teams need one answer across regulatory status, query
> date, application scope, power band, certification, product availability,
> market methodology, and source traceability. Deterministic code owns those
> facts; the LLM can only select read-only tools and explain validated results.

Clarify that 178 ISO3 entries are a country directory and published evidence
boundary, not 178 countries with numeric emission limits. The reviewed
publication closure is 97 jurisdictions, 28 regulations, 651 limits, and 203
sources; there are zero approved real-product fixtures.

### 0:30–1:15 — Show the failure boundary first

Ask:

```text
Check FJI non-road regulations for 100 kW as of 2026-08-13. Do not extrapolate if evidence is missing.
```

Point out the structured no-data result and the fixed evidence-gap response.
The model cannot replace it with a plausible-sounding emissions stage. Tool
status can stream immediately, while the final prose remains buffered until the
whole evidence contract is known.

### 1:15–2:10 — Run the successful golden path

1. Open the CHN deep link and show that ISO3, scope, power, and `asOf` are
   shareable.
2. Separate current `effective` rules, future `adopted` rules, and source
   verification time; `proposed` records never enter the public current-rule
   result.
3. Run `product-fit-v2` for non-road, 100 kW, and `2026-08-13`.
4. Show compliance fit, query-date availability, combined commercial
   readiness, and citations as separate fields.

Then ask the AI workspace to compare CHN and BRA at the same scope, power, and
date. Show the tool cards and citations before discussing the explanation.

### 2:10–3:00 — Prove reproducibility and boundaries

Switch to the local demo and repeat a CHN query. Explain that `pnpm demo` needs
no `.env.local`, PostgreSQL, Docker, or model key, but still runs the tracked
Drizzle migrations, repositories, services, Zod tool contracts, citations, and
evidence gate. Its stable products, regulations, and answers are explicitly
fictional and cannot support a quotation, certification statement, or sales
commitment.

Close with the current limits: no approved real product master data, no legal
expert sign-off, and no real-user adoption claim.

## 中文

这份脚本先展示失败场景，因为项目最重要的主张不是“模型能生成文字”，而是证据合同
不满足时系统会拒绝编造法规。

工具进度会实时传输；模型最终文字会缓冲到工具循环结束并完成全部证据校验后一次性
释放，因此不是逐 token 展示。

### 演示前准备（不计时）

- 托管版：预先打开[首页](https://jamesky.site)、
  [中国 100 kW 深链](https://jamesky.site/countries/CHN?applicationScope=non-road&powerKw=100&asOf=2026-08-13)
  和[AI 工作区](https://jamesky.site/chat?countryIso3=CHN&applicationScope=non-road&powerKw=100&asOf=2026-08-13)。
- 零配置版：提前执行 `pnpm install`、`pnpm demo`，打开
  <http://127.0.0.1:3000>。安装和启动不计入三分钟。
- 在页头选择中文。

### 0:00–0:30：说明用户问题

> 海外销售需要同时核对法规状态、查询日期、应用场景、功率带、认证、供应期、市场
> 口径和来源。确定性代码负责事实，LLM 只能选择只读工具并解释通过校验的结果。

明确 178 个 ISO3 是国家目录和已发布证据边界，不代表 178 国都有数值限值。当前发布
闭包为 97 个辖区、28 条法规、651 条限值、203 个来源；获准公开的真实产品为 0。

### 0:30–1:15：先展示失败关闭

提问：

```text
核对 FJI non-road 100 kW 在 2026-08-13 的法规；没有证据时不要外推。
```

指出结构化 no-data 和固定证据缺口。模型不能用听起来合理的排放阶段替代它。工具状态
可以即时出现，但最终文字必须等待完整证据合同判定。

### 1:15–2:10：展示成功黄金流程

1. 打开 CHN 深链，说明 ISO3、scope、power、`asOf` 都可分享。
2. 区分当前 `effective`、未来 `adopted` 和来源核验时间；`proposed` 不进入公开当前法规。
3. 对 non-road、100 kW、`2026-08-13` 运行 `product-fit-v2`。
4. 分别展示法规/认证适配、查询日供应状态、组合商业准备度和引用。

随后让 AI 在相同场景、功率和日期下比较 CHN 与 BRA，先展示工具卡和 citation，再讲
模型解释。

### 2:10–3:00：证明可复现并说明边界

切到本地 Demo 重复 CHN 查询。说明 `pnpm demo` 不需要 `.env.local`、PostgreSQL、
Docker 或模型 Key，但仍执行受版本控制的 Drizzle migration、repository、service、Zod
工具、引用和证据门。其产品、法规和回答均为明确标记的虚构 fixture，不能用于报价、
认证声明或销售承诺。

最后明确未完成项：没有获准公开的真实产品主数据、没有法律专家签核，也没有现实用户
采用或业务 KPI 声明。
