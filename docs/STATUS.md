# Project status / 当前项目状态

This is the only current release/evidence index. Historical implementation notes are retained in
[the frozen journal](STATUS-HISTORY-2026-10-04.md); their “pending” labels are historical, not current work items.
本文件只保留当前状态、验收入口和未解决事项。历史过程不再混入当前清单。

## Release status / 发布状态

- 2026-10-04 的失败尝试留档：PR #55 / `cf86edca3a33e087d4e5b88b54171b7010f5bb41` 已合并，但部署失败并回滚。
  SSH 返回 255；原远端退出码未知，未完成治理快照和发布，不能称部署成功。
  失败候选为终态 `ROLLED_BACK:none`；只能用新的 CI-approved SHA 发布，禁止重用失败候选。
  [完整脱敏失败记录](evidence/operations/deployment-failure-2026-10-04.json)。
- 收尾代码包含独立 admission 连接池、真实示例端到端验收、付费 AI 定时巡检，以及健康快照 reader 复用。
  代码存在不等于线上验收通过；生产执行结果另见[本轮操作记录](evidence/operations/production-closeout-latest.json)，
  完整本地证据以本文唯一台账为准。
- 生产聊天故障已复现为数据库入口超过 3 秒，而非模型报错。只读对照诊断支持冷连接/类型发现开销这一原因；
  修复必须通过新版本真实请求验收，不能以单次健康 200 或单元测试替代。
- 2026-10-04 用户批准仅将聊天小时准入等待从 3 秒改为 8 秒；配额、并发门、数据库超时与失败关闭不变。
  这是等待时间合同的调整，不是数据库提速；新版本的冷连接首次请求仍须真实验收，旧版三次 503 不被覆盖。
- VPS 已仅清理 14 个非活动版本的可重建缓存，全部备份与运行文件保留。
  [清理记录](evidence/operations/cache-cleanup-2026-10-04.json)。

以下为带时间的历史生产观测，不声明仓库当前 HEAD 等于线上版本：

