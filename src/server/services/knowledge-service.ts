import "server-only";

import {
  chunkStructuredText,
  type ExtractedChunk,
} from "@/domain/knowledge/chunk-document";
import {
  createLocalHashEmbedding,
  KNOWLEDGE_EMBEDDING_MODEL,
} from "@/domain/knowledge/embedding";
import { isKnowledgeResultRelevant } from "@/domain/knowledge/retrieval-policy";
import { env } from "@/env";
import {
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
  sha256,
} from "@/server/knowledge/document-file";
import { getErrorCode } from "@/lib/api-error";
import {
  findOrphanedDocumentFiles,
  readDocumentFile,
  saveDocumentFile,
} from "@/server/knowledge/local-document-storage";
import { createKnowledgeRepository } from "@/server/repositories/knowledge-repository";

const maximumFileBytes = 5 * 1024 * 1024;

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

function toDocumentSummary(row: {
  byteSize: number | null;
  chunkCount: number;
  contentSha256: string;
  createdAt: Date;
  governanceStatus: "draft" | "reviewed" | "published";
  id: string;
  isDemo: boolean;
  mimeType: string | null;
  originalFilename: string | null;
  processedAt: Date | null;
  processingError: string | null;
  processingStatus: "pending" | "processing" | "ready" | "failed";
  sourceTitle: string;
  storagePath: string | null;
  title: string;
  type:
    | "regulation-text"
    | "government-notice"
    | "product-manual"
    | "industry-report"
    | "certificate"
    | "other";
}): KnowledgeDocumentSummary {
  const { storagePath, ...summary } = row;

  return knowledgeDocumentSummarySchema.parse({
    ...summary,
    createdAt: serializeDate(row.createdAt),
    downloadUrl: downloadUrl(row.id, storagePath),
    processedAt: serializeDate(row.processedAt),
  });
}

async function getKnowledgeRepository() {
  if (getDatabaseMode() === "pglite-demo") {
    return createKnowledgeRepository(await getDemoDatabase());
  }

  return createKnowledgeRepository(getDatabase());
}

function processingMessage(error: unknown): string {
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
  if (input.bytes.byteLength > maximumFileBytes) {
    throw new KnowledgeInputError(
      "FILE_TOO_LARGE",
      "上传文件不得超过 5 MiB。",
    );
  }

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

    if (!(error instanceof DocumentProcessingError)) {
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

export async function reprocessKnowledgeDocument(input: {
  documentId: string;
  metadata: unknown;
}) {
  const metadata = documentImportMetadataSchema.parse(input.metadata);
  const repository = await getKnowledgeRepository();
  const document = await repository.findDocumentForReprocessing(
    input.documentId,
  );

  if (!document?.storagePath) {
    throw new KnowledgeInputError(
      "EMPTY_FILE",
      "文档不存在、已归档或没有可重新处理的原文件。",
    );
  }
  const reprocessing = await repository.beginDocumentReprocessing(
    input.documentId,
    metadata,
  );
  if (!reprocessing) {
    throw new KnowledgeConflictError(
      "只有 ready/failed 的 Draft 文档可以重新处理；已审核、已发布或正在处理的文档必须创建新版本或等待当前操作完成。",
    );
  }

  try {
    const bytes = await readDocumentFile(document.storagePath);
    const text = extractUtf8Text({
      bytes,
      fileName: document.originalFilename ?? "document.txt",
      mimeType: document.mimeType ?? "application/octet-stream",
    });
    const chunks = chunkStructuredText(metadata.title, text);

    if (chunks.length === 0) {
      throw new DocumentProcessingError(
        "EMPTY_TEXT",
        "文件没有可切分的正文段落。",
      );
    }

    await repository.completeDocument(
      input.documentId,
      createChunkRows(chunks, metadata),
      "draft",
    );
  } catch (error: unknown) {
    const message = processingMessage(error);
    await repository.markDocumentFailed(input.documentId, message);

    if (!(error instanceof DocumentProcessingError)) {
      console.error("Knowledge document reprocessing failed", {
        errorCode: getErrorCode(error),
      });
    }
  }

  const summary = await repository.getDocumentSummary(input.documentId);
  if (!summary) {
    throw new Error("Reprocessed document summary could not be loaded.");
  }

  const response = documentImportResponseSchema.parse({
    document: toDocumentSummary(summary),
    status:
      summary.processingStatus === "ready" ? "ready" : "failed",
  });

  return {
    afterData: {
      metadata,
      processingStatus: response.document.processingStatus,
      sourceId: reprocessing.sourceId,
      status: response.status,
    },
    beforeData: reprocessing.beforeData,
    response,
  };
}

function roundScore(value: number): number {
  return Number(value.toFixed(6));
}

export async function hybridSearchKnowledge(
  input: unknown,
): Promise<HybridSearchResponse> {
  const query = hybridSearchQuerySchema.parse(input);
  const repository = await getKnowledgeRepository();
  const candidates = await repository.searchCandidates(
    query,
    createLocalHashEmbedding(query.query),
  );

  const ranked = candidates
    .map((candidate) => {
      const keywordScore = Math.max(Number(candidate.keywordScore), 0);
      const vectorScore = Math.max(
        0,
        Math.min(1, 1 - Number(candidate.vectorDistance)),
      );
      const normalizedKeyword =
        keywordScore === 0 ? 0 : keywordScore / (keywordScore + 0.1);
      const finalScore = normalizedKeyword * 0.5 + vectorScore * 0.5;
      const warnings: string[] = [];

      if (candidate.validFrom === null) {
        warnings.push("该片段未记录 validFrom，日期适用性仍需人工核验。");
      }
      if (candidate.countryIso3 === null) {
        warnings.push("该片段未记录国家 metadata。");
      }
      if (candidate.applicationScope === null) {
        warnings.push("该片段未记录应用场景 metadata。");
      }

      return {
        candidate,
        finalScore,
        keywordScore,
        vectorScore,
        warnings,
      };
    })
    .filter((candidate) => isKnowledgeResultRelevant(candidate))
    .sort(
      (left, right) =>
        right.finalScore - left.finalScore ||
        left.candidate.chunkId.localeCompare(right.candidate.chunkId),
    )
    .slice(0, query.limit);

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
      finalScore: roundScore(item.finalScore),
      headingPath: item.candidate.headingPath,
      jurisdiction:
        item.candidate.jurisdictionId && item.candidate.jurisdictionName
          ? {
              id: item.candidate.jurisdictionId,
              name: item.candidate.jurisdictionName,
            }
          : null,
      keywordScore: roundScore(item.keywordScore),
      pageFrom: item.candidate.pageFrom,
      pageTo: item.candidate.pageTo,
      rank: index + 1,
      sectionLocator: item.candidate.sectionLocator,
      validFrom: item.candidate.validFrom,
      validTo: item.candidate.validTo,
      vectorScore: roundScore(item.vectorScore),
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

  return {
    bytes: await readDocumentFile(document.storagePath),
    fileName: document.originalFilename ?? "document.txt",
    mimeType: document.mimeType ?? "application/octet-stream",
  };
}
