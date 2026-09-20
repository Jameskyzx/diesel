import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { clientAiToolResultSchema } from "@/features/ai/client-schemas";
import {
  aiToolResultSchema,
  type AiToolResult,
} from "@/features/ai/schemas";
import {
  buildCompatibleProductsResult,
  buildMarketComparisonResult,
  buildOpportunityScoreResult,
  buildRegulationComparisonResult,
  buildSalesBriefResult,
  buildToolErrorResult,
} from "@/server/ai/tool-results";
import {
  evidenceContractAllowsModelText,
  type SalesChatEvidenceContract,
} from "@/server/ai/evidence-contract";
import { findCompatibleProducts } from "@/server/services/compatible-products-service";
import {
  calculateOpportunityScore,
  compareMarkets,
  compareRegulations,
  generateSalesBrief,
} from "@/server/services/marketing-analysis-service";

const originalDatabaseMode = process.env.DATABASE_MODE;

const analysisInput = {
  applicationScope: "non-road" as const,
  asOf: "2026-07-29",
  countryIso3s: ["CHN", "BRA"],
  metricCodes: ["DEMO_ADDRESSABLE_UNITS"],
  powerKw: 100,
};

type Fixtures = {
  brief: ReturnType<typeof buildSalesBriefResult>;
  market: ReturnType<typeof buildMarketComparisonResult>;
  products: ReturnType<typeof buildCompatibleProductsResult>;
  regulations: ReturnType<typeof buildRegulationComparisonResult>;
  score: ReturnType<typeof buildOpportunityScoreResult>;
};

let fixtures: Fixtures;

beforeAll(async () => {
  process.env.DATABASE_MODE = "pglite-demo";
  const [evaluations, regulations, market, scorecard, brief] =
    await Promise.all([
      findCompatibleProducts({
        applicationScope: analysisInput.applicationScope,
        asOf: analysisInput.asOf,
        countryIso3: "CHN",
        powerKw: analysisInput.powerKw,
      }),
      compareRegulations({
        applicationScope: analysisInput.applicationScope,
        asOf: analysisInput.asOf,
        countryIso3s: analysisInput.countryIso3s,
        powerKw: analysisInput.powerKw,
      }),
      compareMarkets({
        applicationScope: analysisInput.applicationScope,
        countryIso3s: analysisInput.countryIso3s,
        metricCodes: analysisInput.metricCodes,
      }),
      calculateOpportunityScore(analysisInput),
      generateSalesBrief({
        ...analysisInput,
        targetCountryIso3: "CHN",
      }),
    ]);

  fixtures = {
    brief: buildSalesBriefResult({
      brief,
      informationAsOf: analysisInput.asOf,
    }),
    market: buildMarketComparisonResult({
      comparison: market,
      informationAsOf: analysisInput.asOf,
    }),
    products: buildCompatibleProductsResult({
      applicationScope: analysisInput.applicationScope,
      asOf: analysisInput.asOf,
      countryIso3: "CHN",
      evaluations,
      powerKw: analysisInput.powerKw,
    }),
    regulations: buildRegulationComparisonResult({
      comparison: regulations,
      informationAsOf: analysisInput.asOf,
    }),
    score: buildOpportunityScoreResult({
      informationAsOf: analysisInput.asOf,
      scorecard,
    }),
  };
});

afterAll(() => {
  if (originalDatabaseMode === undefined) {
    delete process.env.DATABASE_MODE;
  } else {
    process.env.DATABASE_MODE = originalDatabaseMode;
  }
});

function expectBothSchemasToReject(result: unknown): void {
  expect(aiToolResultSchema.safeParse(result).success).toBe(false);
  expect(clientAiToolResultSchema.safeParse(result).success).toBe(false);
}

