import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  realpathSync,
  type Stats,
} from "node:fs";
import { isAbsolute, normalize, relative, resolve, sep } from "node:path";

import { z } from "zod";

import { runTrustedGit } from "./trusted-git";
import { assertVerificationEqual } from "./verification-issues";
import { isIndependentOperatorRecord, normalizeVitestSourceBytes } from "./vitest-source-policy";

export const VITEST_EXECUTION_EVIDENCE_VERSION =
  "diesel-vitest-execution-evidence-v2" as const;
export const EXPECTED_VITEST_VERSION = "4.1.11" as const;
export const vitestExecutionEvidencePath =
  "docs/evidence/vitest-execution-latest.json" as const;
export const VITEST_EXECUTION_EVIDENCE_MAX_BYTES = 2 * 1024 * 1024;
export const VITEST_JSON_REPORTER_MAX_BYTES = 32 * 1024 * 1024;

const SOURCE_FILE_MAX_BYTES = 32 * 1024 * 1024;
const SOURCE_FINGERPRINT_DOMAIN = Buffer.from(
  "diesel-vitest-execution-source-fingerprint-v2",
  "utf8",
);
const TEST_ID_DOMAIN = Buffer.from(
  "diesel-vitest-execution-test-id-v1",
  "utf8",
);

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const gitObjectIdSchema = z.string().regex(
  /^(?!(?:0{40}|0{64})$)(?:[0-9a-f]{40}|[0-9a-f]{64})$/u,
);
const timestampSchema = z.iso.datetime({ offset: true }).regex(
  /Z$/u,
  "Expected a canonical UTC timestamp.",
);
const relativePathSchema = z.string().min(1).max(500).refine(
  (value) =>
    !isAbsolute(value) &&
    normalize(value).split(sep).join("/") === value &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    value.split("/").every((segment) => segment !== "" && segment !== ".."),
  "Expected a normalized repository-relative path.",
);
const transientEvidencePathSchema = relativePathSchema.refine(
  (value) =>
    /^docs\/evidence\/\.vitest-execution-\d+-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/u.test(
      value,
    ),
  "Expected a generated Vitest evidence staging path.",
);

export const vitestExecutionSourceFingerprintSchema = z.object({
  algorithm: z.literal("sha256"),
  digest: sha256Schema,
  fileCount: z.number().int().positive(),
}).strict();

export type VitestExecutionSourceFingerprint = z.infer<
  typeof vitestExecutionSourceFingerprintSchema
>;

export const vitestExecutionRepositoryStateSchema = z.object({
  headCommit: gitObjectIdSchema,
  sourceFingerprint: vitestExecutionSourceFingerprintSchema,
  worktreeState: z.enum(["clean", "dirty"]),
}).strict();

export type VitestExecutionRepositoryState = z.infer<
  typeof vitestExecutionRepositoryStateSchema
>;

export const vitestExecutionTestStatusSchema = z.enum([
  "failed",
  "passed",
  "pending",
  "skipped",
  "todo",
]);

export type VitestExecutionTestStatus = z.infer<
  typeof vitestExecutionTestStatusSchema
>;

export const vitestExecutionTestObservationSchema = z.object({
  id: sha256Schema,
  status: vitestExecutionTestStatusSchema,
}).strict();

export type VitestExecutionTestObservation = z.infer<
  typeof vitestExecutionTestObservationSchema
>;

export const vitestExecutionResultCountsSchema = z.object({
  collectedFiles: z.number().int().positive(),
  collectedSuites: z.number().int().positive(),
  collectedTests: z.number().int().positive(),
  failedTests: z.number().int().nonnegative(),
  passedTests: z.number().int().nonnegative(),
  pendingTests: z.number().int().nonnegative(),
  skippedTests: z.number().int().nonnegative(),
  todoTests: z.number().int().nonnegative(),
}).strict();

export type VitestExecutionResultCounts = z.infer<
  typeof vitestExecutionResultCountsSchema
>;

export const vitestExecutionEvidenceSchema = z.object({
  command: z.literal("pnpm test"),
  complete: z.literal(true),
  completedAt: timestampSchema,
  configPath: z.literal("vitest.config.ts"),
  provenance: z.object({
    baseHeadCommit: gitObjectIdSchema,
    evaluatedCommit: gitObjectIdSchema.nullable(),
    sourceFingerprint: vitestExecutionSourceFingerprintSchema,
    worktreeState: z.enum(["clean", "dirty"]),
  }).strict(),
  runId: z.string().uuid(),
  startedAt: timestampSchema,
  tests: z.array(vitestExecutionTestObservationSchema).min(1).max(100_000),
  totals: vitestExecutionResultCountsSchema,
  version: z.literal(VITEST_EXECUTION_EVIDENCE_VERSION),
  vitestVersion: z.literal(EXPECTED_VITEST_VERSION),
}).strict();

export type VitestExecutionEvidence = z.infer<
  typeof vitestExecutionEvidenceSchema
>;

