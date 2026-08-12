# 真实市场指标证据接收清单

## 1. 状态与用途

- 状态：M3 证据门，2026-08-05 建立；CHN、USA、DEU、BRA 的 24 条签核市场 fixture
  已通过治理流程发布，active 集合仅保留每个自然键的一条记录。
- 目标：为 CHN、USA、DEU、BRA 选择 2–3 个许可清晰、同口径且能解释业务含义的
  年度指标，并通过现有 CSV Preview → Draft → Reviewed → Published 流程发布。
- 红线：来源可访问不等于允许再分发；“最新值”年份不同不得比较；贸易额、宏观
  规模或车辆总量不得被描述成柴油发动机可寻址市场；评分方向必须由业务负责人
  签字，不能由模型或研发推断。
- 本清单与现有 `marketMetricDraftPayloadSchema` 和确定性比较器对齐，不触发
  数据库 schema 变更，也不修改 `opportunity-score-v1`。

## 2. 现有系统契约

每条市场观测必须明确保存国家 ISO3、指标代码和定义、可选 application scope、
半开统计期间 `[periodStart, periodEnd)`、数值、单位、可选币种、方法版本、来源和
核验时间。跨国比较只有在以下字段全部一致时才为 `comparable`：

- `metricCode`
- `applicationScope`
- `unitCode`
- `currencyCode`
- `methodologyVersion`
- `periodStart` / `periodEnd`

系统不做隐式单位、汇率或价格基准换算。缺国、同国同期间存在多个候选值或任一
口径不一致时必须返回结构化问题，不生成排名。指标能否进入营销评分是第二道独立
决策门；获准比较不等于获准设置 `higher_is_better` 或 `lower_is_better`。

## 3. 已核验候选来源

### 3.1 OICA 商业车辆销量

- 统计入口：<https://oica.net/sales-statistics/>
- 定义入口：<https://oica.net/wp-content/uploads/2026/04/DEFINITIONS-2025-11-18-Dark.pdf>
- 法律声明：<https://oica.net/legal-notice/>
- 2026-08-05 读回：2025 年页面提供 `Commercial Vehicles - Sales` 表，CHN、
  USA、DEU（Germany）、BRA（Brazil）均在同一年度和同一张表中；页面同时提示
  部分欧洲国家缺数。
- 口径风险：OICA 的 commercial vehicles 聚合不能直接等同于柴油机销量，也不能
  在没有分项定义的情况下拆成 `on-road-truck` 与 `on-road-bus` 两条观测。
- 许可结论：OICA 声明电子媒介全部或部分复制须获明确授权，使用、复制和分发权
  严格保留；纸面复制只在免费分发、保持完整和明确署名三个条件下允许。

结论：这是四国道路市场的强候选入口，但在取得 OICA 书面许可并确认车型定义前，
不得复制数值到公开作品、CSV、数据库或测试 fixture。

### 3.2 UN Comtrade HS 8408

- 数据入口：<https://comtradeplus.un.org/>
- 许可：<https://comtradeplus.un.org/LicenseAgreement>
- 候选口径：HS 8408 压燃式内燃活塞发动机的年度进口额、出口额、净重或补充数量。
- 业务风险：贸易流不等于终端需求或装机量；HS 8408 同时包含船用及其他压燃式
  发动机，必须先批准 reporter/partner、trade flow、二级子目、估算值和再出口
  处理规则，不能直接映射四个 application scopes。
- 许可结论：许可第 5 条限制未经书面许可的复制、自动浏览/下载、再分发、发布和
  商业利用。

结论：在取得 UN 书面许可前只登记为方法候选，不自动下载、不入库、不公开展示。

### 3.3 World Development Indicators

- 数据集：<https://datacatalog.worldbank.org/search/dataset/0037712/world-development-indicators>
- 数据条款：<https://www.worldbank.org/en/about/legal/terms-of-use-for-datasets>
- 许可结论：WDI Data Catalog 明确标记 `Creative Commons Attribution 4.0`；
  World Bank 数据集条款允许提取、下载、复制和分享，但要求按条款署名，并提醒
  单独标记的第三方数据可能有额外限制。

