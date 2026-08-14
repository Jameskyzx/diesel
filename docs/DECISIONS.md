# 架构决策记录

## 1. 使用方式

- `Accepted`：当前实施基线；改变时新增决策，不静默覆盖。
- `Proposed`：建议方案，仍需业务或技术确认。
- `Blocked`：未确认前会阻塞对应实施阶段。
- 每个影响 schema、依赖、安全边界或核心行为的变化都应更新本文。
- ADR 中的数量与状态是作出决策时的历史快照；当前可验证状态统一见
  [STATUS.md](STATUS.md)，不通过回写旧 ADR 改变历史语境。

## 2. 已接受决策

### ADR-001：采用模块化单体

- 状态：Accepted
- 决策：使用一个 Next.js App Router 应用承载 UI、route handlers、领域服务和 AI 编排；通过目录和 server-only import 建立边界。
- 理由：MVP 团队和用例尚不足以支持微服务成本，单体更容易保持事务、类型和测试一致。
- 后果：Repository/Service 边界必须清晰，以便未来有证据时拆分。

### ADR-002：ISO3 是国家 canonical key

- 状态：Accepted
- 决策：数据库和 GeoJSON 使用 ISO 3166-1 alpha-3 大写代码连接。
- 理由：满足产品要求，并减少名称、翻译和别名导致的 join 错误。
- 后果：所有外部数据入库先做 ISO3 映射和校验；未知/历史代码不得静默替换。

### ADR-003：结构化事实与知识文档分层

- 状态：Accepted
- 决策：法规名称、状态、日期、要求、限值、市场值、产品参数和认证进入关系表；原文和解释性文本进入文档存储与 chunks。
- 理由：确保确定性查询、约束和追溯。
- 后果：检索片段不能直接充当权威结构化事实；抽取结果需核验后才能进入事实表。

### ADR-004：使用单 Agent 与有限确定性工具

- 状态：Accepted
- 决策：MVP 只有一个 Agent，调用有限、只读、Zod 校验的 application tools。
- 理由：控制事实来源、成本、审计和失败模式。
- 后果：不实现子 Agent、任意 SQL、自治写入或开放网络工具。

### ADR-005：LLM 不计算权威结论

- 状态：Accepted
- 决策：法规适用、市场可比性、product-fit 和营销评分由版本化确定性代码计算；LLM 只能解释。
- 理由：同一事实输入必须可复现、可测试。
- 后果：工具输出保留 reasons、sources、verifiedAt 和 rulesetVersion，UI 直接渲染结构化结果。

### ADR-006：状态、业务有效期和核验时间分离

- 状态：Accepted
- 决策：`proposed/adopted/effective/superseded` 是显式状态；`effective_*`/`valid_*` 表示业务时间；`verified_at` 表示核验时间。
- 理由：三者语义不同，不能互相推断。
- 后果：所有查询和界面必须同时考虑并显示相关信息。

### ADR-007：日期与功率区间使用半开区间

- 状态：Accepted
- 决策：内部使用 `[from,to)` 和 `[power_min_kw,power_max_kw)`；NULL 上界表示开放。
- 理由：避免相邻阶段在边界重复命中。
- 后果：数据导入、SQL、领域规则和测试使用同一语义；原文不同语义需显式转换并保留说明。

### ADR-008：通过司法辖区建模跨国法规

- 状态：Accepted
- 决策：法规属于 jurisdiction；country 通过带有效期的 membership 连接 regional jurisdiction。
- 理由：法规发布主体不总是单一国家，成员关系也可能随时间变化。
- 后果：适用查询必须考虑 membership 的 as-of 时间；国家实施差异需要独立法规/要求表示。
- 2026-08-05 实现核验：国家详情 Repository 强制传入 `asOf`，成员关系和法规均按
  `[validFrom,validTo)` / `[effectiveFrom,effectiveTo)` 过滤；集成测试验证同一历史
  成员在 2009 可见、2026 不可见。
- 同日追溯与归档门补齐：国家详情返回辖区实体来源和成员关系来源；国家详情、法规
  比较、市场比较与 product-fit 沿国家/辖区/成员/事实及各自来源过滤软归档。归档
  任一适用链证据后，不再返回依赖该证据的法规或市场观测。

### ADR-009：普通地图交互不使用 PostGIS

- 状态：Accepted
- 决策：世界边界作为简化静态 GeoJSON 由 MapLibre 加载；数据库仅以 ISO3 提供摘要和详情。
- 理由：国家点击是属性 join，不需要空间计算。
- 后果：只有明确空间功能和 ADR 后才增加 PostGIS 查询。

### ADR-010：国家选择进入 URL

- 状态：Accepted
- 决策：国家详情使用 `/countries/[iso3]`；关键筛选建议进入 query string。
- 理由：支持分享、刷新、浏览器历史和测试。
- 后果：路径/查询参数在服务端使用 Zod 校验。

### ADR-011：服务端密钥与数据访问隔离

- 状态：Accepted
- 决策：数据库、Supabase service role、对象存储签名和模型 API Key 只存在于 server-only 模块。
- 理由：避免浏览器泄露特权凭证。
- 后果：Client Component 不直接调用 Supabase 特权接口；数据经过 repository/service/route 边界。

### ADR-012：混合检索先过滤元数据

- 状态：Accepted
- 决策：检索先按司法辖区、国家、scope 和日期过滤，再融合全文与向量结果。
- 理由：相似文本不等于适用于目标场景。
- 后果：chunks 必须保留足够元数据；冲突证据被过滤或警告。

### ADR-013：向量索引延后

- 状态：Accepted
- 决策：在代表性语料、Embedding 模型和检索基准完成前，不添加生产 HNSW/IVFFlat 索引。
- 理由：索引参数和距离度量依赖真实数据，过早建立会制造错误优化。
- 后果：小规模阶段可使用精确检索；阶段 6 以测量结果决定索引。

### ADR-014：来源优先的工具契约

- 状态：Accepted
- 决策：AI 工具返回结构化 facts、warnings、sources、verifiedAt 和规则版本；UI 优先渲染这些结构。
- 理由：防止自然语言掩盖来源和不确定性。
- 后果：AI 文本不能覆盖或修改工具卡片中的值。

### ADR-024：第一版物理 Schema 使用 11 张核心表

- 状态：Accepted
- 日期：2026-07-29
- 决策：第一版按 `countries`、`jurisdictions`、`country_jurisdictions`、`regulations`、`regulation_limits`、`products`、`product_certifications`、`market_metrics`、`data_sources`、`documents`、`document_chunks` 落地。较长期目标模型中的 requirement/limit、metric definition/observation 和 product family/configuration 暂时折叠。
- 理由：当前任务明确要求这 11 个实体；在真实数据切片尚未冻结时避免建立未经验证的细分表。
- 后果：后续真实数据证明需要更细粒度时，必须通过新的 Drizzle Migration 规范化，不能静默重解释现有列。
- 验证方式：空 PGlite PostgreSQL 执行真实 Migration，并核对 11 张表、外键、索引和 Repository 查询。

### ADR-025：使用 PGlite 进行数据库集成测试

- 状态：Accepted
- 日期：2026-07-29
- 决策：生产连接使用 `postgres` + Drizzle；测试使用仅开发依赖的 PGlite，在进程内从空库执行同一 SQL Migration。
- 理由：Repository 和 Migration 测试需要 PostgreSQL 语义，同时不应要求每个开发/CI 环境预装 Docker。
- 后果：PGlite 不作为生产数据库；上线前仍需在目标 Supabase PostgreSQL 环境运行迁移预演。
- 验证方式：测试覆盖空库 Migration、重复 Seed、国家查询、有效法规查询和产品适配证据查询。

### ADR-026：阶段 2 Seed 仅包含显式虚构 Demo 数据

- 状态：Accepted
- 日期：2026-07-29
- 决策：使用稳定 ID、`is_demo = true`、`DEMO ONLY` 名称、`.invalid` URL 和 demo notice；不提供任何声称真实的法规、限值、认证或市场数值。
- 理由：ADR-015 的真实 MVP 数据切片尚未冻结，但数据库和查询仍需可重复验收 fixture。
- 后果：Demo Seed 不解除 ADR-015 的阻塞状态，不能用于销售或法规结论。
- 验证方式：Seed 重复运行后记录数不变，Repository 返回 demo 标记和 demo 来源。

### ADR-027：使用 Natural Earth 1:110m 静态国家边界

- 状态：Accepted
- 日期：2026-07-29
- 决策：地图边界使用 Natural Earth 公共领域
  `ne_110m_admin_0_countries.geojson`，固定来源 revision
  `ca96624a56bd078437bca8184e78163e5039ad19`。Web 子集只保留 ISO3、名称与
  几何；无 ISO 3166-1 alpha-3 的 feature 不进入产物。
- 理由：当前用例是全球国家选择，不需要高分辨率边界或瓦片底图；1:110m
  文件体积小、许可明确，足以完成 MVP 交互。
- 后果：边界表达不用于法律领土判断；地图展示不代表公司对边界或主权争议的
  立场。若生产上线更换边界或增加底图，仍需完成 ADR-018 的独立许可审核。
- 验证方式：构建产物包含 174 个唯一 ISO3 feature，并验证 CHN、BRA、DEU
  与 USA 存在；来源与转换规则记录在 `public/geo/README.md`。
- 2026-08-08 增补：为发布已核验的新加坡法规，按同一固定 revision 的 Natural
  Earth 1:10m 数据补入 1:110m 缺失的 SGP 多边形；目录现为 175 个唯一 ISO3。
  这不改变边界仅用于国家选择、不用于法律领土判断的约束。

### ADR-028：MapLibre 与 Drawer 的依赖边界

- 状态：Accepted
- 日期：2026-07-29
- 决策：新增并固定 `maplibre-gl@5.24.0` 负责 WebGL GeoJSON 渲染、
  feature-state 与地图指针/触控事件；新增 `vaul` 作为 shadcn/ui Drawer 的
  底层可访问 primitive。
- 理由：Canvas 地图交互无法由现有 React/Tailwind 组件替代；现有组件集中
  没有具备焦点、Escape、拖拽语义的 Drawer primitive。
- 后果：MapLibre 只存在于 Client Component；国家事实仍经 API/Repository。
  Drawer 使用非模态右侧面板，以允许打开详情后继续点击地图切换国家。
  MapLibre v6.0.0 刚切换为 ESM-only/WebGL2，并在当前 Next.js 16 +
  Playwright 组合中未能稳定完成 GeoJSON 初始化，因此本阶段采用官方最终 v5
  版本；升级需重新通过真实 polygon click 测试。
- 验证方式：TypeScript strict、Playwright desktop/mobile 以及打开/切换/
  no-data 流程通过。

### ADR-029：浏览器测试使用显式 PGlite Demo 运行模式

- 状态：Accepted
- 日期：2026-07-29
- 决策：增加 `DATABASE_MODE=postgres | pglite-demo`，默认且生产值为
  `postgres`；Playwright web server 显式使用 `pglite-demo`，并在进程内执行
  同一 Drizzle Migration 和确定性 Seed。
- 理由：国家详情必须从真实 API/Repository/关系数据库链路返回，同时本地
  Playwright 不应依赖已安装的 PostgreSQL 或 Docker。
- 后果：Demo 模式会增加测试服务首次请求时间，并只允许作为显式测试配置；
  应用不会在 PostgreSQL 失败时自动回退到 Demo 数据。Playwright 使用测试专用
  Next custom server，并在 global teardown 通过仅 Demo 模式可用的本地端点
  主动关闭，以避免 Windows 环境遗留开发服务器进程。
- 验证方式：API E2E 同时验证 `available` 与 `no_data` 响应，生产 build
  不执行 Seed。

### ADR-030：采用受限的确定性 product-fit-v1

- 状态：Accepted
- 日期：2026-07-29
- 决策：第一版只使用国家、as-of 日期、application scope、功率、当前
  `effective` 法规、产品 scope/功率、产品认证状态/范围/有效期计算
  `fit | not_fit | unknown`。区间统一为半开区间。缺少产品、法规或认证证据为
  `unknown`；产品范围明确不覆盖，或已有认证记录但没有一条在状态、scope、功率
  和日期上有效时为 `not_fit`；全部适用法规均被有效认证覆盖时才为 `fit`。
- 理由：用户已明确授权这组最小判断字段；规则可由纯函数复现并覆盖边界测试，
  无需 LLM 或新 Schema。
- 后果：每项结果必须返回 reason code、ruleset version、法规/认证记录 ID、
  来源和核验时间。`partial_fit`、产品可售期、完整配置兼容性、库存、商业可售性、
  市场排名与营销评分不在 v1 结论内。
- 验证方式：Vitest 覆盖功率上下界、认证有效期起止边界和缺认证 unknown；
  Playwright 在桌面/移动端覆盖 fit、not_fit、unknown。
- 2026-08-05 证据失败语义收紧：认证记录自身 `status=unknown` 时，若没有
  scope、功率或日期等明确不覆盖证据，则认证检查和总适配结论保持 `unknown`，
  不再把未知状态解释成确定的 `not_fit`。
- 2026-08-06 有效期缺失语义收紧：认证 `validFrom=null` 表示生效起点未知，
  不得按负无穷解释为覆盖任意 `asOf`；新增 `CERTIFICATION_VALIDITY_UNKNOWN` 并保持
  总结论 `unknown`。已知 `validFrom` 且 `validTo=null` 仍表示开放上界。
- 同日收紧认证功率缺失语义：`powerMinKw=null` 表示覆盖下界未知，不得按负无穷
  推断覆盖；新增 `CERTIFICATION_POWER_RANGE_UNKNOWN`。若已知 `powerMaxKw` 已明确
  越界仍为 `not_fit`；已知 `powerMinKw` 且 `powerMaxKw=null` 仍表示开放上界。

### ADR-031：知识库 MVP 使用开发存储和确定性 embedding 替身

- 状态：Accepted
- 日期：2026-07-29
- 决策：`/dev/knowledge` 和对应 API 只在非 production 环境开放。原文件由
  server-only 本地文件适配器保存；第一版只提取 UTF-8 TXT/Markdown。
  `local-hash-embedding-v1` 生成 128 维开发向量，PostgreSQL 同时写入生成式
  `tsvector`，按固定 0.5/0.5 权重做精确混合排序。
- 理由：用户要求先完成可追溯端到端知识库，但 ADR-017 尚未批准外部 Embedding
  provider，ADR-018 尚未批准生产文档存储与模型处理。确定性替身可在不发送文档
  到外部服务的前提下验证 Migration、filter、得分和 UI。
- 后果：当前向量分不是生产语义质量声明；不得把本地存储用于部署。替换模型或
  维度需要新 Migration 与检索基准。依据 ADR-013，代表性语料存在前不添加
  HNSW/IVFFlat 索引。
- 依赖：新增仅开发依赖 `@electric-sql/pglite-pgvector@0.0.5`，使 PGlite
  集成测试执行与 Supabase PostgreSQL 相同的 `CREATE EXTENSION vector` Migration。
- 验证方式：空库 Migration、全文/向量候选与四类 metadata filter 集成测试，
  Playwright 覆盖成功、重复、失败、下载和混合检索。

### ADR-032：阶段 6 使用可替换 AI provider 的单 Agent 与三个只读工具

- 状态：Accepted
- 日期：2026-07-29
- 决策：Vercel AI SDK Core 默认通过 `AI_MODEL=provider/model` 调用 AI
  Gateway，并允许开发环境改用显式配置的 OpenAI-compatible provider；首版只注册
  `searchKnowledgeBase`、`getCountryProfile` 和
  `findCompatibleProducts`。第一模型步骤强制调用工具，最多 5 个工具步骤。
  若兼容服务商的思考模式不支持强制工具调用，可通过明确的
  `AI_ENABLE_THINKING=false` 请求非思考模式；未配置时不发送该非标准参数。
- 理由：Gateway 保持默认零供应商耦合路径；OpenAI-compatible 适配边界允许验证
  用户指定的开发模型，而不改变工具、证据门或审计语义。三个工具正好复用已有
  知识检索、国家详情和确定性 product-fit 服务，并覆盖本阶段验收。
- 后果：地图国家只是缺省上下文，明确工具国家优先；法规/产品事实不得来自模型
  记忆。若本轮没有任何充分工具证据，流级边界会丢弃模型结论并返回固定的证据
  不足说明。正式模型、区域、预算和故障 SLA 仍受 ADR-017/023 阻塞。
- 依赖：新增 `ai` 用于服务端流、工具循环和 mock model，新增
  `@ai-sdk/react` 用于客户端 UI message transport；新增
  `@ai-sdk/openai-compatible` 用于开发环境的兼容接口。
- 验证方式：Vitest 使用 AI SDK mock model 验证强制工具、无证据和产品适配；
  Playwright 验证桌面/移动聊天面板与地图国家上下文。

### ADR-046：对话采用请求级 BYOK

- 状态：Superseded by ADR-047
- 日期：2026-08-06
- 决策：对话页由用户填写 OpenAI-compatible 的公开 HTTPS 地址、模型名和 API Key；
  配置只存在浏览器内存，并随每次同源 `/api/chat` 请求发送。服务端在请求内创建
  provider，完成流式调用后释放，不使用项目默认模型或服务端模型 Key。
- 理由：用户明确要求移除内置 AI，同时保留现有确定性法规、市场、产品工具和审计链路。
- 安全边界：输入先经 Zod 校验；地址拒绝 localhost、私网、link-local、IPv6 和内嵌
  凭据。Key 不写 localStorage、数据库、日志、错误响应或 `modelId`。
- 后果：刷新页面后需要重新输入配置；对话页必须显示未连接状态，未配置时不发送请求。

### ADR-047：对话采用服务端环境配置

- 状态：Accepted
- 日期：2026-08-06
- 决策：`/api/chat` 只读取服务端 `AI_PROVIDER`、`AI_BASE_URL`、`AI_MODEL`、
  `AI_API_KEY` 和可选 `AI_ENABLE_THINKING`。浏览器不再提交或保存模型配置，
  对话页只显示服务端配置状态。
- 理由：恢复项目内置模型连接，同时保持模型 API Key 不暴露给浏览器，也不把凭据
  提交到 GitHub。
- 安全边界：真实值只允许存在于被 Git 忽略的 `.env.local` 或部署平台 Secret
  Manager；日志、审计记录、错误响应和 `modelId` 不得包含 Key。测试环境默认禁用
  服务端模型配置，避免单元测试调用外部供应商。
- 后果：更换接口或模型需要修改服务端环境并重启应用；若 Key 失效，聊天显示结构化
  服务错误，不允许模型或客户端猜测法规事实。
- 验证方式：环境变量 Zod 校验、聊天请求不接受 `aiConfig` 字段、Playwright
  验证独立对话页无 BYOK 表单且可发送请求。

### ADR-033：AI 审计只保存工具摘要与规范化引用

- 状态：Accepted
- 日期：2026-07-29
- 决策：新增 `ai_chat_sessions`、`ai_tool_calls`、`ai_citations`。记录校验后
  参数、状态、耗时、结果计数/证据状态和来源外键；不保存完整 prompt、模型回答、
  完整工具结果或 chunk 正文。
- 理由：满足工具调用与引用可追溯要求，同时在身份、隐私和保留策略未决定前降低
  日志敏感度与数据复制。
- 后果：当前不能从数据库重放完整对话；用户/租户与保留/删除策略仍受
  ADR-016/023 阻塞。引用删除采用 restrict，session 删除级联清理调用和引用。
- 验证方式：空库 Migration 和 Repository 集成测试验证 session、工具调用与
  document/chunk/regulation/source 引用外键。

### ADR-034：机会评分采用服务端版本化纯函数并排除缺失维度

- 状态：Accepted（Demo/MVP 受限范围）
- 日期：2026-07-29
- 决策：`opportunity-score-v1` 使用市场潜力、产品准备度、法规认证覆盖三个
  维度，默认权重 `0.5/0.3/0.2`。权重由 Zod 校验的服务端环境变量配置，模型
  参数中不提供权重。缺失或 `unknown` 维度为 `null` 并从有效权重中排除，总分
  同时返回数据覆盖率、逐维度贡献和输入事实。
- 理由：0 必须表示有证据的最低相对值或明确失败，不能兼任“没有数据”；纯函数
  可以保证同一事实快照与输入产生相同结果，并允许独立测试和版本追溯。
- 后果：总分可能基于不完整维度，使用者必须同时查看 `dataCoveragePct` 和
  `missingData`。市场 min-max 分只在本次比较组内有效，不是全球绝对排名。
  当前只为虚构 `DEMO_ADDRESSABLE_UNITS` 登记方向；真实指标、方向和批准人仍
  受 ADR-020/021 阻塞。
- 验证方式：纯函数重复输入、贡献分解、缺失重归一化、unknown 排除和 Demo
  数据库纵向测试。
- 2026-08-05 市场可比性收紧：相同 `metricCode` 仍必须具有完全一致的指标
  `definition`；定义不同返回 `DEFINITION_MISMATCH`，不得进入归一化或评分。

### ADR-035：销售简报由确定性服务组装，UI 分离事实与建议

- 状态：Accepted
- 日期：2026-07-29
- 决策：`generateSalesBrief` 返回严格结构 JSON，包含
  `executiveSummary`、`marketScore`、`opportunities`、`risks`、
  `recommendedProducts`、`salesActions`、`missingData`、`sources`。
  产品只推荐 `product-fit-v1=fit`；销售动作带 `kind=rule_generated`。UI 将
  确定性事实、规则建议和模型自然语言解释分区显示。
- 理由：结构化事实和确定性分数不能被 LLM 文案覆盖；规则动作可复现，也能清楚
  告知销售人员哪些内容是建议而不是法规/市场事实。
- 后果：简报文案当前是固定中文模板，不做自由风格生成；模型可以解释工具 JSON，
  但不能修改数值、权重、适配状态或来源。四个新工具继续写入最小化审计表，
  Migration 只扩展 `ai_tool_name` enum。
- 验证方式：销售简报严格字段测试、工具 Zod 输出、审计 enum Migration 和 UI
  分层标签。

### ADR-036：管理后台使用可信上游身份与服务端角色映射

- 状态：Accepted（MVP/内部环境）
- 日期：2026-07-29
- 决策：`/admin` 与 `/api/admin/*` 只接受身份代理注入的
  `oai-authenticated-user-email`；服务端 `ADMIN_ROLE_BINDINGS_JSON` 映射
  `editor | reviewer | admin`。页面隐藏不能替代 API 授权，每个写入路由重新检查
  最低角色。
- 理由：在正式企业身份供应商尚未确定时复用部署平台身份，不建立第二套密码、
  session 或浏览器角色状态，也不增加未经批准的认证依赖。
- 后果：生产反向代理必须删除客户端同名 Header 并在认证后重新注入；不能将
  Next.js 服务直接暴露为信任任意 Header 的公网源站。本 ADR 只部分解除
  ADR-016，租户、SSO provider、会话、离职回收和数据分级仍未决定。
- 验证方式：Vitest 覆盖无身份、未映射、角色阈值；Playwright 覆盖 401/403、
  普通用户管理页 not-found 界面和 admin 后台。

### ADR-037：已发布事实与治理修订分离

- 状态：Accepted
- 日期：2026-07-29
- 决策：结构化编辑保存到版本化 `data_governance_drafts`，按
  `draft -> reviewed -> published` 流转；只有发布事务 upsert 正式事实表。
  reviewer 不能审核自己创建的草稿，非 admin 创建者也不能发布自己的草稿（admin
  紧急流程除外）。文档额外保存治理状态，只有 `ready + published` 才可检索。
- 理由：编辑既不能提前污染正式查询，也不应在进入草稿时让现有发布版本消失。
  独立修订允许审阅完整候选 payload，并在发布失败时保持旧事实不变。
- 后果：结构化基础表代表当前发布快照，不承担完整修订历史；历史由草稿 payload
  与审计 before/after 保存。软归档实体通过 `archived_at` 从正式 Repository
  隐藏。审计当前是应用层追加写，生产防篡改、保留和导出策略仍需批准。
- 验证方式：数据库集成测试验证 draft/reviewed 不可见、published 可见、法规
  变更 before/after 和软归档过滤。
- 2026-08-05 输入边界收紧：法规 `effectiveTo`、产品 `availableTo`、认证
  `validTo` 非空时，Zod 草稿载荷必须同时提供更早的起始日期；错误在 Draft
  入口返回，不再留到数据库 CHECK 或发布事务暴露。
- 同日继续收紧：必填数值只接受 number 或非空数字字符串，`null`、布尔值和数组
  不得经 JavaScript 强制转换成为 0/1；数字字符串必须使用十进制语法，拒绝
  `0x`/`0b`/`0o` 等 JavaScript 进制字面量；来源/辖区 URL 只接受 HTTP(S) 且
  禁止嵌入用户名或密码，避免公开 DTO 与页面链接暴露凭据；国家覆盖状态复用
  canonical 词表并与 `isDemo` 保持一致；文档 FormData 显式拼错的布尔值由 Zod
  拒绝。
- 2026-08-06 发布依赖门补齐：国家、法规及限值、产品、认证、市场指标、辖区及
  成员关系引用的直接来源与父实体（国家、辖区、产品、法规）及父实体直接来源必须
  存在且未归档；校验与事实写入处于同一事务。失败返回 governance conflict，草稿
  保持 reviewed，不能出现“Published 但公开查询因归档依赖而静默不可见”的状态。
- 同一发布门校验分类单向一致性：非 Demo 事实不得引用 Demo 来源，避免 `covered`
  等正式记录在地图或公开 DTO 中被误标为已核验；Demo 事实引用非 Demo 的公共基础
  来源仍允许，并继续按事实自身 `is_demo` 显示。非 Demo 子事实同样不得引用 Demo
  国家、辖区、产品或法规，防止分类在关系链中被截断。来源或父实体后续改标为 Demo
  时也必须没有活跃非 Demo 子事实；同一法规/辖区 payload 内的限值或成员关系遵守
  相同约束，避免先发布子事实后再反向破坏不变量。
- 2026-08-06 状态竞争收紧：CSV 批次确认、草稿审核与发布先锁定对应状态行；同一
  请求被并发重复提交时只有首个事务可转换状态，后到事务按最新状态返回 conflict，
  不重复生成市场草稿、事实写入或审计事件。
- 同日客户端把写操作结果与后续 dashboard 刷新结果分开：动作成功后即使快照读取
  失败，也保留成功通知并明确报告“操作已完成但刷新失败”，不得把已提交事务误报
  为写入失败而诱导用户重复执行。
- 同日管理 API 路径参数收紧：国家归档键按 ISO3 校验并规范化，其余治理实体键以及
  草稿、导入批次、来源和文档路径参数必须为 UUID。所有校验在 service 进入
  Repository 前完成，畸形外部输入统一返回 400，而不是触发数据库类型错误后返回 500。
- 同日版本顺序收紧：同一实体创建修订和发布时锁定其版本集合，较新版本已经发布后，
  旧 `reviewed` 草稿不得再覆盖正式事实；首个版本并发创建造成的唯一键竞争映射为可
  重试的治理 conflict。这样 `version` 保持单调审计语义，而不是仅作为展示编号。
- 归档和来源核验也锁定对应事实行并在写入条件中重复检查 `archived_at IS NULL`；并发
  重复归档只允许一次审计。文档审核/发布锁定未归档文档，避免已归档但仍为 `ready`
  的文件被标成 published。辖区归档审计还会保存全部活跃成员关系快照与实际归档
  复合键，隐式级联不再只留下父实体记录。
- 文档表自身的治理状态采用条件迁移：只有 `ready + draft` 可审核，只有
  `ready + reviewed` 可发布；重复/旧草稿不能把 published 文档降回 reviewed。文档
  发布也执行直接来源可用性与 Demo 分类门，避免状态显示 published 但检索因来源归档
  而隐藏。重新处理同样采用条件迁移，只允许 `draft + ready/failed`；开始时锁定文档，
  同一事务为新 metadata 创建来源修订、重关联文档并切换为 processing；不原地改写
  可能被其他事实共享的旧来源。这样避免审核后无复核改内容、并发重复处理或
  document/source/chunk 分类分裂，审计记录保留 metadata before/after 与新来源 ID。
