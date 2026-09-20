import { Buffer } from "node:buffer";

import { expect, test, type Page, type Route } from "@playwright/test";
import { z } from "zod";

import { checkBrowserRuntimeErrors } from "./browser-runtime-errors";

test.describe.configure({ timeout: 30_000 });

const asOf = "2026-01-20";
const model = "DEMO-ENG-100";
const fitInputSchema = z.object({
  applicationScope: z.literal("non-road"),
  asOf: z.literal(asOf),
  countryIso3: z.literal("CHN"),
  powerKw: z.union([z.string(), z.number()]),
  productModelCode: z.literal(model),
}).strict();
// Validate and retain only the real response fields needed to identify each
// evaluation. Interception always forwards the untouched upstream response.
const fitResponseSchema = z.object({
  asOf: z.literal(asOf),
  input: fitInputSchema.extend({ powerKw: z.number() }),
  status: z.enum(["fit", "not_fit", "unknown"]),
});
const summaryResponseSchema = z.object({
  status: z.literal("available"),
  applicabilitySummary: z.object({
    query: z.object({
      applicationScope: z.literal("non-road"),
      asOf: z.literal(asOf),
      countryIso3s: z.array(z.literal("CHN")).length(1),
      powerKw: z.literal(175),
    }),
  }),
});

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

function canonicalSelection(url: URL, powerKw: number) {
  return url.pathname === "/countries/CHN" &&
    url.searchParams.get("applicationScope") === "non-road" &&
    url.searchParams.get("asOf") === asOf &&
    url.searchParams.get("powerKw") === String(powerKw) &&
    url.searchParams.get("productModelCode") === model &&
    url.searchParams.getAll("utm_term").join(",") === "engine,export";
}

async function interceptContinuation(
  page: Page,
  record: (type: string, values?: Record<string, unknown>) => void,
) {
  const bRsc = createHeldResponse();
  const cPost = createHeldResponse();
  const cRsc = createHeldResponse();
  const cSummaryDelivered = createSignal();
  const heldResponses = [bRsc, cPost, cRsc];
  const failures: unknown[] = [];
  const inputs: Array<z.infer<typeof fitInputSchema>> = [];
  const responses: Array<z.infer<typeof fitResponseSchema>> = [];
  const summaries: Array<z.infer<typeof summaryResponseSchema>> = [];
  const counts = { browserPosts: 0, bRsc: 0, cRsc: 0, cSummary: 0 };

  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/product-fit" && request.method() === "POST") {
      counts.browserPosts += 1;
    }
  });

  async function intercept(route: Route) {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/product-fit" && request.method() === "POST") {
      const input = fitInputSchema.parse(request.postDataJSON());
      inputs.push(input);
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      const observed = fitResponseSchema.parse(await response.json());
      expect(observed.input.powerKw).toBe(Number(input.powerKw));
      responses.push(observed);
      record("fit-response-ready", { input, observed });
      if (Number(input.powerKw) === 175) {
        cPost.ready.resolve();
        await cPost.release.promise;
      }
      await route.fulfill({ response });
      if (Number(input.powerKw) === 175) cPost.delivered.resolve();
      record("fit-response-delivered", { powerKw: observed.input.powerKw });
      return;
    }

    if (url.pathname === "/countries/CHN" && request.headers().rsc === "1") {
      const powerKw = Number(url.searchParams.get("powerKw"));
      if (powerKw === 150 || powerKw === 175) {
        const gate = powerKw === 150 ? bRsc : cRsc;
        counts[powerKw === 150 ? "bRsc" : "cRsc"] += 1;
        expect(canonicalSelection(url, powerKw)).toBe(true);
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        record("rsc-response-ready", { powerKw });
        gate.ready.resolve();
        await gate.release.promise;
        await route.fulfill({ response });
        gate.delivered.resolve();
        record("rsc-response-delivered", { powerKw });
        return;
      }
    }

    if (url.pathname === "/api/countries/CHN" && url.searchParams.get("powerKw") === "175") {
      counts.cSummary += 1;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      const observed = summaryResponseSchema.parse(await response.json());
      summaries.push(observed);
      await route.fulfill({ response });
      cSummaryDelivered.resolve();
      record("C-summary-delivered", { observed });
      return;
    }
    await route.continue();
  }

  await page.route("**/*", async (route) => {
    try {
      await intercept(route);
    } catch (error: unknown) {
      failures.push(error);
      record("interception-failed", describeFailure(error));
      // Surface an upstream failure at the next gate check instead of leaving
      // the test waiting for a gate that can no longer be reached.
      heldResponses.forEach(({ ready, delivered }) => {
        ready.resolve();
        delivered.resolve();
      });
      cSummaryDelivered.resolve();
      try {
        await route.abort("failed");
      } catch (abortError: unknown) {
        failures.push(abortError);
      }
    }
  });

  return {
    bRsc, cPost, cRsc, cSummaryDelivered,
    observations: { counts, inputs, responses, summaries },
    async wait(signal: ReturnType<typeof createSignal>) {
      await signal.promise;
      if (failures.length) throw new AggregateError(failures, "Real-response interception failed.");
    },
    async finish() {
      heldResponses.forEach(({ release }) => release.resolve());
      try {
        await page.unrouteAll({ behavior: "wait" });
      } catch (error: unknown) {
        failures.push(error);
      }
      try {
        expect(counts).toEqual({ browserPosts: 2, bRsc: 1, cRsc: 1, cSummary: 1 });
        expect(inputs.map(({ powerKw }) => Number(powerKw))).toEqual([150, 175]);
        expect(responses.map(({ input }) => input.powerKw)).toEqual([150, 175]);
        expect(summaries).toHaveLength(1);
      } catch (error: unknown) {
        failures.push(error);
      }
      if (failures.length) throw new AggregateError(failures, "Continuation cleanup or response counts failed.");
    },
  };
}

