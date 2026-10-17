import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SALES_CHAT_HARNESS_VERSION, salesChatHarnessCases } from "../evals/sales-chat-harness-cases";
import { readConversationMetadata } from "@/features/ai/conversation-state";
import { catalogHarnessResponse } from "@/server/ai/catalog-harness";
import { buildCapabilityChatResponse, buildSocialChatResponse } from "@/server/ai/chat-turn-guidance";
import { verifyConversationReceipt } from "@/server/ai/conversation-receipt";
import { createPortfolioDemoModel } from "@/server/ai/portfolio-demo-model";
import { createSalesChatTools } from "@/server/ai/sales-chat";
import { getDemoDatabase } from "@/server/db/demo-client";

const originalDatabaseMode = process.env.DATABASE_MODE;
beforeAll(async () => { process.env.DATABASE_MODE = "pglite-demo"; await getDemoDatabase(); });
afterAll(() => {
  if (originalDatabaseMode === undefined) delete process.env.DATABASE_MODE;
  else process.env.DATABASE_MODE = originalDatabaseMode;
});

type Part = { type: string; toolName?: string; delta?: string; finishReason?: string; messageMetadata?: unknown };

/** One browser-shaped conversation: direct replies first, then the harness turn. */
async function runConversation(userTexts: readonly string[], selectedCountryIso3: string | null) {
  const sessionId = crypto.randomUUID();
  let previous: ReturnType<typeof verifyConversationReceipt> = null;
  let last: { direct: boolean; tools: string[]; finishReason?: string; text: string; toolErrors: number } | null = null;
  for (const text of userTexts) {
    const direct = buildSocialChatResponse(text, "zh-CN") ?? buildCapabilityChatResponse({ locale: "zh-CN", selectedCountryIso3, text });
    if (direct) { last = { direct: true, tools: [], text: direct, toolErrors: 0 }; continue; }
    const response = catalogHarnessResponse({ model: createPortfolioDemoModel(),
      tools: createSalesChatTools({ auditRepository: { recordToolCall: async () => undefined }, sessionId, selectedCountryIso3 }),
      signal: new AbortController().signal, locale: "zh-CN", today: new Date().toISOString().slice(0, 10), userText: text,
      messages: [{ role: "user", content: text }], previous, sessionId, selectedCountryIso3, requestId: crypto.randomUUID() });
    const parts = (await response.text()).split("\n").filter(line => line.startsWith("data: {")).map(line => JSON.parse(line.slice(6)) as Part);
    const finish = parts.findLast(part => part.type === "finish");
    previous = verifyConversationReceipt(readConversationMetadata(finish?.messageMetadata)?.conversation.receipt,
      { sessionId, selectedCountryIso3, previousUserText: text });
    last = { direct: false, tools: parts.filter(part => part.type === "tool-input-available").map(part => part.toolName ?? ""),
      finishReason: finish?.finishReason, text: parts.filter(part => part.type === "text-delta").map(part => part.delta ?? "").join(""),
      toolErrors: parts.filter(part => part.type === "tool-output-error").length };
  }
  return last!;
}

describe(`offline harness eval (${SALES_CHAT_HARNESS_VERSION})`, () => {
  it.each(salesChatHarnessCases)("$id", async (testCase) => {
    const result = await runConversation(testCase.userTexts, testCase.selectedCountryIso3);
    if (testCase.expected === "direct_response") {
      expect(result.direct).toBe(true);
      return;
    }
    expect(result.direct).toBe(false);
    expect(result.tools).toEqual(testCase.expected.tools);
    // Every case completes the turn: either verified evidence or a question, never a stuck loop.
    expect(result.finishReason).toBe("stop");
    expect(result.toolErrors).toBe(0);
    expect(result.text.trim().length).toBeGreaterThan(0);
  }, 30_000);
});
