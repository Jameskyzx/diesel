import { type ChildProcess, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  readFile,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { asc, gt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";

import { getDatabaseUrl } from "../../src/server/db/environment";
import {
  countries,
  countryJurisdictions,
  dataSources,
  jurisdictions,
  marketMetrics,
  regulationLimits,
  regulations,
} from "../../src/server/db/schema";
import { parseGovernanceSnapshotOptions } from "./governance-snapshot-options";
import {
  applyPreciseGovernanceTimestamps,
  applyRawGovernanceJson,
  createGovernanceTableCounts,
  governanceTableNames,
  parseGovernanceSnapshot,
  parsePreciseGovernanceTimestampRows,
  parseRawGovernanceJsonRows,
} from "./governance-snapshot-format";

export const governanceSnapshotPostgresOptions = {
  connect_timeout: 15,
  idle_timeout: undefined,
  keep_alive: 15,
  max: 1,
  max_lifetime: null,
  prepare: false,
} as const satisfies postgres.Options<Record<string, never>>;

export const governanceSnapshotMaximumWorkers = 2;
export const governanceSnapshotWorkerRetryDelayMs = 1_000;
export const governanceSnapshotWorkerTimeoutMs = 45 * 60 * 1_000;
export const governanceSnapshotWorkerTerminationGraceMs = 2_000;
export const governanceSnapshotDatabaseBatchSize = 500;
// Raw JSON can be tens of KiB per row. Keep these batches smaller on the
// production database link without weakening the SQL or worker deadlines.
export const governanceSnapshotRawJsonBatchSize = 100;
export const governanceSnapshotReaderMaximumAttempts = 3;
export const governanceSnapshotAnchorHeartbeatIntervalMs = 10_000;
const governanceSnapshotClientEndTimeoutSeconds = 5;
const governanceSnapshotReaderRetryDelayMs = 500;
const governanceSnapshotMaximumBytes = 256 * 1024 * 1024;
const governanceSnapshotMaximumWorkerOutputBytes = 64 * 1024;
const governanceSnapshotWorkerFlag = "--internal-governance-snapshot-worker";
const governanceSnapshotPermanentWorkerExitCode = 65;
const governanceSnapshotRetryableWorkerExitCode = 75;

const governanceSnapshotProgressSchema = z.object({
  kind: z.literal("governance-snapshot-progress-v1"),
  table: z.enum(governanceTableNames),
  batch: z.number().int().min(1).max(10_000),
  durationMs: z.number().int().min(0).max(governanceSnapshotWorkerTimeoutMs),
}).strict();
type GovernanceSnapshotProgress = z.infer<typeof governanceSnapshotProgressSchema>;

/** Only structured, bounded metadata can cross the worker diagnostics boundary. */
export function parseGovernanceSnapshotProgress(
  value: unknown,
): GovernanceSnapshotProgress | null {
  const parsed = governanceSnapshotProgressSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function reportGovernanceSnapshotProgress(progress: GovernanceSnapshotProgress) {
  if (process.argv[2] === governanceSnapshotWorkerFlag && process.connected) {
    process.send?.(progress);
  }
}

class GovernanceSnapshotPermanentAcquisitionFailure extends Error {
  constructor() {
    super("Governance snapshot acquisition failed permanently");
    this.name = "GovernanceSnapshotPermanentAcquisitionFailure";
  }
}

class GovernanceSnapshotRetryableAcquisitionFailure extends Error {
  constructor(message = "Governance snapshot acquisition must restart") {
    super(message);
    this.name = "GovernanceSnapshotRetryableAcquisitionFailure";
  }
}

type RetriableSnapshotClient = {
  end(options: { timeout: number }): Promise<unknown>;
  unsafe(query: string): PromiseLike<unknown>;
};

type TransactionalSnapshotClient<Transaction> = {
  begin<Result>(
    options: string,
    action: (transaction: Transaction) => Promise<Result>,
  ): Promise<Result>;
};

const governanceSnapshotIdSchema = z
  .string()
  .max(96)
  .regex(/^[0-9a-f]{8}-[0-9a-f]{8}-[0-9]+$/i);

export function parseGovernanceSnapshotId(value: unknown): string {
  const result = governanceSnapshotIdSchema.safeParse(value);
  if (!result.success) {
    throw new Error("Governance snapshot anchor returned an invalid snapshot ID");
  }
  return result.data;
}

const governanceSnapshotBatchedRowSchema = z
  .object({ id: z.uuid() })
  .passthrough();

type GovernanceSnapshotBatchedRow = z.infer<
  typeof governanceSnapshotBatchedRowSchema
>;

export async function collectGovernanceSnapshotRowsInBatches(
  fetchBatch: (
    cursor: string | null,
    limit: number,
  ) => Promise<readonly unknown[]>,
  batchSize = governanceSnapshotDatabaseBatchSize,
): Promise<GovernanceSnapshotBatchedRow[]> {
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0) {
    throw new Error("Governance snapshot batch size must be positive");
  }

  const rows: GovernanceSnapshotBatchedRow[] = [];
  let cursor: string | null = null;
  while (true) {
    const batch = governanceSnapshotBatchedRowSchema.array().parse(
      await fetchBatch(cursor, batchSize),
    );
    if (batch.length > batchSize) {
      throw new Error("Governance snapshot batch exceeded its requested size");
    }

    for (const row of batch) {
      if (cursor !== null && row.id <= cursor) {
        throw new Error("Governance snapshot batch cursor did not advance");
      }
      cursor = row.id;
      rows.push(row);
    }

    if (batch.length < batchSize) {
      return rows;
    }
  }
}

async function waitForGovernanceSnapshotImmediateTurn(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

export async function runSnapshotAcquisitionAttempt<
  Client extends RetriableSnapshotClient,
  Result,
>(
  client: Client,
  acquire: (client: Client) => Promise<Result>,
  retainSuccessfulClient?: (client: Client) => void,
): Promise<Result> {
  const acquisition = await acquire(client).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ error, ok: false as const }),
  );
  const settlement = await (async () => {
    // postgres-js batches protocol writes with setImmediate. Let every write
    // queued by COMMIT/ROLLBACK run while the socket is still live, then prove
    // the same connection can complete one final round trip before end().
    await waitForGovernanceSnapshotImmediateTurn();
    try {
      if (acquisition.ok) {
        await client.unsafe("select 1 as governance_snapshot_teardown_probe");
      }
    } finally {
      // The probe itself also schedules protocol work. Preserve this second
      // barrier on both success and failure before end() can null the socket.
      await waitForGovernanceSnapshotImmediateTurn();
    }
  })().then(
    () => ({ ok: true as const }),
    (error: unknown) => ({ error, ok: false as const }),
  );
  // Retain only after COMMIT/ROLLBACK writes have drained and the probe passed.
  // Failed reads/probes still close the client before any retry. The owner must
  // explicitly close the retained client when the exported snapshot ends.
  if (acquisition.ok && settlement.ok && retainSuccessfulClient) {
    try {
      retainSuccessfulClient(client);
      return acquisition.value;
    } catch (error) {
      await client.end({ timeout: governanceSnapshotClientEndTimeoutSeconds });
      throw error;
    }
  }
  const teardown = await client
    .end({ timeout: governanceSnapshotClientEndTimeoutSeconds })
    .then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ error, ok: false as const }),
    );

  if (!acquisition.ok) {
    throw acquisition.error;
  }
  if (!settlement.ok) {
    throw settlement.error;
  }
  if (!teardown.ok) {
    throw teardown.error;
  }
  return acquisition.value;
}

