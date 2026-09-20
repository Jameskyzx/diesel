import { countryScoreMatchesTrustedProvenance } from "@/domain/marketing/analysis-provenance";
import { opportunityMetricDirection } from "@/features/marketing/opportunity-score-registry";
import type {
  OpportunityScoreWeights,
  SalesBrief,
} from "@/features/marketing/schemas";

const componentKeys = [
  "marketPotential",
  "productReadiness",
  "regulatoryCoverage",
] as const satisfies readonly (keyof OpportunityScoreWeights)[];

function exactJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function weightsFromBrief(
  brief: SalesBrief,
): OpportunityScoreWeights | null {
  const entries = brief.marketScore.components.map(
    ({ configuredWeight, key }) => [key, configuredWeight] as const,
  );
  const weights = new Map(entries);
  if (
    entries.length !== componentKeys.length ||
    weights.size !== componentKeys.length ||
    componentKeys.some((key) => !weights.has(key))
  ) {
    return null;
  }
  return {
    marketPotential: weights.get("marketPotential")!,
    productReadiness: weights.get("productReadiness")!,
    regulatoryCoverage: weights.get("regulatoryCoverage")!,
  };
}

function scoreQuery(brief: SalesBrief) {
  const {
    applicationScope,
    asOf,
    countryIso3s,
    metricCodes,
    powerKw,
    productModelCode,
  } = brief.query;
  return {
    applicationScope,
    asOf,
    countryIso3s,
    ...(metricCodes === undefined ? {} : { metricCodes }),
    powerKw,
    ...(productModelCode === undefined ? {} : { productModelCode }),
  };
}

function targetEvaluations(brief: SalesBrief) {
  return brief.provenance.productEvaluations.find(
    ({ countryIso3 }) => countryIso3 === brief.query.targetCountryIso3,
  )?.evaluations;
}

function expectedRecommendations(brief: SalesBrief) {
  const evaluations = targetEvaluations(brief);
  if (!evaluations) return null;
  return evaluations.flatMap((evaluation) => {
    const product = evaluation.product;
    if (
      !product ||
      evaluation.status !== "fit" ||
      evaluation.commercialReadiness !== "ready" ||
      evaluation.productChecks.availability.status !== "pass"
    ) {
      return [];
    }
    return [
      {
        availableFrom: product.availableFrom,
        availableTo: product.availableTo,
        availabilityStatus: "pass" as const,
        certifications: evaluation.regulationChecks.flatMap((check) =>
          check.certifications.flatMap(({ certification, status }) =>
            check.status === "pass" && status === "pass"
              ? [
                  {
                    id: certification.id,
                    regulationId: certification.regulationId,
                  },
                ]
              : [],
          ),
        ),
        commercialReadiness: "ready" as const,
        id: product.id,
        isDemo: product.isDemo,
        modelCode: product.modelCode,
        name: product.name,
        source: {
          id: product.source.id,
          isDemo: product.source.isDemo,
          title: product.source.title,
        },
        specificationVersion: product.specificationVersion,
        status: "fit" as const,
      },
    ];
  });
}

