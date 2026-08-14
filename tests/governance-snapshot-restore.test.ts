import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyPreciseGovernanceTimestamps,
  createGovernanceTableCounts,
  type GovernanceSnapshot,
  parseGovernanceSnapshot,
} from "../scripts/db/governance-snapshot-format";
import {
  assertNoMarketMetricTargetNaturalKeyConflicts,
  GOVERNANCE_PREFLIGHT_BIND_PARAMETER_BUDGET,
  MARKET_METRIC_NATURAL_KEY_PARAMETERS_PER_ROW,
  POSTGRES_MAX_BIND_PARAMETERS,
  restoreGovernanceSnapshotInAuthorizedTransaction,
  restoreGovernanceSnapshotInTransaction,
} from "../scripts/db/governance-snapshot-restore";
import { createTestDatabase } from "./helpers/database";

import { governanceMaintenanceTokenEnvironmentVariable } from "@/server/db/governance-maintenance-lock";

const ids = {
  batch: "00000000-0000-4000-8000-000000000008",
  draft: "00000000-0000-4000-8000-000000000007",
  extraBatch: "00000000-0000-4000-8000-000000000098",
  extraChunk: "00000000-0000-4000-8000-000000000089",
  extraDocument: "00000000-0000-4000-8000-000000000090",
  extraDraft: "00000000-0000-4000-8000-000000000094",
  extraJurisdiction: "00000000-0000-4000-8000-000000000093",
  extraLimit: "00000000-0000-4000-8000-000000000091",
  extraLog: "00000000-0000-4000-8000-000000000097",
  extraMarketMetric: "00000000-0000-4000-8000-000000000088",
  extraRegulation: "00000000-0000-4000-8000-000000000092",
  extraSource: "00000000-0000-4000-8000-000000000099",
  jurisdiction: "00000000-0000-4000-8000-000000000003",
  limit: "00000000-0000-4000-8000-000000000005",
  log: "00000000-0000-4000-8000-000000000009",
  marketMetric: "00000000-0000-4000-8000-000000000006",
  regulation: "00000000-0000-4000-8000-000000000004",
  source: "00000000-0000-4000-8000-000000000001",
} as const;
const timestamp = "2026-08-11T00:00:00.000Z";