- 分类反向门把已发布非 Demo 文档纳入来源依赖，来源不能在事后改标 Demo。检索结果
  的 `isDemo` 取 document、chunk、source 三者逻辑 OR，Demo 文档借用公开来源时仍
  保持 Demo 标识。
- 国家画像 AI 工具把辖区实体和成员关系来源与国家、法规、市场来源一并生成 citation；
  Demo 告警和最近核验时间基于完整 citation 集合，避免非 Demo 国家基础记录掩盖 Demo
  子证据。

### ADR-038：市场 CSV 使用持久化预览与原子确认

- 状态：Accepted
- 日期：2026-07-29
- 决策：CSV 必须先以固定 Header 解析，对每一行执行 Zod 和跨字段校验，并持久化
  preview batch；确认无错误批次时在单一事务中创建全部市场指标草稿。任一错误使
  批次整体 `rejected`，不创建部分草稿或市场事实。
- 理由：把“看到了什么、为何失败、用户确认了什么”变成可审计状态，并消除逐行
  导入造成的部分写入。
- 后果：确认批次仍不会直接发布；每条草稿需要审核和发布。首版只支持固定 CSV
  模板、2 MB 上限和数值市场指标，不做自动列映射或单位/币种换算。
- 验证方式：解析单元测试与数据库事务测试覆盖引号、字段错误、日期边界、错误
  批次零写入和有效批次只创建未发布草稿。
- 2026-08-05 输入边界收紧：`is_demo` 只接受显式 `true`/`false`，空或拼错值
  不得静默变成 `false`；空 `value_numeric` 不得经数值强制转换变成 0。两类错误
  以及只有表头的空批次均在 Preview 返回错误，防止缺失证据进入真实比较或评分。
- 同日 CSV 语法继续 fail closed：未闭合引号、未加引号字段中的引号、闭合引号后的
  非分隔字符均返回结构化行错误；同一批次中与数据库观测自然键一致的重复行也使
  整批不可确认，避免畸形输入升级为 500 或生成冲突草稿。
- 2026-08-06 CSV 错误定位保留每条记录在原文件中的物理起始行；空行与引号内换行
  不再让后续校验、重复观测提示指向压缩后的错误行号。
- 同日上传入口改用 fatal UTF-8 解码；非法字节在创建预览批次和内容哈希前返回
  `INVALID_INPUT`，不得由运行时以 `U+FFFD` 替换后继续进入治理流程。CSV 语法层
  同时按物理行拒绝 NUL，避免通过字符串 schema 后在 JSONB Preview 持久化时失败；
  引号外的孤立回车也失败关闭，不能静默删除后拼接两侧文本。
- 文件 2 MB 契约按上传 `File.size` 的 2,000,000 字节执行并返回 413；2,000,000
  字符的 Zod 上限继续作为解码后纵深约束，不能用多字节 UTF-8 混淆字节与字符限制。
- Migration `0007_market_metric_scope_uniqueness` 将原单一唯一索引拆为 scoped/global
  两个部分唯一索引，使 `application_scope=NULL` 的全场景观测也受数据库自然键
  唯一性约束；实现不依赖 PostgreSQL 15 的 `NULLS NOT DISTINCT`。
- 2026-08-06 已存在的自然键不由 CSV 新行自动替换。发布新 ID 的冲突草稿返回明确
  `CONFLICT`，并指向既有实体执行修订或解归档；唯一索引竞争也映射为同类治理冲突，
  不向管理端暴露 PostgreSQL 错误。所有草稿创建与发布同时校验 `entity_key` 和 payload
  主身份一致，防止审计版本归属于一个实体而事实写入另一个实体。

### ADR-039：application scope 增加 on-road-truck 与 on-road-bus 规范标识

- 状态：Accepted
- 日期：2026-07-30
- 决策：按 DATA_MODEL.md §2.2 的既定设计，`application_scope` 枚举在
  `on-road, non-road, marine, generator-set, agriculture, construction` 之后
  追加 `on-road-truck`（卡车动力）与 `on-road-bus`（客车动力）。ADR-015 确认的
  四类业务动力场景与规范标识映射为：卡车动力 → `on-road-truck`、客车动力 →
  `on-road-bus`、工程机械动力 → `construction`、农业装备动力 → `agriculture`。
  `on-road`/`non-road`/`marine`/`generator-set` 保留为法规体系父级或旧数据
  兼容值；新产品、认证和筛选器不得用通用 `on-road` 代替已明确的卡车/客车场景。
- 理由：ADR-015 已解除场景 schema 阻塞；卡车和客车是作品的重点动力场景，必须
  与工程机械、农业装备一样成为一等 scope，才能承载后续真实法规、认证和市场
  fixture。
- 后果：schema 变化只允许通过新 Drizzle migration `ALTER TYPE ... ADD VALUE`
  追加，不重命名或删除既有值；Zod 枚举、UI 标签和检索过滤随 canonical 数组
  同步。真实卡车/客车法规、限值和认证 fixture 仍受 ADR-015 阻塞，本决策不引入
  任何真实事实。
- 验证方式：migration 在空库 PGlite 上应用后，枚举接受 `on-road-truck`/
  `on-road-bus` 插入并可读回；既有 `non-road` 查询与 product-fit 测试不回归。

### ADR-040：全球国家基础目录与覆盖状态词表

- 状态：Accepted
- 日期：2026-07-30
- 决策：`countries` 表按 ADR-027 固定的 174 个地图 ISO3 全量入库，形成全球基础
  目录（ADR-015 C 层）。目录行只含名称、区域/次区域和覆盖状态，不含法规、市场
  或产品事实。`data_coverage_status` 首版词表固定为：`none`（未设置，列默认）、
  `demo`（虚构 fixture，ADR-026）、`planned`（ADR-015 分层覆盖目标，等待真实
  数据）、`no_data`（目录内明确不覆盖）。国家详情 API 只对 `demo`（以及未来
  引入真实数据后的覆盖状态）返回 `available`，其余状态保持 ADR-029 的精确
  `no_data` 契约。
- 理由：地图不得出现空白国家，且无事实时必须明确拒绝推断；目录数据（ISO 名称、
  ISO2、区域）来自公共领域 Natural Earth 目录源，与虚构 fixture 性质不同，
  不应标记为 `is_demo`，但也不得被当作法规或市场事实使用。
- 后果：目录来源使用独立 `data_sources` 记录（公共领域署名，`is_demo = false`），
  确定性 seed 可重复运行；`planned` 的 25 个分层国家为 CHN、USA、DEU、IND、
  BRA、JPN、KOR、MEX、TUR、AUS、CAN、GBR、FRA、ITA、ESP、POL、RUS、IDN、
  THA、VNM、MYS、SAU、ARE、ZAF、ARG，其中 CHN/BRA/DEU 当前为 `demo` fixture。
  真实摘要或深度数据发布时，覆盖状态迁移规则随 M3/M4 任务另行决策；DATA_MODEL
  提到的 `partial/verified` 留待真实数据阶段引入。
- 验证方式：集成测试验证 174 行目录、词表分布、重复 seed 幂等，以及 `planned`/
  `no_data` 国家在详情 API 返回 `no_data`；地图与快捷入口只把详情可见国家展示
  为“有数据”。
- 2026-08-08 增补：ADR-067 发布 SGP 法规所需的目录与地图要素已加入，当前目录
  为 175 行；SGP 初始 `planned`，经同一治理发布流程迁移为 `covered`。

### ADR-041：AI 路由速率限制与错误脱敏基线

- 状态：Accepted
- 日期：2026-07-30
- 决策：`POST /api/chat` 按客户端标识（`x-forwarded-for` 首段，无则共享桶）
  执行固定窗口速率限制，默认 30 次/小时，经 `AI_CHAT_RATE_LIMIT_PER_HOUR`
  配置（1–10000）；超限返回 429、`Retry-After` 与 schema 校验的通用错误
  `RATE_LIMITED`。公开 API 错误响应只允许 schema 校验的
  `{error:{code,message}}` 通用消息，异常细节只进服务端日志；AI 流式响应
  的 `onError` 使用固定文案，不暴露 provider、模型或内部错误。
- 理由：AI 路由是成本最高、最易被滥用的公开入口；M2 发布安全基线要求请求
  限制与错误脱敏，且未授权请求与日志不得泄露敏感信息。
- 后果：计数为进程内固定窗口，多实例部署时按实例独立（有效上限 × 实例数），
  共享计数留给生产基础设施决策；限流是滥用缓解而非访问控制，无代理直连时
  客户端可伪造 `x-forwarded-for`，公开部署必须位于可信代理之后（ADR-016/036）。
  配额在请求入口消耗（先于解析、配置与审计），无论请求是否成功，以保护后续
  数据库写入与模型调用；配置故障期间激进重试的客户端可能被限流至窗口结束，
  处置为临时调高限额或等待滚动。AI SDK 的 `TypeValidationError`/
  `InvalidArgumentError`/`MessageConversionError` 与 Zod/语法错误同归
  `INVALID_INPUT` 400，配置错误返回不含变量名的通用 503 文案。
- 验证方式：限流器单元测试覆盖阈值边界、窗口滚动、键隔离与 `Retry-After`
  计算；既有 AI mock model 测试与 e2e 在默认阈值下不回归。
- 2026-08-06 安全异常类型提取不再信任 `Error.name`，只接受白名单校验的构造类型；
  对象原型、构造器访问或 Proxy trap 自身抛错时统一回退 `UNKNOWN_ERROR`，保证日志
  最小化辅助函数不会让原 Route Handler 的固定错误响应再次逃逸。
- 同日客户端错误边界把 JSON `SyntaxError` 与 Zod 响应校验错误统一视为不可信解析
  细节；国家、产品和管理界面使用固定回退，只有结构化错误信封或应用已生成的普通
  错误文案可见，避免 200 HTML/畸形上游响应片段进入页面。

### ADR-042：覆盖状态引入 covered 与治理发布迁移路径

- 状态：Accepted
- 日期：2026-07-30
- 决策：`data_coverage_status` 词表增加 `covered`：国家拥有经签核
  （`docs/ACCEPTANCE.md`）的真实事实并通过后台 Draft → Reviewed →
  Published 流程发布后，由 country 治理草稿把状态从 `planned` 迁移到
  `covered`。`covered` 与 `demo` 同为详情可见状态（`hasDetailedCountryCoverage`），
  但 UI 按 `is_demo` 区分“Demo 数据”与“已核验数据”文案。
- 理由：ADR-040 预留了真实数据接入时的状态扩展；`covered` 把“目录里计划
  覆盖”与“已有签核事实可查”显式分开，地图与详情无需依赖记录计数判断。
- 后果：不含已核验限值数字的法规（DEU/BRA 待读回、提案文书）不进入治理
  发布（`regulationDraftPayloadSchema.limits` 至少一条）；jurisdiction 尚无
  治理实体类型，M3 首批以受审计的直插补齐辖区引用（缺口登记于 TASKS，
  治理支持作为后续任务）。`demo` 与 `covered` 可以共存于不同国家；同一
  国家从 `demo` 迁到真实数据时应改为 `covered` 并替换 Demo fixture。
- Migration 0009 将覆盖词表和分类对齐下沉到数据库 CHECK：只允许
  `none/demo/planned/no_data/covered`，且 `is_demo` 当且仅当状态为 `demo`，
  避免绕过治理 Zod schema 的直接写入让地图可见性与来源分类互相矛盾。
- 2026-08-06 覆盖扩展：欧盟官方成员国页面确认 27 个成员国及加入日期后，
  通过 EU regional jurisdiction 的有效期成员关系复用已签核的 Euro VI / Stage V
  法规；当前地图目录可寻址的 26 国可以迁移为 `covered`。MLT 不在 Natural
  Earth 1:110m 的 174 国目录中，先登记来源但不创建悬空外键；GBR、TUR 与 EEA
  国家不在该成员集合中，不得仅因采用或对齐欧盟规则而自动继承。这里的 EU-26/
  MLT 排除是当时的历史边界，已由 ADR-135 的目录、1:10m 几何和成员关系补齐
  supersede；GBR、TUR 与 EEA 排除仍有效。
- 验证方式：服务级测试验证治理发布 `covered` 国家草稿后详情返回
  `available`；`planned`/`no_data` 保持精确 no_data 契约的测试不回归；空库
  Migration 测试拒绝未知覆盖状态和两个方向的 Demo 分类错配。

### ADR-043：jurisdiction 纳入治理实体

- 状态：Accepted
- 日期：2026-07-30
- 决策：`governed_entity_type` 增加 `jurisdiction`（Migration 0006），
  辖区与其国家成员关系（country_jurisdictions）通过后台 Draft →
  Reviewed → Published 流程维护；草稿 payload 含辖区字段与
  `memberships` 数组。发布语义：辖区按 id upsert；成员关系按复合主键
  （country_iso3, jurisdiction_id）upsert，payload 中不存在的活跃成员
  归档移除；before/after 审计快照保留历史。
- 理由：此前入库脚本只能直插辖区（治理缺口）；真实辖区数据同样需要
  审阅门与审计链，与法规/国家一致。
- 后果：成员关系不能沿用 regulation 限值的“全部归档 + 新行插入”替换
  语义（复合主键会冲突），改用“缺失成员归档 + payload upsert”；归档行
  物理保留，重发布幂等。管理面板草稿表单与归档工具同步支持该实体类型。
- 2026-08-06 输入语义收紧：`memberships` 是发布快照而非可省略补丁，因此草稿
  必须显式提供数组，同一国家只能出现一次。省略不再被解释为空快照并意外归档
  全部成员；重复复合键也不会留到 PostgreSQL 在发布时失败。`country` 类型辖区
  必须且只能包含与 `countryIso3` 相同的一条成员关系；`regional` / `international`
  不得设置单一国家字段，避免辖区身份与法规适用成员快照互相矛盾。
- Migration 0008 将同一身份约束下沉到数据库 CHECK：`country` 必须设置
  `country_iso3`，`regional` / `international` 必须保持 NULL，防止绕过治理
  Zod schema 的直接写入制造矛盾记录。
- 验证方式：集成测试覆盖发布后成员可查、重发布活跃成员保持一条；
  入库脚本在目标库全治理路径运行且验收查询 9/9 通过；空库 Migration 测试覆盖
  辖区类型与 `country_iso3` 的合法组合及两个非法方向。

### ADR-044：国家详情筛选查询参数与服务端规范化

- 状态：Accepted
- 日期：2026-08-03
- 决策：`/countries/[iso3]` 支持筛选查询参数 `applicationScope`、
  `powerKw`、`asOf`、`productModelCode`（与 product-fit 请求体同名同构）。
  服务端逐字段 Zod 校验（ADR-010）：无效参数剔除后重定向到规范化
  URL（而非整页 notFound——坏的筛选值不让有效国家 404）；规范化输出
  与原始输入不同时同样重定向（如 `powerKw=300.0 → 300`、型号大写化）。
  产品适配面板从 URL 初始化，评估成功后把筛选写回 URL（`router.replace`）；
  携带完整筛选（含产品型号）的分享链接在产品列表就绪后自动复现评估。
  面板以国家 ISO3 为 key，切换国家时完整重置（修复旧评估结果与日期
  跨国家残留的缺陷）。
- 理由：ADR-010 要求“分享 URL 可复现筛选”；筛选属于页面状态而非
  服务端权威数据，放在查询字符串而非 API。
- 后果：未知查询键被忽略（非 strict，兼容分析参数）；asOf 同时传给
  国家详情 API（法规列表与评估日期一致）；`/api/countries/[iso3]` 对
  无效 asOf 返回 `INVALID_AS_OF`（此前误标为 INVALID_ISO3）。
- 验证方式：Playwright 覆盖分享链接自动复现评估、刷新可复现、无效参数
  剔除与数值规范化重定向。
- 2026-08-05 同一国家内筛选写回后，Drawer 以 `ISO3 + asOf` 重新请求国家详情；
  Playwright 验证评估日期、URL 与“详情截止日期”同步更新。
- 2026-08-06 默认日期首次写入 URL 时，若已加载详情的 `response.asOf` 与显式
  `asOf` 相同，Drawer 复用现有响应而不重复请求或卸载产品面板；避免 URL 同义
  规范化期间把用户刚切换的产品恢复成旧型号。
- 同日客户端筛选写回改为克隆现有查询串并只更新四个权威筛选键；服务端保留的
  `utm_*` 等未知分析参数在自动评估、手动评估和刷新后继续存在，不因
  `router.replace` 被静默删除。重复的已知筛选参数折叠为首个规范值，避免地址栏
  同时表达多个权威输入；未知多值参数按原顺序完整保留。

### ADR-045：核验新鲜度阈值与 stale 告警

- 状态：Accepted
- 日期：2026-08-03
- 决策：新增服务端环境变量 `COUNTRY_STALE_AFTER_DAYS`（正整数，上限
  3650，默认 90）。国家列表与详情响应增加 `isStale` 布尔字段，由服务
  层纯函数 `isStaleVerification(verifiedAt, now, thresholdDays)` 计算
  （恰好 N 天为新鲜，超过为 stale）。UI 在详情“详情核验时间”卡片显示
  告警徽标（data-testid=country-stale-badge），地图 tooltip 核验日期附
  “（可能过期）”。stale 仅为告警，不隐藏数据、不改变 API 状态。
- 理由：TASKS §5“已知限制和 stale 数据在 UI 可见”；SOURCES §4 的按
  来源分级 SLA 仍为 DRAFT，单一全局阈值是签核前的可逆实现（90 天取
  各来源提案的中间档）。
- 后果：按来源分级的正式 SLA 仍待 ADR-019 签核后替换全局阈值；e2e
  以阈值 1 天确定性覆盖告警（Demo fixture 核验于 2026-01-15）。地图与
  详情采用不同基准时间（国家 `verified_at` 与详情 `lastVerifiedAt` =
  各来源最大值），边界情形两侧判定可能不一致；地图 tooltip 仅对详情
  可见国家（demo/covered）显示“可能过期”，无数据国家不显示。
- 验证方式：纯函数边界测试（恰好阈值=新鲜、阈值+1ms=stale）；服务级
  env 阈值切换测试；Playwright 告警徽标断言。

### ADR-046：日本道路 GVW 分期与非道路功率边界入库语义

- 状态：Accepted
- 日期：2026-08-06
- 决策：JPN 道路重型柴油车平成28年（2016年）标准在官方资料中按 GVW/车型
  分期适用；当前法规查询只有 `application_scope`、功率和日期，没有 GVW。
  本批为避免把尚未适用的轻型重型车提前判为合规，统一使用全部
  `GVW>3.5 t` 车辆均已覆盖的 2018-10-01 作为 `effective_from`，法规摘要必须
  同时披露 2016-10 起分期实施，且该日期不得描述为首次实施日。环境省表格同时
  给出最大值与括号内平均值，本批只将明确标注的平均值作为结构化限值，并保留
  WHSC/WHTC 两个测试循环。非道路 2014 年基准严格按现行三省告示的
  `19 kW以上560 kW未満` 建模为 `[19,560)`，五个功率带分别保存实际适用日期。
- 理由：使用最早道路日期会让 2016–2018 历史查询对部分 GVW 车辆产生假阳性；
  使用全面适用日对当前覆盖准确且保守。非道路告示的上下界与分期日期足以在
  现有功率模型中精确表达，不需要新增 schema 或把 560 kW 错纳入范围。
- 后果：JPN 当前查询用于 2018-10-01 之后的重型车事实；早期历史查询可能对
  已先行适用的 >7.5 t 非牵引车辆返回空，UI/AI 必须保留摘要警告。未来增加 GVW
  字段时应拆分道路限值有效期，不迁移或重写已发布源文书。P<19 或 P≥560 的日本
  非道路查询明确为空，不用相邻国家或欧盟/美国标准补齐。
- 验证方式：验收测试覆盖卡车/客车 WHSC/WHTC 平均限值、工程/农业五个功率带、
  19 kW 含端点和 560 kW 排除端点；治理发布后以 JPN API 读回四个 scope。

### ADR-047：韩国附表 17 的道路与非道路限值分期

- 状态：Accepted
- 日期：2026-08-06
- 决策：KOR 以韩国国家法令信息中心现行《대기환경보전법 시행규칙》第 62 条及
  附表 17 为唯一结构化法规来源。道路大/超大型柴油客货车使用 2017-10-01
  起适用的 WHSC/WHTC 限值；工程机械使用 2020-12-01 起的第 4 号标准；农业机械
  使用 2021-07-01 起的第 5 号标准。非道路功率带按原文端点转换为
  `[0,8)`、`[8,19)`、`[19,37)`、`[37,56)`、`[56,130)`、`[130,560)`，因此
  19、37、56、130 kW 分别进入下一带，560 kW 不命中。NH3 10 ppm 仅在采用
  尿素喷射减排装置时适用，必须保留在限值说明中，不得作为无条件的所有发动机限值。
- 理由：附表 17 同时覆盖道路、工程和农业场景，但生效日、测试循环和功率分段
  不同；显式拆分法规和 scope 可避免把非道路标准提前套用到其他场景，也能在当前
  功率模型中精确表达边界。条件性 NH3 不能静默转换为普遍适用的污染物限值。
- 后果：KOR 的道路、工程和农业记录分别以独立法规发布，默认 effective 查询按
  生效日和 `[min,max)` 过滤；缺少尿素装置适用条件时，展示层必须保留警示，不能把
  NH3 数值解释为无条件要求。未来若需区分发动机类型或排放控制装置，应新增字段
  和迁移，不重写本批已发布限值。
- 验证方式：测试覆盖道路 WHSC/WHTC NOx、150 kW 非道路限值、19/37/56/130
  kW 分界和 560 kW 排除；治理脚本发布后读回 KOR jurisdiction、三项法规状态
  `effective` 以及四个 scope 的 API 响应。

### ADR-048：墨西哥 NOM-044 替代认证路径与非道路 no-data

- 状态：Accepted
- 日期：2026-08-06
- 决策：MEX 以 DOF 官方 NOM-044-SEMARNAT-2017 原始公告及 2020/2021 修订公告
  为结构化道路重型柴油法规来源。标准适用于新柴油发动机及 GVW > 3,857 kg 新道路
  车辆；Tabla 1B（CT/CSE，美国路径）与 Tabla 2B（CEEMAP/CETMAP，欧洲/UN-ECE
  路径）建模为两项并行可查询的替代认证路径，限值通过 `testCycleCode` 与
  `measurementBasis` 保留路径语义。2021 修订把 AA 过渡期延至 2024-12-31，当前
  B 标准统一以 2025-01-01 作为可执行日期。工程机械与农业机械没有本批已核验的
  独立墨西哥官方标准，两个 scope 明确返回 no-data。
- 理由：把替代认证路径误合并会造成重复或过严的合规结论；道路标准套用到非道路
  会制造未经来源支持的事实。现有查询模型没有 GVW 或认证路径字段，因此保留
  GVW 条件和路径说明，避免扩展 schema 或静默推断。
- 后果：MEX 卡车与客车在 2025-01-01 后可查询两张官方表的结构化限值；展示层必须
  把表 1B/2B 标为替代路径，并显示超低硫柴油、NH3/SCR 条件。2024-12-31 及之前
  不返回 B 标准；非道路 scope 不以邻国法规补齐。未来若要表达“二选一”认证关系，
  应新增显式 certification-path 字段或关联表，不重写本批事实。
- 验证方式：测试覆盖卡车/客车一致性、CT/CSE/CEEMAP/CETMAP 循环、NOx 0.20/0.40/
  0.46、2025-01-01 生效边界和 construction/agriculture 空结果；治理发布后读回
  `MX-SEMARNAT`、两项法规 `effective` 状态和 MEX API 覆盖状态。

### ADR-049：土耳其 Euro VI/NRE Stage V 与农业拖拉机 no-data

- 状态：Accepted
- 日期：2026-08-06
- 决策：TUR 使用土耳其 Resmî Gazete 2013-09-25 Euro VI 公报附件 I 建模道路重型
  柴油车 WHSC/WHTC 限值，按官方法规链的 2016-01-01 执行日生效；使用 2020-09-11
  `2016/1628/AB` 非道路公报正文与附件建模 NRE Stage V，按型式批准 2021-10-01、
  市场投放 2022-10-01 生效。NRE 仅绑定 `construction` scope。
- 理由：NRE 公报第 2 条第 2(b) 款明确排除 `AB/167/2013` 定义的农林拖拉机发动机；
  土耳其农业与林业部官方页面只能确认农业拖拉机的类型批准入口，尚未确认可发布的
  独立农业排放限值。把 NRE 或欧盟文本套到 `agriculture` 会制造未经官方来源支持的事实。
- 后果：TUR 卡车与客车查询返回同一 Euro VI 道路法规；工程机械查询返回 Stage V
  功率带；农业查询显式 no-data。官方表的 `P > 560` 严格边界在当前三位小数功率
  字段中以 `560.001` 存储，展示层保留原始严格边界说明；不新增 schema。
- 验证方式：测试覆盖道路 WHSC/WHTC、NRE 150 kW、0/8/19/37/56/130/560 边界、
  P=600 高功率带和农业空结果；治理发布后读回 `TR-MOIT`、两项法规状态 `effective`
  及 TUR API 的四个 scope 响应。

### ADR-050：澳大利亚 ADR 80/03 → ADR 80/04 与非道路 no-data

- 状态：Accepted
- 日期：2026-08-06
- 决策：AUS 道路重型车辆使用联邦 ADR 80/03（Euro V）与 ADR 80/04（Euro VI 等效）
  官方来源建模。ADR 80/03 以官方柴油重型车辆标准汇总表的 ESC/ETC 限值和
  2010-01-01 实施起点记录，按当前查询模型在 2024-11-01 新车型切换日结束；
  ADR 80/04 自 2024-11-01 起记录官方问答直接列出的 WHSC/WHTC NOx/PM 限值。
  DCCEEW 官方评估明确非道路柴油发动机（含拖拉机、挖掘机、压路机、发电机等）
  目前没有澳大利亚联邦排放法规，因此 `construction` 和 `agriculture` 保持 no-data。
- 理由：ADR 80/04 的新车型（2024-11-01）与全部车辆（2025-11-01）是两个不同的
  适用节点，而当前 schema 没有车辆类别、车型代际或既有车型继续供应字段；采用
  新车型节点作为唯一可查询边界，并在摘要/文档中保留全部车辆节点警告。ADR 80/04
  未直接列出的污染物不从欧盟或美国引用规则推断，避免把等效路径当作澳大利亚独立
  读回事实。非道路评估仍处于政策研究/影响分析阶段，不能把建议的 Tier 4f 情景
  标记为 effective。
- 后果：AUS 卡车与客车在 2024-11-01 前后返回确定性、互斥的 ADR 80/03 或 ADR 80/04；
  2026-08-06 的工程机械和农业查询均返回显式 no-data。未来若联邦正式发布非道路
  排放标准，新增已核验来源和法规，不修改本批历史记录。
- 验证方式：测试覆盖卡车/客车 2024-10-31 与 2024-11-01 日期边界、ADR 80/04
  WHSC/WHTC NOx 400/460 mg/kWh、PM 10 mg/kWh 以及 construction/agriculture
  空结果；治理发布后读回 `AU-DITRDCSA`、两项法规状态 `effective` 与 AUS API 四个
  scope 响应。

### ADR-051：英国 GB NRMM Stage V 与道路/农业 no-data 边界

- 状态：Accepted
- 日期：2026-08-07
- 决策：GBR 建立独立 `GB-VCA` country jurisdiction 和 `2023-01-01` 起的 GB
  membership。construction 使用 VCA/GOV.UK 明确的 NRMM Stage V 框架及同日起的
  provisional GB type approval；道路与农业均保持 no-data。GBR 不通过 EU membership
  复用法规或限值。
- 理由：英国已退出欧盟；VCA 页面区分 GB、Northern Ireland、EU 与 UK(NI) approval，
  且 NRMM 页面明确排除农业/拖拉机发动机。道路页面只确认 retained `2018/858` 框架，
  未直接给出 retained `595/2009` 的正式条文、执行日或限值；农业页面也未提供本批可
  直接发布的农业发动机限值。
- 后果：GBR construction 150 kW 返回 Stage V；道路和 agriculture 均返回显式 no-data，
  Northern Ireland 不被本条目覆盖。2026-02-01 full type approval 实施横幅只作为流程
  信息，不作为排放限值生效日期。
