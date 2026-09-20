import { constants } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import {
  screenshotManifestPath,
  screenshotSpecifications,
} from "./screenshot-manifest";
import {
  acquireScreenshotCaptureLock,
  screenshotCaptureStagingPrefix,
} from "./screenshot-capture-lock";

export { screenshotCaptureStagingPrefix } from "./screenshot-capture-lock";

export const screenshotArtifactPaths = [
  ...screenshotSpecifications.map(({ path }) => path),
  screenshotManifestPath,
] as const;

type ScreenshotCaptureSession = {
  captureCandidates: (stagingRoot: string) => Promise<void>;
  stop: () => Promise<void>;
};

type ScreenshotPublicationInput = {
  cleanupStaging?: (stagingRoot: string) => Promise<void>;
  openCaptureSession: () => Promise<ScreenshotCaptureSession>;
  publishCandidate?: (
    candidatePath: string,
    destinationPath: string,
    index: number,
  ) => Promise<void>;
  verifyCandidates: (
    stagingRoot: string,
    manifestText: string,
  ) => Promise<void>;
  verifyPublished: (manifestText: string) => Promise<void>;
  workspace: string;
};

type ArtifactSnapshot =
  | {
      artifactPath: string;
      backupPath: string;
      existed: true;
      path: string;
    }
  | { artifactPath: string; existed: false; path: string };

export class IncompleteScreenshotRollbackError extends AggregateError {
  readonly preserveStaging = true;
  readonly stagingRoot: string;

  constructor(errors: Iterable<unknown>, stagingRoot: string) {
    super(
      errors,
      "Screenshot publication failed and its rollback was incomplete; " +
        `the capture lock and staging were preserved for recovery at ${stagingRoot}.`,
    );
    this.stagingRoot = stagingRoot;
  }
}

export class ScreenshotPublicationCommittedCleanupError extends AggregateError {
  readonly lockPath: string;
  readonly publicationCommitted = true;
  readonly stagingRoot: string;
  readonly stagingPreserved: boolean;

  constructor(
    errors: Iterable<unknown>,
    input: {
      lockPath: string;
      stagingPreserved: boolean;
      stagingRoot: string;
    },
  ) {
    super(
      errors,
      "Screenshot publication committed and verified, but cleanup failed. " +
        (input.stagingPreserved
          ? "Staging cleanup was not proven complete at " +
            `${input.stagingRoot}; the capture lock remains at ${input.lockPath}. `
          : "Staging cleanup completed, but capture-lock release failed at " +
            `${input.lockPath}. `) +
        "Do not roll back from the stale pre-publication snapshot.",
    );
    this.lockPath = input.lockPath;
    this.stagingPreserved = input.stagingPreserved;
    this.stagingRoot = input.stagingRoot;
  }
}

function isErrorCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as Error & { code?: unknown }).code === code
  );
}

function isWithin(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

async function assertSameBytes(
  leftPath: string,
  rightPath: string,
  errorMessage: string,
): Promise<void> {
  const [left, right] = await Promise.all([
    readFile(leftPath),
    readFile(rightPath),
  ]);
  if (!left.equals(right)) throw new Error(errorMessage);
}

export function screenshotCandidatePath(
  stagingRoot: string,
  artifactPath: string,
): string {
  const root = resolve(stagingRoot);
  const candidate = resolve(root, artifactPath);
  if (!isWithin(root, candidate)) {
    throw new Error("Screenshot candidate path escapes staging.");
  }
  return candidate;
}

async function captureAndStop(
  session: ScreenshotCaptureSession,
  stagingRoot: string,
): Promise<void> {
  let captureError: unknown;
  let captureFailed = false;
  try {
    await session.captureCandidates(stagingRoot);
  } catch (error: unknown) {
    captureFailed = true;
    captureError = error;
  }

  let stopError: unknown;
  let stopFailed = false;
  try {
    await session.stop();
  } catch (error: unknown) {
    stopFailed = true;
    stopError = error;
  }

  if (captureFailed && stopFailed) {
    throw new AggregateError(
      [captureError, stopError],
      "Screenshot capture and server shutdown both failed.",
    );
  }
  if (captureFailed) throw captureError;
  if (stopFailed) throw stopError;
}

async function assertRegularContainedFile(
  root: string,
  path: string,
  label: string,
): Promise<void> {
  const [rootRealPath, metadata, fileRealPath] = await Promise.all([
    realpath(root),
    lstat(path),
    realpath(path),
  ]);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    !isWithin(rootRealPath, fileRealPath)
  ) {
    throw new Error(`${label} is not a contained regular file.`);
  }
}

async function containedDirectoryRealPath(
  root: string,
  path: string,
  label: string,
): Promise<string> {
  const [metadata, directoryRealPath] = await Promise.all([
    lstat(path),
    realpath(path),
  ]);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    !isWithin(root, directoryRealPath)
  ) {
    throw new Error(`${label} is not a contained regular directory.`);
  }
  return directoryRealPath;
}

