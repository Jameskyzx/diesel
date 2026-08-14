import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  vector,
} from "drizzle-orm/pg-core";

import { applicationScopes } from "@/features/database/schemas";

export const applicationScopeEnum = pgEnum(
  "application_scope",
  applicationScopes,
);
export const certificationStatusEnum = pgEnum("certification_status", [
  "pending",
  "active",
  "expired",
  "withdrawn",
  "unknown",
]);
export const documentTypeEnum = pgEnum("document_type", [
  "regulation-text",
  "government-notice",
  "product-manual",
  "industry-report",
  "certificate",
  "other",
]);
export const documentProcessingStatusEnum = pgEnum(
  "document_processing_status",
  ["pending", "processing", "ready", "failed"],
);
export const jurisdictionTypeEnum = pgEnum("jurisdiction_type", [
  "country",
  "regional",
  "international",
]);
export const regulationStatusEnum = pgEnum("regulation_status", [
  "proposed",
  "adopted",
  "effective",
  "superseded",
]);
export const sourceTypeEnum = pgEnum("source_type", [
  "official-regulation",
  "government-notice",
  "product-manual",
  "industry-report",
  "certificate",
  "demo",
  "other",
]);
export const aiToolCallStatusEnum = pgEnum("ai_tool_call_status", [
  "success",
  "no_data",
  "error",
]);
export const aiToolNameEnum = pgEnum("ai_tool_name", [
  "searchKnowledgeBase",
  "getCountryProfile",
  "findCompatibleProducts",
  "compareRegulations",
  "compareMarkets",
  "calculateOpportunityScore",
  "generateSalesBrief",
]);
export const governanceWorkflowStatusEnum = pgEnum(
  "governance_workflow_status",
  ["draft", "reviewed", "published"],
);
export const governedEntityTypeEnum = pgEnum("governed_entity_type", [
  "country",
  "regulation",
  "product",
  "product_certification",
  "market_metric",
  "data_source",
  "document",
  "jurisdiction",
]);
export const adminRoleEnum = pgEnum("admin_role", [
  "editor",
  "reviewer",
  "admin",
]);
export const dataChangeActionEnum = pgEnum("data_change_action", [
  "draft_created",
  "reviewed",
  "published",
  "archived",
  "import_previewed",
  "import_committed",
  "document_reprocessed",
  "source_verified",
]);
export const marketImportStatusEnum = pgEnum("market_import_status", [
  "previewed",
  "committed",
  "rejected",
]);

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export const dataSources = pgTable(
  "data_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    publisher: text("publisher"),
    sourceType: sourceTypeEnum("source_type").notNull(),
    url: text("url"),
    publishedOn: date("published_on"),
    verifiedAt: timestamp("verified_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    isDemo: boolean("is_demo").default(false).notNull(),
    demoNotice: text("demo_notice"),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    archivedAt: timestamp("archived_at", {
      mode: "date",
      withTimezone: true,
    }),
  },
  (table) => [
    index("data_sources_type_verified_idx").on(
      table.sourceType,
      table.verifiedAt,
    ),
    check(
      "data_sources_demo_notice_check",
      sql`NOT ${table.isDemo} OR ${table.demoNotice} IS NOT NULL`,
    ),
    check(
      "data_sources_demo_type_check",
      sql`${table.isDemo} = (${table.sourceType} = 'demo')`,
    ),
  ],
);

export const countries = pgTable(
  "countries",
  {
    iso3: varchar("iso3", { length: 3 }).primaryKey(),
    iso2: varchar("iso2", { length: 2 }).notNull().unique(),
    nameEn: text("name_en").notNull(),
    nameLocal: text("name_local"),
    regionCode: text("region_code"),
    subregionCode: text("subregion_code"),
    dataCoverageStatus: text("data_coverage_status").default("none").notNull(),
    dataSourceId: uuid("data_source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "restrict" }),
    verifiedAt: timestamp("verified_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    isDemo: boolean("is_demo").default(false).notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    archivedAt: timestamp("archived_at", {
      mode: "date",
      withTimezone: true,
    }),
  },
  (table) => [
    index("countries_data_source_idx").on(table.dataSourceId),
    index("countries_region_idx").on(table.regionCode, table.subregionCode),
    check("countries_iso3_check", sql`${table.iso3} ~ '^[A-Z]{3}$'`),
    check("countries_iso2_check", sql`${table.iso2} ~ '^[A-Z]{2}$'`),
    check(
      "countries_coverage_status_check",
      sql`${table.dataCoverageStatus} IN ('none', 'demo', 'planned', 'no_data', 'covered')`,
    ),
    check(
      "countries_demo_coverage_check",
      sql`${table.isDemo} = (${table.dataCoverageStatus} = 'demo')`,
    ),
  ],
);

