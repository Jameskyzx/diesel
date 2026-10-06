import { expect, test, type Page, type Request as BrowserRequest, type Route } from "@playwright/test";

import { checkBrowserRuntimeErrors } from "./browser-runtime-errors";

import { PUBLIC_API_REQUEST_TIMEOUT_MS } from "../src/lib/public-api-request";

async function holdNextChatRequest(page: Page): Promise<{
  release: () => void;
  started: Promise<void>;
}> {
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  let releaseRoute!: () => void;
  const routeGate = new Promise<void>((resolve) => {
    releaseRoute = resolve;
  });
  let released = false;

  await page.route(
    "**/api/chat",
    async (route) => {
      markStarted();
      await routeGate;
      try {
        await route.fulfill({
          body: JSON.stringify({
            error: {
              code: "INTERNAL_ERROR",
              message: "DO NOT RENDER held chat response",
            },
          }),
          contentType: "application/json",
          status: 503,
        });
      } catch {
        // The cancellation tests intentionally abort this intercepted request.
      }
    },
    { times: 1 },
  );

  return {
    release() {
      if (released) return;
      released = true;
      releaseRoute();
    },
    started,
  };
}

function waitForChatRequestFailure(page: Page) {
  return page.waitForEvent("requestfailed", (request) =>
    new URL(request.url()).pathname === "/api/chat"
  );
}

test.beforeEach(async ({ baseURL, context }) => {
  await context.addCookies([
    {
      name: "diesel_locale",
      url: baseURL ?? "http://127.0.0.1:3100",
      value: "zh-CN",
    },
  ]);
});

test("renders the operational home entry and primary navigation", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "全球柴油机法规与产品数据库",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "直接开始",
    }),
  ).toBeVisible();
  await expect(page.getByText("面向海外销售与产品团队")).toBeVisible();
  await expect(page.getByText("证据边界核验率")).toBeVisible();
  await expect(
    page.getByText(
      "已核验表示来源边界和数据缺口经过审阅，不代表该国存在数值法规。",
    ),
  ).toBeVisible();
  await expect(page.getByText("结构化覆盖率")).toHaveCount(0);
  await expect(page.getByText("EVIDENCE CONTRACT")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
  await expect(page.getByRole("link", { exact: true, name: "首页" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { exact: true, name: "对话" })).toBeVisible();
  await expect(page.getByRole("link", { exact: true, name: "地图" })).toBeVisible();
  await expect(
    page.locator('button[aria-label="打开 AI 营销分析助手"]'),
  ).toHaveCount(0);
  await expect(page.getByTestId("portfolio-disclaimer")).toHaveCount(0);
  await expect(page.getByTestId("usage-boundary")).toHaveCount(0);
  await page.getByRole("link", { exact: true, name: "地图" }).click();
  await expect(page).toHaveURL(/\/map$/);
  await expect(page.getByTestId("world-map")).toBeVisible();
});

test("does not claim the home data is online when the country summary fails", async ({
  page,
}) => {
  await page.route("**/api/countries", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ error: { code: "INTERNAL_ERROR" } }),
      contentType: "application/json",
      status: 500,
    });
  });

  await page.goto("/");

  await expect(page.getByText("数据不可用")).toBeVisible();
  await expect(page.getByText("在线", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "重试" })).toBeVisible();
});

