import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  type Stats,
} from "node:fs";
import { isAbsolute, posix, resolve, sep } from "node:path";

import {
  VITEST_EXECUTION_EVIDENCE_MAX_BYTES,
  parseCanonicalVitestExecutionEvidence,
  vitestExecutionEvidencePath,
  type VitestExecutionEvidence,
} from "./vitest-execution-evidence";

export type ReadVitestExecutionEvidenceResult = Readonly<{
  evidence: VitestExecutionEvidence;
  text: string;
}>;

type PathSnapshot = Readonly<{
  metadata: Stats;
  path: string;
}>;

function parseRepositoryRelativePath(path: string): string {
  if (
    path.length === 0 ||
    path.length > 500 ||
    isAbsolute(path) ||
    path.includes("\\") ||
    path.includes("\0") ||
    posix.normalize(path) !== path ||
    path.split("/").some((segment) =>
      segment.length === 0 || segment === "." || segment === ".."
    )
  ) {
    throw new Error(
      "Vitest execution evidence path must be a normalized repository-relative path.",
    );
  }
  return path;
}

function sameMetadata(left: Stats, right: Stats): boolean {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.size === right.size;
}

function readExactFile(descriptor: number, expectedSize: number): Buffer {
  const bytes = Buffer.alloc(expectedSize);
  let offset = 0;
  while (offset < expectedSize) {
    const count = readSync(
      descriptor,
      bytes,
      offset,
      expectedSize - offset,
      null,
    );
    if (count === 0) break;
    offset += count;
  }
  const trailingByte = Buffer.alloc(1);
  if (
    offset !== expectedSize ||
    readSync(descriptor, trailingByte, 0, trailingByte.byteLength, null) !== 0
  ) {
    throw new Error("Vitest execution evidence changed while being read.");
  }
  return bytes;
}

function inspectPhysicalDirectory(path: string, label: string): PathSnapshot {
  let metadata: Stats;
  let physicalPath: string;
  try {
    metadata = lstatSync(path);
    physicalPath = realpathSync(path);
  } catch (cause: unknown) {
    throw new Error(`${label} is missing or unreadable.`, { cause });
  }
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    physicalPath !== path
  ) {
    throw new Error(`${label} must be a physical non-symlink directory.`);
  }
  return { metadata, path };
}

function inspectDirectoryChain(
  workspace: string,
  repositoryPath: string,
): PathSnapshot[] {
  const snapshots = [
    inspectPhysicalDirectory(workspace, "Vitest evidence workspace"),
  ];
  const parentSegments = repositoryPath.split("/").slice(0, -1);
  let current = workspace;
  for (const segment of parentSegments) {
    current = resolve(current, segment);
    snapshots.push(inspectPhysicalDirectory(
      current,
      "Vitest execution evidence parent path",
    ));
  }
  return snapshots;
}

function assertDirectoryChainStable(snapshots: readonly PathSnapshot[]): void {
  for (const snapshot of snapshots) {
    const after = inspectPhysicalDirectory(
      snapshot.path,
      "Vitest execution evidence parent path",
    );
    if (!sameMetadata(snapshot.metadata, after.metadata)) {
      throw new Error(
        "Vitest execution evidence parent path changed while being read.",
      );
    }
  }
}

/**
 * Reads the canonical Vitest execution receipt through a fail-closed filesystem
 * boundary. The optional path exists for isolated verifier tests; it receives
 * the same repository-relative containment checks as the production path.
 */
export function readVitestExecutionEvidence(
  workspaceInput: string,
  pathInput: string = vitestExecutionEvidencePath,
): ReadVitestExecutionEvidenceResult {
  const repositoryPath = parseRepositoryRelativePath(pathInput);
  const workspace = resolve(workspaceInput);
  const directorySnapshots = inspectDirectoryChain(workspace, repositoryPath);
  const absolutePath = resolve(workspace, repositoryPath);
  if (!absolutePath.startsWith(`${workspace}${sep}`)) {
    throw new Error("Vitest execution evidence path escaped the workspace.");
  }

  let before: Stats;
  let physicalPath: string;
  try {
    before = lstatSync(absolutePath);
    physicalPath = realpathSync(absolutePath);
  } catch (cause: unknown) {
    throw new Error("Vitest execution evidence is missing or unreadable.", {
      cause,
    });
  }
  if (
    before.isSymbolicLink() ||
    !before.isFile() ||
    physicalPath !== absolutePath ||
    before.size <= 0 ||
    before.size > VITEST_EXECUTION_EVIDENCE_MAX_BYTES
  ) {
    throw new Error(
      "Vitest execution evidence must be a non-empty bounded regular non-symlink file.",
    );
  }

  let descriptor: number | undefined;
  let bytes: Buffer;
  try {
    descriptor = openSync(
      absolutePath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || !sameMetadata(before, opened)) {
      throw new Error(
        "Vitest execution evidence changed before it could be read.",
      );
    }
    bytes = readExactFile(descriptor, before.size);
    const afterRead = fstatSync(descriptor);
    if (
      bytes.byteLength !== before.size ||
      !sameMetadata(opened, afterRead)
    ) {
      throw new Error("Vitest execution evidence changed while being read.");
    }
  } catch (cause: unknown) {
    if (cause instanceof Error && cause.message.startsWith("Vitest execution")) {
      throw cause;
    }
    throw new Error("Vitest execution evidence could not be read safely.", {
      cause,
    });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }

  let after: Stats;
  let finalPhysicalPath: string;
  try {
    after = lstatSync(absolutePath);
    finalPhysicalPath = realpathSync(absolutePath);
  } catch (cause: unknown) {
    throw new Error("Vitest execution evidence disappeared while being read.", {
      cause,
    });
  }
  if (
    after.isSymbolicLink() ||
    !after.isFile() ||
    finalPhysicalPath !== absolutePath ||
    !sameMetadata(before, after)
  ) {
    throw new Error("Vitest execution evidence changed while being read.");
  }
  assertDirectoryChainStable(directorySnapshots);

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause: unknown) {
    throw new Error("Vitest execution evidence is not valid UTF-8.", { cause });
  }

  return {
    evidence: parseCanonicalVitestExecutionEvidence(text),
    text,
  };
}
