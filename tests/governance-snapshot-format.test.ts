import { describe, expect, it } from "vitest";

import { createDocumentDataSourceFingerprintFromPayload } from "@/features/admin/document-reprocessed-audit";
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
    country_jurisdictions: [] as object[],
    data_change_logs: [] as object[],
    data_governance_drafts: [] as object[],
    data_sources: [] as object[],
    jurisdictions: [] as object[],
    market_import_batches: [] as object[],
    market_metrics: [] as object[],
    regulation_limits: [] as object[],
    regulations: [] as object[],
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

const reprocessedDocumentIds = {
  document: "00000000-0000-4000-8000-000000000011",
  draft: "00000000-0000-4000-8000-000000000012",
  log: "00000000-0000-4000-8000-000000000013",
  source: "00000000-0000-4000-8000-000000000014",
  supersededDraft: "00000000-0000-4000-8000-000000000015",
  supersededLog: "00000000-0000-4000-8000-000000000016",
} as const;

function reprocessedDocumentSnapshot() {
  const snapshot = emptySnapshot();
  const timestamp = "2026-08-30T00:00:00.000Z";
  const source = {
    archivedAt: null,
    createdAt: timestamp,
    demoNotice: null,
    id: reprocessedDocumentIds.source,
    isDemo: false,
    publishedOn: "2026-08-30",
    publisher: "Snapshot test publisher",
    sourceType: "government-notice" as const,
    title: "Snapshot test source",
    updatedAt: timestamp,
    url: "https://example.test/sources/reprocessed",
    verifiedAt: timestamp,
  };
  const sourceFingerprint =
    createDocumentDataSourceFingerprintFromPayload(source);
  const metadata = {
    applicationScope: "non-road" as const,
    canonicalUrl: "https://example.test/documents/reprocessed",
    countryIso3: null,
    demoNotice: null,
    documentType: "government-notice" as const,
    isDemo: false,
    jurisdictionId: null,
    languageCode: "en",
    licenseCode: "CC-BY-4.0",
    publishedOn: "2026-08-30",
    redistributionAllowed: true,
    sourcePublisher: "Snapshot test publisher",
    sourceTitle: "Snapshot test source",
    sourceType: "government-notice" as const,
    sourceUrl: "https://example.test/sources/reprocessed",
    title: "Snapshot test document",
    validFrom: "2026-01-01",
    validTo: null,
  };
  const afterData = {
    chunkSetFingerprint: "c".repeat(64),
    contentSha256: "b".repeat(64),
    documentId: reprocessedDocumentIds.document,
    metadata,
    operationFingerprint: "a".repeat(64),
    processingStatus: "ready",
    provenanceVersion: 2,
    sourceFingerprint,
    sourceId: reprocessedDocumentIds.source,
    status: "ready",
    supersededDraftIds: [reprocessedDocumentIds.supersededDraft],
  };

  snapshot.tables.data_sources.push(source);
  snapshot.tables.data_governance_drafts.push({
    archivedAt: timestamp,
    changeReason: "Create the original document draft.",
    createdAt: timestamp,
    createdBy: "editor@example.test",
    entityKey: reprocessedDocumentIds.document,
    entityType: "document",
    id: reprocessedDocumentIds.supersededDraft,
    payload: JSON.stringify({ documentId: reprocessedDocumentIds.document }),
    publishedAt: null,
    publishedBy: null,
    reviewedAt: null,
    reviewedBy: null,
    updatedAt: timestamp,
    version: 1,
    workflowStatus: "draft",
  });
  snapshot.tables.data_governance_drafts.push({
    archivedAt: null,
    changeReason: "Reprocess the snapshot fixture.",
    createdAt: timestamp,
    createdBy: "editor@example.test",
    entityKey: reprocessedDocumentIds.document,
    entityType: "document",
    id: reprocessedDocumentIds.draft,
    payload: JSON.stringify({ documentId: reprocessedDocumentIds.document }),
    publishedAt: null,
    publishedBy: null,
    reviewedAt: null,
    reviewedBy: null,
    updatedAt: timestamp,
    version: 2,
    workflowStatus: "draft",
  });
  snapshot.tables.data_change_logs.push({
    action: "document_reprocessed",
    actorEmail: "editor@example.test",
    actorRole: "editor",
    afterData: JSON.stringify(afterData),
    beforeData: null,
    createdAt: timestamp,
    draftId: reprocessedDocumentIds.draft,
    entityKey: reprocessedDocumentIds.document,
    entityType: "document",
    id: reprocessedDocumentIds.log,
    importBatchId: null,
    reason: "Reprocess the snapshot fixture.",
  });
  snapshot.tables.data_change_logs.push({
    action: "draft_created",
    actorEmail: "editor@example.test",
    actorRole: "editor",
    afterData: JSON.stringify({
      chunkSetFingerprint: "d".repeat(64),
      contentSha256: "b".repeat(64),
      documentId: reprocessedDocumentIds.document,
      metadata,
      processingStatus: "ready",
      provenanceVersion: 2,
      sourceFingerprint,
      sourceId: reprocessedDocumentIds.source,
    }),
    beforeData: null,
    createdAt: timestamp,
    draftId: reprocessedDocumentIds.supersededDraft,
    entityKey: reprocessedDocumentIds.document,
    entityType: "document",
    id: reprocessedDocumentIds.supersededLog,
    importBatchId: null,
    reason: "Create the original document draft.",
  });
  snapshot.tableCounts.data_sources = 1;
  snapshot.tableCounts.data_governance_drafts = 2;
  snapshot.tableCounts.data_change_logs = 2;

  return snapshot;
}

