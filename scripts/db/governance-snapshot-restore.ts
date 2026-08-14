import { type SQL, sql } from "drizzle-orm";

import { assertGovernanceMaintenanceAuthorized } from "../../src/server/db/governance-maintenance-lock";
import {
  type GovernanceSnapshot,
  type GovernanceTableName,
  governanceTableNames,
} from "./governance-snapshot-format";

export type GovernanceSqlExecutor = {
  execute(query: SQL): Promise<unknown>;
};

export const POSTGRES_MAX_BIND_PARAMETERS = 65_535;
export const GOVERNANCE_PREFLIGHT_BIND_PARAMETER_BUDGET = 60_000;
export const MARKET_METRIC_NATURAL_KEY_PARAMETERS_PER_ROW = 7;

type ColumnSpec = {
  json?: boolean;
  name: string;
  property: string;
};

type TableSpec = {
  columns: readonly ColumnSpec[];
  keyColumns: readonly { name: string; property: string }[];
  name: GovernanceTableName;
};

const commonGovernedColumns = [
  { name: "data_source_id", property: "dataSourceId" },
  { name: "verified_at", property: "verifiedAt" },
  { name: "is_demo", property: "isDemo" },
  { name: "created_at", property: "createdAt" },
  { name: "updated_at", property: "updatedAt" },
  { name: "archived_at", property: "archivedAt" },
] as const;

