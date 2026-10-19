import snapshot from "@/server/db/seed/demo-engine-catalog.json";
import { catalogSnapshotSchema } from "@/features/product-catalog/schemas";

/**
 * The fictional demo engine catalogue as a governed fixture. The offline demo
 * seeds it directly; production publishes it through governance drafts with
 * scripts/db/ingest-demo-catalogue.ts. Model codes start with DEMO- and the
 * source uses an RFC 2606 `.invalid` URL.
 */
export const demoEngineCatalogFixture = catalogSnapshotSchema.parse(snapshot);

export const demoCatalogSourceId = "00000000-0000-4000-8000-000000000007";
export const demoCatalogVerifiedAt = "2026-10-17T00:00:00.000Z";

export const demoCatalogSource = {
  demoNotice: demoEngineCatalogFixture.notice,
  id: demoCatalogSourceId,
  isDemo: true,
  publishedOn: "2026-10-17",
  publisher: "Fictional Demo Engine Catalogue",
  sourceType: "demo" as const,
  title: demoEngineCatalogFixture.title,
  url: "https://example.invalid/demo/engine-catalogue",
};

/** Governance draft payloads (catalog_engine) for every fixture record. */
export function demoCatalogDraftPayloads() {
  return demoEngineCatalogFixture.records.map((record) => ({
    aftertreatment: record.aftertreatment,
    applicationScopes: record.applicationScopes,
    category: record.category,
    cylinders: record.cylinders,
    dataSourceId: demoCatalogSourceId,
    declaredCitationCodes: record.declaredCitationCodes,
    displacementL: record.displacementL,
    emissionLabel: record.emissionLabel,
    id: record.id,
    isDemo: true,
    modelCode: record.model,
    powerMaxKw: record.powerMaxKw,
    powerMinKw: record.powerMinKw,
    ratedPowerKw: record.ratedPowerKw,
    ratedSpeedRpm: record.ratedSpeedRpm,
    series: record.series,
    verifiedAt: demoCatalogVerifiedAt,
  }));
}
