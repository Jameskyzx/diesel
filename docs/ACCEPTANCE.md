# 法规验收签核单（M1 决策门）

- 用途：法规负责人对 `docs/SOURCES.md` §3 的验收样例草稿逐条读回签核。
  签核是 M1 决策门的关闭条件，也是真实数据试点切片（M3）的前置。
- 红线：未签核条目仍为 **DRAFT**，不写入数据库、不标记 `verified`、不用于销售
  承诺（TASKS §13.6）。截至 2026-08-11，#1–#264 已完成本地总签核；#1–#165 保留为
  历史签核轨迹，#166–#198 是当前本地 accepted 数据纠错批次，#199–#200 是
  MAR/KEN、#201–#204 是 QAT/KWT/OMN/JOR、#205–#208 是 IRN/IRQ/LBN/SYR，
  #209–#243 是后续 35 国 source-currentness 纠错；#244–#247 是
  AUS/PNG/CAN/USA 数值完整性收口，#248–#259 是 BRN/BTN/SLB/TLS/MWI/SLE/
  SOM/SSD/TCD/SLV/SUR/TTO 当前双源图收口；#260 将 MLT 纳入可寻址 EU-27
  成员图，#261 纠正 CHN GB 20891，#262 纠正 ARE 通用 numeric 日期，#263–#264
  补齐 CAN/USA 非道路完整功率带。#166–#264 已随生产 release
  `20260812031745` 发布并完成目标图、scope 与公开 API/页面读回；YEM 本轮 no-change。
  无来源支撑的 scope 仍保持 no-data，不以签核授权推断事实。
- 详细来源、URL 与核验状态见 `docs/SOURCES.md`；本单只做签核载体。

## 签核流程

1. 法规负责人按行核对“事实”与官方文本（限值需读回原文数字）。
2. “期望确定性结果”必须不借助模型即可判定；有异议直接在备注列修改并署名。
3. 全部签核（或明确删行）后，研发把签核样例转为确定性测试 fixture，
   真实法规/来源经后台 Draft → Reviewed → Published 入库。
4. IND 行于 2026-08-07 在 MoRTH 官方 API/PDF 恢复可达后重新纳入；道路、CEV、
   TREM 的表格和日期均已读回，2026 G.S.R. 151(E) 明确按 proposed 管理。

## 签核表

| # | 国家 / scope | 事实（DRAFT） | 期望确定性结果（as-of 见左列） | 核验状态 | 签核（签名/日期） |
| --- | --- | --- | --- | --- | --- |
| 1 | CHN / on-road-truck·on-road-bus | GB 17691-2018（含 2026 修改单）国六 6b，2023-07-01 起强制；as-of 2026-07-30，350 kW，生产日 2024-01-15；WHTC：NOx ≤ 460 mg/kWh、PM ≤ 10、PN ≤ 6.0e11 #/kWh、CO ≤ 4000、THC ≤ 160 | 适用 GB 17691-2018（6b）；仅 6a/国五认证 = NOT FIT；M3 客车与卡车同文书同结果 | 已核验 |  |
| 2 | CHN / construction·agriculture | GB 20891-2014 + 第 1 号修改单 第四阶段，2022-12-01 起 ≤560 kW 强制；as-of 2026-07-30，100 kW（56≤P<130），制造日 2023-06-01；CO ≤ 5.0、HC ≤ 0.19、NOx ≤ 3.3、PM ≤ 0.025 g/kWh，PN ≤ 5e12 | 适用国四；国三认证 = NOT FIT；边界：Pmax=600 kW 必须返回“>560 kW 另行公告，仍适用国三（CO ≤ 3.5、HC+NOx ≤ 6.4、PM ≤ 0.20）” | 历史代表样例；完整功率带、历史切换和 560 kW 端点已由 #261 / ADR-135 supersede |  |
| 3 | USA / on-road-truck·on-road-bus | 40 CFR 1036.104 适用 MY2027+；as-of 2026-07-30，MY2028，350 kW；FTP/SET NOx ≤ 0.035 g/hp·hr、PM ≤ 0.005、CO ≤ 6.0、NOx FEL ≤ 0.065 | MY2028 → 1036.104；MY2026 查询必须返回 40 CFR 86.007-11（0.20 g/bhp·hr）；GHG Phase 3（89 FR 29440）= superseded（2026-04-20 被 91 FR 7686 废止）；91 FR 43154 = proposed，不得 effective | 已核验（Table 1 读回） |  |
| 4 | USA / construction·agriculture | 40 CFR Part 1039 Tier 4（§1039.101），2014 机型年后；as-of 2026-07-30，250 kW（130–560 kW），制造年 2024；NOx ≤ 0.40、PM ≤ 0.02 g/kWh；NTE ×1.25；FEL NOx ≤ 0.80 / PM ≤ 0.04 | 适用 Part 1039 Tier 4；agriculture 与 construction 同文书 | 已核验；§1039.101 Table 1 为图片，签核前人工读回 |  |
| 5 | DEU / on-road-truck | Euro VI：595/2009（限值经 582/2011 附件 XV 替换，OJ L 167），框架 2018/858；as-of 2026-07-30，N3 300 kW；国家程序 EG-FGV/KBA。CI 机限值（CELLAR 读回）：WHTC CO 4000 / THC 160 / NOx 460 / NH3 10 / PM 10 mg/kWh、PN 6.0×10¹¹ #/kWh；WHSC CO 1500 / THC 130 / NOx 400 / PM 10、PN 8.0×10¹¹ | 返回 Euro VI，NOx WHTC 460 / WHSC 400 mg/kWh；排除 Stage V | 已核验（CELLAR 官方文本读回） |  |
| 6 | DEU / on-road-bus | 同上；Euro 7（2024/1257）对 M2/M3/N2/N3 自 2027-11-29 适用并废止 595/2009；as-of 2026-07-30，M3 210 kW | 2026-07-30 → Euro VI；2028-01-01 → Euro 7（595/2009 superseded）；切换日 2027-11-29 确定性 | 间接核验（CELLAR） |  |
| 7 | DEU / construction | Stage V：2016/1628 附件 II 表 II-1；德国执行 28. BImSchV；as-of 2025-06-01，NRE 150 kW。限值（CELLAR 读回）：130≤P≤560 → CO 3.5 / HC 0.19 / NOx 0.40 / PM 0.015 g/kWh、PN 1×10¹² #/kWh | 返回 Stage V，NOx 0.40 / PM 0.015；排除 Euro VI 分支 | 已核验（CELLAR 官方文本读回） |  |
| 8 | DEU / agriculture | 与 #7 同文书（2016/1628，含对 167/2013 的修订）；DE 无单独农业排放法令；as-of 2025-06-01，150 kW | 与 #7 判定完全一致（跨 scope 确定性断言） | 间接核验（CELLAR） |  |
| 9 | IND / on-road-truck·on-road-bus | MoRTH G.S.R. 889(E) BS VI；GVW > 3,500 kg、2020-04-01 起制造。WHSC：CO 1500 / THC 130 / NOx 400 / PM 10 mg/kWh、NH3 10 ppm、PN 8e11；WHTC：CO 4000 / THC 160 / NOx 460 / PM 10、NH3 10、PN 6e11 | 2020-03-31 无结果，2020-04-01 起卡车/客车均返回 BS VI 两个循环 12 项限值；CEV/TREM 不得出现 | 已核验（2026-08-07，MoRTH 官方 PDF p.29） | Jamesky / 2026-08-07 用户指令批准逐国填充法规 |
| 10 | IND / construction | G.S.R. 598(E) CEV-IV 自 2021-04-01、CEV-V 自 2024-04-01。100 kW：IV 为 CO 5.0 / HC 0.19 / NOx 0.4 / PM 0.025；V 为 CO 5.0 / HC 0.19 / NOx 0.4 / PM 0.015 / PN 1e12 | 2024-03-31 只返回 CEV-IV，2024-04-01 起只返回 CEV-V；P=560 进入 ≥560 带（NOx 3.5 / PM 0.045、无 PN） | 已核验（2026-08-07，MoRTH 官方 PDF p.12） | Jamesky / 2026-08-07 用户指令批准逐国填充法规 |
| 11 | IND / agriculture | G.S.R. 598(E) TREM-IV 经 G.S.R. 850(E) 延至 2023-01-01；TREM-V 经 G.S.R. 141(E) 延至 2026-04-01。45 kW 的 V 为 CO 5.0 / HC+NOx 4.7 / PM 0.015 / PN 1e12；Draft G.S.R. 151(E) 拟再分功率带调整日期 | 45 kW：2022-12-31 无结果、2023-01-01 起 IV、2026-04-01 起 V；15 kW 在 2026-04-01 前无结果、该日起进入 V；G.S.R. 151(E) 永不作为 effective 返回 | 限值、850(E) 与草案状态已核验；141(E) 日期经 MoRTH 官方说明间接核验 | Jamesky / 2026-08-07 用户指令批准逐国填充法规 |
| 12 | BRA / on-road-truck·on-road-bus | PROCONVE P-7：Res. CONAMA 403/2008，自 2012-01-01；柴油机 ESC/ELR NOx 2 / HC 0.46 / CO 1.5 / PM 0.02 g/kWh、opacity 0.5 m⁻¹、NH3 25 ppm，ETC NOx 2 / CO 4 / PM 0.03 / NMHC 0.55 g/kWh、NH3 25 ppm。PROCONVE P8：Res. CONAMA 490/2018，2023-01-01 起全面强制；压燃机 WHSC NOx 400 / PM 10、WHTC NOx 460 / PM 10 mg/kWh（其余限值见 SOURCES） | as-of 2022-12-31 只返回 P-7；as-of 2023-01-01 和 2026-07-30 只返回 P8；卡车/客车同结果，切换日不得重叠 | 已核验（2026-08-05，两份官方 URL 的 Wayback 存档读回） |  |
| 13 | BRA / construction·agriculture | PROCONVE MAR-I：Res. CONAMA 433/2011（ISO 8178-1），≥19 kW。限值（IBAMA 官方手册 p.310 读回）：130≤P≤560 → CO 3.5 / HC+NOx 4.0 / PM 0.2；75≤P≤130 → 5.0 / 4.0 / 0.3；37≤P≤75 → 5.0 / 4.7 / 0.4；19≤P≤37 → 5.5 / 7.5 / 0.6 g/kWh | 按功率带返回 MAR-I 限值（100 kW → 5.0/4.0/0.3；30 kW → 5.5/7.5/0.6）；LCVM 必需 | 已核验（限值读回；决议正文链接仍不可达） |  |
| 14 | EU-27 来源 / 当时地图可寻址 EU-26 全部四个 scope | 欧盟官方 `EU countries` 页面列出 27 个当前成员国和加入年份；595/2009、2016/1628 为直接适用的欧盟法规。成员关系按实际加入日期生效，HRV 为 2013-07-01；当时 MLT 不在 175 国地图目录中，只采集来源，暂不发布成员关系 | 当时其余 EU-26 在成员关系有效期内复用已签核 Euro VI / Stage V；FRA/POL 等返回与 DEU 相同的 EU 限值；HRV 在 2013-06-30 不得返回 EU 法规，2013-07-01 起可以；不得包含 GBR/TUR/EEA | 历史边界；MLT 目录、几何与成员关系已由 #260 / ADR-135 补齐 | Jamesky / 2026-08-06 用户指令批准扩展国家法规覆盖 |
| 15 | JPN / 全部四个 scope | 道路：《道路運送車両の保安基準》第31条 + 环境省平成28年（2016年）重型柴油车表，WHSC/WHTC 平均值 CO 2.22 / NMHC 0.17 / NOx 0.4 / PM 0.010 g/kWh，至 2018-10-01 已覆盖全部 GVW>3.5 t；非道路：现行三省告示的 2014 年基准，19≤P<560 kW 五个功率带、2014-10 至 2016-10 分阶段生效 | 卡车/客车返回同一道路标准；工程/农业返回同一オフロード法标准。150 kW → CO 3.5 / NMHC 0.19 / NOx 0.4 / PM 0.02；P=19 有结果，P=560 无结果。道路统一日期不得误称为首次实施日 | 已核验（2026-08-06，e-Gov 第31条、环境省道路 p.4 与现行三省告示 p.1–3 读回） | Jamesky / 2026-08-06 用户指令批准逐国填充法规 |
| 16 | KOR / 全部四个 scope | 《대기환경보전법 시행규칙》现行附表 17（2026-06-26 修订）；道路大/超大型柴油客货车自 2017-10-01：WHSC CO 1.5 / NOx 0.40 / HC+NOx 0.13 / PM 0.01 / PN 8e11，WHTC CO 4.0 / NOx 0.46 / HC+NOx 0.16 / PM 0.01 / PN 6e11，NH3 10 ppm；工程机械 2020-12-01、农业机械 2021-07-01，150 kW（130≤P<560）CO 3.5 / HC 0.19 / NOx 0.40 / PM 0.015 / PN 1e12 / NH3 10 ppm | 卡车/客车返回同一附表 17 道路标准；工程/农业分别返回对应生效日的非道路标准；边界：P=19 落入 19–37 带，P=37 落入 37–56 带，P=560 无结果；NH3 仅在适用尿素喷射减排装置时适用 | 已核验（2026-08-06，韩国国家法令信息中心附表 17 PDF 与第 62 条读回） | Jamesky / 2026-08-06 用户指令批准逐国填充法规 |
| 17 | MEX / on-road-truck·on-road-bus | NOM-044-SEMARNAT-2017 Tabla 1B/2B；适用新柴油发动机及 GVW > 3,857 kg 新道路车辆；表 1B 为 CT/CSE（CO 15.5、NOx 0.20、HCNM 0.14、PM 0.01 g/bhp-hr），表 2B 为 CEEMAP/CETMAP（NOx 0.40/0.46、PM 0.01、PN 8e11/6e11、NH3 10 ppm 等）；2021 DOF 修订将 AA 延至 2024-12-31 | 2024-12-31 不返回 B 标准；2025-01-01 起卡车与客车均返回两张替代路径表及三类测试循环；工程/农业查询显式 no-data，不从道路标准推断 | 已核验（2026-08-06，DOF 原始公告及 2020/2021 修订公告） | Jamesky / 2026-08-06 用户指令批准逐国填充 |
| 18 | TUR / on-road-truck·on-road-bus·construction·agriculture | 道路 Euro VI：土耳其官方附件 I 的 WHSC/WHTC CI 限值（NOx 400/460、PM 10 mg/kWh、PN 8e11/6e11 等），按 2016-01-01 执行日建模；非道路 2016/1628/AB NRE Stage V：市场投放 2022-10-01，150 kW（130≤P<560）CO 3.50、HC 0.19、NOx 0.40、PM 0.015、PN 1e12 #/kWh；官方第 2 条第 2(b) 款排除 AB/167/2013 农林拖拉机发动机 | 卡车/客车返回同一道路标准；工程机械 150 kW 返回 Stage V；P=560 无结果、P=600 返回 P>560 带；农业 150 kW 显式 no-data，不把 NRE 套到农林拖拉机 | 已核验（2026-08-06，土耳其 Resmî Gazete 道路公报、NRE 公报正文/附件与 Tarım ve Orman Bakanlığı 官方入口） | Jamesky / 2026-08-06 用户指令批准逐国填充 |

| 19 | AUS / on-road-truck·on-road-bus·construction·agriculture | ADR 80/03（Euro V）与 ADR 80/04（Euro VI 等效）均为联邦官方道路规则；ADR 80/03 ESC/ETC 记录 CO 1.5/4.0、THC 0.46、NMHC 0.55、NOx 2.0、PM 0.02/0.03 g/kWh；ADR 80/04 官方问答直接列 WHSC NOx 400 / PM 10、WHTC NOx 460 / PM 10 mg/kWh；新车型 2024-11-01、全部车辆 2025-11-01 | 2024-10-31 返回 ADR 80/03，2024-11-01 起按当前模型切换 ADR 80/04；卡车/客车同结果；DCCEEW 明确非道路柴油发动机目前无联邦排放法规，construction/agriculture 返回 no-data | 已核验（2026-08-06，Federal Register、DITRDCSA、DCCEEW 官方页面与标准汇总 PDF） | Jamesky / 2026-08-06 用户指令批准逐国填充法规 |

