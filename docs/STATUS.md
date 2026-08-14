# 当前项目状态

这是 README、部署文档和历史任务记录之间的当前状态索引。历史 ADR 和任务日志保留
当时的计数，不回写历史；判断“现在是什么状态”时以本文件、代码 fixture 和运行库
接口为准。

## 状态日期

- 代码与本地数据基线：2026-08-11；稳定 33 国数据纠错已通过本地 fixture 验收，见
  `ACCEPTANCE.md` #166–#198 与 ADR-126/127；MAR/KEN source-only currentness
  纠错已签核为 #199–#200 与 ADR-128，QAT/KWT/OMN/JOR source-only currentness
  纠错已签核为 #201–#204 与 ADR-129，IRN/IRQ/LBN/SYR source-only currentness
  纠错已签核为 #205–#208 与 ADR-130；GUY/HTI/JAM/BLZ/CUB 至
  CAF/COD/COG/GIN/DJI 的七批 35 国 source-currentness 已签核为 #209–#243 与
  ADR-131。MAR/KEN/QAT/KWT/OMN/JOR 使用
  `verifiedAt=2026-08-10T18:48:04Z`，IRN/IRQ/LBN/SYR 使用
  `verifiedAt=2026-08-10T18:55:45Z`；七批新增 refresh 依次使用
  `2026-08-10T19:36:45Z`、`2026-08-10T19:46:12Z`、`2026-08-10T20:09:01Z`、
  `2026-08-10T20:20:37Z`、`2026-08-10T20:39:16Z`、`2026-08-10T20:50:58Z`、
  `2026-08-10T21:00:43Z`。35 国仅 URY 保留既有道路
  1 regulation / 18 limits（底层 regulation `effectiveFrom=2023-05-14`；V5
  publishedOn 纠正为 `2025-11-13`，当前程序版本自 `2025-11-17` 启用）；其余
  34 国四 scope no-data、零 regulation/limit。AUS/PNG/CAN/USA 的 #244–#247 /
  ADR-133 保留当时完整性轨迹；其中 CAN/USA partial 非道路边界已由 #263–#264 /
  ADR-136 supersede。AUS 道路切换为 9→12 条、PNG truck 为 9 条；CAN 当前 target
  48 limits（road 8 + nonroad 40），USA 为 70（road 30 + nonroad 40），两国完整
  §1039 功率带统一 `verifiedAt=2026-08-11T05:21:45.000Z`。法定展示仍为 P<8…
  130≤P≤560 六带；§1039.140 / §1065.20(e) ties-to-even 对三位 raw 查询的翻译为
  `[0,7.5)`、`[7.5,18.501)`、`[18.501,36.501)`、`[36.501,55.5)`、
  `[55.5,129.5)`、`[129.5,560.501)`，故 560/560.001/560.500 kW 同属最高带、
  560.501 kW 无结果；加拿大 §1(4) 也纳入 calculation methods。ARE #173 的 2026 通用
  numeric 边界也由 #262 纠正为 regulation metadata 自 `2026-01-01`、普通 numeric
  自 `2027-07-01`。BRN/BTN/SLB/TLS/MWI/SLE/SOM/SSD/TCD/SLV/SUR/TTO
  已以 #248–#259 / ADR-134 固定为每国恰好两条当前 source、四 scope no-data，
  统一 `verifiedAt=2026-08-10T23:08:11Z`。
- 公开只读演示：<https://jamesky.site>。
- 运行版本：由 <https://jamesky.site/api/health> 的 `version` 字段确定。
- 生产运行版本：release `20260814144537`，来源 Git
  `38541ac04c079afe03860db63af839a48d2cb740`，于 2026-08-14 完成仅代码的
  版本化发布，不执行数据库写入。发布后独立读回复核 `/api/health`、PM2 降权进程、
  PM2 systemd 复活链路、Nginx、首页、聊天页、代表国家页、地图 Demo 清理和公开产品
  API 均通过；真实 AI 流式查询也完成模型、知识库工具、引用和最终回答的端到端读回。