describe("deterministic AI result schema wiring", () => {
  it("accepts canonical service and builder results at both boundaries", () => {
    for (const result of Object.values(fixtures)) {
      expect(aiToolResultSchema.safeParse(result).success).toBe(true);
      expect(clientAiToolResultSchema.safeParse(result).success).toBe(true);
    }
  });

  const mutators: Array<{
    mutate: (result: AiToolResult) => void;
    name: string;
    result: () => AiToolResult;
  }> = [
    {
      mutate: (result) => {
        if (result.tool !== "findCompatibleProducts") {
          throw new Error("Expected a product result fixture.");
        }
        const evaluation = result.evaluations.find(
          ({ status }) => status === "fit",
        );
        if (!evaluation) {
          throw new Error("Expected a fit evaluation fixture.");
        }
        evaluation.status = "not_fit";
        evaluation.commercialReadiness = "not_ready";
        evaluation.reasons = [
          {
            code: "APPLICATION_SCOPE_MISMATCH",
            message: "产品应用场景不包含 non-road。",
            status: "fail",
          },
        ];
      },
      name: "synchronized product status and readiness drift",
      result: () => structuredClone(fixtures.products),
    },
    {
      mutate: (result) => {
        if (result.tool !== "compareRegulations") {
          throw new Error("Expected a regulation result fixture.");
        }
        const country = result.comparison.countries.find(
          ({ futureAdoptedRegulations }) =>
            futureAdoptedRegulations.length > 0,
        );
        const future = country?.futureAdoptedRegulations.pop();
        if (!country || !future) {
          throw new Error("Expected a future regulation fixture.");
        }
        future.status = "effective";
        country.currentEffectiveRegulations.push(future);
      },
      name: "synchronized future/current regulation drift",
      result: () => structuredClone(fixtures.regulations),
    },
    {
      mutate: (result) => {
        if (result.tool !== "compareMarkets") {
          throw new Error("Expected a market result fixture.");
        }
        const metric = result.comparison.metrics[0];
        if (!metric) {
          throw new Error("Expected a market metric fixture.");
        }
        metric.issues = ["UNIT_MISMATCH"];
        metric.comparisonStatus = "incomparable";
        result.evidenceSufficient = false;
        result.status = "no_data";
      },
      name: "synchronized unsupported market issue and status",
      result: () => structuredClone(fixtures.market),
    },
    {
      mutate: (result) => {
        if (result.tool !== "calculateOpportunityScore") {
          throw new Error("Expected a score result fixture.");
        }
        result.scorecard.scores[0]!.overallScore = 1;
      },
      name: "opportunity score arithmetic drift",
      result: () => structuredClone(fixtures.score),
    },
    {
      mutate: (result) => {
        if (result.tool !== "calculateOpportunityScore") {
          throw new Error("Expected a score result fixture.");
        }
        Reflect.set(result.scorecard, "rulesetVersion", "score-v999");
      },
      name: "opportunity score ruleset drift",
      result: () => structuredClone(fixtures.score),
    },
    {
      mutate: (result) => {
        if (result.tool !== "generateSalesBrief") {
          throw new Error("Expected a sales-brief result fixture.");
        }
        result.brief.query.targetCountryIso3 = "BRA";
      },
      name: "sales-brief target drift",
      result: () => structuredClone(fixtures.brief),
    },
    {
      mutate: (result) => {
        if (result.tool !== "generateSalesBrief") {
          throw new Error("Expected a sales-brief result fixture.");
        }
        const product = result.brief.recommendedProducts[0];
        if (!product?.availableTo) {
          throw new Error("Expected a dated recommended product fixture.");
        }
        result.brief.query.asOf = product.availableTo;
      },
      name: "sales-brief recommendation date drift",
      result: () => structuredClone(fixtures.brief),
    },
    {
      mutate: (result) => {
        if (result.tool !== "generateSalesBrief") {
          throw new Error("Expected a sales-brief result fixture.");
        }
        const product = result.brief.recommendedProducts[0];
        const certification = product?.certifications[0];
        if (!product || !certification) {
          throw new Error("Expected recommendation evidence IDs.");
        }
        product.certifications.push(certification);
      },
      name: "sales-brief duplicate recommendation IDs",
      result: () => structuredClone(fixtures.brief),
    },
  ];

  it.each(mutators)("rejects $name", ({ mutate, result }) => {
    const drifted = result();
    mutate(drifted);

    expectBothSchemasToReject(drifted);
  });

  it("fails closed when client-visible market inputs needed for recomputation are missing", () => {
    const missingPeriod = structuredClone(fixtures.market);
    const observation = missingPeriod.comparison.metrics[0]?.observations[0];
    if (!observation) {
      throw new Error("Expected a market observation fixture.");
    }
    Reflect.deleteProperty(observation, "periodStart");

    expectBothSchemasToReject(missingPeriod);
  });

  it.each([
    "brief",
    "market",
    "products",
    "regulations",
    "score",
  ] as const)("rejects a forged top-level warning on $s", (fixtureName) => {
    const result = structuredClone(fixtures[fixtureName]);
    result.warnings.push("FORGED_TOP_LEVEL_WARNING");

    expectBothSchemasToReject(result);
  });

  it("keeps canonical no-facts error placeholders valid at both boundaries", () => {
    const errorCases = [
      {
        input: {
          applicationScope: "non-road",
          asOf: analysisInput.asOf,
          countryIso3: "CHN",
          jurisdictionId: null,
          limit: 5,
          query: "CHN emissions source",
        },
        tool: "searchKnowledgeBase" as const,
      },
      {
        input: {
          asOf: analysisInput.asOf,
          countryIso3: "CHN",
          topics: ["country", "regulations"],
        },
        tool: "getCountryProfile" as const,
      },
      {
        input: {
          applicationScope: "non-road",
          asOf: analysisInput.asOf,
          countryIso3: "CHN",
          powerKw: 100,
        },
        tool: "findCompatibleProducts" as const,
      },
      {
        input: {
          applicationScope: "non-road",
          asOf: analysisInput.asOf,
          countryIso3s: ["CHN", "BRA"],
          powerKw: 100,
        },
        tool: "compareRegulations" as const,
      },
      {
        input: {
          applicationScope: "non-road",
          countryIso3s: ["CHN", "BRA"],
          metricCodes: ["DEMO_ADDRESSABLE_UNITS"],
        },
        tool: "compareMarkets" as const,
      },
      {
        input: analysisInput,
        tool: "calculateOpportunityScore" as const,
      },
      {
        input: { ...analysisInput, targetCountryIso3: "CHN" },
        tool: "generateSalesBrief" as const,
      },
    ];

    for (const { input, tool } of errorCases) {
      const result = buildToolErrorResult(tool, analysisInput.asOf, input);
      expect(result).toMatchObject({
        citations: [],
        evidenceSufficient: false,
        status: "error",
      });
      expect(aiToolResultSchema.safeParse(result).success).toBe(true);
      expect(clientAiToolResultSchema.safeParse(result).success).toBe(true);
    }
  });

  it("rejects fact, query, warning, and action drift in all error payloads", () => {
    const errors = [
      buildToolErrorResult("searchKnowledgeBase", analysisInput.asOf, {
        asOf: analysisInput.asOf,
        countryIso3: "CHN",
        query: "CHN emissions source",
      }),
      buildToolErrorResult("getCountryProfile", analysisInput.asOf, {
        asOf: analysisInput.asOf,
        countryIso3: "CHN",
        topics: ["country", "regulations"],
      }),
      buildToolErrorResult("findCompatibleProducts", analysisInput.asOf, {
        applicationScope: "non-road",
        asOf: analysisInput.asOf,
        countryIso3: "CHN",
        powerKw: 100,
      }),
      buildToolErrorResult("compareRegulations", analysisInput.asOf, {
        applicationScope: "non-road",
        asOf: analysisInput.asOf,
        countryIso3s: ["CHN", "BRA"],
        powerKw: 100,
      }),
      buildToolErrorResult("compareMarkets", analysisInput.asOf, {
        applicationScope: "non-road",
        countryIso3s: ["CHN", "BRA"],
        metricCodes: ["DEMO_ADDRESSABLE_UNITS"],
      }),
      buildToolErrorResult(
        "calculateOpportunityScore",
        analysisInput.asOf,
        analysisInput,
      ),
      buildToolErrorResult("generateSalesBrief", analysisInput.asOf, {
        ...analysisInput,
        targetCountryIso3: "CHN",
      }),
    ];
    const mutations = [
      (result: AiToolResult) => {
        if (result.tool !== "searchKnowledgeBase") throw new Error("search");
        result.search.filters.limit = 4;
      },
      (result: AiToolResult) => {
        if (result.tool !== "getCountryProfile") throw new Error("profile");
        result.requestedTopics.push(result.requestedTopics[0]!);
      },
      (result: AiToolResult) => {
        if (result.tool !== "findCompatibleProducts") throw new Error("fit");
        result.query.asOf = "2026-07-28";
      },
      (result: AiToolResult) => {
        if (result.tool !== "compareRegulations") throw new Error("regulation");
        result.comparison.missingData.push("FORGED_ERROR_FACT");
      },
      (result: AiToolResult) => {
        if (result.tool !== "compareMarkets") throw new Error("market");
        result.comparison.missingData.push("FORGED_ERROR_FACT");
      },
      (result: AiToolResult) => {
        if (result.tool !== "calculateOpportunityScore") throw new Error("score");
        result.scorecard.scores[0]!.overallScore = 99;
      },
      (result: AiToolResult) => {
        if (result.tool !== "generateSalesBrief") throw new Error("brief");
        result.brief.gaps = [];
      },
    ];

    errors.forEach((error, index) => {
      const drifted = structuredClone(error);
      mutations[index]!(drifted);
      expectBothSchemasToReject(drifted);

      const forgedWarning = structuredClone(error);
      forgedWarning.warnings.push("FORGED_ERROR_WARNING");
      expectBothSchemasToReject(forgedWarning);

      const forgedTopLevelFact = structuredClone(error);
      Reflect.set(forgedTopLevelFact, "facts", { claim: "FORGED" });
      expectBothSchemasToReject(forgedTopLevelFact);
    });
  });

  it("rejects invalid error inputs instead of inventing fallback queries", () => {
    expect(() =>
      buildToolErrorResult(
        "findCompatibleProducts",
        analysisInput.asOf,
        { countryIso3: "CHN" },
      ),
    ).toThrow();
    expect(() =>
      buildToolErrorResult("searchKnowledgeBase", analysisInput.asOf, {
        countryIso3: "CHN",
        query: "",
      }),
    ).toThrow();
    expect(() =>
      buildToolErrorResult("getCountryProfile", analysisInput.asOf, {
        countryIso3: "CHN",
        topics: ["country", "country"],
      }),
    ).toThrow();
  });

  it.each([
    {
      mutate: (result: AiToolResult) => {
        if (result.tool !== "compareRegulations") throw new Error("regulation");
        Reflect.set(result.comparison.query, "productModelCode", "FORGED");
      },
      name: "an extra product field in a regulation query",
      result: () => structuredClone(fixtures.regulations),
    },
    {
      mutate: (result: AiToolResult) => {
        if (result.tool !== "compareRegulations") throw new Error("regulation");
        result.comparison.query.countryIso3s = ["CHN", "CHN"];
      },
      name: "duplicate countries in a regulation query",
      result: () => structuredClone(fixtures.regulations),
    },
    {
      mutate: (result: AiToolResult) => {
        if (result.tool !== "compareMarkets") throw new Error("market");
        Reflect.set(result.comparison.query, "asOf", analysisInput.asOf);
      },
      name: "an extra date in a market query",
      result: () => structuredClone(fixtures.market),
    },
    {
      mutate: (result: AiToolResult) => {
        if (result.tool !== "compareMarkets") throw new Error("market");
        result.comparison.query.countryIso3s = ["CHN", "CHN"];
      },
      name: "duplicate countries in a market query",
      result: () => structuredClone(fixtures.market),
    },
    {
      mutate: (result: AiToolResult) => {
        if (result.tool !== "compareMarkets") throw new Error("market");
        result.comparison.query.metricCodes = [
          "DEMO_ADDRESSABLE_UNITS",
          "DEMO_ADDRESSABLE_UNITS",
        ];
      },
      name: "duplicate metric codes in a market query",
      result: () => structuredClone(fixtures.market),
    },
  ])("rejects $name at both result boundaries", ({ mutate, result }) => {
    const drifted = result();
    mutate(drifted);
    expectBothSchemasToReject(drifted);
  });

  it("rejects extra and duplicate comparison query fields in canonical errors", () => {
    const regulationErrors = [
      buildToolErrorResult("compareRegulations", analysisInput.asOf, {
        applicationScope: "non-road",
        asOf: analysisInput.asOf,
        countryIso3s: ["CHN", "BRA"],
        powerKw: 100,
      }),
      buildToolErrorResult("compareRegulations", analysisInput.asOf, {
        applicationScope: "non-road",
        asOf: analysisInput.asOf,
        countryIso3s: ["CHN", "BRA"],
        powerKw: 100,
      }),
    ].map((result) => {
      if (result.tool !== "compareRegulations") {
        throw new Error("Expected a regulation error result.");
      }
      return result;
    });
    Reflect.set(
      regulationErrors[0]!.comparison.query,
      "productModelCode",
      "FORGED",
    );
    regulationErrors[1]!.comparison.query.countryIso3s = ["CHN", "CHN"];

    const marketErrors = [
      buildToolErrorResult("compareMarkets", analysisInput.asOf, {
        applicationScope: "non-road",
        countryIso3s: ["CHN", "BRA"],
        metricCodes: ["DEMO_ADDRESSABLE_UNITS"],
      }),
      buildToolErrorResult("compareMarkets", analysisInput.asOf, {
        applicationScope: "non-road",
        countryIso3s: ["CHN", "BRA"],
        metricCodes: ["DEMO_ADDRESSABLE_UNITS"],
      }),
      buildToolErrorResult("compareMarkets", analysisInput.asOf, {
        applicationScope: "non-road",
        countryIso3s: ["CHN", "BRA"],
        metricCodes: ["DEMO_ADDRESSABLE_UNITS"],
      }),
    ].map((result) => {
      if (result.tool !== "compareMarkets") {
        throw new Error("Expected a market error result.");
      }
      return result;
    });
    Reflect.set(marketErrors[0]!.comparison.query, "asOf", analysisInput.asOf);
    marketErrors[1]!.comparison.query.countryIso3s = ["CHN", "CHN"];
    marketErrors[2]!.comparison.query.metricCodes = [
      "DEMO_ADDRESSABLE_UNITS",
      "DEMO_ADDRESSABLE_UNITS",
    ];

    for (const result of [...regulationErrors, ...marketErrors]) {
      expectBothSchemasToReject(result);
    }
  });

  it("does not ignore an extra failed envelope after sufficient evidence", () => {
    const contract: SalesChatEvidenceContract = {
      applicationScope: "non-road",
      asOf: analysisInput.asOf,
      blocksModelText: false,
      countryIso3s: ["CHN"],
      missingRequiredParameters: [],
      powerKw: 100,
      productModelCode: null,
      requirements: [
        {
          acceptedTools: ["findCompatibleProducts"],
          query: {
            applicationScope: "non-road",
            asOf: analysisInput.asOf,
            countryIso3s: ["CHN"],
            powerKw: 100,
            productModelCode: null,
          },
        },
      ],
      requiresRegulatoryDisclaimer: true,
      targetCountryIso3: "CHN",
    };
    const error = buildToolErrorResult(
      "findCompatibleProducts",
      analysisInput.asOf,
      {
        applicationScope: "non-road",
        asOf: analysisInput.asOf,
        countryIso3: "CHN",
        powerKw: 100,
      },
    );

    expect(evidenceContractAllowsModelText(contract, [fixtures.products])).toBe(
      true,
    );
    expect(
      evidenceContractAllowsModelText(contract, [fixtures.products, error]),
    ).toBe(false);
  });
});
