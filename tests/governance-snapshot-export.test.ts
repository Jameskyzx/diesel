import { ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { access, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  collectGovernanceSnapshotRowsInBatches,
  executeGovernanceSnapshotAnchorTransaction,
  executeGovernanceSnapshotExport,
  executeGovernanceSnapshotImportedTransaction,
  governanceSnapshotAnchorHeartbeatIntervalMs,
  governanceSnapshotDatabaseBatchSize,
  governanceSnapshotMaximumWorkers,
  governanceSnapshotPostgresOptions,
  governanceSnapshotReaderMaximumAttempts,
  governanceSnapshotWorkerTerminationGraceMs,
  governanceSnapshotWorkerTimeoutMs,
  isRetryableGovernanceSnapshotReaderError,
  parseGovernanceSnapshotId,
  runGovernanceSnapshotReaderBatchWithRetry,
  runSnapshotAcquisitionAttempt,
  startGovernanceSnapshotAnchorHeartbeat,
  superviseGovernanceSnapshotExport,
  type GovernanceSnapshotWorkerExecution,
  waitForGovernanceSnapshotWorkerProcess,
} from "../scripts/db/export-governance-snapshot";

const temporaryDirectories: string[] = [];

const emptyTableCounts = {
  countries: 0,
  country_jurisdictions: 0,
  data_change_logs: 0,
  data_governance_drafts: 0,
  data_sources: 0,
  jurisdictions: 0,
  market_import_batches: 0,
  market_metrics: 0,
  regulation_limits: 0,
  regulations: 0,
};

const emptySnapshot = {
  exportedAt: "2026-08-11T00:00:00.000Z",
  formatVersion: 4,
  tableCounts: emptyTableCounts,
  tables: {
    countries: [],
    country_jurisdictions: [],
    data_change_logs: [],
    data_governance_drafts: [],
    data_sources: [],
    jurisdictions: [],
    market_import_batches: [],
    market_metrics: [],
    regulation_limits: [],
    regulations: [],
  },
};

async function createTemporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "diesel-snapshot-export-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeSuccessfulWorkerOutput(
  attemptPath: string,
): Promise<GovernanceSnapshotWorkerExecution> {
  const serialized = `${JSON.stringify(emptySnapshot, null, 2)}\n`;
  const sha256 = createHash("sha256").update(serialized).digest("hex");
  await writeFile(attemptPath, serialized, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return {
    exitCode: 0,
    signal: null,
    stdout: `${JSON.stringify({
      outputPath: attemptPath,
      sha256,
      tableCounts: emptyTableCounts,
    })}\n`,
  };
}

function createTermIgnoringFakeChild() {
  const child = new ChildProcess();
  Object.defineProperties(child, {
    pid: { configurable: true, value: 42_424 },
    stdout: { configurable: true, value: new PassThrough() },
  });
  const signals: Array<NodeJS.Signals | number> = [];
  vi.spyOn(child, "kill").mockImplementation((signal = "SIGTERM") => {
    signals.push(signal);
    if (signal === "SIGKILL") {
      queueMicrotask(() => child.emit("close", null, "SIGKILL"));
    }
    return true;
  });
  return { child, signals };
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("governance snapshot export reliability", () => {
  it("flushes deferred protocol writes and probes before closing the client", async () => {
    const events: string[] = [];
    const client = {
      end: vi.fn(async () => {
        events.push("end");
      }),
      unsafe: vi.fn(async () => {
        events.push("probe");
        setImmediate(() => events.push("probe-deferred-write"));
      }),
    };

    const result = await runSnapshotAcquisitionAttempt(client, async () => {
      events.push("acquire");
      setImmediate(() => events.push("deferred-write"));
      return "snapshot rows";
    });

    expect(result).toBe("snapshot rows");
    expect(events).toEqual([
      "acquire",
      "deferred-write",
      "probe",
      "probe-deferred-write",
      "end",
    ]);
    expect(client.unsafe).toHaveBeenCalledWith(
      "select 1 as governance_snapshot_teardown_probe",
    );
    expect(client.end).toHaveBeenCalledWith({ timeout: 5 });
  });

  it("drains failed probe writes before closing and preserves the probe error", async () => {
    const events: string[] = [];
    const probeError = new Error("probe failed");
    const client = {
      end: vi.fn(async () => {
        events.push("end");
      }),
      unsafe: vi.fn(async () => {
        events.push("probe");
        setImmediate(() => events.push("probe-deferred-write"));
        throw probeError;
      }),
    };

    await expect(
      runSnapshotAcquisitionAttempt(client, async () => {
        events.push("acquire");
        return "snapshot rows";
      }),
    ).rejects.toBe(probeError);

    expect(events).toEqual([
      "acquire",
      "probe",
      "probe-deferred-write",
      "end",
    ]);
    expect(client.end).toHaveBeenCalledWith({ timeout: 5 });
  });

  it("accepts only PostgreSQL exported snapshot identifiers", () => {
    expect(parseGovernanceSnapshotId("00000003-0000001B-1")).toBe(
      "00000003-0000001B-1",
    );
    expect(() => parseGovernanceSnapshotId("00000003-0000001B-1'; select 1"))
      .toThrow("invalid snapshot ID");
    expect(() => parseGovernanceSnapshotId("snapshot-1")).toThrow(
      "invalid snapshot ID",
    );
    expect(() => parseGovernanceSnapshotId(null)).toThrow(
      "invalid snapshot ID",
    );
  });

  it("imports the exported snapshot before any reader data query", async () => {
    const events: string[] = [];
    const transaction = {
      unsafe: vi.fn(async (statement: string) => {
        events.push(statement);
      }),
    };
    const client = {
      async begin<Result>(
        options: string,
        action: (value: typeof transaction) => Promise<Result>,
      ): Promise<Result> {
        events.push(`begin ${options}`);
        return action(transaction);
      },
    };

    const result = await executeGovernanceSnapshotImportedTransaction(
      client,
      "00000003-0000001B-1",
      async () => {
        events.push("select governance rows");
        return "rows";
      },
    );

    expect(result).toBe("rows");
    expect(events).toEqual([
      "begin isolation level repeatable read read only",
      "set transaction snapshot '00000003-0000001B-1'",
      "set local statement_timeout = '120s'",
      "set local idle_in_transaction_session_timeout = '5min'",
      "select governance rows",
    ]);
  });

  it("keeps one exported MVCC view alive with a bounded heartbeat", async () => {
    const events: string[] = [];
    const transaction = {
      unsafe: vi.fn(async (statement: string) => {
        events.push(statement);
        return statement.includes("pg_export_snapshot")
          ? [{ snapshotId: "00000003-0000001B-1" }]
          : [];
      }),
    };
    const client = {
      async begin<Result>(
        options: string,
        action: (value: typeof transaction) => Promise<Result>,
      ): Promise<Result> {
        events.push(`begin ${options}`);
        return action(transaction);
      },
    };

    await expect(
      executeGovernanceSnapshotAnchorTransaction(
        client,
        async (snapshotId, assertHealthy) => {
          assertHealthy();
          events.push(`read ${snapshotId}`);
          return "complete";
        },
        1_000,
      ),
    ).resolves.toBe("complete");

    expect(events).toEqual([
      "begin isolation level repeatable read read only",
      "set local statement_timeout = '120s'",
      "set local idle_in_transaction_session_timeout = '60s'",
      'select pg_export_snapshot() as "snapshotId"',
      "read 00000003-0000001B-1",
    ]);
  });

  it("stops and reports a failed anchor heartbeat without leaking its raw error", async () => {
    vi.useFakeTimers();
    const probe = vi.fn(async () => {
      throw new Error("connection details must remain private");
    });
    const heartbeat = startGovernanceSnapshotAnchorHeartbeat(probe, 10);

    await vi.advanceTimersByTimeAsync(10);
    expect(() => heartbeat.assertHealthy()).toThrow(
      "Governance snapshot anchor heartbeat failed",
    );
    await expect(heartbeat.stop()).rejects.toThrow(
      "Governance snapshot anchor heartbeat failed",
    );
    const callsAfterStop = probe.mock.calls.length;
    await vi.advanceTimersByTimeAsync(100);
    expect(probe).toHaveBeenCalledTimes(callsAfterStop);
  });

  it("retries one logical reader batch with a fresh client and unchanged cursor", async () => {
    const clientIds: number[] = [];
    const cursors: string[] = [];
    let nextClientId = 0;
    const createClient = () => {
      const id = ++nextClientId;
      clientIds.push(id);
      return {
        id,
        end: vi.fn(async () => {
          if (id === 2) {
            throw Object.assign(new Error("private teardown detail"), {
              code: "ECONNRESET",
            });
          }
        }),
        unsafe: vi.fn(async () => undefined),
      };
    };
    const cursor = "00000000-0000-4000-8000-000000000500";

    const result = await runGovernanceSnapshotReaderBatchWithRetry({
      assertAnchorHealthy: () => undefined,
      createClient,
      read: async (client) => {
        cursors.push(cursor);
        if (client.id === 1) {
          throw Object.assign(new Error("private transport detail"), {
            code: "08006",
          });
        }
        return "batch rows";
      },
      waitBeforeRetry: async () => undefined,
    });

    expect(result).toBe("batch rows");
    expect(clientIds).toEqual([1, 2, 3]);
    expect(cursors).toEqual([cursor, cursor, cursor]);
    expect(governanceSnapshotReaderMaximumAttempts).toBe(3);
  });

  it("bounds retries for code-less postgres-js protocol TypeErrors", async () => {
    const clients: Array<{
      end: ReturnType<typeof vi.fn>;
      unsafe: ReturnType<typeof vi.fn>;
    }> = [];
    const createClient = vi.fn(() => {
      const client = {
        end: vi.fn(async () => undefined),
        unsafe: vi.fn(async () => undefined),
      };
      clients.push(client);
      return client;
    });
    const read = vi.fn(async () => {
      throw new TypeError("private postgres-js socket detail");
    });

    await expect(
      runGovernanceSnapshotReaderBatchWithRetry({
        assertAnchorHealthy: () => undefined,
        createClient,
        read,
        waitBeforeRetry: async () => undefined,
      }),
    ).rejects.toThrow("acquisition must restart");

    expect(isRetryableGovernanceSnapshotReaderError(new TypeError())).toBe(
      true,
    );
    expect(createClient).toHaveBeenCalledTimes(
      governanceSnapshotReaderMaximumAttempts,
    );
    expect(read).toHaveBeenCalledTimes(governanceSnapshotReaderMaximumAttempts);
    expect(clients).toHaveLength(governanceSnapshotReaderMaximumAttempts);
    for (const client of clients) {
      expect(client.end).toHaveBeenCalledWith({ timeout: 5 });
    }
  });

  it("does not retry snapshot loss or other non-transient reader failures", async () => {
    const createClient = vi.fn(() => ({
      end: vi.fn(async () => undefined),
      unsafe: vi.fn(async () => undefined),
    }));

    await expect(
      runGovernanceSnapshotReaderBatchWithRetry({
        assertAnchorHealthy: () => undefined,
        createClient,
        read: async () => {
          throw Object.assign(new Error("invalid snapshot identifier"), {
            code: "22023",
          });
        },
        waitBeforeRetry: async () => undefined,
      }),
    ).rejects.toThrow("acquisition must restart");
    expect(createClient).toHaveBeenCalledTimes(1);

    await expect(
      runGovernanceSnapshotReaderBatchWithRetry({
        assertAnchorHealthy: () => undefined,
        createClient,
        read: async () => {
          throw Object.assign(new Error("private SQL detail"), {
            code: "42601",
          });
        },
        waitBeforeRetry: async () => undefined,
      }),
    ).rejects.toThrow("failed permanently");
    expect(createClient).toHaveBeenCalledTimes(2);
    expect(isRetryableGovernanceSnapshotReaderError({ code: "08001" })).toBe(
      true,
    );
    expect(isRetryableGovernanceSnapshotReaderError({ code: "57014" })).toBe(
      true,
    );
    expect(isRetryableGovernanceSnapshotReaderError({ code: "22023" })).toBe(
      false,
    );
  });

  it("reads large governance tables with advancing keyset batches", async () => {
    const sourceRows = Array.from({ length: 1_005 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      payload:
        index === 1_004
          ? '{"largeInteger":9007199254740993,"precise":1.234567890123456789}'
          : `{"index":${index}}`,
    }));
    const cursors: Array<string | null> = [];

    const rows = await collectGovernanceSnapshotRowsInBatches(
      async (cursor, limit) => {
        cursors.push(cursor);
        const start =
          cursor === null
            ? 0
            : sourceRows.findIndex((row) => row.id === cursor) + 1;
        return sourceRows.slice(start, start + limit);
      },
    );

    expect(governanceSnapshotDatabaseBatchSize).toBe(500);
    expect(cursors).toEqual([null, sourceRows[499]!.id, sourceRows[999]!.id]);
    expect(rows).toEqual(sourceRows);
    expect(rows[1_004]!.payload).toBe(
      '{"largeInteger":9007199254740993,"precise":1.234567890123456789}',
    );
  });

  it("keeps the production-sized regulation limit table on the keyset path", async () => {
    const exporterSource = await readFile(
      join(process.cwd(), "scripts/db/export-governance-snapshot.ts"),
      "utf8",
    );
    const limitSelectionStart = exporterSource.indexOf("const limitRows =");
    const nextSelectionStart = exporterSource.indexOf(
      "const governanceDraftRows =",
      limitSelectionStart,
    );
    const limitSelection = exporterSource.slice(
      limitSelectionStart,
      nextSelectionStart,
    );

    expect(limitSelectionStart).toBeGreaterThanOrEqual(0);
    expect(nextSelectionStart).toBeGreaterThan(limitSelectionStart);
    expect(limitSelection).toContain(
      "collectGovernanceSnapshotRowsInBatches",
    );
    expect(limitSelection).toContain("gt(regulationLimits.id, cursor)");
    expect(limitSelection).toContain(".limit(limit)");
  });

  it("rejects oversized or non-advancing governance batches", async () => {
    const firstId = "00000000-0000-4000-8000-000000000001";
    const secondId = "00000000-0000-4000-8000-000000000002";

    await expect(
      collectGovernanceSnapshotRowsInBatches(
        async () => [
          { id: firstId },
          { id: secondId },
          { id: "00000000-0000-4000-8000-000000000003" },
        ],
        2,
      ),
    ).rejects.toThrow("exceeded");

    await expect(
      collectGovernanceSnapshotRowsInBatches(
        async () => [{ id: firstId }, { id: firstId }],
        2,
      ),
    ).rejects.toThrow("did not advance");
  });

  it("escalates a timed-out fake worker to SIGKILL and waits for close", async () => {
    const { child, signals } = createTermIgnoringFakeChild();

    const execution = await waitForGovernanceSnapshotWorkerProcess(child, {
      terminationGraceMs: 5,
      timeoutMs: 5,
    });

    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(execution).toEqual({
      exitCode: null,
      signal: "SIGKILL",
      stdout: "",
    });
  });

  it("does not terminate a worker that exited before stdout closes", async () => {
    const child = new ChildProcess();
    const stdout = new PassThrough();
    Object.defineProperties(child, {
      exitCode: { configurable: true, value: 0 },
      pid: { configurable: true, value: 42_425 },
      stdout: { configurable: true, value: stdout },
    });
    const kill = vi.spyOn(child, "kill");
    const executionPromise = waitForGovernanceSnapshotWorkerProcess(child, {
      terminationGraceMs: 5,
      timeoutMs: 5,
    });
    stdout.write("complete summary\n");
    setTimeout(() => child.emit("close", 0, null), 10);

    await expect(executionPromise).resolves.toEqual({
      exitCode: 0,
      signal: null,
      stdout: "complete summary\n",
    });
    expect(kill).not.toHaveBeenCalled();
  });

  it("reaps a real worker that handles SIGTERM without exiting", async () => {
    const directory = await createTemporaryDirectory();
    const termMarker = join(directory, "term-received");
    const child = spawn(
      process.execPath,
      [
        "-e",
        [
          'const { writeFileSync } = require("node:fs");',
          "const marker = process.argv[1];",
          'process.on("SIGTERM", () => writeFileSync(marker, "received\\n"));',
          'process.stdout.write("ready\\n");',
          "setInterval(() => undefined, 1_000);",
        ].join("\n"),
        termMarker,
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    const childPid = child.pid;
    expect(childPid).toBeTypeOf("number");
    await once(child.stdout, "data");

    const execution = await waitForGovernanceSnapshotWorkerProcess(child, {
      terminationGraceMs: 100,
      timeoutMs: 25,
    });

    expect(execution).toEqual({
      exitCode: null,
      signal: "SIGKILL",
      stdout: "",
    });
    expect(await readFile(termMarker, "utf8")).toBe("received\n");
    expect(child.signalCode).toBe("SIGKILL");
    expect(() => process.kill(childPid!, 0)).toThrow();
  });

  it("restarts in a fresh worker after an uncaught process crash", async () => {
    const directory = await createTemporaryDirectory();
    const targetPath = join(directory, "governance.json");
    const attemptPaths: string[] = [];
    const retries: number[] = [];

    const summary = await superviseGovernanceSnapshotExport({
      createAttemptPath: (attempt) =>
        join(directory, `governance-attempt-${attempt}.json`),
      onRetry: (attempt) => retries.push(attempt),
      runWorker: async (attemptPath, attempt) => {
        attemptPaths.push(attemptPath);
        if (attempt === 1) {
          return { exitCode: 1, signal: null, stdout: "" };
        }
        return writeSuccessfulWorkerOutput(attemptPath);
      },
      targetPath,
      waitBeforeRetry: async () => undefined,
    });

    expect(attemptPaths).toEqual([
      join(directory, "governance-attempt-1.json"),
      join(directory, "governance-attempt-2.json"),
    ]);
    expect(retries).toEqual([1]);
    expect(summary.outputPath).toBe(targetPath);
    expect(await readFile(targetPath, "utf8")).toBe(
      `${JSON.stringify(emptySnapshot, null, 2)}\n`,
    );
    expect((await stat(targetPath)).mode & 0o777).toBe(0o600);
    await expect(access(attemptPaths[1]!)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("restarts after a retryable acquisition or teardown exit", async () => {
    const directory = await createTemporaryDirectory();
    const targetPath = join(directory, "governance.json");
    const runWorker = vi.fn(
      async (attemptPath: string, attempt: number) =>
        attempt === 1
          ? { exitCode: 75, signal: null, stdout: "" }
          : writeSuccessfulWorkerOutput(attemptPath),
    );

    await superviseGovernanceSnapshotExport({
      createAttemptPath: (attempt) =>
        join(directory, `retryable-attempt-${attempt}.json`),
      runWorker,
      targetPath,
      waitBeforeRetry: async () => undefined,
    });

    expect(runWorker).toHaveBeenCalledTimes(2);
  });

  it("atomically refuses to overwrite a target created during export", async () => {
    const directory = await createTemporaryDirectory();
    const targetPath = join(directory, "governance.json");
    const attemptPath = join(directory, "race-attempt.json");

    await expect(
      superviseGovernanceSnapshotExport({
        createAttemptPath: () => attemptPath,
        runWorker: async (workerAttemptPath) => {
          const execution = await writeSuccessfulWorkerOutput(workerAttemptPath);
          await writeFile(targetPath, "existing snapshot\n", {
            encoding: "utf8",
            flag: "wx",
            mode: 0o600,
          });
          return execution;
        },
        targetPath,
        waitBeforeRetry: async () => undefined,
      }),
    ).rejects.toMatchObject({ code: "EEXIST" });

    expect(await readFile(targetPath, "utf8")).toBe("existing snapshot\n");
    await expect(access(attemptPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("cleans both timed-out attempts and starts at most two workers", async () => {
    const directory = await createTemporaryDirectory();
    const targetPath = join(directory, "governance.json");
    const attemptPaths: string[] = [];
    const runWorker = vi.fn(async (attemptPath: string) => {
      attemptPaths.push(attemptPath);
      await writeFile(attemptPath, "partial snapshot\n", {
        flag: "wx",
        mode: 0o600,
      });
      const { child } = createTermIgnoringFakeChild();
      return waitForGovernanceSnapshotWorkerProcess(child, {
        terminationGraceMs: 5,
        timeoutMs: 5,
      });
    });

    await expect(
      superviseGovernanceSnapshotExport({
        createAttemptPath: (attempt) =>
          join(directory, `failed-attempt-${attempt}.json`),
        runWorker,
        targetPath,
        waitBeforeRetry: async () => undefined,
      }),
    ).rejects.toThrow("Governance snapshot workers failed");

    expect(runWorker).toHaveBeenCalledTimes(governanceSnapshotMaximumWorkers);
    await expect(access(targetPath)).rejects.toMatchObject({ code: "ENOENT" });
    for (const attemptPath of attemptPaths) {
      await expect(access(attemptPath)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("does not retry permanent worker or supervisor validation failures", async () => {
    const directory = await createTemporaryDirectory();
    const permanentTarget = join(directory, "permanent.json");
    const permanentAttempt = join(directory, "permanent-attempt-1.json");
    const permanentWorker = vi.fn(async (attemptPath: string) => {
      await writeFile(attemptPath, "partial snapshot\n", {
        flag: "wx",
        mode: 0o600,
      });
      const child = new ChildProcess();
      Object.defineProperty(child, "stdout", {
        configurable: true,
        value: new PassThrough(),
      });
      queueMicrotask(() => child.emit("close", 65, null));
      return waitForGovernanceSnapshotWorkerProcess(child, {
        terminationGraceMs: 10,
        timeoutMs: 100,
      });
    });
    await expect(
      superviseGovernanceSnapshotExport({
        createAttemptPath: () => permanentAttempt,
        runWorker: permanentWorker,
        targetPath: permanentTarget,
        waitBeforeRetry: async () => undefined,
      }),
    ).rejects.toThrow("non-retryable");
    expect(permanentWorker).toHaveBeenCalledTimes(1);
    await expect(access(permanentAttempt)).rejects.toMatchObject({
      code: "ENOENT",
    });

    const invalidTarget = join(directory, "invalid.json");
    const invalidWorker = vi.fn(async (attemptPath: string) => {
      await writeFile(attemptPath, "{}\n", { flag: "wx", mode: 0o600 });
      return { exitCode: 0, signal: null, stdout: "{}\n" };
    });
    await expect(
      superviseGovernanceSnapshotExport({
        createAttemptPath: (attempt) =>
          join(directory, `invalid-attempt-${attempt}.json`),
        runWorker: invalidWorker,
        targetPath: invalidTarget,
        waitBeforeRetry: async () => undefined,
      }),
    ).rejects.toBeDefined();
    expect(invalidWorker).toHaveBeenCalledTimes(1);
    await expect(access(invalidTarget)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not retry validation or file-write failures inside a worker", async () => {
    const validationAcquire = vi.fn(async () => "raw-snapshot");
    const validationPrepare = vi.fn(() => {
      throw new Error("snapshot validation failed");
    });

    await expect(
      executeGovernanceSnapshotExport({
        acquire: validationAcquire,
        prepare: validationPrepare,
        write: vi.fn(async () => undefined),
      }),
    ).rejects.toThrow("snapshot validation failed");
    expect(validationAcquire).toHaveBeenCalledTimes(1);

    const writeAcquire = vi.fn(async () => "raw-snapshot");
    const write = vi.fn(async () => {
      throw new Error("file write failed");
    });
    await expect(
      executeGovernanceSnapshotExport({
        acquire: writeAcquire,
        prepare: (value) => value,
        write,
      }),
    ).rejects.toThrow("file write failed");
    expect(writeAcquire).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("pins one connection in every anchor or short-lived reader client", () => {
    expect(governanceSnapshotPostgresOptions).toEqual({
      connect_timeout: 15,
      idle_timeout: undefined,
      keep_alive: 15,
      max: 1,
      max_lifetime: null,
      prepare: false,
    });
    expect(governanceSnapshotWorkerTimeoutMs).toBe(45 * 60 * 1_000);
    expect(governanceSnapshotWorkerTerminationGraceMs).toBe(2_000);
    expect(governanceSnapshotAnchorHeartbeatIntervalMs).toBe(10_000);
  });

  it("uses bounded imported batches without a final unbounded timestamp union", async () => {
    const exporterSource = await readFile(
      join(process.cwd(), "scripts/db/export-governance-snapshot.ts"),
      "utf8",
    );

    expect(exporterSource).toContain(
      "idle_in_transaction_session_timeout = '60s'",
    );
    expect(exporterSource).toContain("pg_export_snapshot()");
    expect(exporterSource).toContain("set transaction snapshot");
    expect(exporterSource).toContain("parseMatchingTimestampBatch");
    expect(exporterSource).not.toContain("union all");
    expect(governanceSnapshotWorkerTimeoutMs).toBeGreaterThan(60 * 1_000);
  });
});
