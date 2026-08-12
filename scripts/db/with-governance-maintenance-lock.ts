import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { pathToFileURL } from "node:url";

import postgres from "postgres";

import { getDatabaseUrl } from "../../src/server/db/environment";
import {
  deriveGovernanceMaintenanceTokenLockKey,
  governanceMaintenanceLockKey,
  governanceMaintenanceTokenEnvironmentVariable,
} from "../../src/server/db/governance-maintenance-lock";

export const governanceMaintenancePostgresOptions = {
  idle_timeout: undefined,
  keep_alive: 15,
  max: 1,
  max_lifetime: null,
  prepare: false,
} as const satisfies postgres.Options<Record<string, never>>;

export const governanceMaintenanceHeartbeatIntervalMs = 10_000;
export const governanceMaintenanceHeartbeatTimeoutMs = 30_000;

export type GovernanceMaintenanceSessionProbe = {
  backendPid: number;
  globalBalanced: boolean;
  globalHeld: boolean;
  globalReentered: boolean;
  tokenBalanced: boolean;
  tokenHeld: boolean;
  tokenReentered: boolean;
};

export class GovernanceMaintenanceSessionError extends Error {
  constructor() {
    super("Governance maintenance database session was lost.");
    this.name = "GovernanceMaintenanceSessionError";
  }
}

export const governanceMaintenanceLockHelp = `Usage:
  tsx scripts/db/with-governance-maintenance-lock.ts -- <command> [args...]

Acquires the production PostgreSQL governance maintenance lock, then executes
one child command without a shell. The child and its descendants may perform
governance writes. Ordinary governance repository writes fail fast until the
child exits. HUP, INT, and TERM are forwarded while the database locks remain
held so the child can run its own rollback trap.
`;
export const governanceMaintenanceFailureMessage =
  "Governance maintenance command failed; no credentials or command arguments were logged.\n";

export function parseGovernanceMaintenanceCommand(
  args: readonly string[],
): { help: true } | { command: string; commandArgs: string[]; help: false } {
  if (args.length === 1 && ["--help", "-h"].includes(args[0] ?? "")) {
    return { help: true };
  }
  if (args[0] !== "--" || !args[1]) {
    throw new Error("A command is required after --");
  }
  if (args.some((value) => value.includes("\0"))) {
    throw new Error("Command arguments must not contain NUL bytes");
  }
  return {
    command: args[1],
    commandArgs: args.slice(2),
    help: false,
  };
}

type ForwardedSignal = "SIGHUP" | "SIGINT" | "SIGTERM";
type SignalTarget = {
  off(signal: ForwardedSignal, listener: () => void): unknown;
  on(signal: ForwardedSignal, listener: () => void): unknown;
};

type HeartbeatChild = Pick<ChildProcess, "kill">;

export function startGovernanceMaintenanceHeartbeat(input: {
  child: HeartbeatChild;
  expectedBackendPid: number;
  intervalMs?: number;
  probe: () => Promise<GovernanceMaintenanceSessionProbe | undefined>;
  timeoutMs?: number;
}): {
  stop: () => Promise<GovernanceMaintenanceSessionError | null>;
} {
  const intervalMs =
    input.intervalMs ?? governanceMaintenanceHeartbeatIntervalMs;
  const timeoutMs =
    input.timeoutMs ?? governanceMaintenanceHeartbeatTimeoutMs;
  let activeCheck: Promise<void> | undefined;
  let failure: GovernanceMaintenanceSessionError | null = null;
  let monitoring = true;
  const timerState: { current?: ReturnType<typeof setInterval> } = {};

  const stopTimer = () => {
    monitoring = false;
    if (timerState.current !== undefined) {
      clearInterval(timerState.current);
    }
  };
  const fail = () => {
    failure ??= new GovernanceMaintenanceSessionError();
    if (!monitoring) {
      return;
    }
    stopTimer();
    try {
      input.child.kill("SIGTERM");
    } catch {
      // The child may have exited between the failed probe and termination.
    }
  };
  const probeBeforeDeadline = async () => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        input.probe(),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new GovernanceMaintenanceSessionError()),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  };
  const check = async () => {
    try {
      const probe = await probeBeforeDeadline();
      if (
        probe?.backendPid !== input.expectedBackendPid ||
        probe.globalHeld !== true ||
        probe.globalReentered !== true ||
        probe.globalBalanced !== true ||
        probe.tokenHeld !== true ||
        probe.tokenReentered !== true ||
        probe.tokenBalanced !== true
      ) {
        fail();
      }
    } catch {
      fail();
    }
  };
  const timer = setInterval(() => {
    if (!monitoring || activeCheck !== undefined) {
      return;
    }
    activeCheck = check().finally(() => {
      activeCheck = undefined;
    });
  }, intervalMs);
  timerState.current = timer;
  timer.unref();

  return {
    async stop() {
      stopTimer();
      await activeCheck;
      return failure;
    },
  };
}

