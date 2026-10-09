import { Buffer } from "node:buffer";

import { expect, test, type Frame, type Locator, type Page, type Request, type Route, type TestInfo } from "@playwright/test";
import { z } from "zod";

import { checkBrowserRuntimeErrors } from "./browser-runtime-errors";

test.describe.configure({ timeout: 30_000 });

test.beforeEach(async ({ context }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "Desktop Chromium covers native modified-click and keyboard chat navigation; this is not mobile interaction coverage.",
  );
  await context.clearCookies();
});

const initialUrl = "/countries/CHN?applicationScope=non-road&asOf=2026-01-20&powerKw=100&utm_term=engine&utm_term=export";
const committedChatHref = "/chat?asOf=2026-01-20&countryIso3=CHN&applicationScope=non-road&powerKw=100";
const documentMarker = "product-fit-chat-navigation-original";
async function hasOriginalDocument(page: Page) {
  return page.evaluate((marker) => Object.prototype.hasOwnProperty.call(document, marker), documentMarker);
}
const fitInputSchema = z.object({
  applicationScope: z.literal("non-road"),
  asOf: z.literal("2026-01-20"),
  countryIso3: z.literal("CHN"),
  powerKw: z.literal("150"),
  productModelCode: z.literal("DEMO-ENG-100"),
}).strict();
// Identify the real Demo response; never substitute a product-fit result.
const fitResponseSchema = z.object({
  asOf: z.literal("2026-01-20"),
  input: fitInputSchema.extend({ powerKw: z.literal(150) }),
  status: z.literal("not_fit"),
});
type RecordEvent = (type: string, fields?: Record<string, unknown>) => void;

const nativeClickPrefix = "diesel-product-fit-native-click:";
const nativeClickSchema = z.object({
  altKey: z.boolean(), button: z.number().int(), ctrlKey: z.boolean(),
  metaKey: z.boolean(), shiftKey: z.boolean(), defaultPrevented: z.boolean(),
  trusted: z.boolean(), focused: z.boolean(), visibility: z.enum(["hidden", "visible"]),
  chatAnchor: z.boolean(), targetTag: z.string().max(30),
}).strict();

async function observeNativeClicks(page: Page, record: RecordEvent) {
  const onConsole = (message: import("@playwright/test").ConsoleMessage) => {
    if (!message.text().startsWith(nativeClickPrefix)) return;
    try {
      const observation = nativeClickSchema.parse(JSON.parse(message.text().slice(nativeClickPrefix.length)));
      record("native-click-observed", observation);
    } catch { record("native-click-diagnostic-invalid"); }
  };
  page.on("console", onConsole);
  await page.addInitScript((prefix) => {
    // Observe after React's delegated root handler, without changing default
    // navigation, input, focus, or request deadlines. No text/form values logged.
    document.addEventListener("click", (event) => {
      if (!(event instanceof MouseEvent) || !(event.target instanceof Element)) return;
      const anchor = event.target.closest("a");
      console.debug(prefix + JSON.stringify({
        altKey: event.altKey, button: event.button, ctrlKey: event.ctrlKey,
        metaKey: event.metaKey, shiftKey: event.shiftKey, defaultPrevented: event.defaultPrevented,
        trusted: event.isTrusted, focused: document.hasFocus(), visibility: document.visibilityState,
        chatAnchor: anchor?.pathname === "/chat", targetTag: event.target.tagName,
      }));
    });
  }, nativeClickPrefix);
  return () => page.off("console", onConsole);
}

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

