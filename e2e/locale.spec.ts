import { expect, test } from "@playwright/test";

import { localeFromBrowserCookie } from "../src/i18n/locale";
import {
  productFitEvaluationSchema,
  productListResponseSchema,
} from "../src/features/product-fit/schemas";

function chatTextStream(text: string, id: string): string {
  return [
    { type: "start" },
    { id, type: "text-start" },
    { delta: text, id, type: "text-delta" },
    { id, type: "text-end" },
    { finishReason: "stop", type: "finish" },
  ]
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("") + "data: [DONE]\n\n";
}

test.beforeEach(async ({ context }) => {
  await context.clearCookies();
});

test("defaults to English without a locale cookie even when legacy storage is Chinese", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("diesel_locale", "zh-CN");
  });
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Global diesel regulations and product database",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Primary navigation" }),
  ).toBeVisible();
  await expect(
    page.getByText("Regulatory Intelligence", { exact: true }),
  ).toHaveCount(1);
  await expect(page.getByText("REGULATORY SCAN", { exact: true })).toBeVisible();
  await expect(page.getByText("PRODUCT FIT", { exact: true })).toBeVisible();
  await expect(page.getByText("MARKET BRIEF", { exact: true })).toBeVisible();
  await expect(page.getByText("Demo fixture", { exact: true }).first()).toBeVisible();
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    "Global Diesel Intelligence",
  );
  await expect(
    page.getByText(
      "A traceable workspace for regulations, product fit, and market analysis",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByTestId("locale-toggle").getByRole("button", {
      exact: true,
      name: "EN",
    }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("localizes a no-data country while preserving its ISO3 code", async ({
  page,
}) => {
  await page.goto("/countries/USA");

  await expect(page.getByTestId("country-no-data")).toBeVisible();
  await expect(page.getByTestId("country-no-data")).toHaveAttribute(
    "role",
    "status",
  );
  await expect(page.getByTestId("country-no-data")).toHaveAttribute(
    "aria-live",
    "polite",
  );
  await expect(page.getByTestId("country-no-data")).toHaveAttribute(
    "aria-atomic",
    "true",
  );
  await expect(
    page.getByRole("heading", {
      exact: true,
      name: "United States of America (USA) has no data",
    }),
  ).toBeVisible();

  const response = await page.request.post("/api/preferences/locale", {
    data: { locale: "zh-CN" },
  });
  expect(response.ok()).toBe(true);
  await page.reload();

  await expect(page).toHaveURL(/\/countries\/USA$/u);
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByTestId("country-no-data")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      exact: true,
      name: "美国（USA）暂无数据",
    }),
  ).toBeVisible();
});

test("localizes the public 404 without losing the unknown path", async ({
  page,
}) => {
  const path = "/missing-public-locale-contract";
  const response = await page.goto(path);

  expect(response?.status()).toBe(404);
  await expect(page).toHaveURL(new RegExp(`${path}$`, "u"));
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  await expect(page.getByText("Page not found", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Return to map" })).toBeVisible();
  await expect(page).toHaveTitle(
    "Page not found · Global Regulations & Market Intelligence",
  );
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    "Page not found",
  );
  await expect(
    page.locator('meta[property="og:description"]'),
  ).toHaveAttribute(
    "content",
    "This path does not exist or is no longer available. Check the link or return to the map.",
  );
  await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute(
    "content",
    "en_US",
  );

  await page
    .getByTestId("locale-toggle")
    .getByRole("button", { name: "中文", exact: true })
    .click();

  await expect(page).toHaveURL(new RegExp(`${path}$`, "u"));
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByText("页面不存在", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "返回地图" })).toBeVisible();
  await expect(page).toHaveTitle("页面不存在 · 全球法规与市场分析平台");
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    "页面不存在",
  );
  await expect(
    page.locator('meta[property="og:description"]'),
  ).toHaveAttribute(
    "content",
    "访问的路径不存在或已下线。请检查链接，或返回地图。",
  );
  await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute(
    "content",
    "zh_CN",
  );
});

