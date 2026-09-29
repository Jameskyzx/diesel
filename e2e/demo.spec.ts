import { expect, test } from "@playwright/test";
import { z } from "zod";
import { buildEvidenceGapResponse } from "../src/domain/ai/evidence-gap-response";
import { tokenizeKnowledgeText } from "../src/domain/knowledge/embedding";
import { aiToolResultSchema } from "../src/features/ai/schemas";
import { expectedAiToolResultWarnings } from "../src/features/ai/tool-result-envelope";
import { canonicalDemoRegulationNames, withCanonicalDemoRegulationNames } from "./helpers/canonical-order-demo-result";

test.beforeEach(async ({ baseURL, context }) => {
  await context.addCookies([
    {
      name: "diesel_locale",
      url: baseURL ?? "http://127.0.0.1:3200",
      value: "zh-CN",
    },
  ]);
});

for (const browserLocale of ["en-US", "zh-CN"] as const) {
  test.describe(`canonical evidence in ${browserLocale}`, () => {
    test.use({ locale: browserLocale });

    test("portfolio accepts canonical regulation order across browser locales", async ({ context, page }) => {
      const english = browserLocale === "en-US";
      if (english) await context.clearCookies();
      let delivered = false;
      // Test-only transport variation, not an accepted fixture or a claim about
      // the provider. Unit tests separately exercise the real production service.
      await page.route("**/api/chat", async (route) => {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        let replacedText = false;
        const body = (await response.text()).split("\n").map((line) => {
          if (!line.startsWith("data: {")) return line;
          const part = z.object({ type: z.string(), output: z.unknown().optional() })
            .passthrough().parse(JSON.parse(line.slice(6)) as unknown);
          if (part.type === "tool-output-available") {
            const output = withCanonicalDemoRegulationNames(part.output);
            delivered = true;
            return `data: ${JSON.stringify({ ...part, output })}`;
          }
          if (part.type === "text-delta") {
            const delta = replacedText ? "" : english
              ? "Test-only Demo response: read the sourced comparison cards. This is not regulatory advice."
              : "仅用于测试的 Demo 响应：请查看带来源的比较卡片，不可作为法规建议。";
            replacedText = true;
            return `data: ${JSON.stringify({ ...part, delta })}`;
          }
          return line;
        }).join("\n");
        await route.fulfill({ response, body });
      }, { times: 1 });

      await page.goto("/chat");
      expect(await page.evaluate(() => new Intl.Collator().resolvedOptions().locale)).toBe(browserLocale);
      await expect(page.locator("html")).toHaveAttribute("lang", english ? "en" : "zh-CN");
      const assistant = page.getByRole("complementary", { name: english ? "AI sales analysis assistant" : "AI 营销分析助手" });
      await assistant.getByRole("textbox", { name: english ? "Enter a question" : "输入问题" }).fill(english
        ? "Compare CHN and BRA non-road regulations for 100 kW as of 2026-08-20."
        : "比较 CHN 和 BRA 非道路 100 kW 法规，截至 2026-08-20。");
      await assistant.getByRole("button", { name: english ? "Send question" : "发送问题" }).click();
      const card = assistant.getByRole("region", { name: english ? "Database regulation comparison" : "数据库法规比较", exact: true });
      await expect(card).toHaveCount(1);
      for (const name of canonicalDemoRegulationNames) await expect(card).toContainText(name);
      await expect(card).toContainText(english ? "Evidence retrieved" : "已取得证据");
      const text = await card.innerText();
      expect(text.indexOf(canonicalDemoRegulationNames[0])).toBeLessThan(text.indexOf(canonicalDemoRegulationNames[1]));
      await expect(assistant.getByTestId("assistant-markdown")).toContainText(english ? "Test-only Demo response" : "仅用于测试的 Demo 响应");
      expect(delivered).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({ path: test.info().outputPath("canonical-regulation-order.png") });
    });
  });
}

for (const example of [
  {
    name: "regulations",
    card: "Database regulation comparison",
    prompt: "Compare CHN and BRA non-road regulations for 100 kW as of 2026-08-20.",
  },
  {
    name: "market metrics",
    card: "Structured market comparison",
    prompt: "Compare the CHN and BRA DEMO_ADDRESSABLE_UNITS market metric.",
  },
] as const) {
  test(`portfolio demo keeps both countries in English ${example.name}`, async ({ context, page }) => {
    await context.clearCookies();
    await page.goto("/chat");
    const assistant = page.getByRole("complementary", { name: "AI sales analysis assistant" });
    await assistant.getByRole("textbox", { name: "Enter a question" }).fill(example.prompt);
    await assistant.getByRole("button", { name: "Send question" }).click();
    const card = assistant.getByRole("region", { name: example.card, exact: true });
    await expect(card).toHaveCount(1);
    const query = example.name === "regulations"
      ? assistant.getByLabel(`${example.card} query conditions`, { exact: true })
      : card;
    await expect(query).toContainText("CHN");
    await expect(query).toContainText("BRA");
    const answer = assistant.getByTestId("assistant-markdown").last();
    await expect(answer).not.toBeEmpty();
    await expect(answer).not.toContainText("This request lacks enough evidence");
    await expect(answer).not.toContainText("At least one query or parameter validation failed");
    if (example.name === "regulations") {
      await expect(assistant.getByTestId("assistant-markdown")).toHaveCount(1);
      await expect(answer).toContainText("Evidence as-of date: 2026-08-20.");
    }
  });
}