const retryableGovernanceSnapshotReaderCodes = new Set([
  "25P03",
  "57014",
  "57P01",
  "57P02",
  "57P03",
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_DESTROYED",
  "CONNECTION_ENDED",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT",
]);

function readErrorCode(error: unknown): string | null {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    typeof error.code !== "string"
  ) {
    return null;
  }
  return error.code;
}

export function isRetryableGovernanceSnapshotReaderError(
  error: unknown,
): boolean {
  // postgres-js can surface a closed-socket/protocol race as a code-less
  // TypeError instead of a transport error with SQLSTATE/errno. Treat it as
  // retryable only inside the already bounded reader-attempt boundary; a
  // deterministic TypeError still fails after three fresh clients and never
  // advances the batch cursor or publishes a partial snapshot.
  if (error instanceof TypeError) {
    return true;
  }
  const code = readErrorCode(error);
  return (
    code !== null &&
    (/^08[0-9A-Z]{3}$/.test(code) ||
      retryableGovernanceSnapshotReaderCodes.has(code))
  );
}

type GovernanceSnapshotReaderBatchInput<
  Client extends RetriableSnapshotClient,
  Result,
> = {
  assertAnchorHealthy: () => void;
  createClient: () => Client;
  maximumAttempts?: number;
  read: (client: Client) => Promise<Result>;
  retainSuccessfulClient?: (client: Client) => void;
  waitBeforeRetry?: () => Promise<void>;
};

export async function runGovernanceSnapshotReaderBatchWithRetry<
  Client extends RetriableSnapshotClient,
  Result,
>(
  input: GovernanceSnapshotReaderBatchInput<Client, Result>,
): Promise<Result> {
  const maximumAttempts = requirePositiveSafeInteger(
    input.maximumAttempts ?? governanceSnapshotReaderMaximumAttempts,
    "Governance snapshot reader maximum attempts",
  );

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    input.assertAnchorHealthy();
    try {
      const client = input.createClient();
      const result = await runSnapshotAcquisitionAttempt(client, input.read, input.retainSuccessfulClient);
      input.assertAnchorHealthy();
      return result;
    } catch (error: unknown) {
      input.assertAnchorHealthy();
      if (readErrorCode(error) === "22023") {
        throw new GovernanceSnapshotRetryableAcquisitionFailure();
      }
      if (!isRetryableGovernanceSnapshotReaderError(error)) {
        throw new GovernanceSnapshotPermanentAcquisitionFailure();
      }
      if (attempt === maximumAttempts) {
        throw new GovernanceSnapshotRetryableAcquisitionFailure();
      }
      await (input.waitBeforeRetry?.() ??
        new Promise<void>((resolve) => {
          setTimeout(resolve, governanceSnapshotReaderRetryDelayMs * attempt);
        }));
    }
  }

  throw new GovernanceSnapshotRetryableAcquisitionFailure();
}

type GovernanceSnapshotQueryTransaction = {
  unsafe(query: string): PromiseLike<unknown>;
};

async function initializeGovernanceSnapshotImportedTransaction<Result>(
  transaction: GovernanceSnapshotQueryTransaction,
  snapshotId: string,
  read: () => Promise<Result>,
): Promise<Result> {
  const validatedSnapshotId = parseGovernanceSnapshotId(snapshotId);
  await transaction.unsafe(`set transaction snapshot '${validatedSnapshotId}'`);
  await transaction.unsafe("set local statement_timeout = '120s'");
  await transaction.unsafe(
    "set local idle_in_transaction_session_timeout = '5min'",
  );
  return read();
}