- 公开只读演示：<https://diesel.jamesky.site>。只读核验中，
  observedAt=`2026-10-14T10:37+00:00`；`/api/health` readbackAt=`2026-10-14T10:37+00:00` returned `status=ok`,
  `version=34571465f0c8ecd1f682bbc327808a95ad9bd99d`；服务器当前 release 链接解析为
  `/opt/diesel/releases/34571465f0c8ecd1f682bbc327808a95ad9bd99d`。因此当前公开 release ID
  与 Git commit 均为该完整 SHA；同时观测的本地 `master` 和只读
  `git ls-remote origin master` 也均为该 SHA。这是带时间的只读快照，CI 中的
  `portfolio:verify` 只校验已记录对象和等值关系，不联网声称其仍然最新。该记录的证据类型固定为
  `historical-operator-record-only`；它不是外部签名的生产读回，也不能由本地校验器证明来源真实性。
  2026-10-05 的上一轮仅验收用户选择的三项：发布/恢复终态、新版本真实中英对话、严格数据库 TLS。
  该轮原发布仍记录 exit 75；正式前滚验收成功后独立确认 `COMMITTED:PUBLISH_FINALIZED`。
  该轮新进程首次真实聊天、随后六个中英示例、TLS 正负对照和 provider canary 均通过；临时转发已撤销。
  [上一轮完整记录](evidence/operations/production-closeout-latest.json) 保留所有失败，不宣称长期稳定性或所有工程维护已完成。
  2026-10-06 的新候选 `361dabc48216103fd7f37cd02be18499c3138935` 已通过 master CI，但在隔离构建中因 VPS 缺少 pnpm shim 失败，
  原始 exit 70 与 `ROLLED_BACK:none` 保留；`2026-10-06T13:00:47.733Z` 独立健康读回仍为上述旧版 `30daa51`。
  现有官方 Corepack 的 pnpm 入口已补齐，构建用户的固定版本 registry 查询通过；这不是新版本上线声明。
  [失败及主机修复记录](evidence/operations/deployment-failure-and-pnpm-recovery-2026-10-06.json)。后续只能以新的 CI-approved SHA 走完整发布，不重用失败候选。
  同日后续候选 `5f1d6a73719dcc3179b9b24279bf4959f0a3a58f` 的 master CI 也全部通过，但必需 Next 包的官方 registry 下载超时，
  原始 exit 70 与第二个 `ROLLED_BACK:none` 保留；`2026-10-06T15:04:41.132Z` 独立健康读回仍为旧版 `30daa51`。
  [第二次失败与有界传输探针](evidence/operations/deployment-network-failure-2026-10-06.json)。该失败时的小文件探针不证明完整构建成功。
  后续 `0f51a9dfd14f874d3dfa5713d172fb3462d48874` 的精确 master CI 10/10 通过，完整发布于 `2026-10-06T21:34:17.537Z` 以 exit 0 完成；
  独立严格账本与 committed-host 校验确认 `COMMITTED:PUBLISH_FINALIZED`。本次包含既有 97 国闭包的受控重新发布，未增加国家、schema 或真实产品。
  新备份与真实恢复演练、loopback/public 中英页面及 SSE、7/7 provider-inclusive canary、零重试的中英桌面/移动端 6/6 真实示例均通过。
  实际浏览器另确认国家替换保留原日期/场景/功率、刷新恢复、语言持久化、市场单位/观测期/相关来源，以及首页 `97/28/651/203/0` 与 `178` 目录分离。
  原 SSH observer 的 exit 255 原样保留；已有 durable worker 未重启，独立终态读回与验收才证明发布成功，不宣称首次冷请求或长期稳定性。
  实测余量约 4.35 GiB，低于下一次完整发布的 5 GiB 起始门槛；所有备份、失败版本与归档均保留，未使用临时数据库转发，`jamesky-api` 原 PID 未变。
  一次额外模型解释出现摘要与后文不一致，结构化事实卡片正确；该解释质量问题未在本次部署中修复，不宣称模型文本永不出错。
  [本次上线与独立验收完整记录](evidence/operations/production-ux-release-2026-10-06.json) 保留上述通过、失败与残余边界。
  2026-10-09 的 PR #77 已合并，候选 `bf9af3de97e2e3be827dc55ec34f0416924d5c0a` 的精确 master CI 为 10/10 通过，
  但完整发布在治理备份/恢复验证阶段中断，durable worker 以 exit 70 结束；不能声明保存分析、独立比较页及证据审阅改进已上线。
  数据与主机已自动回滚，独立严格账本和回滚校验均通过，终态为 `ROLLED_BACK:HOST_ROLLBACK_COMPLETED`。
  `2026-10-09T18:45:40.586Z` 公网 readiness 及服务器 current 仍为 `0f51a9dfd14f874d3dfa5713d172fb3462d48874`；
  回滚后内网/公网中英页面、Demo 产品边界及确定性 SSE 验收均通过，不代表本次重新验证了模型生成路径。
  当前只读连接对照正常，现有日志未记录具体中断分支；没有证据将此次失败确定归因于网络或内存。
  失败候选、日志与备份保留；只能在阻塞处理后用新的 CI-approved SHA 发布。
  [本次部署失败及回滚验收记录](evidence/operations/deployment-maintenance-failure-2026-10-09.json)。
  2026-10-10 的修复 PR #78 已合并；新候选 `1a74dd5be5564a58ef4e59fb5856ecb84c66eebd` 的精确 master CI 为 10/10 通过，
  不可变 staging 成功，完整发布已于 `2026-10-10T04:50:10.966Z` 单次启动，继续使用 VPS 原数据库链路，没有建立转发。
  截至 `2026-10-10T05:03:42Z`，观察连接自 `04:56:59Z` 后未更新，公网 HTTPS 握手与未登录 SSH 欢迎信息均超时；
  原因及 worker 当前状态均未确认，尚未取得完成回执或独立终态验收，不得声明上线成功或已经回滚。
  该观察时点未重启主机、未重复部署、未删除备份。
  随后在京东云控制台核对同一 IP；用户明确授权后执行一次重启，`2026-10-10T05:24:20.711Z` SSH 读回确认新 boot，
  Nginx/PM2 active，`diesel-demo` 与 `jamesky-api` 均 online、重启计数为 0，服务器 current 仍为旧稳定版 `0f51a9d`。
  `05:25:23.213Z` 公网 readiness 返回 HTTP 200，数据库及两项 AI 准入探针均为 ok；这是旧版恢复检查，不是新版发布验收。
  新候选的严格账本为 `active:PENDING:none`，worker unit 已不存在且缺少完成回执；发布中断、尚待按协议收敛，未重复启动或伪造终态。
  随后版本化回滚预检及 `--abort-if-uncommitted` 均 exit 0；`2026-10-10T05:41:37.637Z` 独立严格账本确认 `terminal:ROLLED_BACK:none`。
  旧版恢复验收通过，`jamesky-api` PID 仍为 1033；中断构建未进入数据库发布，候选、日志与备份保留，不重用该 SHA。
  [本次发布观察中断记录](evidence/operations/deployment-observation-interruption-2026-10-10.json) 保留候选、任务 ID、CI 与连接诊断。
  随后 PR #79 / `6e8368abaacc998ea775bc71d43bf4efb8ca2d8c` 的精确 master CI 10/10 通过，限额构建成功，
  但数据库备份首个 worker 在有进度时触及 45 分钟上限，第二个 worker 以 exit 1 退出且旧诊断未保留具体错误。
  完整发布于 `2026-10-10T09:30:37.523Z` 以 exit 70 结束，没有进入数据库发布；独立严格账本为 `terminal:ROLLED_BACK:none`。
  `09:32:20.039Z` 旧版公网 readiness、回滚检查及内外网验收通过，`jamesky-api` PID 1033 未变。
  [备份失败与回滚记录](evidence/operations/deployment-snapshot-failure-2026-10-10.json) 保留真实失败；不能声明新版功能已上线，也不重用失败 SHA。
  后续 PR #80 / `7766eefaed3447d5dc01584b2c72d83a8d6d7bd7` 的精确 master CI 10/10 通过；完整发布于
  `2026-10-10T16:10:49.803Z` 以 exit 0 完成，独立严格账本与 committed-host 校验确认 `COMMITTED:PUBLISH_FINALIZED`。
  两次快照读取分别耗时约 39 与 80 分钟；真实恢复演练、十表对照和既有 97 国逐项发布通过。使用 VPS 原链路，未建立转发。
  原发布保留一次 `CONNECTION_CLOSED` reader 恢复及一次 HTTP 503 重试；后续独立内外网页面/SSE 校验均 exit 0，不能将原过程称为零错误。
  provider-inclusive canary 7/7、中英桌面/移动端六个真实聊天示例 6/6 均通过；六个浏览器示例零失败、零重试。
  比较页、条件分享/刷新/语言保持、本地保存及确认删除、JSON/HTML 导出、真实聊天保存导出均通过生产浏览器验收。
  临时脚本曾误把 Demo 的泛非道路数值预期用于生产，该失败保留；按既有合同验证泛非道路缺口与工程机械正例后通过，未改网站数据或放宽证据边界。
  本次因此确认 PR #77 的比较、保存分析和证据审阅改进已上线；未增加 schema、国家或真实产品。`jamesky-api` PID 1033 与重启计数 0 未变。
  独立观测磁盘可用 18,101,645,312 bytes（约 16.9 GiB），备份保留；后续仅记录文档，不把文档提交误称为新生产版本。
  [本次发布与独立验收完整记录](evidence/operations/production-analysis-release-2026-10-10.json) 保留全部结果与边界，不宣称长期稳定性或模型解释永不出错。
  2026-10-11 的 PR #81/#82 已合并，新候选 `bbc1e7334e951a3cd8db6da63077f4c36918d18a` 的精确 master CI 为 10/10 通过。
  自动分类选择 application-only，直接导入同一 CI 运行的 Linux 成品包；未重跑数据库导出、恢复或数据发布。
  持久化任务于 `2026-10-11T10:08:10.334Z` 以 exit 0 完成，服务器执行约 19 分钟；15 表前后摘要一致，既有 97 辖区公开读回通过。
  独立严格账本、committed-host 和内外网页面/SSE 验证通过，`jamesky-api` PID 1033 与重启计数 0 未变。
  真实浏览器验收为 1 通过、1 失败、4 未运行：中文比较正文、工具证据与引用完整，但最终 SSE 仍返回 `finishReason=tool-calls`，而非 `stop`。
  因此本轮仅确认版本已部署，不能声明聊天验收全部通过；该收尾协议问题需要独立修补版本，原失败和验收标准保留。
  当次 origin/master 只读核验使用命令级 HTTPS 映射到同一仓库，保存的 origin SSH 地址未改变。
  [应用发布与未完成验收记录](evidence/operations/production-application-release-2026-10-11.json) 保留 CI 取消/失败、连接失败及真实浏览器失败。
  随后 PR #83 修复了有证据的确定性比较/市场回答的最终 SSE 完成状态；保留模型步骤的原始结束原因、异常与原验收标准。
  修补版本 `41e1fddbfe2e1dd339c0d9420061ac3b6dd5e1b6` 的精确 master CI 10/10 通过；application-only 发布于
  `2026-10-11T12:51:36.496Z` 以 exit 0 完成，服务器执行 20 分 53 秒，不包含 CI、传输和独立验收耗时。
  直接使用该次 Linux CI 成品包，未在 VPS 安装依赖/重新编译，也未重做数据库导出、恢复或治理发布；15 表前后摘要一致。
  独立严格账本与 committed-host 校验确认 `COMMITTED:APPLICATION_VERIFIED_V2`，内外网页面/SSE 验证均通过。
  中英桌面/手机端六个真实聊天示例 6/6、零失败/零重试；provider-inclusive canary 7/7；比较、条件保持、语言切换、
  本地保存、JSON/HTML 导出、真实聊天保存导出及仅删除本次浏览器测试记录均通过。原版本的 1 通过/1 失败/4 未运行记录没有改写。
  `jamesky-api` PID 1033 / 重启计数 0 未变；磁盘可用 15,235,153,920 bytes（约 14.2 GiB），没有删除备份或建立数据库转发。
  [修补发布与独立验收记录](evidence/operations/production-chat-completion-release-2026-10-11.json) 记录真实结果与边界；后续文档提交不是新生产版本。
  2026-10-12 的对话分层重构 PR #84 已合并，候选 `50784f96bb49506edc551963f6ef39fd15bfb436` 的精确 master CI 为 10/10 通过。
  源码与同次 CI Linux 成品包均通过暂存验证，自动选择 application-only；没有重做全库导出、恢复或数据发布。
  单次 durable worker 于 `2026-10-12T12:32:10.178Z` 开始，`12:41:47.780Z` 以 exit 70 结束；维护锁心跳达到原有 30 秒探测超时，出现 readiness 503。
  未完成 application-after 验证，不能声称 15 表前后对照通过或新对话已上线；具体网络/主机资源根因尚未证明。
  自动主机回滚的 readiness 校验未完成，最初保留 `PENDING:none`；随后受控 `--abort-if-uncommitted` exit 0，独立严格账本确认 `terminal:ROLLED_BACK:none`。
  修复回滚期间保留两次 HTTP 503 重试；`2026-10-12T13:00:31.787Z` 公网 readiness 为 HTTP 200，数据库与两项 AI 准入均 ok，版本及 current 仍为旧稳定版 `41e1fdd`。
  `jamesky-api` PID 1033、重启计数 0 未变。原数据库链路的同一维护锁两分钟只读复验 exit 0；这是短时观察，不是完整发布或长期稳定性证明。
  失败候选、日志与备份保留，未建立临时转发、未放宽门槛或重复提交该 SHA；新协议的生产多轮实测尚未执行，后续只能使用新的 CI-approved SHA。
  [本次真实失败与回滚记录](evidence/operations/deployment-conversation-failure-2026-10-12.json) 保留任务/CI 身份、日志摘要、失败与恢复边界。
  重试记录 PR #89 的首次 CI 另有两条 PGlite 冷启动用例达到 5 秒时限；原失败保留。仅将这两处 WASM/迁移/fixture 初始化移入单独的 beforeAll 准备阶段，
  用例断言与原执行时限、生产代码及维护锁门槛均不变；22/22 聚焦测试通过，完整执行证据已按实际运行更新。
  PR #89 最终 CI 与合并提交 `02db43a27d6f71ecfa4e46ea358f28a9fc336143` 的精确 master CI 均为 10/10 通过；源码与该次 CI 运行包独立暂存通过。
  第二次单次 application-only worker 于 `2026-10-12T15:26:42.942Z` 开始、`15:33:10.966Z` 以 exit 70 结束；运行包准备成功，失败发生在维护锁所有权校验。
  该校验器未记录底层错误码，不能将此次失败归因于事务连接池、网络或主机资源；也不能声称发布前后 15 表验证完成。
  自动回滚完成，独立严格账本为 `terminal:ROLLED_BACK:none`；`2026-10-12T15:34:06.348Z` 公网健康 HTTP 200，current 与版本仍为 `41e1fdd`，`jamesky-api` PID 1033 / 重启 0 未变。
  原链路的五次新子连接所有权校验全部通过（原 5 秒连接时限、30 秒心跳门槛）；只读预演两次完整 15 表指纹一致，前后授权校验通过，23,407 ms / exit 0。
  两份辅助诊断脚本的模块加载与 SET 参数写法错误均保留；修正后的短时预演不是部署完成或长期稳定性证据。未修改连接地址、数据、门槛或应用代码。
  第二次失败 SHA 不会重新激活；后续重试仍须使用新的 CI-approved SHA。新版生产多轮验收尚未执行，失败候选、日志与全部备份保留。
  随后 PR #90 / `6c62e9793501b18754089558275ee4a6f23cc0c2` 的精确 master CI 10/10 通过，新的单次 application-only 发布于
  `2026-10-12T18:05:36.736Z` 以 exit 0 完成，服务器执行约 16 分 36 秒；直接使用该次 CI Linux 成品包，未重新导出、恢复或发布数据库。
  独立严格账本与 committed-host 校验确认 `terminal:COMMITTED:APPLICATION_VERIFIED_V2`，15 表前后摘要一致，内外网页面/SSE 校验通过，provider-inclusive canary 7/7。
  上线后实际进行了两个连续会话的 20 次请求（浏览器中文 13 轮、真实 HTTPS 新协议英文 7 轮），没有 mock、离线 Demo 或自动重试；不声明 20/20 功能通过。
  条件继承、国家/功率替换、刷新后继续解释、英文邮件改写和历史市场数据边界正常；另复现一次明确法规请求理解失败、来源筛选回退旧 JPN/检索词污染、长会话保存警告，
  以及缺少真实产品证据时误挡中性材料清单/邮件。英文 API 7/7 仅为传输及 DTO 合同通过，不能代替语义验收；旧 v26 live eval 仍是兼容路径证据，不覆盖新规划器。
  `jamesky-api` PID 1033 / 重启计数 0 未变，两项服务 online；磁盘可用 11,215,872,000 bytes（约 10.4 GiB），备份和失败版本保留，没有建立数据库转发。
  [本次上线与真实多轮验收记录](evidence/operations/production-conversation-release-2026-10-12.json) 保留真实失败与未解决项；后续记录提交不再次部署，不宣称长期稳定性。
  2026-10-13 的 PR #92 / `0421d347a64832d85d54b25b34e5d1a35303d3dc` 精确 master CI 10/10 通过，单次 application-only 发布于
  `2026-10-13T10:32:28.703Z` 以 exit 0 完成（服务器约 21 分钟）；独立终态为 `COMMITTED:APPLICATION_VERIFIED_V2`，15 表前后指纹一致，内外网验收及 provider-inclusive canary 7/7 通过。
  六个真实中英示例为 3 通过 / 1 失败 / 2 未运行；英文当前法规示例被规划校验误拒绝。另做真实 HTTPS 中文 6 轮、浏览器英文 14 轮，语义分别为 4/6 和 10/14，通过 SSE 不冒充语义通过。
  源码里的条件清空、来源词隔离、一般解释、中性邮件/清单及长会话刷新恢复已实测生效；新增比较国家与长型号仍有误拒绝，因此本版对话验收未完成。
  同样的真实模型规划输出复现了无关 sourceTerms 错误校验；`model/型号 CLIENT200` 还受短前缀启发式误挡，后续修补尚未上线。
  `jamesky-api` PID 1033 / 重启 0 未变；磁盘可用 10,104,352,768 bytes，未删备份、未建立转发。候选环境文件组权限预检和本机浏览器启动失败均保留，不计模型/应用通过。
  [本次发布、真实多轮失败与诊断记录](evidence/operations/production-conversation-repair-release-2026-10-13.json)。
  后续修补 PR #93 / `f51ee9a77daf14a504391227858a6d6706aceccc` 已合并，精确 master CI 10/10 通过；同次 Linux 构建包暂存通过。
  单次 application-only worker 于 `2026-10-13T13:14:45.030Z` 开始、`13:25:02.571Z` 以 exit 70 结束；维护心跳达到原有 30 秒探测超时，日志包含 HTTP 500/503。
  独立严格账本确认 `terminal:ROLLED_BACK:none`，公开版本仍为 `0421d34`；未完成 15 表前后指纹，不能声明修补版上线或生产多轮验收通过。
  `2026-10-13T13:41:15.016Z` 新健康读回仍为 `0421d34`，同期仓库 head 为 `f51ee9a`；上面的机器可校验区保留 `10:49` 最后一次同 SHA 的历史观测，不冒充此次上线成功。
  新建只读连接也曾达到 30 秒观察上限；后续严格 TLS 和驱动新连接通过，同一连接三次读取为 15,342 / 135 / 135 ms。短时恢复不证明长期稳定或底层根因。
  `jamesky-api` PID 1033 / 重启 0 未变，两项服务 online；可用 9,115,549,696 bytes，全部备份与失败候选保留，未改数据库地址或放宽门槛。
  辅助诊断的 CJS/ESM 加载失败未发送数据库请求；修正后的真实探针结果独立保存。该 SHA 不重用，下一次只能使用新 CI-approved SHA。
  [本次心跳中止、独立回退与只读对照记录](evidence/operations/deployment-conversation-heartbeat-failure-2026-10-13.json)。
  后续 PR #94 / `e96b5802f70426c1ab9257cc32ce584b7447e223` 的精确 master CI 10/10 通过，但发布于 `2026-10-13T15:51:52.120Z` 以 exit 70 结束并回滚。
  逐项核对 worker、PM2 与 Nginx 日志后，首个失败已定位到 `/api/countries/NAM?asOf=2026-08-11`：两次约 15 秒超时，随后一次立即 503；`unlock-timeout` 是后续清理错误，不是已证明的首因。
  独立账本为 `terminal:ROLLED_BACK:none`，线上仍为 `0421d34`；仅有 before 指纹，没有 after 指纹，也未执行修补版生产多轮验收。
  2026-10-14（北京时间）在旧运行版本上以非特权用户单独执行原有完整公开读回，97 国及重点来源/日期关系检查 exit 0；NAM / CHN / NAM 独立请求也均为 200。
  这些结果支持链路短时恢复，不证明底层原因已修复或长期稳定；未改数据库路由、超时、发布门槛或失败候选，只允许新 CI-approved SHA 后续发布。
  [本次公开读回失败、回滚及恢复检查记录](evidence/operations/deployment-conversation-readback-failure-2026-10-14.json)。
  后续 PR #95 / `3af85d6abe520226ed54aea6d0c5985d1d23c6ed` 的精确 master CI 10/10 通过；单次 application-only 发布于
  `2026-10-13T22:24:27.816Z` 以 exit 0 完成，独立账本及 committed-host 校验确认 `COMMITTED:APPLICATION_VERIFIED_V2`。
  15 表前后摘要一致，97 国公开读回、内外网中英页面/SSE、7/7 canary 和零重试的 6/6 真实中英示例通过；原 VPS 数据库路由和博客进程不变。
  但随后 20 轮自适应追问只有 14 轮完全满足请求：检索词投影误拒绝、首轮失败后的旧任务残留、通用沟通被主题词否决，
  以及邮件称呼和进一步精简的问题仍被复现。因此该 SHA 已部署，但多轮对话验收失败；后续本地修补不能冒充已上线。
  本次同 SHA 观测替代机器区此前的 10:49 快照，所有历史失败记录保留。
  [本次上线与真实多轮验收记录](evidence/operations/production-conversation-acceptance-2026-10-14.json)。
  后续 PR #96 / `936a1af58c68418bf37cfbe52ea56732f57e851e` 的精确 master CI 10/10 通过，同次 Linux 成品包校验通过。
  单次 application-only 发布于 `2026-10-14T05:07:27.940Z` 以 exit 0 完成，服务器任务耗时约 21 分钟；独立账本与 committed-host 复核通过。
  15 表前后摘要一致，97 辖区公开读回、内外网页面/语言/SSE 验证及零重试真实示例 6/6 通过。`jamesky-api` PID 1033 / 重启 0 未变。
  本次另做 8 轮中文 API 与 12 轮真实英文界面浏览器自适应对话，17/20 满足请求；刷新续聊、国家替换、比较和未知型号证据边界通过。
  三处交互缺陷仍被复现：保留来源任务却丢失原检索词；切换市场任务后旧用途/功率残留；中文草稿收到“再简短一些”后切回英文。
  原 15 秒 canary 为 6/7：真实模型请求 15003 ms 超时；没有延长门槛重算为通过。随后六个示例成功不覆盖该失败，也不证明长期稳定。
  因此确认新版已推送并部署，但多轮对话和 provider-latency 验收仍未全部达标；本次仅记录真实结果，不冒充已修复剩余问题。
  未修改数据库、配额、网络路由或生产超时，未删除备份；本段与操作记录是部署后文档，不是又一次运行版本发布。
  [本次发布与 20 轮真实验收记录](evidence/operations/production-conversation-closeout-2026-10-14.json) 保留逐轮原文、预期差异及巡检失败。
  后续 PR #97 / `34571465f0c8ecd1f682bbc327808a95ad9bd99d` 的分支及精确 master CI 均为 10/10 通过；同次 Linux 成品包校验通过。
  单次 application-only 发布于 `2026-10-14T10:23:50.941Z` 以 exit 0 完成（约 18 分 29 秒）。独立账本、committed-host、内外网页面/语言/SSE 检查通过；15 表前后指纹一致，144 项受保护输入未改变。
  原 15 秒 provider-inclusive canary 为 7/7，真实模型请求 6909 ms，未放宽时限或重试。来源页码修改后追加产品任务仍保留原查询，邮件语言/长度、刷新续聊及未知型号边界通过。
  但 12 轮真实 HTTPS 与 8 轮英文界面浏览器追问只有 14/20 满足请求：年份表达被拒绝、多国市场比较的共享参数编译错误，以及清单忽略市场主题、排除项和精简要求仍被复现。
  因此版本已经部署，真实多轮验收仍未完成；不能把传输成功、canary 通过或完整日期的对照成功改写成全部问题已解决。
  `jamesky-api` PID 1033 / 重启 0 未变，可用空间 5,386,809,344 bytes；未更改数据库 schema、配额或网络路由，未删备份。后续修补必须重新验证后发布。
  [本次发布与真实失败记录](evidence/operations/production-conversation-state-release-2026-10-14.json) 保存全部逐轮回答、判定与参数校验诊断。
