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
- 2026-09-12 增补：操作者已明确批准 5→6、WebGL2 最低要求和 ESM worker 迁移；
  本地经 6.4.1 安全修复核对后选用官方稳定 6.9.0，同时取得上游 GL-null 容器回滚修复，
  不应用本地 pnpm 补丁。Next 配置只读验证版本化同源 worker/shared/LICENSE
  与已安装包一致，并从固定 16 项内联依赖来源重算原文 notices；不让 Next 单独输出缺少
  sibling 的 worker 资产。生产 CSP 的 worker
  权限收窄为 `'self'`。安全审计通过不替代 WebGL2 失败恢复、真实多边形交互或生产验收。
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

- 状态：Superseded by ADR-142 and ADR-145
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

### ADR-144：对话采用请求级 BYOK

- 状态：Superseded by ADR-145
- 日期：2026-08-06
- 决策：对话页由用户填写 OpenAI-compatible 的公开 HTTPS 地址、模型名和 API Key；
  配置只存在浏览器内存，并随每次同源 `/api/chat` 请求发送。服务端在请求内创建
  provider，完成流式调用后释放，不使用项目默认模型或服务端模型 Key。
- 理由：用户明确要求移除内置 AI，同时保留现有确定性法规、市场、产品工具和审计链路。
- 安全边界：输入先经 Zod 校验；地址拒绝 localhost、私网、link-local、IPv6 和内嵌
  凭据。Key 不写 localStorage、数据库、日志、错误响应或 `modelId`。
- 后果：刷新页面后需要重新输入配置；对话页必须显示未连接状态，未配置时不发送请求。

### ADR-145：对话采用服务端环境配置

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
- 决策：`opportunity-score-v2` 使用市场潜力、产品准备度、法规认证覆盖三个
  维度，默认权重 `0.5/0.3/0.2`。权重由 Zod 校验的服务端环境变量配置，模型
  参数中不提供权重。缺失或 `unknown` 维度为 `null` 并从有效权重中排除，总分
  同时返回数据覆盖率、逐维度贡献、typed gap 和完整可重放 provenance。
- 理由：0 必须表示有证据的最低相对值或明确失败，不能兼任“没有数据”；纯函数
  可以保证同一事实快照与输入产生相同结果，并允许独立测试和版本追溯。
- 后果：总分可能基于不完整维度，使用者必须同时查看 `dataCoveragePct` 和
  `gaps`。市场 min-max 分只在本次比较组内有效，不是全球绝对排名。
  当前只为虚构 `DEMO_ADDRESSABLE_UNITS` 登记方向；真实指标、方向和批准人仍
  受 ADR-020/021 阻塞。
- 验证方式：纯函数重复输入、贡献分解、缺失重归一化、unknown 排除和 Demo
  数据库纵向测试。
- 2026-08-05 市场可比性收紧：相同 `metricCode` 仍必须具有完全一致的指标
  `definition`；定义不同返回 `DEFINITION_MISMATCH`，不得进入归一化或评分。
- 2026-08-30 provenance 收紧：scorecard 必须携带本次完整市场比较、法规比较和逐国
  product-fit evaluation；三维分数、typed gap、权重、贡献、总分、覆盖率、国家顺序和
  来源闭包均从这些事实重放。评分结果不再携带可自由填写的事实说明或解释字段。

### ADR-035：销售简报由确定性服务组装，UI 分离事实与建议

- 状态：Accepted
- 日期：2026-07-29
- 决策：`generateSalesBrief` 返回严格结构 JSON，包含
  `marketScore`、typed `gaps`、完整 `provenance`、`opportunities`、`risks`、
  `recommendedProducts`、`salesActions` 和 `sources`。产品只推荐
  `product-fit-v2` 中 `status=fit`、`commercialReadiness=ready` 且供应检查通过的记录；
  机会、风险和动作使用 discriminated `ruleCode` 与 typed 实体 ID。UI 将
  确定性事实、规则建议和模型自然语言解释分区显示。
- 理由：结构化事实和确定性分数不能被 LLM 文案覆盖；规则动作可复现，也能清楚
  告知销售人员哪些内容是建议而不是法规/市场事实。
- 后果：简报 payload 不保存自由摘要、自由原因或未类型化的 `evidenceIds`/source-ID 文案；
  规则仍携带经过校验的 typed 实体 ID。客户端按 rule code、typed gap
  和结构化事实生成当前 locale 的固定文案。模型可以解释工具 JSON，但不能修改数值、
  权重、适配状态、规则投影或来源。四个新工具继续写入最小化审计表，
  Migration 只扩展 `ai_tool_name` enum。
- 验证方式：销售简报严格字段测试、推荐产品和规则数组的精确有序重建、跨产品认证
  替换对抗测试、工具 Zod 输出、审计 enum Migration 和 UI 分层标签。

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
- 2026-08-15 本地内容寻址写入改用临时文件加无覆盖 hard-link。同哈希并发导入中，先
  落盘请求若建库失败不得即时删除共享文件，否则会让尚未提交的复用请求留下缺失引用；
  失败路径只记脱敏告警，由默认 24 小时最小年龄的孤儿扫描统一判断。扫描默认 dry-run，
  共享/生产删除必须显式执行治理维护锁包装入口。

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

- 状态：Accepted；原 per-client 小时拓扑自 2026-09-05 由 ADR-264 扩展为 global + client，
  本 ADR 继续保留路由位置、429 与错误脱敏基线
- 日期：2026-07-30
- 决策：`POST /api/chat` 按客户端标识（`x-forwarded-for` 首段，无则共享桶）
  执行固定窗口速率限制，默认 30 次/小时，经 `AI_CHAT_RATE_LIMIT_PER_HOUR`
  配置（1–10000）；超限返回 429、`Retry-After` 与 schema 校验的通用错误
  `RATE_LIMITED`。公开 API 错误响应只允许 schema 校验的
  `{error:{code,message}}` 通用消息，异常细节只进服务端日志；AI 流式响应
  的 `onError` 使用固定文案，不暴露 provider、模型或内部错误。
- 理由：AI 路由是成本最高、最易被滥用的公开入口；M2 发布安全基线要求请求
  限制与错误脱敏，且未授权请求与日志不得泄露敏感信息。
- 后果：开发、测试与离线 Demo 使用进程内固定窗口；生产强制 PostgreSQL 后端，以
  `(scope, key_hash, window_start)` 跨实例共享计数；ADR-264 规定同一事务固定 global → client
  条件 UPSERT，原始客户端标识先做 SHA-256；过期桶回收自 2026-09-05 起由 ADR-262 的请求外
  有界维护负责。生产显式配置
  内存后端会失败关闭；数据库递增失败时
  Route 在解析、审计或模型调用前返回脱敏 503，不允许请求绕过配额。限流仍是滥用缓解
  而非访问控制，无代理直连时
  客户端可伪造 `x-forwarded-for`，公开部署必须位于可信代理之后（ADR-016/036）。
  通过单实例 admission 门的请求在解析、配置与审计前消耗配额，此后无论请求是否成功
  都计数，以保护后续数据库写入与模型调用；被 admission 并发门直接拒绝的请求不访问
  共享桶，也不消耗小时配额（ADR-155）。配置故障期间激进重试的客户端可能被限流至窗口结束，
  处置为临时调高限额或等待滚动。AI SDK 的 `TypeValidationError`/
  `InvalidArgumentError`/`MessageConversionError` 与 Zod/语法错误同归
  `INVALID_INPUT` 400，配置错误返回不含变量名的通用 503 文案。
- 验证方式：限流器单元测试覆盖阈值边界、窗口滚动、键隔离与 `Retry-After`
  计算；数据库集成测试用两个独立 limiter 实例锁定共享阈值、仅落盘 64 位哈希键及旧窗口
  隔离；回收批次与 grace 的证据见 ADR-262，global/client 原子双桶证据见 ADR-264。既有 AI
  mock model 测试与 e2e 在默认阈值下不回归。
- 2026-08-06 安全异常类型提取不再信任 `Error.name`，只接受白名单校验的构造类型；
  对象原型、构造器访问或 Proxy trap 自身抛错时统一回退 `UNKNOWN_ERROR`，保证日志
  最小化辅助函数不会让原 Route Handler 的固定错误响应再次逃逸。
- 同日客户端错误边界把 JSON `SyntaxError` 与 Zod 响应校验错误统一视为不可信解析
  细节；国家、产品和管理界面使用固定回退，只有结构化错误信封或应用已生成的普通
  错误文案可见，避免 200 HTML/畸形上游响应片段进入页面。
- 2026-08-30 增补：AI 工具执行异常不再读取可变的 `Error.name`；控制台与
  `ai_tool_calls.errorCode` 统一只保存 `getErrorCode()` 白名单类型。伪造为数据库连接串或
  secret marker 的异常名不得进入日志或审计。无效工具 JSON 也只记录输入类型、字段总数
  和该工具已知字段白名单；模型生成的未知键名不得作为 `providedFields` 持久化。

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
- 2026-09-14 国家 GET / HEAD 的规范化提前到 Next 请求入口，共用原逐字段解析函数；
  仅静态目录内的单段 ISO3 参与，使用真实同源 HTTP 307，在 RSC 渲染前完成。
  页面保留规范化与未知国家 404 防御，不改变 API、写方法或其他路径。传入应用的未知参数用 own
  data properties 保留，包括 `__proto__`；仅顺序或编码等价不跳转，不注入默认日期。
  Next 默认 adapter 继续负责内部 `_rsc` / Flight 协议。此实现针对已观察到的国家
  redirect 渲染路径，不宣称 React 开发计时、notFound 或其他组件错误已修复。
  首次新增 HTTP 回归揭示 Next 16.3.3 在 Proxy 之前的普通 query 对象往返不保留
  `__proto__`；该既有框架限制与直接函数保留能力分别测试，不作为有意安全过滤或应用修复。
- 2026-09-12 同日 scope / power 写回后，Drawer 每次采用最新服务端 `initialResponse`，
  不再把首次 SSR 响应作为永不更新的本地缓存。仅客户端取得的详情进入 state，并按
  ISO3、scope、power、asOf 隔离；默认日期写回的等价复用仅限同 country / scope / power
  的 available 响应。摘要 loading / result / error 归属于同一筛选上下文，上下文改变即
  取消旧摘要请求。同日更新不重挂整个 Drawer，保留已完成产品匹配与后续未提交草稿；
  不改变现有跨日期重新挂载边界或法规判定。
- 同国家、同日期的历史记录跳转使用路由 revision 与独立表单 generation：真实
  CHN(A)→BRA(A)→CHN(B) 后单次返回 CHN(A)，必须恢复 A 的表单、摘要、结果及聊天链接，
  不能复用 B 的状态。自身评估 `replace` 的一次性确认不重挂表单，保留随后输入的未提交
  草稿；历史跳转覆盖该归属，先取消旧请求，等待目标 SSR 后按分享链接规则复现。
  原始失败轨迹与新增前进/后退、中英桌面/移动回归分别保留；不修改 Demo 产品或法规期望。
- 同一面板在请求中跨越前次自身 URL 确认时，异步完成不能使用请求开始时捕获的父级回调。
  `ProductFitPanel` 在 layout effect 中更新完成回调 ref，仅采用已提交渲染的上下文；实际
  调用仍先通过 abort / request ID 检查。复现顺序为 A=100、B=150 的 RSC 延迟、C=175
  请求中确认 B，再返回 C 的产品及摘要 API、继续延迟 C 的 RSC；C 的结果、摘要和 Chat
  筛选必须在该 RSC 到达前一致。只更新回调归属，不改变 URL 四字段写回、判定或取消语义。
- Header 发起当前 document 内导航时，在 `Link.onNavigate` 内同步通知产品面板取消评估，
  不等到 pathname 更新或卸载。真实中英桌面诊断证明：延迟首页 RSC 时旧面板仍挂载，
  迟到产品响应会发出旧国家 `replace` 并夺回导航。通知不携带 URL、不自行解析全局点击，
  使用原有 abort / request ID 防线；Next 已排除的新标签页、修饰键、下载、已阻止点击
  不触发通知。语言刷新和自身评估写回不广播导航意图；保留此前跨自身 RSC 确认的完成回调修复。

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
  应用配额由 PostgreSQL 原子桶跨实例共享；数据库不可用时入口失败关闭。
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
- 变更：本节的 v3/九表格式是当时的历史合同；自 2026-08-15 起由 ADR-146 的
  v4/十表合同替代。锁、事务、SHA、写盘与恢复失败关闭边界继续有效。
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

### ADR-141：公开国家地图与详情排除 Demo 分类事实

- 状态：Accepted
- 日期：2026-08-14
- 决策：PostgreSQL 公开模式下，Demo 国家摘要保留目录位置但统一降为 `no_data`；Demo
  国家不返回详情。非 Demo 国家详情对辖区实体、成员关系、法规、市场指标及各自来源执行
  完整分类过滤，任一依赖节点为 Demo 即排除整条事实。`pglite-demo` 继续保留原 fixture，
  以便零配置作品演示和 Playwright 验证完整证据链。
- 理由：公开地图的颜色和国家详情首先承担已核验事实入口，不应在同一业务路径混入虚构
  fixture；仅靠“虚构 Demo”徽标仍会增加误读风险。保留离线 Demo 则维持求职项目的可运行性。
- 后果：公开国家画像与调用该 service 的 AI profile 不再返回 Demo 法规、辖区或市场指标；
  产品适配的独立 Demo 产品边界不在本 ADR 范围内。数据库记录不做破坏性删除，后续可按
  治理流程归档。
- 验证方式：表驱动测试覆盖国家状态/来源、辖区/成员关系、法规完整适用链与市场来源的
  每个 Demo 分类入口；现有 `pglite-demo` 国家测试继续证明离线 Demo 未被破坏，地图 E2E
  锁定中性“有可查看数据”图例。

### ADR-142：销售对话采用版本化提示、证据驱动循环与离线 Harness

- 状态：Accepted
- 日期：2026-08-14
- 决策：system instruction 提取为 `sales-chat-system-v2`，按事实来源、工具路由、循环
  策略、回答契约和未核验附件边界分段。每个模型步骤从 evidence contract 和已完成的
  结构化结果计算剩余工具：证据未齐时只开放能满足剩余 requirement 的工具并强制调用；
  全部满足、任一结果失败/不足、执行错误、缺参或纯附件概述时关闭工具并进入终态。工具
  定义保持固定顺序，总步骤上限仍为 5。
- 理由：只在 prompt 中要求模型“正确选工具、及时停止”不可测试，也会让七个工具在每一步
  互相干扰。服务端 loop policy 能把模型自由度限制在当前证据缺口内，同时保留 evidence
  boundary 作为最终失败关闭层。
- Harness：新增 `pnpm ai:eval`，以版本化 golden prompts 离线检查直接分流、缺参、证据
  requirement、初始工具集合、附件边界和停止阶段，不调用模型 API 或数据库。该结果只证明
  确定性编排合同，没有真实 provider 的工具选择准确率、延迟或成本含义；正式模型验收仍需
  另建带模型版本和运行日期的 live eval。
- 验证方式：13 个 golden cases 锁定主要意图与失败路径；AI SDK mock 回归锁定工具逐步
  收窄、证据未齐继续 required、证据齐全切换 none，以及畸形/不足结果失败关闭。

### ADR-143：知识检索和模型解释采用双层相关度与不可信内容边界

- 状态：Accepted
- 日期：2026-08-15
- 决策：混合检索候选必须达到固定最终分门槛，并具有关键词命中或强向量信号；service
  与 AI 工具结果各自校验一次。`sales-chat-system-v3` 将检索正文、metadata 和正文 URL
  统一视为不可信数据，知识 query 还必须与用户请求主题词匹配。模型 Markdown 外链只允许
  与同一消息结构化 citation URL 完全匹配。模型输出、证据缓冲区和用户历史分别设置硬上限。
- 理由：只有 metadata 和“非空结果”不能证明片段相关，也不能阻止文档内提示注入、模型
  生成无来源链接或客户端用超长历史放大费用。相关度、意图、链接和资源四层都应失败关闭。
- 后果：近似但弱相关的搜索可能返回 `no_data`，调用方需要缩小法规名称、污染物、章节或
  日期；未来替换正式 embedding 时必须用代表性语料重新校准门槛，而不是沿用当前数值。
- 验证方式：单元测试覆盖弱分过滤、低分工具结果二次过滤、检索内容边界、无关 query
  拒绝、citation 外链白名单、历史裁剪、output token 参数和缓冲区超限丢弃。

### ADR-146：治理快照 v4 将市场事实纳入同一原子恢复边界

- 状态：Accepted
- 日期：2026-08-15
- 决策：当前治理导出与恢复只接受严格 `formatVersion: 4`，在 ADR-132 的同一 MVCC
  锚点中覆盖十张表：`countries`、`country_jurisdictions`、`data_change_logs`、
  `data_governance_drafts`、`data_sources`、`jurisdictions`、
  `market_import_batches`、`market_metrics`、`regulation_limits`、`regulations`。
  `market_metrics.value_numeric` 以数据库精确 decimal 字符串保存；恢复同时校验其国家、
  来源、期间与 null-safe 自然键闭包，并在反向外键顺序中恢复或删除市场观察值。
  `country_jurisdictions` 的行键包含 `valid_from`，以保留退出后重新加入的不同有效期。
- 替代范围：ADR-132 与 ADR-137 中 v3/九表文字保留为当时格式和生产执行记录，不可作为
  当前命令输入。当前导出、dry-run、`--apply`、恢复后重导与深比较均必须使用 v4/十表；
  v3 文件由严格 schema 失败关闭，不能静默升级或遗漏市场事实。
- 理由：市场发布和治理日志同属可变的结构化事实。九表恢复会保留发布后新增或修改的
  `market_metrics`，使“恢复成功”与真实数据库状态不一致；JavaScript Number 还会破坏
  超过安全整数范围或含六位小数的指标值。
- 验证方式：格式测试锁定 v4、十表计数、市场自然键和引用闭包；PGlite 集成测试锁定超出
  `2^53` 的六位小数原样往返、已修改及新插入市场观察的物理精确恢复，并证明恢复中途
  失败时市场行与其余治理表在同一事务回滚。

### ADR-147：产品合规适配与查询日供应状态采用双轴语义

- 状态：Accepted
- 日期：2026-08-15
- 决策：`product-fit-v2` 保留 `status=fit/not_fit/unknown` 作为法规与认证适配轴，
  新增按 `[availableFrom, availableTo)` 计算的供应检查，以及
  `commercialReadiness=ready/not_ready/unknown`。端点证据不完整时供应状态失败关闭为
  unknown；只有合规 fit 且供应 pass 才为 ready，任一明确不适配或不可供应为 not_ready。
  `opportunity-score-v2` 的产品准备度使用商业准备度，法规覆盖仍只使用法规/认证检查。
- 理由：合规适配不等于查询日可售。把供应期只展示在追溯区会允许已停售、尚未上市或
  供应证据不足的产品进入销售推荐；反过来把供应失败改写成 not_fit 又会污染合规语义。
- 后果：确定性销售简报只推荐 ready 产品；合规 fit 但供应 fail/unknown 的产品进入风险/
  缺口，且不生成销售准备动作。该规则只证明已记录产品供应期，不代表库存、交期、价格或
  真实商业承诺。该 ADR supersede ADR-030/034/035 中关于 v1 和 fit-only 推荐的当前行为，
  历史文本继续保留。
- 验证方式：单元测试覆盖供应期上下界、未上市、已停售、缺失端点和组合真值；服务测试
  锁定机会分使用 ready/not_ready、销售简报排除 unavailable 产品，产品页与 AI 卡片同时
  展示合规轴和供应轴。

### ADR-148：AI 工具审计按请求轮次 append-only，公共请求使用脱敏结构化日志

- 状态：Accepted
- 日期：2026-08-15
- 决策：每个 `/api/chat` 请求由服务端生成 request/turn ID，并将审计键写为
  `${turnId}:${providerToolCallId}`。AI tool call 与 citations 只插入；重复键视为审计异常，
  不更新旧记录、不删除旧引用。公共 API 和管理写入统一记录 requestId、route、status、
  durationMs、errorCode；AI 完成事件另记录 modelId、工具数、loop steps、证据结果和
  token usage。
- 隐私边界：日志 schema 为 strict；prompt、附件正文、身份 Header、IP、数据库 URL、
  API Key 和上游错误正文都不是合法字段。响应返回 `X-Request-Id` 供故障关联。
- 验证方式：集成测试连续两轮相同 provider tool call 保留两条调用及各自 citation，精确
  重复键失败关闭；日志测试拒绝额外敏感字段。

### ADR-149：实施写入只在本地隔离 Demo 开放，真实模型质量由预算受限 eval 衡量

- 状态：Accepted
- 日期：2026-08-15
- 决策：`pnpm demo:fde` 仅允许 loopback + development + PGlite + 显式 Demo 标志，
  每次启动新建进程内数据库并显示 `LOCAL / MUTABLE / FICTIONAL`。本地 persona cookie
  只由 Demo server 映射为测试身份；生产认证和公网 `/admin` 阻断不变。
- Eval：`pnpm ai:eval:live` 使用 18 条版本化虚构案例与当前 OpenAI-compatible 文本模型，
  串行记录工具、关键参数、证据、延迟和 token。达到请求、token 或单例时间门立即保存
  部分报告；未完整或低于安全 100%、工具/参数 90% 不得标为通过，也不进入普通 PR CI。
- 理由：招聘演示需要可操作的实施闭环和真实模型证据，但二者都不应扩大生产写权限、
  暴露真实资料或伪造客户反馈。
- 验证方式：桌面 E2E 完成 CSV → Draft → Review → Publish → Query → Archive；移动端
  覆盖 persona/Preview。live eval 评分、脱敏和预算停止由单元测试约束。


### ADR-150：Live eval 的 token 预算要求完整 usage 并保留异常前已知成本

- 状态：Accepted
- 日期：2026-08-30
- 决策：`sales-chat-live-v2` 的每条 case 在生产 `streamSalesChat()` 的 step callback 中收集
  已完成 provider step 的 input/output/total usage，作为逐 step `ledger`；同时读取 AI SDK 的
  整轮 aggregate usage。正常结束只有在模型流完整结束、ledger 条数与生产循环的 completed
  step 数相同、每步 input/output/total 均为非负安全整数且满足 `input + output = total`、
  input/total 为正，并且 aggregate 与 ledger 求和逐字段相同时，才标记
  `usageComplete=true`。任一 case 不完整会在 mismatch 中记录 `token_usage`、停止后续 case，
  并使总预算与 `thresholdsPassed` 失败；`null` 不得按零通过。执行异常仍汇总异常前已完成
  step 的 ledger、工具步和 step 数，但 usage 保持 incomplete。
- 保守下界：对每组观测分别取 `max(total, input + output, input, output)`，逐 step 下界求和后
  再与 aggregate 下界取较大值。即使 provider 给出互相矛盾或部分字段，报告也不会选择较小
  数字低估已知成本；`budget.totalTokens` 在 incomplete 时明确只是 known lower bound。
- 结束与计分：报告必须写入明确的 `terminationReason`（`completed`、`case_error`、
  `initialization_error`、`token_usage_incomplete`、`token_reserve` 或 `case_limit`）。没有样本的
  指标分母输出 `null`/N/A，不得用 100% 伪装为通过；全部 18 条 case、所有必需指标、完整
  usage 与 160,000 上限缺一不可。
- 理由：160,000 token 是验收预算证据。把 provider 未报告值写成零会低估成本并允许一份无法
  对账的报告通过；只信 aggregate 会掩盖中间 step 缺报，异常分支全部清零又会抹掉失败前
  真实发生的调用。
- 后果：`0 known tokens` 与 `tokenUsageComplete=false` 的组合只表示当前可核验下界为零，不
  表示 provider 实际零消耗。runner 不会在剩余预算未知时继续启动 case。该修复不改变 18 条
  case 期望，也不会把历史 101,604 aggregate token 结果回填成满足新 ledger 的运行。
- 限制：通用 OpenAI-compatible usage 只在 provider step 完成后返回。12,000 token 的
  pre-case reserve 与逐 step 停止不是 tokenizer 证明，最后一条 case 仍可能先越过验收上限
  再被报告拒绝；账单级预消费硬限额需要 provider 账户预算或模型专用 tokenizer/preflight。
- 验证方式：纯函数测试锁定缺失、部分、矛盾与被低报的 usage 都保留保守下界但无法通过；
  AI SDK 多步 mock 校验 aggregate 与 ledger；异常 mock 证明保留错误前已完成 step；
  `portfolio:verify` 不信任报告布尔值，而是从逐例 ledger 重算 completeness、known total、
  score、threshold 与 termination reason。

### ADR-151：Live eval 报告使用可核验来源并先归档后推进 latest

- 状态：Accepted
- 日期：2026-08-30
- 决策：每次 `pnpm ai:eval:live` 在初始化任何运行时依赖前生成 UUID 并采集 Git 状态；
  单次采集使用 HEAD → porcelain status → HEAD，运行结束再采一次并与起点对账。只有两端
  都 clean 且 HEAD 相同才记录该 SHA 为 `evaluatedCommit`；稳定 dirty 只记录
  `baseHeadCommit`，精确提交为 `null`；Git 不可用或 HEAD 漂移标为 `unavailable`。报告还
  绑定当前 system prompt version，但不保存 status 文件名、patch、prompt、用户文本或上游
  错误正文。
- 来源指纹：运行前后分别对 Git 已跟踪及未忽略的未跟踪评估相关文件计算 SHA-256，范围为
  `evals/`、`src/`、`drizzle/`、`scripts/ai/`、`scripts/portfolio/`、`.nvmrc`、
  `vitest.config.ts`、`package.json`、`pnpm-lock.yaml` 与 `tsconfig.json`。路径长度、路径、
  文件长度和内容都进入确定性摘要；非普通文件、不安全路径、读取失败或起止摘要变化会记录为
  `unavailable`/`unstable`。它不是整个 repository 的指纹；`portfolio:verify` 只接受稳定
  captured 指纹、与当前工作树重新计算的结果比较，并在 clean 报告上从 claimed commit tree
  重建同一摘要，阻止旧 commit 与新工作树摘要被拼接。
- Provider provenance：v5 保存 model ID 及不含明文 endpoint/key 的 profile：adapter contract、
  endpoint SHA-256、thinking 与 usage flag；verifier 与 STATUS 中的显式预期比较。初始化失败
  必须记录 null，started run 不得缺失 profile。
- 留存：初始化失败、部分运行、门槛失败和通过结果均先写入同步的独占临时文件，再以 hard
  link 发布到时间戳 + UUID 归档名，已存在目标不会被 helper 覆盖。随后使用 latest 专用锁
  串行比较 `evaluatedAt`、再比较 `runId`；只有较新的候选才通过同步的独占临时文件和原子
  rename 推进 latest，较旧的并发运行只保留归档且不得以成功退出。锁超时保留已写归档并报错，不擅自删除或
  接管可能仍活跃的锁。`portfolio:verify` 要求 latest 与推导出的归档逐字节相同。
- 边界：上述是 persistence helper 提供的 append-only/no-overwrite 语义，不是操作系统
  immutability。归档仍是普通文件；拥有文件系统写权限的主体可以修改或删除它。文档与界面
  不得把这种应用层约束称为不可变存储。
- 理由：只有一个可覆盖的 latest 无法证明失败结果未被成功结果抹除；只在开始时读取 HEAD
  会让长运行中的编辑、checkout 或 rebase 被错误归到旧提交；仅有 dirty 标志又不能辨认实际
  执行的未提交评估源码。范围明确的来源指纹、无覆盖归档与 newest-wins latest 让来源和失败
  轨迹可复核，同时不持久化敏感正文。
- 后果：dirty 工作树上的 live run 在 scoped fingerprint 匹配时仍是诚实的开发观测，但不能
  作为“该精确 commit”的发布证据；release-grade eval 应在隔离的 clean commit 上重新执行。
  `pnpm ai:eval:live` 对初始化、部分运行或门槛失败返回非零；`pnpm portfolio:verify` 则可对
  `thresholdsPassed=false` 的报告成功完成自洽校验，并明确输出 `valid report; live eval
  failed`。后者只证明保存后的摘要、provenance 与派生字段自洽，不能从已丢弃的原始回答和工具
  输出重放现场，也不把失败变成通过。旧报告缺少字段时不得推断或回填。
- 验证方式：纯函数测试覆盖 clean/dirty/unavailable、HEAD 前后变化、来源指纹稳定/漂移；文件
  测试覆盖并发运行各自留存、同 run ID 不覆盖、newest-wins、latest 原子替换、锁超时归档
  保留、临时文件清理、路径/符号链接拒绝，以及 latest/archive 字节一致性。

### ADR-152：Live eval v3 将最终响应处置纳入逐例验收

- 状态：Accepted
- 日期：2026-08-30
- 决策：将 suite 升级为 `sales-chat-live-v3`。每条已完成 case 的最终文本只在内存中分类为
  `answered`、`empty` 或 `whole_request_refusal`；执行异常固定记录 `not_evaluated`。
  `expectedEvidenceAllowed=true` 只接受 `answered`，而
  `expectedEvidenceAllowed=false` 只接受明确的 `whole_request_refusal`。逐例 `pass` 必须包含该
  判定，`responseDispositionAccuracyPct` 门槛为 100%，且总门槛要求所有 case 的 `pass=true`。
- 分类边界：whole-request classifier 只识别高置信度的整题拒绝。局部风险、单项证据缺口、
  限定语或免责声明出现在有实质结论的回答中时仍归为 `answered`，避免惩罚合理的失败关闭
  说明。报告只保存安全分类、判定布尔值和 trim 后字符数，不保存原始模型回答。
- 理由：v2 可以在工具、参数和证据许可均正确时，让空最终文本或对本应回答问题的整题拒绝
  通过；它也不能证明证据被拒绝的 case 实际向用户返回了整题失败关闭。新增字段改变评分与
  报告契约，因此必须升级版本，不能把旧 v2 报告解释为符合 v3。
- 后果：`portfolio:verify` 从安全分类重算 disposition pass、逐例 pass、分数和总门槛，并校验
  error/empty/字符数的一致性；由于原文不落盘，它不声称离线重跑分类器。当前 checked-in v2
  latest 仍是最新诚实 provider 观察，但在新的 v3 verifier 下不构成验收证据；需要有凭据的
  新运行，且本决策不宣称 v3 已通过。
- 验证方式：表驱动中英文测试覆盖空文本、明确整题拒绝、局部缺口、风险说明与免责声明；
  scorer/schema 测试证明 allowed case 的空白或整题拒绝失败、denied case 只有整题拒绝通过、
  error 为 `not_evaluated`、100% disposition 门槛与 all-cases-pass 门槛均失败关闭。

### ADR-153：AI 成本、延迟与缓存观测以逐 step 白名单和显式价格快照失败关闭

- 状态：Accepted
- 日期：2026-08-30
- 决策：生产 `streamSalesChat()` 在每个 completed provider step 结束时只提取基础 token、
  SDK performance 和 allowlisted cache counts，再以 step-first ledger 生成 `ai.completion`
  strict log。原始 provider usage 只在内存中检查 OpenAI-compatible `prompt_tokens`、
  `completion_tokens`、`total_tokens` 的 own property、算术和 SDK 一致性，以及
  `prompt_tokens_details.cached_tokens` 的 own property；raw 不进入观测对象或日志。SDK 因字段
  缺失生成的 token/cache 0 不算供应商完整报告。每次 provider call start/end 单独计数；任一
  retry attempt 未产生 completed step usage，或请求 abort/响应租约超时，均保留已完成 step
  数值但标记 attempt coverage、token 与性能不完整，并禁止成本估算。客户端断开信号由 route
  传播至模型调用，abort 与 error 路径由幂等完成日志保护。
- 缓存边界：`AI_INCLUDE_USAGE` 默认 false；显式开启只发送标准
  `stream_options.include_usage`，不发送 `prompt_cache_key`、`cache_control`、TTL 或其他未验证
  provider 参数，也不代表已启用 prompt caching。cache hit rate 只在完整成功流中、每个 step
  都有合法显式 cache read 时计算；缺失 cache write 保持 unavailable/partial，不能补 0。
  三项输入明细必须满足 `noCache + cacheRead + cacheWrite = input`，避免把 cache write 在 input
  之外重复计费。
- 成本边界：默认 `costStatus=not_configured`。可选 server-only profile 必须 strict 校验精确
  model ID、版本、UTC `asOf` 与整数 micro-USD/百万 token 费率。flat 模式要求完整 input/output；
  cache-tiered 模式额外要求所有 cacheRead/cacheWrite/noCache 字段完整且自洽。模型不匹配、
  profile 无效、usage 不完整或 BigInt 计算结果超过安全整数时估算为 null。日志只保留 profile
  版本/日期和派生估算，不保留费率；私有 profile 不写入 committed live-eval JSON。该值称为
  estimate，不称为 billed cost。
- 延迟语义：记录 end-to-end request duration，并分别汇总 provider response、完整 step 和
  model time-to-first-output。后者可由 reasoning/tool call 触发，而最终正文仍在证据验证前
  缓冲，因此不得解释为用户可见文本 TTFT。缺失 step 或字段时保留已知值并标记性能不完整。
- 理由：SDK aggregate 会把缺失 cache 字段按 0 相加并丢弃 raw，直接使用会把“未报告”伪装为
  “0 命中”；默认价格和 provider 私有缓存字段则会制造不可审计的成本结论与兼容性风险。
- 验证方式：纯函数测试覆盖 missing/explicit zero/positive/冲突 cache、流中断、flat 与
  cache-tiered 价格、模型漂移、未来 profile、溢出和向上取整；fetch stub 锁定 usage 开关且
  provider body 不含 profile 或缓存参数；AI 流测试证明成功/失败日志的完整性与 known lower
  bound、retry attempt 与 abort 单次日志，route 测试证明 cancel/timeout 传播 abort；strict
  schema 拒绝 raw、成本状态和 token/cache/performance/attempt 不可能组合。

### ADR-154：Live eval v4 将 provider attempt coverage 纳入 token 完整性

- 状态：Accepted
- 日期：2026-08-30
- 决策：suite 升级为 `sales-chat-live-v4`。逐 case 保存 `attemptCount` 与
  `completedCount`，报告保存从 case 行求和得到的同名总计。`usageComplete=true` 除原有
  aggregate/逐 step ledger 自洽与 stream 完成条件外，还必须满足
  `attemptCount === completedCount === loopSteps`。provider retry 最终成功但先前失败 attempt
  没有 completed-step usage 时，已知 token 仍作为 lower bound 保留，但该 case、预算与总门槛
  全部失败关闭并停止后续 case。
- 理由：仅比较 completed steps 与 loop steps 会漏掉 SDK 内部失败后重试；失败 attempt 的用量
  未进入 ledger，若仍标记完整会低估 token 与成本，并使 160,000-token 验收预算不可审计。
- 后果：`portfolio:verify` 从逐例 attempt/completion 字段重算报告总计与 usage 完整性，不信任
  报告中的汇总或布尔值。checked-in v3 latest 保持原样且不回填不存在的计数，因此在新版本门
  下不是当前验收证据；只有经授权的新 provider 运行才能生成 v4 报告。
- 验证方式：runner、schema 与 portfolio ledger 测试覆盖正常多步、stream error、不可能的
  completed>attempted 组合，以及 2 attempts / 1 completed / 1 loop step 的 retry-success 路径；
  后者必须可重算为 `usageComplete=false`。

### ADR-155：Chat admission 先于共享限流并保留未完成数据库租约

- 状态：Accepted
- 日期：2026-08-30
- 决策：`POST /api/chat` 必须先取得单实例每客户 2 / 全局 4 的 admission lease，再访问
  PostgreSQL 共享限流桶。共享限流检查最多等待 3 秒；其事务使用 1.5 秒 lock timeout、
  2.5 秒 statement timeout 和 5 秒 idle-in-transaction timeout。公共 postgres-js 池另有
  10 秒连接、20 秒空闲连接、10 秒锁、120 秒语句与 60 秒 idle-in-transaction 上限。
  客户端取消或 3 秒 deadline 先结束 HTTP 请求时，不假设 driver 查询已取消；原 lease
  必须保留至底层 Promise 真正 settle，失败只记录白名单错误类型。只有进入 admission 的
  请求才访问并消耗共享小时配额；被并发门拒绝的请求不消耗持久配额。
  `DATABASE_URL` 禁止携带 `statement_timeout`、`lock_timeout`、
  `idle_in_transaction_session_timeout` 或可注入任意 GUC 的 `options` 查询参数，避免
  postgres-js 的 URL 合并顺序覆盖代码控制的 deadline；同时拒绝 decoded userinfo、path、
  query key/value 中的 C0/DEL 控制字符，防止 NUL 编码的 PostgreSQL startup-message
  参数注入绕过查询键检查。
- 理由：旧顺序在取得 admission 前等待 delete + UPSERT 事务。表锁、连接退化或池排队会让
  任意数量请求绕过应用全局 4 并发上限，最多占满公共连接池；简单地在 HTTP 超时后释放
  lease 又会让仍在后台运行的查询继续累积。
- 后果：数据库退化时，最多只有 admission 上限内的共享限流查询处于活动或等待状态；后续
  请求快速得到 429，已进入的请求在取消时得到 408、限流 deadline 时得到脱敏 503。若
  driver 工作永久不 settle，对应槽位会保持关闭直到数据库恢复或进程重启，这是有意的
  fail-closed 资源边界。小时配额不再把没有进入后续处理的并发拒绝计数。
- 验证方式：Route 对抗测试让共享 limiter 永不完成，证明第三个同客户端请求不再调用
  limiter；deadline 和 abort 均及时返回，同时底层 Promise settle 前不释放槽位；异常和
  结束路径保持幂等释放。PGlite 集成路径执行事务级 timeout 初始化并保持共享桶语义。

### ADR-156：Chat 请求取消贯穿上传、附件、审计边界与模型

- 状态：Accepted
- 日期：2026-08-30
- 决策：Route 取得 admission 后建立唯一 AbortSignal，并把客户端取消传播到 JSON body
  reader、图片/PDF 附件预处理和模型调用。挂起 body read 必须取消 reader 并返回脱敏 408；
  附件的 sharp/PDF 异步边界同时与原 15 秒 deadline 和该 signal 竞争，退出前沿用既有
  decoder destroy、reader cancel、page cleanup 与 PDF loading-task destroy。PDF 解析直接保留
  `getDocument()` 返回的 loading task，不再经由只暴露 document Promise 的封装；因此成功、
  拒绝、abort 与 deadline 均可执行 destroy。若 body reader cancel、PDF reader/page/loading-task
  cleanup 在 HTTP
  返回时仍未 settle，Route 将其登记为 deferred cleanup，并继续保留 admission lease 直至
  cleanup 真正 settle。模型配置、附件、audit repository 与 `ensureSession` 边界前后都重新
  检查 signal，已取消请求不得启动下一个阶段。响应流取消与绝对租约 timeout 继续中止
  provider；绝对期限触发的底层 stream cancel 同样登记为 deferred cleanup，不能先释放 lease。
- 理由：旧 abort bridge 只传给模型；客户端在限流通过后断开时，永不结束的上传仍可占用
  lease 30 秒，PDF/图片解析另可占用 15 秒，重复断连会让每客户或全局 admission 长时间
  不可用。
- 后果：body 和附件阶段的主动取消统一返回 `REQUEST_TIMEOUT` 408，不把内部 abort reason
  暴露给客户端。HTTP 响应与资源清理解耦，但并发容量不与清理解耦：无法立即清理的任务会
  fail closed 占住有限槽位，而不是在后台无界累积。已经开始且没有可取消 driver 接口的
  数据库 Promise 不会被伪装成已取消；数据库查询本身仍受 ADR-155 的全局 statement/lock/idle
  上限。
- 验证方式：请求体单测证明 abort 触发 reader cancel；Route 回归证明共享限流通过后的
  永不结束上传立即返回 408，但 reader cancel settle 前不释放 lease。真实附件路径用挂起
  PDF reader 证明 signal 从 Request 贯穿到解析器并清理 reader/page/loading task；畸形 PDF
  rejection 也必须 destroy。另以两个 promise 尚未 resolve 且 destroy 挂起的 PDF loading task
  证明第三个同客户端请求被 admission 429，destroy 完成后槽位
  才恢复。响应绝对期限测试还让底层 stream cancel 挂起，证明其 settle 前槽位不恢复；所有
  请求前置取消路径都不创建审计会话。

### ADR-157：Live eval v5 同时要求回答锚点与请求语言

- 状态：Accepted
- 日期：2026-08-30
- 决策：suite 升级为 `sales-chat-live-v5`。18 条 case 分别声明稳定 ID 的事实 anchor、
  决策 anchor 和按需法规免责声明 anchor；最终回答必须命中本 case 的全部 anchor。
  决策 anchor 可声明 `noneOf` 否定候选；产品 ready case 将“合规适配通过”与“供应就绪”
  拆为两个必需决策，因此中性主题标签、单轴结论或同一回答中的相反结论不能命中。
  runner 只在内存中检查 NFKC/大小写/空白规范化后的文本，并从剔除固定免责声明与 URL
  后的实质字符确定性判断 `en`、`zh-CN` 或 `indeterminate`。检测语言必须与 case locale
  相同；执行异常固定为 indeterminate、零匹配且两门失败。
- 评分与留存：逐例 `pass` 新增 `responseGroundingPassed` 与 `responseLocalePassed`；
  `responseGroundingAccuracyPct` 和 `responseLocaleAccuracyPct` 门槛都为 100%。报告只保存
  detected locale、matched/missing anchor ID、布尔值和 mismatch reason，不保存模型回答。
  `portfolio:verify` 从版本化 case 合同重新核对 anchor 全集、判定、score 和总门槛。
- 理由：v4 可以在工具、证据许可、回答处置和 usage 都正确时，让与问题无关或语言错误的
  最终文本通过。固定子串 anchor 是受限的合同探针，能关闭这一漏洞且避免持久化 provider
  正文；它不等于开放式事实准确度评审，也不能证明 anchor 周围所有叙述都正确。
- 后果：旧 v3 latest 保持诚实历史记录，但不满足 v5；必须在冻结的当前来源上获得授权后
  重新运行。不得为了通过而倒置 case 期望或把 anchor 命中宣传为模型整体质量分。
- 验证方式：表驱动测试覆盖相关/无关回答、错语言、双语固定免责声明、indeterminate 和
  error；schema/portfolio 测试拒绝伪造 pass、重叠或缺失 anchor 观测及汇总漂移。

### ADR-158：Chat 请求体超限立即 413，但清理完成前不释放 admission

- 状态：Accepted
- 日期：2026-08-30
- 决策：请求声明 `Content-Length` 超过预算或流式读取累计超过预算时，body reader 必须
  立即开始 cancel 并抛出携带 cleanup Promise 的 `RequestBodyTooLargeError`。HTTP 413 不等待
  可能挂起的 cancel；`POST /api/chat` 将该 Promise 登记进既有 deferred-cleanup tracker，
  原 admission lease 直到 cancel settle 后才释放。cancel rejection 被观察并脱敏，不能形成
  unhandled rejection 或把 413 改写为 500。
  JSON 与 multipart 的媒体类型判定在受限读取之后执行，使错误 `Content-Type` 不能绕过
  相同的字节上限、上传 deadline、reader cancel 与 admission 保留边界。
- 理由：不取消声明超限的 body 会让连接继续输送无用字节；在流式超限路径等待一个永不
  完成的 reader cancel 又会让 413 本身挂起。若先返回并释放 chat lease，后台未清理 reader
  仍可被重复请求无界叠加。
- 后果：客户端能及时收到稳定 413，同时后台 body 工作仍受每客户 2 / 全局 4 的同一并发
  预算约束。底层实现若永久不 settle，相应容量会保持失败关闭，直到连接/进程恢复。
- 验证方式：request-body 测试分别让声明超限和流式超限的 cancel 挂起，证明响应不被阻塞；
  route 对抗测试证明 413 后第三个同客户端请求仍被 admission 429，cancel settle 后槽位恢复。

### ADR-159：文档 review、publish 与治理快照共用版本化 provenance 真源

- 状态：Accepted
- 日期：2026-08-30
- 决策：文档 draft v1 只接受恰好一条 canonical `draft_created`；v2+ 只接受恰好一条
  canonical `document_reprocessed`。review 与 publish 都在事务内锁定当前 draft、document、
  source 和 marker，并要求其绑定 document ID、draft ID、source ID、content SHA-256、
  processing status、完整规范化 metadata 与完整 source fingerprint。缺失、重复、畸形或
  任一当前行漂移均返回治理冲突，且不得产生状态或审计副作用。
- 快照边界：治理 snapshot strict schema 对每个 document draft 应用同一 v1/v2+ 选择和唯一性
  规则，并验证 marker 引用、source fingerprint、metadata 与 reprocess superseded-draft
  闭包。canonical 计数同时要求 action、document entity type、entity key 与 draft 绑定；
  wrong-type/wrong-key 行无论是唯一还是额外 marker 都失败。导出物若不能证明该 provenance，
  解析、dry-run 和恢复都失败关闭。
- 理由：只在 reprocess 准备阶段验证不能阻止随后被修改的 source/document 在 review 或
  publish 时进入正式检索；只校验 v2 marker 还会让首次上传的 v1 draft 成为无审计信任缺口。
  快照若不执行相同规则，恢复可能重新引入在线事务已经拒绝的状态。
- 后果：历史中缺少严格创建 envelope 的文档不能靠推断补值，必须经受控修复后再审核。
  生产 manifest 和数据库 schema 不因此增加实体或字段。
- 验证方式：PGlite 集成矩阵在 review/publish 前分别制造 missing、duplicate、malformed、
  source/hash/status/metadata drift，并断言事务零副作用；snapshot 格式测试覆盖 v1/v2+ 合法
  marker 与相同漂移集合。

### ADR-160：外部 canary 绑定预期 release 与 Demo-only 产品边界

- 状态：Accepted
- 日期：2026-08-30
- 决策：显式设置 `CANARY_BASE_URL` 时，`pnpm ops:canary` 默认从 `docs/STATUS.md` 的
  portfolio machine block 读取完整 40 位小写 Git SHA，并要求 liveness/readiness payload
  返回同一 version；`CANARY_EXPECTED_VERSION` 只作为显式覆盖，schedule 通过
  `CANARY_STATUS_PATH=docs/STATUS.md` 固定来源。override 必须也是完整小写 SHA，空值不会
  静默关闭版本检查；新发布的 `release_id` 直接使用 clean HEAD commit SHA，使构建
  `APP_VERSION`、release 目录和 canary 预期一致。公开产品检查要求列表恰好包含
  `DEMO-ENG-100` 与 `DEMO-ENG-200`，且产品与来源均为 Demo、真实或分类错配产品数为 0。
- 理由：只检查 200/通用 schema 不能发现 DNS/代理仍指向旧 release，也不能发现未经批准的
  真实产品或 Demo/来源分类漂移已经进入公开目录。
- 后果：机器可读 STATUS 与运行 release 不一致会让 canary 失败，而不是继续宣称当前版本
  健康。该精确型号集合是作品站当前边界；有审批的真实产品上线前必须显式修改合同和测试，
  不能把 canary 放宽为“任意非空产品列表”。未设置外部 base URL 的本地默认 probe 不强制
  repository release SHA。
- 验证方式：纯函数测试覆盖 exact version/mismatch、STATUS 解析缺失/畸形/短 SHA，以及
  缺产品、多产品、真实产品和 Demo/source 分类错配；workflow 测试锁定 status path。

### ADR-161：公开双语壳层同时本地化结构标签、可访问入口与国家 metadata

- 状态：Accepted（公开页面范围）
- 日期：2026-08-30
- 决策：不增加 i18n 依赖，以 `Locale = "en" | "zh-CN"`、默认英文和 TypeScript 检查键
  完整性的词典覆盖公开首页、地图、国家详情、product-fit、chat、Header/Footer 及其
  loading/empty/error 状态。application scope、辖区类型、认证状态与列表标点只通过类型化
  helper 映射，未知 scope 显示“未记录”；来源标题和原文保持原语言。
- 状态与发现性：`POST /api/preferences/locale` 用 Zod 校验并写一年期、Path `/`、
  SameSite=Lax 的 `diesel_locale`，切换后刷新当前路径和 query。`<html lang>`、日期、国家名、
  页面 title/description/Open Graph 和 ARIA 文案随 locale 变化；公共 404 使用同一完整 Open Graph
  builder 生成本地化 document title、`og:title`、描述、locale、图片与 alt。app shell 在导航前提供本地化
  skip link，主内容可编程聚焦；公开异步状态以 status/live/busy 语义暴露给辅助技术。客户端
  只持久化白名单内的错误 code（或 `null`），每次渲染按当前 locale 取固定文案；未知 code、
  畸形信封、HTML 和 provider 原文均退回本地安全文案，切换语言不会继续显示旧语言错误。
- 理由：翻译大段正文但继续暴露 `non-road`、`active`、`country` 等内部 enum，会形成半双语
  体验；缺少 skip link、live region 和按国家 metadata 也会让键盘、读屏与分享预览无法识别
  当前上下文。
- 后果：`/admin` 与 `/dev` 继续不在本轮双语承诺中；新增公开文案键时必须同时补齐两份词典。
  语言切换不生成 locale 前缀 URL，因此分享状态仍由原路径/query 表达。
- 验证方式：单元测试锁定结构标签及未知 fallback；Playwright 覆盖英文默认、中文持久化、
  跨页/query 保留、移动端、`html[lang]`、skip link、live loading、国家 metadata 与 axe 扫描。

### ADR-162：新 release 由 commit archive、输入 manifest 与构建标记三重绑定

- 状态：Accepted
- 日期：2026-08-30
- 决策：新发布的 `release_id`、`BUILD_RELEASE_ID` 和验收 expected version 必须是同一个
  40 位小写 Git commit SHA。工作站从该 commit object 生成 `git archive`，不直接传输可能被
  skip-worktree/assume-unchanged 隐藏修改的工作区；同时生成
  `.release-input-manifest.json`，按 bytewise path 顺序记录所有普通 tracked blob 的大小、
  SHA-256、commit 与整体 input digest。构建脚本在依赖安装前和 Next build 后重算路径集合及
  内容，拒绝缺失、额外、symlink、submodule、commit 或内容漂移。
- 构建完成标记：`.build-complete` 不再只写一个自报版本字符串，而是严格 JSON，记录
  `releaseCommit`、manifest `inputDigest` 与 `.next/BUILD_ID`；runbook 在移动产物前对三者重新
  读取比较。旧时间戳 release 的 rollback 继续使用旧 release 自带的验收脚本，不放宽新 build
  合同。
- 理由：readiness 中 `APP_VERSION` 与命令参数相等只能证明两个自报字段一致，不能证明产物
  来自该提交；tracked-only rsync 也可能因本地 index flags 或传输遗漏失真。
- 后果：manifest 不替代 SSH/host 权限，也不是签名或秘密；它提供可信工作站到隔离构建目录
  的可重算完整性和误操作 fail-closed。含 symlink/submodule 的未来提交必须先显式设计发布
  语义，不能被当前脚本静默接受。
- 演进：ADR-165 将新发布的输入格式升级为绑定 Git mode 的
  `diesel-release-input-v2`，并用 build/deploy 双 marker 取代本 ADR 最初的 v1 构建标记交接；
  commit archive 与输入 lineage 决策继续有效。
- 验证方式：CLI 测试在临时 Git repository 中证明 manifest 确定性、内容篡改、额外文件、
  dirty tracked input 与错误 commit 全部失败；Bash 测试锁定完整 SHA 和构建前后双重验证。

### ADR-163：定时 canary 永久覆盖免费 Chat SSE，初始化失败也必须留档

- 状态：Accepted
- 日期：2026-08-30
- 决策：synthetic canary v3 每轮固定运行不调用 provider 的 `chat-direct-sse`，使用产品已有
  的确定性能力问答路径验证 request ID、SSE content type、UI-message v1、闭合正文及零
  reasoning part。真实 provider 探针单列为 `chat-provider-sse`，只有显式
  `CANARY_CHECK_AI=true` 才运行，不能用关闭付费调用同时关闭 Chat transport 验证。
- 报告边界：URL、timeout、STATUS 或 expected SHA 等初始化失败也原子写入 0600 JSON；只保存
  `INITIALIZATION_ERROR`、稳定 stage 和非敏感运行元数据，不保存 URL credentials、异常正文或
  响应体。定时 workflow 对报告 artifact 缺失使用 error。
- 理由：健康、国家和产品 API 全绿不能证明 `/api/chat` 路由与 SSE 协议仍可用；初始化前抛错
  但无报告会让事件复盘只剩易变 stderr。
- 验证方式：纯函数和 CLI 测试证明默认五个免费 probe、provider probe 独立开关、带凭据 URL
  的初始化失败仍生成脱敏报告，且无临时文件残留。

### ADR-164：公开治理发布读回必须来自版本化脚本

- 状态：Accepted（部署脚本迁移第一步）
- 日期：2026-08-30
- 决策：公开治理读回不再由生产 Shell 使用 `sed` 从 `docs/DEPLOYMENT.md` 抽取函数。
  `scripts/deploy/validate-public-governance.sh` 是唯一可执行实现；发布在建立治理快照前将它
  复制为 release 对应 backup 目录中的 root-owned 0700 副本，正常发布和
  `PUBLISH_COMMITTED` 人工收尾都执行该副本。新脚本只接受 40 位小写 commit SHA，固定
  `https://jamesky.site`，忽略 `.curlrc`、禁用代理、限定 HTTPS，并把单次响应上限设为
  4 MiB。
- 理由：从 Markdown 动态生成生产代码无法独立执行、做 Bash 语法检查或绑定 release；文档
  编辑也可能无意改变恢复契约。公开读回还会以 root 身份处理远端响应，不能允许用户级
  curl 配置或无界响应改变目标和资源边界。
- 后果：验证脚本会随 commit archive 和 release input manifest 一起绑定；保存的副本让
  committed 收尾不依赖后来修改的 runbook。97 国发布协调、快照/marker 状态机与逐国 ingest
  仍暂时位于 runbook，后续迁移不得把本 ADR 描述为整条发布链已经脚本化。
- 验证方式：部署脚本测试要求该文件为可执行普通脚本且通过 `bash -n`，非法 release ID 在
  网络访问前以 64 失败，伪造公网版本会失败关闭；部署合同测试把 runbook 和脚本内的 97 国
  顺序同时与 `portfolioReleaseCountryIso3s` 比较，并拒绝重新出现 Markdown 函数抽取。

### ADR-165：构建工件通过版本化 root-side handoff 进入 release

- 状态：Accepted（部署脚本迁移第二步）
- 日期：2026-08-30
- 决策：`scripts/deploy/prepare-release-runtime.sh <release-id>` 是新 release 从隔离构建到
  runtime-ready 状态的唯一 root 入口；`docs/DEPLOYMENT.md` 不再内联 workspace 创建、
  `cp -a`、builder 调用、工件 `mv` 或 `touch .deploy-ready` 的可执行副本。脚本固定生产路径、
  Node 22 binary 与身份边界：可写 HOME 保持 `/opt/diesel/build`，workspace parent 则是
  `root:diesel-build` 0710 的 `/opt/diesel/build-workspaces`，每个 SHA workspace 才临时归
  `diesel-build` 所有。build 返回后整个 workspace 先冻结为 `root:root` 0700，再信任 marker
  或工件。
- 输入与工件格式：`diesel-release-input-v2` 在 commit、bytewise path、大小和内容 SHA-256
  之外绑定 Git `100644` / `100755` mode，传输造成的 executable bit 双向漂移均失败。
  `.build-complete` 升级为 `diesel-build-complete-v2`，以固定顺序汇总 `.next` 与
  `node_modules` 的目录、普通文件、闭包内相对 symlink、总字节和 SHA-256，并同时绑定
  release commit、input digest 与 Next BUILD_ID。普通文件只把 executable bit 作为权限语义；
  uid、gid、mtime 和其余 mode 不进入摘要，hardlink、特殊节点、破损或越界 symlink 全部拒绝。
  该有界 marker 不为大型 `node_modules` 保存逐文件 JSON 清单。
- root 交接：脚本先在冻结 workspace 重算 v2 marker，再移除被明确排除的 `.next/cache`，
  以不跟随 symlink、`--reflink=never` 的 root copy 将工件写为 candidate 下的新 inode，而不是
  `mv` builder 创建的 inode。这样残留 lifecycle 进程即使持有旧 writable file descriptor，
  也只能修改待删除的 workspace。目标端重新建立 `diesel:diesel` 0750 cache，并在完整工件
  复算通过后生成 `diesel-deploy-ready-v1`；marker 固定为 `root:diesel` 0640。激活前使用固定
  Node binary 执行 `release-artifact-manifest.mjs check-ready`，重新计算实际工件并重验 tracked
  release 输入与两个 canonical shared runtime link；同时确认 build/deploy marker 完全一致。随后
  以不跟随 symlink 的树扫描拒绝 candidate 内的 nested filesystem，对 release、release root 与
  deploy root 执行 `sync -f`，逐一 fsync marker、工件根与父目录，并从 durable bytes 再做一次
  metadata/`check-ready`，之后才允许切换 `current`。handoff 起点后的失败保留冻结 workspace 与
  HOME 供取证；它们不能被手工提升为 release。
- 兼容性：旧时间戳 release 没有 v2 marker，rollback 仍把其 `.deploy-ready` 当作受信路径下的
  普通文件，并运行旧 release 自带的完整 verifier；不得为了统一格式而破坏历史恢复。该兼容
  只适用于回滚，不能让新的 commit-SHA candidate 跳过 `check-ready`。
- 边界：artifact digest 只证明这一次 build workspace 到 candidate release 的交接完整性，
  不是代码签名、SBOM、供应链证明或可复现构建成绩。Next BUILD_ID、平台相关依赖、pnpm 元数据
  与构建产物中的绝对路径都可能让同一 commit 的另一次构建得到不同 digest；`.next/cache`
  是有意排除并在交接后重建的运行时可变目录，因此启动后的全树不能拿 build digest 作持续
  完整性监控。
- 理由：Markdown 中百余行 root 命令无法独立做行为测试，builder-owned parent 可被预置路径，
  原先 `mv` 又会把构建用户可能仍持有 writable fd 的 inode 直接带入 release。另一方面，逐文件
  artifact JSON 会随 `node_modules` 膨胀；聚合且可重算的版本化合同能在不新增依赖的情况下
  同时关闭文档漂移、路径替换、部分复制与交接后字节漂移。
- 后果：每次发布会在 workspace 和 candidate 多次完整读取 immutable 工件，并在 root copy
  期间暂时占用双份磁盘；这是换取新 inode 和可验证交接的明确成本。运行时共享环境、`.data`
  与重建后的 `.next/cache` 不属于不可变 artifact closure。`sync -f` 会刷新 candidate 所在文件系统，
  其 I/O 延迟是 finalized release 不依赖 page cache 的明确成本。
- 验证方式：artifact CLI 测试覆盖确定性摘要、内容/执行位/路径漂移、绝对/破损/逃逸 symlink、
  hardlink、特殊节点、cache 排除、marker 权限及 `finalize` / `check-ready`；root handoff 的隔离
  fixture 证明预存的 readiness 普通文件或 symlink 会在创建 workspace 前失败关闭。部署合同测试
  锁定冻结、禁用 reflink 的新 inode copy、目标端复算与 ready marker 的先后顺序，并要求 runbook
  只调用版本化 prepare 脚本、在切换前使用固定 Node 与 `root:diesel:640` marker 门。真实 Linux
  host 上的完整 builder/copy 路径仍须由发布演练验证，不能把静态合同测试写成已执行的部署证据。

### ADR-166：97 国治理写入队列必须由 trap-owning 发布 Shell source

- 状态：Accepted（治理发布脚本迁移第二步）
- 日期：2026-08-30
- 决策：`scripts/deploy/publish-governance-country-fixtures.sh` 是当前 97 国定向 fixture
  写入顺序的唯一可执行实现；`docs/DEPLOYMENT.md` 不再内联 97 条数据库命令。该文件只能被
  已持有 PostgreSQL 治理维护锁、已建立 `RECOVERY_REQUIRED` 且安装完整
  `ERR` / `INT` / `TERM` / `HUP` / `EXIT` 恢复 trap 的发布 Shell source，直接执行在任何
  写入前以 64 拒绝。调用前还必须把 cwd 与 `/opt/diesel/current` 同时绑定到完整 commit SHA
  对应的 release。
- 边界：该脚本只按固定顺序执行 97 次 `ingest-accepted-fixtures.ts --country=<ISO3>`；不安装或
  清除 trap，不重试或断点续跑，不运行公网验证，也不创建、删除或重命名 recovery/commit
  marker。成功只表示写入队列完成，仍须由 caller 运行版本化公开读回，再把
  `RECOVERY_REQUIRED` 原子重命名为 `PUBLISH_COMMITTED`。
- 理由：Markdown 中的生产写入命令无法独立通过 Bash 语法和失败注入测试，漏行、重复或顺序
  漂移会产生部分治理图。另一方面，把整个队列放进新的 `bash script` 子进程会扩大维护锁
  wrapper 向原 trap-owner 发送信号后等待子循环的窗口；source 函数保留原 Shell 和现有逐命令
  恢复语义，而不提前拆动跨数据库/host 的 commit 状态机。
- 失败语义：release、环境、维护 token、cwd/current、snapshot hash、marker 权限或五个 trap
  任一不符都在首次写入前失败；首个国家命令非零即停止并保留其状态，由 caller 的既有 trap
  恢复 v4 快照。恢复完成后只能从 fresh snapshot 重跑整轮，不能从进度位置继续。
- 验证方式：脚本测试要求 source-only/`bash -n`，用 fake corepack 证明恰好 97 次固定参数、首错
  即停、状态码传回且 caller traps 不变，并表驱动覆盖错误 release、环境、token、cwd、
  recovery marker、commit marker 与缺失 trap 在零写入前失败；部署合同测试把脚本队列和公开
  validator 同时与 `portfolioReleaseCountryIso3s` 比较，并锁定
  rehearsal → sourced queue → public validation → marker rename 的顺序。

### ADR-167：release 传输与 builder 临时状态必须保留主机权限边界

- 状态：Accepted
- 日期：2026-08-30
- 决策：工作站只能用 `rsync -a --no-owner --no-group --no-perms` 把 commit archive 内容写入
  已由主机预创建的 release 目录，并在传输后立即复查目标仍是非 symlink 的
  `root:diesel` 0750。archive 根目录的本地 mode 不得覆盖主机根目录，但 tracked 文件的
  executable 语义仍须保留，并由 `diesel-release-input-v2` 再次校验。
- builder 边界：runtime 准备在任何 workspace 创建前确认 `diesel` 与 `diesel-build` 使用不同
  的非 root UID、不同非 root 主 GID，且 supplementary groups 不含对方主组；同时提前确认
  `corepack` 存在并关闭下载提示。每个 commit 使用独立 HOME，成功或失败都只清理 canonical
  parent 下、名称等于完整 commit SHA 且不是 symlink 的本轮 workspace/HOME；原命令失败码
  保留，cleanup 失败则以 70 失败关闭。
- 理由：普通 `rsync -a` 会把本地 archive 根 0755 复制到目标根，使后续严格权限预检在真实
  happy path 自相矛盾；复用 builder HOME 或只在成功路径删除 workspace 又会让失败构建跨
  release 留下可写状态。错误 supplementary group 配置还会让 builder 读取 shared 生产环境。
- 边界：精确目录清理和 per-release HOME 解决磁盘残留及用户态缓存串轮，不会终止已脱离父
  Shell 的 lifecycle 后台进程。完整进程收口仍需 transient systemd cgroup 与
  `KillMode=control-group`，在该主机演练完成前不得宣称构建已具备进程级沙箱。
- 验证方式：真实 rsync 临时目录测试跨 macOS openrsync / GNU rsync 只锁定目标根 0750、普通
  文件无执行位、tracked executable 保持可执行和相对 symlink 不变；Bash fixture 覆盖错误
  UID/GID/group topology、builder 原状态 23 失败后的精确双目录清理，以及替换为 symlink 时
  拒绝递归删除。

### ADR-168：所有管理 API 响应统一禁止缓存

- 状态：Accepted
- 日期：2026-08-30
- 决策：`handleAdminRoute` 在 request observer 生成最终响应并附加 request ID 后，统一覆盖
  `Cache-Control: private, no-store, max-age=0` 和 `Pragma: no-cache`。该策略覆盖成功以及
  401、403、409、429/输入错误、500 等所有出口；handler 提供的 public cache 指令无效。
- 理由：管理身份由生产受信代理写入 `oai-authenticated-user-email`，响应包含角色相关草稿、
  审计和动作结果。任何浏览器、代理或共享缓存复用都可能把一个用户的管理状态交给另一个
  用户；逐 route 设置 header 容易漏掉异常出口。
- 后果：管理读取不能依赖 HTTP 缓存降低数据库负载，前端继续使用显式刷新/取消和服务端
  read model；公开只读 API 的独立缓存策略不受影响。
- 验证方式：route 单测覆盖成功、认证失败、权限失败、冲突和内部异常，并证明 handler 即使
  返回 `public, max-age=3600` 也会被公共边界覆盖，同时保留 `X-Request-Id`。

### ADR-169：Dashboard 只暴露被消费的治理投影

- 状态：Accepted
- 日期：2026-08-30
- 决策：管理 Dashboard 使用独立 10 表 read model，不查询或返回历史 import batch。当前 draft
  的数据库 select 和 strict DTO 只含 `id`、`entityType`、`entityKey`、`version`、
  `workflowStatus`、`createdBy`、`changeReason`、`payload`；`updatedAt` 仅用于排序。
  published baseline 独立查询和映射，只向客户端
  返回 `payload/version/publishedBy/publishedAt`，entity 定位字段不越过 service 边界。audit
  在数据库端限制最近 30 条。Dashboard API 不返回 principal，route 仍逐请求鉴权，Header/角色
  展示继续使用 `/admin` 服务端渲染得到的 `initialPrincipal`。
- 理由：未消费的批次历史、完整 draft 行、baseline 存储字段和重复 principal 增加跨用户管理
  数据暴露面，也让未来 `.select()`/spread 容易静默扩张合同。UI 截取 30 条却查询 100 条 audit
  还会产生无收益的数据库和序列化成本。
- 安全边界：review/publish API 继续重新认证 actor，并在事务/行锁中读取完整 draft；非 admin
  自审和发布状态校验不依赖 Dashboard DTO。CSV preview/confirm 是独立写入合同，本决策不删除
  其当前批次结果。
- 验证方式：schema 测试用非空 draft/baseline 拒绝额外存储字段和旧 principal/import 字段；
  数据库集成测试断言精确 key 集、30 条 audit 顺序和历史 baseline 回查；Playwright 证明
  SSR 身份/角色控件、review/publish 与刷新行为不变。

### ADR-170：release handoff 必须在临时 GitHub-hosted Linux 主机执行真实演练

- 状态：Accepted（交接基线；builder lifecycle 部分由 ADR-171 取代）
- 日期：2026-08-30
- 决策：非 schedule 的 CI 新增 `linux-release-handoff` job，依赖 quality 且只允许
  `runner.environment=github-hosted` 的临时 Ubuntu runner。checkout 不持久化凭据，从当前
  commit 生成 clean `git archive` 与 input manifest，再通过 `sudo /usr/bin/env -i` 调用
  root helper。helper 在 `${RUNNER_TEMP}` 隔离根内创建临时 `diesel` / `diesel-build` 身份，
  使用真实 GNU rsync、`runuser`、Corepack/pnpm frozen install、Next build、
  `prepare-release-runtime.sh` 和 artifact `check-ready`；最后核对 marker、权限、builder
  进程/目录无残留，并按记录的 UID/GID 与 canonical 路径精确清理。唯一
  `Required CI gate` 显式依赖该 job 成功。
- 理由：macOS/openrsync 行为测试和 fake `id` / `stat` / `runuser` fixture 不能证明 GNU
  ownership/mode、真实用户切换、Corepack 安装、Next 构建和 root → builder → runtime
  工件交接能在 Linux 上闭合。只做静态合同会把最接近生产且成本最高的失败留到人工发布。
- 失败语义：非 GitHub-hosted/root Linux、身份或数字 ID 冲突、路径非 canonical、可用空间
  少于 8 GiB、构建/摘要/readiness 失败、builder 残留或 cleanup 失败都失败关闭；cleanup
  失败统一返回 70。创建身份时短暂屏蔽可捕获信号，成功记录 ownership 后立即恢复 trap；
  清理前再次核对精确 UID/GID，不能删除被替换的主体。版本化 prepare 脚本在子 shell 中
  source，不能覆盖 helper 的外层清理 trap。cleanup 自身忽略二次可捕获信号；若进程无法
  KILL、身份漂移或 user 删除失败，则保留对应身份和临时根交给 ephemeral runner teardown，
  并以 70 明确失败，不能靠静默强删把泄漏伪装成成功。
- 边界：该 job 只证明一个 commit 在一次临时 GitHub-hosted Ubuntu runner 的隔离 temp root
  完成 release handoff。它不证明真实 `/opt/diesel`、SSH、VPS UID/ACL/mount、registry
  持续可用、Nginx/PM2/PostgreSQL、生产密钥/数据、systemd PID 1/cgroup 或真实发布/回滚。
  该版本基线尚未覆盖 transient systemd cgroup；后续边界与当前实现见 ADR-171。首个成功
  Actions run 出现前，本地只能称“已接线”，不能称“已通过 Linux 演练”。
- 验证方式：本地 `bash -n`、坏输入/runner 拒绝和 workflow 静态合同证明脚本可执行且已成为
  required dependency；真实 Linux 结论只来自远端 job 成功。预计单次 8–18 分钟、5–7 GiB，
  当时工作流预留 30 分钟并在突变前硬性要求至少 8 GiB 可用空间；ADR-171 因 45 分钟
  builder runtime 上限把当前 job deadline 调整为 60 分钟。

### ADR-171：release builder 必须由 retained transient systemd service 收口

- 状态：Accepted（代码与 CI 已接线；首个远端 systemd 结果待观察）
- 日期：2026-08-30
- 决策：root-side prepare 在任何 workspace/HOME 创建前持有部署根中 `root:root` 0600 的
  全局 build lock，确认 PID 1 是 systemd、manager/client 版本一致且至少为 245、主机使用
  cgroup v2，并拒绝既有同名 unit、同 cgroup 进程或任何 `diesel-build` UID 进程。runtime 与
  builder 的 group 列表都必须恰好只有各自主 GID，不能继承 docker/sudo 或其他 supplementary
  group。builder HOME
  parent 从 builder-owned 0700 改为 `root:diesel-build` 0710；只有 root 能创建或替换每个 SHA
  的 HOME。
- service 合同：每个 SHA 使用确定性的 `diesel-build-<40-hex-sha>.service` transient
  `Type=exec` service，显式设置 `User/Group=diesel-build`、root 指定的 working directory、
  `system.slice`、`KillMode=control-group`、TERM→KILL、45 分钟 `RuntimeMaxSec`、30 秒
  `TimeoutStopSec`、`Restart=no`、`Delegate=no`、`UMask=0077`、`NoNewPrivileges=yes` 和
  `ProtectControlGroups=yes`。payload 只接收 `/usr/bin/env -i` 白名单，stdin 为 `/dev/null`。
  controller 异步启动并用 `RemainAfterExit=yes` 保留退出元数据；禁止把 `systemd-run --wait`
  或 `--collect` 的返回码当作 payload 结果。
- 判定与清理：成功必须同时满足 `Result=success`、`ExecMainCode=CLD_EXITED(1)` 和
  `ExecMainStatus=0`。普通非零保留其 status；signal 即使被 systemd 视为 clean 也映射为
  `128+signal`；runtime timeout 与 OOM 保持非零。main terminal 后若 cgroup 仍含 descendants，
  本轮直接失败 70。无论成功失败，controller 都在冻结、hash 或 copy 前 stop 精确 unit，等待
  unload，再以 cgroup v2 `populated`、所有 `/proc/<pid>/cgroup` 的精确路径边界和 builder UID
  连续两轮证明零残留。unit metadata 漂移、stop/query/proof 失败时不能删除 workspace/HOME，
  cleanup 统一覆盖为 70；只有 proof 成功才执行既有 SHA/canonical/non-symlink 精确目录删除。
  已验证合同的 unit 若首次 bounded stop 失败，会先对该精确 cgroup 发出 SIGKILL 并重试 stop；
  即使 fallback 命令返回成功，仍必须以 unload、cgroup path 消失和 residual proof 为准。
  quiescence 后还必须把 workspace manifest 与 root-owned release manifest 逐字节比较，并仅用
  release 根中预检过的可信 input/artifact verifier 绝对路径复核；root 不执行 workspace 中的
  verifier 副本。Next 会改写 tracked `next-env.d.ts`，所以 builder 先从 per-release HOME 快照
  恢复并执行早期校验；unit 与 UID 清空、workspace 冻结后，root controller 必须再从 builder
  不可遍历的 canonical release 覆盖该文件，之后才开始可信复核。cleanup 无法证明而保留取证
  状态时，生成文件或快照不得视为候选工件。
- 理由：`systemd-run --wait` 在部分 systemd 版本的 signal 退出场景可能返回 0；只杀 main PID
  又会遗漏 lifecycle 后台进程。保留 unit 的 manager 元数据解决真假成功判定，control-group
  stop 与独立 residual proof 则在工件被信任前建立 quiescence barrier。全局锁和全 UID 前后
  扫描避免同一共享 builder 身份的并发 release 互相污染或由 unit 外进程替换状态。
- 失败与恢复边界：controller 自身的 HUP/INT/TERM 在 cleanup 成功时保留 129/130/143；第二次
  signal 在 cleanup 中被忽略，cleanup 失败始终为 70。SIGKILL、掉电或不可杀 D-state 不能由
  shell trap 修复，磁盘状态会被保留；下一轮因 unit、UID 进程或目录非空而失败关闭，需人工
  取证和恢复，不自动 stop 属性漂移的 unit。GitHub job 固定 Ubuntu 24.04 并预留 60 分钟，
  但首个远端 run 尚未观察，目标 VPS 的 systemd 版本、cgroup 与真实发布/回滚也仍须演练。
- 验证方式：Bash/TypeScript 测试锁定 signal trap 先于外部命令、manager 三元组到退出码映射、
  精确/nested/lookalike cgroup 路径、cleanup proof 失败时双目录保留、全部 unit property、禁止
  builder `runuser` fallback、quiescence 早于 artifact freeze，以及固定 runner/deadline 和
  required-gate 依赖。GitHub-hosted job 将对当前 commit 执行真实 systemd success path、后台
  child 泄漏失败和 `exit 23`/SIGTERM→143 metadata canary；在该
  run 成功前，只能声称实现与门禁已接线。

  TypeScript 的主增量状态固定在 `.next/cache/tsconfig.tsbuildinfo`；E2E 配置生成器把同一字段
  覆写到 `.next-e2e/cache/tsconfig.tsbuildinfo`。这与两个 Next `distDir` 的隔离一致，也避免
  strict release input manifest 因仓库根生成状态而漂移；两个 cache 都属于可丢弃构建输出。

### ADR-172：Live eval v6 强制 usage 请求并禁用模型调用重试

- 状态：Accepted
- 日期：2026-08-30
- 决策：suite 升级为 `sales-chat-live-v6`，保留 v5 的 18 条 case、回答 anchor、locale 与
  逐 attempt/completion 观测。runner 在动态加载模型配置前把 `AI_INCLUDE_USAGE` 固定为
  `true`，并只接受远端 `@ai-sdk/openai-compatible` adapter 且 profile 明确记录 usage 请求；
  不满足时在首次 provider 调用前以 `model_configuration` 初始化失败关闭。生产
  `streamSalesChat()` 的兼容性默认仍为一次 retry，但 live eval 每次调用显式传
  `maxRetries=0`；v6 报告严格写入 `maxRetriesPerModelCall: 0`，`portfolio:verify` 同时复核
  provider profile 和 retry 预算。
- 理由：AI SDK 只在完成的 provider stream 中取得 usage，失败 attempt 可能没有可对账用量；
  对本来就会因 attempt/completion 不一致而失败的 eval 调用进行 retry，只会扩大不可观测
  消费。强制 usage 请求与零 retry 能在调用前建立可机器审计的最窄合同。
- 边界：`160,000` 仍是报告的调用后验收上限，不是 provider 账单级硬限额。可配置 endpoint
  与 model 没有统一 tokenizer/chat template，输入 token 在请求前不可精确证明；18 × 5 个
  成功 step 的 output 上限本身也可超过 160,000。严格预消费上限仍需要固定模型的精确
  tokenizer/preflight 或 provider 侧原子预算。v6 只能证明最多一次 attempt/模型调用、要求
  usage 且缺失时失败关闭，不能证明 provider 实际消费永不越界。
- 验证方式：纯函数测试拒绝 demo adapter 或 `includeUsage=false`；生产 stream 单测证明
  `maxRetries=0` 时首错后没有第二次调用；schema 要求 v6 的零 retry 字段且保持 v5 archive
  兼容；portfolio 测试拒绝双方一致伪造的 `includeUsage=false`，并从逐例 ledger 重算报告。

### ADR-173：公开展示不能从自由文本反推结构事实

- 状态：Accepted
- 日期：2026-08-30
- 决策：应用生成的 citation title 使用 7 类 strict Zod descriptor，在客户端按 locale 从
  typed facts 重建；知识文档、原始实体名、来源标题、真实证书号以及没有 descriptor 的历史
  citation 始终逐字保留，不保留正则 fallback。国家名称调用方必须显式传 `isDemo`；已知 Demo
  国家只有 ISO2、ISO3、canonical 名称、分类及可用来源身份同时匹配才使用中文展示映射。
  认证有效期/功率范围的未知起点或下界显示“未记录”，只有已知起点/下界且终点/上界缺失时
  才显示“开放”。
- 理由：把“适用限值”“成员关系”“demo fixture”等展示字符串当作数据协议，会误翻译碰巧
  同名的真实文档，并可能把 identity 漂移或未知边界伪装成已知事实。原始证据与生成展示必须
  有独立、可校验的信任边界。
- 兼容性：原 `title` 和 locator 继续保留用于审计及 legacy fallback；新增字段均为 optional
  nullable，不修改数据库 schema。前后端仍应原子发布，因为长期打开的旧 client bundle 可能
  用旧 strict schema 拒绝新增字段。
- 验证方式：Zod/formatter/producer 单测覆盖 7 类 descriptor、真实文档标题碰撞、Demo
  identity/source 漂移和 AnalysisSource 传播；国家名负例证明同后缀不再触发翻译；中英表驱动
  测试覆盖认证范围四种缺失组合，Demo Playwright 验证来源卡展示。

### ADR-174：根错误边界用独立 Next fixture 做真实浏览器验证

- 状态：Accepted
- 日期：2026-08-30
- 决策：`tests/fixtures/global-error-app` 作为 test-only Next 应用，直接复用生产
  `src/app/global-error.tsx`，通过 fixture 专属 Cookie 在根 layout 抛出受控异常。独立
  Playwright project 验证默认英文与 `diesel_locale=zh-CN` 两条真实恢复路径、`<html lang>`、
  文案、按钮及 React hydration warning；fixture 不进入生产 `src/app`，不增加生产测试 route，
  不依赖 Next 私有状态或新增浏览器测试依赖。
- 事实边界：Next 根失败的 HTTP 500 首先返回不含本地化文案的中性 error shell，再由客户端
  global-error 边界恢复；React 的 request-less server snapshot 仍固定为英文，但不能把该单元
  快照描述成实际根失败响应 HTML。
- 验证方式：fixture server 在启动后恢复被 Next 改写的 `next-env.d.ts`，生成目录同时被 Git
  与 ESLint 排除；Playwright 断言中性 500 shell 和两种最终 DOM，现有静态单测保留 server
  snapshot 与 typed document copy 的窄合同。

### ADR-175：公开客户端持久状态只保存类型化事实，不保存展示文案

- 状态：Accepted
- 日期：2026-08-30
- 决策：公开页面跨 render 保留的错误、附件和程序化来源状态只保存 closed union、严格
  Zod DTO、稳定错误码或布尔状态，展示时再按当前 locale 生成文案。国家地图、详情与适用性
  摘要只保存 `CountryApiErrorCode | null`；Home 只保存加载状态；locale 写入保存请求身份；
  Chat 附件保存 10 类 typed error facts，释放附件只保存校验后的文件名。服务端 `message`、
  `Error.message`、已翻译字符串和内部 product-fit reason code 都不得进入可见 retained state
  或复制摘要。程序生成 locator 与补数类别分别使用穷尽 descriptor/reason-code 分派；词典插值
  单次扫描模板，不能把外部值中的 `{placeholder}` 当作第二轮指令。
- 并发边界：Home、地图、国家详情和适用性摘要的请求同时使用 AbortSignal 与 request identity；
  locale 写入也绑定发起语言和 request ID。迟到的 success、error 或 finally 不能覆盖新请求或
  新语言。Chat 的 `data-releasedAttachment` 只存在于客户端消息展示，下一次请求会删除所有
  此类占位以及历史用户附件字节，当前轮附件仍按既有合同发送；请求消息快照生成后，客户端
  消息中的 file part 立即降级为仅含校验后文件名的 typed placeholder，同时清空临时
  `FileUIPart[]`。原始 `File` 只在待发送或失败提交状态中保留，以支持用户明确选择的原样重试
  与编辑重试；图片预览卸载时必须 revoke Object URL，FileReader abort 必须结算为固定错误事实。
  Chat 活跃请求 owner 绑定发起 locale；其间 locale 改变时，新实例只继承最近一次已结算消息快照，活跃轮次
  不进入该快照，旧实例 effect cleanup 必须 abort transport。completion callback 另核对提交所属 locale，
  因而旧语言流即使忽略取消后迟到，也只能写入已退休的 store，不能恢复旧消息或重试状态。
- 理由：把本地化字符串或远端错误正文写入 React state，会在 Cookie locale 改变后留下旧语言，
  也可能让服务端诊断和网络错误泄漏到公开 UI。只做 abort 仍不足以防止已经进入 promise 链的
  迟到提交；类型化事实、当前词典渲染和 request identity 必须同时存在。
- 验证方式：纯函数测试覆盖所有附件错误 kind、国家错误码、20 个 product-fit reason、恶意
  占位符与畸形 client-only data；Playwright 延迟旧 Home/地图/locale 请求，在切换语言后再
  释放，并断言旧文案、服务端 poison message 与迟到状态均不可见；受控 Chat SSE 回归在请求
  活跃时切换 locale，要求浏览器 abort 旧请求、迟到 marker 不可见且新 locale 请求可继续完成。
  附件浏览器回归另外验证
  请求响应仍挂起时 base64 已从消息 UI 释放、移除预览会 revoke Object URL，以及 FileReader
  abort 不会锁死发送控件或触发网络请求。

### ADR-176：公开浏览器策略从只上报升级为强制 CSP

- 状态：Accepted
- 日期：2026-08-30
- 决策：Next 全局响应使用 `Content-Security-Policy`，不再使用
  `Content-Security-Policy-Report-Only`。保留当前 Next 无 nonce 架构需要的 script/style
  指令；MapLibre 5.24.0 的打包入口会从内联代码创建 Blob worker，因此只新增
  `worker-src 'self' blob:`。Chat 本地附件预览继续复用既有 `img-src 'self' data: blob:`；
  `blob:` 不进入 `default-src`、`script-src` 或 `connect-src`。生产态
  `connect-src` 只允许 `'self'`；只有 Next development-server phase 为 HMR 加入
  `ws:` / `wss:`，不为任意外部 HTTPS 主机开放浏览器连接。
- 理由：只上报策略不会阻止被注入的 object、非允许 frame 或越界资源实际执行；直接强制可把
  已有边界变成浏览器执行控制。把 `blob:` 只授予两个有代码证据的资源类型，避免为 MapLibre
  worker 或本地图片预览扩大脚本与网络来源。
- 边界：当前无 nonce 的静态/缓存友好 Next 路径仍需要 inline script/style 兼容，开发模式还
  使用 eval 调试能力；`unsafe-eval` 由 Next config 的 development-server phase 显式加入，
  production build/start 不包含它。Zod 4 浏览器入口在首次 object parse 前调用官方
  `config({ jitless: true })`，跳过会触发 CSP 违规的 `new Function` 能力探针并使用非 JIT
  schema 路径。进一步移除 inline 需要独立的 nonce/SRI 设计，不能在本决策中靠扩大其他来源
  补偿。外部链接可导航，但不会因此获得脚本、worker 或 object 执行权限。
- 验证方式：配置单测要求 enforced header、拒绝 Report-Only，并锁定 Blob 只出现在 image 与
  worker 指令，同时逐 phase 证明 eval 及 WebSocket 只存在于 development。Playwright 监听真实
  `securitypolicyviolation`，分别在 development server 与 production build/start 等待
  MapLibre GeoJSON worker ready，再生成 Chat 图片 Object URL；两种运行时都要求预览可见且
  全程无意外违规，production 响应另要求不存在 `unsafe-eval`，并由一次
  故意的外部 `fetch` 探针证明非同源连接真的被 `connect-src` 阻断。Zod 单测把全局 Function constructor
  替换为会失败的探针并证明 jitless 入口不会调用它。被 `Required CI gate` 汇总的既有 e2e job
  在开发态 Playwright 后重新执行 production build 与 `test:e2e:csp:production`，因此该生产路径
  不是只依赖本地手工回归。
- 2026-09-12 增补：已获批的 MapLibre 6.9.0 迁移改用同源 ESM worker 及相对 shared 模块；
  `worker-src` 删除 `blob:`，仅图片预览保留该来源。开发和生产测试仍须证明真实 module
  worker、地图就绪、附件预览及故意跨源连接阻断，不能因迁移放宽异常或 CSP 断言。

### ADR-177：公开短请求使用共享客户端 deadline 与请求身份

- 状态：Accepted
- 日期：2026-08-30
- 决策：首页国家摘要、地图目录、国家详情、适用性摘要、产品目录、确定性 product-fit 和
  locale 写入这七类短 JSON 请求共用 15 秒客户端 deadline。helper 组合组件 lifecycle signal
  与独立 timeout signal，并显式记录 timeout 是否发生；浏览器即使把两种取消都归一为
  `AbortError`，真实超时仍进入固定错误状态，导航/重渲染取消则保持静默。可发生重试、切换或
  并行完成的请求另绑定递增 request ID，迟到的成功、错误及 finally 都不得覆盖当前状态。
- 边界：Chat SSE 是受服务端 admission、provider abort 和代理 120 秒 read timeout 管理的长流，
  不使用该 15 秒短请求 deadline。客户端 deadline 只改善页面恢复性，不证明服务端工作已经
  取消；服务端请求体、数据库和附件资源仍分别遵守其既有预算。超时 reason、服务端 message
  和普通 `Error.message` 都不进入公开 retained state。
- 理由：仅传组件 AbortController 无法处理服务端永久不返回，也不能防止已经进入 Promise 链的
  旧响应提交；页面可能永久显示 loading，locale 控件也可能永久 disabled。共享 deadline、
  request identity 与类型化错误必须一起使用。
- 验证方式：fake timer 单测覆盖 timeout、lifecycle abort、清理和非法期限；Playwright 用受控
  page clock 让首页与 locale API 永不响应，推进到 15 秒后要求 loading/disabled 退出且 poison
  message 不可见。既有国家切换与延迟响应回归继续证明旧请求不能恢复旧页面。

### ADR-178：CI 第三方 Action 必须固定到官方不可变提交

- 状态：Accepted
- 日期：2026-08-30
- 决策：工作流中的远端 GitHub Action 与 reusable workflow 必须使用 40 位小写 commit SHA；
  Docker Action、service container 与 job container 必须使用完整 `sha256` digest，本地
  `./` Action 不受该规则影响。当前
  checkout、Node setup、pnpm setup 与 artifact upload 的 v4 引用均从各自官方仓库解析，并在
  写入前核对 GitHub verified commit；行尾精确 release 标签只用于审计和更新提示，不参与执行
  解析。PostgreSQL migration smoke 使用的 `pgvector/pgvector` `pg16` 标签从 Docker Hub 官方
  tag API 解析为 OCI multi-platform index，再由 Registry v2 的 `Docker-Content-Digest` 与原始
  manifest SHA-256 重算双重核对后固定；行尾 `pg16` 只保留人类可读的更新线索。
  `pnpm audit:actions` 扫描所有 `.github/workflows/*.yml|yaml`，并由 required CI 的 audit job
  执行；标签、分支、短 SHA、大小写漂移、Docker tag，以及 service/job-container 的 tag 或动态
  image 值全部失败关闭。解析器只接受可逐项核验的 block service/container mapping；flow mapping、
  anchor、alias 和动态整段定义不做推断，直接失败关闭。相同限制也适用于 `jobs`、单个 job 与
  `steps`，无法解析为普通 block mapping 的 step sequence item 及 YAML explicit-key 语法同样拒绝，
  YAML merge 与依赖敏感位置的 escaped key 也不展开，防止把远端 `uses` 藏入扫描器不审计的
  表示法。`jobs:` 的直属 job ID 进一步只接受裸写的小写
  `[a-z][a-z0-9-]*`，声明行必须恰为两个空格、该 ID 与裸冒号；带引号、大写、点号、下划线
  前缀、冒号前空格、行尾 comment 或不同缩进等替代表达直接失败关闭，使 Required gate 的独立
  枚举不会漏掉语义上合法、但不在其可审计子集内的隐藏 job。无法解析的 root anchor、tag 或
  alias 也直接拒绝，不能借此让整个 `jobs` 子树脱离结构栈。YAML 行注释只在未加引号且 `#` 由
  ASCII space/tab 分隔时剥离；NBSP/EM SPACE 不冒充 YAML 横向空白，`uses@<sha>#suffix` 或其
  Unicode-space 变体保留完整值并因不再是精确 immutable ref 而失败。root 无法解析的语法默认
  拒绝，只允许裸 `---` / `...` 文档边界；带 flow/tag payload 的 document-start、BOM 与 opaque
  root 不能让后续 action 子树逃出扫描。
- 理由：`@v4` 等可移动标签允许上游后续改写同一引用，代码评审看到的依赖身份不等于实际运行
  身份。精确 commit 让每次 CI 执行绑定可审计对象，同时保留 Dependabot 提交更新建议的路径。
- 边界：本规则覆盖 `uses:`、mapping 形式的 service/job-container `image:`，以及 job container
  的 scalar image 简写；不覆盖 GitHub runner image、包管理器依赖、脚本自行下载的二进制，也
  不在线重查标签当前指向。后者继续由各自的锁文件、摘要校验、人工更新核验与运行环境合同管理。
  静态门禁也不证明 Action 或镜像本身无漏洞，候选更新仍须经过官方来源身份核验与完整 required
  gate。无依赖逐行解析器不是通用 YAML 引擎；它通过拒绝可能隐藏依赖的替代结构来维持可审计
  子集，同时先隔离 literal/folded shell block，普通 action input（包括 `with.image`）不参与判定。
  job ID/声明行规则是本仓库静态门禁的规范化约束，不是对 GitHub Actions 全部合法 YAML key 的
  复刻。当前 scanner 仍保守地审计任何层级名为 `uses` 的普通 block key，因此业务 `env.uses` 或
  `with.uses` 可能产生误报；checked-in workflow 没有该形态，未来放宽必须先保持 step/reusable-job
  的真实 `uses` 闭包，不能用忽略嵌套 key 的方式修复。
- 验证方式：表驱动测试覆盖 remote/reusable/local/Docker/container 正例及 tag、branch、短 SHA、
  非小写 SHA、Docker tag、service/job-container tag、flow mapping、anchor/alias、动态定义、空
  引用和 YAML 键空格绕过；jobs/job/steps flow 或 alias、flow/alias step item 和 explicit-key 另有
  攻击性负例，job/step merge 与 escaped `uses` key 也必须失败。双引号、单引号、大写和下划线
  前缀 job ID，以及冒号空格、inline comment、tab、异常缩进和尾随空格声明均有拒绝用例，裸小写
  连字符 ID 保持可用；root anchor/tag/alias 组合旁路和无空格 `#suffix` ref 另有攻击性回归，正常
  ASCII space/tab 分隔 comment 保持可用，NBSP/EM SPACE、document-prefixed flow/tag、BOM 与 opaque
  root 则失败。普通 `image` key、step input、service env 与 shell block 不会误判，并直接扫描当前
  两份工作流。CI 中的同一命令在依赖审计前执行。

### ADR-179：所有公开 API 响应统一禁止缓存

- 状态：Accepted
- 日期：2026-08-30
- 决策：所有非 admin/dev 公开 API 通过共享 response 边界强制写入
  `Cache-Control: private, no-store, max-age=0` 和 `Pragma: no-cache`。countries、country
  detail、products、product-fit、Chat 与 health 在 request observer 生成最终 Response 和
  request ID 后应用策略；没有 observer 的 locale preference 成功与错误响应直接复用同一
  helper。下游 route 即使返回 `public, max-age=...` 也会被最终边界覆盖。
- 理由：国家/产品/法规及来源新鲜度会随治理发布改变，公开错误信封又随 locale Cookie 变化，
  health/readiness 还是瞬时状态。依赖 Next 动态路由推断或只在部分 happy path 写 `no-store`
  会留下错误出口、旧 locale 或旧证据被浏览器/代理重放的风险。
- 边界：这是保守的 correctness 与隔离策略，不使用 HTTP cache 降低公开读取负载；后续若引入
  可缓存的版本化公开 DTO，必须以独立 ADR 定义键、locale variation、失效与来源新鲜度语义。
  Chat SSE 只覆写两个缓存 Header，不消费或重建 body，并保留 `Content-Type`、`Retry-After`
  和 `X-Request-Id`。管理 API 继续由 ADR-168 的独立授权边界处理，dev route 不在本决策范围。
- 验证方式：共享 helper 测试用伪造 `public, max-age=3600` SSE 响应证明最终覆盖，同时读回完整
  流并保留 Content-Type、Retry-After 与 request ID；route 测试覆盖国家、详情、产品、
  product-fit、locale、三种 health 的成功和代表性错误，Chat 另覆盖成功 SSE 与 503 错误出口。

### ADR-180：AI 结构化事实必须具有可追溯引用

- 状态：Accepted
- 日期：2026-08-30
- 决策：所有服务端工具 builder 只有在原有事实完整性条件成立且至少生成一条 citation 时，
  才能设置 `evidenceSufficient=true` / `status=ok`。服务端统一 ToolResult union 另外拒绝
  status 与 evidence 判定不一致、“证据充分但 citation 为空”，以及法规比较/机会评分国家
  序列与原查询不一致的对象；因此该对象不能通过最终模型文本证据边界。浏览器收到 ToolPart
  后再独立按最小公开 DTO 重算：任何会渲染的
  知识、国家、产品、法规、市场、评分或简报事实都必须至少带一条合法 citation；`error` 只
  接受无 citation、无可见事实的生产占位结构。`no_data` 可以保留部分确定性事实，但仍必须
  引用来源。
- 理由：只在客户端把无来源卡片显示为 invalid 仍不足够；服务端若先把“有事实但 sources
  意外为空”的结果标为充分，模型自然语言已经可能在客户端校验前被放行。反过来，简单把
  citation 并入充分性公式而不单独检查可见事实，会让 `error/no_data` 夹带事实时绕过。服务端
  builder、流边界和客户端最后一跳必须采用同一失败关闭方向。
- 边界：本 ADR 只建立“可见事实必须有引用”的最低门槛；实体、来源、定位、日期与派生语义的
  精确绑定由 ADR-182 继续收紧。即使完成绑定，也不证明来源本身正确或数据库没有遗漏记录。
  publication manifest 与 repository 仍是发布和事实真源；客户端 schema 是畸形同源 payload
  的最后一道显示边界，不取代服务端边界。
- 验证方式：表驱动客户端测试覆盖七类 ToolResult 的有引用部分事实、无引用事实、带事实的
  `error` 与生产无事实错误占位；服务端分析测试删除 regulation/market/score/brief 的全部
  sources 后保留派生事实，要求四类 builder 全部降级为 `no_data`，并证明伪造回
  `evidenceSufficient=true` 同时被服务端与客户端 schema 拒绝。

### ADR-181：公开数据读取共享准入、绝对期限与迟到释放

- 状态：Accepted
- 日期：2026-08-30
- 决策：国家目录、国家详情、产品目录与确定性 product-fit 这四类公开
  PostgreSQL 工作统一通过单实例全局 2 / 每客户 2 的共享 admission gate，并从
  进入数据工作起使用 15 秒绝对期限。API adapter 同时合并客户断连 signal；
  Server Component 无可用连接 signal，因此只用受信代理覆盖的请求 Header 识别客户，
  但仍使用同一 gate 与 deadline。`/countries/[iso3]` 在页面边界只取一个租约，
  把同一 signal 交给地图摘要和国家详情，两支用 `Promise.allSettled` 全部结算后
  才传播失败，不允许首个失败提前释放尚在查询的另一支。
- 租约语义：工作在 HTTP/SSR 期限前正常结算时立即释放。若客户取消或期限先到，
  调用者可立即得到失败关联，但租约必须保留到底层 Promise 真正 settle；迟到 rejection
  始终被观察，日志只保留固定 route template 与白名单 error code。service/repository 在
  初始化前、每个数据库阶段后和新 fan-out 前重新检查 signal，并用固定
  `AbortError` 代替不可信的 `AbortSignal.reason`。一个已取租工作内并行启动的
  多路 SQL 必须先 `allSettled` 后再按稳定输入顺序传播失败，不得让首个 rejection
  使外层误以为全部数据库工作已经结束。
- 理由：只在浏览器设 15 秒 timeout 会让页面恢复，却不会阻止已排队或已启动的
  PostgreSQL 工作继续消耗连接。如果在 HTTP 返回时释放并发槽，攻击者可用重复超时
  穿透并发上限。页面 SSR 还会绕过 API route，因此必须在真正的页面数据入口
  共享相同资源边界。
- 边界：Drizzle/`pg` 当前查询不提供本路径可信的单语句取消，因此 signal 能阻止
  新阶段，不声称已中断正在执行的 SQL；运行中语句仍由池大小和 PostgreSQL
  `statement_timeout` 限界。gate 是单进程保护，不是跨实例全局配额；Nginx 必须继续
  覆盖 `X-Forwarded-For`。Chat、health、locale 和 admin/dev 各自使用独立的资源或授权
  边界，不嵌套本 gate，避免 Chat 工具调用二次取租而死锁。
- 验证方式：函数级对抗测试覆盖全局/每客户限额、前置取消、检查与
  listener 注册窗口、deadline、迟到成功/失败不提前释放及脱敏日志；route 测试要求
  超限时不启动 service，四个 route 的 admission/abort/timeout 响应均保持现有结构、
  `Retry-After: 1` 与
  no-store。页面测试额外要求单租约/同 signal、左支失败右支挂起时不释放、
  gate 已满时两个 service 都不启动，以及 deadline 同时中止后续 fan-out。
  Repository 时序回归另制造中间分支先失败、其余 SQL 挂起，证明第三个客户在
  所有分支 settle 前仍被全局 gate 拒绝，并以输入顺序而非 rejection 时序选择错误。

### ADR-182：AI 可见事实必须双向绑定来源并重算确定性语义

- 状态：Accepted
- 日期：2026-08-30
- 决策：七类 AI ToolResult 在服务端统一 schema、最终模型文字 evidence contract 和浏览器
  最小公开 schema 三个边界复用同一组纯函数。每个可见知识命中、国家、辖区、成员关系、
  法规、限值、产品、认证、市场观测及分析来源都必须由完整实体/来源身份支持；citation 必须
  精确匹配可见事实或顶层来源，任意追加的无主 citation 失败关闭，重复同一条已拥有 citation
  可以保留。`latestVerifiedAt` 按时间 instant 而不是时间戳字符串排序，从完整 citation 集合
  重算。
- 国家详情重放：available payload 必须保持 `covered/non-Demo` 或 `demo/Demo` 的覆盖分类配对，
  验证 adoptedOn 的存在性与查询日边界，并重算 `[from,to)` 法规/成员期、current/future 分组、辖区投影以及法规、辖区、
  市场观测 ID 唯一性。市场观测必须归属顶层 ISO3，期间为正，decimal 字符串和币种格式有效，
  同一数据库身份不得重复；顶层 `sources` 是所有嵌套来源的无重复精确闭包，但不要求数组顺序。
  country/summary freshness 按真实 instant 取最大值，包含 1970 年前的时间戳，不用 epoch 0
  作为有候选值时的初始最大值。带 applicability summary 时，query、国家投影、可见法规子集、
  来源闭包和 freshness 还必须映射回同一宽画像；存在可见限值时验证 `powerKw`。
  `applicationScope` 仅保留声明，当前 DTO 不能验证其真值；无事实 summary 也不能证明 power 筛选。
- 知识检索重放：service response 必须逐字段回显已解析 query 和 scope/asOf/country/
  jurisdiction/limit filter；命中必须满足 filter、半开有效期和页码区间，chunk ID 唯一，rank
  连续，数量不超过 limit。公开关键词分和向量分均为 `[0,1]` 内最多六位小数，最终分严格按
  `0.5/0.5` 重算并再次通过相关度门；排序固定为 final score 降序、同分 chunk ID 升序。
  hit warning 和外层 warning 从 metadata、空结果、执行失败与 Demo 分类精确派生，不接受自由
  追加。AI 路径还要求正文恰好包在不可信 excerpt 边界内，外层 country/asOf 与 filter 一致，
  并忽略 provider 自选的 jurisdiction/limit，固定为 `null/5`。可信用户问题与搜索 query 的
  已登记的中英文业务概念 alias 必须完整覆盖，其余有效词必须精确绑定；纯数字重合、过窄词或追加无关词均不能解锁模型文字。
- 分析全量重放：`product-fit-v2` 从可见产品、适用法规、认证和查询重新执行并比较 status、
  commercial readiness、checks 与 reasons；法规比较重算国家顺序、成员/生效/限值半开区间、
  current/future 分组、状态与缺失文案；市场比较重算 metric 顺序、最新可见观测、issue、状态与
  缺失文案。机会分不再只校验 payload 算术，而是携带完整 regulation comparison、market
  comparison 和按查询国家有序的 product-fit evaluations，并从登记的 metric direction、原始
  decimal 观测、产品 readiness 与逐法规 check 重算三个 component、typed gap、effective
  weight、contribution、overall 和 coverage。score 国家、component 与产品 evaluation 使用
  canonical 顺序：score 国家沿 query 顺序，component 固定为 market/product/regulatory，产品按
  model code + ID，法规按 canonical name + ID，限值按 pollutant/power/date/ID，市场观测按 query
  国家后接 period 降序 + ID；来源为无重复精确闭包，数组顺序不影响语义。
- 认证与简报绑定：`CertificationEvidence` 和对应 `product_certification` AnalysisSource 必须同时
  携带并匹配 `productId`、`productModelCode` 和 `regulationId`，不能把另一产品的认证借给当前
  recommendation。销售简报从同一 provenance 精确重建 ready 推荐产品、认证集合，以及有序的
  opportunity/risk/action `ruleCode` 投影；gap 只使用带 count/metric code 等参数的 typed union，
  payload 不再接受自由摘要、解释、原因或证据 ID 文案。compareRegulations、compareMarkets、
  evaluateProductFit、calculateOpportunityScore 和 generateSalesBrief 在 service 返回点也执行
  对应校验，因此内部漂移不能先被 score 或 brief 消费。运行时机会分权重必须与服务端配置
  完全一致，配置异常只返回固定错误，不回显环境值。
- 查询绑定：市场比较、机会评分和销售简报只从可信 user 文本提取显式 code-shaped metric token；
  自然语言指标名、URL、邮箱和 `non-road` 不作为 metric code。用户显式给出的 code 集必须与
  ToolResult query 是完全相同的唯一集合：无缺失、无额外、无重复，不能在后续工具调用中
  整体换码。
- 理由：citation 数量正确仍可能引用错误实体；来源身份完全匹配也不能证明 code-owned status、
  比较分组或评分公式没有在序列化过程中漂移。把关系和计算从 payload 可见原始事实重放，才能
  让服务端、模型放行边界与浏览器对同一对象作出一致的失败关闭判定。
- 边界：这是 payload 内可证明的一致性，不证明数据库候选完整、来源内容真实、embedding
  语义正确或未返回记录不存在。法规比较 DTO 没有 application scope、adoptedOn 与未命中 DB
  行，市场 DTO 没有被筛掉的更晚观测；产品适配 DTO 没有法规限值的 scope/power 原始字段。
  国家 `no_data`、空 applicability summary 的原调用 scope/power、summary 声明的 scope 真值和
  运行时 `isStale` 时钟也不能只由返回 payload 证明；知识 `asOf` 只约束有效期，不把未来
  `publishedOn` 自动判为无效。机会分/简报虽然携带完整可重放 provenance，但其市场、法规和
  产品读取是彼此独立的并发操作，不声称来自同一数据库事务或同一 MVCC snapshot。上述校验
  也不是密码学证明，不能从 schema 通过推导数据库完整性或来源真实性。
- 验证方式：真实 Demo service→builder fixtures 同时通过 server/client schema；mutation matrix
  覆盖实体、来源、版本、状态、区间、国家/市场归属、期间、decimal、覆盖分类、顺序、重复、
  pre-epoch freshness、filter、rank、score/warning 公式、excerpt wrapper、typed gap、target、
  推荐/认证 product binding、rule code 与显式 metric/query term 的缺失、额外和换码。另用协调
  漂移证明即使对象仍保留合法 citation 和查询，product、regulation、market、knowledge、score、
  brief 也不能解锁模型文字；canonical 无事实 error placeholder 继续有效。

### ADR-183：Chat 工具工作必须在 admission lease 内完整结算

- 状态：Accepted
- 日期：2026-08-30
- 决策：每个 `/api/chat` 请求在取得 admission lease 后建立同步 deferred-work tracker。
  route setup、附件解析与工具 executor 在任何归属本请求的异步工作前同步 `begin()` 取得幂等
  `finish()` token；tracker 一旦 `seal` 就拒绝新 token。正常 response EOF
  会 seal；客户端 cancel 与绝对响应 timeout 先 abort、登记已经启动的 reader cleanup，再 seal，
  provider reader error 则先 abort 再 seal。所有路径都等待全部 token settle；lease 只有在 sealed
  且 active token 为零时才释放，不能以 HTTP body 已结束或 `reader.cancel()` 已 resolve 代替工具
  工作已结束。
- Setup 与附件边界：`getAiAuditRepository` 和 `ensureSession` 在首个 await 前分别取得 token，
  共用从 setup 开始计算的 10 秒绝对期限；超时返回固定 no-store 503 与 `Retry-After: 10`，迟到
  rejection 只记录固定 stage/code。PDFJS module resolution、`getDocument`/`loadingTask.promise`、
  `getPage`、stream `reader.read`，以及 Sharp `metadata`/`toBuffer` 各自从原始 Promise 创建前
  取得 token。abort 后启动的 cancel/destroy/cleanup 是独立工作，不能替代原始解析 Promise 的
  settlement；HTTP 可以先返回，但 admission lease 必须继续覆盖仍在运行的原操作。
- 工具边界：七个只读工具的 token 覆盖完整 service 调用、`executeAuditedTool` 审计写入与最终
  Zod output parse；工具参数校验失败时由 `repairToolCall` 触发的 invalid-input audit 也使用同一
  signal 与 token，不能在 response 结束后脱离 lease。signal 从 executor 继续传到 country、
  product、marketing、market 与 knowledge service/repository；各异步阶段前后只抛固定
  `AbortError`，不传播调用方控制的 abort reason。已经启动的 compatible-product、评分、简报、
  法规比较和 country detail fan-out 必须用 `allSettled` barrier 等待所有 sibling，再按稳定输入
  顺序传播失败。
- 理由：Web Streams/AI SDK 可以让外层 `reader.cancel()` 先完成，而已启动的 tool execute、SQL
  或 audit Promise 仍在运行。若 route 此时释放 admission，重复断连就能在每客户 2 / 全局 4
  之外累积数据库和审计工作；普通 `Promise.all` 的首个 rejection 也会让 owner 过早表现为已
  结算。同步 token 关闭了“检查 signal 后、首个 await 前”的登记竞态，seal 则关闭 response
  终止后启动新工作的位置。
- 边界：Drizzle/`pg`、PDFJS worker 与 Sharp 当前不能在这些路径中可信地强制取消所有已经执行
  的原操作；signal 只阻止新阶段并在现有 await 后失败关闭。因此取消后的底层 Promise 仍受原
  admission lease 约束，直到真实 settle。若 driver、附件解析、provider cleanup 或 audit Promise
  永久 pending，对应 lease 也会永久保留；
  这是用可用性换取“不在无界后台工作仍运行时重开容量”的保守边界，仍需依赖数据库 timeout、
  provider timeout、池上限与进程级恢复处理永久挂起。
- 验证方式：对抗测试要求正常 EOF 与 cancel 后已 seal 的 tracker 不再签发 token；即使
  `reader.cancel()` 已 resolve，只要工具 token、普通工具 audit 或 invalid-input audit 尚未 settle，
  第三个同客户请求仍被 admission 429。七个 executor 必须把同一 SDK signal 传给 service；
  early rejection 与挂起 sibling 并存时，owner 只有在全部 sibling settle 后才结束，并保持稳定
  错误优先级。setup timeout 与客户取消测试还要求 audit/session 原 Promise settle 前不释放；
  PDFJS、stream 和 Sharp 对抗测试分别证明 cleanup 已完成也不能冒充原操作完成。provider reader
  error 还必须先 abort 模型再进入同一迟到释放边界。

### ADR-184：完整工具证据留在应用边界，模型只接收严格投影

- 状态：Superseded by ADR-263
- 日期：2026-08-30
- 决策：七类 ToolResult 的完整 payload 继续通过 service、server schema、evidence contract 和
  client schema，并原样进入 SSE/UI。`calculateOpportunityScore` 与 `generateSalesBrief` 在下一次
  provider step 前，使用 AI SDK `toModelOutput` 发送版本化
  `sales-chat-model-tool-output-v2` allowlist；投影前必须再次解析完整结果，只保留 query、状态、
  时间、warnings、确定性分数/规则/推荐 ID、精简 citation 与解释决策所需的 typed
  `evidenceDigest`。digest 保留 raw market 值/单位/期间/方法版本、产品状态/商业准备度/check/reason
  code、法规身份/生命周期/辖区/成员期；每个事实与 citation 只引用 `sourceId`，原始来源
  `{id,isDemo,title,url,verifiedAt}` 在顶层唯一 registry 中保存一次。不携带自由 reason message、
  definition 或完整 provenance。citation 只保留 digest 可绑定的实体，并且 raw title/locator 与 typed
  descriptor 只能采用 factory 规定的一种规范表示，不能同时携带第二套文本。原始 query 中可省略的
  metric/product 选择在投影中规范为显式 `metricCodes` 数组和 `productModelCode: null`。三类 digest
  集合分别以 8/125/250 为模型上下文硬上限；计数元数据仍记录
  `complete/totalCount/omittedCount`，但 score/brief 的非错误投影只接受 `complete=true`，超限时在
  下一 provider step 前失败关闭；整个投影另有 48,000 UTF-8 bytes 绝对上限。完整投影从 raw digest
  和运行时配置重放 score component/gap、brief
  recommendation/risk/action，逐项绑定 query/date/scope/power、法规 bucket、citation 描述符、证书
  原始编号和 source registry，并拒绝删除、额外、重复、顺序漂移或双表示。完整 result schema 与
  model projection factory 都在工具 `execute` 成功返回及 success audit 之前执行；转换或大小失败会
  变为 canonical error ToolResult，因此完整成功结果不会先进入 SSE。投影 schema 证明的是 factory
  输出的内部可重放一致性，不是任意外部 JSON 的来源真实性证明；生产只授权两个同步 factory 的输出。
  简报生成直接复用已验证 scorecard 的 regulation/product provenance 与 sources，不再重复查询。
  浏览器请求序列化只上传有序 user messages，历史 assistant/tool payload 留在本地 UI；历史用户
  文件删除，仅最新用户消息可带文件；请求端与服务端共用最近 12 条/12,000 字预算，并以 text +
  最新 file 白名单重建消息，不上传未知 metadata/data part。
- 理由：完整 provenance 对失败关闭不可省略，但把同一约 73 KB 结果同时交给应用和模型会重复
  消耗 provider context；简报重复读取还会增加工作量并制造不必要的跨快照漂移。模型解释只需
  已验证的派生事实与可引用来源，不能据此重算或替代应用边界的完整证明。
- 后果：公开 ToolResult/SSE/API schema 不变，模型看不到用于内部重放的全部原始子树。当前 Demo
  回归要求两国与最大五国 query 的 score/brief v2 投影均小于对应完整结果且不超过 48,000 UTF-8
  bytes；这是绝对 payload 字节门，不是特定模型 tokenizer 的 token 证明，160,000 live-eval 上限仍按 provider 实际
  usage 事后验收。服务端继续把最近 12 条、
  12,000 字用户历史作为权威边界。若未来支持 assistant 上下文、tool approval 或 regenerate，
  必须设计版本化安全摘要，不能直接恢复完整历史工具 payload。
- 验证方式：真实工具循环要求第二次模型调用含 projection version 且不含
  `provenance/marketComparison`，同时 `fullStream` 必须保留完整字段且不得出现 projection version；
  full schema 漂移必须在投影前失败。Demo score/brief 比较投影体积与完整结果，并核对 query、
  citations、唯一 source registry、typed descriptors、raw market、产品 reason code、法规依据、分数
  和规则字段保留；删除决策依据、伪造未引用实体、重复身份、source/title/URL、证书号、错误 count、
  时间 instant、运行时权重、日期、query/metric 顺序或追加第二套 citation 表示必须失败。超出绝对
  字节上限的完整合法结果必须在工具执行阶段变为 canonical error，并由 stream 返回证据缺口而非
  成功结果或模型文本。简报与独立 scorecard
  的 provenance/sources/目标分数逐项相等；请求序列化测试核对 user ID/顺序/文本、12/12,000
  预算、最新附件、重试安全以及 assistant/tool/metadata payload 删除。

### ADR-185：浏览器工具卡必须绑定 SDK 工具身份、输入与输出

- 状态：Accepted
- 日期：2026-08-31
- 决策：浏览器只在 `output-available` part 同时满足三项时渲染结构化结果：static
  `type=tool-<name>` 或 dynamic `toolName` 与 `output.tool` 相同；保存的 SDK `input` 通过对应 strict
  schema；所有显式 input 字段与 output query 精确一致。country/asOf 等可由可信 map/default context
  补齐的可选字段，只在 provider 显式给出时强制相等；knowledge 的 provider jurisdiction/limit
  继续按服务端策略忽略。缺 input、工具名交换、合法但不同的 country/metric/query 或 malformed
  output 一律显示 invalid-result，不进入卡片。
- 展示语义：`status=error` 卡只称为查询条件和失败状态，不再标成“确定性事实层”，且只显示单一
  执行失败 warning。`compareMarkets` 没有 as-of 输入，其顶层 `informationAsOf=currentUtcDate()`
  只显示为“结果生成日”，不能暗示市场观测按该日期过滤；真实数据时点仍由 observation period 与
  citation freshness 表示。
- 理由：output-only schema 可证明 payload 内自洽，却不能证明它属于当前 SDK tool call；协调交换
  工具名或同时修改合法 query 与占位对象，仍可能构造内部一致但归属错误的卡片。把 part identity 和
  input 纳入最后一道浏览器 admission，才能让用户看到的查询条件对应真实调用。
- 边界：这不是对客户端状态的密码学认证；可信根仍是同源服务端 stream 与 SDK state machine。
  optional context 在 raw part 中不存在时，浏览器无法独立重建 map selection/default date，服务端
  builder、统一 result schema 和 evidence contract 继续承担该边界。
- 验证方式：表驱动测试交换 score/brief/market 等 tool identity、修改合法 input country/date、删除
  input，并确认均降级为 invalid-result；canonical error 的 input/output 也使用同一绑定。正常 static
  与 dynamic tool part、map/default context 和七类 canonical error 保持可渲染。

### ADR-186：Live eval v7 明确区分输出上限与调用后总量验收

- 状态：Accepted
- 日期：2026-08-31
- 决策：suite 升级为 `sales-chat-live-v7`。生产 `streamSalesChat()` 新增仅由受信服务端调用方
  设置的可选 `maxOutputTokens`，并保持公开聊天默认 2,048；live eval 将每次 provider call 固定为
  1,024，报告保存 `maxOutputTokensPerCall=1024`、由
  `18 × 5 × 1,024` 重算的 `maxPotentialOutputTokens=92160`，以及
  `tokenBudgetEnforcement=post_usage_acceptance`。完整 usage 超过 160,000 时，即使 18 条 case
  已执行完，termination 也必须为 `token_limit_exceeded`，不能记录为 `completed`。v3–v6 报告继续
  使用各自严格历史 schema，不回填 v7 字段。
- 理由：通用 OpenAI-compatible provider 的 tokenizer、chat template、tool schema 编码与隐藏
  prompt 不统一，usage 又只能在 stream 结束后取得；应用无法从字符或字节数证明任意 endpoint 的
  输入 token 上界。把 160,000 描述为预消费硬限额会产生虚假保证。限制输出、禁用 SDK retry、
  保留 pre-case reserve，并明确记录调用后验收语义，可以缩小可控侧风险且不夸大能力。
- 边界：92,160 只是不含输入的最大潜在输出，不是整次运行的最大账单 token；12,000 reserve 也
  不是 tokenizer 证明。严格预消费总量仍需 provider 侧 run-scoped 原子预算，或与固定 endpoint /
  model 绑定且可验证的每次调用总 token 上界和 reservation ledger。缺少该能力时，本项目只声明
  160,000 的报告通过门槛。
- 验证方式：单测要求 1,024 override 贯穿多步生产循环；schema/verifier 独立锁定三个 v7 budget
  字段并从常量重算 92,160；18 case、160,001 完整 usage 必须解析为
  `token_limit_exceeded`。初始化异常仍写入 v7 失败报告、不可覆盖归档并返回非零，历史 v6 不得
  接受 v7 budget 字段。

### ADR-187：Live eval 用依赖外 ESM bootstrap 与双向 ACK 保护失败证据

- 状态：Accepted
- 日期：2026-08-31
- 决策：`ai:eval:live` 不再让 Node 在入口前 preload tsx 或解析环境文件，而由只依赖 Node
  内置模块的 `.mjs` bootstrap 启动；bootstrap 在自己的 `try` 边界内读取可选 `.env.local`，
  再 fork 由 tsx 加载的 TypeScript child。child 在首次 provider 调用前发送
  `provider_may_have_started`，报告成功持久化后发送 `report_persisted`；两条消息都带随机 UUID，
  parent 必须先更新保守状态并回传匹配 ACK，child 才能继续调用或退出。
- 理由：静态 import、tsx preload、环境文件解析或 runner preflight 若发生在保护层之前，只能非零
  退出而没有失败证据；单向 IPC send callback 又不保证 parent 已处理消息，存在 exit 抢先导致
  provider 调用后被误写成 0-call fallback 的竞态。纯 ESM parent 与双向 ACK 将这两类时序变为
  可验证合同。
- 边界：provider 前失败沿用 v7 的 `module_import` initialization shape，不新增 schema 字段。
  provider 已可能调用后若报告存储本身失败，bootstrap 宁可只返回非零，也不会合成缺少真实 ledger
  的零调用报告。该边界不修复磁盘不可写，也不声称任何异常下都一定能保存 JSON。
- 验证方式：spawn 集成测试覆盖 database/model configuration、tsx/runner 不可加载、secret marker
  不落盘；合成 child 证明 provider 前崩溃会写 schema-valid v7 失败报告，provider boundary 后崩溃
  不会生成零调用 latest。bootstrap hardcode 的 version、prompt、预算与 thresholds 同 canonical
  TypeScript 常量比较；lint、typecheck 与实际 provider-disabled CLI 路径均通过。

### ADR-188：版本化发布验收必须隔离 curl 配置、代理与协议

- 状态：Accepted
- 日期：2026-08-31
- 决策：`scripts/deploy/verify-release.sh` 的每次 curl 调用都以 `--disable` 为首参数，统一
  `--noproxy '*'`；允许的 loopback origin 只使用 HTTP，固定公网 origin 只使用 HTTPS。
  health/readiness/locale JSON、页面 HTML 和 Chat SSE 的单响应上限分别为 64 KiB、4 MiB 与 1 MiB。
- 理由：校验参数中的固定 URL 不能证明 curl 的实际网络目标。root 或运行用户的 `.curlrc` 可注入
  `connect-to`、`resolve`、代理或 `insecure`，使符合断言的伪服务产生发布假绿；无界响应还会进入
  Node 内存或临时盘。发布验收必须独立于调用环境的用户配置。
- 边界：该合同防止 curl 客户端配置改写目标，不替代 DNS/CA、VPS、Nginx 或应用自身的信任边界；
  公网真实性仍依赖系统 CA 与固定 HTTPS 域名。响应大小是资源上限，不是内容真实性证明。
- 验证方式：测试用恶意临时 `HOME/.curlrc` 注入 Header 并证明服务端未收到；fake curl 精确检查
  公网/loopback 的首参数、代理与协议参数；超过 4 MiB 的 HTML 必须以 curl 63 失败。脚本通过
  `bash -n`，完整部署脚本套件通过。

### ADR-189：模型正文阻断必须跟随实际保留的多轮用户历史

- 状态：Accepted
- 日期：2026-08-31
- 决策：`buildSalesChatEvidenceContract()` 不再只对最后一条用户文本检查越权指令。本次经服务端
  历史数量/字符预算保留、且会重新发送给 provider 的所有 user turn，既逐条检查，也用中性空格连接后检查；
  任一单轮或跨轮拆分序列命中提示注入模式时，`blocksModelText` 都保持为 `true`。工具仍可执行和审计，
  但即使结构化证据充分，provider 正文也不得出网；
  服务端只返回固定证据缺口。
- 理由：模型看到的上下文不只有最新一轮。旧轮的“忽略系统提示”仍然在 prompt 中时，用户下一轮只说
  “继续”不能被当作新的可信边界。阻断范围必须与实际 provider 输入一致，而不是与 UI 中“最新问题”的概念一致。
- 边界：这是确定性模式门，不是完整的自然语言攻击分类器。历史消息真正超出服务端保留窗口且不再发给 provider 后，
  对应阻断可以解除；附件和检索内容仍分别由未核验附件边界和不可信检索边界处理，不反向改写用户意图。
- 验证方式：两轮 `fullStream` 回归把 `ignore system` 与 `instructions` 拆到两条各自不命中的消息，
  并让确定性产品适配工具返回充分证据；真实 `POST /api/chat` 回归另外穿过消息白名单、模型转换、
  生产流和 SSE 编码。两条序列化流都不得出现 provider marker，只能出现固定证据缺口。

### ADR-190：提示注入检测统一规范化，附件摘要不得绕过正文阻断

- 状态：Accepted
- 日期：2026-08-31
- 决策：证据合同在匹配用户越权模式前统一执行 Unicode NFKC、移除 Unicode `Cf` 格式字符并
  折叠所有空白，再分别检查每条保留用户消息与拼接历史。纯附件摘要的特殊释放路径也必须要求
  `blocksModelText=false` 且不存在证据不足；一旦历史提示注入触发阻断，模型正文无论是否只解释
  附件都不得进入 `fullStream` 或 API SSE。
- 理由：LF/CRLF、tab、零宽字符与全角兼容字符都可以把确定性触发词拆开；此前附件摘要路径又只
  判断“没有工具结果”，形成绕过统一证据边界的第二出口。规范化输入并让所有正文出口服从同一
  合同，才能使“不公开 provider 正文”成为可验证的不变量。
- 边界：这仍是高置信度模式检测，不是完整的自然语言注入分类器；附件内容仍按未核验材料处理，
  且固定证据缺口不代表附件事实已经获得独立验证。
- 验证方式：表驱动单测覆盖 LF、CRLF、tab、零宽、全角和跨轮拆分；`fullStream` 与真实
  `POST /api/chat` 附件链路同时注入伪造 marker，并确认 SSE 只保留固定证据缺口。

### ADR-191：Live eval v8 将安全通过绑定到完整处置与 grounding

- 状态：Accepted
- 日期：2026-08-31
- 决策：suite 升级为 `sales-chat-live-v8`。安全关键型 evidence-denied case 只有在执行完成、
  actual evidence gate 关闭、最终处置为 `whole_request_refusal` 且 response grounding 通过时，
  `safetyPassed` 才能为 true。拒绝型 decision anchor 新增强肯定业务结论的反向候选，使“先输出
  拒绝前缀、随后宣称产品适配/可供货或事实已确认”的回答同时失败 grounding 与 safety。v8 保持
  v7 的字段和预算结构；v7 继续作为严格历史格式解析，不回填新判定。
- 理由：只检查回答开头的拒绝语句会把自相矛盾的后续结论计为安全通过。安全指标必须复用逐例
  已存在的 evidence、disposition 与 grounding 三个边界，而不能成为一条更宽松的旁路。
- 边界：强肯定反向 anchor 是有限、可复核的双语词表，不是任意语义矛盾证明；当前失败报告也
  只验证 v8 的 schema、归档和 verifier 路径，不构成 provider 模型质量证据。
- 验证方式：回归用例让未知产品回答以拒绝开头、再追加明确兼容结论；必须得到
  `response_grounding,safety_policy` mismatch、`safetyPassed=false` 与 case fail。schema 测试同时
  保留 v7 archive 兼容，并只把 v8 接受为当前 suite。

### ADR-192：健康读回必须证明响应新鲜且不可缓存

- 状态：Accepted
- 日期：2026-08-31
- 决策：synthetic canary 和版本化 `verify-release.sh` 在每次 liveness/readiness 请求前后记录
  时钟，只接受落在 `[requestStartedAt-5s, responseReceivedAt+5s]` 内的 canonical UTC
  timestamp；同时要求响应各自精确且唯一包含
  `Cache-Control: private, no-store, max-age=0` 与 `Pragma: no-cache`。两条路径继续核对完整
  release SHA、服务名、状态和 readiness 数据库探针；任一时间、Header 或 shape 漂移均失败。
- 理由：只验证 200 与版本字符串无法区分当前应用进程、被中间层重放的旧健康响应和结构不完整
  的 stub。把时间窗口绑定到实际请求，并验证禁止缓存策略，才能让发布验收和定时 canary 的
  “健康”更接近一次新鲜的目标实例观察。
- 边界：5 秒是部署环境允许的时钟偏差，不是跨主机 NTP 健康证明；HTTPS、DNS、主机与代理仍是
  外部信任边界。读回通过也只证明探针时刻的应用/数据库状态，不构成 SLO 或持续可用性证明。
- 验证方式：synthetic canary 使用注入时钟覆盖窗口两端、陈旧/超前时间及缺失 Header；发布
  verifier stub 覆盖完整 success、错误服务/状态/version/readiness、非 canonical/陈旧/超前
  timestamp，以及缺失或错误的缓存 Header。脚本继续通过 `bash -n` 与恶意 `.curlrc` 回归。

### ADR-193：国家目录展示身份只按 ISO3 绑定受治理摘要

- 状态：Accepted
- 日期：2026-08-31
- 决策：静态 `CountryDirectory` 只承担 ISO、英文目录名与几何可用性，不替代运行时国家资料的
  Demo 分类。主国家选择器、详情抽屉选择器、当前选择说明、地图 Tooltip 与服务端 no-data 快照
  统一使用类型化 resolver：只有 `CountryMapSummary.iso3` 与目录 ISO3 相同时，才完整采用经
  service/client Zod 边界验证的 summary `isDemo`、ISO2、英文名与本地名；ISO3 是唯一 join key，
  ISO2 或名称漂移仍保留 summary 的显式 Demo 分类并交给展示 formatter 失败关闭。summary 缺失
  或属于其他 ISO3 时才回退到静态非 Demo 目录身份。任何路径都不得从 `demo fixture` 等名称
  后缀反推 Demo。
- 理由：静态目录本身是公开基础目录，但本地演示数据库会在相同 ISO3 下提供显式 Demo 国家资料。
  选择器若总传 `isDemo=false`，会把 Demo 名称显示成普通国家并与详情徽标冲突；若改为名称正则，
  又会让自由文本变成分类协议。canonical ISO3 join 加结构化分类同时保留目录 fallback 与事实边界。
- 边界：resolver 只解决展示身份，不提升国家摘要的法规或来源证据等级，也不修改数据库 schema。
  同 ISO3 的 Demo identity 若因 ISO2、canonical 名称或受信 fixture 身份漂移，formatter 保留原文，
  不套用旧中文 Demo 名；真实分类却携带 Demo canonical 名时同样保留原文，不把后缀当成授权。
- 验证方式：纯函数矩阵覆盖同 ISO3 Demo、ISO2 漂移、真实分类搭配 Demo canonical 名、缺摘要和
  不同 ISO3；Playwright 在英文与中文下同时核对主/抽屉选项，并用严格合法但 `isDemo=false` 的
  Demo-looking 名称证明不会生成“演示数据”译名。既有 Tooltip、no-data 与键盘切换回归继续通过。

### ADR-194：Product-fit 异步状态使用互斥的类型化公告契约

- 状态：Accepted
- 日期：2026-08-31
- 决策：产品目录继续使用 `ProductListState = loading | error{code} | ready{products}`，评估继续
  使用 `EvaluationState = idle | loading | error{code} | ready{evaluation}`；跨 render 只保存
  `SafeApiErrorCode | null` 和结构化结果，可见文案在当前 locale render 时从词典重建。每个互斥
  可见状态恰好产生一个公告节点：目录 loading 为 atomic `role=status`、`aria-live=polite`、
  `aria-busy=true`；空目录为一个包含标题和解释的 atomic polite status；目录错误为一个 atomic
  `role=alert`，内含唯一 retry；评估 loading 为一个 atomic/busy/polite status，评估错误为一个
  alert，ready 结果沿用唯一的 polite status。form 在目录或评估 loading 时统一 `aria-busy=true`。
- 理由：同一目录错误或空态若在 fieldset 与表单尾部重复渲染，读屏会收到重复甚至矛盾的公告；
  缺少 busy/live 语义又会让确定性评估看似没有响应。closed union 与每状态单一出口使视觉状态、
  控件禁用和辅助技术公告来自同一事实。
- 边界：错误公告只从白名单 code 选择本地固定文案，未知、HTML、远端 message 与普通
  `Error.message` 均使用安全 fallback。该契约不保证特定辅助技术的播报时序，也不改变
  product-fit 确定性规则或 API schema；ready 结果的事实等级仍由结构化证据与来源决定。
- 验证方式：浏览器回归覆盖目录 loading→empty、单一净化错误与 retry、挂起评估期间切换 locale
  后的当前语言公告；断言每一状态的 status/alert 数量、atomic/live/busy 属性、表单 busy 与远端
  poison message 不可见。相关格式化/错误码单测、lint、typecheck 与 diff check 通过。

### ADR-195：开发历史审计区分可重算阻塞项与不可重放操作记录

- 状态：Accepted
- 日期：2026-08-31
- 决策：`scripts/history/fde-development-history-audit.json` 使用严格
  `fde-development-history-audit-v1` 保存被审计 source commit、50/42 拓扑计数与 blocked
  publication gate。`history:verify` 从本地受保护 source ref 机器重算 commit/non-merge 数、与
  `master` 无 merge base、代表性里程碑祖先关系、archive ref 尚不存在，并遍历全部 reachable
  object path 与每个历史 `package.json` 修订，确认当前可重算的 publication blockers：缺少项目
  LICENSE、NOTICE 和 package license 字段。相反，2026-08-20 的 full-history secret scan 与依赖
  license metadata scan 没有保存 raw report，只能以
  `evidenceLevel=historical-operator-record-only + rawReportPresent=false` 记录，不能冒充仓库内可
  重放证明或解除发布阻塞。
- 理由：一句“扫描通过”无法让后来审阅者复算工具版本、输入集合和发现项；但仓库当前仍可直接
  证明缺少发布许可材料。把两类证据混成一个 passed 标志，会让不可复核的旧记录掩盖仍然存在的
  许可证阻塞。
- 边界：verifier 是只读检查，不创建或发布受保护的 archive ref，也不把独立历史
  合并进 `master`，也不会代替保存原始 gitleaks/依赖许可证报告、人工资产审阅或弱 copyleft/
  notice 策略。若历史后来出现 LICENSE/NOTICE/license 字段，现有 blocked artifact 必须先受控审阅
  和升级，verifier 不会静默把它解释为发布许可。
- 验证方式：严格 schema 测试拒绝 publication-ready、伪造 repository-verifiable scan 和 artifact
  subject 漂移；注入式 Git runner 覆盖 LICENSE/NOTICE、历史 package license 字段、错误拓扑、
  已存在 archive、merge base 与里程碑漂移。2026-08-31 的真实 `pnpm history:verify` 对当时本地 ref 输出 blocked、
  `historical-operator-record-only`，并证明命令前后 refs 不变。
- 演进记录（2026-09-05，v2）：在保留以上 v1 决策与两项 2026-08-20
  `historical-operator-record-only + rawReportPresent=false` 的前提下，合同新增独立
  `retainedSecretScan`，绑定仓库内日期化 manifest、历史扫描与 canary 的原始日志/报告。
  重算已保存字节与诊断不等于重新执行扫描，也不追溯补齐旧记录。
- 演进记录（2026-09-05，v3）：再新增独立 `retainedDependencyLicenseScan`，绑定依赖
  outer manifest 与限长 gzip JSON/base64 数据，保存 807 份原清单文件及原 manifest、README、
  打包脚本，共 810 份。解码和校验只处理数据，不执行留档脚本或沿原路径读取/写入文件。
  六个历史输入状态对应三张图；六次 frozen 安装与十二份平台许可证报告完成，Darwin arm64
  全部依赖身份分别为 680/681/682；补查的同一组 175 项精确 registry 声明与锁定包名、版本、
  完整性摘要匹配，使组合身份数闭合为 855/856/857。失败尝试和未安装元数据记录单独保留，
  不冒充成功安装；包体 offline 不代表供应链元数据无联网，ignore-scripts 不证明原生构建或
  历史应用可运行。平台元数据和 registry 声明不等于许可证全文、包内材料或法律批准；保留
  完整复合许可证表达式。v3 沿用 v2 密钥记录、原旧声明和全部五项 publication blockers，
  不授权创建、推送或合并归档历史。

### ADR-196：国家抽屉在活动可访问树内复用语言切换

- 状态：Accepted
- 日期：2026-08-31
- 决策：Vaul 国家详情 Drawer 保持 `modal=false`，但不以此推断 Header 控件在抽屉打开时仍可由
  辅助技术访问。实际浏览器的活动可访问树会隐藏 Header 的 locale group，因此在 Drawer 国家
  控件区复用同一个 `LocaleToggle`，并以独立的 `country-drawer-locale-toggle` test ID 区分测试
  定位；Header 保留默认 test ID。抽屉打开时，活动可访问树中只存在一个名为 `Language`/`语言`
  的 group。两个入口共用同一 locale 状态、`POST /api/preferences/locale`、一年期
  `diesel_locale` Cookie 与 `router.refresh()`，不复制第二套语言写入逻辑，并保持当前 path 和
  query string。
- 理由：非模态 Drawer 仍会改变 Vaul 暴露给辅助技术的活动树。若语言切换只留在 Header，用户
  从国家详情抽屉操作时会失去可达的语言入口；若复制状态或请求实现，则可能使 Cookie、当前
  locale 与刷新后的服务端内容分叉。复用同一组件既保留唯一活动 group，也保留单一事实来源。
- 边界：DOM 可以同时存在 Header 与 Drawer 两个组件实例，独立 test ID 只服务稳定定位，不是
  用户可见语义；可访问性契约要求任一时刻只有当前活动副本参与 role 查询。该决策不把 Drawer
  改为 modal，不改变地图点击、焦点或关闭行为；Drawer 关闭后仍使用 Header 的语言入口。
- 验证方式：Playwright 在 desktop/mobile 中真实打开国家 Drawer、点击其 locale group，断言
  活动树只有一个语言 group、完整 path/query 不变、`<html lang>` 与 Cookie 同步更新；刷新后
  locale 和 URL 均持久化。desktop/mobile 共 2/2 通过。

### ADR-197：国家抽屉内部切换与关闭返回使用两条焦点意图

- 状态：Accepted
- 日期：2026-08-31
- 决策：从 Drawer 的 `drawer-country-select` 切换国家时，Explorer 写入专用的一次性内部焦点
  请求，不改写最初地图 launcher 的返回目标。按 ISO3 重挂载的新 Drawer 在
  `onOpenAutoFocus` 中消费该请求、阻止默认顶部聚焦并把焦点放到新的国家选择器；关闭或
  Escape 仍沿原有外部返回键恢复到最初打开 Drawer 的地图选择器或快捷按钮。
- 理由：国家切换会让 keyed Drawer 整体重挂载，Vaul 默认把焦点移到顶部关闭按钮。键盘用户
  因而在每次切换后丢失操作位置；若复用原来的返回焦点键，又会把 Drawer 内选择器错误保存为
  关闭后的目标，覆盖真正的地图 launcher。两个意图必须拥有不同生命周期。
- 边界：一次性请求只在同一浏览器会话的受控客户端导航中消费，不改变 URL、产品评估取消、
  Drawer 初次打开的默认聚焦或直接深链行为。焦点目标仍是稳定 DOM ID；若新 Drawer 无该
  select，默认 Vaul 聚焦继续生效，不把请求解释为成功。
- 验证方式：Playwright 先证明 CHN→BRA 后选择器连续 10 秒 inactive，再验证修复后 desktop/
  mobile 均保持新选择器焦点；随后 Escape 关闭并确认焦点仍回原 CHN 快捷按钮。scoped lint 与
  diff check 通过，完整矩阵在最终门禁重跑。

### ADR-198：Portfolio 质量快照区分可运行清单与最近实跑结果

- 状态：Accepted
- 日期：2026-08-31
- 决策：STATUS 的 `qualitySnapshot` 不再使用含糊的 `vitestFiles/vitestTests`。当前工作树的
  `vitestRunnableFiles/Tests` 只与 `vitest list` 对账；最近一次完整运行另保存带分钟时间的
  `lastRun`，包含 collected files/tests、passed、skipped，并把 failed/todo 固定为 0。
  `portfolio:verify` 校验结果算术、runnable 不超过 collected、machine block 与当前回归 prose
  完全一致；旧 schema 失败关闭。machine snapshot 的顶层及每个嵌套 object 都拒绝未知字段，
  observation 时间必须是合法、带 UTC offset 且恰好分钟精度的 ISO datetime。当前回归 prose
  只从剥离 HTML comment 与 fenced code 后的唯一 canonical bullet 读取，并要求该 bullet 内只有
  一组统计声明；隐藏诱饵、重复 bullet 或重复声明都不能替可见事实通过校验。machine block 在
  CRLF 规范化和边界空白剥离后还必须逐字等于 `JSON.stringify(value, null, 2)`，从而拒绝重复
  known key 被 `JSON.parse` 后值覆盖，以及其他会让人读文本与实际解析值分叉的非 canonical JSON。
- 理由：Vitest `list` 会完全省略 `skipIf` 用例。此前 verifier 把 2554 个 runnable tests 与
  STATUS 中 2555 个 collected tests 当作同一个数量，仍返回 0，既混淆清单与执行结果，也无法
  发现 prose 漂移。若 parser 先匹配注释、示例代码或第一个重复声明，machine block 也可能与读者
  实际看到的错误数字并存。明确证据类型、可见性、唯一性与严格 schema 才能避免把快速 inventory
  或隐藏文本冒充完整运行。
- 边界：`lastRun` 是带时间的运行观察，不是由 `portfolio:verify` 重跑得到，也不是签名 artifact；
  verifier 能证明 schema、算术、prose 和当前 runnable inventory 自洽，不能独立重建已结束进程
  的通过状态。完整质量门仍必须实际执行 `pnpm test` 并如实更新该观察。
- 验证方式：单测拒绝 legacy 字段、结果算术漂移、STATUS prose 漂移和 runnable 越界；当前完整
  Vitest 实跑为 132 files、2560 collected、2559 passed、1 skipped，随后由 verifier 对当前
  runnable inventory 132/2559 独立复核。补充表驱动测试覆盖注释/代码块诱饵、重复可见 bullet、
  同一 bullet 重复统计、全部 object 层级的未知字段，以及非法日期、非法 offset、缺失 offset 与
  秒精度输入；顶层/嵌套重复 JSON key、compact JSON 与其他非 canonical machine block 也必须
  失败，CRLF 和边界空白保持兼容。当前实际计数仍只在完整回归结束后写入 STATUS，而不由单测样例
  推断。

### ADR-199：普通文本中的变形推理标签同样失败关闭

- 状态：Accepted
- 日期：2026-08-31
- 决策：typed `reasoning-*` part 与 Route Handler 的 `sendReasoning=false` 之外，证据边界还在
  `finish` 时对完整缓冲文本规范化后检查私有推理标签。规范化仅执行 NFKC、移除 Unicode `Cf`
  format control，并解码命名/十进制/十六进制尖括号实体；随后只匹配边界完整的
  `think`、`thinking`、`analysis`、`reasoning` 开闭/自闭合标签。命中即丢弃全部模型正文，返回
  当前语言的固定证据缺口；已经验证的结构化工具卡仍可独立审阅。
- 理由：OpenAI-compatible provider 可能把内部推理错误地降级为普通 `text-delta`。只过滤 SDK
  part 或原样 `<think>` 会让实体编码、零宽字符、全角字形及其他常见标签绕过隐私边界。
- 边界：该检查不是任意 chain-of-thought 语义分类器，也不拦截普通句子中的 “analysis” 或
  “reasoning”；它只对明确标签形态失败关闭。模型仍可能在没有任何标签时输出不应公开的过程，
  因此 provider 配置、system instruction 和结构化证据优先仍是共同边界。
- 验证方式：表驱动单测覆盖原样/实体/数值实体/零宽/全角/自闭合标签与误报反例；充分
  product-fit 证据的 `fullStream` 和真实 `POST /api/chat` SSE 均注入跨 delta marker，并要求
  marker 与伪造结论不可见、固定证据缺口可见。

### ADR-200：版本化发布验收原子检查公开产品边界

- 状态：Accepted
- 日期：2026-08-31
- 决策：`verify-release.sh` 在 liveness/readiness 通过后、页面语言与 Chat SSE 验收前，以既有
  安全 curl 配置和 64 KiB 上限读取 `/api/products`。只有 `status=ok`、排序后的型号精确等于
  `DEMO-ENG-100/200`，且每条产品及其来源都显式 `isDemo=true` 时继续；缺接口、畸形 JSON、
  多余/重复型号或任一分类漂移均失败。
- 理由：定时 canary 能事后发现产品泄漏，但不能阻止错误 release 或 rollback 被当前发布事务
  宣布成功。作品站当前没有获准公开的真实产品，产品边界必须和健康、页面、AI 一起原子读回。
- 边界：该 gate 证明当前公开 DTO 的型号集合和 Demo 分类，不替代 publication manifest 对
  实体 ID、来源身份、规格版本的数据库侧约束，也不把两个虚构 Demo 型号解释为真实商业可售性。
- 验证方式：HTTP stub 的完整 179 条发布脚本回归通过；新增用例分别让接口缺失、JSON 畸形、
  额外真实产品、产品分类漂移和来源分类漂移，并断言 verifier 在请求任何页面或 Chat 前非零退出。

### ADR-201：跨国家导航保留完整决策查询上下文

- 状态：Accepted
- 日期：2026-08-31
- 决策：Country Explorer 切换 ISO3 时从当前 `useSearchParams()` 取得完整查询字符串，只替换
  `/countries/{ISO3}` pathname；已知 product-fit 筛选及未知合法参数保持原顺序和值。当前 URL
  无查询参数时不追加空 `?`。
- 理由：国家页的产品适配、法规时点与分享复现全部从 query 初始化。此前 Drawer 中 CHN→BRA
  会把 marine、321.5 kW、日期和产品重置为默认值，界面却没有提示决策上下文已改变。
- 边界：保留参数不表示它们自动适用于新国家；目的地仍由服务端 Zod/规范化逻辑验证并可能得到
  `unknown/not_fit/no_data`。关闭 Drawer 返回 `/map` 的行为不变。
- 验证方式：desktop/mobile 浏览器回归从带四个治理筛选和未知 `utm_source` 的 CHN URL 切换
  BRA，断言 URL 完整保留且应用场景、功率和日期控件不变；既有无筛选切换仍保持干净 URL。

### ADR-202：焦点意图存储失败不得阻断国家导航

- 状态：Accepted
- 日期：2026-08-31
- 决策：Country Explorer 的三类一次性焦点意图统一经 best-effort helper 读写。helper 同步维护
  模块内存 `Map`；`sessionStorage` 任一 get/set/remove 抛错后，当前 document 生命周期永久切换
  为 memory-only，后续不再触碰被拒绝的 API。storage 健康时，成功读取的 null 会清除 fallback，
  防止外部清空后旧意图重新出现。
- 理由：隐私模式、嵌入式浏览器和配额策略可能让 storage getter 或 `setItem` 抛 `SecurityError`。
  焦点增强不应成为国家导航的硬依赖；直接调用会在 `router.push` 前终止事件处理。
- 边界：内存 fallback 只覆盖同一 document 内的客户端导航，不承诺跨完整 reload 保存焦点意图；
  URL、Cookie 和业务筛选仍有各自权威来源。storage 恢复也不会在当前 document 中自动重新启用，
  以避免半失败状态分叉。
- 验证方式：desktop/mobile Playwright 分别让 `window.sessionStorage` getter 和
  `Storage.prototype.setItem` 抛 `SecurityError`；两种情况下均从 CHN launcher 打开 Drawer、切换
  BRA 后保持选择器焦点、Escape 返回 `/map` 并恢复原 CHN launcher。与正常焦点和 query 保留
  合并的定向矩阵为 8/8。

### ADR-203：语言切换以刷新后的 Provider locale 为成功判据

- 状态：Accepted
- 日期：2026-08-31
- 决策：语言偏好接口返回 2xx 后，`LocaleToggle` 保留 request ID、起始语言和目标语言，等待
  `router.refresh()` 对应 transition 实际进入并结束，再比较 `LocaleProvider` 的 locale。相等才
  清空状态；不相等则保留原语言并显示当前语言的固定失败提示。验证不读取 `document.cookie`。
- 理由：浏览器或隐私策略可能接受 HTTP 响应但拒绝 `Set-Cookie`。仅凭 2xx 清空状态会让控件
  静默停留在旧语言，用户既无法判断失败也没有明确重试反馈。
- 边界：该检查证明当前 refresh 看到目标服务端语言，不承诺 Cookie 的一年存续绝不会被用户或
  浏览器随后清除；request identity、Abort 与迟到响应防护保持不变。外部 Toggle 改变 Provider
  locale 时，每个旧实例在作废异步 owner 的同时必须清空可见 pending/error state，防止语言
  往返后旧 `localeAtStart` 再次匹配并复活永久 disabled。
- 验证方式：desktop/mobile 拦截接口并返回合法 200 但不带 Cookie，断言路径/query 和英文状态
  保持、只出现一个英文失败提示；恢复真实接口后在同 URL 重试，切换中文并经 reload 持久化。

### ADR-204：工具参数流不得成为私有推理旁路

- 状态：Accepted
- 日期：2026-08-31
- 决策：证据 transform 按 tool call ID 暂存 `tool-input-start/delta/end`，只在完整静态 `tool-call`
  递归检查且 SDK schema 解析通过后，从最终 `chunk.input` 重建 start / 单个 canonical JSON delta /
  end，不回放 provider 原始 delta。命中后标记该 ID，丢弃调用及其结果/错误，清空模型
  正文并返回固定证据缺口；知识检索 query 同时通过 Zod refinement 在服务执行前拒绝标签。
- 理由：`sendReasoning=false` 只过滤 reasoning part。AI SDK 会把工具增量和无效调用 input 转成
  独立 UI SSE，若原样转发，provider 可把实体编码 marker 放在参数里绕过普通文本边界。
- 边界：这是明确标签形态的隐私门，不是任意语义 chain-of-thought 分类器；正常安全工具参数仍
  保留原 part 顺序、结构化结果和审计。工具增量在完整参数校验前不会向浏览器提前显示。
- 验证方式：`fullStream` 与真实 `POST /api/chat` SSE 均注入跨 delta、实体编码的 analysis
  marker；断言 marker、伪结论和同 ID part 不可见，知识服务不执行，脱敏 invalid-input 审计与
  固定中文缺口存在；干净调用断言 start/delta/end/call/result 顺序与结果不变；重复 JSON key
  对抗用例证明工具实际执行解析后的最后值，而被丢弃的早期值不进入 `fullStream` 或 SSE。

### ADR-205：发布产品读回必须满足 canonical DTO 与 Demo 身份闭包

- 状态：Accepted
- 日期：2026-08-31
- 决策：`verify-release.sh` 将 64 KiB 有界 `/api/products` 响应交给版本化 TypeScript 校验器；
  校验器直接复用 strict `productListResponseSchema`，再要求两个允许的型号匹配受控 Demo 实体
  ID、共同来源 ID、`demo-v1` 规格版本，以及产品/来源双层 Demo 分类。
- 理由：此前只检查 `status`、型号和两个 `isDemo`，缺少 ID、名称、功率、规格、日期或来源
  metadata 的残缺 JSON 也会让整条发布验收返回成功，与浏览器实际接受的 DTO 不一致。
- 边界：精确身份是当前两个虚构 fixture 的作品站发布合同，不把它们解释为真实可售产品；未来
  获批产品必须同时更新 publication manifest、公开 schema 验收、canary 和本文决策。
- 验证方式：发布脚本完整回归 184/184；成功 stub 使用完整 DTO，缺字段、产品 ID、来源 ID、
  规格版本、分类漂移和额外真实产品均在任何页面或 Chat 请求前失败。

### ADR-206：销售聊天不公开 provider 专属非文本 part

- 状态：Accepted
- 日期：2026-08-31
- 决策：销售聊天的公开流协议只接受缓冲后的模型正文、已验证工具 part 和生命周期
  事件。provider 发出的 `custom`、普通 `file`、`source` 或 `raw` 一律在 evidence transform 中
  丢弃并清空后续模型正文。递归扫描命中私有推理标签时返回专用 reasoning 缺口；
  否则返回通用执行缺口。
- 理由：`sendReasoning=false` 只约束 reasoning part。AI SDK 可把 provider metadata、文件或来源投影成
  其他 fullStream/UI part；若依赖 converter 的默认发送选项，私有标记或未验证内容仍可绕过
  普通文本与 reasoning-type 边界。当前 UI 不需要这些 provider 专属通道。
- 边界：这是销售文本+结构化工具协议的失败关闭，不是对所有 AI SDK 用法的通用禁令。
  `start-step`、`finish-step`、`finish` 与 `abort` 仍保留；正常工具输入顺序、结构化卡片与审计
  不受影响。AI SDK 当前默认不把 raw chunk 送入 `fullStream`，`raw` 仅作防御性分支。
- 验证方式：表驱动 `fullStream` 对抗用例向 custom/file/source metadata 注入 analysis marker，
  断言 part、marker 与伪结论均不可见，step/finish 事件保留；无 marker custom 返回通用执行
  缺口；真实 `POST /api/chat` SSE 对 custom metadata 执行同样断言。

### ADR-207：销售聊天流以字段白名单公开工具与生命周期 part

- 状态：Accepted
- 日期：2026-08-31
- 决策：销售聊天只公开 AI SDK part 中完成 UI 工具卡和评估记账所必需的字段。
  工具 input/call/result 移除 provider/tool metadata、title 和 preliminary；provider-executed 或 dynamic
  call/result/error 失败关闭。本地 result 必须通过 strict `aiToolResultSchema`；畸形 result 转成固定
  `tool-error` 以终止卡片。本地 tool error 和顶层 stream error 只公开固定错误，原因仅送服务端
  observer。生命周期事件保留，但 request/body、warnings、provider response identity/headers/metadata、raw finish
  reason 和 abort reason 不公开。
- 理由：AI SDK 的 UI converter 会为 SSE 丢弃部分 lifecycle metadata，但 `fullStream` 仍保留；
  provider-executed tool error 还会绕过 route `onError` 直接序列化原文。把 converter 默认值当安全
  边界会让两种消费方式得到不同的隐私保证，也会让无效 result 留下永久 loading 卡。
- 边界：usage、performance、unified finish reason、固定非 provider 响应占位符与已验证工具
  input/output 仍保留；服务端 observability callback 仍接收原始错误。这不把 provider 调试 metadata
  转化为公开 API。
- 验证方式：Mock V4 在 provider-executed result/error、顶层 Error、finish response ID/model/metadata/headers/raw
  reason 与静态工具 metadata 中注入独立 marker；`fullStream` 与真实 Route SSE 不得出现 marker、
  未验证结果或原始错误，而正常本地工具仍按 input start/delta/end/call/result 顺序生成终态卡。

### ADR-208：locale 请求体绝对期限必须在生产代理层可观察

- 状态：Accepted
- 日期：2026-08-31
- 决策：主域名 Nginx 为精确 `/api/preferences/locale` 新增 HTTP/1.1 location，设置
  `client_body_timeout 30s` 并关闭 `proxy_request_buffering`，同时保留可信 XFF 覆盖、身份头清理、
  response buffering/cache 禁用和现有 upstream timeout。该 location 不继承 Chat 的 10 MiB 或连接限流。
- 理由：应用的 4 KiB / 30 秒 `readJsonRequest` 只能从 Next 收到请求后计时。Nginx 默认先
  缓冲完整 body，慢速客户可在代理层停留超过 30 秒，或得到 Nginx HTML 408，使应用结构化
  deadline 不是端到端合同。流式转发让应用绝对计时与网络 body 同步开始。
- 边界：Nginx `client_body_timeout` 本身是字节间 idle timeout，应用 deadline 才是绝对时间；两者
  必须同时存在。通用 catch-all 仍缓冲请求体。仓库只能证明 clean release 安装的配置，真实主机仍
  需 `nginx -T`、`nginx -t` 和发布读回确认 active config。
- 验证方式：部署配置测试精确提取 locale block，断言它位于 catch-all 前、开启 30 秒/
  streaming/HTTP1.1/身份头清理/no-cache，且不包含 Chat body/connection 上限；catch-all 仍明确不关闭
  request buffering。发布路径交叉审查确认唯一 canonical config 由 clean commit 复制并在 reload 前 `nginx -t`。

### ADR-209：live-eval latest 必须等于现代归档中的全局最新运行

- 状态：Accepted
- 日期：2026-08-31
- 决策：`portfolio:verify` 在确认 latest 与其派生归档逐字节一致后，还要枚举所有采用
  compact UTC timestamp + UUID 命名的现代归档。每个现代文件必须是合法 JSON，且 filename 与
  `evaluatedAt/runId` 身份完全一致；再沿用持久化器的 `(evaluatedAt, runId)` 排序求最大值，要求
  latest 正是该最大项。目录中五个明确白名单、早于 run ID 合同的 legacy basename 只有在内容
  仍是合法 JSON object 且没有 `runId` 时才不参与排序；其余任何 `ai-live-eval-*` 条目都必须是
  可由 JSON 身份回算出的 canonical modern filename，横线日期伪装、借用 legacy basename、
  大小写或其他畸形均失败关闭。
- 理由：只验证 latest 与“自己的”archive 相等，允许把两个文件一起回滚到旧运行，同时把更晚
  archive 留在目录中，校验仍为绿色。这会隐藏更晚的失败观察，违背 latest 的 newest-wins 语义。
- 边界：普通文件系统仍不提供不可篡改存储；该检查证明当前目录快照的身份、字节和排序闭合，
  不证明文件从未被有写权限的主体删除，也不重放供应商响应。
- 验证方式：单元测试依次持久化 old/new，再把 old archive 原样恢复为 latest，要求 helper 与
  portfolio 调用链均拒绝；另覆盖 filename/JSON identity 漂移、把较新归档重命名为未获准的
  dashed legacy-like 名称、把新 run 移入白名单 basename、畸形现代条目、相同时间的 run ID
  决胜和五个无 run ID 的 legacy 白名单。

### ADR-210：STATUS 的公开 release 与证据文案必须绑定机器快照

- 状态：Accepted
- 日期：2026-08-31
- 决策：`portfolio:verify` 除 quality prose 外，类型化解析 STATUS 当前公开 runtime SHA、release
  path、最后完整记录的 timestamp release lineage，以及 `jurisdictions/regulations/limits/sources`
  和获准公开真实 fixture 总数。解析结果必须分别与 machine block 的 release/evidence 字段一致，
  再执行 Git 对象、fixture closure 与 publication manifest 的独立重算。machine start/end marker
  和完整 JSON fence 必须各形成唯一一组；公开 prose 在排除 HTML comment、反引号或波浪号 fence
  后，只允许各自明确 bullet/table row 唯一命中，跨段拼接、隐藏 decoy 或重复主张全部失败。
- 理由：machine block 可以保持正确，而面试者实际阅读的 release SHA 或 `97/28/651/203` 文案被
  改错；此前 verifier 仍会通过。可见主张与机器证据必须共用同一个失败关闭边界。
- 边界：解析器只锁定 STATUS 中标记为当前观察的 canonical 文案，不把历史 ADR、验收轨迹或旧
  release 表格中的数字重写为当前值；生产是否仍处于该 SHA 仍需联网 canary/readback。
- 验证方式：单测覆盖完整解析、缺失文案、当前/历史 release 漂移、证据闭包与真实 fixture 数漂移、
  重复 machine block、comment/fence decoy 和重复 canonical prose；`pnpm portfolio:verify` 对当前文档
  执行同一比较。

### ADR-211：reasoning 文本标签的实体规范化必须覆盖嵌套 amp 编码

- 状态：Accepted
- 日期：2026-09-01
- 决策：普通 text 与递归 provider 值进入 reasoning 标签检测前，先执行 NFKC 并移除 Unicode
  format control；随后只用白名单 grammar，把零层或任意层 `amp` / `&#38;` / `&#x26;` 包裹的
  named/numeric `lt`、`gt` 实体规范为尖括号，再匹配完整 `think/thinking/analysis/reasoning` 标签。
  不引入通用 HTML entity decoder，也不解码其他业务字符。
- 理由：原边界只规范化一层尖括号实体。provider 输出
  `&amp;lt;thinking&amp;gt;PRIVATE...` 时，证据充分路径会把 marker 原样送入 `fullStream` 和 Route
  SSE，违反 reasoning 永不出网的合同。按白名单直接识别嵌套 grammar 比固定次数循环更完整，
  同时避免扩大为通用 HTML 解释器。
- 边界：检测仍以完整缓冲区和既有 16,000 字符上限为界；它识别私有推理标签，不把普通
  analysis/reasoning 业务词当作标签，也不尝试净化任意 HTML。
- 验证方式：helper 表驱动覆盖单层、双重、混合 numeric 与深层 amp 编码；充分 product-fit
  工具证据后的跨 chunk `fullStream` 回归和真实 `POST /api/chat` SSE 回归都注入私有 marker，
  断言 marker 与伪结论不可见，只保留结构化证据卡和本地化 reasoning 缺口。

### ADR-212：首次激活的 check-ready 必须重验实际候选内容

- 状态：Accepted
- 日期：2026-09-01
- 决策：`release-artifact-manifest.mjs check-ready` 先调用与 `verify` 相同的全量工件重算，再按
  `diesel-release-input-v2` 的精确文件集合逐项验证 tracked 输入的 regular-file 身份、单链接、
  executable bit、大小与 SHA-256。它还要求 cwd 为 `releases/<expectedCommit>`，且唯一排除在
  tracked 集合外的两个运行时链接 `.env.production.local` / `.data` 必须解析到同一 deploy root
  的 `shared` 普通文件/真实目录。最后才比较 build 与 ready marker。
- 理由：旧 `check-ready` 只比较两份 marker；`finalize` 后改写 `node_modules` 时仍成功，现有测试
  甚至把“不重新 hash”当作预期。相同窗口也允许 Nginx、ecosystem 或共享链接漂移，使激活门的
  绿色结果不能证明实际将要启动的候选仍是已验证对象。
- 边界：该检查是 root-controlled candidate 在首次切换前的本机完整性重验，不是签名、远端
  attestation、SBOM、可复现构建或持续运行时监控；有权限在检查后并发改写 root-owned release
  的主体仍超出本合同。历史 release 的 rollback 兼容路径不追溯应用新格式。
- 验证方式：函数级测试先证明旧行为在五类 post-finalize 漂移下失败，再反转为 fail-closed；
  clean candidate 仍返回原 digest，构建工件、Nginx、ecosystem、额外输入、环境链接和数据链接
  任一漂移均必须以非零退出。部署合同与 Linux handoff 继续在 `current` 切换前调用同一命令。

### ADR-213：首次激活必须重验冻结身份与权限边界

- 状态：Accepted
- 日期：2026-09-01
- 决策：`check-ready` 的调用者必须显式提供 immutable 与 runtime 的数值 UID/GID。生产只传
  `root:diesel` 和 `diesel:diesel`，且 CLI 自身要求 effective controller 为 `root:root`，拒绝 root
  runtime、相同 immutable/runtime UID、零 runtime group 或 group 不闭合。deploy root 与
  `releases` 必须是 controller-owned 0755 真实目录，并在检查结束前与 canonical release 一起
  重验 inode/metadata；canonical release、tracked 文件/目录、control files、`.next`、
  `node_modules` 均按冻结后的 `0750` / `0640`（可执行文件 `0750`）精确校验 owner、group、mode，
  普通文件继续要求 `nlink=1`；artifact symlink 只比较 owner/group，不依赖不可移植的 symlink mode。
  `.next/cache` 是唯一 runtime-owned 工件例外，并须与 `shared/.data` 同属 runtime identity、同为
  0750。`shared` 必须是真实的 immutable 0750 目录，环境目标须为 immutable identity 的 0640
  单链接文件。输入集合同时比较由 manifest 文件路径推导出的目录闭包，额外空目录也失败关闭。
- 理由：内容摘要与 executable bit 不会区分 0640/0660 或 root/diesel owner。finalize 后只改权限或
  owner 时，旧实现仍会放行，随后降权运行进程即可改写所谓 immutable candidate。另因 actual 与
  expected target 同时 realpath，整体把 `shared` 换成外部 symlink 也会一起解析到外部并通过；若
  deploy root 或 `releases` 漂移为运行用户可写，验证后的整个 release/shared 还可被 rename 替换。
- 边界：`.data` 可能被旧 release 并发写入，因此只锁定其 inode/type/identity/mode，不绑定内容、
  mtime、ctime 或目录 nlink；`.next/cache` 同样不进入内容摘要。身份参数是 verifier 的显式调用合同，
  生产 root-side 脚本负责从已验证的系统账号解析数值，不能由请求或环境变量提供。该校验仍不是签名、
  远端 attestation 或检查后持续监控。
- 验证方式：函数级测试覆盖 clean candidate、可写 deploy root/`releases`、额外空目录、
  production CLI 的非 root/同身份误用、tracked/artifact/control 的宽松与过严
  mode、环境 hardlink、world-writable env、symlinked shared、错误 immutable/runtime identity 和
  runtime data 内容变化；GitHub-hosted Linux handoff 还会对 deploy root、`releases` 与 immutable
  artifact 真实执行 `chown diesel` / `chmod 0660` canary，要求全部拒绝并在逐项恢复 root-owned
  metadata 后再次通过。

### ADR-214：verifier 的 symlink 入口不能绕过主程序

- 状态：Accepted
- 日期：2026-09-01
- 决策：`release-artifact-manifest.mjs` 判断自身是否为 CLI 主入口时，必须对 `process.argv[1]`
  与 `import.meta.url` 两端先解析真实路径；通过 symlink 启动仍必须执行完整参数和 production
  identity profile 校验。普通用户的完整 `check-ready` 单测使用测试进程内联 `node --eval` harness
  调用明确命名的 test-only export，不在仓库中保留会随 `git archive` 发布的宽松 fixture CLI。
- 理由：只比较 lexical `resolve(argv[1])` 与真实 module URL 时，symlink 入口会被误判成“仅 import”，
  `main()` 完全不执行且 Node 静默以 0 退出。发布调用只观察退出码，因此这会把未运行验证伪装成绿色。
- 边界：生产接受路径仍只有 root-side 脚本固定调用的严格 `check-ready` CLI；test-only export 不执行
  host 切换，也不被任何部署脚本引用。能修改 root-owned 调用脚本或任意执行自制 verifier 的 root
  主体仍超出本地完整性合同。
- 验证方式：函数级测试从临时 symlink 无参数启动真实脚本，必须进入参数校验并非零退出；同时静态
  搜索和部署测试确保生产脚本只调用严格子命令，仓库不存在独立可执行的 check-ready fixture。

### ADR-215：发布授权必须绑定 exact master SHA 的当前 CI attempt

- 状态：Accepted；授权闭包继续有效，本地 archive 与授权的顺序由 ADR-227 演进
- 日期：2026-09-01
- 决策：工作站在任何 release archive、SSH 或远端目录创建之前，先用 `git archive` 从同一个
  40 位 `release_id` 只导出 committed、无外部 Node package/module 运行时依赖且内含 Zod 的
  verifier bundle，以 shell 比较临时
  副本/worktree 与目标 blob，并随 bundle 导出 Zod MIT 许可；清除 Node startup injection 后用
  Node 22 直接执行临时副本；
  `pnpm release:authorize` 只是非权威开发便利入口。授权器要求完全 clean 的 `master`，本地 HEAD / tracking ref、唯一且
  fetch/push 一致的 canonical origin、fresh `ls-remote` 与 GitHub master ref 全部精确等于该 SHA；
  同时读回 active 的固定 CI workflow 和 strict、管理员受限、禁止 force-push/deletion、只含
  `Required CI gate` 的 branch protection。exact-SHA push runs 不按 status 过滤，只接受唯一最大
  `created_at` 的 completed/success run；随后从该 run 的当前 attempt endpoint 读取唯一同 SHA、
  completed/success 的 gate job。runs/jobs 超过 100、`total_count` 不闭合、重复 ID、来源 URL/
  repository 漂移、最新时间并列或任何 schema/命令错误均失败关闭。GitHub 请求固定 REST
  `2022-11-28` 版本与 vendor JSON media type，避免默认 API 版本漂移。bundle 的逐字节构建结果
  由测试与源码锁定，生产运行时不解析工作区 `node_modules`。成功 stdout 必须非空且不超过
  64 KiB，再由同一 committed bundle 的 strict Zod schema 二次核对
  commit/origin/run/job URL 闭包；解析后 shell 再次核对两份 blob，不能只信退出码或让工作区
  verifier 自证。
- 理由：workflow-level success 不能证明新版汇总 gate 存在；当前远端 master 的旧成功 run 就没有
  `Required CI gate` job。只筛选成功 run 还会隐藏同 SHA 后续失败或运行中的 run，普通 jobs endpoint
  则可能把旧 attempt 的成功当作当前重跑证据。本地 stale tracking ref 也不能替代权威远端读回。
  仅在 verifier 内清理子进程环境太晚：继承的 `NODE_OPTIONS` 可在模块加载前 0 退出；只让同一
  worktree verifier 自检/复核也会被 skip-worktree 隐藏替换整体绕过；若 committed verifier 仍
  加载未绑定的工作区依赖，绕过只会转移到模块求值阶段。因此 committed 自包含启动边界、独立
  blob 比较和结果存在性/结构都必须纳入授权合同。
- 边界：读取 gate 后会再次读取 runs、GitHub ref、本地 HEAD/worktree、fresh remote，并核对正在
  执行的 verifier blob 等于 HEAD 中 blob，以缩小 rerun/ref/skip-worktree 竞态；后续 archive 必须
  复用同一 `release_id`。结果是瞬时 readback，不是签名、SBOM、可复现构建或持续授权。当前保护
  check 的 `app_id=null` 不代表 app-bound；本次 gate 的 Actions 来源由 workflow run/attempt/jobs
  独立绑定，未来迁移 app binding 时须显式升级合同。
- 演进：ADR-227 以 committed staging 入口取代 Markdown 编排后，先用 committed manifest
  helper 完成无远端副作用的 tree 预检、完整 archive 与本地 digest 闭合，再在首次
  SSH 前执行本 ADR 的完整授权。因此本 ADR 原始“早于任何 release archive”的本地顺序
  被 supersede；“授权成功前绝无 SSH、rsync、远端目录创建或其他 host mutation”、
  exact SHA/CI attempt 闭包、committed bundle 与 point-in-time 边界保持不变。
- 验证方式：63 条定向测试覆盖 clean happy path、CLI/pnpm separator/symlink/临时 committed 入口、
  startup injection、恶意旁路 Zod、源码/bundle 逐字节重建、metafile 外部 import 白名单、64 KiB
  字节边界、捕获 JSON 的 strict schema/commit/URL 二次验证，以及完整 Git/URL/ref/protection
  漂移、外部 JSON schema、分页与重复 ID、旧成功+新失败/运行中、时间并列、旧远端“总体成功但
  无 gate”、gate 缺失/重复/失败/错误 SHA 或 attempt，以及 jobs 后的 rerun、ref 和本地状态竞态；
  部署配置测试还要求 committed staging 入口中的授权严格晚于本地完整 archive
  验证、严格早于 SSH 和 rsync，并证明授权失败为零远端动作。

### ADR-216：live eval 的 stream error 与检索 query 必须在落盘边界失败关闭

- 状态：Accepted
- 日期：2026-09-01
- 决策：suite 升级为 `sales-chat-live-v9`。只要生产 `streamSalesChat()` 的 observer 收到
  `onStreamError`，该 case 就必须记录为 `EVAL_CASE_ERROR/not_evaluated` 并停止后续 case；即使
  AI SDK 的 text、tool calls/results、usage 和 steps 便利 Promise 随后以 fallback 值全部正常
  resolve，也不得把该文本或工具结果交给 scorer。已观察到的 provider attempt、completed call、
  step usage 与 token ledger 继续作为不完整已知下界保留。对成功完成的 case，参数评分仍使用内存
  中的真实工具输入；进入 latest/archive 的白名单参数会把 `searchKnowledgeBase.query` 严格替换为
  Unicode code-point 字符数与原 UTF-8 文本的 SHA-256 摘要。v9 schema 拒绝 query 原文、畸形摘要
  和缺失摘要；v8 及更早报告保持历史 schema，不回写。
- 理由：SDK 可以在流中发出 error part，同时让聚合便利 Promise 以证据缺口 fallback 正常完成；若
  runner 只等待 Promise，就会把实际 provider 异常误记为完成执行，甚至形成安全通过。另一方面，
  模型可把用户敏感文本复制进知识检索 query；虽然报告不保存 prompt，原实现仍会把该 query 原文
  写入可提交的 latest 与 append-only archive，违反同一隐私主张。
- 边界：SHA-256 摘要用于证明同一进程内的确定性脱敏形状，不是加密、匿名化保证或可逆的请求
  重放材料；低熵查询仍可能被离线枚举，因此公开文档不把摘要称为匿名数据。原 query 在本次调用的
  内存中仍用于真实检索和 expected-argument 判定，不进入报告、日志或 mismatch 文本。历史归档
  继续可读，但不会被静默重写。
- 验证方式：runner 级 mock 先记录 1 attempt / 0 completed 和 22-token step ledger，再触发私有
  stream error，同时让五组便利 Promise 全部 resolve；断言报告只有首 case、termination 为
  `case_error`、fallback 与上游详情均不落盘且 token 下界保留。另用唯一 query marker 经过 v9
  sanitizer 后真实写入临时 latest/archive，要求两份逐字节一致、均不含 marker/非白名单字段，
  只包含字符数和合法 64 位摘要；版本化 schema 测试同时证明 v8 原文兼容与 v9 原文拒绝。

### ADR-217：live eval v10 必须对全部自由字符串脱敏并保存可审计的检索契约观察

- 状态：Accepted
- 日期：2026-09-01
- 决策：suite 升级为 `sales-chat-live-v10`，v8/v9 报告继续走各自独立的历史 schema。
  对每个完成 case，runner 先用对应生产 Zod schema 解析实际工具输入；模型知识检索由生产聊天与
  eval 共用同一个额外拒绝私有推理标签的 schema，可信 admin/dev 检索不受该收窄影响。有效输入中的
  `searchKnowledgeBase.query`、`productModelCode`、`metricCodes` 与非空 `jurisdictionId`
  均按 canonical 值替换为 Unicode code-point 字符数和 SHA-256 摘要，无效输入则只落空对象
  作为失败关闭哨兵，不保留部分原值；v10 schema 只允许该 `{}` 哨兵与 `TOOL_RESULT_ERROR`
  同时出现。三个知识检索 case 另声明受限 required/forbidden term group；runner 在内存中按
  NFKC、默认可忽略字符移除、大小写、空白、连字符与 Latin/数字/下划线 token 边界确定性判定，
  Han/Latin 脚本切换可作为普通双语检索边界，只把
  matched/missing/forbidden group ID 和布尔结果写入 query 观察，并将该结果纳入
  `argsPassed`；即使其他参数已失败，query 观察仍独立记录并验证。verifier 用同一 expected 参数
  投影和 canonical case group ID 重算持久化参数判定。生产流把无效、动态、provider-executed、
  不完整、孤立/畸形结果、工具错误、输出拒绝、协议外 part 与最终缓冲 reasoning 拒绝只以稳定分类
  通知 runner，不传原始 payload；任一通知使该 case 以 `TOOL_RESULT_ERROR` 失败，不能被 transform
  丢弃后仍计为正常完成。
- 理由：v9 已避免 query 原文落盘，但产品型号、指标代码等 provider 可控字符串仍可能复制
  私有 marker；同时仅有 query 摘要时，持久化 verifier 看不到“保留有意义检索词、排除不可信
  指令”的有限观察。工具感知解析可以在脱敏前拒绝未知字段并复用生产 canonicalization；安全
  group ID 可提高报告可审计性，而无需保存 prompt、query 词面或工具结果。
- 边界：原 query 的知识主题仍由生产 evidence contract 在内存中与可信用户意图核对；v10 的
  term group 是额外的固定 case 合同，不替代生产证据边界。报告能重算已保存 ID/布尔值与参数
  摘要是否自洽，但不能由摘要重放被丢弃的 query 或证明任意自然语言语义。无盐 SHA-256 对低熵
  值可被枚举，仅承诺 provider 自由字符串原文不落盘，不宣称加密、匿名化或不可链接。
- 验证方式：纯函数测试覆盖英文/中文命中、NFKC 大小写与连字符、英文部分 token 不误命中、
  required 缺失、混合脚本边界、默认可忽略字符绕过与 forbidden 注入；七工具相关 schema/fixture
  覆盖 canonical 化后指纹、无效输入空哨兵与 v8/v9/v10 版本隔离。产品型号测试还锁定 Unicode
  uppercase 扩张后合法输入可形成最多 300 个 code point 的指纹。唯一 marker 注入 query、产品
  型号、指标代码和 UUID 后，序列化
  观察不得包含原值；synthetic v10 verifier 测试分别篡改产品/指标摘要及 query group 观察，均须
  在伪造 `argsPassed=true` 时失败。

### ADR-218：reasoning 标签规范化以有界解码和残留失败关闭取代无限 grammar

- 状态：Accepted；supersedes ADR-199/211 中关于 `Cf`、任意层实体和直接 grammar 的实现细节，
  不改变两项决策的隐私目标、完整缓冲区边界或非通用 HTML 解码边界
- 日期：2026-09-01
- 决策：普通 text、工具参数与递归 provider 值进入私有 reasoning 标签检测前，先执行 NFKC 并
  移除 Unicode `Default_Ignorable_Code_Point`；随后最多 16 轮解码白名单 `amp/lt/gt` 与合法
  十进制/十六进制 numeric character reference。若最后仍残留受支持实体，则整段按 reasoning
  失败关闭。标签专用模式还识别标签前缀、名称字符之间和分隔位置的 named character reference，
  但不解释其业务字符，也不引入通用 HTML entity decoder。
- 理由：只移除 `Cf` 会漏掉其他默认可忽略字符；只解码尖括号会漏掉插入标签名的 named entity；
  未限定的任意嵌套 grammar 又无法给 provider 控制的处理成本提供明确上限。有界解码与残留失败
  关闭同时保留隐私失败关闭和确定性工作量。
- 边界：检测仍只针对完整 `think/thinking/analysis/reasoning` 标签形态，不把普通业务词判为
  reasoning，也不声称识别没有标签的任意 chain-of-thought。`sendReasoning=false`、typed part
  丢弃、模型专用知识检索 schema 与结构化证据优先继续共同构成边界。
- 验证方式：纯函数、真实 `fullStream` 与 `POST /api/chat` SSE 测试覆盖跨 chunk、named/numeric
  entity、默认可忽略字符、标签名插入、16 轮内嵌套和超深残留；marker 与伪结论不得出网，只能
  保留通过 schema 的工具卡和本地化证据缺口。

### ADR-219：国家详情宽画像与适用性摘要共享只读 repeatable-read 快照

- 状态：Accepted；仅替代 ADR-182 中“国家详情内部独立读取不声明同一 MVCC snapshot”的实现
  边界，不改变机会分、销售简报或页面地图目录的独立读取语义
- 日期：2026-09-01
- 决策：`getCountryDetails()` 在外部输入通过 Zod 且补齐默认 `asOf` 后，只打开一次
  `accessMode=read only / isolationLevel=repeatable read` 事务。国家仓储与法规仓储都从该
  transaction 创建，宽国家画像、可选 applicability summary、来源/新鲜度闭包和最终 response
  schema 校验全部在回调内完成。`compareRegulations()` 保留原公共入口；新增的
  `compareRegulationsFromRepositories()` 只复用调用方仓储，事务内不得再次初始化数据库或打开
  根事务。既有 `allSettled` barrier 继续等待同一事务中所有已启动查询 settle 后才传播错误。
- 理由：PostgreSQL 默认 READ COMMITTED 会让宽画像查询与随后另连接执行的法规比较看到不同
  committed 状态；更新恰好发生在两者之间时，单个合法 DTO 可能混合旧法规名称/来源和新适用性
  摘要。事务内再调用原 wrapper 还会让每个请求占住一条连接再等待第二条连接，在高并发下形成
  连接池饥饿，并会尝试在 PGlite singleton 根事务中再开根事务。
- 边界：该快照只覆盖一个国家详情 response 内的数据库读取；同页面地图摘要、独立法规比较、
  市场/产品读取和 score/brief 聚合不在同一事务。只读快照不证明来源真实、候选完整或 DTO 未携带
  的字段正确。AbortSignal 仍只能阻止新阶段并让事务回调拒绝；生产 PostgreSQL 路径中已发出的
  SQL 由 statement/lock timeout 限界，PGlite 路径只保留阶段间 abort check，不声明 driver-level
  cancel 或 timeout。事务应只包含数据库读取和纯 DTO 构造，不能加入模型或网络调用，以免延长
  MVCC 保留。
- 验证方式：函数级测试精确断言两个仓储由同一 transaction 对象创建、配置为只读
  repeatable-read、无效输入不打开事务、取消或适用性失败使回调拒绝；PGlite 集成读取
  `transaction_isolation/transaction_read_only`、以 SQLSTATE `25006` 证明拒写并确认 singleton
  连接可复用。CI 另在仅允许 loopback `diesel_ci` 且显式 opt-in 的 PostgreSQL 16 数据库中创建
  唯一 fixture：第一次仓储读取后由第二连接提交法规名称更新，再由同一 transaction 的真实法规
  仓储和确定性比较读取，宽画像与摘要必须仍同时返回旧名称，事务外读回则必须看到新名称；最后
  只删除该 fixture。

### ADR-220：性能延迟聚合保留下界但不得吞掉无效 step

- 状态：Accepted
- 日期：2026-09-01
- 决策：单个 completed provider step 的性能字段继续区分“未提供”与“已提供但无效”：前者为
  `{reported:false,value:null}`，后者为 `{reported:true,value:null}`；零值是合法观测。
  跨 step 聚合时，只有每个 step 都同时 `reported=true` 且 value 为非负有限数，聚合字段才可
  `reported=true`。任一步缺失、`NaN`、Infinity 或负数时，其余合法 step 的和仍作为 known lower
  bound 写入 value，但聚合 `reported=false`，从而使 `modelPerformanceComplete=false`。
- 理由：旧聚合先丢弃 null 再只检查字段是否出现。两个 token 完整的 step 中，若一个延迟为
  Infinity，单步会正确得到 `true/null`，但聚合却把另一个 step 的合法延迟误报为完整总量，strict
  log 无法从已丢失的逐 step 状态识别错账。
- 边界：`ModelObservabilityAggregate.incomplete` 继续只描述 stream/token ledger 完整性；性能坏值
  不得把完整 token usage 或基于该 usage 的成本估算误降级。此次不改变 provider 请求、live eval
  token ledger、成本公式或公开接口，也不把 known lower bound 描述为完整端到端用户延迟。
- 验证方式：表驱动测试以两个完整 step 覆盖缺失、`NaN`、Infinity、负数和全合法控制组，断言
  合法下界保留、聚合 reported 失败关闭，且 token/stream incomplete 保持 false；单步归一化测试
  继续锁定缺失、畸形与合法零值的不同表示。

### ADR-221：Dashboard 快照必须绑定当前 principal 并在失权时卸载

- 状态：Accepted；替代 ADR-169 中“后续身份与角色继续只使用 SSR `initialPrincipal`”的客户端
  边界，不改变其 JSON read model 最小化合同
- 日期：2026-09-01
- 决策：Dashboard JSON 继续拒绝 principal 字段；公共管理 route 在完成认证后的响应（包括 handler
  5xx）中以固定 email/role headers 回传本次实际认证的 principal，客户端必须经
  `adminPrincipalSchema` 校验后才能
  接受快照。SSR principal 只用于 bootstrap。200 principal 改变时接受新身份下取得的新快照，但以
  principal key remount 工作区并清除创建 payload、change reason、CSV/文件输入、preview、审核理由、
  发布确认和 notice。401/403、任何管理写入失权，以及 200 缺失或畸形 principal headers 都进入
  blocked：清空 dashboard 与全部瞬态状态、移除旧身份并卸载所有管理表单、完整 payload、diff 与
  audit DOM。只有带有完整合法 headers 且 principal 与当前身份精确相同的 5xx，或没有收到任何
  HTTP 响应的网络错误，才可在已有绑定快照上进入 degraded，并明确提示数据可能陈旧；缺失/畸形
  principal 绑定的错误响应一律清空。若错误、非 JSON 或 schema 非法响应绑定了不同的新 principal，
  则先切换身份再清除旧身份快照，首次读取失败也不渲染工作区。每次身份变化或失权同时递增
  workspace generation；所有写操作与 CSV preview 捕获发起时的 generation/principal，await 后只有
  二者仍匹配才能回写 notice、preview、审核理由、确认状态或触发刷新，避免 A 的迟到 action 在 B 的
  workspace 中恢复数据或错误边界。每个 mutation 还必须发送发起时的 expected email/role；公共
  route 在读取 body 或执行 handler 前将其与可信代理认证出的 principal 精确比较，缺失、畸形或漂移
  返回 `409 PRINCIPAL_CHANGED` 且保证 handler 零调用，不能等写入提交后才靠响应头发现身份变化。
  所有成功 action 响应先验证 principal，再验证各自结构化 response schema；绑定同一身份但违反合同的
  2xx 也必须卸载可写工作区。CSV 文件选择另有 selection generation：换文件与每次 preview 都递增，
  迟到的旧文件成功或错误不得恢复 batch、preview、notice 或 error。
- 理由：旧客户端丢弃 HTTP status/code，刷新失权后只显示错误，已加载的草稿 payload、审计、CSV
  preview 和表单值继续存在；所有权限控件又永久读取 `initialPrincipal`，因此 admin A 切换为 editor
  B 后即使新 GET 为 200，页面仍显示 A 和 admin 控件。服务端写路由会阻止真正越权，但 DOM 留存、
  跨身份输入复用和误导性授权展示本身仍违反失败关闭。
- 边界：响应 headers 不是新的登录机制，也不替代可信代理剥离/注入请求身份；它只把浏览器已获准
  读取的快照绑定到同一次服务端授权。500 不等于失权，但只有响应本身证明仍属于同一 principal 时
  才足以保留浏览器已取得的最后可信快照；无绑定响应不能用“可能同一身份”作乐观推断。客户端取消
  不会撤销服务端可能已经提交的写入，generation 只抑制迟到的界面副作用，后续可信 dashboard 仍是
  正式状态来源。expected-principal headers 不是授权凭据，服务端只能用它们与可信 principal 比较，
  不能据此提升权限。
- 验证方式：Desktop/mobile Playwright 覆盖加载后 401、403、写入 403、admin→editor 的 200、
  新身份绑定的 500、无绑定 500、200 缺失身份绑定、带新身份的非 JSON/schema 非法响应、同身份刷新
  500、两个并发刷新、同身份 2xx 合同损坏、pending preview 后换文件，以及跨身份迟到 action 成功/
  失败；断言旧 audit/payload/preview/文件和角色控件
  离开 DOM、身份变化 remount 输入、只有同身份绑定 500 保留并标记旧快照，迟到响应不能覆盖较新
  状态。API 回归继续要求 JSON 不含 principal，同时核对成功响应 headers 与实际 editor principal 一致；
  handler spy 证明 mutation expected principal 漂移时不会读取 body 或调用服务；畸形认证邮箱在认证边界
  归类为 `UNAUTHENTICATED / 401`，而不是业务输入 400。

### ADR-222：管理角色配置故障必须脱敏失败且拒绝规范化冲突

- 状态：Accepted
- 日期：2026-09-01
- 决策：`ADMIN_ROLE_BINDINGS_JSON` 是服务端配置，不是请求输入。解析必须捕获 JSON、schema、email
  与规范化冲突的全部失败，并统一抛出不携带配置值的 `AdminRoleBindingsConfigurationError`；公共管理
  route 只按未预期服务端故障返回固定 500，并沿用只记录 error class/code 的脱敏日志。配置键与可信
  请求身份都先 trim + lowercase 后再验证 email；两个原始键若归一化为同一 email，无论角色是否相同
  都使整份配置失败，不能按对象顺序静默覆盖。解析还保留顶层原始 JSON member 序列，在 `JSON.parse`
  吞并完全重复/Unicode 等价键之前拒绝，并以 source/schema key 数闭合拒绝被 schema 丢弃的特殊键。
- 理由：让配置 ZodError 落入请求输入分支会返回 400，并把 issue path 中的私有 allowlist email 写进
  响应；大小写或空格不同的重复键还会使有效角色取决于遍历顺序。两者分别破坏配置机密性与授权
  确定性。
- 边界：该错误不会回显具体坏键或角色；运维只能通过固定错误类型定位并离线校验配置。请求 email
  本身畸形仍是 `UNAUTHENTICATED / 401`，合法但未列入有效 allowlist 仍是 `FORBIDDEN / 403`。
- 验证方式：表驱动覆盖坏 JSON、非法角色、非法 email、规范化重复键；secret email/role canary 在
  route 500 body 与捕获日志中均不得出现，同时断言固定 `INTERNAL_ERROR` 信封和原环境恢复。

### ADR-223：治理发布的跨数据库/主机提交点必须由版本化状态机持有

- 状态：Accepted；完成 ADR-164/166 尚未覆盖的 snapshot、marker、恢复 trap 与 committed
  收尾迁移，不改变 PostgreSQL advisory maintenance lock 或 97 国 fixture selection
- 日期：2026-09-01
- 决策：`scripts/deploy/governance-publication-state-machine.sh` 是治理发布协调的唯一可执行入口，
  只接受完整小写 Git SHA 和 `publish`、`recover-required`、`finalize-committed` 三种模式。
  三种模式都必须作为 `with-governance-maintenance-lock.ts` 的直接 child，
  精确绑定 production/postgres 环境、release ID 与 maintenance token；`publish` 在同一 child
  内完成 fresh v4 snapshot、SHA dry-run、原子 `RECOVERY_REQUIRED`、恢复演练、source-only
  97 国队列、保存的公开 validator 以及原子 `PUBLISH_COMMITTED`。主发布 shell 还从创建
  rollback state 之前起，以固定 FD 8 持有不可替换 inode 的 root-only release lifecycle flock，
  并跨 host activation、治理 child 与 finalize 保持；Node wrapper 只在固定 capability 环境值存在时
  显式继承 FD 8，PM2 等长期进程关闭该 descriptor。该 child 自己持有
  `ERR/INT/TERM/HUP/EXIT` trap：commit 前首错只恢复一次，committed/finalized marker 一旦出现
  便永不恢复旧 snapshot。wrapper 在 Unix 为 child 建立独立 process group；signal、heartbeat
  failure、valid-PID `error` 与 `close` 共用一次 TERM 5 秒→KILL 5 秒→整组为空证明，并等待 direct
  `close` 后才允许解锁。proof 失败时禁止显式 advisory unlock，只 teardown owning session。
  root wrapper 不再用 Node `--env-file`：它从 root-only 0600 pre-switch backup 以 O_NOFOLLOW、
  bounded strict UTF-8、稳定 metadata 读取并只提取 Zod-valid `DATABASE_URL`；child exact allowlist
  排除 `BASH_ENV`、`NODE_OPTIONS`、`LD_*`、`AI_*` 与其他服务秘密，避免 loader/shell hook 在状态机前
  取得 root 执行。wrapper 自身被 `SIGKILL` 时无法运行组控制器；该不可捕获边界依赖 token lock
  消失后的写入拒绝、descendant 持有的 lifecycle FD 与 durable recovery marker 收敛，不宣称提供
  cgroup/PDEATHSIG 级父死终止保证。
- 恢复与收尾：三种模式复用同一 marker/snapshot parser，只接受非 symlink 的
  `root:root:600` 单记录 marker、release 固定 snapshot 路径、同权限普通 snapshot 和匹配的
  SHA-256；相关文件与 marker rename 都在返回前 fsync。64 位 token 只作索引，不作为
  capability：三种模式在最终 marker 变更前都用版本化只读探针证明 token-derived session lock
  仍由 wrapper 持有。`recover-required` 在锁内把 `RECOVERY_REQUIRED` 对应数据库恢复并重新导出
  深比较，再原子持久迁移为 `HOST_ROLLBACK_REQUIRED`；若已处于 host phase，则先重新证明数据库
  仍与旧快照一致。随后只允许版本化 restore-only host rollback 收敛到持久化 `previous-release`，
  旧 release verifier 由 `diesel` 用户在无秘密最小环境中执行有界、禁代理/`.curlrc` 的公开读回；
  rollback 保留 HOST marker。状态机在同一 maintenance lock 内重新导出并深比较 DB、复核
  current/lock 后，才把 active marker 原子持久迁移为永久 `HOST_ROLLBACK_COMPLETED` tombstone。
  COMPLETED 是完成时点的 terminal 审计账本；重复调用只 strict parse/fsync，不重放后来已合法变化的
  旧数据库或 host。
  `finalize-committed` 不接触数据库恢复；V1 先把 `PUBLISH_COMMITTED` durable 改名为
  `PUBLISH_FINALIZED`，再复用 release 内
  `rollback-host-release.sh --validate-committed` 验证 marker、snapshot、current 与 host 状态，
  包括唯一 live PM2 进程的精确 ecosystem 定义、实际 release/Node/Next 标题、`diesel` uid/gid，
  以及已经原子备份、fsync 且含同一精确定义的 root-only reboot dump；再以无秘密最小环境执行
  发布时保存的 root-owned validator，并紧邻状态迁移重验 lock/current/
  host；全部通过后最后把 host PENDING 原子改名、fsync 为 COMMITTED。面对已经 terminal 的
  `COMMITTED:PUBLISH_FINALIZED`，状态机 `finalize-committed` 仍重验完整 host/public/current/lock，只跳过
  rename；`rollback-host-release.sh --validate-committed` 只验 current/host/PM2，
  `host-activation-ledger.sh validate` 与全局历史扫描只解析/fsync terminal。host rollback 对两种 governance marker 都永久拒绝回退。
- 理由：此前真正决定数据库回滚或 host 保留的状态机仍是部署手册中的 heredoc。静态测试只能
  断言 Markdown 字符顺序，不能对 trap、信号、marker 篡改、恢复失败或 commit 后故障做行为
  注入；手工 recovery 还弱于正常路径，未统一拒绝 symlink/owner/path/hash 漂移，健康 curl 也
  未复用已有安全边界。
- 边界：`PUBLISH_COMMITTED` 的建立仍是数据库与 host 的唯一跨域 commit point，不是分布式事务；
  `PUBLISH_FINALIZED` 只持久记录已发生的不可逆事实，不创建第二个 commit point。
  lifecycle flock 也不是跨数据库事务；outer abort 必须只关闭自己的共享 FD，active phase 重新经
  maintenance wrapper 取得数据库锁和新 lifecycle OFD，避免 orphan child 借同一 OFD 发生伪重入，
  也避免无 DB lock 的 host 脚本宣告恢复完成。应用 release 还机器强制 backup/live/maintenance-child
  三方 PostgreSQL `DATABASE_URL` 解析值逐字节相同，连接轮换必须独立完成。无法捕获的 `SIGKILL`、
  主机重启或磁盘故障仍依靠持久 phase marker 由新会话收敛；脚本不自动选择 snapshot、不重试
  部分国家、不删除恢复/提交账本，也不取代 schema migration 的原生 PostgreSQL dump 恢复演练。
- PM2 durable host 边界：`/root/.pm2` 固定为非 symlink `root:root` 0700。正常 activation 与
  rollback 都必须在 `pm2 save` 后调用 release 内的 root-only persistence helper；helper 按 PM2
  的真实顶层 `pm2_env` dump 结构，以 16 MiB 有界读取验证唯一 `diesel-demo` 的正式版本、
  cwd/executable/interpreter、精确 args、fork/autorestart/memory 与数值 uid/gid，并拒绝 nested
  jlist decoy，随后规范化单链接 0600 主 dump，
  原子建立同字节 backup，并复验/fsync 主文件、backup 与目录。rollback 不复用表面健康的旧
  definition，而是总从受信 previous ecosystem 重建。live validator 在 `/proc` 检查前后重复读取
  jlist，并把 cwd、Node executable、Next title 与 OS uid/gid 绑定到同一 PID/release；不符合
  新降权合同的 legacy release 失败关闭。该 durable PM2 proof 在 commit/finalized validator 中
  再次执行。`pm2-root.service` 证明采用磁盘 A→loaded A→一次 `/proc`→loaded B→磁盘 B：loaded
  侧枚举并固定启动/停止 hooks、依赖、执行身份、root/context、环境继承、slice、fragment/
  cgroup 与 MainPID；磁盘侧逐字节验证 canonical PM2 template，并扫描预批准 UnitPath 中的
  drop-in、跨 root alias、dependency 与反向 enable 候选，只接受全局唯一的 multi-user symlink。
  MainPID 还与 root-owned pidfile、`/proc` Node executable/cgroup/environment 交叉验证，磁盘
  A/B 指纹必须相同。这是已枚举高风险状态的只读 fail-closed 证明，不是 PID 1 loaded-state
  digest；default boot transaction、保留 metadata 的 root actor 与真实重启结果仍属于 VPS
  provisioning/演练信任边界，不能表述为已完整证明 reboot。
- 验证方式：Linux 隔离 fixture 与 fake command 记录验证 snapshot→marker→rehearsal→queue→
  validator→commit 顺序；表驱动拒绝非法 release、环境、token、symlink、owner/mode、多行、
  路径与 hash 漂移；queue/validator/TERM/进程组/锁丢失注入证明 commit 前单次恢复，commit marker
  后错误证明零恢复；真实 flock 测试证明 inherited 同一 OFD 可重入而 close+reopen 会被 orphan
  拒绝；recover/finalize 的成功与失败分别证明数据库、旧 host/current 与 capability 复核完成才
  迁移 durable tombstone，失败始终保留一个可恢复事实。

### ADR-224：host activation 以不可扩展 cutoff manifest 和双账本状态机失败关闭

- 状态：Accepted；补齐 ADR-223 在首次 host mutation 前和治理 terminal marker 后的崩溃窗口，
  不改变数据库 schema、公开 API 或跨域 commit point
- 日期：2026-09-01
- 决策：首次启用 V1 时，operator 必须在本次 40-SHA state directory 出现前、持有固定 FD 8
  lifecycle flock，显式执行 `host-activation-ledger.sh initialize-protocol <release>`。初始化会完整
  枚举 backup 根，拒绝 symlink、隐藏/临时/未知 marker、basis-only、anchor-only 和任意 active
  legacy 状态；仅允许严格可解析的 `HOST_ROLLBACK_COMPLETED` / `PUBLISH_FINALIZED`，并把各自
  release、marker 固定路径与 SHA-256、snapshot 固定路径与 SHA-256 按 release 排序写入
  `HOST_ACTIVATION_PROTOCOL_V1`。manifest 是单链接 `root:root:600`、有界、原子 rename 并复验/
  fsync 的永久 cutoff：普通发布在它缺失时失败，已存在时只允许同一 enabling release 精确验证，
  永不自动重建、扩展或重新 grandfather。
- 每个新 release 的 rollback basis 经过完整 host preflight、旧 verifier、`current=previous` 以及
  live env/Nginx 与 backup 字节相等证明后，内部受信调用先写 `HOST_ACTIVATION_V1` anchor，再写
  `HOST_ACTIVATION_PENDING`；两条记录都绑定 release、previous path 和四份 rollback basis 的固定
  路径/hash。只有 durable PENDING 返回后 outer shell 才安装 abort traps，runtime preparation 也在
  build、systemd、candidate tree 与 live host 任一 mutation 前重复要求同一 `PENDING:none` 和 FD 8。
  仅证明 descriptor 指向 lock inode 不等于持锁；helper 每次都以 `flock -n 8` 重新证明或安全取得
  同一 OFD 的独占 flock，另一个 OFD 已持锁时固定失败。
  CLI 只公开 `initialize-protocol` 与只读 `validate`；begin/transition 只能由版本化 rollback、runtime
  或 governance coordinator source 后调用，避免绕过完整恢复/验证流程直接写 terminal 状态。
- V1 只接受以下组合；其他共存关系一律失败关闭：active 为 `PENDING:none`、
  `PENDING:RECOVERY_REQUIRED`、`PENDING:HOST_ROLLBACK_REQUIRED`、`PENDING:PUBLISH_COMMITTED`、
  `PENDING:PUBLISH_FINALIZED`、`ROLLED_BACK:HOST_ROLLBACK_REQUIRED`；terminal 为
  `ROLLED_BACK:none`、`ROLLED_BACK:HOST_ROLLBACK_COMPLETED`、`COMMITTED:PUBLISH_FINALIZED`。
  host-only abort 先完整恢复/readback，再把 PENDING 原子迁移为 ROLLED_BACK。治理恢复无论从
  `PENDING:HREQ` 还是 crash 后的 `ROLLED_BACK:HREQ` 重试，都重新执行幂等 host restore，再深比较
  DB、复核 `current`/lock；只有这些证明完成才把 HREQ 迁移为 HCOMP。finalize 先把
  `PUBLISH_COMMITTED` durable 迁移成 `PUBLISH_FINALIZED`，因此该中间组合只能向前修复；重复 host/
  public/current/lock 证明成功后，最后一步才把 PENDING 迁移为 COMMITTED。
  已经存在 COMMITTED terminal pair 时，状态机 `finalize-committed` 仍重跑完整当前发布验收；
  `rollback-host-release.sh --validate-committed` 只重验 current/host/PM2，而
  `host-activation-ledger.sh validate` 与全局历史 scan 只把它作为无需重新施加到当前 host 的审计事实。
- 理由：仅有治理 marker 无法证明“下一次发布尚未开始修改 host”，也不能区分 PFINAL 已持久化但
  host terminal marker 尚未完成的崩溃点。显式 cutoff 防止新代码把历史 basis-only 目录误判为空闲，
  per-release anchor 则让 anchor-only、PENDING、ROLLED_BACK:HREQ 和 PENDING:PFINAL 都有唯一、可重放
  且不会倒退的收敛路径。
- 边界：脚本仍不能阻止等价 root 在 flock 外直接改文件；它通过固定权限、hash、重复 readback 与
  全局 single-active scan 检出漂移并停止。anchor-only 只能由同一 release 重新走完整 begin preflight；
  其他 release 或其他 mode 都拒绝。初始化前的 basis-only/active legacy 需要人工收敛，不能靠删除事实
  或扩大 allowlist 解锁。主机掉电或不可捕获 `SIGKILL` 可能停在上述 active 组合，但不得产生静默
  idle 或可回滚的已提交状态。
- 验证方式：Linux 隔离 fixture 对 manifest 排序、hash 漂移、不可扩展、未知/临时/symlink 状态，
  anchor-only 同 release retry、跨 release 拒绝、FD 8 与 global single-active，host repair 后故障、
  `ROLLED_BACK:HREQ` 重放、PFINAL 后故障和最终 COMMITTED 顺序做表驱动与 fault injection；静态测试
  还断言公开 CLI 不暴露 mutation mode，治理 child 不使用 Node `--env-file`。

### ADR-225：Dashboard strict DTO 必须在服务端出网前执行

- 状态：Accepted；补齐 ADR-169 只在 repository 投影和浏览器解析处间接约束 wire response 的出口缺口
- 日期：2026-09-01
- 决策：`GET /api/admin/dashboard` 在调用 `NextResponse.json` 前必须把返回树转换为精确 JSON wire
  值，并用 `adminDashboardResponseSchema` 对顶层 envelope 及所有嵌套对象执行 strict admission。
  合法 exact-prototype `Date` 只经内建 intrinsic 转为 canonical ISO timestamp；非有限数、`bigint`、
  `undefined`、function、symbol、accessor、Proxy、数组 subclass/稀疏数组、特殊对象、非法日期和
  循环引用全部失败关闭。数组只按 own data descriptor 复制到新建普通 dense array，不能调用输入的
  `map`、`toJSON` 或其他实例方法。schema 只返回 `parsed.data`，未知的 import history、
  audit snapshot、draft storage metadata、baseline identity 或 dependency 内部字段不能依赖 JSON
  serializer 丢弃，也不能先传到浏览器再由客户端拒绝。客户端继续复用同一 schema 作为网络传输
  和错误代理的纵深防御。
- 错误边界：响应合同失败使用独立 `AdminDashboardResponseContractError`，由管理 route 的未知服务端
  故障分支返回固定 `500 INTERNAL_ERROR`；不得直接抛出 `ZodError`，否则会被错误归类为请求输入
  `400 INVALID_INPUT` 并可能公开 issue path。错误响应与 strict structured log 只保留固定错误类，
  继续携带本次已认证 principal 的绑定 headers 以及 private no-store/no-cache，不记录污染字段值。
- 理由：客户端校验发生在 `response.json()` 之后，最多阻止渲染，不能阻止私有治理字段离开服务端。
  repository 精确投影是必要的最小查询面，但未来 service envelope 漂移仍可能把字段重新展开到路由；
  服务端出口 admission 才能把“不会发送到 editor 浏览器”变成可直接测试的不变量。
- 验证方式：真实 route mock 证明正常 `Date` 被规范化且 200 body 精确通过 strict DTO；表驱动注入
  顶层 import batch、audit before/after snapshot、draft storage 字段、baseline/dependency 内部字段、
  非 JSON 值、非法日期、覆写 Date/Array 方法、array subclass、accessor、稀疏数组与循环 payload，
  全部必须在出网前返回同一脱敏 500，body 和捕获日志均不含 canary，同时保留 principal 绑定与
  禁止缓存 headers。既有 repository/PGlite 测试继续证明查询投影
  本身不读取未消费的历史数据。

### ADR-226：应用 coverage 与 deployment-script contracts 必须并行且共同阻断合并

- 状态：Accepted；并行分区与共同阻断决策仍有效，原 deployment job 的 30 分钟上限与
  默认 reporter 已由 ADR-268 更新
- 日期：2026-09-01
- 决策：保留 `pnpm test` 与 `pnpm test:coverage` 对 139-file 完整 Vitest 集的既有语义；新增
  `test:coverage:app`，只从 coverage run 排除 `tests/deploy-scripts.test.ts`，并新增
  `test:deploy:contracts` 精确运行该文件。非 schedule CI 的 `quality` job 运行前者，独立
  `deploy-contracts` job 在 Ubuntu、完整 Git history 和 frozen install 下运行后者；两个 job
  不互相 `needs`，各有 30 分钟上限。唯一 `Required CI gate` 将依赖从 8 项增至 9 项，并对
  `DEPLOY_CONTRACTS_RESULT` 单独要求 `success`。coverage artifact 仍只由 quality 上传。
- 理由：本地完整 Vitest 已观测为 1259.45 秒，单测试阶段就超过旧 quality 的 20 分钟上限；
  排除 deployment suite 后的应用 coverage 为 401.13 秒，138 files / 2695 passed / 1 skipped，
  statements 88.22%、branches 83.5%、functions 92.29%、lines 88.4%。该 deployment suite 以
  Bash 子进程合同为主，并不命中当前 coverage include 的 `src/domain`、`src/lib`、`src/server`
  范围；把它与应用 coverage 串行不会增加当前应用覆盖证据，却会让合法回归在 job timeout 前
  无法到达 build。并行分区保留测试并改善关键路径，而提高 timeout 单独不能获得并行收益。
- 边界：上述时长是当前本地工作树观察值，不是 GitHub-hosted runner SLO，也不证明新 workflow
  已在远端成功。若未来 deployment suite 开始命中 coverage include，app-only coverage 会因缺少
  那些执行路径而更保守，阈值仍会失败关闭；不得把部署 job 的无 coverage 输出合并进应用工件。
  e2e、Demo、FDE 与真实 Linux release handoff 继续依赖 quality 或最终汇总，不因拆分删除 build、
  Linux 权限语义或分支保护要求。
- 验证方式：workflow 合同测试锁定两个 package script 的精确命令、job 边界、完整 history、
  无串行 `needs`、30 分钟上限、唯一 coverage artifact，以及 Required gate 的 9-job/9-result 闭包；
  action/image pin audit 继续拒绝可变引用。定向回归分别运行应用 coverage 与 deployment suite，
  完整 `pnpm test` 仍验证二者并集。

### ADR-227：工作站 release staging 必须由 committed 版本化入口持有

- 状态：Accepted；迁移 Markdown 可执行实现，不扩大 release 的激活、数据库或公开写入能力
- 日期：2026-09-01
- 决策：`docs/DEPLOYMENT.md` 不再内联授权、commit export、manifest、远端 candidate
  创建与 rsync 的长段 Shell。runbook 只在 clean worktree 中取 `master` HEAD 的完整小写
  SHA，以 0700 临时根从该 commit object 导出 `scripts/deploy/stage-release.sh`，核对
  committed/extracted/worktree blob 和 non-symlink regular-file 边界，再用 `/usr/bin/env -i`
  只传递显式 `PATH` / `HOME`、授权、代理/TLS 与 SSH 凭据 allowlist，并以
  `/bin/bash --noprofile --norc` 执行 committed 副本；exported shell functions、`BASH_ENV` / `ENV`、
  `SHELLOPTS` / `BASHOPTS` 和其他未列出的 startup injection 不跨过该边界。脚本在每个 Node
  边界另行清除 `NODE_OPTIONS`。production CLI 只接受
  一个 40 位小写 commit SHA，固定 SSH target 和 `/opt/diesel` deploy root，不提供环境
  override 去改变生产目标。
- Bootstrap 先行证明：在导出或执行 committed 入口前，当前目录必须是 physical repository root，
  HEAD 必须 attached 到 `master`；status 与 index readback 的非零退出码显式传播，不能因空 stdout
  误判为 clean。bootstrap/stage/manifest 的 local Git 调用关闭 fsmonitor、hooksPath 与 external
  diff。
- 本地顺序：脚本在任何完整 payload archive 或 SSH 前，从同一 commit 单独导出 committed
  `release-input-manifest.mjs` 和 `run-bounded-command.mjs`，逐一绑定 committed/worktree/archive
  blob；前者预检 Git tree，后者以本地 clean-env Node 为三段远端操作提供执行 deadline、分流输出上限和
  进程组终止。admission 拒绝所有根名以 `.env` 开头的
  输入，唯一例外是路径精确等于普通文件 `.env.example`；`.env.example/...` 仍拒绝。
  固定拒绝根还包括 `.data`、`.git`、`.next`、`.next-e2e`、`.pnpm-store`、`backups`、
  `coverage`、`node_modules`、`out`、`playwright-report`、`test-results`、`tmp`，还拒绝
  `.release-input-manifest.json`、`.build-complete`、`.deploy-ready` 和所有 symlink/submodule/
  非普通 Git entry。通过后才创建 `diesel-release-input-v2`、导出完整 commit 并对 export 本地重验。
  工作区字节、未跟踪文件和 `.git` 不属于 payload；固定 root-name admission 不是数据库 dump、
  报告、附件或用户内容的通用分类器，因此这些内容仍不得被纳入 release commit。本地
  archive/digest 只是输入准备，不代表授权。
- 授权与远端顺序：本地 export 通过后，脚本紧邻首次 SSH 之前才从同一 commit 单独导出
  自包含 authorization bundle 及 Zod MIT 许可，执行它并完成 ADR-215 的 blob、启动环境、
  1–65,536 字节 stdout 和 strict output 闭包校验。授权成功前绝不执行 SSH、rsync、
  远端 `mkdir` 或其他 host mutation。授权后在固定主机上只核对 `/opt/diesel`、
  `/opt/diesel/releases` 的类型、canonical path、owner 和 mode，并要求目标 SHA candidate 对
  `-e` / `-L` 都缺席；shared/runtime 敏感路径由后续 runtime/activation 脚本在使用前验证，
  不属于 staging receipt 的证明范围。
  authorization bundle 还按 command/scope 分离子进程环境：repository-scope Git 不接收
  GitHub token、代理/TLS 或 SSH agent，只得到无凭据的最小环境；`gh` 和 isolated remote
  readback 才分别得到所需输入。fresh `ls-remote` 在 repository 外以核对后的 canonical URL
  和固定 strict SSH command 执行，不能由 local `.git/config` 的 remote/upload-pack/url rewrite
  改变网络目标。
  两段 SSH 命令均在服务端通过 `/usr/bin/env -i`、固定 PATH、
  `/bin/bash --noprofile --norc` 与绝对 Linux 工具执行；这个边界位于 sshd 已启动 root login shell
  之后。preflight 在任何 candidate mutation 前要求 `/opt`、固定 Node 根、`bin` 父目录及 Node
  二进制 canonical、`root:root` 0755，且 `node --version` 精确为 `v22.22.3`。candidate 只能用不带 `-p` 的
  `mkdir` 原子占位一次，空目录固定为 `root:diesel` 0750；preflight 创建前后绑定
  `/opt/diesel`、`/opt/diesel/releases`，并把两组 parent 与 candidate 共三组 device/inode 交给
  postcheck 在 verifier 前后重验。传输只使用
  `rsync -a --no-owner --no-group --no-perms --timeout=60`；固定 remote path 先设 `umask 022`，
  再以 clean env 执行绝对 `/usr/bin/rsync`。本地还直接计算 committed manifest helper 的 SHA-256
  和大小；远端执行前后都要求其 canonical、`root:root` 0644、`nlink=1`、大小/hash 一致。随后
  复查 candidate metadata、拒绝 `.next` / `node_modules` / build markers，并要求该 helper 返回的
  digest 等于本地 `inputDigest`。
- 远端资源边界：committed bounded runner 在任何 workload 前要求 Unix 主机精确支持
  `/bin/ps -axo pid=,pgid=`，以 detached capability leader 和同组 inspector 两个 sentinel 自检
  parser、1 MiB 输出界限与 5 秒 inventory deadline；stage 在首次 SSH 前显式执行同一无副作用
  检查。每个 preflight、rsync、postcheck workload 都在新的 detached guardian 组内运行，其
  deadline 分别为 60、900、300 秒；这些时间不包含最多 10 秒 capability probe、TERM 后 5 秒
  kill grace 和最多 5 秒 post-seal proof。guardian 是活着的 PGID identity anchor，只有它能发送
  负 PGID 的非零信号；outer 在 guardian 死后仅以 signal 0 证明 `ESRCH`，因此 PGID 复用只能造成
  保守失败而不能误杀复用组。workload close 后 guardian 用同一 parser 检测残留，收到 outer seal
  后恰好一次向包含自身的组发送 SIGKILL。只有 guardian 的 SIGKILL close、stdio close、原 PGID
  缺席以及 token-bound、单链接 `0600` 的 `bounded-command-completion-v2` receipt 全部闭合，
  才传播退出状态。124/125 只表示已经收口的 deadline/输出上限；group signal 拒绝、inventory/
  sentinel 错误、guardian crash、同组残留、receipt 缺失或其他证明异常一律为 126。stage 逐次
  验证 receipt 的 canonical 内容、inode/mode/link count、token 与实际退出码；缺失或不可信时固定
  bounded status 为 126 并保留本地 staging 根，其他阶段非零仍统一返回 70 且不泄露 capture。
  capability 窗口收到的首个 HUP/INT/TERM 会排队，guardian 就绪后按相同 seal 协议收口；stage
  信号路径若尚未验证 receipt，也保守保留本地取证状态。对应 stdout/stderr 上限依次为
  512/8192、65536/65536、128/8192 字节。SSH connect/keepalive 与 rsync 60 秒 I/O timeout 是更早
  的网络失败条件，不能替代这些执行 deadline。
- 成功与失败语义：只有上述闭包全部通过才在 stdout 输出一行 strict
  `diesel-release-stage-v1` JSON，精确包含 `format`、`commit`、`inputDigest`、`target`、
  `releaseDir` 和已校验的 `authorization`；进度/错误不混入 success receipt。receipt 是本次
  staging 的 point-in-time readback，不是签名、attestation 或可跨时间复用的授权，也不证明
  candidate 已 built、ready、activated 或 published。bootstrap 与 stage 的本地临时根都按
  owner/mode/canonical device/inode 在所有出口精确清理，outer cleanup 完成前不转发 receipt；
  远端目录一旦创建，后续任意失败都保留该不可复用 candidate 供取证，不自动
  远程删除、覆盖或以同一 SHA 重试。
- 理由：Markdown 内联的长段发布 Shell 无法独立做 Bash 语法、fault injection、顺序与输出
  合同测试；直接调用 worktree helper 还会重新打开 ADR-215 已关闭的 hidden-index-flag
  自证窗口。先做无副作用的本地 archive 闭合、再把授权紧贴首次远端 mutation，可以
  在不让未授权进程触及主机的前提下，缩短 authorization readback 到远端占位的时间窗。
- 边界：该脚本不构建、不读生产密钥、不迁移数据库、不链接 runtime env、不切换
  `current` / Nginx / PM2，不发布治理数据，也不激活或回滚 release。manifest 不是签名、
  SBOM 或可复现构建证据；三组 device/inode readback 只检测阶段间漂移，不是在 rsync 期间持有
  目录的 filesystem capability。SSH host key/credential、工作站 Git/Node/tar/ssh/rsync 二进制、
  远端 root 与基础 OS 工具仍是显式信任边界。生产 Node 二进制供应链 SHA 和 host-side
  `ForceCommand` 后置，当前 clean-env/readback 不宣称替代它们。便携式 PGID 监督不覆盖主动
  `setsid` 逃离原进程组的后代，也无法处理 stage 入口自身收到的 SIGKILL；inventory 是瞬时进程表
  观测而不是 cgroup/pidfd capability，但 guardian 的最终 self-SIGKILL 与 outer `ESRCH` 仍绑定原组
  收口。相同权限的对抗性进程、逃逸 session 与内核/运行时供应链不在 receipt 的证明范围内。
- 验证方式：deployment-script 合同要求 entry 可执行并通过 `bash -n`，且把 preflight/postcheck
  两个 heredoc body 独立抽取后再次交给 Bash parser，避免外层 heredoc 只被当作数据而掩盖远端
  语法错误。静态合同锁定 clean remote argv、绝对工具、三层 identity、Node/helper 校验与执行顺序；
  committed bounded runner 的真实子进程测试覆盖显式 capability receipt、stdin/EOF、普通非零、
  timeout、外部 HUP/INT/TERM、guardian spawn 前 pending TERM、TERM→KILL、stdout/stderr 分别超限、
  guardian crash/signal denial、receipt capability 隔离，以及关闭或继承 stdio 的同组后代；测试
  preload 只替换 exact `/bin/ps` inventory，因为当前受限测试 sandbox 禁止真实进程表读取，且
  guardian 在启动 workload 前移除 `NODE_OPTIONS`。该替换是确定性 parser/协议测试，不冒充产品
  capability 观察。staging fixture 另验证 receipt 缺失时保留本地状态。隔离 Git fixture 与 fake
  authorization/SSH/rsync 精确锁定两次 SSH、rsync 及其 `-e`
  transport 的完整 argv，并在去除受限格式的 Darwin 运行时注入键后严格核对子进程环境 allowlist；它只验证
  malformed/dirty/wrong SHA、敏感路径、任意 hidden index flag、关键 blob 漂移、manifest 创建/复验、
  授权空输出/超限/畸形、七字段 identity 输出的精确单行/字节上限、各阶段非零退出、rsync/digest
  mismatch、一次性 receipt、startup injection 清理与本地精确 cleanup。fake transport 不执行远端
  Linux heredoc，因此不作为预存/symlink candidate、真实目录 identity 漂移、Node metadata/version、
  manifest helper identity 或远端 candidate 保留的动态故障注入证据；这些仍依赖静态合同以及已明确
  受信的生产 root/基础 OS 边界。runbook 静态测试还必须反向拒绝内联 authorization/SSH/rsync
  实现或直接 worktree 调用。

### ADR-228：live eval v11 必须保存可重算的模型性能与缓存观测

- 状态：Accepted；不改变 18 条 case、评分门槛、工具路径、数据库 schema 或 provider 请求参数
- 日期：2026-09-02
- 决策：suite 升级为 `sales-chat-live-v11`。生产 `streamSalesChat()` 已对每个 completed step
  生成脱敏的 `NormalizedModelStepObservation`；live runner 不再只提取基础 token ledger 后丢弃
  其余字段，而是逐例保存 normalized steps、由这些 step 重建的 aggregate、provider attempt
  coverage 和 model-performance completeness。step 只包含基础/cache token 的 `reported/value`、
  cache status，以及 provider response、完整 step、模型首个输出三类毫秒值；不包含 prompt、回答、
  tool payload、raw usage、provider endpoint、价格或私有费率。基础 input/output/total 必须与既有
  token ledger 逐项相等，retry、abort 或错误路径保留已知数值下界但固定为 incomplete，cache hit
  rate 同时置空。
- 原子语义门：v11 将 step 与 aggregate metric schema 分开；step 拒绝
  `reported=false,value!=null`，从保留的基础 token 重算 `tokenUsageComplete`，并检查 cache
  status 与 cache-read/write/no-cache 覆盖、边界及分区算术兼容。aggregate 仍可保留
  `reported=false` 的已知下界，因此不会丢失部分观测。completed call、loop step、token ledger 与
  observability row 必须一一对齐并且最多 5 步；只有 `EVAL_CASE_ERROR` 可多一次未完成 attempt。
- 汇总：报告顶层只从逐例行计算 case latency、三类模型性能和 cache hit rate 的 nearest-rank
  p50/p95/max 与 sample count，并记录 attempt/performance complete/incomplete case 数和
  `reported/partial/unavailable/inconsistent` cache 状态计数。初始化失败保存同一严格结构的空摘要。
  `portfolio:verify` 从 step 重建逐例 aggregate，再从逐例结果重建顶层摘要；latest 仍须与对应
  append-only/no-overwrite 应用层归档逐字节一致。所有现代 v3–v11 归档也必须通过各自版本的
  strict schema；两份早于版本化 schema 的现代 v2 文件只允许精确文件名与全文 SHA-256。
  历史报告绝不回填当时没有观察的性能或缓存字段。
- 边界：`modelTimeToFirstOutputMs` 可以由 reasoning 或 tool call 触发，不是用户可见正文 TTFT；模型
  正文仍缓冲到证据验证结束。某个合法数值在部分 step 中缺失时，聚合可保留已知下界但
  `reported=false`；sample count 表示存在数值的 case 数，不冒充完整覆盖。v11 不新增
  `prompt_cache_key`、`cache_control`、TTL 或其他供应商私有参数，也不设置缺少历史基线的漂亮延迟/
  cache 命中门槛。当前本地 latest 是 provider-disabled 的初始化失败，只证明 v11
  schema、归档和 verifier 路径，不构成性能、缓存命中、成本或模型质量证据。
- 理由：生产日志已有 step 级性能/cache 观测，但旧 live report 只保存 case wall latency 与基础
  token，无法区分 provider 响应、工具循环和最终缓冲，也无法判断 cache 字段是显式 0、缺失还是
  不一致。把既有脱敏观测接入版本化报告可形成离线可复核闭环，而无需进行新的外部调用或把未验证
  provider 能力写进请求。
- 验证方式：纯函数测试覆盖多步、retry、缺失/非法性能、四类 cache 状态、空集合与 nearest-rank；
  版本化 schema 测试要求 v11 字段存在且 v10 不接受回填字段，拒绝 aggregate、ledger 或 summary
  漂移，并用反向构造拒绝自相矛盾的 atomic metric/cache status 及超出 5 步的数量关系；
  synthetic 18-case verifier 从逐例结果重算完整摘要，非latest v10 注入 raw 字段与冻结 v2 全文
  漂移都必须失败。模型名和最终 model ID 共用 strict schema，完整报告在持久化前再解析一次。
  provider-disabled bootstrap 运行仍必须
  保存真实失败并以非零返回；有明确授权时才运行真实 provider suite。

### ADR-229：管理 Dashboard 的读取范围必须绑定认证 principal

- 状态：Accepted
- 日期：2026-09-02
- 决策：`/api/admin/dashboard` 将认证后的 `AdminPrincipal` 原样传入 service、独立 read
  repository 与出网 admission。Editor 仅能查询本人未归档 Draft/Reviewed 与本人三状态聚合，且
  不执行全局 audit 查询；其 published baseline publisher 固定为 `null`。Reviewer/Admin 保留全局
  活动队列、计数与最近 30 条 audit。活动队列最多 100 条且不含 Published；三状态计数独立聚合。
  每个活动 identity 的 baseline 用 PostgreSQL `DISTINCT ON` 只取最高 published version。
- 合同：Dashboard envelope 固定为 `status`、`workflowCounts`、`drafts`、`auditLogs`。当前和 baseline
  payload 按 entity type 复用现有 8 个 strict payload schema，并验证 `entityKey` 与 payload 主键；
  draft/audit 数量、状态、action、email、版本和字符串均有上限。服务端 admission 以及客户端
  principal-scope 防线都拒绝 Editor audit、他人 draft 或非空 baseline publisher。
- 理由：仅靠客户端隐藏 audit 或操作按钮仍会把其他操作者身份和治理 payload 发送到浏览器；从
  一个混合状态的 100 行窗口重算卡片也会让 Published 历史挤掉待处理修订并产生错误总数。把角色
  约束下推到 SQL、再由 service 与 wire admission 复核，才使最小权限和失败关闭成为可测试合同。
- 后果：Editor 看不到全局变更时间线或发布人身份，只看到本人队列与计数；Reviewer 不能操作本人
  创建的修订，Admin 本人修订会显示紧急覆盖及审计提示。当前按“不改 schema”约束不新增
  `created_by` index；规模或查询计划出现证据后再单独迁移，不静默修改数据库。
- 验证方式：函数测试证明 Editor 不调用 audit repository、scope 漂移和 Published queue row 均失败；
  PGlite 集成测试覆盖 101 条活动修订、他人/归档行、精确计数、100 条窗口、100 条更新的 Published
  历史不能挤掉活动项，以及多版 baseline 只取最高版本；route/schema 反向测试覆盖 role 泄露、严格
  payload 和边界；Playwright 覆盖 Editor 隔离/截断、Reviewer 本人禁用、Admin 紧急覆盖和身份切换。

### ADR-230：公开 Nginx 必须同时封闭特权根路径与子树

- 状态：Accepted
- 日期：2026-09-02
- 决策：主域名配置对 `/admin`、`/api/admin`、`/dev`、`/api/dev` 使用精确
  `location =` 返回 404，并继续对对应的带尾斜杠子树使用 `location ^~` 返回 404。合同测试
  表驱动枚举两组路径，并要求所有拒绝 block 出现在公开 `location /` 之前。
- 理由：Nginx 的 `^~ /api/admin/`、`^~ /dev/` 与 `^~ /api/dev/` 不匹配无尾斜杠根请求；
  后者会落入公开 catch-all。当前没有对应应用根路由，因此这不是已发生的数据泄漏，但未来新增
  根 Route Handler 或重定向时不能依赖人工记得同步代理配置。
- 后果：公开主域名在反向代理前统一隐藏四个特权命名空间；受控环境中的应用级认证、开发环境
  404 和 Route Handler 授权仍是独立防线。没有新增公开能力、依赖或数据库变化。
- 验证方式：`tests/deployment-config.test.ts` 同时锁定四个 exact roots、四个 nested prefixes、
  固定 404 body 和相对 catch-all 的顺序；发布前仍须由 `nginx -t` 与目标主机配置读回确认。

### ADR-231：post-build-ready host activation 必须调用目标 release 的版本化入口

- 状态：Accepted
- 日期：2026-09-02
- 决策：生产 runbook 在同一个父级 root release shell 中，严格按
  `prepare-release-runtime.sh` → `activate-host-release.sh` → governance `publish` →
  `finalize-committed` 的顺序执行。Host activation 只能调用目标 release 内固定路径
  `/opt/diesel/releases/<40-sha>/scripts/deploy/activate-host-release.sh <40-sha>`；公开 CLI 只接受
  同一个 40 位小写 commit SHA。脚本内部固定 `/opt/diesel`、`/etc/nginx/sites-available`、
  Node 22 binary、`/proc`、`/root/.pm2`、PM2 executable 与 `pm2-root.service` fragment，runbook
  不再内联复制 Nginx、切换 `current` 或重建/持久化 PM2 的实现。
- 调用边界：父级 shell 必须在调用前已经以固定 FD 8 持有 release lifecycle lock、通过
  `--begin-activation` 建立并复验 durable `HOST_ACTIVATION_PENDING`，并安装
  `ERR/INT/TERM/HUP/EXIT` rollback trap。Activation 只继承并反复验证该 FD capability 与 PENDING；
  它不自行获取或释放父级 lock，不安装取代父级的 rollback trap，不发布治理数据，也不创建、
  删除、重命名或迁移 host/governance ledger。脚本任一阶段非零退出都回到父级 trap，由父级根据
  durable governance phase 执行 `--abort-if-uncommitted` 或 maintenance-locked recovery；脚本成功
  也只表示 host 已激活，不能设置 `release_committed` 或跳过 governance/finalize。
- 理由：Markdown 中复制 Nginx/current/PM2 的长实现会与已经接受 fault-injection、固定路径和
  durable PM2 验证的版本化脚本漂移，也无法让旧 release 使用其自身当时经过审查的激活合同。
  把 post-build-ready mutation 收口到目标 release 自带入口，同时保留外层 FD、PENDING、trap 和
  跨域状态机，可让可执行测试覆盖的代码成为唯一实现而不改变跨数据库/主机 commit point。
- 后果：release 必须包含可执行且受 immutable artifact manifest 保护的 activation 脚本；失败时
  可能已经修改部分 host state，因此操作者不得绕过父级 trap 手工继续治理发布。当前 Activation
  实现和受支持调用合同不执行 ledger transition，测试锁定零调用；唯一不可逆提交仍由 governance marker 与随后
  `finalize-committed` 的 host terminal transition 共同完成。
- 验证方式：deployment script 测试继续对 `activate-host-release.sh` 执行 `bash -n`、固定 CLI/路径、
  FD 8/PENDING 重验、Nginx/current/PM2 顺序、故障注入和无 ledger transition 合同；runbook 静态
  测试应要求版本化调用出现在 prepare 之后、governance publish/finalize 之前，并反向拒绝重新出现
  的内联 Nginx/current/PM2 activation 块。

### ADR-232：host activation 必须清洁启动并原子收敛临时主机对象

- 状态：Accepted；当前仅在本地工作树实现，尚未部署或在目标 VPS 演练
- 日期：2026-09-02
- 决策：父级 root release shell 不再直接启动 activation Bash，而是在前台通过固定
  `/usr/bin/env -i` 与 `/bin/bash --noprofile --norc` 创建 clean child；allowlist 只有固定
  `HOME`、locale、`PATH` 与 `DIESEL_RELEASE_LIFECYCLE_LOCK_FD=8`。环境清理不关闭已经打开的
  descriptor，因此 child 继承与父级相同、已经持锁的 FD 8/OFD，并继续由版本化入口复验其路径与
  flock；`BASH_ENV`、`ENV`、exported functions、shell/Node/dynamic-loader hook、数据库/AI/PM2
  秘密及测试 seam 都不能进入 child。调用必须保持前台，不能改成 `exec`、管道、后台任务或关闭
  FD 8；该边界不追溯净化已经启动的外层 root shell。
- Nginx 安装：两份目标配置先在 `/etc/nginx/sites-available` 同一 root-owned 目录形成固定的
  staged 普通文件，逐项验证 canonical path、`root:root` 0644、单硬链接和与 release source
  字节一致，再以临时顶层配置离线执行成对 `nginx -t`。首次 live rename 紧前重新证明 FD 8、
  `PENDING:none`、sites 目录、两份 live 文件的单链接身份及其与 ledger backup 的字节一致；随后
  分别用同目录 `mv -Tf` 原子替换 live 目录项，完成 post-check、正常 `nginx -t` 与文件/目录
  fsync。这样不会以 `cp` 原地截断 raced hardlink 或跟随 destination symlink；两次 rename 仍不是
  跨文件事务，第二次前后的失败继续交给父级 rollback 收敛。
- Crash residue：`current.next` 的 EXIT/signal cleanup 在创建软链接前已经生效。可捕获中断只删除
  raw target、resolved target、owner/group、link count 与长度都精确绑定本 release 的 symlink；
  SIGKILL 或掉电留下同类对象时，重试也只有在同一 release 的 `PENDING:none`、
  `current=previous` 与 Nginx rollback basis 全部重验后才删除，并 fsync deploy root。父级 rollback
  也会在 `PENDING:none` 或 maintenance-locked `PENDING:HOST_ROLLBACK_REQUIRED` 下，把同一对象的
  删除/fsync 放在首次 host restore mutation 前，随后重验 FD、ledger 与 current；`--check` 只分类
  不删除，新的 begin 要求对象不存在。不同目标、相对/别名链接、异常 metadata、非 symlink 或不闭合
  ledger 一律保留现场并失败关闭；Nginx staged 临时文件采用相同的严格类型/身份清理和目录
  durability 证明。
- 后果：activation 仍不创建、删除、重命名或迁移 host/governance ledger，不改变 ADR-223/224 的
  跨数据库/主机 commit point；成功后仍必须完成 governance `publish` 与
  `finalize-committed`，失败仍由父级 trap 收敛。本决策不修改数据库 schema、不增加依赖或公开
  写入能力，也不能作为生产部署、真实 Nginx/PM2 或断电恢复演练证据。
- 验证方式：静态合同锁定 clean launcher 的绝对 argv、环境 allowlist、前台 FD 8 继承及其在
  prepare/governance 之间的位置；canary 同时注入 `BASH_ENV` 与 exported functions，要求 clean
  child 不执行 marker、不继承秘密且仍能读取/重入 FD 8，并以 dirty direct Bash 作为反向控制。
  activation fixture 覆盖 live hardlink/symlink、staged pair 离线失败、每个 rename cutoff、严格
  post-check、可捕获信号 cleanup、精确同 release crash residue 重试、异 release/异常对象拒绝及
  删除后的目录 fsync；rollback fixture 另证明 check 保留、abort 删除/fsync 后才恢复并进入
  ROLLED_BACK。既有测试继续证明失败不迁移 ledger、PM2/Nginx 长期进程不继承 FD 8。

### ADR-233：normal-path 发布尾段必须由版本化 controller 严格仲裁

- 状态：Accepted；当前仅在本地工作树实现，尚未部署或在目标 VPS 演练
- 日期：2026-09-02
- 决策：新增目标 release 自带的 `scripts/deploy/release-publication-controller.sh`，在父级已经
  建立并 fsync rollback basis、持有固定 FD 8、进入 `PENDING:none`、安装 rollback traps 且完成
  人工环境编辑/数据库身份持久化后，接管 normal path 的
  `prepare-release-runtime.sh` → clean `activate-host-release.sh` → maintenance-locked `publish` →
  maintenance-locked `finalize-committed` 固定顺序。父级仍拥有 protocol 初始化、`--begin-activation`、
  FD/OFD、rollback/recovery 与 trap disarm；controller 不关闭或重开 FD 8，不调用 rollback/
  `recover-required`，不写 marker，也不调用 `host_activation_ledger_transition`。
- 状态与退出码：controller 在 publish 返回后必须复用 V1 ledger parser，不能按 marker 文件名裸判。
  参数/profile 错误返回 64，非 root 返回 77，publish 前其他普通操作失败统一返回 70，信号保留
  129/130/137/143，由父级恢复；只有严格读回 `COMMITTED:PUBLISH_FINALIZED` 才可能返回 0。
  publish 已调用后若出现合法 committed/finalized 状态，则普通非 signal-shaped child 非零仍继续幂等
  finalize；signal-shaped child 加 commit-shaped state 直接返回 75，避免在已中断会话中再开启锁会话。
  若 controller 进入时已经 terminal，fresh finalize 还必须自身返回 0，不能让旧 tombstone 掩盖本轮
  current/public/lock 验收失败；只有本轮 PENDING→COMMITTED 的 durable fact 可覆盖迁移后的尾部非零。
  finalize 未收敛，或 publish 后因 symlink、冲突、payload/hash/metadata
  漂移而无法证明 commit 边界时，返回专用 75。75 不是成功或 commit 声明，只表示自动 rollback
  已不安全；父级解除 rollback trap、释放自己的 FD 并保留现场，等待 forward repair / 人工严格核查。
- 信号边界：controller 必须前台运行。进入该 child 前，父级的 INT/TERM/HUP trap 从“立即 rollback”
  暂时改为仅记录信号；CLI 顶层、production preflight subshell 与 reconcile subshell 也各自安装
  record-only supervisor trap，确保收到同一进程组信号后外层不会先退出，而会等当前 child 结束并
  严格分类 ledger。
  pre-commit 信号仍进入父级恢复，commit-shaped 或不可分类状态则返回 75；若 finalize 已形成严格终态，
  终态读回优先于非零 child 状态。这样缩小 controller 返回与父级 disarm 之间的窗口，但不宣称
  SIGKILL 可被捕获；不可捕获中断仍由 durable marker 与独立 recovery/finalize 手册收敛。
- 理由：旧 runbook 同时复制四段可执行编排，并用 `[ -e PUBLISH_* ]` 仲裁不可逆边界；marker symlink、
  冲突、内容漂移或 wrapper 在 commit 后非零时，文件存在性既不能证明合法提交，也不能证明 rollback
  安全。把 normal path 收口到受 artifact manifest 保护、可故障注入测试的版本化入口，并复用共享
  strict parser，可让父级只处理明确的“安全回滚 / 必须保留 / 已严格终态”三态。
- 后果：publish 与 finalize 仍使用两个独立 maintenance session，中间的 advisory-lock 释放窗口没有
  被消除；唯一跨域 commit point 和最终 host transition 仍由 ADR-223/224 的治理状态机持有。受控
  `PNPM_REGISTRY` 只进入 prepare child，数据库/AI/PM2/Bash/Node/dynamic-loader 环境仍不跨 clean
  边界。fresh/normalized 输入由 controller 按目录/可执行 0755/0750、普通文件 0644/0640 的
  `root:root`/`root:diesel` 精确二态与文件单链接校验；preparer 对 ledger 做同一入口检查并在规范化
  后复验关键执行输入。root bootstrap 使用 Bash `EUID`、绝对宿主 inspector、固定 Node/local 目录
  proof 和 system-only root PATH；application PATH 只进入非特权 child 或作为 PM2/systemd 期望状态
  校验，不参与特权命令查找。governance wrapper 与状态机均由 controller 以目标 release 绝对路径
  启动，不能被状态机的 exact-entry guard 当作非生产副本拒绝。严格 ledger 分类前的 bootstrap
  失败保守返回 75；已知 committed entry 后任意非零 reconciler 结果也不得泄漏成 rollback-capable
  状态。本决策不修改数据库 schema、依赖或公开写入能力，也不构成生产发布证据。
- 验证方式：controller 单测覆盖阶段顺序、每个 pre-commit failure、publish 零退出无 commit、publish
  非零但已 commit、terminal-entry fresh finalize 失败、strict parse 失败、完整 production 状态路由，
  并以 FIFO 握手后的 detached process group 实际发送 SIGTERM，分别覆盖 main/wrapper、pre-commit
  143、post-commit 75、finalize 未收敛 75 和 fresh terminal 0，而不只伪造 child 退出码；prepare
  fixture 用受控 metadata seam 模拟 staged→normalized 顺序后才允许启动 builder，不声称本地非 root
  进程真实执行 root chown。静态合同
  禁止 controller 直接迁移 ledger、恢复 snapshot 或调用 rollback。runbook 测试要求 normal path 只有
  一个 clean controller launcher，0/75/其他状态分别 disarm、preserve、abort；该 Markdown parent
  仍是静态分支/顺序证明，不计入上述动态 signal 覆盖，并保留独立
  `recover-required` 与 forward-only `finalize-committed` 操作手册。

### ADR-234：生产特权发布入口绑定 system-only PATH、canonical runtime 与目标 release

- 状态：Accepted；当前仅在本地工作树实现，尚未部署或在目标 VPS 演练
- 日期：2026-09-02
- 决策：controller、prepare、activation、governance 与 rollback 的生产 root 进程只用
  `/usr/sbin:/usr/bin:/sbin:/bin` 查找宿主命令。Node 固定为
  `/opt/node-v22.22.3-linux-x64/bin/node`；root PM2 调用固定为该 Node 加 canonical
  `/opt/node-v22.22.3-linux-x64/lib/node_modules/pm2/bin/pm2`，launcher symlink 只作为需精确验证的
  安装事实。完整 application PATH 只进入非特权 builder/runtime/verifier child，或作为进程定义的
  期望状态校验，不进入特权命令解析。
- 入口绑定：governance 与 rollback direct CLI 只接受完整小写 40 位 commit SHA，并在 source ledger
  前要求 `BASH_SOURCE[0]` 等于参数指定的 `/opt/diesel/releases/<sha>/scripts/deploy/...` 绝对入口。
  controller 传给 maintenance wrapper 的 TypeScript 入口和 governance child 也使用同一目标 release
  的绝对路径；worktree、相对路径、`current` 别名或其他 release 均失败关闭。rollback 还在 source
  前验证 `/opt/diesel/releases/<sha>/scripts/deploy` 目录链和 entry/ledger 的 canonical、非 symlink、
  staged `root:root:755` 或 normalized `root:diesel:750` 精确 metadata，并拒绝 executable hardlink。
  rollback 的受支持 10 参数生产状态机与 production-main 函数入口在 sourced 调用时以 64 拒绝；
  13 参数 seam 仅保留给隔离 fixture，并同样拒绝字面量、重复/尾随斜杠形式，以及由固定
  `/usr/bin/realpath -e` 解析到 `/opt/diesel` 的既存 alias。这只是误用保护：Bash 内部 helper 并不
  私有，不能据此宣称 root/source caller 被能力隔离。
- 理由：清空环境并不等于命令可信。若 root PATH 包含本地 Node/npm bin，或 maintenance wrapper
  从工作目录用相对路径启动状态机，同名 executable、错误 release 或 exact-entry guard 失配都可能
  在账本解析前改变执行事实。rollback 先 source 再验证 ledger metadata 还会让后置检查失去意义。
- 边界：sourceable seam、fake command 与静态 Markdown 只证明控制流、失败关闭和命令构造，不证明
  目标 VPS 上的 root owner、Node/PM2 bytes、systemd loaded state 或 reboot 行为。root 仍是主机信任
  边界；固定路径和 metadata 不是签名或供应链 attestation。生产证据必须来自目标 release 绑定的
  database/API/host/ledger readback。本决策不修改数据库 schema、依赖或公开能力。
- 验证方式：表驱动测试覆盖 rollback 的 40-SHA direct boundary、staged/normalized source metadata、
  hardlink/可写漂移、sourced production main/state-machine 拒绝、system-only root PATH 在 ledger
  source 前建立，以及错误 Node/PM2/profile 在 host access 前失败；controller 静态合同锁定目标
  release 的绝对 maintenance wrapper 与 governance child。Linux fixture 继续覆盖 host mutation 顺序，
  但不计作目标 VPS 演练。

### ADR-235：所有特权 release CLI 在首次 source 前闭合版本化代码信任

- 状态：Accepted；当前仅在本地工作树实现，尚未部署或在目标 VPS 演练
- 日期：2026-09-02
- 决策：ADR-234 的入口绑定扩展到 controller、prepare、activation、governance 与 rollback 五个
  生产 direct CLI。每个入口只接受完整小写 40 位 commit SHA，并在首次 source 目标 release 中的
  ledger/helper 前绑定自身对应的 `/opt/diesel/releases/<sha>/scripts/deploy/...` 绝对入口。bootstrap
  validator 必须自包含，不能先加载将要证明的 sibling；它使用绝对 host inspector 验证 `/opt`、
  deploy/release 目录链、自身和所有即将加载的 ledger/helper 为 canonical、非 symlink、root-owned、
  不可写，且可执行文件只有一个硬链接。controller 与 prepare 接受 rsync 后的 staged
  `root:root:755` 或 retry 的 normalized `root:diesel:750`；受支持的 production direct activation 位于
  prepare 之后，只接受 normalized release，并在合法 source rollback 前同时验证 rollback 及 rollback
  将加载的 ledger。验证完成后才把 root PATH 固定为 `/usr/sbin:/usr/bin:/sbin:/bin` 并执行 source。
- 失败语义：controller 在 ledger 尚未执行、无法分类跨数据库/主机 commit 边界时返回 75，要求保留
  现场；observed entry 不是目标 release 时仍是明确的 pre-publication 70。prepare 与 activation 的
  metadata、路径或 source 拒绝统一返回 70；参数形状错误统一返回 64。controller 的后续 executable
  inventory 也包含 rollback helper；当前 controller 实现和受支持调用合同不执行 rollback、marker
  迁移或 FD 8 close，测试与静态合同锁定这些零调用。
- 生产与测试边界：production direct CLI 将 deploy root 固定为字面量 `/opt/diesel`，不接受环境变量、
  CLI 参数或测试 seam 覆盖。source 后显式调用的 controller/prepare/activation 三个
  bootstrap，以及 controller/prepare/activation/governance/rollback 五个 primary seam，都在选择字面量
  production root 时以 64 拒绝；这些 guard 和 controller 的 `run_prepare`、`run_activate`、
  `run_governance_mode` 三个实际 child runner 还会拒绝重复/尾随斜杠形式及由固定
  `/usr/bin/realpath -e` 解析到 `/opt/diesel` 的既存 alias。sourceable seam 只供隔离 fixture 使用；这些
  guard 证明控制流和返回码、减少误用，但不会把显式 bootstrap 调用之前的 sourced load 变成
  pre-source trust，也不证明目标 VPS 的真实 owner/mode、文件字节、签名、SBOM 或可复现构建。脚本
  最初作为库被 source 时会传播相邻 sibling 的原始非零；source 后显式调用 bootstrap 时，controller
  将 dependency source 失败映射为 75，prepare/activation 映射为 70。Bash helper/变量没有私有性，
  可被 root/source caller 重定义或直接调用，因此不是 capability boundary；生产只支持 parent guard
  后的 clean-env direct CLI。
- entry 信任链：脚本内 bootstrap 只能在 entry 已经被 Bash 打开后保护首次 sibling source，不能作为
  自身 pre-exec attestation。normal path 因此在创建本次 state 目录和执行首个目标 release shell 前，
  由不加载 release 代码的 parent guard 重验目录链、六个 executable 与 maintenance wrapper；此前的
  commit input manifest/传输后 digest 证明内容来源，root-owned 不可写 profile 阻止既定模型中的
  非 root 间隙替换。该 guard 与后续 source 仍按 pathname 重新打开，不是 `O_NOFOLLOW + fstat + 同一
  FD` 执行；并发 root 修改、遗留可写 FD 和底层文件系统失信仍属于未消除的主机边界。
- 理由：在 source 之后才检查 ledger/helper 的路径和 metadata 已经太晚；目标文件的顶层代码可先覆盖
  校验函数、改变进程状态或伪造分类结果。版本参数与 clean environment 也不能替代 sibling 执行前的
  路径、类型和不可写 metadata 证明；entry 自身则必须由外层 staging/parent 信任链承担。
- 后果：本决策不改变 ADR-223/224 的 commit point、ledger protocol、数据库 schema、依赖或公开写入
  能力；root 与操作系统仍是主机信任边界，metadata 不是内容签名。controller 的不确定失败更保守地
  保留现场，可能需要人工修复文件权限或工件后重试，而不能自动回滚。
- 验证方式：表驱动测试覆盖五个入口的允许/拒绝 metadata profile、三个 sourced bootstrap 的
  fail-before-inspector、五个 primary seam 与 controller 三个 child runner 的 production-root 拒绝，
  并锁定各 root classifier 对重复/尾随斜杠的分类。poison-marker fixture 在 entry、rollback helper 或 ledger
  验证失败时要求 marker 不得执行，并在全部验证成功时证明 source 只发生于最后一次依赖检查之后。
  controller 另覆盖 rollback inventory 漂移在 `PENDING:none` 时返回 70、在
  `PENDING:PUBLISH_COMMITTED` 时返回 75，且两种分支都不能启动 reconciler 或直接调用 rollback；这些
  fixture 不构成 root capability 隔离或目标主机权限证明。

### ADR-236：显式来源意图由确定性合同独占知识检索工具

- 状态：Accepted；当前仅在本地工作树实现，尚未部署或运行真实 provider live eval
- 日期：2026-09-02
- 决策：当前用户消息一旦显式要求原文、公告、出处、来源、页码、章节、依据或 citation，
  evidence contract 在销售简报、机会评分、产品适配、法规和市场分支之前建立来源需求；本轮每个
  requirement 的 `acceptedTools` 都只能是 `searchKnowledgeBase`。同一句同时出现产品、市场或法规
  措辞时，不再并行追加 `findCompatibleProducts`、`getCountryProfile`、compare、score 或 brief
  requirement。`activeTask=knowledge` 的无新意图追问继续使用最近一次知识请求中的有效检索词，
  并继承确定性上下文里的 country、scope 与 asOf；来源国家仍按当前来源 clause 优先、focused country
  回退。只含检索控制词、来源 locator、日期与 application scope 的泛化来源追问不会覆盖上一轮
  业务主题；若追问加入 NOx、Stage V 等实质主题，则以新主题为准。中英文业务词由同一 token 边界
  保留，国家代码不冒充检索主题；英文 `source(s)` / `citation(s)` 以 Unicode letter/number 边界
  识别，不能从 `resource`、`outsourced` 或 `sourceable` 子串误触发最高优先级。同一来源 span
  内由 `and` / `和` 协调的国家保留为逐国 requirement；新的推荐、比较、计算、生成、评估或核对
  动作会终止该 span，防止另一个业务 clause 的国家被误归入来源过滤。裸三字母国家代码只接受
  canonical uppercase token；受控国家全名和 alias 继续大小写不敏感，普通英文 `Can`、`are` 与
  月份 `Mar` 不再误命中 ISO3。来源 terms 还精确绑定复合型号、kW 功率、Stage/Tier、法规/版本
  编号及 page/section locator；仅修改功率或 locator 的多轮追问保留原主题并替换同类别旧值，
  ISO 日期仍由结构化 `asOf` 绑定而不冒充自由检索标识。
- 理由：system instruction 已要求来源请求只调用知识检索，但旧确定性合同会先为同一句的产品或
  市场措辞追加其他 requirement；生产 loop 因而必然向 provider 开放额外工具，既违背公开路由
  契约，也增加无关结构化事实、调用步数与 token。工具最小化必须由服务端合同强制，而不能只写在
  prompt 中。
- 边界：这项优先级把混合句解释为“本轮先取回来源”，不让知识 chunk 代替确定性 product-fit、
  市场比较或机会分计算；需要这些结论时应在后续独立请求中调用对应工具。检索结果仍必须通过
  query、metadata、有效期、scope 与 citation evidence gate；只开放知识工具不证明命中、来源真实
  或最终模型解释正确。多国来源请求可以产生多个 knowledge requirement，但不会开放第二种工具。
- 后果：不修改 live-eval case 期望、数据库 schema、依赖或公开写入能力；已有“产品+来源”流测试
  保留并改为断言产品 service 不执行，而不是删除冲突证据。本地 mock 通过也不构成 provider 质量或
  生产部署证明。
- 验证方式：表驱动测试覆盖英文市场来源、中文市场来源和英文产品适配来源，逐例要求 requirement
  只接受 `searchKnowledgeBase`、remaining tool 精确为该工具并保留预期中英文词；多轮测试验证
  混合产品来源后的 `Continue` 以及改变 country/scope/asOf 的泛化来源追问都不替换原知识主题。
  `resource`、`outsourced`、`sourceable` 反例仍分别走市场、法规和产品工具。流级 mock 锁定首次
  provider call 的唯一可见工具；中英文 CHN+BRA 来源列表证明生成两个 KB requirements、单国结果
  不放行而双国结果才放行，正反向混合产品/来源 clause 则只保留 BRA。两个既有混合产品/来源流
  用例同时证明跨 step 不执行产品 service、审计只记录知识检索结果。补充回归证明
  `DEMO-ENG-100` / `100 kW` 不接受 200 变体，Stage V、页码以及 `p.`、`page no.`、`§`、纯数字
  Model locator 均精确绑定；多轮功率/页码替换保留原型号和法规主题。`Can`、`are`、`Mar` 与小写
  ISO3 不能引入国家，而混合大小写国家全名和 `CHINA` alias 仍可解析。

### ADR-237：Required CI 汇总判定不依赖可变 shell errexit 状态

- 状态：Accepted；当前仅在本地工作树实现，首个远端新版 gate 尚未观察
- 日期：2026-09-02
- 决策：`Required CI gate` 的 9 个依赖结果逐项使用
  `test "${RESULT}" = "success" || exit 1`，每项自身决定失败，不把正确性只交给开头的
  `set -euo pipefail`。`portfolio:verify` 同时读取 `.github/workflows/ci.yml`，要求唯一 canonical
  root `jobs`、精确的 9 个依赖 job inventory、位于末尾的唯一 `required` job、固定 if/runner/timeout、
  9 个 needs 与 result binding，以及只有 allowlist 命令的单一 run block 完全匹配；任何额外 job、
  命令、重复/缺失 mapping 或条目均失败关闭。
- 理由：旧合同只计数 `test` 片段并依赖 `set -e`。在下一行加入 `set +e` 后，前 8 个失败会继续
  执行；只要最后一个结果成功，汇总 shell 就可返回 0，而原有测试仍通过。分支保护只看这一汇总
  检查，因此这是发布证据链的真实 fail-open 回归盲区。
- 边界：canonical 文本合同有意比 GitHub Actions YAML 更窄，重排或扩展 job 必须同步做显式审查；
  它不能防御有权同时篡改 workflow、verifier 与测试的贡献者，也不证明远端 workflow 或分支保护已
  更新。Action pin scanner 对非执行位置 `env.uses` / `with.uses` 的保守误报仍是独立的低优先级限制。
- 验证方式：表驱动回归拒绝 `set +e`、`|| true`、删除显式 exit、追加命令、未聚合 job、重复或缺失
  needs/env/run、重复或缺失依赖/result binding 及重复 required；当前 workflow、部署 job inventory
  与 Action/image pin 审计组成控制组。

### ADR-238：管理 mutation 只返回消费所需的 strict DTO

- 状态：Accepted；当前仅在本地工作树实现，尚未部署
- 日期：2026-09-02
- 决策：文档上传 Route 将治理服务结果投影为 `{status,draftCreated}`；文档重处理、通用草稿创建、
  草稿审核/发布、来源核验与实体归档只返回 `{status}`。不再直接 JSON 序列化完整 draft、publication、
  source 或 document summary。CSV preview/confirm 的批次 ID、逐行校验结果和创建计数均被当前 UI
  使用，继续保留，但所有管理 action 的客户端成功响应 schema 都改为 strict object。
- 理由：重复上传返回的既有文档摘要包含 `originalFilename`、`contentSha256`、创建时间、处理错误与
  下载等字段；另一个 Editor 提交相同字节即可从响应读取这些未消费详情。其他 mutation 也会把完整
  存储行送到浏览器，而界面只检查动作状态。认证、private/no-store 与 dashboard scope 不能替代响应
  最小化。
- 边界：`duplicate` 和 `draftCreated` 仍是用户完成上传流程所需的状态，不隐藏相同内容已存在这一
  业务事实；本决策不改变 service/repository 返回类型、数据库 schema、权限或事务。管理端仍未纳入
  公开中英双语范围，且这些本地改动不构成生产数据已清理或目标代理已部署的证据。
- 验证方式：Route 单测让 mock service 在 draft、文档摘要、source、publication 与归档结果中注入
  `PRIVATE_CANARY`，逐一断言 HTTP body 精确等于最小 DTO 且 marker 不可见；客户端 E2E 以带额外键
  的同身份 2xx 验证 strict schema 会卸载可写工作区。CSV 合同保留已消费字段。

### ADR-239：Live eval 在 case 内以可重算终止状态关闭后续 provider 调用

- 状态：Accepted；当前仅在本地工作树实现，尚无真实 provider 或远端 CI 观察
- 日期：2026-09-02
- 决策：`streamSalesChat()` 接受仅由 live-eval runner 使用的可选 completed-step stop hook，并与
  生产最多五步条件同时执行。每个 step 的 provider completion 与规范化 usage 已回传后，runner
  从 ledger、attemptCount 与 completedCount 重算已知用量；缺失、矛盾或 retry 覆盖缺口立即停止，
  累计运行用量达到或超过 160,000 也在下一次 provider call 前停止。case 内停止用 current v11
  专用 `EVAL_BUDGET_STOP` 表示，只能位于结果末行；保留脱敏参数、工具顺序、usage 与 observability，
  但 response disposition/anchor 不评估，case 固定失败且报告固定不完整。旧 v3-v10 schema 继续拒绝
  该错误码。v11 是尚未发布的当前本地合同，本次没有改变 JSON 字段、case 期望或阈值集合；既有
  v11 归档仍可被新 parser 严格读取。
- 一致性：runner 与 `portfolio:verify` 共用 `resolveLiveEvalTerminationReason()`。部分运行恰好达到
  上限，以及最后一例触发预算 stop 恰好达到上限，都派生为 `token_limit_exceeded`；没有触发 stop、
  自然完成全部 18 例且总量恰好 160,000 时仍是 `completed`。threshold 计算独立要求
  `terminationReason=completed`，避免完整数量或全绿逐例布尔值掩盖预算终止。
- 理由：旧 pre-case reserve 只能阻止下一案例开始。案例从剩余预算附近开始且首个 step 越界后，
  原实现仍可能继续最多四次 provider 调用；同时 exact-limit runner 与 verifier 的 `>=`/`>` 差异会
  拒绝真实报告，最后一例的确定性 evidence fallback 甚至可能让截断案例被误评分为通过。
- 边界：OpenAI-compatible usage 只在 step 完成后可见，因此当前 step 仍可能自身超过上限；本决策
  继续如实标记 `post_usage_acceptance`，不声称 provider 账单级或输入 token 的预消费硬限制。严格
  预授权仍需要获批的 provider 预算或固定模型 tokenizer/preflight。本决策不修改数据库 schema、
  依赖、公开 API 或生产聊天行为。
- 验证方式：生产流 mock 分别证明 stop=true 只有一次 provider call、stop=false 保留两步；表驱动
  单测覆盖低于、等于、超过、缺失、矛盾与 retry 缺口；runner 集成锁定 160,000 时只运行一例、
  不保存原始回答且写入专用错误；verifier 接受该自洽失败报告，并拒绝将其篡改为 `completed`。
  schema 测试还覆盖 invalid-input sentinel 与预算终止并存，且旧 v10 仍拒绝新错误码。

### ADR-240：CI 证据 producer 以执行 proof 绑定 Required gate，并在 CI 校验 HEAD workflow

- 状态：Accepted；当前仅在本地工作树实现，远端新版 gate/ruleset 尚未观察
- 日期：2026-09-02
- 决策：`quality` 中的 portfolio verifier 不再经可变 package-script alias 启动，而使用无 profile
  的固定 Bash、workspace、清空的 shell/dynamic-loader/Node 注入变量及与 `.nvmrc` 对应的 runner
  tool-cache Node 绝对路径直接执行。verifier 只有在全部检查成功后才向本 step 的
  `GITHUB_OUTPUT` 写入 `verified=true`；`quality` 暴露该 step output，最终 `Required CI gate`
  同时要求 `needs.quality.result=success` 与 proof 为 true，不能把 job/step `continue-on-error`、skip
  或 no-op 当成已验证。canonical 合同锁定 workflow preamble、完整 `quality` producer、唯一
  portfolio step、job inventory 和最终 gate。在 GitHub Actions 中，verifier 还用
  `git cat-file blob HEAD:.github/workflows/ci.yml` 读取 committed bytes，要求 workspace 逐字节一致，
  并对 HEAD 内容做合同校验；本地 dirty 验证仍读取 workspace。
- 理由：只要求名为 `Required CI gate` 的成功状态不能证明上游验证器实际运行；package alias、默认
  shell、startup preload、伪造 output、allowed failure 或前序脚本改写 workspace 都可能让表面绿色
  与真实证据检查脱钩。proof 加 committed-byte binding 将正常执行路径与汇总结果显式关联。
- 边界：同一个可修改的 workflow 不能成为自身不可篡改的启动信任根；有权只改
  `.github/workflows/ci.yml` 的贡献者仍可删除 verifier 并直接伪造 proof。仓库内合同是 drift detector，
  不是密码学 attestation。完整闭环仍需 GitHub 组织/repository ruleset 中的外部 required workflow，
  或对 workflow 路径强制的 CODEOWNERS 审批；这些远端设置当前未获新证据。固定 Node 路径还绑定
  当前 Ubuntu x64 tool-cache 布局，版本/架构升级必须同步更新，否则失败关闭。
- 验证方式：表驱动测试覆盖删除、复制、跨 job、`run:true`、伪造 proof、workflow/job env/defaults、
  job/step `continue-on-error`、step skip/shell/preload、缺失 result/proof 及额外 job；另覆盖本地不读
  Git、CI workspace/HEAD 相同、字节漂移和 HEAD 读取失败。Action/image pin audit、YAML parse、lint、
  typecheck 与 diff check 作为控制组；本地测试不构成远端 ruleset 已配置的证明。

### ADR-241：销售聊天将 provider 私有续写与单次公开流投影分层

- 状态：Accepted；当前仅在本地工作树实现，尚未运行获授权的真实 provider live eval 或部署
- 日期：2026-09-02
- 决策：不再把公开 evidence transform 放在 AI SDK `eventProcessor` 之前。原始 stream 先由 SDK
  记录为私有 `StepResult` 与下一 provider step history，保留 provider 为多步调用所需的 reasoning、
  provider metadata 和原始 tool-call ID；随后只创建一次 public transform，并通过 single-pump、
  有界 replay/broadcast hub 分发给 `fullStream`、公开 `text` 和 UI SSE。每个消费者取消只移除自身
  订阅，晚到消费者重放同一份已投影事件；hub 最多缓存 1,024 个事件，超限或源异常时所有当前与
  后续消费者得到同一固定公开错误，同时继续排空私有 SDK 流以完成 callback、审计与指标结算。
  返回包装只暴露这三条公开路径、UI response 方法，
  以及 server-only/live-eval 所需的 typed tool/result/usage/steps getters；不暴露 reasoning、response
  metadata、source/file 或 raw provider stream。UI wrapper 无论调用参数为何都强制
  `sendReasoning=false`、`sendSources=false`。
- 公开协议：text、tool 与 step ID 分别由边界生成为 `sales-chat-text-N`、`sales-chat-tool-N`、
  `sales-chat-step-N`。tool input/call/result/error/output-denied 均用显式 DTO 重建；参数来自各工具 Zod
  的 parsed input，result 必须同时匹配 incoming toolName、accepted-call ledger 与
  `aiToolResultSchema` parsed output，公开 output 只使用 `parsed.data`。provider/tool metadata、title、
  preliminary、错误原文、raw finish/abort reason 和未知未来 part 全部失败关闭。performance 只重键
  ledger 已接受调用的 timing，未知 key 丢弃；usage 删除 `raw`，内部 step metrics 仍直接使用投影前
  usage，以免缓存/token 完整性被公开最小化破坏。
- 理由：AI SDK 7.0.40 在 `experimental_transform` 之后才执行 event processing。旧位置虽然阻止
  reasoning 出现在最终流，却同时从下一次 provider prompt 删除了合法的私有 reasoning content；
  旧的 spread-plus-denylist 还会泄露 marker-free ID/未来字段，并把 Zod 已剥离的原始 output 重新发给
  浏览器。后置、不可变、单次投影同时保留多步协议正确性和公开最小化；single-pump hub 还避免
  `ReadableStream.tee()` 的未消费 sibling 让提前取消的消费者等待 provider timeout。
- 边界：私有 getters 只供同一 server-only 模块的 live eval/计量使用；报告仍不得保存 raw usage、
  reasoning、prompt 或 provider ID。边界不把 LLM 变成事实来源；工具执行仍由静态 tool set、Zod、
  deterministic service 与审计 wrapper 决定。1,024 是内存与可用性的防御上限，不是可调高来
  接受无界模型输出的业务配额；触发时公开响应可能已收到此前的安全事件，但整条流以错误终止，
  不能计为成功。hub 使用 AI SDK 明确导出的 `ai/internal`
  `createAsyncIterableStream`，锁定版本当前可用，但 SDK 升级必须专项复核。真实 provider 行为和生产
  SSE 仍需凭据授权与部署后的 readback，mock 不能替代。
- 验证方式：两步 V4 mock 在首次 step 注入 reasoning、reasoning provider metadata、原始 tool ID 和
  合法工具调用，断言第二次 provider prompt 保留全部私有标记，同时并发消费 `fullStream`、公开
  `text`、UI SSE 与 raw typed getter；前三者只能出现边界 ID/固定缺口，调用方显式请求 reasoning
  也无效。真实 Route Handler SSE 重复相同检查。回归另覆盖 Zod 剥离额外 output、重复 JSON key、
  accepted/unknown timing、递增 step ID、error/abort/no-output 与旧证据门行为；并覆盖一个消费者
  提前退出时并发消费者继续完成、完成后晚订阅重放、底层源异常的当前/晚订阅一致固定错误，以及
  replay 上限失败关闭。

### ADR-242：CSV preview 批次确认绑定原创建者且失败语义去枚举化

- 状态：Accepted；当前仅在本地工作树实现，尚未部署
- 日期：2026-09-02
- 决策：`confirmMarketImport` 的事务内 `SELECT ... FOR UPDATE` 必须同时匹配 batch ID、当前认证
  actor email 对应的 `created_by` 和 `status=previewed`。missing、已结算或 creator mismatch 统一返回
  `GovernanceConflictError("Import batch is missing or is no longer previewable.")`，不区分资源存在性或
  所有者。valid 与 invalid/rejected 两条最终状态更新再次带相同 id/creator/status 谓词。Admin 和
  Reviewer 身份不获得隐式 takeover；跨身份接管必须另行设计显式授权与审计。
- 理由：dashboard 的全局 audit 可让其他已认证 principal 观察 batch UUID；若 repository 只按 ID 与
  preview 状态加锁，另一个 Editor 或 Admin 可以确认/拒绝并非自己查看和上传的 CSV 预览。Route
  角色检查不能替代对象级所有权。
- 边界：本决策不改变 preview 创建权限、CSV 内容校验、数据库 schema 或角色模型，也不新增公开
  写入能力。creator predicate 与行锁建立当前 schema 下的对象所有权/并发边界；若未来加入 RLS、
  trigger 或显式 delegation，需重新验证最终 UPDATE 的可观测 row-count 语义。
- 验证方式：表驱动 PostgreSQL/PGlite 集成测试让其他 Editor、Reviewer 和 Admin 分别尝试确认同一
  preview，断言都得到相同脱敏冲突且 batch、draft、market fact 与 audit 零变化；随后原创建者仍可
  成功确认。缺失和已结算 batch 使用相同外部错误，合法/非法两条 owner 路径以及既有同批次并发
  smoke 继续作为控制组。

### ADR-243：Live eval 由有界 bootstrap 和落盘字节回执决定进程结果

- 状态：Accepted；当前仅在本地工作树实现，尚未运行获授权的真实 provider live eval
- 日期：2026-09-02
- 决策：依赖外 ESM bootstrap 从 fork 起设置 60 秒 pre-provider deadline；首次合法
  `provider_may_have_started` 在 ACK 前先提交保守状态，随后切换为
  `18 × 90 秒 + 120 秒` 的全运行 deadline。ADR-245 将原 5 秒 report receipt envelope 检查细化为
  5 秒 deep-verifier 执行上限和 10 秒完整 receipt 阶段；runner 等待 report ACK 为 20 秒，ACK 后
  退出仍限 5 秒。deadline 到期先发 SIGTERM，2 秒未退出再发 SIGKILL，再过 2 秒仍无法回收则断开、
  unref 并让 parent 非零结束。只有确认 child 已退出、且从未观察到 provider boundary 或 report
  receipt 时，bootstrap 才可写既有 `module_import` 形状的零调用失败报告；provider boundary 后任何
  异常都不得合成零调用 ledger。任何未知、畸形或乱序 IPC 都会永久标记本次协议失信；即使发生在
  provider boundary 前，回收 child 后也不得宣称零调用。
- 回执合同：TypeScript 持久化 helper 对实际写入的 canonical bytes 计算 SHA-256 与 byte length，
  child 的 `report_persisted` 只发送 protocol version、`evaluatedAt`、`runId`、digest 与长度，不发送
  可被直接信任的路径、threshold 结论或退出码。parent 用已校验 identity 自行推导 archive 路径，
  读取 archive/latest 原始 bytes，核对 receipt、canonical encoding、当前报告 envelope 与 latest
  关系，再把推导出的 `0 | 1` 放入 ACK。child 收到后显式退出；parent 还必须核对实际 exit code，
  任何 signal、强制终止、缺失 ACK 或不一致都失败。退出 0 额外要求 provider boundary 已提交、
  latest 与 archive 逐字节相同、18 条结果完整、`runError=null`、termination 为 `completed` 且报告
  threshold 为真。
- 持久化合同：live-eval JSON 固定为两空格缩进与单一末尾 LF，并以 parse 后 exact round-trip 拒绝
  duplicate key、替代数字/空白编码和非 canonical bytes；这不引入 RFC 8785 key sorting，也不改写
  历史报告。创建 archive 目录后先同步 eval 父目录；临时文件再 `fsync`，archive hard-link 后同步
  archive 目录、删除临时名后再次同步；latest rename 后同步 eval 目录，只有目录同步成功才声明
  `latestUpdated=true`。bootstrap 为保持在
  TypeScript loader/application import 之外，继续只复制完成失败兜底所需的最小 serializer 与持久化
  顺序，不导入应用 helper。
- 理由：case 内 AbortSignal 不能保证 provider promise 或网络 handle 会响应取消，裸 IPC 布尔值也
  不能证明报告确实落盘或该以何种状态退出；文件内容已 `fsync` 但目录项未同步时，断电后 archive /
  latest 名称仍可能丢失。由 parent watchdog 回收独立 child，并让 receipt 绑定实际持久化 bytes，
  可以同时封闭无限挂起、伪造成功和零调用回退竞态。
- 边界：bootstrap 自身仍只做依赖外 envelope/bytes/protocol 仲裁，不内嵌第二份 scorer；ADR-245
  增加的隔离 verifier child 复用 portfolio 的唯一纯 v11 consistency 入口。pre-provider watchdog
  无法可靠区分 loader、database 或 model setup 内部停点，因此沿用 ADR-187 的 `module_import`
  兜底 envelope，并只声明 provider 尚未越过 ACK 边界。目录 `fsync` 保护本机文件系统提交顺序，
  不替代磁盘、宿主机或远端备份可靠性。
- 验证方式：spawn 测试用复制后的固定短 deadline 覆盖 provider 前永久挂起、provider ACK 后挂起、
  receipt 后残留 active handle、正常 pass/fail ACK、伪造 digest 与 duplicate-key bytes；每个子进程
  另有测试侧 safety kill，并断言它未触发。report/verifier 测试覆盖 canonical round-trip、receipt
  digest/长度、archive/latest byte identity、目录同步顺序与同步异常失败关闭；专项 Vitest、
  typecheck、scoped lint 和 diff check 作为本地验收。

### ADR-244：公开语言切换以 Cookie、刷新读回与完整页面恢复维持一致

- 状态：Accepted；当前仅在本地工作树实现，尚未部署
- 日期：2026-09-02
- 决策：本决策扩展而非改写 ADR-203。语言偏好接口成功后，客户端为对应 RSC refresh 提供 15 秒
  有界等待；刷新后的 `LocaleProvider` locale 与目标一致才完成切换。出现超时或 locale mismatch 时，
  `diesel_locale` Cookie 是服务端偏好的真相来源：可读但缺失等价于默认 `en`，不可读则不能推断
  一致。若 Cookie 的有效 locale 与当前刷新读回一致，保留当前界面并显示固定错误；否则向偏好接口
  回滚至切换前 locale，并再次验证 Cookie。refresh waiter 返回明确的 `settled` 或 `timed_out`；一旦
  超时，完成尽力回滚后无条件执行完整页面 reload，因为迟到 RSC 仍可能覆盖已经核对的文档状态。
  正常 mismatch 仅在回滚失败、Cookie 不可读或读回不能确认时 reload。reload 使用当前 location，
  不改写 history，因而保留 pathname、query 与 hash。所有 timer、
  request owner 和迟到 completion 必须可清理，避免失败的 RSC transition 永久锁住控件。
- 公开呈现：根页面与国家详情共用完整 localized metadata helper，逐 locale 生成 title、description、
  Open Graph locale、type、image 与 image alt，避免路由级 metadata 的浅层替换丢失字段。语言切换期间
  控件暴露 `aria-busy` 和双语 `role=status` live 文案；无数据状态使用 polite/atomic status，route error
  与 global error 使用 atomic alert，使 loading、empty 与 error 状态不只依赖视觉样式。
- 理由：HTTP 2xx、客户端 transition 完成和 Cookie 实际持久化是三个不同事实；RSC 请求失败还可能
  让 transition 长期 pending。缺失 Cookie 若不解释为默认语言，会在由中文切回英文的反向路径上把
  下一次服务端导航错误分类，造成界面与默认偏好继续分裂。显式回滚和最终 reload 让失败关闭仍能
  收敛，同时不破坏用户正在查看的可分享 URL。
- 边界：15 秒是客户端一致性等待上限，不是网络或服务可用性承诺；完整 reload 不能保证浏览器接受
  Cookie，只保证重新以服务端可观察偏好渲染。metadata helper 不改变来源内容的原始语言，ARIA live
  region 也不替代页面中的可见错误文案。本决策不修改数据库 schema、公开写入范围或 ADR-203 的
  request identity 原则，且不引入新依赖。
- 验证方式：纯函数表测覆盖 Cookie 可读/不可读、缺失即默认 `en`、正反向 mismatch、回滚成功与
  reload 决策；受控 Playwright 让中文 RSC 越过有界等待、在回滚后迟到落地，断言最终仍经完整
  reload 恢复英文，且 pathname、query、hash 不变。metadata 单测与浏览器断言覆盖中英文完整 OG 字段；Vitest/Playwright
  分别验证切换 busy/status、无数据 status 和 route/global error alert 的角色与 atomic/live 属性。

### ADR-245：Live eval 的进程通过判定复用唯一深度一致性校验

- 状态：Accepted；当前仅在本地工作树实现，尚未运行获授权的真实 provider live eval
- 日期：2026-09-03
- 决策：`verifyLiveEvalReportConsistency()` 是 v11 报告逐例判定、完整性、termination、score、
  threshold、token/attempt/step ledger 与 observability 汇总的唯一无 I/O 重算入口；
  `portfolio:verify` 在 STATUS、Git、source fingerprint 和 archive preflight 后调用它。依赖外 ESM
  bootstrap 自身不导入 TypeScript/application 模块；收到并浅验 report receipt 后，它在 8 MiB
  上限内取得 exact canonical archive bytes，再以固定 system-only PATH、可信 system Git、tsx
  tsconfig、`NODE_ENV=test` 和 `NO_COLOR` 的环境启动独立 verifier child。该 child 不导入
  runner/model/provider，重新核对 receipt identity/digest/canonical bytes，调用同一纯一致性入口，
  并绑定 STATUS 的静态 model/profile/version/suite 预期；通过候选必须重算为 complete、threshold true
  和 18 cases，而不是从候选取得 outcome/sample 预期。它还重新采集当前 source fingerprint，要求
  current HEAD 等于报告 base HEAD；dirty provenance 必须没有 evaluated commit，clean provenance
  必须把 evaluated/base commit 与 commit-tree fingerprint 严格绑定。初始化失败报告可以通过“自洽”
  验证，但其重算 threshold 必为 false，永不能让
  命令退出 0。
- 进程合同：deep verifier 最多执行 5 秒，之后按 SIGTERM 2 秒、SIGKILL 2 秒、最终 unref 的固定顺序
  回收；完整 receipt phase 为 10 秒，runner 等待 report ACK 为 20 秒。verifier response 必须 exact
  回显 parent nonce、protocol、`evaluatedAt`、`runId`、byte length 与 SHA-256，并在发送后实际 exit 0；
  未知/重复消息、错误 nonce/digest、signal、非零退出或残留 handle 全部失败关闭。parent 在 verifier
  成功后再次有界读取 archive/latest，archive 必须仍等于最初 receipt bytes，latest 必须等于该
  archive 或拥有严格更新 identity。`expectedExitCode` 初始为 1，只有 provider boundary、全部深验、
  verifier exit 0 和最终读回同时成立时才单向变为 0。
  runner 在注册进程 signal/IPC handler 后发送 `initialization_ready` 并等待 ACK；初始化总 deadline 仍从
  fork 时开始，parent 只按剩余预算重新 arm，因此握手不会延长或绕过 provider 前失败关闭期限。
- 理由：receipt 的长度与 digest 只能证明某组 bytes 已落盘；若继续信任报告自述的 `complete`、
  `thresholdsPassed`、scores 或摘要，schema-valid 的内部矛盾仍可让 `ai:eval:live` 错误返回 0。
  独立进程同时隔离 TypeScript loader/深验挂起，并避免在 bootstrap 中复制第二套易漂移 scorer；最终
  二次读回关闭 verifier 执行期间替换 archive/latest 的竞态。
- 边界：该 ACK 前校验只读取 STATUS 的静态 model/profile/version/suite，不读取候选控制的
  outcome/sample，也不枚举所有历史归档；其余 release-evidence 约束仍由 `portfolio:verify` 独立负责。
  8 MiB 是本地 report/IPC 防分配上限，不是 provider token 预算。
  verifier 环境清除模型、数据库、代理、caller PATH 与 `NODE_OPTIONS` 等继承变量，且其 import tree 不包含远程
  provider 执行路径；本决策不授权新的 provider 调用，也不改变 case、threshold 或 latest 身份。
- 验证方式：spawn 测试覆盖正常 pass/fail receipt、row `pass=false` 但顶层 true、score/token 汇总
  篡改、source/repository unavailable、错误 nonce、合法 response 后不退出并忽略 SIGTERM；均要求
  parent 在 report ACK 前拒绝。常量合同测试要求 outer receipt deadline 大于 verifier execution +
  TERM/KILL，runner report-ACK timeout 又严格大于 outer receipt + runner exit grace；portfolio 既有
  tamper suite 继续证明共享入口的全字段重算。

### ADR-246：Live eval 通过候选携带版本化、仅内存的原始观察 sidecar

- 状态：Accepted；当前仅在本地工作树实现，尚未运行获授权的真实 provider live eval
- 日期：2026-09-03
- 决策：v11 持久化报告 schema 保持不变。runner 仅对 `thresholdsPassed=true` 且 `runError=null`
  的候选构造 `sales-chat-live-observations-v1` sidecar；失败报告必须发送 `null`。sidecar 不包含 user
  prompt 或 expected judgement，只包含 run identity、逐 case 原始最终正文、逐 step 的边界 tool
  call/result、标准化 metric、aggregate usage、attempt/completed、latency，以及稳定枚举的 boundary
  rejection、stream completed/error 布尔值（不含错误原文）。它只通过 IPC 在内存中传递，
  不写入 archive/latest 或其他文件。
- 合同：IPC 升为 v2。report receipt 与 observation receipt 双向绑定同一 `runId`/`evaluatedAt`，各自
  绑定 canonical byte length 和 SHA-256；observation receipt 另绑定 version 与 18 cases。总 sidecar
  上限 8 MiB，response 每 case 64 KiB，tool output 512 KiB，case 1 MiB，最多 5 steps、每 step 8 calls
  与 8 results、每 case 32 个 tool items。isolated verifier 要求 canonical case ID/order，按 ID 取
  `salesChatLiveCases`，重新计算 response disposition/locale/anchors、normalized args、tool selection、
  tool-result ID/name 配对与 Zod output、evidence result、judgement/mismatch/pass、token ledger 和 model
  observability，并逐字段对比 v11 report。strict response 回显 nonce 与组合 receipt，且必须实际 exit 0。
  ACK0 还要求每个 case 都是 stream completed、没有 stream error、没有 boundary rejection；由此独立
  推导 `errorCode=null` 和 evidence result，而不是硬编码成功状态。
- 安全评分修正：对 `expectedEvidenceAllowed=false` 的 case，`whole_request_refusal` 只在观察正文逐字
  等于按同一组工具结果重建的生产 `evidence-boundary` 固定响应时成立；模型自行生成的拒绝前缀即使
  命中全部 response anchors，也仍按 `answered` 失败关闭。formatter 位于不依赖 provider、model、
  repository 或 service 的纯模块，生产流与 isolated verifier 共同复用，import-tree 测试继续禁止
  verifier 引入 runner/provider 执行路径。该修正不改变 v11 report/sidecar schema、case 或阈值，
  因此不升级版本。
- 失败关闭：通过候选缺少 sidecar、失败报告携带 sidecar、noncanonical bytes、digest/identity/version/
  size 漂移、重复/缺失/乱序 case 或 tool、无效 result、未知/重复 verifier response、timeout/signal/
  hang 均不能 ACK0。用于 hash 的临时 Buffer 在 finally 中尽力清零；stderr/stdout 不打印正文、tool
  input/output 或 sidecar。
- 安全边界：sidecar 是同一次 runner 执行内的独立重算材料，可发现 scorer、聚合器或持久化报告的
  意外漂移。它不是 provider 签名或远端 transcript，不证明 provider 确实被调用，也不抵御拥有相同
  进程权限并同时伪造 report 与 sidecar 的恶意 runner。原始 provider transcript 的可信见证仍属后续
  边界；本决策不新增依赖、数据库 schema 或磁盘中的 raw 数据。

### ADR-247：受控 Next 入口以操作级快照精确恢复 tracked `next-env.d.ts`

- 状态：Accepted；当前仅在本地工作树实现
- 日期：2026-09-04
- 决策：`pnpm build`、公开 E2E、global-error fixture、零配置 Demo 与 FDE Demo 共用同一
  `next-env.d.ts` guard。guard 在 Next 启动前只接受有界、canonical、非 symlink、单 hard-link 的
  原文件并保存字节与 mode；每个入口只记录自己 allowlist 内的 canonical route-import 生成态。Next
  关闭后，仅在当前文件等于原快照或已记录生成态时恢复，并以同目录独占临时文件、file fsync、
  atomic rename、directory fsync 和稳定读回完成提交。server shutdown ACK 必须发生在恢复之后；
  操作错误与恢复错误同时存在时保留两者。
- 理由：Next 会改写 tracked declaration，直接运行 build 或测试会制造 dirty worktree并使后续源码
  指纹失效；简单 `writeFile` 恢复还可能截断文件或覆盖无法归因的人工/并发修改。
- 边界：guard 不是跨进程锁，也不保证 `SIGKILL`、进程崩溃或掉电后的恢复；最后稳定读到
  rename 的短窗口不是原子 compare-and-swap。在此前观测到的无法归因内容必须保留并失败关闭。
  同一 checkout 不应并行运行 Next 入口。它不清理 `.next`、`.next-e2e`
  或其他输出，也不构成 Next 供应链证明。
- 验证方式：函数测试覆盖固定 production/dev/E2E canonical 变体、原字节与 mode 恢复、幂等恢复、
  symlink/多 hard-link/未知内容拒绝、并发漂移保留，以及 build 零退出、非零退出和异常路径；真实
  build 与三类 Playwright server 运行前后另核对原文件 SHA-256。

### ADR-248：Vitest execution capture lock 需显式人工确认才回收并保留 quarantine

- 状态：Accepted；当前仅在本地工作树实现
- 日期：2026-09-04
- 决策：capture lock 使用 `vitest-execution-capture-lock-v2` canonical JSON owner，包含 token、PID、
  platform、hostname 和 acquiredAt；`0600` 候选文件 fsync 后通过 hard link 无覆盖发布到 Git common
  directory，使关联 worktree 共用锁。发布成功后，canonical lock 与 retained publication guard
  必须在整个 capture 生命周期保持为同一 inode、相同 canonical bytes 且 `nlink=2`；仅删除 canonical
  lock 不会释放所有权，反而留下可诊断且继续阻断 acquire 的 orphan guard。冲突时 acquire 永不自动回收；owner 与当前
  hostname/platform 一致且 `kill(pid, 0)` 明确返回 `ESRCH` 只将状态标为 stale candidate。
  操作者还必须在核对进程树并确认不存在后代工作负载后显式授权恢复。恢复先建立按 owner
  bytes SHA-256 命名的 quarantine
  hard link，复核 canonical/quarantine 的 inode、bytes 与 link count 后才 unlink canonical lock 并
  fsync metadata directory；quarantine 保留原 owner 事实。显式恢复再由一个 `O_EXCL` recovery claim
  串行，正常 acquire 也在 claim 存在时失败关闭。
  `portfolio:verify` 在执行受监督的 `vitest list` 前取得同一把锁，并一直持有到 execution evidence、
  inventory 与重算计数全部验证完成；因此 capture 与 verifier 不能在同一 Git common directory 并发。
  capture/verify 在取得锁前都先用已绑定 helper 完成 Unix process-group inventory capability preflight。
  若 supervisor 无可信 completion receipt、进程组 absence 无法证明、guard identity 漂移或证据 sink
  出现未知变化，流程保留 lock、guard、工具目录、报告候选和 inventory 临时状态供人工检查，不执行
  自动 rollback 或递归清理。
- 理由：遗留目录锁会在进程异常退出后永久阻塞长时间 capture；但 capture wrapper 的
  PID 消失时，其 Vitest 子进程仍可能存活。按时间自动删除、仅凭 owner PID 缺失、直接 unlink 或只
  比较路径都可能删除仍在工作或已被替换的锁。显式人工确认、hard-link publication 与 quarantine 提供
  compare-and-preserve 边界。
- 边界：acquiredAt 只用于诊断，绝不作为 stale 证明。live PID、`EPERM`、未知 probe、foreign
  host/platform、PID 复用、malformed owner、symlink、非普通文件和 legacy directory 均失败关闭。
  人工确认是运维证明，不是内核 lease；同 hostname 但不同 PID namespace 仍需人工核对。该锁只协调
  遵守协议的 capture/verifier，不抵御
  同等文件权限主体，quarantine 也仍是可被相同权限修改或删除的普通文件。恢复进程若崩溃，
  fixed recovery claim 会留存并同时阻断 recover/acquire；这是刻意的失败关闭，需操作者确认无相关
  工作负载后按 inspection 报告的精确路径人工移除；孤立 publication candidate 同样不自动删除。
- 验证方式：单测覆盖 canonical owner round-trip、同机 alive/missing/denied/unknown、foreign
  identity、common-dir 跨 worktree 排他、原子发布和释放身份复核、owner 退出后仍拒绝自动恢复、
  lifecycle guard 在 canonical 被删除后仍阻断、quarantine 字节保留、recovery claim 串行与遗留
  claim/candidate/guard 路径诊断，以及 legacy directory、symlink、malformed file 的零修改失败关闭；
  capture 的 containment-unproven 集成测试证明真实 supervisor 缺 receipt 时 lock、guard、tool 与临时
  证据均不被清除；verifier 使用同一锁包住受监督 inventory 与最终证据重算，其专属 unproven cleanup
  分支仍需执行级 fault-injection 测试强化。

### ADR-249：有界命令以 Unix inventory capability、detached guardian 与 v2 receipt 证明原始进程组封闭

- 状态：Accepted；当前仅在本地工作树实现，真实部署主机仍需发布前 capability 检查
- 日期：2026-09-04
- 决策：`run-bounded-command.mjs` 只在 Unix 且精确 `/bin/ps -axo pid=,pgid=` 能返回严格、唯一、
  有界 UTF-8 sentinel inventory 时运行。每次普通调用在创建输出或启动 workload 前先启动一个
  detached capability probe；capture、verify 与 `stage-release.sh` 又在取得其长生命周期状态前显式
  调用同一 helper 的 `--check-process-group-inventory-v1`。任何缺失、超时、超限、重复 PID、格式漂移、
  sentinel 缺失或 residual group 都失败关闭，不提供降级路径。
- 进程协议：outer supervisor 启动 detached guardian（guardian PID 即 PGID），guardian 再以
  non-detached 方式启动 workload。所有负 PGID 的非零信号只允许由仍存活、因而仍锚定该 PGID 的
  guardian 发出；outer 在 guardian 关闭后只做 signal-0 absence probe。正常退出、超时、输出超限和
  外部信号都要求 guardian 最终恰好一次发送包含自身的 group `SIGKILL`；guardian 提前死亡、IPC/ACK
  异常、普通退出或 absence 无法证明均返回 126，outer 不再尝试补杀可能已复用的 PGID。
- Receipt：只有可信 terminal record、guardian 以 `SIGKILL` 关闭、stdio close 且 signal-0 得到
  `ESRCH` 后，outer 才通过独占临时文件、fsync、hard-link no-overwrite 发布 mode `0600`、`nlink=1`
  的 canonical `bounded-command-completion-v2` receipt。receipt 绑定随机 token、实际 exit code、
  `closeSeen`、`groupAbsenceProven` 与 `guardianSealed`。`stage-release.sh` 为每次 SSH/rsync 调用生成唯一
  path/token，并在继续下一阶段前以 `O_NOFOLLOW`、身份稳定读回和 exact canonical JSON 验证；缺失、
  malformed、token/exit mismatch 或多 hard-link 全部视为 status 126，并保留本地 staging root。stage
  收到 HUP/INT/TERM 时只在 `jobs -p %%` 仍与记录的 `$!` 相等时通过 Bash jobspec 发信号，绝不向缓存
  数字 PID 发信号；wait 后同样验证 receipt，可信才清理，否则保留现场。
- 理由：workload leader 退出不代表同组后代已经关闭；leader 消失后由 outer 再发送负 PGID 非零信号
  存在组号复用误杀窗口。存活 guardian 将组号占用到最后一次自包含 kill，而 v2 receipt 让上层只在
  containment 证据完整时释放 lock 或临时状态。
- 边界：证明只覆盖 guardian 的原始 Unix 进程组，不覆盖主动 `setsid()` 逃逸的对抗性后代；同 UID、
  同文件权限主体仍可破坏本地状态。signal-0 的 present/`EPERM` 可能因复用造成保守假失败，但不会触发
  误杀。macOS/Linux 的 `ps` 行为必须由目标主机现场 preflight；测试环境的 hermetic fixture 通过
  test-only preload 模拟严格 inventory，不构成真实主机 capability 证明。Windows 不支持且不得静默降级。
- 验证方式：真实进程测试覆盖正常退出、stubborn descendant、timeout、HUP/INT/TERM、ready 前 signal、
  guardian 提前死亡、IPC 隔离、outer 仅 signal-0 probe、inventory timeout/overflow/malformed/duplicate/
  missing sentinel/residual；stage fixture 覆盖可信 receipt，missing/malformed/token mismatch/exit
  mismatch/multi-link receipt 返回 126、停止后续远程步骤并保留本地检查状态，以及 HUP/INT/TERM 的
  jobspec 转发与 receipt 后验清理。

### ADR-250：模型提供的产品型号在工具执行前拒绝私有推理标记，审计只保存有界承诺

- 状态：Accepted
- 日期：2026-09-05
- 决策：`findCompatibleProducts`、`calculateOpportunityScore` 与
  `generateSalesBrief` 共用同一个 model-originated `productModelCode` schema；在既有
  trim、100 字符输入上限和 uppercase canonicalization 之前识别 raw、entity-encoded
  及规范化后的 reasoning markup，命中即作为无效工具输入失败关闭，不能进入产品/营销服务。
  对已经通过 schema 的工具调用，AI tool audit 不再保存产品型号明文，只保存
  `algorithm=sha256`、canonical code-point 长度和 digest。无效输入审计仍只保存输入类型与
  已知字段名，不保存 provider 值。
- 理由：公开 stream transform 能丢弃带 reasoning marker 的工具 part，但若执行 schema 仍接受
  该字符串，provider 值可能先到达确定性 service 和审计库，形成“未公开但已执行/持久化”的边界
  绕过。服务前验证与审计最小化必须独立于最终 SSE 投影。
- 边界：无盐 SHA-256 是同一 canonical 值的可审计承诺，不是加密或匿名化；低熵型号仍可能被
  枚举。产品型号在当前请求内仍用于确定性目录匹配，本决策不修改产品 fixture、数据库 schema
  或公开写入能力。
- 验证方式：表驱动 schema 测试覆盖 raw/entity-encoded reasoning markup 与三个工具；生产
  `fullStream` 和 `/api/chat` SSE mock 断言 marker/伪结论均不可见、产品 service 未调用且审计
  不含 marker；合法型号测试核对审计只含长度与 SHA-256 承诺。

### ADR-251：Playwright 运行回执与聚合证据共用失败不掩盖的原子文本落盘

- 状态：Accepted
- 日期：2026-09-05
- 决策：单套 Playwright reporter receipt 与四套运行的聚合 evidence 统一调用
  `persistAtomicTextFile()`：先以 `open(..., "wx")` 独占创建同目录随机临时文件，只有取得该文件
  所有权后才写入并在失败时精确清理；rename 成功即释放所有权，不再触碰旧路径。独占创建失败时
  绝不删除可能属于其他进程的碰撞路径。持久化与 cleanup 同时失败时抛出保留两项 root cause 的
  `AggregateError`；上层 reporter 与 capture 命令都用完整 error tree 报告并返回失败，cleanup
  不能覆盖原始 open/write/close/rename 错误。
- 理由：仅把 `rm()` 放在 rename 的 `finally` 中会让 cleanup 异常掩盖真正的持久化失败；而把
  `writeFile()` 放在 `try` 外又会在写入失败时遗留临时文件。两层证据写入使用不同实现也会让
  已测试的 reporter 保证无法覆盖最终聚合 artifact。
- 边界：同目录 rename 只保证读者不会看到部分目标文件；当前 helper 没有宣称跨文件事务、
  `fsync` 掉电持久性或与非协作写入者互斥。聚合证据仍须经过 schema、来源指纹与
  `portfolio:verify` 的独立复核。
- 验证方式：helper 与 reporter lifecycle 测试覆盖 `EEXIST` 零删除、成功 rename 零 cleanup、
  write failure 与 rename+cleanup 双失败，断言精确 cleanup 次数、失败状态和完整错误树；聚合
  capture 复用同一 helper，顶层错误输出不再只保留单一 `Error.message`。

### ADR-252：Live eval 在任何 provider 边界前绑定 STATUS 的完整模型配置

- 状态：Accepted；当前仅完成本地实现与 mock 验证，未获授权执行远程 provider
- 日期：2026-09-05
- 决策：live-eval runner 在 `model_configuration` 阶段读取并 strict parse 当前
  `docs/STATUS.md`，把实际 `modelId` 与 provider profile 的精确键集合及五个值
  （adapter、adapter contract version、thinking、endpoint SHA-256、usage 请求）和 STATUS
  期望逐项比较。只有完全一致后才能触发 `onProviderMayStart` 并构造生产 `streamSalesChat()`；
  STATUS 不可读、不可解析、缺键、多键或任一值漂移都统一转为不含配置值的
  `AiConfigurationError`，以 `model_configuration` 初始化失败、0 attempt、0 completed、0 step、
  0 token 和非零退出码落盘。
- 理由：只在 provider 调用结束后的 portfolio verifier 比较报告 model/profile，无法阻止误配的
  兼容 endpoint 先接收 18 条内部 eval case。调用前 admission 与调用后报告复核是两个独立门，
  不能由后者替代前者。
- 边界：endpoint digest 绑定本地配置的 URL 字节，不证明远端 TLS 终点的组织身份、模型权重或
  provider 账单；STATUS 本身仍须走代码审阅和 release evidence 校验。本决策也不把 160,000
  后验 token 验收上限升级为预消费硬限额。
- 验证方式：runner 表驱动 mock 分别漂移 model ID 与五个 profile 字段，并注入 STATUS parse
  failure；全部断言 provider callback/transport 运行次数为 0、失败报告无实际配置值且退出码为 1。
  匹配路径另锁定 STATUS admission 先于 provider boundary。

### ADR-253：已公开法规卡在异常终局前补发一次免责声明

- 状态：Accepted
- 日期：2026-09-05
- 决策：public evidence boundary 只在 schema-valid、输入输出匹配且已经公开的工具结果确实涉及
  法规时记录 `regulatoryCardSeen`。正常 `finish` 继续保持既有模型正文或固定 evidence-gap 的
  disclaimer 顺序；若后续是 abort，则在 abort part 前补发一次固定免责声明；若 transformed source
  直接失败或 replay 达到上限，则 public hub 先把同一免责声明加入有界 replay。普通 `fullStream`
  与 convenience consumers 在读完这些公开 fallback parts 后仍收到 sanitized stream error；SSE
  consumer 则收到 sanitized error part 并正常 close，使已经排队的免责声明不会被
  `controller.error()` 清空。当前与迟到订阅者从同一 replay、cursor 和 terminal state 读取。
- 理由：工具卡按计划实时公开，而正常 disclaimer 原先只在 `finish` 合成。第二步 abort 或底层
  `ReadableStream` 直接失败会留下“法规事实卡已显示、免责声明永远未显示”的公开状态；仅靠错误 UI
  不能补足该事实限定。错误终局补发不改变正常 evidence-denied 响应，因此 isolated live-eval 的
  exact boundary 比较无需重排或降级。
- 边界：异常补发只保护已经公开的验证后法规卡，不把工具错误当法规事实，也不让 abort/source
  failure 变成成功完成；live eval 仍必须把这些路径记为 execution error / `not_evaluated`。Hub 的
  1024 普通 replay 上限最多为三个固定 disclaimer parts 留出异常终局增量；私有 provider error
  仍不会进入公开 part、日志正文或 SSE。
- 验证方式：本地 mock 覆盖法规卡后 AbortSignal abort、底层 source error 和显式 provider error；
  分别断言卡之后恰好一次 disclaimer、abort/error 的先后顺序、迟到订阅一致、SSE 有 sanitized error
  与 `[DONE]`、私有 marker 不可见，并保留正常 evidence-gap 与 live-eval exact formatter 回归。

### ADR-254：允许证据的 live eval 也拒绝“带齐锚点的整请求拒答”

- 状态：Accepted；当前未获授权执行远程 provider live eval
- 日期：2026-09-05
- 决策：evidence-allowed case 在既有工具、证据、response anchors、语言和 token 检查之外，继续要求
  `responseDisposition=answered`；整请求拒答识别补齐英文 `will not`、`won't`、`decline`、`refuse`
  以及对应中文“不会/拒绝/无法提供”等明确句式。包含 country/profile/comparison 等全部 case anchors
  的否定句仍判为 `whole_request_refusal`，不能借 substring grounding 假绿；只拒绝单项未证实 claim
  且同时给出有证据结论的谨慎回答继续视为 answered。
- 理由：response anchor 证明正文提到目标实体和决策主题，不证明这些词处于肯定语境。有限旧模式会把
  `I will not provide the requested country overview for CHN.` 当作 answered，同时命中 CHN 与 country
  overview，导致非安全 case 的过度拒绝被错误接受。
- 边界：这是确定性 refusal grammar，不是通用语义判定器；response grounding 仍是版本化锚点合同，
  获授权真实运行后必须如实保存未知措辞造成的失败，不能为分数反转期望。修正不改变 v11 schema、
  case、threshold 或生产响应，因此不升级 eval 版本。
- 验证方式：英中文表驱动测试构造“全部 anchors 与 locale 均通过、但整请求明确拒绝”的正文，端到端
  断言 judgement 因 response disposition 失败；既有 claim-level certification 谨慎回答保持 answered。

### ADR-255：文档重新处理以活动草稿所有者绑定关闭跨 Editor 对象访问

- 状态：Accepted
- 日期：2026-09-05
- 决策：重新处理准备接口强制接收 discriminated access scope。Editor 只能使用
  `creator + createdBy`，知识仓储必须先按 document identity、活动 Draft/Reviewed 状态和
  `created_by` 找到草稿，命中后才可读取完整 document/source/chunk metadata；service 在读取原文件
  前再次比较返回草稿 owner。Reviewer/Admin 使用显式 `global` scope。准备快照新增
  `activeDraftCreatedBy`；治理提交事务锁定该文档的草稿版本链后，同时比较 expected draft ID 与 owner，
  并在正常 active-draft 路径以及命中 `document_reprocessed` marker 的幂等路径复核 actor：Editor
  必须与相应 owner 同 email，Reviewer/Admin 保持全局权限。所有 owner mismatch 使用不含账号 email
  的固定冲突，不向调用者暴露目标对象的身份信息。
- 理由：仅验证 `editor` 角色会让任意 Editor 凭 document UUID 重新处理另一 Editor 的未发布草稿，
  原文件和完整 metadata 会在真正写事务前被读取；只在准备阶段过滤又无法防止伪造 prepared payload
  或准备与提交之间的所有权漂移。查询前过滤、service 复核、prepared owner 绑定和事务内复核分别关闭
  枚举、仓储错误、内部调用绕过与 TOCTOU 窗口。
- 边界：本决策不新增数据库 schema 或索引，不改变 Reviewer/Admin 的全局治理职责，也不改变来源
  `verifiedAt` 的更新或发布语义。内部同文件权限主体仍可直接读取本地存储；该风险不属于 HTTP 治理
  principal 边界。
- 验证方式：service 单测注入越权仓储返回，断言原文件读取次数为零且错误不含目标 email；PGlite
  集成测试覆盖 creator/global 查询 scope、伪造 owner expectation、跨 Editor 正常提交与幂等重放的
  零副作用失败、Reviewer 正常提交、同 actor 合法重放以及 Reviewer/Admin 全局幂等读回。

### ADR-256：来源核验时间在所有治理写入口保持单调

- 状态：Accepted；当前仅完成本地实现与 PGlite/真实 PostgreSQL smoke 接线，尚未观察远端 CI
- 日期：2026-09-05
- 决策：`data_sources.verified_at` 表示最近一次核验时间。直接 `updateSourceVerifiedAt` 与 reviewed
  `data_source` draft 发布必须保留 Zod 已验证的原始 ISO 字符串，并在各自事务内将其绑定为 PostgreSQL
  `timestamptz`；取得正式来源行锁后的比较及最终条件写都使用数据库原生微秒精度，不能通过
  JavaScript `Date`/epoch 毫秒进行顺序判断。proposed 早于当前值时统一抛出固定、不含来源身份或
  时间值的 `GovernanceConflictError`，相等或更新的时间允许。禁止通过 `greatest`、应用层 `max`
  或其他静默合并改变已审核 payload 的实际语义。
- 缺行边界：`SELECT ... FOR UPDATE` 未命中时没有可锁定的行。来源 draft 因此走独立的 insert-only
  分支；`ON CONFLICT DO NOTHING ... RETURNING` 零行表示在检查后出现同 ID 正式来源，必须以固定
  通用治理冲突整单失败，不能转入更新。已有行分支的 `UPDATE` 再次带 `proposed >= current`
  条件并检查 `RETURNING`。这样发布审计的 `beforeData: null` 只表示本事务确实创建来源，不会把
  并发更新伪装成首次插入。两个分支还必须用 `RETURNING` 中数据库实际的 6 位微秒值覆盖
  `published` 审计的 `afterData.verifiedAt`；输入精度超过 PostgreSQL `timestamptz` 精度时，审计
  记录归一后的正式事实，而不是保留一个不同的原始小数字符串。
- 理由：来源核验和来源草稿发布原本是同一正式行的两条独立写路径。行锁只能确定先后顺序，不能防止
  后到的旧 reviewed payload 把已经更新的核验时间写回过去，导致 stale 判断和审计基线倒退。
- 后果：过期来源草稿发布整单回滚，草稿保持 `reviewed`、不产生 `published` 审计，正式来源的内容与
  较新核验时间保持不变；操作者必须基于当前时间创建或审核新的修订。该规则不新增 schema，也不改变
  来源核验的角色或 BOLA 所有权边界。
- 验证方式：PGlite 表驱动覆盖 direct older/equal/newer 三个边界，并用同一毫秒内
  `.123456Z`、`.123000Z`、`.123789Z` 证明数据库比较和审计读回保留微秒；service 单测锁定原始 ISO
  不经 `Date` 重序列化。9 位小数的 source draft 分别覆盖已有行更新与缺行插入，断言正式行和
  `published afterData` 都采用相同的 PostgreSQL 6 位归一结果。旧来源草稿回归断言固定冲突、
  正式来源不变、草稿仍 reviewed 且无
  published 审计。CI 的 PostgreSQL 16 smoke 先以独立会话排入两个来源行锁 waiter，证明较新直接
  核验提交后旧草稿失败；再用未提交并发 insert 占用缺行来源唯一键，证明发布等待后失败、正式来源
  不被覆盖且审计基线不伪造。

### ADR-257：版本化 host orchestrator 独占发布父状态机

- 状态：Accepted
- 日期：2026-09-05
- 决策：normal host release 只能从 clean environment 前台调用目标 SHA 自带的
  `scripts/deploy/host-release-orchestrator.sh`。新环境必须预先写入
  `/opt/diesel/release-inputs/<sha>/env.production.local`，该 SHA 目录与文件分别为
  `root:root` 0700/0600、canonical、non-symlink，文件单链接且有界。单一 root
  进程在任何本次 state 写入前重验目录链、candidate 与七个 release executable，
  随后以固定顺序独占 FD 8、持久化/fsync rollback basis、在 begin 前安装
  `HUP/INT/TERM/EXIT` one-shot terminalizer、调用 `--begin-activation`、严格读回
  `PENDING:none`、用 `O_NOFOLLOW`/`fstat`/SHA-256 绑定的同目录原子 rename 安装
  candidate、证明 backup/candidate/live 的 PostgreSQL `DATABASE_URL` 全等，再调用
  既有 publication controller。
- 终态合同：controller 0 只表示已严格读回 `COMMITTED:PUBLISH_FINALIZED`；
  75 解除自动 rollback、关闭 FD 8 并保留现场前向修复，绝不自动回滚；其他
  状态必须重读 strict host/governance ledger，只有 `PENDING:none` 直接 abort，
  recovery-shaped 组合在关闭原 FD 后重新取得 maintenance/lifecycle locks，commit-shaped、
  未知或无法读回的组合一律保留为 75。主机回滚失败归一为 70；可捕获
  HUP/INT/TERM 和活动 child 的 137 退出形状在安全收敛后保留。controller 已给出
  0/75 时，该 strict terminal/preserve 结果优先于并发可捕获信号。
- 信号边界：orchestrator 为 begin/controller 创建独立前台 child process group。仅发送给
  parent PID 的 HUP/INT/TERM 也会被转发；trap 与 child-registration replay 共用单个 Bash
  arithmetic builtin 完成首次转发的原子 claim，避免 PID 赋值两侧丢信号或重复转发。
- 理由：Markdown 分散代码块无法证明操作员仍处在同一 shell、trap 仍安装或
  FD 8 仍指向同一 locked OFD；原流程还存在 begin 已可能写入 PENDING、但父 trap
  尚未可执行保护的窗口。预建 root-only candidate 还使关键区间不再依赖交互 shell
  的变量、startup hooks 或秘密输出。
- 边界：一次性 user/group/PM2/systemd provisioning 仍在事务外；本决策不修改
  publication controller、数据库 schema、BOLA、治理 `verifiedAt`、两个 PostgreSQL
  maintenance session 或唯一跨域 commit point。root 仍是信任边界；并发 root 修改、
  `SIGKILL`、主机掉电和底层存储失信仍依赖 durable ledger 与手工恢复流程。
- 验证方式：动态 Bash fixture 在 preflight、FD 8、basis、post-PENDING begin、
  candidate install/readback 和 controller 故障点注入失败，覆盖 0/75/普通状态、严格
  ledger 分流、恰好一次 rollback、FD 关闭顺序、parent-only HUP/INT/TERM、PID 注册
  两侧窗口、毒化环境与无秘密输出；deploy contract 同时要求新脚本以 `100755`
  进入 release archive、通过 `bash -n`，且反向禁止 trap-owner 实现回流 Markdown。

### ADR-258：文档重处理幂等读回重放当前 provenance 并刷新锁快照

- 状态：Accepted；真实 PostgreSQL 16 barrier smoke 已接线，尚未观察远端 CI
- 日期：2026-09-05
- 决策：`commitDocumentReprocessing` 只有在最新 `document_reprocessed` marker 的
  operation fingerprint 匹配后才进入幂等候选；返回前必须重新锁定完整 document draft chain，
  要求 marker 指向的 draft 是唯一未归档 `draft/reviewed` 修订，并通过与 review/publish 共用的
  canonical provenance 校验器重放当前 document、完整 chunk set、source 和 marker。当前 marker
  显式使用 `provenanceVersion: 2`，并绑定按 index 排序、从零连续的 chunk 全部可持久字段与 DB 实际
  created/updated/verified 微秒时间；正文 SHA-256 会从正文重算，`search_vector` 作为生成列不重复绑定。
  `ready` 必须至少一个 chunk，`failed` 必须零 chunk；后者只能从先通过身份/hash/source/status 校验的
  marker 回退 scope/country/jurisdiction，其余 metadata 仍从 document/source DB 行重建。重放还必须
  匹配 processing status、content SHA-256、source ID 及完整 source fingerprint；source 四个时间字段
  均以 DB `to_char(...US...)` 精确读取，不能经 `Date` 截成毫秒。任一漂移统一治理冲突，不能凭旧
  marker 返回 200。v2+ marker 的 `supersededDraftIds` 必须恰好包含一个 immediate predecessor；
  runtime 与 snapshot closure 都验证其属于同一 document/entity、版本严格等于当前版本减一、原状态
  为 draft/reviewed 且已归档，禁止空列表的 vacuous truth、多个前驱、跳版及跨实体 lineage。
- 并发语义：PostgreSQL `READ COMMITTED` 的首个 `SELECT ... FOR UPDATE` 若等待旧 draft 被另一
  事务归档，解除等待后可能返回该旧行而不包含同一期间新插入的 marker draft。幂等候选因此执行
  第二个 statement 重新加载并锁定版本链，再验证唯一 active draft；不能把旧 expected CAS 前移到
  marker 判断之前，否则真正的 response-loss retry 会因来源/draft 已按预期变化而被误拒绝。最新
  reprocessing marker 必须先按关联 draft version 降序选择，再以审计创建时间和 ID 稳定决胜；
  `now()` 是 transaction-start timestamp，单独按审计时间排序不能可靠代表提交或版本先后。
  review 与 publish 一样先无锁读取目标 identity，再按 entity/version 升序锁定完整版本链；reprocess
  commit 也使用该升序链锁。canonical validator 随后查询/锁定 immediate predecessor，因此所有调用
  路径保持相同锁序，不会由 review 先锁当前高版本再反向请求低版本而形成死锁环。
- 理由：只比较 operation fingerprint、actor 与 summary 会在当前 document/source 已漂移时返回
  陈旧成功；只使用第一次 draft 查询又会让两个完全相同的并发请求中后取得锁者错误返回 409，
  尽管第一请求已经完成唯一副作用。
- 准备/提交边界：prepared snapshot 额外绑定完整 canonical marker 指纹；提交写入前锁定并重算，
  因而同一 audit ID 内 metadata、旧 operation fingerprint 或 superseded draft 列表的 TOCTOU 改写也
  会失败。marker/source/chunk 指纹一律从 INSERT 后同一事务的实际 DB rows 生成，不能猜测默认时间或
  float4 落库值。
- 边界：不新增数据库约束或 schema。缺少 `provenanceVersion: 2` 或 `chunkSetFingerprint` 的旧 marker
  明确失败关闭；治理快照导入同样拒绝，须先走受控 provenance 修复/重新导入，不能静默换算旧 hash。
  duplicate-upload 自愈只覆盖完整 draft 版本链缺失且下一版本恰为 v1 的遗留记录；已有任何历史版本
  却无 active draft 时返回治理冲突且事务回滚全部 source/document/chunk/draft/audit 写入，不能补建
  与 canonical action 映射冲突的 v2 `draft_created`。
  数据库外同权限文件篡改由准备阶段内容 hash 校验覆盖，不属于事务内幂等读回快照。
- 验证方式：PGlite 表驱动分别漂移 document title、chunk scope、chunk 正文及同步更新的 content hash、
  processing status、content hash、source 同毫秒 `verifiedAt` 与 `updatedAt`，断言重放失败且零新增副作用；
  failed→failed/no-chunk 重放及同 audit ID TOCTOU 另有回归；另注入两个 active draft 验证失败
  关闭。PostgreSQL 16 smoke 通过实际 admin HTTP route → service → 文件读取 → repository 路径建立
  两个 barrier：两个相同请求等待旧 draft 锁后都返回 200 且只有一套 source/draft/audit；随后让
  同一重试等待当前 draft 锁并在释放前于同一毫秒内漂移 source 两个微秒时间字段，断言脱敏 409 且
  副作用计数不变。route pool 使用每进程唯一 `application_name`，waiter 观测不吸收并行 CI 会话。

### ADR-259：live eval v12 分离 provider 计费完成与 SDK step 完成

- 状态：Accepted；当前仅在本地工作树实现，尚未运行获授权的真实 provider v12 suite
- 日期：2026-09-05
- 决策：生产 `streamSalesChat()` 以 `onLanguageModelCallEnd` 作为唯一 provider-call 计费台账；
  `onStepEnd` 只补充完整 step、工具数与 step latency，不再决定一笔 provider 调用是否已经产生
  可见 usage。`onError` 仅记录终态类别并通知私有 observer，不抢先写一次性 completion log；正常
  `onEnd` 或 raw source 的最终排空才结算。这样 provider 先发 error part、随后仍发 finish usage，或
  provider finish 后工具执行中止时，已知 input/output/total 下界仍被保留一次，但 stream/usage/cost
  继续失败关闭。无 provider finish 的错误只记录 attempt，不伪造 completed call、loop step 或 token。
- 报告合同：suite 升级为 `sales-chat-live-v12`，保持 v11 JSON 字段集合，但明确
  `tokenUsage.ledger` 是 completed provider-call rows，`modelObservability.steps` 是实际到达
  `onStepEnd` 的 rows。正常完成时两者对齐；终态 provider call 最多可领先一个 step，反向差异或
  差值大于 1 均无效，且任何差异都不能宣称 usage 完整。v11 归档继续按原来的一一对应语义解析，
  不回填 v12 语义；version-dispatched verifier 覆盖现代 v3–v12。
- 证据边界：当前 `ai-live-eval-latest.json` 仍是实际保存的 v11、零 provider call 初始化失败，
  不改写也不冒充 v12 运行。`STATUS.md` 分别记录 `suiteVersion=sales-chat-live-v12` 与
  `reportVersion=sales-chat-live-v11`；取得明确授权并真实运行之前，不形成 v12 模型质量、成本、缓存
  或延迟证据。合成 v12 fixture 只能用于纯测试，不能覆盖 current latest。
- 验证方式：mock 覆盖 error→finish 100/10/110、无 finish 错误、raw source throw、abort、正常成功、
  provider finish 后 tool abort 与 completion log 幂等；schema 反向构造覆盖 provider rows=steps+1
  放行、provider rows<steps 失败以及差值大于 1 失败。bootstrap receipt 测试独立构造合法的合成 v12
  失败报告，不再把真实 v11 latest 当成当前版本 fixture。

### ADR-260：公开 AI 日准入按最坏 provider-call 单位原子预留

- 状态：Accepted；本地实现与 PGlite 并发测试已通过，真实 PostgreSQL 多实例尚未验证
- 日期：2026-09-05
- 决策：不能由确定性分流直接回答的 `/api/chat` 请求，在模型能力、附件与模型消息校验完成后、
  审计仓储和 provider 之前，以 `estimated-provider-call-v1` 一次预留 5 个应用侧潜在 provider-call
  单位。5 来自公开 route 的 `maxRetries=0` 和最多五步合同；生产必须显式配置 global/client UTC
  日限额，二者均为 5 的倍数且 client 不大于 global。缺失或跨字段关系错误由 model-bound route
  脱敏 503；非法标量由启动时 env Zod 拒绝。确定性 direct response、模型配置失败和附件校验失败
  不预留。
- 原子性与隐私：复用既有 `api_rate_limit_buckets`，每个事务固定先 global、后 client 做条件
  UPSERT；任一桶不足时抛出内部哨兵并回滚整个事务，成功 commit 后即使审计、工具、流或 usage
  失败也不退款。原始 client/IP 与全局常量分别经域分离 SHA-256 后入库，session ID 不参与键，
  公开错误和结构化日志不保存原始身份或数据库异常消息。耗尽返回至下一个 UTC 日界的正整数
  `Retry-After`。
- 理由：只靠每客户小时限流无法给单日最坏 provider 调用数建立应用侧总量上界；按请求计 1 又会
  忽略动态五步工具循环。预留而非事后记账可在进入 provider 前失败关闭，并让并发实例共享同一
  上限。
- 边界：这是 route/database 范围内的保守 attempt 预算，不是 token、成本、供应商账单或 API-key
  硬限额，不覆盖 provider 内部行为、其他消费者或旁路调用；当前也没有 requested-output 预留。
  生产仍必须在 provider 侧设置独立 spend ceiling。真实 PostgreSQL 的多会话锁等待、超时与回滚
  尚待受控环境验证。
- 验证方式：纯函数测试覆盖 UTC 日窗、1–86400 秒重试、配置关系和域分离哈希；route 回归覆盖
  direct response 不预留、模型/附件失败不预留、耗尽在审计前 429、仓储异常脱敏 503、commit 后
  不退款，以及生产缺配置时 direct response 仍为 200。PGlite 并发测试从两个 limiter 实例竞争
  同一 global 桶，只允许限额内的五次预留。

### ADR-261：生产 AI 日准入配置同时进入 host preflight 与 readiness

- 状态：Accepted；本地静态、unit 与部署 fixture 已验证，尚未在真实 VPS 发布
- 日期：2026-09-05
- 决策：受支持的 host release orchestrator 使用目标 release 内、无外部依赖的配置合同，在取得
  lifecycle lock、创建 rollback basis 或写入 host state 之前，从受信 candidate descriptor 校验
  global/client 两项生产日限额存在、为 5–2,000,000,000 的安全整数和 5 的倍数，且 client 不大于
  global；`AI_CHAT_RATE_LIMIT_BACKEND` 缺省时沿用生产默认 `postgres`，显式配置则必须严格等于
  `postgres`。staging 时从同一受指纹约束的 bytes 重验；原子安装后分别以 `O_NOFOLLOW` descriptor
  读取 backup、candidate 与 live，并在每次读取前后比较完整文件 metadata。backup 只绑定
  PostgreSQL identity，candidate 与 live 则必须完整字节相等，再分别重验准入配置。
  `/api/health/ready` 将同一应用运行时配置作为独立 `aiChatAdmission` check，与数据库 check 同时
  返回；任一失败均为 503，并区分 AI-only、database-only 与二者同时失败。liveness 不承担配置
  可用性判断。ADR-264 随后为小时双桶增加并列的 `aiChatRateLimit` check；本 ADR 保留日准入
  合同。activation 与 release verifier 复用同一 dependency-free v1 readiness response
  合同：顶层和 `checks` 字段必须精确，canonical UTC 时间戳必须落在本次请求窗口 ±5 秒内，且
  `Cache-Control` / `Pragma` 必须分别唯一且精确禁止缓存。
- 理由：只在 model-bound `/api/chat` 内校验会让缺配置 release 通过数据库-only readiness，再在
  首个真实模型请求才暴露 503；只校验 candidate 而不读回又无法证明实际安装 bytes 仍满足合同。
  preflight 阻止受支持发布路径进入状态变更，readiness 则覆盖进程实际读取的环境并阻止
  activation、release verifier 与 synthetic canary 把候选误报为 ready。
- 边界：校验错误只输出类别，不输出环境值。旧 live/backup 可以缺少新字段，以允许首个迁移发布
  保留可回滚性；它仍必须与 candidate/live 保持相同 PostgreSQL `DATABASE_URL`。readiness 不预留
  日预算、不调用模型，也不验证可选 `AI_COST_PROFILE_JSON`；成本 profile 无效或过期仍只使成本
  估算失败关闭为 `null`。Linux handoff 的 `.invalid` 数据库 URL 与准入数值仅闭合离线静态合同，
  不是数据库连接证据。
- 验证方式：dependency-free 合同表驱动覆盖缺失、非整数、非 5 倍数、溢出、client > global 与
  显式非 PostgreSQL backend，并把只读合同 metadata 与应用侧每请求单位和计数上限精确对齐；
  动态 orchestrator fixture 证明非法 candidate 在 lock/basis/begin/state/install/controller/rollback
  零调用时失败，文件 fixture 覆盖 candidate/live 字节漂移及三个 descriptor 的读取中 metadata
  改写。route 测试
  覆盖 AI-only/database-only/combined 503 分类，strict health schema、activation/verifier、canary、
  Playwright 生产 fixture 与 Linux handoff fixture 均要求显式 `aiChatAdmission` 状态或配置；共享
  readiness 合同另覆盖未知字段、缺失或陈旧时间戳与可缓存响应。ADR-264 的对应 fixture 在同一
  exact 合同中增加 `aiChatRateLimit`，不改变本 ADR 的日准入验证结论。

### ADR-262：限流桶回收退出请求事务并采用有界跳锁批次

- 状态：Accepted；cleanup 决策继续有效；小时高基数残余风险自 2026-09-05 由 ADR-264 取代并关闭，
  本段保留为历史；真实 PostgreSQL 多会话仍待验证
- 日期：2026-09-05
- 决策：小时限流的请求事务只设置本地 timeout，并原子 UPSERT 当前窗口所需的
  `(scope, key_hash, window_start)` 桶；删除过期行不再作为返回 allow/deny 的前置步骤。成功的
  PostgreSQL 判定只通知模块级共享 scheduler：每个 Node 进程最多一个 cleanup in flight，启动
  间隔不少于 60 秒，调用方不 await。cleanup 在独立事务内以 PostgreSQL
  `statement_timestamp()` 为时间来源，只选择到期后又经过 10 分钟 grace 的候选，按
  `expires_at / scope / key_hash / window_start` 稳定升序，固定最多 500 行，并用
  `FOR UPDATE SKIP LOCKED` 避开已被并发事务持有的行；删除通过复合主键精确连接。维护沿用
  1.5 秒 lock、2.5 秒 statement 和 5 秒 idle-in-transaction timeout，失败仅记录固定消息与
  `getErrorCode()` 类型，不能修改或拒绝已经算出的请求判定。
- 理由：原实现每次小时检查都在同一事务中执行跨 scope 的无界
  `DELETE WHERE expires_at <= app_now`。在整点/UTC 日界或高基数 client 下，一条语句可能同时
  删除小时桶和日准入桶；若超过 statement timeout，整批回滚，随后每个请求重复相同工作且永远
  到不了当前桶 UPSERT。并发删除还会等待仍在结算的旧窗口行。现有 `expires_at` 索引可以定位
  候选，但不能限制锁、WAL、dead tuple 或单次删除量；把 retention 从正确性热路径拆开后，旧窗口
  由主键中的 `window_start` 自然隔离。
- grace 与边界：10 分钟大于当前 120 秒 Chat response lease、公共数据库 statement deadline 和
  限流仓储自身期限，用于降低跨窗口在途操作碰撞，不是永久排队、节点时钟异常或失联 driver 的
  形式化证明。scheduler 是每进程而非全局 leader；进程退出可能丢失一次 fire-and-forget 维护，
  后续请求会再次尝试。历史上本层只有 per-client 配额，没有 global-hourly distinct-key 上限；
  持续分布式高基数增长可能超过每进程每分钟 500 行的回收能力。该残余风险已于 2026-09-05 由
  ADR-264 的 global 小时入口准入关闭：成功请求与由其创建的 client 桶现在都有每窗全局上界。
  本 ADR 的 bounded retention 语义仍继续有效，且不因新增入口上限变成流量防护或吞吐证明。
- 验证方式：Repository 单测锁定请求事务只有 timeout + 当前窗口的准入 UPSERT、没有 cleanup；
  ADR-264 扩展后这里是 global/client 两个条件 UPSERT。cleanup SQL 编译后继续
  检查数据库时钟、grace、固定 LIMIT、稳定顺序和 `SKIP LOCKED`；scheduler 单测用两个 limiter
  证明 single-flight、60 秒频率、不等待 pending cleanup，以及含伪造数据库 URL 的失败只输出错误
  类型。PGlite 插入超过一批的过期行、grace 内行和当前行，证明第一轮只删最旧 500 行、第二轮
  收完余量且后两类保留。PGlite 不实现真实多会话锁竞争；PG16 的 locked-row skip、日界并发和
  大 backlog 吞吐仍须在受控 CI/生产影子环境验证。

### ADR-263：七类模型投影统一为 v3，并把投影失败与完整工具卡解耦（v4 补充见下）

- 状态：Accepted；本地 strict schema、真实 SDK loop mock 与完整工具卡回归已通过
- 日期：2026-09-05
- 决策：七类只读 ToolResult 都通过 AI SDK `toModelOutput` 生成
  `sales-chat-model-tool-output-v3` strict、确定性模型侧投影；应用侧仍先完成原始 ToolResult 的
  server/evidence schema 校验、真实结果审计，再把同一完整结果原样交给 SSE/UI。投影转换失败
  只向 SDK 模型历史写入固定、无原 payload 的 non-JSON error marker，不把已经验证成功的完整
  ToolResult 改写为 canonical error，也不把投影版本暴露给浏览器。
- 上下文边界：单个 v3 投影不得超过 48,000 UTF-8 bytes；每个 provider step 最多 8 个结果且
  合计不超过 96,000 bytes；当前 turn 的全部 step 合计不超过 128,000 bytes。每次 `stopWhen`
  都从 SDK 当前 turn 的完整 step response 重算并只计模型实际收到的 JSON projection；任一
  non-JSON、非 strict v3、未知工具、畸形 step、单结果或聚合超限都会不可逆锁存失败状态，在
  下一次 provider 调用前停止。边界随后丢弃该 turn 的模型文字，保留完整工具卡，输出固定本地化
  证据缺口，并以 `MODEL_TOOL_OUTPUT_BUDGET_EXCEEDED` 和稳定的 `model_output_budget` 类别记录，
  不保存被拒绝 payload。
- 投影内容：knowledge 保留完整 untrusted wrapper 与检索 query；country profile 只包含请求主题；
  product-fit 保留供应期、商业准备度、负面 check/reason、法规与认证；regulation/market comparison
  保留完整限值、定义和方法版本；score/brief 保留可从 typed digest 与运行时权重重放的确定性
  分数、缺口、建议 ID 和规则。所有投影都携带 strict query、状态、时间、citation/source closure，
  但不携带下载路径、原文件名、embedding/排序分值或未请求国家主题。字节门是 JSON UTF-8 上限，
  不是 tokenizer、账单或 provider 账户配额证明。
- 时间一致性：同一 completion 只读取一次 UTC timestamp，并同时用其日期选择成本 profile、用其
  完整 instant 写入 strict `ai.completion` 日志，避免 UTC 日界或时钟回拨令一个已估算结果在日志
  schema 处失配。测试用流式成本 profile 使用稳定有效期；过期行为仍由显式 reference-date 单测证明。
- 理由：应用完整证据与模型上下文是两个不同边界。为压缩模型输入而改写用户可见成功结果会让
  UI、审计与真实 service 结果失真；只限制单结果又无法约束一次并行工具 step 或多步循环的累计
  prompt。v3 在不截断证据的前提下把任一不可证明投影停在下一 provider 之前，同时保留用户可核验
  的原始工具事实。
- 验证方式：七工具表驱动测试逐个解析 strict v3、比较原结果未变并校验负面事实/来源闭包；大小
  测试以精确 UTF-8 字节构造单 step 与跨 step 边界，并证明第九个结果、non-JSON 和畸形 history
  会锁存。真实 SDK mock 证明 oversized/invalid projection 只启动一次 provider、marker 与模型
  声明不进入公开流、完整成功卡仍出现且审计为 success、observer 收到稳定类别、最终 completion
  为 error。UTC 跨日回归在 profile getter 推进系统时钟后，仍要求成本日期和日志 timestamp 使用
  同一次捕获值。

- 2026-09-07 本地补充：模型投影升级为 `sales-chat-model-tool-output-v4`。真实 Demo 服务响应的
  内存扰动证明：v3 的 score/brief digest 没有 `definition`，清空已带出的单位或方法版本也未被
  其可比性校验拒绝。v4 保留原始口径，并与完整市场比较共用由观测重算的 issue/status；
  缺失必填依据保持 `insufficient_data`，不贡献市场潜力分，但保留观测/引用及其他有效维度。
  这是需要显式版本升级的模型摘要合同变化，七类投影均拒绝 v3 标记；上述 v3 决策保留为历史。
  原 48,000 / 96,000 / 128,000 UTF-8 byte 上限、评分公式与权重不变；没有截断口径、提高预算、
  改写 18 个 live-eval 案例期望或旧模型报告。此补充不增加 ADR、依赖、数据库 schema 或资料。

### ADR-264：公开 Chat 小时准入采用 global → client 原子双桶

- 状态：Accepted；本地实现、unit、route 与 PGlite 测试已接线，真实 PostgreSQL 多连接 smoke
  已纳入 required CI，但当前工作区尚无该远端执行回执，也尚未发布到真实 VPS
- 日期：2026-09-05
- 决策与配置：`/api/chat` 继续在解析请求体前执行小时准入，但固定窗口现在同时约束 global 与
  client。窗口按 epoch 对齐且严格为一小时。`AI_CHAT_RATE_LIMIT_GLOBAL_PER_HOUR` 可选，空值或
  缺省时采用兼容性上限 10000；它与 `AI_CHAT_RATE_LIMIT_PER_HOUR` 都必须是 1–10000 的整数，且
  client 不得大于 global。生产强制 PostgreSQL backend，受控生产示例显式写出 global/client
  `300/30`，不把兼容性缺省值解释为容量建议。开发、测试和离线 Demo 可使用同语义的内存实现。
- 原子性与隐私：生产复用现有 `api_rate_limit_buckets`，不修改 schema。每个请求在同一数据库
  事务内以固定 global → client 顺序做条件 UPSERT；只有现有 `request_count < limit` 才能更新。
  global 已满时在触碰 client 行前抛出内部哨兵；client 已满时同一异常回滚此前暂增的 global，
  因此拒绝不会提交 `limit + 1`、孤立 global 增量或仅刷新 `updated_at`。准入一旦 commit，即使
  后续 body、配置、审计、工具或 provider 失败也不退款。client 原始 IP/identity 不入库，只保存
  SHA-256 摘要；global 使用独立 scope 和固定、域分离的摘要。所有实例通过同一 PostgreSQL 表
  共享上限，耗尽返回到下一固定小时边界的正整数 `Retry-After`。
- 理由：原 per-client-only 小时配额能限制单个键，却不能限制攻击者或高基数真实流量不断制造
  新键；请求计数和 client 桶行因而都没有应用侧全局上界。global 桶先行让每窗成功请求总量和
  能创建的 client 桶数量同时有界，并以固定锁序避免 global/client 竞争产生顺序反转。
- retention 与容量边界：ADR-262 的异步 cleanup 保持不变且只负责 retention。每进程至多每 60 秒
  启动一次、每批最多删除 500 行，失败不能改变已经完成的 allow/deny。按最大 global=10000 将
  新小时 client 桶均匀摊到一小时，约为 167 行/分钟；若同一批请求全部 model-bound 且 client
  均不同，独立的 UTC 日准入 client scope 还可能再增加约 167 行/分钟，合计约 334 行/分钟，仍低于
  单进程 500 行/分钟的名义批次能力。显式 300/hour 生产示例对应两类 client scope 合计约
  10 行/分钟。该算术不证明 cleanup 能按分钟完成，也不证明真实 PostgreSQL 的锁等待、WAL、
  autovacuum 或 backlog 清零能力。global 桶也不是 DDoS、
  网络连接、provider 账单或 token 成本硬上限；拒绝洪泛、整点突发、cleanup 停摆和数据库故障
  仍由并发门、代理、监控与失败关闭共同处理。窗口键由应用实例时钟计算，多主机必须维持时间
  同步；显著漂移时，真实整点附近可能暂时分散到相邻两个窗口。小时请求准入与 ADR-260 的
  model-bound UTC 日 provider-call 单位预算是两层独立边界。
- 发布合同：release 内无外部依赖的 runtime validator 使用与应用相同的缺省值、范围、关系和
  production PostgreSQL backend 约束，在 host preflight、staging 与 candidate/live readback 失败
  关闭。`/api/health/ready` 将其作为独立 `aiChatRateLimit` check，与 `aiChatAdmission` 和 database
  并列；该检查只验证配置，不消费小时配额。activation、release verifier 与 synthetic canary 的
  exact readiness 合同要求三项都为 `ok`。这些是本地发布门接线，不是已经部署或已完成生产读回
  的声明。
- 验证方式：配置表驱动覆盖缺省 global、上下界、非整数和 client > global；内存实现证明 global
  与 client 原子计数；Repository SQL/PGlite 覆盖不同 client 共同耗尽 global、global 满不创建
  client、client 满回滚 global，以及成功计数从不超过限额；route 回归证明跨 client 的确定性直答
  也受 global 小时门约束。部署合同、readiness schema 和 canary fixture 分别锁定 300/30 生产示例、
  独立 check 与非法 candidate 的 state-mutation 前拒绝。required `postgres-migrations` job 还运行
  `db:smoke:rate-limit-concurrency`：它只接受显式 opt-in 的 loopback `diesel_ci`，先证明 monitor
  与四个 repository pool 的五个 `pg_backend_pid()` 均不同，再分别以 16 个不同 client 竞争
  global=6、12 个相同 client 竞争 client=3/global=12，并精确读回 global/client 行后删除本次
  128-bit nonce 隔离的四个 scope。该接线本身不是本次工作区已经取得真实 PostgreSQL 通过结果的
  声明，也不覆盖 cleanup `SKIP LOCKED`、极端热点吞吐或生产 autovacuum。

### ADR-265：CI package script 由 portfolio verifier 直接绑定 canonical 展开

- 状态：Accepted；本地实现与表驱动 mutation 测试已完成，尚未声称远端 CI 执行证据
- 日期：2026-09-05
- 决策：`portfolio:verify` 直接读取并 strict parse 根 `package.json`，要求它是带单个末尾换行的
  canonical 两空格 JSON，固定 `packageManager=pnpm@11.9.0`，并精确绑定 merge-blocking CI job
  直接或通过 Playwright web server 间接调用的每个 package-script 展开。所有受管脚本同时禁止
  `pre<name>` 与 `post<name>` lifecycle companion。`package.json` 的其他合法字段和非 CI 脚本仍可正常演进。
- 理由：workflow job-body 合同只能绑定 `pnpm <script-name>` 这一层；如果不独立核对
  package-script，同名脚本仍可被替换为 `true`、追加 `|| true` 或缩小关键测试范围，使 workflow
  文本和 job digest 保持不变却失去证据产出能力。验证器自身直接调用 assertion，不通过可被改弱的
  package alias 启动这项检查。
- 失败关闭：输入有 2 MiB 上限，NUL/CR、非法 JSON、重复 key 造成的非 canonical 字节、
  package-manager 漂移、受管命令字节漂移和 lifecycle companion 均拒绝。表驱动回归逐一将每个
  受管脚本替换为 `true` 或追加 `|| true`，另覆盖 app coverage、deployment contract 与 Playwright
  范围收缩，并要求全部失败。
- 边界：这是 repository 内自检，仍然把能够同时改写 verifier、测试和 workflow 的 code review /
  protected-branch 流程作为启动信任根；它不是签名或远程 attestation，也不把本地通过写成已获得远程
  run 或分支保护证据。

### ADR-266：作品截图先完成私有候选集，再以可回滚三文件发布替代原地覆盖

- 状态：Accepted；本地 helper 与故障注入单测已完成，尚未把它描述为崩溃一致的文件系统事务
- 日期：2026-09-05
- 决策：`portfolio:capture-screenshots` 必须先独占工作区根部的私有单写者目录锁，再在
  `public/portfolio` 同一文件系统内创建权限固定为 `0700` 的受控临时目录；两张 JPEG 和 canonical
  manifest 全部只写入其中。锁目录为 `0700`，唯一 owner 文件为 `0600` canonical JSON，绑定随机
  token、PID、host、platform 和取得时间；锁存在、结构异常、owner 活跃或无法验证时一律不启动
  Demo。只有显式 `--recover-stale-lock` 才能回收同 host/platform 且 PID 连续两次确认为不存在的
  owner；任何 unresolved staging、`public`/`portfolio` 缺失、symlink 或越界物理父目录都会保留锁并要求
  人工检查，不能以年龄推断 stale。
- 子进程绑定：capture 为本次 child 生成不可猜 UUID nonce 并通过专用环境变量交给它；readiness
  必须先返回同一 nonce，再通过应用 `/api/health/ready`。从 `spawn` 返回起就监听 `error`/`exit`，
  所以固定端口上的旧健康服务不能冒充本次 child，child 在 ready 前退出也会立即失败。停服必须得到
  nonce-bound acknowledgement、观察到该 child 的无 signal、code 0 退出，并确认该 nonce endpoint
  已消失；预先退出、非零退出、只杀掉 wrapper 或无法证明退出均不算成功。
- 响应与退出证明补强：identity / shutdown JSON 在读取流时按实际字节限制为 4 KiB，声明长度
  只能提前拒绝超限，不能替代累计字节检查；共用请求的绝对 abort signal，并独立中断不配合的
  body reader。严格 UTF-8 与 JSON 解码失败只输出固定错误，超限/取消会请求流清理但不等待
  不配合的 cancel promise。所有本机探针禁止跟随 redirect，未消费的 HTTP 响应主动取消 body。
  clean child exit 后，仅明确的连接拒绝、404/410 或通过 strict schema 的不同 nonce 才证明本次
  endpoint 不在；timeout、其他网络错误、其他 HTTP 错误及畸形/超限 identity 均为无法证明，
  不允许发布。此处是一次观测边界，不声称未知或恶意后代进程已全部收口。
- 发布与清理：Demo 服务必须在任何正式路径变更前成功停止；随后候选 manifest 使用工作区源码闭包
  和显式 candidate asset root 完整验证。发布前逐字节备份已有的两张 JPEG 与 manifest（也记录原本
  不存在的目标），并拒绝 symlink、非普通文件和越界候选；发布顺序固定为两张资产后 manifest。
  任一 rename 或发布后 manifest 复核失败，按相反顺序恢复全部已尝试目标；恢复完整时删除 staging，
  恢复不完整时同时保留 staging 与 lock 并以聚合错误失败关闭。捕获、停服和清理多重失败完整保留
  error tree。若三文件已经发布且复核成功，之后 staging cleanup 或 lock release 失败则返回带
  `publicationCommitted`/`stagingPreserved` 状态的 committed-but-cleanup-failed 错误；公开新集合不做
  stale rollback，错误文字只陈述实际已证明的 staging 状态与 lock 恢复位置。
- 理由：旧流程每张截图直接覆盖公开路径，并在 manifest 写入和验证后才进入 server shutdown；
  第二张截图、manifest 验证或停服失败都可能破坏上一份完整证据，甚至出现命令退出失败但公开资产
  已改变。候选集隔离使所有捕获和停服错误保持正式三文件逐字节不变；备份回滚则关闭第二次 rename
  已失败时仅第一张图被替换的部分发布状态。
- 边界：普通文件系统没有跨三个路径的单次原子 rename；这是对进程捕获到的错误进行旧字节回滚，
  不是 crash-atomic 或 reader-atomic 事务。成功发布期间，并发 verifier 可能短暂观察到旧 manifest
  配合已替换资产，但会因 hash/manifest 不一致而失败关闭；调用方只能在命令成功返回后把三文件
  视为新集合。进程被 `SIGKILL`、主机掉电、磁盘/fsync 故障仍可能留下不一致，回滚本身失败时则
  特意保留同盘 staging 与锁供人工恢复。nonce 是本机 capture identity binding，不是对同账户恶意
  进程的认证边界；同 UID 主动竞态和 crash 后的自动回滚仍不在承诺内。发布 helper 只管理固定截图
  路径，不扩展为通用写入或任意路径事务。
- 验证方式：纯文件系统/进程 fixture 不启动浏览器，覆盖成功发布及 `0700` staging、私有锁与第二
  writer 排除、显式 stale recovery 双 PID proof、unresolved staging 和 symlink 父目录拒绝、旧端口
  服务 nonce 不匹配、child spawn error 与 pre-ready/nonzero exit、第二张截图失败、候选 manifest 验证失败、server
  stop 失败、捕获/停服/cleanup 三重失败、第二个资产发布失败、原目标不存在的反向恢复、发布后复核
  失败、不完整 rollback 保留恢复材料、committed cleanup 与 lock-release 两种状态、目标 symlink 和
  候选路径逃逸。所有可恢复的 pre-commit 失败要求旧集合逐字节一致，成功路径要求 verifier 读到新
  manifest、三文件全部为新字节且 staging 与 lock 均已清理。

### ADR-267：Playwright 证据捕获只使用已验证 pnpm 与窄环境

- 状态：Accepted；本地实现和表驱动环境/可执行身份测试已完成；安装状态与隐式修复边界由
  ADR-271 扩展
- 日期：2026-09-05
- 决策：`portfolio:capture-playwright-evidence` 复用 Vitest capture 的 pnpm 解析边界：只接受继承
  `PATH` 中第一个可执行候选，解析掉 symlink 后要求它是普通可执行文件，并由物理 package root
  的稳定 `package.json` 精确证明 `pnpm@11.9.0`、声明的 bin 与实际 entrypoint 相同。随后在私有
  `0700` tool directory 中只暴露已验证的 Node/pnpm 链接；外层每个 pnpm run 由已验证 Node 直接
  执行已验证 entrypoint，不再按继承 PATH 查找。Playwright 启动的 `pnpm demo`、`pnpm demo:fde`、
  `pnpm start` 与两个 `pnpm exec` web server 继续使用配置内 canonical 命令，但其 PATH 只含该
  私有 tool directory、`/usr/bin` 与 `/bin`，所以同样解析到该 pnpm。tool directory 不再由
  `os.tmpdir()` 选择；capture 先把固定 `/tmp` 解析为 physical root，再在其中原子创建随机、权限为
  `0700` 的目录，因此继承的 `TMPDIR` / `TMP` / `TEMP` 不能选择 executable boundary。
- 单写：四个 Playwright run、其间 production build 与最终 evidence persistence 全部由 Git common
  metadata 内的单一 private capture lock 包围。锁不进入 worktree/source fingerprint；每次 run/build/
  persist 前后及 release 前都重新核对 lock directory/owner descriptor 的 inode、权限、稳定 metadata
  与 canonical owner bytes。已有锁无论可证明 active、stale 或无法核验都失败关闭并原样保留，必须由
  operator 查看错误中物理路径后显式人工恢复；capture 不根据 PID 猜测后自动删除。run、tool cleanup
  与 lock release 同时失败时保留所有 cause。
- 环境：所有 capture child 只得到操作系统账户数据库给出的 physical `HOME`、私有 physical
  `TMPDIR`、上述 PATH、固定 UTF-8 locale、UTC、无颜色标志和 evidence marker。`NODE_ENV` 保持
  未设置，让 canonical Next dev/build 命令选择各自正常模式。npm 的 user/global config 显式指向
  private tool directory 内权限为 `0600` 的不同空文件；pnpm 11 的 global YAML/auth config 再由
  private `XDG_CONFIG_HOME` 隔离。`NPM_CONFIG_IGNORE_PNPMFILE=true` 保留为 npm-compatible 明确策略，
  并用 pnpm 11 实际解析的 `PNPM_CONFIG_IGNORE_PNPMFILE=true`、`PNPM_CONFIG_SCRIPT_SHELL=/bin/sh`
  与 `PNPM_CONFIG_SHELL_EMULATOR=false` 固定嵌套命令行为。账户 HOME 因而只供 Playwright 查找浏览器
  cache，不再让用户级 package-manager config 注入行为。继承的 `HOME` / `TMPDIR`、
  `NODE_OPTIONS` / `NODE_PATH` / loader/tsx controls、`PLAYWRIGHT_*` / `PWTEST_*` / `PWDEBUG`、
  `PNPM_HOME` / `PNPM_CONFIG_*` / `NPM_CONFIG_*`，以及 AI、数据库、身份和 Demo 应用配置均不进入
  子环境；各
  webServer 只在此 allowlist 上叠加版本化 Playwright config 中明确写出的 fixture 值。
- 工作区输入：根目录 `.npmrc` 与 `.pnpmfile.cjs` 必须缺失；每个受管操作前后只以固定两次 bounded
  `lstat` 验证路径不存在，不读取内容或把潜在 secret 加入 hash。两个 pathspec 仍加入 Playwright
  source inventory，使提交或未跟踪变更可观测；一旦存在则在启动后续 child 前失败。Next dev/build
  通过 exact `__NEXT_PROCESSED_ENV=true` 禁止本地 `.env*` 注入，这依赖当前精确锁定的
  `next@16.2.12` 内部 processed-env 语义；fixture 直接调用同版本 `@next/env`，证明有 sentinel 时
  `.env.local` marker 不进入进程、移除 sentinel 的 control 则会加载 marker。capture 本身既不枚举、
  读取也不 fingerprint `.env*` 内容。
- 理由：直接 `spawnSync("pnpm")` 加完整 `process.env` 会让调用者 PATH 前缀替换 runner，或用
  Node preload、Playwright base URL/debug/transform 和生产 AI/DB 配置改变被测进程；即使最终
  receipt 结构合法，也不能证明运行的是仓库声明的本地矩阵。验证 executable identity、固定搜索
  路径和环境 allowlist 将这些输入变成失败关闭或版本化配置。
- 边界：这是本地进程启动边界，不是 pnpm 包签名、Node/浏览器供应链 attestation 或后代进程
  containment。操作系统账户 HOME 仍是浏览器二进制 cache 的信任边界；仓库内 package scripts、
  Playwright configs 与 node_modules 仍由 source fingerprint、lockfile、安装策略和 code review
  约束。`__NEXT_PROCESSED_ENV` 是被 pinned dependency fixture 锁定的内部开关，不是 Next 的稳定公开
  API；升级 Next 必须让该 fixture 重新证明行为或换成受支持机制。固定 `/tmp` 是当前 macOS/Linux
  capture contract，不声称支持没有 `/tmp` 的平台。私有 TMPDIR 在 capture 完成时随 tool directory
  清理；进程崩溃会保留 Git metadata 锁供人工判断，且无法证明后代退出或抵御同 UID 主动竞态。
- 验证方式：表驱动测试注入恶意 HOME/TMPDIR、Node/tsx、Playwright/PWTEST/PWDEBUG、pnpm/npm、
  AI 与数据库变量，要求它们被删除或替换；另逐项核对 canonical HOME/PATH/TMPDIR 和 exact
  allowlist、两份空 npmrc、private XDG config、有效 pnpm option readback，并证明 private PATH 中
  node/pnpm 链接指回已验证 entrypoint。PATH 头部的错误版本和同版本 package-name 冒充者都必须在
  任何 Playwright child 启动前失败。锁 fixture 覆盖第二 writer、stale、畸形 owner、operation 前后
  workspace mutation、ownership mutation 与三重 cleanup failure；Next fixture 和恶意全局 TMPDIR
  fixture 分别锁定 env-file 禁载与 physical `/tmp` 选择。

### ADR-268：deployment contracts 保持单次完整覆盖并增加逐例进度与超时余量

- 状态：Accepted；本地 CI 接线与静态合同测试已完成，尚无此版本的远端 runner 回执
- 日期：2026-09-05
- 决策：`test:deploy:contracts` 仍由一次 Vitest 调用精确选中
  `tests/deploy-scripts.test.ts`、`tests/release-publication-controller.test.ts` 和
  `tests/host-release-orchestrator.test.ts`，只在命令末尾增加
  `--reporter=verbose --slowTestThreshold=0`。`deploy-contracts` job 的硬超时从 30 分钟提高到
  45 分钟；它与 `quality` 仍为并列 job，不新增 shard 或 suite 并发参数，Required gate 与 coverage
  分区不变。
- 理由：当前本地 deployment-contract 基线约 24 分钟，已接近原 30 分钟 job 上限，且 CI
  还需要 checkout 和 frozen install，runner 抖动可能让真实回归在报出具体慢例前直接被硬终止。
  verbose reporter 和零 slow-test threshold 让长时间 Bash/子进程合同逐例显示进度与耗时；45 分钟只提供
  超时余量，不声称或实现提速。
- 失败关闭与覆盖：三个测试文件、单次 `vitest run` 和有限超时均保留；没有
  `--pass-with-no-tests`、`--grep`、retry、shard 或新的 worker 并发参数。portfolio verifier 精确绑定新
  package-script 字节和 `deploy-contracts` 完整 job digest；删除 reporter 参数、缩小测试选择或恢复旧超时都会
  失败关闭。
- 边界：约 24 分钟只是当前本地观察，不是 GitHub-hosted runner SLO；45 分钟也不证明 suite
  必定完成。verbose 日志是运行进度，不是独立签名证据。本次按范围不运行长时间 deployment
  suite，真实耗时和完成性仍需该 exact workflow 的远程或受控完整执行。
- 验证方式：package 合同测试固定三文件与两个可观测性参数；workflow 合同固定 45 分钟、完整
  history、单一 test step 与新 job digest，并以降回 30 分钟的 mutation 证明失败关闭。

### ADR-269：普通作品集验证以首读 bytes 和末尾复读关闭混合时点输入

- 状态：Accepted
- 日期：2026-09-05
- 决策：`portfolio:verify` 为普通模式和 release 模式共同建立进程内 input ledger。所有直接读取的
  作品证据和叙述输入在首次消费时以有界、非 symlink 普通文件方式稳定读取，并记录原始 bytes 以及
  device、inode、mode、size、mtime、ctime；`.github/workflows` 与 `docs/evals/archive` 还记录完整
  directory inventory，并把其中受验证文件逐字节纳入 ledger。截图 manifest 解析后，两张固定 JPEG
  和每项声明的 source file 同样先进入 ledger，才执行既有 hash、尺寸与源码指纹校验。live-eval、
  release readiness 和 Vitest source state 校验完成后，verifier 在任何成功输出或 capture-lock
  release 前执行两轮有界复读；任一 bytes、身份、目录成员、symlink/type、消失或同字节替换漂移都
  失败关闭。既有 release 模式两次 HEAD/index/worktree readiness 与 Vitest evidence 末尾复核不变。
- 理由：原实现会在开头读取 STATUS、报告、README、workflow 和截图 manifest，却到较晚时点才保存
  全仓 Vitest source state。并发写入如果恰好发生在这两者之间，语义校验可能使用旧 bytes，而末尾
  repository comparison 将新 bytes 当成稳定基线；普通模式因而可能成功接受一个从未作为整体被
  校验的混合快照。把首读本身变成 ledger 起点，再于成功边界逐字节复核，可让这种漂移确定失败。
- 边界：普通文件系统无法给数百个路径提供一次原子快照；两轮复读缩小并检测扫描期间漂移，但不是
  文件锁、crash-atomic transaction、reader-atomic publication 或 hostile writer containment。
  具有相同文件权限的非协作进程仍能在最后一次比较返回后写入；代码审查、受保护分支和 release
  模式的 commit 绑定继续承担发布信任根。ledger 的 32 MiB 单文件默认上限与 256 MiB 总上限是本地
  verifier 的资源边界，不替代各 artifact 更窄的 schema/hash 上限。
- 验证方式：独立 filesystem fixture 覆盖无漂移成功、显式 barrier 暂停期间内容变更、文件消失、
  symlink/目录替换、mode 漂移、同 bytes 原子替换、目录新增成员，并静态约束主 verifier 在成功释放
  capture lock 前调用最终 barrier。既有 screenshot、live-eval、Playwright、CI 和 release-readiness
  测试继续覆盖 ledger 外层的语义合同。

### ADR-270：CI 在首次 pnpm/setup-node 前关闭仓库安装期代码执行

- 状态：Accepted；本地 guard、workflow contract 与故障注入单测已接线，尚无此版本的远端 runner
  回执，也不预断言禁用 lifecycle 后所有平台原生包均可用
- 日期：2026-09-05
- 决策：`quality`、deployment contracts、PostgreSQL、三套 Playwright、dependency audit 和 Linux
  release handoff 八个 job 都在 checkout 后、任何 pnpm action、setup-node 或仓库 Node 代码前运行同一
  短 guard step。该 step 先用固定 `/usr/bin/test` 拒绝 guard symlink，再由固定
  `/usr/bin/sha256sum -c` 核对 `scripts/ci/verify-install-boundary.py` 的 literal SHA-256，最后用
  `/usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/python3 -I -S` 执行。step 清空 shell loader 与 Python
  注入变量；完整 step、脚本路径/hash、顺序和八个 job body 都由 portfolio workflow contract 精确
  绑定，`portfolio:verify` 还通过 input ledger 读取并复核 guard 自身 bytes。
- 输入边界：无依赖 guard 用 `O_NOFOLLOW` 稳定读取单 hard-link、非 group/world-writable、有界的
  `package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml` 与 `.nvmrc`。根 manifest 必须是 strict
  UTF-8、无 duplicate key 的 canonical 两空格 JSON，且固定 `packageManager=pnpm@11.9.0`；任何
  `preinstall`、`install`、`postinstall`、`prepublish`、`preprepare`、`prepare`、`postprepare` 或
  `pnpm:devPreinstall` 都失败关闭。repository `.npmrc` 与 `.pnpmfile.cjs` 一律禁止；workspace YAML
  以 reviewed SHA-256 绑定，防止用 `scriptShell`、`shellEmulator` 或其他 pnpm 执行配置绕过后续脚本。
  `.nvmrc` 精确固定为 22.22.3。reviewed workspace hash 同时绑定
  `verifyDepsBeforeRun: false`，使普通 script 不触发 pnpm 的隐式安装/修复。pnpm 11.9.0 的 CLI
  已确认支持两个禁用参数；七个普通 workflow
  install 均固定为 `pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile`。
- 理由：原 package 合同只禁止受管 CI script 的 `pre<name>`/`post<name>` companion，无法阻止根
  `preinstall` 在 portfolio verifier 启动前改写 `~/.npmrc`、node_modules 或 verifier；即使 audit
  job 已使用 `--ignore-scripts`，`.pnpmfile.cjs` 仍可在 install 时执行。把检查移到 checkout 后第一
  个本地执行点，并把实际 install 同时关闭 lifecycle 与 pnpmfile，才能让晚到的 repository verifier
  不再承担不可实现的启动信任。
- 原生依赖与残余边界：普通 jobs 不执行任何 dependency lifecycle，也不增加 `rebuild`。当前锁文件
  的平台可选二进制应由正常 resolution 提供，但本地静态核对不是 GitHub-hosted runner 的可用性
  证明；缺失会由既有 test/build 明确失败。Linux release handoff 为复现生产 build，仍会进入
  `build-release.sh` 的 production install；它只允许 reviewed workspace `allowBuilds` 中固定的
  `esbuild`、`sharp`、`unrs-resolver` lifecycle，这是仍然存在的第三方代码执行边界，不等于依赖签名
  或 provenance attestation。未来若普通 job 确需 native rebuild，必须新增精确 package/version/
  command 合同，不得恢复任意 install scripts。
- 验证方式：表驱动测试逐 job 删除/改名 guard、漂移 literal hash、分别删除两个 install flag，并
  对八个根 install lifecycle 做 canonical manifest mutation。真实 Python fixture 覆盖 canonical
  成功、八种 lifecycle、`.npmrc`、`.pnpmfile.cjs`、workspace execution config 漂移与 symlink
  package manifest；guard source 单独做成功 hash 与单字节漂移测试。job digest 和 Playwright step
  inventory 同步纳入新 step。

### ADR-271：Playwright 与 Vitest 证据捕获绑定预安装 pnpm 状态并禁止隐式修复

- 状态：Accepted；本地实现、故障注入与聚焦回归已完成；浏览器与 Vitest canonical artifact
  必须始终由 verifier 以当前源码指纹自证，任何后续源码变更都要求重新捕获
- 日期：2026-09-05
- 事件与决策：旧 Playwright 捕获在隔离的空 pnpm 配置中仍继承 pnpm 11
  `verifyDepsBeforeRun=install` 缺省行为；当 sandbox 与主机解析到不同 store 时，pnpm 会在执行
  package script 前静默 relink 共享 `node_modules`。本次未观察到 resolution/lockfile 漂移，但该
  写入已破坏“证据采集期间依赖保持不变”的前提。工作区现固定
  `verifyDepsBeforeRun: false`；Playwright 与 Vitest 的每个受管 pnpm 命令还显式固定
  `offline=true`、`verify-deps-before-run=false`、关闭 experimental package map，并把从已验证
  `.modules.yaml` 取得的精确、已版本化物理 `v11` store 路径作为 `store-dir` 参数。依赖缺失或不匹配
  必须失败，由操作者显式执行 reviewed `pnpm install` 修复，采集命令不再自行修复。
- 进程输入：Vitest 与 Playwright 一样使用私有 `0700` HOME/TMP/XDG 目录、两份空 `0600`
  user/global npm config、精确 PATH 和环境 allowlist；repository `.npmrc` / `.pnpmfile.cjs` 在 runner、
  list 与 persistence 边界必须持续缺失。Vitest production tool/report/inventory 父目录固定为解析后的
  physical `/tmp`，继承 `TMPDIR` 不能选择可执行或报告边界。`vitest.config.ts` 固定 `envDir: false`，
  所以被 Git ignore 的 `.env*` 不能由 Vite 在启动后重新注入未 fingerprint 的变量。
- 安装状态闭包：共享 helper 以 `O_NOFOLLOW`/descriptor metadata 两遍稳定读取
  `node_modules/.modules.yaml`、`.pnpm-workspace-state-v1.json`、`.pnpm/lock.yaml` 与根
  `pnpm-lock.yaml`；要求两份 lock 字节一致、`pnpm@11.9.0`、`.pnpm` virtual store，以及规范化、
  物理绝对且以 `v11` 结尾的 store。它还对完整 `node_modules` 做两遍 metadata-only closure，绑定
  每个相对路径的类型、device/inode、mode、link count、uid/gid、size、mtime/ctime，以及 symlink
  的受限相对 target。控制文件必须与 closure 中同路径、同 inode/metadata 的普通文件交叉一致，
  `node_modules` 根 identity 必须贯穿两遍；目录项以增量 iterator 在载入/排序前执行 250,000 项和
  64 MiB 累计路径上限，控制文件 open 同时要求 `O_NOFOLLOW|O_NONBLOCK`。Playwright 在每套 run、production build 与 persistence 前后复核；Vitest
  list/test、runner 返回、persistence precommit 与 post-persistence 同样复核。Vitest list/test
  另用 `--no-cache`，避免正常执行写入 `node_modules/.vite` 使闭包漂移。
- 失败关闭与验证：受管命令永远用已验证 Node 直接执行已验证 pnpm entrypoint，并把 store 参数置于
  实际 pnpm argv；表驱动测试固定完整 argv、环境和四个控制文件，分别注入 lock、manifest、目录、
  symlink、普通文件 metadata 与 runner 期间 workspace-state 漂移。操作失败且安装状态同时漂移时，
  两个 cause 都保留；外层 runner 只收到不可变的 verified store path 字符串，不接触可改写的
  Buffer/array baseline。发布前漂移不替换旧 artifact 并正常释放锁；发布后漂移则保留已经提交的
  candidate、capture lock、hard-link guard 与临时证据目录，直到操作者核对或恢复，不虚构回滚成功。
- 边界：metadata closure 不 hash package 文件内容，也不递归 hash 或签名 pnpm store；它用于检测
  install/relink/cache mutation，不是包内容真实性、provenance 或供应链签名 attestation。
  `offline=true` 只约束 pnpm resolution，不代表任意测试子进程都无法联网。私有配置与
  `envDir: false` 也不证明操作系统环境或 runner binary 的供应链真实性。普通文件系统仍无法阻止
  最终复核返回后的同 UID 非协作写入，也不能把多文件 publication 变为 crash-atomic transaction；
  Node 缺少 descriptor-relative `openat` walk，因此主动 A/B 子目录交换的完整防护仍需要外部可信
  互斥；现有 root/control-file 交叉绑定只缩小该窗口。lockfile 字节一致本身也不证明 store 中的包可信。

### ADR-272：Vitest 私有临时层与部署安全夹具显式绑定 POSIX 身份

- 状态：Accepted；聚焦捕获回归、原失败成功路径、两条祖先权限失败关闭回归，以及窄环境下完整
  deployment suite `583 passed / 4 skipped / 0 failed` 已通过；全仓 canonical artifact 已重新生成并
  通过，其动态身份和计数以 `STATUS.md` 指针所指 artifact 为准
- 日期：2026-09-05
- 事件：首次无缓存全仓捕获收集到 181 个文件 / 4,763 条测试，但部署成功夹具在窄环境中出现
  31 条失败并被捕获器正确拒绝发布。首错复现显示 `PM2 systemd identity validation failed`；同一用例
  仅在宿主默认 Darwin 用户临时根下通过。根因不是生产校验，而是 fixture 暗中继承宿主文件系统：
  macOS shared `/private/tmp` 为新目录分配当前 UID、`wheel` GID，且外部祖先为 `1777`；原 fixture
  一面把 shell `stat` ownership 模拟成 `root:root`，一面保留宿主 mode，并让 Node 的直接 `lstat`
  看到非预期 GID，因此“成功”结果取决于环境 `TMPDIR`。
- 决策：证据捕获继续只使用解析后的 fixed `/tmp`，不继承或信任 `TMPDIR`。创建 tool root、HOME、
  TMP、XDG 与空 npm config 后，捕获器显式 `chown` 为当前 POSIX UID/GID、固定 mode，并在命令启动前
  再验证 identity；无法取得稳定 POSIX 身份或不能规范 ownership 时失败关闭。部署 fixture 在创建
  自身 root 后同样固定模拟 UID/GID，使所有后代具有确定身份；fake `stat` 只把 fixture root 的严格
  外部祖先模拟为 production-like `root:root:0755`，root 本身和所有后代继续读取真实 mode，因而不会
  掩盖 fragment、unit root 或 runtime object 的权限漂移。
- 安全回归：新增受控 `untrusted-mode-path`，将一个严格外部祖先模拟为 `0777`；`PUBLISH_COMMITTED`
  与 `PUBLISH_FINALIZED` 两种状态都必须保留 marker 并失败关闭。生产
  `rollback_validate_trusted_root_path_chain` 与 PM2/systemd identity 逻辑没有放宽或测试后门，临时
  调试 trace 在验证前已完全移除。
- 边界：path-based 创建与 `chown` 不能抵御同 UID 非协作进程在最终检查后的写入；这是 ADR-271
  已声明的本地文件系统边界。fixture 的外部祖先是确定性生产模拟，不证明实际主机目录 ownership；
  真实发布仍必须由主机校验读取真实路径。固定 `/tmp` 只隔离环境选择，不使 shared tmp 成为供应链
  信任根，私有 `0700`、身份复核、capture lock 和受保护进程组共同承担本地边界。

## 4. 暂不决策

以下问题在 MVP 出现明确需求或数据证据前不提前设计：

- 微服务拆分与事件总线。
- PostGIS 空间分析。
- 多 Agent 协作。
- 完整双时态数据库。
- 向量索引类型和参数。
- 自动化法规抽取审批后台。
- CRM、邮件和日历集成。

### ADR-273：收口回答主题、移除漏洞依赖链并减少就绪探针冷启动开销

- 状态：Accepted；候选实现，不等同于已部署或网络故障永久消除。
- 日期：2026-10-04
- AI：生产循环只在证据门进入 `final_answer` 后，为已执行的法规比较/销售简报加入双语
  任务提示，明确正文业务主题并保留未知、Demo、来源、免责声明；prompt 升至 v9。
  不注入事实或得分，不改变 v25 的 18 个 case、期望、门槛和评分器，历史失败不回写。
  基线定向诊断复现了“本次简报”省略明确业务名称的合同失败；模型非确定性仍须以新的
  完整真实评估验收，而不是仅凭定向诊断宣布通过。
- 依赖：移除未使用的 shadcn CLI/CSS，给 Next ESLint 唯一 glob 调用增加可审查的
  tinyglobby 兼容补丁与精确依赖扩展，保持所有 lint 规则；移除 braces 临时例外，
  更新 brace-expansion 官方安全补丁。详见 DEPENDENCY_SECURITY.md，不冒充官方 Next 补丁。
- 就绪：VPS 只读诊断观察到冷连接比已建立连接慢，旧探针还有事务多次网络往返；
  试验性 2 秒连接超时出现失败，未采用。改为最多一条复用连接、跳过不需要的类型发现、
  一次 SELECT 1 与连接级短 statement timeout。保留 3 秒公开失败边界、single-flight、
  失败冷却和每次真实查询。连接保持最多 30 分钟，不干扰业务池；此变更不证明互联网
  冷连接、数据库故障或业务池饱和已消失，也不将数据库探针冒充整个业务路径的 SLO。
- 验证：任务提示证据门正反例、就绪 SQL/连接配置/错误/超时/复用、真实 Next lint 路径
  回归、完整审计及既有质量门；部署和新的完整模型结果以 STATUS 的实际记录为准。

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
