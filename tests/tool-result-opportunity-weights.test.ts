import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  combineOpportunityScore,
  opportunityScorecardMatchesMath,
} from "@/domain/marketing/opportunity-score";
import type {
  CalculateOpportunityScoreInput,
  CountryOpportunityScore,
  OpportunityScorecard,
  OpportunityScoreWeights,
  SalesBrief,
} from "@/features/marketing/schemas";
import {
  buildOpportunityScoreResult,
  buildSalesBriefResult,
  buildToolErrorResult,
} from "@/server/ai/tool-results";

const runtimeWeightEnvironmentKeys = [
  "OPPORTUNITY_SCORE_MARKET_WEIGHT",
  "OPPORTUNITY_SCORE_PRODUCT_WEIGHT",
  "OPPORTUNITY_SCORE_REGULATORY_WEIGHT",
] as const;
const originalRuntimeWeightEnvironment = Object.fromEntries(
  runtimeWeightEnvironmentKeys.map((key) => [key, process.env[key]]),
) as Record<
  (typeof runtimeWeightEnvironmentKeys)[number],
  string | undefined
>;

const defaultWeights: OpportunityScoreWeights = {
  marketPotential: 0.5,
  productReadiness: 0.3,
  regulatoryCoverage: 0.2,
};
const customWeights: OpportunityScoreWeights = {
  marketPotential: 0.4,
  productReadiness: 0.4,
  regulatoryCoverage: 0.2,
};
const fixedMismatchMessage =
  "Opportunity-score payload does not match the runtime configuration.";

const query: CalculateOpportunityScoreInput = {
  applicationScope: "non-road",
  asOf: "2026-08-30",
  countryIso3s: ["CHN", "BRA"],
  powerKw: 100,
};

function setRuntimeWeights(weights?: OpportunityScoreWeights): void {
  if (weights === undefined) {
    for (const key of runtimeWeightEnvironmentKeys) {
      delete process.env[key];
    }
    return;
  }

  process.env.OPPORTUNITY_SCORE_MARKET_WEIGHT = String(
    weights.marketPotential,
  );
  process.env.OPPORTUNITY_SCORE_PRODUCT_WEIGHT = String(
    weights.productReadiness,
  );
  process.env.OPPORTUNITY_SCORE_REGULATORY_WEIGHT = String(
    weights.regulatoryCoverage,
  );
}

function buildEmptyCountryScore(
  countryIso3: string,
  weights: OpportunityScoreWeights,
): CountryOpportunityScore {
  return combineOpportunityScore({
    components: [
      {
        key: "marketPotential",
        score: null,
      },
      {
        key: "productReadiness",
        score: null,
      },
      {
        key: "regulatoryCoverage",
        score: null,
      },
    ],
    countryIso3,
    gaps: [
      { code: "MARKET_DATA_UNAVAILABLE" },
      { code: "PRODUCT_DATA_UNAVAILABLE" },
      { code: "REGULATORY_DATA_UNAVAILABLE" },
    ],
    weights,
  });
}

function buildScorecard(
  weights: OpportunityScoreWeights,
): OpportunityScorecard {
  return {
    provenance: {
      marketComparison: {
        metrics: [],
        missingData: ["所选国家没有结构化市场指标。"],
        query: {
          applicationScope: query.applicationScope,
          countryIso3s: query.countryIso3s,
        },
        sources: [],
      },
      productEvaluations: query.countryIso3s.map((countryIso3) => ({
        countryIso3,
        evaluations: [],
      })),
      regulationComparison: {
        countries: query.countryIso3s.map((countryIso3) => ({
          countryIsDemo: false,
          countryIso3,
          countryName: null,
          countrySource: null,
          currentEffectiveRegulations: [],
          futureAdoptedRegulations: [],
          status: "no_data" as const,
        })),
        missingData: query.countryIso3s.map(
          (countryIso3) => `${countryIso3} 没有国家结构化记录。`,
        ),
        query: {
          applicationScope: query.applicationScope,
          asOf: query.asOf,
          countryIso3s: query.countryIso3s,
          powerKw: query.powerKw,
        },
        sources: [],
      },
    },
    query,
    rulesetVersion: "opportunity-score-v2",
    scores: query.countryIso3s.map((countryIso3) =>
      buildEmptyCountryScore(countryIso3, weights),
    ),
    sources: [],
    weights,
  };
}