- 最后一个完整记录了发布步骤与独立读回的时间戳 release lineage 仍是
  release `20260814144537` / Git
  `38541ac8201e260934fe9eeaab571d2c8a4262ee`。它于 2026-08-14 完成仅代码的
  版本化发布，不执行数据库写入；当时的独立读回复核 `/api/health`、PM2 降权进程、
  PM2 systemd 复活链路、Nginx、首页、聊天页、代表国家页、地图 Demo 清理、公开产品
  API 及真实 AI SSE 均通过。该 lineage 是历史文档基准，不是当前公开运行版本。

## Public evidence boundary / 公开证据边界

- `ACCEPTANCE.md` #166–#264 已随 release `20260812031745` 发布；选择闭包为
  `97 jurisdictions / 28 regulations / 651 limits / 203 sources`。DZA/ETH/NGA 旧 numeric
  图已按合同治理，LIE/SGP/MLT 运行库图已补齐，AUS/PNG/CAN/USA/CHN/MLT 的数值或
  成员边界均通过生产聚焦验收。签核表中保留的“本地 accepted / 待部署”文字是发布前
  审计轨迹，由本状态快照统一 supersede。

| 项目 | 当前代码状态 | 边界 |
| --- | --- | --- |
| 国家目录 | 178 个 ISO3；177 个地图 feature | 目录/几何不代表数值法规覆盖 |
| 真实产品/认证 | 0 条获准公开 fixture | 不宣称真实商业可售性 |
| Demo 产品 | 2 个虚构配置 | 仅用于展示证据链 |
| 市场观测 | 24 条签核 fixture | CHN/USA/DEU/BRA 的 2022/2023 观测，不冒充实时市场 |

