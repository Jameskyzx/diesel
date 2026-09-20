import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { userInfo } from "node:os";
import { delimiter, relative, resolve, sep } from "node:path";

import { z } from "zod";

import { runTrustedGit } from "./trusted-git";
import { assertVerificationEqual } from "./verification-issues";

export const PLAYWRIGHT_RUN_RECEIPT_VERSION =
  "diesel-playwright-run-v1" as const;
export const PLAYWRIGHT_EVIDENCE_VERSION =
  "diesel-playwright-evidence-v1" as const;
export const EXPECTED_PLAYWRIGHT_VERSION = "1.62.0" as const;
export const playwrightEvidencePath =
  "docs/evidence/playwright-e2e-latest.json" as const;
export const PLAYWRIGHT_TEST_SOURCE_MAX_BYTES = 2 * 1024 * 1024;
export const PLAYWRIGHT_EVIDENCE_CAPTURE_ENVIRONMENT_VARIABLE =
  "DIESEL_PLAYWRIGHT_EVIDENCE_CAPTURE" as const;
export const PLAYWRIGHT_FORBIDDEN_WORKSPACE_PACKAGE_MANAGER_PATHS = [
  ".npmrc",
  ".pnpmfile.cjs",
] as const;

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : undefined;
}

export function shouldForbidOnlyInPlaywrightRun(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return Boolean(environment.CI) ||
    environment[PLAYWRIGHT_EVIDENCE_CAPTURE_ENVIRONMENT_VARIABLE] === "1";
}

export function buildPlaywrightEvidenceCaptureEnvironment(
  input: Readonly<{
    toolDirectory: string;
  }>,
): Readonly<Record<string, string>> {
  const configuredToolDirectory = resolve(input.toolDirectory);
  const physicalToolDirectory = realpathSync(configuredToolDirectory);
  const toolDirectoryMetadata = lstatSync(configuredToolDirectory);
  if (
    physicalToolDirectory !== configuredToolDirectory ||
    toolDirectoryMetadata.isSymbolicLink() ||
    !toolDirectoryMetadata.isDirectory() ||
    (toolDirectoryMetadata.mode & 0o777) !== 0o700
  ) {
    throw new Error(
      "Playwright evidence tool directory must be a private physical directory.",
    );
  }

  const privateTemporaryDirectory = resolve(physicalToolDirectory, ".tmp");
  const temporaryDirectoryMetadata = lstatSync(privateTemporaryDirectory);
  if (
    realpathSync(privateTemporaryDirectory) !== privateTemporaryDirectory ||
    temporaryDirectoryMetadata.isSymbolicLink() ||
    !temporaryDirectoryMetadata.isDirectory() ||
    (temporaryDirectoryMetadata.mode & 0o777) !== 0o700
  ) {
    throw new Error(
      "Playwright evidence TMPDIR must be a private physical directory.",
    );
  }

  const privateUserConfig = resolve(physicalToolDirectory, ".npmrc-user");
  const privateGlobalConfig = resolve(physicalToolDirectory, ".npmrc-global");
  for (const [path, label] of [
    [privateUserConfig, "user"],
    [privateGlobalConfig, "global"],
  ] as const) {
    const metadata = lstatSync(path);
    if (
      realpathSync(path) !== path ||
      metadata.isSymbolicLink() ||
      !metadata.isFile() ||
      metadata.size !== 0 ||
      (metadata.mode & 0o777) !== 0o600
    ) {
      throw new Error(
        `Playwright evidence npm ${label} config must be an empty private physical file.`,
      );
    }
  }

  const privateConfigurationDirectory = resolve(
    physicalToolDirectory,
    ".config",
  );
  const configurationDirectoryMetadata = lstatSync(
    privateConfigurationDirectory,
  );
  if (
    realpathSync(privateConfigurationDirectory) !==
      privateConfigurationDirectory ||
    configurationDirectoryMetadata.isSymbolicLink() ||
    !configurationDirectoryMetadata.isDirectory() ||
    (configurationDirectoryMetadata.mode & 0o777) !== 0o700
  ) {
    throw new Error(
      "Playwright evidence XDG_CONFIG_HOME must be a private physical directory.",
    );
  }

  let physicalHome: string;
  try {
    physicalHome = realpathSync(resolve(userInfo().homedir));
    const homeMetadata = lstatSync(physicalHome);
    if (homeMetadata.isSymbolicLink() || !homeMetadata.isDirectory()) {
      throw new Error();
    }
  } catch (cause: unknown) {
    throw new Error(
      "Playwright evidence operating-system HOME is unavailable.",
      { cause },
    );
  }

  return {
    __NEXT_PROCESSED_ENV: "true",
    HOME: physicalHome,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    NPM_CONFIG_GLOBALCONFIG: privateGlobalConfig,
    NPM_CONFIG_IGNORE_PNPMFILE: "true",
    NPM_CONFIG_OFFLINE: "true",
    NPM_CONFIG_USERCONFIG: privateUserConfig,
    NPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: "false",
    NO_COLOR: "1",
    PATH: `${physicalToolDirectory}${delimiter}/usr/bin${delimiter}/bin`,
    PNPM_CONFIG_IGNORE_PNPMFILE: "true",
    PNPM_CONFIG_NODE_EXPERIMENTAL_PACKAGE_MAP: "false",
    PNPM_CONFIG_OFFLINE: "true",
    PNPM_CONFIG_SCRIPT_SHELL: "/bin/sh",
    PNPM_CONFIG_SHELL_EMULATOR: "false",
    PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: "false",
    TMPDIR: privateTemporaryDirectory,
    TZ: "UTC",
    XDG_CONFIG_HOME: privateConfigurationDirectory,
    [PLAYWRIGHT_EVIDENCE_CAPTURE_ENVIRONMENT_VARIABLE]: "1",
  } satisfies Readonly<Record<string, string>>;
}

