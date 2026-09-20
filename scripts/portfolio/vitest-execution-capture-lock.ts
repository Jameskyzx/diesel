import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
  type BigIntStats,
} from "node:fs";
import { hostname } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  normalize,
  resolve,
} from "node:path";

import { z } from "zod";

import { runTrustedGit } from "./trusted-git";

export const VITEST_EXECUTION_CAPTURE_LOCK_NAME =
  "diesel-vitest-execution-capture-v1.lock" as const;
export const VITEST_EXECUTION_CAPTURE_LOCK_VERSION =
  "vitest-execution-capture-lock-v2" as const;
export const VITEST_EXECUTION_CAPTURE_RECOVERY_CLAIM_NAME =
  `${VITEST_EXECUTION_CAPTURE_LOCK_NAME}.recovery` as const;
const LOCK_OWNER_MAX_BYTES = 4 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CANONICAL_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

const lockOwnerSchema = z
  .object({
    version: z.literal(VITEST_EXECUTION_CAPTURE_LOCK_VERSION),
    token: z.string().regex(UUID_PATTERN),
    pid: z.number().int().min(1).max(2_147_483_647),
    platform: z.string().min(1).max(32).regex(/^[a-z0-9_-]+$/u),
    hostname: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[^\u0000-\u001f\u007f]+$/u),
    acquiredAt: z
      .string()
      .regex(CANONICAL_TIMESTAMP_PATTERN)
      .refine((value) => {
        const parsed = new Date(value);
        return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
      }),
  })
  .strict();

export type VitestExecutionCaptureLockOwner = z.infer<
  typeof lockOwnerSchema
>;

type LockFileObservation = Readonly<{
  bytes: Buffer;
  dev: bigint;
  ino: bigint;
  mode: number;
  mtimeNs: bigint;
  nlink: bigint;
  path: string;
  size: bigint;
}>;

export type VitestExecutionCaptureLockProbe = (
  pid: number,
) => "alive" | "denied" | "missing" | "unknown";

type VitestExecutionCaptureLockProbeResult =
  | Readonly<{ reason: "pid_alive"; status: "active" }>
  | Readonly<{ reason: "pid_missing"; status: "stale" }>
  | Readonly<{
      reason:
        | "foreign_host"
        | "foreign_platform"
        | "pid_probe_denied"
        | "pid_probe_unknown";
      status: "unverifiable";
    }>;

export type VitestExecutionCaptureLockInspection =
  | Readonly<{ path: string; status: "absent" }>
  | Readonly<{
      path: string;
      reason:
        | "invalid_lock_file"
        | "legacy_directory_unverifiable"
        | "non_regular_lock_path";
      status: "unverifiable";
    }>
  | Readonly<{
      candidatePaths: readonly string[];
      path: string;
      reason: "orphan_publication_candidate";
      status: "unverifiable";
    }>
  | Readonly<{
      path: string;
      reason: "recovery_claim_present";
      recoveryClaimPath: string;
      status: "unverifiable";
    }>
  | Readonly<{
      owner: VitestExecutionCaptureLockOwner;
      path: string;
      publicationCandidatePath: string | null;
      quarantinePresent: boolean;
      quarantinePath: string;
      reason:
        | "foreign_host"
        | "foreign_platform"
        | "pid_probe_denied"
        | "pid_probe_unknown";
      status: "unverifiable";
    }>
  | Readonly<{
      owner: VitestExecutionCaptureLockOwner;
      path: string;
      publicationCandidatePath: string | null;
      quarantinePresent: boolean;
      quarantinePath: string;
      reason: "pid_alive";
      status: "active";
    }>
  | Readonly<{
      owner: VitestExecutionCaptureLockOwner;
      path: string;
      publicationCandidatePath: string | null;
      quarantinePresent: boolean;
      quarantinePath: string;
      reason: "pid_missing";
      status: "stale";
    }>;