for (const cpuRate of [1, 8]) {
  test(`exits public loading and disabled states when APIs never respond (${cpuRate}x CPU slowdown)`, async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop-chromium",
      "The controlled client deadline only needs one browser project.",
    );

    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
    let releaseRequests = () => {};
    const requestGate = new Promise<void>((resolve) => {
      releaseRequests = resolve;
    });
    const heldRequests: BrowserRequest[] = [];
    let settledRequests = 0;
    const requestsFor = (path: string) => heldRequests.filter(
      (request) => new URL(request.url()).pathname === path,
    );
    const activeRequests = () => ({
      countries: requestsFor("/api/countries").filter((request) => request.failure() === null).length,
      locale: requestsFor("/api/preferences/locale").filter((request) => request.failure() === null).length,
    });
    const holdRequest = async (route: Route) => {
      heldRequests.push(route.request());
      await requestGate;
      try {
        await route.fulfill({
          body: JSON.stringify({ message: "DO NOT RENDER timeout reason" }),
          contentType: "application/json",
          status: 503,
        });
      } catch {
        // The client deadline intentionally aborts these held requests.
      } finally {
        settledRequests += 1;
      }
    };

    try {
      await page.clock.install();
      await page.route("**/api/countries", holdRequest);
      await page.route("**/api/preferences/locale", holdRequest);
      await page.goto("/");
      await expect(
        page.getByRole("status").filter({ hasText: "正在同步国家摘要…" }),
      ).toBeVisible();

      const localeToggle = page.getByTestId("locale-toggle");
      await localeToggle.getByRole("button", { name: "EN", exact: true }).click();
      // Strict Mode cancels the first mount's GET. On a slower browser it may
      // reach interception before cancellation. Count live work, not obsolete
      // requests; never tolerate duplicate language preference writes.
      await expect.poll(activeRequests).toEqual({ countries: 1, locale: 1 });
      expect(requestsFor("/api/preferences/locale")).toHaveLength(1);
      await expect(
        localeToggle.getByRole("button", { name: "中文", exact: true }),
      ).toBeDisabled();
      await expect(localeToggle).toHaveAttribute("aria-busy", "true");
      await expect(
        page.getByRole("status").filter({ hasText: "正在切换语言…" }),
      ).toHaveText("正在切换语言…");

      await page.clock.fastForward(PUBLIC_API_REQUEST_TIMEOUT_MS + 1);

      await expect(
        page.getByRole("alert").filter({
          hasText: "国家覆盖摘要暂时无法加载，请进入地图重试。",
        }),
      ).toBeVisible();
      await expect(
        page.getByText("语言切换失败。", { exact: true }),
      ).toHaveAttribute("role", "alert");
      await expect(
        localeToggle.getByRole("button", { name: "中文", exact: true }),
      ).toBeEnabled();
      await expect(localeToggle).toHaveAttribute("aria-busy", "false");
      await expect(
        page.getByRole("status").filter({ hasText: "正在切换语言…" }),
      ).toHaveCount(0);
      await expect(
        page.getByText("DO NOT RENDER timeout reason", { exact: true }),
      ).toHaveCount(0);

      await expect.poll(activeRequests).toEqual({ countries: 0, locale: 0 });
      expect(requestsFor("/api/preferences/locale")).toHaveLength(1);
    } finally {
      releaseRequests();
      await expect.poll(() => heldRequests.length - settledRequests).toBe(0);
      await session.detach();
    }
  });
}

test("opens the dedicated chat workspace from primary navigation", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { exact: true, name: "对话" }).click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByRole("heading", { name: "和数据一起讨论下一步" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "AI 营销分析助手" })).toBeVisible();
  await expect(page.getByText("连接你的 AI 接口")).toHaveCount(0);
  await expect(page.getByText("服务端 AI 已配置")).toBeVisible();
  await expect(page.getByPlaceholder("输入问题，可附上文件或图片…")).toBeEditable();
  await expect(page.getByRole("button", { name: "添加文件或图片" })).toBeEnabled();
  await expect(page.getByText("先选国家，也可以直接指定国家。")).toHaveCount(0);
  await expect(
    page.getByText("信息参考，不替代正式认证或法律意见"),
  ).toHaveCount(0);
  await expect(page.getByText(/扫描版 PDF 请上传清晰页面截图/)).toHaveCount(0);

  const starter = page.getByRole("button", {
    name: "CHN 目前有哪些有效法规？",
  });
  await expect(starter).toBeEnabled();
});

test("preserves valid chat context while removing one invalid shared parameter", async ({
  page,
}, testInfo) => {
  await checkBrowserRuntimeErrors(page, testInfo, async () => {
    await page.goto(
      "/chat?countryIso3=chn&applicationScope=non-road&powerKw=100.0&asOf=bad&productModelCode=demo-eng-100&utm_source=e2e",
    );

    await expect(page).toHaveURL(
      /\/chat\?applicationScope=non-road&countryIso3=CHN&powerKw=100&productModelCode=DEMO-ENG-100&utm_source=e2e$/,
    );
    await expect(page.getByPlaceholder("输入问题，可附上文件或图片…")).toHaveValue(
      /CHN.*非道路 100 kW.*DEMO-ENG-100/,
    );
  });
});