export function assertPlaywrightWorkspacePackageManagerConfigurationAbsent(
  workspaceInput: string,
): void {
  const configuredWorkspace = resolve(workspaceInput);
  const workspace = realpathSync(configuredWorkspace);
  if (workspace !== configuredWorkspace) {
    throw new Error(
      "Playwright evidence workspace must not traverse a symbolic link.",
    );
  }
  for (
    const relativePath of PLAYWRIGHT_FORBIDDEN_WORKSPACE_PACKAGE_MANAGER_PATHS
  ) {
    const path = resolve(workspace, relativePath);
    try {
      lstatSync(path);
    } catch (cause: unknown) {
      if (errorCode(cause) === "ENOENT") continue;
      throw new Error(
        `Playwright evidence could not verify the absence of ${relativePath}.`,
        { cause },
      );
    }
    throw new Error(
      `Playwright evidence requires ${relativePath} to be absent.`,
    );
  }
}

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const gitShaSchema = z.string().regex(/^[0-9a-f]{40}$/u);
const timestampSchema = z.iso.datetime({ offset: true });
const relativePathSchema = z.string().min(1).max(500).refine(
  (value) =>
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    value.split("/").every((segment) => segment !== "" && segment !== ".."),
  "Expected a normalized repository-relative path.",
);

export const playwrightRunContracts = [
  {
    command: "pnpm test:e2e",
    cliArguments: ["test"],
    configPath: "playwright.config.ts",
    id: "public",
    projects: [
      "desktop-chromium",
      "mobile-chromium",
      "core-webkit",
      "global-error-chromium",
      "knowledge-chromium",
    ],
    receiptPath: "test-results/public/playwright-run.json",
  },
  {
    command: "pnpm test:e2e:demo",
    cliArguments: ["test", "--config", "playwright.demo.config.ts"],
    configPath: "playwright.demo.config.ts",
    id: "demo",
    projects: [
      "portfolio-demo-chromium",
      "portfolio-demo-mobile-chromium",
    ],
    receiptPath: "test-results/demo/playwright-run.json",
  },
  {
    command: "pnpm test:e2e:fde",
    cliArguments: ["test", "--config", "playwright.fde.config.ts"],
    configPath: "playwright.fde.config.ts",
    id: "fde",
    projects: ["fde-demo-desktop", "fde-demo-mobile"],
    receiptPath: "test-results/fde/playwright-run.json",
  },
  {
    command: "pnpm test:e2e:csp:production",
    cliArguments: ["test", "--config", "playwright.production.config.ts"],
    configPath: "playwright.production.config.ts",
    id: "production-csp",
    projects: ["production-csp-chromium"],
    receiptPath: "test-results/production-csp/playwright-run.json",
  },
] as const;

export type PlaywrightRunId = (typeof playwrightRunContracts)[number]["id"];

const playwrightRunIdSchema = z.enum(
  playwrightRunContracts.map(({ id }) => id) as [
    PlaywrightRunId,
    ...PlaywrightRunId[],
  ],
);

export const playwrightSourceFingerprintSchema = z.object({
  algorithm: z.literal("sha256"),
  digest: sha256Schema,
  fileCount: z.number().int().positive(),
}).strict();

export type PlaywrightSourceFingerprint = z.infer<
  typeof playwrightSourceFingerprintSchema
>;

export const playwrightRepositoryStateSchema = z.object({
  headCommit: gitShaSchema,
  sourceFingerprint: playwrightSourceFingerprintSchema,
  worktreeState: z.enum(["clean", "dirty"]),
}).strict();

