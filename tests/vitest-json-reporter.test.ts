import { spawnSync } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, it } from "vitest";

import { parseVitestJsonReporterOutput } from "../scripts/portfolio/vitest-execution-evidence";

const progressPrefix = "vitest-progress-v1:";

it("repairs actual timeout reports without mutating the ordinary reporter or test outcomes", () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "diesel-vitest-reporter-")));
  try {
    const originalPath = join(directory, "original.json");
    const repairedPath = join(directory, "repaired.json");
    const configPath = join(directory, "vitest.config.mjs");
    writeFileSync(configPath, `export default ${JSON.stringify({
      envDir: false,
      root: directory,
      test: {
        include: ["intentional.test.js"],
        globals: true,
        environment: "node",
        maxWorkers: 1,
        testTimeout: 50,
        hookTimeout: 50,
        reporters: [
          [resolve("scripts/portfolio/vitest-json-reporter.ts"), { outputFile: repairedPath }],
          ["json", { outputFile: originalPath }],
        ],
      },
    })};\n`);
    writeFileSync(join(directory, "intentional.test.js"), `
it("numeric comparison", () => { expect(124).toBe(125); });
it("test timeout", async () => { await new Promise(() => {}); });
describe("hook timeout", () => {
  beforeEach(async () => { await new Promise(() => {}); });
  it("blocked body", () => {});
});
it("passed", () => { expect(1).toBe(1); });
it.skip("skipped", () => {});
it.todo("todo");
it.each([1, 2])("same timeout name", async () => { await new Promise(() => {}); });
`);
    const child = spawnSync("pnpm", [
      "--config.offline=true", "--config.verify-deps-before-run=false",
      "exec", "vitest", "run", "--config", configPath, "--no-cache",
    ], {
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: "0" },
      encoding: "utf8",
      timeout: 25_000,
      maxBuffer: 64 * 1024,
    });
    expect(child.error).toBeUndefined();
    expect(child.signal).toBeNull();
    // The workload intentionally fails; a reporter must not turn it green.
    expect(child.status, child.stderr).toBe(1);
    const original = parseVitestJsonReporterOutput(readFileSync(originalPath, "utf8"));
    const repaired = parseVitestJsonReporterOutput(readFileSync(repairedPath, "utf8"));
    expect(repaired.success).toBe(false);
    expect(repaired.numTotalTests).toBe(8);
    expect(repaired.numFailedTests).toBe(5);
    expect(repaired.numPassedTests).toBe(1);
    const tests = repaired.testResults[0]!.assertionResults;
    expect(tests.map((test) => test.failureMessages?.[0]?.split("\n")[0] ?? null)).toEqual([
      "AssertionError: expected 124 to be 125 // Object.is equality",
      "Error: Test timed out in 50ms.",
      "Error: Hook timed out in 50ms.",
      null,
      null,
      null,
      "Error: Test timed out in 50ms.",
      "Error: Test timed out in 50ms.",
    ]);
    for (const index of [1, 2, 6, 7]) {
      expect(original.testResults[0]!.assertionResults[index]!.failureMessages?.[0])
        .toMatch(/^Error: STACK_TRACE_ERROR/u);
    }
    // Replace only the four intended message arrays, then compare the entire reports.
    const restored = structuredClone(repaired);
    for (const index of [1, 2, 6, 7]) {
      restored.testResults[0]!.assertionResults[index]!.failureMessages =
        original.testResults[0]!.assertionResults[index]!.failureMessages;
    }
    // Each reporter has its own onInit clock; all execution-derived timestamps agree.
    restored.startTime = original.startTime;
    expect(restored).toEqual(original);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);

