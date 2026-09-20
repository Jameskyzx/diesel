import { expect, test } from "@playwright/test";

const identityHeader = "oai-authenticated-user-email";
const expectedPrincipalEmailRequestHeader =
  "x-diesel-admin-expected-principal-email";
const expectedPrincipalRoleRequestHeader =
  "x-diesel-admin-expected-principal-role";
const principalEmailResponseHeader = "x-diesel-admin-principal-email";
const principalRoleResponseHeader = "x-diesel-admin-principal-role";
const adminPrincipalResponseHeaders = {
  [principalEmailResponseHeader]: "admin@example.test",
  [principalRoleResponseHeader]: "admin",
};
const editorPrincipalResponseHeaders = {
  [principalEmailResponseHeader]: "editor@example.test",
  [principalRoleResponseHeader]: "editor",
};
const reviewerPrincipalResponseHeaders = {
  [principalEmailResponseHeader]: "reviewer@example.test",
  [principalRoleResponseHeader]: "reviewer",
};

function adminMutationHeaders(
  email: string,
  role: "admin" | "editor" | "reviewer",
) {
  return {
    [expectedPrincipalEmailRequestHeader]: email,
    [expectedPrincipalRoleRequestHeader]: role,
    [identityHeader]: email,
  };
}

function dashboardWithAuditCanary(canary: string) {
  return {
    auditLogs: [
      {
        action: "source_verified",
        actorEmail: "admin@example.test",
        actorRole: "admin",
        createdAt: "2026-08-31T00:00:00.000Z",
        entityKey: "CHN",
        entityType: "country",
        id: "00000000-0000-4000-8000-000000000778",
        reason: canary,
      },
    ],
    drafts: [],
    status: "ok",
    workflowCounts: { draft: 0, published: 0, reviewed: 0 },
  };
}

function dashboardWithEditorCanary(
  canary: string,
  createdBy = "editor@example.test",
) {
  const entityKey = "CHN";
  return {
    auditLogs: [],
    drafts: [
      {
        changeReason: canary,
        createdBy,
        entityKey,
        entityType: "country",
        id: "00000000-0000-4000-8000-000000000779",
        payload: {
          dataCoverageStatus: "covered",
          dataSourceId: "00000000-0000-4000-8000-000000000001",
          isDemo: false,
          iso2: "CN",
          iso3: entityKey,
          nameEn: "Editor-scoped country revision",
          nameLocal: "中国",
          regionCode: "EAS",
          subregionCode: "EAS",
          verifiedAt: "2026-08-05T13:00:00.000Z",
        },
        reviewContext: {
          baselineStatus: "first_revision",
          blockingReasons: [],
          dependencies: [],
          publishedBaseline: null,
          publishReady: true,
        },
        version: 1,
        workflowStatus: "draft",
      },
    ],
    status: "ok",
    workflowCounts: { draft: 1, published: 0, reviewed: 0 },
  };
}

