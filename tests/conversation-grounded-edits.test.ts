import { describe, expect, it } from "vitest";
import { captureChatRuntimeContext } from "@/domain/ai/chat-runtime-context";
import { selectedMarketReportingPeriod } from "@/domain/marketing/reporting-period";
import type { ConversationMemory, ConversationState } from "@/features/ai/conversation-state";
import { prepareConversationPlan, prepareConversationRequest, conversationPlannerSchema } from "@/server/ai/conversation-plan";
import { signConversationReceipt, verifyConversationReceipt } from "@/server/ai/conversation-receipt";
import { compiledEvidenceToolCalls } from "@/server/ai/sales-chat-loop";

const runtimeContext = captureChatRuntimeContext(new Date("2026-10-15T00:00:00Z"));
const state: ConversationState = { tasks: ["regulations"], countryIso3s: ["JPN", "DEU"], applicationScope: "construction",
  powerKw: 150, asOf: "2026-09-01", productModelCode: null };
const memory: ConversationMemory = { sourceRequest: null, sourceRefinements: [], marketScope: null,
  responseLocale: "zh-CN", draftLength: "standard", outputKind: "evidence" };
function prior(context = state, workingMemory = memory) {
  const sessionId = crypto.randomUUID(), userText = "Previously confirmed context";
  const token = signConversationReceipt({ sessionId, selectedCountryIso3: null, state: context, memory: workingMemory, userText, answer: "Not evidence" });
  return verifyConversationReceipt(token, { sessionId, selectedCountryIso3: null, previousUserText: userText })!;
}
const common = { selectedCountryIso3: null, runtimeContext, locale: "en" as const };
const filtersOf = (value: ConversationState) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== "tasks"));