工具进度流式传输；最终模型文本缓冲到证据验证完成。公开 SSE 不包含 reasoning。
`covered` 表示发布了核验边界，不保证每个 scope 都有排放限值。

## Verification ledger / 验证台账

`pnpm portfolio:verify` 重算受控工件及源码指纹；旧成功记录不证明本地修改已通过。
`--release-evidence` 还要求证据在 HEAD、index 与 worktree 中字节一致。

<!-- portfolio-verification:start -->
```json
{
  "browserSnapshot": {
    "artifactByteLength": 207016,
    "artifactPath": "docs/evidence/playwright-e2e-latest.json",
    "artifactSha256": "d9d9c33eda1c4c1a255795dd70de0229ddbd241a9cca00593c190d11d57431b3",
    "baseHeadCommit": "93ed0e628805755740bd570c7f3657419205031a",
    "evaluatedCommit": "93ed0e628805755740bd570c7f3657419205031a",
    "observedAt": "2026-10-14T11:19:57.356Z",
    "runId": "22041fb2-4e54-4674-8c40-b2346ab897df",
    "runs": [
      {
        "collected": 499,
        "failed": 0,
        "flaky": 0,
        "passed": 433,
        "skipped": 66,
        "id": "public"
      },
      {
        "collected": 68,
        "failed": 0,
        "flaky": 0,
        "passed": 68,
        "skipped": 0,
        "id": "demo"
      },
      {
        "collected": 4,
        "failed": 0,
        "flaky": 0,
        "passed": 2,
        "skipped": 2,
        "id": "fde"
      },
      {
        "collected": 2,
        "failed": 0,
        "flaky": 0,
        "passed": 2,
        "skipped": 0,
        "id": "production-csp"
      }
    ],
    "sourceFingerprint": {
      "algorithm": "sha256",
      "digest": "349255af972c4346909313d3295def0adfa904f47d95adeea25fd2603aed7255",
      "fileCount": 390
    },
    "version": "diesel-playwright-evidence-v1",
    "worktreeState": "clean"
  },
  "currentPublicRelease": {
    "commit": "34571465f0c8ecd1f682bbc327808a95ad9bd99d",
    "evidenceKind": "historical-operator-record-only",
    "id": "34571465f0c8ecd1f682bbc327808a95ad9bd99d",
    "observedAt": "2026-10-14T10:37+00:00",
    "releasePath": "/opt/diesel/releases/34571465f0c8ecd1f682bbc327808a95ad9bd99d"
  },
  "evidenceSummary": {
    "approvedRealCertifications": 0,
    "approvedRealProducts": 0,
    "jurisdictions": 97,
    "limits": 651,
    "regulations": 28,
    "sources": 203
  },
  "liveEval": {
    "archivePath": "docs/evals/archive/ai-live-eval-20261014T075628279Z-128c3588-6b6b-42e7-8a9c-5da54902a1ac.json",
    "attemptCount": 33,
    "complete": true,
    "completedCount": 33,
    "evaluatedAt": "2026-10-14T07:56:28.279Z",
    "expectedModelId": "server-openai-compatible/deepseek-flash",
    "expectedProviderProfile": {
      "adapter": "@ai-sdk/openai-compatible",
      "adapterContractVersion": 5,
      "enableThinking": false,
      "endpointSha256": "a34e2a4708ed1c61008a151688838dcf1c44d4e7f08054633e72ba7c0b16cfc1",
      "includeUsage": true
    },
    "latestOutcome": "passed",
    "latestSampleCount": 18,
    "modelStepCount": 33,
    "reportVersion": "sales-chat-live-v26",
    "runError": null,
    "runId": "128c3588-6b6b-42e7-8a9c-5da54902a1ac",
    "sourceFingerprint": {
      "algorithm": "sha256",
      "digest": "9d4c80bac78beffa19c2ed366e700d1393d657891dccd9def8623031ff8dc396",
      "fileCount": 331,
      "status": "captured"
    },
    "suiteVersion": "sales-chat-live-v26",
    "suiteCaseCount": 18,
    "terminationReason": "completed",
    "thresholdsPassed": true,
    "tokenUsageComplete": true,
    "totalTokens": 90746
  },
  "lastDocumentedRelease": {
    "commit": "38541ac8201e260934fe9eeaab571d2c8a4262ee",
    "id": "20260814144537"
  },
  "publicRuntime": {
    "evidenceKind": "historical-operator-record-only",
    "readbackAt": "2026-10-14T10:37+00:00",
    "status": "ok",
    "version": "34571465f0c8ecd1f682bbc327808a95ad9bd99d"
  },
  "qualitySnapshot": {
    "artifactPath": "docs/evidence/vitest-execution-latest.json",
    "version": "diesel-vitest-execution-evidence-v2"
  },
  "repositoryHead": {
    "local": "34571465f0c8ecd1f682bbc327808a95ad9bd99d",
    "observedAt": "2026-10-14T10:37+00:00",
    "remote": "34571465f0c8ecd1f682bbc327808a95ad9bd99d"
  }
}
```
<!-- portfolio-verification:end -->

