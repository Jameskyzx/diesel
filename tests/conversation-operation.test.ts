import { describe, expect, it } from "vitest";
import { captureChatRuntimeContext } from "@/domain/ai/chat-runtime-context";
import type { ConversationState } from "@/features/ai/conversation-state";
import { buildEvidenceRequestResponse } from "@/server/ai/conversation-answer";
import { conversationOperationSchema, prepareConversationOperation } from "@/server/ai/conversation-plan";
import { signConversationReceipt, verifyConversationReceipt } from "@/server/ai/conversation-receipt";
import { compiledEvidenceToolCalls } from "@/server/ai/sales-chat-loop";

const runtimeContext = captureChatRuntimeContext(new Date("2026-10-14T00:00:00Z"));
const state: ConversationState = { tasks: ["market"], countryIso3s: ["BRA", "CHN"],
  applicationScope: null, powerKw: null, asOf: null, productModelCode: null };
const period = { start: "2023-01-01", end: "2024-01-01" };
const sessionId = "00000000-0000-4000-8000-000000000001";
function draft(operation: "prepare_email" | "prepare_checklist") {
  const userText = "Prepare materials for BRA and CHN market data for 2023";
  const prepared = prepareConversationOperation({ plan: { operation, state, marketPeriod: period },
    userTexts: [userText], previous: null, selectedCountryIso3: null, runtimeContext });
  const token = signConversationReceipt({ sessionId, selectedCountryIso3: null, userText,
    state: prepared.state, memory: prepared.memory, answer: buildEvidenceRequestResponse(prepared)! });
  return verifyConversationReceipt(token, { sessionId, selectedCountryIso3: null, previousUserText: userText })!;
}

describe("current operation is independent of a previous preparation format", () => {
  it.each(["prepare_email", "prepare_checklist"] as const)("research always leaves %s and compiles the new period", previousOperation => {
    const nextPeriod = { start: "2022-01-01", end: "2023-01-01" };
    const next = prepareConversationOperation({ previous: draft(previousOperation),
      userTexts: ["回到数据核对。两国不变，统计年份换成2022，先不写邮件。"], selectedCountryIso3: null, runtimeContext,
      plan: { operation: "research", state, marketPeriod: nextPeriod, marketPeriodUpdate: "replace" } });
    expect(next.mode).toBe("research");
    expect(next.outputKind).toBe("evidence");
    expect(next.memory.outputKind).toBe("evidence");
    expect(buildEvidenceRequestResponse(next)).toBeNull();
    expect(compiledEvidenceToolCalls(next.contract)).toEqual([{ tool: "compareMarkets",
      input: { countryIso3s: ["BRA", "CHN"], marketPeriod: nextPeriod } }]);
  });

  it.each(["research", "explain", "compose"] as const)("%s cannot inherit a tool-free format", operation => {
    const next = prepareConversationOperation({ previous: draft("prepare_email"), userTexts: ["Explain the data comparison"],
      selectedCountryIso3: null, runtimeContext, plan: { operation, state, marketPeriodUpdate: "retain" } });
    expect(buildEvidenceRequestResponse(next)).toBeNull();
    expect(next.contract.requirements).toHaveLength(1);
    expect(next.memory.marketPeriod).toEqual(period);
  });

  it.each(["prepare_email", "prepare_checklist"] as const)("only explicit draft revision retains %s", operation => {
    const previous = draft(operation);
    const next = prepareConversationOperation({ previous, userTexts: ["Use Chinese and shorten it"],
      selectedCountryIso3: null, runtimeContext, plan: { operation: "revise_preparation", state,
        presentation: { locale: "zh-CN", length: "shorter" }, marketPeriodUpdate: "retain" } });
    expect(next.outputKind).toBe(previous.memory!.outputKind);
    expect(next.memory.responseLocale).toBe("zh-CN");
    expect(buildEvidenceRequestResponse(next)).toMatch(/不代表已合规|均待核实/u);
  });

  it("rejects missing drafts and contradictory private mode/format fields, rather than guessing an operation", () => {
    const input = { userTexts: ["Shorter"], previous: null, selectedCountryIso3: null, runtimeContext };
    expect(() => prepareConversationOperation({ ...input, plan: { operation: "revise_preparation", state } })).toThrow("Missing preparation draft");
    for (const extra of [{ mode: "compose" }, { outputKind: "request_email" }]) {
      expect(conversationOperationSchema.safeParse({ operation: "research", state, ...extra }).success).toBe(false);
    }
    expect(conversationOperationSchema.safeParse({ mode: "compose", outputKind: "request_email", state }).success).toBe(false);
    expect(conversationOperationSchema.safeParse({ operation: "research", state: { ...state, countryIso3s: null } }).success).toBe(false);
  });
});