| 20 | CAN / on-road-truck·on-road-bus | SOR/2003-2（2003-01-01 发布）；第 16(2) 对柴油重型发动机引用对应机型年的 40 CFR 86.11；适用于 2004-01-01 起进口/制造道路车辆和发动机；代表性 2007+ 限值 NOx 0.20、PM 0.01 g/hp-hr | as-of 2026-08-06，300 kW 的卡车与客车均返回 SOR/2003-2；construction/agriculture 不得返回该道路法规；道路与非道路分别按 scope 查询 | 已核验（2026-08-06，Justice Laws SOR/2003-2 条文读回） | Jamesky / 2026-08-06 用户指令批准逐国填充法规 |
| 21 | CAN / construction·agriculture | SOR/2020-258（2020-12-04 注册/采纳）；第 10(1)(a) 引用 40 CFR 1039.101，第 79 条注册后六个月生效，按 2021-06-04 建模；130≤P≤560 kW Tier 4 代表性限值 CO 3.5、NMHC 0.19、NOx 0.40、PM 0.02 g/kWh | as-of 2026-08-06，250 kW 的工程机械与农业装备均返回 SOR/2020-258；on-road-truck/on-road-bus 不得返回该非道路法规；P=560 仍落入当前代表功率带，P=560.001 无结果 | 已由 #246 / ADR-133 纠正旧日期、端点与完整列（2026-08-11） | Jamesky / 2026-08-06 用户指令批准逐国填充法规 |
| 22 | GBR / on-road-truck·on-road-bus | VCA motor vehicle type approval 页面确认 GB retained `2018/858` 框架 | as-of 2026-08-07，卡车/客车均返回 no-data：尚未从英国官方可访问来源读回 retained `595/2009` 的正式条文、执行日或排放限值；不得按 EU membership 复用；2026-02-01 full approval 节点不作为排放限值生效日 | 已核验范围边界（2026-08-07，VCA 页面） | Jamesky / 2026-08-07 用户指令批准逐国填充法规 |
| 23 | GBR / construction·agriculture | GB NRMM Stage V；VCA/GOV.UK 明确 NRMM 发动机要求 Stage V，2023-01-01 起 GB 市场使用 provisional GB type approval；农业页面另列 EU 167/2013 与 2018/985 框架 | construction：150 kW 返回 CO 3.5 / HC 0.19 / NOx 0.40 / PM 0.015 / PN 1e12 g/e9 per kWh；agriculture：显式 no-data，未将 NRMM 限值套到拖拉机；北爱尔兰不并入 GBR | 已核验范围与边界（2026-08-07，GOV.UK/VCA）；农业独立限值未确认 | Jamesky / 2026-08-07 用户指令批准逐国填充法规 |
| 24 | RUS / on-road-truck·on-road-bus | TR CU 018/2011 附件 1 表 3、附件 2 第 39 项对 M2/M3/N 重型柴油车辆采用生态等级 5、UN R49-05 B2/C；ESC/ELR：CO 1.5、HC 0.46、NOx 2、PM 0.02 g/kWh、opacity 0.5 m⁻¹、NH3 25 ppm；ETC：CO 4、NMHC 0.55、NOx 2、PM 0.03 g/kWh、NH3 25 ppm | 当前 schema 无新车型/既有车型维度，保守从全部车型完成切换的 2019-01-01 返回 11 条限值；2018-12-31 无结果。俄罗斯第 855 号政府令中已于 2025-06-30 失效的排放技术要求不得作为 2026 通用限值 | 已核验（2026-08-07，EEC 官方 TR CU 018/2011 与俄罗斯官方法律门户） | Jamesky / 2026-08-07 用户指令批准逐国填充法规 |
| 25 | RUS / construction·agriculture | TR CU 031/2012 经 Decision 127/2021、32/2024 修订：农业 Class 3A 的 19<P<37、37≤P<75 自 2025-01-01，75≤P<130、130≤P≤560 自 2025-10-01；CO/HC+NOx/PM 四带分别为 5.5/7.5/0.6、5.0/4.7/0.4、5.0/4.0/0.3、3.5/4.0/0.2 g/kWh | agriculture 按严格功率端点和两组切换日返回；边界 19/19.001/37/75/130/560/560.001 kW 的条数为 0/3/3/3/3/3/0。construction 150 kW 显式 no-data，不套用农业、道路或 EU Stage V | 已核验农业法规、修订和工程机械来源边界（2026-08-07，EEC/EAEU 官方文书） | Jamesky / 2026-08-07 用户指令批准逐国填充法规 |
| 26 | IDN / on-road-truck·on-road-bus·construction·agriculture | KLHK P.20/MENLHK/SETJEN/KUM.1/3/2017 为新型 M/N/O 类车辆 Euro 4；重型柴油机 ESC：CO 1.5 / HC 0.46 / NOx 3.5 / PM 0.02，ETC：CO 4.0 / NMHC 0.55 / NOx 3.5 / PM 0.03 g/kWh | 2022-03-31 道路无结果，2022-04-01 起卡车/客车各返回 8 条限值；2026-08-07 工程机械与农业 150 kW 均显式 no-data，不把道路标准或邻国标准外推到非道路 | 已核验法规身份、适用范围与限值表；官方执行日期按印尼柴油全国实施节点保守建模（KLHK JDIH 页面自动抓取受限） | Jamesky / 2026-08-07 用户指令批准逐国填充法规 |
| 27 | THA / on-road-truck·on-road-bus·construction·agriculture | 泰国 PCD 与 TISI 官方入口已核对，但本批尚未从官方可发布正文读回重型道路或非道路柴油限值表 | as-of 2026-08-07，四个 scope 均显式 no-data；不把新闻报道中的 Euro 5 日期、搜索摘要或邻国 Euro/Stage 数值写成 Thailand effective 事实 | 已由 #140 / ADR-122 替代；仅保留历史验收轨迹 | Jamesky / 2026-08-07 用户指令批准先登记缺口 |
| 28 | VNM / on-road-truck·on-road-bus·construction·agriculture | Decision 49/2011/QD-TTg 与 Circular 06/2021/TT-BGTVT 自 2022-01-01 实施 Level 5；QCVN 109:2021/BGTVT 重型柴油 ESC：CO 1.5 / HC 0.46 / NOx 2.0 / PM 0.02，ETC：CO 4.0 / NMHC 0.55 / NOx 2.0 / PM 0.03 g/kWh，ELR 烟度 0.5 m⁻¹ | 2021-12-31 道路无结果，2022-01-01 起卡车/客车各返回 9 条；ETC 不返回仅适用于天然气发动机的 CH4；construction/agriculture 150 kW 显式 no-data，遵守 QCVN 非道路排除 | 已核验（2026-08-07，政府门户 Decision/Circular 正文、121 页签署版与 QCVN 表 4/5） | Jamesky / 2026-08-07 用户指令批准逐国填充法规 |
| 29 | MYS / on-road-truck·on-road-bus·construction·agriculture | DOE P.U.(A) 429/96 与现行 VTA 指南；M>3.5 t、N2/N3 重型柴油道路车辆自 2017-01-01 执行 Euro II UN R49-02(B) 13-mode：CO 4.0 / HC 1.1 / NOx 7.0 / PM 0.15 g/kWh | 2016-12-31 道路无结果，2017-01-01 起卡车/客车各返回 4 条；2026-08-07 仍只返回 Euro II，不把 Euro IV tentative 日期或 Euro 5 燃油供应日期升级为 effective；construction/agriculture 150 kW 显式 no-data | 已核验（2026-08-07，DOE 合并法规 regulation 3–6、现行 VTA 门户和指南 p.33–36） | Jamesky / 2026-08-07 用户指令批准逐国填充法规 |
| 30 | SAU / on-road-truck·on-road-bus·construction·agriculture | GSO 42:2015 与 GSO 144:1991 官方目录均标为 current Gulf Technical Regulation；GSO 144 公开预览确认 >3,500 kg 重型柴油车辆、CO/HC/NOx 与烟度 scope，但预览止于定义页。SASO Machinery Safety Part 2 覆盖移动/重型设备和农业机械目录，但不含柴油尾气污染物限值 | as-of 2026-08-07，四个 scope 均显式 no-data；GSO `approved on` 日期不得替代沙特国家实施日，机械安全法规的 180 日过渡期不得作为尾气法规生效日，不复制付费页外或邻国的限值 | 已核验来源身份、current/scope 和公开正文边界；GSO 限值表与沙特实施文书仍缺失 | Jamesky / 2026-08-07 用户指令批准先登记缺口 |
| 31 | ARE / on-road-truck·on-road-bus·construction·agriculture | UAE 联邦法规门户 Cabinet Resolution No. (13) of 2018 页面标示 issued 2018-04-03、effective 2018-05-01、Active；附表仅列 UAE.S 5016:2018 低批量生产车辆和 UAE.S 5019:2018 车辆 eCall。MOIAT Conformity Hub 的 `Diesel` 条目属于 Petroleum products，`DIESEL GENERATOR` 属于 Electrical / non-regulated products，未给出柴油发动机尾气限值 | as-of 2026-08-07，四个 scope 均显式 no-data；强制标准决议生效日不外推为柴油排放实施日，不把 Diesel/Generator 目录条目或 GSO/Euro/Stage 邻国数值当作 ARE 法规 | 已核验（2026-08-07，UAE Legislation 附表 PDF、MOIAT Conformity Hub 官方目录） | Jamesky / 2026-08-07 用户指令批准先登记缺口 |
| 32 | ZAF / on-road-truck·on-road-bus·construction·agriculture | 南非 Government Gazette No. 39220 Notice 611（N2/N3）与 Notice 613（M2/M3）要求道路车辆排放达到 SANS 20049:2004 / ECE R49.02B 或等效美国、日本、ADR 路径；Schedule 1 保留 2006-01-01、2010-01-01、2011-07-01 操作/豁免节点，但公报未公开可直接发布的污染物数值表。GN 516 为 NEMAQA 固定源活动清单修订意向通知，257410 为 2003 FINAL DRAFT 策略，均不能作为非道路发动机限值 | as-of 2026-08-07，四个 scope 均显式 no-data；不把标准引用、历史 draft 时间表、固定源排放表或邻国 Euro/Stage 数值升级为 ZAF effective limits | 已核验（2026-08-07，南非政府公报 39220 两份 PDF、GN 516、GN 3324） | Jamesky / 2026-08-07 用户指令批准先登记缺口 |
| 33 | ARG / on-road-truck·on-road-bus·construction·agriculture | Resolución 1464/2014 对 M2/M3/N1/N2/N3 重型车辆采用 Directive 2005/55 B2/C：新车型 2016-01-01、全部重型车辆和发动机 2018-01-01；B2 ESC/ELR 为 CO 1.5 / HC 0.46 / NOx 2.0 / PM 0.02 g/kWh / smoke 0.5 m⁻¹，ETC 为 CO 4.0 / NMHC 0.55 / NOx 2.0 / PM 0.03 g/kWh。Resolución 128/2018 仅是 Ejército Argentino 特殊军用车辆 18 个月 Euro III 例外 | 2017-12-31 道路无结果，2018-01-01 起卡车/客车各返回 9 条 B2 限值；军用例外不进入普通市场 effective 结果，C/EEV 不与 B2 叠加；construction/agriculture 显式 no-data | 已核验（2026-08-07，Infoleg 两份官方正文与 Publications Office/CELLAR Directive 2005/55 B2 表） | Jamesky / 2026-08-07 用户指令批准逐国填充法规 |
| 34 | NZL / on-road-truck·on-road-bus·construction·agriculture | NZTA Land Transport Rule 33001 Schedule 1 Table 2B：自 2025-11-01 起新旧 MD3/MD4/ME/NB/NC 重型车辆统一接受 Euro VI Step C、US Tier 3、US 2013、Japan 2016、ADR 80/04、UNR49/06(Supp.4) 或 UNR83/07；本批发布 Euro VI Step C 代表路径，WHSC/WHTC 共 12 条限值。2.1(2)(b) 排除 tractors | 2025-10-31 不返回缺少车辆状态维度时的统一路径，2025-11-01 起卡车/客车各返回 12 条 Euro VI；所有记录保留替代而非累计语义；construction/agriculture 显式 no-data | 已核验（2026-08-07，NZTA 合并规则条款 2.1/2.2、定义及 Table 2B；Euro VI 数值沿用已签核 EU 官方来源） | Jamesky / 2026-08-07 用户指令批准逐国填充法规 |
| 35 | CHL / on-road-truck·on-road-bus·construction·agriculture | LeyChile D.S. 50/2023 将 D.S. 55/1994 article 8 quáter 道路重型限值设为 US-EPA Table 1 或 Euro VI Table 3 替代路径；D.S. 39/2020 对 19–560 kW 移动机械设 US 40 CFR 1039 Table 1 或 EU Stage V Table 2 替代路径；D.S. 33/2024 排除其他农业机械并将 tractor 延至 2030-01-01 | 2026-01-05 道路无结果、2026-01-06 起卡车/客车各 12 条；2023-10-20 construction 无结果、2023-10-21 起按五个功率带返回且含 560 kW；2026 agriculture 无结果，tractor 仅为 2030 adopted。所有 US/EU 路径保持替代而非累计 | 已核验（2026-08-07，LeyChile 三份官方现行文本、条款及表格原图） | Jamesky / 2026-08-07 用户指令批准逐国填充法规 |
| 36 | COL / on-road-truck·on-road-bus·construction·agriculture | MinAmbiente Resolucion 0762/2022：article 18 Table 22 自 2023-01-01 对 M2/M3/N2/N3 重型柴油道路车辆实施 WHSC/WHTC；article 19 Table 23/24 自发布满 24 个月对 19–560 kW 柴油非道路移动源实施 EU 或 US 替代路径；article 3(c) 排除专用于农业作业的非道路移动源 | 2022-12-31 道路无结果、2023-01-01 起卡车/客车各 12 条；2024-07-17 construction 无结果、2024-07-18 起五功率带分别返回 3/3/4/4/4 条且含 560 kW；19–37 仅 NRSC，其余 NRSC/NRTC；agriculture 保持 no-data。EPA10/Table 24 均保持替代而非累计 | 已核验（2026-08-07，MinAmbiente 官方法规目录及签署 PDF articles 3/18/19/50、Tables 22/23/24 原图） | Jamesky / 2026-08-07 用户指令批准逐国填充法规 |
| 37 | PER / on-road-truck·on-road-bus·construction·agriculture | D.S. 010-2017-MINAM annex I.7 经 D.S. 029-2021-MINAM 替换：纳入国家道路运输系统、PBV > 3.5 t 的压燃式客货车辆自 2024-10-01 按提单日期执行 Euro VI/A WHSC/WHTC；annex I.9.1 另列 EPA 2010 路径 | 2024-09-30 道路无结果、2024-10-01 起卡车/客车各 12 条；Euro VI/A 与 EPA 2010 保持替代而非累计。construction/agriculture 保持 no-data，不从道路车辆表外推；2026-10-01 协议更新期限尚未到达，不提前升级为 Euro VI/C | 已核验（2026-08-08，Gob.pe 官方法规页与 El Peruano D.S. 029 公报 pp.22–26、annex I.7/I.9.1 及最终补充规定原图） | Jamesky / 2026-08-08 用户指令批准逐国填充法规 |
| 38 | PHL / on-road-truck·on-road-bus·construction·agriculture | Official Gazette 2014-09-29 DENR 新闻稿确认该部门负责机动车污染与当时 Euro 4 政策，但措辞仍是 proposed early implementation；EMB 官方域名存在 DAO 2015-04 PDF 入口，2026-08-08 直接访问只返回 Cloudflare 安全验证页，Official Gazette 按完整文书号检索无结果。本批未从官方正文读回标题、发布日期、实施日、适用范围或限值 | 四个 scope 均显式 no-data；国家详情必须返回 `PH-DENR` 与 DAO 官方 URL，成员关系以 2014-09-29 已读回职责证据起算但不得解释为 DAO 生效日；不创建 regulation，不以二手摘要、搜索结果、URL 上传目录或模型记忆补 Euro IV 日期/数值 | 已核验官方入口、职责与不可访问边界（2026-08-08）；法规正文与事实未核验 | Jamesky / 2026-08-08 用户指令批准逐国填充法规 |
| 39 | SGP / on-road-truck·on-road-bus·construction·agriculture | S 480/2017 将 GVW > 3.5 t 柴油道路车辆的 Euro VI/PPNLT 路径自 2018-01-01 实施；S 299/2012 自 2012-07-01 要求 industrial plant 中 18≤P<560 kW 非道路柴油机满足 US Tier II、EU Stage II 或 Japan Tier I 任一替代标准。NEA 指引明列 cranes/excavators/forklifts/generators | 2017-12-31 道路无结果，2018-01-01 起卡车/客车各返回 Euro VI WHSC/WHTC 12 条；construction 在 18/37/75/130 kW 下界各返回 EU Stage II 四项限值，17.999 与 560 kW 无结果；agriculture 保持 no-data。所有替代路径不累计 | 已核验（2026-08-08，Singapore Statutes Online S 480/2017、S 299/2012 现行正文与 NEA 指引） | Jamesky / 2026-08-08 用户指令批准逐国填充法规 |
| 40 | NOR / on-road-truck·on-road-bus·construction·agriculture | Bilforskriften FOR-2022-06-28-1233 §§ 1-2/1-4 与 Vedlegg 1 G3 将 595/2009、582/2011 作为挪威法并保留重型道路路径至 2029-05-28；Maskinforskriften § 1(3)、Vedlegg XII 自 2020-07-01 将 EU 2016/1628 作为挪威法规，并涉及 167/2013 农林车辆框架 | 道路 2022-09-30 无结果、2022-10-01 起卡车/客车各返回 12 条 Euro VI、2029-05-29 不再返回；construction/agriculture 2020-06-30 无结果、2020-07-01 起返回 Stage V。150/559.999 kW 各 5 条，560 kW 进入高功率带返回 4 条。挪威适用证据与 EU 数值来源均可追溯 | 已核验（2026-08-08，Lovdata 两份现行法规正文；EU 数值沿用已签核官方表） | Jamesky / 2026-08-08 用户指令批准逐国填充法规 |
| 41 | ISL / on-road-truck·on-road-bus·construction·agriculture | Reglugerð 377/2013 article 12 与 Annex IV 45zzk/45zzl 将 595/2009、582/2011 纳入冰岛道路规则；603/2026 确认现行 595/2009 条目并纳入 Euro 7。1200/2020 自 2020-12-01 实施 2016/1628，179/2021 自 2021-02-23 无缝替代 | 道路 2013-04-14 无结果、2013-04-15 起卡车/客车各 12 条 Euro VI、2027-11-29 不再返回；construction/agriculture 2020-11-30 无结果、2020-12-01 起返回 Stage V，2021-02-23 切换不重复不断档。150/559.999 kW 各 5 条，560 kW 进入高功率带返回 4 条。国内实施证据、政府 EEA 状态和 EU 数值来源均可追溯 | 已核验（2026-08-08，冰岛官方四份法规与政府 EEA 数据库；EU 数值沿用已签核官方表） | Jamesky / 2026-08-08 用户指令批准逐国填充法规 |
| 42 | LIE / on-road-truck·on-road-bus·construction·agriculture | 现行 VTS（LGBl. 1996 Nr. 143，Fassung 01.07.2026）Anhang 4 Ziff. 211 要求重型 M/N 柴油机符合 595/2009 或 UNECE R49；LGBl. 2020 Nr. 258 记录 EWR Decision 39/2020 将 EU 2016/1628 纳入列支敦士登，国内生效日 2020-08-01 | 道路仅从现行合并文本 2026-07-01 返回 Euro VI 代表路径（此前首次实施日期证据不足，不推断）；construction/agriculture 2020-07-31 无结果，2020-08-01 起 Stage V，150/559.999 kW 各 5 条、560 kW 返回 4 条。国内法规与 EU 数值来源分层追溯 | 已核验（2026-08-08，列支敦士登 Lilex VTS 与 LGBl. 2020.258 官方正文；EU 数值沿用已签核官方表） | Jamesky / 2026-08-08 用户指令批准逐国填充法规 |
| 43 | CHE / on-road-truck·on-road-bus·construction·agriculture | 瑞士 Fedlex 现行 VTS（SR 741.41，Stand 01.07.2026）Anhang 5 Ziff. 211 要求重型车辆符合 595/2009 或 UNECE R49；Ziff. 211a/211b 明确工作发动机和拖拉机可按 EU 2016/1628 | 道路与非道路均从当前合并版本 2026-07-01 建模；道路卡车/客车各返回 12 条 Euro VI，construction/agriculture 150/559.999 kW 各 5 条、560 kW 返回 4 条。由于当前官方文本未提供完整首次实施时间线，不反推更早日期 | 已核验（2026-08-08，瑞士 Fedlex VTS 官方正文；EU 数值沿用已签核官方表） | Jamesky / 2026-08-08 用户指令批准逐国填充法规 |
| 44 | NGA / on-road-truck·on-road-bus·construction·agriculture | NESREA 官方 `S.I. No. 20, 2011`：Regulation 17(2) 要求 2015-01-01 起新车型符合 Schedule VIII，Regulation 18 限定道路车辆；item 1 对总质量 >3.5 t 柴油机给出 CO 2.1、HC 0.66、NOx 5.0 g/kWh | 2014-12-31 道路无结果，2015-01-01 起卡车/客车各返回 CO、HC、NOx 三条；PM 扫描单元格含义不清，不猜填；construction/agriculture 保持 no-data | 已核验（2026-08-09，NESREA 法规目录、Official Gazette No. 47 与官方扫描件 Regulations 17(2)/18、Schedule VIII item 1） | Jamesky / 2026-08-09 持续逐国填充法规指令 |
| 45 | EGY / on-road-truck·on-road-bus·construction·agriculture | EEAA 环境法目录列出 Law No. 4 of 1994、Prime Minister Decree No. 338 of 1995 实施条例及修正；Decision No. 710 of 2012 Annex 6 已读回：汽油表为怠速 CO/HC，柴油表为按车型年份划分的 ISO 11614 烟度/不透光度，均属在用车检查而非新发动机型式认证 | 四个 scope 均显式 no-data；国家详情保留 `EG-NATIONAL` 与两个官方来源，不把怠速或 ISO 11614 在用检查、附件文件名或区域 Euro/UNECE 标准升级为发动机 effective regulation | 已核验并渲染 Decision 710/2012 printed pp.26–27 / PDF pp.25–26（2026-08-11）；限值表已读回但不适用本模型 | Jamesky / 2026-08-09 当前三国批次完成后发布指令 |
| 46 | GHA / on-road-truck·on-road-bus·construction·agriculture | Ghana EPA `Laws & Regulations` 页面只列 Environmental Protection Act, 2025 (Act 1124) 概述，`Regulations` 区域未提供车辆/发动机法规正文、限值表或实施日 | 四个 scope 均显式 no-data；国家详情保留 `GH-NATIONAL` 与 EPA 官方来源，不用 Act 1124 的一般授权、ECOWAS 或邻国标准推导排放数值 | 已核验（2026-08-09，Ghana EPA 官方法规页） | Jamesky / 2026-08-09 当前三国批次完成后发布指令 |
| 47 | ISR / on-road-truck·on-road-bus·construction·agriculture | 以色列环境保护部与交通和道路安全部官方入口已复核；当前页面及政府站内查询未提供可读回的重型柴油限值表、完整适用范围和实施日期 | 四个 scope 均显式 no-data；国家详情保留 `IL-NATIONAL` 与两个主管部门来源，不从欧盟/UNECE 型式批准体系外推以色列现行法规 | 已核验主管机构与官方入口（2026-08-09）；法规正文与限值未核验 | Jamesky / 2026-08-09 当前三国批次完成后发布指令 |
| 48 | PAK / on-road-truck·on-road-bus·construction·agriculture | Pak-EPA Gazette Annex III 给出加速烟度、怠速 CO 和噪声；2025 官方执法页确认 S.R.O. 72(KE)/2009 用于柴油卡车烟度检查，但两者均无重型新发动机试验循环和完整 g/kWh 表 | 四个 scope 均显式 no-data；保留 `PK-NATIONAL` 与两份 Pak-EPA 一手材料，不把在用车/怠速/自由加速检测映射为型式认证法规 | 已核验（2026-08-09，Gazette Annex III 与 Pak-EPA 2025 执法页） | Jamesky / 2026-08-09 继续补全国家信息指令 |
| 49 | QAT / on-road-truck·on-road-bus·construction·agriculture | 交通部公告要求 2023 款进口公交/卡车使用 EURO5-equivalent 低硫柴油，但未给实施文书、认证循环和完整污染物限值；本行旧 MECC 来源组合由 #201 supersede | 四个 scope 均显式 no-data；不把燃油/进口政策升级为 Euro V 发动机法规 | 历史核验轨迹（2026-08-09）；当前来源与五门槛结论见 #201 | Jamesky / 2026-08-09 继续补全国家信息指令 |
| 50 | KWT / on-road-truck·on-road-bus·construction·agriculture | EPA Decision No. 8 of 2017 Article 3 / Table 3 对柴油车规定自由加速烟度 2.5/3.0/1.5 m⁻¹，但属于注册和定期检查；本行旧 EPA 来源组合由 #202 supersede | 四个 scope 均显式 no-data；不把在用车烟度门槛映射为重型发动机型式认证 | 历史核验轨迹（2026-08-09）；当前来源与五门槛结论见 #202 | Jamesky / 2026-08-09 继续补全国家信息指令 |
| 51 | OMN / on-road-truck·on-road-bus·construction·agriculture | 环境局 MD 118/2004 只适用于 stationary sources；本行旧固定源/portal 来源组合由 #203 supersede | 四个 scope 均显式 no-data；不把固定源燃烧限值或 GCC/GSO 背景外推到车辆/机械 | 历史核验轨迹（2026-08-09）；当前来源与五门槛结论见 #203 | Jamesky / 2026-08-09 继续补全国家信息指令 |
| 52 | JOR / on-road-truck·on-road-bus·construction·agriculture | 环境部 Transport Sector 行动计划明确 Jordan 尚未对新车采用强制排放标准；本行旧 URL/目录来源组合由 #204 supersede | 四个 scope 均显式 no-data；不把“equivalent Euro III”背景作为新发动机法规 | 历史核验轨迹（2026-08-09）；当前来源与五门槛结论见 #204 | Jamesky / 2026-08-09 继续补全国家信息指令 |
| 53 | KHM / on-road-truck·on-road-bus·construction·agriculture | ISC 链接的 Prakas No. 150 MIH (2016) 将 CTR 142:2016 / CS 535:2016 (UNR49) 列入汽车技术法规；Sub-Decree No. 42 Annex 4 对所有柴油车给出 50% 黑烟 | 四个 scope 均显式 no-data；Prakas 未给 R49 修订系列、实施分期或数值表，Annex 4 属移动源/在用车烟度，不把二者拼接成新重型发动机法规 | 已核验 ISC 扫描件第 2 页与国家贸易资料库 Sub-Decree 正文（2026-08-09） | Jamesky / 2026-08-09 继续补全国家信息指令 |
| 54 | LAO / on-road-truck·on-road-bus·construction·agriculture | Law on Inland Vehicles No. 04/NA Articles 24–25 要求安全/环境检测和出口国技术证书，Article 42 将排放检查列入车辆技术检查但把具体标准留给另行规定；进口车辆措施同样无数值表 | 四个 scope 均显式 no-data；交通部项目附件中的黑烟表是 Decree No. 81/GoL 环境标准摘录，不作为新发动机型式认证数据 | 已核验 Lao Trade Portal 法律全文、措施页及项目附件身份（2026-08-09） | Jamesky / 2026-08-09 继续补全国家信息指令 |
| 55 | LKA / on-road-truck·on-road-bus·construction·agriculture | Gazette 2079/42 Third Schedule Table 5 对 GVW > 3,500 kg 柴油车辆/重型发动机给出 ESC CO 1.5、THC 0.46、NOx 3.5、PM 0.02 g/kWh 与自由加速烟度 0.5 m⁻¹；Table 6 对工程设备按六功率带给出 CO、HC+NOx、PM 与 80% 负载烟度；2083/3 增加 Fifth Schedule 替代路径 | 2018-08-05 无结果，2018-08-06 起卡车/客车各返回 5 条；construction 在 8/19/37/75/130 kW 下界无缝切换并各返回 4 条，130 kW 以上使用最高功率带；Third/Fifth 不累计。agriculture 保持 no-data | 已核验两份政府公报，2079/42 共 6 页并逐页核对 Tables 5–6（2026-08-09） | Jamesky / 2026-08-09 继续补全国家信息指令 |
| 56 | MNG / on-road-truck·on-road-bus·construction·agriculture | 政府 2021 年第 148 号决议附件 §3.8 与车辆检查联合命令 §20.5 均引用 MNS 5014 柴油车烟度标准；公开目录只确认 MNS 5014:2009 标识，未提供正文数值或型式批准映射 | 四个 scope 均显式 no-data；保留两份 Legalinfo 精确正文，不把在用车烟度标准或目录编号升级为重型新发动机法规 | 已核验 Legalinfo 现行技术法规和车辆检查程序（2026-08-09） | Jamesky / 2026-08-09 继续补全国家信息指令 |
| 57 | CRI / on-road-truck·on-road-bus·construction·agriculture | PGR/SCIJ 现行 Decree 39724 的入境技术条件只明确覆盖汽车和 ≤3,500 kg 轻型货车，Article 9 是在用车浓度/烟度；Law 9078 Article 38 排除农业、工业和工程机械 | 四个 scope 均显式 no-data；返回 `CR-NATIONAL` 与两份精确法律来源，不把轻型车入境要求、道路年检或非道路豁免反向外推为重型法规 | 已核验 PGR/SCIJ 现行法规记录与 Article 38（2026-08-09） | Jamesky / 2026-08-09 继续补全国家信息指令 |
| 58 | ECU / on-road-truck·on-road-bus·construction·agriculture | RTE INEN 017:2008 强制适用于进口/国产道路车辆并含重型税则，但把柴油限值和试验循环引用到 NTE INEN 2207:2002；第 2.3 条排除工程、工业和农业机械。INEN 当前页面确认该标准关系，标准正文因版权不开放下载 | 四个 scope 均显式 no-data；道路不从未读回的 NTE 2207 猜填数值，工程/农业遵守明文排除；国家详情返回 INEN 当前说明页和 RTE 官方 PDF | 已核验并渲染 RTE 017 scope/引用页（2026-08-09）；NTE 2207 数值正文未取得 | Jamesky / 2026-08-09 继续补全国家信息指令 |
| 59 | DOM / on-road-truck·on-road-bus·construction·agriculture | 2017 移动源技术环境法规 Article 1 明确针对在用车辆；Article 9/Table 8 为自由加速烟度，Table 9 为按制造年份的 Euro II/IV 等效 g/km 表，未给重型独立分类或新发动机认证循环 | 四个 scope 均显式 no-data；保留环境部 PDF 和 INTRANT 技术检查法律基础，不把在用车数值升级为型式认证法规 | 已核验并渲染官方 PDF Articles 1/9、Tables 8–9（2026-08-09） | Jamesky / 2026-08-09 继续补全国家信息指令 |
| 60 | DZA / on-road-truck·on-road-bus·construction·agriculture | JORADP Decree 03-410 Articles 3–4 在 `contrôle de conformité` 栏给出四类柴油车辆/机械的烟度和 CO/HC/NOx/PM。重型客车 PM 0.15、重型货车 0.1 g/km；农业三功率带 PM 0.85/0.70/0.54；工程机械 PM 0.9；道路烟度 1.7、非道路 2.3 m⁻¹ | 2003-11-09 起四个 scope 均返回 5 项；fixture 总数 28。农业 37 kW 仅返回无功率分档烟度，75/75.001/130/130.001 kW 按 `(37,75]`、`(75,130]`、`>130` 切换；不混入定期检查 2.5/3.0 m⁻¹，不标作 Euro 等级 | 已核验 JORADP 公报 pp.15–19、原表视觉对齐与 ONEDD 现行索引（2026-08-09） | Jamesky / 2026-08-09 继续补全国家信息指令 |
| 61 | TUN / on-road-truck·on-road-bus·construction·agriculture | 环境部法规总目录最后更新于 2026-05-22；“污染与危害防治”分类只列车辆定点噪声检查等条目。交通部道路运输法律法规目录列出经营、许可、车辆使用和行业组织文书，均未提供重型柴油新发动机型式认证法规、试验循环或污染物限值表 | 四个 scope 均显式 no-data；国家详情保留 `TN-NATIONAL` 和两个精确官方法规目录，不把车辆噪声检查、运输经营文书或区域 Euro 背景升级为排放法规 | 已核验两个官方目录（2026-08-10）；未读回可发布限值 | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 62 | ETH / on-road-truck·on-road-bus·construction·agriculture | Directive No. 1051/2025 将车辆排放标准纳入全国控制体系并自交通部网站发布生效；ES 6725:2022 Part 1 Table 1 对新 N2/N3 柴油车给出 CO 1.50、NOx 3.5、PM 0.02 g/kWh，ISO 16183:2002。0.46 列同时标作 HC+NOx 且另有 NOx 列，含义冲突 | 2026-07-24 无结果，2026-07-25 起 on-road-truck 返回 3 项；歧义 0.46 单元格不入库。表内没有 M2/M3、construction 或 agriculture 型式认证行，三者保持 no-data | 已核验交通部 Directive 全文与 ES 6725:2022 Table 1 原表（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 63 | GTM / on-road-truck·on-road-bus·construction·agriculture | MARN《Memoria de Labores 2025–2026》p.24 明确预计 2027 年才发布国家排放控制法规；2026 年 15 ppm 柴油硫含量属于燃油质量 | 四个 scope 均显式 no-data；保留官方报告与 MARN 入口，不把 2027 计划或燃油质量升级为当前发动机法规 | 已核验 MARN 官方报告（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 64 | HND / on-road-truck·on-road-bus·construction·agriculture | Decree 36-2024 只授权主管机构后续建立车辆排放水平，未给数值和循环；Executive Agreement 1566-2010 Article 4 明文排除车辆排放 | 四个 scope 均显式 no-data；保留两份官方公报正文，不从一般授权或固定源限值推断车辆/发动机法规 | 已核验 La Gaceta 36,594 p.6 与 Agreement 1566-2010 Article 4（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 65 | PAN / on-road-truck·on-road-bus·construction·agriculture | Executive Decree No. 38/2009 的控制路径是道路车辆年度检验，柴油数值属于在用车烟度/不透光度；无需道路许可的农业和工程机械被排除 | 四个 scope 均显式 no-data；返回官方公报和 MiAMBIENTE 法规目录，移除误用的劳工部入口，不把年检阈值映射为新发动机型式认证 | 已核验 Gaceta Oficial No. 26303 与 MiAMBIENTE 目录（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 66 | URY / on-road-truck·on-road-bus·construction·agriculture | Decreto 135/021 Article 48/Table 17 对 >2,610 kg 零公里压燃式 M/N 车辆给出 ESC：CO 1.5、HC 0.46、NOx 2.0、PM 0.02 g/kWh、烟度 0.5 m⁻¹；ETC：CO 4.0、NMHC 0.55、NOx 2.0、PM 0.03 g/kWh。Table 14 覆盖 M2/M3 与 N2/N3 | 2023-05-13 无结果，2023-05-14 起卡车/客车各返回 9 项，ESC/ETC 不合并；construction/agriculture 因 Article 52 仅授权未来另行规定而保持 no-data，fixture 共 18 条 | 已核验并渲染官方法规 Tables 14/17，复核当前 homologation procedure（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 67 | BWA / on-road-truck·on-road-bus·construction·agriculture | BOBS BOS 134:2014 ed.2 涵盖在用汽油/柴油车辆 CO、HC 与烟度/不透光度检测，但官方产品页将法律状态标为 Voluntary；Botswana e-Laws 未返回独立强制的新重型发动机表 | 四个 scope 均显式 no-data；不把自愿在用车检测规范升级为强制型式认证 | 已核验 BOBS 精确标准页与政府 e-Laws 入口（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 68 | NAM / on-road-truck·on-road-bus·construction·agriculture | MWT Transportation Policy and Regulation Directorate 负责运输政策、合规和技术标准协调；NSI 技术委员会覆盖车辆/道路安全，但公开入口未提供国内强制的新重型柴油污染物表、循环和实施日 | 四个 scope 均显式 no-data；不从南非标准或财政 CO2 levy 外推 | 已核验 MWT 与 NSI 精确职责/标准入口（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 69 | TZA / on-road-truck·on-road-bus·construction·agriculture | NEMC 2007 Regulations Regulation 12 是车主/驾驶人运行合规；官方 PDF 首页与末页仍留空 Government Notice、发布日期/签署日期，Table C 又指定车辆尾气分析方法。TBS DEAS 1047:2021 明确是 draft | 四个 scope 均显式 no-data；不把在用车表、未完成公报字段或 draft 升级为有效新发动机型式认证 | 已核验并渲染 NEMC PDF pp.1、7、21–22，核对 TBS draft（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 70 | UGA / on-road-truck·on-road-bus·construction·agriculture | S.I. No. 22 of 2024 Regulations 2、9–10 与 Schedule 4 自 2024-04-26 生效；有效法规元数据入库。重型表原版表头印为 `kg/kWh`，GVW 行与 C/CE 类别定义冲突且未给 F/G 可映射行；UNBS 仅公开 US EAS 1047:2022 compulsory 元数据 | 2024-04-26 起国家详情返回有效法规与强制标准来源链，但四 scope 数值仍显式 no-data；零条 limit，禁止擅自把单位改成 g/kWh 或把错位类别外推 | 已核验 NEMA 官方目录/全文并渲染同版公报 pp.333–335，核对 UNBS 目录（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 71 | ZMB / on-road-truck·on-road-bus·construction·agriculture | ZEMA S.I. 112/2013 Regulation 5(2) 与 Second Schedule 针对 `plant, undertaking or process` 的固定源/行业排放；RTSA Road Traffic Act 只授权道路烟雾和车辆适用性规则 | 四个 scope 均显式 no-data；不把 `mg/Nm3` 固定源表、一般道路烟雾义务或邻国规则映射为新重型发动机限值 | 已核验 ZEMA 正文与 RTSA 法案副本（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 72 | ZWE / on-road-truck·on-road-bus·construction·agriculture | EMA Air Emission Licence 明确面向商业设施备用发电机；S.I. 129/2015 §79 约束道路车辆尾气并引用另行的 SAZ standards，但公报本身没有标准编号、污染物表或认证循环 | 四个 scope 均显式 no-data；不把设施许可、在用车道路合规或未读回的 SAZ 标准推定为型式认证限值 | 已核验 EMA 官方页、Veritas 公报镜像并以 ZRP 现行引用交叉确认（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 73 | RWA / on-road-truck·on-road-bus·construction·agriculture | RSB 元数据与 2023 Gazette 确认 RS EAS 1047:2022 覆盖新车、进口二手车和在用重型车并替代 RS 407-1:2019；22 页正文为付费标准。RNP 只公开周期性在用车排放检查 | 四个 scope 均显式 no-data；未读回标准数值与强制适用拆分前，不从 Euro 4 描述、区域邻国文本或在用车检查外推 | 已核验 RSB 官方标准页、Gazette 与 RNP 检验说明（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 74 | CIV / on-road-truck·on-road-bus·construction·agriculture | 官方材料确认 Décret 2017-125 正在执行且 Articles 2–4 覆盖装有燃烧发动机的机械/交通工具；可读材料没有完整车辆表。NI 505:2025 明确是周期性机动车技术检查指南 | 四个 scope 均显式 no-data；不把环境空气值、周期检验或非官方转录中的在用车数值升级为新发动机型式认证限值 | 已核验环境部实施页、水利与森林部审计 p.53 与交通部 NI 505 页面（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 75 | CMR / on-road-truck·on-road-bus·construction·agriculture | NC 2858:2021 §11.1 明文针对里程至少 3000 km 的在用车；§11.2 柴油吸收系数原版印作 `5 m`/`3.5 m`，缺少逆米指数、重型分类和认证循环。Decree 2011/2582/PM 仅提供移动源一般授权 | 四个 scope 均显式 no-data；不擅自修正原文单位，不把在用车验收或一般授权升级为型式认证限值 | 已核验并渲染 MINEPDED/ANOR 标准 p.37，核对官方法令页（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 76 | SEN / on-road-truck·on-road-bus·construction·agriculture | ASN 目录确认 NS 05-060:1999/NS 05-062:2018 身份但不公开数值正文；Road Code Annex G 给出柴油烟度 25%，G4 检测条件仍需另行规定，未给重型发动机分类、功基准单位或认证循环 | 四个 scope 均显式 no-data；不把车辆烟度/浓度检查或目录元数据映射为新重型发动机认证表 | 已核验 ASN 目录、政府 Road Code Annex G p.66 与技术检查服务说明（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 77 | MOZ / on-road-truck·on-road-bus·construction·agriculture | SIBMOZ 确认 Decree 18/2004 覆盖车辆移动源，但当前官方链接实际提供 Decree 67/2010 修正案而非原始移动源完整表；INM Decree 44/2017 车型/机械审批条目没有污染物数值或循环 | 四个 scope 均显式 no-data；不从非官方转录的燃油经济性/排放因子表拼接产品认证要求 | 已核验 SIBMOZ 条目、渲染 67/2010 全部 5 页并核对 INM 44/2017 元数据（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 78 | SWZ / on-road-truck·on-road-bus·construction·agriculture | Air Pollution Control Regulations 2010 只给环境空气目标和商业/工业场所规则；交通部门公开的是适行性检查。SWASA ARS 1595 vehicle homologation 仍为 stage 04.00 draft | 四个 scope 均显式 no-data；不把环境空气值、适行性检查、未来授权或草案升级为 effective 新发动机限值 | 已核验并渲染 EEA 条例，核对政府交通职责与 SWASA 工作计划（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 79 | LSO / on-road-truck·on-road-bus·construction·agriculture | 政府 Roadworthiness / Fitness 服务覆盖重型商用车和客车，但只给适行性办理与费用；2006 Transport Sector Policy 记录 Road Traffic Bill 2004 和 draft regulations 当时仍待 enactment | 四个 scope 均显式 no-data；不把适行性服务或 2006 年待立法草案当作 2026 年有效发动机排放标准 | 已核验政府服务页与交通政策 PDF（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 80 | MDG / on-road-truck·on-road-bus·construction·agriculture | 2025 官方 EIA 法律清单列出 Arrêté 6941/2000 汽车尾气烟度法令并注明废止 1971 旧令，但未转载正文；CNLEGIS 编号 6941 检索只返回 2013/2017 异文 | 四个 scope 均显式 no-data；不从法规标题、同号异文或二手转录猜填重型分类、数值与认证循环 | 已核验并渲染 EIA pp.87、103，核对 CNLEGIS 结构化结果（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 81 | MUS / on-road-truck·on-road-bus·construction·agriculture | NLTA 目录确认 2002 车辆排放法规及 2003/2010 修订；环境部执法回报按 GN 41/2022 对在用车执行 `>50–70%`、`>70%` 不透光度分档 | 四个 scope 均显式 no-data；不把在用车烟度执法/排气测试映射为新重型发动机功基准限值或非道路法规 | 已核验 NLTA 法规目录与环境部执法回报（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 82 | MWI / on-road-truck·on-road-bus·construction·agriculture | Road Traffic Act §108(1)(l) 与 Regulations regulation 97 仅约束公共道路车辆的定性烟雾/烟气状态和滋扰/视线风险 | 四个 scope 均显式 no-data；不把定性运行合规授权升级为含数值、功率带或试验循环的发动机型式认证 | 已核验 Malawi Trade Portal 法案与条例正文（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 83 | FJI / on-road-truck·on-road-bus·construction·agriculture | FRCS Standard Interpretation Guideline 2025-04 与 2026 公告依据 Customs Regulations 管理新车及二手/翻新 public transport、goods vehicles 和 road tractors 的 Euro 4 进口条件 | 四个 scope 均显式 no-data；不把 Euro 4 进口准入标签映射为斐济新重型发动机完整限值，也不外推非道路机械 | 已核验并渲染 FRCS 指南 pp.4、10，核对 FRCS 2026 公告（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 84 | BLZ / on-road-truck·on-road-bus·construction·agriculture | Pollution Regulations regulations 25–26 要求机动车检查 CO/HC/曲轴箱压力和可见排放，但具体 levels/procedures 与汽柴油污染物数量由部长另行规定 | 四个 scope 均显式 no-data；不把授权条款、Ringelmann 可见烟或未读回的部长规定猜成新重型发动机数值 | 已核验并渲染 DOE Pollution Regulations p.108，核对交通门户（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 85 | BRN / on-road-truck·on-road-bus·construction·agriculture | Road Traffic Regulations regulation 33A 为道路车辆可见排放定性义务；LTD roadworthiness inspection 对柴油车使用 `<50% HSU or Bosch Unit` | 四个 scope 均显式 no-data；不把在用车适行性烟度值换算成 g/kWh 型式认证表或外推非道路机械 | 已核验 AGC 法规并渲染 LTD 指南 p.86（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 86 | BTN / on-road-truck·on-road-bus·construction·agriculture | Environment Standards 2020 §8 按注册日期给出汽油 `%CO` 和柴油 `%HSU`，2021 后 Euro 6/BS VI approval type 为 50% HSU；RSTRR 2026 自 2026-07-01 生效 | 四个 scope 均显式 no-data；不把车辆注册/在用车 HSU 表或 Euro 6/BS VI 标签展开成未读回的重型发动机污染物/循环表 | 已核验并渲染 NEC 标准 p.11，核对 BCTA 2026 实施通知（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 87 | CAF / on-road-truck·on-road-bus·construction·agriculture | SENI-PLUS CGES 要求通过维护发动机、喷油系统和空气滤清器减少项目施工柴油机烟雾；交通与民航部官网仍为建设中占位页 | 四个 scope 均显式 no-data；项目环境缓解要求和主管机关占位门户都不是全国新重型发动机法规，不从区域/邻国标准补表 | 已核验并渲染卫生部 CGES PDF p.162（文内 p.138），核对交通部官网（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 88 | COD / on-road-truck·on-road-bus·construction·agriculture | Law 11/009 Article 47 只确立空气排放禁令并把标准留给后续法令；Order 085/2025 对在用车辆实施半年技术检验，把尾气列入污染/滋扰检查，但新车前 24 个月免检且无数值表 | 四个 scope 均显式 no-data；不把一般空气授权或道路适行性检查升级为新发动机型式认证限值 | 已核验并渲染环境法 p.20、技术检验令 pp.1、4–5（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 89 | COG / on-road-truck·on-road-bus·construction·agriculture | Law 33-2023 Articles 23–24 禁止车辆/机械排放有害烟雾与气体并要求发动机周期检查；Decree 2019-171 将污染/噪声列入道路车辆技术检查并规定分车型周期，二者均无排放数值、功率带或认证循环 | 四个 scope 均显式 no-data；不把定性禁令、车辆年检或检查范围外推为新发动机排放表 | 已核验并渲染环境法 PDF p.9、Official Gazette pp.4、6（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 90 | CUB / on-road-truck·on-road-bus·construction·agriculture | 官方报道确认 Law 150/2022 及配套法规已发布；MITRANS Law 109 及补充规则要求车辆技术检查 CO 或柴油尾气不透光度，但参数指向现行规范、制造商要求和交通部另行规定，没有完整新重型发动机表 | 四个 scope 均显式 no-data；不采用二手研究转录的 Resolution 172/2001 数值，不把在用车不透光度检查映射为型式认证限值 | 已核验 Granma 环境法实施报道，并渲染 MITRANS 汇编 PDF pp.100、109–110、209、211（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 91 | DJI / on-road-truck·on-road-bus·construction·agriculture | Environmental Code 建立一般空气污染框架；Decree 2010-0175 Articles 1、3、7 将尾气列入周期/进口二手车技术检验，Decrees 80-151 与 2012-0106 另规定定性烟雾义务和检验设备，但均无完整新重型发动机表 | 四个 scope 均显式 no-data；不把在用车尾气、烟度检查或设备要求映射为型式认证限值 | 已核验吉布提官方公报四份精确法规页面（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 92 | ERI / on-road-truck·on-road-bus·construction·agriculture | Gazette Proclamation 179/2017 与 Legal Notice 127/2017 Article 12 要求项目及机械遵守规定排放标准；政府信息部材料确认车辆/卡车年度检查，但可见材料均无排放数值、功率带或认证循环 | 四个 scope 均显式 no-data；不把委托的标准或年度车辆检查猜成新重型发动机限值 | 已核验并渲染 Gazette pp.1、11，核对政府信息部两篇公告（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 93 | GAB / on-road-truck·on-road-bus·construction·agriculture | Law 007/2014 Articles 50、53–55 要求车辆减少空气污染并把阈值留给实施规章；Order 1823/MTACT 对超过 3.5 t 和公共运输车辆规定周期技术检验，但无发动机排放表 | 四个 scope 均显式 no-data；不把一般空气义务、后续授权或在用车周期检查升级为型式认证限值 | 已核验加蓬官方公报两份精确法规页面（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 94 | GIN / on-road-truck·on-road-bus·construction·agriculture | Environmental Code Articles 65–66 要求车辆遵守排放技术标准并禁止超过由规章规定的限值；交通部材料只确认技术检验数字化，未提供新重型发动机限值、类别、功率带或认证循环 | 四个 scope 均显式 no-data；不把委托条款或技术检验制度补写为未读回的发动机表 | 已核验并渲染环境法典 PDF pp.1、23（文内 p.22），核对交通部公告（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 95 | GMB / on-road-truck·on-road-bus·construction·agriculture | Environmental Quality Standards Regulations 1999 Schedule I 是 SO₂、PM10、NO₂、铅的环境空气浓度表；2022 内阁只审议车辆检验条例方案并要求继续磋商 | 四个 scope 均显式 no-data；不把 `µg/m³` 环境空气值换算成发动机 `g/kWh`，不把内阁审议方案标为 effective | 已核验并渲染环境标准 PDF pp.1–3，核对总统办公室内阁结论（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 96 | GNB / on-road-truck·on-road-bus·construction·agriculture | Law No. 1/2011 Article 9 确立空气质量原则并把有害物质排放交由专门立法；当前政府交通部目录仅确认陆路运输职责，未发布新重型发动机表 | 四个 scope 均显式 no-data；不把环境基本法委托或主管部门职责补写为未读回的车辆/发动机限值 | 已核验并渲染官方公报 PDF pp.1、6–7，核对当前政府交通部页面（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 97 | GNQ / on-road-truck·on-road-bus·construction·agriculture | 政府材料确认 Law No. 7/2003 与 ITV 污染控制职责；2025 监督材料明确 Malabo 重型车辆诊断线未运行，Malabo/Bata 当时只做目视检查 | 四个 scope 均显式 no-data；不把法律身份、机构职责或目视在用车检查升级为新发动机型式认证限值 | 已核验政府新闻办公室两篇精确页面（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 98 | GRL / on-road-truck·on-road-bus·construction·agriculture | 1979 No. 141 车辆设备令仍为现行；Road Traffic Act No. 995/2009 §§3–6 规定车辆状态/检验，§37 只禁止不必要的烟雾或气体，无数值、功率带或认证循环 | 四个 scope 均显式 no-data；不把定性烟气义务或警方检查外推为发动机表，也不从丹麦/EU 规则补值 | 已核验 Nalunaarutit 现行状态并渲染道路交通法 PDF pp.1–2、6（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 99 | GUY / on-road-truck·on-road-bus·construction·agriculture | Air Quality Regulations 2000 regulations 18–20 要求进口车辆达到 EPA 后续建立的尾气标准；Motor Vehicles Act §14 建立适行证，§103 只授权烟雾/可见蒸气规则，汇编未给车辆发动机数值表 | 四个 scope 均显式 no-data；不把后续标准授权、适行性检查或可见烟雾条款升级为新重型发动机型式认证限值 | 已核验并渲染法律事务部汇编 PDF pp.167–168、23、108（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 100 | HTI / on-road-truck·on-road-bus·construction·agriculture | 环境部框架确认 2005 环境管理法令是一般环境治理基础；2025 MCI 公告要求二手进口车辆/机械进口前技术检查和合格证明，均无柴油发动机污染物表 | 四个 scope 均显式 no-data；不把一般环境框架、消费者保护或进口技术检查映射为发动机型式认证限值 | 已核验并渲染 MDE 框架 PDF p.139（文内 p.119），核对政府/MCI 公告（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 101 | IRN / on-road-truck·on-road-bus·construction·agriculture | 历史复核当时只读回 Clean Air Law 委托与 Article 4 部分记录；现已由 #205 以 post-41054 合并条例和 post-44973 修订 supersede，并确认 Article 4 日程可读 | 四个 scope 均显式 no-data；当前理由不是日程读取问题，而是未同时闭合新重型发动机分类/功率、完整污染物表和认证循环 | 历史核验轨迹（2026-08-10）；当前 exact 双源与五门槛见 #205 | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 102 | IRQ / on-road-truck·on-road-bus·construction·agriculture | 环境部法规目录确认 Environment Act No. 27/2009、环境空气制度及活动/企业排放指令；Air quality 页面仅说明车辆尾气监测协作，无新重型发动机类别、功率带、数值和循环 | 四个 scope 均显式 no-data；不把一般环境法、环境空气/活动排放或尾气监测职责升级为发动机型式认证限值 | 已核验伊拉克环境部法规目录、第二页与 Air quality 页面（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 103 | JAM / on-road-truck·on-road-bus·construction·agriculture | Road Traffic Regulations 2022 Regulations 66–67 与 Eighth Schedule 管理车辆尾气/烟雾；heavy-duty vehicle/bus 数值只覆盖 1991–1998 model years，后续进口依赖原属地在用标准，且未给完整发动机认证循环 | 四个 scope 均显式 no-data；不把旧车型车辆表、进口/在用车检查或 recommended testing 泛化为当前新重型发动机型式认证限值 | 已核验并渲染主管部门条例 PDF pp.67–68、288–290，核对实施文件页（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 104 | LBN / on-road-truck·on-road-bus·construction·agriculture | Law 444/2002 Article 24 禁止机器、发动机和车辆超过国家环境质量标准；交通专题页只提供排放画像和减缓政策，均无新重型发动机类别、功率带、数值表或循环 | 四个 scope 均显式 no-data；不把一般标准委托、交通政策或固定源材料补成发动机型式认证表 | 已核验环境部 Law 444 正文与 Climate Change Lebanon transport 页面（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 105 | LBR / on-road-truck·on-road-bus·construction·agriculture | EPML Sections 36、70 委托 EPA 建立移动源标准与车辆检查/许可系统；2025 交通部公告只确认行政法规汇编涵盖检查和环境标准，未公开数值表 | 四个 scope 均显式 no-data；不补写法律委托但未读回的标准，也不从公告措辞推断发动机限值 | 已核验并渲染 EPA 法律 PDF pp.26、37，核对交通部法规汇编公告（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 106 | LBY / on-road-truck·on-road-bus·construction·agriculture | Environment Law No. 15 Articles 16–17 要求车辆许可前按主管标准测试发动机/燃料，Road Traffic Law No. 11/1984 Article 5 建立技术检查；公开正文均无重型发动机数值与循环 | 四个 scope 均显式 no-data；不把检查授权、后续标准或定性许可义务升级为发动机型式认证限值 | 已核验环境部 Law No. 15 与司法部 Road Traffic Law No. 11/1984 正文（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 107 | MLI / on-road-truck·on-road-bus·construction·agriculture | Arrêté 2020-1080 把 >3.5 t 车辆纳入技术检验并检查尾气/不透光度，Arrêté 00-2797 定性处罚过量烟雾和有害气体；均无新发动机污染物表、功率带或认证循环 | 四个 scope 均显式 no-data；不把在用车年检项目、设备要求或定性烟气违法换算为发动机型式认证限值 | 已核验 SGG 两份 J.O. 正文并渲染 2020 J.O. PDF pp.22–23（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 108 | MMR / on-road-truck·on-road-bus·construction·agriculture | Notification 615/2015 的数值适用于 EIA 项目和 >50 MW 固定热力源；MOTC 检查表的 `<50% Bosch unit` 是整车烟度项目，均非新发动机认证表 | 四个 scope 均显式 no-data；不把固定源限值、项目施工义务或在用车烟度检查升级为发动机型式认证限值 | 已核验 ECD/MOTC 材料并渲染排放指南 PDF pp.2、8、70（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 109 | MRT / on-road-truck·on-road-bus·construction·agriculture | Law 2018-002 覆盖车辆/发动机并规定维修、检查和处罚，但 Article 23 把技术环境标准留给实施文本；Environment Code Articles 31–34 同样只有后续法令授权 | 四个 scope 均显式 no-data；不补写框架法委托但未在已读官方正文中出现的发动机限值 | 已核验并渲染 Law 2018-002 扫描 PDF 全 8 页，核对 Environment Code（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 110 | NCL / on-road-truck·on-road-bus·construction·agriculture | Deliberation 219/2017 是环境空气监测框架；DITTT 页面只规定客运与 >3.5 t 车辆检查周期，均无发动机排放数值与认证循环 | 四个 scope 均显式 no-data；不把环境空气参考值或周期车辆检查转换为发动机限值，也不从法国/EU 外推 | 已核验并渲染 Juridoc JONC PDF，核对 DITTT 当前页面（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 111 | NER / on-road-truck·on-road-bus·construction·agriculture | Law No. 98-56 Articles 37–40 禁止超出实施文本限值的空气污染，并要求车辆遵守现行或后续技术标准；2016 国家环境政策只把汽车列为空气污染来源并确认具体措施有限，均无新重型发动机分类、功基准、数值表或认证循环 | 四个 scope 均显式 no-data；不把一般空气义务、后续标准授权或政策说明补写成发动机型式认证限值 | 已核验并渲染 Law No. 98-56 PDF pp.1、6，核对 Decree No. 2016-522 政策附件（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 112 | NIC / on-road-truck·on-road-bus·construction·agriculture | Consolidated Decree No. 32-97 Articles 22–23 对永久流通及 1999 年后进口柴油车辆规定自由加速不透光度，按 ≤/>3.5 t、自然吸气/涡轮和新旧/进口状态给出 60%–80% 阈值；Article 25 排除非道路农业与工程机械，Law No. 431 Articles 59–60 只建立车辆排放检查/证书制度 | 四个 scope 均显式 no-data；当前模型没有在用/进口、新旧与涡轮状态维度，不选取其中任一 opacity 值冒充新发动机认证限值，也不把排除的非道路设备纳入 | 已核验 National Assembly 两份现行合并正文及 Decree Articles 10–25、Law Articles 59–60（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 113 | PNG / on-road-truck | RTA Vehicle Standards and Compliance Rule Section 6A(4)(b) 要求 GVW >4,500 kg、2012 年起制造的柴油 motor truck 满足 ADR 80/03、Euro V、Japan 05 或 US 2004 任一替代标准；Section 64B 要求进口车辆认证，RTA 公告确认修订版 2019-01-01 生效 | 2018-12-31 无结果；2019-01-01 起仅发布 ADR 80/03 代表路径，ESC CO/THC/NOx/PM = 1.5/0.46/2.0/0.02，ETC CO/NMHC/NOx/PM = 4.0/0.55/2.0/0.03 g/kWh，共 8 条。替代路径不累计；on-road-bus、construction、agriculture 保持 no-data；结果必须保留 2012+ 车型边界说明 | 已核验并渲染 RTA PDF pp.1、4、11、44；ADR 80/03 数值沿用已签核澳大利亚政府汇总表（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 114 | PRI / on-road-truck·on-road-bus·construction·agriculture | DRNA Regulation 5300 Rule 403(B) 只规定柴油车辆静止时不得连续超过 5 秒排放 >20% opacity 可见污染物；DTOP Regulation 9526 管理官方检查站、周期车辆检查及机械/电气/气体系统诊断，均非新重型发动机型式认证表 | 四个 scope 均显式 no-data；不把静止车辆可见烟度或周期检查门槛映射为发动机认证限值，也不从美国联邦规则外推到波多黎各 | 已核验 DRNA Regulation 5300 Rule 403(B) 与 DTOP 9526；渲染 9526 PDF pp.1–3、37（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 115 | PRK / on-road-truck·on-road-bus·construction·agriculture | Environment Protection Law Articles 19、21 委托行政机关确定污染物标准，并禁止超过气体/烟雾标准的车辆运行；2016 INDC 只列法律框架、车辆燃油经济性和公共交通措施，均无新重型发动机分类、功率带、完整数值表或认证循环 | 四个 scope 均显式 no-data；纠正此前误指向韩国政府网站的来源，不把一般标准委托、车辆烟雾义务或减缓政策补成发动机型式认证限值 | 已核验并渲染 FAOLEX Environment Law PDF p.2 与 INDC pp.6–7（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 116 | PRY / on-road-truck·on-road-bus·construction·agriculture | Decree No. 1269/2019 Articles 5–6 要求 MADES 另定移动源参数并由市政检查车辆排气，Article 19 要求二手进口车通关前排放检查；MADES 规范目录只确认相关决议身份 | 四个 scope 均显式 no-data；不把在用车、市政或二手进口检查参数映射为新重型发动机认证表，也不从未读回的决议标题推断数值 | 已核验并渲染 MADES Decree PDF pp.3–4、8，核对官方规范目录（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 117 | PSE / on-road-truck·on-road-bus·construction·agriculture | Environment Law No. 7/1999 Articles 19、22 委托空气污染标准并禁止超过标准的机器、发动机和车辆排气；Traffic Law No. 5/2000 Articles 3、6、14 要求车辆符合巴勒斯坦规范并完成首次登记及续期技术检查，均无发动机污染物表 | 四个 scope 均显式 no-data；不把一般标准授权、整车规范或周期技术检查升级为新重型发动机型式认证限值 | 已核验 OGB 两份合并法律正文并渲染 Traffic Law PDF p.4（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 118 | SDN / on-road-truck·on-road-bus·construction·agriculture | Environment Protection Law 2001 Articles 18、20、24 只有一般空气保护、违法与后续污染控制标准授权；提交 UNFCCC 的 Third National Communication 记录车辆增长、城市空气污染和交通减缓措施，但未提供新重型发动机认证表 | 四个 scope 均显式 no-data；不把一般环境义务、计划性燃料切换/高效公交措施或排放清单背景转换为发动机限值 | 已核验 Sudan CHM 法律全文与 UNFCCC 第三次国家信息通报（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 119 | SLB / on-road-truck·on-road-bus·construction·agriculture | Road Transport Act (Cap. 131) 只按整车重量、载客用途等建立许可分类，并授权登记、检查及车辆安全状态管理；NDC 3.0 只给出高燃油效率车辆、电动车/公交和生物燃料车辆的气候行动与 KPI，均无新重型发动机分类、功率带、完整污染物表或认证循环 | 四个 scope 均显式 no-data；不把 `heavy goods/public service vehicle` 许可分类、在用车检查或 NDC 效率目标升级为发动机型式认证限值 | 已核验 Attorney-General's Chambers 现行 Road Transport Act 与 UNFCCC NDC 3.0（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 120 | SLE / on-road-truck·on-road-bus·construction·agriculture | 2024–2035 National e-Mobility Strategy 明确塞拉利昂不开展 type approval testing，只做目的地检查和出口 OEM 合格证明；其中 Euro IV/V/VI 是 `proposed` BAU/BTB 情景与空气污染建模假设，EPA Act 2022 也只授权后续制定污染标准 | 四个 scope 均显式 no-data；不把 Euro 情景、政策提案、目的地检查或一般法规授权标为已生效的新重型发动机认证要求 | 已核验并渲染 EPA Strategy PDF 印刷 pp.38–39、54，核对 Parliament EPA Act 2022（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 121 | SLV / on-road-truck·on-road-bus·construction·agriculture | RTS 13.01.02:23 自 2025-06-13 生效，但其柴油要求属于在用道路车辆自由加速 opacity 检查；§2.2 明确排除农业、工程及其他非道路机械，且正文未建立新重型发动机完整污染物表或认证循环 | 四个 scope 均显式 no-data；不把在用车不透光度检查转换为新发动机 `g/kWh` 限值，也不把已排除的工程/农业设备纳入 | 已核验 Diario Oficial 2024-06-13 正式文本与 OSARTEC 官方 RTS 说明（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 122 | SOM / on-road-truck·on-road-bus·construction·agriculture | Environmental Protection and Management Act Article 27 委托后续空气质量标准，Article 29 要求车辆及机械遵守未来建立或交通主管部门规定的排放标准；First BUR p.115 明确当时缺少运输政策，并仅把高效率发动机和 Euro IV–VI 列为未来政策方向 | 四个 scope 均显式 no-data；不把后续标准授权、一般禁止义务、排放清单或未来 Euro 政策方向升级为新发动机认证限值 | 已核验 MoECC 环境法与提交 UNFCCC 的 First BUR（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 123 | SSD / on-road-truck·on-road-bus·construction·agriculture | National Bureau of Standards Act 2012 只建立标准制定、合格评定及另行公告强制标准的通用程序；Second NDC Table 27 把车辆进口标准、车辆空气污染标准和尾气检测中心均标为 `Yet to be implemented` | 四个 scope 均显式 no-data；不把一般标准授权、未来进口政策或拟议在用车尾气检测升级为新重型发动机型式认证限值 | 已核验 SSNBS 法律正文 pp.7–9、13–15 与 UNFCCC Second NDC 印刷 p.118（PDF p.120）（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 124 | SUR / on-road-truck·on-road-bus·construction·agriculture | Milieu Raamwet (S.B. 2020 no. 97) Article 27 仅授权以后通过 `beschikking` 制定污染物、机器和其他技术标准；S.B. 2019 no. 35 p.53 只规定机动车复检场所的尾气抽排、CO meter 与设施条件 | 四个 scope 均显式 no-data；不把后续标准授权或在用车复检场所设备要求误作新发动机污染物表或认证循环 | 已核验 Staatsblad 两份正式文本及 Articles 27–28、§13.1.2(7)–(9)（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 125 | SYR / on-road-truck·on-road-bus·construction·agriculture | Law No. 12 of 2012 只有一般环境保护、EIA 和后续标准授权，Article 24 明确废止旧 Environment Law No. 50/2002；First NDC 只提出更新在用车技术检查、检测线及车队/进口政策，未给允许百分比、重型分类或发动机表 | 四个 scope 均显式 no-data；不把一般项目许可、已废止旧法、技术检查或气候车队计划升级为新发动机型式认证限值 | 已核验 Law No. 12/2012 pp.2–4、15–16 与 UNFCCC First NDC p.8（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 126 | TCD / on-road-truck·on-road-bus·construction·agriculture | Decree No. 904/2009 Article 144 把粉尘、烟气和有毒气体规则留给后续空气文本，Article 207 对车辆、装卸机械和工程机械的 homologation 只涉及噪声；First BUR 记录老旧车队、未来交通减缓与国家排放因子缺口 | 四个 scope 均显式 no-data；不把后续空气规则、噪声型式认可、排放清单因子或未来交通政策补写为柴油发动机污染物认证表 | 已核验环境部 Decree PDF pp.28、39 与 UNFCCC First BUR 印刷 pp.23、33、65（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 127 | TGO / on-road-truck·on-road-bus·construction·agriculture | Loi n° 2026-007 Articles 38、76–78、96、99–100 只规定以后以 decree/order/实施文本设定环境与车辆阈值，其中 Article 99 是流通中运输工具的定性禁止；Décret n° 2022-085/PR Articles 161–162 仅要求正常工作的静音排气装置并把污染排放细节交由后续跨部令，Article 2 又从 `automobile` 定义排除拖拉机、公共工程车辆及工业机械 | 四个 scope 均显式 no-data；不把一般环境授权、在用流通禁止、消声器义务或明确排除的非道路机械补成新重型发动机污染物表 | 已核验并渲染 Journal Officiel 两份正式 PDF 的关键页（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 128 | TLS / on-road-truck·on-road-bus·construction·agriculture | Decreto-Lei n.º 26/2012 Articles 14、23、33 要求国家以后发布环境质量/排放标准并作一般空气保护；Código da Estrada Article 73 只禁止流通车辆排放异常烟气，Articles 108–110 把车辆特征、车型批准与检查细节留给后续规则，均无新发动机限值表 | 四个 scope 均显式 no-data；不把一般排放标准授权、异常烟气违法、车型/登记/周期检查或农业与工业车辆定义升级为发动机认证限值 | 已核验并渲染 Jornal da República 两份正式 PDF 的 Articles 14、73、108–110（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 129 | TTO / on-road-truck·on-road-bus·construction·agriculture | Motor Vehicles and Road Traffic Act s.100(1)(q) 只授权以后制定 prescribed vehicle emissions，合并 Regulations 的年度检查、可见烟雾和 smoke-meter 条款均属在用车；Air Pollution Rules 2014 Rule 42 明确把车辆发动机用于动力的 operational release 排除于 Schedule 2 固定源限值表之外 | 四个 scope 均显式 no-data；不把 3,200 kg 在用车检查门槛、可见烟雾、检测设备或被 Rule 42 排除的固定源 `mg/Nm³` 表转换为新发动机限值 | 已核验并渲染 Digital Legislative Library 合并 Act 与 Air Pollution Rules PDF 的关键页（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 130 | TWN / on-road-truck·on-road-bus·construction·agriculture | 《移動污染源空氣污染物排放標準》第五條第六期适用于重型柴油及替代清洁燃料引擎汽车；2019-09-01 开始新阶段，但 2019-08-31 前取得合格证明函的既有重型柴油引擎车型可延续至 2021-08-31。当前模型自 2021-09-01 全覆盖边界起，为卡车、客车各保存 WHSC 6 条（CO 1500、THC 130、NOx 400、PM 10 mg/kWh、PN 8e11 #/kWh、NH3 10 ppm）、WHTC 6 条（4000、160、460、10、6e11、10）和 WNTE 4 条（CO 2000、THC 220、NOx 600、PM 16 mg/kWh） | 2021-08-31 不返回本代表 fixture；2021-09-01 起 on-road-truck/on-road-bus 各返回 16 条。只保存 WHSC/WHTC/WNTE 欧盟式代表路径，不与美国 FTP 替代路径累计；construction/agriculture 显式 no-data | 已核验并渲染环保部第五条 PDF pp.9–11 与重型引擎族审验附件（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 131 | VEN / on-road-truck·on-road-bus·construction·agriculture | Decreto Nº 2.673/1998 Article 7/Table 4 要求 MY2000 起进口或国内组装、最大整车重量 >3,500 kg 的柴油道路车辆按 Directive 91/542/EEC 欧洲循环满足 CO 4.5、HC 1.1、NOx 8.0、PM 0.36 g/kWh；最大功率 ≤85 kW 时 PM 乘 1.7 为 0.612 g/kWh。Article 11 将欧洲与美国重型瞬态路径定为替代循环；Article 24 排除工程、非道路采矿与农业设备。2015 Ley de Calidad de las Aguas y del Aire Article 62/过渡条款又将移动源限值交由 decree 并在新规章前保留不冲突的既有技术规则 | 1999-12-31 无结果；自归一化 MY2000 边界 `2000-01-01` 起，on-road-truck/on-road-bus 在 ≤85 kW 各返回 CO/HC/NOx/PM = 4.5/1.1/8.0/0.612，>85 kW 各返回 4.5/1.1/8.0/0.36 g/kWh。只发布欧洲代表路径，不与美国路径累计；construction/agriculture 显式 no-data | 已核验并渲染 Decreto PDF pp.7、10–12、17 及 2015 Law PDF pp.6、12（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 132 | VUT / on-road-truck·on-road-bus·construction·agriculture | Pollution (Control) Act No. 10 of 2013 p.12 §18 只要求车辆符合未在该法中定义的 `prescribed standards/limit`，p.16 §27 仅授权以后制定污染与燃油标准。2025 Import of Motor Vehicles (Control) Amendment Bill p.1 承认 Euro 4+ 政策当时尚无 Act 落实，p.5 也只写进口车辆应满足 `prescribed standards`；议会页面虽标为 Passed，但公开文本无 Act 号、总统 assent 或 Gazette 发布证据，p.4 §2 又规定仅在 Gazette 发布日生效 | 四个 scope 均显式 no-data；不把一般污染授权、未填充的 `prescribed standards`、政策 Euro 标签或仅通过议会的未编号 Bill 标成已生效的新重型发动机限值 | 已核验并渲染 Pollution Act PDF pp.2、12、16 与 2025 Bill pp.1、4–6，核对议会 Passed 状态（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 133 | YEM / on-road-truck·on-road-bus·construction·agriculture | Environmental Protection Law No. 26/1995 Articles 30–33 只要求主管机关以后制定车辆废气与燃料标准、另以决定发布并在 Official Gazette 公布，本法未给新重型发动机类别、功率带、完整污染物表或认证循环。Traffic Law No. 46/1991（合并至 Law No. 12/2002）Article 14 是登记与周期技术检查，Article 68(6) 只定性禁止车辆排放浓烟或恶臭 | 四个 scope 均显式 no-data；不把后续标准授权、登记/在用车检查或定性烟气义务升级为新发动机型式认证。当前官方法库收录只证明文本来源，不代表战后各控制区执法已经统一 | 已核验 Yemen Public Prosecution 官方法库两份合并正文及 Articles 30–33、14、68(6)（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 134 | ATA / on-road-truck·on-road-bus·construction·agriculture | Protocol on Environmental Protection to the Antarctic Treaty Articles 2–3 建立南极环境保护原则，Article 8 建立活动环境影响评估，Article 13 要求缔约方保证遵守；它是南极条约体系的国际环境治理边界，没有 ATA 国家司法辖区、新重型发动机分类、功率带、污染物限值表或认证循环 | 四个 scope 均显式 no-data；只发布 `AQ-BOUNDARY` 来源边界，不把缔约方国内法、基地运营要求或环评义务外推为 ATA 发动机规则 | 已核验并渲染 Antarctic Treaty Secretariat Protocol PDF pp.1–6、8–9（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 135 | ATF / on-road-truck·on-road-bus·construction·agriculture | Code de l'environnement Articles L640-1 à L640-5 只界定环境法典若干条款在法属南部和南极领地的适用与机构替换边界；已读回页面没有该领地独立的新重型道路/非道路柴油发动机分类、功率带、限值表、认证循环或实施日 | 四个 scope 均显式 no-data；只发布 `TF-BOUNDARY` 领土适用边界，不因法国主权或环境法典适用性条款而自动复制法国/EU 发动机限值 | 已核验 Légifrance 现行 Code de l'environnement L640-1–L640-5（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 136 | ESH / on-road-truck·on-road-bus·construction·agriculture | 联合国非自治领土页面确认 Western Sahara 的 NSGT/去殖民化地位，该页是司法管辖与治理边界证据，不是柴油发动机法规，也没有四个 scope 的完整限值或认证循环 | 四个 scope 均显式 no-data；只发布 `EH-BOUNDARY`，不将摩洛哥、西撒哈拉治理实体、西班牙或其他国家的规则归属到 ESH | 已核验 United Nations DPPA/Decolonization Western Sahara 页面（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 137 | FLK / on-road-truck·on-road-bus·construction·agriculture | Road Traffic (Provisional) Regulations Order 1986 Regulation 13 只要求机动车配置有效消声器，尽可能降低废气逸出噪声；Regulation 16 只是执照前/期间的危险或不适行车辆检查。表单中 C/C1 货车质量与 D/D1 客车座位分类是驾照/整车类别，不是新发动机排放分类；正文无污染物数值、功率带或认证循环 | 四个 scope 均显式 no-data；只发布 `FK-BOUNDARY` 属地法规边界，不把消声器、在用车安全检查或驾照分类升级为新重型发动机限值 | 已核验并渲染 Falkland Islands Legislation PDF pp.1–3、8–10、27（2026-08-10） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 138 | UKR / on-road-truck·on-road-bus·construction·agriculture | Law No. 2739-IV 对 8702/8704 道路客货车辆规定 2016-01-01 起至少 Euro V、2027-01-01 起至少 Euro VI；Order No. 521 Annex 2 item 52 为重型 M/N 车辆接受 UN R49-05 B2 / Directive 2005/55 B2 替代认证路径。当前只保存 Directive B2 压燃机代表路径：ESC/ELR CO 1.5、HC 0.46、NOx 2.0、PM 0.02 g/kWh、opacity 0.5 m⁻¹；ETC CO 4.0、NMHC 0.55、NOx 2.0、PM 0.03 g/kWh | 2015-12-31 无结果；2016-01-01 至 2026-12-31 on-road-truck/on-road-bus 各返回 9 条；2027-01-01 起该 Euro V 记录停止，完整乌克兰 Euro VI 技术实施链发布前失败关闭。替代路径不累计，construction/agriculture 显式 no-data | 已核验最高拉达现行 Law No. 2739-IV 与 Order No. 521/188 正文（`verifiedAt=2026-08-10T12:59:02Z`） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 139 | MDA / on-road-truck·on-road-bus·construction·agriculture | 摩尔多瓦政府 2026-07-01 公告说明首个统一道路车辆 type-approval 与 market-surveillance 体系仍为送交议会的 draft law；2026-07-17 Particip.gov.md 条目同样只是配套政府决定草案的启动咨询，均未形成已生效的新重型发动机类别、功率基准、完整污染物表、认证循环与实施日 | 四个 scope 均显式 no-data；不把政府批准草案、二级法规咨询、欧盟衔接方向或未来实施安排标为 effective regulation | 已核验政府公告与 Particip.gov.md 草案咨询条目（`verifiedAt=2026-08-10T13:04:28Z`） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 140 | THA / on-road-truck·on-road-bus·construction·agriculture | Royal Gazette 2023 Ministerial Regulation 自 2024-01-01 强制 TIS 3046-2563；该标准的国内 `Level 6` 明确对应 Euro V / UN R49-05，而非 Euro VI，覆盖 reference mass >2,610 kg 的 M1/M2/N1/N2 与全部 M3/N3。道路代表路径每 scope 9 条：ESC CO 1.5、HC 0.46、NOx 2.0、PM 0.02 g/kWh；ELR opacity 0.5 m⁻¹；ETC CO 4.0、NMHC 0.55、NOx 2.0、PM 0.03 g/kWh | 2023-12-31 无结果；2024-01-01 起 on-road-truck/on-road-bus 各返回 9 条。ETC THC 0.55 是 NMHC 0.55 的替代项，不累计；TIS 787-2551 只覆盖 ≤22 kW 小型农业/工业柴油机且仅给 Bosch 烟色要求，150 kW construction/agriculture 显式 no-data | 已核验并渲染 TIS 3046 正式全文与 Royal Gazette 强制令（`verifiedAt=2026-08-10T13:09:56Z`） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 141 | ALB / on-road-truck·on-road-bus·construction·agriculture | Law No. 10476/2011 的附件虽复制 Gothenburg Protocol 道路/非道路表，但义务以议定书对缔约方生效为前提；联合国条约状态未列 Albania 为缔约方。DCM No. 633/2018 只对 M1/M2/N1 进口/在用车辆给出 Euro 标签和检查安排，不含本项目所需的 N2/N3/M3 重型新发动机完整表与循环 | 四个 scope 均显式 no-data；不把未对 Albania 生效的条约附件、进口 Euro 标签、在用车检查或候选国身份升级为国内 effective engine regulation | 已核验 Official Gazette Law No. 10476 与 UN Treaty Collection 当前状态（`verifiedAt=2026-08-10T13:09:56Z`） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 142 | SRB / on-road-truck·on-road-bus·construction·agriculture | 现行 homologation rulebook 与道路车辆技术条件规则已从交通主管部门正式 PDF 读回；正文包含 UN R49/06 等引用及在用车技术条件，但未读回能把重型新车类别、完整污染物表和认证循环绑定到一个确定的全国全面实施日的条款 | 四个 scope 均显式 no-data；不从 R49/06 引用、合并规则版本、在用车条件、EU/UNECE 或邻国日期反推塞尔维亚 effectiveFrom | 已核验两份 Ministry of Construction, Transport and Infrastructure 正式文本（`verifiedAt=2026-08-10T13:09:56Z`） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 143 | BIH / on-road-truck·on-road-bus·construction·agriculture | 2019 minimum technical requirements decision 自 2019-06-01 要求新 M/N 车辆 homologation 采用 UNECE R49/06，2010 R49 order 建立国内型式批准链；当前为 reference mass >2,610 kg 的 M1/M2/N1/N2 与全部 M3/N3 保存 UN R49 Rev.6 WHSC 6 条、WHTC 6 条，每个道路 scope 共 12 条 | 2019-05-31 无结果；2019-06-01 起 on-road-truck/on-road-bus 各返回 12 条：WHSC CO/THC/NOx/PM/PN/NH3 = 1500/130/400/10/8e11/10，WHTC = 4000/160/460/10/6e11/10（除 NH3 ppm、PN #/kWh 外均 mg/kWh）。N3 SF 移动起重机的窄 R96 替代不得泛化，construction/agriculture no-data | 已核验波黑交通通信部 2019 Decision、2010 R49 order 与 UN R49 Rev.6（`verifiedAt=2026-08-10T13:09:56Z`） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 144 | MKD / on-road-truck·on-road-bus·construction·agriculture | 2009 新机动车批准规则将农业拖拉机、履带车辆、工程/矿场/港口/机场车辆及工作机械排除于道路批准范围；其重型道路条目只纳入 R49/03 与指令引用。独立农业拖拉机批准规则同样只引用指令/R96，未在已读正文中同时给出完整数值表、认证循环及可直接建模的现行阶段实施链 | 四个 scope 均显式 no-data；不从纳入引用、阶段标签、过渡日、一般 homologation 程序或 EU/UNECE 原文补齐北马其顿 engine limits | 已核验并渲染 Official Gazette 2009 道路与农业批准规则（`verifiedAt=2026-08-10T13:17:36Z`） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 145 | MNE / on-road-truck·on-road-bus·construction·agriculture | 黑山现行车辆技术要求附件及 2018 官方实施公告要求 2018-10-15 起首次进口/投放市场的新 M/N 车辆达到 EURO 6，并纳入 UN R49/06；国内 M/N 定义要求最大连续额定功率 >15 kW。当前只保存 UN R49 Rev.6 压燃机代表路径：WHSC 6 条、WHTC 6 条、WNTE 4 条，每道路 scope 共 16 条 | 2018-10-14 无结果；2018-10-15 起、P>15 kW 的 on-road-truck/on-road-bus 各返回 16 条；schema 以 `15.001 kW` 表示严格下界，15 kW 无结果。WHSC/WHTC/WNTE 数值同 UN R49 Rev.6，不累计 EU/UN 等效入口；未分阶段的 R96/04 引用与等待实施细则的 2026 homologation law 不足以建立 construction/agriculture 规则 | 已核验政府车辆要求、2018 实施公告与 UN R49 Rev.6（`verifiedAt=2026-08-10T13:17:36Z`） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 146 | NPL / on-road-truck·on-road-bus·construction·agriculture | Nepal Vehicle Pollution Standard 2082 自 2025-06-23 公报发布起适用于国内生产、组装和进口车辆；对 GVW >3,500 kg 的压燃式 M/N 车辆给出 WHSC 6 条、WHTC 6 条及 WNTE 4 条完整发动机测功机表，每道路 scope 共 16 条。§3 明确排除 tractor、power tiller、dozer、crane、roller、excavator 等非道路设备 | 2025-06-22 无结果；2025-06-23 起 on-road-truck/on-road-bus 各返回 16 条，数值同 UN R49 Rev.6 WHSC/WHTC/WNTE 路径；不虚构功率分档，measurement basis 保留 GVW >3,500 kg 与发布日前信用证/付款 grandfathering。construction/agriculture 显式 no-data | 已核验并渲染 Department of Printing 正式公报与 Department of Environment 官方副本（`verifiedAt=2026-08-10T13:22:24Z`） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 147 | ARM / on-road-truck·on-road-bus·construction·agriculture | ARLIS 现行合并 TR CU 018/2011 对重型 M/N 车辆实施生态等级 5，本库从 2019-01-01 只保存 UN R49-05 B2 压燃机道路代表路径，truck/bus 各 9 条；TR CU 031/2012 对农林拖拉机发动机给出 Stage IIIA 四个额定净功率带 | 2018-12-31 道路无结果，2019-01-01 起各 9 条；农业在 2025-10-01 以 150 kW 返回 CO/HC+NOx/PM = 3.5/4.0/0.2 g/kWh。法定 P>19、P≤560 以 `[19.001,37)`、`[37,75)`、`[75,130)`、`[130,560.001)` 建模；C/EEV、THC/NMHC 和条件性 NH3 不累计，construction no-data | 已核验 ARLIS 两份现行合并正文（`verifiedAt=2026-08-10T14:20:51Z`） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 148 | AZE / on-road-truck·on-road-bus·construction·agriculture | Cabinet Decision No. 2 从 2014-04-01 提出 Euro 4 门槛，但官方 PDF 没有完整的新重型车类别、污染物表和认证循环；现行 AZS 636:2025 公开页仅提供 M/N 标准元数据且明示非 reference standard | 四个 scope 均显式 no-data；不把 Euro 4 标签、标准目录或 ECE 96 可获性升级为新重型道路/非道路发动机限值 | 已核验 AZSTAND 正式 PDF 与 e-standard 现行元数据（`verifiedAt=2026-08-10T14:20:51Z`） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 149 | GEO / on-road-truck·on-road-bus·construction·agriculture | Matsne 现行 Resolution No. 238 自 2025-01-01 对 N3 卡车和 M3 客车实施 Euro V / UN R49-05 B2 路径，国内稳态/负荷响应/瞬态循环规范为 ESC/ELR/ETC，每个道路 scope 9 条 | 2024-12-31 无结果；2025-01-01 起 truck/bus 各返回 ESC CO/HC/NOx/PM = 1.5/0.46/2.0/0.02 g/kWh、ELR 0.5 m⁻¹、ETC CO/NMHC/NOx/PM = 4.0/0.55/2.0/0.03 g/kWh。不增加 PN、柴油 CH4 或旧 >2,610 kg 扩展，construction/agriculture no-data | 已核验 Matsne publication 12 与 MEPA 官方副本（`verifiedAt=2026-08-10T14:20:51Z`） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 150 | UZB / on-road-truck·on-road-bus·construction·agriculture | UzTR.10-006:2025 对农林车辆及机械的 H 带 130≤P≤560 kW 从 2025-10-01 实施 Stage IIIA；UzTR.237-016:2017 道路附件未闭合国内新造与普遍投放市场的环保等级实施日 | 2025-09-30 无当前 H 带结果；2025-10-01 起 agriculture 150 kW 返回 CO/HC+NOx/PM = 3.5/4.0/0.2 g/kWh，129.999 与 560.001 kW 无结果。短暂 Stage II 过渡和未定日 Stage V 不累计；两个道路 scope 与 construction no-data | 已核验 LEX.UZ 两份官方正文（`verifiedAt=2026-08-10T13:40:00Z`） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 151 | KAZ / on-road-truck·on-road-bus·construction·agriculture | Adilet 现行 TR CU 018/2011 从 2019-01-01 支持重型 M/N 生态等级 5 B2 道路代表路径，truck/bus 各 9 条；TR CU 031/2012 及 Decisions 127/2021、32/2024 为农林拖拉机建立四个 Stage IIIA 功率带 | 道路 2018-12-31 无结果、2019-01-01 起各 9 条；agriculture 在 2025-10-01 以 150 kW 返回 3.5/4.0/0.2 g/kWh。边界 `19/19.001/37/75/130/560/560.001` 得到 `0/3/3/3/3/3/0` 条；C/EEV 不累计，construction no-data | 已核验 Adilet 两份现行合并正文（`verifiedAt=2026-08-10T13:40:00Z`） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 152 | TJK / on-road-truck·on-road-bus·construction·agriculture | Law No. 1214 仅要求政府以后确定汽车运输生态安全限值和日期；`ST JT ____-2024` 发动机排放术语草案的编号、批准令和实施日仍留空，且没有完整限值表 | 四个 scope 均显式 no-data；不把后续授权或未批准草案升级为 effective regulation | 已核验国家立法中心正式法律与标准局草案（`verifiedAt=2026-08-10T13:40:00Z`） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 153 | KGZ / on-road-truck·on-road-bus·construction·agriculture | 经济和商业部实施公告与 EEC TR CU 018/2011 支持从 2019-01-01 发布重型 M/N B2 道路代表路径，truck/bus 各 9 条；TR CU 031/2012 为农林拖拉机建立四个 Stage IIIA 功率带 | 道路 2018-12-31 无结果、2019-01-01 起各 9 条；agriculture 在 2025-10-01 以 150 kW 返回 3.5/4.0/0.2 g/kWh，`19/19.001/37/75/130/560/560.001` 得到 `0/3/3/3/3/3/0`。C/EEV 不累计，construction no-data | 已核验国内实施公告与 EEC 现行正文（`verifiedAt=2026-08-10T13:40:00Z`） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 154 | TKM / on-road-truck·on-road-bus·construction·agriculture | 2016 年《大气空气保护法》Article 21 仅要求移动源符合另行确定的技术规范；TDS 1286-2019 只是汽油机 CO/HC 测量方法目录项 | 四个 scope 均显式 no-data；不把未取得的后续规范或汽油机测量方法转换为柴油发动机认证限值 | 已核验司法部法律正文与 Turkmenstandartlary 目录（`verifiedAt=2026-08-10T13:40:00Z`） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 155 | AFG / on-road-truck·on-road-bus·construction·agriculture | 2009 年《减少和防止空气污染条例》Article 6 及 2020 年修法要求过滤器、合格证与年度检查，但只引用未定义的 permitted limit，没有新重型发动机表或认证循环 | 四个 scope 均显式 no-data；不把定性排放义务、过滤器或年检升级为型式认证限值 | 已核验并渲染 NEPA 正式条例与修法 PDF（`verifiedAt=2026-08-10T14:35:00Z`） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 156 | AGO / on-road-truck·on-road-bus·construction·agriculture | Decreto Presidencial 185/13 Article 82 只是在用车不透光度检查；Decreto Presidencial 99/20 ES11.18 把公交/重型车 CO、THC、NOx、PM 规范列为国家环境标准化计划的后续制定任务 | 四个 scope 均显式 no-data；不把在用车 opacity 或未来标准工作项升级为已生效发动机法规 | 已核验并渲染两份 Diário da República PDF（`verifiedAt=2026-08-10T14:35:00Z`） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 157 | BDI / on-road-truck·on-road-bus·construction·agriculture | 2012 年道路交通法典 Articles 134–145 只有定性烟气义务与登记后周期检查；2025 年部门联合命令只确定已登记车辆技术检验服务的提供方式 | 四个 scope 均显式 no-data；不把定性烟气、登记或在用车检验转换为新发动机限值 | 已核验并渲染 BOB 与 2025 部门命令 PDF（`verifiedAt=2026-08-10T14:35:00Z`） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 158 | BEN / on-road-truck·on-road-bus·construction·agriculture | Décret 2001-110 Articles 8、13 虽包含 >2,720 kg 整车排放表，但新旧车条件混合且把检测方法留给后续命令，无新重型发动机类别与认证循环 | 四个 scope 均显式 no-data；不把整车/在用车表或未取得的后续检测命令拟合为新发动机法规 | 已核验 SGG 正文与官方文档库记录（`verifiedAt=2026-08-10T14:35:00Z`） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 159 | BFA / on-road-truck·on-road-bus·construction·agriculture | Décret 2001-185 的车辆表按车龄分类，未给出 PM、完整的新重型发动机分类与认证循环；环境部 NIES 项目文件只能证明该文书在国内合规评估中的引用 | 四个 scope 均显式 no-data；不把车龄表、缺项数值或项目级环评转换为发动机型式认证 | 已核验并渲染法令与政府 NIES PDF（`verifiedAt=2026-08-10T14:35:00Z`） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 160 | BGD / on-road-truck·on-road-bus·construction·agriculture | Air Pollution (Control) Rules, 2022 自 2022-07-26 立即生效；Schedule 2 对 GVW >3,500 kg 的新压燃式重型车辆引用 ECE 49 / Directive 88/77/EEC as amended by 91/542/EEC，CO/HC/NOx/PM = 4.0/1.1/7.0/0.15 g/kWh | 2022-07-25 无结果；2022-07-26 起 on-road-truck/on-road-bus 各返回 4 条。保留 GVW >3,500 kg 车辆类别边界，不从道路表外推 construction/agriculture | 已核验并渲染 Bangladesh Government Press 正式公报（`verifiedAt=2026-08-10T14:35:00Z`） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 161 | BHS / on-road-truck·on-road-bus·construction·agriculture | Road Traffic Act 只有烟气/气味和道路车辆适行性的定性义务；Environmental Planning and Protection Act, 2019 只建立污染许可、环境监管与未来标准制定授权 | 四个 scope 均显式 no-data；不把 smoke/smell、污染许可或尚未制定的标准升级为新重型发动机限值 | 已核验并渲染 Bahamas Statute Law 两份官方 PDF（`verifiedAt=2026-08-10T14:35:00Z`） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 162 | BLR / on-road-truck·on-road-bus·construction·agriculture | EEC 现行 TR CU 018/2011 从 2019-01-01 直接支持重型 M/N 生态等级 5 B2 道路代表路径，truck/bus 各 9 条；TR CU 031/2012 及现行修订为农林拖拉机建立四个 Stage IIIA 功率带 | 道路 2018-12-31 无结果、2019-01-01 起各 9 条；agriculture 在 2025-10-01 以 150 kW 返回 3.5/4.0/0.2 g/kWh，`19/19.001/37/75/130/560/560.001` 得到 `0/3/3/3/3/3/0`。C/EEV 不累计，construction no-data | 已核验 EEC 两份现行技术规则页（`verifiedAt=2026-08-10T14:20:51Z`） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 163 | BOL / on-road-truck·on-road-bus·construction·agriculture | Resolución Ministerial No. 064/2022 废止 RM 450 并重新发布 Annex III Table 4；对 >3,500 kg 的 N2/N3/M2/M3、MY2017+ 压燃式车辆给出 ECE 49 欧洲代表路径 CO/HC/NOx/PM = 4.0/1.1/7.0/0.15 g/kWh | 2022-03-31 无结果；2022-04-01 起 truck/bus 各返回 4 条。美国 HD transient 是替代路径而非累计要求；保留 >3,500 kg 与 MY2017+ 边界，税则中的 off-road dumper 不外推为一般 construction，agriculture no-data | 已核验并渲染 MOPSV RM 064/2022 与 IBMETRO 现行程序页（`verifiedAt=2026-08-10T14:35:00Z`） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 164 | MAR / on-road-truck·on-road-bus·construction·agriculture | Arrêté conjoint No. 2094.24 把 M2/M3/N1/N2/N3 Euro VI homologation 节点定为 2027-01-01、registration 节点定为 2028-01-01；本行当时未读回完整限值附件与认证循环，来源判断现由 #199 superseded | as-of 2026-08-10 四个 scope 均显式 no-data；不提前把 2027/2028 未来节点标为 effective | 已核验并渲染 Bulletin Officiel 与 SGG 观察矩阵（`verifiedAt=2026-08-10T14:35:00Z`；来源 currentness 见 #199） | Jamesky / 2026-08-10 继续补全国家信息指令 |
| 165 | KEN / on-road-truck·on-road-bus·construction·agriculture | Air Quality Regulations, 2024 Articles 24–29 将商用/公共车辆排放纳入周期检查并引用 KS 1515 / EAS 1047；本行原来源组合现由 #200 的 Kenya Law 最新合并文本与 Inspection Rules superseded | 四个 scope 均显式 no-data；不把在用车周期检查、注册前检查或未公开/付费标准升级为发动机型式认证限值 | 已核验并渲染（原核验时刻 `2026-08-10T14:35:00Z`；来源 currentness 见 #200） | Jamesky / 2026-08-10 继续补全国家信息指令 |

