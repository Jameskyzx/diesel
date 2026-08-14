import { lte, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "@/server/db/schema";
import { apiRateLimitBuckets } from "@/server/db/schema";

export type ConsumeRateLimitBucketInput = {
  expiresAt: Date;
  keyHash: string;
  limit: number;
  now: Date;
  scope: string;
  windowStart: Date;
};

export type RateLimitRepository = {
  consumeBucket: (input: ConsumeRateLimitBucketInput) => Promise<number>;
};

/**
 * PostgreSQL-backed rate-limit counter shared by every application instance.
 * The conflict update is a single atomic statement; the count is capped one
 * above the configured limit so abusive clients cannot overflow the integer.
 */
export function createRateLimitRepository<
  TQueryResult extends PgQueryResultHKT,
>(database: PgDatabase<TQueryResult, typeof schema>): RateLimitRepository {
  return {
    async consumeBucket(input) {
      return database.transaction(async (transaction) => {
        await transaction
          .delete(apiRateLimitBuckets)
          .where(lte(apiRateLimitBuckets.expiresAt, input.now));

        const [bucket] = await transaction
          .insert(apiRateLimitBuckets)
          .values({
            expiresAt: input.expiresAt,
            keyHash: input.keyHash,
            requestCount: 1,
            scope: input.scope,
            updatedAt: input.now,
            windowStart: input.windowStart,
          })
          .onConflictDoUpdate({
            set: {
              expiresAt: input.expiresAt,
              requestCount: sql`least(${apiRateLimitBuckets.requestCount} + 1, ${input.limit + 1})`,
              updatedAt: input.now,
            },
            target: [
              apiRateLimitBuckets.scope,
              apiRateLimitBuckets.keyHash,
              apiRateLimitBuckets.windowStart,
            ],
          })
          .returning({ requestCount: apiRateLimitBuckets.requestCount });

        if (!bucket) {
          throw new Error("Rate-limit bucket update returned no row.");
        }

        return bucket.requestCount;
      });
    },
  };
}
