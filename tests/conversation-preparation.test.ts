import { describe, expect, it } from "vitest";
import { captureChatRuntimeContext } from "@/domain/ai/chat-runtime-context";
import { prepareConversationPlan } from "@/server/ai/conversation-plan";
import { buildEvidenceRequestResponse } from "@/server/ai/conversation-answer";
import { signConversationReceipt, verifyConversationReceipt } from "@/server/ai/conversation-receipt";
import type { ConversationState } from "@/features/ai/conversation-state";

const runtimeContext = captureChatRuntimeContext(new Date("2026-10-14T00:00:00Z"));
const state: ConversationState = { tasks: ["market"], countryIso3s: ["CHN"], asOf: null,
  applicationScope: null, powerKw: null, productModelCode: null };
const sessionId = "00000000-0000-4000-8000-000000000001";
function next(previous: ReturnType<typeof prepareConversationPlan>, text: string, plan: object) {
  const receipt = signConversationReceipt({ sessionId, selectedCountryIso3: null, userText: "previous request",
    answer: buildEvidenceRequestResponse(previous)!, state: previous.state, memory: previous.memory });
  return prepareConversationPlan({ previous: verifyConversationReceipt(receipt, { sessionId, selectedCountryIso3: null, previousUserText: "previous request" }),
    plan: { mode: "compose", outputKind: "request_checklist", state: previous.state, ...plan },
    userTexts: [text], selectedCountryIso3: null, runtimeContext, locale: "en" });
}
describe("task-aware neutral preparation across signed multi-turn edits", () => {
  it.each(["en", "zh-CN"] as const)("uses market materials rather than product documents (%s)", locale => {
    const first = prepareConversationPlan({ plan: { mode: "compose", outputKind: "request_checklist", state },
      userTexts: ["CHN market data; prepare materials for later verification"], previous: null, selectedCountryIso3: null, runtimeContext, locale });
    const full = buildEvidenceRequestResponse(first)!;
    expect(full).toMatch(/market statistical definitions|市场统计定义/u);
    expect(full).toMatch(/reporting periods|统计报告期/u);
    expect(full).not.toMatch(/specification sheet|emission test reports|available certification documents|规格表|排放检测报告|已有认证文件/u);
    const brief = next(first, "再精简成两点，保留待核实提醒", { presentation: { locale: null, length: "shorter", items: 2 } });
    const answer = buildEvidenceRequestResponse(brief)!;
    expect(answer.match(/^- /gmu)).toHaveLength(2);
    expect(answer.length).toBeLessThan(full.length);
    expect(brief.memory.responseLocale).toBe(locale);
    expect(answer).toMatch(/None of these materials has been verified|均待核实/u);
    const minimal = next(brief, "Shorter again", { presentation: { locale: null, length: "shorter" } });
    expect(buildEvidenceRequestResponse(minimal)!.length).toBeLessThan(answer.length);
    expect(buildEvidenceRequestResponse(minimal)!.match(/^- /gmu)).toHaveLength(2);
    const email = next(minimal, "Use English in an email", { outputKind: "request_email", presentation: { locale: "en", length: "keep" } });
    expect(buildEvidenceRequestResponse(email)).toMatch(/^Hello, please share market/u);
    expect(buildEvidenceRequestResponse(email)).toContain("does not confirm compliance");
  });
  it("retains explicit category exclusions across language, length and format changes without storing facts", () => {
    const first = prepareConversationPlan({ plan: { mode: "compose", outputKind: "request_checklist", state,
      preparationTopics: ["market_definitions", "market_periods", "original_sources"] },
      userTexts: ["CHN market definitions, reporting periods and sources only"], previous: null, selectedCountryIso3: null, runtimeContext });
    let current = first;
    for (const outputKind of ["request_email", "request_checklist", "request_email"] as const) {
      current = next(current, "再精简", { outputKind, presentation: { locale: "zh-CN", length: "shorter" } });
      const answer = buildEvidenceRequestResponse(current)!;
      expect(current.memory.preparationTopics).toEqual(first.memory.preparationTopics);
      expect(answer).not.toContain("统计方法");
      expect(answer).not.toContain("已有认证文件");
      expect(current.memory).not.toHaveProperty("facts");
    }
  });
});
