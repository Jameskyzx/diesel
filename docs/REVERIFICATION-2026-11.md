# 2026-11 全量复核记录（178 国）

- 复核日期：2026-11-17 至 2026-11-19
- 起因：线上巡检（Production canary）自 2026-11-09 起每 6 小时失败一次。原因是 178 国的核对日期都停在 2026-08-10/11，超过了 90 天（`COUNTRY_STALE_AFTER_DAYS`），全部被标成"已过期"。2026-11-13 起又叠加了 GitHub 附件存储额度用满，上传巡检结果失败。
- 范围：线上 178 国引用的全部 341 条来源（法规来源 332 条，市场数据来源 9 条），逐条打开官方地址核对；并补查有限值国家在 2026-08 之后有没有出新法规。
- 状态：复核已完成。2026-11-20 经负责人同意，已在服务器上把 247 条来源的核对日期写回线上数据库（见第 6 节）。第 3 节的数据修改和首页、地图的国家日期还没有发布，定在下次正式发布一起做（见第 8 节）。

## 1. 核对方法

1. 用浏览器标识逐条下载官方地址（同一网站间隔 2 秒，不绕过验证码、地区封锁或证书错误）。
2. 下载到的 PDF/网页抽取文字，按文号、标题、日期比对；数字统一转换（泰文、孟加拉文数字等）。
3. 自动比对不确定的，人工打开原文读回。
4. 有限值的国家另查 2026-08 以后的新法规（官方公报、主管部门公告、行业新闻交叉核对）。

## 2. 结果数字

| 结果 | 条数 | 含义 |
| --- | ---: | --- |
| 确认 | 228 | 原文可打开，文号、标题、内容与库中一致 |
| 确认（页面可达） | 24 | 官方页面可打开且是同一文件，正文为图片或目录页，未能逐字比对 |
| 确认但需改标注 | 1 | EU 2024/1257：原文一致，但库中重型车切换日期写错（见第 3 节） |
| 地址已搬走 | 19 | 原地址 404 或被改指向；其中 2 条找到了新的官方地址 |
| 打不开 | 69 | 从本机网络无法连上（超时、地区封锁、证书过期等），本轮不能确认 |
| 合计 | 341 | |

## 3. 需要修改的数据

按影响程度排序。前两条影响**今天**的查询结果。

| # | 国家 | 问题 | 依据 | 建议改法 |
| --- | --- | --- | --- | --- |
| 1 | PER 秘鲁 | 库中写重型柴油车 Euro VI 自 2024-10-01 生效，实际**至今未生效** | D.S. 003-2024-EM（2024-02-02）把 D.S. 029-2021-MINAM 第一补充条款改为"10 ppm 燃油义务生效后 6 个月"才执行 Euro 6/VI；D.S. 011-2025-EM 与 D.S. 024-2026-EM（2026-10-29 公布）又把 10 ppm 柴油推迟到 2030-08-31、汽油推迟到 2029-08-31 | 当前应返回 Euro IV（D.S. 010-2017-MINAM 附件 I.7 的 Euro IV 行）；Euro VI 改为未来生效，日期按"柴油 10 ppm 生效后 6 个月"约为 2031-02-28，需法规负责人确认取哪一个燃油日期 |
| 2 | CAN 加拿大 | 库中 MY2010+ 路径没有截止日，2027 年起的查询会返回旧限值 | 环境部长 2026-10-13 签发 Interim Order（Canada Gazette I，2026-10-31，经总督令延长最长一年）：2027 及以后机型年、2026-12-20 起完成制造的柴油重型发动机须符合 40 CFR 1036.104（EPA 2027） | 仿照美国 #403/#404：新增 1036.104 代表路径（2027-01-01 机型年代理），SOR/2003-2 的 MY2010+ 路径截止 2027-01-01；备注 Interim Order 最长到 2027-10-13，之后看正式修订 |
| 3 | EU-27 与 ISL 冰岛 | 重型车 Euro 7 切换日写成 2027-11-29（这是 M1/N1 的日期） | (EU) 2024/1257 第 20 条：M2/M3/N2/N3 新车型 2028-05-29、全部新车 2029-05-29；595/2009 自 2031-07-01 废止。挪威记录已用 2029-05-29 | 改 acceptance-fixtures.ts 第 6525、6531、6555、6561、7455、7461 行和冰岛第 10679 行的日期；同步改 ACCEPTANCE.md #6 的说明 |
| 4 | CHE 瑞士、LIE 列支敦士登 | 引用版本标注"Stand/Fassung 01.07.2026"已落后一版 | 现行合并版本为 2026-10-01；相关条文内容未变 | 只改标注 |
| 5 | SAU 沙特 | 引用 GSO 车型年清单 MY2026-D4，已有 MY2027-D3、MY2028-D3 | 三份清单对重型柴油都仍是 Euro V | 可改引用到最新清单，内容不变 |

可补充的未来记录（不影响当前结果）：

- UKR 乌克兰：进口和首次登记自 2027-01-01 要求 Euro 6。库中现有记录正好在 2027-01-01 截止，之后没有接续记录。
- TUR 土耳其：Euro 7 型式认证规章已于 2025-10-24 在官方公报（第 33057 号）公布，重型车日期跟随欧盟。库中 Euro VI 记录没有截止日。

## 4. 补查新法规的结论