function buildSnapshot(): GovernanceSnapshot {
  const tables = {
    countries: [
      {
        archivedAt: null,
        createdAt: timestamp,
        dataCoverageStatus: "covered",
        dataSourceId: ids.source,
        isDemo: false,
        iso2: "ZZ",
        iso3: "ZZZ",
        nameEn: "Snapshot Country",
        nameLocal: null,
        regionCode: "TEST",
        subregionCode: null,
        updatedAt: timestamp,
        verifiedAt: timestamp,
      },
    ],
    country_jurisdictions: [
      {
        archivedAt: null,
        countryIso3: "ZZZ",
        createdAt: timestamp,
        dataSourceId: ids.source,
        isDemo: false,
        jurisdictionId: ids.jurisdiction,
        updatedAt: timestamp,
        validFrom: "2026-01-01",
        validTo: null,
        verifiedAt: timestamp,
      },
    ],
    data_change_logs: [
      {
        action: "published",
        actorEmail: "reviewer@example.test",
        actorRole: "reviewer",
        afterData: '{"ok": true}',
        beforeData: null,
        createdAt: timestamp,
        draftId: ids.draft,
        entityKey: "ZZZ",
        entityType: "country",
        id: ids.log,
        importBatchId: ids.batch,
        reason: "Restore fixture",
      },
    ],
    data_governance_drafts: [
      {
        archivedAt: null,
        changeReason: "Restore fixture",
        createdAt: timestamp,
        createdBy: "editor@example.test",
        entityKey: "ZZZ",
        entityType: "country",
        id: ids.draft,
        payload: '{"iso3": "ZZZ"}',
        publishedAt: timestamp,
        publishedBy: "reviewer@example.test",
        reviewedAt: timestamp,
        reviewedBy: "reviewer@example.test",
        updatedAt: timestamp,
        version: 1,
        workflowStatus: "published",
      },
    ],
    data_sources: [
      {
        archivedAt: null,
        createdAt: timestamp,
        demoNotice: null,
        id: ids.source,
        isDemo: false,
        publishedOn: "2026-01-01",
        publisher: "Test authority",
        sourceType: "official-regulation",
        title: "Snapshot source",
        updatedAt: timestamp,
        url: "https://example.test/source",
        verifiedAt: timestamp,
      },
    ],
    jurisdictions: [
      {
        archivedAt: null,
        code: "ZZZ-NATIONAL",
        countryIso3: "ZZZ",
        createdAt: timestamp,
        dataSourceId: ids.source,
        id: ids.jurisdiction,
        isDemo: false,
        name: "Snapshot jurisdiction",
        type: "country",
        updatedAt: timestamp,
        verifiedAt: timestamp,
        websiteUrl: "https://example.test",
      },
    ],
    market_import_batches: [
      {
        committedAt: timestamp,
        confirmedBy: "reviewer@example.test",
        contentSha256: "a".repeat(64),
        createdAt: timestamp,
        createdBy: "editor@example.test",
        id: ids.batch,
        invalidRows: 0,
        originalFilename: "snapshot.csv",
        previewRows: "[]",
        status: "committed",
        totalRows: 0,
        validationErrors: "[]",
        validRows: 0,
      },
    ],
    market_metrics: [
      {
        applicationScope: null,
        archivedAt: null,
        countryIso3: "ZZZ",
        createdAt: timestamp,
        currencyCode: null,
        dataSourceId: ids.source,
        definition: "Snapshot market metric",
        id: ids.marketMetric,
        isDemo: false,
        methodologyVersion: "snapshot-v1",
        metricCode: "SNAPSHOT_MARKET",
        metricName: "Snapshot market metric",
        periodEnd: "2026-01-01",
        periodStart: "2025-01-01",
        publishedOn: "2026-02-01",
        unitCode: "count",
        updatedAt: timestamp,
        valueNumeric: "9007199254740993.000001",
        verifiedAt: timestamp,
      },
    ],
    regulation_limits: [
      {
        applicationScope: "on-road",
        archivedAt: null,
        createdAt: timestamp,
        dataSourceId: ids.source,
        engineTypeCode: "CI",
        id: ids.limit,
        isDemo: false,
        limitValue: "1.000000",
        measurementBasis: "g/kWh",
        pollutantCode: "NOx",
        powerMaxKw: 100,
        powerMinKw: 10,
        regulationId: ids.regulation,
        testCycleCode: "TEST",
        unitCode: "g/kWh",
        updatedAt: timestamp,
        validFrom: "2026-01-01",
        validTo: null,
        verifiedAt: timestamp,
      },
    ],
    regulations: [
      {
        adoptedOn: "2025-12-01",
        archivedAt: null,
        canonicalName: "Snapshot regulation",
        citationCode: "ZZZ-2026",
        createdAt: timestamp,
        dataSourceId: ids.source,
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        id: ids.regulation,
        isDemo: false,
        jurisdictionId: ids.jurisdiction,
        proposedOn: null,
        status: "effective",
        summary: "Restore fixture",
        updatedAt: timestamp,
        verifiedAt: timestamp,
      },
    ],
  };
  return parseGovernanceSnapshot({
    exportedAt: timestamp,
    formatVersion: 4,
    tableCounts: Object.fromEntries(
      Object.entries(tables).map(([tableName, rows]) => [
        tableName,
        rows.length,
      ]),
    ),
    tables,
  });
}

