import "server-only";
import snapshot from "@/data/products/demo-engine-catalog.json";
import { catalogQuerySchema, catalogSnapshotSchema, type CatalogResult } from "@/features/product-catalog/schemas";

export const demoEngineCatalog = catalogSnapshotSchema.parse(snapshot);
export const catalogSummary = {
  records: demoEngineCatalog.records.length,
  series: new Set(demoEngineCatalog.records.map(record => record.series)).size,
  categories: [...new Set(demoEngineCatalog.records.map(record => record.category))],
};

export function searchProductCatalog(input: unknown): CatalogResult {
  const query = catalogQuerySchema.parse(input);
  const words = query.query.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  const matches = demoEngineCatalog.records.filter(record => {
    const haystack = [record.model, record.series, record.category, record.emissionLabel, ...record.applicationScopes].join(" ").toLocaleLowerCase();
    return words.every(word => haystack.includes(word)) && (!query.category || record.category === query.category) &&
      (!query.recordIds.length || query.recordIds.includes(record.id)) &&
      (query.minPowerKw === undefined || record.ratedPowerKw >= query.minPowerKw) &&
      (query.maxPowerKw === undefined || record.ratedPowerKw <= query.maxPowerKw);
  });
  return { kind: "product_catalog", isDemo: demoEngineCatalog.isDemo, title: demoEngineCatalog.title,
    evidenceStatus: demoEngineCatalog.evidenceStatus, query, total: matches.length,
    modelCount: new Set(matches.map(record => record.model)).size,
    records: matches.slice(query.offset, query.offset + query.limit) };
}
