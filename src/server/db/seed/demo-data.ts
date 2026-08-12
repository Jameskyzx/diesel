import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "@/server/db/schema";
import {
  countries,
  countryJurisdictions,
  dataSources,
  documentChunks,
  documents,
  jurisdictions,
  marketMetrics,
  productCertifications,
  products,
  regulationLimits,
  regulations,
} from "@/server/db/schema";
import {
  countryCatalog,
  plannedCoverageIso3,
} from "@/server/db/seed/country-catalog";

const demoTimestamp = new Date("2026-01-15T00:00:00.000Z");
const demoRecordTimestamps = {
  createdAt: demoTimestamp,
  updatedAt: demoTimestamp,
  verifiedAt: demoTimestamp,
} as const;

const demoNotice =
  "FICTIONAL DEMO DATA — NOT A REAL REGULATION, CERTIFICATION, OR MARKET SOURCE.";

export const demoIds = {
  certification: {
    engine100China: "00000000-0000-4000-8000-000000000401",
  },
  document: {
    product: "00000000-0000-4000-8000-000000000502",
    regulation: "00000000-0000-4000-8000-000000000501",
  },
  documentChunk: {
    product: "00000000-0000-4000-8000-000000000602",
    regulation: "00000000-0000-4000-8000-000000000601",
  },
  jurisdiction: {
    brazil: "00000000-0000-4000-8000-000000000102",
    china: "00000000-0000-4000-8000-000000000101",
  },
  limit: {
    brazilNox: "00000000-0000-4000-8000-000000000305",
    chinaAdoptedNox: "00000000-0000-4000-8000-000000000306",
    chinaEffectiveNox: "00000000-0000-4000-8000-000000000301",
    chinaEffectivePm: "00000000-0000-4000-8000-000000000302",
    chinaProposedNox: "00000000-0000-4000-8000-000000000303",
    chinaSupersededNox: "00000000-0000-4000-8000-000000000304",
  },
  marketMetric: {
    brazil: "00000000-0000-4000-8000-000000000702",
    china: "00000000-0000-4000-8000-000000000701",
  },
  product: {
    certified: "00000000-0000-4000-8000-000000000201",
    uncertified: "00000000-0000-4000-8000-000000000202",
  },
  regulation: {
    brazilEffective: "00000000-0000-4000-8000-000000000204",
    chinaAdopted: "00000000-0000-4000-8000-000000000205",
    chinaEffective: "00000000-0000-4000-8000-000000000201",
    chinaProposed: "00000000-0000-4000-8000-000000000202",
    chinaSuperseded: "00000000-0000-4000-8000-000000000203",
  },
  source: {
    country: "00000000-0000-4000-8000-000000000001",
    countryDirectory: "00000000-0000-4000-8000-000000000006",
    market: "00000000-0000-4000-8000-000000000004",
    product: "00000000-0000-4000-8000-000000000003",
    regulation: "00000000-0000-4000-8000-000000000002",
    certification: "00000000-0000-4000-8000-000000000005",
  },
} as const;

