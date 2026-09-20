import { and, eq, getTableColumns, isNull, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { z } from "zod";

import {
  dataSourceDraftPayloadSchema,
  type AdminPrincipal,
} from "@/features/admin/schemas";
import { assertGovernanceWriteAllowed } from "@/server/db/governance-maintenance-lock";
import * as schema from "@/server/db/schema";
import {
  countries,
  countryJurisdictions,
  dataChangeLogs,
  dataSources,
  documents,
  jurisdictions,
  marketMetrics,
  productCertifications,
  products,
  regulationLimits,
  regulations,
} from "@/server/db/schema";
import { GovernanceConflictError } from "@/server/repositories/governance-conflict-error";

type DataSourceDraftPayload = z.output<
  typeof dataSourceDraftPayloadSchema
>;

export const SOURCE_VERIFIED_AT_REGRESSION_MESSAGE =
  "Source verification time cannot be earlier than the current verification time.";
export const SOURCE_CONCURRENT_INSERT_CONFLICT_MESSAGE =
  "Source changed concurrently; retry from the latest state.";

// Keep verification ordering and audit evidence outside JavaScript's
// millisecond-only Date representation.
const exactDataSourceSelection = {
  ...getTableColumns(dataSources),
  verifiedAt: sql<string>`to_char(
    ${dataSources.verifiedAt} at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
  )`,
};

function sourceVerifiedAtTimestamp(verifiedAt: string) {
  return sql`${verifiedAt}::timestamptz`;
}

function sourceLockSelection(proposedVerifiedAt: string) {
  return {
    ...exactDataSourceSelection,
    proposedVerifiedAtAccepted: sql<boolean>`${sourceVerifiedAtTimestamp(
      proposedVerifiedAt,
    )} >= ${dataSources.verifiedAt}`,
  };
}

export function createGovernanceSourceWrites<
  TQueryResult extends PgQueryResultHKT,
>(database: PgDatabase<TQueryResult, typeof schema>) {
  type GovernanceTransaction = Parameters<
    Parameters<typeof database.transaction>[0]
  >[0];

  const hasRows = async <TRow>(
    query: PromiseLike<TRow[]>,
  ): Promise<boolean> => (await query).length > 0;

  const requireDemoSourceHasNoNonDemoDependents = async (
    transaction: GovernanceTransaction,
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
    if (dependentLabels.length > 0) {
      throw new GovernanceConflictError(
        `Demo source cannot have active non-demo dependents: ${dependentLabels.join(", ")}.`,
      );
    }
  };

  return {
    async applyReviewedDraft(
      transaction: GovernanceTransaction,
      input: {
        now: Date;
        payload: DataSourceDraftPayload;
        sourceId: string;
      },
    ) {
      const proposedVerifiedAt = sourceVerifiedAtTimestamp(
        input.payload.verifiedAt,
      );
      const [lockedSource] = await transaction
        .select(sourceLockSelection(input.payload.verifiedAt))
        .from(dataSources)
        .where(eq(dataSources.id, input.sourceId))
        .limit(1)
        .for("update");
      let beforeData: Omit<
        NonNullable<typeof lockedSource>,
        "proposedVerifiedAtAccepted"
      > | null = null;
      if (lockedSource) {
        const { proposedVerifiedAtAccepted, ...sourceBefore } = lockedSource;
        if (!proposedVerifiedAtAccepted) {
          throw new GovernanceConflictError(
            SOURCE_VERIFIED_AT_REGRESSION_MESSAGE,
          );
        }
        beforeData = sourceBefore;
      }
      if (input.payload.isDemo) {
        await requireDemoSourceHasNoNonDemoDependents(
          transaction,
          input.sourceId,
        );
      }

      const sourceValues = {
        ...input.payload,
        archivedAt: null,
        demoNotice: input.payload.demoNotice ?? null,
        id: input.sourceId,
        publishedOn: input.payload.publishedOn ?? null,
        publisher: input.payload.publisher ?? null,
        url: input.payload.url ?? null,
        verifiedAt: proposedVerifiedAt,
      };
      let persistedSource: { verifiedAt: string } | undefined;
      if (beforeData) {
        [persistedSource] = await transaction
          .update(dataSources)
          .set({
            archivedAt: null,
            demoNotice: input.payload.demoNotice ?? null,
            isDemo: input.payload.isDemo,
            publishedOn: input.payload.publishedOn ?? null,
            publisher: input.payload.publisher ?? null,
            sourceType: input.payload.sourceType,
            title: input.payload.title,
            updatedAt: input.now,
            url: input.payload.url ?? null,
            verifiedAt: proposedVerifiedAt,
          })
          .where(
            and(
              eq(dataSources.id, input.sourceId),
              sql`${proposedVerifiedAt} >= ${dataSources.verifiedAt}`,
            ),
          )
          .returning(exactDataSourceSelection);
        if (!persistedSource) {
          throw new GovernanceConflictError(
            SOURCE_VERIFIED_AT_REGRESSION_MESSAGE,
          );
        }
      } else {
        // A missing SELECT FOR UPDATE locks no row. A later primary-key
        // conflict must fail instead of being reinterpreted as an update
        // with an incorrect null before-image.
        [persistedSource] = await transaction
          .insert(dataSources)
          .values(sourceValues)
          .onConflictDoNothing({ target: dataSources.id })
          .returning(exactDataSourceSelection);
        if (!persistedSource) {
          throw new GovernanceConflictError(
            SOURCE_CONCURRENT_INSERT_CONFLICT_MESSAGE,
          );
        }
      }

      return { beforeData, persistedSource };
    },

    async updateVerifiedAt(input: {
      actor: AdminPrincipal;
      reason: string;
      sourceId: string;
      verifiedAt: string;
    }) {
      return database.transaction(async (transaction) => {
        await assertGovernanceWriteAllowed(transaction);
        const proposedVerifiedAt = sourceVerifiedAtTimestamp(input.verifiedAt);
        const [lockedSource] = await transaction
          .select(sourceLockSelection(input.verifiedAt))
          .from(dataSources)
          .where(
            and(
              eq(dataSources.id, input.sourceId),
              isNull(dataSources.archivedAt),
            ),
          )
          .limit(1)
          .for("update");
        if (!lockedSource) {
          throw new GovernanceConflictError(
            "Source does not exist or is archived.",
          );
        }
        const { proposedVerifiedAtAccepted, ...before } = lockedSource;
        if (!proposedVerifiedAtAccepted) {
          throw new GovernanceConflictError(
            SOURCE_VERIFIED_AT_REGRESSION_MESSAGE,
          );
        }
        const [after] = await transaction
          .update(dataSources)
          .set({
            updatedAt: new Date(),
            verifiedAt: proposedVerifiedAt,
          })
          .where(
            and(
              eq(dataSources.id, input.sourceId),
              isNull(dataSources.archivedAt),
              sql`${proposedVerifiedAt} >= ${dataSources.verifiedAt}`,
            ),
          )
          .returning(exactDataSourceSelection);
        if (!after) {
          throw new GovernanceConflictError(
            SOURCE_VERIFIED_AT_REGRESSION_MESSAGE,
          );
        }
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