function v1DocumentSnapshot() {
  const snapshot = reprocessedDocumentSnapshot();
  snapshot.tables.data_governance_drafts = [
    snapshot.tables.data_governance_drafts[0]!,
  ];
  (
    snapshot.tables.data_governance_drafts[0] as {
      archivedAt: string | null;
    }
  ).archivedAt = null;
  snapshot.tables.data_change_logs = [
    snapshot.tables.data_change_logs[1]!,
  ];
  snapshot.tableCounts.data_governance_drafts = 1;
  snapshot.tableCounts.data_change_logs = 1;
  return snapshot;
}

function mutateReprocessingAfterData(
  snapshot: ReturnType<typeof reprocessedDocumentSnapshot>,
  mutate: (afterData: Record<string, unknown>) => void,
) {
  const log = snapshot.tables.data_change_logs[0] as {
    afterData: string | null;
  };
  if (log.afterData === null) {
    throw new Error("Reprocessing fixture is missing afterData.");
  }
  const afterData = JSON.parse(log.afterData) as Record<string, unknown>;
  mutate(afterData);
  log.afterData = JSON.stringify(afterData);
}

type ReprocessedDocumentSnapshot = ReturnType<
  typeof reprocessedDocumentSnapshot
>;

const reprocessingLineageSnapshotCases = [
  [
    "empty superseded list",
    (snapshot: ReprocessedDocumentSnapshot) => {
      mutateReprocessingAfterData(snapshot, (afterData) => {
        afterData.supersededDraftIds = [];
      });
    },
  ],
  [
    "multiple superseded drafts",
    (snapshot: ReprocessedDocumentSnapshot) => {
      mutateReprocessingAfterData(snapshot, (afterData) => {
        afterData.supersededDraftIds = [
          reprocessedDocumentIds.supersededDraft,
          "00000000-0000-4000-8000-000000000094",
        ];
      });
    },
  ],
  [
    "skipped predecessor version",
    (snapshot: ReprocessedDocumentSnapshot) => {
      (
        snapshot.tables.data_governance_drafts[1] as { version: number }
      ).version = 3;
    },
  ],
  [
    "predecessor from another entity type",
    (snapshot: ReprocessedDocumentSnapshot) => {
      (
        snapshot.tables.data_governance_drafts[0] as {
          entityType: string;
        }
      ).entityType = "country";
    },
  ],
  [
    "predecessor from another document",
    (snapshot: ReprocessedDocumentSnapshot) => {
      (
        snapshot.tables.data_governance_drafts[0] as { entityKey: string }
      ).entityKey = "00000000-0000-4000-8000-000000000095";
    },
  ],
  [
    "unarchived predecessor",
    (snapshot: ReprocessedDocumentSnapshot) => {
      (
        snapshot.tables.data_governance_drafts[0] as {
          archivedAt: string | null;
        }
      ).archivedAt = null;
    },
  ],
  [
    "predecessor with an impossible workflow",
    (snapshot: ReprocessedDocumentSnapshot) => {
      (
        snapshot.tables.data_governance_drafts[0] as {
          workflowStatus: string;
        }
      ).workflowStatus = "published";
    },
  ],
] as const satisfies readonly (readonly [
  string,
  (snapshot: ReprocessedDocumentSnapshot) => void,
])[];