test("retires active chat streams in both locale directions", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "The controlled stream-ordering regression only needs one browser project.",
  );

  const staleMarker = "DO NOT RENDER late English chat stream";
  let releaseStaleResponse = () => {};
  let markStaleRequestStarted = () => {};
  let markStaleHandlerSettled = () => {};
  const staleResponseGate = new Promise<void>((resolve) => {
    releaseStaleResponse = resolve;
  });
  const staleRequestStarted = new Promise<void>((resolve) => {
    markStaleRequestStarted = resolve;
  });
  const staleHandlerSettled = new Promise<void>((resolve) => {
    markStaleHandlerSettled = resolve;
  });

  await page.route(
    "**/api/chat",
    async (route) => {
      const body = route.request().postDataJSON() as { locale?: unknown };
      expect(body.locale).toBe("en");
      markStaleRequestStarted();
      await staleResponseGate;
      try {
        await route.fulfill({
          body: chatTextStream(staleMarker, "stale-answer"),
          headers: {
            "content-type": "text/event-stream",
            "x-vercel-ai-ui-message-stream": "v1",
          },
          status: 200,
        });
      } catch {
        // The locale change must abort this intercepted English request before
        // the controlled late response is released.
      } finally {
        markStaleHandlerSettled();
      }
    },
    { times: 1 },
  );

  await page.goto("/chat");
  const englishChat = page.locator("[data-sales-chat-root]");
  await englishChat
    .getByRole("textbox", { name: "Enter a question" })
    .fill("Start a deliberately delayed English answer.");
  await englishChat.getByRole("button", { name: "Send question" }).click();
  await staleRequestStarted;

  const requestFailed = page.waitForEvent("requestfailed", (request) =>
    new URL(request.url()).pathname === "/api/chat",
  );
  await page
    .getByTestId("locale-toggle")
    .getByRole("button", { exact: true, name: "中文" })
    .click();

  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  const failedRequest = await requestFailed;
  expect(failedRequest.failure()?.errorText).toMatch(/ERR_ABORTED/u);
  const chineseChat = page.locator("[data-sales-chat-root]");
  await expect(
    chineseChat.getByRole("textbox", { name: "输入问题" }),
  ).toBeEditable();

  releaseStaleResponse();
  await staleHandlerSettled;
  await page.waitForTimeout(100);
  await expect(page.getByText(staleMarker, { exact: true })).toHaveCount(0);

  const staleChineseMarker = "不得显示迟到的中文对话流";
  let releaseStaleChineseResponse = () => {};
  let markStaleChineseRequestStarted = () => {};
  let markStaleChineseHandlerSettled = () => {};
  const staleChineseResponseGate = new Promise<void>((resolve) => {
    releaseStaleChineseResponse = resolve;
  });
  const staleChineseRequestStarted = new Promise<void>((resolve) => {
    markStaleChineseRequestStarted = resolve;
  });
  const staleChineseHandlerSettled = new Promise<void>((resolve) => {
    markStaleChineseHandlerSettled = resolve;
  });
  await page.route(
    "**/api/chat",
    async (route) => {
      const body = route.request().postDataJSON() as { locale?: unknown };
      expect(body.locale).toBe("zh-CN");
      markStaleChineseRequestStarted();
      await staleChineseResponseGate;
      try {
        await route.fulfill({
          body: chatTextStream(staleChineseMarker, "stale-chinese-answer"),
          headers: {
            "content-type": "text/event-stream",
            "x-vercel-ai-ui-message-stream": "v1",
          },
          status: 200,
        });
      } catch {
        // The reverse locale change must abort the Chinese request too.
      } finally {
        markStaleChineseHandlerSettled();
      }
    },
    { times: 1 },
  );
  await chineseChat
    .getByRole("textbox", { name: "输入问题" })
    .fill("开始一个故意延迟的中文回答。");
  await chineseChat.getByRole("button", { name: "发送问题" }).click();
  await staleChineseRequestStarted;

  const chineseRequestFailed = page.waitForEvent("requestfailed", (request) =>
    new URL(request.url()).pathname === "/api/chat",
  );
  await page
    .getByTestId("locale-toggle")
    .getByRole("button", { exact: true, name: "EN" })
    .click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  const failedChineseRequest = await chineseRequestFailed;
  expect(failedChineseRequest.failure()?.errorText).toMatch(/ERR_ABORTED/u);

  releaseStaleChineseResponse();
  await staleChineseHandlerSettled;
  await page.waitForTimeout(100);
  await expect(
    page.getByText(staleChineseMarker, { exact: true }),
  ).toHaveCount(0);

  const currentMarker = "Current English request completed";
  let currentLocale: unknown;
  await page.route(
    "**/api/chat",
    async (route) => {
      const body = route.request().postDataJSON() as { locale?: unknown };
      currentLocale = body.locale;
      await route.fulfill({
        body: chatTextStream(currentMarker, "current-answer"),
        headers: {
          "content-type": "text/event-stream",
          "x-vercel-ai-ui-message-stream": "v1",
        },
        status: 200,
      });
    },
    { times: 1 },
  );
  const currentEnglishChat = page.locator("[data-sales-chat-root]");
  await currentEnglishChat
    .getByRole("textbox", { name: "Enter a question" })
    .fill("Start a new English request.");
  await currentEnglishChat
    .getByRole("button", { name: "Send question" })
    .click();

  await expect(
    currentEnglishChat.getByText(currentMarker, { exact: true }),
  ).toBeVisible();
  expect(currentLocale).toBe("en");
  await expect(page.getByText(staleMarker, { exact: true })).toHaveCount(0);
  await expect(
    page.getByText(staleChineseMarker, { exact: true }),
  ).toHaveCount(0);
});

test("offers a localized keyboard shortcut to the main content", async ({
  page,
}, testInfo) => {
  await page.goto("/");

  const englishSkipLink = page.getByRole("link", {
    name: "Skip to main content",
  });
  // Safari on macOS uses Option+Tab to include links in sequential keyboard
  // navigation unless the user enables the system-wide full-keyboard setting.
  const tabKey = testInfo.project.name === "core-webkit" ? "Alt+Tab" : "Tab";
  await page.keyboard.press(tabKey);
  await expect(englishSkipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();

  const response = await page.request.post("/api/preferences/locale", {
    data: { locale: "zh-CN" },
  });
  expect(response.ok()).toBe(true);
  // Start a fresh document so sequential focus navigation begins at the
  // document boundary instead of retaining the pre-reload #main-content anchor.
  await page.goto("about:blank");
  await page.goto("/");
  await page.keyboard.press(tabKey);
  await expect(page.getByRole("link", { name: "跳到主要内容" })).toBeFocused();
});

test("announces the asynchronous country-summary load", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "The live-region contract only needs one browser project.",
  );

  let releaseRequest = () => {};
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route("**/api/countries", async (route) => {
    await requestGate;
    await route.continue();
  });

  await page.goto("/");
  const status = page.getByRole("status").filter({
    hasText: "Syncing country summaries…",
  });
  await expect(status).toBeVisible();
  await expect(status).toHaveAttribute("aria-busy", "true");

  releaseRequest();
  await expect(status).toBeHidden();
});

