import { Buffer } from "node:buffer";

import { expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { z } from "zod";

import { localePreferenceFromCookieHeader, type Locale } from "../src/i18n/locale";
import { checkBrowserRuntimeErrors } from "./browser-runtime-errors";

test.describe.configure({ timeout: 60_000 });
test.beforeEach(async ({ context }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "This observes desktop cross-tab document/RSC coherence, not mobile tab-switching behavior.");
  await context.clearCookies();
});

const copy = {
  en: {
    button: "EN", heading: "Discuss the next move with your data", input: "Enter a question",
    navigation: "Primary navigation", title: "AI chat · Global Regulations & Market Intelligence",
  },
  "zh-CN": {
    button: "中文", heading: "和数据一起讨论下一步", input: "输入问题",
    navigation: "主导航", title: "AI 对话 · 全球法规与市场分析平台",
  },
} as const;
const markerKey = "__dieselLocaleCrossTabDocument";
const preferenceInput = z.object({ locale: z.enum(["en", "zh-CN"]) }).strict();
const preferenceResponse = preferenceInput.extend({ status: z.literal("ok") }).strict();

function describeFailure(error: unknown) {
  return { name: error instanceof Error ? error.name : "non-Error", message: error instanceof Error ? error.message.slice(0, 2_000) : "Unknown failure" };
}

function throwFailures(failures: unknown[]) {
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "Locale coherence or cleanup failed.");
}

function signal() {
  let complete = () => {};
  let resolved = false;
  const promise = new Promise<void>((resolve) => { complete = resolve; });
  return { promise, get resolved() { return resolved; }, resolve() { resolved = true; complete(); } };
}

function pathAndQuery(url: string) {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function createObservations(scenario: string) {
  return {
    version: "locale-cross-tab-v1", scenario, phase: "warming", classification: "setup",
    preferenceWrites: [] as Array<{ page: string; locale: Locale; status: number; responseLocale: Locale }>,
    setupWrites: [] as Array<{ locale: Locale; status: number }>,
    requests: [] as Array<{ page: string; phase: string; path: string; locale: Locale | null; kind: "document" | "RSC"; prefetch: string | null }>,
    chatResponses: [] as Array<{
      page: string; phase: string; path: string; locale: Locale | null; prefetch: string | null;
      status: number; contentType: string | null; headingLocales: Locale[]; delivered: boolean;
    }>,
    frames: [] as Array<{ page: string; phase: string; path: string }>,
    snapshots: [] as Array<Record<string, unknown>>,
    cookies: [] as Array<{ value: Locale | null; path: string; sameSite: string; expires: number }>,
    blockedChatPosts: 0, failures: [] as Array<ReturnType<typeof describeFailure>>,
  };
}
type Observations = ReturnType<typeof createObservations>;

async function attachObservations(testInfo: TestInfo, observations: Observations, suffix: string) {
  await testInfo.attach(`locale-cross-tab-${suffix}`, {
    contentType: "application/json", body: Buffer.from(JSON.stringify(observations, null, 2)),
  });
}

async function installObservationRoutes(page: Page, label: string, observations: Observations, holdChat: boolean) {
  const ready = signal(), release = signal(), delivered = signal();
  const failures: unknown[] = [];
  const onFrame = (frame: ReturnType<Page["mainFrame"]>) => {
    if (frame === page.mainFrame()) observations.frames.push({ page: label, phase: observations.phase, path: pathAndQuery(frame.url()) });
  };
  page.on("framenavigated", onFrame);
  await page.route("**/*", async (route) => {
    try {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname === "/api/chat" && request.method() === "POST") {
        observations.blockedChatPosts += 1;
        throw new Error("Unexpected chat submission blocked: locale tests must not call a model.");
      }
      if (url.pathname === "/api/preferences/locale" && request.method() === "POST") {
        const input = preferenceInput.parse(request.postDataJSON());
        const response = await route.fetch({ timeout: 10_000 });
        const parsed = preferenceResponse.parse(await response.json());
        observations.preferenceWrites.push({ page: label, locale: input.locale, status: response.status(), responseLocale: parsed.locale });
        expect(response.status()).toBe(200);
        expect(parsed.locale).toBe(input.locale);
        await route.fulfill({ response });
        return;
      }
      const headers = await request.allHeaders();
      const isDocument = request.isNavigationRequest() && request.resourceType() === "document";
      const isRsc = headers.rsc === "1", phase = observations.phase;
      const locale = localePreferenceFromCookieHeader(headers.cookie);
      const prefetch = headers["next-router-prefetch"] ?? null;
      if (isDocument || isRsc) observations.requests.push({
        page: label, phase, path: pathAndQuery(request.url()), locale, kind: isDocument ? "document" : "RSC", prefetch,
      });
      if (url.pathname === "/chat" && isRsc) {
        const response = await route.fetch({ timeout: 10_000 });
        const text = await response.text();
        const row = {
          page: label, phase, path: pathAndQuery(request.url()), locale, prefetch,
          status: response.status(), contentType: response.headers()["content-type"] ?? null,
          headingLocales: (["en", "zh-CN"] as const).filter((value) => text.includes(copy[value].heading)), delivered: false,
        };
        observations.chatResponses.push(row);
        expect(response.status()).toBe(200);
        expect(row.contentType).toContain("text/x-component");
        if (holdChat && phase === "chat-navigation" && prefetch === null) { ready.resolve(); await release.promise; }
        await route.fulfill({ response });
        row.delivered = true;
        if (holdChat && phase === "chat-navigation" && prefetch === null) delivered.resolve();
        return;
      }
      await route.continue();
    } catch (error: unknown) {
      failures.push(error);
      observations.failures.push(describeFailure(error));
      ready.resolve(); delivered.resolve();
      try { await route.abort("failed"); }
      catch (abortError: unknown) { failures.push(abortError); observations.failures.push(describeFailure(abortError)); }
    }
  });
  return {
    ready, release, delivered,
    async wait(target: ReturnType<typeof signal>) {
      await expect.poll(() => { throwFailures(failures); return target.resolved; }, {
        timeout: 10_000, message: "A real non-prefetch Chat RSC must reach its bounded gate.",
      }).toBe(true);
      throwFailures(failures);
    },
    async cleanup() {
      release.resolve();
      try { await page.unrouteAll({ behavior: "wait" }); }
      catch (error: unknown) { failures.push(error); observations.failures.push(describeFailure(error)); }
      page.off("framenavigated", onFrame);
      throwFailures(failures);
    },
  };
}

