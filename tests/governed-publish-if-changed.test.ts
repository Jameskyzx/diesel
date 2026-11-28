import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "@/server/db/schema";
import { createGovernanceRepository } from "@/server/repositories/governance-repository";
import {
  canonicalFixturePayload,
  publishFixtureIfChanged,
} from "../scripts/db/governed-publish-if-changed";
import { createTestDatabase } from "./helpers/database";

const editor = {
  email: "fixture-editor@example.test",
  role: "editor" as const,
};
const reviewer = {
  email: "fixture-reviewer@example.test",
  role: "reviewer" as const,
};
const sourceId = "10000000-0000-4000-8000-00000000f001";

function sourcePayload(title = "Official register") {
  return {
    id: sourceId,
    isDemo: false,
    publishedOn: null,
    publisher: "Statistics office",
    sourceType: "other",
    title,
    url: "https://example.test/register",
    verifiedAt: new Date("2026-11-26T10:02:00.000Z"),
  };
}

describe("canonicalFixturePayload", () => {
  it("matches jsonb round trips and ignores key order", () => {
    expect(
      canonicalFixturePayload("data_source", {
        b: 1,
        a: new Date("2026-01-01T00:00:00.000Z"),
        skipped: undefined,
      }),
    ).toBe(
      canonicalFixturePayload("data_source", {
        a: "2026-01-01T00:00:00.000Z",
        b: 1,
      }),
    );
  });

  it("ignores regenerated limit ids and limit order but not limit values", () => {
    const limit = (id: string, pollutantCode: string, limitValue: string) => ({
      id,
      limitValue,
      pollutantCode,
    });
    const before = {
      limits: [limit("a", "NOX", "0.4"), limit("b", "PM", "0.01")],
    };
    expect(
      canonicalFixturePayload("regulation", {
        limits: [limit("y", "PM", "0.01"), limit("x", "NOX", "0.4")],
      }),
    ).toBe(canonicalFixturePayload("regulation", before));
    expect(
      canonicalFixturePayload("regulation", {
        limits: [limit("x", "NOX", "0.46"), limit("y", "PM", "0.01")],
      }),
    ).not.toBe(canonicalFixturePayload("regulation", before));
  });
});

describe("publishFixtureIfChanged", () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;
  let governance: ReturnType<typeof createGovernanceRepository>;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    governance = createGovernanceRepository(testDatabase.database);
  }, 60_000);

  afterAll(async () => {
    await testDatabase.client.close();
  });

  const publish = (payload: Record<string, unknown>) =>
    publishFixtureIfChanged({
      database: testDatabase.database,
      editor,
      entityKey: sourceId,
      entityType: "data_source",
      governance,
      payload,
      reason: "Fixture readback",
      reviewer,
    });

  const history = async () => ({
    drafts: await testDatabase.database
      .select({ version: schema.dataGovernanceDrafts.version })
      .from(schema.dataGovernanceDrafts)
      .where(eq(schema.dataGovernanceDrafts.entityKey, sourceId)),
    logs: await testDatabase.database
      .select({ action: schema.dataChangeLogs.action })
      .from(schema.dataChangeLogs)
      .where(
        and(
          eq(schema.dataChangeLogs.entityType, "data_source"),
          eq(schema.dataChangeLogs.entityKey, sourceId),
        ),
      ),
  });

  it("publishes once, then skips an identical republish without new history", async () => {
    expect(await publish(sourcePayload())).toBe("published");
    const first = await history();
    expect(first.drafts).toHaveLength(1);

    expect(await publish(sourcePayload())).toBe("unchanged");
    const second = await history();
    expect(second.drafts).toHaveLength(1);
    expect(second.logs).toHaveLength(first.logs.length);
  });

  it("publishes a new version when a field changes", async () => {
    expect(await publish(sourcePayload("Official register, 2026"))).toBe(
      "published",
    );
    const { drafts } = await history();
    expect(drafts.map(({ version }) => version).toSorted()).toEqual([1, 2]);
  });

  it("does not skip an archived entity: the governed path still decides", async () => {
    await governance.archiveEntity({
      actor: reviewer,
      entityKey: sourceId,
      entityType: "data_source",
      reason: "Archive for the test",
    });
    // Same behaviour as before the skip existed: governance refuses to
    // recreate an archived entity through an update, so nothing is hidden.
    await expect(
      publish(sourcePayload("Official register, 2026")),
    ).rejects.toThrow(/active formal entity/u);
  });
});
