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

test("rejects a direct API publish of v2 without a lower published baseline", async ({
  request,
}, testInfo) => {
  const isDesktop = testInfo.project.name === "desktop-chromium";
  const iso3 = isDesktop ? "JPN" : "KOR";
  const iso2 = isDesktop ? "JP" : "KR";
  const draftInput = {
    changeReason: "Exercise the fail-closed direct publish boundary.",
    entityType: "country",
    payload: {
      dataCoverageStatus: "demo",
      dataSourceId: "00000000-0000-4000-8000-000000000001",
      isDemo: true,
      iso2,
      iso3,
      nameEn: `DEMO ONLY — ${iso3} governance bootstrap`,
      nameLocal: null,
      regionCode: "DEMO",
      subregionCode: "DEMO",
      verifiedAt: "2026-07-29T00:00:00.000Z",
    },
  };
  const editorHeaders = {
    [identityHeader]: "editor@example.test",
  };
  const reviewerHeaders = {
    [identityHeader]: "reviewer@example.test",
  };

  const first = await request.post("/api/admin/drafts", {
    data: draftInput,
    headers: editorHeaders,
  });
  expect(first.status()).toBe(201);
  const second = await request.post("/api/admin/drafts", {
    data: {
      ...draftInput,
      changeReason: "Create v2 before v1 has been published.",
    },
    headers: editorHeaders,
  });
  expect(second.status()).toBe(201);
  const secondBody = (await second.json()) as {
    draft: { id: string; version: number };
  };
  expect(secondBody.draft.version).toBe(2);

  const review = await request.post(
    `/api/admin/drafts/${secondBody.draft.id}/review`,
    {
      data: { reason: "Review v2 before attempting the direct API bypass." },
      headers: reviewerHeaders,
    },
  );
  expect(review.status()).toBe(200);
  const publication = await request.post(
    `/api/admin/drafts/${secondBody.draft.id}/publish`,
    {
      data: { reason: "Attempt to bypass the disabled dashboard button." },
      headers: reviewerHeaders,
    },
  );

  expect(publication.status()).toBe(409);
  await expect(publication.json()).resolves.toMatchObject({
    error: {
      code: "CONFLICT",
      message: "Revision v2 requires a lower published governance baseline.",
    },
  });
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
  await expect(
    page.getByRole("group", { name: "上传新文档" }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "重新处理 Draft 文档" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("核验时间（ISO 8601，必须含时区）"),
  ).toHaveValue(/Z$/);
  await expect(page.getByText(/将保存为 UTC：/)).toBeVisible();
});

test("requires reviewers to inspect payload, diff, dependencies, and enter their own reason", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({
    [identityHeader]: "admin@example.test",
  });

  const sourceId = "00000000-0000-4000-8000-000000000991";
  const timestamp = "2026-08-15T00:00:00.000Z";
  const draftSummaries = [
    {
      archivedAt: null,
      changeReason: "Published country baseline.",
      createdAt: timestamp,
      createdBy: "editor@example.test",
      entityKey: "CHN",
      entityType: "country",
      id: "00000000-0000-4000-8000-000000000981",
      payload: {
        dataSourceId: sourceId,
        iso3: "CHN",
        nameEn: "Old country name",
      },
      publishedAt: timestamp,
      publishedBy: "reviewer@example.test",
      reviewedAt: timestamp,
      reviewedBy: "reviewer@example.test",
      updatedAt: timestamp,
      version: 1,
      workflowStatus: "published",
    },
    {
      archivedAt: null,
      changeReason: "Correct the country display name.",
      createdAt: timestamp,
      createdBy: "editor@example.test",
      entityKey: "CHN",
      entityType: "country",
      id: "00000000-0000-4000-8000-000000000982",
      payload: {
        dataSourceId: sourceId,
        iso3: "CHN",
        nameEn: "Reviewed country name",
      },
      publishedAt: null,
      publishedBy: null,
      reviewedAt: null,
      reviewedBy: null,
      updatedAt: timestamp,
      version: 2,
      workflowStatus: "draft",
    },
    {
      archivedAt: null,
      changeReason: "Published source baseline.",
      createdAt: timestamp,
      createdBy: "editor@example.test",
      entityKey: sourceId,
      entityType: "data_source",
      id: "00000000-0000-4000-8000-000000000983",
      payload: {
        title: "Official source for review",
        url: "https://example.test/source",
      },
      publishedAt: timestamp,
      publishedBy: "reviewer@example.test",
      reviewedAt: timestamp,
      reviewedBy: "reviewer@example.test",
      updatedAt: timestamp,
      version: 1,
      workflowStatus: "published",
    },
    {
      archivedAt: null,
      changeReason: "Reviewed market payload ready for publish.",
      createdAt: timestamp,
      createdBy: "editor@example.test",
      entityKey: "00000000-0000-4000-8000-000000000992",
      entityType: "market_metric",
      id: "00000000-0000-4000-8000-000000000984",
      payload: {
        countryIso3: "CHN",
        dataSourceId: sourceId,
        metricCode: "REVIEWED_METRIC",
      },
      publishedAt: null,
      publishedBy: null,
      reviewedAt: timestamp,
      reviewedBy: "reviewer@example.test",
      updatedAt: timestamp,
      version: 3,
      workflowStatus: "reviewed",
    },
  ];
  const publishedCountry = draftSummaries[0];
  const publishedSource = draftSummaries[2];
  const marketBaseline = {
    ...draftSummaries[3],
    changeReason: "Previously published market baseline.",
    id: "00000000-0000-4000-8000-000000000985",
    payload: {
      countryIso3: "CHN",
      dataSourceId: sourceId,
      metricCode: "PREVIOUS_METRIC",
    },
    publishedAt: timestamp,
    publishedBy: "reviewer@example.test",
    version: 2,
    workflowStatus: "published",
  };
  const sourceDependency = {
    isDemo: false,
    kind: "source",
    label: "Official source for review",
    path: "$.dataSourceId",
    state: "active",
    url: "https://example.test/source",
    value: sourceId,
    verifiedAt: timestamp,
  };
  const drafts = draftSummaries.map((draft) => ({
    ...draft,
    reviewContext: {
      baselineStatus: "active",
      blockingReasons: [],
      dependencies:
        draft.entityType === "data_source" ? [] : [sourceDependency],
      publishedBaseline:
        draft.entityType === "country"
          ? publishedCountry
          : draft.entityType === "market_metric"
            ? marketBaseline
            : publishedSource,
      publishReady: true,
    },
  }));

  await page.route("**/api/admin/dashboard", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        auditLogs: [],
        drafts,
        importBatches: [],
        principal: { email: "admin@example.test", role: "admin" },
        status: "ok",
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  let submittedReason: unknown;
  let publishReason: unknown;
  await page.route("**/api/admin/drafts/*/review", async (route) => {
    submittedReason = (route.request().postDataJSON() as { reason?: unknown })
      .reason;
    await route.fulfill({
      body: JSON.stringify({ status: "reviewed" }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/admin/drafts/*/publish", async (route) => {
    publishReason = (route.request().postDataJSON() as { reason?: unknown })
      .reason;
    await route.fulfill({
      body: JSON.stringify({ status: "published" }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/admin");
  const details = page.getByText("查看 v2 payload、发布差异与依赖", {
    exact: true,
  });
  await details.click();

  await expect(page.getByLabel("v2 完整 payload")).toContainText(
    '"nameEn": "Reviewed country name"',
  );
  await expect(page.getByText("$.nameEn", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("cell", { name: '"Old country name"' }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: '"Reviewed country name"' }),
  ).toBeVisible();
  const reviewDetails = details.locator("..");
  await expect(
    reviewDetails.getByText(`source · ${sourceId}`, { exact: true }),
  ).toBeVisible();
  await expect(
    reviewDetails.getByRole("link", { name: "打开来源证据" }),
  ).toHaveAttribute("href", "https://example.test/source");

  const reviewReason = page.getByLabel("审核理由");
  const reviewButton = page.getByRole("button", { name: "提交审核确认" });
  await expect(reviewButton).toBeDisabled();
  await reviewReason.fill("已逐项核对名称 diff、来源 URL 与依赖记录。");
  await expect(reviewButton).toBeEnabled();
  await reviewButton.click();

  await expect(page.getByText("草稿已审核。")).toBeVisible();
  expect(submittedReason).toBe("已逐项核对名称 diff、来源 URL 与依赖记录。");

  await page
    .getByText("查看 v3 payload、发布差异与依赖", { exact: true })
    .click();
  const publishButton = page.getByRole("button", { name: "确认发布版本" });
  await page
    .getByLabel("发布理由")
    .fill("已复核 payload、来源依赖与无基线警告，批准发布。");
  await expect(publishButton).toBeDisabled();
  await page
    .getByLabel(/我已核对完整 payload、服务端发布基线/)
    .check();
  await expect(publishButton).toBeEnabled();
  await publishButton.click();
  await expect(page.getByText("版本已发布。")).toBeVisible();
  expect(publishReason).toBe(
    "已复核 payload、来源依赖与无基线警告，批准发布。",
  );
});

test("fails closed when the server cannot verify a published baseline", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({
    [identityHeader]: "admin@example.test",
  });
  const timestamp = "2026-08-15T00:00:00.000Z";

  await page.route("**/api/admin/dashboard", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        auditLogs: [],
        drafts: [
          {
            archivedAt: null,
            changeReason: "Legacy entity without an auditable baseline.",
            createdAt: timestamp,
            createdBy: "editor@example.test",
            entityKey: "00000000-0000-4000-8000-000000000996",
            entityType: "product",
            id: "00000000-0000-4000-8000-000000000997",
            payload: {
              id: "00000000-0000-4000-8000-000000000996",
              name: "Unverifiable legacy product",
            },
            publishedAt: null,
            publishedBy: null,
            reviewContext: {
              baselineStatus: "missing",
              blockingReasons: [
                "缺少可核验的当前发布基线；为避免覆盖未知正式数据，当前禁止发布。",
              ],
              dependencies: [],
              publishedBaseline: null,
              publishReady: false,
            },
            reviewedAt: timestamp,
            reviewedBy: "reviewer@example.test",
            updatedAt: timestamp,
            version: 2,
            workflowStatus: "reviewed",
          },
        ],
        importBatches: [],
        principal: { email: "admin@example.test", role: "admin" },
        status: "ok",
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/admin");
  await page
    .getByText("查看 v2 payload、发布差异与依赖", { exact: true })
    .click();
  await expect(page.getByRole("region", { name: "发布阻塞项" })).toContainText(
    "缺少可核验的当前发布基线",
  );
  await page.getByLabel("发布理由").fill("已核查但服务端没有可靠发布基线。");
  await page.getByLabel(/我已核对完整 payload、服务端发布基线/).check();
  await expect(page.getByRole("button", { name: "确认发布版本" })).toBeDisabled();
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
