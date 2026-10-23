import { and, asc, desc, eq, inArray, isNull, type SQL } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type { FeedbackQuery } from "@/features/feedback/schemas";
import * as schema from "@/server/db/schema";
import { catalogEngines, dataSources, engineFeedback, feedbackSourceFiles, marketImportBatches } from "@/server/db/schema";
import { throwIfRequestAborted, type RequestSignalOptions } from "@/server/http/request-signal";

const publicColumns = {
  category: engineFeedback.category,
  countryIso3: engineFeedback.countryIso3,
  customerRequest: engineFeedback.customerRequest,
  component: engineFeedback.component,
  evidenceQuote: engineFeedback.evidenceQuote,
  id: engineFeedback.id,
  isDemo: engineFeedback.isDemo,
  modelCode: catalogEngines.modelCode,
  occurredOn: engineFeedback.occurredOn,
  quantityAffected: engineFeedback.quantityAffected,
  receivedOn: engineFeedback.receivedOn,
  requestedPowerKw: engineFeedback.requestedPowerKw,
  requestedPowerUnit: engineFeedback.requestedPowerUnit,
  requestedPowerValue: engineFeedback.requestedPowerValue,
  severity: engineFeedback.severity,
  sourceKind: engineFeedback.sourceKind,
  symptom: engineFeedback.symptom,
  system: engineFeedback.system,
  tags: engineFeedback.tags,
};

export function createFeedbackRepository<TQueryResult extends PgQueryResultHKT>(
  database: PgDatabase<TQueryResult, typeof schema>,
) {
  function filters(query: FeedbackQuery, scope: "demo" | "all"): SQL[] {
    const conditions: SQL[] = [isNull(engineFeedback.archivedAt), isNull(catalogEngines.archivedAt)];
    if (scope === "demo") conditions.push(eq(engineFeedback.isDemo, true), eq(catalogEngines.isDemo, true));
    if (query.modelCode) conditions.push(eq(catalogEngines.modelCode, query.modelCode));
    if (query.category) conditions.push(eq(engineFeedback.category, query.category));
    if (query.countryIso3) conditions.push(eq(engineFeedback.countryIso3, query.countryIso3));
    if (query.severity) conditions.push(eq(engineFeedback.severity, query.severity));
    return conditions;
  }

  return {
    /** Every active catalogue engine, demo or not, for matching and manual choice. */
    async listActiveEngines(options: RequestSignalOptions = {}) {
      throwIfRequestAborted(options.signal);
      return database
        .select({ id: catalogEngines.id, isDemo: catalogEngines.isDemo, model: catalogEngines.modelCode, series: catalogEngines.series })
        .from(catalogEngines)
        .innerJoin(dataSources, eq(catalogEngines.dataSourceId, dataSources.id))
        .where(and(isNull(catalogEngines.archivedAt), isNull(dataSources.archivedAt)))
        .orderBy(asc(catalogEngines.modelCode));
    },

    /**
     * Published feedback. The public scope returns only demo rows on demo
     * engines; real customer feedback stays behind the admin boundary.
     */
    async listFeedback(query: FeedbackQuery, scope: "demo" | "all", options: RequestSignalOptions = {}) {
      throwIfRequestAborted(options.signal);
      const rows = await database
        .select(publicColumns)
        .from(engineFeedback)
        .innerJoin(catalogEngines, eq(engineFeedback.catalogEngineId, catalogEngines.id))
        .where(and(...filters(query, scope)))
        .orderBy(desc(engineFeedback.receivedOn), asc(engineFeedback.id));
      throwIfRequestAborted(options.signal);
      return rows;
    },

    /** A previewed feedback batch owned by the actor; null once confirmed or rejected. */
    async getPreviewedFeedbackBatch(input: { actorEmail: string; batchId: string }) {
      const [batch] = await database
        .select({ id: marketImportBatches.id, previewRows: marketImportBatches.previewRows })
        .from(marketImportBatches)
        .where(and(
          eq(marketImportBatches.id, input.batchId),
          eq(marketImportBatches.createdBy, input.actorEmail),
          eq(marketImportBatches.status, "previewed"),
          eq(marketImportBatches.entityType, "engine_feedback"),
        ))
        .limit(1);
      return batch ?? null;
    },

    async insertSourceFiles(rows: readonly (typeof feedbackSourceFiles.$inferInsert)[]) {
      if (rows.length === 0) return [];
      return database.insert(feedbackSourceFiles).values([...rows]).returning({
        byteSize: feedbackSourceFiles.byteSize,
        id: feedbackSourceFiles.id,
        mediaType: feedbackSourceFiles.mediaType,
        originalFilename: feedbackSourceFiles.originalFilename,
      });
    },

    async getSourceFile(id: string) {
      const [row] = await database.select().from(feedbackSourceFiles).where(eq(feedbackSourceFiles.id, id)).limit(1);
      return row ?? null;
    },

    async listSourceFilesForBatches(batchIds: readonly string[]) {
      if (batchIds.length === 0) return [];
      return database
        .select({
          batchId: feedbackSourceFiles.batchId,
          id: feedbackSourceFiles.id,
          mediaType: feedbackSourceFiles.mediaType,
          originalFilename: feedbackSourceFiles.originalFilename,
        })
        .from(feedbackSourceFiles)
        .where(inArray(feedbackSourceFiles.batchId, [...batchIds]))
        .orderBy(asc(feedbackSourceFiles.createdAt));
    },

    /** Internal fields for the admin list: customer reference and source batch. */
    async listFeedbackSources(ids: readonly string[]) {
      if (ids.length === 0) return [];
      return database
        .select({ customerRef: engineFeedback.customerRef, id: engineFeedback.id, sourceBatchId: engineFeedback.sourceBatchId })
        .from(engineFeedback)
        .where(inArray(engineFeedback.id, [...ids]));
    },
  };
}
