import { describe, expect, it } from "vitest";

import {
  salesChatLiveCases,
  type SalesChatLiveCase,
} from "../evals/sales-chat-live-cases";
import {
  aiToolResultSchema,
  type AiToolResult,
} from "@/features/ai/schemas";
import {
  buildSalesChatEvidenceContract,
  evidenceContractAllowsModelText,
  remainingEvidenceTools,
} from "@/server/ai/evidence-contract";
import { buildSalesChatInstructions } from "@/server/ai/sales-chat-prompt";
import { currentUtcDate } from "@/server/ai/tool-results";

const regressionCaseIds = [
  "country-overview-china",
  "single-country-market-profile",
  "product-ready-dual-axis",
  "product-outside-supply-period",
  "source-document-retrieval",
  "multi-turn-country-conflict",
  "unknown-product-fails-closed",
] as const;

function liveCase(id: (typeof regressionCaseIds)[number]): SalesChatLiveCase {
  const testCase = salesChatLiveCases.find((candidate) => candidate.id === id);
  if (!testCase) {
    throw new Error(`Missing live-eval regression case: ${id}`);
  }
  return testCase;
}

function commonResult(informationAsOf: string) {
  return {
    citations: [],
    evidenceSufficient: true,
    informationAsOf,
    latestVerifiedAt: null,
    status: "ok" as const,
    warnings: [],
  };
}

function countryProfileEvidence(input: {
  asOf: string;
  topic: "country" | "market";
}): AiToolResult {
  return aiToolResultSchema.parse({
    ...commonResult(input.asOf),
    profile: null,
    requestedTopics: [input.topic],
    resolvedCountryIso3: "CHN",
    tool: "getCountryProfile",
  });
}

function compatibleProductEvidence(asOf: string): AiToolResult {
  return aiToolResultSchema.parse({
    ...commonResult(asOf),
    evaluations: [],
    query: {
      applicationScope: "non-road",
      asOf,
      countryIso3: "CHN",
      powerKw: 100,
      productModelCode: "DEMO-ENG-100",
    },
    tool: "findCompatibleProducts",
  });
}

function unknownProductEvidence(): AiToolResult {
  return aiToolResultSchema.parse({
    ...commonResult("2026-08-13"),
    evidenceSufficient: false,
    evaluations: [],
    query: {
      applicationScope: "non-road",
      asOf: "2026-08-13",
      countryIso3: "CHN",
      powerKw: 100,
      productModelCode: "DOES-NOT-EXIST",
    },
    status: "no_data",
    tool: "findCompatibleProducts",
  });
}

function regulationEvidence(): AiToolResult {
  return aiToolResultSchema.parse({
    ...commonResult("2026-08-13"),
    comparison: {
      countries: [],
      missingData: [],
      query: {
        applicationScope: "non-road",
        asOf: "2026-08-13",
        countryIso3s: ["BRA"],
        powerKw: 100,
      },
      sources: [],
    },
    tool: "compareRegulations",
  });
}

function knowledgeEvidence(input: {
  applicationScope: "non-road" | null;
  query: string;
}): AiToolResult {
  const asOf = currentUtcDate();
  return aiToolResultSchema.parse({
    ...commonResult(asOf),
    resolvedCountryIso3: "CHN",
    search: {
      embeddingModel: "local-hash-embedding-v1",
      filters: {
        applicationScope: input.applicationScope,
        asOf,
        countryIso3: "CHN",
        jurisdictionId: null,
        limit: 8,
      },
      query: input.query,
      results: [],
      scoring: { keywordWeight: 0.5, vectorWeight: 0.5 },
      status: "ok",
    },
    tool: "searchKnowledgeBase",
  });
}

const evidenceByCaseId: Record<
  (typeof regressionCaseIds)[number],
  () => AiToolResult
> = {
  "country-overview-china": () =>
    countryProfileEvidence({ asOf: "2026-08-13", topic: "country" }),
  "single-country-market-profile": () =>
    countryProfileEvidence({ asOf: currentUtcDate(), topic: "market" }),
  "product-ready-dual-axis": () =>
    compatibleProductEvidence("2026-08-13"),
  "product-outside-supply-period": () =>
    compatibleProductEvidence("2031-01-01"),
  "source-document-retrieval": () =>
    knowledgeEvidence({
      applicationScope: "non-road",
      query: "CHN 非道路排放法规原文章节来源证据",
    }),
  "multi-turn-country-conflict": regulationEvidence,
  "unknown-product-fails-closed": unknownProductEvidence,
};