async function seedRowsOutsideSnapshot(
  client: Awaited<ReturnType<typeof createTestDatabase>>["client"],
  options: {
    withExternalCountryReference?: boolean;
    withExternalSourceReference?: boolean;
  } = {},
) {
  await client.query(
    `insert into data_sources
       (id, title, source_type, verified_at, is_demo, created_at, updated_at)
     values ($1, 'Externally referenced source', 'other', $2, false, $2, $2)`,
    [ids.extraSource, timestamp],
  );
  if (options.withExternalSourceReference) {
    await client.query(
      `insert into documents
         (data_source_id, type, title, language_code, content_sha256,
          verified_at, is_demo, processing_status, governance_status,
          created_at, updated_at)
       values ($1, 'other', 'External reference', 'en', $2,
               $3, false, 'ready', 'published', $3, $3)`,
      [ids.extraSource, "b".repeat(64), timestamp],
    );
  }
  await client.query(
    `insert into countries
       (iso3, iso2, name_en, data_coverage_status, data_source_id,
        verified_at, is_demo, created_at, updated_at)
     values ('YYY', 'YY', 'Snapshot-external country', 'no_data', $1,
             $2, false, $2, $2)`,
    [ids.extraSource, timestamp],
  );
  if (options.withExternalCountryReference) {
    await client.query(
      `insert into market_metrics
         (country_iso3, metric_code, metric_name, definition, period_start,
          period_end, value_numeric, unit_code, methodology_version,
          data_source_id, verified_at, is_demo, created_at, updated_at)
       values ('YYY', 'snapshot-external', 'Snapshot external', 'Exact restore',
               '2025-01-01', '2026-01-01', 1, 'count', 'v1', $1, $2, false,
               $2, $2)`,
      [ids.extraSource, timestamp],
    );
  }
  await client.query(
    `insert into jurisdictions
       (id, code, name, type, country_iso3, data_source_id, verified_at,
        is_demo, created_at, updated_at)
     values ($1, 'YYY-NATIONAL', 'Snapshot-external jurisdiction', 'country',
             'YYY', $2, $3, false, $3, $3)`,
    [ids.extraJurisdiction, ids.extraSource, timestamp],
  );
  await client.query(
    `insert into country_jurisdictions
       (country_iso3, jurisdiction_id, valid_from, data_source_id,
        verified_at, is_demo, created_at, updated_at)
     values ('YYY', $1, '2026-01-01', $2, $3, false, $3, $3)`,
    [ids.extraJurisdiction, ids.extraSource, timestamp],
  );
  await client.query(
    `insert into regulations
       (id, jurisdiction_id, canonical_name, citation_code, status,
        effective_from, data_source_id, verified_at, is_demo, created_at,
        updated_at)
     values ($1, $2, 'Snapshot-external regulation', 'YYY-2026', 'effective',
             '2026-01-01', $3, $4, false, $4, $4)`,
    [ids.extraRegulation, ids.extraJurisdiction, ids.extraSource, timestamp],
  );
  await client.query(
    `insert into regulation_limits
       (id, regulation_id, application_scope, engine_type_code,
        pollutant_code, limit_value, unit_code, valid_from, data_source_id,
        verified_at, is_demo, created_at, updated_at)
     values ($1, $2, 'on-road', 'CI', 'NOx', 1, 'g/kWh', '2026-01-01',
             $3, $4, false, $4, $4)`,
    [ids.extraLimit, ids.extraRegulation, ids.extraSource, timestamp],
  );
  await client.query(
    `insert into data_governance_drafts
       (id, entity_type, entity_key, version, workflow_status, payload,
        change_reason, created_by, created_at, updated_at)
     values ($1, 'country', 'YYY', 1, 'draft', '{"iso3":"YYY"}',
             'Snapshot-external draft', 'editor@example.test', $2, $2)`,
    [ids.extraDraft, timestamp],
  );
  await client.query(
    `insert into market_import_batches
       (id, status, original_filename, content_sha256, preview_rows,
        validation_errors, total_rows, valid_rows, invalid_rows, created_by,
        created_at)
     values ($1, 'previewed', 'extra.csv', $2, '[]', '[]', 0, 0, 0,
             'editor@example.test', $3)`,
    [ids.extraBatch, "c".repeat(64), timestamp],
  );
  await client.query(
    `insert into data_change_logs
       (id, entity_type, entity_key, action, actor_email, actor_role,
        draft_id, import_batch_id, reason, created_at)
     values ($1, 'market_metric', 'extra', 'import_previewed',
             'editor@example.test', 'editor', $2, $3, 'Extra log', $4)`,
    [ids.extraLog, ids.extraDraft, ids.extraBatch, timestamp],
  );
}