async function interceptChatNavigation(page: Page, record: RecordEvent) {
  const fit = createHeldResponse();
  const chatDocument = createHeldResponse();
  const failures: unknown[] = [];
  const failedRequests = new Map<Request, string | null>();
  const observations = {
    browserPosts: 0,
    inputs: [] as Array<z.infer<typeof fitInputSchema>>,
    responses: [] as Array<z.infer<typeof fitResponseSchema>>,
    chatDocuments: [] as Array<{ url: string; afterActivation: boolean; rsc: string | null }>,
    countryRequests: [] as string[],
    committedNavigations: [] as string[],
  };
  let fitRequest: Request | null = null;
  let activated = false;
  const onFrameNavigated = (frame: Frame) => {
    if (activated && frame === page.mainFrame()) {
      observations.committedNavigations.push(frame.url());
      record("source-frame-navigation-committed", { url: frame.url() });
    }
  };
  const fitWasAborted = () => fitRequest !== null && failedRequests.get(fitRequest) === "net::ERR_ABORTED";
  const onRequest = (request: Request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/product-fit" && request.method() === "POST") observations.browserPosts += 1;
    if (url.pathname === "/countries/CHN" && request.headers().rsc === "1" &&
      url.searchParams.get("powerKw") === "150" && url.searchParams.get("productModelCode") === "DEMO-ENG-100") {
      observations.countryRequests.push(request.url());
      record("country-filter-RSC-request", { url: request.url(), afterActivation: activated });
    }
  };
  const onRequestFailed = (request: Request) => {
    const errorText = request.failure()?.errorText ?? null;
    failedRequests.set(request, errorText);
    if (request === fitRequest) record("fit-request-failed", { errorText });
  };
  page.on("request", onRequest);
  page.on("requestfailed", onRequestFailed);
  page.on("framenavigated", onFrameNavigated);

  async function deliver(route: Route, response: Awaited<ReturnType<Route["fetch"]>>) {
    if (failedRequests.get(route.request()) === "net::ERR_ABORTED") {
      record("delivery-after-observed-abort", { url: route.request().url() });
    }
    // Browser cancellation does not settle a Playwright route handler. Drain
    // it with the original response and propagate any delivery error.
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
      if (activated && url.pathname === "/chat" && request.isNavigationRequest() && request.resourceType() === "document") {
        const observed = { url: request.url(), afterActivation: activated, rsc: request.headers().rsc ?? null };
        observations.chatDocuments.push(observed);
        expect(`${url.pathname}${url.search}`).toBe(committedChatHref);
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        record("chat-real-document-ready", observed);
        chatDocument.ready.resolve();
        await chatDocument.release.promise;
        await deliver(route, response);
        chatDocument.delivered.resolve();
        record("chat-document-delivery-finished");
        return;
      }
      await route.continue();
    } catch (error: unknown) {
      failures.push(error);
      record("interception-failed", describeFailure(error));
      for (const gate of [fit, chatDocument]) {
        gate.ready.resolve();
        gate.delivered.resolve();
      }
      try { await route.abort("failed"); }
      catch (abortError: unknown) { failures.push(abortError); }
    }
  });

  return {
    fit, chatDocument, observations, fitWasAborted,
    markActivation() { activated = true; record("chat-activation-started"); },
    async wait(signal: ReturnType<typeof createSignal>) {
      await expect.poll(() => {
        throwFailures(failures, "Real-response interception failed.");
        return signal.resolved;
      }, { timeout: 10_000, message: "The held response must settle before test cleanup." }).toBe(true);
      throwFailures(failures, "Real-response interception failed.");
    },
    check() { throwFailures(failures, "Real-response interception failed."); },
    async finish() {
      fit.release.resolve();
      chatDocument.release.resolve();
      try { await page.unrouteAll({ behavior: "wait" }); }
      catch (error: unknown) { failures.push(error); }
      page.off("request", onRequest);
      page.off("requestfailed", onRequestFailed);
      page.off("framenavigated", onFrameNavigated);
      try {
        expect(observations.browserPosts).toBe(1);
        expect(observations.inputs).toHaveLength(1);
        expect(observations.responses).toHaveLength(1);
      } catch (error: unknown) { failures.push(error); }
      throwFailures(failures, "Chat navigation cleanup or response counts failed.");
    },
  };
}