const finiteMillisecondsSchema = z.number().finite().nonnegative().max(8.64e15);
const rawLocationSchema = z.object({
  column: z.number().int().positive(),
  line: z.number().int().positive(),
}).strict();
const rawAssertionSchema = z.object({
  ancestorTitles: z.array(z.string().max(20_000)).max(100),
  duration: finiteMillisecondsSchema.nullable().optional(),
  failureMessages: z.array(z.string().max(500_000)).max(100).nullable(),
  fullName: z.string().min(1).max(100_000),
  location: rawLocationSchema.nullable().optional(),
  meta: z.record(z.string(), z.unknown()),
  status: z.enum([
    "passed",
    "failed",
    "skipped",
    "pending",
    "todo",
    "disabled",
  ]),
  tags: z.array(z.string().max(1_000)).max(100),
  title: z.string().min(1).max(20_000),
}).strict();
const rawFileResultSchema = z.object({
  assertionResults: z.array(rawAssertionSchema).max(100_000),
  endTime: finiteMillisecondsSchema,
  message: z.string().max(1_000_000),
  name: z.string().min(1).max(4_096),
  startTime: finiteMillisecondsSchema,
  status: z.enum(["failed", "passed"]),
}).strict();
const rawSnapshotSummarySchema = z.object({
  added: z.number().int().nonnegative(),
  didUpdate: z.boolean(),
  failure: z.boolean(),
  filesAdded: z.number().int().nonnegative(),
  filesRemoved: z.number().int().nonnegative(),
  filesRemovedList: z.array(z.string().max(4_096)).max(100_000),
  filesUnmatched: z.number().int().nonnegative(),
  filesUpdated: z.number().int().nonnegative(),
  matched: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  unchecked: z.number().int().nonnegative(),
  uncheckedKeysByFile: z.array(z.object({
    filePath: z.string().min(1).max(4_096),
    keys: z.array(z.string().max(20_000)).max(100_000),
  }).strict()).max(100_000),
  unmatched: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
}).strict();
const rawVitestJsonReportSchema = z.object({
  coverageMap: z.null().optional(),
  numFailedTests: z.number().int().nonnegative(),
  numFailedTestSuites: z.number().int().nonnegative(),
  numPassedTests: z.number().int().nonnegative(),
  numPassedTestSuites: z.number().int().nonnegative(),
  numPendingTests: z.number().int().nonnegative(),
  numPendingTestSuites: z.number().int().nonnegative(),
  numTodoTests: z.number().int().nonnegative(),
  numTotalTests: z.number().int().nonnegative(),
  numTotalTestSuites: z.number().int().nonnegative(),
  snapshot: rawSnapshotSummarySchema,
  startTime: finiteMillisecondsSchema,
  success: z.boolean(),
  testResults: z.array(rawFileResultSchema).max(10_000),
}).strict();

export type NormalizedVitestJsonReport = Readonly<{
  completedAt: string;
  failureDiagnostics: readonly VitestExecutionFailureDiagnostic[];
  sourcePaths: readonly string[];
  startedAt: string;
  success: boolean;
  tests: readonly VitestExecutionTestObservation[];
  totals: VitestExecutionResultCounts;
}>;

type VitestReportedFailure =
  | Readonly<{ kind: "numeric_equality"; actual: number; expected: number }>
  | Readonly<{ kind: "test_timeout" | "hook_timeout"; timeoutMs: number }>
  | Readonly<{ kind: "assertion" | "unclassified" }>;

export type VitestExecutionFailureDiagnostic = Readonly<{
  id: string;
  file: string;
  location: Readonly<{ line: number; column: number }> | null;
  durationMs: number | null;
  reportedFailure: VitestReportedFailure;
}>;

const MAX_FAILURE_DIAGNOSTICS = 5;

/** Projects only recognized first-line categories and small numeric comparisons. */
export function summarizeReportedFailure(
  messages: readonly string[] | null,
): VitestReportedFailure {
  const firstLine = messages?.[0]?.split(/\r?\n/u, 1)[0] ?? "";
  const numericEquality = /^AssertionError: expected (-?(?:0|[1-9]\d*)) to be (-?(?:0|[1-9]\d*)) \/\/ Object\.is equality$/u.exec(firstLine);
  if (numericEquality !== null) {
    const actual = Number(numericEquality[1]);
    const expected = Number(numericEquality[2]);
    // Covers process exit codes without emitting arbitrary assertion values.
    if (
      Number.isInteger(actual) && actual >= -1 && actual <= 255 &&
      Number.isInteger(expected) && expected >= -1 && expected <= 255 &&
      String(actual) === numericEquality[1] &&
      String(expected) === numericEquality[2]
    ) {
      return { kind: "numeric_equality", actual, expected };
    }
  }
  const timeout = /^Error: (Test|Hook) timed out in ([1-9]\d*)ms\.$/u.exec(firstLine);
  if (timeout !== null) {
    const timeoutMs = Number(timeout[2]);
    if (Number.isSafeInteger(timeoutMs) && timeoutMs <= 30 * 60 * 1_000) {
      return {
        kind: timeout[1] === "Test" ? "test_timeout" : "hook_timeout",
        timeoutMs,
      };
    }
  }
  return {
    kind: firstLine.startsWith("AssertionError: ") ? "assertion" : "unclassified",
  };
}