## 总签核

| 角色 | 结论 | 签名 | 日期 |
| --- | --- | --- | --- |
| 法规负责人（项目唯一负责人兼任） | **批准** #1–#264（限于各行已核验/间接核验、#166–#198 本地 accepted 数据纠错、#199–#243 source-currentness 纠错、#244–#247 数值完整性收口历史边界、#248–#259 十二国 source-currentness 收口、#260–#261 MLT/CHN 完整图及 #262–#264 ARE/CAN/USA 纠错范围），依据负责人 2026-07-30 书面授权“由 AI 调研与核验结果代替本人逐项签核”及持续补全国家法规指令；本签核不等同于 #166–#264 已生产发布 | Jamesky（授权记录于会话，见本单修订说明） | 2026-08-11 |
| 产品/销售负责人（会签，涉及时点与场景选择） | □ 确认 |  |  |

签核修订说明（2026-07-30）：负责人授权 AI 以已核验的官方来源链代替人工逐项
读回。批准范围限于核验状态为“已核验/间接核验”的条目；USA #4 的 §1039.101
Table 1 图片表格经 69 FR 38958 前言表格补证（NOx 0.40 / PM 0.02 / NMHC
0.19 g/kWh，130–560 kW，MY2014 后）。2026-07-30 限值读回并入库：DEU
Euro VI（595/2009 附件 I 经 582/2011 附件 XV 替换，CELLAR 官方文本）与
Stage V（2016/1628 附件 II 表 II-1）、BRA MAR-I（IBAMA 官方手册 p.310）。
2026-08-05 通过 Wayback 保存的 CONAMA 旧官方法规页/PDF与 Imprensa Nacional
官方 DOU 页面，分别读回 BRA P-7（#12）附件 I 和 P8 附件表 1 的压燃机限值，
并纳入确定性 fixture、历史切换测试与治理发布脚本。2026-08-06 用户要求优先
收集并填充国家排放法规；#14 当时仅将既有已签核
EU 法规扩展到地图可寻址的 26 个成员国，该历史边界现由 #260 supersede；未核验的
非 EU 法域仍不随之提升覆盖。#15 使用 e-Gov 与环境省官方文书读回日本道路/非道路限值；道路法规
因当前查询模型无 GVW 字段，采用 2018-10-01 全面适用日并显式保留分期警告。
2026-08-06 通过韩国国家法令信息中心现行《대기환경보전법 시행규칙》及附表 17
官方 PDF 读回 KOR 道路、工程机械、农业机械限值；道路使用 2017-10-01 条目，
非道路分别使用 2020-12-01 与 2021-07-01 条目，并保留 NH3 的尿素装置条件。