type InternalLockInspection =
  | VitestExecutionCaptureLockInspection
  | Readonly<{
      observation: LockFileObservation;
      owner: VitestExecutionCaptureLockOwner;
      path: string;
      publicationCandidatePath: string | null;
      quarantinePresent: boolean;
      quarantinePath: string;
      reason: "pid_missing";
      status: "stale_internal";
    }>;

export type VitestExecutionCaptureLock = Readonly<{
  assertOwned: () => void;
  guardPath: string;
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

function sameObservation(
  left: LockFileObservation,
  right: LockFileObservation,
): boolean {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.mtimeNs === right.mtimeNs &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.bytes.equals(right.bytes);
}

function sameIdentityAndBytes(
  left: LockFileObservation,
  right: LockFileObservation,
): boolean {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.bytes.equals(right.bytes);
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
    throw new Error("Vitest execution capture lock owner is empty or too large.");
  }
  return Buffer.from(allocation.subarray(0, offset));
}

function readStableLockFile(
  path: string,
  allowedLinkCounts: readonly bigint[] = [1n],
): LockFileObservation {
  const pathBefore = lstatSync(path, { bigint: true });
  if (
    pathBefore.isSymbolicLink() ||
    !pathBefore.isFile() ||
    !allowedLinkCounts.includes(pathBefore.nlink)
  ) {
    throw new Error(
      "Vitest execution capture lock must be a regular non-symlink file with an expected link count.",
    );
  }
  const fileDescriptor = openSync(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  let readError: unknown;
  let readFailed = false;
  try {
    const before = fstatSync(fileDescriptor, { bigint: true });
    if (
      !before.isFile() ||
      before.dev !== pathBefore.dev ||
      before.ino !== pathBefore.ino ||
      !allowedLinkCounts.includes(before.nlink) ||
      before.size <= 0n ||
      before.size > BigInt(LOCK_OWNER_MAX_BYTES)
    ) {
      throw new Error("Vitest execution capture lock changed before read.");
    }
    const bytes = readBoundedDescriptor(fileDescriptor);
    const after = fstatSync(fileDescriptor, { bigint: true });
    const pathAfter = lstatSync(path, { bigint: true });
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.mode !== after.mode ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      before.nlink !== after.nlink ||
      before.size !== after.size ||
      after.dev !== pathAfter.dev ||
      after.ino !== pathAfter.ino ||
      after.mode !== pathAfter.mode ||
      after.mtimeNs !== pathAfter.mtimeNs ||
      after.ctimeNs !== pathAfter.ctimeNs ||
      after.nlink !== pathAfter.nlink ||
      after.size !== pathAfter.size ||
      BigInt(bytes.byteLength) !== after.size
    ) {
      throw new Error("Vitest execution capture lock changed while read.");
    }
    return {
      bytes,
      dev: after.dev,
      ino: after.ino,
      mode: permissionMode(after),
      mtimeNs: after.mtimeNs,
      nlink: after.nlink,
      path,
      size: after.size,
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
          "Vitest capture-lock read and descriptor cleanup both failed.",
        );
      }
      throw closeCause;
    }
  }
}

function readOptionalLinkedLockFile(
  path: string,
  allowedLinkCounts: readonly bigint[],
): LockFileObservation | null {
  try {
    return readStableLockFile(path, allowedLinkCounts);
  } catch (cause: unknown) {
    if (errorCode(cause) === "ENOENT") return null;
    throw cause;
  }
}

function syncDirectory(path: string): void {
  const fileDescriptor = openSync(path, constants.O_RDONLY);
  let syncError: unknown;
  let syncFailed = false;
  try {
    fsyncSync(fileDescriptor);
  } catch (cause: unknown) {
    syncError = cause;
    syncFailed = true;
    throw cause;
  } finally {
    try {
      closeSync(fileDescriptor);
    } catch (closeCause: unknown) {
      if (syncFailed) {
        throw new AggregateError(
          [syncError, closeCause],
          "Vitest capture-lock directory sync and descriptor cleanup both failed.",
        );
      }
      throw closeCause;
    }
  }
}