- 验证方式：测试覆盖 `GB-VCA` jurisdiction、construction 150 kW 五项 Stage V 限值及
  其余三个 scope 的空结果；治理发布后读回 `GB-VCA`、一项 `effective` 法规与 GBR API
  四个 scope 响应。

### ADR-052：印度 BS VI、CEV/TREM 分期与 2026 草案隔离

- 状态：Accepted
- 日期：2026-08-07
- 决策：IND 建立 `IN-MORTH` country jurisdiction。道路使用 G.S.R. 889(E) 的
  BS VI WHSC/WHTC；construction 分别建模 2021-04-01 起 CEV-IV 与 2024-04-01
  起 CEV-V；agriculture 分别建模经 G.S.R. 850(E) 延至 2023-01-01 的 TREM-IV，
  以及经 G.S.R. 141(E) 延至 2026-04-01 的 TREM-V。Draft G.S.R. 151(E) 只存
  `proposedOn`，不设置有效期或限值。
- 理由：MoRTH G.S.R. 598(E) 在 Rule 115A 内分别给出 TREM 与 CEV 的 Stage IV/V
  表格；技术限值相同不代表 scope 或实施日相同。850(E) 只修改 TREM-IV，2026
  151(E) 明确仍是征求意见稿，不能提前覆盖现行 TREM-V。
- 后果：IND 四个 scope 均有确定性结果和历史切换；Stage IV 仅覆盖 `[37,560)`，
  Stage V 覆盖全部功率带，P=560 进入 `P≥560` 行。G.S.R. 141(E) 原始公报直链
  尚待补齐，来源状态保留“官方说明间接核验”。
- 验证方式：测试覆盖 BS VI `2020-04-01`、CEV `2024-04-01`、TREM
  `2023-01-01`/`2026-04-01` 日期边界，15/45/559.999/560 kW 功率边界，以及
  G.S.R. 151(E) 始终不作为 effective 返回。

### ADR-053：俄罗斯 EAEU 道路与农业法规分域建模

- 状态：Accepted
- 日期：2026-08-07
- 决策：RUS 建立 `RU-EAEU` country jurisdiction。道路采用 TR CU 018/2011
  生态等级 5、UN R49-05 B2/C 限值；由于查询模型没有新车型/既有车型维度，统一
  从全部既有车型完成切换的 2019-01-01 返回。农业采用 TR CU 031/2012 经 EEC
  Council Decision 127/2021、32/2024 修订后的 Class 3A，J/K 功率等级从
  2025-01-01、H/I 从 2025-10-01 返回。construction 保持 no-data。
- 理由：TR CU 018/2011 与 TR CU 031/2012 的对象、测试体系和适用日期不同；农业
  拖拉机表不能推定为一般工程机械要求。俄罗斯第 855 号政府令属于特殊国内程序，
  且其中第 8–19 条及附件 1 排放技术要求已于 2025-06-30 失效，不应覆盖 2026 年
  普通车型的 EAEU 基线。
- 后果：道路卡车/客车返回相同的 11 项 ESC/ELR、ETC 代表性限值；农业严格保留
  `P>19`、`P≤560` 端点及两组生效日。数据库三位小数限制下，开端点以 19.001、
  闭上端点以 560.001 的半开区间表达，文档必须保留这一量化近似。
- 验证方式：测试覆盖道路 2018-12-31/2019-01-01 日期边界、农业 2025-01-01/
  2025-10-01 切换、19/19.001/37/75/130/560/560.001 kW 功率边界，以及
  construction 150 kW 的显式空结果；治理脚本发布后读回道路、农业与 no-data。

### ADR-054：印度尼西亚 P.20/2017 道路 Euro 4 与非道路缺口隔离

- 状态：Accepted with verification note
- 日期：2026-08-07
- 决策：IDN 建立 `ID-KLHK` country jurisdiction。道路卡车/客车使用 KLHK
  P.20/MENLHK/SETJEN/KUM.1/3/2017 的 Euro 4 重型柴油 ESC/ETC 限值；本模型按
  2022-04-01 柴油道路车辆全国执行节点设置 `effective_from`。construction 与
  agriculture 保持 no-data。
- 理由：P.20/2017 的对象是新型 M、N、O 类道路机动车，不能从道路条文推导移动
  工程机械或农业拖拉机的独立非道路排放限值。当前官方 JDIH 页面自动抓取受限，
  因而不把执行日期表述为 P.20/2017 原始发布日，而明确写成当前模型的保守实施节点。
- 后果：卡车和客车各返回 ESC/ETC 8 条结构化限值；2022-03-31 查询为空，
  2022-04-01 起可查。非道路空结果是证据不足的显式状态，不得由模型补值。
- 验证方式：测试覆盖道路日期边界、循环/污染物代表值、卡车/客车同结果以及
  2026-08-07 工程机械/农业 150 kW no-data；治理脚本读回道路 8 条与两个空 scope。

### ADR-055：泰国来源入口登记与限值缺口保持 no-data

- 状态：Superseded by ADR-122
- 日期：2026-08-07
- 决策：THA 建立 `TH-PCD` country jurisdiction，登记泰国 PCD 与 TISI 官方入口，
  但不创建 effective regulation 或限值。卡车、客车、工程机械、农业装备四个
  scope 在 2026-08-07 均返回显式 no-data。
- 理由：当前可达官方入口只足以确认机构和标准目录边界，未取得能直接读回的泰国
  重型柴油排放表。新闻或搜索摘要不能替代公报/标准正文，邻国 Euro/Stage 数值也
  不能作为泰国事实。
- 后果：THA 可作为有来源入口的 covered 国家展示，但法规卡明确显示证据不足；
  一旦取得官方表格，再补充 regulation、limits、effective date 和边界测试。
- 验证方式：测试和治理脚本覆盖四个 scope 的空结果与 THA country membership；
  来源清单记录 PCD/TISI URL、核验时间和后续 14 天事件驱动复核责任。

### ADR-056：越南 QCVN 109 Level 5 道路限值与非道路排除

- 状态：Accepted
- 日期：2026-08-07
- 决策：VNM 建立 `VN-MOT` country jurisdiction。Decision 49/2011/QD-TTg
  与 Circular 06/2021/TT-BGTVT 共同确定 2022-01-01 边界；卡车和客车使用
  QCVN 109:2021/BGTVT 表 4/5 的 Level 5 重型压燃发动机 ESC、ELR、ETC 限值。
  construction 与 agriculture 保持 no-data。
- 理由：政府门户 Decision 49 第 4 条明确新生产、组装和进口汽车的 Level 5
  路线图，Circular 06 第 2 条与门户元数据确认同日生效。QCVN 表 4/5 可直接
  读回数值，同时 Part I clause 1 明确排除为非道路地形设计制造的车辆。
- 后果：道路卡车/客车各返回 ESC 4 项、ETC 4 项和 ELR 烟度 1 项。ETC 表中
  CH4 脚注明确仅适用于天然气发动机，不进入柴油结果。当前 schema 不表达“新生产、
  组装和进口”车型维度，因此摘要和来源卡必须保留范围警告。
- 验证方式：测试覆盖 2021-12-31/2022-01-01 日期边界、卡车/客车 9 条同结果、
  ESC/ETC NOx 与 PM、ELR 烟度、CH4 排除，以及两个非道路 scope 的显式空结果；
  治理脚本执行同组读回检查。

### ADR-057：马来西亚道路 Euro II 基线与 Euro IV tentative 隔离

- 状态：Accepted with open transition gap
- 日期：2026-08-07
- 决策：MYS 建立 `MY-DOE` country jurisdiction。道路卡车和客车采用 DOE
  现行 VTA 指南明确的 2017-01-01 Euro II 重型柴油 UN R49-02(B) 13-mode
  限值；不创建 Euro IV effective regulation。construction 与 agriculture
  保持 no-data。
- 理由：P.U.(A) 429/96 regulation 3–6 建立新道路柴油车辆/发动机系统的法定
  适用范围并允许等效或更严格标准；现行 VTA 门户公开指南将 Euro II 日期写为
  current implementation，并直接给出 Table 7 限值。Euro IV 日期则明确标为
  tentative，同时依赖 Euro 5 柴油全国供应后的宽限期，不能按燃油节点推断生效。
- 后果：道路卡车/客车各返回 CO 4.0、HC 1.1、NOx 7.0、PM 0.15 g/kWh 四项。
  不保存 Euro II 非强制烟度；法规 regulation 5 将范围限制为 intended for road
  use，故非道路空结果不能由道路表补齐。
- 验证方式：测试覆盖 2016-12-31/2017-01-01 日期边界、卡车/客车同结果、
  2026 查询仍不出现 Euro IV，以及 construction/agriculture 150 kW 空结果；
  治理脚本执行同组读回检查。

### ADR-058：沙特 GSO/SASO 来源登记与四 scope no-data

- 状态：Accepted with open evidence gap
- 日期：2026-08-07
- 决策：SAU 建立 `SA-SASO` country jurisdiction，登记 GSO 42:2015、
  GSO 144:1991 和 SASO Machinery Safety Part 2 官方来源，但不创建 effective
  regulation 或限值。卡车、客车、工程机械、农业装备四个 scope 均保持 no-data。
- 理由：GSO 官方目录将 42/144 标为 current Gulf Technical Regulation；GSO 144
  公开预览可读回重型柴油车辆 scope、污染物类型和 >3,500 kg 定义，但止于定义页，
  未公开要求/限值表，也没有沙特国家实施日期。SASO Part 2 虽覆盖移动/重型设备并
  有明确 180 日过渡期，正文的 emissions 条款只处理喷洒物、有害物质、噪声、振动
  和辐射风险，不能解释为柴油尾气污染物限值。
- 后果：SAU 作为已登记官方来源的 covered 国家展示，但法规查询明确证据不足。
  GSO 批准日、SASO 安全法规实施日、邻国采用日期和二手 Euro 对照均不得补成
  effective 事实；取得 GSO 144 完整表和沙特实施文书后再新增 regulation/limits。
- 验证方式：测试与治理脚本覆盖四个 scope 的空结果、`SA-SASO` 成员关系和 covered
  状态；来源清单记录官方目录、公开预览、SASO PDF 的具体可读回范围及 14 天事件
  驱动复核责任。

### ADR-059：阿联酋 MOIAT/UAE Legislation 来源登记与四 scope no-data

- 状态：Accepted with open evidence gap
- 日期：2026-08-07
- 决策：ARE 建立 `AE-MOIAT` country jurisdiction，登记 Cabinet Resolution
  No. (13) of 2018 和 MOIAT Conformity Hub Regulations 官方来源，但不创建
  effective regulation 或限值。卡车、客车、工程机械、农业装备四个 scope 均保持
  no-data。
- 理由：UAE Legislation 官方页面明确该决议 `Issued Date 03 Apr 2018`、
  `Effective Date 01 May 2018`、`Active`；唯一附表只列 UAE.S 5016:2018 低批量
  生产车辆和 UAE.S 5019:2018 车辆 eCall，未列 GSO 42/144 或柴油尾气限值。
  MOIAT Conformity Hub 目录中 `Diesel` 是 Petroleum products 条目，
  `DIESEL GENERATOR` 属于 Electrical / `Issue conformity certificate for
  non-regulated products`，不能解释为发动机排放法规。
- 后果：ARE 作为已登记官方来源的 covered 国家展示，但法规查询明确证据不足。
  `Effective Date 01 May 2018` 只约束该强制标准附表；不得外推为柴油排放实施日，
  不复制 GSO/Euro/Stage 邻国限值或将安全/eCall 标准套入尾气 scope。取得 UAE
  柴油道路/非道路正式排放文书与限值表后再新增 regulation/limits。
- 验证方式：测试与治理脚本覆盖四个 scope 的空结果、`AE-MOIAT` 成员关系和 covered
  状态；来源清单记录附表 PDF、目录筛选结果及 14 天事件驱动复核责任。

### ADR-060：南非 NRCS 车辆规范来源登记与四 scope no-data

- 状态：Accepted with open evidence gap
- 日期：2026-08-07
- 决策：ZAF 建立 `ZA-NRCS` country jurisdiction，登记 Government Gazette No.
  39220 Notice 613（M2/M3）与 Notice 611（N2/N3）官方强制规范，但不创建
  effective regulation 或限值。卡车、客车、工程机械、农业装备四个 scope 均保持
  no-data。
- 理由：两份 2015 官方公报正文均将道路车辆排放接入 SANS 20049:2004 至 ECE
  R49.02B，并列美国、日本、ADR 80/00、SANS 20083/ECE R83.04 等效路径；Schedule
  1 保留 2006-01-01（排放要求）、2010-01-01（旧型号制造/进口豁免结束）和
  2011-07-01（销售豁免结束）节点，但未公开可直接发布的污染物数值表。2018 GN
  516 是 NEMAQA 固定源活动清单修订意向通知；2003 GN 3324 明确是 FINAL DRAFT
  策略且未来仍需 promulgate 法规，二者都不能补齐移动非道路限值。
- 后果：ZAF 作为已登记官方来源的 covered 国家展示；不得把 2003 draft 的 Euro
  时间表、GN 516 固定设施限值、ECE/Euro 邻国数值或 SANS 引用日期直接升级为
  ZAF effective limits。取得南非实施文书及可核验数值附件后再新增 regulation/limits。
- 验证方式：测试与治理脚本覆盖四个 scope 的空结果、`ZA-NRCS` 成员关系和 covered
  状态；来源清单记录 39220 两份公报、GN 516、257410 的具体可读回范围及 14 天
  事件驱动复核责任。

### ADR-061：阿根廷重型道路 B2 基线与军用例外隔离

- 状态：Accepted with open non-road evidence gap
- 日期：2026-08-07
- 决策：ARG 建立 `AR-SAyDS` country jurisdiction。普通 M2/M3/N1/N2/N3 重型
  道路车辆按 Resolución 1464/2014 引用的 Directive 2005/55 B2（Euro V）限值
  建模；当前 schema 无新车型/既有车型字段，使用全部重型车辆及发动机完成切换的
  2018-01-01 作为统一查询起点。卡车和客车各保存 ESC/ELR 与 ETC 共 9 条 B2
  限值；construction/agriculture 保持 no-data。
- 理由：Infoleg 官方正文明确给出 2016-01-01 新车型节点和 2018-01-01 全部重型
  车辆节点，并允许 B2 或 C 路径。Publications Office/CELLAR 官方 Directive
  2005/55 PDF 可直接读回 B2 数值；C/EEV 是更严格的替代认证路径，不能与 B2
  合并成单一发动机同时适用的限值集合。Resolución 128/2018 只针对 Ejército
  Argentino 特殊军用 M2/M3/N2/N3，期限 18 个月并允许 Euro III，不改变普通市场。
- 后果：2017-12-31 普通道路查询无结果，2018-01-01 起返回 B2；军用例外只登记
  为来源边界，不创建 effective regulation。取得 C/EEV 独立路径字段或阿根廷
  非道路正式文书前，不扩展当前结果。
- 验证方式：fixture、Repository 测试和治理脚本覆盖道路切换日、两类道路 scope、
  9 条 B2 数值、`AR-SAyDS` 来源追溯、军用例外排除及两个非道路 scope 空结果。

### ADR-062：新西兰重型道路统一切换与替代路径建模

- 状态：Accepted with open non-road evidence gap
- 日期：2026-08-07
- 决策：NZL 建立 `NZ-NZTA` country jurisdiction。Rule 33001 Schedule 1 Table
  2B 自 2025-11-01 对新旧 MD3/MD4/ME/NB/NC 重型车辆统一接受 Euro VI Step C
  等替代标准；当前 schema 无 used/new/new-model 维度，因此只从该统一日期发布
  Euro VI Step C 代表路径，卡车和客车各保存 WHSC/WHTC 共 12 条限值。
- 理由：2024-11-01 至 2025-10-31 的 Table 2B 对 used、new existing model 和 new
  model 采用不同门槛，强行压成一个法规会误报。2025-11-01 起三者统一，可以在
  当前维度下可靠查询。Table 2B 使用 `or` 接受 US Tier 3、US 2013、Japan 2016、
  ADR 80/04、UNR49/06(Supp.4)、UNR83/07；这些是替代路径，不是累计限值。
  Euro VI 数值由规则定义直接引用且项目已核验的 EU 595/2009、582/2011 来源链提供。
- 后果：2025-10-31 不返回被简化的统一 NZL 路径，2025-11-01 起返回 Euro VI
  代表性限值。2.1(2)(b) 明确排除 tractors；未取得独立非道路法定限值前，
  construction/agriculture 保持 no-data，不从道路 entry certification 外推。
- 验证方式：fixture、Repository 测试和治理脚本覆盖切换日前后、卡车/客车 12 条
  WHSC/WHTC 限值、替代路径文本、`NZ-NZTA` 来源追溯、tractor 排除与两个非道路
  scope 空结果。

### ADR-063：智利道路、移动机械与未来拖拉机分状态建模

- 状态：Accepted
- 日期：2026-08-07
- 决策：CHL 建立 `CL-MMA` country jurisdiction。D.S. 50/2023 道路重型
  Euro VI 代表路径按 D.S. 55/1994 现行版本日期 2026-01-06 生效；D.S. 39/2020
  一般移动机械 Table 2 路径按发布满 24 个月的 2023-10-21 生效，严格限制为
  19 <= P <= 560 kW。D.S. 33/2024 的 tractor 要求以 2030-01-01、`adopted`
  状态单独保存，其他农业机械明确排除。
- 理由：D.S. 50 的 2024-07-05 是发布日，其 transitory article 要求 18 个月后
  才实施，LeyChile D.S. 55 合并版将 article 8 quáter 的现行版本标为 2026-01-06。
  D.S. 39 的一般移动机械与 tractor 日期不同，D.S. 33 又同时增加农业机械排除；
  合并成一个 effective agriculture 记录会提前两年多并扩大适用范围。
- 替代路径：道路 Table 1 US-EPA 与 Table 3 Euro VI 二选一；非道路 Table 1
  US 40 CFR 1039 与 Table 2 EU Stage V 二选一。本批分别建模 Euro VI 与 Stage V
  代表路径，measurement basis 必须保留 alternative/not cumulative 语义。
- 后果：2026-01-05 道路无结果，次日起卡车/客车各返回 12 条；construction 从
  2023-10-21 起返回五个功率带并包含 560 kW；2026 agriculture 仍为空。到 2030
  前需经治理流程把 tractor 从 `adopted` 更新为 `effective`，不能自动转换。
- 验证方式：fixture、Repository 测试和治理脚本覆盖两个生效边界、五个功率带、
  560/560.001 kW 端点、替代路径、未来状态、农业排除和 `CL-MMA` 来源追溯。

### ADR-064：哥伦比亚道路与非道路替代路径及农业排除建模

- 状态：Accepted
- 日期：2026-08-07
- 决策：COL 建立 `CO-MADS` country jurisdiction。Resolucion 0762/2022
  article 18 Table 22 道路重型柴油限值从 2023-01-01 生效；article 19 的
  非道路要求从法规发布满 24 个月的 2024-07-18 生效，严格限制为
  19 <= P <= 560 kW。Article 3(c) 排除专用于农业作业的非道路移动源，故只把
  Table 23 映射到 construction，agriculture 保持 no-data。
- 理由：MinAmbiente 官方法规目录将 Resolucion 0762 日期标为 2022-07-18，
  article 50 规定自发布生效，article 19 明确从生效后 24 个月适用；不能用后续
  PDF 上传月份或任意抓取日期替代。Article 3(c) 是明确 scope 排除，优先于一般
  非道路范围。
- 替代路径：道路 Table 22 与 EPA10 或更高标准二选一；非道路 Table 23 EU 与
  Table 24 US 二选一。本批分别建模 Table 22 与 Table 23 代表路径，每条
  measurement basis 保留 alternative/not cumulative 语义。
- 后果：2022-12-31 道路无结果，2023-01-01 起卡车/客车各返回 12 条；
  construction 从 2024-07-18 起按五个功率带返回并包含 560 kW。19 <= P < 37
  使用 NRSC，37 <= P <= 560 使用 NRSC/NRTC；农业查询始终不返回该法规。
- 验证方式：fixture、Repository 测试和治理脚本覆盖两个生效边界、
  18.999/19/37/56/75/130/560/560.001 kW 端点、循环、替代路径、农业排除和
  `CO-MADS` 官方来源追溯。

### ADR-065：秘鲁重型道路 Euro VI/A 代表路径与非道路边界建模

- 状态：Accepted
- 日期：2026-08-08
- 决策：PER 建立 `PE-MINAM` country jurisdiction。D.S. 029-2021-MINAM
  article 2 替换 D.S. 010-2017-MINAM annex I.7 后，PBV > 3.5 t 压燃式客货
  道路车辆从 2024-10-01 采用 Euro VI/A WHSC/WHTC 或更高标准；本批保存
  Euro VI/A 代表路径。Construction/agriculture 不从道路车辆表外推，保持 no-data。
- 理由：第一项最终补充规定明确 2024-10-01 应用 Euro 6/VI、Tier 3、EPA 2010，
  annex 脚注又把应用日期定义为提单日期而非入境日期。Article 1 将 item I 标题
  限定为纳入国家道路运输系统的机动车，不能据此推断非道路机械。
- 替代路径：annex I.7 列 Euro VI/A，annex I.9.1 另列 EPA 2010。本批只保存
  Euro VI/A 表中直接发布的 12 条限值，每条 measurement basis 保留
  alternative/not cumulative 语义。
- 未来状态：第二项最终补充规定要求在 2024-10-01 后两年内以部长决议更新
  Euro VI/A 到 Euro VI/C 的试验协议。2026-08-08 尚未到期限，也未读回已发布的
  更新文书，因此不得提前升级当前记录。
- 后果：2024-09-30 道路无结果，2024-10-01 起卡车/客车各返回 12 条；
  construction/agriculture 继续为空。该简化模型不表示所有车辆登记日均从同日
  切换，业务解释必须保留提单日期语义。
- 验证方式：fixture、Repository 测试和治理脚本覆盖切换日前后、卡车/客车
  WHSC/WHTC 数值、替代路径、两个非道路 no-data scope 和 `PE-MINAM` 来源追溯。

### ADR-066：菲律宾官方入口与不可访问正文的 no-data 建模

- 状态：Accepted
- 日期：2026-08-08
- 决策：PHL 建立 `PH-DENR` country jurisdiction，只登记 EMB 官方域名下的
  DAO 2015-04 PDF 入口；不创建 regulation 或 emission limits，四个 scope
  均保持 no-data。成员关系从 2014-09-29 起记录，该日期只代表本批直接读回的
  最早 DENR 机动车排放职责证据，不是 DAO 发布或生效日。
- 理由：2026-08-08 直接访问官方 PDF 只得到 Cloudflare 安全验证页；Official
  Gazette 以完整文书号检索返回 `Nothing Found`。目前无法从官方正文确认标题、
  发布/实施日期、车辆分类、测试循环或限值，URL 的 `/2015/12/` 上传路径也不是
  法定日期证据。Official Gazette 2014-09-29 DENR 新闻稿确认部门职责，但将
  Euro 4 仅描述为提议提前实施，不能替代法规正文。
- 排除方案：不使用搜索摘要、二手数据库、邻国 Euro/Stage 规则或模型记忆填充
  Euro IV 数值；不尝试绕过站点验证；不把来源 `verifiedAt` 解释为法规生效日。
- 后果：国家详情可以追溯 DENR/EMB 和 DAO 官方入口，但所有法规查询为空。
  页面恢复可达或取得另一官方全文镜像后，需重新核验并通过治理流程新增法规事实。
- 验证方式：fixture、Repository 测试和治理脚本验证四 scope 均为空、来源不是
  Demo、DAO 发布日期未臆造、辖区日期只使用已读回的职责证据，并保留精确官方 URL。

### ADR-067：新加坡道路与工业非道路替代路径建模

- 状态：Accepted
- 日期：2026-08-08
- 决策：SGP 建立 `SG-NEA` country jurisdiction。由于 1:110m 地图源缺少该小国，
  同时从同一 Natural Earth 固定 revision 的 1:10m 源补入 SGP 多边形与目录行。
  道路按 S 480/2017 从
  2018-01-01 建模 GVW > 3.5 t 柴油车 Euro VI WHSC/WHTC 代表路径；工程机械按
  S 299/2012 从 2012-07-01 建模 18≤P<560 kW 的 EU Stage II 代表路径。
  Agriculture 因 industrial plant 与农机的官方映射不足而保持 no-data。
- 理由：S 480/2017 明确修订生效日和 Euro VI/PPNLT 路径。S 299/2012 的进口、
  批准与使用义务围绕 industrial plant，NEA 当前指引明确列出 cranes、excavators、
  forklifts 和 generators，足以支持 construction，但不足以外推全部农业设备。
- 替代路径：道路 Euro VI 不与日本 PPNLT 路径累计；非道路 EU Stage II 不与
  US Tier II 或 Japan Tier I 累计。每条限值保存 representative alternative、
  not cumulative 与 ISO 8178 语义。
- 边界：Stage II 四带为 18–37、37–75、75–130、130–560 kW，均采用半开区间；
  560 kW 不返回。Agriculture 的空结果表示证据不足，不表示法定全面豁免。
- 后果：2018-01-01 起道路卡车/客车各返回 12 条；2012-07-01 起 construction
  按功率带返回 4 条；agriculture 为空。其他替代认证路径仍可合规，但未重复入库。
- 验证方式：fixture、Repository 测试和治理脚本覆盖道路日期切换、四个功率带及
  17.999/560 kW 边界、替代路径语义、农业 no-data 和 `SG-NEA` 官方来源追溯。

### ADR-068：挪威国内纳入文书与 EU 数值的双重追溯

- 状态：Accepted
- 日期：2026-08-08
- 决策：NOR 建立 `NO-NATIONAL` country jurisdiction。道路按现行
  Bilforskriften 自 2022-10-01 建模 Euro VI WHSC/WHTC 代表路径，并在 G3
  指定的 2029-05-29 切换日结束；工程机械与农业装备按 Maskinforskriften
  Vedlegg XII 自 2020-07-01 建模 Stage V NRE 全功率带。
- 理由：Bilforskriften §§ 1-2/1-4 明确国家范围并把 595/2009、582/2011 作为
  挪威法，G3 明确当前重型车辆路径和未来切换；Maskinforskriften § 1(3)、
  Vedlegg XII 明确将 2016/1628 作为挪威法规，并同时触及 167/2013 农林车辆
  框架。国内适用依据充分，精确限值继续沿用已签核 EU 官方表。
- 日期边界：`2022-10-01` 仅是现行 Bilforskriften 的生效日，不宣称为挪威首次
  Euro VI 实施日。历史 FOR-2012-07-05-817 虽引用相关 EU 框架，但不足以单独
  重建完整车型分期，因此不据此回填更早起点。Euro VI 的 `effectiveTo` 设为
  `2029-05-29`，按半开区间使 2029-05-28 有结果、切换日无结果。
- 来源语义：regulation 和 jurisdiction 指向 Lovdata 国内文书；每条限值分别指向
  EU 595/2009/582/2011 或 2016/1628 数值来源，并在 measurement basis 保留
  挪威纳入链。不得只引用 EU 表就推断挪威适用，也不得复制两套累计限值。
- 功率边界：Stage V 使用已签核 NRE 表；150 与 559.999 kW 在 130–560 带返回
  5 条，560 kW 进入无上界高功率带返回 4 条。Construction 与 agriculture 共用
  该法规，但道路 scope 必须隔离。
- 验证方式：fixture、Repository 测试和治理脚本覆盖道路起止日期、卡车/客车、
  非道路双 scope、150/559.999/560 kW 边界、数值及双重来源追溯。

### ADR-069：冰岛使用独立国内实施链，不从 EEA 身份自动继承

- 状态：Accepted
- 日期：2026-08-08
- 决策：ISL 建立 `IS-NATIONAL` country jurisdiction。道路按 377/2013 自
  2013-04-15 建模 Euro VI WHSC/WHTC 代表路径，并按 603/2026 已纳入的 Euro 7
  重型车辆适用日于 2027-11-29 结束；非道路以 1200/2020（2020-12-01 至
  2021-02-23）和 179/2021（2021-02-23 起）两段记录建模 Stage V，覆盖
  construction 与 agriculture。