test("switches to Chinese without losing the path or query and persists it", async ({
  context,
  page,
}) => {
  const hydrationErrors: string[] = [];
  const chunkLoadErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("Hydration failed")) {
      hydrationErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    if (error.name === "ChunkLoadError" || error.message.includes("ChunkLoadError")) {
      chunkLoadErrors.push(error.message);
    }
  });
  await page.goto("/map?utm_source=locale-test");
  await expect(page).toHaveTitle(
    "Global map · Global Regulations & Market Intelligence",
  );
  await page
    .getByTestId("locale-toggle")
    .getByRole("button", { name: "中文", exact: true })
    .click();

  await expect(page).toHaveURL(/\/map\?utm_source=locale-test$/u);
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page).toHaveTitle("全球地图 · 全球法规与市场分析平台");
  await expect(
    page.getByRole("heading", { level: 1, name: "全球柴油机法规地图" }),
  ).toBeVisible();
  await expect(page.getByTestId("map-canvas-container")).toHaveAttribute(
    "data-map-ready",
    "true",
  );
  await expect(page.getByRole("button", { name: "放大地图" })).toBeVisible();
  await expect(page.getByRole("button", { name: "缩小地图" })).toBeVisible();
  await expect(
    page.getByText("法规、产品适配与市场分析的可追溯工作台", { exact: true }),
  ).toBeVisible();
  expect(
    (await context.cookies()).find(({ name }) => name === "diesel_locale")
      ?.value,
  ).toBe("zh-CN");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
  await page.getByRole("link", { exact: true, name: "首页" }).click();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: /全球柴油机法规.*产品数据库/u,
    }),
  ).toBeVisible();
  await expect(page.getByText("法规情报", { exact: true })).toHaveCount(1);
  await expect(page.getByText("法规扫描", { exact: true })).toBeVisible();
  await expect(page.getByText("产品适配", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("市场简报", { exact: true })).toBeVisible();
  await expect(page.getByText("演示数据", { exact: true }).first()).toBeVisible();
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    "全球柴油机法规情报",
  );
  expect(hydrationErrors).toEqual([]);
  expect(chunkLoadErrors).toEqual([]);
});

test("ignores an old-locale country request that settles after the new locale", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "The request-ordering regression only needs one browser project.",
  );

  let requestCount = 0;
  let releaseInitialResponse = () => {};
  let markInitialRequestStarted = () => {};
  let markInitialHandlerSettled = () => {};
  const initialResponseGate = new Promise<void>((resolve) => {
    releaseInitialResponse = resolve;
  });
  const initialRequestStarted = new Promise<void>((resolve) => {
    markInitialRequestStarted = resolve;
  });
  const initialHandlerSettled = new Promise<void>((resolve) => {
    markInitialHandlerSettled = resolve;
  });

  await page.route("**/api/countries", async (route) => {
    requestCount += 1;
    const isInitialEnglishRequest = requestCount === 1;
    if (isInitialEnglishRequest) {
      markInitialRequestStarted();
      await initialResponseGate;
    }

    try {
      await route.fulfill({
        body: JSON.stringify({ error: { code: "INTERNAL_ERROR" } }),
        contentType: "application/json",
        status: 500,
      });
    } catch {
      // The locale switch should abort the first request before this controlled
      // response is released. Playwright may then reject the late fulfillment.
    } finally {
      if (isInitialEnglishRequest) {
        markInitialHandlerSettled();
      }
    }
  });

  await page.goto("/");
  await initialRequestStarted;
  await page
    .getByTestId("locale-toggle")
    .getByRole("button", { name: "中文", exact: true })
    .click();

  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect.poll(() => requestCount).toBeGreaterThanOrEqual(2);
  await expect(
    page.getByRole("alert").filter({
      hasText: "国家覆盖摘要暂时无法加载，请进入地图重试。",
    }),
  ).toBeVisible();

  releaseInitialResponse();
  await initialHandlerSettled;
  await page.waitForTimeout(100);
  await expect(
    page.getByText(
      "Country coverage could not be loaded. Open the map to retry.",
      { exact: true },
    ),
  ).toHaveCount(0);
  await expect(
    page.getByText("国家覆盖摘要暂时无法加载，请进入地图重试。", {
      exact: true,
    }),
  ).toBeVisible();
});