const tableSpecs: Record<GovernanceTableName, TableSpec> = {
  data_sources: {
    columns: [
      { name: "id", property: "id" },
      { name: "title", property: "title" },
      { name: "publisher", property: "publisher" },
      { name: "source_type", property: "sourceType" },
      { name: "url", property: "url" },
      { name: "published_on", property: "publishedOn" },
      { name: "verified_at", property: "verifiedAt" },
      { name: "is_demo", property: "isDemo" },
      { name: "demo_notice", property: "demoNotice" },
      { name: "created_at", property: "createdAt" },
      { name: "updated_at", property: "updatedAt" },
      { name: "archived_at", property: "archivedAt" },
    ],
    keyColumns: [{ name: "id", property: "id" }],
    name: "data_sources",
  },
  countries: {
    columns: [
      { name: "iso3", property: "iso3" },
      { name: "iso2", property: "iso2" },
      { name: "name_en", property: "nameEn" },
      { name: "name_local", property: "nameLocal" },
      { name: "region_code", property: "regionCode" },
      { name: "subregion_code", property: "subregionCode" },
      { name: "data_coverage_status", property: "dataCoverageStatus" },
      ...commonGovernedColumns,
    ],
    keyColumns: [{ name: "iso3", property: "iso3" }],
    name: "countries",
  },
  jurisdictions: {
    columns: [
      { name: "id", property: "id" },
      { name: "code", property: "code" },
      { name: "name", property: "name" },
      { name: "type", property: "type" },
      { name: "country_iso3", property: "countryIso3" },
      { name: "website_url", property: "websiteUrl" },
      ...commonGovernedColumns,
    ],
    keyColumns: [{ name: "id", property: "id" }],
    name: "jurisdictions",
  },
  country_jurisdictions: {
    columns: [
      { name: "country_iso3", property: "countryIso3" },
      { name: "jurisdiction_id", property: "jurisdictionId" },
      { name: "valid_from", property: "validFrom" },
      { name: "valid_to", property: "validTo" },
      ...commonGovernedColumns,
    ],
    keyColumns: [
      { name: "country_iso3", property: "countryIso3" },
      { name: "jurisdiction_id", property: "jurisdictionId" },
      { name: "valid_from", property: "validFrom" },
    ],
    name: "country_jurisdictions",
  },
  regulations: {
    columns: [
      { name: "id", property: "id" },
      { name: "jurisdiction_id", property: "jurisdictionId" },
      { name: "canonical_name", property: "canonicalName" },
      { name: "citation_code", property: "citationCode" },
      { name: "status", property: "status" },
      { name: "proposed_on", property: "proposedOn" },
      { name: "adopted_on", property: "adoptedOn" },
      { name: "effective_from", property: "effectiveFrom" },
      { name: "effective_to", property: "effectiveTo" },
      { name: "summary", property: "summary" },
      ...commonGovernedColumns,
    ],
    keyColumns: [{ name: "id", property: "id" }],
    name: "regulations",
  },
  regulation_limits: {
    columns: [
      { name: "id", property: "id" },
      { name: "regulation_id", property: "regulationId" },
      { name: "application_scope", property: "applicationScope" },
      { name: "engine_type_code", property: "engineTypeCode" },
      { name: "power_min_kw", property: "powerMinKw" },
      { name: "power_max_kw", property: "powerMaxKw" },
      { name: "pollutant_code", property: "pollutantCode" },
      { name: "limit_value", property: "limitValue" },
      { name: "unit_code", property: "unitCode" },
      { name: "measurement_basis", property: "measurementBasis" },
      { name: "test_cycle_code", property: "testCycleCode" },
      { name: "valid_from", property: "validFrom" },
      { name: "valid_to", property: "validTo" },
      ...commonGovernedColumns,
    ],
    keyColumns: [{ name: "id", property: "id" }],
    name: "regulation_limits",
  },
  data_governance_drafts: {
    columns: [
      { name: "id", property: "id" },
      { name: "entity_type", property: "entityType" },
      { name: "entity_key", property: "entityKey" },
      { name: "version", property: "version" },
      { name: "workflow_status", property: "workflowStatus" },
      { json: true, name: "payload", property: "payload" },
      { name: "change_reason", property: "changeReason" },
      { name: "created_by", property: "createdBy" },
      { name: "reviewed_by", property: "reviewedBy" },
      { name: "published_by", property: "publishedBy" },
      { name: "reviewed_at", property: "reviewedAt" },
      { name: "published_at", property: "publishedAt" },
      { name: "archived_at", property: "archivedAt" },
      { name: "created_at", property: "createdAt" },
      { name: "updated_at", property: "updatedAt" },
    ],
    keyColumns: [{ name: "id", property: "id" }],
    name: "data_governance_drafts",
  },
  market_import_batches: {
    columns: [
      { name: "id", property: "id" },
      { name: "status", property: "status" },
      { name: "original_filename", property: "originalFilename" },
      { name: "content_sha256", property: "contentSha256" },
      { json: true, name: "preview_rows", property: "previewRows" },
      {
        json: true,
        name: "validation_errors",
        property: "validationErrors",
      },
      { name: "total_rows", property: "totalRows" },
      { name: "valid_rows", property: "validRows" },
      { name: "invalid_rows", property: "invalidRows" },
      { name: "created_by", property: "createdBy" },
      { name: "confirmed_by", property: "confirmedBy" },
      { name: "committed_at", property: "committedAt" },
      { name: "created_at", property: "createdAt" },
    ],
    keyColumns: [{ name: "id", property: "id" }],
    name: "market_import_batches",
  },
  market_metrics: {
    columns: [
      { name: "id", property: "id" },
      { name: "country_iso3", property: "countryIso3" },
      { name: "metric_code", property: "metricCode" },
      { name: "metric_name", property: "metricName" },
      { name: "definition", property: "definition" },
      { name: "application_scope", property: "applicationScope" },
      { name: "period_start", property: "periodStart" },
      { name: "period_end", property: "periodEnd" },
      { name: "value_numeric", property: "valueNumeric" },
      { name: "unit_code", property: "unitCode" },
      { name: "currency_code", property: "currencyCode" },
      { name: "methodology_version", property: "methodologyVersion" },
      { name: "published_on", property: "publishedOn" },
      ...commonGovernedColumns,
    ],
    keyColumns: [{ name: "id", property: "id" }],
    name: "market_metrics",
  },
  data_change_logs: {
    columns: [
      { name: "id", property: "id" },
      { name: "entity_type", property: "entityType" },
      { name: "entity_key", property: "entityKey" },
      { name: "action", property: "action" },
      { name: "actor_email", property: "actorEmail" },
      { name: "actor_role", property: "actorRole" },
      { name: "draft_id", property: "draftId" },
      { name: "import_batch_id", property: "importBatchId" },
      { json: true, name: "before_data", property: "beforeData" },
      { json: true, name: "after_data", property: "afterData" },
      { name: "reason", property: "reason" },
      { name: "created_at", property: "createdAt" },
    ],
    keyColumns: [{ name: "id", property: "id" }],
    name: "data_change_logs",
  },
};

const restoreOrder = [
  "data_sources",
  "countries",
  "jurisdictions",
  "country_jurisdictions",
  "regulations",
  "regulation_limits",
  "market_metrics",
  "data_governance_drafts",
  "market_import_batches",
  "data_change_logs",
] as const satisfies readonly GovernanceTableName[];