describe("governance snapshot format", () => {
  it("accepts the exact v4 table set and matching counts", () => {
    expect(parseGovernanceSnapshot(emptySnapshot()).formatVersion).toBe(4);
  });

  it("does not treat a non-document v1 draft_created audit as document provenance", () => {
    const snapshot = emptySnapshot();
    const timestamp = "2026-08-30T00:00:00.000Z";
    const draftId = "00000000-0000-4000-8000-000000000021";
    snapshot.tables.data_governance_drafts.push({
      archivedAt: null,
      changeReason: "Create a country draft.",
      createdAt: timestamp,
      createdBy: "editor@example.test",
      entityKey: "CHN",
      entityType: "country",
      id: draftId,
      payload: JSON.stringify({ iso3: "CHN" }),
      publishedAt: null,
      publishedBy: null,
      reviewedAt: null,
      reviewedBy: null,
      updatedAt: timestamp,
      version: 1,
      workflowStatus: "draft",
    });
    snapshot.tables.data_change_logs.push({
      action: "draft_created",
      actorEmail: "editor@example.test",
      actorRole: "editor",
      afterData: JSON.stringify({ iso3: "CHN" }),
      beforeData: null,
      createdAt: timestamp,
      draftId,
      entityKey: "CHN",
      entityType: "country",
      id: "00000000-0000-4000-8000-000000000022",
      importBatchId: null,
      reason: "Create a country draft.",
    });
    snapshot.tableCounts.data_governance_drafts = 1;
    snapshot.tableCounts.data_change_logs = 1;

    expect(() => parseGovernanceSnapshot(snapshot)).not.toThrow();
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

  it("accepts a strictly shaped reprocessing marker bound to its draft and source", () => {
    expect(() =>
      parseGovernanceSnapshot(reprocessedDocumentSnapshot()),
    ).not.toThrow();
  });

  it("rejects source provenance drift within the same millisecond", () => {
    const snapshot = reprocessedDocumentSnapshot();
    (
      snapshot.tables.data_sources[0] as { updatedAt: string }
    ).updatedAt = "2026-08-30T00:00:00.000789Z";

    expect(() => parseGovernanceSnapshot(snapshot)).toThrow();
  });

  it.each(reprocessingLineageSnapshotCases)(
    "rejects reprocessing lineage with %s",
    (_label, mutate) => {
      const snapshot = reprocessedDocumentSnapshot();
      mutate(snapshot);

      expect(() => parseGovernanceSnapshot(snapshot)).toThrow();
    },
  );

  it("requires one strict canonical provenance marker for v1 and v2+ document drafts", () => {
    expect(() => parseGovernanceSnapshot(v1DocumentSnapshot())).not.toThrow();

    const missingV1 = v1DocumentSnapshot();
    missingV1.tables.data_change_logs = [];
    missingV1.tableCounts.data_change_logs = 0;

    const duplicateV1 = v1DocumentSnapshot();
    duplicateV1.tables.data_change_logs.push({
      ...duplicateV1.tables.data_change_logs[0]!,
      id: "00000000-0000-4000-8000-000000000017",
    });
    duplicateV1.tableCounts.data_change_logs = 2;

    const sourceDrift = v1DocumentSnapshot();
    (
      sourceDrift.tables.data_sources[0] as { title: string }
    ).title = "Drifted source title";

    const malformedHash = v1DocumentSnapshot();
    const v1Log = malformedHash.tables.data_change_logs[0] as {
      afterData: string;
    };
    const malformedAfterData = JSON.parse(v1Log.afterData) as Record<
      string,
      unknown
    >;
    malformedAfterData.contentSha256 = "not-a-sha256";
    v1Log.afterData = JSON.stringify(malformedAfterData);

    for (const snapshot of [
      missingV1,
      duplicateV1,
      sourceDrift,
      malformedHash,
    ]) {
      expect(() => parseGovernanceSnapshot(snapshot)).toThrow();
    }
  });

  it("rejects v1 provenance rows that borrow a document draft with the wrong entity type or key", () => {
    const wrongTypeOnly = v1DocumentSnapshot();
    (
      wrongTypeOnly.tables.data_change_logs[0] as { entityType: string }
    ).entityType = "country";

    const wrongKeyOnly = v1DocumentSnapshot();
    (
      wrongKeyOnly.tables.data_change_logs[0] as { entityKey: string }
    ).entityKey = "00000000-0000-4000-8000-000000000099";

    const wrongTypeExtra = v1DocumentSnapshot();
    wrongTypeExtra.tables.data_change_logs.push({
      ...wrongTypeExtra.tables.data_change_logs[0]!,
      entityType: "country",
      id: "00000000-0000-4000-8000-000000000019",
    });
    wrongTypeExtra.tableCounts.data_change_logs = 2;

    const wrongKeyExtra = v1DocumentSnapshot();
    wrongKeyExtra.tables.data_change_logs.push({
      ...wrongKeyExtra.tables.data_change_logs[0]!,
      entityKey: "00000000-0000-4000-8000-000000000098",
      id: "00000000-0000-4000-8000-000000000020",
    });
    wrongKeyExtra.tableCounts.data_change_logs = 2;

    for (const snapshot of [
      wrongTypeOnly,
      wrongKeyOnly,
      wrongTypeExtra,
      wrongKeyExtra,
    ]) {
      expect(() => parseGovernanceSnapshot(snapshot)).toThrow();
    }
  });

  it("rejects malformed or forged reprocessing markers", () => {
    const missingCanonicalMarker = reprocessedDocumentSnapshot();
    missingCanonicalMarker.tables.data_change_logs.splice(0, 1);
    missingCanonicalMarker.tableCounts.data_change_logs = 1;

    const duplicateCanonicalMarker = reprocessedDocumentSnapshot();
    duplicateCanonicalMarker.tables.data_change_logs.push({
      ...duplicateCanonicalMarker.tables.data_change_logs[0]!,
      id: "00000000-0000-4000-8000-000000000018",
    });
    duplicateCanonicalMarker.tableCounts.data_change_logs = 3;

    const missingAfterData = reprocessedDocumentSnapshot();
    (
      missingAfterData.tables.data_change_logs[0] as {
        afterData: string | null;
      }
    ).afterData = null;

    const invalidFingerprint = reprocessedDocumentSnapshot();
    mutateReprocessingAfterData(invalidFingerprint, (afterData) => {
      afterData.operationFingerprint = "not-a-sha256";
    });

    const legacyMissingChunkSet = reprocessedDocumentSnapshot();
    mutateReprocessingAfterData(legacyMissingChunkSet, (afterData) => {
      delete afterData.chunkSetFingerprint;
    });

    const legacyMissingVersion = reprocessedDocumentSnapshot();
    mutateReprocessingAfterData(legacyMissingVersion, (afterData) => {
      delete afterData.provenanceVersion;
    });

    const forgedSourceFingerprint = reprocessedDocumentSnapshot();
    mutateReprocessingAfterData(forgedSourceFingerprint, (afterData) => {
      afterData.sourceFingerprint = "c".repeat(64);
    });

    const forgedSourceMetadata = reprocessedDocumentSnapshot();
    mutateReprocessingAfterData(forgedSourceMetadata, (afterData) => {
      afterData.metadata = {
        ...(afterData.metadata as Record<string, unknown>),
        sourceTitle: "Drifted marker source title",
      };
    });

    const forgedDocument = reprocessedDocumentSnapshot();
    mutateReprocessingAfterData(forgedDocument, (afterData) => {
      afterData.documentId = "00000000-0000-4000-8000-000000000099";
    });

    const forgedSource = reprocessedDocumentSnapshot();
    mutateReprocessingAfterData(forgedSource, (afterData) => {
      afterData.sourceId = "00000000-0000-4000-8000-000000000098";
    });

    const forgedDraftPayload = reprocessedDocumentSnapshot();
    (
      forgedDraftPayload.tables.data_governance_drafts[1] as {
        payload: string;
      }
    ).payload = JSON.stringify({
      documentId: "00000000-0000-4000-8000-000000000097",
    });

    const unknownSupersededDraft = reprocessedDocumentSnapshot();
    mutateReprocessingAfterData(unknownSupersededDraft, (afterData) => {
      afterData.supersededDraftIds = [
        "00000000-0000-4000-8000-000000000096",
      ];
    });

    const unarchivedSupersededDraft = reprocessedDocumentSnapshot();
    (
      unarchivedSupersededDraft.tables.data_governance_drafts[0] as {
        archivedAt: string | null;
      }
    ).archivedAt = null;

    const wrongDocumentSupersededDraft = reprocessedDocumentSnapshot();
    (
      wrongDocumentSupersededDraft.tables.data_governance_drafts[0] as {
        entityKey: string;
      }
    ).entityKey = "00000000-0000-4000-8000-000000000095";

    const newerSupersededDraft = reprocessedDocumentSnapshot();
    (
      newerSupersededDraft.tables.data_governance_drafts[0] as {
        version: number;
      }
    ).version = 3;

    const duplicateSupersededDraft = reprocessedDocumentSnapshot();
    mutateReprocessingAfterData(duplicateSupersededDraft, (afterData) => {
      afterData.supersededDraftIds = [
        reprocessedDocumentIds.supersededDraft,
        reprocessedDocumentIds.supersededDraft,
      ];
    });

    for (const snapshot of [
      missingCanonicalMarker,
      duplicateCanonicalMarker,
      missingAfterData,
      invalidFingerprint,
      legacyMissingChunkSet,
      legacyMissingVersion,
      forgedSourceFingerprint,
      forgedSourceMetadata,
      forgedDocument,
      forgedSource,
      forgedDraftPayload,
      unknownSupersededDraft,
      unarchivedSupersededDraft,
      wrongDocumentSupersededDraft,
      newerSupersededDraft,
      duplicateSupersededDraft,
    ]) {
      expect(() => parseGovernanceSnapshot(snapshot)).toThrow();
    }
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