for (const locale of ["en", "zh-CN"] as const) {
  test(`portfolio demo exposes the market comparison basis in ${locale}`, async ({ context, page }) => {
    if (locale === "en") await context.clearCookies();
    const english = locale === "en";
    await page.goto("/chat");
    const assistant = page.getByRole("complementary", { name: english ? "AI sales analysis assistant" : "AI 营销分析助手" });
    await assistant.getByRole("textbox", { name: english ? "Enter a question" : "输入问题" }).fill(english
      ? "Compare CHN and BRA non-road DEMO_ADDRESSABLE_UNITS market metrics."
      : "比较 CHN 和 BRA 非道路 DEMO_ADDRESSABLE_UNITS 市场指标。");
    await assistant.getByRole("button", { name: english ? "Send question" : "发送问题" }).click();
    const card = assistant.getByRole("region", { name: english ? "Structured market comparison" : "结构化市场比较", exact: true });
    const query = card.getByLabel(english ? "Structured market comparison query conditions" : "结构化市场比较查询条件", { exact: true });
    await expect(query).toContainText("CHN");
    await expect(query).toContainText("BRA");
    await expect(query).toContainText("DEMO_ADDRESSABLE_UNITS");
    await expect(query).toContainText(english ? "Metric codes" : "指标代码");
    await expect(query).toContainText(english ? "Non-road" : "非道路");
    for (const [country, value] of [["CHN", "12,345 units"], ["BRA", "6,789 units"]]) {
      const observation = card.getByRole("group", { name: `${country} · DEMO_ADDRESSABLE_UNITS ${english ? "observation" : "观测值"}`, exact: true });
      await expect(observation).toContainText(value!);
      await expect(observation).toContainText(english ? "Period start (inclusive)" : "统计期起点（包含）");
      await expect(observation).toContainText(english ? "Period end (exclusive)" : "统计期终点（不含）");
      await expect(observation).toContainText(english ? "Jan 1, 2025" : "2025年1月1日");
      await expect(observation).toContainText(english ? "Jan 1, 2026" : "2026年1月1日");
      await expect(observation).toContainText("demo-v1");
      await expect(observation).toContainText(english ? "Fictional annual addressable unit count" : "年度可触达台数");
      await expect(observation).toContainText(english ? "Currency" : "币种");
      await expect(observation).toContainText(english ? "Not recorded" : "未记录");
    }
    await expect(assistant.getByTestId("assistant-markdown").last()).not.toContainText(english ? "This request lacks enough evidence" : "这次请求没有足够证据");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const statusBadge = card.locator("header").getByText(english ? "Evidence retrieved" : "已取得证据", { exact: true });
    expect((await statusBadge.boundingBox())!.height).toBeLessThanOrEqual(24);
    await card.evaluate((element) => { element.scrollIntoView({ block: "start" }); window.scrollBy(0, -96); });
    await page.screenshot({ path: test.info().outputPath("market-comparison-top.png") });
    await card.getByRole("group", { name: `BRA · DEMO_ADDRESSABLE_UNITS ${english ? "observation" : "观测值"}`, exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath("market-comparison-detail.png") });

    for (const [index, example] of [
      { countries: "CHN and FJI", metric: "DEMO_ADDRESSABLE_UNITS", empty: false },
      { countries: "CHN and BRA", metric: "DEMO_MISSING_METRIC", empty: true },
    ].entries()) {
      await assistant.getByRole("textbox", { name: english ? "Enter a question" : "输入问题" }).fill(english
        ? `Compare ${example.countries} non-road ${example.metric} market metrics.`
        : `比较 ${example.countries} 非道路 ${example.metric} 市场指标。`);
      await assistant.getByRole("button", { name: english ? "Send question" : "发送问题" }).click();
      const latestCard = card.last();
      await expect(latestCard.getByRole("list", { name: english ? "Comparison evidence gaps" : "比较证据缺口" })).toContainText(english
        ? "At least one requested country has no observation for this metric."
        : "至少一个请求国家没有该指标的观测值。");
      await expect(latestCard).toContainText(example.metric);
      const observations = latestCard.getByRole("group", { name: new RegExp(` · ${example.metric} ${english ? "observation" : "观测值"}$`, "u") });
      await expect(observations).toHaveCount(example.empty ? 0 : 1);
      if (!example.empty) await expect(latestCard.getByRole("group", { name: `CHN · ${example.metric} ${english ? "observation" : "观测值"}`, exact: true })).toBeVisible();
      if (example.empty) await expect(latestCard).toContainText(english ? "No observations" : "没有观测值");
      await expect(assistant.getByTestId("assistant-markdown")).toHaveCount(index + 2);
      await expect(assistant.getByTestId("assistant-markdown").last()).toContainText(english ? "This request lacks enough evidence" : "这次请求没有足够证据");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  });

  test(`portfolio UI retains a test-only incomplete market basis in ${locale}`, async ({ context, page }) => {
    if (locale === "en") await context.clearCookies();
    const english = locale === "en";
    // Transport-only UI fault injection over an actual offline Demo response.
    // The production SSE regression separately runs the real service boundary;
    // this test neither changes Demo rows nor claims its observations are missing.
    let delivered = false;
    await page.route("**/api/chat", async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      let replacementText: string | null = null;
      let replacedText = false;
      const body = (await response.text()).split("\n").map((line) => {
        if (!line.startsWith("data: {")) return line;
        const part = z.object({ type: z.string(), output: z.unknown().optional() }).passthrough().parse(JSON.parse(line.slice(6)) as unknown);
        if (part.type === "tool-output-available") {
          const result = aiToolResultSchema.parse(part.output);
          if (result.tool !== "compareMarkets") throw new Error("Expected the Demo market comparison");
          expect(result.status).toBe("ok");
          for (const metric of result.comparison.metrics) {
            for (const observation of metric.observations) {
              observation.unitCode = " ";
              observation.definition = "\t";
              observation.methodologyVersion = "\n";
            }
            metric.issues = ["MISSING_UNIT", "MISSING_DEFINITION", "MISSING_METHODOLOGY"];
            metric.comparisonStatus = "insufficient_data";
          }
          result.comparison.missingData = result.comparison.metrics.map((metric) => `${metric.metricCode} 不可比较：${metric.issues.join(", ")}。`);
          result.status = "no_data";
          result.evidenceSufficient = false;
          result.warnings = expectedAiToolResultWarnings(result);
          const validated = aiToolResultSchema.parse(result);
          replacementText = buildEvidenceGapResponse([validated], false, false, locale);
          delivered = true;
          return `data: ${JSON.stringify({ ...part, output: validated })}`;
        }
        if (part.type === "text-delta") {
          if (replacementText === null) throw new Error("Expected evidence before final text");
          const delta = replacedText ? "" : replacementText;
          replacedText = true;
          return `data: ${JSON.stringify({ ...part, delta })}`;
        }
        return line;
      }).join("\n");
      expect(replacedText).toBe(true);
      await route.fulfill({ response, body });
    }, { times: 1 });

    await page.goto("/chat");
    const assistant = page.getByRole("complementary", { name: english ? "AI sales analysis assistant" : "AI 营销分析助手" });
    await assistant.getByRole("textbox", { name: english ? "Enter a question" : "输入问题" }).fill(english
      ? "Compare CHN and BRA non-road DEMO_ADDRESSABLE_UNITS market metrics."
      : "比较 CHN 和 BRA 非道路 DEMO_ADDRESSABLE_UNITS 市场指标。");
    await assistant.getByRole("button", { name: english ? "Send question" : "发送问题" }).click();
    const card = assistant.getByRole("region", { name: english ? "Structured market comparison" : "结构化市场比较", exact: true });
    const issues = card.getByRole("list", { name: english ? "Comparison evidence gaps" : "比较证据缺口" });
    await expect(issues.getByRole("listitem")).toHaveCount(3);
    for (const missing of english ? ["no recorded unit", "no recorded metric definition", "no recorded methodology version"] : ["未记录单位", "未记录指标口径", "未记录方法版本"]) await expect(issues).toContainText(missing);
    await expect(card).not.toContainText("MISSING_UNIT");
    await expect(card).toContainText(english ? "Insufficient data" : "数据不足");
    for (const country of ["CHN", "BRA"]) {
      const observation = card.getByRole("group", { name: `${country} · DEMO_ADDRESSABLE_UNITS ${english ? "observation" : "观测值"}`, exact: true });
      await expect(observation).toContainText(country === "CHN" ? "12,345" : "6,789");
      await expect(observation).toContainText(english ? "(unit not recorded)" : "（单位未记录）");
      await expect(observation).toContainText(english ? "Not recorded" : "未记录");
      await expect(observation).toContainText("DEMO");
    }
    await expect(assistant.getByTestId("assistant-markdown")).toContainText(english ? "This request lacks enough evidence" : "这次请求没有足够证据");
    expect(delivered).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await card.evaluate((element) => { element.scrollIntoView({ block: "start" }); window.scrollBy(0, -96); });
    await page.screenshot({ path: test.info().outputPath("market-missing-basis.png") });
  });

  test(`portfolio demo keeps full country names intact in ${locale}`, async ({ context, page }) => {
    if (locale === "en") await context.clearCookies();
    const english = locale === "en";
    await page.goto("/chat");
    const assistant = page.getByRole("complementary", { name: english ? "AI sales analysis assistant" : "AI 营销分析助手" });
    const textbox = assistant.getByRole("textbox", { name: english ? "Enter a question" : "输入问题" });
    const send = assistant.getByRole("button", { name: english ? "Send question" : "发送问题" });
    const cards = assistant.getByRole("region", { name: english ? "Database regulation comparison" : "数据库法规比较", exact: true });
    const answer = assistant.getByTestId("assistant-markdown").last();
    for (const [index, example] of [
      { countries: ["SSD"], prompt: english
        ? "Check South Sudan non-road 100 kW regulations as of 2026-08-20."
        : "核对 South Sudan 非道路 100 kW 法规，截至 2026-08-20。" },
      { countries: ["TTO", "CHN"], prompt: english
        ? "Compare Trinidad and Tobago and CHN non-road 100 kW regulations as of 2026-08-20."
        : "比较 Trinidad and Tobago 和 CHN 非道路 100 kW 法规，截至 2026-08-20。" },
    ].entries()) {
      await textbox.fill(example.prompt);
      await send.click();
      await expect(cards).toHaveCount(index + 1);
      const conditions = cards.last().getByLabel(english ? "Database regulation comparison query conditions" : "数据库法规比较查询条件", { exact: true });
      for (const country of example.countries) await expect(conditions).toContainText(country);
      await expect(conditions).not.toContainText("SDN");
      await expect(conditions).toContainText("100 kW");
      await expect(conditions).toContainText(english ? "Non-road" : "非道路");
      await expect(conditions).toContainText(english ? "Aug 20, 2026" : "2026年8月20日");
      // Directory identity is not regulatory coverage. These countries have no
      // matching Demo regulations, so the corrected route must still fail closed.
      await expect(answer).toContainText(english ? "This request lacks enough evidence" : "这次请求没有足够证据");
      await expect(answer).toContainText(example.countries[0]!);
      await expect(answer).not.toContainText(english ? "At least one query or parameter validation failed" : "至少有一项查询或参数校验失败");
    }
  });

  test(`portfolio demo distinguishes unknown product results from a conclusive decision in ${locale}`, async ({ context, page }) => {
    if (locale === "en") await context.clearCookies();
    const english = locale === "en";
    await page.goto("/chat");
    const assistant = page.getByRole("complementary", { name: english ? "AI sales analysis assistant" : "AI 营销分析助手" });
    const textbox = assistant.getByRole("textbox", { name: english ? "Enter a question" : "输入问题" });
    const send = assistant.getByRole("button", { name: english ? "Send question" : "发送问题" });
    const cards = assistant.getByRole("region", { name: english ? "Deterministic product fit" : "确定性产品适配", exact: true });
    const answer = assistant.getByTestId("assistant-markdown").last();
    const explanation = english
      ? "CHN lacks sufficient evidence for a conclusive product-fit decision for Non-road, 100 kW, as of Aug 12, 2026."
      : "CHN 在非道路、100 kW、2026年8月12日条件下没有确定的适配结论";
    for (const [index, model] of ["DEMO-ENG-200", "DOES-NOT-EXIST", "DEMO-ENG-100"].entries()) {
      await textbox.fill(english
        ? `Evaluate product fit for ${model} in CHN non-road 100 kW as of 2026-08-12.`
        : `评估 ${model} 在 CHN 非道路 100 kW、截至 2026-08-12 的产品合规适配。`);
      await send.click();
      await expect(cards).toHaveCount(index + 1);
      const card = cards.last();
      const conditions = assistant.getByLabel(english ? "Deterministic product fit query conditions" : "确定性产品适配查询条件", { exact: true }).last();
      await expect(conditions).toContainText(model);
      await expect(conditions).toContainText(english ? "Aug 12, 2026" : "2026年8月12日");
      if (model === "DEMO-ENG-100") {
        await expect(card).toContainText(english ? "Commercially ready" : "商业就绪");
        await expect(answer).toContainText(english ? "The product-fit-v2 deterministic match is complete." : "已运行 product-fit-v2 确定性匹配");
        await expect(answer).not.toContainText(explanation);
      } else {
        await expect(card).toContainText(english ? "Unknown / insufficient evidence" : "未知 / 证据不足");
        await expect(answer).toContainText(explanation);
      }
      await expect(answer).not.toContainText("has no deterministic fit result");
      await expect(answer).toContainText(english ? "For information only; not a substitute for formal certification or legal advice." : "信息参考，不替代正式认证或法律意见");
    }
  });

  test(`portfolio demo validates delivered page and section locators in ${locale}`, async ({ context, page }) => {
    if (locale === "en") await context.clearCookies();
    const english = locale === "en";
    await page.goto("/chat");
    const assistant = page.getByRole("complementary", { name: english ? "AI sales analysis assistant" : "AI 营销分析助手" });
    const textbox = assistant.getByRole("textbox", { name: english ? "Enter a question" : "输入问题" });
    const send = assistant.getByRole("button", { name: english ? "Send question" : "发送问题" });
    const cards = assistant.getByRole("region", { name: english ? "Knowledge-base evidence" : "知识库证据", exact: true });
    const answer = assistant.getByTestId("assistant-markdown").last();
    const gap = english ? "This request lacks enough evidence" : "这次请求没有足够证据";
    const request = (query: string) => english
      ? `Retrieve ${query} as of 2026-08-20.`
      : `检索 ${query}，截至 2026-08-20。`;
    await textbox.fill(request("CHN non-road emissions regulations original text sections source evidence"));
    await send.click();
    await expect(cards).toHaveCount(1);
    await expect(answer).not.toContainText(gap);
    await cards.first().locator("summary").click();
    const sourceText = await cards.first().getByText(/Searchable fictional source fixture/u).textContent();
    if (!sourceText) throw new Error("Expected the displayed source excerpt");
    // Ordinary locator queries can miss every candidate and hide this bug.
    // Use only the unchanged displayed excerpt for a high-similarity control.
    const topic = `CHN non-road ${tokenizeKnowledgeText(sourceText.split("中国")[0]!)
      .filter((term) => term !== "or").join(" ")}`;
    for (const [index, locator] of (english
      ? ["page 2 section 2", "page 1 section 1"]
      : ["第 2 页 第 2 节", "第 1 页 第 1 节"]).entries()) {
      await textbox.fill(request(`${topic} ${locator}`));
      await send.click();
      await expect(cards).toHaveCount(index + 2);
      const card = cards.last();
      await card.locator("summary").click();
      // Retrieval succeeded in both cases, but only page/section 1 exists.
      await expect(card).toContainText("Searchable fictional source fixture");
      await expect(card).toContainText(english ? "Page 1" : "第 1 页");
      if (index === 0) {
        await expect(answer).toContainText(gap);
      } else {
        await expect(answer).toContainText(english ? "Traceable document evidence was searched." : "已检索可追溯文档证据");
        await expect(answer).not.toContainText(gap);
      }
    }
  });

  test(`portfolio demo preserves signed source operands and clarifies OR refinements in ${locale}`, async ({ context, page }) => {
    if (locale === "en") await context.clearCookies();
    const english = locale === "en";
    await page.goto("/chat");
    const assistant = page.getByRole("complementary", { name: english ? "AI sales analysis assistant" : "AI 营销分析助手" });
    const textbox = assistant.getByRole("textbox", { name: english ? "Enter a question" : "输入问题" });
    const send = assistant.getByRole("button", { name: english ? "Send question" : "发送问题" });
    const cards = assistant.getByRole("region", { name: english ? "Knowledge-base evidence" : "知识库证据", exact: true });
    const answer = assistant.getByTestId("assistant-markdown").last();
    const conditions = assistant.getByLabel(english ? "Knowledge-base evidence query conditions" : "知识库证据查询条件", { exact: true }).last();
    const gap = english ? "This request lacks enough evidence" : "这次请求没有足够证据";
    const sourceRequest = (operands: string) => english
      ? `Retrieve CHN non-road emissions regulations original text sections source evidence ${operands} as of 2026-08-20.`
      : `检索 CHN 非道路排放法规原文、章节和来源证据 ${operands}，截至 2026-08-20。`;

    await textbox.fill(sourceRequest("-CHN"));
    await send.click();
    await expect(cards).toHaveCount(1);
    await expect(answer).toContainText(gap);
    await expect(conditions).toContainText("-CHN");

    await textbox.fill(sourceRequest("-China -BRA"));
    await send.click();
    await expect(cards).toHaveCount(2);
    await expect(answer).toContainText(english ? "Traceable document evidence was searched." : "已检索可追溯文档证据");
    await expect(conditions).toContainText("-China -BRA");
    await expect(conditions).toContainText(english ? "Aug 20, 2026" : "2026年8月20日");

    await textbox.fill(english ? "Continue -China,as of 2026-08-21." : "继续 -China，截至 2026-08-21。");
    await send.click();
    await expect(cards).toHaveCount(3);
    await expect(answer).toContainText(english ? "Traceable document evidence was searched." : "已检索可追溯文档证据");
    await expect(conditions).toContainText(english ? "Aug 21, 2026" : "2026年8月21日");
    await expect(conditions).not.toContainText(english ? "-China,as" : "-China，截至");

    await textbox.fill(english ? "Continue -fictional,as of 2026-08-22." : "继续 -fictional，截至 2026-08-22。");
    await send.click();
    await expect(cards).toHaveCount(4);
    await expect(answer).toContainText(gap);
    await expect(conditions).toContainText("-China -BRA");
    await expect(conditions).toContainText("-fictional");
    await expect(conditions).toContainText(english ? "Aug 22, 2026" : "2026年8月22日");
    await expect(conditions).not.toContainText(english ? "-fictional,as" : "-fictional，截至");

    await textbox.fill(english
      ? "Continue -fictional,as of 2026-08-23.warranties."
      : "继续 -fictional，截至 2026-08-23。保修");
    await send.click();
    await expect(answer).toContainText(english ? "restate the complete source query" : "重新写出完整来源查询");
    await expect(cards).toHaveCount(4);

    // Use an exact phrase from the unchanged source as the positive OR
    // control. The concatenated Chinese topic is not a native simple lexeme
    // match; the repository test separately proves OR warranty has no hit.
    await textbox.fill(sourceRequest('-China -BRA OR "fictional source"'));
    await send.click();
    await expect(cards).toHaveCount(5);
    await expect(answer).toContainText(english ? "Traceable document evidence was searched." : "已检索可追溯文档证据");
    await textbox.fill(english ? "Continue -fictional." : "继续 -fictional。");
    await send.click();
    await expect(answer).toContainText(english ? "restate the complete source query" : "重新写出完整来源查询");
    await expect(cards).toHaveCount(5);

    await textbox.fill(sourceRequest('-fictional OR "fictional source" -fictional'));
    await send.click();
    await expect(cards).toHaveCount(6);
    await expect(answer).toContainText(gap);
    await expect(conditions).toContainText('-fictional OR "fictional source" -fictional');
  });

  test(`portfolio demo preserves source-query literals instead of manufacturing a match in ${locale}`, async ({ context, page }) => {
    if (locale === "en") await context.clearCookies();
    const english = locale === "en";
    await page.goto("/chat");
    const assistant = page.getByRole("complementary", { name: english ? "AI sales analysis assistant" : "AI 营销分析助手" });
    const textbox = assistant.getByRole("textbox", { name: english ? "Enter a question" : "输入问题" });
    const send = assistant.getByRole("button", { name: english ? "Send question" : "发送问题" });
    const cards = assistant.getByRole("region", { name: english ? "Knowledge-base evidence" : "知识库证据", exact: true });
    const answer = assistant.getByTestId("assistant-markdown").last();
    const conditions = assistant.getByLabel(english ? "Knowledge-base evidence query conditions" : "知识库证据查询条件", { exact: true }).last();
    const gap = english ? "This request lacks enough evidence" : "这次请求没有足够证据";
    const sourceRequest = (literal: string) => english
      ? `Retrieve CHN non-road emissions regulations original text sections source evidence ${literal} as of 2026-08-20.`
      : `检索 CHN 非道路排放法规原文、章节和来源证据 ${literal}，截至 2026-08-20。`;
    await textbox.fill(sourceRequest('"China non-road"'));
    await send.click();
    await expect(cards).toHaveCount(1);
    await expect(answer).toContainText(gap);
    await expect(conditions).toContainText('"China non-road"');
    await expect(conditions).toContainText(english ? "Aug 20, 2026" : "2026年8月20日");

    // This is a new explicit user query, not a silent alias rewrite. The
    // existing fictional fixture contains this exact country spelling.
    await textbox.fill(sourceRequest('"CHN non-road"'));
    await send.click();
    await expect(cards).toHaveCount(2);
    await expect(answer).toContainText(english ? "Traceable document evidence was searched." : "已检索可追溯文档证据");
    await expect(answer).not.toContainText(gap);
    await expect(conditions).toContainText('"CHN non-road"');

    await textbox.fill(english ? "Now BRA." : "现在查 BRA。");
    await send.click();
    await expect(cards).toHaveCount(3);
    await expect(answer).toContainText(gap);
    await expect(conditions).toContainText("BRA");
    await expect(conditions).toContainText('"CHN non-road"');
  });

  test(`portfolio demo retains source requests through corrections and prohibited transitions in ${locale}`, async ({ context, page }) => {
    if (locale === "en") await context.clearCookies();
    const english = locale === "en";
    await page.goto("/chat");
    const assistant = page.getByRole("complementary", { name: english ? "AI sales analysis assistant" : "AI 营销分析助手" });
    const textbox = assistant.getByRole("textbox", { name: english ? "Enter a question" : "输入问题" });
    const send = assistant.getByRole("button", { name: english ? "Send question" : "发送问题" });
    const cards = assistant.getByRole("region", { name: english ? "Knowledge-base evidence" : "知识库证据", exact: true });
    const answer = assistant.getByTestId("assistant-markdown").last();
    const gap = english ? "This request lacks enough evidence" : "这次请求没有足够证据";
    await textbox.fill(english
      ? "Retrieve China marine emissions regulations original text sections source evidence as of 2026-08-20."
      : "检索中国船用排放法规原文、章节和来源证据，截至 2026-08-20。");
    await send.click();
    await expect(cards).toHaveCount(1);
    await expect(answer).toContainText(gap);

    for (const [index, question] of (english
      ? ["Actually use non-road.", "Do not switch from non-road to marine."]
      : ["改为非道路。", "不要从非道路改为船用。"]
    ).entries()) {
      await textbox.fill(question);
      await send.click();
      await expect(cards).toHaveCount(index + 2);
      await expect(answer).toContainText(english ? "Traceable document evidence was searched." : "已检索可追溯文档证据");
      await expect(answer).not.toContainText(gap);
      const conditions = assistant.getByLabel(english ? "Knowledge-base evidence query conditions" : "知识库证据查询条件", { exact: true }).last();
      await expect(conditions).toContainText(english ? "Non-road" : "非道路");
      await expect(conditions).toContainText(english ? "emissions regulations original text sections" : "排放法规原文、章节");
      await expect(conditions).toContainText(english ? "Aug 20, 2026" : "2026年8月20日");
    }

    await textbox.fill(english ? "Now BRA." : "现在查 BRA。");
    await send.click();
    await expect(cards).toHaveCount(4);
    await expect(answer).toContainText(gap);
    const conditions = assistant.getByLabel(english ? "Knowledge-base evidence query conditions" : "知识库证据查询条件", { exact: true }).last();
    await expect(conditions).toContainText("BRA");
    await expect(conditions).toContainText(english ? "Non-road" : "非道路");
    await expect(conditions).toContainText(english ? "emissions regulations original text sections" : "排放法规原文、章节");
  });

  test(`portfolio demo clarifies incompatible scopes and preserves filters after correction in ${locale}`, async ({ context, page }) => {
    if (locale === "en") await context.clearCookies();
    await page.goto("/chat");
    const english = locale === "en";
    const assistant = page.getByRole("complementary", { name: english ? "AI sales analysis assistant" : "AI 营销分析助手" });
    const textbox = assistant.getByRole("textbox", { name: english ? "Enter a question" : "输入问题" });
    const send = assistant.getByRole("button", { name: english ? "Send question" : "发送问题" });
    await textbox.fill(english
      ? "Check CHN marine and non-road regulations at 100 kW as of 2026-08-20."
      : "查询 CHN 船用和非道路 100 kW 法规，日期 2026-08-20。");
    await send.click();
    await expect(assistant).toContainText(english ? "one application scope" : "一个应用场景");
    const cards = assistant.getByRole("region", { name: english ? "Database regulation comparison" : "数据库法规比较", exact: true });
    await expect(cards).toHaveCount(0);
    await textbox.fill(english ? "Actually use non-road, not marine." : "改为非道路，不是船用。");
    await send.click();
    await expect(cards).toHaveCount(1);
    const query = assistant.getByLabel(english ? "Database regulation comparison query conditions" : "数据库法规比较查询条件", { exact: true });
    await expect(query).toContainText("CHN");
    await expect(query).toContainText("100 kW");
    await expect(query).toContainText(english ? "Non-road" : "非道路");
    await expect(query).toContainText(english ? "Aug 20, 2026" : "2026年8月20日");
    await expect(assistant).not.toContainText(english ? "This request lacks enough evidence" : "这次请求没有足够证据");
  });
}

