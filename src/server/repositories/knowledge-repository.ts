import {
  and,
  asc,
  cosineDistance,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import {
  createDocumentChunkSetFingerprint,
  createDocumentDataSourceFingerprint,
} from "@/features/admin/document-reprocessed-audit";
import type {
  DocumentImportMetadata,
  HybridSearchQuery,
} from "@/features/knowledge/schemas";
import * as schema from "@/server/db/schema";
import {
  countries,
  dataChangeLogs,
  dataGovernanceDrafts,
  dataSources,
  documentChunks,
  documents,
  jurisdictions,
} from "@/server/db/schema";
import { assertGovernanceWriteAllowed } from "@/server/db/governance-maintenance-lock";
import { documentChunkInsertBatches } from "@/server/repositories/document-chunk-batches";
import { resolveKnowledgeCandidateConstraint, resolveKnowledgeConstraintKey, resolveKnowledgeTextQuery } from "@/server/repositories/knowledge-text-query";
import { projectKnowledgeRankingQuery, type KnowledgeRankingOptions } from "@/domain/knowledge/delivery-query";
import { createLocalHashEmbedding } from "@/domain/knowledge/embedding";
import {
  throwIfRequestAborted,
  type RequestSignalOptions,
} from "@/server/http/request-signal";

export type ChunkInsert = {
  applicationScope: DocumentImportMetadata["applicationScope"];
  chunkIndex: number;
  content: string;
  contentHash: string;
  countryIso3: string | null;
  embedding: number[];
  embeddingModel: string;
  headingPath: string[];
  isDemo: boolean;
  jurisdictionId: string | null;
  pageFrom: number;
  pageTo: number;
  sectionLocator: string;
  tokenCount: number;
  validFrom: string | null;
  validTo: string | null;
  verifiedAt: Date;
};

export type PreparedDocumentOutcome =
  | {
      chunks: ChunkInsert[];
      processingError: null;
      processingStatus: "ready";
    }
  | {
      chunks: [];
      processingError: string;
      processingStatus: "failed";
    };

export type PreparedKnowledgeDocumentUpload = {
  byteSize: number;
  contentSha256: string;
  metadata: DocumentImportMetadata;
  mimeType: string;
  originalFilename: string;
  outcome: PreparedDocumentOutcome;
  storageCreated: boolean;
  storagePath: string;
};

export type KnowledgeDocumentReprocessingAccessScope =
  | {
      createdBy: string;
      kind: "creator";
    }
  | {
      kind: "global";
    };

export type PreparedKnowledgeDocumentReprocessing = {
  documentId: string;
  expected: {
    activeDraftCreatedBy: string;
    activeDraftId: string;
    chunkSetFingerprint: string;
    contentSha256: string;
    dataSourceId: string;
    processingStatus: "failed" | "ready";
    provenanceAuditId: string;
    provenanceMarkerFingerprint: string;
    provenanceMetadata: DocumentImportMetadata;
    sourceFingerprint: string;
  };
  metadata: DocumentImportMetadata;
  operationFingerprint: string;
  outcome: PreparedDocumentOutcome;
};

export type KnowledgeDocumentSummaryRow = {
  byteSize: number | null;
  chunkCount: number;
  contentSha256: string;
  createdAt: Date;
  governanceStatus: "draft" | "published" | "reviewed";
  id: string;
  isDemo: boolean;
  mimeType: string | null;
  originalFilename: string | null;
  processedAt: Date | null;
  processingError: string | null;
  processingStatus: "failed" | "pending" | "processing" | "ready";
  sourceTitle: string;
  storagePath: string | null;
  title: string;
  type:
    | "certificate"
    | "government-notice"
    | "industry-report"
    | "other"
    | "product-manual"
    | "regulation-text";
};

function nullableString(value: string | null): string | null {
  return value ? value : null;
}

export function createKnowledgeRepository<
  TQueryResult extends PgQueryResultHKT,
>(database: PgDatabase<TQueryResult, typeof schema>) {
  const parseNativeConstraints = (queries: readonly string[]) => database.select({
    index: sql<number>`(ordinality - 1)::integer`,
    query: sql<string>`websearch_to_tsquery('simple', value)::text`,
  }).from(sql`jsonb_array_elements_text(${JSON.stringify(queries)}::jsonb) with ordinality as native_query_constraints(value, ordinality)`)
    .orderBy(sql`ordinality`);

  async function getDocumentSummary(documentId: string) {
    const rows = await database
      .select({
        byteSize: documents.byteSize,
        chunkCount: sql<number>`(
          select count(*)::int
          from ${documentChunks}
          where ${documentChunks.documentId} = ${documents.id}
        )`,
        contentSha256: documents.contentSha256,
        createdAt: documents.createdAt,
        governanceStatus: documents.governanceStatus,
        id: documents.id,
        isDemo: documents.isDemo,
        mimeType: documents.mimeType,
        originalFilename: documents.originalFilename,
        processedAt: documents.processedAt,
        processingError: documents.processingError,
        processingStatus: documents.processingStatus,
        sourceTitle: dataSources.title,
        storagePath: documents.storagePath,
        title: documents.title,
        type: documents.type,
      })
      .from(documents)
      .innerJoin(dataSources, eq(documents.dataSourceId, dataSources.id))
      .where(eq(documents.id, documentId))
      .limit(1);

    return rows[0] ?? null;
  }

  return {
    async knowledgeQueryConstraintsMatch(expected: string, actual: string, options: RequestSignalOptions = {}) {
      const readCanonical = (expression: SQL) => database.select({ query: sql<string>`(${expression})::text` })
        .from(sql`(values (1)) as knowledge_constraint_key(value)`);
      const expectedKey = await resolveKnowledgeConstraintKey(expected, parseNativeConstraints, readCanonical, options);
      const actualKey = await resolveKnowledgeConstraintKey(actual, parseNativeConstraints, readCanonical, options);
      return expectedKey === actualKey;
    },
    async completeDocument(
      documentId: string,
      chunks: ChunkInsert[],
      governanceStatus: "draft" | "published",
    ) {
      await database.transaction(async (transaction) => {
        await assertGovernanceWriteAllowed(transaction);
        const now = new Date();
        const [document] = await transaction
          .select({
            governanceStatus: documents.governanceStatus,
            isDemo: documents.isDemo,
            processingStatus: documents.processingStatus,
            sourceIsDemo: dataSources.isDemo,
          })
          .from(documents)
          .innerJoin(dataSources, eq(documents.dataSourceId, dataSources.id))
          .where(
            and(
              eq(documents.id, documentId),
              isNull(documents.archivedAt),
              isNull(dataSources.archivedAt),
            ),
          )
          .limit(1)
          .for("update");
        if (!document) {
          throw new Error(
            "The document or its evidence source is missing or archived.",
          );
        }
        if (
          document.governanceStatus !== "draft" ||
          document.processingStatus !== "processing"
        ) {
          throw new Error(
            "Only a draft processing document can be completed.",
          );
        }

        if (governanceStatus === "published") {
          if (!document.isDemo && document.sourceIsDemo) {
            throw new Error(
              "A non-demo document cannot use a demo evidence source.",
            );
          }

          const countryReferences = chunks.flatMap((chunk) =>
            chunk.countryIso3
              ? [
                  {
                    childIsDemo: document.isDemo || chunk.isDemo,
                    id: chunk.countryIso3,
                  },
                ]
              : [],
          );
          const countryIds = Array.from(
            new Set(countryReferences.map(({ id }) => id)),
          );
          if (countryIds.length > 0) {
            const activeCountries = await transaction
              .select({
                id: countries.iso3,
                isDemo: countries.isDemo,
                sourceIsDemo: dataSources.isDemo,
              })
              .from(countries)
              .innerJoin(
                dataSources,
                eq(countries.dataSourceId, dataSources.id),
              )
              .where(
                and(
                  inArray(countries.iso3, countryIds),
                  isNull(countries.archivedAt),
                  isNull(dataSources.archivedAt),
                ),
              )
              .for("update");
            const countryById = new Map(
              activeCountries.map((country) => [country.id, country]),
            );
            if (countryById.size !== countryIds.length) {
              throw new Error(
                "A referenced country or its evidence source is missing or archived.",
              );
            }
            if (
              countryReferences.some(({ childIsDemo, id }) => {
                const country = countryById.get(id);
                return (
                  !childIsDemo &&
                  (country?.isDemo === true || country?.sourceIsDemo === true)
                );
              })
            ) {
              throw new Error(
                "A non-demo document chunk cannot reference a demo country.",
              );
            }
          }

          const jurisdictionReferences = chunks.flatMap((chunk) =>
            chunk.jurisdictionId
              ? [
                  {
                    childIsDemo: document.isDemo || chunk.isDemo,
                    id: chunk.jurisdictionId,
                  },
                ]
              : [],
          );
          const jurisdictionIds = Array.from(
            new Set(jurisdictionReferences.map(({ id }) => id)),
          );
          if (jurisdictionIds.length > 0) {
            const activeJurisdictions = await transaction
              .select({
                id: jurisdictions.id,
                isDemo: jurisdictions.isDemo,
                sourceIsDemo: dataSources.isDemo,
              })
              .from(jurisdictions)
              .innerJoin(
                dataSources,
                eq(jurisdictions.dataSourceId, dataSources.id),
              )
              .where(
                and(
                  inArray(jurisdictions.id, jurisdictionIds),
                  isNull(jurisdictions.archivedAt),
                  isNull(dataSources.archivedAt),
                ),
              )
              .for("update");
            const jurisdictionById = new Map(
              activeJurisdictions.map((jurisdiction) => [
                jurisdiction.id,
                jurisdiction,
              ]),
            );
            if (jurisdictionById.size !== jurisdictionIds.length) {
              throw new Error(
                "A referenced jurisdiction or its evidence source is missing or archived.",
              );
            }
            if (
              jurisdictionReferences.some(({ childIsDemo, id }) => {
                const jurisdiction = jurisdictionById.get(id);
                return (
                  !childIsDemo &&
                  (jurisdiction?.isDemo === true ||
                    jurisdiction?.sourceIsDemo === true)
                );
              })
            ) {
              throw new Error(
                "A non-demo document chunk cannot reference a demo jurisdiction.",
              );
            }
          }
        }

        await transaction
          .delete(documentChunks)
          .where(eq(documentChunks.documentId, documentId));
        for (const batch of documentChunkInsertBatches(documentId, chunks)) {
          await transaction.insert(documentChunks).values(batch);
        }
        await transaction
          .update(documents)
          .set({
            governancePublishedAt:
              governanceStatus === "published" ? now : null,
            governanceStatus,
            processedAt: now,
            processingError: null,
            processingStatus: "ready",
            updatedAt: now,
          })
          .where(eq(documents.id, documentId));
      });
    },
    async createProcessingDocument(input: {
      byteSize: number;
      contentSha256: string;
      metadata: DocumentImportMetadata;
      mimeType: string;
      originalFilename: string;
      storagePath: string;
    }) {
      return database.transaction(async (transaction) => {
        await assertGovernanceWriteAllowed(transaction);
        const now = new Date();
        const [source] = await transaction
          .insert(dataSources)
          .values({
            demoNotice: input.metadata.isDemo
              ? input.metadata.demoNotice
              : null,
            isDemo: input.metadata.isDemo,
            publishedOn: input.metadata.publishedOn,
            publisher: input.metadata.sourcePublisher,
            sourceType: input.metadata.sourceType,
            title: input.metadata.sourceTitle,
            url: nullableString(input.metadata.sourceUrl),
            verifiedAt: now,
          })
          .returning({ id: dataSources.id });

        if (!source) {
          throw new Error("Failed to create the document source.");
        }

        const [document] = await transaction
          .insert(documents)
          .values({
            byteSize: input.byteSize,
            canonicalUrl: nullableString(input.metadata.canonicalUrl),
            contentSha256: input.contentSha256,
            dataSourceId: source.id,
            demoNotice: input.metadata.isDemo
              ? input.metadata.demoNotice
              : null,
            governancePublishedAt: null,
            governanceStatus: "draft",
            isDemo: input.metadata.isDemo,
            languageCode: input.metadata.languageCode,
            licenseCode: input.metadata.licenseCode,
            mimeType: input.mimeType,
            originalFilename: input.originalFilename,
            processingStatus: "processing",
            publishedOn: input.metadata.publishedOn,
            redistributionAllowed: input.metadata.redistributionAllowed,
            storagePath: input.storagePath,
            title: input.metadata.title,
            type: input.metadata.documentType,
            validFrom: input.metadata.validFrom,
            validTo: input.metadata.validTo,
            verifiedAt: now,
          })
          .onConflictDoNothing({ target: documents.contentSha256 })
          .returning({ id: documents.id });

        if (!document) {
          await transaction
            .delete(dataSources)
            .where(eq(dataSources.id, source.id));
          const [existing] = await transaction
            .select({ id: documents.id })
            .from(documents)
            .where(eq(documents.contentSha256, input.contentSha256))
            .limit(1);
          if (!existing) {
            throw new Error(
              "The duplicate document could not be loaded after a hash conflict.",
            );
          }
          return { created: false as const, documentId: existing.id };
        }

        return { created: true as const, documentId: document.id };
      });
    },
    async findByHash(contentSha256: string) {
      const rows = await database
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.contentSha256, contentSha256))
        .limit(1);

      return rows[0] ?? null;
    },
    async findDocumentForDownload(documentId: string) {
      const rows = await database
        .select({
          contentSha256: documents.contentSha256,
          mimeType: documents.mimeType,
          originalFilename: documents.originalFilename,
          storagePath: documents.storagePath,
        })
        .from(documents)
        .where(eq(documents.id, documentId))
        .limit(1);

      return rows[0] ?? null;
    },
    async findDocumentForReprocessing(input: {
      accessScope: KnowledgeDocumentReprocessingAccessScope;
      documentId: string;
    }) {
      const [activeDraft] = await database
        .select({
          createdBy: dataGovernanceDrafts.createdBy,
          id: dataGovernanceDrafts.id,
          version: dataGovernanceDrafts.version,
        })
        .from(dataGovernanceDrafts)
        .where(
          and(
            eq(dataGovernanceDrafts.entityType, "document"),
            eq(dataGovernanceDrafts.entityKey, input.documentId),
            inArray(dataGovernanceDrafts.workflowStatus, [
              "draft",
              "reviewed",
            ]),
            isNull(dataGovernanceDrafts.archivedAt),
            input.accessScope.kind === "creator"
              ? eq(
                  dataGovernanceDrafts.createdBy,
                  input.accessScope.createdBy,
                )
              : undefined,
          ),
        )
        .orderBy(desc(dataGovernanceDrafts.version))
        .limit(1);
      if (!activeDraft) {
        return null;
      }

      const rows = await database
        .select({
          canonicalUrl: documents.canonicalUrl,
          contentSha256: documents.contentSha256,
          dataSourceId: documents.dataSourceId,
          demoNotice: documents.demoNotice,
          documentType: documents.type,
          governanceStatus: documents.governanceStatus,
          isDemo: documents.isDemo,
          languageCode: documents.languageCode,
          licenseCode: documents.licenseCode,
          mimeType: documents.mimeType,
          originalFilename: documents.originalFilename,
          processingStatus: documents.processingStatus,
          publishedOn: documents.publishedOn,
          redistributionAllowed: documents.redistributionAllowed,
          sourceArchivedAt: sql<string | null>`case
            when ${dataSources.archivedAt} is null then null
            else to_char(
              ${dataSources.archivedAt} at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
            )
          end`,
          sourceCreatedAt: sql<string>`to_char(
            ${dataSources.createdAt} at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          )`,
          sourceDemoNotice: dataSources.demoNotice,
          sourceIsDemo: dataSources.isDemo,
          sourcePublishedOn: dataSources.publishedOn,
          sourcePublisher: dataSources.publisher,
          sourceTitle: dataSources.title,
          sourceType: dataSources.sourceType,
          sourceUpdatedAt: sql<string>`to_char(
            ${dataSources.updatedAt} at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          )`,
          sourceUrl: dataSources.url,
          sourceVerifiedAt: sql<string>`to_char(
            ${dataSources.verifiedAt} at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          )`,
          storagePath: documents.storagePath,
          title: documents.title,
          validFrom: documents.validFrom,
          validTo: documents.validTo,
        })
        .from(documents)
        .innerJoin(dataSources, eq(documents.dataSourceId, dataSources.id))
        .where(
          and(
            eq(documents.id, input.documentId),
            isNull(documents.archivedAt),
          ),
        )
        .limit(1);

      const document = rows[0];
      if (!document) {
        return null;
      }

      const chunks = await database
        .select({
          applicationScope: documentChunks.applicationScope,
          chunkIndex: documentChunks.chunkIndex,
          content: documentChunks.content,
          contentHash: documentChunks.contentHash,
          countryIso3: documentChunks.countryIso3,
          createdAt: sql<string>`to_char(
            ${documentChunks.createdAt} at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          )`,
          embedding: documentChunks.embedding,
          embeddingModel: documentChunks.embeddingModel,
          headingPath: documentChunks.headingPath,
          isDemo: documentChunks.isDemo,
          jurisdictionId: documentChunks.jurisdictionId,
          pageFrom: documentChunks.pageFrom,
          pageTo: documentChunks.pageTo,
          sectionLocator: documentChunks.sectionLocator,
          tokenCount: documentChunks.tokenCount,
          updatedAt: sql<string>`to_char(
            ${documentChunks.updatedAt} at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          )`,
          validFrom: documentChunks.validFrom,
          validTo: documentChunks.validTo,
          verifiedAt: sql<string>`to_char(
            ${documentChunks.verifiedAt} at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          )`,
        })
        .from(documentChunks)
        .where(eq(documentChunks.documentId, input.documentId))
        .orderBy(asc(documentChunks.chunkIndex));
      if (
        document.processingStatus !== "ready" &&
        document.processingStatus !== "failed"
      ) {
        return {
          ...document,
          activeDraft,
          applicationScope: chunks[0]?.applicationScope ?? null,
          auditMarkers: [],
          chunkSetFingerprint: null,
          countryIso3: chunks[0]?.countryIso3 ?? null,
          jurisdictionId: chunks[0]?.jurisdictionId ?? null,
          sourceFingerprint: createDocumentDataSourceFingerprint({
            archivedAt: document.sourceArchivedAt,
            createdAt: document.sourceCreatedAt,
            demoNotice: document.sourceDemoNotice,
            id: document.dataSourceId,
            isDemo: document.sourceIsDemo,
            publishedOn: document.sourcePublishedOn,
            publisher: document.sourcePublisher,
            sourceType: document.sourceType,
            title: document.sourceTitle,
            updatedAt: document.sourceUpdatedAt,
            url: document.sourceUrl,
            verifiedAt: document.sourceVerifiedAt,
          }),
        };
      }
      let chunkSetFingerprint: string;
      try {
        chunkSetFingerprint = createDocumentChunkSetFingerprint({
          chunks,
          processingStatus: document.processingStatus,
        });
      } catch {
        throw new Error("Document chunk provenance is invalid.");
      }

      const auditMarkers = await database
        .select({
          action: dataChangeLogs.action,
          afterData: dataChangeLogs.afterData,
          draftId: dataChangeLogs.draftId,
          entityKey: dataChangeLogs.entityKey,
          entityType: dataChangeLogs.entityType,
          id: dataChangeLogs.id,
        })
        .from(dataChangeLogs)
        .where(
          and(
            eq(dataChangeLogs.draftId, activeDraft.id),
            eq(dataChangeLogs.entityType, "document"),
            eq(dataChangeLogs.entityKey, input.documentId),
            inArray(dataChangeLogs.action, [
              "draft_created",
              "document_reprocessed",
            ]),
          ),
        )
        .orderBy(desc(dataChangeLogs.createdAt), desc(dataChangeLogs.id));

      return {
        ...document,
        activeDraft,
        applicationScope: chunks[0]?.applicationScope ?? null,
        auditMarkers,
        chunkSetFingerprint,
        countryIso3: chunks[0]?.countryIso3 ?? null,
        jurisdictionId: chunks[0]?.jurisdictionId ?? null,
        sourceFingerprint: createDocumentDataSourceFingerprint({
          archivedAt: document.sourceArchivedAt,
          createdAt: document.sourceCreatedAt,
          demoNotice: document.sourceDemoNotice,
          id: document.dataSourceId,
          isDemo: document.sourceIsDemo,
          publishedOn: document.sourcePublishedOn,
          publisher: document.sourcePublisher,
          sourceType: document.sourceType,
          title: document.sourceTitle,
          updatedAt: document.sourceUpdatedAt,
          url: document.sourceUrl,
          verifiedAt: document.sourceVerifiedAt,
        }),
      };
    },
    getDocumentSummary,
    async listDocuments() {
      return database
        .select({
          byteSize: documents.byteSize,
          chunkCount: sql<number>`(
            select count(*)::int
            from ${documentChunks}
            where ${documentChunks.documentId} = ${documents.id}
          )`,
          contentSha256: documents.contentSha256,
          createdAt: documents.createdAt,
          governanceStatus: documents.governanceStatus,
          id: documents.id,
          isDemo: documents.isDemo,
          mimeType: documents.mimeType,
          originalFilename: documents.originalFilename,
          processedAt: documents.processedAt,
          processingError: documents.processingError,
          processingStatus: documents.processingStatus,
          sourceTitle: dataSources.title,
          storagePath: documents.storagePath,
          title: documents.title,
          type: documents.type,
        })
        .from(documents)
        .innerJoin(dataSources, eq(documents.dataSourceId, dataSources.id))
        .orderBy(desc(documents.createdAt))
        .limit(50);
    },
    async listDocumentStoragePaths() {
      return database
        .select({ storagePath: documents.storagePath })
        .from(documents)
        .where(isNotNull(documents.storagePath));
    },
    async listFilterOptions() {
      const [countryRows, jurisdictionRows] = await Promise.all([
        database
          .select({
            iso3: countries.iso3,
            name: countries.nameEn,
          })
          .from(countries)
          .where(isNull(countries.archivedAt))
          .orderBy(asc(countries.nameEn)),
        database
          .select({
            countryIso3: jurisdictions.countryIso3,
            id: jurisdictions.id,
            name: jurisdictions.name,
          })
          .from(jurisdictions)
          .where(isNull(jurisdictions.archivedAt))
          .orderBy(asc(jurisdictions.name)),
      ]);

      return {
        countries: countryRows,
        jurisdictions: jurisdictionRows,
      };
    },
    async markDocumentFailed(documentId: string, message: string) {
      await database.transaction(async (transaction) => {
        await assertGovernanceWriteAllowed(transaction);
        const now = new Date();
        await transaction
          .update(documents)
          .set({
            processedAt: now,
            processingError: message,
            processingStatus: "failed",
            updatedAt: now,
          })
          .where(
            and(
              eq(documents.id, documentId),
              eq(documents.governanceStatus, "draft"),
              eq(documents.processingStatus, "processing"),
              isNull(documents.archivedAt),
            ),
          );
      });
    },
    async searchCandidates(
      query: HybridSearchQuery,
      queryEmbedding: number[],
      options: RequestSignalOptions & KnowledgeRankingOptions = {},
    ) {
      throwIfRequestAborted(options.signal);
      const conditions: SQL[] = [
        eq(documents.processingStatus, "ready"),
        eq(documents.governanceStatus, "published"),
        isNull(documents.archivedAt),
        isNull(dataSources.archivedAt),
        isNull(countries.archivedAt),
        isNull(jurisdictions.archivedAt),
        isNotNull(documentChunks.embedding),
      ];

      if (query.countryIso3) {
        conditions.push(eq(documentChunks.countryIso3, query.countryIso3));
      }
      if (query.jurisdictionId) {
        conditions.push(
          eq(documentChunks.jurisdictionId, query.jurisdictionId),
        );
      }
      if (query.applicationScope) {
        conditions.push(
          eq(documentChunks.applicationScope, query.applicationScope),
        );
      }
      if (query.asOf) {
        conditions.push(
          or(
            isNull(documentChunks.validFrom),
            lte(documentChunks.validFrom, query.asOf),
          ) as SQL,
          or(
            isNull(documentChunks.validTo),
            gt(documentChunks.validTo, query.asOf),
          ) as SQL,
        );
      }

      const rankingQuery = projectKnowledgeRankingQuery(query.query, options.deliveryCueRanking);
      const resolveTextQuery = (text: string) => resolveKnowledgeTextQuery(text, async (maskedQuery) =>
        database.select({ query: sql<string>`websearch_to_tsquery('simple', ${maskedQuery})::text` })
          .from(sql`(values (1)) as knowledge_spelling_parse(value)`), options);
      // Ranking-only projection never changes the original native predicate.
      const candidateConstraint = await resolveKnowledgeCandidateConstraint(query.query, parseNativeConstraints, options);
      if (candidateConstraint) conditions.push(sql`${documentChunks.searchVector} @@ ${candidateConstraint}`);
      throwIfRequestAborted(options.signal);
      const candidateQuery = (textQuery: SQL, embedding: number[], rankingPath: 0 | 1) => {
        const keywordScore = sql<number>`ts_rank_cd(${documentChunks.searchVector}, ${textQuery})`;
        const vectorDistance = cosineDistance(documentChunks.embedding, embedding);
        return database
          .select({
            applicationScope: documentChunks.applicationScope,
            chunkId: documentChunks.id,
            content: documentChunks.content,
            countryIso3: documentChunks.countryIso3,
            documentId: documents.id,
            documentPublishedOn: documents.publishedOn,
            documentTitle: documents.title,
            headingPath: documentChunks.headingPath,
            isDemo: sql<boolean>`${documents.isDemo} OR ${documentChunks.isDemo} OR ${dataSources.isDemo}`,
            jurisdictionId: jurisdictions.id,
            jurisdictionName: jurisdictions.name,
            keywordScore,
            originalFilename: documents.originalFilename,
            pageFrom: documentChunks.pageFrom,
            pageTo: documentChunks.pageTo,
            publisher: dataSources.publisher,
            rankingPath: sql<0 | 1>`${rankingPath}::integer`,
            sectionLocator: documentChunks.sectionLocator,
            sourceId: dataSources.id,
            sourcePublishedOn: dataSources.publishedOn,
            sourceTitle: dataSources.title,
            sourceUrl: dataSources.url,
            sourceVerifiedAt: dataSources.verifiedAt,
            storagePath: documents.storagePath,
            validFrom: documentChunks.validFrom,
            validTo: documentChunks.validTo,
            vectorDistance,
          })
          .from(documentChunks)
          .innerJoin(documents, eq(documentChunks.documentId, documents.id))
          .innerJoin(dataSources, eq(documents.dataSourceId, dataSources.id))
          .leftJoin(countries, eq(documentChunks.countryIso3, countries.iso3))
          .leftJoin(
            jurisdictions,
            eq(documentChunks.jurisdictionId, jurisdictions.id),
          )
          .where(and(...conditions))
          .orderBy(desc(keywordScore), asc(vectorDistance))
          .limit(100);
      };
      const original = candidateQuery(await resolveTextQuery(query.query), queryEmbedding, 0);
      // Two bounded candidate views share one SQL statement and governance
      // snapshot. Every row carries its own complete keyword/vector score pair.
      const combined = rankingQuery === query.query ? original : original.unionAll(
        candidateQuery(await resolveTextQuery(rankingQuery), createLocalHashEmbedding(rankingQuery), 1),
      );
      throwIfRequestAborted(options.signal);
      const rows = await combined;
      throwIfRequestAborted(options.signal);

      return rows;
    },
  };
}
