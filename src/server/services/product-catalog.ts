import "server-only";
import snapshot from "@/data/products/weichai-catalog.json";
import { catalogQuerySchema, catalogSnapshotSchema, type CatalogResult } from "@/features/product-catalog/schemas";

const catalog = catalogSnapshotSchema.parse(snapshot);
export const catalogSummary = {
  records: catalog.records.length, models: new Set(catalog.records.map(record => record.model)).size,
  families: catalog.familyCount, excludedHeaderRows: catalog.excludedHeaderRows.length,
  categories: [...new Set(catalog.records.map(record => record.category))],
  fuels: [...new Set(catalog.records.map(record => record.familyFuel))].filter(Boolean),
};

export function searchProductCatalog(input: unknown): CatalogResult {
  const query = catalogQuerySchema.parse(input);
  const words = query.query.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  const matches = catalog.records.filter(record => {
    const haystack = [record.model, record.product, record.category, record.application, record.familyFuel].join(" ").toLocaleLowerCase();
    return words.every(word => haystack.includes(word)) && (!query.category || record.category === query.category) &&
      (!query.fuel || record.familyFuel === query.fuel) && (!query.recordIds.length || query.recordIds.includes(record.id)) &&
      (query.minPowerKw === undefined || record.ratedPowerKw !== null && record.ratedPowerKw >= query.minPowerKw) &&
      (query.maxPowerKw === undefined || record.ratedPowerKw !== null && record.ratedPowerKw <= query.maxPowerKw);
  });
  return { kind: "product_catalog", evidenceStatus: catalog.evidenceStatus, query, total: matches.length,
    modelCount: new Set(matches.map(record => record.model)).size, workbook: catalog.workbook, sha256: catalog.sha256,
    records: matches.slice(query.offset, query.offset + query.limit) };
}
