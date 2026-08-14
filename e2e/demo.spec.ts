import { expect, test } from "@playwright/test";

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
  await expect(query).toContainText("2026-08-12");
  await expect(query).toContainText("DEMO-ENG-200");
});
