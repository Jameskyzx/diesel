import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
  type BigIntStats,
} from "node:fs";
import { hostname } from "node:os";
import { dirname, isAbsolute, normalize, resolve } from "node:path";

import { z } from "zod";

import { runTrustedGit } from "./trusted-git";

export const PLAYWRIGHT_EVIDENCE_CAPTURE_LOCK_NAME =
  "diesel-playwright-evidence-capture-v1.lock" as const;
export const PLAYWRIGHT_EVIDENCE_CAPTURE_LOCK_VERSION =
  "playwright-evidence-capture-lock-v1" as const;
export const PLAYWRIGHT_EVIDENCE_CAPTURE_LOCK_OWNER_NAME =
  "owner.json" as const;

const LOCK_OWNER_MAX_BYTES = 4 * 1024;
const lockOwnerSchema = z.object({
  acquiredAt: z.iso.datetime({ offset: true }),
  hostname: z.string().min(1).max(255).regex(/^[^\u0000-\u001f\u007f]+$/u),
  pid: z.number().int().min(1).max(2_147_483_647),
  platform: z.string().min(1).max(32).regex(/^[a-z0-9_-]+$/u),
  token: z.string().uuid(),
  version: z.literal(PLAYWRIGHT_EVIDENCE_CAPTURE_LOCK_VERSION),
}).strict();

export type PlaywrightEvidenceCaptureLockOwner = z.infer<
  typeof lockOwnerSchema
>;
export type PlaywrightEvidenceCapturePidProbe = (
  pid: number,
) => "alive" | "denied" | "missing" | "unknown";

type LockObservation = Readonly<{
  directory: BigIntStats;
  owner: PlaywrightEvidenceCaptureLockOwner;
  ownerBytes: Buffer;
  ownerFile: BigIntStats;
}>;

export type PlaywrightEvidenceCaptureLock = Readonly<{
  assertOwned: () => void;
  owner: PlaywrightEvidenceCaptureLockOwner;
  ownerPath: string;
  path: string;
  release: () => void;
}>;

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : undefined;
}

function permissionMode(metadata: BigIntStats): number {
  return Number(metadata.mode & 0o777n);
}

function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameStableMetadata(left: BigIntStats, right: BigIntStats): boolean {
  return sameIdentity(left, right) &&
    left.mode === right.mode &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs &&
    left.nlink === right.nlink &&
    left.size === right.size;
}

function canonicalOwnerText(ownerInput: PlaywrightEvidenceCaptureLockOwner): string {
  const owner = lockOwnerSchema.parse(ownerInput);
  return `${JSON.stringify({
    acquiredAt: owner.acquiredAt,
    hostname: owner.hostname,
    pid: owner.pid,
    platform: owner.platform,
    token: owner.token,
    version: owner.version,
  }, null, 2)}\n`;
}

