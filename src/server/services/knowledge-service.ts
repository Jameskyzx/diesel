import "server-only";

import { z } from "zod";

import { compareCanonicalText } from "@/domain/canonical-order";

import {
  createDocumentProvenanceMarkerFingerprint,
  getDocumentProvenanceActionForVersion,
  parseDocumentDraftCreatedAuditMarkerFor,
  parseDocumentReprocessedAuditMarkerFor,
} from "@/features/admin/document-reprocessed-audit";
import {
  chunkStructuredText,
  KnowledgeChunkingError,
  type ExtractedChunk,
} from "@/domain/knowledge/chunk-document";
import {
  createLocalHashEmbedding,
  KNOWLEDGE_EMBEDDING_MODEL,
} from "@/domain/knowledge/embedding";
import {
  expectedKnowledgeHitWarnings,
  recomputeKnowledgeFinalScore,
  roundKnowledgeScore,
} from "@/domain/knowledge/search-consistency";
import { selectKnowledgeRankingCandidates } from "@/domain/knowledge/ranking-candidates";
import type { KnowledgeRankingOptions } from "@/domain/knowledge/delivery-query";
import { knowledgeQueryMayHaveConstraints } from "@/domain/knowledge/query-constraints";
import { env } from "@/env";
import {
  documentFileDescriptorSchema,
  documentImportMetadataSchema,
  documentImportResponseSchema,
  hybridSearchQuerySchema,
  hybridSearchResponseSchema,
  knowledgeDocumentSummarySchema,
  knowledgeOptionsResponseSchema,
  type DocumentImportMetadata,
  type DocumentImportResponse,
  type HybridSearchResponse,
  type KnowledgeDocumentSummary,
  type KnowledgeOptionsResponse,
} from "@/features/knowledge/schemas";
import { getDatabase } from "@/server/db/client";
import { getDemoDatabase } from "@/server/db/demo-client";
import { getDatabaseMode } from "@/server/db/environment";
import {
  DocumentProcessingError,
  extractUtf8Text,
  MAX_KNOWLEDGE_DOCUMENT_BYTES,
  sha256,
} from "@/server/knowledge/document-file";
import { getErrorCode } from "@/lib/api-error";
import {
  findOrphanedDocumentFiles,
  readDocumentFile,
  saveDocumentFile,
} from "@/server/knowledge/local-document-storage";
import {
  createKnowledgeRepository,
  type KnowledgeDocumentReprocessingAccessScope,
  type KnowledgeDocumentSummaryRow,
  type PreparedDocumentOutcome,
  type PreparedKnowledgeDocumentReprocessing,
  type PreparedKnowledgeDocumentUpload,
} from "@/server/repositories/knowledge-repository";
import {
  throwIfRequestAborted,
  type RequestSignalOptions,
} from "@/server/http/request-signal";

const knowledgeDocumentReprocessingAccessScopeSchema =
  z.discriminatedUnion("kind", [
    z
      .object({
        createdBy: z.email(),
        kind: z.literal("creator"),
      })
      .strict(),
    z
      .object({
        kind: z.literal("global"),
      })
      .strict(),
  ]);

export class KnowledgeInputError extends Error {
  constructor(
    readonly code: "EMPTY_FILE" | "FILE_TOO_LARGE",
    message: string,
  ) {
    super(message);
    this.name = "KnowledgeInputError";
  }
}

export class KnowledgeConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KnowledgeConflictError";
  }
}

