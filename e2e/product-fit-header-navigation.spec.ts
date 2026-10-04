import { Buffer } from "node:buffer";

import { expect, test, type Locator, type Page, type Request, type Route, type TestInfo } from "@playwright/test";
import { z } from "zod";

import { checkBrowserRuntimeErrors } from "./browser-runtime-errors";

test.describe.configure({ timeout: 30_000 });

test.beforeEach(async ({ context }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "The desktop brand link remains pointer-accessible beside the open drawer; mobile is not equivalent coverage.",
  );
  await context.clearCookies();
});

const initialUrl = "/countries/CHN?applicationScope=non-road&asOf=2026-01-20&powerKw=100&utm_term=engine&utm_term=export";
const fitInputSchema = z.object({
  applicationScope: z.literal("non-road"),
  asOf: z.literal("2026-01-20"),
  countryIso3: z.literal("CHN"),
  powerKw: z.union([z.literal("150"), z.literal(150)]),
  productModelCode: z.literal("DEMO-ENG-100"),
}).strict();
// Identify the actual evaluation without replacing its upstream response.
const fitResponseSchema = z.object({
  asOf: z.literal("2026-01-20"),
  input: fitInputSchema.extend({ powerKw: z.literal(150) }),
  status: z.enum(["fit", "not_fit", "unknown"]),
});
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

async function interceptNavigation(page: Page, record: RecordEvent) {
  const fit = createHeldResponse();
  const home = createHeldResponse();
  const failures: unknown[] = [];
  const failedRequests = new Map<Request, string | null>();
  const observations = {
    browserPosts: 0,
    inputs: [] as Array<z.infer<typeof fitInputSchema>>,
    responses: [] as Array<z.infer<typeof fitResponseSchema>>,
    homeRequests: [] as Array<{ url: string; afterHeaderClick: boolean; prefetch: string | null }>,
    countryRequests: [] as string[],
  };
  let fitRequest: Request | null = null;
  let headerClicked = false;
  let homeInterceptionArmed = false;
  const fitWasAborted = () => fitRequest !== null && failedRequests.get(fitRequest) === "net::ERR_ABORTED";
  const onRequest = (request: Request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/product-fit" && request.method() === "POST") observations.browserPosts += 1;
    if (url.pathname === "/countries/CHN" && request.headers().rsc === "1" &&
      url.searchParams.get("powerKw") === "150" && url.searchParams.get("productModelCode") === "DEMO-ENG-100") {
      observations.countryRequests.push(request.url());
      record("country-filter-RSC-request", { url: request.url(), afterHeaderClick: headerClicked });
    }
  };
  const onRequestFailed = (request: Request) => {
    const errorText = request.failure()?.errorText ?? null;
    failedRequests.set(request, errorText);
    if (request === fitRequest) record("fit-request-failed", { errorText });
  };
  page.on("request", onRequest);
  page.on("requestfailed", onRequestFailed);

  async function deliver(route: Route, response: Awaited<ReturnType<Route["fetch"]>>) {
    if (failedRequests.get(route.request()) === "net::ERR_ABORTED") {
      record("delivery-canceled", { url: route.request().url(), reason: "observed browser net::ERR_ABORTED" });
    }
    // An observed browser abort does not finish Playwright's route handler.
    // Fulfill with the same real response to settle it; propagate every error
    // still exposed by Playwright instead of swallowing it as cancellation.
    await route.fulfill({ response });
  }

  await page.route("**/*", async (route) => {
    try {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname === "/api/product-fit" && request.method() === "POST") {
        fitRequest = request;
        observations.inputs.push(fitInputSchema.parse(request.postDataJSON()));
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        observations.responses.push(fitResponseSchema.parse(await response.json()));
        record("fit-real-response-ready", { response: observations.responses.at(-1) });
        fit.ready.resolve();
        await fit.release.promise;
        await deliver(route, response);
        fit.delivered.resolve();
        record("fit-delivery-finished", { fitAborted: fitWasAborted() });
        return;
      }
      if (homeInterceptionArmed && url.pathname === "/" && request.headers().rsc === "1") {
        const observed = {
          url: request.url(), afterHeaderClick: headerClicked,
          prefetch: request.headers()["next-router-prefetch"] ?? null,
        };
        observations.homeRequests.push(observed);
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        record("home-real-RSC-ready", observed);
        home.ready.resolve();
        await home.release.promise;
        await deliver(route, response);
        home.delivered.resolve();
        record("home-delivery-finished");
        return;
      }
      await route.continue();
    } catch (error: unknown) {
      failures.push(error);
      record("interception-failed", describeFailure(error));
      for (const gate of [fit, home]) {
        gate.ready.resolve();
        gate.delivered.resolve();
      }
      try { await route.abort("failed"); }
      catch (abortError: unknown) { failures.push(abortError); }
    }
  });

  return {
    fit, home, observations, fitWasAborted,
    armHomeInterception() { homeInterceptionArmed = true; record("home-interception-armed"); },
    markHeaderClick() { headerClicked = true; record("Header-click-started"); },
    async wait(signal: ReturnType<typeof createSignal>) {
      await signal.promise;
      throwFailures(failures, "Real-response interception failed.");
    },
    check() { throwFailures(failures, "Real-response interception failed."); },
    async finish() {
      fit.release.resolve();
      home.release.resolve();
      try { await page.unrouteAll({ behavior: "wait" }); }
      catch (error: unknown) { failures.push(error); }
      page.off("request", onRequest);
      page.off("requestfailed", onRequestFailed);
      try {
        expect(observations.browserPosts).toBe(1);
        expect(observations.inputs).toHaveLength(1);
        expect(observations.responses).toHaveLength(1);
      } catch (error: unknown) { failures.push(error); }
      throwFailures(failures, "Navigation cleanup or response counts failed.");
    },
  };
}