test("answers a capability question without forcing a fact tool", async ({ page }) => {
  await page.goto("/chat");

  const assistant = page.getByRole("complementary", {
    name: "AI 营销分析助手",
  });
  await assistant
    .getByPlaceholder("输入问题，可附上文件或图片…")
    .fill("你好，你能帮我做什么？");
  await assistant.getByRole("button", { name: "发送问题" }).click();

  const conversation = assistant.getByRole("region", {
    name: "AI 对话记录",
  });
  await expect(conversation).toContainText("结构化事实和可追溯来源");
  await expect(conversation).toContainText("比较 2–5 个国家");
  const markdown = conversation.getByTestId("assistant-markdown");
  await expect(markdown.getByRole("list")).toBeVisible();
  await expect(markdown.getByRole("listitem")).toHaveCount(4);
  await expect(conversation).not.toContainText("没有足够证据");
  await expect(conversation).not.toContainText("正在执行确定性查询");
  await expect(conversation.getByRole("region")).toHaveCount(0);
});

test("previews, removes, and validates chat attachments", async ({ page }) => {
  await page.addInitScript(() => {
    type ObjectUrlAudit = {
      created: Array<{ name: string; url: string }>;
      revoked: string[];
    };
    const browserGlobal = globalThis as typeof globalThis & {
      __chatAttachmentObjectUrls?: ObjectUrlAudit;
    };
    const audit: ObjectUrlAudit = { created: [], revoked: [] };
    const createObjectURL = URL.createObjectURL.bind(URL);
    const revokeObjectURL = URL.revokeObjectURL.bind(URL);
    browserGlobal.__chatAttachmentObjectUrls = audit;
    URL.createObjectURL = (object: Blob | MediaSource) => {
      const url = createObjectURL(object);
      audit.created.push({
        name: object instanceof File ? object.name : "",
        url,
      });
      return url;
    };
    URL.revokeObjectURL = (url: string) => {
      audit.revoked.push(url);
      revokeObjectURL(url);
    };
  });
  await page.goto("/chat");

  const assistant = page.getByRole("complementary", {
    name: "AI 营销分析助手",
  });
  const fileInput = assistant.getByLabel("选择文件或图片");
  await fileInput.setInputFiles({
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAHUlEQVR4nGNQTl72nxLMMGrA/9EwWDYaBsnDIgwAMoorH0C43vMAAAAASUVORK5CYII=",
      "base64",
    ),
    mimeType: "image/png",
    name: "engine-plate.png",
  });

  await expect(assistant.getByText("engine-plate.png")).toBeVisible();
  await expect(
    assistant.getByRole("img", { name: "engine-plate.png 预览" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const browserGlobal = globalThis as typeof globalThis & {
          __chatAttachmentObjectUrls?: {
            created: Array<{ name: string; url: string }>;
          };
        };
        return browserGlobal.__chatAttachmentObjectUrls?.created.some(
          ({ name }) => name === "engine-plate.png",
        ) ?? false;
      }),
    )
    .toBe(true);
  await assistant
    .getByRole("button", { name: "移除附件 engine-plate.png" })
    .click();
  await expect(assistant.getByText("engine-plate.png")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const browserGlobal = globalThis as typeof globalThis & {
          __chatAttachmentObjectUrls?: {
            created: Array<{ name: string; url: string }>;
            revoked: string[];
          };
        };
        const audit = browserGlobal.__chatAttachmentObjectUrls;
        const previewUrl = audit?.created.find(
          ({ name }) => name === "engine-plate.png",
        )?.url;
        return previewUrl ? audit?.revoked.includes(previewUrl) : false;
      }),
    )
    .toBe(true);

  await fileInput.setInputFiles({
    buffer: Buffer.from("not supported"),
    mimeType: "application/octet-stream",
    name: "unsafe.exe",
  });
  await expect(assistant.getByRole("alert")).toContainText("格式不受支持");

  await fileInput.setInputFiles({
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
    mimeType: "image/png",
    name: "too-small.png",
  });
  await expect(assistant.getByRole("alert")).toContainText(
    "图片宽高均须为 11–8,192 像素",
  );
});

