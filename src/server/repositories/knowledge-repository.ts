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

import type {
  DocumentImportMetadata,
  HybridSearchQuery,
} from "@/features/knowledge/schemas";
import * as schema from "@/server/db/schema";
import {
  countries,
  dataSources,
  documentChunks,
  documents,
  jurisdictions,
} from "@/server/db/schema";
import { assertGovernanceWriteAllowed } from "@/server/db/governance-maintenance-lock";

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

function nullableString(value: string | null): string | null {
  return value ? value : null;
}

export function createKnowledgeRepository<
  TQueryResult extends PgQueryResultHKT,
>(database: PgDatabase<TQueryResult, typeof schema>) {
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
    async beginDocumentReprocessing(
      documentId: string,
      metadata: DocumentImportMetadata,
    ) {
      return database.transaction(async (transaction) => {
        await assertGovernanceWriteAllowed(transaction);
        const [before] = await transaction
          .select({
            document: {
              canonicalUrl: documents.canonicalUrl,
              dataSourceId: documents.dataSourceId,
              demoNotice: documents.demoNotice,
              governanceStatus: documents.governanceStatus,
              isDemo: documents.isDemo,
              languageCode: documents.languageCode,
              licenseCode: documents.licenseCode,
              processingStatus: documents.processingStatus,
              publishedOn: documents.publishedOn,
              redistributionAllowed: documents.redistributionAllowed,
              title: documents.title,
              type: documents.type,
              validFrom: documents.validFrom,
              validTo: documents.validTo,
            },
            source: {
              demoNotice: dataSources.demoNotice,
              isDemo: dataSources.isDemo,
              publishedOn: dataSources.publishedOn,
              publisher: dataSources.publisher,
              sourceType: dataSources.sourceType,
              title: dataSources.title,
              url: dataSources.url,
            },
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

        if (
          !before ||
          before.document.governanceStatus !== "draft" ||
          !["ready", "failed"].includes(before.document.processingStatus)
        ) {
          return null;
        }

        const now = new Date();
        const [source] = await transaction
          .insert(dataSources)
          .values({
            demoNotice: metadata.isDemo ? metadata.demoNotice : null,
            isDemo: metadata.isDemo,
            publishedOn: metadata.publishedOn,
            publisher: metadata.sourcePublisher,
            sourceType: metadata.sourceType,
            title: metadata.sourceTitle,
            url: nullableString(metadata.sourceUrl),
            verifiedAt: now,
          })
          .returning({ id: dataSources.id });
        if (!source) {
          throw new Error("Failed to create the reprocessed document source.");
        }
        await transaction
          .update(documents)
          .set({
            canonicalUrl: nullableString(metadata.canonicalUrl),
            dataSourceId: source.id,
            demoNotice: metadata.isDemo ? metadata.demoNotice : null,
            isDemo: metadata.isDemo,
            languageCode: metadata.languageCode,
            licenseCode: metadata.licenseCode,
            processedAt: null,
            processingError: null,
            processingStatus: "processing",
            publishedOn: metadata.publishedOn,
            redistributionAllowed: metadata.redistributionAllowed,
            title: metadata.title,
            type: metadata.documentType,
            updatedAt: now,
            validFrom: metadata.validFrom,
            validTo: metadata.validTo,
          })
          .where(
            and(
              eq(documents.id, documentId),
              eq(documents.governanceStatus, "draft"),
              isNull(documents.archivedAt),
            ),
          );

        return { beforeData: before, sourceId: source.id };
      });
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
        await transaction.insert(documentChunks).values(
          chunks.map((chunk) => ({
            ...chunk,
            documentId,
          })),
        );
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
          mimeType: documents.mimeType,
          originalFilename: documents.originalFilename,
          storagePath: documents.storagePath,
        })
        .from(documents)
        .where(eq(documents.id, documentId))
        .limit(1);

      return rows[0] ?? null;
    },
    async findDocumentForReprocessing(documentId: string) {
      const rows = await database
        .select({
          governanceStatus: documents.governanceStatus,
          mimeType: documents.mimeType,
          originalFilename: documents.originalFilename,
          storagePath: documents.storagePath,
        })
        .from(documents)
        .where(
          and(
            eq(documents.id, documentId),
            isNull(documents.archivedAt),
          ),
        )
        .limit(1);

      return rows[0] ?? null;
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
      await database
        .update(documents)
        .set({
          processedAt: new Date(),
          processingError: message,
          processingStatus: "failed",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(documents.id, documentId),
            eq(documents.governanceStatus, "draft"),
            eq(documents.processingStatus, "processing"),
            isNull(documents.archivedAt),
          ),
        );
    },
    async searchCandidates(
      query: HybridSearchQuery,
      queryEmbedding: number[],
    ) {
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

      const keywordScore = sql<number>`ts_rank_cd(
        ${documentChunks.searchVector},
        websearch_to_tsquery('simple', ${query.query})
      )`;
      const vectorDistance = cosineDistance(
        documentChunks.embedding,
        queryEmbedding,
      );

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
    },
  };
}
