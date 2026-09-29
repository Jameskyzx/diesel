import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import vitestConfig from "../vitest.config";

import {
  VITEST_EXECUTION_EVIDENCE_MAX_BYTES,
  VITEST_EXECUTION_EVIDENCE_VERSION,
  VITEST_JSON_REPORTER_MAX_BYTES,
  assertVitestListInventoryMatchesEvidence,
  assertVitestExecutionInventoryMatchesEvidence,
  buildVitestExecutionEvidence,
  captureVitestExecutionRepositoryState,
  captureVitestExecutionSourceFingerprintAtRevision,
  normalizeVitestJsonReporterOutput,
  normalizeVitestListJson,
  parseVitestJsonReporterOutput,
  parseCanonicalVitestExecutionEvidence,
  serializeCanonicalVitestExecutionEvidence,
  toVitestExecutionInventory,
  vitestExecutionEvidencePath,
  type NormalizedVitestJsonReport,
  type VitestExecutionEvidence,
  type VitestExecutionRepositoryState,
} from "../scripts/portfolio/vitest-execution-evidence";
import {
  acquireVitestExecutionCaptureLock,
  assertNoOrphanedVitestExecutionStagingFiles,
  assertVitestProcessGroupInventoryCapabilityOutput,
  assertVitestExecutionWorkspaceContract,
  assertVitestVersionOutput,
  buildVitestExecutionCaptureEnvironment,
  buildVitestPnpmCommandArguments,
  buildSupervisedVitestCommandArguments,
  buildVitestSupervisorArguments,
  captureVitestExecutionEvidence,
  createVitestExecutionToolBin,
  formatVitestExecutionCaptureError,
  initializeVitestExecutionCaptureToolState,
  parseVitestSupervisorDiagnostic,
  persistVitestExecutionEvidence,
  resolvePnpmEntrypoint,
  runCanonicalVitestExecution,
  runSupervisedVitestList,
  VitestWorkloadTerminationUnprovenError,
} from "../scripts/portfolio/capture-vitest-execution-evidence";
import { VITEST_EXECUTION_CAPTURE_LOCK_NAME } from "../scripts/portfolio/vitest-execution-capture-lock";
import {
  restoreVitestTimeoutMessages,
  type VitestReporterErrorObservations,
} from "../scripts/portfolio/vitest-reporter-diagnostics";

const temporaryWorkspaces: string[] = [];
const temporaryLockPaths: string[] = [];
const RUN_ID = "123e4567-e89b-42d3-a456-426614174000";

describe("Vitest capture error diagnostics", () => {
  it("renders aggregate members, causes, and non-Error failures", () => {
    const root = new Error("root", { cause: "low-level" });
    const error = new AggregateError(
      [root, undefined],
      "capture and cleanup failed",
    );

    expect(formatVitestExecutionCaptureError(error)).toBe(
      "capture: AggregateError: capture and cleanup failed\n" +
        "capture.errors[0]: Error: root\n" +
        "capture.errors[0].cause: low-level\n" +
        "capture.errors[1]: undefined\n",
    );
  });

  it("parses only one bounded canonical supervisor reason", () => {
    expect(parseVitestSupervisorDiagnostic(
      Buffer.from("bounded-command-v2:group-inventory\n"),
    )).toBe("group-inventory");
    expect(parseVitestSupervisorDiagnostic(Buffer.alloc(0))).toBeNull();
    expect(() => parseVitestSupervisorDiagnostic(
      Buffer.from("warning\nbounded-command-v2:group-inventory\n"),
    )).toThrow(/one fixed canonical line/u);
  });
});

describe("Vitest process-group supervision", () => {
  it("runs the canonical suite behind the bounded detached-group supervisor", () => {
    expect(buildVitestSupervisorArguments({
      installationState: { storeDirConfigValue: "/verified/store/v11" },
      nodeExecutable: "/runtime/node",
      pnpmEntrypoint: "/runtime/pnpm.cjs",
      reportPath: "/tmp/report.json",
      stderrPath: "/tmp/stderr",
      stdoutPath: "/tmp/stdout",
      supervisorPath: "/workspace/scripts/deploy/run-bounded-command.mjs",
    })).toEqual([
      "/workspace/scripts/deploy/run-bounded-command.mjs",
      "1800000",
      "10000",
      "16777216",
      "16777216",
      "-",
      "/tmp/stdout",
      "/tmp/stderr",
      "--",
      "/runtime/node",
      "/runtime/pnpm.cjs",
      "--config.store-dir=/verified/store/v11",
      "--config.ignore-pnpmfile=true",
      "--config.node-experimental-package-map=false",
      "--config.offline=true",
      "--config.script-shell=/bin/sh",
      "--config.shell-emulator=false",
      "--config.verify-deps-before-run=false",
      "test",
      "--config=vitest.config.ts",
      "--no-cache",
      "--reporter=./scripts/portfolio/vitest-json-reporter.ts",
      "--outputFile=/tmp/report.json",
    ]);
  });

  it("places the verified versioned store before every pnpm command", () => {
    expect(buildVitestPnpmCommandArguments({
      args: ["--config.offline=true", "--version"],
      installationState: { storeDirConfigValue: "/verified/store/v11" },
      pnpmEntrypoint: "/runtime/pnpm.cjs",
    })).toEqual([
      "/runtime/pnpm.cjs",
      "--config.store-dir=/verified/store/v11",
      "--config.offline=true",
      "--version",
    ]);
  });

  it("uses the production bounded-command envelope builder", () => {
    expect(buildSupervisedVitestCommandArguments({
      args: ["--config.offline=true", "--version"],
      installationState: { storeDirConfigValue: "/verified/store/v11" },
      maxOutputBytes: 65_536,
      nodeExecutable: "/runtime/node",
      pnpmEntrypoint: "/runtime/pnpm.cjs",
      stderrPath: "/tmp/stderr",
      stdoutPath: "/tmp/stdout",
      supervisorPath: "/workspace/run-bounded-command.mjs",
      timeoutMs: 60_000,
    })).toEqual([
      "/workspace/run-bounded-command.mjs",
      "60000",
      "10000",
      "65536",
      "65536",
      "-",
      "/tmp/stdout",
      "/tmp/stderr",
      "--",
      "/runtime/node",
      "/runtime/pnpm.cjs",
      "--config.store-dir=/verified/store/v11",
      "--config.offline=true",
      "--version",
    ]);
  });

  it("accepts only the exact detached process-group capability receipt", () => {
    expect(() => assertVitestProcessGroupInventoryCapabilityOutput(
      "bounded-command-v2:process-group-inventory-ok\n",
    )).not.toThrow();
    expect(() => assertVitestProcessGroupInventoryCapabilityOutput(
      "bounded-command-v2:process-group-inventory-ok",
    )).toThrow(/malformed/u);
    expect(() => assertVitestProcessGroupInventoryCapabilityOutput(
      "bounded-command-v2:process-group-inventory-ok\nforged\n",
    )).toThrow(/malformed/u);
  });
});

type RawStatus =
  | "disabled"
  | "failed"
  | "passed"
  | "pending"
  | "skipped"
  | "todo";

function writeWorkspaceFile(
  workspace: string,
  path: string,
  contents: string | Buffer,
): void {
  const absolutePath = resolve(workspace, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents);
}

