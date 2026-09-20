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
import { clientAiToolResultSchema } from "@/features/ai/client-schemas";
import {
  buildSalesChatEvidenceContract,
  evidenceContractAllowsModelText,
  remainingEvidenceTools,
} from "@/server/ai/evidence-contract";
import { createSalesChatTools } from "@/server/ai/sales-chat";
import { buildSalesChatInstructions } from "@/server/ai/sales-chat-prompt";
import {
  buildCompatibleProductsResult,
  buildCountryProfileResult,
  buildKnowledgeResult,
  buildMarketComparisonResult,
  buildOpportunityScoreResult,
  buildRegulationComparisonResult,
  buildSalesBriefResult,
  buildToolErrorResult,
  currentUtcDate,
} from "@/server/ai/tool-results";
import { getDemoDatabase } from "@/server/db/demo-client";
import { createProductRepository } from "@/server/repositories/product-repository";
import { evaluateProductFit } from "@/server/services/product-fit-service";
import { getCountryDetails } from "@/server/services/country-service";
import {
  calculateOpportunityScore,
  compareMarkets,
  compareRegulations,
  generateSalesBrief,
} from "@/server/services/marketing-analysis-service";
import { hybridSearchResponseSchema } from "@/features/knowledge/schemas";
import {
  latestVerifiedAtFromCitations,
  latestVerifiedAtMatchesCitations,
  marketComparisonSourcesMatchFacts,
} from "@/features/ai/evidence-semantics";

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
  "comparable-market-metric",
  "opportunity-score",
  "sales-brief",
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

const regressionCitation = {
  chunkId: null,
  countryIso3: "CHN",
  documentId: null,
  documentTitle: null,
  isDemo: true,
  locator: null,
  pageFrom: null,
  pageTo: null,
  productCertificationId: null,
  publishedOn: "2026-01-01",
  regulationId: null,
  regulationStatus: null,
  sectionLocator: null,
  sourceId: "00000000-0000-4000-8000-000000000001",
  sourceTitle: "DEMO ONLY — evidence-contract fixture",
  sourceUrl: null,
  title: "DEMO ONLY — evidence-contract fixture",
  verifiedAt: "2026-01-02T00:00:00.000Z",
} as const;

async function countryProfileEvidence(input: {
  asOf: string;
  topic: "country" | "market" | "regulations";
}): Promise<AiToolResult> {
  return buildCountryProfileResult({
    informationAsOf: input.asOf,
    profile: await getCountryDetails({ asOf: input.asOf, iso3: "CHN" }),
    requestedTopics: [input.topic],
    resolvedCountryIso3: "CHN",
  });
}

async function compatibleProductEvidence(asOf: string): Promise<AiToolResult> {
  const query = {
    applicationScope: "non-road" as const,
    asOf,
    countryIso3: "CHN",
    powerKw: 100,
    productModelCode: "DEMO-ENG-100",
  };
  return buildCompatibleProductsResult({
    applicationScope: query.applicationScope,
    asOf,
    countryIso3: query.countryIso3,
    evaluations: [await evaluateProductFit(query)],
    powerKw: query.powerKw,
    productModelCode: query.productModelCode,
  });
}

async function unknownProductEvidence(): Promise<AiToolResult> {
  const query = {
    applicationScope: "non-road" as const,
    asOf: "2026-08-13",
    countryIso3: "CHN",
    powerKw: 100,
    productModelCode: "DOES-NOT-EXIST",
  };
  return buildCompatibleProductsResult({
    applicationScope: query.applicationScope,
    asOf: query.asOf,
    countryIso3: query.countryIso3,
    evaluations: [await evaluateProductFit(query)],
    powerKw: query.powerKw,
    productModelCode: query.productModelCode,
  });
}

async function regulationEvidence(
  countryIso3: "BRA" | "CHN" = "BRA",
): Promise<AiToolResult> {
  const comparison = await compareRegulations({
    applicationScope: "non-road",
    asOf: "2026-08-13",
    countryIso3s: [countryIso3],
    powerKw: 100,
  });
  return buildRegulationComparisonResult({
    comparison,
    informationAsOf: "2026-08-13",
  });
}

async function marketEvidence(): Promise<AiToolResult> {
  return buildMarketComparisonResult({
    comparison: await compareMarkets({
      countryIso3s: ["CHN", "BRA"],
      metricCodes: ["DEMO_ADDRESSABLE_UNITS"],
    }),
    informationAsOf: currentUtcDate(),
  });
}

async function opportunityEvidence(
  metricCodes?: readonly string[],
): Promise<AiToolResult> {
  const asOf = "2026-08-13";
  return buildOpportunityScoreResult({
    informationAsOf: asOf,
    scorecard: await calculateOpportunityScore({
      applicationScope: "non-road",
      asOf,
      countryIso3s: ["CHN", "BRA"],
      ...(metricCodes === undefined ? {} : { metricCodes: [...metricCodes] }),
      powerKw: 100,
    }),
  });
}

async function salesBriefEvidence(
  metricCodes?: readonly string[],
): Promise<AiToolResult> {
  const asOf = "2026-08-13";
  return buildSalesBriefResult({
    brief: await generateSalesBrief({
      applicationScope: "non-road",
      asOf,
      countryIso3s: ["CHN", "BRA"],
      ...(metricCodes === undefined ? {} : { metricCodes: [...metricCodes] }),
      powerKw: 100,
      targetCountryIso3: "CHN",
    }),
    informationAsOf: asOf,
  });
}

