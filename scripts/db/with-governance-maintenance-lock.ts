import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import {
  closeSync,
  constants as fileConstants,
  fstatSync,
  openSync,
  readSync,
} from "node:fs";
import { pathToFileURL } from "node:url";
import { parseEnv, TextDecoder } from "node:util";

import postgres, { type Options } from "../../src/server/db/postgres";

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
} as const satisfies Options<Record<string, never>>;

export const governanceMaintenanceHeartbeatIntervalMs = 10_000;
export const governanceMaintenanceHeartbeatTimeoutMs = 30_000;
export const governanceMaintenanceCleanupTimeoutMs = 5_000;
export const governanceMaintenanceCleanupTimeoutSeconds = 5;
export const governanceMaintenanceProcessGroupPollIntervalMs = 100;
export const governanceMaintenanceProcessGroupTermGraceMs = 5_000;
export const governanceMaintenanceProcessGroupKillGraceMs = 5_000;
export const governanceMaintenanceEnvironmentFileMaxBytes = 1024 * 1024;
export const governanceMaintenanceReleaseLifecycleLockFd = 8;
export const governanceMaintenanceReleaseLifecycleLockFdEnvironmentVariable =
  "DIESEL_RELEASE_LIFECYCLE_LOCK_FD";

export type GovernanceMaintenanceChildStdio =
  | "inherit"
  | [
      "inherit",
      "inherit",
      "inherit",
      "ignore",
      "ignore",
      "ignore",
      "ignore",
      "ignore",
      "inherit",
    ];

/**
 * A release command may already hold the root-only lifecycle flock on fd 8.
 * Only the exact, fixed capability declaration inherits that descriptor into
 * the maintenance child; ordinary maintenance commands retain Node's existing
 * stdin/stdout/stderr-only inheritance behavior.
 */
export function resolveGovernanceMaintenanceChildStdio(
  environment: Readonly<Record<string, string | undefined>>,
): GovernanceMaintenanceChildStdio {
  if (
    environment[
      governanceMaintenanceReleaseLifecycleLockFdEnvironmentVariable
    ] !== String(governanceMaintenanceReleaseLifecycleLockFd)
  ) {
    return "inherit";
  }

  return [
    "inherit",
    "inherit",
    "inherit",
    "ignore",
    "ignore",
    "ignore",
    "ignore",
    "ignore",
    "inherit",
  ];
}

export type GovernanceMaintenanceSessionProbe = {
  backendPid: number;
  globalBalanced: boolean;
  globalHeld: boolean;
  globalReentered: boolean;
  tokenBalanced: boolean;
  tokenHeld: boolean;
  tokenReentered: boolean;
};

export type GovernanceMaintenanceUnlockResult = {
  globalReleased: boolean;
  tokenReleased: boolean;
};

export class GovernanceMaintenanceSessionError extends Error {
  constructor() {
    super("Governance maintenance database session was lost.");
    this.name = "GovernanceMaintenanceSessionError";
  }
}

export const governanceMaintenanceProcessGroupFailureMessage =
  "Governance maintenance process group did not terminate.";

export class GovernanceMaintenanceProcessGroupError extends Error {
  constructor() {
    super(governanceMaintenanceProcessGroupFailureMessage);
    this.name = "GovernanceMaintenanceProcessGroupError";
  }
}

export function governanceMaintenanceUnlockSucceeded(input: {
  globalLockHeld: boolean;
  result: GovernanceMaintenanceUnlockResult | undefined;
  tokenLockHeld: boolean;
}): boolean {
  return (
    input.result !== undefined &&
    (!input.globalLockHeld || input.result.globalReleased) &&
    (!input.tokenLockHeld || input.result.tokenReleased)
  );
}

async function waitForGovernanceMaintenanceOperation<T>(
  operation: PromiseLike<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
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
}

