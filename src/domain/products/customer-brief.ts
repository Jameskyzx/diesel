import type {
  CatalogFitQuery,
  CatalogFitRegulation,
  CatalogFitResult,
  CatalogRecord,
} from "@/features/product-catalog/schemas";

/**
 * A customer-facing brief built only from a deterministic catalogue-fit
 * result. It recommends nothing the ruleset did not return: candidates are the
 * `declared_match` models, every number and citation is copied from the
 * result, and the language of the document is applied later by the renderer.
 */
export type CustomerBrief = {
  query: CatalogFitQuery;
  rulesetVersion: CatalogFitResult["rulesetVersion"];
  regulations: CatalogFitRegulation[];
  candidates: { record: CatalogRecord; coveredCitations: string[] }[];
  /** Models inside the scope and rating band whose declaration misses a regulation. */
  declarationGapCount: number;
  noRegulationData: boolean;
  /** At least one regulation record comes from a real (non-demo) source. */
  realRegulationData: boolean;
  fictionalCatalogue: true;
};

export function buildCustomerBrief(result: CatalogFitResult): CustomerBrief {
  const citationsById = new Map(result.applicableRegulations.map(regulation => [regulation.regulationId, regulation.citationCode]));
  return {
    query: result.query,
    rulesetVersion: result.rulesetVersion,
    regulations: result.applicableRegulations,
    candidates: result.evaluations
      .filter(evaluation => evaluation.status === "declared_match")
      .map(evaluation => ({
        record: evaluation.record,
        coveredCitations: evaluation.declaredRegulationIds.flatMap(id => citationsById.get(id) ?? []),
      })),
    declarationGapCount: result.counts.declaration_gap,
    noRegulationData: result.applicableRegulations.length === 0,
    realRegulationData: result.applicableRegulations.some(regulation => !regulation.isDemo),
    fictionalCatalogue: result.catalog.isDemo,
  };
}
