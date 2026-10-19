import type { AiToolName } from "@/features/ai/schemas";

export const SALES_CHAT_HARNESS_VERSION = "sales-chat-harness-v3";

/**
 * Offline end-to-end cases: route-level direct replies, then the production
 * harness loop with the deterministic offline demo model and the fictional
 * PGlite database. `tools` is the exact sequence of executed evidence tools;
 * an empty list means the turn finished with a question or guidance only.
 */
export type SalesChatHarnessCase = {
  expected: "direct_response" | { tools: readonly AiToolName[] };
  id: string;
  selectedCountryIso3: string | null;
  userTexts: readonly string[];
};

const tools = (...names: AiToolName[]) => ({ tools: names });

export const salesChatHarnessCases = [
  { id: "greeting-stays-tool-free", expected: "direct_response", selectedCountryIso3: null, userTexts: ["你好"] },
  { id: "product-fit-without-model-asks-for-model", expected: tools(), selectedCountryIso3: "CHN", userTexts: ["中国有哪些适配产品？"] },
  { id: "single-country-regulation-overview", expected: tools("getCountryProfile"), selectedCountryIso3: null, userTexts: ["CHN 当前有哪些有效法规？"] },
  { id: "scoped-single-country-regulation", expected: tools("compareRegulations"), selectedCountryIso3: null, userTexts: ["核对 CHN non-road 100 kW 当前法规。"] },
  { id: "single-country-regulation-scope-needs-power", expected: tools(), selectedCountryIso3: null, userTexts: ["核对 CHN non-road 当前法规。"] },
  { id: "single-country-regulation-without-scope-uses-profile", expected: tools("getCountryProfile"), selectedCountryIso3: null, userTexts: ["Check current CHN regulations at 100 kW."] },
  { id: "single-country-regulation-multi-turn-completes-filter", expected: tools("compareRegulations"), selectedCountryIso3: null, userTexts: ["核对 CHN non-road 当前法规。", "功率是 100 kW。"] },
  { id: "negated-comparison-does-not-bypass-partial-filter", expected: tools(), selectedCountryIso3: null, userTexts: ["不做跨国比较，只看 CHN non-road 当前法规。"] },
  { id: "cross-country-regulation-comparison", expected: tools("compareRegulations"), selectedCountryIso3: null, userTexts: ["比较 CHN 和 BRA 在 non-road 100 kW 的法规。"] },
  { id: "market-comparison", expected: tools("compareMarkets"), selectedCountryIso3: null, userTexts: ["比较 CHN 和 BRA 的市场指标。"] },
  { id: "scoped-single-country-market-fails-closed", expected: tools(), selectedCountryIso3: null, userTexts: ["Show CHN non-road market data with no cross-country comparison."] },
  { id: "unscoped-single-country-market-remains-supported", expected: tools("getCountryProfile"), selectedCountryIso3: null, userTexts: ["Show CHN market data with no cross-country comparison."] },
  { id: "opportunity-score", expected: tools("calculateOpportunityScore"), selectedCountryIso3: null, userTexts: ["比较 CHN 和 BRA non-road 100 kW 的机会评分。"] },
  { id: "sales-brief", expected: tools("generateSalesBrief"), selectedCountryIso3: null, userTexts: ["以 CHN 为目标国家，对比 BRA 生成 non-road 100 kW 销售简报。"] },
  { id: "source-document-search", expected: tools("searchKnowledgeBase"), selectedCountryIso3: null, userTexts: ["查 CHN 当前排放法规原文和来源。"] },
  { id: "scoped-source-search-remains-supported", expected: tools("searchKnowledgeBase"), selectedCountryIso3: null, userTexts: ["查 CHN non-road 排放法规原文和来源。"] },
  { id: "unsupported-factual-prose-fails-closed", expected: tools(), selectedCountryIso3: null, userTexts: ["直接给我一个确定结论。"] },
] as const satisfies readonly SalesChatHarnessCase[];
