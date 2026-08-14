import { describe, expect, it } from "vitest";

import {
  applyPreciseGovernanceTimestamps,
  applyRawGovernanceJson,
  assertSnapshotSha256,
  calculateSha256,
  parseGovernanceSnapshot,
} from "../scripts/db/governance-snapshot-format";

function emptySnapshot() {
  const tables = {
    countries: [] as object[],
    country_jurisdictions: [],
    data_change_logs: [],
    data_governance_drafts: [] as object[],
    data_sources: [],
    jurisdictions: [],
    market_import_batches: [],
    market_metrics: [],
    regulation_limits: [],
    regulations: [],
  };
  return {
    exportedAt: "2026-08-11T00:00:00.000Z",
    formatVersion: 4,
    tableCounts: Object.fromEntries(
      Object.keys(tables).map((tableName) => [tableName, 0]),
    ),
    tables,
  };
}

describe("governance snapshot format", () => {
  it("accepts the exact v4 table set and matching counts", () => {
    expect(parseGovernanceSnapshot(emptySnapshot()).formatVersion).toBe(4);
  });

  it("rejects a declared row count mismatch", () => {
    const snapshot = emptySnapshot();
    snapshot.tableCounts.countries = 1;
    expect(() => parseGovernanceSnapshot(snapshot)).toThrow();
  });

  it("rejects unknown tables, fields, versions, and broken closure", () => {
    expect(() =>
      parseGovernanceSnapshot({
        ...emptySnapshot(),
        formatVersion: 2,
      }),
    ).toThrow();
    expect(() =>
      parseGovernanceSnapshot({
        ...emptySnapshot(),
        tables: { ...emptySnapshot().tables, products: [] },
      }),
    ).toThrow();

    const snapshot = emptySnapshot();
    snapshot.tables.countries.push({
      archivedAt: null,
      createdAt: "2026-08-11T00:00:00.000Z",
      dataCoverageStatus: "no_data",
      dataSourceId: "00000000-0000-4000-8000-000000000099",
      isDemo: false,
      iso2: "ZZ",
      iso3: "ZZZ",
      nameEn: "Test",
      nameLocal: null,
      regionCode: null,
      subregionCode: null,
      updatedAt: "2026-08-11T00:00:00.000Z",
      verifiedAt: "2026-08-11T00:00:00.000Z",
    });
    snapshot.tableCounts.countries = 1;
    expect(() => parseGovernanceSnapshot(snapshot)).toThrow();
  });

  it("compares the SHA-256 over the exact file bytes", () => {
    const content = Buffer.from('{"formatVersion":4}\n');
    const digest = calculateSha256(content);
    expect(assertSnapshotSha256(content, digest)).toBe(digest);
    expect(() => assertSnapshotSha256(content, "0".repeat(64))).toThrow(
      "does not match",
    );
  });

  it("only overlays declared top-level timestamps and preserves nested JSON keys", () => {
    const tables = emptySnapshot().tables;
    tables.data_governance_drafts.push({
      archivedAt: null,
      changeReason: "Microsecond regression",
      createdAt: new Date("2026-08-11T00:00:00.123Z"),
      createdBy: "editor@example.test",
      entityKey: "microsecond",
      entityType: "country",
      id: "00000000-0000-4000-8000-000000000001",
      payload: { createdAt: "nested-value-must-not-change" },
      publishedAt: new Date("2026-08-11T00:00:00.123Z"),
      publishedBy: "reviewer@example.test",
      reviewedAt: new Date("2026-08-11T00:00:00.123Z"),
      reviewedBy: "reviewer@example.test",
      updatedAt: new Date("2026-08-11T00:00:00.123Z"),
      version: 1,
      workflowStatus: "published",
    });

    const overlaid = applyPreciseGovernanceTimestamps(tables, [
      {
        rowKey: "00000000-0000-4000-8000-000000000001",
        tableName: "data_governance_drafts",
        timestamps: {
          archivedAt: null,
          createdAt: "2026-08-11T00:00:00.123456Z",
          publishedAt: "2026-08-11T00:00:00.123456Z",
          reviewedAt: "2026-08-11T00:00:00.123456Z",
          updatedAt: "2026-08-11T00:00:00.123456Z",
        },
      },
    ]);

    expect(overlaid.data_governance_drafts[0]).toMatchObject({
      createdAt: "2026-08-11T00:00:00.123456Z",
      payload: { createdAt: "nested-value-must-not-change" },
    });
  });

  it("overlays exact PostgreSQL jsonb text without JavaScript number coercion", () => {
    const tables = emptySnapshot().tables;
    const rawPayload =
      '{"decimal": 0.123456789012345678901234567890, "integer": 9007199254740993}';
    tables.data_governance_drafts.push({
      id: "00000000-0000-4000-8000-000000000001",
      payload: {
        decimal: 0.12345678901234568,
        integer: 9007199254740992,
      },
    });

    const overlaid = applyRawGovernanceJson(tables, [
      {
        jsonValues: { payload: rawPayload },
        rowKey: "00000000-0000-4000-8000-000000000001",
        tableName: "data_governance_drafts",
      },
    ]);

    expect(overlaid.data_governance_drafts[0]).toMatchObject({
      payload: rawPayload,
    });
  });
});
