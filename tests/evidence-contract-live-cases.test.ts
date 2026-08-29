import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  salesChatLiveCases,
  type SalesChatLiveCase,
} from "../evals/sales-chat-live-cases";
import {
  aiToolResultSchema,
  findCompatibleProductsInputSchema,
  findCompatibleProductsResultSchema,
  type AiToolResult,
} from "@/features/ai/schemas";
import {
  buildSalesChatEvidenceContract,
  evidenceContractAllowsModelText,
  remainingEvidenceTools,
} from "@/server/ai/evidence-contract";
import { createSalesChatTools } from "@/server/ai/sales-chat";
import { buildSalesChatInstructions } from "@/server/ai/sales-chat-prompt";
import { currentUtcDate } from "@/server/ai/tool-results";
import { getDemoDatabase } from "@/server/db/demo-client";
import { createProductRepository } from "@/server/repositories/product-repository";
import { evaluateProductFit } from "@/server/services/product-fit-service";

const originalDatabaseMode = process.env.DATABASE_MODE;
let demoDatabase: Awaited<ReturnType<typeof getDemoDatabase>>;

beforeAll(async () => {
  process.env.DATABASE_MODE = "pglite-demo";
  demoDatabase = await getDemoDatabase();
}, 15_000);

afterAll(() => {
  if (originalDatabaseMode === undefined) {
    delete process.env.DATABASE_MODE;
  } else {
    process.env.DATABASE_MODE = originalDatabaseMode;
  }
});

const regressionCaseIds = [
  "country-overview-china",
  "single-country-market-profile",
  "product-ready-dual-axis",
  "source-document-retrieval",
  "multi-turn-country-conflict",
  "unknown-product-fails-closed",
] as const;

type RegressionCaseId =
  | (typeof regressionCaseIds)[number]
  | "product-outside-supply-period";

function liveCase(id: RegressionCaseId): SalesChatLiveCase {
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
  "source-document-retrieval": () =>
    knowledgeEvidence({
      applicationScope: "non-road",
      query: "CHN 非道路排放法规原文章节来源证据",
    }),
  "multi-turn-country-conflict": regulationEvidence,
  "unknown-product-fails-closed": unknownProductEvidence,
};

describe("live-eval evidence-contract regressions", () => {
  it("allows a sourced not_ready explanation for a product outside its supply period", async () => {
    const testCase = liveCase("product-outside-supply-period");
    const query = findCompatibleProductsInputSchema.parse(
      testCase.expectedArgs.findCompatibleProducts,
    );
    if (!query.countryIso3 || !query.productModelCode) {
      throw new Error(
        "The outside-supply-period regression requires an explicit country and product.",
      );
    }

    const repository = createProductRepository(demoDatabase);
    const repositoryEvidence = await repository.findFitEvidence(query);
    expect(repositoryEvidence.product).toMatchObject({
      availableFrom: "2025-01-01",
      availableTo: "2030-01-01",
      modelCode: "DEMO-ENG-100",
    });
    expect(repositoryEvidence.applicableRegulations.length).toBeGreaterThan(0);
    expect(repositoryEvidence.certifications.length).toBeGreaterThan(0);

    const serviceEvaluation = await evaluateProductFit(query);
    expect(serviceEvaluation).toMatchObject({
      commercialReadiness: "not_ready",
      input: query,
      productChecks: {
        availability: {
          code: "PRODUCT_NO_LONGER_AVAILABLE",
          status: "fail",
        },
      },
      status: "fit",
    });

    const auditStatuses: string[] = [];
    const tools = createSalesChatTools({
      auditRepository: {
        recordToolCall: async ({ status }) => {
          auditStatuses.push(status);
        },
      },
      selectedCountryIso3: null,
      sessionId: "00000000-0000-4000-8000-000000000929",
    });
    if (!tools.findCompatibleProducts.execute) {
      throw new Error("Expected findCompatibleProducts to be executable.");
    }
    const toolResult = findCompatibleProductsResultSchema.parse(
      await tools.findCompatibleProducts.execute(query, {
        context: undefined as never,
        messages: [],
        toolCallId: "outside-supply-period",
      }),
    );

    expect(toolResult).toMatchObject({
      evidenceSufficient: true,
      status: "ok",
    });
    expect(toolResult.citations.length).toBeGreaterThan(0);
    expect(toolResult.evaluations).toEqual([serviceEvaluation]);
    expect(toolResult.evaluations[0]?.sources.length).toBeGreaterThan(0);
    expect(auditStatuses).toEqual(["success"]);

    const contract = buildSalesChatEvidenceContract({
      selectedCountryIso3: testCase.selectedCountryIso3,
      userTexts: testCase.userTexts,
    });
    expect(testCase.expectedEvidenceAllowed).toBe(true);
    expect(evidenceContractAllowsModelText(contract, [toolResult])).toBe(true);
    expect(remainingEvidenceTools(contract, [toolResult])).toEqual([]);
  });

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
