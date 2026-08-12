import { expect, test } from "@playwright/test";

const identityHeader = "oai-authenticated-user-email";

test("protects every management route with workspace identity and role checks", async ({
  request,
}) => {
  const unauthenticated = await request.get("/api/admin/dashboard");
  expect(unauthenticated.status()).toBe(401);

  const ordinaryUser = await request.get("/api/admin/dashboard", {
    headers: { [identityHeader]: "ordinary@example.test" },
  });
  expect(ordinaryUser.status()).toBe(403);

  const editorDashboard = await request.get("/api/admin/dashboard", {
    headers: { [identityHeader]: "editor@example.test" },
  });
  expect(editorDashboard.status()).toBe(200);

  const editorReviewAttempt = await request.post(
    "/api/admin/drafts/00000000-0000-4000-8000-000000000999/review",
    {
      data: { reason: "An editor must not review a draft." },
      headers: { [identityHeader]: "editor@example.test" },
    },
  );
  expect(editorReviewAttempt.status()).toBe(403);
});

test("hides the admin page from a non-allowlisted ordinary user", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({
    [identityHeader]: "ordinary@example.test",
  });
  await page.goto("/admin");

  await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "管理后台与发布审核" }),
  ).toHaveCount(0);
});

test("renders the governed workflows for an authorized admin", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({
    [identityHeader]: "admin@example.test",
  });
  await page.goto("/admin");

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "管理后台与发布审核",
    }),
  ).toBeVisible();
  await expect(page.getByText("admin@example.test")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "结构化数据修订" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "市场指标 CSV" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "文档上传与重新处理" }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "虚构 Demo 文档" }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "重新处理为虚构 Demo" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "来源最近核验时间" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "软归档已发布实体" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "数据变更记录" }),
  ).toBeVisible();
});

test("keeps the newest dashboard refresh when an older request finishes later", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({
    [identityHeader]: "admin@example.test",
  });

  let releaseFirstResponse = () => {};
  const firstResponseRelease = new Promise<void>((resolve) => {
    releaseFirstResponse = resolve;
  });
  let firstResponseReady = () => {};
  const firstResponseLoaded = new Promise<void>((resolve) => {
    firstResponseReady = resolve;
  });
  let firstRouteSettled = () => {};
  const firstRouteCompletion = new Promise<void>((resolve) => {
    firstRouteSettled = resolve;
  });
  let requestCount = 0;

  await page.route("**/api/admin/dashboard", async (route) => {
    requestCount += 1;
    if (requestCount !== 1) {
      const response = await route.fetch();
      await route.fulfill({ response });
      return;
    }

    try {
      const response = await route.fetch();
      const body = (await response.json()) as Record<string, unknown>;
      firstResponseReady();
      await firstResponseRelease;
      await route.fulfill({
        body: JSON.stringify({
          ...body,
          auditLogs: [
            {
              action: "STALE_TEST_ACTION",
              actorEmail: "admin@example.test",
              actorRole: "admin",
              createdAt: "2026-08-06T00:00:00.000Z",
              entityKey: "CHN",
              entityType: "country",
              id: "00000000-0000-4000-8000-000000000777",
              reason: "Delayed stale dashboard response.",
            },
          ],
          drafts: [],
          importBatches: [],
        }),
        contentType: "application/json",
        status: response.status(),
      });
    } catch {
      // The newer refresh cancels this browser request.
    } finally {
      firstRouteSettled();
    }
  });

  await page.goto("/admin");
  await firstResponseLoaded;
  await page.getByRole("button", { name: "刷新" }).click();
  await expect(page.getByTestId("admin-dashboard-loading")).toBeHidden();

  releaseFirstResponse();
  await firstRouteCompletion;
  await expect(page.getByText("STALE_TEST_ACTION")).toHaveCount(0);
});

test("does not report a completed write as failed when dashboard refresh fails", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({
    [identityHeader]: "admin@example.test",
  });

  let draftRequests = 0;
  let failDashboardRefresh = false;
  await page.route("**/api/admin/dashboard", async (route) => {
    if (!failDashboardRefresh) {
      await route.continue();
      return;
    }

    await route.fulfill({
      body: JSON.stringify({
        error: { message: "Synthetic refresh failure." },
      }),
      contentType: "application/json",
      status: 500,
    });
  });
  await page.route("**/api/admin/drafts", async (route) => {
    draftRequests += 1;
    await route.fulfill({
      body: JSON.stringify({ status: "draft" }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/admin");
  await expect(page.getByTestId("admin-dashboard-loading")).toBeHidden();
  failDashboardRefresh = true;
  await page.getByRole("button", { name: "保存 Draft" }).click();

  await expect(
    page.getByText("草稿已创建，正式查询仍使用当前已发布版本。"),
  ).toBeVisible();
  await expect(
    page.getByText(
      "操作已完成，但管理数据刷新失败：Synthetic refresh failure.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(draftRequests).toBe(1);
});

test("does not render a non-JSON management error body", async ({ page }) => {
  await page.setExtraHTTPHeaders({
    [identityHeader]: "admin@example.test",
  });
  const hydratedDashboardResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      response.url().includes("/api/admin/dashboard"),
  );
  await page.route("**/api/admin/drafts", async (route) => {
    await route.fulfill({
      body: "postgres://admin:secret@internal.example/database",
      contentType: "text/plain",
      status: 500,
    });
  });

  await page.goto("/admin");
  await hydratedDashboardResponse;
  await expect(page.getByTestId("admin-dashboard-loading")).toBeHidden();
  await page.getByRole("button", { name: "保存 Draft" }).click();

  await expect(page.getByText("管理操作失败。", { exact: true })).toBeVisible();
  await expect(page.getByText(/postgres:\/\//)).toHaveCount(0);
});

test("invalidates an old CSV preview before retrying or selecting another file", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({
    [identityHeader]: "admin@example.test",
  });
  let previewRequests = 0;
  await page.route("**/api/admin/imports/market/preview", async (route) => {
    previewRequests += 1;
    if (previewRequests > 1) {
      await route.fulfill({
        body: JSON.stringify({
          error: { message: "Synthetic preview failure." },
        }),
        contentType: "application/json",
        status: 500,
      });
      return;
    }

    await route.fulfill({
      body: JSON.stringify({
        batchId: "00000000-0000-4000-8000-000000000901",
        errors: [],
        invalidRows: 0,
        rows: [
          {
            parsed: { metricCode: "FIRST_FILE" },
            rowNumber: 2,
          },
        ],
        status: "previewed",
        totalRows: 1,
        validRows: 1,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/admin");
  const csvInput = page.getByLabel("CSV 文件");
  await csvInput.setInputFiles({
    buffer: Buffer.from("first"),
    mimeType: "text/csv",
    name: "first.csv",
  });
  await page.getByRole("button", { name: "预览并校验" }).click();
  await expect(page.getByRole("button", { name: "确认批次" })).toBeVisible();

  await page.getByRole("button", { name: "预览并校验" }).click();
  await expect(page.getByRole("button", { name: "确认批次" })).toBeHidden();
  await expect(
    page.getByText("Synthetic preview failure.", { exact: true }),
  ).toBeVisible();

  await csvInput.setInputFiles({
    buffer: Buffer.from("second"),
    mimeType: "text/csv",
    name: "second.csv",
  });

  await expect(page.getByRole("button", { name: "确认批次" })).toBeHidden();
  await expect(
    page.getByText("Synthetic preview failure.", { exact: true }),
  ).toBeHidden();
  await expect(
    page.getByText("CSV 只完成预览；尚未写入市场指标或草稿。"),
  ).toBeHidden();
});
