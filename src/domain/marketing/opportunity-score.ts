import type {
  CountryOpportunityScore,
  OpportunityScoreWeights,
} from "@/features/marketing/schemas";

export type ScoreComponentInput = {
  explanation: string;
  inputFacts: string[];
  key: keyof OpportunityScoreWeights;
  score: number | null;
};

export type ComparableMetricValue = {
  countryIso3: string;
  value: number;
};

export type ProductReadinessStatus = "fit" | "not_fit" | "unknown";

export type RegulationCoverageCheck = {
  regulationId: string;
  status: "pass" | "fail" | "unknown";
};

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function normalizeComparableMetric(
  values: ComparableMetricValue[],
  direction: "higher_is_better" | "lower_is_better",
): Map<string, number> {
  if (values.length < 2) {
    return new Map();
  }

  const rawValues = values.map(({ value }) => value);
  const minimum = Math.min(...rawValues);
  const maximum = Math.max(...rawValues);

  return new Map(
    values.map(({ countryIso3, value }) => {
      if (maximum === minimum) {
        return [countryIso3, 50];
      }

      const higherScore = ((value - minimum) / (maximum - minimum)) * 100;
      const score =
        direction === "higher_is_better" ? higherScore : 100 - higherScore;
      return [countryIso3, round(score)];
    }),
  );
}

export function calculateProductReadiness(
  statuses: ProductReadinessStatus[],
): number | null {
  const determined = statuses.filter((status) => status !== "unknown");
  if (determined.length === 0) {
    return null;
  }

  const fitCount = determined.filter((status) => status === "fit").length;
  return round((fitCount / determined.length) * 100);
}

export function calculateRegulatoryCoverage(
  checks: RegulationCoverageCheck[],
): number | null {
  const byRegulation = new Map<string, RegulationCoverageCheck["status"][]>();

  for (const check of checks) {
    const statuses = byRegulation.get(check.regulationId) ?? [];
    statuses.push(check.status);
    byRegulation.set(check.regulationId, statuses);
  }

  const determinedScores = Array.from(byRegulation.values()).flatMap(
    (statuses) => {
      if (statuses.includes("pass")) {
        return [100];
      }
      if (statuses.includes("fail")) {
        return [0];
      }
      return [];
    },
  );

  if (determinedScores.length === 0) {
    return null;
  }

  return round(
    determinedScores.reduce((sum, score) => sum + score, 0) /
      determinedScores.length,
  );
}

export function combineOpportunityScore(input: {
  components: ScoreComponentInput[];
  countryIso3: string;
  missingData: string[];
  weights: OpportunityScoreWeights;
}): CountryOpportunityScore {
  const totalConfiguredWeight = Object.values(input.weights).reduce(
    (sum, weight) => sum + weight,
    0,
  );
  const availableWeight = input.components.reduce(
    (sum, component) =>
      component.score === null ? sum : sum + input.weights[component.key],
    0,
  );
  const components = input.components.map((component) => {
    const configuredWeight = input.weights[component.key];
    const effectiveWeight =
      component.score === null || availableWeight === 0
        ? 0
        : configuredWeight / availableWeight;

    return {
      configuredWeight,
      contribution:
        component.score === null
          ? null
          : round(component.score * effectiveWeight),
      effectiveWeight: round(effectiveWeight, 6),
      explanation: component.explanation,
      inputFacts: component.inputFacts,
      key: component.key,
      score: component.score,
      status: component.score === null ? ("missing" as const) : ("available" as const),
    };
  });
  const overallScore =
    availableWeight === 0
      ? null
      : round(
          components.reduce(
            (sum, component) => sum + (component.contribution ?? 0),
            0,
          ),
        );

  return {
    components,
    countryIso3: input.countryIso3,
    dataCoveragePct:
      totalConfiguredWeight === 0
        ? 0
        : round((availableWeight / totalConfiguredWeight) * 100),
    missingData: Array.from(new Set(input.missingData)),
    overallScore,
  };
}