async function withPendingFit(
  page: Page,
  testInfo: TestInfo,
  locale: "en" | "zh-CN",
  action: (interception: Awaited<ReturnType<typeof interceptNavigation>>, homeLink: Locator, record: RecordEvent) => Promise<void>,
) {
  const startedAt = performance.now();
  const events: Array<Record<string, unknown>> = [];
  const record: RecordEvent = (type, fields = {}) => {
    events.push({ type, elapsedMs: performance.now() - startedAt, ...fields });
  };
  const interception = await interceptNavigation(page, record);
  try {
    await checkBrowserRuntimeErrors(page, testInfo, async () => {
      const failures: unknown[] = [];
      try {
        if (locale === "zh-CN") await page.context().addCookies([{
          name: "diesel_locale", value: locale,
          url: testInfo.project.use.baseURL ?? "http://127.0.0.1:3100",
        }]);
        const zh = locale === "zh-CN";
        // Compile Home and the API before holding a real fit response. A cold
        // destination compilation can otherwise broadcast a Next dev reload
        // into the source document and invalidate the controlled navigation race.
        await page.goto("/");
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(page.getByRole("button", { name: "EN", exact: true })).toBeEnabled();
        const invalidFit = await page.request.post("/api/product-fit", { data: {} });
        expect(invalidFit.status()).toBe(400);
        record("home-and-invalid-fit-preflight-ready", { status: invalidFit.status() });
        // No initial product model means there is no automatic evaluation.
        await page.goto(initialUrl);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(page.getByTestId("country-detail")).toBeVisible();
        await page.getByRole("radio", { name: /^DEMO-ENG-100/ }).check();
        expect(interception.observations.browserPosts).toBe(0);
        await page.getByLabel(zh ? "功率（kW）" : "Power (kW)", { exact: true }).fill("150");
        // Setup-only Home RSC traffic must settle before we hold the response
        // under test. All Home requests during the actual fit race are tracked.
        interception.armHomeInterception();
        await page.getByRole("button", { name: zh ? "运行确定性匹配" : "Run deterministic fit", exact: true }).click();
        await interception.wait(interception.fit.ready);
        await expect(page.getByTestId("product-fit-evaluation-loading")).toBeVisible();
        expect(interception.fit.release.resolved).toBe(false);

        // The non-modal drawer must leave this anchor accessible. Exercise
        // its real pointer path, never force it or opt into hidden elements.
        const label = zh ? "GD · Global Diesel — 首页" : "GD · Global Diesel — Home";
        const homeLink = page.getByRole("banner").getByRole("link", { name: label, exact: true });
        await expect(homeLink).toBeVisible();
        await expect(homeLink).toHaveAttribute("aria-label", label);
        await expect(homeLink).toHaveAttribute("href", "/");
        record("Header-pointer-readback", await homeLink.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return {
            ariaHidden: element.getAttribute("aria-hidden"),
            pointerEvents: getComputedStyle(element).pointerEvents,
            hitIsLinkOrDescendant: hit !== null && (hit === element || element.contains(hit)),
          };
        }));
        await action(interception, homeLink, record);
      } catch (error: unknown) {
        failures.push(error);
        record("assertion-failed", describeFailure(error));
      } finally {
        try {
          // Keep pageerror checking active through all held-response cleanup.
          await interception.finish();
          record("all-gates-drained", { url: page.url(), fitAborted: interception.fitWasAborted() });
        } catch (error: unknown) { failures.push(error); record("cleanup-failed", describeFailure(error)); }
      }
      throwFailures(failures, "Product-fit Header navigation failed.");
    });
  } finally {
    await testInfo.attach("product-fit-header-navigation-observations", {
      contentType: "application/json",
      body: Buffer.from(JSON.stringify({
        version: "product-fit-header-navigation-observations-v1",
        responseSource: "Existing PGlite Demo responses forwarded unchanged",
        locale, project: testInfo.project.name, retry: testInfo.retry,
        fitAborted: interception.fitWasAborted(),
        ...interception.observations, events,
      }, null, 2)),
    });
  }
}