export async function executeGovernanceSnapshotImportedTransaction<
  Transaction extends GovernanceSnapshotQueryTransaction,
  Result,
>(
  client: TransactionalSnapshotClient<Transaction>,
  snapshotId: string,
  read: (transaction: Transaction) => Promise<Result>,
): Promise<Result> {
  return client.begin(
    "isolation level repeatable read read only",
    (transaction) =>
      initializeGovernanceSnapshotImportedTransaction(
        transaction,
        snapshotId,
        () => read(transaction),
      ),
  );
}

type GovernanceSnapshotAnchorHeartbeat = {
  assertHealthy: () => void;
  stop: () => Promise<void>;
};

export function startGovernanceSnapshotAnchorHeartbeat(
  probe: () => Promise<unknown>,
  intervalMs = governanceSnapshotAnchorHeartbeatIntervalMs,
): GovernanceSnapshotAnchorHeartbeat {
  requirePositiveSafeInteger(
    intervalMs,
    "Governance snapshot anchor heartbeat interval",
  );
  let failure = false;
  let inFlight: Promise<void> | null = null;
  let stopped = false;

  const timer = setInterval(() => {
    if (stopped || inFlight !== null) {
      return;
    }
    const probeAttempt = probe()
      .then(() => undefined)
      .catch(() => {
        failure = true;
      })
      .finally(() => {
        if (inFlight === probeAttempt) {
          inFlight = null;
        }
      });
    inFlight = probeAttempt;
  }, intervalMs);
  timer.unref();

  const assertHealthy = () => {
    if (failure) {
      throw new GovernanceSnapshotRetryableAcquisitionFailure(
        "Governance snapshot anchor heartbeat failed",
      );
    }
  };

  return {
    assertHealthy,
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await inFlight;
      assertHealthy();
    },
  };
}

const exportedSnapshotResultSchema = z
  .array(z.object({ snapshotId: governanceSnapshotIdSchema }).strict())
  .length(1);

export async function executeGovernanceSnapshotAnchorTransaction<
  Transaction extends GovernanceSnapshotQueryTransaction,
  Result,
>(
  client: TransactionalSnapshotClient<Transaction>,
  action: (
    snapshotId: string,
    assertAnchorHealthy: () => void,
  ) => Promise<Result>,
  heartbeatIntervalMs = governanceSnapshotAnchorHeartbeatIntervalMs,
): Promise<Result> {
  return client.begin(
    "isolation level repeatable read read only",
    async (transaction) => {
      await transaction.unsafe("set local statement_timeout = '120s'");
      await transaction.unsafe(
        "set local idle_in_transaction_session_timeout = '60s'",
      );
      const snapshotResult = exportedSnapshotResultSchema.safeParse(
        await transaction.unsafe(
          'select pg_export_snapshot() as "snapshotId"',
        ),
      );
      if (!snapshotResult.success) {
        throw new Error(
          "Governance snapshot anchor returned an invalid snapshot ID",
        );
      }

      const heartbeat = startGovernanceSnapshotAnchorHeartbeat(
        async () =>
          transaction.unsafe(
            "select 1 as governance_snapshot_anchor_heartbeat",
          ),
        heartbeatIntervalMs,
      );
      let actionFailed = false;
      let actionError: unknown;
      let result: Result | undefined;
      try {
        result = await action(
          snapshotResult.data[0].snapshotId,
          heartbeat.assertHealthy,
        );
        heartbeat.assertHealthy();
      } catch (error: unknown) {
        actionFailed = true;
        actionError = error;
      }

      try {
        await heartbeat.stop();
      } catch (error: unknown) {
        if (!actionFailed) {
          throw error;
        }
      }
      if (actionFailed) {
        throw actionError;
      }
      return result as Result;
    },
  );
}

type SnapshotExportInput<Acquired, Prepared> = {
  acquire: () => Promise<Acquired>;
  prepare: (acquired: Acquired) => Prepared;
  write: (prepared: Prepared) => Promise<void>;
};

export async function executeGovernanceSnapshotExport<Acquired, Prepared>(
  input: SnapshotExportInput<Acquired, Prepared>,
): Promise<Prepared> {
  const acquired = await input.acquire();
  const prepared = input.prepare(acquired);
  await input.write(prepared);
  return prepared;
}

const governanceSnapshotTableCountsSchema = z
  .object(
    Object.fromEntries(
      governanceTableNames.map((tableName) => [
        tableName,
        z.number().int().nonnegative(),
      ]),
    ) as Record<(typeof governanceTableNames)[number], z.ZodNumber>,
  )
  .strict();

const governanceSnapshotWorkerSummarySchema = z
  .object({
    outputPath: z.string(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    tableCounts: governanceSnapshotTableCountsSchema,
  })
  .strict();

type GovernanceSnapshotWorkerSummary = z.infer<
  typeof governanceSnapshotWorkerSummarySchema
>;

export type GovernanceSnapshotWorkerExecution = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
};

type GovernanceSnapshotSupervisorInput = {
  createAttemptPath?: (attempt: number) => string;
  onRetry?: (attempt: number) => void;
  runWorker: (
    attemptPath: string,
    attempt: number,
  ) => Promise<GovernanceSnapshotWorkerExecution>;
  targetPath: string;
  waitBeforeRetry?: () => Promise<void>;
};

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error: unknown) {
    if (hasErrorCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

async function removeAttemptFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error: unknown) {
    if (!hasErrorCode(error, "ENOENT")) {
      throw error;
    }
  }
}