const demoSources = [
  {
    ...demoRecordTimestamps,
    demoNotice,
    id: demoIds.source.country,
    isDemo: true,
    publishedOn: "2026-01-01",
    publisher: "Demo Data Team",
    sourceType: "demo",
    title: "DEMO ONLY — Fictional country metadata source",
    url: "https://example.invalid/demo/countries",
  },
  {
    ...demoRecordTimestamps,
    demoNotice,
    id: demoIds.source.regulation,
    isDemo: true,
    publishedOn: "2026-01-02",
    publisher: "Fictional Demo Authority",
    sourceType: "demo",
    title: "DEMO ONLY — Fictional emissions bulletin",
    url: "https://example.invalid/demo/regulations",
  },
  {
    ...demoRecordTimestamps,
    demoNotice,
    id: demoIds.source.product,
    isDemo: true,
    publishedOn: "2026-01-03",
    publisher: "Demo Engine Company",
    sourceType: "demo",
    title: "DEMO ONLY — Fictional product manual",
    url: "https://example.invalid/demo/products",
  },
  {
    ...demoRecordTimestamps,
    demoNotice,
    id: demoIds.source.market,
    isDemo: true,
    publishedOn: "2026-01-04",
    publisher: "Demo Market Lab",
    sourceType: "demo",
    title: "DEMO ONLY — Fictional market report",
    url: "https://example.invalid/demo/market",
  },
  {
    ...demoRecordTimestamps,
    demoNotice,
    id: demoIds.source.certification,
    isDemo: true,
    publishedOn: "2026-01-05",
    publisher: "Fictional Demo Certification Office",
    sourceType: "demo",
    title: "DEMO ONLY — Fictional product certificate",
    url: "https://example.invalid/demo/certificates",
  },
  {
    ...demoRecordTimestamps,
    id: demoIds.source.countryDirectory,
    isDemo: false,
    publishedOn: "2026-01-01",
    publisher: "Natural Earth",
    sourceType: "other",
    title: "World country directory — Natural Earth (public domain)",
    url: "https://www.naturalearthdata.com/",
  },
] satisfies (typeof dataSources.$inferInsert)[];

const demoCountries = [
  {
    ...demoRecordTimestamps,
    dataCoverageStatus: "demo",
    dataSourceId: demoIds.source.country,
    isDemo: true,
    iso2: "CN",
    iso3: "CHN",
    nameEn: "China — demo fixture",
    nameLocal: "中国（演示数据）",
    regionCode: "ASIA",
    subregionCode: "EASTERN_ASIA",
  },
  {
    ...demoRecordTimestamps,
    dataCoverageStatus: "demo",
    dataSourceId: demoIds.source.country,
    isDemo: true,
    iso2: "BR",
    iso3: "BRA",
    nameEn: "Brazil — demo fixture",
    nameLocal: "Brasil — dados de demonstração",
    regionCode: "AMERICAS",
    subregionCode: "SOUTH_AMERICA",
  },
  {
    ...demoRecordTimestamps,
    dataCoverageStatus: "demo",
    dataSourceId: demoIds.source.country,
    isDemo: true,
    iso2: "DE",
    iso3: "DEU",
    nameEn: "Germany — demo fixture",
    nameLocal: "Deutschland — Demodaten",
    regionCode: "EUROPE",
    subregionCode: "WESTERN_EUROPE",
  },
] satisfies (typeof countries.$inferInsert)[];

const demoCountryIso3 = new Set(demoCountries.map(({ iso3 }) => iso3));

/**
 * ADR-040/067 全球基础目录：178 个目录 ISO3 全量入库（其中 177 个有地图几何）。分层覆盖目标为
 * `planned`，其余为 `no_data`；与虚构 Demo fixture 不同，目录行是公共
 * 领域 Natural Earth 名称与区域归类，`is_demo = false`，但不含任何
 * 法规、市场或产品事实。`onConflictDoNothing` 保证 CHN/BRA/DEU 保留
 * 已有 Demo fixture 行。
 */
const catalogCountries = countryCatalog
  .filter(({ iso3 }) => !demoCountryIso3.has(iso3))
  .map(
    (entry) =>
      ({
        ...demoRecordTimestamps,
        ...entry,
        dataCoverageStatus: plannedCoverageIso3.has(entry.iso3)
          ? "planned"
          : "no_data",
        dataSourceId: demoIds.source.countryDirectory,
        isDemo: false,
      }) satisfies typeof countries.$inferInsert,
  );

