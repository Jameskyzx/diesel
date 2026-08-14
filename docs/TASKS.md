# 实施任务与验收阶段

> 本文件同时保留历史计划与推进记录。当前代码、运行库和公开站的可验证快照以
> [STATUS.md](STATUS.md) 为准；历史条目中的数量不做追溯改写。

## 1. 拆分原则

- 每一阶段形成一个可独立验收的纵向或基础切片。
- 一次只执行当前明确请求的阶段，不顺带实现后续功能。
- schema、规则、UI 和 AI 工具分别测试，但最终以真实业务 fixture 串联。
- 每个实现任务完成后执行 `AGENTS.md` 要求的相关检查。
- 阶段内出现新的依赖或 schema 变化时，先更新决策和迁移计划。

## 2. 阶段 0：MVP 数据与安全决策门

### 目标

冻结能够驱动实现和测试的最小业务切片。

### 任务

- 选择 3–5 个国家和至少 2 个 application scopes。
- 为每个 scope 选择代表性法规、状态和边界案例。
- 定义 2–3 个市场指标及单位/期间/方法。
- 提供 5–10 个产品配置和认证证据。
- 确认 product-fit 规则与责任人。
- 确认访问模型、数据分类和部署区域。
- 确认模型/Embedding 供应商、维度和数据处理约束。
- 完成地图、法规文件、产品手册和报告的数据许可清单。

### 产出

- 更新后的 `docs/DECISIONS.md`。
- 受控的数据源清单与 fixture 说明（不必在本阶段写应用代码）。
- 明确的 stale 阈值与核验责任。

### 验收

- 所有阻塞项有明确答案、负责人或“不进入 MVP”的结论。
- 每个测试事实都能定位到允许使用的来源。
- 不用模型推理即可写出法规适用和 product-fit 的期望结果。

## 3. 阶段 1：工程脚手架与质量门

### 目标

建立不含业务功能的可构建工程。

### 任务

- 使用 pnpm 初始化 Next.js App Router + strict TypeScript。
- 配置 Tailwind CSS 和 shadcn/ui 基础。
- 配置 ESLint、typecheck、Vitest 和 Playwright。
- 建立 server-only 环境校验和示例环境变量文件。
- 建立基础布局、全局错误/加载状态和 `/api/health` 健康检查。
- 编写本地启动与质量检查说明。

数据库依赖和 Drizzle 配置按阶段 1 的明确范围延后到阶段 2，与首个受审核 schema 一起引入；本阶段不创建空数据库抽象。

### 验收

