import { createHash } from "node:crypto";
import {
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { isAbsolute, normalize, posix, resolve, sep } from "node:path";

import {
  formatLiveEvalArchiveFilename,
  parseCanonicalLiveEvalJson,
} from "../ai/live-eval-report";
import { parseScreenshotManifest } from "./screenshot-manifest";
import {
  developmentHistoryAuditPath,
  retainedHistorySecretScanPaths,
} from "../history/verify-development-history";
import { retainedDependencyLicensePaths } from "../history/retained-dependency-licenses";
import { runTrustedGit as runGit, runTrustedGitRaw as runGitRaw } from "./trusted-git";

const MAX_EVIDENCE_FILE_BYTES = 32 * 1024 * 1024;
const gitObjectIdPattern =
  /^(?!(?:0{40}|0{64})$)(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const modernLiveEvalArchiveFilenamePattern =
  /^ai-live-eval-\d{8}T\d{9}Z-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/iu;
const legacyLiveEvalArchiveFilenames = new Set([
  "ai-live-eval-2026-08-14-scorer-v1-flawed.json",
  "ai-live-eval-2026-08-19-v2-passed-legacy.json",
  "ai-live-eval-2026-08-20-v2-first-run-failed.json",
  "ai-live-eval-2026-08-20-v2-second-run-source-query-failed.json",
  "ai-live-eval-2026-08-20-v2-third-run-tokenization-failed.json",
]);
const regularGitModes = new Set(["100644", "100755"]);

export const portfolioReleaseEvidenceEntrypoints = {
  liveEvalLatestPath: "docs/evals/ai-live-eval-latest.json",
  playwrightEvidencePath: "docs/evidence/playwright-e2e-latest.json",
  screenshotManifestPath: "public/portfolio/screenshots.manifest.json",
} as const;

export const portfolioReleaseEvidenceExplicitPaths = [
  ".nvmrc",
  "README.md",
  "README.zh-CN.md",
  "docs/ARCHITECTURE.md",
  "docs/DEMO.md",
  "docs/DEVELOPMENT_HISTORY.md",
  "docs/evidence/fde-development-history-human-review-2026-09-12.md",
  "docs/evals/README.md",
  "docs/FDE_CASE_STUDY.md",
  "docs/STATUS.md",
  developmentHistoryAuditPath,
  ...retainedHistorySecretScanPaths,
  ...retainedDependencyLicensePaths,
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "vitest.config.ts",
] as const;

export const releaseEvidenceModeFlag = "--release-evidence" as const;

export function parseReleaseEvidenceModeArguments(
  rawArguments: readonly string[],
): boolean {
  if (rawArguments.length === 1 && rawArguments[0] === "--") {
    throw new Error(
      `Portfolio verification accepts only the optional ${releaseEvidenceModeFlag} flag.`,
    );
  }
  const argumentsWithoutSeparator = rawArguments[0] === "--"
    ? rawArguments.slice(1)
    : [...rawArguments];
  if (argumentsWithoutSeparator.length === 0) return false;
  if (
    argumentsWithoutSeparator.length === 1 &&
    argumentsWithoutSeparator[0] === releaseEvidenceModeFlag
  ) {
    return true;
  }
  throw new Error(
    `Portfolio verification accepts only the optional ${releaseEvidenceModeFlag} flag.`,
  );
}

export type ReleaseEvidenceExpectedHeadBindingInput = {
  configuredSha?: string;
  githubActions: boolean;
  githubSha?: string;
  releaseEvidenceMode: boolean;
};

/**
 * Resolves the immutable event commit that a GitHub release-evidence run must
 * verify. Local and non-release verification intentionally have no event bind.
 */
export function resolveReleaseEvidenceExpectedHead({
  configuredSha,
  githubActions,
  githubSha,
  releaseEvidenceMode,
}: ReleaseEvidenceExpectedHeadBindingInput): string | undefined {
  if (!githubActions || !releaseEvidenceMode) return undefined;
  if (githubSha === undefined || !gitObjectIdPattern.test(githubSha)) {
    throw new Error(
      "GitHub release evidence requires a full SHA-1 or SHA-256 GITHUB_SHA.",
    );
  }
  if (configuredSha === undefined || !gitObjectIdPattern.test(configuredSha)) {
    throw new Error(
      "GitHub release evidence requires a full SHA-1 or SHA-256 configured commit.",
    );
  }
  if (githubSha !== configuredSha) {
    throw new Error(
      "GitHub release evidence GITHUB_SHA does not match its configured commit.",
    );
  }
  return githubSha;
}

export type ReleaseEvidenceReadinessInput = {
  /** Conservatively binds every regular tracked repository file as a Vitest input. */
  bindVitestExecutionInputs?: boolean;
  /** Additional evidence files whose exact HEAD bytes must be published. */
  explicitPaths?: readonly string[];
  /** Optional immutable event commit that HEAD must equal throughout the check. */
  expectedHeadCommit?: string;
  /** Adds all HEAD archives and proves append-only ancestry for the latest report. */
  liveEvalLatestPath?: string;
  /** Adds the manifest and every screenshot path declared by it. */
  screenshotManifestPath?: string;
  /** Adds the checked-in Playwright evidence document. */
  playwrightEvidencePath?: string;
  workspace: string;
};

export type VerifiedReleaseEvidencePath = {
  byteLength: number;
  path: string;
  sha256: string;
};

export type ReleaseEvidenceReadiness = {
  dynamicPaths: {
    liveEvalArchivePath: string | null;
    screenshotAssetPaths: string[];
    screenshotSourcePaths: string[];
    vitestExecutionInputPaths: string[];
  };
  headCommit: string;
  paths: VerifiedReleaseEvidencePath[];
};

type GitTreeEntry = {
  mode: string;
  objectId: string;
  path: string;
  type: "blob" | "commit" | "tree";
};

type GitIndexEntry = {
  mode: string;
  objectId: string;
  path: string;
  stage: number;
};

type GitCommitGraphEntry = {
  commit: string;
  parents: string[];
};

function assertGitObjectId(value: string, label: string): string {
  if (!gitObjectIdPattern.test(value)) {
    throw new Error(`${label} must be a full lowercase SHA-1 or SHA-256 object ID.`);
  }
  return value;
}

function splitNulTerminatedGitRecords(
  output: Buffer,
  label: string,
): Buffer[] {
  if (output.byteLength === 0) return [];
  if (output[output.byteLength - 1] !== 0) {
    throw new Error(`${label} did not return NUL-terminated records.`);
  }
  const records: Buffer[] = [];
  let offset = 0;
  while (offset < output.byteLength) {
    const terminator = output.indexOf(0, offset);
    if (terminator === -1) {
      throw new Error(`${label} returned a truncated record.`);
    }
    if (terminator > offset) records.push(output.subarray(offset, terminator));
    offset = terminator + 1;
  }
  return records;
}

function decodeGitUtf8(value: Buffer, label: string): string {
  const decoded = value.toString("utf8");
  if (!Buffer.from(decoded, "utf8").equals(value)) {
    throw new Error(`${label} contains a non-UTF-8 path.`);
  }
  return decoded;
}

function splitGitRecord(
  record: Buffer,
  label: string,
): { header: string; path: string } {
  const separator = record.indexOf(0x09);
  if (separator <= 0 || separator === record.byteLength - 1) {
    throw new Error(`${label} returned an invalid path record.`);
  }
  const header = decodeGitUtf8(record.subarray(0, separator), label);
  const path = assertRepositoryRelativeEvidencePath(
    decodeGitUtf8(record.subarray(separator + 1), label),
  );
  return { header, path };
}

function listTreeEntriesAtCommit(
  workspace: string,
  commit: string,
  pathspec: string,
): GitTreeEntry[] {
  const safeCommit = assertGitObjectId(commit, "Git tree commit");
  const safePathspec = assertRepositoryRelativeEvidencePath(pathspec);
  const output = runGit(workspace, [
    "ls-tree",
    "-r",
    "-z",
    "--full-tree",
    safeCommit,
    "--",
    safePathspec,
  ]);
  return splitNulTerminatedGitRecords(output, "git ls-tree").map((record) => {
    const { header, path } = splitGitRecord(record, "git ls-tree");
    const match = /^(\d{6}) (blob|commit|tree) ([0-9a-f]+)$/u.exec(header);
    if (!match) throw new Error("git ls-tree returned invalid entry metadata.");
    const [, mode, type, objectId] = match;
    if (mode === undefined || type === undefined || objectId === undefined) {
      throw new Error("git ls-tree returned incomplete entry metadata.");
    }
    return {
      mode,
      objectId: assertGitObjectId(objectId, "Git tree object"),
      path,
      type: type as GitTreeEntry["type"],
    };
  });
}

function listAllTreeEntriesAtCommit(
  workspace: string,
  commit: string,
): GitTreeEntry[] {
  const safeCommit = assertGitObjectId(commit, "Git tree commit");
  const output = runGit(workspace, [
    "ls-tree",
    "-r",
    "-z",
    "--full-tree",
    safeCommit,
  ]);
  return splitNulTerminatedGitRecords(output, "git ls-tree").map((record) => {
    const { header, path } = splitGitRecord(record, "git ls-tree");
    const match = /^(\d{6}) (blob|commit|tree) ([0-9a-f]+)$/u.exec(header);
    if (!match) throw new Error("git ls-tree returned invalid entry metadata.");
    const [, mode, type, objectId] = match;
    if (mode === undefined || type === undefined || objectId === undefined) {
      throw new Error("git ls-tree returned incomplete entry metadata.");
    }
    return {
      mode,
      objectId: assertGitObjectId(objectId, "Git tree object"),
      path,
      type: type as GitTreeEntry["type"],
    };
  });
}

function listIndexEntries(
  workspace: string,
  pathspec: string,
): GitIndexEntry[] {
  const safePathspec = assertRepositoryRelativeEvidencePath(pathspec);
  const output = runGit(workspace, [
    "ls-files",
    "--stage",
    "-z",
    "--",
    safePathspec,
  ]);
  return splitNulTerminatedGitRecords(output, "git ls-files").map((record) => {
    const { header, path } = splitGitRecord(record, "git ls-files");
    const match = /^(\d{6}) ([0-9a-f]+) ([0-3])$/u.exec(header);
    if (!match) throw new Error("git ls-files returned invalid entry metadata.");
    const [, mode, objectId, stageText] = match;
    if (mode === undefined || objectId === undefined || stageText === undefined) {
      throw new Error("git ls-files returned incomplete entry metadata.");
    }
    return {
      mode,
      objectId: assertGitObjectId(objectId, "Git index object"),
      path,
      stage: Number(stageText),
    };
  });
}

function comparePaths(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function assertRepositoryRelativeEvidencePath(path: string): string {
  if (
    path.length === 0 ||
    path.length > 500 ||
    path.startsWith("/") ||
    path.startsWith("-") ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.includes(":") ||
    /[\u0000-\u001f\u007f]/u.test(path) ||
    posix.normalize(path) !== path ||
    path.split("/").some((segment) =>
      segment === "" || segment === "." || segment === ".." || segment === ".git"
    )
  ) {
    throw new Error(`Unsafe repository-relative evidence path: ${path}`);
  }
  return path;
}

function readContainedRegularFile(workspace: string, path: string): Buffer {
  const safePath = assertRepositoryRelativeEvidencePath(path);
  const absolutePath = resolve(workspace, safePath);
  const workspacePrefix = `${workspace}${sep}`;
  if (!absolutePath.startsWith(workspacePrefix)) {
    throw new Error(`Evidence path escaped the repository: ${safePath}`);
  }
  let metadata;
  try {
    metadata = lstatSync(absolutePath);
  } catch {
    throw new Error(`Evidence path is missing from the working tree: ${safePath}`);
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Evidence path is not a regular file: ${safePath}`);
  }
  const physicalPath = realpathSync(absolutePath);
  if (!physicalPath.startsWith(workspacePrefix)) {
    throw new Error(`Evidence path escaped the repository through a symlink: ${safePath}`);
  }
  if (physicalPath !== absolutePath) {
    throw new Error(`Evidence path traverses a symbolic link: ${safePath}`);
  }
  if (metadata.size > MAX_EVIDENCE_FILE_BYTES) {
    throw new Error(`Evidence path exceeds the 32 MiB limit: ${safePath}`);
  }
  return readFileSync(absolutePath);
}

function parseLiveEvalArchivePath(
  latestPath: string,
  latestBytes: Buffer,
): string {
  const latestText = latestBytes.toString("utf8");
  const parsed = parseCanonicalLiveEvalJson(
    latestText,
    "Release live eval latest report",
  );
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Release live eval latest report has no report identity.");
  }
  const record = parsed as Record<string, unknown>;
  if (
    typeof record.evaluatedAt !== "string" ||
    typeof record.runId !== "string"
  ) {
    throw new Error("Release live eval latest report has no report identity.");
  }
  const filename = formatLiveEvalArchiveFilename(
    record.evaluatedAt,
    record.runId,
  );
  return assertRepositoryRelativeEvidencePath(
    posix.join(posix.dirname(latestPath), "archive", filename),
  );
}

function parseScreenshotDependencies(
  manifestBytes: Buffer,
): { assetPaths: string[]; sourcePaths: string[] } {
  let json: unknown;
  try {
    json = JSON.parse(manifestBytes.toString("utf8")) as unknown;
  } catch {
    throw new Error("Release screenshot manifest has invalid JSON.");
  }
  const manifest = parseScreenshotManifest(json);
  const canonical = `${JSON.stringify(manifest, null, 2)}\n`;
  if (!manifestBytes.equals(Buffer.from(canonical, "utf8"))) {
    throw new Error("Release screenshot manifest does not use canonical JSON bytes.");
  }
  return {
    assetPaths: manifest.assets.map(({ path }) =>
      assertRepositoryRelativeEvidencePath(path)
    ),
    sourcePaths: [...new Set(manifest.assets.flatMap(({ sourceFiles }) =>
      sourceFiles.map(assertRepositoryRelativeEvidencePath)
    ))].sort(comparePaths),
  };
}

function readAbsoluteGitDirectory(
  workspace: string,
  argument: "--git-common-dir" | "--git-dir",
): string {
  const output = runGit(workspace, [
    "rev-parse",
    "--path-format=absolute",
    argument,
  ]).toString("utf8");
  if (output.includes("\0") || output.includes("\r")) {
    throw new Error(`git rev-parse ${argument} returned control characters.`);
  }
  const directory = output.endsWith("\n") ? output.slice(0, -1) : output;
  if (
    directory.length === 0 ||
    directory.includes("\n") ||
    !isAbsolute(directory) ||
    normalize(directory) !== directory
  ) {
    throw new Error(`git rev-parse ${argument} returned a noncanonical path.`);
  }
  let physicalDirectory: string;
  let metadata: ReturnType<typeof lstatSync>;
  try {
    physicalDirectory = realpathSync(directory);
    metadata = lstatSync(physicalDirectory);
  } catch (cause: unknown) {
    throw new Error(`Git ${argument} could not be resolved.`, { cause });
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`Git ${argument} is not a regular directory.`);
  }
  return physicalDirectory;
}

function assertNoLegacyGitGrafts(workspace: string): void {
  const gitDirectories = new Set([
    readAbsoluteGitDirectory(workspace, "--git-dir"),
    readAbsoluteGitDirectory(workspace, "--git-common-dir"),
  ]);
  for (const directory of gitDirectories) {
    const graftsPath = resolve(directory, "info/grafts");
    try {
      lstatSync(graftsPath);
    } catch (cause: unknown) {
      if (
        typeof cause === "object" &&
        cause !== null &&
        "code" in cause &&
        cause.code === "ENOENT"
      ) {
        continue;
      }
      throw new Error(`Legacy Git graft path could not be inspected: ${graftsPath}`, {
        cause,
      });
    }
    throw new Error(
      `Release evidence rejects legacy Git grafts: ${graftsPath}`,
    );
  }
}

function assertIndexHasDefaultVisibilityFlags(workspace: string): void {
  const output = runGit(workspace, ["ls-files", "-v", "-z"]);
  for (const record of splitNulTerminatedGitRecords(output, "git ls-files -v")) {
    if (record.byteLength < 3 || record[1] !== 0x20) {
      throw new Error("git ls-files -v returned an invalid index record.");
    }
    const tag = String.fromCharCode(record[0]!);
    const path = assertRepositoryRelativeEvidencePath(
      decodeGitUtf8(record.subarray(2), "git ls-files -v"),
    );
    if (tag === "S" || tag === "s") {
      throw new Error(`Git index uses skip-worktree for release input: ${path}`);
    }
    if (tag >= "a" && tag <= "z") {
      throw new Error(`Git index uses assume-unchanged for release input: ${path}`);
    }
  }
}

function stagedPathsWithinLiveEvalScope(
  workspace: string,
  headCommit: string,
  latestPath: string,
): string[] {
  const archiveDirectory = posix.join(posix.dirname(latestPath), "archive");
  const output = runGit(workspace, [
    "diff",
    "--no-ext-diff",
    "--cached",
    "--name-only",
    "-z",
    headCommit,
    "--",
    latestPath,
    archiveDirectory,
  ]);
  return splitNulTerminatedGitRecords(output, "git diff").map((record) =>
    assertRepositoryRelativeEvidencePath(
      decodeGitUtf8(record, "git diff"),
    )
  );
}

function assertLiveEvalPairIsNotPartiallyStaged(
  workspace: string,
  headCommit: string,
  latestPath: string,
  archivePath: string,
): void {
  const staged = stagedPathsWithinLiveEvalScope(
    workspace,
    headCommit,
    latestPath,
  );
  const archivePrefix = `${posix.join(posix.dirname(latestPath), "archive")}/`;
  const latestStaged = staged.includes(latestPath);
  const stagedArchives = staged.filter((path) => path.startsWith(archivePrefix));
  if (latestStaged && !stagedArchives.includes(archivePath)) {
    throw new Error(
      `Live eval latest is staged without its selected archive: ${archivePath}`,
    );
  }
  if (!latestStaged && stagedArchives.length > 0) {
    throw new Error(
      `Live eval archive is staged without its latest report: ${stagedArchives[0]}`,
    );
  }
  const unrelatedArchive = stagedArchives.find((path) => path !== archivePath);
  if (unrelatedArchive !== undefined) {
    throw new Error(
      `Live eval staging contains an archive not selected by latest: ${unrelatedArchive}`,
    );
  }
}

function liveEvalArchiveDirectory(latestPath: string): string {
  return assertRepositoryRelativeEvidencePath(
    posix.join(posix.dirname(latestPath), "archive"),
  );
}

function isPublishedLiveEvalArchiveFilename(filename: string): boolean {
  return legacyLiveEvalArchiveFilenames.has(filename) ||
    modernLiveEvalArchiveFilenamePattern.test(filename);
}

function isPublishedLiveEvalArchivePath(
  archiveDirectory: string,
  path: string,
): boolean {
  return posix.dirname(path) === archiveDirectory &&
    isPublishedLiveEvalArchiveFilename(posix.basename(path));
}

function assertRegularTreeEntry(entry: GitTreeEntry, label: string): void {
  if (entry.type !== "blob" || !regularGitModes.has(entry.mode)) {
    throw new Error(`${label} is not a regular Git file: ${entry.path}`);
  }
}

function listCurrentHeadArchiveEntries(
  workspace: string,
  headCommit: string,
  archiveDirectory: string,
): Map<string, GitTreeEntry> {
  const entries = listTreeEntriesAtCommit(
    workspace,
    headCommit,
    archiveDirectory,
  );
  const byPath = new Map<string, GitTreeEntry>();
  for (const entry of entries) {
    if (!isPublishedLiveEvalArchivePath(archiveDirectory, entry.path)) {
      throw new Error(
        `Live eval archive HEAD tree contains a temporary, nested, or malformed entry: ${entry.path}`,
      );
    }
    assertRegularTreeEntry(entry, "Live eval archive HEAD entry");
    if (byPath.has(entry.path)) {
      throw new Error(`Live eval archive HEAD tree contains a duplicate path: ${entry.path}`);
    }
    byPath.set(entry.path, entry);
  }
  return byPath;
}

function assertCurrentArchiveIndexInventory(
  workspace: string,
  archiveDirectory: string,
  headEntries: ReadonlyMap<string, GitTreeEntry>,
): void {
  const indexEntries = listIndexEntries(workspace, archiveDirectory);
  const byPath = new Map<string, GitIndexEntry>();
  for (const entry of indexEntries) {
    if (!isPublishedLiveEvalArchivePath(archiveDirectory, entry.path)) {
      throw new Error(
        `Live eval archive index contains a temporary, nested, or malformed entry: ${entry.path}`,
      );
    }
    if (entry.stage !== 0 || !regularGitModes.has(entry.mode)) {
      throw new Error(`Live eval archive index entry is not a regular stage-0 file: ${entry.path}`);
    }
    if (byPath.has(entry.path)) {
      throw new Error(`Live eval archive index contains a duplicate or conflicted path: ${entry.path}`);
    }
    byPath.set(entry.path, entry);
  }
  for (const [path, headEntry] of headEntries) {
    const indexEntry = byPath.get(path);
    if (indexEntry === undefined) {
      throw new Error(`Git index does not contain HEAD live eval archive: ${path}`);
    }
    if (
      indexEntry.mode !== headEntry.mode ||
      indexEntry.objectId !== headEntry.objectId
    ) {
      throw new Error(`Git index differs from HEAD for live eval archive: ${path}`);
    }
  }
  for (const path of byPath.keys()) {
    if (!headEntries.has(path)) {
      throw new Error(`Git index contains a live eval archive not published by HEAD: ${path}`);
    }
  }
}

function assertCurrentArchiveWorktreeInventory(
  workspace: string,
  archiveDirectory: string,
  headEntries: ReadonlyMap<string, GitTreeEntry>,
): void {
  const absoluteDirectory = resolve(workspace, archiveDirectory);
  const workspacePrefix = `${workspace}${sep}`;
  if (!absoluteDirectory.startsWith(workspacePrefix)) {
    throw new Error("Live eval archive directory escaped the repository.");
  }
  let directoryMetadata;
  try {
    directoryMetadata = lstatSync(absoluteDirectory);
  } catch {
    throw new Error(`Live eval archive directory is missing: ${archiveDirectory}`);
  }
  if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
    throw new Error(`Live eval archive path is not a regular directory: ${archiveDirectory}`);
  }
  const physicalDirectory = realpathSync(absoluteDirectory);
  if (!physicalDirectory.startsWith(workspacePrefix)) {
    throw new Error("Live eval archive directory escaped the repository through a symlink.");
  }
  if (physicalDirectory !== absoluteDirectory) {
    throw new Error(`Live eval archive directory traverses a symbolic link: ${archiveDirectory}`);
  }

  const worktreePaths = new Set<string>();
  for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const path = assertRepositoryRelativeEvidencePath(
      posix.join(archiveDirectory, entry.name),
    );
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new Error(`Live eval archive worktree contains a non-regular entry: ${path}`);
    }
    if (!isPublishedLiveEvalArchivePath(archiveDirectory, path)) {
      throw new Error(
        `Live eval archive worktree contains an untracked, temporary, or malformed entry: ${path}`,
      );
    }
    if (!headEntries.has(path)) {
      throw new Error(`Live eval archive worktree contains a file not published by HEAD: ${path}`);
    }
    worktreePaths.add(path);
  }
  for (const path of headEntries.keys()) {
    if (!worktreePaths.has(path)) {
      throw new Error(`Live eval archive is missing from the working tree: ${path}`);
    }
  }
}

function assertRepositoryHasCompleteHistory(workspace: string): void {
  const shallowState = runGit(workspace, [
    "rev-parse",
    "--is-shallow-repository",
  ]).toString("utf8").trim();
  if (shallowState !== "false") {
    throw new Error(
      "Release live eval archive verification requires a complete, non-shallow Git history.",
    );
  }
}

function listCommitGraph(
  workspace: string,
  headCommit: string,
): GitCommitGraphEntry[] {
  const output = runGit(workspace, [
    "rev-list",
    "--parents",
    headCommit,
  ]).toString("utf8");
  if (output.includes("\r") || output.includes("\0")) {
    throw new Error("git rev-list returned unsupported control characters.");
  }
  const graph = output
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [commit, ...parents] = line.split(" ");
      if (commit === undefined || parents.some((parent) => parent.length === 0)) {
        throw new Error("git rev-list returned an invalid commit graph.");
      }
      return {
        commit: assertGitObjectId(commit, "Git history commit"),
        parents: parents.map((parent) =>
          assertGitObjectId(parent, "Git history parent")
        ),
      };
    });
  if (!graph.some(({ commit }) => commit === headCommit)) {
    throw new Error("Complete Git history does not contain the captured HEAD commit.");
  }
  const commits = new Set(graph.map(({ commit }) => commit));
  for (const { parents } of graph) {
    for (const parent of parents) {
      if (!commits.has(parent)) {
        throw new Error(`Complete Git history is missing parent commit: ${parent}`);
      }
    }
  }
  return graph;
}

function historicalArchiveEntriesAtCommit(
  workspace: string,
  commit: string,
  archiveDirectory: string,
): Map<string, GitTreeEntry> {
  const result = new Map<string, GitTreeEntry>();
  for (const entry of listTreeEntriesAtCommit(workspace, commit, archiveDirectory)) {
    if (!isPublishedLiveEvalArchivePath(archiveDirectory, entry.path)) continue;
    assertRegularTreeEntry(entry, "Historical live eval archive entry");
    result.set(entry.path, entry);
  }
  return result;
}

function assertLiveEvalArchiveHistoryIsAppendOnly(
  workspace: string,
  headCommit: string,
  archiveDirectory: string,
  headEntries: ReadonlyMap<string, GitTreeEntry>,
): void {
  assertRepositoryHasCompleteHistory(workspace);
  const graph = listCommitGraph(workspace, headCommit);
  const entriesByCommit = new Map<string, Map<string, GitTreeEntry>>();
  const entriesAt = (commit: string): Map<string, GitTreeEntry> => {
    const cached = entriesByCommit.get(commit);
    if (cached !== undefined) return cached;
    const entries = historicalArchiveEntriesAtCommit(
      workspace,
      commit,
      archiveDirectory,
    );
    entriesByCommit.set(commit, entries);
    return entries;
  };

  for (const { commit, parents } of graph) {
    const childEntries = entriesAt(commit);
    for (const parent of parents) {
      for (const [path, parentEntry] of entriesAt(parent)) {
        const childEntry = childEntries.get(path);
        if (childEntry === undefined) {
          throw new Error(
            `Published live eval archive was removed or renamed: ${path}`,
          );
        }
        if (
          childEntry.mode !== parentEntry.mode ||
          childEntry.objectId !== parentEntry.objectId
        ) {
          throw new Error(
            `Published live eval archive bytes or mode changed: ${path}`,
          );
        }
      }
    }
  }

  const historicalEntries = new Map<string, GitTreeEntry>();
  for (const { commit } of graph) {
    for (const [path, entry] of entriesAt(commit)) {
      const published = historicalEntries.get(path);
      if (
        published !== undefined &&
        (published.mode !== entry.mode || published.objectId !== entry.objectId)
      ) {
        throw new Error(
          `Published live eval archive has conflicting bytes in Git history: ${path}`,
        );
      }
      historicalEntries.set(path, entry);
    }
  }
  for (const [path, historicalEntry] of historicalEntries) {
    const headEntry = headEntries.get(path);
    if (headEntry === undefined) {
      throw new Error(`Historical live eval archive is missing from HEAD: ${path}`);
    }
    if (
      headEntry.mode !== historicalEntry.mode ||
      headEntry.objectId !== historicalEntry.objectId
    ) {
      throw new Error(`Historical live eval archive differs from HEAD: ${path}`);
    }
  }
}

function readHeadCommit(workspace: string): string {
  const headCommit = runGit(workspace, ["rev-parse", "--verify", "HEAD^{commit}"])
    .toString("utf8")
    .trim();
  return assertGitObjectId(headCommit, "Release evidence repository HEAD");
}

function readGitBlobObject(
  workspace: string,
  objectId: string,
  label: string,
): Buffer {
  const args = [
    "cat-file",
    "blob",
    assertGitObjectId(objectId, `${label} object`),
  ] as const;
  const result = runGitRaw(workspace, args);
  if (result.status !== 0) {
    throw new Error(`${label} Git blob is missing: ${objectId}`);
  }
  if (result.stdout.byteLength > MAX_EVIDENCE_FILE_BYTES) {
    throw new Error(`Evidence path exceeds the 32 MiB limit in ${label}.`);
  }
  return result.stdout;
}

function readHeadTreeEntry(
  workspace: string,
  headCommit: string,
  path: string,
): GitTreeEntry {
  const entry = listTreeEntriesAtCommit(workspace, headCommit, path)
    .find((candidate) => candidate.path === path);
  if (entry === undefined) {
    throw new Error(`HEAD does not contain evidence path: ${path}`);
  }
  assertRegularTreeEntry(entry, "HEAD evidence path");
  return entry;
}

function readIndexEntry(workspace: string, path: string): GitIndexEntry {
  const entries = listIndexEntries(workspace, path)
    .filter((candidate) => candidate.path === path);
  if (entries.length === 0) {
    throw new Error(`Git index does not contain evidence path: ${path}`);
  }
  if (entries.length !== 1 || entries[0]?.stage !== 0) {
    throw new Error(`Git index contains conflicted evidence path: ${path}`);
  }
  const entry = entries[0];
  if (entry === undefined || !regularGitModes.has(entry.mode)) {
    throw new Error(`Git index evidence path is not a regular file: ${path}`);
  }
  return entry;
}

function verifyPathAtHead(
  workspace: string,
  headCommit: string,
  path: string,
  knownHeadEntry?: GitTreeEntry,
): { bytes: Buffer; result: VerifiedReleaseEvidencePath } {
  const headEntry = knownHeadEntry ?? readHeadTreeEntry(
    workspace,
    headCommit,
    path,
  );
  assertRegularTreeEntry(headEntry, "HEAD evidence path");
  const indexEntry = readIndexEntry(workspace, path);
  if (
    indexEntry.mode !== headEntry.mode ||
    indexEntry.objectId !== headEntry.objectId
  ) {
    throw new Error(`Git index bytes differ from HEAD for evidence path: ${path}`);
  }
  const headBytes = readGitBlobObject(
    workspace,
    headEntry.objectId,
    `HEAD evidence path ${path}`,
  );
  const worktreeBytes = readContainedRegularFile(workspace, path);
  if (!worktreeBytes.equals(headBytes)) {
    throw new Error(`Working-tree bytes differ from HEAD for evidence path: ${path}`);
  }
  return {
    bytes: worktreeBytes,
    result: {
      byteLength: headBytes.byteLength,
      path,
      sha256: createHash("sha256").update(headBytes).digest("hex"),
    },
  };
}

/**
 * Proves that release evidence is already published by the captured current
 * commit. Live-eval append-only history is scoped to that commit's complete
 * ancestor graph; the release-lineage ref itself remains an external policy.
 * Staged, merely local, symlinked, or worktree-drifted evidence fails closed.
 */
export function verifyReleaseEvidenceReadiness(
  input: ReleaseEvidenceReadinessInput,
): ReleaseEvidenceReadiness {
  const workspace = realpathSync(input.workspace);
  assertNoLegacyGitGrafts(workspace);
  assertIndexHasDefaultVisibilityFlags(workspace);
  const expectedHeadCommit = input.expectedHeadCommit === undefined
    ? undefined
    : assertGitObjectId(
      input.expectedHeadCommit,
      "Expected release evidence HEAD commit",
    );
  const headCommit = readHeadCommit(workspace);
  if (
    expectedHeadCommit !== undefined &&
    headCommit !== expectedHeadCommit
  ) {
    throw new Error(
      `Release evidence HEAD ${headCommit} does not match expected commit ${expectedHeadCommit}.`,
    );
  }
  const explicitPaths = input.explicitPaths ?? [];
  if (new Set(explicitPaths).size !== explicitPaths.length) {
    throw new Error("Release evidence contains duplicate explicit paths.");
  }
  const paths = new Set(explicitPaths.map(assertRepositoryRelativeEvidencePath));
  const knownHeadEntries = new Map<string, GitTreeEntry>();

  let vitestExecutionInputPaths: string[] = [];
  if (input.bindVitestExecutionInputs === true) {
    const entries = listAllTreeEntriesAtCommit(workspace, headCommit);
    for (const entry of entries) {
      assertRegularTreeEntry(entry, "Vitest execution input HEAD entry");
      if (knownHeadEntries.has(entry.path)) {
        throw new Error(
          `Vitest execution input HEAD tree contains a duplicate path: ${entry.path}`,
        );
      }
      knownHeadEntries.set(entry.path, entry);
      paths.add(entry.path);
    }
    vitestExecutionInputPaths = [...knownHeadEntries.keys()].sort(comparePaths);
    if (
      !vitestExecutionInputPaths.includes("vitest.config.ts") ||
      !vitestExecutionInputPaths.some((path) => path.startsWith("tests/"))
    ) {
      throw new Error(
        "Vitest execution input tree requires vitest.config.ts and tests/ files.",
      );
    }
  }

  let liveEvalArchivePath: string | null = null;
  let latestBytes: Buffer | null = null;
  const headArchiveEntries = new Map<string, GitTreeEntry>();
  if (input.liveEvalLatestPath !== undefined) {
    const latestPath = assertRepositoryRelativeEvidencePath(
      input.liveEvalLatestPath,
    );
    latestBytes = readContainedRegularFile(workspace, latestPath);
    liveEvalArchivePath = parseLiveEvalArchivePath(latestPath, latestBytes);
    assertLiveEvalPairIsNotPartiallyStaged(
      workspace,
      headCommit,
      latestPath,
      liveEvalArchivePath,
    );
    const archiveDirectory = liveEvalArchiveDirectory(latestPath);
    for (
      const [path, entry] of listCurrentHeadArchiveEntries(
        workspace,
        headCommit,
        archiveDirectory,
      )
    ) {
      headArchiveEntries.set(path, entry);
    }
    assertLiveEvalArchiveHistoryIsAppendOnly(
      workspace,
      headCommit,
      archiveDirectory,
      headArchiveEntries,
    );
    assertCurrentArchiveIndexInventory(
      workspace,
      archiveDirectory,
      headArchiveEntries,
    );
    assertCurrentArchiveWorktreeInventory(
      workspace,
      archiveDirectory,
      headArchiveEntries,
    );
    paths.add(latestPath);
    paths.add(liveEvalArchivePath);
    for (const path of headArchiveEntries.keys()) paths.add(path);
  }

  let screenshotAssetPaths: string[] = [];
  let screenshotSourcePaths: string[] = [];
  if (input.screenshotManifestPath !== undefined) {
    const manifestPath = assertRepositoryRelativeEvidencePath(
      input.screenshotManifestPath,
    );
    const manifestBytes = readContainedRegularFile(workspace, manifestPath);
    const screenshotDependencies = parseScreenshotDependencies(manifestBytes);
    screenshotAssetPaths = screenshotDependencies.assetPaths;
    screenshotSourcePaths = screenshotDependencies.sourcePaths;
    paths.add(manifestPath);
    for (const path of screenshotAssetPaths) paths.add(path);
    for (const path of screenshotSourcePaths) paths.add(path);
  }

  if (input.playwrightEvidencePath !== undefined) {
    paths.add(assertRepositoryRelativeEvidencePath(input.playwrightEvidencePath));
  }
  if (paths.size === 0) {
    throw new Error("Release evidence readiness requires at least one path.");
  }

  const verifiedByPath = new Map<string, Buffer>();
  const verifiedPaths = [...paths]
    .sort(comparePaths)
    .map((path) => {
      const verified = verifyPathAtHead(
        workspace,
        headCommit,
        path,
        headArchiveEntries.get(path) ?? knownHeadEntries.get(path),
      );
      verifiedByPath.set(path, verified.bytes);
      return verified.result;
    });

  if (input.liveEvalLatestPath !== undefined && liveEvalArchivePath !== null) {
    const verifiedLatest = verifiedByPath.get(input.liveEvalLatestPath);
    const verifiedArchive = verifiedByPath.get(liveEvalArchivePath);
    if (
      latestBytes === null ||
      verifiedLatest === undefined ||
      verifiedArchive === undefined ||
      !latestBytes.equals(verifiedLatest) ||
      !verifiedLatest.equals(verifiedArchive)
    ) {
      throw new Error(
        "Release live eval latest report does not byte-match its selected archive.",
      );
    }
  }

  const finalWorktreeStatus = runGit(workspace, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--ignore-submodules=none",
    "-z",
  ]);
  if (finalWorktreeStatus.byteLength !== 0) {
    throw new Error(
      "Release evidence requires a clean index and working tree for the entire repository.",
    );
  }

  assertNoLegacyGitGrafts(workspace);
  assertIndexHasDefaultVisibilityFlags(workspace);

  const completedHeadCommit = readHeadCommit(workspace);
  if (completedHeadCommit !== headCommit) {
    throw new Error("Repository HEAD changed during release evidence verification.");
  }
  if (
    expectedHeadCommit !== undefined &&
    completedHeadCommit !== expectedHeadCommit
  ) {
    throw new Error(
      "Repository HEAD no longer matches the expected release evidence commit.",
    );
  }
  return {
    dynamicPaths: {
      liveEvalArchivePath,
      screenshotAssetPaths,
      screenshotSourcePaths,
      vitestExecutionInputPaths,
    },
    headCommit,
    paths: verifiedPaths,
  };
}