export function serializeVitestExecutionCaptureLockOwner(
  ownerInput: VitestExecutionCaptureLockOwner,
): string {
  const owner = lockOwnerSchema.parse(ownerInput);
  return `${JSON.stringify(
    {
      version: owner.version,
      token: owner.token,
      pid: owner.pid,
      platform: owner.platform,
      hostname: owner.hostname,
      acquiredAt: owner.acquiredAt,
    },
    null,
    2,
  )}\n`;
}

export function parseVitestExecutionCaptureLockOwner(
  input: Buffer | string,
): VitestExecutionCaptureLockOwner {
  const bytes = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  if (
    bytes.byteLength <= 0 ||
    bytes.byteLength > LOCK_OWNER_MAX_BYTES ||
    bytes.includes(0)
  ) {
    throw new Error("Vitest execution capture lock owner is malformed.");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
  } catch (cause: unknown) {
    throw new Error("Vitest execution capture lock owner is not UTF-8.", {
      cause,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (cause: unknown) {
    throw new Error("Vitest execution capture lock owner is not JSON.", {
      cause,
    });
  }
  const owner = lockOwnerSchema.parse(parsed);
  if (text !== serializeVitestExecutionCaptureLockOwner(owner)) {
    throw new Error(
      "Vitest execution capture lock owner is not canonical JSON.",
    );
  }
  return owner;
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
    throw new Error("Vitest capture Git metadata path is not valid UTF-8.", {
      cause,
    });
  }
  if (
    text.includes("\0") ||
    text.includes("\r") ||
    !text.endsWith("\n") ||
    text.slice(0, -1).includes("\n")
  ) {
    throw new Error("Vitest capture Git metadata path is malformed.");
  }
  const metadataDirectory = text.slice(0, -1);
  if (
    !isAbsolute(metadataDirectory) ||
    normalize(metadataDirectory) !== metadataDirectory
  ) {
    throw new Error("Vitest capture Git metadata path is not canonical.");
  }
  let physicalDirectory: string;
  let metadata: BigIntStats;
  try {
    physicalDirectory = realpathSync(metadataDirectory);
    metadata = lstatSync(metadataDirectory, { bigint: true });
  } catch (cause: unknown) {
    throw new Error("Vitest capture Git metadata directory is missing.", {
      cause,
    });
  }
  if (
    physicalDirectory !== metadataDirectory ||
    metadata.isSymbolicLink() ||
    !metadata.isDirectory()
  ) {
    throw new Error(
      "Vitest capture Git metadata directory must be a physical directory.",
    );
  }
  return physicalDirectory;
}

function defaultProbePid(pid: number): ReturnType<VitestExecutionCaptureLockProbe> {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (cause: unknown) {
    if (errorCode(cause) === "ESRCH") return "missing";
    if (errorCode(cause) === "EPERM") return "denied";
    return "unknown";
  }
}

export function probeVitestExecutionCaptureLockOwner(
  owner: VitestExecutionCaptureLockOwner,
  options: Readonly<{
    currentHostname?: string;
    currentPlatform?: string;
    probePid?: VitestExecutionCaptureLockProbe;
  }> = {},
): VitestExecutionCaptureLockProbeResult {
  if (owner.hostname !== (options.currentHostname ?? hostname())) {
    return { reason: "foreign_host", status: "unverifiable" };
  }
  if (owner.platform !== (options.currentPlatform ?? process.platform)) {
    return { reason: "foreign_platform", status: "unverifiable" };
  }
  const result = (options.probePid ?? defaultProbePid)(owner.pid);
  if (result === "alive") return { reason: "pid_alive", status: "active" };
  if (result === "missing") return { reason: "pid_missing", status: "stale" };
  if (result === "denied") {
    return { reason: "pid_probe_denied", status: "unverifiable" };
  }
  return { reason: "pid_probe_unknown", status: "unverifiable" };
}

function quarantinePathFor(
  lockPath: string,
  ownerBytes: Buffer,
): string {
  const digest = createHash("sha256").update(ownerBytes).digest("hex");
  return `${lockPath}.stale-${digest}`;
}

function publicationCandidatePathFor(
  lockPath: string,
  token: string,
): string {
  return resolve(dirname(lockPath), `.${basename(lockPath)}.candidate-${token}`);
}

function inspectLockPath(
  lockPath: string,
  probeOptions: Parameters<typeof probeVitestExecutionCaptureLockOwner>[1],
): InternalLockInspection {
  let metadata: BigIntStats;
  try {
    metadata = lstatSync(lockPath, { bigint: true });
  } catch (cause: unknown) {
    if (errorCode(cause) === "ENOENT") {
      return { path: lockPath, status: "absent" };
    }
    return {
      path: lockPath,
      reason: "invalid_lock_file",
      status: "unverifiable",
    };
  }
  if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
    return {
      path: lockPath,
      reason: "legacy_directory_unverifiable",
      status: "unverifiable",
    };
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    return {
      path: lockPath,
      reason: "non_regular_lock_path",
      status: "unverifiable",
    };
  }
  let observation: LockFileObservation;
  let owner: VitestExecutionCaptureLockOwner;
  let publicationCandidatePath: string | null = null;
  let quarantinePresent = false;
  let quarantinePath: string;
  try {
    if (
      metadata.nlink !== 1n &&
      metadata.nlink !== 2n &&
      metadata.nlink !== 3n
    ) {
      throw new Error("Vitest execution capture lock link count is invalid.");
    }
    observation = readStableLockFile(lockPath, [metadata.nlink]);
    if (observation.mode !== 0o600) {
      throw new Error("Vitest execution capture lock mode is not 0600.");
    }
    owner = parseVitestExecutionCaptureLockOwner(observation.bytes);
    quarantinePath = quarantinePathFor(lockPath, observation.bytes);
    const expectedCandidatePath = publicationCandidatePathFor(
      lockPath,
      owner.token,
    );
    const allowedLinkCounts = [metadata.nlink] as const;
    const candidate = readOptionalLinkedLockFile(
      expectedCandidatePath,
      allowedLinkCounts,
    );
    const quarantine = readOptionalLinkedLockFile(
      quarantinePath,
      allowedLinkCounts,
    );
    if (candidate !== null) {
      if (!sameIdentityAndBytes(candidate, observation)) {
        throw new Error(
          "Vitest execution capture lock publication link is not trustworthy.",
        );
      }
      publicationCandidatePath = expectedCandidatePath;
    }
    if (quarantine !== null) {
      if (!sameIdentityAndBytes(quarantine, observation)) {
        throw new Error(
          "Vitest execution capture lock quarantine link is not trustworthy.",
        );
      }
      quarantinePresent = true;
    }
    const recognizedLinks = 1n +
      (publicationCandidatePath === null ? 0n : 1n) +
      (quarantinePresent ? 1n : 0n);
    if (recognizedLinks !== metadata.nlink) {
      throw new Error(
        "Vitest execution capture lock has an unrecognized hard link.",
      );
    }
  } catch {
    return {
      path: lockPath,
      reason: "invalid_lock_file",
      status: "unverifiable",
    };
  }
  const probe = probeVitestExecutionCaptureLockOwner(owner, probeOptions);
  if (probe.status === "stale") {
    return {
      observation,
      owner,
      path: lockPath,
      publicationCandidatePath,
      quarantinePresent,
      quarantinePath,
      reason: "pid_missing",
      status: "stale_internal",
    };
  }
  if (probe.status === "active") {
    return {
      owner,
      path: lockPath,
      publicationCandidatePath,
      quarantinePresent,
      quarantinePath,
      ...probe,
    };
  }
  return {
    owner,
    path: lockPath,
    publicationCandidatePath,
    quarantinePresent,
    quarantinePath,
    ...probe,
  };
}

export function inspectVitestExecutionCaptureLock(
  workspaceInput: string,
  probeOptions: Parameters<typeof probeVitestExecutionCaptureLockOwner>[1] = {},
): VitestExecutionCaptureLockInspection {
  const workspace = realpathSync(resolve(workspaceInput));
  if (workspace !== resolve(workspaceInput)) {
    throw new Error("Vitest capture-lock workspace must not traverse a symlink.");
  }
  const metadataDirectory = resolveGitMetadataDirectory(workspace);
  const lockPath = resolve(
    metadataDirectory,
    VITEST_EXECUTION_CAPTURE_LOCK_NAME,
  );
  if (dirname(lockPath) !== metadataDirectory) {
    throw new Error("Vitest execution capture lock escaped Git metadata.");
  }
  const recoveryClaimPath = recoveryClaimPathFor(metadataDirectory);
  if (pathExists(recoveryClaimPath)) {
    return {
      path: lockPath,
      reason: "recovery_claim_present",
      recoveryClaimPath,
      status: "unverifiable",
    };
  }
  const inspection = inspectLockPath(lockPath, probeOptions);
  const recognizedCandidate =
    "publicationCandidatePath" in inspection
      ? inspection.publicationCandidatePath
      : null;
  const orphanCandidates = captureCandidatePaths(metadataDirectory)
    .filter((candidatePath) => candidatePath !== recognizedCandidate);
  if (orphanCandidates.length > 0) {
    return {
      candidatePaths: orphanCandidates,
      path: lockPath,
      reason: "orphan_publication_candidate",
      status: "unverifiable",
    };
  }
  if (inspection.status !== "stale_internal") return inspection;
  return {
    owner: inspection.owner,
    path: inspection.path,
    publicationCandidatePath: inspection.publicationCandidatePath,
    quarantinePresent: inspection.quarantinePresent,
    quarantinePath: inspection.quarantinePath,
    reason: inspection.reason,
    status: "stale",
  };
}

function unlinkIfOwned(
  path: string,
  expected: Readonly<{ dev: bigint; ino: bigint }>,
): void {
  try {
    const current = lstatSync(path, { bigint: true });
    if (current.dev === expected.dev && current.ino === expected.ino) {
      unlinkSync(path);
    }
  } catch (cause: unknown) {
    if (errorCode(cause) !== "ENOENT") throw cause;
  }
}

function recoverStaleInspection(
  inspection: Extract<InternalLockInspection, { status: "stale_internal" }>,
): string {
  const { lockPath, metadataDirectory } = {
    lockPath: inspection.path,
    metadataDirectory: dirname(inspection.path),
  };
  const quarantinePath = inspection.quarantinePath;
  if (
    dirname(quarantinePath) !== metadataDirectory ||
    basename(quarantinePath) === basename(lockPath)
  ) {
    throw new Error("Vitest capture-lock quarantine path is invalid.");
  }
  if (!inspection.quarantinePresent) {
    try {
      linkSync(lockPath, quarantinePath);
    } catch (cause: unknown) {
      if (errorCode(cause) !== "EEXIST") throw cause;
    }
  }
  const quarantine = readStableLockFile(quarantinePath, [1n, 2n, 3n]);
  if (!sameIdentityAndBytes(quarantine, inspection.observation)) {
    throw new Error("Vitest capture-lock quarantine ownership changed.");
  }
  if (inspection.publicationCandidatePath !== null) {
    unlinkIfOwned(
      inspection.publicationCandidatePath,
      inspection.observation,
    );
  }
  unlinkIfOwned(lockPath, inspection.observation);
  syncDirectory(metadataDirectory);
  const preserved = readStableLockFile(quarantinePath);
  if (!sameIdentityAndBytes(preserved, inspection.observation)) {
    throw new Error(
      "Recovered Vitest capture lock quarantine could not be verified.",
    );
  }
  return quarantinePath;
}

function recoveryClaimPathFor(metadataDirectory: string): string {
  return resolve(
    metadataDirectory,
    VITEST_EXECUTION_CAPTURE_RECOVERY_CLAIM_NAME,
  );
}

function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (cause: unknown) {
    if (errorCode(cause) === "ENOENT") return false;
    throw cause;
  }
}

