import { createHash, timingSafeEqual } from "node:crypto";

import { z } from "zod";

export const governanceTableNames = [
  "countries",
  "country_jurisdictions",
  "data_change_logs",
  "data_governance_drafts",
  "data_sources",
  "jurisdictions",
  "market_import_batches",
  "regulation_limits",
  "regulations",
] as const;

export type GovernanceTableName = (typeof governanceTableNames)[number];

export type PreciseGovernanceTimestampRow = {
  rowKey: string;
  tableName: GovernanceTableName;
  timestamps: Record<string, string | null>;
};

const rawGovernanceJsonTableNames = [
  "data_change_logs",
  "data_governance_drafts",
  "market_import_batches",
] as const satisfies readonly GovernanceTableName[];

type RawGovernanceJsonTableName =
  (typeof rawGovernanceJsonTableNames)[number];

export type RawGovernanceJsonRow = {
  jsonValues: Record<string, string | null>;
  rowKey: string;
  tableName: RawGovernanceJsonTableName;
};

const preciseGovernanceTimestampRowsSchema = z.array(
  z
    .object({
      rowKey: z.string(),
      tableName: z.enum(governanceTableNames),
      timestamps: z.record(z.string(), z.string().nullable()),
    })
    .strict(),
);

const rawGovernanceJsonRowsSchema = z.array(
  z
    .object({
      jsonValues: z.record(z.string(), z.string().nullable()),
      rowKey: z.string(),
      tableName: z.enum(rawGovernanceJsonTableNames),
    })
    .strict(),
);

const preciseTimestampConfig: Record<
  GovernanceTableName,
  {
    key: (row: Record<string, unknown>) => string;
    properties: ReadonlySet<string>;
  }
> = {
  countries: {
    key: (row) => String(row.iso3),
    properties: new Set([
      "verifiedAt",
      "createdAt",
      "updatedAt",
      "archivedAt",
    ]),
  },
  country_jurisdictions: {
    key: (row) => `${String(row.countryIso3)}:${String(row.jurisdictionId)}`,
    properties: new Set([
      "verifiedAt",
      "createdAt",
      "updatedAt",
      "archivedAt",
    ]),
  },
  data_change_logs: {
    key: (row) => String(row.id),
    properties: new Set(["createdAt"]),
  },
  data_governance_drafts: {
    key: (row) => String(row.id),
    properties: new Set([
      "reviewedAt",
      "publishedAt",
      "archivedAt",
      "createdAt",
      "updatedAt",
    ]),
  },
  data_sources: {
    key: (row) => String(row.id),
    properties: new Set([
      "verifiedAt",
      "createdAt",
      "updatedAt",
      "archivedAt",
    ]),
  },
  jurisdictions: {
    key: (row) => String(row.id),
    properties: new Set([
      "verifiedAt",
      "createdAt",
      "updatedAt",
      "archivedAt",
    ]),
  },
  market_import_batches: {
    key: (row) => String(row.id),
    properties: new Set(["committedAt", "createdAt"]),
  },
  regulation_limits: {
    key: (row) => String(row.id),
    properties: new Set([
      "verifiedAt",
      "createdAt",
      "updatedAt",
      "archivedAt",
    ]),
  },
  regulations: {
    key: (row) => String(row.id),
    properties: new Set([
      "verifiedAt",
      "createdAt",
      "updatedAt",
      "archivedAt",
    ]),
  },
};

const rawGovernanceJsonConfig: Record<
  RawGovernanceJsonTableName,
  {
    key: (row: Record<string, unknown>) => string;
    properties: ReadonlySet<string>;
  }
> = {
  data_change_logs: {
    key: (row) => String(row.id),
    properties: new Set(["beforeData", "afterData"]),
  },
  data_governance_drafts: {
    key: (row) => String(row.id),
    properties: new Set(["payload"]),
  },
  market_import_batches: {
    key: (row) => String(row.id),
    properties: new Set(["previewRows", "validationErrors"]),
  },
};

