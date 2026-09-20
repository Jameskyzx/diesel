import { and, eq, inArray, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createLocalHashEmbedding,
  KNOWLEDGE_EMBEDDING_MODEL,
} from "@/domain/knowledge/embedding";
import {
  createDocumentProvenanceMarkerFingerprint,
  documentDraftCreatedAuditAfterDataSchema,
  documentDraftCreatedAuditMarkerSchema,
  documentReprocessedAuditAfterDataSchema,
} from "@/features/admin/document-reprocessed-audit";
import type { DocumentImportMetadata } from "@/features/knowledge/schemas";
import * as schema from "@/server/db/schema";
import {
  dataChangeLogs,
  dataGovernanceDrafts,
  dataSources,
  documentChunks,
  documents,
} from "@/server/db/schema";
import { sha256 } from "@/server/knowledge/document-file";
import { createGovernanceDashboardRepository } from "@/server/repositories/governance-dashboard-repository";
import {
  createGovernanceRepository,
  GovernanceConflictError,
} from "@/server/repositories/governance-repository";
import {
  createKnowledgeRepository,
  type ChunkInsert,
  type PreparedKnowledgeDocumentReprocessing,
  type PreparedKnowledgeDocumentUpload,
} from "@/server/repositories/knowledge-repository";
import { createTestDatabase } from "../helpers/database";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

const editor = {
  email: "atomic-editor@example.test",
  role: "editor" as const,
};
const reviewer = {
  email: "atomic-reviewer@example.test",
  role: "reviewer" as const,
};
const admin = {
  email: "atomic-admin@example.test",
  role: "admin" as const,
};

let testDatabase: TestDatabase;

beforeAll(async () => {
  testDatabase = await createTestDatabase();
}, 30_000);

afterAll(async () => {
  await testDatabase.client.close();
});

function metadata(label: string): DocumentImportMetadata {
  return {
    applicationScope: "non-road",
    canonicalUrl: `https://example.test/documents/${label}`,
    countryIso3: null,
    demoNotice: null,
    documentType: "government-notice",
    isDemo: false,
    jurisdictionId: null,
    languageCode: "en",
    licenseCode: "CC-BY-4.0",
    publishedOn: "2026-08-30",
    redistributionAllowed: true,
    sourcePublisher: "Atomic test publisher",
    sourceTitle: `Atomic source ${label}`,
    sourceType: "government-notice",
    sourceUrl: `https://example.test/sources/${label}`,
    title: `Atomic document ${label}`,
    validFrom: "2026-01-01",
    validTo: null,
  };
}

function chunk(content: string, metadataValue: DocumentImportMetadata): ChunkInsert {
  return {
    applicationScope: metadataValue.applicationScope,
    chunkIndex: 0,
    content,
    contentHash: sha256(content),
    countryIso3: metadataValue.countryIso3,
    embedding: createLocalHashEmbedding(content),
    embeddingModel: KNOWLEDGE_EMBEDDING_MODEL,
    headingPath: [metadataValue.title],
    isDemo: metadataValue.isDemo,
    jurisdictionId: metadataValue.jurisdictionId,
    pageFrom: 1,
    pageTo: 1,
    sectionLocator: `${metadataValue.title} > paragraph 1`,
    tokenCount: content.split(/\s+/u).length,
    validFrom: metadataValue.validFrom,
    validTo: metadataValue.validTo,
    verifiedAt: new Date("2026-08-30T00:00:00.000Z"),
  };
}

function preparedUpload(
  hashCharacter: string,
  label: string,
  outcome: "failed" | "ready" = "ready",
): PreparedKnowledgeDocumentUpload {
  const metadataValue = metadata(label);
  return {
    byteSize: 128,
    contentSha256: hashCharacter.repeat(64),
    metadata: metadataValue,
    mimeType: "text/plain",
    originalFilename: `${label}.txt`,
    outcome:
      outcome === "ready"
        ? {
            chunks: [chunk(`Ready governed content ${label}.`, metadataValue)],
            processingError: null,
            processingStatus: "ready",
          }
        : {
            chunks: [],
            processingError: "The document could not be parsed.",
            processingStatus: "failed",
          },
    storageCreated: false,
    storagePath: `knowledge/${hashCharacter}/${label}.txt`,
  };
}

async function preparedReprocessing(input: {
  documentId: string;
  fingerprint: string;
  label: string;
}): Promise<PreparedKnowledgeDocumentReprocessing> {
  const knowledgeRepository = createKnowledgeRepository(
    testDatabase.database,
  );
  const document = await knowledgeRepository.findDocumentForReprocessing({
    accessScope: { kind: "global" },
    documentId: input.documentId,
  });
  if (
    !document ||
    !document.activeDraft ||
    (document.processingStatus !== "ready" &&
      document.processingStatus !== "failed")
  ) {
    throw new Error("Reprocessing fixture document is not ready or failed.");
  }
  const reprocessedAudits = document.auditMarkers.filter(
    ({ action }) => action === "document_reprocessed",
  );
  const provenanceAudits =
    reprocessedAudits.length > 0
      ? reprocessedAudits
      : document.auditMarkers.filter(
          ({ action }) => action === "draft_created",
        );
  if (provenanceAudits.length !== 1) {
    throw new Error("Reprocessing fixture provenance is not unique.");
  }
  if (!document.chunkSetFingerprint) {
    throw new Error("Reprocessing fixture chunk provenance is invalid.");
  }
  const provenanceAudit = provenanceAudits[0]!;
  const provenanceMetadata =
    provenanceAudit.action === "document_reprocessed"
      ? documentReprocessedAuditAfterDataSchema.parse(
          provenanceAudit.afterData,
        ).metadata
      : documentDraftCreatedAuditAfterDataSchema.parse(
          provenanceAudit.afterData,
        ).metadata;
  const provenanceMarkerFingerprint =
    createDocumentProvenanceMarkerFingerprint({
      afterData: provenanceAudit.afterData,
      draftId: provenanceAudit.draftId,
      entityKey: provenanceAudit.entityKey,
      entityType: provenanceAudit.entityType,
    });
  const metadataValue = metadata(input.label);

  return {
    documentId: input.documentId,
    expected: {
      activeDraftCreatedBy: document.activeDraft.createdBy,
      activeDraftId: document.activeDraft.id,
      chunkSetFingerprint: document.chunkSetFingerprint,
      contentSha256: document.contentSha256,
      dataSourceId: document.dataSourceId,
      processingStatus: document.processingStatus,
      provenanceAuditId: provenanceAudit.id,
      provenanceMarkerFingerprint,
      provenanceMetadata,
      sourceFingerprint: document.sourceFingerprint,
    },
    metadata: metadataValue,
    operationFingerprint: input.fingerprint,
    outcome: {
      chunks: [
        chunk(`Reprocessed governed content ${input.label}.`, metadataValue),
      ],
      processingError: null,
      processingStatus: "ready",
    },
  };
}

async function documentReprocessingState(input: {
  documentId: string;
  attemptedSourceTitle: string;
}) {
  const [documentRows, chunkRows, draftRows, logRows, attemptedSources] =
    await Promise.all([
      testDatabase.database
        .select()
        .from(documents)
        .where(eq(documents.id, input.documentId)),
      testDatabase.database
        .select()
        .from(documentChunks)
        .where(eq(documentChunks.documentId, input.documentId))
        .orderBy(documentChunks.chunkIndex),
      testDatabase.database
        .select()
        .from(dataGovernanceDrafts)
        .where(eq(dataGovernanceDrafts.entityKey, input.documentId))
        .orderBy(dataGovernanceDrafts.version),
      testDatabase.database
        .select()
        .from(dataChangeLogs)
        .where(eq(dataChangeLogs.entityKey, input.documentId))
        .orderBy(dataChangeLogs.createdAt, dataChangeLogs.id),
      testDatabase.database
        .select()
        .from(dataSources)
        .where(eq(dataSources.title, input.attemptedSourceTitle)),
    ]);

  return {
    attemptedSources,
    chunkRows,
    documentRows,
    draftRows,
    logRows,
  };
}

function driftWithinSameMillisecond(timestamp: string): string {
  const match = /^(.*\.\d{3})(\d{3})Z$/u.exec(timestamp);
  if (!match) {
    throw new Error("Expected an exact PostgreSQL microsecond timestamp.");
  }
  const nextMicros = match[2] === "789" ? "123" : "789";
  return `${match[1]}${nextMicros}Z`;
}

const documentBatchWritePaths = ["development", "upload", "reprocess"] as const;