for (const locale of ["en", "zh-CN"] as const) {
  test(`preserves a Header home navigation when a pending fit responds first (${locale})`, async ({ page }, testInfo) => {
    await withPendingFit(page, testInfo, locale, async (interception, homeLink, record) => {
      interception.markHeaderClick();
      await homeLink.click();
      await interception.wait(interception.home.ready);
      expect(interception.home.release.resolved).toBe(false);
      expect(interception.fit.release.resolved).toBe(false);
      expect(interception.observations.homeRequests.length).toBeGreaterThan(0);
      expect(interception.observations.homeRequests.every(({ afterHeaderClick, prefetch }) => afterHeaderClick && prefetch === null)).toBe(true);
      await expect(page.getByTestId("product-fit-form")).toBeVisible();
      await expect(page.getByTestId("product-fit-evaluation-loading")).toBeVisible();
      record("home-held-with-old-panel", { url: page.url(), fitAborted: interception.fitWasAborted() });

      interception.fit.release.resolve();
      await interception.wait(interception.fit.delivered);
      // Wait for the actual cancellation/unmount or the historical late
      // replace before delivering Home; do not win the race by flushing it.
      await expect.poll(async () => {
        interception.check();
        return interception.fitWasAborted() || interception.observations.countryRequests.length > 0 ||
          !(await page.getByTestId("product-fit-form").isVisible());
      }).toBe(true);
      record("fit-settled-before-home-release", {
        url: page.url(), fitAborted: interception.fitWasAborted(),
        countryRequestCount: interception.observations.countryRequests.length,
      });
      interception.home.release.resolve();
      await interception.wait(interception.home.delivered);
      await expect(page).toHaveURL((url) => url.pathname === "/" && url.search === "");
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByTestId("country-detail")).toHaveCount(0);
      expect(interception.observations.countryRequests).toHaveLength(0);
      record("home-navigation-preserved", { url: page.url() });
    });
  });
}

