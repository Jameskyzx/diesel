import { expect, test } from "@playwright/test";

import { checkBrowserRuntimeErrors } from "./browser-runtime-errors";

test.beforeEach(async ({ context }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "One Chromium project covers the product-fit request-state contract.",
  );
  await context.clearCookies();
});

test("announces catalog loading and renders one accessible empty state", async ({
  page,
}) => {
  let releaseCatalog = () => {};
  let markCatalogStarted = () => {};
  const catalogGate = new Promise<void>((resolve) => {
    releaseCatalog = resolve;
  });
  const catalogStarted = new Promise<void>((resolve) => {
    markCatalogStarted = resolve;
  });

  await page.route("**/api/products", async (route) => {
    markCatalogStarted();
    await catalogGate;
    try {
      await route.fulfill({
        body: JSON.stringify({ products: [], status: "ok" }),
        contentType: "application/json",
        status: 200,
      });
    } catch {
      // React development checks can abort an obsolete effect before this
      // controlled response is released. The current request still settles.
    }
  });

  await page.goto("/countries/CHN");
  await catalogStarted;

  const form = page.getByTestId("product-fit-form");
  const loading = form.getByRole("status").filter({
    hasText: "Loading products…",
  });
  await expect(loading).toBeVisible();
  await expect(loading).toHaveAttribute("aria-live", "polite");
  await expect(loading).toHaveAttribute("aria-busy", "true");
  await expect(loading).toHaveAttribute("aria-atomic", "true");
  await expect(form).toHaveAttribute("aria-busy", "true");

  releaseCatalog();

  const empty = page.getByTestId("product-fit-empty-catalog");
  await expect(empty).toBeVisible();
  await expect(empty).toHaveAttribute("role", "status");
  await expect(empty).toHaveAttribute("aria-live", "polite");
  await expect(empty).toHaveAttribute("aria-atomic", "true");
  await expect(
    page.getByText("The product catalog is empty", { exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByText(
      "Product fit cannot run because the product catalog is empty.",
      { exact: true },
    ),
  ).toHaveCount(1);
  await expect(form).toHaveAttribute("aria-busy", "false");
  await expect(
    page.getByRole("button", { name: "Run deterministic fit" }),
  ).toBeDisabled();
});

test("renders a catalog failure once and never exposes server error copy", async ({
  page,
}) => {
  await page.route("**/api/products", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "DO NOT RENDER product repository details",
        },
      }),
      contentType: "application/json",
      status: 500,
    });
  });

  await page.goto("/countries/CHN");

  const error = page.getByTestId("product-fit-catalog-error");
  await expect(error).toBeVisible();
  await expect(error).toHaveAttribute("role", "alert");
  await expect(error).toHaveAttribute("aria-atomic", "true");
  await expect(error.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(
    page.getByText(
      "The product list is temporarily unavailable. Please try again later.",
      { exact: true },
    ),
  ).toHaveCount(1);
  await expect(
    page.getByText("DO NOT RENDER product repository details", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page.getByTestId("product-fit-empty-catalog")).toHaveCount(0);
});

