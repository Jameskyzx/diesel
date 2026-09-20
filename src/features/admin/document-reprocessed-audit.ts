import { createHash } from "node:crypto";

import { z } from "zod";

import {
  documentImportMetadataSchema,
  sourceTypes,
  type DocumentImportMetadata,
} from "@/features/knowledge/schemas";
import { applicationScopeSchema } from "@/features/database/schemas";

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const provenanceVersionSchema = z.literal(2);

function canonicalizePostgresTimestamp(value: Date | string): string {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw new Error("Invalid provenance timestamp.");
    }
    return value
      .toISOString()
      .replace(
        /\.(\d{3})Z$/u,
        (_match, milliseconds: string) => `.${milliseconds}000Z`,
      );
  }

  const parsed = z.iso.datetime({ offset: true }).parse(value);
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/u.exec(parsed)?.[1] ?? "";
  if (fraction.length > 6) {
    throw new Error("Provenance timestamps cannot exceed PostgreSQL microsecond precision.");
  }
  const instant = new Date(parsed);
  if (!Number.isFinite(instant.getTime())) {
    throw new Error("Invalid provenance timestamp.");
  }
  const exactFraction = fraction.padEnd(6, "0");
  return instant
    .toISOString()
    .replace(/\.\d{3}Z$/u, `.${exactFraction}Z`);
}

const exactTimestampInputSchema = z.union([
  z.date(),
  z.iso.datetime({ offset: true }),
]);

const documentChunkFingerprintRowSchema = z
  .object({
    applicationScope: applicationScopeSchema.nullable(),
    chunkIndex: z.number().int().nonnegative(),
    content: z.string(),
    contentHash: sha256Schema,
    countryIso3: z.string().regex(/^[A-Z]{3}$/).nullable(),
    createdAt: exactTimestampInputSchema,
    embedding: z.array(z.number().finite()).length(128).nullable(),
    embeddingModel: z.string().nullable(),
    headingPath: z.array(z.string()).nullable(),
    isDemo: z.boolean(),
    jurisdictionId: z.uuid().nullable(),
    pageFrom: z.number().int().positive().nullable(),
    pageTo: z.number().int().positive().nullable(),
    sectionLocator: z.string().nullable(),
    tokenCount: z.number().int().nonnegative().nullable(),
    updatedAt: exactTimestampInputSchema,
    validFrom: z.iso.date().nullable(),
    validTo: z.iso.date().nullable(),
    verifiedAt: exactTimestampInputSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const contentHash = createHash("sha256")
      .update(value.content)
      .digest("hex");
    if (contentHash !== value.contentHash) {
      context.addIssue({
        code: "custom",
        message: "Chunk content hash does not match its content.",
        path: ["contentHash"],
      });
    }
    if (value.pageTo !== null && value.pageFrom === null) {
      context.addIssue({
        code: "custom",
        message: "Chunk pageTo requires pageFrom.",
        path: ["pageTo"],
      });
    }
    if (
      value.pageFrom !== null &&
      value.pageTo !== null &&
      value.pageTo < value.pageFrom
    ) {
      context.addIssue({
        code: "custom",
        message: "Chunk page range is invalid.",
        path: ["pageTo"],
      });
    }
    if (
      value.validTo !== null &&
      (value.validFrom === null || value.validTo <= value.validFrom)
    ) {
      context.addIssue({
        code: "custom",
        message: "Chunk validity range is invalid.",
        path: ["validTo"],
      });
    }
  });

const documentChunkSetFingerprintPayloadSchema = z
  .object({
    chunks: z.array(documentChunkFingerprintRowSchema),
    processingStatus: z.enum(["ready", "failed"]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.processingStatus === "ready" && value.chunks.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Ready document provenance requires at least one chunk.",
        path: ["chunks"],
      });
    }
    if (value.processingStatus === "failed" && value.chunks.length !== 0) {
      context.addIssue({
        code: "custom",
        message: "Failed document provenance cannot contain chunks.",
        path: ["chunks"],
      });
    }
  });

