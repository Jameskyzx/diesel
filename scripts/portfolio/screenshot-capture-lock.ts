import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rmdir,
  unlink,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { hostname } from "node:os";
import { resolve, sep } from "node:path";

import { z } from "zod";

export const screenshotCaptureLockDirectoryName =
  ".screenshot-capture.lock" as const;
export const screenshotCaptureLockOwnerName = "owner.json" as const;
export const screenshotCaptureLockVersion =
  "screenshot-capture-lock-v1" as const;
export const screenshotCaptureStagingPrefix =
  ".screenshot-capture-staging-" as const;

const maximumLockOwnerBytes = 4 * 1024;
const lockOwnerSchema = z
  .object({
    acquiredAt: z.string().datetime({ offset: false }),
    hostname: z.string().min(1).max(255),
    pid: z.number().int().min(1).max(2_147_483_647),
    platform: z.string().min(1).max(32),
    token: z.string().uuid(),
    version: z.literal(screenshotCaptureLockVersion),
  })
  .strict();

export type ScreenshotCaptureLockOwner = z.infer<typeof lockOwnerSchema>;
export type ScreenshotCapturePidProbe = (
  pid: number,
) => "alive" | "denied" | "missing" | "unknown";

type LockObservation = Readonly<{
  directoryDev: bigint;
  directoryIno: bigint;
  owner: ScreenshotCaptureLockOwner;
  ownerBytes: Buffer;
  ownerDev: bigint;
  ownerIno: bigint;
}>;

export type ScreenshotCaptureLock = Readonly<{
  assertOwned: () => Promise<void>;
  owner: ScreenshotCaptureLockOwner;
  path: string;
  release: () => Promise<void>;
}>;

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : undefined;
}