2026-08-06 通过墨西哥 DOF 原始 NOM-044 公告及 2020/2021 修订公告读回表 1B/2B；
按 2021 修订将 AA 过渡期延至 2024-12-31，模型以 2025-01-01 作为 B 标准全国
可执行日。表 1B（CT/CSE）与表 2B（CEEMAP/CETMAP）按替代认证路径分别保存，
不叠加解释；NOM-044 仅覆盖 GVW > 3,857 kg 新道路车辆，工程/农业非道路 scope
保持 no-data，不用邻国或道路标准推断。

2026-08-06 通过土耳其 Resmî Gazete 道路 Euro VI 公报及 2016/1628/AB NRE 公报正文、
附件第 4/8 页读回道路与工程机械限值；正文第 2 条第 2(b) 款明确排除 AB/167/2013
农林拖拉机发动机，农业 scope 保持 no-data，不用 NRE 或欧盟文本替代。官方农业与
林业部页面仅作为类型批准范围入口，不作为独立排放限值来源。

2026-08-06 通过 DITRDCSA 联邦 ADR 目录、Federal Register ADR 80/03 与 ADR 80/04、
官方柴油重型车辆标准汇总 PDF、ADR 80/04 官方问答及 DCCEEW 非道路柴油评估页面读回
AUS 道路限值与适用日期。ADR 80/03 以 2010-01-01 起、2024-11-01 止的当前模型历史
边界记录；ADR 80/04 只写入官方问答直接列出的 WHSC/WHTC NOx/PM，不从 EU/USA 文本
补充未直接读回的澳大利亚限值；DCCEEW 明确非道路柴油发动机暂无联邦排放法规，
construction/agriculture 保持 no-data。