function git(workspace: string, args: readonly string[]): string {
  const result = spawnSync("/usr/bin/git", args, {
    cwd: workspace,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Synthetic Git command failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function createWorkspace(): string {
  const workspace = mkdtempSync(
    join(realpathSync(tmpdirForTests()), "diesel-vitest-evidence-test-"),
  );
  temporaryWorkspaces.push(workspace);
  writeWorkspaceFile(
    workspace,
    ".gitignore",
    "/node_modules\n/store\n/tests/ignored.test.ts\n",
  );
  writeWorkspaceFile(workspace, "package.json", JSON.stringify({
    devDependencies: { vitest: "4.1.11" },
    packageManager: "pnpm@11.9.0",
    scripts: { test: "vitest run" },
  }, null, 2) + "\n");
  writeWorkspaceFile(
    workspace,
    "vitest.config.ts",
    "export default { test: { include: ['tests/**/*.test.ts'] } };\n",
  );
  writeWorkspaceFile(
    workspace,
    "tests/example.test.ts",
    "import { it } from 'vitest';\nit('private title', () => {});\n",
  );
  writeWorkspaceFile(workspace, "src/helper.ts", "export const value = 1;\n");
  const storeDir = resolve(workspace, "store/v11");
  mkdirSync(storeDir, { recursive: true });
  writeWorkspaceFile(
    workspace,
    "node_modules/.modules.yaml",
    `${JSON.stringify({
      layoutVersion: 5,
      packageManager: "pnpm@11.9.0",
      storeDir,
      virtualStoreDir: ".pnpm",
    }, null, 2)}\n`,
  );
  writeWorkspaceFile(
    workspace,
    "node_modules/.pnpm-workspace-state-v1.json",
    "{}\n",
  );
  const lockfile = "lockfileVersion: '9.0'\npackages: {}\n";
  writeWorkspaceFile(workspace, "pnpm-lock.yaml", lockfile);
  writeWorkspaceFile(workspace, "node_modules/.pnpm/lock.yaml", lockfile);
  writeWorkspaceFile(workspace, vitestExecutionEvidencePath, "old evidence\n");
  git(workspace, ["init", "--quiet"]);
  git(workspace, ["config", "user.email", "fixture@example.invalid"]);
  git(workspace, ["config", "user.name", "Fixture"]);
  git(workspace, ["add", "--", "."]);
  git(workspace, ["commit", "--quiet", "-m", "fixture"]);
  return workspace;
}

function tmpdirForTests(): string {
  return process.env.TMPDIR ?? "/tmp";
}

function rawReport(
  workspace: string,
  statuses: readonly RawStatus[] = ["passed", "skipped"],
): string {
  const assertionResults = statuses.map((status, index) => ({
    ancestorTitles: ["private suite"],
    duration: status === "skipped" ? undefined : 2,
    failureMessages: status === "failed" ? ["private failure stack"] : [],
    fullName: `private suite private title ${index}`,
    location: { column: 3, line: index + 2 },
    meta: {},
    status,
    tags: [],
    title: `private title ${index}`,
  }));
  const failed = statuses.filter((status) => status === "failed").length;
  const passed = statuses.filter((status) => status === "passed").length;
  const todo = statuses.filter((status) => status === "todo").length;
  const pending = statuses.filter((status) =>
    status === "skipped" || status === "pending" || status === "disabled"
  ).length;
  return JSON.stringify({
    numFailedTests: failed,
    numFailedTestSuites: failed > 0 ? 1 : 0,
    numPassedTests: passed,
    numPassedTestSuites: failed > 0 ? 0 : 1,
    numPendingTests: pending,
    numPendingTestSuites: 0,
    numTodoTests: todo,
    numTotalTests: statuses.length,
    numTotalTestSuites: 1,
    snapshot: {
      added: 0,
      didUpdate: false,
      failure: false,
      filesAdded: 0,
      filesRemoved: 0,
      filesRemovedList: [],
      filesUnmatched: 0,
      filesUpdated: 0,
      matched: 0,
      total: 0,
      unchecked: 0,
      uncheckedKeysByFile: [],
      unmatched: 0,
      updated: 0,
    },
    startTime: 1_780_000_000_000,
    success: failed === 0,
    testResults: [{
      assertionResults,
      endTime: 1_780_000_000_020,
      message: failed > 0 ? "private file failure" : "",
      name: resolve(workspace, "tests/example.test.ts"),
      startTime: 1_780_000_000_010,
      status: failed > 0 ? "failed" : "passed",
    }],
  });
}

function normalized(workspace: string): NormalizedVitestJsonReport {
  return normalizeVitestJsonReporterOutput(rawReport(workspace), workspace);
}

function reportWithFailureMessages(
  workspace: string,
  messages: string[] | null,
  statuses: readonly RawStatus[] = ["failed"],
): string {
  const parsed = JSON.parse(rawReport(workspace, statuses)) as {
    testResults: Array<{
      assertionResults: Array<{ failureMessages: string[] | null }>;
    }>;
  };
  for (const file of parsed.testResults) {
    for (const assertion of file.assertionResults) {
      assertion.failureMessages = messages;
    }
  }
  return JSON.stringify(parsed);
}

function errorObservations(text: string, firstError: unknown): VitestReporterErrorObservations {
  return parseVitestJsonReporterOutput(text).testResults.map((file) => ({
    file: file.name,
    tests: file.assertionResults.map((test) => ({
      ancestorTitles: test.ancestorTitles,
      title: test.title,
      location: test.location ?? null,
      state: test.status === "disabled" || test.status === "todo" ? "skipped" : test.status,
      firstError,
    })),
  }));
}

describe("structured Vitest timeout repair", () => {
  const stack = "Error: STACK_TRACE_ERROR\nPRIVATE_STACK";
  const timeoutError = { name: "Error", message: "Test timed out in 5000ms.\nPRIVATE_MESSAGE", stack };

  it.each(["Test", "Hook"] as const)("repairs a %s timeout without changing evidence outcomes", (kind) => {
    const workspace = createWorkspace();
    const raw = reportWithFailureMessages(workspace, [stack, "PRIVATE_SECOND_ERROR"]);
    const observations = errorObservations(raw, { ...timeoutError, message: `${kind} timed out in 5000ms.\nPRIVATE_MESSAGE` });
    const before = structuredClone(observations);
    const repaired = restoreVitestTimeoutMessages(raw, observations);
    const parsed = parseVitestJsonReporterOutput(repaired);
    expect(parsed.testResults[0]!.assertionResults[0]!.failureMessages)
      .toEqual([`Error: ${kind} timed out in 5000ms.`, "PRIVATE_SECOND_ERROR"]);
    const originalNormalized = normalizeVitestJsonReporterOutput(raw, workspace);
    const normalized = normalizeVitestJsonReporterOutput(repaired, workspace);
    expect(normalized.tests).toEqual(originalNormalized.tests);
    expect(normalized.totals).toEqual(originalNormalized.totals);
    expect(normalized.success).toBe(false);
    expect(normalized.failureDiagnostics[0]!.reportedFailure)
      .toEqual({ kind: kind === "Test" ? "test_timeout" : "hook_timeout", timeoutMs: 5000 });
    expect(JSON.stringify(normalized.failureDiagnostics)).not.toContain("PRIVATE");
    expect(observations).toEqual(before);
  });

  it("supports a structured timeout without a stack", () => {
    const raw = reportWithFailureMessages(createWorkspace(), [timeoutError.message]);
    const repaired = restoreVitestTimeoutMessages(raw, errorObservations(raw, {
      name: "Error", message: timeoutError.message,
    }));
    expect(parseVitestJsonReporterOutput(repaired).testResults[0]!.assertionResults[0]!.failureMessages)
      .toEqual(["Error: Test timed out in 5000ms."]);
  });

  it.each([
    undefined,
    { message: timeoutError.message, stack },
    { ...timeoutError, name: "AssertionError" },
    { ...timeoutError, message: "PRIVATE_MESSAGE" },
    { ...timeoutError, message: "PRIVATE_MESSAGE\nTest timed out in 5000ms." },
    { ...timeoutError, message: "Test timed out in 0ms." },
    { ...timeoutError, message: "Test timed out in -1ms." },
    { ...timeoutError, message: "Test timed out in 1800001ms." },
    { ...timeoutError, message: 5000 },
    { ...timeoutError, stack: null },
  ])("leaves unrecognized structured errors unchanged %#", (error) => {
    const raw = reportWithFailureMessages(createWorkspace(), [stack]);
    expect(restoreVitestTimeoutMessages(raw, errorObservations(raw, error))).toBe(raw);
  });

  it.each(["passed", "pending", "skipped", "todo", "disabled"] as const)(
    "does not repair stale errors on a %s result", (status) => {
      const raw = reportWithFailureMessages(createWorkspace(), [stack], [status]);
      expect(restoreVitestTimeoutMessages(raw, errorObservations(raw, timeoutError))).toBe(raw);
    },
  );

  it("preserves numeric assertion bytes", () => {
    const raw = reportWithFailureMessages(createWorkspace(), ["AssertionError: expected 124 to be 125 // Object.is equality"]);
    expect(restoreVitestTimeoutMessages(raw, errorObservations(raw, {
      name: "AssertionError", message: "expected 124 to be 125 // Object.is equality",
    }))).toBe(raw);
  });

  it.each([
    (rows: VitestReporterErrorObservations) => { rows.pop(); },
    (rows: VitestReporterErrorObservations) => { rows[0]!.file += "PRIVATE"; },
    (rows: VitestReporterErrorObservations) => { rows[0]!.tests.pop(); },
    (rows: VitestReporterErrorObservations) => { rows[0]!.tests[0]!.title += "PRIVATE"; },
    (rows: VitestReporterErrorObservations) => { rows[0]!.tests[0]!.ancestorTitles.push("PRIVATE"); },
    (rows: VitestReporterErrorObservations) => { rows[0]!.tests[0]!.location = { line: 999, column: 3 }; },
    (rows: VitestReporterErrorObservations) => { rows[0]!.tests[0]!.location = { line: 2, column: 999 }; },
    (rows: VitestReporterErrorObservations) => { rows[0]!.tests[0]!.state = "passed"; },
    (rows: VitestReporterErrorObservations) => { rows[0]!.tests[0]!.firstError = { ...timeoutError, stack: "PRIVATE" }; },
  ])("fails closed on mismatched observations %#", (mutate) => {
    const raw = reportWithFailureMessages(createWorkspace(), [stack]);
    const observations = errorObservations(raw, timeoutError);
    mutate(observations);
    expect(() => restoreVitestTimeoutMessages(raw, observations)).toThrow(
      "Vitest structured errors do not match the JSON reporter inventory.",
    );
  });

  it("keeps identical parameterized names aligned by collection order", () => {
    const workspace = createWorkspace();
    const raw = parseVitestJsonReporterOutput(reportWithFailureMessages(workspace, [stack], ["failed", "failed"]));
    raw.testResults[0]!.assertionResults[1] = structuredClone(raw.testResults[0]!.assertionResults[0]!);
    const text = JSON.stringify(raw);
    const observations = errorObservations(text, timeoutError);
    observations[0]!.tests[1]!.firstError = { ...timeoutError, message: "Hook timed out in 10000ms." };
    const result = normalizeVitestJsonReporterOutput(restoreVitestTimeoutMessages(text, observations), workspace);
    expect(new Set(result.tests.map((test) => test.id)).size).toBe(2);
    expect(result.failureDiagnostics.map((test) => test.reportedFailure)).toEqual([
      { kind: "test_timeout", timeoutMs: 5000 },
      { kind: "hook_timeout", timeoutMs: 10000 },
    ]);
  });
});

function listJson(
  workspace: string,
  names: readonly string[] = [
    "private suite > private title 0",
    "private suite > private title 1",
  ],
): string {
  return JSON.stringify(names.map((name) => ({
    file: resolve(workspace, "tests/example.test.ts"),
    name,
  })), null, 2);
}

function buildEvidence(
  workspace: string,
  state: VitestExecutionRepositoryState =
    captureVitestExecutionRepositoryState(workspace),
): VitestExecutionEvidence {
  return buildVitestExecutionEvidence({
    completed: state,
    normalizedReport: normalized(workspace),
    runId: RUN_ID,
    started: state,
  });
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

afterEach(() => {
  while (temporaryLockPaths.length > 0) {
    const lockPath = temporaryLockPaths.pop();
    if (lockPath !== undefined) {
      rmSync(lockPath, { force: true, recursive: true });
    }
  }
  while (temporaryWorkspaces.length > 0) {
    const workspace = temporaryWorkspaces.pop();
    if (workspace !== undefined) {
      rmSync(workspace, { force: true, recursive: true });
    }
  }
});

describe("Vitest supervised list binding", () => {
  it("executes version and list probes with the exact non-mutating argv", () => {
    const workspace = createWorkspace();
    const toolDirectory = resolve(workspace, "private-tools");
    mkdirSync(toolDirectory, { mode: 0o700 });
    mkdirSync(resolve(toolDirectory, ".home"), { mode: 0o700 });
    symlinkSync(process.execPath, resolve(toolDirectory, "node"));
    const pnpmEntrypoint = resolve(workspace, "fake-pnpm.cjs");
    writeFileSync(pnpmEntrypoint, "// fake pnpm entrypoint\n");
    symlinkSync(pnpmEntrypoint, resolve(toolDirectory, "pnpm"));
    const inventoryPath = resolve(workspace, "vitest-inventory.json");
    const commonArguments = [
      `--config.store-dir=${resolve(workspace, "store/v11")}`,
      "--config.ignore-pnpmfile=true",
      "--config.node-experimental-package-map=false",
      "--config.offline=true",
      "--config.script-shell=/bin/sh",
      "--config.shell-emulator=false",
      "--config.verify-deps-before-run=false",
    ];
    const expectedRuntime = [...commonArguments, "--version"];
    const expectedVersion = [
      ...commonArguments,
      "exec",
      "vitest",
      "--version",
    ];
    const expectedList = [
      ...commonArguments,
      "exec",
      "vitest",
      "list",
      "--config",
      resolve(workspace, "vitest.config.ts"),
      "--no-cache",
      `--json=${inventoryPath}`,
    ];
    writeWorkspaceFile(
      workspace,
      "scripts/deploy/run-bounded-command.mjs",
      `import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args.length < 11 || args[7] !== "--") process.exit(64);
const stdoutPath = args[5];
const stderrPath = args[6];
const commandArgs = args.slice(10);
const expectedRuntime = ${JSON.stringify(expectedRuntime)};
const expectedVersion = ${JSON.stringify(expectedVersion)};
const expectedList = ${JSON.stringify(expectedList)};
let stdout = "";
if (JSON.stringify(commandArgs) === JSON.stringify(expectedRuntime)) {
  stdout = "11.9.0\\n";
} else if (JSON.stringify(commandArgs) === JSON.stringify(expectedVersion)) {
  stdout = "vitest/4.1.11 fixture\\n";
} else if (JSON.stringify(commandArgs) === JSON.stringify(expectedList)) {
  const inventoryArgument = commandArgs.at(-1);
  if (typeof inventoryArgument !== "string" || !inventoryArgument.startsWith("--json=")) {
    process.exit(65);
  }
  writeFileSync(inventoryArgument.slice("--json=".length), "[]\\n", {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
} else {
  process.exit(66);
}
writeFileSync(stdoutPath, stdout, { encoding: "utf8", flag: "wx", mode: 0o600 });
writeFileSync(stderrPath, "", { encoding: "utf8", flag: "wx", mode: 0o600 });
const receiptPath = process.env.DIESEL_BOUNDED_COMMAND_COMPLETION_RECEIPT_PATH;
const token = process.env.DIESEL_BOUNDED_COMMAND_COMPLETION_RECEIPT_TOKEN;
if (typeof receiptPath !== "string" || typeof token !== "string") process.exit(67);
writeFileSync(receiptPath, JSON.stringify({
  version: "bounded-command-completion-v2",
  token,
  exitCode: 0,
  closeSeen: true,
  groupAbsenceProven: true,
  guardianSealed: true,
}) + "\\n", { encoding: "utf8", flag: "wx", mode: 0o600 });
`,
    );

    runSupervisedVitestList({
      inventoryPath,
      tools: {
        directory: toolDirectory,
        dispose() {},
        nodeExecutable: process.execPath,
        pnpmEntrypoint,
      },
      workspace,
    });

    expect(readFileSync(inventoryPath, "utf8")).toBe("[]\n");
  });
});

describe("Vitest execution evidence", () => {
  it("disables Vite env-file loading for the canonical test config", () => {
    expect(vitestConfig).toMatchObject({ envDir: false });
  });

  it("strictly normalizes reporter output into anonymous stable test IDs", () => {
    const workspace = createWorkspace();
    const first = normalized(workspace);
    const second = normalized(workspace);

    expect(first).toEqual(second);
    expect(first.totals).toEqual({
      collectedFiles: 1,
      collectedSuites: 1,
      collectedTests: 2,
      failedTests: 0,
      passedTests: 1,
      pendingTests: 0,
      skippedTests: 1,
      todoTests: 0,
    });
    expect(first.tests).toHaveLength(2);
    expect(first.tests.every(({ id }) => /^[0-9a-f]{64}$/u.test(id))).toBe(true);
    expect(first.failureDiagnostics).toEqual([]);

    const serialized = serializeCanonicalVitestExecutionEvidence(
      buildEvidence(workspace),
    );
    expect(serialized).not.toContain("private title");
    expect(serialized).not.toContain("private suite");
    expect(serialized).not.toContain("tests/example.test.ts");
    expect(serialized).not.toContain("private failure");
    expect(serialized).not.toContain("failureDiagnostics");
  });

  it.each([
    {
      message: "AssertionError: expected 124 to be 125 // Object.is equality\nprivate failure stack",
      expected: { kind: "numeric_equality", actual: 124, expected: 125 },
    },
    {
      message: "AssertionError: expected 126 to be 125 // Object.is equality",
      expected: { kind: "numeric_equality", actual: 126, expected: 125 },
    },
    {
      message: "AssertionError: expected -1 to be 255 // Object.is equality",
      expected: { kind: "numeric_equality", actual: -1, expected: 255 },
    },
    {
      message: "Error: Test timed out in 5000ms.\nprivate failure stack",
      expected: { kind: "test_timeout", timeoutMs: 5_000 },
    },
    {
      message: "Error: Hook timed out in 10000ms.\r\nprivate failure stack",
      expected: { kind: "hook_timeout", timeoutMs: 10_000 },
    },
    {
      message: "AssertionError: expected 'private-key-value' to be 'private-value'",
      expected: { kind: "assertion" },
    },
    {
      message: "AssertionError: expected 123456789 to be 125 // Object.is equality",
      expected: { kind: "assertion" },
    },
    {
      message: "AssertionError: expected -0 to be 0 // Object.is equality",
      expected: { kind: "assertion" },
    },
    {
      message: "Error: private-key-value\nAssertionError: expected 124 to be 125 // Object.is equality",
      expected: { kind: "unclassified" },
    },
    {
      message: "Error: Test timed out in 999999999999999999999ms.",
      expected: { kind: "unclassified" },
    },
  ])("projects a bounded failure category for $expected.kind: $message", ({ message, expected }) => {
    const workspace = createWorkspace();
    const report = normalizeVitestJsonReporterOutput(
      reportWithFailureMessages(workspace, [message]),
      workspace,
    );
    expect(report.failureDiagnostics).toEqual([{
      id: report.tests[0]?.id,
      file: "tests/example.test.ts",
      location: { line: 2, column: 3 },
      durationMs: 2,
      reportedFailure: expected,
    }]);
    expect(JSON.stringify(report.failureDiagnostics)).not.toMatch(/private|stack|AssertionError/u);
  });

  it("does not turn failure text on a passing test into a failure diagnostic", () => {
    const workspace = createWorkspace();
    const report = normalizeVitestJsonReporterOutput(
      reportWithFailureMessages(workspace, ["Error: Test timed out in 5000ms."], ["passed"]),
      workspace,
    );
    expect(report.failureDiagnostics).toEqual([]);
    expect(report.totals.failedTests).toBe(0);
  });

  it.each([undefined, null, 7_000])("does not infer a timeout from duration %s without error text", (duration) => {
    const workspace = createWorkspace();
    const parsed = JSON.parse(reportWithFailureMessages(workspace, null)) as {
      testResults: Array<{
        assertionResults: Array<{
          duration?: number | null;
          location?: { line: number; column: number } | null;
        }>;
      }>;
    };
    const assertion = parsed.testResults[0]?.assertionResults[0];
    if (!assertion) throw new Error("Missing synthetic assertion");
    assertion.duration = duration;
    delete assertion.location;
    const report = normalizeVitestJsonReporterOutput(JSON.stringify(parsed), workspace);
    expect(report.failureDiagnostics[0]).toMatchObject({
      durationMs: duration ?? null,
      location: null,
      reportedFailure: { kind: "unclassified" },
    });
  });

  it("limits diagnostics to five failures without changing complete failure counts", () => {
    const workspace = createWorkspace();
    const report = normalizeVitestJsonReporterOutput(
      reportWithFailureMessages(workspace, ["private failure stack"], Array<RawStatus>(8).fill("failed")),
      workspace,
    );
    expect(report.totals.failedTests).toBe(8);
    expect(report.tests).toHaveLength(8);
    expect(report.failureDiagnostics).toHaveLength(5);
    for (const diagnostic of report.failureDiagnostics) {
      expect(report.tests).toContainEqual({ id: diagnostic.id, status: "failed" });
    }
    expect(JSON.stringify(report.failureDiagnostics)).not.toContain("private");
  });

  it("changes an anonymous ID when the underlying test identity changes", () => {
    const workspace = createWorkspace();
    const baseline = normalized(workspace);
    const parsed = JSON.parse(rawReport(workspace)) as {
      testResults: Array<{
        assertionResults: Array<{ fullName: string; title: string }>;
      }>;
    };
    const assertion = parsed.testResults[0]?.assertionResults[0];
    if (!assertion) throw new Error("Synthetic report is missing its first test.");
    assertion.title = "different private title";
    assertion.fullName = "private suite different private title";
    const changed = normalizeVitestJsonReporterOutput(
      JSON.stringify(parsed),
      workspace,
    );

    expect(changed.tests.map(({ id }) => id)).not.toEqual(
      baseline.tests.map(({ id }) => id),
    );
  });

  it("reconstructs reporter IDs exactly from strict Vitest list JSON", () => {
    const workspace = createWorkspace();
    const report = normalized(workspace);
    const inventory = normalizeVitestListJson(listJson(workspace), workspace);
    const evidence = buildEvidence(workspace);

    expect(inventory).toEqual({
      collectedFiles: 1,
      collectedTests: 2,
      sourcePaths: ["tests/example.test.ts"],
      testIds: report.tests.map(({ id }) => id),
    });
    expect(() => assertVitestListInventoryMatchesEvidence(
      inventory,
      evidence,
    )).not.toThrow();
  });

  it("assigns deterministic occurrence IDs to duplicate list names", () => {
    const workspace = createWorkspace();
    const duplicateName = "private suite > duplicate name";
    const forward = normalizeVitestListJson(
      listJson(workspace, [duplicateName, "private suite > other", duplicateName]),
      workspace,
    );
    const reordered = normalizeVitestListJson(
      listJson(workspace, [duplicateName, duplicateName, "private suite > other"]),
      workspace,
    );

    expect(forward.testIds).toHaveLength(3);
    expect(new Set(forward.testIds).size).toBe(3);
    expect(reordered.testIds).toEqual(forward.testIds);
  });

  it("detects list identity drift even when counts remain unchanged", () => {
    const workspace = createWorkspace();
    const evidence = buildEvidence(workspace);
    const drifted = normalizeVitestListJson(listJson(workspace, [
      "private suite > renamed title",
      "private suite > private title 1",
    ]), workspace);

    expect(() => assertVitestListInventoryMatchesEvidence(
      drifted,
      evidence,
    )).toThrow(/list\/evidence inventory drifted/u);
  });

  it("keeps large list/evidence drift diagnostics bounded and anonymous", () => {
    const workspace = createWorkspace();
    const evidence = buildEvidence(workspace);
    const testIds = Array.from({ length: 4_110 }, (_, index) =>
      createHash("sha256").update(`anonymous-${index}`).digest("hex")
    );
    let message = "";
    try {
      assertVitestListInventoryMatchesEvidence({
        collectedFiles: 157,
        collectedTests: testIds.length,
        sourcePaths: [],
        testIds,
      }, evidence);
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("tests current=4110/evidence=2");
    expect(message).toContain("unexpectedInCurrent=4110");
    expect(message.length).toBeLessThan(1_000);
    expect(message).not.toContain(testIds[100]!);
  });

  it("rejects noncanonical, escaped, and extended Vitest list rows", () => {
    const workspace = createWorkspace();
    const canonical = listJson(workspace);
    expect(() => normalizeVitestListJson(`${canonical}\n`, workspace))
      .toThrow(/canonical two-space JSON/u);

    const escaped = JSON.stringify([{
      file: resolve(workspace, "../outside.test.ts"),
      name: "escaped",
    }], null, 2);
    expect(() => normalizeVitestListJson(escaped, workspace)).toThrow();

    const extended = JSON.stringify([{
      extra: "forged",
      file: resolve(workspace, "tests/example.test.ts"),
      name: "private suite > private title 0",
    }], null, 2);
    expect(() => normalizeVitestListJson(extended, workspace)).toThrow();
  });

  it("rejects reporter and list sources outside one stable Git-visible inventory", () => {
    const workspace = createWorkspace();
    const ignoredPath = resolve(workspace, "tests/ignored.test.ts");
    writeWorkspaceFile(
      workspace,
      "tests/ignored.test.ts",
      "import { it } from 'vitest';\nit('ignored', () => {});\n",
    );

    const reporter = JSON.parse(rawReport(workspace)) as {
      testResults: Array<{ name: string }>;
    };
    reporter.testResults[0]!.name = ignoredPath;
    expect(() => normalizeVitestJsonReporterOutput(
      JSON.stringify(reporter),
      workspace,
    )).toThrow(/not in the stable Git-visible inventory/u);

    const list = JSON.stringify([{
      file: ignoredPath,
      name: "ignored",
    }], null, 2);
    expect(() => normalizeVitestListJson(list, workspace)).toThrow(
      /not in the stable Git-visible inventory/u,
    );
  });

  it.each([
    ["pretty JSON", (text: string) => JSON.stringify(JSON.parse(text), null, 2)],
    ["a duplicate key", (text: string) => text.replace(
      '{"numFailedTests":0,',
      '{"numFailedTests":1,"numFailedTests":0,',
    )],
    ["a final newline", (text: string) => `${text}\n`],
  ])("rejects reporter output with %s", (_label, mutate) => {
    const workspace = createWorkspace();
    expect(() => normalizeVitestJsonReporterOutput(
      mutate(rawReport(workspace)),
      workspace,
    )).toThrow(/canonical compact JSON/u);
  });

  it("rejects reporter identity, arithmetic, window, and source-path drift", () => {
    const workspace = createWorkspace();
    const source = JSON.parse(rawReport(workspace)) as Record<string, unknown> & {
      numPassedTestSuites: number;
      numTotalTests: number;
      numTotalTestSuites: number;
      testResults: Array<{
        assertionResults: Array<{ fullName: string }>;
        endTime: number;
        name: string;
      }>;
    };

    const identity = clone(source);
    identity.testResults[0]!.assertionResults[0]!.fullName = "forged";
    expect(() => normalizeVitestJsonReporterOutput(
      JSON.stringify(identity), workspace,
    )).toThrow(/test identity drifted/u);

    const arithmetic = clone(source);
    arithmetic.numTotalTests += 1;
    expect(() => normalizeVitestJsonReporterOutput(
      JSON.stringify(arithmetic), workspace,
    )).toThrow(/test arithmetic drifted/u);

    const impossibleSuiteInventory = clone(source);
    impossibleSuiteInventory.numPassedTestSuites = 0;
    impossibleSuiteInventory.numTotalTestSuites = 0;
    expect(() => normalizeVitestJsonReporterOutput(
      JSON.stringify(impossibleSuiteInventory), workspace,
    )).toThrow(/suite inventory is smaller/u);

    const window = clone(source);
    window.testResults[0]!.endTime = 1;
    expect(() => normalizeVitestJsonReporterOutput(
      JSON.stringify(window), workspace,
    )).toThrow(/invalid run window/u);

    const path = clone(source);
    path.testResults[0]!.name = resolve(workspace, "src/helper.ts");
    expect(() => normalizeVitestJsonReporterOutput(
      JSON.stringify(path), workspace,
    )).toThrow(/outside the canonical suite/u);
  });

  it("preserves skipped/todo distinctions and rejects unfinished evidence", () => {
    const workspace = createWorkspace();
    const complete = normalizeVitestJsonReporterOutput(
      rawReport(workspace, ["passed", "skipped", "disabled", "todo"]),
      workspace,
    );
    expect(complete.totals).toMatchObject({
      passedTests: 1,
      pendingTests: 0,
      skippedTests: 2,
      todoTests: 1,
    });

    const pending = normalizeVitestJsonReporterOutput(
      rawReport(workspace, ["passed", "pending"]),
      workspace,
    );
    const state = captureVitestExecutionRepositoryState(workspace);
    expect(() => buildVitestExecutionEvidence({
      completed: state,
      normalizedReport: pending,
      runId: RUN_ID,
      started: state,
    })).toThrow(/complete passing run/u);
  });

  it("fingerprints every Git-visible source while excluding only the exact sink", () => {
    const workspace = createWorkspace();
    const head = git(workspace, ["rev-parse", "HEAD"]);
    const baseline = captureVitestExecutionRepositoryState(workspace);

    expect(baseline.worktreeState).toBe("clean");
    expect(
      captureVitestExecutionSourceFingerprintAtRevision(workspace, head),
    ).toEqual(baseline.sourceFingerprint);

    writeWorkspaceFile(workspace, vitestExecutionEvidencePath, "new evidence\n");
    const sinkChanged = captureVitestExecutionRepositoryState(workspace);
    expect(sinkChanged.sourceFingerprint).toEqual(baseline.sourceFingerprint);
    expect(sinkChanged.worktreeState).toBe("clean");

    writeWorkspaceFile(
      workspace,
      `${vitestExecutionEvidencePath}.bak`,
      "nearby untracked source\n",
    );
    const nearbyChanged = captureVitestExecutionRepositoryState(workspace);
    expect(nearbyChanged.sourceFingerprint).not.toEqual(
      baseline.sourceFingerprint,
    );
    expect(nearbyChanged.worktreeState).toBe("dirty");
  });

  it("binds source bytes, paths, and executable modes", () => {
    const workspace = createWorkspace();
    const baseline = captureVitestExecutionRepositoryState(workspace);

    writeWorkspaceFile(workspace, "src/helper.ts", "export const value = 2;\n");
    expect(captureVitestExecutionRepositoryState(workspace).sourceFingerprint)
      .not.toEqual(baseline.sourceFingerprint);

    writeWorkspaceFile(workspace, "src/helper.ts", "export const value = 1;\n");
    writeWorkspaceFile(workspace, "src/new-helper.ts", "export const value = 1;\n");
    expect(captureVitestExecutionRepositoryState(workspace).sourceFingerprint)
      .not.toEqual(baseline.sourceFingerprint);
  });

  it("changes the source fingerprint when an executable bit changes", () => {
    const workspace = createWorkspace();
    const sourcePath = resolve(workspace, "src/helper.ts");
    const baseline = captureVitestExecutionRepositoryState(workspace);

    chmodSync(sourcePath, 0o755);

    expect(captureVitestExecutionRepositoryState(workspace).sourceFingerprint)
      .not.toEqual(baseline.sourceFingerprint);
  });

  it("rejects repository drift inside the fingerprint snapshot window", () => {
    const workspace = createWorkspace();
    const gitShim = resolve(workspace, "git-snapshot-shim.sh");
    writeWorkspaceFile(workspace, "git-snapshot-shim.sh", [
      "#!/bin/sh",
      "saw_inventory=0",
      "for argument in \"$@\"; do",
      "  if [ \"$argument\" = \"ls-files\" ]; then saw_inventory=1; fi",
      "done",
      "/usr/bin/git \"$@\"",
      "git_status=$?",
      "if [ \"$saw_inventory\" = \"1\" ]; then",
      "  printf '%s\\n' 'export const value = 99;' > src/helper.ts",
      "fi",
      "exit \"$git_status\"",
      "",
    ].join("\n"));
    chmodSync(gitShim, 0o755);

    expect(() => captureVitestExecutionRepositoryState(workspace, gitShim))
      .toThrow(/repository changed while its source snapshot/u);
  });

  it("rejects content drift hidden behind an unchanged dirty status", () => {
    const workspace = createWorkspace();
    writeWorkspaceFile(workspace, "src/helper.ts", "export const value = 2;\n");
    const gitShim = resolve(workspace, "git-dirty-snapshot-shim.sh");
    writeWorkspaceFile(workspace, "git-dirty-snapshot-shim.sh", [
      "#!/bin/sh",
      "saw_inventory=0",
      "for argument in \"$@\"; do",
      "  if [ \"$argument\" = \"ls-files\" ]; then saw_inventory=1; fi",
      "done",
      "if [ \"$saw_inventory\" = \"1\" ]; then",
      "  count_file=.git/vitest-snapshot-shim-count",
      "  count=0",
      "  if [ -f \"$count_file\" ]; then count=$(sed -n '1p' \"$count_file\"); fi",
      "  count=$((count + 1))",
      "  printf '%s\\n' \"$count\" > \"$count_file\"",
      "  if [ \"$count\" = \"2\" ]; then",
      "    printf '%s\\n' 'export const value = 3;' > src/helper.ts",
      "  fi",
      "fi",
      "/usr/bin/git \"$@\"",
      "",
    ].join("\n"));
    chmodSync(gitShim, 0o755);

    expect(() => captureVitestExecutionRepositoryState(workspace, gitShim))
      .toThrow(/repeated source snapshot drifted/u);
  });

  it("fails closed when repository state changes between start and end", () => {
    const workspace = createWorkspace();
    const started = captureVitestExecutionRepositoryState(workspace);
    writeWorkspaceFile(workspace, "src/helper.ts", "export const value = 2;\n");
    const completed = captureVitestExecutionRepositoryState(workspace);

    expect(() => buildVitestExecutionEvidence({
      completed,
      normalizedReport: normalized(workspace),
      runId: RUN_ID,
      started,
    })).toThrow(/start\/end source drifted/u);
  });

  it("round-trips only canonical v1 evidence and detects inventory drift", () => {
    const workspace = createWorkspace();
    const report = normalized(workspace);
    const evidence = buildEvidence(workspace);
    const serialized = serializeCanonicalVitestExecutionEvidence(evidence);

    expect(evidence.version).toBe(VITEST_EXECUTION_EVIDENCE_VERSION);
    expect(parseCanonicalVitestExecutionEvidence(serialized)).toEqual(evidence);
    // A dependency upgrade requires a real new run, not relabeling the old receipt.
    expect(() => parseCanonicalVitestExecutionEvidence(
      serialized.replace('"vitestVersion": "4.1.11"', '"vitestVersion": "4.1.10"'),
    )).toThrow();
    expect(() => parseCanonicalVitestExecutionEvidence(
      serialized.trimEnd(),
    )).toThrow(/canonical two-space JSON/u);
    expect(() => parseCanonicalVitestExecutionEvidence(
      serialized.replace(
        '  "complete": true,',
        '  "complete": false,\n  "complete": true,',
      ),
    )).toThrow(/canonical two-space JSON/u);
    const parsed = JSON.parse(serialized) as Record<string, unknown> & {
      version: unknown;
    };
    const { version, ...rest } = parsed;
    expect(() => parseCanonicalVitestExecutionEvidence(
      `${JSON.stringify({ version, ...rest }, null, 2)}\n`,
    )).toThrow(/canonical two-space JSON/u);
    const { version: evidenceVersion, ...evidenceRest } = evidence;
    const reorderedEvidence = {
      version: evidenceVersion,
      ...evidenceRest,
    } as VitestExecutionEvidence;
    expect(parseCanonicalVitestExecutionEvidence(
      serializeCanonicalVitestExecutionEvidence(reorderedEvidence),
    )).toEqual(evidence);
    expect(() => parseCanonicalVitestExecutionEvidence(
      serialized.replace(/\.000Z/u, ".000+00:00"),
    )).toThrow(/canonical UTC timestamp/u);
    expect(toVitestExecutionInventory(report).collectedTests).toBe(2);
    expect(() => assertVitestExecutionInventoryMatchesEvidence(
      report,
      evidence,
    )).not.toThrow();

    const changed: NormalizedVitestJsonReport = {
      ...report,
      tests: report.tests.map((test, index) =>
        index === 0 ? { ...test, id: "f".repeat(64) } : test
      ),
    };
    expect(() => assertVitestExecutionInventoryMatchesEvidence(
      changed,
      evidence,
    )).toThrow(/inventory drifted/u);
  });

  it("enforces separate raw-report and canonical-artifact ceilings", async () => {
    const workspace = createWorkspace();
    expect(VITEST_JSON_REPORTER_MAX_BYTES).toBe(32 * 1024 * 1024);
    expect(() => normalizeVitestJsonReporterOutput(
      "x".repeat(VITEST_JSON_REPORTER_MAX_BYTES + 1),
      workspace,
    )).toThrow(/32 MiB/u);
    expect(() => parseCanonicalVitestExecutionEvidence(
      "x".repeat(VITEST_EXECUTION_EVIDENCE_MAX_BYTES + 1),
    )).toThrow(/2 MiB/u);

    const baseline = buildEvidence(workspace);
    const tests = Array.from({ length: 30_000 }, (_, index) => ({
      id: createHash("sha256").update(String(index)).digest("hex"),
      status: "passed" as const,
    })).sort((left, right) => left.id.localeCompare(right.id));
    const oversized: VitestExecutionEvidence = {
      ...baseline,
      tests,
      totals: {
        ...baseline.totals,
        collectedTests: tests.length,
        passedTests: tests.length,
        skippedTests: 0,
      },
    };
    expect(() => serializeCanonicalVitestExecutionEvidence(oversized))
      .toThrow(/2 MiB/u);

    const outputPath = resolve(workspace, vitestExecutionEvidencePath);
    const oldBytes = readFileSync(outputPath, "utf8");
    await expect(persistVitestExecutionEvidence(workspace, oversized))
      .rejects.toThrow(/2 MiB/u);
    expect(readFileSync(outputPath, "utf8")).toBe(oldBytes);
  });

  it("does not overwrite old evidence when the Vitest process fails", async () => {
    const workspace = createWorkspace();
    const outputPath = resolve(workspace, vitestExecutionEvidencePath);
    const oldBytes = readFileSync(outputPath, "utf8");

    await expect(captureVitestExecutionEvidence({
      runId: RUN_ID,
      runner({ reportPath }) {
        writeFileSync(reportPath, rawReport(workspace));
        return 1;
      },
      workspace,
    })).rejects.toThrow(/failed with exit status 1/u);
    expect(readFileSync(outputPath, "utf8")).toBe(oldBytes);
  });

  it("reports bounded actionable failures before cleaning the raw report and preserving old evidence", async () => {
    const workspace = createWorkspace();
    const outputPath = resolve(workspace, vitestExecutionEvidencePath);
    const oldBytes = readFileSync(outputPath, "utf8");
    let rawPath: string | undefined;
    let failure: unknown;
    try {
      await captureVitestExecutionEvidence({
        runId: RUN_ID,
        runner({ reportPath }) {
          rawPath = reportPath;
          writeFileSync(reportPath, reportWithFailureMessages(
            workspace,
            ["AssertionError: expected 124 to be 125 // Object.is equality\nPRIVATE_RAW_DIAGNOSTIC"],
            Array<RawStatus>(7).fill("failed"),
          ));
          return 1;
        },
        workspace,
      });
    } catch (cause: unknown) {
      failure = cause;
    }
    expect(failure).toBeInstanceOf(Error);
    const diagnostic = formatVitestExecutionCaptureError(failure);
    expect(diagnostic).toContain("7 tests / 7 failed / 0 pending");
    expect(diagnostic).toContain('"file":"tests/example.test.ts"');
    expect(diagnostic).toContain('"reportedFailure":{"kind":"numeric_equality","actual":124,"expected":125}');
    expect(diagnostic).toContain("omitted failures=2");
    expect(diagnostic.match(/"reportedFailure"/gu)).toHaveLength(5);
    expect(diagnostic).not.toMatch(/PRIVATE_RAW_DIAGNOSTIC|private suite|private title|private file failure|AssertionError/u);
    expect(diagnostic).not.toContain(workspace);
    expect(diagnostic.length).toBeLessThan(4_096);
    const cleanedRawPath = rawPath;
    if (!cleanedRawPath) throw new Error("Synthetic runner did not execute");
    expect(() => lstatSync(cleanedRawPath)).toThrow();
    expect(readFileSync(outputPath, "utf8")).toBe(oldBytes);
    const nextLock = acquireVitestExecutionCaptureLock(workspace);
    nextLock.release();
  });

  it("releases the capture lock when a runner throws undefined", async () => {
    const workspace = createWorkspace();
    const outputPath = resolve(workspace, vitestExecutionEvidencePath);
    const oldBytes = readFileSync(outputPath, "utf8");
    const sentinel = Symbol("not thrown");
    let thrown: unknown = sentinel;

    try {
      await captureVitestExecutionEvidence({
        runner() {
          throw undefined;
        },
        workspace,
      });
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeUndefined();
    expect(readFileSync(outputPath, "utf8")).toBe(oldBytes);
    const nextLock = acquireVitestExecutionCaptureLock(workspace);
    nextLock.release();
  });

  it("preserves capture and release failures in one AggregateError", async () => {
    const workspace = createWorkspace();
    const outputPath = resolve(workspace, vitestExecutionEvidencePath);
    const oldBytes = readFileSync(outputPath, "utf8");
    const runnerFailure = new Error("runner failed");
    let thrown: unknown;

    try {
      await captureVitestExecutionEvidence({
        runner() {
          writeFileSync(
            resolve(
              workspace,
              ".git",
              VITEST_EXECUTION_CAPTURE_LOCK_NAME,
            ),
            "tampered lock\n",
          );
          throw runnerFailure;
        },
        workspace,
      });
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors).toEqual([
      runnerFailure,
      expect.objectContaining({
        message: expect.stringContaining("ownership changed"),
      }),
    ]);
    expect(readFileSync(outputPath, "utf8")).toBe(oldBytes);
  });

  it("retains the repository lock when workload-group termination is unproven", async () => {
    const workspace = createWorkspace();
    const outputPath = resolve(workspace, vitestExecutionEvidencePath);
    const failure = new VitestWorkloadTerminationUnprovenError(
      "group absence was not proven",
    );

    let thrown: unknown;
    try {
      await captureVitestExecutionEvidence({
        runner() {
          writeFileSync(outputPath, "untrusted concurrent replacement\n");
          throw new AggregateError([failure], "supervision failed");
        },
        workspace,
      });
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).message).toContain(
      "without releasing its containment state",
    );
    const preservationError = (thrown as AggregateError).errors[1];
    expect(preservationError).toBeInstanceOf(Error);
    const temporaryDirectory = (preservationError as Error).message.match(
      /directory (\/[^ ]+) were verified and preserved/u,
    )?.[1];
    expect(temporaryDirectory).toBeDefined();
    if (temporaryDirectory !== undefined) {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
    expect(readFileSync(outputPath, "utf8")).toBe(
      "untrusted concurrent replacement\n",
    );

    const path = resolve(
      workspace,
      ".git",
      VITEST_EXECUTION_CAPTURE_LOCK_NAME,
    );
    temporaryLockPaths.push(path);
    expect(lstatSync(path).isFile()).toBe(true);
    expect(() => acquireVitestExecutionCaptureLock(workspace)).toThrow(
      /already held/u,
    );
  });

  it("preserves containment state when the real supervisor path omits its receipt", async () => {
    const workspace = createWorkspace();
    const supervisorPath = resolve(
      workspace,
      "scripts/deploy/run-bounded-command.mjs",
    );
    writeWorkspaceFile(
      workspace,
      "scripts/deploy/run-bounded-command.mjs",
      `import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--check-process-group-inventory-v1") {
  process.stdout.write("bounded-command-v2:process-group-inventory-ok\\n");
  process.exit(0);
}
if (args.length < 11 || args[7] !== "--") process.exit(64);
const stdoutPath = args[5];
const stderrPath = args[6];
const commandArgs = args.slice(10);
const commonArguments = ${JSON.stringify([
  `--config.store-dir=${resolve(workspace, "store/v11")}`,
  "--config.ignore-pnpmfile=true",
  "--config.node-experimental-package-map=false",
  "--config.offline=true",
  "--config.script-shell=/bin/sh",
  "--config.shell-emulator=false",
  "--config.verify-deps-before-run=false",
])};
const publishSuccess = (stdout) => {
  writeFileSync(stdoutPath, stdout, { encoding: "utf8", flag: "wx", mode: 0o600 });
  writeFileSync(stderrPath, "", { encoding: "utf8", flag: "wx", mode: 0o600 });
  const receiptPath = process.env.DIESEL_BOUNDED_COMMAND_COMPLETION_RECEIPT_PATH;
  const token = process.env.DIESEL_BOUNDED_COMMAND_COMPLETION_RECEIPT_TOKEN;
  if (typeof receiptPath !== "string" || typeof token !== "string") process.exit(65);
  const receipt = {
    version: "bounded-command-completion-v2",
    token,
    exitCode: 0,
    closeSeen: true,
    groupAbsenceProven: true,
    guardianSealed: true,
  };
  writeFileSync(receiptPath, JSON.stringify(receipt) + "\\n", {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  process.exit(0);
};
if (JSON.stringify(commandArgs) === JSON.stringify([
  ...commonArguments,
  "--version",
])) {
  publishSuccess("11.9.0\\n");
}
if (JSON.stringify(commandArgs) === JSON.stringify([
  ...commonArguments,
  "exec",
  "vitest",
  "--version",
])) {
  publishSuccess("vitest/4.1.11 fixture\\n");
}
const expectedTestPrefix = [
  ...commonArguments,
  "test",
  "--config=vitest.config.ts",
  "--no-cache",
  "--reporter=./scripts/portfolio/vitest-json-reporter.ts",
];
if (
  commandArgs.length === expectedTestPrefix.length + 1 &&
  expectedTestPrefix.every((value, index) => commandArgs[index] === value) &&
  commandArgs.at(-1)?.startsWith("--outputFile=/")
) {
  process.stderr.write("bounded-command-v2:guardian-crash\\n");
  process.exit(126);
}
process.exit(66);
`,
    );
    git(workspace, [
      "add",
      "--",
      "scripts/deploy/run-bounded-command.mjs",
    ]);
    git(workspace, ["commit", "--quiet", "-m", "add supervisor fixture"]);
    expect(realpathSync(supervisorPath)).toBe(supervisorPath);

    let thrown: unknown;
    try {
      await captureVitestExecutionEvidence({
        runner: runCanonicalVitestExecution,
        workspace,
      });
    } catch (error: unknown) {
      thrown = error;
    }

    const formatted = formatVitestExecutionCaptureError(thrown);
    const toolDirectory = formatted.match(
      /tool directory (\/[^ ]+) must remain/u,
    )?.[1];
    const evidenceDirectory = formatted.match(
      /temporary evidence directory (\/[^ ]+) were verified/u,
    )?.[1];
    const guardPath = formatted.match(/guard link (\/[^,]+),/u)?.[1];
    const lockPath = resolve(
      workspace,
      ".git",
      VITEST_EXECUTION_CAPTURE_LOCK_NAME,
    );
    try {
      expect(thrown).toBeInstanceOf(AggregateError);
      expect(formatted).toContain(
        "Supervisor reported bounded-command-v2:guardian-crash.",
      );
      expect(formatted).toContain(
        "Supervisor completion receipt could not be validated.",
      );
      expect(formatted).toContain(
        "Supervisor exited with status 126 without a completion receipt.",
      );
      expect(toolDirectory).toBeDefined();
      expect(evidenceDirectory).toBeDefined();
      expect(guardPath).toBeDefined();
      expect(lstatSync(lockPath).nlink).toBe(2);
      if (guardPath !== undefined) {
        expect(lstatSync(guardPath).nlink).toBe(2);
      }
      if (toolDirectory !== undefined) {
        expect(lstatSync(toolDirectory).isDirectory()).toBe(true);
      }
      if (evidenceDirectory !== undefined) {
        expect(lstatSync(evidenceDirectory).isDirectory()).toBe(true);
      }
      expect(() => acquireVitestExecutionCaptureLock(workspace)).toThrow(
        /already held/u,
      );
    } finally {
      if (toolDirectory !== undefined) {
        rmSync(toolDirectory, { force: true, recursive: true });
      }
      if (evidenceDirectory !== undefined) {
        rmSync(evidenceDirectory, { force: true, recursive: true });
      }
      rmSync(lockPath, { force: true });
      if (guardPath !== undefined) rmSync(guardPath, { force: true });
    }
  }, 30_000);

  it("keeps the guard link fail-closed if an unproven runner removes the canonical lock", async () => {
    const workspace = createWorkspace();
    const canonicalPath = resolve(
      workspace,
      ".git",
      VITEST_EXECUTION_CAPTURE_LOCK_NAME,
    );
    const failure = new VitestWorkloadTerminationUnprovenError(
      "group absence was not proven",
    );
    let thrown: unknown;

    try {
      await captureVitestExecutionEvidence({
        runner() {
          unlinkSync(canonicalPath);
          throw failure;
        },
        workspace,
      });
    } catch (error: unknown) {
      thrown = error;
    }

    const formatted = formatVitestExecutionCaptureError(thrown);
    expect(formatted).toContain(
      "capture lock ownership changed",
    );
    const temporaryDirectory =
      formatted.match(/temporary evidence directory (\/[^ ]+) were/u)?.[1] ??
      formatted.match(/evidenceDirectory=(\/[^.;]+)/u)?.[1];
    if (temporaryDirectory !== undefined) {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
    const guardNames = readdirSync(resolve(workspace, ".git")).filter((name) =>
      name.startsWith(`.${VITEST_EXECUTION_CAPTURE_LOCK_NAME}.candidate-`)
    );
    expect(guardNames).toHaveLength(1);
    expect(() => acquireVitestExecutionCaptureLock(workspace)).toThrow(
      /orphan_publication_candidate/u,
    );
  });

  it("rejects and preserves an orphaned staged evidence file", async () => {
    const workspace = createWorkspace();
    const outputPath = resolve(workspace, vitestExecutionEvidencePath);
    const oldBytes = readFileSync(outputPath, "utf8");
    const orphanPath = resolve(
      dirname(outputPath),
      ".vitest-execution-999-123e4567-e89b-42d3-a456-426614174000.tmp",
    );
    writeFileSync(orphanPath, "interrupted staged receipt\n");
    let runnerCalled = false;

    expect(() => assertNoOrphanedVitestExecutionStagingFiles(workspace))
      .toThrow(orphanPath);
    await expect(captureVitestExecutionEvidence({
      runner() {
        runnerCalled = true;
        return 0;
      },
      workspace,
    })).rejects.toThrow(orphanPath);

    expect(runnerCalled).toBe(false);
    expect(readFileSync(outputPath, "utf8")).toBe(oldBytes);
    expect(readFileSync(orphanPath, "utf8")).toBe(
      "interrupted staged receipt\n",
    );
    const nextLock = acquireVitestExecutionCaptureLock(workspace);
    nextLock.release();
  });

  it("fails immediately when another capture holds the repository lock", async () => {
    const workspace = createWorkspace();
    const outputPath = resolve(workspace, vitestExecutionEvidencePath);
    const oldBytes = readFileSync(outputPath, "utf8");
    const firstLock = acquireVitestExecutionCaptureLock(workspace);
    temporaryLockPaths.push(firstLock.path);
    expect(dirname(firstLock.path)).toBe(realpathSync(resolve(workspace, ".git")));
    let runnerCalled = false;
    try {
      expect(() => acquireVitestExecutionCaptureLock(workspace)).toThrow(
        /capture lock is already held/u,
      );
      await expect(captureVitestExecutionEvidence({
        runner() {
          runnerCalled = true;
          return 0;
        },
        workspace,
      })).rejects.toThrow(/capture lock is already held/u);
      expect(runnerCalled).toBe(false);
      expect(readFileSync(outputPath, "utf8")).toBe(oldBytes);
    } finally {
      firstLock.release();
    }
    expect(() => lstatSync(firstLock.path)).toThrow();
  });

  it("does not release a capture lock whose ownership token was replaced", () => {
    const workspace = createWorkspace();
    const lock = acquireVitestExecutionCaptureLock(workspace);
    temporaryLockPaths.push(lock.path);
    writeFileSync(lock.path, "foreign-token\n");

    expect(() => lock.release()).toThrow(/ownership changed/u);
    expect(lstatSync(lock.path).isFile()).toBe(true);
    rmSync(lock.path, { force: true });
  });

  it.each(["overwrite", "delete", "symlink", "directory"] as const)(
    "preserves an unknown %s mutation instead of deleting concurrent data",
    async (mutation) => {
      const workspace = createWorkspace();
      const outputPath = resolve(workspace, vitestExecutionEvidencePath);
      const oldBytes = readFileSync(outputPath, "utf8");

      await expect(captureVitestExecutionEvidence({
        runId: RUN_ID,
        runner({ reportPath }) {
          writeFileSync(reportPath, rawReport(workspace));
          if (mutation === "overwrite") {
            writeFileSync(outputPath, "forged evidence\n");
          } else {
            rmSync(outputPath, { force: true, recursive: true });
            if (mutation === "symlink") {
              symlinkSync(resolve(workspace, "src/helper.ts"), outputPath);
            } else if (mutation === "directory") {
              mkdirSync(outputPath);
              writeFileSync(resolve(outputPath, "forged.txt"), "forged\n");
            }
          }
          return mutation === "delete" ? 1 : 0;
        },
        workspace,
      })).rejects.toThrow(/unknown evidence-sink mutation/u);
      if (mutation === "overwrite") {
        expect(readFileSync(outputPath, "utf8")).toBe("forged evidence\n");
      } else if (mutation === "delete") {
        expect(() => lstatSync(outputPath)).toThrow();
      } else if (mutation === "symlink") {
        expect(lstatSync(outputPath).isSymbolicLink()).toBe(true);
      } else {
        expect(lstatSync(outputPath).isDirectory()).toBe(true);
        expect(readFileSync(resolve(outputPath, "forged.txt"), "utf8")).toBe(
          "forged\n",
        );
      }
      expect(oldBytes).not.toHaveLength(0);
    },
  );

  it("preserves a sink created by the runner when none existed before", async () => {
    const workspace = createWorkspace();
    const outputPath = resolve(workspace, vitestExecutionEvidencePath);
    rmSync(outputPath);

    await expect(captureVitestExecutionEvidence({
      runId: RUN_ID,
      runner({ reportPath }) {
        writeFileSync(reportPath, rawReport(workspace));
        writeFileSync(outputPath, "forged evidence\n");
        return 0;
      },
      workspace,
    })).rejects.toThrow(/unknown evidence-sink mutation/u);
    expect(readFileSync(outputPath, "utf8")).toBe("forged evidence\n");
  });

  it("does not overwrite old evidence when source changes during a passing run", async () => {
    const workspace = createWorkspace();
    const outputPath = resolve(workspace, vitestExecutionEvidencePath);
    const oldBytes = readFileSync(outputPath, "utf8");

    await expect(captureVitestExecutionEvidence({
      runId: RUN_ID,
      runner({ reportPath }) {
        writeFileSync(reportPath, rawReport(workspace));
        writeWorkspaceFile(
          workspace,
          "src/helper.ts",
          "export const value = 2;\n",
        );
        return 0;
      },
      workspace,
    })).rejects.toThrow(/start\/end source drifted/u);
    expect(readFileSync(outputPath, "utf8")).toBe(oldBytes);
  });

  it("does not overwrite old evidence when installed dependency state changes", async () => {
    const workspace = createWorkspace();
    const outputPath = resolve(workspace, vitestExecutionEvidencePath);
    const oldBytes = readFileSync(outputPath, "utf8");

    await expect(captureVitestExecutionEvidence({
      runId: RUN_ID,
      runner({ reportPath }) {
        writeFileSync(reportPath, rawReport(workspace));
        writeWorkspaceFile(
          workspace,
          "node_modules/.pnpm-workspace-state-v1.json",
          '{"mutated":true}\n',
        );
        return 0;
      },
      workspace,
    })).rejects.toThrow(/Vitest runner pnpm installation state changed/u);
    expect(readFileSync(outputPath, "utf8")).toBe(oldBytes);
    expect(readdirSync(resolve(workspace, "docs/evidence")).filter((name) =>
      name.startsWith(".vitest-execution-") && name.endsWith(".tmp")
    )).toEqual([]);
    const nextLock = acquireVitestExecutionCaptureLock(workspace);
    nextLock.release();
  });

  it("does not overwrite old evidence when workspace pnpm config appears", async () => {
    const workspace = createWorkspace();
    const outputPath = resolve(workspace, vitestExecutionEvidencePath);
    const oldBytes = readFileSync(outputPath, "utf8");

    await expect(captureVitestExecutionEvidence({
      runId: RUN_ID,
      runner({ reportPath }) {
        writeFileSync(reportPath, rawReport(workspace));
        writeWorkspaceFile(workspace, ".npmrc", "node-options=/tmp/injected.cjs\n");
        return 0;
      },
      workspace,
    })).rejects.toThrow(/requires \.npmrc to be absent/u);
    expect(readFileSync(outputPath, "utf8")).toBe(oldBytes);
    const nextLock = acquireVitestExecutionCaptureLock(workspace);
    nextLock.release();
  });

  it("preserves runner failure and dependency drift as separate causes", async () => {
    const workspace = createWorkspace();
    const outputPath = resolve(workspace, vitestExecutionEvidencePath);
    const oldBytes = readFileSync(outputPath, "utf8");
    const runnerFailure = new Error("runner failed after dependency mutation");
    let thrown: unknown;

    try {
      await captureVitestExecutionEvidence({
        runner() {
          writeWorkspaceFile(
            workspace,
            "node_modules/.pnpm-workspace-state-v1.json",
            '{"mutatedBeforeFailure":true}\n',
          );
          throw runnerFailure;
        },
        workspace,
      });
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors).toEqual([
      runnerFailure,
      expect.objectContaining({
        message: expect.stringContaining(
          "Vitest runner pnpm installation state changed",
        ),
      }),
    ]);
    expect(readFileSync(outputPath, "utf8")).toBe(oldBytes);
    const nextLock = acquireVitestExecutionCaptureLock(workspace);
    nextLock.release();
  });

  it("rejects dependency drift at the persistence precommit boundary", async () => {
    const workspace = createWorkspace();
    const outputPath = resolve(workspace, vitestExecutionEvidencePath);
    const oldBytes = readFileSync(outputPath, "utf8");

    await expect(captureVitestExecutionEvidence({
      runId: RUN_ID,
      runner({ reportPath }) {
        writeFileSync(reportPath, rawReport(workspace));
        queueMicrotask(() => {
          writeWorkspaceFile(
            workspace,
            "node_modules/.pnpm-workspace-state-v1.json",
            '{"mutatedBeforeCommit":true}\n',
          );
        });
        return 0;
      },
      workspace,
    })).rejects.toThrow(
      /persistence-precommit pnpm installation state changed/u,
    );
    expect(readFileSync(outputPath, "utf8")).toBe(oldBytes);
    expect(readdirSync(resolve(workspace, "docs/evidence")).filter((name) =>
      name.startsWith(".vitest-execution-") && name.endsWith(".tmp")
    )).toEqual([]);
    const nextLock = acquireVitestExecutionCaptureLock(workspace);
    nextLock.release();
  });

  it("keeps the capture lock when dependency drift is detected after commit", async () => {
    const workspace = createWorkspace();
    const outputPath = resolve(workspace, vitestExecutionEvidencePath);
    const oldBytes = readFileSync(outputPath, "utf8");
    let thrown: unknown;

    try {
      await captureVitestExecutionEvidence({
        afterEvidenceCommitForTesting() {
          writeWorkspaceFile(
            workspace,
            "node_modules/.pnpm-workspace-state-v1.json",
            '{"postCommitMutation":true}\n',
          );
        },
        runId: RUN_ID,
        runner({ reportPath }) {
          writeFileSync(reportPath, rawReport(workspace));
          return 0;
        },
        workspace,
      });
    } catch (error: unknown) {
      thrown = error;
    }

    const formatted = formatVitestExecutionCaptureError(thrown);
    const lockPath = resolve(
      workspace,
      ".git",
      VITEST_EXECUTION_CAPTURE_LOCK_NAME,
    );
    const guardPath = formatted.match(/guard link (\/[^,]+),/u)?.[1];
    const evidenceDirectory = formatted.match(
      /temporary evidence directory (\/[^ ]+) were verified/u,
    )?.[1];
    try {
      expect(thrown).toBeInstanceOf(AggregateError);
      expect(formatted).toContain(
        "committed evidence integrity is unproven",
      );
      expect(formatted).toContain(
        "without releasing its committed-evidence inspection state",
      );
      expect(readFileSync(outputPath, "utf8")).not.toBe(oldBytes);
      expect(lstatSync(lockPath).nlink).toBe(2);
      expect(guardPath).toBeDefined();
      if (guardPath !== undefined) {
        expect(lstatSync(guardPath).nlink).toBe(2);
      }
      expect(() => acquireVitestExecutionCaptureLock(workspace)).toThrow(
        /already held/u,
      );
    } finally {
      if (evidenceDirectory !== undefined) {
        rmSync(evidenceDirectory, { force: true, recursive: true });
      }
      rmSync(lockPath, { force: true });
      if (guardPath !== undefined) rmSync(guardPath, { force: true });
    }
  });

  it("preserves an unknown sink change that lands after the runner returns", async () => {
    const workspace = createWorkspace();
    const outputPath = resolve(workspace, vitestExecutionEvidencePath);
    const oldBytes = readFileSync(outputPath, "utf8");

    await expect(captureVitestExecutionEvidence({
      runId: RUN_ID,
      runner({ reportPath }) {
        writeFileSync(reportPath, rawReport(workspace));
        queueMicrotask(() => {
          writeFileSync(outputPath, "late forged evidence\n");
        });
        return 0;
      },
      workspace,
    })).rejects.toThrow(/unknown evidence-sink mutation/u);
    expect(readFileSync(outputPath, "utf8")).toBe("late forged evidence\n");
    expect(oldBytes).not.toHaveLength(0);
  });

  it("restores old evidence when source changes after the completed snapshot", async () => {
    const workspace = createWorkspace();
    const outputPath = resolve(workspace, vitestExecutionEvidencePath);
    const oldBytes = readFileSync(outputPath, "utf8");

    await expect(captureVitestExecutionEvidence({
      runId: RUN_ID,
      runner({ reportPath }) {
        writeFileSync(reportPath, rawReport(workspace));
        queueMicrotask(() => {
          writeWorkspaceFile(
            workspace,
            "src/helper.ts",
            "export const value = 3;\n",
          );
        });
        return 0;
      },
      workspace,
    })).rejects.toThrow(/persistence-precommit source drifted/u);
    expect(readFileSync(outputPath, "utf8")).toBe(oldBytes);
  });

  it("atomically replaces old evidence only after a passing stable run", async () => {
    const workspace = createWorkspace();
    let reportPathParent: string | undefined;
    const evidence = await captureVitestExecutionEvidence({
      runId: RUN_ID,
      runner({ reportPath }) {
        reportPathParent = dirname(dirname(reportPath));
        writeFileSync(reportPath, rawReport(workspace));
        return 0;
      },
      workspace,
    });
    const persisted = parseCanonicalVitestExecutionEvidence(
      readFileSync(resolve(workspace, vitestExecutionEvidencePath), "utf8"),
    );

    expect(persisted).toEqual(evidence);
    expect(reportPathParent).toBe(realpathSync("/tmp"));
    expect(evidence.provenance.evaluatedCommit).toBe(
      evidence.provenance.baseHeadCommit,
    );
  });

  it("requires the exact package-manager and test-script contract", () => {
    const workspace = createWorkspace();
    expect(() => assertVitestExecutionWorkspaceContract(workspace)).not.toThrow();

    writeWorkspaceFile(workspace, "package.json", JSON.stringify({
      devDependencies: { vitest: "4.1.11" },
      packageManager: "pnpm@11.8.0",
      scripts: { test: "vitest run" },
    }, null, 2) + "\n");
    expect(() => assertVitestExecutionWorkspaceContract(workspace)).toThrow();

    writeWorkspaceFile(workspace, "package.json", JSON.stringify({
      devDependencies: { vitest: "4.1.11" },
      packageManager: "pnpm@11.9.0",
      scripts: { test: "vitest run --passWithNoTests" },
    }, null, 2) + "\n");
    expect(() => assertVitestExecutionWorkspaceContract(workspace)).toThrow();

    writeWorkspaceFile(workspace, "package.json", JSON.stringify({
      devDependencies: { vitest: "4.1.10" },
      packageManager: "pnpm@11.9.0",
      scripts: { test: "vitest run" },
    }, null, 2) + "\n");
    expect(() => assertVitestExecutionWorkspaceContract(workspace)).toThrow();
  });

  it.each([".npmrc", ".pnpmfile.cjs"] as const)(
    "requires workspace %s to be absent",
    (relativePath) => {
      const workspace = createWorkspace();
      writeWorkspaceFile(workspace, relativePath, "throw new Error('injected');\n");

      expect(() => assertVitestExecutionWorkspaceContract(workspace)).toThrow(
        `requires ${relativePath} to be absent`,
      );
    },
  );

  it("requires a physical Git-visible Vitest config", () => {
    const workspace = createWorkspace();
    const configPath = resolve(workspace, "vitest.config.ts");
    rmSync(configPath);
    symlinkSync(resolve(workspace, "src/helper.ts"), configPath);

    expect(() => assertVitestExecutionWorkspaceContract(workspace)).toThrow(
      /workspace config/u,
    );
  });

  it("requires the installed Vitest version output to match exactly", () => {
    expect(() => assertVitestVersionOutput(
      "vitest/4.1.11 darwin-arm64 node-v22.22.3\n",
    )).not.toThrow();
    expect(() => assertVitestVersionOutput(
      "vitest/4.1.10 darwin-arm64 node-v22.22.3\n",
    )).toThrow(/installed Vitest 4\.1\.11/u);
    expect(() => assertVitestVersionOutput(
      "vitest/4.1.11\nforged second line\n",
    )).toThrow(/installed Vitest 4\.1\.11/u);
  });

  it("does not create evidence directories through a symlinked ancestor", async () => {
    const workspace = createWorkspace();
    const evidence = buildEvidence(workspace);
    const outside = mkdtempSync(
      join(realpathSync(tmpdirForTests()), "diesel-vitest-outside-"),
    );
    temporaryWorkspaces.push(outside);
    rmSync(resolve(workspace, "docs"), { force: true, recursive: true });
    symlinkSync(outside, resolve(workspace, "docs"));

    await expect(persistVitestExecutionEvidence(workspace, evidence)).rejects
      .toThrow();
    expect(() => lstatSync(resolve(outside, "evidence"))).toThrow();
  });

  it("rejects the first executable pnpm on PATH when package identity drifts", () => {
    const workspace = createWorkspace();
    const fakeBin = resolve(workspace, "fake-bin");
    mkdirSync(fakeBin);
    const fakePackage = resolve(workspace, "fake-pnpm");
    const fakePnpm = resolve(fakePackage, "bin/pnpm.mjs");
    writeWorkspaceFile(
      workspace,
      "fake-pnpm/package.json",
      JSON.stringify({
        bin: { pnpm: "bin/pnpm.mjs" },
        name: "pnpm",
        version: "11.8.0",
      }),
    );
    writeWorkspaceFile(
      workspace,
      "fake-pnpm/bin/pnpm.mjs",
      "process.stdout.write('11.9.0\\n');\n",
    );
    chmodSync(fakePnpm, 0o755);
    symlinkSync(fakePnpm, resolve(fakeBin, "pnpm"));

    expect(() => resolvePnpmEntrypoint({
      HOME: process.env.HOME,
      PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
    })).toThrow(/pnpm package metadata/u);
  });

  it("does not mistake a same-version standalone script for a pnpm package", () => {
    const workspace = createWorkspace();
    const fakeBin = resolve(workspace, "standalone-bin");
    mkdirSync(fakeBin);
    const fakePnpm = resolve(fakeBin, "pnpm");
    writeFileSync(fakePnpm, "process.stdout.write('11.9.0\\n');\n");
    chmodSync(fakePnpm, 0o755);

    expect(() => resolvePnpmEntrypoint({
      HOME: process.env.HOME,
      PATH: fakeBin,
    })).toThrow(/pnpm package metadata/u);
  });

  it.each(["11.9.0", "11.8.0"])(
    "resolves a node_modules/.bin shim only through the pinned package (%s)",
    (version) => {
      const workspace = createWorkspace();
      const bin = resolve(workspace, "setup-pnpm/node_modules/.bin");
      const entry = "setup-pnpm/node_modules/pnpm/bin/pnpm.mjs";
      writeWorkspaceFile(workspace, "setup-pnpm/node_modules/.bin/pnpm",
        "#!/bin/sh\nexit 99 # This shim must never execute.\n");
      writeWorkspaceFile(workspace, "setup-pnpm/node_modules/pnpm/package.json",
        JSON.stringify({ name: "pnpm", version, bin: { pnpm: "bin/pnpm.mjs" } }));
      // pnpm 11's compatibility CJS file is not its declared executable.
      writeWorkspaceFile(workspace, "setup-pnpm/node_modules/pnpm/bin/pnpm.cjs",
        "throw new Error('must not select the compatibility module');\n");
      writeWorkspaceFile(workspace, entry, "#!/usr/bin/env node\nprocess.exit(98);\n");
      chmodSync(resolve(bin, "pnpm"), 0o755);
      chmodSync(resolve(workspace, entry), 0o755);
      const resolveEntry = () => resolvePnpmEntrypoint({ PATH: bin });
      if (version === "11.9.0") {
        expect(resolveEntry()).toBe(resolve(workspace, entry));
      } else {
        expect(resolveEntry).toThrow(/pnpm package metadata/u);
      }
    },
  );

  it("does not search past a broken package-bin shim", () => {
    const workspace = createWorkspace();
    const bin = resolve(workspace, "node_modules/.bin");
    writeWorkspaceFile(workspace, "node_modules/.bin/pnpm", "#!/bin/sh\nexit 0;\n");
    chmodSync(resolve(bin, "pnpm"), 0o755);
    expect(() => resolvePnpmEntrypoint({
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
    })).toThrow();
  });

  it("exposes only verified node and pnpm links through the private tool bin", () => {
    const tools = createVitestExecutionToolBin();
    try {
      expect(dirname(tools.directory)).toBe(realpathSync("/tmp"));
      expect(lstatSync(tools.directory)).toMatchObject({
        gid: process.getgid?.(),
        uid: process.getuid?.(),
      });
      expect(readdirSync(tools.directory).sort()).toEqual([
        ".home",
        "node",
        "pnpm",
      ]);
      expect(lstatSync(resolve(tools.directory, ".home")).isDirectory()).toBe(
        true,
      );
      expect(lstatSync(resolve(tools.directory, ".home"))).toMatchObject({
        gid: process.getgid?.(),
        uid: process.getuid?.(),
      });
      expect(lstatSync(resolve(tools.directory, "node")).isSymbolicLink()).toBe(
        true,
      );
      expect(lstatSync(resolve(tools.directory, "pnpm")).isSymbolicLink()).toBe(
        true,
      );
      expect(realpathSync(resolve(tools.directory, "node"))).toBe(
        tools.nodeExecutable,
      );
      expect(realpathSync(resolve(tools.directory, "pnpm"))).toBe(
        tools.pnpmEntrypoint,
      );
    } finally {
      tools.dispose();
    }
  });

  it("runs capture with a narrow deterministic environment", () => {
    const tools = createVitestExecutionToolBin();
    try {
      initializeVitestExecutionCaptureToolState(tools);
      const environment = buildVitestExecutionCaptureEnvironment(
        tools.directory,
      );

      for (const path of [
        environment.HOME,
        environment.TMPDIR,
        environment.XDG_CONFIG_HOME,
        environment.NPM_CONFIG_USERCONFIG,
        environment.NPM_CONFIG_GLOBALCONFIG,
      ]) {
        expect(lstatSync(path!)).toMatchObject({
          gid: process.getgid?.(),
          uid: process.getuid?.(),
        });
      }

      expect(environment).toEqual({
        HOME: resolve(tools.directory, ".home"),
        LANG: "C.UTF-8",
        LC_ALL: "C.UTF-8",
        NPM_CONFIG_GLOBALCONFIG: resolve(tools.directory, ".npmrc-global"),
        NPM_CONFIG_IGNORE_PNPMFILE: "true",
        NPM_CONFIG_OFFLINE: "true",
        NPM_CONFIG_USERCONFIG: resolve(tools.directory, ".npmrc-user"),
        NPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: "false",
        NODE_ENV: "test",
        NO_COLOR: "1",
        PATH: `${tools.directory}${delimiter}/usr/bin${delimiter}/bin`,
        PNPM_CONFIG_IGNORE_PNPMFILE: "true",
        PNPM_CONFIG_NODE_EXPERIMENTAL_PACKAGE_MAP: "false",
        PNPM_CONFIG_OFFLINE: "true",
        PNPM_CONFIG_SCRIPT_SHELL: "/bin/sh",
        PNPM_CONFIG_SHELL_EMULATOR: "false",
        PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: "false",
        TMPDIR: resolve(tools.directory, ".tmp"),
        TZ: "UTC",
        XDG_CONFIG_HOME: resolve(tools.directory, ".config"),
      });
      expect(environment.AI_API_KEY).toBeUndefined();
      expect(environment.NODE_OPTIONS).toBeUndefined();
    } finally {
      tools.dispose();
    }
  });
});