const uuidSchema = z.uuid();
const nullableUuidSchema = uuidSchema.nullable();
const dateSchema = z.iso.date();
const nullableDateSchema = dateSchema.nullable();
const timestampSchema = z.iso.datetime({ offset: true });
const nullableTimestampSchema = timestampSchema.nullable();
const iso3Schema = z.string().regex(/^[A-Z]{3}$/);
const iso2Schema = z.string().regex(/^[A-Z]{2}$/);
const governanceJsonSchema = z.record(z.string(), z.unknown());

function rawJsonTextSchema<T>(schema: z.ZodType<T>) {
  return z.string().superRefine((value, context) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      context.addIssue({
        code: "custom",
        message: "Expected PostgreSQL jsonb text",
      });
      return;
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
      context.addIssue({
        code: "custom",
        message: "PostgreSQL jsonb text has an invalid shape",
      });
    }
  });
}

const rawGovernanceJsonSchema = rawJsonTextSchema(governanceJsonSchema);

const sourceRowSchema = z
  .object({
    archivedAt: nullableTimestampSchema,
    createdAt: timestampSchema,
    demoNotice: z.string().nullable(),
    id: uuidSchema,
    isDemo: z.boolean(),
    publishedOn: nullableDateSchema,
    publisher: z.string().nullable(),
    sourceType: z.enum([
      "official-regulation",
      "government-notice",
      "product-manual",
      "industry-report",
      "certificate",
      "demo",
      "other",
    ]),
    title: z.string(),
    updatedAt: timestampSchema,
    url: z.string().nullable(),
    verifiedAt: timestampSchema,
  })
  .strict()
  .refine(
    (row) => row.isDemo === (row.sourceType === "demo"),
    "Source demo flag and type must agree",
  )
  .refine((row) => !row.isDemo || row.demoNotice !== null, {
    message: "Demo sources require a notice",
  });

const countryRowSchema = z
  .object({
    archivedAt: nullableTimestampSchema,
    createdAt: timestampSchema,
    dataCoverageStatus: z.enum([
      "none",
      "demo",
      "planned",
      "no_data",
      "covered",
    ]),
    dataSourceId: uuidSchema,
    isDemo: z.boolean(),
    iso2: iso2Schema,
    iso3: iso3Schema,
    nameEn: z.string(),
    nameLocal: z.string().nullable(),
    regionCode: z.string().nullable(),
    subregionCode: z.string().nullable(),
    updatedAt: timestampSchema,
    verifiedAt: timestampSchema,
  })
  .strict()
  .refine(
    (row) => row.isDemo === (row.dataCoverageStatus === "demo"),
    "Country demo flag and coverage must agree",
  );

const jurisdictionRowSchema = z
  .object({
    archivedAt: nullableTimestampSchema,
    code: z.string(),
    countryIso3: iso3Schema.nullable(),
    createdAt: timestampSchema,
    dataSourceId: uuidSchema,
    id: uuidSchema,
    isDemo: z.boolean(),
    name: z.string(),
    type: z.enum(["country", "regional", "international"]),
    updatedAt: timestampSchema,
    verifiedAt: timestampSchema,
    websiteUrl: z.string().nullable(),
  })
  .strict()
  .refine(
    (row) =>
      row.type === "country"
        ? row.countryIso3 !== null
        : row.countryIso3 === null,
    "Jurisdiction type and country must agree",
  );

const membershipRowSchema = z
  .object({
    archivedAt: nullableTimestampSchema,
    countryIso3: iso3Schema,
    createdAt: timestampSchema,
    dataSourceId: uuidSchema,
    isDemo: z.boolean(),
    jurisdictionId: uuidSchema,
    updatedAt: timestampSchema,
    validFrom: dateSchema,
    validTo: nullableDateSchema,
    verifiedAt: timestampSchema,
  })
  .strict()
  .refine((row) => row.validTo === null || row.validTo > row.validFrom, {
    message: "Membership validity end must follow its start",
  });