async function readSnapshot(page: Page, name: string, expectedMarker: string | null) {
  const values = await page.evaluate(({ markerKey, expectedMarker }) => {
    const toggle = document.querySelector('[data-testid="locale-toggle"]');
    const buttons = Array.from(toggle?.querySelectorAll("button") ?? []);
    return {
      path: `${location.pathname}${location.search}${location.hash}`, htmlLocale: document.documentElement.lang, title: document.title,
      heading: document.querySelector("main h1")?.textContent?.trim() ?? null,
      navigationLabel: document.querySelector("header nav")?.getAttribute("aria-label") ?? null,
      inputLabel: document.querySelector('label[for="sales-chat-input"]')?.textContent?.trim() ?? null,
      englishPressed: buttons.find((button) => button.textContent?.trim() === "EN")?.getAttribute("aria-pressed") ?? null,
      chinesePressed: buttons.find((button) => button.textContent?.trim() === "中文")?.getAttribute("aria-pressed") ?? null,
      localeBusy: toggle?.getAttribute("aria-busy") ?? null,
      sameDocument: expectedMarker === null ? null : Reflect.get(document, markerKey) === expectedMarker,
    };
  }, { markerKey, expectedMarker });
  const cookieLocale = localePreferenceFromCookieHeader(await page.evaluate(() => document.cookie));
  return { name, ...values, cookieLocale };
}

async function settleRenderTasks(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => { setTimeout(resolve, 0); }));
  }));
}

async function markDocument(page: Page) {
  const marker = "locale-coherence-original-document";
  await settleRenderTasks(page);
  await page.evaluate(({ markerKey, marker }) => {
    Object.defineProperty(document, markerKey, { configurable: true, value: marker });
  }, { markerKey, marker });
  return marker;
}

async function writeSetupPreference(page: Page, locale: Locale, observations: Observations) {
  const response = await page.request.post("/api/preferences/locale", { data: { locale }, timeout: 10_000 });
  observations.setupWrites.push({ locale, status: response.status() });
  expect(response.status()).toBe(200);
  expect(preferenceResponse.parse(await response.json())).toEqual({ locale, status: "ok" });
}

async function recordLocaleCookies(context: BrowserContext, observations: Observations) {
  // Neither document.cookie nor unrelated Cookie values enter attachments.
  observations.cookies = (await context.cookies()).filter(({ name }) => name === "diesel_locale").map((cookie) => ({
    value: localePreferenceFromCookieHeader(`diesel_locale=${cookie.value}`), path: cookie.path,
    sameSite: cookie.sameSite, expires: cookie.expires,
  }));
}

