import { compareCanonicalText } from "@/domain/canonical-order";
import {
  catalogFitResultSchema,
  catalogFitStatuses,
  type CatalogFitEvaluation,
  type CatalogFitQuery,
  type CatalogFitRegulation,
  type CatalogFitResult,
  type CatalogFitStatus,
  type CatalogRecord,
  type CatalogSnapshot,
} from "@/features/product-catalog/schemas";

const statusOrder = new Map<CatalogFitStatus, number>(catalogFitStatuses.map((status, index) => [status, index]));

/**
 * catalog-fit-v1: compare each catalogue model's declared citation codes with
 * the regulations that apply to one country, scope, power and date.
 *
 * Matching is literal. A declaration is never promoted to certification, no
 * cross-jurisdiction equivalence is inferred, and a regulation without a
 * citation code can never be declared. Every applicable regulation must be
 * named for `declared_match`; anything less is a `declaration_gap`.
 */
export function evaluateCatalogRecordFit(
  record: CatalogRecord,
  query: CatalogFitQuery,
  applicableRegulations: readonly CatalogFitRegulation[],
): CatalogFitEvaluation {
  const scopeMatch = record.applicationScopes.includes(query.applicationScope);
  const powerMatch = query.powerKw >= record.powerMinKw && query.powerKw < record.powerMaxKw;
  const declared = new Set(record.declaredCitationCodes);
  const declaredRegulationIds: string[] = [];
  const undeclaredRegulationIds: string[] = [];
  for (const regulation of applicableRegulations) {
    (regulation.citationCode !== null && declared.has(regulation.citationCode)
      ? declaredRegulationIds
      : undeclaredRegulationIds).push(regulation.regulationId);
  }

  const [status, reason]: [CatalogFitEvaluation["status"], CatalogFitEvaluation["reason"]] =
    !scopeMatch ? ["not_fit", "APPLICATION_SCOPE_MISMATCH"]
      : !powerMatch ? ["not_fit", "POWER_OUT_OF_RANGE"]
        : applicableRegulations.length === 0 ? ["unknown", "NO_APPLICABLE_REGULATION_DATA"]
          : undeclaredRegulationIds.length === 0 ? ["declared_match", "DECLARATION_COVERS_ALL_APPLICABLE"]
            : ["declaration_gap", "DECLARATION_GAP"];

  return { record, status, reason, scopeMatch, powerMatch, declaredRegulationIds, undeclaredRegulationIds };
}

export function evaluateCatalogFit(input: {
  catalog: CatalogSnapshot;
  query: CatalogFitQuery;
  applicableRegulations: readonly CatalogFitRegulation[];
}): CatalogFitResult {
  const applicableRegulations = input.applicableRegulations.toSorted((left, right) =>
    compareCanonicalText(`${left.citationCode ?? ""}\u0000${left.regulationId}`, `${right.citationCode ?? ""}\u0000${right.regulationId}`));
  const evaluations = input.catalog.records
    .map(record => evaluateCatalogRecordFit(record, input.query, applicableRegulations))
    .toSorted((left, right) =>
      (statusOrder.get(left.status) ?? 0) - (statusOrder.get(right.status) ?? 0) ||
      compareCanonicalText(left.record.model, right.record.model));
  const counts = Object.fromEntries(catalogFitStatuses.map(status =>
    [status, evaluations.filter(evaluation => evaluation.status === status).length])) as Record<CatalogFitStatus, number>;

  return catalogFitResultSchema.parse({
    kind: "catalog_fit",
    rulesetVersion: "catalog-fit-v1",
    evidenceBasis: "manufacturer_declaration",
    certificationVerified: false,
    catalog: { isDemo: input.catalog.isDemo, title: input.catalog.title, evidenceStatus: input.catalog.evidenceStatus },
    query: input.query,
    applicableRegulations,
    evaluations,
    counts,
  });
}
