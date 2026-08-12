import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

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
  type GovernanceWorkflowStatus,
} from "@/features/admin/schemas";
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

export class GovernanceConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GovernanceConflictError";
  }
}

function requiredId(id: string | undefined, entityType: string): string {
  if (!id) {
    throw new GovernanceConflictError(
      `${entityType} draft payload does not contain an assigned id.`,
    );
  }
  return id;
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
          .where(eq(marketImportBatches.id, input.batchId))
          .limit(1)
          .for("update");

        if (!batch || batch.status !== "previewed") {
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
            .where(eq(marketImportBatches.id, input.batchId));
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
          .where(eq(marketImportBatches.id, input.batchId));

        return {
          createdDrafts: drafts.length,
          status: "committed" as const,
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
          afterData: input.payload,
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

    async listDrafts(status?: GovernanceWorkflowStatus) {
      return database
        .select()
        .from(dataGovernanceDrafts)
        .where(
          status
            ? and(
                eq(dataGovernanceDrafts.workflowStatus, status),
                isNull(dataGovernanceDrafts.archivedAt),
              )
            : isNull(dataGovernanceDrafts.archivedAt),
        )
        .orderBy(desc(dataGovernanceDrafts.updatedAt))
        .limit(100);
    },

    async listImportBatches() {
      return database
        .select()
        .from(marketImportBatches)
        .orderBy(desc(marketImportBatches.createdAt))
        .limit(50);
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
              candidate.version > draft.version &&
              candidate.workflowStatus === "published",
          )
        ) {
          throw new GovernanceConflictError(
            "A newer revision has already been published; the older draft cannot replace it.",
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
        const requireDemoSourceHasNoNonDemoDependents = async (
          sourceId: string,
        ) => {
          const dependentLabels: string[] = [];
          if (
            await hasRows(
              transaction
                .select({ id: countries.iso3 })
                .from(countries)
                .where(
                  and(
                    eq(countries.dataSourceId, sourceId),
                    eq(countries.isDemo, false),
                    isNull(countries.archivedAt),
                  ),
                )
                .limit(1),
            )
          ) {
            dependentLabels.push("countries");
          }
          if (
            await hasRows(
              transaction
                .select({ id: jurisdictions.id })
                .from(jurisdictions)
                .where(
                  and(
                    eq(jurisdictions.dataSourceId, sourceId),
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
                .select({ id: countryJurisdictions.countryIso3 })
                .from(countryJurisdictions)
                .where(
                  and(
                    eq(countryJurisdictions.dataSourceId, sourceId),
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
                .select({ id: regulations.id })
                .from(regulations)
                .where(
                  and(
                    eq(regulations.dataSourceId, sourceId),
                    eq(regulations.isDemo, false),
                    isNull(regulations.archivedAt),
                  ),
                )
                .limit(1),
            )
          ) {
            dependentLabels.push("regulations");
          }
          if (
            await hasRows(
              transaction
                .select({ id: regulationLimits.id })
                .from(regulationLimits)
                .where(
                  and(
                    eq(regulationLimits.dataSourceId, sourceId),
                    eq(regulationLimits.isDemo, false),
                    isNull(regulationLimits.archivedAt),
                  ),
                )
                .limit(1),
            )
          ) {
            dependentLabels.push("regulation limits");
          }
          if (
            await hasRows(
              transaction
                .select({ id: products.id })
                .from(products)
                .where(
                  and(
                    eq(products.dataSourceId, sourceId),
                    eq(products.isDemo, false),
                    isNull(products.archivedAt),
                  ),
                )
                .limit(1),
            )
          ) {
            dependentLabels.push("products");
          }
          if (
            await hasRows(
              transaction
                .select({ id: productCertifications.id })
                .from(productCertifications)
                .where(
                  and(
                    eq(productCertifications.dataSourceId, sourceId),
                    eq(productCertifications.isDemo, false),
                    isNull(productCertifications.archivedAt),
                  ),
                )
                .limit(1),
            )
          ) {
            dependentLabels.push("product certifications");
          }
          if (
            await hasRows(
              transaction
                .select({ id: marketMetrics.id })
                .from(marketMetrics)
                .where(
                  and(
                    eq(marketMetrics.dataSourceId, sourceId),
                    eq(marketMetrics.isDemo, false),
                    isNull(marketMetrics.archivedAt),
                  ),
                )
                .limit(1),
            )
          ) {
            dependentLabels.push("market metrics");
          }
          if (
            await hasRows(
              transaction
                .select({ id: documents.id })
                .from(documents)
                .where(
                  and(
                    eq(documents.dataSourceId, sourceId),
                    eq(documents.isDemo, false),
                    eq(documents.governanceStatus, "published"),
                    isNull(documents.archivedAt),
                  ),
                )
                .limit(1),
            )
          ) {
            dependentLabels.push("documents");
          }
          requireNoNonDemoDependents("source", dependentLabels);
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
          const [before] = await transaction
            .select()
            .from(dataSources)
            .where(eq(dataSources.id, id))
            .limit(1)
            .for("update");
          if (payload.isDemo) {
            await requireDemoSourceHasNoNonDemoDependents(id);
          }
          beforeData = before ?? null;
          await transaction
            .insert(dataSources)
            .values({
              ...payload,
              archivedAt: null,
              demoNotice: payload.demoNotice ?? null,
              id,
              publishedOn: payload.publishedOn ?? null,
              publisher: payload.publisher ?? null,
              url: payload.url ?? null,
              verifiedAt: new Date(payload.verifiedAt),
            })
            .onConflictDoUpdate({
              set: {
                archivedAt: null,
                demoNotice: payload.demoNotice ?? null,
                isDemo: payload.isDemo,
                publishedOn: payload.publishedOn ?? null,
                publisher: payload.publisher ?? null,
                sourceType: payload.sourceType,
                title: payload.title,
                updatedAt: now,
                url: payload.url ?? null,
                verifiedAt: new Date(payload.verifiedAt),
              },
              target: dataSources.id,
            });
          afterData = { ...payload, id };
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
                limitValue: limit.limitValue.toFixed(6),
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
                valueNumeric: payload.valueNumeric.toFixed(6),
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
                  valueNumeric: payload.valueNumeric.toFixed(6),
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
          const beforeMemberships = before
            ? await transaction
                .select()
                .from(countryJurisdictions)
                .where(
                  and(
                    eq(countryJurisdictions.jurisdictionId, id),
                    isNull(countryJurisdictions.archivedAt),
                  ),
                )
            : [];
          beforeData = before
            ? { jurisdiction: before, memberships: beforeMemberships }
            : null;
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
          // 国家成员关系更新：payload 中不存在的活跃成员归档（移除），
          // payload 成员按复合主键（country_iso3, jurisdiction_id）upsert，
          // 重发布因此幂等；before/after 审计快照保留历史。
          const memberships = payload.memberships;
          const payloadCountries = new Set(
            memberships.map((membership) => membership.countryIso3),
          );
          const toArchive = beforeMemberships
            .filter(
              (membership) => !payloadCountries.has(membership.countryIso3),
            )
            .map((membership) => membership.countryIso3);
          if (toArchive.length > 0) {
            await transaction
              .update(countryJurisdictions)
              .set({ archivedAt: now, updatedAt: now })
              .where(
                and(
                  eq(countryJurisdictions.jurisdictionId, id),
                  isNull(countryJurisdictions.archivedAt),
                  inArray(countryJurisdictions.countryIso3, toArchive),
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
                  validFrom: sql`excluded.valid_from`,
                  validTo: sql`excluded.valid_to`,
                  verifiedAt: sql`excluded.verified_at`,
                },
                target: [
                  countryJurisdictions.countryIso3,
                  countryJurisdictions.jurisdictionId,
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

    async recordOperationalChange(input: {
      action: "document_reprocessed";
      actor: AdminPrincipal;
      afterData: GovernanceJson;
      beforeData?: GovernanceJson | null;
      entityKey: string;
      entityType: "document";
      reason: string;
    }) {
      await database.transaction(async (transaction) => {
        await assertGovernanceWriteAllowed(transaction);
        await transaction.insert(dataChangeLogs).values({
          action: input.action,
          actorEmail: input.actor.email,
          actorRole: input.actor.role,
          afterData: input.afterData,
          beforeData: input.beforeData ?? null,
          entityKey: input.entityKey,
          entityType: input.entityType,
          reason: input.reason,
        });
      });
    },

    async reviewDraft(input: {
      actor: AdminPrincipal;
      draftId: string;
      reason: string;
    }) {
      return database.transaction(async (transaction) => {
        await assertGovernanceWriteAllowed(transaction);
        const [draft] = await transaction
          .select()
          .from(dataGovernanceDrafts)
          .where(eq(dataGovernanceDrafts.id, input.draftId))
          .limit(1)
          .for("update");

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
          const payload = documentDraftPayloadSchema.parse(draft.payload);
          const [document] = await transaction
            .select({
              governanceStatus: documents.governanceStatus,
              processingStatus: documents.processingStatus,
            })
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
            !document ||
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
      verifiedAt: Date;
    }) {
      return database.transaction(async (transaction) => {
        await assertGovernanceWriteAllowed(transaction);
        const [before] = await transaction
          .select()
          .from(dataSources)
          .where(
            and(
              eq(dataSources.id, input.sourceId),
              isNull(dataSources.archivedAt),
            ),
          )
          .limit(1)
          .for("update");
        if (!before) {
          throw new GovernanceConflictError(
            "Source does not exist or is archived.",
          );
        }
        const [after] = await transaction
          .update(dataSources)
          .set({
            updatedAt: new Date(),
            verifiedAt: input.verifiedAt,
          })
          .where(
            and(
              eq(dataSources.id, input.sourceId),
              isNull(dataSources.archivedAt),
            ),
          )
          .returning();
        await transaction.insert(dataChangeLogs).values({
          action: "source_verified",
          actorEmail: input.actor.email,
          actorRole: input.actor.role,
          afterData: after,
          beforeData: before,
          entityKey: input.sourceId,
          entityType: "data_source",
          reason: input.reason,
        });
        return after;
      });
    },
  };
}

export type GovernanceRepository = ReturnType<
  typeof createGovernanceRepository
>;