function buildBrief(weights: OpportunityScoreWeights): SalesBrief {
  return {
    gaps: [
      { code: "MARKET_DATA_UNAVAILABLE" },
      { code: "PRODUCT_DATA_UNAVAILABLE" },
      { code: "REGULATORY_DATA_UNAVAILABLE" },
    ],
    marketScore: buildEmptyCountryScore("CHN", weights),
    opportunities: [],
    provenance: buildScorecard(weights).provenance,
    query: {
      ...query,
      targetCountryIso3: "CHN",
    },
    recommendedProducts: [],
    risks: [],
    salesActions: [
      {
        missingDataIndexes: [0, 1, 2],
        priority: "medium",
        ruleCode: "RESOLVE_MISSING_DATA_BEFORE_COMMITMENT",
      },
    ],
    sources: [],
  };
}

function configuredWeights(
  components: CountryOpportunityScore["components"],
): OpportunityScoreWeights {
  return Object.fromEntries(
    components.map(({ configuredWeight, key }) => [key, configuredWeight]),
  ) as OpportunityScoreWeights;
}

beforeEach(() => {
  setRuntimeWeights();
});

afterEach(() => {
  for (const key of runtimeWeightEnvironmentKeys) {
    const originalValue = originalRuntimeWeightEnvironment[key];
    if (originalValue === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalValue;
    }
  }
});

describe("server tool-result runtime opportunity weights", () => {
  it.each([
    { label: "default", runtimeWeights: defaultWeights },
    { label: "custom", runtimeWeights: customWeights },
  ])("accepts $label runtime weights", ({ runtimeWeights }) => {
    setRuntimeWeights(
      runtimeWeights === defaultWeights ? undefined : runtimeWeights,
    );

    const scoreResult = buildOpportunityScoreResult({
      informationAsOf: query.asOf,
      scorecard: buildScorecard(runtimeWeights),
    });
    const briefResult = buildSalesBriefResult({
      brief: buildBrief(runtimeWeights),
      informationAsOf: query.asOf,
    });

    expect(scoreResult.scorecard.weights).toEqual(runtimeWeights);
    expect(configuredWeights(briefResult.brief.marketScore.components)).toEqual(
      runtimeWeights,
    );
  });

  it("rejects internally coherent weights that drift from runtime", () => {
    const scorecard = buildScorecard(customWeights);
    const brief = buildBrief(customWeights);
    expect(opportunityScorecardMatchesMath(scorecard)).toBe(true);

    expect(() =>
      buildOpportunityScoreResult({
        informationAsOf: query.asOf,
        scorecard,
      }),
    ).toThrowError(fixedMismatchMessage);
    expect(() =>
      buildSalesBriefResult({ brief, informationAsOf: query.asOf }),
    ).toThrowError(fixedMismatchMessage);
  });

  it("uses custom runtime weights in score and brief error placeholders", () => {
    setRuntimeWeights(customWeights);

    const scoreResult = buildToolErrorResult(
      "calculateOpportunityScore",
      query.asOf,
      query,
    );
    const briefResult = buildToolErrorResult(
      "generateSalesBrief",
      query.asOf,
      { ...query, targetCountryIso3: "CHN" },
    );

    if (scoreResult.tool !== "calculateOpportunityScore") {
      throw new Error("Expected an opportunity-score error result.");
    }
    if (briefResult.tool !== "generateSalesBrief") {
      throw new Error("Expected a sales-brief error result.");
    }

    expect(scoreResult.scorecard.weights).toEqual(customWeights);
    for (const score of scoreResult.scorecard.scores) {
      expect(configuredWeights(score.components)).toEqual(customWeights);
    }
    expect(configuredWeights(briefResult.brief.marketScore.components)).toEqual(
      customWeights,
    );
  });

  it("does not expose an invalid runtime value in its fixed error", () => {
    const secretValue = "do-not-expose-this-runtime-value";
    process.env.OPPORTUNITY_SCORE_MARKET_WEIGHT = secretValue;

    let thrown: unknown;
    try {
      buildOpportunityScoreResult({
        informationAsOf: query.asOf,
        scorecard: buildScorecard(defaultWeights),
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toEqual(new Error(fixedMismatchMessage));
    expect(String(thrown)).not.toContain(secretValue);
  });
});