已核验的指标入口和四国覆盖：

- GDP：<https://data.worldbank.org/indicator/NY.GDP.MKTP.CD>
- Agriculture, forestry, and fishing, value added：
  <https://data.worldbank.org/indicator/NV.AGR.TOTL.CD>
- Industry (including construction), value added：
  <https://data.worldbank.org/indicator/NV.IND.TOTL.CD>

| 指标 | 官方代码 | 2026-08-05 页面显示的四国最新年份 | 许可 | 当前判断 |
| --- | --- | --- | --- | --- |
| GDP（current US$） | `NY.GDP.MKTP.CD` | CHN/USA/DEU/BRA 均为 2025 | CC BY 4.0 | 同期且可再利用，但只是宏观规模代理，是否有业务解释力待批准 |
| Agriculture, forestry, and fishing, value added（current US$） | `NV.AGR.TOTL.CD` | CHN/DEU/BRA 为 2025；USA 为 2021 | CC BY 4.0 | 最新值期间不一致，当前比较器必须拒绝；且不等于农机发动机需求 |
| Industry (including construction), value added（current US$） | `NV.IND.TOTL.CD` | CHN/DEU/BRA 为 2025；USA 为 2021 | CC BY 4.0 | 最新值期间不一致，且“industry”远宽于工程机械市场 |

结论：WDI 是当前唯一许可明确、可用于公开作品的候选来源。`NY.GDP.MKTP.CD`
可形成同期的四国技术验收样例，但在业务 owner 明确接受“宏观规模代理”之前不得
进入真实营销评分；另外两个指标只有选定四国共同历史年份并逐项复核后才可能比较。

## 4. 候选指标决策包

以下只是送审选项，不是已批准数据定义：

| 候选代码 | 建议 scope | 期间 / 单位 | 优点 | 必须回答的问题 |
| --- | --- | --- | --- | --- |
| `WDI_GDP_CURRENT_USD` | `null` | annual / `USD` | 四国 2025 同期、许可清晰、无需换算 | 宏观 GDP 是否足以代表本作品的市场规模？是否仅展示、不参与评分？ |
| `OICA_COMMERCIAL_VEHICLE_SALES` | `null` | annual / `vehicle` | 四国 2025 同表，接近道路业务 | 是否取得电子再分发许可？commercial vehicle 定义是否满足作品口径？ |
| `WDI_AGRICULTURE_VALUE_ADDED_USD` | `agriculture` | annual / `USD` | 开放许可，可表达农业经济规模 | 采用哪个四国共同年份？current US$ 的汇率影响是否接受？能否明确标为代理变量？ |
| `WDI_INDUSTRY_VALUE_ADDED_USD` | `construction` 或 `null` | annual / `USD` | 开放许可，有工业规模信息 | 指标过宽，是否会误导为工程机械需求？若批准，scope 应为 `null` 还是 `construction`？ |
| `COMTRADE_HS8408_IMPORT_VALUE` | `null` | annual / `USD` | 与压燃式发动机贸易直接相关 | 是否取得许可？采用哪个 HS 子目、贸易流和 partner 规则？如何处理船用和再出口？ |

不建议把同一个聚合值复制到多个 scope 来制造覆盖。无法清晰归属场景时使用
`applicationScope = null`，并在定义中写明聚合边界。

## 5. 批次接收模板

产品与销售负责人先选择 2–3 个指标，再为四国逐行提交。空白字段表示未提供，
不表示“不适用”。真实数值必须来自获准使用的导出或人工可追溯记录。

交给管理后台预览的 CSV 必须使用以下固定表头和顺序：

```csv
country_iso3,metric_code,metric_name,definition,application_scope,period_start,period_end,value_numeric,unit_code,currency_code,methodology_version,published_on,data_source_id,verified_at,is_demo
```

填值约束：

