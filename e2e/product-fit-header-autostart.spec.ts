import { Buffer } from "node:buffer";

import { expect, test, type Locator, type Page, type Request, type TestInfo } from "@playwright/test";
import { z } from "zod";

import {
  productFitApiErrorSchema,
  productFitEvaluationSchema,
  productListResponseSchema,
} from "../src/features/product-fit/schemas";
import { checkBrowserRuntimeErrors } from "./browser-runtime-errors";

test.describe.configure({ timeout: 30_000 });

test.beforeEach(async ({ context }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "The desktop Header brand is pointer-accessible beside the drawer; this is not mobile navigation coverage.",
  );
  await context.clearCookies();
});

const warmCountryUrl = "/countries/CHN?applicationScope=non-road&asOf=2026-01-20&powerKw=100";
const initialUrl = `${warmCountryUrl}&productModelCode=DEMO-ENG-100&utm_term=engine&utm_term=export`;
const fitInputSchema = z.object({
  applicationScope: z.literal("non-road"),
  asOf: z.literal("2026-01-20"),
  countryIso3: z.literal("CHN"),
  powerKw: z.literal("100"),
  productModelCode: z.literal("DEMO-ENG-100"),
}).strict();
type RecordEvent = (type: string, fields?: Record<string, unknown>) => void;

function createSignal() {
  let complete = () => {};
  let resolved = false;
  const promise = new Promise<void>((resolve) => { complete = resolve; });
  return {
    promise,
    get resolved() { return resolved; },
    resolve() {
      if (resolved) return;
      resolved = true;
      complete();
    },
  };
}

function createHeldResponse() {
  return { ready: createSignal(), release: createSignal(), delivered: createSignal() };
}

function describeFailure(error: unknown) {
  return {
    name: error instanceof Error ? error.name : "non-Error",
    message: error instanceof Error ? error.message.slice(0, 2_000) : "Unknown failure",
  };
}

function throwFailures(failures: unknown[], message: string) {
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, message);
}

async function interceptDelayedCatalog(page: Page, record: RecordEvent) {
  const catalog = createHeldResponse();
  const home = createHeldResponse();
  const fitDelivered = createSignal();
  const failures: unknown[] = [];
  const observations = {
    browserPosts: 0,
    inputs: [] as Array<z.infer<typeof fitInputSchema>>,
    fitResponses: [] as Array<{
      input: z.infer<typeof productFitEvaluationSchema>["input"];
      status: string;
      commercialReadiness: string;
    }>,
    catalogs: [] as Array<Array<{ id: string; modelCode: string; isDemo: boolean }>>,
    homeRequests: [] as Array<{ url: string; prefetch: string | null }>,
    countryRequestsAfterNavigation: [] as string[],
  };
  let catalogArmed = false;
  let navigationStarted = false;
  const onRequest = (request: Request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/product-fit" && request.method() === "POST") {
      observations.browserPosts += 1;
      record("browser-fit-POST", { afterNavigation: navigationStarted });
    }
    if (navigationStarted && url.pathname === "/countries/CHN" && request.headers().rsc === "1") {
      observations.countryRequestsAfterNavigation.push(request.url());
      record("country-RSC-after-navigation", { url: request.url() });
    }
  };
  page.on("request", onRequest);

  await page.route("**/*", async (route) => {
    try {
      const request = route.request(), url = new URL(request.url());
      if (catalogArmed && url.pathname === "/api/products") {
        expect(request.method()).toBe("GET");
        const response = await route.fetch({ timeout: 10_000 });
        expect(response.ok()).toBe(true);
        const parsed = productListResponseSchema.parse(await response.json());
        expect(parsed.products).toEqual(expect.arrayContaining([
          expect.objectContaining({ modelCode: "DEMO-ENG-100", isDemo: true }),
        ]));
        observations.catalogs.push(parsed.products.map(({ id, modelCode, isDemo }) => ({ id, modelCode, isDemo })));
        record("real-catalog-ready", { models: observations.catalogs.at(-1) });
        catalog.ready.resolve();
        await catalog.release.promise;
        // Forward the actual response even if a StrictMode-obsolete request
        // was aborted; any delivery error remains a test failure.
        await route.fulfill({ response });
        catalog.delivered.resolve();
        record("catalog-delivered");
        return;
      }
      if (url.pathname === "/api/product-fit" && request.method() === "POST") {
        observations.inputs.push(fitInputSchema.parse(request.postDataJSON()));
        const response = await route.fetch({ timeout: 10_000 });
        expect(response.ok()).toBe(true);
        const parsed = productFitEvaluationSchema.parse(await response.json());
        expect(parsed).toMatchObject({
          input: { ...observations.inputs.at(-1), powerKw: 100 },
          commercialReadiness: "ready",
          status: "fit",
        });
        observations.fitResponses.push({
          input: parsed.input,
          status: parsed.status,
          commercialReadiness: parsed.commercialReadiness,
        });
        await route.fulfill({ response });
        fitDelivered.resolve();
        record("real-fit-delivered", { input: parsed.input, afterNavigation: navigationStarted });
        return;
      }
      if (navigationStarted && url.pathname === "/" && request.headers().rsc === "1") {
        const observed = { url: request.url(), prefetch: request.headers()["next-router-prefetch"] ?? null };
        observations.homeRequests.push(observed);
        const response = await route.fetch({ timeout: 10_000 });
        expect(response.ok()).toBe(true);
        expect(response.headers()["content-type"]).toContain("text/x-component");
        record("real-home-RSC-ready", observed);
        home.ready.resolve();
        await home.release.promise;
        await route.fulfill({ response });
        home.delivered.resolve();
        record("home-RSC-delivered");
        return;
      }
      await route.continue();
    } catch (error: unknown) {
      failures.push(error);
      record("interception-failed", describeFailure(error));
      for (const signal of [catalog.ready, catalog.delivered, home.ready, home.delivered, fitDelivered]) signal.resolve();
      try { await route.abort("failed"); }
      catch (abortError: unknown) { failures.push(abortError); }
    }
  });

  return {
    catalog, home, fitDelivered, observations,
    armCatalog() { catalogArmed = true; record("catalog-gate-armed"); },
    markNavigation() { navigationStarted = true; record("Header-navigation-started"); },
    check() { throwFailures(failures, "Real-response interception failed."); },
    async wait(signal: ReturnType<typeof createSignal>) {
      await expect.poll(() => {
        throwFailures(failures, "Real-response interception failed.");
        return signal.resolved;
      }, { timeout: 10_000, message: "The held response must settle before test cleanup." }).toBe(true);
      throwFailures(failures, "Real-response interception failed.");
    },
    async finish(expectedPosts: number) {
      catalog.release.resolve();
      home.release.resolve();
      try { await page.unrouteAll({ behavior: "wait" }); }
      catch (error: unknown) { failures.push(error); }
      page.off("request", onRequest);
      try {
        expect(observations.catalogs.length).toBeGreaterThan(0);
        expect(observations.browserPosts).toBe(expectedPosts);
        expect(observations.inputs).toHaveLength(expectedPosts);
        expect(observations.fitResponses).toHaveLength(expectedPosts);
      } catch (error: unknown) { failures.push(error); }
      throwFailures(failures, "Autostart cleanup or request counts failed.");
    },
  };
}

