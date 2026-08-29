import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { resolve } from "node:path";

const gitShaPattern = /^[0-9a-f]{40}$/u;
const isoTimestampPattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/u;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const liveEvalSourcePathspecs = [
  "evals",
  "src",
  "drizzle",
  "scripts/ai",
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
] as const;

export type LiveEvalRepositoryState =
  | {
      baseHeadCommit: string;
      evaluatedCommit: string;
      worktreeState: "clean";
    }
  | {
      baseHeadCommit: string;
      evaluatedCommit: null;
      worktreeState: "dirty";
    }
  | {
      baseHeadCommit: null;
      evaluatedCommit: null;
      worktreeState: "unavailable";
    };

export type RepositoryCommandRunner = (
  args: readonly string[],
  workspace: string,
) => { ok: boolean; stdout: string };

export type LiveEvalSourceFingerprint =
  | {
      algorithm: "sha256";
      digest: string;
      fileCount: number;
      status: "captured";
    }
  | {
      algorithm: "sha256";
      digest: null;
      fileCount: null;
      status: "unavailable" | "unstable";
    };

type ArchivableLiveEvalReport = {
  evaluatedAt: string;
  runId: string;
};

type PersistLiveEvalReportOptions = {
  latestLockRetryMs?: number;
  latestLockTimeoutMs?: number;
};

function unavailableRepositoryState(): LiveEvalRepositoryState {
  return {
    baseHeadCommit: null,
    evaluatedCommit: null,
    worktreeState: "unavailable",
  };
}

function unavailableSourceFingerprint(
  status: "unavailable" | "unstable" = "unavailable",
): LiveEvalSourceFingerprint {
  return {
    algorithm: "sha256",
    digest: null,
    fileCount: null,
    status,
  };
}

function runGitCommand(
  args: readonly string[],
  workspace: string,
): { ok: boolean; stdout: string } {
  const result = spawnSync("git", args, {
    cwd: workspace,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
      NO_COLOR: "1",
    },
    maxBuffer: 1024 * 1024,
    timeout: 5_000,
  });
  return {
    ok: result.error === undefined && result.status === 0,
    stdout: result.stdout ?? "",
  };
}

export function captureLiveEvalRepositoryState(
  workspace: string,
  runCommand: RepositoryCommandRunner = runGitCommand,
): LiveEvalRepositoryState {
  const head = runCommand(["rev-parse", "--verify", "HEAD"], workspace);
  const baseHeadCommit = head.stdout.trim();
  if (!head.ok || !gitShaPattern.test(baseHeadCommit)) {
    return unavailableRepositoryState();
  }

  const status = runCommand(
    ["status", "--porcelain=v1", "--untracked-files=normal"],
    workspace,
  );
  if (!status.ok) {
    return unavailableRepositoryState();
  }
  const confirmedHead = runCommand(
    ["rev-parse", "--verify", "HEAD"],
    workspace,
  );
  if (
    !confirmedHead.ok ||
    confirmedHead.stdout.trim() !== baseHeadCommit
  ) {
    return unavailableRepositoryState();
  }

  if (status.stdout.length > 0) {
    return {
      baseHeadCommit,
      evaluatedCommit: null,
      worktreeState: "dirty",
    };
  }

  return {
    baseHeadCommit,
    evaluatedCommit: baseHeadCommit,
    worktreeState: "clean",
  };
}

export function reconcileLiveEvalRepositoryStates(
  before: LiveEvalRepositoryState,
  after: LiveEvalRepositoryState,
): LiveEvalRepositoryState {
  if (
    before.worktreeState === "unavailable" ||
    after.worktreeState === "unavailable" ||
    before.baseHeadCommit !== after.baseHeadCommit
  ) {
    return unavailableRepositoryState();
  }
  if (
    before.worktreeState === "clean" &&
    after.worktreeState === "clean"
  ) {
    return {
      baseHeadCommit: before.baseHeadCommit,
      evaluatedCommit: before.baseHeadCommit,
      worktreeState: "clean",
    };
  }
  return {
    baseHeadCommit: before.baseHeadCommit,
    evaluatedCommit: null,
    worktreeState: "dirty",
  };
}

