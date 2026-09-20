# Local evidence lab / 本地证据练习

Follow this lab independently to reproduce a refusal, inspect a deterministic
product decision, and prepare a useful handoff. Commands are shared by both
languages; each step includes English and Chinese instructions.

这份练习用于独立复现拒答、检查确定性产品判断，并整理可交接的问题记录。
中英文共用同一组命令，每一步提供两种语言说明。

This is an **offline, fictional demonstration**, not an industry pilot, legal
opinion, certification, or proof of user adoption. Do not add real credentials,
private documents, countries, or products. Current release claims belong only
in [STATUS.md](STATUS.md); local success does not update production status.

这是**离线、虚构的演示**，不是行业试点、法律意见、认证或真实用户效果证明。
不要添加真实凭据、私有文档、国家或产品。当前发布状态只以
[STATUS.md](STATUS.md) 为准；本地成功不代表生产版本已经更新。

## 1. Start and identify the runtime / 启动并确认运行环境

From the repository root, use the Node version in `.nvmrc` and the pnpm version
in `package.json#packageManager`. Install once, then keep the Demo running in
this terminal. Port 3510 must be free; if you change it, change every URL below.
No PostgreSQL, Docker, `.env.local`, or model key is required. The Demo runs
tracked migrations in an in-memory PGlite database and uses an offline model.

在仓库根目录操作，Node 版本以 `.nvmrc` 为准，pnpm 版本以
`package.json#packageManager` 为准。安装后保持该终端运行。3510 端口须空闲；
若更换端口，下文所有 URL 也须同步修改。无需 PostgreSQL、Docker、`.env.local`
或模型密钥；Demo 在内存 PGlite 中运行现有迁移，并使用离线模型。

```bash
pnpm install --frozen-lockfile
DEMO_PORT=3510 pnpm demo
```

In a second terminal / 在第二个终端执行：

```bash
curl -i http://127.0.0.1:3510/api/health
curl -i http://127.0.0.1:3510/api/health/ready
```

Both should return HTTP 200 and `version: "portfolio-demo"`. Readiness should
report `database`, `aiChatAdmission`, and `aiChatRateLimit` as `ok`. If the version
differs, stop: you are not exercising this lab's runtime. Health proves service
availability, **not regulatory coverage or product suitability**. Record the
`x-request-id` response header when investigating a failure.

两者应返回 HTTP 200 和 `version: "portfolio-demo"`。就绪检查的 `database`、
`aiChatAdmission`、`aiChatRateLimit` 应为 `ok`。版本不同则停止：当前访问的不是
本练习环境。健康检查只说明服务可用，**不证明法规覆盖或产品适配**。
排查失败时记录响应头中的 `x-request-id`。

## 2. Reproduce missing evidence / 复现证据缺口

```bash
curl -i 'http://127.0.0.1:3510/api/countries/FJI?applicationScope=non-road&powerKw=100&asOf=2026-08-13'
```

Expected: HTTP 200 with `{"iso3":"FJI","status":"no_data"}`. FJI is in the
country directory; that is not evidence of emission limits. `no_data` means
the application cannot supply the requested evidence, not that Fiji has no law.

预期：HTTP 200，正文为 `{"iso3":"FJI","status":"no_data"}`。FJI 属于国家目录，
但目录记录不是排放限值证据。`no_data` 表示应用无法提供所请求的证据，不能推断
斐济没有相关法律。

Open `http://127.0.0.1:3510/chat`, select English, and ask:

打开 `http://127.0.0.1:3510/chat`，选择英文并提问：

```text
Check FJI non-road regulations for 100 kW as of 2026-08-13. Do not extrapolate if evidence is missing.
```

Then select Chinese, reload the chat page to start a fresh conversation, and ask /
然后切换中文，刷新聊天页面以开始新对话，再提问：

```text
查询 FJI 在 2026-08-13 的 non-road 100 kW 法规，证据不足时不要推断。
```

Both should show a regulation-comparison card retaining FJI, non-road, 100 kW,
and the date, followed by a fixed evidence-gap answer. A directory citation may
remain visible; it does not make regulatory evidence sufficient. Do not accept
an invented emissions stage or a parameter-error message as the expected result.
Tool progress streams; final model prose is buffered until evidence validation.

两种语言都应显示法规比较卡片，保留 FJI、非道路、100 kW 和日期，再给出固定证据
缺口答复。卡片可以显示国家目录引用，但这不代表法规证据充分。编造的排放阶段或
参数错误提示均不是预期结果。工具进度实时传输；最终模型文字缓冲到证据验证结束。

For an API-only replay, the request requires a UUID `sessionId` and UI-message
`parts`; `locale` is optional. This fixed UUID is only a local exercise identifier.

仅使用接口时，请提供 UUID 格式的 `sessionId` 和带 `parts` 的 UI 消息；`locale`
为可选字段。下面固定 UUID 只用作本地练习标识。

```bash
curl -i -N --max-time 45 http://127.0.0.1:3510/api/chat \
  -H 'Content-Type: application/json' \
  --data '{"locale":"en","sessionId":"c79f7d5e-2684-4b85-b9d7-3e8b8b4af06a","selectedCountryIso3":"FJI","messages":[{"id":"lab-question-1","role":"user","parts":[{"type":"text","text":"Check FJI non-road regulations for 100 kW as of 2026-08-13. Do not extrapolate if evidence is missing."}]}]}'
```

Check `Content-Type: text/event-stream`, a `tool-output-available` result with
`tool: "compareRegulations"`, `status: "no_data"`, and `evidenceSufficient: false`,
then the fixed gap and `[DONE]`. HTTP 200 alone does not prove a successful
business answer. The stream must not contain reasoning parts. Source titles and
original source text retain their original language; machine codes are more
stable than explanatory strings in raw tool payloads.