export function createDocumentChunkSetFingerprint(value: unknown): string {
  const parsed = documentChunkSetFingerprintPayloadSchema.parse(value);
  const chunks = [...parsed.chunks]
    .sort((left, right) => left.chunkIndex - right.chunkIndex)
    .map((chunk) => ({
      ...chunk,
      createdAt: canonicalizePostgresTimestamp(chunk.createdAt),
      embedding: chunk.embedding?.map((component) => {
        const normalized = Math.fround(component);
        return Object.is(normalized, -0) ? 0 : normalized;
      }) ?? null,
      updatedAt: canonicalizePostgresTimestamp(chunk.updatedAt),
      verifiedAt: canonicalizePostgresTimestamp(chunk.verifiedAt),
    }));
  if (
    chunks.some((chunk, index) => chunk.chunkIndex !== index)
  ) {
    throw new Error("Document chunk indexes must be contiguous from zero.");
  }
  return createHash("sha256")
    .update(
      JSON.stringify({
        chunks,
        processingStatus: parsed.processingStatus,
      }),
    )
    .digest("hex");
}

export function normalizeDocumentImportMetadataForProvenance(
  value: DocumentImportMetadata,
): DocumentImportMetadata {
  const metadata = documentImportMetadataSchema.parse(value);
  return documentImportMetadataSchema.parse({
    ...metadata,
    canonicalUrl: metadata.canonicalUrl || null,
    demoNotice: metadata.isDemo ? metadata.demoNotice : null,
    sourceUrl: metadata.sourceUrl || null,
  });
}

export const documentDraftCreatedAuditAfterDataSchema = z
  .object({
    chunkSetFingerprint: sha256Schema,
    contentSha256: sha256Schema,
    documentId: z.uuid(),
    metadata: documentImportMetadataSchema,
    processingStatus: z.enum(["ready", "failed"]),
    provenanceVersion: provenanceVersionSchema,
    sourceFingerprint: sha256Schema,
    sourceId: z.uuid(),
  })
  .strict();

export const documentDraftCreatedAuditMarkerSchema = z
  .object({
    afterData: documentDraftCreatedAuditAfterDataSchema,
    draftId: z.uuid(),
    entityKey: z.uuid(),
    entityType: z.literal("document"),
  })
  .strict()
  .refine((value) => value.entityKey === value.afterData.documentId, {
    message: "Audit entityKey must match afterData.documentId",
    path: ["afterData", "documentId"],
  });

export type DocumentDraftCreatedAuditMarker = z.infer<
  typeof documentDraftCreatedAuditMarkerSchema
>;

export function parseDocumentDraftCreatedAuditMarkerFor(input: {
  expectedChunkSetFingerprint?: string;
  expectedContentSha256: string;
  expectedDocumentId: string;
  expectedDraftId: string;
  expectedProcessingStatus: "failed" | "ready";
  expectedMetadata?: DocumentImportMetadata;
  expectedSourceFingerprint?: string;
  expectedSourceId: string;
  marker: unknown;
}): DocumentDraftCreatedAuditMarker | null {
  const parsed = documentDraftCreatedAuditMarkerSchema.safeParse(input.marker);

  if (
    !parsed.success ||
    (input.expectedChunkSetFingerprint !== undefined &&
      parsed.data.afterData.chunkSetFingerprint !==
        input.expectedChunkSetFingerprint) ||
    parsed.data.afterData.contentSha256 !== input.expectedContentSha256 ||
    parsed.data.afterData.documentId !== input.expectedDocumentId ||
    parsed.data.afterData.processingStatus !==
      input.expectedProcessingStatus ||
    (input.expectedMetadata !== undefined &&
      JSON.stringify(parsed.data.afterData.metadata) !==
        JSON.stringify(
          documentImportMetadataSchema.parse(input.expectedMetadata),
        )) ||
    (input.expectedSourceFingerprint !== undefined &&
      parsed.data.afterData.sourceFingerprint !==
        input.expectedSourceFingerprint) ||
    parsed.data.afterData.sourceId !== input.expectedSourceId ||
    parsed.data.draftId !== input.expectedDraftId
  ) {
    return null;
  }

  return parsed.data;
}