function parseOwner(bytes: Buffer): PlaywrightEvidenceCaptureLockOwner {
  if (bytes.byteLength <= 0 || bytes.byteLength > LOCK_OWNER_MAX_BYTES) {
    throw new Error(
      "Playwright evidence capture lock owner is empty or too large.",
    );
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
  } catch (cause: unknown) {
    throw new Error(
      "Playwright evidence capture lock owner is not valid UTF-8.",
      { cause },
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (cause: unknown) {
    throw new Error("Playwright evidence capture lock owner is not JSON.", {
      cause,
    });
  }
  const owner = lockOwnerSchema.parse(parsed);
  if (text !== canonicalOwnerText(owner)) {
    throw new Error(
      "Playwright evidence capture lock owner is not canonical JSON.",
    );
  }
  return owner;
}

function readBoundedDescriptor(fileDescriptor: number): Buffer {
  const allocation = Buffer.alloc(LOCK_OWNER_MAX_BYTES + 1);
  let offset = 0;
  while (offset < allocation.byteLength) {
    const bytesRead = readSync(
      fileDescriptor,
      allocation,
      offset,
      allocation.byteLength - offset,
      null,
    );
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  if (offset <= 0 || offset > LOCK_OWNER_MAX_BYTES) {
    throw new Error(
      "Playwright evidence capture lock owner is empty or too large.",
    );
  }
  return Buffer.from(allocation.subarray(0, offset));
}

function resolveGitMetadataDirectory(workspace: string): string {
  const output = runTrustedGit(workspace, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  let text: string;
  try {
    text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(output);
  } catch (cause: unknown) {
    throw new Error(
      "Playwright evidence capture Git metadata path is not valid UTF-8.",
      { cause },
    );
  }
  if (
    text.includes("\0") ||
    text.includes("\r") ||
    !text.endsWith("\n") ||
    text.slice(0, -1).includes("\n")
  ) {
    throw new Error(
      "Playwright evidence capture Git metadata path is malformed.",
    );
  }
  const configuredDirectory = text.slice(0, -1);
  if (
    !isAbsolute(configuredDirectory) ||
    normalize(configuredDirectory) !== configuredDirectory
  ) {
    throw new Error(
      "Playwright evidence capture Git metadata path is not canonical.",
    );
  }
  let physicalDirectory: string;
  let metadata: BigIntStats;
  try {
    physicalDirectory = realpathSync(configuredDirectory);
    metadata = lstatSync(configuredDirectory, { bigint: true });
  } catch (cause: unknown) {
    throw new Error(
      "Playwright evidence capture Git metadata directory is unavailable.",
      { cause },
    );
  }
  if (
    physicalDirectory !== configuredDirectory ||
    metadata.isSymbolicLink() ||
    !metadata.isDirectory()
  ) {
    throw new Error(
      "Playwright evidence capture Git metadata directory must be physical.",
    );
  }
  return physicalDirectory;
}

function readLockObservation(lockPath: string): LockObservation {
  const directoryBefore = lstatSync(lockPath, { bigint: true });
  if (
    directoryBefore.isSymbolicLink() ||
    !directoryBefore.isDirectory() ||
    permissionMode(directoryBefore) !== 0o700
  ) {
    throw new Error(
      "Playwright evidence capture lock must be a private physical directory.",
    );
  }
  const entries = readdirSync(lockPath);
  if (
    entries.length !== 1 ||
    entries[0] !== PLAYWRIGHT_EVIDENCE_CAPTURE_LOCK_OWNER_NAME
  ) {
    throw new Error(
      "Playwright evidence capture lock has unexpected contents.",
    );
  }
  const ownerPath = resolve(
    lockPath,
    PLAYWRIGHT_EVIDENCE_CAPTURE_LOCK_OWNER_NAME,
  );
  const pathBefore = lstatSync(ownerPath, { bigint: true });
  if (
    pathBefore.isSymbolicLink() ||
    !pathBefore.isFile() ||
    pathBefore.nlink !== 1n ||
    pathBefore.size <= 0n ||
    pathBefore.size > BigInt(LOCK_OWNER_MAX_BYTES) ||
    permissionMode(pathBefore) !== 0o600
  ) {
    throw new Error(
      "Playwright evidence capture lock owner must be a bounded private file.",
    );
  }
  const fileDescriptor = openSync(
    ownerPath,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  let readError: unknown;
  let readFailed = false;
  try {
    const descriptorBefore = fstatSync(fileDescriptor, { bigint: true });
    if (
      !descriptorBefore.isFile() ||
      !sameIdentity(pathBefore, descriptorBefore)
    ) {
      throw new Error(
        "Playwright evidence capture lock owner changed before read.",
      );
    }
    const ownerBytes = readBoundedDescriptor(fileDescriptor);
    const descriptorAfter = fstatSync(fileDescriptor, { bigint: true });
    const pathAfter = lstatSync(ownerPath, { bigint: true });
    const directoryAfter = lstatSync(lockPath, { bigint: true });
    if (
      !sameStableMetadata(descriptorBefore, descriptorAfter) ||
      !sameStableMetadata(descriptorAfter, pathAfter) ||
      !sameStableMetadata(directoryBefore, directoryAfter) ||
      BigInt(ownerBytes.byteLength) !== descriptorAfter.size
    ) {
      throw new Error(
        "Playwright evidence capture lock changed while it was read.",
      );
    }
    return {
      directory: directoryAfter,
      owner: parseOwner(ownerBytes),
      ownerBytes,
      ownerFile: descriptorAfter,
    };
  } catch (cause: unknown) {
    readError = cause;
    readFailed = true;
    throw cause;
  } finally {
    try {
      closeSync(fileDescriptor);
    } catch (closeCause: unknown) {
      if (readFailed) {
        throw new AggregateError(
          [readError, closeCause],
          "Playwright evidence capture lock read and cleanup both failed.",
        );
      }
      throw closeCause;
    }
  }
}

function assertSameObservation(
  lockPath: string,
  expected: LockObservation,
): void {
  const actual = readLockObservation(lockPath);
  if (
    !sameStableMetadata(actual.directory, expected.directory) ||
    !sameStableMetadata(actual.ownerFile, expected.ownerFile) ||
    !actual.ownerBytes.equals(expected.ownerBytes)
  ) {
    throw new Error(
      "Playwright evidence capture lock ownership changed.",
    );
  }
}

function defaultPidProbe(
  pid: number,
): ReturnType<PlaywrightEvidenceCapturePidProbe> {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (cause: unknown) {
    if (errorCode(cause) === "ESRCH") return "missing";
    if (errorCode(cause) === "EPERM") return "denied";
    return "unknown";
  }
}

function describeExistingLock(
  observation: LockObservation,
  probe: PlaywrightEvidenceCapturePidProbe,
): string {
  if (
    observation.owner.hostname !== hostname() ||
    observation.owner.platform !== process.platform
  ) {
    return "has an unverifiable owner from another host or platform";
  }
  const status = probe(observation.owner.pid);
  if (status === "alive") return "is already held by a live process";
  if (status === "missing") return "is stale";
  return `has an unverifiable owner (${status})`;
}

function writeOwner(path: string, bytes: Buffer): void {
  const fileDescriptor = openSync(
    path,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  let writeError: unknown;
  let writeFailed = false;
  try {
    writeFileSync(fileDescriptor, bytes);
    fchmodSync(fileDescriptor, 0o600);
    fsyncSync(fileDescriptor);
  } catch (cause: unknown) {
    writeError = cause;
    writeFailed = true;
    throw cause;
  } finally {
    try {
      closeSync(fileDescriptor);
    } catch (closeCause: unknown) {
      if (writeFailed) {
        throw new AggregateError(
          [writeError, closeCause],
          "Playwright evidence capture lock write and cleanup both failed.",
        );
      }
      throw closeCause;
    }
  }
}

export function acquirePlaywrightEvidenceCaptureLock(
  workspaceInput: string,
  options: Readonly<{
    pidProbe?: PlaywrightEvidenceCapturePidProbe;
  }> = {},
): PlaywrightEvidenceCaptureLock {
  const configuredWorkspace = resolve(workspaceInput);
  const workspace = realpathSync(configuredWorkspace);
  if (workspace !== configuredWorkspace) {
    throw new Error(
      "Playwright evidence capture workspace must not traverse a symlink.",
    );
  }
  const metadataDirectory = resolveGitMetadataDirectory(workspace);
  const lockPath = resolve(
    metadataDirectory,
    PLAYWRIGHT_EVIDENCE_CAPTURE_LOCK_NAME,
  );
  if (dirname(lockPath) !== metadataDirectory) {
    throw new Error("Playwright evidence capture lock escaped Git metadata.");
  }
  try {
    mkdirSync(lockPath, { mode: 0o700 });
  } catch (cause: unknown) {
    if (errorCode(cause) !== "EEXIST") throw cause;
    let detail = "is unverifiable";
    try {
      detail = describeExistingLock(
        readLockObservation(lockPath),
        options.pidProbe ?? defaultPidProbe,
      );
    } catch {
      // Existing invalid state is deliberately preserved for manual recovery.
    }
    throw new Error(
      `Playwright evidence capture lock ${detail} and requires explicit manual recovery: ${lockPath}`,
    );
  }

  chmodSync(lockPath, 0o700);
  const owner: PlaywrightEvidenceCaptureLockOwner = {
    acquiredAt: new Date().toISOString(),
    hostname: hostname(),
    pid: process.pid,
    platform: process.platform,
    token: randomUUID(),
    version: PLAYWRIGHT_EVIDENCE_CAPTURE_LOCK_VERSION,
  };
  const ownerPath = resolve(
    lockPath,
    PLAYWRIGHT_EVIDENCE_CAPTURE_LOCK_OWNER_NAME,
  );
  const ownerBytes = Buffer.from(canonicalOwnerText(owner), "utf8");
  try {
    writeOwner(ownerPath, ownerBytes);
    const acquired = readLockObservation(lockPath);
    if (!acquired.ownerBytes.equals(ownerBytes)) {
      throw new Error(
        "Playwright evidence capture lock owner changed during acquisition.",
      );
    }
    let released = false;
    return {
      assertOwned() {
        if (released) {
          throw new Error(
            "Playwright evidence capture lock was already released.",
          );
        }
        assertSameObservation(lockPath, acquired);
      },
      owner,
      ownerPath,
      path: lockPath,
      release() {
        if (released) {
          throw new Error(
            "Playwright evidence capture lock was already released.",
          );
        }
        assertSameObservation(lockPath, acquired);
        unlinkSync(ownerPath);
        rmdirSync(lockPath);
        released = true;
      },
    };
  } catch (cause: unknown) {
    // Never guess at cleanup after an ownership-verification failure. Leaving
    // the lock in Git metadata forces explicit operator inspection/recovery.
    throw new Error(
      `Playwright evidence capture lock setup failed; inspect and manually recover ${lockPath}.`,
      { cause },
    );
  }
}