for (const example of [
  {
    locale: "en",
    assistant: "AI sales analysis assistant",
    textbox: "Enter a question",
    send: "Send question",
    card: "Database regulation comparison",
    query: "Database regulation comparison query conditions",
    date: "Aug 13, 2026",
    scope: "Non-road",
    prompt:
      "Check FJI non-road regulations for 100 kW as of 2026-08-13. Do not extrapolate if evidence is missing.",
    gap: "This request lacks enough evidence for an affirmative regulatory, market, or product conclusion.",
    invalid: "At least one query or parameter validation failed",
  },
  {
    locale: "zh-CN",
    assistant: "AI 营销分析助手",
    textbox: "输入问题",
    send: "发送问题",
    card: "数据库法规比较",
    query: "数据库法规比较查询条件",
    date: "2026年8月13日",
    scope: "非道路",
    prompt: "查询 FJI 在 2026-08-13 的 non-road 100 kW 法规，证据不足时不要推断。",
    gap: "这次请求没有足够证据，暂时不能给出肯定的法规、市场或产品结论。",
    invalid: "参数校验失败",
  },
] as const) {
  test(`portfolio demo renders a scoped FJI no-data card in ${example.locale}`, async ({
    context,
    page,
  }) => {
    if (example.locale === "en") await context.clearCookies();
    await page.goto("/chat");
    const assistant = page.getByRole("complementary", { name: example.assistant });
    await assistant.getByRole("textbox", { name: example.textbox }).fill(example.prompt);
    await assistant.getByRole("button", { name: example.send }).click();
    const card = assistant.getByRole("region", { name: example.card, exact: true });
    await expect(card).toBeVisible();
    await expect(card).toContainText("FJI");
    const query = assistant.getByLabel(example.query, { exact: true });
    await expect(query).toContainText("FJI");
    await expect(query).toContainText("100 kW");
    await expect(query).toContainText(example.scope);
    await expect(query).toContainText(example.date);
    await expect(assistant).toContainText(example.gap);
    await expect(assistant).not.toContainText(example.invalid);
  });
}

