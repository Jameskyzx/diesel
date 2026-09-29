import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants as fsConstants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { resolve } from "node:path";

const gitShaPattern = /^[0-9a-f]{40}$/u;
const isoTimestampPattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/u;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const modernArchiveFilenamePattern =
  /^ai-live-eval-(\d{8}T\d{9}Z)-([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/iu;
const legacyLiveEvalArchiveFilenames = new Set([
  "ai-live-eval-2026-08-14-scorer-v1-flawed.json",
  "ai-live-eval-2026-08-19-v2-passed-legacy.json",
  "ai-live-eval-2026-08-20-v2-first-run-failed.json",
  "ai-live-eval-2026-08-20-v2-second-run-source-query-failed.json",
  "ai-live-eval-2026-08-20-v2-third-run-tokenization-failed.json",
]);
const trustedLiveEvalGitBinaries = [
  "/usr/bin/git",
  "/bin/git",
  "/usr/sbin/git",
  "/sbin/git",
] as const;
const trustedLiveEvalExecutablePath = [
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
].join(":");
const liveEvalSourcePathspecs = [
  "evals",
  "src",
  "drizzle",
  "scripts/ai",
  "scripts/portfolio",
  ".nvmrc",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "vitest.config.ts",
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

export type RepositoryBinaryCommandRunner = (
  args: readonly string[],
  workspace: string,
) => { ok: boolean; stdout: Buffer };

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

export type LiveEvalReportReceipt = {
  byteLength: number;
  evaluatedAt: string;
  runId: string;
  sha256: string;
};

export type PersistedLiveEvalReport = {
  archivePath: string;
  latestPath: string;
  latestUpdated: boolean;
  reportReceipt: LiveEvalReportReceipt;
};

type PersistLiveEvalReportOptions = {
  afterDirectorySync?: (path: string) => Promise<void> | void;
  latestLockRetryMs?: number;
  latestLockTimeoutMs?: number;
};

export function liveEvalRunCanSucceed(input: {
  latestUpdated: boolean;
  thresholdsPassed: boolean;
}): boolean {
  return input.latestUpdated && input.thresholdsPassed;
}

export function serializeCanonicalLiveEvalJson(value: unknown): string {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized === undefined) {
    throw new Error("Live eval JSON must serialize to a defined value.");
  }
  return `${serialized}\n`;
}

export function parseCanonicalLiveEvalJson(
  reportText: string,
  label = "Live eval report",
): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(reportText);
  } catch {
    throw new Error(`${label} has invalid JSON.`);
  }
  if (serializeCanonicalLiveEvalJson(parsed) !== reportText) {
    throw new Error(`${label} does not use canonical JSON bytes.`);
  }
  return parsed;
}

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

export function isTrustedLiveEvalGitBinary(
  candidate: string,
): boolean {
  return (trustedLiveEvalGitBinaries as readonly string[]).includes(candidate);
}

export function resolveTrustedLiveEvalGitBinary(
  configuredGit: string | undefined = process.env.LIVE_EVAL_GIT_BINARY,
): string | null {
  const candidates = configuredGit === undefined
    ? trustedLiveEvalGitBinaries
    : isTrustedLiveEvalGitBinary(configuredGit)
    ? [configuredGit]
    : [];

  for (const candidate of candidates) {
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Continue through the fixed, absolute system-only candidate list.
    }
  }
  return null;
}

export function buildLiveEvalGitEnvironment(): NodeJS.ProcessEnv {
  return {
    GIT_ATTR_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
    LANG: "C",
    LC_ALL: "C",
    NO_COLOR: "1",
    NODE_ENV: "test",
    PAGER: "cat",
    PATH: trustedLiveEvalExecutablePath,
    XDG_CONFIG_HOME: "/dev/null",
  };
}

function runGitCommand(
  args: readonly string[],
  workspace: string,
): { ok: boolean; stdout: string } {
  const gitBinary = resolveTrustedLiveEvalGitBinary();
  if (gitBinary === null) {
    return { ok: false, stdout: "" };
  }
  const result = spawnSync(gitBinary, args, {
    cwd: workspace,
    encoding: "utf8",
    env: buildLiveEvalGitEnvironment(),
    maxBuffer: 1024 * 1024,
    timeout: 5_000,
  });
  return {
    ok: result.error === undefined && result.status === 0,
    stdout: result.stdout ?? "",
  };
}

