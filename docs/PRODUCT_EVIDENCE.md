# 真实产品与认证证据接收清单

## 1. 状态与用途

### 虚构 Demo 目录层（2026-10-17 起）

本项目是 Demo，不与任何真实制造商关联。此前导入的真实厂商目录已移除，替换为
`src/data/products/demo-engine-catalog.json`：13 个系列、24 个虚构型号（全部以
`DEMO-` 开头），覆盖卡车、客车、工程机械、农业机械、发电机组和船用。每个型号的
`declaredCitationCodes` 是虚构规格书声称满足的法规编号。

`/products` 的目标市场选型使用 `catalog-fit-v1`：把声明的法规编号与目标国家、场景、
功率和日期下实际生效的法规记录逐条按字面比对，返回 `declared_match`、
`declaration_gap`、`unknown` 或 `not_fit`。规则不推断跨地区等效，也不把声明升级为
认证（`certificationVerified=false`）。法规记录可能是真实来源，产品始终是虚构的，
因此结果只演示选型流程，不构成可销售结论。

此目录层不写入治理库、不修改 schema、不加入真实产品/认证 publication manifest，
也不进入已核验 `/api/products` 列表。下文的产品/认证验收要求继续约束
**已核验适配证据层**。

- 状态：M3 证据门，2026-08-05 建立；尚无获准发布的真实产品 fixture。
- 目标：一次接收 5–10 个可报价或可认证的具体产品配置，以及能连接到已发布
  法规的认证证据。
- 红线：产品系列营销页不能替代具体配置；排放阶段宣称不能替代证书或政府公开
  记录；缺少认证时结果必须保持 `unknown`。
- 本清单与现有 `productDraftPayloadSchema`、
  `productCertificationDraftPayloadSchema` 对齐，不触发数据库 schema 变更。

## 2. 已核验来源入口

### 2.1 机动车环保信息公开平台（VECC）

公众查询入口：<https://info.vecc.org.cn/ve/index>

- 2017-01-01 后道路车辆按 VIN 查询。
- 2017-07-01 后非道路机械查询需要 17 位机械环保代码、发动机编号后 6 位和
  验证码；页面标注模块处于功能测试期，查询结果仅供参考。
- 当前公开入口不能仅凭发动机系列批量检索认证。

使用条件：产品 owner 必须提供车辆 VIN，或机械环保代码与发动机编号；查询结果
还需保存可追溯的公开编号、查询日期和原始导出/截图。只有能明确连接具体产品配置、
目标法规、scope、功率范围和有效期的记录，才可建立 `product_certification` 草稿。

## 3. 产品配置必填项

公开产品查询采用显式签核 manifest 并默认拒绝：Demo 产品及其来源必须都标记为
`is_demo=true`；真实产品和认证只有在完成本文件的证据验收并加入代码中的公开 manifest 后
才能进入 `/api/products`、产品适配或 AI 工具。产品批准同时绑定实体 ID、来源 ID 和
`specificationVersion`；认证批准绑定实体 ID 与来源 ID，任一发生漂移都会失败关闭。
当前真实产品与认证公开 manifest 均为空；治理库中存在记录不等于获准公开，也不得仅通过
`is_demo=false` 自动发布。

每一行代表具体配置，不接受只写系列名或营销名称。

| 字段 | 规则 |
| --- | --- |
| `modelCode` | 稳定配置代码；治理 API 会转为大写；不得用临时昵称 |
| `name` | 可公开展示的正式名称 |
| `applicationScopes` | 只用 `on-road-truck`、`on-road-bus`、`construction`、`agriculture` 中已确认的值 |
| `powerMinKw` / `powerMaxKw` | kW 半开区间 `[min,max)`；原始单位和换算说明放入 `parameters` |
| `specificationVersion` | 手册、主数据或配置表的版本/日期；不能统一写 `current` |
| `availableFrom` / `availableTo` | 不确定时为 `null`，不得从网页更新时间推断；`availableTo` 非空时必须同时提供更早的 `availableFrom`，区间为 `[from,to)` |
| `parameters` | 只放有来源的差异化参数；核心筛选条件不能长期只放 JSON |
| `dataSourceId` | 指向已通过许可与真实性审核的来源 |
| `verifiedAt` | 实际读回证据的 UTC 时间 |