async function withPendingFit(
  page: Page,
  testInfo: TestInfo,
  locale: "en" | "zh-CN",
  action: (
    interception: Awaited<ReturnType<typeof interceptChatNavigation>>,
    chatLink: Locator,
    existingPages: ReadonlySet<Page>,
    record: RecordEvent,
  ) => Promise<void>,
) {
  const startedAt = performance.now();
  const events: Array<Record<string, unknown>> = [];
  const record: RecordEvent = (type, fields = {}) => {
    events.push({ type, elapsedMs: performance.now() - startedAt, ...fields });
  };
  const stopObservingNativeClicks = await observeNativeClicks(page, record);
  const interception = await interceptChatNavigation(page, record);
  const context = page.context();
  const existingPages = new Set(context.pages());
  const ownedPages = new Set<Page>();
  const ownedPageErrors: Error[] = [];
  const onOwnedPageError = (error: Error) => {
    ownedPageErrors.push(error);
    record("owned-chat-page-runtime-error", describeFailure(error));
  };
  const observePage = (created: Page) => {
    if (existingPages.has(created) || ownedPages.has(created)) return;
    ownedPages.add(created);
    created.on("pageerror", onOwnedPageError);
  };
  context.on("page", observePage);
  try {
    await checkBrowserRuntimeErrors(page, testInfo, async () => {
      const failures: unknown[] = [];
      try {
        if (locale === "zh-CN") await context.addCookies([{
          name: "diesel_locale", value: locale,
          url: testInfo.project.use.baseURL ?? "http://127.0.0.1:3100",
        }]);
        const zh = locale === "zh-CN";
        // Compile/render chat before the race, so cold Next dev compilation
        // cannot reload the source document while its response is held.
        await page.goto(committedChatHref);
        await expect(page.getByRole("heading", { name: zh ? "AI 营销分析助手" : "AI sales analysis assistant", exact: true })).toBeVisible();
        record("chat-warmed-before-fit");
        // Warm compilation without starting an evaluation. The first API
        // compilation can otherwise trigger a dev reload during the race.
        const invalidFit = await page.request.post("/api/product-fit", { data: {} });
        expect(invalidFit.status()).toBe(400);
        record("invalid-fit-preflight-rejected", { status: invalidFit.status() });
        // No model in the initial URL: exactly one explicitly submitted fit.
        await page.goto(initialUrl);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(page.getByTestId("country-detail")).toBeVisible();
        // Warm a second document without duplicating the native input under
        // test. A modified click here can be accepted without creating a tab
        // in headless Chromium, before any fit or measured action has started.
        // The actual race below still requires the unchanged native click.
        const warmChat = await context.newPage();
        await warmChat.goto(committedChatHref);
        await expect(warmChat.locator("html")).toHaveAttribute("lang", locale);
        await expect(warmChat).toHaveURL((url) => `${url.pathname}${url.search}` === committedChatHref);
        // A server-rendered lang/URL does not prove that this new tab finished
        // loading or hydrated. Closing it earlier races Chromium's active-tab
        // transition with the source-page reload in cold runs.
        await warmChat.waitForLoadState("load");
        await expect(warmChat.getByRole("button", { name: "EN", exact: true })).toBeEnabled();
        await warmChat.close();
        await page.bringToFront();
        await page.waitForFunction(() => document.hasFocus() && document.visibilityState === "visible");
        await page.reload({ waitUntil: "networkidle" });
        await expect(page).toHaveURL((url) => `${url.pathname}${url.search}` === initialUrl);
        record("cold-chat-tab-closed-before-fit");
        await page.getByRole("radio", { name: /^DEMO-ENG-100/ }).check();
        expect(interception.observations.browserPosts).toBe(0);
        await page.getByLabel(zh ? "功率（kW）" : "Power (kW)", { exact: true }).fill("150");
        await page.getByRole("button", { name: zh ? "运行确定性匹配" : "Run deterministic fit", exact: true }).click();
        await interception.wait(interception.fit.ready);
        await expect(page.getByTestId("product-fit-evaluation-loading")).toBeVisible();
        await page.evaluate((marker) => {
          Object.defineProperty(document, marker, { value: true });
        }, documentMarker);
        expect(await hasOriginalDocument(page)).toBe(true);
        expect(interception.fit.release.resolved).toBe(false);
        const chatLink = page.getByRole("link", { name: zh ? "在对话中分析" : "Analyze in chat", exact: true });
        await expect(chatLink).toBeVisible();
        await expect(chatLink).toHaveAttribute("href", committedChatHref);
        expect(await chatLink.getAttribute("target")).toBeNull();
        expect(await chatLink.getAttribute("download")).toBeNull();
        await action(interception, chatLink, existingPages, record);
      } catch (error: unknown) {
        failures.push(error);
        record("assertion-failed", describeFailure(error));
      } finally {
        // Keep runtime-error observation active through all gated cleanup.
        try { await interception.finish(); }
        catch (error: unknown) { failures.push(error); record("route-cleanup-failed", describeFailure(error)); }
        context.pages().forEach(observePage);
        for (const created of ownedPages) {
          try { if (!created.isClosed()) await created.close(); }
          catch (error: unknown) { failures.push(error); }
          created.off("pageerror", onOwnedPageError);
        }
        context.off("page", observePage);
        failures.push(...ownedPageErrors);
        record("all-gates-drained", { url: page.url(), fitAborted: interception.fitWasAborted(), ownedPageCount: ownedPages.size });
      }
      throwFailures(failures, "Product-fit chat navigation failed.");
    });
  } finally {
    stopObservingNativeClicks();
    await testInfo.attach("product-fit-chat-navigation-observations", {
      contentType: "application/json",
      body: Buffer.from(JSON.stringify({
        version: "product-fit-chat-navigation-observations-v1",
        responseSource: "Existing PGlite Demo responses forwarded unchanged",
        locale, project: testInfo.project.name, retry: testInfo.retry,
        fitAborted: interception.fitWasAborted(),
        ...interception.observations, events,
      }, null, 2)),
    });
  }
}

