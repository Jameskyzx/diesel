import { compareCanonicalText } from "@/domain/canonical-order";

import {
  marketComparisonMatchesDeterministicRules,
  regulationComparisonMatchesDeterministicRules,
  regulationComparisonSourcesMatchVisibleFacts,
} from "@/domain/marketing/comparison-consistency";
import {
  calculateProductReadiness,
  calculateRegulatoryCoverage,
  countryOpportunityScoreMatchesMath,
  normalizeComparableMetric,
} from "@/domain/marketing/opportunity-score";
import {
  productFitEvaluationMatchesDeterministicRules,
  productFitEvaluationSourcesMatchFacts,
} from "@/domain/product-fit/evaluation-consistency";
import { opportunityMetricDirection } from "@/features/marketing/opportunity-score-registry";
import { marketComparisonSourcesMatchFacts } from "@/features/ai/evidence-semantics";
import type {
  AnalysisSource,
  CountryOpportunityScore,
  OpportunityScoreGap,
  OpportunityScorecard,
  OpportunityScoreProvenance,
  OpportunityScoreWeights,
  RegulationComparisonItem,
} from "@/features/marketing/schemas";
import type {
  FitEvidenceSource,
  ProductFitEvaluation,
  RegulationEvidence,
} from "@/features/product-fit/schemas";

function exactJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactSequence(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function sourceKey(source: Pick<
  AnalysisSource,
  | "countryIso3"
  | "entityId"
  | "entityType"
  | "productId"
  | "productModelCode"
  | "regulationId"
  | "sourceId"
>): string {
  return `${source.countryIso3 ?? "global"}:${source.entityType}:${source.entityId}:${source.productId ?? "none"}:${source.productModelCode ?? "none"}:${source.regulationId ?? "none"}:${source.sourceId}`;
}

function productSourceMatches(
  source: AnalysisSource,
  countryIso3: string,
  evaluation: ProductFitEvaluation,
): boolean {
  const product = evaluation.product;
  if (!product) return false;
  return (
    source.countryIso3 === countryIso3 &&
    source.entityId === product.id &&
    source.entityType === "product" &&
    source.isDemo === (product.isDemo || product.source.isDemo) &&
    source.locator ===
      `${product.modelCode}; availability ${product.availableFrom ?? "unknown"}–${product.availableTo ?? "unknown"}` &&
    exactJson(source.locatorDescriptor, {
      availableFrom: product.availableFrom,
      availableTo: product.availableTo,
      kind: "product_availability",
      modelCode: product.modelCode,
      specificationVersion: product.specificationVersion,
    }) &&
    source.publishedOn === product.source.publishedOn &&
    source.regulationId === null &&
    source.regulationStatus === null &&
    source.sourceId === product.source.id &&
    source.sourceTitle === product.source.title &&
    source.sourceUrl === product.source.url &&
    source.title === product.name &&
    source.titleDescriptor === undefined &&
    source.verifiedAt === product.source.verifiedAt
  );
}

function certificationSourceMatches(input: {
  countryIso3: string;
  evaluation: ProductFitEvaluation;
  regulationCheck: ProductFitEvaluation["regulationChecks"][number];
  certificationCheck: ProductFitEvaluation["regulationChecks"][number]["certifications"][number];
  source: AnalysisSource;
}): boolean {
  const product = input.evaluation.product;
  const certification = input.certificationCheck.certification;
  if (!product) return false;
  return (
    input.source.countryIso3 === input.countryIso3 &&
    input.source.entityId === certification.id &&
    input.source.entityType === "product_certification" &&
    input.source.isDemo ===
      (certification.isDemo || certification.source.isDemo) &&
    input.source.locator === certification.certificateNumber &&
    input.source.locatorDescriptor === undefined &&
    input.source.publishedOn === certification.source.publishedOn &&
    certification.productId === product.id &&
    certification.productModelCode === product.modelCode &&
    certification.regulationId === input.regulationCheck.regulation.regulationId &&
    input.source.productId === certification.productId &&
    input.source.productModelCode === certification.productModelCode &&
    input.source.regulationId === certification.regulationId &&
    input.source.regulationStatus ===
      input.regulationCheck.regulation.recordStatus &&
    input.source.sourceId === certification.source.id &&
    input.source.sourceTitle === certification.source.title &&
    input.source.sourceUrl === certification.source.url &&
    input.source.verifiedAt === certification.source.verifiedAt &&
    (certification.certificateNumber !== null
      ? input.source.title === certification.certificateNumber &&
        input.source.titleDescriptor === undefined
      : input.source.title === `${product.modelCode}认证` &&
        exactJson(input.source.titleDescriptor, {
          kind: "product_certification_record",
          productModelCode: product.modelCode,
        }))
  );
}

function fitSourceMatchesAnalysisSource(input: {
  analysisSource: AnalysisSource;
  expectedIsDemo: boolean;
  fitSource: FitEvidenceSource;
}): boolean {
  return (
    input.analysisSource.isDemo === input.expectedIsDemo &&
    input.analysisSource.publishedOn === input.fitSource.publishedOn &&
    input.analysisSource.sourceId === input.fitSource.id &&
    input.analysisSource.sourceTitle === input.fitSource.title &&
    input.analysisSource.sourceUrl === input.fitSource.url &&
    input.analysisSource.verifiedAt === input.fitSource.verifiedAt
  );
}

function limitSourcesMatch(
  regulation: RegulationEvidence,
  comparisonItem: RegulationComparisonItem,
): boolean {
  const fitSourcesById = new Map(
    regulation.limitSources.map((source) => [source.id, source]),
  );
  const comparisonSourcesById = new Map<
    string,
    RegulationComparisonItem["limits"]
  >();
  for (const limit of comparisonItem.limits) {
    const grouped = comparisonSourcesById.get(limit.source.sourceId) ?? [];
    grouped.push(limit);
    comparisonSourcesById.set(limit.source.sourceId, grouped);
  }
  if (
    fitSourcesById.size !== regulation.limitSources.length ||
    fitSourcesById.size !== comparisonSourcesById.size
  ) {
    return false;
  }
  return [...comparisonSourcesById].every(([sourceId, limits]) => {
    const fitSource = fitSourcesById.get(sourceId);
    if (!fitSource || limits.length === 0) return false;
    const representative = limits[0]!.source;
    const expectedIsDemo = limits.some(({ isDemo, source }) =>
      isDemo || source.isDemo,
    );
    return (
      limits.every(
        ({ source }) =>
          source.sourceId === representative.sourceId &&
          source.sourceTitle === representative.sourceTitle &&
          source.sourceUrl === representative.sourceUrl &&
          source.publishedOn === representative.publishedOn &&
          source.verifiedAt === representative.verifiedAt,
      ) &&
      fitSourceMatchesAnalysisSource({
        analysisSource: representative,
        expectedIsDemo,
        fitSource,
      })
    );
  });
}

function regulationFactsMatch(
  regulation: RegulationEvidence,
  comparisonItem: RegulationComparisonItem,
  countryIso3: string,
): boolean {
  return (
    regulation.regulationId === comparisonItem.id &&
    regulation.status === "effective" &&
    comparisonItem.status === "effective" &&
    regulation.canonicalName === comparisonItem.canonicalName &&
    regulation.citationCode === comparisonItem.citationCode &&
    regulation.effectiveFrom === comparisonItem.effectiveFrom &&
    regulation.effectiveTo === comparisonItem.effectiveTo &&
    regulation.isDemo === comparisonItem.isDemo &&
    regulation.recordStatus === comparisonItem.recordStatus &&
    regulation.verifiedAt === comparisonItem.verifiedAt &&
    regulation.applicability.countryIso3 === countryIso3 &&
    exactJson(
      {
        code: regulation.applicability.jurisdiction.code,
        id: regulation.applicability.jurisdiction.id,
        isDemo: regulation.applicability.jurisdiction.isDemo,
        name: regulation.applicability.jurisdiction.name,
        verifiedAt: regulation.applicability.jurisdiction.verifiedAt,
      },
      {
        code: comparisonItem.applicability.jurisdiction.code,
        id: comparisonItem.applicability.jurisdiction.id,
        isDemo: comparisonItem.applicability.jurisdiction.isDemo,
        name: comparisonItem.applicability.jurisdiction.name,
        verifiedAt: comparisonItem.applicability.jurisdiction.verifiedAt,
      },
    ) &&
    fitSourceMatchesAnalysisSource({
      analysisSource: comparisonItem.source,
      expectedIsDemo: regulation.isDemo || regulation.source.isDemo,
      fitSource: regulation.source,
    }) &&
    fitSourceMatchesAnalysisSource({
      analysisSource: comparisonItem.applicability.jurisdiction.source,
      expectedIsDemo:
        regulation.applicability.jurisdiction.isDemo ||
        regulation.applicability.jurisdiction.source.isDemo,
      fitSource: regulation.applicability.jurisdiction.source,
    }) &&
    exactJson(
      {
        isDemo: regulation.applicability.membership.isDemo,
        validFrom: regulation.applicability.membership.validFrom,
        validTo: regulation.applicability.membership.validTo,
        verifiedAt: regulation.applicability.membership.verifiedAt,
      },
      {
        isDemo: comparisonItem.applicability.membership.isDemo,
        validFrom: comparisonItem.applicability.membership.validFrom,
        validTo: comparisonItem.applicability.membership.validTo,
        verifiedAt: comparisonItem.applicability.membership.verifiedAt,
      },
    ) &&
    fitSourceMatchesAnalysisSource({
      analysisSource: comparisonItem.applicability.membership.source,
      expectedIsDemo:
        regulation.applicability.membership.isDemo ||
        regulation.applicability.membership.source.isDemo,
      fitSource: regulation.applicability.membership.source,
    }) &&
    limitSourcesMatch(regulation, comparisonItem)
  );
}

function evaluationRegulationsMatchComparison(
  evaluation: ProductFitEvaluation,
  provenance: OpportunityScoreProvenance,
  countryIso3: string,
): boolean {
  const country = provenance.regulationComparison.countries.find(
    (candidate) => candidate.countryIso3 === countryIso3,
  );
  if (!country) return false;
  const checks = evaluation.regulationChecks;
  if (
    !exactSequence(
      checks.map(({ regulation }) => regulation.regulationId),
      country.currentEffectiveRegulations.map(({ id }) => id),
    )
  ) {
    return false;
  }
  return checks.every(({ certifications, regulation }, index) => {
    const comparisonItem = country.currentEffectiveRegulations[index];
    return (
      comparisonItem !== undefined &&
      regulationFactsMatch(regulation, comparisonItem, countryIso3) &&
      certifications.every(
        ({ certification }) =>
          evaluation.product !== null &&
          certification.productId === evaluation.product.id &&
          certification.productModelCode === evaluation.product.modelCode &&
          certification.regulationId === regulation.regulationId,
      )
    );
  });
}

function comparisonQueryMatches(
  provenance: OpportunityScoreProvenance,
  query: OpportunityScorecard["query"],
): boolean {
  const marketQuery = provenance.marketComparison.query;
  const regulationQuery = provenance.regulationComparison.query;
  return (
    exactSequence(marketQuery.countryIso3s, query.countryIso3s) &&
    (marketQuery.applicationScope ?? null) === query.applicationScope &&
    exactJson(marketQuery.metricCodes, query.metricCodes) &&
    exactSequence(regulationQuery.countryIso3s, query.countryIso3s) &&
    regulationQuery.applicationScope === query.applicationScope &&
    regulationQuery.asOf === query.asOf &&
    regulationQuery.powerKw === query.powerKw &&
    exactSequence(
      provenance.productEvaluations.map(({ countryIso3 }) => countryIso3),
      query.countryIso3s,
    )
  );
}

function evaluationQueryMatches(
  evaluation: ProductFitEvaluation,
  query: OpportunityScorecard["query"],
  countryIso3: string,
): boolean {
  const productModelMatches =
    query.productModelCode === undefined
      ? evaluation.product !== null &&
        evaluation.input.productModelCode === evaluation.product.modelCode
      : evaluation.input.productModelCode === query.productModelCode &&
        (evaluation.product === null ||
          evaluation.product.modelCode === query.productModelCode);
  return (
    evaluation.input.applicationScope === query.applicationScope &&
    evaluation.input.asOf === query.asOf &&
    evaluation.input.countryIso3 === countryIso3 &&
    evaluation.input.powerKw === query.powerKw &&
    evaluation.asOf === query.asOf &&
    productModelMatches
  );
}

function evaluationSetMatchesQuery(
  evaluations: ProductFitEvaluation[],
  provenance: OpportunityScoreProvenance,
  query: OpportunityScorecard["query"],
  countryIso3: string,
): boolean {
  const identityKeys = evaluations.map((evaluation) =>
    evaluation.product === null
      ? `missing:${evaluation.input.productModelCode}`
      : `product:${evaluation.product.id}:${evaluation.product.modelCode}`,
  );
  const productIds = evaluations.flatMap(({ product }) =>
    product === null ? [] : [product.id],
  );
  const productModelCodes = evaluations.flatMap(({ product }) =>
    product === null ? [] : [product.modelCode],
  );
  const certificationIds = evaluations.flatMap(({ regulationChecks }) =>
    regulationChecks.flatMap(({ certifications }) =>
      certifications.map(({ certification }) => certification.id),
    ),
  );
  const productOrder = evaluations.map(({ product }) =>
    product === null ? null : `${product.modelCode}\u0000${product.id}`,
  );
  const canonicalProductOrder = productOrder
    .toSorted((left, right) => compareCanonicalText(left ?? "", right ?? ""));
  return (
    new Set(identityKeys).size === identityKeys.length &&
    new Set(productIds).size === productIds.length &&
    new Set(productModelCodes).size === productModelCodes.length &&
    new Set(certificationIds).size === certificationIds.length &&
    (query.productModelCode === undefined || evaluations.length === 1) &&
    (query.productModelCode !== undefined ||
      exactJson(productOrder, canonicalProductOrder)) &&
    evaluations.every(
      (evaluation) =>
        evaluationQueryMatches(evaluation, query, countryIso3) &&
        evaluationRegulationsMatchComparison(
          evaluation,
          provenance,
          countryIso3,
        ) &&
        productFitEvaluationSourcesMatchFacts(evaluation) &&
        productFitEvaluationMatchesDeterministicRules(evaluation),
    )
  );
}

function sourcesMatchProvenance(
  sources: AnalysisSource[],
  provenance: OpportunityScoreProvenance,
): boolean {
  const expectedComparisonSources = [
    ...provenance.regulationComparison.sources,
    ...provenance.marketComparison.sources,
  ];
  const expectedKeys = new Set(
    expectedComparisonSources.map((source) => sourceKey(source)),
  );
  if (expectedKeys.size !== expectedComparisonSources.length) return false;
  const actualByKey = new Map(
    sources.map((source) => [sourceKey(source), source]),
  );
  if (actualByKey.size !== sources.length) return false;

  for (const expected of expectedComparisonSources) {
    const actual = actualByKey.get(sourceKey(expected));
    if (!actual || !exactJson(actual, expected)) return false;
  }

  for (const country of provenance.productEvaluations) {
    for (const evaluation of country.evaluations) {
      if (!evaluation.product) continue;
      const productKey = sourceKey({
        countryIso3: country.countryIso3,
        entityId: evaluation.product.id,
        entityType: "product",
        regulationId: null,
        sourceId: evaluation.product.source.id,
      });
      const productSource = actualByKey.get(productKey);
      if (
        !productSource ||
        !productSourceMatches(productSource, country.countryIso3, evaluation)
      ) {
        return false;
      }
      expectedKeys.add(productKey);

      for (const regulationCheck of evaluation.regulationChecks) {
        for (const certificationCheck of regulationCheck.certifications) {
          const certification = certificationCheck.certification;
          const certificationKey = sourceKey({
            countryIso3: country.countryIso3,
            entityId: certification.id,
            entityType: "product_certification",
            productId: certification.productId,
            productModelCode: certification.productModelCode,
            regulationId: certification.regulationId,
            sourceId: certification.source.id,
          });
          const certificationSource = actualByKey.get(certificationKey);
          if (
            !certificationSource ||
            !certificationSourceMatches({
              certificationCheck,
              countryIso3: country.countryIso3,
              evaluation,
              regulationCheck,
              source: certificationSource,
            })
          ) {
            return false;
          }
          expectedKeys.add(certificationKey);
        }
      }
    }
  }

  return (
    actualByKey.size === expectedKeys.size &&
    [...actualByKey.keys()].every((key) => expectedKeys.has(key))
  );
}

function dimensionScores(
  provenance: OpportunityScoreProvenance,
  countryIso3: string,
) {
  const marketScores: number[] = [];
  for (const metric of provenance.marketComparison.metrics) {
    const direction = opportunityMetricDirection(metric.metricCode);
    if (metric.comparisonStatus !== "comparable" || direction === null) {
      continue;
    }
    const normalized = normalizeComparableMetric(
      metric.observations.map((observation) => ({
        countryIso3: observation.countryIso3,
        value: observation.valueNumeric,
      })),
      direction,
    );
    const score = normalized.get(countryIso3);
    if (score !== undefined) marketScores.push(score);
  }
  const evaluations = provenance.productEvaluations.find(
    (entry) => entry.countryIso3 === countryIso3,
  )?.evaluations;
  if (!evaluations) throw new Error("Score provenance country is missing.");

  return {
    marketPotential:
      marketScores.length === 0
        ? null
        : marketScores.reduce((sum, score) => sum + score, 0) /
          marketScores.length,
    productReadiness: calculateProductReadiness(
      evaluations.map(({ commercialReadiness }) => commercialReadiness),
    ),
    regulatoryCoverage: calculateRegulatoryCoverage(
      evaluations.flatMap((evaluation) =>
        evaluation.regulationChecks.map(({ regulation, status }) => ({
          regulationId: regulation.regulationId,
          status,
        })),
      ),
    ),
  };
}

function expectedGaps(
  provenance: OpportunityScoreProvenance,
  countryIso3: string,
): OpportunityScoreGap[] {
  const scores = dimensionScores(provenance, countryIso3);
  const evaluations = provenance.productEvaluations.find(
    (entry) => entry.countryIso3 === countryIso3,
  )!.evaluations;
  const unknownCount = evaluations.filter(
    ({ commercialReadiness }) => commercialReadiness === "unknown",
  ).length;
  const unsupportedMetricCodes = provenance.marketComparison.metrics
    .filter(({ metricCode }) => opportunityMetricDirection(metricCode) === null)
    .map(({ metricCode }) => metricCode);
  return [
    ...(scores.marketPotential === null
      ? [{ code: "MARKET_DATA_UNAVAILABLE" as const }]
      : []),
    ...(scores.productReadiness === null
      ? [{ code: "PRODUCT_DATA_UNAVAILABLE" as const }]
      : []),
    ...(scores.regulatoryCoverage === null
      ? [{ code: "REGULATORY_DATA_UNAVAILABLE" as const }]
      : []),
    ...(unknownCount > 0
      ? [{ code: "PRODUCT_READINESS_UNKNOWN" as const, count: unknownCount }]
      : []),
    ...(unsupportedMetricCodes.length > 0
      ? [
          {
            code: "UNSUPPORTED_METRIC_DIRECTION" as const,
            metricCodes: unsupportedMetricCodes,
          },
        ]
      : []),
  ];
}

function provenanceInputsAreValid(
  provenance: OpportunityScoreProvenance,
  query: OpportunityScorecard["query"],
  sources: AnalysisSource[],
): boolean {
  return (
    comparisonQueryMatches(provenance, query) &&
    marketComparisonSourcesMatchFacts(provenance.marketComparison) &&
    marketComparisonMatchesDeterministicRules(provenance.marketComparison) &&
    regulationComparisonSourcesMatchVisibleFacts(
      provenance.regulationComparison,
    ) &&
    regulationComparisonMatchesDeterministicRules(
      provenance.regulationComparison,
    ) &&
    provenance.productEvaluations.every(({ countryIso3, evaluations }) =>
      evaluationSetMatchesQuery(evaluations, provenance, query, countryIso3),
    ) &&
    sourcesMatchProvenance(sources, provenance)
  );
}

/** Validates one score against independently replayable comparison/product facts. */
export function countryScoreMatchesTrustedProvenance(input: {
  provenance: OpportunityScoreProvenance;
  query: OpportunityScorecard["query"];
  score: CountryOpportunityScore;
  sources: AnalysisSource[];
  weights: OpportunityScoreWeights;
}): boolean {
  try {
    if (
      !input.query.countryIso3s.includes(input.score.countryIso3) ||
      !countryOpportunityScoreMatchesMath(input.score, input.weights) ||
      !provenanceInputsAreValid(input.provenance, input.query, input.sources)
    ) {
      return false;
    }
    const expected = dimensionScores(
      input.provenance,
      input.score.countryIso3,
    );
    return (
      exactSequence(
        input.score.components.map(({ key }) => key),
        ["marketPotential", "productReadiness", "regulatoryCoverage"],
      ) &&
      input.score.components.every(
        (component) => component.score === expected[component.key],
      ) &&
      exactJson(
        input.score.gaps,
        expectedGaps(input.provenance, input.score.countryIso3),
      )
    );
  } catch {
    return false;
  }
}

/**
 * Replays market-comparison, product-fit and score rules from typed facts.
 * This proves internal consistency and entity/source binding, not source truth,
 * omitted database rows or synchronization across independent upstream reads.
 */
export function opportunityScorecardMatchesTrustedProvenance(
  scorecard: OpportunityScorecard,
): boolean {
  return (
    exactSequence(
      scorecard.scores.map(({ countryIso3 }) => countryIso3),
      scorecard.query.countryIso3s,
    ) &&
    scorecard.scores.every((score) =>
      countryScoreMatchesTrustedProvenance({
        provenance: scorecard.provenance,
        query: scorecard.query,
        score,
        sources: scorecard.sources,
        weights: scorecard.weights,
      }),
    )
  );
}