- `application_scope`、`currency_code`、`published_on` 可留空；其他列不得缺失。
- `period_end` 是不包含上界；年度 2025 使用 `2025-01-01` 到 `2026-01-01`。
- `value_numeric` 必须显式填写与 `unit_code` 一致的原始十进制值，不带千位分隔符
  或展示缩放；空值不得按 `0` 导入。
- `data_source_id` 必须是已登记并完成许可核验的来源 UUID，不能填 URL 或来源名。
- `verified_at` 使用实际读回时点的 ISO UTC timestamp；`is_demo` 必须显式填写
  `true` 或 `false`，真实事实固定为 `false`，拼写错误不能静默降级为真实数据。
- `metric_code` 会规范化为大写；同一指标四国必须使用完全相同的代码、定义和
  `methodology_version`。

| 行 | `countryIso3` | `metricCode` | 指标定义 | scope | `[periodStart,periodEnd)` | 数值 / 单位 / 币种 | `methodologyVersion` | 来源 / locator / 许可 | `publishedOn` / `verifiedAt` | owner / reviewer | 评分方向 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M-01 |  |  |  |  |  |  |  |  |  |  |  |
| M-02 |  |  |  |  |  |  |  |  |  |  |  |
| M-03 |  |  |  |  |  |  |  |  |  |  |  |
| M-04 |  |  |  |  |  |  |  |  |  |  |  |
| M-05 |  |  |  |  |  |  |  |  |  |  |  |
| M-06 |  |  |  |  |  |  |  |  |  |  |  |
| M-07 |  |  |  |  |  |  |  |  |  |  |  |
| M-08 |  |  |  |  |  |  |  |  |  |  |  |
| M-09 |  |  |  |  |  |  |  |  |  |  |  |
| M-10 |  |  |  |  |  |  |  |  |  |  |  |
| M-11 |  |  |  |  |  |  |  |  |  |  |  |
| M-12 |  |  |  |  |  |  |  |  |  |  |  |

三项指标 × 四国时共 12 行；若只批准两项则提交 8 行。评分方向允许填
`higher_is_better`、`lower_is_better` 或 `not_scored`，必须与展示许可分开签字。

## 6. 发布验收门

一批市场事实只有同时满足以下条件才进入 Preview → Draft → Reviewed → Published：

1. 指标 owner 批准定义、业务含义、scope、频率、单位、币种、期间和来源优先级。
2. 每个来源都有明确的公开展示与再分发结论；第三方数据例外逐指标复核。市场来源
   UUID 使用独立命名段，不得与法规来源 UUID 复用；非 Demo 市场指标不得引用
   `official-regulation` 来源类型。
3. CHN、USA、DEU、BRA 使用相同 `methodologyVersion` 和同一统计期间；缺任一国时
   不把该批次描述为四国可比指标。
4. 金额指标明确 current/constant、币种和价格基准；当前系统不做隐式汇率换算。
5. CSV 预览零错误且逐行核对原始 locator；确认后只创建草稿，不直接发布事实。
6. editor 与 reviewer/publisher 分离，核验时间使用实际 UTC 读回时间。
7. 发布后执行 `compareMarkets` 验收，四国应为 `comparable`；人为制造重复最新值、
   缺国、期间错位、单位错位和方法错位时必须返回对应结构化问题。
8. 只有评分方向、权重、代理变量含义和批准人写入 ADR-020/021 后，才可把真实
   `metricCode` 加入服务端评分方向配置；LLM 不得创建或修改方向和权重。

## 7. 当前阻塞

- 产品与销售 owner 尚未从候选中批准 2–3 个指标及业务解释。
- OICA 和 UN Comtrade 未取得公开电子再分发/商业使用许可。
- 两个场景相关 WDI 指标的四国最新年份不一致，且只是宏观代理。
- ADR-019 尚未批准市场数据 owner、复核周期和 stale 阈值。
- ADR-020 尚未批准指标定义、来源优先级、共同期间、换算和评分方向。
- ADR-021 尚未批准真实营销评分因素、权重和规则批准人。

在上述输入到位前，现有 `DEMO_ADDRESSABLE_UNITS` 继续显式标记为 Demo，不得
改名或解释为真实市场规模。