it("publishes private progress while a real test is active and before final JSON exists", () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "diesel-vitest-progress-")));
  let outputDescriptor: number | undefined;
  try {
    const reportPath = join(directory, "report.json");
    const progressPath = join(directory, "stdout.log");
    const observationPath = join(directory, "observed-before-report.json");
    const configPath = join(directory, "vitest.config.mjs");
    const privateTitle = "PRIVATE_PROGRESS_TEST_TITLE_NOT_FOR_DIAGNOSTICS";
    mkdirSync(join(directory, "tests"));
    writeFileSync(configPath, `export default ${JSON.stringify({
      envDir: false,
      root: directory,
      test: {
        include: ["tests/bounded-progress.test.ts"],
        globals: true,
        environment: "node",
        maxWorkers: 1,
        testTimeout: 15_000,
        reporters: [
          [resolve("scripts/portfolio/vitest-json-reporter.ts"), { outputFile: reportPath }],
        ],
      },
    })};\n`);
    writeFileSync(join(directory, "tests/bounded-progress.test.ts"), `
import { existsSync, readFileSync, writeFileSync } from "node:fs";
it(${JSON.stringify(privateTitle)}, async () => {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const records = readFileSync(${JSON.stringify(progressPath)}, "utf8")
      .split("\\n")
      .filter((line) => line.startsWith(${JSON.stringify(progressPrefix)}))
      .flatMap((line) => {
        try { return [JSON.parse(line.slice(${progressPrefix.length}))]; }
        catch { return []; } // A synchronous reader can observe an incomplete write.
      });
    const active = records.find((record) => record.reason === "heartbeat" && record.activeCases.length > 0);
    if (active) {
      expect(existsSync(${JSON.stringify(reportPath)})).toBe(false);
      expect(active.activeCases[0].file).toBe("tests/bounded-progress.test.ts");
      expect(active.activeCases[0].collectionOrdinal).toBe(1);
      writeFileSync(${JSON.stringify(observationPath)}, JSON.stringify({
        observedBeforeFinalJson: true,
        activeCaseCount: active.activeCases.length,
        sequence: active.sequence,
      }));
      return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error("No active-case progress was observed before the test deadline.");
});
`);
    outputDescriptor = openSync(progressPath, "wx", 0o600);
    const child = spawnSync("pnpm", [
      "--config.offline=true", "--config.verify-deps-before-run=false",
      "exec", "vitest", "run", "--config", configPath, "--no-cache",
    ], {
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: "0" },
      encoding: "utf8",
      stdio: ["ignore", outputDescriptor, "pipe"],
      timeout: 25_000,
      maxBuffer: 64 * 1024,
    });
    expect(child.error).toBeUndefined();
    expect(child.signal).toBeNull();
    expect(child.status, child.stderr).toBe(0);
    const observation: unknown = JSON.parse(readFileSync(observationPath, "utf8"));
    expect(observation).toEqual({
      observedBeforeFinalJson: true,
      activeCaseCount: 1,
      sequence: expect.any(Number),
    });
    const lines = readFileSync(progressPath, "utf8").split("\n")
      .filter((line) => line.startsWith(progressPrefix));
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines) {
      expect(Buffer.byteLength(`${line}\n`)).toBeLessThanOrEqual(4 * 1024);
      expect(line).not.toContain(privateTitle);
      expect(line).not.toContain(directory);
    }
    const first: unknown = JSON.parse(lines[0]!.slice(progressPrefix.length));
    const final: unknown = JSON.parse(lines.at(-1)!.slice(progressPrefix.length));
    expect(first).toMatchObject({ diagnosticOnly: true, reason: "start" });
    expect(final).toMatchObject({
      diagnosticOnly: true,
      reason: "end",
      activeCases: [],
      activeModules: [],
      counts: { completedCaseEvents: 1, passedCaseEvents: 1 },
    });
    const report = parseVitestJsonReporterOutput(readFileSync(reportPath, "utf8"));
    expect(report.success).toBe(true);
    expect(report.numTotalTests).toBe(1);
    expect(report.numPassedTests).toBe(1);
    expect(report.numFailedTests).toBe(0);
  } finally {
    if (outputDescriptor !== undefined) closeSync(outputDescriptor);
    rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);
