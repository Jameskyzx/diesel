import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type {
  AdminPrincipal,
  GovernedEntityType,
  GovernanceWorkflowStatus,
} from "@/features/admin/schemas";
import { parseDocumentReprocessedAuditMarkerFor } from "@/features/admin/document-reprocessed-audit";
import {
  countries,
  dataChangeLogs,
  dataGovernanceDrafts,
  dataSources,
  documents,
  jurisdictions,
  marketMetrics,
  productCertifications,
  products,
  regulations,
} from "@/server/db/schema";

type GovernanceDashboardSchema = {
  countries: typeof countries;
  dataChangeLogs: typeof dataChangeLogs;
  dataGovernanceDrafts: typeof dataGovernanceDrafts;
  dataSources: typeof dataSources;
  documents: typeof documents;
  jurisdictions: typeof jurisdictions;
  marketMetrics: typeof marketMetrics;
  productCertifications: typeof productCertifications;
  products: typeof products;
  regulations: typeof regulations;
};

type GovernanceJson = Record<string, unknown>;

type GovernanceReviewDependencyKind =
  | "country"
  | "jurisdiction"
  | "product"
  | "regulation"
  | "source";

type GovernanceReviewReference = {
  kind: GovernanceReviewDependencyKind;
  path: string;
  value: string;
};

type GovernanceReviewDraft = {
  entityKey: string;
  entityType: GovernedEntityType;
  id: string;
  payload: GovernanceJson;
  version: number;
};

const dashboardActiveWorkflowStatuses = ["draft", "reviewed"] as const;
const dashboardAuditLimit = 30;
const dashboardDraftLimit = 100;

type GovernanceWorkflowCounts = Record<GovernanceWorkflowStatus, number>;

const governanceDependencyKinds = {
  countryIso3: "country",
  dataSourceId: "source",
  jurisdictionId: "jurisdiction",
  productId: "product",
  regulationId: "regulation",
  sourceId: "source",
} as const satisfies Record<string, GovernanceReviewDependencyKind>;

function collectGovernanceReviewReferences(
  value: unknown,
  path = "$",
  result: GovernanceReviewReference[] = [],
): GovernanceReviewReference[] {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectGovernanceReviewReferences(item, `${path}[${index}]`, result),
    );
    return result;
  }
  if (value === null || typeof value !== "object") {
    return result;
  }

  for (const [key, item] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;
    const kind =
      governanceDependencyKinds[
        key as keyof typeof governanceDependencyKinds
      ];
    if (kind && typeof item === "string" && item.trim()) {
      result.push({ kind, path: nextPath, value: item });
    }
    collectGovernanceReviewReferences(item, nextPath, result);
  }

  return Array.from(
    new Map(
      result.map((reference) => [
        `${reference.kind}:${reference.value}`,
        reference,
      ]),
    ).values(),
  );
}

function governanceEntityIdentity(
  entityType: GovernedEntityType,
  entityKey: string,
): string {
  return `${entityType}:${entityKey}`;
}

function dashboardDraftVisibilityPredicate(
  principal: AdminPrincipal,
): SQL | undefined {
  return principal.role === "editor"
    ? eq(dataGovernanceDrafts.createdBy, principal.email)
    : undefined;
}

export function createGovernanceDashboardRepository<
  TQueryResult extends PgQueryResultHKT,