export const documentReprocessedAuditAfterDataSchema = z
  .object({
    chunkSetFingerprint: sha256Schema,
    contentSha256: sha256Schema,
    documentId: z.uuid(),
    metadata: documentImportMetadataSchema,
    operationFingerprint: sha256Schema,
    processingStatus: z.enum(["ready", "failed"]),
    provenanceVersion: provenanceVersionSchema,
    sourceFingerprint: sha256Schema,
    sourceId: z.uuid(),
    status: z.enum(["ready", "failed"]),
    supersededDraftIds: z.array(z.uuid()).length(1),
  })
  .strict()
  .refine((value) => value.status === value.processingStatus, {
    message: "Audit status must match processingStatus",
    path: ["status"],
  });

export const documentReprocessedAuditMarkerSchema = z
  .object({
    afterData: documentReprocessedAuditAfterDataSchema,
    draftId: z.uuid(),
    entityKey: z.uuid(),
    entityType: z.literal("document"),
  })
  .strict()
  .refine((value) => value.entityKey === value.afterData.documentId, {
    message: "Audit entityKey must match afterData.documentId",
    path: ["afterData", "documentId"],
  });

export type DocumentReprocessedAuditMarker = z.infer<
  typeof documentReprocessedAuditMarkerSchema
>;

export function parseDocumentReprocessedAuditMarkerFor(input: {
  expectedChunkSetFingerprint?: string;
  expectedContentSha256?: string;
  expectedDocumentId: string;
  expectedDraftId: string;
  expectedMetadata?: DocumentImportMetadata;
  expectedProcessingStatus?: "failed" | "ready";
  expectedSourceFingerprint?: string;
  expectedSourceId: string;
  marker: unknown;
}): DocumentReprocessedAuditMarker | null {
  const parsed = documentReprocessedAuditMarkerSchema.safeParse(input.marker);

  if (
    !parsed.success ||
    (input.expectedChunkSetFingerprint !== undefined &&
      parsed.data.afterData.chunkSetFingerprint !==
        input.expectedChunkSetFingerprint) ||
    (input.expectedContentSha256 !== undefined &&
      parsed.data.afterData.contentSha256 !==
        input.expectedContentSha256) ||
    parsed.data.afterData.documentId !== input.expectedDocumentId ||
    (input.expectedMetadata !== undefined &&
      JSON.stringify(parsed.data.afterData.metadata) !==
        JSON.stringify(
          documentImportMetadataSchema.parse(input.expectedMetadata),
        )) ||
    (input.expectedProcessingStatus !== undefined &&
      parsed.data.afterData.processingStatus !==
        input.expectedProcessingStatus) ||
    (input.expectedSourceFingerprint !== undefined &&
      parsed.data.afterData.sourceFingerprint !==
        input.expectedSourceFingerprint) ||
    parsed.data.afterData.sourceId !== input.expectedSourceId ||
    parsed.data.draftId !== input.expectedDraftId
  ) {
    return null;
  }

  return parsed.data;
}

export type CanonicalDocumentProvenanceMarker =
  | {
      action: "document_reprocessed";
      marker: DocumentReprocessedAuditMarker;
    }
  | {
      action: "draft_created";
      marker: DocumentDraftCreatedAuditMarker;
    };

export function createDocumentProvenanceMarkerFingerprint(
  value: unknown,
): string {
  const reprocessed = documentReprocessedAuditMarkerSchema.safeParse(value);
  if (reprocessed.success) {
    return createHash("sha256")
      .update(
        JSON.stringify({
          action: "document_reprocessed",
          marker: reprocessed.data,
        }),
      )
      .digest("hex");
  }
  const created = documentDraftCreatedAuditMarkerSchema.safeParse(value);
  if (created.success) {
    return createHash("sha256")
      .update(
        JSON.stringify({ action: "draft_created", marker: created.data }),
      )
      .digest("hex");
  }
  throw new Error("Canonical document provenance marker is malformed.");
}

export function getDocumentProvenanceActionForVersion(
  version: number,
): CanonicalDocumentProvenanceMarker["action"] {
  return version === 1 ? "draft_created" : "document_reprocessed";
}