function expectedRules(brief: SalesBrief) {
  const evaluations = targetEvaluations(brief);
  const country = brief.provenance.regulationComparison.countries.find(
    ({ countryIso3 }) => countryIso3 === brief.query.targetCountryIso3,
  );
  if (!evaluations || !country) return null;
  const recommendationIds = brief.recommendedProducts.map(({ id }) => id);
  const futureRegulationIds = country.futureAdoptedRegulations.map(
    ({ id }) => id,
  );
  const contributingMetricCodes =
    brief.provenance.marketComparison.metrics.flatMap(
      ({ comparisonStatus, metricCode }) =>
        comparisonStatus === "comparable" &&
        opportunityMetricDirection(metricCode) !== null
          ? [metricCode]
          : [],
    );
  const productIds = (status: "fit" | "not_fit" | "unknown") =>
    evaluations.flatMap((evaluation) =>
      evaluation.product && evaluation.status === status
        ? [evaluation.product.id]
        : [],
    );
  const unavailableFitIds = evaluations.flatMap((evaluation) =>
    evaluation.product &&
    evaluation.status === "fit" &&
    evaluation.productChecks.availability.status === "fail"
      ? [evaluation.product.id]
      : [],
  );
  const availabilityUnknownFitIds = evaluations.flatMap((evaluation) =>
    evaluation.product &&
    evaluation.status === "fit" &&
    evaluation.productChecks.availability.status === "unknown"
      ? [evaluation.product.id]
      : [],
  );
  const marketComponent = brief.marketScore.components.find(
    ({ key }) => key === "marketPotential",
  );
  const notFitIds = productIds("not_fit");
  const unknownIds = productIds("unknown");

  return {
    opportunities: [
      ...(marketComponent?.score !== null &&
      marketComponent?.score !== undefined &&
      marketComponent.score >= 50 &&
      contributingMetricCodes.length > 0
        ? [
            {
              metricCodes: contributingMetricCodes,
              ruleCode: "MARKET_POTENTIAL_AT_LEAST_50" as const,
            },
          ]
        : []),
      ...(recommendationIds.length > 0
        ? [
            {
              productIds: recommendationIds,
              ruleCode: "READY_PRODUCTS_AVAILABLE" as const,
            },
          ]
        : []),
    ],
    risks: [
      ...(futureRegulationIds.length > 0
        ? [
            {
              regulationIds: futureRegulationIds,
              ruleCode: "FUTURE_ADOPTED_REGULATION" as const,
            },
          ]
        : []),
      ...(notFitIds.length > 0
        ? [
            {
              productIds: notFitIds,
              ruleCode: "PRODUCTS_NOT_FIT" as const,
            },
          ]
        : []),
      ...(unknownIds.length > 0
        ? [
            {
              productIds: unknownIds,
              ruleCode: "PRODUCT_EVIDENCE_UNKNOWN" as const,
            },
          ]
        : []),
      ...(unavailableFitIds.length > 0
        ? [
            {
              productIds: unavailableFitIds,
              ruleCode: "FIT_PRODUCTS_UNAVAILABLE" as const,
            },
          ]
        : []),
      ...(availabilityUnknownFitIds.length > 0
        ? [
            {
              productIds: availabilityUnknownFitIds,
              ruleCode: "FIT_PRODUCTS_AVAILABILITY_UNKNOWN" as const,
            },
          ]
        : []),
    ],
    salesActions: [
      ...(recommendationIds.length > 0
        ? [
            {
              priority: "high" as const,
              productIds: recommendationIds,
              ruleCode: "PREPARE_PRODUCT_EVIDENCE_PACK" as const,
            },
          ]
        : []),
      ...(futureRegulationIds.length > 0
        ? [
            {
              priority: "high" as const,
              regulationIds: futureRegulationIds,
              ruleCode: "REVALIDATE_BEFORE_FUTURE_REGULATION" as const,
            },
          ]
        : []),
      ...(brief.gaps.length > 0
        ? [
            {
              missingDataIndexes: brief.gaps.map((_, index) => index),
              priority: "medium" as const,
              ruleCode: "RESOLVE_MISSING_DATA_BEFORE_COMMITMENT" as const,
            },
          ]
        : []),
    ],
  };
}

/** Rebuilds recommendations and the exact ordered rule-code projection. */
export function salesBriefMatchesDeterministicRules(
  brief: SalesBrief,
): boolean {
  try {
    const weights = weightsFromBrief(brief);
    const recommendations = expectedRecommendations(brief);
    const rules = expectedRules(brief);
    if (!weights || !recommendations || !rules) return false;
    return (
      brief.marketScore.countryIso3 === brief.query.targetCountryIso3 &&
      countryScoreMatchesTrustedProvenance({
        provenance: brief.provenance,
        query: scoreQuery(brief),
        score: brief.marketScore,
        sources: brief.sources,
        weights,
      }) &&
      exactJson(brief.gaps, brief.marketScore.gaps) &&
      !hasDuplicates(brief.recommendedProducts.map(({ id }) => id)) &&
      !hasDuplicates(
        brief.recommendedProducts.map(({ modelCode }) => modelCode),
      ) &&
      exactJson(brief.recommendedProducts, recommendations) &&
      exactJson(brief.opportunities, rules.opportunities) &&
      exactJson(brief.risks, rules.risks) &&
      exactJson(brief.salesActions, rules.salesActions)
    );
  } catch {
    return false;
  }
}
