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
  it("grounds the requested list count even when the provider omits or invents it", () => {
    for (const items of [undefined, 7]) {
      const turn = prepareConversationPlan({ plan: { mode: "compose", outputKind: "request_checklist", state,
        presentation: { locale: "zh-CN", length: "keep", items } },
        userTexts: ["先用中文写三条资料核验清单，保留当前国家和统计期，但不要声称已经核验。"],
        previous: null, selectedCountryIso3: "CHN", runtimeContext });
      expect(turn.memory.draftItems).toBe(3);
      expect(buildEvidenceRequestResponse(turn)!.match(/^- /gmu)).toHaveLength(3);
      expect(buildEvidenceRequestResponse(turn)).toContain("以上材料均待核实");
    }
  });
  it.each(["en", "zh-CN"] as const)("preserves verification dimensions through both shortening levels, translation and format changes (%s)", locale => {
    let current = prepareConversationPlan({ plan: { mode: "compose", outputKind: "request_checklist", state },
      userTexts: ["CHN market definitions, units, coverage, reporting period, methodology and sources"],
      previous: null, selectedCountryIso3: null, runtimeContext, locale });
    for (const outputKind of ["request_checklist", "request_checklist", "request_email", "request_checklist"] as const) {
      current = next(current, "再精简成两条", { outputKind, presentation: { locale: null, length: "shorter", items: 2 } });
      const answer = buildEvidenceRequestResponse(current)!;
      for (const dimension of [/units|单位/u, /coverage|统计范围/u, /currency|币种/u, /observation|观测/u,
        /base period|比较基期/u, /sample|样本/u, /comparability|可比性/u, /files\/links|文件\/链接/u]) expect(answer).toMatch(dimension);
      expect(answer).not.toMatch(/available certification documents|已有认证文件/u);
      if (outputKind === "request_checklist") expect(answer.match(/^- /gmu)).toHaveLength(2);
    }
    current = next(current, locale === "en" ? "中文要点" : "英文要点", {
      presentation: { locale: locale === "en" ? "zh-CN" : "en", length: "keep", items: 2 } });
    expect(current.memory.responseLocale).toBe(locale === "en" ? "zh-CN" : "en");
    expect(buildEvidenceRequestResponse(current)).toMatch(/units|单位/u);
    expect(buildEvidenceRequestResponse(current)).toMatch(/coverage|统计范围/u);
  });
  it.each(["en", "zh-CN"] as const)("retains regulatory methods and applicability through every draft length and format (%s)", locale => {
    const regulatoryState: ConversationState = { ...state, tasks: ["regulations"], countryIso3s: ["JPN", "CHN"],
      applicationScope: "construction", powerKw: 120, asOf: "2026-08-13" };
    const topics = ["original_sources", "regulatory_test_methods", "regulatory_scope"];
    let current = prepareConversationPlan({ plan: { mode: "compose", outputKind: "request_checklist", state: regulatoryState,
      preparationTopics: topics }, userTexts: ["For JPN and CHN construction 120 kW as of 2026-08-13, request original regulations, test cycles and applicable power bands, not product certificates"],
      previous: null, selectedCountryIso3: null, runtimeContext, locale });
    for (const outputKind of ["request_checklist", "request_checklist", "request_email"] as const) {
      const answer = buildEvidenceRequestResponse(current)!;
      expect(answer).toMatch(/test cycles|测试循环/u);
      expect(answer).toMatch(/power ranges|功率范围/u);
      expect(answer).toMatch(/traceable originals|可追溯原件/u);
      expect(answer).not.toMatch(/emission test reports|available certification documents|排放检测报告|已有认证文件/u);
      current = next(current, "再精简成两点", { outputKind, presentation: { locale: null, length: "shorter", items: 2 } });
      expect(current.memory.preparationTopics).toEqual(topics);
      expect(current.memory.responseLocale).toBe(locale);
    }
    const email = buildEvidenceRequestResponse(current)!;
    expect(email).toMatch(/test cycles|测试循环/u);
    expect(email).toMatch(/power ranges|功率范围/u);
    expect(email).toMatch(/does not confirm compliance|不代表已合规/u);
  });
  it("defaults regulation preparation to methods without borrowing product test reports", () => {
    const current = prepareConversationPlan({ plan: { mode: "compose", outputKind: "request_checklist",
      state: { ...state, tasks: ["regulations"] } }, userTexts: ["Prepare CHN regulatory materials"],
      previous: null, selectedCountryIso3: null, runtimeContext, locale: "en" });
    const answer = buildEvidenceRequestResponse(current)!;
    expect(answer).toContain("regulatory test cycles and measurement methods");
    expect(answer).not.toContain("emission test reports");
  });
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