test("protects every management route with workspace identity and role checks", async ({
  request,
}) => {
  const unauthenticated = await request.get("/api/admin/dashboard");
  expect(unauthenticated.status()).toBe(401);

  const ordinaryUser = await request.get("/api/admin/dashboard", {
    headers: { [identityHeader]: "ordinary@example.test" },
  });
  expect(ordinaryUser.status()).toBe(403);

  const importHistoryCanary = "PRIVATE_DASHBOARD_IMPORT_HISTORY_CANARY.csv";
  const preview = await request.post("/api/admin/imports/market/preview", {
    headers: adminMutationHeaders("editor@example.test", "editor"),
    multipart: {
      file: {
        buffer: Buffer.from(
          "country_iso3,metric_code,metric_name,definition,application_scope,period_start,period_end,value_numeric,unit_code,currency_code,methodology_version,published_on,data_source_id,verified_at,is_demo\n",
        ),
        mimeType: "text/csv",
        name: importHistoryCanary,
      },
    },
  });
  expect(preview.status()).toBe(200);

  const editorDashboard = await request.get("/api/admin/dashboard", {
    headers: { [identityHeader]: "editor@example.test" },
  });
  expect(editorDashboard.status()).toBe(200);
  expect(editorDashboard.headers()[principalEmailResponseHeader]).toBe(
    "editor@example.test",
  );
  expect(editorDashboard.headers()[principalRoleResponseHeader]).toBe(
    "editor",
  );
  const dashboard = (await editorDashboard.json()) as {
    auditLogs: Array<Record<string, unknown>>;
    drafts: Array<{
      createdBy: string;
      reviewContext: {
        publishedBaseline: { publishedBy: string | null } | null;
      };
      workflowStatus: string;
    }>;
    workflowCounts: Record<"draft" | "published" | "reviewed", number>;
  };
  expect(dashboard.auditLogs).toEqual([]);
  expect(
    dashboard.drafts.every(
      (draft) =>
        draft.createdBy === "editor@example.test" &&
        ["draft", "reviewed"].includes(draft.workflowStatus) &&
        (draft.reviewContext.publishedBaseline === null ||
          draft.reviewContext.publishedBaseline.publishedBy === null),
    ),
  ).toBe(true);
  expect(dashboard.workflowCounts).toEqual({
    draft: expect.any(Number),
    published: expect.any(Number),
    reviewed: expect.any(Number),
  });
  for (const privateField of [
    "afterData",
    "beforeData",
    "draftId",
    "importBatchId",
  ]) {
    expect(dashboard.auditLogs.every((log) => !(privateField in log))).toBe(
      true,
    );
  }
  expect(dashboard).not.toHaveProperty("importBatches");
  expect(dashboard).not.toHaveProperty("principal");
  expect(JSON.stringify(dashboard)).not.toContain(importHistoryCanary);

  const editorReviewAttempt = await request.post(
    "/api/admin/drafts/00000000-0000-4000-8000-000000000999/review",
    {
      data: { reason: "An editor must not review a draft." },
      headers: adminMutationHeaders("editor@example.test", "editor"),
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
  const editorHeaders = adminMutationHeaders(
    "editor@example.test",
    "editor",
  );
  const reviewerHeaders = adminMutationHeaders(
    "reviewer@example.test",
    "reviewer",
  );

  const first = await request.post("/api/admin/drafts", {
    data: draftInput,
    headers: editorHeaders,
  });
  expect(first.status()).toBe(201);
  await expect(first.json()).resolves.toEqual({ status: "created" });
  const second = await request.post("/api/admin/drafts", {
    data: {
      ...draftInput,
      changeReason: "Create v2 before v1 has been published.",
    },
    headers: editorHeaders,
  });
  expect(second.status()).toBe(201);
  await expect(second.json()).resolves.toEqual({ status: "created" });

  const reviewerDashboardResponse = await request.get("/api/admin/dashboard", {
    headers: { [identityHeader]: "reviewer@example.test" },
  });
  expect(reviewerDashboardResponse.status()).toBe(200);
  const reviewerDashboard = (await reviewerDashboardResponse.json()) as {
    drafts: Array<{ entityKey: string; id: string; version: number }>;
  };
  const secondDraft = reviewerDashboard.drafts.find(
    (draft) => draft.entityKey === iso3 && draft.version === 2,
  );
  expect(secondDraft).toBeTruthy();

  const review = await request.post(
    `/api/admin/drafts/${secondDraft!.id}/review`,
    {
      data: { reason: "Review v2 before attempting the direct API bypass." },
      headers: reviewerHeaders,
    },
  );
  expect(review.status()).toBe(200);
  const publication = await request.post(
    `/api/admin/drafts/${secondDraft!.id}/publish`,
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
  ).toHaveCount(0);
  await expect(
    page.getByText(
      "此处只更新文档标题和来源标题；类型、语言、Demo 分类及其他已存元数据保持不变。",
    ),
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
  const verifiedAtInput = page.getByLabel(
    "核验时间（ISO 8601，必须含时区）",
  );
  await expect(verifiedAtInput).toHaveValue(/Z$/);
  const exactVerifiedAt = "2026-03-01T08:00:00.123456+08:00";
  await verifiedAtInput.fill(exactVerifiedAt);
  await expect(verifiedAtInput).toHaveValue(exactVerifiedAt);
  const sourceVerificationForm = page.getByRole("group", {
    name: "记录来源核验",
  });
  await expect(sourceVerificationForm.getByRole("status")).toHaveText(
    `将按该 ISO 时间保存：${exactVerifiedAt}`,
  );
});

test("renders only the editor-scoped queue and reports an exact truncated total", async ({
  page,
}) => {
  const dashboard = dashboardWithEditorCanary(
    "EDITOR_SCOPED_QUEUE_CANARY",
  );
  dashboard.workflowCounts = { draft: 101, published: 7, reviewed: 0 };
  await page.setExtraHTTPHeaders({
    [identityHeader]: "editor@example.test",
  });
  await page.route("**/api/admin/dashboard", async (route) => {
    await route.fulfill({
      body: JSON.stringify(dashboard),
      contentType: "application/json",
      headers: editorPrincipalResponseHeaders,
      status: 200,
    });
  });

  await page.goto("/admin");

  await expect(page.getByText("EDITOR_SCOPED_QUEUE_CANARY")).toBeVisible();
  await expect(page.getByTestId("admin-editor-audit-scope")).toContainText(
    "不加载全局变更记录或其他操作者身份",
  );
  await expect(
    page.getByRole("heading", { name: "数据变更记录" }),
  ).toHaveCount(0);
  await expect(page.getByTestId("admin-active-queue-truncated")).toContainText(
    "当前显示最新 1 / 101条活跃修订；单次最多返回 100 条",
  );
  await expect(page.getByText("101", { exact: true })).toBeVisible();
  await expect(page.getByText("7", { exact: true })).toBeVisible();
});

for (const scenario of [
  {
    email: "reviewer@example.test",
    expectedNotice: "Reviewer 不能审核或发布自己创建的修订",
    headers: reviewerPrincipalResponseHeaders,
    role: "reviewer",
  },
  {
    email: "admin@example.test",
    expectedNotice: "Admin 紧急覆盖",
    headers: adminPrincipalResponseHeaders,
    role: "admin",
  },
] as const) {
  test(`${scenario.role} row controls preserve separation of duties`, async ({
    page,
  }) => {
    await page.setExtraHTTPHeaders({
      [identityHeader]: scenario.email,
    });
    await page.route("**/api/admin/dashboard", async (route) => {
      await route.fulfill({
        body: JSON.stringify(
          dashboardWithEditorCanary(
            `${scenario.role.toUpperCase()}_OWN_DRAFT_CANARY`,
            scenario.email,
          ),
        ),
        contentType: "application/json",
        headers: scenario.headers,
        status: 200,
      });
    });

    await page.goto("/admin");
    await page
      .getByText("查看 v1 payload、发布差异与依赖", { exact: true })
      .click();

    await expect(page.getByText(scenario.expectedNotice)).toBeVisible();
    if (scenario.role === "reviewer") {
      await expect(page.getByLabel("审核理由")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "提交审核确认" }),
      ).toHaveCount(0);
    } else {
      await expect(page.getByLabel("审核理由")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "提交审核确认" }),
      ).toBeVisible();
    }
  });
}

test("reports duplicate uploads and failed reprocessing honestly", async ({
  page,
}) => {
  const reprocessedDocumentId = "82000000-0000-4000-8000-000000000001";
  const reprocessedDraft = {
    changeReason: "Reprocess unpublished document evidence.",
    createdBy: "editor@example.test",
    entityKey: reprocessedDocumentId,
    entityType: "document",
    id: "82000000-0000-4000-8000-000000000002",
    payload: { documentId: reprocessedDocumentId },
    reviewContext: {
      baselineStatus: "first_revision",
      blockingReasons: [],
      dependencies: [],
      publishedBaseline: null,
      publishReady: true,
    },
    version: 2,
    workflowStatus: "draft",
  };
  let reprocessRequestBody = "";
  await page.setExtraHTTPHeaders({
    [identityHeader]: "admin@example.test",
  });
  await page.route("**/api/admin/dashboard", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        auditLogs: [],
        drafts: [reprocessedDraft],
        status: "ok",
        workflowCounts: { draft: 1, published: 0, reviewed: 0 },
      }),
      contentType: "application/json",
      headers: adminPrincipalResponseHeaders,
      status: 200,
    });
  });
  await page.route("**/api/admin/documents", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        draftCreated: false,
        status: "duplicate",
      }),
      contentType: "application/json",
      headers: adminPrincipalResponseHeaders,
      status: 201,
    });
  });
  await page.route("**/api/admin/documents/*/reprocess", async (route) => {
    reprocessRequestBody = route.request().postData() ?? "";
    await route.fulfill({
      body: JSON.stringify({ status: "failed" }),
      contentType: "application/json",
      headers: adminPrincipalResponseHeaders,
      status: 200,
    });
  });

  await page.goto("/admin");
  await page
    .getByText("查看 v2 payload、发布差异与依赖", { exact: true })
    .click();
  await expect(
    page.getByText(
      "服务端已确认这是重处理生成的 v2 首次可发布修订：更早的未发布修订已失效，首次发布将以当前文档证据建立可审计基线。",
    ),
  ).toBeVisible();
  const upload = page.getByRole("group", { name: "上传新文档" });
  await upload.getByLabel("原始文件").setInputFiles({
    buffer: Buffer.from("duplicate document"),
    mimeType: "text/plain",
    name: "duplicate.txt",
  });
  await upload.getByLabel("文档标题").fill("Duplicate document");
  await upload.getByLabel("来源标题").fill("Duplicate source");
  await upload.getByLabel("上传原因").fill("Retry a duplicate upload.");
  await upload.getByRole("button", { name: "上传为 Draft" }).click();
  await expect(
    page.getByText("相同内容已存在；未创建新的文档或治理 Draft。"),
  ).toBeVisible();

  const reprocess = page.getByRole("group", {
    name: "重新处理 Draft 文档",
  });
  await reprocess
    .getByLabel("Draft 文档 UUID")
    .fill("82000000-0000-4000-8000-000000000001");
  await reprocess.getByLabel("文档标题").fill("Failed document");
  await reprocess.getByLabel("来源标题").fill("Failed source");
  await reprocess
    .getByLabel("重新处理原因")
    .fill("Retry failed document processing.");
  await reprocess
    .getByRole("button", { name: "重新处理 Draft 文档" })
    .click();
  await expect(
    page.getByText("重新处理仍未通过；Draft 保持不可审核，请检查处理错误。"),
  ).toBeVisible();
  expect(reprocessRequestBody).toContain('name="title"');
  expect(reprocessRequestBody).toContain('name="sourceTitle"');
  for (const field of [
    "demoNotice",
    "documentType",
    "isDemo",
    "languageCode",
    "sourceType",
  ]) {
    expect(reprocessRequestBody).not.toContain(`name="${field}"`);
    expect(reprocessRequestBody).not.toContain(`name="reprocess${field}"`);
  }
});