function knowledgeEvidence(input: {
  applicationScope: "non-road" | null;
  countryIso3?: "BRA" | "CHN";
  query: string;
}): AiToolResult {
  const asOf = currentUtcDate();
  const countryIso3 = input.countryIso3 ?? "CHN";
  return buildKnowledgeResult({
    informationAsOf: asOf,
    resolvedCountryIso3: countryIso3,
    search: hybridSearchResponseSchema.parse({
      embeddingModel: "local-hash-embedding-v1",
      filters: {
        applicationScope: input.applicationScope,
        asOf,
        countryIso3,
        jurisdictionId: null,
        limit: 5,
      },
      query: input.query,
      results: [
        {
          applicationScope: "non-road",
          chunkId: "00000000-0000-4000-8000-000000000701",
          content: `${countryIso3} non-road emissions regulation source evidence.`,
          countryIso3,
          document: {
            downloadUrl: null,
            id: "00000000-0000-4000-8000-000000000702",
            originalFilename: "evidence.txt",
            publishedOn: "2026-01-01",
            source: {
              id: regressionCitation.sourceId,
              isDemo: true,
              publishedOn: "2026-01-01",
              publisher: "DEMO ONLY",
              title: regressionCitation.sourceTitle,
              url: null,
              verifiedAt: regressionCitation.verifiedAt,
            },
            title: "DEMO ONLY — source evidence fixture",
          },
          finalScore: 0.8,
          headingPath: ["Evidence"],
          jurisdiction: null,
          keywordScore: 0.8,
          pageFrom: 1,
          pageTo: 1,
          rank: 1,
          sectionLocator: "§1",
          validFrom: "2025-01-01",
          validTo: null,
          vectorScore: 0.8,
          warnings: [],
        },
      ],
      scoring: { keywordWeight: 0.5, vectorWeight: 0.5 },
      status: "ok",
    }),
  });
}

const evidenceByCaseId: Record<
  (typeof regressionCaseIds)[number],
  () => AiToolResult | Promise<AiToolResult>
> = {
  "country-overview-china": () =>
    countryProfileEvidence({ asOf: "2026-08-13", topic: "country" }),
  "single-country-market-profile": () =>
    countryProfileEvidence({ asOf: currentUtcDate(), topic: "market" }),
  "product-ready-dual-axis": () =>
    compatibleProductEvidence("2026-08-13"),
  "comparable-market-metric": marketEvidence,
  "opportunity-score": opportunityEvidence,
  "sales-brief": salesBriefEvidence,
  "source-document-retrieval": () =>
    knowledgeEvidence({
      applicationScope: "non-road",
      query: "CHN 非道路排放法规原文章节来源证据",
    }),
  "multi-turn-country-conflict": regulationEvidence,
  "unknown-product-fails-closed": unknownProductEvidence,
};

const metadataEvidenceCaseIds = [
  "source-document-retrieval",
  "country-overview-china",
  "product-ready-dual-axis",
  "multi-turn-country-conflict",
  "comparable-market-metric",
  "opportunity-score",
  "sales-brief",
] as const;

type MetricCodeQuery = { metricCodes?: string[] };

function metricCodeQuery(result: AiToolResult): MetricCodeQuery {
  if (result.tool === "compareMarkets") {
    return result.comparison.query;
  }
  if (result.tool === "calculateOpportunityScore") {
    return result.scorecard.query;
  }
  if (result.tool === "generateSalesBrief") {
    return result.brief.query;
  }
  throw new Error(`Tool ${result.tool} does not expose metricCodes.`);
}

const explicitMetricCodeCases = [
  {
    buildResult: marketEvidence,
    id: "market comparison",
    userTexts: [
      "Compare market metric demo_addressable_units for CHN versus BRA.",
    ],
  },
  {
    buildResult: () => opportunityEvidence(["DEMO_ADDRESSABLE_UNITS"]),
    id: "opportunity score",
    userTexts: [
      "使用 DEMO_ADDRESSABLE_UNITS 给 CHN 和 BRA 的 non-road 100 kW 做 2026-08-13 机会评分。",
    ],
  },
  {
    buildResult: () => salesBriefEvidence(["DEMO_ADDRESSABLE_UNITS"]),
    id: "sales brief",
    userTexts: [
      "使用 DEMO_ADDRESSABLE_UNITS 为 CHN 和 BRA 的 non-road 100 kW 生成 2026-08-13 销售简报，目标市场 CHN。",
    ],
  },
] satisfies ReadonlyArray<{
  buildResult: () => AiToolResult | Promise<AiToolResult>;
  id: string;
  userTexts: readonly string[];
}>;

const deterministicDriftCases = [
  {
    buildResult: () => compatibleProductEvidence("2026-08-13"),
    id: "product status and readiness",
    liveCaseId: "product-ready-dual-axis" as const,
    mutate: (result: AiToolResult) => {
      if (result.tool !== "findCompatibleProducts") {
        throw new Error("Expected a compatible-product fixture.");
      }
      const evaluation = result.evaluations[0];
      if (!evaluation) {
        throw new Error("Expected a product evaluation fixture.");
      }
      evaluation.status = "not_fit";
      evaluation.commercialReadiness = "not_ready";
    },
  },
  {
    buildResult: regulationEvidence,
    id: "regulation current/future status",
    liveCaseId: "multi-turn-country-conflict" as const,
    mutate: (result: AiToolResult) => {
      if (result.tool !== "compareRegulations") {
        throw new Error("Expected a regulation-comparison fixture.");
      }
      const regulation = result.comparison.countries.flatMap(
        ({ currentEffectiveRegulations }) => currentEffectiveRegulations,
      )[0];
      if (!regulation) {
        throw new Error("Expected a current regulation fixture.");
      }
      regulation.status = "adopted";
    },
  },
  {
    buildResult: marketEvidence,
    id: "market issue and comparison status",
    liveCaseId: "comparable-market-metric" as const,
    mutate: (result: AiToolResult) => {
      if (result.tool !== "compareMarkets") {
        throw new Error("Expected a market-comparison fixture.");
      }
      const metric = result.comparison.metrics[0];
      if (!metric) {
        throw new Error("Expected a market metric fixture.");
      }
      metric.issues.push("UNIT_MISMATCH");
    },
  },
  {
    buildResult: opportunityEvidence,
    id: "opportunity score arithmetic",
    liveCaseId: "opportunity-score" as const,
    mutate: (result: AiToolResult) => {
      if (result.tool !== "calculateOpportunityScore") {
        throw new Error("Expected an opportunity-score fixture.");
      }
      const score = result.scorecard.scores[0];
      if (!score) {
        throw new Error("Expected a country score fixture.");
      }
      score.overallScore = score.overallScore === 1 ? 2 : 1;
    },
  },
  {
    buildResult: salesBriefEvidence,
    id: "sales-brief target score",
    liveCaseId: "sales-brief" as const,
    mutate: (result: AiToolResult) => {
      if (result.tool !== "generateSalesBrief") {
        throw new Error("Expected a sales-brief fixture.");
      }
      result.brief.marketScore.countryIso3 =
        result.brief.query.targetCountryIso3 === "CHN" ? "BRA" : "CHN";
    },
  },
] satisfies ReadonlyArray<{
  buildResult: () => AiToolResult | Promise<AiToolResult>;
  id: string;
  liveCaseId: (typeof regressionCaseIds)[number];
  mutate: (result: AiToolResult) => void;
}>;