const regulationRowSchema = z
  .object({
    adoptedOn: nullableDateSchema,
    archivedAt: nullableTimestampSchema,
    canonicalName: z.string(),
    citationCode: z.string().nullable(),
    createdAt: timestampSchema,
    dataSourceId: uuidSchema,
    effectiveFrom: nullableDateSchema,
    effectiveTo: nullableDateSchema,
    id: uuidSchema,
    isDemo: z.boolean(),
    jurisdictionId: uuidSchema,
    proposedOn: nullableDateSchema,
    status: z.enum(["proposed", "adopted", "effective", "superseded"]),
    summary: z.string().nullable(),
    updatedAt: timestampSchema,
    verifiedAt: timestampSchema,
  })
  .strict()
  .refine(
    (row) => row.status !== "effective" || row.effectiveFrom !== null,
    "Effective regulations require an effective start",
  )
  .refine(
    (row) =>
      row.effectiveTo === null ||
      (row.effectiveFrom !== null && row.effectiveTo > row.effectiveFrom),
    "Regulation validity end must follow its start",
  );

const decimalSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, "Expected a non-negative decimal");

const limitRowSchema = z
  .object({
    applicationScope: z.enum([
      "on-road",
      "non-road",
      "marine",
      "generator-set",
      "agriculture",
      "construction",
      "on-road-truck",
      "on-road-bus",
    ]),
    archivedAt: nullableTimestampSchema,
    createdAt: timestampSchema,
    dataSourceId: uuidSchema,
    engineTypeCode: z.string(),
    id: uuidSchema,
    isDemo: z.boolean(),
    limitValue: decimalSchema,
    measurementBasis: z.string().nullable(),
    pollutantCode: z.string(),
    powerMaxKw: z.number().nonnegative().nullable(),
    powerMinKw: z.number().nonnegative().nullable(),
    regulationId: uuidSchema,
    testCycleCode: z.string().nullable(),
    unitCode: z.string(),
    updatedAt: timestampSchema,
    validFrom: dateSchema,
    validTo: nullableDateSchema,
    verifiedAt: timestampSchema,
  })
  .strict()
  .refine(
    (row) =>
      row.powerMaxKw === null ||
      (row.powerMaxKw > 0 &&
        (row.powerMinKw === null || row.powerMaxKw > row.powerMinKw)),
    "Limit maximum power must exceed its minimum",
  )
  .refine((row) => row.validTo === null || row.validTo > row.validFrom, {
    message: "Limit validity end must follow its start",
  });

const governedEntityTypeSchema = z.enum([
  "country",
  "regulation",
  "product",
  "product_certification",
  "market_metric",
  "data_source",
  "document",
  "jurisdiction",
]);

const governanceDraftRowSchema = z
  .object({
    archivedAt: nullableTimestampSchema,
    changeReason: z.string(),
    createdAt: timestampSchema,
    createdBy: z.string(),
    entityKey: z.string(),
    entityType: governedEntityTypeSchema,
    id: uuidSchema,
    payload: rawGovernanceJsonSchema,
    publishedAt: nullableTimestampSchema,
    publishedBy: z.string().nullable(),
    reviewedAt: nullableTimestampSchema,
    reviewedBy: z.string().nullable(),
    updatedAt: timestampSchema,
    version: z.number().int().positive(),
    workflowStatus: z.enum(["draft", "reviewed", "published"]),
  })
  .strict();

const previewRowSchema = z
  .object({
    parsed: governanceJsonSchema.nullable(),
    rowNumber: z.number().int(),
  })
  .strict();
const validationErrorSchema = z
  .object({
    field: z.string().nullable(),
    message: z.string(),
    rowNumber: z.number().int(),
  })
  .strict();