test("requires reviewers to inspect payload, diff, dependencies, and enter their own reason", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({
    [identityHeader]: "admin@example.test",
  });

  const sourceId = "00000000-0000-4000-8000-000000000991";
  const metricId = "00000000-0000-4000-8000-000000000992";
  const timestamp = "2026-08-15T00:00:00.000Z";
  const countryPayload = {
    dataCoverageStatus: "covered",
    dataSourceId: sourceId,
    isDemo: false,
    iso2: "CN",
    iso3: "CHN",
    nameEn: "Old country name",
    nameLocal: "中国",
    regionCode: "EAS",
    subregionCode: "EAS",
    verifiedAt: timestamp,
  };
  const sourcePayload = {
    demoNotice: null,
    id: sourceId,
    isDemo: false,
    publishedOn: "2026-08-15",
    publisher: "Official authority",
    sourceType: "government-notice",
    title: "Official source for review",
    url: "https://example.test/source",
    verifiedAt: timestamp,
  };
  const marketPayload = {
    applicationScope: null,
    countryIso3: "CHN",
    currencyCode: "USD",
    dataSourceId: sourceId,
    definition: "Reviewed metric used by the governance UI test.",
    id: metricId,
    isDemo: false,
    methodologyVersion: "review-v1",
    metricCode: "REVIEWED_METRIC",
    metricName: "Reviewed metric",
    periodEnd: "2026-01-01",
    periodStart: "2025-01-01",
    publishedOn: "2026-08-15",
    unitCode: "USD",
    valueNumeric: "1",
    verifiedAt: timestamp,
  };
  const draftSummaries = [
    {
      changeReason: "Published country baseline.",
      createdBy: "editor@example.test",
      entityKey: "CHN",
      entityType: "country",
      id: "00000000-0000-4000-8000-000000000981",
      payload: countryPayload,
      version: 1,
      workflowStatus: "published",
    },
    {
      changeReason: "Correct the country display name.",
      createdBy: "editor@example.test",
      entityKey: "CHN",
      entityType: "country",
      id: "00000000-0000-4000-8000-000000000982",
      payload: { ...countryPayload, nameEn: "Reviewed country name" },
      version: 2,
      workflowStatus: "draft",
    },
    {
      changeReason: "Published source baseline.",
      createdBy: "editor@example.test",
      entityKey: sourceId,
      entityType: "data_source",
      id: "00000000-0000-4000-8000-000000000983",
      payload: sourcePayload,
      version: 1,
      workflowStatus: "published",
    },
    {
      changeReason: "Reviewed market payload ready for publish.",
      createdBy: "editor@example.test",
      entityKey: metricId,
      entityType: "market_metric",
      id: "00000000-0000-4000-8000-000000000984",
      payload: marketPayload,
      version: 3,
      workflowStatus: "reviewed",
    },
  ];
  const publishedCountry = {
    payload: draftSummaries[0].payload,
    publishedAt: timestamp,
    publishedBy: "reviewer@example.test",
    version: 1,
  };
  const publishedSource = {
    payload: draftSummaries[2].payload,
    publishedAt: timestamp,
    publishedBy: "reviewer@example.test",
    version: 1,
  };
  const marketBaseline = {
    payload: {
      ...marketPayload,
      metricCode: "PREVIOUS_METRIC",
    },
    publishedAt: timestamp,
    publishedBy: "reviewer@example.test",
    version: 2,
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
  const drafts = draftSummaries
    .filter(({ workflowStatus }) => workflowStatus !== "published")
    .map((draft) => ({
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
        status: "ok",
        workflowCounts: { draft: 1, published: 2, reviewed: 1 },
      }),
      contentType: "application/json",
      headers: adminPrincipalResponseHeaders,
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
      headers: adminPrincipalResponseHeaders,
      status: 200,
    });
  });
  await page.route("**/api/admin/drafts/*/publish", async (route) => {
    publishReason = (route.request().postDataJSON() as { reason?: unknown })
      .reason;
    await route.fulfill({
      body: JSON.stringify({ status: "published" }),
      contentType: "application/json",
      headers: adminPrincipalResponseHeaders,
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

  await page.route("**/api/admin/dashboard", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        auditLogs: [],
        drafts: [
          {
            changeReason: "Legacy entity without an auditable baseline.",
            createdBy: "editor@example.test",
            entityKey: "00000000-0000-4000-8000-000000000996",
            entityType: "product",
            id: "00000000-0000-4000-8000-000000000997",
            payload: {
              applicationScopes: ["on-road-truck"],
              availableFrom: "2026-01-01",
              availableTo: "2027-01-01",
              dataSourceId: "00000000-0000-4000-8000-000000000001",
              description: null,
              id: "00000000-0000-4000-8000-000000000996",
              isDemo: false,
              modelCode: "UNVERIFIABLE-LEGACY",
              name: "Unverifiable legacy product",
              parameters: {},
              powerMaxKw: 300,
              powerMinKw: 200,
              specificationVersion: "2026-01",
              verifiedAt: "2026-08-05T13:00:00.000Z",
            },
            reviewContext: {
              baselineStatus: "missing",
              blockingReasons: [
                "缺少可核验的当前发布基线；为避免覆盖未知正式数据，当前禁止发布。",
              ],
              dependencies: [],
              publishedBaseline: null,
              publishReady: false,
            },
            version: 2,
            workflowStatus: "reviewed",
          },
        ],
        status: "ok",
        workflowCounts: { draft: 0, published: 1, reviewed: 1 },
      }),
      contentType: "application/json",
      headers: adminPrincipalResponseHeaders,
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

for (const authorizationFailure of [
  { code: "UNAUTHENTICATED", status: 401 },
  { code: "FORBIDDEN", status: 403 },
] as const) {
  test(`unloads the trusted admin workspace after a ${authorizationFailure.status} refresh`, async ({
    page,
  }) => {
    const auditCanary = `AUTH_${authorizationFailure.status}_AUDIT_CANARY`;
    const payloadCanary = `AUTH_${authorizationFailure.status}_PAYLOAD_CANARY`;
    let acceptedDashboardRequests = 0;
    let rejectedRefreshRequests = 0;
    let rejectRefresh = false;

    await page.setExtraHTTPHeaders({
      [identityHeader]: "admin@example.test",
    });
    await page.route("**/api/admin/dashboard", async (route) => {
      if (!rejectRefresh) {
        acceptedDashboardRequests += 1;
        await route.fulfill({
          body: JSON.stringify(dashboardWithAuditCanary(auditCanary)),
          contentType: "application/json",
          headers: adminPrincipalResponseHeaders,
          status: 200,
        });
        return;
      }

      rejectedRefreshRequests += 1;
      await route.fulfill({
        body: JSON.stringify({
          error: {
            code: authorizationFailure.code,
            message: `Synthetic ${authorizationFailure.status} identity failure.`,
          },
        }),
        contentType: "application/json",
        status: authorizationFailure.status,
      });
    });

    await page.goto("/admin");
    await expect(page.getByText(auditCanary)).toBeVisible();
    expect(acceptedDashboardRequests).toBeGreaterThanOrEqual(1);
    expect(rejectedRefreshRequests).toBe(0);
    await page.getByLabel("结构化 JSON").fill(
      JSON.stringify({ privateMarker: payloadCanary }),
    );
    const acceptedRequestsBeforeRefresh = acceptedDashboardRequests;
    rejectRefresh = true;
    await page.getByRole("button", { name: "刷新" }).click();

    await expect(page.getByText("管理身份已失效")).toBeVisible();
    expect(acceptedDashboardRequests).toBe(acceptedRequestsBeforeRefresh);
    expect(rejectedRefreshRequests).toBe(1);
    await expect(page.getByText(auditCanary)).toHaveCount(0);
    await expect(page.getByLabel("结构化 JSON")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "软归档已发布实体" }),
    ).toHaveCount(0);
    await expect(
      page.locator("main > header").getByText("admin@example.test"),
    ).toHaveCount(0);
    expect(await page.locator("body").textContent()).not.toContain(
      payloadCanary,
    );
  });
}

test("atomically remounts the workspace when the authorized principal changes", async ({
  page,
}) => {
  const payloadCanary = "ADMIN_A_PRIVATE_PAYLOAD_CANARY";
  const documentCanary = "ADMIN_A_PRIVATE_DOCUMENT_CANARY";
  let dashboardRequests = 0;

  await page.setExtraHTTPHeaders({
    [identityHeader]: "admin@example.test",
  });
  await page.route("**/api/admin/dashboard", async (route) => {
    dashboardRequests += 1;
    const editorResponse = dashboardRequests > 1;
    const auditCanary = editorResponse
      ? "EDITOR_B_ONLY_AUDIT_CANARY"
      : "ADMIN_A_ONLY_AUDIT_CANARY";
    await route.fulfill({
      body: JSON.stringify(
        editorResponse
          ? dashboardWithEditorCanary(auditCanary)
          : dashboardWithAuditCanary(auditCanary),
      ),
      contentType: "application/json",
      headers: editorResponse
        ? {
            [principalEmailResponseHeader]: "editor@example.test",
            [principalRoleResponseHeader]: "editor",
          }
        : adminPrincipalResponseHeaders,
      status: 200,
    });
  });

  await page.goto("/admin");
  await expect(page.getByText("ADMIN_A_ONLY_AUDIT_CANARY")).toBeVisible();
  await page.getByLabel("结构化 JSON").fill(
    JSON.stringify({ privateMarker: payloadCanary }),
  );
  const upload = page.getByRole("group", { name: "上传新文档" });
  await upload.getByLabel("文档标题").fill(documentCanary);
  await page.getByLabel("CSV 文件").setInputFiles({
    buffer: Buffer.from("private csv input"),
    mimeType: "text/csv",
    name: "admin-a-private.csv",
  });

  await page.getByRole("button", { name: "刷新" }).click();

  const identityCard = page.locator("main > header");
  await expect(identityCard.getByText("editor@example.test")).toBeVisible();
  await expect(identityCard.getByText("角色：editor")).toBeVisible();
  await expect(identityCard.getByText("admin@example.test")).toHaveCount(0);
  await expect(page.getByText("EDITOR_B_ONLY_AUDIT_CANARY")).toBeVisible();
  await expect(page.getByText("ADMIN_A_ONLY_AUDIT_CANARY")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "软归档已发布实体" }),
  ).toHaveCount(0);
  expect(await page.getByLabel("结构化 JSON").inputValue()).not.toContain(
    payloadCanary,
  );
  await expect(upload.getByLabel("文档标题")).toHaveValue("");
  await expect(page.getByLabel("CSV 文件")).toHaveValue("");
});