test("keeps a pending evaluation typed and re-localizes its late result", async ({
  page,
}) => {
  let releaseEvaluation = () => {};
  let markEvaluationStarted = () => {};
  const evaluationGate = new Promise<void>((resolve) => {
    releaseEvaluation = resolve;
  });
  const evaluationStarted = new Promise<void>((resolve) => {
    markEvaluationStarted = resolve;
  });

  await page.route("**/api/product-fit", async (route) => {
    const response = await route.fetch();
    markEvaluationStarted();
    await evaluationGate;
    await route.fulfill({ response });
  });

  await page.goto("/countries/CHN");
  const form = page.getByTestId("product-fit-form");
  await expect(
    page.getByRole("button", { name: "Run deterministic fit" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Run deterministic fit" }).click();
  await evaluationStarted;

  const englishLoading = page.getByTestId("product-fit-evaluation-loading");
  await expect(englishLoading).toHaveText(
    "Running deterministic product-fit evaluation…",
  );
  await expect(englishLoading).toHaveAttribute("role", "status");
  await expect(englishLoading).toHaveAttribute("aria-live", "polite");
  await expect(englishLoading).toHaveAttribute("aria-busy", "true");
  await expect(englishLoading).toHaveAttribute("aria-atomic", "true");
  await expect(form).toHaveAttribute("aria-busy", "true");

  const chineseLocaleButton = page
    .getByTestId("country-drawer-locale-toggle")
    .getByRole("button", { exact: true, name: "中文" });
  await chineseLocaleButton.click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByTestId("product-fit-evaluation-loading")).toHaveText(
    "正在运行确定性产品适配评估…",
  );
  await expect(
    page.getByText("Running deterministic product-fit evaluation…", {
      exact: true,
    }),
  ).toHaveCount(0);

  releaseEvaluation();

  const result = page.getByTestId("product-fit-result");
  await expect(result).toBeVisible();
  await expect(result).toContainText("法规/认证适配：演示匹配");
  await expect(result).not.toContainText(
    "Regulation/certification fit: Demo match",
  );
  await expect(form).toHaveAttribute("aria-busy", "false");
  await expect(page.getByTestId("product-fit-evaluation-loading")).toHaveCount(
    0,
  );
});

test("preserves a newer draft when its own evaluated URL arrives late", async ({ page }, testInfo) => {
  await checkBrowserRuntimeErrors(page, testInfo, async () => {
    let releasePage = () => {};
    let markPageReady = () => {};
    const pageGate = new Promise<void>((resolve) => { releasePage = resolve; });
    const pageReady = new Promise<void>((resolve) => { markPageReady = resolve; });
    let fitPostCount = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/product-fit" && request.method() === "POST") {
        fitPostCount += 1;
      }
    });
    await page.route("**/countries/CHN?**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.headers().rsc === "1" && url.searchParams.get("powerKw") === "150") {
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        markPageReady();
        await pageGate;
        await route.fulfill({ response });
      } else {
        await route.continue();
      }
    });
    await page.goto("/countries/CHN?applicationScope=non-road&asOf=2026-01-20&powerKw=100");
    const power = page.getByLabel("Power (kW)", { exact: true });
    await page.getByRole("radio", { name: /^DEMO-ENG-100/ }).check();
    await power.fill("150");
    const refreshedPage = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/countries/CHN" && url.searchParams.get("powerKw") === "150" && response.request().headers().rsc === "1";
    });
    try {
      await page.getByRole("button", { name: "Run deterministic fit" }).click();
      await expect(page.getByTestId("product-fit-status-not_fit")).toBeVisible();
      await pageReady;
      await power.fill("175");
      await expect(page.getByTestId("product-fit-result")).toBeHidden();
      releasePage();
      expect(await (await refreshedPage).finished()).toBeNull();
      await expect(page).toHaveURL((url) => url.searchParams.get("powerKw") === "150");
      await expect(power).toHaveValue("175");
      await expect(page.getByTestId("product-fit-result")).toBeHidden();
      await expect(page.getByTestId("country-applicability-summary")).toContainText("Non-road · 150 kW · As of Jan 20, 2026");
      await expect(page.getByRole("link", { name: "Analyze in chat" })).toHaveAttribute("href", "/chat?asOf=2026-01-20&countryIso3=CHN&applicationScope=non-road&powerKw=150&productModelCode=DEMO-ENG-100");
      expect(fitPostCount).toBe(1);
    } finally {
      releasePage();
    }
  });
});