async function documentBatchWriteCase(
  path: (typeof documentBatchWritePaths)[number],
  label: string,
  failSecondBatch: boolean,
) {
  const metadataValue: DocumentImportMetadata = {
    ...metadata(label),
    demoNotice: "FICTIONAL DEMO DATA — NOT FOR PRODUCTION.",
    isDemo: true,
    sourceTitle: `DEMO ONLY — Batch source ${label}`,
    sourceType: "demo",
    title: `DEMO ONLY — Batch document ${label}`,
  };
  const chunks = Array.from({ length: 1001 }, (_, chunkIndex) => ({
    ...chunk(`DEMO ONLY — Batch body ${label} ${chunkIndex}.`, metadataValue),
    chunkIndex,
    sectionLocator: `${metadataValue.title} · paragraph ${chunkIndex + 1}`,
  }));
  if (failSecondBatch) chunks[1000]!.embedding = [0, 0];
  const prepared = {
    ...preparedUpload("a", label),
    contentSha256: sha256(label),
    metadata: metadataValue,
    outcome: { chunks, processingError: null, processingStatus: "ready" as const },
  } satisfies PreparedKnowledgeDocumentUpload;
  const parameterCounts: number[] = [];
  const database = drizzle(testDatabase.client, {
    schema,
    logger: {
      logQuery(query: string, parameters: unknown[]) {
        if (query.startsWith('insert into "document_chunks" ')) {
          parameterCounts.push(parameters.length);
        }
      },
    },
  });
  const actor = { email: `${label}@example.test`, role: "editor" as const };
  const governanceRepository = createGovernanceRepository(database);
  let documentId: string | null = null;
  let run: () => Promise<string>;
  if (path === "development") {
    const repository = createKnowledgeRepository(database);
    const created = await repository.createProcessingDocument({
      byteSize: prepared.byteSize,
      contentSha256: prepared.contentSha256,
      metadata: prepared.metadata,
      mimeType: prepared.mimeType,
      originalFilename: prepared.originalFilename,
      storagePath: prepared.storagePath,
    });
    documentId = created.documentId;
    run = async () => {
      await repository.completeDocument(created.documentId, chunks, "draft");
      return created.documentId;
    };
  } else if (path === "upload") {
    run = async () => (await governanceRepository.commitDocumentUpload({
      actor, changeReason: "Commit a complete multi-batch Demo document.", prepared,
    })).documentId;
  } else {
    const initial = preparedUpload("a", `${label}-initial`);
    initial.contentSha256 = sha256(`${label}-initial`);
    initial.metadata = metadataValue;
    initial.outcome = {
      chunks: [chunk("DEMO ONLY — Preserved initial body.", metadataValue)],
      processingError: null,
      processingStatus: "ready",
    };
    const uploaded = await createGovernanceRepository(testDatabase.database).commitDocumentUpload({
      actor, changeReason: "Prepare the original Demo document revision.", prepared: initial,
    });
    documentId = uploaded.documentId;
    const reprocessing = await preparedReprocessing({
      documentId, fingerprint: sha256(`${label}-operation`), label,
    });
    reprocessing.metadata = metadataValue;
    reprocessing.outcome = prepared.outcome;
    run = async () => {
      await governanceRepository.commitDocumentReprocessing({
        actor, prepared: reprocessing, reason: "Replace a complete multi-batch Demo revision.",
      });
      return uploaded.documentId;
    };
  }
  return { actor, documentId, parameterCounts, prepared, run };
}

describe("document chunk batches", () => {
  it.each(documentBatchWritePaths)("writes every %s chunk through bounded statements", async (path) => {
    const fixture = await documentBatchWriteCase(path, `batch-${path}-success`, false);
    const documentId = await fixture.run();
    expect(fixture.parameterCounts).toEqual([18000, 18]);
    const state = await documentReprocessingState({
      documentId, attemptedSourceTitle: fixture.prepared.metadata.sourceTitle,
    });
    expect(state.documentRows[0]).toMatchObject({ processingStatus: "ready", governanceStatus: "draft" });
    expect(state.chunkRows.map(({ chunkIndex, content, contentHash, headingPath, sectionLocator }) =>
      ({ chunkIndex, content, contentHash, headingPath, sectionLocator })
    )).toEqual(fixture.prepared.outcome.chunks.map(({ chunkIndex, content, contentHash, headingPath, sectionLocator }) =>
      ({ chunkIndex, content, contentHash, headingPath, sectionLocator })
    ));
    expect(state.draftRows).toHaveLength(path === "development" ? 0 : path === "upload" ? 1 : 2);
    expect(state.logRows.map(({ action }) => action).sort()).toEqual(
      path === "development" ? [] : path === "upload" ? ["draft_created"] :
        ["document_reprocessed", "draft_created", "draft_created"],
    );
    if (path !== "development") {
      await fixture.run();
      expect(fixture.parameterCounts).toEqual([18000, 18]);
      expect(await documentReprocessingState({
        documentId, attemptedSourceTitle: fixture.prepared.metadata.sourceTitle,
      })).toEqual(state);
    }
  });

  it.each(documentBatchWritePaths)("rolls back the first %s batch when the second fails", async (path) => {
    const fixture = await documentBatchWriteCase(path, `batch-${path}-rollback`, true);
    const stateInput = fixture.documentId === null ? null : {
      documentId: fixture.documentId,
      attemptedSourceTitle: fixture.prepared.metadata.sourceTitle,
    };
    const before = stateInput === null ? null : await documentReprocessingState(stateInput);
    await expect(fixture.run()).rejects.toThrow();
    expect(fixture.parameterCounts).toEqual([18000, 18]);
    if (stateInput !== null) {
      expect(await documentReprocessingState(stateInput)).toEqual(before);
    } else {
      expect(await Promise.all([
        testDatabase.database.select().from(documents).where(eq(documents.contentSha256, fixture.prepared.contentSha256)),
        testDatabase.database.select().from(dataSources).where(eq(dataSources.title, fixture.prepared.metadata.sourceTitle)),
        testDatabase.database.select().from(dataGovernanceDrafts).where(eq(dataGovernanceDrafts.createdBy, fixture.actor.email)),
        testDatabase.database.select().from(dataChangeLogs).where(eq(dataChangeLogs.actorEmail, fixture.actor.email)),
      ])).toEqual([[], [], [], []]);
    }
  });
});

async function driftSourceTimestampWithinSameMillisecond(
  documentId: string,
  field: "updatedAt" | "verifiedAt",
) {
  const result = await testDatabase.client.query<{
    sourceId: string;
    updatedAt: string;
    verifiedAt: string;
  }>(
    `select source.id as "sourceId",
            to_char(source.updated_at at time zone 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "updatedAt",
            to_char(source.verified_at at time zone 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "verifiedAt"
       from documents document
       join data_sources source on source.id = document.data_source_id
      where document.id = $1`,
    [documentId],
  );
  const source = result.rows[0];
  if (!source) {
    throw new Error("Replay fixture source was not returned.");
  }
  const timestamp = driftWithinSameMillisecond(source[field]);
  if (field === "verifiedAt") {
    await testDatabase.client.query(
      "update data_sources set verified_at = $1::timestamptz where id = $2",
      [timestamp, source.sourceId],
    );
  } else {
    await testDatabase.client.query(
      "update data_sources set updated_at = $1::timestamptz where id = $2",
      [timestamp, source.sourceId],
    );
  }
}

type ProvenanceMutation =
  | "delete"
  | "duplicate"
  | "hash-drift"
  | "malformed"
  | "metadata-drift"
  | "status-drift"
  | "source-drift";

async function mutateDocumentProvenance(input: {
  action: "document_reprocessed" | "draft_created";
  documentId: string;
  draftId: string;
  mutation: ProvenanceMutation;
}) {
  const [marker] = await testDatabase.database
    .select()
    .from(dataChangeLogs)
    .where(
      and(
        eq(dataChangeLogs.action, input.action),
        eq(dataChangeLogs.draftId, input.draftId),
      ),
    );
  if (!marker) throw new Error("V1 provenance marker was not returned.");

  if (input.mutation === "delete") {
    await testDatabase.database
      .delete(dataChangeLogs)
      .where(eq(dataChangeLogs.id, marker.id));
    return;
  }
  if (input.mutation === "duplicate") {
    await testDatabase.database.insert(dataChangeLogs).values({
      action: marker.action,
      actorEmail: marker.actorEmail,
      actorRole: marker.actorRole,
      afterData: marker.afterData,
      beforeData: marker.beforeData,
      draftId: marker.draftId,
      entityKey: marker.entityKey,
      entityType: marker.entityType,
      importBatchId: marker.importBatchId,
      reason: "Duplicate the canonical provenance marker.",
    });
    return;
  }
  if (input.mutation === "malformed") {
    await testDatabase.database
      .update(dataChangeLogs)
      .set({ afterData: { documentId: input.documentId } })
      .where(eq(dataChangeLogs.id, marker.id));
    return;
  }
  if (input.mutation === "status-drift") {
    const afterData = marker.afterData as Record<string, unknown> | null;
    if (!afterData) throw new Error("Provenance marker has no afterData.");
    await testDatabase.database
      .update(dataChangeLogs)
      .set({
        afterData: {
          ...afterData,
          processingStatus: "failed",
          ...(input.action === "document_reprocessed"
            ? { status: "failed" }
            : {}),
        },
      })
      .where(eq(dataChangeLogs.id, marker.id));
    return;
  }
  if (input.mutation === "hash-drift") {
    await testDatabase.database
      .update(documents)
      .set({ contentSha256: sha256(`drift:${input.documentId}`) })
      .where(eq(documents.id, input.documentId));
    return;
  }
  if (input.mutation === "metadata-drift") {
    await testDatabase.database
      .update(documents)
      .set({ title: "Drifted document metadata" })
      .where(eq(documents.id, input.documentId));
    return;
  }

  const [document] = await testDatabase.database
    .select({ dataSourceId: documents.dataSourceId })
    .from(documents)
    .where(eq(documents.id, input.documentId));
  if (!document) throw new Error("V1 provenance document was not returned.");
  await testDatabase.database
    .update(dataSources)
    .set({ title: "Drifted source provenance" })
    .where(eq(dataSources.id, document.dataSourceId));
}

const provenanceMutationCases = [
  ["delete", "0"],
  ["duplicate", "1"],
  ["malformed", "2"],
  ["source-drift", "3"],
  ["hash-drift", "4"],
  ["metadata-drift", "9"],
] as const satisfies readonly (readonly [ProvenanceMutation, string])[];

const v2ProvenanceMutationCases = [
  "delete",
  "duplicate",
  "malformed",
  "source-drift",
  "hash-drift",
  "metadata-drift",
  "status-drift",
] as const satisfies readonly ProvenanceMutation[];