- 运行库覆盖数量：2026-08-12 04:36 CST 从公开 `/api/countries` 读回 178 个唯一
  ISO3，全部为 `covered`；本轮 97 个目标国家均完成目标图与 scope 验收。`covered`
  只表示已发布核验边界，不表示四个 scope 都存在数值法规。
- `ACCEPTANCE.md` #166–#264 已随 release `20260812031745` 发布；选择闭包为
  `97 jurisdictions / 28 regulations / 651 limits / 203 sources`。DZA/ETH/NGA 旧 numeric
  图已按合同治理，LIE/SGP/MLT 运行库图已补齐，AUS/PNG/CAN/USA/CHN/MLT 的数值或
  成员边界均通过生产聚焦验收。签核表中保留的“本地 accepted / 待部署”文字是发布前
  审计轨迹，由本状态快照统一 supersede。

代码提交、公开站点和 PostgreSQL 治理发布是三个独立状态。站点运行相同代码并不
保证目标数据库已经发布该提交中所有 accepted fixtures；因此 README 不再用历史
Seed 计数代表线上覆盖。

## 安全与演示加固（2026-08-14，代码已发布）

- 公网走查曾发现运行库中的未签核真实产品会进入公开产品选项，且至少有一条
  功率区间/来源关联异常。当前本地代码已在产品列表、点名适配与认证出口统一实施
  fail-closed publication manifest；真实产品同时绑定实体、来源与规格版本，真实认证绑定
  实体与来源，两份 manifest 当前均为空。公开 DTO 也拒绝空/倒置功率或供应期区间。
- 首页原“结构化覆盖率”已改为“证据边界核验率”，并明示它不代表存在数值法规；
  零配置 Demo 另显示为“虚构演示切片”。首页 API 或地图 GeoJSON 失败时现在有独立错误与
  重试状态，不再继续显示“在线”或误导图例。
- AI evidence contract 对带 scope/power 的 1–5 国法规查询统一要求
  `compareRegulations`；同时询问法规与产品时必须分别取得法规比较与产品适配结果，
  无关国家 profile 不能解锁模型文字。工具拒绝、错误或畸形结果也有终态 UI，不再无限显示
  “正在执行”。AI 普通文本现以受限 GFM Markdown 渲染，支持标题、列表、表格、链接和
  代码块；结构化工具结果仍优先使用可复核卡片，不退化为纯 Markdown。
- 地图快捷入口上限为 8，国家抽屉打开时接管焦点，关闭/Escape 后返回实际触发控件；
  Demo `.invalid` 来源保留标题但不再渲染为死链。三分钟脚本也已将安装/启动移到计时前，
  并与公开 DTO 不展示 proposed 的实际边界对齐。

上述代码已随 release `20260814144537` 发布。发布后 `/api/products` 只返回
`DEMO-ENG-100` 与 `DEMO-ENG-200`，未签核真实产品不再进入公开出口；但运营层根因尚未
关闭：目标 PostgreSQL 的同名 `products_power_check` 实际仍为
`power_max_kw >= power_min_kw`，与仓库要求的严格 `>` 不一致，且 8 条未归档真实产品仍为
等宽功率区间。仓库现已新增 Migration `0011_temporal_memberships_and_product_power`：它先
检查脏数据，发现等宽/反向区间即以 SQLSTATE `23514` 原子失败，数据合规后才把目标约束
收紧为严格 `>`；因此生产应用该 Migration 前仍必须由数据负责人确认并归档或纠正这 8 条
产品及其来源关联。Migration 不猜测业务值，本次代码整改也没有擅自修改生产数据。

## 地图 Demo 公共出口清理（2026-08-14，代码已发布）

- 公开 PostgreSQL 国家地图与详情已排除 Demo 分类事实：Demo 国家摘要降为
  `no_data`，Demo 国家详情失败关闭；非 Demo 国家中的 Demo 辖区、成员关系、法规、市场
  指标或来源也不会进入国家详情及复用该 service 的 AI 国家画像。