test("lets the user stop a held chat request without showing a retry error", async ({
  page,
}, testInfo) => {
  test.skip(
    !["desktop-chromium", "mobile-chromium"].includes(testInfo.project.name),
    "Chromium desktop and narrow mobile cover the stop control and transport abort contract.",
  );

  if (testInfo.project.name === "mobile-chromium") {
    await page.setViewportSize({ height: 800, width: 320 });
  }

  const heldRequest = await holdNextChatRequest(page);
  try {
    await page.goto("/chat");
    const assistant = page.getByRole("complementary", {
      name: "AI 营销分析助手",
    });
    const input = assistant.getByRole("textbox", { name: "输入问题" });
    await input.fill("比较 CHN 和 BRA 的非道路 100 kW 法规。");
    await assistant.getByRole("button", { name: "发送问题" }).click();
    await heldRequest.started;

    const stopButton = assistant.getByRole("button", { name: "停止生成" });
    await expect(stopButton).toBeVisible();
    await expect.poll(() =>
      page.evaluate(() =>
        document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
    const requestFailed = waitForChatRequestFailure(page);
    await stopButton.click();

    const failedRequest = await requestFailed;
    expect(failedRequest.failure()?.errorText).toMatch(/ERR_ABORTED/u);
    await expect(stopButton).toHaveCount(0);
    await expect(input).toBeEditable();
    await input.fill("下一条问题仍可输入");
    await expect(input).toHaveValue("下一条问题仍可输入");
    await expect(assistant.getByRole("alert")).toHaveCount(0);
    await expect(
      assistant.getByText("失败的问题和附件已在本页保留。"),
    ).toHaveCount(0);
  } finally {
    heldRequest.release();
  }
});

test("aborts a held chat request when SPA navigation unmounts the chat", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "One Chromium project is sufficient for the browser transport abort contract.",
  );

  const heldRequest = await holdNextChatRequest(page);
  try {
    await page.goto("/chat");
    const assistant = page.getByRole("complementary", {
      name: "AI 营销分析助手",
    });
    await assistant
      .getByRole("textbox", { name: "输入问题" })
      .fill("比较 CHN 和 BRA 的非道路 100 kW 法规。");
    await assistant.getByRole("button", { name: "发送问题" }).click();
    await heldRequest.started;
    await expect(
      assistant.getByRole("button", { name: "停止生成" }),
    ).toBeVisible();

    const requestFailed = waitForChatRequestFailure(page);
    await page
      .getByRole("navigation", { name: "主导航" })
      .getByRole("link", { exact: true, name: "地图" })
      .click();

    await expect(page).toHaveURL(/\/map$/u);
    const failedRequest = await requestFailed;
    expect(failedRequest.failure()?.errorText).toMatch(/ERR_ABORTED/u);

    await page
      .getByRole("navigation", { name: "主导航" })
      .getByRole("link", { exact: true, name: "对话" })
      .click();
    const restoredAssistant = page.getByRole("complementary", {
      name: "AI 营销分析助手",
    });
    await expect(
      restoredAssistant.getByRole("textbox", { name: "输入问题" }),
    ).toBeEditable();
    await expect(restoredAssistant.getByRole("alert")).toHaveCount(0);
    await expect(
      restoredAssistant.getByText("失败的问题和附件已在本页保留。"),
    ).toHaveCount(0);
  } finally {
    heldRequest.release();
  }
});