- 当前唯一 Vitest 执行证据指针：artifact `docs/evidence/vitest-execution-latest.json`；format `diesel-vitest-execution-evidence-v2`。
  动态测试计数、执行时间、HEAD 与 source fingerprint 仅从该 artifact 派生；`STATUS.md` 不复制这些值。

- 当前 live-eval 证据台账：`passed`；evaluatedAt `2026-10-14T07:56:28.279Z`；run ID `128c3588-6b6b-42e7-8a9c-5da54902a1ac`；`18/18 cases`；`complete=true`；`terminationReason=completed`；`33 provider attempts`；`33 completed provider calls`；`33 model steps`；
  `90746 known tokens`；`tokenUsageComplete=true`；`thresholdsPassed=true`；`runError=none`；`suiteVersion=sales-chat-live-v26`；`reportVersion=sales-chat-live-v26`；
  archive `docs/evals/archive/ai-live-eval-20261014T075628279Z-128c3588-6b6b-42e7-8a9c-5da54902a1ac.json`；source fingerprint `9d4c80bac78beffa19c2ed366e700d1393d657891dccd9def8623031ff8dc396` across `331` files。

- 当前浏览器证据快照：format `diesel-playwright-evidence-v1`，run ID `22041fb2-4e54-4674-8c40-b2346ab897df`，artifact SHA-256 `d9d9c33eda1c4c1a255795dd70de0229ddbd241a9cca00593c190d11d57431b3`；
  observedAt `2026-10-14T11:19:57.356Z`，clean worktree / base HEAD `93ed0e628805755740bd570c7f3657419205031a`；
  `public` = `433 passed / 66 skipped / 0 failed / 0 flaky / 499 collected`；
  `demo` = `68 passed / 0 skipped / 0 failed / 0 flaky / 68 collected`；
  `fde` = `2 passed / 2 skipped / 0 failed / 0 flaky / 4 collected`；
  `production-csp` = `2 passed / 0 skipped / 0 failed / 0 flaky / 2 collected`；
  聚合为 505 passed / 68 skipped / 0 failed / 0 flaky / 573 collected。artifact 为 207016 bytes；
  browser source fingerprint 为 390 files / `349255af972c4346909313d3295def0adfa904f47d95adeea25fd2603aed7255`。
  因运行发生在 clean worktree，`evaluatedCommit=93ed0e628805755740bd570c7f3657419205031a`；它证明该本地候选上的浏览器验收，
  不冒充远端 CI、安全审计、生产部署或现实用户成效证据。

