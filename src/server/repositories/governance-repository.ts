import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { findOverlappingMembershipIndexes } from "@/domain/admin/jurisdiction-membership";
import {
  countryDraftPayloadSchema,
  dataSourceDraftPayloadSchema,
  documentDraftPayloadSchema,
  jurisdictionDraftPayloadSchema,
  marketMetricDraftPayloadSchema,
  productCertificationDraftPayloadSchema,
  productDraftPayloadSchema,
  regulationDraftPayloadSchema,
  type AdminPrincipal,
  type GovernedEntityType,
} from "@/features/admin/schemas";
import {
  type CanonicalDocumentProvenanceMarker,
  createDocumentChunkSetFingerprint,
  createDocumentDataSourceFingerprint,
  createDocumentProvenanceMarkerFingerprint,
  documentDraftCreatedAuditAfterDataSchema,
  documentReprocessedAuditAfterDataSchema,
  getDocumentProvenanceActionForVersion,
  normalizeDocumentImportMetadataForProvenance,
  parseCanonicalDocumentProvenanceMarkerFor,
  parseDocumentDraftCreatedAuditMarkerFor,
  parseDocumentReprocessedAuditMarkerFor,
} from "@/features/admin/document-reprocessed-audit";
import {
  documentImportMetadataSchema,
  type DocumentImportMetadata,
} from "@/features/knowledge/schemas";
import { assertGovernanceWriteAllowed } from "@/server/db/governance-maintenance-lock";
import * as schema from "@/server/db/schema";
import {
  countries,
  countryJurisdictions,
  dataChangeLogs,
  dataGovernanceDrafts,
  dataSources,
  documentChunks,
  documents,
  jurisdictions,
  marketImportBatches,
  marketMetrics,
  productCertifications,
  products,
  regulationLimits,
  regulations,
} from "@/server/db/schema";
import type {
  PreparedKnowledgeDocumentReprocessing,
  PreparedKnowledgeDocumentUpload,
} from "@/server/repositories/knowledge-repository";
import { GovernanceConflictError } from "@/server/repositories/governance-conflict-error";
import { createGovernanceSourceWrites } from "@/server/repositories/governance-source-writes";
import { documentChunkInsertBatches } from "@/server/repositories/document-chunk-batches";

export { GovernanceConflictError } from "@/server/repositories/governance-conflict-error";
export {
  SOURCE_CONCURRENT_INSERT_CONFLICT_MESSAGE,
  SOURCE_VERIFIED_AT_REGRESSION_MESSAGE,
} from "@/server/repositories/governance-source-writes";

type GovernanceJson = Record<string, unknown>;
type ImportPreviewRow = {
  parsed: GovernanceJson | null;
  rowNumber: number;
};
type ImportValidationError = {
  field: string | null;
  message: string;
  rowNumber: number;
};

function nullableString(value: string | null): string | null {
  return value ? value : null;
}

const documentReprocessingDraftConflictMessage =
  "The active document draft changed while reprocessing was prepared; retry from the latest version.";

function assertDocumentReprocessingDraftAccess(input: {
  actor: AdminPrincipal;
  createdBy: string;
}): void {
  if (
    input.actor.role === "admin" ||
    input.actor.role === "reviewer" ||
    (input.actor.role === "editor" &&
      input.actor.email === input.createdBy)
  ) {
    return;
  }

  throw new GovernanceConflictError(
    documentReprocessingDraftConflictMessage,
  );
}

function requiredId(id: string | undefined, entityType: string): string {
  if (!id) {
    throw new GovernanceConflictError(
      `${entityType} draft payload does not contain an assigned id.`,
    );
  }
  return id;
}

function assertMembershipPeriodsDoNotOverlap(
  memberships: readonly {
    countryIso3: string;
    validFrom: string;
    validTo?: string | null;
  }[],
): void {
  if (findOverlappingMembershipIndexes(memberships).length > 0) {
    throw new GovernanceConflictError(
      "Jurisdiction membership periods for one country must not overlap.",
    );
  }
}

function getDraftPayloadEntityKey(
  entityType: GovernedEntityType,
  payload: GovernanceJson,
): string | undefined {
  const payloadKey =
    entityType === "country"
      ? payload.iso3
      : entityType === "document"
        ? payload.documentId
        : payload.id;

  return typeof payloadKey === "string" ? payloadKey : undefined;
}

function requireMatchingDraftEntityKey(input: {
  entityKey: string;
  entityType: GovernedEntityType;
  payload: GovernanceJson;
}): void {
  const payloadEntityKey = getDraftPayloadEntityKey(
    input.entityType,
    input.payload,
  );

  if (!payloadEntityKey) {
    throw new GovernanceConflictError(
      `${input.entityType} draft payload does not contain its entity identity.`,
    );
  }
  if (payloadEntityKey !== input.entityKey) {
    throw new GovernanceConflictError(
      `${input.entityType} draft entity key does not match its payload identity.`,
    );
  }
}

function hasPostgresErrorCode(error: unknown, code: string): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== "object" || current === null) {
      return false;
    }
    const errorRecord = current as Record<string, unknown>;
    if (errorRecord.code === code) {
      return true;
    }
    current = errorRecord.cause;
  }

  return false;
}

export function createGovernanceRepository<
  TQueryResult extends PgQueryResultHKT,