test("portfolio demo keeps an explicitly named product scoped to one result", async ({
  page,
}) => {
  await page.goto(
    "/chat?countryIso3=CHN&applicationScope=non-road&powerKw=100&asOf=2026-08-12&productModelCode=DEMO-ENG-200",
  );

  const assistant = page.getByRole("complementary", {
    name: "AI 营销分析助手",
  });
  await assistant.getByRole("button", { name: "发送问题" }).click();

  const conversation = assistant.getByRole("region", {
    name: "AI 对话记录",
  });
  const card = conversation.getByRole("region", {
    name: "确定性产品适配",
  });
  await expect(
    card.getByText("仅限 Demo — 虚构发动机 200", { exact: true }),
  ).toBeVisible();
  await card.locator("summary").click();
  await expect(
    card.getByText("DEMO ONLY — Fictional Engine 200", { exact: true }),
  ).toBeVisible();
  const sources = card.locator("details");
  await expect(sources).toContainText(
    "DEMO-ENG-200 · 产品供应期：2025年1月1日 → 2030年1月1日",
  );
  await expect(sources).not.toContainText("availability");
  await expect(sources).not.toContainText("unknown–");
  await expect(sources).not.toContainText("–open");
  await expect(conversation).not.toContainText("虚构发动机 100");
  await expect(conversation).toContainText("不可用于报价、认证声明或销售承诺");
  const query = assistant.getByLabel("确定性产品适配查询条件");
  await expect(query).toContainText("CHN");
  await expect(query).toContainText("非道路");
  await expect(query).toContainText("100 kW");
  await expect(query).toContainText("2026年8月12日");
  await expect(query).toContainText("DEMO-ENG-200");
});

