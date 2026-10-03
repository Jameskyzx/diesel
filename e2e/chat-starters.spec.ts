import { expect, test } from "@playwright/test";

import { getDictionary } from "../src/i18n/dictionaries";

for (const locale of ["en", "zh-CN"] as const) {
  const copy = getDictionary(locale).chatPage;
  for (const [kind, prompt] of [
    ["regulations", copy.starterCurrent],
    ["comparison", copy.starterCompare],
    ["market", copy.starterMarket],
  ] as const) {
    test(`${locale} ${kind} starter sends once and renders the answer`, async ({ baseURL, context, page }) => {
      await context.addCookies([
        { name: "diesel_locale", value: locale, url: baseURL ?? "http://127.0.0.1:3100" },
      ]);
      const answer = locale === "en"
        ? "Starter response received. Evidence gaps remain explicit."
        : "已收到示例回答，证据缺口仍明确展示。";
      let requestCount = 0;
      await page.route("**/api/chat", async (route) => {
        requestCount += 1;
        const body: unknown = route.request().postDataJSON();
        expect(body).toEqual(expect.objectContaining({
          locale,
          messages: [expect.objectContaining({
            role: "user",
            parts: [{ type: "text", text: prompt }],
          })],
        }));
        await route.fulfill({
          headers: {
            "content-type": "text/event-stream",
            "x-vercel-ai-ui-message-stream": "v1",
          },
          body: [
            { type: "start", messageId: "starter-answer" },
            { type: "text-start", id: "answer" },
            { type: "text-delta", id: "answer", delta: answer },
            { type: "text-end", id: "answer" },
            { type: "finish", finishReason: "stop" },
          ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n",
        });
      });
      await page.goto("/chat");
      await page.getByRole("button", { name: prompt, exact: true }).click();
      const chat = page.locator("[data-sales-chat-root]");
      await expect(chat.getByText(answer, { exact: true })).toBeVisible();
      await expect(chat.getByText(prompt, { exact: true })).toBeVisible();
      await expect(chat.getByRole("textbox")).toHaveValue("");
      expect(requestCount).toBe(1);
    });
  }
}
