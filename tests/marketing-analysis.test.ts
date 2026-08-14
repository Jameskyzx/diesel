import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
  calculateProductReadiness,
  calculateRegulatoryCoverage,
  combineOpportunityScore,
  normalizeComparableMetric,
} from "@/domain/marketing/opportunity-score";
import { getOpportunityScoreWeights } from "@/server/config/opportunity-score-config";
import {
  buildCompatibleProductsResult,
  buildMarketComparisonResult,
  buildOpportunityScoreResult,
  buildRegulationComparisonResult,
} from "@/server/ai/tool-results";
import {
  calculateOpportunityScore,
  compareMarkets,
  compareRegulations,
  generateSalesBrief,
} from "@/server/services/marketing-analysis-service";
import { getDemoDatabase } from "@/server/db/demo-client";
import { marketMetrics } from "@/server/db/schema";
import { demoIds } from "@/server/db/seed/demo-data";
import { evaluateProductFit } from "@/server/services/product-fit-service";
import { clientAiToolResultSchema } from "@/features/ai/client-schemas";

const originalDatabaseMode = process.env.DATABASE_MODE;

beforeAll(() => {
  process.env.DATABASE_MODE = "pglite-demo";
});

afterAll(() => {
  if (originalDatabaseMode === undefined) {
    delete process.env.DATABASE_MODE;
  } else {
    process.env.DATABASE_MODE = originalDatabaseMode;
  }
});

describe("opportunity-score-v1 pure rules", () => {
  const weights = {
    marketPotential: 0.5,
    productReadiness: 0.3,
    regulatoryCoverage: 0.2,
  } as const;

  it("returns the same score breakdown for identical inputs", () => {
    const input = {
      components: [
        {
          explanation: "market",
          inputFacts: ["value=10"],
          key: "marketPotential" as const,
          score: 70,
        },
        {
          explanation: "product",
          inputFacts: ["fit=1"],
          key: "productReadiness" as const,
          score: 100,
        },
        {
          explanation: "regulation",
          inputFacts: ["pass=1"],
          key: "regulatoryCoverage" as const,
          score: 80,
        },
      ],
      countryIso3: "CHN",
      missingData: [],
      weights,
    };

    const first = combineOpportunityScore(input);
    const second = combineOpportunityScore(input);

    expect(first).toEqual(second);
    expect(first.overallScore).toBe(81);
    expect(
      first.components.map(
        ({ contribution, effectiveWeight, key, score }) => ({
          contribution,
          effectiveWeight,
          key,
          score,
        }),
      ),
    ).toEqual([
      {
        contribution: 35,
        effectiveWeight: 0.5,
        key: "marketPotential",
        score: 70,
      },
      {
        contribution: 30,
        effectiveWeight: 0.3,
        key: "productReadiness",
        score: 100,
      },
      {
        contribution: 16,
        effectiveWeight: 0.2,
        key: "regulatoryCoverage",
        score: 80,
      },
    ]);
  });

  it("excludes missing dimensions instead of silently assigning zero", () => {
    const result = combineOpportunityScore({
      components: [
        {
          explanation: "missing market",
          inputFacts: [],
          key: "marketPotential",
          score: null,
        },
        {
          explanation: "known product",
          inputFacts: ["fit=4", "not_fit=1"],
          key: "productReadiness",
          score: 80,
        },
        {
          explanation: "known regulation",
          inputFacts: ["pass=1"],
          key: "regulatoryCoverage",
          score: 100,
        },
      ],
      countryIso3: "DEU",
      missingData: ["market missing"],
      weights,
    });

    expect(result.overallScore).toBe(88);
    expect(result.dataCoveragePct).toBe(50);
    expect(result.components[0]).toMatchObject({
      contribution: null,
      effectiveWeight: 0,
      score: null,
      status: "missing",
    });
  });

  it("keeps unknown product and certification evidence out of zero scores", () => {
    expect(calculateProductReadiness(["fit", "unknown"])).toBe(100);
    expect(calculateProductReadiness(["unknown", "unknown"])).toBeNull();
    expect(
      calculateRegulatoryCoverage([
        { regulationId: "reg-1", status: "pass" },
        { regulationId: "reg-1", status: "unknown" },
        { regulationId: "reg-2", status: "unknown" },
      ]),
    ).toBe(100);
    expect(
      calculateRegulatoryCoverage([
        { regulationId: "reg-1", status: "unknown" },
      ]),
    ).toBeNull();
  });

  it("normalizes only within a comparable cohort", () => {
    const normalized = normalizeComparableMetric(
      [
        { countryIso3: "CHN", value: "12345.000000" },
        { countryIso3: "BRA", value: "6789.000000" },
      ],
      "higher_is_better",
    );

    expect(Object.fromEntries(normalized)).toEqual({
      BRA: 0,
      CHN: 100,
    });
    expect(
      normalizeComparableMetric(
        [{ countryIso3: "CHN", value: "12345.000000" }],
        "higher_is_better",
      ).size,
    ).toBe(0);
  });

  it("normalizes adjacent values above Number.MAX_SAFE_INTEGER exactly", () => {
    const normalized = normalizeComparableMetric(
      [
        { countryIso3: "CHN", value: "9007199254740993.000001" },
        { countryIso3: "BRA", value: "9007199254740993.000002" },
      ],
      "higher_is_better",
    );

    expect(Object.fromEntries(normalized)).toEqual({
      BRA: 100,
      CHN: 0,
    });
  });

  it("reads weights from validated server configuration", () => {
    expect(
      getOpportunityScoreWeights({
        OPPORTUNITY_SCORE_MARKET_WEIGHT: "0.4",
        OPPORTUNITY_SCORE_PRODUCT_WEIGHT: "0.4",
        OPPORTUNITY_SCORE_REGULATORY_WEIGHT: "0.2",
      }),
    ).toEqual({
      marketPotential: 0.4,
      productReadiness: 0.4,
      regulatoryCoverage: 0.2,
    });
    expect(() =>
      getOpportunityScoreWeights({
        OPPORTUNITY_SCORE_MARKET_WEIGHT: "0.4",
        OPPORTUNITY_SCORE_PRODUCT_WEIGHT: "0.4",
        OPPORTUNITY_SCORE_REGULATORY_WEIGHT: "0.4",
      }),
    ).toThrow();
  });
});