test("portfolio demo localizes regulation-comparison country headings in Chinese", async ({
  page,
}) => {
  await page.goto("/chat");

  const assistant = page.getByRole("complementary", {
    name: "AI 营销分析助手",
  });
  await assistant
    .getByRole("textbox", { name: "输入问题" })
    .fill("比较 CHN 和 BRA 在 2026-08-12 的 non-road 100 kW 法规。");
  await assistant.getByRole("button", { name: "发送问题" }).click();

  const card = assistant.getByRole("region", {
    name: "数据库法规比较",
  });
  await expect(card).toContainText("CHN · 中国（演示数据）");
  await expect(card).toContainText("BRA · 巴西（演示数据）");
  await expect(card).toContainText("仅限 Demo — 虚构中国非道路阶段 A");
  await expect(card).toContainText("仅限 Demo — 虚构巴西非道路阶段 A");
  await expect(card).toContainText(
    "仅限 Demo — 中国（演示数据）的虚构排放主管机构（DEMO-CHN-AUTHORITY）",
  );
  await expect(card).toContainText(
    "仅限 Demo — 巴西（演示数据）的虚构排放主管机构（DEMO-BRA-AUTHORITY）",
  );
  await expect(card).not.toContainText("China — demo fixture");
  await expect(card).not.toContainText("Brazil — demo fixture");
  const originalChinaRegulation = card.getByText(
    "DEMO ONLY — Fictional China Non-road Stage A",
    { exact: true },
  );
  const originalBrazilRegulation = card.getByText(
    "DEMO ONLY — Fictional Brazil Non-road Stage A",
    { exact: true },
  );
  await expect(originalChinaRegulation).toBeHidden();
  await expect(originalBrazilRegulation).toBeHidden();
  await card.locator("summary").click();
  await expect(card).toContainText("DEMO ONLY — Fictional emissions bulletin");
  await expect(originalChinaRegulation).toBeVisible();
  await expect(originalBrazilRegulation).toBeVisible();
});

