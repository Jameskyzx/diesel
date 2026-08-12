# 来源清单与验收样例（M1 决策门调研草稿）

- 状态：分批签核（更新于 2026-08-11）；当前批准范围见 `docs/ACCEPTANCE.md`
  #1–#264。已核验条目已转为受控 fixture 并经负责人批准，其余未签核事实仍为
  DRAFT；#166–#198 为本地 accepted 稳定 33 国数据纠错，#199–#208 为十国
  source-currentness 纠错，#209–#243 为七批 35 国 source-currentness 总收口，#244–#247
  为 AUS/PNG/CAN/USA 数值完整性收口，#248–#259 为十二国双源图收口，#260–#261
  为 MLT EU-27 成员图与 CHN GB 20891 完整功率带纠错，#262–#264 为
  ARE 通用日期与 CAN/USA 非道路完整功率带纠错，已随生产 release
  `20260812031745` 发布并完成公开读回；YEM 本轮复核后 no-change。
- 用途：M1“冻结作品数据决策门”的输入 —— 五个深度样板国家（CHN、USA、
  DEU/EU、IND、BRA）在四类动力场景（`on-road-truck` 卡车、`on-road-bus`
  客车、`construction` 工程机械、`agriculture` 农业装备）下的官方公开来源
  清单、许可评估（ADR-018 输入）、确定性验收样例草稿与 stale SLA 建议。
- 红线：未签核法规事实与限值仍为 **DRAFT**，不得写入数据库、不得标记
  `verified`，不得用于销售承诺（TASKS §13.6）。已签核范围和签核记录以
  `docs/ACCEPTANCE.md` 为准。
- 方法：多 Agent 网络调研 + 对抗式来源核验（URL 可达性、官方域名、许可主张、
  scope 映射逐条核验）。每行标注核验状态：`已核验` / `间接核验`（官方页面
  不可自动抓取但经官方镜像/索引确认）/ `未核验`（网络不可达，需可达网络复核）。

## 1. 分国来源清单

> **SUPERSEDED 历史快照边界（2026-08-11）**：本节按逐批调研时间保留历史
> 取证轨迹，部分早期段落的 `no-data`、numeric、来源组合、核验日或“已发布”描述
> 已被后续复核替代，**不得继续作为当前产品事实**。当前 33 国纠错及 45 国
> source-currentness 只以
> [§3.81](#381-2026-08-11-稳定-33-国与数据纠错来源收口本地-accepted待部署)、
> [§3.82](#382-2026-08-11-marken-source-currentness-纠错本地-accepted待部署)、
> [§3.83](#383-2026-08-11-qatkwtomnjor-source-currentness-纠错本地-accepted待部署)、
> [§3.84](#384-2026-08-11-irnirqlbnsyr-source-currentness-纠错本地-accepted待部署)、
> [§3.85](#385-2026-08-11-35-国-source-currentness-规范索引本地-accepted待部署)、
> `docs/ACCEPTANCE.md` #166–#243、ADR-126/127/128/129/130/131 和当前 accepted source
> 边界为准；历史
> 段落仅用于解释证据演进。下列 LAO/LKA/MNG/MMR 的精确来源错误已直接校正，
> 但这不把本节其余历史结论重新提升为当前事实。

### 1.1 中国（CHN）

责任机构：生态环境部（MEE，标准归口与实施公告）、市场监管总局/国家标准委
（SAMR/SAC，GB 标准发布）、openstd.samr.gov.cn（强制性国标全文公开系统）。

| scope | 正式文书 | 引用 | 状态与关键日期 | 官方 URL | 核验 |
| --- | --- | --- | --- | --- | --- |
| on-road-truck / on-road-bus | 重型柴油车污染物排放限值及测量方法（中国第六阶段） | GB 17691-2018（含 2026 年修改单，替代 GB 17691-2005） | effective / 现行：2019-07-01 实施；城市车辆（含城市客车）2020-07-01；全部重型柴油 2021-07-01；6b 全国强制 2023-07-01（五部门公告 2023 年第 14 号）；修改单 2026-05-01 生效（公告 2026 年第 20 号附件 2） | https://www.mee.gov.cn/ywgz/fgbz/bz/bzwb/dqhjbh/dqydywrwpfbz/201807/t20180703_445995.shtml | 已核验 |
| on-road-truck / on-road-bus | 发布 GB 17691-2018 的公告 | 生态环境部公告 2018 年第 14 号 | effective（发布依据） | https://www.mee.gov.cn/xxgk2018/xxgk/xxgk01/201807/t20180703_629590.html | 已核验 |
| on-road-truck / on-road-bus | 国六实施事宜公告（6b 强制时点） | 公告 2023 年第 14 号（五部门联合） | effective：2023-07-01 起 6b 全国强制，以合格证生产日期为准 | https://www.mee.gov.cn/xxgk2018/xxgk/xxgk01/202305/t20230509_1029448.html | 已核验 |
| on-road-truck / on-road-bus | 两项标准修改单公告 | 生态环境部公告 2026 年第 20 号 | effective 2026-05-01；部分条款 2026-07-01 | https://www.mee.gov.cn/xxgk2018/xxgk/xxgk01/202604/t20260430_1150676.html | 已核验 |
| construction / agriculture | 非道路移动机械用柴油机排放限值（中国第三、四阶段）及第 1 号修改单 | GB 20891-2014 + GB 20891-2014/XG1-2020（替代 GB 20891-2007） | effective / 现行：第三阶段自 2016-04-01 全面实施；第四阶段自 2022-12-01 对 ≤560 kW 强制，>560 kW 实施时间“另行公告”并继续国三（截至 2026-08-11 未见后续公告） | https://www.mee.gov.cn/ywgz/fgbz/bz/bzwb/dqhjbh/dqydywrwpfbz/201405/t20140530_276305.shtml | 已核验（完整表与端点见 §3.88） |
| construction / agriculture | 非道路柴油移动机械排放控制技术要求 | HJ 1014-2020 | effective 2020-12-28（配合国四实施） | https://www.mee.gov.cn/ywgz/fgbz/bz/bzwb/dqhjbh/dqydywrwpfbz/202012/t20201231_815684.shtml | 已核验 |

要点：卡车与客车共用 GB 17691-2018（标准适用 M2/M3/N1/N2/N3 及 >3.5 t 的
M1）；工程机械与农业机械共用 GB 20891-2014（MEE 解读明确覆盖工程机械、农业
机械）。GB 20891 当前结构化图保留 `2016-04-01` 至 `2022-12-01` 的国三历史四带；
国四按 P<37、37≤P<56、56≤P<130、130≤P≤560 四带发布，560 kW 闭合在国四，
560.001 kW 进入 >560 kW 国三延续。NRSC 适用于全部发动机，满足 HJ 1014 条件的
变速发动机另适用 NRTC；NH3 25 ppm 仅适用于使用反应剂的发动机，不能发布成无条件行。

许可评估（ADR-018）：openstd 对非采标强制性 GB 提供“在线阅读和下载”，页面
标注“版权所有 侵权必究”，未找到开放许可文本；MEE 网站声明禁止商业性原版
转载。**结论：中国标准全文不得入库/再分发；可入库的是元数据、引用、公告事实
与自行撰写的摘要**，原文以链接引用。

核验缺口：caam.org.cn、cncma.org 仅 HTTP 可达（HTTPS 握手失败，列为次要市场
来源）；kjs.mee.gov.cn 不可达（用 mee.gov.cn 标准详情页替代）；>560 kW 非道路
实施公告需持续监控。

### 1.2 美国（USA）

责任机构：EPA（法规制定与执行）；官方文本渠道为 eCFR（ecfr.gov，每日更新）
与 GovInfo/Federal Register（govinfo.gov、federalregister.gov）。

| scope | 正式文书 | 引用 | 状态与关键日期 | 官方 URL | 核验 |
| --- | --- | --- | --- | --- | --- |
| on-road-truck / on-road-bus | 重型公路发动机准则污染物标准 | 40 CFR 1036.104（Part 1036） | effective：适用于 MY2027+（规则 2023-03-27 生效）；NOx FTP/SET ≤ 0.035 g/hp·hr，PM ≤ 0.005，CO ≤ 6.0；FEL 上限 MY2031 起 0.065→0.050 | https://www.ecfr.gov/current/title-40/chapter-I/subchapter-C/part-1036/subpart-B/section-1036.104 | 已核验 |
| on-road-truck / on-road-bus | 2007+ 重型柴油发动机标准（MY2026 及以前） | 40 CFR 86.007-11（Part 86） | effective：MY2007–2026 仍适用（NOx 0.20 g/bhp·hr，MY2010 起）；MY2027+ 被 1036.104 取代 | https://www.ecfr.gov/current/title-40/chapter-I/subchapter-C/part-86/subpart-A/section-86.007-11 | 间接核验（ecfr.gov 机器人质询拦截自动抓取；官方域可达，scope 与已核验的 1036.104 一致，签字前读回全文） |
| construction / agriculture | 非道路 CI 发动机 Tier 1–4 | 40 CFR Part 1039（§1039.101 等） | effective：Tier 4 MY2008–2015 分阶段完成；当前 variable-speed 代表路径保存 P<8、8≤P<19、19≤P<37、37≤P<56、56≤P<130、130≤P≤560 六个 Table 1 功率带，>560 kW 路径不在本次代表图 | https://www.ecfr.gov/current/title-40/chapter-I/subchapter-U/part-1039/subpart-B/section-1039.101 | 已核验（Table 1 原图与 §1039.505 循环条款，2026-08-11） |
| 全部 | 通用合规条款 | 40 CFR Part 1068 | effective（2008-10-08 重述，持续适用） | https://www.ecfr.gov/current/title-40/chapter-I/subchapter-C/part-1068 | 间接核验（同上） |
| on-road | “Clean Trucks Plan”最终规则（准则污染物 + MY2027 体系） | 88 FR 4296（2023-01-24；docket EPA-HQ-OAR-2019-0055） | effective 2023-03-27 | https://www.govinfo.gov/content/pkg/FR-2023-01-24/html/2022-27957.htm | 已核验 |
| construction / agriculture | 非道路 Tier 4 基础最终规则 | 69 FR 38958（2004-06-29） | effective（已完全实施） | https://www.govinfo.gov/content/pkg/FR-2004-06-29/html/04-11293.htm | 已核验 |
| on-road | 重型车 GHG Phase 3 最终规则 | 89 FR 29440（2024-04-22，doc 2024-06809） | **已废止**：先经 2025-08-01 重新审查提案（doc 2025-14572），2026-04-20 起被 91 FR 7686 撤销（§1036.108 已不存在于 2026-07-27 eCFR 快照） | https://www.govinfo.gov/content/pkg/FR-2024-04-22/html/2024-06809.htm | 已核验（FR API 交叉确认） |
| on-road | GHG 危害认定与机动车 GHG 标准撤销 | 91 FR 7686（2026-02-18） | effective 2026-04-20：此后联邦层面无重型 GHG 排放标准 | https://www.govinfo.gov/content/pkg/FR-2026-02-18/html/2026-03157.htm | 已核验 |
| 全部 | MY2027+ 重型公路发动机修订（征求意见） | 91 FR 43154（2026-07-14） | **proposed，未生效**；意见期至 2026-08-29 | https://www.federalregister.gov/documents/2026/07/14/2026-14112/ | 已核验 |
| 全部 | 许可依据 | 17 U.S.C. § 105（联邦政府作品不受版权保护） | effective | https://www.govinfo.gov/content/pkg/USCODE-2023-title17/html/USCODE-2023-title17-chap1-sec105.htm | 已核验 |

许可评估（ADR-018）：CFR 与 Federal Register 文本为公共领域（17 U.S.C. § 105，
已核验 govinfo.gov/about 声明原文），**可入库、分块、再分发**，GPO 要求注明
来源；可用 eCFR versioner API 做机器访问。注意：§ 105 只覆盖联邦作品 ——
州级材料（如 CARB，ww2.arb.ca.gov）不适用公共领域主张，若引用须单独评估
许可；§1039.101 Table 1 为嵌入图片，机器可读性受限。

红线样例：91 FR 43154 是 proposed，任何时候不得作为 effective 返回；89 FR
29440（GHG Phase 3）自 2026-04-20 起为 superseded，历史日期查询可返回但必须
标废止。

### 1.3 欧盟（以德国为落地点，DEU）

责任机构：欧盟层面 EUR-Lex/CELLAR（欧盟法规）；德国落地为 KBA（型式批准）
与 BMUV，国家实施法令经 gesetze-im-internet.de 发布。欧盟法规直接适用，限值
无需国内转化。

| scope | 正式文书 | 引用 | 状态与关键日期 | 官方 URL | 核验 |
| --- | --- | --- | --- | --- | --- |
| on-road-truck / on-road-bus | Euro VI 型式批准框架 | Regulation (EC) No 595/2009（CELEX 32009R0595） | in force；新车型 2012-12-31、新注册 2013-12-31 起 Euro VI；将被 Euro 7 自适用日废止；**限值表已读回**（附件 I 经 582/2011 附件 XV 替换，OJ L 167，CELLAR 官方文本：CI 机 WHTC → CO 4000 / THC 160 / NOx 460 / NH3 10 / PM 10 mg/kWh、PN 6.0×10¹¹ #/kWh；WHSC → CO 1500 / THC 130 / NOx 400 / NH3 10 / PM 10、PN 8.0×10¹¹） | https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32009R0595 | 已核验（2026-07-30 经 CELLAR 官方文本读回限值；EUR-Lex 前端 WAF 拦截，内容取自 publications.europa.eu） |
| on-road-truck / on-road-bus | Euro VI 实施措施（限值在 Annex II） | Commission Regulation (EU) No 582/2011（CELEX 32011R0582） | in force；最新合并版 02011R0582-20260312 | https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32011R0582 | 间接核验（CELLAR） |
| construction / agriculture | 非道路移动机械 Stage V | Regulation (EU) 2016/1628（CELEX 32016R1628） | in force；Stage V 新机型 2019-01-01、投放市场 2020-12-31 起（<56 kW 另有节点）；合并版 02016R1628-20220717；**NRE 限值表已读回**（附件 II 表 II-1，CELLAR 官方文本：130≤P≤560 → CO 3.5 / HC 0.19 / NOx 0.40 / PM 0.015 g/kWh、PN 1×10¹² #/kWh；56≤P<130 → CO 5.0 / HC 0.19 / NOx 0.40 / PM 0.015；19≤P<37 与 37≤P<56 → CO 5.0、HC+NOx ≤ 4.70、PM 0.015；P>560 → CO 3.5 / HC 0.19 / NOx 3.5 / PM 0.045） | https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R1628 | 已核验（2026-07-30 经 CELLAR 官方文本读回限值） |
| on-road | 型式批准与市场监督框架 | Regulation (EU) 2018/858（CELEX 32018R0858） | in force；2020-09-01 起适用 | https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32018R0858 | 间接核验（CELLAR） |
| on-road-truck / on-road-bus | Euro 7 | Regulation (EU) 2024/1257（CELEX 32024R1257） | in force，未来适用：M2/M3/N2/N3 自 **2027-11-29** 起适用并废止 595/2009 | https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1257 | 间接核验（CELLAR） |
| on-road | 582/2011 近期修订 | (EU) 2025/258、(EU) 2026/361 | in force（CELLAR amends 边确认） | https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32026R0361 | 间接核验（CELLAR） |

德国落地：非道路 Stage V 经 28. BImSchV（BGBl. I S. 3125, 2021-07-21）执行；
道路批准经 EG-FGV/KBA。工程机械与农业机械同属 2016/1628，德国无单独的农业
排放法令。

许可评估（ADR-018）：欧盟文件按欧委会法律声明与 Decision 2011/833/EU 采用
**CC BY 4.0**（已核验声明原文），**可入库、分块、再分发**，须署名；合并版
为文档性文本，只有 Official Journal 为权威文本，入库须标注。EUR-Lex 对自动
抓取有 WAF 质询 —— 机器访问建议走 CELLAR/ELI API（data.europa.eu）。

#### EU-27 成员国覆盖扩展（2026-08-06）

欧盟官方 `EU countries` 页面读回 `Pages (27)`，分页结果为 20 + 7 个成员国，
并逐国给出加入年份。基于 Regulation (EC) No 595/2009 与 Regulation (EU)
2016/1628 在成员国直接适用的法律性质，现有已签核 Euro VI / Stage V 法规和限值
可以通过同一 EU 辖区成员关系复用，无需复制 27 份法规记录。

| 加入日期 | ISO3 成员国 |
| --- | --- |
| 1958-01-01 | BEL、FRA、DEU、ITA、LUX、NLD |
| 1973-01-01 | DNK、IRL |
| 1981-01-01 | GRC |
| 1986-01-01 | ESP、PRT |
| 1995-01-01 | AUT、FIN、SWE |
| 2004-05-01 | CYP、CZE、EST、HUN、LVA、LTU、MLT、POL、SVK、SVN |
| 2007-01-01 | BGR、ROU |
| 2013-07-01 | HRV |

- 官方来源：<https://european-union.europa.eu/principles-countries-history/eu-countries_en>
  （2026-08-06 读回；第二页 `?page=1` 显示 Poland–Sweden）。
- 数据语义：成员关系有效期参与历史查询；例如 HRV 在 2013-07-01 前不得经 EU
  辖区返回 Euro VI。
- 历史目录边界：2026-08-06 批次的 175 国地图目录不包含 MLT，因此当时只为
  EU-26 创建成员关系和 `covered` 状态；该历史事实不回写。
- 当前目录边界：MLT 已加入国家目录，并使用同一固定 Natural Earth 修订的 1:10m
  几何补齐地图、搜索与分享 URL。自 `2004-05-01` 生效的成员关系使官方 EU-27
  全部可寻址，并复用既有 2 regulations / 80 limits / 3 sources；不复制共享法规。
- 覆盖边界：本批不包含 GBR，也不把 NOR/ISL/LIE 的 EEA 纳入关系；这些法域
  必须分别核对脱欧或 EEA Joint Committee 的采纳文书。TUR 已在 §1.9 单独建模，
  不复用 EU 成员关系。
- 许可：欧盟门户内容沿用欧委会文件再利用规则；只存成员国、加入日期、URL 和
  自撰摘要，不复制页面说明文字。

### 1.4 印度（IND）

责任机构：MoRTH（Central Motor Vehicles Rules、道路 BS VI、CEV 与 TREM）；
Gazette of India（G.S.R. 公报发布）。BIS/AIS 测试程序只作为法规引用，本批不复制
付费标准全文。

| scope | 正式文书 | 引用 | 状态与关键日期 | 官方 URL | 核验 |
| --- | --- | --- | --- | --- | --- |
| on-road-truck / on-road-bus | BS VI 重型 M/N 类车辆质量排放标准 | G.S.R. 889(E)，2016-09-16 | effective：GVW > 3,500 kg 且 2020-04-01 起制造。CI 发动机 WHSC：CO 1500 / THC 130 / NOx 400 / PM 10 mg/kWh、NH3 10 ppm、PN 8×10¹¹ #/kWh；WHTC：CO 4000 / THC 160 / NOx 460 / PM 10、NH3 10、PN 6×10¹¹ | https://morth.nic.in/backend/old_files/notifications_document/Notification_no_G_S_R_889_E_dated_16_09_2016_regarding_Mass_Emission_Standards_for_BS_VI.pdf | 已核验（官方 PDF p.29） |
| construction | CEV-IV | G.S.R. 598(E)，Rule 115A(10) Table 1 | effective：2021-04-01 至 2024-04-01；37≤P<56 为 CO 5.0 / HC+NOx 4.7 / PM 0.025，56≤P<130 为 CO 5.0 / HC 0.19 / NOx 0.4 / PM 0.025，130≤P<560 为 3.5 / 0.19 / 0.4 / 0.025 g/kWh | https://morth.nic.in/backend/old_files/notifications_document/GSR%20598%20(E)%20dated%2030%20September%202020%20Seperate%20emission%20norms%20for%20agriculture%20tractors%20and%20CEV.pdf | 已核验（官方 PDF p.12） |
| construction | CEV-V | G.S.R. 598(E)，Rule 115A(10) Table 2 | effective：2024-04-01；全功率带。130≤P<560 为 CO 3.5 / HC 0.19 / NOx 0.4 / PM 0.015 g/kWh、PN 1×10¹² #/kWh；P≥560 为 CO 3.5 / HC 0.19 / NOx 3.5 / PM 0.045，无 PN | 同上 | 已核验（官方 PDF p.12） |
| agriculture | TREM-IV | G.S.R. 598(E) Table 1，经 G.S.R. 413(E)、850(E) 延期 | effective：最终自 2023-01-01，至 2026-04-01；仅覆盖 37≤P<560，技术限值与 CEV-IV Table 1 相同 | https://morth.nic.in/backend/old_files/notifications_document/12-GSR%20850(E)%2024%20November%202022%20TREM%20extension%201st%20jan23.pdf | 已核验（G.S.R. 850(E) p.2） |
| agriculture | TREM-V | G.S.R. 598(E) Table 2，经 G.S.R. 141(E) 延至 2026-04-01 | effective：2026-04-01；全功率带，技术限值与 CEV-V Table 2 相同 | https://egazette.gov.in/ | 间接核验（G.S.R. 141(E) 日期由 MoRTH 2026 官方说明引用；限值表已直接核验） |
| agriculture | 拟按功率带重新安排 TREM 实施日 | Draft G.S.R. 151(E)，2026-02-27 | proposed：拟使用 2026-10-01、2028-04-01、2032-04-01 等日期；截至 2026-08-07 的 MoRTH 公报目录未发现最终规则，不得作为 effective | https://morth.nic.in/backend/documents/uploaded/Combined%20GSR%20and%20Explanatory%20Note.pdf | 已核验为草案 |

建模要点：卡车与客车共用 G.S.R. 889(E)；CEV 与 TREM 都位于 CMVR Rule 115A，
但 scope、阶段和日期分别建模。功率带统一使用 `[min,max)`；P=560 进入 `P≥560`
的 Stage V 行。G.S.R. 151(E) 只有 `proposedOn`，不设置有效日期或限值。

许可评估（ADR-018）：MoRTH 与 eGazette 页面未确认可覆盖本项目的开放再利用许可；
本批只保存公报元数据、结构化事实、自撰摘要与官方链接，不复制法规或 BIS/AIS 全文。

### 1.5 巴西（BRA）

责任机构：CONAMA（规范决议）、IBAMA（PROCONVE 执行与 LCVM 发证）、
INMETRO（合格评定）、Imprensa Nacional（DOU 公报，in.gov.br）。

| scope | 正式文书 | 引用 | 状态与关键日期 | 官方 URL | 核验 |
| --- | --- | --- | --- | --- | --- |
| on-road-truck / on-road-bus | PROCONVE P-7（重型道路车辆，ESC/ELR/ETC） | Resolução CONAMA nº 403/2008（2008-11-11；DOU 2008-11-12） | effective：2012-01-01 至 P8 全面切换前。附件 I 柴油机限值已读回：ESC/ELR NOx 2 / HC 0.46 / CO 1.5 / MP 0.02 g/kWh、opacity 0.5 m⁻¹、NH3 25 ppm；ETC NOx 2 / CO 4 / MP 0.03 / NMHC 0.55 g/kWh、NH3 25 ppm | http://www2.mma.gov.br/port/conama/legislacao/CONAMA_RES_CONS_2008_403.pdf | 已核验（2026-08-05；旧 CONAMA 官方法规页 `codlegi=591` 指向该 PDF，live 地址空响应，通过 Wayback 2018-11-01 对同一官方 PDF URL 的存档读回） |
| on-road-truck / on-road-bus | PROCONVE P8（重型道路车辆，采用 UN ECE R49.06 测试体系） | Resolução CONAMA nº 490/2018（2018-11-16；DOU 2018-11-21） | effective：从未取得 LCVM 的新车型自 2022-01-01；其余车辆自 2023-01-01 全面强制。附件表 1 压燃机限值已读回：WHSC CO 1500 / THC 130 / NOx 400 / MP 10 mg/kWh、NH3 10 ppm、NP 8.0×10¹¹ #/kWh；WHTC CO 4000 / THC 160 / NOx 460 / MP 10 mg/kWh、NH3 10 ppm、NP 6.0×10¹¹ #/kWh | https://www.in.gov.br/materia/-/asset_publisher/Kujrw0TZC2Mb/content/id/51058898/do1-2018-11-21-resolucao-n-490-de-16-de-novembro-de-2018-51058604 | 已核验（2026-08-05；联邦公报页面当前传输失败，通过 Wayback 2022-03-03 对同一官方 URL 的存档读回；页面声明不替代认证版） |
| construction / agriculture | PROCONVE MAR-I（非道路农业与工程机械，≥19 kW，ISO 8178-1） | Resolução CONAMA nº 433/2011（2011-07-13；DOU nº 134, 2011-07-14, p.69） | effective：MAR-I 各功率带自 2019-01-01 全面强制；**限值表已读回**（IBAMA《Manual do Proconve/Promot》官方手册，gov.br，p.310 附件 A 表 I：130≤P≤560 → CO 3.5 / HC+NOx 4.0 / MP 0.2；75≤P≤130 → 5.0 / 4.0 / 0.3；37≤P≤75 → 5.0 / 4.7 / 0.4；19≤P≤37 → 5.5 / 7.5 / 0.6 g/kWh） | http://conama.mma.gov.br/?option=com_sisconama&task=arquivo.download&id=635 | 已核验（限值读回自 IBAMA 官方手册 PDF，gov.br 可达；决议正文链接的 CONAMA 门户仍不可达） |
| 全部 | PROCONVE 创立决议 | Resolução CONAMA nº 18/1986 | effective（伞形依据） | http://conama.mma.gov.br/?option=com_sisconama&task=arquivo.download&id=41 | 间接核验 |
| 全部 | 机动车减排法（PROCONVE 法律依据） | Lei nº 8.723/1993 | effective | http://www.planalto.gov.br/ccivil_03/leis/l8723.htm | 已核验 |
| 全部 | 国家环境政策法（授予 CONAMA 规范权） | Lei nº 6.938/1981 | effective | http://www.planalto.gov.br/ccivil_03/leis/l6938.htm | 已核验 |
| on-road | P8 实施程序（OBD、在用符合性等） | IN IBAMA nº 20/2020（经 IN 18/2021 修订；DOU 2020-09-28, p.512） | effective | https://pesquisa.in.gov.br/imprensa/jsp/visualiza/index.jsp?data=28/09/2020&jornal=515&pagina=512 | 间接核验（in.gov.br 本环境不可达；IBAMA 索引列出） |
| construction / agriculture | MAR 机械 LCVM 发证程序 | IN IBAMA nº 6/2015 | effective | http://www.ibama.gov.br/sophia/cnia/legislacao/IBAMA/IN0006-15042015.pdf | 间接核验（托管 PDF 返回 403，WAF） |
| 全部 | IBAMA PROCONVE 计划页 | gov.br/ibama 排放页面 | current | https://www.gov.br/ibama/pt-br/assuntos/emissoes-e-residuos/emissoes/programa-de-controle-de-emissoes-veiculares-proconve | 已核验 |

许可评估（ADR-018）：官方法律行为（决议、IN、法律、公报）依 Lei 9.610/1998
Art. 8º IV 不受版权保护（条文已核验），**可入库与再分发**，须引用；gov.br
门户解释性文字为 CC BY-ND 3.0（termos de uso 已核验），只可引用链接不可原样
再分发。决议 PDF 自带“此文本不替代公报发布文本”声明，入库须保留。

### 1.6 日本（JPN）

责任机构：国土交通省（道路车辆安全基准与型式批准）、环境省（排放政策与
オフロード法）、经济产业省（非道路联合告示）；法令权威文本由 e-Gov 发布。

| scope | 正式文书 | 引用 | 状态与关键日期 | 官方 URL | 核验 |
| --- | --- | --- | --- | --- | --- |
| on-road-truck / on-road-bus | 《道路運送車両の保安基準》第31条（排气污染物性能委任） | 昭和26年運輸省令第67号，第31条 | effective / 现行；第2款明确 CO、HC、NOx、PM、黑烟须符合告示性能基准 | https://elaws.e-gov.go.jp/document?lawid=326M50000800067 | 已核验（2026-08-06，e-Gov API 直接读回第31条） |
| on-road-truck / on-road-bus | 环境省《自動車排出ガス規制の経緯》 | 平成28年（2016年）重型柴油车标准 | effective；WHSC/WHTC 平均限值（官方表括号内）：CO 2.22 / NMHC 0.17 / NOx 0.4 / PM 0.010 g/kWh。2016-10 起按 GVW/车型分阶段，>7.5 t 牵引车 2017-10，3.5<GVW≤7.5 t 2018-10，至 2018-10-01 全部重型车适用 | https://www.env.go.jp/content/900400270.pdf | 已核验（2026-08-06，p.4 表格与注11–13读回） |
| construction / agriculture | 《特定特殊自動車排出ガスの規制等に関する法律》及环境省法规入口 | 平成17年法律第51号（オフロード法） | effective：法律 2006-04-01 施行；仅覆盖非公路特殊车辆 | https://www.env.go.jp/air/car/tokutei_law.html | 已核验（2026-08-06；页面同时链接法律、施行令、施行规则与现行告示） |
| construction / agriculture | 《特定特殊自動車排出ガスの規制等に関して必要な事項を定める告示》 | 平成18年三省告示第1号，平成26年三省告示第1号修正（2014年基准），最终修正令和6年三省告示第4号 | effective / 现行：柴油 19≤P<560 kW；2014年基准按功率带于 2014-10、2015-10、2016-10 生效。现行第2条表：19–37 → 5.0/0.7/4.0/0.03；37–56 → 5.0/0.7/4.0/0.025；56–75、75–130 → 5.0/0.19/0.4/0.02；130–560 → 3.5/0.19/0.4/0.02（CO/NMHC/NOx/PM，g/kWh） | https://www.env.go.jp/content/000398439.pdf | 已核验（2026-08-06，现行告示 p.1–3、附则与环境省 2014 年概要 p.1 读回） |

数据语义：道路标准的历史切换按 GVW 分期，但当前法规查询模型只有功率字段；
因此本批以全部 `GVW>3.5 t` 已覆盖的 2018-10-01 作为统一 `effective_from`，并在
法规摘要中保留 2016-10 起分阶段实施的警告，不把该统一日期解释为首次实施日。
非道路功率带严格使用 `[min,max)`，19 kW 含端点、560 kW 不含端点；工程机械与
农业机械共用同一オフロード法限值。

许可评估：本批只入库官方 URL、法令元数据、逐项读回的结构化事实和自撰摘要，
不复制或再分发环境省解释性 PDF 全文；日本政府网站再利用条款与法令文本版权
排除范围未完成项目级许可复核前，知识库文档入库保持关闭。

### 1.7 韩国（KOR）

责任机构：韩国气候能源环境部（기후에너지환경부）；法令权威文本由国家法令信息
中心（국가법령정보센터）发布。

| scope | 正式文书 | 引用 | 状态与关键日期 | 官方 URL | 核验 |
| --- | --- | --- | --- | --- | --- |
| on-road-truck / on-road-bus | 《대기환경보전법 시행규칙》现行附表 17 第2号아목及备注 5–6 | KOR Annex 17 HD Diesel 2017 | effective：2017-10-01 起；大/超大型柴油客货车同时满足 WHSC/WHTC。WHSC：CO 1.5、NOx 0.40、HC+NOx 0.13、PM 0.01 g/kWh、PN 8×10¹¹ #/kWh；WHTC：CO 4.0、NOx 0.46、HC+NOx 0.16、PM 0.01 g/kWh、PN 6×10¹¹ #/kWh；NH3 10 ppm | https://www.law.go.kr/lsSc.do?section=&menuId=1&subMenuId=15&tabMenuId=81&eventGubun=060101&query=%EB%8C%80%EA%B8%B0%ED%99%98%EA%B2%BD%EB%B3%B4%EC%A0%84%EB%B2%95+%EC%8B%9C%ED%96%89%EA%B7%9C%EC%B9%99 | 已核验（2026-08-06，国家法令信息中心第62条读回） |
| on-road-truck / on-road-bus / construction / agriculture | 《대기환경보전법 시행규칙》附表 17 官方 PDF（2026-06-26 修订） | Annex 17 PDF | current official source；道路、工程机械、农业机械限值均从同一现行 PDF 读回 | https://www.law.go.kr/flDownload.do?gubun=&flSeq=167031783&bylClsCd=110201 | 已核验（2026-08-06，37页 PDF 下载并逐页读回） |
| construction | 附表 17 第4号마목（建設機械 원동기） | KOR Annex 17 Construction 2020 | effective：2020-12-01 起；150 kW（130≤P<560）CO 3.5、HC 0.19、NOx 0.40、PM 0.015 g/kWh、PN 1×10¹² #/kWh、NH3 10 ppm；19–37 与 37–56 kW 带使用 HC+NOx 4.7 | https://www.law.go.kr/flDownload.do?gubun=&flSeq=167031783&bylClsCd=110201 | 已核验（2026-08-06，附表第4节读回） |
| agriculture | 附表 17 第5号라목（農業機械 원동기） | KOR Annex 17 Agriculture 2021 | effective：2021-07-01 起；功率带与工程机械表相同，150 kW 返回 CO 3.5、HC 0.19、NOx 0.40、PM 0.015 g/kWh、PN 1×10¹² #/kWh、NH3 10 ppm | https://www.law.go.kr/flDownload.do?gubun=&flSeq=167031783&bylClsCd=110201 | 已核验（2026-08-06，附表第5节读回） |

数据语义：韩国非道路功率带按 `[min,max)` 存储，附表的 19 kW 含端点、560 kW
不含端点；工程机械与农业机械使用同一张现行附表但分开记录生效日和 scope。
附表备注规定 NH3 限值只在采用尿素喷射型排放控制装置时适用，查询结果保留该
条件，不把它解释为所有发动机的无条件限值。

许可评估：本批只入库韩国国家法令信息中心的官方链接、法规元数据、结构化限值
与自撰摘要，不复制或再分发官方 PDF 全文；项目级政府网站再利用条款仍待单独
复核，知识库全文入库保持关闭。

### 1.8 墨西哥（MEX）

责任机构：环境与自然资源部（SEMARNAT）；法规公告由《联邦官方公报》（Diario
Oficial de la Federación，DOF）发布。

| scope | 正式文书 | 引用 | 状态与关键日期 | 官方 URL | 核验 |
| --- | --- | --- | --- | --- | --- |
| on-road-truck / on-road-bus | 新柴油发动机及 GVW > 3,857 kg 新道路车辆排放标准 | NOM-044-SEMARNAT-2017 Tabla 1B | effective：2025-01-01 起按 B 标准全国可执行；美国 CT/CSE 路径：CO 15.5、NOx 0.20、HCNM 0.14、PM 0.01 g/bhp-hr | https://dof.gob.mx/nota_detalle.php?codigo=5513626&fecha=19/02/2018 | 已核验（2026-08-06，DOF） |
| on-road-truck / on-road-bus | 同上，欧洲/UN-ECE 替代认证路径 | NOM-044-SEMARNAT-2017 Tabla 2B | effective：2025-01-01 起；CEEMAP：CO 1.5、NOx 0.4、HC 0.13、PM 0.01 g/kWh、PN 8×10¹¹ #/kWh、NH3 10 ppm；CETMAP：CO 4.0、NOx 0.46、HC 0.16、PM 0.01 g/kWh、PN 6×10¹¹ #/kWh、NH3 10 ppm | https://dof.gob.mx/nota_detalle.php?codigo=5513626&fecha=19/02/2018 | 已核验（2026-08-06，DOF） |
| on-road-truck / on-road-bus | 标准 AA 过渡期修订 | DOF 2020-11-11、DOF 2021-11-26 | 2021 年修订把 AA 过渡期延至 2024-12-31；本模型从 2025-01-01 起返回 B 标准，避免把过渡路径误标为当前有效标准 | https://dof.gob.mx/nota_detalle.php?codigo=5636495&fecha=26/11/2021 | 已核验（2026-08-06，DOF） |

数据语义：Tabla 1B 与 Tabla 2B 是替代认证路径，不是同时叠加的两组污染物要求；
当前 schema 没有认证路径字段，因此保留两张官方表、测试循环和 measurement basis
说明。NOM-044 明确针对新柴油发动机及 GVW > 3,857 kg 新道路车辆；本批不把道路
标准推断到工程机械或农业机械，两个非道路 scope 返回显式 no-data。

许可评估：本批只入库 DOF 官方 URL、法规元数据、逐项读回的结构化限值和自撰摘要，
不复制 DOF 公告全文；DOF 页面版权/再利用条款尚未完成项目级复核，知识库全文入库
保持关闭。

### 1.9 土耳其（TUR）

责任机构：工业与技术部（Sanayi ve Teknoloji Bakanlığı）负责道路/非道路发动机
型式批准与市场监管；农业与林业部（Tarım ve Orman Bakanlığı）提供农林拖拉机
AB/167/2013 型式批准入口。

| scope | 正式文书 | 引用 | 状态与关键日期 | 官方 URL | 核验 |
| --- | --- | --- | --- | --- | --- |
| on-road-truck / on-road-bus | Euro VI 重型车辆型式批准法规及 2013 修订 | TUR Euro VI HD Diesel（((AT) 595/2009)） | effective：按土耳其官方法规链的合并执行口径建模为 2016-01-01；WHSC CI：CO 1500、THC 130、NOx 400、NH3 10 ppm、PM 10 mg/kWh、PN 8×10¹¹ #/kWh；WHTC CI：CO 4000、THC 160、NOx 460、NH3 10 ppm、PM 10 mg/kWh、PN 6×10¹¹ #/kWh | https://www.resmigazete.gov.tr/eskiler/2013/09/20130925-2.htm | 已核验（2026-08-06，Resmî Gazete 附件 I 读回） |
| construction | 非道路移动机械发动机 Stage V | TUR NRE Stage V 2016/1628/AB | effective：型式批准 2021-10-01；市场投放 2022-10-01；0<P<8 至 P>560 kW 的 NRE 表按官方功率带入库；130≤P<560：CO 3.50、HC 0.19、NOx 0.40、PM 0.015 g/kWh、PN 1×10¹² #/kWh；P>560：CO 3.50、HC 0.19、NOx 3.50、PM 0.045 g/kWh | https://resmigazete.gov.tr/eskiler/2020/09/20200911-3-1.pdf | 已核验（2026-08-06，官方公报正文与附件第 4、8 页读回） |
| agriculture | 农林拖拉机型式批准范围与 NRE 排除条款 | AB/167/2013；2016/1628/AB 第 2 条第 2(b) 款 | 本批 no-data：NRE 公报明确排除 AB/167/2013 定义的农林拖拉机发动机；当前未核验到可直接发布的独立土耳其农业排放限值，不用 NRE 或欧盟文本替代 | https://www.tarimorman.gov.tr/TRGM/tamtest/Menu/98/Tarim-Ve-Orman-Traktorleri-Ab-Tip-Onay-Deneyleri | 已核验范围排除（2026-08-06）；独立农业限值未确认 |

数据语义：道路限值按 `[2016-01-01, ∞)` 生效，2013 公报的首次发布日与执行日不混用；
卡车与客车共用同一法规。NRE 仅写入 `construction`，因为官方第 2 条第 2(b) 款
明确排除 AB/167/2013 农林拖拉机发动机。当前 `power_min_kw` 只有数值上下界，
因此将官方严格 `P > 560` 以 `560.001` 表示，查询 `P=560` 返回 no-data，`P=600`
返回最后一带；这一内部表示必须在展示层保留原文严格边界说明。

许可评估：本批只入库土耳其官方公报 URL、农业与林业部官方入口、法规元数据、结构化
限值与自撰摘要，不复制公报或附件全文；官方站点再利用条款尚未完成项目级复核，知识库
全文入库保持关闭。

### 1.10 澳大利亚（AUS）

责任机构：联邦基础设施、交通、区域发展、通信、体育与艺术部（DITRDCSA）负责澳大利亚
设计规则（ADR）和新道路车辆型式批准；气候变化、能源、环境与水部（DCCEEW）负责
非道路柴油发动机国家排放政策评估。

| scope | 正式文书 | 引用 | 状态与关键日期 | 官方 URL | 核验 |
| --- | --- | --- | --- | --- | --- |
| on-road-truck / on-road-bus | Vehicle Standard (Australian Design Rule 80/03 – Emission Control for Heavy Vehicles) 2006 | ADR 80/03 | effective：官方柴油重型车辆标准汇总表列出 2010-01-01 新车型、2011-01-01 全部新车辆节点；本库因没有新车型维度，以 2010-01-01 起、2024-11-01 止建模历史 Euro V。ESC：CO 1.5、THC 0.46、NOx 2.0、PM 0.02；ETC：CO 4.0、NMHC 0.55、NOx 2.0、PM 0.03 g/kWh | https://www.legislation.gov.au/F2006L04062/latest/text / https://www.infrastructure.gov.au/sites/default/files/documents/Standards_for_Diesel_HDVs.pdf | 已核验（2026-08-06，联邦登记册与官方标准汇总 PDF） |
| on-road-truck / on-road-bus | Vehicle Standard (Australian Design Rule 80/04 – Emission Control for Heavy Vehicles) 2023 | ADR 80/04 | effective：GVM > 3,500 kg 的 M/ N 类重型车辆；新车型 2024-11-01 起、全部车辆 2025-11-01 起；官方问答 Table 1：WHSC NOx 400、PM 10；WHTC NOx 460、PM 10 mg/kWh。规则接受 Euro VI、美国 2013+、日本 2017+ 等效路径 | https://www.legislation.gov.au/F2023L00129/latest/text / https://www.infrastructure.gov.au/infrastructure-transport-vehicles/vehicles/vehicle-safety-environment/questions-and-answers-new-adr-8004 | 已核验（2026-08-06，联邦登记册与官方问答） |
| construction / agriculture | 非道路柴油发动机国家排放评估 | Noxious Emissions from Non-Road Diesel Engines | effective：DCCEEW 2024-01-02 官方页面明确“澳大利亚目前没有控制非道路柴油发动机有害排放的法规”；评估范围明列 tractors、diggers、graders、rollers、generators 等 | https://www.dcceew.gov.au/environment/protection/air-quality/national-clean-air-agreement/evaluation-non-road-diesel-engine-emissions | 已核验（2026-08-06，DCCEEW 官方页面） |

数据语义：ADR 80/04 的道路门槛使用 `GVM > 3,500 kg` 和规则中的 M/ N 类别摘要；当前 schema
没有车辆类别、车型代际或“既有车型继续供应”字段，因此以 2024-11-01 新车型切换日作为
ADR 80/03 → ADR 80/04 的单一日期边界，展示层必须保留 2025-11-01 全部车辆节点警告。
ADR 80/04 本批只写入联邦问答直接列出的 NOx/PM，不从 EU 595/2009 或美国 CFR 补充
澳大利亚未直接读回的其他限值。工程机械和农业装备均返回显式 no-data，不得套用 Tier 4、
Stage V 或 ADR 道路值。

许可评估：澳大利亚联邦登记册、DITRDCSA 与 DCCEEW 页面/文书的再利用条款尚未完成项目级
复核；本批只入库官方 URL、法规元数据、逐项读回的结构化限值和自撰摘要，不复制 PDF 或网页
全文，知识库全文入库保持关闭。

### 1.11 加拿大（CAN）

责任机构：加拿大司法部（Justice Laws Website）发布现行法规文本；环境与气候变化部
（ECCC）负责排放政策与执行。加拿大道路法规通过引用美国联邦 CFR 的机型年标准，非道路
法规通过引用 40 CFR Part 1039 的 Tier 标准，二者分别建模，不跨 application scope 推断。

| scope | 正式文书 | 引用 | 状态与关键日期 | 官方 URL | 核验 |
| --- | --- | --- | --- | --- | --- |
| on-road-truck / on-road-bus | On-Road Vehicle and Engine Emission Regulations | SOR/2003-2，第 16(2) | effective：适用于 2004-01-01 起进口或制造的道路车辆和发动机；柴油重型发动机按对应机型年采用 40 CFR 86.11。当前代表性 2007+ 值：NOx 0.20、PM 0.01 g/hp-hr | https://laws-lois.justice.gc.ca/eng/regulations/SOR-2003-2/index.html | 已核验（2026-08-06，Justice Laws 条文读回） |
| construction / agriculture | Off-road Compression-Ignition (Mobile and Stationary) and Large Spark-Ignition Engine Emission Regulations | SOR/2020-258，第 10(1)(a)、第 79 条 | effective：法规注册/采纳日 2020-12-04 后六个月，即 2021-06-04；移动/固定压燃发动机采用 40 CFR 1039.101。代表性 130≤P≤560 kW Tier 4 四列：CO 3.5、NMHC 0.19、NOx 0.40、PM 0.02 g/kWh | https://laws-lois.justice.gc.ca/eng/regulations/SOR-2020-258/index.html | 已由 #246 / ADR-133 纠正旧日期、端点与完整列（2026-08-11） |

数据语义：SOR/2003-2 的具体限值由其引用的美国 CFR 按机型年决定；本批只写入已读回的
代表性 NOx/PM，不把未在加拿大条文或引用链中直接读回的其他污染物补成加拿大事实。
SOR/2020-258 覆盖移动和固定压燃发动机，本项目仅将已核验的移动发动机 Tier 4 代表性
功率带映射到 `construction` 与 `agriculture`；道路限值不用于非道路查询。第 79 条的
六个月生效规则按 2020-12-04 注册/采纳日计算为 2021-06-04，历史查询必须保留该边界。

许可评估：加拿大司法部法规页面的项目级再利用条款尚未完成复核；本批只入库官方 URL、
法规元数据、结构化限值和自撰摘要，不复制法规全文。引用的美国 CFR 仍由其独立官方来源
和许可策略追溯，不能因加拿大法规引用 CFR 就扩大加拿大来源的再利用结论。

### 1.12 英国（GBR）

责任机构：英国 Vehicle Certification Agency（VCA）负责 GB/UK(NI) 型式批准框架；
GOV.UK 的 NRMM 指南说明新售非道路移动机械必须具备正确发动机型式批准和标识。GB
与北爱尔兰必须分开建模：本批 `GBR` 只表示大不列颠，北爱尔兰继续适用 EU 或 UK(NI)
批准，不把其法规关系写成 EU 成员关系。

| scope | 正式文书 | 引用 | 状态与关键日期 | 官方 URL | 核验 |
| --- | --- | --- | --- | --- | --- |
| on-road-truck / on-road-bus | VCA type approval for motor vehicles and trailers | GB retained framework | 本批 no-data：VCA 页面确认 GB 使用 retained `Regulation (EU) 2018/858` 型式批准框架，但未从英国官方可访问来源读回 retained `595/2009` 的正式条文、执行日或限值；不得以 EU 限值代填英国事实 | https://www.vehicle-certification-agency.gov.uk/vehicle-type-approval/what-is-vehicle-type-approval/type-approval-for-motor-vehicles-and-trailers/ | 已核验范围边界（2026-08-07）；2026-02-01 full type approval 切换日不是排放限值生效日 |
| construction | NRMM rules on type approval and engine markings；VCA NRMM | GB NRMM Stage V | effective：2023-01-01 起 GB 市场要求 provisional GB type approval；VCA 明确 NRMM 发动机须满足 Stage V；本批录入 Stage V 功率带代表性限值 | https://www.gov.uk/government/publications/non-road-mobile-machinery-rules-on-type-approval-and-engine-markings/non-road-mobile-machinery-rules-on-type-approval-and-engine-markings / https://www.vehicle-certification-agency.gov.uk/vehicle-type-approval/what-is-vehicle-type-approval/non-road-mobile-machinery-nrmm/ | 已核验（2026-08-07，GOV.UK/VCA）；规则排除农业和拖拉机发动机 |
| agriculture | Type approval for agricultural vehicles | EU 167/2013 + 2018/985 retained framework | 本批 no-data：VCA 仅核验 GB provisional type approval 及 EU 167/2013、2018/985 适用框架，尚未从英国官方可访问来源读回可发布的农业发动机限值；不得套用 NRMM Stage V | https://www.vehicle-certification-agency.gov.uk/vehicle-type-approval/what-is-vehicle-type-approval/type-approval-for-agricultural-vehicles/ | 已核验范围与边界（2026-08-07）；独立农业限值未确认 |

数据语义：GB jurisdiction 独立于 EU，成员关系自 `2023-01-01` 建立且不设置 EU accession
日期；本批只覆盖 GB，不代表 Northern Ireland。当前只为工程机械建立已核验英国法规与
限值；道路/农业查询都返回 no-data，避免把 retained framework 误显示为可发布排放事实。

许可评估：GOV.UK 页面采用 Open Government Licence v3.0；VCA 页面和其引用法规的项目级
再利用范围仍待复核。本批只入库官方 URL、法规元数据、结构化限值和自撰摘要，不复制全文。

### 1.13 俄罗斯（RUS）

责任机构：欧亚经济委员会（EEC）发布欧亚经济联盟技术法规及修订；俄罗斯联邦
政府负责国内合格评定程序。道路和农业机械分别建模，不能把农业拖拉机要求扩展到
工程机械。

| scope | 正式文书 | 引用 | 状态与关键日期 | 官方 URL | 核验 |
| --- | --- | --- | --- | --- | --- |
| on-road-truck / on-road-bus | 轮式车辆安全技术法规 | TR CU 018/2011 附件 1 表 3、附件 2 第 39 项 | effective：M2/M3/N 重型柴油车生态等级 5 引用 UN R49-05 B2/C；新车型 2018-01-01、全部既有车型 2019-01-01 完成切换。本模型无新/既有车型字段，保守从 2019-01-01 返回 | https://eec.eaeunion.org/comission/department/deptexreg/tr/bezopKolesnTrS.php | 已核验（2026-08-07，EEC 官方合并文本） |
| on-road-truck / on-road-bus | 俄罗斯第 855 号政府令特殊合格评定程序 | Постановление Правительства РФ № 855，2022-05-12 | 第 8–19 条和附件 1 的排放技术要求已于 2025-06-30 失效；截至 2026-08-07 不作为普通车型通用排放限值 | http://publication.pravo.gov.ru/document/0001202205130025 | 已核验范围与失效边界（俄罗斯官方法律信息门户） |
| agriculture | 农林拖拉机及挂车安全技术法规，经 2021/2024 修订 | TR CU 031/2012；EEC Council Decision 127/2021、32/2024 | effective：Class 3A。19<P<37 与 37≤P<75 自 2025-01-01；75≤P<130 与 130≤P≤560 自 2025-10-01。四带 CO/HC+NOx/PM 分别为 5.5/7.5/0.6、5.0/4.7/0.4、5.0/4.0/0.3、3.5/4.0/0.2 g/kWh | https://eec.eaeunion.org/comission/department/deptexreg/tr/bezopSH.php / https://docs.eaeunion.org/docs/ru-ru/01430574/err_19112021_127 / https://docs.eaeunion.org/docs/ru-ru/01444555/err_14052024_32 | 已核验（2026-08-07，EEC 官方法规及两份修订 PDF） |
| construction | 本批未取得可发布的俄罗斯/EAEU 工程机械柴油排放限值表 | — | no-data；不得套用 EU Stage V、道路 Class 5 或农业拖拉机 Class 3A | — | 已核验当前来源边界；后续继续监控 |

数据语义：道路保存 UN R49-05 B2 的 ESC/ELR 与 ETC 代表性限值；农业功率带按
官方严格端点建模，数据库三位小数下用 `19.001` 表示 `P>19`，用 `560.001`
表示 `P≤560` 的上界。Decision 32/2024 的 J/K 与 H/I 切换日分别保留，不能用
法规记录的最早生效日让高功率带提前返回。

许可评估：EEC、EAEU 文书库和俄罗斯法律门户的项目级再利用范围尚未完成复核；
本批只保存官方 URL、文书元数据、逐项读回的结构化事实和自撰摘要，不复制全文。

### 1.13a 欧亚经济联盟成员关系（ARM / BLR / KAZ / KGZ）

2026-08-10 复核 EAEU 官方联盟页与各国加入链：成员国为亚美尼亚、白俄罗斯、
哈萨克斯坦、吉尔吉斯斯坦和俄罗斯。成员关系按实际入盟日建模：BLR/KAZ/RUS 为
`2015-01-01`，ARM 为 `2015-01-02`，KGZ 为 `2015-08-12`；不得以 TR CU 018/2011
自身的 `2015-01-01` 生效日替代各国入盟日。逐国治理发布共享 `EAEU` 法域时，payload
保留全部五个已签核成员，避免后发国家归档先前成员。

成员身份本身不是某一排放阶段的充分证据。本轮已分别闭合 ARM/BLR/KAZ/KGZ 的国家
实施链：道路从保守全覆盖边界 `2019-01-01` 发布 B2 代表路径，农业按 Stage IIIA
四功率带及各自切换日发布；construction 继续 `no-data`，不得从道路或农林规则外推。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| EAEU 成员国清单 | https://eaeunion.org/comission/department/deptexreg/ | 已核验（2026-08-09）：官方页列出 ARM、BLR、KAZ、KGZ、RUS |
| TR CU 018/2011 技术法规入口与生效日 | https://eec.eaeunion.org/comission/department/deptexreg/tr/bezopKolesnTrS.php | 已核验（2026-08-09）：EEC 页面标注 2015-01-01 生效；尚不足以证明四国具体柴油限值与实施日 |

### 1.14 印度尼西亚（IDN）

责任机构：印度尼西亚环境与林业部（KLHK）负责机动车新型排放质量标准；法规权威
入口为 KLHK JDIH。P.20/2017 只覆盖新型 M、N、O 类道路车辆，不把其道路限值
推断为工程机械或农业装备的非道路法规。

| scope | 正式文书 | 引用 | 状态与关键日期 | 官方 URL | 核验 |
| --- | --- | --- | --- | --- | --- |
| on-road-truck / on-road-bus | 新型 M、N、O 类机动车废气排放质量标准（Euro 4） | Permen LHK P.20/MENLHK/SETJEN/KUM.1/3/2017 | effective：本模型按柴油道路车辆全国执行节点 2022-04-01 返回；ESC：CO 1.5 / HC 0.46 / NOx 3.5 / PM 0.02；ETC：CO 4.0 / NMHC 0.55 / NOx 3.5 / PM 0.03 g/kWh | https://jdih.menlhk.go.id/new2/home/portfolioDetails/20/2017/4 | 已核验法规身份与表格范围；官方页面在本环境自动抓取受限，执行日期按政府实施节点保守建模 |
| construction / agriculture | 本批未取得独立的印尼非道路柴油排放限值文书 | — | no-data；P.20/2017 的 M/N/O 道路车辆 scope 不适用于工程机械、拖拉机或其他非道路发动机；不得套用 EU Stage V、美国 Tier 4 或道路 Euro 4 | — | 已核验当前来源边界；后续持续监控 KLHK/JDIH |

数据语义：道路限值保存 ESC 与 ETC 两个测试循环，卡车与客车共用同一条法规；
当前查询模型没有燃料类型和车辆类别细分字段，因此以 2022-04-01 作为柴油道路
车辆的确定性可查询起点，并在摘要中保留“新型 M/N/O”适用范围。非道路两个 scope
的空结果是显式 no-data，不代表印尼不存在任何地方性或采购技术要求。

许可评估：KLHK JDIH 页面与法规正文的项目级再利用范围尚未完成复核；本批只保存
官方 URL、法规元数据、结构化限值和自撰摘要，不复制法规全文。

### 1.15 泰国（THA）

责任机构：泰国工业标准协会（TISI）发布 TIS 3046-2563，工业部通过 Royal Gazette
强制实施。正式标准与强制令已经逐页读回；国内名称 `Level 6` 的等效基准是 Euro V /
UN R49-05，不得误写成 Euro VI。

| scope | 正式文书 | 状态与关键日期 | 官方 URL | 核验 |
| --- | --- | --- | --- | --- |
| on-road-truck / on-road-bus | `TIS 3046-2563 Heavy motor vehicle equipped with compression ignition engines: safety requirements; emission from engine, level 6`；publisher `Thai Industrial Standards Institute, Ministry of Industry`；`official-regulation`；published `2020-08-18` | Ministerial Regulation 自 `2024-01-01` 强制；reference mass >2,610 kg 的 M1/M2/N1/N2 与全部 M3/N3；ESC/ELR/ETC 每 scope 9 条 | https://service.tisi.go.th/fulltext/TIS3046-2563p_5055.pdf | 已核验正文、类别、净功率基准、循环与完整表 |
| on-road-truck / on-road-bus | `Ministerial Regulation requiring heavy motor vehicles equipped with compression ignition engines to comply with TIS 3046-2563, B.E. 2566`；publisher `Ministry of Industry / Royal Thai Government Gazette`；`official-regulation`；published `2023-07-03` | §1 锁定 2024-01-01，§2 强制采用 TIS 3046-2563 | https://ratchakitcha.soc.go.th/documents/140A040N0000000000500.pdf | 已核验生效条款 |
| construction / agriculture | TIS 787-2551 仅作范围排除补证 | 只覆盖 continuous rated power ≤22 kW 的小型农业/工业柴油机并给 Bosch 烟色要求；150 kW 查询 no-data | https://service.tisi.go.th/fulltext/787_2551.pdf | 已核验范围；不创建本批非道路法规 |

数据语义：2023-12-31 道路无结果；2024-01-01 起卡车/客车各返回 9 条：ESC 的
CO/HC/NOx/PM 为 1.5/0.46/2.0/0.02 g/kWh，ELR opacity 0.5 m⁻¹，ETC 的
CO/NMHC/NOx/PM 为 4.0/0.55/2.0/0.03 g/kWh。ETC THC 0.55 是 NMHC 0.55 的
替代项，不累计。construction/agriculture 保持显式 no-data。

许可评估：本批只保存官方 URL、法规元数据、结构化限值和自撰摘要，不复制标准全文。
全部 THA 记录使用实际核验时刻 `2026-08-10T13:09:56Z`。

### 1.16 越南（VNM）

责任机构：越南交通运输部（BGTVT/MOT）发布机动车国家技术法规，越南政府电子
信息门户保存 Decision 49/2011/QD-TTg、Circular 06/2021/TT-BGTVT 的法规页和
签署附件。2026-08-07 已对政府门户正文、121 页签署版以及交通运输部 TBT 通知所
链接的 119 页可检索附件进行交叉读回。

| scope | 正式文书 | 引用 | 状态与关键日期 | 官方 URL | 核验 |
| --- | --- | --- | --- | --- | --- |
| on-road-truck / on-road-bus | 新生产、组装和进口汽车 Level 5 国家技术法规 | Decision 49/2011/QD-TTg；Circular 06/2021/TT-BGTVT；QCVN 109:2021/BGTVT | effective：2022-01-01。重型压燃发动机 ESC：CO 1.5 / HC 0.46 / NOx 2.0 / PM 0.02 g/kWh；ETC：CO 4.0 / NMHC 0.55 / NOx 2.0 / PM 0.03 g/kWh；ELR 烟度 0.5 m⁻¹ | https://vanban.chinhphu.vn/?pageid=27160&docid=151500 / https://vanban.chinhphu.vn/?pageid=27160&docid=203069 | 已核验（政府门户正文、Circular 签署版第 1 页和 QCVN 表 4/5） |
| construction / agriculture | QCVN 109 明确排除为非道路地形及不属于道路交通系统的道路条件设计制造的车辆 | QCVN 109:2021/BGTVT Part I clause 1 | no-data；不得把道路 Level 5 表扩展到工程机械或农业装备 | https://datafiles.chinhphu.vn/cpp/files/vbpq/2021/04/06-bgtvt.signed.pdf | 已核验 scope 排除边界 |

数据语义：Decision 49 第 4 条与 Circular 06 第 2 条共同确认 2022-01-01 边界。
道路柴油结果不保存 QCVN 表 5 的 CH4 1.1 g/kWh，因为脚注明确该项只适用于天然气
发动机；ELR 烟度以 `OPACITY` / `m-1` 单独保存。当前 schema 没有“新生产、组装、
进口”车型维度，法规摘要必须持续显示该适用范围。

许可评估：越南政府门户、交通运输部 TBT 门户及法规附件的项目级再利用许可尚未
完成复核；本批只保存官方 URL、文书元数据、结构化限值和自撰摘要，不复制全文。

### 1.17 马来西亚（MYS）

责任机构：马来西亚环境局（DOE/JAS）依据 Environmental Quality Act 管理柴油
发动机排放和车辆型式批准。2026-08-07 已读回 DOE 发布的 P.U.(A) 429/96 合并
法规（含 P.U.(A) 488/2000 修订）以及 VTA 现行公开入口链接的 2018 指南。

| scope | 正式文书/实施文件 | 引用 | 状态与关键日期 | 官方 URL | 核验 |
| --- | --- | --- | --- | --- | --- |
| on-road-truck / on-road-bus | 柴油发动机排放法规与 DOE Vehicle Type Approval 指南 | P.U.(A) 429/96；VTA Euro II Table 7；UN R49-02(B) | effective：2017-01-01。M>3.5 t、N2/N3 重型柴油道路车辆 13-mode：CO 4.0 / HC 1.1 / NOx 7.0 / PM 0.15 g/kWh | https://www.doe.gov.my/en/environmental-quality-control-of-emissions-from-diesel-engines-regulations-1996-p-u-a-429-96/ / https://vta.doe.gov.my/guidelines/Garis_Panduan_VTA_MV_V1.pdf | 已核验（法规 regulation 3–6、VTA 指南 p.33–34/Table 7） |
| construction / agriculture | P.U.(A) 429/96 regulation 5 将 engine-system 排放要求限制为 intended for road use 的至少四轮车辆 | P.U.(A) 429/96 regulation 5 | no-data；不得把道路 Euro II/IV 表扩展到非道路机械 | 同上 | 已核验 scope 排除边界 |

数据语义：现行 VTA 门户仍公开链接 2018 指南。其 Euro II 栏把 `2017-01-01` 标为
current implementation；Euro IV 新/既有车型日期明确写为 `Tentative date`，且同时
依赖 Euro 5 柴油全国供应后的宽限期。本批只发布 Euro II，不把燃油供应日期或
tentative 日期升级为车辆排放法规生效日。VTA test-result 页另说明 Euro II smoke
并非强制，因此不创建烟度结构化限值。

许可评估：DOE 法规 PDF 带 Lawnet 版权保留声明，VTA 指南的项目级再利用许可也未
确认；本批只保存官方 URL、文书元数据、结构化事实和自撰摘要，不复制全文。

### 1.18 沙特阿拉伯（SAU）

责任机构：沙特标准、计量和质量组织（SASO）发布国家技术法规；GCC
Standardization Organization（GSO）维护海湾技术法规目录。2026-08-07 已读回
GSO 42、GSO 144 的官方目录页、GSO 144 英文公开预览，以及 SASO 移动机械和
重型设备技术法规 59 页全文。

| scope | 正式文书/入口 | 状态与关键日期 | 官方 URL | 核验 |
| --- | --- | --- | --- | --- |
| on-road-truck / on-road-bus | GSO 42:2015 Motor Vehicles - General Requirements；GSO 144:1991 Heavy Duty Diesel Engined Vehicles | 两项在 GSO 官方目录均标为 current Gulf Technical Regulation；GSO 144 范围覆盖总质量超过 3,500 kg 的重型柴油车辆、CO/HC/NOx 与烟度，但公开预览止于定义页，未公开要求/限值表；目录的 `approved on` 日期不能替代沙特国家实施日。本批 no-data | https://www.gso.org.sa/store/standards/GSO:674566/GSO%2042:2015?lang=en / https://www.gso.org.sa/store/standards/GSO:478791/GSO%20144:1991?lang=en | 已核验目录身份、current 状态、scope 和公开预览边界；限值与沙特实施日未核验 |
| construction / agriculture | SASO Technical Regulation for Machinery Safety - Part 2: Mobile Machinery and Heavy Duty Equipment | 2021-05-21 公报发布，180 日过渡；覆盖移动机械、工程重型设备及目录中的农业机械，但正文的 `emissions` 条款只涉及喷洒物、有害物质、噪声、振动与辐射风险，没有柴油尾气污染物限值。本批 no-data | https://www.saso.gov.sa/en/Laws-And-Regulations/Technical_regulations/Documents/TR-Machinery-Safety-Part2-Mobile-Machinery-and-Heavy-Duty-Equipment.pdf | 已核验封面、Article 2、Article 11、Annex 1 及 Annex 2 §§5.8-5.12；不得把机械安全要求当作尾气限值 |

数据语义：`SA-SASO` 的 `covered` 仅表示国家辖区和官方来源边界已经登记。四个
scope 的法规查询均返回显式 no-data。GSO 144 的批准日、GSO 42 的目录状态以及
SASO 安全法规的 180 日过渡期，都不能单独证明重型道路柴油排放限值已在沙特于某日
生效；不得复制邻国采用日期、Euro 阶段或付费正文外的二手限值。

许可评估：GSO 公开预览明确保留版权，完整标准为付费文件；SASO PDF 的项目级
再利用许可也未完成复核。本批只保存官方 URL、元数据、scope 摘要与证据缺口，不
复制标准正文或受限表格。

### 1.19 阿联酋（ARE）

> 本节保留 2026-08-07 的 no-data 调研轨迹；当前 MOIAT 新车型实施指南的
> regulation metadata、`2027-07-01` 通用 numeric 边界及完整道路表以
> ACCEPTANCE #262、§3.89 和 ADR-136 为准。

责任机构：阿联酋工业和先进技术部（MOIAT）负责产品合格评定与技术法规目录；
联邦法规门户由 Cabinet Affairs 管理。2026-08-07 读回联邦法规门户的 Cabinet
Resolution No. (13) of 2018 附表、MOIAT Conformity Hub Regulations 目录及其
车辆/柴油产品筛选结果。

| scope | 正式文书/入口 | 状态与关键日期 | 官方 URL | 核验 |
| --- | --- | --- | --- | --- |
| on-road-truck / on-road-bus | Cabinet Resolution No. (13) of 2018 Regarding Mandatory Standards for the United Arab Emirates | 联邦法规门户标示 `Issued Date 03 Apr 2018`、`Effective Date 01 May 2018`、`Active`；官方附表只列 `UAE.S 5016:2018`（低批量生产车辆技术要求）和 `UAE.S 5019:2018`（车辆 eCall 技术要求），没有 GSO 42/144 或柴油尾气限值。本批 no-data | https://uaelegislation.gov.ae/en/legislations/2552 / https://uaelegislation.gov.ae/en/legislations/2552/regulations/883/download | 已核验法规元数据、附表 PDF 页和两条标准名称/mandatory 类型；未读回道路柴油排放限值 |
| on-road-truck / on-road-bus / construction / agriculture | MOIAT Conformity Hub Regulations directory | `GSO for tires and vehicles` 目录结果仅落在 Mechanical / Tires；`Diesel` 落在 Petroleum products / Diesel，`DIESEL GENERATOR` 落在 Electrical / Issue conformity certificate for non-regulated products。本目录未提供柴油发动机尾气污染物限值或可发布的 effective 排放规则，四个 scope 保持 no-data | https://conformityhub.moiat.gov.ae/regulations | 已核验（2026-08-07，MOIAT 官方目录筛选）；目录结果只作为产品合格评定边界，不把 non-regulated 产品条目当作排放法规 |

数据语义：`AE-MOIAT` 的 `covered` 仅表示阿联酋官方法规与合格评定入口已登记。
`Effective Date 01 May 2018` 只适用于 Cabinet Resolution No. (13) of 2018 的
强制标准附表，不能推导 GSO 144 或任意道路/非道路柴油排放限值的生效日。MOIAT
目录中的 `Diesel` 是石油产品条目，`DIESEL GENERATOR` 明确属于 non-regulated
product conformity service；不得复制邻国 GSO/Euro/Stage 限值或把车辆安全、eCall
标准扩展为尾气要求。

许可评估：UAE Legislation 与 MOIAT 目录的项目级再利用许可未完成复核；本批只保存
官方 URL、元数据、自撰摘要与 no-data 边界，不复制附表 PDF 或目录附件全文。

### 1.20 南非（ZAF）

责任机构：南非国家强制规范监管机构（NRCS）负责车辆强制规范的合格评定；2015
年公报由 Department of Trade and Industry 发布。2026-08-07 读回 Government
Gazette No. 39220 的 Notice 613（M2/M3）与 Notice 611（N2/N3）全文，并核对
附表的排放条款和 operative dates。

| scope | 正式文书/入口 | 状态与关键日期 | 官方 URL | 核验 |
| --- | --- | --- | --- | --- |
| on-road-truck | Compulsory Specification for Motor Vehicles of Category N2/N3（Notice 611） | 适用于未在南非注册/许可、拟在公共道路运行的 N2/N3 车型；第 4.2.2 要求车辆排放符合 SANS 20049:2004 至 ECE R49.02B，或美国 40 CFR、1998 日本标准、ADR 80/00、SANS 20083/ECE R83.04 等效路径；Schedule 1 将 vehicle emissions 的 operative date 列为 2006-01-01，旧型号制造/进口豁免至 2010-01-01、销售豁免至 2011-07-01。本公报未给出可直接发布的污染物数值表，本批 no-data | https://www.gov.za/sites/default/files/gcis_document/201509/39220gon611.pdf | 已核验 2015-09-18 公报第 1、2、12、15–16 页；数值限值需另取 SANS/ECE 原始表 |
| on-road-bus | Compulsory Specification for Motor Vehicles of Category M2/M3（Notice 613） | 适用于未在南非注册/许可、拟在公共道路运行的 M2/M3 车型；第 4.2.2 与 N2/N3 采用同一 SANS 20049:2004/ECE R49.02B 等效排放入口，Schedule 1 同列 2006-01-01、2010-01-01 与 2011-07-01 节点。本公报未给出可直接发布的污染物数值表，本批 no-data | https://www.gov.za/sites/default/files/gcis_document/201509/39220gen613s.pdf | 已核验 2015-09-18 公报第 1、2、12–13、19–20 页；数值限值需另取 SANS/ECE 原始表 |
| construction / agriculture | 本批未发现 NRCS 或环境主管部门公开的独立非道路柴油发动机尾气限值文书 | 2018 年 GN 516 仍属于 NEMAQA 活动清单修订意向通知，规范固定设施/工业排放，不是移动工程或农业发动机法规；2003 年 GN 3324 是 FINAL DRAFT 策略，明确未来仍需另行 promulgate 法规。本批 no-data | https://www.gov.za/sites/default/files/gcis_document/201805/41650gen516.pdf / https://www.gov.za/sites/default/files/gcis_document/201409/257410.pdf | 已核验 GN 516 第 1–2 页为 stationary activity list，257410 第 3、45 页为 draft/未来法规边界；未取得独立非道路限值 |

数据语义：`ZA-NRCS` 的 `covered` 只表示南非车辆强制规范来源和监管辖区已经登记。
2015 公报保留的 2006/2010/2011 操作日期不能替代未读回的 SANS 20049 或 ECE
R49.02B 限值表；不得把 2003 FINAL DRAFT 的 Euro 1/2/4 时间表、GN 516 的固定
设施排放表、或邻国 Stage/Euro 数值外推到 ZAF。四个 scope 的法规查询保持显式
no-data，直到取得可公开核验的南非实施文书和数值附件。

许可评估：南非政府公报 PDF 的项目级再利用范围尚未单独复核；本批只保存官方 URL、
公报元数据、自撰摘要和证据缺口，不复制标准正文或受限 SANS 表格。

### 1.21 阿根廷（ARG）

责任机构：阿根廷国家道路交通法规通过 Ley 24.449、Decreto 779/95 及环境主管部门
决议实施；Infoleg/Argentina.gob.ar 提供官方规范文本。2026-08-07 读回 Resolution
1464/2014 的重型车辆阶段、Resolution 128/2018 的军用例外范围，并从欧盟
Publications Office/CELLAR 官方 PDF 读回其引用的 Directive 2005/55 B2 限值表。

| scope | 正式文书/入口 | 状态与关键日期 | 官方 URL | 核验 |
| --- | --- | --- | --- | --- |
| on-road-truck / on-road-bus | Resolución 1464/2014 | 适用于 M2/M3/N1/N2/N3 重型车辆；新车型自 2016-01-01、全部重型车辆及发动机自 2018-01-01 执行 Directive 2005/55 的 B2 或 C 路径。本库因无新车型字段，以 2018-01-01 作为普通市场统一查询起点，并只建模最低 B2/Euro V 基线 | https://www.argentina.gob.ar/normativa/nacional/norma-240942/texto | 已核验（2026-08-07，Infoleg 官方正文） |
| on-road-truck / on-road-bus | Directive 2005/55/EC Annex I B2 | B2 柴油机 ESC/ELR：CO 1.5、HC 0.46、NOx 2.0、PM 0.02 g/kWh、烟度 0.5 m⁻¹；ETC：CO 4.0、NMHC 0.55、NOx 2.0、PM 0.03 g/kWh。C/EEV 是更严格的替代路径，不能与 B2 叠加为单一路径 | https://publications.europa.eu/resource/celex/32005L0055.ENG.pdf.l_27520051020en00010163.pdf | 已核验（2026-08-07，Publications Office/CELLAR 官方 PDF B2 表读回） |
| on-road-truck / on-road-bus | Resolución 128/2018 | 仅对 Ejército Argentino 特殊军用 M2/M3/N2/N3 车辆提供 18 个月 Euro III 例外；不改变普通市场 B2 基线，且现已超过临时期限 | https://www.argentina.gob.ar/normativa/nacional/norma-308171/texto | 已核验（2018-03-26 发布；特殊对象、期限和 Euro III 条件读回） |
| construction / agriculture | 本批未取得可发布的阿根廷独立非道路柴油排放限值文书 | Resolution 1464/2014 的 M/N 道路车辆范围不得外推到工程机械或农业装备；两个 scope 保持 no-data | 同上 | 已核验道路范围边界；非道路标准仍为证据缺口 |

数据语义：`AR-SAyDS` 的 `covered` 表示阿根廷官方法规、辖区关系和道路 B2 代表性
限值已经登记。2016-01-01 是新车型节点，不在缺少车型维度的查询中提前返回；
2018-01-01 起普通市场返回 B2。Resolution 128/2018 只作为历史军用例外来源保存，
不创建普通市场 effective regulation。C/EEV 替代路径和非道路限值留待独立建模。

许可评估：Argentina.gob.ar/Infoleg 与欧盟官方 PDF 的项目级再利用范围分别按官方
门户条款与 EU 文书规则处理；本批仅保存元数据、结构化事实、自撰摘要和官方链接，
不复制阿根廷法规全文。

### 1.22 新西兰（NZL）

责任机构：NZ Transport Agency Waka Kotahi（NZTA）发布并维护 Land Transport
Rules。2026-08-07 读回 `Land Transport Rule: Vehicle Exhaust Emissions 2007`
（Rule 33001，合并至 2025-05-30）的适用条款、定义和 Schedule 1 Table 2B。

| scope | 正式文书/入口 | 状态与关键日期 | 官方 URL | 核验 |
| --- | --- | --- | --- | --- |
| on-road-truck / on-road-bus | Land Transport Rule: Vehicle Exhaust Emissions 2007, Rule 33001，Section 2 与 Schedule 1 Table 2B | 适用于进入道路服务认证的 MD3/MD4/ME/NB/NC 重型车辆。2024-11-01 至 2025-10-31 期间，新车型可以采用 Euro VI Step C 等路径，但旧车和既有车型仍可采用 Euro V；自 2025-11-01 起新旧车统一接受 Euro VI Step C、US Tier 3、US 2013、Japan 2016、ADR 80/04、UNR49/06(Supp.4) 或 UNR83/07。当前 schema 无 used/new/new-model 维度，因此只从统一切换日建模 Euro VI Step C 代表路径 | https://www.nzta.govt.nz/assets/resources/rules/docs/vehicle-exhaust-emissions-2007-as-at-30-may-2025.pdf | 已核验（2026-08-07，条款 2.1/2.2、定义和 PDF 第 25–26 页 Table 2B） |
| construction / agriculture | Rule 33001 Section 2 的道路服务认证范围及 2.1(2)(b) tractor 排除 | `tractor` 明确定义为主要用于牵引农业挂车或驱动农业机具的机动车，并被 entry requirements 排除；本批未取得工程机械或农业装备独立法定尾气限值，不把道路 Table 2B 外推到非道路 scope | 同上 | 已核验道路范围与 tractor 排除；独立非道路标准仍为证据缺口 |

数据语义：`NZ-NZTA` 的 `covered` 表示 NZTA 官方道路法规、辖区关系和 Euro VI
Step C 代表路径已登记。Table 2B 使用 `or` 列示多个替代标准，它们不是累计要求；
本批限值数值取自该规则定义直接引用的 Regulations 595/2009 与 582/2011 官方
Euro VI 来源链。2025-10-31 的混合 used/new-model 状态不在缺少车辆状态维度时
折叠为单一结果，2025-11-01 起才返回统一路径。

许可评估：NZTA 规则 PDF 的项目级再利用范围尚未单独复核；本批只保存文书元数据、
结构化事实、自撰摘要与官方链接，不复制规则全文。Euro VI 数值来源继续沿用欧盟
文书再利用规则。

### 1.23 智利（CHL）

责任机构：智利环境部（Ministerio del Medio Ambiente，MMA）制定道路重型车辆和
移动机械排放规范；Biblioteca del Congreso Nacional 的 LeyChile 提供官方现行文本。
2026-08-07 读回 D.S. 39/2020、D.S. 33/2024 与 D.S. 50/2023 的完整条文和表格。

| scope | 正式文书/入口 | 状态与关键日期 | 官方 URL | 核验 |
| --- | --- | --- | --- | --- |
| on-road-truck / on-road-bus | D.S. 50/2023，将 article 8 quáter 加入 D.S. 55/1994 | 适用于首次登记、GVW >= 3,860 kg 的重型客货道路车辆；发布后 18 个月实施，LeyChile 现行 D.S. 55 版本自 2026-01-06 生效。Table 1 压燃机 US-EPA 路径为 CO 15.5、HCNM 0.14、NOx 0.2、PM 0.01 g/bHp-h；Table 3 Euro VI 压燃机 WHSC/WHTC 为替代路径，本批建模后者 12 条代表性限值 | https://www.bcn.cl/leychile/navegar?idNorma=1204718 / https://www.bcn.cl/leychile/navegar?idNorma=8364 | 已核验（2026-08-07，D.S. 50 article 2/transitory article、D.S. 55 现行版本与三张表原图） |
| construction | D.S. 39/2020 article 2–3 Table 1/2 | 全国适用于进口的压燃式移动机械，19 <= P <= 560 kW；自法规发布满 24 个月即 2023-10-21 起适用。Table 1 为 US 40 CFR 1039 路径，Table 2 为 EU 2016/1628 Stage V 路径，二者替代而非累计；本批按 Table 2 建模五个功率带 | https://www.bcn.cl/leychile/navegar?idNorma=1166850 | 已核验（2026-08-07，现行合并文本 article 2–3、Table 1/2 与 24 个月条款） |
| agriculture | D.S. 33/2024 对 D.S. 39/2020 的修订 | 明确排除除拖拉机外的农业机械；拖拉机适用日从 2024-10-21 延至 2030-01-01。当前只保存 `adopted` tractor 记录和 future limits，2026 年 effective 查询必须为空 | https://www.bcn.cl/leychile/navegar?idNorma=1207629 | 已核验（2026-08-07，article único 第 1/2 项及审计机关附注） |

数据语义：`CL-MMA` 的道路记录从 D.S. 55 现行版本日期 `2026-01-06` 起返回，
不能用 D.S. 50 的 `2024-07-05` 发布日提前生效。道路 Table 1/Table 3、非道路
Table 1/Table 2 均为替代认证路径，不能叠加。D.S. 39 的 560 kW 上界为含端点；
fixture 以 `560.001` 的半开上界保存。农业 scope 只登记 2030 拖拉机 adopted 事实，
其他农业机械继续明确排除。

许可评估：LeyChile 文书的项目级再利用范围尚未单独复核；本批只保存官方 URL、
文书元数据、结构化事实、自撰摘要和限值，不复制法规全文或表格图片。

### 1.24 哥伦比亚（COL）

责任机构：哥伦比亚环境与可持续发展部（Ministerio de Ambiente y Desarrollo
Sostenible，MADS）制定移动源排放法规。2026-08-07 从 MinAmbiente 官方法规目录
与签署 PDF 读回 Resolucion 0762/2022 的范围、日期、限值表与生效条款。

| scope | 正式文书/入口 | 状态与关键日期 | 官方 URL | 核验 |
| --- | --- | --- | --- | --- |
| on-road-truck / on-road-bus | Resolucion 0762/2022 article 18 Table 22 | M2/M3/N2/N3 压燃式重型道路车辆自 2023-01-01 执行 WHSC/WHTC 限值：WHSC CO 1.50、HCT 0.13、NOx 0.40、PM 0.01 g/kWh、NH3 10 ppm、PN 8e11；WHTC CO 4.0、HCT 0.16、NOx 0.46、PM 0.01 g/kWh、NH3 10 ppm、PN 6e11。EPA10 或更高标准为等效替代路径 | https://www.minambiente.gov.co/documento-normativa/resolucion-0762-de-2022/ | 已核验（2026-08-07，article 18、Table 22 与 paragraph 2 原图） |
| construction | Resolucion 0762/2022 article 19 Table 23/24 | Article 50 规定自发布生效，官方目录日期为 2022-07-18；因此 24 个月后即 2024-07-18 起适用于制造、组装或进口的柴油非道路移动源。范围为 19 <= P <= 560 kW；Table 23 EU 与 Table 24 US 二选一，本批只建模 Table 23 五个功率带。19 <= P < 37 仅 NRSC，37 <= P <= 560 要求 NRSC/NRTC | https://www.minambiente.gov.co/wp-content/uploads/2022/07/Resolucion-0762-de-2022-Fuentes-moviles.pdf | 已核验（2026-08-07，articles 19/50、Tables 23/24 与循环说明原图） |
| agriculture | Resolucion 0762/2022 article 3(c) | 明确排除专用于农业作业的非道路移动源；同时排除非柴油机械以及 P < 19 kW 或 P > 560 kW。2026 effective 查询保持 no-data，不把 construction 限值外推到农业装备 | 同上 | 已核验（2026-08-07，article 3(c) 原图） |

数据语义：`CO-MADS` 的道路 Table 22 从法定日期 `2023-01-01` 返回；旧 Table 21
只保留至 2022-12-31，本批不作为当前基线继续叠加。非道路使用官方目录发布日加
24 个月得到 `2024-07-18`，560 kW 为含端点并以 `560.001` 半开上界保存。所有
EPA/US 路径均保持替代而非累计，农业排除优先于一般非道路范围。

许可评估：MinAmbiente 门户与 PDF 的项目级再利用范围尚未单独复核；本批只保存
官方 URL、法规元数据、结构化事实、自撰摘要和限值，不复制法规全文或表格图片。

### 1.25 秘鲁（PER）

责任机构：秘鲁环境部（Ministerio del Ambiente，MINAM）制定机动车大气排放
LMP，交通通信部配套实施。2026-08-08 从 Gob.pe 官方法规页与 Diario Oficial
El Peruano 签署公报读回 D.S. 029-2021-MINAM 的完整修订表和生效条款。

| scope | 正式文书/入口 | 状态与关键日期 | 官方 URL | 核验 |
| --- | --- | --- | --- | --- |
| on-road-truck / on-road-bus | D.S. 010-2017-MINAM annex I.7，经 D.S. 029-2021-MINAM article 2 替换 | 纳入国家道路运输系统、PBV > 3.5 t 的压燃式客货车辆自 2024-10-01 按提单日期执行 Euro VI/A。WHSC：CO 1.50、HCT 0.13、NOx 0.40、PM 0.01 g/kWh、NH3 10 ppm、PN 8e11；WHTC：CO 4.0、HCT 0.16、NOx 0.46、PM 0.01 g/kWh、NH3 10 ppm、PN 6e11。Annex I.9.1 另列 EPA 2010 路径，本批建模 Euro VI/A 代表路径 | https://www.gob.pe/institucion/minam/normas-legales/2213166-029-2021-minam | 已核验（2026-08-08，El Peruano 2021-10-16 公报 pp.22–26、annex I.7/I.9.1 与第一项最终补充规定原图） |
| construction / agriculture | D.S. 029-2021-MINAM item I scope | 标题与 article 1 将修订范围限定为纳入 Sistema Nacional de Transporte Terrestre 的新旧机动车；本批未取得秘鲁非道路工程/农业柴油机械独立法定限值，两个 scope 保持 no-data，不从道路表外推 | 同上 | 已核验道路 scope 边界（2026-08-08）；非道路独立文书仍为缺口 |

数据语义：`PE-MINAM` 从 `2024-10-01` 返回 Euro VI/A WHSC/WHTC 代表路径，
日期按原表脚注对应提单日期而非车辆入境/登记日。D.S. 029 同时列出 annex I.9.1
EPA 2010 路径，不能与 Euro VI/A 累计。第二项最终补充规定要求 MINAM 在
2024-10-01 后两年内更新 Euro VI/A 到 VI/C 的试验协议；截至 2026-08-08 尚未
到该期限，不能提前把未来更新当作现行法规。

许可评估：Gob.pe 与 El Peruano 公报的项目级再利用范围尚未单独复核；本批只
保存官方 URL、文书元数据、结构化事实、自撰摘要和限值，不复制法规全文或表格图片。

### 1.26 菲律宾（PHL）

责任机构：菲律宾环境与自然资源部（DENR）环境管理局（EMB）维护空气质量与
机动车排放法规入口。Official Gazette 2014-09-29 的 DENR 新闻稿直接确认该部门
负责机动车污染与 Euro 4 政策。2026-08-08 直接访问 EMB 域名下的 DAO 2015-04
PDF；URL 存在，但服务器只返回 Cloudflare 安全验证页。Official Gazette 以完整
文书号检索返回 `Nothing Found`，因此本批没有从官方正文读回标题、发布日期、
适用范围、实施日期或污染物限值。

| scope | 正式文书/入口 | 状态与关键日期 | 官方 URL | 核验 |
| --- | --- | --- | --- | --- |
| on-road-truck / on-road-bus | DENR Administrative Order No. 2015-04 官方 PDF 入口；Official Gazette 2014-09-29 DENR Euro 4 政策新闻 | 新闻稿只证明 DENR 的机动车排放职责与当时“提议提前实施”状态，不是法规限值表；DAO 正文受安全验证阻断，不能据二手摘要或模型记忆创建 Euro IV effective 法规、实施日或限值 | https://emb.gov.ph/wp-content/uploads/2015/12/DAO-2015-04.pdf / https://www.officialgazette.gov.ph/2014/09/29/denr-pushes-for-early-implementation-of-fuel-standards-phase-out-of-ageing-vehicles/ | 官方入口与职责边界已核验（2026-08-08）；DAO 正文、标题、日期、scope 与限值未核验 |
| construction / agriculture | 未取得独立官方移动机械排放文书 | 四个 scope 均保持 no-data；不得把道路文书、邻国 Euro/Stage 标准或搜索摘要外推到非道路机械 | 同上 | 证据缺口已记录（2026-08-08） |

数据语义：`PH-DENR` 只表示 DENR/EMB 官方入口及国家辖区关系已登记，不表示
菲律宾已有可发布的排放阶段或限值。成员关系 `validFrom=2014-09-29` 只表示本批
直接读回的最早 DENR 机动车排放职责证据，不是 DAO 发布或生效日期；因此仍不使用
URL 上传目录中的年份推断法规日期。后续只有在官方正文可直接读回，或取得另一
官方镜像后，才创建带明确状态、日期、scope 与限值的 regulation。

许可评估：本批不复制 EMB PDF；只保存机构、文书号、官方 URL、自撰可访问性
说明与 no-data 边界。正文许可和可再利用范围待页面恢复可达后复核。

### 1.27 新加坡（SGP）

责任机构：新加坡国家环境局（NEA）依据 Environmental Protection and
Management Act 管理机动车与非道路柴油机排放。2026-08-08 从 Singapore
Statutes Online 直接读回 S 480/2017 和现行 S 299/2012，并以 NEA 当前空气污染
说明页复核受管设备示例。

| scope | 正式文书/入口 | 状态与关键日期 | 官方 URL | 核验 |
| --- | --- | --- | --- | --- |
| on-road-truck / on-road-bus | Environmental Protection and Management (Vehicular Emissions) Regulations Second Schedule，经 S 480/2017 修订 | GVW > 3.5 t 的柴油道路车辆自 2018-01-01 可按 Regulation (EC) No 595/2009 Annex I（经 582/2011 修订）Euro VI，或按日本 PPNLT 等路径证明合规。本批保存 Euro VI WHSC/WHTC 代表路径，每个 scope 12 条限值 | https://sso.agc.gov.sg/SL-Supp/S480-2017/Published/20170830170000?DocDate=20170830170000 / https://sso.agc.gov.sg/SL/EPMA1999-RG6?DocDate=20260331 | 已核验（2026-08-08，S 480/2017 regulations 1(3)、2(c) 与替换后的 Second Schedule） |
| construction | Environmental Protection and Management (Off-Road Diesel Engine Emissions) Regulations 2012, S 299/2012 | 自 2012-07-01 起，作为 industrial plant 或安装在其中的 18≤P<560 kW 非道路柴油机须预先批准并符合 Schedule 任一标准。US Tier II、EU Stage II、Japan Tier I 为替代路径；本批保存 EU Stage II 四个功率带。NEA 明列 cranes、excavators、forklifts、power generators | https://sso.agc.gov.sg/SL/EPMA1999-S299-2012 / https://www.nea.gov.sg/our-services/pollution-control/air-pollution/air-pollution-regulations | 已核验（2026-08-08，definitions、regulations 4–8、Schedule 与 NEA 设备示例） |
| agriculture | S 299/2012 industrial-plant 范围 | 定义排除航空器、铁路机车、船舶和已受道路规则管理的发动机；但进口适用条款与 NEA 指引围绕 industrial plant，本批未取得 agricultural tractors/equipment 的明确官方映射，因此保持 no-data，不从一般 off-road 定义外推 | 同上 | 已核验法规范围；农业设备映射仍为缺口（2026-08-08） |

数据语义：`SG-NEA` 从 2012-07-01 建立可追溯国家辖区关系。道路 Euro VI 与
PPNLT 路径、非道路 EU Stage II 与 US Tier II/Japan Tier I 路径均是替代认证，
不得累计。S 299/2012 的 18/37/75/130 kW 下界均含、560 kW 不含；ISO 8178
测试基础保留在每条限值中。农业 scope 的 no-data 是证据范围边界，不表示新加坡
法律明确豁免全部农业装备。

许可评估：Singapore Statutes Online 与 NEA 页面的项目级再利用范围尚未单独
复核；本批只保存官方 URL、法规元数据、结构化事实、自撰摘要和限值，不复制全文。

### 1.28 挪威（NOR）

责任机构：挪威公共道路管理局负责车辆技术规则，劳动监察机关维护机械法规。
2026-08-08 从 Lovdata 直接读回现行 Bilforskriften 与 Maskinforskriften 合并文本，
并沿其明确纳入的 EU 文书追溯污染物限值。

| scope | 正式文书/入口 | 状态与关键日期 | 官方 URL | 核验 |
| --- | --- | --- | --- | --- |
| on-road-truck / on-road-bus | Forskrift om godkjenning av bil og tilhenger til bil（Bilforskriften），FOR-2022-06-28-1233 § 1-4、Vedlegg 1 G3 | 现行法规自 2022-10-01 生效并适用于挪威（含 Svalbard）；§ 1-4 将 Regulation (EC) No 595/2009 与 582/2011 作为挪威法。G3 对 M3/N3 及未按 715/2007 认证的重型 M/N 车辆保留 595/2009 路径至 2029-05-28，2029-05-29 转向 EU 2024/1257。本批保存 Euro VI WHSC/WHTC 代表限值 | https://lovdata.no/dokument/SF/forskrift/2022-06-28-1233 | 已核验（2026-08-08，§§ 1-2、1-4 与 Vedlegg 1 G3 直接读回） |
| construction / agriculture | Forskrift om maskiner（Maskinforskriften），FOR-2009-05-20-544 § 1(3)、Vedlegg XII | 2020-06-24 第 1361 号修订自 2020-07-01 生效，Vedlegg XII 将 EU 2016/1628 作为挪威法规；正文同时修改农业与林业车辆框架 167/2013。本批对 construction 与 agriculture 保存 Stage V NRE 全功率带代表限值 | https://lovdata.no/dokument/SF/forskrift/2009-05-20-544/kapittel_17 | 已核验（2026-08-08，§ 1(3)、修订信息与 Vedlegg XII 直接读回） |

数据语义：`NO-NATIONAL` 自 2020-07-01 建立可追溯国家辖区关系。道路记录的
`2022-10-01` 是当前 Bilforskriften 的生效日，不宣称是挪威首次采用 Euro VI 的
日期；历史 FOR-2012-07-05-817 已读回 595/2009/582/2011 引用，但未用框架引用
反推完整实施节点。道路有效期截至 2029-05-29（半开区间），避免在 Euro 7 切换日
继续返回 Euro VI。Stage V 数值由挪威纳入文书与 EU Annex II 双重追溯；560 kW
进入高功率带，不能误作无结果。

许可评估：Lovdata 与相关机关页面的项目级再利用范围尚未单独复核；本批只保存
官方 URL、法规元数据、结构化事实、自撰摘要和限值，不复制法规全文。

### 1.29 冰岛（ISL）

责任机构：冰岛基础设施部维护道路车辆技术法规，劳动监察机关承担非道路移动
机械发动机的国家主管、批准与市场监督职责。2026-08-08 从冰岛官方
Reglugerðasafn 直接读回 377/2013、603/2026、1200/2020 与 179/2021，并用冰岛
政府 EEA 数据库核对 595/2009 的共同委员会决定和现行状态。

| scope | 正式文书/入口 | 状态与关键日期 | 官方 URL | 核验 |
| --- | --- | --- | --- | --- |
| on-road-truck / on-road-bus | Reglugerð 377/2013（修订 822/2004）article 12、Annex IV 45zzk/45zzl；现行修订 603/2026；冰岛政府 EEA 条目 32009R0595 | 377/2013 要求车辆符合当时适用的 595/2009，并在附件登记 595/2009、582/2011；文书以 2013-04-15 部长日期规定立即生效。政府 EEA 数据库把 595/2009 标为已纳入且仍有效，JCD 41/2012 确认 2012-05-01 生效。603/2026 于 2026-05-29 发布，继续更新 595/2009 条目并纳入 Euro 7；本批按 2027-11-29 重型车辆 Euro 7 适用日结束 Euro VI 路径 | https://www.reglugerd.is/reglugerdir/allar/nr/377-2013 / https://www.reglugerd.is/reglugerdir/allar/nr/0603-2026 / https://gagnagrunnur.ees.is/32009r0595 | 已核验（2026-08-08，国内条款、附件、发布信息及政府 EEA 状态页直接读回） |
| construction / agriculture | Reglugerð 1200/2020 arts. 1/7/8；现行 Reglugerð 179/2021 arts. 1/7/8 | 1200/2020 自 2020-12-01 对非道路移动机械发动机实施 EU 2016/1628 及配套文书，并废止 465/2009；179/2021 自 2021-02-23 无缝替代且现行合并文本最后修订于 2023-05-31。本批对 construction 与 agriculture 保存 Stage V NRE 全功率带代表限值 | https://www.reglugerd.is/reglugerdir/allar/nr/1200-2020 / https://www.reglugerd.is/reglugerdir/allar/nr/179-2021 | 已核验（2026-08-08，范围、主管机关、EEA 实施条款、生效/废止历史直接读回） |

数据语义：`IS-NATIONAL` 自 2013-04-15 建立可追溯国家辖区关系。道路国内适用
起点晚于 JCD 41/2012 的 EEA 层日期，因此使用国内文书日期，不直接复用 EU 成员
关系。道路 `effective_to = 2027-11-29` 为半开区间；到期后本批暂不返回尚未录入
限值的 Euro 7。Stage V 以两条法规记录保存 2020-12-01 至 2021-02-23 的替代链，
切换日不得重复或断档；560 kW 进入高功率带。污染物数字继续追溯 EU 官方表，
冰岛文书用于证明国内范围、主管机关与有效日期。

许可评估：冰岛法规库与政府 EEA 数据库的项目级再利用范围尚未单独复核；本批
只保存官方 URL、法规元数据、结构化事实、自撰摘要和限值，不复制法规全文。

## 2. 许可矩阵（ADR-018 输入）

| 法域 | 全文可再分发/入库 | 条件 | 建议入库策略 |
| --- | --- | --- | --- |
| USA | 是 | 公共领域（17 U.S.C. § 105，已核验）；GPO 要求署名 | 全文分块 + 元数据；图片表格（§1039.101 Table 1）签字前人工读回 |
| EU | 是 | CC BY 4.0（欧委会法律声明 + Decision 2011/833/EU，已核验）；合并版非权威，OJ 为权威 | 全文分块 + 署名 + 版本/权威性标注；机器访问走 CELLAR/ELI |
| CHN | 否（未找到开放许可，openstd/MEE 声明禁止转载） | 可在线阅读、引用 | 只入库元数据、引用、公告事实与自撰摘要；原文外链 |
| BRA | 官方法律行为：是；门户解释文字：否 | Lei 9.610 Art. 8º IV（已核验）；gov.br 文字 CC BY-ND 3.0 | 决议/法律/公报全文分块 + 引用；保留“不替代 DOU”声明 |
| JPN | 本批不复制全文 | 政府网站/解释性 PDF 再利用范围待项目级复核 | 只入库元数据、结构化事实、自撰摘要与官方外链 |
| KOR | 本批不复制全文 | 国家法令信息中心官方 PDF 的再利用范围待项目级复核 | 只入库元数据、结构化事实、自撰摘要与官方外链 |
| MEX | 本批不复制全文 | DOF 公告页面再利用范围待项目级复核 | 只入库元数据、结构化事实、自撰摘要与官方外链；表 1B/2B 保留替代路径说明 |
| TUR | 本批不复制全文 | Resmî Gazete 与农业/林业部页面再利用范围待项目级复核 | 只入库元数据、结构化事实、自撰摘要与官方外链；农业独立限值未确认，保持 no-data |
| AUS | 本批不复制全文 | Federal Register、DITRDCSA 与 DCCEEW 页面/PDF 的再利用范围待项目级复核 | 只入库元数据、结构化事实、自撰摘要与官方外链；非道路 scope 保持 no-data |
| CAN | 本批不复制全文 | Justice Laws Website / ECCC 页面与加拿大法规引用链的再利用范围待项目级复核 | 只入库元数据、结构化事实、自撰摘要与官方外链；道路与非道路 scope 分开建模 |
| GBR | 本批不复制全文 | GOV.UK OGL v3.0；VCA 页面与 retained EU 文书的项目级再利用范围待复核 | 只入库元数据、结构化事实、自撰摘要与官方外链；GB 与 Northern Ireland 分开，农业保持 no-data |
| IND | 本批不复制全文；未确认 MoRTH/eGazette 开放再利用许可，BIS/AIS 标准可能付费 | 仅保存公报元数据、结构化事实、自撰摘要和官方链接 | BS VI、CEV、TREM 分 scope/阶段建模；2026 draft 仅记录 proposed 状态 |
| RUS / EAEU | 本批不复制全文；EEC、EAEU 文书库与俄罗斯官方法律门户的项目级再利用范围待复核 | 仅保存文书元数据、结构化事实、自撰摘要和官方链接 | 道路与农业分 scope 建模；失效的第 855 号技术表不作现行限值，工程机械保持 no-data |
| IDN / KLHK | 本批不复制全文；KLHK JDIH 与法规正文的项目级再利用范围待复核 | 仅保存法规元数据、结构化事实、自撰摘要和官方链接 | P.20/2017 只建模道路 M/N/O Euro 4；工程机械与农业 scope 保持 no-data |
| THA / TH-TISI | 不复制 TIS 或 Royal Gazette 全文；保存精确官方 URL、法规元数据、结构化 ESC/ELR/ETC 数值与自撰摘要 | 两份法规正文的项目级再利用许可仍需独立复核 | 道路每 scope 9 条；Level 6 不得误标 Euro VI，THC/NMHC 替代项不得累计，非道路保持 no-data |
| VNM / BGTVT | 本批不复制全文；政府门户与 TBT 附件的项目级再利用范围待复核 | 仅保存法规元数据、结构化事实、自撰摘要和官方链接 | QCVN 109 只建模新生产、组装和进口道路汽车 Level 5；非道路 scope 保持 no-data |
| MYS / DOE | 不复制全文；P.U.(A) 429/96 合并 PDF 带 Lawnet 版权保留，VTA 指南再利用范围未确认 | 仅保存文书元数据、结构化事实、自撰摘要和官方链接 | 只发布明确 effective 的 2017 Euro II 道路基线；Euro IV tentative 与非道路 scope 均不补值 |
| ARE / MOIAT | 本批不复制全文；UAE Legislation、MOIAT 指南与 GSO 引用链的项目级再利用范围待复核 | 仅保存法规/指南元数据、结构化事实、自撰摘要和官方链接 | 2026-01-01 只建模新车型 regulation metadata；通用道路 Euro VI/B WHSC/WHTC numeric 从全部进口车辆边界 2027-07-01 起发布，非道路保持 no-data |
| ZAF / NRCS | 本批不复制南非公报或 SANS 全文；Directive 91/542/EEC 沿 EU 再利用规则处理 | 仅保存公报元数据、自撰摘要、结构化 R49.02B 限值和官方链接 | Notices 611/613 闭合 N2/N3、M2/M3 道路实施链并各发布 4 条；非道路保持 no-data |
| ARG / SAyDS | 本批不复制阿根廷法规全文；EU Directive 官方文书按欧盟规则处理 | 仅保存阿根廷文书元数据、自撰摘要、结构化 B2 限值和官方链接 | Resolution 1464/2014 只建模普通重型道路 B2 基线；军用例外和 C/EEV 替代路径不混入，非道路保持 no-data |
| NZL / NZTA | 本批不复制 NZTA 规则全文；Euro VI 数值的欧盟文书按 EU 规则处理 | 仅保存 NZTA 文书元数据、自撰摘要、结构化 Euro VI 代表性限值和官方链接 | 只从 2025-11-01 统一切换日建模 Table 2B 的 Euro VI Step C 替代路径；非道路保持 no-data |
| CHL / MMA | 本批不复制 LeyChile 法规全文或表格图片；门户项目级再利用范围待复核 | 仅保存 D.S. 39/33/50 元数据、自撰摘要、结构化限值和官方链接 | 道路与移动机械分别按正式实施日建模；US/EU 路径不叠加，拖拉机保持 2030 adopted，其他农业机械明确排除 |
| COL / MADS | 本批不复制 MinAmbiente 法规全文或表格图片；门户项目级再利用范围待复核 | 仅保存 Resolucion 0762 元数据、自撰摘要、结构化限值和官方链接 | 道路与非道路分别按 2023-01-01 和发布满 24 个月建模；EU/US 路径不叠加，农业机械明确排除 |
| PER / MINAM | 本批不复制 Gob.pe/El Peruano 法规全文或表格图片；项目级再利用范围待复核 | 仅保存 D.S. 029 元数据、自撰摘要、结构化限值和官方链接 | 道路按 2024-10-01 提单日期建模；Euro VI/A 与 EPA 2010 不叠加，非道路保持 no-data |
| PHL / DENR-EMB-LTO | 本批不复制法规/指南全文；司法电子图书馆、DENR-EMB/LTO 与政府公告的项目级再利用范围待复核 | 仅保存文书元数据、自撰摘要、结构化 Euro IV 限值和精确链接 | 自 2016-01-01 建模道路 UN R49-04 ESC/ELR/ETC，每 scope 9 条；非道路保持 no-data |
| ECU / INEN | 不复制受标准版权约束的 NTE 2207 全文；官方 RTE 与可核标准副本的项目级再利用范围待复核 | 仅保存标准元数据、自撰摘要、结构化 ECE-49 限值和精确链接 | 道路 >3,500 kg 各发布 CO/HC/NOx/PM 4 条；RTE 明文排除的工程/农业保持 no-data |
| PAK / Pak-EPA-PSQCA | 不复制 Gazette 扫描或标准全文；官方目录与可核扫描只作证据定位 | 仅保存文书元数据、自撰摘要、结构化 Pak-II 限值和精确链接 | 自 2012-07-01 建模道路 ECE-R-49 各 4 条；非道路保持 no-data，旧烟度执法材料不补入 |
| SAU / SASO-GSO | 本批不复制 GSO 标准全文；目录、MY2026 技术法规清单与预览的项目级再利用范围待复核 | 仅保存目录/清单元数据、自撰摘要、结构化 Euro V 限值和精确链接 | MY2026 闭合道路 ESC/ELR/ETC，每 scope 9 条；机械安全文书不得外推到非道路尾气 |
| ISR / IMR | 本批不复制年度 IMR 文档全文；gov.il 文档的项目级再利用范围待复核 | 仅保存 CY2026 文书元数据、自撰摘要、结构化 EU 代表限值和精确链接 | 道路 Euro VI 各 12 条、construction Stage V 28 条；agriculture 保持 no-data |
| RWA / RSB | 本批不复制付费标准或公报全文；实施桥接材料只用于证明适用链 | 仅保存文书元数据、自撰摘要、结构化 Euro IV 限值和精确链接 | 自 2023-01-23 建模道路 ESC/ELR/ETC，每 scope 9 条；非道路保持 no-data |
| DZA / JORADP | 本批不复制公报全文；项目级再利用范围待复核 | 仅保存文书元数据、自撰摘要和精确链接 | 旧车辆级 numeric regulation/limits 已退出 publishable graph 并待治理归档；四 scope 按五门槛失败关闭 |
| ETH / MoTL | 本批不复制 Directive/标准全文；项目级再利用范围待复核 | 仅保存文书元数据、自撰摘要和精确链接 | 旧不完整 numeric 结论已退出 publishable graph 并待治理归档；四 scope no-data |
| NGA / NESREA | 本批不复制公报全文；NESREA 官方 PDF 的项目级再利用范围待复核 | 仅保存文书元数据、自撰摘要和精确链接 | Schedule VIII 的 PM 单元格无法选择且认证循环未闭合；旧 regulation/6 limits 待归档，四 scope no-data |
| LKA / Government Printing | 本批不复制 Gazette 全文；政府公报项目级再利用范围待复核 | 仅保存公报元数据、自撰摘要、结构化 34 条代表限值和精确链接 | 自 2018-07-13 发布道路 5+5、工程 24、农业 0；C1/D2 与 Third/Fifth 均为替代路径，并保留 clause 8 信用证过渡豁免 |
| SGP / NEA-AGC | 本批不复制 SSO 法规全文；SSO/NEA 项目级再利用范围待复核 | 仅保存法规元数据、自撰摘要、结构化限值和官方链接 | 道路与工业非道路分别建模；所有路径保持替代语义，农业保持 no-data |
| NOR / Lovdata | 本批不复制 Lovdata 法规全文；Lovdata 与主管机关页面的项目级再利用范围待复核 | 仅保存法规元数据、自撰摘要、结构化限值和官方链接 | 以挪威国内纳入文书证明适用范围与日期，以 EU 官方表追溯数值；不得用现行合并法规日期冒充首次实施日 |
| ISL / Reglugerðasafn | 本批不复制冰岛法规全文；法规库与政府 EEA 数据库的项目级再利用范围待复核 | 仅保存法规元数据、自撰摘要、结构化限值和官方链接 | 国内文书证明适用范围、生效与替代链；EU 官方表提供数值；不以 EEA 身份自动创建适用关系 |
| LIE / Lilex | 本批不复制列支敦士登法规全文；Lilex 与 EWR 法规库的项目级再利用范围待复核 | 仅保存法规元数据、自撰摘要、结构化限值和官方链接 | VTS 证明道路 595/2009/R49 入口，LGBl. 2020 Nr. 258 证明 EU 2016/1628 自 2020-08-01 纳入；道路不从 EWR 身份反推更早实施日 |
| CHE / Fedlex | 本批不复制瑞士法规全文；Fedlex 项目级再利用范围待复核 | 仅保存法规元数据、自撰摘要、结构化限值和官方链接 | VTS Anhang 5 Ziff. 211 证明道路 595/2009/R49 入口，Ziff. 211a/211b 证明工作发动机与拖拉机可按 EU 2016/1628；不从当前引用反推首次实施日 |

### 1.30 列支敦士登（LIE）

责任机构：列支敦士登政府 Rechtsdienst der Regierung 维护 Lilex 合并法规；车辆
型式批准由 Amt für Strassenverkehr 执行。2026-08-08 从 Lilex 直接读回 VTS
现行合并文本及 LGBl. 2020 Nr. 258 EWR 纳入公告。

| scope | 正式文书/入口 | 状态与关键日期 | 官方 URL | 核验 |
| --- | --- | --- | --- | --- |
| on-road-truck / on-road-bus | VTS LGBl. 1996 Nr. 143，Fassung 01.07.2026 Anhang 4 Ziff. 211 | 重型 M/N 柴油发动机必须符合 Regulation (EC) No. 595/2009 或 UNECE R49；文本未提供可重建的首次 Euro VI 国内实施日期，本批从现行合并版本 2026-07-01 建模 Euro VI 代表限值 | https://www.gesetze.li/konso/1996143000 | 已核验（VTS Art. 3、4、52 与 Anhang 4 Ziff. 211、211a 直接读回） |
| construction / agriculture | LGBl. 2020 Nr. 258，EWR Joint Committee Decision 39/2020 | 公告明确列支敦士登生效日 2020-08-01；Decision 39/2020 将 EU 2016/1628 纳入 EWR 协定并删除旧 97/68/EC 条目。本批保存 Stage V NRE 代表功率带 | https://www.gesetze.li/konso/2020258000 | 已核验（公告正文及 EWR 纳入条目直接读回） |

数据语义：`LI-NATIONAL` 自 2020-08-01 建立国家辖区关系。道路限值的国内身份
来自 VTS，数值追溯 EU 595/2009/582/2011；非道路国内适用日期来自 LGBl. 2020
Nr. 258，数值追溯 EU 2016/1628。由于道路首次实施日尚未从官方历史版本重建，
不从 EWR 身份或邻国日期反推更早起点。

### 1.31 瑞士（CHE）

责任机构：瑞士联邦道路局（ASTRA）与联邦行政机构维护道路车辆技术规则。2026-08-08
从 Fedlex 直接读回 VTS SR 741.41 现行合并文本（Stand 01.07.2026）及 Anhang 5。

| scope | 正式文书/入口 | 状态与关键日期 | 官方 URL | 核验 |
| --- | --- | --- | --- | --- |
| on-road-truck / on-road-bus | VTS SR 741.41 Anhang 5 Ziff. 211 | 重型 M/N 发动机必须符合 Regulation (EC) No. 595/2009 或 UNECE R49；本批从现行合并版本 2026-07-01 建模 Euro VI 代表限值，未宣称首次国内实施日 | https://www.fedlex.admin.ch/eli/cc/1995/4425_4425_4425/de | 已核验（Art. 52、Anhang 5 Ziff. 211 直接读回） |
| construction / agriculture | VTS SR 741.41 Anhang 5 Ziff. 211a/211b | 工作发动机与拖拉机可按 EU 2016/1628；当前文本未提供完整 Stage V 市场投放时间线，本批从 2026-07-01 当前版本建模代表功率带 | https://www.fedlex.admin.ch/eli/cc/1995/4425_4425_4425/de | 已核验（Ziff. 111/112/121/211a/211b 直接读回） |

数据语义：`CH-NATIONAL` 自 2026-07-01 建立可追溯国家辖区关系。法规身份来自
瑞士 VTS；道路数值追溯 EU 595/2009/582/2011，非道路数值追溯 EU 2016/1628。
当前 Fedlex 文本能证明合规入口但不能单独重建首次实施日期，因此不从 EU/EEA
身份、邻国规则或历史引用反推更早有效期。

### 1.32 摩洛哥（MAR）

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| `Bulletin Officiel n°7361 — Arrêté conjoint n°2094.24`；publisher `Secrétariat Général du Gouvernement du Maroc`；`official-regulation`；published `2024-12-16` | https://www.sgg.gov.ma/BO/AR/3111/2024/BO_7361_Ar.pdf | 已核验并渲染 printed p.9663 / PDF p.5；SHA-256 `7e6fb4f016823a3146c157904523a1cf780b271db068088157a7cabbf40c33d6` |
| `Bulletin Officiel n°7028 — Arrêté conjoint n°2251-21 du 5 août 2021`；publisher `Secrétariat Général du Gouvernement du Maroc`；`official-regulation`；published `2021-10-07` | https://www.sgg.gov.ma/BO/bo_fr/2021/BO_7028_Fr.pdf | 已核验并渲染 printed pp.1955–1957 / PDF pp.53–55；SHA-256 `d38398cb8b8e835c65fdf768d449c5553b98f88df999970ebf3b3e64ea3cacbc` |

Arrêté 2251-21 已公开道路重型 WHSC/WHTC 完整表及循环。WHSC 为 CO 1500、THC 130、
NOx 400、PM 10 mg/kWh、PN 8×10¹¹ #/kWh、NH3 10 ppm；WHTC 为 CO 4000、
THC 160、NOx 460、PM 10 mg/kWh、PN 6×10¹¹ #/kWh、NH3 10 ppm。Arrêté 2094.24
又将 M2/M3/N1/N2/N3 homologation 与 registration 节点分别推迟到 2027-01-01、
2028-01-01；截至本轮仍属未来，truck/bus 因实施日门槛失败而 no-data。2836-10/
3400-12 的公开公报仍未提供非道路原件附件中的功率表和认证循环，construction/
agriculture 也保持 no-data。两条 source 的统一核验时刻为
`2026-08-10T18:48:04Z`；本次只刷新 source，不新增 limit。

### 1.33 肯尼亚（KEN）

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| `The Environmental Management and Coordination (Air Quality) Regulations (Legal Notice 180 of 2024) — legislation as at 24 March 2025`；publisher `Kenya Law / Republic of Kenya`；`official-regulation`；originally published `2024-12-06` | https://new.kenyalaw.org/akn/ke/act/ln/2024/180/eng@2025-03-24/source.pdf | 已核验并渲染 printed pp.10–11 / PDF pp.15–16；SHA-256 `109577ef5b1e0e15a748ddc6ffa528e85a5ce7453f272c08f582fa307363e989` |
| `The Traffic (Motor Vehicle Inspection) Rules, 2026 (Legal Notice 13 of 2026)`；publisher `Kenya Law / Republic of Kenya`；`official-regulation`；published `2026-02-13`；commenced `2026-07-01` | https://new.kenyalaw.org/akn/ke/act/ln/2026/13/eng@2026-02-13/source.pdf | 已核验并渲染 printed pp.1、2、4 / PDF pp.5、6、8；SHA-256 `16c813be2c6c1c6b31fb413164dd3d21e394eb718f7941482fae720055dcffc9` |

LN 180/2024 最新合并文本仍将商用/公共车辆纳入周期排放检查并引用 KS 1515 /
EAS 1047；2025 两次修订没有把它变为新发动机型式认证。LN 13/2026 规定注册前及
周期车辆检验，仍是 inspection。公开材料未给新重型发动机完整表与认证循环，所引
标准又未公开/需付费，故四 scope no-data。不把在用/注册前检查或付费标准元数据
升级为型式认证限值。统一核验时刻 `2026-08-10T18:48:04Z`；本次只刷新 source，
不新增 limit。

### 1.34 尼日利亚（NGA）

责任机构：联邦环境部与 National Environmental Standards and Regulations Enforcement
Agency（NESREA）负责环境标准、法规和执行。2026-08-09 从 NESREA 官方法规目录读回
`National Environmental (Control of Vehicular Emissions from Petrol and Diesel
Engines) Regulations, S.I. No. 20, 2011` 扫描件。Official Gazette No. 47 标示
2011-05-17 发布；文末标示 2011-04-28 制定。

Regulation 17(2) 要求 2015-01-01 起的新车型符合 Schedule VIII，Regulation 18 将
范围限定为至少两轮、设计最高车速超过 25 km/h 的道路车辆。Schedule VIII item 1
对总质量超过 3.5 吨的柴油机给出 CO 2.1、HC 0.66、NOx 5.0 g/kWh。本批将这三项
分别映射到 `on-road-truck` 和 `on-road-bus`；扫描件 PM 单元格印刷为含义不明的
`0.100.13`，因此不猜填 PM。`construction` 与 `agriculture` 继续返回 `no-data`，
不得用 ECOWAS、欧盟/UNECE 或二手政策摘要补齐非道路范围。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| 联邦环境部入口 | https://www.environment.gov.ng/ | 已核验（2026-08-09：官方页面可读） |
| NESREA 法规目录 | https://nesrea.gov.ng/laws-regulations/ | 已核验（2026-08-09：目录列出 S.I. No. 20, 2011 并链接官方 PDF） |
| S.I. No. 20, 2011 扫描件 | https://nesrea.gov.ng/wp-content/uploads/2025/05/Control_of_Vehicular_Emissions_from_Petrol_and_Diesel_Engines_Regulation-2011-.pdf | 已核验（Official Gazette B615–B635；Regulations 17(2)、18；Schedule VIII item 1） |

### 1.35 埃及（EGY）

EEAA 官方门户直接提供“车辆尾气”主题页和环境法栏目。环境法栏目列出 Law No. 4 of
1994、Prime Minister Decree No. 338 of 1995 实施条例及后续修正；车辆尾气页明确道路
检查按该实施条例中的限值执行。Decision No. 710 of 2012 Annex 6 已完整读回：printed
pp.26–27 的汽油表是怠速 CO/HC，柴油表按车型年份给出 ISO 11614 烟度 K 值及等效
不透光度。该表属于在用车辆检查，既没有新重型发动机类别/功率边界，也没有发动机认证
循环，不能映射成项目的 g/kWh 型式认证 fixture。因此 `EG-NATIONAL` 四个 scope 继续
保持 `no-data`；“表不可读/未核验”的旧说明由本段 superseded。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| EEAA 环境法入口 | https://www.eeaa.gov.eg/Laws/55/index | 已核验（2026-08-09） |
| EEAA 车辆尾气主题页 | https://www.eeaa.gov.eg/Topics/77/27/Details | 已核验（道路检查与交通许可执行边界） |
| Prime Minister’s Decree No. 338 of 1995 | https://www.eeaa.gov.eg/Uploads/Laws/Files/20221010124857366.doc | 官方实施条例来源；SHA-256 `4c3ec84b5c3d272bf8f06713dd0cab058ea6eab006059e0962c78550b9085d4c` |
| Prime Minister’s Decision No. 710 of 2012 | https://www.eeaa.gov.eg/Uploads/Laws/Files/20250526101230761.pdf | 已核验并渲染 Annex 6 printed pp.26–27 / PDF pp.25–26；SHA-256 `e05f3764b4cb7b1a7d547360dcbe21f52937e98f2decf1ff9e9913a13f11cae1`；已读回但属怠速/ISO 11614 在用检查 |

### 1.36 加纳（GHA）

Ghana Environmental Protection Authority 官方门户提供 `Laws & Regulations` 目录。
2026-08-09 读回页面只列 Environmental Protection Act, 2025 (Act 1124) 的概述，
`Regulations` 标题下没有车辆或发动机法规条目，也没有重型柴油限值表、实施日期和完整
适用范围。因此建立 `GH-NATIONAL` 来源边界，四个 scope 保持 `no-data`。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| EPA 官方入口 | https://www.epa.gov.gh/new/ | 已核验（2026-08-09） |
| EPA 法规目录 | https://www.epa.gov.gh/new/laws-regulations/ | 已核验（2026-08-09；仅列 Act 1124 概述，Regulations 区域无车辆排放正文） |

### 1.37 以色列（ISR）

以色列环境保护部官方门户明确提供空气质量、交通和空气污染主题；交通与道路安全
部为车辆主管机构。2026-08-09 复核两个官方入口及政府站内查询，仍未读回可发布的
重型柴油限值表、适用范围和生效日期，因此建立 `IL-NATIONAL` 来源边界，四个 scope
保持 `no-data`，不从欧盟或 UNECE 参考路径外推以色列现行法规。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| 环境保护部入口 | https://www.gov.il/he/departments/ministry_of_environmental_protection | 已核验（2026-08-09） |
| 交通与道路安全部入口 | https://www.gov.il/he/departments/ministry_of_transport_and_road_safety | 已核验（2026-08-09；未读回重型柴油限值表） |

### 1.38 巴基斯坦（PAK）

Pak-EPA 官方 Gazette PDF 的 Annex III 只给出车辆加速烟度 40% / Ringelmann 2、
怠速 CO（新车 4.5%、在用车 6%）和噪声门槛；2025 年官方执法页确认现行
S.R.O. 72(KE)/2009 仍用于柴油卡车烟度检查。两者均未提供重型新发动机型式认证所需
的适用车型、试验循环和 g/kWh 污染物表，且当前 schema 没有在用车/年检条件维度，
因此建立 `PK-NATIONAL` 来源边界，四个 scope 保持 `no-data`。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| S.R.O. 742(I)/93 与 1023(I)/95，Annex III | https://environment.gov.pk/SiteImage/Misc/files/SRO742I93SRO1023I95NEQS.pdf | 已核验（2026-08-09，p.4；仅加速烟度、怠速 CO 和噪声） |
| S.R.O. 72(KE)/2009 现行执法说明 | https://environment.gov.pk/NewsDetail/Y2Q0NjJhNDUtZjEzNC00YjFkLWI2OTgtODBlMmQ5NDU3YjZh | 已核验（2026-08-09；2025 柴油卡车烟度执法，不是新发动机认证表） |

### 1.39 卡塔尔（QAT）

交通部公告只证明 2023 款进口公交和卡车使用 EURO5-equivalent 清洁柴油的政策，
不是新发动机型式认证文书。Ministerial Decision No. 125 of 2019 的 Gazette No. 13
记录及附件项目 44–46 采用 QS GSO 144/145/146:1991，但未闭合当前新重型发动机
类别/功率、完整 CO/HC/NOx/PM(/PN) 表、法定循环和 Euro V 国内实施日。GSO
MY2026-D5 的 Qatar `Euro5` 标签也受其 p.6“各国规则仍适用”约束，不能替代本国
采纳/实施链。因此 `QA-NATIONAL` 恰好保留下列两条 accepted source，四 scope
`no-data`，零 regulation/limits。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| `Ministry to Apply EURO5-Equivalent Clean Diesel Fuel Policy for Buses, Trucks in 2023`；publisher `Qatar Ministry of Transport`；`government-notice`；published `2021-11-08` | https://www.mot.gov.qa/en/news/ministry-apply-euro5-equivalent-clean-diesel-fuel-policy-buses-trucks-2023 | 已核验；燃油/进口政策，不是完整发动机认证链 |
| `Ministerial Decision No. 125 of 2019 Adopting Qatari Technical Regulations`；publisher `Qatar Ministry of Justice / Al Meezan Legal Portal`；`official-regulation`；published `2019-06-20` | https://www.almeezan.qa/LawPage.aspx?id=8020&language=ar | 已核验 LawID 8020、Gazette No. 13 p.80 与附件记录 17259 项目 44–46；翌日生效，但标准身份不能补齐当前五门槛 |

### 1.40 科威特（KWT）

Ministerial Decision No. 372/1992 p.3 把 Gulf Standards 474/475/476 采用为 Kuwaiti
Standards，但 pp.4–5 的六个月强制清单没有这三项。Resolution No. 44/2015 的附件
p.4 把 KWS GSO 42:2015 列为 technical regulation，仍未给新重型发动机完整污染物表、
认证循环或 Euro V 国内实施链。GSO MY2026-D5 的 Kuwait `Euro5` 标签同样不能绕过
其 p.6 国家规则保留条款。因此 `KW-NATIONAL` 恰好保留下列两条 accepted source，
四 scope `no-data`，零 regulation/limits；旧 EPA 在用车烟度材料退出当前双源图。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| `Ministerial Decision No. 372/1992 Adopting Gulf Standards as Kuwaiti Standards`；publisher `Kuwait Ministry of Commerce and Industry / Kuwait Today / Public Authority for Industry`；`official-regulation`；published `1992-11-15` | https://ksm.pai.gov.kw/_vti_bin/Store_WCF/Store.svc/RetrieveBinaryDocumentForPDFViewerMinisterial?docid=39 | 已下载、抽取并渲染 pp.3–5；SHA-256 `3811a5f249051200d0dfbd60688fae6c252171e58c351e0036ec2e8d2c8bdd95` |
| `Ministerial Resolution No. 44/2015 and List of Adopted Standards and Technical Regulations`；publisher `Kuwait Public Authority for Industry`；`official-regulation`；published `2015-11-29` | https://www.pai.gov.kw/en/documents | 已核验决定及附件；决定 SHA-256 `b16b64a42d2933c0898df0612c1ef005ca507ac8a3dd1ed49e75bd805e0853a8`，附件 SHA-256 `d0f0055ae38bdd41d0e7a1a2e38eac8726736e3f4a1507267efd137bb59df5b0` |

### 1.41 阿曼（OMN）

Official Gazette No. 1540 的 Decision No. 120/2024 仅把其附件列出的 GCC 标准设为
binding Omani standards；附件中的 GSO 42/48 及安全/轮胎项目没有提供本项目所需的
新重型柴油完整表和循环。GSO MY2026-D5 p.7 对 Oman 仅写 `<Euro4`，p.12 又只对
Saudi Arabia 明列 ECE 49 Heavy Duty Euro V，且 p.6 明确各国规则仍适用。因此 GSO
清单只是核验边界，不能单独证明 Oman 国内 Euro V 采纳/实施。`OM-NATIONAL` 恰好
保留下列两条 accepted source，四 scope `no-data`，零 regulation/limits。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| `Official Gazette No. 1540 — Ministerial Decision No. 120/2024 Considering GCC Standards Binding Omani Standards`；publisher `Oman Ministry of Justice and Legal Affairs / Official Gazette`；`official-regulation`；published `2024-04-07` | https://www.mjla.gov.om/images/legislation/file/Book699179.pdf | 已下载、抽取并渲染 PDF pp.21–24；2024-04-08 生效；SHA-256 `d4f040fadb27651384b77adf89675a587b7d63fddb095e5e3d49302646dbc582` |
| `List of GSO Technical Regulations for Motor Vehicles (2026 Model Year), MY2026-D5`；publisher `GCC Standardization Organization (GSO)`；`official-regulation`；published `2025-01-02` | https://www.gso.org.sa/wp-content/uploads/2025/01/GSO-Technical-Regulations-MV-2026-MY-D5.pdf | 已下载、抽取并渲染 pp.6–7、12；SHA-256 `4c001a837b95879a7802114ef768fd7063fe0980d30c420af8f16d124427d4b1` |

### 1.42 约旦（JOR）

环境部 Transport Sector plan 明确 Jordan 没有强制的新车排放标准；文中的重型车
`Euro III equivalent` 是现状描述，不是新发动机实施链。JSMO 当前 13.040.50 目录只
能确认 JS 1053:1998 与 JS 1054:1998 的标准身份；正文付费、日期显示 N/A，无法核验
完整表、法定循环和国内实施日。因此 `JO-NATIONAL` 恰好保留下列两条 accepted
source，四 scope `no-data`，零 regulation/limits。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| `Transport Sector Green Growth National Action Plan 2021–2025`；publisher `Jordan Ministry of Environment`；`government-notice`；`publishedOn=null`（官方文件只给 July 2020 月份精度） | http://moenv.gov.jo/ebv4.0/root_storage/en/eb_list_page/2022_jordan_transport_v10.pdf | 已核验官方 72 页计划；明确没有强制新车排放标准 |
| `JSMO Standards Catalogue — Transport Exhaust Emissions (JS 1053:1998 and JS 1054:1998)`；publisher `Jordan Standards and Metrology Organization`；`government-notice`；`publishedOn=null` | https://eservice.jsmo.gov.jo/en/Standards/IcsAmfn/1304050 | 已核验当前目录；付费正文、日期 N/A，不能闭合表/循环/实施日 |

### 1.43 柬埔寨（KHM）

柬埔寨标准局公开的 Prakas No. 150 MIH (2016) 表 2 将 `CTR 142:2016 / CS
535:2016 (UNR49)` 列为 19 项汽车技术法规之一，但扫描件没有给出 UN R49 修订系列、
国内分期日期或数值表。国家贸易资料库的 Sub-Decree No. 42 Annex 4 则规定所有柴油车
黑烟 50%，属于移动源/在用车辆检查语境，不是重型新发动机型式认证。因此更新
`KH-NATIONAL` 为精确法规来源边界，四个 scope 继续 `no-data`。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Prakas No. 150 MIH (2016)，19 项汽车技术法规 | https://res.cloudinary.com/dgvyfitu8/image/upload/v1733987381/Prakas_No_150_MIH_2016_on_19_Automotives_Technical_Regulations_bdb6d255a4.pdf | 已核验官方 ISC 链接及扫描件第 2 页（2026-08-09；R49 修订系列和数值表缺失） |
| Sub-Decree No. 42，Articles 5/11/18/38 与 Annex 4 | https://cambodiantr.gov.kh/en/document/?title=sub-decree-no-042-air-pollution-and-noise-disturbance-control | 已核验（2000-07-01；50% 黑烟为移动源检查值） |

### 1.44 老挝（LAO）

《内陆车辆法》No. 04/NA Articles 24–25 要求境内制造/组装车辆通过安全和环境检测，
进口车辆提交出口国技术证书；Article 42 将 CO、HC 与排气噪声列入技术检查，但明确
具体标准和方法另行规定。Lao Trade Portal 的进口车辆措施同样只要求满足安全、环境
标准，没有给出重型柴油机污染物限值或试验循环。交通部项目附件中可见的黑烟表是
道路项目对 Decree No. 81/GoL 国家环境标准的摘录，并非新发动机认证表。因此
`LA-NATIONAL` 四个 scope 继续 `no-data`。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Law on Inland Vehicles No. 04/NA | https://www.laotradeportal.gov.la/en-gb/site/display/2475 | 已核验（2021-11-16；Articles 24–25、42，具体排放标准另行规定） |
| Provisions on Technical Standards and Accessories of Vehicles Authorized for Import, Registration and Assembly No. 4312/MCTPC | https://www.laotradeportal.gov.la/en-gb/site/display/45 | 已核验（2002-11-11；进口、登记与组装技术证明要求，无新重型发动机完整限值表） |

### 1.45 斯里兰卡（LKA）

Gazette Extraordinary No. 2079/42 替换了法规 Part III 与 Third Schedule：Table 5
对 GVW > 3,500 kg 的柴油车辆和重型发动机给出 ESC 的 CO/THC/NOx/PM 限值及自由
加速烟度；Table 6 对工程设备车辆按六个功率带给出 ISO 8178-4 C1/D2 限值。
Gazette No. 2079/70 闭合 `2018-07-13` 实施边界；其 clause 8 同时保留
2018-07-12 及以前开立信用证、并在 2018-10-31 前进口车辆的过渡豁免。当前 fixture
向 `on-road-truck`、`on-road-bus` 与 `construction` 发布 34 条代表限值；C1/D2
以及 Third/Fifth Schedule 均为替代路径而非累计要求，`agriculture` 保持 `no-data`。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Gazette Extraordinary No. 2079/42，Third Schedule Tables 5–6 | https://documents.gov.lk/view/egz/2018/7/2079-42_E.pdf | 已核验（2018-07-12；6 页正文及表格逐页核对） |
| Gazette Extraordinary No. 2079/70，Imports and Exports (Control) Regulation No. 2 of 2018 | https://documents.gov.lk/view/egz/2018/7/2079-70_E.pdf | 已核验（2018-07-13；实施边界及 clause 8 信用证过渡豁免） |

### 1.46 蒙古（MNG）

蒙古现行《空气质量技术法规》与通过该法规的 Government Resolution No. 148/2021
共同建立法律入口；技术法规第 3.8 条引用柴油车辆烟度标准，但公开正文未闭合新重型
发动机类别、完整数值表、法定认证循环和实施边界。上述证据只能支持烟度/技术法规
边界，不能直接填充现有新重型发动机模型。因此 `MN-NATIONAL` 四个 scope 继续
`no-data`。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Air Quality Technical Regulation | https://legalinfo.mn/mn/detail?lawId=16207241573351&showType=1 | 已核验（2021-05-19；§3.8 引用车辆烟度标准，未载完整新发动机认证表） |
| Government Resolution No. 148/2021 approving the Air Quality Technical Regulation | https://legalinfo.mn/mn/detail?lawId=16207241555111&type=3 | 已核验（2021-05-19；法规批准与实施入口） |

### 1.47 哥斯达黎加（CRI）

2026-08-09 从 PGR/SCIJ 法律信息系统读回现行 Executive Decree 39724 与 Law 9078
Article 38。Decree 39724 以道路在用车浓度/烟度检查为主；其新入境技术要求只明确覆盖
汽车和不超过 3,500 kg 的轻型货车。Law 9078 Article 38 同时明确排除农业、工业和
工程机械（起重车辆除外）。因此没有把轻型车进口条件或在用车烟度外推到四类新重型
发动机/车辆范围，`CR-NATIONAL` 四个 scope 继续 `no-data`。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Executive Decree 39724 现行法规记录 | https://pgrweb.go.cr/scij/Busqueda/Normativa/Normas/nrm_norma.aspx?nValor1=1&nValor2=81619&nValor3=0&param1=NRM&strTipM=FN | 已核验（2016-05-30 生效；Article 7 轻型入境边界、Article 9 在用车边界） |
| Law 9078 Article 38 | https://pgrweb.go.cr/scij/Busqueda/Normativa/normas/nrm_articulo.aspx?nValor1=1&nValor2=73504&nValor3=104107&nValor5=39&param1=NRA&strTipM=FA | 已核验（非道路农业/工业/工程机械排除） |

### 1.48 厄瓜多尔（ECU）

RTE INEN 017:2008 是进口或国产机动车商业化前的强制排放控制法规，包含公交和重型
货车税则范围；第 2.3 条明确排除道路施工设备、工业设备和农业机械。第 4.1、5.2、
6.2(b) 条把柴油限值、重量分类和试验循环全部引用到 NTE INEN 2207，而 INEN 当前页面
确认使用 NTE INEN 2207:2002，且标准正文因版权不开放免费下载。本批没有从公开官方
正文读回数值表，故道路卡车/客车不猜填；construction/agriculture 按明文排除保持
`no-data`。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| INEN 机动车检验说明 | https://www.normalizacion.gob.ec/inspeccion-de-vehiculos-automotores-bajo-reglamentos-tecnicos-inen/ | 已核验（当前页面明确 RTE 017、NTE 2207:2002 与柴油车检验关系） |
| RTE INEN 017:2008 | https://www.normalizacion.gob.ec/buzon/reglamentos/RTE-017.pdf | 已核验并逐页渲染（强制范围、2.3 排除、4.1/5.2/6.2 引用边界） |

### 1.49 多米尼加共和国（DOM）

环境部 2017 年《移动源大气污染物排放控制技术环境法规》第 1 条把对象限定为“在用
机动车”。柴油 Article 9/Table 8 是自由加速烟度，Table 9 虽列 Euro II/IV 等效的
g/km 数值，但仍属于按制造年份管理的在用车辆标准，且未给重型客货车独立分类、发动机
型式认证循环或非道路机械边界。INTRANT 的现行法律基础同样落在车辆技术检查。本批不把
在用车表转换成新重型发动机法规，四个 scope 保持 `no-data`。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| 移动源排放控制技术环境法规 PDF | https://ambiente.gob.do/wp/download/1771/anexo-g-leyes-y-normas/292300/reglamento-tecnico-ambiental-fuentes-moviles.pdf | 已核验并逐页渲染（Article 1、Article 9、Tables 8–9） |
| INTRANT 车辆技术检查法律基础 | https://intrant.gob.do/transparencia/base-legal-de-la-institucion/resoluciones-base-legal/ | 已核验（机动车技术检查与协议目录；未形成新发动机认证表） |

### 1.50 阿尔及利亚（DZA）

JORADP 2003 年第 68 号公报刊载 Executive Decree 03-410。Article 3 与 Article 4(a)
明确区分 `contrôle de conformité`（一致性控制）和 `contrôle technique périodique`
（定期技术检查）；前者直接给出四个 scope 的车辆级烟度及 CO/HC/NOx/颗粒物限值。
ONEDD 2021-03-27 的大气污染法规索引仍列出该法令。本批按 2003-11-09 公报日期创建
effective regulation，但不把它标作 Euro 等级，也不补写 Article 6 留给联合部令的
测量方法。

| scope | 一致性控制限值 | 官方 URL | 核验 |
| --- | --- | --- | --- |
| on-road-bus（PTAC > 3.5 t） | CO 4、HC 1、NOx 7、PM 0.15 g/km；烟度 1.7 m⁻¹ | https://www.joradp.dz/FTP/jo-francais/2003/F2003068.pdf | 已核验（Articles 3–4，公报 pp.16–18 原表视觉对齐） |
| on-road-truck（PTAC > 3.5 t） | CO 4、HC 1、NOx 7、PM 0.1 g/km；烟度 1.7 m⁻¹ | 同上 | 已核验（续表） |
| agriculture | 37<P≤75：CO 6.5/HC 1.3/NOx 9.2/PM 0.85；75<P≤130：5/1.3/9.2/0.70；P>130：5/1.3/9.2/0.54 g/km；烟度 2.3 m⁻¹ | 同上 | 已核验；严格端点按数据库 0.001 kW 分辨率编码 |
| construction | CO 6、HC 1.3、NOx 9.2、PM 0.9 g/km；烟度 2.3 m⁻¹ | 同上 | 已核验（`véhicules spéciaux et engins de travaux publics`） |
| 现行法规索引 | ONEDD 大气污染法规页列出 Decree 03-410 | https://onedd.org/pollution-atmospherique/ | 已核验（ONEDD 为环境部主管机构） |

### 1.51 突尼斯（TUN）

突尼斯环境部的官方“环境立法”页面最后更新于 2026-05-22；其“污染与危害防治”
分类只列出 1984 年车辆定点噪声检查等条目，没有柴油尾气或新发动机型式认证限值。
交通部“道路运输法律法规”目录可读，但当前目录列出的文书涉及运输经营、许可、车辆
使用和行业组织，同样没有重型柴油道路/非道路限值表、完整适用范围和实施日期。因此
建立 `TN-NATIONAL` 来源边界，四个 scope 保持 `no-data`。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| 环境部污染与危害防治法规分类 | https://www.environnement.gov.tn/legislation-environnementale/la-lutte-contre-les-pollutions-et-les-nuisances | 已核验（2026-08-10；仅见车辆噪声检查条目，未读回柴油排放限值表） |
| 交通部道路运输法律法规目录 | https://www.transport.tn/fr/terrestre/reglement | 已核验（2026-08-10；未读回发动机型式认证文书或限值表） |

### 1.52 埃塞俄比亚（ETH）

交通与物流部发布的 Directive No. 1051/2025 将埃塞俄比亚标准协会车辆排放标准纳入
全国车辆排放控制体系，并规定自交通部网站发布日起生效；官方目录发布日期为
2026-07-25。ES 6725:2022 Part 1 Table 1 对新制造/组装或进口的 N2/N3 柴油车给出
CO 1.50、NOx 3.5、PM 0.02 g/kWh，测试方法 ISO 16183:2002。本库据此只发布
`on-road-truck` 三项无歧义数值；表中 0.46 一列同时标为 `HC+NOx` 且另有 NOx 列，
因此不猜写。该表没有 M2/M3、工程或农业型式认证行，后三个 scope 保持 `no-data`。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Directive on Emission Control of Pollutants from Vehicle No. 1051/2025 | https://motl.gov.et/sites/default/files/resource/5051_Emission%20of%20pollutant%20gas%20Directive.pdf | 已核验（scope、标准并入条款、生效条款） |
| ES 6725:2022 Part 1 — Road vehicles | https://www.motl.gov.et/sites/default/files/resource/emission%20standard.pdf | 已核验（Table 1 N2/N3；只录入无歧义 CO/NOx/PM） |

### 1.53 危地马拉（GTM）

MARN《Memoria de Labores 2025–2026》记录 2025 年安装了用于建立首批官方排放参数的
设备，并明确预计 2027 年才发布国家排放控制法规。该未来计划不是现行法规；报告另记
2026-01 起柴油硫含量降至 15 ppm，但燃油质量要求不能替代发动机型式认证表。因此
`GT-NATIONAL` 四个 scope 继续 `no-data`。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| MARN Memoria de Labores 2025–2026 | https://www.marn.gob.gt/Descargar/1277/informe-ambiental-2023/31333/memoria-de-labores-2025-2026.pdf | 已核验（p.24：国家法规预计 2027 年发布） |
| MARN 官方入口 | https://www.marn.gob.gt/ | 已核验（2026-08-10） |

### 1.54 洪都拉斯（HND）

2024 年第 36 号《合理与高效用能法》要求能源、交通与环境主管机构后续共同制定在该国
销售机动车应满足的排放水平，本身未给出污染物数值、循环或实施表。Executive
Agreement 1566-2010 虽有排放限值，但 Article 4 明文排除车辆排放，只管固定源。
两份官方正文共同证明当前可发布边界，`HN-NATIONAL` 四 scope 保持 `no-data`。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Decree 36-2024《合理与高效用能法》 | https://www.tsc.gob.hn/web/leyes/Decreto-36-2024.pdf | 已核验（La Gaceta 36,594 p.6：授权后续建立车辆排放水平） |
| Executive Agreement 1566-2010 固定源法规 | https://www.tsc.gob.hn/web/leyes/Reglamento%20para%20el%20control%20de%20emisiones%20generadas%20por%20fuentes%20fijas.pdf | 已核验（Article 4 明文排除车辆排放） |

### 1.55 巴拿马（PAN）

Official Gazette No. 26303 的 Executive Decree No. 38/2009 设置机动车空气排放
控制，但执行边界是道路车辆年度检验；其柴油表属于在用车烟度/不透光度控制，不是新
重型发动机型式认证 g/kWh 路径。法规还排除无需道路通行许可的农业和工程机械。因此
本库保留精确公报与 MiAMBIENTE 法规目录，四 scope 继续 `no-data`，并移除原先误用的
劳工部入口。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Executive Decree No. 38/2009 | https://www.gacetaoficial.gob.pa/pdfTemp/26303/18123.pdf | 已核验（年度检验/在用车控制边界；Gaceta 26303，2009-06-15） |
| MiAMBIENTE 法规目录 | https://miambiente.gob.pa/normativa/ | 已核验（2026-08-10） |

### 1.56 乌拉圭（URY）

Decreto 135/021 Article 48/Table 17 对质量超过 2,610 kg 的零公里压燃式 M/N 车辆
给出 Directive 2005/55/EC Euro V 路径。Table 14 将 M2/M3 识别为客车、N2/N3 识别
为货车；官方 homologation procedure 自 2023-05-14 实施。本库对卡车和客车分别保存
ESC 的 CO 1.5、HC 0.46、NOx 2.0、PM 0.02 g/kWh、烟度 0.5 m⁻¹，以及 ETC 的
CO 4.0、NMHC 0.55、NOx 2.0、PM 0.03 g/kWh。Article 52 只授权未来另行规定其他
移动源，故 construction/agriculture 不外推。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Decreto 135/021 空气质量法规 | https://www.ambiente.gub.uy/oan/documentos/DCA-Decreto_135_021_calidad_de_aire-2021.pdf | 已核验并渲染（pp.29–31，Tables 14/17） |
| 车辆排放 homologation procedure V5 | https://www.gub.uy/ministerio-ambiente/comunicacion/publicaciones/procedimiento-homologacion-emisiones-vehiculares-v5 | 已核验（当前 M/N 新车程序与实施链） |

### 1.57 博茨瓦纳（BWA）

BOBS 的 BOS 134:2014 ed.2 明确覆盖在用汽油/柴油车辆的 CO、HC 和烟度/不透光度检测，
但目录同时把法律状态标为 **Voluntary**；它是车辆状态/维护检查规范，不是强制的新重型
发动机型式认证表。政府 e-Laws 页面提供现行法律检索入口，当前仍未定位到可发布的强制
重型道路或非道路柴油限值。因此 `BW-NATIONAL` 四个 scope 保持 `no-data`。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| BOS 134:2014 ed.2 在用车排放测量规范 | https://bobstandards.bw/product/bos-1342014-ed-2/ | 已核验（2026-08-10；页面明示 voluntary，不作为强制型式认证） |
| Botswana e-Laws 新法规检索入口 | https://www.gov.bw/legal/search-botswana-new-legislation | 已核验（2026-08-10；未读回独立重型柴油限值表） |

### 1.58 纳米比亚（NAM）

工程与交通部 Transportation Policy and Regulation Directorate 明确负责运输政策、
行业合规以及区域技术标准协调；NSI 技术委员会目录将车辆与道路安全纳入标准化工作。
两个官方入口均未公开当前国内强制的新重型柴油发动机污染物表、试验循环或实施日期，
因此 `NA-NATIONAL` 四个 scope 保持 `no-data`，不从南非标准或财政 CO2 levy 外推。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Transportation Policy and Regulation Directorate | https://mwt.gov.na/directorate-of-transportation-policy-and-regulation | 已核验（2026-08-10；职责页无数值表） |
| NSI 车辆/道路安全标准技术委员会入口 | https://www.nsi.com.na/technical-commitee/ | 已核验（2026-08-10；未读回强制发动机限值） |

### 1.59 坦桑尼亚（TZA）

NEMC 现行 regulations 目录列出 2007 Air Quality Standards Regulations，官方 PDF 的
Regulation 12 要求车主、驾驶人或控制人保证车辆运行时符合 Fourth Schedule。Table C
虽列出重型柴油机 CO/NOx/HC/PM/Smoke 数字，但指定 TZS 985/ISO 3929 与 TZS 986/
ISO 3930 车辆尾气分析方法；更关键的是该官方副本首页仍保留空白 Government Notice、
发布日期和末页签署日期。TBS 后续 DEAS 1047:2021 又明确标为 draft。当前证据不足以把
在用车合规表或未完成公报信息的副本升级为新发动机型式认证法规，四个 scope 保持
`no-data`。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Environmental Management (Air Quality Standards) Regulations, 2007 | https://www.nemc.or.tz/uploads/publications/sw-1645446559-Air_Quality_Standards_Regulations_2007.pdf | 已核验并渲染 pp.1、7、21–22（2026-08-10；空白公报字段与车主/驾驶人运行合规语义保留） |
| DEAS 1047:2021 vehicular exhaust emission limits | https://tbs.go.tz/uploads/publications/en-1614851315-Vehicular%20emission%20DEAS.pdf | 已核验（2026-08-10；明确是 draft，不作为 effective） |

### 1.60 乌干达（UGA）

NEMA 官方目录已发布 S.I. No. 22 of 2024。Regulations 2、9–10 覆盖全部内燃机，禁止
进口不符合 Schedule 4 的新旧机动车/移动源，并要求运行与检查合规；公报补编日期为
2024-04-26，法规制订日为 2023-11-09。该 effective regulation 作为元数据入库。

数值暂不入库：Schedule 4 的重型商业车辆表在原版视觉上确实印为 `kg/kWh`；同一表的
“GVW”行又把 C/CE 写成 `≤750 kg`，与随后 C 类车辆 `>3,500 kg`、CE 为挂接 >750 kg
拖车的定义冲突，且标题包含 F/G 但没有可独立映射的 F/G 行。UNBS 官方目录确认
US EAS 1047:2022 为 compulsory，却未公开可核对的数值正文。没有官方勘误前，不把
`kg/kWh` 擅自修正成 `g/kWh`，也不把错位类别外推至卡车、客车、工程机械或拖拉机；
四个 scope 继续返回 `no-data`，但国家详情保留有效法规与强制标准证据链。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| National Environment (Air Quality Standards) Regulations, 2024, S.I. No. 22 | https://www.nema.go.ug/en/wp-content/uploads/2025/01/The-National-Environment-Air-Quality-Standards-Regulations-S.I.-No.-22-of-2024-1.pdf | NEMA 目录与全文已核验；同版公报经 ULII 镜像渲染 pp.333–335（2026-08-10） |
| US EAS 1047:2022 — Air quality — Vehicular exhaust emission limits | https://webstore.unbs.go.ug/store.php?preview=&src=5321 | 已核验（2022-12-13 发布、Status=Compulsory；公开页无数值正文） |

### 1.61 赞比亚（ZMB）

ZEMA 官方发布的 S.I. No. 112 of 2013 第 5(2) 条把排放限值限定到排放空气污染物的
`plant, undertaking or process`，第二附表按环境空气与行业/工艺列值，不是机动车或
发动机型式认证表。RTSA 官方《Road Traffic Act No. 11 of 2002》只授权禁止道路车辆
不必要的烟雾/废气并管理车辆适用性，没有给出新重型柴油发动机的污染物、循环与数值
表。因此 `ZM-NATIONAL` 四个 scope 保持 `no-data`，不把固定源 `mg/Nm3`、道路使用
要求或邻国标准外推为发动机 `g/kWh` 法规。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Environmental Management (Licensing) Regulations, 2013, S.I. No. 112 | https://www.zema.org.zm/docs/licensing-regulations-statutory-instrument-no-112-of-2013/ | 已核验正文 Regulation 5(2) 与 Second Schedule（2026-08-10；固定源/工艺） |
| Road Traffic Act No. 11 of 2002（RTSA 副本） | https://www.rtsa.org.zm/wp-content/uploads/2019/09/The-Road-Traffic-Act-No-11-of-2002.pdf | 已核验（2026-08-10；道路烟雾与车辆适用性授权，无新发动机数值表） |

### 1.62 津巴布韦（ZWE）

EMA 的现行 Air Emission Licence 页面明确只为商业设施的备用发电机办理许可，并引用
S.I. 72 of 2009 §§14–15。Road Traffic (Construction, Equipment and Use) Regulations,
2015 的 §79 约束在道路上驾驶的车辆：尾气/烟雾不得妨碍他人，检测时须符合“适当的
Standards Association of Zimbabwe standards”；该公报本身未列出所引用标准编号、
污染物数值或新发动机认证循环。四个 scope 因而保持 `no-data`，不把设施许可、在用车
道路合规或未读回的外部标准推定为型式认证限值。

| 事实 | URL | 核验 |
| --- | --- | --- |
| EMA Air Emission Licence requirements | https://ema.co.zw/air-emission/ | 已核验（2026-08-10；明确为商业设施备用发电机） |
| Road Traffic (Construction, Equipment and Use) Regulations, 2015, S.I. 129 | https://veritaszim.net/sites/veritas_d/files/SI%202015-129%20-%20Road%20Traffic%20%28Construction%2C%20Equipment%20and%20Use%29%20Regulations%2C%202015.pdf | 已核验 Veritas 公报镜像 §79（2026-08-10；在用道路车辆，外部 SAZ 数值未公开） |
| ZRP 对 S.I. 129/2015 的现行执法引用 | https://zrp.gov.zw/?p=7841 | 已核验（2026-08-10；证明文书仍作为道路车辆执法依据，不补足排放数值） |

### 1.63 卢旺达（RWA）

RSB 官方目录确认 RS EAS 1047:2022 覆盖新车、进口二手车和在用车，包括重型车辆，
2023 年官方公报又确认其替代 RS 407-1:2019；但 22 页数值正文需付费购买，公开页面
只有摘要，不能安全拆分新车/在用车表。Rwanda National Police 2025–2026 页面确认
排放检测属于定期机动车检查，重型货车至少每六个月检查一次，这只能证明在用车执法。
在未取得标准完整表格与强制适用路径前，四个 scope 保持 `no-data`，不从“Euro 4
equivalent”描述、乌干达文本或检验新闻反推新发动机数值。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| RS EAS 1047:2022 — Air Quality — Vehicular exhaust emission limits | https://portal.rsb.gov.rw/webstore_view.php?i=ODIyODAxRkJrTndaM0EzcA | 已核验官方元数据与 scope（2026-08-10；数值正文付费、未读回） |
| Official Gazette No. 04 of 23/01/2023 的国家标准替代表 | https://www.rsb.gov.rw/fileadmin/Standard_Publications/Gazetted_Standards/National_Standards_as_published_in_Official_Gazette_n___04_of_23_01_2023.pdf | 已核验 RS EAS 1047:2022 替代 RS 407-1:2019（2026-08-10） |
| Rwanda National Police 车辆技术与排放检查说明 | https://police.gov.rw/media/news-detail/news/inside-rwanda-national-police-vehicle-inspection-centers-protecting-lives-through-vehicle-safety/ | 已核验（2026-08-10；周期性在用车检查，货运车辆每年两次） |

### 1.64 科特迪瓦（CIV）

环境部 2026 年页面确认政府正在执行 Décret No. 2017-125。水利与森林部发布的官方
项目审计逐字列出其 Articles 2–4：文书覆盖机动车/摩托车尾气以及所有装有燃烧发动机
的机械和交通工具，但该材料没有提供完整车辆表。交通部 NI 505:2025 又明确属于
`contrôle technique périodique des véhicules`，是周期性在用车检验指南。现有官方可读
材料因此不足以建立新重型发动机的完整数值与认证循环；四个 scope 保持 `no-data`，
不把环境空气表、周期检验或非官方转录中的在用车数字升级为型式认证限值。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| 环境部关于执行 Décret No. 2017-125 的 2026 更新 | https://www.environnement.gouv.ci/actualite/598 | 已核验（2026-08-10；确认现行实施） |
| 水利与森林部官方审计对 Décret No. 2017-125 Articles 2–4 的摘录 | https://eauxetforets.gouv.ci/sites/default/files/communique/pidacc_ci_p-z1-c00-066_rapport_final_audit_es_exercice_2024_clean.pdf | 已核验 p.53（2026-08-10；覆盖燃烧发动机交通工具，但未给完整车辆表） |
| NI 505:2025 周期性机动车技术检验指南 | https://transports.gouv.ci/actualites/controle-technique-automobile-la-cote-divoire-obtient-la-norme-ni-5052025-instaurant-un | 已核验（2026-08-10；周期检查，不是新发动机型式认证） |

### 1.65 喀麦隆（CMR）

MINEPDED 托管的 ANOR `NC 2858:2021` 已逐页读回。§11.1 明文针对行驶里程至少
3000 km 的在用车辆，规定怠速 CO 不超过 3.5%；§11.2 是车辆验收烟度条款，但原版
把吸收系数单位印成 `5 m` 和 `3.5 m`，没有可安全补推的逆米指数，也没有重型发动机
分类、型式认证循环或非道路适用拆分。Decree No. 2011/2582/PM 定义并授权管理移动源，
公开正文同样未提供新重型发动机认证表。因此将两个精确文书写入 `CM-NATIONAL`，四个
scope 保持 `no-data`；不修正原文单位，也不把在用车检查升级为型式认证。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| NC 2858:2021 — Environnement — Exigences relatives aux rejets atmosphériques | https://minepded.gov.cm/wp-content/uploads/2021/09/NC-2858.pdf | 已核验并渲染 p.37 §11（2026-08-10；在用车边界且柴油单位原印不完整） |
| Decree No. 2011/2582/PM — protection of the atmosphere | https://minepded.gov.cm/2020/01/24/decret-n20112582pm-du-23-aout-2011-fixant-les-modalites-de-protection-de-latmosphere/ | 已核验（2026-08-10；移动源一般授权，无重型认证表） |

### 1.66 塞内加尔（SEN）

ASN 2023 目录确认 NS 05-060:1999 是机动车尾气允许值和控制程序标准，NS 05-062:2018
是强制的大气排放标准；目录没有公开两份标准的数值正文。政府服务平台托管的 Decree
No. 2004-13 Annex G 已读回：G3 给出柴油车辆烟度 25%，G4 又要求按尚需另行规定的
跨部门程序用尾气分析仪检测。该道路车辆浓度/烟度规则没有重型发动机分类、功基准单位、
认证循环或非道路适用范围，不能映射为本系统的新重型发动机限值。`SN-NATIONAL` 因此
保留精确标准目录与道路法令，四个 scope 均为 `no-data`。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| ASN Catalogue 2023：NS 05-060 与 NS 05-062 元数据 | https://www.asn.sn/sites/default/files/ASN%20CATALOGUE%202023%20vf_0.pdf | 已核验（2026-08-10；仅目录元数据，数值正文未公开） |
| Decree No. 2004-13 implementing the Road Code — Annex G | https://bo.senegalservices.sn/storage/texte_references/T-decret-regles-applications-code-route.pdf | 已核验并渲染 p.66 Annex G（2026-08-10；车辆烟度/浓度控制，不是重型发动机认证表） |
| 机动车技术检查服务说明 | https://senegalservices.sn/demarche/demander-un-certificat-daptitude-technique-visite-technique | 已核验（2026-08-10；私家车年度、公共运输半年检查） |

### 1.67 莫桑比克（MOZ）

政府 SIBMOZ 法律框架将 Decree No. 18/2004 明确描述为覆盖车辆等移动源的环境质量与
排放管理。但该条目当前链接的 PDF 实际是 Decree No. 67/2010 五页修正案，只替换环境
空气/水体附件和收费罚则，并没有原法规的移动源完整表。INM 的 Decree No. 44/2017
条目确认车辆、拖拉机及工业/农林机械品牌型号审批框架，却未公开污染物数值、单位或
认证循环。缺少可审计的原表和测试方法时，不从非官方转录的燃油经济性/排放因子表
推成产品认证要求；`MZ-NATIONAL` 四个 scope 保持 `no-data`。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| SIBMOZ 法律框架：Decree No. 18/2004 条目 | https://sibmoz.gov.mz/legal-framework/ | 已核验（2026-08-10；确认移动源 scope，未读回原始移动源完整表） |
| Decree No. 67/2010 官方修正案 | https://www.inm.gov.mz/pt-br/content/conselho-de-ministros-suplemento-n%C2%BA-12-de-311210-pag-336-307-314-br-n%C2%BA-52-boletim-da | 已核验并渲染全部 5 页（2026-08-10；只修正 Annex I/V、Articles 23/24） |
| Decree No. 44/2017 车辆/机械品牌型号审批条目 | https://www.inm.gov.mz/pt-br/content/conselho-de-ministros-br-n%C2%BA-128-de-160817-boletim-da-rep%C3%BAblica-i-serie-p%C3%A1g-881 | 已核验官方元数据（2026-08-10；未公开排放表） |

### 1.68 斯威士兰（SWZ）

EEA 托管的 Air Pollution Control Regulations, 2010 已读回：数值附件是环境空气质量
目标，暗烟禁令及采样义务面向商业/工业场所，没有机动车发动机认证表。Environment
Management Act 2002 §37 只授权部长未来建立机动车强制排放标准和检测计划。交通部门
当前公开职责是车辆适行性/公共服务车辆半年检测；SWASA 工作计划里的 ARS 1595:2021
vehicle homologation 仍处于 draft stage 04.00。`SZ-NATIONAL` 因此记录精确环境条例和
交通职责页，四个 scope 保持 `no-data`，不把环境空气目标、适行性检查或草案当成生效
的新重型发动机标准。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Air Pollution Control Regulations, 2010 | https://eea.org.sz/wp-content/uploads/2020/08/Air-Pollution-Regulations-2010.pdf | 已核验并渲染 pp.1–12（2026-08-10；环境空气/场所排放，无车辆认证表） |
| Road Transportation Department — roadworthiness mandate | https://www.gov.sz/index.php/ministry-department/road-transportation-department | 已核验（2026-08-10；适行性与公共服务车辆半年检查） |
| SWASA work programme — draft ARS 1595 vehicle homologation | https://tc.swasa.co.sz/work-programme.php | 已核验（2026-08-10；stage 04.00 draft，不作为 effective） |

### 1.69 莱索托（LSO）

莱索托政府 Roadworthiness / Fitness 服务明确覆盖 Heavy Commercial Vehicles & Buses，
但公开页面只有适行性服务、费用和办理时间，没有污染物、单位、试验循环或新发动机
认证边界。交通部 2006 年政策又只记录当时 Road Traffic Bill 2004 与 draft regulations
仍待 enactment，不能作为 2026 年有效排放规则。因此 `LS-NATIONAL` 四个 scope 保持
`no-data`。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Roadworthiness / Fitness 服务（含重型商用车与客车） | https://www.gov.ls/eservice/roadworthiness-rw-fitness-f-of-motor-vehicles/ | 已核验（2026-08-10；适行性服务，无排放限值/循环） |
| Transport Sector Policy（2006-02-28） | https://www.mopwt.gov.ls/wp-content/uploads/2018/07/Transport_Sector_Policy.pdf | 已核验（2026-08-10；Road Traffic Bill 与 draft regulations 当时仍待立法，不作为 effective） |

### 1.70 马达加斯加（MDG）

马达加斯加政府托管的 2025 年 EIA 法律清单在 PDF pp.87、103 明确列出
`Arrêté interministériel n° 6941/2000`，标题范围是汽车尾气烟度并废止 1971 年旧令；
但文件没有转载该法令正文、数值、重型分类或认证循环。CNLEGIS 官方编号检索中输入
`6941` 只返回 6941/2013 与 26941/2017 两条异文，未提供 6941/2000 原文，因此不能从
标题或二手数值拼出发动机标准。`MG-NATIONAL` 四个 scope 保持 `no-data`。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| 官方 EIA 法律清单列出 Arrêté 6941/2000 | https://www.minae.gov.mg/wp-content/uploads/2025/05/1.0.EIES-VERSION-DEFINITIVE_FIN.pdf | 已核验并渲染 pp.87、103（2026-08-10；仅法规身份/标题，无正文限值） |
| CNLEGIS 官方编号检索 | https://cnlegis.gov.mg/page_cherche_dir_numeros/ | 已核验（2026-08-10；`6941` 返回 2013/2017 异文，未取得 2000 原文） |

### 1.71 毛里求斯（MUS）

毛里求斯 NLTA 官方目录列出 `Road Traffic (Control of Vehicle Emissions) Regulations
2002`（GN 198/2002）及 2003、2010 修订；环境部现行执法回报说明 GN 41/2022 自
2022-02-21 生效，并用烟度计按不透光度 `>50–70%`、`>70%` 对车辆执法。该证据支持
在用车烟度/排气测试和执法状态，不提供重型新发动机的功基准限值、认证循环，也不覆盖
非道路机械。`MU-NATIONAL` 四个 scope 保持 `no-data`。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| 车辆烟度执法回报（2022-03 至 2023-08） | https://environment.govmu.org/Documents/communique/Returns%20on%20Enforcement%20of%20Vehicular%20Smoke%20Emissions%20%28March%202022%20to%20August%202023%29.pdf | 已核验（2026-08-10；在用车不透光度执法，不是发动机型式认证表） |
| NLTA 车辆排放法规目录 | https://nlta.govmu.org/Pages/Legislation/Legislation.aspx | 已核验（2026-08-10；确认 2002 法规及修订身份） |

### 1.72 马拉维（MWI）

马拉维官方 Trade Portal 可读回 Road Traffic Act 与 Road Traffic Regulations。
Act §108(1)(l) 只授权限制发动机在良好/有效状态下本不应产生的烟雾或烟气；Regulation
97 只禁止在公共道路运行排气浓度足以造成滋扰或妨碍视线的车辆。两者均是定性运行状态
要求，没有污染物数值、功率/GVW 分类、试验循环或非道路适用条款。因此
`MW-NATIONAL` 四个 scope 保持 `no-data`。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Road Traffic Act §108(1)(l) | https://portal.trade.gov.mw/en-gb/site/display/62 | 已核验（2026-08-10；定性烟雾/烟气授权，无数值表） |
| Road Traffic Regulations regulation 97 | https://portal.trade.gov.mw/en-gb/site/display/101 | 已核验（2026-08-10；公共道路滋扰/视线规则，无认证循环） |

### 1.73 斐济（FJI）

FRCS《Standard Interpretation Guideline 2025-04》对 Customs (Prohibited Imports
and Exports) Regulations 1986 Schedule 3 做法律分析：二手 public transport vehicles、
goods vehicles 和 road tractors 只须满足 Euro 4 进口条件；同一指南另说明全新 road
tractors、passenger/goods vehicles 和底盘也须 Euro 4。FRCS 2026 年公告继续要求二手/
翻新 goods trucks、16 座以上 buses 和 road tractors 达到 Euro 4。两份材料均是进口
准入标签，没有污染物数值、功基准单位和认证循环。故
`FJ-NATIONAL` 四个 scope 保持 `no-data`，也不把进口等效路径外推到非道路机械。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| FRCS Standard Interpretation Guideline 2025-04 | https://frcs.org.fj/wp-content/uploads/2025/01/SIG-2025-04-Importation-of-Motor-Vehicles-Customs-Prohibited-Imports-and-Exports-Regulations-1986.pdf | 已核验并渲染 pp.4、10（2026-08-10；Schedule 3 与全新车辆 Euro 4 进口条件） |
| FRCS 2026 二手/翻新机动车进口公告 | https://frcs.org.fj/public-notice/importation-of-used-or-reconditioned-motor-vehicles-in-2026/ | 已核验并确认 HTTP 200（2026-08-10；重型货车/客车/牵引车 Euro 4 进口准入） |

### 2.1 产品与认证来源门（2026-08-05）

| 来源 | 官方性 / 可查询性 | 许可或证据限制 | 当前用途 |
| --- | --- | --- | --- |
| 潍柴英文官网产品目录 | 官方；覆盖卡车、客车、工程机械和农业发动机分类 | 法律声明限个人非商业用途，禁止未经授权的复制、公开展示、发布或分发；配置可随时变更 | 只保留入口链接与许可结论；未经书面许可不复制产品参数、不创建公开真实 fixture |
| VECC 机动车环保信息公开平台 | 生态环境部门公众查询；道路车辆和非道路机械入口可达 | 道路查询需 VIN；非道路查询需 17 位机械环保代码、发动机号后 6 位和验证码；结果页声明仅供参考 | owner 提供标识符后，用于形成带公开编号、查询日期和 locator 的认证候选证据 |

具体字段、批次模板与发布门见 `docs/PRODUCT_EVIDENCE.md`。当前没有满足许可和
认证追溯要求的 5–10 个真实产品配置，因此不得把官网系列页或 Demo 配置发布为
真实产品事实。

### 2.2 市场指标来源门（2026-08-05）

| 来源 | 四国覆盖 / 口径 | 许可或证据限制 | 当前用途 |
| --- | --- | --- | --- |
| OICA Sales Statistics | 2025 `Commercial Vehicles - Sales` 同表包含 CHN、USA、Germany、Brazil；页面提示部分欧洲国家缺数 | OICA 保留电子媒介使用、复制和分发权，未经明确授权禁止全部或部分复制 | 只登记为道路市场强候选；取得书面许可和车型定义前不复制数值 |
| UN Comtrade Plus | 约 200 个国家；HS 8408 可形成压燃式发动机贸易指标，但不等于终端需求且包含多个用途 | 许可第 5 条限制未经书面许可的复制、自动浏览/下载、再分发、发布和商业利用 | 只登记方法候选；取得 UN 许可前不自动下载、不入库 |
| World Development Indicators | WDI 数据集覆盖 200 多个经济体；`NY.GDP.MKTP.CD` 四国最新值均为 2025；两个场景相关 value-added 指标的 USA 最新年份为 2021，其他三国为 2025 | Data Catalog 明确 CC BY 4.0；须署名并逐指标检查第三方例外 | 当前唯一许可明确的公开作品候选；GDP 业务相关性和 value-added 共同历史期间仍待 ADR-020 批准 |

候选指标、官方入口、现有比较器契约、12 行接收模板和发布门见
`docs/MARKET_EVIDENCE.md`。当前没有同时满足“领域相关、四国同期、许可清晰、
业务方向已签字”的真实指标，因此不得把 OICA/Comtrade 数值或 WDI 最新值直接
导入并生成市场排名。

## 3. 历史验收样例快照（SUPERSEDED；当前签核见 ACCEPTANCE）

> 本节保留各批次形成验收样例时的历史文字，不是当前产品事实总表。相冲突的
> no-data、numeric、日期或发布状态均以 `docs/ACCEPTANCE.md` #1–#264（尤其
> #166–#264）、[§3.81](#381-2026-08-11-稳定-33-国与数据纠错来源收口本地-accepted待部署)、
> [§3.82](#382-2026-08-11-marken-source-currentness-纠错本地-accepted待部署)、
> [§3.83](#383-2026-08-11-qatkwtomnjor-source-currentness-纠错本地-accepted待部署)、
> [§3.84](#384-2026-08-11-irnirqlbnsyr-source-currentness-纠错本地-accepted待部署)、
> [§3.85](#385-2026-08-11-35-国-source-currentness-规范索引本地-accepted待部署)、
> §3.86–§3.89、ADR-126/127/128/129/130/131/133/134/135/136 和当前 accepted source 边界为准。以下历史内容不得绕过总签核直接发布。

### CHN

1. **道路（卡车/客车）**：as-of 2026-07-30，CHN/on-road-truck（或 on-road-bus），
   350 kW，生产日期 2024-01-15 → 适用 GB 17691-2018（含 2026 修改单），
   阶段 = 国六 6b（2023-07-01 起强制）；代表性限值（WHTC，柴油）：
   NOx ≤ 460 mg/kWh、PM ≤ 10 mg/kWh、PN ≤ 6.0e11 #/kWh、CO ≤ 4000 mg/kWh、
   THC ≤ 160 mg/kWh（WHSC：NOx ≤ 400、PN ≤ 8.0e11）。仅满足 6a/国五的
   发动机 = NOT FIT。M3 城市客车与卡车结果一致（同一文书）。
2. **非道路（工程/农业；历史单带代表样例，已由 §3.88 / ACCEPTANCE #261
   supersede）**：as-of 2026-07-30，CHN/construction（或 agriculture），
   100 kW（56≤P<130 带），制造日 2023-06-01 → 适用 GB 20891-2014 + 第 1 号
   修改单 第四阶段（2022-12-01 起强制）+ HJ 1014-2020；代表性限值：
   CO ≤ 5.0、HC ≤ 0.19、NOx ≤ 3.3、PM ≤ 0.025 g/kWh，PN ≤ 5e12 #/kWh。
   边界：同查询 Pmax = 600 kW 时必须返回“>560 kW 阶段另行公告，仍适用国三
   限值（CO ≤ 3.5、HC+NOx ≤ 6.4、PM ≤ 0.20 g/kWh）”。

### USA

1. **道路**：as-of 2026-07-30，USA/on-road-truck（或 on-road-bus），350 kW，
   机型年 MY2028 → 适用 40 CFR 1036.104（Part 1036）；FTP/SET NOx ≤ 0.035
   g/hp·hr、PM ≤ 0.005 g/hp·hr、CO ≤ 6.0 g/hp·hr、NOx FEL ≤ 0.065 g/hp·hr。
   MY2026 查询必须返回 40 CFR 86.007-11（NOx 0.20 g/bhp·hr）—— 时点切换
   确定性可测。GHG Phase 3（89 FR 29440）必须返回 superseded（2026-04-20 起
   被 91 FR 7686 废止）；91 FR 43154 为 proposed，不得作为 effective。
2. **非道路**：as-of 2026-07-30，USA/construction（或 agriculture），250 kW
   （130–560 kW 带），制造年 2024 → 适用 40 CFR Part 1039 Tier 4（§1039.101）；
   NOx ≤ 0.40、PM ≤ 0.02 g/kWh（Table 1 为图片表格，签字前人工读回）；
   agriculture 与 construction 结果一致（同一文书）。

### DEU（欧盟直接适用）

1. **道路卡车**（N3，300 kW）：as-of 2026-07-30 → Euro VI（595/2009 +
   582/2011 Annex II），框架 2018/858，国家程序 EG-FGV/KBA；排除 Stage V。
2. **道路客车**（M3，210 kW）：as-of 2026-07-30 → Euro VI；as-of 2028-01-01
   → Euro 7（2024/1257，M2/M3/N2/N3 自 2027-11-29 适用，595/2009 废止）。
   切换日 2027-11-29 由 Art. 26 类别触发，确定性可测；proposed/effective
   不得混淆。
3. **工程机械**（150 kW，NRE 130–560 kW）：as-of 2025-06-01 → Stage V
   （2016/1628 Annex II/III），德国执行 28. BImSchV；排除 Euro VI 分支。
4. **农业机械**（150 kW）：与工程机械返回同一 Stage V 判定；DE 无单独农业
   排放法令 —— 跨 scope 确定性断言。

### IND（MoRTH 官方公报已核验）

1. **道路卡车/客车**（300 kW）：2020-03-31 无 BS VI，2020-04-01 起返回
   G.S.R. 889(E)；WHSC NOx 400 / PM 10 mg/kWh / PN 8×10¹¹ #/kWh，WHTC
   NOx 460 / PM 10 / PN 6×10¹¹。CEV/TREM 不得出现在道路结果中。
2. **工程机械**（100 kW）：2024-03-31 返回 CEV-IV（NOx 0.4 / PM 0.025），
   2024-04-01 起只返回 CEV-V（NOx 0.4 / PM 0.015 / PN 1×10¹²）；切换日
   不得重叠。P=560 进入高功率带，NOx 3.5 / PM 0.045 且无 PN。
3. **农业装备**：45 kW 在 2022-12-31 无 TREM-IV，2023-01-01 起返回 TREM-IV；
   2026-04-01 起返回 TREM-V。15 kW 在 2026-03-31 无结果，2026-04-01 起进入
   8≤P<19 的 TREM-V 带。Draft G.S.R. 151(E) 在任意 as-of 均不得作为 effective。

### BRA

1. **道路卡车**（N3，300 kW）：as-of 2026-07-30 → PROCONVE P8（Res. CONAMA
   490/2018，2023-01-01 起全面强制，采用 UN ECE R49.06 测试体系）；柴油机
   WHSC：CO 1500 / THC 130 / NOx 400 / PM 10 mg/kWh、NH3 10 ppm、
   PN 8.0×10¹¹ #/kWh；WHTC：CO 4000 / THC 160 / NOx 460 / PM 10 mg/kWh、
   NH3 10 ppm、PN 6.0×10¹¹ #/kWh。合规路径为 IBAMA LCVM。as-of
   2022-12-31 → P-7（CONAMA 403/2008）：ESC/ELR NOx 2 / HC 0.46 / CO 1.5 /
   PM 0.02 g/kWh，ETC NOx 2 / CO 4 / PM 0.03 / NMHC 0.55 g/kWh；切换日
   2023-01-01 只返回 P8，不得重叠。
2. **非道路**：拖拉机 100 kW（75≤P<130 带）→ MAR-I（Res. CONAMA 433/2011，
   ISO 8178-1）：CO ≤ 5.0 / HC+NOx ≤ 4.0 / PM ≤ 0.3 g/kWh；
   工程机械 30 kW（19≤P<37 带）→ MAR-I：CO ≤ 5.5 / HC+NOx ≤ 7.5 /
   PM ≤ 0.6 g/kWh。（2026-07-30 自 IBAMA 官方手册 p.310 读回核验）

### JPN

1. **道路**：as-of 2026-08-06，JPN/on-road-truck（或 on-road-bus），300 kW
   → 平成28年（2016年）重型柴油车标准；WHSC 与 WHTC 平均限值均为
   CO ≤ 2.22、NMHC ≤ 0.17、NOx ≤ 0.4、PM ≤ 0.010 g/kWh。当前模型不含
   GVW，统一从全部重型车均已适用的 2018-10-01 返回，不能倒推为首次实施日。
2. **非道路**：as-of 2026-08-06，JPN/construction（或 agriculture），150 kW
   → オフロード法 2014 年基准，CO ≤ 3.5、NMHC ≤ 0.19、NOx ≤ 0.4、
   PM ≤ 0.02 g/kWh；五个功率带逐带测试。边界 P=19 kW 有结果，P=560 kW
   无结果，不得把告示的 `19以上560未満` 改写为闭区间。

### KOR

1. **道路**：as-of 2026-08-06，KOR/on-road-truck（或 on-road-bus），300 kW
   → 《대기환경보전법 시행규칙》附表 17 第2号아목；WHSC/WHTC 同时满足，NOx
   分别为 0.40 / 0.46 g/kWh，PN 分别为 8×10¹¹ / 6×10¹¹ #/kWh，NH3 10 ppm。
2. **非道路**：as-of 2026-08-06，KOR/construction 或 agriculture，150 kW
   → 附表 17 工程机械第4号마목（2020-12-01）或农业机械第5号라목（2021-07-01）；
   130≤P<560 带返回 CO 3.5、HC 0.19、NOx 0.40、PM 0.015 g/kWh、PN
   1×10¹² #/kWh、NH3 10 ppm。边界 P=19、37、56、130 均按官方功率带，P=560
   无结果；NH3 受尿素喷射装置条件限制。

### MEX

1. **道路**：as-of 2026-08-06，MEX/on-road-truck 或 on-road-bus，300 kW →
   NOM-044-SEMARNAT-2017 B 标准。Tabla 1B 的 CT/CSE 路径返回 CO 15.5、NOx
   0.20、HCNM 0.14、PM 0.01 g/bhp-hr；Tabla 2B 的 CEEMAP/CETMAP 路径分别返回
   NOx 0.40/0.46 g/kWh，另含 PM、PN、NH3 等限值。两张表是替代认证路径，不能
   在解释层合并为单一发动机必须同时满足的集合。
2. **生效边界**：2024-12-31 查询不返回 B 标准，2025-01-01 起返回；该日期来自
   2021 年 DOF 修订将 AA 过渡期延至 2024-12-31 的官方公告，而不是 NOM-044 原始
   表格的首次发布日。
3. **非道路**：工程机械和农业机械目前没有本批已核验的墨西哥独立官方标准，查询
   返回 no-data；不得套用 NOM-044 道路限值或用邻国标准补齐。

### AUS

1. **道路**：as-of 2026-08-06，AUS/on-road-truck 或 on-road-bus，300 kW → ADR 80/04。
   官方问答 Table 1 直接给出 WHSC NOx ≤ 400、PM ≤ 10 mg/kWh，WHTC NOx ≤ 460、
   PM ≤ 10 mg/kWh；ADR 80/04 适用于 GVM > 3,500 kg 的 M/ N 类重型车辆，新车型
   2024-11-01 起、全部车辆 2025-11-01 起。
2. **历史切换**：as-of 2024-10-31 → ADR 80/03 Euro V，ESC/ETC 限值分别记录为
   CO 1.5/4.0、THC 0.46、NMHC 0.55、NOx 2.0、PM 0.02/0.03 g/kWh；2024-11-01
   查询切换到 ADR 80/04。由于 schema 没有新车型/既有车型维度，该边界是确定性近似，
   展示层必须保留 2025-11-01 全部车辆节点说明。
3. **非道路**：DCCEEW 2024-01-02 官方页面明确澳大利亚目前没有控制非道路柴油发动机
   有害排放的法规，评估范围包含拖拉机、挖掘机、压路机、发电机等；construction 与
   agriculture 查询返回显式 no-data，不得套用 Tier 4、Stage V 或道路 ADR。

### RUS

1. **道路卡车/客车**（300 kW）：as-of 2018-12-31 无结果，2019-01-01 起返回
   TR CU 018/2011 Class 5。ESC/ELR：NOx 2、HC 0.46、CO 1.5、PM 0.02 g/kWh、
   opacity 0.5 m⁻¹、NH3 25 ppm；ETC：NOx 2、CO 4、PM 0.03、NMHC 0.55 g/kWh、
   NH3 25 ppm。第 855 号国内特殊程序不得覆盖普通车型的 EAEU 基线。
2. **农业机械**：Class 3A 的 37≤P<75 带自 2025-01-01 返回 CO 5.0、HC+NOx 4.7、
   PM 0.4 g/kWh；75≤P<130 与 130≤P≤560 带从 2025-10-01 返回。边界
   `19/19.001/37/75/130/560/560.001` 必须分别得到 `0/3/3/3/3/3/0` 条限值。
3. **工程机械**：as-of 2026-08-07，150 kW 返回 no-data；不得用农业拖拉机
   TR CU 031/2012、道路 TR CU 018/2011 或 EU Stage V 补齐。

### IDN

1. **道路卡车/客车**（300 kW）：as-of 2022-03-31 无结果，2022-04-01 起返回
   P.20/MENLHK/SETJEN/KUM.1/3/2017 的 Euro 4。ESC：CO 1.5、HC 0.46、NOx 3.5、
   PM 0.02 g/kWh；ETC：CO 4、NMHC 0.55、NOx 3.5、PM 0.03 g/kWh；卡车与客车
   共用 8 条限值，不能把道路标准显示成 CEV/TREM 或非道路标准。
2. **工程机械与农业装备**：as-of 2026-08-07，150 kW 均返回显式 no-data；
   未取得独立官方限值前，不套用道路 Euro 4、EU Stage V 或美国 Tier 4。

### THA

1. **道路卡车/客车**（150 kW）：as-of 2023-12-31 无结果，2024-01-01 起返回
   TIS 3046-2563 mandatory Level 6。ESC：CO 1.5、HC 0.46、NOx 2.0、PM 0.02
   g/kWh；ELR opacity 0.5 m⁻¹；ETC：CO 4.0、NMHC 0.55、NOx 2.0、PM 0.03
   g/kWh；卡车与客车各 9 条。国内 `Level 6` 对应 Euro V / UN R49-05，不得写成
   Euro VI；ETC THC 0.55 是 NMHC 0.55 的替代项，不累计。
2. **工程机械与农业装备**：TIS 787-2551 只覆盖 ≤22 kW 小型农业/工业柴油机且
   没有完整污染物表；150 kW 两 scope 显式 no-data，不从道路 TIS 3046 外推。
3. **来源元数据**：TIS 正式全文为 `Thai Industrial Standards Institute, Ministry of
   Industry` 发布的 `official-regulation`，published `2020-08-18`，URL
   https://service.tisi.go.th/fulltext/TIS3046-2563p_5055.pdf；强制令为 `Ministry of
   Industry / Royal Thai Government Gazette` 发布的 `official-regulation`，published
   `2023-07-03`，URL
   https://ratchakitcha.soc.go.th/documents/140A040N0000000000500.pdf。两条均于
   `2026-08-10T13:09:56Z` 核验。

### VNM

1. **道路卡车/客车**（300 kW）：as-of 2021-12-31 无结果，2022-01-01 起返回
   QCVN 109:2021/BGTVT Level 5。ESC：CO 1.5、HC 0.46、NOx 2.0、PM 0.02；
   ETC：CO 4.0、NMHC 0.55、NOx 2.0、PM 0.03 g/kWh；ELR 烟度 0.5 m⁻¹。
   卡车与客车各返回 9 条，ETC 不得包含只适用于天然气发动机的 CH4。
2. **工程机械与农业装备**：as-of 2026-08-07，150 kW 均返回显式 no-data；
   QCVN 109 Part I clause 1 的非道路车辆排除不能被道路 Level 5 表覆盖。

### MYS

1. **道路卡车/客车**（300 kW）：as-of 2016-12-31 无结果，2017-01-01 起返回
   DOE VTA Euro II 13-mode：CO 4.0、HC 1.1、NOx 7.0、PM 0.15 g/kWh；两个
   scope 各 4 条。as-of 2026-08-07 仍不得返回指南中仅标为 tentative 的 Euro IV。
2. **工程机械与农业装备**：as-of 2026-08-07，150 kW 均返回显式 no-data；
   P.U.(A) 429/96 regulation 5 的道路使用范围不得外推到非道路机械。

### SAU

1. **当前道路卡车/客车**：MY2026 GSO 技术法规清单与 GSO 144 实施链闭合道路
   Euro V；ESC/ELR/ETC 每个 scope 各 9 条，自 MY2026 边界返回。早期仅凭
   `approved on 1991-11-27` 维持 no-data 的结论已由 ACCEPTANCE #172 替代。
2. **工程机械与农业装备**：仍返回显式 no-data。SASO 机械安全 Part 2 覆盖移动/
   重型设备及部分农业机械，但其 emissions 条款不是柴油尾气污染物认证限值。

### ARG

1. **道路卡车/客车**（300 kW）：as-of 2017-12-31 无结果，2018-01-01 起返回
   Resolución 1464/2014 / Directive 2005/55 B2。ESC/ELR：CO 1.5、HC 0.46、
   NOx 2.0、PM 0.02 g/kWh、烟度 0.5 m⁻¹；ETC：CO 4.0、NMHC 0.55、NOx 2.0、
   PM 0.03 g/kWh；卡车与客车各 9 条。
2. **范围边界**：Resolución 128/2018 的 18 个月 Ejército Argentino 军用 Euro III
   例外不得作为普通市场 effective 法规；C/EEV 是替代认证路径，本批不与 B2 叠加。
   construction/agriculture 均返回显式 no-data。

### NZL

1. **道路卡车/客车**（300 kW）：as-of 2025-10-31 不返回当前统一路径，
   2025-11-01 起返回 Rule 33001 Table 2B 的 Euro VI Step C 代表路径。WHSC：
   CO 1500、THC 130、NOx 400、PM 10 mg/kWh、NH3 10 ppm、PN 8e11；WHTC：
   CO 4000、THC 160、NOx 460、PM 10 mg/kWh、NH3 10 ppm、PN 6e11。卡车与
   客车各返回 12 条。
2. **替代路径与范围边界**：每条 measurement basis 必须保留 US Tier 3、US 2013、
   Japan 2016、ADR 80/04、UNR49/06(Supp.4)、UNR83/07 的 `or` 替代语义，不能
   表示同时满足。Rule 2.1(2)(b) 排除 tractors；construction/agriculture 返回
   显式 no-data，不从道路 entry certification 规则外推。

### CHL

1. **道路卡车/客车**（300 kW）：as-of 2026-01-05 无结果，2026-01-06 起返回
   D.S. 55/1994 article 8 quáter 的 Table 3 Euro VI 压燃机路径。WHSC：CO 1500、
   HCT 130、NOx 400、PM 10 mg/kWh、NH3 10 ppm、PN 8e11；WHTC：CO 4000、
   HCT 160、NOx 460、PM 10 mg/kWh、NH3 10 ppm、PN 6e11；每个 scope 12 条。
2. **工程机械**：as-of 2023-10-20 无结果，2023-10-21 起按 D.S. 39 Table 2
   返回。19/37 kW 各 4 条，56/75/130/560 kW 各 5 条；18.999 与 560.001 kW
   无结果，560 kW 必须保留。Table 1 US 路径不得与 Table 2 EU 路径累计。
3. **农业装备**：as-of 2026-08-07 返回显式 no-data。D.S. 33/2024 排除其他农业
   机械并把 tractor 延至 2030-01-01；该法规当前状态为 `adopted`，不得提前转为
   `effective` 或外推到全部农业机械。

### COL

1. **道路卡车/客车**（300 kW）：as-of 2022-12-31 不返回 Table 22，2023-01-01
   起返回 Resolucion 0762 article 18 的 WHSC/WHTC 代表路径。WHSC：CO 1500、
   HCT 130、NOx 400、PM 10 mg/kWh、NH3 10 ppm、PN 8e11；WHTC：CO 4000、
   HCT 160、NOx 460、PM 10 mg/kWh、NH3 10 ppm、PN 6e11；每个 scope 12 条。
   EPA10 或更高标准为替代路径，不得与 Table 22 叠加。
2. **工程机械**：as-of 2024-07-17 无结果，2024-07-18 起按 Table 23 返回。
   19/37/56/75/130/560 kW 分别返回 3/3/4/4/4/4 条；18.999 与 560.001 kW
   无结果，560 kW 必须保留。19 <= P < 37 为 NRSC，其他带为 NRSC/NRTC。
   Table 24 US 路径不得与 Table 23 EU 路径累计。
3. **农业装备**：as-of 2026-08-07 返回显式 no-data。Article 3(c) 排除专用于
   农业作业的非道路移动源，不把工程机械 Table 23 外推到 agriculture。

### PER

1. **道路卡车/客车**（300 kW）：as-of 2024-09-30 不返回 D.S. 029 新路径，
   2024-10-01 起返回 annex I.7 Euro VI/A。WHSC：CO 1500、HCT 130、NOx 400、
   PM 10 mg/kWh、NH3 10 ppm、PN 8e11；WHTC：CO 4000、HCT 160、NOx 460、
   PM 10 mg/kWh、NH3 10 ppm、PN 6e11；每个 scope 12 条。日期语义为提单日期。
2. **替代路径与范围边界**：annex I.9.1 的 EPA 2010 是另一条合规路径，不与
   Euro VI/A 累计。D.S. 029 item I 只覆盖纳入国家道路运输系统的机动车；
   construction/agriculture 返回显式 no-data，不从道路表外推。

### NOR

1. **道路卡车/客车**（300 kW）：as-of 2022-09-30 无结果，2022-10-01 起按
   现行 Bilforskriften G3 返回 Euro VI WHSC/WHTC 代表路径，每个 scope 12 条。
   WHSC NOx 400、PN 8e11；WHTC NOx 460 mg/kWh、PN 6e11 #/kWh。
   2029-05-28 仍返回，2029-05-29 不再返回该路径。2022-10-01 只表示当前合并
   法规切换日，不解释为挪威首次 Euro VI 实施日。
2. **工程机械/农业装备**（150 kW）：as-of 2020-06-30 无结果，2020-07-01 起
   按 Maskinforskriften Vedlegg XII 返回 Stage V NRE。150 与 559.999 kW 各
   返回 5 条；560 kW 进入高功率带并返回 4 条（NOx 3.5、PM 0.045 g/kWh，
   无 PN）。两个 scope 的功率带和数值必须一致。
3. **来源追溯**：法规身份、范围和国内生效日追溯 Lovdata 挪威文书；污染物
   数值追溯被其纳入的 EU 595/2009/582/2011 与 2016/1628 官方表，不能只保留
   EU 数值而丢失挪威国内适用证据。

### ISL

1. **道路卡车/客车**（300 kW）：as-of 2013-04-14 无结果，2013-04-15 起按
   377/2013 article 12 与 Annex IV 45zzk/45zzl 返回 Euro VI WHSC/WHTC 代表
   路径，每个 scope 12 条。WHSC NOx 400、PN 8e11；WHTC NOx 460 mg/kWh、
   PN 6e11 #/kWh。2027-11-28 仍返回，2027-11-29 不再返回该路径。
2. **工程机械/农业装备**（150 kW）：as-of 2020-11-30 无结果；1200/2020 自
   2020-12-01 返回 Stage V，179/2021 在 2021-02-23 无缝替代。切换日前后各
   返回 5 条且不得重复；现行 150 与 559.999 kW 各 5 条，560 kW 进入高功率带
   返回 4 条（NOx 3.5、PM 0.045 g/kWh，无 PN）。两个 scope 必须一致。
3. **来源追溯**：冰岛国内文书证明 scope、生效日与替代链，政府 EEA 数据库用于
   交叉确认纳入状态，污染物数字追溯 EU 595/2009/582/2011 与 2016/1628 官方表。
   不得只凭 EEA 身份复制 EU 成员关系，也不得在 179/2021 切换日叠加两套限值。

### SRB（塞尔维亚）

1. **Homologation 正文**：`Pravilnik o homologaciji (consolidated homologation rulebook:
   SG RS 129/21, 110/22, 23/23 and 59/24)`；publisher `Ministry of Construction,
   Transport and Infrastructure of the Republic of Serbia`；`official-regulation`；published
   `2021-12-28`；URL
   https://www.mgsi.gov.rs/sites/default/files/pravilnik_o_homologaciji_0.pdf。
2. **技术条件正文**：`Pravilnik o podeli motornih i priključnih vozila i tehničkim
   uslovima za vozila u saobraćaju na putevima (consolidated through SG RS 54/26)`；同一
   publisher/type；published `null`；URL
   https://www.mgsi.gov.rs/sites/default/files/pravilnik_o_podeli_motornih_i_prikljucnih_vozila_i_tehnickim_uslovima_za_vozila_u_saobracaju_na_putevima.pdf。
3. **建模边界**：两份正文包含 UN R49/06 引用、homologation 程序和在用车技术条件，
   但未读回把完整新重型发动机类别、污染物表、认证循环绑定到确定全国全面实施日的
   条款。四个 scope 均 no-data；`RS-NATIONAL validFrom=2026-08-10` 只表示本次证据
   边界，不能从合并版本、UNECE 引用或邻国日期反推 effectiveFrom。两条来源统一于
   `2026-08-10T13:09:56Z` 核验。

### BIH（波斯尼亚和黑塞哥维那）

1. **国内最低要求**：`Odluka o najnižim tehničkim zahtjevima za novoproizvedena i
   korištena vozila pri homologaciji tipa vozila i homologaciji pojedinačnog vozila, te za
   dijelove, uređaje i opremu vozila pri homologaciji tipa`；publisher
   `Ministry of Communications and Transport of Bosnia and Herzegovina`；
   `official-regulation`；published `2019-03-26`；URL
   https://homologacija.gov.ba/Documents/Odluka%20o%20najnizim...%20Sl%20Gl%20BiH%20BR%20023_19.pdf。
2. **国内 R49 批准链**：`Naredbe o homologaciji — order implementing UNECE Regulation
   No. 49 for gaseous and particulate pollutants from compression-ignition engines`；同一
   publisher/type；published `2010-10-28`；URL
   https://homologacija.gov.ba/Documents/Naredbe%20o%20homologaciji.pdf。
3. **数值表**：`UN Regulation No. 49 Revision 6 — emissions of gaseous and particulate
   pollutants from compression-ignition engines`；publisher `United Nations Economic
   Commission for Europe / EUR-Lex`；`official-regulation`；published `2013-06-24`；URL
   https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:42013X0624(01)。
4. **确定性结果**：2019-05-31 无结果；2019-06-01 起 reference mass >2,610 kg 的
   M1/M2/N1/N2 与全部 M3/N3 在 truck/bus 各返回 WHSC 6 + WHTC 6 = 12 条。
   WHSC CO/THC/NOx/PM/PN/NH3 为 1500/130/400/10/8e11/10；WHTC 为
   4000/160/460/10/6e11/10（NH3 ppm、PN #/kWh，其余 mg/kWh）。R96 只作为
   窄义 N3 SF 移动起重机替代，不能泛化到 construction；agriculture 亦无阶段，两个
   非道路 scope no-data。三条来源统一于 `2026-08-10T13:09:56Z` 核验。

### MKD（北马其顿）

1. **道路批准规则**：`Правилник за одобрување на нови моторни и приклучни возила,
   системи, составни делови и самостојни технички единици наменети за таквите возила`；
   publisher `Ministry of Economy / Official Gazette of the Republic of Macedonia`；
   `official-regulation`；published `2009-11-02`；URL
   https://slvesnik.com.mk/Issues/BC95C8FDB2BB1C41969F17BE58E7F316.pdf。
2. **农业拖拉机批准规则**：`Правилник за одобрување на земјоделски и шумски трактори`；
   同一 publisher/type；published `2009-11-06`；URL
   https://slvesnik.com.mk/Issues/93BA570BCB131F4B93814D076C9003A0.pdf。
3. **建模边界**：道路规则 pp.1、27–28、229 排除农业、履带、工程/矿场/港口/机场
   车辆和工作机械，只把重型阶段转交 R49/03 与指令引用；农业规则 pp.13、47、49、90
   同样只有指令/R96 引用，未同时读回当前完整表、循环和实施链。四 scope no-data；
   不以纳入引用补写 EU/UNECE 数值。两条来源统一于 `2026-08-10T13:17:36Z` 核验。

### MNE（黑山）

1. **国内车辆要求**：`Pravilnik o tehničkim zahtjevima za vozila koja se uvoze ili prvi
   put stavljaju na tržište u Crnoj Gori`；publisher `Ministry of Transport / Government of
   Montenegro`；`official-regulation`；published `2015-01-30`；URL
   https://www.gov.me/dokumenta/d11477e6-31d9-41c5-b787-ffbcda492f2a。
2. **数值表**：`UN Regulation No. 49 Revision 6 — Uniform provisions concerning gaseous
   and particulate pollutants from C.I. and P.I. engines`；publisher `United Nations Economic
   Commission for Europe`；`official-regulation`；published `2013-03-04`；URL
   https://documents.un.org/api/symbol/access?l=en&s=E%2FECE%2F324%2FREV.1%2FADD.48%2FREV.6&t=pdf。
3. **实施公告**：`Izmjene i dopune pravilnika o tehničkim zahtjevima — new M/N vehicles
   require EURO 6 from 15 October 2018`；publisher `Government of Montenegro / Ministry of
   Transport`；`government-notice`；published `2018-09-24`；URL
   https://www.gov.me/clanak/191855--izmjene-i-dopune-pravilnika-o-tehnickim-zahtjevima-za-vozila-koja-se-uvoze-ili-prvi-put-stavljaju-na-trziste-u-crnoj-gori。
4. **确定性结果**：2018-10-14 无结果；2018-10-15 起 M/N 最大连续额定功率 >15 kW
   的 truck/bus 各返回 WHSC 6 + WHTC 6 + WNTE 4 = 16 条；schema 严格下界为
   `15.001 kW`，15 kW 无结果。EU/UN 入口是等效路径而非累计要求。附件对 T 类只给
   未分阶段的 R96/04 引用，2026 homologation law 又把 NRMM 数值、循环和日期交给
   后续细则，construction/agriculture no-data。三条来源统一于
   `2026-08-10T13:17:36Z` 核验。

### ALB（阿尔巴尼亚）

1. **国内加入法**：`Law No. 10476 of 3 November 2011 on accession to the Gothenburg
   Protocol`；publisher `Assembly of the Republic of Albania / Official Publications Centre`；
   `official-regulation`；published `2011-11-25`；URL
   https://qbz.gov.al/alfresco/webdav/FZ/2011/155/fz-2011-155.pdf。
2. **条约状态**：`Gothenburg Protocol participant status: Albania not listed as a party as
   of 2026-08-10`；publisher `United Nations Treaty Collection`；`government-notice`；
   published `null`；URL
   https://treaties.un.org/Pages/ViewDetails.aspx?src=TREATY&mtdsg_no=XXVII-1-h&chapter=27&clang=_en。
3. **建模边界**：加入法附件虽含道路 ESC/ELR/ETC 和非道路 ISO 8178 表，但适用与日期
   以议定书对该缔约方生效为前提；UN 当前参加者表未列 Albania。DCM 633/2018 另仅为
   M1/M2/N1 进口/在用车辆 Euro 标签与检查，未满足 N2/N3/M3 新重型发动机五门槛。
   四 scope no-data；两条 fixture 来源统一于 `2026-08-10T13:09:56Z` 核验。

### UKR（乌克兰）

1. **Euro 最低门槛**：`Law of Ukraine No. 2739-IV on import and first registration of
   transport vehicles (current revision: Euro V through 2026; Euro VI from 2027 for road
   freight and passenger vehicles)`；publisher `Verkhovna Rada of Ukraine / Legislation of
   Ukraine`；`official-regulation`；published `2005-07-06`；URL
   https://zakon.rada.gov.ua/laws/show/2739-15#Text。
2. **型式批准链**：`Order No. 521 on vehicle type approval, as amended by Order No. 188
   (Annex 2 item 52: UN R49-05 B2 / Directive 2005/55 B2 for M/N heavy vehicles)`；
   publisher `Ukraine Ministry of Infrastructure / Verkhovna Rada Legislation of Ukraine`；
   `official-regulation`；published `2012-08-17`；URL
   https://zakon.rada.gov.ua/laws/show/z1586-12#Text。
3. **确定性结果**：2015-12-31 无结果；2016-01-01 起至 `effectiveTo=2027-01-01`
   之前，truck/bus 各返回 Directive 2005/55 B2 压燃机代表路径 9 条：ESC/ELR
   CO/HC/NOx/PM/opacity = 1.5/0.46/2.0/0.02/0.5，ETC CO/NMHC/NOx/PM =
   4.0/0.55/2.0/0.03。2027-01-01 Euro VI 法定地板开始时停止 Euro V 记录，完整
   乌克兰 Euro VI 技术链发布前失败关闭；construction/agriculture no-data。两条来源
   统一于 `2026-08-10T12:59:02Z` 核验。

### MDA（摩尔多瓦）

1. **主法草案公告**：`Government approves draft law on type-approval and market
   surveillance of road vehicles (first modern national unified system; draft sent to Parliament)`；
   publisher `Government of the Republic of Moldova`；`government-notice`；published
   `2026-07-01`；URL
   https://gov.md/en/comunicate-de-presa/more-road-safety-government-sets-clearer-rules-market-surveillance-motor。
2. **配套草案咨询**：`Initiation notice for the draft secondary regulation on road-vehicle
   type approval and market surveillance`；publisher `Moldova Ministry of Infrastructure and
   Regional Development / Particip.gov.md`；`government-notice`；published `2026-07-17`；
   URL
   https://particip.gov.md/ro/document/stages/proiectul-hotararii-guvernului-cu-privire-la-modificarea-unor-hotarari-ale-guvernului-si-aprobarea-r/17988。
3. **建模边界**：两条都是 draft / consultation，未形成已生效的统一 type-approval
   法规，也没有新重型发动机完整类别、功率、污染物表、循环和实施日。四 scope
   no-data，不把批准草案、欧盟衔接或未来配套安排标为 effective。两条来源统一于
   `2026-08-10T13:04:28Z` 核验。

### NPL（尼泊尔）

1. **正式公报**：`नेपाल सवारी साधन प्रदूषण मापदण्ड, २०८२ (संख्या १४, प्रकाशित मिति
   २०८२/०३/०९) — Nepal Gazette Part 5, Vol. 75, No. 14`；publisher `Government of
   Nepal / Ministry of Forests and Environment / Department of Printing`；
   `official-regulation`；published `2025-06-23`；URL
   https://dop.gov.np/content/12562/nepal-vehicle-pollution-criteria--2082--no--14-/。
2. **环境部副本**：`नेपाल सवारी साधन प्रदूषण मापदण्ड, २०८२ / Nepal Vehicle Pollution
   Standard, 2082 — Department of Environment official copy`；publisher `Government of
   Nepal / Department of Environment`；`official-regulation`；published `2026-03-12`；URL
   https://doenv.gov.np/content/71/nepal-vehicle-pollution-standards--2082/。
3. **确定性结果**：标准自公报发布日 2025-06-23 生效；GVW >3,500 kg 的压燃式 M/N
   truck/bus 各返回 WHSC 6 + WHTC 6 + WNTE 4 = 16 条。§3 明文排除 tractor、power
   tiller、dozer、crane、roller、excavator 等，construction/agriculture no-data。当前
   schema 不虚构功率带，并在 measurement basis 保留发布日前信用证/付款的
   grandfathering。两条来源统一于 `2026-08-10T13:22:24Z` 核验。

### ARM（亚美尼亚）

1. `TR CU 018/2011 On safety of wheeled vehicles — ARLIS current consolidated text`；
   publisher `Eurasian Economic Commission / ARLIS`；`official-regulation`；published
   `2011-12-09`；URL https://www.arlis.am/hy/acts/158010/print/act。
2. `TR CU 031/2012 On safety of agricultural and forestry tractors and trailers —
   ARLIS current consolidated text`；同一 publisher/type；published `2012-07-20`；URL
   https://www.arlis.am/hy/acts/202066/print/act。
3. 道路自 2019-01-01 只发布 UN R49-05 B2 压燃机代表路径，truck/bus 各
   9 条；C/EEV、THC/NMHC 替代项与条件性 NH3 不累计。农业 Stage IIIA
   法定范围 P>19、P≤560，四功率带为 `[19.001,37)`、`[37,75)`、
   `[75,130)`、`[130,560.001)`；后两带自 2025-10-01 生效，150 kW 返回
   CO/HC+NOx/PM = 3.5/4.0/0.2 g/kWh。construction no-data；统一核验时刻
   `2026-08-10T14:20:51Z`。

### AZE（阿塞拜疆）

1. `Cabinet Decision No. 2 of 14 January 2014 — Euro 4 environmental-class
   requirement`；publisher `Cabinet of Ministers of Azerbaijan / AZSTAND`；
   `official-regulation`；published `2014-01-14`；URL
   https://azstand.gov.az/upload/files/avro%204.pdf。
2. `AZS 636:2025 Road vehicles of categories M and N — official standard metadata`；
   publisher `Azerbaijan Standardization Institute / e-standard`；`other`；
   published `2025-03-19`；URL
   https://e-standart.gov.az/Standard/Details/838c95ea-0693-4ec2-afe5-808234f0748a。
3. Decision No. 2 未给完整新重型车类别、污染物表与认证循环；AZS
   元数据页没有数值表且 `IsReferenceStandard=No`。四 scope no-data，不从
   Euro 4 标签、目录或 ECE 96 可获性补值；核验时刻
   `2026-08-10T14:20:51Z`。

### GEO（格鲁吉亚）

1. `Government Resolution No. 238 — technical regulation on motor-vehicle emission
   requirements, publication 12`；publisher `Government of Georgia / Matsne`；
   `official-regulation`；published `2023-06-28`；URL
   https://www.matsne.gov.ge/ka/document/view/5845990?publication=12。
2. `Resolution No. 238 — Ministry of Environmental Protection and Agriculture official
   mirror`；publisher `MEPA Georgia`；`official-regulation`；published `2023-06-28`；
   URL https://www.mepa.gov.ge/Ge/Files/Download/55101。
3. 2025-01-01 起仅 N3 truck 与 M3 bus 各返回 B2 ESC/ELR/ETC 9 条。不增加
   PN、柴油 CH4 或旧 >2,610 kg 车辆扩展；construction/agriculture no-data。
   统一核验时刻 `2026-08-10T14:20:51Z`。

### UZB（乌兹别克斯坦）

1. `Cabinet Decision No. 10 of 11 January 2025 — UzTR.10-006:2025 Safety of
   agricultural and forestry vehicles and machinery`；publisher `Cabinet of Ministers /
   LEX.UZ`；`official-regulation`；published `2025-01-13`；URL
   https://lex.uz/uz/docs/7315394。
2. `Cabinet Decision No. 237 of 25 April 2017 — UzTR.237-016:2017 General Technical
   Regulation on Safety of Wheeled Vehicles, Annex 8`；同一 publisher/type；published
   `2017-04-25`；URL https://lex.uz/docs/3180907。
3. 仅对农业 H 带 130≤P≤560 kW 从 2025-10-01 发布 Stage IIIA 三条；150 kW
   返回 3.5/4.0/0.2 g/kWh。Stage II 短暂过渡和未定日 Stage V 不累计。
   UzTR.237 未闭合国内新造/普遍市场投放日期，故道路与 construction no-data。
   统一核验时刻 `2026-08-10T13:40:00Z`。

### KAZ（哈萨克斯坦）

1. `TR CU 018/2011 On safety of wheeled vehicles — current consolidated text, Annex 2
   item 39`；publisher `EEC / Adilet`；`official-regulation`；published `2011-12-09`；
   URL https://adilet.zan.kz/rus/docs/H11T0000877。
2. `TR CU 031/2012 On safety of agricultural and forestry tractors and trailers — Annex 5
   clause 14.1 and Table 5.1`；同一 publisher/type；published `2012-07-20`；URL
   https://adilet.zan.kz/rus/docs/H12EV000060。
3. 道路自 2019-01-01 只发布 B2 9/9；C/EEV 不累计。农业发布 Stage IIIA
   四功率带，150 kW 自 2025-10-01 返回 3 条；19/19.001/37/75/130/560/
   560.001 kW 的条数为 0/3/3/3/3/3/0。construction no-data；核验时刻
   `2026-08-10T13:40:00Z`。

### TJK（塔吉克斯坦）

1. `Law of the Republic of Tajikistan No. 1214 on ensuring environmental safety of road
   transport`；publisher `National Legislation Center under the President`；
   `official-regulation`；published `2015-08-08`；URL
   https://ncz.tj/system/files/Legislation/1214_ru.pdf。
2. `Draft ST JT ____-2024 — Engine emissions: terms and definitions`；publisher
   `Agency for Standardization, Metrology, Certification and Trade Inspection`；
   `government-notice`；published `null`；URL https://standard.tj/documents/files/file_328.pdf。
3. Law No. 1214 把限值/日期交政府另定；草案的编号、批准令和生效日留空且
   无完整限值表。四 scope no-data；核验时刻 `2026-08-10T13:40:00Z`。

### KGZ（吉尔吉斯斯坦）

1. `Official implementation notice for TR CU 018/2011 — entry into force on 12 February
   2016 and transitional documents through 12 February 2018`；publisher `Ministry of
   Economy and Commerce of the Kyrgyz Republic`；`government-notice`；published
   `null`；URL https://www.mineconom.gov.kg/ru/post/4112。
2. `TR CU 031/2012 On safety of agricultural and forestry tractors and trailers — official
   regulation and current text`；publisher `EEC`；`official-regulation`；published
   `2012-07-20`；URL https://eec.eaeunion.org/comission/department/deptexreg/tr/bezopSH.php。
3. 道路从 2019-01-01 只发布 B2 9/9，不累计 C/EEV；农业发布 Stage IIIA
   四功率带，150 kW 自 2025-10-01 返回 3 条，边界同 KAZ。construction
   no-data；核验时刻 `2026-08-10T13:40:00Z`。

### TKM（土库曼斯坦）

1. `Law of Turkmenistan on protection of atmospheric air — Article 21, with 2018 and 2021
   amendments`；publisher `Ministry of Justice of Turkmenistan`；`official-regulation`；
   published `2016-01-01`；URL
   https://minjust.gov.tm/assets/files/law_documents/hukuknama_406_ru.pdf。
2. `TDS 1286-2019 — Gasoline-engine exhaust gases: measurement of carbon monoxide and
   hydrocarbons`；publisher `Main State Service Turkmenstandartlary`；
   `government-notice`；published `2019-01-01`；URL
   https://tds.gov.tm/ru/state/standards?page=32。
3. Article 21 只引用另行确定的移动源规范；TDS 只是汽油机 CO/HC 测量方法。
   四 scope no-data；核验时刻 `2026-08-10T13:40:00Z`。

### AFG（阿富汗）

1. `Regulation on Decrease and Prevention of Air Pollution / مقرره کاهش و جلوگیری از
   آلودگی هوا`；publisher `Islamic Republic of Afghanistan / Ministry of Justice /
   NEPA`；`official-regulation`；published `2009-08-11`；URL
   https://parse.nepa.gov.af/parse/files/nepa/mqrrh_kahsh_w_jlwgyry_az_alwdgy_hwa.pdf；
   NEPA 目录 https://www.nepa.gov.af/showDariPage/25。
2. `Amendment and Repeal of Certain Provisions of the Regulation on Decrease and
   Prevention of Air Pollution`；同一 publisher/type；published `2020-11-21`；URL
   https://parse.nepa.gov.af/parse/files/nepa/tadyl_mqrrh_kahsh_w_jlwgyry_az_alwdgy_hwa_nafdh_shdh_shmarh_mslsl_1393.pdf。
3. Article 6 及修法仍只要求过滤器、合格证、年检和未定义 permitted limit。
   四 scope no-data；核验时刻 `2026-08-10T14:35:00Z`。

### AGO（安哥拉）

1. `Decreto Presidencial n.º 185/13 de 07 de novembro`；publisher `Presidente da
   República / Diário da República de Angola`；`official-regulation`；published
   `2013-11-07`；URL https://files.lex.ao/presidente-da-republica/2013/decreto-presidencial-n-o-185-13-de-07-de-novembro/download/decreto-presidencial-n-o-185-13-de-07-de-novembro_presidente-da-republica_lex-ao.pdf。
2. `Decreto Presidencial n.º 99/20 — Programa Nacional de Normalização Ambiental`；
   同一 publisher；`government-notice`；published `2020-04-13`；URL
   https://files.lex.ao/presidente-da-republica/2020/decreto-presidencial-n-o-99-20-de-13-de-abril/download/decreto-presidencial-n-o-99-20-de-13-de-abril_presidente-da-republica_lex-ao.pdf。
3. 185/13 Article 82 仅是在用车 opacity；99/20 ES11.18 是未来制定重型车
   CO/THC/NOx/PM 标准的工作项。四 scope no-data；核验时刻
   `2026-08-10T14:35:00Z`。

### BDI（布隆迪）

1. `BOB N°11/2012 — Loi N°1/26 portant Code de la circulation routière`；publisher
   `Bulletin Officiel du Burundi / Amategeko`；`official-regulation`；published
   `2012-11-23`；URL https://amategeko.gov.bi/wp-content/uploads/2019/12/BOB_No11-2012.pdf。
2. `Ordonnance Ministérielle conjointe N°750/540/979 du 27/1/2025`；publisher
   `Ministries of Commerce/Transport and Finance`；`official-regulation`；published
   `2025-01-27`；URL https://finances.gov.bi/wp-content/uploads/2025/02/OM-PORTANT-FIXATION-DES-MODALITES-DE-DELIVRANCE-DES-SERVICES-DE-CONTROLE-TECHNIQUE-AUTOMOBILE-ET-DES-PERMIS-DE-TRANSPORT-ROUTIER.pdf。
3. 2012 Code Articles 134–145 只有定性烟气/登记后检查；2025 Ordonnance 只管已登记
   车辆检验服务。四 scope no-data；核验时刻 `2026-08-10T14:35:00Z`。

### BEN（贝宁）

1. `Décret N° 2001-110 du 04 avril 2001 fixant les normes de qualité de l’air`；
   publisher `Présidence / SGG Bénin`；`official-regulation`；published `2001-04-04`；
   URL https://sgg.gouv.bj/doc/decret-2001-110/download。
2. `SGG Documenthèque — Décret N° 2001-110`；publisher `SGG Bénin`；
   `government-notice`；published `2001-04-04`；URL
   https://sgg.gouv.bj/documentheque/763/。
3. Articles 8/13 的 >2,720 kg 整车表混合新旧车条件，检测方法留给后续命令，
   不是可直接建模的新重型发动机认证表。四 scope no-data；核验时刻
   `2026-08-10T14:35:00Z`。

### BFA（布基纳法索）

1. `Décret n°2001-185/PRES/PM/MEE fixant les normes de rejets de polluants dans
   l’air, l’eau et le sol`；publisher `Président du Faso / Journal Officiel facsimile`；
   `official-regulation`；published `2001-05-07`；URL https://faolex.fao.org/docs/pdf/bkf26794.pdf。
2. `NIES du Garage et Atelier de maintenance de la Brigade d’Entretien Routier de
   Ziniaré`；publisher `Burkina Faso government ministries`；`government-notice`；
   published `null`；URL https://www.environnement.gov.bf/fileadmin/user_upload/storages/images/mediatheque/accueil/past_nies_garage_brigade_ziniare.pdf。
3. 法令车辆表按车龄分类，缺 PM、完整重型发动机分类与认证循环；NIES 只是
   项目级引用。四 scope no-data；核验时刻 `2026-08-10T14:35:00Z`。

### BGD（孟加拉国）

1. `বায়ুদূষণ (নিয়ন্ত্রণ) বিধিমালা, ২০২২ / Air Pollution (Control) Rules, 2022
   (S.R.O. No. 255-Law/2022)`；publisher `Ministry of Environment, Forest and Climate
   Change / Bangladesh Government Press`；`official-regulation`；published `2022-07-26`；
   URL https://www.dpp.gov.bd/upload_file/gazettes/45501_95134.pdf。
2. `Extraordinary Gazette of July 2022 — S.R.O. No.255-Law/2022`；publisher
   `Department of Printing and Publications / Bangladesh Government Press`；
   `government-notice`；published `2022-07-26`；URL
   https://www.dpp.gov.bd/bgpress/index.php/document/get_extraordinary/45501。
3. 法规立即生效；Schedule 2 对 GVW >3,500 kg 新 CI 重型车给出 ECE 49 /
   88/77/EEC amended by 91/542/EEC，truck/bus 各返回 CO/HC/NOx/PM =
   4.0/1.1/7.0/0.15 g/kWh。construction/agriculture no-data；核验时刻
   `2026-08-10T14:35:00Z`。

### BHS（巴哈马）

1. `Road Traffic Act (Chapter 220; No. 57 of 1958; LRO 1/2017 consolidation)`；
   publisher `Government of The Bahamas / Statute Law`；`official-regulation`；published
   `1958-09-18`；URL https://laws.bahamas.gov.bs/cms/images/LEGISLATION/PRINCIPAL/1958/1958-0057/1958-0057_2.pdf。
2. `Environmental Planning and Protection Act, 2019 (No. 40 of 2019)`；publisher
   `Parliament / Official Gazette / Government of The Bahamas`；`official-regulation`；
   published `2019-12-20`；2020-01-20 生效；URL
   https://laws.bahamas.gov.bs/cms/images/LEGISLATION/PRINCIPAL/2019/2019-0040/2019-0040_1.pdf。
3. 材料只支持定性 smoke/smell、污染许可与后续标准授权，无新重型发动机表。
   四 scope no-data；核验时刻 `2026-08-10T14:35:00Z`。

### BLR（白俄罗斯）

1. `TR CU 018/2011 On safety of wheeled vehicles — EEC current regulation page`；
   publisher `Eurasian Economic Commission`；`official-regulation`；published
   `2011-12-09`；URL https://eec.eaeunion.org/comission/department/deptexreg/realizatsiya-soglasheniya-o-vvedenii-edinykh-form-pts/normativnaya-baza/tr-ts-018-2011.php。
2. `TR CU 031/2012 On safety of agricultural and forestry tractors and trailers — EEC
   current regulation page`；同一 publisher/type；published `2012-07-20`；URL
   https://eec.eaeunion.org/comission/department/deptexreg/realizatsiya-soglasheniya-o-vvedenii-edinykh-form-pts/normativnaya-baza/tr-ts-031-2.php。
3. 以直接可追溯的现行技术规则链发布道路 B2 9/9 与农业 Stage IIIA 四功率
   带，边界/数值同 ARM；不仅凭 EAEU 成员身份推断。construction no-data；
   核验时刻 `2026-08-10T14:20:51Z`。

### BOL（玻利维亚）

1. `Resolución Ministerial N° 064 de 1 de abril de 2022 — Reglamento para la emisión
   de autorizaciones previas de vehículos automotores`；publisher `Ministerio de Obras
   Públicas, Servicios y Vivienda`；`official-regulation`；published `2022-04-01`；URL
   https://www.oopp.gob.bo/wp-content/uploads/2022/04/RM-064-Y-REGLAMENTO.pdf。
2. `CERTIFICADOS DE ACEPTACIÓN (Importación de vehículos automotores)`；publisher
   `IBMETRO`；`government-notice`；published `null`；URL
   https://ibmetro.gob.bo/certificado-de-aceptacion。
3. RM 064 废止 RM 450 并重发 Annex III Table 4；2022-04-01 起对 >3,500 kg、
   MY2017+ 的 N2/N3/M2/M3 以 ECE 49 代表路径返回 4/4。US HD transient
   替代路径不累计；off-road dumper 税则项不外推为一般 construction，agriculture
   no-data。核验时刻 `2026-08-10T14:35:00Z`。

### 1.48 伯利兹（BLZ）、文莱（BRN）、不丹（BTN）与中非共和国（CAF）

#### BLZ（伯利兹）

- Department of the Environment 官方《Pollution Regulations》regulations 25–26
  要求按发动机类型和车型年设置机动车排放量，并在检查时测试 CO、HC 和曲轴箱压力；
  但正文明确把具体 levels/procedures 和汽油/柴油污染物数量留给部长另行规定，当前
  PDF 没有附上该机动车数值表。
- Department of Transport 的 BMVRA&LS 门户确认当前机动车注册、许可与道路安全
  管理入口，但不补足上述部长规定的数值、重型分类或认证循环。
- 建模结论：`BZ-NATIONAL` 四个 scope 在 `as-of 2026-08-10` 显式 `no-data`；不把
  Ringelmann 可见烟或部长未来规定推断成新重型发动机限值。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Pollution Regulations regulations 25–26 | https://doe.gov.bz/wp-content/uploads/2024/02/Pollution-Regulations.pdf | 已核验并渲染 p.108（2026-08-10；数值/程序留待部长规定） |
| Belize Motor Vehicle Registration and License System | https://bmvrals.gov.bz/portal/ | 已核验（2026-08-10；当前交通管理入口） |

#### BRN（文莱）

- Attorney General's Chambers 的现行《Road Traffic Regulations》regulation 33A
  是车辆在道路使用时不得排放造成伤害、滋扰或危险的可见烟雾等定性义务。
- Land Transport Department 的《Safe and Smart Driving》Chapter 8 明确这是
  roadworthiness inspection；柴油车烟度 `<50% HSU or Bosch Unit`，汽油车另有
  CO/HC 检查。该表属于在用车适行性检查，不是发动机型式认证表。
- 建模结论：`BN-NATIONAL` 四个 scope 显式 `no-data`；不把 HSU/Bosch 检查值换算成
  g/kWh，也不外推至工程或农业机械。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Road Traffic Regulations regulation 33A | https://www.agc.gov.bn/AGC%20Images/LAWS/ACT_PDF/R/CHAPTER%20068%20RG1%20%282022%29.pdf | 已核验（2026-08-10；定性道路运行义务） |
| Safe and Smart Driving Chapter 8 | https://www.jpd.gov.bn/SiteAssets/SitePages/Land%20Transport%20Department/Adverts/Safe%20and%20Smart%20Driving%20In%20Brunei%20Darussalam/Safe%20and%20Smart%20Driving%20in%20Brunei%20Darussalam%201st%20edition.pdf | 已核验并渲染 p.86（2026-08-10；在用车 `<50% HSU`） |

#### BTN（不丹）

- National Environment Commission《Environment Standards 2020》§8 按车辆注册时间
  给出汽油 `%CO` 与柴油 `%HSU`；2021 年后 Euro 6/BS VI approval type 的柴油车辆为
  50% HSU。表格仍以已注册车辆及烟度检查表达，没有新重型发动机污染物表或测试循环。
- BCTA 2026-07-03 通知确认 RSTRR 2026 自 2026-07-01 生效，但通知本身不提供重型
  柴油型式认证数值；不得用已被替代的旧道路规则填补当前缺口。
- 建模结论：`BT-NATIONAL` 四个 scope 显式 `no-data`；保存当前标准和生效通知来源，
  不把 Euro 6/BS VI 标签或 50% HSU 展开成未读回的完整限值。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Environment Standards 2020 §8 | https://www.nec.gov.bt/publications/download/environment-standards-2020 | 已核验并渲染 p.11（2026-08-10；车辆注册/在用车 `%HSU`） |
| RSTRR 2026 实施通知 | https://bcta.gov.bt/public-notification-implementation-of-the-road-safety-and-transport-rules-and-regulations-rstrr-2026/ | 已核验（2026-08-10；2026-07-01 生效） |

#### CAF（中非共和国）

- 卫生与人口部 SENI-PLUS《环境与社会管理框架》施工管理条款要求通过定期维护发动机、
  喷油系统和空气滤清器来减少柴油机烟雾；这是特定项目的环境缓解措施，不是全国新车/
  新发动机认证法规，也没有污染物数值、功基准单位或测试循环。
- 交通与民航部官方门户当前明确标注网站仍在建设，没有公开可读的车辆排放法规正文或
  限值表；原占位的工业部门入口不再作为交通来源。
- 建模结论：`CF-NATIONAL` 四个 scope 在 `as-of 2026-08-10` 显式 `no-data`；不把
  项目维护要求、门户占位页、区域标准或邻国规则升级为国内型式认证事实。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| SENI-PLUS CGES 柴油烟雾维护措施 | https://www.sante.gouv.cf/sites/default/files/2023-08/P177003_SENI%20plus%20CGES%20r%C3%A9vis%C3%A9-ao%C3%BBt23%20Clean%20ESQAT%20Final.pdf | 已核验并渲染 PDF p.162 / 文内 p.138（2026-08-10；项目缓解措施） |
| 交通与民航部官方门户 | https://transports.gouv.cf/ | 已核验（2026-08-10；网站在建设，无法规表） |

### 1.49 刚果民主共和国（COD）、刚果共和国（COG）、古巴（CUB）与吉布提（DJI）

#### COD（刚果民主共和国）

- 《第 11/009 号环境保护基本原则法》Article 47 禁止危害人口、环境或健康的空气排放，
  并把具体空气排放标准留给部长会议法令；该法本身没有车辆或重型发动机限值表。
- 交通部 2025 年第 085 号令对在用汽车、挂车及部分进口二手机械实施周期技术检验；
  Article 6 将尾气排放列为“污染与滋扰”检查项，Article 5 又明确新车前 24 个月免检。
  正文没有污染物数值、发动机功率带或认证循环，因此属于道路适行性/在用车合规边界。
- 建模结论：`CD-NATIONAL` 四个 scope 在 `as-of 2026-08-10` 显式 `no-data`；不把
  一般空气授权或半年技术检验升级为新发动机型式认证限值。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Law No. 11/009 Article 47 | https://medd.gouv.cd/wp-content/uploads/2020/07/attachment1.pdf | 已核验并渲染 p.20（2026-08-10；具体标准留给后续法令） |
| Ministerial Order No. 085/2025 | https://transports.gouv.cd/wp-content/uploads/2025/11/ARRETE-MINISTERIEL-N%C2%B0085-DU-12-NOV-2025-PORTANT-RE_251124_152526.pdf | 已核验并渲染 pp.1、4–5（2026-08-10；周期在用车检查，无数值表） |

#### COG（刚果共和国）

- 《第 33-2023 号可持续环境管理法》Articles 23–24 禁止进口或使用排放烟雾/有毒气体、
  损害健康和环境的车辆或机械，并要求汽车发动机及固定/移动燃烧设备接受周期检查；
  后续法令才确定车辆年龄、发动机技术特征和燃料条件，正文没有数值认证表。
- Official Gazette No. 29-2019 中 Decree No. 2019-171 把“污染和噪声”列入道路车辆
  周期技术检验九项内容，并按车型规定年度、半年、四个月或三个月周期；同样没有尾气
  数值、重型发动机分类和测试循环。
- 建模结论：`CG-NATIONAL` 四个 scope 显式 `no-data`；不把定性禁令、车辆年检或
  “工程/农业设备”周期检查范围外推为新发动机排放标准。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Law No. 33-2023 Articles 23–24 | https://www.developpement-durable.gouv.cg/wp-content/uploads/2023/11/Loi_n_33-2023_du_17_novembre_portant_gestion_durable_de_l_environnement_en_Republique_du_Congo_.pdf | 已核验并渲染 PDF p.9（2026-08-10；定性禁令/周期检查） |
| Gazette No. 29-2019 / Decree No. 2019-171 | https://www.sgg.cg/JO/2019/congo-jo-2019-29.pdf | 已核验并渲染 PDF pp.4、6（2026-08-10；适行性检查与周期） |

#### CUB（古巴）

- Granma 对 2023 年环境管理工作的官方报道确认《第 150/2022 号自然资源与环境体系法》
  及配套法规已在共和国公报发布并进入能力建设阶段，但报道没有车辆/发动机限值表。
- 交通部公开的《第 109 号道路安全法》Articles 182、203–214 禁止尾气污染物超过现行
  规定并建立车辆技术检查；同一官方汇编的补充规则明确所有机动车强制检查 CO 浓度或
  柴油尾气不透光度，但参数仍以道路法、制造商要求及交通部另行规定为准，未列可直接
  建模的新重型发动机数值、功率带或认证循环。
- 建模结论：`CU-NATIONAL` 四个 scope 显式 `no-data`；不采用二手研究所转录的
  Resolution 172/2001 数值，也不把在用车不透光度检查映射成型式认证限值。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Law No. 150/2022 发布与实施边界 | https://www.granma.cu/cuba/2024-06-05/la-clave-de-la-estrategia-ambiental-en-el-pais-esta-en-cuanto-se-haga-en-cada-localidad-05-06-2024-01-06-43 | 已核验（2026-08-10；官方党报报道，无车辆表） |
| Law No. 109 与车辆技术检查补充规则 | https://www.mitrans.gob.cu/sites/default/files/rs_news_files/Ley%20109%20C%C3%B3digo%20de%20Seguridad%20Vial%20%28ilustrado%29.pdf | 已核验并渲染 PDF pp.100、109–110、209、211（2026-08-10；在用车排气/不透光度检查） |

#### DJI（吉布提）

- Law No. 51/AN/09/6ème L 建立一般空气污染与排放管理框架，但没有新重型道路/非道路
  发动机的类别、功率带、污染物限值和认证循环。
- Decree No. 2010-0175/PR/MET Articles 1、3、7 规定公共客运及载货车辆的周期技术
  检验、进口二手车登记前检验，并把尾气排放列入检查项目；Decree No. 80-151/MI
  禁止车辆持续排放明显有色或不透明烟雾；Decree No. 2012-0106/PR/MET Articles 17–18
  要求检验站测量尾气烟度并配备电子排放设备。上述条款均没有可建模的完整新发动机表。
- 建模结论：登记 `DJ-NATIONAL` 与两个精确法规来源，四个 scope 在
  `as-of 2026-08-10` 显式 `no-data`；不把在用车尾气/烟度检查升级为型式认证限值。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Law No. 51/AN/09/6ème L — Environmental Code | https://www.journalofficiel.dj/texte-juridique/loi-n51-an-09-6eme-l-portant-code-de-lenvironnement/ | 已核验（2026-08-10；一般空气污染框架，无发动机表） |
| Decree No. 2010-0175/PR/MET — vehicle technical inspection | https://www.journalofficiel.dj/texte-juridique/decret-n2010-0175-pr-met-relatif-aux-controles-techniques-des-vehicules-circulant-en-republique-de-djibouti/ | 已核验（2026-08-10；Articles 1、3、7，在用车/进口二手车检查） |
| Decree No. 80-151/MI — vehicle smoke and toxic gases | https://www.journalofficiel.dj/texte-juridique/decret-n80-151-mi-completant-le-code-de-la-route-et-relatif-aux-bruits-fumees-gaze-toxiques-perturbations-radioelectriques-emis-par-les-vehicules/ | 已核验（2026-08-10；定性烟雾义务） |
| Decree No. 2012-0106/PR/MET — inspection-centre specification | https://www.journalofficiel.dj/texte-juridique/decret-n2012-0106-pr-met-projet-de-decret-fixant-le-cahier-de-charges-applicable-au-controle-technique-automobile/ | 已核验（2026-08-10；Articles 17–18，无数值表） |

### 1.50 厄立特里亚（ERI）、加蓬（GAB）、几内亚（GIN）与冈比亚（GMB）

#### ERI（厄立特里亚）

- 2017-01-26《Gazette of Eritrean Laws》发布 Proclamation No. 179/2017 与 Legal Notice
  No. 127/2017。Legal Notice Article 12 要求项目遵守适用排放标准，并禁止进口或运行
  不符合规定排放标准的机械/设备，但公报可见条款未给重型发动机数值表。
- 厄立特里亚政府信息部 2021-05-19 报道确认车辆与卡车接受年度检查；该材料说明
  在用车管理存在，但没有排放数值、功率带或认证循环。
- 建模结论：`ER-NATIONAL` 四个 scope 在 `as-of 2026-08-10` 显式 `no-data`。

| 事实 | 来源 URL | 核验 |
| --- | --- | --- |
| Proclamation No. 179/2017 与 Legal Notice No. 127/2017 | https://faolex.fao.org/docs/pdf/eri201709.pdf | 已核验并渲染公报 pp.1、11（2026-08-10；Article 12 委托排放标准，无数值表） |
| 政府确认环境公告已经官方公报发布 | https://shabait.com/2017/06/05/eritrean-government-issues-proclamation-for-environmental-protection/ | 已核验（2026-08-10） |
| Improved public transportation service | https://shabait.com/2021/05/19/improved-public-transportation-service/ | 已核验（2026-08-10；年度车辆/卡车检查，无排放表） |

#### GAB（加蓬）

- Law No. 007/2014 Articles 50、53–55 要求交通政策和车辆减少空气污染，并把阈值与
  汽车污染具体规定留给实施规章；当前正文没有完整新重型发动机限值。
- Order No. 1823/MTACT 对机动车规定周期技术检验，超过 3.5 t 车辆半年一次、公共
  运输车辆四个月一次，检查维护、安全与制动；未列排放数值或发动机认证循环。
- 建模结论：`GA-NATIONAL` 四个 scope 在 `as-of 2026-08-10` 显式 `no-data`。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Law No. 007/2014 on environmental protection | https://journal-officiel.ga/6186-007-2014/ | 已核验（2026-08-10；Articles 50、53–55，数值委托后续规章） |
| Order No. 1823/MTACT — periodic vehicle technical inspection | https://journal-officiel.ga/15254-1823-mtact/ | 已核验（2026-08-10；在用车周期检查，无排放表） |

#### GIN（几内亚）

- Decree D/2019/221/PRG/SGG 于 2019-07-26 颁布 Law L/2019/0034/AN《环境法典》。
  Articles 65–66 要求车辆遵守空气排放技术标准，并禁止超过由规章规定的污染限值；
  法典本身未给新重型发动机限值、类别、功率带或认证循环。
- 几内亚交通部 2025-01-23 报道汽车技术检验数字化工作，只确认检查制度，不提供
  可建模的发动机排放表。
- 建模结论：`GN-NATIONAL` 四个 scope 在 `as-of 2026-08-10` 显式 `no-data`。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Environmental Code promulgation decree and Law L/2019/0034/AN | https://medd.gov.gn/file/2022/12/Code-de-lEnvironnement-du-04-juillet-2019-1.pdf | 已核验并渲染 PDF pp.1、23（文内 p.22；2026-08-10；Articles 65–66） |
| Digitalization of vehicle technical inspection | https://transports.gov.gn/le-ministre-ousmane-gaoual-diallo-discute-de-la-digitalisation-du-controle-technique-automobile/ | 已核验（2026-08-10；无排放数值表） |

#### GMB（冈比亚）

- 《Environmental Quality Standards Regulations, 1999》依据 1994 年国家环境管理法
  制定；regulation 5 与 Schedule I 对环境空气中的 SO₂、PM10、NO₂、铅给出浓度和
  平均时段。这是环境空气质量表，不是车辆或新发动机型式认证限值。
- 总统办公室 2022-07-22 的内阁结论记录了机动车交通、车辆检验与驾驶测试条例方案；
  内阁要求补充利益相关方磋商。该材料没有颁布发动机排放数值，也不能证明方案已生效。
- 建模结论：`GM-NATIONAL` 四个 scope 在 `as-of 2026-08-10` 显式 `no-data`；不把
  `µg/m³` 环境空气浓度转换成 `g/kWh`，也不把内阁审议方案当作 effective regulation。

| 事实 | 来源 URL | 核验 |
| --- | --- | --- |
| Environmental Quality Standards Regulations, 1999 | https://faolex.fao.org/docs/pdf/gam95812.pdf | 已核验并渲染 PDF pp.1–3（2026-08-10；Schedule I 为环境空气浓度） |
| 2022 年第三次内阁会议结论——机动车检验条例方案 | https://op.gov.gm/conclusions-3rd-cabinet-meeting-2022-held-thursday-21st-july | 已核验（2026-08-10；仍要求磋商，无排放数值表） |

### 1.51 几内亚比绍（GNB）、赤道几内亚（GNQ）、格陵兰（GRL）与圭亚那（GUY）

#### GNB（几内亚比绍）

- 2011-03-02 官方公报第二增刊发布 Law No. 1/2011《环境基本法》。Article 9 确认空气
  质量权利，并把向大气排放有害物质交由专门立法；Articles 19–20 是一般污染与噪声
  规则，正文没有车辆或新重型发动机限值表。
- 当前政府门户的交通与通信部页面确认其负责陆路、海运、航空和通信政策；公开文件
  目录未提供道路车辆排放型式认证文书、功率带或测试循环。旧 `gov.gw` 模板站不再
  用作官方来源。
- 建模结论：`GW-NATIONAL` 四个 scope 在 `as-of 2026-08-10` 显式 `no-data`。

| 事实 | 来源 URL | 核验 |
| --- | --- | --- |
| Law No. 1/2011 — Basic Law on Environment | https://faolex.fao.org/docs/pdf/gbs118164.pdf | 已核验并渲染 PDF pp.1、6–7（2026-08-10；Article 9 委托专门立法） |
| Ministry of Transport and Communications | https://bissaugov.com/ministerios/transportes-comunicacoes | 已核验（2026-08-10；主管范围，无排放数值表） |

#### GNQ（赤道几内亚）

- 政府新闻办公室 2013-06-22 的环境保护说明确认环境法 Law No. 7/2003 及其 Article
  155 所建立的机构，但页面没有车辆/发动机排放数值、分类或认证循环。
- 2025-04-02 议会对国家车辆技术检验机构的监督材料确认 ITV 承担诊断和污染控制；
  Malabo 重型车辆诊断线未运行，Malabo/Bata 当时因设备和经费不足只做目视检查。
  这属于在用车检查现状，不是新发动机型式认证表。
- 建模结论：`GQ-NATIONAL` 四个 scope 在 `as-of 2026-08-10` 显式 `no-data`。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Environmental conservation measures — Law No. 7/2003 | https://www.guineaecuatorialpress.com/index.php/noticias/medidas_para_la_conservacion_del_medio_ambiente | 已核验（2026-08-10；只确认法律身份） |
| Parliamentary oversight of the National Vehicle Technical Inspection Agency | https://www.guineaecuatorialpress.com/noticias/sesion_de_control_sobre_la_gestion_de_la_itv_y_el_consejo_de_cargadores_maritimos | 已核验（2026-08-10；目视在用车检查，无数值表） |

#### GRL（格陵兰）

- Nalunaarutit 将 1979-03-27 Administrative Regulation No. 141《格陵兰车辆结构与
  设备规定》标为 `Gældende`，并列出后续修订关系；公开元数据未给新重型发动机
  污染物限值表。
- Greenland Road Traffic Act（Consolidated Act No. 995/2009）§§3–6 建立车辆状态、
  设备授权和警方检验框架，§37 只要求避免不必要的噪声、烟雾或气体，没有数值、功率带
  或认证循环。丹麦当前车辆审批/检查法明确不适用于格陵兰，不能据此复制 EU 数值。
- 建模结论：`GL-NATIONAL` 四个 scope 在 `as-of 2026-08-10` 显式 `no-data`。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Administrative Regulation No. 141/1979 — vehicle construction and equipment in Greenland | https://nalunaarutit.gl/Rigslovgivning/1979/Bekendtgoerelse-nr-141-af-27_03_1979?sc_lang=da | 已核验并渲染状态页（2026-08-10；现行，无发动机表） |
| Consolidated Act No. 995/2009 — Road Traffic Act for Greenland | https://www.retsinformation.dk/eli/lta/2009/995 | 已核验并渲染 PDF pp.1–2、6（2026-08-10；§37 为定性烟气义务） |

#### GUY（圭亚那）

- 法律事务部现行汇编中的 Environmental Protection (Air Quality) Regulations 2000
  regulations 18–20 要求新/二手进口车辆达到 EPA 后续建立的尾气标准并配备有效排放
  控制或诊断技术，也要求所有非摩托车机动车遵守该后续标准；汇编本身没有给出该车辆
  标准的污染物数值、发动机类别、功率基准或认证循环。
- Motor Vehicles and Road Traffic Act Chapter 51:02 section 14 建立车辆适行证制度，
  section 103(1)(xxii) 只授权制定烟雾或可见蒸气排放规则；汇编明确省略正在修订的
  subsidiary legislation，不能据此补写未读回的检查值。
- 建模结论：`GY-NATIONAL` 四个 scope 在 `as-of 2026-08-10` 显式 `no-data`；不得把
  后续标准授权、适行性检查或可见烟雾规则升级为新重型发动机型式认证表。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Environmental Protection (Air Quality) Regulations 2000 — regulations 18–20 | https://mola.gov.gy/laws/Volume%206%20Cap.%2018.01%20-%2023.011696964321.pdf | 已核验并渲染 PDF pp.167–168（2026-08-10；委托后续车辆标准） |
| Motor Vehicles and Road Traffic Act, Chapter 51:02 | https://mola.gov.gy/laws/Volume%2011%20Cap.%2049.02%20-%2058.011696827006.pdf | 已核验并渲染 PDF pp.23、108（2026-08-10；适行证与烟雾规则授权） |

### 1.52 海地（HTI）、伊朗（IRN）、伊拉克（IRQ）与牙买加（JAM）

#### HTI（海地）

- 海地环境部 2024 TPR II 环境与社会管理框架的法律附件确认 2005-10-12 环境管理法令
  于 2006-01-26 刊登《Le Moniteur》，并将其描述为一般环境管理框架；可见条文是环评、
  许可和机构职责，不是新重型发动机排放表。
- 海地政府/MCI 2025-07-18 公告依据 2021 消费者保护法令，要求二手进口车辆和机械在
  进口前接受技术检查并取得 MCI 合格证明；公告没有列出柴油污染物、发动机功率带、
  单位或认证循环。
- 建模结论：`HT-NATIONAL` 四个 scope 在 `as-of 2026-08-10` 显式 `no-data`；不得把
  一般环境框架或进口技术检查当作发动机型式认证限值。

| 事实 | URL | 核验 |
| --- | --- | --- |
| TPR II environmental and social management framework — Haitian legal framework | https://www.mde.gouv.ht/phocadownload/Cges%20projet%20TPR%20II%20Version%20Octobre%202024%20compress.pdf | 已核验并渲染 PDF p.139（文内 p.119；2026-08-10） |
| Mandatory pre-import technical inspection for used vehicles and machinery | https://communication.gouv.ht/communiques/le-mci-intensifie-son-soutien-aux-mpme-et-deploie-davantage-dactions-sur-le-territoire-national/ | 已核验政府公告（2026-08-10；无发动机限值表） |

#### IRN（伊朗）

- 《污染控制与减排技术条例》Article 4 的现行合并日程可读：道路柴油车辆列示
  Euro 6 / EEV / Euro 5 + OEM DPF 等阶段，非道路部分只覆盖 tractors，并列示 Stage
  IIIA/IIIB；Article 4 的 2024 修订进一步调整实施节点。此前将核心日程标为无法读取的
  结论已被 #205 / ADR-130 纠正。
- 该日程仍未同时公开可映射的新重型发动机类别/功率分组、完整污染物数值表及国家认证
  循环；construction 不属于仅列 tractors 的非道路类别。故不能把 Euro/Stage 标签按
  EU/UN 数值补齐。
- 建模结论：`IR-NATIONAL` 四个 scope 在 `as-of 2026-08-11` 显式 `no-data`，零
  regulation/limits；当前恰好两条 accepted source 与五门槛结果见 §3.84。

| 事实 | 法律文本 URL | 核验 |
| --- | --- | --- |
| آیین‌نامه فنی در زمینه کنترل و کاهش آلودگی‌ها (موضوع ماده (۲) قانون هوای پاک) | https://nezamat.ir/post-41054/ | 已核验现行合并条例及可读 Article 4 日程（2026-08-11） |
| اصلاح ماده (۴) آیین‌نامه فنی در زمینه کنترل و کاهش آلودگی‌ها (موضوع ماده (۲) قانون هوای پاک) | https://nezamat.ir/post-44973/ | 已核验 2024 Article 4 修订记录（2026-08-11） |

#### IRQ（伊拉克）

- COSQC 第 507 次会议通过 TR 167/2019 的 Amendment 1/2024；INA/MOT 公告说明
  2026-01-01 起对 2025 model year 及以后进口车辆实施伊拉克车辆规范、检验和登记链。
- 两条公开材料只闭合 amendment identity 与实施边界，未公开 TR 167 的新重型发动机
  分类/功率、完整污染物表或认证循环；不得从“所有车辆”推导欧盟/UN 发动机数值。
- 建模结论：`IQ-NATIONAL` 四个 scope 在 `as-of 2026-08-11` 显式 `no-data`，零
  regulation/limits；当前恰好两条 accepted source 与五门槛结果见 §3.84。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| قرارات هيئة اعتماد المواصفات العراقية في اجتماعها المرقم (507) في 3/3/2024 | https://www.iraqi-standards.org/wan/ns/p/0000018.html | 已核验 COSQC 标准采纳决定（2026-08-11） |
| تشمل جميع المركبات.. التجارة: بدء تطبيق المواصفة العراقية للسيارات مطلع 2026 | https://ina.iq/ar/local/250006-2026.html | 已核验 INA / Ministry of Trade 实施公告（2026-08-11） |

#### JAM（牙买加）

- 能源、交通与电信部的官方表单页确认 Road Traffic Act 2018 与 Road Traffic
  Regulations 2022 于 2023-02-01 实施，并提供现行条例全文。Regulation 66 要求道路
  车辆尾气/烟雾符合 Eighth Schedule，维护柴油泵且不得调高到超过附表；Regulation 67
  要求车辆构造符合该条并禁止可见排放等。
- Eighth Schedule Part A 的 imported heavy-duty vehicle / bus 表只覆盖 1991–1998
  model years，后续二手进口又依赖原属地在用标准和近期尾管测试；附表说明页还把柴油
  排放限值和 in-service testing 表述为 recommended，且没有把重型表绑定到可复算的
  发动机认证循环。当前查询模型没有车辆 model year / import-status 维度，不能把这些
  历史车辆值泛化为当下新重型发动机规则。
- 建模结论：`JM-NATIONAL` 四个 scope 在 `as-of 2026-08-10` 显式 `no-data`；不把
  1991–1998 车型表、进口/在用车边界或车辆检查规则外推为新发动机型式认证限值。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Road Traffic Regulations 2022 — Regulation 66 and Eighth Schedule | https://mtm.gov.jm/wp-content/uploads/2023/02/Road-Traffic-Regulations-May-20-2022-complete.pdf | 已核验并渲染 PDF pp.67–68、288–290（2026-08-10；PDF 页码按 1 起算） |
| Road Traffic Act 2018 / Regulations 2022 implementation and documents | https://mtm.gov.jm/forms/ | 已核验主管部门页面（2026-08-10；实施日 2023-02-01） |

### 1.53 黎巴嫩（LBN）、利比里亚（LBR）、利比亚（LBY）、马里（MLI）、缅甸（MMR）与毛里塔尼亚（MRT）

#### LBN（黎巴嫩）

- 环境部 Law No. 444/2002 Article 24 禁止机器、发动机和车辆排放被禁止的污染物或超过
  national environmental quality standards 所定上限，但该法律页没有给出新重型柴油
  发动机类别、功率带、数值表或认证循环。
- Lebanon Third BUR printed p.168 / PDF p.185 明确记录公交排放法规尚未实施，并建议
  更新/执行针对在用柴油 trucks/buses 允许尾气的 Decree 6603/1995；它是实施缺口和
  在用车边界，不是新发动机型式认证表。
- 建模结论：`LB-NATIONAL` 四个 scope 在 `as-of 2026-08-11` 显式 `no-data`，零
  regulation/limits；不把一般授权或未实施的在用车规则升级为新发动机限值。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| قانون رقم 444 - حماية البيئة | https://moe.gov.lb/%D8%A7%D9%84%D9%88%D8%B2%D8%A7%D8%B1%D8%A9/%D8%A7%D9%84%D9%82%D9%88%D8%A7%D9%86%D9%8A%D9%86-%D9%88%D8%A7%D9%84%D8%A7%D9%86%D8%B8%D9%85%D8%A9/%D8%A7%D9%84%D9%82%D9%88%D8%A7%D9%86%D9%8A%D9%86/%D9%82%D8%A7%D9%86%D9%88%D9%86-%D8%B1%D9%82%D9%85-444-%D8%AD%D9%85%D8%A7%D9%8A%D8%A9-%D8%A7%D9%84%D8%A8%D9%8A%D8%A6%D8%A9.aspx?lang=ar-LB | 已核验环境部 Law 444 Article 24（2026-08-11） |
| Lebanon’s Third Biennial Update Report to the UNFCCC | https://lebanon.un.org/en/download/60471/107789 | 已核验 PDF p.185 / printed p.168 Table 103（2026-08-11） |

#### LBR（利比里亚）

- Environment Protection and Management Law Section 36 要求 EPA 建立移动/固定源排放
  标准与空气污染准则；Section 70 要求建立交通工具检查/许可系统，并禁止不符合已建立
  排放标准的车辆运行或进口。该法律本身没有列出车辆/发动机数值、类别、功率基准或循环。
- 交通部 2025-05-05 公告确认签署交通行政法规汇编，涉及商用车辆、货运、检查、环境
  标准、许可、安全与合规，但公告没有公开可直接入模的条文或限值表。
- 建模结论：`LR-NATIONAL` 四个 scope 在 `as-of 2026-08-10` 显式 `no-data`；不补写
  EPML 委托建立但未在所读正文中出现的标准，也不从“environmental standards”措辞推值。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Environment Protection and Management Law — Sections 36 and 70 | https://epa.gov.lr/wp-content/uploads/2025/10/lbr53038.pdf | 已核验并渲染 PDF pp.26、37（2026-08-10；PDF 页码按 1 起算） |
| Codification of Administrative Regulations for the transport sector | https://mot.gov.lr/media/press-releases/minister-sirleaf-ralph-tyler-signs-ground-breaking-codification-administrative | 已核验交通部公告（2026-08-10；无数值表） |

#### LBY（利比亚）

- 环境部 Law No. 15 Articles 16–17 要求机动车在许可前通过内燃机/燃料类型测试，按主管
  机构确定或采用的标准执行，并规定燃料标准与道路空气监测；公开法律页没有数值表、
  重型发动机分类、功率基准或认证循环。
- 司法部 Road Traffic Law No. 11/1984 Article 5 建立车辆技术检查与许可框架，要求按
  司法决定检查车辆装置、耐久性和安全；该页同样没有柴油发动机排放表。
- 建模结论：`LY-NATIONAL` 四个 scope 在 `as-of 2026-08-10` 显式 `no-data`；不把
  检查授权、后续标准或定性许可义务升级为发动机型式认证限值。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Environmental Protection and Improvement Law No. 15 — Articles 16–17 | https://environment.gov.ly/law-no-15/ | 已核验环境部法律正文（2026-08-10；检查/标准授权，无数值表） |
| Road Traffic Law No. 11 of 1984 — Article 5 | https://aladel.gov.ly/home/%D9%82%D8%A7%D9%86%D9%88%D9%86-%D8%B1%D9%82%D9%85-11-%D9%84%D8%B3%D9%86%D8%A9-1984%D9%85-%D8%A8%D8%B4%D8%A3%D9%86-%D8%A7%D9%84%D9%85%D8%B1%D9%88%D8%B1-%D8%B9%D9%84%D9%89-%D8%A7%D9%84%D8%B7%D8%B1/ | 已核验司法部法律正文（2026-08-10；技术检查框架） |

#### MLI（马里）

- `Arrêté No. 2020-1080/MTMU-SG` Article 2 把 PTAC 超过 3.5 t 的重型车辆纳入强制
  技术检验；Article 7 把尾气列为检验项目，Article 9 要求气体分析仪和不透光度计。
  这是整车在用技术检验，没有新发动机污染物质量限值、功率带或认证循环。
- `Arrêté No. 00-2797` 的道路违法表处罚机动车过量烟雾和有毒、腐蚀性或有气味气体；
  条款是定性道路义务，没有数值发动机表。
- 建模结论：`ML-NATIONAL` 四个 scope 在 `as-of 2026-08-10` 显式 `no-data`；不把
  年检尾气/不透光度项目或定性烟气违法换算为新重型发动机型式认证限值。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Arrêté No. 2020-1080/MTMU-SG — vehicle technical inspection | https://sgg-mali.ml/JO/2020/mali-jo-2020-08.pdf | 已核验并渲染 J.O. PDF pp.22–23（2026-08-10；PDF 页码按 1 起算） |
| Arrêté No. 00-2797 — excessive vehicle smoke and gas offences | https://sgg-mali.ml/JO/2003/mali-jo-2003-11.pdf | 已核验 SGG J.O. 正文（2026-08-10；定性道路义务） |

#### MMR（缅甸）

- `National Environmental Quality (Emission) Guidelines`（Notification 615/2015）
  适用于 EIA 项目及其排放源；其中 >50 MW 热力输入的锅炉、往复式发动机和燃气轮机
  限值属于固定项目源，施工材料章节管理项目粉尘和运输设施，不是车辆发动机认证。
- `Road Safety and Motor Vehicle Management Law`（Pyidaungsu Hluttaw Law
  No. 6/2020）建立车辆登记、管理与检查法律边界，但没有新重型柴油发动机的完整
  污染物表、功率带、法定认证循环或实施分期。
- 建模结论：`MM-NATIONAL` 四个 scope 在 `as-of 2026-08-10` 显式 `no-data`；不把
  固定源限值或车辆管理/检查授权升级为新发动机型式认证限值。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| National Environmental Quality (Emission) Guidelines (Final), Notification No. 615/2015 | https://www.ecd.gov.mm/national-environmental-quality-emission-guidelines-final/ | 已核验（2015-12-29；主管部门页面及官方指南 pp.2、8、70，项目/固定源范围） |
| Road Safety and Motor Vehicle Management Law, Pyidaungsu Hluttaw Law No. 6/2020 | https://www.myanmarrtad.com/?q=en%2Fnode%2F1925 | 已核验（2020-05-26；车辆管理与检查边界，无新发动机认证表） |

#### MRT（毛里塔尼亚）

- `Loi No. 2018-002 relative à la lutte contre la pollution de l'Air` Article 2 覆盖车辆和
  发动机；Articles 13、19 规定污染设备维修、技术检查和禁用处罚，但 Article 23 明确
  车辆/发动机技术与环境要求由后续实施文本另定，本法没有具体发动机限值表。
- `Loi No. 2000-045 portant Code de l'environnement` Articles 31–34 建立空气污染与车辆
  管理框架，并同样把受管排放、车辆期限、设备和燃料要求留给法令。
- 建模结论：`MR-NATIONAL` 四个 scope 在 `as-of 2026-08-10` 显式 `no-data`；不把
  框架法的实施授权补成未读回的发动机限值。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Law No. 2018-002 on air-pollution prevention and control | http://www.environnement.gov.mr/fr/images/reglementations/Loi_pollution_Air_FR.pdf | 已核验并渲染扫描 PDF 全 8 页（2026-08-10；Articles 2、13、19、23） |
| Environment Code Law No. 2000-045 — Articles 31–34 | http://www.environnement.gov.mr/fr/images/reglementations/LOI_Code_de_l_Environnement.pdf | 已核验环境主管部门法典正文（2026-08-10；后续法令授权） |

### 1.54 新喀里多尼亚（NCL）、尼日尔（NER）、尼加拉瓜（NIC）与巴布亚新几内亚（PNG）

#### NCL（新喀里多尼亚）

- `Délibération No. 219 du 11 janvier 2017` 建立环境空气质量改善和监测框架，最低参考
  EU/WHO 环境空气值并要求部分企业监测；它不是车辆或发动机排放认证表。
- DITTT 现行 `Visites techniques` 页面确认客运车辆每 6 个月、>3.5 t 货运及其他车辆
  每 12 个月技术检查，检查目标是道路法规符合性，页面未列发动机排放数值或认证循环。
- 建模结论：`NC-NATIONAL` 四个 scope 在 `as-of 2026-08-10` 显式 `no-data`；环境空气
  参考值和周期技术检查不转换为发动机限值，也不从法国/EU 规则外推到该属地。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Deliberation No. 219/2017 — improvement of ambient air quality | https://juridoc.gouv.nc/JuriDoc/JdJ201.nsf/JoncP/2017-01614/%24File/2017-1614.pdf?openElement= | 已核验并渲染 JONC PDF（2026-08-10；2017-01-24 发布） |
| Vehicle technical inspections — heavy and passenger transport intervals | https://dittt.gouv.nc/vehicule-formalites/visites-techniques | 已核验 DITTT 当前页面（2026-08-10；无排放限值表） |

#### NER（尼日尔）

- Law No. 98-56 Articles 37–40 禁止超过实施文本或特别文本限值的空气污染，Article 39
  要求车辆遵守现行或据该法制定的技术标准；框架法本身没有新重型发动机分类、功率带、
  污染物数值或认证循环。
- Decree No. 2016-522 的国家环境政策把汽车列为空气污染来源，并说明除无重金属燃料外
  具体措施很少；它是政策背景，不是发动机认证表。
- 建模结论：`NE-NATIONAL` 四个 scope 在 `as-of 2026-08-10` 显式 `no-data`，不补写
  尚未从官方正文读回的后续技术标准。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Law No. 98-56 — framework law on environmental management | https://hydraulique.gouv.ne/wp-content/uploads/2025/07/LoiN%C2%B098-056gestiondelEnvironnement.pdf | 已核验并渲染 PDF pp.1、6（2026-08-10；Articles 37–40） |
| National Policy on Environment and Sustainable Development — Decree No. 2016-522 annex | https://environnement.gouv.ne/uploads/documents/PolitiqueNationaleenmatieredel%27EnvironnementetduD%C3%A9veloppementDurable-2016.pdf | 已核对官方索引正文（2026-08-10；政策边界） |

#### NIC（尼加拉瓜）

- National Assembly 合并版 Decree No. 32-97 Articles 22–23 对永久流通及 1999 年后进口
  柴油车辆设置自由加速不透光度，数值按 ≤/>3.5 t、自然吸气/涡轮及新旧/进口状态在
  60%–80% 之间变化；Article 25 明确排除非道路拖拉机与农业/工程机械。
- Consolidated Law No. 431 Articles 59–60 要求车辆排放控制与证书并回指 Decree 32-97，
  仍属于车辆检查制度。当前模型没有这些车辆状态维度，不能任选一个 opacity 值作为
  新重型发动机型式认证限值。
- 建模结论：`NI-NATIONAL` 四个 scope 在 `as-of 2026-08-10` 显式 `no-data`。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Consolidated Decree No. 32-97 — motor vehicle emission control | https://legislacion.asamblea.gob.ni/Normaweb.nsf/xpNormaJuridica.xsp?action=openDocument&documentId=0404E60D225D0ACF062588E2006EE9F8 | 已核验 National Assembly 合并正文 Articles 10–25（2026-08-10） |
| Consolidated Law No. 431 — vehicle emission certificates | https://legislacion.asamblea.gob.ni/Normaweb.nsf/xpNorma.xsp?action=openDocument&documentId=DDDCD831D507891D06258844005A7F39 | 已核验 Articles 59–60（2026-08-10；2022-02-22 合并文本发布） |

#### PNG（巴布亚新几内亚）

- RTA Vehicle Standards and Compliance Rule Section 6A(4)(b) 明确：GVW >4,500 kg、
  2012 年起制造的柴油 motor truck 必须满足 ADR 80/03、Euro V、Japan 05 或 US 2004
  任一替代标准；Section 64B 要求所有进口车辆按该 Rule 认证。RTA rules 页面确认修订版
  自 2019-01-01 生效。
- 本项目只发布 ADR 80/03 代表路径，数值来自已签核澳大利亚政府 diesel HDV 表：ESC
  CO/THC/NOx/PM 为 1.5/0.46/2.0/0.02，ETC CO/NMHC/NOx/PM 为
  4.0/0.55/2.0/0.03 g/kWh。替代路径不累计，每条都保留 2012+ 车型边界。
- Rule 的重型条款只写 `motor truck`，没有同等 omnibus、工程机械或农业机械数值；因此
  `PG-NATIONAL` 仅 `on-road-truck` 返回 8 条，其他三个 scope 显式 `no-data`。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Vehicle Standards and Compliance Rule 2017, including Amendment 1 | https://rta.gov.pg/pdfs/resources/legislation/rules/RTR_VehicleStandardsAndCompliance2018.pdf | 已核验并渲染 PDF pp.1、4、11、44（2026-08-10） |
| RTA Rules — commencement of amended Vehicle Standards and Compliance Rule | https://www.rta.gov.pg/resources/rules/ | 已核验 2019-01-01 生效说明（2026-08-10） |
| Australian Government Standards for Diesel Heavy Duty Vehicles — ADR 80/03 numeric table | https://www.infrastructure.gov.au/sites/default/files/documents/Standards_for_Diesel_HDVs.pdf | 已签核 ADR 80/03 ESC/ETC 数值；在 PNG 仅作为 Section 6A(4)(b) 代表路径的数值来源 |

### 1.55 波多黎各（PRI）、朝鲜（PRK）、巴拉圭（PRY）与巴勒斯坦（PSE）

#### PRI（波多黎各）

- DRNA Regulation No. 5300 Rule 403(B) 禁止柴油车辆静止时连续超过 5 秒排放大于
  20% opacity 的可见空气污染物；这是整车运行/烟度规则，不是新发动机质量排放认证表。
- DTOP Regulation No. 9526 管理官方检查站、周期车辆检查以及机械、电气和气体系统
  诊断。现有官方文本没有本系统所需的新重型发动机分类、功基准、污染物表和认证循环。
- 建模结论：`PR-NATIONAL` 四个 scope 在 `as-of 2026-08-10` 显式 `no-data`；不把
  20% 静止烟度或周期检查映射为型式认证限值，也不从美国联邦规则外推。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Regulation No. 5300 — Air Pollution Control Regulation, Rule 403(B) | https://www.drna.pr.gov/wp-content/uploads/2019/10/Reglamento-5300-Reglamento-Control-Contaminacion-Atmosferica-1995.pdf | 已核验 DRNA 正文 pp.113–114（2026-08-10；在用/静止车辆烟度边界） |
| Regulation No. 9526 — official inspection stations and motor vehicle inspection | https://docs.pr.gov/files/DTOP/Avisos/Reglamentos%20para%20estaciones%20oficiales.pdf | 已核验并渲染 PDF pp.1–3、37（2026-08-10；周期检查范围） |

#### PRK（朝鲜）

- DPR Korea Environment Protection Law Article 19 将允许的环境与污染物标准交由
  Administration Council 确定；Article 21 禁止气体或烟雾超过标准的车辆运行，并要求
  监测车辆排放。公开文本没有数值表、发动机类别、功率基准或认证循环。
- 2016 INDC 列出 Environment Protection、EIA、Air Pollution Protection 等法律框架，
  交通措施只包括提高车辆燃油经济性和发展公共交通，不能代替发动机排放标准。
- 建模结论：`KP-NATIONAL` 四个 scope 在 `as-of 2026-08-10` 显式 `no-data`。原夹具
  误连到韩国 `me.go.kr` / `molit.go.kr` 的来源已纠正，禁止跨司法辖区外推。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Law on the Protection of the Environment — Articles 19–21 | https://faolex.fao.org/docs/pdf/prk22293.pdf | 已核验并渲染 PDF p.2（2026-08-10） |
| Intended Nationally Determined Contribution — legal framework and transport measures | https://faolex.fao.org/docs/pdf/prk187054.pdf | 已核验并渲染 PDF pp.6–7（2026-08-10） |

#### PRY（巴拉圭）

- Decree No. 1269/2019 Articles 5–6 要求 MADES 通过另行决议制定移动源参数，并由市政
  对所有公私车辆的气体和颗粒排放实施检查；Article 19 要求二手进口车在通关前检查。
- MADES 空气规范目录确认 Law 5211/14、Decree 1269/19、Resolution 078/18（移动源参数）
  及后续修改的身份，但当前可读官方材料仍不足以建立本系统所需的新重型发动机认证表。
- 建模结论：`PY-NATIONAL` 四个 scope 在 `as-of 2026-08-10` 显式 `no-data`；不把
  在用车、市政或二手进口检查参数映射为新发动机限值。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Decree No. 1269/2019 implementing Air Quality Law No. 5211/2014 | https://calidadaire.mades.gov.py/storage/documents/files/01KJDCSYWNGC86DGQVJX6AKZKN.PDF | 已核验并渲染 PDF pp.3–4、8（2026-08-10） |
| MADES Air Standards Directorate normative index | https://www.mades.gov.py/normativa-direccion-de-normalizacion-del-aire/ | 已核验移动源决议及修改目录（2026-08-10） |

#### PSE（巴勒斯坦）

- Environment Law No. 7/1999 Article 19 委托空气污染标准，Article 22 禁止机器、发动机
  和车辆排气超过标准；公开合并正文没有重型发动机数值或认证循环。
- Traffic Law No. 5/2000 Articles 3、6、14 要求车辆符合巴勒斯坦规范，并在首次登记与
  续期时通过技术检查；这些属于整车准入/在用车检查边界。
- 建模结论：`PS-NATIONAL` 四个 scope 在 `as-of 2026-08-10` 显式 `no-data`。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Environment Law No. 7 of 1999 — Articles 19 and 22 | https://mjr.ogb.gov.ps/MergedLegislations/ViewText/66/%D9%82%D8%A7%D9%86%D9%88%D9%86-%D8%B1%D9%82%D9%85-7-%D9%84%D8%B3%D9%86%D8%A9-1999%D9%85-%D8%A8%D8%B4%D8%A3%D9%86-%D8%A7%D9%84%D8%A8%D9%8A%D8%A6%D8%A9-%D9%81%D9%84%D8%B3%D8%B7%D9%8A%D9%86 | 已核验 OGB 合并正文（2026-08-10） |
| Traffic Law No. 5 of 2000 — Articles 3, 6 and 14 | https://mjr.ogb.gov.ps/MergedLegislations/ViewText/31/%D9%82%D8%A7%D9%86%D9%88%D9%86-%D8%A7%D9%84%D9%85%D8%B1%D9%88%D8%B1-%D8%B1%D9%82%D9%85-5-%D9%84%D8%B3%D9%86%D8%A9-2000%D9%85-%D9%81%D9%84%D8%B3%D8%B7%D9%8A%D9%86 | 已核验 OGB 合并正文并渲染 PDF p.4（2026-08-10） |

### 1.56 苏丹（SDN）、所罗门群岛（SLB）、塞拉利昂（SLE）、萨尔瓦多（SLV）、索马里（SOM）与南苏丹（SSD）

#### SDN（苏丹）

- Environment Protection Law 2001 Articles 18、20、24 建立一般空气保护义务、污染违法
  和由主管机关制定污染控制标准/方法的授权，但没有车辆或发动机数值表。
- 2025 年提交 UNFCCC 的 Third National Communication 记录车辆增长、城市空气污染，
  交通减缓措施是燃料切换与高效公交等计划；公开文本未出现 Euro、新发动机认证循环或限值。
- 建模结论：`SD-NATIONAL` 四个 scope 在 `as-of 2026-08-10` 显式 `no-data`。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Environment Protection Law 2001 | https://sd.chm-cbd.net/qanwn-hmayt-albyyt-2001 | 已核验 Sudan 国家 CBD CHM 法律全文（2026-08-10） |
| Sudan Third National Communication | https://unfccc.int/documents/646439 | 已核验 UNFCCC 正式提交件（2025-04-14 发布；2026-08-10 读取） |

#### SLB（所罗门群岛）

- Road Transport Act (Cap. 131) 的现行重印文本只按整车重量和载客用途定义 `heavy goods
  vehicle`、`heavy public service vehicle` 等许可类别，并授权车辆登记、检查、道路安全
  状态管理和后续设备规则；全文没有发动机污染物限值、功率带或认证循环。
- NDC 3.0 Annex B/C 的 2035 行动与 KPI 涉及更高效率 ICE 车辆、电动车/公交和生物燃料
  车辆，属于气候政策目标，不是强制型式认证标准。
- 建模结论：`SB-NATIONAL` 四个 scope 在 `as-of 2026-08-10` 显式 `no-data`；不把
  整车许可分类、道路检查、IPCC 清单因子或 NDC KPI 转换为发动机限值。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Road Transport Act (Cap. 131), as in force at 1 June 2016 | https://attorneygenerals.gov.sb/wp-content/uploads/2024/09/Road-Transport-Act-Cap.-131-v4_as-at-010616.pdf | 已核验全文及 §§3B、6、44、71、82（2026-08-10；发布日期不明） |
| Solomon Islands Nationally Determined Contribution 3.0, 2025–2035 | https://unfccc.int/sites/default/files/2025-08/Solomon%20Islands%20NDC3.0.pdf | 已核验 Annex B/C pp.31、33（2026-08-10；精确发布日期不明） |

#### SLE（塞拉利昂）

- Gender-Sensitive National e-Mobility Strategy 印刷 p.38 明确本国不开展 type approval
  testing，只通过目的地检查和出口 OEM 合格证明控制进口车辆；印刷 p.39 将 Euro IV/V/VI
  路线写成 `proposed` BAU/BTB 情景，印刷 p.54 再明确这些是污染影响估算假设。
- Environment Protection Agency Act 2022 §77(2)(h) 仅授权以后通过 statutory instrument
  制定防止或减少污染的标准、指南或方法，法案本身没有车辆/发动机数值表。
- 建模结论：`SL-NATIONAL` 四个 scope 在 `as-of 2026-08-10` 显式 `no-data`；不把
  政策提案、建模假设、目的地检查或一般标准授权当作生效的发动机认证要求。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Gender-Sensitive National e-Mobility Strategy for Sierra Leone (2024–2035) | https://epa.gov.sl/wp-content/uploads/2025/03/Gender-Sesitive-National-e-Mobility_-Strategy-2024-35_EPA-converted0.pdf | 已核验并渲染印刷 pp.38–39、54（2024-11-22 发布；2026-08-10 读取） |
| The Environment Protection Agency Act, 2022 (Act No. 15 of 2022) | https://www.parliament.gov.sl/uploads/acts/THE%20ENVIRONMENT%20PROTECTION%20AGENCY%20ACT%2C%202022.pdf | 已核验 §§1、77，Government Gazette 2022-09-15（2026-08-10 读取） |

#### SLV（萨尔瓦多）

- RTS 13.01.02:23 p.26 §§1.1、2.1 把适用范围限定为在用、流通道路车辆；p.31 §5.2.2
  对柴油车辆只检查烟度，pp.51–52 §7.2.3.3 规定四次自由加速测量。p.32 §5.5/Table 4
  的轻型 60%、重型 70% 与运输车辆 50% opacity 均是在用车检查阈值，不是发动机认证表。
- p.26 §2.2 明确排除农业拖拉机、农业机械、公共工程/建筑机械和非道路设计车辆；p.62
  §12 规定发布 12 个月后生效，即 `2025-06-13`。这些边界不能换算为 `g/kWh` 污染物
  限值，也不能据此推断新发动机认证循环。
- 建模结论：`SV-NATIONAL` 四个 scope 在 `as-of 2026-08-10` 显式 `no-data`；道路
  检查值不进入新发动机模型，construction/agriculture 遵守正文排除边界。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| RTS 13.01.02:23 — Calidad del aire. Control de emisiones atmosféricas generadas por fuentes móviles. Vehículos terrestres. Límites permisibles, especificaciones técnicas del equipo y procesos de medición | https://www.diariooficial.gob.sv/seleccion/31287 | 已核验 pp.26、31–32、51–52、62 的范围、opacity 测量与生效规则（2024-06-13 发布；2026-08-10 读取） |
| OSARTEC official RTS 13.01.02:23 publication page | https://osartec.gob.sv/conoce-el-rts-13-01-0223-calidad-del-aire-control-de-emisiones-atmosfericas-generadas-por-fuentes-moviles-vehiculos-terrestres-limites-permisibles-especificaciones-tecnicas-del-equipo-y-procesos/ | 已核验法规身份与主管机构发布页（2025-05-30 发布；2026-08-10 读取） |

#### SOM（索马里）

- Environmental Protection and Management Act Article 27 委托主管机关以后建立空气质量
  标准；Article 29 要求机动车及其他运输工具遵守以后建立或交通主管部门规定的排放标准，
  但正文没有新重型发动机类别、功率带、污染物数值或认证循环。
- First Biennial Update Report p.115 明确当时缺少运输政策，并把高效率发动机以及
  Euro IV–VI 仅列为未来推广的政策方向；清单排放因子同样不是认证限值。
- 建模结论：`SO-NATIONAL` 四个 scope 在 `as-of 2026-08-10` 显式 `no-data`；不把
  后续标准授权、一般禁止义务、清单核算或未来 Euro 方向标记为 effective regulation。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Environmental Protection and Management Act | https://moecc.gov.so/wp-content/uploads/2024/10/Environmental-Protection-and-Management-Act-Engl_240625_145520-2.pdf | 已核验 Articles 27、29（2024-04 文本；2026-08-10 读取） |
| Somalia's First Biennial Update Report | https://unfccc.int/documents/627646 | 已核验 p.115 运输政策现状与未来方向（2023-04-06 发布；2026-08-10 读取） |

#### SSD（南苏丹）

- National Bureau of Standards Act 2012 pp.7–9 §§8–9 只赋予标准制定、采纳、检测和
  合格评定的一般职权；pp.13–15 §§15、17–21 要求具体标准和强制标准另行声明，并由
  Gazette notice 公布。该法本身没有车辆、柴油发动机、污染物、功率带或认证循环；
  §19 的十二个月 permit 是 standards mark 许可，不是发动机型式认证。
- Second NDC 印刷 p.118（PDF p.120）§7.10.3.1/Table 27 把低效车辆进口政策以及
  `Develop guidelines and standards to control vehicular air pollution`、建立尾气检测中心
  全部标为 `Yet to be implemented`。检测失败后的维修/报废属于拟议在用车管理，
  `Short term` 也不是法定生效日。
- 建模结论：`SS-NATIONAL` 四个 scope 在 `as-of 2026-08-10` 显式 `no-data`；不把
  一般标准授权、未来进口政策或未实施的尾气检测计划升级为新发动机认证要求。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| National Bureau of Standards Act, 2012 — separate declaration required for compulsory standards | https://ssnbs.gov.ss/wp-content/uploads/2026/02/National-Bureau-of-Standards-Act-2012-.pdf | South Sudan National Bureau of Standards；`official-regulation`；`publishedOn: null`；已核验 pp.7–9、13–15（2026-08-10） |
| South Sudan's Second Nationally Determined Contribution — unimplemented vehicle-emission standards and exhaust testing | https://unfccc.int/documents/497930 | South Sudan Ministry of Environment and Forestry / UNFCCC；`government-notice`；2022-06-02 发布；已核验印刷 p.118（PDF p.120）（2026-08-10） |

### 1.79 苏里南（SUR）、叙利亚（SYR）、乍得（TCD）与 TGO/TLS/TTO/TWN（2026-08-10）

#### SUR（苏里南）

- Milieu Raamwet (S.B. 2020 no. 97) PDF p.21 Article 27(1)–(4) 允许主管机关以后通过
  `beschikking` 为污染物、产品、装置和机器制定标准；Article 28 规定后续监测/测量安排。
  框架法本身没有柴油发动机分类、功率带、污染物表或认证循环。
- S.B. 2019 no. 35 PDF p.53 §13.1.2(7)–(9) 只要求机动车复检场所配置 CO meter、
  排气软管和把尾气排出检测空间的设施。这是复检场地和在用车服务条件，不是新发动机
  型式认证限值。
- 建模结论：`SR-NATIONAL` 四个 scope 在 `as-of 2026-08-10` 显式 `no-data`；不把
  后续 `beschikking` 授权或复检设施条件升级为发动机认证表。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Milieu Raamwet, S.B. 2020 no. 97 — delegated contaminant and machine standards | https://www.dna.sr/media/bkih12kt/sb_2020___97.pdf | De Nationale Assemblée / Staatsblad van de Republiek Suriname；`official-regulation`；2020-05-14 发布；已核验 PDF p.21 Articles 27–28（2026-08-10） |
| S.B. 2019 no. 35 — licensing conditions for motor-vehicle reinspection facilities | https://gov.sr/wp-content/uploads/2022/05/sb-2019-no-35-besch-min-hi-en-t-alg-voorw-verg-bedr.pdf | Ministerie van Handel, Industrie en Toerisme / Staatsblad van de Republiek Suriname；`official-regulation`；2019-04-18 发布；已核验 PDF p.53 §13.1.2(7)–(9)（2026-08-10） |

#### SYR（叙利亚）

- Law No. 12 of 2012 PDF p.2 Article 2 只建立防治污染的一般框架；p.3 Article 3(5)、
  (7)、(9) 涉及项目 EIA、设施环境条件和以后制定标准，p.4 Article 3(14) 是一般合规检查。
  pp.15–16 Article 24 明确终止适用 Environment Law No. 50/2002，不能继续引用旧法补值。
- SANA / Ministry of Economy and Industry 2025-06-30 公告只规定进口车辆类型、座位数
  和车龄边界：truck heads/trucks/public works/agricultural tractors 最长 10 年，至少
  32 座 buses 最长 4 年；它不规定排放类别、数值或循环。
- 建模结论：`SY-NATIONAL` 四个 scope 在 `as-of 2026-08-11` 显式 `no-data`，零
  regulation/limits；不把一般授权、已废止旧法或进口/车龄政策升级为发动机法规。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Law No. 12 of 2012 — environmental framework and delegated standards | https://faolex.fao.org/docs/pdf/syr212392.pdf | Syrian Arab Republic / FAOLEX；`official-regulation`；2012-03-29 发布；已核验 Articles 2、3、20、24、26（2026-08-10） |
| وزارة الاقتصاد والصناعة توضح أسباب منع استيراد السيارات المستعملة | https://sana.sy/economy/2238146/ | Syrian Arab News Agency (SANA) / Ministry of Economy and Industry；`government-notice`；2025-06-30 发布；已核验进口/车龄边界（2026-08-11） |

#### TCD（乍得）

- Decree No. 904/PR/PM/MERH/2009 PDF p.28 Article 144 明确粉尘、烟气及有毒、腐蚀性
  或放射性气体将由另一份空气与大气实施文本管理；本 decree 没有机动车发动机污染物表。
  PDF p.39 Article 207 对车辆、装卸机械和工程机械的 conformity/type homologation 仅涉及
  `émissions sonores`，不能当作尾气或柴油发动机型式认证。
- First BUR 印刷 p.23 只记录车队以 10–15 年二手车、最长 20 年道路牵引车为主；印刷
  p.33 的 2030 减缓措施是改善道路、公共交通、限制进口车辆平均车龄等未来政策；印刷
  p.65 又确认国家排放因子数据不足。清单因子和减缓方案都不是认证限值。
- 建模结论：`TD-NATIONAL` 四个 scope 在 `as-of 2026-08-10` 显式 `no-data`；不把
  后续空气文本、噪声 homologation、老旧车队描述或未来减缓计划升级为发动机法规。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Decree No. 904/PR/PM/MERH/2009 — environmental pollution and nuisance framework | https://www.environnement.gouv.td/sites/default/files/inline-files/7.pdf | Republic of Chad / Ministry of Environment and Fisheries Resources；`official-regulation`；2009-08-06 发布；已核验 Articles 144、207（2026-08-10） |
| Chad First Biennial Update Report — ageing vehicle fleet and planned transport mitigation | https://unfccc.int/documents/645659 | Republic of Chad / UNFCCC；`government-notice`；2025-02-12 发布；已核验印刷 pp.23、33、65（2026-08-10） |

#### TGO（多哥）

- Loi n° 2026-007 PDF pp.47、51、53 的 Articles 38、76–78、96、99–100 把环境质量、
  污染物清单、空气阈值和车辆/机器条件留给以后 decree、order 或实施文本。Article 99
  只禁止流通中运输工具超过以后法规阈值；正文没有新发动机分类、功率带、数值表或循环。
  PDF p.57 Article 140 废止冲突旧规定，法律于 2026-03-24 签署、2026-04-09 刊登，未设
  独立发动机标准实施日。
- Décret n° 2022-085/PR PDF p.122 Article 2 的 `automobile` 定义明确排除拖拉机、公共工程
  车辆和工业机械（运输用途仅属附带时）；p.135 Articles 161–162 只要求正常工作的静音
  排气装置，并把污染排放章细节交由后续跨部令。p.137 Articles 186–188 同样委托车辆
  装备规则并完成公报发布；没有污染物限值或认证循环。
- 建模结论：`TG-NATIONAL` 四个 scope 在 `as-of 2026-08-10` 显式 `no-data`；不把
  环境授权、在用流通禁止、消声器要求或非道路车辆定义升级为新发动机认证表。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Loi n° 2026-007 du 24 mars 2026 modifiant et complétant la loi n° 2008-005 du 30 mai 2008 portant loi-cadre sur l’environnement | https://jo.gouv.tg/sites/default/files/JO/JO_SPECIAL_BIS_71E_N_25.pdf | République togolaise / Journal Officiel de la République Togolaise；`official-regulation`；2026-04-09 发布；已核验 PDF pp.39、47、51、53、57（2026-08-10） |
| Décret n° 2022-085/PR du 03/08/22 fixant les modalités d’application de la loi n° 2013-011 du 07 juin 2013 portant code de la route | https://www.jo.gouv.tg/sites/default/files/JO/JOS_07_10_2022%20-%2067%20E%20ANNEE%20N%C2%B041%20BIS.pdf | République togolaise / Journal Officiel de la République Togolaise；`official-regulation`；2022-10-07 发布；已核验 PDF pp.121–122、135、137（2026-08-10） |

#### TLS（东帝汶）

- Decreto-Lei n.º 26/2012 PDF p.20 Article 14 要求国家另行发布环境质量及排放/排放物
  标准；Article 23 只是空气保护职责，Article 33 要求设施、机器、设备和运输工具遵守
  已另行建立的标准并配置减排装置。p.29 Article 67 仅在国内环境质量标准形成前引用 WHO
  环境质量标准，不提供发动机认证限值。
- Código da Estrada PDF p.29 Article 73 禁止流通车辆产生异常烟气，属于定性在用车规则；
  pp.39–41 Articles 102–103 只定义农业与工业车辆，Articles 108–110 把车辆特征、车型
  批准和登记/周期检查细节交由后续规则。正文没有新重型发动机污染物表或认证循环。
- 建模结论：`TL-NATIONAL` 四个 scope 在 `as-of 2026-08-10` 显式 `no-data`；不把
  一般标准授权、环境质量标准、异常烟气义务、车辆定义或检查/车型批准框架映射成发动机限值。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Decreto-Lei n.º 26/2012, de 4 de Julho — Lei de Bases do Ambiente | https://www.mj.gov.tl/jornal/public/docs/2012/serie_1/serie1_no24.pdf | Government of Timor-Leste / Jornal da República；`official-regulation`；2012-07-04 发布；已核验 PDF pp.20、29 的 Articles 14、67 及正文 Articles 23、33（2026-08-10） |
| Decreto-Lei n.º 6/2003, de 3 de Abril — Código da Estrada | https://www.mj.gov.tl/jornal/public/docs/2002_2005/decreto_lei_governo/6_2003.pdf | Government of Timor-Leste / Jornal da República；`official-regulation`；2003-04-03 发布；已核验 PDF pp.29、39–41 的 Articles 73、102–103、108–110（2026-08-10） |

#### TTO（特立尼达和多巴哥）

- 来源职责保持分离：Air Pollution Rules 是 environment boundary evidence；Motor Vehicles
  and Road Traffic Act 合并本是 transport boundary evidence，二者都不创建 numeric limit。
- Motor Vehicles and Road Traffic Act 官方站 2024 合并本 PDF p.113 s.100(1)(q) 只授权部长
  以后以 Regulations 规定 `prescribed vehicle emissions`；p.179 的 3,200 kg 等年度检查
  分类、p.220 的可见烟雾/蒸气义务、pp.278、282–283 的 emission tester、smoke meter
  和检查表都属于在用车制度。官方 PDF 带 `UNOFFICIAL VERSION` 水印，修订表截至
  LN 245/2024，故 `publishedOn` 保持 `null`，不把文件生成日当作法律发布日期。
- Air Pollution Rules 2014 PDF p.28（印刷 p.78）Rule 42(1)–(2) 明确 Schedule 2 不适用于
  车辆 operational release，并把它定义为车辆发动机燃烧燃料用于动力的污染物释放。
  p.31 的 `mg/Nm³` 表是 stack release limits；p.33 的 agriculture/fixed-facility 类别也
  不是农业或工程移动发动机标准。
- 建模结论：`TT-NATIONAL` 四个 scope 在 `as-of 2026-08-10` 显式 `no-data`；不把
  在用车检查质量门槛、可见烟雾或被明文排除的固定源表转换为发动机型式认证限值。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Motor Vehicles and Road Traffic Act, Chapter 48:50 — 2024 consolidated unofficial version | https://laws.gov.tt/ttdll-web2/revision/download/121849?type=amendment | Office of the Attorney General and Ministry of Legal Affairs / Digital Legislative Library, Republic of Trinidad and Tobago；`official-regulation`；`publishedOn: null`；已核验 PDF pp.113、179、220、278、282–283（2026-08-10） |
| The Air Pollution Rules, 2014 — vehicle operational releases excluded by Rule 42 | https://www.ec.gov.tt/images/stories/2019-pdf/legislation/Air%20Pollution%20Rules.pdf | Republic of Trinidad and Tobago / Environmental Management Authority；`official-regulation`；2015-01-23 发布；已核验 PDF pp.28、31、33（2026-08-10） |

#### TWN（台湾）

- 《移動污染源空氣污染物排放標準》第五條 PDF pp.9–11 的第六期表直接覆盖重型柴油及
  替代清洁燃料引擎客货车：WHSC 为 CO 1500、THC 130、NOx 400、PM 10 mg/kWh、
  PN 8e11 #/kWh、NH3 10 ppm；WHTC 为 CO 4000、THC 160、NOx 460、PM 10、
  PN 6e11、NH3 10；WNTE 为 CO 2000、THC 220、NOx 600、PM 16 mg/kWh，共 16 条。
- 第六期法定阶段从 2019-09-01 开始，但备注九允许 2019-08-31 前已取得合格证明函的
  既有重型柴油引擎车型继续生产、制造或进口至 2021-08-31。当前 schema 没有新/既有
  引擎族维度，故从 2021-09-01 全覆盖边界建模，不能把该日期误写成首次法定实施日。
- 《柴油及替代清潔燃料引擎汽車車型排氣審驗合格證明核發撤銷及廢止辦法》及重型引擎族
  审验附件确认新车型合格证明与引擎族认证边界。当前只保存 WHSC/WHTC/WNTE 欧盟式
  代表路径，不与美国 FTP 替代认证路径累计；两份文本均未给 construction/agriculture
  独立新发动机限值。
- 建模结论：`TW-NATIONAL` 的 `on-road-truck`、`on-road-bus` 自 2021-09-01 各返回
  16 条代表路径限值；`construction`、`agriculture` 显式 `no-data`。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| 移動污染源空氣污染物排放標準第五條 — 柴油汽車完整排放標準表 | https://oaout.moenv.gov.tw/law/Download.ashx?FileID=133507&id=FL015347&type=LAW | Taiwan Ministry of Environment；`official-regulation`；2023-06-30 发布；已核验 PDF pp.9–11 的第六期表、循环及备注九（2026-08-10） |
| 柴油及替代清潔燃料引擎汽車車型排氣審驗合格證明核發撤銷及廢止辦法 — 重型引擎族審驗 | https://oaout.moenv.gov.tw/law/LawContent.aspx?id=FL020193 | Taiwan Ministry of Environment；`official-regulation`；2024-02-01 发布；已核验正文及重型引擎族审验附件（2026-08-10） |

### 1.80 委内瑞拉（VEN）、瓦努阿图（VUT）、也门（YEM）与特殊地区边界（2026-08-10）

#### VEN（委内瑞拉）

- Decreto Nº 2.673/1998 PDF p.7 定义 M2/M3、N2/N3 道路类别；pp.10–11 Article 7/
  Table 4 对 MY2000 起进口或国内组装且最大整车重量 >3,500 kg 的柴油车辆给出
  Directive 91/542/EEC 代表路径：CO 4.5、HC 1.1、NOx 8.0、PM 0.36 g/kWh。
  p.11 脚注规定最大功率 ≤85 kW 时 PM 乘 1.7，即 0.612 g/kWh。
- PDF p.12 Article 11 将欧洲与美国重型瞬态测试体系列为替代认证路径，不能累计；
  p.17 Article 24 明确排除工程、非道路采矿与农业机械。2015 Ley de Calidad de las
  Aguas y del Aire PDF p.6 Articles 53、62 将移动源具体限值留给 decree，p.12 过渡条款
  又在新规章发布前保留不冲突的既有技术规则，因此该法没有自行替换已读回的 Table 4。
- 建模结论：`VE-NATIONAL`、regulation 和 limit 均从归一化 MY2000 边界
  `2000-01-01` 可查询；`on-road-truck`、`on-road-bus` 在 ≤85 kW 各返回
  4.5/1.1/8.0/0.612，>85 kW 各返回 4.5/1.1/8.0/0.36 g/kWh。只保存欧洲代表路径；
  `construction`、`agriculture` 因 Article 24 明文排除而保持 `no-data`。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Decreto Nº 2.673 de 19 de agosto de 1998 — Normas sobre emisiones de fuentes móviles | https://faolex.fao.org/docs/pdf/ven181032.pdf | Presidencia de la República / Gaceta Oficial de la República de Venezuela；`official-regulation`；1998-09-04 发布；已核验 PDF pp.7、10–12、17 |
| Ley de Calidad de las Aguas y del Aire — mobile-source limits and preservation of prior technical rules | https://faolex.fao.org/docs/pdf/ven151760.pdf | Asamblea Nacional / Gaceta Oficial de la República Bolivariana de Venezuela；`official-regulation`；2015-12-28 发布；已核验 PDF pp.6、12 |

#### VUT（瓦努阿图）

- Pollution (Control) Act No. 10 of 2013 PDF p.12 §18 只要求车辆达到未在该法中填充的
  `prescribed standards/limit`；p.16 §27 仅授权以后以 regulations 制定污染、车辆排放
  与燃料标准。正文没有新重型发动机类别、额定功率基准、完整污染物表或认证循环。
- 2025 amendment Bill PDF p.1 说明 Euro 4+ 政策当时没有 Act 实施，p.5 拟议新 §4
  仍只要求进口车辆满足 `prescribed standards`，pp.6–7 仍需 delegated regulations。
  议会页面虽标记 `Passed`，公开 PDF 的 Act No. 仍为空，未读回总统 assent 或 Gazette
  发布；p.4 §2 又规定只在 Gazette 发布日生效，故不能把通过议会的 Bill 标成 effective Act。
- 建模结论：`VU-NATIONAL` 四个 scope 在 `as-of 2026-08-10` 显式 `no-data`；
  不把一般授权、未填充标准、Euro 政策标签或缺少法定公布证据的 Bill 升级为发动机限值。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Pollution (Control) Act No. 10 of 2013 — prescribed vehicle-emission standards and delegated regulations | https://mocca.gov.vu/images/publications/legislation/DEPC/Legislation/Pollution%20%28Control%29%20Act..pdf | Republic of Vanuatu / Department of Environmental Protection and Conservation；`official-regulation`；2014-06-27 发布；已核验 PDF pp.2、12、16 |
| Bill for the Import of Motor Vehicles (Control) (Amendment) Act No. of 2025 | https://parliament.gov.vu/images/Bills/Second%20Ordinary%20session%202025/Bill%20for%20the%20Motor%20Vehicles/Bill%20for%20the%20Motor%20Vehicles%20Control%20Am%20Act%20No.%20%20of%202025.pdf | Parliament of the Republic of Vanuatu / Ministry of Infrastructure and Public Utilities；`government-notice`；`publishedOn: null`；已核验 PDF pp.1、4–7 及议会 `Passed` 状态 |

#### YEM（也门）

- `قانون رقم (26) لسنة 1995م بشأن حماية البيئة` Articles 30–33 只要求主管机关以后制定
  车辆废气、噪声与燃料标准，并通过决定及 Official Gazette 另行发布；该法本身没有
  新重型发动机分类、功率基准、完整污染物限值表、认证循环或具体实施日。
- `قانون المرور وتعديلاته`（Traffic Law No. 46/1991，合并至 Law No. 12/2002）Article 14
  规定车辆登记和周期技术检查，Article 68(6) 只定性禁止产生浓烟或恶臭的车辆上路。
  二者都是车辆管理/在用车义务，不是新发动机型式认证表。
- 建模结论：`YE-NATIONAL` 四个 scope 在 `as-of 2026-08-10` 显式 `no-data`。
  Yemen Public Prosecution 官方法库证明文本来源，但当前收录状态不等于战后各控制区
  执法统一；不得从一般授权、检查或定性烟气条款补写数值。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| قانون رقم (26) لسنة 1995م بشأن حماية البيئة — Law No. 26 of 1995 on Environmental Protection | https://www.agoye.gov.ye/page.php?id=323&lng=arabic | Yemen Public Prosecution (Office of the Attorney General) / Republic of Yemen；`official-regulation`；1995-10-29 发布；已核验 Articles 30–33 |
| قانون المرور وتعديلاته — Traffic Law No. 46 of 1991, consolidated through Law No. 12 of 2002 | https://www.agoye.gov.ye/page.php?id=275&lng=arabic | Yemen Public Prosecution (Office of the Attorney General) / Republic of Yemen；`official-regulation`；2002-03-18 发布；已核验 Articles 14、68(6) |

#### ATA（南极洲）

- Protocol on Environmental Protection to the Antarctic Treaty Articles 2–3 建立南极环境
  保护目标及活动原则，Article 8 建立环境影响评估，Article 13 要求各缔约方采取措施保证
  遵守。它证明的是国际条约治理边界，不创建 ATA 国家司法辖区或重型发动机排放表。
- 建模结论：`AQ-BOUNDARY` 四个 scope 显式 `no-data`；不得把任何缔约方国内法、
  基地运营要求或 EIA 条件外推为 ATA 新发动机型式认证。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Protocol on Environmental Protection to the Antarctic Treaty — environmental governance boundary | https://documents.ats.aq/recatt/Att006_e.pdf | Antarctic Treaty Secretariat；`official-regulation`；1991-10-04 发布；已核验 Articles 2–3、8、13（PDF pp.1–6、8–9） |

#### ATF（法属南部和南极领地）

- Code de l'environnement Articles L640-1 à L640-5 只规定环境法典条款在该领地的适用、
  改写和机构替换。该页面没有 ATF 独立的新重型道路/非道路发动机类别、功率带、完整
  污染物表、认证循环或实施日。
- 建模结论：`TF-BOUNDARY` 四个 scope 显式 `no-data`；不得只因法国主权或一般环境
  法适用条款而自动复制法国/EU 发动机限值。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Code de l'environnement, articles L640-1 à L640-5 — provisions applicable in the French Southern and Antarctic Lands | https://www.legifrance.gouv.fr/codes/id/LEGISCTA000006143761 | République française / Légifrance；`official-regulation`；`publishedOn: null`；已核验现行 Articles L640-1–L640-5 |

#### ESH（西撒哈拉）

- 联合国 Western Sahara 页面确认其 Non-Self-Governing Territory/去殖民化地位，
  只用于司法管辖与治理边界。页面没有新重型发动机类别、功率基准、污染物表、认证循环
  或实施日，也不能证明某一治理实体的规则可作为全 ESH 法规发布。
- 建模结论：`EH-BOUNDARY` 四个 scope 显式 `no-data`；不得把摩洛哥、SADR、
  西班牙或其他国家/实体的规则未经直接适用证据归属到 ESH。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Western Sahara — Non-Self-Governing Territory status and administering-power boundary | https://www.un.org/dppa/decolonization/en/nsgt/western-sahara | United Nations Department of Political and Peacebuilding Affairs / Decolonization；`government-notice`；2024-09-09 发布；已核验 NSGT 与 administering-power 边界 |

#### FLK（福克兰群岛）

- Road Traffic (Provisional) Regulations Order 1986 Regulation 13 只要求机动车配备有效
  消声器并尽可能降低废气逸出噪声；Regulation 16 只是许可前或许可期间对危险/不适行
  车辆的检查。表单中的 C/C1 质量与 D/D1 座位类别属于驾照/整车分类，不是排放类别。
- 建模结论：`FK-BOUNDARY` 四个 scope 显式 `no-data`；不得把消声器、在用车安全
  检查或驾照分类升级为新重型发动机污染物限值或认证循环。

| 事实 | 官方 URL | 核验 |
| --- | --- | --- |
| Road Traffic (Provisional) Regulations Order 1986 — silencers and vehicle inspection | https://www.legislation.gov.fk/download/pdf/4150cf28-4b25-4f23-ae56-456251ea2378/5a0dfa5f-ceaf-4652-9566-c911493a27c1/fisl-1986-5_2017-07-31.pdf | Falkland Islands Government / Falkland Islands Legislation；`official-regulation`；2017-07-31 发布；已核验 Regulations 13、16 与表单分类（PDF pp.1–3、8–10、27） |

本节 10 条 source 的 `verifiedAt` 统一为 `2026-08-10T11:58:54Z`。VEN membership
使用法规可查询边界 `2000-01-01`；其余六个 source-only 目录条目的 `2026-08-10`
membership 只表示本轮精确来源边界核验日，不应解释为法律生效日。

## 3.81 2026-08-11 稳定 33 国与数据纠错来源收口（本地 accepted，待部署）

本节是当前 fixture/tests 的来源索引。表中 `no-data` 均指四个 scope 未同时闭合新发动机
类别、分类/功率、完整污染物表、法定认证循环与实施边界；不是缺少资料的同义词。
旧文档中相反的 numeric/无数据结论均以本节为 superseded（尤其
DZA、ETH、NGA、RWA、PHL、SAU、ARE、ZAF、ISR，以及 KHM/LAO/LKA/MMR/MNG
的旧日期或发布状态）。

| ISO3 | 精确官方/可核来源 | 当前建模结论 |
| --- | --- | --- |
| CRI | [Decreto 39724](https://pgrweb.go.cr/scij/Busqueda/Normativa/Normas/nrm_norma.aspx?nValor1=1&nValor2=81619&nValor3=0&param1=NRM&strTipM=FN)；[Ley 9078 art. 38](https://pgrweb.go.cr/scij/Busqueda/Normativa/Normas/nrm_articulo.aspx?nValor1=1&nValor2=73504&nValor3=130675&nValor5=39&param1=NRA) | 四 scope no-data（轻型/在用车边界） |
| ECU | [RTE INEN 017](https://www.normalizacion.gob.ec/buzon/reglamentos/RTE-017.pdf)；[NTE INEN 2207](https://www.aeade.net/wp-content/uploads/2016/12/2207-1.pdf) | 道路 ECE-49 各 4 条；工程/农业 no-data |
| PAN | [Decreto 38/2009](https://www.gacetaoficial.gob.pa/pdfTemp/26303/18123.pdf)；[Ley 295/2022](https://infojuridica.procuraduria-admon.gob.pa/norma_screen.php?numsec=58095) | 四 scope no-data |
| DOM | [Resolución 0051/2018](https://ambiente.gob.do/portal-transparencia/wp/download/280/gestion-de-la-calidad-ambiental/3845/reglamento-tecnico-ambental-control-fuentes-moviles-2018.pdf)；[INTRANT Memoria 2022](https://intrant.gob.do/transparencia/phocadownload/PlanEstrategico/MemoriasInstitucionales/Memoria%20Institucional%202022.pdf) | 四 scope no-data |
| PHL | [LTO MC AVT-2015-1946](https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/10/70901)；[DENR-EMB Euro IV implementation](https://www.boi.gov.ph/wp-content/uploads/2018/03/Implementation-of-DENR-Administrative-Order-on-Euro-4IV-Vehicle-Emission-Limits.pdf)；[UN R49-04 CoC notice](https://www.negor.gov.ph/supplemental-bid-bulletin-b-354-2024/) | Euro IV 道路 ESC/ELR/ETC；非道路 no-data |
| PAK | [S.R.O. 72(KE)/2009 official index](https://www.mocc.gov.pk/Detail/MDUzMDI1OGItYWYzZC00NzQ0LTlhZWItZjYzY2RkOTkyZGVh)；[Gazette scan](https://www.yumpu.com/it/document/view/46322181/sro-72ke-2009-pakistan-standards-and-quality-control-authority) | Pak-II 道路各 4 条；非道路 no-data |
| SAU | [MY2026 GSO list](https://www.gso.org.sa/wp-content/uploads/2024/12/GSO-Technical-Regulations-MV-2026-MY-D4.pdf)；[GSO 144 catalogue](https://www.gso.org.sa/store/standards/GSO:478791/GSO%20144:1991?lang=en) | MY2026 Euro V 道路 ESC/ELR/ETC；非道路 no-data |
| ARE | [MOIAT implementation guideline](https://www.gso.org.sa/wp-content/uploads/2025/04/Implementation-guideline-for-new-vehicle-emission-limits-in-the-UAE.pdf)；[Cabinet Resolution 13/2018](https://uaelegislation.gov.ae/en/legislations/2552) | 2026-01-01 仅 new-model regulation metadata；2027-07-01 起通用 Euro VI/B 道路 WHSC/WHTC，非道路 no-data |
| ISR | [IMR road CY2026](https://www.gov.il/BlobFolder/policy/imr_rr_m_n_o_2026/he/000211.docx)；[IMR NRMM CY2026](https://www.gov.il/BlobFolder/policy/imr_nrmm_2026/he/000201.docx) | Euro VI 道路、Stage V 工程；农业 no-data |
| ZAF | [Notice 611 N2/N3](https://www.gov.za/sites/default/files/gcis_document/201509/39220gon611.pdf)；[Notice 613 M2/M3](https://www.gov.za/sites/default/files/gcis_document/201509/39220gen613s.pdf)；[Directive 91/542/EEC](https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CELEX:31991L0542) | R49.02B 道路各 4 条；非道路 no-data |
| EGY | [PM Decree 338/1995](https://www.eeaa.gov.eg/Uploads/Laws/Files/20221010124857366.doc)；[Decision 710/2012](https://www.eeaa.gov.eg/Uploads/Laws/Files/20250526101230761.pdf) | Decision 710 Annex 6 已读回为怠速 CO/HC 与 ISO 11614 烟度/不透光度在用检查；四 scope no-data |
| GHA | [Environmental Protection Act 1124](https://repository.parliament.gh/server/api/core/bitstreams/1e06a2ff-8e7a-494e-a4d9-795f9c89002e/content)；[GS 1219](https://webstore.gsa.gov.gh/detail.php?ID=1756) | 四 scope no-data |
| KEN | [Air Quality Regulations 2024 — consolidated as at 2025-03-24](https://new.kenyalaw.org/akn/ke/act/ln/2024/180/eng@2025-03-24/source.pdf)；[Inspection Rules 2026](https://new.kenyalaw.org/akn/ke/act/ln/2026/13/eng@2026-02-13/source.pdf) | 周期/注册前 inspection；四 scope no-data |
| RWA | [Ministerial Order 02/2018](https://rwandalii.org/akn/rw/act/mo/2018/2/eng@2018-09-24/source.pdf)；[RSB Gazette 04/2023](https://www.rsb.gov.rw/fileadmin/Standard_Publications/Gazetted_Standards/National_Standards_as_published_in_Official_Gazette_n___04_of_23_01_2023.pdf)；[EAC implementation bridge](https://sustmob.org/UsedVehicles/CITA_Nairobi_harmonization.pdf) | Euro IV 道路 ESC/ELR/ETC；非道路 no-data |
| TZA | [Air Quality Regulations 2007](https://www.nemc.or.tz/uploads/publications/sw-1645446559-Air_Quality_Standards_Regulations_2007.pdf)；[GN 237 official-gazette copy](https://tanzlii.org/akn/tz/act/gn/2007/237/eng@2007-01-01/publication) | 四 scope no-data |
| ZMB | [Environmental Management Act 2011](https://www.parliament.gov.zm/sites/default/files/documents/acts/Environmetal%20Mangement%20Act%2012%20of%202011.pdf)；[Compulsory Standards list](https://www.zcsa.org.zm/index.php/list-of-compulsory-standards/) | 四 scope no-data |
| ZWE | [Environmental Management Act](https://ema.co.zw/wp-content/uploads/2026/03/EMA-ACT.pdf)；[Air Emission Licence](https://ema.co.zw/air-emission/) | 四 scope no-data |
| CIV | [Décret 2017-125](https://agp.africanlii.org/fr/akn/ci/act/decree/2017/125/fra@2017-09-14)；[PNI 15004 draft](https://www.codinorm.ci/doc/enquete/vehicules/PNI%2015004%20Vehic%20N2%20et%20N3%20janv%202025%20V01.pdf) | 四 scope no-data |
| DZA | [Décret 03-410](https://www.joradp.dz/FTP/jo-francais/2003/F2003068.pdf)；[Décret 18-05](https://www.joradp.dz/FTP/jo-francais/2018/F2018003.pdf) | 四 scope no-data；旧 numeric regulation 待归档 |
| TUN | [Décret 2000-147](http://www.citet.nat.tn/portail/digitalCollection/DigitalCollectionInlineDownloadHandler.ashx?_cb=20210408113957&documentId=42883&parentDocumentId=40549)；[Code de la route](https://www.transport.tn/uploads/Loi/Route.pdf) | 四 scope no-data |
| ETH | [Directive 1051/2025](https://motl.gov.et/sites/default/files/resource/5051_Emission%20of%20pollutant%20gas%20Directive.pdf)；[ES 6725:2022](https://www.motl.gov.et/sites/default/files/resource/emission%20standard.pdf) | 四 scope no-data；旧 numeric regulation 待归档 |
| CMR | [NC 2858](https://minepded.gov.cm/wp-content/uploads/2021/09/NC-2858.pdf)；[Décret 2011/2582/PM](https://minepded.gov.cm/wp-content/uploads/2020/01/D%C3%89CRET-N%C2%B020112582PM-DU-23-AO%C3%9BT-2011-FIXANT-LES-MODALIT%C3%89S-DE-PROTECTION-DE-L%E2%80%99ATMOSPH%C3%88RE.pdf) | 四 scope no-data |
| SEN | [ASN Catalogue 2025](https://www.asn.sn/sites/default/files/ASN%20CATALOGUE%202025%20v2_0.pdf)；[Décret 2004-13](https://www.archives.sn/api/fichiers/3d690f87-c01d-49e9-8fc3-655f40c27d9b?download=1) | 四 scope no-data |
| NGA | [S.I. No. 20, 2011](https://nesrea.gov.ng/wp-content/uploads/2025/05/Control_of_Vehicular_Emissions_from_Petrol_and_Diesel_Engines_Regulation-2011-.pdf)；[NESREA laws portal](https://nesrea.gov.ng/laws-regulations/) | 四 scope no-data；PM/循环未闭合，旧 numeric 待归档 |
| UGA | [S.I. 22/2024](https://www.nema.go.ug/en/wp-content/uploads/2025/01/The-National-Environment-Air-Quality-Standards-Regulations-S.I.-No.-22-of-2024-1.pdf)；[US EAS 1047:2022 catalogue](https://webstore.unbs.go.ug/store.php?preview=&src=5321) | 有效 metadata-only regulation，0 limits，四 scope no-data |
| BWA | [BOS 134:2014 ed.2](https://bobstandards.bw/product/bos-1342014-ed-2/)；[BOBS Catalogue June 2024](https://bobstandards.bw/wp-content/uploads/2024/06/BOBS-Standards-Catalogue-June-2024.pdf) | 四 scope no-data |
| NAM | [Standards Act 18/2005](https://nsi.com.na/wp-content/uploads/2026/03/Standards-Act-18-of-2005.pdf)；[GN 248–249/2013](https://nsi.com.na/wp-content/uploads/2026/03/5290-Gov-N248-249-Standard-Regulations.pdf) | 四 scope no-data |
| SWZ | [Air Pollution Control Regulations 2010](https://eea.org.sz/wp-content/uploads/2020/08/Air-Pollution-Regulations-2010.pdf)；[Road Transportation Department](https://www.gov.sz/index.php/ministry-department/road-transportation-department) | 四 scope no-data |
| KHM | [Prakas No. 150 MIH/2016 on 19 Automotive Technical Regulations](https://res.cloudinary.com/dgvyfitu8/image/upload/v1733987381/Prakas_No_150_MIH_2016_on_19_Automotives_Technical_Regulations_bdb6d255a4.pdf) — Cambodia Ministry of Industry and Handicraft / Institute of Standards of Cambodia，`official-regulation`，2016-06-15；[Sub-Decree No. 042 Air Pollution and Noise Disturbance Control](https://cambodiantr.gov.kh/en/document/?title=sub-decree-no-042-air-pollution-and-noise-disturbance-control) — Royal Government of Cambodia / Ministry of Environment / National Trade Repository，`official-regulation`，2000-07-01 | `2026-08-10` membership；四 scope no-data，不拼接 UN R49 目录入口与在用车黑烟表 |
| LAO | [Law on Inland Vehicles No. 04/NA, dated 16 November 2021](https://www.laotradeportal.gov.la/en-gb/site/display/2475) — Lao National Assembly / Lao Trade Portal，`official-regulation`，2021-11-16；[Provisions on Technical Standards and Accessories of Vehicles Authorized for Import, Registration and Assembly No. 4312/MCTPC](https://www.laotradeportal.gov.la/en-gb/site/display/45) — Lao Ministry of Communication, Transport, Posts and Construction / Lao Trade Portal，`official-regulation`，2002-11-11 | `2026-08-10` membership；四 scope no-data，不把检查/进口证明要求补成发动机认证表 |
| LKA | [Gazette Extraordinary No. 2079/42 — National Environmental (Air Emission, Fuel and Vehicle Importation Standards) amendment](https://documents.gov.lk/view/egz/2018/7/2079-42_E.pdf) — Sri Lanka Department of Government Printing / President of Sri Lanka，`official-regulation`，2018-07-12；[Gazette Extraordinary No. 2079/70 — Imports and Exports (Control) Regulation No. 2 of 2018](https://documents.gov.lk/view/egz/2018/7/2079-70_E.pdf) — Sri Lanka Department of Government Printing / Minister of Development Strategies and International Trade，`official-regulation`，2018-07-13 | `2018-07-13` membership/effective；道路 5+5、工程 24、农业 0；C1/D2 与 Third/Fifth 均为替代路径；clause 8 保留 2018-07-12 及以前信用证至 2018-10-31 的进口过渡豁免 |
| MMR | [National Environmental Quality (Emission) Guidelines (Final), Notification No. 615/2015](https://www.ecd.gov.mm/national-environmental-quality-emission-guidelines-final/) — Myanmar Ministry of Environmental Conservation and Forestry / Environmental Conservation Department，`government-notice`，2015-12-29；[Road Safety and Motor Vehicle Management Law (2020), Pyidaungsu Hluttaw Law No. 6/2020](https://www.myanmarrtad.com/?q=en%2Fnode%2F1925) — Republic of the Union of Myanmar / Ministry of Transport and Communications / Road Transport Administration Department，`official-regulation`，2020-05-26 | `2026-08-10` membership；四 scope no-data，固定源/EIA 数值与车辆检查边界不得升级 |
| MNG | [АГААР ЧАНАРЫН ТЕХНИКИЙН ЗОХИЦУУЛАЛТ (Air Quality Technical Regulation)](https://legalinfo.mn/mn/detail?lawId=16207241573351&showType=1) — Government of Mongolia / Legalinfo，`official-regulation`，2021-05-19；[ТЕХНИКИЙН ЗОХИЦУУЛАЛТ БАТЛАХ ТУХАЙ (Government Resolution No. 148 of 2021)](https://legalinfo.mn/mn/detail?lawId=16207241555111&type=3) — Government of Mongolia / Legalinfo，`official-regulation`，2021-05-19 | `2026-08-10` membership；四 scope no-data，不把车辆烟度引用升级为新发动机认证表 |

上述五国 10 条 source 的 `verifiedAt` 统一为 `2026-08-10T17:38:18Z`。
该时刻仅表示证据读取时间；本节仍是本地 accepted 索引，不证明生产数据库或公网已发布。

## 3.82 2026-08-11 MAR/KEN source-currentness 纠错（本地 accepted，待部署）

本节只纠正两国 source identity/currentness，不改变 regulation/limit 图、四 scope
no-data 或稳定 33 国计数。统一 `verifiedAt=2026-08-10T18:48:04Z`；MAR/KEN
定向发布及目标库/公开读回完成前不得声称已部署。

| ISO3 | 恰好两条 accepted source | 当前建模结论 |
| --- | --- | --- |
| MAR | [BO n°7361 — Arrêté conjoint n°2094.24](https://www.sgg.gov.ma/BO/AR/3111/2024/BO_7361_Ar.pdf)，SGG，`official-regulation`，published `2024-12-16`；[BO n°7028 — Arrêté conjoint n°2251-21](https://www.sgg.gov.ma/BO/bo_fr/2021/BO_7028_Fr.pdf)，SGG，`official-regulation`，published `2021-10-07` | 2251-21 已公开道路重型 WHSC/WHTC 完整表及循环，但 2094.24 将重型 homologation/registration 推迟到 2027/2028；道路未到实施日，非道路附件仍未闭合，四 scope no-data |
| KEN | [LN 180/2024 — consolidated as at 2025-03-24](https://new.kenyalaw.org/akn/ke/act/ln/2024/180/eng@2025-03-24/source.pdf)，Kenya Law，`official-regulation`，originally published `2024-12-06`；[LN 13/2026 Inspection Rules](https://new.kenyalaw.org/akn/ke/act/ln/2026/13/eng@2026-02-13/source.pdf)，Kenya Law，`official-regulation`，published `2026-02-13` | 最新合并文本与 2026 Rules 仍是周期/注册前 vehicle inspection；无新重型发动机完整公开表与认证循环，四 scope no-data |

## 3.83 2026-08-11 QAT/KWT/OMN/JOR source-currentness 纠错（本地 accepted，待部署）

本节只替换四国 source identity/currentness，不新增 regulation/limit，也不改变稳定
33 国或 limits 总数。八条 source 统一 `verifiedAt=2026-08-10T18:48:04Z`；四国共
16 个 scope 均为 `no-data`，每国零 regulation/limits。四次定向发布及目标库、公开
API/页面读回完成前不得声称已部署。

| ISO3 | 恰好两条 accepted source | 当前建模结论 |
| --- | --- | --- |
| QAT | [Ministry to Apply EURO5-Equivalent Clean Diesel Fuel Policy for Buses, Trucks in 2023](https://www.mot.gov.qa/en/news/ministry-apply-euro5-equivalent-clean-diesel-fuel-policy-buses-trucks-2023)，Qatar Ministry of Transport，`government-notice`，published `2021-11-08`；[Ministerial Decision No. 125 of 2019 Adopting Qatari Technical Regulations](https://www.almeezan.qa/LawPage.aspx?id=8020&language=ar)，Qatar Ministry of Justice / Al Meezan Legal Portal，`official-regulation`，published `2019-06-20` | 燃油政策不是发动机认证；QS GSO 144/145/146:1991 身份未闭合当前类别/表/循环/Euro V 国内实施日，四 scope no-data、零 regulation/limits |
| KWT | [Ministerial Decision No. 372/1992 Adopting Gulf Standards as Kuwaiti Standards](https://ksm.pai.gov.kw/_vti_bin/Store_WCF/Store.svc/RetrieveBinaryDocumentForPDFViewerMinisterial?docid=39)，Kuwait Ministry of Commerce and Industry / Kuwait Today / Public Authority for Industry，`official-regulation`，published `1992-11-15`；[Ministerial Resolution No. 44/2015 and List of Adopted Standards and Technical Regulations](https://www.pai.gov.kw/en/documents)，Kuwait Public Authority for Industry，`official-regulation`，published `2015-11-29` | 474/475/476 不在 372 的强制清单；GSO 42 technical-regulation 身份仍无完整发动机表、循环与 Euro V 国内实施链，四 scope no-data、零 regulation/limits |
| OMN | [Official Gazette No. 1540 — Ministerial Decision No. 120/2024 Considering GCC Standards Binding Omani Standards](https://www.mjla.gov.om/images/legislation/file/Book699179.pdf)，Oman Ministry of Justice and Legal Affairs / Official Gazette，`official-regulation`，published `2024-04-07`；[List of GSO Technical Regulations for Motor Vehicles (2026 Model Year), MY2026-D5](https://www.gso.org.sa/wp-content/uploads/2025/01/GSO-Technical-Regulations-MV-2026-MY-D5.pdf)，GCC Standardization Organization (GSO)，`official-regulation`，published `2025-01-02` | 120/2024 附件未给发动机排放表；GSO 清单对 Oman 仅写 `<Euro4` 且保留国家规则，不能证明国内 Euro V 实施，四 scope no-data、零 regulation/limits |
| JOR | [Transport Sector Green Growth National Action Plan 2021–2025](http://moenv.gov.jo/ebv4.0/root_storage/en/eb_list_page/2022_jordan_transport_v10.pdf)，Jordan Ministry of Environment，`government-notice`，`publishedOn=null`；[JSMO Standards Catalogue — Transport Exhaust Emissions (JS 1053:1998 and JS 1054:1998)](https://eservice.jsmo.gov.jo/en/Standards/IcsAmfn/1304050)，Jordan Standards and Metrology Organization，`government-notice`，`publishedOn=null` | 官方计划明确无强制新车标准；目录正文付费、日期 N/A，未闭合表/循环/国内实施日，四 scope no-data、零 regulation/limits |

## 3.84 2026-08-11 IRN/IRQ/LBN/SYR source-currentness 纠错（本地 accepted，待部署）

本节 supersede 历史 #101/#102/#104/#125 的旧 source 组合和证据表述，只刷新 source
identity/currentness 与 record timestamps；不新增 regulation/limit，不改变 limits 或
稳定 33 国口径。八条 source 统一 `verifiedAt=2026-08-10T18:55:45Z`，membership
`validFrom=2026-08-10`。四国共 16 个 scope 均为 `no-data`，每国零
regulation/limits；IRN 的 Article 4 日程已确认可读，不再沿用“日程不可读”的旧理由。

五门槛为：G1 法定新发动机类别；G2 分类/功率边界；G3 完整污染物数值表；G4 认证
循环；G5 国内实施边界。任一门槛未闭合即失败关闭，不把在用烟度、进口/车龄政策、
付费目录、阶段标签或草案升级为 effective numeric regulation。

| ISO3 | 恰好两条 accepted source（exact metadata） | 关键条款 / 页码 | 四 scope 五门槛与当前结论 |
| --- | --- | --- | --- |
| IRN | [آیین‌نامه فنی در زمینه کنترل و کاهش آلودگی‌ها (موضوع ماده (۲) قانون هوای پاک)](https://nezamat.ir/post-41054/)，Cabinet of Ministers of the Islamic Republic of Iran，`official-regulation`，published `2018-10-31`；[اصلاح ماده (۴) آیین‌نامه فنی در زمینه کنترل و کاهش آلودگی‌ها (موضوع ماده (۲) قانون هوای پاک)](https://nezamat.ir/post-44973/)，Cabinet of Ministers of the Islamic Republic of Iran，`official-regulation`，published `2024-02-18` | 合并 Article 4 及 2024 修订：道路柴油列 Euro 6/EEV/Euro 5 + OEM DPF，非道路只列 tractors 的 Stage IIIA/IIIB，Articles 5–7 涉及型式批准/符合性与执行 | truck/bus：G1 部分、G2/G3/G4 失败、G5 通过；construction：G1–G5 失败；agriculture：G1 部分、G2/G3/G4 失败、G5 通过。没有新重型发动机完整分类/功率、污染物表和国家循环，四 scope no-data、零 regulation/limits |
| IRQ | [قرارات هيئة اعتماد المواصفات العراقية في اجتماعها المرقم (507) في 3/3/2024](https://www.iraqi-standards.org/wan/ns/p/0000018.html)，Iraq Central Organization for Standardization and Quality Control (COSQC)，`official-regulation`，published `2024-04-15`；[تشمل جميع المركبات.. التجارة: بدء تطبيق المواصفة العراقية للسيارات مطلع 2026](https://ina.iq/ar/local/250006-2026.html)，Iraqi News Agency (INA) / Iraq Ministry of Trade，`government-notice`，published `2025-12-12` | Meeting 507 采用 TR 167/2019 Amendment 1/2024；INA 公告给出 2026-01-01、MY2025+ 进口车辆及检验/登记实施边界，但未公开 TR 167 正文排放附件 | truck/bus：G1 部分、G2/G3/G4 失败、G5 通过；construction/agriculture：G1–G5 失败。不得从“所有车辆”或未公开标准推值，四 scope no-data、零 regulation/limits |
| LBN | [قانون رقم 444 - حماية البيئة](https://moe.gov.lb/%D8%A7%D9%84%D9%88%D8%B2%D8%A7%D8%B1%D8%A9/%D8%A7%D9%84%D9%82%D9%88%D8%A7%D9%86%D9%8A%D9%86-%D9%88%D8%A7%D9%84%D8%A7%D9%86%D8%B8%D9%85%D8%A9/%D8%A7%D9%84%D9%82%D9%88%D8%A7%D9%86%D9%8A%D9%86/%D9%82%D8%A7%D9%86%D9%88%D9%86-%D8%B1%D9%82%D9%85-444-%D8%AD%D9%85%D8%A7%D9%8A%D8%A9-%D8%A7%D9%84%D8%A8%D9%8A%D8%A6%D8%A9.aspx?lang=ar-LB)，Lebanon Ministry of Environment，`official-regulation`，published `2002-07-29`；[Lebanon’s Third Biennial Update Report to the UNFCCC](https://lebanon.un.org/en/download/60471/107789)，Lebanon Ministry of Environment / UNDP / GEF，`government-notice`，published `2019-12-31` | Law 444 Article 24 仅作一般环境质量标准授权；BUR3 PDF p.185 / printed p.168 Table 103 记录公交排放法规未实施，并建议更新/执行在用柴油 trucks/buses 的 Decree 6603/1995 | truck/bus/construction/agriculture 均 G1–G5 失败；一般授权、在用车尾气和未实施建议不构成新发动机实施链。四 scope no-data、零 regulation/limits |
| SYR | [القانون 12 لعام 2012 قانون وزارة الدولة لشؤون البيئة](https://faolex.fao.org/docs/pdf/syr212392.pdf)，Syrian Arab Republic / FAOLEX，`official-regulation`，published `2012-03-29`；[وزارة الاقتصاد والصناعة توضح أسباب منع استيراد السيارات المستعملة](https://sana.sy/economy/2238146/)，Syrian Arab News Agency (SANA) / Ministry of Economy and Industry，`government-notice`，published `2025-06-30` | Law 12 pp.2–4 Articles 2–3 为一般环境/EIA/后续标准授权，pp.15–16 Article 24 废止旧 Law 50/2002；SANA 公告仅列车辆类型、座位数和进口车龄 | truck/bus/construction/agriculture 均 G1–G5 失败；进口/车龄政策不是排放实施边界。四 scope no-data、零 regulation/limits |

PDF 完整读取与目检记录：LBN BUR3 共 248 页，本地 SHA-256
`8db12dd8e1958be78826135db15cef45792efd967043fcfd946f87255dd079ef`，已渲染并目检
PDF pp.184–185；SYR Law 12 共 16 页，本地 SHA-256
`bfffda1e2a983e1ce00a525c0653e5e3b66d2a4a82e8275f2b23d712f8bf283a`，已渲染并目检
pp.2–4、15–16。IRN/IRQ 为 HTML 原文/公告，逐条核对 Article 4、Meeting 507 与实施
日期。四次定向 source refresh 和目标库、公开 API/页面读回完成前不得声称已部署；
YEM 当前双源已精确，本轮 no-change。

## 3.85 2026-08-11 35 国 source-currentness 规范索引（本地 accepted，待部署）

本节是 ACCEPTANCE #209–#243 与 ADR-131 的规范 source 索引，并 supersede 下列国家
此前的政府新闻、泛门户、目录、旧法规或不精确日期。每国**恰好两条** current accepted
source；`status` 均为本地 accepted、待定向部署，不能解释为生产已同步。五门槛依次为
G1 新发动机类别、G2 分类/功率、G3 完整 CO/HC/NOx/PM（适用时 PN/NH3）表、G4
法定认证循环、G5 国内法定实施日；任一门槛失败即 no-data，不跨法域推值。

### 3.85.1 GUY/HTI/JAM/BLZ/CUB（`verifiedAt=2026-08-10T19:36:45Z`）

| ISO3 | Source 1（exact metadata） | Source 2（exact metadata） | 关键读回、SHA-256 与当前边界 |
| --- | --- | --- | --- |
| GUY | [Environmental Protection (Air Quality) Regulations, 2000 (Reg. 9/2000) — regulations 18–20 (PDF pp. 167–168)](https://mola.gov.gy/laws/Volume%206%20Cap.%2018.01%20-%2023.011696964321.pdf)<br>Publisher: `Ministry of Legal Affairs, Guyana`；`official-regulation`；publishedOn `2000-12-13`；status `current accepted / production published 2026-08-12` | [Motor Vehicles and Road Traffic Act, Chapter 51:02 — section 103(1)(xxii) (PDF p. 108)](https://mola.gov.gy/laws/Volume%2011%20Cap.%2049.02%20-%2058.011696827006.pdf)<br>Publisher: `Ministry of Legal Affairs, Guyana`；`official-regulation`；publishedOn `1940-12-20`；status `current accepted / production published 2026-08-12` | 已抽取并目检 PDF pp.167–168、108；SHA `a86117aa8bd0961d03854d58f3c6cdf1e047dba7a04dc0d652f23efe7f7c1d41` / `d814b183b59d3b40e9edf57fc8599f03d3c89f35b3a5c057cd64c9db5c01b622`。后续标准授权、适行证和烟雾规则未闭合 G1–G5；四 scope no-data、0 regulation/limit。 |
| HTI | [Décret portant sur la Gestion de l’Environnement et de Régulation de la Conduite des Citoyens et Citoyennes pour un Développement Durable — Le Moniteur No. 11](https://faolex.fao.org/docs/pdf/hai65901.pdf)<br>Publisher: `Le Moniteur — Journal officiel de la République d’Haïti / Presses Nationales d’Haïti`；`official-regulation`；publishedOn `2006-01-26`；status `current accepted / production published 2026-08-12` | [Le MCI intensifie son soutien aux MPME et déploie davantage d’actions sur le territoire national](https://communication.gouv.ht/communiques/le-mci-intensifie-son-soutien-aux-mpme-et-deploie-davantage-dactions-sur-le-territoire-national/)<br>Publisher: `Gouvernement de la République d’Haïti / Ministère du Commerce et de l’Industrie`；`government-notice`；publishedOn `2025-07-18`；status `current accepted / production published 2026-08-12` | 环境法令 PDF 全文抽取并目检移动源相关页；MCI HTML 逐段回读。SHA `1ce2548ee636960362ede3c185d79f94e0c48c151a5fdc076e7bb1807dfd62fd` / canonical readback `a5d774bf6afa9c5bee8c41bc3c27bc33f6e896587741659bc4e00d1ad3c2765f`。一般环境框架与二手车辆/机械进口前检查不是新发动机认证；四 scope no-data。 |
| JAM | [The Road Traffic Regulations, 2022 — Regulation 66 (PDF pp. 66–68) and Eighth Schedule Part A (PDF pp. 287–289)](https://mtm.gov.jm/wp-content/uploads/2023/02/Road-Traffic-Regulations-May-20-2022-complete.pdf)<br>Publisher: `Jamaica Ministry of Energy, Transport and Telecommunications`；`official-regulation`；publishedOn `2022-05-20`；status `current accepted / production published 2026-08-12` | [Forms and Documents – Ministry of Energy, Transport and Telecommunications](https://mtm.gov.jm/forms/)<br>Publisher: `Jamaica Ministry of Energy, Transport and Telecommunications`；`government-notice`；publishedOn `null`；status `current accepted / production published 2026-08-12` | 已抽取并目检 pp.66–68、287–289；SHA `76e935bf5413fa535a30a3fb1f953772171bef0f7813b3f6bcb1fc9d1bec770e` / canonical HTML readback `cc7a1af12e6f77f8dfda5b13822cc5b7f076b529f782bc1b389120dd7bff3755`。重型表只覆盖 MY1991–1998 进口/在用车且无命名认证循环；四 scope no-data。 |
| BLZ | [Pollution Regulations (S.I. No. 56 of 1996), Chapter 328, Revised Edition 2020 — regulations 25–26 (PDF pp. 25–26)](https://doe.gov.bz/wp-content/uploads/2024/02/Pollution-Regulations.pdf)<br>Publisher: `Belize Department of the Environment / Government of Belize`；`official-regulation`；publishedOn `1996-04-20`；status `current accepted / production published 2026-08-12` | [Environmental Protection Act, Chapter 328, Revised Edition 2020 — sections 6 and 45 (PDF pp. 21 and 45)](https://doe.gov.bz/download/environmental-protection-act-chapter-328-re-2020/?wpdmdl=17080)<br>Publisher: `Government of Belize / Department of the Environment`；`official-regulation`；publishedOn `null`；status `current accepted / production published 2026-08-12` | 已抽取并目检 pp.25–26、21、45；SHA `79ba6d1b4662e9ebd4f26e4bff59bb99b14bbb7443768fc6e840e6a7f7112e37` / `7ca23cffd50a90b302c07baae8af9cc2690fa0c5941dc930401f65e44d34cf81`。柴油 levels/procedures 留给部长，母法仅授权后续规则；四 scope no-data。 |
| CUB | [Gaceta Oficial No. 87 Ordinaria de 13 de septiembre de 2023 — Ley 150/2022 Del Sistema de los Recursos Naturales y el Medio Ambiente (GOC-2023-771-O87)](https://www.gacetaoficial.gob.cu/sites/default/files/goc-2023-o87.pdf)<br>Publisher: `Gaceta Oficial de la República de Cuba / Ministerio de Justicia / Asamblea Nacional del Poder Popular`；`official-regulation`；publishedOn `2023-09-13`；status `current accepted / production published 2026-08-12` | [Gaceta Oficial No. 014 Extraordinaria de 15 de marzo de 2011 — Resolución No. 151/2011, Normas Complementarias para la Seguridad Vial](https://www.gacetaoficial.gob.cu/sites/default/files/go_x_014_2011.pdf)<br>Publisher: `Gaceta Oficial de la República de Cuba / Ministerio de Justicia / Ministerio del Transporte`；`official-regulation`；publishedOn `2011-03-15`；status `current accepted / production published 2026-08-12` | 两份公报全文抽取并目检首页及移动源/检查条款；SHA `17c5e1011d86d6ba442f8e3425bb7d373d178b3ffffecda4c27dce4e3461551b` / `a494b27143b463e42a2b038e9b40f139c873101e98923ce546f695e06d3ebd44`。一般移动源管理及在用车怠速 CO/柴油不透光度检查不闭合新发动机表/循环；四 scope no-data。 |

### 3.85.2 LBR/LBY/MLI/MRT/NER（`verifiedAt=2026-08-10T19:46:12Z`）

| ISO3 | Source 1（exact metadata） | Source 2（exact metadata） | 关键读回、SHA-256 与当前边界 |
| --- | --- | --- | --- |
| LBR | [Environmental Protection and Management Law of Liberia](https://epa.gov.lr/wp-content/uploads/2025/10/lbr53038.pdf)<br>Publisher: `Republic of Liberia / Ministry of Foreign Affairs; official EPA host`；`official-regulation`；publishedOn `2003-04-30`；status `current accepted / production published 2026-08-12` | [Ministry of Transport Administrative Regulation PG/No.002/82997 June, 2011](https://mot.gov.lr/sites/default/files/documents/ADMINISTRATIVE%20REGULATION%20%20AA%20June%2017%2C%202016%20-%20Copy.pdf)<br>Publisher: `Liberia Ministry of Transport`；`official-regulation`；publishedOn `2011-06-18`；status `current accepted / production published 2026-08-12` | 已抽取并目检环境法 PDF pp.25、36 及行政规章检查条款；SHA `d17bf9b5ab04e282e0cac1793db8da11177113e7c6964823251d4cfec39c0f18` / `94318edf9d57368890c10e0b6a4d585d701afce8f5d164db9e4c7d82077a2928`。未来移动源标准/检查授权与运输行政检查不闭合 G1–G5；四 scope no-data。 |
| LBY | [Law No. 15 of 2003 on Environmental Protection](https://environment.gov.ly/wp-content/uploads/2022/04/Image-to-PDF-%D8%A7%D9%84%D9%82%D8%A7%D9%86%D9%88%D9%86-%D8%B1%D9%82%D9%85-15-%D9%A2%D9%A0%D9%A2%D9%A2-%D9%A0%D9%A4-%D9%A1%D9%A5-%D9%A1%D9%A5-%D9%A5%D9%A2-%D9%A1%D9%A0.pdf)<br>Publisher: `General People's Congress / Libya Ministry of Environment`；`official-regulation`；publishedOn `2003-06-13`；status `current accepted / production published 2026-08-12` | [Decision No. 448 of 2009 — executive regulation for Law No. 15 of 2003 on Environmental Protection](https://environment.gov.ly/wp-content/uploads/2022/04/%D8%A7%D9%84%D9%84%D8%A7%D8%A6%D8%AD%D8%A9-%D8%A7%D9%84%D8%AA%D9%86%D9%81%D9%8A%D8%B0%D9%8A%D8%A9-%D9%84%D9%84%D9%82%D8%A7%D9%86%D9%88%D9%86-%D8%B1%D9%82%D9%85-15.pdf)<br>Publisher: `General People's Committee / Libya Ministry of Environment`；`official-regulation`；publishedOn `2009-10-09`；status `current accepted / production published 2026-08-12` | 两份扫描件 OCR/全文抽取并目检封面、签署页及车辆污染条款；SHA `876cdf4658aa882b12ad5a2446f38242307846c6e40937c3be0450eb75845234` / `2c6813b35db79cb2e9d5c94fc8cf3c087e6fddb8d4100224b210bb6429a5abe0`。仅定性污染、测试和后续标准框架；四 scope no-data。 |
| MLI | [Journal officiel de la République du Mali n°08 du 27 mars 2020 — Arrêté n°2020-1080/MTMU-SG du 20 mars 2020 fixant les modalités de mise en œuvre du contrôle technique automobile](https://sgg-mali.ml/JO/2020/mali-jo-2020-08.pdf)<br>Publisher: `Republic of Mali / Secretariat General of Government`；`official-regulation`；publishedOn `2020-03-27`；status `current accepted / production published 2026-08-12` | [Journal officiel de la République du Mali n°26 du 29 septembre 2023 — Décret n°2023-0509/PT-RM du 12 septembre 2023 fixant les conditions de l’usage des voies ouvertes à la circulation publique et de la mise en circulation des véhicules](https://sgg-mali.ml/JO/2023/mali-jo-2023-26.pdf)<br>Publisher: `Republic of Mali / Secretariat General of Government`；`official-regulation`；publishedOn `2023-09-29`；status `current accepted / production published 2026-08-12` | 两份 JO 全文抽取；已目检 2020 JO pp.22–23 与 2023 circulation decree 条款。SHA `c9da2f430e73739574b84defc5a9f9013e19d1e352b5c030bde9f5d73cea96ce` / `28abd24b05f7c1629d616c0bc1de37651b5f4e7eeb31725f8a3bf6f2a24c33b6`。均为在用车技术检验/道路流通；四 scope no-data。 |
| MRT | [Law No. 2018-002 on air-pollution prevention and control](http://www.environnement.gov.mr/fr/images/reglementations/Loi_pollution_Air_FR.pdf)<br>Publisher: `Mauritania Ministry of Environment and Sustainable Development`；`official-regulation`；publishedOn `2018-01-02`；status `current accepted / production published 2026-08-12` | [Journal Officiel de la République Islamique de Mauritanie n°985 — Law No. 2000-045 of 26 July 2000 establishing the Environment Code](http://www.environnement.gov.mr/fr/images/reglementations/LOI_Code_de_l_Environnement.pdf)<br>Publisher: `Islamic Republic of Mauritania`；`official-regulation`；publishedOn `2000-10-30`；status `current accepted / production published 2026-08-12` | 已抽取并目检 2018 法全文 pp.1–8 及 Environment Code 车辆/空气授权条款；SHA `d811bd44221f2ecd2efcf321fb36f738e4d4b4a5a2d93a5ec08b3b8d6e019232` / `3f80f0cfff6d9793176c7a827d711c0573ad2d042d825f5294865baef3bc3dab`。车辆/发动机技术要求与受管排放留给后续文本；四 scope no-data。 |
| NER | [Law No. 98-56 of 29 December 1998 — framework law on environmental management](https://hydraulique.gouv.ne/wp-content/uploads/2025/07/LoiN%C2%B098-056gestiondelEnvironnement.pdf)<br>Publisher: `Republic of Niger`；`official-regulation`；publishedOn `1998-12-29`；status `current accepted / production published 2026-08-12` | [Services en Ligne — Homologation des Véhicules Terrestres à Moteur](https://transports.gouv.ne/e-services)<br>Publisher: `Niger Ministry of Transport and Civil Aviation`；`government-notice`；publishedOn `null`；status `current accepted / production published 2026-08-12` | 已抽取并目检框架法 p.1、p.6；e-service HTML 逐项回读。SHA `c119e625a5271a98e558cdc12f5a72240605f8e0e772b9c7dcd3be6a3de4e939` / canonical HTML `ae06783a157debd694c87f0b268beb159b910938b6aa31c8d40df75b51949db9`。法律只授权后续标准，服务页只证明行政 homologation 存在；四 scope no-data。 |

### 3.85.3 GTM/HND/NIC/PRY/URY（`verifiedAt=2026-08-10T20:09:01Z`）

| ISO3 | Source 1（exact metadata） | Source 2（exact metadata） | 关键读回、SHA-256 与当前边界 |
| --- | --- | --- | --- |
| GTM | [Normativa de Combustible y Vehículos](https://www.marn.gob.gt/wpfd_file/normativa-de-combustible-y-vehiculos/)<br>Publisher: `Guatemala Ministry of Environment and Natural Resources`；`government-notice`；publishedOn `null`；status `current accepted / production published 2026-08-12` | [Ley de Tránsito y su Reglamento](https://mingob.gob.gt/wp-content/uploads/2020/10/Ley-y-Reglamento-Transito.pdf)<br>Publisher: `Guatemala Ministry of the Interior (MINGOB)`；`official-regulation`；publishedOn `null`；status `current accepted / production published 2026-08-12` | MARN canonical/Jina readback SHA `2cb6631017af66afee708a0677a8d547554ceec4ee31a27e12c61cc20f9e88d3`；Traffic Law PDF SHA `27daaf053963ffec65af50043e358608850785d7036423509282c91f88a59e44`，已抽取并目检车辆技术/检查条款。目录与道路法未闭合新重型分类、完整表、循环、实施日；四 scope no-data。 |
| HND | [Decree 36-2024 — Law for the Rational and Efficient Use of Energy](https://www.tsc.gob.hn/web/leyes/Decreto-36-2024.pdf)<br>Publisher: `Honduras National Congress / La Gaceta`；`official-regulation`；publishedOn `2024-07-24`；status `current accepted / production published 2026-08-12` | [Decree 205-2005 — Traffic Law](https://tsc.gob.hn/biblioteca/index.php/leyes/142-ley-de-transito?tmpl=component)<br>Publisher: `Honduras National Congress / Tribunal Superior de Cuentas`；`official-regulation`；publishedOn `2006-01-03`；status `current accepted / production published 2026-08-12` | Decree 36 全文/关键授权页已目检，SHA `f6335c885683256b136f7e1a23487a68f34a41a68cb77951d400023bf7ee0a07`；Traffic Law canonical readback SHA `1fb7c54994d93e3e4a2cffecae1bb773479eff92817f953991f1b2f21041d8c6`。前者只授权未来车辆排放水平，后者无新发动机认证表；四 scope no-data。 |
| NIC | [Consolidated Decree No. 32-97 — motor vehicle emission control, Articles 10–25](https://legislacion.asamblea.gob.ni/Normaweb.nsf/xpNormaJuridica.xsp?action=openDocument&documentId=0404E60D225D0ACF062588E2006EE9F8)<br>Publisher: `National Assembly of Nicaragua`；`official-regulation`；publishedOn `1997-06-18`；status `current accepted / production published 2026-08-12` | [Consolidated Law No. 431 — vehicle emission-control certificates, Articles 59–60](https://legislacion.asamblea.gob.ni/Normaweb.nsf/xpNorma.xsp?action=openDocument&documentId=DDDCD831D507891D06258844005A7F39)<br>Publisher: `National Assembly of Nicaragua`；`official-regulation`；publishedOn `2022-02-22`；status `current accepted / production published 2026-08-12` | 已抽取并目检官方合并公报与 Arts.10–25、59–60；公报 SHA `00d3a42aa0c5c5536e811ca367963e5c46c352230237d9d023ed8c5e0b58bfe1` / `d5f1a1b03db56b92ce1bc586cf03e89b829f6962be8f253ad436f079558ce85c`。60%–80% 自由加速不透光度及在用/进口证书不是新发动机表，且非道路被排除；四 scope no-data。 |
| PRY | [Decree No. 1269/2019 implementing Air Quality Law No. 5211/2014](https://www.mades.gov.py/wp-content/uploads/2025/03/DECRETO-Nro-1269-de-fecha-13-de-febrero-de-2019.pdf)<br>Publisher: `Presidency of the Republic of Paraguay / MADES`；`official-regulation`；publishedOn `2019-02-13`；status `current accepted / production published 2026-08-12` | [Resolución N° 605/2021 — Por la cual se modifican los artículos 10 y 11 de la Resolución N° 78/18 y el artículo 2° de la Resolución N° 98/19 referentes a emisiones de fuentes móviles y se disponen procedimientos para medición de gases provenientes de las mismas](https://www.mades.gov.py/wp-content/uploads/2025/04/RESOLUCION-N%C2%B0-605-DE-FECHA-29-DE-DICIEMBRE-DE-2021.pdf)<br>Publisher: `Paraguay Ministry of Environment and Sustainable Development (MADES)`；`official-regulation`；publishedOn `2021-12-29`；status `current accepted / production published 2026-08-12` | 两份 PDF 全文抽取并渲染目检移动源测量/检查条款；SHA `f6750d597a5ef15505830d6f25aa510f81a14a7851a24e1e124bd0596e8798e3` / `e6a4b485fec11bc7844420aeb01d5725e835165afd7331c97112d6ed7a9cb740`。没有闭合新重型发动机表与认证循环；四 scope no-data。 |
| URY | [Decree No. 135/021: Air Quality Regulation](https://www.ambiente.gub.uy/oan/documentos/DCA-Decreto_135_021_calidad_de_aire-2021.pdf)<br>Publisher: `Uruguay Ministry of Environment`；`official-regulation`；publishedOn `2021-05-13`；status `current accepted / production published 2026-08-12` | [Vehicle-emission homologation procedure V5](https://www.gub.uy/ministerio-ambiente/comunicacion/publicaciones/procedimiento-homologacion-emisiones-vehiculares-v5)<br>Publisher: `Uruguay Ministry of Environment`；`government-notice`；publishedOn `2025-11-13`；status `current accepted / production published 2026-08-12` | Decree Table 17 与 V5 已抽取/渲染目检；SHA `12b8fddcad01b51f66f483ae72916ccc5d0fb44b5eaaa93274312b2901f5075a` / `a9454403ba875537a61b8872b0ae8d013c0c7a326422f9ad28eeec90f22ec4be`。底层 regulation 继续使用首版 homologation 链的 `effectiveFrom=2023-05-14`；当前 V5 仅把 source publishedOn 纠正为 `2025-11-13`，且官方页明示该程序版本自 `2025-11-17` 启用。道路仍为 1 regulation / 18 limits（truck 9 + bus 9），工程/农业 no-data。 |

### 3.85.4 PRK/PSE/SDN/PRI/NCL（`verifiedAt=2026-08-10T20:20:37Z`）

| ISO3 | Source 1（exact metadata） | Source 2（exact metadata） | 关键读回、SHA-256 与当前边界 |
| --- | --- | --- | --- |
| PRK | [Law of the Democratic People's Republic of Korea on the Protection of the Environment](https://faolex.fao.org/docs/pdf/prk22293.pdf)<br>Publisher: `Democratic People's Republic of Korea`；`official-regulation`；publishedOn `1986-04-09`；status `current accepted / production published 2026-08-12` | [Democratic People's Republic of Korea First NDC (Updated submission)](https://unfccc.int/documents/497842)<br>Publisher: `Democratic People's Republic of Korea / UNFCCC`；`government-notice`；publishedOn `2022-06-02`；status `current accepted / production published 2026-08-12` | 环境法 5 physical pages 全文目检；updated NDC 全文回读。SHA `82a96c43b0b81d1f98b714b1353e708d026aa068a24f34d253882c617562b83f` / `c3a8baa8d2538cac02edea331e540407d44a234423170f51684998c4af84c7f4`。前者只委托污染标准，后者是交通/GHG 政策；不得引用韩国来源，四 scope no-data。 |
| PSE | [Environment Law No. 7 of 1999 — Articles 19 and 22 air standards and vehicle exhaust](https://mjr.ogb.gov.ps/MergedLegislations/ViewText/66/%D9%82%D8%A7%D9%86%D9%88%D9%86-%D8%B1%D9%82%D9%85-7-%D9%84%D8%B3%D9%86%D8%A9-1999%D9%85-%D8%A8%D8%B4%D8%A3%D9%86-%D8%A7%D9%84%D8%A8%D9%8A%D8%A6%D8%A9-%D9%81%D9%84%D8%B3%D8%B7%D9%8A%D9%86)<br>Publisher: `Palestine Bureau of Legislation and Legal Opinion`；`official-regulation`；publishedOn `1999-12-28`；status `current accepted / production published 2026-08-12` | [Traffic Law No. 5 of 2000 — vehicle specifications, first registration and periodic inspection](https://mjr.ogb.gov.ps/MergedLegislations/ViewText/31/%D9%82%D8%A7%D9%86%D9%88%D9%86-%D8%A7%D9%84%D9%85%D8%B1%D9%88%D8%B1-%D8%B1%D9%82%D9%85-5-%D9%84%D8%B3%D9%86%D8%A9-2000%D9%85-%D9%81%D9%84%D8%B3%D8%B7%D9%8A%D9%86)<br>Publisher: `Palestine Bureau of Legislation and Legal Opinion`；`official-regulation`；publishedOn `2000-09-17`；status `current accepted / production published 2026-08-12` | 官方合并 HTML Arts.19、22 与登记/周期检查条款逐条回读；canonical readback SHA `f66147b6ab59d795082b84d7ce6184211fdccdf767bca1ca8dd8ea4e82042e6f` / `34185087cba86e072ae13d9ac616be69c3a0e6df8f2673aceaab4c78c747a2d1`。委托空气标准及整车检查不闭合 G1–G5；四 scope no-data。 |
| SDN | [قانون حماية البيئة لسنة 2001 / Environment Protection Act 2001 (Act No. 18 of 2001)](https://hcenr.gov.sd/wp-content/uploads/2021/05/%D9%82%D8%A7%D9%86%D9%88%D9%86-%D8%AD%D9%85%D8%A7%D9%8A%D8%A9-%D8%A7%D9%84%D8%A8%D9%8A%D8%A6%D8%A9-%D9%84%D8%B3%D9%86%D8%A9-2001.pdf)<br>Publisher: `Republic of the Sudan / Higher Council for Environment and Natural Resources`；`official-regulation`；publishedOn `null`；status `current accepted / production published 2026-08-12` | [Sudan. National Communication (NC). NC 3.](https://unfccc.int/documents/646439)<br>Publisher: `Republic of the Sudan, Council of Ministers, Higher Council for Environment and Natural Resources / UNFCCC`；`government-notice`；publishedOn `2025-04-14`；status `current accepted / production published 2026-08-12` | 环境法全文抽取/关键空气授权页目检，SHA `304d53409f5062a3a10492a9e1872d9fa265c56a27e54084ca8564195a7044c6`；NC3 canonical PDF SHA `d02032286070b4dd9d8fbd985a7bdca8af8edf52b89ff177db3bfcb2c8a9c43d`。一般授权与气候/交通政策不构成新发动机表和循环；四 scope no-data。 |
| PRI | [Regulation No. 5300 — Air Pollution Control Regulation, Rule 403(B)](https://www.drna.pr.gov/wp-content/uploads/2019/10/Reglamento-5300-Reglamento-Control-Contaminacion-Atmosferica-1995.pdf)<br>Publisher: `Puerto Rico Department of Natural and Environmental Resources`；`official-regulation`；publishedOn `null`；status `current accepted / production published 2026-08-12` | [Regulation No. 9526 — official inspection stations and motor vehicle inspection](https://docs.pr.gov/files/DTOP/Avisos/Reglamentos%20para%20estaciones%20oficiales.pdf)<br>Publisher: `Puerto Rico Department of Transportation and Public Works`；`official-regulation`；publishedOn `null`；status `current accepted / production published 2026-08-12` | Rule 403(B) canonical readback SHA `f647be2b963a3fdfdfadcc887fa640f3dec77ce8f4fe40d30acf9793c8970a59`；Reg.9526 38 physical pages，已目检 pp.1–3、37–38，SHA `d37f54861eba10ecc7a749531a15966614fbc497452fd0f4e9ab59abc36e19ae`。静止车辆 20% opacity 与周期检查不是新发动机认证；不自动复制美国联邦规则，四 scope no-data。 |
| NCL | [Délibération n° 224 des 9, 10 et 11 juin 1965 portant règlement général sur la police de la circulation et le roulage](https://juridoc.gouv.nc/juridoc/jdcodes.nsf/0/59295762BD9870FE4B258184001CDC1D/%24File/Code_route_NC_9-10-11-06-1965_ChG_07-10-2025.pdf?OpenElement=)<br>Publisher: `Congress of New Caledonia / Juridoc`；`official-regulation`；publishedOn `1965-09-27`；status `current accepted / production published 2026-08-12` | [Importation, transformation ou remise en circulation d'un véhicule](https://dittt.gouv.nc/vehicule-formalites/importation-transformation-ou-remise-en-circulation-dun-vehicule)<br>Publisher: `New Caledonia Directorate of Infrastructure, Topography and Land Transport`；`government-notice`；publishedOn `2019-10-03`；status `current accepted / production published 2026-08-12` | Road Code 全文抽取并目检定性烟气/车辆状态条款，SHA `5ed28f6c8b2b4d74676e291a7557d9c5b0e6924009cac6e7b7e841723d18d414`；DITTT canonical readback SHA `ca73464c4cd8336642e844d70fbf8509f49dc2cea1e82a9bbfbdb093a68ce088`。进口/改装/重新上路验收不闭合排放表；不自动复制法国/EU 规则，四 scope no-data。 |

### 3.85.5 ERI/GAB/GMB/GNB/GNQ（`verifiedAt=2026-08-10T20:39:16Z`）

| ISO3 | Source 1（exact metadata） | Source 2（exact metadata） | 关键读回、SHA-256 与当前边界 |
| --- | --- | --- | --- |
| ERI | [Environmental Protection and Management Regulations 127/2017](https://tile.loc.gov/storage-services/service/ll/lleritrea/eritrean-notice-127-2017/eritrean-notice-127-2017.pdf)<br>Publisher: `Government of the State of Eritrea / Gazette of Eritrean Laws`；`official-regulation`；publishedOn `2017-01-26`；status `current accepted / production published 2026-08-12` | [Regulations on Vehicle Technical and Related Standards Specifications 61/2002](https://tile.loc.gov/storage-services/service/ll/lleritrea/eritrean-notice-61-2002/eritrean-notice-61-2002.pdf)<br>Publisher: `Government of the State of Eritrea / Gazette of Eritrean Laws`；`official-regulation`；publishedOn `2002-05-13`；status `current accepted / production published 2026-08-12` | 已抽取并目检 Notice 127 pp.1、11、13 与 Notice 61 pp.1–22；SHA `d334a6a84dcc38d13fdddf9d7743bb886a9ad9c0b31d27405823e66bda7b79ea` / `e4f14db76c4a8adf37656bd0a2f51459482a6b1adf90eab049039129400d1780`。环境管理/车辆技术规格无完整污染物表、循环与实施链；四 scope no-data。 |
| GAB | [JOURNAL OFFICIEL N°222 DU 16 SEPTEMBRE 2014 — Loi N° 007/2014 du 31/07/2014 relative à la protection de l'environnement en République Gabonaise](https://journal-officiel.ga/6186-007-2014/)<br>Publisher: `Journal Officiel de la République Gabonaise / Présidence de la République`；`official-regulation`；publishedOn `2014-09-16`；status `current accepted / production published 2026-08-12` | [JOURNAL OFFICIEL N°345 TER DU 23 AVRIL 2017 — Arrêté N° 00097/MTL/2017 du 24/02/2017 relatif à la conduite, la certification et l'homologation des véhicules poids lourds, remorques, semi-remorques, engins et tous les équipements de levage et de manutention, les engins spéciaux et leurs agrès](https://journal-officiel.ga/5680-00097-mtl-2017-/)<br>Publisher: `Journal Officiel de la République Gabonaise / Ministère des Transports et de la Logistique`；`official-regulation`；publishedOn `2017-04-23`；status `current accepted / production published 2026-08-12` | 官方 JO HTML 全文逐条回读；canonical SHA `70dbda50f837625fcec84e470e05d5ccee30dcc49ba1984baf3d0221029cc1a4` / `80f53a1adb665796059bef8cf9adbed16aa43333e3a4b48cc16bc881f8ff6dc5`。环境法委托后续阈值；重车/工程/农业设备 homologation order 也没有发动机排放表/循环，四 scope no-data。 |
| GMB | [Environmental Quality Standards Regulations, 1999](https://faolex.fao.org/docs/pdf/gam95812.pdf)<br>Publisher: `National Environment Management Council / National Environment Agency, The Gambia`；`official-regulation`；publishedOn `null`；status `current accepted / production published 2026-08-12` | [Supplement “C” to The Gambia Gazette No. 1 of 23rd January, 2014 — Motor Traffic (Amendment) Act, 2013 (No. 12 of 2013)](https://security-legislation.gm/wp-content/uploads/2022/10/Motor-Traffic-Amendment-Act-2013.pdf)<br>Publisher: `The Gambia Gazette / National Assembly of The Gambia`；`official-regulation`；publishedOn `2014-01-23`；status `current accepted / production published 2026-08-12` | 已抽取并目检 Regulations pp.1、3、6 与 Act pp.1–8；SHA `2a9ff95373b761507f2460d1b36f85581ba05eddb5b6b15322b2d5f392ddb139` / `9b7a9bcec5bba5e2c1bd88e25bf099399548fdf866f8496c9ef0fdc4297df83a`。1999 instrument 只有年份，严格保留 `publishedOn=null`；环境空气浓度与道路法均无新发动机表/循环，四 scope no-data。 |
| GNB | [2.º Suplemento ao Boletim Oficial da República da Guiné-Bissau n.º 9 — Lei n.º 1/2011, de 2 de Março — Lei de Bases do Ambiente](https://faolex.fao.org/docs/pdf/gbs118164.pdf)<br>Publisher: `Assembleia Nacional Popular / Boletim Oficial da República da Guiné-Bissau`；`official-regulation`；publishedOn `2011-03-02`；status `current accepted / production published 2026-08-12` | [Ministério dos Transportes e Comunicações — Governo da Guiné-Bissau](https://bissaugov.com/ministerios/transportes-comunicacoes)<br>Publisher: `Governo da República da Guiné-Bissau / Ministério dos Transportes e Comunicações`；`government-notice`；publishedOn `null`；status `current accepted / production published 2026-08-12` | 已抽取并目检环境法 pp.1、6、9、12；SHA `01c0dddeadc1384aea535aee6ddab29dc41569ef63fcda229a2d50669d688b93`；交通部目录 canonical SHA `59884703320be1fcd09655d18e38a175eb70159b250f6bddf8e5ec878c90f546`。空气标准留给专门立法，目录只有主管范围；四 scope no-data。 |
| GNQ | [Ley número 7/2003, de fecha 27 de noviembre, Reguladora del Medio Ambiente en Guinea Ecuatorial](https://faolex.fao.org/docs/pdf/eqg102892.pdf)<br>Publisher: `Presidencia de la República de Guinea Ecuatorial / Boletín Oficial del Estado`；`official-regulation`；publishedOn `2003-11-27`；status `current accepted / production published 2026-08-12` | [Ley General de Transporte por Carretera Nº 4 — Ley Núm. 4/2.018, de fecha 19 de Diciembre, General de Transporte por Carretera en la República de Guinea Ecuatorial](https://minhacienda-gob.com/media/stream/8301)<br>Publisher: `Dirección General del Boletín Oficial del Estado / Presidencia del Gobierno de Guinea Ecuatorial`；`official-regulation`；publishedOn `2019-03-25`；status `current accepted / production published 2026-08-12` | 已抽取并目检环境法 pp.2、49–50 与道路运输法 pp.1–2、24；SHA `03de80840d9c22b9fb4cb3f36aff736e56b45855925fa66b547762b123b3803a` / `094554ae9c868299320547cbe5123d42770a565ee15e8fe2ed2dbea78d0199d3`。两法均未给新重型发动机完整表、循环和实施分期；四 scope no-data。 |

### 3.85.6 MOZ/LSO/MDG/MUS/FJI（`verifiedAt=2026-08-10T20:50:58Z`）

| ISO3 | Source 1（exact metadata） | Source 2（exact metadata） | 关键读回、SHA-256 与当前边界 |
| --- | --- | --- | --- |
| MOZ | [Decreto n.º 67/2010, de 31 de Dezembro — altera o Regulamento sobre Padrões de Qualidade Ambiental e de Emissão de Efluentes aprovado pelo Decreto n.º 18/2004](https://sibmoz.gov.mz/content/uploads/2022/01/Regulamento-sobre-Padroes-de-Qualidade-Ambiental-e-de-Emissao-de-Efluentes.pdf)<br>Publisher: `Conselho de Ministros / Boletim da República; official copy hosted by SIBMOZ`；`official-regulation`；publishedOn `2010-12-31`；status `current accepted / production published 2026-08-12` | [Decreto n.º 44/2017, de 16 de Agosto — Regulamento sobre as Regras de Aprovação de Marcas e Modelos de Veículos Automóveis, Motociclos, Ciclomotores, Tractores Agrícolas ou Florestais, Máquinas Industriais, Agrícolas ou Florestais, Tractocarros, Reboques e Semi-Reboques](https://inatro.gov.mz/wp-content/uploads/2019/08/Decreto-44-e-45-2017-matriculas-e-regras-de-apro-de-marcas-e-modelos.pdf)<br>Publisher: `Conselho de Ministros / Imprensa Nacional de Moçambique; official copy hosted by INATRO`；`official-regulation`；publishedOn `2017-08-16`；status `current accepted / production published 2026-08-12` | Decree 67 共 5 physical pages，已目检 pp.1–5；Decree 44 共 20 pages，已目检全本、关键 pp.1–7。SHA `6300d7b7ebea979c8be2ddc988519f7ed15537500fef30f2265e681afa8d9156` / `a262290ea1415f6aad0a5ed61904557c494ceb825f14d0d0813cc98afc1c5f9f`。环境修正与整车型号批准均无完整发动机表/循环；四 scope no-data。 |
| LSO | [Roadworthiness (RW)/Fitness (F) of Motor Vehicles](https://www.gov.ls/eservice/roadworthiness-rw-fitness-f-of-motor-vehicles/)<br>Publisher: `Government of Lesotho / Ministry of Public Works and Transport`；`government-notice`；publishedOn `2026-02-16`；status `current accepted / production published 2026-08-12` | [Transport Sector Policy](https://www.mopwt.gov.ls/wp-content/uploads/2018/07/Transport_Sector_Policy.pdf)<br>Publisher: `Government of the Kingdom of Lesotho, Ministry of Public Works and Transport, Planning Unit`；`government-notice`；publishedOn `2006-02-28`；status `current accepted / production published 2026-08-12` | Roadworthiness HTML JSON-LD/header/body SHA `b0dd188be58ed042a2b7b2afb83177091603a7026ae7fdfcf79ed04893c114c0`；Policy 121 pages，已目检 pp.1、30、94（关键 pp.55–59），SHA `1bb463310fea4c6b723969a2525d43341dde3810785bd05fb0b0984522ff9efc`。整车 fitness 与待后续立法的政策不是新发动机认证；四 scope no-data。 |
| MDG | [Étude de l’aménagement du secteur d’Antanamanintsy et l’actualisation d’une partie des études de réhabilitation des aménagements actuels dans le périmètre du Bas Mangoky — Étude d’impact environnemental et social, version définitive](https://www.minae.gov.mg/wp-content/uploads/2025/05/1.0.EIES-VERSION-DEFINITIVE_FIN.pdf)<br>Publisher: `Ministère de l’Agriculture et de l’Élevage, Direction Régionale de l’Agriculture et de l’Élevage Atsimo Andrefana`；`government-notice`；publishedOn `2024-04-30`；status `current accepted / production published 2026-08-12` | [CNLEGIS — Recherche directe par numéros](https://cnlegis.gov.mg/page_cherche_dir_numeros/)<br>Publisher: `Direction de la Législation et du Contentieux / CNLEGIS, Madagascar`；`government-notice`；publishedOn `null`；status `current accepted / production published 2026-08-12` | EIA 429 pages，已目检 pp.88、104，SHA `6f1a8350fe35c4284312070104bd70074e41c2466fdf210f1f22465883e54847`；CNLEGIS HTML SHA `25d5a10a32379f214311f322d45756fcdebfcfc4bf733e6ce9928108f496c52f`。EIA 仅二次引用烟度法令，目录未给完整可核原文/表/循环；四 scope no-data。 |
| MUS | [Returns on Enforcement of Vehicular Smoke Emissions (March 2022 – August 2023)](https://environment.govmu.org/Documents/communique/Returns%20on%20Enforcement%20of%20Vehicular%20Smoke%20Emissions%20%28March%202022%20to%20August%202023%29.pdf)<br>Publisher: `Mauritius Ministry of Environment, Solid Waste Management and Climate Change, Environment and Climate Change Division`；`government-notice`；publishedOn `2023-11-08`；status `current accepted / production published 2026-08-12` | [Road Traffic (Amendment) Act 2018 (Act No. 12 of 2018)](https://landtransport.govmu.org/Documents/Legislations/act1218.pdf)<br>Publisher: `Government of Mauritius / Government Gazette of Mauritius`；`official-regulation`；publishedOn `2018-08-11`；status `current accepted / production published 2026-08-12` | Smoke Returns 1 page 已目检，SHA `6f7f2397b11828d3f87b9057fdc654faec721f3910db690333c6f2573c84dfa6`；Act 43 pages，关键 pp.1、19、23、25、34、36、39，已目检 p.39，SHA `586f6f8488ca95a06916494e61d2ef04c2133473e6db8ad1a9cb04307f395b40`。在用烟度执法与道路修法不闭合新发动机表/循环；四 scope no-data。 |
| FJI | [Standard Interpretation Guideline 2025-04 — Customs (Prohibited Imports and Exports) Regulations 1986 – Importation of Motor Vehicles](https://frcs.org.fj/wp-content/uploads/2025/01/SIG-2025-04-Importation-of-Motor-Vehicles-Customs-Prohibited-Imports-and-Exports-Regulations-1986.pdf)<br>Publisher: `Fiji Revenue and Customs Service`；`government-notice`；publishedOn `2025-01-28`；status `current accepted / production published 2026-08-12` | [Importation of Used or Reconditioned Motor Vehicles in 2026](https://frcs.org.fj/public-notice/importation-of-used-or-reconditioned-motor-vehicles-in-2026/)<br>Publisher: `Fiji Revenue and Customs Service`；`government-notice`；publishedOn `null`；status `current accepted / production published 2026-08-12` | SIG 18 pages，关键 pp.1–8、10–11、16–18 均目检，SHA `0279cdbc2caa47ed86be375f0393ca43994402a0f39fa1db6d0bd7093b403e5d`；2026 notice canonical HTML SHA `aa894b8568485a785416d6be99eba3f2587b0f913d99d049970ec6d64f77c93b`，其 1-page linked PDF SHA `d6a5eb02c6c1e7507fcd3e4c1f96918c0b3798083e8cf3cb916f5230d35bb2cf`。整车进口/车龄/Euro 4 标签不能推成完整发动机表，四 scope no-data。 |

### 3.85.7 CAF/COD/COG/GIN/DJI（`verifiedAt=2026-08-10T21:00:43Z`）

| ISO3 | Source 1（exact metadata） | Source 2（exact metadata） | 关键读回、SHA-256 与当前边界 |
| --- | --- | --- | --- |
| CAF | [Loi n° 07.018 du 28 décembre 2007 portant Code de l’environnement de la République centrafricaine](https://faolex.fao.org/docs/pdf/caf105925.pdf)<br>Publisher: `Présidence de la République / Journal officiel de la République centrafricaine`；`official-regulation`；publishedOn `2007-12-28`；status `current accepted / production published 2026-08-12` | [Contribution déterminée au niveau national (CDN 3.0) de la République centrafricaine](https://unfccc.int/sites/default/files/2026-03/CDN%203.0%20CAR%202025.pdf)<br>Publisher: `République centrafricaine / Ministère de l’Environnement et du Développement durable / UNFCCC NDC Registry`；`government-notice`；publishedOn `2026-03-09`；status `current accepted / production published 2026-08-12` | Environment Code 已目检 pp.2、8–9、21、23，SHA `841cecbb783f9d6f0c37cd3f102575a363ccc985537e65d65d3bb813fa8c777f`；CDN 已回读 pp.1、3、5、51/66，官方站阻断稳定二进制时以 Jina 全文 SHA `0fba7abee9be9870e34d0a16cbe4c67cf275f18271e86628b161155db3b80536` 锁证。Code 只授权未来标准/周期检查，CDN 只属 GHG 政策；四 scope no-data。 |
| COD | [Loi n° 11/009 du 09 juillet 2011 portant principes fondamentaux relatifs à la protection de l’environnement](https://medd.gouv.cd/wp-content/uploads/2020/07/attachment1.pdf)<br>Publisher: `Journal officiel de la République démocratique du Congo / Cabinet du Président; official copy hosted by the Ministry of Environment`；`official-regulation`；publishedOn `2011-07-16`；status `current accepted / production published 2026-08-12` | [Arrêté ministériel n° VPM/MTVCD/CAB/085/2025 du 12 novembre 2025 portant réglementation du contrôle technique des véhicules automobiles et des remorques en circulation en République démocratique du Congo](https://transports.gouv.cd/wp-content/uploads/2025/11/ARRETE-MINISTERIEL-N%C2%B0085-DU-12-NOV-2025-PORTANT-RE_251124_152526.pdf)<br>Publisher: `Vice-Primature, Ministère des Transports, Voies de Communication et Désenclavement, République démocratique du Congo`；`official-regulation`；publishedOn `2025-11-24`；status `current accepted / production published 2026-08-12` | 已目检环境法 pp.3、5、20–21、28–29 与 Order 085 pp.1–2、4–5、7、9；SHA `19081af0c3c35b5e8dbc632402c43a37d19ae3864151dc61d9e7eb96068cedbf` / `ab3718fdd530194412d1a0713c47d7f8a0d36198df3fec2dadf8905f55cff3fe`。前者留给后续法令，后者仅在用/首次登记检查且无阈值/循环；四 scope no-data。 |
| COG | [Loi n° 33-2023 du 17 novembre 2023 portant gestion durable de l’environnement en République du Congo](https://www.developpement-durable.gouv.cg/wp-content/uploads/2023/11/Loi_n_33-2023_du_17_novembre_portant_gestion_durable_de_l_environnement_en_Republique_du_Congo_.pdf)<br>Publisher: `Présidence de la République / Ministère de l’Environnement, du Développement durable et du Bassin du Congo`；`official-regulation`；publishedOn `2023-11-17`；status `current accepted / production published 2026-08-12` | [Journal officiel n° 29 du 18 juillet 2019 — Décret n° 2019-171 du 1er juillet 2019 portant réglementation du contrôle technique des véhicules routiers](https://www.sgg.cg/JO/2019/congo-jo-2019-29.pdf)<br>Publisher: `Secrétariat général du Gouvernement / Journal officiel de la République du Congo`；`official-regulation`；publishedOn `2019-07-18`；status `current accepted / production published 2026-08-12` | 已目检环境法 pp.1、8–9、34 与 JO pp.1、4–6；SHA `fe30c50d91627a85dd5a2622acee5ec84a24559cee04c4953af6886f36ba9894` / `53a76619c78f68ed8c4cf06ef36420b8dfab2ca0b638a6c4d93b566a10a38e16`。环境法留待后续法令；2019-171 只是周期检查/整车型式同质化，无排放表/循环；四 scope no-data。 |
| GIN | [Décret D/2019/221/PRG/SGG portant promulgation de la Loi L/2019/0034/AN du 04 juillet 2019 portant Code de l’environnement de la République de Guinée](https://medd.gov.gn/file/2022/12/Code-de-lEnvironnement-du-04-juillet-2019-1.pdf)<br>Publisher: `Présidence de la République / Secrétariat général du Gouvernement, République de Guinée`；`official-regulation`；publishedOn `2019-07-26`；status `current accepted / production published 2026-08-12` | [Loi ordinaire n° L/2018/023/AN du 20 juin 2018 portant Code de la route de la République de Guinée](https://cnt.gov.gn/archive.assemblee/www.assemblee.gov.gn/node/739.html)<br>Publisher: `Assemblée nationale de la République de Guinée / official archive hosted by the Conseil national de la transition`；`official-regulation`；publishedOn `2018-06-20`；status `current accepted / production published 2026-08-12` | Environment Code 已目检 pp.1–2、23、43、45，SHA `4cb8255e5a30c4afe311e88b0b96e47b36e13730d6034d762017ec265bdd5f11`；Road Code HTML Arts.1、12–13、30、36、42 回读，Jina SHA `ab8e5ea46e8056050e90047118987f241e521d9fccc6d92e3098146d11619803`。一般空气授权与道路/检查/homologation 框架不闭合 G1–G5；四 scope no-data。 |
| DJI | [Loi n° 51/AN/09/6ème L portant Code de l’Environnement](https://www.journalofficiel.dj/texte-juridique/loi-n51-an-09-6eme-l-portant-code-de-lenvironnement/)<br>Publisher: `Journal Officiel de la République de Djibouti / Présidence de la République`；`official-regulation`；publishedOn `2009-07-01`；status `current accepted / production published 2026-08-12` | [Décret n° 2010-0230/PR/MID du 4 décembre 2010 relatif aux nouvelles dispositions réglementaires du Code de la Route](https://www.journalofficiel.dj/texte-juridique/decret-n2010-0230-pr-mid-relatif-aux-nouvelles-dispositions-reglementaires-du-code-de-la-route/)<br>Publisher: `Journal Officiel de la République de Djibouti / Présidence de la République`；`official-regulation`；publishedOn `2010-12-15`；status `current accepted / production published 2026-08-12` | 环境法 HTML Arts.33–38、148–149 回读，Jina SHA `c6608c8fad98d305829388238c3c368674feda5ffc25ecbebf019b013d4b6264`；Road Code Arts.R2、R4–6、R34、R54–56.3、R136、R138 回读，Jina SHA `3dc06ef40446d67436a3a68a30a1ea6e39b1f95f8eb849c5cf4749f8cdc03176`。CO/HC/CO₂ 分析仪与柴油烟度只被定义，首次登记/周期检查无阈值、完整表或循环；四 scope no-data。 |

本节 35 国均按当前 fixture 保留恰好两条 source。除 URY 保留既有道路
`1 regulation / 18 limits` 外，其余 34 国均为四 scope no-data、`0 regulation /
0 limit`。追加下节完整性收口前，当时本地闭包为
`79 jurisdictions / 16 regulations / 328 limits / 165 sources`；该历史小计已被
§3.86–§3.87 的 95 国历史闭包 supersede；该 95 国小计又被 §3.88–§3.89 的当前
97 国闭包 supersede。生产数据库、公开 API/页面和覆盖状态尚未同步。

### 3.86 AUS/PNG/CAN/USA 完整数值表与直接来源边界

本节是 ACCEPTANCE #244–#247、#263–#264 与 ADR-133/136 的当前规范 source 索引。数值行必须直接
指向定义该表的法规/eCFR source；管理部门问答、目录或本国引用法规只闭合
适用范围，不替代数值表。日本、美国、Euro、底盘、常速、ABT/FEL/NTE 等替代或
附加路径不与当前代表路径累计。全部状态为 `current accepted / production published 2026-08-12`。

| ISO3 | 国内适用/实施来源（exact link） | 数值表来源（exact link） | 当前边界 |
| --- | --- | --- | --- |
| AUS | [ADR 80/03 direct text](https://www.legislation.gov.au/F2006L04062/latest/text)；[ADR 80/04 direct text](https://www.legislation.gov.au/F2023L00129/latest/text)；[Non-road diesel official evaluation](https://www.dcceew.gov.au/environment/protection/air-quality/national-clean-air-agreement/evaluation-non-road-diesel-engine-emissions) | ADR 80/03 Appendix A §6.2.1 Tables 1–2 直接给 ESC/ELR/ETC B2；ADR 80/04 Appendix A §5.3 Table 1 直接给 CI WHSC/WHTC 六污染物表 | 当前 schema 不单独表达新车型；ADR 80/03 只保留全车 `[2011-01-01,2025-11-01)` 区间，ADR 80/04 从 `2025-11-01` 切换。卡车/客车每 scope 依次 9/12 条；非道路 no-data；`verifiedAt=2026-08-10T23:00:23Z` |
| PNG | [Vehicle Standards and Compliance Rule](https://rta.gov.pg/pdfs/resources/legislation/rules/RTR_VehicleStandardsAndCompliance2018.pdf)；[RTA commencement page](https://www.rta.gov.pg/resources/rules/) | [ADR 80/03 direct text](https://www.legislation.gov.au/F2006L04062/latest/text) 只为 §6A(4)(b) 的一条代表替代路径 | `2019-01-01` 起、GVW >4,500 kg、2012+ 柴油 motor truck 恰好 9 条 ESC/ELR/ETC；Euro V/Japan 05/US 2004 不累计，客车/非道路 no-data；`verifiedAt=2026-08-10T23:00:23Z` |
| CAN | [SOR/2003-2](https://laws-lois.justice.gc.ca/eng/regulations/SOR-2003-2/index.html)；[SOR/2020-258](https://laws-lois.justice.gc.ca/eng/regulations/SOR-2020-258/index.html) | [40 CFR 86.007-11](https://www.ecfr.gov/current/title-40/chapter-I/subchapter-C/part-86/subpart-A/section-86.007-11)；[40 CFR 1039.101](https://www.ecfr.gov/current/title-40/chapter-I/subchapter-U/part-1039/subpart-B/section-1039.101)；[§1039.505](https://www.ecfr.gov/current/title-40/chapter-I/subchapter-U/part-1039/subpart-F/section-1039.505) | §16(2)/§10(1)(a) 闭合加拿大直接纳入链；SOR/2020-258 注册/采纳 `2020-12-04`、第 79 条生效 `2021-06-04`。道路每 scope 4 条；非道路六功率带每 scope 3/3/3/3/4/4 条，总图 48 limits。NRTC 与相应 NRSC 6-mode 或 C1 8-mode/RMC 同时适用；`verifiedAt=2026-08-11T05:21:45.000Z` |
| USA | [40 CFR 86.007-11](https://www.ecfr.gov/current/title-40/chapter-I/subchapter-C/part-86/subpart-A/section-86.007-11)；[40 CFR 1036.104](https://www.ecfr.gov/current/title-40/chapter-I/subchapter-C/part-1036/subpart-B/section-1036.104)；[40 CFR 1039.101](https://www.ecfr.gov/current/title-40/chapter-I/subchapter-U/part-1039/subpart-B/section-1039.101)；[§1039.505](https://www.ecfr.gov/current/title-40/chapter-I/subchapter-U/part-1039/subpart-F/section-1039.505) | 同列 eCFR 官方合并文本的标准表、脚注与 duty-cycle 条款 | MY2010–2026 道路每 scope 7 条、MY2027+ 每 scope 8 条；非道路六功率带每 scope 3/3/3/3/4/4 条，总图 70 limits（road 30 + nonroad 40）。[91 FR 43154](https://www.federalregister.gov/documents/2026/07/14/2026-14112/amendments-and-nonconformance-penalties-for-model-year-2027-and-later-heavy-duty-highway-engines) 仍为 proposed；`verifiedAt=2026-08-11T05:21:45.000Z` |

### 3.87 BRN/BTN/SLB/TLS/MWI/SLE/SOM/SSD/TCD/SLV/SUR/TTO 当前双源图

本节是 ACCEPTANCE #248–#259 与 ADR-134 的规范 source 索引，supersede 这十二国
旧的弱入口、旧报告或复检场所材料组合。每国恰好两条 accepted source，统一
`verifiedAt=2026-08-10T23:08:11Z`、membership `validFrom=2026-08-10`；四 scope 均
no-data，每国 0 regulation/limit。列表中的 accepted 仅表示本地签核，生产尚未刷新。

| ISO3 | Source 1（exact official/current link） | Source 2（exact official/current link） | 来源边界 |
| --- | --- | --- | --- |
| BRN | [Road Traffic Regulations (Chapter 68), Revised Edition 2022](https://www.agc.gov.bn/AGC%20Images/LAWS/ACT_PDF/R/CHAPTER%20068%20RG1%20%282022%29.pdf) — Attorney General’s Chambers，`official-regulation`，publishedOn `null` | [Safe and Smart Driving in Brunei Darussalam](https://www.jpd.gov.bn/SiteAssets/SitePages/Land%20Transport%20Department/Adverts/Safe%20and%20Smart%20Driving%20In%20Brunei%20Darussalam/Safe%20and%20Smart%20Driving%20in%20Brunei%20Darussalam%201st%20edition.pdf) — Ministry of Communications / LTD / BNRSC，`government-notice`，publishedOn `null` | 可见烟气定性条款与在用车 HSU/Bosch 检查不是新发动机完整表/循环 |
| BTN | [Environmental Standards, 2020](https://www.nec.gov.bt/publications/download/environment-standards-2020) — National Environment Commission，`government-notice`，publishedOn `null` | [Implementation of RSTRR 2026](https://bcta.gov.bt/public-notification-implementation-of-the-road-safety-and-transport-rules-and-regulations-rstrr-2026/) — BCTA，`government-notice`，publishedOn `2026-07-03` | `%HSU`/注册类型和实施通知未给出新重型发动机完整表、循环与分期 |
| SLB | [Road Transport Act (Cap. 131)](https://attorneygenerals.gov.sb/legislation-dashboard/download-info/road-transport-act-cap-131/) — Attorney-General’s Chambers / Ministry of Justice，`official-regulation`，publishedOn `null` | [Solomon Islands NDC 3.0, 2025–2035](https://unfccc.int/node/649205) — Solomon Islands Government / UNFCCC，`government-notice`，publishedOn `2025-08-13` | 整车许可/检查分类与气候 KPI 不是发动机认证链 |
| TLS | [Decreto-Lei n.º 26/2012 — Lei de Bases do Ambiente](https://www.mj.gov.tl/jornal/public/docs/2012/serie_1/serie1_no24.pdf) — Jornal da República，`official-regulation`，publishedOn `2012-07-04` | [Decreto-Lei n.º 6/2003 — Código da Estrada](https://www.mj.gov.tl/jornal/public/docs/2002_2005/decreto_lei_governo/6_2003.pdf) — Jornal da República，`official-regulation`，publishedOn `2003-04-03` | 一般标准授权、异常烟气与车型/检查框架不闭合数值表/循环 |
| MWI | [Road Traffic Act §108](https://portal.trade.gov.mw/en-gb/site/display/62) — Government of Malawi Trade Portal，`official-regulation`，publishedOn `1998-01-15` | [Road Traffic Regulations 97](https://portal.trade.gov.mw/en-gb/site/display/101) — Government of Malawi Trade Portal，`official-regulation`，publishedOn `null` | 公路在用车定性烟气义务不能转为新发动机 g/kWh 表 |
| SLE | [The Environment Protection Agency Act, 2022 (Act No. 15 of 2022)](https://www.parliament.gov.sl/uploads/acts/THE%20ENVIRONMENT%20PROTECTION%20AGENCY%20ACT%2C%202022.pdf) — Parliament / Government Printing Department，`official-regulation`，publishedOn `2022-09-15` | [National e-Mobility Strategy 2024–2035](https://epa.gov.sl/wp-content/uploads/2025/03/Gender-Sesitive-National-e-Mobility_-Strategy-2024-35_EPA-converted0.pdf) — EPA Sierra Leone，`government-notice`，publishedOn `2024-11-22` | 一般授权及明确无 type-approval testing 的政策/情景不构成 effective 新发动机法规 |
| SOM | [Environmental Protection and Management Act](https://moecc.gov.so/wp-content/uploads/2024/10/Environmental-Protection-and-Management-Act-Engl_240625_145520-2.pdf) — Federal Government / MoECC，`official-regulation`，publishedOn `null` | [Updated Somalia NDC 3.0](https://unfccc.int/sites/default/files/2025-09/Somalia%20NDC%203.0_Official_2025.pdf) — Federal Republic of Somalia / UNFCCC，`government-notice`，publishedOn `2025-09-08` | 后续标准授权和交通减缓行动不闭合法定完整表/循环/实施日 |
| SSD | [National Bureau of Standards Act, 2012](https://ssnbs.gov.ss/wp-content/uploads/2026/02/National-Bureau-of-Standards-Act-2012-.pdf) — South Sudan National Bureau of Standards，`official-regulation`，publishedOn `null` | [South Sudan's Second NDC](https://unfccc.int/documents/497930) — Ministry of Environment and Forestry / UNFCCC，`government-notice`，publishedOn `2022-06-02` | 通用标准程序与明示尚未实施的车辆措施不是当前认证链 |
| TCD | [Décret n° 904/PR/PM/MERH/2009](https://www.environnement.gouv.td/sites/default/files/inline-files/7.pdf) — Republic of Chad / Ministry of Environment，`official-regulation`，publishedOn `2009-08-06` | [Chad. BUR 1.](https://unfccc.int/documents/645659) — Republic of Chad / UNFCCC，`government-notice`，publishedOn `2025-02-12` | 后续空气文本、噪声 homologation 与清单/减缓报告不是柴油发动机认证表 |
| SLV | [Acuerdo No. 126 — RTS 13.01.02:23](https://osartec.gob.sv/wp-content/uploads/download-manager-files/RTS-Calidad-del-aire_Fuentes-Moviles.pdf) — MARN / Diario Oficial / Imprenta Nacional，`official-regulation`，publishedOn `2024-06-13` | [Derogaciones](https://osartec.gob.sv/servicios/derogaciones/) — OSARTEC，`government-notice`，publishedOn `null` | 自由加速 opacity 是在用道路车检查且排除工程/农业，不转换为新发动机表 |
| SUR | [Milieu Raamwet, S.B. 2020 no. 97](https://www.dna.sr/media/bkih12kt/sb_2020___97.pdf) — De Nationale Assemblée / Staatsblad，`official-regulation`，publishedOn `2020-05-14` | [S.B. 2024 no. 56 amendment](https://www.dna.sr/media/fadicptr/s-b-_2024_no-_56__wet_van_21_mei_2024__houdende_wijziging_van_de_milieu_raamwet__s-b-_2020_no-_97_.pdf) — De Nationale Assemblée / Staatsblad，`official-regulation`，publishedOn `2024-05-28` | 框架法及修法仍需后续技术标准，不提供新重型发动机完整表/循环/实施链 |
| TTO | [The Air Pollution Rules, 2014 — Legal Notice No. 12](https://www.ema.co.tt/our-environment/air/) — Republic of Trinidad and Tobago / EMA，`official-regulation`，publishedOn `2015-01-23` | [Motor Vehicles and Road Traffic (Amendment) Act, 2026 — Act No. 2 of 2026](https://laws.gov.tt/ttdll-web/revision/download/123556?type=amendment) — Parliament / Government Printer / Digital Legislative Library，`official-regulation`，publishedOn `2026-02-02` | 车辆动力发动机被排除于固定源表；2026 修法仍未给新发动机完整认证链 |

### 3.88 MLT EU-27 成员图与 CHN GB 20891 完整功率带纠错

本节是 ACCEPTANCE #260–#261 与 ADR-135 的当前规范 source 边界，supersede
§1.3 / #14 的 MLT 目录排除和历史 CHN 单功率带代表样例。`verifiedAt` 只表示本次
证据读取时刻，不替代 membership `validFrom`、法规 effectiveFrom 或限值 validFrom。

| 国家 / 图 | 规范来源 | 当前结构化边界 |
| --- | --- | --- |
| MLT / EU 成员图 | [EU countries](https://european-union.europa.eu/principles-countries-history/eu-countries_en)；[Regulation (EC) No 595/2009](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32009R0595)；[Regulation (EU) 2016/1628](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R1628) | Malta 自 `2004-05-01` 为 EU 成员；目录与固定 Natural Earth 1:10m 几何现已补齐。成员关系复用 EU 共享 2 regulations / 80 limits / 3 sources；`verifiedAt=2026-08-11T04:27:59Z`。GBR、TUR 与 EEA 法域仍不得自动继承。 |
| CHN / GB 20891 | [生态环境部 GB 20891-2014 标准页](https://www.mee.gov.cn/ywgz/fgbz/bz/bzwb/dqhjbh/dqydywrwpfbz/201405/t20140530_276305.shtml)（含第 1 号修改单）；[HJ 1014-2020](https://www.mee.gov.cn/ywgz/fgbz/bz/bzwb/dqhjbh/dqydywrwpfbz/202012/t20201231_815684.shtml) | 第三阶段从 `2016-04-01` 全面实施；P≤560 kW 的四个历史带在 `[2016-04-01,2022-12-01)` 有效，P>560 kW 延续国三。第四阶段从 `2022-12-01` 对 P≤560 kW 生效，四带每 scope 为 3/4/5/5 条；560 kW 闭合在国四，560.001 kW 返回国三 3 条。NRSC 全部适用，NRTC 按变速/功率条件适用；NH3 25 ppm 因反应剂条件不发布为无条件行。CHN 定向图为 2 regulations / 74 limits / 3 sources；HJ 1014 是第三条循环/控制技术来源；`verifiedAt=2026-08-11T04:38:07Z`。 |

### 3.89 ARE 通用日期与 CAN/USA §1039 完整功率带纠错

本节是 ACCEPTANCE #262–#264 与 ADR-136 的当前规范边界。ARE 的 MOIAT 指南将
`2026-01-01` 限定为首次登记的新引入车型，`2027-07-01` 才扩展到全部进口车辆；由于
当前 schema 不表达 new-model/first-registration，2026 只发布 regulation metadata，普通
numeric 查询到 `2027-06-30` 仍 no-data。CAN/USA 的 §1039 variable-speed 代表路径
必须覆盖法定展示 P<8、8≤P<19、19≤P<37、37≤P<56、56≤P<130、130≤P≤560
六带；每个非道路 scope 对应 3/3/3/3/4/4 条。

[40 CFR §1039.140](https://www.ecfr.gov/current/title-40/chapter-I/subchapter-U/part-1039/subpart-B/section-1039.140)
要求先依 [§1065.20(e)](https://www.ecfr.gov/current/title-40/chapter-I/subchapter-U/part-1065/subpart-A/section-1065.20)
的 ties-to-even 规则把最大功率四舍五入至整 kW，再选择 Table 1 功率带；加拿大
SOR/2020-258 §1(4) 也纳入所引用的 calculation methods。因查询功率保留三位小数，
六带的 raw query bounds 依次为 `[0,7.5)`、`[7.5,18.501)`、
`[18.501,36.501)`、`[36.501,55.5)`、`[55.5,129.5)`、
`[129.5,560.501)`。这些 raw bounds 只是查询翻译，不替代上述法定展示标签；
560、560.001 与 560.500 kW 均命中最高带，560.501 kW 才无结果。

CAN/USA 本轮以 eCFR Table 1 原图、§1039.140 / §1065.20(e) 功率计算规则和
§1039.505 循环条款在
`2026-08-11T05:21:45.000Z` 重新签核。CAN 定向图为 2 regulations / 48 limits / 4 sources，
USA 为 3 / 70 / 3；两国 NRTC 与相应 NRSC 6-mode 或 C1 8-mode/RMC 不是可任意
择一的静态标签。#263/#264 supersede #246/#247 的 partial 非道路描述。

此前 §3.86–§3.87 合并后的 95 国闭包只保留为追加 #260–#264 前的历史小计。
97 个唯一国家命令已于 2026-08-12 在 governance maintenance lock 内完成生产发布，
定向/full selection 闭包为 `97 jurisdictions / 28 regulations / 651 limits / 203 sources`。
release `20260812031745` 已通过生产目标图、scope、178 国公开目录/页面/API 及代表性
法规语义读回；本节较早的 `pending deployment` 状态文字保留为发布前审计轨迹。

## 4. stale SLA 与核验责任建议（DRAFT）

| 国家 | 建议核验周期 | 理由 |
| --- | --- | --- |
| CHN | 公告层 30 天、标准全文 90 天 | GB 标准本身变化慢（约 7 年一次修改单），但实施公告（如 2026 年第 20 号）直接改变生效口径；>560 kW 另行公告需事件驱动监控 |
| USA | 30 天（eCFR 快照比对） | eCFR 每日更新（实测滞后约 3 个工作日）；规则修订低频但 FR 提案/废止（如 2026-04 GHG 废止）必须快速反映状态 |
| DEU/EU | EU 文书 30 天 + 里程碑事件驱动；德国国家法令 180 天 | 582/2011 近年多次修订（最新合并版 2026-03-12）；Euro 7 适用日 2027-11-29 为固定里程碑，临近加密核验 |
| IND | CMVR/CEV/TREM 90 天；MoRTH 公报事件驱动 7 天 | 2026 TREM 草案可能改变既有 2026-04-01 日期，必须监控最终 G.S.R.，不能用草案覆盖现行规则 |
| BRA | CONAMA 决议 90 天；IBAMA IN 30 天 | 决议稳定（P8 2018、MAR-I 2011），实施层（IN、LCVM 程序）变化较快 |
| JPN | e-Gov/三省告示 90 天；环境省说明页 30 天 | 法律框架稳定，但告示与车型清单持续修订；道路 GVW 分期和非道路功率边界需保持同步 |
| KOR | 国家法令中心附表 90 天；修订公报事件驱动 14 天 | 附表 17 同时承载道路、工程机械和农业机械标准；2026-06-26 修订版需持续监控，非道路生效日与 NH3 条件不能丢失 |
| MEX | DOF NOM-044 90 天；修订公告事件驱动 14 天 | AA/B 过渡期、超低硫柴油可用性和替代认证路径会改变当前可执行口径；非道路 no-data 需持续确认是否出现独立标准 |
| TUR | 公报法规 90 天；市场投放/修订事件驱动 14 天 | NRE Stage V 与道路 Euro VI 的执行节点、2021 修订和农业拖拉机排除边界需持续复核；农业独立排放文书仍是缺口 |
| AUS | ADR/Federal Register 90 天；ADR 80/04 适用里程碑与 DCCEEW 非道路政策事件驱动 14 天 | 新车型 2024-11-01、全部车辆 2025-11-01 的双节点不能合并；非道路政策评估可能转为联邦标准，需持续监控 |
| RUS / EAEU | EEC 技术法规 90 天；EEC Council 修订与俄罗斯国内特别程序事件驱动 14 天 | 第 855 号国内程序存在阶段性失效条款；TR CU 031/2012 的功率带切换日期不同，工程机械来源缺口需持续监控 |
| IDN / KLHK | P.20/2017 与 KLHK JDIH 页面 90 天；柴油实施公告事件驱动 14 天 | 执行日期与非道路是否出现独立限值是主要核验点；在没有新文书前保持道路/非道路 scope 隔离 |
| THA / TH-TISI | TISI/Royal Gazette 90 天；标准修订、强制令和阶段切换事件驱动 14 天 | 已建立 2024-01-01 道路 TIS 3046 effective regulation；监控 Level 6 后续阶段及非道路完整表，不从 ≤22 kW 烟色标准外推 |
| VNM / BGTVT | Decision/Circular/QCVN 90 天；QCVN 修订和实施通知事件驱动 14 天 | 道路 Level 5 与非道路排除边界必须保持；修订草案不得提前覆盖现行表 4/5 |
| MYS / DOE | P.U.(A) 429/96 与 VTA 指南 90 天；VTA 指南替换或 Euro IV 正式公告事件驱动 14 天 | 重点监控 tentative Euro IV 是否被正式文书取代；燃油供应日期本身不改变车辆法规状态 |
| SAU / SASO-GSO | MY 技术法规清单与 GSO 目录 90 天；年度清单/阶段切换事件驱动 14 天 | 已闭合 MY2026 道路 Euro V ESC/ELR/ETC；监控后续 MY 清单与 GSO 144 替代版，机械安全文书不得扩展到非道路尾气 |
| ARE / MOIAT | 新车型实施指南 30 天；联邦法规/GSO 修订事件驱动 14 天 | 2026-01-01 仅闭合 new-model metadata，通用 numeric 从 2027-07-01 起；监控阶段切换与非道路独立文书，不用 Diesel/Generator 产品目录改写排放范围 |
| ZAF / NRCS | Notices 611/613 与政府公报 90 天；SANS/ECE 引用链修订事件驱动 14 天 | 已闭合道路 R49.02B 各 4 条；监控替代公报与独立非道路标准，GN 516 固定源表不得混入 |
| ARG / SAyDS | Infoleg 道路决议 90 天；实施修订和非道路文书事件驱动 14 天 | 重点监控 Resolution 1464/2014 的替代/升级文书、军用例外续期边界和独立非道路标准；C/EEV 与 B2 必须保持替代路径语义 |
| NZL / NZTA | Rule 33001 合并文本 90 天；Table 2B 修订和非道路政策事件驱动 14 天 | 重点监控新旧车/车型切换节点、替代标准列表与独立非道路法规；不得将 Table 2B 的 `or` 路径叠加 |
| CHL / MMA | LeyChile 合并文本 90 天；D.S. 55/39 修订与 2030 tractor 里程碑事件驱动 14 天 | 重点监控道路替代路径、移动机械功率范围及拖拉机延期是否再修订；2030 前不得把 adopted 自动当作 effective |
| COL / MADS | Resolucion 0762 与 MinAmbiente 法规目录 90 天；修订和实施通知事件驱动 14 天 | 重点监控 Table 22/23/24、2024-07-18 非道路节点和农业排除是否修订；替代路径不得叠加 |
| PER / MINAM | D.S. 010/029 与 Gob.pe 法规目录 90 天；2026-10-01 协议更新里程碑事件驱动 14 天 | 重点监控 Euro VI/A 到 VI/C 试验协议更新、EPA 路径及独立非道路文书；不得提前升级或外推 |
| PHL / DENR-EMB-LTO | LTO/DENR 文书 90 天；Euro 阶段或 UN R49 采纳修订事件驱动 14 天 | 已闭合 2016-01-01 道路 Euro IV ESC/ELR/ETC；持续监控替代阶段和独立非道路文书，不从在用车公告扩展 scope |
| ECU / INEN | RTE/NTE 目录 90 天；标准替代或强制实施修订事件驱动 14 天 | 已闭合 >3,500 kg 道路 ECE-49 各 4 条；保持工程/农业明文排除，标准版权不因结构化事实入库而改变 |
| PAK / Pak-EPA-PSQCA | S.R.O./标准目录 90 天；Gazette 修订事件驱动 14 天 | 已闭合 2012-07-01 道路 Pak-II ECE-R-49 各 4 条；非道路保持 no-data，在用车烟度执法不得覆盖型式认证边界 |
| ISR / IMR | 年度 IMR 清单 90 天；新 CY 清单发布事件驱动 14 天 | 已闭合 CY2026 道路 Euro VI 与 construction Stage V；监控年度纳入和 agriculture 独立实施链 |
| RWA / RSB | RSB Gazette/标准目录 90 天；EAC 实施桥接修订事件驱动 14 天 | 已闭合 2023-01-23 道路 Euro IV ESC/ELR/ETC；非道路保持 no-data，付费标准正文不得未经许可复制 |
| DZA / JORADP | 公报与实施令 90 天；出现完整新发动机认证链时事件驱动 14 天 | 旧车辆级 numeric 结论已退出 publishable graph；在类别、表、循环与实施边界重新闭合前四 scope no-data |
| ETH / MoTL | Directive/国家标准目录 90 天；替代标准事件驱动 14 天 | 旧不完整 numeric 结论已退出 publishable graph；在污染物语义与类别闭合前四 scope no-data |
| NGA / NESREA | NESREA 法规目录 90 天；Schedule/实施文书修订事件驱动 14 天 | 旧 6 条限值因 PM 单元格不可选择且循环未闭合而待归档；四 scope no-data，后续不得猜选 PM 路径 |
| LKA / Government Printing | Gazette 90 天；车辆进口/排放 Schedule 修订事件驱动 14 天 | 监控 2018-07-13 道路 5+5、工程 24 的替代路径；任何解释都须保留 clause 8 的 2018-10-31 信用证过渡豁免 |
| SGP / NEA-AGC | SSO 合并法规与 NEA 指引 90 天；Second Schedule、off-road Schedule 或适用范围修订事件驱动 14 天 | 重点监控 Euro VI/PPNLT 替代路径、Stage II 替代标准与 agriculture 是否取得明确适用映射；不得将替代标准叠加 |
| NOR / Lovdata | Bilforskriften 与 Maskinforskriften 合并文本 90 天；2029-05-29 道路切换里程碑及 EEA 纳入修订事件驱动 14 天 | 重点监控 G3 的 595/2009 至 2024/1257 切换、Vedlegg XII 修订及历史首次实施日期；国内纳入证据与 EU 数值来源必须同时保留 |
| ISL / Reglugerðasafn | 822/2004 与 179/2021 合并文本 90 天；2027-11-29 Euro 7 切换及 EEA 纳入修订事件驱动 14 天 | 重点监控 603/2026 后续修订、Euro 7 重型适用节点和 179/2021 Stage V 配套文书；国内实施链与 EU 数值来源必须同时保留 |

核验责任建议：法规负责人对样例与限值读回签字；IT/数据负责人维护核验任务
（周期 + 事件驱动）与 `verified_at` 更新（管理后台来源核验流程已具备）。

## 5. 核验状态与缺口汇总

- 已核验（自动抓取确认）：CHN 全部官方文书与公告、USA eCFR/GovInfo/FR
  全部条目与 17 U.S.C. § 105、BRA 法律与 IBAMA 计划页、JPN e-Gov 法令与
  环境省道路/非道路官方页面和限值 PDF、KOR 国家法令信息中心第62条与附表 17
  官方 PDF，IND 的 MoRTH G.S.R. 889(E)、598(E)、850(E)、151(E) 官方 PDF
  与 2026-08-07 公报目录，以及 RUS 的 EEC TR CU 018/2011、TR CU 031/2012、
  Decision 127/2021、Decision 32/2024 与俄罗斯第 855 号政府令官方文本，以及
  IDN KLHK P.20/2017 官方法规入口、THA TIS 3046 正式全文与 Royal Gazette 强制令，
  SRB/BIH/MKD/MNE/ALB 的主管部门、公报与联合国条约/UN R49 正文，UKR 最高拉达
  Law No. 2739-IV 与 Order No. 521，MDA 两条政府 draft/consultation 公告，以及 NPL
  Standard 2082 正式公报与环境部副本，以及 VNM
  政府门户 Decision 49、Circular 06 和 QCVN 109 签署附件，以及 MYS DOE
  P.U.(A) 429/96 合并法规和现行 VTA 指南，以及 PHL 的 LTO MC、DENR-EMB Euro IV
  实施材料与 UN R49-04 CoC 公告，PAK 的 S.R.O. 72(KE)/2009 官方索引与 Gazette
  扫描，SAU 的 MY2026 GSO 技术法规清单与 GSO 144 目录，ARE 的 MOIAT 新车型
  排放实施指南与 Cabinet Resolution 13/2018，ISR 的 CY2026 道路/NRMM IMR，ZAF
  Government Gazette No. 39220 Notices 611/613 与 Directive 91/542/EEC，RWA 的
  Ministerial Order 02/2018、RSB Gazette 04/2023 与 EAC 实施桥接，以及 ECU 的
  RTE INEN 017 与 NTE INEN 2207、LKA Gazette 2079/42 与 2079/70。上述当前链分别
  支持 §3.81 所列道路、工程或 no-data 边界，不再沿用早期相反结论。DZA、ETH、NGA
  的精确文书也已读回，但复核结果是五门槛不闭合；旧 numeric regulation/limits 必须
  归档而不是继续作为已核验数值事实。另有 NZTA Rule 33001 的道路认证范围、tractor 排除和
  Table 2B 统一切换日，以及智利 LeyChile D.S. 39/2020、D.S. 33/2024、
  D.S. 50/2023 与 D.S. 55/1994 现行 article 8 quáter，以及哥伦比亚
  MinAmbiente Resolucion 0762/2022 的 articles 3/18/19/50 与 Tables 22/23/24，
  以及秘鲁 Gob.pe/El Peruano D.S. 029-2021-MINAM annex I.7/I.9.1 和最终补充规定，
  以及挪威 Lovdata Bilforskriften §§ 1-2/1-4、Vedlegg 1 G3 与
  Maskinforskriften § 1(3)、Vedlegg XII。
- 间接核验（官方 WAF/门户不可达，经官方镜像或索引确认身份与内容）：EU
  全部 EUR-Lex 条目（经 CELLAR/ELI）、BRA CONAMA 决议（经 IBAMA 官方
  PROCONVE 页面）、USA 40 CFR Part 86/1039/1068（ecfr.gov 对自动抓取
  302 至 unblock.federalregister.gov 质询；官方域可达，scope 与已核验的
  1036.104 及 EPA 程序页一致），以及 IND G.S.R. 141(E) 的实施日（由 MoRTH
  2026 官方说明明确引用，原始 eGazette PDF 尚未取得稳定直链）。
- 未核验（后续复核项）：BRA in.gov.br DOU 原文、CHN 两个行业协会站点（仅
  HTTP 可达）、USA §1039.101 Table 1 图片数值；这些缺口不扩展为新事实。
- 不在本次范围：ADR-022 语言策略（原文/翻译/检索语言）、ADR-020/021 市场
  指标口径与评分方向、真实产品配置与认证 fixture —— 市场与产品证据接收门
  已分别固化于 `docs/MARKET_EVIDENCE.md` 和 `docs/PRODUCT_EVIDENCE.md`，仍需
  产品/销售负责人另行决定并提供输入。
