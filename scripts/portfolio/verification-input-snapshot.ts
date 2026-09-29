import { constants, realpathSync } from "node:fs";
import type { BigIntStats } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { isAbsolute, normalize, resolve, sep } from "node:path";

const DEFAULT_MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_TRACKED_BYTES = 256 * 1024 * 1024;

type FileIdentity = Readonly<{
  ctimeNs: bigint;
  dev: bigint;
  gid: bigint;
  ino: bigint;
  mode: bigint;
  mtimeNs: bigint;
  nlink: bigint;
  size: bigint;
  uid: bigint;
}>;

type FileSnapshot = Readonly<{
  bytes: Buffer;
  identity: FileIdentity;
  label: string;
  maxBytes: number;
  path: string;
}>;

type DirectorySnapshot = Readonly<{
  entries: readonly string[];
  identity: FileIdentity;
  label: string;
  path: string;
}>;

function identity(stats: BigIntStats): FileIdentity {
  return {
    ctimeNs: stats.ctimeNs,
    dev: stats.dev,
    gid: stats.gid,
    ino: stats.ino,
    mode: stats.mode,
    mtimeNs: stats.mtimeNs,
    nlink: stats.nlink,
    size: stats.size,
    uid: stats.uid,
  };
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.ctimeNs === right.ctimeNs &&
    left.dev === right.dev &&
    left.gid === right.gid &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.mtimeNs === right.mtimeNs &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.uid === right.uid;
}

function safeRelativePath(path: string, label: string): string {
  if (
    path.length === 0 ||
    isAbsolute(path) ||
    path.includes("\\") ||
    path.includes("\0")
  ) {
    throw new Error(`${label} must be a non-empty relative workspace path.`);
  }
  const normalized = normalize(path).split(sep).join("/");
  if (
    normalized !== path ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.split("/").includes("..")
  ) {
    throw new Error(`${label} escaped the workspace.`);
  }
  return normalized;
}

function containedPath(workspace: string, path: string, label: string): string {
  const relativePath = safeRelativePath(path, label);
  const absolutePath = resolve(workspace, relativePath);
  if (!absolutePath.startsWith(`${workspace}${sep}`)) {
    throw new Error(`${label} escaped the workspace.`);
  }
  return absolutePath;
}

function assertSameFileSnapshot(
  actual: Pick<FileSnapshot, "bytes" | "identity">,
  expected: Pick<FileSnapshot, "bytes" | "identity">,
  label: string,
): void {
  if (
    !actual.bytes.equals(expected.bytes) ||
    !sameIdentity(actual.identity, expected.identity)
  ) {
    throw new Error(`${label} changed during portfolio verification.`);
  }
}