export type VitestExecutionInventory = Readonly<{
  collectedFiles: number;
  collectedTests: number;
  sourcePaths: readonly string[];
  testIds: readonly string[];
}>;

const vitestListJsonSchema = z.array(z.object({
  file: z.string().min(1).max(4_096),
  name: z.string().min(1).max(100_000),
}).strict()).min(1).max(100_000);

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function decodeGitOutput(bytes: Buffer, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause: unknown) {
    throw new Error(`${label} is not valid UTF-8.`, { cause });
  }
}

function frame(hash: ReturnType<typeof createHash>, bytes: Buffer): void {
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.byteLength));
  hash.update(length);
  hash.update(bytes);
}

function sourceFileMode(metadata: Stats): string {
  return (metadata.mode & 0o111) === 0 ? "100644" : "100755";
}

function assertPhysicalWorkspace(workspace: string): string {
  const normalized = resolve(workspace);
  let physical: string;
  try {
    physical = realpathSync(normalized);
  } catch (cause: unknown) {
    throw new Error("Vitest evidence workspace could not be resolved.", { cause });
  }
  if (physical !== normalized) {
    throw new Error("Vitest evidence workspace must not traverse a symbolic link.");
  }
  return physical;
}

function readStableSourceFile(workspace: string, path: string): {
  bytes: Buffer;
  mode: string;
} {
  const safePath = relativePathSchema.parse(path);
  const absolutePath = resolve(workspace, safePath);
  const workspacePrefix = `${workspace}${sep}`;
  if (!absolutePath.startsWith(workspacePrefix)) {
    throw new Error(`Vitest execution source escaped the workspace: ${safePath}`);
  }
  let before: ReturnType<typeof lstatSync>;
  let resolvedPath: string;
  try {
    before = lstatSync(absolutePath);
    resolvedPath = realpathSync(absolutePath);
  } catch (cause: unknown) {
    throw new Error(`Vitest execution source is missing: ${safePath}`, { cause });
  }
  if (
    before.isSymbolicLink() ||
    !before.isFile() ||
    resolvedPath !== absolutePath
  ) {
    throw new Error(
      `Vitest execution source must be a contained regular non-symlink file: ${safePath}`,
    );
  }
  if (before.size > SOURCE_FILE_MAX_BYTES) {
    throw new Error(`Vitest execution source exceeds the 32 MiB limit: ${safePath}`);
  }
  const bytes = readFileSync(absolutePath);
  const after = lstatSync(absolutePath);
  if (
    bytes.byteLength !== before.size ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.mode !== after.mode ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs ||
    before.size !== after.size
  ) {
    throw new Error(`Vitest execution source changed while read: ${safePath}`);
  }
  return { bytes, mode: sourceFileMode(before) };
}

function fingerprintEntries(
  entries: readonly { bytes: Buffer; mode: string; path: string }[],
): VitestExecutionSourceFingerprint {
  if (entries.length === 0) {
    throw new Error("Vitest execution source fingerprint is empty.");
  }
  const hash = createHash("sha256");
  frame(hash, SOURCE_FINGERPRINT_DOMAIN);
  for (const entry of entries) {
    frame(hash, Buffer.from(entry.mode, "utf8"));
    frame(hash, Buffer.from(entry.path, "utf8"));
    frame(hash, normalizeVitestSourceBytes(entry.path, entry.bytes));
  }
  return vitestExecutionSourceFingerprintSchema.parse({
    algorithm: "sha256",
    digest: hash.digest("hex"),
    fileCount: entries.length,
  });
}

function gitVisiblePaths(
  workspace: string,
  gitExecutable?: string,
  excludedPaths: ReadonlySet<string> = new Set<string>(),
): string[] {
  const output = decodeGitOutput(
    runTrustedGit(workspace, [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ".",
    ], gitExecutable),
    "Git-visible Vitest execution inventory",
  );
  const paths = output
    .split("\0")
    .filter((path) => path.length > 0)
    .map((path) => relativePathSchema.parse(path))
    .filter((path) =>
      path !== vitestExecutionEvidencePath && !isIndependentOperatorRecord(path) && !excludedPaths.has(path)
    )
    .sort(compareText);
  if (new Set(paths).size !== paths.length) {
    throw new Error("Git-visible Vitest execution inventory contains duplicate paths.");
  }
  return paths;
}

function assertSourcesBelongToStableGitInventory(
  workspace: string,
  inventoryBefore: readonly string[],
  sourcePaths: readonly string[],
  gitExecutable?: string,
): void {
  const inventoryAfter = gitVisiblePaths(workspace, gitExecutable);
  assertVerificationEqual(
    inventoryAfter,
    inventoryBefore,
    "Vitest Git-visible source inventory",
  );
  const visiblePaths = new Set(inventoryBefore);
  const hiddenSource = sourcePaths.find((path) => !visiblePaths.has(path));
  if (hiddenSource !== undefined) {
    throw new Error(
      `Vitest source is not in the stable Git-visible inventory: ${hiddenSource}`,
    );
  }
}