describe("grounded operands are separate from mentioned context and presentation", () => {
  it.each([
    ["先去掉日本，保留德国，其他条件照旧。", "remove", ["JPN"], ["DEU"]],
    ["Keep Germany; remove Japan.", "remove", ["JPN"], ["DEU"]],
    ["不动日本和德国，把法国加进来。", "add", ["FRA"], ["JPN", "DEU", "FRA"]],
    ["Include Brazil alongside Japan and Germany.", "add", ["BRA"], ["JPN", "DEU", "BRA"]],
  ] as const)("applies only selected grounded set operands: %s", (text, countryUpdate, operands, expected) => {
    const turn = prepareConversationPlan({ ...common, previous: prior(), userTexts: [text], plan: {
      mode: "research", state, countryUpdate, countryOperands: operands,
    } });
    expect(turn.state).toEqual({ ...state, countryIso3s: expected });
    expect(turn.contract.missingRequiredParameters).toEqual([]);
  });
  it("does not allow an invented operand or a non-member removal", () => {
    for (const [text, countryOperands] of [["Remove Japan", ["BRA"]], ["Remove Brazil", ["BRA"]]] as const)
      expect(() => prepareConversationPlan({ ...common, previous: prior(), userTexts: [text], plan: {
        mode: "research", state, countryUpdate: "remove", countryOperands,
      } })).toThrow();
  });
  it.each([
    ["那退回 2022 年再看，两个国家都保留，不要拿 2023 年的数据代替。", "退回 2022 年"],
    ["Use 2022, not 2023. Keep both countries.", "Use 2022"],
    ["不要2023年的数据，统计期换为2022年。", "统计期换为2022年"],
    ["Use 2022 instead of 2023", "Use 2022"],
  ])("normalizes the requested reporting operand, not the excluded old year: %s", (text, expression) => {
    expect(selectedMarketReportingPeriod(text, expression)).toEqual({ ambiguous: false,
      period: { start: "2022-01-01", end: "2023-01-01" } });
    const market: ConversationState = { ...state, tasks: ["market"], applicationScope: null, powerKw: null, asOf: null };
    const turn = prepareConversationPlan({ ...common, previous: prior(market, { ...memory,
      marketPeriod: { start: "2023-01-01", end: "2024-01-01" } }), userTexts: [text], plan: {
      mode: "research", state: market, marketPeriodUpdate: "replace", marketPeriodText: expression,
      marketPeriod: { start: "2022-01-01", end: "2023-01-01" }, countryUpdate: "retain", countryOperands: [],
    } });
    expect(compiledEvidenceToolCalls(turn.contract)[0]).toMatchObject({ tool: "compareMarkets",
      input: { countryIso3s: ["JPN", "DEU"], marketPeriod: { start: "2022-01-01", end: "2023-01-01" } } });
  });
  it.each([
    ["Compare Brazil and China for the reporting year 2023. Keep the observation period explicit.", "2023", "2023"],
    ["Compare Brazil and China for the reporting year 2023. Keep the observation period explicit.", "reporting year 2023", "2023"],
    ["Use 2022. Do not substitute 2023.", "2022", "2022"],
    ["Do not use 2023. Use 2022.", "Use 2022", "2022"],
    ["The report was published in 2024. Compare observations for 2022.", "2022", "2022"],
    ["Use 2022... Keep both markets.", "2022", "2022"],
    ["Use 2022 - keep both markets.", "2022", "2022"],
  ])("distinguishes sentence punctuation from identifier connectors: %s", (text, expression, year) => {
    expect(selectedMarketReportingPeriod(text, expression)).toEqual({ ambiguous: false,
      period: { start: `${year}-01-01`, end: `${Number(year) + 1}-01-01` } });
  });
  it.each([
    ["Use 2022, not 2023", "2023"], ["不要2023，改为2022", "2023"],
    ["Use 2022 instead of 2023", "2023"], ["data published in 2023", "2023"],
    ["2023年发布的报告", "2023年"], ["document ISO-2023", "2023"],
    ["as of 2023-01-01", "2023"], ["2022 or 2023", "2022"],
    ["2022 through 2024", "2022"], ['document "2023"', "2023"],
    ["document ISO.2023", "2023"], ["document 2023.rev1", "2023"],
    ["document ISO/2023", "2023"], ["document 2023/24", "2023"],
    ["value 2023.5", "2023"], ["document _2023", "2023"],
    ["Do not use 2023. Use 2022.", "2023"],
    ["The report was published in 2024. Compare observations for 2022.", "2024"],
    ["BRA market data", "2023"],
  ])("rejects an ungrounded or wrongly selected period: %s / %s", (text, expression) => {
    expect(selectedMarketReportingPeriod(text, expression).period).toBeUndefined();
  });
  it.each([
    "改为英文回答，其他条件和来源查询不变，再核对 CLIENT-200。",
    "Also check model CLIENT-200; keep the source query and answer in English.",
  ])("composes task-specific requests independently of language: %s", text => {
    const source = "DEU EU 2016/1628 排放测试循环原文";
    const sourceState: ConversationState = { ...state, tasks: ["knowledge"], countryIso3s: ["DEU"] };
    const previous = prior(sourceState, { ...memory, sourceRequest: source, sourceText: "EU 2016/1628 排放测试循环" });
    const turn = prepareConversationRequest({ ...common, previous, userTexts: [text], plan: {
      operation: "research", state: filtersOf(sourceState), filterResets: [], requests: [{ task: "knowledge", sourceUpdate: "retain", sourceTerms: [] }, { task: "product_fit" }],
      presentation: { locale: "en", length: "keep" }, countryUpdate: "retain", countryOperands: [],
    } });
    expect(turn.state.tasks).toEqual(["knowledge", "product_fit"]);
    expect(turn.state.productModelCode).toBe("CLIENT-200");
    expect(turn.memory.responseLocale).toBe("en");
    expect(turn.memory.sourceText).toBe(previous.memory!.sourceText);
    expect(compiledEvidenceToolCalls(turn.contract).map(call => call.tool)).toEqual(["searchKnowledgeBase", "findCompatibleProducts"]);
    const removed = prepareConversationRequest({ ...common, previous: prior(turn.state, turn.memory),
      userTexts: ["取消产品核对，只保留来源查询"], plan: { operation: "research", state: filtersOf(turn.state), countryOperands: [], filterResets: [],
        requests: [{ task: "knowledge", sourceUpdate: "retain", sourceTerms: [] }] } });
    expect(compiledEvidenceToolCalls(removed.contract).map(call => call.tool)).toEqual(["searchKnowledgeBase"]);
  });
  it("cannot configure a source/market task independently of membership, or duplicate a task", () => {
    for (const extra of [{ sourceUpdate: "replace" }, { marketPeriodUpdate: "replace" },
      { state }, { requests: [{ task: "regulations" }, { task: "regulations" }] },
      { requests: [{ task: "regulations", sourceTerms: ["EU 2016/1628"] }] }]) {
      expect(conversationPlannerSchema.safeParse({ operation: "research", state: filtersOf(state), countryOperands: [], filterResets: [],
        requests: [{ task: "regulations" }], ...extra }).success).toBe(false);
    }
  });
  it("keeps document/topic projection separate from metadata, presentation and locator delivery", () => {
    const text = "明确只查 DEU 的原文来源：EU 2016/1628 的排放测试循环，工程机械 150 kW，截至 2026-09-01。能找到页码或章节就列出，找不到请直说。";
    const turn = prepareConversationRequest({ ...common, previous: prior(), userTexts: [text], plan: {
      operation: "research", state: filtersOf({ ...state, countryIso3s: ["DEU"] }), countryOperands: [], filterResets: [],
      requests: [{ task: "knowledge", sourceUpdate: "replace", sourceTerms: ["EU 2016/1628", "排放测试循环"] }],
    } });
    expect(turn.contract.requirements[0]?.query).toMatchObject({ countryIso3s: ["DEU"], applicationScope: "construction",
      asOf: "2026-09-01", knowledgeQuery: "EU 2016/1628 排放测试循环", knowledgeDelivery: { pageLocator: true, sectionLocator: true } });
    expect(turn.memory.sourceRequest).toBe(text);
    expect(turn.memory.sourceText).toBe("EU 2016/1628 排放测试循环");
    const refinement = prepareConversationPlan({ ...common, previous: prior(turn.state, turn.memory),
      userTexts: ["把页码范围再限定在第 4 页，原来的测试循环主题不要变；找不到就保留缺口。"],
      plan: { mode: "research", state: turn.state, sourceUpdate: "refine" } });
    expect(refinement.contract.requirements[0]?.query.knowledgeQuery).toBe("EU 2016/1628 排放测试循环 page 4");
    expect(refinement.contract.requirements[0]?.query.knowledgeDelivery).toMatchObject({ pageLocator: true, sectionLocator: true, pages: ["4"] });
  });
  it("an empty lookup selection in materials mode preserves signed research and period", () => {
    const context: ConversationState = { ...state, tasks: ["market"], countryIso3s: ["BRA"], applicationScope: null, powerKw: null };
    const period = { start: "2022-01-01", end: "2023-01-01" };
    const turn = prepareConversationRequest({ ...common, previous: prior(context, { ...memory, marketPeriod: period }),
      userTexts: ["先不下市场结论，给我一份核验资料清单，保留统计期。"], plan: {
        operation: "prepare_checklist", requests: [], state: filtersOf(context), countryOperands: [], filterResets: [],
      } });
    expect(turn.state.tasks).toEqual(["market"]);
    expect(turn.memory.marketPeriod).toEqual(period);
    expect(turn.outputKind).toBe("request_checklist");
  });
  it.each([
    ["先清除功率条件，国家、用途和日期不动；不要默认继续用 120 kW。", "清除功率条件", "power"],
    ["先清除功率条件，国家、用途和日期不动；不要默认继续用 120 kW。", "先清除功率条件", "power"],
    ["For now clear the power filter; do not reuse 150 kW.", "clear the power filter", "power"],
    ["For now clear the power filter; do not reuse 150 kW.", "For now clear the power filter", "power"],
    ["先清除用途条件，暂时不用 construction。", "清除用途条件", "scope"],
  ] as const)("applies a selected reset without treating declined old values as replacements: %s", (text, expression, field) => {
    const turn = prepareConversationPlan({ ...common, previous: prior(), userTexts: [text], plan: {
      mode: "research", state, filterResets: [{ field, expression }],
    } });
    expect(turn.state[field === "power" ? "powerKw" : "applicationScope"]).toBeNull();
    expect(turn.contract.missingRequiredParameters).toContain(field === "power" ? "powerKw" : "applicationScope");
  });
  it.each(["Do not clear power", 'The source says "clear power"', "Keep power", "unclear power"])("rejects quoted/negated/unmentioned reset operands: %s", text => {
    expect(() => prepareConversationPlan({ ...common, previous: prior(), userTexts: [text], plan: {
      mode: "research", state, filterResets: [{ field: "power", expression: "clear power" }],
    } })).toThrow("Ungrounded filter reset");
  });
  it.each(["Do not clear power", "不要清除功率条件"])("a selected expression cannot swallow its own negation: %s", text => {
    expect(() => prepareConversationPlan({ ...common, previous: prior(), userTexts: [text], plan: {
      mode: "research", state, filterResets: [{ field: "power", expression: text }],
    } })).toThrow("Ungrounded filter reset");
  });
  it("does not let retired historical research veto a new general concept", () => {
    const turn = prepareConversationPlan({ ...common, previous: prior(),
      userTexts: ["暂停这些国家的具体查询。先用通俗中文解释 NOx 是什么，不要给任何国家或产品作合规结论。"],
      plan: { mode: "general", state: { ...state, tasks: [] } } });
    expect(turn.generalConversation).toBe(true);
    expect(turn.contract.requirements).toEqual([]);
  });
});