2026-08-06 通过加拿大司法部 Justice Laws 官方页面读回 SOR/2003-2 第 16(2) 与
SOR/2020-258 第 10(1)(a)、第 79 条；道路以 2004-01-01 适用日、非道路以 2020-12-04
注册/采纳后六个月的 2021-06-04 生效日建模。道路只保留引用 40 CFR 86.11 的 2007+ 代表性 NOx/PM，非道路
只保留引用 40 CFR 1039.101 的 130≤P<560 kW Tier 4 NOx/PM/NMHC；二者分别映射道路
与工程/农业 scope，未核验列不扩展为加拿大事实。

2026-08-07 MoRTH 新版官方 API 与公报文件恢复可达后，重新纳入 IND #9–#11。
G.S.R. 889(E) p.29 的 BS VI WHSC/WHTC、G.S.R. 598(E) p.10/p.12 的 TREM/CEV
Table 1/2、G.S.R. 850(E) 的 2023-01-01 延期均已直接读回；G.S.R. 141(E) 的
2026-04-01 TREM-V 日期由 MoRTH 2026 官方说明引用。G.S.R. 151(E) 明文为 draft，
仅保存 proposed 状态，不用其拟议日期覆盖现行法规。fixture 测试覆盖道路生效日、
CEV-IV/V 与 TREM-IV/V 切换、15/45/560 kW 边界及草案排除。