test("clears the old snapshot when a newly authenticated principal receives a 500", async ({
  page,
}) => {
  let dashboardRequests = 0;
  await page.setExtraHTTPHeaders({
    [identityHeader]: "admin@example.test",
  });
  await page.route("**/api/admin/dashboard", async (route) => {
    dashboardRequests += 1;
    if (dashboardRequests === 1) {
      await route.fulfill({
        body: JSON.stringify(
          dashboardWithAuditCanary("OLD_ADMIN_500_AUDIT_CANARY"),
        ),
        contentType: "application/json",
        headers: adminPrincipalResponseHeaders,
        status: 200,
      });
      return;
    }
    await route.fulfill({
      body: JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "Synthetic editor dashboard failure.",
        },
      }),
      contentType: "application/json",
      headers: editorPrincipalResponseHeaders,
      status: 500,
    });
  });

  await page.goto("/admin");
  await expect(page.getByText("OLD_ADMIN_500_AUDIT_CANARY")).toBeVisible();
  await page.getByRole("button", { name: "刷新" }).click();

  const identityCard = page.locator("main > header");
  await expect(identityCard.getByText("editor@example.test")).toBeVisible();
  await expect(identityCard.getByText("角色：editor")).toBeVisible();
  await expect(page.getByText("OLD_ADMIN_500_AUDIT_CANARY")).toHaveCount(0);
  await expect(page.getByLabel("结构化 JSON")).toHaveCount(0);
  await expect(
    page.getByText(
      "管理数据刷新失败：Synthetic editor dashboard failure.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByText("当前显示的是上一次成功加载的快照。"),
  ).toHaveCount(0);
});