async function createV2ProvenanceFixture(label: string) {
  const repository = createGovernanceRepository(testDatabase.database);
  const upload = preparedUpload("a", `${label}-initial`);
  upload.contentSha256 = sha256(`upload:${label}`);
  const initial = await repository.commitDocumentUpload({
    actor: editor,
    changeReason: `Create the ${label} v1 document.`,
    prepared: upload,
  });
  const reprocessing = await preparedReprocessing({
    documentId: initial.documentId,
    fingerprint: sha256(`operation:${label}`),
    label: `${label}-reprocessed`,
  });
  await repository.commitDocumentReprocessing({
    actor: editor,
    prepared: reprocessing,
    reason: `Create the ${label} v2 provenance marker.`,
  });
  const [draft] = await testDatabase.database
    .select()
    .from(dataGovernanceDrafts)
    .where(
      and(
        eq(dataGovernanceDrafts.entityKey, initial.documentId),
        isNull(dataGovernanceDrafts.archivedAt),
      ),
    );
  if (!draft || draft.version !== 2) {
    throw new Error("V2 provenance fixture has no active v2 draft.");
  }
  return {
    documentId: initial.documentId,
    draft,
    reprocessing,
    repository,
  };
}

const reprocessingLineageMutationCases = [
  "empty",
  "multiple",
  "skipped-version",
  "wrong-entity",
  "wrong-document",
  "unarchived",
  "wrong-workflow",
] as const;

type ReprocessingLineageMutation =
  (typeof reprocessingLineageMutationCases)[number];

async function mutateReprocessingLineage(input: {
  documentId: string;
  draftId: string;
  mutation: ReprocessingLineageMutation;
}) {
  const [marker] = await testDatabase.database
    .select()
    .from(dataChangeLogs)
    .where(
      and(
        eq(dataChangeLogs.action, "document_reprocessed"),
        eq(dataChangeLogs.draftId, input.draftId),
      ),
    );
  if (!marker) {
    throw new Error("Reprocessing lineage marker was not returned.");
  }
  const afterData = documentReprocessedAuditAfterDataSchema.parse(
    marker.afterData,
  );
  const predecessorId = afterData.supersededDraftIds[0];
  if (!predecessorId) {
    throw new Error("Reprocessing lineage predecessor was not returned.");
  }

  if (input.mutation === "empty" || input.mutation === "multiple") {
    await testDatabase.database
      .update(dataChangeLogs)
      .set({
        afterData: {
          ...afterData,
          supersededDraftIds:
            input.mutation === "empty"
              ? []
              : [
                  predecessorId,
                  "83000000-0000-4000-8000-000000000098",
                ],
        },
      })
      .where(eq(dataChangeLogs.id, marker.id));
    return;
  }
  if (input.mutation === "skipped-version") {
    await testDatabase.database
      .update(dataGovernanceDrafts)
      .set({ version: 3 })
      .where(eq(dataGovernanceDrafts.id, input.draftId));
    return;
  }

  await testDatabase.database
    .update(dataGovernanceDrafts)
    .set(
      input.mutation === "wrong-entity"
        ? { entityType: "country" }
        : input.mutation === "wrong-document"
          ? { entityKey: "83000000-0000-4000-8000-000000000097" }
          : input.mutation === "unarchived"
            ? { archivedAt: null }
            : { workflowStatus: "published" },
    )
    .where(eq(dataGovernanceDrafts.id, predecessorId));
}