- `pnpm demo` 的 PGlite fixture 保留，求职者仍可离线演示完整流程；本次不删除或修改
  生产数据库记录。地图图例改为中性的“有可查看数据”，不再把 Demo 与已核验数据并列。
- 修改前公网基线：CHN 含 1 个 Demo 辖区、2 条 Demo 法规、1 条 Demo 市场指标；BRA 含
  1 个 Demo 辖区、1 条 Demo 法规、1 条 Demo 市场指标。release `20260814144537` 已对
  这两国以及 `/api/countries` 做公开读回，国家地图与详情不再返回 Demo 分类事实。

## AI 证据边界加固（2026-08-15，本地待发布）

- `sales-chat-system-v3` 把检索正文和其中 URL 明确标为不可信外部数据；知识查询主题词
  必须与用户请求绑定，低相关度候选在 service 和工具结果两层失败关闭。
- 模型 Markdown 外链只允许使用同一助手消息中的结构化 citation URL；站内链接仍可用。
- 模型输出限制为 2048 tokens，证据边界最多缓冲 16000 字符；输入历史最多保留最近
  12 条用户消息且总计 12000 字符。超限输出不向用户释放。
- 以上是当前工作树状态，尚未部署到公网；发布后必须重新执行真实模型 SSE 与来源链接读回。

## AI 对话 Harness 与循环工程（2026-08-14，代码已发布）

- system instruction 已提取为 `sales-chat-system-v2`，以事实来源、工具路由、循环策略、
  回答契约和附件边界分段；没有增加模型作为法规、产品、市场或评分事实来源的权限。
- 工具循环现在按 evidence contract 动态收窄 active tools。缺少多项证据时只保留尚未满足
  的工具并继续 required；证据齐全、失败/不足、执行异常、缺参或纯附件概述后关闭工具，
  不继续消耗无关步骤。最终模型文字仍经过原有流级 evidence boundary。
- 新增 `pnpm ai:eval` 离线 harness，当前 13 个 golden prompts 覆盖问候、缺参、单国/
  跨国法规、市场、产品、混合意图、机会分、销售简报、来源、附件与空证据合同。它不调用
  外部模型，不得表述为真实模型任务成功率。发布后已用公开 `/api/chat` 完成真实模型与
  `searchKnowledgeBase` 的 SSE 读回；首次读回发现内部相对下载路径不能作为公开绝对来源
  URL，已由 `38541ac` 改为仅暴露已核验外部来源 URL，再次读回为结构化 `ok`。
- 当前质量门：`pnpm lint`、`pnpm typecheck`、48 个文件 / 944 条 Vitest、
  `pnpm ai:eval` 14/14、`pnpm build` 全部通过；完整 Playwright 为 71 passed / 7 skipped
  （桌面与 Pixel 7）。

## FDE 作品强化（2026-08-15，本地待发布）

- `product-fit-v2` 已把法规/认证适配与查询日供应状态拆成双轴，并按
  `[availableFrom,availableTo)` 组合 `commercialReadiness`；销售简报只推荐 `ready`
  产品，缺失或区间外供应证据进入风险/缺口。
- AI 审计键加入服务端 turn/request ID 并改为 append-only；公共 API、管理写入和 AI
  完成事件只输出 strict JSON 白名单字段，`X-Request-Id` 可用于故障关联。
- 国家深链在 scope + power 齐全时服务端渲染确定性决策摘要；完整 UUID、辖区与来源
  追溯默认折叠。`pnpm demo:fde` 可在隔离 PGlite 中演示 CSV → Draft → Review →
  Publish → Query → Archive，始终标记 `LOCAL / MUTABLE / FICTIONAL`。
- 最终 live eval 使用 `deepseek-v4-pro` 与隔离 PGlite 虚构事实完成 18/18 条、78,265
  tokens；工具选择 94.44%、关键参数 100%、安全/证据失败关闭 100%，报告
  `thresholdsPassed=true`。唯一失败单例为来源原文检索额外调用了国家画像工具；报告保留该
  明细，不将 94.44% 写成 100%，也不把这次内部 eval 表述为客户效果。
