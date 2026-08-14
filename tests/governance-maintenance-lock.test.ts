import { type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import {
  GovernanceMaintenanceSessionError,
  type GovernanceMaintenanceSessionProbe,
  governanceMaintenanceHeartbeatIntervalMs,
  governanceMaintenanceHeartbeatTimeoutMs,
  governanceMaintenanceFailureMessage,
  governanceMaintenanceLockHelp,
  governanceMaintenancePostgresOptions,
  parseGovernanceMaintenanceCommand,
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

      await vi.advanceTimersByTimeAsync(999);
      await expect(heartbeat.stop()).resolves.toBeNull();
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
      await expect(heartbeat.stop()).resolves.toBeNull();
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
      expect(probe).toHaveBeenCalledTimes(2);
      expect(kill).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(500);
      expect(probe).toHaveBeenCalledTimes(2);
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
});