function createGovernanceSnapshotAttemptPath(
  targetPath: string,
  attempt: number,
): string {
  return join(
    dirname(targetPath),
    `.${basename(targetPath)}.attempt-${process.pid}-${attempt}-${randomUUID()}.json`,
  );
}

async function validateGovernanceSnapshotWorkerOutput(
  attemptPath: string,
  workerStdout: string,
): Promise<GovernanceSnapshotWorkerSummary> {
  if (Buffer.byteLength(workerStdout, "utf8") > governanceSnapshotMaximumWorkerOutputBytes) {
    throw new Error("Governance snapshot worker output exceeded its limit");
  }

  const workerSummary = governanceSnapshotWorkerSummarySchema.parse(
    JSON.parse(workerStdout.trim()),
  );
  if (workerSummary.outputPath !== attemptPath) {
    throw new Error("Governance snapshot worker reported an unexpected path");
  }

  const snapshotFile = await lstat(attemptPath);
  if (
    !snapshotFile.isFile() ||
    (snapshotFile.mode & 0o777) !== 0o600 ||
    snapshotFile.size > governanceSnapshotMaximumBytes
  ) {
    throw new Error("Governance snapshot worker produced an invalid file");
  }
  const serialized = await readFile(attemptPath);
  const snapshot = parseGovernanceSnapshot(
    JSON.parse(serialized.toString("utf8")),
  );
  const actualSha256 = createHash("sha256").update(serialized).digest("hex");
  if (
    actualSha256 !== workerSummary.sha256 ||
    !isDeepStrictEqual(snapshot.tableCounts, workerSummary.tableCounts)
  ) {
    throw new Error("Governance snapshot worker summary did not match its file");
  }

  return workerSummary;
}

export async function superviseGovernanceSnapshotExport(
  input: GovernanceSnapshotSupervisorInput,
): Promise<GovernanceSnapshotWorkerSummary> {
  if (await pathExists(input.targetPath)) {
    throw new Error("Governance snapshot target already exists");
  }

  for (
    let attempt = 1;
    attempt <= governanceSnapshotMaximumWorkers;
    attempt += 1
  ) {
    const attemptPath =
      input.createAttemptPath?.(attempt) ??
      createGovernanceSnapshotAttemptPath(input.targetPath, attempt);
    if (dirname(attemptPath) !== dirname(input.targetPath)) {
      throw new Error("Governance snapshot attempt must share the target directory");
    }
    if (await pathExists(attemptPath)) {
      throw new Error("Governance snapshot attempt path already exists");
    }

    let worker: GovernanceSnapshotWorkerExecution;
    try {
      worker = await input.runWorker(attemptPath, attempt);
    } catch {
      worker = { exitCode: null, signal: null, stdout: "" };
    }

    if (worker.exitCode === 0 && worker.signal === null) {
      let workerSummary: GovernanceSnapshotWorkerSummary;
      try {
        workerSummary = await validateGovernanceSnapshotWorkerOutput(
          attemptPath,
          worker.stdout,
        );
      } catch (error: unknown) {
        await removeAttemptFile(attemptPath);
        throw error;
      }

      try {
        await link(attemptPath, input.targetPath);
      } catch (error: unknown) {
        await removeAttemptFile(attemptPath);
        throw error;
      }
      await removeAttemptFile(attemptPath);
      return { ...workerSummary, outputPath: input.targetPath };
    }

    await removeAttemptFile(attemptPath);
    if (worker.exitCode === governanceSnapshotPermanentWorkerExitCode) {
      throw new Error("Governance snapshot worker rejected non-retryable output");
    }
    if (attempt < governanceSnapshotMaximumWorkers) {
      input.onRetry?.(attempt);
      await (input.waitBeforeRetry?.() ??
        new Promise<void>((resolve) => {
          setTimeout(resolve, governanceSnapshotWorkerRetryDelayMs);
        }));
    }
  }

  throw new Error("Governance snapshot workers failed");
}

type GovernanceSnapshotDatabase = ReturnType<typeof drizzle>;
type GovernanceSnapshotDatabaseTransaction = Parameters<
  Parameters<GovernanceSnapshotDatabase["transaction"]>[0]
>[0];