for (const locale of ["en", "zh-CN"] as const) {
  test(`does not auto-submit a draft after recovering an unknown shared-link model (${locale})`, async ({
    context,
    page,
  }, testInfo) => {
    if (locale === "zh-CN") {
      await context.addCookies([{
        name: "diesel_locale",
        value: locale,
        url: testInfo.project.use.baseURL ?? "http://127.0.0.1:3100",
      }]);
    }
    await checkBrowserRuntimeErrors(page, testInfo, async () => {
      const zh = locale === "zh-CN";
      let releasePage = () => {};
      let markPageReady = () => {};
      const pageGate = new Promise<void>((resolve) => { releasePage = resolve; });
      const pageReady = new Promise<void>((resolve) => { markPageReady = resolve; });
      const fitInputs: unknown[] = [];
      page.on("request", (request) => {
        if (new URL(request.url()).pathname === "/api/product-fit" && request.method() === "POST") {
          fitInputs.push(request.postDataJSON());
        }
      });
      await page.route("**/countries/CHN?**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (request.headers().rsc === "1" &&
          url.searchParams.get("powerKw") === "150" &&
          url.searchParams.get("productModelCode") === "DEMO-ENG-100") {
          const response = await route.fetch();
          expect(response.ok()).toBe(true);
          markPageReady();
          await pageGate;
          await route.fulfill({ response });
        } else {
          await route.continue();
        }
      });

      try {
        await page.goto(
          "/countries/CHN?applicationScope=non-road&asOf=2026-01-20&powerKw=100&productModelCode=DOES-NOT-EXIST&utm_term=engine&utm_term=export",
        );
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        const power = page.getByLabel(zh ? "功率（kW）" : "Power (kW)", { exact: true });
        const result = page.getByTestId("product-fit-result");
        const run = page.getByRole("button", {
          exact: true,
          name: zh ? "运行确定性匹配" : "Run deterministic fit",
        });
        await expect(run).toBeEnabled();
        await expect(page).toHaveURL((url) =>
          url.searchParams.get("productModelCode") === "DOES-NOT-EXIST",
        );
        await expect(result).toBeHidden();
        expect(fitInputs).toHaveLength(0);
        await page.getByRole("radio", { name: /^DEMO-ENG-100/ }).check();
        await power.fill("150");

        const fitResponse = page.waitForResponse((response) =>
          new URL(response.url()).pathname === "/api/product-fit" &&
          response.request().method() === "POST",
        );
        const refreshedPage = page.waitForResponse((response) => {
          const url = new URL(response.url());
          return url.pathname === "/countries/CHN" &&
            url.searchParams.get("powerKw") === "150" &&
            url.searchParams.get("productModelCode") === "DEMO-ENG-100" &&
            response.request().headers().rsc === "1";
        });
        await run.click();
        const response = await fitResponse;
        expect(response.ok()).toBe(true);
        expect(await response.json()).toMatchObject({
          input: {
            applicationScope: "non-road",
            asOf: "2026-01-20",
            countryIso3: "CHN",
            powerKw: 150,
            productModelCode: "DEMO-ENG-100",
          },
          status: "not_fit",
        });
        await expect(page.getByTestId("product-fit-status-not_fit")).toBeVisible();
        await pageReady;
        expect(fitInputs).toHaveLength(1);

        await power.fill("175");
        await expect(result).toBeHidden();
        releasePage();
        expect(await (await refreshedPage).finished()).toBeNull();
        await expect(page).toHaveURL((url) =>
          url.pathname === "/countries/CHN" &&
          url.searchParams.get("applicationScope") === "non-road" &&
          url.searchParams.get("asOf") === "2026-01-20" &&
          url.searchParams.get("powerKw") === "150" &&
          url.searchParams.get("productModelCode") === "DEMO-ENG-100" &&
          url.searchParams.getAll("utm_term").join(",") === "engine,export",
        );
        // Let the route commit's passive effect and zero-delay auto-run task
        // execute before checking that the user's new draft was not submitted.
        await page.evaluate(() => new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => {
            setTimeout(resolve, 0);
          }));
        }));
        await expect(power).toHaveValue("175");
        await expect(result).toBeHidden();
        await expect(page.getByTestId("product-fit-evaluation-loading")).toBeHidden();
        await expect(page.getByTestId("country-applicability-summary")).toContainText(zh
          ? "非道路 · 150 kW · 截止 2026年1月20日"
          : "Non-road · 150 kW · As of Jan 20, 2026");
        await expect(page.getByRole("link", { name: zh ? "在对话中分析" : "Analyze in chat" })).toHaveAttribute(
          "href",
          "/chat?asOf=2026-01-20&countryIso3=CHN&applicationScope=non-road&powerKw=150&productModelCode=DEMO-ENG-100",
        );
        await expect(page).toHaveURL((url) => url.searchParams.get("powerKw") === "150");
        expect(fitInputs).toEqual([{
          applicationScope: "non-road",
          asOf: "2026-01-20",
          countryIso3: "CHN",
          powerKw: "150",
          productModelCode: "DEMO-ENG-100",
        }]);
      } finally {
        releasePage();
        await page.unrouteAll({ behavior: "wait" });
      }
    });
  });
}