function worktreeHasSourceChanges(
  output: string,
  excludedPaths: ReadonlySet<string> = new Set<string>(),
): boolean {
  const records = output.split("\0");
  records.pop();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.length < 4 || record[2] !== " ") {
      throw new Error("Vitest execution worktree status is malformed.");
    }
    const status = record.slice(0, 2);
    const paths = [relativePathSchema.parse(record.slice(3))];
    if (/[RC]/u.test(status)) {
      const sourcePath = records[index + 1];
      if (!sourcePath) {
        throw new Error("Vitest execution rename status is incomplete.");
      }
      paths.push(relativePathSchema.parse(sourcePath));
      index += 1;
    }
    if (paths.some((path) =>
      path !== vitestExecutionEvidencePath && !excludedPaths.has(path)
    )) {
      return true;
    }
  }
  return false;
}

export function captureVitestExecutionRepositoryState(
  workspace: string,
  gitExecutable?: string,
  excludedRepositoryPaths: readonly string[] = [],
): VitestExecutionRepositoryState {
  const physicalWorkspace = assertPhysicalWorkspace(workspace);
  const excludedPaths = new Set(
    excludedRepositoryPaths.map((path) => transientEvidencePathSchema.parse(path)),
  );
  if (excludedPaths.size !== excludedRepositoryPaths.length) {
    throw new Error("Vitest source exclusions contain duplicate paths.");
  }
  const headBefore = runTrustedGit(
    physicalWorkspace,
    ["rev-parse", "--verify", "HEAD^{commit}"],
    gitExecutable,
  );
  const statusArguments = [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "-z",
    "--",
    ".",
  ] as const;
  const statusBefore = runTrustedGit(
    physicalWorkspace,
    statusArguments,
    gitExecutable,
  );
  const headCommit = decodeGitOutput(
    headBefore,
    "Vitest execution HEAD",
  ).trim();
  gitObjectIdSchema.parse(headCommit);
  const captureSourceFingerprint = (): VitestExecutionSourceFingerprint =>
    fingerprintEntries(
      gitVisiblePaths(physicalWorkspace, gitExecutable, excludedPaths).map((path) => ({
        ...readStableSourceFile(physicalWorkspace, path),
        path,
      })),
    );
  const firstSourceFingerprint = captureSourceFingerprint();
  const secondSourceFingerprint = captureSourceFingerprint();
  const headAfter = runTrustedGit(
    physicalWorkspace,
    ["rev-parse", "--verify", "HEAD^{commit}"],
    gitExecutable,
  );
  const statusAfter = runTrustedGit(
    physicalWorkspace,
    statusArguments,
    gitExecutable,
  );
  if (!headAfter.equals(headBefore) || !statusAfter.equals(statusBefore)) {
    throw new Error(
      "Vitest execution repository changed while its source snapshot was captured.",
    );
  }
  assertVerificationEqual(
    secondSourceFingerprint,
    firstSourceFingerprint,
    "Vitest execution repeated source snapshot",
  );
  return vitestExecutionRepositoryStateSchema.parse({
    headCommit,
    sourceFingerprint: firstSourceFingerprint,
    worktreeState: worktreeHasSourceChanges(
      decodeGitOutput(statusBefore, "Vitest execution worktree status"),
      excludedPaths,
    )
      ? "dirty"
      : "clean",
  });
}

export function captureVitestExecutionSourceFingerprintAtRevision(
  workspace: string,
  revision: string,
  gitExecutable?: string,
): VitestExecutionSourceFingerprint {
  const physicalWorkspace = assertPhysicalWorkspace(workspace);
  gitObjectIdSchema.parse(revision);
  const resolvedRevision = decodeGitOutput(
    runTrustedGit(
      physicalWorkspace,
      ["rev-parse", "--verify", `${revision}^{commit}`],
      gitExecutable,
    ),
    "Vitest execution revision",
  ).trim();
  if (resolvedRevision !== revision) {
    throw new Error("Vitest execution revision did not resolve exactly.");
  }
  const records = decodeGitOutput(
    runTrustedGit(
      physicalWorkspace,
      ["ls-tree", "-r", "--full-tree", "-z", revision, "--", "."],
      gitExecutable,
    ),
    "Vitest execution revision inventory",
  ).split("\0").filter((record) => record.length > 0);
  const entries = records.map((record) => {
    const separator = record.indexOf("\t");
    const header = separator < 0 ? "" : record.slice(0, separator);
    const path = relativePathSchema.parse(record.slice(separator + 1));
    const match = /^(100644|100755) blob ([0-9a-f]{40}|[0-9a-f]{64})$/u.exec(
      header,
    );
    if (!match?.[1] || !match[2]) {
      throw new Error(
        `Vitest execution revision contains a non-regular source: ${path}`,
      );
    }
    return { mode: match[1], objectId: match[2], path };
  }).filter(({ path }) => path !== vitestExecutionEvidencePath && !isIndependentOperatorRecord(path))
    .sort((left, right) => compareText(left.path, right.path));
  if (new Set(entries.map(({ path }) => path)).size !== entries.length) {
    throw new Error("Vitest execution revision inventory contains duplicate paths.");
  }
  return fingerprintEntries(entries.map(({ mode, objectId, path }) => {
    const bytes = runTrustedGit(
      physicalWorkspace,
      ["cat-file", "blob", objectId],
      gitExecutable,
    );
    if (bytes.byteLength > SOURCE_FILE_MAX_BYTES) {
      throw new Error(`Vitest execution revision source exceeds 32 MiB: ${path}`);
    }
    return { bytes, mode, path };
  }));
}