function serializeDate(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function downloadUrl(
  documentId: string,
  storagePath: string | null,
): string | null {
  return storagePath
    ? `/api/dev/knowledge/documents/${documentId}/file`
    : null;
}

function toDocumentSummary(
  row: KnowledgeDocumentSummaryRow,
): KnowledgeDocumentSummary {
  const { storagePath, ...summary } = row;

  return knowledgeDocumentSummarySchema.parse({
    ...summary,
    createdAt: serializeDate(row.createdAt),
    downloadUrl: downloadUrl(row.id, storagePath),
    processedAt: serializeDate(row.processedAt),
  });
}

export function createKnowledgeDocumentImportResponse(input: {
  summary: KnowledgeDocumentSummaryRow;
  status: "duplicate" | "failed" | "ready";
}): DocumentImportResponse {
  return documentImportResponseSchema.parse({
    document: toDocumentSummary(input.summary),
    status: input.status,
  });
}

async function getKnowledgeRepository(options: RequestSignalOptions = {}) {
  throwIfRequestAborted(options.signal);
  if (getDatabaseMode() === "pglite-demo") {
    const database = await getDemoDatabase();
    throwIfRequestAborted(options.signal);
    return createKnowledgeRepository(database);
  }

  return createKnowledgeRepository(getDatabase());
}

function isExpectedProcessingError(
  error: unknown,
): error is DocumentProcessingError | KnowledgeChunkingError {
  return error instanceof DocumentProcessingError || error instanceof KnowledgeChunkingError;
}

function processingMessage(error: unknown): string {
  if (error instanceof KnowledgeChunkingError) {
    const messages = {
      HEADING_PATH_LIMIT: "文档标题路径超过 2048 个 UTF-16 单元的处理上限，请缩短标题或拆分文档。",
      CHUNK_COUNT_LIMIT: "文档超过 5000 个分块的处理上限，请拆分文档后重新导入。",
      GENERATED_TEXT_LIMIT: "文档分块及定位文本超过 16 Mi 个 UTF-16 单元的生成上限，请拆分文档后重新导入。",
    } as const;
    return messages[error.code];
  }
  if (error instanceof DocumentProcessingError) {
    return error.message;
  }

  return "文档处理失败；请查看服务端日志并核对 metadata。";
}

function createChunkRows(
  chunks: ExtractedChunk[],
  metadata: DocumentImportMetadata,
) {
  const verifiedAt = new Date();

  return chunks.map((chunk) => ({
    ...chunk,
    applicationScope: metadata.applicationScope,
    contentHash: sha256(chunk.content),
    countryIso3: metadata.countryIso3,
    embedding: createLocalHashEmbedding(chunk.content),
    embeddingModel: KNOWLEDGE_EMBEDDING_MODEL,
    isDemo: metadata.isDemo,
    jurisdictionId: metadata.jurisdictionId,
    validFrom: metadata.validFrom,
    validTo: metadata.validTo,
    verifiedAt,
  }));
}

function assertDocumentFileSize(bytes: Uint8Array): void {
  if (bytes.byteLength === 0) {
    throw new KnowledgeInputError("EMPTY_FILE", "上传文件不能为空。");
  }
  if (bytes.byteLength > MAX_KNOWLEDGE_DOCUMENT_BYTES) {
    throw new KnowledgeInputError(
      "FILE_TOO_LARGE",
      "上传文件不得超过 5 MiB。",
    );
  }
}

function prepareDocumentOutcome(input: {
  bytes: Uint8Array;
  fileName: string;
  metadata: DocumentImportMetadata;
  mimeType: string;
}): PreparedDocumentOutcome {
  try {
    const text = extractUtf8Text(input);
    const chunks = chunkStructuredText(input.metadata.title, text);

    if (chunks.length === 0) {
      throw new DocumentProcessingError(
        "EMPTY_TEXT",
        "文件没有可切分的正文段落。",
      );
    }

    return {
      chunks: createChunkRows(chunks, input.metadata),
      processingError: null,
      processingStatus: "ready",
    };
  } catch (error: unknown) {
    if (!isExpectedProcessingError(error)) {
      throw error;
    }
    return {
      chunks: [],
      processingError: processingMessage(error),
      processingStatus: "failed",
    };
  }
}

export async function prepareKnowledgeDocument(input: {
  bytes: Uint8Array;
  fileName: string;
  metadata: unknown;
  mimeType: string;
}): Promise<PreparedKnowledgeDocumentUpload> {
  assertDocumentFileSize(input.bytes);
  documentFileDescriptorSchema.parse({ fileName: input.fileName, mimeType: input.mimeType });
  const metadata = documentImportMetadataSchema.parse(input.metadata);
  const contentSha256 = sha256(input.bytes);
  const savedFile = await saveDocumentFile({
    bytes: input.bytes,
    contentSha256,
  });
  const mimeType = input.mimeType || "application/octet-stream";
  let outcome: PreparedDocumentOutcome;
  try {
    outcome = prepareDocumentOutcome({
      bytes: input.bytes,
      fileName: input.fileName,
      metadata,
      mimeType,
    });
  } catch (error: unknown) {
    if (savedFile.created) {
      console.warn("Knowledge document orphan cleanup deferred", {
        errorCode: getErrorCode(error),
      });
    }
    throw error;
  }

  return {
    byteSize: input.bytes.byteLength,
    contentSha256,
    metadata,
    mimeType,
    originalFilename: input.fileName,
    outcome,
    storageCreated: savedFile.created,
    storagePath: savedFile.storagePath,
  };
}

export async function prepareKnowledgeDocumentReprocessing(input: {
  accessScope: KnowledgeDocumentReprocessingAccessScope;
  documentId: string;
  metadata: unknown;
}): Promise<PreparedKnowledgeDocumentReprocessing> {
  const accessScope =
    knowledgeDocumentReprocessingAccessScopeSchema.parse(
      input.accessScope,
    );
  const metadataPatch = z
    .record(z.string(), z.unknown())
    .parse(input.metadata);
  const repository = await getKnowledgeRepository();
  const document = await repository.findDocumentForReprocessing({
    accessScope,
    documentId: input.documentId,
  });

  if (!document?.storagePath || !document.activeDraft) {
    throw new KnowledgeInputError(
      "EMPTY_FILE",
      "文档不存在、已归档或没有可重新处理的原文件。",
    );
  }
  if (
    accessScope.kind === "creator" &&
    document.activeDraft.createdBy !== accessScope.createdBy
  ) {
    throw new KnowledgeInputError(
      "EMPTY_FILE",
      "文档不存在、已归档或没有可重新处理的原文件。",
    );
  }
  if (document.sourceArchivedAt !== null) {
    throw new KnowledgeConflictError(
      "文档当前证据来源已归档，不能原地重新处理。",
    );
  }
  if (
    document.governanceStatus !== "draft" ||
    (document.processingStatus !== "ready" &&
      document.processingStatus !== "failed")
  ) {
    throw new KnowledgeConflictError(
      "只有 ready/failed 的 Draft 文档可以重新处理；已审核、已发布或正在处理的文档必须创建新版本或等待当前操作完成。",
    );
  }
  if (!document.chunkSetFingerprint) {
    throw new KnowledgeConflictError(
      "文档 chunk provenance 缺失或不一致，不能重新处理。",
    );
  }
  const provenanceAction = getDocumentProvenanceActionForVersion(
    document.activeDraft.version,
  );
  const provenanceAudits = document.auditMarkers.filter(
    (marker) => marker.action === provenanceAction,
  );
  let governanceMetadata: DocumentImportMetadata;
  let provenanceAuditId: string;
  let provenanceMarkerFingerprint: string;
  if (provenanceAction === "document_reprocessed") {
    if (provenanceAudits.length !== 1) {
      throw new KnowledgeConflictError(
        "文档当前草稿存在重复的重新处理审计，metadata provenance 无法唯一确定。",
      );
    }
    const audit = provenanceAudits[0]!;
    const marker = parseDocumentReprocessedAuditMarkerFor({
      expectedChunkSetFingerprint: document.chunkSetFingerprint,
      expectedContentSha256: document.contentSha256,
      expectedDocumentId: input.documentId,
      expectedDraftId: document.activeDraft.id,
      expectedProcessingStatus: document.processingStatus,
      expectedSourceFingerprint: document.sourceFingerprint,
      expectedSourceId: document.dataSourceId,
      marker: {
        afterData: audit.afterData,
        draftId: audit.draftId,
        entityKey: audit.entityKey,
        entityType: audit.entityType,
      },
    });
    if (!marker) {
      throw new KnowledgeConflictError(
        "文档重新处理审计已损坏或与当前文档、草稿、来源不一致。",
      );
    }
    governanceMetadata = marker.afterData.metadata;
    provenanceAuditId = audit.id;
    provenanceMarkerFingerprint =
      createDocumentProvenanceMarkerFingerprint(marker);
  } else {
    if (provenanceAudits.length !== 1) {
      throw new KnowledgeConflictError(
        "文档创建审计缺失或不唯一，metadata provenance 无法验证。",
      );
    }
    const audit = provenanceAudits[0]!;
    const marker = parseDocumentDraftCreatedAuditMarkerFor({
      expectedChunkSetFingerprint: document.chunkSetFingerprint,
      expectedContentSha256: document.contentSha256,
      expectedDocumentId: input.documentId,
      expectedDraftId: document.activeDraft.id,
      expectedProcessingStatus: document.processingStatus,
      expectedSourceFingerprint: document.sourceFingerprint,
      expectedSourceId: document.dataSourceId,
      marker: {
        afterData: audit.afterData,
        draftId: audit.draftId,
        entityKey: audit.entityKey,
        entityType: audit.entityType,
      },
    });
    if (!marker) {
      throw new KnowledgeConflictError(
        "文档创建审计已损坏或与当前文档、草稿、来源不一致。",
      );
    }
    governanceMetadata = marker.afterData.metadata;
    provenanceAuditId = audit.id;
    provenanceMarkerFingerprint =
      createDocumentProvenanceMarkerFingerprint(marker);
  }
  const metadata = documentImportMetadataSchema.parse({
    applicationScope:
      document.applicationScope ?? governanceMetadata.applicationScope,
    canonicalUrl: document.canonicalUrl,
    countryIso3:
      document.countryIso3 ?? governanceMetadata.countryIso3,
    demoNotice: document.demoNotice,
    documentType: document.documentType,
    isDemo: document.isDemo,
    jurisdictionId:
      document.jurisdictionId ?? governanceMetadata.jurisdictionId,
    languageCode: document.languageCode,
    licenseCode: document.licenseCode,
    publishedOn: document.publishedOn,
    redistributionAllowed: document.redistributionAllowed,
    sourcePublisher: document.sourcePublisher,
    sourceTitle: document.sourceTitle,
    sourceType: document.sourceType,
    sourceUrl: document.sourceUrl,
    title: document.title,
    validFrom: document.validFrom,
    validTo: document.validTo,
    ...metadataPatch,
  });

  let bytes: Uint8Array;
  try {
    bytes = await readDocumentFile(document.storagePath);
  } catch (error: unknown) {
    console.error("Knowledge document reprocessing file read failed", {
      errorCode: getErrorCode(error),
    });
    throw new KnowledgeInputError(
      "EMPTY_FILE",
      "文档原文件不可读，未修改现有文档。",
    );
  }
  if (sha256(bytes) !== document.contentSha256) {
    throw new KnowledgeInputError(
      "EMPTY_FILE",
      "文档原文件内容哈希与登记值不一致，未修改现有文档。",
    );
  }
  const outcome = prepareDocumentOutcome({
    bytes,
    fileName: document.originalFilename ?? "document.txt",
    metadata,
    mimeType: document.mimeType ?? "application/octet-stream",
  });
  if (
    document.processingStatus === "ready" &&
    outcome.processingStatus === "failed"
  ) {
    throw new KnowledgeInputError(
      "EMPTY_FILE",
      `${outcome.processingError}；未修改现有 ready 文档。`,
    );
  }
  const operationFingerprint = sha256(
    JSON.stringify({
      contentSha256: document.contentSha256,
      metadata,
      outcome: {
        chunkHashes: outcome.chunks.map((chunk) => chunk.contentHash),
        processingError: outcome.processingError,
        processingStatus: outcome.processingStatus,
      },
    }),
  );

  return {
    documentId: input.documentId,
    expected: {
      activeDraftCreatedBy: document.activeDraft.createdBy,
      activeDraftId: document.activeDraft.id,
      chunkSetFingerprint: document.chunkSetFingerprint,
      contentSha256: document.contentSha256,
      dataSourceId: document.dataSourceId,
      processingStatus: document.processingStatus,
      provenanceAuditId,
      provenanceMarkerFingerprint,
      provenanceMetadata: governanceMetadata,
      sourceFingerprint: document.sourceFingerprint,
    },
    metadata,
    operationFingerprint,
    outcome,
  };
}

export function isKnowledgeDebugEnabled(): boolean {
  return env.NODE_ENV !== "production";
}

export function parseDocumentImportFormData(
  formData: FormData,
): DocumentImportMetadata {
  const stringValue = (name: string): string | null => {
    const value = formData.get(name);
    return typeof value === "string" && value.trim() ? value.trim() : null;
  };
  const booleanValue = (name: string): boolean | null | string => {
    const value = stringValue(name);
    if (value === null) {
      return null;
    }
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }
    return value;
  };

  return documentImportMetadataSchema.parse({
    applicationScope: stringValue("applicationScope"),
    canonicalUrl: stringValue("canonicalUrl"),
    countryIso3: stringValue("countryIso3"),
    demoNotice: stringValue("demoNotice"),
    documentType: stringValue("documentType"),
    isDemo: booleanValue("isDemo") ?? false,
    jurisdictionId: stringValue("jurisdictionId"),
    languageCode: stringValue("languageCode"),
    licenseCode: stringValue("licenseCode"),
    publishedOn: stringValue("publishedOn"),
    redistributionAllowed: booleanValue("redistributionAllowed"),
    sourcePublisher: stringValue("sourcePublisher"),
    sourceTitle: stringValue("sourceTitle"),
    sourceType: stringValue("sourceType"),
    sourceUrl: stringValue("sourceUrl"),
    title: stringValue("title"),
    validFrom: stringValue("validFrom"),
    validTo: stringValue("validTo"),
  });
}

