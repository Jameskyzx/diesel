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
  buildCountryProfileResult,
  buildKnowledgeResult,
  buildMarketComparisonResult,
  buildOpportunityScoreResult,
  buildRegulationComparisonResult,
  buildSalesBriefResult,
  buildToolErrorResult,
} from "@/server/ai/tool-results";
import {
  awaitRegulationComparisonReads,
  calculateOpportunityScore,
  compareMarkets,
  compareRegulations,
  generateSalesBrief,
  productAnalysisSources,
} from "@/server/services/marketing-analysis-service";
import { getCountryDetails } from "@/server/services/country-service";
import { hybridSearchKnowledge } from "@/server/services/knowledge-service";
import { getDemoDatabase } from "@/server/db/demo-client";
import {
  marketMetrics,
  productCertifications,
  products,
} from "@/server/db/schema";
import { demoIds } from "@/server/db/seed/demo-data";
import { evaluateProductFit } from "@/server/services/product-fit-service";
import { clientAiToolResultSchema } from "@/features/ai/client-schemas";
import { aiEvidenceCitationsMatchFacts } from "@/features/ai/evidence-semantics";
import { aiToolResultSchema } from "@/features/ai/schemas";
import {
  opportunityScoreModelToolOutputSchema,
  opportunityScoreResultToModelOutput,
  SALES_CHAT_MODEL_TOOL_OUTPUT_MAX_UTF8_BYTES,
  SALES_CHAT_MODEL_TOOL_OUTPUT_VERSION,
  salesBriefModelToolOutputSchema,
  salesBriefResultToModelOutput,
} from "@/features/ai/model-tool-output";
import {
  marketComparisonSchema,
  regulationComparisonSchema,
} from "@/features/marketing/schemas";

const originalDatabaseMode = process.env.DATABASE_MODE;

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

beforeAll(async () => {
  process.env.DATABASE_MODE = "pglite-demo";
  // Fixture initialization includes WASM startup, migrations, and seeding.
  // Keep it in setup, not in the first seven-tool contract test's 5s budget.
  await getDemoDatabase();
});

afterAll(() => {
  if (originalDatabaseMode === undefined) {
    delete process.env.DATABASE_MODE;
  } else {
    process.env.DATABASE_MODE = originalDatabaseMode;
  }
});

