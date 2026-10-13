import { expect, test } from "@playwright/test";
import { getDictionary } from "../src/i18n/dictionaries";
import { noDataChatEvents } from "./helpers/chat-evidence";
import { ANALYSES_STORAGE_KEY } from "../src/features/analyses/storage";

for (const locale of ["en", "zh-CN"] as const) {
  test(`${locale} twenty-turn conversation restores its latest window and continues with the newest receipt`, async ({ page, context, baseURL }) => {
    const copy = getDictionary(locale).chat;
    await context.addCookies([{ name: "diesel_locale", value: locale, url: baseURL! }]);
    let requests = 0;
    await page.route("**/api/chat", async route => {
      const body = route.request().postDataJSON() as { conversation: { receipt?: string }; messages: { role: string }[] };
      requests += 1;
      if (requests > 1) expect(body.conversation.receipt).toBe(`recent-receipt-${requests - 1}`);
      expect(body.messages.length).toBeLessThanOrEqual(12);
      expect(body.messages.every(message => message.role === "user")).toBe(true);
      await route.fulfill({ headers: { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" }, body: [
        { type: "start", messageId: `recent-${requests}` },
        { type: "text-start", id: "answer" }, { type: "text-delta", id: "answer", delta: `Recent complete answer ${requests}` },
        { type: "text-end", id: "answer" },
        { type: "finish", finishReason: "stop", messageMetadata: { conversation: { receipt: `recent-receipt-${requests}`,
          state: { tasks: [], countryIso3s: ["DEU"], applicationScope: "construction", powerKw: 200, asOf: "2026-08-13", productModelCode: null }, mode: "general" } } },
      ].map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n" });
    });
    async function send(turn: number) {
      await page.getByRole("textbox", { name: copy.questionInput, exact: true }).fill(`Question ${turn}`);
      await page.getByRole("button", { name: copy.send, exact: true }).click();
      await expect(page.getByTestId("assistant-markdown").last()).toHaveText(`Recent complete answer ${turn}`);
      await expect(page.getByText(copy.statusComplete, { exact: true })).toBeAttached();
    }
    await page.goto("/chat");
    for (let turn = 1; turn <= 20; turn += 1) await send(turn);
    await expect(page.getByText(copy.historyWindowed, { exact: false })).toBeVisible();
    await expect(page.getByText(copy.historyUnavailable, { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("assistant-markdown")).toHaveCount(12);
    await expect(page.getByTestId("assistant-markdown").last()).toHaveText("Recent complete answer 20");
    await send(21);
    await expect(page.getByText(copy.historyUnavailable, { exact: true })).toHaveCount(0);
  });

  test(`${locale} conversation receipt survives reload; greetings aren't analyses`, async ({ page, context, baseURL }) => {
    const dictionary = getDictionary(locale);
    const copy = dictionary.chat;
    await context.addCookies([{ name: "diesel_locale", value: locale, url: baseURL! }]);
    let requests = 0;
    await page.route("**/api/chat", async route => {
      requests += 1;
      const body = route.request().postDataJSON() as { conversation: { version: number; receipt?: string }; messages: { role: string }[] };
      expect(body.conversation.version).toBe(1);
      expect(body.messages.every(message => message.role === "user")).toBe(true);
      if (requests === 3) expect(body.conversation.receipt).toBe("transport-only-receipt-2");
      const state = { tasks: requests === 1 ? [] : ["regulations"], countryIso3s: requests === 1 ? [] : ["CHN"],
        applicationScope: null, powerKw: null, asOf: requests === 1 ? null : "2026-08-13", productModelCode: null };
      await route.fulfill({ headers: { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" }, body: [
        { type: "start", messageId: `conversation-${requests}` },
        ...(requests === 1 ? [] : noDataChatEvents()),
        { type: "text-start", id: "answer" }, { type: "text-delta", id: "answer", delta: requests === 1 ? "Hello, what would you like to investigate?" : "Recorded query: evidence remains incomplete." },
        { type: "text-end", id: "answer" },
        { type: "finish", finishReason: "stop", messageMetadata: { conversation: { receipt: `transport-only-receipt-${requests}`, state, mode: requests === 1 ? "general" : "research" } } },
      ].map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n" });
    });
    async function send(text: string) {
      await page.getByRole("textbox", { name: copy.questionInput, exact: true }).fill(text);
      await page.getByRole("button", { name: copy.send, exact: true }).click();
    }
    await page.goto("/chat");
    await send(locale === "en" ? "Hello" : "你好");
    await expect(page.getByTestId("assistant-markdown")).toHaveCount(1);
    await expect(page.getByTestId("save-analysis")).toHaveCount(0);
    await expect(page.getByTestId("chat-active-tasks")).toHaveCount(0);
    await send(locale === "en" ? "CHN regulations as of 2026-08-13" : "查询CHN法规，日期2026-08-13");
    await expect(page.getByTestId("assistant-markdown")).toHaveCount(2);
    await expect(page.getByTestId("save-analysis")).toBeVisible();
    await expect(page.getByTestId("chat-active-tasks")).toContainText(copy.toolCompareRegulations);
    await expect(page.getByLabel(dictionary.analysis.titleLabel, { exact: true })).not.toHaveAttribute("placeholder", "Hello");
    await page.reload();
    await expect(page.getByTestId("assistant-markdown")).toHaveCount(2);
    await send(locale === "en" ? "Explain that gap briefly" : "简单解释刚才的缺口");
    await expect(page.getByTestId("assistant-markdown")).toHaveCount(3);
    await page.getByRole("button", { name: dictionary.analysis.save, exact: true }).click();
    await expect(page.getByText(dictionary.analysis.saved, { exact: true })).toBeVisible();
    const saved = await page.evaluate(key => localStorage.getItem(key), ANALYSES_STORAGE_KEY);
    expect(saved).not.toContain("transport-only-receipt");
    await page.getByRole("button", { name: copy.newConversation, exact: true }).click();
    await expect(page.getByTestId("assistant-markdown")).toHaveCount(0);
    await expect(page.getByTestId("save-analysis")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
