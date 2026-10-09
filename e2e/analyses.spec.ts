import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { ANALYSES_STORAGE_KEY } from "../src/features/analyses/storage";
import { savedAnalysisSchema } from "../src/features/analyses/schemas";
import { getDictionary } from "../src/i18n/dictionaries";

const comparisonUrl = "/compare?countryIso3s=CHN&countryIso3s=BRA&applicationScope=non-road&powerKw=120&asOf=2026-08-13";
for (const locale of ["en", "zh-CN"] as const) {
  const dictionary = getDictionary(locale);
  const copy = dictionary.analysis;
  test.describe(`${locale} analysis workflows`, () => {
    test.beforeEach(async ({ context, baseURL }) => {
      await context.addCookies([{ name: "diesel_locale", value: locale, url: baseURL! }]);
    });
    test("comparison is shareable, saved across tabs, exportable and explicitly deletable", async ({ page, context }, testInfo) => {
      let modelRequests = 0;
      page.on("request", request => { if (new URL(request.url()).pathname === "/api/chat") modelRequests += 1; });
      await page.goto("/compare");
      await page.getByLabel(copy.countrySlot.replace("{number}", "1"), { exact: true }).selectOption("CHN");
      await page.getByLabel(copy.countrySlot.replace("{number}", "2"), { exact: true }).selectOption("BRA");
      await page.getByLabel(dictionary.queryEditor.scope, { exact: true }).selectOption("non-road");
      await page.getByLabel(dictionary.queryEditor.date, { exact: true }).fill("2026-08-13");
      await page.getByRole("button", { name: copy.runComparison, exact: true }).click();
      await expect(page.getByTestId("comparison-results")).toContainText("g/kWh");
      await expect(page.getByTestId("comparison-results")).toContainText(dictionary.chat.demoEvidenceWarning);
      expect(new URL(page.url()).searchParams.getAll("countryIso3s").filter(Boolean)).toEqual(["CHN", "BRA"]);
      await page.reload();
      await expect(page.getByTestId("comparison-results")).toContainText("120 kW");
      const originalUrl = page.url();
      await page.getByRole("button", { name: locale === "en" ? "中文" : "EN", exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("lang", locale === "en" ? "zh-CN" : "en");
      await expect(page).toHaveURL(originalUrl);
      await expect(page.getByTestId("comparison-results")).toContainText("120 kW");
      await page.getByRole("button", { name: locale === "en" ? "EN" : "中文", exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      expect(modelRequests).toBe(0);
      expect((await page.getByLabel(copy.titleLabel, { exact: true }).boundingBox())?.width).toBeGreaterThan(180);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath("country-comparison.png"), fullPage: true });
      await page.getByLabel(copy.titleLabel, { exact: true }).fill("CHN / BRA research");
      await page.getByRole("button", { name: copy.save, exact: true }).click();
      await expect(page.getByText(copy.saved, { exact: true })).toBeVisible();
      const library = await context.newPage();
      await library.goto("/analyses");
      await library.getByRole("button", { name: "CHN / BRA research", exact: true }).click();
      await expect(library.getByTestId("saved-analysis-report")).toContainText(copy.historicalNotice);
      const jsonDownload = library.waitForEvent("download");
      await library.getByRole("button", { name: copy.exportJson, exact: true }).click();
      const jsonFile = await (await jsonDownload).path();
      const saved = savedAnalysisSchema.parse(JSON.parse(await readFile(jsonFile!, "utf8")));
      expect(saved.payload.kind).toBe("comparison");
      const htmlDownload = library.waitForEvent("download");
      await library.getByRole("button", { name: copy.exportHtml, exact: true }).click();
      const html = await readFile((await (await htmlDownload).path())!, "utf8");
      expect(html).toContain(copy.historicalNotice);
      expect(html).toContain("g/kWh");
      expect(html).toMatch(/<details[^>]* open/);
      expect(html).not.toContain("<script");
      const offline = await context.newPage();
      await offline.setContent(html);
      await expect(offline.getByText(copy.historicalNotice, { exact: true })).toBeVisible();
      await expect(offline.getByRole("table")).toContainText("g/kWh");
      await offline.close();
      await library.screenshot({ path: testInfo.outputPath("saved-report.png"), fullPage: true });
      await library.getByRole("button", { name: copy.delete, exact: true }).click();
      await expect(library.getByText(copy.deleteConfirm)).toBeVisible();
      await library.getByRole("button", { name: copy.cancel, exact: true }).click();
      await expect(library.getByTestId("saved-analysis-report")).toBeVisible();
      await library.getByRole("button", { name: copy.delete, exact: true }).click();
      await library.getByRole("button", { name: copy.confirmDelete, exact: true }).click();
      await expect(library.getByTestId("saved-analysis-report")).toHaveCount(0);
      await library.reload();
      await expect(library.getByText(copy.empty, { exact: false })).toBeVisible();
      await library.close();
    });
    test("invalid conditions and failed requests stay distinct from missing evidence", async ({ page }) => {
      await page.goto(comparisonUrl.replace("countryIso3s=BRA", "countryIso3s=CHN"));
      await expect(page.getByText(copy.invalidComparison)).toBeVisible();
      await page.route("**/api/countries/BRA?*", route => route.fulfill({ status: 503, body: "unavailable" }));
      await page.goto(comparisonUrl);
      await expect(page.getByText(copy.comparisonError)).toBeVisible();
      await expect(page.getByTestId("comparison-results")).toHaveCount(0);
      await page.unroute("**/api/countries/BRA?*");
      await page.getByRole("button", { name: dictionary.common.retry, exact: true }).click();
      await expect(page.getByTestId("comparison-results")).toContainText("g/kWh");
      await page.goto(comparisonUrl.replace("countryIso3s=BRA", "countryIso3s=BRA&countryIso3s=USA"));
      await expect(page.getByTestId("comparison-results")).toContainText(copy.noCountryData);
      await expect(page.getByTestId("comparison-results").getByRole("columnheader")).toHaveCount(4);
    });
    test("completed chat can be saved and exported without replaying a model request", async ({ page }) => {
      let requests = 0;
      await page.route("**/api/chat", async route => {
        requests += 1;
        await route.fulfill({ headers: { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" }, body: [
          { type: "start", messageId: "saved-answer" }, { type: "text-start", id: "answer" },
          { type: "text-delta", id: "answer", delta: "Historical evidence explanation. <script>UNTRUSTED</script>" },
          { type: "text-end", id: "answer" }, { type: "finish", finishReason: "stop" },
        ].map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n" });
      });
      await page.goto("/chat");
      await page.getByRole("button", { name: dictionary.chatPage.starterCurrent, exact: true }).click();
      await expect(page.getByRole("button", { name: copy.save, exact: true })).toBeEnabled();
      expect((await page.getByLabel(copy.titleLabel, { exact: true }).boundingBox())?.width).toBeGreaterThan(180);
      await page.getByLabel(copy.titleLabel, { exact: true }).fill("Saved chat");
      await page.getByRole("button", { name: copy.save, exact: true }).click();
      await expect(page.getByText(copy.saved, { exact: true })).toBeVisible();
      await page.goto("/analyses");
      await page.getByRole("button", { name: "Saved chat", exact: true }).click();
      await expect(page.getByTestId("saved-analysis-report")).toContainText("Historical evidence explanation");
      await expect(page.getByTestId("saved-analysis-report")).toContainText(copy.historicalNotice);
      expect(requests).toBe(1);
      expect(await page.evaluate(key => localStorage.getItem(key), ANALYSES_STORAGE_KEY)).not.toContain('"type":"reasoning"');
    });
    test("blocked local storage does not prevent a direct JSON export", async ({ page }) => {
      await page.addInitScript(() => Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Blocked", "SecurityError"); } }));
      await page.goto(comparisonUrl);
      await page.getByRole("button", { name: copy.save, exact: true }).click();
      await expect(page.getByText(copy.storageError, { exact: true })).toBeVisible();
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: copy.exportJson, exact: true }).click();
      expect((await download).suggestedFilename()).toMatch(/\.json$/);
    });
  });
}