const demoJurisdictions = [
  {
    ...demoRecordTimestamps,
    code: "DEMO-CHN-AUTHORITY",
    countryIso3: "CHN",
    dataSourceId: demoIds.source.regulation,
    id: demoIds.jurisdiction.china,
    isDemo: true,
    name: "DEMO ONLY — Fictional China Emissions Authority",
    type: "country",
    websiteUrl: "https://example.invalid/demo/china-authority",
  },
  {
    ...demoRecordTimestamps,
    code: "DEMO-BRA-AUTHORITY",
    countryIso3: "BRA",
    dataSourceId: demoIds.source.regulation,
    id: demoIds.jurisdiction.brazil,
    isDemo: true,
    name: "DEMO ONLY — Fictional Brazil Emissions Authority",
    type: "country",
    websiteUrl: "https://example.invalid/demo/brazil-authority",
  },
] satisfies (typeof jurisdictions.$inferInsert)[];

const demoCountryJurisdictions = [
  {
    ...demoRecordTimestamps,
    countryIso3: "CHN",
    dataSourceId: demoIds.source.regulation,
    isDemo: true,
    jurisdictionId: demoIds.jurisdiction.china,
    validFrom: "2000-01-01",
  },
  {
    ...demoRecordTimestamps,
    countryIso3: "BRA",
    dataSourceId: demoIds.source.regulation,
    isDemo: true,
    jurisdictionId: demoIds.jurisdiction.brazil,
    validFrom: "2000-01-01",
  },
] satisfies (typeof countryJurisdictions.$inferInsert)[];

const demoRegulations = [
  {
    ...demoRecordTimestamps,
    adoptedOn: "2024-06-01",
    canonicalName: "DEMO ONLY — Fictional China Non-road Stage A",
    citationCode: "DEMO-CHN-NR-A",
    dataSourceId: demoIds.source.regulation,
    effectiveFrom: "2025-01-01",
    id: demoIds.regulation.chinaEffective,
    isDemo: true,
    jurisdictionId: demoIds.jurisdiction.china,
    status: "effective",
    summary: `${demoNotice} Used only to test effective-date queries.`,
  },
  {
    ...demoRecordTimestamps,
    canonicalName: "DEMO ONLY — Fictional China Non-road Stage B Proposal",
    citationCode: "DEMO-CHN-NR-B-PROPOSAL",
    dataSourceId: demoIds.source.regulation,
    effectiveFrom: "2030-01-01",
    id: demoIds.regulation.chinaProposed,
    isDemo: true,
    jurisdictionId: demoIds.jurisdiction.china,
    proposedOn: "2026-01-01",
    status: "proposed",
    summary: `${demoNotice} A proposed record must never appear as effective.`,
  },
  {
    ...demoRecordTimestamps,
    adoptedOn: "2026-01-10",
    canonicalName: "DEMO ONLY — Fictional China Non-road Stage C Adopted",
    citationCode: "DEMO-CHN-NR-C-ADOPTED",
    dataSourceId: demoIds.source.regulation,
    effectiveFrom: "2030-01-01",
    id: demoIds.regulation.chinaAdopted,
    isDemo: true,
    jurisdictionId: demoIds.jurisdiction.china,
    status: "adopted",
    summary: `${demoNotice} Adopted demo record with a future effective date.`,
  },
  {
    ...demoRecordTimestamps,
    adoptedOn: "2019-06-01",
    canonicalName: "DEMO ONLY — Fictional China Non-road Stage Z",
    citationCode: "DEMO-CHN-NR-Z",
    dataSourceId: demoIds.source.regulation,
    effectiveFrom: "2020-01-01",
    effectiveTo: "2025-01-01",
    id: demoIds.regulation.chinaSuperseded,
    isDemo: true,
    jurisdictionId: demoIds.jurisdiction.china,
    status: "superseded",
    summary: `${demoNotice} Used only to test historical validity.`,
  },
  {
    ...demoRecordTimestamps,
    adoptedOn: "2024-07-01",
    canonicalName: "DEMO ONLY — Fictional Brazil Non-road Stage A",
    citationCode: "DEMO-BRA-NR-A",
    dataSourceId: demoIds.source.regulation,
    effectiveFrom: "2025-07-01",
    id: demoIds.regulation.brazilEffective,
    isDemo: true,
    jurisdictionId: demoIds.jurisdiction.brazil,
    status: "effective",
    summary: `${demoNotice} Used only to test country isolation.`,
  },
] satisfies (typeof regulations.$inferInsert)[];

