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
  describeGovernanceSnapshotFailure,
  executeGovernanceSnapshotAnchorTransaction,
  executeGovernanceSnapshotExport,
  executeGovernanceSnapshotImportedTransaction,
  governanceSnapshotAnchorHeartbeatIntervalMs,
  governanceSnapshotDatabaseBatchSize,
  governanceSnapshotExportTimeoutMs,
  governanceSnapshotMaximumWorkers,
  governanceSnapshotPostgresOptions,
  governanceSnapshotRawJsonBatchSize,
  governanceSnapshotReaderMaximumAttempts,
  governanceSnapshotWorkerTerminationGraceMs,
  governanceSnapshotWorkerTimeoutMs,
  isRetryableGovernanceSnapshotReaderError,
  parseGovernanceSnapshotId,
  parseGovernanceSnapshotFailure,
  parseGovernanceSnapshotProgress,
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
  it("retains only allowlisted failure metadata, never connection details or raw errors", () => {
    const error = Object.assign(new TypeError("secret URL, query and row data"), {
      code: "CONNECTION_CLOSED", query: "select private", detail: "secret",
    });
    const failure = describeGovernanceSnapshotFailure("reader", error);
    expect(failure).toEqual({ kind: "governance-snapshot-failure-v1", phase: "reader", errorType: "TypeError", code: "CONNECTION_CLOSED" });
    expect(parseGovernanceSnapshotFailure(failure)).toEqual(failure);
    expect(describeGovernanceSnapshotFailure("reader", Object.assign(new Error("private"), { name: "secret", code: "secret" })))
      .toMatchObject({ errorType: "unknown", code: null });
    for (const invalid of [
      { ...failure, message: "secret" }, { ...failure, code: "secret" },
      { ...failure, phase: "secret" }, { ...failure, errorType: "secret" }, null,
    ]) expect(parseGovernanceSnapshotFailure(invalid)).toBeNull();
  });

  it("forwards sanitized failures separately and preserves the failed worker exit", async () => {
    const { child } = createTermIgnoringFakeChild();
    const onFailure = vi.fn();
    const onProgress = vi.fn();
    const pending = waitForGovernanceSnapshotWorkerProcess(child, { onFailure, onProgress });
    const failure = describeGovernanceSnapshotFailure("uncaught", new TypeError("private"));
    child.emit("message", failure);
    child.emit("close", 1, null);
    expect(await pending).toEqual({ exitCode: 1, signal: null, stdout: "" });
    expect(onFailure).toHaveBeenCalledExactlyOnceWith(failure);
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("reads bounded Drizzle cause codes without publishing wrapped SQL or looping on cycles", () => {
    const wrapped = new Error("private query", { cause: Object.assign(new Error("private URL"), { code: "ECONNRESET" }) });
    expect(isRetryableGovernanceSnapshotReaderError(wrapped)).toBe(true);
    expect(describeGovernanceSnapshotFailure("reader", wrapped)).toEqual({
      kind: "governance-snapshot-failure-v1", phase: "reader", errorType: "Error", code: "ECONNRESET",
    });
    const cycle = new Error("private");
    cycle.cause = cycle;
    expect(isRetryableGovernanceSnapshotReaderError(cycle)).toBe(false);
    expect(describeGovernanceSnapshotFailure("reader", cycle).code).toBeNull();
    const permanent = new Error("private query", { cause: Object.assign(new Error("private"), { code: "23505" }) });
    expect(isRetryableGovernanceSnapshotReaderError(permanent)).toBe(false);
  });

  it("bounds the failure channel and reaps a flooding worker", async () => {
    vi.useFakeTimers();
    const { child, signals } = createTermIgnoringFakeChild();
    const onFailure = vi.fn();
    const pending = waitForGovernanceSnapshotWorkerProcess(child, { onFailure, terminationGraceMs: 10 });
    for (let count = 0; count < 65; count += 1) child.emit("message", describeGovernanceSnapshotFailure("reader", new Error("private")));
    await vi.advanceTimersByTimeAsync(10);
    expect(await pending).toEqual({ exitCode: null, signal: "SIGKILL", stdout: "" });
    expect(onFailure).toHaveBeenCalledTimes(64);
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("lets one healthy export use the shared budget beyond the former 45-minute slot", async () => {
    const directory = await createTemporaryDirectory();
    let now = 0;
    const runWorker = vi.fn(async (path: string, _attempt: number, timeoutMs: number) => {
      expect(timeoutMs).toBe(90 * 60 * 1_000);
      now = 60 * 60 * 1_000;
      return writeSuccessfulWorkerOutput(path);
    });
    await superviseGovernanceSnapshotExport({ targetPath: join(directory, "snapshot.json"), now: () => now, runWorker });
    expect(runWorker).toHaveBeenCalledTimes(1);
  });

  it("gives a fresh worker only the unused shared budget including retry delay", async () => {
    const directory = await createTemporaryDirectory();
    let now = 100;
    const budgets: number[] = [];
    await superviseGovernanceSnapshotExport({
      targetPath: join(directory, "snapshot.json"), now: () => now,
      waitBeforeRetry: async () => { now += 1_000; },
      runWorker: async (path, attempt, timeoutMs) => {
        budgets.push(timeoutMs);
        if (attempt === 1) { now += 10 * 60 * 1_000; return { exitCode: 75, signal: null, stdout: "" }; }
        return writeSuccessfulWorkerOutput(path);
      },
    });
    expect(budgets).toEqual([governanceSnapshotExportTimeoutMs, governanceSnapshotExportTimeoutMs - 601_000]);
  });

  it.each([0, 75])("does not publish or start another worker after shared deadline, exit %s", async exitCode => {
    const directory = await createTemporaryDirectory();
    let now = 0;
    const targetPath = join(directory, "snapshot.json");
    const attemptPath = join(directory, "attempt.json");
    const onRetry = vi.fn();
    const runWorker = vi.fn(async (path: string) => {
      const result = await writeSuccessfulWorkerOutput(path);
      now = governanceSnapshotExportTimeoutMs + 1;
      return { ...result, exitCode };
    });
    await expect(superviseGovernanceSnapshotExport({
      targetPath, createAttemptPath: () => attemptPath, now: () => now, onRetry, runWorker,
    })).rejects.toThrow("Governance snapshot workers failed");
    expect(runWorker).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
    await expect(access(targetPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(attemptPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("allows only bounded table progress, never errors, SQL or row values", () => {
    const progress = {
      kind: "governance-snapshot-progress-v1",
      table: "data_governance_drafts",
      batch: 1,
      durationMs: 500,
    };
    expect(parseGovernanceSnapshotProgress(progress)).toEqual(progress);
    for (const invalid of [
      { ...progress, error: "secret-database-url" },
      { ...progress, rows: [{ payload: "private" }] },
      { ...progress, table: "select secret from arbitrary_table" },
      { ...progress, batch: 0 },
      { ...progress, batch: 10_001 },
      { ...progress, durationMs: Number.POSITIVE_INFINITY },
      { ...progress, durationMs: governanceSnapshotWorkerTimeoutMs + 1 },
      "secret-database-url",
      null,
    ]) expect(parseGovernanceSnapshotProgress(invalid)).toBeNull();
  });

  it("forwards validated worker progress without mixing it into the final summary", async () => {
    const { child } = createTermIgnoringFakeChild();
    const onProgress = vi.fn();
    const pending = waitForGovernanceSnapshotWorkerProcess(child, { onProgress });
    const progress = { kind: "governance-snapshot-progress-v1", table: "countries", batch: 1, durationMs: 20 };
    child.emit("message", progress);
    (child.stdout as PassThrough).write("summary");
    child.emit("close", 0, null);
    expect(await pending).toEqual({ exitCode: 0, signal: null, stdout: "summary" });
    expect(onProgress).toHaveBeenCalledExactlyOnceWith(progress);
    expect(child.listenerCount("message")).toBe(0);
  });

  it("rejects malformed diagnostic messages without exposing their values", async () => {
    vi.useFakeTimers();
    const { child, signals } = createTermIgnoringFakeChild();
    const onProgress = vi.fn();
    const pending = waitForGovernanceSnapshotWorkerProcess(child, {
      onProgress, terminationGraceMs: 10,
    });
    child.emit("message", { error: "secret-database-url" });
    await vi.advanceTimersByTimeAsync(10);
    expect(await pending).toEqual({ exitCode: null, signal: "SIGKILL", stdout: "" });
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("reaps the worker if its diagnostic sink throws", async () => {
    vi.useFakeTimers();
    const { child, signals } = createTermIgnoringFakeChild();
    const pending = waitForGovernanceSnapshotWorkerProcess(child, {
      onProgress: () => { throw new Error("private sink failure"); },
      terminationGraceMs: 10,
    });
    child.emit("message", { kind: "governance-snapshot-progress-v1", table: "countries", batch: 1, durationMs: 20 });
    await vi.advanceTimersByTimeAsync(10);
    expect(await pending).toEqual({ exitCode: null, signal: "SIGKILL", stdout: "" });
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("lets a real IPC worker exit after sending bounded progress", async () => {
    const progress = {
      kind: "governance-snapshot-progress-v1", table: "countries",
      batch: 1, durationMs: 20,
    };
    const child = spawn(process.execPath, ["-e", [
      `process.send(${JSON.stringify(progress)});`,
      'process.stdout.write("summary");',
    ].join("\n")], { stdio: ["ignore", "pipe", "ignore", "ipc"] });
    const onProgress = vi.fn();
    expect(await waitForGovernanceSnapshotWorkerProcess(child, {
      onProgress, timeoutMs: 5_000, terminationGraceMs: 50,
    })).toEqual({ exitCode: 0, signal: null, stdout: "summary" });
    expect(onProgress).toHaveBeenCalledExactlyOnceWith(progress);
  });

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

  it("retains only settled successful readers and closes the final lease explicitly", async () => {
    const client = { end: vi.fn(async () => undefined), unsafe: vi.fn(async () => undefined) };
    const retain = vi.fn();
    await expect(runSnapshotAcquisitionAttempt(client, async () => "first batch", retain)).resolves.toBe("first batch");
    await expect(runSnapshotAcquisitionAttempt(client, async () => "second batch", retain)).resolves.toBe("second batch");
    expect(retain).toHaveBeenCalledTimes(2);
    expect(retain).toHaveBeenLastCalledWith(client);
    expect(client.unsafe).toHaveBeenCalledTimes(2);
    expect(client.end).not.toHaveBeenCalled();
    await runSnapshotAcquisitionAttempt(client, async () => undefined);
    expect(client.end).toHaveBeenCalledExactlyOnceWith({ timeout: 5 });
  });

  it.each(["read", "probe"])("never retains a reader after %s failure", async (stage) => {
    const failure = new Error("bounded failure");
    const client = {
      end: vi.fn(async () => undefined),
      unsafe: vi.fn(async () => { if (stage === "probe") throw failure; }),
    };
    const retain = vi.fn();
    await expect(runSnapshotAcquisitionAttempt(client, async () => {
      if (stage === "read") throw failure;
    }, retain)).rejects.toBe(failure);
    expect(retain).not.toHaveBeenCalled();
    expect(client.end).toHaveBeenCalledExactlyOnceWith({ timeout: 5 });
  });

  it("replaces a failed retained connection without advancing the batch or snapshot", async () => {
    const clients = [1, 2].map((id) => ({ id, end: vi.fn(async () => undefined), unsafe: vi.fn(async () => undefined) }));
    let retained: typeof clients[number] | undefined;
    let next = 0;
    const readClients: number[] = [];
    const run = (failFirst: boolean) => runGovernanceSnapshotReaderBatchWithRetry({
      assertAnchorHealthy: () => undefined,
      createClient: () => { const client = retained ?? clients[next++]; retained = undefined; return client; },
      retainSuccessfulClient: (client) => { retained = client; },
      read: async (client) => {
        readClients.push(client.id);
        if (failFirst && client.id === 1) throw Object.assign(new Error("transport"), { code: "ECONNRESET" });
        return "same bounded batch";
      },
      waitBeforeRetry: async () => undefined,
    });
    await run(false);
    await run(true);
    await run(false);
    expect(readClients).toEqual([1, 1, 2, 2]);
    expect(next).toBe(2);
    expect(clients[0].end).toHaveBeenCalledTimes(1);
    expect(clients[1].end).not.toHaveBeenCalled();
    await runSnapshotAcquisitionAttempt(retained!, async () => undefined);
    expect(clients[1].end).toHaveBeenCalledTimes(1);
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

  it("preserves every raw JSON row with smaller advancing batches", async () => {
    const sourceRows = Array.from({ length: 205 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      payload: '{"largeInteger":9007199254740993,"precise":1.234567890123456789}',
    }));
    const requestedLimits: number[] = [];
    const cursors: Array<string | null> = [];
    const rows = await collectGovernanceSnapshotRowsInBatches(
      async (cursor, limit) => {
        requestedLimits.push(limit);
        cursors.push(cursor);
        const start = cursor === null
          ? 0 : sourceRows.findIndex((row) => row.id === cursor) + 1;
        return sourceRows.slice(start, start + limit);
      },
      governanceSnapshotRawJsonBatchSize,
    );
    expect(governanceSnapshotRawJsonBatchSize).toBe(100);
    expect(requestedLimits).toEqual([100, 100, 100]);
    expect(cursors).toEqual([null, sourceRows[99]!.id, sourceRows[199]!.id]);
    expect(rows).toEqual(sourceRows);
  });

  it("uses the smaller batch only for all three raw JSON selections", async () => {
    const source = await readFile(
      join(process.cwd(), "scripts/db/export-governance-snapshot.ts"), "utf8",
    );
    for (const [start, end] of [
      ["const governanceDraftRows =", "const marketImportBatchRows ="],
      ["const marketImportBatchRows =", "const changeLogRows ="],
      ["const changeLogRows =", "const selectedTables ="],
    ]) {
      const selection = source.slice(source.indexOf(start!), source.indexOf(end!));
      expect(selection).toContain("collectGovernanceSnapshotRowsInBatches");
      expect(selection).toContain("governanceSnapshotRawJsonBatchSize,");
      expect(selection).toContain("order by id");
      expect(selection).toContain("limit ${limit}");
    }
    expect(governanceSnapshotDatabaseBatchSize).toBe(500);
    expect(governanceSnapshotWorkerTimeoutMs).toBe(governanceSnapshotExportTimeoutMs);
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
    expect(governanceSnapshotWorkerTimeoutMs).toBe(90 * 60 * 1_000);
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