test("localizes a late map error from its code without rendering the server message", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "The delayed map-error regression only needs one browser project.",
  );

  let releaseResponse = () => {};
  let markRequestStarted = () => {};
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  const requestStarted = new Promise<void>((resolve) => {
    markRequestStarted = resolve;
  });

  await page.route("**/api/countries", async (route) => {
    markRequestStarted();
    await responseGate;
    await route.fulfill({
      body: JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "DO NOT RENDER stale English server copy",
        },
      }),
      contentType: "application/json",
      status: 500,
    });
  });

  await page.goto("/map");
  await requestStarted;
  await page
    .getByTestId("locale-toggle")
    .getByRole("button", { name: "中文", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");

  releaseResponse();
  const alert = page.getByRole("alert").filter({
    hasText: "国家摘要暂时不可用，请稍后重试。",
  });
  await expect(alert).toBeVisible();
  await expect(
    page.getByText("DO NOT RENDER stale English server copy", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      "Country summaries are temporarily unavailable. Please try again later.",
      { exact: true },
    ),
  ).toHaveCount(0);
});

test("shows locale-change failures and preserves state until a retry succeeds", async ({
  context,
  page,
}) => {
  const preservedUrl = /\/?utm_source=locale-failure$/u;
  let rejectLocaleChange = true;

  await page.goto("/?utm_source=locale-failure");
  await page.route("**/api/preferences/locale", async (route) => {
    if (rejectLocaleChange) {
      await route.fulfill({
        body: JSON.stringify({ message: "DO NOT RENDER server locale error" }),
        contentType: "application/json",
        status: 503,
      });
      return;
    }
    await route.continue();
  });

  const localeToggle = page.getByTestId("locale-toggle");
  const englishButton = localeToggle.getByRole("button", {
    exact: true,
    name: "EN",
  });
  const chineseButton = localeToggle.getByRole("button", {
    exact: true,
    name: "中文",
  });

  await chineseButton.click();
  const englishAlert = page.getByRole("alert").filter({
    hasText: "Language change failed.",
  });
  await expect(englishAlert).toBeVisible();
  await expect.poll(async () => {
    const bounds = await englishAlert.evaluate((element) => {
      const rectangle = element.getBoundingClientRect();
      return {
        bottom: rectangle.bottom <= window.innerHeight,
        left: rectangle.left >= 0,
        right: rectangle.right <= window.innerWidth,
        top: rectangle.top >= 0,
      };
    });
    return bounds;
  }).toEqual({ bottom: true, left: true, right: true, top: true });
  await expect(englishButton).toHaveAttribute("aria-pressed", "true");
  await expect(chineseButton).toHaveAttribute("aria-pressed", "false");
  await expect(chineseButton).toBeEnabled();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveURL(preservedUrl);
  expect(
    (await context.cookies()).find(({ name }) => name === "diesel_locale"),
  ).toBeUndefined();
  await expect(
    page.getByText("DO NOT RENDER server locale error", { exact: true }),
  ).toHaveCount(0);

  rejectLocaleChange = false;
  await chineseButton.click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(englishAlert).toHaveCount(0);
  await expect(page).toHaveURL(preservedUrl);
  expect(
    (await context.cookies()).find(({ name }) => name === "diesel_locale")
      ?.value,
  ).toBe("zh-CN");

  rejectLocaleChange = true;
  await englishButton.click();
  const chineseAlert = page.getByRole("alert").filter({
    hasText: "语言切换失败。",
  });
  await expect(chineseAlert).toBeVisible();
  await expect(englishButton).toBeEnabled();
  await expect(englishButton).toHaveAttribute("aria-pressed", "false");
  await expect(chineseButton).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page).toHaveURL(preservedUrl);
  expect(
    (await context.cookies()).find(({ name }) => name === "diesel_locale")
      ?.value,
  ).toBe("zh-CN");

  rejectLocaleChange = false;
  await englishButton.click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(chineseAlert).toHaveCount(0);
  await expect(page).toHaveURL(preservedUrl);
  expect(
    (await context.cookies()).find(({ name }) => name === "diesel_locale")
      ?.value,
  ).toBe("en");
  await expect(
    page.getByText("DO NOT RENDER server locale error", { exact: true }),
  ).toHaveCount(0);
});