test("keeps the current fit running when the Header brand opens a new tab", async ({ page }, testInfo) => {
  await withPendingFit(page, testInfo, "en", async (interception, homeLink, record) => {
    await page.exposeFunction("__dieselRecordHeaderActivation", (event: unknown) => {
      record("Header-native-activation", { event });
    });
    await page.evaluate(() => {
      Object.defineProperty(document, "__dieselHeaderPendingDocument", { value: true });
    });
    await homeLink.evaluate((element) => {
      const report = (window as typeof window & {
        __dieselRecordHeaderActivation(event: Record<string, unknown>): Promise<void>;
      }).__dieselRecordHeaderActivation;
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        element.addEventListener(type, (event) => {
          if (!(event instanceof MouseEvent)) return;
          queueMicrotask(() => { void report({
            type, button: event.button, ctrlKey: event.ctrlKey, metaKey: event.metaKey,
            defaultPrevented: event.defaultPrevented, isTrusted: event.isTrusted,
            visibility: document.visibilityState, focused: document.hasFocus(),
          }); });
        });
      }
    });
    const context = page.context();
    const existingPages = new Set(context.pages());
    const addedPages = new Set<Page>();
    const observePage = (created: Page) => {
      if (!existingPages.has(created)) addedPages.add(created);
    };
    context.on("page", observePage);
    const failures: unknown[] = [];
    try {
      interception.markHeaderClick();
      // Playwright maps this to Meta on macOS and Control on Linux/Windows.
      // A native modified-click tab can lack an opener, so observe the real
      // context page event rather than only the current page's popup event.
      // The new page remains outside the current-page response interceptor.
      const [newPage] = await Promise.all([
        context.waitForEvent("page", { predicate: (created) => !existingPages.has(created) }),
        homeLink.click({ modifiers: ["ControlOrMeta"] }),
      ]);
      await expect(newPage).toHaveURL((url) => url.pathname === "/" && url.search === "");
      await expect(page).toHaveURL((url) => `${url.pathname}${url.search}` === initialUrl);
      expect(await page.evaluate(() => Object.hasOwn(document, "__dieselHeaderPendingDocument"))).toBe(true);
      await expect(page.getByTestId("product-fit-evaluation-loading")).toBeVisible();
      expect(interception.fitWasAborted()).toBe(false);
      expect(interception.fit.release.resolved).toBe(false);
      expect(interception.observations.homeRequests).toHaveLength(0);
      const opener = await newPage.opener();
      record("new-tab-left-current-fit-pending", {
        popupUrl: newPage.url(), url: page.url(), existingPageCount: existingPages.size,
        hasOpener: opener !== null, openerIsCurrentPage: opener === page,
      });

      interception.fit.release.resolve();
      await interception.wait(interception.fit.delivered);
      await expect(page.getByTestId("product-fit-evaluation-loading")).toBeHidden();
      await expect(page.getByTestId("product-fit-status-not_fit")).toBeVisible();
      await expect(page).toHaveURL((url) => url.pathname === "/countries/CHN" &&
        url.searchParams.get("applicationScope") === "non-road" && url.searchParams.get("asOf") === "2026-01-20" &&
        url.searchParams.get("powerKw") === "150" && url.searchParams.get("productModelCode") === "DEMO-ENG-100" &&
        url.searchParams.getAll("utm_term").join(",") === "engine,export");
      await expect(page.getByTestId("country-applicability-summary")).toContainText("Non-road · 150 kW · As of Jan 20, 2026");
      expect(interception.fitWasAborted()).toBe(false);
      expect(interception.observations.homeRequests).toHaveLength(0);
      expect(interception.observations.countryRequests).toHaveLength(1);
      record("current-fit-committed-after-new-tab", { url: page.url() });
    } catch (error: unknown) {
      failures.push(error);
    } finally {
      // The fixture owns an isolated context. Also read back its page set so
      // cleanup includes a new tab if the click/wait assertion failed early.
      context.pages().forEach(observePage);
      for (const created of addedPages) {
        try { if (!created.isClosed()) await created.close(); }
        catch (error: unknown) { failures.push(error); }
      }
      context.off("page", observePage);
    }
    throwFailures(failures, "Modified Header navigation or popup cleanup failed.");
  });
});
