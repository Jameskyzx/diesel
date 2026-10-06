import { expect, test, type Route } from "@playwright/test";
import { z } from "zod";

import { CHAT_HISTORY_STORAGE_KEY } from "../src/features/ai/chat-history";
import { getDictionary } from "../src/i18n/dictionaries";

async function answer(route: Route, sequence: number) {
  await route.fulfill({ headers: {
    "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1",
  }, body: [
    { type: "start", messageId: `history-answer-${sequence}` },
    { type: "text-start", id: "answer" },
    { type: "text-delta", id: "answer", delta: "History test answer with a recorded query date." },
    { type: "text-end", id: "answer" },
    { type: "finish", finishReason: "stop" },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n" });
}

for (const locale of ["en", "zh-CN"] as const) {
  const dictionary = getDictionary(locale);
  const copy = dictionary.chat;
  test.describe(`${locale} completed chat restoration`, () => {
    test.beforeEach(async ({ baseURL, context }) => {
      await context.addCookies([{ name: "diesel_locale", value: locale, url: baseURL! }]);
    });

    test("reload preserves the answer, follow-up sends only user history, and New chat clears it", async ({ page }) => {
      let requests = 0;
      await page.route("**/api/chat", async route => {
        requests += 1;
        const body = z.object({ messages: z.array(z.object({
          role: z.literal("user"), parts: z.array(z.object({ type: z.literal("text"), text: z.string() })),
        })) }).parse(route.request().postDataJSON());
        expect(body.messages).toHaveLength(requests);
        await answer(route, requests);
      });
      await page.goto("/chat");
      await page.getByRole("button", { name: dictionary.chatPage.starterCurrent, exact: true }).click();
      await expect(page.getByTestId("assistant-markdown")).toContainText("History test answer");
      await page.reload();
      await expect(page.getByText(copy.historyRestored, { exact: true })).toBeVisible();
      await expect(page.getByTestId("assistant-markdown")).toContainText("History test answer");
      expect(requests).toBe(1);
      await page.getByRole("textbox", { name: copy.questionInput, exact: true }).fill("Continue with the same country and date.");
      await page.getByRole("button", { name: copy.send, exact: true }).click();
      await expect(page.getByTestId("assistant-markdown")).toHaveCount(2);
      await expect(page.getByRole("button", { name: copy.newConversation, exact: true })).toBeEnabled();
      expect(requests).toBe(2);
      await page.getByRole("button", { name: copy.newConversation, exact: true }).click();
      await expect(page.getByTestId("assistant-markdown")).toHaveCount(0);
      await page.reload();
      await expect(page.getByRole("button", { name: dictionary.chatPage.starterCurrent, exact: true })).toBeEnabled();
      await expect(page.getByTestId("assistant-markdown")).toHaveCount(0);
      expect(requests).toBe(2);
    });

    test("a changed URL context does not restore the previous conversation", async ({ page }) => {
      await page.route("**/api/chat", route => answer(route, 1));
      await page.goto("/chat");
      await page.getByRole("button", { name: dictionary.chatPage.starterCurrent, exact: true }).click();
      await expect(page.getByTestId("assistant-markdown")).toBeVisible();
      await page.goto("/chat?countryIso3=DEU");
      await expect(page.getByTestId("chat-query-context")).toContainText("DEU");
      await expect(page.getByTestId("assistant-markdown")).toHaveCount(0);
      await expect(page.getByRole("button", { name: dictionary.chatPage.starterCurrent, exact: true })).toBeEnabled();
    });

    test("unavailable tab storage shows a warning without blocking chat", async ({ page }) => {
      await page.addInitScript(() => Object.defineProperty(window, "sessionStorage", {
        get() { throw new DOMException("Test storage unavailable", "SecurityError"); },
      }));
      await page.route("**/api/chat", route => answer(route, 1));
      await page.goto("/chat");
      await expect(page.getByText(copy.historyUnavailable, { exact: true })).toBeVisible();
      await page.getByRole("button", { name: dictionary.chatPage.starterCurrent, exact: true }).click();
      await expect(page.getByTestId("assistant-markdown")).toContainText("History test answer");
      await expect(page.getByText(copy.historyUnavailable, { exact: true })).toBeVisible();
    });

    test("malformed cached history fails closed and leaves the composer usable", async ({ page }) => {
      await page.addInitScript(key => sessionStorage.setItem(key, "not valid JSON"), CHAT_HISTORY_STORAGE_KEY);
      await page.goto("/chat");
      await expect(page.getByRole("button", { name: dictionary.chatPage.starterCurrent, exact: true })).toBeEnabled();
      await expect(page.getByTestId("assistant-markdown")).toHaveCount(0);
    });
  });
}
