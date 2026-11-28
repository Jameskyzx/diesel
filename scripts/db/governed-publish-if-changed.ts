import { and, desc, eq, isNull } from "drizzle-orm";

import type { AdminPrincipal } from "../../src/features/admin/schemas";
import * as schema from "../../src/server/db/schema";
import type { createGovernanceRepository } from "../../src/server/repositories/governance-repository";

/** Entity types the accepted-fixture ingest republishes on every run. */
export type FixtureEntityType =
  "country" | "data_source" | "jurisdiction" | "market_metric" | "regulation";

type Database = Parameters<typeof createGovernanceRepository>[0];
type Governance = ReturnType<typeof createGovernanceRepository>;

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalJson);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .toSorted()
        .map((key) => [
          key,
          canonicalJson((value as Record<string, unknown>)[key]),
        ]),
    );
  }
  return value;
}

/**
 * Canonical form used to decide whether a fixture payload changed since its
 * last published draft. The payload goes through a JSON round trip, as jsonb
 * storage does (dates become ISO strings, undefined keys disappear), and keys
 * are sorted. Regulation limit ids are regenerated on every run, so they are
 * dropped and the limits are compared as an order-independent set.
 */
export function canonicalFixturePayload(
  entityType: FixtureEntityType,
  payload: Record<string, unknown>,
): string {
  const parsed = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  if (entityType === "regulation" && Array.isArray(parsed.limits)) {
    parsed.limits = parsed.limits
      .map((limit) => {
        const rest = { ...(limit as Record<string, unknown>) };
        delete rest.id;
        return JSON.stringify(canonicalJson(rest));
      })
      .toSorted();
  }
  return JSON.stringify(canonicalJson(parsed));
}

async function isEntityActive(
  database: Database,
  entityType: FixtureEntityType,
  entityKey: string,
): Promise<boolean> {
  const rows =
    entityType === "country"
      ? await database
          .select({ key: schema.countries.iso3 })
          .from(schema.countries)
          .where(
            and(
              eq(schema.countries.iso3, entityKey),
              isNull(schema.countries.archivedAt),
            ),
          )
      : entityType === "data_source"
        ? await database
            .select({ key: schema.dataSources.id })
            .from(schema.dataSources)
            .where(
              and(
                eq(schema.dataSources.id, entityKey),
                isNull(schema.dataSources.archivedAt),
              ),
            )
        : entityType === "jurisdiction"
          ? await database
              .select({ key: schema.jurisdictions.id })
              .from(schema.jurisdictions)
              .where(
                and(
                  eq(schema.jurisdictions.id, entityKey),
                  isNull(schema.jurisdictions.archivedAt),
                ),
              )
          : entityType === "market_metric"
            ? await database
                .select({ key: schema.marketMetrics.id })
                .from(schema.marketMetrics)
                .where(
                  and(
                    eq(schema.marketMetrics.id, entityKey),
                    isNull(schema.marketMetrics.archivedAt),
                  ),
                )
            : await database
                .select({ key: schema.regulations.id })
                .from(schema.regulations)
                .where(
                  and(
                    eq(schema.regulations.id, entityKey),
                    isNull(schema.regulations.archivedAt),
                  ),
                );
  return rows.length === 1;
}

/**
 * Publishes a fixture through Draft → Reviewed → Published only when it
 * differs from what is already live. A fixture is unchanged only when the
 * latest draft for the entity is published, its payload has the same
 * canonical form, and the entity row is active. Anything else (no history, a
 * pending newer draft, an archived entity, a changed field) takes the full
 * governed path, so a skip never hides a real change.
 */
export async function publishFixtureIfChanged(input: {
  database: Database;
  editor: AdminPrincipal;
  entityKey: string;
  entityType: FixtureEntityType;
  governance: Governance;
  payload: Record<string, unknown>;
  reason: string;
  reviewer: AdminPrincipal;
}): Promise<"published" | "unchanged"> {
  const [latest] = await input.database
    .select({
      payload: schema.dataGovernanceDrafts.payload,
      workflowStatus: schema.dataGovernanceDrafts.workflowStatus,
    })
    .from(schema.dataGovernanceDrafts)
    .where(
      and(
        eq(schema.dataGovernanceDrafts.entityType, input.entityType),
        eq(schema.dataGovernanceDrafts.entityKey, input.entityKey),
      ),
    )
    .orderBy(desc(schema.dataGovernanceDrafts.version))
    .limit(1);
  if (
    latest?.workflowStatus === "published" &&
    latest.payload !== null &&
    typeof latest.payload === "object" &&
    canonicalFixturePayload(
      input.entityType,
      latest.payload as Record<string, unknown>,
    ) === canonicalFixturePayload(input.entityType, input.payload) &&
    (await isEntityActive(input.database, input.entityType, input.entityKey))
  ) {
    return "unchanged";
  }

  const draft = await input.governance.createDraft({
    actor: input.editor,
    changeReason: input.reason,
    entityKey: input.entityKey,
    entityType: input.entityType,
    payload: input.payload,
  });
  await input.governance.reviewDraft({
    actor: input.reviewer,
    draftId: draft.id,
    reason: input.reason,
  });
  await input.governance.publishDraft({
    actor: input.reviewer,
    draftId: draft.id,
    reason: input.reason,
  });
  return "published";
}
