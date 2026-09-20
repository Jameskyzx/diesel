import { expect, test } from "@playwright/test";

import { documentImportResponseSchema } from "../src/features/knowledge/schemas";

test("does not render malformed knowledge API responses", async ({ page }) => {
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
}) => {
  // Next's development server compiles POST-only route modules lazily. Warm
  // them before the stateful browser flow so their first compile cannot force
  // a Fast Refresh after the form has already stored transient feedback.
  for (const path of [
    "/api/dev/knowledge/documents",
    "/api/dev/knowledge/search",
  ]) {
    const response = await request.get(path);
    expect(response.status()).toBe(405);
  }

  let knowledgePageNavigations = 0;
  page.on("framenavigated", (frame) => {
    if (
      frame === page.mainFrame() &&
      new URL(frame.url()).pathname === "/dev/knowledge"
    ) {
      knowledgePageNavigations += 1;
    }
  });

  await page.goto("/dev/knowledge");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "知识库导入与混合检索调试",
    }),
  ).toBeVisible();
  expect(knowledgePageNavigations).toBeGreaterThanOrEqual(1);
  const stableNavigationCount = knowledgePageNavigations;

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
  const originalBytes = Buffer.from(
    [
      "\f\f",
      "# DEMO Emissions",
      "",
      "Non-road emissions certification applies to this fictional engine.",
      "",
      "## Power",
      "",
      "The fictional power requirement is documented for testing only.",
    ].join("\n"),
  );
  await importSection.getByLabel("原始文件").setInputFiles({
    buffer: originalBytes,
    mimeType: "text/markdown",
    name: "demo-e2e-regulation.md",
  });

  await importSection
    .getByRole("button", { name: "保存并处理文档" })
    .click();
  await expect(page.getByTestId("document-import-ready")).toBeVisible();
  await expect(page.getByText("可检索").first()).toBeVisible();
  expect(knowledgePageNavigations).toBe(stableNavigationCount);

  await importSection
    .getByRole("button", { name: "保存并处理文档" })
    .click();
  await expect(page.getByTestId("document-import-duplicate")).toBeVisible();
  await expect(page.getByText("检测到重复文档")).toBeVisible();
  expect(knowledgePageNavigations).toBe(stableNavigationCount);

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
  const sourceResult = results.getByRole("article").filter({
    hasText: "Non-road emissions certification applies to this fictional engine.",
  });
  await expect(sourceResult).toHaveCount(1);
  await expect(sourceResult.getByText(
    "DEMO ONLY — E2E regulation > DEMO Emissions · paragraph 1",
    { exact: true },
  )).toBeVisible();
  await expect(sourceResult.locator("dl > div").filter({
    has: page.getByText("页码", { exact: true }),
  }).locator("dd")).toHaveText("3");
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
  expect(originalResponse.headers()["cache-control"]).toBe("private, no-store");
  expect(originalResponse.headers()["content-type"]).toBe("text/markdown");
  expect(originalResponse.headers()["content-disposition"]).toBe(
    "attachment; filename*=UTF-8''demo-e2e-regulation.md",
  );
  await expect(originalResponse.body()).resolves.toEqual(originalBytes);

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

  const oversizedHeadingSource = `# ${"H".repeat(3000)}\n\nDEMO ONLY — bounded output failure.`;
  await importSection.getByLabel("文档标题").fill("DEMO ONLY — Oversized heading");
  await importSection.getByLabel("原始文件").setInputFiles({
    buffer: Buffer.from(oversizedHeadingSource),
    mimeType: "text/markdown",
    name: "oversized-heading-demo.md",
  });
  const [limitResponse] = await Promise.all([
    page.waitForResponse((response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/dev/knowledge/documents"
    ),
    importSection.getByRole("button", { name: "保存并处理文档" }).click(),
  ]);
  expect(limitResponse.ok()).toBe(true);
  const limitedImport = documentImportResponseSchema.parse(await limitResponse.json());
  expect(limitedImport.status).toBe("failed");
  expect(limitedImport.document.processingStatus).toBe("failed");
  expect(limitedImport.document.chunkCount).toBe(0);
  await expect(failedImport.getByText(
    "文档标题路径超过 2048 个 UTF-16 单元的处理上限，请缩短标题或拆分文档。",
  )).toBeVisible();
  expect(limitedImport.document.downloadUrl).not.toBeNull();
  const preservedOriginal = await request.get(limitedImport.document.downloadUrl ?? "");
  expect(preservedOriginal.ok()).toBe(true);
  expect(await preservedOriginal.text()).toBe(oversizedHeadingSource);
  expect(knowledgePageNavigations).toBe(stableNavigationCount);

  const nulSource = "DEMO ONLY — original before\0after\n";
  await importSection.getByLabel("文档标题").fill("DEMO ONLY — NUL text");
  await importSection.getByLabel("原始文件").setInputFiles({
    buffer: Buffer.from(nulSource), mimeType: "text/plain", name: "nul-source-demo.txt",
  });
  const [nulResponse] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/dev/knowledge/documents"),
    importSection.getByRole("button", { name: "保存并处理文档" }).click(),
  ]);
  expect(nulResponse.ok()).toBe(true);
  const nulImport = documentImportResponseSchema.parse(await nulResponse.json());
  expect(nulImport).toMatchObject({ status: "failed", document: { processingStatus: "failed", chunkCount: 0 } });
  await expect(failedImport.getByText("UTF-8 文本包含空字符（U+0000），无法保存为文档正文；请核对源文件。")).toBeVisible();
  expect(nulImport.document.downloadUrl).not.toBeNull();
  const nulOriginal = await request.get(nulImport.document.downloadUrl ?? "");
  expect(nulOriginal.ok()).toBe(true);
  expect(await nulOriginal.body()).toEqual(Buffer.from(nulSource));
  expect(knowledgePageNavigations).toBe(stableNavigationCount);

  const invalidMetadata = await request.post("/api/dev/knowledge/documents", {
    multipart: {
      file: { buffer: Buffer.from("DEMO ONLY — rejected metadata before storage."), mimeType: "text/plain", name: "metadata-demo.txt" },
      title: "DEMO ONLY — invalid\0metadata", documentType: "other", languageCode: "en",
      sourceTitle: "DEMO ONLY — metadata source", sourceType: "demo", isDemo: "true",
      demoNotice: "FICTIONAL DEMO DATA — NOT FOR PRODUCTION.",
    },
  });
  expect(invalidMetadata.status()).toBe(400);
  expect(await invalidMetadata.json()).toMatchObject({ error: { code: "INVALID_INPUT" } });
});