function canonicalRawReport(text: string): unknown {
  if (Buffer.byteLength(text, "utf8") > VITEST_JSON_REPORTER_MAX_BYTES) {
    throw new Error("Vitest JSON reporter output exceeds the 32 MiB limit.");
  }
  if (text.includes("\0") || text.includes("\r")) {
    throw new Error("Vitest JSON reporter output contains unsupported characters.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause: unknown) {
    throw new Error("Vitest JSON reporter output is not valid JSON.", { cause });
  }
  if (text !== JSON.stringify(parsed)) {
    throw new Error(
      "Vitest JSON reporter output must use the reporter's canonical compact JSON encoding.",
    );
  }
  return parsed;
}

function repositoryTestPath(workspace: string, absolutePath: string): string {
  if (!isAbsolute(absolutePath) || resolve(absolutePath) !== absolutePath) {
    throw new Error("Vitest JSON reporter contains a noncanonical test file path.");
  }
  const repositoryPath = relative(workspace, absolutePath).split(sep).join("/");
  const safePath = relativePathSchema.parse(repositoryPath);
  if (!/^tests\/(?:[^/]+\/)*[^/]+\.test\.ts$/u.test(safePath)) {
    throw new Error("Vitest JSON reporter contains a file outside the canonical suite.");
  }
  const metadata = lstatSync(absolutePath);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    realpathSync(absolutePath) !== absolutePath
  ) {
    throw new Error(`Vitest test source is not a regular file: ${safePath}`);
  }
  return safePath;
}

function testId(parts: readonly string[]): string {
  const hash = createHash("sha256");
  frame(hash, TEST_ID_DOMAIN);
  for (const part of parts) frame(hash, Buffer.from(part, "utf8"));
  return hash.digest("hex");
}

function nextTestIdentityOccurrence(
  occurrences: Map<string, Map<string, number>>,
  path: string,
  fullName: string,
): number {
  let names = occurrences.get(path);
  if (names === undefined) {
    names = new Map<string, number>();
    occurrences.set(path, names);
  }
  const occurrence = names.get(fullName) ?? 0;
  names.set(fullName, occurrence + 1);
  return occurrence;
}

function anonymousTestId(
  path: string,
  fullName: string,
  occurrence: number,
): string {
  return testId([path, fullName, String(occurrence)]);
}

function normalizeStatus(
  status: z.infer<typeof rawAssertionSchema>["status"],
): VitestExecutionTestStatus {
  return status === "disabled" ? "skipped" : status;
}

function timestamp(milliseconds: number, label: string): string {
  try {
    return new Date(milliseconds).toISOString();
  } catch (cause: unknown) {
    throw new Error(`${label} is outside the supported timestamp range.`, { cause });
  }
}

/** Validates the private reporter transport, without asserting execution success. */
export function parseVitestJsonReporterOutput(text: string) {
  return rawVitestJsonReportSchema.parse(canonicalRawReport(text));
}