test("clears a loaded workspace when a dashboard 500 lacks principal binding", async ({
  page,
}) => {
  const auditCanary = "ADMIN_A_UNBOUND_500_AUDIT_CANARY";
  const payloadCanary = "ADMIN_A_UNBOUND_500_PAYLOAD_CANARY";
  let dashboardRequests = 0;

  await page.setExtraHTTPHeaders({
    [identityHeader]: "admin@example.test",
  });
  await page.route("**/api/admin/dashboard", async (route) => {
    dashboardRequests += 1;
    if (dashboardRequests === 1) {
      await route.fulfill({
        body: JSON.stringify(dashboardWithAuditCanary(auditCanary)),
        contentType: "application/json",
        headers: adminPrincipalResponseHeaders,
        status: 200,
      });
      return;
    }

    await route.fulfill({
      body: JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "Synthetic unbound dashboard failure.",
        },
      }),
      contentType: "application/json",
      status: 500,
    });
  });

  await page.goto("/admin");
  await expect(page.getByText(auditCanary)).toBeVisible();
  await page.getByLabel("结构化 JSON").fill(
    JSON.stringify({ privateMarker: payloadCanary }),
  );

  await page.getByRole("button", { name: "刷新" }).click();

  await expect(page.getByText("管理身份已失效")).toBeVisible();
  await expect(page.getByText(auditCanary)).toHaveCount(0);
  await expect(page.getByLabel("结构化 JSON")).toHaveCount(0);
  await expect(
    page.getByText("当前显示的是上一次成功加载的快照。"),
  ).toHaveCount(0);
  expect(await page.locator("body").textContent()).not.toContain(
    payloadCanary,
  );
});

for (const malformedEditorDashboard of [
  {
    body: "EDITOR_B_NON_JSON_BODY_CANARY",
    contentType: "text/plain",
    name: "non-JSON",
    responseCanary: "EDITOR_B_NON_JSON_BODY_CANARY",
  },
  {
    body: JSON.stringify({
      ...dashboardWithAuditCanary("EDITOR_B_INVALID_SCHEMA_AUDIT_CANARY"),
      status: "invalid",
    }),
    contentType: "application/json",
    name: "schema-invalid JSON",
    responseCanary: "EDITOR_B_INVALID_SCHEMA_AUDIT_CANARY",
  },
  {
    body: JSON.stringify(
      dashboardWithAuditCanary("EDITOR_B_SCOPE_INVALID_AUDIT_CANARY"),
    ),
    contentType: "application/json",
    name: "scope-invalid JSON",
    responseCanary: "EDITOR_B_SCOPE_INVALID_AUDIT_CANARY",
  },
] as const) {
  test(`clears principal A when principal B returns ${malformedEditorDashboard.name}`, async ({
    page,
  }) => {
    const adminAuditCanary = `ADMIN_A_BEFORE_${malformedEditorDashboard.name.replaceAll(/\W/g, "_").toUpperCase()}`;
    const adminPayloadCanary = `ADMIN_A_PAYLOAD_BEFORE_${malformedEditorDashboard.name.replaceAll(/\W/g, "_").toUpperCase()}`;
    let dashboardRequests = 0;

    await page.setExtraHTTPHeaders({
      [identityHeader]: "admin@example.test",
    });
    await page.route("**/api/admin/dashboard", async (route) => {
      dashboardRequests += 1;
      if (dashboardRequests === 1) {
        await route.fulfill({
          body: JSON.stringify(dashboardWithAuditCanary(adminAuditCanary)),
          contentType: "application/json",
          headers: adminPrincipalResponseHeaders,
          status: 200,
        });
        return;
      }

      await route.fulfill({
        body: malformedEditorDashboard.body,
        contentType: malformedEditorDashboard.contentType,
        headers: editorPrincipalResponseHeaders,
        status: 200,
      });
    });

    await page.goto("/admin");
    await expect(page.getByText(adminAuditCanary)).toBeVisible();
    await page.getByLabel("结构化 JSON").fill(
      JSON.stringify({ privateMarker: adminPayloadCanary }),
    );

    await page.getByRole("button", { name: "刷新" }).click();

    const identityCard = page.locator("main > header");
    await expect(identityCard.getByText("editor@example.test")).toBeVisible();
    await expect(identityCard.getByText("角色：editor")).toBeVisible();
    await expect(identityCard.getByText("admin@example.test")).toHaveCount(0);
    await expect(page.getByText(adminAuditCanary)).toHaveCount(0);
    await expect(
      page.getByText(malformedEditorDashboard.responseCanary),
    ).toHaveCount(0);
    await expect(page.getByLabel("结构化 JSON")).toHaveCount(0);
    await expect(
      page.getByText("当前显示的是上一次成功加载的快照。"),
    ).toHaveCount(0);
    expect(await page.locator("body").textContent()).not.toContain(
      adminPayloadCanary,
    );
  });
}

for (const malformedCurrentDashboard of [
  {
    body: "CURRENT_ADMIN_NON_JSON_BODY_CANARY",
    contentType: "text/plain",
    name: "non-JSON",
    responseCanary: "CURRENT_ADMIN_NON_JSON_BODY_CANARY",
  },
  {
    body: JSON.stringify({
      ...dashboardWithAuditCanary(
        "CURRENT_ADMIN_INVALID_SCHEMA_AUDIT_CANARY",
      ),
      status: "invalid",
    }),
    contentType: "application/json",
    name: "schema-invalid JSON",
    responseCanary: "CURRENT_ADMIN_INVALID_SCHEMA_AUDIT_CANARY",
  },
] as const) {
  test(`unloads the writable workspace when the current principal returns ${malformedCurrentDashboard.name}`, async ({
    page,
  }) => {
    const trustedAuditCanary = `CURRENT_ADMIN_TRUSTED_${malformedCurrentDashboard.name.replaceAll(/\W/g, "_").toUpperCase()}`;
    let dashboardRequests = 0;

    await page.setExtraHTTPHeaders({
      [identityHeader]: "admin@example.test",
    });
    await page.route("**/api/admin/dashboard", async (route) => {
      dashboardRequests += 1;
      if (dashboardRequests === 1) {
        await route.fulfill({
          body: JSON.stringify(
            dashboardWithAuditCanary(trustedAuditCanary),
          ),
          contentType: "application/json",
          headers: adminPrincipalResponseHeaders,
          status: 200,
        });
        return;
      }

      await route.fulfill({
        body: malformedCurrentDashboard.body,
        contentType: malformedCurrentDashboard.contentType,
        headers: adminPrincipalResponseHeaders,
        status: 200,
      });
    });

    await page.goto("/admin");
    await expect(page.getByText(trustedAuditCanary)).toBeVisible();
    await page.getByRole("button", { name: "刷新" }).click();

    const identityCard = page.locator("main > header");
    await expect(identityCard.getByText("admin@example.test")).toBeVisible();
    await expect(identityCard.getByText("角色：admin")).toBeVisible();
    await expect(page.getByText("管理响应格式无效。")).toBeVisible();
    await expect(page.getByText(trustedAuditCanary)).toHaveCount(0);
    await expect(
      page.getByText(malformedCurrentDashboard.responseCanary),
    ).toHaveCount(0);
    await expect(page.getByLabel("结构化 JSON")).toHaveCount(0);
    await expect(
      page.getByText("当前显示的是上一次成功加载的快照。"),
    ).toHaveCount(0);
  });
}

