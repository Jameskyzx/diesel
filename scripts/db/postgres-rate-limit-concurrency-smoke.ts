import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import {
  drizzle,
  type PostgresJsDatabase,
} from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";

import * as schema from "../../src/server/db/schema";
import {
  AI_CHAT_RATE_LIMIT_WINDOW_MS,
  createPostgresRateLimiter,
  type RateLimitDecision,
} from "../../src/server/http/rate-limit";
import { createRateLimitRepository } from "../../src/server/repositories/rate-limit-repository";
import {
  validatePostgresConcurrencyReadback,
  validatePostgresConcurrencySmokeTarget,
} from "./postgres-governance-concurrency-smoke";

const repositoryPoolCount = 4;
const repositoryPoolSize = 2;
const closeTimeoutSeconds = 2;
const globalHashDomain = "diesel:ai-chat-hourly-rate-limit:v1:global";

export const postgresRateLimitConcurrencySmokeScenarioNames = [
  "global exhaustion across distinct clients",
  "client exhaustion rolls back the global reservation",
] as const;

type SmokeEnvironment = Readonly<Record<string, string | undefined>>;

type RateLimitSmokeRow = {
  keyHash: string;
  requestCount: number;
  scope: string;
};

export type PostgresRateLimitScenarioReadback = {
  clientKeys: readonly string[];
  clientLimit: number;
  clientScope: string;
  decisions: readonly RateLimitDecision[];
  expectedAllowed: number;
  globalLimit: number;
  globalScope: string;
  rows: readonly RateLimitSmokeRow[];
};

export type PostgresRateLimitSmokeErrors = {
  cleanupError?: unknown;
  closeErrors?: readonly unknown[];
  primaryError?: unknown;
};

type SmokePool = {
  client: Sql;
  database: PostgresJsDatabase<typeof schema>;
};

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function composePostgresRateLimitSmokeError(
  input: PostgresRateLimitSmokeErrors,
): unknown | null {
  const teardownErrors = [
    ...(input.cleanupError === undefined
      ? []
      : [new Error(`fixture cleanup: ${errorMessage(input.cleanupError)}`, {
          cause: input.cleanupError,
        })]),
    ...(input.closeErrors ?? []).map(
      (error, index) =>
        new Error(`pool close ${index + 1}: ${errorMessage(error)}`, {
          cause: error,
        }),
    ),
  ];

  if (input.primaryError !== undefined) {
    if (teardownErrors.length === 0) return input.primaryError;
    return new AggregateError(
      [input.primaryError, ...teardownErrors],
      "PostgreSQL rate-limit concurrency smoke failed and teardown also failed.",
      { cause: input.primaryError },
    );
  }
  if (teardownErrors.length > 0) {
    return new AggregateError(
      teardownErrors,
      "PostgreSQL rate-limit concurrency smoke teardown failed.",
    );
  }
  return null;
}

export function validatePostgresRateLimitConcurrencySmokeTarget(
  environment: SmokeEnvironment = process.env,
): URL {
  return validatePostgresConcurrencySmokeTarget(environment);
}

export function validatePostgresRateLimitSmokeSessionPids(
  backendPids: readonly number[],
): void {
  assert.equal(
    backendPids.length,
    repositoryPoolCount + 1,
    "the monitor and every repository pool must report a backend PID",
  );
  for (const backendPid of backendPids) {
    assert.ok(
      Number.isSafeInteger(backendPid) && backendPid > 0,
      "every PostgreSQL backend PID must be a positive safe integer",
    );
  }
  assert.equal(
    new Set(backendPids).size,
    backendPids.length,
    "the monitor and repository pools must use distinct PostgreSQL sessions",
  );
}

function hashClientKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function validatePostgresRateLimitScenarioReadback(
  input: PostgresRateLimitScenarioReadback,
): void {
  assert.equal(
    input.decisions.length,
    input.clientKeys.length,
    "every attempted reservation must have one decision",
  );
  assert.ok(
    Number.isSafeInteger(input.expectedAllowed) && input.expectedAllowed > 0,
    "the expected admitted count must be a positive safe integer",
  );
  assert.ok(
    input.expectedAllowed <= input.globalLimit,
    "the expected admitted count cannot exceed the global limit",
  );

  const expectedClientCounts = new Map<string, number>();
  let allowedCount = 0;
  for (const [index, decision] of input.decisions.entries()) {
    assert.equal(decision.limit, input.clientLimit);
    if (decision.allowed) {
      allowedCount += 1;
      assert.equal(decision.retryAfterSeconds, 0);
      assert.ok(decision.remaining >= 0);
      assert.ok(decision.remaining < input.clientLimit);
      assert.ok(decision.remaining < input.globalLimit);
      const key = input.clientKeys[index];
      assert.ok(key, "an allowed decision must retain its client key");
      const keyHash = hashClientKey(key);
      expectedClientCounts.set(
        keyHash,
        (expectedClientCounts.get(keyHash) ?? 0) + 1,
      );
    } else {
      assert.equal(decision.remaining, 0);
      assert.ok(decision.retryAfterSeconds > 0);
      assert.ok(decision.retryAfterSeconds <= 3_600);
    }
  }
  assert.equal(allowedCount, input.expectedAllowed);

  const globalRows = input.rows.filter(
    ({ scope }) => scope === input.globalScope,
  );
  assert.equal(globalRows.length, 1, "the global scope must contain one row");
  assert.equal(
    globalRows[0]?.keyHash,
    createHash("sha256").update(globalHashDomain).digest("hex"),
  );
  assert.equal(globalRows[0]?.requestCount, input.expectedAllowed);
  assert.ok((globalRows[0]?.requestCount ?? 0) <= input.globalLimit);

  const clientRows = input.rows.filter(
    ({ scope }) => scope === input.clientScope,
  );
  assert.equal(
    clientRows.length,
    expectedClientCounts.size,
    "only clients with committed reservations may have rows",
  );
  for (const row of clientRows) {
    const expectedCount = expectedClientCounts.get(row.keyHash);
    assert.notEqual(
      expectedCount,
      undefined,
      "a rejected-only client must not have a committed row",
    );
    assert.equal(row.requestCount, expectedCount);
    assert.ok(row.requestCount <= input.clientLimit);
  }
  assert.equal(
    input.rows.length,
    1 + expectedClientCounts.size,
    "the isolated scopes must not contain unexpected rows",
  );
}

function createSmokePool(databaseUrl: URL, index: number): SmokePool {
  const client = postgres(databaseUrl.toString(), {
    connect_timeout: 5,
    connection: {
      application_name: `diesel-rate-limit-concurrency-smoke-${index}`,
      idle_in_transaction_session_timeout: 10_000,
      lock_timeout: 5_000,
      statement_timeout: 10_000,
    },
    idle_timeout: 5,
    max: repositoryPoolSize,
    max_lifetime: 60,
    prepare: false,
  });
  return {
    client,
    database: drizzle(client, { schema }),
  };
}

async function readAndValidateTarget(client: Sql): Promise<void> {
  const rows = await client<{
    currentDatabase: string;
    serverVersionNum: number;
    vectorInstalled: boolean;
  }[]>`
    select
      current_database() as "currentDatabase",
      current_setting('server_version_num')::int as "serverVersionNum",
      exists (
        select 1 from pg_extension where extname = 'vector'
      ) as "vectorInstalled"
  `;
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.ok(row);
  validatePostgresConcurrencyReadback(row);
}

async function readAndValidateSessionTopology(
  monitor: Sql,
  pools: readonly SmokePool[],
): Promise<void> {
  const clients = [monitor, ...pools.map(({ client }) => client)];
  const rows = await Promise.all(
    clients.map((client) =>
      client<{ backendPid: number }[]>`
        select pg_backend_pid()::int as "backendPid"
      `,
    ),
  );
  validatePostgresRateLimitSmokeSessionPids(
    rows.map((result) => {
      assert.equal(result.length, 1);
      const row = result[0];
      assert.ok(row);
      return row.backendPid;
    }),
  );
}

async function countScopeRows(client: Sql, scopes: readonly string[]): Promise<number> {
  let count = 0;
  for (const scope of scopes) {
    const rows = await client<{ count: number }[]>`
      select count(*)::int as count
      from api_rate_limit_buckets
      where scope = ${scope}
    `;
    assert.equal(rows.length, 1);
    count += rows[0]?.count ?? 0;
  }
  return count;
}

async function cleanupScopes(client: Sql, scopes: readonly string[]): Promise<void> {
  for (const scope of scopes) {
    await client`
      delete from api_rate_limit_buckets
      where scope = ${scope}
    `;
  }
  assert.equal(await countScopeRows(client, scopes), 0);
}

async function readScenarioRows(input: {
  client: Sql;
  clientScope: string;
  globalScope: string;
  windowStart: Date;
}): Promise<RateLimitSmokeRow[]> {
  return input.client<RateLimitSmokeRow[]>`
    select
      key_hash as "keyHash",
      request_count as "requestCount",
      scope
    from api_rate_limit_buckets
    where window_start = ${input.windowStart}
      and (scope = ${input.clientScope} or scope = ${input.globalScope})
    order by scope, key_hash
  `;
}