test("keeps a failed question and attachment for explicit retry or editing", async ({
  page,
}) => {
  const chatRequestBodies: string[] = [];
  let releaseFirstResponse!: () => void;
  const firstResponseGate = new Promise<void>((resolve) => {
    releaseFirstResponse = resolve;
  });
  await page.route("**/api/chat", async (route) => {
    const requestNumber = chatRequestBodies.push(
      route.request().postData() ?? "",
    );
    if (requestNumber === 1) {
      await firstResponseGate;
    } else {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    await route.fulfill({
      body: JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "AI 服务暂时不可用，请稍后重试。",
        },
      }),
      contentType: "application/json",
      status: 503,
    });
  });
  await page.addInitScript(() => {
    const readAsDataURL = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function (blob: Blob) {
      setTimeout(() => readAsDataURL.call(this, blob), 300);
    };
  });

  await page.goto("/chat");
  const assistant = page.getByRole("complementary", {
    name: "AI 营销分析助手",
  });
  const prompt = assistant.getByPlaceholder(/输入问题，可附上文件/);
  await assistant.getByLabel(/选择文件/).setInputFiles({
    buffer: Buffer.from("engine plate note", "utf8"),
    mimeType: "text/plain",
    name: "failed-engine-note.txt",
  });
  await prompt.fill("描述这张铭牌图片");
  const sendButton = assistant.getByRole("button", { name: "发送问题" });
  await Promise.all([
    expect(sendButton).toBeDisabled(),
    sendButton.dblclick(),
  ]);

  await expect.poll(() => chatRequestBodies.length).toBe(1);
  expect(chatRequestBodies[0]).toContain("data:text/plain;base64,");
  await expect(
    assistant.getByText(
      "[已发送附件：failed-engine-note.txt；后续追问请重新上传]",
    ),
  ).toBeVisible();
  releaseFirstResponse();
  await expect(assistant.getByRole("alert")).toContainText(
    "AI 服务暂时不可用，请稍后重试。",
  );
  await expect(
    assistant.getByText(
      "[已发送附件：failed-engine-note.txt；后续追问请重新上传]",
    ),
  ).toBeVisible();
  await expect(assistant.getByText("失败的问题和附件已在本页保留。")).toBeVisible();
  await expect(
    assistant.getByText("附件：failed-engine-note.txt", { exact: true }),
  ).toBeVisible();
  await expect(assistant.getByRole("button", { name: "原样重试" })).toBeVisible();
  await expect(
    assistant.getByRole("button", { name: "编辑后重试" }),
  ).toBeVisible();
  await expect(prompt).toHaveAttribute("readonly", "");
  expect(chatRequestBodies).toHaveLength(1);

  const retryButton = assistant.getByRole("button", { name: "原样重试" });
  const editButton = assistant.getByRole("button", { name: "编辑后重试" });
  await Promise.all([
    expect(retryButton).toBeDisabled(),
    expect(editButton).toBeDisabled(),
    retryButton.dblclick(),
  ]);
  await expect.poll(() => chatRequestBodies.length).toBe(2);
  await page.waitForTimeout(100);
  expect(chatRequestBodies).toHaveLength(2);

  const secondRequestBody = JSON.parse(chatRequestBodies[1] ?? "null") as {
    messages?: Array<{
      parts?: Array<{ text?: string; type?: string; url?: string }>;
      role?: string;
    }>;
  } | null;
  expect(secondRequestBody?.messages).toHaveLength(1);
  const retriedUserMessage = secondRequestBody?.messages?.[0];
  expect(retriedUserMessage?.role).toBe("user");
  expect(retriedUserMessage?.parts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "file",
        url: expect.stringContaining("data:text/plain;base64,"),
      }),
      expect.objectContaining({
        text: "描述这张铭牌图片",
        type: "text",
      }),
    ]),
  );

  await expect(editButton).toBeEnabled();
  await editButton.click();
  await expect(prompt).toHaveValue("描述这张铭牌图片");
  await expect(prompt).toBeEditable();
  await expect(
    assistant.getByRole("list", { name: "待发送附件" }),
  ).toContainText("failed-engine-note.txt");
  await expect(
    assistant.getByText(
      "[已发送附件：failed-engine-note.txt；后续追问请重新上传]",
    ),
  ).toHaveCount(0);
  await page.waitForTimeout(200);
  expect(chatRequestBodies).toHaveLength(2);
});