2026-08-07 通过 EEC 官方 TR CU 018/2011、TR CU 031/2012 及 EAEU Decision
127/2021、32/2024 读回 RUS 道路 Class 5 与农业 Class 3A 限值。道路以全部车型
完成切换的 2019-01-01 作为保守统一边界；农业分别保存 2025-01-01 与
2025-10-01 切换日及严格功率端点。俄罗斯第 855 号政府令的排放技术条款已于
2025-06-30 失效，不扩展为通用限值；工程机械因无已核验独立限值保持 no-data。

2026-08-07 通过 KLHK 官方 JDIH 入口核对 IDN P.20/MENLHK/SETJEN/KUM.1/3/2017
的法规身份、M/N/O 道路车辆适用范围与 Euro 4 重型柴油机 ESC/ETC 限值；按印尼
柴油道路车辆全国实施节点 2022-04-01 建模。非道路工程机械与农业装备未取得可发布
的独立官方排放表，故在 fixture、治理脚本和验收测试中保持显式 no-data。

2026-08-07 的泰国来源入口/no-data 记录已由 #140 与 ADR-122 替代。现行 THA 使用
`TH-TISI` 辖区，并自 2024-01-01 发布 TIS 3046 道路 Level 6 代表限值；该旧段仅
保留历史验收轨迹，不再描述当前数据状态。

2026-08-07 通过越南政府电子信息门户读回 Decision 49/2011/QD-TTg 与 Circular
06/2021/TT-BGTVT，确认 Level 5 和 QCVN 109 自 2022-01-01 生效；政府签署附件
QCVN 表 4/5 与交通运输部 TBT 附件交叉核验了 ESC/ELR/ETC 重型柴油限值。
ETC 的 CH4 脚注明确只适用于天然气发动机，未写入柴油 fixture；QCVN 明确排除
非道路地形车辆，因此 construction/agriculture 保持 no-data。

2026-08-07 通过马来西亚 DOE 官方法规页/PDF 读回 P.U.(A) 429/96（含
P.U.(A) 488/2000 修订）道路范围，并从现行 VTA 门户公开链接的指南读回
2017-01-01 Euro II 重型柴油基线和 Table 7 限值。Euro IV 日期在指南中明确标为
tentative，且与 Euro 5 柴油供应宽限期并列，未创建 effective regulation；法规
regulation 5 只覆盖 intended for road use 的车辆，两个非道路 scope 保持 no-data。

2026-08-07 通过 Argentina.gob.ar/Infoleg 读回 Resolución 1464/2014 的 M2/M3/N1/
N2/N3 范围、2016 新车型和 2018 全部重型车辆节点，并从 Publications Office/CELLAR
官方 Directive 2005/55 PDF 读回 B2 ESC/ELR/ETC 数值。Resolución 128/2018 仅为
Ejército Argentino 特殊车辆 18 个月 Euro III 例外，不创建普通市场法规；C/EEV
作为替代路径不与 B2 叠加，工程机械和农业装备继续保持 no-data。

2026-08-07 通过 NZTA 现行合并规则读回 Rule 33001 的道路 entry certification
范围、tractor 排除、Euro VI Step C 定义及 Table 2B。Table 2B 自 2025-11-01
对新旧重型车辆统一列出 Euro VI、美国、日本、ADR 与 UNR 替代路径；本批只发布
已有官方限值来源链的 Euro VI Step C 代表路径，并保留 `or` 而非累计适用语义。
construction/agriculture 不从道路规则外推，继续保持 no-data。

2026-08-07 通过 LeyChile 读回智利 D.S. 50/2023、D.S. 39/2020 现行合并文本与
D.S. 33/2024。道路 D.S. 55 article 8 quáter 按现行版本 `2026-01-06` 建模，
Table 3 Euro VI 压燃机 WHSC/WHTC 共 12 条；US-EPA Table 1 保持替代路径。
一般移动机械按发布满 24 个月的 `2023-10-21`、19 <= P <= 560 kW 与 Table 2
五个功率带建模，Table 1 US 40 CFR 1039 不叠加。D.S. 33 排除其他农业机械，
tractor 只保存为 `2030-01-01` adopted 事实，不在 2026 effective 查询中返回。

2026-08-07 通过哥伦比亚 MinAmbiente 官方法规目录与签署 PDF 读回 Resolucion
0762/2022。Article 18 Table 22 道路重型柴油 WHSC/WHTC 从 `2023-01-01`
建模；EPA10 或更高标准保持替代路径。Article 50 规定自发布生效，官方目录日期为
`2022-07-18`，因此 article 19 的 24 个月非道路节点建模为 `2024-07-18`。
Table 23 EU 五功率带限制为 19 <= P <= 560 kW，Table 24 US 不叠加；article
3(c) 明确排除农业作业机械，agriculture 保持 no-data。

2026-08-08 通过 Gob.pe 官方法规页与 Diario Oficial El Peruano 公报读回秘鲁
D.S. 029-2021-MINAM。Article 2 替换 D.S. 010-2017-MINAM annex I.7，自
`2024-10-01` 对 PBV > 3.5 t 压燃式道路客货车辆实施 Euro VI/A WHSC/WHTC；
日期脚注对应提单日期。Annex I.9.1 的 EPA 2010 作为替代路径不叠加。
Construction/agriculture 不在国家道路运输系统机动车表的 scope 内，保持 no-data；
2026-10-01 协议升级期限尚未到达，不提前将 Euro VI/C 标为 effective。

2026-08-08 核对塞尔维亚官方法律信息系统车辆排放规则入口。搜索结果可定位到
官方《Правилник》文书，但正文请求在当前访问窗口返回连接关闭，未取得可发布的
重型道路/非道路 scope、限值或生效日期。SRB 仅登记 `RS-NATIONAL` 辖区与官方入口，
四个 scope 保持显式 no-data，不创建 regulation，不用 EU/UNECE、邻国日期或搜索
摘要补齐事实；待正文或官方镜像恢复后再按治理流程发布。

2026-08-08 核对波黑交通通信部官方门户和 UNECE 波黑空气质量管理评估。公开资料
仅提供车辆排放基线/政策背景，未读回可发布的国家重型道路或非道路柴油法规正文、
实施日期或限值表。BIH 仅登记 `BA-NATIONAL` 辖区与官方入口，四个 scope 保持显式
no-data，不从 UNECE 报告、EU/UNECE 标准入口或邻国日期补齐 effective 事实。

2026-08-08 核对北马其顿交通通信部官方门户和 UNECE 第三次环境绩效评估。资料仅
记录二手车 Euro-4/新车 Euro-5 政策背景，未读回可发布的国家重型道路或非道路柴油
法规正文、实施日期或限值表。MKD 仅登记 `MK-NATIONAL` 辖区与官方入口，四个 scope
保持显式 no-data，不从 UNECE 背景、EUR-Lex 通用文书或第三方进口说明推断。

2026-08-08 核对黑山政府交通门户及官方 ECMT `EURO VI safe` 配额指南。指南只证明
跨境运输配额/车辆资格要求，不是黑山国内重型柴油排放限值法规，也没有独立非道路
限值。MNE 仅登记 `ME-NATIONAL` 辖区和官方入口，四个 scope 保持显式 no-data，
不从配额资格、候选国身份、EU/UNECE 或气候政策文件推断 effective 事实。

2026-08-08 核对阿尔巴尼亚基础设施与能源部官方入口和 2030 国家交通战略。战略
提出加强车辆排放标准、实施欧洲标准和逐步更新 Euro VI 车队，但属于政策目标，未
提供已生效的重型道路/非道路柴油法规正文、实施日期或限值表。ALB 仅登记
`AL-NATIONAL` 辖区与官方入口，四个 scope 保持显式 no-data，不把战略、采购条件、
候选国身份或 EU/UNECE 标准升级为 effective 事实。

2026-08-08 核对乌克兰最高拉达官方法规数据库和第 2697-VIII 号国家环境政策战略。
法规库与战略只证明正式检索入口和环境政策方向，未读回可发布的重型道路/非道路柴油
法规正文、实施日期或限值表。UKR 仅登记 `UA-NATIONAL` 辖区与官方入口，四个 scope
保持显式 no-data，不从战略、EU/UNECE 通用标准或检索入口推断 effective 事实。

2026-08-08 核对摩尔多瓦 `Legis.md` 官方法规库和基础设施与区域发展部官方入口。
`Legis.md` 在当前核验窗口返回安全验证页；可见官方交通材料与搜索结果未提供可发布的
重型道路/非道路柴油法规正文、适用范围、实施日期或限值表。MDA 仅登记
`MD-NATIONAL` 辖区与两个官方入口，四个 scope 保持显式 no-data，不从欧盟衔接计划、
政策问卷、UNECE 文书或搜索摘要推断 effective 事实。

2026-08-08 核对尼泊尔官方公报《Vehicle Emission Standard 2025》条目与
Department of Transport Management 官方入口。公报条目可见，但下载端点在当前窗口被
客户端拦截，未读回重型道路/非道路柴油法规正文、适用范围、实施日期或限值表。NPL 仅
登记 `NP-NATIONAL` 辖区与两个官方入口，四个 scope 保持显式 no-data，不从新闻摘要、
旧版 Euro/Vehicle Mass 标准或搜索结果推断 effective 事实。

2026-08-08 核对格鲁吉亚 Matsne 官方法律公告系统与环境保护和农业部入口。Matsne
可完成 `emission vehicle` 空结果检索，但未读回可发布的重型道路/非道路柴油法规正文、
适用范围、实施日期或限值表。GEO 仅登记 `GE-NATIONAL` 辖区与两个官方入口，四个
scope 保持显式 no-data，不从候选国身份、区域报告或搜索摘要推断 effective 事实。

2026-08-08 核对亚美尼亚官方法律信息系统 ARLIS 与环境部官方入口。现有可见资料仅
提供 EAEU/Euro V 政策背景，未读回可发布的国内重型道路/非道路柴油法规正文、适用范围、
实施日期或限值表。ARM 仅登记 `AM-NATIONAL` 辖区与两个官方入口，四个 scope 保持
显式 no-data，不从 EAEU 成员身份、IEA/UNECE 背景或搜索摘要推断 effective 事实。

2026-08-08 核对阿塞拜疆 e-qanun 官方法律信息系统和生态与自然资源部官方入口。
法律系统连接在当前核验窗口关闭，未读回可发布的国内重型道路/非道路柴油法规正文、
适用范围、实施日期或限值表。AZE 仅登记 `AZ-NATIONAL` 辖区与两个官方入口，四个
scope 保持显式 no-data，不从 EAEU/Euro 背景、区域报告或搜索摘要推断 effective 事实。

2026-08-08 核对乌兹别克斯坦 LEX.UZ 国家法律数据库和国家生态与气候变化委员会入口。
LEX.UZ 使用 `avtomobil chiqindi` 的官方检索明确返回“未找到文件”，未读回可发布的
重型道路/非道路柴油法规正文、适用范围、实施日期或限值表。UZB 仅登记
`UZ-NATIONAL` 辖区与两个官方入口，四个 scope 保持显式 no-data，不从区域标准、政策
新闻或搜索空结果推断 effective 事实。

2026-08-08 核对哈萨克斯坦 Adilet 法律信息系统和生态与自然资源部入口。官方俄文检索
可见已失效的 2007 年车辆排放技术规章及地方监测规则，但未取得当前全国重型道路/非道路
柴油法规正文、适用范围、实施日期或限值表。KAZ 仅登记 `KZ-NATIONAL` 辖区与两个
官方入口，四个 scope 保持显式 no-data，不从已失效文书、EAEU 标准或地方规则推断
effective 事实。

2026-08-08 核对塔吉克斯坦国家法律中心 `mmk.tj` 和政府入口。法律中心车辆排放关键词
提交后返回 HTTP 500，未读回可发布的重型道路/非道路柴油法规正文、适用范围、实施日期
或限值表。TJK 仅登记 `TJ-NATIONAL` 辖区与两个官方入口，四个 scope 保持显式 no-data，
不从区域标准、政策材料或错误页面推断 effective 事实。

2026-08-08 核对吉尔吉斯斯坦司法部中央法律信息库和自然资源、生态与技术监督部入口。
官方数据库读回的《地面运输工具安全通用技术法规》（2009 年第 178 号）页面明确标注
2015-04-02 失效，且正文未给出当前重型柴油道路/非道路限值表。KGZ 仅登记
`KG-NATIONAL` 辖区与两个官方入口，四个 scope 保持显式 no-data，不把失效文书、EAEU
标准或搜索摘要升级为 effective 事实。

2026-08-09 复核 KHM、LAO、LKA、MNG 精确官方文书。柬埔寨 Prakas 的 UN R49
目录入口、老挝安全/环境合规义务和蒙古 MNS 5014 引用均缺少可直接入模的新发动机
数值或认证边界，继续 no-data。斯里兰卡 Gazette 2079/42 Third Schedule Tables 5–6
则直接给出道路重型与工程设备限值；2083/3 明确增加 Fifth Schedule 替代路径。本批
只发布 Third Schedule 代表路径，从 2018-08-06 起算，不把替代值累计，也不把
construction 外推到 agriculture。

2026-08-09 复核 CRI、ECU、DOM、DZA。Costa Rica 现行 Decree 39724 与 Law 9078
只支持轻型入境/在用车边界并排除非道路机械；Ecuador RTE 017 把柴油数值引用到未
公开的 NTE 2207，且明文排除工程/农业设备；Dominican Republic 2017 法规明确是
在用车辆。三国均只升级精确来源并保持四 scope no-data。Algeria JORADP Decree
03-410 则把一致性控制与定期检查分栏，完整给出道路重型、农业和公共工程机械车辆级
`g/km` 与 `m-1` 数值；本批发布 28 条一致性限值，不补写测试循环、不换算为 Euro，
并以 ONEDD 当前法规索引复核来源状态。

2026-08-10 复核 TUN 精确官方目录。环境部污染与危害防治分类仅见 1984 年车辆定点
噪声检查等条目；交通部道路运输法规目录列出的经营、许可、车辆使用和行业组织文书
均未提供重型柴油新发动机法规、认证循环或污染物限值。TUN 升级两个精确来源，四个
scope 继续 no-data；核验时间使用实际读取时刻，不再使用未来占位时间。

2026-08-10 完成 ETH/GTM/HND/PAN/URY 精确来源复核。ETH 只发布 ES 6725:2022
Table 1 中无歧义的 N2/N3 CO/NOx/PM 三项，冲突的 0.46 列不猜写；URY 按 Decreto
135/021 Table 17 为卡车和客车分别保存 ESC/ETC 共 18 条，并用官方 homologation
procedure 锁定 2023-05-14 实施日。GTM 的 2027 计划、HND 的后续授权/固定源排除、
PAN 的在用车年检均不足以建立新发动机法规，四 scope 保持 no-data。五国来源与记录
统一使用 2026-08-10T03:14:01Z 的实际核验时刻。

2026-08-10 完成 ZMB/ZWE/RWA/CIV 精确来源复核。ZMB 的 S.I. 112/2013 是固定源/
工艺许可，RTSA 法案只提供道路烟雾授权；ZWE 的设施发电机许可与 S.I. 129/2015
道路车辆条款都没有公开所引用 SAZ 数值。RWA 已采用 RS EAS 1047:2022，但标准正文
付费且公开执法材料属于在用车检查；CIV 的 Décret 2017-125 确有燃烧发动机范围，
官方可读材料仍没有完整新发动机表，NI 505:2025 又明确是周期检验。四国只升级精确
来源，四 scope 保持 no-data，统一使用 `2026-08-10T04:06:07Z` 实际核验时刻。

2026-08-10 完成 CAF/COD/COG/CUB 精确来源复核。CAF 只取得项目级柴油烟雾维护措施；
COD/COG 环境法和技术检验令/公报均停留在定性空气义务、后续授权或在用车周期检查；
CUB Law 109 与补充规则明确检查尾气污染物和柴油不透光度，但参数仍依赖另行规范，
未公开可直接建模的新重型发动机完整表。四国只升级八个精确来源，四 scope 保持
no-data，统一使用 `2026-08-10T05:38:27Z` 实际核验时刻。

2026-08-10 完成 DJI/ERI/GAB/GIN 精确来源复核。DJI 官方公报把尾气/烟度纳入车辆
技术检验；ERI 环境公告委托排放标准且政府材料只确认年度车辆检查；GAB 环境法把
阈值留给实施规章，交通令属于周期适行性检查；GIN 环境法典把车辆排放限值留给规章，
交通部材料只确认技术检验数字化。四国都没有可直接建模的新重型发动机完整分类、功率
基准、污染物表和认证循环，故只升级八个精确来源并保持四 scope no-data，统一使用
`2026-08-10T06:21:10Z` 实际核验时刻。

2026-08-10 完成 GMB/GNB/GNQ/GRL 精确来源复核。GMB 法规数值属于环境空气浓度且
内阁车辆检验方案仍要求磋商；GNB 环境基本法把空气排放交由专门立法，当前交通部页面
只确认职责；GNQ 只确认环境法身份和 ITV 在用车污染控制，2025 材料明确重型诊断线
未运行且当时只做目视检查；GRL 现行车辆设备令与道路交通法只提供设备/检验框架及
定性烟气义务。四国都没有可直接建模的新重型发动机完整分类、功基准、污染物表和
认证循环，故只升级八个精确来源并保持四 scope no-data，统一使用
`2026-08-10T06:44:56Z` 实际核验时刻。

2026-08-10 完成 GUY/HTI/IRN/IRQ 精确来源复核。GUY 车辆排放标准仍由环境机构后续
建立，车辆法只提供适行证和烟雾规则授权；HTI 是一般环境框架与进口前技术检查；IRN
清洁空气法和 2024 修订涵盖车辆排放；该批当时未完整读回 Article 4 日程，现由 #205
确认日程可读并替换为合并条例双源；IRQ 当时只读到一般环境材料，现由 #206 替换为
COSQC TR 167 amendment 决定与 INA / Ministry of Trade 实施公告。
四国都没有可直接建模的新重型发动机完整分类、功基准、污染物表和认证循环，故只升级
八个精确来源并保持四 scope no-data，统一使用 `2026-08-10T07:34:48Z` 实际核验时刻。

2026-08-10 完成 JAM/LBN/LBR/LBY 精确来源复核。JAM 现行条例的重型车辆/客车表只
覆盖 1991–1998 车型并依赖进口/在用车边界，不能适配当前无 model-year 维度的新发动机
查询；LBN Law 444 只委托国家环境质量标准，交通页是排放画像/减缓政策；LBR EPML
委托 EPA 建立移动源标准与检查制度，交通公告未公开数值；LBY 两部法律只建立测试、
许可和技术检查框架。四国均缺少可直接建模的新重型发动机完整分类、功基准与认证循环，
故只升级八个精确来源并保持四 scope no-data，统一使用
`2026-08-10T07:58:42Z` 实际核验时刻。