export function parseDocumentReprocessFormData(
  formData: FormData,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const stringFields = [
    "applicationScope",
    "canonicalUrl",
    "countryIso3",
    "demoNotice",
    "documentType",
    "jurisdictionId",
    "languageCode",
    "licenseCode",
    "publishedOn",
    "sourcePublisher",
    "sourceTitle",
    "sourceType",
    "sourceUrl",
    "title",
    "validFrom",
    "validTo",
  ] as const;

  for (const field of stringFields) {
    if (!formData.has(field)) continue;
    const value = formData.get(field);
    patch[field] =
      typeof value === "string" && value.trim() ? value.trim() : null;
  }
  for (const field of ["isDemo", "redistributionAllowed"] as const) {
    if (!formData.has(field)) continue;
    const value = formData.get(field);
    patch[field] =
      typeof value === "string" && value.trim()
        ? value.trim() === "true"
          ? true
          : value.trim() === "false"
            ? false
            : value.trim()
        : null;
  }

  return patch;
}

export async function importKnowledgeDocument(input: {
  bytes: Uint8Array;
  fileName: string;
  governanceStatus: "draft" | "published";
  metadata: unknown;
  mimeType: string;
}): Promise<DocumentImportResponse> {
  if (input.bytes.byteLength === 0) {
    throw new KnowledgeInputError("EMPTY_FILE", "上传文件不能为空。");
  }
  if (input.bytes.byteLength > MAX_KNOWLEDGE_DOCUMENT_BYTES) {
    throw new KnowledgeInputError(
      "FILE_TOO_LARGE",
      "上传文件不得超过 5 MiB。",
    );
  }

  documentFileDescriptorSchema.parse({ fileName: input.fileName, mimeType: input.mimeType });
  const metadata = documentImportMetadataSchema.parse(input.metadata);
  const repository = await getKnowledgeRepository();
  const contentSha256 = sha256(input.bytes);
  const existing = await repository.findByHash(contentSha256);

  if (existing) {
    const summary = await repository.getDocumentSummary(existing.id);
    if (!summary) {
      throw new Error("Duplicate document summary could not be loaded.");
    }
    return documentImportResponseSchema.parse({
      document: toDocumentSummary(summary),
      status: "duplicate",
    });
  }

  const savedFile = await saveDocumentFile({
    bytes: input.bytes,
    contentSha256,
  });
  let creation;
  try {
    creation = await repository.createProcessingDocument({
      byteSize: input.bytes.byteLength,
      contentSha256,
      metadata,
      mimeType: input.mimeType || "application/octet-stream",
      originalFilename: input.fileName,
      storagePath: savedFile.storagePath,
    });
  } catch (error: unknown) {
    if (savedFile.created) {
      // Do not remove immediately: another same-hash request may have reused
      // this file and still be between its filesystem write and DB commit.
      // The age-gated orphan scanner reclaims it only after all such requests
      // have had time to commit and the repository reference set is complete.
      console.warn("Knowledge document orphan cleanup deferred", {
        errorCode: getErrorCode(error),
      });
    }
    throw error;
  }
  if (!creation.created) {
    const summary = await repository.getDocumentSummary(
      creation.documentId,
    );
    if (!summary) {
      throw new Error("Concurrent duplicate document summary was not found.");
    }
    return documentImportResponseSchema.parse({
      document: toDocumentSummary(summary),
      status: "duplicate",
    });
  }
  const documentId = creation.documentId;

  try {
    const text = extractUtf8Text({
      bytes: input.bytes,
      fileName: input.fileName,
      mimeType: input.mimeType || "application/octet-stream",
    });
    const chunks = chunkStructuredText(metadata.title, text);

    if (chunks.length === 0) {
      throw new DocumentProcessingError(
        "EMPTY_TEXT",
        "文件没有可切分的正文段落。",
      );
    }

    await repository.completeDocument(
      documentId,
      createChunkRows(chunks, metadata),
      input.governanceStatus,
    );
  } catch (error: unknown) {
    const message = processingMessage(error);
    await repository.markDocumentFailed(documentId, message);

    if (!isExpectedProcessingError(error)) {
      console.error("Knowledge document processing failed", {
        errorCode: getErrorCode(error),
      });
    }

    const failed = await repository.getDocumentSummary(documentId);
    if (!failed) {
      throw new Error("Failed document summary could not be loaded.");
    }

    return documentImportResponseSchema.parse({
      document: toDocumentSummary(failed),
      status: "failed",
    });
  }

  const ready = await repository.getDocumentSummary(documentId);
  if (!ready) {
    throw new Error("Ready document summary could not be loaded.");
  }

  return documentImportResponseSchema.parse({
    document: toDocumentSummary(ready),
    status: "ready",
  });
}