>(database: PgDatabase<TQueryResult, typeof schema>) {
  type GovernanceTransaction = Parameters<
    Parameters<typeof database.transaction>[0]
  >[0];
  const sourceWrites = createGovernanceSourceWrites(database);

  const lockDocumentDraftChain = (
    transaction: GovernanceTransaction,
    documentId: string,
  ) =>
    transaction
      .select()
      .from(dataGovernanceDrafts)
      .where(
        and(
          eq(dataGovernanceDrafts.entityType, "document"),
          eq(dataGovernanceDrafts.entityKey, documentId),
        ),
      )
      .orderBy(asc(dataGovernanceDrafts.version))
      .for("update");

  const loadDocumentProvenanceExpectation = async (
    transaction: GovernanceTransaction,
    documentId: string,
    failedChunkMetadataFallback?: DocumentImportMetadata,
  ) => {
    const [snapshot] = await transaction
      .select({
        document: {
          archivedAt: documents.archivedAt,
          canonicalUrl: documents.canonicalUrl,
          contentSha256: documents.contentSha256,
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
          updatedAt: documents.updatedAt,
          validFrom: documents.validFrom,
          validTo: documents.validTo,
        },
        source: {
          archivedAt: sql<string | null>`case
            when ${dataSources.archivedAt} is null then null
            else to_char(
              ${dataSources.archivedAt} at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
            )
          end`,
          createdAt: sql<string>`to_char(
            ${dataSources.createdAt} at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          )`,
          demoNotice: dataSources.demoNotice,
          id: dataSources.id,
          isDemo: dataSources.isDemo,
          publishedOn: dataSources.publishedOn,
          publisher: dataSources.publisher,
          sourceType: dataSources.sourceType,
          title: dataSources.title,
          updatedAt: sql<string>`to_char(
            ${dataSources.updatedAt} at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          )`,
          url: dataSources.url,
          verifiedAt: sql<string>`to_char(
            ${dataSources.verifiedAt} at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
          )`,
        },
      })
      .from(documents)
      .innerJoin(dataSources, eq(documents.dataSourceId, dataSources.id))
      .where(eq(documents.id, documentId))
      .limit(1)
      .for("update");
    if (
      !snapshot ||
      snapshot.document.archivedAt !== null ||
      snapshot.source.archivedAt !== null ||
      (snapshot.document.processingStatus !== "ready" &&
        snapshot.document.processingStatus !== "failed")
    ) {
      throw new GovernanceConflictError(
        "Document provenance cannot be verified against an active ready/failed document and source.",
      );
    }
    const processingStatus: "failed" | "ready" =
      snapshot.document.processingStatus;

    const chunkMetadata = await transaction
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
      .where(eq(documentChunks.documentId, documentId))
      .orderBy(asc(documentChunks.chunkIndex))
      .for("update");
    const firstChunk = chunkMetadata[0];
    let chunkSetFingerprint: string;
    try {
      chunkSetFingerprint = createDocumentChunkSetFingerprint({
        chunks: chunkMetadata,
        processingStatus,
      });
    } catch {
      throw new GovernanceConflictError(
        "Document chunk-set provenance is missing, inconsistent, or malformed.",
      );
    }
    if (
      firstChunk &&
      chunkMetadata.some(
        (chunk) =>
          chunk.applicationScope !== firstChunk.applicationScope ||
          chunk.countryIso3 !== firstChunk.countryIso3 ||
          chunk.isDemo !== firstChunk.isDemo ||
          chunk.jurisdictionId !== firstChunk.jurisdictionId ||
          chunk.validFrom !== firstChunk.validFrom ||
          chunk.validTo !== firstChunk.validTo,
      )
    ) {
      throw new GovernanceConflictError(
        "Document chunk metadata provenance is missing or inconsistent.",
      );
    }
    if (
      firstChunk !== undefined &&
        (firstChunk.isDemo !== snapshot.document.isDemo ||
          firstChunk.validFrom !== snapshot.document.validFrom ||
          firstChunk.validTo !== snapshot.document.validTo)
    ) {
      throw new GovernanceConflictError(
        "Document and chunk metadata provenance is inconsistent.",
      );
    }

    const metadata = documentImportMetadataSchema.safeParse({
      applicationScope:
        firstChunk?.applicationScope ??
        (processingStatus === "failed"
          ? failedChunkMetadataFallback?.applicationScope ?? null
          : null),
      canonicalUrl: snapshot.document.canonicalUrl,
      countryIso3:
        firstChunk?.countryIso3 ??
        (processingStatus === "failed"
          ? failedChunkMetadataFallback?.countryIso3 ?? null
          : null),
      demoNotice: snapshot.document.demoNotice,
      documentType: snapshot.document.type,
      isDemo: snapshot.document.isDemo,
      jurisdictionId:
        firstChunk?.jurisdictionId ??
        (processingStatus === "failed"
          ? failedChunkMetadataFallback?.jurisdictionId ?? null
          : null),
      languageCode: snapshot.document.languageCode,
      licenseCode: snapshot.document.licenseCode,
      publishedOn: snapshot.document.publishedOn,
      redistributionAllowed: snapshot.document.redistributionAllowed,
      sourcePublisher: snapshot.source.publisher,
      sourceTitle: snapshot.source.title,
      sourceType: snapshot.source.sourceType,
      sourceUrl: snapshot.source.url,
      title: snapshot.document.title,
      validFrom: snapshot.document.validFrom,
      validTo: snapshot.document.validTo,
    });
    if (!metadata.success) {
      throw new GovernanceConflictError(
        "Document metadata provenance cannot be reconstructed safely.",
      );
    }

    return {
      chunkSetFingerprint,
      document: { ...snapshot.document, processingStatus },
      metadata: metadata.data,
      source: snapshot.source,
      sourceFingerprint: createDocumentDataSourceFingerprint(
        snapshot.source,
      ),
    };
  };

  const requireCanonicalDocumentProvenance = async (
    transaction: GovernanceTransaction,
    draft: typeof dataGovernanceDrafts.$inferSelect,
  ): Promise<{
    document: {
      governanceStatus: "draft" | "published" | "reviewed";
      processingStatus: "failed" | "pending" | "processing" | "ready";
    };
    provenance: CanonicalDocumentProvenanceMarker;
  }> => {
    const initialSnapshot = await loadDocumentProvenanceExpectation(
      transaction,
      draft.entityKey,
    );

    const action = getDocumentProvenanceActionForVersion(draft.version);
    const auditRows = await transaction
      .select({
        afterData: dataChangeLogs.afterData,
        draftId: dataChangeLogs.draftId,
        entityKey: dataChangeLogs.entityKey,
        entityType: dataChangeLogs.entityType,
      })
      .from(dataChangeLogs)
      .where(
        and(
          eq(dataChangeLogs.action, action),
          eq(dataChangeLogs.draftId, draft.id),
          eq(dataChangeLogs.entityType, "document"),
          eq(dataChangeLogs.entityKey, draft.entityKey),
        ),
      )
      .for("update");
    if (auditRows.length !== 1) {
      throw new GovernanceConflictError(
        `Document draft v${draft.version} requires exactly one canonical ${action} provenance marker.`,
      );
    }

    const marker =
      action === "draft_created"
        ? parseDocumentDraftCreatedAuditMarkerFor({
            expectedChunkSetFingerprint:
              initialSnapshot.chunkSetFingerprint,
            expectedContentSha256:
              initialSnapshot.document.contentSha256,
            expectedDocumentId: draft.entityKey,
            expectedDraftId: draft.id,
            expectedProcessingStatus:
              initialSnapshot.document.processingStatus,
            expectedSourceFingerprint:
              initialSnapshot.sourceFingerprint,
            expectedSourceId: initialSnapshot.source.id,
            marker: auditRows[0],
          })
        : parseDocumentReprocessedAuditMarkerFor({
            expectedChunkSetFingerprint:
              initialSnapshot.chunkSetFingerprint,
            expectedContentSha256:
              initialSnapshot.document.contentSha256,
            expectedDocumentId: draft.entityKey,
            expectedDraftId: draft.id,
            expectedProcessingStatus:
              initialSnapshot.document.processingStatus,
            expectedSourceFingerprint:
              initialSnapshot.sourceFingerprint,
            expectedSourceId: initialSnapshot.source.id,
            marker: auditRows[0],
          });
    if (!marker) {
      throw new GovernanceConflictError(
        `Document draft v${draft.version} canonical provenance is malformed or has drifted from the current document, source, chunk set, hash, or status.`,
      );
    }

    if (action === "document_reprocessed") {
      const supersededDraftIds =
        "supersededDraftIds" in marker.afterData
          ? marker.afterData.supersededDraftIds
          : null;
      const supersededDraftId =
        Array.isArray(supersededDraftIds) &&
        typeof supersededDraftIds[0] === "string"
          ? supersededDraftIds[0]
          : undefined;
      const [immediatePredecessor] = supersededDraftId
        ? await transaction
            .select()
            .from(dataGovernanceDrafts)
            .where(
              and(
                eq(dataGovernanceDrafts.id, supersededDraftId),
                eq(dataGovernanceDrafts.entityType, "document"),
                eq(dataGovernanceDrafts.entityKey, draft.entityKey),
                eq(dataGovernanceDrafts.version, draft.version - 1),
              ),
            )
            .limit(1)
            .for("update")
        : [];
      if (
        !immediatePredecessor ||
        immediatePredecessor.entityType !== "document" ||
        immediatePredecessor.entityKey !== draft.entityKey ||
        immediatePredecessor.version !== draft.version - 1 ||
        immediatePredecessor.archivedAt === null ||
        (immediatePredecessor.workflowStatus !== "draft" &&
          immediatePredecessor.workflowStatus !== "reviewed")
      ) {
        throw new GovernanceConflictError(
          `Document draft v${draft.version} reprocessing provenance does not identify its immediate archived predecessor.`,
        );
      }
    }

    // A failed document deliberately has no chunks. Its canonical v2 marker
    // is the only provenance source for the three chunk-only metadata fields;
    // every field reconstructable from the document/source rows remains
    // checked below against the database snapshot.
    const snapshot =
      initialSnapshot.document.processingStatus === "failed"
        ? await loadDocumentProvenanceExpectation(
            transaction,
            draft.entityKey,
            marker.afterData.metadata,
          )
        : initialSnapshot;

    const provenance = parseCanonicalDocumentProvenanceMarkerFor({
      draftVersion: draft.version,
      expectedChunkSetFingerprint: snapshot.chunkSetFingerprint,
      expectedContentSha256: snapshot.document.contentSha256,
      expectedDocumentId: draft.entityKey,
      expectedDraftId: draft.id,
      expectedMetadata: snapshot.metadata,
      expectedProcessingStatus: snapshot.document.processingStatus,
      expectedSourceFingerprint: snapshot.sourceFingerprint,
      expectedSourceId: snapshot.source.id,
      marker: auditRows[0],
    });
    if (!provenance) {
      throw new GovernanceConflictError(
        `Document draft v${draft.version} canonical provenance is malformed or has drifted from the current document, source, hash, status, or metadata.`,
      );
    }

    return {
      document: {
        governanceStatus: snapshot.document.governanceStatus,
        processingStatus: snapshot.document.processingStatus,
      },
      provenance,
    };
  };

  return {
    async archiveEntity(input: {
      actor: AdminPrincipal;
      entityKey: string;
      entityType: GovernedEntityType;
      reason: string;
    }) {
      return database.transaction(async (transaction) => {
        await assertGovernanceWriteAllowed(transaction);
        const now = new Date();
        let afterData: GovernanceJson = {
          archivedAt: now.toISOString(),
        };
        let beforeData: GovernanceJson | null = null;
        const hasActiveRows = async <TRow>(
          query: PromiseLike<TRow[]>,
        ): Promise<boolean> => (await query).length > 0;
        const requireNoActiveDependents = (
          parentLabel: string,
          dependentLabels: string[],
        ) => {
          if (dependentLabels.length > 0) {
            throw new GovernanceConflictError(
              `Cannot archive ${parentLabel} while active dependents exist: ${dependentLabels.join(", ")}. Archive or revise those dependents first.`,
            );
          }
        };
        const getSourceDependentLabels = async (
          sourceId: string,
        ): Promise<string[]> => {
          const dependentLabels: string[] = [];
          const dependentQueries = [
            {
              label: "countries",
              query: transaction
                .select({ id: countries.iso3 })
                .from(countries)
                .where(
                  and(
                    eq(countries.dataSourceId, sourceId),
                    isNull(countries.archivedAt),
                  ),
                )
                .limit(1),
            },
            {
              label: "jurisdictions",
              query: transaction
                .select({ id: jurisdictions.id })
                .from(jurisdictions)
                .where(
                  and(
                    eq(jurisdictions.dataSourceId, sourceId),
                    isNull(jurisdictions.archivedAt),
                  ),
                )
                .limit(1),
            },
            {
              label: "jurisdiction memberships",
              query: transaction
                .select({ id: countryJurisdictions.countryIso3 })
                .from(countryJurisdictions)
                .where(
                  and(
                    eq(countryJurisdictions.dataSourceId, sourceId),
                    isNull(countryJurisdictions.archivedAt),
                  ),
                )
                .limit(1),
            },
            {
              label: "regulations",
              query: transaction
                .select({ id: regulations.id })
                .from(regulations)
                .where(
                  and(
                    eq(regulations.dataSourceId, sourceId),
                    isNull(regulations.archivedAt),
                  ),
                )
                .limit(1),
            },
            {
              label: "regulation limits",
              query: transaction
                .select({ id: regulationLimits.id })
                .from(regulationLimits)
                .where(
                  and(
                    eq(regulationLimits.dataSourceId, sourceId),
                    isNull(regulationLimits.archivedAt),
                  ),
                )
                .limit(1),
            },
            {
              label: "products",
              query: transaction
                .select({ id: products.id })
                .from(products)
                .where(
                  and(
                    eq(products.dataSourceId, sourceId),
                    isNull(products.archivedAt),
                  ),
                )
                .limit(1),
            },
            {
              label: "product certifications",
              query: transaction
                .select({ id: productCertifications.id })
                .from(productCertifications)
                .where(
                  and(
                    eq(productCertifications.dataSourceId, sourceId),
                    isNull(productCertifications.archivedAt),
                  ),
                )
                .limit(1),
            },
            {
              label: "market metrics",
              query: transaction
                .select({ id: marketMetrics.id })
                .from(marketMetrics)
                .where(
                  and(
                    eq(marketMetrics.dataSourceId, sourceId),
                    isNull(marketMetrics.archivedAt),
                  ),
                )
                .limit(1),
            },
            {
              label: "published documents",
              query: transaction
                .select({ id: documents.id })
                .from(documents)
                .where(
                  and(
                    eq(documents.dataSourceId, sourceId),
                    eq(documents.governanceStatus, "published"),
                    isNull(documents.archivedAt),
                  ),
                )
                .limit(1),
            },
          ] as const;

          for (const { label, query } of dependentQueries) {
            if (await hasActiveRows(query)) {
              dependentLabels.push(label);
            }
          }

          return dependentLabels;
        };

        if (input.entityType === "country") {
          const [before] = await transaction
            .select()
            .from(countries)
            .where(
              and(
                eq(countries.iso3, input.entityKey),
                isNull(countries.archivedAt),
              ),
            )
            .limit(1)
            .for("update");
          beforeData = before ?? null;
          if (before) {
            const dependentLabels: string[] = [];
            if (
              await hasActiveRows(
                transaction
                  .select({ id: jurisdictions.id })
                  .from(jurisdictions)
                  .where(
                    and(
                      eq(jurisdictions.countryIso3, input.entityKey),
                      isNull(jurisdictions.archivedAt),
                    ),
                  )
                  .limit(1),
              )
            ) {
              dependentLabels.push("jurisdictions");
            }
            if (
              await hasActiveRows(
                transaction
                  .select({ id: countryJurisdictions.jurisdictionId })
                  .from(countryJurisdictions)
                  .where(
                    and(
                      eq(countryJurisdictions.countryIso3, input.entityKey),
                      isNull(countryJurisdictions.archivedAt),
                    ),
                  )
                  .limit(1),
              )
            ) {
              dependentLabels.push("jurisdiction memberships");
            }
            if (
              await hasActiveRows(
                transaction
                  .select({ id: marketMetrics.id })
                  .from(marketMetrics)
                  .where(
                    and(
                      eq(marketMetrics.countryIso3, input.entityKey),
                      isNull(marketMetrics.archivedAt),
                    ),
                  )
                  .limit(1),
              )
            ) {
              dependentLabels.push("market metrics");
            }
            if (
              await hasActiveRows(
                transaction
                  .select({ id: documentChunks.id })
                  .from(documentChunks)
                  .innerJoin(
                    documents,
                    eq(documentChunks.documentId, documents.id),
                  )
                  .where(
                    and(
                      eq(documentChunks.countryIso3, input.entityKey),
                      eq(documents.governanceStatus, "published"),
                      eq(documents.processingStatus, "ready"),
                      isNull(documents.archivedAt),
                    ),
                  )
                  .limit(1),
              )
            ) {
              dependentLabels.push("published document chunks");
            }
            requireNoActiveDependents("country", dependentLabels);
          }
          await transaction
            .update(countries)
            .set({ archivedAt: now, updatedAt: now })
            .where(
              and(
                eq(countries.iso3, input.entityKey),
                isNull(countries.archivedAt),
              ),
            );
        } else if (input.entityType === "regulation") {
          const [before] = await transaction
            .select()
            .from(regulations)
            .where(
              and(
                eq(regulations.id, input.entityKey),
                isNull(regulations.archivedAt),
              ),
            )
            .limit(1)
            .for("update");
          const activeLimits = before
            ? await transaction
                .select()
                .from(regulationLimits)
                .where(
                  and(
                    eq(regulationLimits.regulationId, input.entityKey),
                    isNull(regulationLimits.archivedAt),
                  ),
                )
                .for("update")
            : [];
          beforeData = before
            ? { limits: activeLimits, regulation: before }
            : null;
          afterData = {
            archivedAt: now.toISOString(),
            archivedLimits: activeLimits.map(({ id }) => ({ id })),
          };
          if (
            before &&
            (await hasActiveRows(
              transaction
                .select({ id: productCertifications.id })
                .from(productCertifications)
                .where(
                  and(
                    eq(
                      productCertifications.regulationId,
                      input.entityKey,
                    ),
                    isNull(productCertifications.archivedAt),
                  ),
                )
                .limit(1),
            ))
          ) {
            requireNoActiveDependents("regulation", [
              "product certifications",
            ]);
          }
          await transaction
            .update(regulations)
            .set({ archivedAt: now, updatedAt: now })
            .where(
              and(
                eq(regulations.id, input.entityKey),
                isNull(regulations.archivedAt),
              ),
            );
          await transaction
            .update(regulationLimits)
            .set({ archivedAt: now, updatedAt: now })
            .where(
              and(
                eq(regulationLimits.regulationId, input.entityKey),
                isNull(regulationLimits.archivedAt),
              ),
            );
        } else if (input.entityType === "product") {
          const [before] = await transaction
            .select()
            .from(products)
            .where(
              and(
                eq(products.id, input.entityKey),
                isNull(products.archivedAt),
              ),
            )
            .limit(1)
            .for("update");
          beforeData = before ?? null;
          if (
            before &&
            (await hasActiveRows(
              transaction
                .select({ id: productCertifications.id })
                .from(productCertifications)
                .where(
                  and(
                    eq(productCertifications.productId, input.entityKey),
                    isNull(productCertifications.archivedAt),
                  ),
                )
                .limit(1),
            ))
          ) {
            requireNoActiveDependents("product", [
              "product certifications",
            ]);
          }
          await transaction
            .update(products)
            .set({ archivedAt: now, updatedAt: now })
            .where(
              and(
                eq(products.id, input.entityKey),
                isNull(products.archivedAt),
              ),
            );
        } else if (input.entityType === "product_certification") {
          const [before] = await transaction
            .select()
            .from(productCertifications)
            .where(
              and(
                eq(productCertifications.id, input.entityKey),
                isNull(productCertifications.archivedAt),
              ),
            )
            .limit(1)
            .for("update");
          beforeData = before ?? null;
          await transaction
            .update(productCertifications)
            .set({ archivedAt: now, updatedAt: now })
            .where(
              and(
                eq(productCertifications.id, input.entityKey),
                isNull(productCertifications.archivedAt),
              ),
            );
        } else if (input.entityType === "market_metric") {
          const [before] = await transaction
            .select()
            .from(marketMetrics)
            .where(
              and(
                eq(marketMetrics.id, input.entityKey),
                isNull(marketMetrics.archivedAt),
              ),
            )
            .limit(1)
            .for("update");
          beforeData = before ?? null;
          await transaction
            .update(marketMetrics)
            .set({ archivedAt: now, updatedAt: now })
            .where(
              and(
                eq(marketMetrics.id, input.entityKey),
                isNull(marketMetrics.archivedAt),
              ),
            );
        } else if (input.entityType === "data_source") {
          const [before] = await transaction
            .select()
            .from(dataSources)
            .where(
              and(
                eq(dataSources.id, input.entityKey),
                isNull(dataSources.archivedAt),
              ),
            )
            .limit(1)
            .for("update");
          beforeData = before ?? null;
          if (before) {
            requireNoActiveDependents(
              "data source",
              await getSourceDependentLabels(input.entityKey),
            );
          }
          await transaction
            .update(dataSources)
            .set({ archivedAt: now, updatedAt: now })
            .where(
              and(
                eq(dataSources.id, input.entityKey),
                isNull(dataSources.archivedAt),
              ),
            );
        } else if (input.entityType === "jurisdiction") {
          const [before] = await transaction
            .select()
            .from(jurisdictions)
            .where(
              and(
                eq(jurisdictions.id, input.entityKey),
                isNull(jurisdictions.archivedAt),
              ),
            )
            .limit(1)
            .for("update");
          if (before) {
            const dependentLabels: string[] = [];
            if (
              await hasActiveRows(
                transaction
                  .select({ id: regulations.id })
                  .from(regulations)
                  .where(
                    and(
                      eq(regulations.jurisdictionId, input.entityKey),
                      isNull(regulations.archivedAt),
                    ),
                  )
                  .limit(1),
              )
            ) {
              dependentLabels.push("regulations");
            }
            if (
              await hasActiveRows(
                transaction
                  .select({ id: documentChunks.id })
                  .from(documentChunks)
                  .innerJoin(
                    documents,
                    eq(documentChunks.documentId, documents.id),
                  )
                  .where(
                    and(
                      eq(
                        documentChunks.jurisdictionId,
                        input.entityKey,
                      ),
                      eq(documents.governanceStatus, "published"),
                      eq(documents.processingStatus, "ready"),
                      isNull(documents.archivedAt),
                    ),
                  )
                  .limit(1),
              )
            ) {
              dependentLabels.push("published document chunks");
            }
            requireNoActiveDependents("jurisdiction", dependentLabels);
          }
          const memberships = before
            ? await transaction
                .select()
                .from(countryJurisdictions)
                .where(
                  and(
                    eq(
                      countryJurisdictions.jurisdictionId,
                      input.entityKey,
                    ),
                    isNull(countryJurisdictions.archivedAt),
                  ),
                )
                .for("update")
            : [];
          beforeData = before
            ? { jurisdiction: before, memberships }
            : null;
          afterData = {
            archivedAt: now.toISOString(),
            archivedMemberships: memberships.map(
              ({ countryIso3, jurisdictionId }) => ({
                countryIso3,
                jurisdictionId,
              }),
            ),
          };
          await transaction
            .update(jurisdictions)
            .set({ archivedAt: now, updatedAt: now })
            .where(
              and(
                eq(jurisdictions.id, input.entityKey),
                isNull(jurisdictions.archivedAt),
              ),
            );
          await transaction
            .update(countryJurisdictions)
            .set({ archivedAt: now, updatedAt: now })
            .where(
              and(
                eq(countryJurisdictions.jurisdictionId, input.entityKey),
                isNull(countryJurisdictions.archivedAt),
              ),
            );
        } else {
          const [before] = await transaction
            .select()
            .from(documents)
            .where(
              and(
                eq(documents.id, input.entityKey),
                isNull(documents.archivedAt),
              ),
            )
            .limit(1)
            .for("update");
          beforeData = before ?? null;
          await transaction
            .update(documents)
            .set({ archivedAt: now, updatedAt: now })
            .where(
              and(
                eq(documents.id, input.entityKey),
                isNull(documents.archivedAt),
              ),
            );
        }

        if (!beforeData) {
          throw new GovernanceConflictError(
            "The published entity does not exist or is already archived.",
          );
        }

        await transaction.insert(dataChangeLogs).values({
          action: "archived",
          actorEmail: input.actor.email,
          actorRole: input.actor.role,
          afterData,
          beforeData,
          entityKey: input.entityKey,
          entityType: input.entityType,
          reason: input.reason,
        });
      });
    },

    async confirmMarketImport(input: {
      actor: AdminPrincipal;
      batchId: string;
      reason: string;
    }) {
      return database.transaction(async (transaction) => {
        await assertGovernanceWriteAllowed(transaction);
        const [batch] = await transaction
          .select()
          .from(marketImportBatches)
          .where(
            and(
              eq(marketImportBatches.id, input.batchId),
              eq(marketImportBatches.createdBy, input.actor.email),
              eq(marketImportBatches.status, "previewed"),
            ),
          )
          .limit(1)
          .for("update");

        if (!batch) {
          throw new GovernanceConflictError(
            "Import batch is missing or is no longer previewable.",
          );
        }
        if (
          batch.invalidRows > 0 ||
          batch.previewRows.length === 0 ||
          batch.validationErrors.length > 0
        ) {
          await transaction
            .update(marketImportBatches)
            .set({
              confirmedBy: input.actor.email,
              status: "rejected",
            })
            .where(
              and(
                eq(marketImportBatches.id, input.batchId),
                eq(marketImportBatches.createdBy, input.actor.email),
                eq(marketImportBatches.status, "previewed"),
              ),
            );
          return { createdDrafts: 0, status: "rejected" as const };
        }

        const parsedRows = batch.previewRows.map((row) => {
          if (!row.parsed) {
            throw new GovernanceConflictError(
              "A valid preview batch contained an empty parsed row.",
            );
          }
          return marketMetricDraftPayloadSchema.parse(row.parsed);
        });
        const now = new Date();
        const drafts = await transaction
          .insert(dataGovernanceDrafts)
          .values(
            parsedRows.map((payload) => {
              const id = crypto.randomUUID();
              return {
                changeReason: input.reason,
                createdBy: input.actor.email,
                entityKey: id,
                entityType: "market_metric" as const,
                payload: { ...payload, id },
                version: 1,
              };
            }),
          )
          .returning({
            entityKey: dataGovernanceDrafts.entityKey,
            id: dataGovernanceDrafts.id,
            payload: dataGovernanceDrafts.payload,
          });

        if (drafts.length !== parsedRows.length) {
          throw new GovernanceConflictError(
            "The import did not create every expected draft.",
          );
        }

        await transaction.insert(dataChangeLogs).values(
          drafts.map((draft) => ({
            action: "draft_created" as const,
            actorEmail: input.actor.email,
            actorRole: input.actor.role,
            afterData: draft.payload,
            draftId: draft.id,
            entityKey: draft.entityKey,
            entityType: "market_metric" as const,
            importBatchId: input.batchId,
            reason: input.reason,
          })),
        );
        await transaction.insert(dataChangeLogs).values({
          action: "import_committed",
          actorEmail: input.actor.email,
          actorRole: input.actor.role,
          afterData: { createdDrafts: drafts.length },
          entityKey: input.batchId,
          entityType: "market_metric",
          importBatchId: input.batchId,
          reason: input.reason,
        });
        await transaction
          .update(marketImportBatches)
          .set({
            committedAt: now,
            confirmedBy: input.actor.email,
            status: "committed",
          })
          .where(
            and(
              eq(marketImportBatches.id, input.batchId),
              eq(marketImportBatches.createdBy, input.actor.email),
              eq(marketImportBatches.status, "previewed"),
            ),
          );

        return {
          createdDrafts: drafts.length,
          status: "committed" as const,
        };
      });
    },

    async commitDocumentUpload(input: {
      actor: AdminPrincipal;
      changeReason: string;
      prepared: PreparedKnowledgeDocumentUpload;
    }) {
      return database.transaction(async (transaction) => {
        await assertGovernanceWriteAllowed(transaction);
        const { metadata, outcome } = input.prepared;
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
          .returning();
        if (!source) {
          throw new Error("Failed to create the document source.");
        }

        const [createdDocument] = await transaction
          .insert(documents)
          .values({
            byteSize: input.prepared.byteSize,
            canonicalUrl: nullableString(metadata.canonicalUrl),
            contentSha256: input.prepared.contentSha256,
            dataSourceId: source.id,
            demoNotice: metadata.isDemo ? metadata.demoNotice : null,
            governancePublishedAt: null,
            governanceStatus: "draft",
            isDemo: metadata.isDemo,
            languageCode: metadata.languageCode,
            licenseCode: metadata.licenseCode,
            mimeType: input.prepared.mimeType,
            originalFilename: input.prepared.originalFilename,
            processedAt: now,
            processingError: outcome.processingError,
            processingStatus: outcome.processingStatus,
            publishedOn: metadata.publishedOn,
            redistributionAllowed: metadata.redistributionAllowed,
            storagePath: input.prepared.storagePath,
            title: metadata.title,
            type: metadata.documentType,
            validFrom: metadata.validFrom,
            validTo: metadata.validTo,
            verifiedAt: now,
          })
          .onConflictDoNothing({ target: documents.contentSha256 })
          .returning({
            archivedAt: documents.archivedAt,
            dataSourceId: documents.dataSourceId,
            governanceStatus: documents.governanceStatus,
            id: documents.id,
            processingStatus: documents.processingStatus,
          });

        let document = createdDocument
          ? { ...createdDocument, sourceArchivedAt: null as Date | null }
          : undefined;
        let prelockedVersions:
          | (typeof dataGovernanceDrafts.$inferSelect)[]
          | null = null;
        const created = Boolean(createdDocument);
        if (!document) {
          await transaction
            .delete(dataSources)
            .where(eq(dataSources.id, source.id));
          const [identity] = await transaction
            .select({ id: documents.id })
            .from(documents)
            .where(eq(documents.contentSha256, input.prepared.contentSha256))
            .limit(1);
          if (!identity) {
            throw new Error(
              "The duplicate document could not be loaded after a hash conflict.",
            );
          }
          prelockedVersions = await transaction
            .select()
            .from(dataGovernanceDrafts)
            .where(
              and(
                eq(dataGovernanceDrafts.entityType, "document"),
                eq(dataGovernanceDrafts.entityKey, identity.id),
              ),
            )
            .orderBy(asc(dataGovernanceDrafts.version))
            .for("update");
          [document] = await transaction
            .select({
              archivedAt: documents.archivedAt,
              dataSourceId: documents.dataSourceId,
              governanceStatus: documents.governanceStatus,
              id: documents.id,
              processingStatus: documents.processingStatus,
              sourceArchivedAt: dataSources.archivedAt,
            })
            .from(documents)
            .innerJoin(dataSources, eq(documents.dataSourceId, dataSources.id))
            .where(
              and(
                eq(documents.id, identity.id),
                eq(documents.contentSha256, input.prepared.contentSha256),
              ),
            )
            .limit(1)
            .for("update");
          if (!document) {
            throw new Error(
              "The duplicate document could not be loaded after a hash conflict.",
            );
          }
        } else if (outcome.processingStatus === "ready") {
          for (const batch of documentChunkInsertBatches(document.id, outcome.chunks)) {
            await transaction.insert(documentChunks).values(batch);
          }
        }

        const findActiveDraft = async () => {
          const rows = await transaction
            .select()
            .from(dataGovernanceDrafts)
            .where(
              and(
                eq(dataGovernanceDrafts.entityType, "document"),
                eq(dataGovernanceDrafts.entityKey, document!.id),
                inArray(dataGovernanceDrafts.workflowStatus, [
                  "draft",
                  "reviewed",
                ]),
                isNull(dataGovernanceDrafts.archivedAt),
              ),
            )
            .orderBy(desc(dataGovernanceDrafts.version))
            .limit(1);
          return rows[0] ?? null;
        };

        let draft = await findActiveDraft();
        let draftCreated = false;
        if (
          !draft &&
          document.governanceStatus === "draft" &&
          document.archivedAt === null &&
          document.sourceArchivedAt === null &&
          (document.processingStatus === "ready" ||
            document.processingStatus === "failed")
        ) {
          const versions =
            prelockedVersions ??
            (await transaction
              .select()
              .from(dataGovernanceDrafts)
              .where(
                and(
                  eq(dataGovernanceDrafts.entityType, "document"),
                  eq(dataGovernanceDrafts.entityKey, document.id),
                ),
              )
              .orderBy(asc(dataGovernanceDrafts.version))
              .for("update"));
          const nextVersion = (versions.at(-1)?.version ?? 0) + 1;
          if (versions.length !== 0 || nextVersion !== 1) {
            throw new GovernanceConflictError(
              "A document with governance history but no active draft cannot be repaired by duplicate upload.",
            );
          }
          const [insertedDraft] = await transaction
            .insert(dataGovernanceDrafts)
            .values({
              changeReason: input.changeReason,
              createdBy: input.actor.email,
              entityKey: document.id,
              entityType: "document",
              payload: { documentId: document.id },
              version: nextVersion,
            })
            .onConflictDoNothing()
            .returning();
          draft = insertedDraft ?? (await findActiveDraft());
          if (!draft) {
            throw new GovernanceConflictError(
              "A concurrent document draft could not be loaded.",
            );
          }
          if (insertedDraft) {
            draftCreated = true;
            const initialProvenance =
              await loadDocumentProvenanceExpectation(
                transaction,
                document.id,
              );
            let provenanceMetadata = created
              ? normalizeDocumentImportMetadataForProvenance(metadata)
              : null;
            if (!created && document.processingStatus === "ready") {
              provenanceMetadata = initialProvenance.metadata;
            }
            if (!created && document.processingStatus === "failed") {
              const auditRows = await transaction
                .select({
                  action: dataChangeLogs.action,
                  afterData: dataChangeLogs.afterData,
                  draftId: dataChangeLogs.draftId,
                  entityKey: dataChangeLogs.entityKey,
                  entityType: dataChangeLogs.entityType,
                })
                .from(dataChangeLogs)
                .innerJoin(
                  dataGovernanceDrafts,
                  eq(dataChangeLogs.draftId, dataGovernanceDrafts.id),
                )
                .where(
                  and(
                    eq(dataChangeLogs.entityType, "document"),
                    eq(dataChangeLogs.entityKey, document.id),
                    eq(dataGovernanceDrafts.entityType, "document"),
                    eq(dataGovernanceDrafts.entityKey, document.id),
                    inArray(dataChangeLogs.action, [
                      "draft_created",
                      "document_reprocessed",
                    ]),
                  ),
                )
                .orderBy(
                  desc(dataGovernanceDrafts.version),
                  desc(dataChangeLogs.createdAt),
                  desc(dataChangeLogs.id),
                );
              for (const audit of auditRows) {
                if (!audit.draftId) continue;
                const marker = {
                  afterData: audit.afterData,
                  draftId: audit.draftId,
                  entityKey: audit.entityKey,
                  entityType: audit.entityType,
                };
                const parsed =
                  audit.action === "document_reprocessed"
                    ? parseDocumentReprocessedAuditMarkerFor({
                        expectedDocumentId: document.id,
                        expectedDraftId: audit.draftId,
                        expectedChunkSetFingerprint:
                          initialProvenance.chunkSetFingerprint,
                        expectedProcessingStatus: "failed",
                        expectedSourceFingerprint:
                          initialProvenance.sourceFingerprint,
                        expectedSourceId: document.dataSourceId,
                        marker,
                      })
                    : parseDocumentDraftCreatedAuditMarkerFor({
                        expectedContentSha256:
                          input.prepared.contentSha256,
                        expectedDocumentId: document.id,
                        expectedDraftId: audit.draftId,
                        expectedChunkSetFingerprint:
                          initialProvenance.chunkSetFingerprint,
                        expectedProcessingStatus: "failed",
                        expectedSourceFingerprint:
                          initialProvenance.sourceFingerprint,
                        expectedSourceId: document.dataSourceId,
                        marker,
                      });
                if (parsed) {
                  provenanceMetadata = parsed.afterData.metadata;
                  break;
                }
              }
              if (!provenanceMetadata) {
                throw new GovernanceConflictError(
                  "The failed duplicate document has no trustworthy metadata provenance and cannot be repaired automatically.",
                );
              }
            }
            if (!provenanceMetadata) {
              throw new GovernanceConflictError(
                "Document metadata provenance could not be established.",
              );
            }
            const documentProvenance =
              document.processingStatus === "failed"
                ? await loadDocumentProvenanceExpectation(
                    transaction,
                    document.id,
                    provenanceMetadata,
                  )
                : initialProvenance;
            const draftCreatedAfterData =
              documentDraftCreatedAuditAfterDataSchema.parse({
                chunkSetFingerprint:
                  documentProvenance.chunkSetFingerprint,
                contentSha256: input.prepared.contentSha256,
                documentId: document.id,
                metadata: documentProvenance.metadata,
                processingStatus: document.processingStatus,
                provenanceVersion: 2,
                sourceFingerprint:
                  documentProvenance.sourceFingerprint,
                sourceId: document.dataSourceId,
              });
            await transaction.insert(dataChangeLogs).values({
              action: "draft_created",
              actorEmail: input.actor.email,
              actorRole: input.actor.role,
              afterData: draftCreatedAfterData,
              draftId: draft.id,
              entityKey: document.id,
              entityType: "document",
              reason: input.changeReason,
            });
          }
        }

        const [summary] = await transaction
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
          .where(eq(documents.id, document.id))
          .limit(1);
        if (!summary) {
          throw new Error("Committed document summary was not returned.");
        }

        return {
          created,
          documentId: document.id,
          draft,
          draftCreated,
          summary,
        };
      });
    },

    async createDraft(input: {
      actor: AdminPrincipal;
      changeReason: string;
      entityKey: string;
      entityType: GovernedEntityType;
      payload: GovernanceJson;
    }) {
      requireMatchingDraftEntityKey(input);

      return database.transaction(async (transaction) => {
        await assertGovernanceWriteAllowed(transaction);
        const existingVersions = await transaction
          .select({ version: dataGovernanceDrafts.version })
          .from(dataGovernanceDrafts)
          .where(
            and(
              eq(dataGovernanceDrafts.entityType, input.entityType),
              eq(dataGovernanceDrafts.entityKey, input.entityKey),
            ),
          )
          .orderBy(asc(dataGovernanceDrafts.version))
          .for("update");
        const nextVersion = (existingVersions.at(-1)?.version ?? 0) + 1;
        const documentProvenance =
          input.entityType === "document"
            ? await loadDocumentProvenanceExpectation(
                transaction,
                input.entityKey,
              )
            : null;
        if (documentProvenance && nextVersion !== 1) {
          throw new GovernanceConflictError(
            "Document revisions after v1 must be created by governed reprocessing.",
          );
        }
        let draft: typeof dataGovernanceDrafts.$inferSelect | undefined;
        try {
          [draft] = await transaction
            .insert(dataGovernanceDrafts)
            .values({
              changeReason: input.changeReason,
              createdBy: input.actor.email,
              entityKey: input.entityKey,
              entityType: input.entityType,
              payload: input.payload,
              version: nextVersion,
            })
            .returning();
        } catch (error: unknown) {
          if (hasPostgresErrorCode(error, "23505")) {
            throw new GovernanceConflictError(
              "Another draft revision was created concurrently; retry with the latest version.",
            );
          }
          throw error;
        }

        if (!draft) {
          throw new Error("Draft creation did not return a row.");
        }

        await transaction.insert(dataChangeLogs).values({
          action: "draft_created",
          actorEmail: input.actor.email,
          actorRole: input.actor.role,
          afterData: documentProvenance
            ? documentDraftCreatedAuditAfterDataSchema.parse({
                chunkSetFingerprint:
                  documentProvenance.chunkSetFingerprint,
                contentSha256:
                  documentProvenance.document.contentSha256,
                documentId: input.entityKey,
                metadata: documentProvenance.metadata,
                processingStatus:
                  documentProvenance.document.processingStatus,
                provenanceVersion: 2,
                sourceFingerprint:
                  documentProvenance.sourceFingerprint,
                sourceId: documentProvenance.source.id,
              })
            : input.payload,
          draftId: draft.id,
          entityKey: input.entityKey,
          entityType: input.entityType,
          reason: input.changeReason,
        });

        return draft;
      });
    },

    async createMarketImportPreview(input: {
      actor: AdminPrincipal;
      contentSha256: string;
      errors: ImportValidationError[];
      fileName: string;
      rows: ImportPreviewRow[];
    }) {
      return database.transaction(async (transaction) => {
        await assertGovernanceWriteAllowed(transaction);
        const rowNumbers = new Set(input.rows.map(({ rowNumber }) => rowNumber));
        const invalidRowNumbers = new Set(
          input.errors.map(({ rowNumber }) => rowNumber),
        );
        for (const rowNumber of invalidRowNumbers) {
          rowNumbers.add(rowNumber);
        }
        const validRows = input.rows.filter(
          ({ parsed, rowNumber }) =>
            parsed !== null && !invalidRowNumbers.has(rowNumber),
        ).length;
        const totalRows = rowNumbers.size;
        const invalidRows = totalRows - validRows;
        const [batch] = await transaction
          .insert(marketImportBatches)
          .values({
            contentSha256: input.contentSha256,
            createdBy: input.actor.email,
            invalidRows,
            originalFilename: input.fileName,
            previewRows: input.rows,
            totalRows,
            validRows,
            validationErrors: input.errors,
          })
          .returning();

        if (!batch) {
          throw new Error("Market import preview did not return a row.");
        }

        await transaction.insert(dataChangeLogs).values({
          action: "import_previewed",
          actorEmail: input.actor.email,
          actorRole: input.actor.role,
          afterData: {
            invalidRows,
            totalRows,
            validRows,
          },
          entityKey: batch.id,
          entityType: "market_metric",
          importBatchId: batch.id,
          reason: "CSV preview created; no market facts were written.",
        });

        return batch;
      });
    },

    async getDraft(draftId: string) {
      const [draft] = await database
        .select()
        .from(dataGovernanceDrafts)
        .where(eq(dataGovernanceDrafts.id, draftId))
        .limit(1);
      return draft ?? null;
    },

    async listAuditLogs(limit = 100) {
      return database
        .select()
        .from(dataChangeLogs)
        .orderBy(desc(dataChangeLogs.createdAt))
        .limit(limit);
    },

    async publishDraft(input: {
      actor: AdminPrincipal;
      draftId: string;
      reason: string;
    }) {
      return database.transaction(async (transaction) => {
        await assertGovernanceWriteAllowed(transaction);
        const [draftIdentity] = await transaction
          .select()
          .from(dataGovernanceDrafts)
          .where(eq(dataGovernanceDrafts.id, input.draftId))
          .limit(1);

        if (!draftIdentity) {
          throw new GovernanceConflictError(
            "Only an active reviewed draft can be published.",
          );
        }
        const entityDrafts = await transaction
          .select()
          .from(dataGovernanceDrafts)
          .where(
            and(
              eq(dataGovernanceDrafts.entityType, draftIdentity.entityType),
              eq(dataGovernanceDrafts.entityKey, draftIdentity.entityKey),
            ),
          )
          .orderBy(asc(dataGovernanceDrafts.version))
          .for("update");
        const draft = entityDrafts.find(({ id }) => id === input.draftId);

        if (
          !draft ||
          draft.workflowStatus !== "reviewed" ||
          draft.archivedAt
        ) {
          throw new GovernanceConflictError(
            "Only an active reviewed draft can be published.",
          );
        }
        if (
          entityDrafts.some(
            (candidate) =>
              candidate.id !== draft.id &&
              candidate.version >= draft.version &&
              candidate.workflowStatus === "published",
          )
        ) {
          throw new GovernanceConflictError(
            "The same or a newer revision has already been published; this draft cannot replace it.",
          );
        }
        if (
          draft.createdBy === input.actor.email &&
          input.actor.role !== "admin"
        ) {
          throw new GovernanceConflictError(
            "A draft creator cannot publish their own draft.",
          );
        }

        requireMatchingDraftEntityKey({
          entityKey: draft.entityKey,
          entityType: draft.entityType,
          payload: draft.payload,
        });
        const documentProvenance =
          draft.entityType === "document" && draft.version > 1
            ? (
                await requireCanonicalDocumentProvenance(
                  transaction,
                  draft,
                )
              ).provenance
            : null;

        type FormalEntityState =
          | "active"
          | "archived"
          | "missing"
          | "unpublished";
        const rowState = (
          row:
            | {
                archivedAt: Date | null;
                sourceArchivedAt?: Date | null;
              }
            | undefined,
        ): FormalEntityState =>
          !row
            ? "missing"
            : row.archivedAt || row.sourceArchivedAt
              ? "archived"
              : "active";
        let formalEntityState: FormalEntityState;

        if (draft.entityType === "country") {
          const [row] = await transaction
            .select({
              archivedAt: countries.archivedAt,
              sourceArchivedAt: dataSources.archivedAt,
            })
            .from(countries)
            .innerJoin(dataSources, eq(countries.dataSourceId, dataSources.id))
            .where(eq(countries.iso3, draft.entityKey))
            .limit(1)
            .for("update");
          formalEntityState = rowState(row);
        } else if (draft.entityType === "data_source") {
          const [row] = await transaction
            .select({ archivedAt: dataSources.archivedAt })
            .from(dataSources)
            .where(eq(dataSources.id, draft.entityKey))
            .limit(1)
            .for("update");
          formalEntityState = rowState(row);
        } else if (draft.entityType === "jurisdiction") {
          const [row] = await transaction
            .select({
              archivedAt: jurisdictions.archivedAt,
              sourceArchivedAt: dataSources.archivedAt,
            })
            .from(jurisdictions)
            .innerJoin(
              dataSources,
              eq(jurisdictions.dataSourceId, dataSources.id),
            )
            .where(eq(jurisdictions.id, draft.entityKey))
            .limit(1)
            .for("update");
          formalEntityState = rowState(row);
        } else if (draft.entityType === "market_metric") {
          const [row] = await transaction
            .select({
              archivedAt: marketMetrics.archivedAt,
              sourceArchivedAt: dataSources.archivedAt,
            })
            .from(marketMetrics)
            .innerJoin(
              dataSources,
              eq(marketMetrics.dataSourceId, dataSources.id),
            )
            .where(eq(marketMetrics.id, draft.entityKey))
            .limit(1)
            .for("update");
          formalEntityState = rowState(row);
        } else if (draft.entityType === "product") {
          const [row] = await transaction
            .select({
              archivedAt: products.archivedAt,
              sourceArchivedAt: dataSources.archivedAt,
            })
            .from(products)
            .innerJoin(dataSources, eq(products.dataSourceId, dataSources.id))
            .where(eq(products.id, draft.entityKey))
            .limit(1)
            .for("update");
          formalEntityState = rowState(row);
        } else if (draft.entityType === "product_certification") {
          const [row] = await transaction
            .select({
              archivedAt: productCertifications.archivedAt,
              sourceArchivedAt: dataSources.archivedAt,
            })
            .from(productCertifications)
            .innerJoin(
              dataSources,
              eq(productCertifications.dataSourceId, dataSources.id),
            )
            .where(eq(productCertifications.id, draft.entityKey))
            .limit(1)
            .for("update");
          formalEntityState = rowState(row);
        } else if (draft.entityType === "regulation") {
          const [row] = await transaction
            .select({
              archivedAt: regulations.archivedAt,
              sourceArchivedAt: dataSources.archivedAt,
            })
            .from(regulations)
            .innerJoin(
              dataSources,
              eq(regulations.dataSourceId, dataSources.id),
            )
            .where(eq(regulations.id, draft.entityKey))
            .limit(1)
            .for("update");
          formalEntityState = rowState(row);
        } else {
          const [row] = await transaction
            .select({
              archivedAt: documents.archivedAt,
              dataSourceId: documents.dataSourceId,
              governanceStatus: documents.governanceStatus,
              sourceArchivedAt: dataSources.archivedAt,
            })
            .from(documents)
            .innerJoin(dataSources, eq(documents.dataSourceId, dataSources.id))
            .where(eq(documents.id, draft.entityKey))
            .limit(1)
            .for("update");
          formalEntityState = !row
            ? "missing"
            : row.archivedAt || row.sourceArchivedAt
              ? "archived"
              : row.governanceStatus === "published"
                ? "active"
                : "unpublished";
        }

        const hasLowerPublishedBaseline = entityDrafts.some(
          (candidate) =>
            candidate.version < draft.version &&
            candidate.workflowStatus === "published" &&
            !candidate.archivedAt,
        );
        let hasReprocessingAuditMarker = false;
        if (
          draft.version > 1 &&
          draft.entityType === "document" &&
          formalEntityState === "unpublished" &&
          !hasLowerPublishedBaseline
        ) {
          const parsedMarker =
            documentProvenance?.action === "document_reprocessed"
              ? documentProvenance.marker
              : null;
          const supersededDraftId =
            parsedMarker?.afterData.supersededDraftIds[0];
          hasReprocessingAuditMarker = Boolean(
            supersededDraftId &&
              entityDrafts.some(
                (candidate) =>
                  candidate.id === supersededDraftId &&
                  candidate.entityType === "document" &&
                  candidate.entityKey === draft.entityKey &&
                  candidate.version === draft.version - 1 &&
                  candidate.archivedAt !== null &&
                  (candidate.workflowStatus === "draft" ||
                    candidate.workflowStatus === "reviewed"),
              ),
          );
        }
        const isReprocessedDocumentFirstPublication =
          draft.entityType === "document" &&
          formalEntityState === "unpublished" &&
          !hasLowerPublishedBaseline &&
          hasReprocessingAuditMarker &&
          !entityDrafts.some(
            (candidate) =>
              candidate.version < draft.version &&
              candidate.archivedAt === null,
          );

        if (draft.version === 1 || isReprocessedDocumentFirstPublication) {
          if (formalEntityState === "archived") {
            throw new GovernanceConflictError(
              "A first governance revision cannot revive an archived formal entity.",
            );
          }
        } else {
          if (!hasLowerPublishedBaseline) {
            throw new GovernanceConflictError(
              `Revision v${draft.version} requires a lower published governance baseline.`,
            );
          }
          if (formalEntityState !== "active") {
            throw new GovernanceConflictError(
              `Revision v${draft.version} requires an active formal entity; missing, archived, or unpublished entities cannot be recreated by an update.`,
            );
          }
        }
        if (draft.entityType === "document" && draft.version === 1) {
          await requireCanonicalDocumentProvenance(transaction, draft);
        }

        const now = new Date();
        let beforeData: GovernanceJson | null = null;
        let afterData: GovernanceJson;
        const requirePublishableSources = async (
          references: Array<{
            isDemo: boolean;
            label: string;
            sourceId: string;
          }>,
        ) => {
          const sourceIds = references.map(({ sourceId }) => sourceId);
          const uniqueSourceIds = Array.from(new Set(sourceIds));
          const activeSources = await transaction
            .select({
              id: dataSources.id,
              isDemo: dataSources.isDemo,
              sourceType: dataSources.sourceType,
            })
            .from(dataSources)
            .where(
              and(
                inArray(dataSources.id, uniqueSourceIds),
                isNull(dataSources.archivedAt),
              ),
            )
            .for("update");
          const activeSourceIds = new Set(
            activeSources.map(({ id }) => id),
          );
          const unavailableSourceIds = uniqueSourceIds.filter(
            (id) => !activeSourceIds.has(id),
          );

          if (unavailableSourceIds.length > 0) {
            throw new GovernanceConflictError(
              `Referenced data sources are missing or archived: ${unavailableSourceIds.join(", ")}.`,
            );
          }

          const sourceDemoById = new Map(
            activeSources.map(({ id, isDemo }) => [id, isDemo]),
          );
          const sourceTypeById = new Map(
            activeSources.map(({ id, sourceType }) => [id, sourceType]),
          );
          const misclassifiedFacts = Array.from(
            new Set(
              references
                .filter(
                  ({ isDemo, sourceId }) =>
                    !isDemo && sourceDemoById.get(sourceId) === true,
                )
                .map(({ label }) => label),
            ),
          );
          if (misclassifiedFacts.length > 0) {
            throw new GovernanceConflictError(
              `Non-demo facts cannot reference demo sources: ${misclassifiedFacts.join(", ")}.`,
            );
          }

          const marketRegulationSourceMismatch = references.some(
            ({ label, sourceId }) =>
              label === "market metric" &&
              sourceTypeById.get(sourceId) === "official-regulation",
          );
          if (marketRegulationSourceMismatch) {
            throw new GovernanceConflictError(
              "Market metrics cannot reference official-regulation sources; register the market dataset as an appropriate market source first.",
            );
          }
        };
        const requireActiveCountries = async (countryIso3s: string[]) => {
          const uniqueCountryIso3s = Array.from(new Set(countryIso3s));
          if (uniqueCountryIso3s.length === 0) {
            return new Map<string, boolean>();
          }
          const activeCountries = await transaction
            .select({ id: countries.iso3, isDemo: countries.isDemo })
            .from(countries)
            .innerJoin(
              dataSources,
              eq(countries.dataSourceId, dataSources.id),
            )
            .where(
              and(
                inArray(countries.iso3, uniqueCountryIso3s),
                isNull(countries.archivedAt),
                isNull(dataSources.archivedAt),
              ),
            )
            .for("update");
          const activeCountryIds = new Set(
            activeCountries.map(({ id }) => id),
          );
          const unavailableCountryIds = uniqueCountryIso3s.filter(
            (id) => !activeCountryIds.has(id),
          );

          if (unavailableCountryIds.length > 0) {
            throw new GovernanceConflictError(
              `Referenced countries or their sources are missing or archived: ${unavailableCountryIds.join(", ")}.`,
            );
          }
          return new Map(
            activeCountries.map(({ id, isDemo }) => [id, isDemo]),
          );
        };
        const requireActiveJurisdictions = async (ids: string[]) => {
          const uniqueIds = Array.from(new Set(ids));
          const activeRows = await transaction
            .select({ id: jurisdictions.id, isDemo: jurisdictions.isDemo })
            .from(jurisdictions)
            .innerJoin(
              dataSources,
              eq(jurisdictions.dataSourceId, dataSources.id),
            )
            .where(
              and(
                inArray(jurisdictions.id, uniqueIds),
                isNull(jurisdictions.archivedAt),
                isNull(dataSources.archivedAt),
              ),
            )
            .for("update");
          const activeIds = new Set(activeRows.map(({ id }) => id));
          const unavailableIds = uniqueIds.filter(
            (id) => !activeIds.has(id),
          );

          if (unavailableIds.length > 0) {
            throw new GovernanceConflictError(
              `Referenced jurisdictions or their sources are missing or archived: ${unavailableIds.join(", ")}.`,
            );
          }
          return new Map(
            activeRows.map(({ id, isDemo }) => [id, isDemo]),
          );
        };
        const requireActiveProducts = async (ids: string[]) => {
          const uniqueIds = Array.from(new Set(ids));
          const activeRows = await transaction
            .select({ id: products.id, isDemo: products.isDemo })
            .from(products)
            .innerJoin(
              dataSources,
              eq(products.dataSourceId, dataSources.id),
            )
            .where(
              and(
                inArray(products.id, uniqueIds),
                isNull(products.archivedAt),
                isNull(dataSources.archivedAt),
              ),
            )
            .for("update");
          const activeIds = new Set(activeRows.map(({ id }) => id));
          const unavailableIds = uniqueIds.filter(
            (id) => !activeIds.has(id),
          );

          if (unavailableIds.length > 0) {
            throw new GovernanceConflictError(
              `Referenced products or their sources are missing or archived: ${unavailableIds.join(", ")}.`,
            );
          }
          return new Map(
            activeRows.map(({ id, isDemo }) => [id, isDemo]),
          );
        };
        const requireActiveRegulations = async (ids: string[]) => {
          const uniqueIds = Array.from(new Set(ids));
          const activeRows = await transaction
            .select({ id: regulations.id, isDemo: regulations.isDemo })
            .from(regulations)
            .innerJoin(
              dataSources,
              eq(regulations.dataSourceId, dataSources.id),
            )
            .where(
              and(
                inArray(regulations.id, uniqueIds),
                isNull(regulations.archivedAt),
                isNull(dataSources.archivedAt),
              ),
            )
            .for("update");
          const activeIds = new Set(activeRows.map(({ id }) => id));
          const unavailableIds = uniqueIds.filter(
            (id) => !activeIds.has(id),
          );

          if (unavailableIds.length > 0) {
            throw new GovernanceConflictError(
              `Referenced regulations or their sources are missing or archived: ${unavailableIds.join(", ")}.`,
            );
          }
          return new Map(
            activeRows.map(({ id, isDemo }) => [id, isDemo]),
          );
        };
        const requireCompatibleParentClassifications = (
          parentType: string,
          parentDemoById: Map<string, boolean>,
          references: Array<{
            childIsDemo: boolean;
            childLabel: string;
            parentId: string;
          }>,
        ) => {
          const incompatibleChildren = Array.from(
            new Set(
              references
                .filter(
                  ({ childIsDemo, parentId }) =>
                    !childIsDemo && parentDemoById.get(parentId) === true,
                )
                .map(({ childLabel }) => childLabel),
            ),
          );
          if (incompatibleChildren.length > 0) {
            throw new GovernanceConflictError(
              `Non-demo facts cannot reference demo ${parentType}: ${incompatibleChildren.join(", ")}.`,
            );
          }
        };
        const hasRows = async <TRow>(
          query: PromiseLike<TRow[]>,
        ): Promise<boolean> => (await query).length > 0;
        const requireNoNonDemoDependents = (
          parentLabel: string,
          dependentLabels: string[],
        ) => {
          if (dependentLabels.length > 0) {
            throw new GovernanceConflictError(
              `Demo ${parentLabel} cannot have active non-demo dependents: ${dependentLabels.join(", ")}.`,
            );
          }
        };
        const requireDemoCountryHasNoNonDemoDependents = async (
          countryIso3: string,
        ) => {
          const dependentLabels: string[] = [];
          if (
            await hasRows(
              transaction
                .select({ id: jurisdictions.id })
                .from(jurisdictions)
                .where(
                  and(
                    eq(jurisdictions.countryIso3, countryIso3),
                    eq(jurisdictions.isDemo, false),
                    isNull(jurisdictions.archivedAt),
                  ),
                )
                .limit(1),
            )
          ) {
            dependentLabels.push("jurisdictions");
          }
          if (
            await hasRows(
              transaction
                .select({ id: countryJurisdictions.jurisdictionId })
                .from(countryJurisdictions)
                .where(
                  and(
                    eq(countryJurisdictions.countryIso3, countryIso3),
                    eq(countryJurisdictions.isDemo, false),
                    isNull(countryJurisdictions.archivedAt),
                  ),
                )
                .limit(1),
            )
          ) {
            dependentLabels.push("jurisdiction memberships");
          }
          if (
            await hasRows(
              transaction
                .select({ id: marketMetrics.id })
                .from(marketMetrics)
                .where(
                  and(
                    eq(marketMetrics.countryIso3, countryIso3),
                    eq(marketMetrics.isDemo, false),
                    isNull(marketMetrics.archivedAt),
                  ),
                )
                .limit(1),
            )
          ) {
            dependentLabels.push("market metrics");
          }
          requireNoNonDemoDependents("country", dependentLabels);
        };
        const requireDemoJurisdictionHasNoNonDemoDependents = async (
          jurisdictionId: string,
        ) => {
          const dependentLabels = (await hasRows(
            transaction
              .select({ id: regulations.id })
              .from(regulations)
              .where(
                and(
                  eq(regulations.jurisdictionId, jurisdictionId),
                  eq(regulations.isDemo, false),
                  isNull(regulations.archivedAt),
                ),
              )
              .limit(1),
          ))
            ? ["regulations"]
            : [];
          requireNoNonDemoDependents("jurisdiction", dependentLabels);
        };
        const requireDemoProductHasNoNonDemoDependents = async (
          productId: string,
        ) => {
          const dependentLabels = (await hasRows(
            transaction
              .select({ id: productCertifications.id })
              .from(productCertifications)
              .where(
                and(
                  eq(productCertifications.productId, productId),
                  eq(productCertifications.isDemo, false),
                  isNull(productCertifications.archivedAt),
                ),
              )
              .limit(1),
          ))
            ? ["product certifications"]
            : [];
          requireNoNonDemoDependents("product", dependentLabels);
        };
        const requireDemoRegulationHasNoNonDemoDependents = async (
          regulationId: string,
        ) => {
          const dependentLabels = (await hasRows(
            transaction
              .select({ id: productCertifications.id })
              .from(productCertifications)
              .where(
                and(
                  eq(productCertifications.regulationId, regulationId),
                  eq(productCertifications.isDemo, false),
                  isNull(productCertifications.archivedAt),
                ),
              )
              .limit(1),
          ))
            ? ["product certifications"]
            : [];
          requireNoNonDemoDependents("regulation", dependentLabels);
        };

        if (draft.entityType === "country") {
          const payload = countryDraftPayloadSchema.parse(draft.payload);
          await requirePublishableSources([
            {
              isDemo: payload.isDemo,
              label: "country",
              sourceId: payload.dataSourceId,
            },
          ]);
          const [before] = await transaction
            .select()
            .from(countries)
            .where(eq(countries.iso3, payload.iso3))
            .limit(1)
            .for("update");
          if (payload.isDemo) {
            await requireDemoCountryHasNoNonDemoDependents(payload.iso3);
          }
          beforeData = before ?? null;
          await transaction
            .insert(countries)
            .values({
              ...payload,
              archivedAt: null,
              nameLocal: payload.nameLocal ?? null,
              regionCode: payload.regionCode ?? null,
              subregionCode: payload.subregionCode ?? null,
              verifiedAt: new Date(payload.verifiedAt),
            })
            .onConflictDoUpdate({
              set: {
                archivedAt: null,
                dataCoverageStatus: payload.dataCoverageStatus,
                dataSourceId: payload.dataSourceId,
                isDemo: payload.isDemo,
                iso2: payload.iso2,
                nameEn: payload.nameEn,
                nameLocal: payload.nameLocal ?? null,
                regionCode: payload.regionCode ?? null,
                subregionCode: payload.subregionCode ?? null,
                updatedAt: now,
                verifiedAt: new Date(payload.verifiedAt),
              },
              target: countries.iso3,
            });
          afterData = payload;
        } else if (draft.entityType === "data_source") {
          const payload = dataSourceDraftPayloadSchema.parse(draft.payload);
          const id = requiredId(payload.id, draft.entityType);
          const { beforeData: sourceBeforeData, persistedSource } =
            await sourceWrites.applyReviewedDraft(transaction, {
              now,
              payload,
              sourceId: id,
            });
          beforeData = sourceBeforeData;
          afterData = {
            ...payload,
            id,
            verifiedAt: persistedSource.verifiedAt,
          };
        } else if (draft.entityType === "regulation") {
          const payload = regulationDraftPayloadSchema.parse(draft.payload);
          await requirePublishableSources([
            {
              isDemo: payload.isDemo,
              label: "regulation",
              sourceId: payload.dataSourceId,
            },
            ...payload.limits.map((limit, index) => ({
              isDemo: limit.isDemo,
              label: `regulation limit ${index + 1}`,
              sourceId: limit.dataSourceId,
            })),
          ]);
          const jurisdictionDemoById = await requireActiveJurisdictions([
            payload.jurisdictionId,
          ]);
          requireCompatibleParentClassifications(
            "jurisdictions",
            jurisdictionDemoById,
            [
              {
                childIsDemo: payload.isDemo,
                childLabel: "regulation",
                parentId: payload.jurisdictionId,
              },
            ],
          );
          const id = requiredId(payload.id, draft.entityType);
          const [before] = await transaction
            .select()
            .from(regulations)
            .where(eq(regulations.id, id))
            .limit(1)
            .for("update");
          if (payload.isDemo) {
            requireNoNonDemoDependents(
              "regulation",
              payload.limits.some((limit) => !limit.isDemo)
                ? ["regulation limits"]
                : [],
            );
            await requireDemoRegulationHasNoNonDemoDependents(id);
          }
          const beforeLimits = before
            ? await transaction
                .select()
                .from(regulationLimits)
                .where(
                  and(
                    eq(regulationLimits.regulationId, id),
                    isNull(regulationLimits.archivedAt),
                  ),
                )
            : [];
          beforeData = before
            ? { limits: beforeLimits, regulation: before }
            : null;
          await transaction
            .insert(regulations)
            .values({
              ...payload,
              adoptedOn: payload.adoptedOn ?? null,
              archivedAt: null,
              citationCode: payload.citationCode ?? null,
              effectiveFrom: payload.effectiveFrom ?? null,
              effectiveTo: payload.effectiveTo ?? null,
              id,
              proposedOn: payload.proposedOn ?? null,
              summary: payload.summary ?? null,
              verifiedAt: new Date(payload.verifiedAt),
            })
            .onConflictDoUpdate({
              set: {
                adoptedOn: payload.adoptedOn ?? null,
                archivedAt: null,
                canonicalName: payload.canonicalName,
                citationCode: payload.citationCode ?? null,
                dataSourceId: payload.dataSourceId,
                effectiveFrom: payload.effectiveFrom ?? null,
                effectiveTo: payload.effectiveTo ?? null,
                isDemo: payload.isDemo,
                jurisdictionId: payload.jurisdictionId,
                proposedOn: payload.proposedOn ?? null,
                status: payload.status,
                summary: payload.summary ?? null,
                updatedAt: now,
                verifiedAt: new Date(payload.verifiedAt),
              },
              target: regulations.id,
            });
          await transaction
            .update(regulationLimits)
            .set({ archivedAt: now, updatedAt: now })
            .where(
              and(
                eq(regulationLimits.regulationId, id),
                isNull(regulationLimits.archivedAt),
              ),
            );
          if (payload.limits.length > 0) {
            await transaction.insert(regulationLimits).values(
              payload.limits.map((limit) => ({
                ...limit,
                dataSourceId: limit.dataSourceId,
                id: requiredId(limit.id, "regulation_limit"),
                limitValue: limit.limitValue,
                measurementBasis: limit.measurementBasis ?? null,
                powerMaxKw: limit.powerMaxKw ?? null,
                powerMinKw: limit.powerMinKw ?? null,
                regulationId: id,
                testCycleCode: limit.testCycleCode ?? null,
                validTo: limit.validTo ?? null,
                verifiedAt: new Date(limit.verifiedAt),
              })),
            );
          }
          afterData = { ...payload, id };
        } else if (draft.entityType === "product") {
          const payload = productDraftPayloadSchema.parse(draft.payload);
          await requirePublishableSources([
            {
              isDemo: payload.isDemo,
              label: "product",
              sourceId: payload.dataSourceId,
            },
          ]);
          const id = requiredId(payload.id, draft.entityType);
          const [before] = await transaction
            .select()
            .from(products)
            .where(eq(products.id, id))
            .limit(1)
            .for("update");
          if (payload.isDemo) {
            await requireDemoProductHasNoNonDemoDependents(id);
          }
          beforeData = before ?? null;
          await transaction
            .insert(products)
            .values({
              ...payload,
              archivedAt: null,
              availableFrom: payload.availableFrom ?? null,
              availableTo: payload.availableTo ?? null,
              description: payload.description ?? null,
              id,
              verifiedAt: new Date(payload.verifiedAt),
            })
            .onConflictDoUpdate({
              set: {
                applicationScopes: payload.applicationScopes,
                archivedAt: null,
                availableFrom: payload.availableFrom ?? null,
                availableTo: payload.availableTo ?? null,
                dataSourceId: payload.dataSourceId,
                description: payload.description ?? null,
                isDemo: payload.isDemo,
                modelCode: payload.modelCode,
                name: payload.name,
                parameters: payload.parameters,
                powerMaxKw: payload.powerMaxKw,
                powerMinKw: payload.powerMinKw,
                specificationVersion: payload.specificationVersion,
                updatedAt: now,
                verifiedAt: new Date(payload.verifiedAt),
              },
              target: products.id,
            });
          afterData = { ...payload, id };
        } else if (draft.entityType === "product_certification") {
          const payload =
            productCertificationDraftPayloadSchema.parse(draft.payload);
          await requirePublishableSources([
            {
              isDemo: payload.isDemo,
              label: "product certification",
              sourceId: payload.dataSourceId,
            },
          ]);
          const productDemoById = await requireActiveProducts([
            payload.productId,
          ]);
          requireCompatibleParentClassifications(
            "products",
            productDemoById,
            [
              {
                childIsDemo: payload.isDemo,
                childLabel: "product certification",
                parentId: payload.productId,
              },
            ],
          );
          const regulationDemoById = await requireActiveRegulations([
            payload.regulationId,
          ]);
          requireCompatibleParentClassifications(
            "regulations",
            regulationDemoById,
            [
              {
                childIsDemo: payload.isDemo,
                childLabel: "product certification",
                parentId: payload.regulationId,
              },
            ],
          );
          const id = requiredId(payload.id, draft.entityType);
          const [before] = await transaction
            .select()
            .from(productCertifications)
            .where(eq(productCertifications.id, id))
            .limit(1)
            .for("update");
          beforeData = before ?? null;
          await transaction
            .insert(productCertifications)
            .values({
              ...payload,
              archivedAt: null,
              certificateNumber: payload.certificateNumber ?? null,
              id,
              powerMaxKw: payload.powerMaxKw ?? null,
              powerMinKw: payload.powerMinKw ?? null,
              validFrom: payload.validFrom ?? null,
              validTo: payload.validTo ?? null,
              verifiedAt: new Date(payload.verifiedAt),
            })
            .onConflictDoUpdate({
              set: {
                applicationScope: payload.applicationScope,
                archivedAt: null,
                certificateNumber: payload.certificateNumber ?? null,
                dataSourceId: payload.dataSourceId,
                isDemo: payload.isDemo,
                powerMaxKw: payload.powerMaxKw ?? null,
                powerMinKw: payload.powerMinKw ?? null,
                productId: payload.productId,
                regulationId: payload.regulationId,
                status: payload.status,
                updatedAt: now,
                validFrom: payload.validFrom ?? null,
                validTo: payload.validTo ?? null,
                verifiedAt: new Date(payload.verifiedAt),
              },
              target: productCertifications.id,
            });
          afterData = { ...payload, id };
        } else if (draft.entityType === "market_metric") {
          const payload = marketMetricDraftPayloadSchema.parse(draft.payload);
          await requirePublishableSources([
            {
              isDemo: payload.isDemo,
              label: "market metric",
              sourceId: payload.dataSourceId,
            },
          ]);
          const countryDemoById = await requireActiveCountries([
            payload.countryIso3,
          ]);
          requireCompatibleParentClassifications(
            "countries",
            countryDemoById,
            [
              {
                childIsDemo: payload.isDemo,
                childLabel: "market metric",
                parentId: payload.countryIso3,
              },
            ],
          );
          const id = requiredId(payload.id, draft.entityType);
          const scopeFilter = payload.applicationScope
            ? eq(marketMetrics.applicationScope, payload.applicationScope)
            : isNull(marketMetrics.applicationScope);
          const [sameNaturalKey] = await transaction
            .select({
              archivedAt: marketMetrics.archivedAt,
              id: marketMetrics.id,
            })
            .from(marketMetrics)
            .where(
              and(
                eq(marketMetrics.countryIso3, payload.countryIso3),
                eq(marketMetrics.metricCode, payload.metricCode),
                scopeFilter,
                eq(marketMetrics.periodStart, payload.periodStart),
                eq(marketMetrics.periodEnd, payload.periodEnd),
                eq(marketMetrics.dataSourceId, payload.dataSourceId),
              ),
            )
            .limit(1);
          if (sameNaturalKey && sameNaturalKey.id !== id) {
            const action = sameNaturalKey.archivedAt
              ? "revise and unarchive"
              : "revise";
            throw new GovernanceConflictError(
              `Market observation natural key already belongs to entity ${sameNaturalKey.id}; ${action} that entity instead of publishing a duplicate.`,
            );
          }
          const [before] = await transaction
            .select()
            .from(marketMetrics)
            .where(eq(marketMetrics.id, id))
            .limit(1)
            .for("update");
          beforeData = before ?? null;
          try {
            await transaction
              .insert(marketMetrics)
              .values({
                ...payload,
                applicationScope: payload.applicationScope ?? null,
                archivedAt: null,
                currencyCode: payload.currencyCode ?? null,
                id,
                publishedOn: payload.publishedOn ?? null,
                valueNumeric: payload.valueNumeric,
                verifiedAt: new Date(payload.verifiedAt),
              })
              .onConflictDoUpdate({
                set: {
                  applicationScope: payload.applicationScope ?? null,
                  archivedAt: null,
                  countryIso3: payload.countryIso3,
                  currencyCode: payload.currencyCode ?? null,
                  dataSourceId: payload.dataSourceId,
                  definition: payload.definition,
                  isDemo: payload.isDemo,
                  methodologyVersion: payload.methodologyVersion,
                  metricCode: payload.metricCode,
                  metricName: payload.metricName,
                  periodEnd: payload.periodEnd,
                  periodStart: payload.periodStart,
                  publishedOn: payload.publishedOn ?? null,
                  unitCode: payload.unitCode,
                  updatedAt: now,
                  valueNumeric: payload.valueNumeric,
                  verifiedAt: new Date(payload.verifiedAt),
                },
                target: marketMetrics.id,
              });
          } catch (error: unknown) {
            if (hasPostgresErrorCode(error, "23505")) {
              throw new GovernanceConflictError(
                "Market observation conflicts with an existing natural key; revise the existing entity instead of publishing a duplicate.",
              );
            }
            throw error;
          }
          afterData = { ...payload, id };
        } else if (draft.entityType === "jurisdiction") {
          const payload = jurisdictionDraftPayloadSchema.parse(draft.payload);
          await requirePublishableSources([
            {
              isDemo: payload.isDemo,
              label: "jurisdiction",
              sourceId: payload.dataSourceId,
            },
            ...payload.memberships.map((membership, index) => ({
              isDemo: membership.isDemo,
              label: `jurisdiction membership ${index + 1}`,
              sourceId: membership.dataSourceId,
            })),
          ]);
          const countryReferences = [
            ...(payload.countryIso3
              ? [
                  {
                    childIsDemo: payload.isDemo,
                    childLabel: "jurisdiction",
                    parentId: payload.countryIso3,
                  },
                ]
              : []),
            ...payload.memberships.map((membership, index) => ({
              childIsDemo: membership.isDemo,
              childLabel: `jurisdiction membership ${index + 1}`,
              parentId: membership.countryIso3,
            })),
          ];
          const countryDemoById = await requireActiveCountries([
            ...(payload.countryIso3 ? [payload.countryIso3] : []),
            ...payload.memberships.map(({ countryIso3 }) => countryIso3),
          ]);
          requireCompatibleParentClassifications(
            "countries",
            countryDemoById,
            countryReferences,
          );
          const id = requiredId(payload.id, draft.entityType);
          const [before] = await transaction
            .select()
            .from(jurisdictions)
            .where(eq(jurisdictions.id, id))
            .limit(1)
            .for("update");
          if (payload.isDemo) {
            requireNoNonDemoDependents(
              "jurisdiction",
              payload.memberships.some((membership) => !membership.isDemo)
                ? ["jurisdiction memberships"]
                : [],
            );
            await requireDemoJurisdictionHasNoNonDemoDependents(id);
          }
          await transaction
            .insert(jurisdictions)
            .values({
              ...payload,
              archivedAt: null,
              countryIso3: payload.countryIso3 ?? null,
              id,
              websiteUrl: payload.websiteUrl ?? null,
              verifiedAt: new Date(payload.verifiedAt),
            })
            .onConflictDoUpdate({
              set: {
                archivedAt: null,
                code: payload.code,
                countryIso3: payload.countryIso3 ?? null,
                dataSourceId: payload.dataSourceId,
                isDemo: payload.isDemo,
                name: payload.name,
                type: payload.type,
                updatedAt: now,
                verifiedAt: new Date(payload.verifiedAt),
                websiteUrl: payload.websiteUrl ?? null,
              },
              target: jurisdictions.id,
            });
          const beforeMemberships = await transaction
            .select()
            .from(countryJurisdictions)
            .where(
              and(
                eq(countryJurisdictions.jurisdictionId, id),
                isNull(countryJurisdictions.archivedAt),
              ),
            )
            .for("update");
          assertMembershipPeriodsDoNotOverlap(payload.memberships);
          beforeData = before
            ? { jurisdiction: before, memberships: beforeMemberships }
            : null;
          // 国家成员关系更新：同一国家可有多个互不重叠的有效期，
          // payload 中不存在的活跃区间归档，精确区间键重发布保持幂等。
          const memberships = payload.memberships;
          const payloadMembershipKeys = new Set(
            memberships.map(
              (membership) =>
                `${membership.countryIso3}\u0000${membership.validFrom}`,
            ),
          );
          const toArchive = beforeMemberships
            .filter(
              (membership) =>
                !payloadMembershipKeys.has(
                  `${membership.countryIso3}\u0000${membership.validFrom}`,
                ),
            );
          if (toArchive.length > 0) {
            await transaction
              .update(countryJurisdictions)
              .set({ archivedAt: now, updatedAt: now })
              .where(
                and(
                  eq(countryJurisdictions.jurisdictionId, id),
                  isNull(countryJurisdictions.archivedAt),
                  or(
                    ...toArchive.map((membership) =>
                      and(
                        eq(
                          countryJurisdictions.countryIso3,
                          membership.countryIso3,
                        ),
                        eq(
                          countryJurisdictions.validFrom,
                          membership.validFrom,
                        ),
                      ),
                    ),
                  ),
                ),
              );
          }
          if (memberships.length > 0) {
            await transaction
              .insert(countryJurisdictions)
              .values(
                memberships.map((membership) => ({
                  countryIso3: membership.countryIso3,
                  dataSourceId: membership.dataSourceId,
                  isDemo: membership.isDemo,
                  jurisdictionId: id,
                  validFrom: membership.validFrom,
                  validTo: membership.validTo ?? null,
                  verifiedAt: new Date(membership.verifiedAt),
                })),
              )
              .onConflictDoUpdate({
                set: {
                  archivedAt: null,
                  dataSourceId: sql`excluded.data_source_id`,
                  isDemo: sql`excluded.is_demo`,
                  updatedAt: now,
                  validTo: sql`excluded.valid_to`,
                  verifiedAt: sql`excluded.verified_at`,
                },
                target: [
                  countryJurisdictions.countryIso3,
                  countryJurisdictions.jurisdictionId,
                  countryJurisdictions.validFrom,
                ],
              });
          }
          afterData = { ...payload, id };
        } else {
          const payload = documentDraftPayloadSchema.parse(draft.payload);
          const [before] = await transaction
            .select()
            .from(documents)
            .where(
              and(
                eq(documents.id, payload.documentId),
                isNull(documents.archivedAt),
              ),
            )
            .limit(1)
            .for("update");
          if (
            !before ||
            before.processingStatus !== "ready" ||
            before.governanceStatus !== "reviewed"
          ) {
            throw new GovernanceConflictError(
              "Only a reviewed, successfully processed document can be published.",
            );
          }
          await requirePublishableSources([
            {
              isDemo: before.isDemo,
              label: "document",
              sourceId: before.dataSourceId,
            },
          ]);
          const chunkParents = await transaction
            .select({
              countryIso3: documentChunks.countryIso3,
              isDemo: documentChunks.isDemo,
              jurisdictionId: documentChunks.jurisdictionId,
            })
            .from(documentChunks)
            .where(eq(documentChunks.documentId, payload.documentId))
            .for("update");
          const countryReferences = chunkParents.flatMap(
            ({ countryIso3, isDemo }) =>
              countryIso3
                ? [
                    {
                      childIsDemo: before.isDemo || isDemo,
                      childLabel: "document chunk",
                      parentId: countryIso3,
                    },
                  ]
                : [],
          );
          const jurisdictionReferences = chunkParents.flatMap(
            ({ isDemo, jurisdictionId }) =>
              jurisdictionId
                ? [
                    {
                      childIsDemo: before.isDemo || isDemo,
                      childLabel: "document chunk",
                      parentId: jurisdictionId,
                    },
                  ]
                : [],
          );
          if (countryReferences.length > 0) {
            const countryDemoById = await requireActiveCountries(
              countryReferences.map(({ parentId }) => parentId),
            );
            requireCompatibleParentClassifications(
              "countries",
              countryDemoById,
              countryReferences,
            );
          }
          if (jurisdictionReferences.length > 0) {
            const jurisdictionDemoById =
              await requireActiveJurisdictions(
                jurisdictionReferences.map(({ parentId }) => parentId),
              );
            requireCompatibleParentClassifications(
              "jurisdictions",
              jurisdictionDemoById,
              jurisdictionReferences,
            );
          }
          beforeData = before;
          await transaction
            .update(documents)
            .set({
              governancePublishedAt: now,
              governanceStatus: "published",
              updatedAt: now,
            })
            .where(
              and(
                eq(documents.id, payload.documentId),
                isNull(documents.archivedAt),
                eq(documents.governanceStatus, "reviewed"),
              ),
            );
          afterData = payload;
        }

        await transaction
          .update(dataGovernanceDrafts)
          .set({
            publishedAt: now,
            publishedBy: input.actor.email,
            updatedAt: now,
            workflowStatus: "published",
          })
          .where(eq(dataGovernanceDrafts.id, draft.id));
        await transaction.insert(dataChangeLogs).values({
          action: "published",
          actorEmail: input.actor.email,
          actorRole: input.actor.role,
          afterData,
          beforeData,
          draftId: draft.id,
          entityKey: draft.entityKey,
          entityType: draft.entityType,
          reason: input.reason,
        });

        return {
          entityKey: draft.entityKey,
          entityType: draft.entityType,
          status: "published" as const,
          version: draft.version,
        };
      });
    },

    async commitDocumentReprocessing(input: {
      actor: AdminPrincipal;
      prepared: PreparedKnowledgeDocumentReprocessing;
      reason: string;
    }) {
      return database.transaction(async (transaction) => {
        await assertGovernanceWriteAllowed(transaction);
        const lockedDrafts = await lockDocumentDraftChain(
          transaction,
          input.prepared.documentId,
        );
        const preparedDraft = lockedDrafts.find(
          (candidate) =>
            candidate.id === input.prepared.expected.activeDraftId &&
            candidate.entityType === "document" &&
            candidate.entityKey === input.prepared.documentId,
        );
        if (
          !preparedDraft ||
          preparedDraft.createdBy !==
            input.prepared.expected.activeDraftCreatedBy
        ) {
          throw new GovernanceConflictError(
            documentReprocessingDraftConflictMessage,
          );
        }
        assertDocumentReprocessingDraftAccess({
          actor: input.actor,
          createdBy: preparedDraft.createdBy,
        });
        const before = await loadDocumentProvenanceExpectation(
          transaction,
          input.prepared.documentId,
        );
        if (before.document.governanceStatus !== "draft") {
          throw new GovernanceConflictError(
            "Only an active ready/failed draft document can be reprocessed.",
          );
        }

        const [latestReprocessing] = await transaction
          .select({
            afterData: dataChangeLogs.afterData,
            draftId: dataChangeLogs.draftId,
            entityKey: dataChangeLogs.entityKey,
            entityType: dataChangeLogs.entityType,
          })
          .from(dataChangeLogs)
          .innerJoin(
            dataGovernanceDrafts,
            eq(dataChangeLogs.draftId, dataGovernanceDrafts.id),
          )
          .where(
            and(
              eq(dataChangeLogs.action, "document_reprocessed"),
              eq(dataChangeLogs.entityType, "document"),
              eq(dataChangeLogs.entityKey, input.prepared.documentId),
              eq(dataGovernanceDrafts.entityType, "document"),
              eq(
                dataGovernanceDrafts.entityKey,
                input.prepared.documentId,
              ),
            ),
          )
          .orderBy(
            desc(dataGovernanceDrafts.version),
            desc(dataChangeLogs.createdAt),
            desc(dataChangeLogs.id),
          )
          .limit(1);
        const latestMarker = latestReprocessing?.draftId
          ? parseDocumentReprocessedAuditMarkerFor({
              expectedDocumentId: input.prepared.documentId,
              expectedDraftId: latestReprocessing.draftId,
              expectedSourceId: before.document.dataSourceId,
              marker: latestReprocessing,
            })
          : null;
        if (
          latestMarker?.afterData.operationFingerprint ===
            input.prepared.operationFingerprint
        ) {
          // Under PostgreSQL READ COMMITTED, a SELECT FOR UPDATE that waited
          // for the superseded draft can return that updated row without
          // seeing the marker draft committed while it was waiting. Reload
          // and lock the complete chain before deciding whether this is an
          // idempotent response-loss retry.
          const replayDrafts = await lockDocumentDraftChain(
            transaction,
            input.prepared.documentId,
          );
          const matchingMarkerDraft = replayDrafts.find(
            (candidate) =>
              candidate.id === latestMarker.draftId &&
              candidate.entityType === "document" &&
              candidate.entityKey === latestMarker.afterData.documentId,
          );
          const activeReplayDrafts = replayDrafts.filter(
            (candidate) =>
              candidate.archivedAt === null &&
              (candidate.workflowStatus === "draft" ||
                candidate.workflowStatus === "reviewed"),
          );
          if (
            !matchingMarkerDraft ||
            activeReplayDrafts.length !== 1 ||
            activeReplayDrafts[0]?.id !== matchingMarkerDraft.id
          ) {
            throw new GovernanceConflictError(
              documentReprocessingDraftConflictMessage,
            );
          }
          assertDocumentReprocessingDraftAccess({
            actor: input.actor,
            createdBy: matchingMarkerDraft.createdBy,
          });
          const currentProvenance =
            await requireCanonicalDocumentProvenance(
              transaction,
              matchingMarkerDraft,
            );
          if (
            currentProvenance.provenance.action !==
              "document_reprocessed" ||
            currentProvenance.provenance.marker.afterData
              .operationFingerprint !==
              input.prepared.operationFingerprint ||
            JSON.stringify(
              currentProvenance.provenance.marker.afterData.metadata,
            ) !==
              JSON.stringify(
                normalizeDocumentImportMetadataForProvenance(
                  input.prepared.metadata,
                ),
              )
          ) {
            throw new GovernanceConflictError(
              "The reprocessed document no longer matches its idempotency marker; retry from the latest version.",
            );
          }
          const replayProcessingStatus =
            currentProvenance.document.processingStatus;
          if (
            replayProcessingStatus !== "ready" &&
            replayProcessingStatus !== "failed"
          ) {
            throw new GovernanceConflictError(
              "The reprocessed document no longer has a replayable processing status.",
            );
          }
          const [summary] = await transaction
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
            .where(eq(documents.id, input.prepared.documentId))
            .limit(1);
          if (!summary) {
            throw new Error("Reprocessed document summary was not returned.");
          }
          return {
            documentId: input.prepared.documentId,
            processingStatus: replayProcessingStatus,
            summary,
          };
        }

        if (
          before.document.contentSha256 !==
            input.prepared.expected.contentSha256 ||
          before.document.dataSourceId !==
            input.prepared.expected.dataSourceId ||
          before.document.processingStatus !==
            input.prepared.expected.processingStatus ||
          before.sourceFingerprint !==
            input.prepared.expected.sourceFingerprint ||
          before.chunkSetFingerprint !==
            input.prepared.expected.chunkSetFingerprint
        ) {
          throw new GovernanceConflictError(
            "The document changed while reprocessing was prepared; retry from the latest version.",
          );
        }
        const activeDraftsBeforeCommit = lockedDrafts.filter(
          (draft) =>
            draft.archivedAt === null &&
            (draft.workflowStatus === "draft" ||
              draft.workflowStatus === "reviewed"),
        );
        if (
          activeDraftsBeforeCommit.length !== 1 ||
          activeDraftsBeforeCommit[0]?.id !==
            input.prepared.expected.activeDraftId ||
          activeDraftsBeforeCommit[0]?.createdBy !==
            input.prepared.expected.activeDraftCreatedBy
        ) {
          throw new GovernanceConflictError(
            documentReprocessingDraftConflictMessage,
          );
        }
        assertDocumentReprocessingDraftAccess({
          actor: input.actor,
          createdBy: activeDraftsBeforeCommit[0].createdBy,
        });
        const provenanceRows = await transaction
          .select({
            action: dataChangeLogs.action,
            id: dataChangeLogs.id,
          })
          .from(dataChangeLogs)
          .where(
            and(
              eq(
                dataChangeLogs.draftId,
                input.prepared.expected.activeDraftId,
              ),
              eq(dataChangeLogs.entityType, "document"),
              eq(dataChangeLogs.entityKey, input.prepared.documentId),
              inArray(dataChangeLogs.action, [
                "draft_created",
                "document_reprocessed",
              ]),
            ),
          );
        const canonicalAction = getDocumentProvenanceActionForVersion(
          activeDraftsBeforeCommit[0]!.version,
        );
        const canonicalProvenance = provenanceRows.filter(
          ({ action }) => action === canonicalAction,
        );
        if (
          canonicalProvenance.length !== 1 ||
          canonicalProvenance[0]?.id !==
            input.prepared.expected.provenanceAuditId
        ) {
          throw new GovernanceConflictError(
            "The document metadata provenance changed while reprocessing was prepared; retry from the latest version.",
          );
        }
        const preparedProvenance =
          await requireCanonicalDocumentProvenance(
          transaction,
          activeDraftsBeforeCommit[0]!,
        );
        if (
          createDocumentProvenanceMarkerFingerprint(
            preparedProvenance.provenance.marker,
          ) !== input.prepared.expected.provenanceMarkerFingerprint ||
          JSON.stringify(
            preparedProvenance.provenance.marker.afterData.metadata,
          ) !==
          JSON.stringify(
            normalizeDocumentImportMetadataForProvenance(
              input.prepared.expected.provenanceMetadata,
            ),
          )
        ) {
          throw new GovernanceConflictError(
            "The document metadata provenance changed while reprocessing was prepared; retry from the latest version.",
          );
        }
        if (
          before.document.processingStatus === "ready" &&
          input.prepared.outcome.processingStatus === "failed"
        ) {
          throw new GovernanceConflictError(
            "A failed reprocessing attempt cannot replace a ready document.",
          );
        }

        const { metadata, outcome } = input.prepared;
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
          .returning();
        if (!source) {
          throw new Error("Failed to create the reprocessed document source.");
        }

        await transaction
          .delete(documentChunks)
          .where(eq(documentChunks.documentId, input.prepared.documentId));
        if (outcome.processingStatus === "ready") {
          for (const batch of documentChunkInsertBatches(input.prepared.documentId, outcome.chunks)) {
            await transaction.insert(documentChunks).values(batch);
          }
        }
        const [updatedDocument] = await transaction
          .update(documents)
          .set({
            canonicalUrl: nullableString(metadata.canonicalUrl),
            dataSourceId: source.id,
            demoNotice: metadata.isDemo ? metadata.demoNotice : null,
            isDemo: metadata.isDemo,
            languageCode: metadata.languageCode,
            licenseCode: metadata.licenseCode,
            processedAt: now,
            processingError: outcome.processingError,
            processingStatus: outcome.processingStatus,
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
              eq(documents.id, input.prepared.documentId),
              eq(documents.dataSourceId, before.document.dataSourceId),
              eq(documents.governanceStatus, "draft"),
              eq(
                documents.processingStatus,
                before.document.processingStatus,
              ),
              isNull(documents.archivedAt),
            ),
          )
          .returning({ id: documents.id });
        if (!updatedDocument) {
          throw new GovernanceConflictError(
            "The document changed while reprocessing was committed.",
          );
        }
        const afterProvenance =
          await loadDocumentProvenanceExpectation(
            transaction,
            input.prepared.documentId,
            outcome.processingStatus === "failed" ? metadata : undefined,
          );

        const activeDrafts = activeDraftsBeforeCommit;
        if (activeDrafts.length > 0) {
          await transaction
            .update(dataGovernanceDrafts)
            .set({ archivedAt: now, updatedAt: now })
            .where(
              inArray(
                dataGovernanceDrafts.id,
                activeDrafts.map(({ id }) => id),
              ),
            );
        }
        const nextVersion = (lockedDrafts.at(-1)?.version ?? 0) + 1;
        let draft: typeof dataGovernanceDrafts.$inferSelect | undefined;
        try {
          [draft] = await transaction
            .insert(dataGovernanceDrafts)
            .values({
              changeReason: input.reason,
              createdBy: input.actor.email,
              entityKey: input.prepared.documentId,
              entityType: "document",
              payload: { documentId: input.prepared.documentId },
              version: nextVersion,
            })
            .returning();
        } catch (error: unknown) {
          if (hasPostgresErrorCode(error, "23505")) {
            throw new GovernanceConflictError(
              "Another document draft revision was created concurrently; retry from the latest version.",
            );
          }
          throw error;
        }
        if (!draft) {
          throw new Error("Reprocessing draft creation did not return a row.");
        }
        await transaction.insert(dataChangeLogs).values({
          action: "draft_created",
          actorEmail: input.actor.email,
          actorRole: input.actor.role,
          afterData: { documentId: input.prepared.documentId },
          draftId: draft.id,
          entityKey: input.prepared.documentId,
          entityType: "document",
          reason: input.reason,
        });
        const reprocessingAuditAfterData =
          documentReprocessedAuditAfterDataSchema.parse({
            chunkSetFingerprint:
              afterProvenance.chunkSetFingerprint,
            contentSha256: before.document.contentSha256,
            documentId: input.prepared.documentId,
            metadata: afterProvenance.metadata,
            operationFingerprint: input.prepared.operationFingerprint,
            processingStatus: outcome.processingStatus,
            provenanceVersion: 2,
            sourceFingerprint: afterProvenance.sourceFingerprint,
            sourceId: source.id,
            status: outcome.processingStatus,
            supersededDraftIds: activeDrafts.map(({ id }) => id),
          });
        await transaction.insert(dataChangeLogs).values({
          action: "document_reprocessed",
          actorEmail: input.actor.email,
          actorRole: input.actor.role,
          afterData: reprocessingAuditAfterData,
          beforeData: before,
          draftId: draft.id,
          entityKey: input.prepared.documentId,
          entityType: "document",
          reason: input.reason,
        });

        const [summary] = await transaction
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
          .where(eq(documents.id, input.prepared.documentId))
          .limit(1);
        if (!summary) {
          throw new Error("Reprocessed document summary was not returned.");
        }

        return {
          documentId: input.prepared.documentId,
          processingStatus: outcome.processingStatus,
          summary,
        };
      });
    },

    async reviewDraft(input: {
      actor: AdminPrincipal;
      draftId: string;
      reason: string;
    }) {
      return database.transaction(async (transaction) => {
        await assertGovernanceWriteAllowed(transaction);
        const [draftIdentity] = await transaction
          .select()
          .from(dataGovernanceDrafts)
          .where(eq(dataGovernanceDrafts.id, input.draftId))
          .limit(1);

        if (!draftIdentity) {
          throw new GovernanceConflictError(
            "Only an active draft can be reviewed.",
          );
        }
        const entityDrafts = await transaction
          .select()
          .from(dataGovernanceDrafts)
          .where(
            and(
              eq(dataGovernanceDrafts.entityType, draftIdentity.entityType),
              eq(dataGovernanceDrafts.entityKey, draftIdentity.entityKey),
            ),
          )
          .orderBy(asc(dataGovernanceDrafts.version))
          .for("update");
        const draft = entityDrafts.find(({ id }) => id === input.draftId);

        if (
          !draft ||
          draft.workflowStatus !== "draft" ||
          draft.archivedAt
        ) {
          throw new GovernanceConflictError(
            "Only an active draft can be reviewed.",
          );
        }
        if (
          draft.createdBy === input.actor.email &&
          input.actor.role !== "admin"
        ) {
          throw new GovernanceConflictError(
            "A reviewer cannot review their own draft.",
          );
        }

        requireMatchingDraftEntityKey({
          entityKey: draft.entityKey,
          entityType: draft.entityType,
          payload: draft.payload,
        });

        const now = new Date();
        let documentBeforeReview: {
          governanceStatus: "draft" | "reviewed" | "published";
          processingStatus: "pending" | "processing" | "ready" | "failed";
        } | null = null;
        if (draft.entityType === "document") {
          const { document } =
            await requireCanonicalDocumentProvenance(transaction, draft);
          if (
            document.processingStatus !== "ready" ||
            document.governanceStatus !== "draft"
          ) {
            throw new GovernanceConflictError(
              "Only a ready draft document can be reviewed.",
            );
          }
          documentBeforeReview = document;
        }
        const [reviewed] = await transaction
          .update(dataGovernanceDrafts)
          .set({
            reviewedAt: now,
            reviewedBy: input.actor.email,
            updatedAt: now,
            workflowStatus: "reviewed",
          })
          .where(eq(dataGovernanceDrafts.id, draft.id))
          .returning();
        if (draft.entityType === "document") {
          const payload = documentDraftPayloadSchema.parse(draft.payload);
          await transaction
            .update(documents)
            .set({
              governanceStatus: "reviewed",
              reviewedAt: now,
              updatedAt: now,
            })
            .where(
              and(
                eq(documents.id, payload.documentId),
                isNull(documents.archivedAt),
                eq(documents.governanceStatus, "draft"),
              ),
            );
        }
        await transaction.insert(dataChangeLogs).values({
          action: "reviewed",
          actorEmail: input.actor.email,
          actorRole: input.actor.role,
          afterData: {
            ...(documentBeforeReview
              ? {
                  document: {
                    ...documentBeforeReview,
                    governanceStatus: "reviewed",
                  },
                }
              : {}),
            payload: draft.payload,
            reviewedAt: now.toISOString(),
            reviewedBy: input.actor.email,
            workflowStatus: "reviewed",
          },
          beforeData: {
            ...(documentBeforeReview
              ? { document: documentBeforeReview }
              : {}),
            payload: draft.payload,
            reviewedAt: draft.reviewedAt?.toISOString() ?? null,
            reviewedBy: draft.reviewedBy,
            workflowStatus: draft.workflowStatus,
          },
          draftId: draft.id,
          entityKey: draft.entityKey,
          entityType: draft.entityType,
          reason: input.reason,
        });

        return reviewed;
      });
    },

    async updateSourceVerifiedAt(input: {
      actor: AdminPrincipal;
      reason: string;
      sourceId: string;
      verifiedAt: string;
    }) {
      return sourceWrites.updateVerifiedAt(input);
    },
  };
}

export type GovernanceRepository = ReturnType<
  typeof createGovernanceRepository
>;