const physicalStateQueries = [
  { orderBy: "iso3", tableName: "countries" },
  {
    orderBy: "country_iso3, jurisdiction_id, valid_from",
    tableName: "country_jurisdictions",
  },
  { orderBy: "id", tableName: "data_change_logs" },
  { orderBy: "id", tableName: "data_governance_drafts" },
  { orderBy: "id", tableName: "data_sources" },
  { orderBy: "id", tableName: "jurisdictions" },
  { orderBy: "id", tableName: "market_import_batches" },
  { orderBy: "id", tableName: "market_metrics" },
  { orderBy: "id", tableName: "regulation_limits" },
  { orderBy: "id", tableName: "regulations" },
] as const;

async function readPhysicalGovernanceState(
  client: Awaited<ReturnType<typeof createTestDatabase>>["client"],
) {
  return Object.fromEntries(
    await Promise.all(
      physicalStateQueries.map(async ({ orderBy, tableName }) => {
        const result = await client.query<{ row: string }>(
          `select to_jsonb(value)::text as row
             from ${tableName} value
            order by ${orderBy}`,
        );
        return [tableName, result.rows.map((row) => row.row)] as const;
      }),
    ),
  );
}

const openClients: Array<
  Awaited<ReturnType<typeof createTestDatabase>>["client"]
> = [];

afterEach(async () => {
  await Promise.all(openClients.splice(0).map((client) => client.close()));
});

