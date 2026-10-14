import { describe, expect, it } from "vitest";
import { explicitMarketReportingPeriod, marketReportingPeriodSchema, observationInReportingPeriod } from "@/domain/marketing/reporting-period";
import { prepareConversationPlan } from "@/server/ai/conversation-plan";
import { compiledEvidenceToolCalls } from "@/server/ai/sales-chat-loop";
import { captureChatRuntimeContext } from "@/domain/ai/chat-runtime-context";
import { signConversationReceipt, verifyConversationReceipt } from "@/server/ai/conversation-receipt";
import type { ConversationState } from "@/features/ai/conversation-state";

const runtimeContext = captureChatRuntimeContext(new Date("2026-10-14T00:00:00Z"));
const period = { start: "2023-01-01", end: "2024-01-01" };
const state: ConversationState = { tasks: ["market"], countryIso3s: ["BRA"], asOf: null,
  applicationScope: null, powerKw: null, productModelCode: null };
describe("reporting-period semantics independent of regulatory asOf", () => {
  it.each(["巴西2023年的市场数据", "BRA market data for 2023", "Instead use 2023"])("normalizes an explicit calendar year: %s", text => {
    expect(explicitMarketReportingPeriod(text)).toEqual({ period, ambiguous: false });
  });
  it.each(["EU 2016/1628", "as of 2023-12-31", "型号M2023", "2000 kW", 'document "2023"'])("does not reinterpret a date, identifier or quantity: %s", text => {
    expect(explicitMarketReportingPeriod(text)).toEqual({ ambiguous: false });
  });
  it.each(["2022 or 2023", "2023年发布的报告", "data published in 2023"])("does not silently choose an ambiguous or publication year: %s", text => {
    expect(explicitMarketReportingPeriod(text)).toEqual({ ambiguous: true });
  });
  it("normalizes a year range and applies half-open containment, not overlap or latest-year substitution", () => {
    expect(explicitMarketReportingPeriod("2022至2024年").period).toEqual({ start: "2022-01-01", end: "2025-01-01" });
    expect(marketReportingPeriodSchema.safeParse({ start: period.end, end: period.start }).success).toBe(false);
    for (const [periodStart, periodEnd, expected] of [
      ["2023-01-01", "2024-01-01", true], ["2023-04-01", "2023-07-01", true],
      ["2022-01-01", "2023-01-01", false], ["2024-01-01", "2025-01-01", false],
      ["2022-01-01", "2024-01-01", false],
    ] as const) expect(observationInReportingPeriod({ periodStart, periodEnd }, period)).toBe(expected);
  });
  it("preserves reporting period across added countries and does not send a fictional asOf to comparisons", () => {
    const first = prepareConversationPlan({ plan: { mode: "research", state: { ...state, asOf: "2023-12-31" }, marketPeriod: period },
      previous: null, userTexts: ["只看巴西2023年的市场数据"], selectedCountryIso3: null, runtimeContext });
    expect(first.state.asOf).toBeNull();
    expect(first.memory.marketPeriod).toEqual(period);
    expect(compiledEvidenceToolCalls(first.contract)[0]?.input).toMatchObject({ marketPeriod: period, topics: ["market"] });
    const sessionId = "00000000-0000-4000-8000-000000000001";
    const token = signConversationReceipt({ sessionId, selectedCountryIso3: null, userText: "previous", answer: "not evidence",
      state: first.state, memory: first.memory });
    const previous = verifyConversationReceipt(token, { sessionId, selectedCountryIso3: null, previousUserText: "previous" });
    const next = prepareConversationPlan({ plan: { mode: "research", state: { ...first.state, countryIso3s: ["BRA", "CHN"] } },
      previous, userTexts: ["把中国也加进来比较，报告期不变"], selectedCountryIso3: null, runtimeContext });
    expect(compiledEvidenceToolCalls(next.contract)[0]).toMatchObject({ tool: "compareMarkets", input: { marketPeriod: period, countryIso3s: ["BRA", "CHN"] } });
    expect(compiledEvidenceToolCalls(next.contract)[0]?.input).not.toHaveProperty("asOf");
    const explanation = prepareConversationPlan({ plan: { mode: "explain", state: first.state, marketPeriodUpdate: "retain" },
      previous, userTexts: ["为什么原来还展示了2022年的基期？"], selectedCountryIso3: null, runtimeContext });
    expect(explanation.memory.marketPeriod).toEqual(period);
    expect(explanation.contract.missingRequiredParameters).toEqual([]);
    const latest = prepareConversationPlan({ plan: { mode: "research", state: first.state, marketPeriod: null },
      previous, userTexts: ["只看巴西最新市场数据，不限年份"], selectedCountryIso3: null, runtimeContext });
    expect(latest.memory.marketPeriod).toBeUndefined();
    expect(compiledEvidenceToolCalls(latest.contract)[0]?.input).not.toHaveProperty("marketPeriod");
  });
  it("rejects a fabricated reporting period rather than loosening date grounding", () => {
    expect(() => prepareConversationPlan({ plan: { mode: "research", state, marketPeriod: period },
      previous: null, userTexts: ["BRA market data"], selectedCountryIso3: null, runtimeContext })).toThrow("Ungrounded market reporting period");
  });
});