async function selectLocale(page: Page, locale: Locale) {
  const toggle = page.getByTestId("locale-toggle");
  const button = toggle.getByRole("button", { name: copy[locale].button, exact: true });
  await button.click();
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(toggle).toHaveAttribute("aria-busy", "false");
}

function coherentState(locale: Locale) {
  return {
    cookieLocale: locale, htmlLocale: locale, heading: copy[locale].heading, title: copy[locale].title,
    navigationLabel: copy[locale].navigation, inputLabel: copy[locale].input,
    englishPressed: String(locale === "en"), chinesePressed: String(locale === "zh-CN"), localeBusy: "false", sameDocument: true,
  };
}

async function assertCoherent(page: Page, testInfo: TestInfo, observations: Observations, locale: Locale, marker: string, path: string) {
  observations.snapshots.push(await readSnapshot(page, "before-coherence-wait", marker));
  await attachObservations(testInfo, observations, "before-coherence-assertions");
  // A same-document automatic refresh may follow the initial navigation RSC.
  // Observe its public result without requiring any particular implementation.
  let last = await readSnapshot(page, "coherence-result", marker);
  try {
    await expect.poll(async () => {
      last = await readSnapshot(page, "coherence-result", marker);
      return last;
    }, { timeout: 10_000, message: "SSR copy, client controls, Cookie and document must converge without a full-page reload." })
      .toMatchObject({ ...coherentState(locale), path });
    observations.classification = "coherent-same-document";
  } catch (error: unknown) {
    observations.classification = last.sameDocument ? "locale-coherence-failed" : "unexpected-full-document-reload";
    throw error;
  } finally {
    observations.snapshots.push(last);
  }
}

async function withObservationPages(
  a: Page, testInfo: TestInfo, scenario: string, withSecondPage: boolean,
  action: (state: { b: Page | null; observations: Observations; aRoutes: Awaited<ReturnType<typeof installObservationRoutes>> }) => Promise<void>,
) {
  const observations = createObservations(scenario);
  const b = withSecondPage ? await a.context().newPage() : null;
  const routes: Array<Awaited<ReturnType<typeof installObservationRoutes>>> = [];
  const failures: unknown[] = [];
  const execute = async () => {
    try {
      const aRoutes = await installObservationRoutes(a, "A", observations, withSecondPage);
      routes.push(aRoutes);
      if (b) routes.push(await installObservationRoutes(b, "B", observations, false));
      await action({ b, observations, aRoutes });
    } catch (error: unknown) {
      failures.push(error); observations.failures.push(describeFailure(error));
    } finally {
      for (const route of routes) route.release.resolve();
      for (const route of routes) {
        try { await route.cleanup(); }
        catch (error: unknown) { failures.push(error); observations.failures.push(describeFailure(error)); }
      }
      if (b) {
        try { await b.close(); }
        catch (error: unknown) { failures.push(error); observations.failures.push(describeFailure(error)); }
      }
    }
    throwFailures(failures);
  };
  try {
    await checkBrowserRuntimeErrors(a, testInfo, async () => {
      if (b) await checkBrowserRuntimeErrors(b, testInfo, execute);
      else await execute();
    });
  } finally {
    await attachObservations(testInfo, observations, "final-diagnostics");
  }
}