function createGovernanceSnapshotReader(
  databaseUrl: string,
  snapshotId: string,
  assertAnchorHealthy: () => void,
) {
  let batch = 0;
  let retainedClient: ReturnType<typeof postgres> | undefined;
  async function read<Result>(
    table: (typeof governanceTableNames)[number],
    query: (
      transaction: GovernanceSnapshotDatabaseTransaction,
    ) => Promise<Result>,
  ): Promise<Result> {
    const startedAt = performance.now();
    const result = await runGovernanceSnapshotReaderBatchWithRetry({
      assertAnchorHealthy,
      createClient: () => {
        const client = retainedClient;
        retainedClient = undefined;
        return client ?? postgres(databaseUrl, governanceSnapshotPostgresOptions);
      },
      retainSuccessfulClient: (client) => { retainedClient = client; },
      read: (client) => {
        const db = drizzle(client);
        return db.transaction(
          (transaction) =>
            initializeGovernanceSnapshotImportedTransaction(
              {
                unsafe: (statement) =>
                  transaction.execute(sql.raw(statement)),
              },
              snapshotId,
              () => query(transaction),
            ),
          {
            accessMode: "read only",
            isolationLevel: "repeatable read",
          },
        );
      },
    });
    batch += 1;
    reportGovernanceSnapshotProgress({
      kind: "governance-snapshot-progress-v1",
      table,
      batch,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return result;
  }
  return Object.assign(read, {
    async close() {
      const client = retainedClient;
      retainedClient = undefined;
      if (client) await runSnapshotAcquisitionAttempt(client, async () => undefined);
    },
  });
}

function parseMatchingTimestampBatch(
  rowKeys: readonly string[],
  value: unknown,
  tableName: (typeof governanceTableNames)[number],
): ReturnType<typeof parsePreciseGovernanceTimestampRows> {
  const timestampRows = parsePreciseGovernanceTimestampRows(value);
  if (
    rowKeys.length !== timestampRows.length ||
    rowKeys.some(
      (rowKey, index) =>
        timestampRows[index]?.tableName !== tableName ||
        timestampRows[index]?.rowKey !== rowKey,
    )
  ) {
    throw new Error("Governance snapshot timestamp batch did not match rows");
  }
  return timestampRows;
}

async function acquireGovernanceSnapshotRows(databaseUrl: string) {
  const anchorClient = postgres(databaseUrl, governanceSnapshotPostgresOptions);
  return runSnapshotAcquisitionAttempt(anchorClient, (client) =>
    executeGovernanceSnapshotAnchorTransaction(
      client,
      async (snapshotId, assertAnchorHealthy) => {
        const read = createGovernanceSnapshotReader(
          databaseUrl,
          snapshotId,
          assertAnchorHealthy,
        );
        let failed = false;
        let acquisitionError: unknown;
        try {
          const basePreciseTimestampRows: unknown[] = [];

          const dataSourceBatch = await read("data_sources", async (transaction) => {
            const db = transaction;
            const rows = await db
              .select()
              .from(dataSources)
              .orderBy(asc(dataSources.id));
            const timestamps = await db.execute(sql`
              select 'data_sources' as "tableName", id::text as "rowKey",
                     jsonb_build_object(
                       'verifiedAt', to_char(verified_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                       'createdAt', to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                       'updatedAt', to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                       'archivedAt', to_char(archived_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
                     ) as timestamps
                from data_sources
               order by id
            `);
            return { rows, timestamps };
          });
          basePreciseTimestampRows.push(
            ...parseMatchingTimestampBatch(
              dataSourceBatch.rows.map((row) => row.id),
              dataSourceBatch.timestamps,
              "data_sources",
            ),
          );

          const countryBatch = await read("countries", async (transaction) => {
            const db = transaction;
            const rows = await db
              .select()
              .from(countries)
              .orderBy(asc(countries.iso3));
            const timestamps = await db.execute(sql`
              select 'countries' as "tableName", iso3 as "rowKey",
                     jsonb_build_object(
                       'verifiedAt', to_char(verified_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                       'createdAt', to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                       'updatedAt', to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                       'archivedAt', to_char(archived_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
                     ) as timestamps
                from countries
               order by iso3
            `);
            return { rows, timestamps };
          });
          basePreciseTimestampRows.push(
            ...parseMatchingTimestampBatch(
              countryBatch.rows.map((row) => row.iso3),
              countryBatch.timestamps,
              "countries",
            ),
          );

          const jurisdictionBatch = await read("jurisdictions", async (transaction) => {
            const db = transaction;
            const rows = await db
              .select()
              .from(jurisdictions)
              .orderBy(asc(jurisdictions.id));
            const timestamps = await db.execute(sql`
              select 'jurisdictions' as "tableName", id::text as "rowKey",
                     jsonb_build_object(
                       'verifiedAt', to_char(verified_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                       'createdAt', to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                       'updatedAt', to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                       'archivedAt', to_char(archived_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
                     ) as timestamps
                from jurisdictions
               order by id
            `);
            return { rows, timestamps };
          });
          basePreciseTimestampRows.push(
            ...parseMatchingTimestampBatch(
              jurisdictionBatch.rows.map((row) => row.id),
              jurisdictionBatch.timestamps,
              "jurisdictions",
            ),
          );

          const membershipBatch = await read("country_jurisdictions", async (transaction) => {
            const db = transaction;
            const rows = await db
              .select()
              .from(countryJurisdictions)
              .orderBy(
                asc(countryJurisdictions.countryIso3),
                asc(countryJurisdictions.jurisdictionId),
                asc(countryJurisdictions.validFrom),
              );
            const timestamps = await db.execute(sql`
              select 'country_jurisdictions' as "tableName",
                     country_iso3 || ':' || jurisdiction_id::text || ':' || valid_from::text as "rowKey",
                     jsonb_build_object(
                       'verifiedAt', to_char(verified_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                       'createdAt', to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                       'updatedAt', to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                       'archivedAt', to_char(archived_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
                     ) as timestamps
                from country_jurisdictions
               order by country_iso3, jurisdiction_id, valid_from
            `);
            return { rows, timestamps };
          });
          basePreciseTimestampRows.push(
            ...parseMatchingTimestampBatch(
              membershipBatch.rows.map(
                (row) =>
                  `${row.countryIso3}:${row.jurisdictionId}:${row.validFrom}`,
              ),
              membershipBatch.timestamps,
              "country_jurisdictions",
            ),
          );

          const regulationBatch = await read("regulations", async (transaction) => {
            const db = transaction;
            const rows = await db
              .select()
              .from(regulations)
              .orderBy(asc(regulations.id));
            const timestamps = await db.execute(sql`
              select 'regulations' as "tableName", id::text as "rowKey",
                     jsonb_build_object(
                       'verifiedAt', to_char(verified_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                       'createdAt', to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                       'updatedAt', to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                       'archivedAt', to_char(archived_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
                     ) as timestamps
                from regulations
               order by id
            `);
            return { rows, timestamps };
          });
          basePreciseTimestampRows.push(
            ...parseMatchingTimestampBatch(
              regulationBatch.rows.map((row) => row.id),
              regulationBatch.timestamps,
              "regulations",
            ),
          );

          const limitRows = await collectGovernanceSnapshotRowsInBatches(
            async (cursor, limit) => {
              const batch = await read("regulation_limits", async (transaction) => {
                const db = transaction;
                const rows = await db
                  .select()
                  .from(regulationLimits)
                  .where(
                    cursor === null ? undefined : gt(regulationLimits.id, cursor),
                  )
                  .orderBy(asc(regulationLimits.id))
                  .limit(limit);
                const timestamps = await db.execute(sql`
                  select 'regulation_limits' as "tableName", id::text as "rowKey",
                         jsonb_build_object(
                           'verifiedAt', to_char(verified_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                           'createdAt', to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                           'updatedAt', to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                           'archivedAt', to_char(archived_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
                         ) as timestamps
                    from regulation_limits
                   where (${cursor}::uuid is null or id > ${cursor}::uuid)
                   order by id
                   limit ${limit}
                `);
                return { rows, timestamps };
              });
              const rows = governanceSnapshotBatchedRowSchema.array().parse(
                batch.rows,
              );
              const timestamps = parseMatchingTimestampBatch(
                rows.map((row) => row.id),
                batch.timestamps,
                "regulation_limits",
              );
              basePreciseTimestampRows.push(...timestamps);
              return rows;
            },
          );

          const marketMetricRows = await collectGovernanceSnapshotRowsInBatches(
            async (cursor, limit) => {
              const batch = await read("market_metrics", async (transaction) => {
                const db = transaction;
                const rows = await db
                  .select()
                  .from(marketMetrics)
                  .where(
                    cursor === null ? undefined : gt(marketMetrics.id, cursor),
                  )
                  .orderBy(asc(marketMetrics.id))
                  .limit(limit);
                const timestamps = await db.execute(sql`
                  select 'market_metrics' as "tableName", id::text as "rowKey",
                         jsonb_build_object(
                           'verifiedAt', to_char(verified_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                           'createdAt', to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                           'updatedAt', to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                           'archivedAt', to_char(archived_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
                         ) as timestamps
                    from market_metrics
                   where (${cursor}::uuid is null or id > ${cursor}::uuid)
                   order by id
                   limit ${limit}
                `);
                return { rows, timestamps };
              });
              const rows = governanceSnapshotBatchedRowSchema.array().parse(
                batch.rows,
              );
              const timestamps = parseMatchingTimestampBatch(
                rows.map((row) => row.id),
                batch.timestamps,
                "market_metrics",
              );
              basePreciseTimestampRows.push(...timestamps);
              return rows;
            },
          );

          const governanceDraftRows = await collectGovernanceSnapshotRowsInBatches(
            async (cursor, limit) =>
              read("data_governance_drafts", async (transaction) => {
                const db = transaction;
                return db.execute(sql`
                select id::text as "id",
                       entity_type::text as "entityType",
                       entity_key as "entityKey",
                       version,
                       workflow_status::text as "workflowStatus",
                       payload::text as "payload",
                       change_reason as "changeReason",
                       created_by as "createdBy",
                       reviewed_by as "reviewedBy",
                       published_by as "publishedBy",
                       to_char(reviewed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "reviewedAt",
                       to_char(published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "publishedAt",
                       to_char(archived_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "archivedAt",
                       to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",
                       to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "updatedAt"
                  from data_governance_drafts
                 where (${cursor}::uuid is null or id > ${cursor}::uuid)
                 order by id
                 limit ${limit}
                `);
              }),
            governanceSnapshotRawJsonBatchSize,
          );
          const marketImportBatchRows = await collectGovernanceSnapshotRowsInBatches(
            async (cursor, limit) =>
              read("market_import_batches", async (transaction) => {
                const db = transaction;
                return db.execute(sql`
                select id::text as "id",
                       status::text as "status",
                       original_filename as "originalFilename",
                       content_sha256 as "contentSha256",
                       preview_rows::text as "previewRows",
                       validation_errors::text as "validationErrors",
                       total_rows as "totalRows",
                       valid_rows as "validRows",
                       invalid_rows as "invalidRows",
                       created_by as "createdBy",
                       confirmed_by as "confirmedBy",
                       to_char(committed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "committedAt",
                       to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt"
                  from market_import_batches
                 where (${cursor}::uuid is null or id > ${cursor}::uuid)
                 order by id
                 limit ${limit}
                `);
              }),
            governanceSnapshotRawJsonBatchSize,
          );
          const changeLogRows = await collectGovernanceSnapshotRowsInBatches(
            async (cursor, limit) =>
              read("data_change_logs", async (transaction) => {
                const db = transaction;
                return db.execute(sql`
                select id::text as "id",
                       entity_type::text as "entityType",
                       entity_key as "entityKey",
                       action::text as "action",
                       actor_email as "actorEmail",
                       actor_role::text as "actorRole",
                       draft_id::text as "draftId",
                       import_batch_id::text as "importBatchId",
                       before_data::text as "beforeData",
                       after_data::text as "afterData",
                       reason,
                       to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt"
                  from data_change_logs
                 where (${cursor}::uuid is null or id > ${cursor}::uuid)
                 order by id
                 limit ${limit}
                `);
              }),
            governanceSnapshotRawJsonBatchSize,
          );

          const selectedTables = {
            countries: countryBatch.rows,
            country_jurisdictions: membershipBatch.rows,
            data_change_logs: changeLogRows,
            data_governance_drafts: governanceDraftRows,
            data_sources: dataSourceBatch.rows,
            jurisdictions: jurisdictionBatch.rows,
            market_import_batches: marketImportBatchRows,
            market_metrics: marketMetricRows,
            regulation_limits: limitRows,
            regulations: regulationBatch.rows,
          };
          const preciseTimestampRows = [
            ...parsePreciseGovernanceTimestampRows(basePreciseTimestampRows),
            ...governanceDraftRows.map((row) => ({
              rowKey: row.id,
              tableName: "data_governance_drafts",
              timestamps: {
                archivedAt: row.archivedAt,
                createdAt: row.createdAt,
                publishedAt: row.publishedAt,
                reviewedAt: row.reviewedAt,
                updatedAt: row.updatedAt,
              },
            })),
            ...marketImportBatchRows.map((row) => ({
              rowKey: row.id,
              tableName: "market_import_batches",
              timestamps: {
                committedAt: row.committedAt,
                createdAt: row.createdAt,
              },
            })),
            ...changeLogRows.map((row) => ({
              rowKey: row.id,
              tableName: "data_change_logs",
              timestamps: { createdAt: row.createdAt },
            })),
          ];
          const rawJsonRows = [
            ...governanceDraftRows.map((row) => ({
              jsonValues: { payload: row.payload },
              rowKey: row.id,
              tableName: "data_governance_drafts",
            })),
            ...marketImportBatchRows.map((row) => ({
              jsonValues: {
                previewRows: row.previewRows,
                validationErrors: row.validationErrors,
              },
              rowKey: row.id,
              tableName: "market_import_batches",
            })),
            ...changeLogRows.map((row) => ({
              jsonValues: {
                afterData: row.afterData,
                beforeData: row.beforeData,
              },
              rowKey: row.id,
              tableName: "data_change_logs",
            })),
          ];
          return {
            preciseTimestampResult: preciseTimestampRows,
            rawJsonResult: rawJsonRows,
            selectedTables,
          };
        } catch (error: unknown) {
          failed = true;
          acquisitionError = error;
          throw error;
        } finally {
          try { await read.close(); } catch (error: unknown) {
            if (failed) throw new AggregateError([acquisitionError, error], "Snapshot acquisition and retained-client cleanup failed");
            throw error;
          }
        }
      },
    ),
  );
}

type AcquiredGovernanceSnapshotRows = Awaited<
  ReturnType<typeof acquireGovernanceSnapshotRows>
>;

function prepareGovernanceSnapshot(acquired: AcquiredGovernanceSnapshotRows) {
  const timestampedTables = applyPreciseGovernanceTimestamps(
    acquired.selectedTables,
    parsePreciseGovernanceTimestampRows(acquired.preciseTimestampResult),
  );
  const tables = applyRawGovernanceJson(
    timestampedTables,
    parseRawGovernanceJsonRows(acquired.rawJsonResult),
  );
  const snapshot = parseGovernanceSnapshot({
    formatVersion: 4,
    exportedAt: new Date().toISOString(),
    tableCounts: createGovernanceTableCounts(tables),
    tables,
  });
  const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
  const sha256 = createHash("sha256").update(serialized).digest("hex");

  return { serialized, sha256, snapshot };
}

class GovernanceSnapshotWorkerFailure extends Error {
  constructor(readonly exitCode: number) {
    super("Governance snapshot worker failed");
    this.name = "GovernanceSnapshotWorkerFailure";
  }
}

async function executeGovernanceSnapshotWorker(outputPath: string) {
  const databaseUrl = getDatabaseUrl();
  let acquired: AcquiredGovernanceSnapshotRows;
  try {
    acquired = await acquireGovernanceSnapshotRows(databaseUrl);
  } catch (error: unknown) {
    throw new GovernanceSnapshotWorkerFailure(
      error instanceof GovernanceSnapshotRetryableAcquisitionFailure ||
        isRetryableGovernanceSnapshotReaderError(error)
        ? governanceSnapshotRetryableWorkerExitCode
        : governanceSnapshotPermanentWorkerExitCode,
    );
  }

  try {
    return await executeGovernanceSnapshotExport({
      acquire: async () => acquired,
      prepare: prepareGovernanceSnapshot,
      write: async ({ serialized }) => {
        await mkdir(dirname(outputPath), { mode: 0o700, recursive: true });
        await writeFile(outputPath, serialized, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
      },
    });
  } catch {
    throw new GovernanceSnapshotWorkerFailure(
      governanceSnapshotPermanentWorkerExitCode,
    );
  }
}

async function runGovernanceSnapshotWorkerProcess(
  attemptPath: string,
): Promise<GovernanceSnapshotWorkerExecution> {
  const scriptPath = process.argv[1];
  if (!scriptPath) {
    throw new Error("Governance snapshot script path is unavailable");
  }

  const startedAt = performance.now();
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      scriptPath,
      governanceSnapshotWorkerFlag,
      `--output=${attemptPath}`,
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "ignore", "ipc"],
    },
  );

  const execution = await waitForGovernanceSnapshotWorkerProcess(child, {
    onProgress: (progress) => {
      process.stderr.write(`${JSON.stringify(progress)}\n`);
    },
  });
  process.stderr.write(`${JSON.stringify({
    kind: "governance-snapshot-worker-exit-v1",
    durationMs: Math.round(performance.now() - startedAt),
    exitCode: execution.exitCode,
    signal: execution.signal,
  })}\n`);
  return execution;
}