async function snapshotPublishedArtifacts(
  workspace: string,
  stagingRoot: string,
): Promise<ArtifactSnapshot[]> {
  const snapshots: ArtifactSnapshot[] = [];
  for (const artifactPath of screenshotArtifactPaths) {
    const path = resolve(workspace, artifactPath);
    let metadata;
    try {
      metadata = await lstat(path);
    } catch (error: unknown) {
      if (isErrorCode(error, "ENOENT")) {
        snapshots.push({ artifactPath, existed: false, path });
        continue;
      }
      throw error;
    }
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(
        `Published screenshot artifact is not a regular file: ${artifactPath}`,
      );
    }
    const backupPath = resolve(stagingRoot, "rollback", artifactPath);
    await mkdir(dirname(backupPath), { recursive: true });
    await copyFile(path, backupPath, constants.COPYFILE_EXCL);
    await assertSameBytes(
      path,
      backupPath,
      `Screenshot rollback backup drifted: ${artifactPath}`,
    );
    snapshots.push({ artifactPath, backupPath, existed: true, path });
  }
  return snapshots;
}

async function restorePublishedArtifacts(
  snapshots: readonly ArtifactSnapshot[],
  attemptedPaths: ReadonlySet<string>,
  stagingRoot: string,
): Promise<unknown[]> {
  const rollbackErrors: unknown[] = [];
  for (const snapshot of [...snapshots].reverse()) {
    if (!attemptedPaths.has(snapshot.path)) continue;
    try {
      if (!snapshot.existed) {
        await rm(snapshot.path, { force: true });
        try {
          await lstat(snapshot.path);
          throw new Error(
            `New screenshot artifact remained after rollback: ${snapshot.artifactPath}`,
          );
        } catch (error: unknown) {
          if (!isErrorCode(error, "ENOENT")) throw error;
        }
        continue;
      }
      const recoveryPath = resolve(
        stagingRoot,
        "recovery",
        `${snapshot.artifactPath}.tmp`,
      );
      await mkdir(dirname(recoveryPath), { recursive: true });
      await copyFile(snapshot.backupPath, recoveryPath);
      await rename(recoveryPath, snapshot.path);
      await assertSameBytes(
        snapshot.backupPath,
        snapshot.path,
        `Screenshot artifact rollback drifted: ${snapshot.artifactPath}`,
      );
    } catch (error: unknown) {
      rollbackErrors.push(error);
    }
  }
  return rollbackErrors;
}

async function publishScreenshotArtifacts(
  input: ScreenshotPublicationInput,
  stagingRoot: string,
): Promise<void> {
  for (const artifactPath of screenshotArtifactPaths) {
    await assertRegularContainedFile(
      stagingRoot,
      screenshotCandidatePath(stagingRoot, artifactPath),
      `Screenshot candidate ${artifactPath}`,
    );
  }
  const snapshots = await snapshotPublishedArtifacts(
    input.workspace,
    stagingRoot,
  );
  const attemptedPaths = new Set<string>();
  const publishCandidate = input.publishCandidate ??
    (async (candidatePath: string, destinationPath: string) => {
      await rename(candidatePath, destinationPath);
    });

  try {
    for (const [index, artifactPath] of screenshotArtifactPaths.entries()) {
      const destinationPath = resolve(input.workspace, artifactPath);
      attemptedPaths.add(destinationPath);
      await publishCandidate(
        screenshotCandidatePath(stagingRoot, artifactPath),
        destinationPath,
        index,
      );
    }
    const publishedManifestText = await readFile(
      resolve(input.workspace, screenshotManifestPath),
      "utf8",
    );
    await input.verifyPublished(publishedManifestText);
  } catch (publicationError: unknown) {
    const rollbackErrors = await restorePublishedArtifacts(
      snapshots,
      attemptedPaths,
      stagingRoot,
    );
    if (rollbackErrors.length > 0) {
      throw new IncompleteScreenshotRollbackError(
        [publicationError, ...rollbackErrors],
        stagingRoot,
      );
    }
    throw publicationError;
  }
}

async function assertNoUnresolvedScreenshotStaging(
  portfolioRoot: string,
): Promise<void> {
  const unresolved = (await readdir(portfolioRoot))
    .filter((entry) => entry.startsWith(screenshotCaptureStagingPrefix))
    .map((entry) => resolve(portfolioRoot, entry));
  if (unresolved.length > 0) {
    throw new Error(
      "Screenshot capture found unresolved staging that requires manual " +
        `inspection before another publication: ${unresolved.join(", ")}`,
    );
  }
}