export function normalizeVitestJsonReporterOutput(
  text: string,
  workspace: string,
): NormalizedVitestJsonReport {
  const physicalWorkspace = assertPhysicalWorkspace(workspace);
  const report = parseVitestJsonReporterOutput(text);
  if (report.testResults.length === 0 || report.numTotalTests === 0) {
    throw new Error("Vitest JSON reporter output contains no executed inventory.");
  }
  assertVerificationEqual(
    report.numPassedTestSuites + report.numFailedTestSuites +
      report.numPendingTestSuites,
    report.numTotalTestSuites,
    "Vitest reporter suite arithmetic",
  );
  if (report.numTotalTestSuites < report.testResults.length) {
    throw new Error(
      "Vitest reporter suite inventory is smaller than its file inventory.",
    );
  }
  assertVerificationEqual(
    report.numPassedTests + report.numFailedTests + report.numPendingTests +
      report.numTodoTests,
    report.numTotalTests,
    "Vitest reporter test arithmetic",
  );
  if (report.snapshot.failure) {
    throw new Error("Vitest JSON reporter recorded a snapshot failure.");
  }
  const gitInventoryBefore = gitVisiblePaths(physicalWorkspace);
  const seenFiles = new Set<string>();
  const occurrences = new Map<string, Map<string, number>>();
  const tests: VitestExecutionTestObservation[] = [];
  const failureDiagnostics: VitestExecutionFailureDiagnostic[] = [];
  let completedMilliseconds = report.startTime;
  for (const file of report.testResults) {
    const path = repositoryTestPath(physicalWorkspace, file.name);
    if (seenFiles.has(path)) {
      throw new Error(`Vitest JSON reporter contains a duplicate file: ${path}`);
    }
    seenFiles.add(path);
    if (
      file.startTime < report.startTime ||
      file.endTime < file.startTime
    ) {
      throw new Error(`Vitest JSON reporter contains an invalid run window: ${path}`);
    }
    completedMilliseconds = Math.max(completedMilliseconds, file.endTime);
    const hasFailedAssertion = file.assertionResults.some(
      ({ status }) => status === "failed",
    );
    if (file.status !== (hasFailedAssertion ? "failed" : "passed")) {
      throw new Error(`Vitest JSON reporter file status drifted: ${path}`);
    }
    file.assertionResults.forEach((assertion) => {
      const expectedFullName = [...assertion.ancestorTitles, assertion.title]
        .join(" ");
      if (assertion.fullName !== expectedFullName) {
        throw new Error(`Vitest JSON reporter test identity drifted: ${path}`);
      }
      const inventoryFullName = [...assertion.ancestorTitles, assertion.title]
        .join(" > ");
      const occurrence = nextTestIdentityOccurrence(
        occurrences,
        path,
        inventoryFullName,
      );
      const id = anonymousTestId(path, inventoryFullName, occurrence);
      const status = normalizeStatus(assertion.status);
      tests.push({ id, status });
      if (status === "failed" && failureDiagnostics.length < MAX_FAILURE_DIAGNOSTICS) {
        failureDiagnostics.push({
          id,
          file: path,
          location: assertion.location ?? null,
          durationMs: assertion.duration ?? null,
          reportedFailure: summarizeReportedFailure(assertion.failureMessages),
        });
      }
    });
  }
  const statusCount = (status: VitestExecutionTestStatus): number =>
    tests.filter((test) => test.status === status).length;
  const skippedTests = statusCount("skipped");
  const pendingTests = statusCount("pending");
  const totals = vitestExecutionResultCountsSchema.parse({
    collectedFiles: seenFiles.size,
    collectedSuites: report.numTotalTestSuites,
    collectedTests: tests.length,
    failedTests: statusCount("failed"),
    passedTests: statusCount("passed"),
    pendingTests,
    skippedTests,
    todoTests: statusCount("todo"),
  });
  assertVerificationEqual(totals.collectedTests, report.numTotalTests,
    "Vitest reporter collected tests");
  assertVerificationEqual(totals.passedTests, report.numPassedTests,
    "Vitest reporter passed tests");
  assertVerificationEqual(totals.failedTests, report.numFailedTests,
    "Vitest reporter failed tests");
  assertVerificationEqual(totals.todoTests, report.numTodoTests,
    "Vitest reporter todo tests");
  assertVerificationEqual(
    totals.skippedTests + totals.pendingTests,
    report.numPendingTests,
    "Vitest reporter pending/skipped tests",
  );
  const expectedSuccess = report.numTotalTestSuites > 0 &&
    report.numFailedTestSuites === 0 && report.numFailedTests === 0;
  assertVerificationEqual(report.success, expectedSuccess, "Vitest reporter success");
  const orderedTests = [...tests].sort((left, right) => compareText(left.id, right.id));
  if (new Set(orderedTests.map(({ id }) => id)).size !== orderedTests.length) {
    throw new Error("Vitest JSON reporter produced duplicate anonymous test IDs.");
  }
  const sourcePaths = [...seenFiles].sort(compareText);
  assertSourcesBelongToStableGitInventory(
    physicalWorkspace,
    gitInventoryBefore,
    sourcePaths,
  );
  return {
    completedAt: timestamp(completedMilliseconds, "Vitest completion time"),
    failureDiagnostics,
    sourcePaths,
    startedAt: timestamp(report.startTime, "Vitest start time"),
    success: report.success,
    tests: orderedTests,
    totals,
  };
}

export function toVitestExecutionInventory(
  normalized: NormalizedVitestJsonReport,
): VitestExecutionInventory {
  return {
    collectedFiles: normalized.totals.collectedFiles,
    collectedTests: normalized.totals.collectedTests,
    sourcePaths: [...normalized.sourcePaths],
    testIds: normalized.tests.map(({ id }) => id),
  };
}