export type PlaywrightRepositoryState = z.infer<
  typeof playwrightRepositoryStateSchema
>;

const testStatusSchema = z.enum([
  "passed",
  "failed",
  "timedOut",
  "skipped",
  "interrupted",
]);

const testOutcomeSchema = z.enum([
  "expected",
  "skipped",
  "unexpected",
  "flaky",
]);

export const playwrightTestObservationSchema = z.object({
  attempts: z.number().int().nonnegative().max(10),
  expectedStatus: testStatusSchema,
  file: relativePathSchema.refine(
    (value) => value.startsWith("e2e/"),
    "Playwright evidence may only identify e2e test files.",
  ),
  finalStatus: testStatusSchema,
  id: z.string().min(1).max(300).regex(/^[A-Za-z0-9_-]+$/u),
  line: z.number().int().positive(),
  outcome: testOutcomeSchema,
  project: z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/u),
  retryCount: z.number().int().nonnegative().max(10),
}).strict();

export type PlaywrightTestObservation = z.infer<
  typeof playwrightTestObservationSchema
>;

export type PlaywrightTestInventoryEntry = Pick<
  PlaywrightTestObservation,
  "project" | "id" | "file" | "line" | "expectedStatus"
>;

export const playwrightResultCountsSchema = z.object({
  collected: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  flaky: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
}).strict();

export type PlaywrightResultCounts = z.infer<
  typeof playwrightResultCountsSchema
>;

const projectResultSchema = z.object({
  counts: playwrightResultCountsSchema,
  name: z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/u),
}).strict();

export const playwrightRunReceiptSchema = z.object({
  command: z.string().min(1).max(100),
  complete: z.boolean(),
  completedAt: timestampSchema,
  configPath: relativePathSchema,
  exitCode: z.union([z.literal(0), z.literal(1)]),
  globalErrorCount: z.number().int().nonnegative(),
  id: playwrightRunIdSchema,
  playwrightVersion: z.literal(EXPECTED_PLAYWRIGHT_VERSION),
  projects: z.array(projectResultSchema).min(1).max(10),
  provenance: z.object({
    completed: playwrightRepositoryStateSchema,
    evaluatedCommit: gitShaSchema.nullable(),
    started: playwrightRepositoryStateSchema,
  }).strict(),
  runStatus: z.enum(["passed", "failed", "timedout", "interrupted"]),
  startedAt: timestampSchema,
  tests: z.array(playwrightTestObservationSchema).min(1).max(2_000),
  totals: playwrightResultCountsSchema,
  version: z.literal(PLAYWRIGHT_RUN_RECEIPT_VERSION),
}).strict();

export type PlaywrightRunReceipt = z.infer<
  typeof playwrightRunReceiptSchema
>;

export const playwrightEvidenceSchema = z.object({
  complete: z.boolean(),
  evaluatedAt: timestampSchema,
  provenance: z.object({
    baseHeadCommit: gitShaSchema,
    evaluatedCommit: gitShaSchema.nullable(),
    sourceFingerprint: playwrightSourceFingerprintSchema,
    worktreeState: z.enum(["clean", "dirty"]),
  }).strict(),
  runId: z.string().uuid(),
  runs: z.array(playwrightRunReceiptSchema).length(
    playwrightRunContracts.length,
  ),
  totals: playwrightResultCountsSchema,
  version: z.literal(PLAYWRIGHT_EVIDENCE_VERSION),
}).strict();

export type PlaywrightEvidence = z.infer<typeof playwrightEvidenceSchema>;

export const playwrightSourcePathspecs = [
  ".npmrc",
  ".nvmrc",
  ".pnpmfile.cjs",
  "components.json",
  "drizzle",
  "drizzle.config.ts",
  "e2e",
  "next.config.ts",
  "package.json",
  "patches",
  "playwright.config.ts",
  "playwright.demo.config.ts",
  "playwright.fde.config.ts",
  "playwright.production.config.ts",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "postcss.config.mjs",
  "public",
  "scripts/demo",
  "scripts/e2e",
  "scripts/format-error.ts",
  "scripts/next-build.ts",
  "scripts/maplibre-worker-assets.ts",
  "scripts/next-environment-file.ts",
  "scripts/portfolio",
  "src",
  // The fixture's next-env.d.ts is generated while its Next dev server is
  // running and restored by the server guard during global teardown. Fingerprint
  // the authored fixture inputs explicitly so that lifecycle-only generated
  // bytes cannot make an otherwise stable canonical run appear to edit source.
  "tests/fixtures/global-error-app/app",
  "tests/fixtures/global-error-app/next.config.ts",
  "tests/fixtures/global-error-app/tsconfig.json",
  "tsconfig.json",
] as const;