export const jurisdictions = pgTable(
  "jurisdictions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    type: jurisdictionTypeEnum("type").notNull(),
    countryIso3: varchar("country_iso3", { length: 3 }).references(
      () => countries.iso3,
      { onDelete: "restrict" },
    ),
    websiteUrl: text("website_url"),
    dataSourceId: uuid("data_source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "restrict" }),
    verifiedAt: timestamp("verified_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    isDemo: boolean("is_demo").default(false).notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    archivedAt: timestamp("archived_at", {
      mode: "date",
      withTimezone: true,
    }),
  },
  (table) => [
    index("jurisdictions_country_idx").on(table.countryIso3),
    index("jurisdictions_data_source_idx").on(table.dataSourceId),
    check(
      "jurisdictions_country_type_check",
      sql`(${table.type} = 'country' AND ${table.countryIso3} IS NOT NULL) OR (${table.type} <> 'country' AND ${table.countryIso3} IS NULL)`,
    ),
  ],
);

export const countryJurisdictions = pgTable(
  "country_jurisdictions",
  {
    countryIso3: varchar("country_iso3", { length: 3 })
      .notNull()
      .references(() => countries.iso3, { onDelete: "cascade" }),
    jurisdictionId: uuid("jurisdiction_id")
      .notNull()
      .references(() => jurisdictions.id, { onDelete: "cascade" }),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    dataSourceId: uuid("data_source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "restrict" }),
    verifiedAt: timestamp("verified_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    isDemo: boolean("is_demo").default(false).notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    archivedAt: timestamp("archived_at", {
      mode: "date",
      withTimezone: true,
    }),
  },
  (table) => [
    primaryKey({
      columns: [
        table.countryIso3,
        table.jurisdictionId,
        table.validFrom,
      ],
      name: "country_jurisdictions_pk",
    }),
    index("country_jurisdictions_jurisdiction_idx").on(table.jurisdictionId),
    index("country_jurisdictions_validity_idx").on(
      table.countryIso3,
      table.validFrom,
      table.validTo,
    ),
    index("country_jurisdictions_source_idx").on(table.dataSourceId),
    check(
      "country_jurisdictions_validity_check",
      sql`${table.validTo} IS NULL OR ${table.validTo} > ${table.validFrom}`,
    ),
  ],
);

export const regulations = pgTable(
  "regulations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jurisdictionId: uuid("jurisdiction_id")
      .notNull()
      .references(() => jurisdictions.id, { onDelete: "restrict" }),
    canonicalName: text("canonical_name").notNull(),
    citationCode: text("citation_code"),
    status: regulationStatusEnum("status").notNull(),
    proposedOn: date("proposed_on"),
    adoptedOn: date("adopted_on"),
    effectiveFrom: date("effective_from"),
    effectiveTo: date("effective_to"),
    summary: text("summary"),
    dataSourceId: uuid("data_source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "restrict" }),
    verifiedAt: timestamp("verified_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    isDemo: boolean("is_demo").default(false).notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    archivedAt: timestamp("archived_at", {
      mode: "date",
      withTimezone: true,
    }),
  },
  (table) => [
    index("regulations_jurisdiction_status_validity_idx").on(
      table.jurisdictionId,
      table.status,
      table.effectiveFrom,
      table.effectiveTo,
    ),
    index("regulations_data_source_idx").on(table.dataSourceId),
    uniqueIndex("regulations_jurisdiction_citation_idx").on(
      table.jurisdictionId,
      table.citationCode,
    ),
    check(
      "regulations_effective_validity_check",
      sql`${table.effectiveTo} IS NULL OR (${table.effectiveFrom} IS NOT NULL AND ${table.effectiveTo} > ${table.effectiveFrom})`,
    ),
    check(
      "regulations_effective_date_required_check",
      sql`${table.status} <> 'effective' OR ${table.effectiveFrom} IS NOT NULL`,
    ),
  ],
);