function assertNoRecoveryClaim(metadataDirectory: string): void {
  const claimPath = recoveryClaimPathFor(metadataDirectory);
  if (!pathExists(claimPath)) return;
  throw new Error(
    `Vitest capture-lock recovery is in progress or requires operator inspection: ${claimPath}`,
  );
}

function acquireRecoveryClaim(
  metadataDirectory: string,
): Readonly<{ path: string; release: () => void }> {
  const claimPath = recoveryClaimPathFor(metadataDirectory);
  const ownerBytes = Buffer.from(
    serializeVitestExecutionCaptureLockOwner(createOwner()),
    "utf8",
  );
  let fileDescriptor: number;
  try {
    fileDescriptor = openSync(
      claimPath,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
  } catch (cause: unknown) {
    if (errorCode(cause) === "EEXIST") {
      throw new Error(
        `Vitest capture-lock recovery is already claimed or requires operator inspection: ${claimPath}`,
        { cause },
      );
    }
    throw cause;
  }
  let descriptorOpen = true;
  let claimIdentity: Readonly<{ dev: bigint; ino: bigint }> | null = null;
  try {
    const opened = fstatSync(fileDescriptor, { bigint: true });
    claimIdentity = { dev: opened.dev, ino: opened.ino };
    writeFileSync(fileDescriptor, ownerBytes);
    fchmodSync(fileDescriptor, 0o600);
    fsyncSync(fileDescriptor);
    descriptorOpen = false;
    closeSync(fileDescriptor);
    const ownedClaim = readStableLockFile(claimPath);
    if (
      ownedClaim.mode !== 0o600 ||
      !ownedClaim.bytes.equals(ownerBytes)
    ) {
      throw new Error("Vitest capture-lock recovery claim changed.");
    }
    syncDirectory(metadataDirectory);
    let released = false;
    return {
      path: claimPath,
      release() {
        if (released) {
          throw new Error("Vitest capture-lock recovery claim was already released.");
        }
        const current = readStableLockFile(claimPath);
        if (!sameObservation(current, ownedClaim)) {
          throw new Error(
            "Vitest capture-lock recovery claim ownership changed; refusing to release it.",
          );
        }
        unlinkSync(claimPath);
        syncDirectory(metadataDirectory);
        released = true;
      },
    };
  } catch (cause: unknown) {
    const cleanupErrors: unknown[] = [];
    if (descriptorOpen) {
      try {
        closeSync(fileDescriptor);
      } catch (cleanupCause: unknown) {
        cleanupErrors.push(cleanupCause);
      }
    }
    if (claimIdentity !== null) {
      try {
        unlinkIfOwned(claimPath, claimIdentity);
      } catch (cleanupCause: unknown) {
        cleanupErrors.push(cleanupCause);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [cause, ...cleanupErrors],
        "Vitest capture-lock recovery-claim setup and cleanup both failed.",
      );
    }
    throw cause;
  }
}

export function recoverStaleVitestExecutionCaptureLock(
  workspaceInput: string,
  options: Parameters<typeof probeVitestExecutionCaptureLockOwner>[1] &
    Readonly<{ operatorConfirmedNoWorkload: true }>,
): string {
  if (options.operatorConfirmedNoWorkload !== true) {
    throw new Error(
      "Stale Vitest capture-lock recovery requires an explicit operator confirmation that no descendant workload remains.",
    );
  }
  const workspace = realpathSync(resolve(workspaceInput));
  if (workspace !== resolve(workspaceInput)) {
    throw new Error("Vitest capture-lock workspace must not traverse a symlink.");
  }
  const metadataDirectory = resolveGitMetadataDirectory(workspace);
  const lockPath = resolve(
    metadataDirectory,
    VITEST_EXECUTION_CAPTURE_LOCK_NAME,
  );
  const recoveryClaim = acquireRecoveryClaim(metadataDirectory);
  let recoveryError: unknown;
  let recoveryFailed = false;
  try {
    const inspection = inspectLockPath(lockPath, options);
    if (inspection.status !== "stale_internal") {
      throw new Error(
        `Vitest execution capture lock is not provably stale (${inspection.status}).`,
      );
    }
    return recoverStaleInspection(inspection);
  } catch (cause: unknown) {
    recoveryError = cause;
    recoveryFailed = true;
    throw cause;
  } finally {
    try {
      recoveryClaim.release();
    } catch (cleanupCause: unknown) {
      if (recoveryFailed) {
        throw new AggregateError(
          [recoveryError, cleanupCause],
          "Vitest capture-lock recovery and claim cleanup both failed.",
        );
      }
      throw cleanupCause;
    }
  }
}

function createOwner(): VitestExecutionCaptureLockOwner {
  return {
    version: VITEST_EXECUTION_CAPTURE_LOCK_VERSION,
    token: randomUUID(),
    pid: process.pid,
    platform: process.platform,
    hostname: hostname(),
    acquiredAt: new Date().toISOString(),
  };
}

function publishCaptureLock(
  metadataDirectory: string,
  lockPath: string,
): VitestExecutionCaptureLock | null {
  const owner = createOwner();
  const ownerBytes = Buffer.from(
    serializeVitestExecutionCaptureLockOwner(owner),
    "utf8",
  );
  const candidatePath = publicationCandidatePathFor(lockPath, owner.token);
  if (dirname(candidatePath) !== metadataDirectory) {
    throw new Error("Vitest capture-lock candidate escaped Git metadata.");
  }
  const fileDescriptor = openSync(
    candidatePath,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  let candidate: LockFileObservation | null = null;
  let candidateIdentity: Readonly<{ dev: bigint; ino: bigint }> | null = null;
  let candidatePresent = true;
  let published = false;
  let descriptorOpen = true;
  try {
    const openedMetadata = fstatSync(fileDescriptor, { bigint: true });
    candidateIdentity = {
      dev: openedMetadata.dev,
      ino: openedMetadata.ino,
    };
    writeFileSync(fileDescriptor, ownerBytes);
    fchmodSync(fileDescriptor, 0o600);
    fsyncSync(fileDescriptor);
    const candidateMetadata = fstatSync(fileDescriptor, { bigint: true });
    if (
      !candidateMetadata.isFile() ||
      candidateMetadata.nlink !== 1n ||
      permissionMode(candidateMetadata) !== 0o600
    ) {
      throw new Error("Vitest capture-lock candidate is not a private file.");
    }
    descriptorOpen = false;
    closeSync(fileDescriptor);
    candidate = readStableLockFile(candidatePath);
    if (!candidate.bytes.equals(ownerBytes)) {
      throw new Error("Vitest capture-lock candidate bytes changed.");
    }
    try {
      linkSync(candidatePath, lockPath);
      published = true;
    } catch (cause: unknown) {
      if (errorCode(cause) === "EEXIST") {
        unlinkIfOwned(candidatePath, candidate);
        candidatePresent = false;
        return null;
      }
      throw cause;
    }
    const linkedCandidate = readStableLockFile(candidatePath, [2n]);
    const linkedLock = readStableLockFile(lockPath, [2n]);
    if (
      !sameIdentityAndBytes(linkedCandidate, candidate) ||
      !sameIdentityAndBytes(linkedLock, candidate)
    ) {
      throw new Error("Vitest capture-lock publication could not be verified.");
    }
    syncDirectory(metadataDirectory);
    const ownedLock = readStableLockFile(lockPath, [2n]);
    const ownedGuard = readStableLockFile(candidatePath, [2n]);
    if (
      !sameIdentityAndBytes(ownedLock, candidate) ||
      !sameObservation(ownedGuard, ownedLock) ||
      !ownedLock.bytes.equals(ownerBytes)
    ) {
      throw new Error("Published Vitest capture lock could not be verified.");
    }
    let released = false;
    const assertOwned = () => {
      let currentLock: LockFileObservation;
      let currentGuard: LockFileObservation;
      try {
        currentLock = readStableLockFile(lockPath, [2n]);
        currentGuard = readStableLockFile(candidatePath, [2n]);
      } catch (cause: unknown) {
        throw new Error(
          "Vitest execution capture lock ownership changed; refusing to continue.",
          { cause },
        );
      }
      if (
        !sameObservation(currentLock, ownedLock) ||
        !sameObservation(currentGuard, ownedGuard) ||
        !sameObservation(currentGuard, currentLock)
      ) {
        throw new Error(
          "Vitest execution capture lock ownership changed; refusing to continue.",
        );
      }
    };
    return {
      assertOwned,
      guardPath: candidatePath,
      path: lockPath,
      release() {
        if (released) {
          throw new Error("Vitest execution capture lock was already released.");
        }
        try {
          assertOwned();
        } catch (cause: unknown) {
          throw new Error(
            "Vitest execution capture lock ownership changed; refusing to release it.",
            { cause },
          );
        }
        unlinkSync(lockPath);
        unlinkSync(candidatePath);
        candidatePresent = false;
        syncDirectory(metadataDirectory);
        released = true;
      },
    };
  } catch (cause: unknown) {
    const cleanupErrors: unknown[] = [];
    if (descriptorOpen) {
      descriptorOpen = false;
      try {
        closeSync(fileDescriptor);
      } catch (cleanupCause: unknown) {
        cleanupErrors.push(cleanupCause);
      }
    }
    if (published && candidate !== null) {
      try {
        unlinkIfOwned(lockPath, candidate);
      } catch (cleanupCause: unknown) {
        cleanupErrors.push(cleanupCause);
      }
    }
    if (candidatePresent && candidateIdentity !== null) {
      try {
        unlinkIfOwned(candidatePath, candidateIdentity);
        candidatePresent = false;
      } catch (cleanupCause: unknown) {
        cleanupErrors.push(cleanupCause);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [cause, ...cleanupErrors],
        "Vitest capture-lock publication and cleanup both failed.",
      );
    }
    throw cause;
  }
}

function captureCandidatePaths(metadataDirectory: string): string[] {
  const prefix = `.${VITEST_EXECUTION_CAPTURE_LOCK_NAME}.candidate-`;
  return readdirSync(metadataDirectory)
    .filter((entry) => entry.startsWith(prefix))
    .sort()
    .map((entry) => resolve(metadataDirectory, entry));
}

export function acquireVitestExecutionCaptureLock(
  workspaceInput: string,
): VitestExecutionCaptureLock {
  const workspace = realpathSync(resolve(workspaceInput));
  if (workspace !== resolve(workspaceInput)) {
    throw new Error("Vitest capture-lock workspace must not traverse a symlink.");
  }
  const metadataDirectory = resolveGitMetadataDirectory(workspace);
  const lockPath = resolve(
    metadataDirectory,
    VITEST_EXECUTION_CAPTURE_LOCK_NAME,
  );
  if (dirname(lockPath) !== metadataDirectory) {
    throw new Error("Vitest execution capture lock escaped Git metadata.");
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    assertNoRecoveryClaim(metadataDirectory);
    const existing = inspectVitestExecutionCaptureLock(workspace);
    if (existing.status !== "absent") {
      throw new Error(
        "Vitest execution capture lock is already held or requires explicit " +
          `operator recovery (${existing.status}/${"reason" in existing ? existing.reason : "unknown"}): ${lockPath}`,
      );
    }
    const lock = publishCaptureLock(metadataDirectory, lockPath);
    if (lock !== null) return lock;
    const inspection = inspectLockPath(lockPath, {});
    if (inspection.status === "absent") continue;
    throw new Error(
      `Vitest execution capture lock is already held or requires explicit operator recovery (${inspection.status}/${"reason" in inspection ? inspection.reason : "unknown"}): ${lockPath}`,
    );
  }
  throw new Error(
    `Vitest execution capture lock changed repeatedly during acquisition: ${lockPath}`,
  );
}