export async function waitForMaintenanceChild(
  child: ChildProcess,
  signalTarget: SignalTarget = process,
): Promise<number> {
  return new Promise((resolve, reject) => {
    let forwardedSignal: ForwardedSignal | undefined;
    const forward = (signal: ForwardedSignal) => {
      forwardedSignal ??= signal;
      child.kill(signal);
    };
    const signalHandlers = {
      SIGHUP: () => forward("SIGHUP"),
      SIGINT: () => forward("SIGINT"),
      SIGTERM: () => forward("SIGTERM"),
    } satisfies Record<ForwardedSignal, () => void>;
    for (const [signal, handler] of Object.entries(signalHandlers)) {
      signalTarget.on(signal as ForwardedSignal, handler);
    }
    const cleanup = () => {
      for (const [signal, handler] of Object.entries(signalHandlers)) {
        signalTarget.off(signal as ForwardedSignal, handler);
      }
    };

    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("close", (code, signal) => {
      cleanup();
      if (code !== null) {
        resolve(code);
        return;
      }
      const terminatingSignal = forwardedSignal ?? signal;
      resolve(
        terminatingSignal === "SIGHUP"
          ? 129
          : terminatingSignal === "SIGINT"
            ? 130
            : 143,
      );
    });
  });
}

async function main(): Promise<void> {
  const options = parseGovernanceMaintenanceCommand(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(governanceMaintenanceLockHelp);
    return;
  }
  if (process.env[governanceMaintenanceTokenEnvironmentVariable]) {
    throw new Error("Nested governance maintenance commands are not allowed");
  }

  const token = randomBytes(32).toString("hex");
  const tokenLockKey = deriveGovernanceMaintenanceTokenLockKey(token);
  const client = postgres(
    getDatabaseUrl(),
    governanceMaintenancePostgresOptions,
  );
  let globalLockHeld = false;
  let tokenLockHeld = false;

  try {
    const [locks] = await client<
      {
        backendPid: number;
        globalAcquired: boolean;
        tokenAcquired: boolean;
      }[]
    >`
      select pg_backend_pid() as "backendPid",
             pg_try_advisory_lock(${governanceMaintenanceLockKey}::bigint) as "globalAcquired",
             pg_try_advisory_lock(${tokenLockKey}::bigint) as "tokenAcquired"
    `;
    globalLockHeld = locks?.globalAcquired === true;
    tokenLockHeld = locks?.tokenAcquired === true;
    if (
      !Number.isInteger(locks?.backendPid) ||
      !globalLockHeld ||
      !tokenLockHeld
    ) {
      throw new Error("Governance maintenance locks are unavailable");
    }
    const backendPid = locks.backendPid;

    const child = spawn(options.command, options.commandArgs, {
      env: {
        ...process.env,
        [governanceMaintenanceTokenEnvironmentVariable]: token,
      },
      shell: false,
      stdio: "inherit",
    });
    const heartbeat = startGovernanceMaintenanceHeartbeat({
      child,
      expectedBackendPid: backendPid,
      probe: async () => {
        const [probe] = await client<GovernanceMaintenanceSessionProbe[]>`
          with held as materialized (
            select pg_backend_pid() as "backendPid",
                   exists (
                     select 1
                       from pg_locks
                      where locktype = 'advisory'
                        and pid = pg_backend_pid()
                        and granted
                        and objsubid = 1
                        and ((classid::bigint << 32) | objid::bigint) =
                          ${governanceMaintenanceLockKey}::bigint
                   ) as "globalHeld",
                   exists (
                     select 1
                       from pg_locks
                      where locktype = 'advisory'
                        and pid = pg_backend_pid()
                        and granted
                        and objsubid = 1
                        and ((classid::bigint << 32) | objid::bigint) =
                          ${tokenLockKey}::bigint
                   ) as "tokenHeld"
          ),
          checked as materialized (
            select "backendPid",
                   "globalHeld",
                   "tokenHeld",
                   pg_try_advisory_lock(${governanceMaintenanceLockKey}::bigint) as "globalReentered",
                   pg_try_advisory_lock(${tokenLockKey}::bigint) as "tokenReentered"
              from held
          )
          select "backendPid",
                 "globalHeld",
                 "globalReentered",
                 "tokenHeld",
                 "tokenReentered",
                 case when "globalReentered"
                   then pg_advisory_unlock(${governanceMaintenanceLockKey}::bigint)
                   else false
                 end as "globalBalanced",
                 case when "tokenReentered"
                   then pg_advisory_unlock(${tokenLockKey}::bigint)
                   else false
                 end as "tokenBalanced"
            from checked
        `;
        return probe;
      },
    });
    try {
      const childExitCode = await waitForMaintenanceChild(child);
      const heartbeatFailure = await heartbeat.stop();
      if (heartbeatFailure) {
        throw heartbeatFailure;
      }
      process.exitCode = childExitCode;
    } finally {
      await heartbeat.stop();
    }
  } finally {
    try {
      if (tokenLockHeld) {
        await client`select pg_advisory_unlock(${tokenLockKey}::bigint)`;
      }
      if (globalLockHeld) {
        await client`select pg_advisory_unlock(${governanceMaintenanceLockKey}::bigint)`;
      }
    } finally {
      // Closing the owning session is the final lock-release guarantee even if
      // an explicit unlock failed because the connection was interrupted.
      await client.end();
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    process.stderr.write(governanceMaintenanceFailureMessage);
    process.exitCode = 1;
  });
}
