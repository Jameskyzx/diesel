import { describe, expect, it } from "vitest";

import {
  combineOpportunityScore,
  countryOpportunityScoreMatchesMath,
  opportunityScorecardMatchesMath,
  type ScoreComponentInput,
} from "@/domain/marketing/opportunity-score";
import type {
  CountryOpportunityScore,
  OpportunityScorecard,
  OpportunityScoreWeights,
} from "@/features/marketing/schemas";

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

function buildCountryScore({
  countryIso3 = "CHN",
  marketPotential = 100,
  gaps = [],
  productReadiness = 100,
  regulatoryCoverage = 100,
  weights = defaultWeights,
}: {
  countryIso3?: "BRA" | "CHN";
  marketPotential?: number | null;
  gaps?: CountryOpportunityScore["gaps"];
  productReadiness?: number | null;
  regulatoryCoverage?: number | null;
  weights?: OpportunityScoreWeights;
} = {}): CountryOpportunityScore {
  const components: ScoreComponentInput[] = [
    {
      key: "marketPotential",
      score: marketPotential,
    },
    {
      key: "productReadiness",
      score: productReadiness,
    },
    {
      key: "regulatoryCoverage",
      score: regulatoryCoverage,
    },
  ];

  return combineOpportunityScore({
    components,
    countryIso3,
    gaps,
    weights,
  });
}

function buildScorecard(
  scores: CountryOpportunityScore[],
  weights: OpportunityScoreWeights = defaultWeights,
): OpportunityScorecard {
  return {
    provenance: {
      marketComparison: {
        metrics: [],
        missingData: ["所选国家没有结构化市场指标。"],
        query: {
          applicationScope: "non-road",
          countryIso3s: ["CHN", "BRA"],
        },
        sources: [],
      },
      productEvaluations: ["CHN", "BRA"].map((countryIso3) => ({
        countryIso3: countryIso3 as "CHN" | "BRA",
        evaluations: [],
      })),
      regulationComparison: {
        countries: ["CHN", "BRA"].map((countryIso3) => ({
          countryIsDemo: false,
          countryIso3: countryIso3 as "CHN" | "BRA",
          countryName: null,
          countrySource: null,
          currentEffectiveRegulations: [],
          futureAdoptedRegulations: [],
          status: "no_data" as const,
        })),
        missingData: [
          "CHN 没有国家结构化记录。",
          "BRA 没有国家结构化记录。",
        ],
        query: {
          applicationScope: "non-road",
          asOf: "2026-08-13",
          countryIso3s: ["CHN", "BRA"],
          powerKw: 100,
        },
        sources: [],
      },
    },
    query: {
      applicationScope: "non-road",
      asOf: "2026-08-13",
      countryIso3s: ["CHN", "BRA"],
      powerKw: 100,
    },
    rulesetVersion: "opportunity-score-v2",
    scores,
    sources: [],
    weights,
  };
}

describe("opportunity-score arithmetic consistency", () => {
  it("accepts complete, partial and all-missing canonical scores", () => {
    const complete = buildCountryScore();
    const partial = buildCountryScore({
      countryIso3: "BRA",
      marketPotential: 0,
      gaps: [
        { code: "PRODUCT_DATA_UNAVAILABLE" },
        { code: "REGULATORY_DATA_UNAVAILABLE" },
      ],
      productReadiness: null,
      regulatoryCoverage: null,
    });
    const allMissing = buildCountryScore({
      marketPotential: null,
      gaps: [
        { code: "MARKET_DATA_UNAVAILABLE" },
        { code: "PRODUCT_DATA_UNAVAILABLE" },
        { code: "REGULATORY_DATA_UNAVAILABLE" },
      ],
      productReadiness: null,
      regulatoryCoverage: null,
    });

    expect(complete).toMatchObject({
      dataCoveragePct: 100,
      overallScore: 100,
    });
    expect(partial).toMatchObject({
      dataCoveragePct: 50,
      overallScore: 0,
    });
    expect(allMissing).toMatchObject({
      dataCoveragePct: 0,
      overallScore: null,
    });
    expect(
      [complete, partial, allMissing].every((score) =>
        countryOpportunityScoreMatchesMath(score, defaultWeights),
      ),
    ).toBe(true);
  });

  it("accepts valid custom weights and their renormalized partial score", () => {
    const complete = buildCountryScore({ weights: customWeights });
    const partial = buildCountryScore({
      marketPotential: null,
      productReadiness: 75,
      regulatoryCoverage: null,
      weights: customWeights,
    });

    expect(partial).toMatchObject({
      dataCoveragePct: 40,
      overallScore: 75,
    });
    expect(
      partial.components.find(({ key }) => key === "productReadiness"),
    ).toMatchObject({
      contribution: 75,
      effectiveWeight: 1,
    });
    expect(
      opportunityScorecardMatchesMath(
        buildScorecard([complete, partial], customWeights),
      ),
    ).toBe(true);
  });

  it("accepts a coherently recomputed component score without claiming to verify its source facts", () => {
    const coherent = buildCountryScore({ marketPotential: 80 });

    expect(coherent).toMatchObject({ overallScore: 90 });
    expect(
      countryOpportunityScoreMatchesMath(coherent, defaultWeights),
    ).toBe(true);
  });

  const driftCases: Array<{
    mutate: (score: CountryOpportunityScore) => void;
    name: string;
  }> = [
    {
      mutate: (score) => {
        score.components[0]!.score = 80;
      },
      name: "component score",
    },
    {
      mutate: (score) => {
        score.components[0]!.configuredWeight = 0.4;
      },
      name: "configured weight",
    },
    {
      mutate: (score) => {
        score.components[0]!.effectiveWeight = 0.4;
      },
      name: "effective weight",
    },
    {
      mutate: (score) => {
        score.components[0]!.contribution = 40;
      },
      name: "contribution",
    },
    {
      mutate: (score) => {
        score.overallScore = 90;
      },
      name: "overall score",
    },
    {
      mutate: (score) => {
        score.dataCoveragePct = 90;
      },
      name: "data coverage",
    },
    {
      mutate: (score) => {
        score.components[1]!.key = "marketPotential";
      },
      name: "duplicate component key",
    },
    {
      mutate: (score) => {
        score.components[0]!.status = "missing";
      },
      name: "available score with missing status",
    },
    {
      mutate: (score) => {
        score.components[0]!.score = null;
      },
      name: "null score with available status",
    },
    {
      mutate: (score) => {
        score.components[0]!.contribution = null;
      },
      name: "available score with null contribution",
    },
  ];

  it.each(driftCases)("rejects $name drift", ({ mutate }) => {
    const drifted = structuredClone(buildCountryScore());
    mutate(drifted);

    expect(
      countryOpportunityScoreMatchesMath(drifted, defaultWeights),
    ).toBe(false);
  });

  it("rejects a scorecard whose top-level weights disagree with its components", () => {
    const scorecard = buildScorecard([buildCountryScore()]);
    scorecard.weights = customWeights;

    expect(opportunityScorecardMatchesMath(scorecard)).toBe(false);
  });

  it("rejects the whole scorecard when any country arithmetic drifts", () => {
    const china = buildCountryScore();
    const brazil = buildCountryScore({
      countryIso3: "BRA",
      marketPotential: 0,
      productReadiness: null,
      regulatoryCoverage: null,
    });
    brazil.dataCoveragePct = 100;

    expect(
      opportunityScorecardMatchesMath(buildScorecard([china, brazil])),
    ).toBe(false);
  });
});