## 4. 认证证据必填项

| 字段 | 规则 |
| --- | --- |
| `productId` | 必须连接同批或已发布的具体产品配置 |
| `regulationId` | 必须连接数据库中已发布的目标法规，不以自由文本代替 |
| `applicationScope` | 必须与证书适用场景一致；系列跨场景不代表证书跨场景 |
| `certificateNumber` | 有官方编号时必填；没有编号时必须说明可追溯 locator，不能自造 |
| `status` | `pending \| active \| expired \| withdrawn \| unknown`；不由日期或营销文案猜测 |
| `powerMinKw` / `powerMaxKw` | 证书覆盖范围；未知下界为 `null`，不得按负无穷推断覆盖；只有 `powerMinKw` 已知时，`powerMaxKw=null` 才表示开放上界；不得直接复制产品范围 |
| `validFrom` / `validTo` | 业务有效期；上界不包含；未知起点为 `null`，不得按负无穷推断覆盖；`validTo` 非空时必须同时提供更早的 `validFrom`，只有起点已知时空上界才表示开放 |
| `dataSourceId` | 证书、政府公开记录或获准使用的制造商证明 |
| `verifiedAt` | 实际核验时间，不使用产品页发布日期代替 |

## 5. 批次接收模板

产品/销售负责人提交时填写 5–10 行。空白字段表示未提供，不表示“不适用”。

| 行 | 配置代码 | scope | 功率 `[min,max)` kW | 规格版本 | 产品来源/许可 | 证书或公开编号 | 对应法规 | 有效期 | owner/reviewer |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P-01 |  |  |  |  |  |  |  |  |  |
| P-02 |  |  |  |  |  |  |  |  |  |
| P-03 |  |  |  |  |  |  |  |  |  |
| P-04 |  |  |  |  |  |  |  |  |  |
| P-05 |  |  |  |  |  |  |  |  |  |
| P-06 |  |  |  |  |  |  |  |  |  |
| P-07 |  |  |  |  |  |  |  |  |  |
| P-08 |  |  |  |  |  |  |  |  |  |
| P-09 |  |  |  |  |  |  |  |  |  |
| P-10 |  |  |  |  |  |  |  |  |  |

## 6. 发布验收门

一批产品事实只有同时满足以下条件才进入 Draft → Reviewed → Published：

1. 每个配置都有可公开使用的来源和明确 `specificationVersion`。
2. 功率、scope 和生命周期字段能逐项回到来源，不靠模型补全。
3. 每条认证能连接具体产品、已发布法规和来源；没有认证的产品明确保持
   `unknown`，不发布乐观适配结论。
4. owner 与 reviewer 分离；核验日期和许可结论写入审计理由。
5. 至少覆盖两个 application scopes，并包含功率上下界、认证有效期和缺证
   `unknown` 边界案例。
6. 发布后在目标开发库运行 product-fit Repository 验收，核对 `fit`、
   `not_fit`、`unknown` 与来源追溯；营销评分和 `partial_fit` 仍等待 ADR-021。

## 7. 当前阻塞

- 需要产品 owner 提供 5–10 个具体配置及可公开展示的主数据/手册许可。
- 道路产品需要 VIN 或等价政府公开记录；非道路产品需要机械环保代码与发动机
  编号，才能从 VECC 形成可追溯证据。
- ADR-019 尚未批准认证 owner、复核周期和 stale 阈值。
- ADR-021 尚未批准真实配置粒度、`partial_fit` 和规则批准人。

在上述输入到位前，现有 Demo 产品继续显式标记 `is_demo = true`，不得改名伪装为
任何真实厂商的产品。