export async function cleanupGovernanceMaintenanceSession(input: {
  close: (timeoutSeconds: number) => Promise<void>;
  globalLockHeld: boolean;
  tokenLockHeld: boolean;
  unlock: (() => PromiseLike<GovernanceMaintenanceUnlockResult | undefined>) | null;
}): Promise<void> {
  let cleanupFailure: unknown;

  try {
    if ((input.globalLockHeld || input.tokenLockHeld) && input.unlock !== null) {
      const result = await waitForGovernanceMaintenanceOperation(
        input.unlock(),
        governanceMaintenanceCleanupTimeoutMs,
      );
      if (
        !governanceMaintenanceUnlockSucceeded({
          globalLockHeld: input.globalLockHeld,
          result,
          tokenLockHeld: input.tokenLockHeld,
        })
      ) {
        throw new GovernanceMaintenanceSessionError();
      }
    }
  } catch (error) {
    cleanupFailure = error;
  }

  try {
    await input.close(governanceMaintenanceCleanupTimeoutSeconds);
  } catch (error) {
    cleanupFailure ??= error;
  }

  if (cleanupFailure !== undefined) {
    throw cleanupFailure;
  }
}

export const governanceMaintenanceLockHelp = `Usage:
  tsx scripts/db/with-governance-maintenance-lock.ts \\
    --database-env-file=<root-owned-0600-path> -- <command> [args...]

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
):
  | { help: true }
  | {
      command: string;
      commandArgs: string[];
      databaseEnvironmentFile: string | undefined;
      help: false;
    } {
  if (args.length === 1 && ["--help", "-h"].includes(args[0] ?? "")) {
    return { help: true };
  }

  let separatorIndex = 0;
  let databaseEnvironmentFile: string | undefined;
  if (args[0]?.startsWith("--database-env-file=")) {
    databaseEnvironmentFile = args[0].slice(
      "--database-env-file=".length,
    );
    separatorIndex = 1;
    if (!databaseEnvironmentFile) {
      throw new Error("The database environment file path is required");
    }
  }
  if (args[separatorIndex] !== "--" || !args[separatorIndex + 1]) {
    throw new Error("A command is required after --");
  }
  if (args.some((value) => value.includes("\0"))) {
    throw new Error("Command arguments must not contain NUL bytes");
  }
  return {
    command: args[separatorIndex + 1],
    commandArgs: args.slice(separatorIndex + 2),
    databaseEnvironmentFile,
    help: false,
  };
}

export type GovernanceMaintenanceDatabaseEnvironment = {
  databaseUrl: string;
  knowledgeStorageRoot?: string;
};

export type GovernanceMaintenanceEnvironmentFileOptions = {
  expectedGid?: number;
  expectedMode?: number;
  expectedUid?: number;
};

function governanceMaintenanceEnvironmentFailure(): never {
  throw new Error("Governance maintenance environment could not be loaded");
}

/**
 * Reads a root-owned env file as inert data. This deliberately avoids Node's
 * --env-file startup handling: NODE_OPTIONS and similar values must never gain
 * execution semantics in a root governance process.
 */
export function loadGovernanceMaintenanceDatabaseEnvironment(
  path: string,
  options: GovernanceMaintenanceEnvironmentFileOptions = {},
): GovernanceMaintenanceDatabaseEnvironment {
  const expectedUid = options.expectedUid ?? 0;
  const expectedGid = options.expectedGid ?? 0;
  const expectedMode = options.expectedMode ?? 0o600;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(
      path,
      fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW,
    );
    const before = fstatSync(descriptor);
    if (
      !before.isFile() ||
      before.uid !== expectedUid ||
      before.gid !== expectedGid ||
      (before.mode & 0o777) !== expectedMode ||
      before.nlink !== 1 ||
      before.size < 0 ||
      before.size > governanceMaintenanceEnvironmentFileMaxBytes
    ) {
      governanceMaintenanceEnvironmentFailure();
    }

    const bytes = Buffer.alloc(
      governanceMaintenanceEnvironmentFileMaxBytes + 1,
    );
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(
        descriptor,
        bytes,
        length,
        bytes.length - length,
        null,
      );
      if (count === 0) break;
      length += count;
    }
    const after = fstatSync(descriptor);
    if (
      length > governanceMaintenanceEnvironmentFileMaxBytes ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      before.mode !== after.mode ||
      before.uid !== after.uid ||
      before.gid !== after.gid ||
      before.nlink !== after.nlink ||
      after.size !== length
    ) {
      governanceMaintenanceEnvironmentFailure();
    }

    const source = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(0, length),
    );
    const environment = parseEnv(source);
    const databaseUrl = getDatabaseUrl({
      DATABASE_URL: environment.DATABASE_URL,
    });
    const rawKnowledgeStorageRoot = environment.KNOWLEDGE_STORAGE_ROOT;
    let knowledgeStorageRoot: string | undefined;
    if (rawKnowledgeStorageRoot !== undefined) {
      knowledgeStorageRoot = rawKnowledgeStorageRoot.trim();
      if (
        !/^[A-Za-z0-9][A-Za-z0-9/_-]*$/.test(knowledgeStorageRoot) ||
        knowledgeStorageRoot.split("/").includes("..")
      ) {
        governanceMaintenanceEnvironmentFailure();
      }
    }
    return {
      databaseUrl,
      ...(knowledgeStorageRoot === undefined ? {} : { knowledgeStorageRoot }),
    };
  } catch {
    return governanceMaintenanceEnvironmentFailure();
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

const governanceMaintenanceChildEnvironmentKeys = [
  "HOME",
  "PATH",
  "release_id",
  governanceMaintenanceReleaseLifecycleLockFdEnvironmentVariable,
] as const;

/**
 * Only the database credential and the small execution contract required by
 * the trusted child cross the wrapper boundary. Service secrets and language,
 * loader, linker, or shell startup hooks are discarded.
 */
export function resolveGovernanceMaintenanceChildEnvironment(input: {
  databaseEnvironment: GovernanceMaintenanceDatabaseEnvironment;
  maintenanceToken: string;
  parentEnvironment: Readonly<Record<string, string | undefined>>;
}): NodeJS.ProcessEnv {
  const requestedNodeEnvironment = input.parentEnvironment.NODE_ENV;
  const nodeEnvironment =
    requestedNodeEnvironment === "production" ||
    requestedNodeEnvironment === "test"
      ? requestedNodeEnvironment
      : "development";
  const childEnvironment: NodeJS.ProcessEnv = {
    DATABASE_URL: input.databaseEnvironment.databaseUrl,
    DATABASE_MODE: input.parentEnvironment.DATABASE_MODE ?? "postgres",
    NODE_ENV: nodeEnvironment,
    [governanceMaintenanceTokenEnvironmentVariable]: input.maintenanceToken,
  };
  for (const key of governanceMaintenanceChildEnvironmentKeys) {
    const value = input.parentEnvironment[key];
    if (value !== undefined) childEnvironment[key] = value;
  }
  if (input.databaseEnvironment.knowledgeStorageRoot !== undefined) {
    childEnvironment.KNOWLEDGE_STORAGE_ROOT =
      input.databaseEnvironment.knowledgeStorageRoot;
  }
  return childEnvironment;
}

export type ForwardedSignal = "SIGHUP" | "SIGINT" | "SIGTERM";
type SignalTarget = {
  off(signal: ForwardedSignal, listener: () => void): unknown;
  on(signal: ForwardedSignal, listener: () => void): unknown;
};

type HeartbeatChild = Pick<ChildProcess, "kill"> &
  Partial<Pick<ChildProcess, "pid">>;

type GovernanceMaintenanceSignalOptions = {
  platform?: NodeJS.Platform;
  signalProcess?: (pid: number, signal: ForwardedSignal) => boolean;
};

type GovernanceMaintenanceProcessGroupSignal =
  | ForwardedSignal
  | "SIGKILL"
  | 0;

export type GovernanceMaintenanceProcessGroupOptions = {
  killGraceMs?: number;
  platform?: NodeJS.Platform;
  pollIntervalMs?: number;
  signalProcess?: (
    pid: number,
    signal: GovernanceMaintenanceProcessGroupSignal,
  ) => boolean;
  sleep?: (timeoutMs: number) => PromiseLike<void>;
  termGraceMs?: number;
  terminationSignal?: ForwardedSignal;
};

function errnoCode(error: unknown): string | undefined {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    typeof error.code !== "string"
  ) {
    return undefined;
  }
  return error.code;
}

function processGroupFailure(): never {
  throw new GovernanceMaintenanceProcessGroupError();
}

function validateBoundedDuration(value: number, allowZero: boolean): void {
  if (
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    (allowZero ? value < 0 : value <= 0)
  ) {
    processGroupFailure();
  }
}

function unixProcessGroupExists(
  processGroupId: number,
  signalProcess: GovernanceMaintenanceProcessGroupOptions["signalProcess"],
): boolean {
  if (signalProcess === undefined) processGroupFailure();
  try {
    if (signalProcess(-processGroupId, 0) !== true) processGroupFailure();
    return true;
  } catch (error) {
    if (error instanceof GovernanceMaintenanceProcessGroupError) throw error;
    if (errnoCode(error) === "ESRCH") return false;
    if (errnoCode(error) === "EPERM") return true;
    processGroupFailure();
  }
}

function signalUnixProcessGroup(
  processGroupId: number,
  signal: ForwardedSignal | "SIGKILL",
  signalProcess: GovernanceMaintenanceProcessGroupOptions["signalProcess"],
): boolean {
  if (signalProcess === undefined) processGroupFailure();
  try {
    if (signalProcess(-processGroupId, signal) !== true) {
      processGroupFailure();
    }
    return true;
  } catch (error) {
    if (error instanceof GovernanceMaintenanceProcessGroupError) throw error;
    if (errnoCode(error) === "ESRCH") return false;
    processGroupFailure();
  }
}

async function waitForUnixProcessGroupExit(input: {
  processGroupId: number;
  signalProcess: NonNullable<
    GovernanceMaintenanceProcessGroupOptions["signalProcess"]
  >;
  sleep: NonNullable<GovernanceMaintenanceProcessGroupOptions["sleep"]>;
  timeoutMs: number;
  pollIntervalMs: number;
}): Promise<boolean> {
  let remainingMs = input.timeoutMs;
  while (unixProcessGroupExists(input.processGroupId, input.signalProcess)) {
    if (remainingMs <= 0) return false;
    const delayMs = Math.min(input.pollIntervalMs, remainingMs);
    await input.sleep(delayMs);
    remainingMs -= delayMs;
  }
  return true;
}

/**
 * Proves that a detached Unix maintenance process group is empty before the
 * database lock may be released. A surviving descendant gets one bounded TERM
 * grace period, then a bounded KILL grace period. Windows and direct-child
 * callers retain the existing close-event fallback and do not call this helper.
 */
export async function ensureGovernanceMaintenanceProcessGroupTerminated(
  processGroupId: number,
  options: GovernanceMaintenanceProcessGroupOptions = {},
): Promise<void> {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") return;
  if (
    !Number.isInteger(processGroupId) ||
    processGroupId <= 1
  ) {
    processGroupFailure();
  }

  const pollIntervalMs =
    options.pollIntervalMs ?? governanceMaintenanceProcessGroupPollIntervalMs;
  const termGraceMs =
    options.termGraceMs ?? governanceMaintenanceProcessGroupTermGraceMs;
  const killGraceMs =
    options.killGraceMs ?? governanceMaintenanceProcessGroupKillGraceMs;
  const terminationSignal = options.terminationSignal ?? "SIGTERM";
  validateBoundedDuration(pollIntervalMs, false);
  validateBoundedDuration(termGraceMs, true);
  validateBoundedDuration(killGraceMs, true);

  const signalProcess = options.signalProcess ?? process.kill;
  const sleep =
    options.sleep ??
    ((timeoutMs: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, timeoutMs);
      }));
  if (!unixProcessGroupExists(processGroupId, signalProcess)) return;
  if (!signalUnixProcessGroup(processGroupId, terminationSignal, signalProcess)) {
    return;
  }
  if (
    await waitForUnixProcessGroupExit({
      pollIntervalMs,
      processGroupId,
      signalProcess,
      sleep,
      timeoutMs: termGraceMs,
    })
  ) {
    return;
  }
  if (!signalUnixProcessGroup(processGroupId, "SIGKILL", signalProcess)) {
    return;
  }
  if (
    await waitForUnixProcessGroupExit({
      pollIntervalMs,
      processGroupId,
      signalProcess,
      sleep,
      timeoutMs: killGraceMs,
    })
  ) {
    return;
  }
  processGroupFailure();
}

/**
 * Production maintenance commands run in their own Unix process group. A
 * heartbeat or wrapper signal must therefore terminate the whole group: only
 * signalling the direct Bash child can leave a database-writing grandchild
 * alive after the advisory-lock session has been lost.
 */
export function signalGovernanceMaintenanceChild(
  child: HeartbeatChild,
  signal: ForwardedSignal,
  options: GovernanceMaintenanceSignalOptions = {},
): void {
  const platform = options.platform ?? process.platform;
  const signalProcess = options.signalProcess ?? process.kill;
  const childPid = child.pid;

  if (
    platform !== "win32" &&
    typeof childPid === "number" &&
    Number.isInteger(childPid) &&
    childPid > 1
  ) {
    try {
      signalProcess(-childPid, signal);
      return;
    } catch {
      // A concurrent group exit can race the signal. Fall back to the direct
      // child so platforms or test doubles without a live group fail closed.
    }
  }

  child.kill(signal);
}

export type GovernanceMaintenanceChildTerminationController = {
  hasDedicatedProcessGroup: boolean;
  onFailure: (
    listener: (error: GovernanceMaintenanceProcessGroupError) => void,
  ) => () => void;
  proveTerminated: () => Promise<void>;
  terminate: (signal: ForwardedSignal) => Promise<void>;
};

/**
 * Creates one termination promise for every path that can end a maintenance
 * child. Sharing the promise prevents signal, heartbeat, error, and close
 * races from launching competing TERM/KILL sequences against the same PGID.
 */
export function createGovernanceMaintenanceChildTerminationController(
  child: HeartbeatChild,
  processGroupOptions: GovernanceMaintenanceProcessGroupOptions = {},
): GovernanceMaintenanceChildTerminationController {
  const platform = processGroupOptions.platform ?? process.platform;
  const childPid = child.pid;
  const processGroupId =
    platform !== "win32" &&
    typeof childPid === "number" &&
    Number.isInteger(childPid) &&
    childPid > 1
      ? childPid
      : undefined;
  let terminationPromise: Promise<void> | undefined;
  let terminationFailure: GovernanceMaintenanceProcessGroupError | undefined;
  const failureListeners = new Set<
    (error: GovernanceMaintenanceProcessGroupError) => void
  >();

  const normalizeFailure = (
    error: unknown,
  ): GovernanceMaintenanceProcessGroupError =>
    error instanceof GovernanceMaintenanceProcessGroupError
      ? error
      : new GovernanceMaintenanceProcessGroupError();

  const begin = (signal: ForwardedSignal | undefined): Promise<void> => {
    terminationPromise ??= (async () => {
      if (processGroupId !== undefined) {
        await ensureGovernanceMaintenanceProcessGroupTerminated(
          processGroupId,
          {
            ...processGroupOptions,
            platform,
            ...(signal === undefined ? {} : { terminationSignal: signal }),
          },
        );
        return;
      }
      if (signal === undefined) return;
      try {
        if (
          processGroupOptions.platform === undefined &&
          processGroupOptions.signalProcess === undefined
        ) {
          signalGovernanceMaintenanceChild(child, signal);
        } else {
          signalGovernanceMaintenanceChild(child, signal, {
            platform,
            signalProcess: processGroupOptions.signalProcess,
          });
        }
      } catch (error) {
        throw normalizeFailure(error);
      }
    })();
    void terminationPromise.catch((error: unknown) => {
      terminationFailure ??= normalizeFailure(error);
      for (const listener of failureListeners) listener(terminationFailure);
    });
    return terminationPromise;
  };

  return {
    hasDedicatedProcessGroup: processGroupId !== undefined,
    onFailure(listener) {
      failureListeners.add(listener);
      if (terminationFailure !== undefined) {
        queueMicrotask(() => listener(terminationFailure!));
      }
      return () => failureListeners.delete(listener);
    },
    proveTerminated: () => begin(undefined),
    terminate: (signal) => begin(signal),
  };
}

export function startGovernanceMaintenanceHeartbeat(input: {
  child: HeartbeatChild;
  expectedBackendPid: number;
  intervalMs?: number;
  probe: () => PromiseLike<GovernanceMaintenanceSessionProbe | undefined>;
  terminate?: () => PromiseLike<void>;
  timeoutMs?: number;
}): {
  cancel: () => void;
  stop: () => Promise<GovernanceMaintenanceSessionError | null>;
} {
  const intervalMs =
    input.intervalMs ?? governanceMaintenanceHeartbeatIntervalMs;
  const timeoutMs =
    input.timeoutMs ?? governanceMaintenanceHeartbeatTimeoutMs;
  let activeCheck: Promise<void> | undefined;
  let failure: GovernanceMaintenanceSessionError | null = null;
  let monitoring = true;
  let stopPromise: Promise<GovernanceMaintenanceSessionError | null> | undefined;
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
      if (input.terminate === undefined) {
        signalGovernanceMaintenanceChild(input.child, "SIGTERM");
      } else {
        void Promise.resolve(input.terminate()).catch(() => undefined);
      }
    } catch {
      // The child may have exited between the failed probe and termination.
    }
  };
  const probeBeforeDeadline = () =>
    waitForGovernanceMaintenanceOperation(input.probe(), timeoutMs);
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
    cancel() {
      stopTimer();
    },
    stop() {
      stopPromise ??= (async () => {
        const inFlightCheck = activeCheck;
        stopTimer();
        if (inFlightCheck !== undefined) {
          await inFlightCheck;
        }
        if (failure === null) {
          await check();
        }
        return failure;
      })();
      return stopPromise;
    },
  };
}

export async function waitForMaintenanceChild(
  child: ChildProcess,
  signalTarget: SignalTarget = process,
  processGroupOptions: GovernanceMaintenanceProcessGroupOptions = {},
  terminationController?: GovernanceMaintenanceChildTerminationController,
): Promise<number> {
  return new Promise((resolve, reject) => {
    let forwardedSignal: ForwardedSignal | undefined;
    let settled = false;
    let childError: Error | undefined;
    let closeResult:
      | { code: number | null; signal: NodeJS.Signals | null }
      | undefined;
    const controller =
      terminationController ??
      createGovernanceMaintenanceChildTerminationController(
        child,
        processGroupOptions,
      );
    let unsubscribeFailure: () => void = () => undefined;
    const finishRejected = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const finishFromClose = () => {
      if (settled || closeResult === undefined) return;
      if (childError !== undefined) {
        finishRejected(childError);
        return;
      }
      const { code, signal } = closeResult;
      const terminatingSignal = forwardedSignal ?? signal;
      if (forwardedSignal === undefined && code !== null) {
        settled = true;
        cleanup();
        resolve(code);
        return;
      }
      const exitCode =
        terminatingSignal === "SIGHUP"
          ? 129
          : terminatingSignal === "SIGINT"
            ? 130
            : terminatingSignal === "SIGKILL"
              ? 137
              : 143;
      settled = true;
      cleanup();
      resolve(exitCode);
    };
    const proveGroupAndFinish = () => {
      void controller.proveTerminated().then(
        finishFromClose,
        finishRejected,
      );
    };
    const forward = (signal: ForwardedSignal) => {
      forwardedSignal ??= signal;
      void controller.terminate(signal).catch(() => undefined);
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
      unsubscribeFailure();
      for (const [signal, handler] of Object.entries(signalHandlers)) {
        signalTarget.off(signal as ForwardedSignal, handler);
      }
    };
    unsubscribeFailure = controller.onFailure(finishRejected);

    child.once("error", (error) => {
      if (settled) return;
      childError = error;
      if (!controller.hasDedicatedProcessGroup) {
        finishRejected(error);
        return;
      }
      void controller.terminate("SIGTERM").then(
        () => {
          if (closeResult !== undefined) finishFromClose();
        },
        finishRejected,
      );
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      closeResult = { code, signal };
      proveGroupAndFinish();
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

  const databaseEnvironment = options.databaseEnvironmentFile
    ? loadGovernanceMaintenanceDatabaseEnvironment(
        options.databaseEnvironmentFile,
      )
    : { databaseUrl: getDatabaseUrl() };
  const token = randomBytes(32).toString("hex");
  const tokenLockKey = deriveGovernanceMaintenanceTokenLockKey(token);
  const client = postgres(
    databaseEnvironment.databaseUrl,
    governanceMaintenancePostgresOptions,
  );
  let globalLockHeld = false;
  let tokenLockHeld = false;
  let explicitUnlockAllowed = true;

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

    const childEnvironment = resolveGovernanceMaintenanceChildEnvironment({
      databaseEnvironment,
      maintenanceToken: token,
      parentEnvironment: process.env,
    });
    const child = spawn(options.command, options.commandArgs, {
      detached: process.platform !== "win32",
      env: childEnvironment,
      shell: false,
      stdio: resolveGovernanceMaintenanceChildStdio(childEnvironment),
    });
    const terminationController =
      createGovernanceMaintenanceChildTerminationController(child);
    const heartbeat = startGovernanceMaintenanceHeartbeat({
      child,
      expectedBackendPid: backendPid,
      probe: () =>
        client<GovernanceMaintenanceSessionProbe[]>`
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
        `.then(([probe]) => probe),
      terminate: () => terminationController.terminate("SIGTERM"),
    });
    let processGroupTerminationFailed = false;
    try {
      let childExitCode: number;
      try {
        childExitCode = await waitForMaintenanceChild(
          child,
          process,
          {},
          terminationController,
        );
      } catch (error) {
        if (error instanceof GovernanceMaintenanceProcessGroupError) {
          processGroupTerminationFailed = true;
          explicitUnlockAllowed = false;
          heartbeat.cancel();
        }
        throw error;
      }
      const heartbeatFailure = await heartbeat.stop();
      if (heartbeatFailure) {
        explicitUnlockAllowed = false;
        throw heartbeatFailure;
      }
      process.exitCode = childExitCode;
    } finally {
      if (processGroupTerminationFailed) {
        heartbeat.cancel();
      } else {
        const heartbeatFailure = await heartbeat.stop();
        if (heartbeatFailure) {
          explicitUnlockAllowed = false;
        }
      }
    }
  } finally {
    await cleanupGovernanceMaintenanceSession({
      close: (timeout) => client.end({ timeout }),
      globalLockHeld,
      tokenLockHeld,
      unlock:
        explicitUnlockAllowed && (tokenLockHeld || globalLockHeld)
          ? async () => {
              const [unlockResult] = await client<
                GovernanceMaintenanceUnlockResult[]
              >`
                select case when ${tokenLockHeld}::boolean
                         then pg_advisory_unlock(${tokenLockKey}::bigint)
                         else true
                       end as "tokenReleased",
                       case when ${globalLockHeld}::boolean
                         then pg_advisory_unlock(${governanceMaintenanceLockKey}::bigint)
                         else true
                       end as "globalReleased"
              `;
              return unlockResult;
            }
          : null,
    });
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
