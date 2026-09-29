import { evaluateProductFit } from "@/domain/product-fit/evaluate-product-fit";
import type {
  FitEvidenceSource,
  ProductFitEvaluation,
} from "@/features/product-fit/schemas";

type ProductFitCheck = ProductFitEvaluation["reasons"][number];

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function sameSource(
  left: FitEvidenceSource,
  right: FitEvidenceSource,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Rebuilds the exact duplicate-free source closure from visible fit facts. */
export function productFitEvaluationSourcesMatchFacts(
  evaluation: ProductFitEvaluation,
): boolean {
  const expected = [
    ...(evaluation.product
      ? [
          {
            ...evaluation.product.source,
            isDemo:
              evaluation.product.isDemo || evaluation.product.source.isDemo,
          },
        ]
      : []),
    ...evaluation.regulationChecks.flatMap(({ regulation }) => [
      {
        ...regulation.source,
        isDemo: regulation.isDemo || regulation.source.isDemo,
      },
      {
        ...regulation.applicability.jurisdiction.source,
        isDemo:
          regulation.applicability.jurisdiction.isDemo ||
          regulation.applicability.jurisdiction.source.isDemo,
      },
      {
        ...regulation.applicability.membership.source,
        isDemo:
          regulation.applicability.membership.isDemo ||
          regulation.applicability.membership.source.isDemo,
      },
      ...regulation.limitSources,
    ]),
    ...evaluation.regulationChecks.flatMap(({ certifications }) =>
      certifications.map(({ certification }) => ({
        ...certification.source,
        isDemo: certification.isDemo || certification.source.isDemo,
      })),
    ),
  ];
  const expectedById = new Map<string, FitEvidenceSource>();
  for (const source of expected) {
    const existing = expectedById.get(source.id);
    if (
      existing &&
      !sameSource(existing, { ...source, isDemo: existing.isDemo })
    ) {
      return false;
    }
    expectedById.set(
      source.id,
      existing
        ? { ...existing, isDemo: existing.isDemo || source.isDemo }
        : source,
    );
  }
  const actualById = new Map(
    evaluation.sources.map((source) => [source.id, source]),
  );
  return (
    actualById.size === evaluation.sources.length &&
    actualById.size === expectedById.size &&
    [...expectedById].every(([id, source]) => {
      const actual = actualById.get(id);
      return actual !== undefined && sameSource(actual, source);
    })
  );
}

function visibleRegulationAppliesAtInput(
  evaluation: ProductFitEvaluation,
): boolean {
  const { asOf, countryIso3 } = evaluation.input;

  return evaluation.regulationChecks.every(({ regulation }) => {
    const membership = regulation.applicability.membership;
    return (
      regulation.applicability.countryIso3 === countryIso3 &&
      membership.validFrom <= asOf &&
      (membership.validTo === null || asOf < membership.validTo) &&
      regulation.effectiveFrom !== null &&
      regulation.effectiveFrom <= asOf &&
      (regulation.effectiveTo === null || asOf < regulation.effectiveTo)
    );
  });
}

function projectCheck(check: ProductFitCheck) {
  return {
    code: check.code,
    message: check.message,
    status: check.status,
  };
}

function projectDerivedEvaluation(evaluation: ProductFitEvaluation) {
  return {
    asOf: evaluation.asOf,
    commercialReadiness: evaluation.commercialReadiness,
    productChecks: {
      applicationScope: projectCheck(
        evaluation.productChecks.applicationScope,
      ),
      availability: projectCheck(evaluation.productChecks.availability),
      power: projectCheck(evaluation.productChecks.power),
    },
    reasons: evaluation.reasons.map(projectCheck),
    regulationChecks: evaluation.regulationChecks.map((regulationCheck) => ({
      certifications: regulationCheck.certifications.map(
        (certificationCheck) => ({
          certificationId: certificationCheck.certification.id,
          reasons: certificationCheck.reasons.map(projectCheck),
          status: certificationCheck.status,
        }),
      ),
      code: regulationCheck.code,
      message: regulationCheck.message,
      regulationId: regulationCheck.regulation.regulationId,
      status: regulationCheck.status,
    })),
    rulesetVersion: evaluation.rulesetVersion,
    status: evaluation.status,
  };
}

/**
 * Replays product-fit-v2 from the raw facts that remain visible in an
 * evaluation, then compares every code-owned conclusion and diagnostic.
 *
 * Product, regulation, certification and source fields are treated as input
 * facts here, except that the visible regulation country, membership period
 * and effective period must themselves cover the query. Publication, source
 * identity, regulation limit scope/power and omitted database rows are
 * separate evidence concerns; this function only proves that the
 * deterministic projection is internally consistent with visible facts.
 */
export function productFitEvaluationMatchesDeterministicRules(
  evaluation: ProductFitEvaluation,
): boolean {
  const regulationIds = evaluation.regulationChecks.map(
    ({ regulation }) => regulation.regulationId,
  );
  const certifications = evaluation.regulationChecks.flatMap(
    ({ certifications: certificationChecks }) =>
      certificationChecks.map(({ certification }) => certification),
  );

  if (
    hasDuplicates(regulationIds) ||
    hasDuplicates(certifications.map(({ id }) => id)) ||
    !productFitEvaluationSourcesMatchFacts(evaluation) ||
    !visibleRegulationAppliesAtInput(evaluation)
  ) {
    return false;
  }

  try {
    const expected = evaluateProductFit({
      applicableRegulations: evaluation.regulationChecks.map(
        ({ regulation }) => regulation,
      ),
      certifications,
      product: evaluation.product,
      query: evaluation.input,
    });

    return (
      JSON.stringify(projectDerivedEvaluation(evaluation)) ===
      JSON.stringify(projectDerivedEvaluation(expected))
    );
  } catch {
    return false;
  }
}