describe("marketing analysis service", () => {
  const input = {
    applicationScope: "non-road" as const,
    asOf: "2026-07-29",
    countryIso3s: ["CHN", "BRA"],
    metricCodes: ["DEMO_ADDRESSABLE_UNITS"],
    powerKw: 100,
  };

  it(
    "returns jurisdiction and membership evidence for regulation applicability",
    async () => {
      const comparison = await compareRegulations({
        applicationScope: input.applicationScope,
        asOf: input.asOf,
        countryIso3s: input.countryIso3s,
        powerKw: input.powerKw,
      });
      const chinaRegulation = comparison.countries
        .find(({ countryIso3 }) => countryIso3 === "CHN")
        ?.currentEffectiveRegulations.at(0);

      expect(chinaRegulation?.applicability).toMatchObject({
        countryIso3: "CHN",
        jurisdiction: {
          isDemo: true,
          source: { entityType: "jurisdiction", isDemo: true },
        },
        membership: {
          isDemo: true,
          source: { entityType: "country_jurisdiction", isDemo: true },
        },
      });
      expect(chinaRegulation?.limits).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            validFrom: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
            validTo: null,
          }),
        ]),
      );
      expect(chinaRegulation).toMatchObject({
        recordStatus: "effective",
        status: "effective",
      });
      expect(
        chinaRegulation?.limits.every(({ source, validFrom }) =>
          source.locator?.includes(validFrom),
        ),
      ).toBe(true);
      expect(
        comparison.sources
          .filter(({ entityType }) =>
            ["jurisdiction", "country_jurisdiction"].includes(entityType),
          )
          .map(({ countryIso3, entityType }) => `${countryIso3}:${entityType}`)
          .sort(),
      ).toEqual([
        "BRA:country_jurisdiction",
        "BRA:jurisdiction",
        "CHN:country_jurisdiction",
        "CHN:jurisdiction",
      ]);
    },
    30_000,
  );

  it("preserves historical record status from comparison service output", async () => {
    const comparison = await compareRegulations({
      applicationScope: "non-road",
      asOf: "2024-12-31",
      countryIso3s: ["CHN", "BRA"],
      powerKw: 100,
    });
    const historicalRegulation = comparison.countries
      .find(({ countryIso3 }) => countryIso3 === "CHN")
      ?.currentEffectiveRegulations.find(
        ({ id }) => id === demoIds.regulation.chinaSuperseded,
      );

    expect(historicalRegulation).toMatchObject({
      citationCode: "DEMO-CHN-NR-Z",
      recordStatus: "superseded",
      status: "effective",
    });
  });

  it("preserves historical record status through product-fit citations", async () => {
    const evaluation = await evaluateProductFit({
      applicationScope: "non-road",
      asOf: "2024-12-31",
      countryIso3: "CHN",
      powerKw: 100,
      productModelCode: "DEMO-ENG-100",
    });
    const historicalChecks = evaluation.regulationChecks.filter(
      ({ regulation }) =>
        regulation.regulationId === demoIds.regulation.chinaSuperseded,
    );

    expect(historicalChecks).not.toHaveLength(0);
    expect(
      historicalChecks.every(
        ({ regulation }) =>
          regulation.status === "effective" &&
          regulation.recordStatus === "superseded",
      ),
    ).toBe(true);

    const result = buildCompatibleProductsResult({
      applicationScope: "non-road",
      asOf: "2024-12-31",
      countryIso3: "CHN",
      evaluations: [evaluation],
      powerKw: 100,
      productModelCode: "DEMO-ENG-100",
    });
    const historicalCitations = result.citations.filter(
      ({ regulationId }) =>
        regulationId === demoIds.regulation.chinaSuperseded,
    );

    expect(historicalCitations).not.toHaveLength(0);
    expect(
      historicalCitations.every(
        ({ regulationStatus }) => regulationStatus === "superseded",
      ),
    ).toBe(true);
  });

  it("requires at least two countries with regulation evidence for an AI comparison", async () => {
    const comparison = await compareRegulations({
      applicationScope: input.applicationScope,
      asOf: input.asOf,
      countryIso3s: input.countryIso3s,
      powerKw: input.powerKw,
    });
    const completeResult = buildRegulationComparisonResult({
      comparison,
      informationAsOf: input.asOf,
    });
    const partialComparison = {
      ...comparison,
      countries: comparison.countries.map((country) =>
        country.countryIso3 === "BRA"
          ? {
              ...country,
              currentEffectiveRegulations: [],
              futureAdoptedRegulations: [],
              status: "no_data" as const,
            }
          : country,
      ),
      missingData: [
        ...comparison.missingData,
        "BRA 在所选范围、功率和日期下没有可比较法规记录。",
      ],
    };
    const partialResult = buildRegulationComparisonResult({
      comparison: partialComparison,
      informationAsOf: input.asOf,
    });

    expect(completeResult).toMatchObject({
      evidenceSufficient: true,
      status: "ok",
    });
    expect(partialResult).toMatchObject({
      evidenceSufficient: false,
      status: "no_data",
    });
  });

  it("accepts one exact country regulation query as sufficient evidence", async () => {
    const comparison = await compareRegulations({
      applicationScope: input.applicationScope,
      asOf: input.asOf,
      countryIso3s: ["CHN"],
      powerKw: input.powerKw,
    });
    const result = buildRegulationComparisonResult({
      comparison,
      informationAsOf: input.asOf,
    });

    expect(result).toMatchObject({ evidenceSufficient: true, status: "ok" });
    expect(clientAiToolResultSchema.safeParse(result).success).toBe(true);
  });

  it("prefers the market fact publication date in analysis sources", async () => {
    const database = await getDemoDatabase();
    await database
      .update(marketMetrics)
      .set({ publishedOn: "2026-02-01" })
      .where(eq(marketMetrics.id, demoIds.marketMetric.china));

    try {
      const comparison = await compareMarkets({
        applicationScope: input.applicationScope,
        countryIso3s: input.countryIso3s,
        metricCodes: input.metricCodes,
      });
      const chinaSource = comparison.sources.find(
        ({ entityId, entityType }) =>
          entityType === "market_metric" &&
          entityId === demoIds.marketMetric.china,
      );

      expect(chinaSource?.publishedOn).toBe("2026-02-01");
    } finally {
      await database
        .update(marketMetrics)
        .set({ publishedOn: "2026-01-04" })
        .where(eq(marketMetrics.id, demoIds.marketMetric.china));
    }
  });

  it("produces deterministic database-backed scores and preserves missing data", async () => {
    const first = await calculateOpportunityScore(input);
    const second = await calculateOpportunityScore(input);
    const china = first.scores.find(({ countryIso3 }) => countryIso3 === "CHN");
    const brazil = first.scores.find(({ countryIso3 }) => countryIso3 === "BRA");

    expect(first).toEqual(second);
    expect(china).toMatchObject({
      dataCoveragePct: 100,
      overallScore: 100,
    });
    expect(brazil).toMatchObject({
      dataCoveragePct: 50,
      overallScore: 0,
    });
    expect(
      brazil?.components.find(({ key }) => key === "productReadiness"),
    ).toMatchObject({
      contribution: null,
      score: null,
      status: "missing",
    });
    expect(brazil?.missingData.join(" ")).toContain("未按 0 计分");
    expect(first.sources.every(({ isDemo }) => isDemo)).toBe(true);
    expect(
      first.sources
        .filter(
          ({ entityId, entityType }) =>
            entityType === "product" && entityId === demoIds.product.certified,
        )
        .map(({ countryIso3 }) => countryIso3)
        .sort(),
    ).toEqual(["BRA", "CHN"]);
  });

  it("requires at least two scored countries before AI can describe a ranking", async () => {
    const scorecard = await calculateOpportunityScore(input);
    const completeResult = buildOpportunityScoreResult({
      informationAsOf: input.asOf,
      scorecard,
    });
    const partialResult = buildOpportunityScoreResult({
      informationAsOf: input.asOf,
      scorecard: {
        ...scorecard,
        scores: scorecard.scores.map((score) =>
          score.countryIso3 === "BRA"
            ? { ...score, overallScore: null }
            : score,
        ),
      },
    });

    expect(completeResult).toMatchObject({
      evidenceSufficient: true,
      status: "ok",
    });
    expect(partialResult).toMatchObject({
      evidenceSufficient: false,
      status: "no_data",
    });
  });

  it("keeps a named product scoped through opportunity scoring", async () => {
    const scorecard = await calculateOpportunityScore({
      ...input,
      productModelCode: "demo-eng-200",
    });

    expect(scorecard.query.productModelCode).toBe("DEMO-ENG-200");
    for (const score of scorecard.scores) {
      const readiness = score.components.find(
        ({ key }) => key === "productReadiness",
      );
      expect(readiness?.inputFacts).toEqual([
        "fit=0",
        "not_fit=0",
        "unknown=1",
      ]);
    }
  });

  it("returns the required structured sales-brief JSON fields", async () => {
    const brief = await generateSalesBrief({
      ...input,
      targetCountryIso3: "CHN",
    });

    expect(Object.keys(brief).sort()).toEqual([
      "executiveSummary",
      "marketScore",
      "missingData",
      "opportunities",
      "query",
      "recommendedProducts",
      "risks",
      "salesActions",
      "sources",
    ]);
    expect(brief.marketScore.overallScore).toBe(100);
    expect(brief.query).toMatchObject({
      applicationScope: "non-road",
      countryIso3s: ["CHN", "BRA"],
      powerKw: 100,
      targetCountryIso3: "CHN",
    });
    expect(brief.recommendedProducts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          availableFrom: "2025-01-01",
          availableTo: null,
          modelCode: "DEMO-ENG-100",
          status: "fit",
        }),
      ]),
    );
    expect(
      brief.sources.find(
        ({ entityId, entityType }) =>
          entityType === "product" && entityId === demoIds.product.certified,
      )?.locator,
    ).toContain("availability 2025-01-01–open");
    expect(brief.risks.map(({ title }) => title)).toContain(
      "未来已通过法规",
    );
    expect(brief.salesActions.every(({ kind }) => kind === "rule_generated")).toBe(
      true,
    );
  });

  it("keeps a named product scoped through the sales brief", async () => {
    const brief = await generateSalesBrief({
      ...input,
      productModelCode: "demo-eng-200",
      targetCountryIso3: "CHN",
    });

    expect(brief.query.productModelCode).toBe("DEMO-ENG-200");
    expect(brief.recommendedProducts).toEqual([]);
    expect(brief.risks.map(({ title }) => title)).toContain("产品证据缺口");
  });

  it("rejects matching metric codes whose definitions differ", async () => {
    const database = await getDemoDatabase();
    const originalDefinition =
      "FICTIONAL DEMO DATA — NOT A REAL REGULATION, CERTIFICATION, OR MARKET SOURCE. Fictional annual addressable unit count.";

    await database
      .update(marketMetrics)
      .set({ definition: "DEMO ONLY — A materially different metric definition." })
      .where(eq(marketMetrics.id, demoIds.marketMetric.brazil));

    try {
      const comparison = await compareMarkets({
        applicationScope: "non-road",
        countryIso3s: ["CHN", "BRA"],
        metricCodes: ["DEMO_ADDRESSABLE_UNITS"],
      });

      expect(comparison.metrics[0]).toMatchObject({
        comparisonStatus: "incomparable",
        issues: expect.arrayContaining(["DEFINITION_MISMATCH"]),
      });
      expect(
        buildMarketComparisonResult({
          comparison,
          informationAsOf: "2026-07-29",
        }),
      ).toMatchObject({
        evidenceSufficient: false,
        status: "no_data",
      });
    } finally {
      await database
        .update(marketMetrics)
        .set({ definition: originalDefinition })
        .where(eq(marketMetrics.id, demoIds.marketMetric.brazil));
    }
  });

  it("marks a market comparison sufficient only when a metric is comparable", async () => {
    const comparison = await compareMarkets({
      applicationScope: "non-road",
      countryIso3s: ["CHN", "BRA"],
      metricCodes: ["DEMO_ADDRESSABLE_UNITS"],
    });

    expect(
      buildMarketComparisonResult({
        comparison,
        informationAsOf: "2026-07-29",
      }),
    ).toMatchObject({
      evidenceSufficient: true,
      status: "ok",
    });
  });

  it("returns sources only for observations used in the comparison", async () => {
    const database = await getDemoDatabase();
    const historicalMetricId = "00000000-0000-4000-8000-000000000799";

    await database.insert(marketMetrics).values({
      applicationScope: "non-road",
      countryIso3: "BRA",
      dataSourceId: demoIds.source.market,
      definition:
        "FICTIONAL DEMO DATA — NOT A REAL REGULATION, CERTIFICATION, OR MARKET SOURCE. Fictional annual addressable unit count.",
      id: historicalMetricId,
      isDemo: true,
      methodologyVersion: "demo-v1",
      metricCode: "DEMO_ADDRESSABLE_UNITS",
      metricName: "DEMO ONLY — Fictional addressable units",
      periodEnd: "2025-01-01",
      periodStart: "2024-01-01",
      publishedOn: "2025-01-04",
      unitCode: "units",
      valueNumeric: "6000.000000",
      verifiedAt: new Date("2026-01-15T00:00:00.000Z"),
    });

    try {
      const comparison = await compareMarkets({
        applicationScope: "non-road",
        countryIso3s: ["CHN", "BRA"],
        metricCodes: ["DEMO_ADDRESSABLE_UNITS"],
      });

      expect(
        comparison.metrics[0]?.observations.map(({ id }) => id),
      ).not.toContain(historicalMetricId);
      expect(comparison.sources.map(({ entityId }) => entityId)).not.toContain(
        historicalMetricId,
      );
    } finally {
      await database
        .delete(marketMetrics)
        .where(eq(marketMetrics.id, historicalMetricId));
    }
  });
});
