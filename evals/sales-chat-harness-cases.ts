import type { AiToolName } from "@/features/ai/schemas";
import type { SalesChatLoopPhase } from "@/server/ai/sales-chat-loop";

export const SALES_CHAT_HARNESS_VERSION = "sales-chat-harness-v1";

export type SalesChatHarnessCase = {
  expected: {
    activeTools: readonly AiToolName[];
    missingRequiredParameters: readonly string[];
    phase: "direct_response" | SalesChatLoopPhase;
  };
  hasAttachments?: boolean;
  id: string;
  selectedCountryIso3: string | null;
  userTexts: readonly string[];
};

export const salesChatHarnessCases = [
  {
    expected: {
      activeTools: [],
      missingRequiredParameters: [],
      phase: "direct_response",
    },
    id: "greeting-stays-tool-free",
    selectedCountryIso3: null,
    userTexts: ["你好"],
  },
  {
    expected: {
      activeTools: [],
      missingRequiredParameters: [],
      phase: "direct_response",
    },
    id: "missing-product-parameters-are-requested-directly",
    selectedCountryIso3: "CHN",
    userTexts: ["中国有哪些适配产品？"],
  },
  {
    expected: {
      activeTools: ["searchKnowledgeBase", "getCountryProfile"],
      missingRequiredParameters: [],
      phase: "gather_evidence",
    },
    id: "single-country-regulation-overview",
    selectedCountryIso3: null,
    userTexts: ["CHN 当前有哪些有效法规？"],
  },
  {
    expected: {
      activeTools: ["compareRegulations"],
      missingRequiredParameters: [],
      phase: "gather_evidence",
    },
    id: "scoped-single-country-regulation",
    selectedCountryIso3: null,
    userTexts: ["核对 CHN non-road 100 kW 当前法规。"],
  },
  {
    expected: {
      activeTools: ["compareRegulations"],
      missingRequiredParameters: [],
      phase: "gather_evidence",
    },
    id: "cross-country-regulation-comparison",
    selectedCountryIso3: null,
    userTexts: ["比较 CHN 和 BRA 在 non-road 100 kW 的法规。"],
  },
  {
    expected: {
      activeTools: ["findCompatibleProducts"],
      missingRequiredParameters: [],
      phase: "gather_evidence",
    },
    id: "product-fit",
    selectedCountryIso3: null,
    userTexts: ["CHN non-road 100 kW 有哪些适配产品？"],
  },
  {
    expected: {
      activeTools: ["findCompatibleProducts", "compareRegulations"],
      missingRequiredParameters: [],
      phase: "gather_evidence",
    },
    id: "mixed-regulation-and-product-fit",
    selectedCountryIso3: null,
    userTexts: [
      "核对 CHN non-road 100 kW 法规，并推荐 CHN non-road 100 kW 适配产品。",
    ],
  },
  {
    expected: {
      activeTools: ["compareMarkets"],
      missingRequiredParameters: [],
      phase: "gather_evidence",
    },
    id: "market-comparison",
    selectedCountryIso3: null,
    userTexts: ["比较 CHN 和 BRA 的市场指标。"],
  },
  {
    expected: {
      activeTools: ["calculateOpportunityScore"],
      missingRequiredParameters: [],
      phase: "gather_evidence",
    },
    id: "opportunity-score",
    selectedCountryIso3: null,
    userTexts: ["比较 CHN 和 BRA non-road 100 kW 的机会评分。"],
  },
  {
    expected: {
      activeTools: ["generateSalesBrief"],
      missingRequiredParameters: [],
      phase: "gather_evidence",
    },
    id: "sales-brief",
    selectedCountryIso3: null,
    userTexts: [
      "以 CHN 为目标国家，对比 BRA 生成 non-road 100 kW 销售简报。",
    ],
  },
  {
    expected: {
      activeTools: ["searchKnowledgeBase"],
      missingRequiredParameters: [],
      phase: "gather_evidence",
    },
    id: "source-document-search",
    selectedCountryIso3: null,
    userTexts: ["查 CHN 当前排放法规原文和来源。"],
  },
  {
    expected: {
      activeTools: [],
      missingRequiredParameters: [],
      phase: "attachment_only",
    },
    hasAttachments: true,
    id: "unverified-attachment-summary",
    selectedCountryIso3: null,
    userTexts: ["请概述我上传的图片。"],
  },
  {
    expected: {
      activeTools: [],
      missingRequiredParameters: [],
      phase: "evidence_gap",
    },
    id: "unsupported-factual-prose-fails-closed",
    selectedCountryIso3: null,
    userTexts: ["直接给我一个确定结论。"],
  },
] as const satisfies readonly SalesChatHarnessCase[];