export async function findKnowledgeStorageOrphans(input?: {
  minimumAgeMs?: number;
}): Promise<string[]> {
  const repository = await getKnowledgeRepository();
  const referencedStoragePaths = new Set(
    (await repository.listDocumentStoragePaths()).flatMap(
      ({ storagePath }) => (storagePath ? [storagePath] : []),
    ),
  );

  return findOrphanedDocumentFiles({
    minimumAgeMs: input?.minimumAgeMs ?? 24 * 60 * 60 * 1000,
    referencedStoragePaths,
  });
}

export async function getKnowledgeOptions(): Promise<KnowledgeOptionsResponse> {
  const repository = await getKnowledgeRepository();
  const [options, documentRows] = await Promise.all([
    repository.listFilterOptions(),
    repository.listDocuments(),
  ]);

  return knowledgeOptionsResponseSchema.parse({
    ...options,
    documents: documentRows.map(toDocumentSummary),
    status: "ok",
  });
}

const knowledgeQueryComparisonSchema = z.object({
  expected: hybridSearchQuerySchema.shape.query,
  actual: hybridSearchQuerySchema.shape.query,
}).strict();

export async function knowledgeQueryConstraintsMatch(input: unknown, options: RequestSignalOptions = {}): Promise<boolean> {
  throwIfRequestAborted(options.signal);
  const { expected, actual } = knowledgeQueryComparisonSchema.parse(input);
  if (expected === actual || (!knowledgeQueryMayHaveConstraints(expected) && !knowledgeQueryMayHaveConstraints(actual))) return true;
  const repository = await getKnowledgeRepository(options);
  throwIfRequestAborted(options.signal);
  const matches = await repository.knowledgeQueryConstraintsMatch(expected, actual, options);
  throwIfRequestAborted(options.signal);
  return matches;
}