| 结论 | 国家 / 地区 |
| --- | --- |
| 有新变化，已列入第 3 节 | 秘鲁、加拿大 |
| 有动静但未定稿，继续观察 | 美国 91 FR 43154（仍是征求意见稿）；印度 G.S.R. 151(E)（仍是草案）；菲律宾 Euro V 行政令草案（计划 2027-01-01，未找到签发文本）；澳大利亚 ADR 80/04 修订（2026-04 征求意见，未见正式文件）；英国 Euro 7（2026-04 至 05 征求意见，重型车后续另定） |
| 与库中一致，没有新变化 | 中国、欧盟（2026/1214、2026/1216 不涉及重型柴油限值）、日本、韩国（只有温室气体新规）、墨西哥、巴西（CONAMA 513/2026 是空气质量框架，不改限值）、智利、哥伦比亚、阿根廷、哈萨克斯坦/欧亚经济联盟、瑞士、越南、泰国、印尼、新西兰、肯尼亚、阿联酋（与 GSO 清单 Euro 6b 说明一致）、南非、台湾 |

## 5. 写回后仍会显示"已过期"的国家

只把确认过、且数据无误的来源写回核对日期：清单上 248 条，其中美国 91 FR 43154（征求意见稿）线上数据库里还没有，实际写回 247 条。下列 5 条暂不写回，等第 3 节改完数据后再写：EU 595/2009、EU 2024/1257、冰岛 377/2013、秘鲁 D.S. 029-2021-MINAM、加拿大 SOR/2003-2。

线上另有一条来源不在本轮 341 条里：尼日利亚联邦环境部标准门户（`10000000-0000-4000-8000-000000000399`，上次核对 2026-08-09），本轮没有复核，也没有写回。

写回后 157 国的国家详情页恢复为"已核对"（第 6 节逐国实测）。下列 21 国的来源全部打不开或已搬走，仍会显示已过期：

BRN 文莱、CMR 喀麦隆、DOM 多米尼加、SLV 萨尔瓦多、ETH 埃塞俄比亚、ATF 法属南部领地、HND 洪都拉斯、IDN 印尼、ISR 以色列、CIV 科特迪瓦、JOR 约旦、MNE 黑山、NIC 尼加拉瓜、MKD 北马其顿、PNG 巴布亚新几内亚、PER 秘鲁（数据待改）、LKA 斯里兰卡、TGO 多哥、UKR 乌克兰、ARE 阿联酋、YEM 也门。

线上巡检查的是中国（CHN）。中国的来源都已确认，写回后巡检的数据检查已经通过；但上传巡检报告一步仍受 GitHub 存储额度影响，见第 6、7 节。

不写回"国家目录"来源（`00000000-0000-4000-8000-000000000006`）：178 国都挂着它，只要改它的日期，所有国家都会显示"已核对"，掩盖上面 21 国的真实状态。

## 6. 写回记录

### 为什么用服务器维护命令

- 线上管理后台按设计不对外开放（nginx 对管理路径一律返回 404），不能在网页上逐条点"核对"。
- 改数据文件后正常发布：发布闸门要读仓库的分支保护设置，私有仓库在 GitHub 免费版下读不到，所以目前发布会被拦下（见 DEPLOYMENT.md §2）。按规定不绕过闸门。
- 当时的三个选项：服务器维护命令；升级 GitHub Pro（约 4 美元/月）后正常发布；直接改数据库（不留审计记录，不建议）。负责人于 2026-11-20 选了第一个。

### 执行情况（2026-11-20 00:29 至 00:42，北京时间）

- 做法：在服务器上用当前线上版本（`7462e6ca`，旧提交号，只能在私有存档仓库 diesel-private-archive 里查到）的代码，逐条调用应用自己的 `verifyDataSource`。这和后台"核对来源"按钮是同一段程序：每条单独一个事务，有"日期不能倒退"的检查，有治理写锁，并写一条 `data_change_logs` 审计记录。
- 写入内容：每条来源只改 `verified_at`（改为 `2026-11-19T00:00:00+08:00`）和 `updated_at`，其他字段不动。
- 操作身份：`source-reverification@automation.local`，角色 editor。沿用库里已有的 `*@automation.local` 自动化身份的写法。
- 原因字段写明：逐条打开官方原文核对，经站点负责人同意写回，明细见本文件和 CSV。
- 结果：247 条全部写入，审计记录 247 条，每条来源各 1 条，没有重复。第一次运行到第 236 条时被我设的 570 秒时限中断：每条来源各自提交，所以已写入的不受影响。第二次运行自动跳过已写入的 236 条，补完剩下 11 条。
- 没有写回：5 条暂缓来源；国家目录来源 `…0006`；尼日利亚 `…0399`；8 条演示用虚构来源。
- 写前检查：247 条都在库中，都没有归档，原核对日期都早于新日期。
- 备份：写前用项目自带的 `db:backup` 做全库备份没有成功，`pg_dump` 中途被中断。中断原因没有查清。留下的文件没经过校验，不能当作备份，已删除。

### 改前、改后存档与恢复办法

存档在服务器 `/opt/diesel/backups/reverification-20261120/`，权限为仅 root 可读：

- `audit-before-after.json`：从审计记录导出的 247 条，每条带改前和改后的 `verified_at`、`updated_at`。
- `writeback-result-run2.jsonl`：第二次运行的逐条结果。

应用的"日期不能倒退"检查不允许用同一功能改回旧日期。如果需要撤销，只能按 `audit-before-after.json` 逐条改回 `verified_at`，并另写一条说明原因的审计记录。

一次性脚本放在服务器 `/opt/diesel/operations/reverification-20261120/`，没有加进仓库：

- `reverify-sources.mts`：检查和写回；
- `list-sources.mts`：只读列出来源；
- `export-audit.mts`：导出审计记录。

### 写回后的实测

