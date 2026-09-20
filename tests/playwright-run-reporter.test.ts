import { resolve } from "node:path";

import type {
  FullConfig,
  FullResult,
  Suite,
  TestCase,
} from "@playwright/test/reporter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fileSystemMocks = vi.hoisted(() => ({
  mkdir: vi.fn(),
  open: vi.fn(),
  rename: vi.fn(),
  rm: vi.fn(),
}));

const fileHandleMocks = vi.hoisted(() => ({
  close: vi.fn(),
  writeFile: vi.fn(),
}));

const repositoryStateMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    mkdir: fileSystemMocks.mkdir,
    open: fileSystemMocks.open,
    rename: fileSystemMocks.rename,
    rm: fileSystemMocks.rm,
  };
});

vi.mock("../scripts/portfolio/playwright-evidence", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../scripts/portfolio/playwright-evidence")
  >();
  return {
    ...original,
    capturePlaywrightRepositoryState: repositoryStateMock,
  };
});

import PortfolioPlaywrightRunReporter from "../scripts/portfolio/playwright-run-reporter";
import {
  EXPECTED_PLAYWRIGHT_VERSION,
  parseCanonicalPlaywrightRunReceipt,
  playwrightRunContracts,
} from "../scripts/portfolio/playwright-evidence";
import { parseCanonicalPlaywrightFailureDiagnostic } from "../scripts/portfolio/playwright-failure-diagnostic";

function passingTest(project: string, index: number): TestCase {
  return {
    expectedStatus: "passed",
    id: `reporter-persistence-${project}`,
    location: {
      column: 1,
      file: resolve(process.cwd(), "e2e/smoke.spec.ts"),
      line: index + 1,
    },
    outcome: () => "expected",
    parent: {
      project: () => ({ name: project }),
    },
    results: [{ retry: 0, status: "passed" }],
  } as unknown as TestCase;
}

function initializeReporter(tests: TestCase[], afterConstruction?: () => void) {
  const contract = playwrightRunContracts[0];
  const reporter = new PortfolioPlaywrightRunReporter({ id: contract.id });
  afterConstruction?.();
  reporter.onBegin({
    argv: ["node", "playwright", ...contract.cliArguments],
    configFile: resolve(process.cwd(), contract.configPath),
    projects: contract.projects.map((name) => ({ name })),
    version: EXPECTED_PLAYWRIGHT_VERSION,
  } as unknown as FullConfig, { allTests: () => tests } as unknown as Suite);
  return reporter;
}

function persistedDiagnostic(index = 0) {
  return parseCanonicalPlaywrightFailureDiagnostic(
    String(fileHandleMocks.writeFile.mock.calls[index]?.[0]),
  );
}