- 理由：377/2013 article 12 与 Annex IV 45zzk/45zzl 明确写入 595/2009、
  582/2011，603/2026 继续更新该条目并纳入 2024/1257。1200/2020 与 179/2021
  的 scope、主管机关、EEA 实施条款和替代关系均由冰岛官方正文直接给出。冰岛
  政府 EEA 数据库进一步确认 595/2009 通过 JCD 41/2012 纳入且仍有效，但 EEA
  状态不单独替代国内实施证据。
- 日期边界：377/2013 规定立即生效，本批以文书所载 2013-04-15 部长日期作为
  可复核起点，不提前采用 2012-05-01 的 EEA 层日期。道路 `effectiveTo` 为
  `2027-11-29` 半开边界。1200/2020 的 `effectiveTo` 与 179/2021 的
  `effectiveFrom` 同为 `2021-02-23`，切换日只能返回后一法规，不能重复或断档。
- 来源语义：regulation 和 jurisdiction 指向冰岛国内文书；限值指向已签核的
  EU 595/2009/582/2011 与 2016/1628 官方表，并在 measurement basis 保存冰岛
  纳入链。法规库许可未复核前不复制全文。
- 功率边界：Stage V 沿用 NRE 代表表；150 与 559.999 kW 各返回 5 条，560 kW
  进入高功率带返回 4 条。两个非道路 scope 使用同一数值，不与道路结果混合。
- 验证方式：fixture、Repository 测试和治理脚本覆盖道路起止、卡车/客车、
  1200/2020→179/2021 无缝替代、非道路双 scope、150/559.999/560 kW 以及
  冰岛国法、政府 EEA 状态和 EU 数值的三层追溯。

## 3. 阻塞决策

### ADR-015：首批 MVP 数据切片

- 状态：Partially Accepted
- 已确认：作品采用“全球基础目录 + 主流国家摘要 + 重点国家深度数据”的分层覆盖。
  首批深度样板为 CHN、USA、DEU/EU、IND、BRA，第二批为 JPN、KOR、MEX、TUR、
  AUS。业务场景为卡车动力、客车动力、工程机械动力、农业装备动力。
- 主流摘要候选：CAN、GBR、FRA、ITA、ESP、POL、RUS、IDN、THA、VNM、MYS、
  SAU、ARE、ZAF、ARG；进入真实数据任务前逐项确认官方来源可用性。
- 仍需决定：代表性法规年份/阶段、2–3 个市场指标、5–10 个虚构或公开许可的
  产品配置，以及每条事实的来源和验收样例。
- 2026-07-30 调研（`docs/SOURCES.md`）：CHN、USA、DEU/EU、IND、BRA 五国
  × 四类动力场景的官方公开来源清单、许可矩阵（ADR-018 输入）与确定性验收
  样例草稿已完成；2026-07-30 负责人授权以 AI 已核验的官方来源链代替人工
  逐项读回，批准 CHN/USA/DEU/BRA 中核验状态为已核验或间接核验的样例
  （签核表 `docs/ACCEPTANCE.md`）。IND 曾因网络不可达暂时移出，2026-08-07
  在 MoRTH 官方 API/PDF 恢复可达后按 ADR-052 完成复核、签核与本地 fixture。
- 阻塞：不再阻塞国家目录、场景 schema 设计与已签核国家的确定性验收 fixture；
  仍阻塞未签核部分的真实法规 fixture、product-fit 业务验收和市场排名。

### ADR-016：身份与访问模型

- 状态：Partially Accepted（公开只读作品）
- 已确认：地图、国家详情和 AI 演示作为公开只读求职作品；只使用公开、获准展示的
  数据，不录入真实公司的机密产品、市场、客户或内部策略。
- 决策：公开部署不暴露 `/admin`；管理后台只有接入可信身份系统后才可启用。
  ADR-036 的 Header 映射仅用于本地和受控环境，不能作为公网登录方案。
- 阻塞：不再阻塞公开只读页面设计；托管平台、限流、防滥用和正式后台身份仍阻塞
  公网发布。

### ADR-017：生成模型与 Embedding

- 状态：Blocked
- 需决定：provider、模型、Embedding 维度、处理区域、保留策略、预算与故障策略。
- 建议：通过 Vercel AI SDK adapter 隔离 provider；以法规检索基准而非榜单选择 embedding。
- 阻塞：固定 vector schema、真实 AI 集成和成本预算；不阻塞无 AI 的结构化核心。
- 开发替身：ADR-031 的 `local-hash-embedding-v1` 只解除端到端开发和测试阻塞，
  不解除生产 provider、维度、数据处理区域或检索质量决策。

### ADR-018：数据许可和底图供应

- 状态：Blocked
- 需决定：世界边界、地图样式/瓦片、法规全文、报告和手册能否存储、分块、展示和发送给模型。
- 建议：为每个来源登记 license、redistribution 和 model-processing 结论。
- 阻塞：地图上线、知识库和对外展示。
- 2026-08-05 产品来源核验：潍柴英文官网法律声明限制为个人非商业使用，并禁止
  未经授权的复制、公开展示、发布或分发；当前只登记产品分类入口，不复制参数到
  公开 fixture。VECC 公众查询需要 VIN 或机械环保代码/发动机号，无法按系列直接
  形成认证证据。产品证据接收与发布门记录于 `docs/PRODUCT_EVIDENCE.md`；ADR
  状态保持 Blocked。
- 2026-08-05 市场来源核验：OICA 2025 商业车辆销量覆盖四个样板国家，但电子
  复制/分发须明确授权；UN Comtrade 许可同样限制未经书面许可的自动下载、再分发
  和商业利用。World Bank WDI 数据集为 CC BY 4.0，是当前可公开复用的候选，
  但须逐指标检查第三方例外。市场证据接收与许可门记录于
  `docs/MARKET_EVIDENCE.md`；ADR 状态保持 Blocked。

### ADR-019：数据核验与新鲜度 SLA

- 状态：Blocked
- 需决定：每类数据的 owner/reviewer、核验周期、stale 阈值和纠错流程。
- 建议：法规和认证采用比低变化基础信息更严格的阈值，并在 UI 显示 stale。
- 阻塞：运营验收和可信度声明。

### ADR-020：市场指标与可比性

- 状态：Blocked
- 需决定：指标定义、频率、单位、币种、价格基准、来源优先级和是否允许换算。
- 建议：MVP 只选少量无需复杂推算且跨国口径明确的指标。
- 阻塞：市场比较和营销评分。
- 部分解除：阶段 7 已实现“不换算、完全同口径”的确定性比较器；真实指标定义、
  来源优先级、汇率/价格基准和评分方向仍保持阻塞。
- 2026-08-05 候选核验：WDI `NY.GDP.MKTP.CD` 的 CHN/USA/DEU/BRA 最新值均为
  2025，许可为 CC BY 4.0，但它只是宏观规模代理；WDI 农业 value-added 与
  industry-including-construction value-added 的 USA 最新年份为 2021，其他三国
  为 2025，按现有比较器必须判定期间不一致。OICA commercial-vehicle sales 更接近
  道路业务但许可未解除，UN Comtrade HS 8408 同时有许可和用途混合问题。业务
  owner 需从 `docs/MARKET_EVIDENCE.md` 决策包批准 2–3 个指标、共同期间、scope、
  来源优先级和是否仅展示/参与评分；ADR 状态保持 Blocked。

### ADR-021：Product-fit 与营销评分规则

- 状态：Blocked
- 需决定：fit 的必要/充分条件、认证粒度、unknown/partial 处理、评分因素和权重、规则批准人。
- 建议：先完成法规/功率/scope/认证的 fit；营销机会评分可在稳定指标之后加入。
- 阻塞：产品推荐和任何市场排名。
- 部分解除：ADR-030 已接受受限的 `product-fit-v1`；真实配置粒度、
  `partial_fit` 和业务批准人仍保持阻塞。ADR-034/035 接受仅用于当前结构化
  Demo/MVP 的 `opportunity-score-v1` 与 fit-only 推荐；生产营销排名仍需业务
  批准。

### ADR-022：界面与语料语言

- 状态：Proposed
- 需决定：中文、英文或双语 UI；多语检索、OCR/翻译与回答策略。
- 建议：MVP 单一 UI 语言，但保留官方原文标题、语言和 locator，不把机器翻译当官方文本。
- 阻塞：全文检索配置、测试语料和产品文案，不阻塞基础 schema。

### ADR-023：部署区域与数据驻留

- 状态：Blocked
- 需决定：Vercel、Supabase 和模型处理区域，跨境数据要求与日志保留。
- 建议：应用与数据库同/邻近区域；敏感文档是否允许发送给外部模型需单独批准。
- 阻塞：生产部署和性能预算。

### ADR-070：列支敦士登分层建模道路 VTS 与 EWR Stage V

- 状态：Accepted
- 日期：2026-08-08
- 决策：LIE 建立 `LI-NATIONAL` country jurisdiction。道路按现行 VTS
  （Fassung 2026-07-01）Anhang 4 Ziff. 211 的 595/2009/R49 入口，从
  2026-07-01 建模 Euro VI WHSC/WHTC 代表路径；非道路按 LGBl. 2020 Nr. 258
  记录的 EWR Decision 39/2020，自 2020-08-01 建模 EU 2016/1628 Stage V，覆盖
  construction 与 agriculture。
- 理由：VTS 正文直接规定重型 M/N 柴油机的排放合规入口，并明确 EWR 文书直接适用；
  但当前官方合并文本未提供可重建的首次 Euro VI 国内实施日期。LGBl. 2020 Nr. 258
  明确列支敦士登生效日和 2016/1628 纳入事实，足以支持 Stage V 国内日期。
- 日期边界：道路 `effectiveFrom = 2026-07-01` 仅表示现行合并版本起点，不宣称
  首次实施日；非道路 `effectiveFrom = 2020-08-01`。不得从 EWR 身份、邻国规则或
  EU 成员关系反推列支敦士登更早道路日期。
- 来源语义：法规和辖区指向 Lilex 国内文书；道路限值追溯 EU 595/2009/582/2011，
  非道路限值追溯 EU 2016/1628，并在 measurement basis 保留国内纳入链。
- 功率边界：Stage V 使用已签核 NRE 表；150 与 559.999 kW 返回 5 条，560 kW
  进入高功率带返回 4 条。道路和非道路 scope 不混合。
- 验证方式：fixture、Repository 测试和治理脚本覆盖道路当前版本边界、Stage V
  生效日、双非道路 scope、功率边界、辖区来源和双层追溯。

### ADR-071：瑞士使用现行 VTS 版本边界，不反推首次实施日期

- 状态：Accepted
- 日期：2026-08-08
- 决策：CHE 建立 `CH-NATIONAL` country jurisdiction。道路按瑞士 VTS SR 741.41
  Anhang 5 Ziff. 211，从当前合并版本 2026-07-01 建模 595/2009/R49 Euro VI
  WHSC/WHTC 代表路径；construction 与 agriculture 按同一 VTS Anhang 5
  Ziff. 211a/211b 对 EU 2016/1628 的明确认可，从 2026-07-01 建模 Stage V NRE
  代表功率带。
- 理由：Fedlex 官方正文明确给出重型道路、工作发动机和拖拉机的法规入口，但当前
  版本不足以重建瑞士首次 Euro VI/Stage V 国内实施日。使用现行版本日期可追溯且
  不把欧盟引用或邻国日期伪装成瑞士有效期。
- 日期边界：道路与非道路均 `effectiveFrom = 2026-07-01`，不向前推断；未来历史
  版本核验后再单独建立替代链。
- 来源语义：法规和辖区指向 Fedlex VTS；道路限值追溯 EU 595/2009/582/2011，
  非道路限值追溯 EU 2016/1628，measurement basis 保留瑞士条款。
- 功率边界：Stage V 使用已签核 NRE 表；150 与 559.999 kW 返回 5 条，560 kW
  返回 4 条。道路和非道路 scope 隔离。
- 验证方式：fixture、Repository 测试和治理脚本覆盖 CHE 道路/非道路当前版本
  边界、双 scope、功率边界、辖区来源和双层追溯。

### ADR-072：塞尔维亚官方正文不可达时保留 no-data

- 状态：Superseded by ADR-123
- 日期：2026-08-08
- 决策：SRB 建立 `RS-NATIONAL` country jurisdiction 和官方法律信息系统来源入口，
  但不创建任何道路或非道路 effective regulation；四个 application scope 均保持
  显式 no-data。
- 理由：官方搜索结果可定位车辆排放相关《Правилник》入口，但正文请求在当前
  核验窗口返回连接关闭，未取得 citation、scope、状态、实施日期或污染物限值表。
  不能用搜索摘要、EU/UNECE 关联、邻国日期或模型记忆补齐事实。
- 日期语义：membership `validFrom=2026-08-08` 仅表示官方入口核验记录时间，
  不是排放法规生效日期；不存在 `regulation.effectiveFrom`。
- 验证方式：fixture 与 Repository 测试确认四个 scope 返回空结果，国家详情仍保留
  `RS-NATIONAL` 来源和核验时间；正文或官方镜像恢复后再走治理发布。

### ADR-073：波黑公开资料只有背景证据时保留 no-data

- 状态：Superseded by ADR-123
- 日期：2026-08-08
- 决策：BIH 建立 `BA-NATIONAL` country jurisdiction，登记交通通信部官方入口和
  UNECE 背景资料，但不创建任何道路或非道路 effective regulation；四个 scope 均
  保持显式 no-data。
- 理由：公开资料未给出可直接发布的国内法规 citation、重型车辆/非道路 scope、生效
  日期或污染物限值表；不得将背景报告或 EU/UNECE 标准入口伪装为波黑国内事实。
- 日期语义：membership `validFrom=2026-08-08` 仅表示机构入口核验时间，不是排放
  法规生效日期；不存在 `regulation.effectiveFrom`。
- 验证方式：fixture 与 Repository 测试确认四个 scope 返回空结果，国家详情保留
  `BA-NATIONAL` 及来源；取得官方正文后再经治理发布。

### ADR-074：北马其顿政策背景不得升级为排放法规

- 状态：Superseded by ADR-123
- 日期：2026-08-08
- 决策：MKD 建立 `MK-NATIONAL` country jurisdiction，登记交通通信部官方入口和
  UNECE 环境绩效评估，但不创建道路或非道路 effective regulation；四个 scope 均
  保持显式 no-data。
- 理由：现有材料只描述二手车/新车 Euro 最低等级政策背景，未提供国内重型车辆或
  非道路发动机法规 citation、scope、生效日期或污染物限值表。
- 日期语义：membership `validFrom=2026-08-08` 仅表示机构入口核验时间，不是排放
  法规生效日期；不存在 `regulation.effectiveFrom`。
- 验证方式：fixture 与 Repository 测试确认四个 scope 返回空结果，国家详情保留
  `MK-NATIONAL` 来源；取得官方正文后再经治理发布。

### ADR-075：黑山 ECMT 配额资格不得升级为国内排放法规

- 状态：Superseded by ADR-123
- 日期：2026-08-08
- 决策：MNE 建立 `ME-NATIONAL` country jurisdiction，登记黑山政府交通入口和
  ECMT `EURO VI safe` 配额指南，但不创建道路或非道路 effective regulation；
  四个 scope 均保持显式 no-data。
- 理由：配额指南用于国际运输车辆资格，不提供黑山国内法规 citation、scope、生效
  日期或污染物限值表；候选国身份、EU/UNECE 或气候政策也不能替代国内实施文书。
- 日期语义：membership `validFrom=2026-08-08` 仅表示机构入口核验时间，不是排放
  法规生效日期；不存在 `regulation.effectiveFrom`。
- 验证方式：fixture 与 Repository 测试确认四个 scope 返回空结果，国家详情保留
  `ME-NATIONAL` 来源；取得官方正文后再经治理发布。

### ADR-076：阿尔巴尼亚交通战略目标不得升级为排放法规

- 状态：Superseded by ADR-123
- 日期：2026-08-08
- 决策：ALB 建立 `AL-NATIONAL` country jurisdiction，登记基础设施与能源部入口和
  2030 交通战略，但不创建道路或非道路 effective regulation；四个 scope 均保持
  显式 no-data。
- 理由：战略提出 Euro VI 车队更新和欧洲标准实施目标，但不提供国内法规 citation、
  scope、生效日期或污染物限值表；政策目标、采购条件和候选国身份均不能替代法规。
- 日期语义：membership `validFrom=2026-08-08` 仅表示机构入口核验时间，不是排放
  法规生效日期；不存在 `regulation.effectiveFrom`。
- 验证方式：fixture 与 Repository 测试确认四个 scope 返回空结果，国家详情保留
  `AL-NATIONAL` 来源；取得官方正文后再经治理发布。

### ADR-077：乌克兰环境战略和法规库入口不得升级为排放法规

- 状态：Superseded by ADR-122
- 日期：2026-08-08
- 决策：UKR 建立 `UA-NATIONAL` country jurisdiction，登记最高拉达官方法规数据库
  和第 2697-VIII 号环境政策战略，但不创建道路或非道路 effective regulation；四个
  scope 均保持显式 no-data。
- 理由：现有材料只有正式检索入口和环境政策方向，未提供国内重型车辆/非道路发动机
  法规 citation、scope、生效日期或污染物限值表；通用 EU/UNECE 标准不能替代国内实施。
- 日期语义：membership `validFrom=2026-08-08` 仅表示入口核验时间，不是排放法规
  生效日期；不存在 `regulation.effectiveFrom`。
- 验证方式：fixture 与 Repository 测试确认四个 scope 返回空结果，国家详情保留
  `UA-NATIONAL` 来源；取得官方正文后再经治理发布。

### ADR-078：摩尔多瓦法规库入口和衔接材料不得升级为排放法规

- 状态：Superseded by ADR-122
- 日期：2026-08-08
- 决策：MDA 建立 `MD-NATIONAL` country jurisdiction，登记 `Legis.md` 官方法规库
  和基础设施与区域发展部入口，但不创建道路或非道路 effective regulation；四个
  scope 均保持显式 no-data。
- 理由：法规库在当前核验窗口返回安全验证页，公开交通材料只证明主管机构与政策衔接
  背景，未提供国内重型车辆/非道路发动机法规 citation、scope、生效日期或污染物限值表。
- 日期语义：membership `validFrom=2026-08-08` 仅表示入口核验时间，不是排放法规
  生效日期；不存在 `regulation.effectiveFrom`。
- 验证方式：fixture 与 Repository 测试确认四个 scope 返回空结果，国家详情保留
  `MD-NATIONAL` 来源；取得可直接读回的官方正文后再经治理发布。

### ADR-079：尼泊尔公报条目不得在下载不可读时升级为排放法规

- 状态：Superseded by ADR-122
- 日期：2026-08-08
- 决策：NPL 建立 `NP-NATIONAL` country jurisdiction，登记官方公报
  `Vehicle Emission Standard 2025` 条目和 Department of Transport Management 入口，
  但不创建道路或非道路 effective regulation；四个 scope 均保持显式 no-data。
- 理由：公报条目可确认文书存在，但下载端点在当前核验窗口被客户端拦截，未取得法规
  正文、国内适用 scope、生效日期或污染物限值表；新闻摘要、旧版标准和采购条件不能
  替代官方实施文书。
- 日期语义：membership `validFrom=2026-08-08` 仅表示官方入口核验时间，不是排放
  法规生效日期；不存在 `regulation.effectiveFrom`。
- 验证方式：fixture 与 Repository 测试确认四个 scope 返回空结果，国家详情保留
  `NP-NATIONAL` 来源；取得可直接读回的官方公报正文后再经治理发布。

### ADR-080：亚美尼亚 EAEU 背景不得升级为国内排放法规

- 状态：Accepted
- 日期：2026-08-08
- 决策：ARM 建立 `AM-NATIONAL` country jurisdiction，登记 ARLIS 法律信息系统和
  环境部入口，但不创建道路或非道路 effective regulation；四个 scope 均保持显式
  no-data。
- 理由：当前资料只有 EAEU/Euro V 政策背景，未提供国内法规 citation、scope、生效
  日期或污染物限值表；区域成员身份和二手政策摘要不能替代国内实施文书。
- 日期语义：membership `validFrom=2026-08-08` 仅表示官方入口核验时间，不是排放
  法规生效日期；不存在 `regulation.effectiveFrom`。
- 验证方式：fixture 与 Repository 测试确认四个 scope 返回空结果，国家详情保留
  `AM-NATIONAL` 来源；取得 ARLIS/主管部门直接可读正文后再经治理发布。

### ADR-081：阿塞拜疆法律系统不可达时保持 no-data

- 状态：Accepted
- 日期：2026-08-08
- 决策：AZE 建立 `AZ-NATIONAL` country jurisdiction，登记 e-qanun 法律信息系统和
  生态与自然资源部入口，但不创建道路或非道路 effective regulation；四个 scope 均
  保持显式 no-data。
- 理由：官方法律系统连接关闭，未取得国内法规 citation、scope、生效日期或污染物限值
  表；EAEU/Euro 背景和区域报告不能替代国内实施文书。
- 日期语义：membership `validFrom=2026-08-08` 仅表示官方入口核验时间，不是排放
  法规生效日期；不存在 `regulation.effectiveFrom`。
- 验证方式：fixture 与 Repository 测试确认四个 scope 返回空结果，国家详情保留
  `AZ-NATIONAL` 来源；取得官方正文后再经治理发布。

### ADR-082：格鲁吉亚官方检索空结果保持 no-data

- 状态：Accepted
- 日期：2026-08-08
- 决策：GEO 建立 `GE-NATIONAL` country jurisdiction，登记 Matsne 法律公告系统和
  环境保护与农业部入口，但不创建道路或非道路 effective regulation；四个 scope 均
  保持显式 no-data。
- 理由：官方 Matsne `emission vehicle` 检索返回零结果，未提供国内法规 citation、
  scope、生效日期或污染物限值表；区域身份和二手政策材料不能替代国内实施文书。
- 日期语义：membership `validFrom=2026-08-08` 仅表示官方入口核验时间，不是排放
  法规生效日期；不存在 `regulation.effectiveFrom`。
- 验证方式：fixture 与 Repository 测试确认四个 scope 返回空结果，国家详情保留
  `GE-NATIONAL` 来源；取得官方正文后再经治理发布。

### ADR-083：乌兹别克斯坦 LEX.UZ 空结果保持 no-data

- 状态：Accepted
- 日期：2026-08-08
- 决策：UZB 建立 `UZ-NATIONAL` country jurisdiction，登记 LEX.UZ 国家法律数据库和
  国家生态与气候变化委员会入口，但不创建道路或非道路 effective regulation；四个
  scope 均保持显式 no-data。
- 理由：LEX.UZ 以乌兹别克语 `avtomobil chiqindi` 的官方检索返回“未找到文件”，未取得
  国内重型柴油法规 citation、scope、生效日期或污染物限值表；区域标准、政策新闻和
  搜索空结果不能替代国内实施文书。
- 日期语义：membership `validFrom=2026-08-08` 仅表示入口核验时间，不是排放法规
  生效日期；不存在 `regulation.effectiveFrom`。
- 验证方式：fixture 与 Repository 测试确认四个 scope 返回空结果，国家详情保留
  `UZ-NATIONAL` 来源；取得 LEX.UZ 可读正文后再经治理发布。

### ADR-084：哈萨克斯坦过时/地方检索结果不得升级为当前排放法规

- 状态：Accepted
- 日期：2026-08-08
- 决策：KAZ 建立 `KZ-NATIONAL` country jurisdiction，登记 Adilet 法律信息系统和
  生态与自然资源部入口，但不创建道路或非道路 effective regulation；四个 scope 均
  保持显式 no-data。
- 理由：官方俄文检索可见 2007 年车辆排放技术规章已失效，另有地方车辆排放监测规则；
  本批未读回当前全国重型柴油法规正文、scope、生效日期或限值表。已失效文书、地方规则、
  EAEU 技术标准和搜索摘要不能替代当前国家实施文书。
- 日期语义：membership `validFrom=2026-08-08` 仅表示官方入口核验时间，不是排放
  法规生效日期；不存在 `regulation.effectiveFrom`。
- 验证方式：fixture 与 Repository 测试确认四个 scope 返回空结果，国家详情保留
  `KZ-NATIONAL` 来源；取得当前 Adilet/主管部门正文后再经治理发布。

### ADR-085：塔吉克斯坦法律检索错误保持 no-data

- 状态：Accepted
- 日期：2026-08-08
- 决策：TJK 建立 `TJ-NATIONAL` country jurisdiction，登记国家法律中心和政府入口，
  但不创建道路或非道路 effective regulation；四个 scope 均保持显式 no-data。
- 理由：国家法律中心车辆排放关键词提交后返回 HTTP 500，未取得国内法规 citation、
  scope、生效日期或污染物限值表；错误页面、区域标准和政策材料不能替代实施文书。
- 日期语义：membership `validFrom=2026-08-08` 仅表示官方入口核验时间，不是排放法规
  生效日期；不存在 `regulation.effectiveFrom`。
- 验证方式：fixture 与 Repository 测试确认四个 scope 返回空结果，国家详情保留
  `TJ-NATIONAL` 来源；取得可读正文后再经治理发布。

### ADR-086：吉尔吉斯斯坦失效技术法规保持 no-data

- 状态：Accepted
- 日期：2026-08-08
- 决策：KGZ 建立 `KG-NATIONAL` country jurisdiction，登记司法部中央法律信息库和
  自然资源、生态与技术监督部入口，但不创建道路或非道路 effective regulation；四个
  scope 均保持显式 no-data。
- 理由：官方正文页面明确《地面运输工具安全通用技术法规》（第 178 号）依据 2015-04-02
  第 69 号法律失效；正文也未提供当前全国重型柴油限值表、scope 或生效日期。失效文书、
  EAEU 标准和搜索摘要不能替代当前实施文书。
- 日期语义：membership `validFrom=2026-08-08` 仅表示入口核验时间，不是排放法规生效
  日期；不存在 `regulation.effectiveFrom`。
- 验证方式：fixture 与 Repository 测试确认四个 scope 返回空结果，国家详情保留
  `KG-NATIONAL` 来源；取得现行官方正文后再经治理发布。

### ADR-087：土库曼斯坦法律系统登录门槛保持 no-data

- 状态：Accepted
- 日期：2026-08-08
- 决策：TKM 建立 `TM-NATIONAL` country jurisdiction，登记土库曼斯坦司法部入口和官方
  Adalat 法律系统，但不创建道路或非道路 effective regulation；四个 scope 均保持显式
  no-data。
- 理由：司法部公开页确认法律系统入口；法律系统公开页面要求手机号登录，公开国家登记
  法规目录未返回可读法规行，未取得国内重型柴油法规 citation、scope、生效日期或限值表。
  登录受限页面、空目录、区域标准和搜索摘要不能替代官方实施文书。
- 日期语义：membership `validFrom=2026-08-08` 仅表示官方入口核验时间，不是排放法规
  生效日期；不存在 `regulation.effectiveFrom`。
- 验证方式：fixture 与 Repository 测试确认四个 scope 返回空结果，国家详情保留
  `TM-NATIONAL` 来源；取得可读官方正文后再经治理发布。

### ADR-088：阿富汗官方检索空结果保持 no-data

- 状态：Accepted
- 日期：2026-08-08
- 决策：AFG 建立 `AF-NATIONAL` country jurisdiction，登记阿富汗司法部入口及官方检索
  URL，但不创建道路或非道路 effective regulation；四个 scope 均保持显式 no-data。
- 理由：司法部官方 `vehicle emission` 检索返回 no results，未提供国内重型柴油法规
  citation、scope、生效日期或限值表；旧站、区域标准和搜索摘要不能替代实施文书。
- 日期语义：membership `validFrom=2026-08-08` 仅表示官方检索核验时间，不是排放法规
  生效日期；不存在 `regulation.effectiveFrom`。
- 验证方式：fixture 与 Repository 测试确认四个 scope 返回空结果，国家详情保留
  `AF-NATIONAL` 来源；取得可读官方正文后再经治理发布。

### ADR-089：安哥拉官方入口未读回限值表保持 no-data

- 状态：Accepted
- 日期：2026-08-08
- 决策：AGO 建立 `AO-NATIONAL` country jurisdiction，登记 Lex Angola 和安哥拉环境部
  入口，但不创建道路或非道路 effective regulation；四个 scope 均保持显式 no-data。
