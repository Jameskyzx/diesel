import { expect, test } from "@playwright/test";

import { getDictionary } from "../src/i18n/dictionaries";

for (const locale of ["en", "zh-CN"] as const) {
  const dictionary = getDictionary(locale);
  const copy = dictionary.queryEditor;
  test.describe(locale, () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([{ name: "diesel_locale", value: locale, url: baseURL ?? "http://127.0.0.1:3100" }]);
  });

  test(`${locale} regulation query needs no product or model request and remains shareable`, async ({ page }, testInfo) => {
    let paidOrProductRequests = 0;
    page.on("request", (request) => {
      if (["/api/chat", "/api/product-fit"].includes(new URL(request.url()).pathname)) paidOrProductRequests += 1;
    });
    await page.goto("/countries/CHN?utm_term=a&utm_term=b");
    const form = page.getByTestId("regulation-query-form");
    await form.getByLabel(copy.scope, { exact: true }).selectOption("non-road");
    await form.getByLabel(copy.power, { exact: true }).fill("120");
    await form.getByLabel(copy.date, { exact: true }).fill("2026-01-20");
    await form.getByRole("button", { name: copy.runRegulations }).click();
    await expect(page).toHaveURL(/powerKw=120/);
    const params = new URL(page.url()).searchParams;
    expect(params.has("productModelCode")).toBe(false);
    expect(params.getAll("utm_term")).toEqual(["a", "b"]);
    await expect(page.getByTestId("country-applicability-summary")).toContainText("120 kW");
    await page.reload();
    await expect(form.getByLabel(copy.power, { exact: true })).toHaveValue("120");
    await form.getByLabel(copy.scope, { exact: true }).selectOption("marine");
    await form.getByRole("button", { name: copy.runRegulations }).click();
    await expect(page).toHaveURL(/applicationScope=marine/);
    await expect(page.getByTestId("country-applicability-summary")).toContainText(copy.regulationEvidence);
    expect(paidOrProductRequests).toBe(0);
    await page.getByTestId("country-applicability-summary").scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("regulation-gap.png") });
  });

  test(`${locale} chat editor prepares exact new conditions without sending automatically`, async ({ page }, testInfo) => {
    const bodies: unknown[] = [];
    await page.route("**/api/chat", async (route) => {
      bodies.push(route.request().postDataJSON());
      await route.fulfill({ headers: { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" }, body: [
        { type: "start", messageId: "context-answer" }, { type: "text-start", id: "answer" },
        { type: "text-delta", id: "answer", delta: "CONTEXT_REPLY" }, { type: "text-end", id: "answer" },
        { type: "finish", finishReason: "stop" },
      ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n" });
    });
    await page.goto("/chat?countryIso3=CHN&productModelCode=OLD&utm_term=a&utm_term=b");
    await page.getByText(copy.editConditions, { exact: true }).click();
    const form = page.getByTestId("chat-context-form");
    await form.getByLabel(dictionary.workspace.contextCountry, { exact: true }).selectOption("DEU");
    await form.getByLabel(dictionary.workspace.contextScope, { exact: true }).selectOption("construction");
    await form.getByLabel(dictionary.productFit.power, { exact: true }).fill("120");
    await form.getByLabel(dictionary.workspace.contextDate, { exact: true }).fill("2026-08-12");
    await form.locator('[name="productModelCode"]').fill("");
    await page.screenshot({ path: testInfo.outputPath("chat-editor.png"), fullPage: true });
    await form.getByRole("button", { name: copy.applyChat }).click();
    await expect(page).toHaveURL((url) => url.searchParams.get("countryIso3") === "DEU" && !url.searchParams.has("productModelCode"));
    expect(new URL(page.url()).searchParams.has("productModelCode")).toBe(false);
    expect(new URL(page.url()).searchParams.getAll("utm_term")).toEqual(["a", "b"]);
    const question = page.locator("#sales-chat-input");
    await expect(question).toHaveValue(/DEU/);
    const prompt = await question.inputValue();
    expect(prompt).toContain("120 kW");
    expect(prompt).not.toMatch(/product fit|产品适配/);
    expect(bodies).toHaveLength(0);
    await page.locator('[data-sales-chat-root] button[type="submit"]').click();
    await expect(page.getByText("CONTEXT_REPLY", { exact: true })).toBeVisible();
    expect(bodies).toEqual([expect.objectContaining({ locale, selectedCountryIso3: "DEU", messages: [expect.objectContaining({ role: "user", parts: [{ type: "text", text: prompt }] })] })]);
    await page.reload();
    await expect(page.getByTestId("chat-query-context")).toContainText("DEU");
  });
  });
}