async function settleCatalogEffects(page: Page) {
  // Reuse the existing draft-state test's observable render/task turn. No
  // fixed-duration sleep and no timer replacement: default StrictMode stays on.
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    }));
  }));
}

async function withDelayedCatalog(
  page: Page,
  testInfo: TestInfo,
  locale: "en" | "zh-CN",
  expectedPosts: number,
  action: (
    interception: Awaited<ReturnType<typeof interceptDelayedCatalog>>,
    homeLink: Locator,
    run: Locator,
    record: RecordEvent,
  ) => Promise<void>,
) {
  const startedAt = performance.now();
  const events: Array<Record<string, unknown>> = [];
  const record: RecordEvent = (type, fields = {}) => {
    events.push({ type, elapsedMs: performance.now() - startedAt, ...fields });
  };
  const interception = await interceptDelayedCatalog(page, record);
  try {
    await checkBrowserRuntimeErrors(page, testInfo, async () => {
      const failures: unknown[] = [];
      try {
        if (locale === "zh-CN") await page.context().addCookies([{
          name: "diesel_locale", value: locale,
          url: testInfo.project.use.baseURL ?? "http://127.0.0.1:3100",
        }]);
        const zh = locale === "zh-CN";
        const run = page.getByRole("button", { name: zh ? "运行确定性匹配" : "Run deterministic fit", exact: true });
        // Compile Home/API/country before the controlled race, without any
        // valid evaluation or initial model that could produce a warm-up fit.
        await page.goto("/");
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        const invalidFit = await page.request.post("/api/product-fit", { data: {} });
        expect(invalidFit.status()).toBe(400);
        expect(productFitApiErrorSchema.parse(await invalidFit.json()).error.code).toBe("INVALID_INPUT");
        record("invalid-fit-preflight-rejected", { status: invalidFit.status() });
        await page.goto(warmCountryUrl);
        await expect(page.getByRole("radio", { name: /^DEMO-ENG-100/ })).toBeVisible();
        await expect(run).toBeEnabled();
        expect(interception.observations.browserPosts).toBe(0);
        record("no-model-country-warmed", { url: page.url() });

        interception.armCatalog();
        await page.goto(initialUrl);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(page.getByTestId("country-detail")).toBeVisible();
        await interception.wait(interception.catalog.ready);
        expect(interception.catalog.release.resolved).toBe(false);
        await expect(page.getByTestId("product-fit-form")).toHaveAttribute("aria-busy", "true");
        await expect(run).toBeDisabled();
        await expect(page.getByRole("radio", { name: /^DEMO-ENG-100/ })).toHaveCount(0);
        expect(interception.observations.browserPosts).toBe(0);

        // Vaul hides the visible Header from the accessibility tree. Preserve
        // its real pointer interaction; do not force-click or modify the link.
        const label = zh ? "GD · Global Diesel — 首页" : "GD · Global Diesel — Home";
        const homeLink = page.locator(`header a[aria-label="${label}"]`);
        await expect(homeLink).toBeVisible();
        await expect(homeLink).toHaveAttribute("href", "/");
        await action(interception, homeLink, run, record);
      } catch (error: unknown) {
        failures.push(error);
        record("assertion-failed", describeFailure(error));
      } finally {
        try { await interception.finish(expectedPosts); }
        catch (error: unknown) { failures.push(error); record("cleanup-failed", describeFailure(error)); }
        record("all-gates-drained", { url: page.url(), browserPosts: interception.observations.browserPosts });
      }
      throwFailures(failures, "Delayed-catalog Header autostart failed.");
    });
  } finally {
    await testInfo.attach("product-fit-header-autostart-observations", {
      contentType: "application/json",
      body: Buffer.from(JSON.stringify({
        version: "product-fit-header-autostart-observations-v1",
        responseSource: "Existing PGlite Demo responses forwarded unchanged",
        locale, project: testInfo.project.name, retry: testInfo.retry,
        ...interception.observations, events,
      }, null, 2)),
    });
  }
}

