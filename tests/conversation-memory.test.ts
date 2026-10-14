import { describe, expect, it } from "vitest";
import { captureChatRuntimeContext } from "@/domain/ai/chat-runtime-context";
import type { ConversationState, ConversationMemory } from "@/features/ai/conversation-state";
import { prepareConversationPlan } from "@/server/ai/conversation-plan";
import { buildEvidenceRequestResponse } from "@/server/ai/conversation-answer";
import { signConversationReceipt, verifyConversationReceipt } from "@/server/ai/conversation-receipt";

const runtimeContext = captureChatRuntimeContext(new Date("2026-10-14T00:00:00Z"));
const sessionId = "00000000-0000-4000-8000-000000000001";
const base: ConversationState = { tasks: ["knowledge"], countryIso3s: ["DEU"], applicationScope: "construction",
  powerKw: 200.5, asOf: "2026-08-13", productModelCode: null };
const memory: ConversationMemory = { sourceRequest: "Regulation (EU) 2016/1628 test cycle", marketScope: null,
  responseLocale: "zh-CN", draftLength: "standard", outputKind: "evidence" };
function receipt(state = base, remembered = memory, userText = "此前的条件已确认", answer = "Not a source query or a template prefix") {
  return verifyConversationReceipt(signConversationReceipt({ sessionId, selectedCountryIso3: null,
    userText, answer, state, memory: remembered }), { sessionId, selectedCountryIso3: null, previousUserText: userText })!;
}
function turn(text: string, plan: unknown, previous = receipt()) {
  return prepareConversationPlan({ plan, previous, userTexts: [text], selectedCountryIso3: null, runtimeContext, locale: "en" });
}

