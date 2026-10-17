import "server-only";
import { compareCanonicalText } from "@/domain/canonical-order";
import {
  catalogQuerySchema,
  catalogRecordSchema,
  publicCatalogIdentity,
  type CatalogRecord,
  type CatalogResult,
} from "@/features/product-catalog/schemas";
import { getDatabase } from "@/server/db/client";
import { getDemoDatabase } from "@/server/db/demo-client";
import { getDatabaseMode } from "@/server/db/environment";
import { throwIfRequestAborted, type RequestSignalOptions } from "@/server/http/request-signal";
import { createCatalogRepository } from "@/server/repositories/catalog-repository";

export type PublishedCatalog = typeof publicCatalogIdentity & { records: CatalogRecord[] };

async function getCatalogRepository(options: RequestSignalOptions) {
  throwIfRequestAborted(options.signal);
  if (getDatabaseMode() === "pglite-demo") {
    const database = await getDemoDatabase();
    throwIfRequestAborted(options.signal);
    return createCatalogRepository(database);
  }
  return createCatalogRepository(getDatabase());
}

/** The governed, published catalogue. It is empty until records are published. */
export async function loadPublishedCatalog(options: RequestSignalOptions = {}): Promise<PublishedCatalog> {
  const repository = await getCatalogRepository(options);
  const rows = await repository.listPublishedDemoEngines(options);
  const records = rows.map(({ modelCode, ...row }) => catalogRecordSchema.parse({ ...row, model: modelCode }))
    .toSorted((left, right) => compareCanonicalText(left.model, right.model));
  return { ...publicCatalogIdentity, records };
}

export function summarizeCatalog(catalog: PublishedCatalog) {
  return {
    records: catalog.records.length,
    series: new Set(catalog.records.map(record => record.series)).size,
    categories: [...new Set(catalog.records.map(record => record.category))],
  };
}

export function searchCatalog(catalog: PublishedCatalog, input: unknown): CatalogResult {
  const query = catalogQuerySchema.parse(input);
  const words = query.query.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  const matches = catalog.records.filter(record => {
    const haystack = [record.model, record.series, record.category, record.emissionLabel, ...record.applicationScopes].join(" ").toLocaleLowerCase();
    return words.every(word => haystack.includes(word)) && (!query.category || record.category === query.category) &&
      (!query.recordIds.length || query.recordIds.includes(record.id)) &&
      (query.minPowerKw === undefined || record.ratedPowerKw >= query.minPowerKw) &&
      (query.maxPowerKw === undefined || record.ratedPowerKw <= query.maxPowerKw);
  });
  return { kind: "product_catalog", ...publicCatalogIdentity, query, total: matches.length,
    modelCount: new Set(matches.map(record => record.model)).size,
    records: matches.slice(query.offset, query.offset + query.limit) };
}

export async function searchProductCatalog(input: unknown, options: RequestSignalOptions = {}): Promise<CatalogResult> {
  const query = catalogQuerySchema.parse(input);
  return searchCatalog(await loadPublishedCatalog(options), query);
}