for (const locale of ["en", "zh-CN"] as const) {
  test(`commits a pending fit into the current context after its predecessor's RSC acknowledgement (${locale})`, async ({
    context,
    page,
  }, testInfo) => {
    test.skip(
      !["desktop-chromium", "mobile-chromium"].includes(testInfo.project.name),
      "Desktop and mobile Chromium cover the same mounted form's async continuation.",
    );
    await context.clearCookies();
    if (locale === "zh-CN") {
      await context.addCookies([{
        name: "diesel_locale", value: locale,
        url: testInfo.project.use.baseURL ?? "http://127.0.0.1:3100",
      }]);
    }
    const zh = locale === "zh-CN";
    const startedAt = performance.now();
    const events: Array<Record<string, unknown>> = [];
    const record = (type: string, values: Record<string, unknown> = {}) => {
      events.push({ type, elapsedMs: performance.now() - startedAt, ...values });
    };
    const interception = await interceptContinuation(page, record);
    let lastPreCRscUi: Record<string, unknown> | null = null;
    const summaryText = (kw: number) => zh
      ? `非道路 · ${kw} kW · 截止 2026年1月20日`
      : `Non-road · ${kw} kW · As of Jan 20, 2026`;

    try {
      await checkBrowserRuntimeErrors(page, testInfo, async () => {
        const failures: unknown[] = [];
        try {
          const power = page.getByLabel(zh ? "功率（kW）" : "Power (kW)", { exact: true });
          const run = page.getByRole("button", { name: zh ? "运行确定性匹配" : "Run deterministic fit", exact: true });
          const summary = page.getByTestId("country-applicability-summary");
          const result = page.getByTestId("product-fit-result");
          const loading = page.getByTestId("product-fit-evaluation-loading");
          const chat = page.getByRole("link", { name: zh ? "在对话中分析" : "Analyze in chat", exact: true });
          const snapshot = async () => ({
            url: page.url(), power: await power.inputValue(),
            resultVisible: await result.isVisible(), loadingVisible: await loading.isVisible(),
            summary: await summary.innerText(), chatHref: await chat.getAttribute("href"),
            cRscReleased: interception.cRsc.release.resolved,
          });

          // No initial product model: A has an SSR summary but cannot auto-POST.
          await page.goto("/countries/CHN?applicationScope=non-road&asOf=2026-01-20&powerKw=100&utm_term=engine&utm_term=export");
          await expect(page.locator("html")).toHaveAttribute("lang", locale);
          await expect(summary).toContainText(summaryText(100));
          await page.getByRole("radio", { name: /^DEMO-ENG-100/ }).check();
          expect(interception.observations.counts.browserPosts).toBe(0);

          await power.fill("150");
          await run.click();
          await expect(page.getByTestId("product-fit-status-not_fit")).toBeVisible();
          await interception.wait(interception.bRsc.ready);
          expect(interception.bRsc.release.resolved).toBe(false);
          expect(interception.observations.counts.browserPosts).toBe(1);

          await power.fill("175");
          await expect(result).toBeHidden();
          await run.click();
          await interception.wait(interception.cPost.ready);
          await expect(loading).toBeVisible();
          await expect(result).toBeHidden();
          expect(interception.cPost.release.resolved).toBe(false);
          expect(interception.observations.counts.browserPosts).toBe(2);

          // B commits while C's request still belongs to the original render's
          // async function. Country/date remain fixed, so the form survives.
          interception.bRsc.release.resolve();
          await interception.wait(interception.bRsc.delivered);
          await expect(page).toHaveURL((url) => canonicalSelection(url, 150));
          await expect(summary).toContainText(summaryText(150));
          await expect(power).toHaveValue("175");
          await expect(loading).toBeVisible();
          await expect(result).toBeHidden();
          expect(interception.cPost.release.resolved).toBe(false);
          record("B-committed-while-C-POST-held", await snapshot());

          interception.cPost.release.resolve();
          await interception.wait(interception.cPost.delivered);
          await Promise.all([
            interception.wait(interception.cRsc.ready),
            interception.wait(interception.cSummaryDelivered),
          ]);
          expect(interception.cRsc.release.resolved).toBe(false);
          expect(interception.observations.responses.map(({ input }) => input.powerKw)).toEqual([150, 175]);
          // The card does not print requested power. Its hidden→visible
          // transition after the validated 175 response identifies C's result.
          await expect(loading).toBeHidden();
          await expect(result).toBeVisible();
          await expect(page.getByTestId("product-fit-status-not_fit")).toBeVisible();
          await expect(power).toHaveValue("175");
          await expect.poll(async () => {
            lastPreCRscUi = await snapshot();
            return lastPreCRscUi;
          }, { message: "C's result, summary and chat must agree before C's RSC commits" }).toMatchObject({
            power: "175", resultVisible: true, loadingVisible: false,
            summary: expect.stringContaining(summaryText(175)),
            chatHref: "/chat?asOf=2026-01-20&countryIso3=CHN&applicationScope=non-road&powerKw=175&productModelCode=DEMO-ENG-100",
            cRscReleased: false,
          });
          record("pre-C-RSC-consistency-passed", lastPreCRscUi ?? {});
        } catch (error: unknown) {
          failures.push(error);
          record("assertion-failed", describeFailure(error));
        } finally {
          record("release-and-drain", { lastPreCRscUi });
          try {
            // Keep the runtime-error listener installed until all held routes
            // settle; cleanup errors must not replace the original assertion.
            await interception.finish();
          } catch (error: unknown) {
            failures.push(error);
            record("cleanup-failed", describeFailure(error));
          }
        }
        if (failures.length === 1) throw failures[0];
        if (failures.length > 1) throw new AggregateError(failures, "Product-fit continuation failed.");
      });
    } finally {
      await testInfo.attach("product-fit-continuation-observations", {
        contentType: "application/json",
        body: Buffer.from(JSON.stringify({
          version: "product-fit-continuation-observations-v1",
          locale, project: testInfo.project.name, retry: testInfo.retry,
          responseSource: "Real PGlite Demo API responses forwarded unchanged",
          ...interception.observations,
          lastPreCRscUi, events,
        }, null, 2)),
      });
    }
  });
}