test("portfolio demo localizes a Demo market metric but preserves its source title", async ({
  page,
}) => {
  await page.goto("/chat");

  const assistant = page.getByRole("complementary", {
    name: "AI 营销分析助手",
  });
  await assistant
    .getByRole("textbox", { name: "输入问题" })
    .fill("比较 CHN 和 BRA 的市场指标。");
  await assistant.getByRole("button", { name: "发送问题" }).click();

  const card = assistant.getByRole("region", {
    name: "结构化市场比较",
  });
  await expect(card).toContainText("仅限 Demo — 虚构年度可触达台数");
  await expect(card).not.toContainText(
    "DEMO ONLY — Fictional addressable units",
  );
  await card.locator("summary").click();
  await expect(card).toContainText("DEMO ONLY — Fictional market report");
  await expect(card).not.toContainText(
    "DEMO ONLY — Fictional addressable units",
  );
});

test("portfolio demo preserves mixed-language knowledge evidence across locales", async ({
  page,
}) => {
  await page.goto("/chat");

  const assistant = page.getByRole("complementary", {
    name: "AI 营销分析助手",
  });
  await assistant
    .getByRole("textbox", { name: "输入问题" })
    .fill(
      "查 CHN non-road emissions regulation 的 original text、section、citation；中国非道路排放法规原文、章节和来源证据。",
    );
  await assistant.getByRole("button", { name: "发送问题" }).click();

  const chineseCard = assistant.getByRole("region", {
    name: "知识库证据",
  });
  const originalTitle = "DEMO ONLY — Fictional regulation document";
  const excerptMarker = "Searchable fictional source fixture";
  await chineseCard.locator("summary").click();
  await expect(
    chineseCard.getByText(originalTitle, { exact: true }),
  ).toBeVisible();
  const chineseExcerpt = chineseCard.getByText(
    new RegExp(excerptMarker, "u"),
  );
  await expect(chineseExcerpt).toContainText("中国: 非道路排放法规");
  const originalExcerpt = await chineseExcerpt.textContent();
  expect(originalExcerpt).not.toBeNull();

  await page
    .getByTestId("locale-toggle")
    .getByRole("button", { name: "EN", exact: true })
    .click();

  const englishCard = page.getByRole("region", {
    name: "Knowledge-base evidence",
  });
  const englishDetails = englishCard.locator("details");
  if ((await englishDetails.getAttribute("open")) === null) {
    await englishDetails.locator("summary").click();
  }
  await expect(
    englishCard.getByText(originalTitle, { exact: true }),
  ).toBeVisible();
  await expect(
    englishCard.getByText(new RegExp(excerptMarker, "u")),
  ).toHaveText(originalExcerpt!);
});