export async function hybridSearchKnowledge(
  input: unknown,
  options: RequestSignalOptions & KnowledgeRankingOptions = {},
): Promise<HybridSearchResponse> {
  throwIfRequestAborted(options.signal);
  const query = hybridSearchQuerySchema.parse(input);
  const repository = await getKnowledgeRepository(options);
  throwIfRequestAborted(options.signal);
  const queryEmbedding = createLocalHashEmbedding(query.query);
  throwIfRequestAborted(options.signal);
  const candidates = await repository.searchCandidates(
    query,
    queryEmbedding,
    options,
  );
  throwIfRequestAborted(options.signal);

  const ranked = selectKnowledgeRankingCandidates(candidates
    .map((candidate) => {
      const keywordScore = Math.max(Number(candidate.keywordScore), 0);
      const vectorScore = Math.max(
        0,
        Math.min(1, 1 - Number(candidate.vectorDistance)),
      );
      const normalizedKeyword =
        keywordScore === 0 ? 0 : keywordScore / (keywordScore + 0.1);
      const publicKeywordScore = roundKnowledgeScore(normalizedKeyword);
      const publicVectorScore = roundKnowledgeScore(vectorScore);
      const finalScore = recomputeKnowledgeFinalScore({
        keywordScore: publicKeywordScore,
        keywordWeight: 0.5,
        vectorScore: publicVectorScore,
        vectorWeight: 0.5,
      });
      const warnings = expectedKnowledgeHitWarnings(candidate);

      return {
        candidate,
        finalScore,
        keywordScore: publicKeywordScore,
        vectorScore: publicVectorScore,
        warnings,
      };
    }))
    .sort(
      (left, right) =>
        right.finalScore - left.finalScore ||
        compareCanonicalText(left.candidate.chunkId, right.candidate.chunkId),
    )
    .slice(0, query.limit);

  throwIfRequestAborted(options.signal);
  return hybridSearchResponseSchema.parse({
    embeddingModel: KNOWLEDGE_EMBEDDING_MODEL,
    filters: {
      applicationScope: query.applicationScope,
      asOf: query.asOf,
      countryIso3: query.countryIso3,
      jurisdictionId: query.jurisdictionId,
      limit: query.limit,
    },
    query: query.query,
    results: ranked.map((item, index) => ({
      applicationScope: item.candidate.applicationScope,
      chunkId: item.candidate.chunkId,
      content: item.candidate.content,
      countryIso3: item.candidate.countryIso3,
      document: {
        downloadUrl: downloadUrl(
          item.candidate.documentId,
          item.candidate.storagePath,
        ),
        id: item.candidate.documentId,
        originalFilename: item.candidate.originalFilename,
        publishedOn: item.candidate.documentPublishedOn,
        source: {
          id: item.candidate.sourceId,
          isDemo: item.candidate.isDemo,
          publishedOn: item.candidate.sourcePublishedOn,
          publisher: item.candidate.publisher,
          title: item.candidate.sourceTitle,
          url: item.candidate.sourceUrl,
          verifiedAt: item.candidate.sourceVerifiedAt.toISOString(),
        },
        title: item.candidate.documentTitle,
      },
      finalScore: item.finalScore,
      headingPath: item.candidate.headingPath,
      jurisdiction:
        item.candidate.jurisdictionId && item.candidate.jurisdictionName
          ? {
              id: item.candidate.jurisdictionId,
              name: item.candidate.jurisdictionName,
            }
          : null,
      keywordScore: item.keywordScore,
      pageFrom: item.candidate.pageFrom,
      pageTo: item.candidate.pageTo,
      rank: index + 1,
      sectionLocator: item.candidate.sectionLocator,
      validFrom: item.candidate.validFrom,
      validTo: item.candidate.validTo,
      vectorScore: item.vectorScore,
      warnings: item.warnings,
    })),
    scoring: {
      keywordWeight: 0.5,
      vectorWeight: 0.5,
    },
    status: "ok",
  });
}

export async function getKnowledgeDocumentFile(input: {
  documentId: string;
}) {
  const repository = await getKnowledgeRepository();
  const document = await repository.findDocumentForDownload(input.documentId);

  if (!document?.storagePath) {
    return null;
  }

  const bytes = await readDocumentFile(document.storagePath);
  if (sha256(bytes) !== document.contentSha256) {
    throw new Error("The original document does not match its registered content hash.");
  }

  return {
    bytes,
    fileName: document.originalFilename ?? "document.txt",
    mimeType: document.mimeType ?? "application/octet-stream",
  };
}