const marketImportBatchRowSchema = z
  .object({
    committedAt: nullableTimestampSchema,
    confirmedBy: z.string().nullable(),
    contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
    createdAt: timestampSchema,
    createdBy: z.string(),
    id: uuidSchema,
    invalidRows: z.number().int().nonnegative(),
    originalFilename: z.string(),
    previewRows: rawJsonTextSchema(z.array(previewRowSchema)),
    status: z.enum(["previewed", "committed", "rejected"]),
    totalRows: z.number().int().nonnegative(),
    validationErrors: rawJsonTextSchema(z.array(validationErrorSchema)),
    validRows: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (row) => row.totalRows === row.validRows + row.invalidRows,
    "Import batch counts must balance",
  );

const changeLogRowSchema = z
  .object({
    action: z.enum([
      "draft_created",
      "reviewed",
      "published",
      "archived",
      "import_previewed",
      "import_committed",
      "document_reprocessed",
      "source_verified",
    ]),
    actorEmail: z.string(),
    actorRole: z.enum(["editor", "reviewer", "admin"]),
    afterData: rawGovernanceJsonSchema.nullable(),
    beforeData: rawGovernanceJsonSchema.nullable(),
    createdAt: timestampSchema,
    draftId: nullableUuidSchema,
    entityKey: z.string(),
    entityType: governedEntityTypeSchema,
    id: uuidSchema,
    importBatchId: nullableUuidSchema,
    reason: z.string(),
  })
  .strict();

const tableCountsSchema = z
  .object(
    Object.fromEntries(
      governanceTableNames.map((tableName) => [
        tableName,
        z.number().int().nonnegative(),
      ]),
    ) as Record<GovernanceTableName, z.ZodNumber>,
  )
  .strict();

const tablesSchema = z
  .object({
    countries: z.array(countryRowSchema),
    country_jurisdictions: z.array(membershipRowSchema),
    data_change_logs: z.array(changeLogRowSchema),
    data_governance_drafts: z.array(governanceDraftRowSchema),
    data_sources: z.array(sourceRowSchema),
    jurisdictions: z.array(jurisdictionRowSchema),
    market_import_batches: z.array(marketImportBatchRowSchema),
    regulation_limits: z.array(limitRowSchema),
    regulations: z.array(regulationRowSchema),
  })
  .strict();

function reportDuplicateKeys(
  rows: readonly Record<string, unknown>[],
  key: (row: Record<string, unknown>) => string,
  context: z.RefinementCtx,
  path: readonly (number | string)[],
) {
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const value = key(row);
    if (seen.has(value)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate snapshot key: ${value}`,
        path: [...path, index],
      });
    }
    seen.add(value);
  });
}

const governanceSnapshotSchema = z
  .object({
    exportedAt: timestampSchema,
    formatVersion: z.literal(3),
    tableCounts: tableCountsSchema,
    tables: tablesSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    for (const tableName of governanceTableNames) {
      if (snapshot.tableCounts[tableName] !== snapshot.tables[tableName].length) {
        context.addIssue({
          code: "custom",
          message: `Declared count does not match ${tableName}`,
          path: ["tableCounts", tableName],
        });
      }
    }

    reportDuplicateKeys(
      snapshot.tables.data_sources,
      (row) => String(row.id),
      context,
      ["tables", "data_sources"],
    );
    reportDuplicateKeys(
      snapshot.tables.countries,
      (row) => String(row.iso3),
      context,
      ["tables", "countries"],
    );
    reportDuplicateKeys(
      snapshot.tables.countries,
      (row) => String(row.iso2),
      context,
      ["tables", "countries"],
    );
    reportDuplicateKeys(
      snapshot.tables.jurisdictions,
      (row) => String(row.id),
      context,
      ["tables", "jurisdictions"],
    );
    reportDuplicateKeys(
      snapshot.tables.jurisdictions,
      (row) => String(row.code),
      context,
      ["tables", "jurisdictions"],
    );
    reportDuplicateKeys(
      snapshot.tables.country_jurisdictions,
      (row) => `${String(row.countryIso3)}:${String(row.jurisdictionId)}`,
      context,
      ["tables", "country_jurisdictions"],
    );
    for (const tableName of [
      "regulations",
      "regulation_limits",
      "data_governance_drafts",
      "market_import_batches",
      "data_change_logs",
    ] as const) {
      reportDuplicateKeys(
        snapshot.tables[tableName],
        (row) => String(row.id),
        context,
        ["tables", tableName],
      );
    }
    reportDuplicateKeys(
      snapshot.tables.data_governance_drafts,
      (row) => `${String(row.entityType)}:${String(row.entityKey)}:${String(row.version)}`,
      context,
      ["tables", "data_governance_drafts"],
    );
    reportDuplicateKeys(
      snapshot.tables.regulations.filter(
        (row) => row.citationCode !== null,
      ),
      (row) => `${String(row.jurisdictionId)}:${String(row.citationCode)}`,
      context,
      ["tables", "regulations"],
    );

    const sourceIds = new Set(snapshot.tables.data_sources.map((row) => row.id));
    const countryIds = new Set(snapshot.tables.countries.map((row) => row.iso3));
    const jurisdictionIds = new Set(
      snapshot.tables.jurisdictions.map((row) => row.id),
    );
    const regulationIds = new Set(
      snapshot.tables.regulations.map((row) => row.id),
    );
    const draftIds = new Set(
      snapshot.tables.data_governance_drafts.map((row) => row.id),
    );
    const batchIds = new Set(
      snapshot.tables.market_import_batches.map((row) => row.id),
    );

    const requireReference = (
      exists: boolean,
      tableName: GovernanceTableName,
      index: number,
      field: string,
    ) => {
      if (!exists) {
        context.addIssue({
          code: "custom",
          message: "Snapshot reference is outside the governance closure",
          path: ["tables", tableName, index, field],
        });
      }
    };

    snapshot.tables.countries.forEach((row, index) =>
      requireReference(
        sourceIds.has(row.dataSourceId),
        "countries",
        index,
        "dataSourceId",
      ),
    );
    snapshot.tables.jurisdictions.forEach((row, index) => {
      requireReference(
        sourceIds.has(row.dataSourceId),
        "jurisdictions",
        index,
        "dataSourceId",
      );
      if (row.countryIso3 !== null) {
        requireReference(
          countryIds.has(row.countryIso3),
          "jurisdictions",
          index,
          "countryIso3",
        );
      }
    });
    snapshot.tables.country_jurisdictions.forEach((row, index) => {
      requireReference(
        countryIds.has(row.countryIso3),
        "country_jurisdictions",
        index,
        "countryIso3",
      );
      requireReference(
        jurisdictionIds.has(row.jurisdictionId),
        "country_jurisdictions",
        index,
        "jurisdictionId",
      );
      requireReference(
        sourceIds.has(row.dataSourceId),
        "country_jurisdictions",
        index,
        "dataSourceId",
      );
    });
    snapshot.tables.regulations.forEach((row, index) => {
      requireReference(
        jurisdictionIds.has(row.jurisdictionId),
        "regulations",
        index,
        "jurisdictionId",
      );
      requireReference(
        sourceIds.has(row.dataSourceId),
        "regulations",
        index,
        "dataSourceId",
      );
    });
    snapshot.tables.regulation_limits.forEach((row, index) => {
      requireReference(
        regulationIds.has(row.regulationId),
        "regulation_limits",
        index,
        "regulationId",
      );
      requireReference(
        sourceIds.has(row.dataSourceId),
        "regulation_limits",
        index,
        "dataSourceId",
      );
    });
    snapshot.tables.data_change_logs.forEach((row, index) => {
      if (row.draftId !== null) {
        requireReference(
          draftIds.has(row.draftId),
          "data_change_logs",
          index,
          "draftId",
        );
      }
      if (row.importBatchId !== null) {
        requireReference(
          batchIds.has(row.importBatchId),
          "data_change_logs",
          index,
          "importBatchId",
        );
      }
    });
  });

export type GovernanceSnapshot = z.infer<typeof governanceSnapshotSchema>;

export function createGovernanceTableCounts(
  tables: Record<GovernanceTableName, readonly unknown[]>,
): Record<GovernanceTableName, number> {
  return Object.fromEntries(
    governanceTableNames.map((tableName) => [
      tableName,
      tables[tableName].length,
    ]),
  ) as Record<GovernanceTableName, number>;
}

export function parseGovernanceSnapshot(value: unknown): GovernanceSnapshot {
  return governanceSnapshotSchema.parse(value);
}

/**
 * Replaces only explicitly configured top-level timestamptz properties with
 * PostgreSQL's microsecond-precise text. Nested governance JSON is never
 * traversed or rewritten.
 */
export function applyPreciseGovernanceTimestamps(
  tables: Record<GovernanceTableName, readonly object[]>,
  timestampRows: readonly PreciseGovernanceTimestampRow[],
): Record<GovernanceTableName, object[]> {
  const patches = new Map<string, Record<string, string | null>>();
  for (const patch of timestampRows) {
    const config = preciseTimestampConfig[patch.tableName];
    const timestampEntries = Object.entries(patch.timestamps);
    if (
      timestampEntries.length !== config.properties.size ||
      timestampEntries.some(([property, value]) => {
        if (!config.properties.has(property)) {
          return true;
        }
        return value !== null && !timestampSchema.safeParse(value).success;
      })
    ) {
      throw new Error(`Invalid precise timestamp patch for ${patch.tableName}`);
    }
    const patchKey = `${patch.tableName}:${patch.rowKey}`;
    if (patches.has(patchKey)) {
      throw new Error(`Duplicate precise timestamp patch for ${patchKey}`);
    }
    patches.set(patchKey, patch.timestamps);
  }

  const result = Object.fromEntries(
    governanceTableNames.map((tableName) => {
      const config = preciseTimestampConfig[tableName];
      return [
        tableName,
        tables[tableName].map((row) => {
          const record = row as Record<string, unknown>;
          const patchKey = `${tableName}:${config.key(record)}`;
          const patch = patches.get(patchKey);
          if (!patch) {
            throw new Error(`Missing precise timestamp patch for ${patchKey}`);
          }
          patches.delete(patchKey);
          return { ...record, ...patch };
        }),
      ];
    }),
  ) as Record<GovernanceTableName, object[]>;

  if (patches.size > 0) {
    throw new Error("Precise timestamp patches contain rows outside the snapshot");
  }
  return result;
}

/**
 * Replaces JSONB values decoded by the JavaScript driver with PostgreSQL's
 * exact `jsonb::text` representation. The raw string is retained in the
 * snapshot and is never parsed and re-serialized on the restore path.
 */
export function applyRawGovernanceJson(
  tables: Record<GovernanceTableName, readonly object[]>,
  jsonRows: readonly RawGovernanceJsonRow[],
): Record<GovernanceTableName, object[]> {
  const patches = new Map<string, Record<string, string | null>>();
  for (const patch of jsonRows) {
    const config = rawGovernanceJsonConfig[patch.tableName];
    const jsonEntries = Object.entries(patch.jsonValues);
    if (
      jsonEntries.length !== config.properties.size ||
      jsonEntries.some(([property]) => !config.properties.has(property))
    ) {
      throw new Error(`Invalid raw JSON patch for ${patch.tableName}`);
    }
    const patchKey = `${patch.tableName}:${patch.rowKey}`;
    if (patches.has(patchKey)) {
      throw new Error(`Duplicate raw JSON patch for ${patchKey}`);
    }
    patches.set(patchKey, patch.jsonValues);
  }

  const result = Object.fromEntries(
    governanceTableNames.map((tableName) => {
      const rawConfig = rawGovernanceJsonConfig[
        tableName as RawGovernanceJsonTableName
      ];
      if (!rawConfig) {
        return [tableName, [...tables[tableName]]];
      }
      return [
        tableName,
        tables[tableName].map((row) => {
          const record = row as Record<string, unknown>;
          const patchKey = `${tableName}:${rawConfig.key(record)}`;
          const patch = patches.get(patchKey);
          if (!patch) {
            throw new Error(`Missing raw JSON patch for ${patchKey}`);
          }
          patches.delete(patchKey);
          return { ...record, ...patch };
        }),
      ];
    }),
  ) as Record<GovernanceTableName, object[]>;

  if (patches.size > 0) {
    throw new Error("Raw JSON patches contain rows outside the snapshot");
  }
  return result;
}

export function parsePreciseGovernanceTimestampRows(
  value: unknown,
): PreciseGovernanceTimestampRow[] {
  return preciseGovernanceTimestampRowsSchema.parse(value);
}

export function parseRawGovernanceJsonRows(
  value: unknown,
): RawGovernanceJsonRow[] {
  return rawGovernanceJsonRowsSchema.parse(value);
}

export function calculateSha256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export function assertSnapshotSha256(
  content: Uint8Array,
  expectedSha256: string,
): string {
  const actualSha256 = calculateSha256(content);
  const actual = Buffer.from(actualSha256, "hex");
  const expected = Buffer.from(expectedSha256, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("Snapshot SHA-256 does not match the expected digest");
  }
  return actualSha256;
}