async function runScenario(input: {
  clientKeys: readonly string[];
  clientLimit: number;
  clientScope: string;
  expectedAllowed: number;
  globalLimit: number;
  globalScope: string;
  monitor: Sql;
  nowMs: number;
  pools: readonly SmokePool[];
}): Promise<void> {
  const cleanupScheduler = { schedule() {} };
  const limiters = input.pools.map(({ database }) =>
    createPostgresRateLimiter({
      cleanupScheduler,
      globalLimit: input.globalLimit,
      globalScope: input.globalScope,
      limit: input.clientLimit,
      repository: createRateLimitRepository(database),
      scope: input.clientScope,
      windowMs: AI_CHAT_RATE_LIMIT_WINDOW_MS,
    }),
  );
  const reservationResults = await Promise.allSettled(
    input.clientKeys.map((key, index) =>
      limiters[index % limiters.length]!.check(key, input.nowMs),
    ),
  );
  const decisions: RateLimitDecision[] = [];
  const reservationErrors: unknown[] = [];
  for (const result of reservationResults) {
    if (result.status === "fulfilled") decisions.push(result.value);
    else reservationErrors.push(normalizeError(result.reason));
  }
  if (reservationErrors.length > 0) {
    throw new AggregateError(
      reservationErrors,
      "PostgreSQL rate-limit reservations did not all settle successfully.",
    );
  }
  const windowStart = new Date(
    Math.floor(input.nowMs / AI_CHAT_RATE_LIMIT_WINDOW_MS) *
      AI_CHAT_RATE_LIMIT_WINDOW_MS,
  );
  const rows = await readScenarioRows({
    client: input.monitor,
    clientScope: input.clientScope,
    globalScope: input.globalScope,
    windowStart,
  });
  validatePostgresRateLimitScenarioReadback({
    clientKeys: input.clientKeys,
    clientLimit: input.clientLimit,
    clientScope: input.clientScope,
    decisions,
    expectedAllowed: input.expectedAllowed,
    globalLimit: input.globalLimit,
    globalScope: input.globalScope,
    rows,
  });
}

export async function runPostgresRateLimitConcurrencySmoke(): Promise<void> {
  const databaseUrl = validatePostgresRateLimitConcurrencySmokeTarget();
  const nonce = randomUUID().replaceAll("-", "");
  const scopes = {
    clientExhaustionClient: `ai-chat-hourly-pg-client-${nonce}`,
    clientExhaustionGlobal: `ai-chat-hourly-pg-client-global-${nonce}`,
    globalExhaustionClient: `ai-chat-hourly-pg-global-${nonce}`,
    globalExhaustionGlobal: `ai-chat-hourly-pg-global-global-${nonce}`,
  } as const;
  const ownedScopes = Object.values(scopes);
  const monitor = postgres(databaseUrl.toString(), {
    connect_timeout: 5,
    connection: {
      application_name: "diesel-rate-limit-concurrency-smoke-monitor",
      idle_in_transaction_session_timeout: 10_000,
      lock_timeout: 5_000,
      statement_timeout: 10_000,
    },
    idle_timeout: 5,
    max: 1,
    max_lifetime: 60,
    prepare: false,
  });
  const pools = Array.from({ length: repositoryPoolCount }, (_, index) =>
    createSmokePool(databaseUrl, index + 1),
  );

  let ownsScopes = false;
  let primaryError: unknown;
  try {
    await readAndValidateTarget(monitor);
    await readAndValidateSessionTopology(monitor, pools);
    assert.equal(
      await countScopeRows(monitor, ownedScopes),
      0,
      "rate-limit smoke scope collision; refusing to reuse existing rows",
    );
    ownsScopes = true;

    const nowMs = Date.now();
    const distinctClientKeys = Array.from(
      { length: 16 },
      (_, index) => `global-client-${nonce}-${index}`,
    );
    await runScenario({
      clientKeys: distinctClientKeys,
      clientLimit: 3,
      clientScope: scopes.globalExhaustionClient,
      expectedAllowed: 6,
      globalLimit: 6,
      globalScope: scopes.globalExhaustionGlobal,
      monitor,
      nowMs,
      pools,
    });

    await runScenario({
      clientKeys: Array.from(
        { length: 12 },
        () => `shared-client-${nonce}`,
      ),
      clientLimit: 3,
      clientScope: scopes.clientExhaustionClient,
      expectedAllowed: 3,
      globalLimit: 12,
      globalScope: scopes.clientExhaustionGlobal,
      monitor,
      nowMs,
      pools,
    });
  } catch (error: unknown) {
    primaryError = normalizeError(error);
  }

  let cleanupError: unknown;
  if (ownsScopes) {
    try {
      await cleanupScopes(monitor, ownedScopes);
    } catch (error: unknown) {
      cleanupError = normalizeError(error);
    }
  }

  const closeResults = await Promise.allSettled([
    ...pools.map(({ client }) => client.end({ timeout: closeTimeoutSeconds })),
    monitor.end({ timeout: closeTimeoutSeconds }),
  ]);
  const closeErrors = closeResults.flatMap((result) =>
    result.status === "rejected" ? [normalizeError(result.reason)] : [],
  );
  const composedError = composePostgresRateLimitSmokeError({
    cleanupError,
    closeErrors,
    primaryError,
  });
  if (composedError !== null) throw composedError;
}

async function main(): Promise<void> {
  await runPostgresRateLimitConcurrencySmoke();
  process.stdout.write(
    `PostgreSQL AI chat rate-limit concurrency smoke passed (${postgresRateLimitConcurrencySmokeScenarioNames.length} scenarios).\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main().catch((error: unknown) => {
    process.stderr.write(
      `PostgreSQL AI chat rate-limit concurrency smoke failed: ${errorMessage(error)}\n`,
    );
    process.exitCode = 1;
  });
}