export const regulationLimits = pgTable(
  "regulation_limits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    regulationId: uuid("regulation_id")
      .notNull()
      .references(() => regulations.id, { onDelete: "cascade" }),
    applicationScope: applicationScopeEnum("application_scope").notNull(),
    engineTypeCode: text("engine_type_code").default("CI").notNull(),
    powerMinKw: numeric("power_min_kw", {
      mode: "number",
      precision: 12,
      scale: 3,
    }),
    powerMaxKw: numeric("power_max_kw", {
      mode: "number",
      precision: 12,
      scale: 3,
    }),
    pollutantCode: text("pollutant_code").notNull(),
    limitValue: numeric("limit_value", {
      precision: 18,
      scale: 6,
    }).notNull(),
    unitCode: text("unit_code").notNull(),
    measurementBasis: text("measurement_basis"),
    testCycleCode: text("test_cycle_code"),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    dataSourceId: uuid("data_source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "restrict" }),
    verifiedAt: timestamp("verified_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    isDemo: boolean("is_demo").default(false).notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    archivedAt: timestamp("archived_at", {
      mode: "date",
      withTimezone: true,
    }),
  },
  (table) => [
    index("regulation_limits_regulation_scope_validity_idx").on(
      table.regulationId,
      table.applicationScope,
      table.validFrom,
      table.validTo,
    ),
    index("regulation_limits_power_idx").on(
      table.powerMinKw,
      table.powerMaxKw,
    ),
    index("regulation_limits_data_source_idx").on(table.dataSourceId),
    check(
      "regulation_limits_power_check",
      sql`(${table.powerMinKw} IS NULL OR ${table.powerMinKw} >= 0) AND (${table.powerMaxKw} IS NULL OR ${table.powerMaxKw} > 0) AND (${table.powerMinKw} IS NULL OR ${table.powerMaxKw} IS NULL OR ${table.powerMaxKw} > ${table.powerMinKw})`,
    ),
    check(
      "regulation_limits_value_check",
      sql`${table.limitValue} >= 0`,
    ),
    check(
      "regulation_limits_validity_check",
      sql`${table.validTo} IS NULL OR ${table.validTo} > ${table.validFrom}`,
    ),
  ],
);

type ProductParameters = Record<
  string,
  boolean | number | string | null
>;

export const products = pgTable(
  "products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    modelCode: text("model_code").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    applicationScopes: applicationScopeEnum("application_scopes")
      .array()
      .notNull(),
    powerMinKw: numeric("power_min_kw", {
      mode: "number",
      precision: 12,
      scale: 3,
    }).notNull(),
    powerMaxKw: numeric("power_max_kw", {
      mode: "number",
      precision: 12,
      scale: 3,
    }).notNull(),
    specificationVersion: text("specification_version").notNull(),
    parameters: jsonb("parameters")
      .$type<ProductParameters>()
      .default({})
      .notNull(),
    availableFrom: date("available_from"),
    availableTo: date("available_to"),
    dataSourceId: uuid("data_source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "restrict" }),
    verifiedAt: timestamp("verified_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    isDemo: boolean("is_demo").default(false).notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    archivedAt: timestamp("archived_at", {
      mode: "date",
      withTimezone: true,
    }),
  },
  (table) => [
    index("products_power_idx").on(table.powerMinKw, table.powerMaxKw),
    index("products_availability_idx").on(
      table.availableFrom,
      table.availableTo,
    ),
    index("products_data_source_idx").on(table.dataSourceId),
    check(
      "products_power_check",
      sql`${table.archivedAt} IS NOT NULL OR (${table.powerMinKw} >= 0 AND ${table.powerMaxKw} > ${table.powerMinKw})`,
    ),
    check(
      "products_availability_check",
      sql`${table.availableTo} IS NULL OR (${table.availableFrom} IS NOT NULL AND ${table.availableTo} > ${table.availableFrom})`,
    ),
    check(
      "products_application_scopes_check",
      sql`cardinality(${table.applicationScopes}) > 0`,
    ),
  ],
);