type GovernanceSnapshotWorkerWaitOptions = {
  onProgress?: (progress: GovernanceSnapshotProgress) => void;
  terminationGraceMs?: number;
  timeoutMs?: number;
};

function requirePositiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

export function waitForGovernanceSnapshotWorkerProcess(
  child: ChildProcess,
  options: GovernanceSnapshotWorkerWaitOptions = {},
): Promise<GovernanceSnapshotWorkerExecution> {
  const timeoutMs = requirePositiveSafeInteger(
    options.timeoutMs ?? governanceSnapshotWorkerTimeoutMs,
    "Governance snapshot worker timeout",
  );
  const terminationGraceMs = requirePositiveSafeInteger(
    options.terminationGraceMs ?? governanceSnapshotWorkerTerminationGraceMs,
    "Governance snapshot worker termination grace",
  );

  return new Promise((resolve) => {
    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let forcedTermination = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let progressCount = 0;

    const childHasExited = () =>
      child.exitCode !== null || child.signalCode !== null;

    const requestTermination = () => {
      if (settled || forcedTermination || childHasExited()) {
        return;
      }
      forcedTermination = true;
      stdoutChunks.length = 0;
      stdoutBytes = 0;
      try {
        child.kill("SIGTERM");
      } catch {
        // The grace timer still escalates to SIGKILL if the child has not closed.
      }
      if (!settled) {
        killTimer = setTimeout(() => {
          if (!settled && !childHasExited()) {
            try {
              child.kill("SIGKILL");
            } catch {
              // A close event is still required before the child is considered reaped.
            }
          }
        }, terminationGraceMs);
      }
    };
    const workerTimer = setTimeout(requestTermination, timeoutMs);

    const onProgressMessage = (message: unknown) => {
      progressCount += 1;
      const progress = parseGovernanceSnapshotProgress(message);
      if (progressCount > 10_000 || progress === null) {
        requestTermination();
        return;
      }
      if (!forcedTermination) {
        try {
          options.onProgress?.(progress);
        } catch {
          requestTermination();
        }
      }
    };

    const onStdoutData = (chunk: Buffer) => {
      if (forcedTermination) {
        return;
      }
      stdoutBytes += chunk.length;
      if (stdoutBytes <= governanceSnapshotMaximumWorkerOutputBytes) {
        stdoutChunks.push(chunk);
      } else {
        requestTermination();
      }
    };

    const finish = (execution: GovernanceSnapshotWorkerExecution) => {
      if (settled) {
        return;
      }
      settled = true;
      if (workerTimer) {
        clearTimeout(workerTimer);
      }
      if (killTimer) {
        clearTimeout(killTimer);
      }
      child.stdout?.off("data", onStdoutData);
      child.off("message", onProgressMessage);
      resolve(execution);
    };

    child.stdout?.on("data", onStdoutData);
    child.on("message", onProgressMessage);
    child.once("error", () => {
      if (child.pid === undefined) {
        finish({ exitCode: null, signal: null, stdout: "" });
      } else {
        requestTermination();
      }
    });
    child.once("close", (exitCode, signal) => {
      finish({
        exitCode: forcedTermination ? null : exitCode,
        signal,
        stdout: forcedTermination
          ? ""
          : Buffer.concat(stdoutChunks).toString("utf8"),
      });
    });

    if (!child.stdout) {
      requestTermination();
    }
  });
}

