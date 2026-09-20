import type {
  CountryOpportunityScore,
  OpportunityScoreGap,
  OpportunityScorecard,
  OpportunityScoreWeights,
} from "@/features/marketing/schemas";

export type ScoreComponentInput = {
  key: keyof OpportunityScoreWeights;
  score: number | null;
};

export type ComparableMetricValue = {
  countryIso3: string;
  value: string;
};

export type ProductReadinessStatus = "ready" | "not_ready" | "unknown";

export type RegulationCoverageCheck = {
  regulationId: string;
  status: "pass" | "fail" | "unknown";
};

const opportunityScoreComponentKeys = [
  "marketPotential",
  "productReadiness",
  "regulatoryCoverage",
] as const satisfies readonly (keyof OpportunityScoreWeights)[];

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function exactDecimalToScaledInteger(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) {
    throw new Error(
      "Comparable metric values must be decimal strings with at most six fractional digits.",
    );
  }
  const magnitude =
    BigInt(match[2]!) * 1_000_000n +
    BigInt((match[3] ?? "").padEnd(6, "0"));
  return match[1] === "-" ? -magnitude : magnitude;
}

function roundedPercentage(numerator: bigint, denominator: bigint): number {
  if (numerator < 0n || denominator <= 0n || numerator > denominator) {
    throw new Error(
      "Comparable metric normalization received an invalid range.",
    );
  }
  const scaledNumerator = numerator * 10_000n;
  const quotient = scaledNumerator / denominator;
  const remainder = scaledNumerator % denominator;
  const basisPoints = quotient + (remainder * 2n >= denominator ? 1n : 0n);
  return Number(basisPoints) / 100;
}

export function normalizeComparableMetric(
  values: ComparableMetricValue[],
  direction: "higher_is_better" | "lower_is_better",
): Map<string, number> {
  if (values.length < 2) return new Map();
  const exactValues = values.map(({ countryIso3, value }) => ({
    countryIso3,
    value: exactDecimalToScaledInteger(value),
  }));
  const minimum = exactValues.reduce(
    (current, entry) => (entry.value < current ? entry.value : current),
    exactValues[0]!.value,
  );
  const maximum = exactValues.reduce(
    (current, entry) => (entry.value > current ? entry.value : current),
    exactValues[0]!.value,
  );
  return new Map(
    exactValues.map(({ countryIso3, value }) => {
      if (maximum === minimum) return [countryIso3, 50];
      const numerator =
        direction === "higher_is_better"
          ? value - minimum
          : maximum - value;
      return [countryIso3, roundedPercentage(numerator, maximum - minimum)];
    }),
  );
}

export function calculateProductReadiness(
  statuses: ProductReadinessStatus[],
): number | null {
  const determined = statuses.filter((status) => status !== "unknown");
  if (determined.length === 0) return null;
  const readyCount = determined.filter((status) => status === "ready").length;
  return round((readyCount / determined.length) * 100);
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
      if (statuses.includes("pass")) return [100];
      if (statuses.includes("fail")) return [0];
      return [];
    },
  );
  if (determinedScores.length === 0) return null;
  return round(
    determinedScores.reduce((sum, score) => sum + score, 0) /
      determinedScores.length,
  );
}

export function combineOpportunityScore(input: {
  components: ScoreComponentInput[];
  countryIso3: string;
  gaps: OpportunityScoreGap[];
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
      key: component.key,
      score: component.score,
      status:
        component.score === null ? ("missing" as const) : ("available" as const),
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
    gaps: input.gaps,
    overallScore,
  };
}

function hasValidOpportunityScoreWeights(
  weights: OpportunityScoreWeights,
): boolean {
  const values = opportunityScoreComponentKeys.map((key) => weights[key]);
  return (
    values.every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 1,
    ) &&
    Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) <=
      0.000_001
  );
}

function hasEachOpportunityScoreComponentExactlyOnce(
  score: CountryOpportunityScore,
): boolean {
  if (score.components.length !== opportunityScoreComponentKeys.length) {
    return false;
  }
  const keys = score.components.map(({ key }) => key);
  return opportunityScoreComponentKeys.every(
    (key) => keys.filter((candidate) => candidate === key).length === 1,
  );
}

/** Recomputes all arithmetic fields; provenance is validated separately. */
export function countryOpportunityScoreMatchesMath(
  score: CountryOpportunityScore,
  weights: OpportunityScoreWeights,
): boolean {
  if (
    !hasValidOpportunityScoreWeights(weights) ||
    !hasEachOpportunityScoreComponentExactlyOnce(score)
  ) {
    return false;
  }
  for (const component of score.components) {
    if (
      component.configuredWeight !== weights[component.key] ||
      (component.score === null) !== (component.status === "missing") ||
      (component.score === null) !== (component.contribution === null)
    ) {
      return false;
    }
  }
  const expected = combineOpportunityScore({
    components: score.components.map(({ key, score: componentScore }) => ({
      key,
      score: componentScore,
    })),
    countryIso3: score.countryIso3,
    gaps: score.gaps,
    weights,
  });
  return (
    score.dataCoveragePct === expected.dataCoveragePct &&
    score.overallScore === expected.overallScore &&
    exactJson(score.gaps, expected.gaps) &&
    exactJson(score.components, expected.components)
  );
}

function exactJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function opportunityScorecardMatchesMath(
  scorecard: OpportunityScorecard,
): boolean {
  return (
    hasValidOpportunityScoreWeights(scorecard.weights) &&
    scorecard.scores.every((score) =>
      countryOpportunityScoreMatchesMath(score, scorecard.weights),
    )
  );
}
