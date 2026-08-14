import { Buffer } from "node:buffer";

import { expect, test } from "@playwright/test";

import {
  correctedFdeMarketCsv,
  invalidFdeMarketCsv,
} from "../scripts/demo/fde-fixtures";

function csvFile(contents: string, name: string) {
  return {
    buffer: Buffer.from(contents, "utf8"),
    mimeType: "text/csv",
    name,
  };
}

test("runs the fictional CSV governance lifecycle and restores the query", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "fde-demo-desktop");
  test.setTimeout(120_000);

  await page.goto("/admin");
  await expect(page.getByTestId("fde-demo-banner")).toContainText(
    "LOCAL / MUTABLE / FICTIONAL",
  );
  await expect(page.getByText("editor@fde-demo.local")).toBeVisible();

  const csvInput = page.getByLabel("CSV 文件");
  await csvInput.setInputFiles(csvFile(invalidFdeMarketCsv, "invalid.csv"));
  await page.getByRole("button", { name: "预览并校验" }).click();
  await expect(page.getByText(/^第 2 行 valueNumeric：/u)).toBeVisible();
  await expect(page.getByText(/^第 2 行 periodEnd：/u)).toBeVisible();

  await csvInput.setInputFiles(
    csvFile(correctedFdeMarketCsv, "corrected.csv"),
  );
  await page.getByRole("button", { name: "预览并校验" }).click();
  await expect(page.getByText("总行数 1 · 有效 1 · 错误 0")).toBeVisible();
  await page.getByRole("button", { name: "确认批次" }).click();
  await expect(page.getByText("已原子创建 1 条草稿，尚未发布。")).toBeVisible();

  const metricId = await page.evaluate(async () => {
    const response = await fetch("/api/admin/dashboard", {
      cache: "no-store",
    });
    const dashboard = (await response.json()) as {
      drafts?: Array<{
        entityKey: string;
        payload?: { metricCode?: string };
      }>;
    };
    return dashboard.drafts?.find(
      ({ payload }) => payload?.metricCode === "FDE_DEMO_PIPELINE_INDEX",
    )?.entityKey;
  });
  expect(metricId).toBeTruthy();

  await page.getByRole("link", { name: "切换 reviewer" }).click();
  await expect(page.getByText("reviewer@fde-demo.local")).toBeVisible();
  await page.getByText(/查看 v1 payload、发布差异与依赖/).click();
  await page.getByLabel("审核理由").fill("已核对虚构来源、期间和值字段。");
  await page.getByRole("button", { name: "提交审核确认" }).click();
  await expect(page.getByText("草稿已审核。")).toBeVisible();

  const publishReason = page.getByLabel("发布理由");
  if (!(await publishReason.isVisible())) {
    await page.getByText(/查看 v1 payload、发布差异与依赖/).click();
  }
  await publishReason.fill("确认依赖完整，仅用于本地演示。");
  await page
    .getByLabel(/我已核对完整 payload/)
    .check();
  await page.getByRole("button", { name: "确认发布版本" }).click();
  await expect(page.getByText("版本已发布。")).toBeVisible();

  const queryUrl =
    "/countries/CHN?applicationScope=non-road&asOf=2026-08-15&powerKw=100";
  await page.goto(queryUrl);
  await expect(page.getByText("DEMO ONLY — FDE pipeline index")).toBeVisible();
  await expect(page.getByText(/73.5 index/)).toBeVisible();

  await page.goto("/__fde/persona?role=admin");
  await expect(page.getByText("admin@fde-demo.local")).toBeVisible();
  await page.getByLabel("实体类型").selectOption("market_metric");
  await page.getByLabel("实体 Key（ISO3 或 UUID）").fill(metricId!);
  await page.getByLabel("归档原因").fill("结束本地 FDE 演示并恢复查询。");
  await page.getByRole("button", { name: "确认软归档" }).click();
  await expect(page.getByText(/实体已软归档/)).toBeVisible();

  await page.goto(queryUrl);
  await expect(page.getByText("DEMO ONLY — FDE pipeline index")).toHaveCount(0);
});

test("supports persona switching and CSV field errors on mobile", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "fde-demo-mobile");

  await page.goto("/admin");
  await expect(page.getByTestId("fde-demo-banner")).toBeVisible();
  await page.getByRole("link", { name: "切换 reviewer" }).click();
  await expect(page.getByText("reviewer@fde-demo.local")).toBeVisible();
  await page.getByRole("link", { name: "切换 editor" }).click();
  await page
    .getByLabel("CSV 文件")
    .setInputFiles(csvFile(invalidFdeMarketCsv, "invalid-mobile.csv"));
  await page.getByRole("button", { name: "预览并校验" }).click();
  await expect(page.getByText(/^第 2 行 valueNumeric：/u)).toBeVisible();
  await expect(page.getByText(/^第 2 行 periodEnd：/u)).toBeVisible();
});
