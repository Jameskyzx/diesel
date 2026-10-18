import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SALES_CHAT_HARNESS_VERSION, salesChatHarnessCases } from "../evals/sales-chat-harness-cases";
import { salesChatLiveCases } from "../evals/sales-chat-live-cases";
import { runLiveEvalCase, type StreamPart } from "../scripts/ai/live-eval";
import { ToolResultCard } from "@/components/ai/sales-chat";
import { LocaleProvider } from "@/components/i18n/locale-provider";
import { toolResultCardText } from "@/features/ai/tool-card-summary";
import { toolPartPresentation } from "@/features/ai/tool-part-presentation";
import { getDictionary } from "@/i18n/dictionaries";
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

/** The offline model emits one evidence task per turn; this case needs two. */
function mixedIntentModel() {
  const state = { tasks: ["regulations", "product_fit"], countryIso3s: ["CHN"], applicationScope: "non-road", powerKw: 100, asOf: "2026-08-13", productModelCode: "DEMO-ENG-100" };
  const evidence = (task: string) => ({ state, locale: "zh-CN", action: { type: "evidence", task, countryIso3: "CHN", sourceQuery: null, marketPeriod: null } });
  const actions = [evidence("regulations"), evidence("product_fit"), { state, locale: "zh-CN", action: { type: "answer", message: "请以下方卡片核对结果。" } }];
  let index = 0;
  return new MockLanguageModelV4({ doGenerate: async () => ({ warnings: [], finishReason: { unified: "tool-calls", raw: undefined },
    usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
    content: [{ type: "tool-call", toolCallId: `action-${index}`, toolName: "act", input: JSON.stringify(actions[index++]) }] }) });
}

function visibleCardText(html: string) {
  return html.replace(/<[^>]+>/gu, "\n").replace(/&amp;/gu, "&").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, "\"").replace(/&#x27;|&#39;/gu, "'");
}

// The live eval's contract replayed with correct typed actions: if a case fails
// here, the contract, not the provider, is wrong. It also checks that every
// card line the eval grounds anchors on is text the rendered card shows.
describe("live eval contract replayed offline", () => {
  it.each(salesChatLiveCases)("$id", async (testCase) => {
    let parts: readonly StreamPart[] = [];
    const model = testCase.id === "mixed-regulation-and-product-intent" ? mixedIntentModel() : createPortfolioDemoModel();
    const report = await runLiveEvalCase(testCase, model, value => { parts = value; });
    expect({ id: report.id, mismatchReason: report.mismatchReason, missing: report.missingResponseAnchorIds })
      .toEqual({ id: testCase.id, mismatchReason: null, missing: [] });
    expect(report.pass).toBe(true);

    const dictionary = getDictionary(testCase.locale);
    expect(parts.some(part => part.type === "tool-output-available")).toBe(true);
    for (const part of parts.filter(candidate => candidate.type === "tool-output-available")) {
      const input = parts.find(candidate => candidate.type === "tool-input-available" && candidate.toolCallId === part.toolCallId);
      const presentation = toolPartPresentation({ type: "dynamic-tool", toolName: input?.toolName, state: "output-available", input: input?.input, output: part.output });
      if (presentation.kind !== "result") throw new Error("Expected a rendered result card.");
      const card = visibleCardText(renderToStaticMarkup(createElement(LocaleProvider,
        { dictionary, locale: testCase.locale } as Parameters<typeof LocaleProvider>[0],
        createElement(ToolResultCard, { countryIso2ByIso3: {}, result: presentation.result }))));
      for (const line of toolResultCardText(presentation.result, testCase.locale).split("\n")) {
        for (const segment of line.split(`${dictionary.common.labelSeparator} `).flatMap(value => value.split(" · "))) {
          expect(card).toContain(segment.trim());
        }
      }
    }
  }, 30_000);
});
