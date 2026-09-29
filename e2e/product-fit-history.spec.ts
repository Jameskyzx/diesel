import { expect, test } from "@playwright/test";

import { checkBrowserRuntimeErrors } from "./browser-runtime-errors";

for (const locale of ["en", "zh-CN"] as const) {
  test(`restores URL-bound product fit across same-country history jumps (${locale})`, async ({
    context,
    page,
  }, testInfo) => {
    await context.clearCookies();
    if (locale === "zh-CN") {
      await context.addCookies([{
        name: "diesel_locale",
        value: locale,
        url: testInfo.project.use.baseURL ?? "http://127.0.0.1:3100",
      }]);
    }
    await checkBrowserRuntimeErrors(page, testInfo, async () => {
      const zh = locale === "zh-CN";
      const power = page.getByLabel(zh ? "功率（kW）" : "Power (kW)", { exact: true });
      const scope = page.getByLabel(zh ? "应用场景" : "Application", { exact: true });
      const date = page.getByLabel(zh ? "评估日期" : "Evaluation date", { exact: true });
      const summary = page.getByTestId("country-applicability-summary");
      const result = page.getByTestId("product-fit-result");
      const fitInputs: unknown[] = [];
      page.on("request", (request) => {
        if (new URL(request.url()).pathname === "/api/product-fit" && request.method() === "POST") {
          fitInputs.push(request.postDataJSON());
        }
      });
      const nextFit = () => page.waitForResponse((response) =>
        new URL(response.url()).pathname === "/api/product-fit" &&
        response.request().method() === "POST",
      );
      const assertSelection = async (country: string, kw: number) => {
        await expect(page).toHaveURL((url) =>
          url.pathname === `/countries/${country}` &&
          url.searchParams.get("applicationScope") === "non-road" &&
          url.searchParams.get("asOf") === "2026-01-20" &&
          url.searchParams.get("powerKw") === String(kw) &&
          url.searchParams.get("productModelCode") === "DEMO-ENG-100" &&
          url.searchParams.getAll("utm_term").join(",") === "engine,export",
        );
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(power).toHaveValue(String(kw));
        await expect(scope).toHaveValue("non-road");
        await expect(date).toHaveValue("2026-01-20");
        await expect(page.getByRole("radio", { name: /^DEMO-ENG-100/ })).toBeChecked();
        await expect(summary).toContainText(zh
          ? `非道路 · ${kw} kW · 截止 2026年1月20日`
          : `Non-road · ${kw} kW · As of Jan 20, 2026`);
        await expect(result).toBeVisible();
        await expect(page.getByRole("link", { name: zh ? "在对话中分析" : "Analyze in chat" })).toHaveAttribute(
          "href",
          `/chat?asOf=2026-01-20&countryIso3=${country}&applicationScope=non-road&powerKw=${kw}&productModelCode=DEMO-ENG-100`,
        );
      };

      const initialFit = nextFit();
      await page.goto("/countries/CHN?applicationScope=non-road&asOf=2026-01-20&powerKw=100&productModelCode=DEMO-ENG-100&utm_term=engine&utm_term=export");
      expect((await initialFit).ok()).toBe(true);
      await assertSelection("CHN", 100);
      await expect(page.getByTestId("product-fit-status-fit")).toBeVisible();
      const initialHistoryLength = await page.evaluate(() => history.length);

      // Generate the history with the actual UI: CHN(A) → BRA(A) → CHN(A).
      for (const country of ["BRA", "CHN"]) {
        const fit = nextFit();
        await page.locator("#drawer-country-select").selectOption(country);
        const response = await fit;
        expect(response.ok()).toBe(true);
        expect(await response.json()).toMatchObject({
          input: { countryIso3: country, powerKw: 100 },
        });
        await assertSelection(country, 100);
      }
      expect(await page.evaluate(() => history.length)).toBe(initialHistoryLength + 2);

      // Evaluation replaces only the last entry, leaving CHN(A) → BRA(A) → CHN(B).
      const fitB = nextFit();
      await power.fill("150");
      await page.getByRole("button", { name: zh ? "运行确定性匹配" : "Run deterministic fit" }).click();
      expect((await fitB).ok()).toBe(true);
      await assertSelection("CHN", 150);
      await expect(page.getByTestId("product-fit-status-not_fit")).toBeVisible();
      expect(await page.evaluate(() => history.length)).toBe(initialHistoryLength + 2);
      expect(fitInputs).toHaveLength(4);

      // A single history jump can reuse the CHN/date component. Two sequential
      // Back calls via BRA would remount it and miss the original regression.
      for (const { delta, kw, status } of [
        { delta: -2, kw: 100, status: "fit" },
        { delta: 2, kw: 150, status: "not_fit" },
      ]) {
        const previousFitCount = fitInputs.length;
        const restoredFit = nextFit();
        await page.evaluate((steps) => history.go(steps), delta);
        const response = await restoredFit;
        expect(response.ok()).toBe(true);
        expect(await response.json()).toMatchObject({
          input: { countryIso3: "CHN", powerKw: kw, productModelCode: "DEMO-ENG-100" },
        });
        await assertSelection("CHN", kw);
        await expect(page.getByTestId(`product-fit-status-${status}`)).toBeVisible();
        expect(fitInputs).toHaveLength(previousFitCount + 1);
        expect(await page.evaluate(() => history.length)).toBe(initialHistoryLength + 2);
      }
    });
  });
}