for (const locale of ["en", "zh-CN"] as const) {
  test(`does not start a shared-link fit when its catalog arrives after Header navigation (${locale})`, async ({ page }, testInfo) => {
    await withDelayedCatalog(page, testInfo, locale, 0, async (interception, homeLink, run, record) => {
      interception.markNavigation();
      await homeLink.click();
      await interception.wait(interception.home.ready);
      expect(interception.home.release.resolved).toBe(false);
      expect(interception.catalog.release.resolved).toBe(false);
      expect(interception.observations.homeRequests.length).toBeGreaterThan(0);
      expect(interception.observations.homeRequests.every(({ prefetch }) => prefetch === null)).toBe(true);
      await expect(page.getByTestId("product-fit-form")).toBeVisible();

      interception.catalog.release.resolve();
      await interception.wait(interception.catalog.delivered);
      await expect(page.getByRole("radio", { name: /^DEMO-ENG-100/ })).toBeChecked();
      await expect(run).toBeEnabled();
      await expect(page.getByTestId("product-fit-form")).toHaveAttribute("aria-busy", "false");
      await settleCatalogEffects(page);
      interception.check();
      record("catalog-effects-settled-before-home-release", {
        browserPosts: interception.observations.browserPosts,
        countryRequests: interception.observations.countryRequestsAfterNavigation.length,
        url: page.url(),
      });
      expect(interception.observations.browserPosts).toBe(0);
      expect(interception.observations.countryRequestsAfterNavigation).toHaveLength(0);
      expect(interception.home.release.resolved).toBe(false);
      await expect(page).toHaveURL((url) => `${url.pathname}${url.search}` === initialUrl);
      await expect(page.getByTestId("product-fit-result")).toBeHidden();
      await expect(page.getByTestId("product-fit-evaluation-loading")).toBeHidden();

      interception.home.release.resolve();
      await interception.wait(interception.home.delivered);
      await expect(page).toHaveURL((url) => url.pathname === "/" && url.search === "");
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByTestId("country-detail")).toHaveCount(0);
      expect(interception.observations.browserPosts).toBe(0);
      expect(interception.observations.countryRequestsAfterNavigation).toHaveLength(0);
    });
  });

  test(`auto-evaluates the valid shared link once after its delayed catalog without navigation (${locale})`, async ({ page }, testInfo) => {
    await withDelayedCatalog(page, testInfo, locale, 1, async (interception, _homeLink, run, record) => {
      interception.catalog.release.resolve();
      await interception.wait(interception.catalog.delivered);
      await expect(page.getByRole("radio", { name: /^DEMO-ENG-100/ })).toBeChecked();
      await interception.wait(interception.fitDelivered);
      await expect(page.getByTestId("product-fit-status-fit")).toBeVisible();
      await expect(run).toBeEnabled();
      await expect(page.getByTestId("product-fit-form")).toHaveAttribute("aria-busy", "false");
      await settleCatalogEffects(page);
      interception.check();
      await expect(page).toHaveURL((url) => `${url.pathname}${url.search}` === initialUrl);
      await expect(page.getByTestId("country-applicability-summary")).toContainText(locale === "zh-CN"
        ? "非道路 · 100 kW · 截止 2026年1月20日"
        : "Non-road · 100 kW · As of Jan 20, 2026");
      expect(interception.observations.browserPosts).toBe(1);
      expect(interception.observations.inputs).toEqual([{
        applicationScope: "non-road", asOf: "2026-01-20", countryIso3: "CHN",
        powerKw: "100", productModelCode: "DEMO-ENG-100",
      }]);
      expect(interception.observations.fitResponses).toHaveLength(1);
      expect(interception.observations.homeRequests).toHaveLength(0);
      record("shared-link-auto-fit-completed-once", { url: page.url() });
    });
  });
}