- 理由：官方法律平台与环境部入口可访问，但本批未取得可发布的国内重型柴油法规
  citation、scope、生效日期或限值表；法律目录、政策新闻和区域标准不能替代实施文书。
- 日期语义：membership `validFrom=2026-08-08` 仅表示官方入口核验时间，不是排放法规
  生效日期；不存在 `regulation.effectiveFrom`。
- 验证方式：fixture 与 Repository 测试确认四个 scope 返回空结果，国家详情保留
  `AO-NATIONAL` 来源；取得可读官方正文后再经治理发布。

### ADR-090：布隆迪官方入口不可访问保持 no-data

- 状态：Accepted
- 日期：2026-08-08
- 决策：BDI 建立 `BI-NATIONAL` country jurisdiction，登记司法部与政府入口，但不创建
  道路或非道路 effective regulation；四个 scope 均保持显式 no-data。
- 理由：司法部官方入口返回证书错误，政府入口未提供可读的当前重型柴油法规正文、scope、
  生效日期或限值表；错误页、区域标准和搜索摘要不能替代实施文书。
- 日期语义：membership `validFrom=2026-08-08` 仅表示官方入口核验时间，不是排放法规
  生效日期；不存在 `regulation.effectiveFrom`。
- 验证方式：fixture 与 Repository 测试确认四个 scope 返回空结果，国家详情保留
  `BI-NATIONAL` 来源；入口恢复后再经治理发布。

### ADR-091：贝宁检索仅命中部长会议记录保持 no-data

- 状态：Accepted
- 日期：2026-08-08
- 决策：BEN 建立 `BJ-NATIONAL` country jurisdiction，登记司法部和政府总秘书处法律
  文库，但不创建道路或非道路 effective regulation；四个 scope 均保持显式 no-data。
- 理由：官方 `émissions véhicules` 检索只返回部长会议记录，没有国内重型柴油法规
  citation、scope、生效日期或限值表；会议记录、政策新闻和区域标准不能替代实施文书。
- 日期语义：membership `validFrom=2026-08-08` 仅表示官方检索核验时间，不是排放法规
  生效日期；不存在 `regulation.effectiveFrom`。
- 验证方式：fixture 与 Repository 测试确认四个 scope 返回空结果，国家详情保留
  `BJ-NATIONAL` 来源；取得可读官方正文后再经治理发布。

### ADR-092：布基纳法索官方文档库为空保持 no-data

- 状态：Accepted
- 日期：2026-08-08
- 决策：BFA 建立 `BF-NATIONAL` country jurisdiction，登记司法部入口和在线文档页，但
  不创建道路或非道路 effective regulation；四个 scope 均保持显式 no-data。
- 理由：官方在线文档页显示 0 份法律、法令、条例和报告，未提供国内重型柴油法规
  citation、scope、生效日期或限值表；空目录、政策新闻和区域标准不能替代实施文书。
- 日期语义：membership `validFrom=2026-08-08` 仅表示官方文档页核验时间，不是排放法规
  生效日期；不存在 `regulation.effectiveFrom`。
- 验证方式：fixture 与 Repository 测试确认四个 scope 返回空结果，国家详情保留
  `BF-NATIONAL` 来源；取得可读官方正文后再经治理发布。

### ADR-093：孟加拉国法律数据库不可访问保持 no-data

- 状态：Accepted
- 日期：2026-08-08
- 决策：BGD 建立 `BD-NATIONAL` country jurisdiction，登记法律数据库和环境部入口，但
  不创建道路或非道路 effective regulation；四个 scope 均保持显式 no-data。
- 理由：官方法律数据库连接关闭，环境部门户没有直接提供可发布的国内重型柴油法规
  citation、scope、生效日期或限值表；连接错误页、门户导航和区域标准不能替代实施文书。
- 日期语义：membership `validFrom=2026-08-08` 仅表示官方入口核验时间，不是排放法规
  生效日期；不存在 `regulation.effectiveFrom`。
- 验证方式：fixture 与 Repository 测试确认四个 scope 返回空结果，国家详情保留
  `BD-NATIONAL` 来源；取得可读官方正文后再经治理发布。

### ADR-094：巴哈马官方入口连接关闭保持 no-data

- 状态：Accepted
- 日期：2026-08-08
- 决策：BHS 建立 `BS-NATIONAL` country jurisdiction，登记官方法律数据库和政府入口，
  但不创建道路或非道路 effective regulation；四个 scope 均保持显式 no-data。
- 理由：两个官方入口均返回连接关闭，未取得国内重型柴油法规 citation、scope、生效日期
  或限值表；连接错误页、区域标准和搜索摘要不能替代实施文书。
- 日期语义：membership `validFrom=2026-08-08` 仅表示官方入口核验时间，不是排放法规
  生效日期；不存在 `regulation.effectiveFrom`。
- 验证方式：fixture 与 Repository 测试确认四个 scope 返回空结果，国家详情保留
  `BS-NATIONAL` 来源；入口恢复后再经治理发布。

### ADR-095：白俄罗斯官方入口未读回可发布限值保持 no-data

- 状态：Accepted
- 日期：2026-08-09
- 决策：BLR 建立 `BY-NATIONAL` country jurisdiction，登记国家法律互联网门户和交通部
  官方入口，但不创建道路或非道路 effective regulation；四个 scope 均保持显式 no-data。
- 理由：官方检索仅返回生态等级背景、术语和法规入口，未取得当前国内重型柴油法规正文、
  citation、scope、生效日期和限值表；不能用 EAEU/UNECE 或新闻摘要推断国家实施法规。
- 日期语义：membership `validFrom=2026-08-09` 仅表示官方入口核验时间，不是排放法规
  生效日期；不存在 `regulation.effectiveFrom`。
- 验证方式：fixture 与 Repository 测试确认四个 scope 返回空结果，国家详情保留
  `BY-NATIONAL` 来源；取得可读官方正文后再经治理发布。

### ADR-096：玻利维亚官方入口不可用保持 no-data

- 状态：Accepted
- 日期：2026-08-09
- 决策：BOL 建立 `BO-NATIONAL` country jurisdiction，登记官方公报与环境主管部门入口，
  但不创建道路或非道路 effective regulation；四个 scope 均保持显式 no-data。
- 理由：公报入口超时、环境部门入口证书错误，未取得可发布的国内重型柴油法规正文、
  citation、scope、生效日期和限值表；不能用区域标准或新闻摘要推断国家实施法规。
- 日期语义：membership `validFrom=2026-08-09` 仅表示官方入口核验时间，不是排放法规
  生效日期；不存在 `regulation.effectiveFrom`。
- 验证方式：fixture 与 Repository 测试确认四个 scope 返回空结果，国家详情保留
  `BO-NATIONAL` 来源；入口恢复后再经治理发布。

### ADR-097：尼日利亚 S.I. No. 20, 2011 道路重型限值按可辨识字段发布

- 状态：Accepted
- 日期：2026-08-09
- 决策：NGA 以 NESREA 官方扫描件建立 `S.I. No. 20, 2011` effective regulation；
  2015-01-01 起对总质量超过 3.5 吨的新道路车型发布 CO 2.1、HC 0.66、NOx 5.0
  g/kWh，并映射到卡车和客车。工程与农业保持 no-data。
- 理由：Regulations 17(2)、18 和 Schedule VIII item 1 可以直接读回生效边界、道路
  scope、质量条件和三项数值；PM 单元格扫描为含义不明的 `0.100.13`，不能猜测为
  单一数值，也不能用 Schedule VII 或同页其他车型行替代。
- 来源：NESREA 法规目录与其链接的 Federal Republic of Nigeria Official Gazette
  No. 47（2011-05-17）扫描件，S.I. No. 20, 2011，B615–B635。
- 验证方式：Repository 测试确认 2015-01-01 起卡车/客车各返回 CO/HC/NOx 三项且
  来源可追溯，PM 不存在，construction/agriculture 返回空；定向治理发布执行同一
  聚焦验收。

### ADR-098：来源边界国家允许定向发布并强制验收 no-data

- 状态：Accepted
- 日期：2026-08-09
- 决策：`--country=ISO3` 定向治理发布既支持含法规/限值的国家，也支持只有官方来源、
  country jurisdiction 与成员关系的来源边界国家。后者发布来源、辖区、成员关系和
  `covered` 状态，不创建 regulation/limit，并在发布后查询卡车、客车、工程和农业四个
  scope，任一返回法规即失败。
- 理由：EGY、GHA、ISR 已完成官方入口核验，但没有可发布的重型柴油限值表。此前定向
  脚本强制要求至少一条法规和限值，导致这些合法 `no-data` 边界只能随全量批次发布，
  又会被其他国家尚未到达的核验时间阻断。来源覆盖与法规事实覆盖必须保持两个层次。
- 后果：国家显示 `covered` 仅表示官方来源边界已登记，不表示四个 scope 均有法规数值；
  UI 和 AI 仍以法规查询的 `no-data` 为权威。定向模式不归档生产库中可能存在的旧法规，
  因此聚焦验收会在旧法规仍可见时失败并要求人工治理纠正。
- 验证方式：纯函数测试覆盖 NGA 完整法规图和 EGY/GHA/ISR 空法规图；定向发布后检查
  目标来源/辖区/成员关系/覆盖状态，并验证四个 scope 均为空。
- 2026-08-09 修正：定向发布最初仍遍历 24 条全局市场 fixture；虽为幂等 upsert，仍
  违反单国范围。现由纯函数在存在 `--country` 时返回空市场集合，并以回归测试锁定；
  全量模式与 `--market-only` 模式继续发布全部签核市场观测。

### ADR-099：零配置作品 Demo 复用正式证据链

- 状态：Accepted
- 日期：2026-08-09
- 决策：增加 `pnpm demo`，只允许在
  `NODE_ENV=development + DATABASE_MODE=pglite-demo + PORTFOLIO_DEMO_MODE=true`
  下启动。运行时从真实 Migration 创建进程内数据库、写入显式虚构 fixture，并由
  确定性离线模型选择已有 Zod 只读工具；不为演示另建绕过 service、Repository、
  citation 或证据失败关闭的捷径。
- 理由：招聘方需要无需 PostgreSQL、Docker 或模型 Key 即可复现核心工作流，同时
  演示不能暗示外部模型或业务生产基础设施已经就绪。
- 安全边界：启动脚本只绑定 loopback；不读取开发者数据库/模型凭据；production
  或 postgres 组合失败关闭。所有 fixture 继续显示 Demo 标识，不能与已核验事实混淆。
- 后果：离线回答措辞是确定性演示文本，不代表模型质量；生产仍强制 PostgreSQL，
  正式模型、身份、对象存储、备份与监控门不因该入口而解除。
- 验证方式：单元测试覆盖运行模式拒绝条件和三类工具路由；浏览器验收确认结构化
  来源卡片、Demo 标识与证据缺口逻辑；CI 继续运行全套质量门。

### ADR-100：五国在用车、燃油政策与固定源材料不升级为发动机法规

- 状态：Accepted
- 日期：2026-08-09
- 决策：PAK、QAT、KWT、OMN、JOR 分别建立 `PK-NATIONAL`、`QA-NATIONAL`、
  `KW-NATIONAL`、`OM-NATIONAL`、`JO-NATIONAL` 官方来源边界，但不创建道路或
  非道路 effective regulation；四个 scope 均保持显式 no-data。
- 理由：PAK 与 KWT 的可读数值属于怠速/自由加速烟度及车辆注册或定期检查；QAT
  是 2023 款公交/卡车的 EURO5-equivalent 清洁柴油政策公告；OMN MD 118/2004 明确
  只覆盖固定源；JOR 环境部行动计划明确尚未对新车采用强制排放标准。上述材料均不同时
  满足新重型发动机适用对象、认证试验循环、完整限值表和国内实施日期。
- 模型边界：当前法规查询没有车辆状态、年检工况或燃油规格维度。把 m⁻¹ 烟度、怠速
  CO、燃油硫含量或固定源排放写入 g/kWh 型式认证路径会产生错误 product-fit 结论；
  若未来增加在用车检测或燃油产品域，须另建 schema、迁移与验收，不复用现有法规行。
- 验证方式：fixture 与 Repository 测试确认五国详情均可追溯到精确官方页面，同时
  卡车、客车、工程和农业查询全部为空；治理发布沿用来源边界国家的聚焦 no-data 验收。

### ADR-101：斯里兰卡发布公报表格，其余三国保留来源边界

- 状态：Accepted
- 日期：2026-08-09
- 决策：KHM、LAO、MNG 用精确法规/法律页面替换主管部门门户，但不创建 effective
  regulation；LKA 以 Gazette 2079/42 Third Schedule Tables 5–6 创建一条法规，从
  2018-08-06 合并边界映射到道路卡车、道路客车和工程机械，农业保持 no-data。
- 理由：柬埔寨 Prakas 只证明 UN R49 标准入口，未给修订系列与数值表；Sub-Decree
  No. 42 是移动源黑烟检查。老挝《内陆车辆法》和进口措施要求环境合规，但把具体标准
  留给另行规定；交通部可见黑烟表是道路项目附件对国家环境标准的摘录。蒙古两份现行
  文书只引用 MNS 5014，公开目录没有标准正文或型式批准映射。三者均不足以填入新重型
  发动机模型。斯里兰卡公报则直接给出适用对象、测试循环、功率带和完整数值。
- 替代路径：Gazette 2083/3 把条文改为 Third Schedule **or** Fifth Schedule。本库只
  保存 Third Schedule 代表路径，不能把两套数值叠加为累计要求；若用户需要日本循环
  路径，应另建明确的替代路径模型。
- 日期与 scope：2079/42 发布于 2018-07-12，2083/3 于 2018-08-06 形成当前替代路径
  结构；为避免宣称更早的合并状态，fixture 从 2018-08-06 起算。Table 6 标题仅为
  construction-equipment vehicles，不外推到 agriculture。
- 验证方式：Repository 测试锁定道路 5 项限值、工程六个半开功率带各 4 项限值、
  2018-08-06 时点切换、34 条 fixture 限值总数、来源追溯及农业空结果；三国来源边界
  继续强制四 scope 空结果。

### ADR-102：阿尔及利亚发布车辆级一致性限值，三国保留精确 no-data

- 状态：Accepted
- 日期：2026-08-09
- 决策：CRI、ECU、DOM 用精确法律/技术法规替换主管部门门户，但四个 scope 不创建
  effective regulation；DZA 以 Executive Decree 03-410 Articles 3–4 创建一条
  车辆级一致性法规，覆盖道路卡车、道路客车、工程机械和农业车辆。
- 理由：Costa Rica 39724 的新入境条款只明确到不超过 3,500 kg 的轻型货车，且
  Law 9078 排除农业/工业/工程机械；Ecuador RTE 017 把柴油数值引用到未公开的
  NTE INEN 2207，并明确排除工程/农业设备；Dominican Republic 2017 技术法规的
  目标和控制程序都是在用车辆。三者都不能在当前新重型法规模型中安全发布限值。
  Algeria 03-410 则在表头直接区分一致性控制和定期检查，并给出四类应用的完整数值。
- 数据语义：DZA 数值保留原始车辆级 `g/km` 与烟度 `m-1`，不得改写为 `g/kWh`
  或 Euro 等级。Article 6 将测试方法留给联合部令，因此 `testCycleCode` 为空且
  `measurementBasis` 显示方法缺口。农业法定区间 `(37,75]`、`(75,130]`、`>130`
  按 numeric(12,3) 分辨率编码为 `[37.001,75.001)`、`[75.001,130.001)`、
  `[130.001,+∞)`，并在记录中公开该近似。
- 排除规则：DOM Table 9 的 Euro II/IV 等效 g/km 表仍不进入 fixture，因为法规
  Article 1 明确是车辆在用状态；CRI 在用车烟度与 ECU 的未取得付费标准数值同样
  不因“存在数字/标准号”而升级。DZA 的定期检查 2.5/3.0 m⁻¹ 也不与一致性烟度混合。
- 验证方式：Repository 测试锁定 DZA 四 scope 各 5 条代表性查询、28 条 fixture
  总数、道路 PM 差异、农业端点和官方来源追溯；CRI/ECU/DOM 继续强制四 scope 空结果。

### ADR-103：突尼斯以精确官方目录证明 no-data 边界

- 状态：Accepted
- 日期：2026-08-10
- 决策：TUN 保留 `TN-NATIONAL` country jurisdiction，将两个主管部门首页替换为
  环境部“污染与危害防治”法规分类和交通部“道路运输法律法规”目录，不创建道路或
  非道路 effective regulation；四个 scope 均保持显式 no-data。
- 理由：环境部分类页只列出车辆定点噪声检查等条目，交通部目录列出的文书涉及运输
  经营、许可、车辆使用和行业组织。两个官方目录均未提供重型柴油新发动机适用对象、
  认证试验循环、污染物限值表和实施日期，不能从区域 Euro 背景推断国内有效法规。
- 日期语义：fixture 与治理签核时间使用 2026-08-09T19:33:51Z 的实际读取时刻；
  membership `validFrom=2026-08-09` 只表示来源边界核验日期，不是排放法规生效日期。
- 验证方式：Repository 测试确认四个 scope 返回空结果，国家详情返回两个精确来源；
  fixture 测试锁定来源标题、URL 和真实核验时间，定向发布继续执行 no-data 验收。

### ADR-104：ETH/URY 发布重型道路表，GTM/HND/PAN 保留法规边界

- 状态：Accepted
- 日期：2026-08-10
- 决策：ETH 以 Directive No. 1051/2025 与 ES 6725:2022 Part 1 Table 1 创建
  `on-road-truck` effective regulation，只保存 N2/N3 的 CO、NOx、PM 三项；URY 以
  Decreto 135/021 Article 48/Table 17 创建 `on-road-truck` 与 `on-road-bus`
  effective regulation，分别保存 ESC 五项和 ETC 四项。GTM、HND、PAN 更新为精确
  官方来源，但不创建 effective regulation。
- 理由：ETH Table 1 对 N2/N3 新柴油车给出可读回数值和 ISO 16183:2002 方法，
  Directive 明确把标准纳入控制并规定网站发布生效；URY Table 14/17 明确 M2/M3、
  N2/N3、零公里压燃式车辆、质量阈值、循环和数值，官方 homologation procedure
  提供实施链。相反，GTM 官方报告把国家法规列为 2027 计划，HND 只授权后续制定且
  固定源法规明文排除车辆，PAN 是年度检验/在用车控制，均不满足新重型发动机模型。
- 歧义与排除：ETH 的 0.46 列同时标为 `HC+NOx` 且同表另有 NOx 列，不创建无法证明
  pollutant identity 的记录；也不把 N2/N3 数值外推到 M2/M3 或非道路。URY ESC、ETC
  作为不同测试路径保存，construction/agriculture 不从 Article 52 的未来授权外推。
  PAN 的烟度阈值、GTM 的 15 ppm 柴油和 HND 的固定源数值均不进入 engine limits。
- 日期语义：ETH 使用官方目录发布日 2026-07-25；URY 使用首版官方 homologation
  procedure 生效日 2023-05-14。五国 fixture 与治理签核时间统一为实际读取时刻
  2026-08-10T03:14:01Z；无未来占位时间。
- 验证方式：Repository 测试锁定 ETH `0→3` 时点切换、三项数值与其他 scope 空结果；
  URY `0→9` 时点切换、卡车/客车各九项、18 条 fixture 总数与非道路空结果；三国
  no-data 测试锁定精确 URL。定向治理发布对 ETH/URY 增加聚焦数值验收。

### ADR-105：BWA/NAM/TZA 保留精确 no-data，UGA 发布有效法规但拒绝修正矛盾表

- 状态：Accepted
- 日期：2026-08-10
- 决策：BWA、NAM、TZA 用精确的标准/法规入口替换主管部门首页，四个 scope 不创建
  effective limit。UGA 创建 S.I. No. 22 of 2024 effective regulation 元数据，采用
  2024-04-26 公报补编日期为 `effectiveFrom`，但不创建任何 numeric limit。
- 理由：BWA BOS 134 明示 voluntary 且属于在用车排放测量；NAM MWT/NSI 入口只证明
  监管与标准化职责；TZA NEMC 副本的 Government Notice、发布日期和签署日期留空，
  Regulation 12 又是车主/驾驶人运行合规，TBS 后续文书明确为 draft。UGA 则有完整
  法规权力、制定日、公报日和进出口/运行适用条款，因此法规身份可发布。
- UGA 歧义：Schedule 4 原版重型表头在视觉上印为 `kg/kWh`；“GVW”行把 C/CE 与
  `≤750 kg` 组合，和随后 C `>3,500 kg`、CE 拖车 `>750 kg` 的定义冲突；标题包含
  F/G，正文却没有能独立映射的 F/G 数值行。UNBS 官方页只公开 US EAS 1047:2022
  的 compulsory 元数据，未公开可证明勘误的数值正文。
- 数据语义：有效法规与可用限值是两个独立事实。`UG-NATIONAL` 可为 `covered` 并含
  effective regulation，同时四个应用 scope 仍返回 `no-data`。不得依据 Euro IV
  数值相似性把 `kg/kWh` 修正为 `g/kWh`，也不得把类别冲突静默归一化。治理 payload
  仅在 `limitsUnavailable=true`、零 limits 且 summary 已解释来源冲突时允许发布；含
  数值行时该标志必须为 false，未显式签核的空限值法规继续失败关闭。
- 日期语义：四国 fixture 与治理签核统一使用实际核验时刻
  `2026-08-10T03:42:07Z`；BWA/NAM/TZA membership 日期仍仅表示来源边界核验日，
  UGA membership 使用法规生效日 `2024-04-26`。
- 验证方式：Repository 测试强制四国四 scope 空结果，锁定八个精确 URL；UGA 另断言
  regulation 的 adopted/effective/status、零 limit、NEMA/UNBS 来源和真实核验时间。
  定向治理验收以“零 limit”而非“零 regulation”识别 no-data 图，覆盖有效但不可安全
  数值化的法规。

### ADR-106：ZMB/ZWE/RWA/CIV 升级精确法规边界但不拼接不完整表

- 状态：Accepted
- 日期：2026-08-10
- 决策：ZMB、ZWE、RWA、CIV 均用精确法规、标准或主管机关执法页面替换通用主页，
  四个 scope 保持 no-data，不创建 effective regulation 或 numeric limit。
- 理由：ZMB S.I. 112/2013 Regulation 5(2) 明确面向 `plant, undertaking or process`，
  RTSA 法案只授权道路烟雾/车辆适用性管理；ZWE EMA 页面明确面向商业设施备用发电机，
  S.I. 129/2015 §79 又只要求道路车辆符合另行的 SAZ standards，而公开公报没有数值表。
  RWA RSB 目录和 Gazette 证明 RS EAS 1047:2022 的车辆范围与替代关系，但完整正文为
  付费标准；公开强制执行材料是周期性在用车检查。CIV 官方材料证明 Décret 2017-125
  适用于燃烧发动机机械/交通工具，现有可读摘录却没有完整车辆表，NI 505:2025 明确
  属于周期性机动车技术检查。
- 证据边界：标准存在、文书有效、或在用车检查强制，不等于已证明新重型柴油发动机
  的完整型式认证数值。不得把 ZMB 固定源 `mg/Nm3`、ZWE 未读回 SAZ 表、RWA 的
  “Euro 4 equivalent”描述/邻国 EAS 文本，或 CIV 的环境空气与在用车数字拼接成限值。
  ZWE 车辆公报使用 Veritas 法律镜像，并由 ZRP 对 S.I. 129/2015 的现行引用交叉确认；
  数据源元数据必须显式标记镜像身份，不冒充政府托管 URL。
- 日期语义：四国 membership 的 `2026-08-10` 仅表示来源边界核验日；fixture 与治理
  签核统一使用实际读取时刻 `2026-08-10T04:06:07Z`，不再保留未来占位时间。
- 验证方式：Repository 测试对四国、四 scope、150 kW 强制空结果，并锁定八个精确
  来源 URL；fixture 元数据测试锁定来源类型、发布日期和统一真实核验时间。四次定向
  治理发布后必须读回 `covered`、精确来源链与四 scope no-data。

### ADR-107：CMR/SEN/MOZ/SWZ 区分在用车、移动源管理、适行性与草案

- 状态：Accepted
- 日期：2026-08-10
- 决策：CMR、SEN、MOZ、SWZ 用八个精确官方标准、法规或主管机关页面替换通用主页；
  四个 scope 保持 no-data，不创建 effective regulation 或 numeric limit。
- 理由：CMR NC 2858:2021 的汽车条款针对在用车且柴油吸收系数单位原印不完整；SEN
  Road Code Annex G 只有车辆烟度/浓度控制，ASN 目录又不公开标准正文；MOZ SIBMOZ
  确认 Decree 18/2004 覆盖移动源，但当前官方附件只读回 67/2010 修正案，Decree
  44/2017 车型审批条目没有排放表；SWZ 空气条例面向环境空气及场所排放，交通部门
  是适行性检测，SWASA vehicle homologation 仍为 draft stage 04.00。
- 证据边界：车辆可被检查、移动源受环境法管理、存在车型审批框架或标准草案，都不
  证明本系统所需的新重型柴油发动机污染物表、功基准单位、测试循环和实施日期。不得
  修正 CMR 原印单位、把 SEN 25% 烟度换算成 g/kWh、从非官方 MOZ 转录拼表，或把
  SWZ 环境空气目标/草案标为 effective。
- 日期语义：四国 membership 的 `2026-08-10` 仅表示来源边界核验日；fixture 与治理
  签核统一使用实际读取时刻 `2026-08-10T04:26:52Z`。
- 验证方式：Repository 测试对四国、四 scope、150 kW 强制空结果并锁定八个精确
  来源 URL；fixture 元数据测试锁定来源类型、发布日期和统一真实核验时间。四次定向
  治理发布后必须读回 `covered`、精确来源链与四 scope no-data。

### ADR-108：LSO/MDG/MUS/MWI 区分适行性、烟度法令身份、在用车执法与定性道路义务

- 状态：Accepted
- 日期：2026-08-10
- 决策：LSO、MDG、MUS、MWI 用八个精确政府服务、政策、法律清单、法规目录或正文
  页面替换通用主页；四个 scope 保持 no-data，不创建 effective regulation 或 numeric
  limit。
- 理由：LSO 政府服务只证明重型商用车/客车需要适行性办理，2006 政策中的 Road
  Traffic Bill 与 draft regulations 当时仍待立法；MDG 的 2025 官方 EIA 只列出
  Arrêté 6941/2000 汽车尾气烟度法令身份，CNLEGIS 未返回该 2000 原文；MUS 的现行
  材料是车辆烟度计执法和排气测试法规目录；MWI Act §108 与 Regulation 97 只有公共
  道路烟雾/滋扰的定性运行义务。
- 证据边界：适行性服务、法规标题、在用车不透光度分档和“良好状态不应产生烟雾”均
  不证明本模型要求的新重型柴油发动机污染物表、功基准单位、测试循环与实施边界。
  不得把 LSO 旧草案标为 effective，不得从 MDG 同号异文/二手转录补表，不得把 MUS
  50%/70% 烟度换算为 g/kWh，也不得把 MWI 定性条款外推到非道路机械。
- 日期语义：四国 membership 的 `2026-08-10` 仅表示来源边界核验日；fixture 与治理
  签核统一使用实际读取时刻 `2026-08-10T04:44:14Z`，替换原未来占位时间。
- 验证方式：Repository 测试对四国、四 scope、150 kW 强制空结果并锁定八个精确
  URL；fixture 元数据测试锁定来源类型、发布日期和统一真实核验时间。四次定向治理
  发布后必须读回 `covered`、精确来源链与四 scope no-data。

### ADR-109：FJI/BLZ/BRN/BTN 不把进口等效、授权条款或在用车烟度升级为发动机限值

- 状态：Accepted
- 日期：2026-08-10
- 决策：FJI、BLZ、BRN、BTN 用八个精确官方法规、标准、检查公告或实施通知替换通用
  门户；四个 scope 保持 no-data，不创建 effective regulation 或 numeric limit。