for (const locale of ["en", "zh-CN"] as const) {
  test(`keeps the current fit running when Analyze in chat opens a new tab (${locale})`, async ({ page }, testInfo) => {
    await withPendingFit(page, testInfo, locale, async (interception, chatLink, existingPages, record) => {
      interception.markActivation();
      // Native modified-click can create a tab without an opener. Observe the
      // context page event, not just popup; only the original page is routed.
      const [newPage] = await Promise.all([
        page.context().waitForEvent("page", { predicate: (created) => !existingPages.has(created) }),
        chatLink.click({ modifiers: ["ControlOrMeta"] }),
      ]);
      await expect(newPage).toHaveURL((url) => `${url.pathname}${url.search}` === committedChatHref);
      await expect(newPage.locator("html")).toHaveAttribute("lang", locale);
      await expect(page).toHaveURL((url) => `${url.pathname}${url.search}` === initialUrl);
      expect(interception.observations.committedNavigations).toHaveLength(0);
      expect(await hasOriginalDocument(page)).toBe(true);
      await expect(page.getByTestId("product-fit-evaluation-loading")).toBeVisible();
      expect(interception.fitWasAborted()).toBe(false);
      expect(interception.fit.release.resolved).toBe(false);
      expect(interception.observations.chatDocuments).toHaveLength(0);
      record("new-chat-tab-left-fit-pending", { chatUrl: newPage.url(), sourceUrl: page.url(), fitAborted: interception.fitWasAborted() });

      interception.fit.release.resolve();
      await interception.wait(interception.fit.delivered);
      await expect(page.getByTestId("product-fit-evaluation-loading")).toBeHidden();
      await expect(page.getByTestId("product-fit-status-not_fit")).toBeVisible();
      await expect(page).toHaveURL((url) => url.pathname === "/countries/CHN" &&
        url.searchParams.get("applicationScope") === "non-road" && url.searchParams.get("asOf") === "2026-01-20" &&
        url.searchParams.get("powerKw") === "150" && url.searchParams.get("productModelCode") === "DEMO-ENG-100" &&
        url.searchParams.getAll("utm_term").join(",") === "engine,export");
      expect(await hasOriginalDocument(page)).toBe(true);
      await expect(page.getByTestId("country-applicability-summary")).toContainText(locale === "zh-CN"
        ? "非道路 · 150 kW · 截止 2026年1月20日"
        : "Non-road · 150 kW · As of Jan 20, 2026");
      await expect(newPage).toHaveURL((url) => `${url.pathname}${url.search}` === committedChatHref);
      expect(interception.fitWasAborted()).toBe(false);
      expect(interception.observations.countryRequests).toHaveLength(1);
      expect(interception.observations.browserPosts).toBe(1);
    });
  });

  for (const activation of ["primary click", "keyboard Enter"] as const) {
    test(`preserves same-tab Analyze in chat after ${activation} while a fit is pending (${locale})`, async ({ page }, testInfo) => {
      await withPendingFit(page, testInfo, locale, async (interception, chatLink, existingPages, record) => {
        if (activation === "keyboard Enter") {
          await chatLink.focus();
          await expect(chatLink).toBeFocused();
        }
        interception.markActivation();
        // Do not wait for native navigation while its real document response
        // is intentionally held below. Neither action replaces the anchor.
        if (activation === "primary click") await chatLink.click({ noWaitAfter: true });
        else await chatLink.press("Enter", { noWaitAfter: true });
        await interception.wait(interception.chatDocument.ready);
        expect(interception.chatDocument.release.resolved).toBe(false);
        // Chromium suspends script evaluation during a held native document
        // navigation. Observe commit events instead of evaluating the old DOM.
        expect(interception.observations.committedNavigations).toHaveLength(0);
        expect(new URL(page.url()).pathname).toBe("/countries/CHN");
        await expect.poll(() => {
          interception.check();
          return interception.fitWasAborted();
        }).toBe(true);
        expect(interception.observations.chatDocuments).toEqual([{
          afterActivation: true,
          rsc: null,
          url: new URL(committedChatHref, page.url()).href,
        }]);

        interception.fit.release.resolve();
        await interception.wait(interception.fit.delivered);
        expect(interception.fitWasAborted()).toBe(true);
        expect(interception.chatDocument.release.resolved).toBe(false);
        expect(interception.observations.countryRequests).toHaveLength(0);
        expect(interception.observations.committedNavigations).toHaveLength(0);
        record("aborted-fit-settled-before-chat-document", { activation, sourceUrl: page.url() });

        interception.chatDocument.release.resolve();
        await interception.wait(interception.chatDocument.delivered);
        await expect(page).toHaveURL((url) => `${url.pathname}${url.search}` === committedChatHref);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        expect(await hasOriginalDocument(page)).toBe(false);
        expect(interception.observations.committedNavigations).toEqual([page.url()]);
        await expect(page.getByTestId("country-detail")).toHaveCount(0);
        expect(interception.observations.countryRequests).toHaveLength(0);
        expect(interception.observations.browserPosts).toBe(1);
        expect(page.context().pages().filter((created) => !existingPages.has(created))).toHaveLength(0);
      });
    });
  }
}
