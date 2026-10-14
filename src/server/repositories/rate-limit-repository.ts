import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { z } from "zod";

import * as schema from "@/server/db/schema";
import { apiRateLimitBuckets } from "@/server/db/schema";

type RateLimitBucketInput = {
  keyHash: string;
  limit: number;
  scope: string;
};

export type ReserveAiChatHourlyRequestInput = {
  client: RateLimitBucketInput;
  expiresAt: Date;
  global: RateLimitBucketInput;
  now: Date;
  windowStart: Date;
};

export type ReserveAiChatHourlyRequestResult =
  | {
      allowed: true;
      clientCount: number;
      globalCount: number;
    }
  | { allowed: false };

type AiChatAdmissionBucketInput = RateLimitBucketInput;

export type ReserveAiChatAdmissionProviderCallUnitsInput = {
  client: AiChatAdmissionBucketInput;
  global: AiChatAdmissionBucketInput;
  now: Date;
  resetAt: Date;
  units: number;
  windowStart: Date;
};

export type RateLimitRepository = {
  cleanupExpiredBuckets: () => Promise<void>;
  reserveAiChatHourlyRequest: (
    input: ReserveAiChatHourlyRequestInput,
  ) => Promise<ReserveAiChatHourlyRequestResult>;
  reserveAiChatAdmissionProviderCallUnits: (
    input: ReserveAiChatAdmissionProviderCallUnitsInput,
  ) => Promise<boolean>;
};

export const RATE_LIMIT_LOCK_TIMEOUT_MS = 1_500;
export const RATE_LIMIT_STATEMENT_TIMEOUT_MS = 2_500;
export const RATE_LIMIT_IDLE_TRANSACTION_TIMEOUT_MS = 5_000;
export const RATE_LIMIT_CLEANUP_BATCH_SIZE = 500;
// This exceeds the 120-second chat response lease and database statement
// deadline. Cleanup is retention-only, so keeping a wider boundary grace is
// preferable to contending with a request that entered the previous window.
export const RATE_LIMIT_CLEANUP_GRACE_MS = 10 * 60 * 1_000;

const UTC_DAY_MS = 24 * 60 * 60 * 1_000;
const HOUR_MS = 60 * 60 * 1_000;
const MAX_BUCKET_COUNT = 2_000_000_000;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SCOPE_PATTERN = /^[a-z0-9-]+$/;

class AiChatAdmissionBudgetExhaustedError extends Error {
  constructor() {
    super("AI chat admission budget exhausted.");
    this.name = "AiChatAdmissionBudgetExhaustedError";
  }
}

class AiChatHourlyRateLimitExhaustedError extends Error {
  constructor() {
    super("AI chat hourly rate limit exhausted.");
    this.name = "AiChatHourlyRateLimitExhaustedError";
  }
}

function assertSafeBucketInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_BUCKET_COUNT) {
    throw new Error(
      `${name} must be a positive safe integer no greater than ${MAX_BUCKET_COUNT}.`,
    );
  }
}

function assertValidAdmissionInput(
  input: ReserveAiChatAdmissionProviderCallUnitsInput,
): void {
  assertSafeBucketInteger("Admission units", input.units);
  for (const [name, bucket] of [
    ["Global", input.global],
    ["Client", input.client],
  ] as const) {
    assertSafeBucketInteger(`${name} admission limit`, bucket.limit);
    if (bucket.limit < input.units) {
      throw new Error(`${name} admission limit cannot be below one reserve.`);
    }
    if (bucket.limit % input.units !== 0) {
      throw new Error(`${name} admission limit must align to reserve units.`);
    }
    if (!SHA256_PATTERN.test(bucket.keyHash)) {
      throw new Error(`${name} admission key must be a SHA-256 digest.`);
    }
    if (
      bucket.scope.length < 1 ||
      bucket.scope.length > 80 ||
      !SCOPE_PATTERN.test(bucket.scope)
    ) {
      throw new Error(`${name} admission scope is invalid.`);
    }
  }
  if (
    input.global.scope === input.client.scope ||
    input.global.keyHash === input.client.keyHash
  ) {
    throw new Error("Global and client admission buckets must be separated.");
  }
  if (input.client.limit > input.global.limit) {
    throw new Error("Client admission limit cannot exceed the global limit.");
  }

  const nowMs = input.now.getTime();
  const resetAtMs = input.resetAt.getTime();
  const windowStartMs = input.windowStart.getTime();
  if (
    !Number.isSafeInteger(nowMs) ||
    !Number.isSafeInteger(resetAtMs) ||
    !Number.isSafeInteger(windowStartMs) ||
    windowStartMs < 0 ||
    nowMs < windowStartMs ||
    nowMs >= resetAtMs ||
    resetAtMs - windowStartMs !== UTC_DAY_MS ||
    input.windowStart.getUTCHours() !== 0 ||
    input.windowStart.getUTCMinutes() !== 0 ||
    input.windowStart.getUTCSeconds() !== 0 ||
    input.windowStart.getUTCMilliseconds() !== 0
  ) {
    throw new Error("Admission window must be one current UTC day.");
  }
}