const demoRegulationLimits = [
  {
    ...demoRecordTimestamps,
    applicationScope: "non-road",
    dataSourceId: demoIds.source.regulation,
    id: demoIds.limit.chinaEffectiveNox,
    isDemo: true,
    limitValue: "3.500000",
    measurementBasis: "DEMO ONLY — fictional test basis",
    pollutantCode: "NOX",
    powerMaxKw: 560,
    powerMinKw: 0,
    regulationId: demoIds.regulation.chinaEffective,
    testCycleCode: "DEMO-CYCLE-A",
    unitCode: "g/kWh",
    validFrom: "2025-01-01",
  },
  {
    ...demoRecordTimestamps,
    applicationScope: "non-road",
    dataSourceId: demoIds.source.regulation,
    id: demoIds.limit.chinaEffectivePm,
    isDemo: true,
    limitValue: "0.025000",
    measurementBasis: "DEMO ONLY — fictional test basis",
    pollutantCode: "PM",
    powerMaxKw: 560,
    powerMinKw: 0,
    regulationId: demoIds.regulation.chinaEffective,
    testCycleCode: "DEMO-CYCLE-A",
    unitCode: "g/kWh",
    validFrom: "2025-01-01",
  },
  {
    ...demoRecordTimestamps,
    applicationScope: "non-road",
    dataSourceId: demoIds.source.regulation,
    id: demoIds.limit.chinaProposedNox,
    isDemo: true,
    limitValue: "2.000000",
    measurementBasis: "DEMO ONLY — fictional proposed basis",
    pollutantCode: "NOX",
    powerMaxKw: 560,
    powerMinKw: 0,
    regulationId: demoIds.regulation.chinaProposed,
    testCycleCode: "DEMO-CYCLE-B",
    unitCode: "g/kWh",
    validFrom: "2030-01-01",
  },
  {
    ...demoRecordTimestamps,
    applicationScope: "non-road",
    dataSourceId: demoIds.source.regulation,
    id: demoIds.limit.chinaAdoptedNox,
    isDemo: true,
    limitValue: "1.500000",
    measurementBasis: "DEMO ONLY — fictional adopted future basis",
    pollutantCode: "NOX",
    powerMaxKw: 560,
    powerMinKw: 0,
    regulationId: demoIds.regulation.chinaAdopted,
    testCycleCode: "DEMO-CYCLE-C",
    unitCode: "g/kWh",
    validFrom: "2030-01-01",
  },
  {
    ...demoRecordTimestamps,
    applicationScope: "non-road",
    dataSourceId: demoIds.source.regulation,
    id: demoIds.limit.chinaSupersededNox,
    isDemo: true,
    limitValue: "5.000000",
    measurementBasis: "DEMO ONLY — fictional historical basis",
    pollutantCode: "NOX",
    powerMaxKw: 560,
    powerMinKw: 0,
    regulationId: demoIds.regulation.chinaSuperseded,
    testCycleCode: "DEMO-CYCLE-Z",
    unitCode: "g/kWh",
    validFrom: "2020-01-01",
    validTo: "2025-01-01",
  },
  {
    ...demoRecordTimestamps,
    applicationScope: "non-road",
    dataSourceId: demoIds.source.regulation,
    id: demoIds.limit.brazilNox,
    isDemo: true,
    limitValue: "4.000000",
    measurementBasis: "DEMO ONLY — fictional test basis",
    pollutantCode: "NOX",
    powerMaxKw: 600,
    powerMinKw: 0,
    regulationId: demoIds.regulation.brazilEffective,
    testCycleCode: "DEMO-CYCLE-BRA",
    unitCode: "g/kWh",
    validFrom: "2025-07-01",
  },
] satisfies (typeof regulationLimits.$inferInsert)[];

