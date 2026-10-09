import { expect, test } from "@playwright/test";

import { validateUiMessageSse } from "../src/domain/operations/synthetic-canary";
import { getDictionary } from "../src/i18n/dictionaries";

type Capture = { complete: boolean; text: string; error: boolean; bytes: number };
type CaptureWindow = Window & { __dieselChatCapture?: Capture };

for (const locale of ["zh-CN", "en"] as const) {
  test.describe(`${locale} real production starters`, () => {
    test.use({
      viewport: locale === "en" ? { width: 393, height: 851 } : { width: 1440, height: 1000 },
      isMobile: locale === "en",
      hasTouch: locale === "en",
    });
    const copy = getDictionary(locale);
    for (const [kind, prompt, tool] of [
      ["regulations", copy.chatPage.starterCurrent, "getCountryProfile"],
      ["comparison", copy.chatPage.starterCompare, "compareRegulations"],
      ["market", copy.chatPage.starterMarket, "getCountryProfile"],
    ] as const) {
      test(`${kind} crosses real admission, database and model boundaries`, async ({ context, page, baseURL }, testInfo) => {
        const health = await context.request.get("/api/health", { timeout: 15_000 });
        expect(health.status()).toBe(200);
        expect((await health.json()).version).toBe(process.env.DIESEL_LIVE_RELEASE);
        await context.addCookies([{ name: "diesel_locale", value: locale, url: baseURL! }]);
        // Read a clone; the original Response reaches the real UI unchanged.
        // Streaming UTF-8 decoding avoids CDP response-body encoding ambiguity.
        await page.addInitScript(() => {
          const originalFetch = window.fetch.bind(window);
          window.fetch = async (input, init) => {
            const response = await originalFetch(input, init);
            const url = new URL(input instanceof Request ? input.url : input.toString(), location.href);
            const method = init?.method ?? (input instanceof Request ? input.method : "GET");
            if (url.origin === location.origin && url.pathname === "/api/chat" && method === "POST") {
              const capture: Capture = { complete: false, text: "", error: false, bytes: 0 };
              (window as CaptureWindow).__dieselChatCapture = capture;
              const clone = response.clone();
              void (async () => {
                if (!clone.body) throw new Error("Missing body");
                const reader = clone.body.getReader();
                const decoder = new TextDecoder("utf-8", { fatal: true });
                try {
                  for (;;) {
                    const part = await reader.read();
                    if (part.done) break;
                    capture.bytes += part.value.byteLength;
                    if (capture.bytes > 1_000_000) {
                      void reader.cancel();
                      throw new Error("Body bound exceeded");
                    }
                    capture.text += decoder.decode(part.value, { stream: true });
                  }
                  capture.text += decoder.decode();
                  capture.complete = true;
                } finally { reader.releaseLock(); }
              })().catch(() => { capture.error = true; });
            }
            return response;
          };
        });
        let requestCount = 0;
        page.on("request", (request) => {
          if (request.url() === `${baseURL}/api/chat` && request.method() === "POST") requestCount += 1;
        });
        await page.goto("/chat");
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        const responsePromise = page.waitForResponse(
          (response) => response.url() === `${baseURL}/api/chat` && response.request().method() === "POST",
          { timeout: 90_000 },
        );
        await page.getByRole("button", { name: prompt, exact: true }).click();
        const response = await responsePromise;
        await testInfo.attach("request-result", {
          body: JSON.stringify({ status: response.status(), requestId: response.headers()["x-request-id"], locale, kind }),
          contentType: "application/json",
        });
        expect(response.status()).toBe(200);
        expect(response.headers()["x-request-id"]).toBeTruthy();
        expect(response.headers()["x-vercel-ai-ui-message-stream"]).toBe("v1");
        expect(response.request().postDataJSON()).toMatchObject({
          locale, messages: [{ role: "user", parts: [{ type: "text", text: prompt }] }],
        });
        await page.waitForFunction(() => {
          const capture = (window as CaptureWindow).__dieselChatCapture;
          return capture?.complete || capture?.error;
        }, undefined, { timeout: 90_000 });
        const capture = await page.evaluate(() => (window as CaptureWindow).__dieselChatCapture);
        expect(capture?.error).toBe(false);
        expect(capture?.complete).toBe(true);
        await testInfo.attach("public-answer-and-tool-evidence", {
          body: capture!.text, contentType: "text/plain; charset=utf-8",
        });
        expect(await validateUiMessageSse(capture!.text, { name: tool, evidenceSufficient: true })).toBe(true);
        const chat = page.locator("[data-sales-chat-root]");
        await expect(chat.locator('[role="status"][aria-busy="false"]').filter({ hasText: copy.chat.statusComplete })).toBeAttached();
        await expect(chat.getByTestId("assistant-markdown").first()).toBeVisible();
        await expect(chat.getByTestId("assistant-markdown").first()).not.toBeEmpty();
        await expect(chat.getByRole("textbox", { name: copy.chat.questionInput, exact: true })).toHaveValue("");
        expect(requestCount).toBe(1);
        await testInfo.attach("rendered-answer", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
      });
    }
  });
}