test("reports a successful locale response that was not persisted and retries", async ({
  context,
  page,
}) => {
  const preservedUrl = /\/?utm_source=locale-cookie-rejected$/u;
  let omitLocaleCookie = true;

  await page.route("**/api/preferences/locale", async (route) => {
    if (!omitLocaleCookie) {
      await route.continue();
      return;
    }

    await route.fulfill({
      body: JSON.stringify({ locale: "zh-CN", status: "ok" }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/?utm_source=locale-cookie-rejected");

  const localeToggle = page.getByTestId("locale-toggle");
  const englishButton = localeToggle.getByRole("button", {
    exact: true,
    name: "EN",
  });
  const chineseButton = localeToggle.getByRole("button", {
    exact: true,
    name: "中文",
  });
  const failure = page.getByRole("alert").filter({
    hasText: "Language change failed.",
  });

  await chineseButton.click();

  await expect(failure).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(englishButton).toHaveAttribute("aria-pressed", "true");
  await expect(chineseButton).toHaveAttribute("aria-pressed", "false");
  await expect(chineseButton).toBeEnabled();
  await expect(page).toHaveURL(preservedUrl);
  expect(
    (await context.cookies()).find(({ name }) => name === "diesel_locale"),
  ).toBeUndefined();

  omitLocaleCookie = false;
  await chineseButton.click();

  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(failure).toHaveCount(0);
  await expect(page).toHaveURL(preservedUrl);
  expect(
    (await context.cookies()).find(({ name }) => name === "diesel_locale")
      ?.value,
  ).toBe("zh-CN");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page).toHaveURL(preservedUrl);
});

test("fully reloads when a timed-out locale RSC settles before rollback responds", async ({
  context,
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "The controlled RSC recovery path only needs one browser project.",
  );

  const expectedUrl =
    "/map?utm_source=locale-refresh-recovery#main-content";
  await page.goto(expectedUrl);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  const historyLength = await page.evaluate(() => window.history.length);

  const persistedLocales: string[] = [];
  let delayedRefreshSettled = false;
  let releaseDelayedRefresh = () => {};
  const delayedRefreshGate = new Promise<void>((resolve) => {
    releaseDelayedRefresh = resolve;
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      request.method() === "POST" &&
      url.pathname === "/api/preferences/locale"
    ) {
      const body = JSON.parse(request.postData() ?? "{}") as {
        locale?: unknown;
      };
      if (typeof body.locale === "string") {
        persistedLocales.push(body.locale);
      }
      if (body.locale === "en") {
        releaseDelayedRefresh();
        await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
      }
      await route.continue();
      return;
    }
    if (
      request.method() === "GET" &&
      url.pathname === "/map" &&
      request.headers().rsc === "1"
    ) {
      await delayedRefreshGate;
      await route.continue();
      delayedRefreshSettled = true;
      return;
    }
    await route.continue();
  });

  await page
    .getByTestId("locale-toggle")
    .getByRole("button", { exact: true, name: "中文" })
    .click();

  await expect
    .poll(() => persistedLocales, { timeout: 20_000 })
    .toEqual(["zh-CN", "en"]);
  await expect.poll(() => delayedRefreshSettled).toBe(true);
  await expect(page).toHaveURL(
    /\/map\?utm_source=locale-refresh-recovery#main-content$/u,
  );
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByTestId("locale-toggle")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect.poll(() =>
    page.evaluate(() =>
      (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming)
        .type,
    ),
  ).toBe("reload");
  expect(await page.evaluate(() => window.history.length)).toBe(historyLength);
  expect(
    (await context.cookies()).find(({ name }) => name === "diesel_locale")
      ?.value,
  ).toBe("en");
});

test("ignores a locale failure that settles after the active locale changed", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "The stale locale-request regression only needs one browser project.",
  );

  let releaseOldRequest = () => {};
  let markOldRequestStarted = () => {};
  let markOldRequestSettled = () => {};
  const oldRequestGate = new Promise<void>((resolve) => {
    releaseOldRequest = resolve;
  });
  const oldRequestStarted = new Promise<void>((resolve) => {
    markOldRequestStarted = resolve;
  });
  const oldRequestSettled = new Promise<void>((resolve) => {
    markOldRequestSettled = resolve;
  });

  await page.goto("/");
  await page.route("**/api/preferences/locale", async (route) => {
    markOldRequestStarted();
    await oldRequestGate;
    try {
      await route.fulfill({
        body: JSON.stringify({ message: "DO NOT RENDER stale locale error" }),
        contentType: "application/json",
        status: 503,
      });
    } catch {
      // Reloading in the new locale intentionally aborts this old request.
    } finally {
      markOldRequestSettled();
    }
  });

  await page
    .getByTestId("locale-toggle")
    .getByRole("button", { name: "中文", exact: true })
    .click();
  await oldRequestStarted;

  const response = await page.request.post("/api/preferences/locale", {
    data: { locale: "zh-CN" },
  });
  expect(response.ok()).toBe(true);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");

  releaseOldRequest();
  await oldRequestSettled;
  await page.waitForTimeout(100);
  await expect(
    page.getByText("DO NOT RENDER stale locale error", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("语言切换失败。", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Language change failed.", { exact: true }),
  ).toHaveCount(0);
});

test("does not depend on browser storage when saving the locale cookie", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Storage disabled by privacy policy.", "SecurityError");
    };
  });
  await page.goto("/");

  await page
    .getByTestId("locale-toggle")
    .getByRole("button", { name: "中文", exact: true })
    .click();

  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: /全球柴油机法规.*产品数据库/u,
    }),
  ).toBeVisible();
});

test("relocalizes an untouched deep-link prompt without overwriting an edit", async ({
  page,
}) => {
  await page.goto(
    "/chat?countryIso3=CHN&applicationScope=non-road&powerKw=100&asOf=2026-08-12",
  );
  const input = page.locator("#sales-chat-input");
  await expect(input).toHaveValue(
    /Analyze Non-road regulations for CHN at 100 kW, as of Aug 12, 2026/u,
  );

  await page
    .getByTestId("locale-toggle")
    .getByRole("button", { name: "中文", exact: true })
    .click();
  await expect(input).toHaveValue(
    /请分析 CHN 的非道路 100 kW 法规，判断日期 2026年8月12日/u,
  );

  await input.fill("保留这条用户编辑的内容");
  await page
    .getByTestId("locale-toggle")
    .getByRole("button", { name: "EN", exact: true })
    .click();
  await expect(input).toHaveValue("保留这条用户编辑的内容");
});