const deleteOrder = [
  "data_change_logs",
  "market_metrics",
  "regulation_limits",
  "country_jurisdictions",
  "regulations",
  "jurisdictions",
  "countries",
  "data_governance_drafts",
  "market_import_batches",
  "data_sources",
] as const satisfies readonly GovernanceTableName[];

function queryReturnedRows(result: unknown): boolean {
  if (Array.isArray(result)) {
    return result.length > 0;
  }
  if (result !== null && typeof result === "object") {
    const rows = Reflect.get(result, "rows");
    return Array.isArray(rows) && rows.length > 0;
  }
  throw new Error("Could not validate target natural keys");
}

function queryCount(result: unknown): number {
  const rows = Array.isArray(result)
    ? result
    : result !== null && typeof result === "object"
      ? Reflect.get(result, "rows")
      : undefined;
  if (!Array.isArray(rows)) {
    throw new Error("Could not validate restored table counts");
  }
  const count = rows[0] && Reflect.get(rows[0], "count");
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
    throw new Error("Could not validate restored table counts");
  }
  return count;
}

function parameterSafeBatches<T>(
  rows: readonly T[],
  parametersPerRow: number,
): T[][] {
  const rowsPerBatch = Math.floor(
    GOVERNANCE_PREFLIGHT_BIND_PARAMETER_BUDGET / parametersPerRow,
  );
  const batches: T[][] = [];

  for (let start = 0; start < rows.length; start += rowsPerBatch) {
    batches.push(rows.slice(start, start + rowsPerBatch));
  }

  return batches;
}

export async function assertNoMarketMetricTargetNaturalKeyConflicts(
  transaction: GovernanceSqlExecutor,
  rows: GovernanceSnapshot["tables"]["market_metrics"],
): Promise<void> {
  for (const batch of parameterSafeBatches(
    rows,
    MARKET_METRIC_NATURAL_KEY_PARAMETERS_PER_ROW,
  )) {
    const incoming = sql.join(
      batch.map(
        (row) =>
          sql`(${row.id}::uuid, ${row.countryIso3}::text, ${row.metricCode}::text, ${row.applicationScope}::text, ${row.periodStart}::date, ${row.periodEnd}::date, ${row.dataSourceId}::uuid)`,
      ),
      sql.raw(", "),
    );
    const result = await transaction.execute(sql`
      with incoming(
        id, country_iso3, metric_code, application_scope,
        period_start, period_end, data_source_id
      ) as (values ${incoming})
      select 1
        from market_metrics existing
        join incoming
          on incoming.country_iso3 = existing.country_iso3
         and incoming.metric_code = existing.metric_code
         and incoming.application_scope is not distinct from existing.application_scope::text
         and incoming.period_start = existing.period_start
         and incoming.period_end = existing.period_end
         and incoming.data_source_id = existing.data_source_id
       where existing.id <> incoming.id
       limit 1
    `);
    if (queryReturnedRows(result)) {
      throw new Error("Target natural key conflict: market_metrics observation");
    }
  }
}