const demoProducts = [
  {
    ...demoRecordTimestamps,
    applicationScopes: ["non-road", "construction"],
    availableFrom: "2025-01-01",
    dataSourceId: demoIds.source.product,
    description: `${demoNotice} Certified demo fixture.`,
    id: demoIds.product.certified,
    isDemo: true,
    modelCode: "DEMO-ENG-100",
    name: "DEMO ONLY — Fictional Engine 100",
    parameters: {
      cylinders: 6,
      note: demoNotice,
    },
    powerMaxKw: 150,
    powerMinKw: 50,
    specificationVersion: "demo-v1",
  },
  {
    ...demoRecordTimestamps,
    applicationScopes: ["non-road"],
    availableFrom: "2025-01-01",
    dataSourceId: demoIds.source.product,
    description: `${demoNotice} Uncertified demo fixture.`,
    id: demoIds.product.uncertified,
    isDemo: true,
    modelCode: "DEMO-ENG-200",
    name: "DEMO ONLY — Fictional Engine 200",
    parameters: {
      cylinders: 4,
      note: demoNotice,
    },
    powerMaxKw: 120,
    powerMinKw: 40,
    specificationVersion: "demo-v1",
  },
] satisfies (typeof products.$inferInsert)[];

const demoCertifications = [
  {
    ...demoRecordTimestamps,
    applicationScope: "non-road",
    certificateNumber: "DEMO-CERT-CHN-100",
    dataSourceId: demoIds.source.certification,
    id: demoIds.certification.engine100China,
    isDemo: true,
    powerMaxKw: 150,
    powerMinKw: 50,
    productId: demoIds.product.certified,
    regulationId: demoIds.regulation.chinaEffective,
    status: "active",
    validFrom: "2025-01-01",
  },
] satisfies (typeof productCertifications.$inferInsert)[];

const demoMarketMetrics = [
  {
    ...demoRecordTimestamps,
    applicationScope: "non-road",
    countryIso3: "CHN",
    dataSourceId: demoIds.source.market,
    definition: `${demoNotice} Fictional annual addressable unit count.`,
    id: demoIds.marketMetric.china,
    isDemo: true,
    methodologyVersion: "demo-v1",
    metricCode: "DEMO_ADDRESSABLE_UNITS",
    metricName: "DEMO ONLY — Fictional addressable units",
    periodEnd: "2026-01-01",
    periodStart: "2025-01-01",
    publishedOn: "2026-01-04",
    unitCode: "units",
    valueNumeric: "12345.000000",
  },
  {
    ...demoRecordTimestamps,
    applicationScope: "non-road",
    countryIso3: "BRA",
    dataSourceId: demoIds.source.market,
    definition: `${demoNotice} Fictional annual addressable unit count.`,
    id: demoIds.marketMetric.brazil,
    isDemo: true,
    methodologyVersion: "demo-v1",
    metricCode: "DEMO_ADDRESSABLE_UNITS",
    metricName: "DEMO ONLY — Fictional addressable units",
    periodEnd: "2026-01-01",
    periodStart: "2025-01-01",
    publishedOn: "2026-01-04",
    unitCode: "units",
    valueNumeric: "6789.000000",
  },
] satisfies (typeof marketMetrics.$inferInsert)[];