export function normalizeVitestListJson(
  text: string,
  workspace: string,
): VitestExecutionInventory {
  const physicalWorkspace = assertPhysicalWorkspace(workspace);
  if (Buffer.byteLength(text, "utf8") > VITEST_JSON_REPORTER_MAX_BYTES) {
    throw new Error("Vitest list JSON exceeds the 32 MiB limit.");
  }
  if (text.includes("\0") || text.includes("\r")) {
    throw new Error("Vitest list JSON contains unsupported characters.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause: unknown) {
    throw new Error("Vitest list output is not valid JSON.", { cause });
  }
  if (text !== JSON.stringify(parsed, null, 2)) {
    throw new Error(
      "Vitest list output must use canonical two-space JSON without a final newline.",
    );
  }
  const rows = vitestListJsonSchema.parse(parsed);
  const gitInventoryBefore = gitVisiblePaths(physicalWorkspace);
  const occurrences = new Map<string, Map<string, number>>();
  const sourcePaths = new Set<string>();
  const testIds = rows.map((row) => {
    const path = repositoryTestPath(physicalWorkspace, row.file);
    sourcePaths.add(path);
    const occurrence = nextTestIdentityOccurrence(
      occurrences,
      path,
      row.name,
    );
    return anonymousTestId(path, row.name, occurrence);
  }).sort(compareText);
  if (new Set(testIds).size !== testIds.length) {
    throw new Error("Vitest list output produced duplicate anonymous test IDs.");
  }
  const orderedSourcePaths = [...sourcePaths].sort(compareText);
  assertSourcesBelongToStableGitInventory(
    physicalWorkspace,
    gitInventoryBefore,
    orderedSourcePaths,
  );
  return {
    collectedFiles: sourcePaths.size,
    collectedTests: rows.length,
    sourcePaths: orderedSourcePaths,
    testIds,
  };
}

function summarizeTests(
  tests: readonly VitestExecutionTestObservation[],
): Pick<
  VitestExecutionResultCounts,
  | "collectedTests"
  | "failedTests"
  | "passedTests"
  | "pendingTests"
  | "skippedTests"
  | "todoTests"
> {
  return {
    collectedTests: tests.length,
    failedTests: tests.filter(({ status }) => status === "failed").length,
    passedTests: tests.filter(({ status }) => status === "passed").length,
    pendingTests: tests.filter(({ status }) => status === "pending").length,
    skippedTests: tests.filter(({ status }) => status === "skipped").length,
    todoTests: tests.filter(({ status }) => status === "todo").length,
  };
}

export function buildVitestExecutionEvidence(input: Readonly<{
  completed: VitestExecutionRepositoryState;
  normalizedReport: NormalizedVitestJsonReport;
  runId: string;
  started: VitestExecutionRepositoryState;
}>): VitestExecutionEvidence {
  const started = vitestExecutionRepositoryStateSchema.parse(input.started);
  const completed = vitestExecutionRepositoryStateSchema.parse(input.completed);
  assertVerificationEqual(completed, started, "Vitest execution start/end source");
  if (
    !input.normalizedReport.success ||
    input.normalizedReport.totals.failedTests !== 0 ||
    input.normalizedReport.totals.pendingTests !== 0
  ) {
    throw new Error("Vitest execution evidence requires a complete passing run.");
  }
  const evidence = vitestExecutionEvidenceSchema.parse({
    command: "pnpm test",
    complete: true,
    completedAt: input.normalizedReport.completedAt,
    configPath: "vitest.config.ts",
    provenance: {
      baseHeadCommit: started.headCommit,
      evaluatedCommit: started.worktreeState === "clean"
        ? started.headCommit
        : null,
      sourceFingerprint: started.sourceFingerprint,
      worktreeState: started.worktreeState,
    },
    runId: input.runId,
    startedAt: input.normalizedReport.startedAt,
    tests: input.normalizedReport.tests,
    totals: input.normalizedReport.totals,
    version: VITEST_EXECUTION_EVIDENCE_VERSION,
    vitestVersion: EXPECTED_VITEST_VERSION,
  });
  assertVitestExecutionEvidence(evidence);
  return evidence;
}

export function assertVitestExecutionEvidence(
  evidenceInput: VitestExecutionEvidence,
): void {
  const evidence = vitestExecutionEvidenceSchema.parse(evidenceInput);
  if (Date.parse(evidence.completedAt) < Date.parse(evidence.startedAt)) {
    throw new Error("Vitest execution completion precedes its start time.");
  }
  const orderedIds = evidence.tests.map(({ id }) => id);
  const expectedIds = [...orderedIds].sort(compareText);
  assertVerificationEqual(orderedIds, expectedIds, "Vitest evidence test ordering");
  if (new Set(orderedIds).size !== orderedIds.length) {
    throw new Error("Vitest execution evidence contains duplicate test IDs.");
  }
  assertVerificationEqual(
    {
      ...summarizeTests(evidence.tests),
      collectedFiles: evidence.totals.collectedFiles,
      collectedSuites: evidence.totals.collectedSuites,
    },
    evidence.totals,
    "Vitest evidence totals",
  );
  if (evidence.totals.failedTests !== 0 || evidence.totals.pendingTests !== 0) {
    throw new Error("Vitest execution evidence is not a complete passing run.");
  }
  const expectedCommit = evidence.provenance.worktreeState === "clean"
    ? evidence.provenance.baseHeadCommit
    : null;
  assertVerificationEqual(
    evidence.provenance.evaluatedCommit,
    expectedCommit,
    "Vitest evidence evaluated commit",
  );
}

function parseCanonicalEvidenceDocument(text: string): VitestExecutionEvidence {
  if (Buffer.byteLength(text, "utf8") > VITEST_EXECUTION_EVIDENCE_MAX_BYTES) {
    throw new Error("Vitest execution evidence exceeds the 2 MiB limit.");
  }
  if (text.includes("\0") || text.includes("\r")) {
    throw new Error("Vitest execution evidence contains unsupported characters.");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause: unknown) {
    throw new Error("Vitest execution evidence is not valid JSON.", { cause });
  }
  const evidence = vitestExecutionEvidenceSchema.parse(value);
  assertVitestExecutionEvidence(evidence);
  if (text !== `${JSON.stringify(evidence, null, 2)}\n`) {
    throw new Error(
      "Vitest execution evidence must use canonical two-space JSON with one final newline.",
    );
  }
  return evidence;
}

export function parseCanonicalVitestExecutionEvidence(
  text: string,
): VitestExecutionEvidence {
  return parseCanonicalEvidenceDocument(text);
}

export function serializeCanonicalVitestExecutionEvidence(
  evidence: VitestExecutionEvidence,
): string {
  const canonicalEvidence = vitestExecutionEvidenceSchema.parse(evidence);
  assertVitestExecutionEvidence(canonicalEvidence);
  const text = `${JSON.stringify(canonicalEvidence, null, 2)}\n`;
  if (Buffer.byteLength(text, "utf8") > VITEST_EXECUTION_EVIDENCE_MAX_BYTES) {
    throw new Error("Vitest execution evidence exceeds the 2 MiB limit.");
  }
  return text;
}

function assertBoundedTestIdentityInventory(
  label: string,
  actual: Readonly<{
    collectedFiles: number;
    collectedTests: number;
    testIds: readonly string[];
  }>,
  expected: Readonly<{
    collectedFiles: number;
    collectedTests: number;
    testIds: readonly string[];
  }>,
): void {
  const identitiesMatch = actual.testIds.length === expected.testIds.length &&
    actual.testIds.every((id, index) => id === expected.testIds[index]);
  if (
    actual.collectedFiles === expected.collectedFiles &&
    actual.collectedTests === expected.collectedTests &&
    identitiesMatch
  ) {
    return;
  }

  const actualIds = new Set(actual.testIds);
  const expectedIds = new Set(expected.testIds);
  const missingFromCurrent = expected.testIds.filter((id) => !actualIds.has(id));
  const unexpectedInCurrent = actual.testIds.filter((id) => !expectedIds.has(id));
  const sample = (ids: readonly string[]) =>
    ids.length === 0 ? "[]" : `[${ids.slice(0, 5).join(",")}]`;
  const orderingMismatch =
    !identitiesMatch &&
    missingFromCurrent.length === 0 &&
    unexpectedInCurrent.length === 0;

  throw new Error(
    `${label} drifted: ` +
      `files current=${actual.collectedFiles}/evidence=${expected.collectedFiles}; ` +
      `tests current=${actual.collectedTests}/evidence=${expected.collectedTests}; ` +
      `missingFromCurrent=${missingFromCurrent.length} ${sample(missingFromCurrent)}; ` +
      `unexpectedInCurrent=${unexpectedInCurrent.length} ${sample(unexpectedInCurrent)}; ` +
      `orderingMismatch=${orderingMismatch}.`,
  );
}

export function assertVitestExecutionInventoryMatchesEvidence(
  normalized: NormalizedVitestJsonReport,
  evidence: VitestExecutionEvidence,
): void {
  assertVitestExecutionEvidence(evidence);
  assertBoundedTestIdentityInventory(
    "Vitest normalized report/evidence inventory",
    toVitestExecutionInventory(normalized),
    {
      collectedFiles: evidence.totals.collectedFiles,
      collectedTests: evidence.totals.collectedTests,
      testIds: evidence.tests.map(({ id }) => id),
    },
  );
  assertVerificationEqual(
    normalized.totals,
    evidence.totals,
    "Vitest normalized report/evidence totals",
  );
  const statusMismatches = normalized.tests.flatMap((test, index) =>
    test.status === evidence.tests[index]?.status ? [] : [test.id]
  );
  if (statusMismatches.length > 0) {
    throw new Error(
      "Vitest normalized report/evidence statuses drifted: " +
        `${statusMismatches.length} mismatch(es); ` +
        `sample=[${statusMismatches.slice(0, 5).join(",")}].`,
    );
  }
}

export function assertVitestListInventoryMatchesEvidence(
  inventory: VitestExecutionInventory,
  evidence: VitestExecutionEvidence,
): void {
  assertVitestExecutionEvidence(evidence);
  assertBoundedTestIdentityInventory(
    "Vitest list/evidence inventory",
    {
      collectedFiles: inventory.collectedFiles,
      collectedTests: inventory.collectedTests,
      testIds: inventory.testIds,
    },
    {
      collectedFiles: evidence.totals.collectedFiles,
      collectedTests: evidence.totals.collectedTests,
      testIds: evidence.tests.map(({ id }) => id),
    },
  );
}