- 生产维护代码已具备精确 8 行 dry-run manifest、SHA/行漂移门、serializable 归档、逐
  实体审计、`pg_dump -Fc` 0600 + SHA256 + `pg_restore --list` 和迁移后 readback；尚未在
  生产执行，因此公开库脏数据与 Migration 0011/0012 仍不得标为已关闭。

## 三角色模拟评估与本地修复（2026-08-12）

- 三个 subagent 分别模拟海外销售/区域销售、法规/合规工程师和产品/应用工程师，
  走查零配置 Demo 与相关查询链路；完整场景、证据和 P0/P1/P2 见
  [SIMULATED_USER_EVALUATION.md](SIMULATED_USER_EVALUATION.md)。这是内部 AI 角色模拟，
  不是现实用户试点、法规专家签核或 KPI 测量。
- 模拟发现的 P0 历史时态问题已在当前本地工作树修复：`asOf` 派生
  `statusAtAsOf`，保留 `recordStatus`；现在 superseded 的记录可在其历史有效期返回，
  但必须有闭合的 `effectiveTo`；未来 adopted 必须有 `adoptedOn <= asOf`。空采纳日或
  未闭合 superseded 的异常数据 fail-closed，proposed 永不进入 effective 集合。详情、
  比较、product-fit 与 AI citation 的 DTO/测试同步调整。
- Demo 首屏降级、unknown 补数摘要、详情筛选进入 chat、聊天证据折叠/状态中文化/
  数值格式化、点名产品筛选、最近完整比较上下文、确定性销售简报路由及
  Demo/covered/verified 解释已实现。
- AI 对话当前本地工作树已进一步实现字段级多轮上下文（任务、比较组、目标国、scope、
  功率、日期、产品与国家资料主题）、查询参数 evidence contract、点名产品评分/简报、
  工具卡查询摘要，以及失败后显式原样/编辑重试；空契约、错误工具或错误参数失败关闭，
  附件内容不参与契约推导。Demo 销售简报会从已校验结构化结果直接提取机会分、首要风险
  和第一行动；详情页刚完成的产品查询也会立即同步到对话链接。该上下文仅限当前页面会话，
  不是长期记忆。
- 本轮质量门通过：`pnpm lint`、`pnpm typecheck`、46 个文件 / 910 条 Vitest、
  `pnpm build`；默认 Playwright 桌面/移动端 71 passed / 7 skipped，最终 Markdown
  桌面/Pixel 7 聚焦回归另有 2 passed。这些是工程回归结果，不是用户效果 KPI。
- 上述 AI 对话、证据门、详情链路、公开产品隔离和 Markdown 渲染已包含在当前在役
  Git `a77631b…`；公开站点运行状态以本文件前述生产 release 为准。

## 代码与数据基线

| 项目 | 当前代码状态 | 语义 |
| --- | --- | --- |
| 国家目录 | 178 个 ISO3 目录记录 | 目录覆盖不等于存在法规数值 |
| 地图几何 | 177 个唯一 ISO3 feature | 用于国家选择，不用于法律边界判断；仅 MUS 无几何 |
| 法规验收 | `docs/ACCEPTANCE.md` #1–#264；发布选择闭包 97 jurisdictions / 28 regulations / 651 limits / 203 sources | #166–#264 已由 release `20260812031745` 发布并完成生产聚焦验收。ECU/PHL/PAK/SAU/ARE/ISR/ZAF/RWA 与 LKA 保留已闭合路径；LKA 自 2018-07-13 保留道路 5+5 与工程 24 条、agriculture no-data；UGA 为 effective metadata-only；KHM/LAO/MMR/MNG 及其余未闭合 scope 失败关闭。DZA/ETH/NGA 旧 numeric 图已治理；#263–#264 取代 CAN/USA partial 非道路边界；MLT/CHN、ARE 日期与 CAN/USA ties-to-even raw 查询翻译均已生产读回。 |
| 市场观测 | 24 条签核 fixture | CHN/USA/DEU/BRA 的 2022/2023 观测与确定性同比 |
| 真实产品/认证 | 0 条获准公开 fixture | 产品适配的本地示例仍为显式虚构 Demo |
| Demo 产品 | 2 个稳定配置 | 只验证 `fit/not_fit/unknown` 和证据链 |