describe("PortfolioPlaywrightRunReporter", () => {
  beforeEach(() => {
    fileSystemMocks.mkdir.mockReset().mockResolvedValue(undefined);
    fileSystemMocks.open.mockReset().mockResolvedValue(fileHandleMocks);
    fileSystemMocks.rename.mockReset().mockResolvedValue(undefined);
    fileSystemMocks.rm.mockReset().mockResolvedValue(undefined);
    fileHandleMocks.close.mockReset().mockResolvedValue(undefined);
    fileHandleMocks.writeFile.mockReset().mockResolvedValue(undefined);
    repositoryStateMock.mockReset().mockReturnValue({
      headCommit: "a".repeat(40),
      sourceFingerprint: {
        algorithm: "sha256",
        digest: "b".repeat(64),
        fileCount: 1,
      },
      worktreeState: "dirty",
    });
    vi.stubEnv("DIESEL_PLAYWRIGHT_EVIDENCE_CAPTURE", "1");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each(["failed", "timedout", "interrupted"] as const)(
    "retains a %s run without disguising dependency-blocked tests as skips",
    async (status) => {
      const tests = playwrightRunContracts[0].projects.map(passingTest);
      tests[0] = {
        ...tests[0],
        results: [{ retry: 0, status: "failed" }],
        outcome: () => "unexpected",
      } as TestCase;
      tests[1] = {
        ...tests[1], expectedStatus: "skipped",
        results: [{ retry: 0, status: "skipped" }], outcome: () => "skipped",
      } as TestCase;
      tests[4] = { ...tests[4], results: [], outcome: () => "skipped" } as TestCase;
      const reporter = initializeReporter(tests);
      vi.spyOn(process.stderr, "write").mockReturnValue(true);

      await expect(reporter.onEnd({ status } as FullResult))
        .resolves.toEqual({ status: "failed" });

      const diagnostic = persistedDiagnostic();
      expect(diagnostic).toMatchObject({
        runStatus: status, stage: "run", reporterExitCode: 1,
        totals: { collected: 5, passed: 2, failed: 1, skipped: 1, notRun: 1 },
      });
      expect(diagnostic.tests.find((test) => test.project === "knowledge-chromium"))
        .toMatchObject({ attempts: 0, finalStatus: null, outcome: "skipped" });
      expect(fileHandleMocks.writeFile).toHaveBeenCalledOnce();
      expect(fileSystemMocks.rename.mock.calls[0]?.[1])
        .toBe(resolve("test-results/public/playwright-failure.json"));
    },
  );

  it("retains a validation failure even when the runner claims a pass", async () => {
    const tests = playwrightRunContracts[0].projects.map(passingTest);
    tests[4] = { ...tests[4], results: [], outcome: () => "skipped" } as TestCase;
    const reporter = initializeReporter(tests);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);

    await expect(reporter.onEnd({ status: "passed" } as FullResult))
      .resolves.toEqual({ status: "failed" });
    expect(persistedDiagnostic()).toMatchObject({
      runStatus: "passed", stage: "receipt-validation", reporterExitCode: 1,
      totals: { notRun: 1 },
    });
    expect(fileHandleMocks.writeFile).toHaveBeenCalledOnce();
  });

  it("retains global errors independently of passing per-test statuses", async () => {
    const reporter = initializeReporter(playwrightRunContracts[0].projects.map(passingTest));
    reporter.onError();
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await expect(reporter.onEnd({ status: "passed" } as FullResult))
      .resolves.toEqual({ status: "failed" });
    expect(persistedDiagnostic()).toMatchObject({
      runStatus: "passed", stage: "run", globalErrorCount: 1,
    });
  });

  it("does not fabricate completion provenance when the source readback fails", async () => {
    const reporter = initializeReporter(playwrightRunContracts[0].projects.map(passingTest));
    repositoryStateMock.mockImplementationOnce(() => { throw new Error("readback unavailable"); });
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await expect(reporter.onEnd({ status: "passed" } as FullResult))
      .resolves.toEqual({ status: "failed" });
    expect(persistedDiagnostic()).toMatchObject({ provenance: { completed: null } });
  });

  it("fails closed without retrying an unsuccessful diagnostic write", async () => {
    const reporter = initializeReporter(playwrightRunContracts[0].projects.map(passingTest));
    fileHandleMocks.writeFile.mockRejectedValueOnce(new Error("diagnostic disk failure"));
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await expect(reporter.onEnd({ status: "failed" } as FullResult))
      .resolves.toEqual({ status: "failed" });
    expect(fileHandleMocks.writeFile).toHaveBeenCalledOnce();
    expect(fileSystemMocks.rename).not.toHaveBeenCalled();
    expect(stderr.mock.calls.join("\n")).not.toContain("diagnostics retained");
  });

  it("keeps a complete passing run on the unchanged success-receipt contract", async () => {
    const reporter = initializeReporter(playwrightRunContracts[0].projects.map(passingTest));
    await expect(reporter.onEnd({ status: "passed" } as FullResult))
      .resolves.toEqual({ status: "passed" });
    expect(fileHandleMocks.writeFile).toHaveBeenCalledOnce();
    expect(fileSystemMocks.rename.mock.calls[0]?.[1])
      .toBe(resolve("test-results/public/playwright-run.json"));
  });

  it("binds clean provenance before web-server setup temporarily generates type declarations", async () => {
    const clean = {
      headCommit: "a".repeat(40),
      sourceFingerprint: { algorithm: "sha256", digest: "b".repeat(64), fileCount: 1 },
      worktreeState: "clean",
    };
    repositoryStateMock.mockReturnValue(clean);
    const reporter = initializeReporter(
      playwrightRunContracts[0].projects.map(passingTest),
      () => repositoryStateMock.mockReturnValue({ ...clean, worktreeState: "dirty" }),
    );
    repositoryStateMock.mockReturnValue(clean);

    await expect(reporter.onEnd({ status: "passed" } as FullResult))
      .resolves.toEqual({ status: "passed" });
    const receipt = parseCanonicalPlaywrightRunReceipt(
      String(fileHandleMocks.writeFile.mock.calls[0]?.[0]),
    );
    expect(receipt.provenance).toMatchObject({
      started: clean,
      completed: clean,
      evaluatedCommit: clean.headCommit,
    });
  });

  it.each(["head", "source", "unrestored-generated-file"] as const)(
    "rejects %s drift introduced during server setup instead of accepting it as the baseline",
    async (drift) => {
      const clean = {
        headCommit: "a".repeat(40),
        sourceFingerprint: { algorithm: "sha256", digest: "b".repeat(64), fileCount: 1 },
        worktreeState: "clean",
      };
      const changed = {
        ...clean,
        ...(drift === "head" ? { headCommit: "c".repeat(40) } : {}),
        ...(drift === "source" ? {
          sourceFingerprint: { ...clean.sourceFingerprint, digest: "d".repeat(64) },
        } : {}),
        ...(drift === "unrestored-generated-file" ? { worktreeState: "dirty" } : {}),
      };
      repositoryStateMock.mockReturnValue(clean);
      const reporter = initializeReporter(
        playwrightRunContracts[0].projects.map(passingTest),
        () => repositoryStateMock.mockReturnValue(changed),
      );
      vi.spyOn(process.stderr, "write").mockReturnValue(true);

      await expect(reporter.onEnd({ status: "passed" } as FullResult))
        .resolves.toEqual({ status: "failed" });
      expect(persistedDiagnostic()).toMatchObject({ stage: "receipt-validation", reporterExitCode: 1 });
    },
  );

  it("does not inspect repository state when evidence capture is disabled", async () => {
    vi.stubEnv("DIESEL_PLAYWRIGHT_EVIDENCE_CAPTURE", "0");
    const reporter = initializeReporter(playwrightRunContracts[0].projects.map(passingTest));
    await expect(reporter.onEnd({ status: "passed" } as FullResult))
      .resolves.toEqual({ status: "passed" });
    expect(repositoryStateMock).not.toHaveBeenCalled();
  });

  it("prints the complete persistence error tree and fails the suite closed", async () => {
    const contract = playwrightRunContracts.find(({ id }) =>
      id === "production-csp"
    );
    if (!contract) throw new Error("Missing production-csp contract.");
    const reporter = new PortfolioPlaywrightRunReporter({ id: contract.id });
    const tests = contract.projects.map((project, index) =>
      passingTest(project, index)
    );
    const config = {
      argv: ["node", "playwright", ...contract.cliArguments],
      configFile: resolve(process.cwd(), contract.configPath),
      projects: contract.projects.map((name) => ({ name })),
      version: EXPECTED_PLAYWRIGHT_VERSION,
    } as unknown as FullConfig;
    const suite = {
      allTests: () => tests,
    } as unknown as Suite;
    reporter.onBegin(config, suite);

    const persistenceError = new AggregateError(
      [
        new Error("receipt write failed", {
          cause: new TypeError("disk quota exhausted"),
        }),
        "temporary receipt retained",
      ],
      "receipt persistence failed",
      { cause: new Error("artifact directory unavailable") },
    );
    fileHandleMocks.writeFile.mockRejectedValueOnce(persistenceError);
    const stderr: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });

    const result = await reporter.onEnd({ status: "passed" } as FullResult);

    expect(result).toEqual({ status: "failed" });
    expect(fileHandleMocks.writeFile).toHaveBeenCalledTimes(2);
    expect(fileHandleMocks.close).toHaveBeenCalledTimes(2);
    expect(fileSystemMocks.rename).toHaveBeenCalledOnce();
    expect(fileSystemMocks.rm).toHaveBeenCalledOnce();
    expect(persistedDiagnostic(1)).toMatchObject({
      runStatus: "passed", stage: "receipt-persistence", reporterExitCode: 1,
    });
    expect(stderr.join("")).toBe(
      "Playwright evidence reporter failed closed for suite production-csp.\n" +
        "playwright-evidence-reporter: AggregateError: receipt persistence failed\n" +
        "playwright-evidence-reporter.errors[0]: Error: receipt write failed\n" +
        "playwright-evidence-reporter.errors[0].cause: TypeError: disk quota exhausted\n" +
        "playwright-evidence-reporter.errors[1]: temporary receipt retained\n" +
        "playwright-evidence-reporter.cause: Error: artifact directory unavailable\n" +
        "Playwright failure diagnostics retained at test-results/production-csp/playwright-failure.json; not release evidence.\n",
    );
  });

  it("preserves both rename and cleanup failures and fails the suite closed", async () => {
    const contract = playwrightRunContracts.find(({ id }) =>
      id === "production-csp"
    );
    if (!contract) throw new Error("Missing production-csp contract.");
    const reporter = new PortfolioPlaywrightRunReporter({ id: contract.id });
    const tests = contract.projects.map((project, index) =>
      passingTest(project, index)
    );
    reporter.onBegin({
      argv: ["node", "playwright", ...contract.cliArguments],
      configFile: resolve(process.cwd(), contract.configPath),
      projects: contract.projects.map((name) => ({ name })),
      version: EXPECTED_PLAYWRIGHT_VERSION,
    } as unknown as FullConfig, {
      allTests: () => tests,
    } as unknown as Suite);
    fileSystemMocks.rename.mockRejectedValueOnce(
      new Error("receipt rename failed"),
    );
    fileSystemMocks.rm.mockRejectedValueOnce(
      new Error("temporary receipt cleanup failed"),
    );
    const stderr: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });

    const result = await reporter.onEnd({ status: "passed" } as FullResult);

    expect(result).toEqual({ status: "failed" });
    expect(fileHandleMocks.writeFile).toHaveBeenCalledTimes(2);
    expect(fileHandleMocks.close).toHaveBeenCalledTimes(2);
    expect(fileSystemMocks.rename).toHaveBeenCalledTimes(2);
    expect(fileSystemMocks.rm).toHaveBeenCalledOnce();
    expect(stderr.join("")).toBe(
      "Playwright evidence reporter failed closed for suite production-csp.\n" +
        "playwright-evidence-reporter: AggregateError: Playwright receipt persistence and cleanup failed.\n" +
        "playwright-evidence-reporter.errors[0]: Error: receipt rename failed\n" +
        "playwright-evidence-reporter.errors[1]: Error: temporary receipt cleanup failed\n" +
        "Playwright failure diagnostics retained at test-results/production-csp/playwright-failure.json; not release evidence.\n",
    );
  });
});