function assertValidHourlyInput(
  input: ReserveAiChatHourlyRequestInput,
): void {
  for (const [name, bucket] of [
    ["Global", input.global],
    ["Client", input.client],
  ] as const) {
    assertSafeBucketInteger(`${name} hourly limit`, bucket.limit);
    if (!SHA256_PATTERN.test(bucket.keyHash)) {
      throw new Error(`${name} hourly key must be a SHA-256 digest.`);
    }
    if (
      bucket.scope.length < 1 ||
      bucket.scope.length > 80 ||
      !SCOPE_PATTERN.test(bucket.scope)
    ) {
      throw new Error(`${name} hourly scope is invalid.`);
    }
  }
  if (input.global.scope === input.client.scope) {
    throw new Error("Global and client hourly buckets must be separated.");
  }
  if (input.client.limit > input.global.limit) {
    throw new Error("Client hourly limit cannot exceed the global limit.");
  }

  const nowMs = input.now.getTime();
  const expiresAtMs = input.expiresAt.getTime();
  const windowStartMs = input.windowStart.getTime();
  if (
    !Number.isSafeInteger(nowMs) ||
    !Number.isSafeInteger(expiresAtMs) ||
    !Number.isSafeInteger(windowStartMs) ||
    windowStartMs < 0 ||
    windowStartMs % HOUR_MS !== 0 ||
    nowMs < windowStartMs ||
    nowMs >= expiresAtMs ||
    expiresAtMs - windowStartMs !== HOUR_MS
  ) {
    throw new Error("Hourly rate-limit window must be one current aligned hour.");
  }
}

function assertValidReservedCount(
  count: number,
  limit: number,
  units: number,
): void {
  if (
    !Number.isSafeInteger(count) ||
    count < units ||
    count > limit ||
    count % units !== 0
  ) {
    throw new Error("Admission bucket returned an invalid reserved count.");
  }
}

function assertValidHourlyCount(count: number, limit: number): void {
  if (!Number.isSafeInteger(count) || count < 1 || count > limit) {
    throw new Error("Hourly rate-limit bucket returned an invalid count.");
  }
}

const pairRowSchema = z.strictObject({
  globalCount: z.number().int().nullable(),
  clientCount: z.number().int().nullable(),
}).refine((row) => row.globalCount !== null || row.clientCount === null);
const pairRowsSchema = z.array(pairRowSchema).length(1);
const pairResultSchema = z.union([
  pairRowsSchema,
  z.object({ rows: pairRowsSchema }).passthrough(),
]);

function readReservedPair(result: unknown) {
  const parsed = pairResultSchema.parse(result);
  return (Array.isArray(parsed) ? parsed : parsed.rows)[0];
}

function reservePairQuery(input: {
  client: RateLimitBucketInput;
  global: RateLimitBucketInput;
  now: Date;
  windowStart: Date;
  expiresAt: Date;
  units: number;
}) {
  // The client INSERT depends on the global RETURNING relation: keep lock
  // ordering, and do not create a client bucket when global admission fails.
  // Both writes run in one server command. No network round trip separates
  // acquiring the shared global row lock from reserving the client bucket.
  // A missing result still throws inside the enclosing transaction, rolling
  // back the provisional global increment when the client bucket is full.
  return sql`
    with global_reservation as (
      insert into ${apiRateLimitBuckets}
        (scope, key_hash, window_start, request_count, expires_at, updated_at)
      values (
        ${input.global.scope}, ${input.global.keyHash},
        ${input.windowStart.toISOString()}, ${input.units},
        ${input.expiresAt.toISOString()}, ${input.now.toISOString()}
      )
      on conflict (scope, key_hash, window_start) do update set
        request_count = ${apiRateLimitBuckets.requestCount} + ${input.units},
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
      where ${apiRateLimitBuckets.requestCount} <= ${input.global.limit - input.units}
      returning request_count
    ), client_reservation as (
      insert into ${apiRateLimitBuckets}
        (scope, key_hash, window_start, request_count, expires_at, updated_at)
      select
        ${input.client.scope}, ${input.client.keyHash},
        ${input.windowStart.toISOString()}::timestamptz, ${input.units},
        ${input.expiresAt.toISOString()}::timestamptz,
        ${input.now.toISOString()}::timestamptz
      from global_reservation
      on conflict (scope, key_hash, window_start) do update set
        request_count = ${apiRateLimitBuckets.requestCount} + ${input.units},
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
      where ${apiRateLimitBuckets.requestCount} <= ${input.client.limit - input.units}
      returning request_count
    )
    select
      (select request_count from global_reservation) as "globalCount",
      (select request_count from client_reservation) as "clientCount"
  `;
}