function isSafeRepositoryRelativePath(path: string): boolean {
  return path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    !path.includes("\uFFFD") &&
    !path.split("/").includes("..");
}

function encodeLength(value: number): Buffer {
  const encoded = Buffer.alloc(8);
  encoded.writeBigUInt64BE(BigInt(value));
  return encoded;
}

export async function captureLiveEvalSourceFingerprint(
  workspace: string,
  runCommand: RepositoryCommandRunner = runGitCommand,
): Promise<LiveEvalSourceFingerprint> {
  const tracked = runCommand(
    ["ls-files", "-z", "--", ...liveEvalSourcePathspecs],
    workspace,
  );
  const untracked = runCommand(
    [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ...liveEvalSourcePathspecs,
    ],
    workspace,
  );
  if (!tracked.ok || !untracked.ok) {
    return unavailableSourceFingerprint();
  }

  const paths = [...new Set(
    `${tracked.stdout}${untracked.stdout}`
      .split("\0")
      .filter((path) => path.length > 0),
  )].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  if (paths.some((path) => !isSafeRepositoryRelativePath(path))) {
    return unavailableSourceFingerprint();
  }

  const hash = createHash("sha256");
  hash.update("diesel-live-eval-source-v1\0", "utf8");
  let fileCount = 0;
  try {
    for (const path of paths) {
      const absolutePath = resolve(workspace, ...path.split("/"));
      try {
        const sourceStats = await lstat(absolutePath);
        if (!sourceStats.isFile()) {
          return unavailableSourceFingerprint();
        }
      } catch (error: unknown) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          continue;
        }
        throw error;
      }
      const pathBytes = Buffer.from(path, "utf8");
      const sourceBytes = await readFile(absolutePath);
      hash.update(encodeLength(pathBytes.byteLength));
      hash.update(pathBytes);
      hash.update(encodeLength(sourceBytes.byteLength));
      hash.update(sourceBytes);
      fileCount += 1;
    }
  } catch {
    return unavailableSourceFingerprint();
  }

  if (fileCount === 0) {
    return unavailableSourceFingerprint();
  }

  return {
    algorithm: "sha256",
    digest: hash.digest("hex"),
    fileCount,
    status: "captured",
  };
}

export function reconcileLiveEvalSourceFingerprints(
  before: LiveEvalSourceFingerprint,
  after: LiveEvalSourceFingerprint,
): LiveEvalSourceFingerprint {
  if (before.status !== "captured" || after.status !== "captured") {
    return unavailableSourceFingerprint();
  }
  if (
    before.digest !== after.digest ||
    before.fileCount !== after.fileCount
  ) {
    return unavailableSourceFingerprint("unstable");
  }
  return before;
}

export function formatLiveEvalArchiveFilename(
  evaluatedAt: string,
  runId: string,
): string {
  const timestamp = isoTimestampPattern.exec(evaluatedAt);
  if (!timestamp || !uuidPattern.test(runId)) {
    throw new Error("Live eval report has invalid archive identity fields.");
  }
  const [, year, month, day, hour, minute, second, millisecond] = timestamp;
  return `ai-live-eval-${year}${month}${day}T${hour}${minute}${second}${millisecond}Z-${runId}.json`;
}

export function resolveLiveEvalLatestReportPath(workspace: string): string {
  return resolve(workspace, "docs/evals/ai-live-eval-latest.json");
}

export function resolveLiveEvalArchiveReportPath(
  workspace: string,
  report: ArchivableLiveEvalReport,
): string {
  return resolve(
    workspace,
    "docs/evals/archive",
    formatLiveEvalArchiveFilename(report.evaluatedAt, report.runId),
  );
}

export async function verifyLiveEvalArchiveMatchesLatest(
  workspace: string,
  report: ArchivableLiveEvalReport,
  latestReportText: string,
): Promise<void> {
  const archivedReportText = await readFile(
    resolveLiveEvalArchiveReportPath(workspace, report),
    "utf8",
  );
  if (archivedReportText !== latestReportText) {
    throw new Error(
      "The latest live eval report does not byte-match its append-only archive.",
    );
  }
}