for (const scopeSpelling of ["non-road", "nonroad", "non road"]) {
test(`portfolio demo retrieves English ${scopeSpelling} source terms and still refuses a nonexistent term`, async ({
  context,
  page,
}) => {
  await context.clearCookies();
  await page.goto("/chat");
  const assistant = page.getByRole("complementary", {
    name: "AI sales analysis assistant",
  });
  const textbox = assistant.getByRole("textbox", { name: "Enter a question" });
  const send = assistant.getByRole("button", { name: "Send question" });
  await textbox.fill(
    `CHN ${scopeSpelling} emissions regulations original text sections source evidence`,
  );
  await send.click();
  const card = assistant.getByRole("region", {
    name: "Knowledge-base evidence", exact: true,
  }).last();
  await expect(card).toBeVisible();
  await card.locator("summary").click();
  await expect(card.getByText("DEMO ONLY — Fictional regulation document", { exact: true })).toBeVisible();
  await expect(card).toContainText("Searchable fictional source fixture");
  await expect(card).toContainText("中国: 非道路排放法规");
  // Public citation copy uses the page locator when both page and section
  // metadata exist; the service regression separately binds the raw section.
  await expect(card).toContainText("Page 1");
  await expect(assistant).toContainText("Traceable document evidence was searched.");
  await expect(assistant).not.toContainText("This request lacks enough evidence");
  await expect(assistant.getByLabel("Knowledge-base evidence query conditions", { exact: true })).toContainText("Non-road");

  // Use the displayed, existing fixture text to form a high-similarity query.
  // Its excluded term must disqualify that same document before vector ranking.
  const sourceText = await card.getByText(/Searchable fictional source fixture/u).textContent();
  if (!sourceText) throw new Error("Expected the displayed source excerpt");
  const retainedTerms = tokenizeKnowledgeText(sourceText)
    .filter((token) => token !== "fictional" && token !== "or").join(" ");
  await textbox.fill(`${retainedTerms} -fictional`);
  await send.click();
  await expect(assistant.getByTestId("assistant-markdown").last()).toContainText(
    "This request lacks enough evidence for an affirmative regulatory, market, or product conclusion.",
  );

  await textbox.fill(
    "CHN non-road ZZZ_QUANTUM_BANANA_98765 original text source evidence",
  );
  await send.click();
  await expect(assistant.getByTestId("assistant-markdown").last()).toContainText(
    "This request lacks enough evidence for an affirmative regulatory, market, or product conclusion.",
  );
});
}