test("keeps the locale control reachable on a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ height: 667, width: 375 });
  await page.goto("/chat");
  await expect(page).toHaveTitle(
    "AI chat · Global Regulations & Market Intelligence",
  );

  const toggle = page.getByTestId("locale-toggle");
  await expect(toggle).toBeVisible();
  await toggle.getByRole("button", { name: "中文" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page).toHaveTitle("AI 对话 · 全球法规与市场分析平台");
  await expect(
    page.getByRole("heading", { name: "和数据一起讨论下一步" }),
  ).toBeVisible();
});

for (const locale of ["en", "zh-CN"] as const) {
  test(`fully exposes labeled header navigation at responsive boundaries in ${locale}`, async ({ page }) => {
    const response = await page.request.post("/api/preferences/locale", { data: { locale } });
    expect(response.ok()).toBe(true);
    await page.goto("/chat");
    const navigation = page.getByRole("navigation", { name: locale === "en" ? "Primary navigation" : "主导航" });
    const labels = locale === "en" ? ["Home", "Chat", "Map", "Compare", "Saved"] : ["首页", "对话", "地图", "比较", "已保存"];
    await expect(navigation.getByRole("link")).toHaveText(labels);

    const expectHeaderFits = async (width: number) => {
      // Visibility alone does not prove a link is fully inside its scrollport.
      // Check before any click can automatically scroll it into view.
      await expect.poll(() => navigation.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const toggle = document.querySelector<HTMLElement>('[data-testid="locale-toggle"]');
        if (!toggle) throw new Error("Missing the header language control.");
        const toggleBounds = toggle.getBoundingClientRect();
        const links = Array.from(element.querySelectorAll("a"));
        const controls = [...links, ...toggle.querySelectorAll("button")];
        return {
          clippedLabels: links.filter((link) => {
            const rect = link.getBoundingClientRect();
            return rect.left < bounds.left + element.clientLeft - 1 ||
              rect.right > bounds.right - element.clientLeft + 1 ||
              rect.top < 0 || rect.bottom > window.innerHeight;
          }).map((link) => link.textContent?.trim()),
          documentOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          languageControlOutside: toggleBounds.left < 0 || toggleBounds.right > window.innerWidth,
          navigationOverflow: element.scrollWidth > element.clientWidth + 1,
          // Navigation and language controls occupy different header rows.
          overlap: bounds.left < toggleBounds.right - 1 &&
            bounds.right > toggleBounds.left + 1 &&
            bounds.top < toggleBounds.bottom - 1 &&
            bounds.bottom > toggleBounds.top + 1,
          undersizedControls: controls.filter((control) => {
            const rect = control.getBoundingClientRect();
            return rect.width < 32 || rect.height < 32;
          }).map((control) => control.textContent?.trim()),
        };
      }), { message: `${locale} header at ${width}px` }).toEqual({
        clippedLabels: [], documentOverflow: false, languageControlOutside: false,
        navigationOverflow: false, overlap: false, undersizedControls: [],
      });
    };

    for (const width of [320, 375, 393, 639, 640, 767, 768, 1024]) {
      await page.setViewportSize({ height: 720, width });
      await expectHeaderFits(width);
      if ([320, 640, 1024].includes(width)) {
        await navigation.locator("xpath=ancestor::header").screenshot({
          path: test.info().outputPath(`header-${locale}-${width}.png`),
        });
      }
    }

    await page.setViewportSize({ height: 720, width: 320 });
    for (const [index, pathname] of ["/", "/chat", "/map", "/compare", "/analyses"].entries()) {
      await expectHeaderFits(320);
      await navigation.getByRole("link", { exact: true, name: labels[index]! }).click();
      await expect.poll(() => new URL(page.url()).pathname).toBe(pathname);
      await expect(navigation.getByRole("link", { exact: true, name: labels[index]! }))
        .toHaveAttribute("aria-current", "page");
      await expectHeaderFits(320);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
    }
  });
}

test("keeps the home page inside a 320px viewport in both locales", async ({
  context,
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "One Chromium project covers the deterministic narrow-layout boundary.",
  );
  await context.clearCookies();
  await page.setViewportSize({ height: 667, width: 320 });
  await page.goto("/");

  const expectNoHorizontalOverflow = async () => {
    await expect
      .poll(() =>
        page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        })),
      )
      .toEqual({ clientWidth: 320, scrollWidth: 320 });
  };

  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expectNoHorizontalOverflow();

  await page
    .getByTestId("locale-toggle")
    .getByRole("button", { exact: true, name: "中文" })
    .click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expectNoHorizontalOverflow();
});