export const productCertifications = pgTable(
  "product_certifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    regulationId: uuid("regulation_id")
      .notNull()
      .references(() => regulations.id, { onDelete: "restrict" }),
    applicationScope: applicationScopeEnum("application_scope").notNull(),
    certificateNumber: text("certificate_number"),
    status: certificationStatusEnum("status").notNull(),
    powerMinKw: numeric("power_min_kw", {
      mode: "number",
      precision: 12,
      scale: 3,
    }),
    powerMaxKw: numeric("power_max_kw", {
      mode: "number",
      precision: 12,
      scale: 3,
    }),
    validFrom: date("valid_from"),
    validTo: date("valid_to"),
    dataSourceId: uuid("data_source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "restrict" }),
    verifiedAt: timestamp("verified_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    isDemo: boolean("is_demo").default(false).notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    archivedAt: timestamp("archived_at", {
      mode: "date",
      withTimezone: true,
    }),
  },
  (table) => [
    index("product_certifications_product_regulation_idx").on(
      table.productId,
      table.regulationId,
    ),
    index("product_certifications_status_validity_idx").on(
      table.status,
      table.validFrom,
      table.validTo,
    ),
    index("product_certifications_data_source_idx").on(table.dataSourceId),
    uniqueIndex("product_certifications_number_idx").on(
      table.productId,
      table.regulationId,
      table.certificateNumber,
    ),
    check(
      "product_certifications_power_check",
      sql`(${table.powerMinKw} IS NULL OR ${table.powerMinKw} >= 0) AND (${table.powerMaxKw} IS NULL OR ${table.powerMaxKw} > 0) AND (${table.powerMinKw} IS NULL OR ${table.powerMaxKw} IS NULL OR ${table.powerMaxKw} > ${table.powerMinKw})`,
    ),
    check(
      "product_certifications_validity_check",
      sql`${table.validTo} IS NULL OR (${table.validFrom} IS NOT NULL AND ${table.validTo} > ${table.validFrom})`,
    ),
  ],
);