test("fails closed when a successful dashboard response lacks principal binding", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({
    [identityHeader]: "admin@example.test",
  });
  await page.route("**/api/admin/dashboard", async (route) => {
    await route.fulfill({
      body: JSON.stringify(
        dashboardWithAuditCanary("UNBOUND_DASHBOARD_CANARY"),
      ),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/admin");

  await expect(page.getByText("管理身份已失效")).toBeVisible();
  await expect(page.getByText("UNBOUND_DASHBOARD_CANARY")).toHaveCount(0);
  await expect(page.getByLabel("结构化 JSON")).toHaveCount(0);
});

test("unloads the workspace when a management write loses authorization", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({
    [identityHeader]: "admin@example.test",
  });
  await page.route("**/api/admin/dashboard", async (route) => {
    await route.fulfill({
      body: JSON.stringify(
        dashboardWithAuditCanary("WRITE_AUTH_AUDIT_CANARY"),
      ),
      contentType: "application/json",
      headers: adminPrincipalResponseHeaders,
      status: 200,
    });
  });
  await page.route("**/api/admin/drafts", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        error: {
          code: "FORBIDDEN",
          message: "Synthetic write authorization failure.",
        },
      }),
      contentType: "application/json",
      status: 403,
    });
  });

  await page.goto("/admin");
  await expect(page.getByText("WRITE_AUTH_AUDIT_CANARY")).toBeVisible();
  await page.getByRole("button", { name: "保存 Draft" }).click();

  await expect(page.getByText("管理身份已失效")).toBeVisible();
  await expect(page.getByText("WRITE_AUTH_AUDIT_CANARY")).toHaveCount(0);
  await expect(page.getByLabel("结构化 JSON")).toHaveCount(0);
});

for (const actionPrincipalBoundary of [
  {
    expectedEmail: null,
    headers: {},
    name: "lacks principal binding",
  },
  {
    expectedEmail: "editor@example.test",
    headers: editorPrincipalResponseHeaders,
    name: "is bound to a different principal",
  },
] as const) {
  test(`clears principal A when a successful management write ${actionPrincipalBoundary.name}`, async ({
    page,
  }) => {
    const auditCanary = `ADMIN_A_ACTION_BINDING_${actionPrincipalBoundary.expectedEmail ? "MISMATCH" : "MISSING"}_AUDIT_CANARY`;
    const payloadCanary = `ADMIN_A_ACTION_BINDING_${actionPrincipalBoundary.expectedEmail ? "MISMATCH" : "MISSING"}_PAYLOAD_CANARY`;

    await page.setExtraHTTPHeaders({
      [identityHeader]: "admin@example.test",
    });
    await page.route("**/api/admin/dashboard", async (route) => {
      await route.fulfill({
        body: JSON.stringify(dashboardWithAuditCanary(auditCanary)),
        contentType: "application/json",
        headers: adminPrincipalResponseHeaders,
        status: 200,
      });
    });
    await page.route("**/api/admin/drafts", async (route) => {
      expect(
        route.request().headers()[expectedPrincipalEmailRequestHeader],
      ).toBe("admin@example.test");
      expect(
        route.request().headers()[expectedPrincipalRoleRequestHeader],
      ).toBe("admin");
      await route.fulfill({
        body: JSON.stringify({ status: "created" }),
        contentType: "application/json",
        headers: actionPrincipalBoundary.headers,
        status: 200,
      });
    });

    await page.goto("/admin");
    await expect(page.getByText(auditCanary)).toBeVisible();
    await page.getByLabel("结构化 JSON").fill(
      JSON.stringify({ privateMarker: payloadCanary }),
    );
    await page.getByRole("button", { name: "保存 Draft" }).click();

    const identityCard = page.locator("main > header");
    if (actionPrincipalBoundary.expectedEmail) {
      await expect(
        identityCard.getByText(actionPrincipalBoundary.expectedEmail),
      ).toBeVisible();
      await expect(identityCard.getByText("角色：editor")).toBeVisible();
      await expect(page.getByText("管理身份已失效")).toHaveCount(0);
    } else {
      await expect(page.getByText("管理身份已失效")).toBeVisible();
    }
    await expect(page.getByText(auditCanary)).toHaveCount(0);
    await expect(page.getByLabel("结构化 JSON")).toHaveCount(0);
    expect(await page.locator("body").textContent()).not.toContain(
      payloadCanary,
    );
  });
}

test("unloads the writable workspace when a bound action response violates its schema", async ({
  page,
}) => {
  const auditCanary = "BOUND_ACTION_INVALID_SCHEMA_AUDIT_CANARY";

  await page.setExtraHTTPHeaders({
    [identityHeader]: "admin@example.test",
  });
  await page.route("**/api/admin/dashboard", async (route) => {
    await route.fulfill({
      body: JSON.stringify(dashboardWithAuditCanary(auditCanary)),
      contentType: "application/json",
      headers: adminPrincipalResponseHeaders,
      status: 200,
    });
  });
  await page.route("**/api/admin/drafts", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        privateDetail: "PRIVATE_CANARY",
        status: "created",
      }),
      contentType: "application/json",
      headers: adminPrincipalResponseHeaders,
      status: 200,
    });
  });

  await page.goto("/admin");
  await expect(page.getByText(auditCanary)).toBeVisible();
  await page.getByRole("button", { name: "保存 Draft" }).click();

  const identityCard = page.locator("main > header");
  await expect(identityCard.getByText("admin@example.test")).toBeVisible();
  await expect(identityCard.getByText("角色：admin")).toBeVisible();
  await expect(page.getByText("管理响应格式无效。")).toBeVisible();
  await expect(page.getByText(auditCanary)).toHaveCount(0);
  await expect(page.getByLabel("结构化 JSON")).toHaveCount(0);
  expect(await page.locator("body").textContent()).not.toContain(
    "PRIVATE_CANARY",
  );
});