test("localizes visible country names and dates while preserving the ISO query", async ({
  page,
}) => {
  // This case verifies localized UI, not Next development compilation speed.
  // Compile the real read-only routes in a separately bounded preparation step
  // so the original 10-second UI assertions do not include their cold builds.
  await test.step("Prepare the real catalog and fit routes before locale assertions", async () => {
    const products = await page.request.get("/api/products", { timeout: 30_000 });
    expect(products.status()).toBe(200);
    const catalog = productListResponseSchema.parse(await products.json());
    expect(catalog.products.some(
      (product) => product.modelCode === "DEMO-ENG-100",
    )).toBe(true);
    const fit = await page.request.post("/api/product-fit", {
      data: {
        applicationScope: "non-road",
        asOf: "2026-08-12",
        countryIso3: "CHN",
        powerKw: 100,
        productModelCode: "DEMO-ENG-100",
      },
      timeout: 30_000,
    });
    expect(fit.status()).toBe(200);
    const evaluation = productFitEvaluationSchema.parse(await fit.json());
    expect(evaluation.input).toMatchObject({
      applicationScope: "non-road",
      countryIso3: "CHN",
      powerKw: 100,
      productModelCode: "DEMO-ENG-100",
    });
    expect(evaluation.asOf).toBe("2026-08-12");
  }, { timeout: 30_000 });
  await page.goto(
    "/countries/CHN?applicationScope=non-road&asOf=2026-08-12&powerKw=100&productModelCode=DEMO-ENG-100",
  );

  await expect(page).toHaveTitle(
    "People's Republic of China (CHN) country details · Global Regulations & Market Intelligence",
  );
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    "People's Republic of China (CHN) country details",
  );
  await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute(
    "content",
    "en_US",
  );
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute(
    "content",
    "website",
  );
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    "https://diesel.jamesky.site/og.jpg",
  );
  await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute(
    "content",
    "Global diesel regulatory evidence network",
  );

  const detail = page.getByRole("dialog");
  await expect(
    detail.getByRole("heading", {
      exact: true,
      name: "China — demo fixture",
    }),
  ).toBeVisible();
  await expect(detail).toContainText("Aug 12, 2026");
  await expect(page.getByTestId("product-fit-result")).toBeVisible();
  await expect(page.getByTestId("product-record-trace")).toContainText(
    "Non-road",
  );
  await expect(page.getByTestId("product-fit-result")).toContainText(
    "Status: Active",
  );
  await expect(page.getByTestId("product-fit-result")).toContainText(
    "DEMO ONLY — Fictional China Non-road Stage A",
  );
  await expect(
    page.getByRole("radio", {
      name: "DEMO-ENG-100 · DEMO ONLY — Fictional Engine 100",
    }),
  ).toBeVisible();
  const jurisdictionSection = page.locator(
    'section[aria-labelledby="country-jurisdictions"]',
  );
  const marketSection = page.locator(
    'section[aria-labelledby="market-metrics"]',
  );
  const currentRegulationsSection = page.locator(
    'section[aria-labelledby="current-regulations"]',
  );
  const futureRegulationsSection = page.locator(
    'section[aria-labelledby="future-regulations"]',
  );
  await expect(jurisdictionSection).toContainText("Country");
  await expect(jurisdictionSection).toContainText(
    "DEMO ONLY — Fictional China Emissions Authority",
  );
  await expect(marketSection).toContainText(
    "DEMO ONLY — Fictional addressable units",
  );
  await expect(marketSection).toContainText(
    "FICTIONAL DEMO DATA — NOT A REAL REGULATION, CERTIFICATION, OR MARKET SOURCE. Fictional annual addressable unit count.",
  );
  await expect(currentRegulationsSection).toContainText(
    "DEMO ONLY — Fictional China Non-road Stage A",
  );
  await expect(futureRegulationsSection).toContainText(
    "DEMO ONLY — Fictional China Non-road Stage C Adopted",
  );
  await expect(detail).toContainText("DEMO ONLY — Fictional market report");
  await expect(page.getByTestId("product-fit-result")).not.toContainText("（");
  const applicabilitySources = page
    .getByTestId("country-applicability-summary")
    .locator("details");
  await applicabilitySources.locator("summary").click();
  await expect(applicabilitySources).toContainText("Jan 1, 2000 → Open");
  await expect(applicabilitySources).toContainText(
    "NOX · Jan 1, 2025 → Open",
  );
  await expect(applicabilitySources).toContainText("DEMO-CHN-NR-A");
  await expect(applicabilitySources).toContainText("DEMO-CHN-AUTHORITY");
  await expect(applicabilitySources).toContainText(
    "DEMO ONLY — Fictional emissions bulletin",
  );
  await expect(applicabilitySources).not.toContainText("2000-01-01–open");
  await expect(applicabilitySources).not.toContainText(
    "NOX 2025-01-01–open",
  );

  const response = await page.request.post("/api/preferences/locale", {
    data: { locale: "zh-CN" },
  });
  expect(response.ok()).toBe(true);
  await page.reload();
  await expect(page).toHaveURL(
    /\/countries\/CHN\?applicationScope=non-road&asOf=2026-08-12&powerKw=100&productModelCode=DEMO-ENG-100$/u,
  );
  await expect(
    detail.getByRole("heading", {
      exact: true,
      name: "中国（演示数据）",
    }),
  ).toBeVisible();
  await expect(detail).toContainText("2026年8月12日");
  await expect(page.getByTestId("product-record-trace")).toContainText(
    "非道路",
  );
  await expect(page.getByTestId("product-fit-result")).toContainText(
    "状态：有效",
  );
  await expect(page.getByTestId("product-fit-result")).toContainText(
    "仅限 Demo — 虚构中国非道路阶段 A",
  );
  await expect(page.getByTestId("product-fit-result")).not.toContainText(
    "DEMO ONLY — Fictional China Non-road Stage A",
  );
  await expect(
    page.getByRole("radio", {
      name: "DEMO-ENG-100 · 仅限 Demo — 虚构发动机 100",
    }),
  ).toBeVisible();
  await expect(
    page.getByText("DEMO ONLY — Fictional Engine 100", { exact: true }),
  ).toHaveCount(0);
  await expect(page).toHaveTitle(/中国（CHN）国家详情/u);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    "中国（CHN）国家详情",
  );
  await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute(
    "content",
    "zh_CN",
  );
  await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute(
    "content",
    "全球柴油机法规证据网络",
  );
  await expect(jurisdictionSection).toContainText(
    "仅限 Demo — 中国（演示数据）的虚构排放主管机构",
  );
  await expect(jurisdictionSection).not.toContainText(
    "DEMO ONLY — Fictional China Emissions Authority",
  );
  await expect(marketSection).toContainText("仅限 Demo — 虚构年度可触达台数");
  await expect(marketSection).not.toContainText(
    "DEMO ONLY — Fictional addressable units",
  );
  await expect(marketSection).toContainText(
    "虚构 Demo 数据 — 不是实际法规、认证或市场来源。虚构年度可触达台数。",
  );
  await expect(marketSection).not.toContainText(
    "FICTIONAL DEMO DATA — NOT A REAL REGULATION, CERTIFICATION, OR MARKET SOURCE. Fictional annual addressable unit count.",
  );
  await expect(currentRegulationsSection).toContainText(
    "仅限 Demo — 虚构中国非道路阶段 A",
  );
  await expect(currentRegulationsSection).not.toContainText(
    "DEMO ONLY — Fictional China Non-road Stage A",
  );
  await expect(futureRegulationsSection).toContainText(
    "仅限 Demo — 虚构中国非道路阶段 C（已采纳）",
  );
  await expect(futureRegulationsSection).not.toContainText(
    "DEMO ONLY — Fictional China Non-road Stage C Adopted",
  );
  await expect(detail).toContainText("DEMO ONLY — Fictional market report");
  await applicabilitySources.locator("summary").click();
  await expect(applicabilitySources).toContainText("2000年1月1日 → 开放");
  await expect(applicabilitySources).toContainText(
    "NOX · 2025年1月1日 → 开放",
  );
  await expect(applicabilitySources).toContainText("DEMO-CHN-NR-A");
  await expect(applicabilitySources).toContainText("DEMO-CHN-AUTHORITY");
  await expect(applicabilitySources).toContainText(
    "DEMO ONLY — Fictional emissions bulletin",
  );
  await expect(applicabilitySources).not.toContainText("2000-01-01–open");
  await expect(applicabilitySources).not.toContainText(
    "NOX 2025-01-01–open",
  );
});