const demoDocuments = [
  {
    ...demoRecordTimestamps,
    canonicalUrl: "https://example.invalid/demo/regulation-document",
    contentSha256: "a".repeat(64),
    dataSourceId: demoIds.source.regulation,
    demoNotice,
    id: demoIds.document.regulation,
    isDemo: true,
    languageCode: "en",
    licenseCode: "DEMO-NOT-FOR-PRODUCTION",
    mimeType: "text/markdown",
    governancePublishedAt: demoTimestamp,
    governanceStatus: "published",
    originalFilename: "demo-regulation.md",
    processedAt: demoTimestamp,
    processingStatus: "ready",
    publishedOn: "2026-01-02",
    redistributionAllowed: true,
    title: "DEMO ONLY — Fictional regulation document",
    type: "regulation-text",
    validFrom: "2025-01-01",
  },
  {
    ...demoRecordTimestamps,
    canonicalUrl: "https://example.invalid/demo/product-document",
    contentSha256: "c".repeat(64),
    dataSourceId: demoIds.source.product,
    demoNotice,
    id: demoIds.document.product,
    isDemo: true,
    languageCode: "en",
    licenseCode: "DEMO-NOT-FOR-PRODUCTION",
    mimeType: "text/markdown",
    governancePublishedAt: demoTimestamp,
    governanceStatus: "published",
    originalFilename: "demo-product.md",
    processedAt: demoTimestamp,
    processingStatus: "ready",
    publishedOn: "2026-01-03",
    redistributionAllowed: true,
    title: "DEMO ONLY — Fictional product document",
    type: "product-manual",
  },
] satisfies (typeof documents.$inferInsert)[];

const demoDocumentChunks = [
  {
    ...demoRecordTimestamps,
    applicationScope: "non-road",
    chunkIndex: 0,
    content: `${demoNotice} This chunk contains no real regulatory requirement.`,
    contentHash: "b".repeat(64),
    countryIso3: "CHN",
    documentId: demoIds.document.regulation,
    headingPath: ["DEMO ONLY", "Fictional requirements"],
    id: demoIds.documentChunk.regulation,
    isDemo: true,
    jurisdictionId: demoIds.jurisdiction.china,
    pageFrom: 1,
    pageTo: 1,
    sectionLocator: "DEMO-SECTION-1",
    tokenCount: 12,
    validFrom: "2025-01-01",
  },
  {
    ...demoRecordTimestamps,
    applicationScope: "non-road",
    chunkIndex: 0,
    content: `${demoNotice} This chunk contains no real product specification.`,
    contentHash: "d".repeat(64),
    documentId: demoIds.document.product,
    headingPath: ["DEMO ONLY", "Fictional product"],
    id: demoIds.documentChunk.product,
    isDemo: true,
    pageFrom: 1,
    pageTo: 1,
    sectionLocator: "DEMO-PRODUCT-1",
    tokenCount: 12,
  },
] satisfies (typeof documentChunks.$inferInsert)[];

export async function seedDemoData<TQueryResult extends PgQueryResultHKT>(
  database: PgDatabase<TQueryResult, typeof schema>,
): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction.insert(dataSources).values(demoSources).onConflictDoNothing();
    await transaction.insert(countries).values(demoCountries).onConflictDoNothing();
    await transaction
      .insert(countries)
      .values(catalogCountries)
      .onConflictDoNothing();
    await transaction
      .insert(jurisdictions)
      .values(demoJurisdictions)
      .onConflictDoNothing();
    await transaction
      .insert(countryJurisdictions)
      .values(demoCountryJurisdictions)
      .onConflictDoNothing();
    await transaction
      .insert(regulations)
      .values(demoRegulations)
      .onConflictDoNothing();
    await transaction
      .insert(regulationLimits)
      .values(demoRegulationLimits)
      .onConflictDoNothing();
    await transaction.insert(products).values(demoProducts).onConflictDoNothing();
    await transaction
      .insert(productCertifications)
      .values(demoCertifications)
      .onConflictDoNothing();
    await transaction
      .insert(marketMetrics)
      .values(demoMarketMetrics)
      .onConflictDoNothing();
    await transaction.insert(documents).values(demoDocuments).onConflictDoNothing();
    await transaction
      .insert(documentChunks)
      .values(demoDocumentChunks)
      .onConflictDoNothing();
  });
}