检查 `Content-Type: text/event-stream`、`tool-output-available` 中的
`tool: "compareRegulations"`、`status: "no_data"`、`evidenceSufficient: false`，
以及随后出现的固定缺口答复和 `[DONE]`。HTTP 200 不等于业务结论成功。
流中不得出现 reasoning part。来源标题和原文保持原始语言；检查原始工具结果时，
优先使用稳定的机器代码，而非解释字符串。

## 3. Inspect the successful fixture / 检查成功的虚构数据流程

```bash
curl -i 'http://127.0.0.1:3510/api/countries/CHN?applicationScope=non-road&powerKw=100&asOf=2026-08-13'
curl -i http://127.0.0.1:3510/api/products
curl -i http://127.0.0.1:3510/api/product-fit \
  -H 'Content-Type: application/json' \
  --data '{"countryIso3":"CHN","applicationScope":"non-road","powerKw":100,"asOf":"2026-08-13","productModelCode":"DEMO-ENG-100"}'
```

CHN should be `available` with `country.isDemo: true`. Inspect effective and
future-adopted rules separately. Query-matching limits are under
`applicabilitySummary.country.currentEffectiveRegulations[].limits`, not the
broad country's rule summary. Keep units, power bands, validity periods, source
identity, and verification dates together. Never report these fictional limits
as real Chinese regulations. `.invalid` Demo source URLs are intentionally not
downloadable authority documents.

CHN 应为 `available`，且 `country.isDemo: true`。分别检查已生效法规和未来已采纳
法规。匹配查询的限值位于
`applicabilitySummary.country.currentEffectiveRegulations[].limits`，不是宽泛的
国家法规摘要。单位、功率区间、有效期、来源身份和核验日期必须一起保留。
不得将这些虚构限值当作真实中国法规；`.invalid` Demo 来源地址有意不指向可下载
的权威文件。

Product fit is **POST**, not GET. Expect `rulesetVersion: "product-fit-v2"`,
`status: "fit"`, `commercialReadiness: "ready"`, and a Demo product. Inspect
`productChecks.availability`, `productChecks.power`, `regulationChecks`, and
`sources` separately. A Demo `ready` result never authorizes a quotation or
certification claim.

产品适配接口使用 **POST**，不是 GET。预期为 `rulesetVersion: "product-fit-v2"`、
`status: "fit"`、`commercialReadiness: "ready"` 和 Demo 产品。分别检查
`productChecks.availability`、`productChecks.power`、`regulationChecks` 与
`sources`。Demo 的 `ready` 不能用于报价或认证声明。

Change only power to the excluded upper bound / 只将功率改为不包含的区间上界：

```bash
curl -i http://127.0.0.1:3510/api/product-fit \
  -H 'Content-Type: application/json' \
  --data '{"countryIso3":"CHN","applicationScope":"non-road","powerKw":150,"asOf":"2026-08-13","productModelCode":"DEMO-ENG-100"}'
```

Expected: HTTP 200, `status: "not_fit"`, `commercialReadiness: "not_ready"`,
`productChecks.power.code: "PRODUCT_POWER_OUT_OF_RANGE"`. Availability still
passes. This is a deterministic negative decision with evidence, not a server
failure or a claim that the product is unavailable for sale on that date.

预期：HTTP 200、`status: "not_fit"`、`commercialReadiness: "not_ready"`、
`productChecks.power.code: "PRODUCT_POWER_OUT_OF_RANGE"`，供应期检查仍然通过。
这是有证据的确定性否定判断，不是服务器故障，也不代表产品在该日期不供应。

## 4. Diagnose and hand off / 排障并交接

```bash
curl -i 'http://127.0.0.1:3510/api/countries/CHN?asOf=2026-02-30'
```

Expected: HTTP 400 and `error.code: "INVALID_AS_OF"`; February 30 is not a
valid date. Correct input errors before retrying. For a 429/503 response, retain
the request ID and follow `Retry-After` when supplied; do not launch a retry loop.
An SSE stream ending with an error or without its expected completion must not
be described as a validated answer.

预期：HTTP 400 和 `error.code: "INVALID_AS_OF"`；2 月 30 日不是有效日期。
修正输入后再重试。遇到 429/503 时保留请求 ID，若有 `Retry-After` 则按其等待，
不要启动循环重试。SSE 以错误结束或未正常完成时，不得将其描述为已验证答复。

Prepare this small handoff record using actual observations / 使用实际观测填写交接记录：

- Runtime version; full URL or sanitized POST body; locale; UTC observation time.
  运行版本、完整 URL 或脱敏 POST 正文、语言、UTC 观测时间。
- `x-request-id`, HTTP status, tool/business status, and stable reason code.
  `x-request-id`、HTTP 状态、工具/业务状态及稳定原因代码。
- Relevant source ID, title, locator, and verification date; explicitly mark
  missing page/section information instead of inventing it.
  相关来源 ID、标题、定位及核验日期；没有页码/章节时明确写缺失，不得补造。
- Expected versus observed behavior, the smallest reproducible input change,
  and the evidence needed before making a positive conclusion.
  预期与实际行为、最小可复现输入变化，以及得出肯定结论前还需要哪些证据。

Do not include cookies, credentials, or private attachments. Press Ctrl-C in
the Demo terminal when done. Restarting creates fresh in-memory Demo data; this
exercise neither publishes data nor deploys a release.

不要包含 Cookie、凭据或私有附件。结束后在 Demo 终端按 Ctrl-C。重启会创建全新的
内存 Demo 数据；本练习不会发布数据或部署版本。