- `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 通过。
- Playwright smoke test 能启动应用并验证基础页面。
- 敏感环境变量不能从 Client Component import。
- 依赖用途记录在决策文档或 package metadata 说明中。
- `/api/health` 返回经过 schema 校验的结构化 JSON。

## 4. 阶段 2：结构化数据库核心

### 目标

实现国家、司法辖区、法规、市场、产品、认证和来源的最小可查询 schema。

### 任务

- 本阶段没有空间或向量计算需求，因此不启用 PostGIS/pgvector extension。
- 配置 Drizzle 与 Supabase PostgreSQL 服务端连接。
- 按 `DATA_MODEL.md` 创建 Drizzle schema 和首个 migration。
- 建立约束、外键和基础索引。
- 创建确定性 seed/fixture。
- 实现 repository 层的国家、法规有效期和产品适配证据查询。

### 验收

- 空库可完整迁移，seed 可重复运行。
- migration 不依赖手工修改生产数据库。
- 有效期、状态、区域成员、功率上下界和产品认证集成测试通过。
- 关键事实均可返回 source 与 verified_at。
- proposed 不会出现在默认 effective 查询中。
- 所有 seed 记录明确标记为虚构 demo，不作为真实法规或市场事实。

## 5. 阶段 3：领域服务与确定性规则

### 目标

把业务判断从 UI、SQL 拼接和 LLM 中抽离。

### 任务

- 实现国家 profile 与覆盖状态 service。
- 实现 applicable regulation service。
- 实现市场指标可比性 service。
- 实现版本化 product-fit 纯函数和 reason codes。
- 若评分规则已批准，实现版本化确定性营销评分。
- 定义 application service 的 Zod DTO。

### 验收

- 同一输入总是得到同一 fit/score。
- 每个结论包含原因、规则版本、来源和数据缺口。
- `[min,max)`、日期、status 和 scope 的边界单元测试通过。
- 缺少认证/数据时为 unknown/partial_fit，不做乐观推断。

## 6. 阶段 4：地图与国家详情纵向切片

### 目标

让试点用户能从地图进入一个真实国家的完整只读详情。

### 任务

- 选择有明确许可的简化世界 GeoJSON，校验 ISO3 完整性。
- 实现 MapLibre 客户端组件。
- 实现 hover/focus 预览和 click 选择。
- 实现 `/countries/[iso3]` 及筛选 query 参数。
- 展示国家信息、法规状态/日期/范围/功率、来源和核验日期。
- 实现 loading、empty、no-data 和 error 状态。

### 验收

- 桌面 hover、键盘 focus 与移动 click 均可访问关键信息。
- 点击国家生成并可重新打开的分享 URL。
- 无数据国家有明确状态。
- 地图 state 只保留小型选择/摘要数据，不保存 geometry 副本。
- Playwright 覆盖指针与触摸 viewport。

## 7. 阶段 5：市场与产品适配 UI

### 目标

在国家详情中完成市场查看、产品选择和可解释适配。

### 任务

- 展示市场指标定义、期间、单位、方法和来源。
- 实现同口径国家比较。
- 实现产品配置选择和 fit 卡片。
- 展示法规、功率、应用、认证各检查项。
- 展示来源、新鲜度、unknown/partial 状态和可选确定性评分。

### 验收

- 不可比指标不能生成误导性排名。
- fit 结果与阶段 3 service 完全一致。
- LLM 尚未接入时也能完成所有权威事实查询。
- Playwright 覆盖 fit、not_fit、unknown 和 stale 来源。

## 8. 阶段 6：文档入库与混合检索

### 目标

为法规解释和 AI 证据建立可追溯知识库。

### 任务

- 实现文档登记、哈希、对象存储引用和许可字段。
- 实现结构感知分块及 locator。
- 写入明确的司法辖区、国家、scope 和有效期 metadata。
- 实现 PostgreSQL 全文检索。
- 在模型/维度已批准后实现 embeddings 和 pgvector 查询。
- 建立小型检索基准集，测量 metadata filter、recall 和 locator 正确性。
- 代表性数据达标后再决定是否增加向量索引。

### 验收

- 每个结果可回到文档和页码/章节。
- 不匹配日期/scope 的片段被过滤或显式警告。
- 混合检索优于或不劣于基线关键词检索的预定指标。
- 重复文档被内容哈希识别。
- 无许可文档不会被错误公开展示。

## 9. 阶段 7：单 Agent 营销分析助手

### 目标

在已有确定性服务之上增加受约束的自然语言分析。

### 任务

- 使用 Vercel AI SDK 配置单 Agent。
- 注册 `searchKnowledgeBase`、`getCountryProfile`、
  `findCompatibleProducts`、`compareRegulations`、`compareMarkets`、
  `calculateOpportunityScore`、`generateSalesBrief`。
- 为每个工具定义 Zod 输入/输出、限制和错误码。
- 实现证据不足、工具失败和范围冲突处理。
- UI 渲染结构化比较、产品、风险和来源卡片。
- 增加工具调用审计与最小化日志。
- 使用 mock model 和 tool fixtures 进行测试。

### 验收

- 法规/市场/产品事实问题触发工具，不靠无工具文本回答。
- 输出中的数值、日期、状态、评分和来源与工具结果一致。
- 工具没有提供证据时，AI 明确说明不足。
- proposed 与 effective 不混淆。
- Agent 无数据写入、任意 SQL、任意网络访问或子 Agent 能力。

### 阶段 6 实施记录（2026-07-29）

- [x] AI Gateway server-only 模型适配与流式 `/api/chat`
- [x] 三个 Zod 输入/输出、只读工具
- [x] 地图国家缺省上下文与明确工具国家优先
- [x] 第一模型步骤强制工具、最多 5 个工具步骤
- [x] 无证据时服务端流级替换模型结论，防止伪造法规
- [x] 结构化来源、页码/章节、法规状态和 freshness 卡片
- [x] `ai_chat_sessions`、`ai_tool_calls`、`ai_citations` Migration 与审计测试
- [x] mock model 法规无证据与产品适配自动测试
- [x] 桌面/移动端聊天面板可访问性流程

未纳入本阶段：用户身份、速率限制、完整消息历史、正式模型审批、多 Agent、
任意 SQL/网络工具和事实写入。

### 阶段 7 营销分析实施记录（2026-07-29）

- [x] 数据库法规比较，严格区分 `effective` 与未来 `adopted`
- [x] 结构化市场指标比较与 scope/单位/币种/methodology/period 可比性检查
- [x] `opportunity-score-v1` 纯函数、服务端可配置权重和逐项贡献解释
- [x] 缺失/`unknown` 保持 `null`、有效权重重归一化和数据覆盖率
- [x] 结构化 `generateSalesBrief` 八个必需字段
- [x] 适配产品、法规、限值、市场观测和认证来源追溯
- [x] 确定性事实、规则生成销售动作与 AI 自然语言解释的 UI 分层
- [x] 四个工具接入单 Agent、Zod 契约、步数限制和审计日志
- [x] 确定性、缺失语义、Repository、简报形状和 Demo 纵向服务测试

未纳入本阶段：真实市场指标方向审批、汇率/单位换算、绝对市场基准、评分结果
持久化、排行榜、人工调分、多 Agent 或生产访问控制。当前 Demo 分数不得作为真实
市场判断。

## 10. 阶段 8：安全、性能与试点发布

### 目标

让已完成的 MVP 纵向切片可安全交给试点用户。

### 任务

- 实施已决定的认证/授权。
- 完成 AI route 速率限制、请求限制和错误脱敏。
- 完成缓存/失效和来源 freshness 告警。
- 检查 bundle、地图加载、数据库查询计划和可访问性。
- 执行依赖、许可、密钥和日志审计。
- 完成备份/恢复、迁移回滚和运营 runbook。
- 建立 CI，执行 lint、typecheck、test、build 和适用的 Playwright 流程。
- 进行法规专家和销售用户验收。

### 验收

- 所有要求检查通过，Playwright 覆盖关键用户流程。
- 浏览器 bundle 和网络响应不包含服务密钥或未授权内部数据。
- 专家对 fixture 法规结论和产品适配签字。
- 已知限制和 stale 数据在 UI 可见。
- 有发布、回滚和数据纠错流程。

## 11. 不应合并为一个任务的工作

以下组合会使验收边界不清，应该分开：

- “搭建工程 + 完整数据库 + 地图 + AI”。
- “文档抓取 + 自动抽取 + 专家核验后台”。
- “product-fit 规则 + AI 推荐文案”。
- “加入 pgvector + 调参 + 建索引”，除非已有检索基准。
- “实现认证 + 公开部署”，除非访问模型已批准。

## 12. 当前完成状态

| 阶段 | 状态 | 已完成范围 | 剩余范围 / 阻塞 |
| --- | --- | --- | --- |
| 需求、架构与工程约束 | 已完成 | PRD、架构、数据模型、ADR、`AGENTS.md` | 进入试点前需随已批准业务决策同步更新 |
| 阶段 0：MVP 数据与安全决策门 | 法规数据门已签核；业务生产门部分阻塞 | 分层覆盖、四类 scope、来源/验收边界与 `ACCEPTANCE.md` #1–#264 已签核；公开作品的数据失败关闭边界可确定性验证 | 真实产品/认证、市场指标与评分、正式模型/Embedding、业务身份、许可再分发、SLA owner、语言、区域和保留策略仍受 ADR-016–023 对应未决项约束 |
| 阶段 1：工程脚手架与质量门 | 已完成 | Next.js、TypeScript、pnpm、Lint、分层 coverage、Vitest、Chromium/WebKit Playwright、独立 Demo E2E、liveness/readiness、真实 PostgreSQL + pgvector migration smoke、GitHub CI、gitleaks、限时依赖公告门禁、受保护 `master` | 持续保持检查全绿并处置依赖公告 |
| 阶段 2：结构化数据库核心 | 开发完成，公开作品 PostgreSQL 已接入 | Drizzle Schema、Migration、确定性 Demo Seed、Repository、PGlite 集成测试及空库/升级 PostgreSQL smoke | 业务生产仍需独立备份恢复演练、Migration 责任人和变更窗口；真实数据不得使用 Demo Seed 替代 |
| 阶段 3：领域服务与确定性规则 | 部分完成 | 国家服务、法规/市场比较、`product-fit-v1`、`opportunity-score-v1`、Zod DTO 与已签核真实法规 fixture；`application_scope` 已含 `on-road-truck`/`on-road-bus`（ADR-039） | 真实产品/认证配置粒度、`partial_fit`、市场评分方向和业务批准人仍受 ADR-020/021 阻塞；不再以 ADR-015 声称真实卡车/客车法规 fixture 尚未形成 |
| 阶段 4：地图与国家详情 | 作品切片完成并已发布 | 全球目录、ISO3 分享 URL、国家详情、无数据状态、筛选恢复、freshness 告警、版本化 immutable GeoJSON 及桌面/移动测试；当前数量见 STATUS | 业务用途许可与持续 SLA owner 仍未完成；新增来源继续按 acceptance/治理发布流程更新 |
| 阶段 5：市场与产品适配 UI | 作品切片完成 | 已核验公开市场观测、Demo 产品选择、适配卡片、来源与三态适配 | 真实产品/认证、指标业务审批、`partial_fit` 和独立跨国比较体验未完成 |
| 阶段 6：文档入库与混合检索 | 开发切片完成 | TXT/Markdown、本地私有文件、哈希去重、分块、metadata filter、全文/向量混合检索 | 生产对象存储、PDF/OCR/Word、正式 Embedding、许可控制和检索基准未完成 |
| 阶段 7：单 Agent 营销分析助手 | 功能切片完成，生产待批准 | 7 个只读工具、结构化卡片、证据不足保护、审计、共享 PostgreSQL 限流和 mock model 测试 | 正式模型/区域/预算、身份关联和保留策略未完成 |
| 阶段 8：安全、性能与试点发布 | 公开作品已上线，业务生产未完成 | 公开只读站、管理路由阻断、角色保护、治理后台、审计、CI、Playwright/axe 核心 smoke、密钥扫描、限时依赖门禁、安全响应头、限流与错误脱敏；部署矩阵和历史性能/许可基线 | 业务生产身份代理、备份恢复、监控、完整人工可访问性审计及专家/销售验收未完成 |

### 用户阶段编号对照

2026-07-29 的实施任务将“世界地图垂直切片”命名为阶段 3；它对应上述长期
计划阶段 4 的基础子集，已完成：

- [x] Natural Earth 简化世界 GeoJSON 与 ISO3 校验
- [x] MapLibre hover/click 高亮、Tooltip 和移动端 click
- [x] CHN、BRA、DEU 三个显式虚构 Demo 国家
- [x] `/api/countries` 摘要和 `/api/countries/[iso3]` 详情
- [x] `/countries/[iso3]` 分享、刷新恢复和 Drawer 内切换
- [x] 原生选择器键盘/触控入口与无数据状态
- [x] Playwright 的打开、恢复、切换、无数据和移动 viewport 覆盖

长期计划阶段 4 仍不标记为业务生产全部完成：真实法规 fixture 与 application
scope / 功率筛选已经形成，当前剩余的是 #166–#264 与 LIE/SGP 既有图的
97 国生产同步，以及 ADR-018/019 下的业务用途许可、
持续核验 owner 与 SLA；不得继续把
ADR-015 写成已签核法规 fixture 的通用阻塞。

2026-07-29 的用户“阶段 4：国家详情和产品匹配”已完成以下受控子集：

- [x] 国家概览、当前有效法规、未来已通过法规和市场指标
- [x] 产品、法规、认证、来源与最近核验时间的真实 API/Repository 链路
- [x] `product-fit-v1` 纯函数与 Zod 输入/输出
- [x] `fit | not_fit | unknown` 三态及确定性 reason codes
- [x] 法规记录 ID、认证记录 ID 与来源追溯
- [x] 功率 `[min,max)` 和认证日期 `[from,to)` 边界单元测试
- [x] 桌面与移动 Playwright 三态产品适配流程

长期计划阶段 3 与阶段 5 仍不整体标记完成：市场跨国可比性、stale SLA、
真实产品配置/认证粒度、`partial_fit` 和营销评分仍分别受 ADR-019、ADR-020 与
ADR-021 阻塞；已签核法规 fixture 不再列为 ADR-015 阻塞项。

2026-07-29 的用户“阶段 5：文档导入和混合检索”已完成最小开发者切片：

- [x] TXT/Markdown 上传、server-only 文件保存和 SHA-256 去重
- [x] `processing | ready | failed` 明确处理状态
- [x] 标题/段落切块、页码/章节 locator 和 chunk metadata
- [x] 生成式 PostgreSQL `tsvector` 与 GIN 索引
- [x] `local-hash-embedding-v1` 与 pgvector 精确 cosine 查询
- [x] country、jurisdiction、scope、as-of metadata filter
- [x] 固定权重混合排序及关键词/向量/最终得分调试
- [x] 文档来源、chunk、章节和原始文件下载追溯
- [x] `/dev/knowledge` 及对应 API 的开发环境限制

长期计划阶段 6 仍不整体标记完成：PDF/OCR/Word、生产对象存储、真实
Embedding provider、许可控制、检索基准与向量索引决策仍受 ADR-017、
ADR-018 和代表性语料缺失阻塞。

2026-07-29 的用户“阶段 8：管理后台和数据治理”已完成受控后台切片：

- [x] `/admin` 与 `/api/admin/*` 服务端身份/角色保护
- [x] `editor | reviewer | admin` 权限矩阵和禁止 reviewer 自审
- [x] 国家、法规、产品、认证、市场指标、来源的版本草稿编辑
- [x] `Draft -> Reviewed -> Published` 发布门和正式查询隔离
- [x] 法规/限值发布事务、before/after 变更审计
- [x] 市场 CSV 严格预览、逐行错误和确认事务
- [x] 错误批次整体拒绝，正确批次只原子创建未发布草稿
- [x] 文档上传为 Draft、失败状态、未发布文档重新处理
- [x] 文档 `ready + published` 正式检索门
- [x] 来源最近核验时间更新和审计
- [x] admin 软归档与正式 Repository 的 `archived_at` 过滤
- [x] 权限、可见性、CSV 原子性、法规审计、空库 Migration 和后台 UI 测试

该切片不等于长期计划“阶段 8：安全、性能与试点发布”全部完成。生产身份供应商、
Header 注入代理、数据 owner/SLA、审计防篡改/留存、生产对象存储、速率限制、
备份恢复、CI/CD 与法规专家签字仍属于发布前工作。

### M1/M2 实施记录（2026-07-30）

- [x] Migration `0005_on_road_truck_bus_scopes`：`ALTER TYPE application_scope
  ADD VALUE 'on-road-truck' / 'on-road-bus'`（ADR-039，DATA_MODEL §2.2 既定标识）
- [x] 消除 `features/countries/schemas.ts` 的重复 scope 枚举，统一引用 canonical
  数组；产品适配面板增加卡车/客车中文标签
- [x] `country-catalog.ts`：174 国确定性静态目录（名称对齐已入库地图索引，
  iso2/区域取自同版本 Natural Earth ca96624，公共领域署名来源，非 demo）
- [x] 覆盖状态首版词表 `none/demo/planned/no_data`（ADR-040）：25 个分层目标
  `planned`、其余 `no_data`，CHN/BRA/DEU 保留 `demo` fixture
- [x] 国家详情服务按覆盖状态门控，目录国家保持精确 `no_data` API 契约；
  地图高亮、tooltip 与“已录入”快捷入口只展示详情可见国家
- [x] GitHub CI：quality（lint/typecheck/test/db:check/build）、e2e（Playwright
  Chromium）、secrets（gitleaks 固定版本 + SHA-256）、audit（critical 门禁）
- [x] 站点横幅与 README 求职作品免责声明；smoke 测试覆盖横幅可见性
- [x] 集成测试更新：174 行目录、词表分布、目录行来源、新枚举值读写、
  服务门控；全套质量门通过
- [x] 对抗式评审 8 项确认问题已修复：CI 先装固定版本 pnpm 再 setup-node
  缓存、Playwright html 报告与 traces 产物、master 推送不取消并发运行、
  README/页脚/种子说明的目录数据措辞、DATA_MODEL §2.2 枚举现状、
  PostgreSQL ≥ 12 最低版本说明

未纳入本次：真实法规/市场/产品事实（ADR-015 阻塞）、分支保护与合并门（仓库
设置）、AI 速率限制与错误脱敏、环境配置矩阵与部署检查单、next 工具链 high
级依赖公告的上游修复。

## 13. 后续推进计划（更新于 2026-07-29 20:05 CST）

### 13.1 计划假设

- 当前 Mac 已完成源码恢复、依赖安装、质量门和 Demo 模式验收；私有 GitHub
  remote、Supabase 开发数据库、开发 AI 模型与本地管理员角色已经接入。生产身份
  代理、业务决策门和生产环境仍待配置。
- 周期按一个研发小组、法规/销售/IT 负责人兼职评审估算；外部审批等待时间不计入
  研发工期。
- 未完成决策门前，可以完善 CI、安全测试和运行手册，但不得把 Demo 数据、开发
  Embedding 或信任任意客户端 Header 的入口当作生产方案。
- 密钥和数据库连接串只进入部署平台或本地忽略文件，不进入任务表、提交或日志。

### 13.2 里程碑计划表

| 顺序 | 优先级 | 里程碑 | 建议周期 | 当前状态 | 主要交付物 | 完成标准 | 前置依赖 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| M0 | P0 | Mac 接手与协作基线 | 0.5–1 天 | 已完成（本地开发） | Git 身份、私有 remote、真实 `.env.local`、目标数据库连接 | `git fetch/push` 可用；目标空库 Migration 通过；本地健康检查正常；无密钥入库 | 生产身份代理与部署环境转入 M6 |
| M1 | P0 | 冻结作品数据决策门 | 3–5 个评审日 | 已完成（授权签核；IND 已于 2026-08-07 补回） | 分层国家覆盖、四类动力场景、公开来源清单、语言、SLA、模型/Embedding 与评分规则 | 重点国家均有来源清单和验收样例；ADR-015–023 均有明确结论或不进入作品范围 | 语言（ADR-022）与产品/市场规则（ADR-020/021）仍待业务会签 |
| M2 | P0 | CI 与发布安全基线 | 3–5 个研发日 | 已完成 | CI、受保护 `master`、依赖/密钥检查、AI 请求限制、错误脱敏、环境配置矩阵和部署检查单 | 每次合并自动执行 lint、typecheck、test、build 和关键 Playwright；未授权请求与日志不泄露敏感信息 | 持续运维 |
| M3 | P0 | 真实数据试点切片 | 1–2 周 | 法规与公开市场切片已形成；真实产品认证仍阻塞 | 已许可的法规/来源、产品配置/认证、市场指标；经 Draft → Reviewed → Published 发布 | 每个事实可回溯来源和核验人；真实产品认证支持可复核 fit 边界 | M1；业务 owner 与目标数据库 |
| M4 | P1 | 核心用户流程收口 | 1–2 周 | 进行中（筛选 URL、stale 告警、状态补齐已完成；真实市场比较待 ADR-019/020） | 国家筛选 query 参数、真实市场比较、stale 告警、经批准的适配规则、完整 loading/empty/error 状态 | 分享 URL 可复现筛选；不可比指标不排名；真实 fixture 覆盖 fit/not_fit/unknown；关键桌面/移动流程通过 | M3；ADR-019–021 |
| M5 | P1 | 生产知识库与 AI | 1–2 周 | 阻塞 | 生产私有对象存储、所需文件解析器、正式 Embedding、检索基准、正式 AI 模型与预算/保留策略 | 许可和权限过滤有效；检索达到预设 recall/locator 指标；AI 事实与引用一致；无证据时拒绝肯定结论 | M1、M3；ADR-017/018/022/023 |
| M6 | P0 | 公开作品部署 | 1 周 | 求职作品已上线；业务生产门仍阻塞 | 公开只读托管、限流、免责声明、管理路由阻断、健康检查和数据分类 | 作品站可访问且不暴露管理面；业务生产另需身份、备份、监控和回滚演练 | M2；业务生产仍依赖 ADR-016/023 |
| M7 | P0 | 求职展示验收 | 2–3 个评审日 | 已完成首版 | README 案例、架构图、三分钟演示脚本、已知限制、真实截图和零配置 Demo | 招聘方可用 `pnpm demo` 复现证据链；项目边界和个人贡献可在 3–5 分钟讲清 | 持续根据面试反馈迭代 |

建议先完成 M0 和 M1。M1 未关闭前，M2 中不依赖业务选择的 CI/安全工作可以并行，
但不建议继续增加新的产品功能。

### 13.3 立即执行清单

| 顺序 | 负责人角色 | 需要提供 / 决定 | 更新位置 | 完成标志 |
| --- | --- | --- | --- | --- |
| 1 | 项目负责人 | 公开 GitHub 仓库和提交者身份 | 本地 Git 配置，不写入业务文档 | `Jameskyzx/diesel` 已公开，`master` 已保护 |
| 2 | IT / 数据库负责人 | Supabase/PostgreSQL 项目、连接方式、环境划分和备份责任 | 部署密钥；ADR-023 | 东京开发数据库、Migration 与本地连接已通过；备份责任和恢复演练待完成 |
| 3 | 法规负责人 | 首批国家、scope、法规来源、核验日期、stale SLA 和签字人 | ADR-015、018、019 | 真实法规 fixture 可由确定性预期结果验收 |
| 4 | 产品与销售负责人 | 按产品/市场证据模板提供配置与来源，决定市场指标口径、共同期间、评分方向和 fit/partial 规则 | `docs/PRODUCT_EVIDENCE.md`、`docs/MARKET_EVIDENCE.md`、ADR-020、021 | 规则样例和边界案例签字，Demo 权重不再代替业务结论 |
| 5 | IT / 安全 / 法务 | 身份供应商、用户范围、数据分类、区域、日志保留和外部模型限制 | ADR-016、017、018、023 | 可画出并批准生产信任边界和数据流 |
| 6 | 产品负责人 | 中文/英文/双语范围，以及原文、翻译和检索策略 | ADR-022、PRD | UI、语料和验收语言确定 |
| 7 | 研发 | 在上述输入到位后，把每个里程碑拆成独立 issue/PR | 私有仓库 issue tracker | 每项任务有负责人、验收条件、依赖和目标迭代 |

### 13.4 当前推进记录

| 时间 | 项目 | 状态 | 结果 / 后续 |
| --- | --- | --- | --- |
| 2026-07-29 | Mac 运行环境 | 已完成 | Node.js `22.22.3`、pnpm `11.9.0`、依赖、Chromium 与全套质量门通过 |
| 2026-07-29 | 私有 GitHub 协作基线 | 已完成 | `Jameskyzx/Weichai` 私有仓库、SSH 认证和 `master` 推送可用；分支保护待 M2 配置 |
| 2026-07-29 | Supabase 开发数据库 | 已完成 | `Weichai` Free/nano 项目位于东京 `ap-northeast-1`；Data API 关闭；IPv4 Session Pooler 连接、空库 Migration 和明确标记的 Demo Seed 通过 |
| 2026-07-29 | 本地联调 | 已完成 | `/api/health`、`/api/countries` 和 `/countries/CHN` 返回成功；开发服务器使用 `.env.local` 中的 Supabase 连接 |
| 2026-07-29 | 开发 AI 与管理员 | 已完成 | OpenAI-compatible `deepseek-v4-pro` 文本、强制工具调用和 `/api/chat` 通过；`jameskyzx@qq.com` 的管理员 API 角色验证为 `admin` |
| 2026-07-29 | 作品定位与覆盖范围 | 已确认 | 公开只读求职作品；全球国家目录、25 个主流国家分层覆盖；卡车、客车、工程机械、农业装备四类动力 |
| 2026-07-30 | M1/M2 实施（scope / 目录 / CI / 免责） | 已完成 | Migration `0005` 增加 `on-road-truck`/`on-road-bus`（ADR-039）；174 国基础目录入库，覆盖词表 `none/demo/planned/no_data` 与详情门（ADR-040）；GitHub CI 质量门、Playwright、gitleaks 密钥扫描与依赖审计；站点与 README 免责声明。全套本地质量门通过 |
| 2026-07-30 | M1 数据决策门来源调研 | 已完成（待签字） | `docs/SOURCES.md`：五国 × 四类动力的官方来源清单、许可矩阵、验收样例草稿与 stale SLA 建议；CHN/USA/EU/BRA 条目经对抗式核验（EUR-Lex 经 CELLAR 间接核验），IND 全部条目待可达网络复核 |
| 2026-07-30 | M2 剩余：速率限制与部署基线 | 已完成 | `/api/chat` 每 IP 固定窗口速率限制（ADR-041，默认 30/小时）；错误脱敏强化（AI SDK 校验错误归 400、503 通用化、客户端解析错误信封）；`docs/DEPLOYMENT.md` 环境矩阵、分支保护操作与发布前检查单；IND 有限复核（moef.gov.in 机构归属间接核验、OGL 假设负面核验）。评审确认 9 项全部修复，全套质量门通过（Vitest 61/61、Playwright 22） |
| 2026-07-30 | M2 收口：性能/许可审计与签核单 | 已完成 | 性能基线（地图 chunk 369 KB gz、geojson 92 KB gz、174 行目录查询计划全部走索引）与生产依赖许可审计（全宽松许可；唯一 copyleft 为服务端 sharp/libvips LGPL 原生二进制）写入 DEPLOYMENT §5；新增 chat 错误态 e2e 时发现并修复真实缺陷：AI SDK 传输信封（id/trigger）被 `chatRequestSchema.strict()` 拒绝导致 UI 发送恒 400；`docs/ACCEPTANCE.md` 签核单成形（13 条样例）。质量门 Vitest 62/62、Playwright 24 通过 |
| 2026-07-30 | M3 第一刀：签核事实 fixture | 已完成 | `src/server/db/seed/acceptance-fixtures.ts`（CHN/USA 已核验限值 + DEU/BRA 文书状态时点；IND 已移出）+ 8 条确定性验收测试全部通过 |
| 2026-07-30 | PR#1 推送与 CI 首次实跑 | 已完成 | PR #1（四切片）在 GitHub 四检查全绿（quality 1m41s / e2e 3m11s / secrets 6s / audit 17s）；首轮暴露并修复三项 CI 环境问题（gitleaks 改用 gh token 下载、audit job 去除 pnpm 缓存、e2e 降并发加超时）；分支保护/Secret scanning 受免费私有仓库限制（403/422），转入 M6 公开化时启用，合并门暂以约定执行 |
| 2026-07-30 | M3 第一刀：签核事实入目标库 | 已完成 | 覆盖词表增加 `covered`（ADR-042），地图/tooltip 区分 Demo 与已核验；5 来源 + 5 法规（40 限值）经后台 Draft → Reviewed → Published 入 Supabase 开发库（审计日志齐全、editor/reviewer 分设），CHN/USA 覆盖状态迁至 `covered`；5 条验收查询在目标库全部 PASS；DEU/BRA 限值待读回签核 |
| 2026-07-30 | M3 第二刀：DEU/BRA 限值读回 | 已完成 | EUR-Lex 前端 WAF 拦截下改走 CELLAR 官方存储（publications.europa.eu，SPARQL + 内容协商）读回 Euro VI（595/2009 附件 I 经 582/2011 附件 XV 替换：WHTC NOx 460 mg/kWh 等）与 Stage V（2016/1628 附件 II 表 II-1：PM 0.015 g/kWh 等）；BRA MAR-I 限值自 IBAMA 官方手册（gov.br，p.310）读回（修正样例：19–37 kW 带 HC+NOx 7.5 / PM 0.6）；新增 3 法规 + 104 限值经治理发布，DEU/BRA → covered；目标库验收 9/9 PASS（4 国 × 道路/非道路）；当时尚缺 BRA P8，已于 2026-08-05 补齐 |
| 2026-07-30 | M3 第三刀：jurisdiction 治理实体 | 已完成 | Migration 0006 把 `jurisdiction` 纳入 `governed_entity_type`（ADR-043）；辖区草稿含 `memberships`，发布语义为辖区 upsert + 成员“缺失归档 + upsert”（复合主键下重发布幂等）；管理面板草稿/归档同步支持；入库脚本改为全治理路径（无直插），目标库验收 9/9 PASS；Vitest 75/75 |
| 2026-07-30 | 仓库公开化与改名 | 已完成 | 仓库 `Jameskyzx/Weichai` → `Jameskyzx/diesel` 更名并公开（旧名自动重定向）；master 分支保护启用（四检查 + strict + enforce_admins，管理员同样受限）；原生 Secret scanning + push protection 启用；DEPLOYMENT.md §2–§3 更新为已执行状态与重建命令 |
| 2026-08-03 | M4 核心用户流程收口（无阻塞子集） | 已完成 | 国家详情筛选查询参数（applicationScope/powerKw/asOf/productModelCode，服务端逐字段 Zod 规范化，iso3 大小写与筛选规范化单次重定向、未知参数保留，ADR-044）；分享链接自动复现产品适配评估、写回 URL（客户端同语义规范化）；面板按 ISO3 key 重置（修复跨国家状态残留）与未知型号回退；stale 核验告警（`COUNTRY_STALE_AFTER_DAYS` 默认 90，ADR-045，仅详情可见国家在地图 tooltip 提示）；API 错误细分（INVALID_AS_OF、内部 ZodError 归 500）与日志凭据脱敏、UI 错误 ZodError 安全化；补齐状态：管理面板 loading/空队列/空日志/刷新错误、知识台空文档、产品面板空目录与重试、详情错误重试、styled not-found；对抗式评审确认 16 项全部处理；Playwright 30 通过（分享 URL 规范化复现、INVALID_AS_OF、stale 徽标）；Vitest 77/77。真实市场比较与批准适配规则仍受 ADR-019/020/021 阻塞 |
| 2026-08-05 | M3 BRA P7→P8 历史切换 | 已完成（开发库） | P8：从 Imprensa Nacional 官方 DOU URL 的 Wayback 存档读回附件表 1，新增 WHSC/WHTC 24 条限值。P-7：旧 CONAMA 官方法规页 `codlegi=591` 定位官方 403/2008 PDF，从同 URL 的 Wayback 存档读回附件 I，新增 ESC/ELR/ETC 22 条柴油限值。10 来源、4 辖区、10 法规经 Draft → Reviewed → Published 重跑；目标开发库 11/11 PASS，四国覆盖均为 `covered`。卡车/客车验证 2022-12-31 只返回 P-7、2023-01-01 起只返回 P8 |
| 2026-08-05 | 地图客户端拆包 | 已完成 | `WorldMap` 改为 `next/dynamic` 纯客户端按需加载，固定高度状态防止布局跳动；生产构建的 MapLibre chunk 从 1.40 MB / gzip 370 KB 降至 1.04 MB / gzip 275 KB，并从首页同步模块移出；Playwright 30 通过、2 个按项目设计跳过。聊天 503 错误态由 E2E 本地拦截固定响应，不依赖或调用开发者真实模型配置 |
| 2026-08-05 | M3 产品与认证证据门 | 已完成（输入待 owner） | 潍柴英文官网四类动力目录可达，但法律声明禁止未经授权的复制/公开发布，当前仅作入口；VECC 查询要求 VIN 或机械环保代码 + 发动机号，无法按系列直接生成认证。新增 `docs/PRODUCT_EVIDENCE.md`，按治理 Zod schema 定义 5–10 个配置的接收模板、许可/locator 要求和 `fit/not_fit/unknown` 发布验收门，不录入未经许可的参数或证书 |
| 2026-08-05 | M3 市场指标证据门 | 已完成（输入待 owner） | OICA 2025 商业车辆销量四国同表但电子再分发受限；UN Comtrade HS 8408 有许可和用途混合风险；WDI 为 CC BY 4.0，GDP 四国 2025 同期但只是宏观代理，农业/工业 value-added 最新年份不齐。新增 `docs/MARKET_EVIDENCE.md`，定义候选指标决策包、12 行接收模板、许可与可比性发布门，不导入真实数值、不决定评分方向 |
| 2026-08-05 | M3 治理输入边界硬化 | 已完成 | Zod 在草稿入口拒绝法规、产品和认证“只有结束日期”或倒序期间；必填数值拒绝空、`null`、布尔和数组，字符串只接受十进制语法而不接受 `0x`/`0b`/`0o`；来源/辖区 URL 仅 HTTP(S) 且禁止嵌入用户名/密码，避免公开 DTO 链接暴露凭据；国家覆盖词表与 Demo 标志对齐；辖区 `memberships` 快照必填且国家唯一，国家型辖区必须且只能包含与 `countryIso3` 一致的成员关系，区域/国际辖区不得伪装为单一国家；管理 API 路径键在 service 边界按 ISO3/UUID 校验，畸形值返回 400 而非数据库 500；产品 application scope 不得重复；文档 FormData 拼错布尔值失败关闭。市场 CSV 严格布尔/数值、空批次、畸形引号和批内重复观测均在 Preview/Draft 阶段报错，并保留空行/多行引号字段后的真实物理行号 |
| 2026-08-05 | M3 市场自然键数据库约束 | 已完成 | Migration `0007_market_metric_scope_uniqueness` 用 scoped/global 两个 PostgreSQL 12 兼容部分唯一索引约束市场观测；`application_scope=NULL` 不再绕过唯一性。`pnpm db:check` 与空库重复观测集成测试通过 |
| 2026-08-05 | M3/M4 失败语义与职责分离硬化 | 已完成 | 非 admin 草稿创建者不能发布自己的草稿；认证 `status=unknown` 不再误判为 `not_fit`；同代码但定义不同的市场指标返回 `DEFINITION_MISMATCH`，不参与排名或评分；正式法规/市场读取沿国家、辖区、成员关系、事实及来源完整过滤软归档。数据库/领域回归测试覆盖这些边界 |
| 2026-08-06 | M3 发布证据依赖门 | 已完成 | 结构化事实发布事务在写入前校验国家/法规/限值/产品/认证/市场/辖区/成员关系的直接来源，以及国家/辖区/产品/法规父实体及其直接来源存在且未归档；非 Demo 事实不得引用 Demo 来源或 Demo 父实体，来源/父实体改标 Demo 时不得遗留活跃非 Demo 子事实，同一法规限值与辖区成员快照也保持单向分类一致。CSV 确认、审核和发布锁定状态行，重复并发请求只允许一次状态转换。失败保持草稿 reviewed 与旧事实不变，避免治理台显示 Published 但公开 Repository 因依赖已归档而静默隐藏、重复发布或分类错误 |
| 2026-08-05 | M4 国家详情时点与公开契约收敛 | 已完成 | `findDetailsByIso3` 强制接收 `asOf`，辖区成员与法规按半开有效期过滤；公开 DTO 只保留当前 `effective` 和未来 `adopted`，其中生效日期未知的 adopted 仍作为待定风险可见；来源/AI 引用不再从 proposed、superseded、历史原始数组生成。同一国家修改评估日期后详情按 `ISO3 + asOf` 重取；默认日期首次写入 URL 且与已加载响应同日时复用详情，避免重复请求重置产品选择；客户端筛选写回保留 `utm_*` 等未知分析参数，重复已知筛选折叠为首个规范值，未知多值参数完整保留。Playwright 验证 URL/评估/详情日期一致及分析参数跨自动评估/刷新保留 |
| 2026-08-05 | M4 键盘、读屏与窄屏流程补齐 | 已完成 | AI 面板打开后聚焦输入框，`Escape` 关闭并恢复触发按钮焦点，对话区使用 live log；聊天非 JSON/畸形错误不再显示原始 `Error.message`，只接受结构化安全信封或固定回退文案；产品适配结果使用 status 播报；Tooltip 按实际地图容器限界。地图与 smoke Playwright 24 通过、2 个按设备能力设计跳过 |
| 2026-08-05 | M4 数据分类与来源追溯校正 | 已完成 | 站点横幅、地图入口、README、部署检查单与 smoke 不再声称“所有数据均为 Demo”；国家、辖区、法规、市场、产品、限值、认证和来源卡片逐条显示“虚构 Demo / 已核验来源”。辖区实体/成员关系及 product-fit 限值来源进入 DTO、freshness、页面与 AI 引用；国家画像 citation 显式包含辖区与成员来源，产品适配和知识检索也以完整引用集合计算 Demo 警告/最近核验。事实或来源任一为 Demo 时引用保持 Demo 分类，Demo 限值或文档借用公开基础来源不会被误标为已核验；跨国评分/比较的来源与 AI citation 去重保留 `countryIso3`，共享事实不会被错误归到最后处理的国家；可用来源 URL 以 HTTP(S) 外链展示 |
| 2026-08-06 | M3 草稿身份、版本与市场修订边界 | 已完成 | 治理 Repository 在创建、审核和发布时校验 `entity_key` 与 payload 的 `iso3`/`id`/`documentId` 一致，历史或直写脏草稿不能把审计版本写到另一实体。同一实体版本集合串行创建/发布，较新版本发布后旧草稿不能倒序覆盖，首版并发编号冲突转为可重试 `CONFLICT`。市场观测发布按 scoped/global 自然键查重；CSV 新 ID 不隐式覆盖活跃或已归档观测，冲突指引使用既有实体修订/解归档。归档与来源核验锁定事实行，重复归档仅记一次审计，辖区归档同时记录成员关系 before/after；审核审计显式记录草稿 `draft→reviewed`，文档审核同时记录文档治理状态变化，不再保存两份无法区分的相同 payload；文档严格按 ready draft→reviewed→published 迁移并校验来源，重处理仅允许 draft ready/failed 且同步 document/source/chunk metadata 与 before/after 审计，管理表单显式传递 Demo 复选框与说明而不再强制 `isDemo=false`，已发布非 Demo 文档阻止来源改标 Demo，检索分类取文档/chunk/来源任一 Demo。失败保持草稿状态和既有事实不变，集成测试覆盖回滚语义 |
| 2026-08-06 | M3 辖区与国家分类数据库约束 | 已完成（Migration 待应用） | Migration `0008_panoramic_hannibal_king` 将辖区类型与 `country_iso3` 的双向一致性下沉为 CHECK；Migration `0009_breezy_reptil` 限制国家覆盖词表并保证 `is_demo` 当且仅当覆盖状态为 `demo`。空库集成测试覆盖合法写入、未知状态和各分类错配方向。Migration 0007/0008/0009 均未应用到目标开发库 |
| 2026-08-06 | M3/M4 法规适用性追溯 | 已完成 | `product-fit` 与跨国法规比较均为每项法规显式返回适用辖区、目标国家成员关系、半开有效期、事实核验时间及两类来源；确定性证据集合、详情页面、结构化聊天卡片、机会评分/销售简报来源和 AI citation 均纳入这些证据。共享来源按 fact/source 任一 Demo 合并分类，避免一条非 Demo 使用覆盖同来源下的 Demo 事实；数据库与领域/服务回归测试覆盖完整链路 |
| 2026-08-06 | M4 AI 产品工具 no-data 语义 | 已完成 | `findCompatibleProducts` 在产品目录为空或所有评估均为 `unknown` 时，工具状态与 `evidenceSufficient=false` 一致返回 `no_data`，不再因国家参数已解析就把审计记录标为 `ok`；明确 `fit/not_fit` 仍返回 `ok`，确定性结论不变 |
| 2026-08-06 | M3 来源分类数据库约束 | 已完成（Migration 待应用） | 数据来源草稿与文档导入 Zod 要求 `isDemo` 当且仅当 `sourceType=demo`，堵住 Demo 类型伪装为非 Demo 或反向错配的发布入口；Migration `0010_military_wilson_fisk` 将同一双向规则下沉到 `data_sources` CHECK，空库集成测试覆盖合法写入和两个错配方向。Migration 0007/0008/0009/0010 均未应用到目标开发库 |
| 2026-08-06 | M3/M4 核验时间输入边界 | 已完成 | 所有结构化治理草稿与来源核验动作统一拒绝超过服务端当前时间 5 分钟以上的 `verifiedAt`，防止未来核验时间长期绕过 stale 告警；保留 5 分钟客户端/服务端时钟偏差容忍，既有事实有效期和 SLA 规则不变 |
| 2026-08-06 | M3 归档依赖闭合 | 已完成 | 来源、国家、辖区、产品和法规存在活跃公开依赖时拒绝归档，避免正式 Repository 因联表软归档过滤而静默隐藏已发布事实；发布事务锁定已校验的来源与父实体，关闭校验后并发归档竞态。辖区成员关系与法规限值作为 owned rows 随父实体在同一事务软归档，并记录完整 before/after 审计快照；数据库回归测试覆盖来源/父实体拒绝、状态不变和法规聚合归档 |
| 2026-08-06 | M4 国家公开分类失败关闭 | 已完成 | 地图摘要在数据库层按“国家事实或其来源任一为 Demo”计算分类，国家详情顶部采用同一规则；即使历史或直写数据绕过治理发布门形成跨表错配，也不会在入口误标为已核验。数据库回归测试构造并恢复错配行，验证地图输出与详情来源分类一致 |
| 2026-08-06 | M4 AI 比较工具 no-data 语义 | 已完成 | `compareRegulations` 至少两个国家存在可见法规时才视为足以跨国比较；`compareMarkets` 至少一个指标通过国家覆盖、重复观测、scope、单位、币种、定义、方法和期间检查时才返回 `ok`。零散事实仍保留在结构化卡片和缺失警告中，但外层状态、证据门和审计不再把单国法规或全部不可比指标报告为成功比较 |
| 2026-08-06 | M4 多工具 AI 证据门 | 已完成 | 同一回答调用多个工具时，模型自然语言缓冲到完整顺序/并行工具链结束，只有全部工具均为 Zod 有效、`status=ok`、`evidenceSufficient=true` 时才放行；任一 `no_data/error`、证据不足、畸形结果，以及参数校验/执行/审批产生的 `tool-error/tool-output-denied/error` 流事件都会失败关闭，结构化工具卡片仍即时分别展示。mock 覆盖并行混合结果、先成功后 no_data 的顺序调用，以及先成功后无效工具参数，禁止早期成功掩盖后续失败 |
| 2026-08-06 | M4 AI 助手实例稳定性 | 已完成 | `SalesChat` 提升到根布局中的地图路由持久壳层，国家 Drawer 打开时通过 portal 进入其可访问性树，规避 Vaul/Radix 对抽屉外节点的辅助技术隐藏；国家详情异步刷新、Drawer 开合和客户端国家切换不再重挂载聊天实例或替换发送按钮。E2E 在未发送文本存在时切换 CHN→DEU 并关闭国家详情，验证面板保持打开、输入保留且地图默认国家上下文同步更新 |
| 2026-08-06 | M4 AI 入口收口 | 已完成 | 移除首页、地图和国家详情的左下角悬浮 AI 营销助手及其根布局/Drawer portal 壳层；AI 保留在独立 `/chat` 工作区，通过顶栏“对话”进入。Playwright 验证首页无悬浮按钮、独立对话页 BYOK 面板可用，生产构建与质量门通过 |
| 2026-08-06 | M4 AI 知识检索默认有效期 | 已完成 | `searchKnowledgeBase` 未显式提供 `asOf` 时统一使用当前 UTC 日期作为工具 `informationAsOf` 与 Repository 的 `[valid_from, valid_to)` 过滤日期，避免结果声称“截至今天”却检出已过期或尚未生效的 chunk；直接工具执行回归测试验证传入过滤日期与输出声明一致 |
| 2026-08-06 | M3/M4 法规限值期间追溯 | 已完成 | 跨国法规比较为每条污染物限值保留自身 `[validFrom, validTo)`，并把期间写入 citation locator；未来 adopted 法规存在多阶段限值时，AI JSON 与结构化卡片可区分各阶段数值，不再只返回无法判期的同名限值。服务测试验证限值日期与 locator 同步 |
| 2026-08-06 | M3/M4 产品供应期事实透传 | 已完成 | 产品表与治理草稿中的 `[availableFrom, availableTo)` 不再在公开 Repository/DTO 边界丢失；产品列表、适配结果、AI 产品工具、确定性销售简报、citation locator 和结构化卡片均保留并展示供应期。该字段当前只作来源追溯，不擅自改变 `product-fit-v1`，商业可售性和供应期判定仍待 ADR-021 批准 |
| 2026-08-06 | M4 stale 精确时间边界 | 已完成 | 国家地图摘要和详情不再把当前时间截断到 UTC 零点后计算 freshness，而是使用当前 UTC 时间戳与 `verifiedAt` 的精确差值；实现与 ADR-045 的“恰好 N 天新鲜、超过 1ms stale”一致，避免告警最多延迟近 24 小时。服务级伪时钟回归覆盖阈值后 1ms |
| 2026-08-06 | M4 知识引用发布日期追溯 | 已完成 | 混合检索 DTO 同时保留文档与来源发布日期，`searchKnowledgeBase` citation 优先采用文档 `publishedOn`，缺失时回退来源日期；已有结构化日期不再被固定写成 `null`，AI 来源卡可以直接展示。Repository 与工具结果回归测试覆盖日期透传和优先级 |
| 2026-08-06 | M4 国家法规适用性关联 | 已完成 | 国家详情 Repository 原本已联接辖区与成员关系但法规 DTO 丢失关联；现每条 effective/adopted 法规直接保留适用辖区、目标国家成员 `[validFrom, validTo)`、两类来源和核验时间。国家法规卡与 AI 国家画像结构化卡显示该链路，citation 用对应 `regulationId` 绑定辖区/成员证据，避免法规与来源只按两组列表猜测对应关系 |
| 2026-08-06 | M4 市场指标发布日期追溯 | 已完成 | 国家市场指标卡显示事实自身 `publishedOn`；国家画像 citation、跨国比较和评分 `AnalysisSource` 优先采用市场观测发布日期，缺失时才回退来源发布日期，避免把来源记录日期误作指标事实日期。数据库服务测试通过临时分离两类日期验证优先级 |
| 2026-08-06 | M4 国家画像主题级证据门 | 已完成 | `getCountryProfile` 强制声明 `country/regulations/market` 需求，并按所请求主题逐项判断充分性；国家记录存在但所问法规或市场为空时保留结构化 profile 与缺失警告，外层返回 `no_data/evidenceSufficient=false`，流级闸门不再允许模型借无关国家元数据编造缺失主题。国家基础问题仍可单独请求 `country` 并正常回答 |
| 2026-08-06 | M4 机会排名证据门 | 已完成 | `calculateOpportunityScore` 的输入是 2–5 国比较组，AI 外层充分性现要求至少两个国家具有确定性 `overallScore`；仅单国可评分时保留 scorecard、分数与缺失项，但返回 `no_data/evidenceSufficient=false`，禁止模型把单国结果描述成跨国排名。确定性公式、权重和分数未改变 |
| 2026-08-06 | M3 父分类并发锁闭合 | 已完成 | 来源、国家、辖区、产品和法规改标 Demo 时改为先锁父记录、再检查活跃非 Demo 子事实，与子事实发布的父锁顺序串行；关闭“依赖检查通过后并发插入非 Demo 子事实”的窗口。集成测试并发竞争同一来源的 Demo 改标与非 Demo 产品发布，验证只允许一个事务成功且最终分类不变量成立 |
| 2026-08-06 | M4 AI 无效工具调用审计 | 已完成 | 已知工具的参数在 Zod 校验阶段失败时也写入 `ai_tool_calls`，状态为 `error`、错误码为 `INVALID_TOOL_INPUT`；只保留输入类型和顶层字段名，不落无效原值。回调返回 `null`，不让 SDK 自动修复或执行失败调用；已执行调用仍由原执行器审计且不重复记账，流级证据门继续失败关闭 |
| 2026-08-06 | M4 AI 检索审计最小化 | 已完成 | `searchKnowledgeBase` 继续以完整 query 执行检索，但 `ai_tool_calls.input` 不再持久化自由问题文本，只记录 Unicode 字符数；国家、日期、scope、limit 等结构化过滤条件保持可追踪。直接工具测试同时验证服务收到原查询、审计投影不含原文 |
| 2026-08-06 | M4 AI 请求体字节上限 | 已完成 | `/api/chat` 在 JSON 解析前检查 `Content-Length` 并流式累计真实 UTF-8 请求字节，256 KiB 后取消读取并返回结构化 413；低报或缺失长度也不能绕过。正常 AI SDK 信封、40 条消息上限和入口速率限制语义不变 |
| 2026-08-06 | M4 AI 历史消息信任边界 | 已完成 | 服务端先从客户端历史信封筛出用户角色消息，再校验其 AI SDK 形状并送入模型；浏览器可伪造的 assistant 文本和历史工具结果不再进入事实上下文。当前轮服务端工具输出仍由 SDK 加入后续 step，多轮用户问题与 UI 会话展示保持；空用户历史或最后一条非用户消息失败关闭 |
| 2026-08-06 | M4 AI 顺序工具文本时序门 | 已完成 | 每个新工具结果、工具错误或拒绝事件都会清空此前缓冲的模型文字，只允许完整工具链最后一个结果之后生成的自然语言进入最终放行判断；即使两个顺序工具都成功，第二项结果前的提前结论也不会泄出。结构化工具卡片仍即时分别展示 |
| 2026-08-06 | M4 AI 用户消息白名单 | 已完成 | 应用级 Zod 白名单先筛出用户消息，再由通用 AI SDK schema 校验：送入模型的用户历史只能包含非空 text parts，每轮最多 2,000 个 UTF-16 code unit，与 HTML `maxLength` 一致；客户端直传的 file/URL/data/工具 part 一律拒绝，关闭当前无附件 UI 下的服务端下载与未批准模型输入路径。前后端共享长度常量；会话审计只在全部消息校验通过后 upsert，失败请求不留空会话 |
| 2026-08-06 | M4 AI 工具失败日志最小化 | 已完成 | AI 工具执行异常时控制台只记录已知工具名和 Error 类型，不再输出原始 Error message/stack；结构化错误卡、`ai_tool_calls` 错误状态和证据失败关闭不变。回归测试让知识服务错误携带敏感 query，确认控制台与审计 JSON 均不含原文 |
| 2026-08-06 | M3/M4 知识 chunk 父实体闭合 | 已完成 | 文档发布事务锁定并校验所有 chunk 引用的国家/辖区及其直接来源未归档，且非 Demo chunk/文档不得挂在 Demo 父实体；国家/辖区存在 `published + ready` chunk 时拒绝归档，发布与归档竞争只允许一方成功。混合检索同时排除已归档父实体，历史或直写错配失败关闭。数据库集成覆盖父归档、发布回滚、读取过滤和并发不变量；无 schema 变更 |
| 2026-08-06 | M3 知识导入原子发布与去重 | 已完成 | 生产管理上传始终进入 Draft；仅开发环境知识台保留显式直发，但 Repository 创建阶段仍固定为 `draft + processing`，chunk、文档来源、国家/辖区父实体与父来源在完成事务中全部通过后才原子切换为 `published + ready`，失败保持 Draft/不可检索；完成和失败写回都只接受仍处于 `draft + processing` 的活跃记录，陈旧 worker 不能覆盖后续状态。并发相同哈希由数据库唯一约束返回 duplicate，临时来源回滚删除；本地文件改为 `<sha256>/content` 内容寻址并使用临时文件原子替换，避免不同文件名或半写文件产生孤儿。文档摘要同时显示处理/治理状态，只有 `ready + published` 标为可检索 |
| 2026-08-06 | M3/M4 API 请求与日志边界闭合 | 已完成 | 所有 API body 路由均在框架 JSON/multipart 解析前流式统计实际字节：chat/治理 JSON/产品适配/知识检索分别为 256/256/64/64 KiB，文档上传/重处理/市场 CSV 为 6 MiB/256 KiB/3 MiB，低报 `Content-Length` 不能绕过，超限返回结构化 413；市场 CSV 文件另限 2,000,000 字节，3 MiB 只保留 multipart 余量。JSON 只接受 `application/json` 或 `application/*+json`。聊天用户 text 白名单与 SDK 校验前移到模型配置和审计 Repository 之前，并拒绝客户端 provider metadata；聊天、公开事实查询、管理写入和文档处理异常日志只记录错误类型，不输出 message/stack/连接串或上传 metadata |
| 2026-08-06 | M3/M4 客户端迟到响应隔离 | 已完成 | 产品适配评估在输入变化、重复提交、国家切换和卸载时取消旧请求，并以请求序号拒绝迟到结果，避免旧国家响应恢复旧 URL；管理后台初始化、手动刷新和写操作后刷新共用最后请求胜出通道，旧 dashboard 快照不能覆盖新发布队列。桌面/移动 Playwright 均以延迟响应复现并覆盖两个竞态 |
| 2026-08-06 | M3 product-fit 认证范围缺失语义 | 已完成 | `product-fit-v1` 不再把 `validFrom=null` 或 `powerMinKw=null` 的 active 认证当作从负无穷起覆盖；分别返回 `CERTIFICATION_VALIDITY_UNKNOWN` / `CERTIFICATION_POWER_RANGE_UNKNOWN` 和 `unknown`。已知起点/下界配合空上界仍表示开放；已知上界明确越界仍为 `not_fit`。单元测试覆盖未知下界、开放上界与明确越界，未引入产品供应期或 ADR-021 待决规则 |
| 2026-08-06 | M3 待应用 Migration 数据预检 | 已完成（仅文档） | `docs/DEPLOYMENT.md` 增加 `0007`–`0010` 的只读零行预检：scoped/global 市场自然键重复、辖区类型/国家归属、国家覆盖/Demo 分类、来源类型/Demo 分类；要求异常先由 owner 决定修订路径，不得静默删改事实。未连接目标库，未应用本地或远程 Migration |
| 2026-08-06 | M3/M4 异常类型日志白名单 | 已完成 | 共享 `getErrorCode` 不再信任可变 `Error.name`，改用白名单校验的异常构造类型；非 Error、非标准或伪造类型统一为 `UNKNOWN_ERROR`，连接串即使被写入 name 也不会进入公开 API、治理、AI 或开发知识台日志。原型/构造器访问或 Proxy trap 自身抛错时也保证回退，不让日志辅助函数中断固定 500。共享对抗单测及公开产品 API、知识导入/下载/检索/选项路由回归覆盖 |
| 2026-08-06 | M4 国家详情参数异常失败关闭 | 已完成 | `/api/countries/[iso3]` 的框架路径参数解析若发生非 Zod 异常，不再逃逸 Route Handler；统一返回 schema 校验的通用 500，并只记录安全异常类型。回归以拒绝的 params Promise 验证服务未执行、响应和日志均不含连接信息 |
| 2026-08-06 | M3 市场 CSV 输入失败关闭 | 已完成 | 市场 CSV 的 2 MB 文件契约按 `File.size` 的 2,000,000 字节执行，超限返回 413，不能以多字节 UTF-8 绕过字符数校验；生成内容哈希和持久化 Preview 前使用 fatal UTF-8 解码，非法字节不再被 `U+FFFD` 静默替换。合法 UTF-8 中 PostgreSQL JSONB 无法保存的 NUL 按物理行拒绝；引号外孤立回车也失败关闭，不再静默删除并拼接文本。文件大小、底层解码、解析器和管理路由均有回归覆盖；未导入数据、未确认批次 |
| 2026-08-06 | M4 管理写入状态与错误响应收紧 | 已完成 | 管理写操作成功后，后续 dashboard 快照读取失败不再落入“管理操作失败”分支；界面保留动作成功通知并明确提示“操作已完成但刷新失败”，避免用户因误报重复创建、审核、发布或确认。管理客户端只从结构化 JSON 错误信封读取文案，HTML/纯文本/畸形响应固定回退，不渲染上游原文。Playwright 覆盖 Draft 成功后刷新 500、单次提交和含连接串的非 JSON 错误响应 |
| 2026-08-06 | M3/M4 知识检索 limit 强制转换关闭 | 已完成 | 开发知识检索 `limit` 不再使用 `z.coerce.number()`；只接受显式 number 或十进制字符串，再要求 1–25 的有限整数。JSON 布尔值、数组、对象、十六进制字符串和小数均失败关闭，不能借 JavaScript coercion 改写查询规模；默认 10 和检索算法不变 |
| 2026-08-06 | M4 客户端响应解析失败关闭 | 已完成 | 管理端对非 JSON 失败响应与 2xx 畸形响应使用固定文案；国家/产品客户端和开发知识台把 JSON `SyntaxError` 与 Zod 输出校验错误统一回退，不显示 HTML、代理响应片段或 schema issue。已验证 API 错误信封和普通网络错误文案保持；共享单测与管理、知识台 Playwright 覆盖 |
| 2026-08-06 | M3 市场 CSV Preview 文件身份失效 | 已完成 | 市场 CSV 文件控件补显式可访问标签；文件 A 完成 Preview 后若重新预览或改选文件 B，客户端先清除旧批次、确认按钮和旧通知。第二次 Preview 失败也不能继续确认首次批次。桌面/移动 Playwright 覆盖成功预览、重试 500、旧确认消失和改选文件清错；服务端持久化批次语义不变 |
| 2026-08-06 | M3 EU 排放法规覆盖扩展 | 已完成（历史 EU-26 边界由 #260 / ADR-135 替代） | 欧盟官方国家页面读回 27 个成员国及加入年份；以有效期成员关系复用已签核 Euro VI / Stage V 法规和限值，不复制法规记录。当时 174 国地图目录缺少 MLT，因此该批只发布地图可寻址 EU-26；该历史生产事实不回写，MLT 目录、1:10m 几何和成员关系已于 2026-08-11 在本地 accepted 补齐。GBR/TUR/EEA 排除仍有效。目标开发库当时读回 29 `covered` / 17 `planned` / 128 `no_data`，EU 26 条活跃成员关系；FRA 返回 Euro VI + Stage V，HRV 在 2013-07-01 加入边界前后分别无/有 EU 法规。全套单测、构建与治理验收通过，Migration `0007`–`0010` 未应用 |
| 2026-08-06 | M3 JPN 排放法规深度填充 | 已完成 | e-Gov 已读回《道路運送車両の保安基準》第31条；环境省道路沿革 p.4 已读回平成28年重型柴油车 WHSC/WHTC 平均限值与 GVW 分期；现行三省告示已读回オフロード法 2014 年基准五个 `[19,560)` 功率带、限值和适用日。按 ADR-046 写入受控 fixture、治理导入和边界测试；质量门通过，治理发布后 JPN API 读回四个 scope 均为 `effective`。 |
| 2026-08-06 | M3 KOR 排放法规深度填充 | 已完成 | 韩国国家法令信息中心现行《대기환경보전법 시행규칙》第62条及附表17官方 PDF 已核验：道路重型柴油车自 2017-10-01，工程机械自 2020-12-01，农业机械自 2021-07-01；道路 WHSC/WHTC、非道路 `[0,8)`、`[8,19)`、`[19,37)`、`[37,56)`、`[56,130)`、`[130,560)` 限值写入受控 fixture。NH3 条件、19/37/56/130/560 边界测试、治理发布与 KOR API 读回通过。 |
| 2026-08-06 | M3 MEX 排放法规深度填充 | 已完成 | DOF NOM-044-SEMARNAT-2017 表 1B/2B 及 2020/2021 修订公告已核验；按 2025-01-01 建模 B 标准全国可执行日，卡车/客车保留 CT/CSE、CEEMAP、CETMAP 替代路径，工程/农业显式 no-data；确定性测试、治理脚本和目标库读回已通过。 |
| 2026-08-06 | M3 TUR 排放法规深度填充 | 已完成 | 土耳其官方公报已核验道路 Euro VI（2016-01-01 执行日）与 NRE Stage V（2022-10-01 市场投放）；道路卡车/客车、工程机械功率带和农业拖拉机排除/no-data 已写入本地 fixture、确定性测试与治理验收；全套质量门、发布和 TUR API 读回通过。 |
| 2026-08-06 | M3 AUS 排放法规深度填充 | 已完成 | DITRDCSA/Federal Register 与 ADR 80/04 官方问答已核验道路 ADR 80/03 → 80/04、2024-11-01 新车型切换边界和 WHSC/WHTC NOx/PM；DCCEEW 官方评估明确非道路柴油发动机暂无联邦排放法规，construction/agriculture 保持 no-data；fixture、确定性测试与治理验收已完成。 |
| 2026-08-06 | M3 CAN 排放法规深度填充 | 已完成（日期/partial 完整列由 #263 / ADR-136 替代） | 加拿大司法部 Justice Laws 官方页面已核验 SOR/2003-2 第 16(2) 道路引用 40 CFR 86.11，以及 SOR/2020-258 第 10(1)(a)、第 79 条非道路引用 40 CFR 1039.101。accepted fixture 使用注册/采纳 2020-12-04、第 79 条生效 2021-06-04；历史 #246 曾补齐道路/非道路代表行，但其 560/560.001 raw 端点结论已由 #263 supersede。当前 §1039.140 / §1065.20(e) ties-to-even 查询翻译使 560、560.001 与 560.500 kW 同属最高展示带，560.501 kW 才无结果；SOR/2020-258 §1(4) 也纳入 calculation methods。本地图待生产刷新。 |
| 2026-08-07 | M3 GBR 排放法规补充 | 已完成（本地 fixture 与验收测试） | VCA/GOV.UK 官方页面已核验 GB provisional type approval 与 NRMM Stage V；GBR 独立 `GB-VCA` jurisdiction、工程机械限值及道路/农业 no-data 边界已写入 fixture、文档与确定性测试。道路 retained 595/2009 正式条文与农业独立限值仍待英国官方来源确认；目标库入库与 API 读回需在数据库可连接时执行。 |
| 2026-08-07 | M3 IND 排放法规深度填充 | 已完成（本地 fixture 与 40 条验收测试） | MoRTH 官方 G.S.R. 889(E)、598(E)、850(E)、151(E) 已读回；BS VI、CEV-IV/V、TREM-IV/V 的日期、功率带与限值写入 `IN-MORTH` fixture 和治理脚本。G.S.R. 151(E) 保持 proposed；测试覆盖四个切换日与 15/45/559.999/560 kW 边界。G.S.R. 141(E) 日期由 MoRTH 官方说明间接核验；目标库发布/API 读回待数据库可连接时执行。 |
| 2026-08-07 | M3 RUS 排放法规深度填充 | 已完成（本地 fixture 与验收测试） | EEC 官方 TR CU 018/2011、TR CU 031/2012 与 Decision 127/2021、32/2024 已读回；道路 Class 5 和农业 Class 3A 的日期、严格功率端点与限值写入 `RU-EAEU` fixture、治理脚本和 ADR-053。俄罗斯第 855 号国内规则的排放技术要求已失效，工程机械保持 no-data；目标库发布/API 读回待数据库可连接时执行。 |
| 2026-08-07 | M3 IDN 排放法规补充 | 已完成（本地 fixture 与验收测试） | KLHK P.20/MENLHK/SETJEN/KUM.1/3/2017 的道路 Euro 4 ESC/ETC 限值写入 `ID-KLHK` fixture、治理脚本和 ADR-054；按 2022-04-01 柴油全国执行节点建模，construction/agriculture 保持 no-data；目标库发布/API 读回待数据库可连接时执行。 |
| 2026-08-07 | M3 THA 来源边界登记 | 已完成（来源入口与 no-data fixture） | PCD/TISI 官方入口写入 `TH-PCD`，四个 scope 的显式 no-data、治理读回与 ADR-055 完成；未取得重型柴油限值正文，不创建 effective regulation；后续按事件驱动继续追踪官方公报。 |
| 2026-08-07 | M3 VNM 排放法规深度填充 | 已完成（本地 fixture 与验收测试） | 越南政府门户 Decision 49/2011/QD-TTg、Circular 06/2021/TT-BGTVT 与 QCVN 109:2021/BGTVT 已读回；2022-01-01 Level 5 边界、道路重型柴油 ESC/ELR/ETC 限值和非道路排除写入 `VN-MOT` fixture、治理脚本与 ADR-056。ETC 的 CH4 按天然气脚注排除；目标库发布/API 读回待数据库可连接时执行。 |
| 2026-08-07 | M3 MYS 排放法规补充 | 已完成（本地 fixture 与验收测试） | 马来西亚 DOE P.U.(A) 429/96 合并法规和现行 VTA 门户指南已读回；2017-01-01 重型柴油道路 Euro II 限值写入 `MY-DOE` fixture、治理脚本与 ADR-057。Euro IV 日期明确为 tentative，未升级为 effective；regulation 5 限制道路 scope，工程/农业保持 no-data；目标库发布/API 读回待数据库可连接时执行。 |
| 2026-08-07 | M3 SAU 来源边界登记 | 已完成（来源入口与 no-data fixture） | GSO 官方目录和公开预览已核验 GSO 42/144 的 current 状态及重型柴油车辆 scope；SASO Machinery Safety Part 2 全文已读回并确认不含柴油尾气限值。`SA-SASO`、三条官方来源和四 scope no-data 写入 fixture、治理脚本与 ADR-058；GSO 付费限值表及沙特实施文书后续事件驱动补充。 |
| 2026-08-07 | M3 ARE 来源边界登记 | 已完成（来源入口与 no-data fixture） | UAE Legislation Cabinet Resolution No. (13) of 2018 已读回 issued/effective/Active 元数据及附表 UAE.S 5016/5019；MOIAT Conformity Hub 已读回 GSO 车辆目录、Diesel 石油产品条目与 DIESEL GENERATOR non-regulated product 条目。`AE-MOIAT`、两条官方来源和四 scope no-data 写入 fixture、治理脚本、ADR-059 与确定性测试；未取得 UAE 柴油尾气限值与实施文书，后续事件驱动补充。 |
| 2026-08-07 | M3 ZAF 来源边界登记 | 已完成（来源入口与 no-data fixture） | 南非 Government Gazette No. 39220 Notice 611/613 已读回 N2/N3、M2/M3 道路强制规范；第 4.2.2 与 Schedule 1 确认 SANS 20049:2004/ECE R49.02B 入口及 2006/2010/2011 节点，但未公开可直接发布的数值表；GN 516 固定源修订意向通知与 257410 FINAL DRAFT 策略不纳入移动/非道路法规。`ZA-NRCS`、两条官方来源和四 scope no-data 写入 fixture、治理脚本、ADR-060 与确定性测试；SANS/ECE 限值表、南非实施文书及独立非道路标准后续事件驱动补充。 |
| 2026-08-07 | M3 ARG 排放法规补充 | 已完成（本地 fixture 与验收测试） | Argentina.gob.ar/Infoleg Resolución 1464/2014 的 M2/M3/N1/N2/N3 范围和 2016/2018 节点已读回；Publications Office/CELLAR Directive 2005/55 B2 ESC/ELR/ETC 限值写入 `AR-SAyDS` fixture、治理脚本与 ADR-061。Resolución 128/2018 军用 Euro III 例外只登记来源，不改变普通市场；C/EEV 不与 B2 叠加，construction/agriculture 保持 no-data；目标库发布/API 读回待数据库可连接时执行。 |
| 2026-08-07 | M3 NZL 排放法规补充 | 已完成（本地 fixture 与验收测试） | NZTA Land Transport Rule 33001 的道路认证范围、tractor 排除、Euro VI Step C 定义与 Table 2B 已读回；2025-11-01 统一切换日后的 Euro VI WHSC/WHTC 代表路径写入 `NZ-NZTA` fixture、治理脚本与 ADR-062。美国、日本、ADR、UNR 保持替代路径语义，construction/agriculture 保持 no-data；目标库发布/API 读回待数据库可连接时执行。 |
| 2026-08-07 | M3 CHL 排放法规补充 | 已完成（本地 fixture 与验收测试） | LeyChile D.S. 50/2023、D.S. 39/2020 合并文本与 D.S. 33/2024 已读回；道路 2026-01-06 Euro VI、一般移动机械 2023-10-21 Table 2 五功率带、560 kW 含端点及 2030 tractor adopted 记录写入 `CL-MMA` fixture、治理脚本与 ADR-063。US/EU 路径保持替代语义，其他农业机械明确排除；目标库发布/API 读回待数据库可连接时执行。 |
| 2026-08-07 | M3 COL 排放法规补充 | 已完成（本地 fixture 与验收测试） | MinAmbiente Resolucion 0762/2022 官方目录与签署 PDF 已读回；道路 2023-01-01 Table 22、非道路 2024-07-18 Table 23 五功率带、560 kW 含端点和 NRSC/NRSC-NRTC 循环写入 `CO-MADS` fixture、治理脚本与 ADR-064。EPA10/Table 24 保持替代语义，article 3(c) 农业排除保持 no-data；目标库发布/API 读回待数据库可连接时执行。 |
| 2026-08-08 | M3 PER 排放法规补充 | 已完成（本地 fixture 与验收测试） | Gob.pe 与 El Peruano D.S. 029-2021-MINAM 已读回；PBV > 3.5 t 道路客货车辆从 2024-10-01 按提单日期执行 annex I.7 Euro VI/A WHSC/WHTC，写入 `PE-MINAM` fixture、治理脚本与 ADR-065。Annex I.9.1 EPA 2010 保持替代语义，construction/agriculture 不从道路表外推；2026-10-01 协议更新期限未到，目标库发布/API 读回待数据库可连接时执行。 |
| 2026-08-08 | M3 PHL 来源边界登记 | 已完成（来源入口与 no-data fixture） | EMB 官方 DAO 2015-04 PDF 入口已核对，但当前只返回 Cloudflare 安全验证页；Official Gazette 按完整文书号检索无结果。`PH-DENR`、官方 URL、四 scope no-data、治理读回、确定性测试与 ADR-066 已落盘；不创建 effective regulation，不从二手摘要或 URL 上传路径推断日期和限值。 |
| 2026-08-08 | M3 SGP 排放法规补充 | 已完成（本地 fixture 与验收测试） | Singapore Statutes Online S 480/2017、S 299/2012 与 NEA 指引已读回；2018-01-01 道路 Euro VI 代表路径、2012-07-01 construction EU Stage II 四功率带写入 `SG-NEA` fixture、治理脚本与 ADR-067。PPNLT/US/Japan 路径保持替代语义，agriculture 因 industrial plant 映射不足保持 no-data。 |
| 2026-08-08 | M3 NOR 排放法规补充 | 已完成（本地 fixture 与验收测试） | Lovdata Bilforskriften 与 Maskinforskriften 已读回；现行道路 Euro VI 路径、2029-05-29 切换边界和 2020-07-01 Stage V construction/agriculture 全功率带写入 `NO-NATIONAL` fixture、治理脚本与 ADR-068。国内适用依据与 EU 数值来源双重追溯，现行法规日期不冒充首次实施日。 |
| 2026-08-08 | M3 ISL 排放法规补充 | 已完成（本地 fixture 与验收测试） | 冰岛官方 377/2013、603/2026、1200/2020、179/2021 与政府 EEA 数据库已读回；道路 2013-04-15 Euro VI、2027-11-29 切换，以及 Stage V 从 1200/2020 到 179/2021 的无缝替代写入 `IS-NATIONAL` fixture、治理脚本与 ADR-069。国内实施链与 EU 数值来源分层追溯，不从 EEA 身份自动继承。 |
| 2026-08-08 | M3 LIE 排放法规补充 | 已完成（本地 fixture 与验收测试） | 列支敦士登 Lilex VTS 现行合并文本和 LGBl. 2020 Nr. 258 已读回；道路 `LI-NATIONAL` 从现行 2026-07-01 版本建模 595/2009/R49 Euro VI 代表路径，非道路自 2020-08-01 建模 EWR 纳入的 EU 2016/1628 Stage V，四个 scope 与 150/559.999/560 kW 边界已写入 fixture、治理脚本与 ADR-070。道路首次国内实施日期证据不足，未反推更早日期。地图目录与 GeoJSON 增加 LIE，质量门继续执行。 |
| 下一步 | M3 继续逐国补全 | 进行中 | LIE 全部门禁通过后立即选择下一个未覆盖国家并核验官方正文；产品与市场业务输入仍分别按 `docs/PRODUCT_EVIDENCE.md`、`docs/MARKET_EVIDENCE.md` 接收，不用模型推断填补事实。 |
| 2026-08-08 | M3 CHE 排放法规补充 | 已完成（本地 fixture 与验收测试） | 瑞士 Fedlex VTS 现行合并文本已读回；道路 `CH-NATIONAL` 按 Anhang 5 Ziff. 211 的 595/2009/R49 入口、非道路按 Ziff. 211a/211b 的 2016/1628 入口，从 2026-07-01 当前版本建模，四个 scope 与功率边界写入 fixture、治理脚本与 ADR-071。首次国内实施日期证据不足，未反推更早日期。 |
| 2026-08-08 | M3 SRB 来源边界登记 | 已完成（来源入口与 no-data fixture） | 塞尔维亚官方法律信息系统车辆排放规则入口已核对；正文请求在当前窗口返回连接关闭，未取得可发布的道路/非道路 scope、实施日期或限值。`RS-NATIONAL`、官方 URL、四 scope no-data、治理读回、确定性测试与 ADR-072 已落盘；不从搜索摘要、EU/UNECE 或邻国日期推断。 |
| 2026-08-08 | M3 BIH 来源边界登记 | 已完成（来源入口与 no-data fixture） | 波黑交通通信部官方门户与 UNECE 波黑空气质量评估已核对；公开资料只有车辆排放基线/政策背景，未取得可发布的国内道路/非道路 scope、实施日期或限值。`BA-NATIONAL`、官方 URL、四 scope no-data、治理读回、确定性测试与 ADR-073 已落盘；不从背景报告或 EU/UNECE 标准入口推断。 |
| 2026-08-08 | M3 MKD 来源边界登记 | 已完成（来源入口与 no-data fixture） | 北马其顿交通通信部官方门户与 UNECE 第三次环境绩效评估已核对；资料只有二手车 Euro-4/新车 Euro-5 政策背景，未取得可发布的国内重型道路/非道路 scope、实施日期或限值。`MK-NATIONAL`、官方 URL、四 scope no-data、治理读回、确定性测试与 ADR-074 已落盘；不从背景资料或通用 EU 文书推断。 |
| 2026-08-08 | M3 MNE 来源边界登记 | 已完成（来源入口与 no-data fixture） | 黑山政府交通门户与官方 ECMT `EURO VI safe` 配额指南已核对；指南是跨境运输配额/车辆资格文件，不是国内排放限值法规。`ME-NATIONAL`、官方 URL、四 scope no-data、治理读回、确定性测试与 ADR-075 已落盘；不从配额资格、候选国身份或 EU/UNECE 推断。 |
| 2026-08-08 | M3 ALB 来源边界登记 | 已完成（来源入口与 no-data fixture） | 阿尔巴尼亚基础设施与能源部官方入口和 2030 国家交通战略已核对；战略只提出加强排放标准、实施欧洲标准和更新 Euro VI 车队，未提供可发布的国内重型道路/非道路法规、实施日期或限值。`AL-NATIONAL`、官方 URL、四 scope no-data、治理读回、确定性测试与 ADR-076 已落盘；不把政策目标或候选国身份升级为 effective。 |
| 2026-08-08 | M3 UKR 来源边界登记 | 已完成（来源入口与 no-data fixture） | 乌克兰最高拉达官方法规数据库与第 2697-VIII 号环境战略已核对；仅确认正式检索入口和政策方向，未取得可发布的国内重型道路/非道路法规、实施日期或限值。`UA-NATIONAL`、官方 URL、四 scope no-data、治理读回、确定性测试与 ADR-077 已落盘；不从战略或通用 EU/UNECE 文书推断。 |
| 2026-08-08 | M3 MDA 来源边界登记 | 已完成（来源入口与 no-data fixture） | 摩尔多瓦 `Legis.md` 官方法规库和基础设施与区域发展部入口已核对；法规库在当前窗口返回安全验证页，公开交通材料未提供可发布的国内重型道路/非道路法规、实施日期或限值。`MD-NATIONAL`、两个官方 URL、四 scope no-data、治理读回、确定性测试与 ADR-078 已落盘；不从欧盟衔接材料、UNECE 或搜索摘要推断。 |
| 2026-08-08 | M3 NPL 来源边界登记 | 已完成（来源入口与 no-data fixture） | 尼泊尔官方公报《Vehicle Emission Standard 2025》条目和 Department of Transport Management 入口已核对；公报下载端点在当前窗口被客户端拦截，未取得可发布的国内重型道路/非道路法规正文、实施日期或限值。`NP-NATIONAL`、两个官方 URL、四 scope no-data、治理读回、确定性测试与 ADR-079 已落盘；不从新闻摘要、旧版 Euro/Vehicle Mass 标准或搜索结果推断。 |
| 2026-08-08 | M3 ARM 来源边界登记 | 已完成（来源入口与 no-data fixture） | 亚美尼亚 ARLIS 法律信息系统和环境部入口已核对；当前资料只有 EAEU/Euro V 背景，未取得可发布的国内重型道路/非道路法规、实施日期或限值。`AM-NATIONAL`、两个官方 URL、四 scope no-data、治理读回、确定性测试与 ADR-080 已落盘；不从 EAEU 成员身份、IEA/UNECE 背景或搜索摘要推断。 |
| 2026-08-08 | M3 AZE 来源边界登记 | 已完成（来源入口与 no-data fixture） | 阿塞拜疆 e-qanun 官方法律信息系统和生态与自然资源部入口已核对；法律系统连接在当前窗口关闭，未取得可发布的国内重型道路/非道路法规正文、实施日期或限值。`AZ-NATIONAL`、两个官方 URL、四 scope no-data、治理读回、确定性测试与 ADR-081 已落盘；不从 EAEU/Euro 背景、区域报告或搜索摘要推断。 |
| 2026-08-08 | M3 GEO 来源边界登记 | 已完成（来源入口与 no-data fixture） | 格鲁吉亚 Matsne 官方法律公告系统和环境保护与农业部入口已核对；`emission vehicle` 官方检索返回零结果，未取得可发布的国内重型道路/非道路法规正文、实施日期或限值。`GE-NATIONAL`、两个官方 URL、四 scope no-data、治理读回、确定性测试与 ADR-082 已落盘；不从候选国身份、区域报告或搜索摘要推断。 |
| 2026-08-08 | M3 UZB 来源边界登记 | 已完成（来源入口与 no-data fixture） | 乌兹别克斯坦 LEX.UZ 官方检索以 `avtomobil chiqindi` 返回“未找到文件”；国家生态与气候变化委员会入口已核对。`UZ-NATIONAL`、两个官方 URL、四 scope no-data、治理读回、确定性测试与 ADR-083 已落盘；不从区域标准、政策新闻或空结果推断。 |
| 2026-08-08 | M3 KAZ 来源边界登记 | 已完成（来源入口与 no-data fixture） | 哈萨克斯坦 Adilet 官方俄文检索可见已失效的 2007 年车辆排放技术规章和地方监测规则，但未读回当前全国重型道路/非道路柴油法规正文、实施日期或限值。`KZ-NATIONAL`、两个官方 URL、四 scope no-data、治理读回、确定性测试与 ADR-084 已落盘；不从失效文书、地方规则或 EAEU 标准推断。 |
| 2026-08-08 | M3 TJK 来源边界登记 | 已完成（来源入口与 no-data fixture） | 塔吉克斯坦国家法律中心 `mmk.tj` 可访问但车辆排放关键词提交后返回 HTTP 500；未读回可发布的国内重型道路/非道路柴油法规正文、实施日期或限值。`TJ-NATIONAL`、两个官方 URL、四 scope no-data、治理读回、确定性测试与 ADR-085 已落盘；不从错误页面、区域标准或政策材料推断。 |
| 2026-08-08 | M3 KGZ 来源边界登记 | 已完成（来源入口与 no-data fixture） | 吉尔吉斯斯坦司法部中央法律库读回的 2009 年第 178 号车辆技术法规页面明确标注 2015-04-02 失效，未提供当前重型柴油限值表。`KG-NATIONAL`、两个官方 URL、四 scope no-data、治理读回、确定性测试与 ADR-086 已落盘；不从失效文书、EAEU 标准或搜索摘要推断。 |
| 下一步 | M3 继续逐国补全 | 进行中 | UZB/KAZ/TJK/KGZ 全部门禁通过后继续下一个未覆盖国家；产品与市场业务输入仍分别按 `docs/PRODUCT_EVIDENCE.md`、`docs/MARKET_EVIDENCE.md` 接收，不用模型推断填补事实。 |
| 2026-08-08 | M3 TKM 来源边界登记 | 已完成（来源入口与 no-data fixture） | 土库曼斯坦司法部入口确认官方法律系统，但公开法律系统要求手机号登录，公开法规目录未返回可读法规行；`TM-NATIONAL`、两个官方 URL、四 scope no-data、治理读回、确定性测试与 ADR-087 已落盘；不从登录受限页面、空目录或区域标准推断。 |
| 2026-08-08 | M3 AFG 来源边界登记 | 已完成（来源入口与 no-data fixture） | 阿富汗司法部官方英文检索 `vehicle emission` 返回 no results；`AF-NATIONAL`、两个官方 URL、四 scope no-data、治理读回、确定性测试与 ADR-088 已落盘；不从旧站、区域标准或搜索摘要推断。 |
| 2026-08-08 | M3 AGO 来源边界登记 | 已完成（来源入口与 no-data fixture） | Lex Angola 与安哥拉环境部官方入口已核对，未读回可发布的重型道路/非道路柴油法规正文、实施日期或限值；`AO-NATIONAL`、两个官方 URL、四 scope no-data、治理读回、确定性测试与 ADR-089 已落盘；不从政策新闻或区域标准推断。 |
| 2026-08-08 | M3 BDI 来源边界登记 | 已完成（来源入口与 no-data fixture） | 布隆迪司法部与政府官方入口已核对，司法部入口证书错误且未读回法规正文；`BI-NATIONAL`、两个官方 URL、四 scope no-data、治理读回、确定性测试与 ADR-090 已落盘；不从错误页或区域标准推断。 |
| 2026-08-08 | M3 BEN 来源边界登记 | 已完成（来源入口与 no-data fixture） | 贝宁司法部和政府总秘书处法律文库已核对，`émissions véhicules` 仅命中部长会议记录；`BJ-NATIONAL`、两个官方 URL、四 scope no-data、治理读回、确定性测试与 ADR-091 已落盘；不从会议记录或区域标准推断。 |
| 2026-08-08 | M3 BFA 来源边界登记 | 已完成（来源入口与 no-data fixture） | 布基纳法索司法部官方在线文档页显示 0 份法律/法令/条例/报告；`BF-NATIONAL`、两个官方 URL、四 scope no-data、治理读回、确定性测试与 ADR-092 已落盘；不从空目录或区域标准推断。 |
| 2026-08-08 | M3 BGD 来源边界登记 | 已完成（来源入口与 no-data fixture） | 孟加拉国法律数据库连接关闭，环境部官方入口未读回可发布的重型道路/非道路柴油法规正文、实施日期或限值；`BD-NATIONAL`、两个官方 URL、四 scope no-data、治理读回、确定性测试与 ADR-093 已落盘；不从连接错误或门户导航推断。 |
| 2026-08-08 | M3 BHS 来源边界登记 | 已完成（来源入口与 no-data fixture） | 巴哈马官方法律库与政府入口均连接关闭；`BS-NATIONAL`、两个官方 URL、四 scope no-data、治理读回、确定性测试与 ADR-094 已落盘；不从连接错误或区域标准推断。 |
| 2026-08-09 | M3 BLR 来源边界登记 | 已完成（来源入口与 no-data fixture） | 白俄罗斯 `pravo.by` 精确检索与交通部官方入口已核对；仅取得搜索/政策入口，未读回可发布的重型道路/非道路柴油法规正文、实施日期或限值。`BY-NATIONAL`、两个官方 URL、四 scope no-data、治理读回、确定性测试与 ADR-095 已落盘；不从 EAEU/UNECE 或新闻摘要推断。 |
| 2026-08-09 | M3 BOL 来源边界登记 | 已完成（来源入口与 no-data fixture） | 玻利维亚官方公报首页超时、环境主管部门入口证书错误；未读回可发布的重型道路/非道路柴油法规正文、实施日期或限值。`BO-NATIONAL`、两个官方 URL、四 scope no-data、治理读回、确定性测试与 ADR-096 已落盘；不从区域标准或搜索摘要推断。 |
| 2026-08-09 | M3 NGA 道路重型柴油法规填充 | 已完成（本地 fixture 与定向发布流程） | NESREA 官方目录及 `S.I. No. 20, 2011` 扫描件已读回；Regulations 17(2)/18 与 Schedule VIII item 1 支撑 2015-01-01 起、总质量 >3.5 t 新道路车型的 CO 2.1、HC 0.66、NOx 5.0 g/kWh。卡车/客车各 3 条写入 fixture，PM 因扫描单元格歧义未猜填，工程/农业保持 no-data；治理脚本新增 Zod 校验的 `--country=NGA` 定向发布和聚焦验收。 |
| 2026-08-09 | M3 EGY/GHA/ISR 来源边界批次 | 已完成（待统一发布） | 当时 EGY 只核对 EEAA 目录、实施条例附件身份与车辆尾气页，尚未读回表格；该取证缺口已由 ADR-128 supersede：Decision 710/2012 Annex 6 现已读回为怠速 CO/HC 与 ISO 11614 烟度/不透光度在用检查，四 scope no-data 不变。GHA EPA 法规页只列 Act 1124 概述且 Regulations 区域无车辆法规；ISR 两主管部门入口和政府站内查询未读回重型柴油正文。三国四 scope 保持 no-data，验收单增至 #47；定向发布扩展为支持空法规图并强制四 scope 空结果验收（ADR-098）。 |
| 2026-08-09 | M3 PAK/QAT/KWT/OMN/JOR 来源边界批次 | 已完成（Supabase 已发布） | 逐项读回 Pak-EPA Gazette/2025 执法页、Qatar MOT 清洁柴油政策、Kuwait EPA Decision No. 8 of 2017、Oman MD 118/2004、Jordan 环境部行动计划与 JSMO 目录。可读数值分别属于在用车检查、燃油政策或固定源；Jordan 官方材料明确新车强制标准缺口，均不满足重型发动机型式认证模型。五国精确官方来源、四 scope no-data、验收 #48–#52、ADR-100 和确定性测试已落盘；五次定向治理发布均通过目标图、covered 状态和四 scope no-data 读回。首次 PAK 发布发现并修复了误遍历全局市场 fixture 的范围缺陷。 |
| 2026-08-09 | M3 KHM/LAO/LKA/MNG 法规边界批次 | 已完成（Supabase 已发布） | KHM 读回 Prakas No. 150 的 UN R49 技术法规入口与 Sub-Decree No. 42 在用车黑烟；LAO 读回《内陆车辆法》及进口环境措施；MNG 读回政府第 148 号空气质量技术法规和车辆检查程序，三国因缺少新发动机完整限值保持四 scope no-data。LKA 两份政府公报支持 2018-08-06 起道路重型 5 项限值和 construction 六功率带共 24 条，agriculture 不外推；验收增至 #56，见 ADR-101。四国定向治理发布与公开站 API 读回均通过；KHM 首次连接中断后以幂等重试完成。 |
| 2026-08-09 | M3 CRI/ECU/DOM/DZA 法规边界批次 | 已完成（Supabase 已发布） | CRI 的 Decreto 39724-S、ECU 的 RTE INEN 017、DOM 的固定/移动源法规均只支持在用车或未公开完整型式认证限值，因此发布精确来源并保持四 scope no-data。DZA 的 Décret exécutif n° 03-410 支持 2003-11-09 起四 scope 的车辆级 g/km 与不透光度限值，共 28 条；不推断 Euro 等效或发动机 g/kWh。验收增至 #60，见 ADR-102；四国目标图、coverage、聚焦验收、公开 API 与国家页面读回均通过。 |
| 2026-08-10 | M3 TUN 来源边界深化 | 已完成（Supabase 已发布） | 环境部“污染与危害防治”分类仅列车辆定点噪声检查等条目，交通部道路运输法规目录未提供重型柴油新发动机型式认证文书、试验循环或限值表。TUN 两条来源升级为精确官方目录，四 scope 保持 no-data，未来占位核验时间改为实际 UTC 读取时刻；验收增至 #61，定向治理发布与公开 API/页面回读通过，见 ADR-103。 |
| 2026-08-10 | M3 ETH/GTM/HND/PAN/URY 法规边界批次 | 已完成（Supabase 已发布） | ETH 依据 Directive 1051/2025 与 ES 6725:2022 发布 N2/N3 无歧义 CO/NOx/PM 三项；URY 依据 Decreto 135/021 Table 17 发布卡车/客车 ESC/ETC 各 9 项。GTM 的 2027 计划、HND 的后续授权及车辆排除、PAN 的年检/在用车规则保持四 scope no-data；五国替换为精确官方来源，验收增至 #66，五次定向治理发布与公开 API/页面回读通过，见 ADR-104。 |
| 2026-08-10 | M3 BWA/NAM/TZA/UGA 法规边界批次 | 已完成（Supabase 已发布） | BWA 自愿在用车标准、NAM 监管/标准职责页、TZA 运行合规表与 draft 均不足以发布新发动机限值；UGA S.I. No. 22 of 2024 有效法规元数据入库，但 Schedule 4 原印 `kg/kWh` 且 GVW/类别冲突，零 numeric limit。四国精确来源、四 scope no-data、验收 #67–#70 与 ADR-105 已落盘；四次定向治理发布通过，公开 API 已读回 UGA 有效法规/UNBS 来源链与 BWA/NAM/TZA 精确来源。治理 schema 新增显式 `limitsUnavailable` 状态，仍拒绝未签核的空限值法规。 |
| 2026-08-10 | M3 ZMB/ZWE/RWA/CIV 法规边界批次 | 已完成（Supabase 已发布） | ZMB 固定源许可/道路烟雾授权、ZWE 设施发电机许可与未公开 SAZ 数值、RWA 付费 RS EAS 1047 正文与在用车检查、CIV 不完整法令摘录与周期检验均不足以发布新发动机限值。四国替换为八个精确来源，未来占位核验时间改为 `2026-08-10T04:06:07Z`，验收增至 #74，见 ADR-106；四次定向治理发布均通过目标图、covered 与四 scope no-data 验收，公开 API 已读回统一核验时间和精确来源链。 |
| 2026-08-10 | M3 CMR/SEN/MOZ/SWZ 法规边界批次 | 已完成（Supabase 已发布） | CMR 的在用车 NC 2858 原印柴油单位不完整；SEN 的 ASN 目录未公开正文且 Road Code 是车辆烟度/浓度检查；MOZ 的 SIBMOZ 移动源条目未提供原始完整表，车型审批页也无数值；SWZ 的空气条例、适行性职责和 draft homologation 均不足以建立 effective 新重型发动机限值。四国替换为八个精确来源，实际核验时间统一为 `2026-08-10T04:26:52Z`，验收增至 #78，见 ADR-107；四次定向发布与公开 API/页面读回全部通过。 |
| 2026-08-10 | M3 LSO/MDG/MUS/MWI 法规边界批次 | 已完成（Supabase 已发布） | LSO 只有重型车辆适行性服务与 2006 年待立法草案；MDG 只从官方 EIA 读回 Arrêté 6941/2000 汽车烟度法令身份，CNLEGIS 未给该原文；MUS 是在用车 50%/70% 不透光度执法；MWI 是公共道路烟雾/滋扰定性义务。四国替换为八个精确来源，实际核验时间统一为 `2026-08-10T04:44:14Z`，验收增至 #82，见 ADR-108；四次定向发布与公开 API/页面读回全部通过。MUS 首次发布还修复了新目录国家必须先以 `planned` 建档、目标图完整后再提升 `covered` 的顺序缺陷。 |
| 2026-08-10 | M3 FJI/BLZ/BRN/BTN 法规边界批次 | 已完成（Supabase 已发布） | FJI 的 FRCS 进口法律解释与 2026 Euro 4 准入、BLZ 留待部长规定的机动车数值、BRN 道路定性义务与 `<50% HSU` 适行性检查、BTN 按注册日期的 `%HSU` 标准均不足以建立新重型发动机完整限值。四国替换为八个精确来源，实际核验时间统一为 `2026-08-10T05:06:30Z`，验收增至 #86，见 ADR-109；四次定向发布与公开 API/页面读回全部通过，四 scope 保持 no-data。 |
| 2026-08-10 | M3 CAF/COD/COG/CUB 法规边界批次 | 已完成（Supabase 已发布） | CAF 的项目级柴油烟雾维护措施、COD/COG 的一般空气义务与周期车辆检查、CUB 的道路尾气/不透光度技术检查均不足以建立新重型发动机完整限值。四国替换为八个精确来源，实际核验时间统一为 `2026-08-10T05:38:27Z`，验收增至 #90，见 ADR-110；四次定向发布与公开 API/页面读回全部通过，四 scope 保持 no-data。 |
| 2026-08-10 | M3 DJI/ERI/GAB/GIN 法规边界批次 | 已完成（Supabase 已发布） | DJI 的尾气/烟度技术检验、ERI 的排放标准委托与年度车辆检查、GAB 的后续阈值授权与周期适行性检查、GIN 的法规委托与技术检验数字化均不足以建立新重型发动机完整限值。四国替换为八个精确来源，实际核验时间统一为 `2026-08-10T06:21:10Z`，验收增至 #94，见 ADR-111；四次定向发布与公开 API/页面读回全部通过，四 scope 保持 no-data。 |
| 2026-08-10 | M3 GMB/GNB/GNQ/GRL 法规边界批次 | 已完成（Supabase 已发布） | GMB 的环境空气表/待磋商车辆检验方案、GNB 的专门立法授权/交通部职责、GNQ 的法律身份/目视在用车检查、GRL 的现行设备令/定性烟气义务均不足以建立新重型发动机完整限值。四国替换为八个精确来源，实际核验时间统一为 `2026-08-10T06:44:56Z`，验收增至 #98，见 ADR-112；四次定向发布与公开 API/页面读回全部通过，四 scope 保持 no-data。 |
| 2026-08-10 | M3 GUY/HTI/IRN/IRQ 法规边界批次 | 已完成（历史 Supabase 发布） | GUY 的后续车辆标准授权/适行性规则和 HTI 的一般环境框架/进口技术检查不足以建立新重型发动机完整限值；IRN/IRQ 当时 source 读取不完整。四国曾按八个来源发布，实际核验时间统一为 `2026-08-10T07:34:48Z`，验收增至 #102，见 ADR-113；其中 IRN 日程现已确认可读，IRN/IRQ 旧双源与理由由 #205/#206、ADR-130 supersede，当前 refresh 尚未部署。 |
| 2026-08-10 | M3 JAM/LBN/LBR/LBY 法规边界批次 | 已完成（Supabase 已发布） | JAM 的旧车型/进口车辆表、LBN 的标准委托与交通政策、LBR 的移动源标准/检查授权、LBY 的车辆测试与技术检查框架均不足以建立当前新重型发动机完整限值。四国替换为八个精确来源，实际核验时间统一为 `2026-08-10T07:58:42Z`，验收增至 #106，见 ADR-114；四次定向发布与公开 API/页面读回全部通过，四 scope 保持 no-data。 |
| 2026-08-10 | M3 MLI/MMR/MRT/NCL 法规边界批次 | 已完成（Supabase 已发布） | MLI 的在用车尾气/定性烟气条款、MMR 的固定源指南/Bosch 烟度检查、MRT 的实施标准授权、NCL 的环境空气监测/车辆检查周期均不足以建立新重型发动机完整限值。四国替换为八个精确来源，实际核验时间统一为 `2026-08-10T08:31:37Z`，验收增至 #110，见 ADR-115；四次定向发布与公开 API/页面读回全部通过，四 scope 保持 no-data。 |
| 2026-08-10 | M3 NER/NIC/PNG/PRI 法规边界与 PNG 卡车代表路径批次 | 已完成（Supabase、VPS 与公网读回） | NER 的后续标准授权、NIC 的在用/进口车辆 60%–80% 自由加速烟度、PRI 的 20% 静止可见烟度与周期车辆检查均不足以建立新发动机认证表，三国保持四 scope no-data。PNG RTA Rule Section 6A(4)(b) 明确 >4.5 t、2012+ 柴油 motor truck 的 ADR 80/03 / Euro V / Japan 05 / US 2004 替代路径；本批只发布 ADR 80/03 代表路径 8 条并保留 model-year 警告，客车/工程/农业不外推。四次定向治理发布、目标图、`covered`、no-data/limit 验收与公网国家 API 读回均通过；VPS 已切换至 `country-20260810093046`，健康接口、首页、对话页及四个国家页面均返回 200。 |
| 2026-08-10 | M3 PRK/PRY/PSE/SDN 法规边界批次 | 已完成（Supabase 与公网读回） | PRK 环境法/INDC、PRY Decree 1269/2019/MADES 规范目录、PSE 两份 OGB 合并法律以及 SDN Environment Protection Law/UNFCCC 国家信息通报均已读回。材料只支持一般标准授权、车辆/进口检查或交通政策，四国保持四 scope no-data；PRK 原误指向韩国政府网站的来源和四国未来占位时间已纠正。验收增至 #118，见 ADR-117；完整门禁、四次定向治理发布、目标图、`covered`、no-data 验收与公网 API/四个国家页面读回均通过。 |
| 2026-08-10 | M3 SLB/SLE/SLV/SOM 法规边界批次 | 已完成（Supabase 与公网读回） | SLB Road Transport Act/NDC 3.0、SLE EPA Act/National e-Mobility Strategy、SLV Diario Oficial RTS 13.01.02:23/OSARTEC 说明及 SOM 环境法/First BUR 均已读回。SLB 只有整车许可检查与气候 KPI；SLE 明确不做 type approval，Euro 路线仅为提案/情景假设；SLV 是在用道路车辆自由加速 opacity 检查且排除工程农业；SOM 只有后续标准授权与未来 Euro 政策方向。四国保持四 scope no-data，验收增至 #122，见 ADR-118；统一实际核验时间 `2026-08-10T10:20:51Z`，完整门禁、四次定向治理发布、目标图、`covered`、公网 API 和四个国家页面读回均通过。 |
| 2026-08-10 | M3 SSD/SUR/SYR/TCD 法规边界批次 | 已完成（Supabase 与公网读回） | SSD 标准法只建立一般程序且 Second NDC 将车辆标准/尾气检测标为未实施；SUR 框架法要求另发 `beschikking`，复检许可只管场所设施；SYR Law 12/2012 是环境/EIA 框架且废止旧法，First NDC 只列检查与车队计划；TCD Decree 904/2009 将空气规则留给后续文本且相关 homologation 只管噪声，First BUR 只是老旧车队、减缓和排放因子缺口。四国保持四 scope no-data，验收增至 #126，见 ADR-119；统一实际核验时间 `2026-08-10T10:54:10Z`，完整门禁、四次定向治理发布、目标图、`covered`、公网 API 和四个国家页面读回均通过。 |
| 2026-08-10 | M3 TGO/TLS/TTO/TWN 法规边界与台湾道路重型代表路径批次 | 已完成（Supabase 与公网读回） | TGO 环境框架修法/道路实施令、TLS 环境法/道路法及 TTO 道路法/Air Pollution Rules 均只支持后续标准授权、在用车义务或车辆动力排放排除，三国保持四 scope no-data。TWN 第五条与重型引擎族审验办法支持 2021-09-01 全覆盖边界后的道路重型 WHSC/WHTC/WNTE 代表路径，卡车、客车各 16 条；不累计美国 FTP 替代路径，工程/农业不外推。验收增至 #130，见 ADR-120；统一核验时间 `2026-08-10T11:21:32Z`，完整门禁 498 tests、四次定向治理发布、目标图、`covered`、公网 API 与四个国家页面读回全部通过，并补齐四国在无参数全量 ingest 的 covered 提升清单。 |
| 2026-08-10 | M3 VEN/VUT/YEM/ATA/ATF/ESH/FLK 法规与治理边界最终批次 | 已完成（Supabase 与公网读回） | VEN Decreto Nº 2.673/1998 与 2015 Law 支持 MY2000 起、>3,500 kg 道路重型柴油客货车 Directive 91/542/EEC 代表路径；卡车/客车各 5 条 fixture，查询按 85 kW 返回 PM 0.612/0.36 g/kWh，替代美国路径不累计，Article 24 排除工程农业。VUT/YEM 只有未填充授权、未证实 Gazette 生效的 Bill、登记/在用车检查和定性烟气；ATA/ATF/ESH/FLK 只建立条约、领土、NSGT 或属地法规边界，六条目录均保持四 scope no-data。验收增至 #137，见 ADR-121；统一核验时间 `2026-08-10T11:58:54Z`，完整门禁 506 tests、七次定向发布、VEN 数值读回、`covered`、公网 API/页面与健康接口全部通过；全量 ingest 的 covered 集合改为显式列表与 membership allowlist 的并集，避免后续漏升。 |
| 2026-08-10 | M3 既有 14 国 accepted fixture 生产同步 | 已完成（生产数据库同步） | ARG、CHL、COL、ISL、IDN、MYS、NZL、NGA、NOR、PER、RUS、CHE、GBR、VNM 的既有 accepted source、jurisdiction、regulation/limit 图已同步至生产治理库；本项只记录同步结果，不改变各国原签核的 scope、代表路径、no-data 与有效期语义。 |
| 2026-08-10 | M3 IND/PHL/SAU/ZAF/ARE 生产发布 | 已完成（生产数据库同步） | IND 的 BS VI/CEV/TREM accepted 图与 PHL/SAU/ZAF/ARE 精确 source-only/no-data 图已按现有验收边界发布；后四国仍不得因 `covered` 状态而推断四 scope 存在完整发动机限值。 |
| 2026-08-10 | M3 UKR/MDA 深化与生产发布 | 已完成（Supabase 已发布） | UKR 依据 Law No. 2739-IV 与 Order No. 521 在 `[2016-01-01, 2027-01-01)` 发布道路 Euro V B2 代表路径，卡车/客车各 9 条，两个非道路 scope no-data，2027 Euro VI 切换点失败关闭；MDA 两条统一 type-approval 材料均为 draft/consultation，四 scope no-data。验收 #138–#139，见 ADR-122；核验时刻分别为 `2026-08-10T12:59:02Z`、`2026-08-10T13:04:28Z`。 |
| 2026-08-10 | M3 THA/ALB/SRB/BIH/MKD/MNE/NPL 深化批次 | 已完成（Supabase 与公网读回） | THA 自 2024-01-01 发布道路 TIS 3046 各 9 条；BIH 自 2019-06-01 发布 R49/06 道路各 12 条；MNE 自 2018-10-15 对 >15 kW 道路发布各 16 条，15.001 kW 为 schema 严格边界；NPL 自 2025-06-23 对 GVW >3,500 kg 道路发布各 16 条并明文排除非道路。ALB/SRB/MKD 四 scope no-data；四个道路法规的 construction/agriculture 也保持 no-data。见 ADR-122/123；七次定向治理发布、目标图、`covered`、公网详情 API 与七个国家页面均通过，公开总表快照为 156 `covered` / 19 `no_data`。 |
| 2026-08-10 | M3 最终 19 国法规深化批次 | 已完成（Supabase 与公网读回） | ACCEPTANCE #147–#165 与 ADR-124 已固化并发布：ARM/BLR/KAZ/KGZ 道路 B2 各 9 条加农业 Stage IIIA 四功率带，GEO 道路各 9 条，UZB 仅农业 H 带 3 条，BGD/BOL 道路各 4 条；AZE/TJK/TKM/AFG/AGO/BDI/BEN/BFA/BHS/MAR/KEN 及其他未闭合 scope 均失败关闭。19 次定向发布、目标图与 scope 验收全部通过；19 个详情 API/页面、首页和健康接口均返回成功，公开总表为 175 `covered` / 0 `no_data`。共享 EAEU 定向发布保留五国成员，ARM/KGZ 入盟日期已精确到 2015-01-02/2015-08-12。 |
| 2026-08-08 | M4 AI 对话编排完善 | 已完成 | `/api/chat` 在严格用户消息校验后增加保守的确定性对话分流：问候、能力询问、致谢、模糊请求及明显缺参的产品/比较问题直接给出能力说明或具体追问，不再强制调用空国家工具；事实问题继续首步强制 Zod 工具并保持证据失败关闭。系统提示补充当前 UTC 日期、最小工具选择、主题映射、ISO3 规范化和回答结构；无充分证据时按失败工具说明国家、法规、可比指标、适配、评分、简报或检索缺口。Vitest 357 条通过，新增 Playwright 流程验证能力询问不出现工具卡片或通用证据不足。 |
| 2026-08-09 | M7 求职展示与零配置 Demo | 已完成首版 | README 首屏加入在线站、真实截图、黄金流程、工程难点和质量门；新增 `pnpm demo`，无需 PostgreSQL/Docker/AI Key 即可用真实 Migration、PGlite、显式 Demo fixture 和确定性离线模型复现原有工具/引用/证据门；STATUS 统一当前状态，DEPLOYMENT/ARCHITECTURE/ADR 区分作品 Demo、公开只读站与业务生产。 |
| 2026-08-11 | M4 对话多模态入口 | 已完成（待本轮发布） | 对话支持最多 4 个 PNG/JPEG/WebP、PDF、TXT/Markdown/CSV；客户端预览/移除并在发送后释放 base64，服务端校验内联数据、图片结构/像素、UTF-8、大小与总量。图片只在独立视觉模型可用时开放；PDF 由 `unpdf` 顺序流式提取，受 40 页、30,000/40,000 字符与共享 15 秒 deadline 约束并完整清理资源。纯附件概述可带未核验前缀返回，法规/认证/产品/市场混合问题仍强制本轮事实工具。见 ADR-125。 |
| 2026-08-11 | M3 稳定 33 国与数据纠错收口 | 已完成（本地 accepted，生产待本轮部署） | `ACCEPTANCE.md` #166–#198、ADR-126/127 与完整 fixture 测试收口 CRI/ECU/PAN/DOM、PHL/PAK/SAU/ARE/ISR、ZAF/EGY/GHA/KEN/RWA/TZA/ZMB/ZWE/CIV、DZA/TUN/ETH/CMR/SEN、NGA/UGA/BWA/NAM/SWZ、KHM/LAO/LKA/MMR/MNG。DZA/ETH/NGA 旧 numeric regulation/limit 已从 publishable fixture 移除，定向或全量 ingest 需归档其历史记录；UGA 保留有效 metadata-only regulation、零 limits。ECU/PHL/PAK/SAU/ARE/ISR/ZAF/RWA 仅按当前闭合路径发布；LKA 自 `2018-07-13` 保留道路 5+5 与工程 24 条，C1/D2 不累计且 agriculture no-data，2079/70 clause 8 的信用证过渡豁免保留在 summary/measurement basis；KHM/LAO/MMR/MNG 各两条精确来源、四 scope no-data。五国 `verifiedAt=2026-08-10T17:38:18Z`、no-data membership=`2026-08-10`。生产数据库、公开 API/页面与覆盖状态均待 2026-08-11 本轮部署；发布队列另含 LIE（2 regulations / 80 limits / 4 sources）与 SGP（2 / 40 / 3）的既有已签核图运行库缺口同步，合计 35 个定向命令，但不改变 #166–#198 或稳定 33 国计数。 |
| 2026-08-11 | M3 MAR/KEN source-currentness 纠错 | 已完成（source-only 本地 accepted，生产待刷新） | `ACCEPTANCE.md` #199–#200 与 ADR-128 将 MAR 第二条主 source 从咨询矩阵纠正为 BO n°7028 / Arrêté 2251-21，并把 KEN LN180 更新到 Kenya Law `eng@2025-03-24` 最新合并表达式；两国统一 `verifiedAt=2026-08-10T18:48:04Z`。2251-21 虽公开完整 WHSC/WHTC 表和循环，但 2094.24 将道路重型实施推迟到 2027/2028；KEN 仍是周期/注册前 inspection，因此两国四 scope no-data、limits 与稳定 33 国均不变。基础 35 国命令已包含 KEN，只新增 MAR；追加后当时合并队列为 44 个唯一国家命令，现由 #209–#243 的 79 国清单 supersede。 |
| 2026-08-11 | M3 QAT/KWT/OMN/JOR source-currentness 纠错 | 已完成（source-only 本地 accepted，生产待刷新） | `ACCEPTANCE.md` #201–#204 与 ADR-129 将四国各自固定为恰好两条当前官方 source，统一 `verifiedAt=2026-08-10T18:48:04Z`。QAT 的燃油政策与 2019 标准采纳、KWT 的 1992/2015 标准决定、OMN 的 Decision 120/2024 与 GSO MY2026 边界、JOR 的官方计划与 JSMO 目录均未闭合新重型发动机五门槛；GSO 国家标签不得代替本国实施链。四国 16 scope no-data、每国零 regulation/limits，limits 与稳定 33 国不变；追加后当时合并队列为 44 个唯一国家命令，现由 #209–#243 的 79 国清单 supersede。 |
| 2026-08-11 | M3 IRN/IRQ/LBN/SYR source-currentness 纠错 | 已完成（source-only 本地 accepted，生产待刷新） | `ACCEPTANCE.md` #205–#208 与 ADR-130 将 IRN 固定为 post-41054 合并条例 + post-44973 修订，确认 Article 4 日程可读；IRQ 固定为 COSQC Meeting 507 / TR 167 amendment + INA 2025-12-12；LBN 固定为 Law 444 + Third BUR；SYR 固定为 Law 12 + SANA 2025-06-30。统一 `verifiedAt=2026-08-10T18:55:45Z`、membership `validFrom=2026-08-10`。四国逐 scope 按法定新发动机类别、分类/功率、完整污染物表、认证循环、实施边界五门槛失败关闭，共 16 scope no-data、每国零 regulation/limits；YEM no-change。四条 refresh 在 QAT/KWT/OMN/JOR 后追加；当时队列为 44 个唯一国家命令，现由 #209–#243 的 79 国清单 supersede。 |
| 2026-08-11 | M3 35 国 source-currentness 总收口 | 已完成（本地 accepted/source-only，生产待刷新） | `ACCEPTANCE.md` #209–#243 与 ADR-131 按七批刷新每国恰好两条 current source；34 国四 scope no-data、URY 保留 1 regulation / 18 limits。当时本地闭包为 79 jurisdictions / 16 regulations / 328 limits / 165 sources，该历史小计已由 #244–#259 / ADR-133/134 的 95 国当前队列 supersede；本批仍尚未生产刷新。 |
| 2026-08-11 | M3 AUS/PNG/CAN/USA 数值完整性收口 | 已完成（CAN/USA 非道路 partial 边界由 #263–#264 / ADR-136 替代） | ACCEPTANCE #244–#247 / ADR-133 当时锁定 AUS 每道路 scope 9→12、PNG truck 9 条、CAN 仅 130–560 kW 非道路带与 USA 38 条目标图；CAN/USA 的 partial 非道路描述现已 superseded，AUS/PNG 结论仍有效。生产数据库和公网尚未同步。 |
| 2026-08-11 | M3 十二国 source-currentness 收口 | 已完成（source-only 本地 accepted，生产待刷新） | ACCEPTANCE #248–#259 / ADR-134 将 BRN/BTN/SLB/TLS/MWI/SLE/SOM/SSD/TCD/SLV/SUR/TTO 各自固定为恰好两条 current source，统一 `verifiedAt=2026-08-10T23:08:11Z`，48 个 scope 全部 no-data。追加 CAN/USA 后当时队列为 95 个唯一 ISO3，闭包为 95 jurisdictions / 24 regulations / 433 limits / 199 sources；该历史小计已被当前 97 国闭包 supersede。 |
| 2026-08-11 | M3 MLT EU-27 与 CHN GB 20891 完整功率带纠错 | 已完成（本地 accepted，生产待发布） | ACCEPTANCE #260–#261 / ADR-135 将 MLT 加入 178 国目录与固定 Natural Earth 1:10m 几何，EU 成员关系自 `2004-05-01` 生效并复用共享 2 regulations / 80 limits / 3 sources；地图现有 177 个唯一 ISO3，仅 MUS 无几何。CHN 保存 `2016-04-01` 起的国三历史四带与 `2022-12-01` 起的国四四带，560 kW 闭合在国四，560.001 kW 延续国三；NRSC/NRTC 条件显式，NH3 条件行不发布，定向图为 2 regulations / 74 limits / 3 sources（含 HJ 1014）。生产数据库与公网均尚未同步。 |
| 2026-08-11 | M3 ARE/CAN/USA 末轮边界纠错 | 已完成（本地 accepted，生产待发布） | ACCEPTANCE #262–#264 / ADR-136 将 ARE 普通 numeric 边界从只适用于新车型的 `2026-01-01` 纠正为全部进口车辆 `2027-07-01`；CAN/USA 补齐 §1039 法定展示的六个 variable-speed 带，并依 §1039.140 / §1065.20(e) ties-to-even 固定三位 raw 查询翻译：`[0,7.5)`、`[7.5,18.501)`、`[18.501,36.501)`、`[36.501,55.5)`、`[55.5,129.5)`、`[129.5,560.501)`。因此 560/560.001/560.500 kW 同属最高带，560.501 kW 无结果；展示标签仍为 P<8…130≤P≤560。两国于 `2026-08-11T05:21:45.000Z` 重新签核，target 分别为 48/70 limits；当前队列为 97 countries / 97 jurisdictions / 28 regulations / 651 limits / 203 sources，生产数据库和公网尚未同步。 |
| 2026-08-11 | M7 治理快照恢复门 | 已完成代码、PGlite 与生产恢复演练 | 治理快照升级为严格 v3，顶层 PostgreSQL 时间戳保留六位微秒、JSONB 保留原始高精度文本，内嵌九表计数并记录 SHA-256；恢复命令默认 database-free dry-run，显式 `--apply` 才在 serializable 单事务中验证父维护锁、预检自然唯一键/外部副作用并物理精确恢复。shared/exclusive advisory-lock、session heartbeat 与防重入 ERR/HUP/INT/TERM/EXIT trap 连续覆盖 fresh export、前后快照等价演练、97 国发布和公开验收；不可捕获中断保留 0600 recovery marker。测试覆盖微秒、高精度 JSONB、锁失效、自然键/外部引用、恢复后计数和末段失败整单回滚；release `20260812031745` 已完成生产快照、`--apply` 恢复演练、前后深比较、97 国发布与 marker 清理。见 ADR-132/137。 |
| 2026-08-12 | M3/M4 全球法规与多模态生产发布 | 已完成（VPS、PostgreSQL 与公网读回） | release `20260812031745`（Git `a779901`）完成不可变目录、`diesel` 降权进程、共享 `.data`、Nginx、PM2、视觉模型配置与治理发布。97 个唯一国家命令逐项通过；公开 `/api/health` 返回目标版本，`/api/countries` 返回 178 个唯一且全部 `covered` 的国家，CHN 返回 3 条当前法规并保留 CN-MEE/HJ 1014 来源链；恢复 marker 已清理。历史“本地 accepted / 待部署”状态由本行 supersede。 |

> **Superseded 注记（2026-08-11）**：上表 2026-08-09 至 2026-08-10 关于
> DZA、ETH、NGA 的 numeric 发布结论，以及 RWA、PHL、SAU、ARE、ZAF、ISR 的旧
> no-data 结论，以及 KHM/LAO/LKA/MMR/MNG 的旧日期/发布状态，均为历史轨迹；
> 当前产品事实以 #166–#264、ADR-126/127/128/129/130/131/133/134/135/136/137、fixture/tests 及 accepted source
> 边界为准。稳定 33 国及 #199–#264 已随 release `20260812031745` 完成生产发布；#199–#243
> 是 45 国 source-currentness refresh，不增加稳定国家或 limits（URY 只纠正
> source 发布日并保留既有 18 limits）。LIE/SGP 是既有签核图的运行库缺口补同步，
> 不属于本批新增验收国家。原 79 国队列是追加 #244–#259 前的历史小计，95 国闭包
> 又是追加 #260–#264 前的历史小计；当前 97 国发布结果以 DEPLOYMENT 生产记录为准。

### 13.5 国家数据覆盖计划

| 层级 | 国家 | 数据深度 | 验收重点 |
| --- | --- | --- | --- |
| A1 深度样板 | CHN、USA、DEU/EU、BRA、IND（均已完成法规 fixture） | 四类动力的法规、有效期、功率、来源与代表性产品适配 | 已形成 5 个可自动测试的法规纵向切片；真实产品认证仍待输入 |
| A2 深度扩展 | JPN、KOR、MEX、TUR、AUS | JPN/KOR/MEX/TUR/AUS 已完成 | 验证非欧盟法规体系和不同市场成熟度 |
| B 主流摘要 | CAN、GBR、RUS、IDN、THA、VNM、MYS、SAU、ARE、ZAF、ARG、NZL、CHL、COL、PER、PHL、SGP、NOR、ISL 与 EU 成员 FRA/ITA/ESP/POL 已完成；稳定批次另收口 ECU、PAK、ISR、RWA | THA 已有道路 TIS 3046；ECU/PHL/PAK/SAU/ARE/ZAF/RWA 已闭合当前道路代表路径，ISR 已闭合道路 + 工程路径；各国其余 scope 按证据保持 no-data | 代表/替代路径不得累计；`covered` 不表示所有 scope 有限值；LIE/SGP 本轮只补运行库缺失图 |
| C 全球目录 | 地图中其余 ISO3 国家；最终 19 国与 UKR/MDA/ALB/SRB/BIH/MKD/MNE/NPL 均已生产升级精确来源 | 名称、区域、覆盖状态；有闭合实施链时保存代表路径，无闭合链时保持 scope no-data | 地图无空白国家；`covered` 只表示证据边界已发布，空 scope 不得推断法规 |

### 13.6 发布红线

- 真实业务环境不得使用 `DATABASE_MODE=pglite-demo`、Demo Seed 或
  `local-hash-embedding-v1`。
- 未配置可信上游身份代理时，不得把 `/admin` 或信任身份 Header 的源站暴露到公网。
- 未完成来源许可与法规专家核验时，不得把数据标为 verified，也不得用于销售承诺。
- 未完成区域、保留和外部模型审批时，不得向模型发送真实法规文档或内部产品资料。
- 未完成备份恢复、回滚和数据纠错演练时，不进入业务试点。