describe("live-eval evidence-contract regressions", () => {
  it.each(regressionCaseIds)(
    "%s selects exactly the declared evidence tool and accepts matching evidence",
    (id) => {
      const testCase = liveCase(id);
      const contract = buildSalesChatEvidenceContract({
        selectedCountryIso3: testCase.selectedCountryIso3,
        userTexts: testCase.userTexts,
      });
      const result = evidenceByCaseId[id]();

      expect(testCase.expectedEvidenceAllowed).toBe(
        id !== "unknown-product-fails-closed",
      );
      expect(contract.missingRequiredParameters).toEqual([]);
      expect(remainingEvidenceTools(contract, [])).toEqual(
        testCase.expectedTools,
      );
      expect(evidenceContractAllowsModelText(contract, [result])).toBe(
        testCase.expectedEvidenceAllowed,
      );
      expect(remainingEvidenceTools(contract, [result])).toEqual(
        id === "unknown-product-fails-closed"
          ? ["findCompatibleProducts"]
          : [],
      );
    },
  );

  it("keeps an explicit profile date fail-closed until the tool echoes it", () => {
    const testCase = liveCase("country-overview-china");
    const contract = buildSalesChatEvidenceContract({
      selectedCountryIso3: testCase.selectedCountryIso3,
      userTexts: testCase.userTexts,
    });

    expect(testCase.expectedArgs.getCountryProfile).toMatchObject({
      asOf: "2026-08-13",
    });
    expect(
      evidenceContractAllowsModelText(contract, [
        countryProfileEvidence({ asOf: "2026-08-14", topic: "country" }),
      ]),
    ).toBe(false);
    expect(buildSalesChatInstructions(null)).toContain(
      "用户明确给出 asOf 时，必须把该日期原样传给每个支持 asOf 的工具",
    );
  });

  it.each([
    {
      expected: true,
      id: "source-document-retrieval" as const,
      query: "CHN 非道路排放法规原文章节来源证据",
    },
    {
      expected: false,
      id: "irrelevant-source-query-fails-closed" as const,
      query: "CHN 非道路排放法规原文章节来源证据",
    },
    {
      expected: false,
      id: "retrieved-prompt-injection-is-data" as const,
      query: "CHN 非道路排放法规原文章节来源证据",
    },
  ])("$id preserves its evidence boundary even when retrieval returns a hit", ({
    expected,
    id,
    query,
  }) => {
    const testCase = salesChatLiveCases.find((candidate) => candidate.id === id);
    if (!testCase) {
      throw new Error(`Missing live-eval source case: ${id}`);
    }
    const contract = buildSalesChatEvidenceContract({
      selectedCountryIso3: testCase.selectedCountryIso3,
      userTexts: testCase.userTexts,
    });
    const result = knowledgeEvidence({
      applicationScope: id === "irrelevant-source-query-fails-closed"
        ? null
        : "non-road",
      query,
    });

    expect(testCase.expectedEvidenceAllowed).toBe(expected);
    expect(evidenceContractAllowsModelText(contract, [result])).toBe(expected);
  });

  it("accepts a meaningful bilingual source query without accepting unrelated terms", () => {
    const testCase = liveCase("source-document-retrieval");
    const contract = buildSalesChatEvidenceContract({
      selectedCountryIso3: testCase.selectedCountryIso3,
      userTexts: testCase.userTexts,
    });

    expect(
      evidenceContractAllowsModelText(contract, [
        knowledgeEvidence({
          applicationScope: "non-road",
          query: "non-road emissions regulation original text section source evidence",
        }),
      ]),
    ).toBe(true);
    expect(
      evidenceContractAllowsModelText(contract, [
        knowledgeEvidence({
          applicationScope: "non-road",
          query: "ZZZ_QUANTUM_BANANA_98765",
        }),
      ]),
    ).toBe(false);
  });
});