describe("governed document atomic writes", () => {
  it("commits source, ready document, chunks, draft, and audit together", async () => {
    const repository = createGovernanceRepository(testDatabase.database);
    const prepared = preparedUpload("a", "ready-upload");
    const result = await repository.commitDocumentUpload({
      actor: editor,
      changeReason: "Create the complete governed document revision.",
      prepared,
    });

    const [storedDocument] = await testDatabase.database
      .select()
      .from(documents)
      .where(eq(documents.id, result.documentId));
    const storedChunks = await testDatabase.database
      .select()
      .from(documentChunks)
      .where(eq(documentChunks.documentId, result.documentId));
    const storedDrafts = await testDatabase.database
      .select()
      .from(dataGovernanceDrafts)
      .where(eq(dataGovernanceDrafts.entityKey, result.documentId));
    const storedLogs = await testDatabase.database
      .select()
      .from(dataChangeLogs)
      .where(eq(dataChangeLogs.entityKey, result.documentId));

    expect(result).toMatchObject({
      created: true,
      draftCreated: true,
      summary: { chunkCount: 1, processingStatus: "ready" },
    });
    expect(storedDocument).toMatchObject({
      governanceStatus: "draft",
      processingStatus: "ready",
      title: prepared.metadata.title,
    });
    expect(storedChunks).toHaveLength(1);
    expect(storedDrafts).toHaveLength(1);
    expect(storedLogs).toHaveLength(1);
    expect(storedLogs[0]).toMatchObject({
      action: "draft_created",
      draftId: storedDrafts[0]?.id,
    });
    expect(
      documentDraftCreatedAuditMarkerSchema.parse({
        afterData: storedLogs[0]?.afterData,
        draftId: storedLogs[0]?.draftId,
        entityKey: storedLogs[0]?.entityKey,
        entityType: storedLogs[0]?.entityType,
      }).afterData,
    ).toMatchObject({
      contentSha256: prepared.contentSha256,
      documentId: result.documentId,
      metadata: prepared.metadata,
      processingStatus: "ready",
      sourceId: storedDocument?.dataSourceId,
    });
  });

  it.each(provenanceMutationCases)(
    "fails review transactionally when v1 provenance is %s",
    async (mutation, hashCharacter) => {
      const repository = createGovernanceRepository(testDatabase.database);
      const uploaded = await repository.commitDocumentUpload({
        actor: editor,
        changeReason: `Create the review ${mutation} provenance fixture.`,
        prepared: preparedUpload(
          hashCharacter,
          `review-provenance-${mutation}`,
        ),
      });
      if (!uploaded.draft) throw new Error("Review fixture has no draft.");
      await mutateDocumentProvenance({
        action: "draft_created",
        documentId: uploaded.documentId,
        draftId: uploaded.draft.id,
        mutation,
      });
      const logsBefore = await testDatabase.database
        .select({ id: dataChangeLogs.id })
        .from(dataChangeLogs)
        .where(eq(dataChangeLogs.entityKey, uploaded.documentId));

      await expect(
        repository.reviewDraft({
          actor: reviewer,
          draftId: uploaded.draft.id,
          reason: "Untrustworthy provenance must not be reviewed.",
        }),
      ).rejects.toBeInstanceOf(GovernanceConflictError);

      const [draftAfter] = await testDatabase.database
        .select({ workflowStatus: dataGovernanceDrafts.workflowStatus })
        .from(dataGovernanceDrafts)
        .where(eq(dataGovernanceDrafts.id, uploaded.draft.id));
      const [documentAfter] = await testDatabase.database
        .select({ governanceStatus: documents.governanceStatus })
        .from(documents)
        .where(eq(documents.id, uploaded.documentId));
      const logsAfter = await testDatabase.database
        .select({ action: dataChangeLogs.action })
        .from(dataChangeLogs)
        .where(eq(dataChangeLogs.entityKey, uploaded.documentId));
      expect(draftAfter?.workflowStatus).toBe("draft");
      expect(documentAfter?.governanceStatus).toBe("draft");
      expect(logsAfter).toHaveLength(logsBefore.length);
      expect(logsAfter).not.toContainEqual({ action: "reviewed" });
    },
  );

  it.each(
    provenanceMutationCases.map(
      ([mutation, hashCharacter], index) =>
        [mutation, `${"abcdef"[index]}${hashCharacter}`] as const,
    ),
  )(
    "fails publish transactionally when v1 provenance is %s",
    async (mutation, hashSeed) => {
      const repository = createGovernanceRepository(testDatabase.database);
      const prepared = preparedUpload(
        "a",
        `publish-provenance-${mutation}-${hashSeed}`,
      );
      prepared.contentSha256 = sha256(hashSeed);
      const uploaded = await repository.commitDocumentUpload({
        actor: editor,
        changeReason: `Create the publish ${mutation} provenance fixture.`,
        prepared,
      });
      if (!uploaded.draft) throw new Error("Publish fixture has no draft.");
      await repository.reviewDraft({
        actor: reviewer,
        draftId: uploaded.draft.id,
        reason: "Review valid provenance before introducing drift.",
      });
      await mutateDocumentProvenance({
        action: "draft_created",
        documentId: uploaded.documentId,
        draftId: uploaded.draft.id,
        mutation,
      });
      const logsBefore = await testDatabase.database
        .select({ id: dataChangeLogs.id })
        .from(dataChangeLogs)
        .where(eq(dataChangeLogs.entityKey, uploaded.documentId));

      await expect(
        repository.publishDraft({
          actor: admin,
          draftId: uploaded.draft.id,
          reason: "Untrustworthy provenance must not be published.",
        }),
      ).rejects.toBeInstanceOf(GovernanceConflictError);

      const [draftAfter] = await testDatabase.database
        .select({ workflowStatus: dataGovernanceDrafts.workflowStatus })
        .from(dataGovernanceDrafts)
        .where(eq(dataGovernanceDrafts.id, uploaded.draft.id));
      const [documentAfter] = await testDatabase.database
        .select({ governanceStatus: documents.governanceStatus })
        .from(documents)
        .where(eq(documents.id, uploaded.documentId));
      const logsAfter = await testDatabase.database
        .select({ action: dataChangeLogs.action })
        .from(dataChangeLogs)
        .where(eq(dataChangeLogs.entityKey, uploaded.documentId));
      expect(draftAfter?.workflowStatus).toBe("reviewed");
      expect(documentAfter?.governanceStatus).toBe("reviewed");
      expect(logsAfter).toHaveLength(logsBefore.length);
      expect(logsAfter).not.toContainEqual({ action: "published" });
    },
  );

  it.each(v2ProvenanceMutationCases)(
    "fails v2 review transactionally when provenance is %s",
    async (mutation) => {
      const fixture = await createV2ProvenanceFixture(
        `v2-review-${mutation}`,
      );
      await mutateDocumentProvenance({
        action: "document_reprocessed",
        documentId: fixture.documentId,
        draftId: fixture.draft.id,
        mutation,
      });
      const logsBefore = await testDatabase.database
        .select({ id: dataChangeLogs.id })
        .from(dataChangeLogs)
        .where(eq(dataChangeLogs.entityKey, fixture.documentId));

      await expect(
        fixture.repository.reviewDraft({
          actor: reviewer,
          draftId: fixture.draft.id,
          reason: "Invalid v2 provenance must not be reviewed.",
        }),
      ).rejects.toBeInstanceOf(GovernanceConflictError);

      const [[draftAfter], [documentAfter], logsAfter] = await Promise.all([
        testDatabase.database
          .select({ workflowStatus: dataGovernanceDrafts.workflowStatus })
          .from(dataGovernanceDrafts)
          .where(eq(dataGovernanceDrafts.id, fixture.draft.id)),
        testDatabase.database
          .select({ governanceStatus: documents.governanceStatus })
          .from(documents)
          .where(eq(documents.id, fixture.documentId)),
        testDatabase.database
          .select({ action: dataChangeLogs.action })
          .from(dataChangeLogs)
          .where(eq(dataChangeLogs.entityKey, fixture.documentId)),
      ]);
      expect(draftAfter?.workflowStatus).toBe("draft");
      expect(documentAfter?.governanceStatus).toBe("draft");
      expect(logsAfter).toHaveLength(logsBefore.length);
      expect(logsAfter).not.toContainEqual({ action: "reviewed" });
    },
  );

  it.each(reprocessingLineageMutationCases)(
    "fails v2 review without side effects when predecessor lineage is %s",
    async (mutation) => {
      const fixture = await createV2ProvenanceFixture(
        `v2-lineage-${mutation}`,
      );
      await mutateReprocessingLineage({
        documentId: fixture.documentId,
        draftId: fixture.draft.id,
        mutation,
      });
      const stateInput = {
        attemptedSourceTitle: `No review source ${mutation}`,
        documentId: fixture.documentId,
      };
      const beforeReview = await documentReprocessingState(stateInput);

      const error = await fixture.repository
        .reviewDraft({
          actor: reviewer,
          draftId: fixture.draft.id,
          reason: "Invalid predecessor lineage must not be reviewed.",
        })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(GovernanceConflictError);
      expect(JSON.stringify(error)).not.toContain(reviewer.email);
      await expect(documentReprocessingState(stateInput)).resolves.toEqual(
        beforeReview,
      );
      expect(
        beforeReview.logRows.filter(({ action }) => action === "reviewed"),
      ).toEqual([]);
    },
  );

  it("fails v2 publish without side effects when its immediate predecessor drifts", async () => {
    const fixture = await createV2ProvenanceFixture(
      "v2-lineage-publish",
    );
    await fixture.repository.reviewDraft({
      actor: reviewer,
      draftId: fixture.draft.id,
      reason: "Review the valid v2 lineage before the drift.",
    });
    await mutateReprocessingLineage({
      documentId: fixture.documentId,
      draftId: fixture.draft.id,
      mutation: "wrong-workflow",
    });
    const stateInput = {
      attemptedSourceTitle: "No lineage publish source",
      documentId: fixture.documentId,
    };
    const beforePublish = await documentReprocessingState(stateInput);

    await expect(
      fixture.repository.publishDraft({
        actor: admin,
        draftId: fixture.draft.id,
        reason: "Reject the drifted immediate predecessor.",
      }),
    ).rejects.toBeInstanceOf(GovernanceConflictError);
    await expect(documentReprocessingState(stateInput)).resolves.toEqual(
      beforePublish,
    );
    expect(
      beforePublish.logRows.filter(({ action }) => action === "published"),
    ).toEqual([]);
  });

  it("fails an idempotent replay without side effects when predecessor lineage drifts", async () => {
    const fixture = await createV2ProvenanceFixture(
      "v2-lineage-idempotent-replay",
    );
    await mutateReprocessingLineage({
      documentId: fixture.documentId,
      draftId: fixture.draft.id,
      mutation: "wrong-workflow",
    });
    const stateInput = {
      attemptedSourceTitle: fixture.reprocessing.metadata.sourceTitle,
      documentId: fixture.documentId,
    };
    const beforeReplay = await documentReprocessingState(stateInput);

    await expect(
      fixture.repository.commitDocumentReprocessing({
        actor: editor,
        prepared: fixture.reprocessing,
        reason: "Do not replay a marker with drifted lineage.",
      }),
    ).rejects.toMatchObject({
      message:
        "Document draft v2 reprocessing provenance does not identify its immediate archived predecessor.",
      name: "GovernanceConflictError",
    });
    await expect(documentReprocessingState(stateInput)).resolves.toEqual(
      beforeReplay,
    );
  });

  it.each(v2ProvenanceMutationCases)(
    "fails v2 publish transactionally when provenance is %s",
    async (mutation) => {
      const fixture = await createV2ProvenanceFixture(
        `v2-publish-${mutation}`,
      );
      await fixture.repository.reviewDraft({
        actor: reviewer,
        draftId: fixture.draft.id,
        reason: "Review valid v2 provenance before mutation.",
      });
      await mutateDocumentProvenance({
        action: "document_reprocessed",
        documentId: fixture.documentId,
        draftId: fixture.draft.id,
        mutation,
      });
      const logsBefore = await testDatabase.database
        .select({ id: dataChangeLogs.id })
        .from(dataChangeLogs)
        .where(eq(dataChangeLogs.entityKey, fixture.documentId));

      await expect(
        fixture.repository.publishDraft({
          actor: admin,
          draftId: fixture.draft.id,
          reason: "Invalid v2 provenance must not be published.",
        }),
      ).rejects.toBeInstanceOf(GovernanceConflictError);

      const [[draftAfter], [documentAfter], logsAfter] = await Promise.all([
        testDatabase.database
          .select({ workflowStatus: dataGovernanceDrafts.workflowStatus })
          .from(dataGovernanceDrafts)
          .where(eq(dataGovernanceDrafts.id, fixture.draft.id)),
        testDatabase.database
          .select({ governanceStatus: documents.governanceStatus })
          .from(documents)
          .where(eq(documents.id, fixture.documentId)),
        testDatabase.database
          .select({ action: dataChangeLogs.action })
          .from(dataChangeLogs)
          .where(eq(dataChangeLogs.entityKey, fixture.documentId)),
      ]);
      expect(draftAfter?.workflowStatus).toBe("reviewed");
      expect(documentAfter?.governanceStatus).toBe("reviewed");
      expect(logsAfter).toHaveLength(logsBefore.length);
      expect(logsAfter).not.toContainEqual({ action: "published" });
    },
  );

  it("commits a failed document with its draft and audit but no chunks", async () => {
    const repository = createGovernanceRepository(testDatabase.database);
    const dashboardRepository = createGovernanceDashboardRepository(
      testDatabase.database,
    );
    const knowledgeRepository = createKnowledgeRepository(
      testDatabase.database,
    );
    const prepared = preparedUpload("b", "failed-upload", "failed");
    const result = await repository.commitDocumentUpload({
      actor: editor,
      changeReason: "Keep a failed upload available for governed repair.",
      prepared,
    });

    const [storedDocument] = await testDatabase.database
      .select({
        processingError: documents.processingError,
        processingStatus: documents.processingStatus,
      })
      .from(documents)
      .where(eq(documents.id, result.documentId));
    const storedChunks = await testDatabase.database
      .select({ id: documentChunks.id })
      .from(documentChunks)
      .where(eq(documentChunks.documentId, result.documentId));
    const reprocessingSource =
      await knowledgeRepository.findDocumentForReprocessing({
        accessScope: { kind: "global" },
        documentId: result.documentId,
      });
    if (!result.draft) {
      throw new Error("Failed governed upload did not return its draft.");
    }
    const [reviewContext] =
      await dashboardRepository.getDraftReviewContexts([result.draft]);

    expect(result.draftCreated).toBe(true);
    expect(storedDocument).toEqual({
      processingError: "The document could not be parsed.",
      processingStatus: "failed",
    });
    expect(storedChunks).toEqual([]);
    const draftCreatedAudit = reprocessingSource?.auditMarkers.find(
      ({ action }) => action === "draft_created",
    );
    expect(
      documentDraftCreatedAuditAfterDataSchema.parse(
        draftCreatedAudit?.afterData,
      ).metadata,
    ).toEqual(prepared.metadata);
    expect(reviewContext).toMatchObject({
      blockingReasons: [
        "文档处理状态不是 ready（当前：failed）；当前禁止审核或发布。",
      ],
      publishReady: false,
    });
  });

  it("rolls back every upload row when the late audit insert fails", async () => {
    const repository = createGovernanceRepository(testDatabase.database);
    const prepared = preparedUpload("c", "rollback-upload");
    const invalidActor = {
      email: "rollback-upload@example.test",
      role: "invalid-role" as never,
    };

    await expect(
      repository.commitDocumentUpload({
        actor: invalidActor,
        changeReason: "Force the final audit insert to fail.",
        prepared,
      }),
    ).rejects.toThrow();

    await expect(
      Promise.all([
        testDatabase.database
          .select()
          .from(documents)
          .where(eq(documents.contentSha256, prepared.contentSha256)),
        testDatabase.database
          .select()
          .from(dataSources)
          .where(eq(dataSources.title, prepared.metadata.sourceTitle)),
        testDatabase.database
          .select()
          .from(dataGovernanceDrafts)
          .where(eq(dataGovernanceDrafts.createdBy, invalidActor.email)),
        testDatabase.database
          .select()
          .from(dataChangeLogs)
          .where(eq(dataChangeLogs.actorEmail, invalidActor.email)),
      ]),
    ).resolves.toEqual([[], [], [], []]);
  });

  it("repairs a legacy duplicate once without duplicating its source or audit", async () => {
    const repository = createGovernanceRepository(testDatabase.database);
    const prepared = preparedUpload("d", "duplicate-repair");
    const initial = await repository.commitDocumentUpload({
      actor: editor,
      changeReason: "Create a fixture that will lose its draft.",
      prepared,
    });
    await testDatabase.database
      .delete(dataChangeLogs)
      .where(eq(dataChangeLogs.entityKey, initial.documentId));
    await testDatabase.database
      .delete(dataGovernanceDrafts)
      .where(eq(dataGovernanceDrafts.entityKey, initial.documentId));

    const repaired = await repository.commitDocumentUpload({
      actor: editor,
      changeReason: "Repair the missing governance draft.",
      prepared,
    });
    const retried = await repository.commitDocumentUpload({
      actor: editor,
      changeReason: "Retry after the repair response was received.",
      prepared,
    });
    const [sources, drafts, logs] = await Promise.all([
      testDatabase.database
        .select()
        .from(dataSources)
        .where(eq(dataSources.title, prepared.metadata.sourceTitle)),
      testDatabase.database
        .select()
        .from(dataGovernanceDrafts)
        .where(eq(dataGovernanceDrafts.entityKey, initial.documentId)),
      testDatabase.database
        .select()
        .from(dataChangeLogs)
        .where(eq(dataChangeLogs.entityKey, initial.documentId)),
    ]);

    expect(repaired).toMatchObject({ created: false, draftCreated: true });
    expect(retried).toMatchObject({ created: false, draftCreated: false });
    expect(sources).toHaveLength(1);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ archivedAt: null, version: 1 });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.action).toBe("draft_created");

    const reprocessing = await preparedReprocessing({
      documentId: initial.documentId,
      fingerprint: "d".repeat(64),
      label: "duplicate-repair-reprocessed",
    });
    await expect(
      repository.commitDocumentReprocessing({
        actor: editor,
        prepared: reprocessing,
        reason: "Prove the repaired strict provenance supports reprocessing.",
      }),
    ).resolves.toMatchObject({ processingStatus: "ready" });
  });

  it("refuses duplicate-upload self-heal when any archived draft history remains", async () => {
    const repository = createGovernanceRepository(testDatabase.database);
    const prepared = preparedUpload("e", "duplicate-history-conflict");
    prepared.contentSha256 = sha256("upload:duplicate-history-conflict");
    const initial = await repository.commitDocumentUpload({
      actor: editor,
      changeReason: "Create the duplicate history conflict fixture.",
      prepared,
    });
    if (!initial.draft) {
      throw new Error("Duplicate history fixture draft was not returned.");
    }
    await testDatabase.database
      .update(dataGovernanceDrafts)
      .set({
        archivedAt: new Date("2026-09-05T13:00:00.000Z"),
        updatedAt: new Date("2026-09-05T13:00:00.000Z"),
      })
      .where(eq(dataGovernanceDrafts.id, initial.draft.id));
    const stateInput = {
      attemptedSourceTitle: prepared.metadata.sourceTitle,
      documentId: initial.documentId,
    };
    const before = await documentReprocessingState(stateInput);

    const error = await repository
      .commitDocumentUpload({
        actor: editor,
        changeReason: "Do not create a v2 draft_created marker.",
        prepared,
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GovernanceConflictError);
    expect(error).toMatchObject({
      message:
        "A document with governance history but no active draft cannot be repaired by duplicate upload.",
      name: "GovernanceConflictError",
    });
    expect(JSON.stringify(error)).not.toContain(editor.email);
    await expect(documentReprocessingState(stateInput)).resolves.toEqual(
      before,
    );
    expect(before.draftRows).toHaveLength(1);
    expect(before.draftRows[0]).toMatchObject({
      archivedAt: expect.any(Date),
      version: 1,
    });
    expect(before.logRows).toHaveLength(1);
    expect(before.logRows[0]?.action).toBe("draft_created");
  });

  it("refuses to repair a failed duplicate without strict existing provenance", async () => {
    const repository = createGovernanceRepository(testDatabase.database);
    const prepared = preparedUpload("6", "failed-duplicate-repair", "failed");
    const initial = await repository.commitDocumentUpload({
      actor: editor,
      changeReason: "Create the failed duplicate repair fixture.",
      prepared,
    });
    await testDatabase.database
      .delete(dataChangeLogs)
      .where(eq(dataChangeLogs.entityKey, initial.documentId));
    await testDatabase.database
      .delete(dataGovernanceDrafts)
      .where(eq(dataGovernanceDrafts.entityKey, initial.documentId));

    await expect(
      repository.commitDocumentUpload({
        actor: editor,
        changeReason: "Do not invent missing failed-document provenance.",
        prepared,
      }),
    ).rejects.toThrow("no trustworthy metadata provenance");

    await expect(
      testDatabase.database
        .select()
        .from(dataGovernanceDrafts)
        .where(eq(dataGovernanceDrafts.entityKey, initial.documentId)),
    ).resolves.toEqual([]);
  });

  it("enforces draft ownership before reprocessing and on idempotent replay", async () => {
    const repository = createGovernanceRepository(testDatabase.database);
    const knowledgeRepository = createKnowledgeRepository(
      testDatabase.database,
    );
    const otherEditor = {
      email: "other-atomic-editor@example.test",
      role: "editor" as const,
    };
    const initial = await repository.commitDocumentUpload({
      actor: editor,
      changeReason: "Create the owner-scoped reprocessing fixture.",
      prepared: preparedUpload("4", "owner-scope-initial"),
    });

    const [ownerVisible, otherEditorHidden, globallyVisible] =
      await Promise.all([
        knowledgeRepository.findDocumentForReprocessing({
          accessScope: {
            createdBy: editor.email,
            kind: "creator",
          },
          documentId: initial.documentId,
        }),
        knowledgeRepository.findDocumentForReprocessing({
          accessScope: {
            createdBy: otherEditor.email,
            kind: "creator",
          },
          documentId: initial.documentId,
        }),
        knowledgeRepository.findDocumentForReprocessing({
          accessScope: { kind: "global" },
          documentId: initial.documentId,
        }),
      ]);
    expect(ownerVisible?.activeDraft.createdBy).toBe(editor.email);
    expect(otherEditorHidden).toBeNull();
    expect(globallyVisible?.activeDraft.createdBy).toBe(editor.email);

    const prepared = await preparedReprocessing({
      documentId: initial.documentId,
      fingerprint: "4".repeat(64),
      label: "owner-scope-reprocessed",
    });
    const stateInput = {
      attemptedSourceTitle: prepared.metadata.sourceTitle,
      documentId: initial.documentId,
    };
    const beforeUnauthorizedCommit =
      await documentReprocessingState(stateInput);
    const forgedExpectationError = await repository
      .commitDocumentReprocessing({
        actor: admin,
        prepared: {
          ...prepared,
          expected: {
            ...prepared.expected,
            activeDraftCreatedBy: otherEditor.email,
          },
        },
        reason: "Reject a forged prepared owner expectation.",
      })
      .catch((caught: unknown) => caught);
    expect(forgedExpectationError).toBeInstanceOf(
      GovernanceConflictError,
    );

    const unauthorizedCommitError = await repository
      .commitDocumentReprocessing({
        actor: otherEditor,
        prepared,
        reason: "Do not mutate another editor's active draft.",
      })
      .catch((caught: unknown) => caught);
    expect(unauthorizedCommitError).toBeInstanceOf(
      GovernanceConflictError,
    );
    const unauthorizedCommitText =
      unauthorizedCommitError instanceof Error
        ? `${unauthorizedCommitError.name}: ${unauthorizedCommitError.message}`
        : JSON.stringify(unauthorizedCommitError);
    expect(unauthorizedCommitText).not.toContain(editor.email);
    await expect(documentReprocessingState(stateInput)).resolves.toEqual(
      beforeUnauthorizedCommit,
    );

    const committed = await repository.commitDocumentReprocessing({
      actor: reviewer,
      prepared,
      reason: "Use reviewer global scope for the governed replacement.",
    });
    const afterReviewerCommit = await documentReprocessingState(
      stateInput,
    );

    const unauthorizedReplayError = await repository
      .commitDocumentReprocessing({
        actor: editor,
        prepared,
        reason: "Do not replay a revision now owned by another actor.",
      })
      .catch((caught: unknown) => caught);
    expect(unauthorizedReplayError).toBeInstanceOf(
      GovernanceConflictError,
    );
    const unauthorizedReplayText =
      unauthorizedReplayError instanceof Error
        ? `${unauthorizedReplayError.name}: ${unauthorizedReplayError.message}`
        : JSON.stringify(unauthorizedReplayError);
    expect(unauthorizedReplayText).not.toContain(reviewer.email);
    await expect(documentReprocessingState(stateInput)).resolves.toEqual(
      afterReviewerCommit,
    );

    await expect(
      repository.commitDocumentReprocessing({
        actor: reviewer,
        prepared,
        reason: "Replay the reviewer-owned revision.",
      }),
    ).resolves.toEqual(committed);
    await expect(
      repository.commitDocumentReprocessing({
        actor: admin,
        prepared,
        reason: "Use admin global scope to inspect the same replay.",
      }),
    ).resolves.toEqual(committed);
  });

  it("reprocesses atomically, fences stale review, and publishes the marked revision", async () => {
    const repository = createGovernanceRepository(testDatabase.database);
    const dashboardRepository = createGovernanceDashboardRepository(
      testDatabase.database,
    );
    const initial = await repository.commitDocumentUpload({
      actor: editor,
      changeReason: "Create the initial unpublished document.",
      prepared: preparedUpload("e", "reprocess-initial"),
    });
    const oldDraftId = initial.draft?.id;
    if (!oldDraftId) throw new Error("Initial document draft was not returned.");
    const prepared = await preparedReprocessing({
      documentId: initial.documentId,
      fingerprint: "e".repeat(64),
      label: "reprocess-updated",
    });

    const committed = await repository.commitDocumentReprocessing({
      actor: editor,
      prepared,
      reason: "Replace the prepared evidence and force a fresh review.",
    });
    const replayed = await repository.commitDocumentReprocessing({
      actor: editor,
      prepared,
      reason: "Replace the prepared evidence and force a fresh review.",
    });
    const drafts = await testDatabase.database
      .select()
      .from(dataGovernanceDrafts)
      .where(eq(dataGovernanceDrafts.entityKey, initial.documentId))
      .orderBy(dataGovernanceDrafts.version);
    const newDraft = drafts.find(({ archivedAt }) => archivedAt === null);
    if (!newDraft) throw new Error("Reprocessing draft was not returned.");
    const contexts = await dashboardRepository.getDraftReviewContexts([
      newDraft,
    ]);

    expect(committed.summary).toMatchObject({
      chunkCount: 1,
      processingStatus: "ready",
      sourceTitle: prepared.metadata.sourceTitle,
      title: prepared.metadata.title,
    });
    expect(replayed.summary).toEqual(committed.summary);
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({ id: oldDraftId, version: 1 });
    expect(drafts[0]?.archivedAt).toBeInstanceOf(Date);
    expect(newDraft).toMatchObject({ version: 2, workflowStatus: "draft" });
    expect(contexts[0]).toMatchObject({
      baselineStatus: "first_revision",
      blockingReasons: [],
      publishReady: true,
    });
    await expect(
      repository.reviewDraft({
        actor: reviewer,
        draftId: oldDraftId,
        reason: "A stale reviewer must not approve replaced evidence.",
      }),
    ).rejects.toBeInstanceOf(GovernanceConflictError);

    await repository.reviewDraft({
      actor: reviewer,
      draftId: newDraft.id,
      reason: "Review the replacement evidence as a new revision.",
    });
    await expect(
      repository.publishDraft({
        actor: admin,
        draftId: newDraft.id,
        reason: "Publish the reviewed replacement evidence.",
      }),
    ).resolves.toMatchObject({ status: "published", version: 2 });

    const [sourceRows, reprocessLogs, activeDrafts] = await Promise.all([
      testDatabase.database
        .select({ id: dataSources.id, title: dataSources.title })
        .from(dataSources)
        .where(
          inArray(dataSources.title, [
            metadata("reprocess-initial").sourceTitle,
            prepared.metadata.sourceTitle,
          ]),
        ),
      testDatabase.database
        .select()
        .from(dataChangeLogs)
        .where(
          and(
            eq(dataChangeLogs.entityKey, initial.documentId),
            eq(dataChangeLogs.action, "document_reprocessed"),
          ),
        ),
      testDatabase.database
        .select()
        .from(dataGovernanceDrafts)
        .where(
          and(
            eq(dataGovernanceDrafts.entityKey, initial.documentId),
            isNull(dataGovernanceDrafts.archivedAt),
          ),
        ),
    ]);
    expect(sourceRows).toHaveLength(2);
    expect(reprocessLogs).toHaveLength(1);
    expect(reprocessLogs[0]?.draftId).toBe(newDraft.id);
    expect(activeDrafts).toHaveLength(1);
  });

  it("selects the latest reprocessing marker by draft version before audit timestamp", async () => {
    const repository = createGovernanceRepository(testDatabase.database);
    const upload = preparedUpload("f", "marker-version-order-initial");
    upload.contentSha256 = sha256("upload:marker-version-order-initial");
    const initial = await repository.commitDocumentUpload({
      actor: editor,
      changeReason: "Create the marker version ordering fixture.",
      prepared: upload,
    });
    const first = await preparedReprocessing({
      documentId: initial.documentId,
      fingerprint: sha256("marker-version-order:first"),
      label: "marker-version-order-first",
    });
    await repository.commitDocumentReprocessing({
      actor: editor,
      prepared: first,
      reason: "Create the older reprocessing marker.",
    });
    const second = await preparedReprocessing({
      documentId: initial.documentId,
      fingerprint: sha256("marker-version-order:second"),
      label: "marker-version-order-second",
    });
    const committed = await repository.commitDocumentReprocessing({
      actor: editor,
      prepared: second,
      reason: "Create the newest reprocessing marker.",
    });
    const markers = await testDatabase.database
      .select({
        afterData: dataChangeLogs.afterData,
        id: dataChangeLogs.id,
      })
      .from(dataChangeLogs)
      .where(
        and(
          eq(dataChangeLogs.entityKey, initial.documentId),
          eq(dataChangeLogs.action, "document_reprocessed"),
        ),
      );
    for (const marker of markers) {
      const parsed = documentReprocessedAuditAfterDataSchema.parse(
        marker.afterData,
      );
      await testDatabase.database
        .update(dataChangeLogs)
        .set({
          createdAt: new Date(
            parsed.operationFingerprint === first.operationFingerprint
              ? "2030-01-01T00:00:00.000Z"
              : "2020-01-01T00:00:00.000Z",
          ),
        })
        .where(eq(dataChangeLogs.id, marker.id));
    }

    await expect(
      repository.commitDocumentReprocessing({
        actor: editor,
        prepared: second,
        reason: "Replay the highest-version marker.",
      }),
    ).resolves.toEqual(committed);
  });

  it("fails review closed when chunk content and its stored hash drift together", async () => {
    const repository = createGovernanceRepository(testDatabase.database);
    const upload = preparedUpload("a", "review-chunk-set-drift");
    upload.contentSha256 = sha256("upload:review-chunk-set-drift");
    const committed = await repository.commitDocumentUpload({
      actor: editor,
      changeReason: "Create the strict chunk-set review fixture.",
      prepared: upload,
    });
    if (!committed.draft) {
      throw new Error("Chunk-set review fixture draft was not returned.");
    }
    const tamperedContent = "Tampered but internally re-hashed chunk content.";
    await testDatabase.database
      .update(documentChunks)
      .set({
        content: tamperedContent,
        contentHash: sha256(tamperedContent),
      })
      .where(eq(documentChunks.documentId, committed.documentId));

    await expect(
      repository.reviewDraft({
        actor: reviewer,
        draftId: committed.draft.id,
        reason: "Do not approve a drifted chunk set.",
      }),
    ).rejects.toBeInstanceOf(GovernanceConflictError);
    const [draft, reviewedLogs] = await Promise.all([
      testDatabase.database
        .select({ workflowStatus: dataGovernanceDrafts.workflowStatus })
        .from(dataGovernanceDrafts)
        .where(eq(dataGovernanceDrafts.id, committed.draft.id)),
      testDatabase.database
        .select({ id: dataChangeLogs.id })
        .from(dataChangeLogs)
        .where(
          and(
            eq(dataChangeLogs.draftId, committed.draft.id),
            eq(dataChangeLogs.action, "reviewed"),
          ),
        ),
    ]);
    expect(draft[0]?.workflowStatus).toBe("draft");
    expect(reviewedLogs).toEqual([]);
  });

  it("replays an identical failed-to-failed no-chunk operation without side effects", async () => {
    const repository = createGovernanceRepository(testDatabase.database);
    const upload = preparedUpload("b", "failed-replay-initial", "failed");
    upload.contentSha256 = sha256("upload:failed-replay-initial");
    const initial = await repository.commitDocumentUpload({
      actor: editor,
      changeReason: "Create the failed no-chunk replay fixture.",
      prepared: upload,
    });
    const readyPrepared = await preparedReprocessing({
      documentId: initial.documentId,
      fingerprint: sha256("failed-to-failed-no-chunk"),
      label: "failed-replay-updated",
    });
    const prepared: PreparedKnowledgeDocumentReprocessing = {
      ...readyPrepared,
      outcome: {
        chunks: [],
        processingError: "The document still could not be parsed.",
        processingStatus: "failed",
      },
    };

    const committed = await repository.commitDocumentReprocessing({
      actor: editor,
      prepared,
      reason: "Commit the failed no-chunk replacement once.",
    });
    const afterCommit = await documentReprocessingState({
      attemptedSourceTitle: prepared.metadata.sourceTitle,
      documentId: initial.documentId,
    });
    const replayed = await repository.commitDocumentReprocessing({
      actor: editor,
      prepared,
      reason: "Replay the same failed no-chunk replacement.",
    });

    expect(replayed).toEqual(committed);
    await expect(
      documentReprocessingState({
        attemptedSourceTitle: prepared.metadata.sourceTitle,
        documentId: initial.documentId,
      }),
    ).resolves.toEqual(afterCommit);
    expect(afterCommit.chunkRows).toEqual([]);
    expect(
      afterCommit.logRows.filter(
        ({ action }) => action === "document_reprocessed",
      ),
    ).toHaveLength(1);
  });

  it("rejects marker-only failed metadata drift between prepare and commit", async () => {
    const repository = createGovernanceRepository(testDatabase.database);
    const upload = preparedUpload("c", "failed-marker-toctou", "failed");
    upload.contentSha256 = sha256("upload:failed-marker-toctou");
    const initial = await repository.commitDocumentUpload({
      actor: editor,
      changeReason: "Create the failed marker TOCTOU fixture.",
      prepared: upload,
    });
    const prepared = await preparedReprocessing({
      documentId: initial.documentId,
      fingerprint: sha256("failed-marker-toctou"),
      label: "failed-marker-toctou-updated",
    });
    const [marker] = await testDatabase.database
      .select()
      .from(dataChangeLogs)
      .where(
        and(
          eq(dataChangeLogs.draftId, prepared.expected.activeDraftId),
          eq(dataChangeLogs.action, "draft_created"),
        ),
      );
    const afterData = documentDraftCreatedAuditAfterDataSchema.parse(
      marker?.afterData,
    );
    await testDatabase.database
      .update(dataChangeLogs)
      .set({
        afterData: {
          ...afterData,
          metadata: {
            ...afterData.metadata,
            applicationScope: "marine",
          },
        },
      })
      .where(eq(dataChangeLogs.id, marker!.id));
    const beforeCommit = await documentReprocessingState({
      attemptedSourceTitle: prepared.metadata.sourceTitle,
      documentId: initial.documentId,
    });

    await expect(
      repository.commitDocumentReprocessing({
        actor: editor,
        prepared,
        reason: "Reject marker-only metadata drift.",
      }),
    ).rejects.toMatchObject({
      message:
        "The document metadata provenance changed while reprocessing was prepared; retry from the latest version.",
      name: "GovernanceConflictError",
    });
    await expect(
      documentReprocessingState({
        attemptedSourceTitle: prepared.metadata.sourceTitle,
        documentId: initial.documentId,
      }),
    ).resolves.toEqual(beforeCommit);
  });

  it.each(["operationFingerprint", "supersededDraftIds"] as const)(
    "rejects %s drift inside the same canonical audit row after prepare",
    async (field) => {
      const repository = createGovernanceRepository(testDatabase.database);
      const upload = preparedUpload("d", `marker-toctou-${field}`);
      upload.contentSha256 = sha256(`upload:marker-toctou-${field}`);
      const initial = await repository.commitDocumentUpload({
        actor: editor,
        changeReason: `Create the ${field} marker TOCTOU fixture.`,
        prepared: upload,
      });
      const first = await preparedReprocessing({
        documentId: initial.documentId,
        fingerprint: sha256(`first-marker:${field}`),
        label: `marker-toctou-first-${field}`,
      });
      await repository.commitDocumentReprocessing({
        actor: editor,
        prepared: first,
        reason: "Create the v2 canonical marker.",
      });
      const second = await preparedReprocessing({
        documentId: initial.documentId,
        fingerprint: sha256(`second-marker:${field}`),
        label: `marker-toctou-second-${field}`,
      });
      const [marker] = await testDatabase.database
        .select()
        .from(dataChangeLogs)
        .where(eq(dataChangeLogs.id, second.expected.provenanceAuditId));
      if (!marker) {
        throw new Error("V2 marker TOCTOU fixture was not returned.");
      }
      const afterData = documentReprocessedAuditAfterDataSchema.parse(
        marker.afterData,
      );
      await testDatabase.database
        .update(dataChangeLogs)
        .set({
          afterData: {
            ...afterData,
            ...(field === "operationFingerprint"
              ? { operationFingerprint: "f".repeat(64) }
              : {
                  supersededDraftIds: [
                    "83000000-0000-4000-8000-000000000099",
                  ],
                }),
          },
        })
        .where(eq(dataChangeLogs.id, marker.id));
      const beforeCommit = await documentReprocessingState({
        attemptedSourceTitle: second.metadata.sourceTitle,
        documentId: initial.documentId,
      });

      await expect(
        repository.commitDocumentReprocessing({
          actor: editor,
          prepared: second,
          reason: `Reject ${field} drift in the same audit row.`,
        }),
      ).rejects.toMatchObject({
        message:
          field === "operationFingerprint"
            ? "The document metadata provenance changed while reprocessing was prepared; retry from the latest version."
            : "Document draft v2 reprocessing provenance does not identify its immediate archived predecessor.",
        name: "GovernanceConflictError",
      });
      await expect(
        documentReprocessingState({
          attemptedSourceTitle: second.metadata.sourceTitle,
          documentId: initial.documentId,
        }),
      ).resolves.toEqual(beforeCommit);
    },
  );

  it.each([
    [
      "document title",
      async (documentId: string) => {
        await testDatabase.database
          .update(documents)
          .set({ title: "Drifted after the reprocessing response" })
          .where(eq(documents.id, documentId));
      },
    ],
    [
      "document chunk metadata",
      async (documentId: string) => {
        await testDatabase.database
          .update(documentChunks)
          .set({ applicationScope: "marine" })
          .where(eq(documentChunks.documentId, documentId));
      },
    ],
    [
      "document chunk content with a self-consistent hash",
      async (documentId: string) => {
        const content = "Tampered content with a matching replacement hash.";
        await testDatabase.database
          .update(documentChunks)
          .set({ content, contentHash: sha256(content) })
          .where(eq(documentChunks.documentId, documentId));
      },
    ],
    [
      "document processing status",
      async (documentId: string) => {
        await testDatabase.database
          .update(documents)
          .set({
            processingError: "Drifted processing outcome",
            processingStatus: "failed",
          })
          .where(eq(documents.id, documentId));
      },
    ],
    [
      "document content hash",
      async (documentId: string) => {
        await testDatabase.database
          .update(documents)
          .set({ contentSha256: sha256(`drift:${documentId}`) })
          .where(eq(documents.id, documentId));
      },
    ],
    [
      "source verifiedAt",
      (documentId: string) =>
        driftSourceTimestampWithinSameMillisecond(
          documentId,
          "verifiedAt",
        ),
    ],
    [
      "source updatedAt",
      (documentId: string) =>
        driftSourceTimestampWithinSameMillisecond(
          documentId,
          "updatedAt",
        ),
    ],
  ] as const)(
    "fails an idempotent replay closed after %s drift",
    async (label, mutateCurrentState) => {
      const repository = createGovernanceRepository(testDatabase.database);
      const fixtureLabel = `replay-drift-${label.replaceAll(" ", "-")}`;
      const upload = preparedUpload("6", fixtureLabel);
      upload.contentSha256 = sha256(`upload:${fixtureLabel}`);
      const initial = await repository.commitDocumentUpload({
        actor: editor,
        changeReason: `Create the ${label} replay-drift fixture.`,
        prepared: upload,
      });
      const prepared = await preparedReprocessing({
        documentId: initial.documentId,
        fingerprint: sha256(`replay-drift:${label}`),
        label: `${fixtureLabel}-reprocessed`,
      });
      await repository.commitDocumentReprocessing({
        actor: editor,
        prepared,
        reason: `Commit the ${label} replay-drift fixture.`,
      });
      await mutateCurrentState(initial.documentId);
      const beforeReplay = await documentReprocessingState({
        attemptedSourceTitle: prepared.metadata.sourceTitle,
        documentId: initial.documentId,
      });

      const replayError = await repository
        .commitDocumentReprocessing({
          actor: editor,
          prepared,
          reason: `Replay the ${label} drifted operation.`,
        })
        .catch((error: unknown) => error);
      expect(replayError).toBeInstanceOf(GovernanceConflictError);
      expect(
        replayError instanceof Error
          ? `${replayError.name}: ${replayError.message}`
          : JSON.stringify(replayError),
      ).not.toContain(editor.email);
      await expect(
        documentReprocessingState({
          attemptedSourceTitle: prepared.metadata.sourceTitle,
          documentId: initial.documentId,
        }),
      ).resolves.toEqual(beforeReplay);
    },
  );

  it("rejects an idempotent replay when more than one active document draft exists", async () => {
    const repository = createGovernanceRepository(testDatabase.database);
    const upload = preparedUpload("b", "duplicate-active-replay-initial");
    upload.contentSha256 = sha256("upload:duplicate-active-replay-initial");
    const initial = await repository.commitDocumentUpload({
      actor: editor,
      changeReason: "Create the duplicate-active replay fixture.",
      prepared: upload,
    });
    const prepared = await preparedReprocessing({
      documentId: initial.documentId,
      fingerprint: sha256("duplicate-active-replay"),
      label: "duplicate-active-replay-updated",
    });
    await repository.commitDocumentReprocessing({
      actor: editor,
      prepared,
      reason: "Commit the duplicate-active replay fixture.",
    });
    await testDatabase.database.insert(dataGovernanceDrafts).values({
      changeReason: "Forge a second active draft for replay validation.",
      createdBy: editor.email,
      entityKey: initial.documentId,
      entityType: "document",
      payload: { documentId: initial.documentId },
      version: 3,
    });

    await expect(
      repository.commitDocumentReprocessing({
        actor: editor,
        prepared,
        reason: "Reject the ambiguous active replay target.",
      }),
    ).rejects.toMatchObject({
      message:
        "The active document draft changed while reprocessing was prepared; retry from the latest version.",
      name: "GovernanceConflictError",
    });
  });

  it("rejects a structurally valid reprocessing marker bound to a stale source", async () => {
    const repository = createGovernanceRepository(testDatabase.database);
    const dashboardRepository = createGovernanceDashboardRepository(
      testDatabase.database,
    );
    const initial = await repository.commitDocumentUpload({
      actor: editor,
      changeReason: "Create the forged marker fixture.",
      prepared: preparedUpload("7", "forged-marker-initial"),
    });
    const prepared = await preparedReprocessing({
      documentId: initial.documentId,
      fingerprint: "7".repeat(64),
      label: "forged-marker-reprocessed",
    });
    await repository.commitDocumentReprocessing({
      actor: editor,
      prepared,
      reason: "Create the replacement draft before forging its marker.",
    });

    const [draft] = await testDatabase.database
      .select()
      .from(dataGovernanceDrafts)
      .where(
        and(
          eq(dataGovernanceDrafts.entityKey, initial.documentId),
          isNull(dataGovernanceDrafts.archivedAt),
        ),
      );
    const [marker] = await testDatabase.database
      .select()
      .from(dataChangeLogs)
      .where(
        and(
          eq(dataChangeLogs.entityKey, initial.documentId),
          eq(dataChangeLogs.action, "document_reprocessed"),
        ),
      );
    if (!draft || !marker) {
      throw new Error("Reprocessing marker fixture was not created.");
    }
    const validAfterData = documentReprocessedAuditAfterDataSchema.parse(
      marker.afterData,
    );
    await testDatabase.database
      .update(dataChangeLogs)
      .set({
        afterData: {
          ...validAfterData,
          sourceId: prepared.expected.dataSourceId,
        },
      })
      .where(eq(dataChangeLogs.id, marker.id));

    const [context] = await dashboardRepository.getDraftReviewContexts([
      draft,
    ]);
    expect(context).toMatchObject({
      baselineStatus: "missing",
      publishReady: false,
    });
    expect(context?.blockingReasons).toContain(
      "缺少可核验的当前发布基线；为避免覆盖未知正式数据，当前禁止发布。",
    );

    await expect(
      repository.reviewDraft({
        actor: reviewer,
        draftId: draft.id,
        reason: "A forged source marker must not authorize review.",
      }),
    ).rejects.toThrow("canonical provenance is malformed or has drifted");
    const [unchangedDraft] = await testDatabase.database
      .select({ workflowStatus: dataGovernanceDrafts.workflowStatus })
      .from(dataGovernanceDrafts)
      .where(eq(dataGovernanceDrafts.id, draft.id));
    const [unchangedDocument] = await testDatabase.database
      .select({ governanceStatus: documents.governanceStatus })
      .from(documents)
      .where(eq(documents.id, initial.documentId));
    const reviewedLogs = await testDatabase.database
      .select({ id: dataChangeLogs.id })
      .from(dataChangeLogs)
      .where(
        and(
          eq(dataChangeLogs.draftId, draft.id),
          eq(dataChangeLogs.action, "reviewed"),
        ),
      );
    expect(unchangedDraft?.workflowStatus).toBe("draft");
    expect(unchangedDocument?.governanceStatus).toBe("draft");
    expect(reviewedLogs).toEqual([]);
  });

  it("maps a PostgreSQL 23505 draft insert to a conflict and rolls back reprocessing", async () => {
    const repository = createGovernanceRepository(testDatabase.database);
    const reason = "Force a PostgreSQL draft version conflict.";
    const initial = await repository.commitDocumentUpload({
      actor: editor,
      changeReason: "Create the unique violation fixture.",
      prepared: preparedUpload("8", "unique-violation-initial"),
    });
    const [beforeDocument] = await testDatabase.database
      .select({
        dataSourceId: documents.dataSourceId,
        title: documents.title,
      })
      .from(documents)
      .where(eq(documents.id, initial.documentId));
    const prepared = await preparedReprocessing({
      documentId: initial.documentId,
      fingerprint: "8".repeat(64),
      label: "unique-violation-reprocessed",
    });

    // PGlite can prove SQLSTATE mapping and transactional rollback, but its
    // single embedded connection cannot reproduce PostgreSQL lock contention.
    await testDatabase.client.exec(`
      create function force_reprocessing_draft_unique_violation() returns trigger
      language plpgsql as $$
      begin
        if new.change_reason = '${reason}' then
          raise exception 'forced draft version conflict' using errcode = '23505';
        end if;
        return new;
      end;
      $$;
      create trigger force_reprocessing_draft_unique_violation_trigger
      before insert on data_governance_drafts
      for each row execute function force_reprocessing_draft_unique_violation();
    `);

    try {
      await expect(
        repository.commitDocumentReprocessing({
          actor: editor,
          prepared,
          reason,
        }),
      ).rejects.toMatchObject({
        message:
          "Another document draft revision was created concurrently; retry from the latest version.",
        name: "GovernanceConflictError",
      });
    } finally {
      await testDatabase.client.exec(`
        drop trigger force_reprocessing_draft_unique_violation_trigger
          on data_governance_drafts;
        drop function force_reprocessing_draft_unique_violation();
      `);
    }

    const [afterDocumentRows, rollbackSources, drafts, reprocessingLogs] =
      await Promise.all([
        testDatabase.database
          .select({
            dataSourceId: documents.dataSourceId,
            title: documents.title,
          })
          .from(documents)
          .where(eq(documents.id, initial.documentId)),
        testDatabase.database
          .select({ id: dataSources.id })
          .from(dataSources)
          .where(eq(dataSources.title, prepared.metadata.sourceTitle)),
        testDatabase.database
          .select()
          .from(dataGovernanceDrafts)
          .where(eq(dataGovernanceDrafts.entityKey, initial.documentId)),
        testDatabase.database
          .select()
          .from(dataChangeLogs)
          .where(
            and(
              eq(dataChangeLogs.entityKey, initial.documentId),
              eq(dataChangeLogs.action, "document_reprocessed"),
            ),
          ),
      ]);
    expect(afterDocumentRows[0]).toEqual(beforeDocument);
    expect(rollbackSources).toEqual([]);
    expect(drafts).toHaveLength(1);
    expect(reprocessingLogs).toEqual([]);
  });

  it("rejects reprocessing when the linked source changes under the same id", async () => {
    const repository = createGovernanceRepository(testDatabase.database);
    const initial = await repository.commitDocumentUpload({
      actor: editor,
      changeReason: "Create the source fingerprint fixture.",
      prepared: preparedUpload("5", "source-fingerprint-initial"),
    });
    const prepared = await preparedReprocessing({
      documentId: initial.documentId,
      fingerprint: "5".repeat(64),
      label: "source-fingerprint-reprocessed",
    });
    await testDatabase.database
      .update(dataSources)
      .set({
        title: "Concurrent governed source title",
        updatedAt: new Date("2026-08-30T12:00:00.000Z"),
      })
      .where(eq(dataSources.id, prepared.expected.dataSourceId));

    await expect(
      repository.commitDocumentReprocessing({
        actor: editor,
        prepared,
        reason: "A stale source snapshot must not be committed.",
      }),
    ).rejects.toThrow("changed while reprocessing was prepared");

    const [storedDocument] = await testDatabase.database
      .select({
        dataSourceId: documents.dataSourceId,
        title: documents.title,
      })
      .from(documents)
      .where(eq(documents.id, initial.documentId));
    expect(storedDocument).toEqual({
      dataSourceId: prepared.expected.dataSourceId,
      title: metadata("source-fingerprint-initial").title,
    });
  });

  it("rolls back a late reprocess audit failure and rejects a stale contender", async () => {
    const repository = createGovernanceRepository(testDatabase.database);
    const initial = await repository.commitDocumentUpload({
      actor: editor,
      changeReason: "Create a reprocess rollback fixture.",
      prepared: preparedUpload("f", "reprocess-rollback-initial"),
    });
    const [beforeDocument] = await testDatabase.database
      .select({
        dataSourceId: documents.dataSourceId,
        title: documents.title,
      })
      .from(documents)
      .where(eq(documents.id, initial.documentId));
    const prepared = await preparedReprocessing({
      documentId: initial.documentId,
      fingerprint: "1".repeat(64),
      label: "reprocess-rollback-attempt",
    });
    const invalidActor = {
      email: "rollback-reprocess@example.test",
      role: "invalid-role" as never,
    };

    await expect(
      repository.commitDocumentReprocessing({
        actor: invalidActor,
        prepared,
        reason: "Force the reprocess audit insertion to fail.",
      }),
    ).rejects.toThrow();

    const [afterRollback] = await testDatabase.database
      .select({
        dataSourceId: documents.dataSourceId,
        title: documents.title,
      })
      .from(documents)
      .where(eq(documents.id, initial.documentId));
    const rollbackSources = await testDatabase.database
      .select()
      .from(dataSources)
      .where(eq(dataSources.title, prepared.metadata.sourceTitle));
    expect(afterRollback).toEqual(beforeDocument);
    expect(rollbackSources).toEqual([]);

    const left = { ...prepared, operationFingerprint: "2".repeat(64) };
    const right = {
      ...prepared,
      metadata: metadata("reprocess-concurrent-right"),
      operationFingerprint: "3".repeat(64),
    };
    const results = await Promise.allSettled([
      repository.commitDocumentReprocessing({
        actor: editor,
        prepared: left,
        reason: "Commit the left concurrent revision.",
      }),
      repository.commitDocumentReprocessing({
        actor: editor,
        prepared: right,
        reason: "Commit the right concurrent revision.",
      }),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(({ status }) => status === "rejected");
    expect(rejected?.status).toBe("rejected");
    if (rejected?.status === "rejected") {
      expect(rejected.reason).toBeInstanceOf(GovernanceConflictError);
    }
    const reprocessLogs = await testDatabase.database
      .select()
      .from(dataChangeLogs)
      .where(
        and(
          eq(dataChangeLogs.entityKey, initial.documentId),
          eq(dataChangeLogs.action, "document_reprocessed"),
        ),
      );
    expect(reprocessLogs).toHaveLength(1);
  });
});