/**
 * PostgreSQL-backed rate-limit counters shared by every application instance.
 * Hourly request admission reserves the global and client buckets in one
 * transaction and never commits a counter above its configured limit.
 */
export function createRateLimitRepository<
  TQueryResult extends PgQueryResultHKT,
>(database: PgDatabase<TQueryResult, typeof schema>): RateLimitRepository {
  return {
    async cleanupExpiredBuckets() {
      await database.transaction(async (transaction) => {
        await transaction.execute(sql`
          select
            set_config(
              'statement_timeout',
              ${String(RATE_LIMIT_STATEMENT_TIMEOUT_MS)},
              true
            ),
            set_config(
              'lock_timeout',
              ${String(RATE_LIMIT_LOCK_TIMEOUT_MS)},
              true
            ),
            set_config(
              'idle_in_transaction_session_timeout',
              ${String(RATE_LIMIT_IDLE_TRANSACTION_TIMEOUT_MS)},
              true
            )
        `);

        await transaction.execute(sql`
          with expired_buckets as (
            select
              ${apiRateLimitBuckets.scope},
              ${apiRateLimitBuckets.keyHash},
              ${apiRateLimitBuckets.windowStart}
            from ${apiRateLimitBuckets}
            where ${apiRateLimitBuckets.expiresAt} <=
              statement_timestamp() -
              (${RATE_LIMIT_CLEANUP_GRACE_MS} * interval '1 millisecond')
            order by
              ${apiRateLimitBuckets.expiresAt} asc,
              ${apiRateLimitBuckets.scope} asc,
              ${apiRateLimitBuckets.keyHash} asc,
              ${apiRateLimitBuckets.windowStart} asc
            limit ${RATE_LIMIT_CLEANUP_BATCH_SIZE}
            for update skip locked
          )
          delete from ${apiRateLimitBuckets} as bucket
          using expired_buckets as expired
          where bucket.scope = expired.scope
            and bucket.key_hash = expired.key_hash
            and bucket.window_start = expired.window_start
        `);
      });
    },
    async reserveAiChatHourlyRequest(input) {
      assertValidHourlyInput(input);

      try {
        return await database.transaction(async (transaction) => {
          await transaction.execute(sql`
            select
              set_config(
                'statement_timeout',
                ${String(RATE_LIMIT_STATEMENT_TIMEOUT_MS)},
                true
              ),
              set_config(
                'lock_timeout',
                ${String(RATE_LIMIT_LOCK_TIMEOUT_MS)},
                true
              ),
              set_config(
                'idle_in_transaction_session_timeout',
                ${String(RATE_LIMIT_IDLE_TRANSACTION_TIMEOUT_MS)},
                true
              )
          `);

          const { globalCount, clientCount } = readReservedPair(
            await transaction.execute(reservePairQuery({ ...input, units: 1 })),
          );
          if (globalCount === null) throw new AiChatHourlyRateLimitExhaustedError();
          assertValidHourlyCount(globalCount, input.global.limit);
          if (clientCount === null) throw new AiChatHourlyRateLimitExhaustedError();
          assertValidHourlyCount(clientCount, input.client.limit);
          return { allowed: true, clientCount, globalCount } as const;
        });
      } catch (error: unknown) {
        if (error instanceof AiChatHourlyRateLimitExhaustedError) {
          return { allowed: false };
        }
        throw error;
      }
    },
    async reserveAiChatAdmissionProviderCallUnits(input) {
      assertValidAdmissionInput(input);

      try {
        return await database.transaction(async (transaction) => {
          await transaction.execute(sql`
            select
              set_config(
                'statement_timeout',
                ${String(RATE_LIMIT_STATEMENT_TIMEOUT_MS)},
                true
              ),
              set_config(
                'lock_timeout',
                ${String(RATE_LIMIT_LOCK_TIMEOUT_MS)},
                true
              ),
              set_config(
                'idle_in_transaction_session_timeout',
                ${String(RATE_LIMIT_IDLE_TRANSACTION_TIMEOUT_MS)},
                true
              )
          `);

          const { globalCount, clientCount } = readReservedPair(
            await transaction.execute(reservePairQuery({ ...input, expiresAt: input.resetAt })),
          );
          if (globalCount === null) throw new AiChatAdmissionBudgetExhaustedError();
          assertValidReservedCount(globalCount, input.global.limit, input.units);
          if (clientCount === null) throw new AiChatAdmissionBudgetExhaustedError();
          assertValidReservedCount(clientCount, input.client.limit, input.units);
          return true;
        });
      } catch (error: unknown) {
        if (error instanceof AiChatAdmissionBudgetExhaustedError) {
          return false;
        }
        throw error;
      }
    },
  };
}
