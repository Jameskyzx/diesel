import { expect, test } from "@playwright/test";

test.beforeEach(async ({ baseURL, context }) => {
  await context.addCookies([
    {
      name: "diesel_locale",
      url: baseURL ?? "http://127.0.0.1:3200",
      value: "zh-CN",
    },
  ]);
});

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
  await expect(conversation).toContainText("DEMO ONLY — Fictional Engine 200");
  await expect(conversation).not.toContainText("Fictional Engine 100");
  await expect(conversation).toContainText("不可用于报价、认证声明或销售承诺");
  const query = assistant.getByLabel("确定性产品适配查询条件");
  await expect(query).toContainText("CHN");
  await expect(query).toContainText("non-road");
  await expect(query).toContainText("100 kW");
  await expect(query).toContainText("2026年8月12日");
  await expect(query).toContainText("DEMO-ENG-200");
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