function recomputeLatestVerifiedAt(result: AiToolResult): string | null {
  return latestVerifiedAtFromCitations(result.citations);
}

describe("live-eval evidence-contract regressions", () => {
  it("orders latest citation freshness by instant rather than timestamp text", () => {
    const citations = [
      { verifiedAt: "2026-01-02T00:30:00+01:00" },
      { verifiedAt: "2026-01-02T00:00:00.000Z" },
    ];

    expect(
      latestVerifiedAtMatchesCitations({
        citations,
        latestVerifiedAt: "2026-01-02T00:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      latestVerifiedAtMatchesCitations({
        citations,
        latestVerifiedAt: "2026-01-02T00:30:00+01:00",
      }),
    ).toBe(false);
    expect(latestVerifiedAtFromCitations(citations)).toBe(
      "2026-01-02T00:00:00.000Z",
    );
  });

  it("uses the shared instant ordering when a tool-result builder emits freshness", async () => {
    const seed = structuredClone(await marketEvidence());
    if (seed.tool !== "compareMarkets") {
      throw new Error("Expected a market comparison fixture.");
    }
    const timestamps = [
      "2026-01-02T00:30:00+01:00",
      "2026-01-02T00:00:00.000Z",
    ] as const;
    for (const [index, timestamp] of timestamps.entries()) {
      const source = seed.comparison.sources[index];
      if (!source) {
        throw new Error("Expected two market source fixtures.");
      }
      source.verifiedAt = timestamp;
      const observation = seed.comparison.metrics
        .flatMap(({ observations }) => observations)
        .find(({ id }) => id === source.entityId);
      if (!observation) {
        throw new Error("Expected a nested market observation fixture.");
      }
      observation.source.verifiedAt = timestamp;
    }

    const built = buildMarketComparisonResult({
      comparison: seed.comparison,
      informationAsOf: seed.informationAsOf,
    });

    expect(built.latestVerifiedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(aiToolResultSchema.safeParse(built).success).toBe(true);
  });

  it.each(metadataEvidenceCaseIds)(
    "%s rejects every visible citation metadata drift",
    async (id) => {
      const result = structuredClone(await evidenceByCaseId[id]());
      const original = result.citations[0];
      if (!original) {
        throw new Error(`Expected citation fixture for ${id}.`);
      }
      const mutations = [
        {
          entityId: "00000000-0000-4000-8000-000000000997",
          entityType: original.entityType ?? "regulation",
        },
        { isDemo: !original.isDemo },
        { locator: "FORGED-LOCATOR" },
        {
          locatorDescriptor:
            original.locatorDescriptor == null
              ? {
                  kind: "membership_period" as const,
                  validFrom: "2098-01-01",
                  validTo: "2099-01-01",
                }
              : null,
        },
        { publishedOn: "2099-01-01" },
        {
          regulationId: "00000000-0000-4000-8000-000000000998",
          regulationStatus:
            original.regulationStatus === "superseded"
              ? "effective"
              : "superseded",
        },
        { sourceId: "00000000-0000-4000-8000-000000000999" },
        { sourceTitle: "FORGED SOURCE TITLE" },
        { sourceUrl: "https://example.com/forged-source" },
        { title: "FORGED EVIDENCE TITLE" },
        {
          titleDescriptor:
            original.titleDescriptor == null
              ? {
                  kind: "regulation_limits" as const,
                  regulationName: "FORGED REGULATION",
                }
              : null,
        },
        { verifiedAt: "2099-01-01T00:00:00.000Z" },
      ] satisfies ReadonlyArray<Partial<typeof original>>;

      for (const mutation of mutations) {
        const candidate = structuredClone(result);
        candidate.citations[0] = { ...original, ...mutation };
        candidate.latestVerifiedAt = recomputeLatestVerifiedAt(candidate);
        expect(
          aiToolResultSchema.safeParse(candidate).success,
          `${id}: ${Object.keys(mutation)[0]}`,
        ).toBe(false);
      }
    },
  );

  it.each(metadataEvidenceCaseIds)(
    "%s recomputes latestVerifiedAt from citations",
    async (id) => {
      const result = structuredClone(await evidenceByCaseId[id]());
      result.latestVerifiedAt = "2099-01-01T00:00:00.000Z";

      expect(aiToolResultSchema.safeParse(result).success).toBe(false);
      expect(evidenceContractAllowsModelText(
        buildSalesChatEvidenceContract({
          selectedCountryIso3: liveCase(id).selectedCountryIso3,
          userTexts: liveCase(id).userTexts,
        }),
        [result],
      )).toBe(false);
    },
  );

  it.each(metadataEvidenceCaseIds)(
    "%s rejects an appended citation that is not owned by a visible fact",
    async (id) => {
      const result = structuredClone(await evidenceByCaseId[id]());
      const original = result.citations[0];
      if (!original) {
        throw new Error(`Expected citation fixture for ${id}.`);
      }
      result.citations.push({
        ...original,
        sourceId: "00000000-0000-4000-8000-000000000996",
        sourceTitle: "FORGED UNOWNED SOURCE",
        sourceUrl: "https://example.com/forged-unowned-source",
        title: "FORGED UNOWNED CITATION",
        verifiedAt: "2099-01-01T00:00:00.000Z",
      });
      result.latestVerifiedAt = recomputeLatestVerifiedAt(result);

      expect(aiToolResultSchema.safeParse(result).success).toBe(false);
      expect(clientAiToolResultSchema.safeParse(result).success).toBe(false);
      expect(evidenceContractAllowsModelText(
        buildSalesChatEvidenceContract({
          selectedCountryIso3: liveCase(id).selectedCountryIso3,
          userTexts: liveCase(id).userTexts,
        }),
        [result],
      )).toBe(false);
    },
  );

  it.each(metadataEvidenceCaseIds)(
    "%s allows a duplicate of an owned citation",
    async (id) => {
      const result = structuredClone(await evidenceByCaseId[id]());
      const original = result.citations[0];
      if (!original) {
        throw new Error(`Expected citation fixture for ${id}.`);
      }
      result.citations.push(structuredClone(original));

      expect(aiToolResultSchema.safeParse(result).success).toBe(true);
      expect(clientAiToolResultSchema.safeParse(result).success).toBe(true);
      expect(evidenceContractAllowsModelText(
        buildSalesChatEvidenceContract({
          selectedCountryIso3: liveCase(id).selectedCountryIso3,
          userTexts: liveCase(id).userTexts,
        }),
        [result],
      )).toBe(true);
    },
  );

  it.each(deterministicDriftCases)(
    "fails closed on coordinated $id drift before model text",
    async ({ buildResult, liveCaseId, mutate }) => {
      const testCase = liveCase(liveCaseId);
      const result = structuredClone(await buildResult());
      const contract = buildSalesChatEvidenceContract({
        selectedCountryIso3: testCase.selectedCountryIso3,
        userTexts: testCase.userTexts,
      });

      expect(evidenceContractAllowsModelText(contract, [result])).toBe(true);
      mutate(result);

      expect(evidenceContractAllowsModelText(contract, [result])).toBe(false);
    },
  );

  it.each([
    { input: { query: "source" }, tool: "searchKnowledgeBase" },
    {
      input: { countryIso3: "CHN", topics: ["country"] },
      tool: "getCountryProfile",
    },
    {
      input: {
        applicationScope: "non-road",
        asOf: "2026-08-13",
        countryIso3: "CHN",
        powerKw: 100,
      },
      tool: "findCompatibleProducts",
    },
    {
      input: {
        applicationScope: "non-road",
        asOf: "2026-08-13",
        countryIso3s: ["CHN"],
        powerKw: 100,
      },
      tool: "compareRegulations",
    },
    {
      input: { countryIso3s: ["CHN", "BRA"] },
      tool: "compareMarkets",
    },
    {
      input: {
        applicationScope: "non-road",
        asOf: "2026-08-13",
        countryIso3s: ["CHN", "BRA"],
        powerKw: 100,
      },
      tool: "calculateOpportunityScore",
    },
    {
      input: {
        applicationScope: "non-road",
        asOf: "2026-08-13",
        countryIso3s: ["CHN", "BRA"],
        powerKw: 100,
        targetCountryIso3: "CHN",
      },
      tool: "generateSalesBrief",
    },
  ] as const)("keeps an empty-citation $tool error result valid", ({
    input,
    tool,
  }) => {
    const result = buildToolErrorResult(tool, "2026-08-13", input);

    expect(result).toMatchObject({
      citations: [],
      latestVerifiedAt: null,
      status: "error",
    });
    expect(aiToolResultSchema.safeParse(result).success).toBe(true);
    expect(clientAiToolResultSchema.safeParse(result).success).toBe(true);
  });

  it("keeps a legitimate no_data result valid without citations", () => {
    const result = buildCompatibleProductsResult({
      applicationScope: "non-road",
      asOf: "2026-08-13",
      countryIso3: "CHN",
      evaluations: [],
      powerKw: 100,
    });

    expect(result).toMatchObject({
      citations: [],
      latestVerifiedAt: null,
      status: "no_data",
    });
    expect(aiToolResultSchema.safeParse(result).success).toBe(true);
    expect(clientAiToolResultSchema.safeParse(result).success).toBe(true);
  });

  it.each([
    { field: "documentTitle", value: "FORGED DOCUMENT TITLE" },
    { field: "isDemo", value: false },
    { field: "pageFrom", value: 7 },
    { field: "pageTo", value: 8 },
    { field: "sectionLocator", value: "FORGED SECTION" },
    { field: "sourceUrl", value: "https://example.com/forged-knowledge" },
    { field: "title", value: "FORGED HIT TITLE" },
  ] as const)("rejects knowledge citation $field drift", ({ field, value }) => {
    const result = structuredClone(
      knowledgeEvidence({
        applicationScope: "non-road",
        query: "CHN 非道路排放法规原文章节来源证据",
      }),
    );
    const citation = result.citations[0];
    if (!citation) {
      throw new Error("Expected a knowledge citation fixture.");
    }
    result.citations[0] = { ...citation, [field]: value };

    expect(aiToolResultSchema.safeParse(result).success).toBe(false);
  });

  it.each(["compareRegulations", "compareMarkets"] as const)(
    "rejects $tool top-level source metadata that drifts from its nested source",
    async (tool) => {
      const result = structuredClone(
        tool === "compareRegulations"
          ? await regulationEvidence()
          : await marketEvidence(),
      );
      if (result.tool !== tool) {
        throw new Error(`Expected ${tool} fixture.`);
      }
      const source = result.comparison.sources[0];
      if (!source) {
        throw new Error(`Expected ${tool} source fixture.`);
      }
      result.comparison.sources[0] = {
        ...source,
        sourceUrl: "https://example.com/forged-top-level-source",
      };

      expect(aiToolResultSchema.safeParse(result).success).toBe(false);
    },
  );

  it("rejects coordinated market source/citation title and locator drift", async () => {
    const result = structuredClone(await marketEvidence());
    if (result.tool !== "compareMarkets") {
      throw new Error("Expected a market comparison fixture.");
    }
    const observation = result.comparison.metrics[0]?.observations[0];
    if (!observation) {
      throw new Error("Expected a market observation fixture.");
    }
    const topLevelSource = result.comparison.sources.find(
      ({ entityId, entityType }) =>
        entityId === observation.id && entityType === "market_metric",
    );
    const citation = result.citations.find(
      ({ entityId, entityType }) =>
        entityId === observation.id && entityType === "market_metric",
    );
    if (!topLevelSource || !citation) {
      throw new Error("Expected paired market source fixtures.");
    }
    for (const source of [observation.source, topLevelSource]) {
      source.locator = "FORGED MARKET PERIOD";
      source.locatorDescriptor = null;
      source.title = "FORGED MARKET TITLE";
      source.titleDescriptor = null;
    }
    citation.locator = "FORGED MARKET PERIOD";
    citation.locatorDescriptor = null;
    citation.title = "FORGED MARKET TITLE";
    citation.titleDescriptor = null;

    expect(aiToolResultSchema.safeParse(result).success).toBe(false);
  });

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
    async (id) => {
      const testCase = liveCase(id);
      const contract = buildSalesChatEvidenceContract({
        selectedCountryIso3: testCase.selectedCountryIso3,
        userTexts: testCase.userTexts,
      });
      const result = await evidenceByCaseId[id]();

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

  it("keeps an explicit profile date fail-closed until the tool echoes it", async () => {
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
        await countryProfileEvidence({ asOf: "2026-08-14", topic: "country" }),
      ]),
    ).toBe(false);
    expect(buildSalesChatInstructions(null, "zh-CN")).toContain(
      "用户明确给出 asOf 时，必须把该日期原样传给每个支持 asOf 的工具",
    );
  });

  it.each([
    {
      expectedMissing: ["powerKw"],
      id: "scope without power",
      userTexts: ["核对 CHN non-road 当前法规。"],
    },
    {
      expectedMissing: ["applicationScope"],
      id: "power without scope",
      userTexts: ["Check current CHN regulations at 100 kW."],
    },
    {
      expectedMissing: ["powerKw"],
      id: "negated comparison with a partial single-country filter",
      userTexts: ["不做跨国比较，只看 CHN non-road 当前法规。"],
    },
  ])("fails closed before tools for $id", async ({
    expectedMissing,
    userTexts,
  }) => {
    const contract = buildSalesChatEvidenceContract({
      selectedCountryIso3: null,
      userTexts,
    });
    const broadProfile = await countryProfileEvidence({
      asOf: currentUtcDate(),
      topic: "regulations",
    });

    expect(contract.missingRequiredParameters).toEqual(expectedMissing);
    expect(remainingEvidenceTools(contract, [])).toEqual([]);
    expect(evidenceContractAllowsModelText(contract, [broadProfile])).toBe(
      false,
    );
  });

  it.each([
    {
      id: "English do not compare",
      userText:
        "Show only CHN structured market metrics; do not compare countries.",
    },
    {
      id: "English straight-apostrophe contraction",
      userText:
        "Show only CHN structured market metrics; don't compare countries.",
    },
    {
      id: "English curly-apostrophe contraction",
      userText:
        "Show only CHN structured market metrics; don’t compare countries.",
    },
    {
      id: "Chinese bie negation",
      userText: "只看 CHN 市场指标，别做跨国比较。",
    },
  ])("keeps $id on the single-country profile path", ({ userText }) => {
    const contract = buildSalesChatEvidenceContract({
      selectedCountryIso3: null,
      userTexts: [userText],
    });

    expect(contract.missingRequiredParameters).toEqual([]);
    expect(contract.requirements).toEqual([
      expect.objectContaining({
        acceptedTools: ["getCountryProfile"],
        query: expect.objectContaining({ countryIso3s: ["CHN"] }),
        requiredProfileTopics: ["market"],
      }),
    ]);
    expect(remainingEvidenceTools(contract, [])).toEqual([
      "getCountryProfile",
    ]);
  });

  it.each([
    {
      id: "English emission-compliant product fit",
      userText:
        "Evaluate whether product DEMO-ENG-100 is emission compliant in CHN non-road at 100 kW as of 2026-08-13.",
    },
    {
      id: "Chinese emission-compliance product fit",
      userText:
        "判断产品 DEMO-ENG-100 在 CHN non-road 100 kW、2026-08-13 是否排放合规适配。",
    },
  ])("keeps $id on the product-fit tool only", ({ userText }) => {
    const contract = buildSalesChatEvidenceContract({
      selectedCountryIso3: null,
      userTexts: [userText],
    });

    expect(contract.missingRequiredParameters).toEqual([]);
    expect(contract.requirements).toEqual([
      expect.objectContaining({
        acceptedTools: ["findCompatibleProducts"],
        query: expect.objectContaining({
          applicationScope: "non-road",
          asOf: "2026-08-13",
          countryIso3s: ["CHN"],
          powerKw: 100,
          productModelCode: "DEMO-ENG-100",
        }),
      }),
    ]);
    expect(remainingEvidenceTools(contract, [])).toEqual([
      "findCompatibleProducts",
    ]);
  });

  it("preserves a partial regulation filter across turns and resumes only when complete", async () => {
    const contract = buildSalesChatEvidenceContract({
      selectedCountryIso3: null,
      userTexts: [
        "核对 CHN non-road 当前法规。",
        "功率是 100 kW，截止 2026-08-13。",
      ],
    });
    const result = await regulationEvidence("CHN");

    expect(contract).toMatchObject({
      applicationScope: "non-road",
      missingRequiredParameters: [],
      powerKw: 100,
    });
    expect(remainingEvidenceTools(contract, [])).toEqual([
      "compareRegulations",
    ]);
    expect(evidenceContractAllowsModelText(contract, [result])).toBe(true);
  });

  it("does not let a broad profile unlock a scoped single-country market request", async () => {
    const contract = buildSalesChatEvidenceContract({
      selectedCountryIso3: null,
      userTexts: [
        "Show CHN non-road market data with no cross-country comparison.",
      ],
    });
    const broadProfile = await countryProfileEvidence({
      asOf: currentUtcDate(),
      topic: "market",
    });

    expect(contract.missingRequiredParameters).toEqual([
      "marketApplicationScopeFilter",
    ]);
    expect(remainingEvidenceTools(contract, [])).toEqual([]);
    expect(evidenceContractAllowsModelText(contract, [broadProfile])).toBe(
      false,
    );
  });

  it("does not treat an omitted provider result filter as matching an expected scope", async () => {
    const contract = buildSalesChatEvidenceContract({
      selectedCountryIso3: null,
      userTexts: ["比较 CHN 和 BRA 的 non-road 市场指标。"],
    });
    const unfilteredResult = await marketEvidence();

    expect(contract).toMatchObject({
      applicationScope: "non-road",
      missingRequiredParameters: [],
    });
    expect(remainingEvidenceTools(contract, [])).toEqual(["compareMarkets"]);
    expect(evidenceContractAllowsModelText(contract, [unfilteredResult])).toBe(
      false,
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

  it.each([
    {
      expectedCountryIso3: "CHN",
      expectedTerms: ["source", "market", "metrics"],
      id: "English market source",
      userText: "Show the source for CHN market metrics.",
    },
    {
      expectedCountryIso3: "CHN",
      expectedTerms: ["市", "场", "指", "标", "来", "源"],
      id: "Chinese market source",
      userText: "查 CHN 市场指标来源。",
    },
    {
      expectedCountryIso3: "CHN",
      expectedTerms: ["source", "demo", "eng", "fits", "non", "road"],
      id: "English product-fit source",
      userText:
        "Show the source proving DEMO-ENG-100 fits CHN non-road at 100 kW as of 2026-08-13.",
    },
    {
      expectedCountryIso3: "CHN",
      expectedTerms: ["source", "document", "sales", "brief"],
      id: "English sales-brief source document",
      userText:
        "Show the source document for a CHN non-road 100 kW sales brief as of 2026-08-13.",
    },
    {
      expectedCountryIso3: "CHN",
      expectedTerms: ["citation", "opportunity", "score"],
      id: "English opportunity-score citation",
      userText:
        "Show the citation for a CHN non-road 100 kW opportunity score as of 2026-08-13.",
    },
  ] as const)(
    "$id intent creates only one knowledge-search requirement",
    ({ expectedCountryIso3, expectedTerms, userText }) => {
      const contract = buildSalesChatEvidenceContract({
        selectedCountryIso3: null,
        userTexts: [userText],
      });

      expect(contract.requirements).toHaveLength(1);
      expect(contract.requirements[0]).toMatchObject({
        acceptedTools: ["searchKnowledgeBase"],
        query: { countryIso3s: [expectedCountryIso3] },
      });
      expect(contract.requirements[0]?.query.knowledgeTerms).toEqual(
        expect.arrayContaining([...expectedTerms]),
      );
      expect(remainingEvidenceTools(contract, [])).toEqual([
        "searchKnowledgeBase",
      ]);
    },
  );

  it.each([
    {
      id: "English coordinated country list",
      userText: "Show the sources for CHN and BRA market metrics.",
    },
    {
      id: "Chinese 和 coordinated country list",
      userText: "查 CHN 和 BRA 的市场指标来源。",
    },
    {
      id: "Chinese 与 coordinated country list",
      userText: "查 CHN 与 BRA 的市场指标来源。",
    },
    {
      id: "Chinese 以及 coordinated country list",
      userText: "查 CHN 以及 BRA 的市场指标来源。",
    },
  ])("keeps both countries in a $id source span", ({ userText }) => {
    const contract = buildSalesChatEvidenceContract({
      selectedCountryIso3: null,
      userTexts: [userText],
    });

    expect(contract.requirements).toEqual([
      expect.objectContaining({
        acceptedTools: ["searchKnowledgeBase"],
        query: expect.objectContaining({ countryIso3s: ["CHN"] }),
      }),
      expect.objectContaining({
        acceptedTools: ["searchKnowledgeBase"],
        query: expect.objectContaining({ countryIso3s: ["BRA"] }),
      }),
    ]);
    expect(remainingEvidenceTools(contract, [])).toEqual([
      "searchKnowledgeBase",
    ]);
  });

  it("requires matching source evidence for every country in a coordinated list", () => {
    const contract = buildSalesChatEvidenceContract({
      selectedCountryIso3: null,
      userTexts: ["Show the sources for CHN and BRA market metrics."],
    });
    const chinaEvidence = knowledgeEvidence({
      applicationScope: null,
      countryIso3: "CHN",
      query: "sources market metrics",
    });
    const brazilEvidence = knowledgeEvidence({
      applicationScope: null,
      countryIso3: "BRA",
      query: "sources market metrics",
    });

    expect(evidenceContractAllowsModelText(contract, [chinaEvidence])).toBe(
      false,
    );
    expect(remainingEvidenceTools(contract, [chinaEvidence])).toEqual([
      "searchKnowledgeBase",
    ]);
    expect(
      evidenceContractAllowsModelText(contract, [
        chinaEvidence,
        brazilEvidence,
      ]),
    ).toBe(true);
    expect(
      remainingEvidenceTools(contract, [chinaEvidence, brazilEvidence]),
    ).toEqual([]);
  });

  it.each([
    "先推荐 CHN non-road 100 kW 适配产品，并查 BRA 法规原文来源。",
    "Find the BRA regulation source and recommend a CHN non-road product.",
    "查 BRA 法规来源和推荐 CHN non-road 100 kW 产品。",
    "推荐 CHN non-road 100 kW 产品和查 BRA 法规来源。",
    "查 BRA 法规来源与推荐 CHN non-road 100 kW 产品。",
    "推荐 CHN non-road 100 kW 产品与查 BRA 法规来源。",
    "查 BRA 法规来源以及推荐 CHN non-road 100 kW 产品。",
    "推荐 CHN non-road 100 kW 产品以及查 BRA 法规来源。",
  ])(
    "keeps a mixed product country outside the explicit source span: %s",
    (userText) => {
      const contract = buildSalesChatEvidenceContract({
        selectedCountryIso3: null,
        userTexts: [userText],
      });

      expect(contract.requirements).toEqual([
        expect.objectContaining({
          acceptedTools: ["searchKnowledgeBase"],
          query: expect.objectContaining({ countryIso3s: ["BRA"] }),
        }),
      ]);
      expect(remainingEvidenceTools(contract, [])).toEqual([
        "searchKnowledgeBase",
      ]);
    },
  );

  it.each([
    {
      expectedAsOf: "2026-08-13",
      expectedCountryIso3: "CHN",
      expectedScope: "non-road",
      expectedTerms: ["source", "demo", "eng", "fits", "non", "road"],
      followUp: "Continue.",
      id: "neutral follow-up",
      sourceRequest:
        "Show the source proving DEMO-ENG-100 fits CHN non-road at 100 kW as of 2026-08-13.",
    },
    {
      expectedAsOf: "2026-08-14",
      expectedCountryIso3: "BRA",
      expectedScope: "marine",
      expectedTerms: ["source", "ref:stage:iv", "emission", "limits"],
      followUp:
        "For BRA marine as of 2026-08-14, continue searching the source.",
      id: "generic source follow-up",
      sourceRequest:
        "Show the source for CHN non-road Stage IV emission limits as of 2026-08-13.",
    },
  ])(
    "keeps a mixed explicit-source task active through a $id",
    ({
      expectedAsOf,
      expectedCountryIso3,
      expectedScope,
      expectedTerms,
      followUp,
      sourceRequest,
    }) => {
      const contract = buildSalesChatEvidenceContract({
        selectedCountryIso3: null,
        userTexts: [sourceRequest, followUp],
      });

      expect(contract.requirements).toHaveLength(1);
      expect(contract.requirements[0]).toMatchObject({
        acceptedTools: ["searchKnowledgeBase"],
        query: {
          applicationScope: expectedScope,
          asOf: expectedAsOf,
          countryIso3s: [expectedCountryIso3],
        },
      });
      expect(contract.requirements[0]?.query.knowledgeTerms).toEqual(
        expect.arrayContaining(expectedTerms),
      );
      expect(contract.requirements[0]?.query.knowledgeTerms).not.toContain(
        "continue",
      );
      expect(contract.requirements[0]?.query.knowledgeTerms).not.toContain(
        "searching",
      );
      expect(remainingEvidenceTools(contract, [])).toEqual([
        "searchKnowledgeBase",
      ]);
    },
  );

  it.each(["source", "citation", "source document"])(
    "treats the standalone '%s' phrase as explicit source intent",
    (userText) => {
      const contract = buildSalesChatEvidenceContract({
        selectedCountryIso3: null,
        userTexts: [userText],
      });

      expect(contract.requirements).toEqual([
        expect.objectContaining({
          acceptedTools: ["searchKnowledgeBase"],
          query: expect.objectContaining({ countryIso3s: [null] }),
        }),
      ]);
      expect(remainingEvidenceTools(contract, [])).toEqual([
        "searchKnowledgeBase",
      ]);
    },
  );

  it.each([
    {
      expectedTerms: [
        "official",
        "document",
        "non",
        "road",
        "emission",
        "regulations",
        "power:100kw",
      ],
      id: "official document",
      userText:
        "Retrieve the official document for CHN non-road emission regulations at 100 kW as of 2026-08-13.",
    },
    {
      expectedTerms: [
        "original",
        "text",
        "non",
        "road",
        "emission",
        "regulations",
        "power:100kw",
      ],
      id: "original text",
      userText:
        "Retrieve the original text for CHN non-road emission regulations at 100 kW as of 2026-08-13.",
    },
  ])("treats an English $id request as source-only", ({
    expectedTerms,
    userText,
  }) => {
    const contract = buildSalesChatEvidenceContract({
      selectedCountryIso3: null,
      userTexts: [userText],
    });

    expect(contract.missingRequiredParameters).toEqual([]);
    expect(contract.requirements).toEqual([
      expect.objectContaining({
        acceptedTools: ["searchKnowledgeBase"],
        query: expect.objectContaining({
          applicationScope: "non-road",
          asOf: "2026-08-13",
          countryIso3s: ["CHN"],
          knowledgeTerms: expect.arrayContaining(expectedTerms),
        }),
      }),
    ]);
    expect(remainingEvidenceTools(contract, [])).toEqual([
      "searchKnowledgeBase",
    ]);
  });

  it.each([
    {
      expectedTools: ["compareMarkets"],
      id: "resource",
      userText: "Compare CHN versus BRA market resources.",
    },
    {
      expectedTools: ["compareRegulations"],
      id: "outsourced",
      userText:
        "Which regulations apply to outsourced non-road equipment at 100 kW in CHN?",
    },
    {
      expectedTools: ["findCompatibleProducts"],
      id: "sourceable",
      userText:
        "Is sourceable product DEMO-ENG-100 compatible for CHN non-road at 100 kW?",
    },
  ] as const)(
    "does not treat the $id substring as explicit source intent",
    ({ expectedTools, userText }) => {
      const contract = buildSalesChatEvidenceContract({
        selectedCountryIso3: null,
        userTexts: [userText],
      });

      expect(contract.missingRequiredParameters).toEqual([]);
      expect(remainingEvidenceTools(contract, [])).toEqual(expectedTools);
      expect(contract.requirements).toHaveLength(1);
      expect(contract.requirements[0]?.acceptedTools).toEqual(expectedTools);
    },
  );

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

  it("accepts global market observations for an explicitly scoped query", async () => {
    const result = structuredClone(await marketEvidence());
    if (result.tool !== "compareMarkets") {
      throw new Error("Expected a market comparison fixture.");
    }
    result.comparison.query.applicationScope = "non-road";
    for (const observation of result.comparison.metrics.flatMap(
      ({ observations }) => observations,
    )) {
      observation.applicationScope = null;
    }

    expect(
      result.comparison.metrics.flatMap(({ observations }) => observations)
        .every(({ applicationScope }) => applicationScope === null),
    ).toBe(true);
    expect(marketComparisonSourcesMatchFacts(result.comparison)).toBe(true);
    expect(aiToolResultSchema.safeParse(result).success).toBe(true);
    expect(evidenceContractAllowsModelText(
      buildSalesChatEvidenceContract({
        selectedCountryIso3: null,
        userTexts: ["比较 CHN 和 BRA 的 non-road 市场指标。"],
      }),
      [result],
    )).toBe(true);
  });

  it.each(explicitMetricCodeCases)(
    "$id binds an explicit metric code as an exact normalized set",
    async ({ buildResult, userTexts }) => {
      const contract = buildSalesChatEvidenceContract({
        selectedCountryIso3: null,
        userTexts,
      });
      const result = await buildResult();

      expect(contract.requirements).toHaveLength(1);
      expect(contract.requirements[0]?.query.metricCodes).toEqual([
        "DEMO_ADDRESSABLE_UNITS",
      ]);
      expect(metricCodeQuery(result).metricCodes).toEqual([
        "DEMO_ADDRESSABLE_UNITS",
      ]);
      expect(aiToolResultSchema.safeParse(result).success).toBe(true);
      expect(evidenceContractAllowsModelText(contract, [result])).toBe(true);
    },
  );

  it.each(explicitMetricCodeCases)(
    "$id rejects missing, extra, duplicate, or changed result metric codes",
    async ({ buildResult, userTexts }) => {
      const contract = buildSalesChatEvidenceContract({
        selectedCountryIso3: null,
        userTexts,
      });
      const result = await buildResult();
      const mutations: ReadonlyArray<readonly string[] | undefined> = [
        undefined,
        ["DEMO_ADDRESSABLE_UNITS", "OTHER_METRIC"],
        ["DEMO_ADDRESSABLE_UNITS", "DEMO_ADDRESSABLE_UNITS"],
        ["OTHER_METRIC"],
      ];

      for (const metricCodes of mutations) {
        const candidate = structuredClone(result);
        const query = metricCodeQuery(candidate);
        if (metricCodes === undefined) {
          delete query.metricCodes;
        } else {
          query.metricCodes = [...metricCodes];
        }
        expect(
          evidenceContractAllowsModelText(contract, [candidate]),
          metricCodes?.join(",") ?? "missing",
        ).toBe(false);
      }
    },
  );

  it("does not misread natural-language metrics, non-road, or ordinary uppercase words as metric codes", () => {
    const contract = buildSalesChatEvidenceContract({
      selectedCountryIso3: null,
      userTexts: [
        "Compare CHN and BRA NON-ROAD market data for addressable units and SALES VOLUME.",
      ],
    });

    expect(contract.requirements).toHaveLength(1);
    expect(contract.requirements[0]?.acceptedTools).toEqual([
      "compareMarkets",
    ]);
    expect(contract.requirements[0]?.query).not.toHaveProperty(
        "metricCodes",
    );

    const colonCodeContract = buildSalesChatEvidenceContract({
      selectedCountryIso3: null,
      userTexts: [
        "Compare market metric demo:addressable_units for CHN versus BRA.",
      ],
    });
    expect(colonCodeContract.requirements[0]?.query.metricCodes).toEqual([
      "DEMO:ADDRESSABLE_UNITS",
    ]);
  });

  it("binds a code-only follow-up only to the active metric evidence task", () => {
    const scoreContract = buildSalesChatEvidenceContract({
      selectedCountryIso3: null,
      userTexts: [
        "给 CHN 和 BRA 的 non-road 100 kW 做 2026-08-13 机会评分。",
        "改用 demo_addressable_units。",
      ],
    });
    const unrelatedContract = buildSalesChatEvidenceContract({
      selectedCountryIso3: null,
      userTexts: [
        "比较 CHN 和 BRA 的市场指标 PREVIOUS_MARKET_CODE。",
        "核对 CHN non-road 100 kW 产品 UNRELATED_PRODUCT_CODE 是否适配。",
        "给 CHN 和 BRA 做机会评分。",
      ],
    });

    expect(scoreContract.requirements[0]?.query.metricCodes).toEqual([
      "DEMO_ADDRESSABLE_UNITS",
    ]);
    expect(unrelatedContract.requirements[0]?.acceptedTools).toEqual([
      "calculateOpportunityScore",
    ]);
    expect(unrelatedContract.requirements[0]?.query).not.toHaveProperty(
      "metricCodes",
    );
  });
});