for (const [source, target] of [["en", "zh-CN"], ["zh-CN", "en"]] as const) {
  test(`initial ${source} SSR locale buttons wait for hydration before one real ${target} selection`, async ({ page, context }, testInfo) => {
    await withObservationPages(page, testInfo, `SSR-hydration-${source}-${target}`, false, async ({ observations }) => {
      if (source !== "en") await writeSetupPreference(page, source, observations);
      const path = "/chat?utm_source=locale-hydration&utm_term=a&utm_term=b#main-content";
      const response = await page.goto(path);
      if (!response) throw new Error("The initial Chat document did not return an HTTP response.");
      const html = await response.text();
      // Parse the actual response into a detached, inert document. Never insert
      // its nodes or execute its scripts in the live, hydrated page.
      const serverMarkup = await page.evaluate((markup) => {
        const document = new DOMParser().parseFromString(markup, "text/html");
        const toggle = document.querySelector('[data-testid="locale-toggle"]');
        const status = toggle?.parentElement?.querySelector('[role="status"]');
        return {
          htmlLocale: document.documentElement.lang,
          busy: toggle?.getAttribute("aria-busy") ?? null,
          liveStatus: status?.textContent?.trim() ?? null,
          buttons: Array.from(toggle?.querySelectorAll("button") ?? []).map((button) => ({
            label: button.textContent?.trim() ?? null,
            locale: button.getAttribute("lang"),
            disabled: button.hasAttribute("disabled"),
            pressed: button.getAttribute("aria-pressed"),
          })),
        };
      }, html);
      observations.snapshots.push({ name: "actual-initial-SSR-markup", status: response.status(), ...serverMarkup });
      await attachObservations(testInfo, observations, "before-SSR-disabled-assertions");
      expect(response.status()).toBe(200);
      expect(serverMarkup).toEqual({
        htmlLocale: source, busy: "false", liveStatus: "",
        buttons: (["en", "zh-CN"] as const).map((locale) => ({
          label: copy[locale].button, locale, disabled: true, pressed: String(source === locale),
        })),
      });

      const toggle = page.getByTestId("locale-toggle");
      for (const locale of ["en", "zh-CN"] as const) {
        await expect(toggle.getByRole("button", { name: copy[locale].button, exact: true })).toBeEnabled();
      }
      await expect(page.getByRole("heading", { level: 1, name: copy[source].heading, exact: true })).toBeVisible();
      await expect(page.locator("#sales-chat-input")).toBeVisible();
      const marker = await markDocument(page);
      observations.snapshots.push(await readSnapshot(page, "hydrated-before-first-selection", marker));
      observations.phase = "hydrated-explicit-selection";
      await selectLocale(page, target);
      await recordLocaleCookies(context, observations);
      await assertCoherent(page, testInfo, observations, target, marker, path);
      expect(observations.preferenceWrites).toEqual([{ page: "A", locale: target, status: 200, responseLocale: target }]);
      expect(observations.cookies).toHaveLength(1);
      expect(observations.cookies[0]).toMatchObject({ value: target, path: "/", sameSite: "Lax" });
      expect(observations.requests.filter((request) => request.page === "A" && request.kind === "document" && request.phase !== "warming")).toHaveLength(0);
      expect(observations.blockedChatPosts).toBe(0);
    });
  });

  test(`keeps fresh Chat navigation coherent after another tab switches ${source} to ${target}`, async ({ page: a, context }, testInfo) => {
    await withObservationPages(a, testInfo, `cross-tab-${source}-${target}`, true, async ({ b, observations, aRoutes }) => {
      if (!b) throw new Error("The cross-tab case requires its owned second page.");
      if (source !== "en") await writeSetupPreference(b, source, observations);
      // B warms real server compilation, but A's router has never visited Chat.
      await b.goto("/chat?utm_source=locale-cross-tab-warm");
      await expect(b.getByRole("heading", { level: 1, name: copy[source].heading, exact: true })).toBeVisible();
      await expect(b.locator("#sales-chat-input")).toBeVisible();
      await b.goto("/?utm_source=locale-cross-tab-b");
      await expect(b.getByRole("heading", { level: 1 })).toBeVisible();
      await a.goto("/?utm_source=locale-cross-tab-a");
      await expect(a.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(a.locator("html")).toHaveAttribute("lang", source);
      const marker = await markDocument(a);
      observations.snapshots.push(await readSnapshot(a, "A-before-B-switch", marker));
      observations.phase = "B-switch";
      await selectLocale(b, target);
      await expect(b).toHaveURL((url) => `${url.pathname}${url.search}` === "/?utm_source=locale-cross-tab-b");
      await recordLocaleCookies(context, observations);
      expect(observations.cookies).toHaveLength(1);
      expect(observations.cookies[0]).toMatchObject({ value: target, path: "/", sameSite: "Lax" });
      expect(observations.cookies[0]!.expires).toBeGreaterThan(Date.now() / 1_000 + 364 * 24 * 60 * 60);
      observations.snapshots.push(await readSnapshot(a, "A-after-shared-cookie-change", marker));
      observations.phase = "chat-navigation";
      const chat = a.locator('header nav a[href="/chat"]');
      await expect(chat).toBeVisible();
      await expect(chat).toHaveAttribute("href", "/chat");
      await chat.click();
      await aRoutes.wait(aRoutes.ready);
      observations.snapshots.push(await readSnapshot(a, "A-with-real-chat-RSC-held", marker));
      aRoutes.release.resolve();
      await aRoutes.wait(aRoutes.delivered);
      await expect(a).toHaveURL((url) => url.pathname === "/chat" && url.search === "");
      await expect(a.locator("#sales-chat-input")).toBeVisible();
      await settleRenderTasks(a);
      observations.classification = "fresh-navigation-received";
      await attachObservations(testInfo, observations, "before-fresh-RSC-assertions");
      expect(observations.chatResponses.some((response) => response.page === "A" && response.phase === "chat-navigation" &&
        response.prefetch === null && response.locale === target && response.status === 200 && response.delivered && response.headingLocales.includes(target))).toBe(true);
      await assertCoherent(a, testInfo, observations, target, marker, "/chat");
      expect(observations.requests.filter((request) => request.page === "A" && request.kind === "document" && request.phase !== "warming")).toHaveLength(0);
      expect(observations.preferenceWrites).toEqual([{ page: "B", locale: target, status: 200, responseLocale: target }]);
      expect(observations.blockedChatPosts).toBe(0);
    });
  });

  test(`keeps ${source} coherent when its Cookie returns before the delayed first ${target} Chat RSC arrives`, async ({ page: a, context }, testInfo) => {
    await withObservationPages(a, testInfo, `delayed-navigation-cookie-reverts-${source}-${target}`, true, async ({ b, observations, aRoutes }) => {
      if (!b) throw new Error("The delayed-navigation case requires its owned second page.");
      if (source !== "en") await writeSetupPreference(b, source, observations);
      // Warm only B's router; A must fetch its first Chat page after B's change.
      await b.goto("/chat?utm_source=locale-cross-tab-revert-warm");
      await expect(b.getByRole("heading", { level: 1, name: copy[source].heading, exact: true })).toBeVisible();
      await expect(b.locator("#sales-chat-input")).toBeVisible();
      await b.goto("/?utm_source=locale-cross-tab-revert-b");
      await expect(b.getByRole("heading", { level: 1 })).toBeVisible();
      await a.goto("/?utm_source=locale-cross-tab-revert-a");
      await expect(a.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(a.locator("html")).toHaveAttribute("lang", source);
      const marker = await markDocument(a);
      observations.snapshots.push(await readSnapshot(a, "A-before-B-round-trip", marker));

      observations.phase = "B-switch";
      await selectLocale(b, target);
      await recordLocaleCookies(context, observations);
      observations.snapshots.push(await readSnapshot(b, "B-after-target-switch", null));
      await attachObservations(testInfo, observations, "before-target-cookie-assertions");
      expect(observations.cookies).toHaveLength(1);
      expect(observations.cookies[0]).toMatchObject({ value: target, path: "/", sameSite: "Lax" });

      observations.phase = "chat-navigation";
      const chat = a.locator('header nav a[href="/chat"]');
      await expect(chat).toBeVisible();
      await expect(chat).toHaveAttribute("href", "/chat");
      await chat.click();
      await aRoutes.wait(aRoutes.ready);
      const delayedResponse = observations.chatResponses.find((response) => response.page === "A" &&
        response.phase === "chat-navigation" && response.prefetch === null && response.locale === target);
      observations.snapshots.push(await readSnapshot(a, "A-with-first-target-chat-RSC-held", marker));
      await attachObservations(testInfo, observations, "before-delayed-RSC-assertions");
      expect(aRoutes.release.resolved).toBe(false);
      expect(delayedResponse).toMatchObject({ status: 200, delivered: false, headingLocales: expect.arrayContaining([target]) });

      // The real target-language response is already fetched, so changing the
      // Cookie now cannot silently change the content that will later arrive.
      observations.phase = "B-revert-with-navigation-held";
      await selectLocale(b, source);
      await expect(b).toHaveURL((url) => `${url.pathname}${url.search}` === "/?utm_source=locale-cross-tab-revert-b");
      await recordLocaleCookies(context, observations);
      observations.snapshots.push(await readSnapshot(b, "B-after-source-restored", null));
      observations.snapshots.push(await readSnapshot(a, "A-after-cookie-restored-before-delivery", marker));
      await attachObservations(testInfo, observations, "before-restored-cookie-assertions");
      expect(observations.cookies).toHaveLength(1);
      expect(observations.cookies[0]).toMatchObject({ value: source, path: "/", sameSite: "Lax" });
      expect(aRoutes.release.resolved).toBe(false);
      expect(delayedResponse?.delivered).toBe(false);

      observations.phase = "delayed-navigation-release";
      aRoutes.release.resolve();
      await aRoutes.wait(aRoutes.delivered);
      await expect(a).toHaveURL((url) => url.pathname === "/chat" && url.search === "");
      await expect(a.locator("#sales-chat-input")).toBeVisible();
      await settleRenderTasks(a);
      observations.snapshots.push(await readSnapshot(a, "A-after-stale-target-RSC-delivered", marker));
      observations.classification = "delayed-target-RSC-delivered-after-cookie-reverted";
      await attachObservations(testInfo, observations, "before-delayed-delivery-assertions");
      expect(delayedResponse).toMatchObject({ locale: target, status: 200, delivered: true, headingLocales: expect.arrayContaining([target]) });
      await assertCoherent(a, testInfo, observations, source, marker, "/chat");
      await recordLocaleCookies(context, observations);
      expect(observations.cookies).toHaveLength(1);
      expect(observations.cookies[0]).toMatchObject({ value: source, path: "/", sameSite: "Lax" });
      expect(observations.requests.filter((request) => request.page === "A" && request.kind === "document" && request.phase !== "warming")).toHaveLength(0);
      expect(observations.preferenceWrites).toEqual([
        { page: "B", locale: target, status: 200, responseLocale: target },
        { page: "B", locale: source, status: 200, responseLocale: source },
      ]);
      expect(observations.blockedChatPosts).toBe(0);
    });
  });

  test(`same-tab ${source} to ${target} keeps Chat coherent and preserves path, repeated query and hash`, async ({ page, context }, testInfo) => {
    await withObservationPages(page, testInfo, `same-tab-${source}-${target}`, false, async ({ observations }) => {
      if (source !== "en") await writeSetupPreference(page, source, observations);
      const path = "/chat?utm_source=locale-same-tab&utm_term=a&utm_term=b#main-content";
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: copy[source].heading, exact: true })).toBeVisible();
      await expect(page.locator("#sales-chat-input")).toBeVisible();
      const marker = await markDocument(page);
      observations.phase = "same-tab-switch";
      await selectLocale(page, target);
      await recordLocaleCookies(context, observations);
      await assertCoherent(page, testInfo, observations, target, marker, path);
      expect(observations.preferenceWrites).toEqual([{ page: "A", locale: target, status: 200, responseLocale: target }]);
      expect(observations.cookies).toHaveLength(1);
      expect(observations.cookies[0]).toMatchObject({ value: target, path: "/", sameSite: "Lax" });
      expect(observations.chatResponses.some((response) => response.page === "A" && response.phase === "same-tab-switch" &&
        response.locale === target && response.status === 200 && response.delivered && response.headingLocales.includes(target))).toBe(true);
      expect(observations.blockedChatPosts).toBe(0);
    });
  });

  test(`reselecting displayed ${source} persists the explicit choice when the shared Cookie is ${target}`, async ({ page, context }, testInfo) => {
    await withObservationPages(page, testInfo, `explicit-reselect-${source}`, false, async ({ observations }) => {
      if (source !== "en") await writeSetupPreference(page, source, observations);
      const path = "/chat?utm_source=locale-reselect&utm_term=a&utm_term=b#main-content";
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: copy[source].heading, exact: true })).toBeVisible();
      await expect(page.locator("#sales-chat-input")).toBeVisible();
      await page.bringToFront();
      const marker = await markDocument(page);
      // A real preference response changes the shared Cookie without a focus or
      // route event in this foreground page. No final fit/chat result is stubbed.
      await writeSetupPreference(page, target, observations);
      observations.phase = "explicit-reselect";
      const before = await readSnapshot(page, "selected-button-with-different-cookie", marker);
      observations.snapshots.push(before);
      await attachObservations(testInfo, observations, "before-reselect-precondition");
      expect(before).toMatchObject({ htmlLocale: source, cookieLocale: target, englishPressed: String(source === "en"), chinesePressed: String(source === "zh-CN") });
      await page.getByTestId("locale-toggle").getByRole("button", { name: copy[source].button, exact: true }).click();
      await assertCoherent(page, testInfo, observations, source, marker, path);
      await recordLocaleCookies(context, observations);
      expect(observations.preferenceWrites).toEqual([{ page: "A", locale: source, status: 200, responseLocale: source }]);
      expect(observations.cookies).toHaveLength(1);
      expect(observations.cookies[0]).toMatchObject({ value: source, path: "/", sameSite: "Lax" });
      expect(observations.blockedChatPosts).toBe(0);
    });
  });
}