2026-08-10 完成 MLI/MMR/MRT/NCL 精确来源复核。MLI 的技术检验和烟气违法条款属于
在用车/定性义务；MMR 的数值分别属于 EIA 项目固定源与整车 Bosch 烟度检查；MRT 的
空气污染法和环境法典覆盖车辆/发动机，但把具体标准留给实施文本；NCL 是环境空气监测
和周期车辆检查，且不能从法国/EU 外推。四国都没有可直接建模的新重型发动机完整分类、
功基准、污染物表和认证循环，故只升级八个精确来源并保持四 scope no-data，统一使用
`2026-08-10T08:31:37Z` 实际核验时刻。

2026-08-10 完成 NER/NIC/PNG/PRI 精确来源复核。NER Law 98-56 只委托后续车辆技术
标准，国家环境政策没有发动机表；NIC Decree 32-97 的 60%–80% 数值属于按车辆状态
区分的自由加速烟度，Law 431 是在用车检查/证书制度；PRI Regulation 5300 的 20%
opacity 是静止车辆可见烟度，Regulation 9526 是周期车辆检查。三者均保持四 scope
no-data。PNG RTA Rule 则明确 GVW >4,500 kg、2012 年起制造的柴油 motor truck 可走
ADR 80/03 / Euro V / Japan 05 / US 2004 替代路径；本批只发布 ADR 80/03 代表路径 8 条，
不叠加替代标准，也不外推到客车、工程或农业。四国统一使用
`2026-08-10T09:11:38Z` 实际核验时刻。

2026-08-10 完成 PRK/PRY/PSE/SDN 精确来源复核。PRK/PSE 环境法只委托污染物标准并
规定车辆排气义务，PRY Decree 1269/2019 与规范目录属于移动源、市政和二手进口检查，
SDN Environment Protection Law 2001 只有一般空气保护与后续标准授权，UNFCCC 国家
信息通报仅提供交通排放背景与减缓措施。四国都没有可直接建模的新重型发动机完整分类、
功基准、污染物表和认证循环，故只升级八个精确来源并保持四 scope no-data；同时纠正
PRK 误指向韩国政府网站的来源，统一使用 `2026-08-10T09:48:06Z` 实际核验时刻。

2026-08-10 完成 SLB/SLE/SLV/SOM 精确来源复核。SLB Road Transport Act 只有整车许可、
检查和安全状态管理，NDC 3.0 只有效率车辆与低碳交通 KPI；SLE 官方战略明确不开展
type approval testing，并把 Euro IV/V/VI 写成提案和情景假设；SLV RTS 13.01.02:23
属于在用道路车辆 opacity 检查且明确排除农业、工程及非道路机械；SOM 环境法只委托
后续标准，First BUR 也只把高效率发动机和 Euro IV–VI 列为未来政策方向。四国都缺少
可直接建模的新重型发动机完整分类、功基准、污染物表和认证循环，故用八个精确来源
替换 generic 占位并保持四 scope no-data，统一使用 `2026-08-10T10:20:51Z` 实际核验时刻。

2026-08-10 完成 SSD/SUR/SYR/TCD 精确来源复核。SSD 标准局法只建立另行声明标准的
一般程序，Second NDC 把车辆排放标准和尾气检测标为尚未实施；SUR 环境框架法把具体
标准留给后续 `beschikking`，复检场所规则只涉及尾气抽排和检测设施；SYR Law 12/2012
只提供一般环境、EIA 与后续标准授权并废止旧法，First NDC 只有技术检查和车队计划；
TCD Decree 904 把空气规则留给后续文本且工程机械 homologation 只涉及噪声，First BUR
只有老旧车队、未来减缓与排放清单缺口。四国均缺少新重型发动机完整分类、功基准、
污染物表和认证循环，故用八个精确来源替换 generic 占位并保持四 scope no-data，统一
使用 `2026-08-10T10:54:10Z` 实际核验时刻。

2026-08-10 完成 TGO/TLS/TTO/TWN 精确来源复核。TGO 环境框架修法与道路实施令只有
后续阈值授权、在用流通禁止和消声器义务；TLS 环境法只要求以后发布标准，道路法只有
异常烟气禁止、车型批准和检查框架；TTO 道路法只有后续授权和在用车检查，Air
Pollution Rules 又明确排除车辆动力排放，三国四 scope 均保持 no-data。TWN 第五条则
读回第六期重型柴油道路 WHSC/WHTC/WNTE 完整表；法定阶段 2019-09-01 开始，但既有
重型引擎族宽限至 2021-08-31，故当前模型从 2021-09-01 全覆盖边界为卡车、客车各发布
 欧盟式代表路径 16 条，不累计美国 FTP 替代路径，工程与农业保持 no-data。四国统一使用
`2026-08-10T11:21:32Z` 实际核验时刻。

2026-08-10 完成 VEN/VUT/YEM/ATA/ATF/ESH/FLK 精确来源复核。VEN Decreto
Nº 2.673/1998 为 MY2000 起、>3,500 kg 重型柴油道路车辆给出 Directive 91/542/EEC
代表路径 CO/HC/NOx/PM 完整表；≤85 kW 的 PM 为 0.612、>85 kW 为 0.36 g/kWh，
美国瞬态路径是替代路径而非累计路径，Article 24 排除工程、非道路采矿及农业机械。
VUT 只有未填充的 `prescribed standards` 和缺少 Act 号/assent/Gazette 证据的 Passed Bill；
YEM 只有后续标准授权、登记/周期检查与定性烟气义务；ATA/ATF/ESH/FLK 分别只建立
条约、领土适用、NSGT 或属地道路法规边界。因此六个 source-only 条目四 scope 保持
no-data，本批十条 source 统一使用 `2026-08-10T11:58:54Z` 实际核验时刻。

2026-08-10 完成 UKR/MDA/THA/ALB/SRB/BIH/MKD/MNE/NPL 深化复核并签核 #138–#146。
UKR 只在 2016-01-01 至 2027-01-01 半开区间发布 Euro V B2 道路代表路径，Euro VI
完整国内技术链缺失时失败关闭；MDA 两条材料均为 draft/consultation。THA 自
2024-01-01 发布 TIS 3046 道路 9 条且国内 Level 6 不误标 Euro VI；BIH 自
2019-06-01 发布 R49/06 道路 12 条；MNE 自 2018-10-15 对 >15 kW 道路车辆发布
R49/06 WHSC/WHTC/WNTE 16 条；NPL 自 2025-06-23 对 GVW >3,500 kg 道路车辆发布
16 条并遵守非道路明文排除。ALB、SRB、MKD 均因条约未生效、缺少全国全面实施日或
只有不完整纳入引用而保持四 scope no-data。各国使用 #138–#146 所列实际核验时刻。

2026-08-10 完成 ARM/AZE/GEO/UZB/KAZ/TJK/KGZ/TKM/AFG/AGO/BDI/BEN/BFA/
BGD/BHS/BLR/BOL/MAR/KEN 最终批次复核并签核 #147–#165。ARM、BLR、KAZ、
KGZ 发布 B2 道路各 9 条和农业 Stage IIIA 四功率带；GEO 发布 N3/M3
道路各 9 条；UZB 只发布农业 H 带 3 条；BGD/BOL 发布 GVW >3,500 kg
道路各 4 条。代表/替代路径不累计，严格保留功率与车辆类别边界。其余条目因为
未来实施日、在用车检验、后续授权、不完整/付费标准或缺少闭合实施链而保持
对应 scope no-data；`covered` 状态不得用于补全这些空 scope。

2026-08-10 已完成上述 19 国的生产定向治理发布与公网读回。最终发布图包含
20 个 jurisdiction、12 个 regulation、157 条 limit 与 40 个
精确来源，公开总表为 175 `covered` / 0 `no_data`。共享 EAEU 法域在每次定向发布时
保留全部五个成员，ARM/KGZ 成员起点分别为 2015-01-02 与 2015-08-12。

签核完成后，研发已在 `tests/` 增加对应确定性 fixture（引用本单编号），并把
`SOURCES.md` 中已签核来源纳入 M3 真实数据入库计划（后台治理流程发布）。#9–#11、
#17–#37 已完成本地 fixture、边界测试与治理脚本验收；#147–#165 已完成
fixture 收口、19 次生产定向发布、治理读回与公网 API/页面验收。

## 2026-08-11 数据纠错与稳定国家批次（#166–#198）

以下是 accepted fixture 的当前事实快照；已随 release `20260812031745` 完成生产发布。
表格“核验状态”保留签核发生时的审计文字，其中“待部署”统一由本段发布结果 supersede。
旧行若与本节冲突，以本节和当前 fixture/tests 为准，并在历史记录中视为 superseded。

| # | 国家 / scope | 当前事实 | 期望确定性结果 | 核验状态 |
| --- | --- | --- | --- | --- |
| 166 | CRI / 四 scope | 在用车/交通法规，未闭合新发动机五门槛 | 四 scope no-data | 本地 accepted，待部署 |
| 167 | ECU / 卡车·客车 | RTE INEN 017 / NTE 2207 ECE-49；>3,500 kg；2009-02-07 | 各 4 条 CO/HC/NOx/PM；工程/农业 no-data | 本地 accepted，待部署 |
| 168 | PAN / 四 scope | 车辆排放/电动交通文书未建立新发动机认证表 | 四 scope no-data | 本地 accepted，待部署 |
| 169 | DOM / 四 scope | 移动源法规与咨询材料属于在用/政策边界 | 四 scope no-data | 本地 accepted，待部署 |
| 170 | PHL / 卡车·客车 | DAO 2015-04 / LTO MC；Euro IV、UN R49-04；2016-01-01 | ESC/ELR/ETC 各 9 条；非道路 no-data | 本地 accepted，待部署 |
| 171 | PAK / 卡车·客车 | S.R.O. 72(KE)/2009 Annex III(b)；ECE-R-49；2012-07-01 | 各 4 条 CO/HC/NOx/PM；非道路 no-data | 本地 accepted，待部署 |
| 172 | SAU / 卡车·客车 | MY2026 GSO 技术法规清单闭合 Euro V 实施链 | ESC/ELR/ETC 各 9 条；非道路 no-data | 本地 accepted，待部署 |
| 173 | ARE / 卡车·客车 | MOIAT 新车型重型 Euro VI/B 指南（总则最低等级措辞为 Euro 6B）；2026-01-01 | WHSC/WHTC 各 12 条；非道路 no-data | 历史边界；2026-01-01 不能作为通用 numeric 日期，已由 #262 / ADR-136 supersede |
| 174 | ISR / 道路·工程 | CY2026 IMR 纳入 EU WVTA / Stage V | 道路各 12 条、工程 28 条、农业 no-data | 本地 accepted，待部署 |
| 175 | ZAF / 卡车·客车 | Notices 611/613 的 SANS/ECE R49.02B 实施链 | 各 4 条；非道路 no-data | 本地 accepted，待部署 |
| 176 | EGY / 四 scope | Decision 710/2012 Annex 6 已读回为怠速 CO/HC 与 ISO 11614 烟度/不透光度在用检查，未闭合新发动机表与认证循环 | 四 scope no-data | 本地 accepted，待部署 |
| 177 | GHA / 四 scope | Act 1124 / GS 1219 未闭合型式认证实施链 | 四 scope no-data | 本地 accepted，待部署 |
| 178 | KEN / 四 scope | Air Quality / Inspection Rules 属排放与检查边界 | 四 scope no-data | 本地 accepted，待部署 |
| 179 | RWA / 卡车·客车 | RS EAS 1047:2022 的 Euro IV 实施桥接；2023-01-23 | ESC/ELR/ETC 各 9 条；非道路 no-data | 本地 accepted，待部署 |
| 180 | TZA / 四 scope | 空气质量法规未闭合新发动机认证表 | 四 scope no-data | 本地 accepted，待部署 |
| 181 | ZMB / 四 scope | 固定源许可/标准目录未闭合移动新发动机表 | 四 scope no-data | 本地 accepted，待部署 |
| 182 | ZWE / 四 scope | 环境法/设施许可未公开 SAZ 新发动机表 | 四 scope no-data | 本地 accepted，待部署 |
| 183 | CIV / 四 scope | 空气法与 N2/N3 标准草案/周期检查未闭合 | 四 scope no-data | 本地 accepted，待部署 |
| 184 | DZA / 四 scope | 旧车辆级数值不满足新发动机五门槛 | 四 scope no-data；归档旧法规/限值 | 本地 accepted，待部署 |
| 185 | TUN / 四 scope | 车辆设备/道路法未给新发动机完整表与循环 | 四 scope no-data | 本地 accepted，待部署 |
| 186 | ETH / 四 scope | 旧 Directive / ES 6725 结论未闭合完整污染物与类别 | 四 scope no-data；归档旧法规/限值 | 本地 accepted，待部署 |
| 187 | CMR / 四 scope | NC 2858 / 空气保护令未闭合新发动机认证表 | 四 scope no-data | 本地 accepted，待部署 |
| 188 | SEN / 四 scope | 标准目录/道路法仅给标准与在用检查边界 | 四 scope no-data | 本地 accepted，待部署 |
| 189 | NGA / 四 scope | Schedule VIII 的 PM `0.10/0.13` 无可选择限定且无法定认证循环 | 四 scope no-data；归档旧法规/6 条限值 | 本地 accepted，待部署 |
| 190 | UGA / 四 scope | S.I. 22/2024 有效 metadata；Schedule 4 `kg/kWh` 与类别冲突 | 有效 regulation、0 limits、四 scope no-data | 本地 accepted，待部署 |
| 191 | BWA / 四 scope | BOS 134 为自愿在用车 code；标准目录无强制纳入 | 四 scope no-data | 本地 accepted，待部署 |
| 192 | NAM / 四 scope | Standards Act / 2013 Regulations 未指定强制排放标准 | 四 scope no-data | 本地 accepted，待部署 |
| 193 | SWZ / 四 scope | Air Pollution / roadworthiness 为固定源或在用边界 | 四 scope no-data | 本地 accepted，待部署 |
| 194 | KHM / 四 scope | Prakas No. 150 只列 CTR 142:2016 / CS 535:2016（UN R49）入口，Sub-Decree No. 042 是在用车黑烟边界；未闭合修订系列、完整数值表、认证循环与实施分期 | `2026-08-10` membership；四 scope no-data | 本地 accepted，待部署 |
| 195 | LAO / 四 scope | Law on Inland Vehicles No. 04/NA 与 No. 4312/MCTPC 要求环境/技术检查和进口技术证明，但未给出新重型柴油发动机的完整法定认证表 | `2026-08-10` membership；四 scope no-data | 本地 accepted，待部署 |
| 196 | LKA / 卡车·客车·工程·农业 | Gazette 2079/42 Third Schedule Table 5 给出 GVW > 3,500 kg 道路重型 5 项，Table 6 给出工程设备六功率带各 4 项；2079/70 闭合 `2018-07-13` 实施日，同时 clause 8 允许 2018-07-12 及以前开立信用证的车辆在 2018-10-31 前按过渡豁免进口 | 34 limits = 卡车 5 + 客车 5 + 工程 24 + 农业 0；C1/D2 及 Third/Fifth Schedule 是替代路径，不累计；每条 measurement basis 保留信用证 grandfathering | 本地 accepted，待部署 |
| 197 | MMR / 四 scope | Notification No. 615/2015 数值面向 EIA/固定源；Road Safety and Motor Vehicle Management Law No. 6/2020 建立车辆管理与检查边界，不提供新发动机认证表 | `2026-08-10` membership；四 scope no-data | 本地 accepted，待部署 |
| 198 | MNG / 四 scope | Air Quality Technical Regulation / Government Resolution No. 148 引用车辆烟度标准，但公开正文未闭合新重型发动机类别、数值表、循环和实施边界 | `2026-08-10` membership；四 scope no-data | 本地 accepted，待部署 |

## 2026-08-11 MAR/KEN source-currentness 纠错（#199–#200）

本节只替换/刷新来源证据，不新增、删除或修改 regulation/limit，不改变稳定 33 国口径。
两国仍须各自定向发布并完成目标库、公开 API/页面读回后，方可声称 source refresh 已部署。

| # | 国家 / scope | 当前事实 | 期望确定性结果 | 核验状态 |
| --- | --- | --- | --- | --- |
| 199 | MAR / 四 scope | BO n°7028 的 Arrêté conjoint n°2251-21 已在 printed pp.1955–1957 公开 M2/M3/N2/N3 等重型道路类别的完整 WHSC/WHTC CO/THC/NOx/PM/PN/NH3 表及循环；BO n°7361 的 Arrêté conjoint n°2094.24 又把 M2/M3/N1/N2/N3 homologation 与 registration 分别推迟到 2027-01-01、2028-01-01。非道路 2836-10/3400-12 公报仍未公开原件所附功率表和循环 | 截至本轮 truck/bus 因实施日仍在未来而 no-data；construction/agriculture 因完整表和认证循环未闭合而 no-data；四 scope 均不新增 limit | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T18:48:04Z`） |
| 200 | KEN / 四 scope | LN 180/2024 最新官方合并表达式为 `eng@2025-03-24`；printed pp.10–11 仍规定商用/公共车辆周期排放检查并引用 KS 1515/EAS 1047。LN 13/2026 自 2026-07-01 实施的注册前/周期检验仍是 vehicle inspection，不是新发动机型式认证 | 四 scope no-data；不得把在用/注册前检查或未公开/付费标准升级为新重型发动机数值 fixture | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T18:48:04Z`） |

在追加下节前，#1–#200 已完成阶段小计签核；其中 #166–#198 已完成本地 accepted
数据纠错总签核，#199–#200 已完成 MAR/KEN source-only currentness 总签核。五国新增来源的
`verifiedAt` 仍为 `2026-08-10T17:38:18Z`；MAR/KEN 本次来源复核统一为
`2026-08-10T18:48:04Z`。本次签核不表示已发布到生产数据库或公开站。

## 2026-08-11 QAT/KWT/OMN/JOR source-currentness 纠错（#201–#204）

本节 supersede 历史 #49–#52 的旧 portal/source 组合，只刷新八条 source identity、
record timestamps 和证据边界，不新增 regulation/limit，也不改变稳定 33 国或 limits
总数。四国共 16 个 scope 均须返回空集，每国零 regulation/limits；完成四次定向发布及
目标库、公开 API/页面读回前不得声称已部署。

| # | 国家 / scope | 当前事实 | 期望确定性结果 | 核验状态 |
| --- | --- | --- | --- | --- |
| 201 | QAT / 四 scope | MOT 2023 款 EURO5-equivalent 公告是燃油/进口政策；Decision 125/2019 采用 QS GSO 144/145/146:1991，但未闭合当前新重型类别/功率、完整表、循环和 Euro V 国内实施日。GSO MY2026-D5 的 Qatar `Euro5` 标签不能替代本国实施链 | `QA-NATIONAL` 恰好两条 accepted source；truck/bus/construction/agriculture 全部 no-data，零 regulation/limits | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T18:48:04Z`） |
| 202 | KWT / 四 scope | Decision 372/1992 采用 Gulf Standards 474/475/476，但三项不在其六个月强制清单；Resolution 44/2015 附件的 GSO 42 身份仍没有完整发动机表、循环和 Euro V 国内实施链 | `KW-NATIONAL` 恰好两条 accepted source；truck/bus/construction/agriculture 全部 no-data，零 regulation/limits | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T18:48:04Z`） |
| 203 | OMN / 四 scope | Decision 120/2024 附件没有新重型发动机完整排放表/循环；GSO MY2026-D5 对 Oman 写 `<Euro4`、保留国家规则，且只对 Saudi Arabia 明列 ECE 49 Heavy Duty Euro V | `OM-NATIONAL` 恰好两条 accepted source；truck/bus/construction/agriculture 全部 no-data，零 regulation/limits | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T18:48:04Z`） |
| 204 | JOR / 四 scope | Transport Sector plan 明确无强制新车排放标准；JSMO 目录只有 JS 1053/1054:1998 身份，正文付费、日期 N/A，未闭合完整表、循环和国内实施日 | `JO-NATIONAL` 恰好两条 accepted source；truck/bus/construction/agriculture 全部 no-data，零 regulation/limits | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T18:48:04Z`） |

## 2026-08-11 IRN/IRQ/LBN/SYR source-currentness 纠错（#205–#208）

本节 supersede 历史 #101/#102/#104/#125 的旧 source 组合与证据表述，只刷新八条
source identity、record timestamps 和证据边界，不新增 regulation/limit，也不改变
稳定 33 国或 limits 总数。统一 `verifiedAt=2026-08-10T18:55:45Z`，membership
`validFrom=2026-08-10`；完成四次定向发布与目标库、公开 API/页面读回前不得声称已部署。

| # | 国家 / scope | 当前事实 | 期望确定性结果 | 核验状态 |
| --- | --- | --- | --- | --- |
| 205 | IRN / 四 scope | post-41054 的合并 Article 4 日程可读，列示道路 Euro 6/EEV/Euro 5 + OEM DPF 与 tractors Stage IIIA/IIIB；post-44973 是 2024 Article 4 修订。但道路未闭合新重型发动机分类/功率、完整污染物表和国家认证循环，非道路只列 tractors | `IR-NATIONAL` 恰好两条 accepted source；truck/bus 的 G1 部分、G2–G4 失败、G5 通过，construction G1–G5 失败，agriculture G1 部分、G2–G4 失败、G5 通过；四 scope no-data、零 regulation/limits | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T18:55:45Z`） |
| 206 | IRQ / 四 scope | COSQC Meeting 507 采用 TR 167/2019 Amendment 1/2024；INA / Ministry of Trade 公告闭合 2026-01-01、MY2025+ 进口车辆的检验/登记边界，但公开材料没有 TR 167 的新重型发动机分类/功率、完整污染物表和认证循环 | `IQ-NATIONAL` 恰好两条 accepted source；truck/bus 的 G1 部分、G2–G4 失败、G5 通过，construction/agriculture G1–G5 失败；四 scope no-data、零 regulation/limits | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T18:55:45Z`） |
| 207 | LBN / 四 scope | Law 444 Article 24 只作一般环境质量标准授权；Third BUR PDF p.185 / printed p.168 Table 103 记录公交排放法规未实施，并建议更新/执行在用柴油 trucks/buses 的 Decree 6603/1995 | `LB-NATIONAL` 恰好两条 accepted source；四 scope 均 G1–G5 失败，不把一般授权、在用车尾气或未实施建议升级为新发动机法规；四 scope no-data、零 regulation/limits | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T18:55:45Z`） |
| 208 | SYR / 四 scope | Law 12/2012 只有一般环境/EIA/后续标准授权并废止 Law 50/2002；SANA 2025-06-30 公告只列进口车辆类型、座位数和车龄，未规定排放类别、数值或循环 | `SY-NATIONAL` 恰好两条 accepted source；四 scope 均 G1–G5 失败，不把进口/车龄政策升级为排放实施链；四 scope no-data、零 regulation/limits | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T18:55:45Z`） |