describe("signed task and presentation memory, independent of prose history", () => {
  it.each([
    "另外核对一下客户型号 CLIENT200 在德国的产品适配，还是200.5 kW；保留刚才的原文查询。",
    "Check model CLIENT200 too; leave the earlier source lookup as it was.",
    "也查一下型号 CLIENT200，其他正在查的先不变。",
  ])("keeps the original source independently of a newly added task: %s", text => {
    const result = turn(text, { mode: "research", state: { ...base, tasks: ["product_fit", "knowledge"], productModelCode: "CLIENT200" },
      sourceUpdate: { action: "retain", request: null }, sourceTerms: ["CLIENT200"] });
    const source = result.contract.requirements.find(r => r.acceptedTools.includes("searchKnowledgeBase"))!;
    expect(source.query.knowledgeQuery).toBe(memory.sourceRequest);
    expect(source.query).toMatchObject({ countryIso3s: ["DEU"], applicationScope: "construction", asOf: "2026-08-13" });
    expect(result.contract.requirements.some(r => r.acceptedTools.includes("findCompatibleProducts"))).toBe(true);
    expect(result.sourceTerms).toEqual([]);
  });
  it("retains source identity over ten turns even when the source question is no longer in prose history", () => {
    let previous = receipt();
    for (let i = 0; i < 10; i++) {
      const text = `继续核对第 ${i + 1} 项`;
      const result = turn(text, { mode: "research", state: base, sourceUpdate: { action: "retain", request: null } }, previous);
      expect(result.contract.requirements[0]?.query.knowledgeQuery).toBe(memory.sourceRequest);
      previous = verifyConversationReceipt(signConversationReceipt({ sessionId, selectedCountryIso3: null, userText: text,
        answer: "No findings", state: result.state, memory: result.memory, previous }), { sessionId, selectedCountryIso3: null, previousUserText: text })!;
      expect(previous.history.length).toBeLessThanOrEqual(2);
    }
    expect(JSON.stringify(previous.history)).not.toContain("2016/1628");
    expect(previous.memory?.sourceRequest).toContain("2016/1628");
  });
  it.each(["Regulation (EU) 2016/1628 Annex II page 12", '"test cycle" OR "inspection dossier" -marine'])("replaces source identity only with human-authored text: %s", request => {
    const result = turn(`Find this original source instead: ${request}`, { mode: "research", state: base,
      sourceUpdate: { action: "replace", request }, sourceTerms: [] });
    expect(result.memory.sourceRequest).toBe(request);
    if (request.includes("OR")) expect(result.contract.requirements[0]?.query.knowledgeQuery).toContain('"test cycle" OR "inspection dossier" -marine');
    else expect(result.contract.requirements[0]?.query.knowledgeDelivery?.pages).toContain("12");
  });
  it("discards invented source projections and rejects contradictory task clearing", () => {
    const result = turn("Find the original inspection dossier", { mode: "research", state: base,
      sourceUpdate: { action: "replace", request: "Fabricated source" } });
    expect(result.memory.sourceRequest).toBe("Find the original inspection dossier");
    expect(JSON.stringify(result.contract)).not.toContain("Fabricated");
    expect(() => turn("继续", { mode: "research", state: base, sourceUpdate: { action: "clear", request: null } })).toThrow("Conflicting");
  });
  it.each(["切换任务，只看巴西市场指标，基准日期2023-12-31。", "Instead, show BRA market data as of 2023-12-31."])("discards incompatible engine filters on a new market task: %s", text => {
    const result = turn(text, { mode: "research", state: { ...base, tasks: ["market"], countryIso3s: ["BRA"], asOf: "2023-12-31" },
      sourceUpdate: { action: "clear", request: null } });
    expect(result.state).toMatchObject({ applicationScope: null, powerKw: null, productModelCode: null, countryIso3s: ["BRA"], asOf: "2023-12-31" });
    expect(result.contract.missingRequiredParameters).toEqual([]);
    expect(result.contract.requirements[0]?.requiredProfileTopics).toEqual(["market"]);
    expect(result.memory.sourceRequest).toBeNull();
  });
  it.each([
    { text: "只看德国工程机械市场", inheritance: "compatible" },
    { text: "Now look at Germany's market, keeping the same application.", inheritance: "retain" },
  ])("does not silently broaden an explicitly scoped market task: $text", ({ text, inheritance }) => {
    const result = turn(text, { mode: "research", state: { ...base, tasks: ["market"] }, filterInheritance: inheritance });
    expect(result.state.applicationScope).toBe("construction");
    expect(result.contract.missingRequiredParameters).toContain("marketApplicationScopeFilter");
  });
  it("isolates market scope within a mixed task and on the next turn", () => {
    const mixed = { ...base, tasks: ["regulations", "market"] };
    const result = turn("Keep the regulation query and add Germany market data", { mode: "research", state: mixed });
    expect(result.contract.requirements.find(r => r.acceptedTools.includes("compareRegulations"))?.query.applicationScope).toBe("construction");
    expect(result.contract.missingRequiredParameters).not.toContain("marketApplicationScopeFilter");
    const next = turn("Continue both", { mode: "research", state: mixed }, receipt(result.state, result.memory));
    expect(next.contract.missingRequiredParameters).not.toContain("marketApplicationScopeFilter");
  });
  it.each(["再简短一些。", "压成一小段。", "Trim the wording.", "我想发短信，不要那么长。"])("keeps draft language for semantic edits, independent of UI/prose: %s", text => {
    const result = turn(text, { mode: "compose", outputKind: "request_email", state: base,
      presentation: { locale: null, length: "shorter" } }, receipt(base, { ...memory, outputKind: "request_email" }));
    expect(result.memory.responseLocale).toBe("zh-CN");
    const answer = buildEvidenceRequestResponse(result)!;
    expect(answer).toContain("您好，请");
    expect(answer).not.toContain("Hello");
    expect(answer).toContain("不代表已合规或获准销售");
    const next = turn("再压一压", { mode: "compose", outputKind: "request_email", state: base,
      presentation: { locale: null, length: "shorter" } }, receipt(base, result.memory, text, "arbitrary prose"));
    expect(next.memory.draftLength).toBe("minimal");
    expect(buildEvidenceRequestResponse(next)!.length).toBeLessThan(answer.length);
  });
  it("allows an explicit language change but never treats a language edit as fact evidence", () => {
    const result = turn("Use English now", { mode: "compose", outputKind: "request_email", state: base,
      presentation: { locale: "en", length: "keep" } });
    expect(result.memory.responseLocale).toBe("en");
    expect(buildEvidenceRequestResponse(result)).toContain("does not confirm compliance");
    expect(result.memory).not.toHaveProperty("facts");
  });
});
