import { type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import {
  cleanupGovernanceMaintenanceSession,
  createGovernanceMaintenanceChildTerminationController,
  GovernanceMaintenanceProcessGroupError,
  GovernanceMaintenanceSessionError,
  type GovernanceMaintenanceSessionProbe,
  governanceMaintenanceCleanupTimeoutMs,
  governanceMaintenanceCleanupTimeoutSeconds,
  governanceMaintenanceHeartbeatIntervalMs,
  governanceMaintenanceHeartbeatTimeoutMs,
  loadGovernanceMaintenanceDatabaseEnvironment,
  governanceMaintenanceFailureMessage,
  governanceMaintenanceLockHelp,
  governanceMaintenancePostgresOptions,
  governanceMaintenanceReleaseLifecycleLockFd,
  governanceMaintenanceReleaseLifecycleLockFdEnvironmentVariable,
  governanceMaintenanceUnlockSucceeded,
  parseGovernanceMaintenanceCommand,
  resolveGovernanceMaintenanceChildEnvironment,
  resolveGovernanceMaintenanceChildStdio,
  signalGovernanceMaintenanceChild,
  startGovernanceMaintenanceHeartbeat,
  waitForMaintenanceChild,
} from "../scripts/db/with-governance-maintenance-lock";

import {
  assertGovernanceMaintenanceAuthorized,
  assertGovernanceWriteAllowed,
  buildGovernanceWriteLockQuery,
  deriveGovernanceMaintenanceTokenLockKey,
  GovernanceMaintenanceError,
  governanceMaintenanceLockKey,
  governanceMaintenanceTokenEnvironmentVariable,
  governanceWriteLocksAreSupported,
} from "@/server/db/governance-maintenance-lock";

function renderQuery(environment: Record<string, string | undefined>) {
  return new PgDialect().sqlToQuery(
    buildGovernanceWriteLockQuery(environment),
  );
}

function processExitedError(): NodeJS.ErrnoException {
  return Object.assign(new Error("process group exited"), { code: "ESRCH" });
}

function createTermIgnoringProcessGroup() {
  let exists = true;
  const signalProcess = vi.fn(
    (_pid: number, signal: NodeJS.Signals | 0) => {
      if (signal === 0) {
        if (!exists) throw processExitedError();
        return true;
      }
      if (signal === "SIGKILL") exists = false;
      return true;
    },
  );
  return { signalProcess };
}

describe("governance maintenance advisory-lock protocol", () => {
  it("guards document completion before any repository read or write", async () => {
    const source = await readFile(
      resolve(
        process.cwd(),
        "src/server/repositories/knowledge-repository.ts",
      ),
      "utf8",
    );

    expect(source).toMatch(
      /async completeDocument\([\s\S]*?database\.transaction\(async \(transaction\) => \{\s*await assertGovernanceWriteAllowed\(transaction\);/,
    );
    expect(source).toMatch(
      /async markDocumentFailed\([\s\S]*?database\.transaction\(async \(transaction\) => \{\s*await assertGovernanceWriteAllowed\(transaction\);/,
    );
  });

  it("uses the fixed shared transaction lock for ordinary writes", () => {
    const query = renderQuery({ NODE_ENV: "production" });

    expect(query.sql).toBe(
      "select pg_try_advisory_xact_lock_shared($1::bigint) as allowed",
    );
    expect(query.params).toEqual([governanceMaintenanceLockKey]);
  });

  it("requires proof of the wrapper-held token lock for maintenance children", () => {
    const token = "ab".repeat(32);
    const query = renderQuery({
      NODE_ENV: "production",
      [governanceMaintenanceTokenEnvironmentVariable]: token,
    });

    expect(query.sql).toBe(
      "select not pg_try_advisory_xact_lock($1::bigint) as allowed",
    );
    expect(query.params).toEqual([
      deriveGovernanceMaintenanceTokenLockKey(token),
    ]);
    expect(query.params).not.toEqual([governanceMaintenanceLockKey]);
  });

  it("fails closed without exposing an invalid maintenance token", async () => {
    const invalidToken = "do-not-log-this-token";
    const executor = { execute: vi.fn() };

    await expect(
      assertGovernanceWriteAllowed(executor, {
        NODE_ENV: "production",
        [governanceMaintenanceTokenEnvironmentVariable]: invalidToken,
      }),
    ).rejects.toEqual(new GovernanceMaintenanceError());
    expect(executor.execute).not.toHaveBeenCalled();
    expect(() =>
      buildGovernanceWriteLockQuery({
        NODE_ENV: "production",
        [governanceMaintenanceTokenEnvironmentVariable]: invalidToken,
      }),
    ).toThrow("temporarily unavailable");
  });

  it("accepts acquired locks and rejects contention", async () => {
    await expect(
      assertGovernanceWriteAllowed(
        { execute: vi.fn().mockResolvedValue([{ allowed: true }]) },
        { NODE_ENV: "production" },
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertGovernanceWriteAllowed(
        { execute: vi.fn().mockResolvedValue({ rows: [{ allowed: false }] }) },
        { NODE_ENV: "production" },
      ),
    ).rejects.toBeInstanceOf(GovernanceMaintenanceError);
  });

  it("requires a live parent token lock for production maintenance restores", async () => {
    const token = "cd".repeat(32);
    const environment = {
      NODE_ENV: "production",
      [governanceMaintenanceTokenEnvironmentVariable]: token,
    };
    const heldExecutor = {
      execute: vi.fn().mockResolvedValue([{ allowed: true }]),
    };
    await expect(
      assertGovernanceMaintenanceAuthorized(heldExecutor, environment),
    ).resolves.toBeUndefined();
    expect(heldExecutor.execute).toHaveBeenCalledOnce();

    await expect(
      assertGovernanceMaintenanceAuthorized(
        { execute: vi.fn().mockResolvedValue([{ allowed: false }]) },
        environment,
      ),
    ).rejects.toBeInstanceOf(GovernanceMaintenanceError);
  });

  it("rejects production maintenance restores before SQL when the token is absent", async () => {
    const executor = { execute: vi.fn() };

    await expect(
      assertGovernanceMaintenanceAuthorized(executor, {
        NODE_ENV: "production",
      }),
    ).rejects.toBeInstanceOf(GovernanceMaintenanceError);
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("has an explicit PGlite test/demo exception and requires locks otherwise", async () => {
    expect(governanceWriteLocksAreSupported({ NODE_ENV: "test" })).toBe(false);
    expect(
      governanceWriteLocksAreSupported({
        DATABASE_MODE: "pglite-demo",
        NODE_ENV: "development",
      }),
    ).toBe(false);
    expect(
      governanceWriteLocksAreSupported({
        DATABASE_MODE: "pglite-demo",
        NODE_ENV: "production",
      }),
    ).toBe(true);
    expect(governanceWriteLocksAreSupported({ NODE_ENV: "production" })).toBe(
      true,
    );

    const executor = {
      execute: vi.fn().mockRejectedValue(new Error("unsupported by PGlite")),
    };
    await expect(
      assertGovernanceWriteAllowed(executor, { NODE_ENV: "test" }),
    ).resolves.toBeUndefined();
    await expect(
      assertGovernanceMaintenanceAuthorized(executor, { NODE_ENV: "test" }),
    ).resolves.toBeUndefined();
    expect(executor.execute).not.toHaveBeenCalled();
    await expect(
      assertGovernanceWriteAllowed(executor, { NODE_ENV: "production" }),
    ).rejects.toThrow("unsupported by PGlite");
  });
});

describe("governance maintenance command CLI", () => {
  it("parses a single inert database env file option only before the command separator", () => {
    expect(
      parseGovernanceMaintenanceCommand([
        "--database-env-file=/opt/diesel/backups/release/env.production.local.pre-switch",
        "--",
        "bash",
        "state-machine.sh",
      ]),
    ).toEqual({
      command: "bash",
      commandArgs: ["state-machine.sh"],
      databaseEnvironmentFile:
        "/opt/diesel/backups/release/env.production.local.pre-switch",
      help: false,
    });
    expect(() =>
      parseGovernanceMaintenanceCommand([
        "--database-env-file=first",
        "--database-env-file=second",
        "--",
        "bash",
      ]),
    ).toThrow("command is required");
    expect(() =>
      parseGovernanceMaintenanceCommand([
        "--",
        "bash",
        "--database-env-file=late",
      ]),
    ).not.toThrow();
    expect(() =>
      parseGovernanceMaintenanceCommand([
        "--database-env-file=",
        "--",
        "bash",
      ]),
    ).toThrow("path is required");
  });

  it("loads only validated inert values from a stable 0600 env file", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "diesel-governance-environment-"),
    );
    const environmentPath = join(directory, "environment");
    try {
      await writeFile(
        environmentPath,
        [
          "DATABASE_URL=postgresql://diesel:secret@db.example/diesel",
          "KNOWLEDGE_STORAGE_ROOT= governance/archive ",
          "NODE_OPTIONS=--import=/tmp/attacker.mjs",
          "BASH_ENV=/tmp/attacker.sh",
          "AI_API_KEY=must-not-cross-boundary",
        ].join("\n"),
        { mode: 0o600 },
      );
      await chmod(environmentPath, 0o600);

      expect(
        loadGovernanceMaintenanceDatabaseEnvironment(environmentPath, {
          expectedGid: process.getgid?.() ?? 0,
          expectedUid: process.getuid?.() ?? 0,
        }),
      ).toEqual({
        databaseUrl: "postgresql://diesel:secret@db.example/diesel",
        knowledgeStorageRoot: "governance/archive",
      });

      await chmod(environmentPath, 0o640);
      expect(() =>
        loadGovernanceMaintenanceDatabaseEnvironment(environmentPath, {
          expectedGid: process.getgid?.() ?? 0,
          expectedUid: process.getuid?.() ?? 0,
        }),
      ).toThrow("could not be loaded");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects symlink env files even when their target is otherwise valid", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "diesel-governance-environment-link-"),
    );
    const environmentPath = join(directory, "environment");
    const linkPath = join(directory, "environment-link");
    try {
      await writeFile(
        environmentPath,
        "DATABASE_URL=postgresql://diesel:secret@db.example/diesel\n",
        { mode: 0o600 },
      );
      await symlink(environmentPath, linkPath);
      expect(() =>
        loadGovernanceMaintenanceDatabaseEnvironment(linkPath, {
          expectedGid: process.getgid?.() ?? 0,
          expectedUid: process.getuid?.() ?? 0,
        }),
      ).toThrow("could not be loaded");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("passes an exact child allowlist and discards startup hooks and service secrets", () => {
    const childEnvironment = resolveGovernanceMaintenanceChildEnvironment({
      databaseEnvironment: {
        databaseUrl: "postgresql://diesel:secret@db.example/diesel",
        knowledgeStorageRoot: "knowledge",
      },
      maintenanceToken: "ab".repeat(32),
      parentEnvironment: {
        AI_API_KEY: "must-not-cross-boundary",
        BASH_ENV: "/tmp/attacker.sh",
        DATABASE_MODE: "postgres",
        DIESEL_RELEASE_LIFECYCLE_LOCK_FD: "8",
        ENV: "/tmp/attacker.sh",
        HOME: "/root",
        LD_PRELOAD: "/tmp/attacker.so",
        NODE_ENV: "production",
        NODE_OPTIONS: "--import=/tmp/attacker.mjs",
        NODE_PATH: "/tmp/attacker-modules",
        PATH: "/trusted/bin",
        release_id: "a".repeat(40),
        SHELLOPTS: "xtrace",
      },
    });

    expect(childEnvironment).toEqual({
      DATABASE_MODE: "postgres",
      DATABASE_URL: "postgresql://diesel:secret@db.example/diesel",
      DIESEL_GOVERNANCE_MAINTENANCE_TOKEN: "ab".repeat(32),
      DIESEL_RELEASE_LIFECYCLE_LOCK_FD: "8",
      HOME: "/root",
      KNOWLEDGE_STORAGE_ROOT: "knowledge",
      NODE_ENV: "production",
      PATH: "/trusted/bin",
      release_id: "a".repeat(40),
    });
    expect(childEnvironment).not.toHaveProperty("AI_API_KEY");
    expect(childEnvironment).not.toHaveProperty("BASH_ENV");
    expect(childEnvironment).not.toHaveProperty("ENV");
    expect(childEnvironment).not.toHaveProperty("LD_PRELOAD");
    expect(childEnvironment).not.toHaveProperty("NODE_OPTIONS");
    expect(childEnvironment).not.toHaveProperty("NODE_PATH");
    expect(childEnvironment).not.toHaveProperty("SHELLOPTS");
  });

  it("signals the complete Unix maintenance process group", () => {
    const kill = vi.fn().mockReturnValue(true);
    const signalProcess = vi.fn().mockReturnValue(true);

    signalGovernanceMaintenanceChild(
      { kill, pid: 4_321 },
      "SIGTERM",
      { platform: "linux", signalProcess },
    );

    expect(signalProcess).toHaveBeenCalledOnce();
    expect(signalProcess).toHaveBeenCalledWith(-4_321, "SIGTERM");
    expect(kill).not.toHaveBeenCalled();
  });

  it("falls back to the direct child if Unix group signalling races exit", () => {
    const kill = vi.fn().mockReturnValue(true);
    const signalProcess = vi.fn(() => {
      throw new Error("process group exited");
    });

    signalGovernanceMaintenanceChild(
      { kill, pid: 4_321 },
      "SIGHUP",
      { platform: "linux", signalProcess },
    );

    expect(signalProcess).toHaveBeenCalledWith(-4_321, "SIGHUP");
    expect(kill).toHaveBeenCalledOnce();
    expect(kill).toHaveBeenCalledWith("SIGHUP");
  });

  it("escalates an ignored wrapper signal once and waits for direct close", async () => {
    const signalTarget = new EventEmitter();
    const childEvents = new EventEmitter();
    const child = Object.assign(childEvents, {
      kill: vi.fn().mockReturnValue(true),
      pid: 4_321,
    }) as unknown as ChildProcess;
    const { signalProcess } = createTermIgnoringProcessGroup();
    const processGroupOptions = {
      killGraceMs: 0,
      platform: "linux" as const,
      signalProcess,
      sleep: async () => undefined,
      termGraceMs: 0,
    };
    const controller =
      createGovernanceMaintenanceChildTerminationController(
        child,
        processGroupOptions,
      );
    let settled = false;
    const waiting = waitForMaintenanceChild(
      child,
      signalTarget,
      processGroupOptions,
      controller,
    ).finally(() => {
      settled = true;
    });

    signalTarget.emit("SIGINT");
    await vi.waitFor(() =>
      expect(signalProcess).toHaveBeenCalledWith(-4_321, "SIGKILL"),
    );
    expect(signalProcess).toHaveBeenCalledWith(-4_321, "SIGINT");
    expect(settled).toBe(false);

    childEvents.emit("close", null, "SIGKILL");
    await expect(waiting).resolves.toBe(130);
    expect(
      signalProcess.mock.calls.filter(([, signal]) => signal === "SIGINT"),
    ).toHaveLength(1);
    expect(
      signalProcess.mock.calls.filter(([, signal]) => signal === "SIGKILL"),
    ).toHaveLength(1);
  });

  it("proves an errored valid child process group empty before rejecting", async () => {
    const signalTarget = new EventEmitter();
    const childEvents = new EventEmitter();
    const child = Object.assign(childEvents, {
      kill: vi.fn().mockReturnValue(true),
      pid: 5_432,
    }) as unknown as ChildProcess;
    const { signalProcess } = createTermIgnoringProcessGroup();
    const processGroupOptions = {
      killGraceMs: 0,
      platform: "linux" as const,
      signalProcess,
      sleep: async () => undefined,
      termGraceMs: 0,
    };
    const controller =
      createGovernanceMaintenanceChildTerminationController(
        child,
        processGroupOptions,
      );
    const originalError = new Error("child transport failed");
    let settled = false;
    const waiting = waitForMaintenanceChild(
      child,
      signalTarget,
      processGroupOptions,
      controller,
    ).finally(() => {
      settled = true;
    });

    childEvents.emit("error", originalError);
    await vi.waitFor(() =>
      expect(signalProcess).toHaveBeenCalledWith(-5_432, "SIGKILL"),
    );
    expect(settled).toBe(false);
    childEvents.emit("close", null, "SIGKILL");

    await expect(waiting).rejects.toBe(originalError);
  });

  it("starts bounded group termination immediately when the heartbeat fails", async () => {
    const signalTarget = new EventEmitter();
    const childEvents = new EventEmitter();
    const child = Object.assign(childEvents, {
      kill: vi.fn().mockReturnValue(true),
      pid: 6_543,
    }) as unknown as ChildProcess;
    const { signalProcess } = createTermIgnoringProcessGroup();
    const processGroupOptions = {
      killGraceMs: 0,
      platform: "linux" as const,
      signalProcess,
      sleep: async () => undefined,
      termGraceMs: 0,
    };
    const controller =
      createGovernanceMaintenanceChildTerminationController(
        child,
        processGroupOptions,
      );
    const waiting = waitForMaintenanceChild(
      child,
      signalTarget,
      processGroupOptions,
      controller,
    );
    const heartbeat = startGovernanceMaintenanceHeartbeat({
      child,
      expectedBackendPid: 101,
      intervalMs: 1,
      probe: async () => ({
        backendPid: 101,
        globalBalanced: false,
        globalHeld: false,
        globalReentered: false,
        tokenBalanced: false,
        tokenHeld: false,
        tokenReentered: false,
      }),
      terminate: () => controller.terminate("SIGTERM"),
      timeoutMs: 50,
    });

    await vi.waitFor(() =>
      expect(signalProcess).toHaveBeenCalledWith(-6_543, "SIGKILL"),
    );
    const stopping = heartbeat.stop();
    childEvents.emit("close", null, "SIGKILL");

    await expect(waiting).resolves.toBe(137);
    await expect(stopping).resolves.toBeInstanceOf(
      GovernanceMaintenanceSessionError,
    );
  });

  it("fails closed when a process group remains after bounded SIGKILL", async () => {
    const signalTarget = new EventEmitter();
    const childEvents = new EventEmitter();
    const signalProcess = vi.fn().mockReturnValue(true);
    const child = Object.assign(childEvents, {
      kill: vi.fn().mockReturnValue(true),
      pid: 7_654,
    }) as unknown as ChildProcess;
    const processGroupOptions = {
      killGraceMs: 0,
      platform: "linux" as const,
      signalProcess,
      sleep: async () => undefined,
      termGraceMs: 0,
    };
    const controller =
      createGovernanceMaintenanceChildTerminationController(
        child,
        processGroupOptions,
      );
    const waiting = waitForMaintenanceChild(
      child,
      signalTarget,
      processGroupOptions,
      controller,
    );

    signalTarget.emit("SIGTERM");

    await expect(waiting).rejects.toBeInstanceOf(
      GovernanceMaintenanceProcessGroupError,
    );
    expect(signalProcess).toHaveBeenCalledWith(-7_654, "SIGKILL");
  });

  it("spawns production maintenance commands in a dedicated Unix process group", async () => {
    const source = await readFile(
      resolve(
        process.cwd(),
        "scripts/db/with-governance-maintenance-lock.ts",
      ),
      "utf8",
    );

    expect(source).toContain('detached: process.platform !== "win32"');
    expect(source).toContain(
      "signalGovernanceMaintenanceChild(input.child, \"SIGTERM\")",
    );
    expect(source).toContain(
      "signalGovernanceMaintenanceChild(child, signal)",
    );
    expect(source).toContain(
      "stdio: resolveGovernanceMaintenanceChildStdio(childEnvironment)",
    );
    expect(source).toMatch(
      /error instanceof GovernanceMaintenanceProcessGroupError[\s\S]*?explicitUnlockAllowed = false/,
    );
  });

  it("inherits the fixed release lifecycle lock descriptor when explicitly declared", () => {
    expect(governanceMaintenanceReleaseLifecycleLockFd).toBe(8);
    expect(
      governanceMaintenanceReleaseLifecycleLockFdEnvironmentVariable,
    ).toBe("DIESEL_RELEASE_LIFECYCLE_LOCK_FD");
    expect(
      resolveGovernanceMaintenanceChildStdio({
        [governanceMaintenanceReleaseLifecycleLockFdEnvironmentVariable]:
          "8",
      }),
    ).toEqual([
      "inherit",
      "inherit",
      "inherit",
      "ignore",
      "ignore",
      "ignore",
      "ignore",
      "ignore",
      "inherit",
    ]);
  });

  it("keeps ordinary maintenance command stdio unchanged without a lifecycle descriptor", () => {
    expect(resolveGovernanceMaintenanceChildStdio({})).toBe("inherit");
  });

  it.each(["", "7", "08", "8 ", " 8", "fd:8"])(
    "does not inherit fd 8 for invalid lifecycle descriptor declaration %j",
    (value) => {
      expect(
        resolveGovernanceMaintenanceChildStdio({
          [governanceMaintenanceReleaseLifecycleLockFdEnvironmentVariable]:
            value,
        }),
      ).toBe("inherit");
    },
  );

  it("performs one final healthy proof for a child that exits before the first interval", async () => {
    const probe = vi.fn(async () => ({
      backendPid: 101,
      globalBalanced: true,
      globalHeld: true,
      globalReentered: true,
      tokenBalanced: true,
      tokenHeld: true,
      tokenReentered: true,
    }));
    const kill = vi.fn().mockReturnValue(true);
    const heartbeat = startGovernanceMaintenanceHeartbeat({
      child: { kill } as Pick<ChildProcess, "kill">,
      expectedBackendPid: 101,
      intervalMs: 60_000,
      probe,
      timeoutMs: 50,
    });

    const stopping = heartbeat.stop();
    await expect(stopping).resolves.toBeNull();
    await expect(heartbeat.stop()).resolves.toBeNull();
    expect(probe).toHaveBeenCalledOnce();
    expect(kill).not.toHaveBeenCalled();
  });

  it("shares one final proof across concurrent stop calls", async () => {
    let finishProbe:
      | ((probe: GovernanceMaintenanceSessionProbe) => void)
      | undefined;
    const probe = vi.fn(
      () =>
        new Promise<GovernanceMaintenanceSessionProbe>((resolveProbe) => {
          finishProbe = resolveProbe;
        }),
    );
    const kill = vi.fn().mockReturnValue(true);
    const heartbeat = startGovernanceMaintenanceHeartbeat({
      child: { kill } as Pick<ChildProcess, "kill">,
      expectedBackendPid: 101,
      intervalMs: 60_000,
      probe,
      timeoutMs: 1_000,
    });

    const firstStop = heartbeat.stop();
    const secondStop = heartbeat.stop();
    expect(secondStop).toBe(firstStop);
    finishProbe?.({
      backendPid: 101,
      globalBalanced: true,
      globalHeld: true,
      globalReentered: true,
      tokenBalanced: true,
      tokenHeld: true,
      tokenReentered: true,
    });

    await expect(Promise.all([firstStop, secondStop])).resolves.toEqual([
      null,
      null,
    ]);
    expect(probe).toHaveBeenCalledOnce();
    expect(kill).not.toHaveBeenCalled();
  });

  it("shares a failed in-flight proof across stop calls without terminating an exited child", async () => {
    vi.useFakeTimers();
    try {
      const probe = vi.fn(
        () => new Promise<GovernanceMaintenanceSessionProbe>(() => undefined),
      );
      const kill = vi.fn().mockReturnValue(true);
      const heartbeat = startGovernanceMaintenanceHeartbeat({
        child: { kill } as Pick<ChildProcess, "kill">,
        expectedBackendPid: 101,
        intervalMs: 100,
        probe,
        timeoutMs: 50,
      });

      await vi.advanceTimersByTimeAsync(100);
      expect(probe).toHaveBeenCalledOnce();

      const firstStop = heartbeat.stop();
      const secondStop = heartbeat.stop();
      expect(secondStop).toBe(firstStop);

      await vi.advanceTimersByTimeAsync(50);
      const expectedFailure = await firstStop;
      await expect(secondStop).resolves.toBe(expectedFailure);
      expect(expectedFailure).toBeInstanceOf(
        GovernanceMaintenanceSessionError,
      );
      expect(probe).toHaveBeenCalledOnce();
      expect(kill).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails a short completed child when the final lock proof is invalid", async () => {
    const probe = vi.fn(async () => ({
      backendPid: 202,
      globalBalanced: false,
      globalHeld: false,
      globalReentered: false,
      tokenBalanced: false,
      tokenHeld: false,
      tokenReentered: false,
    }));
    const kill = vi.fn().mockReturnValue(true);
    const heartbeat = startGovernanceMaintenanceHeartbeat({
      child: { kill } as Pick<ChildProcess, "kill">,
      expectedBackendPid: 101,
      intervalMs: 60_000,
      probe,
      timeoutMs: 50,
    });

    await expect(heartbeat.stop()).resolves.toBeInstanceOf(
      GovernanceMaintenanceSessionError,
    );
    expect(probe).toHaveBeenCalledOnce();
    expect(kill).not.toHaveBeenCalled();
  });

  it("requires every originally held lock to report a successful release", () => {
    expect(
      governanceMaintenanceUnlockSucceeded({
        globalLockHeld: true,
        result: { globalReleased: true, tokenReleased: true },
        tokenLockHeld: true,
      }),
    ).toBe(true);
    expect(
      governanceMaintenanceUnlockSucceeded({
        globalLockHeld: true,
        result: { globalReleased: false, tokenReleased: true },
        tokenLockHeld: true,
      }),
    ).toBe(false);
    expect(
      governanceMaintenanceUnlockSucceeded({
        globalLockHeld: true,
        result: undefined,
        tokenLockHeld: true,
      }),
    ).toBe(false);
  });

  it("bounds a stuck explicit unlock and still force-closes the session", async () => {
    vi.useFakeTimers();
    try {
      const unlock = vi.fn(
        () =>
          new Promise<{
            globalReleased: boolean;
            tokenReleased: boolean;
          }>(() => undefined),
      );
      const close = vi.fn().mockResolvedValue(undefined);
      const cleanup = cleanupGovernanceMaintenanceSession({
        close,
        globalLockHeld: true,
        tokenLockHeld: true,
        unlock,
      });
      const cleanupExpectation = expect(cleanup).rejects.toBeInstanceOf(
        GovernanceMaintenanceSessionError,
      );

      await vi.advanceTimersByTimeAsync(
        governanceMaintenanceCleanupTimeoutMs - 1,
      );
      expect(close).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);

      await cleanupExpectation;
      expect(unlock).toHaveBeenCalledOnce();
      expect(close).toHaveBeenCalledOnce();
      expect(close).toHaveBeenCalledWith(
        governanceMaintenanceCleanupTimeoutSeconds,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips queued unlock work after a failed heartbeat and closes the session", async () => {
    const close = vi.fn().mockResolvedValue(undefined);

    await expect(
      cleanupGovernanceMaintenanceSession({
        close,
        globalLockHeld: true,
        tokenLockHeld: true,
        unlock: null,
      }),
    ).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledWith(
      governanceMaintenanceCleanupTimeoutSeconds,
    );
  });

  it("pins the lock-owning PostgreSQL session for the child lifetime", () => {
    expect(governanceMaintenancePostgresOptions).toMatchObject({
      idle_timeout: undefined,
      keep_alive: 15,
      max: 1,
      max_lifetime: null,
    });
    expect(governanceMaintenanceHeartbeatIntervalMs).toBeLessThanOrEqual(
      15_000,
    );
    expect(governanceMaintenanceHeartbeatTimeoutMs).toBe(30_000);
    expect(governanceMaintenanceHeartbeatTimeoutMs).toBeGreaterThan(
      governanceMaintenanceHeartbeatIntervalMs,
    );
  });

  it("allows a slow healthy probe within the production deadline", async () => {
    vi.useFakeTimers();
    try {
      const probe = vi.fn(
        () =>
          new Promise<GovernanceMaintenanceSessionProbe>((resolveProbe) => {
            setTimeout(
              () =>
                resolveProbe({
                  backendPid: 101,
                  globalBalanced: true,
                  globalHeld: true,
                  globalReentered: true,
                  tokenBalanced: true,
                  tokenHeld: true,
                  tokenReentered: true,
                }),
              6_000,
            );
          }),
      );
      const kill = vi.fn().mockReturnValue(true);
      const heartbeat = startGovernanceMaintenanceHeartbeat({
        child: { kill } as Pick<ChildProcess, "kill">,
        expectedBackendPid: 101,
        probe,
      });

      await vi.advanceTimersByTimeAsync(
        governanceMaintenanceHeartbeatIntervalMs + 5_001,
      );
      expect(probe).toHaveBeenCalledOnce();
      expect(kill).not.toHaveBeenCalled();

      const stopping = heartbeat.stop();
      await vi.advanceTimersByTimeAsync(999);
      await vi.advanceTimersByTimeAsync(6_000);
      await expect(stopping).resolves.toBeNull();
      expect(probe).toHaveBeenCalledTimes(2);
      expect(kill).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed when the production probe deadline expires", async () => {
    vi.useFakeTimers();
    try {
      const probe = vi.fn(
        () => new Promise<GovernanceMaintenanceSessionProbe>(() => undefined),
      );
      const kill = vi.fn().mockReturnValue(true);
      const heartbeat = startGovernanceMaintenanceHeartbeat({
        child: { kill } as Pick<ChildProcess, "kill">,
        expectedBackendPid: 101,
        probe,
      });

      await vi.advanceTimersByTimeAsync(
        governanceMaintenanceHeartbeatIntervalMs +
          governanceMaintenanceHeartbeatTimeoutMs -
          1,
      );
      expect(probe).toHaveBeenCalledOnce();
      expect(kill).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      await expect(heartbeat.stop()).resolves.toBeInstanceOf(
        GovernanceMaintenanceSessionError,
      );
      expect(kill).toHaveBeenCalledOnce();
      expect(kill).toHaveBeenCalledWith("SIGTERM");
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs heartbeat probes single-flight when one interval is slow", async () => {
    vi.useFakeTimers();
    try {
      let finishProbe: (() => void) | undefined;
      const probe = vi.fn(
        () =>
          new Promise<GovernanceMaintenanceSessionProbe>((resolveProbe) => {
            finishProbe = () =>
              resolveProbe({
                backendPid: 101,
                globalBalanced: true,
                globalHeld: true,
                globalReentered: true,
                tokenBalanced: true,
                tokenHeld: true,
                tokenReentered: true,
              });
          }),
      );
      const kill = vi.fn().mockReturnValue(true);
      const heartbeat = startGovernanceMaintenanceHeartbeat({
        child: { kill } as Pick<ChildProcess, "kill">,
        expectedBackendPid: 101,
        intervalMs: 100,
        probe,
        timeoutMs: 1_000,
      });

      await vi.advanceTimersByTimeAsync(500);
      expect(probe).toHaveBeenCalledOnce();
      expect(kill).not.toHaveBeenCalled();

      finishProbe?.();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(100);
      expect(probe).toHaveBeenCalledTimes(2);

      finishProbe?.();
      const stopping = heartbeat.stop();
      await vi.advanceTimersByTimeAsync(0);
      finishProbe?.();
      await expect(stopping).resolves.toBeNull();
      expect(probe).toHaveBeenCalledTimes(3);
      expect(kill).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("requires a fresh final proof after an in-flight heartbeat completes", async () => {
    vi.useFakeTimers();
    try {
      let finishInFlightProbe:
        | ((probe: GovernanceMaintenanceSessionProbe) => void)
        | undefined;
      const healthyProbe: GovernanceMaintenanceSessionProbe = {
        backendPid: 101,
        globalBalanced: true,
        globalHeld: true,
        globalReentered: true,
        tokenBalanced: true,
        tokenHeld: true,
        tokenReentered: true,
      };
      const probe = vi
        .fn<() => Promise<GovernanceMaintenanceSessionProbe>>()
        .mockImplementationOnce(
          () =>
            new Promise((resolveProbe) => {
              finishInFlightProbe = resolveProbe;
            }),
        )
        .mockResolvedValueOnce({
          ...healthyProbe,
          tokenHeld: false,
        });
      const kill = vi.fn().mockReturnValue(true);
      const heartbeat = startGovernanceMaintenanceHeartbeat({
        child: { kill } as Pick<ChildProcess, "kill">,
        expectedBackendPid: 101,
        intervalMs: 100,
        probe,
        timeoutMs: 1_000,
      });

      await vi.advanceTimersByTimeAsync(100);
      const stopping = heartbeat.stop();
      finishInFlightProbe?.(healthyProbe);
      await vi.advanceTimersByTimeAsync(0);

      await expect(stopping).resolves.toBeInstanceOf(
        GovernanceMaintenanceSessionError,
      );
      expect(probe).toHaveBeenCalledTimes(2);
      expect(kill).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a healthy same-session heartbeat active until explicitly stopped", async () => {
    vi.useFakeTimers();
    try {
      const probe = vi.fn(async () => ({
        backendPid: 101,
        globalBalanced: true,
        globalHeld: true,
        globalReentered: true,
        tokenBalanced: true,
        tokenHeld: true,
        tokenReentered: true,
      }));
      const kill = vi.fn().mockReturnValue(true);
      const heartbeat = startGovernanceMaintenanceHeartbeat({
        child: { kill } as Pick<ChildProcess, "kill">,
        expectedBackendPid: 101,
        intervalMs: 100,
        probe,
        timeoutMs: 50,
      });

      await vi.advanceTimersByTimeAsync(200);

      await expect(heartbeat.stop()).resolves.toBeNull();
      expect(probe).toHaveBeenCalledTimes(3);
      expect(kill).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(500);
      expect(probe).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    "globalHeld",
    "globalReentered",
    "globalBalanced",
    "tokenHeld",
    "tokenReentered",
    "tokenBalanced",
  ] as const)("terminates the child when %s proof is lost", async (field) => {
    vi.useFakeTimers();
    try {
      const probe = vi.fn(async () => ({
        backendPid: 101,
        globalBalanced: true,
        globalHeld: true,
        globalReentered: true,
        tokenBalanced: true,
        tokenHeld: true,
        tokenReentered: true,
        [field]: false,
      }));
      const kill = vi.fn().mockReturnValue(true);
      const heartbeat = startGovernanceMaintenanceHeartbeat({
        child: { kill } as Pick<ChildProcess, "kill">,
        expectedBackendPid: 101,
        intervalMs: 100,
        probe,
        timeoutMs: 50,
      });

      await vi.advanceTimersByTimeAsync(100);

      await expect(heartbeat.stop()).resolves.toBeInstanceOf(
        GovernanceMaintenanceSessionError,
      );
      expect(probe).toHaveBeenCalledOnce();
      expect(kill).toHaveBeenCalledOnce();
      expect(kill).toHaveBeenCalledWith("SIGTERM");

      await vi.advanceTimersByTimeAsync(500);
      expect(probe).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("terminates the child when the lock session is replaced", async () => {
    vi.useFakeTimers();
    try {
      const fakeClient = {
        backendPid: 202,
        probe: vi.fn(async () => ({
          backendPid: 202,
          globalBalanced: true,
          globalHeld: true,
          globalReentered: true,
          tokenBalanced: true,
          tokenHeld: true,
          tokenReentered: true,
        })),
      };
      const kill = vi.fn().mockReturnValue(true);
      const heartbeat = startGovernanceMaintenanceHeartbeat({
        child: { kill } as Pick<ChildProcess, "kill">,
        expectedBackendPid: 101,
        intervalMs: 100,
        probe: fakeClient.probe,
        timeoutMs: 50,
      });

      await vi.advanceTimersByTimeAsync(100);

      await expect(heartbeat.stop()).resolves.toBeInstanceOf(
        GovernanceMaintenanceSessionError,
      );
      expect(fakeClient.probe).toHaveBeenCalledOnce();
      expect(kill).toHaveBeenCalledOnce();
      expect(kill).toHaveBeenCalledWith("SIGTERM");

      await vi.advanceTimersByTimeAsync(500);
      expect(fakeClient.probe).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("terminates the child when the heartbeat query fails", async () => {
    vi.useFakeTimers();
    try {
      const fakeClient = {
        probe: vi.fn().mockRejectedValue(new Error("connection closed")),
      };
      const signalTarget = new EventEmitter();
      const childEvents = new EventEmitter();
      const kill = vi.fn().mockReturnValue(true);
      const child = Object.assign(childEvents, {
        kill,
      }) as unknown as ChildProcess;
      let childSettled = false;
      const waiting = waitForMaintenanceChild(child, signalTarget).finally(() => {
        childSettled = true;
      });
      const heartbeat = startGovernanceMaintenanceHeartbeat({
        child,
        expectedBackendPid: 101,
        intervalMs: 100,
        probe: fakeClient.probe,
        timeoutMs: 50,
      });

      await vi.advanceTimersByTimeAsync(100);

      await expect(heartbeat.stop()).resolves.toBeInstanceOf(
        GovernanceMaintenanceSessionError,
      );
      expect(fakeClient.probe).toHaveBeenCalledOnce();
      expect(kill).toHaveBeenCalledOnce();
      expect(kill).toHaveBeenCalledWith("SIGTERM");
      expect(childSettled).toBe(false);

      childEvents.emit("close", null, "SIGTERM");
      await expect(waiting).resolves.toBe(143);
    } finally {
      vi.useRealTimers();
    }
  });

  it("parses database-free help and a shell-free child command", () => {
    expect(parseGovernanceMaintenanceCommand(["--help"])).toEqual({
      help: true,
    });
    expect(governanceMaintenanceLockHelp).toContain("-- <command> [args...]");
    expect(
      parseGovernanceMaintenanceCommand([
        "--",
        "node_modules/.bin/tsx",
        "script.ts",
        "--country=KEN",
      ]),
    ).toEqual({
      command: "node_modules/.bin/tsx",
      commandArgs: ["script.ts", "--country=KEN"],
      help: false,
    });
  });

  it("redacts malformed command arguments", () => {
    const secretArgument = "super-secret-command-argument";

    expect(() =>
      parseGovernanceMaintenanceCommand([secretArgument]),
    ).toThrow("A command is required");
    expect(governanceMaintenanceFailureMessage).toContain(
      "no credentials or command arguments were logged",
    );
    expect(governanceMaintenanceFailureMessage).not.toContain(secretArgument);
  });

  it.each([
    ["SIGHUP", 129],
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const)("forwards %s and waits for the child before returning", async (signal, code) => {
    const signalTarget = new EventEmitter();
    const childEvents = new EventEmitter();
    const kill = vi.fn().mockReturnValue(true);
    const child = Object.assign(childEvents, { kill }) as unknown as ChildProcess;
    const waiting = waitForMaintenanceChild(child, signalTarget);

    signalTarget.emit(signal);
    expect(kill).toHaveBeenCalledWith(signal);
    childEvents.emit("close", null, signal);

    await expect(waiting).resolves.toBe(code);
    expect(signalTarget.listenerCount(signal)).toBe(0);
  });

  it("does not let a child report success after the wrapper received a termination signal", async () => {
    const signalTarget = new EventEmitter();
    const childEvents = new EventEmitter();
    const kill = vi.fn().mockReturnValue(true);
    const child = Object.assign(childEvents, { kill }) as unknown as ChildProcess;
    const waiting = waitForMaintenanceChild(child, signalTarget);

    signalTarget.emit("SIGINT");
    childEvents.emit("close", 0, null);

    await expect(waiting).resolves.toBe(130);
    expect(kill).toHaveBeenCalledWith("SIGINT");
  });
});