test("locks attachment controls while validating image bytes", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const originalArrayBuffer = File.prototype.arrayBuffer;
    Object.defineProperty(File.prototype, "arrayBuffer", {
      configurable: true,
      value: function arrayBuffer(this: File): Promise<ArrayBuffer> {
        if (this.name !== "slow-engine.png") {
          return originalArrayBuffer.call(this);
        }

        return new Promise<ArrayBuffer>((resolve, reject) => {
          const browserGlobal = globalThis as typeof globalThis & {
            __releaseAttachmentValidation?: () => void;
          };
          browserGlobal.__releaseAttachmentValidation = () => {
            delete browserGlobal.__releaseAttachmentValidation;
            void originalArrayBuffer.call(this).then(resolve, reject);
          };
        });
      },
    });
  });
  await page.goto("/chat");

  const assistant = page.getByRole("complementary", {
    name: "AI 营销分析助手",
  });
  const prompt = assistant.getByPlaceholder("输入问题，可附上文件或图片…");
  const fileInput = assistant.getByLabel("选择文件或图片");
  const sendButton = assistant.getByRole("button", { name: "发送问题" });
  await prompt.fill("描述图片内容");
  await fileInput.setInputFiles({
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAHUlEQVR4nGNQTl72nxLMMGrA/9EwWDYaBsnDIgwAMoorH0C43vMAAAAASUVORK5CYII=",
      "base64",
    ),
    mimeType: "image/png",
    name: "slow-engine.png",
  });

  const attachmentValidationStatus = assistant
    .getByRole("status")
    .filter({ hasText: "正在验证附件安全性" });
  await expect(attachmentValidationStatus).toBeVisible();
  await expect(fileInput).toBeDisabled();
  await expect(
    assistant.getByRole("button", { name: "正在验证附件" }),
  ).toBeDisabled();
  await expect(sendButton).toBeDisabled();

  await page.evaluate(() => {
    const browserGlobal = globalThis as typeof globalThis & {
      __releaseAttachmentValidation?: () => void;
    };
    browserGlobal.__releaseAttachmentValidation?.();
  });

  await expect(attachmentValidationStatus).toHaveCount(0);
  await expect(assistant.getByText("slow-engine.png")).toBeVisible();
  await expect(sendButton).toBeEnabled();
});

test("recovers without sending when the browser aborts an attachment read", async ({
  page,
}) => {
  let chatRequests = 0;
  await page.route("**/api/chat", async (route) => {
    chatRequests += 1;
    await route.abort();
  });
  await page.addInitScript(() => {
    const readAsDataURL = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function (blob: Blob) {
      this.addEventListener("loadstart", () => this.abort(), { once: true });
      readAsDataURL.call(this, blob);
    };
  });

  await page.goto("/chat");
  const assistant = page.getByRole("complementary", {
    name: "AI 营销分析助手",
  });
  const prompt = assistant.getByPlaceholder(/输入问题，可附上文件/);
  const sendButton = assistant.getByRole("button", { name: "发送问题" });
  await assistant.getByLabel(/选择文件/).setInputFiles({
    buffer: Buffer.from("read abort fixture", "utf8"),
    mimeType: "text/plain",
    name: "abort-me.txt",
  });
  await prompt.fill("概述附件内容");
  await sendButton.click();

  await expect(assistant.getByRole("alert")).toContainText(
    "附件读取失败，请重新选择后再试。",
  );
  await expect(sendButton).toBeEnabled();
  expect(chatRequests).toBe(0);
});

test("returns a structured health response", async ({ request }) => {
  const response = await request.get("/api/health/live");

  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("application/json");

  const body: unknown = await response.json();
  expect(body).toEqual(
    expect.objectContaining({
      service: "global-diesel-regulations",
      status: "ok",
    }),
  );

  const readiness = await request.get("/api/health/ready");
  expect(readiness.ok()).toBe(true);
  await expect(readiness.json()).resolves.toEqual(
    expect.objectContaining({
      checks: {
        aiChatAdmission: "ok",
        aiChatRateLimit: "ok",
        database: "ok",
      },
      service: "global-diesel-regulations",
      status: "ok",
    }),
  );
});

test("serves browser and Apple touch icons without 404s", async ({ request }) => {
  for (const path of [
    "/icon.svg",
    "/apple-touch-icon.png",
  ]) {
    const response = await request.get(path);

    expect(response.ok(), `${path} should resolve`).toBe(true);
    expect(response.headers()["content-type"]).toContain("image/");
    expect((await response.body()).byteLength).toBeGreaterThan(0);
  }
});