## Acceptance and operations / 验收与运维

- 工程维护的实现合同见 [ENGINEERING_MAINTENANCE.md](ENGINEERING_MAINTENANCE.md)；
  CI、发布、容量与真实测量的落地状态见[维护操作台账](evidence/operations/engineering-maintenance-latest.json)。
  代码实现、实验结果与生产验收分别记录，不能互相替代。
- 本地：lint、typecheck、完整 Vitest、build、离线 AI eval、四套浏览器测试及 portfolio verifier。
- 线上：健康/就绪版本绑定、语言切换、关键页面、真实中英六个示例和 provider-inclusive canary；不得用 mock 测试代替。
- `pnpm test:e2e:live` 需要显式付费验收开关和精确 release SHA；零重试、失败保存报告，不放宽证据门槛。
- 生产 canary 每 6 小时运行一次真实 AI 示例并保存脱敏失败记录；GitHub schedule 是尽力执行，不构成 SLO/on-call。
- 部署和恢复只执行 [DEPLOYMENT.md](DEPLOYMENT.md) 的版本化入口；不删除失败账本、备份或跳过 CI。
- 2026-09-01 的只读 GitHub API 读回确认 `master` 只要求唯一 `Required CI gate`，开启 strict 与管理员约束；发布前必须重新读回。

## External gates / 不能由代码替代的外部门槛

| 门槛 | 状态 | 完成所需材料 |
| --- | --- | --- |
| 真实产品与认证 | 未获批准 | 产品所有者授权、规格版本与可追溯认证来源 |
| 法规专家验收 | 未完成 | 外部专家对日期、scope、数值和来源的独立签核 |
| 真实销售试点 | 未开展 | 真实参与者、基线、任务记录、反馈及效果测量 |
| FDE 历史公开归档 | 禁止发布 | LICENSE/NOTICE、资产权利与 copyleft 再分发复核，见 [历史审查](DEVELOPMENT_HISTORY.md) |
| 私有知识库业务化 | 未配置 | 授权文档、私有存储策略、代表性检索/embedding 基准 |

本站是公开只读作品演示，不是正式法规服务或已验证的业务生产系统。密钥事项按用户要求不在本轮处理。