`data_coverage_status=covered` 表示该国家的已核验来源边界已经通过治理发布；它不保证
卡车、客车、工程和农业四个 scope 都有可发布法规。具体事实仍由带 `asOf`、scope 和
功率的 Repository 查询及其 `no_data` 结果决定。

## 三种运行模式

| 模式 | 命令 / 地址 | 数据 | AI | 用途 |
| --- | --- | --- | --- | --- |
| 零配置作品 Demo | `pnpm demo` | 进程内 PGlite + 虚构 fixture | 确定性离线模拟，仍调用只读工具 | 招聘方本地快速体验 |
| 标准开发 | `pnpm dev` | PostgreSQL / Supabase | 可选服务端 OpenAI-compatible | 开发、真实治理发布与检索 |
| 公开只读演示 | <https://jamesky.site> | PostgreSQL 中已发布事实 + 明确 Demo | 服务端模型，只读工具 | 作品展示，不是业务生产系统 |

零配置 Demo 只能在 `NODE_ENV=development`、`DATABASE_MODE=pglite-demo` 下启用；
生产误设 `PORTFOLIO_DEMO_MODE=true` 会失败关闭。

## 已完成能力

- MapLibre 世界地图、键盘/触控入口和可分享国家 URL；
- 状态/有效期/核验时间分离的法规查询；
- 本地查询从 `asOf` 派生 `statusAtAsOf` 并保留 `recordStatus`，历史有效期可返回
  当前已 superseded 的法规；该能力尚不构成完整 `knownAsOf` 双时态；
- 确定性 product-fit、市场可比性和机会评分；
- 七个 Zod 只读 AI 工具、流式证据门和结构化来源卡片；
- 受限图片/PDF/文本附件入口：图片仅在视觉模型可用时开放并验证结构/像素，PDF 按流
  在页数、字符、15 秒与资源清理边界内提取；发送后释放原始 base64，纯附件概述与
  法规/认证/产品/市场事实意图分门，上传内容不能绕过事实证据门；
- 文档导入、分块、元数据过滤和混合检索开发台；
- Draft → Reviewed → Published、职责分离、CSV Preview、软归档和审计；
- 治理数据 v4 十表快照（含 `market_metrics`）、SHA/引用闭包 dry-run 与 serializable
  单事务恢复；PGlite 已覆盖
  六位微秒、原始 JSONB 高精度数、目标自然键/外部副作用写前检查、advisory maintenance
  lock、物理精确恢复和中途失败整单回滚（ADR-132）；
- CI、桌面/移动 Playwright、密钥扫描、依赖审计和部署代理边界。

## 尚未完成 / 不应过度声明

- 没有获准公开的真实产品主数据和认证，因此不能证明真实商业可售性；
- 公开演示不是正式法规服务或业务生产环境；
- 尚无外部法规专家独立签字和真实销售用户试点 KPI；
- 三角色 subagent 模拟不能替代上述签字、试点或 KPI；
- 正式 embedding 基准、私有对象存储、监控、生产快照恢复与 Migration
  回滚演练仍待业务生产化；
- source-only 覆盖不能描述成该国已经存在完整排放限值。

## 更新规则

以下变化必须同步更新本文件，而不是继续修改 README 中的固定数字：

1. 国家目录或地图 feature 数变化；
2. `ACCEPTANCE.md` 签核行数变化；
3. 真实产品/认证首次发布；
4. 公开站点运行模式或 URL 变化；
5. 公开演示升级为业务试点或生产系统。