test("keeps the newest dashboard refresh when an older request finishes later", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({
    [identityHeader]: "admin@example.test",
  });

  let releaseOlderResponse = () => {};
  const olderResponseRelease = new Promise<void>((resolve) => {
    releaseOlderResponse = resolve;
  });
  let olderResponseReady = () => {};
  const olderResponseLoaded = new Promise<void>((resolve) => {
    olderResponseReady = resolve;
  });
  let olderRouteSettled = () => {};
  const olderRouteCompletion = new Promise<void>((resolve) => {
    olderRouteSettled = resolve;
  });
  let newestResponseSettled = () => {};
  const newestResponseCompletion = new Promise<void>((resolve) => {
    newestResponseSettled = resolve;
  });
  let dashboardPhase:
    | "initial"
    | "delay-next-refresh"
    | "serve-newest-refresh"
    | "complete" = "initial";
  let initialRequestCount = 0;
  let olderRefreshRequestCount = 0;
  let newestRefreshRequestCount = 0;
  let unexpectedRequestCount = 0;

  await page.route("**/api/admin/dashboard", async (route) => {
    if (dashboardPhase === "initial") {
      initialRequestCount += 1;
      const response = await route.fetch();
      await route.fulfill({ response });
      return;
    }

    if (dashboardPhase === "delay-next-refresh") {
      dashboardPhase = "serve-newest-refresh";
      olderRefreshRequestCount += 1;
      try {
        const response = await route.fetch();
        const body = (await response.json()) as Record<string, unknown>;
        olderResponseReady();
        await olderResponseRelease;
        await route.fulfill({
          body: JSON.stringify({
            ...body,
            auditLogs: [
              {
                action: "source_verified",
                actorEmail: "admin@example.test",
                actorRole: "admin",
                createdAt: "2026-08-06T00:00:00.000Z",
                entityKey: "CHN",
                entityType: "country",
                id: "00000000-0000-4000-8000-000000000777",
                reason: "STALE_TEST_ACTION",
              },
            ],
            drafts: [],
          }),
          contentType: "application/json",
          headers: adminPrincipalResponseHeaders,
          status: response.status(),
        });
      } catch {
        // The newer refresh cancels this browser request.
      } finally {
        olderRouteSettled();
      }
      return;
    }

    if (dashboardPhase === "serve-newest-refresh") {
      dashboardPhase = "complete";
      newestRefreshRequestCount += 1;
      const response = await route.fetch();
      await route.fulfill({ response });
      newestResponseSettled();
      return;
    }

    unexpectedRequestCount += 1;
    const response = await route.fetch();
    await route.fulfill({ response });
  });

  await page.goto("/admin");
  await expect(page.getByTestId("admin-dashboard-loading")).toBeHidden();
  expect(initialRequestCount).toBeGreaterThanOrEqual(1);
  expect(olderRefreshRequestCount).toBe(0);
  expect(newestRefreshRequestCount).toBe(0);
  expect(unexpectedRequestCount).toBe(0);
  const initialRequestsBeforeRefresh = initialRequestCount;
  dashboardPhase = "delay-next-refresh";
  await page.getByRole("button", { name: "刷新" }).click();
  await olderResponseLoaded;
  expect(dashboardPhase).toBe("serve-newest-refresh");
  expect(olderRefreshRequestCount).toBe(1);
  expect(newestRefreshRequestCount).toBe(0);
  await page.getByRole("button", { name: "刷新" }).click();
  await newestResponseCompletion;
  expect(dashboardPhase).toBe("complete");
  expect(newestRefreshRequestCount).toBe(1);

  releaseOlderResponse();
  await olderRouteCompletion;
  await expect(page.getByText("STALE_TEST_ACTION")).toHaveCount(0);
  expect(initialRequestCount).toBe(initialRequestsBeforeRefresh);
  expect(olderRefreshRequestCount).toBe(1);
  expect(newestRefreshRequestCount).toBe(1);
  expect(unexpectedRequestCount).toBe(0);
});

test("ignores a delayed principal A CSV preview after the dashboard switches to principal B", async ({
  page,
}) => {
  const adminAuditCanary = "ADMIN_A_DELAYED_PREVIEW_AUDIT_CANARY";
  const editorAuditCanary = "EDITOR_B_AFTER_DELAYED_PREVIEW_AUDIT_CANARY";
  const previewCanary = "ADMIN_A_DELAYED_CSV_PREVIEW_CANARY";
  let dashboardRequests = 0;
  let markPreviewRequestReady = () => {};
  const previewRequestReady = new Promise<void>((resolve) => {
    markPreviewRequestReady = resolve;
  });
  let releasePreviewResponse = () => {};
  const previewResponseRelease = new Promise<void>((resolve) => {
    releasePreviewResponse = resolve;
  });

  await page.setExtraHTTPHeaders({
    [identityHeader]: "admin@example.test",
  });
  await page.route("**/api/admin/dashboard", async (route) => {
    dashboardRequests += 1;
    const editorResponse = dashboardRequests > 1;
    await route.fulfill({
      body: JSON.stringify(
        editorResponse
          ? dashboardWithEditorCanary(editorAuditCanary)
          : dashboardWithAuditCanary(adminAuditCanary),
      ),
      contentType: "application/json",
      headers: editorResponse
        ? editorPrincipalResponseHeaders
        : adminPrincipalResponseHeaders,
      status: 200,
    });
  });
  await page.route("**/api/admin/imports/market/preview", async (route) => {
    markPreviewRequestReady();
    await previewResponseRelease;
    await route.fulfill({
      body: JSON.stringify({
        batchId: "00000000-0000-4000-8000-000000000902",
        errors: [],
        invalidRows: 0,
        rows: [
          {
            parsed: { metricCode: previewCanary },
            rowNumber: 2,
          },
        ],
        status: "previewed",
        totalRows: 1,
        validRows: 1,
      }),
      contentType: "application/json",
      headers: adminPrincipalResponseHeaders,
      status: 200,
    });
  });

  await page.goto("/admin");
  await expect(page.getByText(adminAuditCanary)).toBeVisible();
  await page.getByLabel("CSV 文件").setInputFiles({
    buffer: Buffer.from("delayed principal A CSV"),
    mimeType: "text/csv",
    name: "principal-a-delayed.csv",
  });
  const delayedPreviewResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/api/admin/imports/market/preview"),
  );
  await page.getByRole("button", { name: "预览并校验" }).click();
  await previewRequestReady;

  await page.getByRole("button", { name: "刷新" }).click();
  await expect(page.getByText(editorAuditCanary)).toBeVisible();
  await expect(page.getByText(adminAuditCanary)).toHaveCount(0);
  await expect(
    page.locator("main > header").getByText("editor@example.test"),
  ).toBeVisible();

  releasePreviewResponse();
  const previewResponse = await delayedPreviewResponse;
  await previewResponse.finished();

  await expect(page.getByText(editorAuditCanary)).toBeVisible();
  await expect(page.getByText(previewCanary)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "确认批次" })).toHaveCount(0);
  await expect(
    page.getByText("CSV 只完成预览；尚未写入市场指标或草稿。"),
  ).toHaveCount(0);
});