function aggregateOperationAndCleanupErrors(
  operationError: unknown,
  cleanupErrors: readonly unknown[],
  input: {
    lockPath: string;
    stagingCleanupUnproven: boolean;
    stagingRoot: string | null;
  },
): AggregateError {
  const recoveryState = input.stagingRoot === null
    ? " No staging directory was created, but capture-lock release failed at " +
      `${input.lockPath}.`
    : input.stagingCleanupUnproven
      ? " Staging cleanup was not proven complete at " +
        `${input.stagingRoot}; the capture lock remains at ${input.lockPath}.`
      : " Staging cleanup completed, but capture-lock release failed at " +
        `${input.lockPath}.`;
  return new AggregateError(
    [operationError, ...cleanupErrors],
    `Screenshot capture failed and cleanup also failed.${recoveryState}`,
  );
}

async function assertPathAbsent(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error: unknown) {
    if (isErrorCode(error, "ENOENT")) return;
    throw error;
  }
  throw new Error(`Screenshot staging cleanup left the path present: ${path}`);
}

/**
 * Captures and validates a complete candidate set before publishing any file.
 * The server/session must stop successfully before publication begins. Since a
 * filesystem has no three-file atomic rename, publication is manifest-last and
 * every attempted destination is restored from byte-for-byte backups on error.
 */
export async function captureScreenshotArtifactsWithRollback(
  input: ScreenshotPublicationInput,
): Promise<void> {
  const workspaceRealPath = await realpath(input.workspace);
  const captureLock = await acquireScreenshotCaptureLock(workspaceRealPath);
  let stagingRoot: string | null = null;
  let operationError: unknown;
  let operationFailed = false;
  let publicationCommitted = false;
  let preserveStaging = false;
  try {
    const publicDirectory = resolve(workspaceRealPath, "public");
    const publicRealPath = await containedDirectoryRealPath(
      workspaceRealPath,
      publicDirectory,
      "Screenshot public directory",
    );
    const portfolioDirectory = resolve(publicRealPath, "portfolio");
    await mkdir(portfolioDirectory, { recursive: true });
    const portfolioRealPath = await containedDirectoryRealPath(
      workspaceRealPath,
      portfolioDirectory,
      "Screenshot portfolio directory",
    );
    await assertNoUnresolvedScreenshotStaging(portfolioRealPath);
    stagingRoot = await mkdtemp(
      join(portfolioRealPath, screenshotCaptureStagingPrefix),
    );
    await chmod(stagingRoot, 0o700);
    const session = await input.openCaptureSession();
    await captureAndStop(session, stagingRoot);
    await captureLock.assertOwned();
    const manifestText = await readFile(
      screenshotCandidatePath(stagingRoot, screenshotManifestPath),
      "utf8",
    );
    await input.verifyCandidates(stagingRoot, manifestText);
    await captureLock.assertOwned();
    try {
      await publishScreenshotArtifacts(
        { ...input, workspace: workspaceRealPath },
        stagingRoot,
      );
    } catch (error: unknown) {
      preserveStaging =
        error instanceof IncompleteScreenshotRollbackError &&
        error.preserveStaging;
      throw error;
    }
    publicationCommitted = true;
    await captureLock.assertOwned();
  } catch (error: unknown) {
    operationFailed = true;
    operationError = error;
  }

  const cleanupErrors: unknown[] = [];
  let stagingCleanupUnproven = false;
  if (stagingRoot !== null && !preserveStaging) {
    try {
      await (input.cleanupStaging ??
        (async (path: string) => {
          await rm(path, { force: true, recursive: true });
        }))(stagingRoot);
      await assertPathAbsent(stagingRoot);
    } catch (cleanupError: unknown) {
      stagingCleanupUnproven = true;
      cleanupErrors.push(cleanupError);
    }
  }

  const preserveLock = preserveStaging || cleanupErrors.length > 0;
  if (!preserveLock) {
    try {
      await captureLock.release();
    } catch (lockReleaseError: unknown) {
      cleanupErrors.push(lockReleaseError);
    }
  }

  if (publicationCommitted && (operationFailed || cleanupErrors.length > 0)) {
    if (stagingRoot === null) {
      throw new AggregateError(
        [...(operationFailed ? [operationError] : []), ...cleanupErrors],
        "Screenshot publication committed without a staging path.",
      );
    }
    throw new ScreenshotPublicationCommittedCleanupError(
      [...(operationFailed ? [operationError] : []), ...cleanupErrors],
      {
        lockPath: captureLock.path,
        stagingPreserved: stagingCleanupUnproven,
        stagingRoot,
      },
    );
  }
  if (operationFailed) {
    if (cleanupErrors.length > 0) {
      throw aggregateOperationAndCleanupErrors(
        operationError,
        cleanupErrors,
        {
          lockPath: captureLock.path,
          stagingCleanupUnproven,
          stagingRoot,
        },
      );
    }
    throw operationError;
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      "Screenshot capture cleanup failed before completion.",
    );
  }
}