export function parseCanonicalDocumentProvenanceMarkerFor(input: {
  draftVersion: number;
  expectedChunkSetFingerprint: string;
  expectedContentSha256: string;
  expectedDocumentId: string;
  expectedDraftId: string;
  expectedMetadata: DocumentImportMetadata;
  expectedProcessingStatus: "failed" | "ready";
  expectedSourceFingerprint: string;
  expectedSourceId: string;
  marker: unknown;
}): CanonicalDocumentProvenanceMarker | null {
  const action = getDocumentProvenanceActionForVersion(input.draftVersion);

  if (action === "draft_created") {
    const marker = parseDocumentDraftCreatedAuditMarkerFor({
      expectedChunkSetFingerprint: input.expectedChunkSetFingerprint,
      expectedContentSha256: input.expectedContentSha256,
      expectedDocumentId: input.expectedDocumentId,
      expectedDraftId: input.expectedDraftId,
      expectedMetadata: input.expectedMetadata,
      expectedProcessingStatus: input.expectedProcessingStatus,
      expectedSourceFingerprint: input.expectedSourceFingerprint,
      expectedSourceId: input.expectedSourceId,
      marker: input.marker,
    });
    return marker ? { action, marker } : null;
  }

  const marker = parseDocumentReprocessedAuditMarkerFor({
    expectedChunkSetFingerprint: input.expectedChunkSetFingerprint,
    expectedContentSha256: input.expectedContentSha256,
    expectedDocumentId: input.expectedDocumentId,
    expectedDraftId: input.expectedDraftId,
    expectedMetadata: input.expectedMetadata,
    expectedProcessingStatus: input.expectedProcessingStatus,
    expectedSourceFingerprint: input.expectedSourceFingerprint,
    expectedSourceId: input.expectedSourceId,
    marker: input.marker,
  });
  return marker ? { action, marker } : null;
}

type DocumentDataSourceSnapshot = {
  archivedAt: Date | string | null;
  createdAt: Date | string;
  demoNotice: string | null;
  id: string;
  isDemo: boolean;
  publishedOn: string | null;
  publisher: string | null;
  sourceType: (typeof sourceTypes)[number];
  title: string;
  updatedAt: Date | string;
  url: string | null;
  verifiedAt: Date | string;
};

const documentDataSourceFingerprintPayloadSchema = z
  .object({
    archivedAt: z.iso.datetime({ offset: true }).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    demoNotice: z.string().nullable(),
    id: z.uuid(),
    isDemo: z.boolean(),
    publishedOn: z.iso.date().nullable(),
    publisher: z.string().nullable(),
    sourceType: z.enum(sourceTypes),
    title: z.string(),
    updatedAt: z.iso.datetime({ offset: true }),
    url: z.string().nullable(),
    verifiedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export function createDocumentDataSourceFingerprintFromPayload(
  value: unknown,
): string {
  const parsed = documentDataSourceFingerprintPayloadSchema.parse(value);
  const payload = documentDataSourceFingerprintPayloadSchema.parse({
    ...parsed,
    archivedAt:
      parsed.archivedAt === null
        ? null
        : canonicalizePostgresTimestamp(parsed.archivedAt),
    createdAt: canonicalizePostgresTimestamp(parsed.createdAt),
    updatedAt: canonicalizePostgresTimestamp(parsed.updatedAt),
    verifiedAt: canonicalizePostgresTimestamp(parsed.verifiedAt),
  });
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function createDocumentDataSourceFingerprint(
  source: DocumentDataSourceSnapshot,
): string {
  const payload = documentDataSourceFingerprintPayloadSchema.parse({
    archivedAt:
      source.archivedAt === null
        ? null
        : canonicalizePostgresTimestamp(source.archivedAt),
    createdAt: canonicalizePostgresTimestamp(source.createdAt),
    demoNotice: source.demoNotice,
    id: source.id,
    isDemo: source.isDemo,
    publishedOn: source.publishedOn,
    publisher: source.publisher,
    sourceType: source.sourceType,
    title: source.title,
    updatedAt: canonicalizePostgresTimestamp(source.updatedAt),
    url: source.url,
    verifiedAt: canonicalizePostgresTimestamp(source.verifiedAt),
  });

  return createDocumentDataSourceFingerprintFromPayload(payload);
}