test("portfolio demo rebuilds Chinese score and brief copy from structured state", async ({
  page,
}) => {
  await page.goto("/chat");

  const assistant = page.getByRole("complementary", {
    name: "AI 营销分析助手",
  });
  const question = assistant.getByRole("textbox", { name: "输入问题" });
  const send = assistant.getByRole("button", { name: "发送问题" });
  const conversation = assistant.getByRole("region", {
    name: "AI 对话记录",
  });

  await question.fill(
    "计算 CHN 和 BRA 在 2026-08-12 的 non-road 100 kW 机会评分。",
  );
  await send.click();
  const scoreCard = conversation.getByRole("region", {
    name: "确定性机会评分",
  });
  await expect(scoreCard).toContainText("市场潜力");
  await expect(scoreCard).toContainText(
    "市场潜力 基于类型化证据投影得到确定性评分 100/100。",
  );
  await expect(scoreCard).toContainText(
    "产品准备度 因类型化证据投影不足，未生成确定性评分。",
  );
  // The public score DTO has no authoritative fact-count field. Do not
  // manufacture a count from nested presentation records.
  await expect(scoreCard).not.toContainText("已验证输入事实");
  await expect(scoreCard).not.toContainText("输入：");
  await expect(scoreCard).not.toContainText("产品准备度=");
  await expect(scoreCard).not.toContainText("法规检查=");
  await expect(scoreCard).not.toContainText("组内归一化=");

  await question.fill(
    "为 CHN 和 BRA 生成 DEMO-ENG-100 在 non-road 100 kW 的销售简报，日期 2026-08-12。",
  );
  await send.click();

  const card = conversation.getByRole("region", {
    name: "结构化销售简报",
  });
  await expect(card).toContainText("CHN 在 opportunity-score-v2 下");
  await expect(card).toContainText(/风险 1：确定性风险关联 \d+ 条证据记录/u);
  await expect(card).toContainText(/行动 1（(?:高|中|低)优先级）/u);
  await expect(card).toContainText(
    "DEMO-ENG-100 · 仅限 Demo — 虚构发动机 100",
  );
  await expect(card).not.toContainText("结构化市场指标相对占优");
  await expect(card).not.toContainText("产品证据缺口");
  await expect(card).not.toContainText("建议文本由固定规则生成");
  await expect(card).not.toContainText("补齐 missingData");
  await expect(conversation).toContainText("结构化简报识别到");
  await expect(conversation).toContainText("项规则生成行动");
  await card.locator("summary").click();
  await expect(
    card.getByText("DEMO ONLY — Fictional Engine 100", { exact: true }).first(),
  ).toBeVisible();
});

test("portfolio demo localizes product-fit chrome, safety gaps, and fixed answer in English", async ({
  context,
  page,
}) => {
  await context.clearCookies();
  await page.goto(
    "/chat?countryIso3=CHN&applicationScope=non-road&powerKw=100&asOf=2026-08-12&productModelCode=DEMO-ENG-200",
  );

  const assistant = page.getByRole("complementary", {
    name: "AI sales analysis assistant",
  });
  await assistant.getByRole("button", { name: "Send question" }).click();

  const conversation = assistant.getByRole("region", {
    name: "AI conversation",
  });
  const card = conversation.getByRole("region", {
    name: "Deterministic product fit",
  });
  const query = assistant.getByLabel(
    "Deterministic product fit query conditions",
  );

  await expect(card).toContainText("DEMO ONLY — Fictional Engine 200");
  await expect(card).toContainText("Unknown / insufficient evidence");
  await expect(card).toContainText("Regulation/certification fit");
  await expect(card).toContainText("Commercial readiness");
  await expect(card).toContainText("Availability on query date");
  await expect(card).toContainText("Product availability period");
  await expect(card).toContainText("No traceable certification record");
  await expect(card).toContainText("There is not enough evidence");
  await expect(card).toContainText("fictional demo evidence");
  await expect(query).toContainText("Aug 12, 2026");

  await expect(card).not.toContainText("证据不足");
  await expect(card).not.toContainText("法规/认证适配");
  await expect(card).not.toContainText("商业准备度");
  await expect(card).not.toContainText("查询日供应状态");
  await expect(card).not.toContainText("供应期");
  await expect(card).not.toContainText("未找到产品与该法规之间的认证记录");
  await expect(card).not.toContainText("的成员关系");
  await expect(card).not.toContainText("适用限值");

  await expect(conversation).toContainText(
    "This request lacks enough evidence for an affirmative regulatory, market, or product conclusion.",
  );
  await expect(conversation).toContainText("Next steps:");
  await expect(assistant.getByTestId("assistant-markdown").last()).toContainText(
    "CHN lacks sufficient evidence for a conclusive product-fit decision for Non-road, 100 kW, as of Aug 12, 2026.",
  );
  await expect(conversation).not.toContainText("has no deterministic fit result");
  await expect(conversation).toContainText(
    "For information only; not a substitute for formal certification or legal advice.",
  );
  await expect(conversation).not.toContainText("Next steps：");
});

test("portfolio demo keeps opportunity-score and sales-brief cards English", async ({
  context,
  page,
}) => {
  await context.clearCookies();
  await page.goto("/chat");

  const assistant = page.getByRole("complementary", {
    name: "AI sales analysis assistant",
  });
  const question = assistant.getByRole("textbox", {
    name: "Enter a question",
  });
  const send = assistant.getByRole("button", { name: "Send question" });
  const conversation = assistant.getByRole("region", {
    name: "AI conversation",
  });

  await question.fill(
    "Calculate an opportunity score for CHN and BRA for non-road 100 kW as of 2026-08-12.",
  );
  await send.click();
  const scoreCard = conversation.getByRole("region", {
    name: "Deterministic opportunity score",
  });
  await expect(scoreCard).toContainText("Market potential");
  await expect(scoreCard).toContainText(/has (?:a|no) deterministic score/u);
  await expect(scoreCard).not.toContainText("市场指标缺失");
  await expect(scoreCard).not.toContainText("产品准备度=");
  await expect(scoreCard).not.toContainText("法规检查=");

  await question.fill(
    "Generate a non-road 100 kW sales brief for CHN and BRA, target market BRA, as of 2026-08-12.",
  );
  await send.click();
  const briefCard = conversation.getByRole("region", {
    name: "Structured sales brief",
  });
  await expect(briefCard).toContainText("BRA has");
  await expect(briefCard).toContainText("rule-generated action(s)");
  await expect(briefCard).not.toContainText("结构化市场指标相对占优");
  await expect(briefCard).not.toContainText("产品证据缺口");
  await expect(briefCard).not.toContainText("建议文本由固定规则生成");
  await expect(briefCard).not.toContainText("补齐 missingData");
});