- 理由：FJI FRCS 2025-04 法律解释指南与 2026 公告依据 Customs Regulations 用
  Euro 4 管理新车及二手/翻新重型货车、客车和牵引车进口；BLZ regulations 25–26
  把机动车具体 levels/procedures 和污染物数量留给部长另行规定；BRN regulation 33A
  是定性道路排放义务，`<50% HSU` 属于适行性检查；
  BTN Environment Standards 2020 按车辆注册日期使用 `%CO/%HSU`，RSTRR 2026 通知只
  证明现行规则生效，不提供完整发动机表。
- 证据边界：进口合规路径/Euro 标签、法规授权、车辆烟度阈值或 Euro 6/BS VI 标签均
  不能替代本系统需要的新重型柴油发动机分类、功基准单位、测试循环和完整污染物表。
  不得从 Euro 4 进口标签复制斐济国内数值，不得补写伯利兹尚未读回的部长规定，不得把 HSU/Bosch
  值换算为 g/kWh，也不得将道路在用车要求外推到工程或农业机械。
- 日期语义：四国 membership 的 `2026-08-10` 仅表示来源边界核验日；fixture 与治理
  签核统一使用实际读取时刻 `2026-08-10T05:06:30Z`，替换原未来占位时间。
- 验证方式：Repository 测试对四国、四 scope、150 kW 强制空结果并锁定八个精确
  URL；fixture 元数据测试锁定来源类型、发布日期和统一真实核验时间。四次定向治理
  发布后必须读回 `covered`、精确来源链与四 scope no-data。

### ADR-110：CAF/COD/COG/CUB 区分项目缓解、一般空气义务与在用车技术检验

- 状态：Accepted
- 日期：2026-08-10
- 决策：CAF、COD、COG、CUB 用八个精确政府项目文件、法律、部长令、公报或官方
  实施材料替换通用门户；四个 scope 保持 no-data，不创建 effective regulation 或
  numeric limit。
- 理由：CAF 卫生部项目文件只要求通过发动机/喷油系统/空气滤清器维护减少施工柴油
  烟雾，交通部官网仍在建设；COD Law 11/009 把空气数值留给后续法令，Order 085/2025
  是在用车周期技术检验；COG Law 33-2023 是定性烟雾/有毒气体禁令和周期检查授权，
  Decree 2019-171 是道路适行性检查；CUB Law 109 及补充规则检查 CO 或柴油尾气
  不透光度，但参数仍引用另行规范、制造商要求和交通部规定。
- 证据边界：项目施工缓解、一般空气排放禁止、车辆/机械被纳入周期检查、尾气或不透
  光度作为检查项，都不证明本系统所需的新重型发动机分类、功基准单位、认证循环和
  完整污染物表。不得采用二手研究转录的古巴 Resolution 172/2001 数值，不得把
  COD/COG 技术检验或 CAF 项目要求外推到型式认证，也不得从区域/邻国规则补表。
- 日期语义：四国 membership 的 `2026-08-10` 仅表示来源边界核验日；fixture 与治理
  签核统一使用实际读取时刻 `2026-08-10T05:38:27Z`，替换原未来占位时间。
- 验证方式：Repository 测试对四国、四 scope、150 kW 强制空结果并锁定八个精确
  URL；fixture 元数据测试锁定来源类型、发布日期和统一真实核验时间。四次定向治理
  发布后必须读回 `covered`、精确来源链与四 scope no-data。

### ADR-111：DJI/ERI/GAB/GIN 不把委托标准与车辆技术检验升级为发动机限值

- 状态：Accepted
- 日期：2026-08-10
- 决策：DJI、ERI、GAB、GIN 用八个精确法律、公报、车辆技术检验令或主管部门材料
  替换通用门户；四个 scope 保持 no-data，不创建 effective regulation 或 numeric limit。
- 理由：DJI 官方公报只把尾气/烟度纳入周期与进口二手车检查；ERI Legal Notice
  No. 127/2017 委托适用排放标准，政府材料只确认车辆/卡车年度检查；GAB Law
  No. 007/2014 把污染阈值留给实施规章，Order No. 1823/MTACT 是适行性周期检查；
  GIN Environmental Code Articles 65–66 同样把具体限值留给规章，交通部页面只确认
  技术检验数字化。
- 证据边界：一般空气义务、标准委托、车辆被纳入检查、尾气/烟度作为检查项，都不
  证明本系统所需的新重型发动机类别、功基准单位、完整污染物表和认证循环。不得用
  在用车烟度、定性烟雾义务或未读回的后续标准补建 engine type-approval 数据。
- 日期语义：四国 membership 的 `2026-08-10` 仅表示来源边界核验日；fixture 与治理
  签核统一使用实际读取时刻 `2026-08-10T06:21:10Z`，替换原未来占位时间。
- 验证方式：Repository 测试对四国、四 scope、150 kW 强制空结果并锁定八个精确
  URL；fixture 元数据测试锁定来源类型、发布日期和统一真实核验时间。四次定向治理
  发布后必须读回 `covered`、精确来源链与四 scope no-data。

### ADR-112：GMB/GNB/GNQ/GRL 区分环境空气、法律授权、在用车检查与发动机认证

- 状态：Accepted
- 日期：2026-08-10
- 决策：GMB、GNB、GNQ、GRL 用八个精确法规、公报、政府检查材料或现行法律入口
  替换通用门户；四个 scope 保持 no-data，不创建 effective regulation 或 numeric limit。
- 理由：GMB 1999 Regulations 的数值是环境空气浓度，2022 内阁车辆检验方案仍要求
  磋商；GNB Law No. 1/2011 把有害空气排放交由专门立法，当前交通部页面只确认职责；
  GNQ 政府材料只确认 Law No. 7/2003 和 ITV 污染控制，且 2025 材料明确重型诊断线
  未运行、检查当时为目视；GRL 1979 No. 141 车辆设备令虽仍现行，Road Traffic Act
  No. 995/2009 也只提供车辆状态、检查和定性烟气义务。
- 证据边界：环境空气 `µg/m³`、一般法律授权、机构职责、内阁审议方案、目视/在用车
  检查或定性烟气条款，都不证明本系统所需的新重型发动机类别、功基准单位、完整
  污染物表和认证循环。不得换算环境浓度，不得把审议方案标为 effective，也不得从
  丹麦/EU 规则补写格陵兰数据。
- 日期语义：四国 membership 的 `2026-08-10` 仅表示来源边界核验日；fixture 与治理
  签核统一使用实际读取时刻 `2026-08-10T06:44:56Z`，替换原未来占位时间。
- 验证方式：Repository 测试对四国、四 scope、150 kW 强制空结果并锁定八个精确
  URL；fixture 元数据测试锁定来源类型、发布日期和统一真实核验时间。四次定向治理
  发布后必须读回 `covered`、精确来源链与四 scope no-data。

### ADR-113：GUY/HTI/IRN/IRQ 不把后续标准、进口检查或不完整日程表补成发动机限值

- 状态：Accepted
- 日期：2026-08-10
- 决策：GUY、HTI、IRN、IRQ 用八个精确法规汇编、政府材料、公开法律文本记录和
  官方法规/空气质量页面替换通用门户；四个 scope 保持 no-data，不创建 effective
  regulation 或 numeric limit。
- 理由：GUY Air Quality Regulations 把机动车排放标准交给 EPA 后续建立，车辆法
  只提供适行证和烟雾规则授权；HTI 材料分别是一般环境框架与二手车辆/机械进口前
  技术检查；IRN Clean Air Law 委托标准并要求检查，2024 修订的公开记录未显示核心
  日程表；IRQ 环境部目录和空气质量页只证明一般环境法规、环境空气/活动排放以及
  车辆尾气监测协作。
- 证据边界：后续标准授权、车辆适行性或进口检查、Euro 标签、不可读表格、环境空气/
  企业排放制度和监测职责，都不证明本系统所需的新重型发动机类别、功基准单位、完整
  污染物表和认证循环。不得借用 EU 数值，不得把检查值或环境浓度换算成 `g/kWh`。
- 日期语义：四国 membership 的 `2026-08-10` 仅表示来源边界核验日；fixture 与治理
  签核统一使用实际读取时刻 `2026-08-10T07:34:48Z`，替换原未来占位时间。
- 验证方式：Repository 测试对四国、四 scope、150 kW 强制空结果并锁定八个精确
  URL；fixture 元数据测试锁定来源类型、发布日期和统一真实核验时间。四次定向治理
  发布后必须读回 `covered`、精确来源链与四 scope no-data。

### ADR-114：JAM/LBN/LBR/LBY 不把旧车型车辆表、标准委托或检查授权泛化为新发动机限值

- 状态：Accepted
- 日期：2026-08-10
- 决策：JAM、LBN、LBR、LBY 用八个精确现行条例、法律、主管部门实施/政策页或交通
  公告替换通用门户；四个 scope 保持 no-data，不创建 effective regulation 或 numeric limit。
- 理由：JAM Road Traffic Regulations 2022 虽有 imported heavy-duty vehicle/bus
  数值，但只覆盖 1991–1998 model years，后续进口又依赖原属地在用标准且没有完整
  发动机认证循环；LBN Law 444 Article 24 只委托国家环境质量标准，交通页是排放画像
  和减缓措施；LBR EPML Sections 36、70 委托 EPA 建立移动源标准与检查/许可制度，
  交通公告没有公开表格；LBY Law No. 15 与 Road Traffic Law No. 11/1984 只建立
  发动机/燃料测试、许可和车辆技术检查框架。
- 证据边界：旧车型车辆/客车表、进口或在用车检查、一般标准委托、政策措施、法规汇编
  公告和检查授权，都不证明本系统所需的当前新重型发动机完整分类、功基准、污染物表与
  认证循环。不得忽略 model year 泛化 JAM 数值，不得补写未读回的后续标准或换算检查值。
- 日期语义：四国 membership 的 `2026-08-10` 仅表示来源边界核验日；fixture 与治理
  签核统一使用实际读取时刻 `2026-08-10T07:58:42Z`，替换原未来占位时间。
- 验证方式：Repository 测试对四国、四 scope、150 kW 强制空结果并锁定八个精确
  URL；fixture 元数据测试锁定来源类型、发布日期和统一真实核验时间。四次定向治理
  发布后必须读回 `covered`、精确来源链与四 scope no-data。

### ADR-115：MLI/MMR/MRT/NCL 区分在用车烟度、固定源、框架法与环境空气标准

- 状态：Accepted
- 日期：2026-08-10
- 决策：MLI、MMR、MRT、NCL 用八个精确官方法规、指南、检查表或主管部门页面替换
  通用门户；四个 scope 保持 no-data，不创建 effective regulation 或 numeric limit。
- 理由：MLI `Arrêté 2020-1080` 和 `00-2797` 只建立车辆技术检验及定性烟气违法；MMR
  Notification 615/2015 的数值属于 EIA 项目/固定热力源，MOTC `<50% Bosch unit` 属于
  整车检查；MRT Law 2018-002 与 Environment Code 虽覆盖车辆和发动机，却把具体技术、
  环境与排放要求留给实施文本；NCL Deliberation 219/2017 是环境空气监测框架，DITTT
  页面只规定客运和 >3.5 t 车辆检查周期。
- 证据边界：尾气/不透光度年检、定性烟气义务、固定源或项目排放值、后续实施标准授权、
  环境空气参考值和检查周期，都不证明本系统所需的新重型发动机完整分类、功基准单位、
  污染物表和认证循环。不得将这些值换算成 `g/kWh`，也不得把法国/EU 规则外推至 NCL。
- 日期语义：四国 membership 的 `2026-08-10` 仅表示来源边界核验日；fixture 与治理
  签核统一使用实际读取时刻 `2026-08-10T08:31:37Z`，替换原未来占位时间。
- 验证方式：Repository 测试对四国、四 scope、150 kW 强制空结果并锁定八个精确
  URL；fixture 元数据测试锁定来源类型、发布日期和统一真实核验时间。四次定向治理
  发布后必须读回 `covered`、精确来源链与四 scope no-data。

### ADR-116：NER/NIC/PRI 保持检查边界，PNG 只发布重型卡车 ADR 80/03 代表路径

- 状态：Accepted
- 日期：2026-08-10
- 决策：NER、NIC、PRI 用六份精确官方法律、法规或政策文本替换通用门户，四个 scope
  保持 no-data；PNG 用 RTA Vehicle Standards and Compliance Rule 建立一个 effective
  `on-road-truck` regulation，并只发布 ADR 80/03 代表路径 8 条限值。
- 理由：NER Law 98-56 只委托后续车辆技术标准；NIC Decree 32-97 的 60%–80%
  opacity 值按在用/进口、新旧、重量和涡轮状态区分，Law 431 只建立检查证书制度；
  PRI Regulation 5300 的 20% opacity 是静止车辆可见烟度，Regulation 9526 是周期检查。
  PNG Rule Section 6A(4)(b) 则明确要求 GVW >4,500 kg、2012 年起制造的柴油 motor truck
  满足 ADR 80/03、Euro V、Japan 05 或 US 2004 任一替代标准，Section 64B 又要求进口认证。
- 代表路径语义：PNG 选 ADR 80/03 只是可查询的单一代表路径，数值追溯至澳大利亚政府
  diesel HDV 表；不得与 Euro V、Japan 05、US 2004 叠加。Rule 没有同等重型 omnibus、
  construction 或 agriculture 条款，所以这三个 scope 保持 no-data。当前 schema 没有
  vehicle manufacture year，故 regulation summary 与每条 measurement basis 必须显式保留
  `manufactured on or after 2012` 边界，不得向旧车泛化。
- 日期语义：PNG Rule 扫描件 2018-11-30 签署，RTA 公告明确修订版 2019-01-01 生效；
  四国 membership 只从 2026-08-10 实际来源核验日起登记。所有新记录统一使用
  `2026-08-10T09:11:38Z`，替换未来占位时间。
- 验证方式：Repository 测试锁定 PNG 2018-12-31 无结果、2019-01-01 起卡车 ESC/ETC
  8 条、其他三 scope 无结果及完整来源链；NER/NIC/PRI 四 scope 强制 no-data；元数据测试
  锁定来源身份和实际核验时间。四次定向治理发布后必须逐国读回目标图、`covered`、来源链
  与 scope 结果。

### ADR-117：PRK/PRY/PSE/SDN 不把一般标准授权、车辆检查或交通政策补成发动机限值

- 状态：Accepted
- 日期：2026-08-10
- 决策：PRK、PRY、PSE、SDN 用八个精确法律、实施令、规范目录或官方国家提交件替换
  通用门户，四个 scope 保持 no-data，不创建 effective regulation 或 numeric limit；同时
  删除 PRK 误指向韩国环境部和国土交通部的来源。
- 理由：PRK/PSE 环境法只委托污染物标准并规定车辆排气义务；PRY Decree 1269/2019
  与规范目录属于移动源、市政及二手进口检查；SDN Environment Protection Law 2001
  只有一般空气义务与后续标准授权，UNFCCC 国家信息通报只是排放背景和减缓措施。
- 证据边界：一般标准授权、整车规范、在用/进口检查、烟雾义务、燃油经济性或公交政策，
  都不证明本系统所需的新重型发动机分类、功基准单位、完整污染物表和认证循环。不得借用
  韩国、邻国、Euro 或其他区域数值，也不得把检查参数换算成 `g/kWh`。
- 日期语义：四国 membership 的 `2026-08-10` 仅表示来源边界核验日；fixture 与治理
  签核统一使用实际读取时刻 `2026-08-10T09:48:06Z`，替换未来占位时间。
- 验证方式：Repository 测试对四国、四 scope、150 kW 强制空结果并锁定八个精确 URL；
  元数据测试锁定来源类型、发布方和统一真实核验时间，并显式防止 PRK 回退到 `.go.kr`。
  四次定向治理发布后必须读回 `covered`、精确来源链与四 scope no-data。

### ADR-118：SLB/SLE/SLV/SOM 区分许可检查、情景假设、在用车烟度与后续标准授权

- 状态：Accepted
- 日期：2026-08-10
- 决策：SLB、SLE、SLV、SOM 用八份精确法律、技术法规、国家战略或 UNFCCC 提交件
  替换 generic 门户占位；四个 scope 保持 no-data，不创建 effective regulation 或
  numeric limit。SSD 仍保留 generic 来源边界，不纳入本次签核。
- 理由：SLB Road Transport Act 只建立重型整车许可分类、登记、检查与安全状态义务，
  NDC 3.0 只有效率车辆与低碳交通 KPI；SLE 官方战略明确不开展 type approval testing，
  Euro IV/V/VI 只是 `proposed` BAU/BTB 情景和空气污染建模假设，EPA Act 只作一般授权；
  SLV RTS 13.01.02:23 是在用道路车辆自由加速 opacity 检查，§2.2 又明确排除农业、工程
  和其他非道路机械；SOM 环境法把空气与车辆排放标准留给后续制定，First BUR 只把高效率
  发动机和 Euro IV–VI 列作未来政策方向。
- 证据边界：整车许可类别、道路/目的地检查、NDC KPI、Euro 情景、在用车 opacity、
  一般禁止义务、后续标准授权和未来政策方向，都不证明本系统所需的新重型发动机分类、
  功基准单位、完整污染物表和认证循环。不得把检查值换算成 `g/kWh`，不得从 Euro 标签
  补写数值，也不得把 SLV 明确排除的工程/农业机械纳入。
- 日期语义：四国 membership 的 `2026-08-10` 仅表示来源边界核验日；fixture 与治理
  签核统一使用实际读取时刻 `2026-08-10T10:20:51Z`，替换未来 generic 占位时间。
- 验证方式：Repository 测试对四国、四 scope、150 kW 强制空结果并锁定八个精确 URL；
  fixture 元数据测试锁定来源身份、发布方和实际核验时间。四次定向治理发布后必须逐国
  读回 `covered`、精确来源链与四 scope no-data。

### ADR-119：SSD/SUR/SYR/TCD 不把一般标准授权、复检设施或气候计划升级为发动机限值

- 状态：Accepted
- 日期：2026-08-10
- 决策：SSD、SUR、SYR、TCD 用八份精确法律、框架法、场所许可条件或 UNFCCC
  官方提交件替换 generic 门户占位；四个 scope 保持 no-data，不创建 effective
  regulation 或 numeric limit。
- 理由：SSD National Bureau of Standards Act 只建立一般标准制定与强制声明程序，
  Second NDC 又把车辆排放标准和尾气检测中心明确列为尚未实施；SUR Milieu Raamwet
  Art. 27 要求另以 `beschikking` 制定污染物标准，S.B. 2019 no. 35 p. 53 只规范机动车
  复检场所的尾气抽排与 CO 测量设施；SYR Law No. 12 of 2012 只有一般环境、EIA 与后续
  标准授权，Art. 24 废止旧环境法，First NDC 只列车辆技术检查和车队更新计划；TCD
  Decree No. 904/PR/PM/MERH/2009 Art. 144 把空气规则留给后续文本，Art. 207 只处理
  噪声，First BUR 仅描述老旧车队、未来减缓措施和国家排放因子缺口。
- 证据边界：一般标准程序、EIA、复检场所设施、在用车技术检查、噪声 homologation、
  气候计划和清单排放因子都不证明本系统所需的新重型发动机分类、功基准单位、完整
  污染物表和认证循环。不得借用 Euro、邻国或区域数值，也不得把检查、噪声或清单参数
  换算成发动机 `g/kWh` 限值。
- 日期语义：四国 membership 的 `2026-08-10` 仅表示来源边界核验日；fixture 与治理
  签核统一使用实际读取时刻 `2026-08-10T10:54:10Z`。
- 验证方式：Repository 测试对四国、四 scope、150 kW 强制空结果并锁定八个精确 URL；
  fixture 元数据测试锁定来源类型、发布方和实际核验时间。四次定向治理发布后必须逐国
  读回 `covered`、精确来源链与四 scope no-data。

### ADR-120：TGO/TLS/TTO 保持法规边界，TWN 只发布全覆盖后的道路代表路径

- 状态：Accepted
- 日期：2026-08-10
- 决策：TGO、TLS、TTO 用六份精确官方法律、实施令或合并法规替换 generic 门户占位，
  四个 scope 保持 no-data，不创建 effective regulation 或 numeric limit。TWN 用环保部
  第五条与重型引擎族审验办法建立 `on-road-truck`、`on-road-bus` effective regulation，
  从 2021-09-01 全覆盖边界为每个道路 scope 保存 WHSC 6 条、WHTC 6 条和 WNTE 4 条；
  `construction`、`agriculture` 保持 no-data。
- 理由：TGO 2026 环境框架修法只委托以后制定阈值，Article 99 是在用流通禁止；道路
  实施令只有静音排气装置、后续跨部令，并从 automobile 定义排除拖拉机、公共工程车辆
  和工业机械。TLS 环境法只要求国家以后发布标准，道路法只有异常烟气禁止、车辆定义、
  车型批准与检查框架。TTO 道路法只有 prescribed emissions 的后续授权和在用车检查，
  Air Pollution Rules Rule 42 又明确排除车辆发动机动力排放。三国均未读回新发动机完整
  分类、功基准、污染物表、认证循环和法定实施日。TWN 第五条则直接给出重型柴油引擎
  WHSC/WHTC/WNTE 完整表，审验办法确认新车型合格证明与重型引擎族认证边界。
- 阶段与代表路径语义：TWN 第六期法定阶段从 2019-09-01 开始，但 2019-08-31 前取得
  合格证明函的既有重型柴油引擎车型可延续至 2021-08-31。当前 schema 没有新/既有引擎族
  维度，故保守使用 2021-09-01 全覆盖边界；该日期不得描述成首次法定实施日。WHSC、
  WHTC、WNTE 是当前选取的欧盟式代表认证路径，不与美国 FTP 替代路径累计，也不得将
  道路表外推到工程或农业机械。
- 证据边界：一般环境标准授权、流通车辆异常烟气/消声器义务、车型登记或周期检查、
  固定源 `mg/Nm³` 表、车辆/机械定义和被明文排除的动力排放，都不构成新发动机限值；
  不得换算在用车或固定源数值，也不得从后续命令、邻国或替代认证路径补值。
- 日期语义：TGO/TLS/TTO membership 的 `2026-08-10` 表示来源边界核验日；TWN 已有
  可查询的有效法规，故 country-jurisdiction membership、regulation `effectiveFrom` 与
  limit `validFrom` 均使用 `2021-09-01` 全覆盖边界，以免关联层阻断历史查询。fixture 与
  治理签核统一使用实际读取时刻 `2026-08-10T11:21:32Z`；该查询边界不改写 2019-09-01
  的法定阶段起始及 2021-08-31 的既有引擎族宽限终点。
- 验证方式：Repository 测试对 TGO/TLS/TTO 四 scope 和 TWN 非道路 scope 强制空结果；
  TWN 锁定 2021-08-31 无代表 fixture、2021-09-01 起卡车/客车各 16 条及 WHSC/WHTC/
  WNTE 数值、单位与来源链。fixture 元数据测试锁定八个精确 URL、发布日期、发布方和
  统一核验时间；四次定向治理发布后必须逐国读回 `covered`、来源链与 scope 结果。

### ADR-121：VEN 发布 MY2000 道路代表路径，VUT/YEM 与特殊地区只发布精确来源边界

- 状态：Accepted
- 日期：2026-08-10
- 决策：VEN 用 Decreto Nº 2.673/1998 和 2015 Ley de Calidad de las Aguas y del Aire
  替换 generic 门户占位，建立自归一化 MY2000 边界 `2000-01-01` 可查询的重型柴油
  道路 regulation；`on-road-truck`、`on-road-bus` 各返回 CO、HC、NOx、PM 四条
  欧洲代表路径限值，`construction`、`agriculture` 保持 no-data。VUT、YEM、ATA、
  ATF、ESH、FLK 用八条精确法律、Bill 或治理边界来源替换门户占位，但四个 scope
  均保持 no-data，不创建 effective regulation 或 numeric limit。
- VEN 限值与路径语义：Decreto Article 7/Table 4 对 MY2000 起、最大整车重量
  >3,500 kg 的柴油道路车辆给出 Directive 91/542/EEC 路径 CO 4.5、HC 1.1、
  NOx 8.0、PM 0.36 g/kWh；最大功率 ≤85 kW 时 PM 乘 1.7，得到 0.612 g/kWh，
  >85 kW 保持 0.36。Article 11 的欧洲与美国重型瞬态测试是替代认证路径，当前只保存
  欧洲代表路径且不得累计；Article 24 明文排除工程、非道路采矿与农业机械。2015 Law
  把具体移动源限值留给 decree，并通过过渡条款在新规章前保留不冲突的既有技术规则。
- VUT/YEM 证据边界：VUT Pollution Act §18 的 `prescribed standards/limit` 未被正文
  填充，§27 仍需后续 regulations；2025 Bill 虽在议会标为 Passed，但公开文本无 Act 号、
  总统 assent 或 Gazette 发布证据，其 commencement 条款又依赖 Gazette。YEM 环境法
  Articles 30–33 只授权以后另发并公报车辆废气/燃料标准，交通法 Articles 14、68(6)
  只有登记、周期检查和浓烟/恶臭定性禁止。官方法库收录不证明战后各控制区执法统一。
- 特殊地区证据边界：ATA Protocol 只建立南极条约体系环境原则、EIA 与缔约方合规；
  ATF Légifrance L640-1–L640-5 只规定环境法典的领土适用和机构替换；ESH 联合国页面
  只证明 NSGT/去殖民化边界；FLK 1986 provisional road regulations 只有消声器、危险/
  不适行车辆检查和驾照/整车分类。不得从缔约国、主权国、邻国、治理实体或一般属地
  关系外推发动机规则，也不得把 EIA、噪声、在用车检查或车辆分类转换成排放限值。
- 五门槛：除 VEN 道路路径外，六个 source-only 条目均未同时读回新重型发动机类别、
  额定功率基准、完整污染物限值表、认证循环和法定实施日，因此四 scope 保持显式
  no-data。`official-regulation` 只描述 source 的文书身份，不表示它已满足发动机规则门槛。
- 日期语义：VEN country-jurisdiction membership、regulation `effectiveFrom` 和 limits
  `validFrom` 均使用 `2000-01-01`，使 MY2000 代表路径可历史查询；VUT/YEM/ATA/ATF/
  ESH/FLK membership 的 `2026-08-10` 只表示精确来源边界核验日。十条 source、记录和
  治理签核的实际读取时刻统一为 `2026-08-10T11:58:54Z`。
- 验证方式：Repository 测试锁定 VEN 在 1999-12-31 无结果、2000-01-01 起卡车/客车
  各四条、85/85.001 kW 的 PM 分支、欧洲/美国路径不累计及两个非道路 scope 空结果；
  VUT/YEM/ATA/ATF/ESH/FLK 对四 scope、150 kW 强制空结果且无 fixture regulation。
  fixture 元数据测试锁定十个精确 URL、来源类型、发布方、发布日期和统一核验时间。

### ADR-122：UKR/THA/NPL 发布有界道路代表路径，MDA 草案保持 no-data

- 状态：Accepted
- 日期：2026-08-10
- 决策：UKR 仅在 `[2016-01-01, 2027-01-01)` 发布 Euro V B2 压燃机道路代表路径，
  truck/bus 各 9 条；THA 自 2024-01-01 发布 TIS 3046-2563 ESC/ELR/ETC 道路代表
  路径，每 scope 9 条；NPL 自 2025-06-23 对 GVW >3,500 kg 压燃式 M/N 车辆发布
  WHSC/WHTC/WNTE 道路路径，每 scope 16 条。三国 construction/agriculture 保持
  no-data。MDA 两条材料均为 draft/consultation，四 scope no-data，不创建 regulation。
- UKR 边界：Law No. 2739-IV 规定 2016-01-01 起 Euro V、2027-01-01 起 Euro VI；
  Order No. 521 Annex 2 item 52 接受 R49-05 B2 / Directive 2005/55 B2 替代路径。
  当前只保存 Directive B2 CI 路径且不累计替代标准。2027-01-01 到达法定 Euro VI
  地板时终止 Euro V；在完整乌克兰 Euro VI 技术实施链发布前后续查询失败关闭，不能
  把 Euro V 延长，也不能直接复制 EU Euro VI 表。
- THA 边界：TIS 3046 的国内 `Level 6` 前言对应 Euro V / UN R49-05，不得写成
  Euro VI。M1/M2/N1/N2 仅在 reference mass >2,610 kg 时进入，加上全部 M3/N3；
  ETC THC 0.55 与 NMHC 0.55 是替代项，本库只保存 NMHC。TIS 787-2551 仅覆盖
  continuous rated power ≤22 kW 小型农业/工业柴油机且只有 Bosch 烟色要求，不能
  为 150 kW construction/agriculture 建立完整法规。