async function captureStableFile(input: {
  absolutePath: string;
  label: string;
  maxBytes: number;
  relativePath: string;
}): Promise<Pick<FileSnapshot, "bytes" | "identity">> {
  let pathBefore: BigIntStats;
  let physicalBefore: string;
  try {
    [pathBefore, physicalBefore] = await Promise.all([
      lstat(input.absolutePath, { bigint: true }),
      realpath(input.absolutePath),
    ]);
  } catch (cause: unknown) {
    throw new Error(`${input.label} is missing or unreadable: ${input.relativePath}.`, {
      cause,
    });
  }
  if (
    pathBefore.isSymbolicLink() ||
    !pathBefore.isFile() ||
    physicalBefore !== input.absolutePath
  ) {
    throw new Error(
      `${input.label} must be a contained regular non-symlink file: ${input.relativePath}.`,
    );
  }
  if (pathBefore.size < 0n || pathBefore.size > BigInt(input.maxBytes)) {
    throw new Error(
      `${input.label} exceeds its ${input.maxBytes}-byte limit: ${input.relativePath}.`,
    );
  }

  let handle;
  try {
    handle = await open(
      input.absolutePath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
  } catch (cause: unknown) {
    throw new Error(`${input.label} could not be opened safely: ${input.relativePath}.`, {
      cause,
    });
  }

  let bytes: Buffer;
  let handleBefore: BigIntStats;
  let handleAfter: BigIntStats;
  let operationError: unknown;
  try {
    handleBefore = await handle.stat({ bigint: true });
    bytes = await handle.readFile();
    handleAfter = await handle.stat({ bigint: true });
  } catch (cause: unknown) {
    operationError = cause;
    throw cause;
  } finally {
    try {
      await handle.close();
    } catch (closeCause: unknown) {
      if (operationError !== undefined) {
        throw new AggregateError(
          [operationError, closeCause],
          `${input.label} read and close both failed: ${input.relativePath}.`,
        );
      }
      throw closeCause;
    }
  }

  let pathAfter: BigIntStats;
  let physicalAfter: string;
  try {
    [pathAfter, physicalAfter] = await Promise.all([
      lstat(input.absolutePath, { bigint: true }),
      realpath(input.absolutePath),
    ]);
  } catch (cause: unknown) {
    throw new Error(`${input.label} changed while it was read: ${input.relativePath}.`, {
      cause,
    });
  }
  const initialIdentity = identity(pathBefore);
  const handleIdentity = identity(handleBefore);
  const finalHandleIdentity = identity(handleAfter);
  const finalPathIdentity = identity(pathAfter);
  if (
    !handleBefore.isFile() ||
    !handleAfter.isFile() ||
    pathAfter.isSymbolicLink() ||
    !pathAfter.isFile() ||
    physicalAfter !== input.absolutePath ||
    bytes.byteLength !== Number(handleBefore.size) ||
    !sameIdentity(initialIdentity, handleIdentity) ||
    !sameIdentity(handleIdentity, finalHandleIdentity) ||
    !sameIdentity(finalHandleIdentity, finalPathIdentity)
  ) {
    throw new Error(`${input.label} changed while it was read: ${input.relativePath}.`);
  }
  return { bytes, identity: finalPathIdentity };
}

async function captureStableDirectory(input: {
  absolutePath: string;
  label: string;
  relativePath: string;
}): Promise<Pick<DirectorySnapshot, "entries" | "identity">> {
  let before: BigIntStats;
  let physicalBefore: string;
  try {
    [before, physicalBefore] = await Promise.all([
      lstat(input.absolutePath, { bigint: true }),
      realpath(input.absolutePath),
    ]);
  } catch (cause: unknown) {
    throw new Error(`${input.label} is missing or unreadable: ${input.relativePath}.`, {
      cause,
    });
  }
  if (
    before.isSymbolicLink() ||
    !before.isDirectory() ||
    physicalBefore !== input.absolutePath
  ) {
    throw new Error(
      `${input.label} must be a contained regular non-symlink directory: ${input.relativePath}.`,
    );
  }
  const entries = (await readdir(input.absolutePath, { withFileTypes: true }))
    .map((entry) => {
      if (entry.isSymbolicLink() || !entry.isFile()) {
        throw new Error(
          `${input.label} contains a non-file entry: ${input.relativePath}/${entry.name}.`,
        );
      }
      return entry.name;
    })
    .sort((left, right) => left.localeCompare(right));
  const [after, physicalAfter] = await Promise.all([
    lstat(input.absolutePath, { bigint: true }),
    realpath(input.absolutePath),
  ]);
  if (
    after.isSymbolicLink() ||
    !after.isDirectory() ||
    physicalAfter !== input.absolutePath ||
    !sameIdentity(identity(before), identity(after))
  ) {
    throw new Error(
      `${input.label} changed while its inventory was read: ${input.relativePath}.`,
    );
  }
  return { entries, identity: identity(after) };
}

/**
 * Records exact bytes and file identities for inputs consumed by one portfolio
 * verification. `assertUnchanged` is a final fail-closed barrier; it is not a
 * filesystem transaction and cannot prevent a non-cooperating writer from
 * changing a file after the final comparison returns.
 */
export class PortfolioVerificationInputLedger {
  readonly #directories = new Map<string, DirectorySnapshot>();
  readonly #files = new Map<string, FileSnapshot>();
  readonly #workspace: string;
  #trackedBytes = 0;

  constructor(workspace: string) {
    const requestedWorkspace = resolve(workspace);
    const physicalWorkspace = realpathSync(requestedWorkspace);
    if (physicalWorkspace !== requestedWorkspace) {
      throw new Error("Portfolio input workspace must not traverse a symbolic link.");
    }
    this.#workspace = physicalWorkspace;
  }

  async readBytes(
    path: string,
    options: { label?: string; maxBytes?: number } = {},
  ): Promise<Buffer> {
    const relativePath = safeRelativePath(path, "Portfolio verification input path");
    const label = options.label ?? "Portfolio verification input";
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_FILE_BYTES;
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw new Error(`${label} byte limit must be a positive safe integer.`);
    }
    const current = await captureStableFile({
      absolutePath: containedPath(this.#workspace, relativePath, label),
      label,
      maxBytes,
      relativePath,
    });
    const existing = this.#files.get(relativePath);
    if (existing !== undefined) {
      if (current.bytes.byteLength > maxBytes) {
        throw new Error(`${label} exceeds its ${maxBytes}-byte limit: ${relativePath}.`);
      }
      assertSameFileSnapshot(current, existing, `${label} ${relativePath}`);
      return Buffer.from(existing.bytes);
    }
    if (this.#trackedBytes + current.bytes.byteLength > MAX_TRACKED_BYTES) {
      throw new Error(
        `Portfolio verification inputs exceed the ${MAX_TRACKED_BYTES}-byte aggregate limit.`,
      );
    }
    const snapshot: FileSnapshot = {
      bytes: Buffer.from(current.bytes),
      identity: current.identity,
      label,
      maxBytes,
      path: relativePath,
    };
    this.#files.set(relativePath, snapshot);
    this.#trackedBytes += current.bytes.byteLength;
    return Buffer.from(snapshot.bytes);
  }

  async readUtf8(
    path: string,
    options: { label?: string; maxBytes?: number } = {},
  ): Promise<string> {
    return (await this.readBytes(path, options)).toString("utf8");
  }

  async snapshotDirectoryFiles(
    path: string,
    options: {
      include: (filename: string) => boolean;
      label?: string;
      maxBytesPerFile?: number;
    },
  ): Promise<string[]> {
    const relativePath = safeRelativePath(path, "Portfolio verification directory path");
    const label = options.label ?? "Portfolio verification input directory";
    const absolutePath = containedPath(this.#workspace, relativePath, label);
    const current = await captureStableDirectory({
      absolutePath,
      label,
      relativePath,
    });
    const existing = this.#directories.get(relativePath);
    if (existing !== undefined) {
      if (
        !sameIdentity(current.identity, existing.identity) ||
        JSON.stringify(current.entries) !== JSON.stringify(existing.entries)
      ) {
        throw new Error(`${label} ${relativePath} changed during portfolio verification.`);
      }
    } else {
      this.#directories.set(relativePath, {
        entries: [...current.entries],
        identity: current.identity,
        label,
        path: relativePath,
      });
    }
    const selectedPaths = current.entries
      .filter(options.include)
      .map((filename) => `${relativePath}/${filename}`);
    await Promise.all(
      selectedPaths.map((file) =>
        this.readBytes(file, {
          label: `${label} file`,
          maxBytes: options.maxBytesPerFile,
        })
      ),
    );
    const after = await captureStableDirectory({
      absolutePath,
      label,
      relativePath,
    });
    if (
      !sameIdentity(current.identity, after.identity) ||
      JSON.stringify(current.entries) !== JSON.stringify(after.entries)
    ) {
      throw new Error(`${label} changed while files were snapshotted: ${relativePath}.`);
    }
    return selectedPaths;
  }

  async assertUnchanged(): Promise<void> {
    // Two passes make mutations during the barrier observable without claiming
    // an atomic multi-file snapshot from an ordinary filesystem.
    for (let pass = 0; pass < 2; pass += 1) {
      for (const expected of [...this.#directories.values()].sort((left, right) =>
        left.path.localeCompare(right.path)
      )) {
        const actual = await captureStableDirectory({
          absolutePath: containedPath(this.#workspace, expected.path, expected.label),
          label: expected.label,
          relativePath: expected.path,
        });
        if (
          !sameIdentity(actual.identity, expected.identity) ||
          JSON.stringify(actual.entries) !== JSON.stringify(expected.entries)
        ) {
          throw new Error(
            `${expected.label} ${expected.path} changed during portfolio verification.`,
          );
        }
      }
      for (const expected of [...this.#files.values()].sort((left, right) =>
        left.path.localeCompare(right.path)
      )) {
        const actual = await captureStableFile({
          absolutePath: containedPath(this.#workspace, expected.path, expected.label),
          label: expected.label,
          maxBytes: expected.maxBytes,
          relativePath: expected.path,
        });
        assertSameFileSnapshot(
          actual,
          expected,
          `${expected.label} ${expected.path}`,
        );
      }
    }
  }
}