>(database: PgDatabase<TQueryResult, GovernanceDashboardSchema>) {
  return {
    async listDashboardAuditLogs() {
      return database
        .select({
          action: dataChangeLogs.action,
          actorEmail: dataChangeLogs.actorEmail,
          actorRole: dataChangeLogs.actorRole,
          createdAt: dataChangeLogs.createdAt,
          entityKey: dataChangeLogs.entityKey,
          entityType: dataChangeLogs.entityType,
          id: dataChangeLogs.id,
          reason: dataChangeLogs.reason,
        })
        .from(dataChangeLogs)
        .orderBy(desc(dataChangeLogs.createdAt), desc(dataChangeLogs.id))
        .limit(dashboardAuditLimit);
    },

    async listActiveDrafts(principal: AdminPrincipal) {
      return database
        .select({
          changeReason: dataGovernanceDrafts.changeReason,
          createdBy: dataGovernanceDrafts.createdBy,
          entityKey: dataGovernanceDrafts.entityKey,
          entityType: dataGovernanceDrafts.entityType,
          id: dataGovernanceDrafts.id,
          payload: dataGovernanceDrafts.payload,
          version: dataGovernanceDrafts.version,
          workflowStatus: dataGovernanceDrafts.workflowStatus,
        })
        .from(dataGovernanceDrafts)
        .where(
          and(
            isNull(dataGovernanceDrafts.archivedAt),
            inArray(
              dataGovernanceDrafts.workflowStatus,
              dashboardActiveWorkflowStatuses,
            ),
            dashboardDraftVisibilityPredicate(principal),
          ),
        )
        .orderBy(
          desc(dataGovernanceDrafts.updatedAt),
          desc(dataGovernanceDrafts.id),
        )
        .limit(dashboardDraftLimit);
    },

    async getWorkflowCounts(
      principal: AdminPrincipal,
    ): Promise<GovernanceWorkflowCounts> {
      const rows = await database
        .select({
          count: sql<number>`count(*)::int`,
          workflowStatus: dataGovernanceDrafts.workflowStatus,
        })
        .from(dataGovernanceDrafts)
        .where(
          and(
            isNull(dataGovernanceDrafts.archivedAt),
            dashboardDraftVisibilityPredicate(principal),
          ),
        )
        .groupBy(dataGovernanceDrafts.workflowStatus);
      const counts: GovernanceWorkflowCounts = {
        draft: 0,
        published: 0,
        reviewed: 0,
      };
      for (const row of rows) {
        counts[row.workflowStatus] = row.count;
      }
      return counts;
    },

    async getDraftReviewContexts(drafts: GovernanceReviewDraft[]) {
      if (drafts.length === 0) {
        return [];
      }

      const referencesByDraftId = new Map(
        drafts.map((draft) => [
          draft.id,
          collectGovernanceReviewReferences(draft.payload),
        ]),
      );
      const references = Array.from(referencesByDraftId.values()).flat();
      const uniqueValues = (values: string[]) => Array.from(new Set(values));
      const referencedValues = (kind: GovernanceReviewDependencyKind) =>
        references
          .filter((reference) => reference.kind === kind)
          .map((reference) => reference.value);
      const targetValues = (entityType: GovernedEntityType) =>
        drafts
          .filter((draft) => draft.entityType === entityType)
          .map((draft) => draft.entityKey);
      const sourceIds = uniqueValues([
        ...referencedValues("source"),
        ...targetValues("data_source"),
      ]);
      const countryIds = uniqueValues([
        ...referencedValues("country"),
        ...targetValues("country"),
      ]);
      const jurisdictionIds = uniqueValues([
        ...referencedValues("jurisdiction"),
        ...targetValues("jurisdiction"),
      ]);
      const productIds = uniqueValues([
        ...referencedValues("product"),
        ...targetValues("product"),
      ]);
      const regulationIds = uniqueValues([
        ...referencedValues("regulation"),
        ...targetValues("regulation"),
      ]);
      const certificationIds = uniqueValues(
        targetValues("product_certification"),
      );
      const marketMetricIds = uniqueValues(targetValues("market_metric"));
      const documentIds = uniqueValues(targetValues("document"));

      const identityPredicates = Array.from(
        new Map(
          drafts.map((draft) => [
            governanceEntityIdentity(draft.entityType, draft.entityKey),
            and(
              eq(dataGovernanceDrafts.entityType, draft.entityType),
              eq(dataGovernanceDrafts.entityKey, draft.entityKey),
            ),
          ]),
        ).values(),
      );

      const [
        publishedDrafts,
        sourceRows,
        countryRows,
        jurisdictionRows,
        productRows,
        regulationRows,
        certificationRows,
        marketMetricRows,
        documentRows,
        reprocessedDocumentDraftRows,
      ] = await Promise.all([
        database
          .selectDistinctOn(
            [
              dataGovernanceDrafts.entityType,
              dataGovernanceDrafts.entityKey,
            ],
            {
              entityKey: dataGovernanceDrafts.entityKey,
              entityType: dataGovernanceDrafts.entityType,
              payload: dataGovernanceDrafts.payload,
              publishedAt: dataGovernanceDrafts.publishedAt,
              publishedBy: dataGovernanceDrafts.publishedBy,
              version: dataGovernanceDrafts.version,
            },
          )
          .from(dataGovernanceDrafts)
          .where(
            and(
              eq(dataGovernanceDrafts.workflowStatus, "published"),
              isNull(dataGovernanceDrafts.archivedAt),
              or(...identityPredicates),
            ),
          )
          .orderBy(
            dataGovernanceDrafts.entityType,
            dataGovernanceDrafts.entityKey,
            desc(dataGovernanceDrafts.version),
          ),
        sourceIds.length > 0
          ? database
              .select({
                archivedAt: dataSources.archivedAt,
                id: dataSources.id,
                isDemo: dataSources.isDemo,
                label: dataSources.title,
                url: dataSources.url,
                verifiedAt: dataSources.verifiedAt,
              })
              .from(dataSources)
              .where(inArray(dataSources.id, sourceIds))
          : Promise.resolve([]),
        countryIds.length > 0
          ? database
              .select({
                archivedAt: countries.archivedAt,
                id: countries.iso3,
                isDemo: countries.isDemo,
                label: countries.nameEn,
                sourceArchivedAt: dataSources.archivedAt,
                verifiedAt: countries.verifiedAt,
              })
              .from(countries)
              .innerJoin(dataSources, eq(countries.dataSourceId, dataSources.id))
              .where(inArray(countries.iso3, countryIds))
          : Promise.resolve([]),
        jurisdictionIds.length > 0
          ? database
              .select({
                archivedAt: jurisdictions.archivedAt,
                id: jurisdictions.id,
                isDemo: jurisdictions.isDemo,
                label: jurisdictions.name,
                sourceArchivedAt: dataSources.archivedAt,
                url: jurisdictions.websiteUrl,
                verifiedAt: jurisdictions.verifiedAt,
              })
              .from(jurisdictions)
              .innerJoin(
                dataSources,
                eq(jurisdictions.dataSourceId, dataSources.id),
              )
              .where(inArray(jurisdictions.id, jurisdictionIds))
          : Promise.resolve([]),
        productIds.length > 0
          ? database
              .select({
                archivedAt: products.archivedAt,
                id: products.id,
                isDemo: products.isDemo,
                label: products.name,
                sourceArchivedAt: dataSources.archivedAt,
                verifiedAt: products.verifiedAt,
              })
              .from(products)
              .innerJoin(dataSources, eq(products.dataSourceId, dataSources.id))
              .where(inArray(products.id, productIds))
          : Promise.resolve([]),
        regulationIds.length > 0
          ? database
              .select({
                archivedAt: regulations.archivedAt,
                id: regulations.id,
                isDemo: regulations.isDemo,
                label: regulations.canonicalName,
                sourceArchivedAt: dataSources.archivedAt,
                verifiedAt: regulations.verifiedAt,
              })
              .from(regulations)
              .innerJoin(
                dataSources,
                eq(regulations.dataSourceId, dataSources.id),
              )
              .where(inArray(regulations.id, regulationIds))
          : Promise.resolve([]),
        certificationIds.length > 0
          ? database
              .select({
                archivedAt: productCertifications.archivedAt,
                id: productCertifications.id,
                sourceArchivedAt: dataSources.archivedAt,
              })
              .from(productCertifications)
              .innerJoin(
                dataSources,
                eq(productCertifications.dataSourceId, dataSources.id),
              )
              .where(inArray(productCertifications.id, certificationIds))
          : Promise.resolve([]),
        marketMetricIds.length > 0
          ? database
              .select({
                archivedAt: marketMetrics.archivedAt,
                id: marketMetrics.id,
                sourceArchivedAt: dataSources.archivedAt,
              })
              .from(marketMetrics)
              .innerJoin(
                dataSources,
                eq(marketMetrics.dataSourceId, dataSources.id),
              )
              .where(inArray(marketMetrics.id, marketMetricIds))
          : Promise.resolve([]),
        documentIds.length > 0
          ? database
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
              .where(inArray(documents.id, documentIds))
          : Promise.resolve([]),
        drafts.some(({ entityType }) => entityType === "document")
          ? database
              .select({
                afterData: dataChangeLogs.afterData,
                draftId: dataChangeLogs.draftId,
                entityKey: dataChangeLogs.entityKey,
                entityType: dataChangeLogs.entityType,
              })
              .from(dataChangeLogs)
              .where(
                and(
                  eq(dataChangeLogs.action, "document_reprocessed"),
                  inArray(
                    dataChangeLogs.draftId,
                    drafts
                      .filter(
                        ({ entityType }) => entityType === "document",
                      )
                      .map(({ id }) => id),
                  ),
                ),
              )
          : Promise.resolve([]),
      ]);

      const documentDataSourceIdById = new Map(
        documentRows.map(({ dataSourceId, id }) => [id, dataSourceId]),
      );
      const documentDraftById = new Map(
        drafts
          .filter(({ entityType }) => entityType === "document")
          .map((draft) => [draft.id, draft]),
      );
      const reprocessedDocumentDraftIds = new Set(
        reprocessedDocumentDraftRows.flatMap((marker) => {
          const draft = marker.draftId
            ? documentDraftById.get(marker.draftId)
            : null;
          const currentSourceId = draft
            ? documentDataSourceIdById.get(draft.entityKey)
            : null;

          return draft &&
            currentSourceId &&
            parseDocumentReprocessedAuditMarkerFor({
              expectedDocumentId: draft.entityKey,
              expectedDraftId: draft.id,
              expectedSourceId: currentSourceId,
              marker,
            })
            ? [draft.id]
            : [];
        }),
      );

      const publishedBaselineByIdentity = new Map<
        string,
        (typeof publishedDrafts)[number]
      >();
      for (const publishedDraft of publishedDrafts) {
        const identity = governanceEntityIdentity(
          publishedDraft.entityType,
          publishedDraft.entityKey,
        );
        if (!publishedBaselineByIdentity.has(identity)) {
          publishedBaselineByIdentity.set(identity, publishedDraft);
        }
      }

      type RootState = "active" | "archived" | "unpublished";
      const rootStateByIdentity = new Map<string, RootState>();
      const documentProcessingStatusById = new Map(
        documentRows.map(({ id, processingStatus }) => [id, processingStatus]),
      );
      const dependencyByIdentity = new Map<
        string,
        {
          isDemo: boolean;
          label: string;
          state: "active" | "archived";
          url: string | null;
          verifiedAt: Date;
        }
      >();
      const rowState = (
        archivedAt: Date | null,
        sourceArchivedAt?: Date | null,
      ): "active" | "archived" =>
        archivedAt || sourceArchivedAt ? "archived" : "active";

      for (const row of sourceRows) {
        const state = rowState(row.archivedAt);
        rootStateByIdentity.set(
          governanceEntityIdentity("data_source", row.id),
          state,
        );
        dependencyByIdentity.set(`source:${row.id}`, {
          isDemo: row.isDemo,
          label: row.label,
          state,
          url: row.url,
          verifiedAt: row.verifiedAt,
        });
      }
      for (const row of countryRows) {
        const state = rowState(row.archivedAt, row.sourceArchivedAt);
        rootStateByIdentity.set(
          governanceEntityIdentity("country", row.id),
          state,
        );
        dependencyByIdentity.set(`country:${row.id}`, {
          isDemo: row.isDemo,
          label: row.label,
          state,
          url: null,
          verifiedAt: row.verifiedAt,
        });
      }
      for (const row of jurisdictionRows) {
        const state = rowState(row.archivedAt, row.sourceArchivedAt);
        rootStateByIdentity.set(
          governanceEntityIdentity("jurisdiction", row.id),
          state,
        );
        dependencyByIdentity.set(`jurisdiction:${row.id}`, {
          isDemo: row.isDemo,
          label: row.label,
          state,
          url: row.url,
          verifiedAt: row.verifiedAt,
        });
      }
      for (const row of productRows) {
        const state = rowState(row.archivedAt, row.sourceArchivedAt);
        rootStateByIdentity.set(
          governanceEntityIdentity("product", row.id),
          state,
        );
        dependencyByIdentity.set(`product:${row.id}`, {
          isDemo: row.isDemo,
          label: row.label,
          state,
          url: null,
          verifiedAt: row.verifiedAt,
        });
      }
      for (const row of regulationRows) {
        const state = rowState(row.archivedAt, row.sourceArchivedAt);
        rootStateByIdentity.set(
          governanceEntityIdentity("regulation", row.id),
          state,
        );
        dependencyByIdentity.set(`regulation:${row.id}`, {
          isDemo: row.isDemo,
          label: row.label,
          state,
          url: null,
          verifiedAt: row.verifiedAt,
        });
      }
      for (const row of certificationRows) {
        rootStateByIdentity.set(
          governanceEntityIdentity("product_certification", row.id),
          rowState(row.archivedAt, row.sourceArchivedAt),
        );
      }
      for (const row of marketMetricRows) {
        rootStateByIdentity.set(
          governanceEntityIdentity("market_metric", row.id),
          rowState(row.archivedAt, row.sourceArchivedAt),
        );
      }
      for (const row of documentRows) {
        rootStateByIdentity.set(
          governanceEntityIdentity("document", row.id),
          row.archivedAt || row.sourceArchivedAt
            ? "archived"
            : row.governanceStatus === "published"
              ? "active"
              : "unpublished",
        );
      }

      return drafts.map((draft) => {
        const identity = governanceEntityIdentity(
          draft.entityType,
          draft.entityKey,
        );
        const publishedBaselineRow =
          publishedBaselineByIdentity.get(identity) ?? null;
        const publishedBaseline = publishedBaselineRow
          ? {
              payload: publishedBaselineRow.payload,
              publishedAt: publishedBaselineRow.publishedAt,
              publishedBy: publishedBaselineRow.publishedBy,
              version: publishedBaselineRow.version,
            }
          : null;
        const rootState = rootStateByIdentity.get(identity);
        const documentProcessingStatus =
          draft.entityType === "document"
            ? documentProcessingStatusById.get(draft.entityKey)
            : null;
        const isReprocessedFirstPublication =
          draft.entityType === "document" &&
          rootState === "unpublished" &&
          reprocessedDocumentDraftIds.has(draft.id);
        const baselineStatus = publishedBaseline
          ? rootState === "active"
            ? ("active" as const)
            : rootState === "archived"
              ? ("archived" as const)
              : ("missing" as const)
          : draft.version === 1 || isReprocessedFirstPublication
            ? rootState === "archived"
              ? ("archived" as const)
              : ("first_revision" as const)
            : ("missing" as const);
        const dependencies = (referencesByDraftId.get(draft.id) ?? []).map(
          (reference) => {
            const resolved = dependencyByIdentity.get(
              `${reference.kind}:${reference.value}`,
            );
            return {
              isDemo: resolved?.isDemo ?? null,
              kind: reference.kind,
              label: resolved?.label ?? null,
              path: reference.path,
              state: resolved?.state ?? ("missing" as const),
              url: resolved?.url ?? null,
              value: reference.value,
              verifiedAt: resolved?.verifiedAt ?? null,
            };
          },
        );
        const blockingReasons: string[] = [];

        if (baselineStatus === "missing") {
          blockingReasons.push(
            "缺少可核验的当前发布基线；为避免覆盖未知正式数据，当前禁止发布。",
          );
        } else if (baselineStatus === "archived") {
          blockingReasons.push(
            "该实体的最近发布版本已归档；恢复或重新发布前需要单独核验。",
          );
        }
        if (
          draft.entityType === "document" &&
          documentProcessingStatus !== "ready"
        ) {
          blockingReasons.push(
            `文档处理状态不是 ready（当前：${documentProcessingStatus ?? "missing"}）；当前禁止审核或发布。`,
          );
        }
        if (
          publishedBaseline &&
          publishedBaseline.version > draft.version
        ) {
          blockingReasons.push(
            `已有更新的 v${publishedBaseline.version} 发布版本，不能用 v${draft.version} 覆盖。`,
          );
        }
        const unavailableDependencies = dependencies.filter(
          ({ state }) => state !== "active",
        );
        if (unavailableDependencies.length > 0) {
          blockingReasons.push(
            `存在 ${unavailableDependencies.length} 个缺失或已归档的来源/依赖。`,
          );
        }

        return {
          baselineStatus,
          blockingReasons,
          dependencies,
          draftId: draft.id,
          publishedBaseline,
          publishReady: blockingReasons.length === 0,
        };
      });
    },
  };
}

export type GovernanceDashboardRepository = ReturnType<
  typeof createGovernanceDashboardRepository
>;