function runGitBinaryCommand(
  args: readonly string[],
  workspace: string,
): { ok: boolean; stdout: Buffer } {
  const gitBinary = resolveTrustedLiveEvalGitBinary();
  if (gitBinary === null) {
    return { ok: false, stdout: Buffer.alloc(0) };
  }
  const result = spawnSync(gitBinary, args, {
    cwd: workspace,
    encoding: "buffer",
    env: buildLiveEvalGitEnvironment(),
    maxBuffer: 64 * 1024 * 1024,
    timeout: 10_000,
  });
  return {
    ok: result.error === undefined && result.status === 0,
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0),
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

export async function captureLiveEvalSourceFingerprintAtRevision(
  workspace: string,
  revision: string,
  runCommand: RepositoryCommandRunner = runGitCommand,
  runBinaryCommand: RepositoryBinaryCommandRunner = runGitBinaryCommand,
): Promise<LiveEvalSourceFingerprint> {
  if (!gitShaPattern.test(revision)) {
    return unavailableSourceFingerprint();
  }
  const resolved = runCommand(
    ["rev-parse", "--verify", `${revision}^{commit}`],
    workspace,
  );
  if (!resolved.ok || resolved.stdout.trim() !== revision) {
    return unavailableSourceFingerprint();
  }
  const tree = runBinaryCommand(
    ["ls-tree", "-r", "-z", revision, "--", ...liveEvalSourcePathspecs],
    workspace,
  );
  if (!tree.ok) {
    return unavailableSourceFingerprint();
  }
  const records = tree.stdout
    .toString("utf8")
    .split("\0")
    .filter((record) => record.length > 0);
  const entries: Array<{ objectId: string; path: string }> = [];
  for (const record of records) {
    const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/u.exec(record);
    const path = match?.[3];
    if (!match || !path || !isSafeRepositoryRelativePath(path)) {
      return unavailableSourceFingerprint();
    }
    entries.push({ objectId: match[2]!, path });
  }
  entries.sort((left, right) =>
    Buffer.compare(Buffer.from(left.path), Buffer.from(right.path))
  );
  if (
    entries.length === 0 ||
    new Set(entries.map(({ path }) => path)).size !== entries.length
  ) {
    return unavailableSourceFingerprint();
  }

  const hash = createHash("sha256");
  hash.update("diesel-live-eval-source-v1\0", "utf8");
  for (const entry of entries) {
    const blob = runBinaryCommand(
      ["show", `${revision}:${entry.path}`],
      workspace,
    );
    if (!blob.ok) {
      return unavailableSourceFingerprint();
    }
    const objectHash = createHash("sha1")
      .update(`blob ${blob.stdout.byteLength}\0`, "utf8")
      .update(blob.stdout)
      .digest("hex");
    if (objectHash !== entry.objectId) {
      return unavailableSourceFingerprint();
    }
    const pathBytes = Buffer.from(entry.path, "utf8");
    hash.update(encodeLength(pathBytes.byteLength));
    hash.update(pathBytes);
    hash.update(encodeLength(blob.stdout.byteLength));
    hash.update(blob.stdout);
  }

  return {
    algorithm: "sha256",
    digest: hash.digest("hex"),
    fileCount: entries.length,
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

function modernArchiveFilenameIdentity(
  filename: string,
): ArchivableLiveEvalReport | null {
  const match = modernArchiveFilenamePattern.exec(filename);
  if (!match) {
    if (filename.toLowerCase().startsWith("ai-live-eval-")) {
      throw new Error(`Modern live eval archive filename is malformed: ${filename}.`);
    }
    return null;
  }
  const compactTimestamp = match[1];
  const runId = match[2];
  if (!compactTimestamp || !runId) {
    throw new Error(`Modern live eval archive filename is malformed: ${filename}.`);
  }
  const identity = {
    evaluatedAt: `${compactTimestamp.slice(0, 4)}-${compactTimestamp.slice(4, 6)}-${compactTimestamp.slice(6, 8)}T${compactTimestamp.slice(9, 11)}:${compactTimestamp.slice(11, 13)}:${compactTimestamp.slice(13, 15)}.${compactTimestamp.slice(15, 18)}Z`,
    runId,
  };
  if (
    formatLiveEvalArchiveFilename(identity.evaluatedAt, identity.runId) !==
      filename
  ) {
    throw new Error(`Modern live eval archive filename is malformed: ${filename}.`);
  }
  return identity;
}

function verifyPreRunIdLegacyArchive(
  filename: string,
  reportText: string,
): void {
  const parsed = parseCanonicalLiveEvalJson(
    reportText,
    `Pre-run-ID live eval archive ${filename}`,
  );
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.hasOwn(parsed, "runId")
  ) {
    throw new Error(
      `Pre-run-ID live eval archive has an invalid legacy identity: ${filename}.`,
    );
  }
}

function modernArchiveReportIdentity(
  filename: string,
  reportText: string,
): ArchivableLiveEvalReport {
  const parsed = parseCanonicalLiveEvalJson(
    reportText,
    `Modern live eval archive ${filename}`,
  );
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `Modern live eval archive has an invalid report identity: ${filename}.`,
    );
  }
  const record = parsed as Record<string, unknown>;
  if (
    typeof record.evaluatedAt !== "string" ||
    !isoTimestampPattern.test(record.evaluatedAt) ||
    typeof record.runId !== "string" ||
    !uuidPattern.test(record.runId)
  ) {
    throw new Error(
      `Modern live eval archive has an invalid report identity: ${filename}.`,
    );
  }
  return { evaluatedAt: record.evaluatedAt, runId: record.runId };
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
  parseCanonicalLiveEvalJson(latestReportText, "Latest live eval report");

  const archiveDirectory = resolve(workspace, "docs/evals/archive");
  let newestArchiveIdentity: ArchivableLiveEvalReport | null = null;
  for (const filename of await readdir(archiveDirectory)) {
    if (legacyLiveEvalArchiveFilenames.has(filename)) {
      verifyPreRunIdLegacyArchive(
        filename,
        await readFile(resolve(archiveDirectory, filename), "utf8"),
      );
      continue;
    }
    const filenameIdentity = modernArchiveFilenameIdentity(filename);
    if (!filenameIdentity) {
      continue;
    }
    const archiveText = await readFile(
      resolve(archiveDirectory, filename),
      "utf8",
    );
    const archivedIdentity = modernArchiveReportIdentity(
      filename,
      archiveText,
    );
    if (
      archivedIdentity.evaluatedAt !== filenameIdentity.evaluatedAt ||
      archivedIdentity.runId !== filenameIdentity.runId
    ) {
      throw new Error(
        `Modern live eval archive filename does not match its report identity: ${filename}.`,
      );
    }
    if (
      newestArchiveIdentity === null ||
      reportIsNewer(archivedIdentity, newestArchiveIdentity)
    ) {
      newestArchiveIdentity = archivedIdentity;
    }
  }
  if (
    newestArchiveIdentity === null ||
    newestArchiveIdentity.evaluatedAt !== report.evaluatedAt ||
    newestArchiveIdentity.runId !== report.runId
  ) {
    throw new Error(
      "The latest live eval report is not the newest modern archive by evaluatedAt and runId.",
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

async function syncDirectory(
  path: string,
  options: PersistLiveEvalReportOptions,
): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  await options.afterDirectorySync?.(path);
}

async function publishArchiveWithoutOverwrite(
  temporaryPath: string,
  archivePath: string,
): Promise<void> {
  await link(temporaryPath, archivePath);
}

function latestIdentity(reportText: string): { evaluatedAt: string; runId: string } {
  const parsed = parseCanonicalLiveEvalJson(
    reportText,
    "Existing live eval latest report",
  );
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
): Promise<PersistedLiveEvalReport> {
  const latestPath = resolveLiveEvalLatestReportPath(workspace);
  const archivePath = resolveLiveEvalArchiveReportPath(workspace, report);
  const evalDirectory = resolve(workspace, "docs/evals");
  const archiveDirectory = resolve(evalDirectory, "archive");
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
  const serialized = serializeCanonicalLiveEvalJson(report);
  const reportReceipt: LiveEvalReportReceipt = {
    byteLength: Buffer.byteLength(serialized, "utf8"),
    evaluatedAt: report.evaluatedAt,
    runId: report.runId,
    sha256: createHash("sha256").update(serialized, "utf8").digest("hex"),
  };

  await mkdir(archiveDirectory, { recursive: true });
  await syncDirectory(evalDirectory, options);
  let archiveLinked = false;
  try {
    await writeSyncedExclusive(archiveTemporaryPath, serialized);
    await publishArchiveWithoutOverwrite(archiveTemporaryPath, archivePath);
    archiveLinked = true;
    await syncDirectory(archiveDirectory, options);
  } finally {
    await rm(archiveTemporaryPath, { force: true });
    if (archiveLinked) {
      await syncDirectory(archiveDirectory, options);
    }
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
        await syncDirectory(evalDirectory, options);
        latestUpdated = true;
      } finally {
        await rm(latestTemporaryPath, { force: true });
      }
    }
  } finally {
    await releaseLock();
  }

  return { archivePath, latestPath, latestUpdated, reportReceipt };
}