function comparePaths(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function assertContainedRegularFile(workspace: string, path: string): string {
  const absolutePath = resolve(workspace, path);
  const workspacePrefix = `${realpathSync(workspace)}${sep}`;
  const resolvedPath = realpathSync(absolutePath);
  if (!resolvedPath.startsWith(workspacePrefix)) {
    throw new Error(`Playwright source path escaped the workspace: ${path}`);
  }
  const metadata = lstatSync(absolutePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Playwright source path is not a regular file: ${path}`);
  }
  return absolutePath;
}

const playwrightTestSourcePathPattern =
  /^e2e\/(?:[^/]+\/)*[^/]+\.(?:spec|test)\.[cm]?[jt]sx?$/u;

function readPlaywrightTestSource(
  workspace: string,
  path: string,
): string {
  const safePath = relativePathSchema.parse(path);
  if (!playwrightTestSourcePathPattern.test(safePath)) {
    throw new Error(
      `Playwright observation does not identify an e2e spec/test source: ${safePath}`,
    );
  }
  const resolvedWorkspace = realpathSync(workspace);
  const absolutePath = resolve(resolvedWorkspace, safePath);
  const workspacePrefix = `${resolvedWorkspace}${sep}`;
  if (!absolutePath.startsWith(workspacePrefix)) {
    throw new Error(`Playwright observation escaped the workspace: ${safePath}`);
  }
  let metadata: ReturnType<typeof lstatSync>;
  try {
    metadata = lstatSync(absolutePath);
  } catch {
    throw new Error(`Playwright observation source is missing: ${safePath}`);
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(
      `Playwright observation source must be a regular non-symlink file: ${safePath}`,
    );
  }
  const resolvedPath = realpathSync(absolutePath);
  if (!resolvedPath.startsWith(workspacePrefix)) {
    throw new Error(`Playwright observation escaped the workspace: ${safePath}`);
  }
  if (metadata.size > PLAYWRIGHT_TEST_SOURCE_MAX_BYTES) {
    throw new Error(
      `Playwright observation source exceeds the 2 MiB limit: ${safePath}`,
    );
  }
  const bytes = readFileSync(absolutePath);
  if (bytes.byteLength !== metadata.size) {
    throw new Error(
      `Playwright observation source changed while it was read: ${safePath}`,
    );
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(
      `Playwright observation source is not valid UTF-8: ${safePath}`,
    );
  }
}

function sourceLineCount(source: string): number {
  if (source.length === 0) return 0;
  const lines = source.split(/\r\n|\r|\n/u);
  if (lines.at(-1) === "") lines.pop();
  return lines.length;
}

export function assertPlaywrightObservationSourceLocations(
  workspace: string,
  observationsInput: readonly PlaywrightTestObservation[],
): void {
  const observations = z.array(playwrightTestObservationSchema)
    .max(2_000)
    .parse(observationsInput);
  const lineCounts = new Map<string, number>();
  for (const observation of observations) {
    let lineCount = lineCounts.get(observation.file);
    if (lineCount === undefined) {
      lineCount = sourceLineCount(
        readPlaywrightTestSource(workspace, observation.file),
      );
      lineCounts.set(observation.file, lineCount);
    }
    if (observation.line > lineCount) {
      throw new Error(
        `Playwright observation line is outside its source: ${observation.file}:${observation.line} (source has ${lineCount} lines).`,
      );
    }
  }
}

export function toPlaywrightTestInventory(
  observations: readonly PlaywrightTestObservation[],
): PlaywrightTestInventoryEntry[] {
  return observations
    .map(({ expectedStatus, file, id, line, project }) => ({
      project,
      id,
      file,
      line,
      expectedStatus,
    }))
    .sort((left, right) =>
      comparePaths(
        `${left.project}\0${left.id}\0${left.file}\0${String(left.line).padStart(8, "0")}\0${left.expectedStatus}`,
        `${right.project}\0${right.id}\0${right.file}\0${String(right.line).padStart(8, "0")}\0${right.expectedStatus}`,
      )
    );
}

export function assertPlaywrightReceiptInventoryMatchesEvidence(
  receipt: PlaywrightRunReceipt,
  evidence: PlaywrightEvidence,
): void {
  const evidenceRun = evidence.runs.find(({ id }) => id === receipt.id);
  if (!evidenceRun) {
    throw new Error(
      `Checked-in Playwright evidence is missing the ${receipt.id} run inventory.`,
    );
  }
  assertVerificationEqual(
    toPlaywrightTestInventory(receipt.tests),
    toPlaywrightTestInventory(evidenceRun.tests),
    `${receipt.id} receipt/checked-in Playwright inventory`,
  );
}

export function capturePlaywrightRepositoryState(
  workspace: string,
  gitExecutable?: string,
): PlaywrightRepositoryState {
  const resolvedWorkspace = realpathSync(workspace);
  const headCommit = runTrustedGit(
    resolvedWorkspace,
    ["rev-parse", "HEAD"],
    gitExecutable,
  )
    .toString("utf8")
    .trim();
  gitShaSchema.parse(headCommit);

  const listedPaths = runTrustedGit(resolvedWorkspace, [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    ...playwrightSourcePathspecs,
  ], gitExecutable)
    .toString("utf8")
    .split("\0")
    .filter((value) => value.length > 0)
    .sort(comparePaths);
  const uniquePaths = [...new Set(listedPaths)];
  if (uniquePaths.length === 0) {
    throw new Error("Playwright source fingerprint did not contain any files.");
  }

  const hash = createHash("sha256");
  for (const path of uniquePaths) {
    relativePathSchema.parse(path);
    const bytes = readFileSync(
      assertContainedRegularFile(resolvedWorkspace, path),
    );
    hash.update(`${Buffer.byteLength(path, "utf8")}:`, "utf8");
    hash.update(path, "utf8");
    hash.update(`${bytes.byteLength}:`, "utf8");
    hash.update(bytes);
  }

  const worktreeBytes = runTrustedGit(resolvedWorkspace, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "-z",
  ], gitExecutable);
  return playwrightRepositoryStateSchema.parse({
    headCommit,
    sourceFingerprint: {
      algorithm: "sha256",
      digest: hash.digest("hex"),
      fileCount: uniquePaths.length,
    },
    worktreeState: worktreeBytes.byteLength === 0 ? "clean" : "dirty",
  });
}

export function capturePlaywrightSourceFingerprintAtRevision(
  workspace: string,
  revision: string,
  gitExecutable?: string,
): PlaywrightSourceFingerprint {
  const resolvedWorkspace = realpathSync(workspace);
  gitShaSchema.parse(revision);
  const resolvedRevision = runTrustedGit(
    resolvedWorkspace,
    ["rev-parse", "--verify", `${revision}^{commit}`],
    gitExecutable,
  ).toString("utf8").trim();
  if (resolvedRevision !== revision) {
    throw new Error("Playwright evaluated commit did not resolve exactly.");
  }
  const records = runTrustedGit(
    resolvedWorkspace,
    ["ls-tree", "-r", "-z", revision, "--", ...playwrightSourcePathspecs],
    gitExecutable,
  ).toString("utf8").split("\0").filter((value) => value.length > 0);
  const entries = records.map((record) => {
    const match = /^(?:100644|100755) blob ([0-9a-f]{40})\t(.+)$/u.exec(record);
    if (!match?.[1] || !match[2]) {
      throw new Error("Playwright commit source inventory contains a non-file entry.");
    }
    relativePathSchema.parse(match[2]);
    return { objectId: match[1], path: match[2] };
  }).sort((left, right) => comparePaths(left.path, right.path));
  if (
    entries.length === 0 ||
    new Set(entries.map(({ path }) => path)).size !== entries.length
  ) {
    throw new Error("Playwright commit source inventory is empty or ambiguous.");
  }
  const hash = createHash("sha256");
  for (const entry of entries) {
    const bytes = runTrustedGit(
      resolvedWorkspace,
      ["cat-file", "blob", entry.objectId],
      gitExecutable,
    );
    hash.update(`${Buffer.byteLength(entry.path, "utf8")}:`, "utf8");
    hash.update(entry.path, "utf8");
    hash.update(`${bytes.byteLength}:`, "utf8");
    hash.update(bytes);
  }
  return playwrightSourceFingerprintSchema.parse({
    algorithm: "sha256",
    digest: hash.digest("hex"),
    fileCount: entries.length,
  });
}

function summarizeTests(
  tests: readonly PlaywrightTestObservation[],
): PlaywrightResultCounts {
  const counts: PlaywrightResultCounts = {
    collected: tests.length,
    failed: 0,
    flaky: 0,
    passed: 0,
    skipped: 0,
  };
  for (const test of tests) {
    if (test.outcome === "expected") counts.passed += 1;
    else if (test.outcome === "skipped") counts.skipped += 1;
    else if (test.outcome === "flaky") counts.flaky += 1;
    else counts.failed += 1;
  }
  return counts;
}

function assertTestOutcomeSemantics(test: PlaywrightTestObservation): void {
  if (test.attempts === 0) {
    throw new Error(`Playwright test has no recorded execution attempt: ${test.id}`);
  }
  if (
    test.outcome === "expected" &&
    (test.expectedStatus !== "passed" || test.finalStatus !== "passed")
  ) {
    throw new Error(
      `Playwright evidence does not treat expected failures as passes: ${test.id}`,
    );
  }
  if (test.outcome === "skipped" && test.finalStatus !== "skipped") {
    throw new Error(`Skipped Playwright test has a non-skipped result: ${test.id}`);
  }
  if (
    test.outcome === "flaky" &&
    (test.finalStatus !== "passed" || test.attempts < 2)
  ) {
    throw new Error(`Flaky Playwright test has an invalid retry history: ${test.id}`);
  }
  if (
    (test.outcome === "expected" || test.outcome === "skipped") &&
    (test.attempts !== 1 || test.retryCount !== 0)
  ) {
    throw new Error(
      `Non-flaky Playwright test has an invalid retry history: ${test.id}`,
    );
  }
  if (test.retryCount !== test.attempts - 1) {
    throw new Error(`Playwright test has an inconsistent retry history: ${test.id}`);
  }
}

function assertOrderedRunWindows(
  runs: readonly Pick<PlaywrightRunReceipt, "completedAt" | "startedAt">[],
): void {
  for (let index = 1; index < runs.length; index += 1) {
    const prior = runs[index - 1];
    const current = runs[index];
    if (
      prior && current &&
      Date.parse(current.startedAt) < Date.parse(prior.completedAt)
    ) {
      throw new Error("Playwright evidence run windows overlap or are out of order.");
    }
  }
}

function assertResultArithmetic(
  counts: PlaywrightResultCounts,
  label: string,
): void {
  assertVerificationEqual(
    counts.passed + counts.skipped + counts.failed + counts.flaky,
    counts.collected,
    `${label} result arithmetic`,
  );
}

export function assertPlaywrightRunReceipt(
  receiptInput: PlaywrightRunReceipt,
  expectedId: PlaywrightRunId = receiptInput.id,
): void {
  const receipt = playwrightRunReceiptSchema.parse(receiptInput);
  const contract = playwrightRunContracts.find(({ id }) => id === expectedId);
  if (!contract) throw new Error(`Unknown Playwright run contract: ${expectedId}`);
  assertVerificationEqual(receipt.id, contract.id, "Playwright suite ID");
  assertVerificationEqual(receipt.command, contract.command, `${expectedId} command`);
  assertVerificationEqual(
    receipt.configPath,
    contract.configPath,
    `${expectedId} config path`,
  );
  assertVerificationEqual(
    receipt.projects.map(({ name }) => name),
    [...contract.projects],
    `${expectedId} project matrix`,
  );
  const expectedProjectNames = new Set<string>(contract.projects);
  if (Date.parse(receipt.completedAt) < Date.parse(receipt.startedAt)) {
    throw new Error(`${expectedId} completion precedes its start time.`);
  }
  const seenTestIds = new Set<string>();
  for (const test of receipt.tests) {
    if (!expectedProjectNames.has(test.project)) {
      throw new Error(`${expectedId} contains an unexpected project: ${test.project}`);
    }
    const identity = `${test.project}\0${test.id}`;
    if (seenTestIds.has(identity)) {
      throw new Error(`${expectedId} contains a duplicate test identity.`);
    }
    seenTestIds.add(identity);
    assertTestOutcomeSemantics(test);
  }
  const expectedProjects = contract.projects.map((name) => ({
    counts: summarizeTests(receipt.tests.filter((test) => test.project === name)),
    name,
  }));
  assertVerificationEqual(
    receipt.projects,
    expectedProjects,
    `${expectedId} project summaries`,
  );
  if (receipt.projects.some(({ counts }) => counts.collected === 0)) {
    throw new Error(`${expectedId} evidence contains an empty project.`);
  }
  if (receipt.projects.some(({ counts }) => counts.passed === 0)) {
    throw new Error(
      `${expectedId} evidence requires at least one passing test per project.`,
    );
  }
  const expectedTotals = summarizeTests(receipt.tests);
  assertResultArithmetic(receipt.totals, `${expectedId} total`);
  assertVerificationEqual(receipt.totals, expectedTotals, `${expectedId} totals`);
  assertVerificationEqual(
    receipt.provenance.started,
    receipt.provenance.completed,
    `${expectedId} evaluated source stability`,
  );
  const expectedEvaluatedCommit =
    receipt.provenance.started.worktreeState === "clean"
      ? receipt.provenance.started.headCommit
      : null;
  assertVerificationEqual(
    receipt.provenance.evaluatedCommit,
    expectedEvaluatedCommit,
    `${expectedId} evaluated commit provenance`,
  );
  const expectedComplete =
    receipt.runStatus === "passed" &&
    receipt.exitCode === 0 &&
    receipt.globalErrorCount === 0 &&
    receipt.totals.failed === 0 &&
    receipt.totals.flaky === 0;
  assertVerificationEqual(
    receipt.complete,
    expectedComplete,
    `${expectedId} completion state`,
  );
}

export type BuildPlaywrightRunReceiptInput = {
  completedAt: string;
  globalErrorCount: number;
  id: PlaywrightRunId;
  playwrightVersion: string;
  provenance: {
    completed: PlaywrightRepositoryState;
    started: PlaywrightRepositoryState;
  };
  runStatus: PlaywrightRunReceipt["runStatus"];
  startedAt: string;
  tests: readonly PlaywrightTestObservation[];
};

export function buildPlaywrightRunReceipt(
  input: BuildPlaywrightRunReceiptInput,
): PlaywrightRunReceipt {
  const contract = playwrightRunContracts.find(({ id }) => id === input.id);
  if (!contract) throw new Error(`Unknown Playwright run contract: ${input.id}`);
  const tests = [...input.tests].sort((left, right) =>
    comparePaths(
      `${left.project}\0${left.file}\0${String(left.line).padStart(8, "0")}\0${left.id}`,
      `${right.project}\0${right.file}\0${String(right.line).padStart(8, "0")}\0${right.id}`,
    )
  );
  const totals = summarizeTests(tests);
  const exitCode = input.runStatus === "passed" ? 0 : 1;
  const receipt = playwrightRunReceiptSchema.parse({
    command: contract.command,
    complete:
      input.runStatus === "passed" &&
      input.globalErrorCount === 0 &&
      totals.failed === 0 &&
      totals.flaky === 0 &&
      JSON.stringify(input.provenance.started) ===
        JSON.stringify(input.provenance.completed),
    completedAt: input.completedAt,
    configPath: contract.configPath,
    exitCode,
    globalErrorCount: input.globalErrorCount,
    id: input.id,
    playwrightVersion: input.playwrightVersion,
    projects: contract.projects.map((name) => ({
      counts: summarizeTests(tests.filter((test) => test.project === name)),
      name,
    })),
    provenance: {
      ...input.provenance,
      evaluatedCommit:
        input.provenance.started.worktreeState === "clean" &&
          JSON.stringify(input.provenance.started) ===
            JSON.stringify(input.provenance.completed)
          ? input.provenance.started.headCommit
          : null,
    },
    runStatus: input.runStatus,
    startedAt: input.startedAt,
    tests,
    totals,
    version: PLAYWRIGHT_RUN_RECEIPT_VERSION,
  });
  assertPlaywrightRunReceipt(receipt, input.id);
  return receipt;
}

export function buildPlaywrightEvidence(
  receiptsInput: readonly PlaywrightRunReceipt[],
  runId: string,
): PlaywrightEvidence {
  z.string().uuid().parse(runId);
  if (receiptsInput.length !== playwrightRunContracts.length) {
    throw new Error("Playwright evidence requires every run exactly once.");
  }
  const receiptsById = new Map(receiptsInput.map((receipt) => [receipt.id, receipt]));
  if (receiptsById.size !== playwrightRunContracts.length) {
    throw new Error("Playwright evidence requires every run exactly once.");
  }
  const runs = playwrightRunContracts.map(({ id }) => {
    const receipt = receiptsById.get(id);
    if (!receipt) throw new Error(`Playwright evidence is missing ${id}.`);
    assertPlaywrightRunReceipt(receipt, id);
    return receipt;
  });
  const firstState = runs[0]?.provenance.started;
  if (!firstState) throw new Error("Playwright evidence has no repository state.");
  for (const run of runs) {
    assertVerificationEqual(
      run.provenance.started,
      firstState,
      `${run.id} common evaluated source`,
    );
  }
  assertOrderedRunWindows(runs);
  const totals = runs.reduce<PlaywrightResultCounts>(
    (result, run) => ({
      collected: result.collected + run.totals.collected,
      failed: result.failed + run.totals.failed,
      flaky: result.flaky + run.totals.flaky,
      passed: result.passed + run.totals.passed,
      skipped: result.skipped + run.totals.skipped,
    }),
    { collected: 0, failed: 0, flaky: 0, passed: 0, skipped: 0 },
  );
  const lastRun = runs.at(-1);
  if (!lastRun) throw new Error("Playwright evidence has no completion time.");
  const evidence = playwrightEvidenceSchema.parse({
    complete: runs.every((run) => run.complete) && totals.failed === 0 &&
      totals.flaky === 0,
    evaluatedAt: lastRun.completedAt,
    provenance: {
      baseHeadCommit: firstState.headCommit,
      evaluatedCommit:
        firstState.worktreeState === "clean" ? firstState.headCommit : null,
      sourceFingerprint: firstState.sourceFingerprint,
      worktreeState: firstState.worktreeState,
    },
    runId,
    runs,
    totals,
    version: PLAYWRIGHT_EVIDENCE_VERSION,
  });
  assertPlaywrightEvidence(evidence);
  return evidence;
}

export function assertPlaywrightEvidence(
  evidenceInput: PlaywrightEvidence,
): void {
  const evidence = playwrightEvidenceSchema.parse(evidenceInput);
  assertVerificationEqual(
    evidence.runs.map(({ id }) => id),
    playwrightRunContracts.map(({ id }) => id),
    "Playwright evidence run matrix",
  );
  for (const run of evidence.runs) assertPlaywrightRunReceipt(run, run.id);
  const rebuilt = buildEvidenceSummaryWithoutRecursion(evidence.runs);
  assertVerificationEqual(evidence.totals, rebuilt.totals, "Playwright evidence totals");
  assertVerificationEqual(
    evidence.evaluatedAt,
    rebuilt.evaluatedAt,
    "Playwright evidence completion time",
  );
  assertVerificationEqual(
    evidence.provenance,
    rebuilt.provenance,
    "Playwright evidence provenance",
  );
  assertVerificationEqual(
    evidence.complete,
    rebuilt.complete,
    "Playwright evidence completion state",
  );
  if (!evidence.complete) {
    throw new Error("Checked-in Playwright evidence must be a complete passing run.");
  }
}

function buildEvidenceSummaryWithoutRecursion(
  runs: readonly PlaywrightRunReceipt[],
): Pick<PlaywrightEvidence, "complete" | "evaluatedAt" | "provenance" | "totals"> {
  const first = runs[0];
  const last = runs.at(-1);
  if (!first || !last) throw new Error("Playwright evidence has no runs.");
  for (const run of runs) {
    assertVerificationEqual(
      run.provenance.started,
      first.provenance.started,
      `${run.id} common evaluated source`,
    );
  }
  assertOrderedRunWindows(runs);
  const totals = runs.reduce<PlaywrightResultCounts>(
    (result, run) => ({
      collected: result.collected + run.totals.collected,
      failed: result.failed + run.totals.failed,
      flaky: result.flaky + run.totals.flaky,
      passed: result.passed + run.totals.passed,
      skipped: result.skipped + run.totals.skipped,
    }),
    { collected: 0, failed: 0, flaky: 0, passed: 0, skipped: 0 },
  );
  return {
    complete: runs.every((run) => run.complete) && totals.failed === 0 &&
      totals.flaky === 0,
    evaluatedAt: last.completedAt,
    provenance: {
      baseHeadCommit: first.provenance.started.headCommit,
      evaluatedCommit:
        first.provenance.started.worktreeState === "clean"
          ? first.provenance.started.headCommit
          : null,
      sourceFingerprint: first.provenance.started.sourceFingerprint,
      worktreeState: first.provenance.started.worktreeState,
    },
    totals,
  };
}

function parseCanonicalDocument<T>(
  text: string,
  schema: z.ZodType<T>,
  label: string,
): T {
  if (Buffer.byteLength(text, "utf8") > 2 * 1024 * 1024) {
    throw new Error(`${label} exceeds the 2 MiB evidence limit.`);
  }
  if (text.includes("\r") || text.includes("\0")) {
    throw new Error(`${label} contains unsupported control characters.`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause: unknown) {
    throw new Error(`${label} is not valid JSON.`, { cause });
  }
  if (text !== `${JSON.stringify(value, null, 2)}\n`) {
    throw new Error(`${label} must use canonical two-space JSON with one final newline.`);
  }
  return schema.parse(value);
}

export function parseCanonicalPlaywrightRunReceipt(
  text: string,
): PlaywrightRunReceipt {
  const receipt = parseCanonicalDocument(
    text,
    playwrightRunReceiptSchema,
    "Playwright run receipt",
  );
  assertPlaywrightRunReceipt(receipt);
  return receipt;
}

export function parseCanonicalPlaywrightEvidence(
  text: string,
): PlaywrightEvidence {
  const evidence = parseCanonicalDocument(
    text,
    playwrightEvidenceSchema,
    "Playwright evidence",
  );
  assertPlaywrightEvidence(evidence);
  return evidence;
}

export function serializeCanonicalPlaywrightEvidence(
  evidence: PlaywrightEvidence,
): string {
  assertPlaywrightEvidence(evidence);
  return `${JSON.stringify(evidence, null, 2)}\n`;
}

export function serializeCanonicalPlaywrightRunReceipt(
  receipt: PlaywrightRunReceipt,
): string {
  assertPlaywrightRunReceipt(receipt);
  return `${JSON.stringify(receipt, null, 2)}\n`;
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function toRepositoryRelativePath(
  workspace: string,
  absolutePath: string,
): string {
  const path = relative(resolve(workspace), resolve(absolutePath)).split(sep).join("/");
  return relativePathSchema.parse(path);
}