async function assertNoTargetNaturalKeyConflicts(
  transaction: GovernanceSqlExecutor,
  snapshot: GovernanceSnapshot,
) {
  if (snapshot.tables.countries.length > 0) {
    const incoming = sql.join(
      snapshot.tables.countries.map(
        (row) => sql`(${row.iso3}::text, ${row.iso2}::text)`,
      ),
      sql.raw(", "),
    );
    const result = await transaction.execute(sql`
      with incoming(id, iso2) as (values ${incoming})
      select 1
        from countries existing
        join incoming on incoming.iso2 = existing.iso2
       where existing.iso3 <> incoming.id
       limit 1
    `);
    if (queryReturnedRows(result)) {
      throw new Error("Target natural key conflict: countries.iso2");
    }
  }

  if (snapshot.tables.jurisdictions.length > 0) {
    const incoming = sql.join(
      snapshot.tables.jurisdictions.map(
        (row) => sql`(${row.id}::uuid, ${row.code}::text)`,
      ),
      sql.raw(", "),
    );
    const result = await transaction.execute(sql`
      with incoming(id, code) as (values ${incoming})
      select 1
        from jurisdictions existing
        join incoming on incoming.code = existing.code
       where existing.id <> incoming.id
       limit 1
    `);
    if (queryReturnedRows(result)) {
      throw new Error("Target natural key conflict: jurisdictions.code");
    }
  }

  const citedRegulations = snapshot.tables.regulations.filter(
    (row) => row.citationCode !== null,
  );
  if (citedRegulations.length > 0) {
    const incoming = sql.join(
      citedRegulations.map(
        (row) =>
          sql`(${row.id}::uuid, ${row.jurisdictionId}::uuid, ${row.citationCode}::text)`,
      ),
      sql.raw(", "),
    );
    const result = await transaction.execute(sql`
      with incoming(id, jurisdiction_id, citation_code) as (values ${incoming})
      select 1
        from regulations existing
        join incoming
          on incoming.jurisdiction_id = existing.jurisdiction_id
         and incoming.citation_code = existing.citation_code
       where existing.id <> incoming.id
       limit 1
    `);
    if (queryReturnedRows(result)) {
      throw new Error(
        "Target natural key conflict: regulations.jurisdictionId,citationCode",
      );
    }
  }

  if (snapshot.tables.data_governance_drafts.length > 0) {
    const incoming = sql.join(
      snapshot.tables.data_governance_drafts.map(
        (row) =>
          sql`(${row.id}::uuid, ${row.entityType}::text, ${row.entityKey}::text, ${row.version}::integer)`,
      ),
      sql.raw(", "),
    );
    const result = await transaction.execute(sql`
      with incoming(id, entity_type, entity_key, version) as (values ${incoming})
      select 1
        from data_governance_drafts existing
        join incoming
          on incoming.entity_type = existing.entity_type::text
         and incoming.entity_key = existing.entity_key
         and incoming.version = existing.version
       where existing.id <> incoming.id
       limit 1
    `);
    if (queryReturnedRows(result)) {
      throw new Error(
        "Target natural key conflict: data_governance_drafts entity version",
      );
    }
  }

  await assertNoMarketMetricTargetNaturalKeyConflicts(
    transaction,
    snapshot.tables.market_metrics,
  );
}

function asRecord(value: object): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function renderValue(value: unknown, isJson: boolean): SQL {
  if (value === null) {
    return sql`${null}`;
  }
  if (isJson) {
    if (typeof value !== "string") {
      throw new Error("Snapshot JSONB value must be PostgreSQL jsonb text");
    }
    return sql`${value}::jsonb`;
  }
  return sql`${value as string | number | boolean}`;
}

async function upsertRows(
  transaction: GovernanceSqlExecutor,
  spec: TableSpec,
  rows: readonly object[],
) {
  const chunkSize = 200;
  const columnNames = sql.join(
    spec.columns.map((column) => sql.identifier(column.name)),
    sql.raw(", "),
  );
  const keyNames = sql.join(
    spec.keyColumns.map((column) => sql.identifier(column.name)),
    sql.raw(", "),
  );
  const keyNameSet = new Set(spec.keyColumns.map((column) => column.name));
  const updateColumns = spec.columns.filter(
    (column) => !keyNameSet.has(column.name),
  );
  const updateAssignments = sql.join(
    updateColumns.map(
      (column) =>
        sql`${sql.identifier(column.name)} = excluded.${sql.identifier(column.name)}`,
    ),
    sql.raw(", "),
  );
  const currentValues = sql.join(
    updateColumns.map(
      (column) =>
        sql`${sql.identifier(spec.name)}.${sql.identifier(column.name)}`,
    ),
    sql.raw(", "),
  );
  const incomingValues = sql.join(
    updateColumns.map(
      (column) => sql`excluded.${sql.identifier(column.name)}`,
    ),
    sql.raw(", "),
  );

  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const values = sql.join(
      chunk.map((row) => {
        const record = asRecord(row);
        return sql`(${sql.join(
          spec.columns.map((column) =>
            renderValue(record[column.property], column.json === true),
          ),
          sql.raw(", "),
        )})`;
      }),
      sql.raw(", "),
    );
    await transaction.execute(
      sql`insert into ${sql.identifier(spec.name)} (${columnNames}) values ${values}
          on conflict (${keyNames}) do update set ${updateAssignments}
          where (${currentValues}) is distinct from (${incomingValues})`,
    );
  }
}

function buildOutsideSnapshotPredicate(
  spec: TableSpec,
  rows: readonly object[],
): SQL | undefined {
  if (rows.length === 0) {
    return undefined;
  }
  const keyNames = sql.join(
    spec.keyColumns.map((column) => sql.identifier(column.name)),
    sql.raw(", "),
  );
  const keys = sql.join(
    rows.map((row) => {
      const record = asRecord(row);
      return sql`(${sql.join(
        spec.keyColumns.map((column) =>
          renderValue(record[column.property], false),
        ),
        sql.raw(", "),
      )})`;
    }),
    sql.raw(", "),
  );
  return sql`(${keyNames}) not in (${keys})`;
}

