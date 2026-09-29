import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, it } from "vitest";
import { z } from "zod";

import {
  parseCanonicalPlaywrightEvidence,
  parseCanonicalPlaywrightRunReceipt,
  playwrightRunContracts,
} from "../scripts/portfolio/playwright-evidence";
import { parseCanonicalPlaywrightFailureDiagnostic } from "../scripts/portfolio/playwright-failure-diagnostic";
import { createTrustedGitEnvironment } from "../scripts/portfolio/trusted-git";

const require = createRequire(import.meta.url);

it("retains actual dependency-blocked results from a real failing Playwright run", () => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "diesel-playwright-failure-")));
  let canRemoveWorkspace = true;
  const git = (args: string[]) => {
    const result = spawnSync("/usr/bin/git", [
      "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args,
    ], {
      cwd: workspace, encoding: "utf8", timeout: 5_000,
      env: createTrustedGitEnvironment(),
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  };
  try {
    mkdirSync(join(workspace, "e2e"));
    mkdirSync(join(workspace, "test-results"));
    writeFileSync(join(workspace, ".gitignore"), "test-results/\n");
    const testImport = JSON.stringify(require.resolve("@playwright/test"));
    writeFileSync(join(workspace, "e2e/upstream.spec.cjs"), `
const { test, expect } = require(${testImport});
test("PRIVATE_SYNTHETIC_FAILURE_TITLE", ({}, info) => {
  expect(info.project.name === "mobile-chromium").toBe(false);
});
test.skip("PRIVATE_SYNTHETIC_SKIP_TITLE", () => {});
`);
    writeFileSync(join(workspace, "e2e/dependent.spec.cjs"), `
const { test, expect } = require(${testImport});
test("PRIVATE_SYNTHETIC_BLOCKED_ONE", () => { expect(true).toBe(true); });
test("PRIVATE_SYNTHETIC_BLOCKED_TWO", () => { expect(true).toBe(true); });
`);
    writeFileSync(join(workspace, "playwright.config.ts"), `module.exports = ${JSON.stringify({
      testDir: "./e2e",
      outputDir: "test-results/public",
      workers: 1,
      retries: 0,
      timeout: 1_000,
      globalTimeout: 15_000,
      reporter: [
        ["list"],
        [resolve("scripts/portfolio/playwright-run-reporter.ts"), { id: "public" }],
      ],
      projects: playwrightRunContracts[0].projects.map((name) => ({
        name,
        testMatch: name === "knowledge-chromium" ? "dependent.spec.cjs" : "upstream.spec.cjs",
        ...(name === "knowledge-chromium" ? {
          dependencies: ["desktop-chromium", "mobile-chromium", "core-webkit"],
        } : {}),
      })),
    })};\n`);
    git(["init", "--quiet"]);
    git(["add", ".gitignore", "playwright.config.ts", "e2e"]);
    git(["-c", "user.name=Synthetic Fixture", "-c", "user.email=fixture@example.test",
      "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "Synthetic reporter lifecycle fixture"]);

    const stdoutPath = join(workspace, "test-results/stdout.log");
    const stderrPath = join(workspace, "test-results/stderr.log");
    const completionPath = join(workspace, "test-results/completion.json");
    const completionToken = randomUUID();
    canRemoveWorkspace = false;
    const execution = spawnSync(process.execPath, [
      resolve("scripts/deploy/run-bounded-command.mjs"),
      "20000", "1000", "131072", "131072", "-", stdoutPath, stderrPath,
      "--", process.execPath, require.resolve("@playwright/test/cli"), "test",
    ], {
      cwd: workspace,
      encoding: "utf8",
      env: {
        NODE_ENV: "test",
        PATH: process.env.PATH,
        DIESEL_PLAYWRIGHT_EVIDENCE_CAPTURE: "1",
        DIESEL_BOUNDED_COMMAND_COMPLETION_RECEIPT_PATH: completionPath,
        DIESEL_BOUNDED_COMMAND_COMPLETION_RECEIPT_TOKEN: completionToken,
        FORCE_COLOR: "0",
      },
      maxBuffer: 131_072,
    });
    const stdout = existsSync(stdoutPath) ? readFileSync(stdoutPath, "utf8") : "";
    const stderr = existsSync(stderrPath) ? readFileSync(stderrPath, "utf8") : "";
    expect(execution.error).toBeUndefined();
    expect(execution.signal).toBeNull();
    expect(execution.status, `${execution.stderr}\n${stderr}\n${stdout}`).toBe(1);
    expect(existsSync(stdoutPath), execution.stderr).toBe(true);
    expect(existsSync(stderrPath), execution.stderr).toBe(true);
    z.object({
      version: z.literal("bounded-command-completion-v2"),
      token: z.literal(completionToken),
      exitCode: z.literal(1),
      closeSeen: z.literal(true),
      groupAbsenceProven: z.literal(true),
      guardianSealed: z.literal(true),
    }).strict().parse(JSON.parse(readFileSync(completionPath, "utf8")));
    expect(stdout).toContain("2 did not run");
    expect(stderr).toContain("not release evidence");
    const text = readFileSync(join(workspace, "test-results/public/playwright-failure.json"), "utf8");
    const diagnostic = parseCanonicalPlaywrightFailureDiagnostic(text);
    expect(diagnostic).toMatchObject({
      reporterExitCode: 1,
      runStatus: "failed",
      stage: "run",
      totals: { collected: 10, passed: 3, failed: 1, skipped: 4, notRun: 2, timedOut: 0, interrupted: 0 },
    });
    expect(diagnostic.tests.filter((test) => test.attempts === 0)).toHaveLength(2);
    for (const test of diagnostic.tests.filter((test) => test.project === "knowledge-chromium")) {
      expect(test).toMatchObject({ attempts: 0, finalStatus: null, retryCount: 0 });
    }
    expect(diagnostic.provenance.completed).toEqual(diagnostic.provenance.started);
    expect(text).not.toContain("PRIVATE_SYNTHETIC");
    expect(existsSync(join(workspace, "test-results/public/playwright-run.json"))).toBe(false);
    expect(existsSync(join(workspace, "docs/evidence/playwright-e2e-latest.json"))).toBe(false);
    expect(() => parseCanonicalPlaywrightRunReceipt(text)).toThrow();
    expect(() => parseCanonicalPlaywrightEvidence(text)).toThrow();
    canRemoveWorkspace = true;
  } finally {
    if (canRemoveWorkspace) {
      rmSync(workspace, { recursive: true, force: true });
    } else {
      process.stderr.write(`Playwright failure lifecycle diagnostics retained: ${workspace}\n`);
    }
  }
}, 30_000);