async function workerMain() {
  const { outputPath } = parseGovernanceSnapshotOptions(process.argv.slice(3));
  const prepared = await executeGovernanceSnapshotWorker(outputPath);

  process.stdout.write(
    `${JSON.stringify({
      outputPath,
      sha256: prepared.sha256,
      tableCounts: prepared.snapshot.tableCounts,
    })}\n`,
  );
}

async function supervisorMain() {
  const { outputPath } = parseGovernanceSnapshotOptions(process.argv.slice(2));
  const summary = await superviseGovernanceSnapshotExport({
    onRetry: () => {
      process.stderr.write(
        "Governance snapshot worker failed; retrying once in a fresh process.\n",
      );
    },
    runWorker: runGovernanceSnapshotWorkerProcess,
    targetPath: outputPath,
  });

  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

function reportWorkerFailure(error: unknown) {
  process.stderr.write(
    "Governance snapshot worker failed; no database credentials were logged.\n",
  );
  process.exitCode =
    error instanceof GovernanceSnapshotWorkerFailure
      ? error.exitCode
      : governanceSnapshotPermanentWorkerExitCode;
}

function reportSupervisorFailure() {
  process.stderr.write(
    "Governance snapshot failed; no database credentials were logged.\n",
  );
  process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv[2] === governanceSnapshotWorkerFlag) {
    workerMain().catch(reportWorkerFailure);
  } else {
    supervisorMain().catch(reportSupervisorFailure);
  }
}