- NPL 边界：Standard 2082 从公报发布日生效，§6(b)/§14 给出 GVW >3,500 kg CI
  M/N 的 WHSC/WHTC/WNTE 完整表；§3 明文排除 tractor、power tiller、dozer、crane、
  roller、excavator 等，因此两个非道路 scope no-data。当前 schema 无 GVW 与
  grandfathering 字段，必须在 regulation summary 与每条 measurement basis 保留该
  重量门槛及发布日前信用证/付款边界，不虚构额定功率分档。
- MDA 边界：2026-07-01 政府公告只是将首个统一 type-approval 法案草案送交议会，
  2026-07-17 Particip.gov.md 条目只是配套决定草案咨询；`government-notice` 描述来源
  身份，不代表 adopted/effective。草案、欧盟衔接与未来配套安排均不能补成发动机限值。
- 日期语义：UKR、MDA、THA、NPL 的实际核验时刻分别为
  `2026-08-10T12:59:02Z`、`2026-08-10T13:04:28Z`、
  `2026-08-10T13:09:56Z`、`2026-08-10T13:22:24Z`。法规 validFrom/validTo 使用
  各自法定或保守查询边界，不以 verifiedAt 代替生效日。
- 验证方式：Repository 测试锁定 UKR 前后端点及 9/9/0/0 scope 结果、THA
  2024-01-01 切换及 9/9/0/0、NPL 2025-06-23 切换及 16/16/0/0，并强制 MDA
  四 scope 空结果；fixture 元数据测试锁定八条精确 URL、发布方、类型、日期与核验时刻。

### ADR-123：西巴尔干只在国内实施链闭合时发布 R49 代表路径

- 状态：Accepted
- 日期：2026-08-10
- 决策：BIH 自 2019-06-01 为 truck/bus 各发布 UN R49/06 WHSC/WHTC 12 条；MNE
  自 2018-10-15 为最大连续额定功率 >15 kW 的 truck/bus 各发布 UN R49 Rev.6
  WHSC/WHTC/WNTE 16 条，schema 用 `15.001 kW` 表达严格下界。ALB、SRB、MKD
  四 scope 保持 no-data；BIH/MNE construction/agriculture 也保持 no-data。
- BIH 理由：2019 minimum requirements decision 明确新 M/N homologation 自
  2019-06-01 采用 R49/06，2010 R49 order 提供国内批准链，UN R49 Rev.6 提供完整
  WHSC/WHTC 数值。M1/M2/N1/N2 需要 reference mass >2,610 kg，M3/N3 全部覆盖。
  R96 仅是窄义 N3 SF mobile crane 替代，不能泛化成 construction，农业也无阶段。
- MNE 理由：国内车辆要求附件纳入 UN R49/06 与 EU 595/2009/582/2011，2018 官方
  公告给出 2018-10-15 新 M/N EURO 6 实施日；当前只保存一条 UN R49 Rev.6 CI
  代表路径，等效 EU/UN 入口不得累计。附件对 T 类只有未分阶段 R96/04 引用，2026
  homologation law 又把 NRMM 表、循环和日期委托未来细则，故非道路 no-data。
- no-data 理由：ALB 的 Law No. 10476 虽复制 Gothenburg Protocol 道路/非道路表，
  义务以议定书对 Albania 生效为前提，而 UN Treaty Collection 未列其为缔约方；进口
  Euro 标签和在用车检查也不补足五门槛。SRB 已读回 R49/06 引用和技术条件，但缺少
  全国全面实施日。MKD 道路与农业批准规则只有 R49/03、指令或 R96 纳入引用，未同时
  给出当前完整表、循环和实施链。不得以候选国身份、邻国日期或通用 UNECE 表补齐。
- 日期语义：ALB/SRB/BIH 使用实际核验时刻 `2026-08-10T13:09:56Z`，MKD/MNE 使用
  `2026-08-10T13:17:36Z`；ALB/SRB/MKD membership 的 `2026-08-10` 只是证据边界，
  BIH/MNE membership 与 regulation/limit 则分别使用国内可查询起点 2019-06-01 和
  2018-10-15。
- 验证方式：Repository 测试锁定 BIH 2019-06-01 前后与 12/12/0/0、MNE
  2018-10-15 前后、15/15.001 kW 和 16/16/0/0；ALB/SRB/MKD 四 scope 强制空结果；
  fixture 元数据测试锁定十二条精确 URL、发布方、来源类型、发布日期和实际核验时刻。

### ADR-124：最终 19 国只在类别、功率、数值、循环和实施链同时闭合时发布代表路径

- 状态：Accepted
- 日期：2026-08-10
- 决策：ARM/BLR/KAZ/KGZ 从 2019-01-01 为 truck/bus 各发布 UN R49-05 B2
  9 条，并为 agriculture 发布 TR CU 031/2012 Stage IIIA 四功率带；GEO
  从 2025-01-01 只为 N3/M3 发布 B2 9/9；UZB 从 2025-10-01 只为
  agriculture H 带发布 3 条；BGD/BOL 分别从 2022-07-26、2022-04-01
  为 >3,500 kg 道路重型车发布 ECE 49 代表路径各 4 条。未列明的 scope
  保持 no-data。AZE/TJK/TKM/AFG/AGO/BDI/BEN/BFA/BHS/MAR/KEN 四 scope
  全部 no-data，不创建 effective regulation。
- 替代路径：B2/C(EEV)、THC/NMHC、条件性 NH3 以及 BOL 美国 HD
  transient 都是替代或附条件路径，不与当前 fixture 累计。GEO 不增加
  PN、柴油 CH4 或旧 >2,610 kg 扩展；BGD/BOL 只保存欧洲代表路径。
- 功率边界：ARM/BLR/KAZ/KGZ 的农业法定范围为 P>19、P≤560 kW，
  schema 以 `[19.001,37)`、`[37,75)`、`[75,130)`、`[130,560.001)`
  保留严格端点；前两带自 2025-01-01、后两带自 2025-10-01 发布。
  UZB 仅对 130≤P≤560 kW 闭合，不将其他功率带、短暂 Stage II 或日期
  未定的 Stage V 推为当前事实。小型拖拉机豁免还需用途条件，不简化为
  单一功率切断。
- 车辆类别：GEO 仅 N3/M3；BGD 仅 GVW >3,500 kg 新 CI 重型车；
  BOL 仅 >3,500 kg、MY2017+ 的 N2/N3/M2/M3。BOL 税则中的 off-road
  dumper 不外推为一般 construction；道路表不外推到 agriculture。
- no-data 红线：MAR 的 2027 homologation / 2028 registration 是未来节点且
  完整附件未公开；AGO 标准化任务、AFG/BHS/TKM 后续标准授权、
  AFG/AGO/BDI/BEN/BFA/KEN 在用车/周期检验以及 KEN 未公开/付费
  KS/EAS 文本均不得升级为新发动机型式认证。AZE 目录元数据、
  TJK 留空草案和 BEN/BFA 缺项整车表也不满足五门槛。
- 日期语义：UZB/KAZ/TJK/KGZ/TKM 统一 verifiedAt
  `2026-08-10T13:40:00Z`；ARM/AZE/GEO/BLR 统一
  `2026-08-10T14:20:51Z`；AFG/AGO/BDI/BEN/BFA/BGD/BHS/BOL/MAR/KEN
  统一 `2026-08-10T14:35:00Z`。verifiedAt 只表示证据读取时刻，不替代
  regulation `effectiveFrom`。
- 共享法域：EAEU membership 按实际入盟日保存，BLR/KAZ/RUS 为
  `2015-01-01`、ARM 为 `2015-01-02`、KGZ 为 `2015-08-12`。治理发布对
  jurisdiction 采用完整替换语义，因此定向发布 shared regional/international
  jurisdiction 时必须携带全部已签核成员及其来源，不能只发送目标国。
- 后果：本地 accepted fixture 和签核可先合并，但不得因为代码中存在
  fixture 就声称目标数据库或公网已发布。本批必须按国完成治理发布、
  目标图/no-data/边界验收和公网 API/页面读回后，才能更新运行库快照。
- 验证方式：Repository 测试锁定道路生效日前后、B2 9/9、BGD/BOL
  4/4、GEO N3/M3、农业四功率端点与 UZB H 带；source-only 国家对四
  scope 强制空结果。fixture 元数据测试锁定 38 条精确 source 记录的
  URL、publisher、type、publishedOn 与三组 verifiedAt。
- 发布结果：2026-08-10 已完成 19 次生产定向发布；公开总表为 175
  `covered` / 0 `no_data`，19 个详情 API/页面与 EAEU 五成员关系均读回通过。

### ADR-125：聊天附件采用服务端提取与按需视觉模型，不信任用户上传内容

- 状态：Accepted
- 日期：2026-08-11
- 决策：聊天入口允许每轮最多四个 PNG/JPEG/WebP、PDF、TXT、Markdown 或 CSV
  附件；单文件解码后最多 3 MiB、合计最多 6 MiB。图片请求使用服务端单独配置的
  `AI_MULTIMODAL_MODEL`，普通文本请求继续使用 `AI_MODEL`。PDF 不直接依赖 provider
  文件能力，而是在服务端用 `unpdf` 提取最多 40 页文字；文本类附件严格按 UTF-8
  解码。PDF 按页、按 text stream 顺序读取，共用 15 秒解析 deadline；文字在读取过程中
  受单文件 30,000 字符、合计 40,000 字符限制并即时失败关闭。图片在同步结构校验后还由
  服务端 `sharp` 读取 metadata、核对真实格式，并缩放为 1×1 低输出像素以强制解码完整
  压缩像素流；输入宽高均须为 11–8,192 像素（11 像素下限来自生产视觉模型的已验证
  输入约束）。该步骤复用同一 15 秒附件 deadline 与 20,000,000 总像素预算。
- 理由：现有默认模型可能只接受文本，而视觉模型和 Function Calling 能力是独立的
  运行配置；无条件切换默认模型会改变既有成本与回答行为，无条件把 PDF 作为 file part
  又会把兼容性委托给 provider。服务端提取使 PDF/TXT 路径确定、可测且不会把文件发送
  给不支持该格式的模型。仅检查容器结构无法发现伪造 chunk 或损坏的压缩像素流，因此
  `sharp` 作为服务端真实解码边界，不进入浏览器 bundle；`unpdf` 也只在服务端运行，
  因此项目 Node 最低版本同步提高到 22。
- 信任边界：客户端只可提交媒体类型匹配的内联 base64 `data:` URL；服务端重新校验
  数量、解码后字节、总量、文件名、图片结构/结束标记/尺寸/像素，以及图片真实格式、
  metadata 与压缩像素流可解码性；PDF magic bytes 和 UTF-8 同样失败关闭。服务端不下载
  HTTP(S) 地址，也不接受 provider metadata、工具结果或任意 UI part。
  响应完成或失败后浏览器以文件名提示替换原始 base64；transport 仍剔除历史附件，服务端
  也只允许最后一条用户消息携带 file part，后续追问须重新上传。
- 提示注入与事实边界：所有提取文字都包在显式 `BEGIN/END USER-UPLOADED ATTACHMENT`
  标记中，系统指令要求把图片和提取文字视为未核验数据而非指令。只有确定性分类为纯
  附件提取、描述、转录或翻译的请求，才允许不调用事实工具；任何含附件轮次都由服务端
  注入固定“附件尚未核验”提示，即使模型在 `auto` 模式主动调用工具并取得充分证据，或
  混合事实问题最终失败关闭，该前缀仍不可移除。evidence contract 直接使用附件增强前、
  已通过白名单校验的原始用户文本，附件文字不能选择事实工具或改变预期
  country/scope/power/asOf/product。
  含法规、认证、限值、产品或市场意图的混合问题仍强制本轮事实工具，任意无关附件不能
  降低 evidence boundary。附件内容本身不能成为事实来源。
- 错误与隐私：空文件、伪造媒体类型、截断/超像素图片、超限、损坏/加密/无文字 PDF
  返回脱敏 400；请求体超限返回 413。模型能力在 PDF 解析前确认，provider 请求与审计
  会话只会在解析成功后开始。PDF reader/page/worker 在成功、失败与超时路径都清理；
  扫描版 PDF 提示上传清晰页面截图。
  API key、模型配置和附件解析始终留在服务端，浏览器不接收任何服务密钥。规范 HTTPS
  主站只对精确 `/api/chat` 设 10 MiB Nginx 请求体上限并关闭请求体缓冲，把合法附件
  交给应用的 9 MiB 流式门，并用
  `$remote_addr` 覆盖而非追加客户端 `X-Forwarded-For`；IP/备用 HTTP 主机只重定向到
  规范 HTTPS 域名，不接收明文附件。Nginx 在解析前对该精确路由执行
  每客户 3 / 全局 8 连接门并返回 429，应用再执行每客户 2 / 全局 4
  in-flight 门；后者只在响应流完成、失败或取消后释放，超额请求不进入附件解码。
  多实例共享限流仍是业务生产化待办。
- 验证方式：Zod/路由测试覆盖远程 URL、结构/截断、历史附件、数量和大小边界；图片测试
  锁定“结构看似合法但像素不可解码”的伪造文件在 provider 调用前被拒绝；PDF
  测试使用真实最小文档，并以 mock stream 锁定顺序读取、增量预算、共享 deadline 和
  reader/page/worker 清理；模型配置测试锁定只有图片请求选择视觉模型；evidence
  transform 测试同时锁定纯附件概述可放行、充分工具结果后仍保留未核验前缀、混合事实
  问题失败关闭、错误工具与错误查询参数不能解锁模型文字，以及服务端追加固定免责声明；
  桌面/移动 Playwright 覆盖选择、预览、移除与错误状态。生产构建
  必须证明 `unpdf` 与 `sharp` 可被 Next.js 正确打包。

### ADR-126：五门槛不闭合时归档旧法规并保留可追溯 no-data 边界

- 状态：Accepted
- 日期：2026-08-11
- 决策：将本轮基础纠错 28 国以当前 accepted fixture/tests 作为唯一产品事实；再与
  ADR-127 的 KHM、LAO、LKA、MMR、MNG 5 国合并，明确形成 `28 + 5 = 33` 国稳定
  发布批次。DZA、ETH、NGA 的既有数值法规/限值从 publishable fixture 移除，并在
  定向或全量 ingest 时治理归档；
  DZA/ETH/NGA、以及所有未闭合国家的四个 scope 返回 no-data。UGA 保留为唯一的本轮
  effective metadata-only 法规（零 limit），其 `kg/kWh` 与类别冲突不得被归一化。
  ECU、PHL、PAK、SAU、ARE、ISR、ZAF、RWA 等仅保留当前 fixture 已闭合的代表路径与
  明确非道路边界。
- 理由：部分旧结论把在用车/车辆级表、付费或不完整标准、无法选择的 PM 单元格、或缺少
  法定认证循环的材料升级为新发动机法规。五门槛要求类别、分类/功率、完整污染物表、
  法定循环及实施边界同时闭合；任一缺失时 fail-closed。仅删除 fixture 不会停止远端库中
  已发布的旧记录，因此必须显式归档。
- 后果：DZA/ETH/NGA 的 stable regulation IDs 保留为治理 tombstone，不能重新发布；
  NGA 的 `nigeriaEnvironmentMinistry` 孤立 source ID 移除。`acceptedLimitUnavailable`
  仅允许 UGA 与既有的印度 proposed schedule；不得把其他零 limit 法规静默发布。
  本 ADR 仅完成本地 accepted 收口，生产发布、API/页面读回仍待本轮部署。
- 验证方式：fixture 测试锁定 retired IDs 不在 publishable graph、DZA/ETH/NGA 的
  full 与 `--country` 图闭包、四 scope no-data、source stable IDs 与 source rows 一一
  对应，以及 UGA metadata-only allowlist。部署时需执行定向发布、归档后查询与公开读回。

### ADR-127：斯里兰卡只发布闭合的道路/工程代表路径，其余四国失败关闭

- 状态：Accepted
- 日期：2026-08-11
- 决策：LKA 从 Gazette 2079/42 Third Schedule Tables 5–6 与 Gazette 2079/70
  闭合的 `2018-07-13` 实施日发布一条 effective regulation：卡车、客车
  Table 5 各 5 条，construction Table 6 六个功率带各 4 条，共 34 limits。
  Agriculture 保持 no-data；ISO 8178-4 C1（变速）与 D2（定速）是替代认证
  循环，Third Schedule 与后续 Fifth Schedule 也是替代路径，均不累计。
  KHM、LAO、MMR、MNG 各保留两条精确官方来源和 `2026-08-10` membership，
  四个 scope 全部 no-data。五国 10 条 source 的 `verifiedAt` 统一为
  `2026-08-10T17:38:18Z`。
- 理由：LKA 的类别、功率分档、完整污染物表、法定循环与实施边界
  可在 Third Schedule 代表路径内同时闭合，但文书没有将 construction 明确延伸到
  agriculture。KHM 只有 UN R49 目录入口与在用车黑烟，LAO 只有检查/进口
  技术证明要求，MMR 是固定源/EIA 与车辆管理边界，MNG 只公开车辆烟度标准
  引用；四国都未同时闭合五门槛。
- 后果：LKA 查询在 `2018-07-12` 必须无结果，自 `2018-07-13` 起道路
  各返回 5 条，construction 在 8/19/37/75/130 kW 边界只返回当前功率带的
  4 条，agriculture 始终无结果。2079/70 clause 8 对 2018-07-12 及以前开立信用证、
  且在 2018-10-31 前进口的车辆保留过渡豁免；当前 schema 没有信用证日期维度，因此
  regulation summary 与全部 34 条 measurement basis 必须显示该 grandfathering，
  `effectiveFrom` 仍表示法规法定生效日，不等于每辆车均适用。KHM/LAO/MMR/MNG 不建立可发布法规或限值，
  不得把目录引用、在用车/固定源数值或一般检查义务升级为新发动机事实。
  本 ADR 仅完成本地 accepted 收口，生产数据库、公开 API/页面与覆盖状态仍待部署。
- 验证方式：fixture 测试锁定 10 条 source 的 title、URL、publisher、type、
  `publishedOn` 与 `verifiedAt`；Repository 测试锁定 LKA 的生效日、34 条总数、
  六个工程功率带、替代路径和 agriculture no-data，以及其余四国的四 scope
  no-data 与定向/full ingest 图闭包。部署完成前不记录为生产已发布。

### ADR-128：MAR/KEN 只刷新官方来源，不因已公开表或车辆检查改变 no-data

- 状态：Accepted
- 日期：2026-08-11
- 决策：MAR 的两条 accepted source 固定为 BO n°7361 的 Arrêté conjoint
  n°2094.24 与 BO n°7028 的 Arrêté conjoint n°2251-21；后者替换此前的咨询
  观察矩阵。KEN 的两条 accepted source 固定为 LN 180/2024 截至
  `2025-03-24` 的 Kenya Law 最新合并表达式与 LN 13/2026 Inspection Rules；
  不再以 PVoC Manual 作为这两条主 source 之一。两国统一
  `verifiedAt=2026-08-10T18:48:04Z`。本决策是 source-only currentness
  纠错，不新增、删除或修改 regulation/limit。
- 理由：2251-21 printed pp.1955–1957 已公开重型道路 WHSC/WHTC 完整污染物表
  和认证循环，但 2094.24 又把 M2/M3/N1/N2/N3 homologation 与 registration
  分别推迟到 2027-01-01、2028-01-01；截至本轮仍未通过实施日门槛。MAR 非道路
  2836-10/3400-12 的公开公报仍缺原件附件中的功率表和循环。KEN 最新合并文本与
  2026 Rules 仍分别规定周期和注册前 vehicle inspection，未公开新重型发动机
  完整数值表与法定认证循环。
- 事实纠错：EGY Decision 710/2012 Annex 6 printed pp.26–27 已读回，并非“表不可读”；
  其汽油数值是怠速 CO/HC，柴油数值是 ISO 11614 烟度/不透光度在用检查，因此
  EGY 四 scope 结论及现有两条 source 不变。GHA 现有 Act 1124 / GS 1219 来源事实
  没有错误，本轮 no-change。
- 后果：MAR/KEN 四 scope 均继续 no-data，limits 数量与稳定 33 国口径不变。
  #199–#200 只签核两国来源刷新；基础 35 国命令已包含 KEN，因此只新增 MAR，KEN
  由既有定向命令发布最新 source 图，不得重复排队。连同后续 #201–#208 refresh，追加
  当时的合并队列为 44 个唯一国家命令；该历史计数现由 ADR-131 的 79 国清单 supersede。
  目标库、公开 API/页面与覆盖状态
  读回成功前不得声称已部署。
- 验证方式：下载、抽取并渲染 BO7028 pp.53–55、BO7361 p.5、LN180 最新合并版
  pp.15–16 与 LN13 pp.5、6、8；逐项核对国内法定链、类别/功率边界、完整表、认证
  循环和实施日五门槛。文档静态检查同时锁定 MAR 恰好两条主 source、KEN 最新
  expression URL、统一 verifiedAt、当时 44 个唯一国家命令，以及 EGY/GHA no-change 边界。

### ADR-129：QAT/KWT/OMN/JOR 仅刷新国家实施链来源，GSO MY2026 标签不得单独升级法规

- 状态：Accepted
- 日期：2026-08-11
- 决策：QAT、KWT、OMN、JOR 各自固定恰好两条 accepted source，并统一
  `verifiedAt=2026-08-10T18:48:04Z`。QAT 使用 MOT 2023 款清洁柴油政策与
  Decision 125/2019；KWT 使用 Decision 372/1992 与 Resolution 44/2015；OMN
  使用 Official Gazette No. 1540 / Decision 120/2024 与 GSO MY2026-D5；JOR 使用
  Transport Sector Green Growth plan 与 JSMO 13.040.50 当前目录。本决策只更新
  source identity/currentness 和 record timestamps，不新增、删除或修改
  regulation/limit；历史 #49–#52 的旧 portal/source 组合由 #201–#204 supersede。
- 理由：GSO MY2026-D5 p.6 明确各国规则仍适用；其 p.7 的 QAT/KWT `Euro5` 与
  OMN `<Euro4` 是清单标签，不是本国采纳/实施文书，p.12 也只对 Saudi Arabia 明列
  ECE 49 Heavy Duty Euro V。QAT Decision 125/2019 只闭合 QS GSO 144/145/146:1991
  标准身份；KWT Decision 372/1992 没有把 474/475/476 纳入六个月强制清单，
  Resolution 44/2015 的 GSO 42 身份也缺完整发动机表/循环；OMN Decision 120/2024
  附件没有新重型发动机完整排放表；JOR 官方计划明确没有强制新车排放标准，JSMO
  JS 1053/1054:1998 正文付费且日期 N/A。四国均未同时通过类别/功率、完整表、法定
  循环和国内实施日门槛。
- 后果：QAT/KWT/OMN/JOR 共 16 个 scope 继续 no-data，每国零 regulation/limits；
  limits 总数与稳定 33 国口径不变。#201–#204 只签核四国来源刷新；连同基础队列、
  去重后的 MAR/KEN 与后续 #205–#208 refresh，追加当时合并队列为 44 个唯一国家命令；
  该历史计数现由 ADR-131 的 79 国清单 supersede。目标库、公开 API/页面与覆盖状态
  读回成功前不得声称已部署。
- 验证方式：QAT 读回 Al Meezan LawID 8020、Gazette No. 13 p.80 与附件项目 44–46；
  KWT 下载、抽取并渲染 Decision 372 pp.3–5 及 Resolution 44 附件 p.4；OMN 下载、
  抽取并渲染 Official Gazette PDF pp.21–24 与 GSO MY2026-D5 pp.6–7、12；JOR
  核对官方 72 页计划和 JSMO 当前目录。fixture 静态验收锁定八条 source exact
  metadata、稳定 UUID、四个双源图、16 scope 空集、零 regulation 及旧 alias/URL
  消失；当时文档静态检查锁定 #1–#208、ADR-130 与 44 个唯一国家 pending 命令。

### ADR-130：IRN/IRQ/LBN/SYR 只刷新当前证据链，阶段标签、标准身份、在用车与进口政策均不得推值

- 状态：Accepted
- 日期：2026-08-11
- 决策：IRN、IRQ、LBN、SYR 各固定恰好两条 accepted source，统一
  `verifiedAt=2026-08-10T18:55:45Z`、membership `validFrom=2026-08-10`。IRN 使用
  post-41054 合并技术条例与 post-44973 Article 4 修订；IRQ 使用 COSQC Meeting 507
  / TR 167 Amendment 1/2024 决定与 INA / Ministry of Trade 2025-12-12 实施公告；
  LBN 使用 Law 444 与 Third BUR；SYR 使用 Law 12/2012 与 SANA 2025-06-30 进口公告。
  本决策只更新 source identity/currentness 与 record timestamps，不新增、删除或修改
  regulation/limit；历史 #101/#102/#104/#125 的旧 source 组合由 #205–#208 supersede。
- 理由：逐 scope 使用 G1 法定新发动机类别、G2 分类/功率、G3 完整污染物表、G4
  认证循环、G5 国内实施边界五门槛失败关闭。IRN Article 4 日程已确认可读，且道路/拖拉机
  有阶段与实施节点，但仍缺可映射的完整分类/功率、污染物表和国家循环，construction
  也不在 tractors 类别内；IRQ 只闭合 TR 167 amendment identity 与 MY2025+ 进口车辆
  的 2026 实施边界，公开正文未闭合表与循环；LBN Law 444 是一般授权，Third BUR
  明示公交排放法规未实施并讨论在用 diesel truck/bus；SYR Law 12 是一般环境/EIA
  授权，SANA 只规定进口车辆类型、座位和车龄。阶段标签、未公开标准、在用车规则与
  进口政策均不得替代 numeric 新发动机法规。
- 后果：IRN/IRQ/LBN/SYR 共 16 个 scope 继续 no-data，每国零 regulation/limits；limits
  总数与稳定 33 国口径不变。#205–#208 只签核四国来源刷新；YEM 当前双源 no-change。
  追加当时待执行清单为 44 个唯一国家命令，四国定向刷新位于 QAT/KWT/OMN/JOR
  之后；该历史计数现由 ADR-131 的 79 国清单 supersede，目标库、公开 API/页面与覆盖
  状态读回前不得声称已部署。
- 验证方式：逐条锁定八条 source 的 exact title/publisher/type/publishedOn/URL、稳定
  UUID、四个双源图、统一 verifiedAt、membership 日期、16 scope 空集、零 regulation
  及旧 alias/URL 消失。LBN BUR3（SHA-256
  `8db12dd8e1958be78826135db15cef45792efd967043fcfd946f87255dd079ef`）已目检 PDF
  pp.184–185；SYR Law 12（SHA-256
  `bfffda1e2a983e1ce00a525c0653e5e3b66d2a4a82e8275f2b23d712f8bf283a`）已目检
  pp.2–4、15–16。当时文档静态检查锁定 #1–#208、ADR-130 和 44 个唯一国家命令。

### ADR-131：35 国 source-currentness 只刷新当前证据链，五门槛未闭合不得推值或跨法域外推

- 状态：Accepted
- 日期：2026-08-11
- 决策：将 #209–#243 按 GUY/HTI/JAM/BLZ/CUB、LBR/LBY/MLI/MRT/NER、
  GTM/HND/NIC/PRY/URY、PRK/PSE/SDN/PRI/NCL、ERI/GAB/GMB/GNB/GNQ、
  MOZ/LSO/MDG/MUS/FJI、CAF/COD/COG/GIN/DJI 七个 source-currentness 批次签核。
  每国 accepted graph 恰好两条当前 source；除 URY 外不新增、删除或修改 regulation/
  limit。URY 仅把 V5 的 `publishedOn` 纠正为 `2025-11-13`，并记录该程序版本自
  `2025-11-17` 启用；底层 regulation 继续保留 `effectiveFrom=2023-05-14`、道路
  1 regulation / 18 limits（truck 9 + bus 9）和两个非道路 no-data scope。