function sameIdentity(
  left: { dev: bigint; ino: bigint },
  right: { dev: bigint; ino: bigint },
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function isWithin(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function canonicalOwnerText(owner: ScreenshotCaptureLockOwner): string {
  return `${JSON.stringify(owner, null, 2)}\n`;
}

export function serializeScreenshotCaptureLockOwner(
  owner: ScreenshotCaptureLockOwner,
): string {
  return canonicalOwnerText(lockOwnerSchema.parse(owner));
}

function parseScreenshotCaptureLockOwner(
  bytes: Buffer,
): ScreenshotCaptureLockOwner {
  if (bytes.byteLength <= 0 || bytes.byteLength > maximumLockOwnerBytes) {
    throw new Error("Screenshot capture lock owner is empty or too large.");
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const owner = lockOwnerSchema.parse(JSON.parse(text) as unknown);
  if (canonicalOwnerText(owner) !== text) {
    throw new Error("Screenshot capture lock owner is not canonical JSON.");
  }
  return owner;
}

async function closeHandle(
  handle: FileHandle,
  operationError?: unknown,
): Promise<void> {
  try {
    await handle.close();
  } catch (closeError: unknown) {
    if (operationError !== undefined) {
      throw new AggregateError(
        [operationError, closeError],
        "Screenshot capture lock read and descriptor cleanup both failed.",
      );
    }
    throw closeError;
  }
}

async function readLockObservation(lockPath: string): Promise<LockObservation> {
  const directoryBefore = await lstat(lockPath, { bigint: true });
  if (
    directoryBefore.isSymbolicLink() ||
    !directoryBefore.isDirectory() ||
    (directoryBefore.mode & 0o777n) !== 0o700n
  ) {
    throw new Error(
      "Screenshot capture lock must be a private regular directory.",
    );
  }
  const entries = await readdir(lockPath);
  if (
    entries.length !== 1 ||
    entries[0] !== screenshotCaptureLockOwnerName
  ) {
    throw new Error("Screenshot capture lock has unexpected contents.");
  }

  const ownerPath = resolve(lockPath, screenshotCaptureLockOwnerName);
  const pathBefore = await lstat(ownerPath, { bigint: true });
  if (
    pathBefore.isSymbolicLink() ||
    !pathBefore.isFile() ||
    pathBefore.nlink !== 1n ||
    pathBefore.size <= 0n ||
    pathBefore.size > BigInt(maximumLockOwnerBytes) ||
    (pathBefore.mode & 0o777n) !== 0o600n
  ) {
    throw new Error("Screenshot capture lock owner is not a private file.");
  }

  const handle = await open(
    ownerPath,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  let operationError: unknown;
  try {
    const descriptorBefore = await handle.stat({ bigint: true });
    if (
      !descriptorBefore.isFile() ||
      !sameIdentity(pathBefore, descriptorBefore)
    ) {
      throw new Error("Screenshot capture lock owner changed before read.");
    }
    const ownerBytes = await handle.readFile();
    const descriptorAfter = await handle.stat({ bigint: true });
    const [pathAfter, directoryAfter] = await Promise.all([
      lstat(ownerPath, { bigint: true }),
      lstat(lockPath, { bigint: true }),
    ]);
    if (
      !sameIdentity(descriptorBefore, descriptorAfter) ||
      descriptorBefore.mode !== descriptorAfter.mode ||
      descriptorBefore.mtimeNs !== descriptorAfter.mtimeNs ||
      descriptorBefore.ctimeNs !== descriptorAfter.ctimeNs ||
      descriptorBefore.size !== descriptorAfter.size ||
      BigInt(ownerBytes.byteLength) !== descriptorAfter.size ||
      !sameIdentity(descriptorAfter, pathAfter) ||
      descriptorAfter.mode !== pathAfter.mode ||
      descriptorAfter.mtimeNs !== pathAfter.mtimeNs ||
      descriptorAfter.ctimeNs !== pathAfter.ctimeNs ||
      descriptorAfter.size !== pathAfter.size ||
      !sameIdentity(directoryBefore, directoryAfter) ||
      directoryBefore.mode !== directoryAfter.mode ||
      directoryBefore.mtimeNs !== directoryAfter.mtimeNs ||
      directoryBefore.ctimeNs !== directoryAfter.ctimeNs
    ) {
      throw new Error("Screenshot capture lock changed while it was read.");
    }
    return {
      directoryDev: directoryAfter.dev,
      directoryIno: directoryAfter.ino,
      owner: parseScreenshotCaptureLockOwner(ownerBytes),
      ownerBytes,
      ownerDev: descriptorAfter.dev,
      ownerIno: descriptorAfter.ino,
    };
  } catch (cause: unknown) {
    operationError = cause;
    throw cause;
  } finally {
    await closeHandle(handle, operationError);
  }
}

function probePid(pid: number): ReturnType<ScreenshotCapturePidProbe> {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (cause: unknown) {
    if (errorCode(cause) === "ESRCH") return "missing";
    if (errorCode(cause) === "EPERM") return "denied";
    return "unknown";
  }
}

function lockPath(workspaceRealPath: string): string {
  return resolve(workspaceRealPath, screenshotCaptureLockDirectoryName);
}

async function assertSameOwner(
  path: string,
  expected: LockObservation,
): Promise<LockObservation> {
  const actual = await readLockObservation(path);
  if (
    actual.directoryDev !== expected.directoryDev ||
    actual.directoryIno !== expected.directoryIno ||
    actual.ownerDev !== expected.ownerDev ||
    actual.ownerIno !== expected.ownerIno ||
    !actual.ownerBytes.equals(expected.ownerBytes)
  ) {
    throw new Error("Screenshot capture lock ownership changed.");
  }
  return actual;
}

function describeExistingLock(
  observation: LockObservation,
  pidProbe: ScreenshotCapturePidProbe,
): string {
  if (
    observation.owner.hostname !== hostname() ||
    observation.owner.platform !== process.platform
  ) {
    return "has an unverifiable owner from another host or platform";
  }
  const status = pidProbe(observation.owner.pid);
  if (status === "alive") return "is held by a live process";
  if (status === "missing") {
    return "is stale and requires explicit --recover-stale-lock recovery";
  }
  return `has an unverifiable owner (${status})`;
}

export async function acquireScreenshotCaptureLock(
  workspace: string,
  options: { pidProbe?: ScreenshotCapturePidProbe } = {},
): Promise<ScreenshotCaptureLock> {
  const workspaceRealPath = await realpath(workspace);
  const path = lockPath(workspaceRealPath);
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (cause: unknown) {
    if (errorCode(cause) !== "EEXIST") throw cause;
    let detail = "exists but cannot be safely inspected";
    try {
      detail = describeExistingLock(
        await readLockObservation(path),
        options.pidProbe ?? probePid,
      );
    } catch {
      // Preserve an invalid lock for explicit operator inspection.
    }
    throw new Error(`Screenshot capture lock ${detail}: ${path}`);
  }

  const owner: ScreenshotCaptureLockOwner = {
    acquiredAt: new Date().toISOString(),
    hostname: hostname(),
    pid: process.pid,
    platform: process.platform,
    token: randomUUID(),
    version: screenshotCaptureLockVersion,
  };
  const ownerPath = resolve(path, screenshotCaptureLockOwnerName);
  try {
    await chmod(path, 0o700);
    await writeFile(ownerPath, serializeScreenshotCaptureLockOwner(owner), {
      flag: "wx",
      mode: 0o600,
    });
    await chmod(ownerPath, 0o600);
  } catch (cause: unknown) {
    try {
      await unlink(ownerPath).catch((cleanupCause: unknown) => {
        if (errorCode(cleanupCause) !== "ENOENT") throw cleanupCause;
      });
      await rmdir(path);
    } catch (cleanupCause: unknown) {
      throw new AggregateError(
        [cause, cleanupCause],
        "Screenshot capture lock setup and cleanup both failed.",
      );
    }
    throw cause;
  }

  const acquired = await readLockObservation(path);
  return {
    assertOwned: async () => {
      await assertSameOwner(path, acquired);
    },
    owner,
    path,
    release: async () => {
      await assertSameOwner(path, acquired);
      await unlink(ownerPath);
      await rmdir(path);
    },
  };
}

async function unresolvedStagingPaths(workspaceRealPath: string): Promise<string[]> {
  const publicPath = resolve(workspaceRealPath, "public");
  let publicMetadata;
  try {
    publicMetadata = await lstat(publicPath);
  } catch (cause: unknown) {
    if (errorCode(cause) === "ENOENT") {
      throw new Error(
        "Screenshot public path is missing; staging absence cannot be proven.",
        { cause },
      );
    }
    throw cause;
  }
  if (publicMetadata.isSymbolicLink() || !publicMetadata.isDirectory()) {
    throw new Error("Screenshot public path is not a regular directory.");
  }
  const publicRealPath = await realpath(publicPath);
  if (!isWithin(workspaceRealPath, publicRealPath)) {
    throw new Error("Screenshot public path escapes the workspace.");
  }

  const portfolioPath = resolve(publicRealPath, "portfolio");
  let portfolioMetadata;
  try {
    portfolioMetadata = await lstat(portfolioPath);
  } catch (cause: unknown) {
    if (errorCode(cause) === "ENOENT") {
      throw new Error(
        "Screenshot portfolio path is missing; staging absence cannot be proven.",
        { cause },
      );
    }
    throw cause;
  }
  if (
    portfolioMetadata.isSymbolicLink() ||
    !portfolioMetadata.isDirectory()
  ) {
    throw new Error("Screenshot portfolio path is not a regular directory.");
  }
  const portfolioRealPath = await realpath(portfolioPath);
  if (!isWithin(publicRealPath, portfolioRealPath)) {
    throw new Error("Screenshot portfolio path escapes the public directory.");
  }
  return (await readdir(portfolioRealPath))
    .filter((entry) => entry.startsWith(screenshotCaptureStagingPrefix))
    .map((entry) => resolve(portfolioRealPath, entry));
}

export async function recoverStaleScreenshotCaptureLock(
  workspace: string,
  options: { pidProbe?: ScreenshotCapturePidProbe } = {},
): Promise<void> {
  const workspaceRealPath = await realpath(workspace);
  const path = lockPath(workspaceRealPath);
  const observed = await readLockObservation(path);
  if (
    observed.owner.hostname !== hostname() ||
    observed.owner.platform !== process.platform
  ) {
    throw new Error("Screenshot capture lock owner cannot be verified here.");
  }
  const pidProbe = options.pidProbe ?? probePid;
  if (pidProbe(observed.owner.pid) !== "missing") {
    throw new Error("Screenshot capture lock owner is not proven stale.");
  }
  const stagingPaths = await unresolvedStagingPaths(workspaceRealPath);
  if (stagingPaths.length > 0) {
    throw new Error(
      "Screenshot capture lock recovery requires manual staging inspection: " +
        stagingPaths.join(", "),
    );
  }
  const finalObservation = await assertSameOwner(path, observed);
  if (pidProbe(finalObservation.owner.pid) !== "missing") {
    throw new Error("Screenshot capture lock owner changed during recovery.");
  }
  await unlink(resolve(path, screenshotCaptureLockOwnerName));
  await rmdir(path);
}