export const marketMetrics = pgTable(
  "market_metrics",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    countryIso3: varchar("country_iso3", { length: 3 })
      .notNull()
      .references(() => countries.iso3, { onDelete: "cascade" }),
    metricCode: text("metric_code").notNull(),
    metricName: text("metric_name").notNull(),
    definition: text("definition").notNull(),
    applicationScope: applicationScopeEnum("application_scope"),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    valueNumeric: numeric("value_numeric", {
      precision: 24,
      scale: 6,
    }).notNull(),
    unitCode: text("unit_code").notNull(),
    currencyCode: varchar("currency_code", { length: 3 }),
    methodologyVersion: text("methodology_version").notNull(),
    publishedOn: date("published_on"),
    dataSourceId: uuid("data_source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "restrict" }),
    verifiedAt: timestamp("verified_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    isDemo: boolean("is_demo").default(false).notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    archivedAt: timestamp("archived_at", {
      mode: "date",
      withTimezone: true,
    }),
  },
  (table) => [
    uniqueIndex("market_metrics_scoped_observation_idx")
      .on(
        table.countryIso3,
        table.metricCode,
        table.applicationScope,
        table.periodStart,
        table.periodEnd,
        table.dataSourceId,
      )
      .where(sql`${table.applicationScope} IS NOT NULL`),
    uniqueIndex("market_metrics_global_observation_idx")
      .on(
        table.countryIso3,
        table.metricCode,
        table.periodStart,
        table.periodEnd,
        table.dataSourceId,
      )
      .where(sql`${table.applicationScope} IS NULL`),
    index("market_metrics_country_period_idx").on(
      table.countryIso3,
      table.metricCode,
      table.periodStart,
      table.periodEnd,
    ),
    index("market_metrics_data_source_idx").on(table.dataSourceId),
    check(
      "market_metrics_period_check",
      sql`${table.periodEnd} > ${table.periodStart}`,
    ),
    check(
      "market_metrics_currency_check",
      sql`${table.currencyCode} IS NULL OR ${table.currencyCode} ~ '^[A-Z]{3}$'`,
    ),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    dataSourceId: uuid("data_source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "restrict" }),
    type: documentTypeEnum("type").notNull(),
    title: text("title").notNull(),
    canonicalUrl: text("canonical_url"),
    storagePath: text("storage_path"),
    originalFilename: text("original_filename"),
    mimeType: text("mime_type"),
    byteSize: integer("byte_size"),
    languageCode: varchar("language_code", { length: 10 }).notNull(),
    publishedOn: date("published_on"),
    validFrom: date("valid_from"),
    validTo: date("valid_to"),
    contentSha256: varchar("content_sha256", { length: 64 }).notNull().unique(),
    licenseCode: text("license_code"),
    redistributionAllowed: boolean("redistribution_allowed"),
    verifiedAt: timestamp("verified_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    isDemo: boolean("is_demo").default(false).notNull(),
    demoNotice: text("demo_notice"),
    processingStatus: documentProcessingStatusEnum("processing_status")
      .default("pending")
      .notNull(),
    processingError: text("processing_error"),
    processedAt: timestamp("processed_at", {
      mode: "date",
      withTimezone: true,
    }),
    governanceStatus: governanceWorkflowStatusEnum("governance_status")
      .default("draft")
      .notNull(),
    reviewedAt: timestamp("reviewed_at", {
      mode: "date",
      withTimezone: true,
    }),
    governancePublishedAt: timestamp("governance_published_at", {
      mode: "date",
      withTimezone: true,
    }),
    archivedAt: timestamp("archived_at", {
      mode: "date",
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("documents_data_source_idx").on(table.dataSourceId),
    index("documents_processing_status_idx").on(
      table.processingStatus,
      table.updatedAt,
    ),
    index("documents_governance_status_idx").on(
      table.governanceStatus,
      table.archivedAt,
      table.updatedAt,
    ),
    index("documents_type_validity_idx").on(
      table.type,
      table.validFrom,
      table.validTo,
    ),
    check(
      "documents_validity_check",
      sql`${table.validTo} IS NULL OR (${table.validFrom} IS NOT NULL AND ${table.validTo} > ${table.validFrom})`,
    ),
    check(
      "documents_hash_check",
      sql`${table.contentSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "documents_demo_notice_check",
      sql`NOT ${table.isDemo} OR ${table.demoNotice} IS NOT NULL`,
    ),
    check(
      "documents_byte_size_check",
      sql`${table.byteSize} IS NULL OR ${table.byteSize} >= 0`,
    ),
    check(
      "documents_processing_error_check",
      sql`${table.processingStatus} <> 'failed' OR ${table.processingError} IS NOT NULL`,
    ),
  ],
);

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    headingPath: text("heading_path").array(),
    pageFrom: integer("page_from"),
    pageTo: integer("page_to"),
    sectionLocator: text("section_locator"),
    content: text("content").notNull(),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce("content", ''))`,
    ),
    embedding: vector("embedding", { dimensions: 128 }),
    embeddingModel: text("embedding_model"),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    jurisdictionId: uuid("jurisdiction_id").references(
      () => jurisdictions.id,
      { onDelete: "set null" },
    ),
    countryIso3: varchar("country_iso3", { length: 3 }).references(
      () => countries.iso3,
      { onDelete: "set null" },
    ),
    applicationScope: applicationScopeEnum("application_scope"),
    validFrom: date("valid_from"),
    validTo: date("valid_to"),
    tokenCount: integer("token_count"),
    verifiedAt: timestamp("verified_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    isDemo: boolean("is_demo").default(false).notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("document_chunks_document_index_idx").on(
      table.documentId,
      table.chunkIndex,
    ),
    index("document_chunks_document_hash_idx").on(
      table.documentId,
      table.contentHash,
    ),
    index("document_chunks_search_vector_idx").using(
      "gin",
      table.searchVector,
    ),
    index("document_chunks_country_scope_validity_idx").on(
      table.countryIso3,
      table.applicationScope,
      table.validFrom,
      table.validTo,
    ),
    index("document_chunks_jurisdiction_idx").on(table.jurisdictionId),
    check("document_chunks_index_check", sql`${table.chunkIndex} >= 0`),
    check(
      "document_chunks_pages_check",
      sql`(${table.pageFrom} IS NULL OR ${table.pageFrom} > 0) AND (${table.pageTo} IS NULL OR (${table.pageFrom} IS NOT NULL AND ${table.pageTo} >= ${table.pageFrom}))`,
    ),
    check(
      "document_chunks_validity_check",
      sql`${table.validTo} IS NULL OR (${table.validFrom} IS NOT NULL AND ${table.validTo} > ${table.validFrom})`,
    ),
    check(
      "document_chunks_hash_check",
      sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "document_chunks_token_count_check",
      sql`${table.tokenCount} IS NULL OR ${table.tokenCount} >= 0`,
    ),
  ],
);

type GovernanceJson = Record<string, unknown>;
type MarketImportPreviewRow = {
  parsed: GovernanceJson | null;
  rowNumber: number;
};
type MarketImportValidationError = {
  field: string | null;
  message: string;
  rowNumber: number;
};

export const dataGovernanceDrafts = pgTable(
  "data_governance_drafts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entityType: governedEntityTypeEnum("entity_type").notNull(),
    entityKey: text("entity_key").notNull(),
    version: integer("version").notNull(),
    workflowStatus: governanceWorkflowStatusEnum("workflow_status")
      .default("draft")
      .notNull(),
    payload: jsonb("payload").$type<GovernanceJson>().notNull(),
    changeReason: text("change_reason").notNull(),
    createdBy: text("created_by").notNull(),
    reviewedBy: text("reviewed_by"),
    publishedBy: text("published_by"),
    reviewedAt: timestamp("reviewed_at", {
      mode: "date",
      withTimezone: true,
    }),
    publishedAt: timestamp("published_at", {
      mode: "date",
      withTimezone: true,
    }),
    archivedAt: timestamp("archived_at", {
      mode: "date",
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("data_governance_drafts_entity_version_idx").on(
      table.entityType,
      table.entityKey,
      table.version,
    ),
    index("data_governance_drafts_workflow_idx").on(
      table.workflowStatus,
      table.entityType,
      table.updatedAt,
    ),
    check("data_governance_drafts_version_check", sql`${table.version} > 0`),
  ],
);

export const marketImportBatches = pgTable(
  "market_import_batches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    status: marketImportStatusEnum("status").default("previewed").notNull(),
    originalFilename: text("original_filename").notNull(),
    contentSha256: varchar("content_sha256", { length: 64 }).notNull(),
    previewRows: jsonb("preview_rows")
      .$type<MarketImportPreviewRow[]>()
      .notNull(),
    validationErrors: jsonb("validation_errors")
      .$type<MarketImportValidationError[]>()
      .notNull(),
    totalRows: integer("total_rows").notNull(),
    validRows: integer("valid_rows").notNull(),
    invalidRows: integer("invalid_rows").notNull(),
    createdBy: text("created_by").notNull(),
    confirmedBy: text("confirmed_by"),
    committedAt: timestamp("committed_at", {
      mode: "date",
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("market_import_batches_status_created_idx").on(
      table.status,
      table.createdAt,
    ),
    check(
      "market_import_batches_counts_check",
      sql`${table.totalRows} >= 0 AND ${table.validRows} >= 0 AND ${table.invalidRows} >= 0 AND ${table.totalRows} = ${table.validRows} + ${table.invalidRows}`,
    ),
    check(
      "market_import_batches_hash_check",
      sql`${table.contentSha256} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const dataChangeLogs = pgTable(
  "data_change_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entityType: governedEntityTypeEnum("entity_type").notNull(),
    entityKey: text("entity_key").notNull(),
    action: dataChangeActionEnum("action").notNull(),
    actorEmail: text("actor_email").notNull(),
    actorRole: adminRoleEnum("actor_role").notNull(),
    draftId: uuid("draft_id").references(() => dataGovernanceDrafts.id, {
      onDelete: "set null",
    }),
    importBatchId: uuid("import_batch_id").references(
      () => marketImportBatches.id,
      { onDelete: "set null" },
    ),
    beforeData: jsonb("before_data").$type<GovernanceJson>(),
    afterData: jsonb("after_data").$type<GovernanceJson>(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("data_change_logs_entity_created_idx").on(
      table.entityType,
      table.entityKey,
      table.createdAt,
    ),
    index("data_change_logs_actor_created_idx").on(
      table.actorEmail,
      table.createdAt,
    ),
    index("data_change_logs_draft_idx").on(table.draftId),
    index("data_change_logs_batch_idx").on(table.importBatchId),
  ],
);

export const apiRateLimitBuckets = pgTable(
  "api_rate_limit_buckets",
  {
    scope: varchar("scope", { length: 80 }).notNull(),
    keyHash: varchar("key_hash", { length: 64 }).notNull(),
    windowStart: timestamp("window_start", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    requestCount: integer("request_count").notNull(),
    expiresAt: timestamp("expires_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.scope, table.keyHash, table.windowStart],
      name: "api_rate_limit_buckets_pk",
    }),
    index("api_rate_limit_buckets_expiry_idx").on(table.expiresAt),
    check(
      "api_rate_limit_buckets_key_hash_check",
      sql`${table.keyHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "api_rate_limit_buckets_count_check",
      sql`${table.requestCount} > 0`,
    ),
    check(
      "api_rate_limit_buckets_expiry_check",
      sql`${table.expiresAt} > ${table.windowStart}`,
    ),
  ],
);

type AuditJson = Record<string, unknown>;

export const aiChatSessions = pgTable(
  "ai_chat_sessions",
  {
    id: uuid("id").primaryKey(),
    selectedCountryIso3: varchar("selected_country_iso3", { length: 3 }),
    modelId: text("model_id").notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("ai_chat_sessions_updated_idx").on(table.updatedAt),
    check(
      "ai_chat_sessions_country_iso3_check",
      sql`${table.selectedCountryIso3} IS NULL OR ${table.selectedCountryIso3} ~ '^[A-Z]{3}$'`,
    ),
  ],
);

export const aiToolCalls = pgTable(
  "ai_tool_calls",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => aiChatSessions.id, { onDelete: "cascade" }),
    toolCallId: text("tool_call_id").notNull(),
    toolName: aiToolNameEnum("tool_name").notNull(),
    status: aiToolCallStatusEnum("status").notNull(),
    input: jsonb("input").$type<AuditJson>().notNull(),
    resultSummary: jsonb("result_summary").$type<AuditJson>().notNull(),
    errorCode: text("error_code"),
    durationMs: integer("duration_ms").notNull(),
    startedAt: timestamp("started_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    completedAt: timestamp("completed_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("ai_tool_calls_session_call_idx").on(
      table.sessionId,
      table.toolCallId,
    ),
    index("ai_tool_calls_tool_status_created_idx").on(
      table.toolName,
      table.status,
      table.createdAt,
    ),
    check("ai_tool_calls_duration_check", sql`${table.durationMs} >= 0`),
    check(
      "ai_tool_calls_time_check",
      sql`${table.completedAt} >= ${table.startedAt}`,
    ),
  ],
);

export const aiCitations = pgTable(
  "ai_citations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    toolCallAuditId: uuid("tool_call_audit_id")
      .notNull()
      .references(() => aiToolCalls.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => aiChatSessions.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "restrict" }),
    documentId: uuid("document_id").references(() => documents.id, {
      onDelete: "restrict",
    }),
    chunkId: uuid("chunk_id").references(() => documentChunks.id, {
      onDelete: "restrict",
    }),
    regulationId: uuid("regulation_id").references(() => regulations.id, {
      onDelete: "restrict",
    }),
    productCertificationId: uuid("product_certification_id").references(
      () => productCertifications.id,
      { onDelete: "restrict" },
    ),
    countryIso3: varchar("country_iso3", { length: 3 }).references(
      () => countries.iso3,
      { onDelete: "set null" },
    ),
    title: text("title").notNull(),
    locator: text("locator"),
    sourceUrl: text("source_url"),
    pageFrom: integer("page_from"),
    pageTo: integer("page_to"),
    sectionLocator: text("section_locator"),
    regulationStatus: regulationStatusEnum("regulation_status"),
    publishedOn: date("published_on"),
    verifiedAt: timestamp("verified_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    isDemo: boolean("is_demo").default(false).notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("ai_citations_session_created_idx").on(
      table.sessionId,
      table.createdAt,
    ),
    index("ai_citations_source_idx").on(table.sourceId),
    index("ai_citations_document_chunk_idx").on(
      table.documentId,
      table.chunkId,
    ),
    index("ai_citations_regulation_idx").on(table.regulationId),
    index("ai_citations_certification_idx").on(
      table.productCertificationId,
    ),
    check(
      "ai_citations_pages_check",
      sql`(${table.pageFrom} IS NULL OR ${table.pageFrom} > 0) AND (${table.pageTo} IS NULL OR (${table.pageFrom} IS NOT NULL AND ${table.pageTo} >= ${table.pageFrom}))`,
    ),
  ],
);
