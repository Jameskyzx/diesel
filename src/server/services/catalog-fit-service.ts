import "server-only";

import { evaluateCatalogFit } from "@/domain/products/evaluate-catalog-fit";
import {
  catalogFitQuerySchema,
  type CatalogFitRegulation,
  type CatalogFitResult,
} from "@/features/product-catalog/schemas";
import { getDatabase } from "@/server/db/client";
import { getDemoDatabase } from "@/server/db/demo-client";
import { getDatabaseMode } from "@/server/db/environment";
import {
  throwIfRequestAborted,
  type RequestSignalOptions,
} from "@/server/http/request-signal";
import {
  groupApplicableRegulationRows,
  type ApplicableRegulationRecord,
} from "@/server/repositories/applicable-regulations";
import { createRegulationRepository } from "@/server/repositories/regulation-repository";
import { loadPublishedCatalog } from "@/server/services/product-catalog";

async function getRegulationRepository(options: RequestSignalOptions) {
  throwIfRequestAborted(options.signal);
  if (getDatabaseMode() === "pglite-demo") {
    const database = await getDemoDatabase();
    throwIfRequestAborted(options.signal);
    return createRegulationRepository(database);
  }
  return createRegulationRepository(getDatabase());
}

function toCatalogFitRegulation(regulation: ApplicableRegulationRecord): CatalogFitRegulation {
  // The repository only returns rows in force at asOf, including a superseded
  // record inside its closed historical interval.
  if ((regulation.status !== "effective" && regulation.status !== "superseded") || regulation.effectiveFrom === null) {
    throw new Error("Catalogue-fit evidence contained a regulation that was not in force at the query date.");
  }
  return {
    regulationId: regulation.regulationId,
    citationCode: regulation.citationCode,
    canonicalName: regulation.canonicalName,
    recordStatus: regulation.status,
    effectiveFrom: regulation.effectiveFrom,
    effectiveTo: regulation.effectiveTo,
    jurisdictionCode: regulation.applicability.jurisdiction.code,
    isDemo: regulation.isDemo || regulation.source.isDemo,
    source: {
      id: regulation.source.id,
      title: regulation.source.title,
      url: regulation.source.url,
      verifiedAt: regulation.source.verifiedAt.toISOString(),
      isDemo: regulation.source.isDemo,
    },
  };
}

/** Rank every fictional catalogue model against one market's applicable regulations. */
export async function evaluateCatalogFitForMarket(
  input: unknown,
  options: RequestSignalOptions = {},
): Promise<CatalogFitResult> {
  const query = catalogFitQuerySchema.parse(input);
  const repository = await getRegulationRepository(options);
  const rows = await repository.findEffectiveByCountry(query, options);
  throwIfRequestAborted(options.signal);

  const catalog = await loadPublishedCatalog(options);
  throwIfRequestAborted(options.signal);

  return evaluateCatalogFit({
    catalog,
    query,
    applicableRegulations: groupApplicableRegulationRows(rows).map(toCatalogFitRegulation),
  });
}
