/**
 * Publishes the fictional demo engine catalogue through governance:
 *
 *   pnpm db:ingest-demo-catalogue
 *
 * The catalogue source and every engine go Draft -> Reviewed -> Published with
 * separate editor/reviewer automation actors, so each write has an audit
 * record. An engine whose active row already matches the fixture is skipped;
 * a changed one gets a new published version. Nothing is ever deleted.
 */
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";

import postgres from "../../src/server/db/postgres";
import * as schema from "../../src/server/db/schema";
import { getDatabaseUrl } from "../../src/server/db/environment";
import {
  demoCatalogDraftPayloads,
  demoCatalogSource,
  demoCatalogVerifiedAt,
} from "../../src/server/db/seed/demo-engine-catalog";
import { createGovernanceRepository } from "../../src/server/repositories/governance-repository";

const editor = { email: "catalogue-ingest-editor@automation.local", role: "editor" as const };
const reviewer = { email: "catalogue-ingest-reviewer@automation.local", role: "reviewer" as const };
const reason = "Publish the fictional demo engine catalogue fixture (src/server/db/seed/demo-engine-catalog.json).";

type Payload = ReturnType<typeof demoCatalogDraftPayloads>[number];

function sameEngine(row: typeof schema.catalogEngines.$inferSelect, payload: Payload): boolean {
  return row.modelCode === payload.modelCode && row.series === payload.series && row.category === payload.category &&
    JSON.stringify(row.applicationScopes) === JSON.stringify(payload.applicationScopes) &&
    row.ratedPowerKw === payload.ratedPowerKw && row.ratedSpeedRpm === payload.ratedSpeedRpm &&
    row.powerMinKw === payload.powerMinKw && row.powerMaxKw === payload.powerMaxKw &&
    row.displacementL === payload.displacementL && row.cylinders === payload.cylinders &&
    row.aftertreatment === payload.aftertreatment && row.emissionLabel === payload.emissionLabel &&
    JSON.stringify(row.declaredCitationCodes) === JSON.stringify(payload.declaredCitationCodes) &&
    row.dataSourceId === payload.dataSourceId && row.isDemo === payload.isDemo;
}

async function main() {
  const client = postgres(getDatabaseUrl(), { max: 1, prepare: false });
  const database = drizzle(client, { schema });
  const governance = createGovernanceRepository(database);
  const publish = async (entityType: "data_source" | "catalog_engine", entityKey: string, payload: Record<string, unknown>) => {
    const draft = await governance.createDraft({ actor: editor, changeReason: reason, entityKey, entityType, payload });
    await governance.reviewDraft({ actor: reviewer, draftId: draft.id, reason });
    await governance.publishDraft({ actor: reviewer, draftId: draft.id, reason });
  };

  try {
    const [source] = await database.select().from(schema.dataSources)
      .where(and(eq(schema.dataSources.id, demoCatalogSource.id), isNull(schema.dataSources.archivedAt))).limit(1);
    if (source?.title === demoCatalogSource.title && source.isDemo) {
      process.stdout.write(`data_source ${demoCatalogSource.id}: unchanged\n`);
    } else {
      await publish("data_source", demoCatalogSource.id, { ...demoCatalogSource, verifiedAt: demoCatalogVerifiedAt });
      process.stdout.write(`data_source ${demoCatalogSource.id}: published\n`);
    }

    let published = 0;
    let unchanged = 0;
    for (const payload of demoCatalogDraftPayloads()) {
      const [row] = await database.select().from(schema.catalogEngines)
        .where(and(eq(schema.catalogEngines.id, payload.id), isNull(schema.catalogEngines.archivedAt))).limit(1);
      if (row && sameEngine(row, payload)) {
        unchanged += 1;
        continue;
      }
      await publish("catalog_engine", payload.id, payload);
      published += 1;
      process.stdout.write(`catalog_engine ${payload.modelCode}: published\n`);
    }
    process.stdout.write(`catalogue: ${published} published, ${unchanged} unchanged\n`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`Catalogue ingestion failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