async function writeSyncedExclusive(path: string, contents: string): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function publishArchiveWithoutOverwrite(
  temporaryPath: string,
  archivePath: string,
): Promise<void> {
  await link(temporaryPath, archivePath);
}

function latestIdentity(reportText: string): { evaluatedAt: string; runId: string } {
  const parsed: unknown = JSON.parse(reportText);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Existing live eval latest report has an invalid identity.");
  }
  const record = parsed as Record<string, unknown>;
  const evaluatedAt = record.evaluatedAt;
  const runId = record.runId;
  if (
    typeof evaluatedAt !== "string" ||
    !isoTimestampPattern.test(evaluatedAt) ||
    (runId !== undefined &&
      (typeof runId !== "string" || !uuidPattern.test(runId)))
  ) {
    throw new Error("Existing live eval latest report has an invalid identity.");
  }
  return { evaluatedAt, runId: typeof runId === "string" ? runId : "" };
}

function reportIsNewer(
  candidate: ArchivableLiveEvalReport,
  current: { evaluatedAt: string; runId: string },
): boolean {
  return candidate.evaluatedAt > current.evaluatedAt ||
    (candidate.evaluatedAt === current.evaluatedAt &&
      candidate.runId > current.runId);
}

async function acquireLatestLock(
  lockPath: string,
  options: PersistLiveEvalReportOptions,
): Promise<() => Promise<void>> {
  const retryMs = options.latestLockRetryMs ?? 10;
  const timeoutMs = options.latestLockTimeoutMs ?? 5_000;
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      await mkdir(lockPath);
      return async () => rm(lockPath, { recursive: true });
    } catch (error: unknown) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "EEXIST" ||
        Date.now() >= deadline
      ) {
        throw error;
      }
      await new Promise<void>((resolveDelay) => {
        setTimeout(resolveDelay, retryMs);
      });
    }
  }
}

export async function persistLiveEvalReport<
  Report extends ArchivableLiveEvalReport,
>(
  workspace: string,
  report: Report,
  options: PersistLiveEvalReportOptions = {},
): Promise<{ archivePath: string; latestPath: string; latestUpdated: boolean }> {
  const latestPath = resolveLiveEvalLatestReportPath(workspace);
  const archivePath = resolveLiveEvalArchiveReportPath(workspace, report);
  const evalDirectory = resolve(workspace, "docs/evals");
  const archiveTemporaryPath = resolve(
    evalDirectory,
    "archive",
    `.ai-live-eval-archive-${report.runId}.tmp`,
  );
  const latestTemporaryPath = resolve(
    evalDirectory,
    `.ai-live-eval-latest-${report.runId}.tmp`,
  );
  const latestLockPath = resolve(evalDirectory, ".ai-live-eval-latest.lock");
  const serialized = `${JSON.stringify(report, null, 2)}\n`;

  await mkdir(resolve(evalDirectory, "archive"), { recursive: true });
  try {
    await writeSyncedExclusive(archiveTemporaryPath, serialized);
    await publishArchiveWithoutOverwrite(archiveTemporaryPath, archivePath);
  } finally {
    await rm(archiveTemporaryPath, { force: true });
  }

  const releaseLock = await acquireLatestLock(latestLockPath, options);
  let latestUpdated = false;
  try {
    let shouldUpdateLatest = true;
    try {
      const currentIdentity = latestIdentity(await readFile(latestPath, "utf8"));
      shouldUpdateLatest = reportIsNewer(report, currentIdentity);
    } catch (error: unknown) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error;
      }
    }
    if (shouldUpdateLatest) {
      try {
        await writeSyncedExclusive(latestTemporaryPath, serialized);
        await rename(latestTemporaryPath, latestPath);
        latestUpdated = true;
      } finally {
        await rm(latestTemporaryPath, { force: true });
      }
    }
  } finally {
    await releaseLock();
  }

  return { archivePath, latestPath, latestUpdated };
}