describe("opportunity-score-v2 pure rules", () => {
  const weights = {
    marketPotential: 0.5,
    productReadiness: 0.3,
    regulatoryCoverage: 0.2,
  } as const;

  it("returns the same score breakdown for identical inputs", () => {
    const input = {
      components: [
        {
          key: "marketPotential" as const,
          score: 70,
        },
        {
          key: "productReadiness" as const,
          score: 100,
        },
        {
          key: "regulatoryCoverage" as const,
          score: 80,
        },
      ],
      countryIso3: "CHN",
      gaps: [],
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
          key: "marketPotential",
          score: null,
        },
        {
          key: "productReadiness",
          score: 80,
        },
        {
          key: "regulatoryCoverage",
          score: 100,
        },
      ],
      countryIso3: "DEU",
      gaps: [{ code: "MARKET_DATA_UNAVAILABLE" }],
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
    expect(calculateProductReadiness(["ready", "unknown"])).toBe(100);
    expect(calculateProductReadiness(["ready", "not_ready"])).toBe(50);
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
  it("waits for pending SQL siblings after an early comparison read failure", async () => {
    const earlyFailure = new Error("early country read failed");
    const pendingCountry = createDeferred<string>();
    const pendingRegulations = createDeferred<readonly string[]>();
    let settled = false;
    const operation = awaitRegulationComparisonReads({
      countryReads: [Promise.reject(earlyFailure), pendingCountry.promise],
      regulationRead: pendingRegulations.promise,
    });
    void operation.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await Promise.resolve();
    expect(settled).toBe(false);
    pendingCountry.resolve("CHN");
    await Promise.resolve();
    expect(settled).toBe(false);
    pendingRegulations.resolve([]);

    await expect(operation).rejects.toBe(earlyFailure);
    expect(settled).toBe(true);
  });

  it("propagates settled comparison failures in stable query order", async () => {
    const countryFailure = new Error("country read failed");
    const regulationFailure = new Error("regulation read failed first");
    const pendingCountry = createDeferred<string>();
    const operation = awaitRegulationComparisonReads({
      countryReads: [pendingCountry.promise],
      regulationRead: Promise.reject(regulationFailure),
    });
    let settled = false;
    void operation.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await Promise.resolve();
    expect(settled).toBe(false);
    pendingCountry.reject(countryFailure);

    await expect(operation).rejects.toBe(countryFailure);
  });

  const input = {
    applicationScope: "non-road" as const,
    asOf: "2026-07-29",
    countryIso3s: ["CHN", "BRA"],
    metricCodes: ["DEMO_ADDRESSABLE_UNITS"],
    powerKw: 100,
  };

  it("recomputes evidence sufficiency for all seven tool result schemas", async () => {
    const productQuery = {
      applicationScope: input.applicationScope,
      asOf: input.asOf,
      countryIso3: "CHN",
      powerKw: input.powerKw,
      productModelCode: "DEMO-ENG-100",
    } as const;
    const [
      regulationComparison,
      marketComparison,
      scorecard,
      brief,
      profile,
      productEvaluation,
      search,
    ] = await Promise.all([
      compareRegulations({
        applicationScope: input.applicationScope,
        asOf: input.asOf,
        countryIso3s: input.countryIso3s,
        powerKw: input.powerKw,
      }),
      compareMarkets({
        applicationScope: input.applicationScope,
        countryIso3s: input.countryIso3s,
        metricCodes: input.metricCodes,
      }),
      calculateOpportunityScore(input),
      generateSalesBrief({ ...input, targetCountryIso3: "CHN" }),
      getCountryDetails({ asOf: input.asOf, iso3: "CHN" }),
      evaluateProductFit(productQuery),
      hybridSearchKnowledge({
        applicationScope: input.applicationScope,
        asOf: input.asOf,
        countryIso3: "CHN",
        jurisdictionId: null,
        limit: 5,
        query: "CHN 非道路排放法规原文章节来源证据",
      }),
    ]);
    const knowledgeResult = buildKnowledgeResult({
        informationAsOf: input.asOf,
        resolvedCountryIso3: "CHN",
        search,
      });
    const profileResult = buildCountryProfileResult({
        informationAsOf: input.asOf,
        profile,
        requestedTopics: ["country"],
        resolvedCountryIso3: "CHN",
      });
    const productResult = buildCompatibleProductsResult({
        applicationScope: input.applicationScope,
        asOf: input.asOf,
        countryIso3: "CHN",
        evaluations: [productEvaluation],
        powerKw: input.powerKw,
        productModelCode: productQuery.productModelCode,
      });
    const regulationResult = buildRegulationComparisonResult({
      comparison: regulationComparison,
      informationAsOf: input.asOf,
    });
    const marketResult = buildMarketComparisonResult({
      comparison: marketComparison,
      informationAsOf: input.asOf,
    });
    const scoreResult = buildOpportunityScoreResult({
      informationAsOf: input.asOf,
      scorecard,
    });
    const briefResult = buildSalesBriefResult({
      brief,
      informationAsOf: input.asOf,
    });
    const results = [
      knowledgeResult,
      profileResult,
      productResult,
      regulationResult,
      marketResult,
      scoreResult,
      briefResult,
    ];

    for (const result of results) {
      expect(result).toMatchObject({
        evidenceSufficient: true,
        status: "ok",
      });
      expect(aiToolResultSchema.safeParse(result).success).toBe(true);
      expect(clientAiToolResultSchema.safeParse(result).success).toBe(true);

      const forgedClaim = {
        ...result,
        evidenceSufficient: false,
        status: "no_data" as const,
      };
      expect(aiToolResultSchema.safeParse(forgedClaim).success).toBe(false);
      expect(clientAiToolResultSchema.safeParse(forgedClaim).success).toBe(
        false,
      );
    }

    if (profileResult.profile?.status !== "available") {
      throw new Error("Expected an available country-profile fixture.");
    }
    const profileCountry = profileResult.profile.country;
    const currentRegulation =
      profileCountry.currentEffectiveRegulations.at(0);
    if (!currentRegulation) {
      throw new Error("Expected a current regulation in the profile fixture.");
    }
    expect(profileResult.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("Demo")]),
    );
    expect(profileResult.latestVerifiedAt).toBe(
      profileResult.citations
        .map(({ verifiedAt }) => verifiedAt)
        .toSorted()
        .at(-1),
    );
    const marketCitation = profileResult.citations.find(
      ({ entityType }) => entityType === "market_metric",
    );
    if (!marketCitation) {
      throw new Error("Expected a profile market citation fixture.");
    }
    const scopedProfile = await getCountryDetails({
      applicationScope: input.applicationScope,
      asOf: input.asOf,
      iso3: "CHN",
      powerKw: input.powerKw,
    });
    const scopedProfileResult = buildCountryProfileResult({
      informationAsOf: input.asOf,
      profile: scopedProfile,
      requestedTopics: ["country"],
      resolvedCountryIso3: "CHN",
    });
    const profileLimitCitation = scopedProfileResult.citations.find(
      ({ entityType }) => entityType === "regulation_limit",
    );
    if (!profileLimitCitation) {
      throw new Error("Expected a scoped profile limit citation fixture.");
    }
    const firstRecommendedProduct = briefResult.brief.recommendedProducts[0];
    if (!firstRecommendedProduct) {
      throw new Error("Expected a recommended product fixture.");
    }
    const crossProductCertificationResult = structuredClone(productResult);
    const crossProductCertification =
      crossProductCertificationResult.evaluations[0]?.regulationChecks[0]
        ?.certifications[0]?.certification;
    if (!crossProductCertification) {
      throw new Error("Expected product certification evidence fixture.");
    }
    crossProductCertification.productId =
      "00000000-0000-4000-8000-000000009905";
    expect(
      aiEvidenceCitationsMatchFacts(crossProductCertificationResult),
    ).toBe(false);

    const productInputDrifts = [
      { field: "asOf", value: "2026-07-30" },
      { field: "inputAsOf", value: "2026-07-30" },
      { field: "applicationScope", value: "marine" },
      { field: "countryIso3", value: "BRA" },
      { field: "powerKw", value: 101 },
      { field: "productModelCode", value: "OTHER-MODEL" },
    ] as const;
    const identityDrifts: Array<{ label: string; result: unknown }> = [
      {
        label: "unpaired citation entity identity",
        result: {
          ...knowledgeResult,
          citations: knowledgeResult.citations.map((citation, index) =>
            index === 0
              ? { ...citation, entityType: "product" as const }
              : citation,
          ),
        },
      },
      {
        label: "knowledge fact borrowed product citation",
        result: {
          ...knowledgeResult,
          citations: knowledgeResult.citations.map((citation, index) =>
            index === 0 ? productResult.citations[0]! : citation,
          ),
        },
      },
      {
        label: "resolved profile country",
        result: { ...profileResult, resolvedCountryIso3: "BRA" },
      },
      {
        label: "profile query date",
        result: {
          ...profileResult,
          profile: { ...profileResult.profile, asOf: "2026-07-30" },
        },
      },
      {
        label: "profile applicability country",
        result: {
          ...profileResult,
          profile: {
            ...profileResult.profile,
            country: {
              ...profileCountry,
              currentEffectiveRegulations: [
                {
                  ...currentRegulation,
                  applicability: {
                    ...currentRegulation.applicability,
                    countryIso3: "BRA",
                  },
                },
                ...profileCountry.currentEffectiveRegulations.slice(1),
              ],
            },
          },
        },
      },
      {
        label: "country-only profile missing visible market citation",
        result: {
          ...profileResult,
          citations: profileResult.citations.filter(
            (citation) => citation !== marketCitation,
          ),
        },
      },
      {
        label: "country-only profile missing visible limit citation",
        result: {
          ...scopedProfileResult,
          citations: scopedProfileResult.citations.filter(
            (citation) => citation !== profileLimitCitation,
          ),
        },
      },
      {
        label: "product result date envelope",
        result: { ...productResult, informationAsOf: "2026-07-30" },
      },
      {
        label: "product identity",
        result: {
          ...productResult,
          evaluations: productResult.evaluations.map((evaluation) => ({
            ...evaluation,
            product: evaluation.product
              ? { ...evaluation.product, modelCode: "OTHER-MODEL" }
              : null,
          })),
        },
      },
      {
        label: "cross-product certification ownership",
        result: crossProductCertificationResult,
      },
      {
        label: "product availability citation",
        result: {
          ...productResult,
          citations: productResult.citations.map((citation) =>
            citation.entityType === "product"
              ? {
                  ...citation,
                  locatorDescriptor: {
                    availableFrom: "2026-08-01",
                    availableTo: "2030-01-01",
                    kind: "product_availability" as const,
                    modelCode: productQuery.productModelCode,
                    specificationVersion: "other-specification",
                  },
                }
              : citation,
          ),
        },
      },
      {
        label: "regulation country name citation",
        result: {
          ...regulationResult,
          comparison: {
            ...regulationResult.comparison,
            countries: regulationResult.comparison.countries.map(
              (country, index) =>
                index === 0
                  ? { ...country, countryName: "Drifted country name" }
                  : country,
            ),
          },
        },
      },
      {
        label: "regulation country source citation",
        result: {
          ...regulationResult,
          comparison: {
            ...regulationResult.comparison,
            countries: regulationResult.comparison.countries.map(
              (country, index) =>
                index === 0 && country.countrySource
                  ? {
                      ...country,
                      countrySource: {
                        ...country.countrySource,
                        id: "00000000-0000-4000-8000-000000009904",
                      },
                    }
                  : country,
            ),
          },
        },
      },
      {
        label: "market observation identity citation",
        result: {
          ...marketResult,
          citations: marketResult.citations.map((citation, index) =>
            index === 0 ? productResult.citations[0]! : citation,
          ),
        },
      },
      {
        label: "score source citation",
        result: {
          ...scoreResult,
          citations: scoreResult.citations.map((citation, index) =>
            index === 0 ? productResult.citations[0]! : citation,
          ),
        },
      },
      {
        label: "brief recommended product identity",
        result: {
          ...briefResult,
          brief: {
            ...briefResult.brief,
            recommendedProducts: [
              {
                ...firstRecommendedProduct,
                id: "00000000-0000-4000-8000-000000009901",
              },
              ...briefResult.brief.recommendedProducts.slice(1),
            ],
          },
        },
      },
      {
        label: "brief recommended certification identity",
        result: {
          ...briefResult,
          brief: {
            ...briefResult.brief,
            recommendedProducts: [
              {
                ...firstRecommendedProduct,
                certifications: firstRecommendedProduct.certifications.map(
                  (certification, index) =>
                    index === 0
                      ? {
                          ...certification,
                          id: "00000000-0000-4000-8000-000000009902",
                        }
                      : certification,
                ),
              },
              ...briefResult.brief.recommendedProducts.slice(1),
            ],
          },
        },
      },
      {
        label: "brief recommended regulation identity",
        result: {
          ...briefResult,
          brief: {
            ...briefResult.brief,
            recommendedProducts: [
              {
                ...firstRecommendedProduct,
                certifications: firstRecommendedProduct.certifications.map(
                  (certification, index) =>
                    index === 0
                      ? {
                          ...certification,
                          regulationId:
                            "00000000-0000-4000-8000-000000009903",
                        }
                      : certification,
                ),
              },
              ...briefResult.brief.recommendedProducts.slice(1),
            ],
          },
        },
      },
      {
        label: "exact product result count",
        result: { ...productResult, evaluations: [] },
      },
      ...productInputDrifts.map(({ field, value }) => ({
        label: `product evaluation ${field}`,
        result: {
          ...productResult,
          evaluations: productResult.evaluations.map((evaluation) => ({
            ...evaluation,
            ...(field === "asOf" ? { asOf: value } : {}),
            input: {
              ...evaluation.input,
              ...(field === "inputAsOf"
                ? { asOf: value }
                : field === "asOf"
                  ? {}
                  : { [field]: value }),
            },
          })),
        },
      })),
    ];

    for (const { label, result } of identityDrifts) {
      expect(aiToolResultSchema.safeParse(result).success, label).toBe(false);
      expect(
        clientAiToolResultSchema.safeParse(result).success,
        label,
      ).toBe(false);
    }
  });

  it("rejects nested regulation and market source-identity drift at every schema boundary", async () => {
    const regulationComparison = await compareRegulations({
      applicationScope: input.applicationScope,
      asOf: input.asOf,
      countryIso3s: input.countryIso3s,
      powerKw: input.powerKw,
    });
    const marketComparison = await compareMarkets({
      applicationScope: input.applicationScope,
      countryIso3s: input.countryIso3s,
      metricCodes: input.metricCodes,
    });
    const regulationResult = buildRegulationComparisonResult({
      comparison: regulationComparison,
      informationAsOf: input.asOf,
    });
    const marketResult = buildMarketComparisonResult({
      comparison: marketComparison,
      informationAsOf: input.asOf,
    });
    const regulationMutations: Array<{
      label: string;
      mutate: (comparison: typeof regulationComparison) => void;
    }> = [
      {
        label: "applicability country",
        mutate: (comparison) => {
          const regulation =
            comparison.countries[0]?.currentEffectiveRegulations[0];
          if (!regulation) throw new Error("Missing regulation fixture.");
          regulation.applicability.countryIso3 = "BRA";
        },
      },
      {
        label: "regulation entity",
        mutate: (comparison) => {
          const regulation =
            comparison.countries[0]?.currentEffectiveRegulations[0];
          if (!regulation) throw new Error("Missing regulation fixture.");
          regulation.source.entityId =
            "00000000-0000-4000-8000-000000009911";
        },
      },
      {
        label: "borrowed nested source",
        mutate: (comparison) => {
          const regulation =
            comparison.countries[0]?.currentEffectiveRegulations[0];
          const borrowed = marketComparison.sources[0];
          if (!regulation || !borrowed) {
            throw new Error("Missing source fixture.");
          }
          regulation.source.sourceId = borrowed.sourceId;
        },
      },
      {
        label: "limit source",
        mutate: (comparison) => {
          const regulation =
            comparison.countries[0]?.currentEffectiveRegulations[0];
          const limit = regulation?.limits[0];
          if (!limit) throw new Error("Missing limit fixture.");
          limit.source.sourceId =
            "00000000-0000-4000-8000-000000009912";
        },
      },
      {
        label: "reordered regulation limits",
        mutate: (comparison) => {
          const regulation = comparison.countries
            .flatMap(({ currentEffectiveRegulations }) =>
              currentEffectiveRegulations,
            )
            .find(({ limits }) => limits.length > 1);
          if (!regulation) throw new Error("Missing multi-limit fixture.");
          regulation.limits.reverse();
        },
      },
      {
        label: "top-level source coverage",
        mutate: (comparison) => {
          const regulation =
            comparison.countries[0]?.currentEffectiveRegulations[0];
          if (!regulation) throw new Error("Missing regulation fixture.");
          comparison.sources = comparison.sources.filter(
            (source) =>
              !(
                source.countryIso3 === regulation.source.countryIso3 &&
                source.entityId === regulation.source.entityId &&
                source.entityType === regulation.source.entityType &&
                source.regulationId === regulation.source.regulationId &&
                source.sourceId === regulation.source.sourceId
              ),
          );
        },
      },
      {
        label: "duplicate top-level source",
        mutate: (comparison) => {
          comparison.sources.push(structuredClone(comparison.sources[0]!));
        },
      },
    ];

    for (const { label, mutate } of regulationMutations) {
      const comparison = structuredClone(regulationComparison);
      mutate(comparison);
      expect(
        regulationComparisonSchema.safeParse(comparison).success,
        label,
      ).toBe(false);
      expect(() =>
        buildRegulationComparisonResult({
          comparison,
          informationAsOf: input.asOf,
        }),
      ).toThrow();
      const result = { ...regulationResult, comparison };
      expect(aiToolResultSchema.safeParse(result).success, label).toBe(false);
      expect(
        clientAiToolResultSchema.safeParse(result).success,
        label,
      ).toBe(false);
    }

    const marketMutations: Array<{
      label: string;
      mutate: (comparison: typeof marketComparison) => void;
    }> = [
      {
        label: "observation country",
        mutate: (comparison) => {
          const observation = comparison.metrics[0]?.observations[0];
          if (!observation) throw new Error("Missing market fixture.");
          observation.countryIso3 = "MEX";
        },
      },
      {
        label: "observation metric",
        mutate: (comparison) => {
          const observation = comparison.metrics[0]?.observations[0];
          if (!observation) throw new Error("Missing market fixture.");
          observation.metricCode = "DRIFTED_METRIC";
        },
      },
      {
        label: "observation entity",
        mutate: (comparison) => {
          const observation = comparison.metrics[0]?.observations[0];
          if (!observation) throw new Error("Missing market fixture.");
          observation.id = "00000000-0000-4000-8000-000000009913";
        },
      },
      {
        label: "observation source",
        mutate: (comparison) => {
          const observation = comparison.metrics[0]?.observations[0];
          const borrowed = regulationComparison.sources[0];
          if (!observation || !borrowed) {
            throw new Error("Missing source fixture.");
          }
          observation.source.sourceId = borrowed.sourceId;
        },
      },
      {
        label: "reordered market observations",
        mutate: (comparison) => {
          const metric = comparison.metrics.find(
            ({ observations }) => observations.length > 1,
          );
          if (!metric) throw new Error("Missing multi-country metric fixture.");
          metric.observations.reverse();
        },
      },
      {
        label: "top-level market source coverage",
        mutate: (comparison) => {
          const observation = comparison.metrics[0]?.observations[0];
          if (!observation) throw new Error("Missing market fixture.");
          comparison.sources = comparison.sources.filter(
            (source) =>
              !(
                source.countryIso3 === observation.source.countryIso3 &&
                source.entityId === observation.source.entityId &&
                source.sourceId === observation.source.sourceId
              ),
          );
        },
      },
      {
        label: "duplicate top-level market source",
        mutate: (comparison) => {
          comparison.sources.push(structuredClone(comparison.sources[0]!));
        },
      },
    ];

    for (const { label, mutate } of marketMutations) {
      const comparison = structuredClone(marketComparison);
      mutate(comparison);
      expect(
        marketComparisonSchema.safeParse(comparison).success,
        label,
      ).toBe(false);
      expect(() =>
        buildMarketComparisonResult({
          comparison,
          informationAsOf: input.asOf,
        }),
      ).toThrow();
      const result = { ...marketResult, comparison };
      expect(aiToolResultSchema.safeParse(result).success, label).toBe(false);
      expect(
        clientAiToolResultSchema.safeParse(result).success,
        label,
      ).toBe(false);
    }
  });

  it("fails closed when derived facts have no traceable analysis source", async () => {
    const regulationComparison = await compareRegulations({
      applicationScope: input.applicationScope,
      asOf: input.asOf,
      countryIso3s: input.countryIso3s,
      powerKw: input.powerKw,
    });
    const marketComparison = await compareMarkets({
      applicationScope: input.applicationScope,
      countryIso3s: input.countryIso3s,
      metricCodes: input.metricCodes,
    });
    const scorecard = await calculateOpportunityScore(input);
    const brief = await generateSalesBrief({
      ...input,
      targetCountryIso3: "CHN",
    });

    const builders = [
      () =>
        buildRegulationComparisonResult({
          comparison: { ...regulationComparison, sources: [] },
          informationAsOf: input.asOf,
        }),
      () =>
        buildMarketComparisonResult({
          comparison: { ...marketComparison, sources: [] },
          informationAsOf: input.asOf,
        }),
      () =>
        buildOpportunityScoreResult({
          informationAsOf: input.asOf,
          scorecard: { ...scorecard, sources: [] },
        }),
      () =>
        buildSalesBriefResult({
          brief: { ...brief, sources: [] },
          informationAsOf: input.asOf,
        }),
    ];

    for (const build of builders) {
      expect(build).toThrow();
    }
  });

  it(
    "returns jurisdiction and membership evidence for regulation applicability",
    async () => {
      const comparison = await compareRegulations({
        applicationScope: input.applicationScope,
        asOf: input.asOf,
        countryIso3s: input.countryIso3s,
        powerKw: input.powerKw,
      });
      const china = comparison.countries.find(
        ({ countryIso3 }) => countryIso3 === "CHN",
      );
      const chinaRegulation = china?.currentEffectiveRegulations.at(0);

      expect(china).toMatchObject({
        countryIsDemo: true,
        countrySource: {
          id: "00000000-0000-4000-8000-000000000001",
          isDemo: true,
          title: "DEMO ONLY — Fictional country metadata source",
        },
      });

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
      expect(chinaRegulation?.limits[0]?.source.locatorDescriptor).toEqual({
        kind: "regulation_limit_period",
        pollutantCode: chinaRegulation?.limits[0]?.pollutantCode,
        validFrom: chinaRegulation?.limits[0]?.validFrom,
        validTo: chinaRegulation?.limits[0]?.validTo,
      });
      expect(chinaRegulation?.limits[0]?.source.titleDescriptor).toEqual({
        kind: "regulation_pollutant_limit",
        pollutantCode: chinaRegulation?.limits[0]?.pollutantCode,
        regulationName: chinaRegulation?.canonicalName,
      });
      expect(
        chinaRegulation?.applicability.membership.source.locatorDescriptor,
      ).toEqual({
        kind: "membership_period",
        validFrom: chinaRegulation?.applicability.membership.validFrom,
        validTo: chinaRegulation?.applicability.membership.validTo,
      });
      expect(
        chinaRegulation?.applicability.membership.source.titleDescriptor,
      ).toEqual({
        countryIso3: "CHN",
        jurisdictionName: chinaRegulation?.applicability.jurisdiction.name,
        kind: "country_jurisdiction_membership",
      });
      const applicabilitySources = comparison.sources.filter(
        ({ entityType }) =>
          ["jurisdiction", "country_jurisdiction"].includes(entityType),
      );
      expect(
        applicabilitySources
          .map(({ countryIso3, entityType }) => `${countryIso3}:${entityType}`)
          .sort(),
      ).toEqual([
        "BRA:country_jurisdiction",
        "BRA:jurisdiction",
        "CHN:country_jurisdiction",
        "CHN:country_jurisdiction",
        "CHN:jurisdiction",
        "CHN:jurisdiction",
      ]);
      expect(
        new Set(
          applicabilitySources.map(
            ({ countryIso3, entityId, entityType, regulationId, sourceId }) =>
              `${countryIso3}:${entityType}:${entityId}:${regulationId}:${sourceId}`,
          ),
        ).size,
      ).toBe(applicabilitySources.length);
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

  it("inherits certification source status from its parent regulation", async () => {
    const evaluation = await evaluateProductFit({
      applicationScope: "non-road",
      asOf: input.asOf,
      countryIso3: "CHN",
      powerKw: input.powerKw,
      productModelCode: "DEMO-ENG-100",
    });
    const historicalEvaluation = structuredClone(evaluation);
    const certifiedCheck = historicalEvaluation.regulationChecks.find(
      ({ certifications }) => certifications.length > 0,
    );
    const certification = certifiedCheck?.certifications[0]?.certification;
    if (!certifiedCheck || !certification) {
      throw new Error("Expected a certified regulation fixture.");
    }
    certifiedCheck.regulation.recordStatus = "superseded";

    const certificationSource = productAnalysisSources("CHN", [
      historicalEvaluation,
    ]).find(
      ({ entityId, entityType }) =>
        entityType === "product_certification" &&
        entityId === certification.id,
    );

    expect(certificationSource?.regulationStatus).toBe("superseded");
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
      sources: comparison.sources.filter(
        ({ countryIso3 }) => countryIso3 !== "BRA",
      ),
    };
    const partialResult = buildRegulationComparisonResult({
      comparison: partialComparison,
      informationAsOf: input.asOf,
    });

    expect(completeResult).toMatchObject({
      evidenceSufficient: true,
      status: "ok",
    });
    const membershipSource = comparison.sources.find(
      ({ countryIso3, entityType }) =>
        countryIso3 === "CHN" && entityType === "country_jurisdiction",
    );
    expect(
      completeResult.citations.find(
        ({ countryIso3, sourceId, title }) =>
          countryIso3 === membershipSource?.countryIso3 &&
          sourceId === membershipSource?.sourceId &&
          title === membershipSource?.title,
      )?.titleDescriptor,
    ).toEqual(membershipSource?.titleDescriptor);
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
      expect(chinaSource?.locatorDescriptor).toMatchObject({
        kind: "market_period",
      });
      expect(chinaSource?.titleDescriptor).toEqual({
        isDemo: true,
        kind: "market_metric",
        metricCode: "DEMO_ADDRESSABLE_UNITS",
        metricId: demoIds.marketMetric.china,
        metricName: "DEMO ONLY — Fictional addressable units",
      });
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
    expect(brazil?.gaps).toContainEqual({
      code: "PRODUCT_READINESS_UNKNOWN",
      count: 2,
    });
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

  it("requires a provenance-valid scorecard before AI can describe a ranking", async () => {
    const scorecard = await calculateOpportunityScore(input);
    const completeResult = buildOpportunityScoreResult({
      informationAsOf: input.asOf,
      scorecard,
    });

    expect(completeResult).toMatchObject({
      evidenceSufficient: true,
      status: "ok",
    });
    const drifted = structuredClone(scorecard);
    drifted.scores[0]!.overallScore = 99;
    expect(() =>
      buildOpportunityScoreResult({
        informationAsOf: input.asOf,
        scorecard: drifted,
      }),
    ).toThrow();
  });

  it("keeps a named product scoped through opportunity scoring", async () => {
    const scorecard = await calculateOpportunityScore({
      ...input,
      productModelCode: "demo-eng-200",
    });

    expect(scorecard.query.productModelCode).toBe("DEMO-ENG-200");
    for (const country of scorecard.provenance.productEvaluations) {
      expect(country.evaluations).toEqual([
        expect.objectContaining({
          commercialReadiness: "unknown",
          input: expect.objectContaining({
            countryIso3: country.countryIso3,
            productModelCode: "DEMO-ENG-200",
          }),
          product: expect.objectContaining({
            modelCode: "DEMO-ENG-200",
          }),
        }),
      ]);
    }
  });

  it("keeps an unknown named product as a replayable evaluation", async () => {
    const scorecard = await calculateOpportunityScore({
      ...input,
      productModelCode: "NOT-IN-CATALOGUE",
    });

    for (const country of scorecard.provenance.productEvaluations) {
      expect(country.evaluations).toEqual([
        expect.objectContaining({
          commercialReadiness: "unknown",
          input: expect.objectContaining({
            countryIso3: country.countryIso3,
            productModelCode: "NOT-IN-CATALOGUE",
          }),
          product: null,
          status: "unknown",
        }),
      ]);
    }
    expect(scorecard.scores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gaps: expect.arrayContaining([
            { code: "PRODUCT_READINESS_UNKNOWN", count: 1 },
          ]),
        }),
      ]),
    );
  });

  it("returns the required structured sales-brief JSON fields", async () => {
    const [scorecard, brief] = await Promise.all([
      calculateOpportunityScore(input),
      generateSalesBrief({
        ...input,
        targetCountryIso3: "CHN",
      }),
    ]);

    expect(Object.keys(brief).sort()).toEqual([
      "gaps",
      "marketScore",
      "opportunities",
      "provenance",
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
    expect(brief.provenance).toEqual(scorecard.provenance);
    expect(brief.sources).toEqual(scorecard.sources);
    expect(brief.marketScore).toEqual(
      scorecard.scores.find(({ countryIso3 }) => countryIso3 === "CHN"),
    );
    expect(brief.recommendedProducts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          availableFrom: "2025-01-01",
          availableTo: "2030-01-01",
          availabilityStatus: "pass",
          commercialReadiness: "ready",
          modelCode: "DEMO-ENG-100",
          status: "fit",
        }),
      ]),
    );
    const productSource = brief.sources.find(
      ({ entityId, entityType }) =>
        entityType === "product" && entityId === demoIds.product.certified,
    );
    expect(productSource?.locator).toContain(
      "availability 2025-01-01–2030-01-01",
    );
    expect(productSource?.locatorDescriptor).toEqual({
      availableFrom: "2025-01-01",
      availableTo: "2030-01-01",
      kind: "product_availability",
      modelCode: "DEMO-ENG-100",
      specificationVersion: "demo-v1",
    });
    expect(productSource?.titleDescriptor).toBeUndefined();
    const certificationSource = brief.sources.find(
      ({ entityType }) => entityType === "product_certification",
    );
    expect(certificationSource).toMatchObject({
      productId: demoIds.product.certified,
      productModelCode: "DEMO-ENG-100",
      regulationId: expect.any(String),
    });
    expect(certificationSource?.titleDescriptor).toBeUndefined();
    expect(brief.risks.map(({ ruleCode }) => ruleCode)).toContain(
      "FUTURE_ADOPTED_REGULATION",
    );
    expect(brief.salesActions.map(({ ruleCode }) => ruleCode)).toContain(
      "PREPARE_PRODUCT_EVIDENCE_PACK",
    );
  });

  it("keeps full provenance at the application boundary while compacting model output", async () => {
    const [scorecard, brief] = await Promise.all([
      calculateOpportunityScore(input),
      generateSalesBrief({
        ...input,
        targetCountryIso3: "CHN",
      }),
    ]);
    const scoreResult = buildOpportunityScoreResult({
      informationAsOf: input.asOf,
      scorecard,
    });
    const briefResult = buildSalesBriefResult({
      brief,
      informationAsOf: input.asOf,
    });
    const scoreProjection = opportunityScoreResultToModelOutput(scoreResult);
    const briefProjection = salesBriefResultToModelOutput(briefResult);

    expect(
      opportunityScoreModelToolOutputSchema.safeParse(scoreProjection).success,
    ).toBe(true);
    expect(
      salesBriefModelToolOutputSchema.safeParse(briefProjection).success,
    ).toBe(true);
    expect(scoreProjection.scorecard).not.toHaveProperty("provenance");
    expect(scoreProjection.scorecard).not.toHaveProperty("sources");
    expect(briefProjection.brief).not.toHaveProperty("provenance");
    expect(briefProjection.brief).not.toHaveProperty("sources");
    expect(scoreProjection.scorecard.query).toEqual({
      ...scorecard.query,
      productModelCode: null,
    });
    expect(briefProjection.brief.query).toEqual({
      ...brief.query,
      productModelCode: null,
    });
    expect(scoreProjection.projectionVersion).toBe(
      SALES_CHAT_MODEL_TOOL_OUTPUT_VERSION,
    );
    expect(scoreProjection.citations).not.toHaveLength(0);
    expect(briefProjection.citations).not.toHaveLength(0);
    expect(scoreProjection.evidenceDigest.marketMetrics).toMatchObject({
      complete: true,
      omittedCount: 0,
      totalCount: scorecard.provenance.marketComparison.metrics.length,
    });
    expect(
      scoreProjection.evidenceDigest.marketMetrics.items[0]?.observations[0]
        ?.valueNumeric,
    ).toBe(
      scorecard.provenance.marketComparison.metrics[0]?.observations[0]
        ?.valueNumeric,
    );
    expect(
      scoreProjection.evidenceDigest.productEvaluations.items.flatMap(
        ({ reasonCodes }) => reasonCodes,
      ),
    ).toContain("CERTIFICATION_MISSING");
    expect(
      scoreProjection.evidenceDigest.regulations.items.map(({ id }) => id),
    ).toEqual(
      scorecard.provenance.regulationComparison.countries.flatMap((country) => [
        ...country.currentEffectiveRegulations.map(({ id }) => id),
        ...country.futureAdoptedRegulations.map(({ id }) => id),
      ]),
    );
    const descriptorCitation = scoreResult.citations.find(
      ({ locatorDescriptor, titleDescriptor }) =>
        locatorDescriptor != null || titleDescriptor != null,
    );
    if (!descriptorCitation) throw new Error("Missing descriptor citation fixture.");
    const projectedDescriptorCitation = scoreProjection.citations.find(
      ({ entityId, entityType, sourceId }) =>
        entityId === descriptorCitation.entityId &&
        entityType === descriptorCitation.entityType &&
        sourceId === descriptorCitation.sourceId,
    );
    expect(projectedDescriptorCitation).toBeDefined();
    if (descriptorCitation.locatorDescriptor != null) {
      expect(projectedDescriptorCitation?.locatorDescriptor).toEqual(
        descriptorCitation.locatorDescriptor,
      );
    }
    if (descriptorCitation.titleDescriptor != null) {
      expect(projectedDescriptorCitation?.titleDescriptor).toEqual(
        descriptorCitation.titleDescriptor,
      );
    }
    const utf8Bytes = (value: unknown) =>
      new TextEncoder().encode(JSON.stringify(value)).byteLength;
    expect(utf8Bytes(scoreProjection)).toBeLessThan(utf8Bytes(scoreResult));
    expect(utf8Bytes(briefProjection)).toBeLessThan(utf8Bytes(briefResult));
    expect(utf8Bytes(scoreProjection)).toBeLessThanOrEqual(
      SALES_CHAT_MODEL_TOOL_OUTPUT_MAX_UTF8_BYTES,
    );
    expect(utf8Bytes(briefProjection)).toBeLessThanOrEqual(
      SALES_CHAT_MODEL_TOOL_OUTPUT_MAX_UTF8_BYTES,
    );

    const expandedInput = {
      ...input,
      countryIso3s: ["CHN", "BRA", "DEU", "USA", "IND"],
    };
    const [expandedScorecard, expandedBrief] = await Promise.all([
      calculateOpportunityScore(expandedInput),
      generateSalesBrief({
        ...expandedInput,
        targetCountryIso3: "CHN",
      }),
    ]);
    const expandedScoreResult = buildOpportunityScoreResult({
      informationAsOf: input.asOf,
      scorecard: expandedScorecard,
    });
    const expandedBriefResult = buildSalesBriefResult({
      brief: expandedBrief,
      informationAsOf: input.asOf,
    });
    const expandedScoreProjection =
      opportunityScoreResultToModelOutput(expandedScoreResult);
    const expandedBriefProjection =
      salesBriefResultToModelOutput(expandedBriefResult);
    expect(utf8Bytes(expandedScoreProjection)).toBeLessThan(
      utf8Bytes(expandedScoreResult),
    );
    expect(utf8Bytes(expandedBriefProjection)).toBeLessThan(
      utf8Bytes(expandedBriefResult),
    );
    expect(utf8Bytes(expandedScoreProjection)).toBeLessThanOrEqual(
      SALES_CHAT_MODEL_TOOL_OUTPUT_MAX_UTF8_BYTES,
    );
    expect(utf8Bytes(expandedBriefProjection)).toBeLessThanOrEqual(
      SALES_CHAT_MODEL_TOOL_OUTPUT_MAX_UTF8_BYTES,
    );

    expect(
      opportunityScoreModelToolOutputSchema.safeParse({
        ...scoreProjection,
        evidenceSufficient: false,
      }).success,
    ).toBe(false);
    expect(
      salesBriefModelToolOutputSchema.safeParse({
        ...briefProjection,
        status: "no_data",
      }).success,
    ).toBe(false);
    expect(
      salesBriefModelToolOutputSchema.safeParse({
        ...briefProjection,
        evidenceSufficient: false,
        status: "no_data",
      }).success,
    ).toBe(false);

    const missingMarketDigest = structuredClone(scoreProjection);
    missingMarketDigest.evidenceDigest.marketMetrics = {
      complete: true,
      items: [],
      omittedCount: 0,
      totalCount: 0,
    };
    expect(
      opportunityScoreModelToolOutputSchema.safeParse(missingMarketDigest)
        .success,
    ).toBe(false);

    const uncitedMarketDigest = structuredClone(scoreProjection);
    const firstObservation =
      uncitedMarketDigest.evidenceDigest.marketMetrics.items[0]
        ?.observations[0];
    if (!firstObservation) throw new Error("Missing market digest fixture.");
    firstObservation.id = "00000000-0000-4000-8000-000000009999";
    expect(
      opportunityScoreModelToolOutputSchema.safeParse(uncitedMarketDigest)
        .success,
    ).toBe(false);

    const shortIncompleteDigest = structuredClone(scoreProjection);
    const shortMarketItems =
      shortIncompleteDigest.evidenceDigest.marketMetrics.items.slice(0, 7);
    shortIncompleteDigest.evidenceDigest.marketMetrics = {
      complete: false,
      items: shortMarketItems,
      omittedCount: 1,
      totalCount: shortMarketItems.length + 1,
    };
    expect(
      opportunityScoreModelToolOutputSchema.safeParse(shortIncompleteDigest)
        .success,
    ).toBe(false);

    const emptySuccessfulScore = structuredClone(scoreProjection);
    emptySuccessfulScore.citations = [];
    emptySuccessfulScore.scorecard.scores = [];
    emptySuccessfulScore.evidenceDigest = {
      marketMetrics: {
        complete: true,
        items: [],
        omittedCount: 0,
        totalCount: 0,
      },
      productEvaluations: {
        complete: true,
        items: [],
        omittedCount: 0,
        totalCount: 0,
      },
      regulations: {
        complete: true,
        items: [],
        omittedCount: 0,
        totalCount: 0,
      },
    };
    expect(
      opportunityScoreModelToolOutputSchema.safeParse(emptySuccessfulScore)
        .success,
    ).toBe(false);

    const driftedProjectedScore = structuredClone(scoreProjection);
    const firstProjectedScore = driftedProjectedScore.scorecard.scores[0];
    if (!firstProjectedScore) throw new Error("Missing projected score fixture.");
    firstProjectedScore.overallScore = 99;
    expect(
      opportunityScoreModelToolOutputSchema.safeParse(driftedProjectedScore)
        .success,
    ).toBe(false);

    const reweightedProjection = structuredClone(scoreProjection);
    const forgedWeights = {
      marketPotential: 0.6,
      productReadiness: 0.2,
      regulatoryCoverage: 0.2,
    };
    reweightedProjection.scorecard.weights = forgedWeights;
    reweightedProjection.scorecard.scores =
      reweightedProjection.scorecard.scores.map(
        ({ components, countryIso3, gaps }) =>
          combineOpportunityScore({
            components: components.map(({ key, score }) => ({ key, score })),
            countryIso3,
            gaps,
            weights: forgedWeights,
          }),
      );
    expect(
      opportunityScoreModelToolOutputSchema.safeParse(reweightedProjection)
        .success,
    ).toBe(false);

    const driftedQueryDate = structuredClone(scoreProjection);
    driftedQueryDate.scorecard.query.asOf = "2027-01-01";
    expect(
      opportunityScoreModelToolOutputSchema.safeParse(driftedQueryDate)
        .success,
    ).toBe(false);

    const queryWithoutMetricCodes: Partial<
      typeof scoreProjection.scorecard.query
    > = { ...scoreProjection.scorecard.query };
    delete queryWithoutMetricCodes.metricCodes;
    expect(
      opportunityScoreModelToolOutputSchema.safeParse({
        ...scoreProjection,
        scorecard: {
          ...scoreProjection.scorecard,
          query: queryWithoutMetricCodes,
        },
      }).success,
    ).toBe(false);

    const multiMetricScorecard = await calculateOpportunityScore({
      ...input,
      metricCodes: ["DEMO_ADDRESSABLE_UNITS", "UNKNOWN_METRIC"],
    });
    const reorderedMetricProjection = structuredClone(
      opportunityScoreResultToModelOutput(
        buildOpportunityScoreResult({
          informationAsOf: input.asOf,
          scorecard: multiMetricScorecard,
        }),
      ),
    );
    reorderedMetricProjection.scorecard.query.metricCodes.reverse();
    expect(
      opportunityScoreModelToolOutputSchema.safeParse(
        reorderedMetricProjection,
      ).success,
    ).toBe(false);

    const namedScorecard = await calculateOpportunityScore({
      ...input,
      productModelCode: "DEMO-ENG-100",
    });
    const namedProjection = opportunityScoreResultToModelOutput(
      buildOpportunityScoreResult({
        informationAsOf: input.asOf,
        scorecard: namedScorecard,
      }),
    );
    const queryWithoutProductModelCode: Partial<
      typeof namedProjection.scorecard.query
    > = { ...namedProjection.scorecard.query };
    delete queryWithoutProductModelCode.productModelCode;
    expect(
      opportunityScoreModelToolOutputSchema.safeParse({
        ...namedProjection,
        scorecard: {
          ...namedProjection.scorecard,
          query: queryWithoutProductModelCode,
        },
      }).success,
    ).toBe(false);

    const forgedProductLocator = structuredClone(scoreProjection);
    const productCitation = forgedProductLocator.citations.find(
      ({ locatorDescriptor }) =>
        locatorDescriptor?.kind === "product_availability",
    );
    if (productCitation?.locatorDescriptor?.kind !== "product_availability") {
      throw new Error("Missing projected product locator fixture.");
    }
    productCitation.locatorDescriptor.specificationVersion = "forged-version";
    expect(
      opportunityScoreModelToolOutputSchema.safeParse(forgedProductLocator)
        .success,
    ).toBe(false);

    const duplicateCitation = structuredClone(scoreProjection);
    duplicateCitation.citations.push(
      structuredClone(duplicateCitation.citations[0]!),
    );
    expect(
      opportunityScoreModelToolOutputSchema.safeParse(duplicateCitation)
        .success,
    ).toBe(false);

    const findProjectedCitation = (
      projection: typeof scoreProjection,
      entityType: (typeof projection.citations)[number]["entityType"],
    ) => {
      const citation = projection.citations.find(
        (candidate) => candidate.entityType === entityType,
      );
      if (!citation) {
        throw new Error(`Missing ${entityType ?? "unknown"} citation fixture.`);
      }
      return citation;
    };
    const validExtraLocatorDescriptor = {
      kind: "market_period" as const,
      periodEnd: "2025-12-31",
      periodStart: "2025-01-01",
    };
    const nonCanonicalCitationMutations: Array<{
      mutate: (projection: typeof scoreProjection) => void;
      name: string;
    }> = [
      {
        mutate: (projection) => {
          findProjectedCitation(projection, "market_metric").title =
            "FORGED RAW TITLE";
        },
        name: "market raw title",
      },
      {
        mutate: (projection) => {
          findProjectedCitation(projection, "market_metric").locator =
            "FORGED RAW LOCATOR";
        },
        name: "market raw locator",
      },
      {
        mutate: (projection) => {
          findProjectedCitation(projection, "market_metric").regulationId =
            "00000000-0000-4000-8000-000000009993";
        },
        name: "market regulation identity",
      },
      {
        mutate: (projection) => {
          findProjectedCitation(projection, "product").locator =
            "FORGED PRODUCT LOCATOR";
        },
        name: "product raw locator",
      },
      {
        mutate: (projection) => {
          findProjectedCitation(
            projection,
            "product_certification",
          ).locatorDescriptor = validExtraLocatorDescriptor;
        },
        name: "certification locator descriptor",
      },
      {
        mutate: (projection) => {
          findProjectedCitation(projection, "regulation").locatorDescriptor =
            validExtraLocatorDescriptor;
        },
        name: "regulation locator descriptor",
      },
      {
        mutate: (projection) => {
          findProjectedCitation(projection, "jurisdiction").titleDescriptor = {
            kind: "product_certification_record",
            productModelCode: "DEMO-ENG-100",
          };
        },
        name: "jurisdiction title descriptor",
      },
      {
        mutate: (projection) => {
          findProjectedCitation(
            projection,
            "jurisdiction",
          ).locatorDescriptor = validExtraLocatorDescriptor;
        },
        name: "jurisdiction locator descriptor",
      },
      {
        mutate: (projection) => {
          findProjectedCitation(projection, "country_jurisdiction").title =
            "FORGED MEMBERSHIP TITLE";
        },
        name: "membership raw title",
      },
      {
        mutate: (projection) => {
          findProjectedCitation(projection, "country_jurisdiction").locator =
            "FORGED MEMBERSHIP LOCATOR";
        },
        name: "membership raw locator",
      },
    ];
    for (const { mutate, name } of nonCanonicalCitationMutations) {
      const nonCanonicalCitation = structuredClone(scoreProjection);
      mutate(nonCanonicalCitation);
      expect(
        opportunityScoreModelToolOutputSchema.safeParse(nonCanonicalCitation)
          .success,
        name,
      ).toBe(false);
    }

    const missingApplicabilityCitation = structuredClone(scoreProjection);
    const applicabilityCitationIndex =
      missingApplicabilityCitation.citations.findIndex(
        ({ entityType }) => entityType === "country_jurisdiction",
      );
    if (applicabilityCitationIndex < 0) {
      throw new Error("Missing applicability citation fixture.");
    }
    missingApplicabilityCitation.citations.splice(
      applicabilityCitationIndex,
      1,
    );
    expect(
      opportunityScoreModelToolOutputSchema.safeParse(
        missingApplicabilityCitation,
      ).success,
    ).toBe(false);

    const conflictingCitation = structuredClone(scoreProjection);
    conflictingCitation.citations.push({
      ...structuredClone(conflictingCitation.citations[0]!),
      sourceId: "00000000-0000-4000-8000-000000009998",
    });
    expect(
      opportunityScoreModelToolOutputSchema.safeParse(conflictingCitation)
        .success,
    ).toBe(false);

    const driftedSourceIdentity = structuredClone(scoreProjection);
    driftedSourceIdentity.sources[0]!.id =
      "00000000-0000-4000-8000-000000009996";
    expect(
      opportunityScoreModelToolOutputSchema.safeParse(driftedSourceIdentity)
        .success,
    ).toBe(false);

    const missingSource = structuredClone(scoreProjection);
    missingSource.sources.shift();
    expect(
      opportunityScoreModelToolOutputSchema.safeParse(missingSource).success,
    ).toBe(false);

    const extraSource = structuredClone(scoreProjection);
    extraSource.sources.push({
      id: "00000000-0000-4000-8000-000000009995",
      isDemo: false,
      title: "Unowned source",
      url: "https://example.com/unowned-source",
      verifiedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(
      opportunityScoreModelToolOutputSchema.safeParse(extraSource).success,
    ).toBe(false);

    const driftedFreshness = structuredClone(scoreProjection);
    driftedFreshness.latestVerifiedAt = "2027-01-01T00:00:00.000Z";
    expect(
      opportunityScoreModelToolOutputSchema.safeParse(driftedFreshness)
        .success,
    ).toBe(false);

    const offsetFreshness = structuredClone(scoreProjection);
    if (offsetFreshness.sources.length < 2) {
      throw new Error("Missing multiple source fixtures.");
    }
    for (const source of offsetFreshness.sources) {
      source.verifiedAt = "2000-01-01T00:00:00.000Z";
    }
    offsetFreshness.sources[0]!.verifiedAt = "2026-01-02T00:00:00+14:00";
    offsetFreshness.sources[1]!.verifiedAt = "2026-01-01T23:00:00-12:00";
    offsetFreshness.latestVerifiedAt = "2026-01-02T00:00:00+14:00";
    expect(
      opportunityScoreModelToolOutputSchema.safeParse(offsetFreshness).success,
    ).toBe(false);
    offsetFreshness.latestVerifiedAt = "2026-01-01T23:00:00-12:00";
    expect(
      opportunityScoreModelToolOutputSchema.safeParse(offsetFreshness).success,
    ).toBe(true);

    const driftedWarnings = structuredClone(scoreProjection);
    driftedWarnings.warnings = ["Forged warning"];
    expect(
      opportunityScoreModelToolOutputSchema.safeParse(driftedWarnings).success,
    ).toBe(false);

    for (const field of ["title", "locator"] as const) {
      const forgedCertificate = structuredClone(scoreProjection);
      const certificationCitation = forgedCertificate.citations.find(
        ({ entityType, title }) =>
          entityType === "product_certification" && title !== undefined,
      );
      if (!certificationCitation) {
        throw new Error("Missing certification citation fixture.");
      }
      certificationCitation[field] = "FORGED CERTIFICATE";
      expect(
        opportunityScoreModelToolOutputSchema.safeParse(forgedCertificate)
          .success,
      ).toBe(false);
    }

    const deletedBriefRules = structuredClone(briefProjection);
    deletedBriefRules.brief.opportunities = [];
    deletedBriefRules.brief.risks = [];
    deletedBriefRules.brief.salesActions = [];
    expect(
      salesBriefModelToolOutputSchema.safeParse(deletedBriefRules).success,
    ).toBe(false);

    const outsideBriefProduct = structuredClone(briefProjection);
    const readyProducts = outsideBriefProduct.brief.opportunities.find(
      ({ ruleCode }) => ruleCode === "READY_PRODUCTS_AVAILABLE",
    );
    if (!readyProducts || !("productIds" in readyProducts)) {
      throw new Error("Missing ready-products rule fixture.");
    }
    readyProducts.productIds = [
      "00000000-0000-4000-8000-000000009997",
    ];
    expect(
      salesBriefModelToolOutputSchema.safeParse(outsideBriefProduct).success,
    ).toBe(false);

    const driftedScoreResult = structuredClone(scoreResult);
    const firstScore = driftedScoreResult.scorecard.scores[0];
    if (!firstScore) throw new Error("Missing score fixture.");
    firstScore.overallScore = 99;
    expect(() => opportunityScoreResultToModelOutput(driftedScoreResult)).toThrow();

    const globallyScopedMarketResult = structuredClone(scoreResult);
    for (const metric of globallyScopedMarketResult.scorecard.provenance
      .marketComparison.metrics) {
      for (const observation of metric.observations) {
        observation.applicationScope = null;
      }
    }
    expect(
      aiToolResultSchema.safeParse(globallyScopedMarketResult).success,
    ).toBe(true);
    expect(() =>
      opportunityScoreResultToModelOutput(globallyScopedMarketResult),
    ).not.toThrow();

    const scoreErrorProjection = opportunityScoreResultToModelOutput(
      buildToolErrorResult("calculateOpportunityScore", input.asOf, input),
    );
    const briefErrorProjection = salesBriefResultToModelOutput(
      buildToolErrorResult("generateSalesBrief", input.asOf, {
        ...input,
        targetCountryIso3: "CHN",
      }),
    );
    const nonCanonicalErrorDigest = structuredClone(scoreErrorProjection);
    nonCanonicalErrorDigest.evidenceDigest.marketMetrics = {
      complete: false,
      items: [],
      omittedCount: 1,
      totalCount: 1,
    };
    expect(
      opportunityScoreModelToolOutputSchema.safeParse(nonCanonicalErrorDigest)
        .success,
    ).toBe(false);

    const missingErrorGap = structuredClone(scoreErrorProjection);
    missingErrorGap.scorecard.scores[0]!.gaps = [];
    expect(
      opportunityScoreModelToolOutputSchema.safeParse(missingErrorGap).success,
    ).toBe(false);

    const forgedBriefError = structuredClone(briefErrorProjection);
    const forgedProductId = "00000000-0000-4000-8000-000000009994";
    forgedBriefError.brief.recommendedProducts = [{ id: forgedProductId }];
    forgedBriefError.brief.opportunities = [
      {
        productIds: [forgedProductId],
        ruleCode: "READY_PRODUCTS_AVAILABLE",
      },
    ];
    expect(
      salesBriefModelToolOutputSchema.safeParse(forgedBriefError).success,
    ).toBe(false);

    for (const mutateError of [
      (projection: typeof scoreErrorProjection) => {
        projection.latestVerifiedAt = "2027-01-01T00:00:00.000Z";
      },
      (projection: typeof scoreErrorProjection) => {
        projection.warnings = ["Forged failure warning"];
      },
    ]) {
      const driftedError = structuredClone(scoreErrorProjection);
      mutateError(driftedError);
      expect(
        opportunityScoreModelToolOutputSchema.safeParse(driftedError).success,
      ).toBe(false);
    }

    for (const projection of [scoreErrorProjection, briefErrorProjection]) {
      expect(projection).toMatchObject({
        citations: [],
        evidenceSufficient: false,
        status: "error",
      });
      expect(projection).not.toHaveProperty("provenance");
      expect(projection.sources).toEqual([]);
      expect(projection.evidenceDigest).toMatchObject({
        marketMetrics: { items: [], totalCount: 0 },
        productEvaluations: { items: [], totalCount: 0 },
        regulations: { items: [], totalCount: 0 },
      });
    }
  });

  it("describes a generated certification title only when no certificate number exists", async () => {
    const database = await getDemoDatabase();
    await database
      .update(productCertifications)
      .set({ certificateNumber: null })
      .where(eq(productCertifications.id, demoIds.certification.engine100China));

    try {
      const brief = await generateSalesBrief({
        ...input,
        targetCountryIso3: "CHN",
      });
      const certificationSource = brief.sources.find(
        ({ entityId, entityType }) =>
          entityType === "product_certification" &&
          entityId === demoIds.certification.engine100China,
      );

      expect(certificationSource).toMatchObject({
        title: "DEMO-ENG-100认证",
        titleDescriptor: {
          kind: "product_certification_record",
          productModelCode: "DEMO-ENG-100",
        },
      });
      const projection = salesBriefResultToModelOutput(
        buildSalesBriefResult({ brief, informationAsOf: input.asOf }),
      );
      expect(
        salesBriefModelToolOutputSchema.safeParse(projection).success,
      ).toBe(true);
      expect(
        projection.citations.find(
          ({ entityId, entityType }) =>
            entityType === "product_certification" &&
            entityId === demoIds.certification.engine100China,
        ),
      ).toMatchObject({
        titleDescriptor: {
          kind: "product_certification_record",
          productModelCode: "DEMO-ENG-100",
        },
      });
    } finally {
      await database
        .update(productCertifications)
        .set({ certificateNumber: "DEMO-CERT-CHN-100" })
        .where(
          eq(productCertifications.id, demoIds.certification.engine100China),
        );
    }
  });

  it("keeps a named product scoped through the sales brief", async () => {
    const brief = await generateSalesBrief({
      ...input,
      productModelCode: "demo-eng-200",
      targetCountryIso3: "CHN",
    });

    expect(brief.query.productModelCode).toBe("DEMO-ENG-200");
    expect(brief.recommendedProducts).toEqual([]);
    expect(brief.gaps).toContainEqual({
      code: "PRODUCT_READINESS_UNKNOWN",
      count: 1,
    });
  });

  it("does not recommend a compliance-fit product outside its supply period", async () => {
    const database = await getDemoDatabase();
    await database
      .update(products)
      .set({ availableTo: "2026-01-01" })
      .where(eq(products.id, demoIds.product.certified));

    try {
      const brief = await generateSalesBrief({
        ...input,
        targetCountryIso3: "CHN",
      });

      expect(brief.recommendedProducts).toEqual([]);
      expect(brief.risks.map(({ ruleCode }) => ruleCode)).toContain(
        "FIT_PRODUCTS_UNAVAILABLE",
      );
      expect(
        brief.salesActions.some(
          ({ ruleCode }) => ruleCode === "PREPARE_PRODUCT_EVIDENCE_PACK",
        ),
      ).toBe(false);
    } finally {
      await database
        .update(products)
        .set({ availableTo: "2030-01-01" })
        .where(eq(products.id, demoIds.product.certified));
    }
  });

  it("records a missing product availability endpoint as unknown, not open", async () => {
    const database = await getDemoDatabase();
    await database
      .update(products)
      .set({ availableTo: null })
      .where(eq(products.id, demoIds.product.certified));

    try {
      const brief = await generateSalesBrief({
        ...input,
        targetCountryIso3: "CHN",
      });
      const productSource = brief.sources.find(
        ({ entityId, entityType }) =>
          entityType === "product" && entityId === demoIds.product.certified,
      );

      expect(productSource?.locator).toBe(
        "DEMO-ENG-100; availability 2025-01-01–unknown",
      );
      expect(productSource?.locatorDescriptor).toEqual({
        availableFrom: "2025-01-01",
        availableTo: null,
        kind: "product_availability",
        modelCode: "DEMO-ENG-100",
        specificationVersion: "demo-v1",
      });
    } finally {
      await database
        .update(products)
        .set({ availableTo: "2030-01-01" })
        .where(eq(products.id, demoIds.product.certified));
    }
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