- 理由：逐 scope 依次检查 G1 新发动机类别、G2 分类/功率、G3 完整 CO/HC/NOx/PM
  （适用时 PN/NH3）表、G4 法定认证循环和 G5 国内法定实施日。环境空气浓度、自由加速
  烟度/不透光度、首次登记或周期检查、一般标准授权、未来法规、燃油/进口政策、气候
  计划和行政目录均不能替代新发动机型式认证链；一个门槛失败即 fail closed。
- 跨法域边界：不得从 GSO/UNECE/EU 标准身份、法国/美国/韩国或邻国规则推断国内实施，
  也不得把整车 homologation、在用车阈值、固定源/项目排放或环境空气单位转换成
  `g/kWh` 发动机限值。PRI 不自动继承美国联邦数值，NCL 不自动继承法国/EU 数值，
  PRK 不得引用韩国来源；GAB 的重车/工程/农业 homologation scope 也不等于存在排放表。
- 证据与时间：七批 `verifiedAt` 依次为 `2026-08-10T19:36:45Z`、
  `2026-08-10T19:46:12Z`、`2026-08-10T20:09:01Z`、`2026-08-10T20:20:37Z`、
  `2026-08-10T20:39:16Z`、`2026-08-10T20:50:58Z`、`2026-08-10T21:00:43Z`。
  exact title/publisher/type/publishedOn/URL、关键页和 SHA-256 以
  SOURCES §3.85 为规范索引；`verifiedAt` 只表示证据读取时刻，不替代 publishedOn、
  effectiveFrom 或 membership validFrom。
- 后果：34 国四 scope 均 no-data、每国 `0 regulation / 0 limit`；URY 仅道路两个
  scope 保留 18 条，工程/农业 no-data。追加 ADR-133/134 前当时本地待部署闭包为
  `79 jurisdictions / 16 regulations / 328 limits / 165 sources`，稳定 33 国与 limits
  总数不变；该历史小计现已由 ADR-134 的 95 国闭包 supersede。
  #209–#243 全部只是本地 accepted/source-only；目标数据库、公开 API/页面与覆盖状态
  未同步，不得写作已部署或上线。
- 验证方式：fixture/tests 锁定每国 exact 双源、稳定 UUID、record/signoff 时间、空法规/
  限值图和四 scope 查询；URY 另锁 V5 发布日、底层法规 `2023-05-14` 实施日及 9+9
  限值，文档另保留 V5 自 `2025-11-17` 启用的来源版本边界。文档
  当时静态检查锁定 #1–#243 连续编号、ADR-131、79 条唯一部署命令、七组 signoff 和
  SOURCES 每国恰好两条当前 source。

### ADR-132：治理批量发布必须由可校验快照与单事务恢复门保护

- 状态：Accepted
- 日期：2026-08-11
- 决策：治理快照使用固定 v3 格式，在 repeatable-read 只读事务中导出九张治理表；
  顶层 `timestamptz` 以 PostgreSQL UTC 六位微秒文本浅层覆盖，JSONB 列另以原始
  `jsonb::text` 保存，避免 JavaScript `Date` 截断与超过安全整数/高精度小数舍入，同时
  不改写 payload/log 的语义。快照内嵌逐表计数并对
  原始文件计算 SHA-256。恢复命令必须同时提供绝对路径与预期 SHA；默认只做不连接
  数据库的严格 schema、主键/自然唯一键、引用闭包和行数验证，只有显式 `--apply`
  才可在单个 serializable transaction 中执行。快照内记录按外键顺序
  UPSERT；相同行使用 `IS DISTINCT FROM` 跳过无意义更新，快照外九表记录按反向外键顺序
  物理删除。可能对快照外表产生 CASCADE/SET NULL 的 country 删除必须写前拒绝；其他
  外部 RESTRICT 引用会使整个事务失败。写入前还必须检查目标库 `countries.iso2`、
  `jurisdictions.code`、regulation jurisdiction/citation 和 draft entity/version 自然键冲突；
  任何一步失败整单回滚。
- 理由：`ingest-accepted-fixtures.ts` 的 source、jurisdiction、regulation/limit、country
  发布与最终验收跨多个事务；单条国家命令中途失败时，应用软链接回滚不能撤销已完成的
  数据库写入。VPS 当前也没有 `pg_dump`/`psql`，只有导出而无恢复不能构成发布保护。
- 运行边界：普通治理 repository 写事务先尝试固定 PostgreSQL shared advisory xact lock；
  维护包装器持同 key 的 exclusive session lock，并以随机 token 对应的第二把锁证明受控
  子进程仍位于维护窗口内。锁必须连续覆盖 fresh export、SHA/dry-run、无净变化
  `--apply` 演练、当前发布清单（ADR-133/134 的 95 国是历史小计，ADR-135/136
  当前扩为 97 国）
  和最终公开读回；拿不到锁、父锁消失或数据库不支持 advisory
  lock 时均失败关闭。生产快照写为新建 `0600` 文件并保存 SHA/计数；管理入口同时保持
  关闭。恢复 `--apply` 必须在事务第一条语句证明父 token lock 仍存活；wrapper 固定同一
  session 并以 10 秒 heartbeat 单飞校验 backend PID 与两把锁；单次探针允许 30 秒生产
  连接抖动，超过 deadline、会话替换或任一锁证明不完整仍终止子进程并失败关闭。任一发布
  或验收失败、或收到
  HUP/INT/TERM/EXIT 时，在锁释放前以同一快照恢复并停止；SIGKILL、主机重启或 session
  丢失则保留 `RECOVERY_REQUIRED`，由新维护锁会话人工恢复。
  不同主键占用同一业务唯一键时，恢复选择安全失败并回滚，不自动破坏性解冲突。
- 导出收敛：一个 long-lived、read-only repeatable-read 锚点事务以
  `pg_export_snapshot()` 固定完整 MVCC 视图，并以 10 秒最小 heartbeat 配合 60 秒
  idle-in-transaction 上限维持/证明锚点存活。五张小表各使用一个短 reader；
  `data_governance_drafts`、`market_import_batches`、`data_change_logs` 与生产规模的
  `regulation_limits` 按 UUID `id` 每 500 行 keyset 分批。每个 reader/batch 使用全新
  单连接 client，在任何数据查询前以 `SET TRANSACTION SNAPSHOT` 导入锚点视图；JSONB、
  UTC 六位微秒和对应事实行在同一 reader/batch 取得并核验主键闭合，不做无投影全表
  JSONB 解码、第二次全表 raw patch 查询或末尾无界 timestamp UNION。锚点与至多一个
  reader 串行共存。reader 仅对连接类 SQLSTATE、`57P01`–`57P03`、`57014`、`25P03`、
  明确传输错误及 postgres-js 无错误码的 closed-socket `TypeError`，以不推进的同一
  cursor 和全新 client 最多尝试三次；snapshot 丢失或
  其他非瞬态错误立即终止 worker。事务内单条语句保持 120 秒上限，并仍受 worker
  绝对时限约束；短 reader 的 idle-in-transaction 上限为 5 分钟。
  CLI 父进程最多启动两个全新 worker，每个 45 分钟；超时按 TERM → 2 秒宽限 → KILL
  回收并等待 `close`，不得让两次尝试重叠。worker 只写同目录唯一 `0600` attempt；父进程
  重新验证严格 v3、SHA、tableCounts、大小、类型和权限后，才用 hard-link 原子无覆盖
  提升，永久格式/写盘错误不得重试。事务 settle 后必须先让 postgres-js 通过
  `setImmediate` 排队的协议写完成，再由同一连接成功执行 teardown probe，并再跨一个
  immediate turn 后才调用 `client.end()`，防止延迟写在 socket 关闭后触发竞态；该规则
  同时适用于锚点和每次短 reader client。
- 验证方式：Zod/格式单测锁定 v3、SHA、逐表计数、重复键与引用闭包；PGlite 集成测试
  锁定六位微秒、原始 JSONB 中超过 2^53 的整数/高精度小数、目标自然键与外部副作用写前
  拒绝、成功物理精确恢复、恢复后逐表计数，以及末段触发器抛错后所有
  插入与删除均回滚。锁协议测试覆盖普通/维护 SQL、token 证明、失败关闭与 HUP/INT/TERM
  转发；VPS runbook 静态测试锁定完整受锁窗口、dry-run、`--apply`、公开读回和防重入恢复
  trap。生产实际演练结果仍须写入发布记录。

### ADR-133：AUS/PNG/CAN/USA 只发布可直接追溯的完整代表路径

- 状态：Accepted
- 日期：2026-08-11
- 决策：AUS ADR 80/03 对每个道路 scope 保留 ESC 4 + ELR 1 + ETC 4，
  全车覆盖区间为 `[2011-01-01,2025-11-01)`；ADR 80/04 从 `2025-11-01`
  对每个道路 scope 发布 WHSC/WHTC 各 CO、THC、NOx、NH3、PM、PN，共
  12 条。PNG 从 `2019-01-01` 仅对 GVW >4,500 kg、2012+ 柴油 motor truck
  发布 ADR 80/03 代表路径 9 条。CAN 道路 MY2010+ 依 SOR/2003-2 §16(2)
  直接纳入的 40 CFR 86.007-11 每 scope 发布 FTP/SET 四项；非道路依
  SOR/2020-258 §10(1)(a) 直接纳入的 40 CFR 1039.101，在 130≤P≤560 kW
  每 scope 发布 NRTC/NRSC 四项；该法规的当前边界是注册/采纳
  `2020-12-04`、第 79 条生效 `2021-06-04`，明确替代旧文档的
  `2020-12-16` / `2021-06-16`。USA 的 §86 MY2010–2026、§1036 MY2027+ 和
  §1039 MY2015+ 依次为每道路 scope 7/8 条代表行、每非道路 scope 4 条。
- 理由：旧 fixture 只保存了 AUS ADR 80/04 的 NOx/PM、遗漏 ADR 80/03/PNG
  ELR 烟度，CAN 只保存部分污染物，USA 也未完整表达所选 primary
  duty-cycle 代表行。局部行会让比较器把“未录入”误解为“未规定”。
  数值必须直接来自定义该表的 ADR/eCFR；本国引用法规只闭合适用链。
- 替代路径：美国/日本/Euro 替代标准、底盘、常速、ABT/FEL/NTE、
  smoke/crankcase 及附条件表不与当前代表路径累计。USA §1036 的 8 条和
  §86 的 7 条是受控代表行，不声称穷尽 CFR 所有条件分支。91 FR 43154
  继续作为 proposed 隔离，不得进入 effective graph。
- 日期与发布边界：AUS/PNG `verifiedAt=2026-08-10T23:00:23Z`；CAN 的
  `2026-08-10T23:17:50Z` 与 USA 的 `2026-08-10T23:21:05Z` 是本 ADR partial 图的
  历史时刻，完整功率带已由 ADR-136 在 `2026-08-11T05:21:45.000Z` 重新签核。这些只是
  本地 accepted 证据时刻，不替代 effectiveFrom/机型年、也不表示生产已发布。
- 验证方式：fixture/Repository 测试锁定 AUS 9→12 无重叠切换、PNG 9 条与
  其他 scope 空集、CAN 四污染物及 560/560.001 kW 边界，USA 7→8 的
  机型年切换与当时 130–560 kW 非道路代表带。CAN/USA 的该 partial 非道路边界
  已由 ADR-136 的六个完整功率带 supersede；定向/full selection 必须产生相同图。

### ADR-134：十二国只刷新当前双源图，不从在用车、一般授权或气候政策推值

- 状态：Accepted
- 日期：2026-08-11
- 决策：BRN、BTN、SLB、TLS、MWI、SLE、SOM、SSD、TCD、SLV、SUR、TTO
  各自固定恰好两条 accepted source，统一
  `verifiedAt=2026-08-10T23:08:11Z`、membership `validFrom=2026-08-10`。本次只
  刷新 source identity/currentness、publisher/type/publishedOn/URL 和 record timestamp，
  十二国四 scope 均继续 no-data，每国不建立 regulation/limit。
- 理由：官方文本只能闭合定性/在用车烟气或 HSU 检查、整车许可/检验、
  一般环境/标准授权、噪声 homologation、气候减缓政策或明示尚未实施的措施。
  它们未同时闭合新发动机类别、分类/功率、完整污染物表、法定认证循环和
  国内实施日。SLV 的 RTS 明文排除工程/农业，TTO 的固定源表明文排除
  车辆动力发动机，这两个边界尤其不得反向外推。
- 后果：ACCEPTANCE #248–#259 与 SOURCES §3.87 是当前 exact source 索引。
  追加 ADR-133/134 所涉国家后，唯一 pending 队列为 95 个唯一 ISO3，
  定向/full selection 闭包为
  `95 jurisdictions / 24 regulations / 433 limits / 199 sources`。这是追加
  ADR-135/136 前的历史本地发布输入；当前 97 国闭包见后续决策。
  生产数据库、公开 API/页面与覆盖状态仍未同步。
- 验证方式：fixture 测试锁定每国恰好两条 source 的 exact metadata、稳定 UUID、
  统一 signoff，并对 48 个 scope 强制空集；定向/full selection 锁定图闭包与唯一队列。
  部署后还须对每国页面、公开 API 和代表 source title 读回，成功前不能写作已上线。

### ADR-135：MLT 补齐 EU-27 可寻址成员图，CHN GB 20891 必须发布完整历史与当前功率带

- 状态：Accepted
- 日期：2026-08-11
- 决策：将 MLT 加入国家目录，并从与现有世界数据相同的固定 Natural Earth 修订
  选取 1:10m 几何，使地图、搜索和分享 URL 可寻址；其 EU 成员关系从
  `2004-05-01` 生效，通过共享 EU jurisdiction 复用 595/2009 Euro VI 与
  2016/1628 Stage V 的 2 regulations / 80 limits / 3 sources，不复制法规记录。
  同时纠正 CHN GB 20891 图：保存 `2016-04-01` 起全面实施的国三历史四带，
  P≤560 kW 在 `2022-12-01` 无重叠切换到国四 P<37、37≤P<56、56≤P<130、
  130≤P≤560 四带；P>560 kW 在后续实施公告前继续国三。三位小数功率输入下以
  `[130,560.001)` 表达国四闭合的 560 kW 端点，560.001 kW 进入国三延续。
- 条件与循环：GB 20891/HJ 1014 的 NRSC 适用于全部发动机；NRTC 仅按变速与功率
  条件附加。PN 只在 37≤P≤560 kW 发布；NH3 25 ppm 只适用于使用反应剂的发动机，
  当前查询模型没有该条件维度，因此不得发布成无条件限值行。
- 理由：Natural Earth 1:110m 的小岛国省略不能改变已由 EU 官方页面确认的成员事实；
  可复核的 1:10m feature 消除了悬空目录与不可点击国家。旧 CHN fixture 只保存
  56≤P<130 国四代表带，并把 560 kW 错放到 >560 kW 延续，还遗漏国三历史与其余国四
  功率带；局部图会把未录入误解为未规定，并破坏时点/功率边界查询。
- 后果：ACCEPTANCE #260 supersede #14 的 MLT 排除边界，#261 supersede #2 的
  单带代表样例；SOURCES §3.88 是当前规范 source 索引。MLT 定向图为
  1 jurisdiction / 2 regulations / 80 limits / 3 sources；CHN 定向图为
  1 jurisdiction / 2 regulations / 74 limits / 3 sources（第三来源为 HJ 1014-2020）。
  两国只在本地 accepted，
  生产数据库、公开 API/页面与覆盖状态尚未同步；唯一发布队列及 union 闭包以
  `docs/DEPLOYMENT.md` 的受保护合同为准。
- 验证方式：目录/地图测试锁定 MLT 唯一 ISO3 feature、几何类型和 178/177
  目录/几何基线；成员测试锁定 EU-27 精确集合、`2004-05-01` 边界与 MLT
  2/80/3 共享图。CHN Repository 测试锁定国四四带每 scope 3/4/5/5 条、
  2016-04-01 国三起点、2022-12-01 无重叠切换、560/560.001 分界、NRSC/NRTC
  语义及 NH3 条件行缺席；定向/full selection 必须产生相同图。

### ADR-136：ARE 通用 numeric 日期失败关闭，CAN/USA §1039 必须覆盖全部舍入功率带

- 状态：Accepted
- 日期：2026-08-11
- 决策：ARE 的 MOIAT 指南从 `2026-01-01` 只约束首次登记的新引入车型，从
  `2027-07-01` 才扩展到全部进口轻/重型车辆。当前 schema 不表达 new-model 或
  first-registration，因此 regulation metadata 自 2026-01-01 可见，但普通 truck/bus
  numeric rows 统一从 `2027-07-01` 生效；`2027-06-30` 仍 no-data。CAN 经
  SOR/2020-258 §10(1)(a) 纳入、USA 直接适用的 40 CFR 1039.101 variable-speed
  路径均保存法定展示 P<8、8≤P<19、19≤P<37、37≤P<56、56≤P<130、
  130≤P≤560 六带。§1039.140 要求先按 §1065.20(e) ties-to-even 将最大功率
  四舍五入至整 kW 后再分类；加拿大 §1(4) 同时纳入所引用的 calculation methods。
- 循环与范围：每个非道路 scope 六带分别为 3/3/3/3/4/4 条；NRTC 与对应 NRSC
  6-mode 或 C1 8-mode/RMC 同时适用，不再使用会被误读为二选一的旧标签。
  三位 raw query bounds 为 `[0,7.5)`、`[7.5,18.501)`、`[18.501,36.501)`、
  `[36.501,55.5)`、`[55.5,129.5)`、`[129.5,560.501)`；它们只负责把查询输入
  翻译到上述法定展示带。560、560.001 与 560.500 kW 均命中最高带，560.501 kW
  无结果。
  道路路径不变：CAN 各 4 条；USA MY2010–2026 各 7 条、MY2027+ 各 8 条。
- 理由：把仅针对新引入车型的 2026 节点用作无条件 numeric 日期，会对无法表达车型
  身份的普通查询过报。只保存 §1039 的 130–560 kW 样例则让五个低功率带被误解为
  未规定；§1039.101 Table 1 原图、§1039.140 / §1065.20(e) 和 §1039.505 已直接
  闭合数值、功率分类与循环语义。
- 后果：ACCEPTANCE #262 supersede #173 的 ARE 通用日期；#263/#264 supersede
  #246/#247 的 partial 非道路描述。CAN 与 USA 在
  `2026-08-11T05:21:45.000Z` 完成重新签核，定向图分别为 2 regulations / 48 limits /
  4 sources 与 3 / 70 / 3。当前唯一发布队列为 97 个 ISO3，定向/full selection
  闭包为 `97 jurisdictions / 28 regulations / 651 limits / 203 sources`；仍只在本地
  accepted，生产数据库和公网尚未同步。
- 验证方式：ARE 测试锁定 2027-06-30 空集、2027-07-01 truck/bus 各 12 条和两个
  非道路空集；CAN/USA 测试逐带锁定 3/3/3/3/4/4、污染物数值、循环字符串、
  全部三位 raw query bounds、560/560.001 同带、560.501 空集及相同 signoff。
  定向/full selection 锁定 CAN 48、USA 70 与
  97/28/651/203 union，DEPLOYMENT 静态测试锁定相同发布合同。

### ADR-137：97 国治理图与多模态版本以受保护原子提交上线

- 状态：Accepted
- 日期：2026-08-12
- 决策：以不可变 release `20260812031745`（Git `a779901`）发布当前应用与
  #166–#264 accepted 图。生产流程必须保持 ADR-132 的 governance maintenance lock、
  v3 快照、SHA dry-run、serializable 恢复演练、前后快照深比较、97 个定向国家写入、
  公开读回和跨域 commit marker；不得以无参数 full ingest 代替该合同。
- 结果：97 个国家目标图、scope 与聚焦验收全部通过；公开目录读回 178 个唯一 ISO3，
  全部为 `covered`。AUS/PNG/CAN/USA/CHN/MLT 的数值/成员边界通过，CHN 公网保留
  2 条 accepted regulation 与 1 条明确 Demo regulation，CN-MEE 继续指向 HJ 1014
  jurisdiction source 与 GB 17691 membership source。
- 运行边界：Next 进程由 `diesel` uid 执行；Nginx/PM2、共享 `.data` 与 root 管理的
  环境文件保持既定权限。仅更新视觉模型配置，真实 11×11 图片流式验收通过；配置值和
  其他秘密不进入日志或客户端。
- 恢复结果：发布前 v3 snapshot 的 dry-run、`--apply` no-op 演练与第二份 snapshot
  深比较通过；发布提交后无 `RECOVERY_REQUIRED` / `PUBLISH_COMMITTED` 残留。
  签核表与来源表中的历史 `pending deployment` 文案统一由本 ADR 和 STATUS 当前快照
  supersede，不回写其历史取证语义。

### ADR-138：查询时状态由 asOf 派生，模拟角色评估不冒充现实试点

- 状态：Accepted
- 日期：2026-08-12
- 决策：法规查询同时保留持久记录生命周期状态 `recordStatus`（国家详情兼容字段
  `status`）并由 `asOf` 派生 `statusAtAsOf`。只要
  `[effectiveFrom,effectiveTo)` 覆盖查询日，当前 `recordStatus=superseded` 的法规仍作为
  `statusAtAsOf=effective` 返回，并向用户解释为“当时有效、现已取代”；未来法规只有
  在已记录的 `adoptedOn <= asOf` 时才可派生为 adopted。`adoptedOn` 缺失或
  `recordStatus=superseded` 却没有 `effectiveTo` 的异常记录保留供数据治理，但从确定性
  查询日集合中 fail-closed 排除。proposed 在任意日期都不得派生为 effective，详情、
  跨国比较、product-fit、AI 工具和 citation 必须沿用同一语义。
- 理由：2026-08-12 的三角色 subagent 模拟中，法规角色以
  `CHN / asOf=2024-12-31` 重现两项 P0：2026-01-10 才采纳的 Stage C 泄漏到历史视图，
  而 `[2020-01-01,2025-01-01)` 当时有效、现在 superseded 的 Stage Z 消失。仅按当前
  `regulations.status` 过滤无法表达历史适用性，也会让详情、比较和适配产生不同结论。
- 用户体验处置：本轮同时接受三角色共同反馈，将 Demo 匹配降级为“演示匹配”并禁止
  外推为报价、认证声明或销售承诺；为 unknown 提供可复制补数摘要；国家详情带筛选进入
  chat；聊天证据默认折叠、状态中文化、数值去无意义尾零；首页/详情解释 Demo、covered、
  verified 边界。上述实现已通过 lint、typecheck、Vitest、build、完整 Playwright 与
  浏览器链路走查；这些工程结果不能外推成现实用户效果。
- 模拟边界：三个 subagent 仅扮演海外销售/区域销售、法规/合规工程师和产品/应用
  工程师。该活动不是现实用户访谈、客户试点、法规专家签核或 KPI 测量；完整记录见
  `SIMULATED_USER_EVALUATION.md`。项目仍不得宣称拥有外部专家批准、真实销售用户成效或
  商业验证。
- 双时态边界：本决策只根据业务生命周期日期重建 `statusAtAsOf`，没有引入独立的
  `knownAsOf` / transaction-time，也不能重演后来更正或补录前系统当时掌握的知识。
  `verifiedAt` 不替代第二时间轴；若出现该需求，必须另行设计 schema 和 Migration。
- 验证方式：国家 service 回归锁定 2024-12-31 返回 Stage Z 为
  `recordStatus=superseded/statusAtAsOf=effective`，返回已在当日采纳但尚未生效的 Stage A，
  且排除 2026 年才采纳的 Stage C；异常 fixture 锁定 adoptedOn 为空、superseded 未闭合
  均不会产生确定结论。Repository 比较回归锁定相同历史集合，product-fit 证据保留必填
  `recordStatus` 并只把查询日有效的候选交给规则；proposed/effective 隔离继续保留。UI
  采纳项由 lint、typecheck、Vitest、build、完整 Playwright 与浏览器走查验收。

### ADR-139：AI 多轮上下文按字段归并，模型文字按证据契约失败关闭

- 状态：Accepted
- 日期：2026-08-13
- 决策：服务端只从通过白名单校验的用户轮次归并当前页面会话的业务上下文，字段包括
  任务、比较国家集合、焦点国家、目标国家、国家资料主题、应用场景、功率、判断日期和
  产品型号。本轮显式字段按字段覆盖；“BRA 呢？”等省略式追问继承任务及其余条件；修改
  目标国家不得清空比较组。确定性 Demo 路由和模型调用前的缺参引导复用同一归并器。
- 证据边界：流级 evidence contract 按归并后的任务与查询字段要求具体工具，并逐项校验
  返回结果公开的 `country/scope/power/asOf/product/target`。空契约、错误工具、错误或缺失
  查询字段、任一 `no_data/error/evidenceSufficient=false` 都不能解锁模型自然语言；未写
  `asOf` 时绑定当前 UTC 日期。混合意图为每项交付物和国家角色建立独立 requirement；缺少
  国家、scope 或功率时失败关闭，未点名产品也不允许模型自行缩窄目录。法规、认证、产品
  适配、机会分析和销售简报的成功文本由服务端补充固定免责声明。契约直接使用附件增强前
  的可信用户文本，并始终显示未核验边界。
- 产品范围与恢复：机会评分和销售简报保留点名的 `productModelCode`，不得无声扩为完整
  产品目录；工具卡首屏展示实际查询条件。请求失败后客户端仅在当前页面保留问题和原始
  `File` 用于用户明确选择“原样重试”或“编辑后重试”，历史附件仍立即替换为文件名占位；
  发送与恢复动作使用同步互斥，不自动请求，也不允许快速双击产生并发重发。
- 边界：该上下文由每次请求携带的可信用户历史重算，不是跨页面、跨设备或长期持久记忆；
  assistant 文本和历史工具卡仍不作为事实证据。业务事实、适配和评分继续只由确定性工具
  产生。
- 验证方式：五轮销售 golden conversation 锁定产品跨国追问、法规比较、销售简报和目标国
  更新；法规/市场单国追问锁定主题继承。证据回归锁定错误工具、错误默认日期、错误/缺失
  产品条件、必需参数缺失、混合意图、国家角色、伪造附件边界、空契约与服务端免责声明；
  服务和 UI 回归锁定点名产品评分/简报、可复述 Demo 摘要、查询摘要、失败草稿恢复以及
  双击只发起一次请求。详情到对话的 E2E 还锁定未完成产品评估不会回写旧 URL，且刚完成
  的服务端规范化查询会立即进入对话链接。

### ADR-140：助手解释支持安全 CommonMark/GFM 渲染

- 状态：Accepted
- 日期：2026-08-14
- 决策：仅对 assistant text part 使用 `react-markdown` 与 `remark-gfm`，支持标题、
  强调、列表、引用、代码、表格、任务列表和删除线。用户输入保持纯文本，工具 JSON 继续只由
  结构化卡片渲染，不进入 Markdown 解析。
- 安全边界：不引入 `rehype-raw`，并显式设置 `skipHtml`；模型图片语法只显示隐藏提示，
  不加载远程资源。URL transform 只允许 HTTP(S)、单斜线站内路径、查询串和锚点；
  外部链接使用新窗口与 `noopener noreferrer`。Markdown 只改变排版，不提升模型文字的事实等级。
- 依赖理由：CommonMark/GFM 对嵌套、代码块和表格有大量边界语法，自建部分解析器会带来
  兼容性与 XSS 风险。`react-markdown` 承担 React AST 渲染，`remark-gfm` 只扩展 GFM 语法；
  两者都运行于现有聊天客户端边界，不进入 Repository、工具或事实计算。
- 验证方式：组件回归覆盖标题、强调、行内代码、任务列表、表格和外链；
  安全反例覆盖 raw `<script>`、`javascript:` / `data:` URL、协议相对 URL 与远程图片。

## 4. 暂不决策

以下问题在 MVP 出现明确需求或数据证据前不提前设计：

- 微服务拆分与事件总线。
- PostGIS 空间分析。
- 多 Agent 协作。
- 完整双时态数据库。
- 向量索引类型和参数。
- 自动化法规抽取审批后台。
- CRM、邮件和日历集成。

## 5. 决策变更模板

```md
### ADR-NNN：标题

- 状态：Proposed | Accepted | Superseded | Blocked
- 日期：YYYY-MM-DD
- 决策：
- 理由：
- 备选：
- 后果：
- 验证方式：
```