async function deleteOutsideSnapshot(
  transaction: GovernanceSqlExecutor,
  spec: TableSpec,
  rows: readonly object[],
) {
  const predicate = buildOutsideSnapshotPredicate(spec, rows);
  await transaction.execute(
    sql`delete from ${sql.identifier(spec.name)}
        ${predicate ? sql`where ${predicate}` : sql``}`,
  );
}

async function assertNoExternalDeleteEffects(
  transaction: GovernanceSqlExecutor,
  snapshot: GovernanceSnapshot,
) {
  // Other references from outside the snapshot tables use RESTRICT and
  // therefore abort the transaction. Country and jurisdiction references need
  // explicit preflights because chunks/citations otherwise become null.
  const predicate = buildOutsideSnapshotPredicate(
    tableSpecs.countries,
    snapshot.tables.countries,
  );
  const result = await transaction.execute(sql`
    select 1
      from countries existing
     where ${predicate ?? sql`true`}
       and (
         exists (
           select 1 from document_chunks chunk
            where chunk.country_iso3 = existing.iso3
         )
         or exists (
           select 1 from ai_citations citation
            where citation.country_iso3 = existing.iso3
         )
       )
     limit 1
  `);
  if (queryReturnedRows(result)) {
    throw new Error(
      "Snapshot-external country has references outside the governance snapshot",
    );
  }

  const jurisdictionPredicate = buildOutsideSnapshotPredicate(
    tableSpecs.jurisdictions,
    snapshot.tables.jurisdictions,
  );
  const jurisdictionResult = await transaction.execute(sql`
    select 1
      from jurisdictions existing
     where ${jurisdictionPredicate ?? sql`true`}
       and exists (
         select 1 from document_chunks chunk
          where chunk.jurisdiction_id = existing.id
       )
     limit 1
  `);
  if (queryReturnedRows(jurisdictionResult)) {
    throw new Error(
      "Snapshot-external jurisdiction has references outside the governance snapshot",
    );
  }
}

async function assertRestoredTableCounts(
  transaction: GovernanceSqlExecutor,
  snapshot: GovernanceSnapshot,
) {
  for (const tableName of governanceTableNames) {
    const result = await transaction.execute(
      sql`select count(*)::integer as count from ${sql.identifier(tableName)}`,
    );
    if (queryCount(result) !== snapshot.tableCounts[tableName]) {
      throw new Error(`Restored table count mismatch: ${tableName}`);
    }
  }
}

export type GovernanceRestoreResult = {
  strategy: "snapshot-upsert-and-delete";
  tableCounts: Record<GovernanceTableName, number>;
};

/**
 * The caller must supply a transaction-scoped executor. Snapshot parents are
 * upserted before children. Rows absent from the snapshot are deleted in
 * reverse foreign-key order. Any external RESTRICT reference rejects the
 * restore and rolls the entire transaction back instead of leaving a partial
 * or logically-only restoration.
 */
export async function restoreGovernanceSnapshotInTransaction(
  transaction: GovernanceSqlExecutor,
  snapshot: GovernanceSnapshot,
): Promise<GovernanceRestoreResult> {
  await assertNoTargetNaturalKeyConflicts(transaction, snapshot);
  await assertNoExternalDeleteEffects(transaction, snapshot);

  for (const tableName of restoreOrder) {
    await upsertRows(
      transaction,
      tableSpecs[tableName],
      snapshot.tables[tableName],
    );
  }

  for (const tableName of deleteOrder) {
    await deleteOutsideSnapshot(
      transaction,
      tableSpecs[tableName],
      snapshot.tables[tableName],
    );
  }
  await assertRestoredTableCounts(transaction, snapshot);

  return {
    strategy: "snapshot-upsert-and-delete",
    tableCounts: snapshot.tableCounts,
  };
}

export async function restoreGovernanceSnapshotInAuthorizedTransaction(
  transaction: GovernanceSqlExecutor,
  snapshot: GovernanceSnapshot,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<GovernanceRestoreResult> {
  await assertGovernanceMaintenanceAuthorized(transaction, environment);
  return restoreGovernanceSnapshotInTransaction(transaction, snapshot);
}