test("does not revive a pending CSV preview after the selected file changes", async ({
  page,
}) => {
  const previewCanary = "STALE_FIRST_FILE_PENDING_PREVIEW_CANARY";
  let markPreviewRequestReady = () => {};
  const previewRequestReady = new Promise<void>((resolve) => {
    markPreviewRequestReady = resolve;
  });
  let releasePreviewResponse = () => {};
  const previewResponseRelease = new Promise<void>((resolve) => {
    releasePreviewResponse = resolve;
  });

  await page.setExtraHTTPHeaders({
    [identityHeader]: "admin@example.test",
  });
  await page.route("**/api/admin/dashboard", async (route) => {
    await route.fulfill({
      body: JSON.stringify(
        dashboardWithAuditCanary("CSV_SELECTION_EPOCH_AUDIT_CANARY"),
      ),
      contentType: "application/json",
      headers: adminPrincipalResponseHeaders,
      status: 200,
    });
  });
  await page.route("**/api/admin/imports/market/preview", async (route) => {
    markPreviewRequestReady();
    await previewResponseRelease;
    await route.fulfill({
      body: JSON.stringify({
        batchId: "00000000-0000-4000-8000-000000000903",
        errors: [],
        invalidRows: 0,
        rows: [
          {
            parsed: { metricCode: previewCanary },
            rowNumber: 2,
          },
        ],
        status: "previewed",
        totalRows: 1,
        validRows: 1,
      }),
      contentType: "application/json",
      headers: adminPrincipalResponseHeaders,
      status: 200,
    });
  });

  await page.goto("/admin");
  const csvInput = page.getByLabel("CSV 文件");
  await csvInput.setInputFiles({
    buffer: Buffer.from("first pending file"),
    mimeType: "text/csv",
    name: "first-pending.csv",
  });
  const delayedPreviewResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/api/admin/imports/market/preview"),
  );
  await page.getByRole("button", { name: "预览并校验" }).click();
  await previewRequestReady;

  await csvInput.setInputFiles({
    buffer: Buffer.from("second selected file"),
    mimeType: "text/csv",
    name: "second-selected.csv",
  });
  releasePreviewResponse();
  const previewResponse = await delayedPreviewResponse;
  await previewResponse.finished();

  await expect(csvInput).toHaveValue(/second-selected\.csv$/);
  await expect(page.getByText(previewCanary)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "确认批次" })).toHaveCount(0);
  await expect(
    page.getByText("CSV 只完成预览；尚未写入市场指标或草稿。"),
  ).toHaveCount(0);
});

test("ignores a delayed principal A action error after the dashboard switches to principal B", async ({
  page,
}) => {
  const adminAuditCanary = "ADMIN_A_DELAYED_ACTION_ERROR_AUDIT_CANARY";
  const editorAuditCanary = "EDITOR_B_AFTER_DELAYED_ACTION_ERROR_AUDIT_CANARY";
  const delayedErrorMessage = "Synthetic delayed principal A action failure.";
  let dashboardRequests = 0;
  let markActionRequestReady = () => {};
  const actionRequestReady = new Promise<void>((resolve) => {
    markActionRequestReady = resolve;
  });
  let releaseActionResponse = () => {};
  const actionResponseRelease = new Promise<void>((resolve) => {
    releaseActionResponse = resolve;
  });

  await page.setExtraHTTPHeaders({
    [identityHeader]: "admin@example.test",
  });
  await page.route("**/api/admin/dashboard", async (route) => {
    dashboardRequests += 1;
    const editorResponse = dashboardRequests > 1;
    await route.fulfill({
      body: JSON.stringify(
        editorResponse
          ? dashboardWithEditorCanary(editorAuditCanary)
          : dashboardWithAuditCanary(adminAuditCanary),
      ),
      contentType: "application/json",
      headers: editorResponse
        ? editorPrincipalResponseHeaders
        : adminPrincipalResponseHeaders,
      status: 200,
    });
  });
  await page.route("**/api/admin/drafts", async (route) => {
    markActionRequestReady();
    await actionResponseRelease;
    await route.fulfill({
      body: JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: delayedErrorMessage,
        },
      }),
      contentType: "application/json",
      headers: adminPrincipalResponseHeaders,
      status: 500,
    });
  });

  await page.goto("/admin");
  await expect(page.getByText(adminAuditCanary)).toBeVisible();
  const delayedActionResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/api/admin/drafts"),
  );
  await page.getByRole("button", { name: "保存 Draft" }).click();
  await actionRequestReady;

  await page.getByRole("button", { name: "刷新" }).click();
  await expect(page.getByText(editorAuditCanary)).toBeVisible();
  await expect(page.getByText(adminAuditCanary)).toHaveCount(0);

  releaseActionResponse();
  const actionResponse = await delayedActionResponse;
  await actionResponse.finished();

  const identityCard = page.locator("main > header");
  await expect(identityCard.getByText("editor@example.test")).toBeVisible();
  await expect(identityCard.getByText("角色：editor")).toBeVisible();
  await expect(identityCard.getByText("admin@example.test")).toHaveCount(0);
  await expect(page.getByText(editorAuditCanary)).toBeVisible();
  await expect(page.getByText(adminAuditCanary)).toHaveCount(0);
  await expect(page.getByText(delayedErrorMessage)).toHaveCount(0);
  await expect(page.getByText("管理身份已失效")).toHaveCount(0);
  await expect(page.getByLabel("结构化 JSON")).toBeVisible();
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
      headers: adminPrincipalResponseHeaders,
      status: 500,
    });
  });
  await page.route("**/api/admin/drafts", async (route) => {
    draftRequests += 1;
    await route.fulfill({
      body: JSON.stringify({ status: "created" }),
      contentType: "application/json",
      headers: adminPrincipalResponseHeaders,
      status: 200,
    });
  });

  await page.goto("/admin");
  await expect(page.getByTestId("admin-dashboard-loading")).toBeHidden();
  const retainedPayload = JSON.stringify({
    privateMarker: "RETAIN_ON_TRANSIENT_500",
  });
  await page.getByLabel("结构化 JSON").fill(retainedPayload);
  failDashboardRefresh = true;
  await page.getByRole("button", { name: "保存 Draft" }).click();

  await expect(
    page.getByText("草稿已创建，正式查询仍使用当前已发布版本。"),
  ).toBeVisible();
  await expect(
    page.getByText(
      "操作已完成，但管理数据刷新失败：Synthetic refresh failure. 当前显示的是上一次成功加载的快照。",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByLabel("结构化 JSON")).toHaveValue(retainedPayload);
  await expect(
    page.getByRole("heading", { name: "软归档已发布实体" }),
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
        headers: adminPrincipalResponseHeaders,
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
      headers: adminPrincipalResponseHeaders,
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
