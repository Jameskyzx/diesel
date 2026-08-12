import { expect, test } from "@playwright/test";

test("does not render malformed knowledge API responses", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "The developer console error state is covered once in desktop Chromium.",
  );

  await page.route("**/api/dev/knowledge/options", async (route) => {
    await route.fulfill({
      body: "postgres://reader:secret@internal.example/database",
      contentType: "text/html",
      status: 500,
    });
  });
  await page.goto("/dev/knowledge");

  await expect(page.getByText("调试选项加载失败。")).toBeVisible();
  await expect(page.getByText(/reader:secret/)).toHaveCount(0);
});

test("imports, deduplicates, traces, filters, and reports failed documents", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "The developer console workflow is covered once in desktop Chromium.",
  );

  await page.goto("/dev/knowledge");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "知识库导入与混合检索调试",
    }),
  ).toBeVisible();

  const importSection = page.getByRole("region", { name: "文档导入" });
  await expect(importSection.getByLabel("国家")).toContainText("CHN");
  await importSection.getByLabel("文档标题").fill("DEMO ONLY — E2E regulation");
  await importSection.getByLabel("国家").selectOption("CHN");
  await importSection
    .getByLabel("管辖区域")
    .selectOption("00000000-0000-4000-8000-000000000101");
  await importSection.getByLabel("应用场景").selectOption("non-road");
  await importSection.getByLabel("有效期开始").fill("2025-01-01");
  await importSection.getByLabel("有效期结束").fill("2030-01-01");
  await importSection.getByLabel("原始文件").setInputFiles({
    buffer: Buffer.from(
      [
        "# DEMO Emissions",
        "",
        "Non-road emissions certification applies to this fictional engine.",
        "",
        "## Power",
        "",
        "The fictional power requirement is documented for testing only.",
      ].join("\n"),
    ),
    mimeType: "text/markdown",
    name: "demo-e2e-regulation.md",
  });

  await importSection
    .getByRole("button", { name: "保存并处理文档" })
    .click();
  await expect(page.getByTestId("document-import-ready")).toBeVisible();
  await expect(page.getByText("可检索").first()).toBeVisible();

  await importSection
    .getByRole("button", { name: "保存并处理文档" })
    .click();
  await expect(page.getByTestId("document-import-duplicate")).toBeVisible();
  await expect(page.getByText("检测到重复文档")).toBeVisible();

  const searchSection = page.getByRole("region", { name: "检索调试" });
  await searchSection
    .getByLabel("查询文本")
    .fill("non-road emissions certification");
  await searchSection.getByLabel("国家").selectOption("CHN");
  await searchSection
    .getByLabel("管辖区域")
    .selectOption("00000000-0000-4000-8000-000000000101");
  await searchSection.getByLabel("应用场景").selectOption("non-road");
  await searchSection.getByLabel("有效日期").fill("2026-07-29");
  await searchSection.getByRole("button", { name: "运行混合检索" }).click();

  const results = page.getByTestId("hybrid-search-results");
  await expect(results).toBeVisible();
  await expect(results.getByText("关键词得分").first()).toBeVisible();
  await expect(results.getByText("向量得分").first()).toBeVisible();
  await expect(results.getByText("最终排序").first()).toBeVisible();
  await expect(results.getByText(/DEMO Emissions/).first()).toBeVisible();
  await expect(
    results
      .getByText("文档来源：DEMO ONLY — Developer upload source")
      .first(),
  ).toBeVisible();

  const originalFileLink = results
    .getByRole("link", { name: "下载原始文件" })
    .first();
  const href = await originalFileLink.getAttribute("href");
  expect(href).not.toBeNull();
  const originalResponse = await request.get(href ?? "");
  expect(originalResponse.ok()).toBe(true);
  await expect(originalResponse.text()).resolves.toContain(
    "Non-road emissions certification",
  );

  await searchSection.getByLabel("国家").selectOption("BRA");
  await searchSection.getByRole("button", { name: "运行混合检索" }).click();
  await expect(
    page.getByText("当前查询和 metadata filter 没有命中结果。"),
  ).toBeVisible();

  await importSection.getByLabel("文档标题").fill("DEMO ONLY — Failed PDF");
  await importSection.getByLabel("原始文件").setInputFiles({
    buffer: Buffer.from("%PDF-DEMO-UNSUPPORTED"),
    mimeType: "application/pdf",
    name: "unsupported-demo.pdf",
  });
  await importSection
    .getByRole("button", { name: "保存并处理文档" })
    .click();
  const failedImport = page.getByTestId("document-import-failed");
  await expect(failedImport).toBeVisible();
  await expect(
    failedImport.getByText(
      "当前最小版本仅支持 UTF-8 TXT、MD 和 Markdown 文件。",
    ),
  ).toBeVisible();
});
