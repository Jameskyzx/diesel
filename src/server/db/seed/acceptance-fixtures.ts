import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "@/server/db/schema";
import {
  countryJurisdictions,
  dataSources,
  jurisdictions,
  regulationLimits,
  regulations,
} from "@/server/db/schema";

/**
 * M1 签核验收事实（ADR-015，2026-07-30 `docs/ACCEPTANCE.md` 总签核批准）。
 *
 * 与虚构 Demo fixture 不同，本模块是 `is_demo = false` 的真实事实，
 * 只包含签核时经官方来源核验（或间接核验）的内容：
 * - CHN、USA、EU-27、BRA：含经官方来源读回的代表性限值；
 * - MLT 不在 Natural Earth 1:110m 几何中，地图改用同一固定修订的 1:10m
 *   原始 feature，并以欧盟官方成员页面建立 2004-05-01 起的 EU 成员关系；
 * - JPN、KOR、MEX：2026-08-06 按负责人逐国填充指令完成官方法规读回；
 * - TUR：2026-08-06 按负责人逐国填充指令完成道路与工程机械官方法规读回；
 *   农业拖拉机由土耳其官方 NRE 文书明确排除，本批保留 no-data；
 * - AUS：2026-08-06 按负责人逐国填充指令完成 ADR 80/03、ADR 80/04 官方道路法规读回；
 *   DCCEEW 官方评估明确非道路柴油发动机尚无联邦排放法规，construction/agriculture 保留 no-data；
 * - CAN：2026-08-06 按负责人逐国填充指令完成 SOR/2003-2 道路与 SOR/2020-258 非道路
 *   官方法规读回；限值只记录加拿大条文直接引用的 CFR 代表性值；
 * - GBR：2026-08-07 按负责人逐国填充指令完成 GB provisional type approval 框架下的
 *   Stage V 非道路工程机械官方来源读回；道路与农业仅核验型式批准入口，未读回可发布
 *   的英国限值，保持 no-data；
 * - IND：2026-08-07 通过 MoRTH 官方公报 API 读回 BS VI、CEV 与 TREM 文书；
 *   2026 年 TREM 分功率带调整仍为 draft，不作为 effective 返回；
 * - RUS：2026-08-07 读回 EEC 官方 TR CU 018/2011、TR CU 031/2012 及
 *   2021/2024 修订；道路按生态等级 5，农业按 2025 年完成切换的 3A 等级，
 *   工程机械未取得可发布排放表，保持 no-data；
 * - IDN：2026-08-07 读回 KLHK P.20/2017（道路新型 M/N/O 类车辆 Euro 4）；
 *   非道路工程机械与农业装备未取得独立可发布限值，保持 no-data；
 * - THA：2026-08-10 读回 TIS 3046-2563 正文与强制实施公报；自 2024-01-01
 *   向重型 M/N 压燃车辆发布 Level 6（UN R49-05 / Euro V）ESC/ELR/ETC 代表路径，
 *   construction/agriculture 未取得覆盖 150 kW 的完整强制表，保持 no-data；
 * - VNM：2026-08-07 通过越南政府法规门户读回 Decision 49/2011/QD-TTg、
 *   Circular 06/2021/TT-BGTVT 与 QCVN 109:2021/BGTVT；道路重型柴油机按
 *   Level 5 建模，非道路车辆在 QCVN scope 中被明确排除；
 * - MYS：2026-08-07 读回 DOE P.U.(A) 429/96 合并法规与现行 VTA 门户公开
 *   指南；道路重型柴油机按 2017-01-01 Euro II 基线建模，Euro IV tentative
 *   日期不作为 effective，非道路被法规 scope 排除；
 * - SAU：2026-08-10 读回 GSO MY2026-D4 与 UN R49 Rev.4；truck/bus 以归一化
 *   MY2026 边界发布 Euro V B2 ESC/ELR/ETC 代表路径，construction/agriculture
 *   未取得独立法定尾气表，保持 no-data；
 * - ARE：2026-08-10 读回 MOIAT 新车排放实施指南；2026-01-01 仅是新车型
 *   首次登记边界，通用 truck/bus 数值查询采用 2027-07-01 全部进口车辆边界，
 *   construction/agriculture 不从道路指南外推；
 * - ZAF：2026-08-10 读回南非政府公报 39220 与 EUR-Lex Directive 91/542/EEC；
 *   truck/bus 以 2010-01-01 全制造/进口覆盖点发布 ECE R49.02B 代表路径及 85 kW
 *   PM 分档；美国、日本、ADR 等路径不累计，construction/agriculture 保持 no-data；
 * - ARG：2026-08-07 读回 Infoleg Resolution 1464/2014、军用例外 Resolution
 *   128/2018 以及 EUR-Lex/CELLAR Directive 2005/55；普通重型车辆自 2018-01-01
 *   按 B2（Euro V）道路限值建模，军用例外不改变普通市场基线，非道路 scope 保持
 *   no-data；
 * - NZL：2026-08-07 读回 NZTA Land Transport Rule: Vehicle Exhaust Emissions
 *   2007（2025-05-30 合并文本）；Table 2B 自 2025-11-01 对新旧 MD3/MD4/ME/NB/NC
 *   重型车辆统一接受 Euro VI Step C 等替代路径，本批只建模 Euro VI 代表路径；
 *   tractors 被明确排除，其他非道路 scope 未取得独立法定限值，保持 no-data；
 * - CHL：2026-08-07 读回 LeyChile D.S. 39/2020、D.S. 33/2024 与 D.S. 50/2023；
 *   道路重型车辆自 2026-01-06 采用 Euro VI 或 US-EPA 替代路径，一般移动机械
 *   自 2023-10-21 在 19–560 kW 范围采用 Table 2 代表路径；除拖拉机外的农业
 *   机械被排除，拖拉机要求已通过但延至 2030-01-01，本批保持 adopted；
 * - COL：2026-08-07 读回 MinAmbiente Resolucion 0762/2022 官方正文与法规目录；
 *   道路重型柴油车辆自 2023-01-01 执行 Table 22 Euro VI，非道路柴油机械自
 *   2024-07-18 在 19–560 kW 范围执行 Table 23 EU 代表路径；US/EPA 路径均为
 *   替代认证，专用于农业作业的非道路机械被 article 3(c) 明确排除；
 * - PER：2026-08-08 读回 El Peruano / MINAM D.S. 029-2021-MINAM 官方公报；
 *   >3.5 t 道路客货车辆自 2024-10-01 采用 Euro VI/A 或 EPA 2010 路径，
 *   本批保存 Euro VI/A WHSC/WHTC 代表限值；非道路 scope 不从道路规则外推；
 * - PHL：2026-08-10 读回 LTO MC AVT-2015-1946、DENR-EMB 官方镜像与地方政府
 *   COC 公告；truck/bus 自 2016-01-01 发布 UN R49-04 Euro IV B1
 *   ESC/ELR/ETC 代表路径，construction/agriculture 保持 no-data；
 * - SGP：2026-08-08 读回 Singapore Statutes Online 的 S 480/2017 与
 *   S 299/2012；重型道路柴油车自 2018-01-01 接受 Euro VI 代表路径，工业
 *   非道路柴油机自 2012-07-01 接受 EU Stage II 代表路径；替代认证不累计，
 *   agriculture 因 industrial plant 范围不足而保持 no-data；
 * - NOR：2026-08-08 读回 Lovdata 现行 Bilforskriften 与 Maskinforskriften；
 *   道路法规自 2022-10-01 将 595/2009、582/2011 作为挪威法，机械法规附件 XII
 *   自 2020-07-01 将 2016/1628 Stage V 作为挪威法规，四个 scope 均有来源追溯；
 * - ISL：2026-08-08 读回冰岛官方 Reglugerðasafn 与政府 EEA 数据库；377/2013
 *   将 595/2009、582/2011 写入道路重型车辆法规，603/2026 确认现行条目并纳入
 *   Euro 7；1200/2020 自 2020-12-01 实施 2016/1628，179/2021 无缝替代，
 *   construction/agriculture 共用 Stage V 代表功率带；
 * - SRB：2026-08-08 核对塞尔维亚官方法律信息系统入口及车辆排放规则检索结果；
 *   官方正文在当前访问窗口无法稳定读回，未取得可发布的重型道路或非道路柴油限值、
 *   实施日期和完整 scope，四个 scope 保持 no-data；不得用 EU/UNECE 或搜索摘要补齐；
 * - BIH：2026-08-10 读回 2019 最低技术要求决定与 2010 R49 homologation 命令；
 *   道路新 M/N 自 2019-06-01 发布 UN R49/06 WHSC/WHTC 代表路径；R96 仅适用于
 *   狭义 N3 SF mobile crane，不能外推一般工程机械，农业也保持 no-data；
 * - MKD：2026-08-08 核对北马其顿官方机构入口及 UNECE 第三次环境绩效评估；评估资料
 *   只记录二手车 Euro-4/新车 Euro-5 政策背景，未取得重型道路或非道路柴油法规正文、
 *   实施日期和限值表，四个 scope 保持 no-data；
 * - MNE：2026-08-10 读回现行车辆技术要求、2018 实施通知与 UN R49 Rev.6；
 *   新 M/N 自 2018-10-15 发布 Euro VI WHSC/WHTC/WNTE 代表路径；2024 农机引用与
 *   2026 homologation 法仍把非道路限值、循环和日期交后续细则，两个非道路 scope no-data；
 * - ALB：2026-08-08 核对阿尔巴尼亚基础设施与能源部交通战略和官方入口；战略只提出
 *   加强车辆排放标准与推进 Euro VI 车队更新，未取得重型道路/非道路有效法规正文、
 *   实施日期和限值表，四个 scope 保持 no-data；
 * - UKR：2026-08-10 读回首次登记/进口法与 Order No. 521 型式批准附件；道路
 *   truck/bus 在 2016-01-01 至 2026-12-31 发布 Euro V B2 ESC/ELR/ETC 代表路径，
 *   2027-01-01 Euro VI 下限开始后先 fail closed，construction/agriculture 保持 no-data；
 * - MDA：2026-08-08 核对摩尔多瓦 Legis.md 官方法规库与基础设施和区域发展部入口；
 *   法规库在当前验证窗口返回安全验证页，政府公开交通材料未提供可发布的重型道路/
 *   非道路柴油法规正文、实施日期或限值表，四个 scope 保持 no-data；
 * - NPL：2026-08-10 读回 Nepal Vehicle Pollution Standard 2082 官方公报与环境部副本；
 *   自 2025-06-23 向 >3,500 kg 压燃 M/N 发布 WHSC/WHTC/WNTE 表；§3 明确排除拖拉机、
 *   power tiller 与 dozer/crane/roller/excavator 等设备，两个非道路 scope 保持 no-data；
 * - ARM、BLR：2026-08-10 读回 EAEU TR CU 018/2011 与 TR CU 031/2012 当前文本；
 *   道路自 2019-01-01 发布 UN R49-05 B2 代表路径，农业发布全部四个当前 Stage IIIA
 *   功率带，替代 C/EEV 与历史阶段不累计；construction 保持 no-data；
 * - AZE：2026-08-10 读回 Euro 4 内阁决定、AZS 636:2025 与 AZS ECE 96 状态；公开链
 *   仍缺少强制的新重型发动机数值表、认证循环与阶段实施日，四个 scope 保持 no-data；
 * - GEO：2026-08-10 读回 Matsne 第 238 号决议当前第 12 版；自 2025-01-01 仅向新 N3
 *   卡车与 M3 客车发布 UN R49-05 B2 代表路径，construction/agriculture 保持 no-data；
 * - UZB：2026-08-10 读回 LEX.UZ 的 UzTR.10-006:2025 农林拖拉机法规；当前 H/Stage IIIA
 *   代表路径自 2025-10-01 发布，Stage II 短暂过渡与日期未定的 Stage V 不累计。道路
 *   UzTR.237-016:2017 缺少覆盖国内新造与一般投放流通的环保等级实施日，construction
 *   也未形成完整法源链，两个道路 scope 与 construction 保持 no-data；
 * - KAZ、KGZ：2026-08-10 读回 TR CU 018/2011 Class 5 与 TR CU 031/2012 当前文本；
 *   道路仅发布 UN R49-05 B2 柴油代表路径，农业发布全部四个当前 Stage IIIA 功率带；
 *   construction 不从道路、农林拖拉机或一般机器安全条款外推；
 * - TJK：2026-08-10 读回第 1214 号汽车运输生态安全法及 `СТ ҶТ ____–2024` 标准草案；
 *   前者将限值与日期交政府另定，后者编号、批准令和实施日均为空且仅含术语定义，四个
 *   scope 保持 no-data；
 * - TKM：2026-08-10 读回 2016 年《大气空气保护法》第 21 条与 TDS 1286-2019 目录；
 *   前者只引用另定的移动源规范，后者仅为汽油车 CO/HC 测量方法，四个 scope 保持
 *   no-data；
 * - AFG：2026-08-10 读回 2009 空气污染防治规章及 2020 修订；条文只给在用车检查与
 *   后续标准授权，没有新重型发动机完整数值表、认证循环和实施日，四个 scope no-data；
 * - AGO：2026-08-10 读回 DP 185/13 与 DP 99/20；可见数值仅为在用柴油车烟度检查，
 *   环境标准化计划不构成新发动机型式认证，四个 scope no-data；
 * - BDI：2026-08-10 读回 2012 道路交通法与 2025 车辆技术检验命令；两者只建立车辆
 *   分类、适路性与周期检查，缺少新重型发动机污染物表和循环，四个 scope no-data；
 * - BEN：2026-08-10 读回 Decree 2001-110；车辆表缺少可发布的发动机认证循环与完整
 *   实施链，不能升级为新重型发动机法规，四个 scope no-data；
 * - BFA：2026-08-10 读回 Decree 2001-185 及当前官方项目引用；数值属于一般/固定源
 *   排放管理而非新重型发动机型式认证，四个 scope no-data；
 * - BGD：2026-08-10 读回《Air Pollution (Control) Rules, 2022》Schedule 2；自
 *   2022-07-26 向 GVW>3,500 kg 新压燃道路卡车/客车各发布 CO/HC/NOx/PM 四条，
 *   construction/agriculture 不从道路表外推；
 * - BHS：2026-08-10 读回 Road Traffic Act 与 EPPA 2019；仅有定性烟气义务、车辆检查
 *   和未来制标授权，没有新重型发动机完整表或循环，四个 scope no-data；
 * - BOL：2026-08-10 读回 RM 064/2022 与 IBMETRO 当前接受页面；自 2022-04-01 向
 *   MY2017+、GVW>3,500 kg 的 N2/N3/M2/M3 发布 ECE 49 代表路径各四条，道路美国
 *   transient 是替代路径且不累计；construction/agriculture 保持 no-data；
 * - MAR：2026-08-10 读回 BO 7361 的 Arrêté 2094.24 与 BO 7028 的 Arrêté
 *   2251-21；后者虽公开重型 Euro VI WHSC/WHTC 表，但 2094.24 将 homologation /
 *   registration 节点推迟到 2027/2028，截至核验日尚未实施，四个 scope no-data；
 * - KEN：2026-08-10 读回 LN 180/2024 与 Traffic (Motor Vehicle Inspection)
 *   Rules LN 13/2026；两者建立在用/注册前检查并回指 KS 1515 / KS EAS 1047，
 *   但公开文本未闭合新重型发动机完整限值与认证循环，四个 scope no-data；
 * - BLZ：2026-08-11 source-currentness 复核读回 Pollution Regulations 与
 *   Environmental Protection Act 的 2020 合并本；regulations 25–26 和 Act section 6
 *   只给出在用检查或后续部长制标授权，没有现行新重型发动机表与认证循环，四个 scope
 *   保持 no-data；不得把 Ringelmann 可见烟度或未发布的部长标准升级为型式认证限值；
 * - BRN / BTN：2026-08-10 读回精确官方法规、标准与检查材料；公开数值属于道路
 *   适行性/在用车烟度检查，缺少新重型发动机完整分类、功基准单位与认证循环，四个
 *   scope 保持 no-data；不得把车辆检查值换算成发动机型式认证限值；
 * - CAF / COD / COG：2026-08-11 source-currentness 复核改用 CAF 2007 环境法与
 *   2025 NDC 3.0，并精确化 COD/COG 环境法和道路技术检验令；相关条文仍只授权后续
 *   标准、制定一般空气义务或管理在用车周期检查，未提供新重型发动机完整分类、
 *   污染物表、认证循环和合格实施日，四个 scope 保持 no-data；
 * - CUB：2026-08-11 source-currentness 复核以 Gaceta Oficial No. 87/2023 的
 *   Ley 150/2022 与 No. 014/2011 的 Resolucion 151/2011 替换新闻/插图汇编；前者只有
 *   移动源一般管理，后者只检查在用车 CO 或柴油烟气不透光度且把参数留给后续要求，
 *   四个 scope 保持 no-data；不得把检查条款升级为新发动机认证表；
 * - DJI / GIN：2026-08-11 source-currentness 复核保留两国环境法，以 Djibouti
 *   2010-0230 Road Code 和 Guinea 2018 Road Code 替换旧技术检验令/新闻页；法规仍
 *   只建立首次登记、同质化框架或在用车检查，没有新重型发动机完整污染物表和认证
 *   循环，四个 scope 保持 no-data；不得把 CO/HC/CO2 分析仪或柴油烟度定义升级为限值；
 * - ERI / GAB：2026-08-11 source-currentness 复核改用 Eritrea Legal Notice 127/2017
 *   与 61/2002、Gabon Law 007/2014 与重型车辆/工程机械 homologation Order 00097/2017；
 *   条文仍未闭合新重型发动机完整污染物表和法定认证循环，四个 scope 保持 no-data；
 *   不得把车辆技术规格、检查或 homologation 框架升级为发动机型式认证限值；
 * - GMB / GNB / GNQ：2026-08-11 source-currentness 复核改用 Gambia 1999 环境质量标准
 *   与 Motor Traffic (Amendment) Act 2013、Guinea-Bissau 环境基本法与交通部目录、
 *   Equatorial Guinea 环境法 7/2003 与道路运输法 4/2018；公开条文未提供新重型发动机
 *   完整分类、功基准单位、污染物表和认证循环，四个 scope 保持 no-data；不得把环境
 *   空气浓度、一般法律义务、行政目录或在用车检查升级为型式认证限值；
 * - GRL：2026-08-10 读回格陵兰现行车辆设备令与道路交通法；条文只有定性烟气义务，
 *   未提供新重型发动机完整分类、功基准单位与认证循环，四个 scope 保持 no-data；
 *   不得把丹麦/EU 规则外推到格陵兰；
 * - GUY / HTI：2026-08-11 source-currentness 复核读回 Guyana 两份 MOLA 合并法、
 *   Haiti Le Moniteur No. 11/2006 环境法令与 2025 MCI 进口公告；GUY 条文把车辆排放值
 *   留给 Agency 后续制标，HTI 只有一般环境框架与二手车辆/机器进口前技术检查，四个
 *   scope 保持 no-data；
 * - IRN：2026-08-10 读回 post-41054 合并车辆污染技术条例与 post-44973 修订；
 *   Article 4 的 Euro / Stage 标签和日程可读，但未闭合具体采纳版本、完整污染物表
 *   与认证循环，四个 scope 保持 no-data；
 * - IRQ：2026-08-10 读回 COSQC Meeting 507 / TR 167 amendment 与 2025-12-12
 *   强制实施公告；公开材料未提供重型分类、完整污染物表和认证循环，四个 scope
 *   保持 no-data；不得把标准身份或实施公告升级成未公开的发动机限值；
 * - JAM：2026-08-11 source-currentness 复核确认 Road Traffic Regulations 2022 的
 *   Regulation 66 与 Eighth Schedule Part A 物理 PDF 页码为 66–68、287–289；重型柴油
 *   表只覆盖 MY1991–1998，且没有命名认证循环，四个 scope 保持 no-data；不得把历史
 *   车型表或 in-service testing 建议升级为当前新发动机认证限值；
 * - LBN：2026-08-10 读回环境法与交通气候材料；可见条款属于一般标准委托或定性主管
 *   职责，未提供可安全映射到新重型发动机的完整分类、功基准与认证循环，四个 scope
 *   保持 no-data；
 * - LBR / LBY：2026-08-11 source-currentness 复核改用 Liberia 环境管理法与 2011 运输
 *   行政规章、Libya 环境保护法 15/2003 与其 Decision 448/2009 实施条例；公开条文仍仅
 *   提供一般授权、车辆检查或定性义务，未闭合新重型发动机五门槛，四个 scope 保持
 *   no-data；不得把一般车辆排放义务升级为型式认证限值；
 * - MLI / MRT：2026-08-11 source-currentness 复核改用 Mali JO 08/2020 技术检验令与
 *   JO 26/2023 道路车辆流通法令、Mauritania 空气污染法与 JO 985 环境法典；在用车检查、
 *   定性污染义务或后续标准授权未闭合新重型发动机五门槛，四个 scope 保持 no-data；
 *   不得继续引用已废止的 Mali Arrêté 00-2797，也不得把检查烟度升级为型式认证限值；
 * - MOZ / LSO / MDG / MUS / FJI：2026-08-11 source-currentness 复核改用 Mozambique
 *   Decree 67/2010 与 44/2017 直链、Lesotho 政府适行性公告与运输政策、Madagascar
 *   EIA 法规清单与 CNLEGIS 门户、Mauritius 执法回报与 Act 12/2018、Fiji 进口解释指引
 *   与 2026 公告；这些材料仅闭合环境框架、整车审批/进口或在用烟度边界，均未提供
 *   新重型发动机完整分类、污染物表和认证循环，四个 scope 保持 no-data；
 * - NCL：2026-08-11 source-currentness 复核改用 2025-10-07 合并版当地道路法典与
 *   DITTT 新车/进口车辆 homologation 页面；当地法虽建立首次上路前验收并将定性烟气
 *   义务扩至农业、工程机械，仍无重型分类、完整污染物表或认证循环，四个 scope 保持
 *   no-data；不得从法国/EU 规则外推未被当地明确纳入的发动机限值；
 * - NER：2026-08-11 source-currentness 复核改用环境框架法 98-56 与交通部机动车认证
 *   e-services；公开材料未提供重型分类、完整污染物表和法定认证循环，四个 scope 保持
 *   no-data；不得从在线行政服务推断未公开的认证限值；
 * - GTM / HND / NIC / PRY / URY：2026-08-11 完成官方法库与公报五门槛复核；
 *   GTM、HND、PRY 仅刷新双来源，NIC 保持双来源原文但更新重核时间，四国均未闭合
 *   新重型发动机类别、分类/功率、完整污染物表、认证循环与实施边界，四个 scope
 *   保持 no-data；URY 仅修正 V5 发布日为 2025-11-13，并记录当前 V5 程序版本
 *   自 2025-11-17 启用；Decree 135/021 的 2023-05-14 道路实施日及 truck/bus
 *   18 条 ESC/ETC 限值保持不变，非道路仍 no-data；
 * - PNG：2026-08-10 读回 RTA Vehicle Standards and Compliance Rule；Section 6A(4)(b)
 *   明确 4,500 kg 以上、2012 年起制造的柴油 motor truck 可采用 ADR 80/03、Euro V、
 *   Japan 05 或 US 2004 替代路径，Section 64B 要求进口合规认证。本 fixture 仅发布
 *   ADR 80/03 代表路径到 on-road-truck；不叠加替代路径，也不外推到客车/工程/农业；
 * - PRI：2026-08-11 source-currentness 重核 DRNA Regulation 5300 Rule 403(B) 与
 *   DTOP Regulation 9526；
 *   前者是车辆静止时的可见烟度规则，后者是周期车辆检查制度，四个 scope 保持 no-data，
 *   不把 20% opacity 或美国联邦规则外推为波多黎各的新重型发动机认证表；
 * - PRK / PSE：2026-08-11 source-currentness 复核以 PRK 1986 环境法和 2022 UNFCCC
 *   updated First NDC、PSE 两份现行合并法为精确双源；条文只委托后续标准或规定车辆/
 *   进口检查，未提供新重型发动机完整分类、功基准、污染物表和认证循环，四个 scope
 *   保持 no-data；不得把 NDC、在用车检查值升级为型式认证限值；
 * - SDN：2026-08-11 source-currentness 复核改用 HCENR Environment Protection Act 2001
 *   直链与 UNFCCC 第三次国家信息通报；前者只建立一般空气保护与后续标准授权，后者是
 *   车辆增长和交通减缓政策背景，均无新重型发动机限值表，四个 scope 保持 no-data；
 * - SLB：2026-08-10 读回 Attorney-General's Chambers 现行 Road Transport Act 与
 *   Solomon Islands NDC 3.0；前者只建立整车许可、检查与安全状态框架，后者仅给出
 *   交通减排目标，均无新重型发动机认证表，四个 scope 保持 no-data；
 * - SLE：2026-08-10 读回 EPA Act 2022 与 National e-Mobility Strategy；法案只授权
 *   后续污染标准，战略明确该国不做 type approval，Euro IV–VI 仅为提议/情景假设，
 *   四个 scope 保持 no-data；
 * - SLV：2026-08-10 读回 Diario Oficial 中 RTS 13.01.02:23 与 OSARTEC 生效说明；
 *   RTS 仅规范在用道路车辆静态/自由加速烟度检查，并明确排除农业、工程和非道路机械，
 *   不把 opacity 值升级为发动机型式认证限值，四个 scope 保持 no-data；
 * - SOM：2026-08-10 读回 Environment Protection and Management Act 与 First BUR；
 *   法案只指向日后建立/规定的车辆排放标准，BUR 明确运输政策缺口并把 Euro IV–VI 描述
 *   为未来推广方向，四个 scope 保持 no-data；
 * - SSD：2026-08-10 读回 National Bureau of Standards Act 与 Second NDC；前者要求
 *   具体强制标准另经 Gazette notice，后者把车辆排放标准与尾气检测列为尚未实施，
 *   四个 scope 保持 no-data；
 * - SUR：2026-08-10 读回 Milieu Raamwet 与 S.B. 2019 no. 35；前者只授权另行制定
 *   机器/设备/产品标准，后者只规定在用车复检场所排气设施，四个 scope 保持 no-data；
 * - SYR：2026-08-10 读回 Law No. 12/2012 与 SANA 2025-06-30 二手车进口公告；
 *   前者是一般环境、EIA 与后续标准授权，后者只规定进口车龄边界，四个 scope
 *   保持 no-data；
 * - TCD：2026-08-10 读回 Decree No. 904/2009 与 First BUR；前者将空气实施规则留给
 *   后续文本且车辆/工程机械条款仅管噪声，后者只记录老旧车队与未来减缓，四个 scope
 *   保持 no-data；
 * - TGO / TLS / TTO：2026-08-10 读回各国环境框架法、道路法与空气污染规则；可见条款
 *   只授权后续标准、规范在用车烟气/检查或明确排除车辆动力排放，均无新重型发动机完整
 *   分类、功率、污染物表与认证循环，四个 scope 保持 no-data；
 * - TWN：2026-08-10 读回移动污染源标准第五条与重型柴油引擎族审验办法；道路重型客货车
 *   仅保存 WHSC/WHTC/WNTE 代表路径，并采用既有引擎族宽限结束后的 2021-09-01 全覆盖
 *   边界；美国 FTP 替代路径不累计，工程与农业机械因无强制新发动机表继续 no-data；
 * - VEN：2026-08-10 读回 Decreto Nº 2.673/1998 与 2015 水和空气质量法；道路重型客货车
 *   自 MY2000 起只保存 91/542/EEC 欧洲代表路径，≤85 kW 的 PM 脚注单独分档，美国重型
 *   瞬态路径不累计；Article 24 明确排除工程、非道路采矿与农业机械；
 * - VUT / YEM：2026-08-10 读回污染授权法、议会通过但尚无 Gazette 生效证据的车辆进口
 *   修法案，以及也门环境保护法与合并交通法；可见条款仍是后续标准授权、登记/在用车
 *   检验或定性烟害，未提供新重型发动机完整认证表，四个 scope 保持 no-data；
 * - ATA / ATF / ESH / FLK：2026-08-10 以条约、属地适用条款、联合国非自治领土状态和
 *   当地道路条例锁定治理边界；未建立可独立发布的新重型柴油发动机法规，也不从声索国、
 *   主权国或宗主国规则外推，四个 scope 保持 no-data；
 * - KHM / LAO / MMR / MNG：2026-08-10 读回精确官方法规、法律与检查程序，但可见数值或引用
 *   仅属于在用车烟度/环境合规边界，缺少新重型发动机完整认证表，四个 scope 保持 no-data；
 * - LKA：2026-08-10 读回 Gazette 2079/42 Third Schedule Tables 5–6、2079/70 与
 *   2083/3；从 2018-07-13 明文实施日保存道路重型及工程设备代表路径，C1/D2 与
 *   Third/Fifth Schedule 均是替代而非累计语义，农业不外推；
 * - BWA / NAM：2026-08-10 核对 BOBS 自愿性在用车排放标准、Botswana e-Laws 入口，
 *   以及 Namibia MWT/NSI 的运输监管与车辆标准职责；均未取得强制的新重型发动机
 *   数值表，四个 scope 保持 no-data；
 * - TZA：2026-08-10 读回 NEMC 官方 GN 237/2007 与 TanzLII 法律记录；Regulation 12
 *   是车主/驾驶人的在用车辆合规，附表虽列重柴油数值但缺少新发动机类别、型式批准
 *   和首次投放边界，且表头存在不可擅自纠正的污染物错置，四个 scope 保持 no-data；
 * - ZMB / ZWE / CIV：2026-08-10 分别读回环境法、强制标准目录、排放许可材料与
 *   科特迪瓦空气质量法及 N2/N3 标准草案；可见条款是后续制标授权、固定/在用源管理
 *   或尚未生效的公开征求意见稿，均未闭合新重型发动机完整表、循环与实施日，四个
 *   scope 保持 no-data；
 * - RWA：2026-08-10 读回 2018 Ministerial Order、2023 RSB Gazette 与 EAC 对
 *   EAS 1047:2022 的实施说明；自 2023-01-23 向道路 truck/bus 发布 Euro IV
 *   UN R49-04 ESC/ELR/ETC 代表路径，construction/agriculture 不从道路标准外推；
 * - UGA：2026-08-10 读回 NEMA S.I. No. 22 of 2024、Schedule 4 原表及 UNBS
 *   US EAS 1047:2022 强制标准目录。法规本身按 2024-04-26 生效并入库，但重型表头
 *   原印 `kg/kWh`，GVW 行又与 C/CE/F/G 类别定义冲突；在官方勘误或标准正文证明前
 *   不擅自改成 g/kWh，也不创建数值 limit，四个 scope 保持 no-data；
 *
 * 用途：tests/acceptance-fixtures.test.ts 的确定性验收；后续经后台
 * Draft → Reviewed → Published 流程进入正式库时复用同一组 payload。
 *
 * 语义说明（AGENTS.md / ADR-006/007）：
 * - 美国法规按机型年（MY）生效，本库以历年近似：MY2027+ →
 *   effective_from = 2027-01-01，86.007-11 的 effective_to = 2027-01-01。
 * - 中国国四非道路对 560 kW 为含端点（≤560）；功率输入与数据库统一为三位
 *   小数精度，fixture 用 [130, 560.001) 表达闭合的 560 kW 上端点。
 */

const signoffTimestamp = new Date("2026-07-30T00:00:00.000Z");
const recordTimestamps = {
  createdAt: signoffTimestamp,
  updatedAt: signoffTimestamp,
  verifiedAt: signoffTimestamp,
} as const;
const chinaNonroadVerificationTimestamp = new Date(
  "2026-08-11T04:38:07.000Z",
);
const chinaNonroadRecordTimestamps = {
  ...recordTimestamps,
  updatedAt: chinaNonroadVerificationTimestamp,
  verifiedAt: chinaNonroadVerificationTimestamp,
} as const;
const p8VerificationTimestamp = new Date("2026-08-05T12:00:00.000Z");
const p7VerificationTimestamp = new Date("2026-08-05T12:50:00.000Z");
const p8RecordTimestamps = {
  ...recordTimestamps,
  updatedAt: p8VerificationTimestamp,
  verifiedAt: p8VerificationTimestamp,
} as const;
const euMembershipVerificationTimestamp = new Date(
  "2026-08-11T04:27:59.000Z",
);
const euMembershipRecordTimestamps = {
  createdAt: euMembershipVerificationTimestamp,
  updatedAt: euMembershipVerificationTimestamp,
  verifiedAt: euMembershipVerificationTimestamp,
} as const;
const japanVerificationTimestamp = new Date("2026-08-06T02:41:52.000Z");
const japanRecordTimestamps = {
  createdAt: japanVerificationTimestamp,
  updatedAt: japanVerificationTimestamp,
  verifiedAt: japanVerificationTimestamp,
} as const;
const koreaVerificationTimestamp = new Date("2026-08-06T04:57:42.000Z");
const koreaRecordTimestamps = {
  createdAt: koreaVerificationTimestamp,
  updatedAt: koreaVerificationTimestamp,
  verifiedAt: koreaVerificationTimestamp,
} as const;
const mexicoVerificationTimestamp = new Date("2026-08-06T06:00:00.000Z");
const mexicoRecordTimestamps = {
  createdAt: mexicoVerificationTimestamp,
  updatedAt: mexicoVerificationTimestamp,
  verifiedAt: mexicoVerificationTimestamp,
} as const;
const turkeyVerificationTimestamp = new Date("2026-08-06T07:30:00.000Z");
const turkeyRecordTimestamps = {
  createdAt: turkeyVerificationTimestamp,
  updatedAt: turkeyVerificationTimestamp,
  verifiedAt: turkeyVerificationTimestamp,
} as const;
const australiaVerificationTimestamp = new Date("2026-08-10T23:00:23.000Z");
const australiaRecordTimestamps = {
  createdAt: australiaVerificationTimestamp,
  updatedAt: australiaVerificationTimestamp,
  verifiedAt: australiaVerificationTimestamp,
} as const;
const canadaVerificationTimestamp = new Date("2026-08-11T05:21:45.000Z");
const canadaRecordTimestamps = {
  createdAt: canadaVerificationTimestamp,
  updatedAt: canadaVerificationTimestamp,
  verifiedAt: canadaVerificationTimestamp,
} as const;
const unitedStatesVerificationTimestamp = new Date(
  "2026-08-11T05:21:45.000Z",
);
const unitedStatesRecordTimestamps = {
  createdAt: unitedStatesVerificationTimestamp,
  updatedAt: unitedStatesVerificationTimestamp,
  verifiedAt: unitedStatesVerificationTimestamp,
} as const;
const unitedKingdomVerificationTimestamp = new Date("2026-08-07T02:00:00.000Z");
const unitedKingdomRecordTimestamps = {
  createdAt: unitedKingdomVerificationTimestamp,
  updatedAt: unitedKingdomVerificationTimestamp,
  verifiedAt: unitedKingdomVerificationTimestamp,
} as const;
const indiaVerificationTimestamp = new Date("2026-08-07T03:30:00.000Z");
const indiaRecordTimestamps = {
  createdAt: indiaVerificationTimestamp,
  updatedAt: indiaVerificationTimestamp,
  verifiedAt: indiaVerificationTimestamp,
} as const;
const russiaVerificationTimestamp = new Date("2026-08-07T05:50:00.000Z");
const russiaRecordTimestamps = {
  createdAt: russiaVerificationTimestamp,
  updatedAt: russiaVerificationTimestamp,
  verifiedAt: russiaVerificationTimestamp,
} as const;
const eaeuVerificationTimestamp = new Date("2026-08-09T03:00:00.000Z");
const eaeuRecordTimestamps = {
  createdAt: eaeuVerificationTimestamp,
  updatedAt: eaeuVerificationTimestamp,
  verifiedAt: eaeuVerificationTimestamp,
} as const;
const indonesiaVerificationTimestamp = new Date("2026-08-07T07:30:00.000Z");
const indonesiaRecordTimestamps = {
  createdAt: indonesiaVerificationTimestamp,
  updatedAt: indonesiaVerificationTimestamp,
  verifiedAt: indonesiaVerificationTimestamp,
} as const;
const thailandVerificationTimestamp = new Date("2026-08-10T13:09:56.000Z");
const thailandRecordTimestamps = {
  createdAt: thailandVerificationTimestamp,
  updatedAt: thailandVerificationTimestamp,
  verifiedAt: thailandVerificationTimestamp,
} as const;
const vietnamVerificationTimestamp = new Date("2026-08-07T10:15:00.000Z");
const vietnamRecordTimestamps = {
  createdAt: vietnamVerificationTimestamp,
  updatedAt: vietnamVerificationTimestamp,
  verifiedAt: vietnamVerificationTimestamp,
} as const;
const malaysiaVerificationTimestamp = new Date("2026-08-07T11:00:00.000Z");
const malaysiaRecordTimestamps = {
  createdAt: malaysiaVerificationTimestamp,
  updatedAt: malaysiaVerificationTimestamp,
  verifiedAt: malaysiaVerificationTimestamp,
} as const;
const saudiArabiaVerificationTimestamp = new Date(
  "2026-08-10T16:12:30.000Z",
);
const saudiArabiaRecordTimestamps = {
  createdAt: saudiArabiaVerificationTimestamp,
  updatedAt: saudiArabiaVerificationTimestamp,
  verifiedAt: saudiArabiaVerificationTimestamp,
} as const;
const unitedArabEmiratesVerificationTimestamp = new Date(
  "2026-08-10T16:09:15.000Z",
);
const unitedArabEmiratesRecordTimestamps = {
  createdAt: unitedArabEmiratesVerificationTimestamp,
  updatedAt: unitedArabEmiratesVerificationTimestamp,
  verifiedAt: unitedArabEmiratesVerificationTimestamp,
} as const;
const southAfricaVerificationTimestamp = new Date("2026-08-10T16:04:06.000Z");
const southAfricaRecordTimestamps = {
  createdAt: southAfricaVerificationTimestamp,
  updatedAt: southAfricaVerificationTimestamp,
  verifiedAt: southAfricaVerificationTimestamp,
} as const;
const argentinaVerificationTimestamp = new Date("2026-08-07T16:00:00.000Z");
const argentinaRecordTimestamps = {
  createdAt: argentinaVerificationTimestamp,
  updatedAt: argentinaVerificationTimestamp,
  verifiedAt: argentinaVerificationTimestamp,
} as const;
const newZealandVerificationTimestamp = new Date("2026-08-07T17:00:00.000Z");
const newZealandRecordTimestamps = {
  createdAt: newZealandVerificationTimestamp,
  updatedAt: newZealandVerificationTimestamp,
  verifiedAt: newZealandVerificationTimestamp,
} as const;
const chileVerificationTimestamp = new Date("2026-08-07T18:00:00.000Z");
const chileRecordTimestamps = {
  createdAt: chileVerificationTimestamp,
  updatedAt: chileVerificationTimestamp,
  verifiedAt: chileVerificationTimestamp,
} as const;
const colombiaVerificationTimestamp = new Date("2026-08-07T19:00:00.000Z");
const colombiaRecordTimestamps = {
  createdAt: colombiaVerificationTimestamp,
  updatedAt: colombiaVerificationTimestamp,
  verifiedAt: colombiaVerificationTimestamp,
} as const;
const peruVerificationTimestamp = new Date("2026-08-08T00:00:00.000Z");
const peruRecordTimestamps = {
  createdAt: peruVerificationTimestamp,
  updatedAt: peruVerificationTimestamp,
  verifiedAt: peruVerificationTimestamp,
} as const;
const philippinesVerificationTimestamp = new Date("2026-08-10T16:26:05.000Z");
const philippinesRecordTimestamps = {
  createdAt: philippinesVerificationTimestamp,
  updatedAt: philippinesVerificationTimestamp,
  verifiedAt: philippinesVerificationTimestamp,
} as const;
const singaporeVerificationTimestamp = new Date("2026-08-08T02:00:00.000Z");
const singaporeRecordTimestamps = {
  createdAt: singaporeVerificationTimestamp,
  updatedAt: singaporeVerificationTimestamp,
  verifiedAt: singaporeVerificationTimestamp,
} as const;
const norwayVerificationTimestamp = new Date("2026-08-08T03:00:00.000Z");
const norwayRecordTimestamps = {
  createdAt: norwayVerificationTimestamp,
  updatedAt: norwayVerificationTimestamp,
  verifiedAt: norwayVerificationTimestamp,
} as const;
const icelandVerificationTimestamp = new Date("2026-08-08T03:55:43.000Z");
const icelandRecordTimestamps = {
  createdAt: icelandVerificationTimestamp,
  updatedAt: icelandVerificationTimestamp,
  verifiedAt: icelandVerificationTimestamp,
} as const;
const liechtensteinVerificationTimestamp = new Date("2026-08-08T05:30:00.000Z");
const liechtensteinRecordTimestamps = {
  createdAt: liechtensteinVerificationTimestamp,
  updatedAt: liechtensteinVerificationTimestamp,
  verifiedAt: liechtensteinVerificationTimestamp,
} as const;
const switzerlandVerificationTimestamp = new Date("2026-08-08T06:30:00.000Z");
const switzerlandRecordTimestamps = {
  createdAt: switzerlandVerificationTimestamp,
  updatedAt: switzerlandVerificationTimestamp,
  verifiedAt: switzerlandVerificationTimestamp,
} as const;
const serbiaVerificationTimestamp = new Date("2026-08-10T13:09:56.000Z");
const serbiaRecordTimestamps = {
  createdAt: serbiaVerificationTimestamp,
  updatedAt: serbiaVerificationTimestamp,
  verifiedAt: serbiaVerificationTimestamp,
} as const;
const bosniaVerificationTimestamp = new Date("2026-08-10T13:09:56.000Z");
const bosniaRecordTimestamps = {
  createdAt: bosniaVerificationTimestamp,
  updatedAt: bosniaVerificationTimestamp,
  verifiedAt: bosniaVerificationTimestamp,
} as const;
const northMacedoniaVerificationTimestamp = new Date(
  "2026-08-10T13:17:36.000Z",
);
const northMacedoniaRecordTimestamps = {
  createdAt: northMacedoniaVerificationTimestamp,
  updatedAt: northMacedoniaVerificationTimestamp,
  verifiedAt: northMacedoniaVerificationTimestamp,
} as const;
const montenegroVerificationTimestamp = new Date("2026-08-10T13:17:36.000Z");
const montenegroRecordTimestamps = {
  createdAt: montenegroVerificationTimestamp,
  updatedAt: montenegroVerificationTimestamp,
  verifiedAt: montenegroVerificationTimestamp,
} as const;
const albaniaVerificationTimestamp = new Date("2026-08-10T13:09:56.000Z");
const albaniaRecordTimestamps = {
  createdAt: albaniaVerificationTimestamp,
  updatedAt: albaniaVerificationTimestamp,
  verifiedAt: albaniaVerificationTimestamp,
} as const;
const ukraineVerificationTimestamp = new Date("2026-08-10T12:59:02.000Z");
const ukraineRecordTimestamps = {
  createdAt: ukraineVerificationTimestamp,
  updatedAt: ukraineVerificationTimestamp,
  verifiedAt: ukraineVerificationTimestamp,
} as const;
const moldovaVerificationTimestamp = new Date("2026-08-10T13:04:28.000Z");
const moldovaRecordTimestamps = {
  createdAt: moldovaVerificationTimestamp,
  updatedAt: moldovaVerificationTimestamp,
  verifiedAt: moldovaVerificationTimestamp,
} as const;
const nepalVerificationTimestamp = new Date("2026-08-10T13:22:24.000Z");
const nepalRecordTimestamps = {
  createdAt: nepalVerificationTimestamp,
  updatedAt: nepalVerificationTimestamp,
  verifiedAt: nepalVerificationTimestamp,
} as const;
const caucasusVerificationTimestamp = new Date("2026-08-10T14:20:51.000Z");
const armeniaVerificationTimestamp = caucasusVerificationTimestamp;
const armeniaRecordTimestamps = {
  createdAt: armeniaVerificationTimestamp,
  updatedAt: armeniaVerificationTimestamp,
  verifiedAt: armeniaVerificationTimestamp,
} as const;
const azerbaijanVerificationTimestamp = caucasusVerificationTimestamp;
const azerbaijanRecordTimestamps = {
  createdAt: azerbaijanVerificationTimestamp,
  updatedAt: azerbaijanVerificationTimestamp,
  verifiedAt: azerbaijanVerificationTimestamp,
} as const;
const georgiaVerificationTimestamp = caucasusVerificationTimestamp;
const georgiaRecordTimestamps = {
  createdAt: georgiaVerificationTimestamp,
  updatedAt: georgiaVerificationTimestamp,
  verifiedAt: georgiaVerificationTimestamp,
} as const;
const centralAsiaVerificationTimestamp = new Date(
  "2026-08-10T13:40:00.000Z",
);
const centralAsiaRecordTimestamps = {
  createdAt: centralAsiaVerificationTimestamp,
  updatedAt: centralAsiaVerificationTimestamp,
  verifiedAt: centralAsiaVerificationTimestamp,
} as const;
const uzbekistanVerificationTimestamp = centralAsiaVerificationTimestamp;
const uzbekistanRecordTimestamps = {
  createdAt: uzbekistanVerificationTimestamp,
  updatedAt: uzbekistanVerificationTimestamp,
  verifiedAt: uzbekistanVerificationTimestamp,
} as const;
const kazakhstanVerificationTimestamp = centralAsiaVerificationTimestamp;
const kazakhstanRecordTimestamps = {
  createdAt: kazakhstanVerificationTimestamp,
  updatedAt: kazakhstanVerificationTimestamp,
  verifiedAt: kazakhstanVerificationTimestamp,
} as const;
const tajikistanVerificationTimestamp = centralAsiaVerificationTimestamp;
const tajikistanRecordTimestamps = {
  createdAt: tajikistanVerificationTimestamp,
  updatedAt: tajikistanVerificationTimestamp,
  verifiedAt: tajikistanVerificationTimestamp,
} as const;
const kyrgyzstanVerificationTimestamp = centralAsiaVerificationTimestamp;
const kyrgyzstanRecordTimestamps = {
  createdAt: kyrgyzstanVerificationTimestamp,
  updatedAt: kyrgyzstanVerificationTimestamp,
  verifiedAt: kyrgyzstanVerificationTimestamp,
} as const;
const turkmenistanVerificationTimestamp = centralAsiaVerificationTimestamp;
const turkmenistanRecordTimestamps = {
  createdAt: turkmenistanVerificationTimestamp,
  updatedAt: turkmenistanVerificationTimestamp,
  verifiedAt: turkmenistanVerificationTimestamp,
} as const;
const finalCountryBatchVerificationTimestamp = new Date(
  "2026-08-10T14:35:00.000Z",
);
const afghanistanVerificationTimestamp = finalCountryBatchVerificationTimestamp;
const afghanistanRecordTimestamps = {
  createdAt: afghanistanVerificationTimestamp,
  updatedAt: afghanistanVerificationTimestamp,
  verifiedAt: afghanistanVerificationTimestamp,
} as const;
const angolaVerificationTimestamp = finalCountryBatchVerificationTimestamp;
const angolaRecordTimestamps = {
  createdAt: angolaVerificationTimestamp,
  updatedAt: angolaVerificationTimestamp,
  verifiedAt: angolaVerificationTimestamp,
} as const;
const burundiVerificationTimestamp = finalCountryBatchVerificationTimestamp;
const burundiRecordTimestamps = {
  createdAt: burundiVerificationTimestamp,
  updatedAt: burundiVerificationTimestamp,
  verifiedAt: burundiVerificationTimestamp,
} as const;
const beninVerificationTimestamp = finalCountryBatchVerificationTimestamp;
const beninRecordTimestamps = {
  createdAt: beninVerificationTimestamp,
  updatedAt: beninVerificationTimestamp,
  verifiedAt: beninVerificationTimestamp,
} as const;
const burkinaFasoVerificationTimestamp = finalCountryBatchVerificationTimestamp;
const burkinaFasoRecordTimestamps = {
  createdAt: burkinaFasoVerificationTimestamp,
  updatedAt: burkinaFasoVerificationTimestamp,
  verifiedAt: burkinaFasoVerificationTimestamp,
} as const;
const bangladeshVerificationTimestamp = finalCountryBatchVerificationTimestamp;
const bangladeshRecordTimestamps = {
  createdAt: bangladeshVerificationTimestamp,
  updatedAt: bangladeshVerificationTimestamp,
  verifiedAt: bangladeshVerificationTimestamp,
} as const;
const bahamasVerificationTimestamp = finalCountryBatchVerificationTimestamp;
const bahamasRecordTimestamps = {
  createdAt: bahamasVerificationTimestamp,
  updatedAt: bahamasVerificationTimestamp,
  verifiedAt: bahamasVerificationTimestamp,
} as const;
const belarusVerificationTimestamp = caucasusVerificationTimestamp;
const belarusRecordTimestamps = {
  createdAt: belarusVerificationTimestamp,
  updatedAt: belarusVerificationTimestamp,
  verifiedAt: belarusVerificationTimestamp,
} as const;
const boliviaVerificationTimestamp = finalCountryBatchVerificationTimestamp;
const boliviaRecordTimestamps = {
  createdAt: boliviaVerificationTimestamp,
  updatedAt: boliviaVerificationTimestamp,
  verifiedAt: boliviaVerificationTimestamp,
} as const;
const moroccoKenyaSourceRefreshVerificationTimestamp = new Date(
  "2026-08-10T18:48:04.000Z",
);
const moroccoVerificationTimestamp =
  moroccoKenyaSourceRefreshVerificationTimestamp;
const moroccoRecordTimestamps = {
  createdAt: moroccoVerificationTimestamp,
  updatedAt: moroccoVerificationTimestamp,
  verifiedAt: moroccoVerificationTimestamp,
} as const;
const kenyaVerificationTimestamp =
  moroccoKenyaSourceRefreshVerificationTimestamp;
const kenyaRecordTimestamps = {
  createdAt: kenyaVerificationTimestamp,
  updatedAt: kenyaVerificationTimestamp,
  verifiedAt: kenyaVerificationTimestamp,
} as const;
const africaDeepReviewVerificationTimestamp = new Date(
  "2026-08-10T17:13:30.000Z",
);
const nigeriaVerificationTimestamp = africaDeepReviewVerificationTimestamp;
const nigeriaRecordTimestamps = {
  createdAt: nigeriaVerificationTimestamp,
  updatedAt: nigeriaVerificationTimestamp,
  verifiedAt: nigeriaVerificationTimestamp,
} as const;
const nigeriaRegulationVerificationTimestamp = africaDeepReviewVerificationTimestamp;
const nigeriaRegulationRecordTimestamps = {
  createdAt: nigeriaRegulationVerificationTimestamp,
  updatedAt: nigeriaRegulationVerificationTimestamp,
  verifiedAt: nigeriaRegulationVerificationTimestamp,
} as const;
const egyptVerificationTimestamp = new Date("2026-08-10T16:36:28.000Z");
const egyptRecordTimestamps = {
  createdAt: egyptVerificationTimestamp,
  updatedAt: egyptVerificationTimestamp,
  verifiedAt: egyptVerificationTimestamp,
} as const;
const ghanaVerificationTimestamp = new Date("2026-08-10T16:36:28.000Z");
const ghanaRecordTimestamps = {
  createdAt: ghanaVerificationTimestamp,
  updatedAt: ghanaVerificationTimestamp,
  verifiedAt: ghanaVerificationTimestamp,
} as const;
const israelVerificationTimestamp = new Date("2026-08-10T16:40:00.000Z");
const israelRecordTimestamps = {
  createdAt: israelVerificationTimestamp,
  updatedAt: israelVerificationTimestamp,
  verifiedAt: israelVerificationTimestamp,
} as const;
const pakistanVerificationTimestamp = new Date("2026-08-10T16:28:30.000Z");
const pakistanRecordTimestamps = {
  createdAt: pakistanVerificationTimestamp,
  updatedAt: pakistanVerificationTimestamp,
  verifiedAt: pakistanVerificationTimestamp,
} as const;
const gulfDeepReviewVerificationTimestamp = new Date(
  "2026-08-10T18:48:04.000Z",
);
const qatarVerificationTimestamp = gulfDeepReviewVerificationTimestamp;
const qatarRecordTimestamps = {
  createdAt: qatarVerificationTimestamp,
  updatedAt: qatarVerificationTimestamp,
  verifiedAt: qatarVerificationTimestamp,
} as const;
const kuwaitVerificationTimestamp = gulfDeepReviewVerificationTimestamp;
const kuwaitRecordTimestamps = {
  createdAt: kuwaitVerificationTimestamp,
  updatedAt: kuwaitVerificationTimestamp,
  verifiedAt: kuwaitVerificationTimestamp,
} as const;
const omanVerificationTimestamp = gulfDeepReviewVerificationTimestamp;
const omanRecordTimestamps = {
  createdAt: omanVerificationTimestamp,
  updatedAt: omanVerificationTimestamp,
  verifiedAt: omanVerificationTimestamp,
} as const;
const jordanVerificationTimestamp = gulfDeepReviewVerificationTimestamp;
const jordanRecordTimestamps = {
  createdAt: jordanVerificationTimestamp,
  updatedAt: jordanVerificationTimestamp,
  verifiedAt: jordanVerificationTimestamp,
} as const;
const cambodiaVerificationTimestamp = new Date("2026-08-10T17:38:18.000Z");
const cambodiaRecordTimestamps = {
  createdAt: cambodiaVerificationTimestamp,
  updatedAt: cambodiaVerificationTimestamp,
  verifiedAt: cambodiaVerificationTimestamp,
} as const;
const laosVerificationTimestamp = new Date("2026-08-10T17:38:18.000Z");
const laosRecordTimestamps = {
  createdAt: laosVerificationTimestamp,
  updatedAt: laosVerificationTimestamp,
  verifiedAt: laosVerificationTimestamp,
} as const;
const sriLankaVerificationTimestamp = new Date("2026-08-10T17:38:18.000Z");
const sriLankaRecordTimestamps = {
  createdAt: sriLankaVerificationTimestamp,
  updatedAt: sriLankaVerificationTimestamp,
  verifiedAt: sriLankaVerificationTimestamp,
} as const;
const mongoliaVerificationTimestamp = new Date("2026-08-10T17:38:18.000Z");
const mongoliaRecordTimestamps = {
  createdAt: mongoliaVerificationTimestamp,
  updatedAt: mongoliaVerificationTimestamp,
  verifiedAt: mongoliaVerificationTimestamp,
} as const;
const costaRicaVerificationTimestamp = new Date("2026-08-10T16:18:20.000Z");
const costaRicaRecordTimestamps = {
  createdAt: costaRicaVerificationTimestamp,
  updatedAt: costaRicaVerificationTimestamp,
  verifiedAt: costaRicaVerificationTimestamp,
} as const;
const ecuadorVerificationTimestamp = new Date("2026-08-10T16:18:20.000Z");
const ecuadorRecordTimestamps = {
  createdAt: ecuadorVerificationTimestamp,
  updatedAt: ecuadorVerificationTimestamp,
  verifiedAt: ecuadorVerificationTimestamp,
} as const;
const dominicanRepublicVerificationTimestamp = new Date(
  "2026-08-10T16:18:20.000Z",
);
const dominicanRepublicRecordTimestamps = {
  createdAt: dominicanRepublicVerificationTimestamp,
  updatedAt: dominicanRepublicVerificationTimestamp,
  verifiedAt: dominicanRepublicVerificationTimestamp,
} as const;
const africaFiveGateReviewTimestamp = new Date("2026-08-10T17:12:15.000Z");
const algeriaVerificationTimestamp = africaFiveGateReviewTimestamp;
const algeriaRecordTimestamps = {
  createdAt: algeriaVerificationTimestamp,
  updatedAt: algeriaVerificationTimestamp,
  verifiedAt: algeriaVerificationTimestamp,
} as const;
const tunisiaVerificationTimestamp = africaFiveGateReviewTimestamp;
const tunisiaRecordTimestamps = {
  createdAt: tunisiaVerificationTimestamp,
  updatedAt: tunisiaVerificationTimestamp,
  verifiedAt: tunisiaVerificationTimestamp,
} as const;
const ethiopiaVerificationTimestamp = africaFiveGateReviewTimestamp;
const ethiopiaRecordTimestamps = {
  createdAt: ethiopiaVerificationTimestamp,
  updatedAt: ethiopiaVerificationTimestamp,
  verifiedAt: ethiopiaVerificationTimestamp,
} as const;
const latinAmericaFiveGateReviewTimestamp = new Date(
  "2026-08-10T20:09:01.000Z",
);
const guatemalaVerificationTimestamp = latinAmericaFiveGateReviewTimestamp;
const guatemalaRecordTimestamps = {
  createdAt: guatemalaVerificationTimestamp,
  updatedAt: guatemalaVerificationTimestamp,
  verifiedAt: guatemalaVerificationTimestamp,
} as const;
const hondurasVerificationTimestamp = latinAmericaFiveGateReviewTimestamp;
const hondurasRecordTimestamps = {
  createdAt: hondurasVerificationTimestamp,
  updatedAt: hondurasVerificationTimestamp,
  verifiedAt: hondurasVerificationTimestamp,
} as const;
const panamaVerificationTimestamp = new Date("2026-08-10T16:18:20.000Z");
const panamaRecordTimestamps = {
  createdAt: panamaVerificationTimestamp,
  updatedAt: panamaVerificationTimestamp,
  verifiedAt: panamaVerificationTimestamp,
} as const;
const uruguayVerificationTimestamp = latinAmericaFiveGateReviewTimestamp;
const uruguayRecordTimestamps = {
  createdAt: uruguayVerificationTimestamp,
  updatedAt: uruguayVerificationTimestamp,
  verifiedAt: uruguayVerificationTimestamp,
} as const;
const botswanaVerificationTimestamp = africaDeepReviewVerificationTimestamp;
const botswanaRecordTimestamps = {
  createdAt: botswanaVerificationTimestamp,
  updatedAt: botswanaVerificationTimestamp,
  verifiedAt: botswanaVerificationTimestamp,
} as const;
const namibiaVerificationTimestamp = africaDeepReviewVerificationTimestamp;
const namibiaRecordTimestamps = {
  createdAt: namibiaVerificationTimestamp,
  updatedAt: namibiaVerificationTimestamp,
  verifiedAt: namibiaVerificationTimestamp,
} as const;
const tanzaniaVerificationTimestamp = new Date("2026-08-10T16:55:00.000Z");
const tanzaniaRecordTimestamps = {
  createdAt: tanzaniaVerificationTimestamp,
  updatedAt: tanzaniaVerificationTimestamp,
  verifiedAt: tanzaniaVerificationTimestamp,
} as const;
const ugandaVerificationTimestamp = africaDeepReviewVerificationTimestamp;
const ugandaRecordTimestamps = {
  createdAt: ugandaVerificationTimestamp,
  updatedAt: ugandaVerificationTimestamp,
  verifiedAt: ugandaVerificationTimestamp,
} as const;
const zambiaVerificationTimestamp = new Date("2026-08-10T16:55:00.000Z");
const zambiaRecordTimestamps = {
  createdAt: zambiaVerificationTimestamp,
  updatedAt: zambiaVerificationTimestamp,
  verifiedAt: zambiaVerificationTimestamp,
} as const;
const zimbabweVerificationTimestamp = new Date("2026-08-10T16:55:00.000Z");
const zimbabweRecordTimestamps = {
  createdAt: zimbabweVerificationTimestamp,
  updatedAt: zimbabweVerificationTimestamp,
  verifiedAt: zimbabweVerificationTimestamp,
} as const;
const rwandaVerificationTimestamp = new Date("2026-08-10T16:55:00.000Z");
const rwandaRecordTimestamps = {
  createdAt: rwandaVerificationTimestamp,
  updatedAt: rwandaVerificationTimestamp,
  verifiedAt: rwandaVerificationTimestamp,
} as const;
const coteDIvoireVerificationTimestamp = new Date("2026-08-10T16:55:00.000Z");
const coteDIvoireRecordTimestamps = {
  createdAt: coteDIvoireVerificationTimestamp,
  updatedAt: coteDIvoireVerificationTimestamp,
  verifiedAt: coteDIvoireVerificationTimestamp,
} as const;
const cameroonVerificationTimestamp = africaFiveGateReviewTimestamp;
const cameroonRecordTimestamps = {
  createdAt: cameroonVerificationTimestamp,
  updatedAt: cameroonVerificationTimestamp,
  verifiedAt: cameroonVerificationTimestamp,
} as const;
const senegalVerificationTimestamp = africaFiveGateReviewTimestamp;
const senegalRecordTimestamps = {
  createdAt: senegalVerificationTimestamp,
  updatedAt: senegalVerificationTimestamp,
  verifiedAt: senegalVerificationTimestamp,
} as const;
const mozLsoMdgMusFjiSourceRefreshTimestamp = new Date(
  "2026-08-10T20:50:58.000Z",
);
const mozambiqueVerificationTimestamp = mozLsoMdgMusFjiSourceRefreshTimestamp;
const mozambiqueRecordTimestamps = {
  createdAt: mozambiqueVerificationTimestamp,
  updatedAt: mozambiqueVerificationTimestamp,
  verifiedAt: mozambiqueVerificationTimestamp,
} as const;
const eswatiniVerificationTimestamp = africaDeepReviewVerificationTimestamp;
const eswatiniRecordTimestamps = {
  createdAt: eswatiniVerificationTimestamp,
  updatedAt: eswatiniVerificationTimestamp,
  verifiedAt: eswatiniVerificationTimestamp,
} as const;
const lesothoVerificationTimestamp = mozLsoMdgMusFjiSourceRefreshTimestamp;
const lesothoRecordTimestamps = {
  createdAt: lesothoVerificationTimestamp,
  updatedAt: lesothoVerificationTimestamp,
  verifiedAt: lesothoVerificationTimestamp,
} as const;
const madagascarVerificationTimestamp = mozLsoMdgMusFjiSourceRefreshTimestamp;
const madagascarRecordTimestamps = { createdAt: madagascarVerificationTimestamp, updatedAt: madagascarVerificationTimestamp, verifiedAt: madagascarVerificationTimestamp } as const;
const mauritiusVerificationTimestamp = mozLsoMdgMusFjiSourceRefreshTimestamp;
const mauritiusRecordTimestamps = { createdAt: mauritiusVerificationTimestamp, updatedAt: mauritiusVerificationTimestamp, verifiedAt: mauritiusVerificationTimestamp } as const;
const twelveCountrySourceOnlyRefreshTimestamp = new Date(
  "2026-08-10T23:08:11.000Z",
);
const malawiVerificationTimestamp = twelveCountrySourceOnlyRefreshTimestamp;
const malawiRecordTimestamps = { createdAt: malawiVerificationTimestamp, updatedAt: malawiVerificationTimestamp, verifiedAt: malawiVerificationTimestamp } as const;
const fijiVerificationTimestamp = mozLsoMdgMusFjiSourceRefreshTimestamp;
const fijiRecordTimestamps = { createdAt: fijiVerificationTimestamp, updatedAt: fijiVerificationTimestamp, verifiedAt: fijiVerificationTimestamp } as const;
const caribbeanSourceRefreshTimestamp = new Date(
  "2026-08-10T19:36:45.000Z",
);
const africaSourceRefreshTimestamp = new Date(
  "2026-08-10T19:46:12.000Z",
);
const prkPseSdnPriNclSourceRefreshTimestamp = new Date(
  "2026-08-10T20:20:37.000Z",
);
const eriGabGmbGnbGnqSourceRefreshTimestamp = new Date(
  "2026-08-10T20:39:16.000Z",
);
const cafCodCogGinDjiSourceRefreshTimestamp = new Date(
  "2026-08-10T21:00:43.000Z",
);
const belizeVerificationTimestamp = caribbeanSourceRefreshTimestamp;
const belizeRecordTimestamps = { createdAt: belizeVerificationTimestamp, updatedAt: belizeVerificationTimestamp, verifiedAt: belizeVerificationTimestamp } as const;
const bruneiVerificationTimestamp = twelveCountrySourceOnlyRefreshTimestamp;
const bruneiRecordTimestamps = { createdAt: bruneiVerificationTimestamp, updatedAt: bruneiVerificationTimestamp, verifiedAt: bruneiVerificationTimestamp } as const;
const bhutanVerificationTimestamp = twelveCountrySourceOnlyRefreshTimestamp;
const bhutanRecordTimestamps = { createdAt: bhutanVerificationTimestamp, updatedAt: bhutanVerificationTimestamp, verifiedAt: bhutanVerificationTimestamp } as const;
const centralAfricanRepublicVerificationTimestamp = cafCodCogGinDjiSourceRefreshTimestamp;
const centralAfricanRepublicRecordTimestamps = { createdAt: centralAfricanRepublicVerificationTimestamp, updatedAt: centralAfricanRepublicVerificationTimestamp, verifiedAt: centralAfricanRepublicVerificationTimestamp } as const;
const democraticRepublicOfCongoVerificationTimestamp = cafCodCogGinDjiSourceRefreshTimestamp;
const democraticRepublicOfCongoRecordTimestamps = { createdAt: democraticRepublicOfCongoVerificationTimestamp, updatedAt: democraticRepublicOfCongoVerificationTimestamp, verifiedAt: democraticRepublicOfCongoVerificationTimestamp } as const;
const republicOfCongoVerificationTimestamp = cafCodCogGinDjiSourceRefreshTimestamp;
const republicOfCongoRecordTimestamps = { createdAt: republicOfCongoVerificationTimestamp, updatedAt: republicOfCongoVerificationTimestamp, verifiedAt: republicOfCongoVerificationTimestamp } as const;
const cubaVerificationTimestamp = caribbeanSourceRefreshTimestamp;
const cubaRecordTimestamps = { createdAt: cubaVerificationTimestamp, updatedAt: cubaVerificationTimestamp, verifiedAt: cubaVerificationTimestamp } as const;
const djiboutiVerificationTimestamp = cafCodCogGinDjiSourceRefreshTimestamp;
const djiboutiRecordTimestamps = { createdAt: djiboutiVerificationTimestamp, updatedAt: djiboutiVerificationTimestamp, verifiedAt: djiboutiVerificationTimestamp } as const;
const eritreaVerificationTimestamp = eriGabGmbGnbGnqSourceRefreshTimestamp;
const eritreaRecordTimestamps = { createdAt: eritreaVerificationTimestamp, updatedAt: eritreaVerificationTimestamp, verifiedAt: eritreaVerificationTimestamp } as const;
const gabonVerificationTimestamp = eriGabGmbGnbGnqSourceRefreshTimestamp;
const gabonRecordTimestamps = { createdAt: gabonVerificationTimestamp, updatedAt: gabonVerificationTimestamp, verifiedAt: gabonVerificationTimestamp } as const;
const guineaVerificationTimestamp = cafCodCogGinDjiSourceRefreshTimestamp;
const guineaRecordTimestamps = { createdAt: guineaVerificationTimestamp, updatedAt: guineaVerificationTimestamp, verifiedAt: guineaVerificationTimestamp } as const;
const gambiaVerificationTimestamp = eriGabGmbGnbGnqSourceRefreshTimestamp;
const gambiaRecordTimestamps = { createdAt: gambiaVerificationTimestamp, updatedAt: gambiaVerificationTimestamp, verifiedAt: gambiaVerificationTimestamp } as const;
const guineaBissauVerificationTimestamp = eriGabGmbGnbGnqSourceRefreshTimestamp;
const guineaBissauRecordTimestamps = { createdAt: guineaBissauVerificationTimestamp, updatedAt: guineaBissauVerificationTimestamp, verifiedAt: guineaBissauVerificationTimestamp } as const;
const equatorialGuineaVerificationTimestamp = eriGabGmbGnbGnqSourceRefreshTimestamp;
const equatorialGuineaRecordTimestamps = { createdAt: equatorialGuineaVerificationTimestamp, updatedAt: equatorialGuineaVerificationTimestamp, verifiedAt: equatorialGuineaVerificationTimestamp } as const;
const greenlandVerificationTimestamp = new Date("2026-08-10T06:44:56.000Z");
const greenlandRecordTimestamps = { createdAt: greenlandVerificationTimestamp, updatedAt: greenlandVerificationTimestamp, verifiedAt: greenlandVerificationTimestamp } as const;
const guyanaVerificationTimestamp = caribbeanSourceRefreshTimestamp;
const guyanaRecordTimestamps = { createdAt: guyanaVerificationTimestamp, updatedAt: guyanaVerificationTimestamp, verifiedAt: guyanaVerificationTimestamp } as const;
const haitiVerificationTimestamp = caribbeanSourceRefreshTimestamp;
const haitiRecordTimestamps = { createdAt: haitiVerificationTimestamp, updatedAt: haitiVerificationTimestamp, verifiedAt: haitiVerificationTimestamp } as const;
const iranVerificationTimestamp = new Date("2026-08-10T18:55:45.000Z");
const iranRecordTimestamps = { createdAt: iranVerificationTimestamp, updatedAt: iranVerificationTimestamp, verifiedAt: iranVerificationTimestamp } as const;
const iraqVerificationTimestamp = new Date("2026-08-10T18:55:45.000Z");
const iraqRecordTimestamps = { createdAt: iraqVerificationTimestamp, updatedAt: iraqVerificationTimestamp, verifiedAt: iraqVerificationTimestamp } as const;
const jamaicaVerificationTimestamp = caribbeanSourceRefreshTimestamp;
const jamaicaRecordTimestamps = { createdAt: jamaicaVerificationTimestamp, updatedAt: jamaicaVerificationTimestamp, verifiedAt: jamaicaVerificationTimestamp } as const;
const lebanonVerificationTimestamp = new Date("2026-08-10T18:55:45.000Z");
const lebanonRecordTimestamps = { createdAt: lebanonVerificationTimestamp, updatedAt: lebanonVerificationTimestamp, verifiedAt: lebanonVerificationTimestamp } as const;
const liberiaVerificationTimestamp = africaSourceRefreshTimestamp;
const liberiaRecordTimestamps = { createdAt: liberiaVerificationTimestamp, updatedAt: liberiaVerificationTimestamp, verifiedAt: liberiaVerificationTimestamp } as const;
const libyaVerificationTimestamp = africaSourceRefreshTimestamp;
const libyaRecordTimestamps = { createdAt: libyaVerificationTimestamp, updatedAt: libyaVerificationTimestamp, verifiedAt: libyaVerificationTimestamp } as const;
const maliVerificationTimestamp = africaSourceRefreshTimestamp;
const maliRecordTimestamps = { createdAt: maliVerificationTimestamp, updatedAt: maliVerificationTimestamp, verifiedAt: maliVerificationTimestamp } as const;
const myanmarVerificationTimestamp = new Date("2026-08-10T17:38:18.000Z");
const myanmarRecordTimestamps = { createdAt: myanmarVerificationTimestamp, updatedAt: myanmarVerificationTimestamp, verifiedAt: myanmarVerificationTimestamp } as const;
const mauritaniaVerificationTimestamp = africaSourceRefreshTimestamp;
const mauritaniaRecordTimestamps = { createdAt: mauritaniaVerificationTimestamp, updatedAt: mauritaniaVerificationTimestamp, verifiedAt: mauritaniaVerificationTimestamp } as const;
const newCaledoniaVerificationTimestamp = prkPseSdnPriNclSourceRefreshTimestamp;
const newCaledoniaRecordTimestamps = { createdAt: newCaledoniaVerificationTimestamp, updatedAt: newCaledoniaVerificationTimestamp, verifiedAt: newCaledoniaVerificationTimestamp } as const;
const nigerVerificationTimestamp = africaSourceRefreshTimestamp;
const nigerRecordTimestamps = { createdAt: nigerVerificationTimestamp, updatedAt: nigerVerificationTimestamp, verifiedAt: nigerVerificationTimestamp } as const;
const nicaraguaVerificationTimestamp = latinAmericaFiveGateReviewTimestamp;
const nicaraguaRecordTimestamps = { createdAt: nicaraguaVerificationTimestamp, updatedAt: nicaraguaVerificationTimestamp, verifiedAt: nicaraguaVerificationTimestamp } as const;
const papuaNewGuineaVerificationTimestamp = new Date("2026-08-10T23:00:23.000Z");
const papuaNewGuineaRecordTimestamps = { createdAt: papuaNewGuineaVerificationTimestamp, updatedAt: papuaNewGuineaVerificationTimestamp, verifiedAt: papuaNewGuineaVerificationTimestamp } as const;
const puertoRicoVerificationTimestamp = prkPseSdnPriNclSourceRefreshTimestamp;
const puertoRicoRecordTimestamps = { createdAt: puertoRicoVerificationTimestamp, updatedAt: puertoRicoVerificationTimestamp, verifiedAt: puertoRicoVerificationTimestamp } as const;
const northKoreaVerificationTimestamp = prkPseSdnPriNclSourceRefreshTimestamp;
const northKoreaRecordTimestamps = { createdAt: northKoreaVerificationTimestamp, updatedAt: northKoreaVerificationTimestamp, verifiedAt: northKoreaVerificationTimestamp } as const;
const paraguayVerificationTimestamp = latinAmericaFiveGateReviewTimestamp;
const paraguayRecordTimestamps = { createdAt: paraguayVerificationTimestamp, updatedAt: paraguayVerificationTimestamp, verifiedAt: paraguayVerificationTimestamp } as const;
const palestineVerificationTimestamp = prkPseSdnPriNclSourceRefreshTimestamp;
const palestineRecordTimestamps = { createdAt: palestineVerificationTimestamp, updatedAt: palestineVerificationTimestamp, verifiedAt: palestineVerificationTimestamp } as const;
const sudanVerificationTimestamp = prkPseSdnPriNclSourceRefreshTimestamp;
const sudanRecordTimestamps = { createdAt: sudanVerificationTimestamp, updatedAt: sudanVerificationTimestamp, verifiedAt: sudanVerificationTimestamp } as const;
const solomonIslandsVerificationTimestamp = twelveCountrySourceOnlyRefreshTimestamp;
const solomonIslandsRecordTimestamps = { createdAt: solomonIslandsVerificationTimestamp, updatedAt: solomonIslandsVerificationTimestamp, verifiedAt: solomonIslandsVerificationTimestamp } as const;
const sierraLeoneVerificationTimestamp = twelveCountrySourceOnlyRefreshTimestamp;
const sierraLeoneRecordTimestamps = { createdAt: sierraLeoneVerificationTimestamp, updatedAt: sierraLeoneVerificationTimestamp, verifiedAt: sierraLeoneVerificationTimestamp } as const;
const elSalvadorVerificationTimestamp = twelveCountrySourceOnlyRefreshTimestamp;
const elSalvadorRecordTimestamps = { createdAt: elSalvadorVerificationTimestamp, updatedAt: elSalvadorVerificationTimestamp, verifiedAt: elSalvadorVerificationTimestamp } as const;
const somaliaVerificationTimestamp = twelveCountrySourceOnlyRefreshTimestamp;
const somaliaRecordTimestamps = { createdAt: somaliaVerificationTimestamp, updatedAt: somaliaVerificationTimestamp, verifiedAt: somaliaVerificationTimestamp } as const;
const southSudanVerificationTimestamp = twelveCountrySourceOnlyRefreshTimestamp;
const southSudanRecordTimestamps = { createdAt: southSudanVerificationTimestamp, updatedAt: southSudanVerificationTimestamp, verifiedAt: southSudanVerificationTimestamp } as const;
const surinameVerificationTimestamp = twelveCountrySourceOnlyRefreshTimestamp;
const surinameRecordTimestamps = { createdAt: surinameVerificationTimestamp, updatedAt: surinameVerificationTimestamp, verifiedAt: surinameVerificationTimestamp } as const;
const syriaVerificationTimestamp = new Date("2026-08-10T18:55:45.000Z");
const syriaRecordTimestamps = { createdAt: syriaVerificationTimestamp, updatedAt: syriaVerificationTimestamp, verifiedAt: syriaVerificationTimestamp } as const;
const chadVerificationTimestamp = twelveCountrySourceOnlyRefreshTimestamp;
const chadRecordTimestamps = { createdAt: chadVerificationTimestamp, updatedAt: chadVerificationTimestamp, verifiedAt: chadVerificationTimestamp } as const;
const togoVerificationTimestamp = new Date("2026-08-10T11:21:32.000Z");
const togoRecordTimestamps = { createdAt: togoVerificationTimestamp, updatedAt: togoVerificationTimestamp, verifiedAt: togoVerificationTimestamp } as const;
const timorLesteVerificationTimestamp = twelveCountrySourceOnlyRefreshTimestamp;
const timorLesteRecordTimestamps = { createdAt: timorLesteVerificationTimestamp, updatedAt: timorLesteVerificationTimestamp, verifiedAt: timorLesteVerificationTimestamp } as const;
const trinidadTobagoVerificationTimestamp = twelveCountrySourceOnlyRefreshTimestamp;
const trinidadTobagoRecordTimestamps = { createdAt: trinidadTobagoVerificationTimestamp, updatedAt: trinidadTobagoVerificationTimestamp, verifiedAt: trinidadTobagoVerificationTimestamp } as const;
const taiwanVerificationTimestamp = new Date("2026-08-10T11:21:32.000Z");
const taiwanRecordTimestamps = { createdAt: taiwanVerificationTimestamp, updatedAt: taiwanVerificationTimestamp, verifiedAt: taiwanVerificationTimestamp } as const;
const venezuelaVerificationTimestamp = new Date("2026-08-10T11:58:54.000Z");
const venezuelaRecordTimestamps = { createdAt: venezuelaVerificationTimestamp, updatedAt: venezuelaVerificationTimestamp, verifiedAt: venezuelaVerificationTimestamp } as const;
const vanuatuVerificationTimestamp = new Date("2026-08-10T11:58:54.000Z");
const vanuatuRecordTimestamps = { createdAt: vanuatuVerificationTimestamp, updatedAt: vanuatuVerificationTimestamp, verifiedAt: vanuatuVerificationTimestamp } as const;
const yemenVerificationTimestamp = new Date("2026-08-10T11:58:54.000Z");
const yemenRecordTimestamps = { createdAt: yemenVerificationTimestamp, updatedAt: yemenVerificationTimestamp, verifiedAt: yemenVerificationTimestamp } as const;
const antarcticaVerificationTimestamp = new Date("2026-08-10T11:58:54.000Z");
const antarcticaRecordTimestamps = { createdAt: antarcticaVerificationTimestamp, updatedAt: antarcticaVerificationTimestamp, verifiedAt: antarcticaVerificationTimestamp } as const;
const frenchSouthernLandsVerificationTimestamp = new Date("2026-08-10T11:58:54.000Z");
const frenchSouthernLandsRecordTimestamps = { createdAt: frenchSouthernLandsVerificationTimestamp, updatedAt: frenchSouthernLandsVerificationTimestamp, verifiedAt: frenchSouthernLandsVerificationTimestamp } as const;
const westernSaharaVerificationTimestamp = new Date("2026-08-10T11:58:54.000Z");
const westernSaharaRecordTimestamps = { createdAt: westernSaharaVerificationTimestamp, updatedAt: westernSaharaVerificationTimestamp, verifiedAt: westernSaharaVerificationTimestamp } as const;
const falklandIslandsVerificationTimestamp = new Date("2026-08-10T11:58:54.000Z");
const falklandIslandsRecordTimestamps = { createdAt: falklandIslandsVerificationTimestamp, updatedAt: falklandIslandsVerificationTimestamp, verifiedAt: falklandIslandsVerificationTimestamp } as const;

export const euOfficialMemberCountryMemberships = [
  { countryIso3: "AUT", validFrom: "1995-01-01" },
  { countryIso3: "BEL", validFrom: "1958-01-01" },
  { countryIso3: "BGR", validFrom: "2007-01-01" },
  { countryIso3: "HRV", validFrom: "2013-07-01" },
  { countryIso3: "CYP", validFrom: "2004-05-01" },
  { countryIso3: "CZE", validFrom: "2004-05-01" },
  { countryIso3: "DNK", validFrom: "1973-01-01" },
  { countryIso3: "EST", validFrom: "2004-05-01" },
  { countryIso3: "FIN", validFrom: "1995-01-01" },
  { countryIso3: "FRA", validFrom: "1958-01-01" },
  { countryIso3: "DEU", validFrom: "1958-01-01" },
  { countryIso3: "GRC", validFrom: "1981-01-01" },
  { countryIso3: "HUN", validFrom: "2004-05-01" },
  { countryIso3: "IRL", validFrom: "1973-01-01" },
  { countryIso3: "ITA", validFrom: "1958-01-01" },
  { countryIso3: "LVA", validFrom: "2004-05-01" },
  { countryIso3: "LTU", validFrom: "2004-05-01" },
  { countryIso3: "LUX", validFrom: "1958-01-01" },
  { countryIso3: "MLT", validFrom: "2004-05-01" },
  { countryIso3: "NLD", validFrom: "1958-01-01" },
  { countryIso3: "POL", validFrom: "2004-05-01" },
  { countryIso3: "PRT", validFrom: "1986-01-01" },
  { countryIso3: "ROU", validFrom: "2007-01-01" },
  { countryIso3: "SVK", validFrom: "2004-05-01" },
  { countryIso3: "SVN", validFrom: "2004-05-01" },
  { countryIso3: "ESP", validFrom: "1986-01-01" },
  { countryIso3: "SWE", validFrom: "1995-01-01" },
] as const;

export const euMemberCountryMemberships = euOfficialMemberCountryMemberships;

export const euOfficialMemberCountryIso3: ReadonlyArray<string> =
  euOfficialMemberCountryMemberships.map(({ countryIso3 }) => countryIso3);
export const euMemberCountryIso3: ReadonlyArray<string> =
  euMemberCountryMemberships.map(({ countryIso3 }) => countryIso3);

const ID_PREFIX = "10000000-0000-4000-8000-00000000";
const id = (suffix: string): string => `${ID_PREFIX}${suffix}`;

export const acceptanceFixtureIds = {
  source: {
    brConama403: id("0212"),
    brConama433: id("0209"),
    brConama490: id("0208"),
    cnGb17691: id("0201"),
    cnGb20891: id("0202"),
    euReg1257: id("0207"),
    euReg1628: id("0206"),
    euReg595: id("0205"),
    euCountries: id("0213"),
    eaeuMemberStates: id("0391"),
    japanOffroadNotice: id("0216"),
    japanRoadHistory: id("0215"),
    japanRoadSafety: id("0214"),
    koreaRuleAnnex17: id("0218"),
    koreaRulePage: id("0217"),
    mexicoNom044: id("0219"),
    mexicoNom044Amend2020: id("0220"),
    mexicoNom044Amend2021: id("0221"),
    turkeyRoadRegulation: id("0222"),
    turkeyRoadAmendment2021: id("0223"),
    turkeyNonroadRegulation: id("0224"),
    turkeyNonroadAnnex: id("0225"),
    turkeyAgricultureTypeApproval: id("0226"),
    australiaAdrCurrent: id("0227"),
    australiaAdr80_03: id("0228"),
    australiaAdr80_04: id("0229"),
    australiaAdr80Qna: id("0230"),
    australiaNrdeEvaluation: id("0231"),
    australiaDieselHdStandards: id("0232"),
    canadaRoadRegulation: id("0233"),
    canadaOffroadRegulation: id("0234"),
    unitedKingdomNrmm: id("0235"),
    unitedKingdomAgricultureApproval: id("0236"),
    indiaBs6: id("0237"),
    indiaCevTrem: id("0238"),
    indiaTremIvExtension: id("0239"),
    indiaTremVExtension: id("0240"),
    indiaTrem2026Draft: id("0241"),
    russiaRoadRegulation: id("0242"),
    russiaNationalDeviation: id("0243"),
    russiaAgricultureRegulation: id("0244"),
    russiaAgricultureAmendment2021: id("0245"),
    russiaAgricultureAmendment2024: id("0246"),
    russiaUneceR49: id("0247"),
    indonesiaEuro4: id("0248"),
    thailandTis3046: id("0249"),
    thailandMinisterialRegulation: id("0250"),
    vietnamDecision49: id("0251"),
    vietnamQcvn109: id("0252"),
    malaysiaDieselRegulation: id("0253"),
    malaysiaVtaGuideline: id("0254"),
    saudiGso42: id("0255"),
    saudiGso144: id("0256"),
    saudiMachinerySafetyPart2: id("0257"),
    saudiVehicle2026TechnicalRegulations: id("0728"),
    uaeMandatoryStandards2018: id("0258"),
    uaeVehicleEmissionGuide: id("0259"),
    southAfricaMotorVehiclesM23: id("0260"),
    southAfricaMotorVehiclesN23: id("0261"),
    southAfricaDirective91542: id("0727"),
    argentinaResolution1464: id("0262"),
    argentinaResolution128Exception: id("0263"),
    euDirective200555: id("0264"),
    newZealandVehicleExhaustRule: id("0265"),
    chileMobileMachineryDecree39: id("0266"),
    chileTractorAmendmentDecree33: id("0267"),
    chileHeavyVehicleDecree50: id("0268"),
    colombiaResolution762: id("0269"),
    peruDecree029: id("0270"),
    philippinesLtoMc20151946: id("0271"),
    philippinesEuro4LimitsBoI: id("0272"),
    philippinesUnr49CycleNotice: id("0730"),
    singaporeVehicularAmendment2017: id("0273"),
    singaporeOffRoad2012: id("0274"),
    singaporeAirPollutionGuide: id("0275"),
    norwayRoadRegulation: id("0276"),
    norwayMachineryRegulation: id("0277"),
    icelandRoadRegulation2013: id("0278"),
    icelandRoadAmendment2026: id("0279"),
    icelandNrmmRegulation2020: id("0280"),
    icelandNrmmRegulation2021: id("0281"),
    liechtensteinVts: id("0282"),
    liechtensteinEwrStageV: id("0283"),
    switzerlandVts: id("0284"),
    serbiaHomologationRulebook: id("0285"),
    bosniaMinimumRequirements: id("0286"),
    bosniaR49Orders: id("0287"),
    northMacedoniaRoadApproval: id("0288"),
    northMacedoniaTractorApproval: id("0289"),
    montenegroVehicleRequirements: id("0290"),
    montenegroUneceR49: id("0291"),
    albaniaGothenburgAccession: id("0292"),
    albaniaTreatyStatus: id("0293"),
    ukraineImportRegistrationLaw: id("0294"),
    ukraineTypeApprovalOrder: id("0295"),
    moldovaTypeApprovalDraftLaw: id("0296"),
    moldovaTypeApprovalSecondaryConsultation: id("0297"),
    nepalVehicleEmissionGazette: id("0298"),
    nepalVehiclePollutionStandardDoenv: id("0299"),
    armeniaTrCu018Consolidated: id("0341"),
    armeniaTrCu031Consolidated: id("0342"),
    azerbaijanEuro4Decision: id("0343"),
    azerbaijanAzs6362025: id("0344"),
    georgiaResolution238: id("0346"),
    georgiaResolution238Mepa: id("0347"),
    uzbekistanAgricultureRegulation: id("0349"),
    uzbekistanRoadRegulation: id("0350"),
    kazakhstanRoadRegulation: id("0352"),
    kazakhstanAgricultureRegulation: id("0353"),
    tajikistanRoadEnvironmentalLaw: id("0355"),
    tajikistanEngineTermsDraft: id("0356"),
    kyrgyzstanRoadImplementation: id("0358"),
    kyrgyzstanAgricultureRegulation: id("0359"),
    turkmenistanAirProtectionLaw: id("0361"),
    turkmenistanGasolineMeasurementStandard: id("0362"),
    afghanistanAirPollutionRegulation: id("0364"),
    afghanistanAirPollutionAmendment: id("0365"),
    angolaVehicleInspectionRegulation: id("0367"),
    angolaEnvironmentalStandardizationProgram: id("0368"),
    burundiRoadTrafficCode2012: id("0370"),
    burundiVehicleInspectionOrder2025: id("0371"),
    beninAirQualityDecree2001: id("0373"),
    beninAirQualityDecreeIndex: id("0374"),
    burkinaFasoAirQualityDecree2001: id("0376"),
    burkinaFasoCurrentCitation2025: id("0377"),
    bangladeshAirPollutionRules2022: id("0379"),
    bangladeshGazetteIndex2022: id("0380"),
    bahamasRoadTrafficAct: id("0382"),
    bahamasEnvironmentalPlanningAct: id("0383"),
    belarusTrCu018: id("0385"),
    belarusTrCu031: id("0386"),
    boliviaRm064Regulation: id("0388"),
    boliviaIbmetroAcceptance: id("0389"),
    moroccoEuro6Order2094: id("0393"),
    moroccoEuro6Order2251: id("0394"),
    kenyaAirQualityRegulations2024: id("0396"),
    kenyaInspectionRules2026: id("0397"),
    nigeriaNesrea: id("0400"),
    nigeriaVehicularEmissions2011: id("0722"),
    serbiaTechnicalConditions: id("0723"),
    uneceR49Rev6: id("0724"),
    montenegroEuro6Implementation: id("0725"),
    uneceR49Rev4: id("0726"),
    rwandaEas1047Implementation: id("0731"),
    cnHj1014: id("0732"),
    egyptExecRegulation338: id("0501"),
    egyptDecision710: id("0502"),
    ghanaEnvironmentalProtectionAct2025: id("0503"),
    ghanaMotorVehicleEmissionsStandard1219: id("0504"),
    israelRoadImr2026: id("0505"),
    israelNrmmImr2026: id("0506"),
    pakistanSro72OfficialIndex: id("0510"),
    pakistanSro72GazetteScan: id("0511"),
    qatarEuro5Policy2023: id("0513"),
    qatarTechnicalRegulationsDecision125: id("0514"),
    kuwaitGulfStandardsDecision372: id("0515"),
    kuwaitTechnicalRegulationsDecision44: id("0516"),
    omanBindingVehicleStandardsDecision120: id("0517"),
    omanGsoMotorVehicleRegulationsMy2026: id("0518"),
    jordanTransportGreenGrowthPlan: id("0519"),
    jordanTransportEmissionsStandardsCatalogue: id("0520"),
    cambodiaEnvironment: id("0525"),
    cambodiaTransport: id("0526"),
    laosEnvironment: id("0527"),
    laosTransport: id("0528"),
    sriLankaEnvironment: id("0529"),
    sriLankaTransport: id("0530"),
    mongoliaEnvironment: id("0531"),
    mongoliaTransport: id("0532"),
    costaRicaEnvironment: id("0537"),
    costaRicaTransport: id("0538"),
    ecuadorDieselStandard2207: id("0539"),
    ecuadorRte017: id("0540"),
    ecuadorRte017Amendment2025: id("0729"),
    dominicanRepublicEnvironment: id("0541"),
    dominicanRepublicTransport: id("0542"),
    algeriaEnvironment: id("0543"),
    algeriaTransport: id("0544"),
    tunisiaEnvironment: id("0549"),
    tunisiaTransport: id("0550"),
    ethiopiaEnvironment: id("0551"),
    ethiopiaTransport: id("0552"),
    guatemalaEnvironment: id("0555"),
    guatemalaTransport: id("0556"),
    hondurasEnvironment: id("0557"),
    hondurasTransport: id("0558"),
    panamaEnvironment: id("0559"),
    panamaTransport: id("0560"),
    uruguayEnvironment: id("0561"),
    uruguayTransport: id("0562"),
    botswanaGovernment: id("0567"),
    botswanaTransport: id("0568"),
    namibiaEnvironment: id("0569"),
    namibiaTransport: id("0570"),
    tanzaniaEnvironment: id("0571"),
    tanzaniaTransport: id("0572"),
    ugandaEnvironment: id("0573"),
    ugandaTransport: id("0574"),
    zambiaEnvironment: id("0579"),
    zambiaTransport: id("0580"),
    zimbabweEnvironment: id("0581"),
    zimbabweTransport: id("0582"),
    rwandaEnvironment: id("0585"),
    rwandaTransport: id("0586"),
    coteDIvoireEnvironment: id("0588"),
    coteDIvoireTransport: id("0589"),
    cameroonEnvironment: id("0590"),
    cameroonTransport: id("0591"),
    senegalEnvironment: id("0592"),
    senegalTransport: id("0593"),
    mozambiqueEnvironment: id("0597"),
    mozambiqueTransport: id("0598"),
    eswatiniGovernment: id("0599"),
    eswatiniTransport: id("0600"),
    lesothoGovernment: id("0601"),
    lesothoTransport: id("0602"),
    madagascarEnvironment: id("0606"), madagascarTransport: id("0607"),
    mauritiusEnvironment: id("0608"), mauritiusTransport: id("0609"),
    malawiGovernment: id("0610"), malawiTransport: id("0611"),
    fijiEnvironment: id("0612"), fijiTransport: id("0613"),
    belizeEnvironment: id("0618"), belizeTransport: id("0619"),
    bruneiEnvironment: id("0620"), bruneiTransport: id("0621"),
    bhutanEnvironment: id("0622"), bhutanTransport: id("0623"),
    centralAfricanRepublicEnvironment: id("0624"), centralAfricanRepublicTransport: id("0625"),
    democraticRepublicOfCongoEnvironment: id("0626"), democraticRepublicOfCongoTransport: id("0627"),
    republicOfCongoEnvironment: id("0628"), republicOfCongoTransport: id("0629"),
    cubaEnvironment: id("0630"), cubaTransport: id("0631"),
    djiboutiEnvironment: id("0632"), djiboutiTransport: id("0633"),
    eritreaEnvironmentalProtectionManagementRegulations127_2017: id("0634"),
    eritreaVehicleTechnicalStandardsRegulations61_2002: id("0635"),
    gabonEnvironmentalProtectionLaw007_2014: id("0636"),
    gabonHeavyVehicleHomologationOrder00097_2017: id("0637"),
    guineaEnvironment: id("0638"), guineaTransport: id("0639"),
    gambiaEnvironmentalQualityStandardsRegulations1999: id("0640"),
    gambiaMotorTrafficAmendmentAct2013: id("0641"),
    guineaBissauBasicEnvironmentLaw1_2011: id("0642"),
    guineaBissauTransportMinistryDirectory: id("0643"),
    equatorialGuineaEnvironmentalLaw7_2003: id("0644"),
    equatorialGuineaGeneralRoadTransportLaw4_2018: id("0645"),
    greenlandEnvironment: id("0646"), greenlandTransport: id("0647"),
    guyanaEnvironment: id("0648"), guyanaTransport: id("0649"),
    haitiEnvironment: id("0650"), haitiTransport: id("0651"),
    iranTechnicalPollutionRegulation: id("0652"), iranArticle4Amendment2024: id("0653"),
    iraqTr167AmendmentDecision2024: id("0654"), iraqTr167ImplementationNotice2025: id("0655"),
    jamaicaEnvironment: id("0656"), jamaicaTransport: id("0657"),
    lebanonEnvironmentalProtectionLaw444: id("0658"), lebanonThirdBur2019: id("0659"),
    liberiaEnvironmentalProtectionManagementLaw: id("0660"), liberiaVehicleAdministrativeRegulation2011: id("0661"),
    libyaEnvironmentalProtectionLaw15: id("0662"), libyaEnvironmentalExecutiveRegulation448: id("0663"),
    maliTechnicalInspectionOrder2020: id("0664"), maliRoadUseVehicleCirculationDecree2023: id("0665"),
    myanmarEnvironment: id("0666"), myanmarTransport: id("0667"),
    mauritaniaAirPollutionLaw2018: id("0668"), mauritaniaEnvironmentCode2000: id("0669"),
    newCaledoniaEnvironment: id("0670"), newCaledoniaTransport: id("0671"),
    nigerEnvironmentalFrameworkLaw9856: id("0672"), nigerMotorVehicleHomologationEServices: id("0673"),
    nicaraguaEnvironment: id("0674"), nicaraguaTransport: id("0675"),
    papuaNewGuineaEnvironment: id("0676"), papuaNewGuineaTransport: id("0677"),
    puertoRicoEnvironment: id("0678"), puertoRicoTransport: id("0679"),
    northKoreaEnvironment: id("0680"), northKoreaTransport: id("0681"),
    paraguayEnvironment: id("0682"), paraguayTransport: id("0683"),
    palestineEnvironment: id("0684"), palestineTransport: id("0685"),
    sudanEnvironment: id("0686"), sudanTransport: id("0687"),
    solomonIslandsEnvironment: id("0688"), solomonIslandsTransport: id("0689"),
    sierraLeoneEnvironment: id("0690"), sierraLeoneTransport: id("0691"),
    elSalvadorEnvironment: id("0692"), elSalvadorTransport: id("0693"),
    somaliaEnvironment: id("0694"), somaliaTransport: id("0695"),
    southSudanEnvironment: id("0696"), southSudanTransport: id("0697"),
    surinameEnvironment: id("0698"), surinameTransport: id("0699"),
    syriaEnvironmentLaw12: id("0700"), syriaVehicleImportNotice2025: id("0701"),
    chadEnvironment: id("0702"), chadTransport: id("0703"),
    togoEnvironment: id("0704"), togoTransport: id("0705"),
    timorLesteEnvironment: id("0706"), timorLesteTransport: id("0707"),
    trinidadTobagoEnvironment: id("0708"), trinidadTobagoTransport: id("0709"),
    taiwanEnvironment: id("0710"), taiwanTransport: id("0711"),
    venezuelaEnvironment: id("0712"), venezuelaTransport: id("0713"),
    vanuatuEnvironment: id("0714"), vanuatuTransport: id("0715"),
    yemenEnvironment: id("0716"), yemenTransport: id("0717"),
    antarcticaBoundary: id("0718"), frenchSouthernLandsBoundary: id("0719"),
    westernSaharaBoundary: id("0720"), falklandIslandsBoundary: id("0721"),
    usEcfr1036: id("0203"),
    usEcfr1039: id("0210"),
    usEcfr86: id("0204"),
    usFr91x43154: id("0211"),
  },
  jurisdiction: {
    brConama: id("0304"),
    cnMee: id("0301"),
    eu: id("0303"),
    eaeu: id("0392"),
    japan: id("0305"),
    korea: id("0306"),
    mexicoSemarnat: id("0307"),
    turkey: id("0308"),
    australia: id("0309"),
    canada: id("0310"),
    unitedKingdom: id("0311"),
    india: id("0312"),
    russia: id("0313"),
    indonesia: id("0314"),
    thailand: id("0315"),
    vietnam: id("0316"),
    malaysia: id("0317"),
    saudiArabia: id("0318"),
    unitedArabEmirates: id("0319"),
    southAfrica: id("0320"),
    argentina: id("0321"),
    newZealand: id("0322"),
    chile: id("0323"),
    colombia: id("0324"),
    peru: id("0325"),
    philippines: id("0326"),
    singapore: id("0327"),
    norway: id("0328"),
    iceland: id("0329"),
    liechtenstein: id("0330"),
    switzerland: id("0331"),
    serbia: id("0332"),
    bosnia: id("0333"),
    northMacedonia: id("0334"),
    montenegro: id("0335"),
    albania: id("0336"),
    ukraine: id("0337"),
    moldova: id("0338"),
    nepal: id("0339"),
    armenia: id("0340"),
    azerbaijan: id("0345"),
    georgia: id("0348"),
    uzbekistan: id("0351"),
    kazakhstan: id("0354"),
    tajikistan: id("0357"),
    kyrgyzstan: id("0360"),
    turkmenistan: id("0363"),
    afghanistan: id("0366"),
    angola: id("0369"),
    burundi: id("0372"),
    benin: id("0375"),
    burkinaFaso: id("0378"),
    bangladesh: id("0381"),
    bahamas: id("0384"),
    belarus: id("0387"),
    bolivia: id("0390"),
    morocco: id("0395"),
    kenya: id("0398"),
    nigeria: id("0499"),
    egypt: id("0507"),
    ghana: id("0508"),
    israel: id("0509"),
    pakistan: id("0512"),
    qatar: id("0521"),
    kuwait: id("0522"),
    oman: id("0523"),
    jordan: id("0524"),
    cambodia: id("0533"),
    laos: id("0534"),
    sriLanka: id("0535"),
    mongolia: id("0536"),
    costaRica: id("0545"),
    ecuador: id("0546"),
    dominicanRepublic: id("0547"),
    algeria: id("0548"),
    tunisia: id("0553"),
    ethiopia: id("0554"),
    guatemala: id("0563"),
    honduras: id("0564"),
    panama: id("0565"),
    uruguay: id("0566"),
    botswana: id("0575"),
    namibia: id("0576"),
    tanzania: id("0577"),
    uganda: id("0578"),
    zambia: id("0583"),
    zimbabwe: id("0584"),
    rwanda: id("0587"),
    coteDIvoire: id("0594"),
    cameroon: id("0595"),
    senegal: id("0596"),
    mozambique: id("0603"),
    eswatini: id("0604"),
    lesotho: id("0605"),
    madagascar: id("0614"), mauritius: id("0615"), malawi: id("0616"), fiji: id("0617"),
    belize: id("0618"), brunei: id("0619"), bhutan: id("0620"), centralAfricanRepublic: id("0621"),
    democraticRepublicOfCongo: id("0622"), republicOfCongo: id("0623"), cuba: id("0624"), djibouti: id("0625"),
    eritrea: id("0626"), gabon: id("0627"), guinea: id("0628"), gambia: id("0629"),
    guineaBissau: id("0630"), equatorialGuinea: id("0631"), greenland: id("0632"), guyana: id("0633"),
    haiti: id("0634"), iran: id("0635"), iraq: id("0636"), jamaica: id("0637"),
    lebanon: id("0638"), liberia: id("0639"), libya: id("0640"), mali: id("0641"), myanmar: id("0642"), mauritania: id("0643"),
    newCaledonia: id("0644"), niger: id("0645"), nicaragua: id("0646"), papuaNewGuinea: id("0647"),
    puertoRico: id("0648"), northKorea: id("0649"), paraguay: id("0650"), palestine: id("0651"),
    sudan: id("0652"), solomonIslands: id("0653"), sierraLeone: id("0654"), elSalvador: id("0655"), somalia: id("0656"), southSudan: id("0657"),
    suriname: id("0658"), syria: id("0659"), chad: id("0660"), togo: id("0661"),
    timorLeste: id("0662"), trinidadTobago: id("0663"), taiwan: id("0664"),
    venezuela: id("0665"), vanuatu: id("0666"), yemen: id("0667"),
    antarctica: id("0668"), frenchSouthernLands: id("0669"), westernSahara: id("0670"),
    falklandIslands: id("0671"),
    usEpa: id("0302"),
  },
  regulation: {
    brConama403: id("0412"),
    brConama433: id("0409"),
    brConama490: id("0408"),
    cnGb17691: id("0401"),
    cnGb20891: id("0402"),
    euReg1257: id("0407"),
    euReg1628: id("0406"),
    euReg595: id("0405"),
    japanOffroad2014: id("0414"),
    japanRoad2016: id("0413"),
    koreaAgriculture2021: id("0417"),
    koreaConstruction2020: id("0416"),
    koreaRoad2017: id("0415"),
    mexicoNom044Table1: id("0418"),
    mexicoNom044Table2: id("0419"),
    turkeyRoad2016: id("0420"),
    turkeyNonroadStageV: id("0421"),
    australiaAdr80_03: id("0422"),
    australiaAdr80_04: id("0423"),
    canadaRoad2003: id("0424"),
    canadaOffroad2020: id("0425"),
    unitedKingdomNrmmStageV: id("0426"),
    indiaBs6: id("0427"),
    indiaCevStageIv: id("0428"),
    indiaCevStageV: id("0429"),
    indiaTremStageIv: id("0430"),
    indiaTremStageV: id("0431"),
    indiaTrem2026Draft: id("0432"),
    russiaRoadClass5: id("0433"),
    russiaAgricultureClass3A: id("0434"),
    indonesiaEuro4: id("0435"),
    vietnamLevel5: id("0436"),
    malaysiaEuro2: id("0437"),
    argentinaEuroV: id("0438"),
    newZealandEuroVi: id("0439"),
    chileHeavyVehicleEuroVi: id("0440"),
    chileMobileMachineryStageV: id("0441"),
    chileTractorStageV: id("0442"),
    colombiaHeavyVehicleEuroVi: id("0443"),
    colombiaNonRoadTable23: id("0444"),
    peruHeavyVehicleEuroVi: id("0445"),
    singaporeHeavyVehicleEuroVi: id("0446"),
    singaporeOffRoadStageIi: id("0447"),
    norwayHeavyVehicleEuroVi: id("0448"),
    norwayNrmmStageV: id("0449"),
    icelandHeavyVehicleEuroVi: id("0450"),
    icelandNrmmStageV2020: id("0451"),
    icelandNrmmStageV2021: id("0452"),
    liechtensteinHeavyVehicleEuroVi: id("0453"),
    liechtensteinNrmmStageV: id("0454"),
    switzerlandHeavyVehicleEuroVi: id("0455"),
    switzerlandNrmmStageV: id("0456"),
    nigeriaVehicularEmissions2011: id("0457"),
    sriLankaVehicleEmission2018: id("0458"),
    algeriaVehicleEmissions2003: id("0459"),
    ethiopiaVehicleEmission2025: id("0460"),
    uruguayDecree1352021: id("0461"),
    ugandaAirQuality2024: id("0462"),
    papuaNewGuineaHeavyTruckAdr803: id("0463"),
    taiwanHeavyDieselPhase6: id("0464"),
    venezuelaHeavyDieselMy2000: id("0465"),
    ukraineRoadEuroV: id("0466"),
    thailandHeavyDieselLevel6: id("0467"),
    bosniaR49Series06: id("0468"),
    montenegroEuroVi: id("0469"),
    nepalHeavyVehicle2082: id("0470"),
    kazakhstanRoadClass5: id("0471"),
    kazakhstanAgricultureStageIIIA: id("0472"),
    kyrgyzstanRoadClass5: id("0473"),
    kyrgyzstanAgricultureStageIIIA: id("0474"),
    uzbekistanAgricultureStageIIIA: id("0475"),
    armeniaRoadClass5: id("0476"),
    armeniaAgricultureStageIIIA: id("0477"),
    belarusRoadClass5: id("0478"),
    belarusAgricultureStageIIIA: id("0479"),
    georgiaRoadClass5: id("0480"),
    bangladeshHeavyDiesel2022: id("0481"),
    boliviaRm064HeavyDiesel: id("0482"),
    southAfricaR4902B: id("0483"),
    uaeHeavyVehicleEuro6B: id("0484"),
    saudiHeavyVehicleEuroVMy2026: id("0485"),
    ecuadorHeavyDieselRte017: id("0486"),
    philippinesHeavyDieselEuroIv: id("0487"),
    pakistanHeavyDieselPakIi: id("0488"),
    israelRoadEuroVi2026: id("0489"),
    israelConstructionStageV2026: id("0490"),
    rwandaRoadEuroIv: id("0491"),
    us1036104: id("0403"),
    us1039101: id("0410"),
    us8600711: id("0404"),
    usFr91x43154: id("0411"),
  },
} as const;

/**
 * Regulations whose legal identity is publishable without numeric limit rows.
 * This covers both an explicitly signed-off source conflict and a proposed
 * schedule-only instrument that must remain visible as metadata. With no limit
 * rows, every application-scope query still fails closed as no-data.
 */
export const acceptedLimitUnavailableRegulationIds = [
  acceptanceFixtureIds.regulation.ugandaAirQuality2024,
  acceptanceFixtureIds.regulation.indiaTrem2026Draft,
] as const;

export const fixtureSources: (typeof dataSources.$inferInsert)[] = [
  {
    ...recordTimestamps,
    id: acceptanceFixtureIds.source.cnGb17691,
    isDemo: false,
    publishedOn: "2018-06-22",
    publisher: "生态环境部",
    sourceType: "official-regulation",
    title: "GB 17691-2018 重型柴油车污染物排放限值及测量方法（中国第六阶段）",
    url: "https://www.mee.gov.cn/ywgz/fgbz/bz/bzwb/dqhjbh/dqydywrwpfbz/201807/t20180703_445995.shtml",
  },
  {
    ...chinaNonroadRecordTimestamps,
    id: acceptanceFixtureIds.source.cnGb20891,
    isDemo: false,
    publishedOn: "2014-05-16",
    publisher: "生态环境部",
    sourceType: "official-regulation",
    title:
      "GB 20891-2014 非道路移动机械用柴油机排气污染物排放限值及测量方法（中国第三、四阶段）及第 1 号修改单",
    url: "https://www.mee.gov.cn/ywgz/fgbz/bz/bzwb/dqhjbh/dqydywrwpfbz/201405/t20140530_276305.shtml",
  },
  {
    ...chinaNonroadRecordTimestamps,
    id: acceptanceFixtureIds.source.cnHj1014,
    isDemo: false,
    publishedOn: "2020-12-28",
    publisher: "生态环境部",
    sourceType: "official-regulation",
    title: "HJ 1014-2020 非道路柴油移动机械污染物排放控制技术要求",
    url: "https://www.mee.gov.cn/ywgz/fgbz/bz/bzwb/dqhjbh/dqydywrwpfbz/202012/t20201231_815684.shtml",
  },
  {
    ...unitedStatesRecordTimestamps,
    id: acceptanceFixtureIds.source.usEcfr1036,
    isDemo: false,
    publishedOn: null,
    publisher:
      "Office of the Federal Register (NARA) / U.S. Government Publishing Office; issuing agency: U.S. Environmental Protection Agency",
    sourceType: "official-regulation",
    title:
      "40 CFR § 1036.104 — Criteria pollutant emission standards—NOX, HC, PM, and CO (eCFR)",
    url: "https://www.ecfr.gov/current/title-40/chapter-I/subchapter-U/part-1036/subpart-B/section-1036.104",
  },
  {
    ...unitedStatesRecordTimestamps,
    id: acceptanceFixtureIds.source.usEcfr86,
    isDemo: false,
    publishedOn: null,
    publisher:
      "Office of the Federal Register (NARA) / U.S. Government Publishing Office; issuing agency: U.S. Environmental Protection Agency",
    sourceType: "official-regulation",
    title:
      "40 CFR § 86.007-11 — Emission standards and supplemental requirements for 2007 and later model year diesel heavy-duty engines and vehicles (eCFR)",
    url: "https://www.ecfr.gov/current/title-40/chapter-I/subchapter-C/part-86/subpart-A/section-86.007-11",
  },
  {
    ...unitedStatesRecordTimestamps,
    id: acceptanceFixtureIds.source.usEcfr1039,
    isDemo: false,
    publishedOn: null,
    publisher:
      "Office of the Federal Register (NARA) / U.S. Government Publishing Office; issuing agency: U.S. Environmental Protection Agency",
    sourceType: "official-regulation",
    title:
      "40 CFR § 1039.101 — What exhaust emission standards must my engines meet after the 2014 model year? (eCFR)",
    url: "https://www.ecfr.gov/current/title-40/chapter-I/subchapter-U/part-1039/subpart-B/section-1039.101",
  },
  {
    ...recordTimestamps,
    id: acceptanceFixtureIds.source.usFr91x43154,
    isDemo: false,
    publishedOn: "2026-07-14",
    publisher: "Office of the Federal Register",
    sourceType: "government-notice",
    title:
      "91 FR 43154 Amendments and Nonconformance Penalties for Model Year 2027 and Later Heavy-Duty Highway Engines (proposed rule)",
    url: "https://www.federalregister.gov/documents/2026/07/14/2026-14112/amendments-and-nonconformance-penalties-for-model-year-2027-and-later-heavy-duty-highway-engines",
  },
  {
    ...recordTimestamps,
    id: acceptanceFixtureIds.source.euReg595,
    isDemo: false,
    publishedOn: "2009-07-18",
    publisher: "European Parliament and Council",
    sourceType: "official-regulation",
    title:
      "Regulation (EC) No 595/2009 on type-approval of heavy-duty vehicles (Euro VI)",
    url: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32009R0595",
  },
  {
    ...recordTimestamps,
    id: acceptanceFixtureIds.source.euReg1628,
    isDemo: false,
    publishedOn: "2016-09-16",
    publisher: "European Parliament and Council",
    sourceType: "official-regulation",
    title:
      "Regulation (EU) 2016/1628 on requirements relating to gaseous and particulate pollutant emission limits and type-approval for internal combustion engines for non-road mobile machinery (Stage V)",
    url: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R1628",
  },
  {
    ...recordTimestamps,
    id: acceptanceFixtureIds.source.euReg1257,
    isDemo: false,
    publishedOn: "2024-05-10",
    publisher: "European Parliament and Council",
    sourceType: "official-regulation",
    title:
      "Regulation (EU) 2024/1257 on type-approval of motor vehicles and engines (Euro 7)",
    url: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1257",
  },
  {
    ...euMembershipRecordTimestamps,
    id: acceptanceFixtureIds.source.euCountries,
    isDemo: false,
    publishedOn: null,
    publisher: "European Union",
    sourceType: "other",
    title: "EU countries: official country profiles and accession dates (27 Member States)",
    url: "https://european-union.europa.eu/principles-countries-history/eu-countries_en",
  },
  {
    ...eaeuRecordTimestamps,
    id: acceptanceFixtureIds.source.eaeuMemberStates,
    isDemo: false,
    publishedOn: null,
    publisher: "Eurasian Economic Commission",
    sourceType: "other",
    title: "Eurasian Economic Union: member states and treaty overview",
    url: "https://eaeunion.org/comission/department/deptexreg/",
  },
  {
    ...japanRecordTimestamps,
    id: acceptanceFixtureIds.source.japanRoadSafety,
    isDemo: false,
    publishedOn: null,
    publisher: "国土交通省 / e-Gov 法令検索",
    sourceType: "official-regulation",
    title:
      "道路運送車両の保安基準（昭和二十六年運輸省令第六十七号）第三十一条",
    url: "https://elaws.e-gov.go.jp/document?lawid=326M50000800067",
  },
  {
    ...japanRecordTimestamps,
    id: acceptanceFixtureIds.source.japanRoadHistory,
    isDemo: false,
    publishedOn: null,
    publisher: "環境省",
    sourceType: "government-notice",
    title: "自動車排出ガス規制の経緯（ガソリン・ディーゼル車）",
    url: "https://www.env.go.jp/content/900400270.pdf",
  },
  {
    ...japanRecordTimestamps,
    id: acceptanceFixtureIds.source.japanOffroadNotice,
    isDemo: false,
    publishedOn: "2006-03-28",
    publisher: "経済産業省・国土交通省・環境省",
    sourceType: "official-regulation",
    title:
      "特定特殊自動車排出ガスの規制等に関して必要な事項を定める告示（平成十八年三省告示第一号、最終改正令和六年三省告示第四号）",
    url: "https://www.env.go.jp/content/000398439.pdf",
  },
  {
    ...koreaRecordTimestamps,
    id: acceptanceFixtureIds.source.koreaRulePage,
    isDemo: false,
    publishedOn: "2026-06-26",
    publisher: "대한민국 기후에너지환경부 / 국가법령정보센터",
    sourceType: "official-regulation",
    title: "대기환경보전법 시행규칙 (현행, 제62조 및 별표 17 근거 조문)",
    url:
      "https://www.law.go.kr/lsSc.do?section=&menuId=1&subMenuId=15&tabMenuId=81&eventGubun=060101&query=%EB%8C%80%EA%B8%B0%ED%99%98%EA%B2%BD%EB%B3%B4%EC%A0%84%EB%B2%95+%EC%8B%9C%ED%96%89%EA%B7%9C%EC%B9%99",
  },
  {
    ...koreaRecordTimestamps,
    id: acceptanceFixtureIds.source.koreaRuleAnnex17,
    isDemo: false,
    publishedOn: "2026-06-26",
    publisher: "대한민국 기후에너지환경부 / 국가법령정보센터",
    sourceType: "official-regulation",
    title: "대기환경보전법 시행규칙 별표 17 제작차배출허용기준 (2026.6.26 개정)",
    url:
      "https://www.law.go.kr/flDownload.do?gubun=&flSeq=167031783&bylClsCd=110201",
  },
  {
    ...mexicoRecordTimestamps,
    id: acceptanceFixtureIds.source.mexicoNom044,
    isDemo: false,
    publishedOn: "2018-02-19",
    publisher: "Secretaría de Medio Ambiente y Recursos Naturales / Diario Oficial de la Federación",
    sourceType: "official-regulation",
    title:
      "NOM-044-SEMARNAT-2017（DOF 2018-02-19）：新柴油发动机和 GVW > 3,857 kg 新车辆排放限值",
    url: "https://dof.gob.mx/nota_detalle.php?codigo=5513626&fecha=19/02/2018",
  },
  {
    ...mexicoRecordTimestamps,
    id: acceptanceFixtureIds.source.mexicoNom044Amend2020,
    isDemo: false,
    publishedOn: "2020-11-11",
    publisher: "Secretaría de Medio Ambiente y Recursos Naturales / Diario Oficial de la Federación",
    sourceType: "government-notice",
    title:
      "NOM-044-SEMARNAT-2017 标准 AA 期限修订（DOF 2020-11-11，延至 2021-12-31）",
    url: "https://dof.gob.mx/nota_detalle.php?codigo=5604713&fecha=11/11/2020",
  },
  {
    ...mexicoRecordTimestamps,
    id: acceptanceFixtureIds.source.mexicoNom044Amend2021,
    isDemo: false,
    publishedOn: "2021-11-26",
    publisher: "Secretaría de Medio Ambiente y Recursos Naturales / Diario Oficial de la Federación",
    sourceType: "government-notice",
    title:
      "NOM-044-SEMARNAT-2017 标准 AA 期限修订（DOF 2021-11-26，延至 2024-12-31）",
    url: "https://dof.gob.mx/nota_detalle.php?codigo=5636495&fecha=26/11/2021",
  },
  {
    ...turkeyRecordTimestamps,
    id: acceptanceFixtureIds.source.turkeyRoadRegulation,
    isDemo: false,
    publishedOn: "2013-09-25",
    publisher: "Türkiye Cumhuriyeti Resmî Gazete / Bilim, Sanayi ve Teknoloji Bakanlığı",
    sourceType: "official-regulation",
    title:
      "Ağır Hizmet Araçlarından Çıkan Emisyonlar (Euro 6) Yönetmeliği değişikliği ((AT) 595/2009)",
    url: "https://www.resmigazete.gov.tr/eskiler/2013/09/20130925-2.htm",
  },
  {
    ...turkeyRecordTimestamps,
    id: acceptanceFixtureIds.source.turkeyRoadAmendment2021,
    isDemo: false,
    publishedOn: "2021-10-15",
    publisher: "Türkiye Cumhuriyeti Resmî Gazete",
    sourceType: "government-notice",
    title: "重型车辆 Euro VI 型式批准法规 2021 年修订公报附件",
    url: "https://www.resmigazete.gov.tr/eskiler/2021/10/20211015-4.pdf",
  },
  {
    ...turkeyRecordTimestamps,
    id: acceptanceFixtureIds.source.turkeyNonroadRegulation,
    isDemo: false,
    publishedOn: "2020-09-11",
    publisher: "Türkiye Cumhuriyeti Resmî Gazete / Sanayi ve Teknoloji Bakanlığı",
    sourceType: "official-regulation",
    title:
      "Karayolu Dışında Kullanılan Hareketli Makinalara Takılan İçten Yanmalı Motorlar için Emisyon Sınırları ve Tip Onayı Yönetmeliği (2016/1628/AB)",
    url: "https://resmigazete.gov.tr/eskiler/2020/09/20200911-3.htm",
  },
  {
    ...turkeyRecordTimestamps,
    id: acceptanceFixtureIds.source.turkeyNonroadAnnex,
    isDemo: false,
    publishedOn: "2020-09-11",
    publisher: "Türkiye Cumhuriyeti Resmî Gazete",
    sourceType: "official-regulation",
    title: "2016/1628/AB NRE Stage V 官方附件（限值表与市场投放日期）",
    url: "https://resmigazete.gov.tr/eskiler/2020/09/20200911-3-1.pdf",
  },
  {
    ...turkeyRecordTimestamps,
    id: acceptanceFixtureIds.source.turkeyAgricultureTypeApproval,
    isDemo: false,
    publishedOn: null,
    publisher: "Tarım ve Orman Bakanlığı",
    sourceType: "other",
    title: "Tarım ve Orman Traktörleri AB Tip Onay Deneyleri（农业拖拉机 AB 型式批准入口）",
    url: "https://www.tarimorman.gov.tr/TRGM/tamtest/Menu/98/Tarim-Ve-Orman-Traktorleri-Ab-Tip-Onay-Deneyleri",
  },
  {
    ...australiaRecordTimestamps,
    id: acceptanceFixtureIds.source.australiaAdrCurrent,
    isDemo: false,
    publishedOn: null,
    publisher:
      "Australian Government Department of Infrastructure, Transport, Regional Development, Communications, Sport and the Arts",
    sourceType: "other",
    title: "Current Australian Design Rules（ADR 官方目录）",
    url:
      "https://www.infrastructure.gov.au/infrastructure-transport-vehicles/vehicles/vehicle-design-regulation/australian-design-rules/third-edition",
  },
  {
    ...australiaRecordTimestamps,
    id: acceptanceFixtureIds.source.australiaAdr80_03,
    isDemo: false,
    publishedOn: "2006-12-13",
    publisher: "Australian Government Federal Register of Legislation",
    sourceType: "official-regulation",
    title:
      "Vehicle Standard (Australian Design Rule 80/03 – Emission Control for Heavy Vehicles) 2006",
    url: "https://www.legislation.gov.au/F2006L04062/latest/text",
  },
  {
    ...australiaRecordTimestamps,
    id: acceptanceFixtureIds.source.australiaAdr80_04,
    isDemo: false,
    publishedOn: "2023-02-20",
    publisher: "Australian Government Federal Register of Legislation",
    sourceType: "official-regulation",
    title:
      "Vehicle Standard (Australian Design Rule 80/04 – Emission Control for Heavy Vehicles) 2023",
    url: "https://www.legislation.gov.au/F2023L00129/latest/text",
  },
  {
    ...australiaRecordTimestamps,
    id: acceptanceFixtureIds.source.australiaAdr80Qna,
    isDemo: false,
    publishedOn: null,
    publisher:
      "Australian Government Department of Infrastructure, Transport, Regional Development, Communications, Sport and the Arts",
    sourceType: "government-notice",
    title: "Questions and answers on the new ADR 80/04（Euro VI 重型车辆官方问答）",
    url:
      "https://www.infrastructure.gov.au/infrastructure-transport-vehicles/vehicles/vehicle-safety-environment/questions-and-answers-new-adr-8004",
  },
  {
    ...australiaRecordTimestamps,
    id: acceptanceFixtureIds.source.australiaNrdeEvaluation,
    isDemo: false,
    publishedOn: "2024-01-02",
    publisher:
      "Australian Government Department of Climate Change, Energy, the Environment and Water",
    sourceType: "government-notice",
    title: "Noxious Emissions from Non-Road Diesel Engines（非道路柴油发动机官方评估）",
    url:
      "https://www.dcceew.gov.au/environment/protection/air-quality/national-clean-air-agreement/evaluation-non-road-diesel-engine-emissions",
  },
  {
    ...australiaRecordTimestamps,
    id: acceptanceFixtureIds.source.australiaDieselHdStandards,
    isDemo: false,
    publishedOn: null,
    publisher:
      "Australian Government Department of Infrastructure, Transport, Regional Development, Communications, Sport and the Arts",
    sourceType: "official-regulation",
    title: "Standards for Diesel Heavy Duty Vehicles（澳大利亚官方柴油重型车辆标准汇总）",
    url:
      "https://www.infrastructure.gov.au/sites/default/files/documents/Standards_for_Diesel_HDVs.pdf",
  },
  {
    ...canadaRecordTimestamps,
    id: acceptanceFixtureIds.source.canadaRoadRegulation,
    isDemo: false,
    publishedOn: "2003-01-01",
    publisher: "Department of Justice Canada / Environment and Climate Change Canada",
    sourceType: "official-regulation",
    title: "On-Road Vehicle and Engine Emission Regulations (SOR/2003-2)",
    url: "https://laws-lois.justice.gc.ca/eng/regulations/SOR-2003-2/index.html",
  },
  {
    ...canadaRecordTimestamps,
    id: acceptanceFixtureIds.source.canadaOffroadRegulation,
    isDemo: false,
    publishedOn: "2020-12-23",
    publisher: "Department of Justice Canada / Environment and Climate Change Canada",
    sourceType: "official-regulation",
    title:
      "Off-road Compression-Ignition (Mobile and Stationary) and Large Spark-Ignition Engine Emission Regulations (SOR/2020-258)",
    url: "https://laws-lois.justice.gc.ca/eng/regulations/SOR-2020-258/index.html",
  },
  {
    ...unitedKingdomRecordTimestamps,
    id: acceptanceFixtureIds.source.unitedKingdomNrmm,
    isDemo: false,
    publishedOn: "2023-05-11",
    publisher: "UK Vehicle Certification Agency / GOV.UK",
    sourceType: "official-regulation",
    title: "Non-road mobile machinery rules on type approval and engine markings (Stage V / provisional GB type approval)",
    url: "https://www.gov.uk/government/publications/non-road-mobile-machinery-rules-on-type-approval-and-engine-markings/non-road-mobile-machinery-rules-on-type-approval-and-engine-markings",
  },
  {
    ...unitedKingdomRecordTimestamps,
    id: acceptanceFixtureIds.source.unitedKingdomAgricultureApproval,
    isDemo: false,
    publishedOn: null,
    publisher: "UK Vehicle Certification Agency",
    sourceType: "other",
    title: "Type approval for agricultural vehicles (GB provisional type approval; EU 167/2013 and 2018/985 framework)",
    url: "https://www.vehicle-certification-agency.gov.uk/vehicle-type-approval/what-is-vehicle-type-approval/type-approval-for-agricultural-vehicles/",
  },
  {
    ...indiaRecordTimestamps,
    id: acceptanceFixtureIds.source.indiaBs6,
    isDemo: false,
    publishedOn: "2016-09-16",
    publisher: "India Ministry of Road Transport and Highways",
    sourceType: "official-regulation",
    title:
      "G.S.R. 889(E) mass emission standards for Bharat Stage VI vehicles",
    url: "https://morth.nic.in/backend/old_files/notifications_document/Notification_no_G_S_R_889_E_dated_16_09_2016_regarding_Mass_Emission_Standards_for_BS_VI.pdf",
  },
  {
    ...indiaRecordTimestamps,
    id: acceptanceFixtureIds.source.indiaCevTrem,
    isDemo: false,
    publishedOn: "2020-09-30",
    publisher: "India Ministry of Road Transport and Highways",
    sourceType: "official-regulation",
    title:
      "G.S.R. 598(E) separate emission standards for agricultural tractors and construction equipment vehicles",
    url: "https://morth.nic.in/backend/old_files/notifications_document/GSR%20598%20(E)%20dated%2030%20September%202020%20Seperate%20emission%20norms%20for%20agriculture%20tractors%20and%20CEV.pdf",
  },
  {
    ...indiaRecordTimestamps,
    id: acceptanceFixtureIds.source.indiaTremIvExtension,
    isDemo: false,
    publishedOn: "2022-11-24",
    publisher: "India Ministry of Road Transport and Highways",
    sourceType: "official-regulation",
    title: "G.S.R. 850(E) TREM-IV implementation extension to 1 January 2023",
    url: "https://morth.nic.in/backend/old_files/notifications_document/12-GSR%20850(E)%2024%20November%202022%20TREM%20extension%201st%20jan23.pdf",
  },
  {
    ...indiaRecordTimestamps,
    id: acceptanceFixtureIds.source.indiaTremVExtension,
    isDemo: false,
    publishedOn: "2024-02-27",
    publisher: "Gazette of India / Ministry of Road Transport and Highways",
    sourceType: "official-regulation",
    title: "G.S.R. 141(E) TREM-V implementation extension to 1 April 2026",
    url: "https://egazette.gov.in/",
  },
  {
    ...indiaRecordTimestamps,
    id: acceptanceFixtureIds.source.indiaTrem2026Draft,
    isDemo: false,
    publishedOn: "2026-02-27",
    publisher: "India Ministry of Road Transport and Highways",
    sourceType: "government-notice",
    title:
      "Draft G.S.R. 151(E) proposed power-band-specific TREM implementation dates",
    url: "https://morth.nic.in/backend/documents/uploaded/Combined%20GSR%20and%20Explanatory%20Note.pdf",
  },
  {
    ...russiaRecordTimestamps,
    id: acceptanceFixtureIds.source.russiaRoadRegulation,
    isDemo: false,
    publishedOn: "2011-12-09",
    publisher: "Eurasian Economic Commission",
    sourceType: "official-regulation",
    title:
      "TR CU 018/2011 On safety of wheeled vehicles (official regulation page and consolidated text link)",
    url: "https://eec.eaeunion.org/comission/department/deptexreg/tr/bezopKolesnTrS.php",
  },
  {
    ...russiaRecordTimestamps,
    id: acceptanceFixtureIds.source.russiaNationalDeviation,
    isDemo: false,
    publishedOn: "2022-05-13",
    publisher: "Official Internet Portal of Legal Information of Russia",
    sourceType: "official-regulation",
    title:
      "Government Decree No. 855 on special conformity rules for certain wheeled vehicles",
    url: "http://publication.pravo.gov.ru/document/0001202205130025",
  },
  {
    ...russiaRecordTimestamps,
    id: acceptanceFixtureIds.source.russiaAgricultureRegulation,
    isDemo: false,
    publishedOn: "2012-07-20",
    publisher: "Eurasian Economic Commission",
    sourceType: "official-regulation",
    title:
      "TR CU 031/2012 On safety of agricultural and forestry tractors and their trailers",
    url: "https://eec.eaeunion.org/comission/department/deptexreg/tr/bezopSH.php",
  },
  {
    ...russiaRecordTimestamps,
    id: acceptanceFixtureIds.source.russiaAgricultureAmendment2021,
    isDemo: false,
    publishedOn: "2021-11-19",
    publisher: "Eurasian Economic Commission Council",
    sourceType: "official-regulation",
    title:
      "EEC Council Decision No. 127 rewriting TR CU 031/2012 tractor emission requirements",
    url: "https://docs.eaeunion.org/docs/ru-ru/01430574/err_19112021_127",
  },
  {
    ...russiaRecordTimestamps,
    id: acceptanceFixtureIds.source.russiaAgricultureAmendment2024,
    isDemo: false,
    publishedOn: "2024-05-14",
    publisher: "Eurasian Economic Commission Council",
    sourceType: "official-regulation",
    title:
      "EEC Council Decision No. 32 setting the 2024-2025 tractor engine class transition dates",
    url: "https://docs.eaeunion.org/docs/ru-ru/01444555/err_14052024_32",
  },
  {
    ...russiaRecordTimestamps,
    id: acceptanceFixtureIds.source.russiaUneceR49,
    isDemo: false,
    publishedOn: null,
    publisher: "United Nations Economic Commission for Europe",
    sourceType: "official-regulation",
    title:
      "UN Regulation No. 49 Revision 5 (heavy-duty engine emission levels B2 and C)",
    url: "https://www.unece.org/fileadmin/DAM/trans/main/wp29/wp29regs/R049r5e.pdf",
  },
  {
    ...indonesiaRecordTimestamps,
    id: acceptanceFixtureIds.source.indonesiaEuro4,
    isDemo: false,
    publishedOn: "2017-03-10",
    publisher: "Indonesia Ministry of Environment and Forestry",
    sourceType: "official-regulation",
    title:
      "Minister of Environment and Forestry Regulation P.20/MENLHK/SETJEN/KUM.1/3/2017 on new-type M, N and O vehicle exhaust emission quality standards (Euro 4)",
    url: "https://jdih.menlhk.go.id/new2/home/portfolioDetails/20/2017/4",
  },
  {
    ...thailandRecordTimestamps,
    id: acceptanceFixtureIds.source.thailandTis3046,
    isDemo: false,
    publishedOn: "2020-08-18",
    publisher: "Thai Industrial Standards Institute, Ministry of Industry",
    sourceType: "official-regulation",
    title:
      "TIS 3046-2563 Heavy motor vehicle equipped with compression ignition engines: safety requirements; emission from engine, level 6",
    url: "https://service.tisi.go.th/fulltext/TIS3046-2563p_5055.pdf",
  },
  {
    ...thailandRecordTimestamps,
    id: acceptanceFixtureIds.source.thailandMinisterialRegulation,
    isDemo: false,
    publishedOn: "2023-07-03",
    publisher: "Ministry of Industry / Royal Thai Government Gazette",
    sourceType: "official-regulation",
    title:
      "Ministerial Regulation requiring heavy motor vehicles equipped with compression ignition engines to comply with TIS 3046-2563, B.E. 2566",
    url: "https://ratchakitcha.soc.go.th/documents/140A040N0000000000500.pdf",
  },
  {
    ...vietnamRecordTimestamps,
    id: acceptanceFixtureIds.source.vietnamDecision49,
    isDemo: false,
    publishedOn: "2011-09-01",
    publisher: "Prime Minister of Viet Nam / Government Electronic Information Portal",
    sourceType: "official-regulation",
    title:
      "Decision 49/2011/QD-TTg on the emission-standard roadmap for newly manufactured, assembled and imported motor vehicles",
    url: "https://vanban.chinhphu.vn/?pageid=27160&docid=151500",
  },
  {
    ...vietnamRecordTimestamps,
    id: acceptanceFixtureIds.source.vietnamQcvn109,
    isDemo: false,
    publishedOn: "2021-04-06",
    publisher: "Viet Nam Ministry of Transport / Government Electronic Information Portal",
    sourceType: "official-regulation",
    title:
      "Circular 06/2021/TT-BGTVT issuing QCVN 109:2021/BGTVT Level 5 emission requirements for new automobiles",
    url: "https://vanban.chinhphu.vn/?pageid=27160&docid=203069",
  },
  {
    ...malaysiaRecordTimestamps,
    id: acceptanceFixtureIds.source.malaysiaDieselRegulation,
    isDemo: false,
    publishedOn: "1996-08-29",
    publisher: "Malaysia Department of Environment",
    sourceType: "official-regulation",
    title:
      "Environmental Quality (Control of Emissions from Diesel Engines) Regulations 1996, P.U.(A) 429/96 (consolidated with P.U.(A) 488/2000)",
    url: "https://www.doe.gov.my/en/environmental-quality-control-of-emissions-from-diesel-engines-regulations-1996-p-u-a-429-96/",
  },
  {
    ...malaysiaRecordTimestamps,
    id: acceptanceFixtureIds.source.malaysiaVtaGuideline,
    isDemo: false,
    publishedOn: "2018-03-22",
    publisher: "Malaysia Department of Environment Vehicle Type Approval System",
    sourceType: "government-notice",
    title:
      "Motor Vehicle VTA Guidelines and User Manual - gaseous pollutant and noise emission limits",
    url: "https://vta.doe.gov.my/guidelines/Garis_Panduan_VTA_MV_V1.pdf",
  },
  {
    ...saudiArabiaRecordTimestamps,
    id: acceptanceFixtureIds.source.saudiGso42,
    isDemo: false,
    publishedOn: "2015-05-21",
    publisher: "GCC Standardization Organization",
    sourceType: "official-regulation",
    title:
      "GSO 42:2015 Motor Vehicles - General Requirements (current Gulf Technical Regulation catalogue record)",
    url: "https://www.gso.org.sa/store/standards/GSO:674566/GSO%2042:2015?lang=en",
  },
  {
    ...saudiArabiaRecordTimestamps,
    id: acceptanceFixtureIds.source.saudiGso144,
    isDemo: false,
    publishedOn: "1991-11-27",
    publisher: "GCC Standardization Organization",
    sourceType: "official-regulation",
    title:
      "GSO 144:1991 allowable limits of gaseous pollutants from heavy-duty diesel-engined vehicles (current Gulf Technical Regulation catalogue record and public preview)",
    url: "https://www.gso.org.sa/store/standards/GSO:478791/GSO%20144:1991?lang=en",
  },
  {
    ...saudiArabiaRecordTimestamps,
    id: acceptanceFixtureIds.source.saudiMachinerySafetyPart2,
    isDemo: false,
    publishedOn: "2021-05-21",
    publisher: "Saudi Standards, Metrology and Quality Organization",
    sourceType: "official-regulation",
    title:
      "Technical Regulation for Machinery Safety - Part 2: Mobile Machinery and Heavy Duty Equipment",
    url: "https://www.saso.gov.sa/en/Laws-And-Regulations/Technical_regulations/Documents/TR-Machinery-Safety-Part2-Mobile-Machinery-and-Heavy-Duty-Equipment.pdf",
  },
  {
    ...saudiArabiaRecordTimestamps,
    id: acceptanceFixtureIds.source.saudiVehicle2026TechnicalRegulations,
    isDemo: false,
    publishedOn: null,
    publisher: "GCC Standardization Organization",
    sourceType: "government-notice",
    title:
      "List of GSO Technical Regulations for Motor Vehicles (2026 Model Year), MY2026-D4",
    url: "https://www.gso.org.sa/wp-content/uploads/2024/12/GSO-Technical-Regulations-MV-2026-MY-D4.pdf",
  },
  {
    ...unitedArabEmiratesRecordTimestamps,
    id: acceptanceFixtureIds.source.uaeMandatoryStandards2018,
    isDemo: false,
    publishedOn: "2018-04-03",
    publisher: "United Arab Emirates Ministry of Cabinet Affairs / UAE Legislation",
    sourceType: "official-regulation",
    title:
      "Cabinet Resolution No. (13) of 2018 Regarding Mandatory Standards for the United Arab Emirates (UAE.S 5016:2018 and UAE.S 5019:2018)",
    url: "https://uaelegislation.gov.ae/en/legislations/2552",
  },
  {
    ...unitedArabEmiratesRecordTimestamps,
    id: acceptanceFixtureIds.source.uaeVehicleEmissionGuide,
    isDemo: false,
    publishedOn: null,
    publisher: "United Arab Emirates Ministry of Industry and Advanced Technology",
    sourceType: "government-notice",
    title: "Implementation guideline for new vehicle emission limits in the UAE",
    url: "https://www.gso.org.sa/wp-content/uploads/2025/04/Implementation-guideline-for-new-vehicle-emission-limits-in-the-UAE.pdf",
  },
  {
    ...southAfricaRecordTimestamps,
    id: acceptanceFixtureIds.source.southAfricaMotorVehiclesM23,
    isDemo: false,
    publishedOn: "2015-09-18",
    publisher:
      "South Africa Department of Trade and Industry / National Regulator for Compulsory Specifications",
    sourceType: "official-regulation",
    title:
      "Government Gazette No. 39220, Notice 613: Amendment to the Compulsory Specification for Motor Vehicles of Category M2/M3",
    url: "https://www.gov.za/sites/default/files/gcis_document/201509/39220gen613s.pdf",
  },
  {
    ...southAfricaRecordTimestamps,
    id: acceptanceFixtureIds.source.southAfricaMotorVehiclesN23,
    isDemo: false,
    publishedOn: "2015-09-18",
    publisher:
      "South Africa Department of Trade and Industry / National Regulator for Compulsory Specifications",
    sourceType: "official-regulation",
    title:
      "Government Gazette No. 39220, Notice 611: Amendment to the Compulsory Specification for Motor Vehicles of Category N2/N3",
    url: "https://www.gov.za/sites/default/files/gcis_document/201509/39220gon611.pdf",
  },
  {
    ...southAfricaRecordTimestamps,
    id: acceptanceFixtureIds.source.southAfricaDirective91542,
    isDemo: false,
    publishedOn: "1991-10-25",
    publisher: "Council of the European Communities / EUR-Lex",
    sourceType: "official-regulation",
    title:
      "Council Directive 91/542/EEC of 1 October 1991 amending Directive 88/77/EEC",
    url: "https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CELEX:31991L0542",
  },
  {
    ...argentinaRecordTimestamps,
    id: acceptanceFixtureIds.source.argentinaResolution1464,
    isDemo: false,
    publishedOn: null,
    publisher: "Argentina Secretaría de Ambiente y Desarrollo Sustentable / Infoleg",
    sourceType: "official-regulation",
    title:
      "Resolución 1464/2014: heavy-duty vehicle emission implementation under Decreto 779/95",
    url: "https://www.argentina.gob.ar/normativa/nacional/norma-240942/texto",
  },
  {
    ...argentinaRecordTimestamps,
    id: acceptanceFixtureIds.source.argentinaResolution128Exception,
    isDemo: false,
    publishedOn: "2018-03-26",
    publisher: "Argentina Secretaría de Ambiente y Desarrollo Sustentable / Infoleg",
    sourceType: "official-regulation",
    title:
      "Resolución 128/2018: temporary Euro III exception for special Ejército Argentino vehicles",
    url: "https://www.argentina.gob.ar/normativa/nacional/norma-308171/texto",
  },
  {
    ...argentinaRecordTimestamps,
    id: acceptanceFixtureIds.source.euDirective200555,
    isDemo: false,
    publishedOn: "2005-10-20",
    publisher: "European Union Publications Office / EUR-Lex",
    sourceType: "official-regulation",
    title:
      "Directive 2005/55/EC Annex I B2 heavy-duty diesel emission limits (Euro V)",
    url: "https://publications.europa.eu/resource/celex/32005L0055.ENG.pdf.l_27520051020en00010163.pdf",
  },
  {
    ...newZealandRecordTimestamps,
    id: acceptanceFixtureIds.source.newZealandVehicleExhaustRule,
    isDemo: false,
    publishedOn: "2025-05-30",
    publisher: "NZ Transport Agency Waka Kotahi",
    sourceType: "official-regulation",
    title:
      "Land Transport Rule: Vehicle Exhaust Emissions 2007, Rule 33001 (as at 30 May 2025)",
    url: "https://www.nzta.govt.nz/assets/resources/rules/docs/vehicle-exhaust-emissions-2007-as-at-30-may-2025.pdf",
  },
  {
    ...chileRecordTimestamps,
    id: acceptanceFixtureIds.source.chileMobileMachineryDecree39,
    isDemo: false,
    publishedOn: "2021-10-21",
    publisher: "Chile Ministerio del Medio Ambiente / Biblioteca del Congreso Nacional",
    sourceType: "official-regulation",
    title:
      "Decreto Supremo 39/2020: Norma de Emisión para Maquinarias Móviles (consolidated through Decreto 33/2024)",
    url: "https://www.bcn.cl/leychile/navegar?idNorma=1166850",
  },
  {
    ...chileRecordTimestamps,
    id: acceptanceFixtureIds.source.chileTractorAmendmentDecree33,
    isDemo: false,
    publishedOn: "2024-10-21",
    publisher: "Chile Ministerio del Medio Ambiente / Biblioteca del Congreso Nacional",
    sourceType: "official-regulation",
    title:
      "Decreto Supremo 33/2024: tractor mobile-machinery emissions extension to 2030",
    url: "https://www.bcn.cl/leychile/navegar?idNorma=1207629",
  },
  {
    ...chileRecordTimestamps,
    id: acceptanceFixtureIds.source.chileHeavyVehicleDecree50,
    isDemo: false,
    publishedOn: "2024-07-05",
    publisher: "Chile Ministerio del Medio Ambiente / Biblioteca del Congreso Nacional",
    sourceType: "official-regulation",
    title:
      "Decreto Supremo 50/2023: heavy-duty vehicle emission limits added as D.S. 55/1994 article 8 quater",
    url: "https://www.bcn.cl/leychile/navegar?idNorma=1204718",
  },
  {
    ...colombiaRecordTimestamps,
    id: acceptanceFixtureIds.source.colombiaResolution762,
    isDemo: false,
    publishedOn: "2022-07-18",
    publisher: "Colombia Ministerio de Ambiente y Desarrollo Sostenible",
    sourceType: "official-regulation",
    title:
      "Resolucion 0762 de 2022: limites de emisiones para fuentes moviles terrestres",
    url: "https://www.minambiente.gov.co/documento-normativa/resolucion-0762-de-2022/",
  },
  {
    ...peruRecordTimestamps,
    id: acceptanceFixtureIds.source.peruDecree029,
    isDemo: false,
    publishedOn: "2021-10-16",
    publisher: "Peru Ministerio del Ambiente / Diario Oficial El Peruano",
    sourceType: "official-regulation",
    title:
      "Decreto Supremo 029-2021-MINAM: modificacion de los limites para vehiculos automotores",
    url: "https://www.gob.pe/institucion/minam/normas-legales/2213166-029-2021-minam",
  },
  {
    ...philippinesRecordTimestamps,
    id: acceptanceFixtureIds.source.philippinesLtoMc20151946,
    isDemo: false,
    publishedOn: "2015-05-28",
    publisher:
      "Philippines Land Transportation Office / Supreme Court E-Library (National Administrative Register)",
    sourceType: "official-regulation",
    title:
      "LTO Memorandum Circular No. AVT-2015-1946 — Implementation of Vehicle Emission Limits for Euro 4/IV, and In-Use Vehicle Emission Standards",
    url: "https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/10/70901",
  },
  {
    ...philippinesRecordTimestamps,
    id: acceptanceFixtureIds.source.philippinesEuro4LimitsBoI,
    isDemo: false,
    publishedOn: null,
    publisher:
      "Philippines DENR Environmental Management Bureau / Board of Investments",
    sourceType: "government-notice",
    title:
      "Implementation of DENR Administrative Order on Euro 4/IV Vehicle Emission Limits",
    url: "https://www.boi.gov.ph/wp-content/uploads/2018/03/Implementation-of-DENR-Administrative-Order-on-Euro-4IV-Vehicle-Emission-Limits.pdf",
  },
  {
    ...philippinesRecordTimestamps,
    id: acceptanceFixtureIds.source.philippinesUnr49CycleNotice,
    isDemo: false,
    publishedOn: "2024-10-04",
    publisher: "Provincial Government of Negros Oriental",
    sourceType: "government-notice",
    title:
      "Supplemental/Bid Bulletin B-354-2024 — DAO 2015-04 and UNR 49-04 certificate-of-conformity requirement",
    url: "https://www.negor.gov.ph/supplemental-bid-bulletin-b-354-2024/",
  },
  {
    ...singaporeRecordTimestamps,
    id: acceptanceFixtureIds.source.singaporeVehicularAmendment2017,
    isDemo: false,
    publishedOn: "2017-08-30",
    publisher: "Singapore Statutes Online / Attorney-General's Chambers",
    sourceType: "official-regulation",
    title:
      "Environmental Protection and Management (Vehicular Emissions) (Amendment No. 2) Regulations 2017 (S 480/2017)",
    url: "https://sso.agc.gov.sg/SL-Supp/S480-2017/Published/20170830170000?DocDate=20170830170000",
  },
  {
    ...singaporeRecordTimestamps,
    id: acceptanceFixtureIds.source.singaporeOffRoad2012,
    isDemo: false,
    publisher: "Singapore Statutes Online / Attorney-General's Chambers",
    sourceType: "official-regulation",
    title:
      "Environmental Protection and Management (Off-Road Diesel Engine Emissions) Regulations 2012 (S 299/2012)",
    url: "https://sso.agc.gov.sg/SL/EPMA1999-S299-2012",
  },
  {
    ...singaporeRecordTimestamps,
    id: acceptanceFixtureIds.source.singaporeAirPollutionGuide,
    isDemo: false,
    publisher: "Singapore National Environment Agency",
    sourceType: "government-notice",
    title: "Air Pollution Regulations",
    url: "https://www.nea.gov.sg/our-services/pollution-control/air-pollution/air-pollution-regulations",
  },
  {
    ...norwayRecordTimestamps,
    id: acceptanceFixtureIds.source.norwayRoadRegulation,
    isDemo: false,
    publishedOn: "2022-06-30",
    publisher: "Norway Lovdata / Norwegian Public Roads Administration",
    sourceType: "official-regulation",
    title:
      "Forskrift om godkjenning av bil og tilhenger til bil (bilforskriften), FOR-2022-06-28-1233",
    url: "https://lovdata.no/dokument/SF/forskrift/2022-06-28-1233",
  },
  {
    ...norwayRecordTimestamps,
    id: acceptanceFixtureIds.source.norwayMachineryRegulation,
    isDemo: false,
    publishedOn: "2009-05-28",
    publisher: "Norway Lovdata / Norwegian Labour Inspection Authority",
    sourceType: "official-regulation",
    title:
      "Forskrift om maskiner (maskinforskriften), FOR-2009-05-20-544, Vedlegg XII",
    url: "https://lovdata.no/dokument/SF/forskrift/2009-05-20-544/kapittel_17",
  },
  {
    ...icelandRecordTimestamps,
    id: acceptanceFixtureIds.source.icelandRoadRegulation2013,
    isDemo: false,
    publisher: "Iceland Regulation Repository / Ministry of the Interior",
    sourceType: "official-regulation",
    title:
      "Reglugerð nr. 377/2013 um breytingu á reglugerð nr. 822/2004 um gerð og búnað ökutækja",
    url: "https://www.reglugerd.is/reglugerdir/allar/nr/377-2013",
  },
  {
    ...icelandRecordTimestamps,
    id: acceptanceFixtureIds.source.icelandRoadAmendment2026,
    isDemo: false,
    publishedOn: "2026-05-29",
    publisher: "Iceland Regulation Repository / Ministry of Infrastructure",
    sourceType: "official-regulation",
    title:
      "Reglugerð nr. 603/2026 um breytingu á reglugerð nr. 822/2004 um gerð og búnað ökutækja",
    url: "https://www.reglugerd.is/reglugerdir/allar/nr/0603-2026",
  },
  {
    ...icelandRecordTimestamps,
    id: acceptanceFixtureIds.source.icelandNrmmRegulation2020,
    isDemo: false,
    publishedOn: "2020-11-30",
    publisher: "Iceland Regulation Repository / Ministry of Social Affairs",
    sourceType: "official-regulation",
    title:
      "Reglugerð nr. 1200/2020 um losunarmörk og gerðarviðurkenningu hreyfla fyrir færanlegan vélbúnað utan vega",
    url: "https://www.reglugerd.is/reglugerdir/allar/nr/1200-2020",
  },
  {
    ...icelandRecordTimestamps,
    id: acceptanceFixtureIds.source.icelandNrmmRegulation2021,
    isDemo: false,
    publishedOn: "2021-02-22",
    publisher:
      "Iceland Regulation Repository / Ministry of Social Affairs and Labour Market",
    sourceType: "official-regulation",
    title:
      "Reglugerð nr. 179/2021 um losunarmörk og gerðarviðurkenningu hreyfla fyrir færanlegan vélbúnað utan vega",
    url: "https://www.reglugerd.is/reglugerdir/allar/nr/179-2021",
  },
  {
    ...liechtensteinRecordTimestamps,
    id: acceptanceFixtureIds.source.liechtensteinVts,
    isDemo: false,
    publishedOn: "2026-07-01",
    publisher: "Liechtenstein Landesverwaltung / Rechtsdienst der Regierung",
    sourceType: "official-regulation",
    title:
      "Verordnung über die technischen Anforderungen an Strassenfahrzeuge (VTS), LGBl. 1996 Nr. 143, Fassung 1. Juli 2026",
    url: "https://www.gesetze.li/konso/1996143000",
  },
  {
    ...liechtensteinRecordTimestamps,
    id: acceptanceFixtureIds.source.liechtensteinEwrStageV,
    isDemo: false,
    publishedOn: "2020-08-28",
    publisher: "Liechtenstein Landesverwaltung / EWR-Rechtssammlung",
    sourceType: "official-regulation",
    title:
      "Kundmachung LGBl. 2020 Nr. 258: EWR-Beschlüsse Nr. 38/2020 und 39/2020 zur Aufnahme der Verordnung (EU) 2016/1628",
    url: "https://www.gesetze.li/konso/2020258000",
  },
  {
    ...switzerlandRecordTimestamps,
    id: acceptanceFixtureIds.source.switzerlandVts,
    isDemo: false,
    publishedOn: "2026-07-01",
    publisher: "Swiss Federal Chancellery / Fedlex",
    sourceType: "official-regulation",
    title:
      "Verordnung vom 19. Juni 1995 über die technischen Anforderungen an Strassenfahrzeuge (VTS), SR 741.41, Stand 1. Juli 2026",
    url: "https://www.fedlex.admin.ch/eli/cc/1995/4425_4425_4425/de",
  },
  {
    ...serbiaRecordTimestamps,
    id: acceptanceFixtureIds.source.serbiaHomologationRulebook,
    isDemo: false,
    publishedOn: "2021-12-28",
    publisher:
      "Ministry of Construction, Transport and Infrastructure of the Republic of Serbia",
    sourceType: "official-regulation",
    title:
      "Pravilnik o homologaciji (consolidated homologation rulebook: SG RS 129/21, 110/22, 23/23 and 59/24)",
    url:
      "https://www.mgsi.gov.rs/sites/default/files/pravilnik_o_homologaciji_0.pdf",
  },
  {
    ...serbiaRecordTimestamps,
    id: acceptanceFixtureIds.source.serbiaTechnicalConditions,
    isDemo: false,
    publishedOn: null,
    publisher:
      "Ministry of Construction, Transport and Infrastructure of the Republic of Serbia",
    sourceType: "official-regulation",
    title:
      "Pravilnik o podeli motornih i priključnih vozila i tehničkim uslovima za vozila u saobraćaju na putevima (consolidated through SG RS 54/26)",
    url:
      "https://www.mgsi.gov.rs/sites/default/files/pravilnik_o_podeli_motornih_i_prikljucnih_vozila_i_tehnickim_uslovima_za_vozila_u_saobracaju_na_putevima.pdf",
  },
  {
    ...bosniaRecordTimestamps,
    id: acceptanceFixtureIds.source.bosniaMinimumRequirements,
    isDemo: false,
    publishedOn: "2019-03-26",
    publisher: "Ministry of Communications and Transport of Bosnia and Herzegovina",
    sourceType: "official-regulation",
    title:
      "Odluka o najnižim tehničkim zahtjevima za novoproizvedena i korištena vozila pri homologaciji tipa vozila i homologaciji pojedinačnog vozila, te za dijelove, uređaje i opremu vozila pri homologaciji tipa",
    url: "https://homologacija.gov.ba/Documents/Odluka%20o%20najnizim...%20Sl%20Gl%20BiH%20BR%20023_19.pdf",
  },
  {
    ...bosniaRecordTimestamps,
    id: acceptanceFixtureIds.source.bosniaR49Orders,
    isDemo: false,
    publishedOn: "2010-10-28",
    publisher: "Ministry of Communications and Transport of Bosnia and Herzegovina",
    sourceType: "official-regulation",
    title:
      "Naredbe o homologaciji — order implementing UNECE Regulation No. 49 for gaseous and particulate pollutants from compression-ignition engines",
    url: "https://homologacija.gov.ba/Documents/Naredbe%20o%20homologaciji.pdf",
  },
  {
    ...bosniaRecordTimestamps,
    id: acceptanceFixtureIds.source.uneceR49Rev6,
    isDemo: false,
    publishedOn: "2013-06-24",
    publisher: "United Nations Economic Commission for Europe / EUR-Lex",
    sourceType: "official-regulation",
    title:
      "UN Regulation No. 49 Revision 6 — emissions of gaseous and particulate pollutants from compression-ignition engines",
    url:
      "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:42013X0624(01)",
  },
  {
    ...centralAsiaRecordTimestamps,
    id: acceptanceFixtureIds.source.uneceR49Rev4,
    isDemo: false,
    publishedOn: "2008-08-13",
    publisher: "United Nations Economic Commission for Europe",
    sourceType: "official-regulation",
    title:
      "UN Regulation No. 49, Revision 4 — Uniform provisions concerning measures against gaseous and particulate pollutants from compression-ignition engines and positive ignition engines for use in vehicles",
    url:
      "https://digitallibrary.un.org/record/640040/files/E_ECE_324_Rev.1_Add.48_Rev.4_E_ECE_TRANS_505_Rev.1_Add.48_Rev.4-EN.pdf",
  },
  {
    ...northMacedoniaRecordTimestamps,
    id: acceptanceFixtureIds.source.northMacedoniaRoadApproval,
    isDemo: false,
    publishedOn: "2009-11-02",
    publisher:
      "Ministry of Economy / Official Gazette of the Republic of Macedonia",
    sourceType: "official-regulation",
    title:
      "Правилник за одобрување на нови моторни и приклучни возила, системи, составни делови и самостојни технички единици наменети за таквите возила",
    url: "https://slvesnik.com.mk/Issues/BC95C8FDB2BB1C41969F17BE58E7F316.pdf",
  },
  {
    ...northMacedoniaRecordTimestamps,
    id: acceptanceFixtureIds.source.northMacedoniaTractorApproval,
    isDemo: false,
    publishedOn: "2009-11-06",
    publisher:
      "Ministry of Economy / Official Gazette of the Republic of Macedonia",
    sourceType: "official-regulation",
    title:
      "Правилник за одобрување на земјоделски и шумски трактори",
    url: "https://slvesnik.com.mk/Issues/93BA570BCB131F4B93814D076C9003A0.pdf",
  },
  {
    ...montenegroRecordTimestamps,
    id: acceptanceFixtureIds.source.montenegroVehicleRequirements,
    isDemo: false,
    publishedOn: "2015-01-30",
    publisher: "Ministry of Transport / Government of Montenegro",
    sourceType: "official-regulation",
    title:
      "Pravilnik o tehničkim zahtjevima za vozila koja se uvoze ili prvi put stavljaju na tržište u Crnoj Gori",
    url: "https://www.gov.me/dokumenta/d11477e6-31d9-41c5-b787-ffbcda492f2a",
  },
  {
    ...montenegroRecordTimestamps,
    id: acceptanceFixtureIds.source.montenegroUneceR49,
    isDemo: false,
    publishedOn: "2013-03-04",
    publisher: "United Nations Economic Commission for Europe",
    sourceType: "official-regulation",
    title:
      "UN Regulation No. 49 Revision 6 — Uniform provisions concerning gaseous and particulate pollutants from C.I. and P.I. engines",
    url: "https://documents.un.org/api/symbol/access?l=en&s=E%2FECE%2F324%2FREV.1%2FADD.48%2FREV.6&t=pdf",
  },
  {
    ...montenegroRecordTimestamps,
    id: acceptanceFixtureIds.source.montenegroEuro6Implementation,
    isDemo: false,
    publishedOn: "2018-09-24",
    publisher: "Government of Montenegro / Ministry of Transport",
    sourceType: "government-notice",
    title:
      "Izmjene i dopune pravilnika o tehničkim zahtjevima — new M/N vehicles require EURO 6 from 15 October 2018",
    url: "https://www.gov.me/clanak/191855--izmjene-i-dopune-pravilnika-o-tehnickim-zahtjevima-za-vozila-koja-se-uvoze-ili-prvi-put-stavljaju-na-trziste-u-crnoj-gori",
  },
  {
    ...albaniaRecordTimestamps,
    id: acceptanceFixtureIds.source.albaniaGothenburgAccession,
    isDemo: false,
    publishedOn: "2011-11-25",
    publisher:
      "Assembly of the Republic of Albania / Official Publications Centre",
    sourceType: "official-regulation",
    title:
      "Law No. 10476 of 3 November 2011 on accession to the Gothenburg Protocol",
    url: "https://qbz.gov.al/alfresco/webdav/FZ/2011/155/fz-2011-155.pdf",
  },
  {
    ...albaniaRecordTimestamps,
    id: acceptanceFixtureIds.source.albaniaTreatyStatus,
    isDemo: false,
    publishedOn: null,
    publisher: "United Nations Treaty Collection",
    sourceType: "government-notice",
    title:
      "Gothenburg Protocol participant status: Albania not listed as a party as of 2026-08-10",
    url: "https://treaties.un.org/Pages/ViewDetails.aspx?src=TREATY&mtdsg_no=XXVII-1-h&chapter=27&clang=_en",
  },
  {
    ...ukraineRecordTimestamps,
    id: acceptanceFixtureIds.source.ukraineImportRegistrationLaw,
    isDemo: false,
    publishedOn: "2005-07-06",
    publisher: "Verkhovna Rada of Ukraine / Legislation of Ukraine",
    sourceType: "official-regulation",
    title:
      "Law of Ukraine No. 2739-IV on import and first registration of transport vehicles (current revision: Euro V through 2026; Euro VI from 2027 for road freight and passenger vehicles)",
    url: "https://zakon.rada.gov.ua/laws/show/2739-15#Text",
  },
  {
    ...ukraineRecordTimestamps,
    id: acceptanceFixtureIds.source.ukraineTypeApprovalOrder,
    isDemo: false,
    publishedOn: "2012-08-17",
    publisher:
      "Ukraine Ministry of Infrastructure / Verkhovna Rada Legislation of Ukraine",
    sourceType: "official-regulation",
    title:
      "Order No. 521 on vehicle type approval, as amended by Order No. 188 (Annex 2 item 52: UN R49-05 B2 / Directive 2005/55 B2 for M/N heavy vehicles)",
    url: "https://zakon.rada.gov.ua/laws/show/z1586-12#Text",
  },
  {
    ...moldovaRecordTimestamps,
    id: acceptanceFixtureIds.source.moldovaTypeApprovalDraftLaw,
    isDemo: false,
    publishedOn: "2026-07-01",
    publisher: "Government of the Republic of Moldova",
    sourceType: "government-notice",
    title:
      "Government approves draft law on type-approval and market surveillance of road vehicles (first modern national unified system; draft sent to Parliament)",
    url: "https://gov.md/en/comunicate-de-presa/more-road-safety-government-sets-clearer-rules-market-surveillance-motor",
  },
  {
    ...moldovaRecordTimestamps,
    id: acceptanceFixtureIds.source.moldovaTypeApprovalSecondaryConsultation,
    isDemo: false,
    publishedOn: "2026-07-17",
    publisher:
      "Moldova Ministry of Infrastructure and Regional Development / Particip.gov.md",
    sourceType: "government-notice",
    title:
      "Initiation notice for the draft secondary regulation on road-vehicle type approval and market surveillance",
    url: "https://particip.gov.md/ro/document/stages/proiectul-hotararii-guvernului-cu-privire-la-modificarea-unor-hotarari-ale-guvernului-si-aprobarea-r/17988",
  },
  {
    ...nepalRecordTimestamps,
    id: acceptanceFixtureIds.source.nepalVehicleEmissionGazette,
    isDemo: false,
    publishedOn: "2025-06-23",
    publisher:
      "Government of Nepal / Ministry of Forests and Environment / Department of Printing",
    sourceType: "official-regulation",
    title:
      "नेपाल सवारी साधन प्रदूषण मापदण्ड, २०८२ (संख्या १४, प्रकाशित मिति २०८२/०३/०९) — Nepal Gazette Part 5, Vol. 75, No. 14",
    url: "https://dop.gov.np/content/12562/nepal-vehicle-pollution-criteria--2082--no--14-/",
  },
  {
    ...nepalRecordTimestamps,
    id: acceptanceFixtureIds.source.nepalVehiclePollutionStandardDoenv,
    isDemo: false,
    publishedOn: "2026-03-12",
    publisher: "Government of Nepal / Department of Environment",
    sourceType: "official-regulation",
    title:
      "नेपाल सवारी साधन प्रदूषण मापदण्ड, २०८२ / Nepal Vehicle Pollution Standard, 2082 — Department of Environment official copy",
    url: "https://doenv.gov.np/content/71/nepal-vehicle-pollution-standards--2082/",
  },
  {
    ...armeniaRecordTimestamps,
    id: acceptanceFixtureIds.source.armeniaTrCu018Consolidated,
    isDemo: false,
    publishedOn: "2011-12-09",
    publisher:
      "Eurasian Economic Commission / ARLIS Legal Information System of Armenia",
    sourceType: "official-regulation",
    title:
      "TR CU 018/2011 On safety of wheeled vehicles — current consolidated Armenian official text, Annex 2 item 39",
    url: "https://www.arlis.am/hy/acts/158010/print/act",
  },
  {
    ...armeniaRecordTimestamps,
    id: acceptanceFixtureIds.source.armeniaTrCu031Consolidated,
    isDemo: false,
    publishedOn: "2012-07-20",
    publisher:
      "Eurasian Economic Commission / ARLIS Legal Information System of Armenia",
    sourceType: "official-regulation",
    title:
      "TR CU 031/2012 On safety of agricultural and forestry tractors and trailers — current consolidated Armenian official text, Annex 5 clause 14.1 and Table 5.1",
    url: "https://www.arlis.am/hy/acts/202066/print/act",
  },
  {
    ...azerbaijanRecordTimestamps,
    id: acceptanceFixtureIds.source.azerbaijanEuro4Decision,
    isDemo: false,
    publishedOn: "2014-01-14",
    publisher:
      "Cabinet of Ministers of the Republic of Azerbaijan / AZSTAND",
    sourceType: "official-regulation",
    title:
      "Cabinet Decision No. 2 of 14 January 2014 — Euro 4 environmental requirements for motor vehicles imported into and circulated in Azerbaijan",
    url: "https://azstand.gov.az/upload/files/avro%204.pdf",
  },
  {
    ...azerbaijanRecordTimestamps,
    id: acceptanceFixtureIds.source.azerbaijanAzs6362025,
    isDemo: false,
    publishedOn: "2025-03-19",
    publisher: "Azerbaijan Standardization Institute (AZSTAND)",
    sourceType: "other",
    title:
      "AZS 636:2025 Road transport — environmental classes (official metadata; M/N scope, non-reference standard, numeric pages not publicly readable)",
    url:
      "https://e-standart.gov.az/Standard/Details/838c95ea-0693-4ec2-afe5-808234f0748a",
  },
  {
    ...georgiaRecordTimestamps,
    id: acceptanceFixtureIds.source.georgiaResolution238,
    isDemo: false,
    publishedOn: "2023-06-28",
    publisher: "Georgia / LEPL Legislative Herald of Georgia",
    sourceType: "official-regulation",
    title:
      "Government Resolution No. 238 of 28 June 2023 — Technical Regulation on vehicle emission standards, current publication 12",
    url:
      "https://www.matsne.gov.ge/ka/document/view/5845990?publication=12",
  },
  {
    ...georgiaRecordTimestamps,
    id: acceptanceFixtureIds.source.georgiaResolution238Mepa,
    isDemo: false,
    publishedOn: "2023-06-28",
    publisher: "Ministry of Environmental Protection and Agriculture of Georgia",
    sourceType: "official-regulation",
    title:
      "Government Resolution No. 238 — Technical Regulation on vehicle emission standards (MEPA official document mirror)",
    url: "https://www.mepa.gov.ge/Ge/Files/Download/55101",
  },
  {
    ...uzbekistanRecordTimestamps,
    id: acceptanceFixtureIds.source.uzbekistanAgricultureRegulation,
    isDemo: false,
    publishedOn: "2025-01-13",
    publisher:
      "Cabinet of Ministers of the Republic of Uzbekistan / LEX.UZ",
    sourceType: "official-regulation",
    title:
      "Cabinet Decision No. 10 of 11 January 2025 — UzTR.10-006:2025 Safety of agricultural and forestry vehicles and machinery",
    url: "https://lex.uz/uz/docs/7315394",
  },
  {
    ...uzbekistanRecordTimestamps,
    id: acceptanceFixtureIds.source.uzbekistanRoadRegulation,
    isDemo: false,
    publishedOn: "2017-04-25",
    publisher:
      "Cabinet of Ministers of the Republic of Uzbekistan / LEX.UZ",
    sourceType: "official-regulation",
    title:
      "Cabinet Decision No. 237 of 25 April 2017 — UzTR.237-016:2017 General Technical Regulation on Safety of Wheeled Vehicles, Annex 8 environmental-class boundary",
    url: "https://lex.uz/docs/3180907",
  },
  {
    ...kazakhstanRecordTimestamps,
    id: acceptanceFixtureIds.source.kazakhstanRoadRegulation,
    isDemo: false,
    publishedOn: "2011-12-09",
    publisher:
      "Eurasian Economic Commission / Adilet Legal Information System of Kazakhstan",
    sourceType: "official-regulation",
    title:
      "TR CU 018/2011 On safety of wheeled vehicles — current consolidated text, Annex 2 item 39",
    url: "https://adilet.zan.kz/rus/docs/H11T0000877",
  },
  {
    ...kazakhstanRecordTimestamps,
    id: acceptanceFixtureIds.source.kazakhstanAgricultureRegulation,
    isDemo: false,
    publishedOn: "2012-07-20",
    publisher:
      "Eurasian Economic Commission / Adilet Legal Information System of Kazakhstan",
    sourceType: "official-regulation",
    title:
      "TR CU 031/2012 On safety of agricultural and forestry tractors and trailers — current consolidated text, Annex 5 clause 14.1 and Table 5.1",
    url: "https://adilet.zan.kz/rus/docs/H12EV000060",
  },
  {
    ...tajikistanRecordTimestamps,
    id: acceptanceFixtureIds.source.tajikistanRoadEnvironmentalLaw,
    isDemo: false,
    publishedOn: "2015-08-08",
    publisher:
      "National Legislation Center under the President of the Republic of Tajikistan",
    sourceType: "official-regulation",
    title:
      "Law of the Republic of Tajikistan No. 1214 on ensuring environmental safety of road transport",
    url: "https://ncz.tj/system/files/Legislation/1214_ru.pdf",
  },
  {
    ...tajikistanRecordTimestamps,
    id: acceptanceFixtureIds.source.tajikistanEngineTermsDraft,
    isDemo: false,
    publishedOn: null,
    publisher: "Agency for Standardization, Metrology, Certification and Trade Inspection under the Government of the Republic of Tajikistan",
    sourceType: "government-notice",
    title:
      "Draft ST JT ____-2024 — Engine emissions: terms and definitions (blank approval and effective-date fields)",
    url: "https://standard.tj/documents/files/file_328.pdf",
  },
  {
    ...kyrgyzstanRecordTimestamps,
    id: acceptanceFixtureIds.source.kyrgyzstanRoadImplementation,
    isDemo: false,
    publishedOn: null,
    publisher: "Ministry of Economy and Commerce of the Kyrgyz Republic",
    sourceType: "government-notice",
    title:
      "Official implementation notice for TR CU 018/2011 — entry into force on 12 February 2016 and transitional documents through 12 February 2018",
    url: "https://www.mineconom.gov.kg/ru/post/4112",
  },
  {
    ...kyrgyzstanRecordTimestamps,
    id: acceptanceFixtureIds.source.kyrgyzstanAgricultureRegulation,
    isDemo: false,
    publishedOn: "2012-07-20",
    publisher: "Eurasian Economic Commission",
    sourceType: "official-regulation",
    title:
      "TR CU 031/2012 On safety of agricultural and forestry tractors and trailers — official regulation and current text",
    url: "https://eec.eaeunion.org/comission/department/deptexreg/tr/bezopSH.php",
  },
  {
    ...turkmenistanRecordTimestamps,
    id: acceptanceFixtureIds.source.turkmenistanAirProtectionLaw,
    isDemo: false,
    publishedOn: "2016-01-01",
    publisher: "Ministry of Justice of Turkmenistan",
    sourceType: "official-regulation",
    title:
      "Law of Turkmenistan on protection of atmospheric air — Article 21, with 2018 and 2021 amendments",
    url: "https://minjust.gov.tm/assets/files/law_documents/hukuknama_406_ru.pdf",
  },
  {
    ...turkmenistanRecordTimestamps,
    id: acceptanceFixtureIds.source.turkmenistanGasolineMeasurementStandard,
    isDemo: false,
    publishedOn: "2019-01-01",
    publisher: "Main State Service Turkmenstandartlary",
    sourceType: "government-notice",
    title:
      "TDS 1286-2019 — Gasoline-engine exhaust gases: measurement of carbon monoxide and hydrocarbons",
    url: "https://tds.gov.tm/ru/state/standards?page=32",
  },
  {
    ...afghanistanRecordTimestamps,
    id: acceptanceFixtureIds.source.afghanistanAirPollutionRegulation,
    isDemo: false,
    publishedOn: "2009-08-11",
    publisher:
      "Islamic Republic of Afghanistan / Ministry of Justice / National Environmental Protection Agency",
    sourceType: "official-regulation",
    title:
      "Regulation on Decrease and Prevention of Air Pollution / مقرره کاهش و جلوگیری از آلودگی هوا",
    url: "https://parse.nepa.gov.af/parse/files/nepa/mqrrh_kahsh_w_jlwgyry_az_alwdgy_hwa.pdf",
  },
  {
    ...afghanistanRecordTimestamps,
    id: acceptanceFixtureIds.source.afghanistanAirPollutionAmendment,
    isDemo: false,
    publishedOn: "2020-11-21",
    publisher:
      "Islamic Republic of Afghanistan / Ministry of Justice / National Environmental Protection Agency",
    sourceType: "official-regulation",
    title:
      "Amendment and Repeal of Certain Provisions of the Regulation on Decrease and Prevention of Air Pollution / تعدیل و لغو برخی مواد مقرره کاهش و جلوگیری از آلودگی هوا",
    url: "https://parse.nepa.gov.af/parse/files/nepa/tadyl_mqrrh_kahsh_w_jlwgyry_az_alwdgy_hwa_nafdh_shdh_shmarh_mslsl_1393.pdf",
  },
  {
    ...angolaRecordTimestamps,
    id: acceptanceFixtureIds.source.angolaVehicleInspectionRegulation,
    isDemo: false,
    publishedOn: "2013-11-07",
    publisher: "President of the Republic / Diário da República de Angola",
    sourceType: "official-regulation",
    title: "Decreto Presidencial n.º 185/13 de 07 de novembro",
    url: "https://files.lex.ao/presidente-da-republica/2013/decreto-presidencial-n-o-185-13-de-07-de-novembro/download/decreto-presidencial-n-o-185-13-de-07-de-novembro_presidente-da-republica_lex-ao.pdf",
  },
  {
    ...angolaRecordTimestamps,
    id: acceptanceFixtureIds.source.angolaEnvironmentalStandardizationProgram,
    isDemo: false,
    publishedOn: "2020-04-13",
    publisher: "President of the Republic / Diário da República de Angola",
    sourceType: "government-notice",
    title: "Decreto Presidencial n.º 99/20 — Programa Nacional de Normalização Ambiental",
    url: "https://files.lex.ao/presidente-da-republica/2020/decreto-presidencial-n-o-99-20-de-13-de-abril/download/decreto-presidencial-n-o-99-20-de-13-de-abril_presidente-da-republica_lex-ao.pdf",
  },
  {
    ...burundiRecordTimestamps,
    id: acceptanceFixtureIds.source.burundiRoadTrafficCode2012,
    isDemo: false,
    publishedOn: "2012-11-23",
    publisher: "Bulletin Officiel du Burundi / Amategeko government legal database",
    sourceType: "official-regulation",
    title: "BOB N°11/2012 — Loi N°1/26 portant Code de la circulation routière",
    url: "https://amategeko.gov.bi/wp-content/uploads/2019/12/BOB_No11-2012.pdf",
  },
  {
    ...burundiRecordTimestamps,
    id: acceptanceFixtureIds.source.burundiVehicleInspectionOrder2025,
    isDemo: false,
    publishedOn: "2025-01-27",
    publisher:
      "Burundi Ministry of Commerce and Transport / Ministry of Finance",
    sourceType: "official-regulation",
    title: "Ordonnance Ministérielle conjointe N°750/540/979 du 27/1/2025",
    url: "https://finances.gov.bi/wp-content/uploads/2025/02/OM-PORTANT-FIXATION-DES-MODALITES-DE-DELIVRANCE-DES-SERVICES-DE-CONTROLE-TECHNIQUE-AUTOMOBILE-ET-DES-PERMIS-DE-TRANSPORT-ROUTIER.pdf",
  },
  {
    ...beninRecordTimestamps,
    id: acceptanceFixtureIds.source.beninAirQualityDecree2001,
    isDemo: false,
    publishedOn: "2001-04-04",
    publisher: "Presidency of the Republic / General Secretariat of the Government of Benin",
    sourceType: "official-regulation",
    title: "Décret N° 2001-110 du 04 avril 2001 fixant les normes de qualité de l’air",
    url: "https://sgg.gouv.bj/doc/decret-2001-110/download",
  },
  {
    ...beninRecordTimestamps,
    id: acceptanceFixtureIds.source.beninAirQualityDecreeIndex,
    isDemo: false,
    publishedOn: "2001-04-04",
    publisher: "General Secretariat of the Government of Benin",
    sourceType: "government-notice",
    title: "SGG Documenthèque — Décret N° 2001-110",
    url: "https://sgg.gouv.bj/documentheque/763/",
  },
  {
    ...burkinaFasoRecordTimestamps,
    id: acceptanceFixtureIds.source.burkinaFasoAirQualityDecree2001,
    isDemo: false,
    publishedOn: "2001-05-07",
    publisher: "President of Burkina Faso / Journal Officiel (FAOLEX facsimile)",
    sourceType: "official-regulation",
    title:
      "Décret n°2001-185/PRES/PM/MEE fixant les normes de rejets de polluants dans l’air, l’eau et le sol",
    url: "https://faolex.fao.org/docs/pdf/bkf26794.pdf",
  },
  {
    ...burkinaFasoRecordTimestamps,
    id: acceptanceFixtureIds.source.burkinaFasoCurrentCitation2025,
    isDemo: false,
    publishedOn: null,
    publisher:
      "Burkina Faso Ministry of Infrastructure / Ministry of Environment",
    sourceType: "government-notice",
    title:
      "NIES du Garage et Atelier de maintenance de la Brigade d’Entretien Routier de Ziniaré",
    url: "https://www.environnement.gov.bf/fileadmin/user_upload/storages/images/mediatheque/accueil/past_nies_garage_brigade_ziniare.pdf",
  },
  {
    ...bangladeshRecordTimestamps,
    id: acceptanceFixtureIds.source.bangladeshAirPollutionRules2022,
    isDemo: false,
    publishedOn: "2022-07-26",
    publisher:
      "Bangladesh Ministry of Environment, Forest and Climate Change / Bangladesh Government Press",
    sourceType: "official-regulation",
    title:
      "বায়ুদূষণ (নিয়ন্ত্রণ) বিধিমালা, ২০২২ / Air Pollution (Control) Rules, 2022 (S.R.O. No. 255-Law/2022)",
    url: "https://www.dpp.gov.bd/upload_file/gazettes/45501_95134.pdf",
  },
  {
    ...bangladeshRecordTimestamps,
    id: acceptanceFixtureIds.source.bangladeshGazetteIndex2022,
    isDemo: false,
    publishedOn: "2022-07-26",
    publisher: "Bangladesh Department of Printing and Publications / Government Press",
    sourceType: "government-notice",
    title: "Extraordinary Gazette of July 2022 — S.R.O. No. 255-Law/2022",
    url: "https://www.dpp.gov.bd/bgpress/index.php/document/get_extraordinary/45501",
  },
  {
    ...bahamasRecordTimestamps,
    id: acceptanceFixtureIds.source.bahamasRoadTrafficAct,
    isDemo: false,
    publishedOn: "1958-09-18",
    publisher: "Government of The Bahamas / Statute Law of The Bahamas",
    sourceType: "official-regulation",
    title:
      "Road Traffic Act (Chapter 220; No. 57 of 1958; LRO 1/2017 consolidation)",
    url: "https://laws.bahamas.gov.bs/cms/images/LEGISLATION/PRINCIPAL/1958/1958-0057/1958-0057_2.pdf",
  },
  {
    ...bahamasRecordTimestamps,
    id: acceptanceFixtureIds.source.bahamasEnvironmentalPlanningAct,
    isDemo: false,
    publishedOn: "2019-12-20",
    publisher:
      "Parliament / Official Gazette of The Bahamas / Government of The Bahamas",
    sourceType: "official-regulation",
    title: "Environmental Planning and Protection Act, 2019 (No. 40 of 2019)",
    url: "https://laws.bahamas.gov.bs/cms/images/LEGISLATION/PRINCIPAL/2019/2019-0040/2019-0040_1.pdf",
  },
  {
    ...belarusRecordTimestamps,
    id: acceptanceFixtureIds.source.belarusTrCu018,
    isDemo: false,
    publishedOn: "2011-12-09",
    publisher: "Eurasian Economic Commission",
    sourceType: "official-regulation",
    title:
      "TR CU 018/2011 On safety of wheeled vehicles — current official regulation page and consolidated text",
    url:
      "https://eec.eaeunion.org/comission/department/deptexreg/realizatsiya-soglasheniya-o-vvedenii-edinykh-form-pts/normativnaya-baza/tr-ts-018-2011.php",
  },
  {
    ...belarusRecordTimestamps,
    id: acceptanceFixtureIds.source.belarusTrCu031,
    isDemo: false,
    publishedOn: "2012-07-20",
    publisher: "Eurasian Economic Commission",
    sourceType: "official-regulation",
    title:
      "TR CU 031/2012 On safety of agricultural and forestry tractors and trailers — current official regulation page and consolidated text",
    url:
      "https://eec.eaeunion.org/comission/department/deptexreg/realizatsiya-soglasheniya-o-vvedenii-edinykh-form-pts/normativnaya-baza/tr-ts-031-2.php",
  },
  {
    ...boliviaRecordTimestamps,
    id: acceptanceFixtureIds.source.boliviaRm064Regulation,
    isDemo: false,
    publishedOn: "2022-04-01",
    publisher:
      "Bolivia Ministry of Public Works, Services and Housing / Vice Ministry of Transport",
    sourceType: "official-regulation",
    title:
      "Resolución Ministerial N° 064 de 1 de abril de 2022 — Reglamento para la emisión de autorizaciones previas de vehículos automotores",
    url: "https://www.oopp.gob.bo/wp-content/uploads/2022/04/RM-064-Y-REGLAMENTO.pdf",
  },
  {
    ...boliviaRecordTimestamps,
    id: acceptanceFixtureIds.source.boliviaIbmetroAcceptance,
    isDemo: false,
    publishedOn: null,
    publisher: "Bolivian Institute of Metrology (IBMETRO)",
    sourceType: "government-notice",
    title: "CERTIFICADOS DE ACEPTACIÓN (Importación de vehículos automotores)",
    url: "https://ibmetro.gob.bo/certificado-de-aceptacion",
  },
  {
    ...moroccoRecordTimestamps,
    id: acceptanceFixtureIds.source.moroccoEuro6Order2094,
    isDemo: false,
    publishedOn: "2024-12-16",
    publisher: "General Secretariat of the Government of Morocco",
    sourceType: "official-regulation",
    title: "Bulletin Officiel n°7361 — Arrêté conjoint n°2094.24",
    url: "https://www.sgg.gov.ma/BO/AR/3111/2024/BO_7361_Ar.pdf",
  },
  {
    ...moroccoRecordTimestamps,
    id: acceptanceFixtureIds.source.moroccoEuro6Order2251,
    isDemo: false,
    publishedOn: "2021-10-07",
    publisher: "General Secretariat of the Government of Morocco",
    sourceType: "official-regulation",
    title:
      "Bulletin Officiel n°7028 — Arrêté conjoint n°2251-21 du 5 août 2021",
    url: "https://www.sgg.gov.ma/BO/bo_fr/2021/BO_7028_Fr.pdf",
  },
  {
    ...kenyaRecordTimestamps,
    id: acceptanceFixtureIds.source.kenyaAirQualityRegulations2024,
    isDemo: false,
    publishedOn: "2024-12-06",
    publisher: "Kenya Law / Republic of Kenya",
    sourceType: "official-regulation",
    title:
      "The Environmental Management and Coordination (Air Quality) Regulations (Legal Notice 180 of 2024) — legislation as at 24 March 2025",
    url: "https://new.kenyalaw.org/akn/ke/act/ln/2024/180/eng@2025-03-24/source.pdf",
  },
  {
    ...kenyaRecordTimestamps,
    id: acceptanceFixtureIds.source.kenyaInspectionRules2026,
    isDemo: false,
    publishedOn: "2026-02-13",
    publisher: "Kenya Law / Republic of Kenya",
    sourceType: "official-regulation",
    title:
      "The Traffic (Motor Vehicle Inspection) Rules, 2026 — Legal Notice No. 13 of 2026",
    url: "https://new.kenyalaw.org/akn/ke/act/ln/2026/13/eng@2026-02-13/source.pdf",
  },
  {
    ...nigeriaRecordTimestamps,
    id: acceptanceFixtureIds.source.nigeriaNesrea,
    isDemo: false,
    publishedOn: null,
    publisher: "National Environmental Standards and Regulations Enforcement Agency",
    sourceType: "government-notice",
    title: "Nigeria NESREA laws and regulations portal",
    url: "https://nesrea.gov.ng/laws-regulations/",
  },
  {
    ...nigeriaRegulationRecordTimestamps,
    id: acceptanceFixtureIds.source.nigeriaVehicularEmissions2011,
    isDemo: false,
    publishedOn: "2011-05-17",
    publisher: "Federal Republic of Nigeria",
    sourceType: "official-regulation",
    title:
      "National Environmental (Control of Vehicular Emissions from Petrol and Diesel Engines) Regulations, 2011",
    url: "https://nesrea.gov.ng/wp-content/uploads/2025/05/Control_of_Vehicular_Emissions_from_Petrol_and_Diesel_Engines_Regulation-2011-.pdf",
  },
  {
    ...egyptRecordTimestamps,
    id: acceptanceFixtureIds.source.egyptExecRegulation338,
    isDemo: false,
    publishedOn: "1995-02-28",
    publisher:
      "Egypt Council of Ministers / Egyptian Environmental Affairs Agency",
    sourceType: "official-regulation",
    title:
      "Prime Minister’s Decree No. 338 of 1995 issuing the Executive Regulations of Environment Law No. 4 of 1994",
    url: "https://www.eeaa.gov.eg/Uploads/Laws/Files/20221010124857366.doc",
  },
  {
    ...egyptRecordTimestamps,
    id: acceptanceFixtureIds.source.egyptDecision710,
    isDemo: false,
    publishedOn: "2012-06-23",
    publisher:
      "Egypt Council of Ministers / Egyptian Environmental Affairs Agency",
    sourceType: "official-regulation",
    title:
      "Prime Minister’s Decision No. 710 of 2012 amending the Executive Regulations of Environment Law No. 4 of 1994",
    url: "https://www.eeaa.gov.eg/Uploads/Laws/Files/20250526101230761.pdf",
  },
  {
    ...ghanaRecordTimestamps,
    id: acceptanceFixtureIds.source.ghanaEnvironmentalProtectionAct2025,
    isDemo: false,
    publishedOn: "2025-01-06",
    publisher: "Parliament of Ghana",
    sourceType: "official-regulation",
    title: "Environmental Protection Act, 2025 (Act 1124)",
    url: "https://repository.parliament.gh/server/api/core/bitstreams/1e06a2ff-8e7a-494e-a4d9-795f9c89002e/content",
  },
  {
    ...ghanaRecordTimestamps,
    id: acceptanceFixtureIds.source.ghanaMotorVehicleEmissionsStandard1219,
    isDemo: false,
    publishedOn: "2018-06-05",
    publisher: "Ghana Standards Authority",
    sourceType: "government-notice",
    title:
      "GS 1219 — Environment and Health Protection — Requirements for motor vehicle emissions",
    url: "https://webstore.gsa.gov.gh/detail.php?ID=1756",
  },
  {
    ...israelRecordTimestamps,
    id: acceptanceFixtureIds.source.israelRoadImr2026,
    isDemo: false,
    publishedOn: "2025-09-25",
    publisher: "Israel Ministry of Transport and Road Safety",
    sourceType: "official-regulation",
    title:
      "Israeli Mandatory Requirements — Safety and Environmental Protection Regulations For Motor Vehicles Manufactured According To European Union Directives — For the Calendar Year 2026",
    url: "https://www.gov.il/BlobFolder/policy/imr_rr_m_n_o_2026/he/000211.docx",
  },
  {
    ...israelRecordTimestamps,
    id: acceptanceFixtureIds.source.israelNrmmImr2026,
    isDemo: false,
    publishedOn: "2025-09-25",
    publisher: "Israel Ministry of Transport and Road Safety",
    sourceType: "official-regulation",
    title:
      "Israeli Mandatory Requirements (IMR) for Calendar Year 2026 — Non-Road Mobile Machinery (NRMM) — New Model",
    url: "https://www.gov.il/BlobFolder/policy/imr_nrmm_2026/he/000201.docx",
  },
  {
    ...pakistanRecordTimestamps,
    id: acceptanceFixtureIds.source.pakistanSro72OfficialIndex,
    isDemo: false,
    publishedOn: "2009-08-18",
    publisher:
      "Pakistan Environmental Protection Agency / Ministry of Climate Change and Environmental Coordination",
    sourceType: "official-regulation",
    title:
      "National Environmental Quality Standards for Motor Vehicle Exhaust and Noise, S.R.O. 72(KE)/2009 — official regulations index",
    url: "https://www.mocc.gov.pk/Detail/MDUzMDI1OGItYWYzZC00NzQ0LTlhZWItZjYzY2RkOTkyZGVh",
  },
  {
    ...pakistanRecordTimestamps,
    id: acceptanceFixtureIds.source.pakistanSro72GazetteScan,
    isDemo: false,
    publishedOn: "2009-08-18",
    publisher: "Gazette of Pakistan / archival full-text scan",
    sourceType: "official-regulation",
    title:
      "S.R.O. 72(KE)/2009 Gazette Extraordinary Part II — amended Annex III motor-vehicle standards",
    url: "https://www.yumpu.com/it/document/view/46322181/sro-72ke-2009-pakistan-standards-and-quality-control-authority",
  },
  {
    ...qatarRecordTimestamps,
    id: acceptanceFixtureIds.source.qatarEuro5Policy2023,
    isDemo: false,
    publishedOn: "2021-11-08",
    publisher: "Qatar Ministry of Transport",
    sourceType: "government-notice",
    title:
      "Ministry to Apply EURO5-Equivalent Clean Diesel Fuel Policy for Buses, Trucks in 2023",
    url: "https://www.mot.gov.qa/en/news/ministry-apply-euro5-equivalent-clean-diesel-fuel-policy-buses-trucks-2023",
  },
  {
    ...qatarRecordTimestamps,
    id: acceptanceFixtureIds.source.qatarTechnicalRegulationsDecision125,
    isDemo: false,
    publishedOn: "2019-06-20",
    publisher: "Qatar Ministry of Justice / Al Meezan Legal Portal",
    sourceType: "official-regulation",
    title:
      "Ministerial Decision No. 125 of 2019 Adopting Qatari Technical Regulations",
    url: "https://www.almeezan.qa/LawPage.aspx?id=8020&language=ar",
  },
  {
    ...kuwaitRecordTimestamps,
    id: acceptanceFixtureIds.source.kuwaitGulfStandardsDecision372,
    isDemo: false,
    publishedOn: "1992-11-15",
    publisher:
      "Kuwait Ministry of Commerce and Industry / Kuwait Today / Public Authority for Industry",
    sourceType: "official-regulation",
    title:
      "Ministerial Decision No. 372/1992 Adopting Gulf Standards as Kuwaiti Standards",
    url: "https://ksm.pai.gov.kw/_vti_bin/Store_WCF/Store.svc/RetrieveBinaryDocumentForPDFViewerMinisterial?docid=39",
  },
  {
    ...kuwaitRecordTimestamps,
    id: acceptanceFixtureIds.source.kuwaitTechnicalRegulationsDecision44,
    isDemo: false,
    publishedOn: "2015-11-29",
    publisher: "Kuwait Public Authority for Industry",
    sourceType: "official-regulation",
    title:
      "Ministerial Resolution No. 44/2015 and List of Adopted Standards and Technical Regulations",
    url: "https://www.pai.gov.kw/en/documents",
  },
  {
    ...omanRecordTimestamps,
    id: acceptanceFixtureIds.source.omanBindingVehicleStandardsDecision120,
    isDemo: false,
    publishedOn: "2024-04-07",
    publisher: "Oman Ministry of Justice and Legal Affairs / Official Gazette",
    sourceType: "official-regulation",
    title:
      "Official Gazette No. 1540 — Ministerial Decision No. 120/2024 Considering GCC Standards Binding Omani Standards",
    url: "https://www.mjla.gov.om/images/legislation/file/Book699179.pdf",
  },
  {
    ...omanRecordTimestamps,
    id: acceptanceFixtureIds.source.omanGsoMotorVehicleRegulationsMy2026,
    isDemo: false,
    publishedOn: "2025-01-02",
    publisher: "GCC Standardization Organization (GSO)",
    sourceType: "official-regulation",
    title:
      "List of GSO Technical Regulations for Motor Vehicles (2026 Model Year), MY2026-D5",
    url: "https://www.gso.org.sa/wp-content/uploads/2025/01/GSO-Technical-Regulations-MV-2026-MY-D5.pdf",
  },
  {
    ...jordanRecordTimestamps,
    id: acceptanceFixtureIds.source.jordanTransportGreenGrowthPlan,
    isDemo: false,
    publishedOn: null,
    publisher: "Jordan Ministry of Environment",
    sourceType: "government-notice",
    title: "Transport Sector Green Growth National Action Plan 2021–2025",
    url: "http://moenv.gov.jo/ebv4.0/root_storage/en/eb_list_page/2022_jordan_transport_v10.pdf",
  },
  {
    ...jordanRecordTimestamps,
    id: acceptanceFixtureIds.source.jordanTransportEmissionsStandardsCatalogue,
    isDemo: false,
    publishedOn: null,
    publisher: "Jordan Standards and Metrology Organization",
    sourceType: "government-notice",
    title:
      "JSMO Standards Catalogue — Transport Exhaust Emissions (JS 1053:1998 and JS 1054:1998)",
    url: "https://eservice.jsmo.gov.jo/en/Standards/IcsAmfn/1304050",
  },
  {
    ...cambodiaRecordTimestamps,
    id: acceptanceFixtureIds.source.cambodiaEnvironment,
    isDemo: false,
    publishedOn: "2016-06-15",
    publisher:
      "Cambodia Ministry of Industry and Handicraft / Institute of Standards of Cambodia",
    sourceType: "official-regulation",
    title:
      "Prakas No. 150 MIH/2016 on 19 Automotive Technical Regulations",
    url: "https://res.cloudinary.com/dgvyfitu8/image/upload/v1733987381/Prakas_No_150_MIH_2016_on_19_Automotives_Technical_Regulations_bdb6d255a4.pdf",
  },
  {
    ...cambodiaRecordTimestamps,
    id: acceptanceFixtureIds.source.cambodiaTransport,
    isDemo: false,
    publishedOn: "2000-07-01",
    publisher:
      "Royal Government of Cambodia / Ministry of Environment / National Trade Repository",
    sourceType: "official-regulation",
    title: "Sub-Decree No. 042 Air Pollution and Noise Disturbance Control",
    url: "https://cambodiantr.gov.kh/en/document/?title=sub-decree-no-042-air-pollution-and-noise-disturbance-control",
  },
  {
    ...laosRecordTimestamps,
    id: acceptanceFixtureIds.source.laosEnvironment,
    isDemo: false,
    publishedOn: "2021-11-16",
    publisher: "Lao National Assembly / Lao Trade Portal",
    sourceType: "official-regulation",
    title: "Law on Inland Vehicles No. 04/NA, dated 16 November 2021",
    url: "https://www.laotradeportal.gov.la/en-gb/site/display/2475",
  },
  {
    ...laosRecordTimestamps,
    id: acceptanceFixtureIds.source.laosTransport,
    isDemo: false,
    publishedOn: "2002-11-11",
    publisher:
      "Lao Ministry of Communication, Transport, Posts and Construction / Lao Trade Portal",
    sourceType: "official-regulation",
    title:
      "Provisions on Technical Standards and Accessories of Vehicles Authorized for Import, Registration and Assembly No. 4312/MCTPC",
    url: "https://www.laotradeportal.gov.la/en-gb/site/display/45",
  },
  {
    ...sriLankaRecordTimestamps,
    id: acceptanceFixtureIds.source.sriLankaEnvironment,
    isDemo: false,
    publishedOn: "2018-07-12",
    publisher:
      "Sri Lanka Department of Government Printing / President of Sri Lanka",
    sourceType: "official-regulation",
    title:
      "Gazette Extraordinary No. 2079/42 — National Environmental (Air Emission, Fuel and Vehicle Importation Standards) amendment",
    url: "https://documents.gov.lk/view/egz/2018/7/2079-42_E.pdf",
  },
  {
    ...sriLankaRecordTimestamps,
    id: acceptanceFixtureIds.source.sriLankaTransport,
    isDemo: false,
    publishedOn: "2018-07-13",
    publisher:
      "Sri Lanka Department of Government Printing / Minister of Development Strategies and International Trade",
    sourceType: "official-regulation",
    title:
      "Gazette Extraordinary No. 2079/70 — Imports and Exports (Control) Regulation No. 2 of 2018",
    url: "https://documents.gov.lk/view/egz/2018/7/2079-70_E.pdf",
  },
  {
    ...mongoliaRecordTimestamps,
    id: acceptanceFixtureIds.source.mongoliaEnvironment,
    isDemo: false,
    publishedOn: "2021-05-19",
    publisher: "Government of Mongolia / Legalinfo",
    sourceType: "official-regulation",
    title:
      "АГААР ЧАНАРЫН ТЕХНИКИЙН ЗОХИЦУУЛАЛТ (Air Quality Technical Regulation)",
    url: "https://legalinfo.mn/mn/detail?lawId=16207241573351&showType=1",
  },
  {
    ...mongoliaRecordTimestamps,
    id: acceptanceFixtureIds.source.mongoliaTransport,
    isDemo: false,
    publishedOn: "2021-05-19",
    publisher: "Government of Mongolia / Legalinfo",
    sourceType: "official-regulation",
    title:
      "ТЕХНИКИЙН ЗОХИЦУУЛАЛТ БАТЛАХ ТУХАЙ (Government Resolution No. 148 of 2021)",
    url: "https://legalinfo.mn/mn/detail?lawId=16207241555111&type=3",
  },
  {
    ...costaRicaRecordTimestamps,
    id: acceptanceFixtureIds.source.costaRicaEnvironment,
    isDemo: false,
    publishedOn: "2016-05-30",
    publisher:
      "Poder Ejecutivo / Sistema Costarricense de Información Jurídica (PGR)",
    sourceType: "official-regulation",
    title:
      "Decreto Ejecutivo 39724-MOPT-MINAE-S de 2 de mayo de 2016 — Reglamento para el control de las emisiones contaminantes producidas por los vehículos automotores con motor de combustión interna",
    url: "https://pgrweb.go.cr/scij/Busqueda/Normativa/Normas/nrm_norma.aspx?nValor1=1&nValor2=81619&nValor3=0&param1=NRM&strTipM=FN",
  },
  {
    ...costaRicaRecordTimestamps,
    id: acceptanceFixtureIds.source.costaRicaTransport,
    isDemo: false,
    publishedOn: "2012-10-26",
    publisher:
      "Asamblea Legislativa / Sistema Costarricense de Información Jurídica (PGR)",
    sourceType: "official-regulation",
    title:
      "Ley 9078 — Ley de Tránsito por Vías Públicas Terrestres y Seguridad Vial, artículo 38 (Control de emisiones contaminantes)",
    url: "https://pgrweb.go.cr/scij/Busqueda/Normativa/Normas/nrm_articulo.aspx?nValor1=1&nValor2=73504&nValor3=130675&nValor5=39&param1=NRA",
  },
  {
    ...ecuadorRecordTimestamps,
    id: acceptanceFixtureIds.source.ecuadorDieselStandard2207,
    isDemo: false,
    publishedOn: "2002-09-30",
    publisher:
      "Servicio Ecuatoriano de Normalización (INEN) / AEADE public full-text copy",
    sourceType: "official-regulation",
    title:
      "NTE INEN 2207(1R):2002 — Gestión ambiental. Aire. Vehículos automotores. Límites permitidos de emisiones producidas por fuentes móviles terrestres de diesel",
    url: "https://www.aeade.net/wp-content/uploads/2016/12/2207-1.pdf",
  },
  {
    ...ecuadorRecordTimestamps,
    id: acceptanceFixtureIds.source.ecuadorRte017,
    isDemo: false,
    publishedOn: "2008-08-11",
    publisher: "Instituto Ecuatoriano de Normalización (INEN)",
    sourceType: "official-regulation",
    title:
      "RTE INEN 017:2008 — Control de emisiones contaminantes de fuentes móviles terrestres",
    url: "https://www.normalizacion.gob.ec/buzon/reglamentos/RTE-017.pdf",
  },
  {
    ...ecuadorRecordTimestamps,
    id: acceptanceFixtureIds.source.ecuadorRte017Amendment2025,
    isDemo: false,
    publishedOn: "2025-11-10",
    publisher:
      "Ministerio de Producción, Comercio Exterior e Inversiones / Registro Oficial del Ecuador",
    sourceType: "official-regulation",
    title:
      "Resolución Nro. MPCEI-SC-2025-0280-R — Tercera modificatoria del RTE INEN 017",
    url: "https://www.registroficial.gob.ec/suplemento-no-160/",
  },
  {
    ...dominicanRepublicRecordTimestamps,
    id: acceptanceFixtureIds.source.dominicanRepublicEnvironment,
    isDemo: false,
    publishedOn: null,
    publisher:
      "Ministerio de Medio Ambiente y Recursos Naturales de la República Dominicana",
    sourceType: "official-regulation",
    title:
      "Resolución núm. 0051/2018 — Reglamento Técnico Ambiental para el Control de las Emisiones de Contaminantes Atmosféricos Provenientes de Fuentes Móviles",
    url: "https://ambiente.gob.do/portal-transparencia/wp/download/280/gestion-de-la-calidad-ambiental/3845/reglamento-tecnico-ambental-control-fuentes-moviles-2018.pdf",
  },
  {
    ...dominicanRepublicRecordTimestamps,
    id: acceptanceFixtureIds.source.dominicanRepublicTransport,
    isDemo: false,
    publishedOn: null,
    publisher:
      "Instituto Nacional de Tránsito y Transporte Terrestre (INTRANT)",
    sourceType: "government-notice",
    title:
      "Memoria Institucional 2022 — Normativas Técnicas Emitidas y Normativas en Consultas Públicas",
    url: "https://intrant.gob.do/transparencia/phocadownload/PlanEstrategico/MemoriasInstitucionales/Memoria%20Institucional%202022.pdf",
  },
  {
    ...algeriaRecordTimestamps,
    id: acceptanceFixtureIds.source.algeriaEnvironment,
    isDemo: false,
    publishedOn: "2003-11-09",
    publisher:
      "Journal officiel de la République algérienne démocratique et populaire / Secrétariat général du Gouvernement",
    sourceType: "official-regulation",
    title:
      "Décret exécutif n° 03-410 du 5 novembre 2003 fixant les seuils limites des émissions des fumées, des gaz toxiques et des bruits par les véhicules automobiles",
    url: "https://www.joradp.dz/FTP/jo-francais/2003/F2003068.pdf",
  },
  {
    ...algeriaRecordTimestamps,
    id: acceptanceFixtureIds.source.algeriaTransport,
    isDemo: false,
    publishedOn: "2018-01-24",
    publisher:
      "Journal officiel de la République algérienne démocratique et populaire / Secrétariat général du Gouvernement",
    sourceType: "official-regulation",
    title:
      "Décret exécutif n° 18-05 du 15 janvier 2018 fixant l’organisation du contrôle de conformité de véhicules et les modalités de son exercice",
    url: "https://www.joradp.dz/FTP/jo-francais/2018/F2018003.pdf",
  },
  {
    ...tunisiaRecordTimestamps,
    id: acceptanceFixtureIds.source.tunisiaEnvironment,
    isDemo: false,
    publishedOn: "2000-01-28",
    publisher:
      "Présidence de la République tunisienne / Imprimerie officielle de la République tunisienne",
    sourceType: "official-regulation",
    title:
      "Décret n° 2000-147 du 24 janvier 2000 fixant les règles techniques d’équipement et d’aménagement des véhicules",
    url: "http://www.citet.nat.tn/portail/digitalCollection/DigitalCollectionInlineDownloadHandler.ashx?_cb=20210408113957&documentId=42883&parentDocumentId=40549",
  },
  {
    ...tunisiaRecordTimestamps,
    id: acceptanceFixtureIds.source.tunisiaTransport,
    isDemo: false,
    publishedOn: "1999-07-26",
    publisher:
      "Imprimerie officielle de la République tunisienne / Ministère du Transport",
    sourceType: "official-regulation",
    title:
      "Loi n° 99-71 du 26 juillet 1999 portant promulgation du Code de la route",
    url: "https://www.transport.tn/uploads/Loi/Route.pdf",
  },
  {
    ...ethiopiaRecordTimestamps,
    id: acceptanceFixtureIds.source.ethiopiaEnvironment,
    isDemo: false,
    publishedOn: "2026-07-25",
    publisher:
      "Federal Democratic Republic of Ethiopia, Ministry of Transport and Logistics",
    sourceType: "official-regulation",
    title:
      "Directive on Emission Control of Pollutants from Vehicle No. 1051/2025",
    url: "https://motl.gov.et/sites/default/files/resource/5051_Emission%20of%20pollutant%20gas%20Directive.pdf",
  },
  {
    ...ethiopiaRecordTimestamps,
    id: acceptanceFixtureIds.source.ethiopiaTransport,
    isDemo: false,
    publishedOn: "2022-12-28",
    publisher: "Institute of Ethiopian Standards",
    sourceType: "government-notice",
    title:
      "ES 6725:2022 — Emission limits — Specification — Part 1 — Road vehicles",
    url: "https://www.motl.gov.et/sites/default/files/resource/emission%20standard.pdf",
  },
  {
    ...guatemalaRecordTimestamps,
    id: acceptanceFixtureIds.source.guatemalaEnvironment,
    isDemo: false,
    publishedOn: null,
    publisher: "Guatemala Ministry of Environment and Natural Resources",
    sourceType: "government-notice",
    title: "Normativa de Combustible y Vehículos",
    url: "https://www.marn.gob.gt/wpfd_file/normativa-de-combustible-y-vehiculos/",
  },
  {
    ...guatemalaRecordTimestamps,
    id: acceptanceFixtureIds.source.guatemalaTransport,
    isDemo: false,
    publishedOn: null,
    publisher: "Guatemala Ministry of the Interior (MINGOB)",
    sourceType: "official-regulation",
    title: "Ley de Tránsito y su Reglamento",
    url: "https://mingob.gob.gt/wp-content/uploads/2020/10/Ley-y-Reglamento-Transito.pdf",
  },
  {
    ...hondurasRecordTimestamps,
    id: acceptanceFixtureIds.source.hondurasEnvironment,
    isDemo: false,
    publishedOn: "2024-07-24",
    publisher: "Honduras National Congress / La Gaceta",
    sourceType: "official-regulation",
    title: "Decree 36-2024 — Law for the Rational and Efficient Use of Energy",
    url: "https://www.tsc.gob.hn/web/leyes/Decreto-36-2024.pdf",
  },
  {
    ...hondurasRecordTimestamps,
    id: acceptanceFixtureIds.source.hondurasTransport,
    isDemo: false,
    publishedOn: "2006-01-03",
    publisher: "Honduras National Congress / Tribunal Superior de Cuentas",
    sourceType: "official-regulation",
    title: "Decree 205-2005 — Traffic Law",
    url: "https://tsc.gob.hn/biblioteca/index.php/leyes/142-ley-de-transito?tmpl=component",
  },
  {
    ...panamaRecordTimestamps,
    id: acceptanceFixtureIds.source.panamaEnvironment,
    isDemo: false,
    publishedOn: "2009-06-15",
    publisher: "Gaceta Oficial Digital de la República de Panamá",
    sourceType: "official-regulation",
    title:
      "Decreto Ejecutivo No. 38 de 3 de junio de 2009 — Por el cual se dictan Normas Ambientales de Emisiones para Vehículos Automotores",
    url: "https://www.gacetaoficial.gob.pa/pdfTemp/26303/18123.pdf",
  },
  {
    ...panamaRecordTimestamps,
    id: acceptanceFixtureIds.source.panamaTransport,
    isDemo: false,
    publishedOn: "2022-04-25",
    publisher:
      "Asamblea Nacional / Gaceta Oficial de la República de Panamá",
    sourceType: "official-regulation",
    title:
      "Ley 295 de 25 de abril de 2022 — Que incentiva la movilidad eléctrica en el transporte terrestre",
    url: "https://infojuridica.procuraduria-admon.gob.pa/norma_screen.php?numsec=58095",
  },
  {
    ...uruguayRecordTimestamps,
    id: acceptanceFixtureIds.source.uruguayEnvironment,
    isDemo: false,
    publishedOn: "2021-05-13",
    publisher: "Uruguay Ministry of Environment",
    sourceType: "official-regulation",
    title: "Decree No. 135/021: Air Quality Regulation",
    url: "https://www.ambiente.gub.uy/oan/documentos/DCA-Decreto_135_021_calidad_de_aire-2021.pdf",
  },
  {
    ...uruguayRecordTimestamps,
    id: acceptanceFixtureIds.source.uruguayTransport,
    isDemo: false,
    publishedOn: "2025-11-13",
    publisher: "Uruguay Ministry of Environment",
    sourceType: "government-notice",
    title: "Vehicle-emission homologation procedure V5",
    url: "https://www.gub.uy/ministerio-ambiente/comunicacion/publicaciones/procedimiento-homologacion-emisiones-vehiculares-v5",
  },
  {
    ...botswanaRecordTimestamps,
    id: acceptanceFixtureIds.source.botswanaGovernment,
    isDemo: false,
    publishedOn: "2014-08-21",
    publisher: "Botswana Bureau of Standards",
    sourceType: "government-notice",
    title:
      "BOS 134:2014 ed.2 — The measurement of motor vehicle exhaust emissions — Code of practice",
    url: "https://bobstandards.bw/product/bos-1342014-ed-2/",
  },
  {
    ...botswanaRecordTimestamps,
    id: acceptanceFixtureIds.source.botswanaTransport,
    isDemo: false,
    publishedOn: "2024-06-24",
    publisher: "Botswana Bureau of Standards",
    sourceType: "government-notice",
    title: "Botswana Standards Catalogue — June 2024",
    url: "https://bobstandards.bw/wp-content/uploads/2024/06/BOBS-Standards-Catalogue-June-2024.pdf",
  },
  {
    ...namibiaRecordTimestamps,
    id: acceptanceFixtureIds.source.namibiaEnvironment,
    isDemo: false,
    publishedOn: "2005-12-30",
    publisher: "Republic of Namibia / Namibian Standards Institution",
    sourceType: "official-regulation",
    title: "Standards Act, 2005 (Act No. 18 of 2005)",
    url: "https://nsi.com.na/wp-content/uploads/2026/03/Standards-Act-18-of-2005.pdf",
  },
  {
    ...namibiaRecordTimestamps,
    id: acceptanceFixtureIds.source.namibiaTransport,
    isDemo: false,
    publishedOn: "2013-09-20",
    publisher: "Ministry of Trade and Industry / Namibian Standards Institution",
    sourceType: "official-regulation",
    title: "Government Notice Nos. 248–249 of 2013 — Standards Regulations",
    url: "https://nsi.com.na/wp-content/uploads/2026/03/5290-Gov-N248-249-Standard-Regulations.pdf",
  },
  {
    ...tanzaniaRecordTimestamps,
    id: acceptanceFixtureIds.source.tanzaniaEnvironment,
    isDemo: false,
    publishedOn: "2007-12-07",
    publisher: "Tanzania National Environment Management Council",
    sourceType: "official-regulation",
    title:
      "Environmental Management (Air Quality Standards) Regulations, 2007 — NEMC copy",
    url: "https://www.nemc.or.tz/uploads/publications/sw-1645446559-Air_Quality_Standards_Regulations_2007.pdf",
  },
  {
    ...tanzaniaRecordTimestamps,
    id: acceptanceFixtureIds.source.tanzaniaTransport,
    isDemo: false,
    publishedOn: "2007-12-07",
    publisher: "TanzLII / Official Gazette of the United Republic of Tanzania",
    sourceType: "official-regulation",
    title:
      "Environmental Management (Air Quality Standards) Regulations, 2007 — Government Notice No. 237",
    url: "https://tanzlii.org/akn/tz/act/gn/2007/237/eng@2007-01-01/publication",
  },
  {
    ...ugandaRecordTimestamps,
    id: acceptanceFixtureIds.source.ugandaEnvironment,
    isDemo: false,
    publishedOn: "2024-04-26",
    publisher: "Uganda National Environment Management Authority",
    sourceType: "official-regulation",
    title:
      "National Environment (Air Quality Standards) Regulations, 2024 — S.I. No. 22",
    url: "https://www.nema.go.ug/en/wp-content/uploads/2025/01/The-National-Environment-Air-Quality-Standards-Regulations-S.I.-No.-22-of-2024-1.pdf",
  },
  {
    ...ugandaRecordTimestamps,
    id: acceptanceFixtureIds.source.ugandaTransport,
    isDemo: false,
    publishedOn: "2022-12-13",
    publisher: "Uganda National Bureau of Standards",
    sourceType: "government-notice",
    title: "US EAS 1047:2022 — Air quality — Vehicular exhaust emission limits",
    url: "https://webstore.unbs.go.ug/store.php?preview=&src=5321",
  },
  {
    ...zambiaRecordTimestamps,
    id: acceptanceFixtureIds.source.zambiaEnvironment,
    isDemo: false,
    publishedOn: null,
    publisher: "National Assembly of Zambia",
    sourceType: "official-regulation",
    title: "Environmental Management Act No. 12 of 2011",
    url: "https://www.parliament.gov.zm/sites/default/files/documents/acts/Environmetal%20Mangement%20Act%2012%20of%202011.pdf",
  },
  {
    ...zambiaRecordTimestamps,
    id: acceptanceFixtureIds.source.zambiaTransport,
    isDemo: false,
    publishedOn: null,
    publisher: "Zambia Compulsory Standards Agency",
    sourceType: "government-notice",
    title: "List of Compulsory Standards",
    url: "https://www.zcsa.org.zm/index.php/list-of-compulsory-standards/",
  },
  {
    ...zimbabweRecordTimestamps,
    id: acceptanceFixtureIds.source.zimbabweEnvironment,
    isDemo: false,
    publishedOn: null,
    publisher: "Zimbabwe Environmental Management Agency",
    sourceType: "official-regulation",
    title: "Environmental Management Act [Chapter 20:27]",
    url: "https://ema.co.zw/wp-content/uploads/2026/03/EMA-ACT.pdf",
  },
  {
    ...zimbabweRecordTimestamps,
    id: acceptanceFixtureIds.source.zimbabweTransport,
    isDemo: false,
    publishedOn: null,
    publisher: "Zimbabwe Environmental Management Agency",
    sourceType: "government-notice",
    title: "Air Emission Licence requirements under S.I. 72 of 2009",
    url: "https://ema.co.zw/air-emission/",
  },
  {
    ...rwandaRecordTimestamps,
    id: acceptanceFixtureIds.source.rwandaEnvironment,
    isDemo: false,
    publishedOn: "2018-09-24",
    publisher: "Official Gazette of the Republic of Rwanda / Ministry of Environment",
    sourceType: "official-regulation",
    title:
      "Ministerial Order No. 02/2018 of 17/09/2018 Relating to Air Pollutants Emission",
    url: "https://rwandalii.org/akn/rw/act/mo/2018/2/eng@2018-09-24/source.pdf",
  },
  {
    ...rwandaRecordTimestamps,
    id: acceptanceFixtureIds.source.rwandaTransport,
    isDemo: false,
    publishedOn: "2023-01-23",
    publisher: "Rwanda Standards Board",
    sourceType: "official-regulation",
    title:
      "National Standards as published in Official Gazette No. 04 of 23/01/2023",
    url: "https://www.rsb.gov.rw/fileadmin/Standard_Publications/Gazetted_Standards/National_Standards_as_published_in_Official_Gazette_n___04_of_23_01_2023.pdf",
  },
  {
    ...rwandaRecordTimestamps,
    id: acceptanceFixtureIds.source.rwandaEas1047Implementation,
    isDemo: false,
    publishedOn: null,
    publisher: "East African Community Secretariat",
    sourceType: "government-notice",
    title:
      "Harmonization of Vehicle Emission Standards — Case of East African Community (EAC)",
    url: "https://sustmob.org/UsedVehicles/CITA_Nairobi_harmonization.pdf",
  },
  {
    ...coteDIvoireRecordTimestamps,
    id: acceptanceFixtureIds.source.coteDIvoireEnvironment,
    isDemo: false,
    publishedOn: "2017-02-22",
    publisher: "Official Gazette of the Republic of Côte d’Ivoire / AfricanLII",
    sourceType: "official-regulation",
    title: "Décret n°2017-125 du 22 février 2017 relatif à la qualité de l’air",
    url: "https://agp.africanlii.org/fr/akn/ci/act/decree/2017/125/fra@2017-09-14",
  },
  {
    ...coteDIvoireRecordTimestamps,
    id: acceptanceFixtureIds.source.coteDIvoireTransport,
    isDemo: false,
    publishedOn: null,
    publisher: "Comité Ivoirien de Normalisation (CODINORM)",
    sourceType: "government-notice",
    title: "PNI 15004 : Février 2025 — Véhicules N2 et N3 (Projet de Norme Ivoirienne)",
    url: "https://www.codinorm.ci/doc/enquete/vehicules/PNI%2015004%20Vehic%20N2%20et%20N3%20janv%202025%20V01.pdf",
  },
  {
    ...cameroonRecordTimestamps,
    id: acceptanceFixtureIds.source.cameroonEnvironment,
    isDemo: false,
    publishedOn: null,
    publisher: "Agence des Normes et de la Qualité (ANOR) / MINEPDED",
    sourceType: "government-notice",
    title:
      "NC 2858:2021 — Environnement — Exigences relatives aux rejets atmosphériques",
    url: "https://minepded.gov.cm/wp-content/uploads/2021/09/NC-2858.pdf",
  },
  {
    ...cameroonRecordTimestamps,
    id: acceptanceFixtureIds.source.cameroonTransport,
    isDemo: false,
    publishedOn: "2011-08-23",
    publisher: "Premier Ministre, Chef du Gouvernement / MINEPDED",
    sourceType: "official-regulation",
    title:
      "Décret n°2011/2582/PM du 23 août 2011 fixant les modalités de protection de l’atmosphère",
    url: "https://minepded.gov.cm/wp-content/uploads/2020/01/D%C3%89CRET-N%C2%B020112582PM-DU-23-AO%C3%9BT-2011-FIXANT-LES-MODALIT%C3%89S-DE-PROTECTION-DE-L%E2%80%99ATMOSPH%C3%88RE.pdf",
  },
  {
    ...senegalRecordTimestamps,
    id: acceptanceFixtureIds.source.senegalEnvironment,
    isDemo: false,
    publishedOn: null,
    publisher:
      "Association Sénégalaise de Normalisation (ASN), Ministère de l’Industrie et du Commerce",
    sourceType: "government-notice",
    title: "Catalogue des normes Sénégalaises 2025",
    url: "https://www.asn.sn/sites/default/files/ASN%20CATALOGUE%202025%20v2_0.pdf",
  },
  {
    ...senegalRecordTimestamps,
    id: acceptanceFixtureIds.source.senegalTransport,
    isDemo: false,
    publishedOn: "2004-01-19",
    publisher: "République du Sénégal / Archives publiques du Sénégal",
    sourceType: "official-regulation",
    title:
      "Décret n°2004-13 du 19 janvier 2004 fixant les règles d’application de la loi n°2002-30 du 24 décembre 2002 portant Code de la route — Annexe G",
    url: "https://www.archives.sn/api/fichiers/3d690f87-c01d-49e9-8fc3-655f40c27d9b?download=1",
  },
  {
    ...mozambiqueRecordTimestamps,
    id: acceptanceFixtureIds.source.mozambiqueEnvironment,
    isDemo: false,
    publishedOn: "2010-12-31",
    publisher:
      "Conselho de Ministros / Boletim da República; official copy hosted by SIBMOZ",
    sourceType: "official-regulation",
    title:
      "Decreto n.º 67/2010, de 31 de Dezembro — altera o Regulamento sobre Padrões de Qualidade Ambiental e de Emissão de Efluentes aprovado pelo Decreto n.º 18/2004",
    url: "https://sibmoz.gov.mz/content/uploads/2022/01/Regulamento-sobre-Padroes-de-Qualidade-Ambiental-e-de-Emissao-de-Efluentes.pdf",
  },
  {
    ...mozambiqueRecordTimestamps,
    id: acceptanceFixtureIds.source.mozambiqueTransport,
    isDemo: false,
    publishedOn: "2017-08-16",
    publisher:
      "Conselho de Ministros / Imprensa Nacional de Moçambique; official copy hosted by INATRO",
    sourceType: "official-regulation",
    title:
      "Decreto n.º 44/2017, de 16 de Agosto — Regulamento sobre as Regras de Aprovação de Marcas e Modelos de Veículos Automóveis, Motociclos, Ciclomotores, Tractores Agrícolas ou Florestais, Máquinas Industriais, Agrícolas ou Florestais, Tractocarros, Reboques e Semi-Reboques",
    url: "https://inatro.gov.mz/wp-content/uploads/2019/08/Decreto-44-e-45-2017-matriculas-e-regras-de-apro-de-marcas-e-modelos.pdf",
  },
  {
    ...eswatiniRecordTimestamps,
    id: acceptanceFixtureIds.source.eswatiniGovernment,
    isDemo: false,
    publishedOn: null,
    publisher: "Eswatini Environment Authority",
    sourceType: "official-regulation",
    title: "Air Pollution Control Regulations, 2010",
    url: "https://eea.org.sz/wp-content/uploads/2020/08/Air-Pollution-Regulations-2010.pdf",
  },
  {
    ...eswatiniRecordTimestamps,
    id: acceptanceFixtureIds.source.eswatiniTransport,
    isDemo: false,
    publishedOn: null,
    publisher: "Government of Eswatini — Road Transportation Department",
    sourceType: "government-notice",
    title: "Road Transportation Department — roadworthiness testing and statutory mandate",
    url: "https://www.gov.sz/index.php/ministry-department/road-transportation-department",
  },
  {
    ...lesothoRecordTimestamps,
    id: acceptanceFixtureIds.source.lesothoGovernment,
    isDemo: false,
    publishedOn: "2026-02-16",
    publisher: "Government of Lesotho / Ministry of Public Works and Transport",
    sourceType: "government-notice",
    title: "Roadworthiness (RW)/Fitness (F) of Motor Vehicles",
    url: "https://www.gov.ls/eservice/roadworthiness-rw-fitness-f-of-motor-vehicles/",
  },
  {
    ...lesothoRecordTimestamps,
    id: acceptanceFixtureIds.source.lesothoTransport,
    isDemo: false,
    publishedOn: "2006-02-28",
    publisher:
      "Government of the Kingdom of Lesotho, Ministry of Public Works and Transport, Planning Unit",
    sourceType: "government-notice",
    title: "Transport Sector Policy",
    url: "https://www.mopwt.gov.ls/wp-content/uploads/2018/07/Transport_Sector_Policy.pdf",
  },
  {
    ...madagascarRecordTimestamps,
    id: acceptanceFixtureIds.source.madagascarEnvironment,
    isDemo: false,
    publishedOn: "2024-04-30",
    publisher:
      "Ministère de l’Agriculture et de l’Élevage, Direction Régionale de l’Agriculture et de l’Élevage Atsimo Andrefana",
    sourceType: "government-notice",
    title:
      "Étude de l’aménagement du secteur d’Antanamanintsy et l’actualisation d’une partie des études de réhabilitation des aménagements actuels dans le périmètre du Bas Mangoky — Étude d’impact environnemental et social, version définitive",
    url: "https://www.minae.gov.mg/wp-content/uploads/2025/05/1.0.EIES-VERSION-DEFINITIVE_FIN.pdf",
  },
  {
    ...madagascarRecordTimestamps,
    id: acceptanceFixtureIds.source.madagascarTransport,
    isDemo: false,
    publishedOn: null,
    publisher: "Direction de la Législation et du Contentieux / CNLEGIS, Madagascar",
    sourceType: "government-notice",
    title: "CNLEGIS — Recherche directe par numéros",
    url: "https://cnlegis.gov.mg/page_cherche_dir_numeros/",
  },
  {
    ...mauritiusRecordTimestamps,
    id: acceptanceFixtureIds.source.mauritiusEnvironment,
    isDemo: false,
    publishedOn: "2023-11-08",
    publisher:
      "Mauritius Ministry of Environment, Solid Waste Management and Climate Change, Environment and Climate Change Division",
    sourceType: "government-notice",
    title:
      "Returns on Enforcement of Vehicular Smoke Emissions (March 2022 – August 2023)",
    url: "https://environment.govmu.org/Documents/communique/Returns%20on%20Enforcement%20of%20Vehicular%20Smoke%20Emissions%20%28March%202022%20to%20August%202023%29.pdf",
  },
  {
    ...mauritiusRecordTimestamps,
    id: acceptanceFixtureIds.source.mauritiusTransport,
    isDemo: false,
    publishedOn: "2018-08-11",
    publisher: "Government of Mauritius / Government Gazette of Mauritius",
    sourceType: "official-regulation",
    title: "Road Traffic (Amendment) Act 2018 (Act No. 12 of 2018)",
    url: "https://landtransport.govmu.org/Documents/Legislations/act1218.pdf",
  },
  {
    ...malawiRecordTimestamps,
    id: acceptanceFixtureIds.source.malawiGovernment,
    isDemo: false,
    publishedOn: "1998-01-15",
    publisher: "Government of Malawi — Trade Portal",
    sourceType: "official-regulation",
    title: "Road Traffic Act — section 108 exhaust smoke and fumes",
    url: "https://portal.trade.gov.mw/en-gb/site/display/62",
  },
  {
    ...malawiRecordTimestamps,
    id: acceptanceFixtureIds.source.malawiTransport,
    isDemo: false,
    publishedOn: null,
    publisher: "Government of Malawi — Trade Portal",
    sourceType: "official-regulation",
    title: "Road Traffic Regulations — regulation 97 exhaust gas and smoke",
    url: "https://portal.trade.gov.mw/en-gb/site/display/101",
  },
  {
    ...fijiRecordTimestamps, id: acceptanceFixtureIds.source.fijiEnvironment, isDemo: false, publishedOn: "2025-01-28",
    publisher: "Fiji Revenue and Customs Service", sourceType: "government-notice",
    title: "Standard Interpretation Guideline 2025-04 — Customs (Prohibited Imports and Exports) Regulations 1986 – Importation of Motor Vehicles",
    url: "https://frcs.org.fj/wp-content/uploads/2025/01/SIG-2025-04-Importation-of-Motor-Vehicles-Customs-Prohibited-Imports-and-Exports-Regulations-1986.pdf",
  },
  {
    ...fijiRecordTimestamps, id: acceptanceFixtureIds.source.fijiTransport, isDemo: false, publishedOn: null,
    publisher: "Fiji Revenue and Customs Service", sourceType: "government-notice",
    title: "Importation of Used or Reconditioned Motor Vehicles in 2026",
    url: "https://frcs.org.fj/public-notice/importation-of-used-or-reconditioned-motor-vehicles-in-2026/",
  },
  {
    ...belizeRecordTimestamps, id: acceptanceFixtureIds.source.belizeEnvironment, isDemo: false, publishedOn: "1996-04-20",
    publisher: "Belize Department of the Environment / Government of Belize", sourceType: "official-regulation",
    title: "Pollution Regulations (S.I. No. 56 of 1996), Chapter 328, Revised Edition 2020 — regulations 25–26 (PDF pp. 25–26)",
    url: "https://doe.gov.bz/wp-content/uploads/2024/02/Pollution-Regulations.pdf",
  },
  {
    ...belizeRecordTimestamps, id: acceptanceFixtureIds.source.belizeTransport, isDemo: false, publishedOn: null,
    publisher: "Government of Belize / Department of the Environment", sourceType: "official-regulation",
    title: "Environmental Protection Act, Chapter 328, Revised Edition 2020 — sections 6 and 45 (PDF pp. 21 and 45)",
    url: "https://doe.gov.bz/download/environmental-protection-act-chapter-328-re-2020/?wpdmdl=17080",
  },
  {
    ...bruneiRecordTimestamps, id: acceptanceFixtureIds.source.bruneiEnvironment, isDemo: false, publishedOn: null,
    publisher: "Attorney General’s Chambers, Brunei Darussalam", sourceType: "official-regulation",
    title: "Road Traffic Regulations (Chapter 68), Revised Edition 2022",
    url: "https://www.agc.gov.bn/AGC%20Images/LAWS/ACT_PDF/R/CHAPTER%20068%20RG1%20%282022%29.pdf",
  },
  {
    ...bruneiRecordTimestamps, id: acceptanceFixtureIds.source.bruneiTransport, isDemo: false, publishedOn: null,
    publisher: "Ministry of Communications & Land Transport Department, in collaboration with Brunei National Road Safety Council", sourceType: "government-notice",
    title: "Safe and Smart Driving in Brunei Darussalam",
    url: "https://www.jpd.gov.bn/SiteAssets/SitePages/Land%20Transport%20Department/Adverts/Safe%20and%20Smart%20Driving%20In%20Brunei%20Darussalam/Safe%20and%20Smart%20Driving%20in%20Brunei%20Darussalam%201st%20edition.pdf",
  },
  {
    ...bhutanRecordTimestamps, id: acceptanceFixtureIds.source.bhutanEnvironment, isDemo: false, publishedOn: null,
    publisher: "National Environment Commission, Royal Government of Bhutan", sourceType: "government-notice",
    title: "Environmental Standards, 2020",
    url: "https://www.nec.gov.bt/publications/download/environment-standards-2020",
  },
  {
    ...bhutanRecordTimestamps, id: acceptanceFixtureIds.source.bhutanTransport, isDemo: false, publishedOn: "2026-07-03",
    publisher: "Bhutan Construction and Transport Authority", sourceType: "government-notice",
    title: "Public Notification – Implementation of the Road Safety and Transport Rules and Regulations (RSTRR) 2026",
    url: "https://bcta.gov.bt/public-notification-implementation-of-the-road-safety-and-transport-rules-and-regulations-rstrr-2026/",
  },
  {
    ...centralAfricanRepublicRecordTimestamps, id: acceptanceFixtureIds.source.centralAfricanRepublicEnvironment, isDemo: false, publishedOn: "2007-12-28",
    publisher: "Présidence de la République / Journal officiel de la République centrafricaine", sourceType: "official-regulation",
    title: "Loi n° 07.018 du 28 décembre 2007 portant Code de l’environnement de la République centrafricaine",
    url: "https://faolex.fao.org/docs/pdf/caf105925.pdf",
  },
  {
    ...centralAfricanRepublicRecordTimestamps, id: acceptanceFixtureIds.source.centralAfricanRepublicTransport, isDemo: false, publishedOn: "2026-03-09",
    publisher: "République centrafricaine / Ministère de l’Environnement et du Développement durable / UNFCCC NDC Registry", sourceType: "government-notice",
    title: "Contribution déterminée au niveau national (CDN 3.0) de la République centrafricaine",
    url: "https://unfccc.int/sites/default/files/2026-03/CDN%203.0%20CAR%202025.pdf",
  },
  {
    ...democraticRepublicOfCongoRecordTimestamps, id: acceptanceFixtureIds.source.democraticRepublicOfCongoEnvironment, isDemo: false, publishedOn: "2011-07-16",
    publisher: "Journal officiel de la République démocratique du Congo / Cabinet du Président; official copy hosted by the Ministry of Environment", sourceType: "official-regulation",
    title: "Loi n° 11/009 du 09 juillet 2011 portant principes fondamentaux relatifs à la protection de l’environnement",
    url: "https://medd.gouv.cd/wp-content/uploads/2020/07/attachment1.pdf",
  },
  {
    ...democraticRepublicOfCongoRecordTimestamps, id: acceptanceFixtureIds.source.democraticRepublicOfCongoTransport, isDemo: false, publishedOn: "2025-11-24",
    publisher: "Vice-Primature, Ministère des Transports, Voies de Communication et Désenclavement, République démocratique du Congo", sourceType: "official-regulation",
    title: "Arrêté ministériel n° VPM/MTVCD/CAB/085/2025 du 12 novembre 2025 portant réglementation du contrôle technique des véhicules automobiles et des remorques en circulation en République démocratique du Congo",
    url: "https://transports.gouv.cd/wp-content/uploads/2025/11/ARRETE-MINISTERIEL-N%C2%B0085-DU-12-NOV-2025-PORTANT-RE_251124_152526.pdf",
  },
  {
    ...republicOfCongoRecordTimestamps, id: acceptanceFixtureIds.source.republicOfCongoEnvironment, isDemo: false, publishedOn: "2023-11-17",
    publisher: "Présidence de la République / Ministère de l’Environnement, du Développement durable et du Bassin du Congo", sourceType: "official-regulation",
    title: "Loi n° 33-2023 du 17 novembre 2023 portant gestion durable de l’environnement en République du Congo",
    url: "https://www.developpement-durable.gouv.cg/wp-content/uploads/2023/11/Loi_n_33-2023_du_17_novembre_portant_gestion_durable_de_l_environnement_en_Republique_du_Congo_.pdf",
  },
  {
    ...republicOfCongoRecordTimestamps, id: acceptanceFixtureIds.source.republicOfCongoTransport, isDemo: false, publishedOn: "2019-07-18",
    publisher: "Secrétariat général du Gouvernement / Journal officiel de la République du Congo", sourceType: "official-regulation",
    title: "Journal officiel n° 29 du 18 juillet 2019 — Décret n° 2019-171 du 1er juillet 2019 portant réglementation du contrôle technique des véhicules routiers",
    url: "https://www.sgg.cg/JO/2019/congo-jo-2019-29.pdf",
  },
  {
    ...cubaRecordTimestamps, id: acceptanceFixtureIds.source.cubaEnvironment, isDemo: false, publishedOn: "2023-09-13",
    publisher: "Gaceta Oficial de la República de Cuba / Ministerio de Justicia / Asamblea Nacional del Poder Popular", sourceType: "official-regulation",
    title: "Gaceta Oficial No. 87 Ordinaria de 13 de septiembre de 2023 — Ley 150/2022 Del Sistema de los Recursos Naturales y el Medio Ambiente (GOC-2023-771-O87)",
    url: "https://www.gacetaoficial.gob.cu/sites/default/files/goc-2023-o87.pdf",
  },
  {
    ...cubaRecordTimestamps, id: acceptanceFixtureIds.source.cubaTransport, isDemo: false, publishedOn: "2011-03-15",
    publisher: "Gaceta Oficial de la República de Cuba / Ministerio de Justicia / Ministerio del Transporte", sourceType: "official-regulation",
    title: "Gaceta Oficial No. 014 Extraordinaria de 15 de marzo de 2011 — Resolución No. 151/2011, Normas Complementarias para la Seguridad Vial",
    url: "https://www.gacetaoficial.gob.cu/sites/default/files/go_x_014_2011.pdf",
  },
  {
    ...djiboutiRecordTimestamps, id: acceptanceFixtureIds.source.djiboutiEnvironment, isDemo: false, publishedOn: "2009-07-01",
    publisher: "Journal Officiel de la République de Djibouti / Présidence de la République", sourceType: "official-regulation",
    title: "Loi n° 51/AN/09/6ème L portant Code de l’Environnement",
    url: "https://www.journalofficiel.dj/texte-juridique/loi-n51-an-09-6eme-l-portant-code-de-lenvironnement/",
  },
  {
    ...djiboutiRecordTimestamps, id: acceptanceFixtureIds.source.djiboutiTransport, isDemo: false, publishedOn: "2010-12-15",
    publisher: "Journal Officiel de la République de Djibouti / Présidence de la République", sourceType: "official-regulation",
    title: "Décret n° 2010-0230/PR/MID du 4 décembre 2010 relatif aux nouvelles dispositions réglementaires du Code de la Route",
    url: "https://www.journalofficiel.dj/texte-juridique/decret-n2010-0230-pr-mid-relatif-aux-nouvelles-dispositions-reglementaires-du-code-de-la-route/",
  },
  {
    ...eritreaRecordTimestamps,
    id: acceptanceFixtureIds.source.eritreaEnvironmentalProtectionManagementRegulations127_2017,
    isDemo: false,
    publishedOn: "2017-01-26",
    publisher: "Government of the State of Eritrea / Gazette of Eritrean Laws",
    sourceType: "official-regulation",
    title: "Environmental Protection and Management Regulations 127/2017",
    url: "https://tile.loc.gov/storage-services/service/ll/lleritrea/eritrean-notice-127-2017/eritrean-notice-127-2017.pdf",
  },
  {
    ...eritreaRecordTimestamps,
    id: acceptanceFixtureIds.source.eritreaVehicleTechnicalStandardsRegulations61_2002,
    isDemo: false,
    publishedOn: "2002-05-13",
    publisher: "Government of the State of Eritrea / Gazette of Eritrean Laws",
    sourceType: "official-regulation",
    title: "Regulations on Vehicle Technical and Related Standards Specifications 61/2002",
    url: "https://tile.loc.gov/storage-services/service/ll/lleritrea/eritrean-notice-61-2002/eritrean-notice-61-2002.pdf",
  },
  {
    ...gabonRecordTimestamps,
    id: acceptanceFixtureIds.source.gabonEnvironmentalProtectionLaw007_2014,
    isDemo: false,
    publishedOn: "2014-09-16",
    publisher: "Journal Officiel de la République Gabonaise / Présidence de la République",
    sourceType: "official-regulation",
    title: "JOURNAL OFFICIEL N°222 DU 16 SEPTEMBRE 2014 — Loi N° 007/2014 du 31/07/2014 relative à la protection de l'environnement en République Gabonaise",
    url: "https://journal-officiel.ga/6186-007-2014/",
  },
  {
    ...gabonRecordTimestamps,
    id: acceptanceFixtureIds.source.gabonHeavyVehicleHomologationOrder00097_2017,
    isDemo: false,
    publishedOn: "2017-04-23",
    publisher: "Journal Officiel de la République Gabonaise / Ministère des Transports et de la Logistique",
    sourceType: "official-regulation",
    title: "JOURNAL OFFICIEL N°345 TER DU 23 AVRIL 2017 — Arrêté N° 00097/MTL/2017 du 24/02/2017 relatif à la conduite, la certification et l'homologation des véhicules poids lourds, remorques, semi-remorques, engins et tous les équipements de levage et de manutention, les engins spéciaux et leurs agrès",
    url: "https://journal-officiel.ga/5680-00097-mtl-2017-/",
  },
  {
    ...guineaRecordTimestamps, id: acceptanceFixtureIds.source.guineaEnvironment, isDemo: false, publishedOn: "2019-07-26",
    publisher: "Présidence de la République / Secrétariat général du Gouvernement, République de Guinée", sourceType: "official-regulation",
    title: "Décret D/2019/221/PRG/SGG portant promulgation de la Loi L/2019/0034/AN du 04 juillet 2019 portant Code de l’environnement de la République de Guinée",
    url: "https://medd.gov.gn/file/2022/12/Code-de-lEnvironnement-du-04-juillet-2019-1.pdf",
  },
  {
    ...guineaRecordTimestamps, id: acceptanceFixtureIds.source.guineaTransport, isDemo: false, publishedOn: "2018-06-20",
    publisher: "Assemblée nationale de la République de Guinée / official archive hosted by the Conseil national de la transition", sourceType: "official-regulation",
    title: "Loi ordinaire n° L/2018/023/AN du 20 juin 2018 portant Code de la route de la République de Guinée",
    url: "https://cnt.gov.gn/archive.assemblee/www.assemblee.gov.gn/node/739.html",
  },
  {
    ...gambiaRecordTimestamps,
    id: acceptanceFixtureIds.source.gambiaEnvironmentalQualityStandardsRegulations1999,
    isDemo: false,
    publishedOn: null,
    publisher: "National Environment Management Council / National Environment Agency, The Gambia",
    sourceType: "official-regulation",
    title: "Environmental Quality Standards Regulations, 1999",
    url: "https://faolex.fao.org/docs/pdf/gam95812.pdf",
  },
  {
    ...gambiaRecordTimestamps,
    id: acceptanceFixtureIds.source.gambiaMotorTrafficAmendmentAct2013,
    isDemo: false,
    publishedOn: "2014-01-23",
    publisher: "The Gambia Gazette / National Assembly of The Gambia",
    sourceType: "official-regulation",
    title: "Supplement “C” to The Gambia Gazette No. 1 of 23rd January, 2014 — Motor Traffic (Amendment) Act, 2013 (No. 12 of 2013)",
    url: "https://security-legislation.gm/wp-content/uploads/2022/10/Motor-Traffic-Amendment-Act-2013.pdf",
  },
  {
    ...guineaBissauRecordTimestamps,
    id: acceptanceFixtureIds.source.guineaBissauBasicEnvironmentLaw1_2011,
    isDemo: false,
    publishedOn: "2011-03-02",
    publisher: "Assembleia Nacional Popular / Boletim Oficial da República da Guiné-Bissau",
    sourceType: "official-regulation",
    title: "2.º Suplemento ao Boletim Oficial da República da Guiné-Bissau n.º 9 — Lei n.º 1/2011, de 2 de Março — Lei de Bases do Ambiente",
    url: "https://faolex.fao.org/docs/pdf/gbs118164.pdf",
  },
  {
    ...guineaBissauRecordTimestamps,
    id: acceptanceFixtureIds.source.guineaBissauTransportMinistryDirectory,
    isDemo: false,
    publishedOn: null,
    publisher: "Governo da República da Guiné-Bissau / Ministério dos Transportes e Comunicações",
    sourceType: "government-notice",
    title: "Ministério dos Transportes e Comunicações — Governo da Guiné-Bissau",
    url: "https://bissaugov.com/ministerios/transportes-comunicacoes",
  },
  {
    ...equatorialGuineaRecordTimestamps,
    id: acceptanceFixtureIds.source.equatorialGuineaEnvironmentalLaw7_2003,
    isDemo: false,
    publishedOn: "2003-11-27",
    publisher: "Presidencia de la República de Guinea Ecuatorial / Boletín Oficial del Estado",
    sourceType: "official-regulation",
    title: "Ley número 7/2003, de fecha 27 de noviembre, Reguladora del Medio Ambiente en Guinea Ecuatorial",
    url: "https://faolex.fao.org/docs/pdf/eqg102892.pdf",
  },
  {
    ...equatorialGuineaRecordTimestamps,
    id: acceptanceFixtureIds.source.equatorialGuineaGeneralRoadTransportLaw4_2018,
    isDemo: false,
    publishedOn: "2019-03-25",
    publisher: "Dirección General del Boletín Oficial del Estado / Presidencia del Gobierno de Guinea Ecuatorial",
    sourceType: "official-regulation",
    title: "Ley General de Transporte por Carretera Nº 4 — Ley Núm. 4/2.018, de fecha 19 de Diciembre, General de Transporte por Carretera en la República de Guinea Ecuatorial",
    url: "https://minhacienda-gob.com/media/stream/8301",
  },
  {
    ...greenlandRecordTimestamps, id: acceptanceFixtureIds.source.greenlandEnvironment, isDemo: false, publishedOn: "1979-03-27",
    publisher: "Government of Greenland / Nalunaarutit", sourceType: "official-regulation",
    title: "Administrative Regulation No. 141/1979 — vehicle construction and equipment in Greenland",
    url: "https://nalunaarutit.gl/Rigslovgivning/1979/Bekendtgoerelse-nr-141-af-27_03_1979?sc_lang=da",
  },
  {
    ...greenlandRecordTimestamps, id: acceptanceFixtureIds.source.greenlandTransport, isDemo: false, publishedOn: "2009-10-26",
    publisher: "Danish Ministry of Justice / Official Legal Information System", sourceType: "official-regulation",
    title: "Consolidated Act No. 995/2009 — Road Traffic Act for Greenland",
    url: "https://www.retsinformation.dk/eli/lta/2009/995",
  },
  {
    ...guyanaRecordTimestamps, id: acceptanceFixtureIds.source.guyanaEnvironment, isDemo: false, publishedOn: "2000-12-13",
    publisher: "Ministry of Legal Affairs, Guyana", sourceType: "official-regulation",
    title: "Environmental Protection (Air Quality) Regulations, 2000 (Reg. 9/2000) — regulations 18–20 (PDF pp. 167–168)",
    url: "https://mola.gov.gy/laws/Volume%206%20Cap.%2018.01%20-%2023.011696964321.pdf",
  },
  {
    ...guyanaRecordTimestamps, id: acceptanceFixtureIds.source.guyanaTransport, isDemo: false, publishedOn: "1940-12-20",
    publisher: "Ministry of Legal Affairs, Guyana", sourceType: "official-regulation",
    title: "Motor Vehicles and Road Traffic Act, Chapter 51:02 — section 103(1)(xxii) (PDF p. 108)",
    url: "https://mola.gov.gy/laws/Volume%2011%20Cap.%2049.02%20-%2058.011696827006.pdf",
  },
  {
    ...haitiRecordTimestamps, id: acceptanceFixtureIds.source.haitiEnvironment, isDemo: false, publishedOn: "2006-01-26",
    publisher: "Le Moniteur — Journal officiel de la République d’Haïti / Presses Nationales d’Haïti", sourceType: "official-regulation",
    title: "Décret portant sur la Gestion de l’Environnement et de Régulation de la Conduite des Citoyens et Citoyennes pour un Développement Durable — Le Moniteur No. 11",
    url: "https://faolex.fao.org/docs/pdf/hai65901.pdf",
  },
  {
    ...haitiRecordTimestamps, id: acceptanceFixtureIds.source.haitiTransport, isDemo: false, publishedOn: "2025-07-18",
    publisher: "Gouvernement de la République d’Haïti / Ministère du Commerce et de l’Industrie", sourceType: "government-notice",
    title: "Le MCI intensifie son soutien aux MPME et déploie davantage d’actions sur le territoire national",
    url: "https://communication.gouv.ht/communiques/le-mci-intensifie-son-soutien-aux-mpme-et-deploie-davantage-dactions-sur-le-territoire-national/",
  },
  {
    ...iranRecordTimestamps, id: acceptanceFixtureIds.source.iranTechnicalPollutionRegulation, isDemo: false, publishedOn: "2018-10-31",
    publisher: "Cabinet of Ministers of the Islamic Republic of Iran", sourceType: "official-regulation",
    title: "آیین‌نامه فنی در زمینه کنترل و کاهش آلودگی‌ها (موضوع ماده (۲) قانون هوای پاک)",
    url: "https://nezamat.ir/post-41054/",
  },
  {
    ...iranRecordTimestamps, id: acceptanceFixtureIds.source.iranArticle4Amendment2024, isDemo: false, publishedOn: "2024-02-18",
    publisher: "Cabinet of Ministers of the Islamic Republic of Iran", sourceType: "official-regulation",
    title: "اصلاح ماده (۴) آیین‌نامه فنی در زمینه کنترل و کاهش آلودگی‌ها (موضوع ماده (۲) قانون هوای پاک)",
    url: "https://nezamat.ir/post-44973/",
  },
  {
    ...iraqRecordTimestamps, id: acceptanceFixtureIds.source.iraqTr167AmendmentDecision2024, isDemo: false, publishedOn: "2024-04-15",
    publisher: "Iraq Central Organization for Standardization and Quality Control (COSQC)", sourceType: "official-regulation",
    title: "قرارات هيئة اعتماد المواصفات العراقية في اجتماعها المرقم (507) في 3/3/2024",
    url: "https://www.iraqi-standards.org/wan/ns/p/0000018.html",
  },
  {
    ...iraqRecordTimestamps, id: acceptanceFixtureIds.source.iraqTr167ImplementationNotice2025, isDemo: false, publishedOn: "2025-12-12",
    publisher: "Iraqi News Agency (INA) / Iraq Ministry of Trade", sourceType: "government-notice",
    title: "تشمل جميع المركبات.. التجارة: بدء تطبيق المواصفة العراقية للسيارات مطلع 2026",
    url: "https://ina.iq/ar/local/250006-2026.html",
  },
  {
    ...jamaicaRecordTimestamps, id: acceptanceFixtureIds.source.jamaicaEnvironment, isDemo: false, publishedOn: "2022-05-20",
    publisher: "Jamaica Ministry of Energy, Transport and Telecommunications", sourceType: "official-regulation",
    title: "The Road Traffic Regulations, 2022 — Regulation 66 (PDF pp. 66–68) and Eighth Schedule Part A (PDF pp. 287–289)",
    url: "https://mtm.gov.jm/wp-content/uploads/2023/02/Road-Traffic-Regulations-May-20-2022-complete.pdf",
  },
  {
    ...jamaicaRecordTimestamps, id: acceptanceFixtureIds.source.jamaicaTransport, isDemo: false, publishedOn: null,
    publisher: "Jamaica Ministry of Energy, Transport and Telecommunications", sourceType: "government-notice",
    title: "Forms and Documents – Ministry of Energy, Transport and Telecommunications",
    url: "https://mtm.gov.jm/forms/",
  },
  { ...lebanonRecordTimestamps, id: acceptanceFixtureIds.source.lebanonEnvironmentalProtectionLaw444, isDemo: false, publishedOn: "2002-07-29", publisher: "Lebanon Ministry of Environment", sourceType: "official-regulation", title: "قانون رقم 444 - حماية البيئة", url: "https://moe.gov.lb/%D8%A7%D9%84%D9%88%D8%B2%D8%A7%D8%B1%D8%A9/%D8%A7%D9%84%D9%82%D9%88%D8%A7%D9%86%D9%8A%D9%86-%D9%88%D8%A7%D9%84%D8%A7%D9%86%D8%B8%D9%85%D8%A9/%D8%A7%D9%84%D9%82%D9%88%D8%A7%D9%86%D9%8A%D9%86/%D9%82%D8%A7%D9%86%D9%88%D9%86-%D8%B1%D9%82%D9%85-444-%D8%AD%D9%85%D8%A7%D9%8A%D8%A9-%D8%A7%D9%84%D8%A8%D9%8A%D8%A6%D8%A9.aspx?lang=ar-LB" },
  { ...lebanonRecordTimestamps, id: acceptanceFixtureIds.source.lebanonThirdBur2019, isDemo: false, publishedOn: "2019-12-31", publisher: "Lebanon Ministry of Environment / UNDP / GEF", sourceType: "government-notice", title: "Lebanon’s Third Biennial Update Report to the UNFCCC", url: "https://lebanon.un.org/en/download/60471/107789" },
  { ...liberiaRecordTimestamps, id: acceptanceFixtureIds.source.liberiaEnvironmentalProtectionManagementLaw, isDemo: false, publishedOn: "2003-04-30", publisher: "Republic of Liberia / Ministry of Foreign Affairs; official EPA host", sourceType: "official-regulation", title: "Environmental Protection and Management Law of Liberia", url: "https://epa.gov.lr/wp-content/uploads/2025/10/lbr53038.pdf" },
  { ...liberiaRecordTimestamps, id: acceptanceFixtureIds.source.liberiaVehicleAdministrativeRegulation2011, isDemo: false, publishedOn: "2011-06-18", publisher: "Liberia Ministry of Transport", sourceType: "official-regulation", title: "Ministry of Transport Administrative Regulation PG/No.002/82997 June, 2011", url: "https://mot.gov.lr/sites/default/files/documents/ADMINISTRATIVE%20REGULATION%20%20AA%20June%2017%2C%202016%20-%20Copy.pdf" },
  { ...libyaRecordTimestamps, id: acceptanceFixtureIds.source.libyaEnvironmentalProtectionLaw15, isDemo: false, publishedOn: "2003-06-13", publisher: "General People's Congress / Libya Ministry of Environment", sourceType: "official-regulation", title: "Law No. 15 of 2003 on Environmental Protection", url: "https://environment.gov.ly/wp-content/uploads/2022/04/Image-to-PDF-%D8%A7%D9%84%D9%82%D8%A7%D9%86%D9%88%D9%86-%D8%B1%D9%82%D9%85-15-%D9%A2%D9%A0%D9%A2%D9%A2-%D9%A0%D9%A4-%D9%A1%D9%A5-%D9%A1%D9%A5-%D9%A5%D9%A2-%D9%A1%D9%A0.pdf" },
  { ...libyaRecordTimestamps, id: acceptanceFixtureIds.source.libyaEnvironmentalExecutiveRegulation448, isDemo: false, publishedOn: "2009-10-09", publisher: "General People's Committee / Libya Ministry of Environment", sourceType: "official-regulation", title: "Decision No. 448 of 2009 — executive regulation for Law No. 15 of 2003 on Environmental Protection", url: "https://environment.gov.ly/wp-content/uploads/2022/04/%D8%A7%D9%84%D9%84%D8%A7%D8%A6%D8%AD%D8%A9-%D8%A7%D9%84%D8%AA%D9%86%D9%81%D9%8A%D8%B0%D9%8A%D8%A9-%D9%84%D9%84%D9%82%D8%A7%D9%86%D9%88%D9%86-%D8%B1%D9%82%D9%85-15.pdf" },
  { ...maliRecordTimestamps, id: acceptanceFixtureIds.source.maliTechnicalInspectionOrder2020, isDemo: false, publishedOn: "2020-03-27", publisher: "Republic of Mali / Secretariat General of Government", sourceType: "official-regulation", title: "Journal officiel de la République du Mali n°08 du 27 mars 2020 — Arrêté n°2020-1080/MTMU-SG du 20 mars 2020 fixant les modalités de mise en œuvre du contrôle technique automobile", url: "https://sgg-mali.ml/JO/2020/mali-jo-2020-08.pdf" },
  { ...maliRecordTimestamps, id: acceptanceFixtureIds.source.maliRoadUseVehicleCirculationDecree2023, isDemo: false, publishedOn: "2023-09-29", publisher: "Republic of Mali / Secretariat General of Government", sourceType: "official-regulation", title: "Journal officiel de la République du Mali n°26 du 29 septembre 2023 — Décret n°2023-0509/PT-RM du 12 septembre 2023 fixant les conditions de l’usage des voies ouvertes à la circulation publique et de la mise en circulation des véhicules", url: "https://sgg-mali.ml/JO/2023/mali-jo-2023-26.pdf" },
  { ...myanmarRecordTimestamps, id: acceptanceFixtureIds.source.myanmarEnvironment, isDemo: false, publishedOn: "2015-12-29", publisher: "Myanmar Ministry of Environmental Conservation and Forestry / Environmental Conservation Department", sourceType: "government-notice", title: "National Environmental Quality (Emission) Guidelines (Final), Notification No. 615/2015", url: "https://www.ecd.gov.mm/national-environmental-quality-emission-guidelines-final/" },
  { ...myanmarRecordTimestamps, id: acceptanceFixtureIds.source.myanmarTransport, isDemo: false, publishedOn: "2020-05-26", publisher: "Republic of the Union of Myanmar / Ministry of Transport and Communications / Road Transport Administration Department", sourceType: "official-regulation", title: "Road Safety and Motor Vehicle Management Law (2020), Pyidaungsu Hluttaw Law No. 6/2020", url: "https://www.myanmarrtad.com/?q=en%2Fnode%2F1925" },
  { ...mauritaniaRecordTimestamps, id: acceptanceFixtureIds.source.mauritaniaAirPollutionLaw2018, isDemo: false, publishedOn: "2018-01-02", publisher: "Mauritania Ministry of Environment and Sustainable Development", sourceType: "official-regulation", title: "Law No. 2018-002 on air-pollution prevention and control", url: "http://www.environnement.gov.mr/fr/images/reglementations/Loi_pollution_Air_FR.pdf" },
  { ...mauritaniaRecordTimestamps, id: acceptanceFixtureIds.source.mauritaniaEnvironmentCode2000, isDemo: false, publishedOn: "2000-10-30", publisher: "Islamic Republic of Mauritania", sourceType: "official-regulation", title: "Journal Officiel de la République Islamique de Mauritanie n°985 — Law No. 2000-045 of 26 July 2000 establishing the Environment Code", url: "http://www.environnement.gov.mr/fr/images/reglementations/LOI_Code_de_l_Environnement.pdf" },
  { ...newCaledoniaRecordTimestamps, id: acceptanceFixtureIds.source.newCaledoniaEnvironment, isDemo: false, publishedOn: "1965-09-27", publisher: "Congress of New Caledonia / Juridoc", sourceType: "official-regulation", title: "Délibération n° 224 des 9, 10 et 11 juin 1965 portant règlement général sur la police de la circulation et le roulage", url: "https://juridoc.gouv.nc/juridoc/jdcodes.nsf/0/59295762BD9870FE4B258184001CDC1D/%24File/Code_route_NC_9-10-11-06-1965_ChG_07-10-2025.pdf?OpenElement=" },
  { ...newCaledoniaRecordTimestamps, id: acceptanceFixtureIds.source.newCaledoniaTransport, isDemo: false, publishedOn: "2019-10-03", publisher: "New Caledonia Directorate of Infrastructure, Topography and Land Transport", sourceType: "government-notice", title: "Importation, transformation ou remise en circulation d'un véhicule", url: "https://dittt.gouv.nc/vehicule-formalites/importation-transformation-ou-remise-en-circulation-dun-vehicule" },
  { ...nigerRecordTimestamps, id: acceptanceFixtureIds.source.nigerEnvironmentalFrameworkLaw9856, isDemo: false, publishedOn: "1998-12-29", publisher: "Republic of Niger", sourceType: "official-regulation", title: "Law No. 98-56 of 29 December 1998 — framework law on environmental management", url: "https://hydraulique.gouv.ne/wp-content/uploads/2025/07/LoiN%C2%B098-056gestiondelEnvironnement.pdf" },
  { ...nigerRecordTimestamps, id: acceptanceFixtureIds.source.nigerMotorVehicleHomologationEServices, isDemo: false, publishedOn: null, publisher: "Niger Ministry of Transport and Civil Aviation", sourceType: "government-notice", title: "Services en Ligne — Homologation des Véhicules Terrestres à Moteur", url: "https://transports.gouv.ne/e-services" },
  { ...nicaraguaRecordTimestamps, id: acceptanceFixtureIds.source.nicaraguaEnvironment, isDemo: false, publishedOn: "1997-06-18", publisher: "National Assembly of Nicaragua", sourceType: "official-regulation", title: "Consolidated Decree No. 32-97 — motor vehicle emission control, Articles 10–25", url: "https://legislacion.asamblea.gob.ni/Normaweb.nsf/xpNormaJuridica.xsp?action=openDocument&documentId=0404E60D225D0ACF062588E2006EE9F8" },
  { ...nicaraguaRecordTimestamps, id: acceptanceFixtureIds.source.nicaraguaTransport, isDemo: false, publishedOn: "2022-02-22", publisher: "National Assembly of Nicaragua", sourceType: "official-regulation", title: "Consolidated Law No. 431 — vehicle emission-control certificates, Articles 59–60", url: "https://legislacion.asamblea.gob.ni/Normaweb.nsf/xpNorma.xsp?action=openDocument&documentId=DDDCD831D507891D06258844005A7F39" },
  { ...papuaNewGuineaRecordTimestamps, id: acceptanceFixtureIds.source.papuaNewGuineaEnvironment, isDemo: false, publishedOn: "2018-11-30", publisher: "Papua New Guinea Road Traffic Authority", sourceType: "official-regulation", title: "Road Traffic Rules — Vehicle Standards and Compliance 2017, including Amendment 1", url: "https://rta.gov.pg/pdfs/resources/legislation/rules/RTR_VehicleStandardsAndCompliance2018.pdf" },
  { ...papuaNewGuineaRecordTimestamps, id: acceptanceFixtureIds.source.papuaNewGuineaTransport, isDemo: false, publishedOn: null, publisher: "Papua New Guinea Road Traffic Authority", sourceType: "government-notice", title: "Road Traffic Authority rules — commencement and amended vehicle standards", url: "https://www.rta.gov.pg/resources/rules/" },
  { ...puertoRicoRecordTimestamps, id: acceptanceFixtureIds.source.puertoRicoEnvironment, isDemo: false, publishedOn: null, publisher: "Puerto Rico Department of Natural and Environmental Resources", sourceType: "official-regulation", title: "Regulation No. 5300 — Air Pollution Control Regulation, Rule 403(B)", url: "https://www.drna.pr.gov/wp-content/uploads/2019/10/Reglamento-5300-Reglamento-Control-Contaminacion-Atmosferica-1995.pdf" },
  { ...puertoRicoRecordTimestamps, id: acceptanceFixtureIds.source.puertoRicoTransport, isDemo: false, publishedOn: null, publisher: "Puerto Rico Department of Transportation and Public Works", sourceType: "official-regulation", title: "Regulation No. 9526 — official inspection stations and motor vehicle inspection", url: "https://docs.pr.gov/files/DTOP/Avisos/Reglamentos%20para%20estaciones%20oficiales.pdf" },
  { ...northKoreaRecordTimestamps, id: acceptanceFixtureIds.source.northKoreaEnvironment, isDemo: false, publishedOn: "1986-04-09", publisher: "Democratic People's Republic of Korea", sourceType: "official-regulation", title: "Law of the Democratic People's Republic of Korea on the Protection of the Environment", url: "https://faolex.fao.org/docs/pdf/prk22293.pdf" },
  { ...northKoreaRecordTimestamps, id: acceptanceFixtureIds.source.northKoreaTransport, isDemo: false, publishedOn: "2022-06-02", publisher: "Democratic People's Republic of Korea / UNFCCC", sourceType: "government-notice", title: "Democratic People's Republic of Korea First NDC (Updated submission)", url: "https://unfccc.int/documents/497842" },
  { ...paraguayRecordTimestamps, id: acceptanceFixtureIds.source.paraguayEnvironment, isDemo: false, publishedOn: "2019-02-13", publisher: "Presidency of the Republic of Paraguay / MADES", sourceType: "official-regulation", title: "Decree No. 1269/2019 implementing Air Quality Law No. 5211/2014", url: "https://www.mades.gov.py/wp-content/uploads/2025/03/DECRETO-Nro-1269-de-fecha-13-de-febrero-de-2019.pdf" },
  { ...paraguayRecordTimestamps, id: acceptanceFixtureIds.source.paraguayTransport, isDemo: false, publishedOn: "2021-12-29", publisher: "Paraguay Ministry of Environment and Sustainable Development (MADES)", sourceType: "official-regulation", title: "Resolución N° 605/2021 — Por la cual se modifican los artículos 10 y 11 de la Resolución N° 78/18 y el artículo 2° de la Resolución N° 98/19 referentes a emisiones de fuentes móviles y se disponen procedimientos para medición de gases provenientes de las mismas", url: "https://www.mades.gov.py/wp-content/uploads/2025/04/RESOLUCION-N%C2%B0-605-DE-FECHA-29-DE-DICIEMBRE-DE-2021.pdf" },
  { ...palestineRecordTimestamps, id: acceptanceFixtureIds.source.palestineEnvironment, isDemo: false, publishedOn: "1999-12-28", publisher: "Palestine Bureau of Legislation and Legal Opinion", sourceType: "official-regulation", title: "Environment Law No. 7 of 1999 — Articles 19 and 22 air standards and vehicle exhaust", url: "https://mjr.ogb.gov.ps/MergedLegislations/ViewText/66/%D9%82%D8%A7%D9%86%D9%88%D9%86-%D8%B1%D9%82%D9%85-7-%D9%84%D8%B3%D9%86%D8%A9-1999%D9%85-%D8%A8%D8%B4%D8%A3%D9%86-%D8%A7%D9%84%D8%A8%D9%8A%D8%A6%D8%A9-%D9%81%D9%84%D8%B3%D8%B7%D9%8A%D9%86" },
  { ...palestineRecordTimestamps, id: acceptanceFixtureIds.source.palestineTransport, isDemo: false, publishedOn: "2000-09-17", publisher: "Palestine Bureau of Legislation and Legal Opinion", sourceType: "official-regulation", title: "Traffic Law No. 5 of 2000 — vehicle specifications, first registration and periodic inspection", url: "https://mjr.ogb.gov.ps/MergedLegislations/ViewText/31/%D9%82%D8%A7%D9%86%D9%88%D9%86-%D8%A7%D9%84%D9%85%D8%B1%D9%88%D8%B1-%D8%B1%D9%82%D9%85-5-%D9%84%D8%B3%D9%86%D8%A9-2000%D9%85-%D9%81%D9%84%D8%B3%D8%B7%D9%8A%D9%86" },
  { ...sudanRecordTimestamps, id: acceptanceFixtureIds.source.sudanEnvironment, isDemo: false, publishedOn: null, publisher: "Republic of the Sudan / Higher Council for Environment and Natural Resources", sourceType: "official-regulation", title: "قانون حماية البيئة لسنة 2001 / Environment Protection Act 2001 (Act No. 18 of 2001)", url: "https://hcenr.gov.sd/wp-content/uploads/2021/05/%D9%82%D8%A7%D9%86%D9%88%D9%86-%D8%AD%D9%85%D8%A7%D9%8A%D8%A9-%D8%A7%D9%84%D8%A8%D9%8A%D8%A6%D8%A9-%D9%84%D8%B3%D9%86%D8%A9-2001.pdf" },
  { ...sudanRecordTimestamps, id: acceptanceFixtureIds.source.sudanTransport, isDemo: false, publishedOn: "2025-04-14", publisher: "Republic of the Sudan, Council of Ministers, Higher Council for Environment and Natural Resources / UNFCCC", sourceType: "government-notice", title: "Sudan. National Communication (NC). NC 3.", url: "https://unfccc.int/documents/646439" },
  { ...solomonIslandsRecordTimestamps, id: acceptanceFixtureIds.source.solomonIslandsEnvironment, isDemo: false, publishedOn: null, publisher: "Attorney-General’s Chambers, Solomon Islands Government / Ministry of Justice and Legal Affairs", sourceType: "official-regulation", title: "Road Transport Act (Cap. 131)", url: "https://attorneygenerals.gov.sb/legislation-dashboard/download-info/road-transport-act-cap-131/" },
  { ...solomonIslandsRecordTimestamps, id: acceptanceFixtureIds.source.solomonIslandsTransport, isDemo: false, publishedOn: "2025-08-13", publisher: "Solomon Islands Government, Climate Change Division, Ministry of Environment, Climate Change, Disaster Management and Meteorology / UNFCCC", sourceType: "government-notice", title: "Solomon Islands Nationally Determined Contribution 3.0, 2025–2035", url: "https://unfccc.int/node/649205" },
  { ...sierraLeoneRecordTimestamps, id: acceptanceFixtureIds.source.sierraLeoneEnvironment, isDemo: false, publishedOn: "2022-09-15", publisher: "Government Printing Department / Parliament of Sierra Leone", sourceType: "official-regulation", title: "The Environment Protection Agency Act, 2022 (Act No. 15 of 2022)", url: "https://www.parliament.gov.sl/uploads/acts/THE%20ENVIRONMENT%20PROTECTION%20AGENCY%20ACT%2C%202022.pdf" },
  { ...sierraLeoneRecordTimestamps, id: acceptanceFixtureIds.source.sierraLeoneTransport, isDemo: false, publishedOn: "2024-11-22", publisher: "Environment Protection Agency Sierra Leone", sourceType: "government-notice", title: "National e-Mobility Strategy 2024–2035 — no type approval and proposed Euro IV–VI pathway", url: "https://epa.gov.sl/wp-content/uploads/2025/03/Gender-Sesitive-National-e-Mobility_-Strategy-2024-35_EPA-converted0.pdf" },
  { ...elSalvadorRecordTimestamps, id: acceptanceFixtureIds.source.elSalvadorEnvironment, isDemo: false, publishedOn: "2024-06-13", publisher: "Ministerio de Medio Ambiente y Recursos Naturales / Diario Oficial / Imprenta Nacional, El Salvador", sourceType: "official-regulation", title: "Acuerdo No. 126 — Reglamento Técnico Salvadoreño RTS 13.01.02:23 Calidad del Aire. Control de Emisiones Atmosféricas Generadas por Fuentes Móviles. Vehículos Terrestres. Límites Permisibles, Especificaciones Técnicas del Equipo y Procesos de Medición", url: "https://osartec.gob.sv/wp-content/uploads/download-manager-files/RTS-Calidad-del-aire_Fuentes-Moviles.pdf" },
  { ...elSalvadorRecordTimestamps, id: acceptanceFixtureIds.source.elSalvadorTransport, isDemo: false, publishedOn: null, publisher: "Organismo Salvadoreño de Reglamentación Técnica (OSARTEC)", sourceType: "government-notice", title: "Derogaciones", url: "https://osartec.gob.sv/servicios/derogaciones/" },
  { ...somaliaRecordTimestamps, id: acceptanceFixtureIds.source.somaliaEnvironment, isDemo: false, publishedOn: null, publisher: "Federal Government of Somalia / Ministry of Environment and Climate Change", sourceType: "official-regulation", title: "Environmental Protection and Management Act", url: "https://moecc.gov.so/wp-content/uploads/2024/10/Environmental-Protection-and-Management-Act-Engl_240625_145520-2.pdf" },
  { ...somaliaRecordTimestamps, id: acceptanceFixtureIds.source.somaliaTransport, isDemo: false, publishedOn: "2025-09-08", publisher: "Federal Republic of Somalia / UNFCCC", sourceType: "government-notice", title: "Updated Somalia's Third Generation Nationally Determined Contribution (NDC 3.0) — transport mitigation actions", url: "https://unfccc.int/sites/default/files/2025-09/Somalia%20NDC%203.0_Official_2025.pdf" },
  { ...southSudanRecordTimestamps, id: acceptanceFixtureIds.source.southSudanEnvironment, isDemo: false, publishedOn: null, publisher: "South Sudan National Bureau of Standards", sourceType: "official-regulation", title: "National Bureau of Standards Act, 2012", url: "https://ssnbs.gov.ss/wp-content/uploads/2026/02/National-Bureau-of-Standards-Act-2012-.pdf" },
  { ...southSudanRecordTimestamps, id: acceptanceFixtureIds.source.southSudanTransport, isDemo: false, publishedOn: "2022-06-02", publisher: "South Sudan Ministry of Environment and Forestry / UNFCCC", sourceType: "government-notice", title: "South Sudan's Second Nationally Determined Contribution", url: "https://unfccc.int/documents/497930" },
  { ...surinameRecordTimestamps, id: acceptanceFixtureIds.source.surinameEnvironment, isDemo: false, publishedOn: "2020-05-14", publisher: "De Nationale Assemblée / Staatsblad van de Republiek Suriname", sourceType: "official-regulation", title: "WET van 07 mei 2020, houdende regels voor duurzaam milieumanagement (Milieu Raamwet), S.B. 2020 no. 97", url: "https://www.dna.sr/media/bkih12kt/sb_2020___97.pdf" },
  { ...surinameRecordTimestamps, id: acceptanceFixtureIds.source.surinameTransport, isDemo: false, publishedOn: "2024-05-28", publisher: "De Nationale Assemblée / Staatsblad van de Republiek Suriname", sourceType: "official-regulation", title: "Wet van 21 mei 2024, houdende wijziging van de Milieu Raamwet (S.B. 2020 no. 97), S.B. 2024 no. 56", url: "https://www.dna.sr/media/fadicptr/s-b-_2024_no-_56__wet_van_21_mei_2024__houdende_wijziging_van_de_milieu_raamwet__s-b-_2020_no-_97_.pdf" },
  { ...syriaRecordTimestamps, id: acceptanceFixtureIds.source.syriaEnvironmentLaw12, isDemo: false, publishedOn: "2012-03-29", publisher: "Syrian Arab Republic / FAOLEX", sourceType: "official-regulation", title: "القانون 12 لعام 2012 قانون وزارة الدولة لشؤون البيئة", url: "https://faolex.fao.org/docs/pdf/syr212392.pdf" },
  { ...syriaRecordTimestamps, id: acceptanceFixtureIds.source.syriaVehicleImportNotice2025, isDemo: false, publishedOn: "2025-06-30", publisher: "Syrian Arab News Agency (SANA) / Ministry of Economy and Industry", sourceType: "government-notice", title: "وزارة الاقتصاد والصناعة توضح أسباب منع استيراد السيارات المستعملة", url: "https://sana.sy/economy/2238146/" },
  { ...chadRecordTimestamps, id: acceptanceFixtureIds.source.chadEnvironment, isDemo: false, publishedOn: "2009-08-06", publisher: "Republic of Chad / Ministry of Environment and Fisheries Resources", sourceType: "official-regulation", title: "Décret n° 904/PR/PM/MERH/2009 portant réglementation des pollutions et des nuisances à l'environnement", url: "https://www.environnement.gouv.td/sites/default/files/inline-files/7.pdf" },
  { ...chadRecordTimestamps, id: acceptanceFixtureIds.source.chadTransport, isDemo: false, publishedOn: "2025-02-12", publisher: "Republic of Chad / UNFCCC", sourceType: "government-notice", title: "Chad. Biennial update reports (BUR). BUR 1.", url: "https://unfccc.int/documents/645659" },
  { ...togoRecordTimestamps, id: acceptanceFixtureIds.source.togoEnvironment, isDemo: false, publishedOn: "2026-04-09", publisher: "République togolaise / Journal Officiel de la République Togolaise", sourceType: "official-regulation", title: "Loi n° 2026-007 du 24 mars 2026 modifiant et complétant la loi n° 2008-005 du 30 mai 2008 portant loi-cadre sur l’environnement", url: "https://jo.gouv.tg/sites/default/files/JO/JO_SPECIAL_BIS_71E_N_25.pdf" },
  { ...togoRecordTimestamps, id: acceptanceFixtureIds.source.togoTransport, isDemo: false, publishedOn: "2022-10-07", publisher: "République togolaise / Journal Officiel de la République Togolaise", sourceType: "official-regulation", title: "Décret n° 2022-085/PR du 03/08/22 fixant les modalités d’application de la loi n° 2013-011 du 07 juin 2013 portant code de la route", url: "https://www.jo.gouv.tg/sites/default/files/JO/JOS_07_10_2022%20-%2067%20E%20ANNEE%20N%C2%B041%20BIS.pdf" },
  { ...timorLesteRecordTimestamps, id: acceptanceFixtureIds.source.timorLesteEnvironment, isDemo: false, publishedOn: "2012-07-04", publisher: "Jornal da República / Ministério da Justiça, República Democrática de Timor-Leste", sourceType: "official-regulation", title: "Decreto-Lei n.º 26/2012, de 4 de Julho — Lei de Bases do Ambiente", url: "https://www.mj.gov.tl/jornal/public/docs/2012/serie_1/serie1_no24.pdf" },
  { ...timorLesteRecordTimestamps, id: acceptanceFixtureIds.source.timorLesteTransport, isDemo: false, publishedOn: "2003-04-03", publisher: "Jornal da República / Ministério da Justiça, República Democrática de Timor-Leste", sourceType: "official-regulation", title: "Decreto-Lei n.º 6/2003, de 3 de Abril — Código da Estrada", url: "https://www.mj.gov.tl/jornal/public/docs/2002_2005/decreto_lei_governo/6_2003.pdf" },
  { ...trinidadTobagoRecordTimestamps, id: acceptanceFixtureIds.source.trinidadTobagoEnvironment, isDemo: false, publishedOn: "2015-01-23", publisher: "Republic of Trinidad and Tobago / Environmental Management Authority", sourceType: "official-regulation", title: "The Air Pollution Rules, 2014 — Legal Notice No. 12", url: "https://www.ema.co.tt/our-environment/air/" },
  { ...trinidadTobagoRecordTimestamps, id: acceptanceFixtureIds.source.trinidadTobagoTransport, isDemo: false, publishedOn: "2026-02-02", publisher: "Parliament / Government Printer / Digital Legislative Library, Republic of Trinidad and Tobago", sourceType: "official-regulation", title: "Motor Vehicles and Road Traffic (Amendment) Act, 2026 — Act No. 2 of 2026", url: "https://laws.gov.tt/ttdll-web/revision/download/123556?type=amendment" },
  { ...taiwanRecordTimestamps, id: acceptanceFixtureIds.source.taiwanEnvironment, isDemo: false, publishedOn: "2023-06-30", publisher: "Taiwan Ministry of Environment", sourceType: "official-regulation", title: "移動污染源空氣污染物排放標準第五條 — 柴油汽車完整排放標準表", url: "https://oaout.moenv.gov.tw/law/Download.ashx?FileID=133507&id=FL015347&type=LAW" },
  { ...taiwanRecordTimestamps, id: acceptanceFixtureIds.source.taiwanTransport, isDemo: false, publishedOn: "2024-02-01", publisher: "Taiwan Ministry of Environment", sourceType: "official-regulation", title: "柴油及替代清潔燃料引擎汽車車型排氣審驗合格證明核發撤銷及廢止辦法 — 重型引擎族審驗", url: "https://oaout.moenv.gov.tw/law/LawContent.aspx?id=FL020193" },
  { ...venezuelaRecordTimestamps, id: acceptanceFixtureIds.source.venezuelaEnvironment, isDemo: false, publishedOn: "1998-09-04", publisher: "Presidencia de la República / Gaceta Oficial de la República de Venezuela", sourceType: "official-regulation", title: "Decreto Nº 2.673 de 19 de agosto de 1998 — Normas sobre emisiones de fuentes móviles", url: "https://faolex.fao.org/docs/pdf/ven181032.pdf" },
  { ...venezuelaRecordTimestamps, id: acceptanceFixtureIds.source.venezuelaTransport, isDemo: false, publishedOn: "2015-12-28", publisher: "Asamblea Nacional / Gaceta Oficial de la República Bolivariana de Venezuela", sourceType: "official-regulation", title: "Ley de Calidad de las Aguas y del Aire — mobile-source limits and preservation of prior technical rules", url: "https://faolex.fao.org/docs/pdf/ven151760.pdf" },
  { ...vanuatuRecordTimestamps, id: acceptanceFixtureIds.source.vanuatuEnvironment, isDemo: false, publishedOn: "2014-06-27", publisher: "Republic of Vanuatu / Department of Environmental Protection and Conservation", sourceType: "official-regulation", title: "Pollution (Control) Act No. 10 of 2013 — prescribed vehicle-emission standards and delegated regulations", url: "https://mocca.gov.vu/images/publications/legislation/DEPC/Legislation/Pollution%20%28Control%29%20Act..pdf" },
  { ...vanuatuRecordTimestamps, id: acceptanceFixtureIds.source.vanuatuTransport, isDemo: false, publishedOn: null, publisher: "Parliament of the Republic of Vanuatu / Ministry of Infrastructure and Public Utilities", sourceType: "government-notice", title: "Bill for the Import of Motor Vehicles (Control) (Amendment) Act No. of 2025", url: "https://parliament.gov.vu/images/Bills/Second%20Ordinary%20session%202025/Bill%20for%20the%20Motor%20Vehicles/Bill%20for%20the%20Motor%20Vehicles%20Control%20Am%20Act%20No.%20%20of%202025.pdf" },
  { ...yemenRecordTimestamps, id: acceptanceFixtureIds.source.yemenEnvironment, isDemo: false, publishedOn: "1995-10-29", publisher: "Yemen Public Prosecution (Office of the Attorney General) / Republic of Yemen", sourceType: "official-regulation", title: "قانون رقم (26) لسنة 1995م بشأن حماية البيئة — Law No. 26 of 1995 on Environmental Protection", url: "https://www.agoye.gov.ye/page.php?id=323&lng=arabic" },
  { ...yemenRecordTimestamps, id: acceptanceFixtureIds.source.yemenTransport, isDemo: false, publishedOn: "2002-03-18", publisher: "Yemen Public Prosecution (Office of the Attorney General) / Republic of Yemen", sourceType: "official-regulation", title: "قانون المرور وتعديلاته — Traffic Law No. 46 of 1991, consolidated through Law No. 12 of 2002", url: "https://www.agoye.gov.ye/page.php?id=275&lng=arabic" },
  { ...antarcticaRecordTimestamps, id: acceptanceFixtureIds.source.antarcticaBoundary, isDemo: false, publishedOn: "1991-10-04", publisher: "Antarctic Treaty Secretariat", sourceType: "official-regulation", title: "Protocol on Environmental Protection to the Antarctic Treaty — environmental governance boundary", url: "https://documents.ats.aq/recatt/Att006_e.pdf" },
  { ...frenchSouthernLandsRecordTimestamps, id: acceptanceFixtureIds.source.frenchSouthernLandsBoundary, isDemo: false, publishedOn: null, publisher: "République française / Légifrance", sourceType: "official-regulation", title: "Code de l'environnement, articles L640-1 à L640-5 — provisions applicable in the French Southern and Antarctic Lands", url: "https://www.legifrance.gouv.fr/codes/id/LEGISCTA000006143761" },
  { ...westernSaharaRecordTimestamps, id: acceptanceFixtureIds.source.westernSaharaBoundary, isDemo: false, publishedOn: "2024-09-09", publisher: "United Nations Department of Political and Peacebuilding Affairs / Decolonization", sourceType: "government-notice", title: "Western Sahara — Non-Self-Governing Territory status and administering-power boundary", url: "https://www.un.org/dppa/decolonization/en/nsgt/western-sahara" },
  { ...falklandIslandsRecordTimestamps, id: acceptanceFixtureIds.source.falklandIslandsBoundary, isDemo: false, publishedOn: "2017-07-31", publisher: "Falkland Islands Government / Falkland Islands Legislation", sourceType: "official-regulation", title: "Road Traffic (Provisional) Regulations Order 1986 — silencers and vehicle inspection", url: "https://www.legislation.gov.fk/download/pdf/4150cf28-4b25-4f23-ae56-456251ea2378/5a0dfa5f-ceaf-4652-9566-c911493a27c1/fisl-1986-5_2017-07-31.pdf" },
  {
    ...recordTimestamps,
    updatedAt: p7VerificationTimestamp,
    verifiedAt: p7VerificationTimestamp,
    id: acceptanceFixtureIds.source.brConama403,
    isDemo: false,
    publishedOn: "2008-11-12",
    publisher: "CONAMA",
    sourceType: "official-regulation",
    title:
      "Resolução CONAMA nº 403, de 11 de novembro de 2008 (DOU 2008-11-12, PROCONVE P-7)",
    url: "http://www2.mma.gov.br/port/conama/legislacao/CONAMA_RES_CONS_2008_403.pdf",
  },
  {
    ...p8RecordTimestamps,
    id: acceptanceFixtureIds.source.brConama490,
    isDemo: false,
    publishedOn: "2018-11-21",
    publisher: "CONAMA / Imprensa Nacional",
    sourceType: "official-regulation",
    title:
      "Resolução CONAMA nº 490, de 16 de novembro de 2018 (DOU 2018-11-21, PROCONVE P8)",
    url: "https://www.in.gov.br/materia/-/asset_publisher/Kujrw0TZC2Mb/content/id/51058898/do1-2018-11-21-resolucao-n-490-de-16-de-novembro-de-2018-51058604",
  },
  {
    ...recordTimestamps,
    id: acceptanceFixtureIds.source.brConama433,
    isDemo: false,
    publishedOn: "2011-07-13",
    publisher: "CONAMA",
    sourceType: "official-regulation",
    title:
      "Resolução CONAMA nº 433, de 13 de julho de 2011 (PROCONVE MAR-I)",
    url: "http://conama.mma.gov.br/?option=com_sisconama&task=arquivo.download&id=635",
  },
];

export const fixtureJurisdictions: (typeof jurisdictions.$inferInsert)[] = [
  {
    ...chinaNonroadRecordTimestamps,
    code: "CN-MEE",
    countryIso3: "CHN",
    dataSourceId: acceptanceFixtureIds.source.cnHj1014,
    id: acceptanceFixtureIds.jurisdiction.cnMee,
    isDemo: false,
    name: "中华人民共和国生态环境部（MEE）",
    type: "country",
    websiteUrl: "https://www.mee.gov.cn/",
  },
  {
    ...unitedStatesRecordTimestamps,
    code: "US-EPA",
    countryIso3: "USA",
    dataSourceId: acceptanceFixtureIds.source.usEcfr1036,
    id: acceptanceFixtureIds.jurisdiction.usEpa,
    isDemo: false,
    name: "U.S. Environmental Protection Agency",
    type: "country",
    websiteUrl: "https://www.epa.gov/",
  },
  {
    ...recordTimestamps,
    code: "EU",
    countryIso3: null,
    dataSourceId: acceptanceFixtureIds.source.euReg595,
    id: acceptanceFixtureIds.jurisdiction.eu,
    isDemo: false,
    name: "European Union",
    type: "regional",
    websiteUrl: "https://eur-lex.europa.eu/",
  },
  {
    ...eaeuRecordTimestamps,
    code: "EAEU",
    countryIso3: null,
    dataSourceId: acceptanceFixtureIds.source.eaeuMemberStates,
    id: acceptanceFixtureIds.jurisdiction.eaeu,
    isDemo: false,
    name: "Eurasian Economic Union",
    type: "regional",
    websiteUrl: "https://eec.eaeunion.org/en/",
  },
  {
    ...recordTimestamps,
    code: "BR-CONAMA",
    countryIso3: "BRA",
    dataSourceId: acceptanceFixtureIds.source.brConama433,
    id: acceptanceFixtureIds.jurisdiction.brConama,
    isDemo: false,
    name: "Conselho Nacional do Meio Ambiente (CONAMA)",
    type: "country",
    websiteUrl: "https://www.gov.br/ibama/pt-br/assuntos/emissoes-e-residuos/emissoes/programa-de-controle-de-emissoes-veiculares-proconve",
  },
  {
    ...japanRecordTimestamps,
    code: "JP-NATIONAL",
    countryIso3: "JPN",
    dataSourceId: acceptanceFixtureIds.source.japanRoadSafety,
    id: acceptanceFixtureIds.jurisdiction.japan,
    isDemo: false,
    name: "日本国（国土交通省・環境省）",
    type: "country",
    websiteUrl: "https://www.env.go.jp/air/car/index.html",
  },
  {
    ...koreaRecordTimestamps,
    code: "KR-ME",
    countryIso3: "KOR",
    dataSourceId: acceptanceFixtureIds.source.koreaRuleAnnex17,
    id: acceptanceFixtureIds.jurisdiction.korea,
    isDemo: false,
    name: "대한민국 기후에너지환경부",
    type: "country",
    websiteUrl: "https://www.me.go.kr/",
  },
  {
    ...mexicoRecordTimestamps,
    code: "MX-SEMARNAT",
    countryIso3: "MEX",
    dataSourceId: acceptanceFixtureIds.source.mexicoNom044,
    id: acceptanceFixtureIds.jurisdiction.mexicoSemarnat,
    isDemo: false,
    name: "Secretaría de Medio Ambiente y Recursos Naturales",
    type: "country",
    websiteUrl: "https://www.gob.mx/semarnat",
  },
  {
    ...turkeyRecordTimestamps,
    code: "TR-MOIT",
    countryIso3: "TUR",
    dataSourceId: acceptanceFixtureIds.source.turkeyRoadRegulation,
    id: acceptanceFixtureIds.jurisdiction.turkey,
    isDemo: false,
    name: "Türkiye Cumhuriyeti Sanayi ve Teknoloji Bakanlığı",
    type: "country",
    websiteUrl: "https://www.sanayi.gov.tr/",
  },
  {
    ...australiaRecordTimestamps,
    code: "AU-DITRDCSA",
    countryIso3: "AUS",
    dataSourceId: acceptanceFixtureIds.source.australiaAdrCurrent,
    id: acceptanceFixtureIds.jurisdiction.australia,
    isDemo: false,
    name: "Australian Government Department of Infrastructure, Transport, Regional Development, Communications, Sport and the Arts",
    type: "country",
    websiteUrl: "https://www.infrastructure.gov.au/",
  },
  {
    ...canadaRecordTimestamps,
    code: "CA-ECCC",
    countryIso3: "CAN",
    dataSourceId: acceptanceFixtureIds.source.canadaRoadRegulation,
    id: acceptanceFixtureIds.jurisdiction.canada,
    isDemo: false,
    name: "Environment and Climate Change Canada",
    type: "country",
    websiteUrl: "https://www.canada.ca/en/environment-climate-change.html",
  },
  {
    ...unitedKingdomRecordTimestamps,
    code: "GB-VCA",
    countryIso3: "GBR",
    dataSourceId: acceptanceFixtureIds.source.unitedKingdomNrmm,
    id: acceptanceFixtureIds.jurisdiction.unitedKingdom,
    isDemo: false,
    name: "UK Vehicle Certification Agency",
    type: "country",
    websiteUrl: "https://www.vehicle-certification-agency.gov.uk/",
  },
  {
    ...indiaRecordTimestamps,
    code: "IN-MORTH",
    countryIso3: "IND",
    dataSourceId: acceptanceFixtureIds.source.indiaBs6,
    id: acceptanceFixtureIds.jurisdiction.india,
    isDemo: false,
    name: "India Ministry of Road Transport and Highways",
    type: "country",
    websiteUrl: "https://morth.nic.in/",
  },
  {
    ...russiaRecordTimestamps,
    code: "RU-EAEU",
    countryIso3: "RUS",
    dataSourceId: acceptanceFixtureIds.source.russiaRoadRegulation,
    id: acceptanceFixtureIds.jurisdiction.russia,
    isDemo: false,
    name: "Russian Federation / Eurasian Economic Union technical regulation",
    type: "country",
    websiteUrl: "https://eec.eaeunion.org/",
  },
  {
    ...indonesiaRecordTimestamps,
    code: "ID-KLHK",
    countryIso3: "IDN",
    dataSourceId: acceptanceFixtureIds.source.indonesiaEuro4,
    id: acceptanceFixtureIds.jurisdiction.indonesia,
    isDemo: false,
    name: "Indonesia Ministry of Environment and Forestry",
    type: "country",
    websiteUrl: "https://www.menlhk.go.id/",
  },
  {
    ...thailandRecordTimestamps,
    code: "TH-TISI",
    countryIso3: "THA",
    dataSourceId: acceptanceFixtureIds.source.thailandMinisterialRegulation,
    id: acceptanceFixtureIds.jurisdiction.thailand,
    isDemo: false,
    name: "Thai Industrial Standards Institute / Ministry of Industry",
    type: "country",
    websiteUrl: "https://www.tisi.go.th/",
  },
  {
    ...vietnamRecordTimestamps,
    code: "VN-MOT",
    countryIso3: "VNM",
    dataSourceId: acceptanceFixtureIds.source.vietnamQcvn109,
    id: acceptanceFixtureIds.jurisdiction.vietnam,
    isDemo: false,
    name: "Viet Nam Ministry of Transport",
    type: "country",
    websiteUrl: "https://mt.gov.vn/",
  },
  {
    ...malaysiaRecordTimestamps,
    code: "MY-DOE",
    countryIso3: "MYS",
    dataSourceId: acceptanceFixtureIds.source.malaysiaDieselRegulation,
    id: acceptanceFixtureIds.jurisdiction.malaysia,
    isDemo: false,
    name: "Malaysia Department of Environment",
    type: "country",
    websiteUrl: "https://www.doe.gov.my/",
  },
  {
    ...saudiArabiaRecordTimestamps,
    code: "SA-SASO",
    countryIso3: "SAU",
    dataSourceId: acceptanceFixtureIds.source.saudiMachinerySafetyPart2,
    id: acceptanceFixtureIds.jurisdiction.saudiArabia,
    isDemo: false,
    name: "Saudi Standards, Metrology and Quality Organization",
    type: "country",
    websiteUrl: "https://www.saso.gov.sa/",
  },
  {
    ...unitedArabEmiratesRecordTimestamps,
    code: "AE-MOIAT",
    countryIso3: "ARE",
    dataSourceId: acceptanceFixtureIds.source.uaeMandatoryStandards2018,
    id: acceptanceFixtureIds.jurisdiction.unitedArabEmirates,
    isDemo: false,
    name: "United Arab Emirates Ministry of Industry and Advanced Technology",
    type: "country",
    websiteUrl: "https://moiat.gov.ae/en",
  },
  {
    ...southAfricaRecordTimestamps,
    code: "ZA-NRCS",
    countryIso3: "ZAF",
    dataSourceId: acceptanceFixtureIds.source.southAfricaMotorVehiclesM23,
    id: acceptanceFixtureIds.jurisdiction.southAfrica,
    isDemo: false,
    name: "South Africa National Regulator for Compulsory Specifications",
    type: "country",
    websiteUrl: "https://www.nrcs.org.za/",
  },
  {
    ...argentinaRecordTimestamps,
    code: "AR-SAyDS",
    countryIso3: "ARG",
    dataSourceId: acceptanceFixtureIds.source.argentinaResolution1464,
    id: acceptanceFixtureIds.jurisdiction.argentina,
    isDemo: false,
    name: "Argentina Secretaría de Ambiente y Desarrollo Sostenible",
    type: "country",
    websiteUrl: "https://www.argentina.gob.ar/ambiente",
  },
  {
    ...newZealandRecordTimestamps,
    code: "NZ-NZTA",
    countryIso3: "NZL",
    dataSourceId: acceptanceFixtureIds.source.newZealandVehicleExhaustRule,
    id: acceptanceFixtureIds.jurisdiction.newZealand,
    isDemo: false,
    name: "NZ Transport Agency Waka Kotahi",
    type: "country",
    websiteUrl:
      "https://www.nzta.govt.nz/resources/rules/vehicle-exhaust-emissions-2007-index.html",
  },
  {
    ...chileRecordTimestamps,
    code: "CL-MMA",
    countryIso3: "CHL",
    dataSourceId: acceptanceFixtureIds.source.chileHeavyVehicleDecree50,
    id: acceptanceFixtureIds.jurisdiction.chile,
    isDemo: false,
    name: "Chile Ministerio del Medio Ambiente",
    type: "country",
    websiteUrl: "https://mma.gob.cl/",
  },
  {
    ...colombiaRecordTimestamps,
    code: "CO-MADS",
    countryIso3: "COL",
    dataSourceId: acceptanceFixtureIds.source.colombiaResolution762,
    id: acceptanceFixtureIds.jurisdiction.colombia,
    isDemo: false,
    name: "Colombia Ministerio de Ambiente y Desarrollo Sostenible",
    type: "country",
    websiteUrl: "https://www.minambiente.gov.co/",
  },
  {
    ...peruRecordTimestamps,
    code: "PE-MINAM",
    countryIso3: "PER",
    dataSourceId: acceptanceFixtureIds.source.peruDecree029,
    id: acceptanceFixtureIds.jurisdiction.peru,
    isDemo: false,
    name: "Peru Ministerio del Ambiente",
    type: "country",
    websiteUrl: "https://www.gob.pe/minam",
  },
  {
    ...philippinesRecordTimestamps,
    code: "PH-DENR",
    countryIso3: "PHL",
    dataSourceId: acceptanceFixtureIds.source.philippinesEuro4LimitsBoI,
    id: acceptanceFixtureIds.jurisdiction.philippines,
    isDemo: false,
    name:
      "Philippines Department of Environment and Natural Resources",
    type: "country",
    websiteUrl: "https://emb.gov.ph/",
  },
  {
    ...singaporeRecordTimestamps,
    code: "SG-NEA",
    countryIso3: "SGP",
    dataSourceId: acceptanceFixtureIds.source.singaporeAirPollutionGuide,
    id: acceptanceFixtureIds.jurisdiction.singapore,
    isDemo: false,
    name: "Singapore National Environment Agency",
    type: "country",
    websiteUrl: "https://www.nea.gov.sg/",
  },
  {
    ...norwayRecordTimestamps,
    code: "NO-NATIONAL",
    countryIso3: "NOR",
    dataSourceId: acceptanceFixtureIds.source.norwayRoadRegulation,
    id: acceptanceFixtureIds.jurisdiction.norway,
    isDemo: false,
    name: "Norway national vehicle and machinery authorities",
    type: "country",
    websiteUrl: "https://www.regjeringen.no/",
  },
  {
    ...icelandRecordTimestamps,
    code: "IS-NATIONAL",
    countryIso3: "ISL",
    dataSourceId: acceptanceFixtureIds.source.icelandRoadRegulation2013,
    id: acceptanceFixtureIds.jurisdiction.iceland,
    isDemo: false,
    name: "Iceland national vehicle and workplace-safety authorities",
    type: "country",
    websiteUrl: "https://www.stjornarradid.is/",
  },
  {
    ...liechtensteinRecordTimestamps,
    code: "LI-NATIONAL",
    countryIso3: "LIE",
    dataSourceId: acceptanceFixtureIds.source.liechtensteinVts,
    id: acceptanceFixtureIds.jurisdiction.liechtenstein,
    isDemo: false,
    name: "Liechtenstein national vehicle and machinery authorities",
    type: "country",
    websiteUrl: "https://www.llv.li/",
  },
  {
    ...switzerlandRecordTimestamps,
    code: "CH-NATIONAL",
    countryIso3: "CHE",
    dataSourceId: acceptanceFixtureIds.source.switzerlandVts,
    id: acceptanceFixtureIds.jurisdiction.switzerland,
    isDemo: false,
    name: "Swiss Federal Roads Office and vehicle authorities",
    type: "country",
    websiteUrl: "https://www.astra.admin.ch/",
  },
  {
    ...serbiaRecordTimestamps,
    code: "RS-NATIONAL",
    countryIso3: "SRB",
    dataSourceId: acceptanceFixtureIds.source.serbiaHomologationRulebook,
    id: acceptanceFixtureIds.jurisdiction.serbia,
    isDemo: false,
    name: "Republic of Serbia vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://www.pravno-informacioni-sistem.rs/",
  },
  {
    ...bosniaRecordTimestamps,
    code: "BA-NATIONAL",
    countryIso3: "BIH",
    dataSourceId: acceptanceFixtureIds.source.bosniaMinimumRequirements,
    id: acceptanceFixtureIds.jurisdiction.bosnia,
    isDemo: false,
    name: "Bosnia and Herzegovina vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://www.mkt.gov.ba/",
  },
  {
    ...northMacedoniaRecordTimestamps,
    code: "MK-NATIONAL",
    countryIso3: "MKD",
    dataSourceId: acceptanceFixtureIds.source.northMacedoniaRoadApproval,
    id: acceptanceFixtureIds.jurisdiction.northMacedonia,
    isDemo: false,
    name: "North Macedonia vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://mtc.gov.mk/",
  },
  {
    ...montenegroRecordTimestamps,
    code: "ME-NATIONAL",
    countryIso3: "MNE",
    dataSourceId: acceptanceFixtureIds.source.montenegroVehicleRequirements,
    id: acceptanceFixtureIds.jurisdiction.montenegro,
    isDemo: false,
    name: "Montenegro vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://www.gov.me/en/mki",
  },
  {
    ...albaniaRecordTimestamps,
    code: "AL-NATIONAL",
    countryIso3: "ALB",
    dataSourceId: acceptanceFixtureIds.source.albaniaGothenburgAccession,
    id: acceptanceFixtureIds.jurisdiction.albania,
    isDemo: false,
    name: "Albania vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://www.infrastruktura.gov.al/",
  },
  {
    ...ukraineRecordTimestamps,
    code: "UA-NATIONAL",
    countryIso3: "UKR",
    dataSourceId: acceptanceFixtureIds.source.ukraineTypeApprovalOrder,
    id: acceptanceFixtureIds.jurisdiction.ukraine,
    isDemo: false,
    name: "Ukraine vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://zakon.rada.gov.ua/",
  },
  {
    ...moldovaRecordTimestamps,
    code: "MD-NATIONAL",
    countryIso3: "MDA",
    dataSourceId: acceptanceFixtureIds.source.moldovaTypeApprovalDraftLaw,
    id: acceptanceFixtureIds.jurisdiction.moldova,
    isDemo: false,
    name: "Moldova vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://midr.gov.md/",
  },
  {
    ...nepalRecordTimestamps,
    code: "NP-NATIONAL",
    countryIso3: "NPL",
    dataSourceId: acceptanceFixtureIds.source.nepalVehicleEmissionGazette,
    id: acceptanceFixtureIds.jurisdiction.nepal,
    isDemo: false,
    name: "Nepal Ministry of Forests and Environment / Department of Environment",
    type: "country",
    websiteUrl: "https://doenv.gov.np/",
  },
  {
    ...armeniaRecordTimestamps,
    code: "AM-NATIONAL",
    countryIso3: "ARM",
    dataSourceId: acceptanceFixtureIds.source.armeniaTrCu018Consolidated,
    id: acceptanceFixtureIds.jurisdiction.armenia,
    isDemo: false,
    name: "Armenia vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://www.env.am/",
  },
  {
    ...azerbaijanRecordTimestamps,
    code: "AZ-NATIONAL",
    countryIso3: "AZE",
    dataSourceId: acceptanceFixtureIds.source.azerbaijanEuro4Decision,
    id: acceptanceFixtureIds.jurisdiction.azerbaijan,
    isDemo: false,
    name: "Azerbaijan vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://eco.gov.az/en",
  },
  {
    ...georgiaRecordTimestamps,
    code: "GE-NATIONAL",
    countryIso3: "GEO",
    dataSourceId: acceptanceFixtureIds.source.georgiaResolution238,
    id: acceptanceFixtureIds.jurisdiction.georgia,
    isDemo: false,
    name: "Georgia vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://mepa.gov.ge/En",
  },
  {
    ...uzbekistanRecordTimestamps,
    code: "UZ-NATIONAL",
    countryIso3: "UZB",
    dataSourceId: acceptanceFixtureIds.source.uzbekistanAgricultureRegulation,
    id: acceptanceFixtureIds.jurisdiction.uzbekistan,
    isDemo: false,
    name: "Uzbekistan vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://lex.uz/uz/docs/7315394",
  },
  {
    ...kazakhstanRecordTimestamps,
    code: "KZ-NATIONAL",
    countryIso3: "KAZ",
    dataSourceId: acceptanceFixtureIds.source.kazakhstanRoadRegulation,
    id: acceptanceFixtureIds.jurisdiction.kazakhstan,
    isDemo: false,
    name: "Kazakhstan vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://adilet.zan.kz/rus/docs/H11T0000877",
  },
  {
    ...tajikistanRecordTimestamps,
    code: "TJ-NATIONAL",
    countryIso3: "TJK",
    dataSourceId: acceptanceFixtureIds.source.tajikistanRoadEnvironmentalLaw,
    id: acceptanceFixtureIds.jurisdiction.tajikistan,
    isDemo: false,
    name: "Tajikistan vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://ncz.tj/system/files/Legislation/1214_ru.pdf",
  },
  {
    ...kyrgyzstanRecordTimestamps,
    code: "KG-NATIONAL",
    countryIso3: "KGZ",
    dataSourceId: acceptanceFixtureIds.source.kyrgyzstanRoadImplementation,
    id: acceptanceFixtureIds.jurisdiction.kyrgyzstan,
    isDemo: false,
    name: "Kyrgyzstan vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://www.mineconom.gov.kg/ru/post/4112",
  },
  {
    ...turkmenistanRecordTimestamps,
    code: "TM-NATIONAL",
    countryIso3: "TKM",
    dataSourceId: acceptanceFixtureIds.source.turkmenistanAirProtectionLaw,
    id: acceptanceFixtureIds.jurisdiction.turkmenistan,
    isDemo: false,
    name: "Turkmenistan vehicle and environmental authorities",
    type: "country",
    websiteUrl:
      "https://minjust.gov.tm/assets/files/law_documents/hukuknama_406_ru.pdf",
  },
  {
    ...afghanistanRecordTimestamps,
    code: "AF-NATIONAL",
    countryIso3: "AFG",
    dataSourceId: acceptanceFixtureIds.source.afghanistanAirPollutionRegulation,
    id: acceptanceFixtureIds.jurisdiction.afghanistan,
    isDemo: false,
    name: "Afghanistan vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://www.nepa.gov.af/showDariPage/25",
  },
  {
    ...angolaRecordTimestamps,
    code: "AO-NATIONAL",
    countryIso3: "AGO",
    dataSourceId: acceptanceFixtureIds.source.angolaVehicleInspectionRegulation,
    id: acceptanceFixtureIds.jurisdiction.angola,
    isDemo: false,
    name: "Angola vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://lex.ao/",
  },
  {
    ...burundiRecordTimestamps,
    code: "BI-NATIONAL",
    countryIso3: "BDI",
    dataSourceId: acceptanceFixtureIds.source.burundiRoadTrafficCode2012,
    id: acceptanceFixtureIds.jurisdiction.burundi,
    isDemo: false,
    name: "Burundi vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://amategeko.gov.bi/",
  },
  {
    ...beninRecordTimestamps,
    code: "BJ-NATIONAL",
    countryIso3: "BEN",
    dataSourceId: acceptanceFixtureIds.source.beninAirQualityDecree2001,
    id: acceptanceFixtureIds.jurisdiction.benin,
    isDemo: false,
    name: "Benin vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://sgg.gouv.bj/documentheque/763/",
  },
  {
    ...burkinaFasoRecordTimestamps,
    code: "BF-NATIONAL",
    countryIso3: "BFA",
    dataSourceId: acceptanceFixtureIds.source.burkinaFasoAirQualityDecree2001,
    id: acceptanceFixtureIds.jurisdiction.burkinaFaso,
    isDemo: false,
    name: "Burkina Faso vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://www.environnement.gov.bf/",
  },
  {
    ...bangladeshRecordTimestamps,
    code: "BD-NATIONAL",
    countryIso3: "BGD",
    dataSourceId: acceptanceFixtureIds.source.bangladeshAirPollutionRules2022,
    id: acceptanceFixtureIds.jurisdiction.bangladesh,
    isDemo: false,
    name: "Bangladesh vehicle and environmental authorities",
    type: "country",
    websiteUrl:
      "https://www.dpp.gov.bd/bgpress/index.php/document/get_extraordinary/45501",
  },
  {
    ...bahamasRecordTimestamps,
    code: "BS-NATIONAL",
    countryIso3: "BHS",
    dataSourceId: acceptanceFixtureIds.source.bahamasRoadTrafficAct,
    id: acceptanceFixtureIds.jurisdiction.bahamas,
    isDemo: false,
    name: "Bahamas vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://laws.bahamas.gov.bs/",
  },
  {
    ...belarusRecordTimestamps,
    code: "BY-NATIONAL",
    countryIso3: "BLR",
    dataSourceId: acceptanceFixtureIds.source.belarusTrCu018,
    id: acceptanceFixtureIds.jurisdiction.belarus,
    isDemo: false,
    name: "Belarus vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://mintrans.gov.by/",
  },
  {
    ...boliviaRecordTimestamps,
    code: "BO-NATIONAL",
    countryIso3: "BOL",
    dataSourceId: acceptanceFixtureIds.source.boliviaRm064Regulation,
    id: acceptanceFixtureIds.jurisdiction.bolivia,
    isDemo: false,
    name: "Bolivia vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://ibmetro.gob.bo/certificado-de-aceptacion",
  },
  {
    ...moroccoRecordTimestamps,
    code: "MA-NATIONAL",
    countryIso3: "MAR",
    dataSourceId: acceptanceFixtureIds.source.moroccoEuro6Order2094,
    id: acceptanceFixtureIds.jurisdiction.morocco,
    isDemo: false,
    name: "Morocco vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://www.sgg.gov.ma/Accueil.aspx",
  },
  {
    ...kenyaRecordTimestamps,
    code: "KE-NATIONAL",
    countryIso3: "KEN",
    dataSourceId: acceptanceFixtureIds.source.kenyaAirQualityRegulations2024,
    id: acceptanceFixtureIds.jurisdiction.kenya,
    isDemo: false,
    name: "Kenya vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://new.kenyalaw.org/",
  },
  {
    ...nigeriaRecordTimestamps,
    code: "NG-NATIONAL",
    countryIso3: "NGA",
    dataSourceId: acceptanceFixtureIds.source.nigeriaVehicularEmissions2011,
    id: acceptanceFixtureIds.jurisdiction.nigeria,
    isDemo: false,
    name: "Nigeria vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://nesrea.gov.ng/",
  },
  {
    ...egyptRecordTimestamps,
    code: "EG-NATIONAL",
    countryIso3: "EGY",
    dataSourceId: acceptanceFixtureIds.source.egyptExecRegulation338,
    id: acceptanceFixtureIds.jurisdiction.egypt,
    isDemo: false,
    name: "Egypt vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://www.eeaa.gov.eg/",
  },
  {
    ...ghanaRecordTimestamps,
    code: "GH-NATIONAL",
    countryIso3: "GHA",
    dataSourceId:
      acceptanceFixtureIds.source.ghanaEnvironmentalProtectionAct2025,
    id: acceptanceFixtureIds.jurisdiction.ghana,
    isDemo: false,
    name: "Ghana vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://www.epa.gov.gh/new/",
  },
  {
    ...israelRecordTimestamps,
    code: "IL-NATIONAL",
    countryIso3: "ISR",
    dataSourceId: acceptanceFixtureIds.source.israelRoadImr2026,
    id: acceptanceFixtureIds.jurisdiction.israel,
    isDemo: false,
    name: "Israel vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://www.gov.il/he/departments/ministry_of_environmental_protection",
  },
  {
    ...pakistanRecordTimestamps,
    code: "PK-NATIONAL",
    countryIso3: "PAK",
    dataSourceId: acceptanceFixtureIds.source.pakistanSro72OfficialIndex,
    id: acceptanceFixtureIds.jurisdiction.pakistan,
    isDemo: false,
    name: "Pakistan vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://environment.gov.pk/",
  },
  {
    ...qatarRecordTimestamps,
    code: "QA-NATIONAL",
    countryIso3: "QAT",
    dataSourceId: acceptanceFixtureIds.source.qatarEuro5Policy2023,
    id: acceptanceFixtureIds.jurisdiction.qatar,
    isDemo: false,
    name: "Qatar vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://www.mot.gov.qa/",
  },
  {
    ...kuwaitRecordTimestamps,
    code: "KW-NATIONAL",
    countryIso3: "KWT",
    dataSourceId: acceptanceFixtureIds.source.kuwaitGulfStandardsDecision372,
    id: acceptanceFixtureIds.jurisdiction.kuwait,
    isDemo: false,
    name: "Kuwait vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://epa.gov.kw/",
  },
  {
    ...omanRecordTimestamps,
    code: "OM-NATIONAL",
    countryIso3: "OMN",
    dataSourceId:
      acceptanceFixtureIds.source.omanBindingVehicleStandardsDecision120,
    id: acceptanceFixtureIds.jurisdiction.oman,
    isDemo: false,
    name: "Oman vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://www.ea.gov.om/",
  },
  {
    ...jordanRecordTimestamps,
    code: "JO-NATIONAL",
    countryIso3: "JOR",
    dataSourceId: acceptanceFixtureIds.source.jordanTransportGreenGrowthPlan,
    id: acceptanceFixtureIds.jurisdiction.jordan,
    isDemo: false,
    name: "Jordan vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://moenv.gov.jo/",
  },
  {
    ...cambodiaRecordTimestamps,
    code: "KH-NATIONAL",
    countryIso3: "KHM",
    dataSourceId: acceptanceFixtureIds.source.cambodiaEnvironment,
    id: acceptanceFixtureIds.jurisdiction.cambodia,
    isDemo: false,
    name: "Cambodia vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://www.moe.gov.kh/",
  },
  {
    ...laosRecordTimestamps,
    code: "LA-NATIONAL",
    countryIso3: "LAO",
    dataSourceId: acceptanceFixtureIds.source.laosEnvironment,
    id: acceptanceFixtureIds.jurisdiction.laos,
    isDemo: false,
    name: "Lao vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://monre.gov.la/",
  },
  {
    ...sriLankaRecordTimestamps,
    code: "LK-NATIONAL",
    countryIso3: "LKA",
    dataSourceId: acceptanceFixtureIds.source.sriLankaEnvironment,
    id: acceptanceFixtureIds.jurisdiction.sriLanka,
    isDemo: false,
    name: "Sri Lanka vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://www.env.gov.lk/",
  },
  {
    ...mongoliaRecordTimestamps,
    code: "MN-NATIONAL",
    countryIso3: "MNG",
    dataSourceId: acceptanceFixtureIds.source.mongoliaEnvironment,
    id: acceptanceFixtureIds.jurisdiction.mongolia,
    isDemo: false,
    name: "Mongolia vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://mecc.gov.mn/",
  },
  {
    ...costaRicaRecordTimestamps,
    code: "CR-NATIONAL",
    countryIso3: "CRI",
    dataSourceId: acceptanceFixtureIds.source.costaRicaEnvironment,
    id: acceptanceFixtureIds.jurisdiction.costaRica,
    isDemo: false,
    name: "Costa Rica vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://www.minae.go.cr/",
  },
  {
    ...ecuadorRecordTimestamps,
    code: "EC-NATIONAL",
    countryIso3: "ECU",
    dataSourceId: acceptanceFixtureIds.source.ecuadorRte017Amendment2025,
    id: acceptanceFixtureIds.jurisdiction.ecuador,
    isDemo: false,
    name: "Ecuador vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://www.ambiente.gob.ec/",
  },
  {
    ...dominicanRepublicRecordTimestamps,
    code: "DO-NATIONAL",
    countryIso3: "DOM",
    dataSourceId: acceptanceFixtureIds.source.dominicanRepublicEnvironment,
    id: acceptanceFixtureIds.jurisdiction.dominicanRepublic,
    isDemo: false,
    name: "Dominican Republic vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://ambiente.gob.do/",
  },
  {
    ...algeriaRecordTimestamps,
    code: "DZ-NATIONAL",
    countryIso3: "DZA",
    dataSourceId: acceptanceFixtureIds.source.algeriaEnvironment,
    id: acceptanceFixtureIds.jurisdiction.algeria,
    isDemo: false,
    name: "Algeria vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://www.me.gov.dz/",
  },
  {
    ...tunisiaRecordTimestamps,
    code: "TN-NATIONAL",
    countryIso3: "TUN",
    dataSourceId: acceptanceFixtureIds.source.tunisiaEnvironment,
    id: acceptanceFixtureIds.jurisdiction.tunisia,
    isDemo: false,
    name: "Tunisia vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://www.environnement.gov.tn/",
  },
  {
    ...ethiopiaRecordTimestamps,
    code: "ET-NATIONAL",
    countryIso3: "ETH",
    dataSourceId: acceptanceFixtureIds.source.ethiopiaEnvironment,
    id: acceptanceFixtureIds.jurisdiction.ethiopia,
    isDemo: false,
    name: "Ethiopia vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://www.epa.gov.et/",
  },
  {
    ...guatemalaRecordTimestamps,
    code: "GT-NATIONAL",
    countryIso3: "GTM",
    dataSourceId: acceptanceFixtureIds.source.guatemalaEnvironment,
    id: acceptanceFixtureIds.jurisdiction.guatemala,
    isDemo: false,
    name: "Guatemala vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://www.marn.gob.gt/",
  },
  {
    ...hondurasRecordTimestamps,
    code: "HN-NATIONAL",
    countryIso3: "HND",
    dataSourceId: acceptanceFixtureIds.source.hondurasEnvironment,
    id: acceptanceFixtureIds.jurisdiction.honduras,
    isDemo: false,
    name: "Honduras vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://miambiente.gob.hn/",
  },
  {
    ...panamaRecordTimestamps,
    code: "PA-NATIONAL",
    countryIso3: "PAN",
    dataSourceId: acceptanceFixtureIds.source.panamaEnvironment,
    id: acceptanceFixtureIds.jurisdiction.panama,
    isDemo: false,
    name: "Panama vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://miambiente.gob.pa/",
  },
  {
    ...uruguayRecordTimestamps,
    code: "UY-NATIONAL",
    countryIso3: "URY",
    dataSourceId: acceptanceFixtureIds.source.uruguayEnvironment,
    id: acceptanceFixtureIds.jurisdiction.uruguay,
    isDemo: false,
    name: "Uruguay vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://www.gub.uy/ministerio-ambiente/",
  },
  {
    ...botswanaRecordTimestamps,
    code: "BW-NATIONAL",
    countryIso3: "BWA",
    dataSourceId: acceptanceFixtureIds.source.botswanaGovernment,
    id: acceptanceFixtureIds.jurisdiction.botswana,
    isDemo: false,
    name: "Botswana vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://www.gov.bw/",
  },
  {
    ...namibiaRecordTimestamps,
    code: "NA-NATIONAL",
    countryIso3: "NAM",
    dataSourceId: acceptanceFixtureIds.source.namibiaEnvironment,
    id: acceptanceFixtureIds.jurisdiction.namibia,
    isDemo: false,
    name: "Namibia vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://mwt.gov.na/",
  },
  {
    ...tanzaniaRecordTimestamps,
    code: "TZ-NATIONAL",
    countryIso3: "TZA",
    dataSourceId: acceptanceFixtureIds.source.tanzaniaEnvironment,
    id: acceptanceFixtureIds.jurisdiction.tanzania,
    isDemo: false,
    name: "Tanzania vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://www.nemc.or.tz/",
  },
  {
    ...ugandaRecordTimestamps,
    code: "UG-NATIONAL",
    countryIso3: "UGA",
    dataSourceId: acceptanceFixtureIds.source.ugandaEnvironment,
    id: acceptanceFixtureIds.jurisdiction.uganda,
    isDemo: false,
    name: "Uganda vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://www.nema.go.ug/",
  },
  {
    ...zambiaRecordTimestamps,
    code: "ZM-NATIONAL",
    countryIso3: "ZMB",
    dataSourceId: acceptanceFixtureIds.source.zambiaEnvironment,
    id: acceptanceFixtureIds.jurisdiction.zambia,
    isDemo: false,
    name: "Zambia vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://www.zema.org.zm/",
  },
  {
    ...zimbabweRecordTimestamps,
    code: "ZW-NATIONAL",
    countryIso3: "ZWE",
    dataSourceId: acceptanceFixtureIds.source.zimbabweEnvironment,
    id: acceptanceFixtureIds.jurisdiction.zimbabwe,
    isDemo: false,
    name: "Zimbabwe vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://ema.co.zw/",
  },
  {
    ...rwandaRecordTimestamps,
    code: "RW-NATIONAL",
    countryIso3: "RWA",
    dataSourceId: acceptanceFixtureIds.source.rwandaEnvironment,
    id: acceptanceFixtureIds.jurisdiction.rwanda,
    isDemo: false,
    name: "Rwanda vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://www.rema.gov.rw/",
  },
  {
    ...coteDIvoireRecordTimestamps,
    code: "CI-NATIONAL",
    countryIso3: "CIV",
    dataSourceId: acceptanceFixtureIds.source.coteDIvoireEnvironment,
    id: acceptanceFixtureIds.jurisdiction.coteDIvoire,
    isDemo: false,
    name: "Côte d’Ivoire vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://environnement.gouv.ci/",
  },
  {
    ...cameroonRecordTimestamps,
    code: "CM-NATIONAL",
    countryIso3: "CMR",
    dataSourceId: acceptanceFixtureIds.source.cameroonEnvironment,
    id: acceptanceFixtureIds.jurisdiction.cameroon,
    isDemo: false,
    name: "Cameroon vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://minepded.gov.cm/",
  },
  {
    ...senegalRecordTimestamps,
    code: "SN-NATIONAL",
    countryIso3: "SEN",
    dataSourceId: acceptanceFixtureIds.source.senegalEnvironment,
    id: acceptanceFixtureIds.jurisdiction.senegal,
    isDemo: false,
    name: "Senegal vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://www.environnement.gouv.sn/",
  },
  {
    ...mozambiqueRecordTimestamps,
    code: "MZ-NATIONAL",
    countryIso3: "MOZ",
    dataSourceId: acceptanceFixtureIds.source.mozambiqueEnvironment,
    id: acceptanceFixtureIds.jurisdiction.mozambique,
    isDemo: false,
    name: "Mozambique vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://www.mef.gov.mz/",
  },
  {
    ...eswatiniRecordTimestamps,
    code: "SZ-NATIONAL",
    countryIso3: "SWZ",
    dataSourceId: acceptanceFixtureIds.source.eswatiniGovernment,
    id: acceptanceFixtureIds.jurisdiction.eswatini,
    isDemo: false,
    name: "Eswatini vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://www.gov.sz/",
  },
  {
    ...lesothoRecordTimestamps,
    code: "LS-NATIONAL",
    countryIso3: "LSO",
    dataSourceId: acceptanceFixtureIds.source.lesothoGovernment,
    id: acceptanceFixtureIds.jurisdiction.lesotho,
    isDemo: false,
    name: "Lesotho vehicle and environmental authorities",
    type: "country",
    websiteUrl: "https://www.gov.ls/",
  },
  { ...madagascarRecordTimestamps, code: "MG-NATIONAL", countryIso3: "MDG", dataSourceId: acceptanceFixtureIds.source.madagascarEnvironment, id: acceptanceFixtureIds.jurisdiction.madagascar, isDemo: false, name: "Madagascar vehicle and environmental authorities", type: "country", websiteUrl: "https://www.environnement.mg/" },
  { ...mauritiusRecordTimestamps, code: "MU-NATIONAL", countryIso3: "MUS", dataSourceId: acceptanceFixtureIds.source.mauritiusEnvironment, id: acceptanceFixtureIds.jurisdiction.mauritius, isDemo: false, name: "Mauritius vehicle and environmental authorities", type: "country", websiteUrl: "https://environment.govmu.org/" },
  { ...malawiRecordTimestamps, code: "MW-NATIONAL", countryIso3: "MWI", dataSourceId: acceptanceFixtureIds.source.malawiGovernment, id: acceptanceFixtureIds.jurisdiction.malawi, isDemo: false, name: "Malawi vehicle and environmental authorities", type: "country", websiteUrl: "https://www.malawi.gov.mw/" },
  { ...fijiRecordTimestamps, code: "FJ-NATIONAL", countryIso3: "FJI", dataSourceId: acceptanceFixtureIds.source.fijiEnvironment, id: acceptanceFixtureIds.jurisdiction.fiji, isDemo: false, name: "Fiji vehicle and environmental authorities", type: "country", websiteUrl: "https://www.environment.gov.fj/" },
  { ...belizeRecordTimestamps, code: "BZ-NATIONAL", countryIso3: "BLZ", dataSourceId: acceptanceFixtureIds.source.belizeEnvironment, id: acceptanceFixtureIds.jurisdiction.belize, isDemo: false, name: "Belize vehicle and environmental authorities", type: "country", websiteUrl: "https://doe.gov.bz/" },
  { ...bruneiRecordTimestamps, code: "BN-NATIONAL", countryIso3: "BRN", dataSourceId: acceptanceFixtureIds.source.bruneiEnvironment, id: acceptanceFixtureIds.jurisdiction.brunei, isDemo: false, name: "Brunei vehicle and environmental authorities", type: "country", websiteUrl: "https://www.env.gov.bn/" },
  { ...bhutanRecordTimestamps, code: "BT-NATIONAL", countryIso3: "BTN", dataSourceId: acceptanceFixtureIds.source.bhutanEnvironment, id: acceptanceFixtureIds.jurisdiction.bhutan, isDemo: false, name: "Bhutan vehicle and environmental authorities", type: "country", websiteUrl: "https://www.nec.gov.bt/" },
  { ...centralAfricanRepublicRecordTimestamps, code: "CF-NATIONAL", countryIso3: "CAF", dataSourceId: acceptanceFixtureIds.source.centralAfricanRepublicEnvironment, id: acceptanceFixtureIds.jurisdiction.centralAfricanRepublic, isDemo: false, name: "Central African Republic vehicle and environmental authorities", type: "country", websiteUrl: "https://faolex.fao.org/docs/pdf/caf105925.pdf" },
  { ...democraticRepublicOfCongoRecordTimestamps, code: "CD-NATIONAL", countryIso3: "COD", dataSourceId: acceptanceFixtureIds.source.democraticRepublicOfCongoEnvironment, id: acceptanceFixtureIds.jurisdiction.democraticRepublicOfCongo, isDemo: false, name: "DR Congo vehicle and environmental authorities", type: "country", websiteUrl: "https://medd.gouv.cd/" },
  { ...republicOfCongoRecordTimestamps, code: "CG-NATIONAL", countryIso3: "COG", dataSourceId: acceptanceFixtureIds.source.republicOfCongoEnvironment, id: acceptanceFixtureIds.jurisdiction.republicOfCongo, isDemo: false, name: "Republic of the Congo vehicle and environmental authorities", type: "country", websiteUrl: "https://www.developpement-durable.gouv.cg/" },
  { ...cubaRecordTimestamps, code: "CU-NATIONAL", countryIso3: "CUB", dataSourceId: acceptanceFixtureIds.source.cubaEnvironment, id: acceptanceFixtureIds.jurisdiction.cuba, isDemo: false, name: "Cuba vehicle and environmental authorities", type: "country", websiteUrl: "https://www.medioambiente.gob.cu/" },
  { ...djiboutiRecordTimestamps, code: "DJ-NATIONAL", countryIso3: "DJI", dataSourceId: acceptanceFixtureIds.source.djiboutiEnvironment, id: acceptanceFixtureIds.jurisdiction.djibouti, isDemo: false, name: "Djibouti vehicle and environmental authorities", type: "country", websiteUrl: "https://www.journalofficiel.dj/" },
  { ...eritreaRecordTimestamps, code: "ER-NATIONAL", countryIso3: "ERI", dataSourceId: acceptanceFixtureIds.source.eritreaEnvironmentalProtectionManagementRegulations127_2017, id: acceptanceFixtureIds.jurisdiction.eritrea, isDemo: false, name: "Eritrea vehicle and environmental authorities", type: "country", websiteUrl: "https://shabait.com/" },
  { ...gabonRecordTimestamps, code: "GA-NATIONAL", countryIso3: "GAB", dataSourceId: acceptanceFixtureIds.source.gabonEnvironmentalProtectionLaw007_2014, id: acceptanceFixtureIds.jurisdiction.gabon, isDemo: false, name: "Gabon vehicle and environmental authorities", type: "country", websiteUrl: "https://journal-officiel.ga/" },
  { ...guineaRecordTimestamps, code: "GN-NATIONAL", countryIso3: "GIN", dataSourceId: acceptanceFixtureIds.source.guineaEnvironment, id: acceptanceFixtureIds.jurisdiction.guinea, isDemo: false, name: "Guinea vehicle and environmental authorities", type: "country", websiteUrl: "https://medd.gov.gn/" },
  { ...gambiaRecordTimestamps, code: "GM-NATIONAL", countryIso3: "GMB", dataSourceId: acceptanceFixtureIds.source.gambiaEnvironmentalQualityStandardsRegulations1999, id: acceptanceFixtureIds.jurisdiction.gambia, isDemo: false, name: "Gambia vehicle and environmental authorities", type: "country", websiteUrl: "https://nea.gm/" },
  { ...guineaBissauRecordTimestamps, code: "GW-NATIONAL", countryIso3: "GNB", dataSourceId: acceptanceFixtureIds.source.guineaBissauBasicEnvironmentLaw1_2011, id: acceptanceFixtureIds.jurisdiction.guineaBissau, isDemo: false, name: "Guinea-Bissau vehicle and environmental authorities", type: "country", websiteUrl: "https://bissaugov.com/" },
  { ...equatorialGuineaRecordTimestamps, code: "GQ-NATIONAL", countryIso3: "GNQ", dataSourceId: acceptanceFixtureIds.source.equatorialGuineaEnvironmentalLaw7_2003, id: acceptanceFixtureIds.jurisdiction.equatorialGuinea, isDemo: false, name: "Equatorial Guinea vehicle and environmental authorities", type: "country", websiteUrl: "https://www.guineaecuatorialpress.com/" },
  { ...greenlandRecordTimestamps, code: "GL-NATIONAL", countryIso3: "GRL", dataSourceId: acceptanceFixtureIds.source.greenlandEnvironment, id: acceptanceFixtureIds.jurisdiction.greenland, isDemo: false, name: "Greenland vehicle and environmental authorities", type: "country", websiteUrl: "https://nalunaarutit.gl/" },
  { ...guyanaRecordTimestamps, code: "GY-NATIONAL", countryIso3: "GUY", dataSourceId: acceptanceFixtureIds.source.guyanaEnvironment, id: acceptanceFixtureIds.jurisdiction.guyana, isDemo: false, name: "Guyana vehicle and environmental authorities", type: "country", websiteUrl: "https://mola.gov.gy/laws-of-guyana" },
  { ...haitiRecordTimestamps, code: "HT-NATIONAL", countryIso3: "HTI", dataSourceId: acceptanceFixtureIds.source.haitiEnvironment, id: acceptanceFixtureIds.jurisdiction.haiti, isDemo: false, name: "Haiti vehicle and environmental authorities", type: "country", websiteUrl: "https://mde.gouv.ht/" },
  { ...iranRecordTimestamps, code: "IR-NATIONAL", countryIso3: "IRN", dataSourceId: acceptanceFixtureIds.source.iranTechnicalPollutionRegulation, id: acceptanceFixtureIds.jurisdiction.iran, isDemo: false, name: "Iran vehicle and environmental authorities", type: "country", websiteUrl: "https://nezamat.ir/post-41054/" },
  { ...iraqRecordTimestamps, code: "IQ-NATIONAL", countryIso3: "IRQ", dataSourceId: acceptanceFixtureIds.source.iraqTr167AmendmentDecision2024, id: acceptanceFixtureIds.jurisdiction.iraq, isDemo: false, name: "Iraq vehicle and environmental authorities", type: "country", websiteUrl: "https://www.iraqi-standards.org/wan/ns/p/0000018.html" },
  { ...jamaicaRecordTimestamps, code: "JM-NATIONAL", countryIso3: "JAM", dataSourceId: acceptanceFixtureIds.source.jamaicaEnvironment, id: acceptanceFixtureIds.jurisdiction.jamaica, isDemo: false, name: "Jamaica vehicle and environmental authorities", type: "country", websiteUrl: "https://mtm.gov.jm/forms/" },
  { ...lebanonRecordTimestamps, code: "LB-NATIONAL", countryIso3: "LBN", dataSourceId: acceptanceFixtureIds.source.lebanonEnvironmentalProtectionLaw444, id: acceptanceFixtureIds.jurisdiction.lebanon, isDemo: false, name: "Lebanon vehicle and environmental authorities", type: "country", websiteUrl: "https://moe.gov.lb/%D8%A7%D9%84%D9%88%D8%B2%D8%A7%D8%B1%D8%A9/%D8%A7%D9%84%D9%82%D9%88%D8%A7%D9%86%D9%8A%D9%86-%D9%88%D8%A7%D9%84%D8%A7%D9%86%D8%B8%D9%85%D8%A9/%D8%A7%D9%84%D9%82%D9%88%D8%A7%D9%86%D9%8A%D9%86/%D9%82%D8%A7%D9%86%D9%88%D9%86-%D8%B1%D9%82%D9%85-444-%D8%AD%D9%85%D8%A7%D9%8A%D8%A9-%D8%A7%D9%84%D8%A8%D9%8A%D8%A6%D8%A9.aspx?lang=ar-LB" },
  { ...liberiaRecordTimestamps, code: "LR-NATIONAL", countryIso3: "LBR", dataSourceId: acceptanceFixtureIds.source.liberiaEnvironmentalProtectionManagementLaw, id: acceptanceFixtureIds.jurisdiction.liberia, isDemo: false, name: "Liberia vehicle and environmental authorities", type: "country", websiteUrl: "https://epa.gov.lr/epa-documents/the-environmental-protection-and-management-law-of-liberia/" },
  { ...libyaRecordTimestamps, code: "LY-NATIONAL", countryIso3: "LBY", dataSourceId: acceptanceFixtureIds.source.libyaEnvironmentalProtectionLaw15, id: acceptanceFixtureIds.jurisdiction.libya, isDemo: false, name: "Libya vehicle and environmental authorities", type: "country", websiteUrl: "https://environment.gov.ly/law-no-15/" },
  { ...maliRecordTimestamps, code: "ML-NATIONAL", countryIso3: "MLI", dataSourceId: acceptanceFixtureIds.source.maliTechnicalInspectionOrder2020, id: acceptanceFixtureIds.jurisdiction.mali, isDemo: false, name: "Mali vehicle and environmental authorities", type: "country", websiteUrl: "https://sgg-mali.ml/JO/2020/mali-jo-2020-08.pdf" },
  { ...myanmarRecordTimestamps, code: "MM-NATIONAL", countryIso3: "MMR", dataSourceId: acceptanceFixtureIds.source.myanmarEnvironment, id: acceptanceFixtureIds.jurisdiction.myanmar, isDemo: false, name: "Myanmar vehicle and environmental authorities", type: "country", websiteUrl: "https://www.ecd.gov.mm/national-environmental-quality-emission-guidelines-final/" },
  { ...mauritaniaRecordTimestamps, code: "MR-NATIONAL", countryIso3: "MRT", dataSourceId: acceptanceFixtureIds.source.mauritaniaAirPollutionLaw2018, id: acceptanceFixtureIds.jurisdiction.mauritania, isDemo: false, name: "Mauritania vehicle and environmental authorities", type: "country", websiteUrl: "http://www.environnement.gov.mr/fr/images/reglementations/Loi_pollution_Air_FR.pdf" },
  { ...newCaledoniaRecordTimestamps, code: "NC-NATIONAL", countryIso3: "NCL", dataSourceId: acceptanceFixtureIds.source.newCaledoniaEnvironment, id: acceptanceFixtureIds.jurisdiction.newCaledonia, isDemo: false, name: "New Caledonia vehicle and environmental authorities", type: "country", websiteUrl: "https://juridoc.gouv.nc/juridoc/jdcodes.nsf/0/59295762BD9870FE4B258184001CDC1D/%24File/Code_route_NC_9-10-11-06-1965_ChG_07-10-2025.pdf?OpenElement=" },
  { ...nigerRecordTimestamps, code: "NE-NATIONAL", countryIso3: "NER", dataSourceId: acceptanceFixtureIds.source.nigerEnvironmentalFrameworkLaw9856, id: acceptanceFixtureIds.jurisdiction.niger, isDemo: false, name: "Niger vehicle and environmental authorities", type: "country", websiteUrl: "https://hydraulique.gouv.ne/wp-content/uploads/2025/07/LoiN%C2%B098-056gestiondelEnvironnement.pdf" },
  { ...nicaraguaRecordTimestamps, code: "NI-NATIONAL", countryIso3: "NIC", dataSourceId: acceptanceFixtureIds.source.nicaraguaEnvironment, id: acceptanceFixtureIds.jurisdiction.nicaragua, isDemo: false, name: "Nicaragua vehicle and environmental authorities", type: "country", websiteUrl: "https://legislacion.asamblea.gob.ni/Normaweb.nsf/xpNormaJuridica.xsp?action=openDocument&documentId=0404E60D225D0ACF062588E2006EE9F8" },
  { ...papuaNewGuineaRecordTimestamps, code: "PG-NATIONAL", countryIso3: "PNG", dataSourceId: acceptanceFixtureIds.source.papuaNewGuineaEnvironment, id: acceptanceFixtureIds.jurisdiction.papuaNewGuinea, isDemo: false, name: "Papua New Guinea Road Traffic Authority", type: "country", websiteUrl: "https://rta.gov.pg/pdfs/resources/legislation/rules/RTR_VehicleStandardsAndCompliance2018.pdf" },
  { ...puertoRicoRecordTimestamps, code: "PR-NATIONAL", countryIso3: "PRI", dataSourceId: acceptanceFixtureIds.source.puertoRicoEnvironment, id: acceptanceFixtureIds.jurisdiction.puertoRico, isDemo: false, name: "Puerto Rico vehicle and environmental authorities", type: "country", websiteUrl: "https://www.drna.pr.gov/wp-content/uploads/2019/10/Reglamento-5300-Reglamento-Control-Contaminacion-Atmosferica-1995.pdf" },
  { ...northKoreaRecordTimestamps, code: "KP-NATIONAL", countryIso3: "PRK", dataSourceId: acceptanceFixtureIds.source.northKoreaEnvironment, id: acceptanceFixtureIds.jurisdiction.northKorea, isDemo: false, name: "DPR Korea environmental and vehicle authorities", type: "country", websiteUrl: "https://www.fao.org/faolex/country-profiles/general-profile/en/?iso3=PRK" },
  { ...paraguayRecordTimestamps, code: "PY-NATIONAL", countryIso3: "PRY", dataSourceId: acceptanceFixtureIds.source.paraguayEnvironment, id: acceptanceFixtureIds.jurisdiction.paraguay, isDemo: false, name: "Paraguay Ministry of Environment and Sustainable Development (MADES)", type: "country", websiteUrl: "https://www.mades.gov.py/normativa-direccion-de-normalizacion-del-aire/" },
  { ...palestineRecordTimestamps, code: "PS-NATIONAL", countryIso3: "PSE", dataSourceId: acceptanceFixtureIds.source.palestineEnvironment, id: acceptanceFixtureIds.jurisdiction.palestine, isDemo: false, name: "Palestine Environment Quality Authority and vehicle licensing authorities", type: "country", websiteUrl: "https://mjr.ogb.gov.ps/MergedLegislations/ViewText/66/%D9%82%D8%A7%D9%86%D9%88%D9%86-%D8%B1%D9%82%D9%85-7-%D9%84%D8%B3%D9%86%D8%A9-1999%D9%85-%D8%A8%D8%B4%D8%A3%D9%86-%D8%A7%D9%84%D8%A8%D9%8A%D8%A6%D8%A9-%D9%81%D9%84%D8%B3%D8%B7%D9%8A%D9%86" },
  { ...sudanRecordTimestamps, code: "SD-NATIONAL", countryIso3: "SDN", dataSourceId: acceptanceFixtureIds.source.sudanEnvironment, id: acceptanceFixtureIds.jurisdiction.sudan, isDemo: false, name: "Sudan Higher Council for Environment and Natural Resources", type: "country", websiteUrl: "https://hcenr.gov.sd/wp-content/uploads/2021/05/%D9%82%D8%A7%D9%86%D9%88%D9%86-%D8%AD%D9%85%D8%A7%D9%8A%D8%A9-%D8%A7%D9%84%D8%A8%D9%8A%D8%A6%D8%A9-%D9%84%D8%B3%D9%86%D8%A9-2001.pdf" },
  { ...solomonIslandsRecordTimestamps, code: "SB-NATIONAL", countryIso3: "SLB", dataSourceId: acceptanceFixtureIds.source.solomonIslandsEnvironment, id: acceptanceFixtureIds.jurisdiction.solomonIslands, isDemo: false, name: "Solomon Islands Attorney-General's Chambers and Road Transport Board", type: "country", websiteUrl: "https://attorneygenerals.gov.sb/legislation-dashboard/download-info/road-transport-act-cap-131/" },
  { ...sierraLeoneRecordTimestamps, code: "SL-NATIONAL", countryIso3: "SLE", dataSourceId: acceptanceFixtureIds.source.sierraLeoneEnvironment, id: acceptanceFixtureIds.jurisdiction.sierraLeone, isDemo: false, name: "Sierra Leone Environment Protection Agency and road transport authorities", type: "country", websiteUrl: "https://www.parliament.gov.sl/uploads/acts/THE%20ENVIRONMENT%20PROTECTION%20AGENCY%20ACT%2C%202022.pdf" },
  { ...elSalvadorRecordTimestamps, code: "SV-NATIONAL", countryIso3: "SLV", dataSourceId: acceptanceFixtureIds.source.elSalvadorEnvironment, id: acceptanceFixtureIds.jurisdiction.elSalvador, isDemo: false, name: "El Salvador Ministry of Environment and Natural Resources and Vice Ministry of Transport", type: "country", websiteUrl: "https://www.diariooficial.gob.sv/seleccion/31287" },
  { ...somaliaRecordTimestamps, code: "SO-NATIONAL", countryIso3: "SOM", dataSourceId: acceptanceFixtureIds.source.somaliaEnvironment, id: acceptanceFixtureIds.jurisdiction.somalia, isDemo: false, name: "Somalia Ministry of Environment and Climate Change and Ministry of Transport", type: "country", websiteUrl: "https://moecc.gov.so/policies-and-strategies/" },
  { ...southSudanRecordTimestamps, code: "SS-NATIONAL", countryIso3: "SSD", dataSourceId: acceptanceFixtureIds.source.southSudanEnvironment, id: acceptanceFixtureIds.jurisdiction.southSudan, isDemo: false, name: "South Sudan National Bureau of Standards and Ministry of Environment and Forestry", type: "country", websiteUrl: "https://ssnbs.gov.ss/" },
  { ...surinameRecordTimestamps, code: "SR-NATIONAL", countryIso3: "SUR", dataSourceId: acceptanceFixtureIds.source.surinameEnvironment, id: acceptanceFixtureIds.jurisdiction.suriname, isDemo: false, name: "Suriname National Environmental Authority and vehicle inspection authorities", type: "country", websiteUrl: "https://gov.sr/" },
  { ...syriaRecordTimestamps, code: "SY-NATIONAL", countryIso3: "SYR", dataSourceId: acceptanceFixtureIds.source.syriaEnvironmentLaw12, id: acceptanceFixtureIds.jurisdiction.syria, isDemo: false, name: "Syrian Ministry of Local Administration and Environment", type: "country", websiteUrl: "https://sana.sy/economy/2238146/" },
  { ...chadRecordTimestamps, code: "TD-NATIONAL", countryIso3: "TCD", dataSourceId: acceptanceFixtureIds.source.chadEnvironment, id: acceptanceFixtureIds.jurisdiction.chad, isDemo: false, name: "Chad Ministry of Environment and Ministry of Transport", type: "country", websiteUrl: "https://www.environnement.gouv.td/" },
  { ...togoRecordTimestamps, code: "TG-NATIONAL", countryIso3: "TGO", dataSourceId: acceptanceFixtureIds.source.togoEnvironment, id: acceptanceFixtureIds.jurisdiction.togo, isDemo: false, name: "Togo environmental and road-transport authorities", type: "country", websiteUrl: "https://jo.gouv.tg/sites/default/files/JO/JO_SPECIAL_BIS_71E_N_25.pdf" },
  { ...timorLesteRecordTimestamps, code: "TL-NATIONAL", countryIso3: "TLS", dataSourceId: acceptanceFixtureIds.source.timorLesteEnvironment, id: acceptanceFixtureIds.jurisdiction.timorLeste, isDemo: false, name: "Timor-Leste environmental and road-transport authorities", type: "country", websiteUrl: "https://www.mj.gov.tl/jornal/public/docs/2012/serie_1/serie1_no24.pdf" },
  { ...trinidadTobagoRecordTimestamps, code: "TT-NATIONAL", countryIso3: "TTO", dataSourceId: acceptanceFixtureIds.source.trinidadTobagoEnvironment, id: acceptanceFixtureIds.jurisdiction.trinidadTobago, isDemo: false, name: "Trinidad and Tobago environmental and vehicle authorities", type: "country", websiteUrl: "https://ec.gov.tt/legislation-and-judgements/legislation" },
  { ...taiwanRecordTimestamps, code: "TW-NATIONAL", countryIso3: "TWN", dataSourceId: acceptanceFixtureIds.source.taiwanEnvironment, id: acceptanceFixtureIds.jurisdiction.taiwan, isDemo: false, name: "Taiwan Ministry of Environment and emission-certification authorities", type: "country", websiteUrl: "https://oaout.moenv.gov.tw/law/LawContent.aspx?id=FL015347" },
  { ...venezuelaRecordTimestamps, code: "VE-NATIONAL", countryIso3: "VEN", dataSourceId: acceptanceFixtureIds.source.venezuelaEnvironment, id: acceptanceFixtureIds.jurisdiction.venezuela, isDemo: false, name: "Venezuela mobile-source emission and environmental authorities", type: "country", websiteUrl: "https://faolex.fao.org/docs/pdf/ven181032.pdf" },
  { ...vanuatuRecordTimestamps, code: "VU-NATIONAL", countryIso3: "VUT", dataSourceId: acceptanceFixtureIds.source.vanuatuEnvironment, id: acceptanceFixtureIds.jurisdiction.vanuatu, isDemo: false, name: "Vanuatu environmental and vehicle-control authorities", type: "country", websiteUrl: "https://mocca.gov.vu/images/publications/legislation/DEPC/Legislation/Pollution%20%28Control%29%20Act..pdf" },
  { ...yemenRecordTimestamps, code: "YE-NATIONAL", countryIso3: "YEM", dataSourceId: acceptanceFixtureIds.source.yemenEnvironment, id: acceptanceFixtureIds.jurisdiction.yemen, isDemo: false, name: "Republic of Yemen environmental and road-traffic authorities", type: "country", websiteUrl: "https://www.agoye.gov.ye/page.php?id=323&lng=arabic" },
  { ...antarcticaRecordTimestamps, code: "AQ-BOUNDARY", countryIso3: null, dataSourceId: acceptanceFixtureIds.source.antarcticaBoundary, id: acceptanceFixtureIds.jurisdiction.antarctica, isDemo: false, name: "Antarctic Treaty System governance boundary (no national jurisdiction)", type: "international", websiteUrl: "https://www.ats.aq/e/protocol.html" },
  { ...frenchSouthernLandsRecordTimestamps, code: "TF-BOUNDARY", countryIso3: null, dataSourceId: acceptanceFixtureIds.source.frenchSouthernLandsBoundary, id: acceptanceFixtureIds.jurisdiction.frenchSouthernLands, isDemo: false, name: "French Southern and Antarctic Lands territorial applicability boundary", type: "international", websiteUrl: "https://www.legifrance.gouv.fr/codes/id/LEGISCTA000006143761" },
  { ...westernSaharaRecordTimestamps, code: "EH-BOUNDARY", countryIso3: null, dataSourceId: acceptanceFixtureIds.source.westernSaharaBoundary, id: acceptanceFixtureIds.jurisdiction.westernSahara, isDemo: false, name: "Western Sahara United Nations decolonization boundary", type: "international", websiteUrl: "https://www.un.org/dppa/decolonization/en/nsgt/western-sahara" },
  { ...falklandIslandsRecordTimestamps, code: "FK-BOUNDARY", countryIso3: null, dataSourceId: acceptanceFixtureIds.source.falklandIslandsBoundary, id: acceptanceFixtureIds.jurisdiction.falklandIslands, isDemo: false, name: "Falkland Islands territorial legislation boundary", type: "international", websiteUrl: "https://www.legislation.gov.fk/view/html/inforce/2017-07-31/fisl-1986-5" },
];

export const fixtureCountryJurisdictions: (typeof countryJurisdictions.$inferInsert)[] = [
  {
    ...chinaNonroadRecordTimestamps,
    countryIso3: "CHN",
    dataSourceId: acceptanceFixtureIds.source.cnGb17691,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.cnMee,
    validFrom: "2000-01-01",
  },
  {
    ...unitedStatesRecordTimestamps,
    countryIso3: "USA",
    dataSourceId: acceptanceFixtureIds.source.usEcfr1036,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.usEpa,
    validFrom: "2000-01-01",
  },
  ...euMemberCountryMemberships.map((membership) => ({
    ...euMembershipRecordTimestamps,
    ...membership,
    dataSourceId: acceptanceFixtureIds.source.euCountries,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.eu,
  })),
  ...([
    { countryIso3: "ARM", validFrom: "2015-01-02" },
    { countryIso3: "BLR", validFrom: "2015-01-01" },
    { countryIso3: "KAZ", validFrom: "2015-01-01" },
    { countryIso3: "KGZ", validFrom: "2015-08-12" },
    { countryIso3: "RUS", validFrom: "2015-01-01" },
  ] as const).map(({ countryIso3, validFrom }) => ({
    ...eaeuRecordTimestamps,
    countryIso3,
    dataSourceId: acceptanceFixtureIds.source.eaeuMemberStates,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.eaeu,
    validFrom,
  })),
  {
    ...recordTimestamps,
    countryIso3: "BRA",
    dataSourceId: acceptanceFixtureIds.source.brConama433,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.brConama,
    validFrom: "2000-01-01",
  },
  {
    ...japanRecordTimestamps,
    countryIso3: "JPN",
    dataSourceId: acceptanceFixtureIds.source.japanRoadSafety,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.japan,
    validFrom: "2000-01-01",
  },
  {
    ...koreaRecordTimestamps,
    countryIso3: "KOR",
    dataSourceId: acceptanceFixtureIds.source.koreaRuleAnnex17,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.korea,
    validFrom: "2000-01-01",
  },
  {
    ...mexicoRecordTimestamps,
    countryIso3: "MEX",
    dataSourceId: acceptanceFixtureIds.source.mexicoNom044,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.mexicoSemarnat,
    validFrom: "2000-01-01",
  },
  {
    ...turkeyRecordTimestamps,
    countryIso3: "TUR",
    dataSourceId: acceptanceFixtureIds.source.turkeyRoadRegulation,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.turkey,
    validFrom: "2000-01-01",
  },
  {
    ...australiaRecordTimestamps,
    countryIso3: "AUS",
    dataSourceId: acceptanceFixtureIds.source.australiaAdrCurrent,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.australia,
    validFrom: "2000-01-01",
  },
  {
    ...canadaRecordTimestamps,
    countryIso3: "CAN",
    dataSourceId: acceptanceFixtureIds.source.canadaRoadRegulation,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.canada,
    validFrom: "2000-01-01",
  },
  {
    ...unitedKingdomRecordTimestamps,
    countryIso3: "GBR",
    dataSourceId: acceptanceFixtureIds.source.unitedKingdomNrmm,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.unitedKingdom,
    validFrom: "2023-01-01",
  },
  {
    ...indiaRecordTimestamps,
    countryIso3: "IND",
    dataSourceId: acceptanceFixtureIds.source.indiaBs6,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.india,
    validFrom: "2000-01-01",
  },
  {
    ...russiaRecordTimestamps,
    countryIso3: "RUS",
    dataSourceId: acceptanceFixtureIds.source.russiaRoadRegulation,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.russia,
    validFrom: "2015-01-01",
  },
  {
    ...indonesiaRecordTimestamps,
    countryIso3: "IDN",
    dataSourceId: acceptanceFixtureIds.source.indonesiaEuro4,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.indonesia,
    validFrom: "2000-01-01",
  },
  {
    ...thailandRecordTimestamps,
    countryIso3: "THA",
    dataSourceId: acceptanceFixtureIds.source.thailandTis3046,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.thailand,
    validFrom: "2024-01-01",
  },
  {
    ...vietnamRecordTimestamps,
    countryIso3: "VNM",
    dataSourceId: acceptanceFixtureIds.source.vietnamDecision49,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.vietnam,
    validFrom: "2000-01-01",
  },
  {
    ...malaysiaRecordTimestamps,
    countryIso3: "MYS",
    dataSourceId: acceptanceFixtureIds.source.malaysiaDieselRegulation,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.malaysia,
    validFrom: "1996-09-01",
  },
  {
    ...saudiArabiaRecordTimestamps,
    countryIso3: "SAU",
    dataSourceId: acceptanceFixtureIds.source.saudiMachinerySafetyPart2,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.saudiArabia,
    validFrom: "2021-05-21",
  },
  {
    ...unitedArabEmiratesRecordTimestamps,
    countryIso3: "ARE",
    dataSourceId: acceptanceFixtureIds.source.uaeMandatoryStandards2018,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.unitedArabEmirates,
    validFrom: "2018-05-01",
  },
  {
    ...southAfricaRecordTimestamps,
    countryIso3: "ZAF",
    dataSourceId: acceptanceFixtureIds.source.southAfricaMotorVehiclesN23,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.southAfrica,
    validFrom: "2010-01-01",
  },
  {
    ...argentinaRecordTimestamps,
    countryIso3: "ARG",
    dataSourceId: acceptanceFixtureIds.source.argentinaResolution1464,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.argentina,
    validFrom: "2014-01-01",
  },
  {
    ...newZealandRecordTimestamps,
    countryIso3: "NZL",
    dataSourceId: acceptanceFixtureIds.source.newZealandVehicleExhaustRule,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.newZealand,
    validFrom: "2008-01-03",
  },
  {
    ...chileRecordTimestamps,
    countryIso3: "CHL",
    dataSourceId: acceptanceFixtureIds.source.chileMobileMachineryDecree39,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.chile,
    validFrom: "2021-10-21",
  },
  {
    ...colombiaRecordTimestamps,
    countryIso3: "COL",
    dataSourceId: acceptanceFixtureIds.source.colombiaResolution762,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.colombia,
    validFrom: "2022-07-18",
  },
  {
    ...peruRecordTimestamps,
    countryIso3: "PER",
    dataSourceId: acceptanceFixtureIds.source.peruDecree029,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.peru,
    validFrom: "2021-10-16",
  },
  {
    ...philippinesRecordTimestamps,
    countryIso3: "PHL",
    dataSourceId: acceptanceFixtureIds.source.philippinesLtoMc20151946,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.philippines,
    validFrom: "2016-01-01",
  },
  {
    ...singaporeRecordTimestamps,
    countryIso3: "SGP",
    dataSourceId: acceptanceFixtureIds.source.singaporeOffRoad2012,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.singapore,
    validFrom: "2012-07-01",
  },
  {
    ...norwayRecordTimestamps,
    countryIso3: "NOR",
    dataSourceId: acceptanceFixtureIds.source.norwayMachineryRegulation,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.norway,
    validFrom: "2020-07-01",
  },
  {
    ...icelandRecordTimestamps,
    countryIso3: "ISL",
    dataSourceId: acceptanceFixtureIds.source.icelandRoadRegulation2013,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.iceland,
    validFrom: "2013-04-15",
  },
  {
    ...liechtensteinRecordTimestamps,
    countryIso3: "LIE",
    dataSourceId: acceptanceFixtureIds.source.liechtensteinVts,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.liechtenstein,
    validFrom: "2020-08-01",
  },
  {
    ...switzerlandRecordTimestamps,
    countryIso3: "CHE",
    dataSourceId: acceptanceFixtureIds.source.switzerlandVts,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.switzerland,
    validFrom: "2026-07-01",
  },
  {
    ...serbiaRecordTimestamps,
    countryIso3: "SRB",
    dataSourceId: acceptanceFixtureIds.source.serbiaTechnicalConditions,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.serbia,
    validFrom: "2026-08-10",
  },
  {
    ...bosniaRecordTimestamps,
    countryIso3: "BIH",
    dataSourceId: acceptanceFixtureIds.source.bosniaR49Orders,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.bosnia,
    validFrom: "2019-06-01",
  },
  {
    ...northMacedoniaRecordTimestamps,
    countryIso3: "MKD",
    dataSourceId: acceptanceFixtureIds.source.northMacedoniaTractorApproval,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.northMacedonia,
    validFrom: "2026-08-10",
  },
  {
    ...montenegroRecordTimestamps,
    countryIso3: "MNE",
    dataSourceId: acceptanceFixtureIds.source.montenegroEuro6Implementation,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.montenegro,
    validFrom: "2018-10-15",
  },
  {
    ...albaniaRecordTimestamps,
    countryIso3: "ALB",
    dataSourceId: acceptanceFixtureIds.source.albaniaTreatyStatus,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.albania,
    validFrom: "2026-08-10",
  },
  {
    ...ukraineRecordTimestamps,
    countryIso3: "UKR",
    dataSourceId: acceptanceFixtureIds.source.ukraineImportRegistrationLaw,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.ukraine,
    validFrom: "2016-01-01",
  },
  {
    ...moldovaRecordTimestamps,
    countryIso3: "MDA",
    dataSourceId:
      acceptanceFixtureIds.source.moldovaTypeApprovalSecondaryConsultation,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.moldova,
    validFrom: "2026-08-10",
  },
  {
    ...nepalRecordTimestamps,
    countryIso3: "NPL",
    dataSourceId:
      acceptanceFixtureIds.source.nepalVehiclePollutionStandardDoenv,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.nepal,
    validFrom: "2025-06-23",
  },
  {
    ...armeniaRecordTimestamps,
    countryIso3: "ARM",
    dataSourceId: acceptanceFixtureIds.source.armeniaTrCu031Consolidated,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.armenia,
    validFrom: "2019-01-01",
  },
  {
    ...azerbaijanRecordTimestamps,
    countryIso3: "AZE",
    dataSourceId: acceptanceFixtureIds.source.azerbaijanAzs6362025,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.azerbaijan,
    validFrom: "2026-08-10",
  },
  {
    ...georgiaRecordTimestamps,
    countryIso3: "GEO",
    dataSourceId: acceptanceFixtureIds.source.georgiaResolution238Mepa,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.georgia,
    validFrom: "2025-01-01",
  },
  {
    ...uzbekistanRecordTimestamps,
    countryIso3: "UZB",
    dataSourceId: acceptanceFixtureIds.source.uzbekistanRoadRegulation,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.uzbekistan,
    validFrom: "2025-10-01",
  },
  {
    ...kazakhstanRecordTimestamps,
    countryIso3: "KAZ",
    dataSourceId: acceptanceFixtureIds.source.kazakhstanAgricultureRegulation,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.kazakhstan,
    validFrom: "2019-01-01",
  },
  {
    ...tajikistanRecordTimestamps,
    countryIso3: "TJK",
    dataSourceId: acceptanceFixtureIds.source.tajikistanEngineTermsDraft,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.tajikistan,
    validFrom: "2026-08-10",
  },
  {
    ...kyrgyzstanRecordTimestamps,
    countryIso3: "KGZ",
    dataSourceId: acceptanceFixtureIds.source.kyrgyzstanAgricultureRegulation,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.kyrgyzstan,
    validFrom: "2019-01-01",
  },
  {
    ...turkmenistanRecordTimestamps,
    countryIso3: "TKM",
    dataSourceId:
      acceptanceFixtureIds.source.turkmenistanGasolineMeasurementStandard,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.turkmenistan,
    validFrom: "2026-08-10",
  },
  {
    ...afghanistanRecordTimestamps,
    countryIso3: "AFG",
    dataSourceId: acceptanceFixtureIds.source.afghanistanAirPollutionAmendment,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.afghanistan,
    validFrom: "2026-08-10",
  },
  {
    ...angolaRecordTimestamps,
    countryIso3: "AGO",
    dataSourceId: acceptanceFixtureIds.source.angolaEnvironmentalStandardizationProgram,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.angola,
    validFrom: "2026-08-10",
  },
  {
    ...burundiRecordTimestamps,
    countryIso3: "BDI",
    dataSourceId: acceptanceFixtureIds.source.burundiVehicleInspectionOrder2025,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.burundi,
    validFrom: "2026-08-10",
  },
  {
    ...beninRecordTimestamps,
    countryIso3: "BEN",
    dataSourceId: acceptanceFixtureIds.source.beninAirQualityDecreeIndex,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.benin,
    validFrom: "2026-08-10",
  },
  {
    ...burkinaFasoRecordTimestamps,
    countryIso3: "BFA",
    dataSourceId: acceptanceFixtureIds.source.burkinaFasoCurrentCitation2025,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.burkinaFaso,
    validFrom: "2026-08-10",
  },
  {
    ...bangladeshRecordTimestamps,
    countryIso3: "BGD",
    dataSourceId: acceptanceFixtureIds.source.bangladeshGazetteIndex2022,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.bangladesh,
    validFrom: "2022-07-26",
  },
  {
    ...bahamasRecordTimestamps,
    countryIso3: "BHS",
    dataSourceId: acceptanceFixtureIds.source.bahamasEnvironmentalPlanningAct,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.bahamas,
    validFrom: "2026-08-10",
  },
  {
    ...belarusRecordTimestamps,
    countryIso3: "BLR",
    dataSourceId: acceptanceFixtureIds.source.belarusTrCu031,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.belarus,
    validFrom: "2019-01-01",
  },
  {
    ...boliviaRecordTimestamps,
    countryIso3: "BOL",
    dataSourceId: acceptanceFixtureIds.source.boliviaIbmetroAcceptance,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.bolivia,
    validFrom: "2022-04-01",
  },
  {
    ...moroccoRecordTimestamps,
    countryIso3: "MAR",
    dataSourceId: acceptanceFixtureIds.source.moroccoEuro6Order2251,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.morocco,
    validFrom: "2026-08-10",
  },
  {
    ...kenyaRecordTimestamps,
    countryIso3: "KEN",
    dataSourceId: acceptanceFixtureIds.source.kenyaInspectionRules2026,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.kenya,
    validFrom: "2026-08-10",
  },
  {
    ...nigeriaRecordTimestamps,
    countryIso3: "NGA",
    dataSourceId: acceptanceFixtureIds.source.nigeriaNesrea,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.nigeria,
    validFrom: "2026-08-11",
  },
  {
    ...egyptRecordTimestamps,
    countryIso3: "EGY",
    dataSourceId: acceptanceFixtureIds.source.egyptDecision710,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.egypt,
    validFrom: "2026-08-10",
  },
  {
    ...ghanaRecordTimestamps,
    countryIso3: "GHA",
    dataSourceId:
      acceptanceFixtureIds.source.ghanaMotorVehicleEmissionsStandard1219,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.ghana,
    validFrom: "2026-08-10",
  },
  {
    ...israelRecordTimestamps,
    countryIso3: "ISR",
    dataSourceId: acceptanceFixtureIds.source.israelNrmmImr2026,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.israel,
    validFrom: "2026-01-01",
  },
  {
    ...pakistanRecordTimestamps,
    countryIso3: "PAK",
    dataSourceId: acceptanceFixtureIds.source.pakistanSro72GazetteScan,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.pakistan,
    validFrom: "2012-07-01",
  },
  {
    ...qatarRecordTimestamps,
    countryIso3: "QAT",
    dataSourceId:
      acceptanceFixtureIds.source.qatarTechnicalRegulationsDecision125,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.qatar,
    validFrom: "2026-08-09",
  },
  {
    ...kuwaitRecordTimestamps,
    countryIso3: "KWT",
    dataSourceId:
      acceptanceFixtureIds.source.kuwaitTechnicalRegulationsDecision44,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.kuwait,
    validFrom: "2026-08-09",
  },
  {
    ...omanRecordTimestamps,
    countryIso3: "OMN",
    dataSourceId:
      acceptanceFixtureIds.source.omanGsoMotorVehicleRegulationsMy2026,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.oman,
    validFrom: "2026-08-09",
  },
  {
    ...jordanRecordTimestamps,
    countryIso3: "JOR",
    dataSourceId:
      acceptanceFixtureIds.source.jordanTransportEmissionsStandardsCatalogue,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.jordan,
    validFrom: "2026-08-09",
  },
  {
    ...cambodiaRecordTimestamps,
    countryIso3: "KHM",
    dataSourceId: acceptanceFixtureIds.source.cambodiaTransport,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.cambodia,
    validFrom: "2026-08-10",
  },
  {
    ...laosRecordTimestamps,
    countryIso3: "LAO",
    dataSourceId: acceptanceFixtureIds.source.laosTransport,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.laos,
    validFrom: "2026-08-10",
  },
  {
    ...sriLankaRecordTimestamps,
    countryIso3: "LKA",
    dataSourceId: acceptanceFixtureIds.source.sriLankaTransport,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.sriLanka,
    validFrom: "2018-07-13",
  },
  {
    ...mongoliaRecordTimestamps,
    countryIso3: "MNG",
    dataSourceId: acceptanceFixtureIds.source.mongoliaTransport,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.mongolia,
    validFrom: "2026-08-10",
  },
  {
    ...costaRicaRecordTimestamps,
    countryIso3: "CRI",
    dataSourceId: acceptanceFixtureIds.source.costaRicaTransport,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.costaRica,
    validFrom: "2026-08-10",
  },
  {
    ...ecuadorRecordTimestamps,
    countryIso3: "ECU",
    dataSourceId: acceptanceFixtureIds.source.ecuadorRte017,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.ecuador,
    validFrom: "2009-02-07",
  },
  {
    ...dominicanRepublicRecordTimestamps,
    countryIso3: "DOM",
    dataSourceId: acceptanceFixtureIds.source.dominicanRepublicTransport,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.dominicanRepublic,
    validFrom: "2026-08-10",
  },
  {
    ...algeriaRecordTimestamps,
    countryIso3: "DZA",
    dataSourceId: acceptanceFixtureIds.source.algeriaTransport,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.algeria,
    validFrom: "2026-08-11",
  },
  {
    ...tunisiaRecordTimestamps,
    countryIso3: "TUN",
    dataSourceId: acceptanceFixtureIds.source.tunisiaTransport,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.tunisia,
    validFrom: "2026-08-11",
  },
  {
    ...ethiopiaRecordTimestamps,
    countryIso3: "ETH",
    dataSourceId: acceptanceFixtureIds.source.ethiopiaTransport,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.ethiopia,
    validFrom: "2026-08-11",
  },
  {
    ...guatemalaRecordTimestamps,
    countryIso3: "GTM",
    dataSourceId: acceptanceFixtureIds.source.guatemalaTransport,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.guatemala,
    validFrom: "2026-08-10",
  },
  {
    ...hondurasRecordTimestamps,
    countryIso3: "HND",
    dataSourceId: acceptanceFixtureIds.source.hondurasTransport,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.honduras,
    validFrom: "2026-08-10",
  },
  {
    ...panamaRecordTimestamps,
    countryIso3: "PAN",
    dataSourceId: acceptanceFixtureIds.source.panamaTransport,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.panama,
    validFrom: "2026-08-10",
  },
  {
    ...uruguayRecordTimestamps,
    countryIso3: "URY",
    dataSourceId: acceptanceFixtureIds.source.uruguayTransport,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.uruguay,
    validFrom: "2023-05-14",
  },
  {
    ...botswanaRecordTimestamps,
    countryIso3: "BWA",
    dataSourceId: acceptanceFixtureIds.source.botswanaTransport,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.botswana,
    validFrom: "2026-08-11",
  },
  {
    ...namibiaRecordTimestamps,
    countryIso3: "NAM",
    dataSourceId: acceptanceFixtureIds.source.namibiaTransport,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.namibia,
    validFrom: "2026-08-11",
  },
  {
    ...tanzaniaRecordTimestamps,
    countryIso3: "TZA",
    dataSourceId: acceptanceFixtureIds.source.tanzaniaTransport,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.tanzania,
    validFrom: "2007-12-07",
  },
  {
    ...ugandaRecordTimestamps,
    countryIso3: "UGA",
    dataSourceId: acceptanceFixtureIds.source.ugandaTransport,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.uganda,
    validFrom: "2026-08-11",
  },
  {
    ...zambiaRecordTimestamps,
    countryIso3: "ZMB",
    dataSourceId: acceptanceFixtureIds.source.zambiaTransport,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.zambia,
    validFrom: "2026-08-10",
  },
  {
    ...zimbabweRecordTimestamps,
    countryIso3: "ZWE",
    dataSourceId: acceptanceFixtureIds.source.zimbabweTransport,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.zimbabwe,
    validFrom: "2026-08-10",
  },
  {
    ...rwandaRecordTimestamps,
    countryIso3: "RWA",
    dataSourceId: acceptanceFixtureIds.source.rwandaTransport,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.rwanda,
    validFrom: "2023-01-23",
  },
  {
    ...coteDIvoireRecordTimestamps,
    countryIso3: "CIV",
    dataSourceId: acceptanceFixtureIds.source.coteDIvoireTransport,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.coteDIvoire,
    validFrom: "2026-08-10",
  },
  {
    ...cameroonRecordTimestamps,
    countryIso3: "CMR",
    dataSourceId: acceptanceFixtureIds.source.cameroonTransport,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.cameroon,
    validFrom: "2026-08-11",
  },
  {
    ...senegalRecordTimestamps,
    countryIso3: "SEN",
    dataSourceId: acceptanceFixtureIds.source.senegalTransport,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.senegal,
    validFrom: "2026-08-11",
  },
  {
    ...mozambiqueRecordTimestamps,
    countryIso3: "MOZ",
    dataSourceId: acceptanceFixtureIds.source.mozambiqueTransport,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.mozambique,
    validFrom: "2026-08-10",
  },
  {
    ...eswatiniRecordTimestamps,
    countryIso3: "SWZ",
    dataSourceId: acceptanceFixtureIds.source.eswatiniTransport,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.eswatini,
    validFrom: "2026-08-11",
  },
  {
    ...lesothoRecordTimestamps,
    countryIso3: "LSO",
    dataSourceId: acceptanceFixtureIds.source.lesothoTransport,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.lesotho,
    validFrom: "2026-08-10",
  },
  { ...madagascarRecordTimestamps, countryIso3: "MDG", dataSourceId: acceptanceFixtureIds.source.madagascarTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.madagascar, validFrom: "2026-08-10" },
  { ...mauritiusRecordTimestamps, countryIso3: "MUS", dataSourceId: acceptanceFixtureIds.source.mauritiusTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.mauritius, validFrom: "2026-08-10" },
  { ...malawiRecordTimestamps, countryIso3: "MWI", dataSourceId: acceptanceFixtureIds.source.malawiTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.malawi, validFrom: "2026-08-10" },
  { ...fijiRecordTimestamps, countryIso3: "FJI", dataSourceId: acceptanceFixtureIds.source.fijiTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.fiji, validFrom: "2026-08-10" },
  { ...belizeRecordTimestamps, countryIso3: "BLZ", dataSourceId: acceptanceFixtureIds.source.belizeTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.belize, validFrom: "2026-08-10" },
  { ...bruneiRecordTimestamps, countryIso3: "BRN", dataSourceId: acceptanceFixtureIds.source.bruneiTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.brunei, validFrom: "2026-08-10" },
  { ...bhutanRecordTimestamps, countryIso3: "BTN", dataSourceId: acceptanceFixtureIds.source.bhutanTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.bhutan, validFrom: "2026-08-10" },
  { ...centralAfricanRepublicRecordTimestamps, countryIso3: "CAF", dataSourceId: acceptanceFixtureIds.source.centralAfricanRepublicTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.centralAfricanRepublic, validFrom: "2026-08-10" },
  { ...democraticRepublicOfCongoRecordTimestamps, countryIso3: "COD", dataSourceId: acceptanceFixtureIds.source.democraticRepublicOfCongoTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.democraticRepublicOfCongo, validFrom: "2026-08-10" },
  { ...republicOfCongoRecordTimestamps, countryIso3: "COG", dataSourceId: acceptanceFixtureIds.source.republicOfCongoTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.republicOfCongo, validFrom: "2026-08-10" },
  { ...cubaRecordTimestamps, countryIso3: "CUB", dataSourceId: acceptanceFixtureIds.source.cubaTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.cuba, validFrom: "2026-08-10" },
  { ...djiboutiRecordTimestamps, countryIso3: "DJI", dataSourceId: acceptanceFixtureIds.source.djiboutiTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.djibouti, validFrom: "2026-08-10" },
  { ...eritreaRecordTimestamps, countryIso3: "ERI", dataSourceId: acceptanceFixtureIds.source.eritreaVehicleTechnicalStandardsRegulations61_2002, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.eritrea, validFrom: "2026-08-10" },
  { ...gabonRecordTimestamps, countryIso3: "GAB", dataSourceId: acceptanceFixtureIds.source.gabonHeavyVehicleHomologationOrder00097_2017, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.gabon, validFrom: "2026-08-10" },
  { ...guineaRecordTimestamps, countryIso3: "GIN", dataSourceId: acceptanceFixtureIds.source.guineaTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.guinea, validFrom: "2026-08-10" },
  { ...gambiaRecordTimestamps, countryIso3: "GMB", dataSourceId: acceptanceFixtureIds.source.gambiaMotorTrafficAmendmentAct2013, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.gambia, validFrom: "2026-08-10" },
  { ...guineaBissauRecordTimestamps, countryIso3: "GNB", dataSourceId: acceptanceFixtureIds.source.guineaBissauTransportMinistryDirectory, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.guineaBissau, validFrom: "2026-08-10" },
  { ...equatorialGuineaRecordTimestamps, countryIso3: "GNQ", dataSourceId: acceptanceFixtureIds.source.equatorialGuineaGeneralRoadTransportLaw4_2018, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.equatorialGuinea, validFrom: "2026-08-10" },
  { ...greenlandRecordTimestamps, countryIso3: "GRL", dataSourceId: acceptanceFixtureIds.source.greenlandTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.greenland, validFrom: "2026-08-10" },
  { ...guyanaRecordTimestamps, countryIso3: "GUY", dataSourceId: acceptanceFixtureIds.source.guyanaTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.guyana, validFrom: "2026-08-10" },
  { ...haitiRecordTimestamps, countryIso3: "HTI", dataSourceId: acceptanceFixtureIds.source.haitiTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.haiti, validFrom: "2026-08-10" },
  { ...iranRecordTimestamps, countryIso3: "IRN", dataSourceId: acceptanceFixtureIds.source.iranArticle4Amendment2024, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.iran, validFrom: "2026-08-10" },
  { ...iraqRecordTimestamps, countryIso3: "IRQ", dataSourceId: acceptanceFixtureIds.source.iraqTr167ImplementationNotice2025, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.iraq, validFrom: "2026-08-10" },
  { ...jamaicaRecordTimestamps, countryIso3: "JAM", dataSourceId: acceptanceFixtureIds.source.jamaicaTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.jamaica, validFrom: "2026-08-10" },
  { ...lebanonRecordTimestamps, countryIso3: "LBN", dataSourceId: acceptanceFixtureIds.source.lebanonThirdBur2019, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.lebanon, validFrom: "2026-08-10" },
  { ...liberiaRecordTimestamps, countryIso3: "LBR", dataSourceId: acceptanceFixtureIds.source.liberiaVehicleAdministrativeRegulation2011, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.liberia, validFrom: "2026-08-10" },
  { ...libyaRecordTimestamps, countryIso3: "LBY", dataSourceId: acceptanceFixtureIds.source.libyaEnvironmentalExecutiveRegulation448, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.libya, validFrom: "2026-08-10" },
  { ...maliRecordTimestamps, countryIso3: "MLI", dataSourceId: acceptanceFixtureIds.source.maliRoadUseVehicleCirculationDecree2023, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.mali, validFrom: "2026-08-10" },
  { ...myanmarRecordTimestamps, countryIso3: "MMR", dataSourceId: acceptanceFixtureIds.source.myanmarTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.myanmar, validFrom: "2026-08-10" },
  { ...mauritaniaRecordTimestamps, countryIso3: "MRT", dataSourceId: acceptanceFixtureIds.source.mauritaniaEnvironmentCode2000, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.mauritania, validFrom: "2026-08-10" },
  { ...newCaledoniaRecordTimestamps, countryIso3: "NCL", dataSourceId: acceptanceFixtureIds.source.newCaledoniaTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.newCaledonia, validFrom: "2026-08-10" },
  { ...nigerRecordTimestamps, countryIso3: "NER", dataSourceId: acceptanceFixtureIds.source.nigerMotorVehicleHomologationEServices, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.niger, validFrom: "2026-08-10" },
  { ...nicaraguaRecordTimestamps, countryIso3: "NIC", dataSourceId: acceptanceFixtureIds.source.nicaraguaTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.nicaragua, validFrom: "2026-08-10" },
  { ...papuaNewGuineaRecordTimestamps, countryIso3: "PNG", dataSourceId: acceptanceFixtureIds.source.papuaNewGuineaTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.papuaNewGuinea, validFrom: "2026-08-10" },
  { ...puertoRicoRecordTimestamps, countryIso3: "PRI", dataSourceId: acceptanceFixtureIds.source.puertoRicoTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.puertoRico, validFrom: "2026-08-10" },
  { ...northKoreaRecordTimestamps, countryIso3: "PRK", dataSourceId: acceptanceFixtureIds.source.northKoreaTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.northKorea, validFrom: "2026-08-10" },
  { ...paraguayRecordTimestamps, countryIso3: "PRY", dataSourceId: acceptanceFixtureIds.source.paraguayTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.paraguay, validFrom: "2026-08-10" },
  { ...palestineRecordTimestamps, countryIso3: "PSE", dataSourceId: acceptanceFixtureIds.source.palestineTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.palestine, validFrom: "2026-08-10" },
  { ...sudanRecordTimestamps, countryIso3: "SDN", dataSourceId: acceptanceFixtureIds.source.sudanTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.sudan, validFrom: "2026-08-10" },
  { ...solomonIslandsRecordTimestamps, countryIso3: "SLB", dataSourceId: acceptanceFixtureIds.source.solomonIslandsTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.solomonIslands, validFrom: "2026-08-10" },
  { ...sierraLeoneRecordTimestamps, countryIso3: "SLE", dataSourceId: acceptanceFixtureIds.source.sierraLeoneTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.sierraLeone, validFrom: "2026-08-10" },
  { ...elSalvadorRecordTimestamps, countryIso3: "SLV", dataSourceId: acceptanceFixtureIds.source.elSalvadorTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.elSalvador, validFrom: "2026-08-10" },
  { ...somaliaRecordTimestamps, countryIso3: "SOM", dataSourceId: acceptanceFixtureIds.source.somaliaTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.somalia, validFrom: "2026-08-10" },
  { ...southSudanRecordTimestamps, countryIso3: "SSD", dataSourceId: acceptanceFixtureIds.source.southSudanTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.southSudan, validFrom: "2026-08-10" },
  { ...surinameRecordTimestamps, countryIso3: "SUR", dataSourceId: acceptanceFixtureIds.source.surinameTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.suriname, validFrom: "2026-08-10" },
  { ...syriaRecordTimestamps, countryIso3: "SYR", dataSourceId: acceptanceFixtureIds.source.syriaVehicleImportNotice2025, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.syria, validFrom: "2026-08-10" },
  { ...chadRecordTimestamps, countryIso3: "TCD", dataSourceId: acceptanceFixtureIds.source.chadTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.chad, validFrom: "2026-08-10" },
  { ...togoRecordTimestamps, countryIso3: "TGO", dataSourceId: acceptanceFixtureIds.source.togoTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.togo, validFrom: "2026-08-10" },
  { ...timorLesteRecordTimestamps, countryIso3: "TLS", dataSourceId: acceptanceFixtureIds.source.timorLesteTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.timorLeste, validFrom: "2026-08-10" },
  { ...trinidadTobagoRecordTimestamps, countryIso3: "TTO", dataSourceId: acceptanceFixtureIds.source.trinidadTobagoTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.trinidadTobago, validFrom: "2026-08-10" },
  { ...taiwanRecordTimestamps, countryIso3: "TWN", dataSourceId: acceptanceFixtureIds.source.taiwanTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.taiwan, validFrom: "2021-09-01" },
  { ...venezuelaRecordTimestamps, countryIso3: "VEN", dataSourceId: acceptanceFixtureIds.source.venezuelaTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.venezuela, validFrom: "2000-01-01" },
  { ...vanuatuRecordTimestamps, countryIso3: "VUT", dataSourceId: acceptanceFixtureIds.source.vanuatuTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.vanuatu, validFrom: "2026-08-10" },
  { ...yemenRecordTimestamps, countryIso3: "YEM", dataSourceId: acceptanceFixtureIds.source.yemenTransport, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.yemen, validFrom: "2026-08-10" },
  { ...antarcticaRecordTimestamps, countryIso3: "ATA", dataSourceId: acceptanceFixtureIds.source.antarcticaBoundary, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.antarctica, validFrom: "2026-08-10" },
  { ...frenchSouthernLandsRecordTimestamps, countryIso3: "ATF", dataSourceId: acceptanceFixtureIds.source.frenchSouthernLandsBoundary, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.frenchSouthernLands, validFrom: "2026-08-10" },
  { ...westernSaharaRecordTimestamps, countryIso3: "ESH", dataSourceId: acceptanceFixtureIds.source.westernSaharaBoundary, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.westernSahara, validFrom: "2026-08-10" },
  { ...falklandIslandsRecordTimestamps, countryIso3: "FLK", dataSourceId: acceptanceFixtureIds.source.falklandIslandsBoundary, isDemo: false, jurisdictionId: acceptanceFixtureIds.jurisdiction.falklandIslands, validFrom: "2026-08-10" },
];

export const fixtureRegulations: (typeof regulations.$inferInsert)[] = [
  {
    ...recordTimestamps,
    adoptedOn: "2018-06-22",
    canonicalName:
      "GB 17691-2018 重型柴油车污染物排放限值及测量方法（中国第六阶段）",
    citationCode: "GB 17691-2018",
    dataSourceId: acceptanceFixtureIds.source.cnGb17691,
    effectiveFrom: "2019-07-01",
    id: acceptanceFixtureIds.regulation.cnGb17691,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.cnMee,
    status: "effective",
    summary:
      "适用 M2/M3/N1/N2/N3 及总质量大于 3500 kg 的 M1；国六 b 阶段自 2023-07-01 全国强制（五部门公告 2023 年第 14 号）。",
  },
  {
    ...chinaNonroadRecordTimestamps,
    adoptedOn: "2014-05-16",
    canonicalName:
      "GB 20891-2014 非道路移动机械用柴油机排气污染物排放限值及测量方法（中国第三、四阶段）及第 1 号修改单",
    citationCode: "GB 20891-2014",
    dataSourceId: acceptanceFixtureIds.source.cnGb20891,
    effectiveFrom: "2014-10-01",
    id: acceptanceFixtureIds.regulation.cnGb20891,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.cnMee,
    status: "effective",
    summary:
      "覆盖工程机械与农业机械；第三阶段自 2016-04-01 对全部机械全面实施。第四阶段自 2022-12-01 对 ≤560 kW 强制，>560 kW 实施时间另行公告。第四阶段 NH3 25 ppm 仅适用于使用反应剂的发动机，当前查询模型没有该适用条件，因此不发布为无条件限值行。",
  },
  {
    ...unitedStatesRecordTimestamps,
    adoptedOn: "2023-01-24",
    canonicalName:
      "40 CFR 1036.104 Criteria pollutant emission standards for heavy-duty engines (MY2027 and later)",
    citationCode: "40 CFR 1036.104",
    dataSourceId: acceptanceFixtureIds.source.usEcfr1036,
    effectiveFrom: "2027-01-01",
    id: acceptanceFixtureIds.regulation.us1036104,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.usEpa,
    status: "effective",
    summary:
      "MY2027+ 重型公路压燃发动机的 primary FTP/SET 与 LLC 代表路径；以 2027-01-01 作为机型年查询代理，未把温度修正公式、off-cycle bin 或 ABT/FEL 选择累加为静态限值。",
  },
  {
    ...unitedStatesRecordTimestamps,
    adoptedOn: "2001-01-18",
    canonicalName:
      "40 CFR 86.007-11 Emission standards for 2007 and later model year diesel heavy-duty engines",
    citationCode: "40 CFR 86.007-11",
    dataSourceId: acceptanceFixtureIds.source.usEcfr86,
    effectiveFrom: "2007-01-01",
    effectiveTo: "2027-01-01",
    id: acceptanceFixtureIds.regulation.us8600711,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.usEpa,
    status: "effective",
    summary:
      "MY2010–2026 petroleum-diesel HDE 的 primary FTP/SET 与核心烟度代表路径；NTE/FEL 条件路径未静态累加，MY2027+ 由 40 CFR 1036.104 代表路径接续。",
  },
  {
    ...unitedStatesRecordTimestamps,
    adoptedOn: "2004-06-29",
    canonicalName:
      "40 CFR Part 1039 Control of Emissions from New and In-Use Nonroad Compression-Ignition Engines (Tier 4)",
    citationCode: "40 CFR 1039.101",
    dataSourceId: acceptanceFixtureIds.source.usEcfr1039,
    effectiveFrom: "2015-01-01",
    id: acceptanceFixtureIds.regulation.us1039101,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.usEpa,
    status: "effective",
    summary:
      "MY2015+、P≤560 kW variable-speed 非道路压燃发动机 Tier 4 的 NRTC/NRSC 基准代表路径；保留 Table 1 的 <8、8–19、19–37、37–56、56–130 与 130–560 kW 功率带和脚注边界。>560 kW 因发电机组应用分支未建模；ABT/FEL、NTE、constant-speed、可选 <8 kW PM 与烟度豁免路径不累计。",
  },
  {
    ...recordTimestamps,
    adoptedOn: null,
    canonicalName:
      "91 FR 43154 Amendments and Nonconformance Penalties for Model Year 2027 and Later Heavy-Duty Highway Engines",
    citationCode: "91 FR 43154",
    dataSourceId: acceptanceFixtureIds.source.usFr91x43154,
    effectiveFrom: null,
    id: acceptanceFixtureIds.regulation.usFr91x43154,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.usEpa,
    proposedOn: "2026-07-14",
    status: "proposed",
    summary: "征求意见稿（意见期至 2026-08-29），不得作为 effective 返回。",
  },
  {
    ...recordTimestamps,
    adoptedOn: "2009-06-18",
    canonicalName:
      "Regulation (EC) No 595/2009 on type-approval of heavy-duty vehicles (Euro VI)",
    citationCode: "CELEX:32009R0595",
    dataSourceId: acceptanceFixtureIds.source.euReg595,
    effectiveFrom: "2012-12-31",
    effectiveTo: "2027-11-29",
    id: acceptanceFixtureIds.regulation.euReg595,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.eu,
    status: "effective",
    summary:
      "Euro VI 重型车辆（M2/M3/N2/N3）型式批准；自 2027-11-29 被 Euro 7（2024/1257）废止。代表性柴油 WHSC/WHTC 限值已读回入库。",
  },
  {
    ...recordTimestamps,
    adoptedOn: "2016-09-14",
    canonicalName:
      "Regulation (EU) 2016/1628 on non-road mobile machinery emission limits (Stage V)",
    citationCode: "CELEX:32016R1628",
    dataSourceId: acceptanceFixtureIds.source.euReg1628,
    effectiveFrom: "2019-01-01",
    id: acceptanceFixtureIds.regulation.euReg1628,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.eu,
    status: "effective",
    summary:
      "非道路移动机械 Stage V（工程机械与农业机械共用）。附件 II 代表性功率带限值已读回入库。",
  },
  {
    ...recordTimestamps,
    adoptedOn: "2024-04-24",
    canonicalName:
      "Regulation (EU) 2024/1257 on type-approval of motor vehicles and engines (Euro 7)",
    citationCode: "CELEX:32024R1257",
    dataSourceId: acceptanceFixtureIds.source.euReg1257,
    effectiveFrom: "2027-11-29",
    id: acceptanceFixtureIds.regulation.euReg1257,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.eu,
    status: "adopted",
    summary:
      "已通过、已生效但 M2/M3/N2/N3 自 2027-11-29 起适用并废止 595/2009；该日之前在数据中为 adopted。",
  },
  {
    ...japanRecordTimestamps,
    adoptedOn: null,
    canonicalName:
      "日本平成28年（2016年）重型柴油车排出ガス規制",
    citationCode: "JPN 2016 HD Diesel",
    dataSourceId: acceptanceFixtureIds.source.japanRoadSafety,
    effectiveFrom: "2018-10-01",
    id: acceptanceFixtureIds.regulation.japanRoad2016,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.japan,
    status: "effective",
    summary:
      "道路運送車両の保安基準第31条委任下的重型柴油车标准；2016-10 起分车型实施，至 2018-10-01 已覆盖全部 GVW>3.5 t 重型车。本库在尚无 GVW 过滤字段时采用全面适用日。",
  },
  {
    ...japanRecordTimestamps,
    adoptedOn: "2014-01-20",
    canonicalName:
      "オフロード法 平成26年（2014年）ディーゼル特殊自動車排出ガス基準",
    citationCode: "平成26年三省告示第1号（2014年基準）",
    dataSourceId: acceptanceFixtureIds.source.japanOffroadNotice,
    effectiveFrom: "2014-10-01",
    id: acceptanceFixtureIds.regulation.japanOffroad2014,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.japan,
    status: "effective",
    summary:
      "オフロード法现行柴油特殊车辆 2014 年基准，覆盖 19≤额定功率<560 kW；按功率带于 2014-10 至 2016-10 分阶段实施，工程机械与农业机械共用。",
  },
  {
    ...koreaRecordTimestamps,
    adoptedOn: null,
    canonicalName:
      "대기환경보전법 시행규칙 별표 17 경유사용 대형·초대형 자동차 기준",
    citationCode: "KOR Annex 17 HD Diesel 2017",
    dataSourceId: acceptanceFixtureIds.source.koreaRuleAnnex17,
    effectiveFrom: "2017-10-01",
    id: acceptanceFixtureIds.regulation.koreaRoad2017,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.korea,
    status: "effective",
    summary:
      "별표 17 제2호아목的重型与超重型柴油道路车辆标准，自 2017-10-01 适用；卡车与客车均须同时满足 WHSC、WHTC。",
  },
  {
    ...koreaRecordTimestamps,
    adoptedOn: null,
    canonicalName:
      "대기환경보전법 시행규칙 별표 17 건설기계 원동기 2020년 기준",
    citationCode: "KOR Annex 17 Construction 2020",
    dataSourceId: acceptanceFixtureIds.source.koreaRuleAnnex17,
    effectiveFrom: "2020-12-01",
    id: acceptanceFixtureIds.regulation.koreaConstruction2020,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.korea,
    status: "effective",
    summary:
      "별표 17 제4호마목的柴油工程机械发动机标准，自 2020-12-01 适用；现行表覆盖小于 8 kW 至 560 kW 以下的功率带。",
  },
  {
    ...koreaRecordTimestamps,
    adoptedOn: null,
    canonicalName:
      "대기환경보전법 시행규칙 별표 17 농업기계 원동기 2021년 기준",
    citationCode: "KOR Annex 17 Agriculture 2021",
    dataSourceId: acceptanceFixtureIds.source.koreaRuleAnnex17,
    effectiveFrom: "2021-07-01",
    id: acceptanceFixtureIds.regulation.koreaAgriculture2021,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.korea,
    status: "effective",
    summary:
      "별표 17 제5호라목的柴油农业机械发动机标准，自 2021-07-01 适用；现行表覆盖小于 8 kW 至 560 kW 以下的功率带。",
  },
  {
    ...mexicoRecordTimestamps,
    adoptedOn: "2017-10-19",
    canonicalName:
      "NOM-044-SEMARNAT-2017 Tabla 1B（美国 EPA 循环）重型柴油发动机标准",
    citationCode: "NOM-044-SEMARNAT-2017 Tabla 1B",
    dataSourceId: acceptanceFixtureIds.source.mexicoNom044,
    effectiveFrom: "2025-01-01",
    id: acceptanceFixtureIds.regulation.mexicoNom044Table1,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.mexicoSemarnat,
    status: "effective",
    summary:
      "适用新柴油发动机及 GVW > 3,857 kg 新卡车/客车；表 1B 的 CT/CSE 限值自 2019-01-01 规范文本设定，但因超低硫柴油可用性与 AA 过渡期，按 2021 修订公告记录的 2025-01-01 起全国可执行日建模。",
  },
  {
    ...mexicoRecordTimestamps,
    adoptedOn: "2017-10-19",
    canonicalName:
      "NOM-044-SEMARNAT-2017 Tabla 2B（欧洲/UN-ECE 循环）重型柴油发动机标准",
    citationCode: "NOM-044-SEMARNAT-2017 Tabla 2B",
    dataSourceId: acceptanceFixtureIds.source.mexicoNom044,
    effectiveFrom: "2025-01-01",
    id: acceptanceFixtureIds.regulation.mexicoNom044Table2,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.mexicoSemarnat,
    status: "effective",
    summary:
      "适用新柴油发动机及 GVW > 3,857 kg 新卡车/客车；表 2B 同时列 CEEMAP 与 CETMAP，含 NOx、HC、PM、PN、NH3 限值。B 标准要求 15 mg/kg 超低硫柴油；2021 修订公告将 AA 过渡期延至 2024-12-31。",
  },
  {
    ...turkeyRecordTimestamps,
    adoptedOn: "2013-09-25",
    canonicalName:
      "Ağır Hizmet Araçlarından Çıkan Emisyonlar (Euro 6) Yönetmeliği ((AT) 595/2009)",
    citationCode: "TUR Euro VI HD Diesel",
    dataSourceId: acceptanceFixtureIds.source.turkeyRoadRegulation,
    effectiveFrom: "2016-01-01",
    id: acceptanceFixtureIds.regulation.turkeyRoad2016,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.turkey,
    status: "effective",
    summary:
      "土耳其重型道路车辆 Euro VI 压燃发动机标准；官方附件列出 WHSC/WHTC CI 限值，按合并实施口径自 2016-01-01 建模，卡车与客车共用。",
  },
  {
    ...turkeyRecordTimestamps,
    adoptedOn: "2020-09-11",
    canonicalName:
      "Karayolu Dışında Kullanılan Hareketli Makinalar için Emisyon Sınırları ve Tip Onayı (2016/1628/AB) Stage V",
    citationCode: "TUR NRE Stage V 2016/1628/AB",
    dataSourceId: acceptanceFixtureIds.source.turkeyNonroadAnnex,
    effectiveFrom: "2022-10-01",
    id: acceptanceFixtureIds.regulation.turkeyNonroadStageV,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.turkey,
    status: "effective",
    summary:
      "土耳其 NRE Stage V 非道路移动机械发动机标准；型式批准自 2021-10-01、市场投放自 2022-10-01。官方范围明确排除 AB/167/2013 农林拖拉机发动机，因此本法规只建模 construction scope。",
  },
  {
    ...australiaRecordTimestamps,
    adoptedOn: "2006-12-13",
    canonicalName:
      "Vehicle Standard (Australian Design Rule 80/03 – Emission Control for Heavy Vehicles) 2006",
    citationCode: "ADR 80/03",
    dataSourceId: acceptanceFixtureIds.source.australiaAdr80_03,
    effectiveFrom: "2011-01-01",
    effectiveTo: "2025-11-01",
    id: acceptanceFixtureIds.regulation.australiaAdr80_03,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.australia,
    status: "effective",
    summary:
      "澳大利亚 Euro V 重型道路车辆排放标准。ADR 80/03 对新车型自 2010-01-01、全部车辆自 2011-01-01 实施；ADR 80/04 对新车型自 2024-11-01、全部车辆自 2025-11-01 实施。当前模型没有新车型维度，因此仅发布全车辆覆盖区间 [2011-01-01, 2025-11-01)。柴油 B2 路径必须同时满足 ESC、ELR 与 ETC。",
  },
  {
    ...australiaRecordTimestamps,
    adoptedOn: "2023-02-20",
    canonicalName:
      "Vehicle Standard (Australian Design Rule 80/04 – Emission Control for Heavy Vehicles) 2023",
    citationCode: "ADR 80/04",
    dataSourceId: acceptanceFixtureIds.source.australiaAdr80_04,
    effectiveFrom: "2025-11-01",
    id: acceptanceFixtureIds.regulation.australiaAdr80_04,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.australia,
    status: "effective",
    summary:
      "澳大利亚 Euro VI 等效重型道路车辆标准，适用于 GVM 超过 3,500 kg 的 MA/MB/MC/MD 及全部 ME/NB/NC 类车辆。新车型自 2024-11-01、所有车辆自 2025-11-01 必须符合；当前模型没有新车型维度，因此以 2025-11-01 作为全覆盖边界。Appendix A Table 1 直接列出柴油 CI 的 WHSC/WHTC CO、THC、NOx、NH3、PM 与 PN 完整表；美国 2013+、日本 2017+ 等为替代路径，不累计。",
  },
  {
    ...canadaRecordTimestamps,
    adoptedOn: "2002-12-12",
    canonicalName: "On-Road Vehicle and Engine Emission Regulations (SOR/2003-2)",
    citationCode: "SOR/2003-2",
    dataSourceId: acceptanceFixtureIds.source.canadaRoadRegulation,
    effectiveFrom: "2004-01-01",
    id: acceptanceFixtureIds.regulation.canadaRoad2003,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.canada,
    status: "effective",
    summary:
      "加拿大道路车辆与发动机排放法规；条文第 16(2) 对柴油重型发动机直接引用对应机型年的 40 CFR 86.11；当前道路卡车与客车共用 MY2010+ petroleum-diesel engine-certified HDE 代表路径。",
  },
  {
    ...canadaRecordTimestamps,
    adoptedOn: "2020-12-04",
    canonicalName:
      "Off-road Compression-Ignition (Mobile and Stationary) and Large Spark-Ignition Engine Emission Regulations (SOR/2020-258)",
    citationCode: "SOR/2020-258",
    dataSourceId: acceptanceFixtureIds.source.canadaOffroadRegulation,
    effectiveFrom: "2021-06-04",
    id: acceptanceFixtureIds.regulation.canadaOffroad2020,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.canada,
    status: "effective",
    summary:
      "加拿大现行非道路压燃发动机法规；条文第 10(1)(a) 直接引用 40 CFR 1039.101 的移动发动机排放标准，工程机械与农业装备共用 P≤560 kW variable-speed Tier 4 代表路径。>560 kW 发电机组应用分支、ABT/FEL、NTE、constant-speed、可选 <8 kW PM 与烟度路径不累计。",
  },
  {
    ...unitedKingdomRecordTimestamps,
    adoptedOn: null,
    canonicalName:
      "GB provisional type approval for non-road mobile machinery (Stage V)",
    citationCode: "GB NRMM Stage V",
    dataSourceId: acceptanceFixtureIds.source.unitedKingdomNrmm,
    effectiveFrom: "2023-01-01",
    id: acceptanceFixtureIds.regulation.unitedKingdomNrmmStageV,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.unitedKingdom,
    status: "effective",
    summary:
      "VCA 明确 GB NRMM 发动机须满足 Stage V；2023-01-01 起大不列颠市场要求 provisional GB type approval，基础为有效 EU 或 UNECE R96 型式批准。农业与拖拉机发动机被 NRMM 规则排除，本条目仅适用 construction。",
  },
  {
    ...indiaRecordTimestamps,
    adoptedOn: "2016-09-16",
    canonicalName:
      "Central Motor Vehicles Rules - Bharat Stage VI mass emission standards for heavy M/N vehicles",
    citationCode: "G.S.R. 889(E)",
    dataSourceId: acceptanceFixtureIds.source.indiaBs6,
    effectiveFrom: "2020-04-01",
    id: acceptanceFixtureIds.regulation.indiaBs6,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.india,
    status: "effective",
    summary:
      "适用于总质量超过 3,500 kg、2020-04-01 起制造的 M/N 类车辆；压燃发动机须满足 BS VI 的 WHSC 与 WHTC 限值，卡车与客车共用。",
  },
  {
    ...indiaRecordTimestamps,
    adoptedOn: "2020-09-30",
    canonicalName:
      "Central Motor Vehicles Rule 115A - CEV Stage IV emission standards",
    citationCode: "G.S.R. 598(E) CEV Stage IV",
    dataSourceId: acceptanceFixtureIds.source.indiaCevTrem,
    effectiveFrom: "2021-04-01",
    effectiveTo: "2024-04-01",
    id: acceptanceFixtureIds.regulation.indiaCevStageIv,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.india,
    status: "effective",
    summary:
      "工程机械车辆 CEV-IV，覆盖 37≤P<560 kW；2024-04-01 起由 CEV-V 取代。",
  },
  {
    ...indiaRecordTimestamps,
    adoptedOn: "2020-09-30",
    canonicalName:
      "Central Motor Vehicles Rule 115A - CEV Stage V emission standards",
    citationCode: "G.S.R. 598(E) CEV Stage V",
    dataSourceId: acceptanceFixtureIds.source.indiaCevTrem,
    effectiveFrom: "2024-04-01",
    id: acceptanceFixtureIds.regulation.indiaCevStageV,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.india,
    status: "effective",
    summary:
      "工程机械车辆 CEV-V，覆盖全部功率带；原表明确自 2024-04-01 生效，按 NRSC/NRTC 适用条件记录。",
  },
  {
    ...indiaRecordTimestamps,
    adoptedOn: "2022-11-24",
    canonicalName:
      "Central Motor Vehicles Rule 115A - TREM Stage IV emission standards",
    citationCode: "G.S.R. 850(E) / G.S.R. 598(E) TREM Stage IV",
    dataSourceId: acceptanceFixtureIds.source.indiaTremIvExtension,
    effectiveFrom: "2023-01-01",
    effectiveTo: "2026-04-01",
    id: acceptanceFixtureIds.regulation.indiaTremStageIv,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.india,
    status: "effective",
    summary:
      "农业拖拉机、动力耕耘机和联合收割机 TREM-IV，覆盖 37≤P<560 kW；G.S.R. 850(E) 将实施日最终延至 2023-01-01，2026-04-01 起由现行 TREM-V 取代。",
  },
  {
    ...indiaRecordTimestamps,
    adoptedOn: "2024-02-27",
    canonicalName:
      "Central Motor Vehicles Rule 115A - TREM Stage V emission standards",
    citationCode: "G.S.R. 141(E) / G.S.R. 598(E) TREM Stage V",
    dataSourceId: acceptanceFixtureIds.source.indiaTremVExtension,
    effectiveFrom: "2026-04-01",
    id: acceptanceFixtureIds.regulation.indiaTremStageV,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.india,
    status: "effective",
    summary:
      "现行 TREM-V 于 G.S.R. 141(E) 延期后自 2026-04-01 生效；2026 年 G.S.R. 151(E) 分功率带调整仍为草案，尚不改变本条 effective 状态。",
  },
  {
    ...indiaRecordTimestamps,
    adoptedOn: null,
    canonicalName:
      "Draft power-band-specific TREM emission implementation schedule",
    citationCode: "G.S.R. 151(E) (Draft)",
    dataSourceId: acceptanceFixtureIds.source.indiaTrem2026Draft,
    effectiveFrom: null,
    id: acceptanceFixtureIds.regulation.indiaTrem2026Draft,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.india,
    proposedOn: "2026-02-27",
    status: "proposed",
    summary:
      "拟按功率带设置 2026-10-01、2028-04-01 与 2032-04-01 等实施日；截至 2026-08-07 未在 MoRTH 公报目录发现最终规则，不得作为 effective 返回。",
  },
  {
    ...russiaRecordTimestamps,
    adoptedOn: "2011-12-09",
    canonicalName:
      "TR CU 018/2011 ecological class 5 requirements for heavy-duty wheeled vehicles",
    citationCode: "TR CU 018/2011 Class 5",
    dataSourceId: acceptanceFixtureIds.source.russiaRoadRegulation,
    effectiveFrom: "2019-01-01",
    id: acceptanceFixtureIds.regulation.russiaRoadClass5,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.russia,
    status: "effective",
    summary:
      "M2/M3/N 类重型柴油道路车辆按 TR CU 018/2011 附件 1、附件 2 的生态等级 5 执行 UN R49-05 B2/C；新车型自 2018-01-01 切换，本库以所有既有车型完成切换的 2019-01-01 为保守生效日。俄罗斯第 855 号国内简化规则中的排放技术表已于 2025-06-30 失效；特殊国家程序不扩展为通用限值。",
  },
  {
    ...russiaRecordTimestamps,
    adoptedOn: "2024-04-12",
    canonicalName:
      "TR CU 031/2012 ecological class 3A compression-ignition tractor engine requirements",
    citationCode: "TR CU 031/2012 Class 3A",
    dataSourceId: acceptanceFixtureIds.source.russiaAgricultureAmendment2024,
    effectiveFrom: "2025-01-01",
    id: acceptanceFixtureIds.regulation.russiaAgricultureClass3A,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.russia,
    status: "effective",
    summary:
      "EEC Council Decision 127/2021 重写 TR CU 031/2012 附件 5 第 14 条与表 5.1；Decision 32/2024 将 J/K 功率等级切换日定为 2025-01-01，将 H/I 定为 2025-10-01。仅适用农业和林业拖拉机；construction 不据此推定。",
  },
  {
    ...kazakhstanRecordTimestamps,
    adoptedOn: "2011-12-09",
    canonicalName:
      "Kazakhstan TR CU 018/2011 ecological class 5 requirements for heavy-duty wheeled vehicles",
    citationCode: "KAZ TR CU 018/2011 Class 5",
    dataSourceId: acceptanceFixtureIds.source.kazakhstanRoadRegulation,
    effectiveFrom: "2019-01-01",
    id: acceptanceFixtureIds.regulation.kazakhstanRoadClass5,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.kazakhstan,
    status: "effective",
    summary:
      "TR CU 018/2011 Annex 2 item 39 requires UN R49-05 B2/C for ecological class 5 heavy-duty M/N vehicles. This fixture publishes only the complete B2 compression-ignition path from 2019-01-01; C/EEV is an equivalent alternative and is described, not accumulated. Construction and agricultural machinery are not inferred from this road rule.",
  },
  {
    ...kazakhstanRecordTimestamps,
    adoptedOn: "2024-04-12",
    canonicalName:
      "Kazakhstan TR CU 031/2012 Stage IIIA requirements for agricultural and forestry tractor engines",
    citationCode: "KAZ TR CU 031/2012 Stage IIIA",
    dataSourceId: acceptanceFixtureIds.source.kazakhstanAgricultureRegulation,
    effectiveFrom: "2025-01-01",
    id: acceptanceFixtureIds.regulation.kazakhstanAgricultureStageIIIA,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.kazakhstan,
    status: "effective",
    summary:
      "TR CU 031/2012 Annex 5 clause 14.1 and Table 5.1, as amended by EEC Decisions 127/2021 and 32/2024, establish Stage IIIA bands for 19<P≤560 kW. J/K begin 2025-01-01 and H/I begin 2025-10-01. Only agriculture is published; construction remains no-data.",
  },
  {
    ...kyrgyzstanRecordTimestamps,
    adoptedOn: "2011-12-09",
    canonicalName:
      "Kyrgyzstan TR CU 018/2011 ecological class 5 requirements for heavy-duty wheeled vehicles",
    citationCode: "KGZ TR CU 018/2011 Class 5",
    dataSourceId: acceptanceFixtureIds.source.kyrgyzstanRoadImplementation,
    effectiveFrom: "2019-01-01",
    id: acceptanceFixtureIds.regulation.kyrgyzstanRoadClass5,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.kyrgyzstan,
    status: "effective",
    summary:
      "Kyrgyzstan's official TR CU 018/2011 implementation notice and Annex 2 item 39 establish the UN R49-05 B2/C ecological class 5 path. This fixture uses the conservative full-fleet 2019-01-01 date and publishes only B2; C/EEV is an alternative, not an additional cumulative limit path. Non-road scopes are not inferred.",
  },
  {
    ...kyrgyzstanRecordTimestamps,
    adoptedOn: "2024-04-12",
    canonicalName:
      "Kyrgyzstan TR CU 031/2012 Stage IIIA requirements for agricultural and forestry tractor engines",
    citationCode: "KGZ TR CU 031/2012 Stage IIIA",
    dataSourceId: acceptanceFixtureIds.source.kyrgyzstanAgricultureRegulation,
    effectiveFrom: "2025-01-01",
    id: acceptanceFixtureIds.regulation.kyrgyzstanAgricultureStageIIIA,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.kyrgyzstan,
    status: "effective",
    summary:
      "TR CU 031/2012 Annex 5 clause 14.1 and Table 5.1, as amended by EEC Decisions 127/2021 and 32/2024, establish Stage IIIA bands for 19<P≤560 kW. J/K begin 2025-01-01 and H/I begin 2025-10-01. Only agriculture is published; construction remains no-data.",
  },
  {
    ...uzbekistanRecordTimestamps,
    adoptedOn: "2025-01-11",
    canonicalName:
      "UzTR.10-006:2025 Stage IIIA requirements for agricultural and forestry vehicle engines",
    citationCode: "UzTR.10-006:2025 Stage IIIA",
    dataSourceId: acceptanceFixtureIds.source.uzbekistanAgricultureRegulation,
    effectiveFrom: "2025-10-01",
    id: acceptanceFixtureIds.regulation.uzbekistanAgricultureStageIIIA,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.uzbekistan,
    status: "effective",
    summary:
      "UzTR.10-006:2025 applies Stage IIIA to the verified H band (130≤P≤560 kW) from 2025-10-01. The 2025-09-13 through 2025-09-30 Stage II transition and future Stage V path with no fixed implementation date are documented but are not accumulated as current limits. Road and construction remain no-data.",
  },
  {
    ...armeniaRecordTimestamps,
    adoptedOn: "2011-12-09",
    canonicalName:
      "Armenia TR CU 018/2011 ecological class 5 requirements for heavy-duty wheeled vehicles",
    citationCode: "ARM TR CU 018/2011 Class 5",
    dataSourceId: acceptanceFixtureIds.source.armeniaTrCu018Consolidated,
    effectiveFrom: "2019-01-01",
    id: acceptanceFixtureIds.regulation.armeniaRoadClass5,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.armenia,
    status: "effective",
    summary:
      "TR CU 018/2011 Annex 2 item 39 requires the UN R49-05 B2/C path for ecological-class-5 heavy-duty M/N vehicles. This fixture uses the conservative full-fleet 2019-01-01 date and publishes one complete B2 compression-ignition path; C/EEV and the permitted ETC THC substitution are alternatives, not cumulative limits.",
  },
  {
    ...armeniaRecordTimestamps,
    adoptedOn: "2024-04-12",
    canonicalName:
      "Armenia TR CU 031/2012 Stage IIIA requirements for agricultural and forestry tractor engines",
    citationCode: "ARM TR CU 031/2012 Stage IIIA",
    dataSourceId: acceptanceFixtureIds.source.armeniaTrCu031Consolidated,
    effectiveFrom: "2025-01-01",
    id: acceptanceFixtureIds.regulation.armeniaAgricultureStageIIIA,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.armenia,
    status: "effective",
    summary:
      "TR CU 031/2012 Annex 5 clause 14.1 and Table 5.1, as amended by EEC Decisions 127/2021 and 32/2024, establish Stage IIIA bands for 19<P≤560 kW. J/K begin 2025-01-01 and H/I begin 2025-10-01. The small-size tractor exclusion also depends on intended purpose and is not modeled as a power-only exception; construction remains no-data.",
  },
  {
    ...belarusRecordTimestamps,
    adoptedOn: "2011-12-09",
    canonicalName:
      "Belarus TR CU 018/2011 ecological class 5 requirements for heavy-duty wheeled vehicles",
    citationCode: "BLR TR CU 018/2011 Class 5",
    dataSourceId: acceptanceFixtureIds.source.belarusTrCu018,
    effectiveFrom: "2019-01-01",
    id: acceptanceFixtureIds.regulation.belarusRoadClass5,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.belarus,
    status: "effective",
    summary:
      "TR CU 018/2011 Annex 2 item 39 requires the UN R49-05 B2/C path for ecological-class-5 heavy-duty M/N vehicles. This fixture uses the conservative full-fleet 2019-01-01 date and publishes one complete B2 compression-ignition path; C/EEV and the permitted ETC THC substitution are alternatives, not cumulative limits.",
  },
  {
    ...belarusRecordTimestamps,
    adoptedOn: "2024-04-12",
    canonicalName:
      "Belarus TR CU 031/2012 Stage IIIA requirements for agricultural and forestry tractor engines",
    citationCode: "BLR TR CU 031/2012 Stage IIIA",
    dataSourceId: acceptanceFixtureIds.source.belarusTrCu031,
    effectiveFrom: "2025-01-01",
    id: acceptanceFixtureIds.regulation.belarusAgricultureStageIIIA,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.belarus,
    status: "effective",
    summary:
      "TR CU 031/2012 Annex 5 clause 14.1 and Table 5.1, as amended by EEC Decisions 127/2021 and 32/2024, establish Stage IIIA bands for 19<P≤560 kW. J/K begin 2025-01-01 and H/I begin 2025-10-01. The small-size tractor exclusion also depends on intended purpose and is not modeled as a power-only exception; construction remains no-data.",
  },
  {
    ...georgiaRecordTimestamps,
    adoptedOn: "2023-06-28",
    canonicalName:
      "Georgia Resolution No. 238 ecological class 5 requirements for N3 and M3 diesel vehicles",
    citationCode: "Georgia Resolution No. 238 publication 12",
    dataSourceId: acceptanceFixtureIds.source.georgiaResolution238,
    effectiveFrom: "2025-01-01",
    id: acceptanceFixtureIds.regulation.georgiaRoadClass5,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.georgia,
    status: "effective",
    summary:
      "Current Matsne publication 12 applies the UN R49-05 B2/C heavy-duty diesel route from 2025-01-01 to new N3 trucks and M3 buses. This fixture publishes B2 only, maps the statutory steady-state, load-response and transient tests to ESC, ELR and ETC, and does not extend the rule to older >2,610 kg categories, diesel CH4 or PN.",
  },
  {
    ...bangladeshRecordTimestamps,
    adoptedOn: "2022-07-26",
    canonicalName:
      "Bangladesh Air Pollution (Control) Rules 2022 new heavy-duty diesel vehicle limits",
    citationCode:
      "Air Pollution (Control) Rules 2022, Schedule 2, item 1(b)",
    dataSourceId: acceptanceFixtureIds.source.bangladeshAirPollutionRules2022,
    effectiveFrom: "2022-07-26",
    id: acceptanceFixtureIds.regulation.bangladeshHeavyDiesel2022,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.bangladesh,
    status: "effective",
    summary:
      "Schedule 2 applies immediately from Gazette publication to new compression-ignition heavy-duty vehicles above 3,500 kg gross vehicle weight. It publishes CO 4.0, HC 1.1, NOx 7.0 and PM 0.15 g/kWh under the 88/77/EEC pathway as amended by 91/542/EEC. This fixture applies the table to heavy road trucks and buses only; the Rules do not establish a construction- or agricultural-engine category.",
  },
  {
    ...boliviaRecordTimestamps,
    adoptedOn: "2022-04-01",
    canonicalName:
      "Bolivia RM 064/2022 heavy diesel vehicle ECE 49 representative pathway",
    citationCode: "Resolución Ministerial N° 064/2022, Annex III, Table 4",
    dataSourceId: acceptanceFixtureIds.source.boliviaRm064Regulation,
    effectiveFrom: "2022-04-01",
    id: acceptanceFixtureIds.regulation.boliviaRm064HeavyDiesel,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.bolivia,
    status: "effective",
    summary:
      "RM 064/2022 repeals RM 450/2017 and republishes the prior-authorization conformity framework. Annex III Table 4 applies the ECE 49 route to model-year 2017 and later N2/N3/M2/M3 diesel vehicles above 3,500 kg, with CO 4.0, HC 1.1, NOx 7.0 and PM 0.15 g/kWh. The US heavy-duty transient table is an alternative route and is not accumulated. The tariff annex's narrow off-highway dumper entry does not establish a general construction-engine class, so construction and agriculture remain no-data.",
  },
  {
    ...ecuadorRecordTimestamps,
    adoptedOn: "2008-07-21",
    canonicalName:
      "Ecuador RTE INEN 017:2008 / NTE INEN 2207(1R):2002 heavy-duty diesel ECE-49 representative pathway",
    citationCode: "RTE INEN 017:2008 / NTE INEN 2207(1R):2002",
    dataSourceId: acceptanceFixtureIds.source.ecuadorRte017,
    effectiveFrom: "2009-02-07",
    id: acceptanceFixtureIds.regulation.ecuadorHeavyDieselRte017,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.ecuador,
    status: "effective",
    summary:
      "RTE INEN 017 sections 5.2 and 6.2(b) make NTE INEN 2207's diesel-vehicle tests mandatory before imported or domestically assembled vehicles enter circulation. NTE 2207 Table 2 applies the ECE-49 row to N2/N3/M2/M3 vehicles above 3,500 kg and publishes CO, HC, NOx and PM in g/kWh. This fixture publishes that European representative route only; the US heavy-duty transient table and supplemental opacity test are alternatives or additional checks and are not accumulated. RTE section 2.3 expressly excludes agricultural machinery, construction equipment and industrial equipment, so both non-road scopes remain no-data. The 2025 third amendment changed administration and certificate handling, not this incorporated emissions table.",
  },
  {
    ...philippinesRecordTimestamps,
    adoptedOn: "2015-05-28",
    canonicalName:
      "Philippines DAO 2015-04 / LTO MC AVT-2015-1946 Euro IV new heavy-duty vehicle representative pathway",
    citationCode:
      "DAO 2015-04; LTO MC AVT-2015-1946; UN Regulation No. 49-04",
    dataSourceId: acceptanceFixtureIds.source.philippinesLtoMc20151946,
    effectiveFrom: "2016-01-01",
    id: acceptanceFixtureIds.regulation.philippinesHeavyDieselEuroIv,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.philippines,
    status: "effective",
    summary:
      "LTO MC AVT-2015-1946 requires Euro 4/IV for all new vehicles introduced in the Philippines from 2016-01-01. The DENR-EMB implementation table publishes the heavy-duty compression-ignition Euro IV values by engine energy output, while a current government procurement notice confirms that DAO 2015-04 certificates of conformity use UN R49-04. This fixture publishes the complete compression-ignition B1 ESC, ELR and ETC path incorporated by that reference; R83 remains an alternative for eligible lighter-reference-mass M2/N2 vehicles and is not accumulated. The verified national materials do not establish corresponding construction- or agricultural-engine classes, so both non-road scopes remain no-data.",
  },
  {
    ...rwandaRecordTimestamps,
    adoptedOn: "2023-01-23",
    canonicalName:
      "Rwanda RS EAS 1047:2022 Euro IV new heavy-duty road-vehicle representative pathway",
    citationCode:
      "Ministerial Order No. 02/2018; RS EAS 1047:2022, Official Gazette No. 04 of 23/01/2023; UN R49-04",
    dataSourceId: acceptanceFixtureIds.source.rwandaEas1047Implementation,
    effectiveFrom: "2023-01-23",
    id: acceptanceFixtureIds.regulation.rwandaRoadEuroIv,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.rwanda,
    status: "effective",
    summary:
      "Ministerial Order No. 02/2018 requires the standards body to establish air-pollutant emission standards. Rwanda Standards Board's Official Gazette No. 04 of 23/01/2023 replaces RS 407-1:2019 with RS EAS 1047:2022 for vehicular exhaust emission limits. The verified EAS 1047 implementation material requires Euro IV type approval for new heavy-duty M2/M3/N2/N3 diesel road vehicles. This fixture publishes the complete UN R49-04 compression-ignition B1 ESC, ELR and ETC pathway for trucks and buses; alternative type-approval routes are not cumulative. The national chain does not establish a corresponding new construction- or agricultural-engine class, so both non-road scopes remain no-data.",
  },
  {
    ...pakistanRecordTimestamps,
    adoptedOn: "2009-05-16",
    canonicalName:
      "Pakistan S.R.O. 72(KE)/2009 Pak-II heavy-duty diesel engine and truck/bus standards",
    citationCode: "S.R.O. 72(KE)/2009, Annex III(b)",
    dataSourceId: acceptanceFixtureIds.source.pakistanSro72OfficialIndex,
    effectiveFrom: "2012-07-01",
    id: acceptanceFixtureIds.regulation.pakistanHeavyDieselPakIi,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.pakistan,
    status: "effective",
    summary:
      "S.R.O. 72(KE)/2009 Annex III(b) establishes Pak-II limits for heavy-duty diesel engines in trucks and buses and specifies ECE-R-49 as the measuring method. The table applies from 2012-07-01 to all imported and locally manufactured diesel vehicles. This fixture publishes the four listed g/kWh values to both road scopes without inventing a power band. The separate large-goods-vehicle line is not accumulated because its scan columns are ambiguous and the heavy-engine row already directly covers trucks and buses. No corresponding construction- or agricultural-engine table and implementation chain was verified, so both non-road scopes remain no-data.",
  },
  {
    ...israelRecordTimestamps,
    adoptedOn: null,
    canonicalName:
      "Israel IMR 2026 EU-WVTA Euro VI heavy-duty road representative pathway",
    citationCode: "Israel IMR CY2026 / EU 2018/858 Annex II item 41A",
    dataSourceId: acceptanceFixtureIds.source.israelRoadImr2026,
    effectiveFrom: "2026-01-01",
    id: acceptanceFixtureIds.regulation.israelRoadEuroVi2026,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.israel,
    status: "effective",
    summary:
      "Israel's CY2026 road IMR is the statutory import document for M/N vehicles and requires the current EU WVTA regulatory acts, including the Euro VI heavy-duty path under Regulation 595/2009. It defines M2/M3 buses and N2/N3 goods vehicles; the incorporated heavy-duty regulation covers all M3/N3 and M2/N2 above 2,610 kg reference mass. This fixture normalizes the current calendar-year snapshot to 2026-01-01 and publishes the EU compression-ignition WHSC/WHTC representative route. European, ECE, US and Canadian certification frameworks are alternatives and are not accumulated; this date is not claimed as Israel's historical first Euro VI adoption.",
  },
  {
    ...israelRecordTimestamps,
    adoptedOn: null,
    canonicalName:
      "Israel IMR 2026 construction and earthmoving machinery Stage V new-model pathway",
    citationCode: "Israel NRMM IMR CY2026 / EU 2016/1628",
    dataSourceId: acceptanceFixtureIds.source.israelNrmmImr2026,
    effectiveFrom: "2026-01-01",
    id: acceptanceFixtureIds.regulation.israelConstructionStageV2026,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.israel,
    status: "effective",
    summary:
      "Israel's CY2026 NRMM IMR is the statutory import document for new-model construction machinery under EN 500 and earthmoving machinery under EN 474. It requires the most recent EU 2016/1628 Stage V requirements and timetable, with US federal standards accepted only as an alternative for eligible NAFTA-produced and marketed machinery. This fixture uses 2026-01-01 as the current calendar-year snapshot boundary and publishes the EU NRE variable-speed representative power bands with the applicable NRSC/NRTC cycles. The closed Israeli category list does not include agricultural or forestry machinery, so agriculture remains no-data.",
  },
  {
    ...saudiArabiaRecordTimestamps,
    adoptedOn: null,
    canonicalName:
      "Saudi Arabia model-year 2026 Euro V heavy-duty diesel representative pathway",
    citationCode:
      "GSO List of Technical Regulations for Motor Vehicles, MY2026-D4, pages 7 and 12",
    dataSourceId:
      acceptanceFixtureIds.source.saudiVehicle2026TechnicalRegulations,
    effectiveFrom: "2026-01-01",
    id: acceptanceFixtureIds.regulation.saudiHeavyVehicleEuroVMy2026,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.saudiArabia,
    status: "effective",
    summary:
      "The GSO Conformity Assessment Department's 2026-model-year technical-regulation list states that Saudi diesel motor vehicles must meet Euro V and its Saudi annex identifies ECE 49, heavy-duty vehicles and diesel engines. Because the source expresses a model year rather than a calendar commencement date, this fixture normalizes MY2026 to 2026-01-01 and preserves that caveat in every limit basis. It publishes the UN R49-05 B2 compression-ignition ESC/ELR/ETC representative route; the permitted ETC THC substitution and other conformity routes are alternatives and are not accumulated. The Saudi mobile-machinery regulation does not publish a corresponding exhaust table, so construction and agriculture remain no-data.",
  },
  {
    ...unitedArabEmiratesRecordTimestamps,
    adoptedOn: null,
    canonicalName:
      "United Arab Emirates Euro VI/B heavy-vehicle new-model emission requirements",
    citationCode:
      "MOIAT Implementation guideline for the new emission limits, section 3",
    dataSourceId: acceptanceFixtureIds.source.uaeVehicleEmissionGuide,
    effectiveFrom: "2026-01-01",
    id: acceptanceFixtureIds.regulation.uaeHeavyVehicleEuro6B,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.unitedArabEmirates,
    status: "effective",
    summary:
      "The MOIAT implementation guide requires newly introduced light and heavy vehicle models imported for first registration from 2026-01-01 to meet at least Euro 6B. From 2027-07-01 the requirement expands to all imported light and heavy vehicles. Its heavy-vehicle section covers reference mass above 2,610 kg, gives the complete compression-ignition WHSC/WHTC table, requires UN R49.06:2013 or EU 582/2011 testing, and also requires NTE plus PEMS off-cycle conformity. Because the query model has no new-model or first-registration dimension, numeric rows use the 2027-07-01 full-import boundary; 2026 remains regulation metadata only. Construction and agricultural machinery are not inferred.",
  },
  {
    ...southAfricaRecordTimestamps,
    adoptedOn: "2015-09-18",
    canonicalName:
      "South Africa SANS 20049:2004 / ECE R49.02B representative pathway for category N2/N3 and M2/M3 vehicles",
    citationCode:
      "Government Notices 611 and 613 of 2015, clause 4.2.2.1 and Schedule 1",
    dataSourceId: acceptanceFixtureIds.source.southAfricaMotorVehiclesN23,
    effectiveFrom: "2010-01-01",
    id: acceptanceFixtureIds.regulation.southAfricaR4902B,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.southAfrica,
    status: "effective",
    summary:
      "The N2/N3 and M2/M3 compulsory specifications require each new road-vehicle type to meet at least one listed emissions pathway. Their schedules record SANS 20049:2004 at ECE R49.02B as operative from 2006-01-01, with the manufacture/import exclusion for models homologated before that date ending on 2010-01-01 and the remaining sale exclusion ending on 2011-07-01. Because the query model has no prior-homologation dimension, this fixture uses 2010-01-01 as the full manufacture/import boundary and publishes only the SANS/ECE representative path. The US 1998, Japanese 1998, ADR 80/00 and R83.04 routes are alternatives and are not accumulated. Construction and agricultural machinery are outside the M2/M3/N2/N3 road specifications and remain no-data.",
  },
  {
    ...indonesiaRecordTimestamps,
    adoptedOn: "2017-03-10",
    canonicalName:
      "P.20/MENLHK/SETJEN/KUM.1/3/2017 new-type M, N and O vehicle Euro 4 emission standards",
    citationCode: "P.20/MENLHK/SETJEN/KUM.1/3/2017",
    dataSourceId: acceptanceFixtureIds.source.indonesiaEuro4,
    effectiveFrom: "2022-04-01",
    id: acceptanceFixtureIds.regulation.indonesiaEuro4,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.indonesia,
    status: "effective",
    summary:
      "印尼 KLHK P.20/2017 对新型 M/N/O 类车辆建立 Euro 4 排放质量标准；本模型以 2022-04-01 柴油道路车辆全国执行节点作为重型柴油车可查询起点。非道路工程机械与农业装备不在该文书 scope 内，保持 no-data。",
  },
  {
    ...vietnamRecordTimestamps,
    adoptedOn: "2021-04-06",
    canonicalName:
      "QCVN 109:2021/BGTVT Level 5 emissions for newly manufactured, assembled and imported automobiles",
    citationCode: "QCVN 109:2021/BGTVT",
    dataSourceId: acceptanceFixtureIds.source.vietnamQcvn109,
    effectiveFrom: "2022-01-01",
    id: acceptanceFixtureIds.regulation.vietnamLevel5,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.vietnam,
    status: "effective",
    summary:
      "越南 Decision 49/2011/QD-TTg 与 Circular 06/2021/TT-BGTVT 自 2022-01-01 对新生产、组装和进口汽车实施 Level 5。QCVN 109 的重型压燃发动机表 4/5规定 ESC、ELR、ETC 限值；为非道路地形和非道路道路条件设计的车辆被明确排除，construction/agriculture 保持 no-data。",
  },
  {
    ...malaysiaRecordTimestamps,
    adoptedOn: "1996-07-25",
    canonicalName:
      "Malaysia DOE VTA Euro II standards for heavy-duty diesel road vehicles under P.U.(A) 429/96",
    citationCode: "P.U.(A) 429/96 / VTA Euro II",
    dataSourceId: acceptanceFixtureIds.source.malaysiaVtaGuideline,
    effectiveFrom: "2017-01-01",
    id: acceptanceFixtureIds.regulation.malaysiaEuro2,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.malaysia,
    status: "effective",
    summary:
      "马来西亚 DOE 现行公开 VTA 指南对 M>3.5 t、N2/N3 重型柴油道路车辆自 2017-01-01 执行 UN R49-02(B) Euro II 13-mode 限值。指南中的 Euro IV 日期标为 tentative，不作为 effective；P.U.(A) 429/96 regulation 5 只适用于道路车辆，construction/agriculture 保持 no-data。",
  },
  {
    ...argentinaRecordTimestamps,
    adoptedOn: null,
    canonicalName:
      "Argentina heavy-duty vehicle Euro V limits under Resolución 1464/2014 and Directive 2005/55/EC B2",
    citationCode: "Resolución 1464/2014 / Directive 2005/55 B2",
    dataSourceId: acceptanceFixtureIds.source.argentinaResolution1464,
    effectiveFrom: "2018-01-01",
    id: acceptanceFixtureIds.regulation.argentinaEuroV,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.argentina,
    status: "effective",
    summary:
      "阿根廷 Resolution 1464/2014 规定重型 M2/M3/N1/N2/N3 车辆自 2016-01-01（新车型）及 2018-01-01（全部重型车辆和发动机）执行 Directive 2005/55 的 B2/Euro V 阶段。本库以 2018-01-01 作为无车型年字段时的普通市场可查询起点；2018 Resolution 128 的 Ejército Argentino 军用例外不改变普通市场基线，非道路 scope 不在本法规范围内。",
  },
  {
    ...newZealandRecordTimestamps,
    adoptedOn: null,
    canonicalName:
      "New Zealand heavy-vehicle entry emissions requirements under Land Transport Rule 33001 Table 2B",
    citationCode: "Land Transport Rule 33001 Table 2B / Euro VI Step C",
    dataSourceId: acceptanceFixtureIds.source.newZealandVehicleExhaustRule,
    effectiveFrom: "2025-11-01",
    id: acceptanceFixtureIds.regulation.newZealandEuroVi,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.newZealand,
    status: "effective",
    summary:
      "NZTA Rule 33001 Schedule 1 Table 2B 自 2025-11-01 对进入道路服务认证的新旧 MD3/MD4/ME/NB/NC 重型车辆统一接受 Euro VI Step C、US Tier 3、US 2013、Japan 2016、ADR 80/04、UNR49/06(Supp.4) 或 UNR83/07 替代路径。本库在缺少新旧车/车型维度时只建模该统一日期后的 Euro VI Step C 代表路径，各替代标准不是累计要求；2.1(2)(b) 明确排除 tractors，construction/agriculture 不从道路规则外推。",
  },
  {
    ...chileRecordTimestamps,
    adoptedOn: "2023-12-07",
    canonicalName:
      "Chile D.S. 55/1994 article 8 quater heavy-duty Euro VI emission pathway under D.S. 50/2023",
    citationCode: "D.S. 55/1994 art. 8 quater / D.S. 50/2023",
    dataSourceId: acceptanceFixtureIds.source.chileHeavyVehicleDecree50,
    effectiveFrom: "2026-01-06",
    id: acceptanceFixtureIds.regulation.chileHeavyVehicleEuroVi,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.chile,
    status: "effective",
    summary:
      "D.S. 50/2023 将 article 8 quater 加入重型道路车辆 D.S. 55/1994；LeyChile 现行版本自 2026-01-06 起对首次登记且 GVW >= 3,860 kg 的卡车和客车在全国实施。车辆可采用 Table 1 US-EPA 或 Table 3 Euro VI 路径，本库只建模压燃机 Euro VI WHSC/WHTC 代表路径，替代路径不是累计要求。",
  },
  {
    ...chileRecordTimestamps,
    adoptedOn: "2020-12-23",
    canonicalName:
      "Chile D.S. 39/2020 Table 2 mobile-machinery Stage V emission limits",
    citationCode: "D.S. 39/2020 art. 3 Table 2",
    dataSourceId: acceptanceFixtureIds.source.chileMobileMachineryDecree39,
    effectiveFrom: "2023-10-21",
    id: acceptanceFixtureIds.regulation.chileMobileMachineryStageV,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.chile,
    status: "effective",
    summary:
      "D.S. 39/2020 自发布满 24 个月起全国适用于进口的 19–560 kW 压燃式移动机械。本库以 Table 2（EU 2016/1628 Stage V）作为 construction 代表路径；Table 1 US 40 CFR 1039 是替代认证路径，不与 Table 2 叠加。D.S. 33/2024 明确排除除拖拉机外的农业机械。",
  },
  {
    ...chileRecordTimestamps,
    adoptedOn: "2024-10-11",
    canonicalName:
      "Chile tractor mobile-machinery emission limits under amended D.S. 39/2020",
    citationCode: "D.S. 39/2020 art. 3 / D.S. 33/2024",
    dataSourceId: acceptanceFixtureIds.source.chileTractorAmendmentDecree33,
    effectiveFrom: "2030-01-01",
    id: acceptanceFixtureIds.regulation.chileTractorStageV,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.chile,
    status: "adopted",
    summary:
      "D.S. 33/2024 将 D.S. 39/2020 的拖拉机适用日由 2024-10-21 延至 2030-01-01，并把其他农业机械明确排除。本记录仅表示已通过但尚未适用的 tractor 要求；到期前不得作为 effective 返回，且不得外推到所有农业机械。",
  },
  {
    ...colombiaRecordTimestamps,
    adoptedOn: "2022-07-18",
    canonicalName:
      "Colombia Resolucion 0762/2022 Table 22 heavy-duty compression-ignition vehicle emission limits",
    citationCode: "Resolucion 0762/2022 art. 18 Table 22",
    dataSourceId: acceptanceFixtureIds.source.colombiaResolution762,
    effectiveFrom: "2023-01-01",
    id: acceptanceFixtureIds.regulation.colombiaHeavyVehicleEuroVi,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.colombia,
    status: "effective",
    summary:
      "Resolucion 0762/2022 article 18 自 2023-01-01 对在哥伦比亚制造、组装或进口的 M2/M3/N2/N3 压燃式重型道路车辆实施 Table 22 WHSC/WHTC 限值；EPA10 或更高标准是等效替代路径。本库只建模 Table 22 代表路径，不与 EPA 路径累计。",
  },
  {
    ...colombiaRecordTimestamps,
    adoptedOn: "2022-07-18",
    canonicalName:
      "Colombia Resolucion 0762/2022 Table 23 non-road compression-ignition engine emission limits",
    citationCode: "Resolucion 0762/2022 art. 19 Table 23",
    dataSourceId: acceptanceFixtureIds.source.colombiaResolution762,
    effectiveFrom: "2024-07-18",
    id: acceptanceFixtureIds.regulation.colombiaNonRoadTable23,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.colombia,
    status: "effective",
    summary:
      "Resolucion 0762/2022 article 19 自法规发布满 24 个月的 2024-07-18 起，对在哥伦比亚制造、组装或进口的 19–560 kW 柴油非道路移动源实施 Table 23 EU 或 Table 24 US 替代路径。本库只建模 Table 23 EU 代表路径；article 3(c) 明确排除专用于农业作业的非道路移动源。",
  },
  {
    ...peruRecordTimestamps,
    adoptedOn: "2021-10-15",
    canonicalName:
      "Peru D.S. 010-2017-MINAM annex I.7 heavy-duty Euro VI/A limits as amended by D.S. 029-2021-MINAM",
    citationCode:
      "D.S. 010-2017-MINAM annex I.7 / D.S. 029-2021-MINAM",
    dataSourceId: acceptanceFixtureIds.source.peruDecree029,
    effectiveFrom: "2024-10-01",
    id: acceptanceFixtureIds.regulation.peruHeavyVehicleEuroVi,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.peru,
    status: "effective",
    summary:
      "D.S. 029-2021-MINAM article 2 与第一项最终补充规定，自 2024-10-01 对纳入秘鲁国家道路运输系统、PBV > 3.5 t 的压燃式客货车辆实施 annex I.7 Euro VI/A WHSC/WHTC 限值；annex I.9.1 另列 EPA 2010 路径。本库只建模 Euro VI/A 代表路径，不与 EPA 2010 累计；construction/agriculture 不从道路车辆规则外推。",
  },
  {
    ...singaporeRecordTimestamps,
    adoptedOn: "2017-08-29",
    canonicalName:
      "Singapore heavy-duty diesel vehicle Euro VI pathway under S 480/2017",
    citationCode:
      "S 480/2017 / EPMA Vehicular Emissions Regulations Second Schedule",
    dataSourceId: acceptanceFixtureIds.source.singaporeVehicularAmendment2017,
    effectiveFrom: "2018-01-01",
    id: acceptanceFixtureIds.regulation.singaporeHeavyVehicleEuroVi,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.singapore,
    status: "effective",
    summary:
      "S 480/2017 自 2018-01-01 对 GVW > 3.5 t 的新重型柴油道路车辆接受 Regulation (EC) No 595/2009 Annex I（经 582/2011 修订）的 Euro VI 路径，也允许日本 PPNLT 等替代路径。本库只建模 Euro VI WHSC/WHTC 代表路径，替代认证不得累计。",
  },
  {
    ...singaporeRecordTimestamps,
    adoptedOn: "2012-06-22",
    canonicalName:
      "Singapore Off-Road Diesel Engine Emissions Regulations 2012 EU Stage II pathway",
    citationCode: "S 299/2012 reg. 6 Schedule",
    dataSourceId: acceptanceFixtureIds.source.singaporeOffRoad2012,
    effectiveFrom: "2012-07-01",
    id: acceptanceFixtureIds.regulation.singaporeOffRoadStageIi,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.singapore,
    status: "effective",
    summary:
      "S 299/2012 自 2012-07-01 对作为 industrial plant 或安装在 industrial plant 中的 18–560 kW 非道路柴油机要求预先批准，并接受 US Tier II、EU Stage II 或 Japan Tier I 任一路径。本库以 NEA 明列的 excavator/crane 等工程设备映射 construction，只建模 EU Stage II 代表路径；农业装备是否属于 industrial plant 缺少明确官方映射，保持 no-data。",
  },
  {
    ...norwayRecordTimestamps,
    adoptedOn: "2022-06-28",
    canonicalName:
      "Norway Bilforskriften G3 heavy-duty Euro VI emission requirements",
    citationCode: "FOR-2022-06-28-1233 § 1-4 / Vedlegg 1 G3",
    dataSourceId: acceptanceFixtureIds.source.norwayRoadRegulation,
    effectiveFrom: "2022-10-01",
    effectiveTo: "2029-05-29",
    id: acceptanceFixtureIds.regulation.norwayHeavyVehicleEuroVi,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.norway,
    status: "effective",
    summary:
      "现行 Bilforskriften 自 2022-10-01 生效，§ 1-2 覆盖挪威（含 Svalbard）的汽车与挂车，§ 1-4 将 595/2009 和 582/2011 作为挪威法。Vedlegg 1 G3 对 M3/N3 及未按 715/2007 认证的重型 M/N 车辆要求 595/2009 至 2029-05-28；本库保存 Euro VI WHSC/WHTC 代表限值。2022-10-01 是现行合并法规切换日，不宣称为挪威首次 Euro VI 实施日。",
  },
  {
    ...norwayRecordTimestamps,
    adoptedOn: "2020-06-24",
    canonicalName:
      "Norway Maskinforskriften Vedlegg XII Stage V emission requirements",
    citationCode: "FOR-2009-05-20-544 Vedlegg XII / EU 2016/1628",
    dataSourceId: acceptanceFixtureIds.source.norwayMachineryRegulation,
    effectiveFrom: "2020-07-01",
    id: acceptanceFixtureIds.regulation.norwayNrmmStageV,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.norway,
    status: "effective",
    summary:
      "Maskinforskriften § 1(3) 将范围扩展到附件 XII 定义的非道路移动机械内燃机；2020-06-24 第 1361 号修订自 2020-07-01 起由附件 XII 将 EU 2016/1628 作为挪威法规。该法规同时修改农业与林业车辆框架 167/2013，本批在 construction 和 agriculture 保存 Stage V NRE 代表功率带限值。",
  },
  {
    ...icelandRecordTimestamps,
    adoptedOn: "2013-04-15",
    canonicalName:
      "Iceland Regulation 377/2013 heavy-duty Euro VI emission requirements",
    citationCode:
      "Reglugerð 377/2013 art. 12 and Annex IV items 45zzk/45zzl",
    dataSourceId: acceptanceFixtureIds.source.icelandRoadRegulation2013,
    effectiveFrom: "2013-04-15",
    effectiveTo: "2027-11-29",
    id: acceptanceFixtureIds.regulation.icelandHeavyVehicleEuroVi,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.iceland,
    status: "effective",
    summary:
      "377/2013 article 12 requires vehicles to meet the emission standard applicable to them under 595/2009, while Annex IV items 45zzk and 45zzl register 595/2009 and 582/2011 for heavy-vehicle emissions; the instrument states immediate effect on its 2013-04-15 ministerial date. 603/2026 confirms the live 595/2009 entry and incorporates Euro 7. This fixture keeps the Euro VI representative path through the heavy-vehicle Euro 7 application date 2027-11-29.",
  },
  {
    ...icelandRecordTimestamps,
    adoptedOn: "2020-11-27",
    canonicalName:
      "Iceland Regulation 1200/2020 non-road mobile machinery Stage V requirements",
    citationCode: "Reglugerð 1200/2020 arts. 1, 7 and 8",
    dataSourceId: acceptanceFixtureIds.source.icelandNrmmRegulation2020,
    effectiveFrom: "2020-12-01",
    effectiveTo: "2021-02-23",
    id: acceptanceFixtureIds.regulation.icelandNrmmStageV2020,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.iceland,
    status: "effective",
    summary:
      "1200/2020 applied to engines for non-road mobile machinery and implemented 2016/1628 plus its delegated and implementing acts in Iceland from 2020-12-01. It repealed the prior 465/2009 regime and was itself replaced without a modeled gap by 179/2021 on 2021-02-23.",
  },
  {
    ...icelandRecordTimestamps,
    adoptedOn: "2021-02-22",
    canonicalName:
      "Iceland Regulation 179/2021 non-road mobile machinery Stage V requirements",
    citationCode: "Reglugerð 179/2021 arts. 1, 7 and 8",
    dataSourceId: acceptanceFixtureIds.source.icelandNrmmRegulation2021,
    effectiveFrom: "2021-02-23",
    id: acceptanceFixtureIds.regulation.icelandNrmmStageV2021,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.iceland,
    status: "effective",
    summary:
      "179/2021 applies to engines for non-road mobile machinery, gives 2016/1628 and its implementing acts effect in Iceland, and replaced 1200/2020 on 2021-02-23. The current consolidated text was last amended on 2023-05-31; this fixture maps the Stage V NRE representative bands to construction and agriculture.",
  },
  {
    ...liechtensteinRecordTimestamps,
    adoptedOn: "1996-07-16",
    canonicalName:
      "Liechtenstein VTS current heavy-vehicle Euro VI emission pathway",
    citationCode: "VTS LGBl. 1996 Nr. 143, Fassung 01.07.2026 Anhang 4 Ziff. 211",
    dataSourceId: acceptanceFixtureIds.source.liechtensteinVts,
    effectiveFrom: "2026-07-01",
    id: acceptanceFixtureIds.regulation.liechtensteinHeavyVehicleEuroVi,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.liechtenstein,
    status: "effective",
    summary:
      "The current consolidated VTS requires heavy M/N vehicle diesel engines to comply with Regulation (EC) No. 595/2009 or UNECE R49 and makes cited EWR rules directly applicable. Because the available official text does not establish Liechtenstein's first Euro VI implementation date, this fixture starts at the current consolidated version dated 2026-07-01 and keeps the EU Euro VI representative values traceable to the EU source.",
  },
  {
    ...liechtensteinRecordTimestamps,
    adoptedOn: "2020-03-20",
    canonicalName:
      "Liechtenstein EWR Regulation (EU) 2016/1628 non-road Stage V pathway",
    citationCode: "LGBl. 2020 Nr. 258 / EWR Joint Committee Decision 39/2020",
    dataSourceId: acceptanceFixtureIds.source.liechtensteinEwrStageV,
    effectiveFrom: "2020-08-01",
    id: acceptanceFixtureIds.regulation.liechtensteinNrmmStageV,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.liechtenstein,
    status: "effective",
    summary:
      "LGBl. 2020 Nr. 258 records Liechtenstein's 2020-08-01 entry into force for EWR Joint Committee Decision 39/2020, which incorporates Regulation (EU) 2016/1628 and removes the superseded Directive 97/68/EC path. The fixture maps Stage V NRE representative bands to construction and agriculture with numeric limits traced to the EU Annex II source.",
  },
  {
    ...switzerlandRecordTimestamps,
    adoptedOn: "1995-06-19",
    canonicalName: "Swiss VTS current heavy-vehicle Euro VI emission pathway",
    citationCode: "VTS SR 741.41, Stand 01.07.2026 Anhang 5 Ziff. 211",
    dataSourceId: acceptanceFixtureIds.source.switzerlandVts,
    effectiveFrom: "2026-07-01",
    id: acceptanceFixtureIds.regulation.switzerlandHeavyVehicleEuroVi,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.switzerland,
    status: "effective",
    summary:
      "The current Swiss VTS Annex 5 Ziff. 211 requires heavy M/N vehicle engines to comply with Regulation (EC) No. 595/2009 or UNECE R49. The available current text does not by itself reconstruct Switzerland's first Euro VI implementation date, so this fixture starts at the consolidated version dated 2026-07-01 and traces representative Euro VI values to the EU official table.",
  },
  {
    ...switzerlandRecordTimestamps,
    adoptedOn: "1995-06-19",
    canonicalName: "Swiss VTS 2016/1628 non-road Stage V pathway",
    citationCode: "VTS SR 741.41, Stand 01.07.2026 Anhang 5 Ziff. 211a/211b",
    dataSourceId: acceptanceFixtureIds.source.switzerlandVts,
    effectiveFrom: "2026-07-01",
    id: acceptanceFixtureIds.regulation.switzerlandNrmmStageV,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.switzerland,
    status: "effective",
    summary:
      "The Swiss VTS Annex 5 Ziff. 211a and 211b expressly recognize Regulation (EU) 2016/1628 for work engines and tractors. Because the current text does not provide a complete domestic market-placement timeline for Stage V, this fixture uses the current consolidated version date and retains the EU Annex II representative bands for construction and agriculture.",
  },
  {
    ...sriLankaRecordTimestamps,
    adoptedOn: "2018-07-10",
    canonicalName:
      "Sri Lanka Gazette 2079/42 Third Schedule vehicle and engine emission standards",
    citationCode: "Gazette 2079/42 Third Schedule, Tables 5-6",
    dataSourceId: acceptanceFixtureIds.source.sriLankaEnvironment,
    effectiveFrom: "2018-07-13",
    id: acceptanceFixtureIds.regulation.sriLankaVehicleEmission2018,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.sriLanka,
    status: "effective",
    summary:
      "Gazette 2079/42 applies to imported and locally manufactured or assembled vehicles and engines. Third Schedule Table 5 sets ESC limits for diesel vehicles and heavy engines with GVW over 3,500 kg, while Table 6 sets alternative ISO 8178-4 C1 variable-speed or D2 constant-speed limits for construction-equipment vehicles. Gazette 2079/70 expressly brought the import requirement into force on 2018-07-13, but clause 8 grandfathers imports backed by a letter of credit established on or before 2018-07-12 when imported on or before 2018-10-31. Gazette 2083/3 later added the Fifth Schedule as an alternative compliance route without repealing the Third Schedule. This fixture models only the Third Schedule route and does not extend construction limits to agriculture.",
  },
  {
    ...uruguayRecordTimestamps,
    adoptedOn: "2021-05-04",
    canonicalName:
      "Uruguay Decree No. 135/021 zero-kilometre heavy diesel vehicle emission limits",
    citationCode: "Decreto 135/021 arts. 42, 45, 48 and Table 17",
    dataSourceId: acceptanceFixtureIds.source.uruguayEnvironment,
    effectiveFrom: "2023-05-14",
    id: acceptanceFixtureIds.regulation.uruguayDecree1352021,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.uruguay,
    status: "effective",
    summary:
      "Decree 135/021 applies Table 17 to zero-kilometre compression-ignition M/N vehicles above 2,610 kg, with M2/M3 mapped to bus and N2/N3 to truck. The official homologation procedure made the new-vehicle requirement operational on 2023-05-14. ESC and ETC rows are stored separately; Article 52 only authorizes future requirements for other mobile sources, so construction and agriculture remain no-data.",
  },
  {
    ...ugandaRecordTimestamps,
    adoptedOn: "2023-11-09",
    canonicalName:
      "Uganda National Environment (Air Quality Standards) Regulations, 2024",
    citationCode:
      "S.I. No. 22 of 2024, regulations 2 and 9-10, Schedule 4",
    dataSourceId: acceptanceFixtureIds.source.ugandaEnvironment,
    effectiveFrom: "2024-04-26",
    id: acceptanceFixtureIds.regulation.ugandaAirQuality2024,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.uganda,
    status: "effective",
    summary:
      "Regulations 2 and 9 apply to internal-combustion engines and prohibit importing or operating mobile sources above Schedule 4 limits. The official heavy-duty table visibly prints kg/kWh, while its GVW rows conflict with the accompanying C/CE/F/G category definitions and omit usable rows for some named groups. US EAS 1047:2022 is listed by UNBS as compulsory, but its numeric text is not publicly readable. The regulation is therefore published as effective metadata without numeric limit rows; no suspected typographical error is silently normalized to g/kWh.",
  },
  {
    ...papuaNewGuineaRecordTimestamps,
    adoptedOn: "2018-11-30",
    canonicalName:
      "Papua New Guinea heavy diesel motor-truck ADR 80/03 representative pathway",
    citationCode:
      "Road Traffic Rules — Vehicle Standards and Compliance 2017, Sections 6A(4)(b) and 64B",
    dataSourceId: acceptanceFixtureIds.source.papuaNewGuineaEnvironment,
    effectiveFrom: "2019-01-01",
    id: acceptanceFixtureIds.regulation.papuaNewGuineaHeavyTruckAdr803,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.papuaNewGuinea,
    status: "effective",
    summary:
      "Section 6A(4)(b) requires diesel motor trucks above 4,500 kg manufactured on or after 2012 to comply with ADR 80/03, Euro V, Japan 05 or US 2004 as alternatives, and Section 64B requires imported vehicles to be certified against the Rule. This fixture publishes only the ADR 80/03 representative route from the amended Rule's 2019-01-01 commencement. It does not combine alternative standards and does not extend the motor-truck clause to buses, construction equipment or agricultural machinery. The current query model has no vehicle manufacture-year field, so the limits must be read with the 2012-and-later vehicle boundary in this summary and each measurement basis.",
  },
  {
    ...taiwanRecordTimestamps,
    canonicalName:
      "Taiwan Phase 6 heavy diesel passenger and freight vehicle representative pathway",
    citationCode: "移動污染源空氣污染物排放標準第五條",
    dataSourceId: acceptanceFixtureIds.source.taiwanEnvironment,
    effectiveFrom: "2021-09-01",
    id: acceptanceFixtureIds.regulation.taiwanHeavyDieselPhase6,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.taiwan,
    status: "effective",
    summary:
      "Article 5 applies the Phase 6 table to heavy diesel passenger and freight vehicles above 3,500 kg, or passenger vehicles with at least 10 seats. The statutory phase began on 2019-09-01, while vehicle models built with engine families approved by 2019-08-31 could continue through 2021-08-31; because the query model has no engine-family approval-date dimension, this fixture uses the full-coverage boundary of 2021-09-01. It stores only the WHSC/WHTC/WNTE representative pathway and does not combine the alternative US FTP-Transient route. Construction and agricultural machinery are not covered by this table and remain no-data.",
  },
  {
    ...venezuelaRecordTimestamps,
    adoptedOn: "1998-08-19",
    canonicalName:
      "Venezuela model-year 2000 heavy diesel road-vehicle representative pathway",
    citationCode: "Decreto Nº 2.673/1998, artículo 7, tabla Nº 4",
    dataSourceId: acceptanceFixtureIds.source.venezuelaEnvironment,
    effectiveFrom: "2000-01-01",
    id: acceptanceFixtureIds.regulation.venezuelaHeavyDieselMy2000,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.venezuela,
    status: "effective",
    summary:
      "Article 7 applies the model-year 2000 and later diesel table to imported or domestically assembled road vehicles above 3,500 kg, covering heavy passenger and freight categories M2/M3 and N2/N3. Because the query model stores ISO dates rather than vehicle model years, 2000-01-01 is a normalized MY2000 boundary. The fixture publishes only the Directive 91/542/EEC European representative route: CO 4.5, HC 1.1, NOx 8.0 and PM 0.36 g/kWh, with PM multiplied by 1.7 to 0.612 g/kWh for engines with maximum power at or below 85 kW. Article 11 makes the European and US heavy-duty transient routes alternatives, so they are not combined. Article 24 expressly excludes construction, off-road mining and agricultural equipment; those scopes remain no-data.",
  },
  {
    ...thailandRecordTimestamps,
    adoptedOn: "2023-07-03",
    canonicalName:
      "Thailand TIS 3046-2563 Level 6 mandatory heavy compression-ignition vehicle standard",
    citationCode: "TIS 3046-2563 / Ministerial Regulation B.E. 2566",
    dataSourceId: acceptanceFixtureIds.source.thailandMinisterialRegulation,
    effectiveFrom: "2024-01-01",
    id: acceptanceFixtureIds.regulation.thailandHeavyDieselLevel6,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.thailand,
    status: "effective",
    summary:
      "The Ministerial Regulation makes TIS 3046-2563 mandatory from 2024-01-01 for compression-ignition M1/M2/N1/N2 vehicles with reference mass above 2,610 kg and all M3/N3 vehicles. Despite the domestic label Level 6, the standard's preface aligns this pathway with Euro V / UN R49 05 series, not Euro VI. This fixture publishes the ESC, ELR and ETC representative diesel path; ETC THC 0.55 g/kWh is an alternative to NMHC 0.55 and is not accumulated. TIS 787-2551 covers only small agricultural/industrial diesel engines up to 22 kW with a Bosch smoke requirement, so construction and agriculture remain no-data for the 150 kW product query.",
  },
  {
    ...bosniaRecordTimestamps,
    adoptedOn: "2019-03-18",
    canonicalName:
      "Bosnia and Herzegovina UN R49/06 heavy road-vehicle homologation minimum",
    citationCode:
      "Odluka o najnižim tehničkim zahtjevima, Annex 1, Emisija — UNECE 49/06",
    dataSourceId: acceptanceFixtureIds.source.bosniaMinimumRequirements,
    effectiveFrom: "2019-06-01",
    id: acceptanceFixtureIds.regulation.bosniaR49Series06,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.bosnia,
    status: "effective",
    summary:
      "The 2019 minimum technical requirements decision requires UNECE R49/06 for new M/N vehicle homologation from 2019-06-01, while the 2010 R49 order supplies the national type-approval chain. The representative compression-ignition path covers M3/N3 and M1/M2/N1/N2 vehicles above 2,610 kg reference mass and publishes the complete WHSC/WHTC table from UN R49 Revision 6. The annex's R96 alternative is limited to a narrowly defined N3 SF mobile crane and cannot be generalized to construction machinery; no agricultural engine phase is established, so both non-road scopes remain no-data.",
  },
  {
    ...montenegroRecordTimestamps,
    adoptedOn: "2018-09-24",
    canonicalName:
      "Montenegro Euro VI / UN R49.06 minimum for new M/N vehicles",
    citationCode:
      "Pravilnik o tehničkim zahtjevima, Annex rows 42/50; 2018 implementation notice",
    dataSourceId: acceptanceFixtureIds.source.montenegroEuro6Implementation,
    effectiveFrom: "2018-10-15",
    id: acceptanceFixtureIds.regulation.montenegroEuroVi,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.montenegro,
    status: "effective",
    summary:
      "Montenegro's current vehicle-requirements package requires new imported or first-marketed M/N vehicles to meet EURO 6 from 2018-10-15 and expressly incorporates UN R49/06 together with the EU 595/2009 and 582/2011 route. This fixture publishes one UN R49 Revision 6 compression-ignition representative path: WHSC, WHTC and WNTE, not cumulative equivalent routes. The domestic M/N definition requires maximum continuous rated power above 15 kW. The 2024 annex gives T machinery only an undifferentiated R96/04 reference, while the 2026 homologation law delegates NRMM pollutant tables, cycles and implementation details to future bylaws; construction and agriculture therefore remain no-data.",
  },
  {
    ...nepalRecordTimestamps,
    adoptedOn: "2025-06-23",
    canonicalName:
      "Nepal Vehicle Pollution Standard 2082 heavy compression-ignition M/N pathway",
    citationCode:
      "नेपाल सवारी साधन प्रदूषण मापदण्ड, २०८२ §§1, 3, 6(b), 14 and 16",
    dataSourceId: acceptanceFixtureIds.source.nepalVehicleEmissionGazette,
    effectiveFrom: "2025-06-23",
    id: acceptanceFixtureIds.regulation.nepalHeavyVehicle2082,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.nepal,
    status: "effective",
    summary:
      "The Nepal Vehicle Pollution Standard 2082 applies from its Gazette publication on 2025-06-23 to domestically produced, assembled and imported L/M/N vehicles. For compression-ignition M/N vehicles above 3,500 kg gross vehicle weight, it publishes complete WHSC, WHTC and WNTE limits. Section 16 repeals the 2069 standard while grandfathering vehicles and parts covered by a letter of credit or payment before publication. Section 3 expressly excludes tractors, power tillers, dozers, cranes, rollers, excavators and comparable construction equipment, so construction and agriculture remain no-data.",
  },
  {
    ...ukraineRecordTimestamps,
    adoptedOn: "2012-08-17",
    canonicalName:
      "Ukraine Euro V heavy-duty road-vehicle type-approval representative pathway",
    citationCode:
      "Law No. 2739-IV / Order No. 521 Annex 2 item 52 (Euro V B2)",
    dataSourceId: acceptanceFixtureIds.source.ukraineTypeApprovalOrder,
    effectiveFrom: "2016-01-01",
    effectiveTo: "2027-01-01",
    id: acceptanceFixtureIds.regulation.ukraineRoadEuroV,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.ukraine,
    status: "effective",
    summary:
      "Law No. 2739-IV requires at least Euro V from 2016-01-01 for first registration and import of road passenger and freight vehicles, including commodity headings 8702 and 8704. Order No. 521, as amended by Order No. 188, applies type approval to M/N vehicles and Annex 2 item 52 accepts UN R49-05 B2 or Directive 2005/55 B2 among alternative routes for diesel and gas M1/M2/M3/N1/N2/N3 vehicles. This fixture publishes only the Directive 2005/55 B2 compression-ignition representative route and does not combine alternatives. The statutory Euro VI floor for headings 8702/8704 begins on 2027-01-01; this Euro V record therefore ends at that boundary and later queries fail closed until the complete Ukrainian Euro VI technical implementation chain is published. Construction and agricultural machinery are outside this M/N road-vehicle path and remain no-data.",
  },
  {
    ...recordTimestamps,
    updatedAt: p7VerificationTimestamp,
    verifiedAt: p7VerificationTimestamp,
    adoptedOn: "2008-11-11",
    canonicalName:
      "Resolução CONAMA nº 403, de 11 de novembro de 2008 (PROCONVE P-7)",
    citationCode: "CONAMA 403/2008",
    dataSourceId: acceptanceFixtureIds.source.brConama403,
    effectiveFrom: "2012-01-01",
    effectiveTo: "2023-01-01",
    id: acceptanceFixtureIds.regulation.brConama403,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.brConama,
    status: "effective",
    summary:
      "重型道路车辆 P-7 阶段；柴油机按 ESC/ELR 与 ETC 测试，自 2012-01-01 实施，默认历史查询在 P8 全面强制日 2023-01-01 切换。",
  },
  {
    ...p8RecordTimestamps,
    adoptedOn: "2018-11-16",
    canonicalName:
      "Resolução CONAMA nº 490, de 16 de novembro de 2018 (PROCONVE P8)",
    citationCode: "CONAMA 490/2018",
    dataSourceId: acceptanceFixtureIds.source.brConama490,
    effectiveFrom: "2023-01-01",
    id: acceptanceFixtureIds.regulation.brConama490,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.brConama,
    status: "effective",
    summary:
      "重型道路车辆 P8 阶段（UN ECE R49.06 测试体系）；从未取得 LCVM 的新车型自 2022-01-01 起适用，其余车辆自 2023-01-01 起全面强制；合规路径 IBAMA LCVM。",
  },
  {
    ...recordTimestamps,
    adoptedOn: "2011-07-13",
    canonicalName:
      "Resolução CONAMA nº 433, de 13 de julho de 2011 (PROCONVE MAR-I)",
    citationCode: "CONAMA 433/2011",
    dataSourceId: acceptanceFixtureIds.source.brConama433,
    effectiveFrom: "2019-01-01",
    id: acceptanceFixtureIds.regulation.brConama433,
    isDemo: false,
    jurisdictionId: acceptanceFixtureIds.jurisdiction.brConama,
    status: "effective",
    summary:
      "非道路农业与工程机械 ≥19 kW 柴油机 MAR-I 阶段（ISO 8178-1）。附件 A 表 I 功率带限值已读回入库。",
  },
];

type FixtureLimit = typeof regulationLimits.$inferInsert;

let limitCounter = 500;
function fixtureLimit(
  regulationId: string,
  dataSourceId: string,
  limit: {
    applicationScope: "on-road-truck" | "on-road-bus" | "construction" | "agriculture";
    pollutantCode: string;
    limitValue: string;
    unitCode: string;
    powerMinKw?: number;
    powerMaxKw?: number;
    measurementBasis?: string;
    testCycleCode?: string;
    validFrom: string;
    validTo?: string;
    verifiedAt?: Date;
  },
): FixtureLimit {
  limitCounter += 1;
  return {
    ...recordTimestamps,
    applicationScope: limit.applicationScope,
    dataSourceId,
    id: id(`${String(limitCounter).padStart(4, "0")}`),
    isDemo: false,
    limitValue: limit.limitValue,
    measurementBasis:
      limit.measurementBasis ??
      (limit.pollutantCode === "PN"
        ? "官方标准表格（签核来源见 data_source）；PN 以 e9/kWh 缩放单位存储（1 e9/kWh = 10^9 #/kWh）"
        : "官方标准表格（签核来源见 data_source）"),
    pollutantCode: limit.pollutantCode,
    powerMaxKw: limit.powerMaxKw,
    powerMinKw: limit.powerMinKw,
    regulationId,
    testCycleCode: limit.testCycleCode,
    unitCode: limit.unitCode,
    validFrom: limit.validFrom,
    validTo: limit.validTo,
    updatedAt: limit.verifiedAt ?? recordTimestamps.updatedAt,
    verifiedAt: limit.verifiedAt ?? recordTimestamps.verifiedAt,
  };
}

export function buildFixtureLimits(): FixtureLimit[] {
  const limits: FixtureLimit[] = [];
  const scopes = ["on-road-truck", "on-road-bus"] as const;

  // GB 17691-2018 国六 b 阶段（WHTC，柴油，2023-07-01 起强制）。
  // PN 原文 6.0×10^11 #/kWh，超出 limit_value 的 numeric(18,6) 上限，
  // 按 e9/kWh（10^9 #/kWh）缩放单位存储。
  const gb17691Whtc = [
    { pollutantCode: "NOX", limitValue: "460", unitCode: "mg/kWh" },
    { pollutantCode: "PM", limitValue: "10", unitCode: "mg/kWh" },
    { pollutantCode: "PN", limitValue: "600", unitCode: "e9/kWh" },
    { pollutantCode: "CO", limitValue: "4000", unitCode: "mg/kWh" },
    { pollutantCode: "THC", limitValue: "160", unitCode: "mg/kWh" },
  ] as const;
  for (const scope of scopes) {
    for (const row of gb17691Whtc) {
      limits.push(
        fixtureLimit(
          acceptanceFixtureIds.regulation.cnGb17691,
          acceptanceFixtureIds.source.cnGb17691,
          {
            ...row,
            applicationScope: scope,
            testCycleCode: "WHTC",
            validFrom: "2023-07-01",
          },
        ),
      );
    }
  }

  // GB 20891-2014 第四阶段（2022-12-01 起），功率带 56≤P<130 kW。
  // PN 原文 5×10^12 #/kWh，同样按 e9/kWh 缩放单位存储。
  const gb20891Stage4MeasurementBasis =
    "GB 20891-2014/XG1-2020 Table 2 and HJ 1014-2020 chapter 5: NRSC applies to all engines; NRTC additionally applies to variable-speed engines from 19 through 560 kW and to multi-cylinder variable-speed engines below 19 kW (cold/hot weighted 10/90). PN applies only from 37 through 560 kW and is stored in e9/kWh. NH3 25 ppm applies only to reagent-using engines and is not published as an unconditional row";
  const gb20891Stage3ContinuationMeasurementBasis =
    "GB 20891-2014 sections 5.2.1 and 10, Table 2: Stage III full-coverage boundary 2016-04-01; P>560 kW remains at Stage III because the Stage IV implementation date is still deferred; steady-state NRSC applies";
  const gb20891Stage4BandA = [
    { pollutantCode: "CO", limitValue: "5.0", unitCode: "g/kWh" },
    { pollutantCode: "HC", limitValue: "0.19", unitCode: "g/kWh" },
    { pollutantCode: "NOX", limitValue: "3.3", unitCode: "g/kWh" },
    { pollutantCode: "PM", limitValue: "0.025", unitCode: "g/kWh" },
    { pollutantCode: "PN", limitValue: "5000", unitCode: "e9/kWh" },
  ] as const;
  // >560 kW 第四阶段“另行公告”，延续第三阶段限值。
  const gb20891Stage3Continuation = [
    { pollutantCode: "CO", limitValue: "3.5", unitCode: "g/kWh" },
    { pollutantCode: "HC+NOx", limitValue: "6.4", unitCode: "g/kWh" },
    { pollutantCode: "PM", limitValue: "0.20", unitCode: "g/kWh" },
  ] as const;
  for (const scope of ["construction", "agriculture"] as const) {
    for (const row of gb20891Stage4BandA) {
      limits.push(
        fixtureLimit(
          acceptanceFixtureIds.regulation.cnGb20891,
          acceptanceFixtureIds.source.cnGb20891,
          {
            ...row,
            applicationScope: scope,
            measurementBasis: gb20891Stage4MeasurementBasis,
            powerMaxKw: 130,
            powerMinKw: 56,
            testCycleCode: "NRSC AND applicable NRTC",
            validFrom: "2022-12-01",
            verifiedAt: chinaNonroadVerificationTimestamp,
          },
        ),
      );
    }
    for (const row of gb20891Stage3Continuation) {
      limits.push(
        fixtureLimit(
          acceptanceFixtureIds.regulation.cnGb20891,
          acceptanceFixtureIds.source.cnGb20891,
          {
            ...row,
            applicationScope: scope,
            measurementBasis: gb20891Stage3ContinuationMeasurementBasis,
            powerMinKw: 560.001,
            testCycleCode: "NRSC",
            validFrom: "2016-04-01",
            verifiedAt: chinaNonroadVerificationTimestamp,
          },
        ),
      );
    }
  }

  const usCfr86PrimaryMeasurementBasis =
    "40 CFR 86.007-11 MY2010-2026 petroleum-diesel HDE primary duty-cycle representative pathway; FTP cold-start/hot-start weighted result and SET at 1.0 times the base standards; NTE/FEL-dependent limits and alternative NTE smoke paths are not statically modeled";
  const usCfr86SmokeMeasurementBasis =
    "40 CFR 86.007-11(b) with 40 CFR 86.004-11(b)(1): core exhaust-smoke opacity standards for acceleration, lugging, and the peak in either mode; the alternative NTE FSN/opacity pathway is not statically modeled";
  const usCfr1036PrimaryMeasurementBasis =
    "40 CFR 1036.104 MY2027+ compression-ignition primary duty-cycle representative pathway for all primary intended service classes; diesel HC is stored as NMHC under paragraph (d)(3); off-cycle ambient-temperature adjustments and ABT/FEL scaling are not statically modeled";
  const usCfr1039VariableSpeedMeasurementBasis =
    "40 CFR 1039.101 Table 1 after MY2014, variable-speed mobile compression-ignition representative pathway through 560 kW; maximum engine power is first rounded to the nearest whole kilowatt under 40 CFR 1039.140 using the ties-to-even convention in 40 CFR 1065.20(e), and the stored three-decimal query bounds encode that classification. Appendix VI NRTC transient AND the applicable Appendix II NRSC steady-state cycle apply the same values. Below 19 kW the steady-state choice is 6-mode or eligible 8-mode/RMC; from 19 through 560 kW it is C1 8-mode or RMC. Table 1 footnotes set CO 8.0 below 8 kW and CO 5.5 below 37 kW. >560 kW application splits, ABT/FEL-dependent NTE, constant-speed, optional sub-8 kW PM, and smoke-exempt pathways are not accumulated";
  const cfr1039RoundedPowerBounds = {
    below8MaxKw: 7.5,
    from8MinKw: 7.5,
    from8To19MaxKw: 18.501,
    from19MinKw: 18.501,
    from19To37MaxKw: 36.501,
    from37MinKw: 36.501,
    from37To56MaxKw: 55.5,
    from56MinKw: 55.5,
    from56To130MaxKw: 129.5,
    from130MinKw: 129.5,
    through560MaxKw: 560.501,
  } as const;

  // 40 CFR 1036.104（primary FTP/SET，MY2027+）。
  const cfr1036Ftp = [
    { pollutantCode: "NOX", limitValue: "0.035", unitCode: "g/hp-hr" },
    { pollutantCode: "PM", limitValue: "0.005", unitCode: "g/hp-hr" },
    { pollutantCode: "CO", limitValue: "6.0", unitCode: "g/hp-hr" },
  ] as const;
  for (const scope of scopes) {
    for (const row of cfr1036Ftp) {
      limits.push(
        fixtureLimit(
          acceptanceFixtureIds.regulation.us1036104,
          acceptanceFixtureIds.source.usEcfr1036,
          {
            ...row,
            applicationScope: scope,
            measurementBasis: usCfr1036PrimaryMeasurementBasis,
            testCycleCode: "FTP/SET",
            validFrom: "2027-01-01",
            verifiedAt: unitedStatesVerificationTimestamp,
          },
        ),
      );
    }
    limits.push(
      fixtureLimit(
        acceptanceFixtureIds.regulation.us8600711,
        acceptanceFixtureIds.source.usEcfr86,
        {
          applicationScope: scope,
          limitValue: "0.20",
          measurementBasis: usCfr86PrimaryMeasurementBasis,
          pollutantCode: "NOX",
          testCycleCode: "FTP/SET",
          unitCode: "g/bhp-hr",
          validFrom: "2010-01-01",
          validTo: "2027-01-01",
          verifiedAt: unitedStatesVerificationTimestamp,
        },
      ),
    );
  }

  // 40 CFR 1039.101 Tier 4（既有 130–560 kW 行；更低功率带在 builder
  // 末尾追加，以保持已发布 fixture UUID）。
  const cfr1039Tier4 = [
    { pollutantCode: "NOX", limitValue: "0.40", unitCode: "g/kWh" },
    { pollutantCode: "PM", limitValue: "0.02", unitCode: "g/kWh" },
    { pollutantCode: "NMHC", limitValue: "0.19", unitCode: "g/kWh" },
  ] as const;
  for (const scope of ["construction", "agriculture"] as const) {
    for (const row of cfr1039Tier4) {
      limits.push(
        fixtureLimit(
          acceptanceFixtureIds.regulation.us1039101,
          acceptanceFixtureIds.source.usEcfr1039,
          {
            ...row,
            applicationScope: scope,
            measurementBasis: usCfr1039VariableSpeedMeasurementBasis,
            powerMaxKw: cfr1039RoundedPowerBounds.through560MaxKw,
            powerMinKw: cfr1039RoundedPowerBounds.from130MinKw,
            testCycleCode: "NRTC AND NRSC-C1 (8-mode OR RMC)",
            validFrom: "2015-01-01",
            verifiedAt: unitedStatesVerificationTimestamp,
          },
        ),
      );
    }
  }

  // Euro VI 限值：595/2009 附件 I（经 582/2011 附件 XV 替换，OJ L 167），
  // CI（柴油）WHSC/WHTC 行，2026-07-30 自 CELLAR 官方文本读回。
  const euro6Whsc = [
    { pollutantCode: "CO", limitValue: "1500", unitCode: "mg/kWh" },
    { pollutantCode: "THC", limitValue: "130", unitCode: "mg/kWh" },
    { pollutantCode: "NOX", limitValue: "400", unitCode: "mg/kWh" },
    { pollutantCode: "NH3", limitValue: "10", unitCode: "ppm" },
    { pollutantCode: "PM", limitValue: "10", unitCode: "mg/kWh" },
    { pollutantCode: "PN", limitValue: "800", unitCode: "e9/kWh" },
  ] as const;
  const euro6Whtc = [
    { pollutantCode: "CO", limitValue: "4000", unitCode: "mg/kWh" },
    { pollutantCode: "THC", limitValue: "160", unitCode: "mg/kWh" },
    { pollutantCode: "NOX", limitValue: "460", unitCode: "mg/kWh" },
    { pollutantCode: "NH3", limitValue: "10", unitCode: "ppm" },
    { pollutantCode: "PM", limitValue: "10", unitCode: "mg/kWh" },
    { pollutantCode: "PN", limitValue: "600", unitCode: "e9/kWh" },
  ] as const;
  for (const scope of ["on-road-truck", "on-road-bus"] as const) {
    for (const [cycle, rows] of [
      ["WHSC", euro6Whsc],
      ["WHTC", euro6Whtc],
    ] as const) {
      for (const row of rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.euReg595,
            acceptanceFixtureIds.source.euReg595,
            {
              ...row,
              applicationScope: scope,
              testCycleCode: cycle,
              validFrom: "2012-12-31",
            },
          ),
        );
      }
    }
  }

  // Stage V 限值：2016/1628 附件 II 表 II-1（NRE 变速机，OJ L 252 p.53），
  // 2026-07-30 自 CELLAR 官方文本读回。表为闭区间，半开区间语义下端点
  // 560 kW 归入 [130,560] 带（与原文一致）。各功率带分阶段生效日期见
  // 附件 III，此处统一以全面生效日 2019-01-01 记录。
  const stageVBands: ReadonlyArray<{
    powerMinKw: number;
    powerMaxKw?: number;
    rows: ReadonlyArray<{
      pollutantCode: string;
      limitValue: string;
    }>;
  }> = [
    {
      powerMaxKw: 8,
      powerMinKw: 0,
      rows: [
        { limitValue: "8.00", pollutantCode: "CO" },
        { limitValue: "7.50", pollutantCode: "HC+NOx" },
        { limitValue: "0.40", pollutantCode: "PM" },
      ],
    },
    {
      powerMaxKw: 19,
      powerMinKw: 8,
      rows: [
        { limitValue: "6.60", pollutantCode: "CO" },
        { limitValue: "7.50", pollutantCode: "HC+NOx" },
        { limitValue: "0.40", pollutantCode: "PM" },
      ],
    },
    {
      powerMaxKw: 37,
      powerMinKw: 19,
      rows: [
        { limitValue: "5.00", pollutantCode: "CO" },
        { limitValue: "4.70", pollutantCode: "HC+NOx" },
        { limitValue: "0.015", pollutantCode: "PM" },
        { limitValue: "1000", pollutantCode: "PN" },
      ],
    },
    {
      powerMaxKw: 56,
      powerMinKw: 37,
      rows: [
        { limitValue: "5.00", pollutantCode: "CO" },
        { limitValue: "4.70", pollutantCode: "HC+NOx" },
        { limitValue: "0.015", pollutantCode: "PM" },
        { limitValue: "1000", pollutantCode: "PN" },
      ],
    },
    {
      powerMaxKw: 130,
      powerMinKw: 56,
      rows: [
        { limitValue: "5.00", pollutantCode: "CO" },
        { limitValue: "0.19", pollutantCode: "HC" },
        { limitValue: "0.40", pollutantCode: "NOX" },
        { limitValue: "0.015", pollutantCode: "PM" },
        { limitValue: "1000", pollutantCode: "PN" },
      ],
    },
    {
      powerMaxKw: 560.001,
      powerMinKw: 130,
      rows: [
        { limitValue: "3.50", pollutantCode: "CO" },
        { limitValue: "0.19", pollutantCode: "HC" },
        { limitValue: "0.40", pollutantCode: "NOX" },
        { limitValue: "0.015", pollutantCode: "PM" },
        { limitValue: "1000", pollutantCode: "PN" },
      ],
    },
    {
      powerMinKw: 560.001,
      rows: [
        { limitValue: "3.50", pollutantCode: "CO" },
        { limitValue: "0.19", pollutantCode: "HC" },
        { limitValue: "3.50", pollutantCode: "NOX" },
        { limitValue: "0.045", pollutantCode: "PM" },
      ],
    },
  ];
  for (const scope of ["construction", "agriculture"] as const) {
    for (const band of stageVBands) {
      for (const row of band.rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.euReg1628,
            acceptanceFixtureIds.source.euReg1628,
            {
              applicationScope: scope,
              limitValue: row.limitValue,
              pollutantCode: row.pollutantCode,
              powerMaxKw: band.powerMaxKw,
              powerMinKw: band.powerMinKw,
              unitCode: row.pollutantCode === "PN" ? "e9/kWh" : "g/kWh",
              validFrom: "2019-01-01",
            },
          ),
        );
      }
    }
  }

  // GBR construction uses the Stage V technical framework through provisional
  // GB type approval. It has an independent UK regulation/source pairing so
  // results do not imply EU membership.
  for (const band of stageVBands) {
    for (const row of band.rows) {
      limits.push(
        fixtureLimit(
          acceptanceFixtureIds.regulation.unitedKingdomNrmmStageV,
          acceptanceFixtureIds.source.unitedKingdomNrmm,
          {
            applicationScope: "construction",
            limitValue: row.limitValue,
            pollutantCode: row.pollutantCode,
            powerMaxKw: band.powerMaxKw,
            powerMinKw: band.powerMinKw,
            unitCode: row.pollutantCode === "PN" ? "e9/kWh" : "g/kWh",
            validFrom: "2023-01-01",
          },
        ),
      );
    }
  }

  // PROCONVE P8 限值：Res. CONAMA 490/2018 附件表 1，压燃发动机行。
  // 2026-08-05 从 Imprensa Nacional 的 DOU 2018-11-21 官方 HTML 存档读回。
  // 原文 NP 使用 #/kWh；按现有数值约束转换为 e9/kWh 存储。
  const p8Whsc = [
    { pollutantCode: "CO", limitValue: "1500", unitCode: "mg/kWh" },
    { pollutantCode: "THC", limitValue: "130", unitCode: "mg/kWh" },
    { pollutantCode: "NOX", limitValue: "400", unitCode: "mg/kWh" },
    { pollutantCode: "NH3", limitValue: "10", unitCode: "ppm" },
    { pollutantCode: "PM", limitValue: "10", unitCode: "mg/kWh" },
    { pollutantCode: "PN", limitValue: "800", unitCode: "e9/kWh" },
  ] as const;
  const p8Whtc = [
    { pollutantCode: "CO", limitValue: "4000", unitCode: "mg/kWh" },
    { pollutantCode: "THC", limitValue: "160", unitCode: "mg/kWh" },
    { pollutantCode: "NOX", limitValue: "460", unitCode: "mg/kWh" },
    { pollutantCode: "NH3", limitValue: "10", unitCode: "ppm" },
    { pollutantCode: "PM", limitValue: "10", unitCode: "mg/kWh" },
    { pollutantCode: "PN", limitValue: "600", unitCode: "e9/kWh" },
  ] as const;
  for (const scope of scopes) {
    for (const [cycle, rows] of [
      ["WHSC", p8Whsc],
      ["WHTC", p8Whtc],
    ] as const) {
      for (const row of rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.brConama490,
            acceptanceFixtureIds.source.brConama490,
            {
              ...row,
              applicationScope: scope,
              measurementBasis:
                "Res. CONAMA 490/2018, Anexo, Tabela 1, motor de ignição por compressão",
              testCycleCode: cycle,
              validFrom: "2023-01-01",
              verifiedAt: p8VerificationTimestamp,
            },
          ),
        );
      }
    }
  }

  // PROCONVE MAR-I 限值：Res. CONAMA 433/2011 附件 A 表 I，2026-07-30 自
  // IBAMA《Manual do Proconve/Promot》官方手册（gov.br，2011-11-29 版，
  // p.310）读回。表为闭区间；各功率带分阶段生效（2015–2019），此处统一
  // 以全面生效日 2019-01-01 记录。PM 官方符号为 MP（material particulado）。
  const marIBands: ReadonlyArray<{
    powerMinKw: number;
    powerMaxKw: number;
    rows: ReadonlyArray<{
      pollutantCode: string;
      limitValue: string;
    }>;
  }> = [
    {
      powerMaxKw: 37,
      powerMinKw: 19,
      rows: [
        { limitValue: "5.5", pollutantCode: "CO" },
        { limitValue: "7.5", pollutantCode: "HC+NOx" },
        { limitValue: "0.6", pollutantCode: "PM" },
      ],
    },
    {
      powerMaxKw: 75,
      powerMinKw: 37,
      rows: [
        { limitValue: "5.0", pollutantCode: "CO" },
        { limitValue: "4.7", pollutantCode: "HC+NOx" },
        { limitValue: "0.4", pollutantCode: "PM" },
      ],
    },
    {
      powerMaxKw: 130,
      powerMinKw: 75,
      rows: [
        { limitValue: "5.0", pollutantCode: "CO" },
        { limitValue: "4.0", pollutantCode: "HC+NOx" },
        { limitValue: "0.3", pollutantCode: "PM" },
      ],
    },
    {
      powerMaxKw: 560,
      powerMinKw: 130,
      rows: [
        { limitValue: "3.5", pollutantCode: "CO" },
        { limitValue: "4.0", pollutantCode: "HC+NOx" },
        { limitValue: "0.2", pollutantCode: "PM" },
      ],
    },
  ];
  for (const scope of ["construction", "agriculture"] as const) {
    for (const band of marIBands) {
      for (const row of band.rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.brConama433,
            acceptanceFixtureIds.source.brConama433,
            {
              applicationScope: scope,
              limitValue: row.limitValue,
              pollutantCode: row.pollutantCode,
              powerMaxKw: band.powerMaxKw,
              powerMinKw: band.powerMinKw,
              unitCode: "g/kWh",
              validFrom: "2019-01-01",
            },
          ),
        );
      }
    }
  }

  // PROCONVE P-7 限值：Res. CONAMA 403/2008 附件 I，柴油发动机行。
  // 2026-08-05 从旧 CONAMA 官方法规页链接的官方 PDF 存档读回。追加在
  // 现有限值之后，以保持已经发布的顺序生成 ID 稳定。
  const p7EscElr = [
    { pollutantCode: "NOX", limitValue: "2", unitCode: "g/kWh" },
    { pollutantCode: "HC", limitValue: "0.46", unitCode: "g/kWh" },
    { pollutantCode: "CO", limitValue: "1.5", unitCode: "g/kWh" },
    { pollutantCode: "PM", limitValue: "0.02", unitCode: "g/kWh" },
    { pollutantCode: "OPACITY", limitValue: "0.5", unitCode: "m-1" },
    { pollutantCode: "NH3", limitValue: "25", unitCode: "ppm" },
  ] as const;
  const p7Etc = [
    { pollutantCode: "NOX", limitValue: "2", unitCode: "g/kWh" },
    { pollutantCode: "CO", limitValue: "4", unitCode: "g/kWh" },
    { pollutantCode: "PM", limitValue: "0.03", unitCode: "g/kWh" },
    { pollutantCode: "NMHC", limitValue: "0.55", unitCode: "g/kWh" },
    { pollutantCode: "NH3", limitValue: "25", unitCode: "ppm" },
  ] as const;
  for (const scope of scopes) {
    for (const [cycle, rows] of [
      ["ESC/ELR", p7EscElr],
      ["ETC", p7Etc],
    ] as const) {
      for (const row of rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.brConama403,
            acceptanceFixtureIds.source.brConama403,
            {
              ...row,
              applicationScope: scope,
              measurementBasis:
                "Res. CONAMA 403/2008, Anexo I, limites para motores do ciclo Diesel",
              testCycleCode: cycle,
              validFrom: "2012-01-01",
              validTo: "2023-01-01",
              verifiedAt: p7VerificationTimestamp,
            },
          ),
        );
      }
    }
  }

  // 日本平成28年（2016年）重型柴油车标准。环境省《自動車排出ガス規制の
  // 経緯》p.4 明确括号内为平均值；标准按 GVW 分阶段实施，本库尚无 GVW
  // 过滤字段，因此以全部 GVW>3.5 t 车辆均已适用的 2018-10-01 为起点。
  const japanRoadMeanLimits = [
    { pollutantCode: "CO", limitValue: "2.22" },
    { pollutantCode: "NMHC", limitValue: "0.17" },
    { pollutantCode: "NOX", limitValue: "0.4" },
    { pollutantCode: "PM", limitValue: "0.010" },
  ] as const;
  for (const scope of scopes) {
    for (const cycle of ["WHSC", "WHTC"] as const) {
      for (const row of japanRoadMeanLimits) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.japanRoad2016,
            acceptanceFixtureIds.source.japanRoadHistory,
            {
              ...row,
              applicationScope: scope,
              measurementBasis:
                "環境省『自動車排出ガス規制の経緯』p.4、平成28年規制、括弧内の平均値",
              testCycleCode: cycle,
              unitCode: "g/kWh",
              validFrom: "2018-10-01",
              verifiedAt: japanVerificationTimestamp,
            },
          ),
        );
      }
    }
  }

  // オフロード法 2014 年基准。现行三省告示第2条第1项第2号的柴油表给出
  // 五个 [min,max) 功率带；各带适用日由环境省 2014 年概要 p.1 读回。
  const japanOffroadBands: ReadonlyArray<{
    powerMinKw: number;
    powerMaxKw: number;
    validFrom: string;
    rows: ReadonlyArray<{
      pollutantCode: string;
      limitValue: string;
    }>;
  }> = [
    {
      powerMinKw: 19,
      powerMaxKw: 37,
      validFrom: "2016-10-01",
      rows: [
        { pollutantCode: "CO", limitValue: "5.0" },
        { pollutantCode: "NMHC", limitValue: "0.7" },
        { pollutantCode: "NOX", limitValue: "4.0" },
        { pollutantCode: "PM", limitValue: "0.03" },
      ],
    },
    {
      powerMinKw: 37,
      powerMaxKw: 56,
      validFrom: "2016-10-01",
      rows: [
        { pollutantCode: "CO", limitValue: "5.0" },
        { pollutantCode: "NMHC", limitValue: "0.7" },
        { pollutantCode: "NOX", limitValue: "4.0" },
        { pollutantCode: "PM", limitValue: "0.025" },
      ],
    },
    {
      powerMinKw: 56,
      powerMaxKw: 75,
      validFrom: "2015-10-01",
      rows: [
        { pollutantCode: "CO", limitValue: "5.0" },
        { pollutantCode: "NMHC", limitValue: "0.19" },
        { pollutantCode: "NOX", limitValue: "0.4" },
        { pollutantCode: "PM", limitValue: "0.02" },
      ],
    },
    {
      powerMinKw: 75,
      powerMaxKw: 130,
      validFrom: "2015-10-01",
      rows: [
        { pollutantCode: "CO", limitValue: "5.0" },
        { pollutantCode: "NMHC", limitValue: "0.19" },
        { pollutantCode: "NOX", limitValue: "0.4" },
        { pollutantCode: "PM", limitValue: "0.02" },
      ],
    },
    {
      powerMinKw: 130,
      powerMaxKw: 560,
      validFrom: "2014-10-01",
      rows: [
        { pollutantCode: "CO", limitValue: "3.5" },
        { pollutantCode: "NMHC", limitValue: "0.19" },
        { pollutantCode: "NOX", limitValue: "0.4" },
        { pollutantCode: "PM", limitValue: "0.02" },
      ],
    },
  ];
  for (const scope of ["construction", "agriculture"] as const) {
    for (const band of japanOffroadBands) {
      for (const row of band.rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.japanOffroad2014,
            acceptanceFixtureIds.source.japanOffroadNotice,
            {
              ...row,
              applicationScope: scope,
              measurementBasis:
                "现行三省告示第2条第1项第2号；8-mode 与 NRTC 的同一平均限值",
              powerMaxKw: band.powerMaxKw,
              powerMinKw: band.powerMinKw,
              testCycleCode: "8-mode/NRTC",
              unitCode: "g/kWh",
              validFrom: band.validFrom,
              verifiedAt: japanVerificationTimestamp,
            },
          ),
        );
      }
    }
  }

  // 韩国 대기환경보전법 시행규칙 별표 17（2026-06-26 修订版）道路重型柴油车。
  // 第2号아목自 2017-10-01 适用；大/超大型客货车需同时满足 WHSC 与 WHTC，
  // NH3 由同表备注 6 规定为 10 ppm。
  const koreaRoadWhsc = [
    { pollutantCode: "CO", limitValue: "1.5", unitCode: "g/kWh" },
    { pollutantCode: "NOX", limitValue: "0.40", unitCode: "g/kWh" },
    { pollutantCode: "HC+NOx", limitValue: "0.13", unitCode: "g/kWh" },
    { pollutantCode: "PM", limitValue: "0.01", unitCode: "g/kWh" },
    { pollutantCode: "PN", limitValue: "800", unitCode: "e9/kWh" },
    { pollutantCode: "NH3", limitValue: "10", unitCode: "ppm" },
  ] as const;
  const koreaRoadWhtc = [
    { pollutantCode: "CO", limitValue: "4.0", unitCode: "g/kWh" },
    { pollutantCode: "NOX", limitValue: "0.46", unitCode: "g/kWh" },
    { pollutantCode: "HC+NOx", limitValue: "0.16", unitCode: "g/kWh" },
    { pollutantCode: "PM", limitValue: "0.01", unitCode: "g/kWh" },
    { pollutantCode: "PN", limitValue: "600", unitCode: "e9/kWh" },
    { pollutantCode: "NH3", limitValue: "10", unitCode: "ppm" },
  ] as const;
  for (const scope of scopes) {
    for (const [cycle, rows] of [
      ["WHSC", koreaRoadWhsc],
      ["WHTC", koreaRoadWhtc],
    ] as const) {
      for (const row of rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.koreaRoad2017,
            acceptanceFixtureIds.source.koreaRuleAnnex17,
            {
              ...row,
              applicationScope: scope,
              measurementBasis:
                "대기환경보전법 시행규칙 별표 17 제2호아목 및 비고 5·6 (2017.10.1 적용 기준); NH3 10 ppm은 요소수 분사 저감장치 적용 시에만 해당",
              testCycleCode: cycle,
              validFrom: "2017-10-01",
              verifiedAt: koreaVerificationTimestamp,
            },
          ),
        );
      }
    }
  }

  // 韩国建設機械 원동기 2020-12-01 기준（第4号마목）。表格功率带按
  // [min,max) 记录；PN 原文 1×10^12 #/kWh 按 e9/kWh 缩放存储。
  const koreaConstructionBands: ReadonlyArray<{
    powerMinKw: number;
    powerMaxKw: number;
    rows: ReadonlyArray<{
      pollutantCode: string;
      limitValue: string;
      unitCode: string;
    }>;
  }> = [
    {
      powerMinKw: 0,
      powerMaxKw: 8,
      rows: [
        { pollutantCode: "CO", limitValue: "8.0", unitCode: "g/kWh" },
        { pollutantCode: "HC+NOx", limitValue: "7.5", unitCode: "g/kWh" },
        { pollutantCode: "PM", limitValue: "0.4", unitCode: "g/kWh" },
      ],
    },
    {
      powerMinKw: 8,
      powerMaxKw: 19,
      rows: [
        { pollutantCode: "CO", limitValue: "6.6", unitCode: "g/kWh" },
        { pollutantCode: "HC+NOx", limitValue: "7.5", unitCode: "g/kWh" },
        { pollutantCode: "PM", limitValue: "0.4", unitCode: "g/kWh" },
      ],
    },
    {
      powerMinKw: 19,
      powerMaxKw: 37,
      rows: [
        { pollutantCode: "CO", limitValue: "5.0", unitCode: "g/kWh" },
        { pollutantCode: "HC+NOx", limitValue: "4.7", unitCode: "g/kWh" },
        { pollutantCode: "PM", limitValue: "0.015", unitCode: "g/kWh" },
        { pollutantCode: "PN", limitValue: "1000", unitCode: "e9/kWh" },
        { pollutantCode: "NH3", limitValue: "10", unitCode: "ppm" },
      ],
    },
    {
      powerMinKw: 37,
      powerMaxKw: 56,
      rows: [
        { pollutantCode: "CO", limitValue: "5.0", unitCode: "g/kWh" },
        { pollutantCode: "HC+NOx", limitValue: "4.7", unitCode: "g/kWh" },
        { pollutantCode: "PM", limitValue: "0.015", unitCode: "g/kWh" },
        { pollutantCode: "PN", limitValue: "1000", unitCode: "e9/kWh" },
        { pollutantCode: "NH3", limitValue: "10", unitCode: "ppm" },
      ],
    },
    {
      powerMinKw: 56,
      powerMaxKw: 130,
      rows: [
        { pollutantCode: "CO", limitValue: "5.0", unitCode: "g/kWh" },
        { pollutantCode: "HC", limitValue: "0.19", unitCode: "g/kWh" },
        { pollutantCode: "NOX", limitValue: "0.4", unitCode: "g/kWh" },
        { pollutantCode: "PM", limitValue: "0.015", unitCode: "g/kWh" },
        { pollutantCode: "PN", limitValue: "1000", unitCode: "e9/kWh" },
        { pollutantCode: "NH3", limitValue: "10", unitCode: "ppm" },
      ],
    },
    {
      powerMinKw: 130,
      powerMaxKw: 560,
      rows: [
        { pollutantCode: "CO", limitValue: "3.5", unitCode: "g/kWh" },
        { pollutantCode: "HC", limitValue: "0.19", unitCode: "g/kWh" },
        { pollutantCode: "NOX", limitValue: "0.4", unitCode: "g/kWh" },
        { pollutantCode: "PM", limitValue: "0.015", unitCode: "g/kWh" },
        { pollutantCode: "PN", limitValue: "1000", unitCode: "e9/kWh" },
        { pollutantCode: "NH3", limitValue: "10", unitCode: "ppm" },
      ],
    },
  ];
  for (const band of koreaConstructionBands) {
    for (const row of band.rows) {
      limits.push(
        fixtureLimit(
          acceptanceFixtureIds.regulation.koreaConstruction2020,
          acceptanceFixtureIds.source.koreaRuleAnnex17,
          {
            ...row,
            applicationScope: "construction",
            measurementBasis:
              "대기환경보전법 시행규칙 별표 17 제4호마목 (2020.12.1 적용 기준); NH3 10 ppm은 요소수 분사 저감장치 적용 시에만 해당",
            powerMaxKw: band.powerMaxKw,
            powerMinKw: band.powerMinKw,
            testCycleCode: "NRSC/NRTC",
            validFrom: "2020-12-01",
            verifiedAt: koreaVerificationTimestamp,
          },
        ),
      );
    }
  }

  // 韩国农业機械 원동기 2021-07-01 기준（第5号라목），同一套现行功率带，
  // 但法规生效日和适用 scope 独立记录。
  for (const band of koreaConstructionBands) {
    for (const row of band.rows) {
      limits.push(
        fixtureLimit(
          acceptanceFixtureIds.regulation.koreaAgriculture2021,
          acceptanceFixtureIds.source.koreaRuleAnnex17,
          {
            ...row,
            applicationScope: "agriculture",
            measurementBasis:
              "대기환경보전법 시행규칙 별표 17 제5호라목 (2021.7.1 적용 기준); NH3 10 ppm은 요소수 분사 저감장치 적용 시에만 해당",
            powerMaxKw: band.powerMaxKw,
            powerMinKw: band.powerMinKw,
            testCycleCode: "NRSC/NRTC",
            validFrom: "2021-07-01",
            verifiedAt: koreaVerificationTimestamp,
          },
        ),
      );
    }
  }

  // 墨西哥 NOM-044-SEMARNAT-2017 当前可执行的道路重型柴油标准。
  // 表 1B/2B 原文分别提供美国与欧洲/UN-ECE 认证路径，二者是替代路径而非
  // 同时叠加的污染物要求；当前 schema 无 certification-path 字段，本批保留
  // 两张官方表并在 measurementBasis 中明确测试循环。2021 年官方修订将
  // AA 过渡期延至 2024-12-31，故 B 标准按 2025-01-01 全国可执行日入库。
  const mexicoRoadScopes = ["on-road-truck", "on-road-bus"] as const;
  const mexicoTable1Rows = [
    { pollutantCode: "CO", limitValue: "15.5", unitCode: "g/bhp-hr" },
    { pollutantCode: "NOX", limitValue: "0.20", unitCode: "g/bhp-hr" },
    { pollutantCode: "HCNM", limitValue: "0.14", unitCode: "g/bhp-hr" },
    { pollutantCode: "PM", limitValue: "0.01", unitCode: "g/bhp-hr" },
  ] as const;
  for (const applicationScope of mexicoRoadScopes) {
    for (const row of mexicoTable1Rows) {
      limits.push(
        fixtureLimit(
          acceptanceFixtureIds.regulation.mexicoNom044Table1,
          acceptanceFixtureIds.source.mexicoNom044,
          {
            ...row,
            applicationScope,
            measurementBasis:
              "NOM-044-SEMARNAT-2017 Tabla 1B；Ciclo Transitorio (CT) y Ciclo Suplementario Estable (CSE)；需 15 mg/kg 超低硫柴油；2021 修订后按 2025-01-01 全国可执行日",
            testCycleCode: "CT/CSE",
            validFrom: "2025-01-01",
            verifiedAt: mexicoVerificationTimestamp,
          },
        ),
      );
    }
  }

  const mexicoTable2Cycles = [
    {
      testCycleCode: "CEEMAP",
      rows: [
        { pollutantCode: "CO", limitValue: "1.5", unitCode: "g/kWh" },
        { pollutantCode: "NOX", limitValue: "0.4", unitCode: "g/kWh" },
        { pollutantCode: "HC", limitValue: "0.13", unitCode: "g/kWh" },
        { pollutantCode: "PM", limitValue: "0.01", unitCode: "g/kWh" },
        { pollutantCode: "PN", limitValue: "800", unitCode: "e9/kWh" },
        { pollutantCode: "NH3", limitValue: "10", unitCode: "ppm" },
      ],
    },
    {
      testCycleCode: "CETMAP",
      rows: [
        { pollutantCode: "CO", limitValue: "4.0", unitCode: "g/kWh" },
        { pollutantCode: "NOX", limitValue: "0.46", unitCode: "g/kWh" },
        { pollutantCode: "HC", limitValue: "0.16", unitCode: "g/kWh" },
        { pollutantCode: "PM", limitValue: "0.01", unitCode: "g/kWh" },
        { pollutantCode: "PN", limitValue: "600", unitCode: "e9/kWh" },
        { pollutantCode: "NH3", limitValue: "10", unitCode: "ppm" },
      ],
    },
  ] as const;
  for (const applicationScope of mexicoRoadScopes) {
    for (const cycle of mexicoTable2Cycles) {
      for (const row of cycle.rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.mexicoNom044Table2,
            acceptanceFixtureIds.source.mexicoNom044,
            {
              ...row,
              applicationScope,
              measurementBasis:
                "NOM-044-SEMARNAT-2017 Tabla 2B；欧洲/UN-ECE 循环 CEEMAP/CETMAP；NH3 仅适用于配备尿素/SCR 系统的认证路径；需 15 mg/kg 超低硫柴油；2021 修订后按 2025-01-01 全国可执行日",
              testCycleCode: cycle.testCycleCode,
              validFrom: "2025-01-01",
              verifiedAt: mexicoVerificationTimestamp,
            },
          ),
        );
      }
    }
  }

  // 土耳其 Euro VI 重型道路柴油机限值。2013-09-25 官方公报附件 I
  // 直接列出 WHSC/WHTC CI 行；土耳其原始法规链按 2016-01-01 执行日建模。
  const turkeyRoadWhsc = [
    { pollutantCode: "CO", limitValue: "1500", unitCode: "mg/kWh" },
    { pollutantCode: "THC", limitValue: "130", unitCode: "mg/kWh" },
    { pollutantCode: "NOX", limitValue: "400", unitCode: "mg/kWh" },
    { pollutantCode: "NH3", limitValue: "10", unitCode: "ppm" },
    { pollutantCode: "PM", limitValue: "10", unitCode: "mg/kWh" },
    { pollutantCode: "PN", limitValue: "800", unitCode: "e9/kWh" },
  ] as const;
  const turkeyRoadWhtc = [
    { pollutantCode: "CO", limitValue: "4000", unitCode: "mg/kWh" },
    { pollutantCode: "THC", limitValue: "160", unitCode: "mg/kWh" },
    { pollutantCode: "NOX", limitValue: "460", unitCode: "mg/kWh" },
    { pollutantCode: "NH3", limitValue: "10", unitCode: "ppm" },
    { pollutantCode: "PM", limitValue: "10", unitCode: "mg/kWh" },
    { pollutantCode: "PN", limitValue: "600", unitCode: "e9/kWh" },
  ] as const;
  for (const applicationScope of mexicoRoadScopes) {
    for (const [cycle, rows] of [
      ["WHSC", turkeyRoadWhsc],
      ["WHTC", turkeyRoadWhtc],
    ] as const) {
      for (const row of rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.turkeyRoad2016,
            acceptanceFixtureIds.source.turkeyRoadRegulation,
            {
              ...row,
              applicationScope,
              measurementBasis:
                "2013-09-25 土耳其 Resmî Gazete Euro 6 Ek-I；CI 重型道路发动机限值；PN 原文 #/kWh 按 e9/kWh 缩放存储",
              testCycleCode: cycle,
              validFrom: "2016-01-01",
              verifiedAt: turkeyVerificationTimestamp,
            },
          ),
        );
      }
    }
  }

  // 土耳其 2016/1628/AB NRE Stage V。官方附件表按 NRE 功率带列限值，
  // 2022-10-01 为市场投放日。该法规第 2 条明确排除 AB/167/2013 农林
  // 拖拉机发动机，故只写入 construction；agriculture 保持显式 no-data。
  const turkeyNonroadBands: ReadonlyArray<{
    powerMinKw: number;
    powerMaxKw?: number;
    rows: ReadonlyArray<{
      pollutantCode: string;
      limitValue: string;
      unitCode: string;
    }>;
  }> = [
    {
      powerMinKw: 0.001,
      powerMaxKw: 8,
      rows: [
        { pollutantCode: "CO", limitValue: "8.00", unitCode: "g/kWh" },
        { pollutantCode: "HC+NOx", limitValue: "7.50", unitCode: "g/kWh" },
        { pollutantCode: "PM", limitValue: "0.40", unitCode: "g/kWh" },
      ],
    },
    {
      powerMinKw: 8,
      powerMaxKw: 19,
      rows: [
        { pollutantCode: "CO", limitValue: "6.60", unitCode: "g/kWh" },
        { pollutantCode: "HC+NOx", limitValue: "7.50", unitCode: "g/kWh" },
        { pollutantCode: "PM", limitValue: "0.40", unitCode: "g/kWh" },
      ],
    },
    {
      powerMinKw: 19,
      powerMaxKw: 37,
      rows: [
        { pollutantCode: "CO", limitValue: "5.00", unitCode: "g/kWh" },
        { pollutantCode: "HC+NOx", limitValue: "4.70", unitCode: "g/kWh" },
        { pollutantCode: "PM", limitValue: "0.015", unitCode: "g/kWh" },
        { pollutantCode: "PN", limitValue: "1000", unitCode: "e9/kWh" },
      ],
    },
    {
      powerMinKw: 37,
      powerMaxKw: 56,
      rows: [
        { pollutantCode: "CO", limitValue: "5.00", unitCode: "g/kWh" },
        { pollutantCode: "HC+NOx", limitValue: "4.70", unitCode: "g/kWh" },
        { pollutantCode: "PM", limitValue: "0.015", unitCode: "g/kWh" },
        { pollutantCode: "PN", limitValue: "1000", unitCode: "e9/kWh" },
      ],
    },
    {
      powerMinKw: 56,
      powerMaxKw: 130,
      rows: [
        { pollutantCode: "CO", limitValue: "5.00", unitCode: "g/kWh" },
        { pollutantCode: "HC", limitValue: "0.19", unitCode: "g/kWh" },
        { pollutantCode: "NOX", limitValue: "0.40", unitCode: "g/kWh" },
        { pollutantCode: "PM", limitValue: "0.015", unitCode: "g/kWh" },
        { pollutantCode: "PN", limitValue: "1000", unitCode: "e9/kWh" },
      ],
    },
    {
      powerMinKw: 130,
      powerMaxKw: 560,
      rows: [
        { pollutantCode: "CO", limitValue: "3.50", unitCode: "g/kWh" },
        { pollutantCode: "HC", limitValue: "0.19", unitCode: "g/kWh" },
        { pollutantCode: "NOX", limitValue: "0.40", unitCode: "g/kWh" },
        { pollutantCode: "PM", limitValue: "0.015", unitCode: "g/kWh" },
        { pollutantCode: "PN", limitValue: "1000", unitCode: "e9/kWh" },
      ],
    },
    {
      // The official table says P > 560 kW. Three decimal places let the
      // repository preserve the strict lower boundary without a new field.
      powerMinKw: 560.001,
      rows: [
        { pollutantCode: "CO", limitValue: "3.50", unitCode: "g/kWh" },
        { pollutantCode: "HC", limitValue: "0.19", unitCode: "g/kWh" },
        { pollutantCode: "NOX", limitValue: "3.50", unitCode: "g/kWh" },
        { pollutantCode: "PM", limitValue: "0.045", unitCode: "g/kWh" },
      ],
    },
  ];
  for (const band of turkeyNonroadBands) {
    for (const row of band.rows) {
      limits.push(
        fixtureLimit(
          acceptanceFixtureIds.regulation.turkeyNonroadStageV,
          acceptanceFixtureIds.source.turkeyNonroadAnnex,
          {
            ...row,
            applicationScope: "construction",
            measurementBasis:
              "2020-09-11 土耳其 2016/1628/AB Ek II NRE Stage V；官方表中 P>560 kW 为严格边界；PN 原文 #/kWh 按 e9/kWh 缩放存储",
            powerMaxKw: band.powerMaxKw,
            powerMinKw: band.powerMinKw,
            testCycleCode: "NRSC/NRTC",
            validFrom: "2022-10-01",
            verifiedAt: turkeyVerificationTimestamp,
          },
        ),
      );
    }
  }

  // 澳大利亚 ADR 80/03（Euro V）道路重型车辆限值。当前模型没有 new-model
  // 维度，因此只发布 2011-01-01 全车辆节点到 ADR 80/04 的 2025-11-01
  // 全车辆节点。ELR 烟度行在函数末尾追加，以保持既有 limit UUID 稳定。
  const australiaAdr803Esc = [
    { pollutantCode: "CO", limitValue: "1.5", unitCode: "g/kWh" },
    { pollutantCode: "THC", limitValue: "0.46", unitCode: "g/kWh" },
    { pollutantCode: "NOX", limitValue: "2.0", unitCode: "g/kWh" },
    { pollutantCode: "PM", limitValue: "0.02", unitCode: "g/kWh" },
  ] as const;
  const australiaAdr803Etc = [
    { pollutantCode: "CO", limitValue: "4.0", unitCode: "g/kWh" },
    { pollutantCode: "NMHC", limitValue: "0.55", unitCode: "g/kWh" },
    { pollutantCode: "NOX", limitValue: "2.0", unitCode: "g/kWh" },
    { pollutantCode: "PM", limitValue: "0.03", unitCode: "g/kWh" },
  ] as const;
  for (const applicationScope of scopes) {
    for (const [cycle, rows] of [
      ["ESC", australiaAdr803Esc],
      ["ETC", australiaAdr803Etc],
    ] as const) {
      for (const row of rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.australiaAdr80_03,
            acceptanceFixtureIds.source.australiaAdr80_03,
            {
              ...row,
              applicationScope,
              measurementBasis:
                "ADR 80/03 clause 4.1.1 and Appendix A section 6.2.1 row B2; diesel engines must satisfy ESC/ELR Table 1 and ETC Table 2; full-coverage interval starts 2011-01-01 and ends before ADR 80/04 applies to all vehicles on 2025-11-01",
              testCycleCode: cycle,
              validFrom: "2011-01-01",
              validTo: "2025-11-01",
              verifiedAt: australiaVerificationTimestamp,
            },
          ),
        );
      }
    }
  }

  // 澳大利亚 ADR 80/04 Euro VI 等效道路标准。Appendix A section 5.3 Table 1
  // 直接给出柴油 CI 的完整 WHSC/WHTC 表。既有 NOx/PM UUID 保持不变；其余
  // CO/THC/NH3/PN 行在函数末尾追加。
  const australiaAdr804Limits = [
    {
      cycle: "WHSC",
      rows: [
        { pollutantCode: "NOX", limitValue: "400", unitCode: "mg/kWh" },
        { pollutantCode: "PM", limitValue: "10", unitCode: "mg/kWh" },
      ],
    },
    {
      cycle: "WHTC",
      rows: [
        { pollutantCode: "NOX", limitValue: "460", unitCode: "mg/kWh" },
        { pollutantCode: "PM", limitValue: "10", unitCode: "mg/kWh" },
      ],
    },
  ] as const;
  for (const applicationScope of scopes) {
    for (const cycle of australiaAdr804Limits) {
      for (const row of cycle.rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.australiaAdr80_04,
            acceptanceFixtureIds.source.australiaAdr80_04,
            {
              ...row,
              applicationScope,
              measurementBasis:
                "ADR 80/04 Appendix A section 5.3 Table 1, compression-ignition engine; complete WHSC/WHTC Euro VI Stage C representative pathway; US and Japan standards are alternatives and are not cumulative",
              testCycleCode: cycle.cycle,
              validFrom: "2025-11-01",
              verifiedAt: australiaVerificationTimestamp,
            },
          ),
        );
      }
    }
  }

  // 加拿大道路法规 SOR/2003-2 第 16(2) 直接采用对应机型年的 40 CFR 86.11。
  // 保留既有 NOx/PM 行在 builder 中的位置以维持 UUID 稳定；同一路径缺失的
  // CO/NMHC 行在 builder 末尾追加。
  const canadaRoadMeasurementBasis =
    "SOR/2003-2 s.16(2) dynamically incorporates 40 CFR 86.007-11; MY2010+ petroleum-diesel engine-certified HDE representative pathway for GVWR > 14,000 lb; CFR source values are in g/bhp-hr and are stored in the schema's g/hp-hr unit; FTP/SET base standards are published without accumulating ABT/FEL, NTE, smoke, crankcase, or chassis-certified alternative requirements";
  const canadaRoadRepresentativeLimits = [
    { pollutantCode: "NOX", limitValue: "0.20", unitCode: "g/hp-hr" },
    { pollutantCode: "PM", limitValue: "0.01", unitCode: "g/hp-hr" },
  ] as const;
  for (const applicationScope of scopes) {
    for (const row of canadaRoadRepresentativeLimits) {
      limits.push(
        fixtureLimit(
          acceptanceFixtureIds.regulation.canadaRoad2003,
          acceptanceFixtureIds.source.usEcfr86,
          {
            ...row,
            applicationScope,
            measurementBasis: canadaRoadMeasurementBasis,
            testCycleCode: "FTP/SET",
            validFrom: "2010-01-01",
            verifiedAt: canadaVerificationTimestamp,
          },
        ),
      );
    }
  }

  // 加拿大非道路法规 SOR/2020-258 第 10(1)(a) 引用 40 CFR 1039.101(a)-(c)、
  // (e)、(f)。保留既有 NOx/PM/NMHC 行的位置；缺失 CO 行在 builder 末尾追加。
  const canadaOffroadMeasurementBasis =
    "SOR/2020-258 s.10(1)(a) and s.1(4) incorporate 40 CFR 1039.101 standards and the associated calculation methods; variable-speed mobile compression-ignition Tier 4 representative pathway through 560 kW. Maximum engine power is first rounded to the nearest whole kilowatt under 40 CFR 1039.140 using the ties-to-even convention in 40 CFR 1065.20(e), and the stored three-decimal query bounds encode that classification. Appendix VI NRTC and the applicable Appendix II NRSC cycle use the same Table 1 values; below 19 kW NRSC is 6-mode or eligible 8-mode/RMC, and from 19 through 560 kW it is C1 8-mode or RMC. Table 1 footnotes set CO 8.0 below 8 kW and CO 5.5 below 37 kW. >560 kW application splits, ABT/FEL, NTE, smoke, crankcase, constant-speed, optional sub-8 kW PM, and alternative-engine pathways are not accumulated";
  const canadaOffroadTier4 = [
    { pollutantCode: "NOX", limitValue: "0.40", unitCode: "g/kWh" },
    { pollutantCode: "PM", limitValue: "0.02", unitCode: "g/kWh" },
    { pollutantCode: "NMHC", limitValue: "0.19", unitCode: "g/kWh" },
  ] as const;
  for (const applicationScope of ["construction", "agriculture"] as const) {
    for (const row of canadaOffroadTier4) {
      limits.push(
        fixtureLimit(
          acceptanceFixtureIds.regulation.canadaOffroad2020,
          acceptanceFixtureIds.source.usEcfr1039,
          {
            ...row,
            applicationScope,
            measurementBasis: canadaOffroadMeasurementBasis,
            powerMinKw: cfr1039RoundedPowerBounds.from130MinKw,
            powerMaxKw: cfr1039RoundedPowerBounds.through560MaxKw,
            testCycleCode: "NRTC AND NRSC-C1 (8-mode OR RMC)",
            validFrom: "2021-06-04",
            verifiedAt: canadaVerificationTimestamp,
          },
        ),
      );
    }
  }

  // 印度 BS VI：G.S.R. 889(E) PDF p.29，GVW > 3,500 kg 的压燃发动机。
  // PN 按项目统一的 e9/kWh 缩放单位存储。
  const indiaBs6Whsc = [
    { pollutantCode: "CO", limitValue: "1500", unitCode: "mg/kWh" },
    { pollutantCode: "THC", limitValue: "130", unitCode: "mg/kWh" },
    { pollutantCode: "NOX", limitValue: "400", unitCode: "mg/kWh" },
    { pollutantCode: "NH3", limitValue: "10", unitCode: "ppm" },
    { pollutantCode: "PM", limitValue: "10", unitCode: "mg/kWh" },
    { pollutantCode: "PN", limitValue: "800", unitCode: "e9/kWh" },
  ] as const;
  const indiaBs6Whtc = [
    { pollutantCode: "CO", limitValue: "4000", unitCode: "mg/kWh" },
    { pollutantCode: "THC", limitValue: "160", unitCode: "mg/kWh" },
    { pollutantCode: "NOX", limitValue: "460", unitCode: "mg/kWh" },
    { pollutantCode: "NH3", limitValue: "10", unitCode: "ppm" },
    { pollutantCode: "PM", limitValue: "10", unitCode: "mg/kWh" },
    { pollutantCode: "PN", limitValue: "600", unitCode: "e9/kWh" },
  ] as const;
  for (const applicationScope of scopes) {
    for (const [testCycleCode, rows] of [
      ["WHSC", indiaBs6Whsc],
      ["WHTC", indiaBs6Whtc],
    ] as const) {
      for (const row of rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.indiaBs6,
            acceptanceFixtureIds.source.indiaBs6,
            {
              ...row,
              applicationScope,
              measurementBasis:
                "G.S.R. 889(E), BS VI CI engine limits for M/N vehicles with GVW above 3,500 kg",
              testCycleCode,
              validFrom: "2020-04-01",
              verifiedAt: indiaVerificationTimestamp,
            },
          ),
        );
      }
    }
  }

  // G.S.R. 598(E) Table 1：CEV-IV 与 TREM-IV 使用相同技术限值，但实施日
  // 分别为 2021-04-01 和经 G.S.R. 850(E) 延期后的 2023-01-01。
  const indiaStageIvBands: ReadonlyArray<{
    powerMinKw: number;
    powerMaxKw: number;
    rows: ReadonlyArray<{
      pollutantCode: string;
      limitValue: string;
    }>;
  }> = [
    {
      powerMinKw: 37,
      powerMaxKw: 56,
      rows: [
        { pollutantCode: "CO", limitValue: "5.0" },
        { pollutantCode: "HC+NOx", limitValue: "4.7" },
        { pollutantCode: "PM", limitValue: "0.025" },
      ],
    },
    {
      powerMinKw: 56,
      powerMaxKw: 130,
      rows: [
        { pollutantCode: "CO", limitValue: "5.0" },
        { pollutantCode: "HC", limitValue: "0.19" },
        { pollutantCode: "NOX", limitValue: "0.4" },
        { pollutantCode: "PM", limitValue: "0.025" },
      ],
    },
    {
      powerMinKw: 130,
      powerMaxKw: 560,
      rows: [
        { pollutantCode: "CO", limitValue: "3.5" },
        { pollutantCode: "HC", limitValue: "0.19" },
        { pollutantCode: "NOX", limitValue: "0.4" },
        { pollutantCode: "PM", limitValue: "0.025" },
      ],
    },
  ];
  for (const stage of [
    {
      applicationScope: "construction" as const,
      regulationId: acceptanceFixtureIds.regulation.indiaCevStageIv,
      validFrom: "2021-04-01",
      validTo: "2024-04-01",
    },
    {
      applicationScope: "agriculture" as const,
      regulationId: acceptanceFixtureIds.regulation.indiaTremStageIv,
      validFrom: "2023-01-01",
      validTo: "2026-04-01",
    },
  ]) {
    for (const band of indiaStageIvBands) {
      for (const row of band.rows) {
        limits.push(
          fixtureLimit(
            stage.regulationId,
            acceptanceFixtureIds.source.indiaCevTrem,
            {
              applicationScope: stage.applicationScope,
              limitValue: row.limitValue,
              measurementBasis:
                "G.S.R. 598(E), Rule 115A, Table 1 (CEV-IV/TREM-IV)",
              pollutantCode: row.pollutantCode,
              powerMaxKw: band.powerMaxKw,
              powerMinKw: band.powerMinKw,
              testCycleCode: "NRSC/NRTC",
              unitCode: "g/kWh",
              validFrom: stage.validFrom,
              validTo: stage.validTo,
              verifiedAt: indiaVerificationTimestamp,
            },
          ),
        );
      }
    }
  }

  // G.S.R. 598(E) Table 2：CEV-V 与 TREM-V 技术表相同；CEV-V 自
  // 2024-04-01，TREM-V 经 G.S.R. 141(E) 延至 2026-04-01。
  for (const stage of [
    {
      applicationScope: "construction" as const,
      regulationId: acceptanceFixtureIds.regulation.indiaCevStageV,
      validFrom: "2024-04-01",
    },
    {
      applicationScope: "agriculture" as const,
      regulationId: acceptanceFixtureIds.regulation.indiaTremStageV,
      validFrom: "2026-04-01",
    },
  ]) {
    for (const band of stageVBands) {
      const testCycleCode =
        (band.powerMaxKw !== undefined && band.powerMaxKw <= 19) ||
        band.powerMinKw >= 560
          ? "NRSC"
          : "NRSC/NRTC";
      for (const row of band.rows) {
        limits.push(
          fixtureLimit(
            stage.regulationId,
            acceptanceFixtureIds.source.indiaCevTrem,
            {
              applicationScope: stage.applicationScope,
              limitValue: row.limitValue,
              measurementBasis:
                "G.S.R. 598(E), Rule 115A, Table 2 (CEV-V/TREM-V)",
              pollutantCode: row.pollutantCode,
              powerMaxKw: band.powerMaxKw,
              powerMinKw: band.powerMinKw,
              testCycleCode,
              unitCode: row.pollutantCode === "PN" ? "e9/kWh" : "g/kWh",
              validFrom: stage.validFrom,
              verifiedAt: indiaVerificationTimestamp,
            },
          ),
        );
      }
    }
  }

  // 俄罗斯道路生态等级 5：TR CU 018/2011 附件 1 表 3 与附件 2 第 39 项
  // 指向 UN R49-05 B2/C。这里保存最低 B2 柴油限值；2018 年为新车型切换，
  // 2019-01-01 是 M2/M3/N 既有车型完成切换的保守统一起点。
  const russiaClass5EscElr = [
    { pollutantCode: "NOX", limitValue: "2", unitCode: "g/kWh" },
    { pollutantCode: "HC", limitValue: "0.46", unitCode: "g/kWh" },
    { pollutantCode: "CO", limitValue: "1.5", unitCode: "g/kWh" },
    { pollutantCode: "PM", limitValue: "0.02", unitCode: "g/kWh" },
    { pollutantCode: "OPACITY", limitValue: "0.5", unitCode: "m-1" },
    { pollutantCode: "NH3", limitValue: "25", unitCode: "ppm" },
  ] as const;
  const russiaClass5Etc = [
    { pollutantCode: "NOX", limitValue: "2", unitCode: "g/kWh" },
    { pollutantCode: "CO", limitValue: "4", unitCode: "g/kWh" },
    { pollutantCode: "PM", limitValue: "0.03", unitCode: "g/kWh" },
    { pollutantCode: "NMHC", limitValue: "0.55", unitCode: "g/kWh" },
    { pollutantCode: "NH3", limitValue: "25", unitCode: "ppm" },
  ] as const;
  for (const applicationScope of scopes) {
    for (const [testCycleCode, rows] of [
      ["ESC/ELR", russiaClass5EscElr],
      ["ETC", russiaClass5Etc],
    ] as const) {
      for (const row of rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.russiaRoadClass5,
            acceptanceFixtureIds.source.russiaUneceR49,
            {
              ...row,
              applicationScope,
              measurementBasis:
                "TR CU 018/2011 Annex 1 Table 3 and Annex 2 item 39; UN R49-05 minimum emission level B2 for compression-ignition heavy-duty engines",
              testCycleCode,
              validFrom: "2019-01-01",
              verifiedAt: russiaVerificationTimestamp,
            },
          ),
        );
      }
    }
  }

  // 俄罗斯农业拖拉机生态等级 3A：Decision 127/2021 改写后的表 5.1。
  // Decision 32/2024 将 J/K 切换到 2025-01-01、H/I 切换到 2025-10-01。
  // numeric(12,3) 下以 19.001 表达 P>19、以 560.001 表达 P≤560。
  const russiaTractorClass3ABands = [
    {
      powerMinKw: 19.001,
      powerMaxKw: 37,
      validFrom: "2025-01-01",
      rows: [
        { pollutantCode: "CO", limitValue: "5.5" },
        { pollutantCode: "HC+NOx", limitValue: "7.5" },
        { pollutantCode: "PM", limitValue: "0.6" },
      ],
    },
    {
      powerMinKw: 37,
      powerMaxKw: 75,
      validFrom: "2025-01-01",
      rows: [
        { pollutantCode: "CO", limitValue: "5.0" },
        { pollutantCode: "HC+NOx", limitValue: "4.7" },
        { pollutantCode: "PM", limitValue: "0.4" },
      ],
    },
    {
      powerMinKw: 75,
      powerMaxKw: 130,
      validFrom: "2025-10-01",
      rows: [
        { pollutantCode: "CO", limitValue: "5.0" },
        { pollutantCode: "HC+NOx", limitValue: "4.0" },
        { pollutantCode: "PM", limitValue: "0.3" },
      ],
    },
    {
      powerMinKw: 130,
      powerMaxKw: 560.001,
      validFrom: "2025-10-01",
      rows: [
        { pollutantCode: "CO", limitValue: "3.5" },
        { pollutantCode: "HC+NOx", limitValue: "4.0" },
        { pollutantCode: "PM", limitValue: "0.2" },
      ],
    },
  ] as const;
  for (const band of russiaTractorClass3ABands) {
    for (const row of band.rows) {
      limits.push(
        fixtureLimit(
          acceptanceFixtureIds.regulation.russiaAgricultureClass3A,
          acceptanceFixtureIds.source.russiaAgricultureAmendment2021,
          {
            applicationScope: "agriculture",
            limitValue: row.limitValue,
            measurementBasis:
              "EEC Council Decision 127/2021, TR CU 031/2012 Annex 5 clause 14.1, Table 5.1; dates as amended by Decision 32/2024",
            pollutantCode: row.pollutantCode,
            powerMaxKw: band.powerMaxKw,
            powerMinKw: band.powerMinKw,
            testCycleCode: "UN R96-02",
            unitCode: "g/kWh",
            validFrom: band.validFrom,
            verifiedAt: russiaVerificationTimestamp,
          },
        ),
      );
    }
  }

  // Kazakhstan and Kyrgyzstan apply the TR CU 018 ecological-class-5
  // UN R49-05 B2/C route. Store one complete B2 route per road scope: C/EEV
  // is a legal alternative, not an additional set of cumulative limits.
  const centralAsiaRoadB2Cycles = [
    {
      rows: [
        { pollutantCode: "CO", limitValue: "1.5", unitCode: "g/kWh" },
        { pollutantCode: "HC", limitValue: "0.46", unitCode: "g/kWh" },
        { pollutantCode: "NOX", limitValue: "2", unitCode: "g/kWh" },
        { pollutantCode: "PM", limitValue: "0.02", unitCode: "g/kWh" },
      ],
      testCycleCode: "ESC",
    },
    {
      rows: [
        { pollutantCode: "CO", limitValue: "4", unitCode: "g/kWh" },
        { pollutantCode: "NMHC", limitValue: "0.55", unitCode: "g/kWh" },
        { pollutantCode: "NOX", limitValue: "2", unitCode: "g/kWh" },
        { pollutantCode: "PM", limitValue: "0.03", unitCode: "g/kWh" },
      ],
      testCycleCode: "ETC",
    },
    {
      rows: [
        { pollutantCode: "OPACITY", limitValue: "0.5", unitCode: "m-1" },
      ],
      testCycleCode: "ELR",
    },
  ] as const;
  for (const country of [
    {
      regulationId: acceptanceFixtureIds.regulation.kazakhstanRoadClass5,
      verifiedAt: kazakhstanVerificationTimestamp,
    },
    {
      regulationId: acceptanceFixtureIds.regulation.kyrgyzstanRoadClass5,
      verifiedAt: kyrgyzstanVerificationTimestamp,
    },
  ] as const) {
    for (const applicationScope of scopes) {
      for (const cycle of centralAsiaRoadB2Cycles) {
        for (const row of cycle.rows) {
          limits.push(
            fixtureLimit(
              country.regulationId,
              acceptanceFixtureIds.source.uneceR49Rev4,
              {
                ...row,
                applicationScope,
                measurementBasis:
                  "TR CU 018/2011 Annex 2 item 39 and UN R49-05 B2 compression-ignition route. C/EEV is an alternative and is not cumulative: ESC CO 1.5, HC 0.25, NOx 2, PM 0.02 g/kWh; ETC CO 3, NMHC 0.40, NOx 2, PM 0.02 g/kWh; ELR smoke 0.15 m-1",
                testCycleCode: cycle.testCycleCode,
                validFrom: "2019-01-01",
                verifiedAt: country.verifiedAt,
              },
            ),
          );
        }
      }
    }
  }

  // Kazakhstan and Kyrgyzstan publish all currently effective Stage IIIA
  // tractor bands. The schema stores upper bounds exclusively, so 19.001
  // models P>19 and 560.001 models P≤560 at numeric(12,3) precision.
  for (const country of [
    {
      regulationId:
        acceptanceFixtureIds.regulation.kazakhstanAgricultureStageIIIA,
      sourceId: acceptanceFixtureIds.source.kazakhstanAgricultureRegulation,
      verifiedAt: kazakhstanVerificationTimestamp,
    },
    {
      regulationId:
        acceptanceFixtureIds.regulation.kyrgyzstanAgricultureStageIIIA,
      sourceId: acceptanceFixtureIds.source.kyrgyzstanAgricultureRegulation,
      verifiedAt: kyrgyzstanVerificationTimestamp,
    },
  ] as const) {
    for (const band of russiaTractorClass3ABands) {
      for (const row of band.rows) {
        limits.push(
          fixtureLimit(country.regulationId, country.sourceId, {
            applicationScope: "agriculture",
            limitValue: row.limitValue,
            measurementBasis:
              "TR CU 031/2012 Annex 5 clause 14.1 and Table 5.1, as amended by EEC Decisions 127/2021 and 32/2024; Stage IIIA rated net-power bands",
            pollutantCode: row.pollutantCode,
            powerMaxKw: band.powerMaxKw,
            powerMinKw: band.powerMinKw,
            testCycleCode: "UN R96-02",
            unitCode: "g/kWh",
            validFrom: band.validFrom,
            verifiedAt: country.verifiedAt,
          }),
        );
      }
    }
  }

  // Armenia, Belarus and Georgia each close a country-specific legal chain to
  // UN R49-05 B2. Store exactly one representative B2 path per road scope;
  // C/EEV and the ETC THC substitution remain alternatives, never extra rows.
  for (const country of [
    {
      measurementBasis:
        "Armenia TR CU 018/2011 Annex 2 item 39, ecological-class-5 heavy-duty M/N vehicles and UN R49-05 B2. C/EEV is an alternative and is not cumulative; ETC THC 0.55 g/kWh may substitute for NMHC 0.55 g/kWh. NH3 25 ppm applies only to reagent-requiring systems and is not an unconditional row",
      regulationId: acceptanceFixtureIds.regulation.armeniaRoadClass5,
      validFrom: "2019-01-01",
    },
    {
      measurementBasis:
        "Belarus TR CU 018/2011 Annex 2 item 39, ecological-class-5 heavy-duty M/N vehicles and UN R49-05 B2. C/EEV is an alternative and is not cumulative; ETC THC 0.55 g/kWh may substitute for NMHC 0.55 g/kWh. NH3 25 ppm applies only to reagent-requiring systems and is not an unconditional row",
      regulationId: acceptanceFixtureIds.regulation.belarusRoadClass5,
      validFrom: "2019-01-01",
    },
    {
      measurementBasis:
        "Georgia Resolution No. 238 current Matsne publication 12: new N3 trucks and M3 buses only, with steady-state/load-response/transient tests normalized to ESC/ELR/ETC and the UN R49-05 B2 compression-ignition route. C/EEV and ETC THC are alternatives, not cumulative; no diesel CH4, PN or older >2,610 kg extension",
      regulationId: acceptanceFixtureIds.regulation.georgiaRoadClass5,
      validFrom: "2025-01-01",
    },
  ] as const) {
    for (const applicationScope of scopes) {
      for (const cycle of centralAsiaRoadB2Cycles) {
        for (const row of cycle.rows) {
          limits.push(
            fixtureLimit(
              country.regulationId,
              acceptanceFixtureIds.source.uneceR49Rev4,
              {
                ...row,
                applicationScope,
                measurementBasis: country.measurementBasis,
                testCycleCode: cycle.testCycleCode,
                validFrom: country.validFrom,
                verifiedAt: caucasusVerificationTimestamp,
              },
            ),
          );
        }
      }
    }
  }

  // TR CU 031/2012 applies the same four Stage IIIA rated-power bands in
  // Armenia and Belarus. Upper bounds are exclusive in the schema, hence
  // 19.001 models P>19 and 560.001 models P≤560 at numeric(12,3) precision.
  for (const country of [
    {
      regulationId: acceptanceFixtureIds.regulation.armeniaAgricultureStageIIIA,
      sourceId: acceptanceFixtureIds.source.armeniaTrCu031Consolidated,
    },
    {
      regulationId: acceptanceFixtureIds.regulation.belarusAgricultureStageIIIA,
      sourceId: acceptanceFixtureIds.source.belarusTrCu031,
    },
  ] as const) {
    for (const band of russiaTractorClass3ABands) {
      for (const row of band.rows) {
        limits.push(
          fixtureLimit(country.regulationId, country.sourceId, {
            applicationScope: "agriculture",
            limitValue: row.limitValue,
            measurementBasis:
              "TR CU 031/2012 Annex 5 clause 14.1 and Table 5.1, as amended by EEC Decisions 127/2021 and 32/2024; Stage IIIA rated net-power bands. The small-size tractor exclusion also depends on intended purpose and is not a power-only exclusion",
            pollutantCode: row.pollutantCode,
            powerMaxKw: band.powerMaxKw,
            powerMinKw: band.powerMinKw,
            testCycleCode: "UN R96-02",
            unitCode: "g/kWh",
            validFrom: band.validFrom,
            verifiedAt: caucasusVerificationTimestamp,
          }),
        );
      }
    }
  }

  // Uzbekistan's official text was closed only for the current H band. The
  // preceding Stage II transition and undated Stage V path are evidence notes,
  // not additional current rows.
  for (const row of [
    { pollutantCode: "CO", limitValue: "3.5" },
    { pollutantCode: "HC+NOx", limitValue: "4.0" },
    { pollutantCode: "PM", limitValue: "0.2" },
  ] as const) {
    limits.push(
      fixtureLimit(
        acceptanceFixtureIds.regulation.uzbekistanAgricultureStageIIIA,
        acceptanceFixtureIds.source.uzbekistanAgricultureRegulation,
        {
          applicationScope: "agriculture",
          limitValue: row.limitValue,
          measurementBasis:
            "UzTR.10-006:2025 current H/Stage IIIA rated-power band. Stage II applied only from 2025-09-13 through 2025-09-30; the future Stage V date is not fixed. Those alternatives are not accumulated or published as current limits",
          pollutantCode: row.pollutantCode,
          powerMaxKw: 560.001,
          powerMinKw: 130,
          testCycleCode: "NRSC",
          unitCode: "g/kWh",
          validFrom: "2025-10-01",
          verifiedAt: uzbekistanVerificationTimestamp,
        },
      ),
    );
  }

  // Bangladesh and Bolivia each publish the same four-pollutant Euro II-era
  // heavy-duty compression-ignition values through independent national legal
  // chains. Keep the two paths separate and do not infer non-road coverage.
  const finalBatchHeavyDieselRows = [
    { pollutantCode: "CO", limitValue: "4.0", unitCode: "g/kWh" },
    { pollutantCode: "HC", limitValue: "1.1", unitCode: "g/kWh" },
    { pollutantCode: "NOX", limitValue: "7.0", unitCode: "g/kWh" },
    { pollutantCode: "PM", limitValue: "0.15", unitCode: "g/kWh" },
  ] as const;
  for (const country of [
    {
      measurementBasis:
        "Bangladesh Air Pollution (Control) Rules 2022 Schedule 2 item 1(b): new compression-ignition heavy-duty vehicle with gross vehicle weight >3,500 kg; 88/77/EEC as amended by 91/542/EEC; effective immediately on 2022-07-26",
      regulationId: acceptanceFixtureIds.regulation.bangladeshHeavyDiesel2022,
      sourceId: acceptanceFixtureIds.source.bangladeshAirPollutionRules2022,
      testCycleCode: "88/77/EEC (91/542/EEC)",
      validFrom: "2022-07-26",
      verifiedAt: bangladeshVerificationTimestamp,
    },
    {
      measurementBasis:
        "Bolivia RM 064/2022 Annex III Table 4: model-year 2017 and later N2/N3/M2/M3 diesel vehicle with gross vehicle weight >3,500 kg; ECE 49 representative route. The US heavy-duty transient route is an alternative and is not cumulative",
      regulationId: acceptanceFixtureIds.regulation.boliviaRm064HeavyDiesel,
      sourceId: acceptanceFixtureIds.source.boliviaRm064Regulation,
      testCycleCode: "ECE 49",
      validFrom: "2022-04-01",
      verifiedAt: boliviaVerificationTimestamp,
    },
    {
      measurementBasis:
        "NTE INEN 2207(1R):2002 section 6.2.1 Table 2 (European cycles): N2/N3/M2/M3 diesel vehicle with gross vehicle weight >3,500 kg, all reference weights, sea-level ECE-49 engine test; Table 2 footnote (3) supplies g/kWh for the heavy-duty row. RTE INEN 017:2008 sections 5.2 and 6.2(b) incorporate the standard and require its tests before imported or domestically assembled vehicles enter circulation. The US heavy-duty transient route and supplemental opacity test are alternatives or additional checks and are not cumulative",
      regulationId:
        acceptanceFixtureIds.regulation.ecuadorHeavyDieselRte017,
      sourceId: acceptanceFixtureIds.source.ecuadorDieselStandard2207,
      testCycleCode: "ECE-49",
      validFrom: "2009-02-07",
      verifiedAt: ecuadorVerificationTimestamp,
    },
    {
      measurementBasis:
        "Pakistan S.R.O. 72(KE)/2009 Annex III(b): Pak-II heavy-duty diesel engines, category Trucks and Buses, four limits in g/kWh, ECE-R-49 measuring method; applies to all imported and locally manufactured diesel vehicles from 2012-07-01. The separate large-goods-vehicle row is not accumulated",
      regulationId: acceptanceFixtureIds.regulation.pakistanHeavyDieselPakIi,
      sourceId: acceptanceFixtureIds.source.pakistanSro72GazetteScan,
      testCycleCode: "ECE-R-49",
      validFrom: "2012-07-01",
      verifiedAt: pakistanVerificationTimestamp,
    },
  ] as const) {
    for (const applicationScope of scopes) {
      for (const row of finalBatchHeavyDieselRows) {
        limits.push(
          fixtureLimit(country.regulationId, country.sourceId, {
            ...row,
            applicationScope,
            measurementBasis: country.measurementBasis,
            testCycleCode: country.testCycleCode,
            validFrom: country.validFrom,
            verifiedAt: country.verifiedAt,
          }),
        );
      }
    }
  }

  // Philippine LTO MC AVT-2015-1946 makes Euro IV mandatory for all new
  // vehicles from 2016-01-01. DENR-EMB's implementation table identifies the
  // heavy-duty diesel values by engine energy output, and the national COC
  // chain points to UN R49-04. Publish the complete B1 CI ESC/ELR/ETC path;
  // the R83 route available to eligible lower-reference-mass vehicles is an
  // alternative and must not be accumulated.
  const philippinesEuroIvEsc = [
    { pollutantCode: "CO", limitValue: "1.5", unitCode: "g/kWh" },
    { pollutantCode: "HC", limitValue: "0.46", unitCode: "g/kWh" },
    { pollutantCode: "NOX", limitValue: "3.5", unitCode: "g/kWh" },
    { pollutantCode: "PM", limitValue: "0.02", unitCode: "g/kWh" },
  ] as const;
  for (const applicationScope of scopes) {
    for (const [testCycleCode, rows] of [
      ["ESC", philippinesEuroIvEsc],
      [
        "ETC",
        [
          { pollutantCode: "CO", limitValue: "4.0", unitCode: "g/kWh" },
          {
            pollutantCode: "NMHC",
            limitValue: "0.55",
            unitCode: "g/kWh",
          },
          { pollutantCode: "NOX", limitValue: "3.5", unitCode: "g/kWh" },
          { pollutantCode: "PM", limitValue: "0.03", unitCode: "g/kWh" },
        ],
      ],
    ] as const) {
      for (const row of rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.philippinesHeavyDieselEuroIv,
            acceptanceFixtureIds.source.uneceR49Rev4,
            {
              ...row,
              applicationScope,
              measurementBasis:
                "LTO MC AVT-2015-1946: Euro 4/IV for all new vehicles introduced from 2016-01-01; DENR-EMB page 12: heavy-duty diesel values defined by engine energy output; national COC notice incorporates UN R49-04. B1 compression-ignition path: M3/N3 use R49; eligible M2/N2 may use R49 or the alternative R83 route, which is not cumulative",
              testCycleCode,
              validFrom: "2016-01-01",
              verifiedAt: philippinesVerificationTimestamp,
            },
          ),
        );
      }
    }
    limits.push(
      fixtureLimit(
        acceptanceFixtureIds.regulation.philippinesHeavyDieselEuroIv,
        acceptanceFixtureIds.source.uneceR49Rev4,
        {
          applicationScope,
          limitValue: "0.5",
          measurementBasis:
            "LTO MC AVT-2015-1946 applies Euro IV to all new vehicles from 2016-01-01 and the national COC notice incorporates UN R49-04; B1 compression-ignition ELR smoke limit. R83 is an alternative for eligible lower-reference-mass vehicles and is not cumulative",
          pollutantCode: "OPACITY",
          testCycleCode: "ELR",
          unitCode: "m-1",
          validFrom: "2016-01-01",
          verifiedAt: philippinesVerificationTimestamp,
        },
      ),
    );
  }

  // Rwanda's gazetted RS EAS 1047:2022 new-vehicle type-approval pathway
  // requires Euro IV for heavy-duty road vehicles. Publish the complete UN
  // R49-04 B1 compression-ignition ESC/ELR/ETC route for truck and bus only;
  // the national implementation chain does not establish non-road classes.
  const rwandaEuroIvEsc = [
    { pollutantCode: "CO", limitValue: "1.5", unitCode: "g/kWh" },
    { pollutantCode: "HC", limitValue: "0.46", unitCode: "g/kWh" },
    { pollutantCode: "NOX", limitValue: "3.5", unitCode: "g/kWh" },
    { pollutantCode: "PM", limitValue: "0.02", unitCode: "g/kWh" },
  ] as const;
  const rwandaEuroIvEtc = [
    { pollutantCode: "CO", limitValue: "4.0", unitCode: "g/kWh" },
    { pollutantCode: "NMHC", limitValue: "0.55", unitCode: "g/kWh" },
    { pollutantCode: "NOX", limitValue: "3.5", unitCode: "g/kWh" },
    { pollutantCode: "PM", limitValue: "0.03", unitCode: "g/kWh" },
  ] as const;
  for (const applicationScope of scopes) {
    for (const [testCycleCode, rows] of [
      ["ESC", rwandaEuroIvEsc],
      ["ETC", rwandaEuroIvEtc],
    ] as const) {
      for (const row of rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.rwandaRoadEuroIv,
            acceptanceFixtureIds.source.uneceR49Rev4,
            {
              ...row,
              applicationScope,
              measurementBasis:
                "Ministerial Order No. 02/2018 establishes Rwanda's air-emission standards chain; Rwanda Standards Board Official Gazette No. 04 of 23/01/2023 gazettes RS EAS 1047:2022, whose verified implementation material requires Euro IV type approval for new heavy-duty M2/M3/N2/N3 diesel road vehicles. UN R49-04 B1 compression-ignition representative pathway; alternative routes are not cumulative",
              testCycleCode,
              validFrom: "2023-01-23",
              verifiedAt: rwandaVerificationTimestamp,
            },
          ),
        );
      }
    }
    limits.push(
      fixtureLimit(
        acceptanceFixtureIds.regulation.rwandaRoadEuroIv,
        acceptanceFixtureIds.source.uneceR49Rev4,
        {
          applicationScope,
          limitValue: "0.5",
          measurementBasis:
            "Ministerial Order No. 02/2018 establishes Rwanda's air-emission standards chain; Rwanda Standards Board Official Gazette No. 04 of 23/01/2023 gazettes RS EAS 1047:2022, whose verified implementation material requires Euro IV type approval for new heavy-duty M2/M3/N2/N3 diesel road vehicles. UN R49-04 B1 compression-ignition ELR smoke limit; alternative routes are not cumulative",
          pollutantCode: "OPACITY",
          testCycleCode: "ELR",
          unitCode: "m-1",
          validFrom: "2023-01-23",
          verifiedAt: rwandaVerificationTimestamp,
        },
      ),
    );
  }

  // Israel's CY2026 road IMR incorporates the current EU WVTA Euro VI acts.
  // Publish the compression-ignition WHSC/WHTC representative route, while
  // preserving the calendar-year snapshot and alternative-framework caveats.
  for (const applicationScope of scopes) {
    for (const [testCycleCode, rows] of [
      ["WHSC", euro6Whsc],
      ["WHTC", euro6Whtc],
    ] as const) {
      for (const row of rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.israelRoadEuroVi2026,
            acceptanceFixtureIds.source.euReg595,
            {
              ...row,
              applicationScope,
              measurementBasis:
                "Israel IMR CY2026 chapter 1 and chapter 3.1: M2/M3 bus and N2/N3 goods-vehicle imports under current EU WVTA; Annex II item 41A incorporates Euro VI heavy-duty Regulation 595/2009. M3/N3 are covered and M2/N2 use the heavy-duty path above 2,610 kg reference mass. 2026-01-01 is a normalized current-calendar-year snapshot, not Israel's historical first adoption date. EU/ECE and US/Canadian frameworks are alternatives and are not cumulative",
              testCycleCode,
              validFrom: "2026-01-01",
              verifiedAt: israelVerificationTimestamp,
            },
          ),
        );
      }
    }
  }

  // Israel's NRMM IMR has a closed scope of new-model construction and
  // earthmoving machinery. It incorporates EU Stage V and its timetable;
  // agriculture is deliberately not generated. For the variable-speed NRE
  // representative path, 19..560 kW requires both NRSC and NRTC.
  for (const band of stageVBands) {
    const testCycleCode =
      band.powerMinKw >= 19 && band.powerMinKw < 560.001
        ? "NRSC/NRTC"
        : "NRSC";
    for (const row of band.rows) {
      limits.push(
        fixtureLimit(
          acceptanceFixtureIds.regulation.israelConstructionStageV2026,
          acceptanceFixtureIds.source.euReg1628,
          {
            applicationScope: "construction",
            limitValue: row.limitValue,
            measurementBasis:
              "Israel NRMM IMR CY2026: new-model construction machinery (EN 500) and earthmoving machinery (EN 474), incorporating the most recent EU 2016/1628 Stage V limits and timetable. This is the EU NRE variable-speed representative path; eligible NAFTA/EPA compliance is an alternative and is not cumulative. The CY2026 boundary is a current snapshot",
            pollutantCode: row.pollutantCode,
            powerMaxKw: band.powerMaxKw,
            powerMinKw: band.powerMinKw,
            testCycleCode,
            unitCode: row.pollutantCode === "PN" ? "e9/kWh" : "g/kWh",
            validFrom: "2026-01-01",
            verifiedAt: israelVerificationTimestamp,
          },
        ),
      );
    }
  }

  // UAE MOIAT's implementation guide directly publishes the compression-
  // ignition Euro VI/B table for heavy vehicles above 2,610 kg reference mass.
  // It requires WHSC and WHTC together; NTE/PEMS are conformity checks without
  // a separate numeric table here and therefore are retained in the basis text.
  for (const applicationScope of scopes) {
    for (const [testCycleCode, rows] of [
      ["WHSC", euro6Whsc],
      ["WHTC", euro6Whtc],
    ] as const) {
      for (const row of rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.uaeHeavyVehicleEuro6B,
            acceptanceFixtureIds.source.uaeVehicleEmissionGuide,
            {
              ...row,
              applicationScope,
              measurementBasis:
                "UAE MOIAT Implementation guideline section 3: heavy vehicle with reference mass >2,610 kg, compression-ignition Euro VI/B representative path under UN R49.06:2013 or EU 582/2011; applies to newly introduced models imported for first registration from 2026-01-01 and to all imported light/heavy vehicles from 2027-07-01; NTE and PEMS conformity are also required",
              testCycleCode,
              validFrom: "2027-07-01",
              verifiedAt: unitedArabEmiratesVerificationTimestamp,
            },
          ),
        );
      }
    }
  }

  // South Africa's compulsory N2/N3 and M2/M3 specifications list several
  // equivalent certification routes. Publish only the SANS 20049 / ECE
  // R49.02B route. Directive 91/542/EEC Row B supplies the incorporated
  // numeric values and applies a 1.7 PM multiplier at engine power <=85 kW.
  const southAfricaR4902BCommonRows = [
    { pollutantCode: "CO", limitValue: "4.0" },
    { pollutantCode: "HC", limitValue: "1.1" },
    { pollutantCode: "NOX", limitValue: "7.0" },
  ] as const;
  for (const applicationScope of scopes) {
    const nationalNotice =
      applicationScope === "on-road-truck"
        ? "Government Notice 611 of 2015 clause 4.2.2.1 and Schedule 1 for category N2/N3"
        : "Government Notice 613 of 2015 clause 4.2.2.1 and Schedule 1 for category M2/M3";
    const measurementBasis = `${nationalNotice}; SANS 20049:2004 at ECE R49.02B representative route, with the pre-2006-homologation manufacture/import exclusion expired on 2010-01-01. US 1998, Japanese 1998, ADR 80/00 and R83.04 are alternatives and are not cumulative. Numeric Row B comes from Council Directive 91/542/EEC section 6.2.1`;
    for (const row of southAfricaR4902BCommonRows) {
      limits.push(
        fixtureLimit(
          acceptanceFixtureIds.regulation.southAfricaR4902B,
          acceptanceFixtureIds.source.southAfricaDirective91542,
          {
            ...row,
            applicationScope,
            measurementBasis,
            testCycleCode: "ECE R49.02B / European 13-mode",
            unitCode: "g/kWh",
            validFrom: "2010-01-01",
            verifiedAt: southAfricaVerificationTimestamp,
          },
        ),
      );
    }
    limits.push(
      fixtureLimit(
        acceptanceFixtureIds.regulation.southAfricaR4902B,
        acceptanceFixtureIds.source.southAfricaDirective91542,
        {
          applicationScope,
          limitValue: "0.255",
          measurementBasis: `${measurementBasis}; Directive 91/542/EEC applies a 1.7 coefficient to the 0.15 g/kWh particulate limit for engines of 85 kW or less`,
          pollutantCode: "PM",
          powerMaxKw: 85.001,
          testCycleCode: "ECE R49.02B / European 13-mode",
          unitCode: "g/kWh",
          validFrom: "2010-01-01",
          verifiedAt: southAfricaVerificationTimestamp,
        },
      ),
      fixtureLimit(
        acceptanceFixtureIds.regulation.southAfricaR4902B,
        acceptanceFixtureIds.source.southAfricaDirective91542,
        {
          applicationScope,
          limitValue: "0.15",
          measurementBasis: `${measurementBasis}; the 1.7 particulate coefficient applies only to engines of 85 kW or less`,
          pollutantCode: "PM",
          powerMinKw: 85.001,
          testCycleCode: "ECE R49.02B / European 13-mode",
          unitCode: "g/kWh",
          validFrom: "2010-01-01",
          verifiedAt: southAfricaVerificationTimestamp,
        },
      ),
    );
  }

  // 印尼 KLHK P.20/2017 的道路 Euro 4 压燃机限值。该文书对新型 M/N/O 类
  // 车辆给出 ESC 与 ETC 两个重型发动机测试循环；本批只把可读回的质量限值
  // 写入 on-road scope，不把道路标准延伸到工程机械或农业装备。
  const indonesiaEuro4Esc = [
    { pollutantCode: "CO", limitValue: "1.5", unitCode: "g/kWh" },
    { pollutantCode: "HC", limitValue: "0.46", unitCode: "g/kWh" },
    { pollutantCode: "NOX", limitValue: "3.5", unitCode: "g/kWh" },
    { pollutantCode: "PM", limitValue: "0.02", unitCode: "g/kWh" },
  ] as const;
  const indonesiaEuro4Etc = [
    { pollutantCode: "CO", limitValue: "4.0", unitCode: "g/kWh" },
    { pollutantCode: "NMHC", limitValue: "0.55", unitCode: "g/kWh" },
    { pollutantCode: "NOX", limitValue: "3.5", unitCode: "g/kWh" },
    { pollutantCode: "PM", limitValue: "0.03", unitCode: "g/kWh" },
  ] as const;
  for (const applicationScope of scopes) {
    for (const [testCycleCode, rows] of [
      ["ESC", indonesiaEuro4Esc],
      ["ETC", indonesiaEuro4Etc],
    ] as const) {
      for (const row of rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.indonesiaEuro4,
            acceptanceFixtureIds.source.indonesiaEuro4,
            {
              ...row,
              applicationScope,
              measurementBasis:
                "KLHK P.20/MENLHK/SETJEN/KUM.1/3/2017 Euro 4 heavy-duty compression-ignition engine limits",
              testCycleCode,
              validFrom: "2022-04-01",
              verifiedAt: indonesiaVerificationTimestamp,
            },
          ),
        );
      }
    }
  }

  // 越南 QCVN 109:2021/BGTVT 表 4/5 的重型压燃发动机 Level 5 限值。
  // ETC 表中的 CH4 仅适用于天然气发动机，不能写入柴油结果；ELR 烟度则是
  // 重型压燃发动机的独立要求。QCVN 明确排除非道路地形车辆，因此这里只生成
  // 卡车和客车限值。
  const vietnamLevel5Esc = [
    { pollutantCode: "CO", limitValue: "1.5", unitCode: "g/kWh" },
    { pollutantCode: "HC", limitValue: "0.46", unitCode: "g/kWh" },
    { pollutantCode: "NOX", limitValue: "2.0", unitCode: "g/kWh" },
    { pollutantCode: "PM", limitValue: "0.02", unitCode: "g/kWh" },
  ] as const;
  const vietnamLevel5Etc = [
    { pollutantCode: "CO", limitValue: "4.0", unitCode: "g/kWh" },
    { pollutantCode: "NMHC", limitValue: "0.55", unitCode: "g/kWh" },
    { pollutantCode: "NOX", limitValue: "2.0", unitCode: "g/kWh" },
    { pollutantCode: "PM", limitValue: "0.03", unitCode: "g/kWh" },
  ] as const;
  for (const applicationScope of scopes) {
    for (const [testCycleCode, rows] of [
      ["ESC", vietnamLevel5Esc],
      ["ETC", vietnamLevel5Etc],
    ] as const) {
      for (const row of rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.vietnamLevel5,
            acceptanceFixtureIds.source.vietnamQcvn109,
            {
              ...row,
              applicationScope,
              measurementBasis:
                "QCVN 109:2021/BGTVT Part II clause 3.2, Tables 4 and 5; Level 5 heavy reference-mass compression-ignition engines",
              testCycleCode,
              validFrom: "2022-01-01",
              verifiedAt: vietnamVerificationTimestamp,
            },
          ),
        );
      }
    }
    limits.push(
      fixtureLimit(
        acceptanceFixtureIds.regulation.vietnamLevel5,
        acceptanceFixtureIds.source.vietnamQcvn109,
        {
          applicationScope,
          limitValue: "0.5",
          measurementBasis:
            "QCVN 109:2021/BGTVT Part II clause 3.2, Table 4; ELR smoke light-absorption coefficient",
          pollutantCode: "OPACITY",
          testCycleCode: "ELR",
          unitCode: "m-1",
          validFrom: "2022-01-01",
          verifiedAt: vietnamVerificationTimestamp,
        },
      ),
    );
  }

  // 马来西亚 DOE 现行公开 VTA 指南的道路重型柴油 Euro II 基线。
  // 2017-01-01 是指南明确的 current implementation；同页 Euro IV 日期标为
  // tentative，不能升级为 effective。P.U.(A) 429/96 regulation 5 将范围限制
  // 为道路车辆，因此不为 construction/agriculture 生成限值。
  const malaysiaEuro2HeavyDuty = [
    { pollutantCode: "CO", limitValue: "4.0", unitCode: "g/kWh" },
    { pollutantCode: "HC", limitValue: "1.1", unitCode: "g/kWh" },
    { pollutantCode: "NOX", limitValue: "7.0", unitCode: "g/kWh" },
    { pollutantCode: "PM", limitValue: "0.15", unitCode: "g/kWh" },
  ] as const;
  for (const applicationScope of scopes) {
    for (const row of malaysiaEuro2HeavyDuty) {
      limits.push(
        fixtureLimit(
          acceptanceFixtureIds.regulation.malaysiaEuro2,
          acceptanceFixtureIds.source.malaysiaVtaGuideline,
          {
            ...row,
            applicationScope,
            measurementBasis:
              "Malaysia DOE Motor Vehicle VTA Guidelines, heavy-duty diesel Euro II Table 7; UN R49-02(B) 13-mode steady-state test",
            testCycleCode: "UN R49-02(B) 13-mode",
            validFrom: "2017-01-01",
            verifiedAt: malaysiaVerificationTimestamp,
          },
        ),
      );
    }
  }

  // 阿根廷 Resolution 1464/2014 的普通重型车辆 B2/Euro V 路径。该决议
  // 将新车型节点设为 2016-01-01、全部重型车辆和发动机节点设为 2018-01-01；
  // 当前 schema 没有车型年字段，因此以 2018-01-01 作为普通市场统一查询起点。
  // Directive 2005/55/EC Annex I 的 B2 数值由 EUR-Lex/CELLAR 官方 PDF 读回。
  const euro5B2EscElr = [
    { pollutantCode: "CO", limitValue: "1.5", unitCode: "g/kWh" },
    { pollutantCode: "HC", limitValue: "0.46", unitCode: "g/kWh" },
    { pollutantCode: "NOX", limitValue: "2.0", unitCode: "g/kWh" },
    { pollutantCode: "PM", limitValue: "0.02", unitCode: "g/kWh" },
    { pollutantCode: "OPACITY", limitValue: "0.5", unitCode: "m-1" },
  ] as const;
  const euro5B2Etc = [
    { pollutantCode: "CO", limitValue: "4.0", unitCode: "g/kWh" },
    { pollutantCode: "NMHC", limitValue: "0.55", unitCode: "g/kWh" },
    { pollutantCode: "NOX", limitValue: "2.0", unitCode: "g/kWh" },
    { pollutantCode: "PM", limitValue: "0.03", unitCode: "g/kWh" },
  ] as const;
  for (const applicationScope of scopes) {
    for (const [testCycleCode, rows] of [
      ["ESC/ELR", euro5B2EscElr],
      ["ETC", euro5B2Etc],
    ] as const) {
      for (const row of rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.argentinaEuroV,
            acceptanceFixtureIds.source.euDirective200555,
            {
              ...row,
              applicationScope,
              measurementBasis:
                "Argentina Resolución 1464/2014; Directive 2005/55/EC Annex I B2 (Euro V) CI heavy-duty limits; Resolution 128/2018 military exception excluded from ordinary market baseline",
              testCycleCode,
              validFrom: "2018-01-01",
              verifiedAt: argentinaVerificationTimestamp,
            },
          ),
        );
      }
    }
  }

  // GSO's MY2026 list identifies ECE 49 / Euro V as Saudi Arabia's heavy-
  // duty diesel requirement. Model-year 2026 is normalized to 2026-01-01;
  // publish one UN R49-05 B2 CI path and retain alternative-path semantics.
  for (const applicationScope of scopes) {
    for (const row of euro5B2EscElr) {
      limits.push(
        fixtureLimit(
          acceptanceFixtureIds.regulation.saudiHeavyVehicleEuroVMy2026,
          acceptanceFixtureIds.source.uneceR49Rev4,
          {
            ...row,
            applicationScope,
            measurementBasis:
              "GSO MY2026-D4 pages 7 and 12: Saudi Arabia heavy-duty diesel vehicles shall comply with ECE 49 Euro V; 2026-01-01 is a normalized model-year boundary, not a separately stated calendar commencement. UN R49-05 B2 is the representative CI path; ETC THC 0.55 may substitute for NMHC 0.55 and is not cumulative",
            testCycleCode:
              row.pollutantCode === "OPACITY" ? "ELR" : "ESC",
            validFrom: "2026-01-01",
            verifiedAt: saudiArabiaVerificationTimestamp,
          },
        ),
      );
    }
    for (const row of euro5B2Etc) {
      limits.push(
        fixtureLimit(
          acceptanceFixtureIds.regulation.saudiHeavyVehicleEuroVMy2026,
          acceptanceFixtureIds.source.uneceR49Rev4,
          {
            ...row,
            applicationScope,
            measurementBasis:
              "GSO MY2026-D4 pages 7 and 12: Saudi Arabia heavy-duty diesel vehicles shall comply with ECE 49 Euro V; 2026-01-01 is a normalized model-year boundary, not a separately stated calendar commencement. UN R49-05 B2 is the representative CI path; ETC THC 0.55 may substitute for NMHC 0.55 and is not cumulative",
            testCycleCode: "ETC",
            validFrom: "2026-01-01",
            verifiedAt: saudiArabiaVerificationTimestamp,
          },
        ),
      );
    }
  }

  // Thailand makes TIS 3046-2563 mandatory from 2024-01-01. Its domestic
  // "Level 6" label follows the UN R49-05 / Euro V B2 path. Keep ESC and ELR
  // as distinct cycles and publish NMHC as the representative ETC hydrocarbon
  // limit; the permitted THC value is an alternative, not an extra limit.
  for (const applicationScope of scopes) {
    for (const row of euro5B2EscElr) {
      limits.push(
        fixtureLimit(
          acceptanceFixtureIds.regulation.thailandHeavyDieselLevel6,
          acceptanceFixtureIds.source.thailandTis3046,
          {
            ...row,
            applicationScope,
            measurementBasis:
              "TIS 3046-2563 sections 1.1, 2.18, 3.2 and 7.1; M2/N2 reference mass >2,610 kg and all M3/N3; Pmax/net power measured under UN R85 in kW; ETC THC 0.55 g/kWh may replace NMHC 0.55 and is not cumulative",
            testCycleCode:
              row.pollutantCode === "OPACITY" ? "ELR" : "ESC",
            validFrom: "2024-01-01",
            verifiedAt: thailandVerificationTimestamp,
          },
        ),
      );
    }
    for (const row of euro5B2Etc) {
      limits.push(
        fixtureLimit(
          acceptanceFixtureIds.regulation.thailandHeavyDieselLevel6,
          acceptanceFixtureIds.source.thailandTis3046,
          {
            ...row,
            applicationScope,
            measurementBasis:
              "TIS 3046-2563 sections 1.1, 2.18, 3.2 and 7.1; M2/N2 reference mass >2,610 kg and all M3/N3; Pmax/net power measured under UN R85 in kW; ETC THC 0.55 g/kWh may replace NMHC 0.55 and is not cumulative",
            testCycleCode: "ETC",
            validFrom: "2024-01-01",
            verifiedAt: thailandVerificationTimestamp,
          },
        ),
      );
    }
  }

  // Bosnia and Herzegovina's 2019 decision selects UNECE R49/06 for new M/N
  // homologation. Publish the incorporated CI WHSC/WHTC path only. The narrow
  // R96 mobile-crane alternative is not generalized to non-road machinery.
  for (const applicationScope of scopes) {
    for (const [testCycleCode, rows] of [
      ["WHSC", euro6Whsc],
      ["WHTC", euro6Whtc],
    ] as const) {
      for (const row of rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.bosniaR49Series06,
            acceptanceFixtureIds.source.uneceR49Rev6,
            {
              ...row,
              applicationScope,
              measurementBasis:
                "Bosnia and Herzegovina 2019 minimum technical requirements Annex 1 (UNECE 49/06 for M/N) and 2010 R49 homologation order; UN R49 Revision 6 Table 1 CI limits; M1/M2/N1/N2 reference mass >2,610 kg and all M3/N3",
              testCycleCode,
              validFrom: "2019-06-01",
              verifiedAt: bosniaVerificationTimestamp,
            },
          ),
        );
      }
    }
  }

  // Montenegro's 2018 amendment makes Euro VI mandatory for new M/N vehicles
  // and the annex incorporates UN R49/06. The domestic M/N definition uses
  // maximum continuous rated power >15 kW; 15.001 is the schema-precision
  // boundary. Keep WNTE alongside, not in place of, the WHSC/WHTC type tests.
  const r49Rev6Wnte = [
    { pollutantCode: "CO", limitValue: "2000", unitCode: "mg/kWh" },
    { pollutantCode: "THC", limitValue: "220", unitCode: "mg/kWh" },
    { pollutantCode: "NOX", limitValue: "600", unitCode: "mg/kWh" },
    { pollutantCode: "PM", limitValue: "16", unitCode: "mg/kWh" },
  ] as const;
  for (const applicationScope of scopes) {
    for (const [testCycleCode, rows] of [
      ["WHSC", euro6Whsc],
      ["WHTC", euro6Whtc],
      ["WNTE", r49Rev6Wnte],
    ] as const) {
      for (const row of rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.montenegroEuroVi,
            acceptanceFixtureIds.source.montenegroUneceR49,
            {
              ...row,
              applicationScope,
              measurementBasis:
                "Montenegro vehicle-requirements annex rows 42/50 and 2018 implementation notice; UN R49 Revision 6 CI WHSC/WHTC/WNTE representative route; domestic M/N category uses maximum continuous rated power >15 kW; EU and UN cross-references are equivalent, not cumulative",
              powerMinKw: 15.001,
              testCycleCode,
              validFrom: "2018-10-15",
              verifiedAt: montenegroVerificationTimestamp,
            },
          ),
        );
      }
    }
  }

  // Nepal Vehicle Pollution Standard 2082 section 6(b) applies this complete
  // engine-dynamometer path to CI M/N vehicles with GVW >3,500 kg from the
  // Gazette publication date. Section 14 adds WNTE; section 3 expressly keeps
  // tractors, power tillers and named construction equipment out of scope.
  for (const applicationScope of scopes) {
    for (const [testCycleCode, rows] of [
      ["WHSC", euro6Whsc],
      ["WHTC", euro6Whtc],
      ["WNTE", r49Rev6Wnte],
    ] as const) {
      for (const row of rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.nepalHeavyVehicle2082,
            acceptanceFixtureIds.source.nepalVehiclePollutionStandardDoenv,
            {
              ...row,
              applicationScope,
              measurementBasis:
                "Nepal Vehicle Pollution Standard 2082 §6(b), compression-ignition M/N vehicle with gross vehicle weight >3,500 kg; engine-dynamometer WHSC/WHTC plus §14 WNTE; effective 2025-06-23; pre-publication letter-of-credit/payment grandfathering under §16(3)",
              testCycleCode,
              validFrom: "2025-06-23",
              verifiedAt: nepalVerificationTimestamp,
            },
          ),
        );
      }
    }
  }

  // Ukraine Law No. 2739-IV sets Euro V as the minimum for first registration
  // and import of 8702/8704 road vehicles from 2016-01-01 through 2026-12-31.
  // Order No. 521 Annex 2 item 52 accepts R49-05 B2 / Directive 2005/55 B2
  // among alternative M/N type-approval routes. Store one CI representative
  // route only; do not combine alternatives or extend it to non-road scopes.
  for (const applicationScope of scopes) {
    for (const [testCycleCode, rows] of [
      ["ESC/ELR", euro5B2EscElr],
      ["ETC", euro5B2Etc],
    ] as const) {
      for (const row of rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.ukraineRoadEuroV,
            acceptanceFixtureIds.source.euDirective200555,
            {
              ...row,
              applicationScope,
              measurementBasis:
                "Ukraine Law No. 2739-IV Euro V floor from 2016-01-01; Order No. 521 Annex 2 item 52 UN R49-05 B2 / Directive 2005/55 B2 alternative type-approval routes; Directive 2005/55/EC Annex I B2 CI representative limits; Euro VI statutory switch at 2027-01-01",
              testCycleCode,
              validFrom: "2016-01-01",
              validTo: "2027-01-01",
              verifiedAt: ukraineVerificationTimestamp,
            },
          ),
        );
      }
    }
  }

  // 新西兰 Rule 33001 Schedule 1 Table 2B：自 2025-11-01 起，新旧重型
  // MD3/MD4/ME/NB/NC 车辆均可采用 Euro VI Step C，亦可选择 US、Japan、
  // ADR 或 UNR 等效路径。当前 fixture 只发布已核验的 Euro VI CI 数值路径；
  // 这些路径是 alternatives，不是累计要求。2.1(2)(b) 排除 tractors，且不为
  // construction/agriculture 从道路入境认证规则外推限值。
  for (const applicationScope of scopes) {
    for (const [testCycleCode, rows] of [
      ["WHSC", euro6Whsc],
      ["WHTC", euro6Whtc],
    ] as const) {
      for (const row of rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.newZealandEuroVi,
            acceptanceFixtureIds.source.euReg595,
            {
              ...row,
              applicationScope,
              measurementBasis:
                "Land Transport Rule 33001 Schedule 1 Table 2B; Euro VI Step C is one alternative pathway from 2025-11-01, not cumulative with US Tier 3, US 2013, Japan 2016, ADR 80/04, UNR49/06(Supp.4), or UNR83/07; representative CI limits from Regulations 595/2009 and 582/2011",
              testCycleCode,
              validFrom: "2025-11-01",
              verifiedAt: newZealandVerificationTimestamp,
            },
          ),
        );
      }
    }
  }

  // 智利 D.S. 50/2023 将 article 8 quater 加入 D.S. 55/1994。现行合并版
  // 自 2026-01-06 起适用于首次登记的 GVW >= 3,860 kg 重型道路车辆。
  // Table 1（US-EPA）与 Table 3（Euro VI）是 alternatives；这里只保存直接
  // 读回的 Table 3 压燃机 WHSC/WHTC 代表路径。
  for (const applicationScope of scopes) {
    for (const [testCycleCode, rows] of [
      ["WHSC", euro6Whsc],
      ["WHTC", euro6Whtc],
    ] as const) {
      for (const row of rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.chileHeavyVehicleEuroVi,
            acceptanceFixtureIds.source.chileHeavyVehicleDecree50,
            {
              ...row,
              applicationScope,
              measurementBasis:
                "Chile D.S. 50/2023 article 8 quater Table 3; Euro VI compression-ignition WHSC/WHTC is one alternative pathway, not cumulative with the US-EPA Table 1 pathway",
              testCycleCode,
              validFrom: "2026-01-06",
              verifiedAt: chileVerificationTimestamp,
            },
          ),
        );
      }
    }
  }

  // 智利 D.S. 39/2020 Table 2：全国进口移动机械，压燃机 19 <= P <= 560 kW。
  // Table 1 的 US 40 CFR 1039 认证与 Table 2 的 EU Stage V 认证二选一。
  // power_max 采用 560.001，使半开区间查询准确包含原文的 560 kW 端点。
  const chileMobileMachineryBands = [
    {
      powerMinKw: 19,
      powerMaxKw: 37,
      rows: [
        { pollutantCode: "CO", limitValue: "5.0", unitCode: "g/kWh" },
        {
          pollutantCode: "HC+NOx",
          limitValue: "4.7",
          unitCode: "g/kWh",
        },
        { pollutantCode: "PM", limitValue: "0.015", unitCode: "g/kWh" },
        { pollutantCode: "PN", limitValue: "1000", unitCode: "e9/kWh" },
      ],
    },
    {
      powerMinKw: 37,
      powerMaxKw: 56,
      rows: [
        { pollutantCode: "CO", limitValue: "5.0", unitCode: "g/kWh" },
        {
          pollutantCode: "HC+NOx",
          limitValue: "4.7",
          unitCode: "g/kWh",
        },
        { pollutantCode: "PM", limitValue: "0.015", unitCode: "g/kWh" },
        { pollutantCode: "PN", limitValue: "1000", unitCode: "e9/kWh" },
      ],
    },
    {
      powerMinKw: 56,
      powerMaxKw: 75,
      rows: [
        { pollutantCode: "CO", limitValue: "5.0", unitCode: "g/kWh" },
        { pollutantCode: "HC", limitValue: "0.19", unitCode: "g/kWh" },
        { pollutantCode: "NOX", limitValue: "0.4", unitCode: "g/kWh" },
        { pollutantCode: "PM", limitValue: "0.015", unitCode: "g/kWh" },
        { pollutantCode: "PN", limitValue: "1000", unitCode: "e9/kWh" },
      ],
    },
    {
      powerMinKw: 75,
      powerMaxKw: 130,
      rows: [
        { pollutantCode: "CO", limitValue: "5.0", unitCode: "g/kWh" },
        { pollutantCode: "HC", limitValue: "0.19", unitCode: "g/kWh" },
        { pollutantCode: "NOX", limitValue: "0.4", unitCode: "g/kWh" },
        { pollutantCode: "PM", limitValue: "0.015", unitCode: "g/kWh" },
        { pollutantCode: "PN", limitValue: "1000", unitCode: "e9/kWh" },
      ],
    },
    {
      powerMinKw: 130,
      powerMaxKw: 560.001,
      rows: [
        { pollutantCode: "CO", limitValue: "3.5", unitCode: "g/kWh" },
        { pollutantCode: "HC", limitValue: "0.19", unitCode: "g/kWh" },
        { pollutantCode: "NOX", limitValue: "0.4", unitCode: "g/kWh" },
        { pollutantCode: "PM", limitValue: "0.015", unitCode: "g/kWh" },
        { pollutantCode: "PN", limitValue: "1000", unitCode: "e9/kWh" },
      ],
    },
  ] as const;
  for (const {
    applicationScope,
    regulationId,
    validFrom,
  } of [
    {
      applicationScope: "construction",
      regulationId: acceptanceFixtureIds.regulation.chileMobileMachineryStageV,
      validFrom: "2023-10-21",
    },
    {
      applicationScope: "agriculture",
      regulationId: acceptanceFixtureIds.regulation.chileTractorStageV,
      validFrom: "2030-01-01",
    },
  ] as const) {
    for (const band of chileMobileMachineryBands) {
      for (const row of band.rows) {
        limits.push(
          fixtureLimit(
            regulationId,
            acceptanceFixtureIds.source.chileMobileMachineryDecree39,
            {
              ...row,
              applicationScope,
              measurementBasis:
                applicationScope === "construction"
                  ? "Chile D.S. 39/2020 article 3 Table 2 EU Stage V representative pathway; alternative, not cumulative, with Table 1 US 40 CFR 1039 certification"
                  : "Chile D.S. 39/2020 article 3 Table 2, as amended by D.S. 33/2024; adopted tractor-only pathway from 2030-01-01, excluding other agricultural machinery",
              powerMaxKw: band.powerMaxKw,
              powerMinKw: band.powerMinKw,
              testCycleCode: "EU Stage V",
              validFrom,
              verifiedAt: chileVerificationTimestamp,
            },
          ),
        );
      }
    }
  }

  // Colombia Resolucion 0762/2022 article 18 Table 22: M2/M3/N2/N3
  // compression-ignition road vehicles from 2023-01-01. EPA10 or higher is an
  // equivalent alternative; the directly published WHSC/WHTC table is kept here.
  for (const applicationScope of scopes) {
    for (const [testCycleCode, rows] of [
      ["WHSC", euro6Whsc],
      ["WHTC", euro6Whtc],
    ] as const) {
      for (const row of rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.colombiaHeavyVehicleEuroVi,
            acceptanceFixtureIds.source.colombiaResolution762,
            {
              ...row,
              applicationScope,
              measurementBasis:
                "Colombia Resolucion 0762/2022 article 18 Table 22; WHSC/WHTC is one compliance pathway, alternative and not cumulative with EPA10 or higher under paragraph 2",
              testCycleCode,
              validFrom: "2023-01-01",
              verifiedAt: colombiaVerificationTimestamp,
            },
          ),
        );
      }
    }
  }

  // Colombia Resolucion 0762/2022 article 19 Table 23: diesel non-road mobile
  // sources from 19 through 560 kW. Table 24 US limits are an alternative
  // pathway, so only the EU table is represented. Article 3(c) excludes
  // agriculture; these limits apply to construction only.
  const colombiaNonRoadBands = [
    {
      powerMinKw: 19,
      powerMaxKw: 37,
      testCycleCode: "NRSC",
      rows: [
        { pollutantCode: "CO", limitValue: "5.5", unitCode: "g/kWh" },
        {
          pollutantCode: "HC+NOx",
          limitValue: "7.5",
          unitCode: "g/kWh",
        },
        { pollutantCode: "PM", limitValue: "0.600", unitCode: "g/kWh" },
      ],
    },
    {
      powerMinKw: 37,
      powerMaxKw: 56,
      testCycleCode: "NRSC/NRTC",
      rows: [
        { pollutantCode: "CO", limitValue: "5.0", unitCode: "g/kWh" },
        {
          pollutantCode: "HC+NOx",
          limitValue: "4.7",
          unitCode: "g/kWh",
        },
        { pollutantCode: "PM", limitValue: "0.025", unitCode: "g/kWh" },
      ],
    },
    {
      powerMinKw: 56,
      powerMaxKw: 75,
      testCycleCode: "NRSC/NRTC",
      rows: [
        { pollutantCode: "CO", limitValue: "5.0", unitCode: "g/kWh" },
        { pollutantCode: "HC", limitValue: "0.19", unitCode: "g/kWh" },
        { pollutantCode: "NOX", limitValue: "3.3", unitCode: "g/kWh" },
        { pollutantCode: "PM", limitValue: "0.025", unitCode: "g/kWh" },
      ],
    },
    {
      powerMinKw: 75,
      powerMaxKw: 130,
      testCycleCode: "NRSC/NRTC",
      rows: [
        { pollutantCode: "CO", limitValue: "5.0", unitCode: "g/kWh" },
        { pollutantCode: "HC", limitValue: "0.19", unitCode: "g/kWh" },
        { pollutantCode: "NOX", limitValue: "3.3", unitCode: "g/kWh" },
        { pollutantCode: "PM", limitValue: "0.025", unitCode: "g/kWh" },
      ],
    },
    {
      powerMinKw: 130,
      powerMaxKw: 560.001,
      testCycleCode: "NRSC/NRTC",
      rows: [
        { pollutantCode: "CO", limitValue: "3.5", unitCode: "g/kWh" },
        { pollutantCode: "HC", limitValue: "0.19", unitCode: "g/kWh" },
        { pollutantCode: "NOX", limitValue: "2.0", unitCode: "g/kWh" },
        { pollutantCode: "PM", limitValue: "0.025", unitCode: "g/kWh" },
      ],
    },
  ] as const;
  for (const band of colombiaNonRoadBands) {
    for (const row of band.rows) {
      limits.push(
        fixtureLimit(
          acceptanceFixtureIds.regulation.colombiaNonRoadTable23,
          acceptanceFixtureIds.source.colombiaResolution762,
          {
            ...row,
            applicationScope: "construction",
            measurementBasis:
              "Colombia Resolucion 0762/2022 article 19 Table 23 EU representative pathway; alternative and not cumulative with the Table 24 US pathway; article 3(c) excludes agricultural machinery",
            powerMaxKw: band.powerMaxKw,
            powerMinKw: band.powerMinKw,
            testCycleCode: band.testCycleCode,
            validFrom: "2024-07-18",
            verifiedAt: colombiaVerificationTimestamp,
          },
        ),
      );
    }
  }

  // Peru D.S. 029-2021-MINAM replaces annex I.7 of D.S. 010-2017-MINAM.
  // From 2024-10-01, compression-ignition passenger and cargo vehicles over
  // 3.5 t may use the Euro VI/A WHSC/WHTC path. Annex I.9.1 separately lists
  // EPA 2010, so the two compliance paths must not be accumulated.
  for (const applicationScope of scopes) {
    for (const [testCycleCode, rows] of [
      ["WHSC", euro6Whsc],
      ["WHTC", euro6Whtc],
    ] as const) {
      for (const row of rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.peruHeavyVehicleEuroVi,
            acceptanceFixtureIds.source.peruDecree029,
            {
              ...row,
              applicationScope,
              measurementBasis:
                "Peru D.S. 010-2017-MINAM annex I.7 as replaced by D.S. 029-2021-MINAM article 2; Euro VI/A is a representative alternative pathway and is not cumulative with annex I.9.1 EPA 2010",
              testCycleCode,
              validFrom: "2024-10-01",
              verifiedAt: peruVerificationTimestamp,
            },
          ),
        );
      }
    }
  }

  // Singapore S 480/2017 Second Schedule accepts Euro VI for >3.5 t diesel
  // vehicles as one of several alternative paths. PPNLT paths are not
  // cumulative with the Euro VI WHSC/WHTC representative path stored here.
  for (const applicationScope of scopes) {
    for (const [testCycleCode, rows] of [
      ["WHSC", euro6Whsc],
      ["WHTC", euro6Whtc],
    ] as const) {
      for (const row of rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.singaporeHeavyVehicleEuroVi,
            acceptanceFixtureIds.source.singaporeVehicularAmendment2017,
            {
              ...row,
              applicationScope,
              measurementBasis:
                "Singapore S 480/2017 Second Schedule Euro VI representative pathway for diesel vehicles over 3.5 t GVW; alternative and not cumulative with the listed Japan PPNLT pathways",
              testCycleCode,
              validFrom: "2018-01-01",
              verifiedAt: singaporeVerificationTimestamp,
            },
          ),
        );
      }
    }
  }

  // Singapore S 299/2012 Schedule lists US Tier II, EU Stage II and Japan
  // Tier I as alternatives. NEA explicitly identifies construction plant such
  // as cranes and excavators; agriculture is not inferred from that guidance.
  const singaporeOffRoadStageIiBands = [
    {
      powerMinKw: 18,
      powerMaxKw: 37,
      rows: [
        { pollutantCode: "HC", limitValue: "1.5", unitCode: "g/kWh" },
        { pollutantCode: "CO", limitValue: "5.5", unitCode: "g/kWh" },
        { pollutantCode: "NOX", limitValue: "8.0", unitCode: "g/kWh" },
        { pollutantCode: "PM", limitValue: "0.8", unitCode: "g/kWh" },
      ],
    },
    {
      powerMinKw: 37,
      powerMaxKw: 75,
      rows: [
        { pollutantCode: "HC", limitValue: "1.3", unitCode: "g/kWh" },
        { pollutantCode: "CO", limitValue: "5.0", unitCode: "g/kWh" },
        { pollutantCode: "NOX", limitValue: "7.0", unitCode: "g/kWh" },
        { pollutantCode: "PM", limitValue: "0.4", unitCode: "g/kWh" },
      ],
    },
    {
      powerMinKw: 75,
      powerMaxKw: 130,
      rows: [
        { pollutantCode: "HC", limitValue: "1.0", unitCode: "g/kWh" },
        { pollutantCode: "CO", limitValue: "5.0", unitCode: "g/kWh" },
        { pollutantCode: "NOX", limitValue: "6.0", unitCode: "g/kWh" },
        { pollutantCode: "PM", limitValue: "0.3", unitCode: "g/kWh" },
      ],
    },
    {
      powerMinKw: 130,
      powerMaxKw: 560,
      rows: [
        { pollutantCode: "HC", limitValue: "1.0", unitCode: "g/kWh" },
        { pollutantCode: "CO", limitValue: "3.5", unitCode: "g/kWh" },
        { pollutantCode: "NOX", limitValue: "6.0", unitCode: "g/kWh" },
        { pollutantCode: "PM", limitValue: "0.2", unitCode: "g/kWh" },
      ],
    },
  ] as const;
  for (const band of singaporeOffRoadStageIiBands) {
    for (const row of band.rows) {
      limits.push(
        fixtureLimit(
          acceptanceFixtureIds.regulation.singaporeOffRoadStageIi,
          acceptanceFixtureIds.source.singaporeOffRoad2012,
          {
            ...row,
            applicationScope: "construction",
            measurementBasis:
              "Singapore S 299/2012 regulation 6 Schedule EU Stage II representative pathway; alternative and not cumulative with US Tier II or Japan Tier I; ISO 8178 test",
            powerMaxKw: band.powerMaxKw,
            powerMinKw: band.powerMinKw,
            testCycleCode: "ISO 8178",
            validFrom: "2012-07-01",
            verifiedAt: singaporeVerificationTimestamp,
          },
        ),
      );
    }
  }

  // Norway's current Bilforskriften § 1-4 makes 595/2009 and 582/2011
  // Norwegian law. Vedlegg 1 G3 applies the heavy-duty engine path to M3/N3
  // through 2029-05-28; exact values remain traced to the EU official table.
  for (const applicationScope of scopes) {
    for (const [testCycleCode, rows] of [
      ["WHSC", euro6Whsc],
      ["WHTC", euro6Whtc],
    ] as const) {
      for (const row of rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.norwayHeavyVehicleEuroVi,
            acceptanceFixtureIds.source.euReg595,
            {
              ...row,
              applicationScope,
              measurementBasis:
                "Norway FOR-2022-06-28-1233 section 1-4 and Vedlegg 1 G3 incorporate 595/2009 and 582/2011 as Norwegian law; limit value traced to the EU official Euro VI table; current consolidated-law path through 2029-05-28",
              testCycleCode,
              validFrom: "2022-10-01",
              validTo: "2029-05-29",
              verifiedAt: norwayVerificationTimestamp,
            },
          ),
        );
      }
    }
  }

  // Maskinforskriften Vedlegg XII incorporated 2016/1628 from 2020-07-01.
  // Construction and agriculture use the same NRE representative bands; exact
  // numeric limits remain traced to the signed EU Annex II source.
  for (const applicationScope of [
    "construction",
    "agriculture",
  ] as const) {
    for (const band of stageVBands) {
      for (const row of band.rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.norwayNrmmStageV,
            acceptanceFixtureIds.source.euReg1628,
            {
              applicationScope,
              limitValue: row.limitValue,
              measurementBasis:
                "Norway FOR-2009-05-20-544 section 1(3) and Vedlegg XII incorporate EU 2016/1628 as Norwegian regulation from 2020-07-01; Stage V NRE representative limit value traced to EU Annex II Table II-1",
              pollutantCode: row.pollutantCode,
              powerMaxKw: band.powerMaxKw,
              powerMinKw: band.powerMinKw,
              unitCode: row.pollutantCode === "PN" ? "e9/kWh" : "g/kWh",
              validFrom: "2020-07-01",
              verifiedAt: norwayVerificationTimestamp,
            },
          ),
        );
      }
    }
  }

  // Iceland Regulation 377/2013 writes 595/2009 and 582/2011 into the
  // national heavy-vehicle rules. Regulation 603/2026 confirms the live
  // 595/2009 entry and the Euro 7 transition; values are traced to the EU
  // official Euro VI table rather than copied from the Icelandic instrument.
  for (const applicationScope of scopes) {
    for (const [testCycleCode, rows] of [
      ["WHSC", euro6Whsc],
      ["WHTC", euro6Whtc],
    ] as const) {
      for (const row of rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.icelandHeavyVehicleEuroVi,
            acceptanceFixtureIds.source.euReg595,
            {
              ...row,
              applicationScope,
              measurementBasis:
                "Iceland Regulation 377/2013 article 12 and Annex IV items 45zzk/45zzl incorporate 595/2009 and 582/2011; Regulation 603/2026 confirms the current entry; limit value traced to the EU official Euro VI table",
              testCycleCode,
              validFrom: "2013-04-15",
              validTo: "2027-11-29",
              verifiedAt: icelandVerificationTimestamp,
            },
          ),
        );
      }
    }
  }

  const icelandNrmmPeriods: ReadonlyArray<{
    regulationId: string;
    nationalCitation: string;
    validFrom: string;
    validTo?: string;
  }> = [
    {
      nationalCitation: "Iceland Regulation 1200/2020 articles 1, 7 and 8",
      regulationId: acceptanceFixtureIds.regulation.icelandNrmmStageV2020,
      validFrom: "2020-12-01",
      validTo: "2021-02-23",
    },
    {
      nationalCitation: "Iceland Regulation 179/2021 articles 1, 7 and 8",
      regulationId: acceptanceFixtureIds.regulation.icelandNrmmStageV2021,
      validFrom: "2021-02-23",
    },
  ];
  for (const period of icelandNrmmPeriods) {
    for (const applicationScope of [
      "construction",
      "agriculture",
    ] as const) {
      for (const band of stageVBands) {
        for (const row of band.rows) {
          limits.push(
            fixtureLimit(
              period.regulationId,
              acceptanceFixtureIds.source.euReg1628,
              {
                applicationScope,
                limitValue: row.limitValue,
                measurementBasis: `${period.nationalCitation} give EU 2016/1628 effect in Iceland; Stage V NRE representative limit value traced to EU Annex II Table II-1`,
                pollutantCode: row.pollutantCode,
                powerMaxKw: band.powerMaxKw,
                powerMinKw: band.powerMinKw,
                unitCode: row.pollutantCode === "PN" ? "e9/kWh" : "g/kWh",
                validFrom: period.validFrom,
                ...(period.validTo ? { validTo: period.validTo } : {}),
                verifiedAt: icelandVerificationTimestamp,
              },
            ),
          );
        }
      }
    }
  }

  for (const applicationScope of scopes) {
    for (const [testCycleCode, rows] of [
      ["WHSC", euro6Whsc],
      ["WHTC", euro6Whtc],
    ] as const) {
      for (const row of rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.liechtensteinHeavyVehicleEuroVi,
            acceptanceFixtureIds.source.euReg595,
            {
              ...row,
              applicationScope,
              measurementBasis:
                "Liechtenstein VTS current consolidated text (LGBl. 1996 Nr. 143, Fassung 01.07.2026) Annex 4 Ziff. 211 requires Regulation (EC) No. 595/2009 or UNECE R49; limit value traced to the EU official Euro VI table",
              testCycleCode,
              validFrom: "2026-07-01",
              verifiedAt: liechtensteinVerificationTimestamp,
            },
          ),
        );
      }
    }
  }

  for (const applicationScope of ["construction", "agriculture"] as const) {
    for (const band of stageVBands) {
      for (const row of band.rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.liechtensteinNrmmStageV,
            acceptanceFixtureIds.source.euReg1628,
            {
              applicationScope,
              limitValue: row.limitValue,
              measurementBasis:
                "Liechtenstein LGBl. 2020 Nr. 258 / EWR Joint Committee Decision 39/2020 gives EU Regulation 2016/1628 effect from 2020-08-01; Stage V NRE representative limit value traced to EU Annex II Table II-1",
              pollutantCode: row.pollutantCode,
              powerMaxKw: band.powerMaxKw,
              powerMinKw: band.powerMinKw,
              unitCode: row.pollutantCode === "PN" ? "e9/kWh" : "g/kWh",
              validFrom: "2020-08-01",
              verifiedAt: liechtensteinVerificationTimestamp,
            },
          ),
        );
      }
    }
  }

  for (const applicationScope of scopes) {
    for (const [testCycleCode, rows] of [
      ["WHSC", euro6Whsc],
      ["WHTC", euro6Whtc],
    ] as const) {
      for (const row of rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.switzerlandHeavyVehicleEuroVi,
            acceptanceFixtureIds.source.euReg595,
            {
              ...row,
              applicationScope,
              measurementBasis:
                "Swiss VTS SR 741.41 current consolidated text (Stand 01.07.2026) Annex 5 Ziff. 211 requires Regulation (EC) No. 595/2009 or UNECE R49; limit value traced to the EU official Euro VI table",
              testCycleCode,
              validFrom: "2026-07-01",
              verifiedAt: switzerlandVerificationTimestamp,
            },
          ),
        );
      }
    }
  }

  for (const applicationScope of ["construction", "agriculture"] as const) {
    for (const band of stageVBands) {
      for (const row of band.rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.switzerlandNrmmStageV,
            acceptanceFixtureIds.source.euReg1628,
            {
              applicationScope,
              limitValue: row.limitValue,
              measurementBasis:
                "Swiss VTS SR 741.41 current consolidated text Annex 5 Ziff. 211a/211b recognizes EU Regulation 2016/1628 for work engines and tractors; Stage V NRE representative limit value traced to EU Annex II Table II-1",
              pollutantCode: row.pollutantCode,
              powerMaxKw: band.powerMaxKw,
              powerMinKw: band.powerMinKw,
              unitCode: row.pollutantCode === "PN" ? "e9/kWh" : "g/kWh",
              validFrom: "2026-07-01",
              verifiedAt: switzerlandVerificationTimestamp,
            },
          ),
        );
      }
    }
  }

  // Gazette 2083/3 adds Fifth Schedule alternatives; this fixture preserves
  // Gazette 2079/42 Third Schedule Table 5 as one representative route and
  // never combines values from alternative certification paths.
  const sriLankaImportGrandfathering =
    "Gazette 2079/70 clause 8 letter-of-credit grandfathering: imports backed by an LC established on or before 2018-07-12 may be imported through 2018-10-31";
  const sriLankaHeavyDiesel = [
    { pollutantCode: "CO", limitValue: "1.5", unitCode: "g/kWh" },
    { pollutantCode: "THC", limitValue: "0.46", unitCode: "g/kWh" },
    { pollutantCode: "NOX", limitValue: "3.5", unitCode: "g/kWh" },
    { pollutantCode: "PM", limitValue: "0.02", unitCode: "g/kWh" },
    { pollutantCode: "OPACITY", limitValue: "0.5", unitCode: "m-1" },
  ] as const;
  for (const applicationScope of scopes) {
    for (const row of sriLankaHeavyDiesel) {
      limits.push(
        fixtureLimit(
          acceptanceFixtureIds.regulation.sriLankaVehicleEmission2018,
          acceptanceFixtureIds.source.sriLankaEnvironment,
          {
            ...row,
            applicationScope,
            measurementBasis:
              row.pollutantCode === "OPACITY"
                ? `Gazette 2079/42 Third Schedule Table 5; diesel vehicles with GVW > 3500 kg; free-acceleration smoke opacity; ${sriLankaImportGrandfathering}`
                : `Gazette 2079/42 Third Schedule Table 5; diesel vehicles with GVW > 3500 kg; Third Schedule is one representative route, alternative and not cumulative with the Gazette 2083/3 Fifth Schedule route; ${sriLankaImportGrandfathering}`,
            testCycleCode:
              row.pollutantCode === "OPACITY"
                ? "FREE_ACCELERATION"
                : "ESC",
            validFrom: "2018-07-13",
            verifiedAt: sriLankaVerificationTimestamp,
          },
        ),
      );
    }
  }

  // Gazette 2079/42 Third Schedule Table 6 uses the same half-open power
  // intervals as the repository query model: lower bounds inclusive, upper
  // bounds exclusive. Its construction-equipment scope is not agriculture.
  const sriLankaConstructionBands = [
    {
      co: "8.0",
      hcNox: "7.5",
      opacity: "3.25",
      pm: "0.8",
      powerMaxKw: 8,
      powerMinKw: undefined,
    },
    {
      co: "6.6",
      hcNox: "7.5",
      opacity: "3.25",
      pm: "0.8",
      powerMaxKw: 19,
      powerMinKw: 8,
    },
    {
      co: "5.5",
      hcNox: "7.5",
      opacity: "3.25",
      pm: "0.6",
      powerMaxKw: 37,
      powerMinKw: 19,
    },
    {
      co: "5.0",
      hcNox: "4.7",
      opacity: "3.25",
      pm: "0.4",
      powerMaxKw: 75,
      powerMinKw: 37,
    },
    {
      co: "5.0",
      hcNox: "4.0",
      opacity: "3.25",
      pm: "0.3",
      powerMaxKw: 130,
      powerMinKw: 75,
    },
    {
      co: "3.5",
      hcNox: "4.0",
      opacity: "3.25",
      pm: "0.2",
      powerMaxKw: undefined,
      powerMinKw: 130,
    },
  ] as const;
  const sriLankaConstructionPollutants = [
    { pollutantCode: "CO", unitCode: "g/kWh", valueKey: "co" },
    {
      pollutantCode: "HC+NOx",
      unitCode: "g/kWh",
      valueKey: "hcNox",
    },
    { pollutantCode: "PM", unitCode: "g/kWh", valueKey: "pm" },
    {
      pollutantCode: "OPACITY",
      unitCode: "m-1",
      valueKey: "opacity",
    },
  ] as const;
  for (const band of sriLankaConstructionBands) {
    for (const pollutant of sriLankaConstructionPollutants) {
      limits.push(
        fixtureLimit(
          acceptanceFixtureIds.regulation.sriLankaVehicleEmission2018,
          acceptanceFixtureIds.source.sriLankaEnvironment,
          {
            applicationScope: "construction",
            limitValue: band[pollutant.valueKey],
            measurementBasis:
              pollutant.pollutantCode === "OPACITY"
                ? `Gazette 2079/42 Third Schedule Table 6; construction-equipment vehicles; smoke opacity at 80% of full load; C1 for variable-speed or D2 for constant-speed engines are alternatives and not cumulative; ${sriLankaImportGrandfathering}`
                : `Gazette 2079/42 Third Schedule Table 6; construction-equipment vehicles; C1 for variable-speed or D2 for constant-speed engines are alternatives and not cumulative; ${sriLankaImportGrandfathering}`,
            pollutantCode: pollutant.pollutantCode,
            powerMaxKw: band.powerMaxKw,
            powerMinKw: band.powerMinKw,
            testCycleCode:
              "ISO 8178-4 C1 (variable-speed) OR D2 (constant-speed)",
            unitCode: pollutant.unitCode,
            validFrom: "2018-07-13",
            verifiedAt: sriLankaVerificationTimestamp,
          },
        ),
      );
    }
  }

  const uruguayEsc = [
    { pollutantCode: "CO", limitValue: "1.5", unitCode: "g/kWh" },
    { pollutantCode: "HC", limitValue: "0.46", unitCode: "g/kWh" },
    { pollutantCode: "NOX", limitValue: "2.0", unitCode: "g/kWh" },
    { pollutantCode: "PM", limitValue: "0.02", unitCode: "g/kWh" },
    { pollutantCode: "OPACITY", limitValue: "0.5", unitCode: "m-1" },
  ] as const;
  const uruguayEtc = [
    { pollutantCode: "CO", limitValue: "4.0", unitCode: "g/kWh" },
    { pollutantCode: "NMHC", limitValue: "0.55", unitCode: "g/kWh" },
    { pollutantCode: "NOX", limitValue: "2.0", unitCode: "g/kWh" },
    { pollutantCode: "PM", limitValue: "0.03", unitCode: "g/kWh" },
  ] as const;
  for (const applicationScope of scopes) {
    for (const [testCycleCode, rows] of [
      ["ESC", uruguayEsc],
      ["ETC", uruguayEtc],
    ] as const) {
      for (const row of rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.uruguayDecree1352021,
            acceptanceFixtureIds.source.uruguayEnvironment,
            {
              ...row,
              applicationScope,
              measurementBasis:
                "Decreto 135/021 Article 48 Table 17, zero-kilometre compression-ignition M/N vehicles above 2,610 kg; Table 14 maps M2/M3 passenger vehicles and N2/N3 freight vehicles",
              testCycleCode,
              validFrom: "2023-05-14",
              verifiedAt: uruguayVerificationTimestamp,
            },
          ),
        );
      }
    }
  }

  const papuaNewGuineaAdr803Esc = [
    { pollutantCode: "CO", limitValue: "1.5", unitCode: "g/kWh" },
    { pollutantCode: "THC", limitValue: "0.46", unitCode: "g/kWh" },
    { pollutantCode: "NOX", limitValue: "2.0", unitCode: "g/kWh" },
    { pollutantCode: "PM", limitValue: "0.02", unitCode: "g/kWh" },
  ] as const;
  const papuaNewGuineaAdr803Etc = [
    { pollutantCode: "CO", limitValue: "4.0", unitCode: "g/kWh" },
    { pollutantCode: "NMHC", limitValue: "0.55", unitCode: "g/kWh" },
    { pollutantCode: "NOX", limitValue: "2.0", unitCode: "g/kWh" },
    { pollutantCode: "PM", limitValue: "0.03", unitCode: "g/kWh" },
  ] as const;
  for (const [testCycleCode, rows] of [
    ["ESC", papuaNewGuineaAdr803Esc],
    ["ETC", papuaNewGuineaAdr803Etc],
  ] as const) {
    for (const row of rows) {
      limits.push(
        fixtureLimit(
          acceptanceFixtureIds.regulation.papuaNewGuineaHeavyTruckAdr803,
          acceptanceFixtureIds.source.australiaAdr80_03,
          {
            ...row,
            applicationScope: "on-road-truck",
            measurementBasis:
              "PNG Vehicle Standards and Compliance Rule section 6A(4)(b): diesel motor truck above 4,500 kg manufactured on or after 2012; ADR 80/03 is one representative alternative and must not be combined with Euro V, Japan 05 or US 2004. ADR 80/03 clause 4.1.1 and Appendix A section 6.2.1 require the B2 ESC, ELR and ETC limits.",
            testCycleCode,
            validFrom: "2019-01-01",
            verifiedAt: papuaNewGuineaVerificationTimestamp,
          },
        ),
      );
    }
  }

  // Taiwan Phase 6 Article 5 gives EU-style and US-style heavy-diesel paths as
  // alternatives. Publish only the WHSC/WHTC/WNTE representative path. PN is
  // stored in e9/kWh so 8.0×10^11 and 6.0×10^11 #/kWh become 800 and 600.
  const taiwanWhsc = [
    { pollutantCode: "CO", limitValue: "1500", unitCode: "mg/kWh" },
    { pollutantCode: "THC", limitValue: "130", unitCode: "mg/kWh" },
    { pollutantCode: "NOX", limitValue: "400", unitCode: "mg/kWh" },
    { pollutantCode: "PM", limitValue: "10", unitCode: "mg/kWh" },
    { pollutantCode: "PN", limitValue: "800", unitCode: "e9/kWh" },
    { pollutantCode: "NH3", limitValue: "10", unitCode: "ppm" },
  ] as const;
  const taiwanWhtc = [
    { pollutantCode: "CO", limitValue: "4000", unitCode: "mg/kWh" },
    { pollutantCode: "THC", limitValue: "160", unitCode: "mg/kWh" },
    { pollutantCode: "NOX", limitValue: "460", unitCode: "mg/kWh" },
    { pollutantCode: "PM", limitValue: "10", unitCode: "mg/kWh" },
    { pollutantCode: "PN", limitValue: "600", unitCode: "e9/kWh" },
    { pollutantCode: "NH3", limitValue: "10", unitCode: "ppm" },
  ] as const;
  const taiwanWnte = [
    { pollutantCode: "CO", limitValue: "2000", unitCode: "mg/kWh" },
    { pollutantCode: "THC", limitValue: "220", unitCode: "mg/kWh" },
    { pollutantCode: "NOX", limitValue: "600", unitCode: "mg/kWh" },
    { pollutantCode: "PM", limitValue: "16", unitCode: "mg/kWh" },
  ] as const;
  for (const applicationScope of ["on-road-truck", "on-road-bus"] as const) {
    for (const [testCycleCode, rows] of [
      ["WHSC", taiwanWhsc],
      ["WHTC", taiwanWhtc],
      ["WNTE", taiwanWnte],
    ] as const) {
      for (const row of rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.taiwanHeavyDieselPhase6,
            acceptanceFixtureIds.source.taiwanEnvironment,
            {
              ...row,
              applicationScope,
              measurementBasis:
                "Article 5 heavy-diesel EU-style representative pathway for passenger/freight vehicles with gross vehicle weight > 3,500 kg or passenger vehicles with at least 10 seats; the 2019-09-01 transition allowed existing heavy-engine families through 2021-08-31, so this model uses 2021-09-01 full coverage; WHSC/WHTC/WNTE is alternative to US FTP-Transient and is not cumulative",
              testCycleCode,
              validFrom: "2021-09-01",
              verifiedAt: taiwanVerificationTimestamp,
            },
          ),
        );
      }
    }
  }

  // Venezuela Decreto 2.673 Article 11 makes the European and US heavy-duty
  // routes alternatives. Store only Article 7 / Table 4's 91/542/EEC route.
  // Its PM footnote applies a 1.7 multiplier at maximum power <= 85 kW.
  const venezuelaCommonRows = [
    { pollutantCode: "CO", limitValue: "4.5" },
    { pollutantCode: "HC", limitValue: "1.1" },
    { pollutantCode: "NOX", limitValue: "8.0" },
  ] as const;
  const venezuelaMeasurementBasis =
    "Decreto 2.673 Article 7 / Table 4 European representative pathway for model year 2000 and later imported or domestically assembled diesel road vehicles with maximum vehicle weight > 3,500 kg; 2000-01-01 is the MY2000 normalized boundary; Directive 91/542/EEC is alternative to the US heavy-duty transient route and is not cumulative";
  for (const applicationScope of ["on-road-truck", "on-road-bus"] as const) {
    for (const row of venezuelaCommonRows) {
      limits.push(
        fixtureLimit(
          acceptanceFixtureIds.regulation.venezuelaHeavyDieselMy2000,
          acceptanceFixtureIds.source.venezuelaEnvironment,
          {
            ...row,
            applicationScope,
            measurementBasis: venezuelaMeasurementBasis,
            testCycleCode: "Directive 91/542/EEC",
            unitCode: "g/kWh",
            validFrom: "2000-01-01",
            verifiedAt: venezuelaVerificationTimestamp,
          },
        ),
      );
    }
    limits.push(
      fixtureLimit(
        acceptanceFixtureIds.regulation.venezuelaHeavyDieselMy2000,
        acceptanceFixtureIds.source.venezuelaEnvironment,
        {
          applicationScope,
          limitValue: "0.612",
          measurementBasis:
            `${venezuelaMeasurementBasis}; PM 0.36 g/kWh is multiplied by 1.7 when maximum engine power <= 85 kW`,
          pollutantCode: "PM",
          powerMaxKw: 85.001,
          testCycleCode: "Directive 91/542/EEC",
          unitCode: "g/kWh",
          validFrom: "2000-01-01",
          verifiedAt: venezuelaVerificationTimestamp,
        },
      ),
      fixtureLimit(
        acceptanceFixtureIds.regulation.venezuelaHeavyDieselMy2000,
        acceptanceFixtureIds.source.venezuelaEnvironment,
        {
          applicationScope,
          limitValue: "0.36",
          measurementBasis:
            `${venezuelaMeasurementBasis}; the 1.7 PM multiplier applies only at maximum engine power <= 85 kW`,
          pollutantCode: "PM",
          powerMinKw: 85.001,
          testCycleCode: "Directive 91/542/EEC",
          unitCode: "g/kWh",
          validFrom: "2000-01-01",
          verifiedAt: venezuelaVerificationTimestamp,
        },
      ),
    );
  }

  // Keep all previously generated limit UUIDs stable by appending newly verified
  // rows only at the end of the fixture builder.
  for (const applicationScope of ["on-road-truck", "on-road-bus"] as const) {
    limits.push(
      fixtureLimit(
        acceptanceFixtureIds.regulation.australiaAdr80_03,
        acceptanceFixtureIds.source.australiaAdr80_03,
        {
          applicationScope,
          limitValue: "0.5",
          measurementBasis:
            "ADR 80/03 clause 4.1.1 and Appendix A section 6.2.1 Table 1 row B2; smoke opacity is determined on the ELR test; full-coverage interval [2011-01-01, 2025-11-01)",
          pollutantCode: "OPACITY",
          testCycleCode: "ELR",
          unitCode: "m-1",
          validFrom: "2011-01-01",
          validTo: "2025-11-01",
          verifiedAt: australiaVerificationTimestamp,
        },
      ),
    );
  }

  const australiaAdr804MissingRows = [
    { pollutantCode: "CO", limitValue: "1500", testCycleCode: "WHSC", unitCode: "mg/kWh" },
    { pollutantCode: "THC", limitValue: "130", testCycleCode: "WHSC", unitCode: "mg/kWh" },
    { pollutantCode: "NH3", limitValue: "10", testCycleCode: "WHSC", unitCode: "ppm" },
    { pollutantCode: "PN", limitValue: "800", testCycleCode: "WHSC", unitCode: "e9/kWh" },
    { pollutantCode: "CO", limitValue: "4000", testCycleCode: "WHTC", unitCode: "mg/kWh" },
    { pollutantCode: "THC", limitValue: "160", testCycleCode: "WHTC", unitCode: "mg/kWh" },
    { pollutantCode: "NH3", limitValue: "10", testCycleCode: "WHTC", unitCode: "ppm" },
    { pollutantCode: "PN", limitValue: "600", testCycleCode: "WHTC", unitCode: "e9/kWh" },
  ] as const;
  for (const applicationScope of ["on-road-truck", "on-road-bus"] as const) {
    for (const row of australiaAdr804MissingRows) {
      limits.push(
        fixtureLimit(
          acceptanceFixtureIds.regulation.australiaAdr80_04,
          acceptanceFixtureIds.source.australiaAdr80_04,
          {
            ...row,
            applicationScope,
            measurementBasis:
              "ADR 80/04 Appendix A section 5.3 Table 1, compression-ignition engine; complete WHSC/WHTC Euro VI Stage C representative pathway; PN is stored in e9/kWh; US and Japan standards are alternatives and are not cumulative",
            validFrom: "2025-11-01",
            verifiedAt: australiaVerificationTimestamp,
          },
        ),
      );
    }
  }

  limits.push(
    fixtureLimit(
      acceptanceFixtureIds.regulation.papuaNewGuineaHeavyTruckAdr803,
      acceptanceFixtureIds.source.australiaAdr80_03,
      {
        applicationScope: "on-road-truck",
        limitValue: "0.5",
        measurementBasis:
          "PNG Vehicle Standards and Compliance Rule section 6A(4)(b): diesel motor truck above 4,500 kg manufactured on or after 2012; ADR 80/03 is one representative alternative and must not be combined with Euro V, Japan 05 or US 2004. ADR 80/03 clause 4.1.1 and Appendix A section 6.2.1 Table 1 row B2 determine smoke opacity on the ELR test.",
        pollutantCode: "OPACITY",
        testCycleCode: "ELR",
        unitCode: "m-1",
        validFrom: "2019-01-01",
        verifiedAt: papuaNewGuineaVerificationTimestamp,
      },
    ),
  );

  // Append newly verified Canadian rows so all existing fixture UUIDs remain
  // stable. The earlier Canadian loops retain their original row positions.
  const canadaRoadMissingRows = [
    { pollutantCode: "CO", limitValue: "15.5", unitCode: "g/hp-hr" },
    { pollutantCode: "NMHC", limitValue: "0.14", unitCode: "g/hp-hr" },
  ] as const;
  for (const applicationScope of scopes) {
    for (const row of canadaRoadMissingRows) {
      limits.push(
        fixtureLimit(
          acceptanceFixtureIds.regulation.canadaRoad2003,
          acceptanceFixtureIds.source.usEcfr86,
          {
            ...row,
            applicationScope,
            measurementBasis: canadaRoadMeasurementBasis,
            testCycleCode: "FTP/SET",
            validFrom: "2010-01-01",
            verifiedAt: canadaVerificationTimestamp,
          },
        ),
      );
    }
  }

  for (const applicationScope of ["construction", "agriculture"] as const) {
    limits.push(
      fixtureLimit(
        acceptanceFixtureIds.regulation.canadaOffroad2020,
        acceptanceFixtureIds.source.usEcfr1039,
        {
          applicationScope,
          limitValue: "3.5",
          measurementBasis: canadaOffroadMeasurementBasis,
          pollutantCode: "CO",
          powerMinKw: cfr1039RoundedPowerBounds.from130MinKw,
          powerMaxKw: cfr1039RoundedPowerBounds.through560MaxKw,
          testCycleCode: "NRTC AND NRSC-C1 (8-mode OR RMC)",
          unitCode: "g/kWh",
          validFrom: "2021-06-04",
          verifiedAt: canadaVerificationTimestamp,
        },
      ),
    );
  }

  // Append newly verified United States rows so all earlier fixture UUIDs,
  // including the Canadian completion rows above, remain stable.
  const usCfr86MissingRows = [
    {
      measurementBasis: usCfr86PrimaryMeasurementBasis,
      pollutantCode: "NMHC",
      limitValue: "0.14",
      testCycleCode: "FTP/SET",
      unitCode: "g/bhp-hr",
    },
    {
      measurementBasis: usCfr86PrimaryMeasurementBasis,
      pollutantCode: "CO",
      limitValue: "15.5",
      testCycleCode: "FTP/SET",
      unitCode: "g/bhp-hr",
    },
    {
      measurementBasis: usCfr86PrimaryMeasurementBasis,
      pollutantCode: "PM",
      limitValue: "0.01",
      testCycleCode: "FTP/SET",
      unitCode: "g/bhp-hr",
    },
    {
      measurementBasis: usCfr86SmokeMeasurementBasis,
      pollutantCode: "OPACITY",
      limitValue: "20",
      testCycleCode: "CFR86-SMOKE-ACCEL",
      unitCode: "%",
    },
    {
      measurementBasis: usCfr86SmokeMeasurementBasis,
      pollutantCode: "OPACITY",
      limitValue: "15",
      testCycleCode: "CFR86-SMOKE-LUG",
      unitCode: "%",
    },
    {
      measurementBasis: usCfr86SmokeMeasurementBasis,
      pollutantCode: "OPACITY",
      limitValue: "50",
      testCycleCode: "CFR86-SMOKE-PEAK",
      unitCode: "%",
    },
  ] as const;
  for (const applicationScope of scopes) {
    for (const row of usCfr86MissingRows) {
      limits.push(
        fixtureLimit(
          acceptanceFixtureIds.regulation.us8600711,
          acceptanceFixtureIds.source.usEcfr86,
          {
            ...row,
            applicationScope,
            validFrom: "2010-01-01",
            validTo: "2027-01-01",
            verifiedAt: unitedStatesVerificationTimestamp,
          },
        ),
      );
    }
  }

  const usCfr1036MissingRows = [
    {
      pollutantCode: "NMHC",
      limitValue: "0.060",
      testCycleCode: "FTP/SET",
      unitCode: "g/hp-hr",
    },
    {
      pollutantCode: "NOX",
      limitValue: "0.050",
      testCycleCode: "LLC",
      unitCode: "g/hp-hr",
    },
    {
      pollutantCode: "NMHC",
      limitValue: "0.140",
      testCycleCode: "LLC",
      unitCode: "g/hp-hr",
    },
    {
      pollutantCode: "PM",
      limitValue: "0.005",
      testCycleCode: "LLC",
      unitCode: "g/hp-hr",
    },
    {
      pollutantCode: "CO",
      limitValue: "6.0",
      testCycleCode: "LLC",
      unitCode: "g/hp-hr",
    },
  ] as const;
  for (const applicationScope of scopes) {
    for (const row of usCfr1036MissingRows) {
      limits.push(
        fixtureLimit(
          acceptanceFixtureIds.regulation.us1036104,
          acceptanceFixtureIds.source.usEcfr1036,
          {
            ...row,
            applicationScope,
            measurementBasis: usCfr1036PrimaryMeasurementBasis,
            validFrom: "2027-01-01",
            verifiedAt: unitedStatesVerificationTimestamp,
          },
        ),
      );
    }
  }

  for (const applicationScope of ["construction", "agriculture"] as const) {
    limits.push(
      fixtureLimit(
        acceptanceFixtureIds.regulation.us1039101,
        acceptanceFixtureIds.source.usEcfr1039,
        {
          applicationScope,
          limitValue: "3.5",
          measurementBasis: usCfr1039VariableSpeedMeasurementBasis,
          pollutantCode: "CO",
          powerMinKw: cfr1039RoundedPowerBounds.from130MinKw,
          powerMaxKw: cfr1039RoundedPowerBounds.through560MaxKw,
          testCycleCode: "NRTC AND NRSC-C1 (8-mode OR RMC)",
          unitCode: "g/kWh",
          validFrom: "2015-01-01",
          verifiedAt: unitedStatesVerificationTimestamp,
        },
      ),
    );
  }

  // Complete the lower-power 40 CFR 1039.101 Table 1 bands for the United
  // States and Canada's incorporation of the same provisions. These rows are
  // appended so every previously published fixture UUID remains stable.
  const cfr1039MissingVariableSpeedBands = [
    {
      powerMinKw: 0,
      powerMaxKw: cfr1039RoundedPowerBounds.below8MaxKw,
      testCycleCode: "NRTC AND NRSC (6-mode OR 8-mode/RMC)",
      rows: [
        { pollutantCode: "CO", limitValue: "8.0", unitCode: "g/kWh" },
        {
          pollutantCode: "NOX+NMHC",
          limitValue: "7.5",
          unitCode: "g/kWh",
        },
        { pollutantCode: "PM", limitValue: "0.40", unitCode: "g/kWh" },
      ],
    },
    {
      powerMinKw: cfr1039RoundedPowerBounds.from8MinKw,
      powerMaxKw: cfr1039RoundedPowerBounds.from8To19MaxKw,
      testCycleCode: "NRTC AND NRSC (6-mode OR 8-mode/RMC)",
      rows: [
        { pollutantCode: "CO", limitValue: "6.6", unitCode: "g/kWh" },
        {
          pollutantCode: "NOX+NMHC",
          limitValue: "7.5",
          unitCode: "g/kWh",
        },
        { pollutantCode: "PM", limitValue: "0.40", unitCode: "g/kWh" },
      ],
    },
    {
      powerMinKw: cfr1039RoundedPowerBounds.from19MinKw,
      powerMaxKw: cfr1039RoundedPowerBounds.from19To37MaxKw,
      testCycleCode: "NRTC AND NRSC-C1 (8-mode OR RMC)",
      rows: [
        { pollutantCode: "CO", limitValue: "5.5", unitCode: "g/kWh" },
        {
          pollutantCode: "NOX+NMHC",
          limitValue: "4.7",
          unitCode: "g/kWh",
        },
        { pollutantCode: "PM", limitValue: "0.03", unitCode: "g/kWh" },
      ],
    },
    {
      powerMinKw: cfr1039RoundedPowerBounds.from37MinKw,
      powerMaxKw: cfr1039RoundedPowerBounds.from37To56MaxKw,
      testCycleCode: "NRTC AND NRSC-C1 (8-mode OR RMC)",
      rows: [
        { pollutantCode: "CO", limitValue: "5.0", unitCode: "g/kWh" },
        {
          pollutantCode: "NOX+NMHC",
          limitValue: "4.7",
          unitCode: "g/kWh",
        },
        { pollutantCode: "PM", limitValue: "0.03", unitCode: "g/kWh" },
      ],
    },
    {
      powerMinKw: cfr1039RoundedPowerBounds.from56MinKw,
      powerMaxKw: cfr1039RoundedPowerBounds.from56To130MaxKw,
      testCycleCode: "NRTC AND NRSC-C1 (8-mode OR RMC)",
      rows: [
        { pollutantCode: "CO", limitValue: "5.0", unitCode: "g/kWh" },
        { pollutantCode: "NMHC", limitValue: "0.19", unitCode: "g/kWh" },
        { pollutantCode: "NOX", limitValue: "0.40", unitCode: "g/kWh" },
        { pollutantCode: "PM", limitValue: "0.02", unitCode: "g/kWh" },
      ],
    },
  ] as const;
  for (const applicationScope of ["construction", "agriculture"] as const) {
    for (const band of cfr1039MissingVariableSpeedBands) {
      for (const row of band.rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.us1039101,
            acceptanceFixtureIds.source.usEcfr1039,
            {
              ...row,
              applicationScope,
              measurementBasis: usCfr1039VariableSpeedMeasurementBasis,
              powerMinKw: band.powerMinKw,
              powerMaxKw: band.powerMaxKw,
              testCycleCode: band.testCycleCode,
              validFrom: "2015-01-01",
              verifiedAt: unitedStatesVerificationTimestamp,
            },
          ),
        );
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.canadaOffroad2020,
            acceptanceFixtureIds.source.usEcfr1039,
            {
              ...row,
              applicationScope,
              measurementBasis: canadaOffroadMeasurementBasis,
              powerMinKw: band.powerMinKw,
              powerMaxKw: band.powerMaxKw,
              testCycleCode: band.testCycleCode,
              validFrom: "2021-06-04",
              verifiedAt: canadaVerificationTimestamp,
            },
          ),
        );
      }
    }
  }

  // Append the GB 20891 rows that were omitted by the original representative
  // fixture so every current Stage IV band and the preceding full-coverage
  // Stage III interval are queryable without shifting any published UUID.
  const gb20891Stage4AdditionalBands = [
    {
      powerMinKw: 0,
      powerMaxKw: 37,
      rows: [
        { pollutantCode: "CO", limitValue: "5.5", unitCode: "g/kWh" },
        { pollutantCode: "HC+NOx", limitValue: "7.5", unitCode: "g/kWh" },
        { pollutantCode: "PM", limitValue: "0.60", unitCode: "g/kWh" },
      ],
    },
    {
      powerMinKw: 37,
      powerMaxKw: 56,
      rows: [
        { pollutantCode: "CO", limitValue: "5.0", unitCode: "g/kWh" },
        { pollutantCode: "HC+NOx", limitValue: "4.7", unitCode: "g/kWh" },
        { pollutantCode: "PM", limitValue: "0.025", unitCode: "g/kWh" },
        { pollutantCode: "PN", limitValue: "5000", unitCode: "e9/kWh" },
      ],
    },
    {
      powerMinKw: 130,
      powerMaxKw: 560.001,
      rows: [
        { pollutantCode: "CO", limitValue: "3.5", unitCode: "g/kWh" },
        { pollutantCode: "HC", limitValue: "0.19", unitCode: "g/kWh" },
        { pollutantCode: "NOX", limitValue: "2.0", unitCode: "g/kWh" },
        { pollutantCode: "PM", limitValue: "0.025", unitCode: "g/kWh" },
        { pollutantCode: "PN", limitValue: "5000", unitCode: "e9/kWh" },
      ],
    },
  ] as const;
  const gb20891Stage3HistoricalBands = [
    {
      powerMinKw: 0,
      powerMaxKw: 37,
      rows: [
        { pollutantCode: "CO", limitValue: "5.5", unitCode: "g/kWh" },
        { pollutantCode: "HC+NOx", limitValue: "7.5", unitCode: "g/kWh" },
        { pollutantCode: "PM", limitValue: "0.60", unitCode: "g/kWh" },
      ],
    },
    {
      powerMinKw: 37,
      powerMaxKw: 75,
      rows: [
        { pollutantCode: "CO", limitValue: "5.0", unitCode: "g/kWh" },
        { pollutantCode: "HC+NOx", limitValue: "4.7", unitCode: "g/kWh" },
        { pollutantCode: "PM", limitValue: "0.40", unitCode: "g/kWh" },
      ],
    },
    {
      powerMinKw: 75,
      powerMaxKw: 130,
      rows: [
        { pollutantCode: "CO", limitValue: "5.0", unitCode: "g/kWh" },
        { pollutantCode: "HC+NOx", limitValue: "4.0", unitCode: "g/kWh" },
        { pollutantCode: "PM", limitValue: "0.30", unitCode: "g/kWh" },
      ],
    },
    {
      powerMinKw: 130,
      powerMaxKw: 560.001,
      rows: [
        { pollutantCode: "CO", limitValue: "3.5", unitCode: "g/kWh" },
        { pollutantCode: "HC+NOx", limitValue: "4.0", unitCode: "g/kWh" },
        { pollutantCode: "PM", limitValue: "0.20", unitCode: "g/kWh" },
      ],
    },
  ] as const;
  const gb20891Stage3HistoricalMeasurementBasis =
    "GB 20891-2014 sections 5.2.1 and 10, Table 2: Stage III full-coverage interval [2016-04-01, 2022-12-01) for engines at or below 560 kW; steady-state NRSC applies";
  for (const applicationScope of ["construction", "agriculture"] as const) {
    for (const band of gb20891Stage4AdditionalBands) {
      for (const row of band.rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.cnGb20891,
            acceptanceFixtureIds.source.cnGb20891,
            {
              ...row,
              applicationScope,
              measurementBasis: gb20891Stage4MeasurementBasis,
              powerMinKw: band.powerMinKw,
              powerMaxKw: band.powerMaxKw,
              testCycleCode: "NRSC AND applicable NRTC",
              validFrom: "2022-12-01",
              verifiedAt: chinaNonroadVerificationTimestamp,
            },
          ),
        );
      }
    }
    for (const band of gb20891Stage3HistoricalBands) {
      for (const row of band.rows) {
        limits.push(
          fixtureLimit(
            acceptanceFixtureIds.regulation.cnGb20891,
            acceptanceFixtureIds.source.cnGb20891,
            {
              ...row,
              applicationScope,
              measurementBasis: gb20891Stage3HistoricalMeasurementBasis,
              powerMinKw: band.powerMinKw,
              powerMaxKw: band.powerMaxKw,
              testCycleCode: "NRSC",
              validFrom: "2016-04-01",
              validTo: "2022-12-01",
              verifiedAt: chinaNonroadVerificationTimestamp,
            },
          ),
        );
      }
    }
  }

  return limits;
}

export async function seedAcceptanceFixtures<
  TQueryResult extends PgQueryResultHKT,
>(database: PgDatabase<TQueryResult, typeof schema>): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction
      .insert(dataSources)
      .values(fixtureSources)
      .onConflictDoNothing();
    await transaction
      .insert(jurisdictions)
      .values(fixtureJurisdictions)
      .onConflictDoNothing();
    await transaction
      .insert(countryJurisdictions)
      .values(fixtureCountryJurisdictions)
      .onConflictDoNothing();
    await transaction
      .insert(regulations)
      .values(fixtureRegulations)
      .onConflictDoNothing();
    await transaction
      .insert(regulationLimits)
      .values(buildFixtureLimits())
      .onConflictDoNothing();
  });
}