for (const { order, summaryFirst } of [
  { order: "summary after RSC", summaryFirst: false },
  { order: "summary before RSC", summaryFirst: true },
] as const) {
  test(`keeps the decision summary bound to a same-date fit query after URL refresh (${order})`, async ({
    page,
  }) => {
    let releaseSummary = () => {};
    let markSummaryReady = () => {};
    let markSummarySettled = () => {};
    const summaryGate = new Promise<void>((resolve) => {
      releaseSummary = resolve;
    });
    const summaryReady = new Promise<void>((resolve) => {
      markSummaryReady = resolve;
    });
    const summarySettled = new Promise<void>((resolve) => {
      markSummarySettled = resolve;
    });
    let releasePage = () => {};
    let markPageReady = () => {};
    const pageGate = new Promise<void>((resolve) => {
      releasePage = resolve;
    });
    const pageReady = new Promise<void>((resolve) => {
      markPageReady = resolve;
    });
    let gatedPageRequest = false;
    let fitPostCount = 0;
    page.on("request", (request) => {
      if (
        new URL(request.url()).pathname === "/api/product-fit" &&
        request.method() === "POST"
      ) {
        fitPostCount += 1;
      }
    });

    await page.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const matchesNewQuery =
        url.searchParams.get("applicationScope") === "marine" &&
        url.searchParams.get("asOf") === "2026-01-20" &&
        url.searchParams.get("powerKw") === "150";

      if (url.pathname === "/api/countries/CHN" && matchesNewQuery) {
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        const summaryPayload: unknown = await response.json();
        expect(summaryPayload).toMatchObject({
          applicabilitySummary: {
            query: {
              applicationScope: "marine",
              asOf: "2026-01-20",
              countryIso3s: ["CHN"],
              powerKw: 150,
            },
          },
          status: "available",
        });
        markSummaryReady();
        await summaryGate;
        try {
          await route.fulfill({ response });
        } catch (error: unknown) {
          // A newer SSR context may cancel this obsolete request. Only an
          // explicit browser abort is expected; transport and teardown errors
          // must still fail the test rather than disappearing in a catch-all.
          if (!(error instanceof Error && error.message.includes("net::ERR_ABORTED"))) {
            throw error;
          }
        } finally {
          markSummarySettled();
        }
        return;
      }

      if (
        !gatedPageRequest &&
        url.pathname === "/countries/CHN" &&
        matchesNewQuery &&
        request.headers().rsc === "1"
      ) {
        gatedPageRequest = true;
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        markPageReady();
        await pageGate;
        await route.fulfill({ response });
        return;
      }
      await route.continue();
    });

    // An initial summary without a product model avoids an automatic evaluation
    // racing with the manual one. Only scope and power change; the country and
    // date, and therefore the existing drawer instance, stay the same.
    await page.goto(
      "/countries/CHN?applicationScope=non-road&asOf=2026-01-20&powerKw=100",
    );
    const summary = page.getByTestId("country-applicability-summary");
    await expect(summary).toContainText(
      "Non-road · 100 kW · As of Jan 20, 2026",
    );
    await page.getByRole("radio", { name: /^DEMO-ENG-100/ }).check();
    await page.getByLabel("Application", { exact: true }).selectOption("marine");
    await page.getByLabel("Power (kW)", { exact: true }).fill("150");
    await expect(page.getByLabel("Evaluation date")).toHaveValue("2026-01-20");
    expect(fitPostCount).toBe(0);

    const fitResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/product-fit" &&
      response.request().method() === "POST",
    );
    const refreshedPageResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/countries/CHN" &&
        url.searchParams.get("applicationScope") === "marine" &&
        url.searchParams.get("powerKw") === "150" &&
        response.request().headers().rsc === "1";
    });

    try {
      await page.getByRole("button", { name: "Run deterministic fit" }).click();
      const fitResponse = await fitResponsePromise;
      expect(fitResponse.ok()).toBe(true);
      const fitPayload: unknown = await fitResponse.json();
      expect(fitPayload).toMatchObject({
        asOf: "2026-01-20",
        input: {
          applicationScope: "marine",
          asOf: "2026-01-20",
          countryIso3: "CHN",
          powerKw: 150,
          productModelCode: "DEMO-ENG-100",
        },
      });
      await expect(page.getByTestId("product-fit-result")).toBeVisible();
      await Promise.all([summaryReady, pageReady]);

      if (summaryFirst) {
        releaseSummary();
        await summarySettled;
        // The RSC response is still gated: this proves the API summary was
        // rendered first, not merely fetched before the navigation completed.
        await expect(summary).toContainText(
          "Marine · 150 kW · As of Jan 20, 2026",
        );
      }
      releasePage();
      const refreshedPageResponse = await refreshedPageResponsePromise;
      expect(refreshedPageResponse.ok()).toBe(true);
      expect(await refreshedPageResponse.finished()).toBeNull();
      await expect(page).toHaveURL((url) =>
        url.pathname === "/countries/CHN" &&
        url.searchParams.get("applicationScope") === "marine" &&
        url.searchParams.get("asOf") === "2026-01-20" &&
        url.searchParams.get("powerKw") === "150" &&
        url.searchParams.get("productModelCode") === "DEMO-ENG-100",
      );

      // In the late-summary row this retains the original red ordering: the
      // new URL and server render commit before the API response is released.
      releaseSummary();
      await summarySettled;
      await expect(summary).toContainText(
        "Marine · 150 kW · As of Jan 20, 2026",
      );
      await expect(summary).not.toContainText("Non-road · 100 kW");
      await expect(page.getByTestId("product-fit-result")).toBeVisible();
      await expect(page.getByLabel("Application", { exact: true })).toHaveValue(
        "marine",
      );
      await expect(page.getByLabel("Power (kW)", { exact: true })).toHaveValue(
        "150",
      );
      await expect(page.getByLabel("Evaluation date")).toHaveValue("2026-01-20");
      const chatHref =
        "/chat?asOf=2026-01-20&countryIso3=CHN&applicationScope=marine&powerKw=150&productModelCode=DEMO-ENG-100";
      await expect(page.getByRole("link", { name: "Analyze in chat" })).toHaveAttribute(
        "href",
        chatHref,
      );
      expect(fitPostCount).toBe(1);

      // Locale refresh must not replace an unsubmitted draft with URL values
      // or automatically run it. The committed summary remains at 150 kW.
      await page.getByLabel("Power (kW)", { exact: true }).fill("175");
      await expect(page.getByTestId("product-fit-result")).toBeHidden();
      const localeToggle = page.getByTestId("country-drawer-locale-toggle");
      await localeToggle.getByRole("button", { exact: true, name: "中文" }).click();
      await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
      await expect(localeToggle).toHaveAttribute("aria-busy", "false");
      await expect(page.getByLabel("功率（kW）", { exact: true })).toHaveValue("175");
      await expect(page.getByLabel("应用场景", { exact: true })).toHaveValue("marine");
      await expect(page.getByLabel("评估日期")).toHaveValue("2026-01-20");
      await expect(summary).toContainText("船舶 · 150 kW · 截止 2026年1月20日");
      await expect(summary).not.toContainText("175 kW");
      await expect(page.getByRole("link", { name: "在对话中分析" })).toHaveAttribute(
        "href",
        chatHref,
      );
      await expect(page.getByTestId("product-fit-result")).toBeHidden();
      await expect(page).toHaveURL((url) => url.searchParams.get("powerKw") === "150");
      expect(fitPostCount).toBe(1);
    } finally {
      releaseSummary();
      releasePage();
    }
  });
}