for (const scenario of [
  { name: "encoded Chinese", first: "%7Ah-CN", fallback: null, locale: "zh-CN" },
  { name: "Chinese before English", first: "zh-CN", fallback: "en", locale: "zh-CN" },
  { name: "English before Chinese", first: "en", fallback: "zh-CN", locale: "en" },
  { name: "malformed before Chinese", first: "%E0%A4%A", fallback: "zh-CN", locale: "en" },
] as const) {
  test(`keeps locale Cookie parsing consistent for ${scenario.name}`, async ({
    baseURL,
    context,
    page,
  }) => {
    if (!baseURL) throw new Error("The locale test requires a local base URL.");
    const domain = new URL(baseURL).hostname;
    await context.addCookies([
      ...(scenario.fallback === null ? [] : [{
        domain,
        name: "diesel_locale",
        path: "/",
        value: scenario.fallback,
      }]),
      {
        domain,
        name: "diesel_locale",
        path: scenario.fallback === null ? "/" : "/chat",
        value: scenario.first,
      },
    ]);

    const response = await page.goto("/chat");
    if (!response) throw new Error("The locale document did not respond.");
    expect(response.status()).toBe(200);
    const expectedCookie = [scenario.first, scenario.fallback]
      .filter((value) => value !== null)
      .map((value) => `diesel_locale=${value}`)
      .join("; ");
    const requestHeaders = await response.request().allHeaders();
    expect(requestHeaders.cookie).toBe(expectedCookie);
    const browserCookie = await page.evaluate(() => document.cookie);
    expect(browserCookie).toBe(expectedCookie);
    expect(localeFromBrowserCookie(() => browserCookie)).toBe(scenario.locale);

    const serverHtml = await response.text();
    const serverLanguage = serverHtml.match(/<html\b[^>]*\blang="([^"]+)"/u)?.[1];
    expect.soft(serverLanguage).toBe(scenario.locale);
    await expect.soft(page.locator("html")).toHaveAttribute("lang", scenario.locale);

    // The capability response is deterministic and must never call a model.
    // Forward the exact browser Cookie header to compare the same input even
    // when a legacy, path-specific cookie would not accompany /api/chat.
    const chatResponse = await page.request.post("/api/chat", {
      headers: { cookie: browserCookie },
      data: {
        messages: [{
          id: "locale-cookie-capability",
          parts: [{ text: "What can you do?", type: "text" }],
          role: "user",
        }],
        sessionId: crypto.randomUUID(),
      },
    });
    expect(chatResponse.status()).toBe(200);
    expect.soft(await chatResponse.text()).toContain(
      scenario.locale === "en"
        ? "structured facts and traceable sources"
        : "结构化事实和可追溯来源",
    );
  });
}
