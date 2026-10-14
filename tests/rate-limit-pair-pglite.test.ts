import { createHash } from "node:crypto";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { apiRateLimitBuckets } from "@/server/db/schema";
import * as schema from "@/server/db/schema";
import { createRateLimitRepository } from "@/server/repositories/rate-limit-repository";
import { createTestDatabase } from "./helpers/database";

describe("atomic global/client reservations in PostgreSQL-compatible PGlite", () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeAll(async () => { testDatabase = await createTestDatabase(); }, 30_000);
  afterAll(async () => { await testDatabase.client.close(); });
  beforeEach(async () => { await testDatabase.database.delete(apiRateLimitBuckets); });

  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const now = new Date("2026-10-15T00:00:01.000Z");
  const windowStart = new Date("2026-10-15T00:00:00.000Z");

  function reserve(kind: "hourly" | "daily", client: string, globalLimit: number, clientLimit: number) {
    const repository = createRateLimitRepository(testDatabase.database);
    const input = {
      now, windowStart,
      global: { scope: "pair-global", keyHash: hash("global"), limit: globalLimit },
      client: { scope: "pair-client", keyHash: hash(client), limit: clientLimit },
    };
    return kind === "hourly"
      ? repository.reserveAiChatHourlyRequest({ ...input, expiresAt: new Date(+windowStart + 3_600_000) })
        .then((result) => result.allowed)
      : repository.reserveAiChatAdmissionProviderCallUnits({
        ...input, units: 5, resetAt: new Date(+windowStart + 86_400_000),
      });
  }

  it("dispatches both writes together after the separate transaction timeout setup", async () => {
    const commands: string[] = [];
    const database = drizzle(testDatabase.client, {
      schema,
      logger: { logQuery(query) { commands.push(query); } },
    });
    await createRateLimitRepository(database).reserveAiChatHourlyRequest({
      now, windowStart, expiresAt: new Date(+windowStart + 3_600_000),
      global: { scope: "pair-global", keyHash: hash("global"), limit: 10 },
      client: { scope: "pair-client", keyHash: hash("client"), limit: 5 },
    });
    const writes = commands.filter((query) => /insert into/iu.test(query));
    expect(writes).toHaveLength(1);
    expect(writes[0].match(/insert into/giu)).toHaveLength(2);
    expect(commands.findIndex((query) => query.includes("set_config")))
      .toBeLessThan(commands.indexOf(writes[0]));
  });

  it.each(["hourly", "daily"] as const)("%s rolls back global increment on client exhaustion and creates no client on global exhaustion", async (kind) => {
    const units = kind === "hourly" ? 1 : 5;
    expect(await reserve(kind, "a", 2 * units, units)).toBe(true);
    expect(await reserve(kind, "a", 2 * units, units)).toBe(false);
    expect(await reserve(kind, "b", 2 * units, units)).toBe(true);
    expect(await reserve(kind, "c", 2 * units, units)).toBe(false);
    const rows = await testDatabase.database.select().from(apiRateLimitBuckets);
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.scope === "pair-global")?.requestCount).toBe(2 * units);
    expect(rows.filter((row) => row.scope === "pair-client").map((row) => row.requestCount)).toEqual([units, units]);
    expect(rows.some((row) => row.keyHash === hash("c"))).toBe(false);
  });

  it.each(["hourly", "daily"] as const)("%s never commits a partial pair or exceeds a saturated global budget", async (kind) => {
    const units = kind === "hourly" ? 1 : 5;
    const decisions = await Promise.all(Array.from({ length: 12 }, (_, index) =>
      reserve(kind, `client-${index}`, 3 * units, units)));
    expect(decisions.filter(Boolean)).toHaveLength(3);
    const rows = await testDatabase.database.select().from(apiRateLimitBuckets);
    expect(rows).toHaveLength(4);
    expect(rows.find((row) => row.scope === "pair-global")?.requestCount).toBe(3 * units);
    expect(rows.filter((row) => row.scope === "pair-client").reduce((total, row) => total + row.requestCount, 0))
      .toBe(3 * units);
  });
});
