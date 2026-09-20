import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { apiRateLimitBuckets } from "@/server/db/schema";
import {
  createRateLimitRepository,
  RATE_LIMIT_CLEANUP_BATCH_SIZE,
  RATE_LIMIT_CLEANUP_GRACE_MS,
} from "@/server/repositories/rate-limit-repository";
import { createTestDatabase } from "./helpers/database";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

const cleanupScope = "rate-limit-cleanup-pglite";

function bucketHash(label: string): string {
  return createHash("sha256").update(label).digest("hex");
}

describe("rate-limit retention cleanup in PGlite", () => {
  let testDatabase: TestDatabase;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
  }, 30_000);

  afterAll(async () => {
    await testDatabase.client.close();
  });

  it("deletes only one oldest batch and preserves grace/current rows", async () => {
    const referenceNowMs = Date.now();
    const oldestExpiryMs =
      referenceNowMs - RATE_LIMIT_CLEANUP_GRACE_MS - 24 * 60 * 60 * 1_000;
    const expiredRows = Array.from(
      { length: RATE_LIMIT_CLEANUP_BATCH_SIZE + 2 },
      (_, index) => {
        const expiresAt = new Date(oldestExpiryMs + index * 1_000);
        return {
          expiresAt,
          keyHash: bucketHash(`expired-${index}`),
          requestCount: 1,
          scope: cleanupScope,
          updatedAt: expiresAt,
          windowStart: new Date(expiresAt.getTime() - 60 * 60 * 1_000),
        };
      },
    );
    const withinGraceHash = bucketHash("within-grace");
    const futureHash = bucketHash("future");
    const withinGraceExpiry = new Date(
      referenceNowMs - Math.floor(RATE_LIMIT_CLEANUP_GRACE_MS / 2),
    );
    const futureExpiry = new Date(referenceNowMs + 60 * 60 * 1_000);

    await testDatabase.database.insert(apiRateLimitBuckets).values([
      ...expiredRows,
      {
        expiresAt: withinGraceExpiry,
        keyHash: withinGraceHash,
        requestCount: 1,
        scope: cleanupScope,
        updatedAt: withinGraceExpiry,
        windowStart: new Date(
          withinGraceExpiry.getTime() - 60 * 60 * 1_000,
        ),
      },
      {
        expiresAt: futureExpiry,
        keyHash: futureHash,
        requestCount: 1,
        scope: cleanupScope,
        updatedAt: new Date(referenceNowMs),
        windowStart: new Date(referenceNowMs),
      },
    ]);

    try {
      const repository = createRateLimitRepository(testDatabase.database);
      await repository.cleanupExpiredBuckets();

      const afterFirstBatch = await testDatabase.database
        .select({ keyHash: apiRateLimitBuckets.keyHash })
        .from(apiRateLimitBuckets)
        .where(eq(apiRateLimitBuckets.scope, cleanupScope));
      const remainingAfterFirstBatch = new Set(
        afterFirstBatch.map(({ keyHash }) => keyHash),
      );
      expect(afterFirstBatch).toHaveLength(4);
      expect(remainingAfterFirstBatch).toEqual(
        new Set([
          expiredRows[RATE_LIMIT_CLEANUP_BATCH_SIZE]!.keyHash,
          expiredRows[RATE_LIMIT_CLEANUP_BATCH_SIZE + 1]!.keyHash,
          withinGraceHash,
          futureHash,
        ]),
      );

      await repository.cleanupExpiredBuckets();
      const afterSecondBatch = await testDatabase.database
        .select({ keyHash: apiRateLimitBuckets.keyHash })
        .from(apiRateLimitBuckets)
        .where(eq(apiRateLimitBuckets.scope, cleanupScope));
      expect(new Set(afterSecondBatch.map(({ keyHash }) => keyHash))).toEqual(
        new Set([withinGraceHash, futureHash]),
      );
    } finally {
      await testDatabase.database
        .delete(apiRateLimitBuckets)
        .where(eq(apiRateLimitBuckets.scope, cleanupScope));
    }
  });
});