describe("governance snapshot restore transaction", { timeout: 30_000 }, () => {
  it("authorizes production restores before issuing any restore SQL", async () => {
    const execute = vi.fn();

    await expect(
      restoreGovernanceSnapshotInAuthorizedTransaction(
        { execute },
        buildSnapshot(),
        { NODE_ENV: "production" },
      ),
    ).rejects.toThrow("temporarily unavailable");
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects a production restore when the parent token lock was released", async () => {
    const execute = vi.fn().mockResolvedValue([{ allowed: false }]);

    await expect(
      restoreGovernanceSnapshotInAuthorizedTransaction(
        { execute },
        buildSnapshot(),
        {
          NODE_ENV: "production",
          [governanceMaintenanceTokenEnvironmentVariable]: "ab".repeat(32),
        },
      ),
    ).rejects.toThrow("temporarily unavailable");
    expect(execute).toHaveBeenCalledOnce();
  });

  it("rejects duplicate regulation jurisdiction and citation natural keys", () => {
    const value = structuredClone(buildSnapshot());
    value.tables.regulations.push({
      ...value.tables.regulations[0]!,
      id: "00000000-0000-4000-8000-000000000096",
    });
    value.tableCounts.regulations += 1;

    expect(() => parseGovernanceSnapshot(value)).toThrow("Duplicate snapshot key");
  });

  it("preflights market natural keys above PostgreSQL's parameter limit in safe batches", async () => {
    const baseRow = buildSnapshot().tables.market_metrics[0]!;
    const rowCount =
      Math.floor(
        POSTGRES_MAX_BIND_PARAMETERS /
          MARKET_METRIC_NATURAL_KEY_PARAMETERS_PER_ROW,
      ) + 1;
    const rows = Array.from({ length: rowCount }, (_, index) => ({
      ...baseRow,
      id: `market-metric-${index}`,
      metricCode: `SNAPSHOT_MARKET_${index}`,
    }));
    const execute = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ conflict: true }]);

    await expect(
      assertNoMarketMetricTargetNaturalKeyConflicts({ execute }, rows),
    ).rejects.toThrow("market_metrics observation");

    expect(execute).toHaveBeenCalledTimes(2);
    const dialect = new PgDialect();
    const queries = execute.mock.calls.map(([query]) =>
      dialect.sqlToQuery(query),
    );
    expect(
      queries.every(
        ({ params, sql }) =>
          params.length <= GOVERNANCE_PREFLIGHT_BIND_PARAMETER_BUDGET &&
          params.length < POSTGRES_MAX_BIND_PARAMETERS &&
          sql.trimStart().startsWith("with incoming"),
      ),
    ).toBe(true);
    expect(
      queries.reduce((count, { params }) => count + params.length, 0),
    ).toBe(rowCount * MARKET_METRIC_NATURAL_KEY_PARAMETERS_PER_ROW);
  });

  it(
    "restores the closed graph and physically deletes snapshot-external rows",
    async () => {
      const { client, database } = await createTestDatabase();
      openClients.push(client);
      await seedRowsOutsideSnapshot(client);

      const result = await database.transaction((transaction) =>
        restoreGovernanceSnapshotInTransaction(transaction, buildSnapshot()),
      );

      expect(result.strategy).toBe("snapshot-upsert-and-delete");
      const restored = await client.query<{ count: number }>(
        `select count(*)::int as count
         from regulation_limits l
         join regulations r on r.id = l.regulation_id
         join jurisdictions j on j.id = r.jurisdiction_id
         join countries c on c.iso3 = j.country_iso3
         join data_sources s on s.id = l.data_source_id
        where l.id = $1 and c.iso3 = 'ZZZ' and s.id = $2`,
        [ids.limit, ids.source],
      );
      expect(restored.rows[0]?.count).toBe(1);

      const safeExtras = await client.query<{
        batches: number;
        logs: number;
        sources: number;
      }>(
        `select
         (select count(*)::int from market_import_batches where id = $1) as batches,
         (select count(*)::int from data_change_logs where id = $2) as logs,
         (select count(*)::int from data_sources where id = $3) as sources`,
        [ids.extraBatch, ids.extraLog, ids.extraSource],
      );
      expect(safeExtras.rows[0]).toEqual({
        batches: 0,
        logs: 0,
        sources: 0,
      });
    },
    15_000,
  );

  it("leaves an identical snapshot physically unchanged and performs no updates", async () => {
    const { client, database } = await createTestDatabase();
    openClients.push(client);
    const snapshot = buildSnapshot();
    await database.transaction((transaction) =>
      restoreGovernanceSnapshotInTransaction(transaction, snapshot),
    );
    const before = await readPhysicalGovernanceState(client);
    await client.exec(`
      create function reject_identical_source_update() returns trigger
      language plpgsql as $$
      begin
        raise exception 'identical restore attempted an update';
      end;
      $$;
      create trigger reject_identical_source_update_trigger
      before update on data_sources
      for each row execute function reject_identical_source_update();
    `);

    await database.transaction((transaction) =>
      restoreGovernanceSnapshotInTransaction(transaction, snapshot),
    );

    expect(await readPhysicalGovernanceState(client)).toEqual(before);
  });

  it("round-trips every JSONB column without losing large integers or decimals", async () => {
    const { client, database } = await createTestDatabase();
    openClients.push(client);
    const snapshot = buildSnapshot();
    const exactJson =
      '{"decimal": 0.123456789012345678901234567890, "integer": 9007199254740993}';
    snapshot.tables.data_governance_drafts[0]!.payload = exactJson;
    snapshot.tables.data_change_logs[0]!.beforeData = exactJson;
    snapshot.tables.data_change_logs[0]!.afterData = exactJson;
    snapshot.tables.market_import_batches[0]!.previewRows =
      `[{"parsed":${exactJson},"rowNumber":1}]`;
    snapshot.tables.market_import_batches[0]!.validationErrors =
      '[{"field":null,"message":"exact","rowNumber":1}]';

    await database.transaction((transaction) =>
      restoreGovernanceSnapshotInTransaction(transaction, snapshot),
    );
    const before = await client.query<{
      afterData: string;
      beforeData: string;
      payload: string;
      previewRows: string;
      validationErrors: string;
    }>(
      `select
         (select payload::text from data_governance_drafts where id = $1) as payload,
         (select before_data::text from data_change_logs where id = $2) as "beforeData",
         (select after_data::text from data_change_logs where id = $2) as "afterData",
         (select preview_rows::text from market_import_batches where id = $3) as "previewRows",
         (select validation_errors::text from market_import_batches where id = $3) as "validationErrors"`,
      [ids.draft, ids.log, ids.batch],
    );
    const exactState = before.rows[0]!;
    for (const value of [
      exactState.payload,
      exactState.beforeData,
      exactState.afterData,
      exactState.previewRows,
    ]) {
      expect(value).toContain("9007199254740993");
      expect(value).toContain("0.123456789012345678901234567890");
    }

    snapshot.tables.data_governance_drafts[0]!.payload = exactState.payload;
    snapshot.tables.data_change_logs[0]!.beforeData = exactState.beforeData;
    snapshot.tables.data_change_logs[0]!.afterData = exactState.afterData;
    snapshot.tables.market_import_batches[0]!.previewRows =
      exactState.previewRows;
    snapshot.tables.market_import_batches[0]!.validationErrors =
      exactState.validationErrors;
    await client.query(
      `update data_governance_drafts set payload = '{"changed": true}' where id = $1`,
      [ids.draft],
    );
    await client.query(
      `update data_change_logs
          set before_data = '{"changed": true}', after_data = '{"changed": true}'
        where id = $1`,
      [ids.log],
    );
    await client.query(
      `update market_import_batches
          set preview_rows = '[]', validation_errors = '[]'
        where id = $1`,
      [ids.batch],
    );

    await database.transaction((transaction) =>
      restoreGovernanceSnapshotInTransaction(transaction, snapshot),
    );
    const after = await client.query<typeof exactState>(
      `select
         (select payload::text from data_governance_drafts where id = $1) as payload,
         (select before_data::text from data_change_logs where id = $2) as "beforeData",
         (select after_data::text from data_change_logs where id = $2) as "afterData",
         (select preview_rows::text from market_import_batches where id = $3) as "previewRows",
         (select validation_errors::text from market_import_batches where id = $3) as "validationErrors"`,
      [ids.draft, ids.log, ids.batch],
    );
    expect(after.rows[0]).toEqual(exactState);
  });

  it("rolls back changed and newly inserted market observations exactly", async () => {
    const { client, database } = await createTestDatabase();
    openClients.push(client);
    const snapshot = buildSnapshot();
    await database.transaction((transaction) =>
      restoreGovernanceSnapshotInTransaction(transaction, snapshot),
    );
    await client.query(
      "update market_metrics set value_numeric = '1.000000' where id = $1",
      [ids.marketMetric],
    );
    await client.query(
      `insert into market_metrics
         (id, country_iso3, metric_code, metric_name, definition,
          period_start, period_end, value_numeric, unit_code,
          methodology_version, data_source_id, verified_at, is_demo,
          created_at, updated_at)
       values ($1, 'ZZZ', 'SNAPSHOT_EXTRA', 'Snapshot extra', 'Must roll back',
               '2025-01-01', '2026-01-01', '2.000000', 'count', 'snapshot-v1',
               $2, $3, false, $3, $3)`,
      [ids.extraMarketMetric, ids.source, timestamp],
    );

    await database.transaction((transaction) =>
      restoreGovernanceSnapshotInTransaction(transaction, snapshot),
    );

    const state = await client.query<{
      extraCount: number;
      restoredValue: string;
    }>(
      `select
         (select value_numeric::text from market_metrics where id = $1) as "restoredValue",
         (select count(*)::int from market_metrics where id = $2) as "extraCount"`,
      [ids.marketMetric, ids.extraMarketMetric],
    );
    expect(state.rows[0]).toEqual({
      extraCount: 0,
      restoredValue: "9007199254740993.000001",
    });
  });

  it("fails the whole restore when an external foreign key blocks physical deletion", async () => {
    const { client, database } = await createTestDatabase();
    openClients.push(client);
    await seedRowsOutsideSnapshot(client, { withExternalSourceReference: true });

    await expect(
      database.transaction((transaction) =>
        restoreGovernanceSnapshotInTransaction(transaction, buildSnapshot()),
      ),
    ).rejects.toThrow("Failed query");

    const state = await client.query<{
      documents: number;
      extraSource: number;
      snapshotSource: number;
    }>(
      `select
         (select count(*)::int from data_sources where id = $1) as "snapshotSource",
         (select count(*)::int from data_sources where id = $2) as "extraSource",
         (select count(*)::int from documents where data_source_id = $2) as documents`,
      [ids.source, ids.extraSource],
    );
    expect(state.rows[0]).toEqual({
      documents: 1,
      extraSource: 1,
      snapshotSource: 0,
    });
  });

  it("restores market metrics and deletes snapshot-external observations", async () => {
    const { client, database } = await createTestDatabase();
    openClients.push(client);
    await seedRowsOutsideSnapshot(client, {
      withExternalCountryReference: true,
    });

    await database.transaction((transaction) =>
      restoreGovernanceSnapshotInTransaction(transaction, buildSnapshot()),
    );

    const state = await client.query<{
      extraCountry: number;
      marketMetrics: number;
      snapshotMetric: string;
      snapshotSource: number;
    }>(
      `select
         (select count(*)::int from data_sources where id = $1) as "snapshotSource",
         (select count(*)::int from countries where iso3 = 'YYY') as "extraCountry",
         (select count(*)::int from market_metrics where country_iso3 = 'YYY') as "marketMetrics",
         (select value_numeric::text from market_metrics where id = $2) as "snapshotMetric"`,
      [ids.source, ids.marketMetric],
    );
    expect(state.rows[0]).toEqual({
      extraCountry: 0,
      marketMetrics: 0,
      snapshotMetric: "9007199254740993.000001",
      snapshotSource: 1,
    });
  });

  it("rejects snapshot-external jurisdiction nullification before writes", async () => {
    const { client, database } = await createTestDatabase();
    openClients.push(client);
    const snapshot = buildSnapshot();
    await database.transaction((transaction) =>
      restoreGovernanceSnapshotInTransaction(transaction, snapshot),
    );
    await client.query(
      `insert into jurisdictions
         (id, code, name, type, data_source_id, verified_at, is_demo,
          created_at, updated_at)
       values ($1, 'EXTERNAL-REGION', 'Snapshot-external region', 'regional',
               $2, $3, false, $3, $3)`,
      [ids.extraJurisdiction, ids.source, timestamp],
    );
    await client.query(
      `insert into documents
         (id, data_source_id, type, title, language_code, content_sha256,
          verified_at, is_demo, processing_status, governance_status,
          created_at, updated_at)
       values ($1, $2, 'other', 'Jurisdiction reference', 'en', $3,
               $4, false, 'ready', 'published', $4, $4)`,
      [ids.extraDocument, ids.source, "d".repeat(64), timestamp],
    );
    await client.query(
      `insert into document_chunks
         (id, document_id, chunk_index, content, content_hash,
          jurisdiction_id, verified_at, is_demo, created_at, updated_at)
       values ($1, $2, 0, 'Jurisdiction reference', $3, $4, $5, false, $5, $5)`,
      [
        ids.extraChunk,
        ids.extraDocument,
        "e".repeat(64),
        ids.extraJurisdiction,
        timestamp,
      ],
    );

    await expect(
      database.transaction((transaction) =>
        restoreGovernanceSnapshotInTransaction(transaction, snapshot),
      ),
    ).rejects.toThrow("jurisdiction has references outside");

    const state = await client.query<{
      chunkJurisdictionId: string | null;
      extraJurisdiction: number;
    }>(
      `select
         (select count(*)::int from jurisdictions where id = $1) as "extraJurisdiction",
         (select jurisdiction_id::text from document_chunks where id = $2) as "chunkJurisdictionId"`,
      [ids.extraJurisdiction, ids.extraChunk],
    );
    expect(state.rows[0]).toEqual({
      chunkJurisdictionId: ids.extraJurisdiction,
      extraJurisdiction: 1,
    });
  });

  it("preflights target regulation natural-key conflicts before writing", async () => {
    const { client, database } = await createTestDatabase();
    openClients.push(client);
    const original = buildSnapshot();
    await database.transaction((transaction) =>
      restoreGovernanceSnapshotInTransaction(transaction, original),
    );

    const conflicting = structuredClone(original);
    const replacementRegulationId =
      "00000000-0000-4000-8000-000000000096";
    conflicting.tables.regulations[0]!.id = replacementRegulationId;
    conflicting.tables.regulation_limits[0]!.regulationId =
      replacementRegulationId;

    await expect(
      database.transaction((transaction) =>
        restoreGovernanceSnapshotInTransaction(transaction, conflicting),
      ),
    ).rejects.toThrow("regulations.jurisdictionId,citationCode");

    const rows = await client.query<{ id: string }>(
      "select id::text from regulations where citation_code = 'ZZZ-2026'",
    );
    expect(rows.rows).toEqual([{ id: ids.regulation }]);
  });

  it("preserves PostgreSQL microseconds through export overlay, parse, and restore", async () => {
    const { client, database } = await createTestDatabase();
    openClients.push(client);
    const draftId = "00000000-0000-4000-8000-000000000095";
    const tables = {
      countries: [],
      country_jurisdictions: [],
      data_change_logs: [],
      data_governance_drafts: [
        {
          archivedAt: null,
          changeReason: "Microsecond regression",
          createdAt: new Date("2026-08-11T00:00:00.123Z"),
          createdBy: "editor@example.test",
          entityKey: "microsecond",
          entityType: "country",
          id: draftId,
          payload: '{"createdAt": "nested-value-must-not-change"}',
          publishedAt: new Date("2026-08-11T00:00:00.123Z"),
          publishedBy: "reviewer@example.test",
          reviewedAt: new Date("2026-08-11T00:00:00.123Z"),
          reviewedBy: "reviewer@example.test",
          updatedAt: new Date("2026-08-11T00:00:00.123Z"),
          version: 1,
          workflowStatus: "published",
        },
      ],
      data_sources: [],
      jurisdictions: [],
      market_import_batches: [],
      market_metrics: [],
      regulation_limits: [],
      regulations: [],
    };
    const exportedTables = applyPreciseGovernanceTimestamps(tables, [
      {
        rowKey: draftId,
        tableName: "data_governance_drafts",
        timestamps: {
          archivedAt: null,
          createdAt: "2026-08-11T00:00:00.123456Z",
          publishedAt: "2026-08-11T00:00:00.234567Z",
          reviewedAt: "2026-08-11T00:00:00.345678Z",
          updatedAt: "2026-08-11T00:00:00.456789Z",
        },
      },
    ]);
    const snapshot = parseGovernanceSnapshot({
      exportedAt: timestamp,
      formatVersion: 4,
      tableCounts: createGovernanceTableCounts(exportedTables),
      tables: exportedTables,
    });

    await database.transaction((transaction) =>
      restoreGovernanceSnapshotInTransaction(transaction, snapshot),
    );

    const restored = await client.query<{
      createdAt: string;
      nestedCreatedAt: string;
      publishedAt: string;
      reviewedAt: string;
      updatedAt: string;
    }>(
      `select
         to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",
         to_char(published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "publishedAt",
         to_char(reviewed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "reviewedAt",
         to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "updatedAt",
         payload ->> 'createdAt' as "nestedCreatedAt"
       from data_governance_drafts where id = $1`,
      [draftId],
    );
    expect(restored.rows[0]).toEqual({
      createdAt: "2026-08-11T00:00:00.123456Z",
      nestedCreatedAt: "nested-value-must-not-change",
      publishedAt: "2026-08-11T00:00:00.234567Z",
      reviewedAt: "2026-08-11T00:00:00.345678Z",
      updatedAt: "2026-08-11T00:00:00.456789Z",
    });
  });

  it("rolls back inserts and prior deletions when a late delete fails", async () => {
    const { client, database } = await createTestDatabase();
    openClients.push(client);
    await seedRowsOutsideSnapshot(client);
    await client.exec(`
      create function reject_restore_delete() returns trigger
      language plpgsql as $$
      begin
        if old.id = '${ids.extraSource}' then
          raise exception 'forced restore failure';
        end if;
        return old;
      end;
      $$;
      create trigger reject_restore_delete_trigger
      before delete on data_sources
      for each row execute function reject_restore_delete();
    `);

    await expect(
      database.transaction((transaction) =>
        restoreGovernanceSnapshotInTransaction(transaction, buildSnapshot()),
      ),
    ).rejects.toThrow("Failed query");

    const state = await client.query<{
      extraBatch: number;
      extraLog: number;
      snapshotSource: number;
    }>(
      `select
         (select count(*)::int from data_sources where id = $1) as "snapshotSource",
         (select count(*)::int from market_import_batches where id = $2) as "extraBatch",
         (select count(*)::int from data_change_logs where id = $3) as "extraLog"`,
      [ids.source, ids.extraBatch, ids.extraLog],
    );
    expect(state.rows[0]).toEqual({
      extraBatch: 1,
      extraLog: 1,
      snapshotSource: 0,
    });
  });
});