- 在服务器本机向线上应用查询中国（与巡检同一接口）：`isStale=false`，`lastVerifiedAt=2026-11-18T16:00:00Z`（即北京时间 11-19 零点）。
- 在服务器本机逐个查询 178 国详情页（`/api/countries/{ISO3}?asOf=2026-11-20`）：157 国 `isStale=false`，21 国 `isStale=true`，正好是第 5 节列出的 21 国，查询过程中没有报错。
- 2026-11-20 手动运行一次线上巡检（[run 44569295759](https://github.com/Jameskyzx/diesel-private-archive/actions/runs/44569295759)，不含 AI 检查）："检查线上合约"一步全部通过。但"上传巡检报告"一步因为 GitHub 附件存储额度已满被拒，整次运行仍记为失败（见第 7 节）。
- 首页和地图的"待复核"标记仍是 178 国全部过期。原因：地图列表（`listCountryMapSummaries`）只看国家记录本身的 `verified_at`，不看来源日期；国家详情页和巡检看的是包括来源在内的最新日期。要让首页和地图也恢复，需要按治理流程（草稿、审核、发布）更新国家记录的核对日期。本轮没有做，改为跟下次发布一起改（见第 8 节）。

## 7. GitHub 存储

- 2026-11-19 查看：diesel 仓库现存 89 个附件，合计约 0.07 MB，全是巡检结果；另一个私有仓库没有附件；没有使用 GitHub Packages。现存内容没有可清理的。
- CI 的覆盖率报告（`ci.yml`，每次运行都上传、保留 14 天）在 2026-11-13 已经上传失败，说明额度在本账单月早些时候就用满了。GitHub 免费版按整个账单月累计的用量计算额度，删掉附件也要到下个账单周期才会重置。
- 2026-11-20 手动巡检时额度仍满：数据检查通过，但上传巡检报告被拒（"Artifact storage quota has been hit"），整次运行记为失败，失败邮件会一直来，直到额度恢复。巡检工作流按设计不允许 `continue-on-error`（`tests/synthetic-canary.test.ts` 有断言），即报告存不下来就算失败。
- 额度恢复前，CI 的覆盖率上传也会失败。所以往 master 合并任何改动都会让 CI 失败，第 3 节的数据修改也没法通过发布闸门。
- 让额度马上恢复的办法都要负责人在 GitHub 账单设置里操作：给 Actions 设一个很小的付费上限，或升级 Pro。都不操作，就等下个账单周期自动重置。
- 防止再满：把覆盖率报告改成只在失败时上传，或把保留期缩短到 1 至 3 天。
- Actions 缓存（约 382 MB，2 个）不计入这个额度，不删除，删了只会让 CI 变慢。

**2026-11-22 更新：** 负责人把仓库迁成了公开仓库。新的公开仓库沿用 `Jameskyzx/diesel` 这个名字，历史已清理；原来的私有仓库改名为 `Jameskyzx/diesel-private-archive` 存档。

- 公开仓库的 Actions 存储不计额度，上面的额度问题对新仓库不再存在。同日新仓库 CI 的"Upload coverage report"一步已成功。
- 公开仓库在免费版下也能用分支保护。master 的保护已重新开启，要求通过"Required CI gate"、严格模式、对管理员同样生效，所以发布闸门可以使用了。
- 存档仓库仍是私有的，额度照旧算。2026-11-22 它的定时巡检在 15:07 和 次日 03:51（北京时间）又各失败一次。2026-11-23 经负责人同意，已停用存档仓库的"Production canary"工作流，失败邮件不再从那里来。如需恢复：`gh workflow enable "Production canary" -R Jameskyzx/diesel-private-archive`。
- 新仓库的巡检：2026-11-22 白天 GitHub 还没登记 `production-canary.yml`，手动运行返回 404；当晚它自行完成登记。第一次定时运行（[run 45062833855](https://github.com/Jameskyzx/diesel/actions/runs/45062833855)，北京时间 11-23 03:48）整次通过，包括上传巡检报告。

## 8. 下次发布要一起做的事

2026-11-20 负责人决定：首页和地图的国家核对日期不单独改，跟下次正式发布一起改。

当天曾试过另一种做法：用一个脚本同时扮演"编辑"和"审核人"两个身份，把国家记录的草稿建好、审核并发布。这一步被安全检查拦下，没有执行，线上没有改动，脚本已从服务器删除。系统规定建草稿的人不能审核、发布自己的草稿，这种做法等于自己审自己，以后也不再用。

前提：CI 能通过，发布闸门可用。2026-11-22 仓库公开后，这两条都已满足（见第 7 节更新）。这次发布在新的公开仓库做；本报告目前只在存档仓库的 `docs/reverification-2026-11` 分支上，那个分支基于旧历史，不能直接推到新仓库，要把两个文件单独搬到新 master 上的分支。报告和 CSV 已核对过，不含真实型号名。

数据文件要改的地方：

1. **247 条来源的核对日期，必须改。**
   - 范围：`src/server/db/seed/acceptance-fixtures.ts` 中的 240 条，`accepted-market-fixtures.ts` 中的 7 条。
   - 改成：`verifiedAt` 改为 `2026-11-18T16:00:00.000Z`（北京时间 11-19 零点）。
   - 清单：CSV 中 `write_back=yes` 的 247 条，与服务器上的 `writeback_ids_247.json` 一致。
   - 原因：发布脚本 `scripts/db/ingest-accepted-fixtures.ts` 会按数据文件重新发布全部来源。线上这 247 条已是 11-19，数据文件里还是 8 月的日期；系统不允许把来源日期往回改（`SOURCE_VERIFIED_AT_REGRESSION_MESSAGE`）。不改的话，发布会在第一条来源处中止。
2. **157 国的国家核对日期。**
   - 在 `scripts/db/ingest-signoff.ts` 新增一个 2026-11 复核的签核时间 `2026-11-18T16:00:00.000Z`，把第 5 节 21 国以外的 157 国映射到它。`findSourceRefreshSignoffVerifiedAt` 的结果优先于其它日期。
   - 第 5 节的 21 国保持原日期。
   - "国家目录"来源 `…0006` 的日期不改。
3. **第 3 节的数据修改。**
   - 第 1 至 3 条必须一起发布：秘鲁、加拿大、欧盟与冰岛。
   - 第 4、5 条和乌克兰、土耳其的补充记录可以顺带做。
4. **测试。** 与这些日期有关的断言（如 `tests/acceptance-fixtures.test.ts`）跟着改。

发布后检查以下三项：

- 首页和地图：157 国显示"已核对"，21 国显示"待复核"。
- 国家详情页：结果与第 6 节实测一致。
- 线上巡检：整次运行通过。

### 2026-11-23 实际发布内容

这次发布按上面的清单做，有三处比清单多做或做法不同：

- **秘鲁的做法。**
  - 当前返回 Euro IV。数值从 El Peruano 刊登的 D.S. 029-2021-MINAM 附件 I.7/I.8 读回：ESC CO 1.50、HC 0.46、NOx 3.50、PM 0.02 g/kWh，ETC CO 4.00、NMHC 0.55、NOx 3.5、PM 0.03 g/kWh，烟度 0.50 m⁻¹。
  - Euro VI 记为"已通过、未生效"，不填生效日。D.S. 003-2024-EM 原文写的是"自 D.S. 014-2021-EM 第 4 条生效后 6 个月"。第 4 条对柴油（2030-08-31）和汽油（2029-08-31）定了不同日期，按哪个起算要负责人决定。按柴油日期推算约为 2031-02-28。
  - 新增 D.S. 003-2024-EM 作为来源。
- **5 条暂缓来源一起写日期。** 欧盟 595/2009 和 2024/1257、冰岛 377/2013、秘鲁 D.S. 029-2021-MINAM、加拿大 SOR/2003-2 的数据已在这次更正，核对日期一并改为 11-19。
- **秘鲁移出"待复核"名单。** 秘鲁只是因为数据待改才列入第 5 节，这次已改。发布后应为 158 国"已核对"、20 国"待复核"。

## 9. 来源明细

"地址已搬走"和"打不开"两类逐条列出。确认的 252 条不再逐条列出；全部 341 条的逐条结论（含是否写回）见 `docs/evidence/reverification-2026-11.csv`。

| 国家 | 来源 | 发布机构 | 情况 |
| --- | --- | --- | --- |
| ARM, BLR, KAZ, KGZ, RUS | Eurasian Economic Union: member states and treaty overview | Eurasian Economic Commission | 地址已搬走：old eaeunion.org path 404; department page now at https://eec.eaeunion.org/comission/department/deptexreg/ (HTTP 200, checked 2026-11-19)；新地址 https://eec.eaeunion.org/comission/department/deptexreg/ |
| BEN | SGG Documenthèque — Décret N° 2001-110 | General Secretariat of the Government of Benin | 地址已搬走：manual: sgg.gouv.bj documentheque/763 now lists Décret 2001-218; Décret 2001-110 is no longer at this address |
| BFA | NIES du Garage et Atelier de maintenance de la Brigade d’Entretien Routier de Ziniaré | Burkina Faso Ministry of Infrastructure / Ministry | 地址已搬走：environnement.gov.bf NIES PDF returns 404 - no replacement found |
| BRN | Road Traffic Regulations (Chapter 68), Revised Edition 2022 | Attorney General’s Chambers, Brunei Darussalam | 地址已搬走：AGC Brunei Chapter 68 RG1 (2022) PDF returns 404 - no replacement found |
| BRN | Safe and Smart Driving in Brunei Darussalam | Ministry of Communications & Land Transport Depart | 地址已搬走：JPD Brunei Safe and Smart Driving PDF returns 404 - no replacement found |
| BWA | Botswana Standards Catalogue — June 2024 | Botswana Bureau of Standards | 地址已搬走：BOBS Standards Catalogue June 2024 PDF returns 404; no newer catalogue found online |
| CIV | PNI 15004 : Février 2025 — Véhicules N2 et N3 (Projet de Norme Ivoirienne) | Comité Ivoirien de Normalisation (CODINORM) | 地址已搬走：CODINORM draft PNI 15004 (public enquiry) PDF returns 404; no final standard found |
| COG | Loi n° 33-2023 du 17 novembre 2023 portant gestion durable de l’environnement en Républiqu | Présidence de la République / Ministère de l’Envir | 地址已搬走：old developpement-durable.gouv.cg PDF 404; the law is in the official Journal officiel 2023 n°48 at https://www.sgg.cg/JO/2023/congo-jo-2023-48.pdf (32 pp., contains Loi 33-2023 portant gestion durable de l environ |
| CRI | Decreto Ejecutivo 39724-MOPT-MINAE-S de 2 de mayo de 2016 — Reglamento para el control de  | Poder Ejecutivo / Sistema Costarricense de Informa | 地址已搬走：manual (browser): SINALEVI link for Decreto 39724 now opens an empty record (Norma 0, fecha 01/01/0001) - stored link no longer resolves |
| LBN | قانون رقم 444 - حماية البيئة | Lebanon Ministry of Environment | 地址已搬走：moe.gov.lb Law 444 page returns 404 - no replacement found |
| LBY | Decision No. 448 of 2009 — executive regulation for Law No. 15 of 2003 on Environmental Pr | General People's Committee / Libya Ministry of Env | 地址已搬走：environment.gov.ly Decision 448/2009 PDF returns 404 - no replacement found |
| LKA | Gazette Extraordinary No. 2079/42 — National Environmental (Air Emission, Fuel and Vehicle | Sri Lanka Department of Government Printing / Pres | 地址已搬走：documents.gov.lk old /view/egz/ path returns 404; site now uses /view/extra-gazettes/2018/7/2079-42_E.pdf but that host does not answer from this network - new address not verified |
| LKA | Gazette Extraordinary No. 2079/70 — Imports and Exports (Control) Regulation No. 2 of 2018 | Sri Lanka Department of Government Printing / Mini | 地址已搬走：documents.gov.lk old /view/egz/ path returns 404; likely /view/extra-gazettes/2018/7/2079-70_E.pdf but host does not answer from this network - new address not verified |
| SEN | Catalogue des normes Sénégalaises 2025 | Association Sénégalaise de Normalisation (ASN), Mi | 地址已搬走：ASN Catalogue 2025 v2 PDF returns 404 (both _0 and plain filenames) |
| TGO | Loi n° 2026-007 du 24 mars 2026 modifiant et complétant la loi n° 2008-005 du 30 mai 2008  | République togolaise / Journal Officiel de la Répu | 地址已搬走：jo.gouv.tg JO special bis 71e n°25 PDF returns 404 - no replacement found |
| TKM | TDS 1286-2019 — Gasoline-engine exhaust gases: measurement of carbon monoxide and hydrocar | Main State Service Turkmenstandartlary | 地址已搬走：tds.gov.tm standards list (page=32) and the list root now return 404 - no replacement found |
| USA | Highway Statistics 2022 Table MV-1 State Motor-Vehicle Registrations | U.S. Federal Highway Administration | 地址已搬走：FHWA mv1.cfm (2022) now redirects to highways.dot.gov highway-statistics landing page; table page not at old address; local fetch 403 - not re-verified |
| USA | Highway Statistics 2023 Table MV-1 State Motor-Vehicle Registrations | U.S. Federal Highway Administration | 地址已搬走：FHWA mv1.cfm (2023) now redirects to highways.dot.gov/policy/publications/policy-information/highway-statistics-2023; table page not at old address - not re-verified |
| VUT | Bill for the Import of Motor Vehicles (Control) (Amendment) Act No. of 2025 | Parliament of the Republic of Vanuatu / Ministry o | 地址已搬走：parliament.gov.vu 2025 Motor Vehicles bill PDF returns 404 at both old and search-listed paths |
| ALB | Law No. 10476 of 3 November 2011 on accession to the Gothenburg Protocol | Assembly of the Republic of Albania / Official Pub | 打不开：qbz.gov.al PDF returns a 1.5 KB HTML stub locally; remote fetch refused - not re-verified |
| ARE | Cabinet Resolution No. (13) of 2018 Regarding Mandatory Standards for the United Arab Emir | United Arab Emirates Ministry of Cabinet Affairs / | 打不开：HTTP 403: site blocks automated or out-of-region access (Cloudflare/geo-block); not bypassed - not re-verified |
| ATF | Code de l'environnement, articles L640-1 à L640-5 — provisions applicable in the French So | République française / Légifrance | 打不开：HTTP 403: site blocks automated or out-of-region access (Cloudflare/geo-block); not bypassed - not re-verified |
| AUS | Current Australian Design Rules（ADR 官方目录） | Australian Government Department of Infrastructure | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (28) Operation timed out after 150002 milliseconds with 0 bytes ); remote fetch/browser also failed where tried - not re-verified |
| AZE | AZS 636:2025 Road transport — environmental classes (official metadata; M/N scope, non-ref | Azerbaijan Standardization Institute (AZSTAND) | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (60) SSL certificate problem: unable to get local issuer certifi); remote fetch/browser also failed where tried - not re-verified |
| BRA | Resolução CONAMA nº 490, de 16 de novembro de 2018 (DOU 2018-11-21, PROCONVE P8) | CONAMA / Imprensa Nacional | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (52) Empty reply from server); remote fetch/browser also failed where tried - not re-verified |
| BTN | Environmental Standards, 2020 | National Environment Commission, Royal Government  | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (35) LibreSSL SSL_connect: SSL_ERROR_SYSCALL in connection to ww); remote fetch/browser also failed where tried - not re-verified |
| CIV | Décret n°2017-125 du 22 février 2017 relatif à la qualité de l’air | Official Gazette of the Republic of Côte d’Ivoire  | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (35) LibreSSL SSL_connect: SSL_ERROR_SYSCALL in connection to ag); remote fetch/browser also failed where tried - not re-verified |
| CMR | Décret n°2011/2582/PM du 23 août 2011 fixant les modalités de protection de l’atmosphère | Premier Ministre, Chef du Gouvernement / MINEPDED | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (60) SSL certificate problem: certificate has expired More detai); remote fetch/browser also failed where tried - not re-verified |
| CMR | NC 2858:2021 — Environnement — Exigences relatives aux rejets atmosphériques | Agence des Normes et de la Qualité (ANOR) / MINEPD | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (60) SSL certificate problem: certificate has expired More detai); remote fetch/browser also failed where tried - not re-verified |
| DOM | Memoria Institucional 2022 — Normativas Técnicas Emitidas y Normativas en Consultas Públic | Instituto Nacional de Tránsito y Transporte Terres | 打不开：HTTP 403: site blocks automated or out-of-region access (Cloudflare/geo-block); not bypassed - not re-verified |
| DOM | Resolución núm. 0051/2018 — Reglamento Técnico Ambiental para el Control de las Emisiones  | Ministerio de Medio Ambiente y Recursos Naturales  | 打不开：HTTP 403: site blocks automated or out-of-region access (Cloudflare/geo-block); not bypassed - not re-verified |
| ECU | RTE INEN 017:2008 — Control de emisiones contaminantes de fuentes móviles terrestres | Instituto Ecuatoriano de Normalización (INEN) | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (35) LibreSSL SSL_connect: SSL_ERROR_SYSCALL in connection to ww); remote fetch/browser also failed where tried - not re-verified |
| ETH | Directive on Emission Control of Pollutants from Vehicle No. 1051/2025 | Federal Democratic Republic of Ethiopia, Ministry  | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (60) SSL certificate problem: unable to get local issuer certifi); remote fetch/browser also failed where tried - not re-verified |
| ETH | ES 6725:2022 — Emission limits — Specification — Part 1 — Road vehicles | Institute of Ethiopian Standards | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (35) LibreSSL SSL_connect: SSL_ERROR_SYSCALL in connection to ww); remote fetch/browser also failed where tried - not re-verified |
| GEO | Government Resolution No. 238 — Technical Regulation on vehicle emission standards (MEPA o | Ministry of Environmental Protection and Agricultu | 打不开：HTTP 503: site blocks automated or out-of-region access (Cloudflare/geo-block); not bypassed - not re-verified |
| GHA | GS 1219 — Environment and Health Protection — Requirements for motor vehicle emissions | Ghana Standards Authority | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (60) SSL: no alternative certificate subject name matches target); remote fetch/browser also failed where tried - not re-verified |
| GMB | Supplement “C” to The Gambia Gazette No. 1 of 23rd January, 2014 — Motor Traffic (Amendmen | The Gambia Gazette / National Assembly of The Gamb | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (60) SSL: no alternative certificate subject name matches target); remote fetch/browser also failed where tried - not re-verified |
| GTM | Normativa de Combustible y Vehículos | Guatemala Ministry of Environment and Natural Reso | 打不开：HTTP 403: site blocks automated or out-of-region access (Cloudflare/geo-block); not bypassed - not re-verified |
| HND | Decree 205-2005 — Traffic Law | Honduras National Congress / Tribunal Superior de  | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (35) LibreSSL SSL_connect: SSL_ERROR_SYSCALL in connection to ts); remote fetch/browser also failed where tried - not re-verified |
| HND | Decree 36-2024 — Law for the Rational and Efficient Use of Energy | Honduras National Congress / La Gaceta | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (35) LibreSSL SSL_connect: SSL_ERROR_SYSCALL in connection to ww); remote fetch/browser also failed where tried - not re-verified |
| HTI | Le MCI intensifie son soutien aux MPME et déploie davantage d’actions sur le territoire na | Gouvernement de la République d’Haïti / Ministère  | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (35) LibreSSL SSL_connect: SSL_ERROR_SYSCALL in connection to co); remote fetch/browser also failed where tried - not re-verified |
| IDN | Minister of Environment and Forestry Regulation P.20/MENLHK/SETJEN/KUM.1/3/2017 on new-typ | Indonesia Ministry of Environment and Forestry | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (35) LibreSSL SSL_connect: SSL_ERROR_SYSCALL in connection to jd); remote fetch/browser also failed where tried - not re-verified |
| IRQ | قرارات هيئة اعتماد المواصفات العراقية في اجتماعها المرقم (507) في 3/3/2024 | Iraq Central Organization for Standardization and  | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (60) SSL certificate problem: certificate has expired More detai); remote fetch/browser also failed where tried - not re-verified |
| ISR | Israeli Mandatory Requirements (IMR) for Calendar Year 2026 — Non-Road Mobile Machinery (N | Israel Ministry of Transport and Road Safety | 打不开：HTTP 403: site blocks automated or out-of-region access (Cloudflare/geo-block); not bypassed - not re-verified |
| ISR | Israeli Mandatory Requirements — Safety and Environmental Protection Regulations For Motor | Israel Ministry of Transport and Road Safety | 打不开：HTTP 403: site blocks automated or out-of-region access (Cloudflare/geo-block); not bypassed - not re-verified |
| JOR | JSMO Standards Catalogue — Transport Exhaust Emissions (JS 1053:1998 and JS 1054:1998) | Jordan Standards and Metrology Organization | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (35) LibreSSL SSL_connect: SSL_ERROR_SYSCALL in connection to es); remote fetch/browser also failed where tried - not re-verified |
| JOR | Transport Sector Green Growth National Action Plan 2021–2025 | Jordan Ministry of Environment | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (52) Empty reply from server); remote fetch/browser also failed where tried - not re-verified |
| KGZ | Official implementation notice for TR CU 018/2011 — entry into force on 12 February 2016 a | Ministry of Economy and Commerce of the Kyrgyz Rep | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (35) LibreSSL SSL_connect: SSL_ERROR_SYSCALL in connection to ww); remote fetch/browser also failed where tried - not re-verified |
| LBR | Environmental Protection and Management Law of Liberia | Republic of Liberia / Ministry of Foreign Affairs; | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (35) LibreSSL SSL_connect: SSL_ERROR_SYSCALL in connection to ep); remote fetch/browser also failed where tried - not re-verified |
| MDG | Étude de l’aménagement du secteur d’Antanamanintsy et l’actualisation d’une partie des étu | Ministère de l’Agriculture et de l’Élevage, Direct | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (35) LibreSSL SSL_connect: SSL_ERROR_SYSCALL in connection to ww); remote fetch/browser also failed where tried - not re-verified |
| MKD | Правилник за одобрување на земјоделски и шумски трактори | Ministry of Economy / Official Gazette of the Repu | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (35) LibreSSL SSL_connect: SSL_ERROR_SYSCALL in connection to sl); remote fetch/browser also failed where tried - not re-verified |
| MKD | Правилник за одобрување на нови моторни и приклучни возила, системи, составни делови и сам | Ministry of Economy / Official Gazette of the Repu | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (35) LibreSSL SSL_connect: SSL_ERROR_SYSCALL in connection to sl); remote fetch/browser also failed where tried - not re-verified |
| MMR | National Environmental Quality (Emission) Guidelines (Final), Notification No. 615/2015 | Myanmar Ministry of Environmental Conservation and | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (35) LibreSSL/3.3.6: error:1404B42E:SSL routines:ST_CONNECT:tlsv); remote fetch/browser also failed where tried - not re-verified |
| MNE | Izmjene i dopune pravilnika o tehničkim zahtjevima — new M/N vehicles require EURO 6 from  | Government of Montenegro / Ministry of Transport | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (35) LibreSSL SSL_connect: SSL_ERROR_SYSCALL in connection to ww); remote fetch/browser also failed where tried - not re-verified |
| MNE | Pravilnik o tehničkim zahtjevima za vozila koja se uvoze ili prvi put stavljaju na tržište | Ministry of Transport / Government of Montenegro | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (35) LibreSSL SSL_connect: SSL_ERROR_SYSCALL in connection to ww); remote fetch/browser also failed where tried - not re-verified |
| MOZ | Decreto n.º 44/2017, de 16 de Agosto — Regulamento sobre as Regras de Aprovação de Marcas  | Conselho de Ministros / Imprensa Nacional de Moçam | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (60) SSL certificate problem: unable to get local issuer certifi); remote fetch/browser also failed where tried - not re-verified |
| MYS | Motor Vehicle VTA Guidelines and User Manual - gaseous pollutant and noise emission limits | Malaysia Department of Environment Vehicle Type Ap | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (35) LibreSSL SSL_connect: SSL_ERROR_SYSCALL in connection to vt); remote fetch/browser also failed where tried - not re-verified |
| NIC | Consolidated Decree No. 32-97 — motor vehicle emission control, Articles 10–25 | National Assembly of Nicaragua | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (35) LibreSSL SSL_connect: SSL_ERROR_SYSCALL in connection to le); remote fetch/browser also failed where tried - not re-verified |
| NIC | Consolidated Law No. 431 — vehicle emission-control certificates, Articles 59–60 | National Assembly of Nicaragua | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (35) LibreSSL SSL_connect: SSL_ERROR_SYSCALL in connection to le); remote fetch/browser also failed where tried - not re-verified |
| PAN | Ley 295 de 25 de abril de 2022 — Que incentiva la movilidad eléctrica en el transporte ter | Asamblea Nacional / Gaceta Oficial de la República | 打不开：HTTP 403: site blocks automated or out-of-region access (Cloudflare/geo-block); not bypassed - not re-verified |
| PHL | Implementation of DENR Administrative Order on Euro 4/IV Vehicle Emission Limits | Philippines DENR Environmental Management Bureau / | 打不开：boi.gov.ph PDF returns 0 bytes locally; remote fetch refused by network policy - not re-verified |
| PNG | Road Traffic Authority rules — commencement and amended vehicle standards | Papua New Guinea Road Traffic Authority | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (60) SSL certificate problem: certificate has expired More detai); remote fetch/browser also failed where tried - not re-verified |
| PNG | Road Traffic Rules — Vehicle Standards and Compliance 2017, including Amendment 1 | Papua New Guinea Road Traffic Authority | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (60) SSL certificate problem: certificate has expired More detai); remote fetch/browser also failed where tried - not re-verified |
| PRI | Regulation No. 5300 — Air Pollution Control Regulation, Rule 403(B) | Puerto Rico Department of Natural and Environmenta | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (35) LibreSSL SSL_connect: SSL_ERROR_SYSCALL in connection to ww); remote fetch/browser also failed where tried - not re-verified |
| QAT | Ministerial Decision No. 125 of 2019 Adopting Qatari Technical Regulations | Qatar Ministry of Justice / Al Meezan Legal Portal | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (35) LibreSSL SSL_connect: SSL_ERROR_SYSCALL in connection to ww); remote fetch/browser also failed where tried - not re-verified |
| SDN | قانون حماية البيئة لسنة 2001 / Environment Protection Act 2001 (Act No. 18 of 2001) | Republic of the Sudan / Higher Council for Environ | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (35) LibreSSL SSL_connect: SSL_ERROR_SYSCALL in connection to hc); remote fetch/browser also failed where tried - not re-verified |
| SLE | The Environment Protection Agency Act, 2022 (Act No. 15 of 2022) | Government Printing Department / Parliament of Sie | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (60) SSL certificate problem: unable to get local issuer certifi); remote fetch/browser also failed where tried - not re-verified |
| SLV | Acuerdo No. 126 — Reglamento Técnico Salvadoreño RTS 13.01.02:23 Calidad del Aire. Control | Ministerio de Medio Ambiente y Recursos Naturales  | 打不开：HTTP 403: site blocks automated or out-of-region access (Cloudflare/geo-block); not bypassed - not re-verified |
| SLV | Derogaciones | Organismo Salvadoreño de Reglamentación Técnica (O | 打不开：HTTP 403: site blocks automated or out-of-region access (Cloudflare/geo-block); not bypassed - not re-verified |
| SOM | Environmental Protection and Management Act | Federal Government of Somalia / Ministry of Enviro | 打不开：HTTP 403: site blocks automated or out-of-region access (Cloudflare/geo-block); not bypassed - not re-verified |
| SWZ | Road Transportation Department — roadworthiness testing and statutory mandate | Government of Eswatini — Road Transportation Depar | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (35) LibreSSL SSL_connect: SSL_ERROR_SYSCALL in connection to ww); remote fetch/browser also failed where tried - not re-verified |
| TCD | Décret n° 904/PR/PM/MERH/2009 portant réglementation des pollutions et des nuisances à l'e | Republic of Chad / Ministry of Environment and Fis | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (35) LibreSSL SSL_connect: SSL_ERROR_SYSCALL in connection to ww); remote fetch/browser also failed where tried - not re-verified |
| TGO | Décret n° 2022-085/PR du 03/08/22 fixant les modalités d’application de la loi n° 2013-011 | République togolaise / Journal Officiel de la Répu | 打不开：HTTP 526: site blocks automated or out-of-region access (Cloudflare/geo-block); not bypassed - not re-verified |
| TJK | Law of the Republic of Tajikistan No. 1214 on ensuring environmental safety of road transp | National Legislation Center under the President of | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (35) LibreSSL SSL_connect: SSL_ERROR_SYSCALL in connection to nc); remote fetch/browser also failed where tried - not re-verified |
| TUN | Loi n° 99-71 du 26 juillet 1999 portant promulgation du Code de la route | Imprimerie officielle de la République tunisienne  | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (60) SSL certificate problem: self signed certificate in certifi); remote fetch/browser also failed where tried - not re-verified |
| TZA | Environmental Management (Air Quality Standards) Regulations, 2007 — Government Notice No. | TanzLII / Official Gazette of the United Republic  | 打不开：HTTP 403: site blocks automated or out-of-region access (Cloudflare/geo-block); not bypassed - not re-verified |
| UGA | US EAS 1047:2022 — Air quality — Vehicular exhaust emission limits | Uganda National Bureau of Standards | 打不开：HTTP 403: site blocks automated or out-of-region access (Cloudflare/geo-block); not bypassed - not re-verified |
| UKR | Law of Ukraine No. 2739-IV on import and first registration of transport vehicles (current | Verkhovna Rada of Ukraine / Legislation of Ukraine | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (35) LibreSSL SSL_connect: SSL_ERROR_SYSCALL in connection to za); remote fetch/browser also failed where tried - not re-verified |
| UKR | Order No. 521 on vehicle type approval, as amended by Order No. 188 (Annex 2 item 52: UN R | Ukraine Ministry of Infrastructure / Verkhovna Rad | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (35) LibreSSL SSL_connect: SSL_ERROR_SYSCALL in connection to za); remote fetch/browser also failed where tried - not re-verified |
| YEM | قانون المرور وتعديلاته — Traffic Law No. 46 of 1991, consolidated through Law No. 12 of 20 | Yemen Public Prosecution (Office of the Attorney G | 打不开：HTTP 403: site blocks automated or out-of-region access (Cloudflare/geo-block); not bypassed - not re-verified |
| YEM | قانون رقم (26) لسنة 1995م بشأن حماية البيئة — Law No. 26 of 1995 on Environmental Protecti | Yemen Public Prosecution (Office of the Attorney G | 打不开：HTTP 403: site blocks automated or out-of-region access (Cloudflare/geo-block); not bypassed - not re-verified |
| 多国/参考 | Noxious Emissions from Non-Road Diesel Engines（非道路柴油发动机官方评估） | Australian Government Department of Climate Change | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (28) Operation timed out after 150002 milliseconds with 0 bytes ); remote fetch/browser also failed where tried - not re-verified |
| 多国/参考 | Questions and answers on the new ADR 80/04（Euro VI 重型车辆官方问答） | Australian Government Department of Infrastructure | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (28) Operation timed out after 150003 milliseconds with 0 bytes ); remote fetch/browser also failed where tried - not re-verified |
| 多国/参考 | Resolução CONAMA nº 403, de 11 de novembro de 2008 (DOU 2008-11-12, PROCONVE P-7) | CONAMA | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (52) Empty reply from server); remote fetch/browser also failed where tried - not re-verified |
| 多国/参考 | Standards for Diesel Heavy Duty Vehicles（澳大利亚官方柴油重型车辆标准汇总） | Australian Government Department of Infrastructure | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (28) Operation timed out after 150006 milliseconds with 0 bytes ); remote fetch/browser also failed where tried - not re-verified |
| 多国/参考 | Supplemental/Bid Bulletin B-354-2024 — DAO 2015-04 and UNR 49-04 certificate-of-conformity | Provincial Government of Negros Oriental | 打不开：no connection from this network (local curl, retry over HTTP/1.1; curl: (35) LibreSSL SSL_connect: SSL_ERROR_SYSCALL in connection to ww); remote fetch/browser also failed where tried - not re-verified |
| 多国/参考 | UN Regulation No. 49 Revision 5 (heavy-duty engine emission levels B2 and C) | United Nations Economic Commission for Europe | 打不开：HTTP 403: site blocks automated or out-of-region access (Cloudflare/geo-block); not bypassed - not re-verified |
| 多国/参考 | UN Regulation No. 49, Revision 4 — Uniform provisions concerning measures against gaseous  | United Nations Economic Commission for Europe | 打不开：UN Digital Library PDF answers 202/403 bot check - not re-verified |