在追加 #209–#243 前，#1–#208 已完成当时的总签核；#166–#198 为稳定 33 国本地 accepted
数据纠错，#199–#200 为 MAR/KEN、#201–#204 为 QAT/KWT/OMN/JOR、#205–#208 为
IRN/IRQ/LBN/SYR source-only currentness 纠错。MAR/KEN/QAT/KWT/OMN/JOR 来源以
`2026-08-10T18:48:04Z` 核验，IRN/IRQ/LBN/SYR 来源以
`2026-08-10T18:55:45Z` 核验；YEM no-change。当时待执行队列为 44 个唯一国家命令，
现已由下节 79 个唯一国家命令 supersede；生产数据库、公开 API/页面和覆盖状态尚未同步。

## 2026-08-11 35 国 source-currentness 总收口（#209–#243）

本节以当前 accepted fixture 和 SOURCES §3.85 为准，supersede 这些国家此前的弱入口、
新闻、目录或旧 source 组合。五门槛依次为：新发动机类别、分类/功率、完整污染物表、
法定认证循环、国内法定实施日；任一门槛未闭合即 fail closed，不从在用车检查、燃油/
进口政策、环境空气值、未来授权、邻国或 EU/GSO/UNECE 规则推值。除 URY 保留既有
`1 regulation / 18 limits`（truck 9 + bus 9）外，其余 34 国均为四 scope no-data、
`0 regulation / 0 limit`；所有条目均只是本地 accepted/source-only，尚未部署。

| # | 国家 / scope | 当前证据边界 | 期望确定性结果 | 核验状态 |
| --- | --- | --- | --- | --- |
| 209 | GUY / 四 scope | Air Quality Regulations 18–20 把车辆值留给后续标准；Road Traffic Act 只建立适行证和烟雾规则授权 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T19:36:45Z`） |
| 210 | HTI / 四 scope | Le Moniteur No. 11 是一般环境框架；MCI 公告只要求二手车辆/机械进口前技术检查 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T19:36:45Z`） |
| 211 | JAM / 四 scope | Regulation 66 与 Eighth Schedule 重型表只覆盖 MY1991–1998、进口/在用车，且未命名法定发动机认证循环 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T19:36:45Z`） |
| 212 | BLZ / 四 scope | Pollution Regulations 25–26 把柴油污染物 levels/procedures 留给部长；Environment Act 只授权后续规则 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T19:36:45Z`） |
| 213 | CUB / 四 scope | Ley 150/2022 只有移动源一般管理；Resolución 151/2011 是在用车怠速 CO/柴油烟气不透光度检查 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T19:36:45Z`） |
| 214 | LBR / 四 scope | Environment Protection and Management Law 委托未来移动源标准/检查；2011 运输行政规章未提供完整新发动机表和循环 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T19:46:12Z`） |
| 215 | LBY / 四 scope | Law 15/2003 与 Decision 448/2009 只建立定性污染、测试和后续标准框架 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T19:46:12Z`） |
| 216 | MLI / 四 scope | JO 08/2020 与 JO 26/2023 规定在用车技术检验和道路流通，不是新发动机型式认证表 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T19:46:12Z`） |
| 217 | MRT / 四 scope | Air Pollution Law 2018 与 Environment Code 2000 把车辆/发动机技术要求和受管排放留给后续文本 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T19:46:12Z`） |
| 218 | NER / 四 scope | Law 98-56 只授权后续技术标准；交通部 e-service 只证明 homologation 行政服务存在 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T19:46:12Z`） |
| 219 | GTM / 四 scope | MARN 车辆/燃油规范入口与 Traffic Law 未闭合新重型分类、完整表、循环和实施日 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T20:09:01Z`） |
| 220 | HND / 四 scope | Decree 36-2024 只授权未来制定车辆排放水平；Traffic Law 未给新重型发动机认证表 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T20:09:01Z`） |
| 221 | NIC / 四 scope | Decree 32-97 的 60%–80% 自由加速不透光度与 Law 431 证书制度均面向在用/进口车辆，且排除非道路设备 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T20:09:01Z`） |
| 222 | PRY / 四 scope | Decree 1269/2019 与 Resolution 605/2021 处理移动源测量/检查，没有闭合新重型发动机表与认证循环 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T20:09:01Z`） |
| 223 | URY / 卡车·客车；工程·农业 no-data | Decree 135/021 Table 17 的 Euro V ESC/ETC 代表路径及既有 `effectiveFrom=2023-05-14` 保持不变；当前 V5 `publishedOn=2025-11-13`，该程序版本自 `2025-11-17` 生效 | 保留 1 regulation / 18 limits（truck 9 + bus 9）；非道路 2 scope no-data；只纠正 current source 日期并区分法规实施日与 V5 版本启用日 | 本地 accepted，source-currentness 待部署（`verifiedAt=2026-08-10T20:09:01Z`） |
| 224 | PRK / 四 scope | Environment Law 只委托污染标准；updated First NDC 是交通/GHG 政策背景 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T20:20:37Z`） |
| 225 | PSE / 四 scope | Environment Law 7/1999 委托空气标准；Traffic Law 5/2000 只规定整车规格、首次登记和周期检查 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T20:20:37Z`） |
| 226 | SDN / 四 scope | Environment Protection Act 2001 只有一般空气保护/后续标准授权；Third National Communication 是交通政策背景 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T20:20:37Z`） |
| 227 | PRI / 四 scope | Regulation 5300 Rule 403(B) 是静止车辆 20% opacity；Regulation 9526 是周期车辆检查 | 恰好 2 source；四 scope no-data；0 regulation/limit；不自动复制美国联邦规则 | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T20:20:37Z`） |
| 228 | NCL / 四 scope | 当地道路法只有定性烟气/整车状态要求；DITTT 页面只建立进口、改装或重新上路验收 | 恰好 2 source；四 scope no-data；0 regulation/limit；不自动复制法国/EU 规则 | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T20:20:37Z`） |
| 229 | ERI / 四 scope | Legal Notice 127/2017 与 61/2002 建立环境管理和车辆技术规格，但无完整污染物表、认证循环和实施链 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T20:39:16Z`） |
| 230 | GAB / 四 scope | Law 007/2014 委托后续阈值；Order 00097/2017 覆盖重车、工程/农业设备 homologation，但没有发动机排放表/循环 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T20:39:16Z`） |
| 231 | GMB / 四 scope | 1999 Regulations 是环境空气浓度；Motor Traffic Amendment Act 2013 未提供新重型发动机表和循环 | 恰好 2 source；四 scope no-data；0 regulation/limit；1999 source 的 `publishedOn=null` | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T20:39:16Z`） |
| 232 | GNB / 四 scope | Environment Law 1/2011 把空气标准留给专门立法；交通部目录只有主管范围 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T20:39:16Z`） |
| 233 | GNQ / 四 scope | Environment Law 7/2003 与 Road Transport Law 4/2018 未给新重型发动机完整表、循环和实施分期 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T20:39:16Z`） |
| 234 | MOZ / 四 scope | Decree 67/2010 是环境/排放修正；Decree 44/2017 建立车辆、拖拉机和机器型号批准，但无污染物表/循环 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T20:50:58Z`） |
| 235 | LSO / 四 scope | Roadworthiness 服务是整车检查；2006 Transport Sector Policy 的排放标准仍需后续立法 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T20:50:58Z`） |
| 236 | MDG / 四 scope | 官方 EIA 仅二次提及车辆烟度法令身份，CNLEGIS 目录未提供可核验的完整新发动机原文/表/循环 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T20:50:58Z`） |
| 237 | MUS / 四 scope | Vehicular Smoke Returns 与 Road Traffic Amendment Act 2018 只证明在用车烟度执法/道路制度 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T20:50:58Z`） |
| 238 | FJI / 四 scope | FRCS SIG 2025-04 与 2026 import notice 是进口准入/整车政策，没有新重型发动机完整表和认证循环 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T20:50:58Z`） |
| 239 | CAF / 四 scope | Environment Code 07.018 只授权未来标准/周期检查；CDN 3.0 是 GHG 政策 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T21:00:43Z`） |
| 240 | COD / 四 scope | Environment Law 11/009 把标准留给后续法令；Order 085/2025 是在用/首次登记车辆检查且无阈值/循环 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T21:00:43Z`） |
| 241 | COG / 四 scope | Environment Law 33-2023 留待后续法令；Decree 2019-171 是周期检查/整车型式同质化，无排放表/循环 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T21:00:43Z`） |
| 242 | GIN / 四 scope | Environment Code 只作一般空气授权；Road Code 是道路通行、检查中心与整车 homologation 框架 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T21:00:43Z`） |
| 243 | DJI / 四 scope | Environment Code 与 Road Code 只定义 CO/HC/CO₂ 分析仪、柴油烟度及首次登记/周期检查，未给阈值、完整表或循环 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署（`verifiedAt=2026-08-10T21:00:43Z`） |

在追加 #244–#259 前，#1–#243 已完成当时的本地总签核。#209–#243 不表示已发布到生产数据库、
公开 API/页面或覆盖状态；当前本地闭包为
`79 jurisdictions / 16 regulations / 328 limits / 165 sources`，当时待执行队列为
79 个国家命令；该小计已由下节 95 国当前队列 supersede。URY 的 V5 发布日纠错不改变底层法规的
`effectiveFrom=2023-05-14`、18 条限值或两个非道路 no-data scope；`2025-11-17`
只表示当前 V5 程序版本的启用日。

## 2026-08-11 AUS/PNG/CAN/USA 数值完整性收口（#244–#247）

本节 supersede 历史 #3/#4/#19/#20/#21/#113 中不完整的数值表或过渡日表述。
代表路径只在法定类别、功率/机型年、完整污染物表、测试循环和实施边界
同时闭合时发布；ABT/FEL/NTE、常速、底盘和其他国家/等效标准路径均不累计。
下列均为本地 accepted，目标数据库、公开 API/页面与覆盖状态尚未同步。

| # | 国家 / scope | 当前 accepted 事实 | 期望确定性结果 | 核验状态 |
| --- | --- | --- | --- | --- |
| 244 | AUS / 卡车·客车；工程·农业 no-data | ADR 80/03 的柴油 B2 路径对每个道路 scope 为 ESC 4 项 + ELR 烟度 1 项 + ETC 4 项，并在当前无“新车型”维度的 schema 中只保留全车覆盖区间 `[2011-01-01, 2025-11-01)`。ADR 80/04 的 CI Table 1 对每个道路 scope 从 `2025-11-01` 起发布 WHSC/WHTC 各 CO、THC、NOx、NH3、PM、PN，共 12 项 | `2010-12-31` 道路无结果；`2011-01-01`–`2025-10-31` 每个道路 scope 恰好 9 条 ADR 80/03；`2025-11-01` 起恰好 12 条 ADR 80/04。工程/农业仍 no-data，日本/美国等替代路径不累计 | 本地 accepted，待部署（`verifiedAt=2026-08-10T23:00:23Z`） |
| 245 | PNG / 卡车；客车·工程·农业 no-data | Vehicle Standards and Compliance Rule §6A(4)(b) 对 GVW >4,500 kg、2012 年起制造的柴油 motor truck 允许 ADR 80/03、Euro V、Japan 05 或 US 2004 替代路径；fixture 只发布 ADR 80/03 代表路径的 ESC 4 + ELR 1 + ETC 4 | `2018-12-31` 无结果；`2019-01-01` 起仅 on-road-truck 返回 9 条，包含 ELR `OPACITY=0.5 m⁻¹`。查询结果必须保留 2012+ 制造年提示，且不延伸到客车/非道路 | 本地 accepted，待部署（`verifiedAt=2026-08-10T23:00:23Z`） |
| 246 | CAN / 四 scope | SOR/2003-2 §16(2) 动态引用相应机型年的 40 CFR 86.007-11；道路 MY2010+ petroleum-diesel engine-certified HDE 代表路径对每个道路 scope 发布 `FTP/SET` CO 15.5、NMHC 0.14、NOx 0.20、PM 0.01 g/hp-hr。SOR/2020-258 §10(1)(a) 直接纳入 40 CFR 1039.101；注册/采纳日为 `2020-12-04`、第 79 条生效日为 `2021-06-04`，130≤P≤560 kW 的 variable-speed Tier 4 对每个非道路 scope 发布 `NRTC / NRSC 8-mode` CO 3.5、NMHC 0.19、NOx 0.40、PM 0.02 g/kWh | 道路卡车/客车各 4 条；工程/农业在 `[130,560.001)` 各 4 条。P=560 有结果，P=560.001 无结果；本行明确替代旧文档的日期与半开端点，所有数值追溯到被加拿大法规直接纳入的 eCFR 表，不从法规摘要补值 | 历史 partial 非道路边界；已由 #263 / ADR-136 supersede（原 `verifiedAt=2026-08-10T23:17:50Z`） |
| 247 | USA / 四 scope | 40 CFR 86.007-11 对 MY2010–2026 每个道路 scope 发布 7 条代表行；40 CFR 1036.104 对 MY2027+ 每个道路 scope 发布 8 条 primary duty-cycle 代表行；40 CFR 1039.101 对 MY2015+、130≤P≤560 kW variable-speed 非道路发布每 scope 4 条 | MY2026 道路每 scope 只返回 §86 的 7 条，MY2027 起无重叠切换到 §1036 的 8 条；工程/农业在指定功率带各 4 条。91 FR 43154 仍为 proposed，不得出现在 effective graph | 历史 partial 非道路边界；已由 #264 / ADR-136 supersede（原 `verifiedAt=2026-08-10T23:21:05Z`） |

## 2026-08-11 十二国 source-currentness 总收口（#248–#259）

本节将 BRN、BTN、SLB、TLS、MWI、SLE、SOM、SSD、TCD、SLV、SUR、TTO 各自固定为
恰好两条当前 accepted source，统一 `verifiedAt=2026-08-10T23:08:11Z`。只更新 source
identity/currentness、record timestamps 和证据边界；不新增 regulation/limit。所有国家均
逐 scope 五门槛失败关闭，本地 accepted 不等于生产已部署。

| # | 国家 / scope | 当前证据边界 | 期望确定性结果 | 核验状态 |
| --- | --- | --- | --- | --- |
| 248 | BRN / 四 scope | Road Traffic Regulations 只有道路车辆可见烟气定性义务；LTD 驾驶指南的 HSU/Bosch 值面向在用车适行性 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署 |
| 249 | BTN / 四 scope | Environmental Standards 2020 的 `%HSU` 与 RSTRR 2026 通知属车辆注册/在用检查及规则实施边界，没有新重型发动机完整表和循环 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署 |
| 250 | SLB / 四 scope | Road Transport Act 只给整车许可/检查分类；NDC 3.0 是气候行动与 KPI | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署 |
| 251 | TLS / 四 scope | 环境基本法只委托后续标准；道路法的异常烟气、车型批准和检查条款没有发动机认证表 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署 |
| 252 | MWI / 四 scope | Road Traffic Act §108 与 Regulations 97 只规定公路车辆烟雾/烟气的定性运行义务 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署 |
| 253 | SLE / 四 scope | EPA Act 2022 只授权后续标准；e-Mobility Strategy 明示不开展 type approval testing，Euro IV–VI 仅为提议/情景 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署 |
| 254 | SOM / 四 scope | Environmental Protection and Management Act 委托后续标准；NDC 3.0 只给交通减缓行动，不是新发动机认证链 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署 |
| 255 | SSD / 四 scope | National Bureau of Standards Act 只建立通用标准/合格评定程序；Second NDC 将车辆标准与尾气检测列为尚未实施 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署 |
| 256 | TCD / 四 scope | Décret 904/2009 把空气规则留给后续文本，工程机械 homologation 条款只管噪声；BUR1 是清单/减缓背景 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署 |
| 257 | SLV / 四 scope | RTS 13.01.02:23 是在用道路车辆自由加速 opacity 检查且排除工程/农业；OSARTEC `Derogaciones` 页只提供规则状态边界 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署 |
| 258 | SUR / 四 scope | 2020 Milieu Raamwet 只授权后续技术标准；2024 S.B. 56 修法未提供新重型发动机完整表、循环与实施链 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署 |
| 259 | TTO / 四 scope | Air Pollution Rules 将用于车辆动力的发动机排除于固定源表；Act No. 2 of 2026 修订道路交通法，仍未给出新重型发动机完整认证链 | 恰好 2 source；四 scope no-data；0 regulation/limit | 本地 accepted，source-only 待部署 |

## 2026-08-11 MLT/CHN 与 ARE/CAN/USA 末轮完整性纠错（#260–#264）

本节以 EU 官方成员国页面、生态环境部 GB 20891-2014 正文与第 1 号修改单、HJ
1014-2020、MOIAT 实施指南、eCFR §1039.101 及当前 accepted fixture 为准，
supersede #14 的 MLT 排除、#2 的 CHN 单功率带、#173 的 ARE 通用日期，以及
#246/#247 的 CAN/USA partial 非道路边界。五项已随 release `20260812031745` 发布，
生产数据库、公开 API/页面和覆盖状态均完成读回。

| # | 国家 / scope | 当前事实 | 期望确定性结果 | 核验状态 |
| --- | --- | --- | --- | --- |
| 260 | MLT / 四 scope | Malta 自 `2004-05-01` 为 EU 成员；国家目录与同一固定 Natural Earth 修订的 1:10m 几何现已补齐，EU 成员关系可直接复用已签核 595/2009 Euro VI 与 2016/1628 Stage V，不复制法规或限值 | `2004-04-30` 不得经 EU 辖区返回法规，`2004-05-01` 起成员关系生效；截至 `2026-08-11` 的当前定向图为 2 regulations / 80 limits / 3 sources，四 scope 与其他 EU 成员采用相同日期、功率和循环过滤。MLT 页面与分享 URL 可寻址，GBR/TUR/EEA 仍不自动纳入 | 本地 accepted，待部署（`verifiedAt=2026-08-11T04:27:59Z`） |
| 261 | CHN / construction·agriculture | GB 20891 第三阶段自 `2016-04-01` 全面实施；对 P≤560 kW 保存至 `2022-12-01` 前的四个历史功率带，P>560 kW 自该日继续国三。第四阶段从 `2022-12-01` 对 P≤560 kW 强制，完整保存 P<37、37≤P<56、56≤P<130、130≤P≤560 四带；NRSC 适用于全部发动机，满足条件的变速发动机另适用 NRTC。反应剂发动机 NH3 25 ppm 为条件行，不发布成无条件限值 | 每个非道路 scope 当前四带分别返回 3/4/5/5 条；560 kW 返回国四 130–560 带的 5 条，560.001 kW 返回国三延续 CO 3.5 / HC+NOx 6.4 / PM 0.20。`2016-03-31` 无结果，`2016-04-01` 起可查国三历史，`2022-12-01` 无重叠切换国四；CHN 定向图为 2 regulations / 74 limits / 3 sources，第三来源为 HJ 1014-2020 循环/控制技术要求 | 本地 accepted，待纠错部署（`verifiedAt=2026-08-11T04:38:07Z`） |
| 262 | ARE / 卡车·客车 | MOIAT 新车型重型 Euro VI/B 指南从 `2026-01-01` 只约束首次登记的新引入车型，从 `2027-07-01` 才扩展至全部进口轻/重型车辆；当前 schema 无 new-model/first-registration 维度 | `2026-01-01` 起只保留 effective regulation metadata，普通 numeric 查询在 `2027-06-30` 仍 no-data；`2027-07-01` 起 truck/bus 各返回 WHSC/WHTC 12 条，construction/agriculture no-data | 本地 accepted，日期纠错待部署；supersede #173 的通用 numeric 日期 |
| 263 | CAN / 四 scope | SOR/2020-258 §10(1)(a) 直接纳入 40 CFR 1039.101，§1(4) 同时纳入所引用的 calculation methods；从 `2021-06-04` 为 variable-speed Tier 4 保存法定展示 P<8、8≤P<19、19≤P<37、37≤P<56、56≤P<130、130≤P≤560 六带。§1039.140 要先按 §1065.20(e) ties-to-even 将最大功率四舍五入至整 kW；道路 MY2010+ 路径不变 | 每个非道路 scope 六带分别返回 3/3/3/3/4/4 条；三位 raw query bounds 依次为 `[0,7.5)`、`[7.5,18.501)`、`[18.501,36.501)`、`[36.501,55.5)`、`[55.5,129.5)`、`[129.5,560.501)`，它们只是查询翻译，法定展示仍使用整 kW 六带。560、560.001 与 560.500 kW 均命中最高带，560.501 kW 无结果；CAN 定向图为 2 regulations / 48 limits（road 8 + nonroad 40）/ 4 sources，NRTC 与相应 NRSC 6-mode 或 C1 8-mode/RMC 同时适用 | 本地 accepted，完整功率带与 raw 查询端点纠错待部署（`verifiedAt=2026-08-11T05:21:45.000Z`）；supersede #246 partial 非道路边界 |
| 264 | USA / 四 scope | §86 MY2010–2026 与 §1036 MY2027+ 道路代表路径不变；§1039 MY2015+ variable-speed 非道路完整保存法定展示 P<8、8≤P<19、19≤P<37、37≤P<56、56≤P<130、130≤P≤560 六带；§1039.140 要先按 §1065.20(e) ties-to-even 将最大功率四舍五入至整 kW | 道路每 scope 7→8 无重叠切换；每个非道路 scope 六带分别返回 3/3/3/3/4/4 条。三位 raw query bounds 依次为 `[0,7.5)`、`[7.5,18.501)`、`[18.501,36.501)`、`[36.501,55.5)`、`[55.5,129.5)`、`[129.5,560.501)`，只用于查询翻译；560、560.001 与 560.500 kW 均命中最高带，560.501 kW 无结果。USA 定向图为 3 regulations / 70 limits（road 30 + nonroad 40）/ 3 sources，91 FR 43154 仍 proposed | 本地 accepted，完整功率带与 raw 查询端点纠错待部署（`verifiedAt=2026-08-11T05:21:45.000Z`）；supersede #247 partial 非道路边界 |

截至 2026-08-11，#1–#264 已完成本地总签核。97 个唯一国家命令已于 2026-08-12
在 governance maintenance lock 内完成生产发布，定向/full selection 闭包为
`97 jurisdictions / 28 regulations / 651 limits / 203 sources`；此前 95 国闭包是追加
#260–#264 前的历史小计。release `20260812031745` 已通过 97 国聚焦验收、178 国公开
目录/页面/API 读回和代表性法规语义检查。
