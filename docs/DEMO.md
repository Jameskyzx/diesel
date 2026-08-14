# 三分钟面试演示脚本

这份脚本用于 FDE 面试或招聘方自行验收。它优先展示用户问题、证据边界和工程取舍，
不把时间花在逐页介绍功能上。

## 演示前准备（不计入三分钟）

- 托管版：预先打开 [首页](https://jamesky.site)、[中国 100 kW 深链](https://jamesky.site/countries/CHN?applicationScope=non-road&powerKw=100&asOf=2026-08-13)
  和 [AI 工作区](https://jamesky.site/chat?countryIso3=CHN&applicationScope=non-road&powerKw=100&asOf=2026-08-13)。
- 零配置本地版：提前执行 `pnpm install` 和 `pnpm demo`，并打开
  <http://127.0.0.1:3000>。安装与启动时间不属于演示计时。

## 0:00–0:30：先讲业务问题

打开 <https://jamesky.site>：

> 海外销售需要同时判断国家法规、适用日期、用途/功率、产品认证和市场口径。
> 这个项目把结论与来源放进同一工作流；法规和评分由确定性代码产生，LLM 只调用
> 只读工具并解释结果。

指出首页覆盖状态和公开站只读边界。目录/来源覆盖不等于每个国家、每个 scope 都有
法规限值；页面会显式显示 no-data。

## 0:30–1:20：走黄金流程

1. 打开预备好的 CHN 深链，说明 ISO3 与查询参数可分享。
2. 在国家详情区分当前 effective、未来 adopted 和最近核验时间；指出
   proposed 被公开 DTO 排除，不会被当成当前要求。
3. 选择 non-road、100 kW 和评估日期，运行产品适配。
4. 指出结果的法规、功率区间、认证和引用；缺失认证时保持 `unknown`，不把未知当通过。

面试官追问边界时，强调所有日期使用 `[from,to)`，proposed 永不进入当前合规结果，
机会评分由版本化应用代码计算。

## 1:20–2:20：展示 AI 证据门

进入对话页，提问：

```text
比较 CHN 和 BRA 的 non-road 100 kW 法规。
```

先展示结构化工具卡片和 citation，再展示模型解释。说明服务端会缓冲首轮模型文本；
只要工具失败、返回 no-data 或证据不足，就丢弃可能肯定的模型文本，改为可执行的
缺口说明。模型没有任意 SQL、写入或联网能力。

随后选择一个无详细法规的国家，展示系统明确返回缺口，而不是补写一个听起来合理的
排放标准。

## 2:20–3:00：证明可复现

切换到预先启动的 <http://127.0.0.1:3000/chat>，点击快捷问题或提问：

```text
CHN 目前有哪些有效法规？
```

解释 `pnpm demo` 无需 `.env.local`、PostgreSQL、Docker 或 AI Key，但仍执行真实 Migration、
Repository、service、Zod 工具、引用与证据门。数据和回答均显式标记 Demo；它验证的是
工程链路，不代表生产数据、外部模型质量或真实产品认证。Demo 的 `.invalid`
来源只显示为“虚构证据，无外部链接”，不伪装成可访问的政府来源。

## 建议准备的追问

- 为什么是模块化单体，而不是微服务？
- 如何避免 LLM 编造法规、来源或分数？
- 法规状态、有效期和核验时间为什么分开？
- `fit / not_fit / unknown` 如何处理缺失认证？
- 公开作品站与业务生产的安全边界有什么不同？
- 如果下一周加入客户数据，先补身份、对象存储、备份还是模型？为什么？

当前数量与尚未完成范围见 [STATUS.md](STATUS.md)，历史决策见
[DECISIONS.md](DECISIONS.md)，运行配置边界见 [DEPLOYMENT.md](DEPLOYMENT.md)。
