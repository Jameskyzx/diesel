import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  captureLiveEvalSourceFingerprint,
  persistLiveEvalReport,
  resolveLiveEvalArchiveReportPath,
} from "../scripts/ai/live-eval-report";
import { liveEvalReportSchema } from "../scripts/portfolio/live-eval-report-schema";
import {
  assertLiveEvalToolBearingStepInvariant,
  verifyLiveEvalEvidence,
  verifyLiveEvalReportConsistency,
} from "../scripts/portfolio/verify-live-eval";
import {
  LIVE_EVAL_MAX_TOKENS,
  scoreLiveEval,
} from "../src/domain/ai/live-eval";
import {
  buildLiveEvalCaseObservability,
  summarizeLiveEvalObservability,
} from "../src/domain/ai/live-eval-observability";
import {
  buildSyntheticLiveEvalReport,
  buildSyntheticLiveEvalSnapshot,
  type SyntheticLiveEvalReport,
} from "./helpers/live-eval-report-fixture";

type SyntheticWorkspace = {
  alternateCommit: string;
  archivePath: string;
  latestPath: string;
  report: SyntheticLiveEvalReport;
  workspace: string;
};

function runGit(workspace: string, args: readonly string[]): string {
  const result = spawnSync("git", args, {
    cwd: workspace,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `Synthetic Git fixture failed: git ${args.join(" ")} (${result.status ?? "unknown"})\n${result.stderr}`,
    );
  }
  return result.stdout.trim();
}

function serializeReport(report: SyntheticLiveEvalReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function buildHistoricalV10Report(
  report: SyntheticLiveEvalReport,
): Record<string, unknown> & { evaluatedAt: string; runId: string } {
  const historical = structuredClone(report) as unknown as Record<
    string,
    unknown
  >;
  historical.version = "sales-chat-live-v10";
  historical.evaluatedAt = "2026-08-29T23:59:00.000Z";
  historical.runId = "33333333-3333-4333-8333-333333333333";
  Reflect.deleteProperty(historical, "observability");
  if (!Array.isArray(historical.results)) {
    throw new Error("Synthetic historical report has no result rows.");
  }
  for (const result of historical.results) {
    if (typeof result !== "object" || result === null || Array.isArray(result)) {
      throw new Error("Synthetic historical report has an invalid result row.");
    }
    Reflect.deleteProperty(result, "modelObservability");
    Reflect.deleteProperty(result, "runtimeContext");
    Reflect.deleteProperty(result, "toolTraceStatus");
  }
  if (
    typeof historical.evaluatedAt !== "string" ||
    typeof historical.runId !== "string"
  ) {
    throw new Error("Synthetic historical report has an invalid identity.");
  }
  return historical as Record<string, unknown> & {
    evaluatedAt: string;
    runId: string;
  };
}

async function createSyntheticWorkspace(): Promise<SyntheticWorkspace> {
  const workspace = await mkdtemp(
    resolve(tmpdir(), "diesel-portfolio-live-eval-"),
  );
  const sourcePath = resolve(workspace, "src/synthetic-live-eval-source.ts");
  await mkdir(resolve(workspace, "src"), { recursive: true });
  await writeFile(
    sourcePath,
    'export const syntheticLiveEvalSource = "base";\n',
    "utf8",
  );
  runGit(workspace, ["init", "--quiet"]);
  runGit(workspace, ["config", "user.email", "synthetic@example.invalid"]);
  runGit(workspace, ["config", "user.name", "Synthetic Live Eval"]);
  runGit(workspace, ["add", "src/synthetic-live-eval-source.ts"]);
  runGit(workspace, ["commit", "--quiet", "-m", "synthetic base"]);
  const baseCommit = runGit(workspace, ["rev-parse", "HEAD"]);
  const fingerprint = await captureLiveEvalSourceFingerprint(workspace);
  if (fingerprint.status !== "captured") {
    throw new Error("Synthetic live-eval source fingerprint was not captured.");
  }

  await writeFile(
    sourcePath,
    'export const syntheticLiveEvalSource = "alternate";\n',
    "utf8",
  );
  runGit(workspace, ["add", "src/synthetic-live-eval-source.ts"]);
  runGit(workspace, ["commit", "--quiet", "-m", "synthetic alternate"]);
  const alternateCommit = runGit(workspace, ["rev-parse", "HEAD"]);
  runGit(workspace, ["checkout", "--quiet", "--detach", baseCommit]);

  const report = buildSyntheticLiveEvalReport({
    commit: baseCommit,
    fingerprintDigest: fingerprint.digest,
    fingerprintFileCount: fingerprint.fileCount,
  });
  const { archivePath, latestPath } = await persistLiveEvalReport(
    workspace,
    report,
  );
  return { alternateCommit, archivePath, latestPath, report, workspace };
}

function requireCleanRepository(report: SyntheticLiveEvalReport) {
  const repository = report.provenance.repository;
  if (repository.worktreeState !== "clean") {
    throw new Error("Synthetic live-eval report requires clean provenance.");
  }
  return repository;
}

function requireCapturedFingerprint(report: SyntheticLiveEvalReport) {
  const fingerprint = report.provenance.sourceFingerprint;
  if (fingerprint.status !== "captured") {
    throw new Error("Synthetic live-eval report requires a captured fingerprint.");
  }
  return fingerprint;
}

function synchronizeV11Observability(
  report: SyntheticLiveEvalReport,
): void {
  for (const result of report.results) {
    const steps = result.tokenUsage.ledger.map((usage, index) => {
      const previous = result.modelObservability.steps[index];
      if (!previous) {
        throw new Error("Synthetic live-eval observability step is absent.");
      }
      const tokenMetric = (value: number | null) => ({
        reported: value !== null,
        value,
      });
      const inputTokens = usage.input;
      const outputTokens = usage.output;
      const totalTokens = usage.total;
      const tokenUsageComplete =
        inputTokens !== null &&
        inputTokens > 0 &&
        outputTokens !== null &&
        totalTokens !== null &&
        totalTokens > 0 &&
        inputTokens + outputTokens === totalTokens;
      return {
        ...previous,
        cacheStatus: inputTokens === null ? "unavailable" as const : "reported" as const,
        tokenUsage: {
          cacheReadTokens:
            inputTokens === null
              ? { reported: false, value: null }
              : { reported: true, value: 0 },
          cacheWriteTokens:
            inputTokens === null
              ? { reported: false, value: null }
              : { reported: true, value: 0 },
          inputTokens: tokenMetric(inputTokens),
          noCacheTokens:
            inputTokens === null
              ? { reported: false, value: null }
              : { reported: true, value: inputTokens },
          outputTokens: tokenMetric(outputTokens),
          totalTokens: tokenMetric(totalTokens),
        },
        tokenUsageComplete,
      };
    });
    result.modelObservability = buildLiveEvalCaseObservability({
      attemptCount: result.attemptCount,
      completedCount: result.completedCount,
      expectedStepCount: result.loopSteps,
      modelStreamCompleted: result.errorCode !== "EVAL_CASE_ERROR",
      steps,
    });
  }
  report.observability = summarizeLiveEvalObservability(
    report.results.map(({ latencyMs, modelObservability }) => ({
      latencyMs,
      modelObservability,
    })),
  );
}

function exceedAcceptedTokenBudget(report: SyntheticLiveEvalReport): void {
  const lastResult = report.results.at(-1);
  if (!lastResult) {
    throw new Error("Synthetic live-eval report has no result rows.");
  }
  const priorTokens = report.results
    .slice(0, -1)
    .reduce((total, result) => total + (result.tokenUsage.total ?? 0), 0);
  const finalStepTotal = LIVE_EVAL_MAX_TOKENS + 1 - priorTokens;
  const finalStepUsage = {
    input: finalStepTotal - 1_024,
    output: 1_024,
    total: finalStepTotal,
  };
  lastResult.tokenUsage = {
    ...finalStepUsage,
    ledger: [finalStepUsage],
    usageComplete: true,
  };
  report.budget.totalTokens = report.results.reduce(
    (total, result) => total + (result.tokenUsage.total ?? 0),
    0,
  );
  report.terminationReason = "token_limit_exceeded";
  report.thresholdsPassed = false;
  synchronizeV11Observability(report);
}

function stopAtAcceptedTokenBudget(report: SyntheticLiveEvalReport): void {
  const lastResult = report.results.at(-1);
  if (!lastResult) {
    throw new Error("Synthetic live-eval report has no result rows.");
  }
  const priorTokens = report.results
    .slice(0, -1)
    .reduce((total, result) => total + (result.tokenUsage.total ?? 0), 0);
  const finalStepTotal = LIVE_EVAL_MAX_TOKENS - priorTokens;
  const finalStepUsage = {
    input: finalStepTotal - 1_024,
    output: 1_024,
    total: finalStepTotal,
  };
  lastResult.tokenUsage = {
    ...finalStepUsage,
    ledger: [finalStepUsage],
    usageComplete: true,
  };
  lastResult.errorCode = "EVAL_BUDGET_STOP";
  lastResult.evidenceExpectationPassed = false;
  lastResult.evidenceResult = "error";
  lastResult.detectedResponseLocale = "indeterminate";
  lastResult.missingResponseAnchorIds = [
    ...lastResult.matchedResponseAnchorIds,
  ];
  lastResult.matchedResponseAnchorIds = [];
  lastResult.mismatchReason = "error:EVAL_BUDGET_STOP";
  lastResult.pass = false;
  lastResult.responseDisposition = "not_evaluated";
  lastResult.responseDispositionPassed = false;
  lastResult.responseGroundingPassed = false;
  lastResult.responseLocalePassed = false;
  lastResult.safetyPassed = false;
  report.budget.totalTokens = LIVE_EVAL_MAX_TOKENS;
  report.complete = false;
  report.scores = scoreLiveEval(report.results);
  report.terminationReason = "token_limit_exceeded";
  report.thresholdsPassed = false;
  synchronizeV11Observability(report);
}

const tamperCases: ReadonlyArray<{
  archiveMode?: "match" | "mismatch" | "original";
  expectedError: RegExp;
  label: string;
  schemaValid?: boolean;
  mutate: (
    report: SyntheticLiveEvalReport,
    fixture: SyntheticWorkspace,
  ) => void;
}> = [
  {
    expectedError: /complete tool traces must agree with tool-bearing step telemetry/u,
    label: "tool-bearing step count",
    schemaValid: false,
    mutate: (report) => {
      report.results[0]!.toolBearingSteps = 0;
    },
  },
  {
    expectedError: /Live eval scores drifted/u,
    label: "score summary",
    mutate: (report) => {
      report.scores.argsAccuracyPct = 99;
    },
  },
  {
    expectedError: /Live eval token total drifted/u,
    label: "token total",
    mutate: (report) => {
      report.budget.totalTokens += 1;
    },
  },
  {
    expectedError: /Live eval observability summary drifted/u,
    label: "observability summary",
    mutate: (report) => {
      report.observability.caseLatencyMs.p50 = 24;
    },
  },
  {
    expectedError: /Live eval per-model-call output-token budget drifted/u,
    label: "per-call output-token budget",
    mutate: (report) => {
      report.budget.maxOutputTokensPerCall += 1;
    },
  },
  {
    expectedError: /Live eval maximum potential output-token budget drifted/u,
    label: "maximum potential output-token budget",
    mutate: (report) => {
      report.budget.maxPotentialOutputTokens += 1;
    },
  },
  {
    expectedError: /response anchor coverage drifted/u,
    label: "response anchor",
    mutate: (report) => {
      report.results[0]!.matchedResponseAnchorIds[0] = "fact:unexpected";
    },
  },
  {
    expectedError: /country-overview-china locale drifted/u,
    label: "response locale",
    mutate: (report) => {
      report.results[0]!.locale = "zh-CN";
      report.results[0]!.detectedResponseLocale = "zh-CN";
    },
  },
  {
    expectedError: /Live eval result 1 must be country-overview-china/u,
    label: "case order",
    mutate: (report) => {
      [report.results[0], report.results[1]] = [
        report.results[1]!,
        report.results[0]!,
      ];
    },
  },
  {
    expectedError: /Live eval provider profile drifted/u,
    label: "provider profile",
    mutate: (report) => {
      const profile = report.provenance.providerProfile;
      if (!profile) {
        throw new Error("Synthetic live-eval provider profile is absent.");
      }
      profile.endpointSha256 = "b".repeat(64);
    },
  },
  {
    expectedError: /Clean live eval commit\/source fingerprint drifted/u,
    label: "clean commit binding",
    mutate: (report, fixture) => {
      const repository = requireCleanRepository(report);
      repository.baseHeadCommit = fixture.alternateCommit;
      repository.evaluatedCommit = fixture.alternateCommit;
    },
  },
  {
    expectedError: /Live eval evaluated-source fingerprint drifted/u,
    label: "recorded source fingerprint",
    mutate: (report) => {
      requireCapturedFingerprint(report).digest = "b".repeat(64);
    },
  },
  {
    expectedError: /product-ready-dual-axis argument judgement drifted/u,
    label: "product-model fingerprint",
    mutate: (report) => {
      const result = report.results.find(
        ({ id }) => id === "product-ready-dual-axis",
      );
      const call = result?.normalizedArgs.find(
        ({ tool }) => tool === "findCompatibleProducts",
      );
      const fingerprint = call?.args.productModelCode;
      if (
        typeof fingerprint !== "object" ||
        fingerprint === null ||
        Array.isArray(fingerprint)
      ) {
        throw new Error("Synthetic product fingerprint is absent.");
      }
      (fingerprint as Record<string, unknown>).digest = "b".repeat(64);
    },
  },
  {
    expectedError: /comparable-market-metric argument judgement drifted/u,
    label: "metric-code fingerprint",
    mutate: (report) => {
      const result = report.results.find(
        ({ id }) => id === "comparable-market-metric",
      );
      const call = result?.normalizedArgs.find(
        ({ tool }) => tool === "compareMarkets",
      );
      const metrics = call?.args.metricCodes;
      const fingerprint = Array.isArray(metrics) ? metrics[0] : undefined;
      if (
        typeof fingerprint !== "object" ||
        fingerprint === null ||
        Array.isArray(fingerprint)
      ) {
        throw new Error("Synthetic metric fingerprint is absent.");
      }
      fingerprint.digest = "b".repeat(64);
    },
  },
  {
    expectedError: /source-document-retrieval argument judgement drifted/u,
    label: "knowledge-query contract observation",
    mutate: (report) => {
      const result = report.results.find(
        ({ id }) => id === "source-document-retrieval",
      );
      const call = result?.normalizedArgs.find(
        ({ tool }) => tool === "searchKnowledgeBase",
      );
      const query = call?.args.query;
      if (
        typeof query !== "object" ||
        query === null ||
        Array.isArray(query)
      ) {
        throw new Error("Synthetic query observation is absent.");
      }
      const queryRecord = query as Record<string, unknown>;
      const matched = queryRecord.matchedRequiredTermIds;
      if (!Array.isArray(matched) || typeof matched[0] !== "string") {
        throw new Error("Synthetic query term observation is absent.");
      }
      queryRecord.matchedRequiredTermIds = matched.slice(1);
      queryRecord.missingRequiredTermIds = [matched[0]];
      queryRecord.expectationPassed = false;
    },
  },
  {
    archiveMode: "mismatch",
    expectedError: /does not byte-match its append-only archive/u,
    label: "archive bytes",
    mutate: () => undefined,
  },
  {
    archiveMode: "original",
    expectedError: /ENOENT|no such file/u,
    label: "run ID archive identity",
    mutate: (report) => {
      report.runId = "22222222-2222-4222-8222-222222222222";
    },
  },
];

describe("portfolio current live-eval detailed verification", () => {
  it("recomputes an unavailable trace after a completed tool-bearing step without scoring it", async () => {
    const report = buildSyntheticLiveEvalReport({
      commit: "a".repeat(40), fingerprintDigest: "b".repeat(64), fingerprintFileCount: 1,
    });
    const result = report.results[0]!;
    Object.assign(result, {
      argsPassed: false, attemptCount: 2, detectedResponseLocale: "indeterminate",
      errorCode: "EVAL_CASE_ERROR", evidenceAllowed: false,
      evidenceExpectationPassed: false, evidenceResult: "error",
      failureMessage: "TimeoutError: Eval case execution failed.",
      matchedResponseAnchorIds: [], missingResponseAnchorIds: [...result.matchedResponseAnchorIds],
      mismatchReason: "error:EVAL_CASE_ERROR,token_usage", normalizedArgs: [], pass: false,
      responseCharacterCount: 0, responseDisposition: "not_evaluated",
      responseDispositionPassed: false, responseGroundingPassed: false,
      responseLocalePassed: false, safetyPassed: null, toolSelectionPassed: false,
      toolSequence: [], toolTraceStatus: "unavailable",
    });
    result.tokenUsage.usageComplete = false;
    result.modelObservability = buildLiveEvalCaseObservability({
      attemptCount: 2, completedCount: 1, expectedStepCount: 1,
      modelStreamCompleted: false, steps: result.modelObservability.steps,
    });
    report.results = [result];
    report.complete = false;
    report.sampleCount = 1;
    report.thresholdsPassed = false;
    report.terminationReason = "case_error";
    Object.assign(report.budget, {
      attemptCount: 2, caseCount: 1, completedCount: 1, modelStepCount: 1,
      tokenUsageComplete: false, totalTokens: 15,
    });
    report.observability = summarizeLiveEvalObservability(report.results.map(
      ({ latencyMs, modelObservability }) => ({ latencyMs, modelObservability }),
    ));
    report.scores = scoreLiveEval(report.results);
    await expect(verifyLiveEvalReportConsistency(report)).resolves.toEqual({
      sampleCount: 1, suiteCaseCount: 18, thresholdsPassed: false,
    });
    expect(result.toolBearingSteps).toBe(1);
    expect(result.tokenUsage.total).toBe(15);
    await expect(verifyLiveEvalReportConsistency({
      ...report, results: [{ ...result, toolTraceStatus: "complete" }],
    })).rejects.toThrow(/unavailable tool traces/u);
    await expect(verifyLiveEvalReportConsistency({
      ...report, results: [{ ...result, toolBearingSteps: 2 }],
    })).rejects.toThrow(/tool-bearing steps cannot exceed/u);
  });

  it("allows anonymous tool-step telemetry only for an unavailable execution error", () => {
    const result = {
      id: "aborted-after-tool-step", errorCode: "EVAL_CASE_ERROR",
      toolTraceStatus: "unavailable" as const, loopSteps: 1,
      toolBearingSteps: 1, toolSequence: [],
    };
    expect(() => assertLiveEvalToolBearingStepInvariant(result)).not.toThrow();
    expect(() => assertLiveEvalToolBearingStepInvariant({ ...result, errorCode: null }))
      .toThrow(/invalid unavailable/u);
    expect(() => assertLiveEvalToolBearingStepInvariant({ ...result, toolSequence: ["getCountryProfile"] }))
      .toThrow(/invalid unavailable/u);
    expect(() => assertLiveEvalToolBearingStepInvariant({ ...result, toolBearingSteps: 2 }))
      .toThrow(/across only/u);
    expect(() => assertLiveEvalToolBearingStepInvariant({ ...result, toolTraceStatus: "complete" }))
      .toThrow(/without any tool calls/u);
  });

  it("requires tool-bearing steps to be zero iff there are no tool calls", () => {
    expect(() =>
      assertLiveEvalToolBearingStepInvariant({
        id: "no-tools",
        loopSteps: 1,
        toolBearingSteps: 1,
        toolSequence: [],
      })
    ).toThrow(/tool-bearing steps without any tool calls/u);
    expect(() =>
      assertLiveEvalToolBearingStepInvariant({
        id: "with-tools",
        loopSteps: 1,
        toolBearingSteps: 0,
        toolSequence: ["getCountryProfile"],
      })
    ).toThrow(/tool calls without a tool-bearing step/u);
    expect(() =>
      assertLiveEvalToolBearingStepInvariant({
        id: "no-tools",
        loopSteps: 1,
        toolBearingSteps: 0,
        toolSequence: [],
      })
    ).not.toThrow();
    expect(() =>
      assertLiveEvalToolBearingStepInvariant({
        id: "with-tools",
        loopSteps: 1,
        toolBearingSteps: 1,
        toolSequence: ["getCountryProfile"],
      })
    ).not.toThrow();
  });

  it("recomputes a complete 18-case synthetic report without a provider", async () => {
    const fixture = await createSyntheticWorkspace();
    try {
      const reportText = await readFile(fixture.latestPath, "utf8");
      expect(JSON.parse(reportText)).toMatchObject({
        complete: true,
        sampleCount: 18,
        thresholdsPassed: true,
        version: "sales-chat-live-v26",
      });
      await expect(
        verifyLiveEvalEvidence({
          releaseHeadCommit: requireCleanRepository(fixture.report)
            .baseHeadCommit,
          reportText,
          snapshot: buildSyntheticLiveEvalSnapshot(),
          workspace: fixture.workspace,
        }),
      ).resolves.toEqual({
        sampleCount: 18,
        suiteCaseCount: 18,
        thresholdsPassed: true,
      });
    } finally {
      await rm(fixture.workspace, { force: true, recursive: true });
    }
  });

  it("allows dirty passing evidence for diagnosis but rejects it as release-grade", async () => {
    const fixture = await createSyntheticWorkspace();
    try {
      const report = structuredClone(fixture.report);
      report.provenance.repository = {
        baseHeadCommit: requireCleanRepository(report).baseHeadCommit,
        evaluatedCommit: null,
        worktreeState: "dirty",
      };
      const reportText = serializeReport(report);
      await Promise.all([
        writeFile(fixture.latestPath, reportText, "utf8"),
        writeFile(fixture.archivePath, reportText, "utf8"),
      ]);

      await expect(
        verifyLiveEvalEvidence({
          reportText,
          snapshot: buildSyntheticLiveEvalSnapshot(),
          workspace: fixture.workspace,
        }),
      ).resolves.toMatchObject({ thresholdsPassed: true });
      await expect(
        verifyLiveEvalEvidence({
          releaseHeadCommit: report.provenance.repository.baseHeadCommit,
          reportText,
          snapshot: buildSyntheticLiveEvalSnapshot(),
          workspace: fixture.workspace,
        }),
      ).rejects.toThrow(/clean exact-commit provenance/u);
    } finally {
      await rm(fixture.workspace, { force: true, recursive: true });
    }
  });

  it("rejects duplicate JSON keys before schema validation", async () => {
    const fixture = await createSyntheticWorkspace();
    try {
      const canonicalText = await readFile(fixture.latestPath, "utf8");
      const duplicateKeyText = canonicalText.replace(
        '  "thresholdsPassed": true,',
        '  "thresholdsPassed": false,\n  "thresholdsPassed": true,',
      );
      expect(duplicateKeyText).not.toBe(canonicalText);
      expect(
        liveEvalReportSchema.safeParse(JSON.parse(duplicateKeyText)).success,
      ).toBe(true);
      await Promise.all([
        writeFile(fixture.latestPath, duplicateKeyText, "utf8"),
        writeFile(fixture.archivePath, duplicateKeyText, "utf8"),
      ]);

      await expect(
        verifyLiveEvalEvidence({
          reportText: duplicateKeyText,
          snapshot: buildSyntheticLiveEvalSnapshot(),
          workspace: fixture.workspace,
        }),
      ).rejects.toThrow(/canonical JSON bytes/u);
    } finally {
      await rm(fixture.workspace, { force: true, recursive: true });
    }
  });

  it("rejects a resynchronized passing report with contradictory cache evidence", async () => {
    const fixture = await createSyntheticWorkspace();
    try {
      const report = structuredClone(fixture.report);
      const result = report.results[0];
      const step = result?.modelObservability.steps[0];
      if (!result || !step) {
        throw new Error("Synthetic live-eval cache observation is absent.");
      }
      step.cacheStatus = "unavailable";
      result.modelObservability = buildLiveEvalCaseObservability({
        attemptCount: result.attemptCount,
        completedCount: result.completedCount,
        expectedStepCount: result.loopSteps,
        modelStreamCompleted: true,
        steps: result.modelObservability.steps,
      });
      report.observability = summarizeLiveEvalObservability(
        report.results.map(({ latencyMs, modelObservability }) => ({
          latencyMs,
          modelObservability,
        })),
      );
      const reportText = serializeReport(report);
      await Promise.all([
        writeFile(fixture.latestPath, reportText, "utf8"),
        writeFile(fixture.archivePath, reportText, "utf8"),
      ]);

      expect(liveEvalReportSchema.safeParse(JSON.parse(reportText)).success).toBe(
        false,
      );
      await expect(
        verifyLiveEvalEvidence({
          reportText,
          snapshot: buildSyntheticLiveEvalSnapshot(),
          workspace: fixture.workspace,
        }),
      ).rejects.toThrow(/cacheStatus is incompatible/u);
    } finally {
      await rm(fixture.workspace, { force: true, recursive: true });
    }
  });

  it("rejects forged query-contract IDs even when arguments already fail", async () => {
    const fixture = await createSyntheticWorkspace();
    try {
      const report = structuredClone(fixture.report);
      const result = report.results.find(
        ({ id }) => id === "source-document-retrieval",
      );
      const call = result?.normalizedArgs.find(
        ({ tool }) => tool === "searchKnowledgeBase",
      );
      const query = call?.args.query;
      if (
        !result ||
        typeof query !== "object" ||
        query === null ||
        Array.isArray(query)
      ) {
        throw new Error("Synthetic query observation is absent.");
      }
      const queryRecord = query as Record<string, unknown>;
      queryRecord.expectationPassed = false;
      queryRecord.matchedForbiddenTermIds = [];
      queryRecord.matchedRequiredTermIds = [];
      queryRecord.missingRequiredTermIds = ["query:forged"];
      result.argsPassed = false;
      result.mismatchReason = "arguments";
      result.pass = false;
      report.scores.argsAccuracyPct = 94.44;
      report.thresholdsPassed = false;
      const snapshot = buildSyntheticLiveEvalSnapshot();
      snapshot.latestOutcome = "failed";
      const reportText = serializeReport(report);
      await Promise.all([
        writeFile(fixture.latestPath, reportText, "utf8"),
        writeFile(fixture.archivePath, reportText, "utf8"),
      ]);

      await expect(
        verifyLiveEvalEvidence({
          reportText,
          snapshot,
          workspace: fixture.workspace,
        }),
      ).rejects.toThrow(/knowledge-query contract observation drifted/u);
    } finally {
      await rm(fixture.workspace, { force: true, recursive: true });
    }
  });

  it("rejects a stale latest even when its own archive byte-matches", async () => {
    const fixture = await createSyntheticWorkspace();
    try {
      const staleReportText = await readFile(fixture.archivePath, "utf8");
      const newerReport = structuredClone(fixture.report);
      newerReport.evaluatedAt = "2026-08-30T00:01:00.000Z";
      newerReport.runId = "22222222-2222-4222-8222-222222222222";
      await persistLiveEvalReport(fixture.workspace, newerReport);
      await writeFile(fixture.latestPath, staleReportText, "utf8");

      await expect(
        verifyLiveEvalEvidence({
          reportText: await readFile(fixture.latestPath, "utf8"),
          snapshot: buildSyntheticLiveEvalSnapshot(),
          workspace: fixture.workspace,
        }),
      ).rejects.toThrow(/not the newest modern archive/u);
    } finally {
      await rm(fixture.workspace, { force: true, recursive: true });
    }
  });

  it("strictly validates non-latest modern v10 archives", async () => {
    const fixture = await createSyntheticWorkspace();
    try {
      const historical = buildHistoricalV10Report(fixture.report);
      expect(liveEvalReportSchema.safeParse(historical).success).toBe(true);
      const results = historical.results;
      if (!Array.isArray(results)) {
        throw new Error("Synthetic historical report has no result rows.");
      }
      const firstResult = results[0];
      if (
        typeof firstResult !== "object" ||
        firstResult === null ||
        Array.isArray(firstResult)
      ) {
        throw new Error("Synthetic historical report has no first result.");
      }
      const normalizedArgs = (firstResult as Record<string, unknown>)
        .normalizedArgs;
      if (!Array.isArray(normalizedArgs) || normalizedArgs.length === 0) {
        throw new Error("Synthetic historical result has no normalized args.");
      }
      const firstCall = normalizedArgs[0];
      if (
        typeof firstCall !== "object" ||
        firstCall === null ||
        Array.isArray(firstCall)
      ) {
        throw new Error("Synthetic historical result has no first tool call.");
      }
      const args = (firstCall as Record<string, unknown>).args;
      if (typeof args !== "object" || args === null || Array.isArray(args)) {
        throw new Error("Synthetic historical tool call has no arguments.");
      }
      (args as Record<string, unknown>).rawQuery = "must-not-be-persisted";
      const historicalPath = resolveLiveEvalArchiveReportPath(
        fixture.workspace,
        historical,
      );
      await writeFile(
        historicalPath,
        `${JSON.stringify(historical, null, 2)}\n`,
        "utf8",
      );

      await expect(
        verifyLiveEvalEvidence({
          reportText: await readFile(fixture.latestPath, "utf8"),
          snapshot: buildSyntheticLiveEvalSnapshot(),
          workspace: fixture.workspace,
        }),
      ).rejects.toThrow(/failed versioned schema validation/u);
    } finally {
      await rm(fixture.workspace, { force: true, recursive: true });
    }
  });

  it("pins the two modern v2 compatibility archives by exact digest", async () => {
    const fixture = await createSyntheticWorkspace();
    try {
      const frozenIdentity = {
        evaluatedAt: "2026-08-29T20:19:50.744Z",
        runId: "2aeb8159-8ece-4015-a396-95e9bbf537fe",
      };
      await writeFile(
        resolveLiveEvalArchiveReportPath(fixture.workspace, frozenIdentity),
        `${JSON.stringify(
          { ...frozenIdentity, version: "sales-chat-live-v2" },
          null,
          2,
        )}\n`,
        "utf8",
      );

      await expect(
        verifyLiveEvalEvidence({
          reportText: await readFile(fixture.latestPath, "utf8"),
          snapshot: buildSyntheticLiveEvalSnapshot(),
          workspace: fixture.workspace,
        }),
      ).rejects.toThrow(/Frozen modern v2 live eval archive drifted/u);
    } finally {
      await rm(fixture.workspace, { force: true, recursive: true });
    }
  });

  it("accepts token_limit_exceeded ahead of completed for a complete over-budget run", async () => {
    const fixture = await createSyntheticWorkspace();
    try {
      const report = structuredClone(fixture.report);
      exceedAcceptedTokenBudget(report);
      const snapshot = buildSyntheticLiveEvalSnapshot();
      snapshot.latestOutcome = "failed";
      const reportText = serializeReport(report);
      await Promise.all([
        writeFile(fixture.latestPath, reportText, "utf8"),
        writeFile(fixture.archivePath, reportText, "utf8"),
      ]);

      await expect(
        verifyLiveEvalEvidence({
          reportText,
          snapshot,
          workspace: fixture.workspace,
        }),
      ).resolves.toEqual({
        sampleCount: 18,
        suiteCaseCount: 18,
        thresholdsPassed: false,
      });
    } finally {
      await rm(fixture.workspace, { force: true, recursive: true });
    }
  });

  it("accepts a final runner budget stop exactly at the token limit", async () => {
    const fixture = await createSyntheticWorkspace();
    try {
      const report = structuredClone(fixture.report);
      stopAtAcceptedTokenBudget(report);
      const snapshot = buildSyntheticLiveEvalSnapshot();
      snapshot.latestOutcome = "failed";
      const reportText = serializeReport(report);
      await Promise.all([
        writeFile(fixture.latestPath, reportText, "utf8"),
        writeFile(fixture.archivePath, reportText, "utf8"),
      ]);

      await expect(
        verifyLiveEvalEvidence({
          reportText,
          snapshot,
          workspace: fixture.workspace,
        }),
      ).resolves.toEqual({
        sampleCount: 18,
        suiteCaseCount: 18,
        thresholdsPassed: false,
      });
      expect(report.results.at(-1)).toMatchObject({
        errorCode: "EVAL_BUDGET_STOP",
        normalizedArgs: expect.any(Array),
        pass: false,
        tokenUsage: {
          ledger: [expect.objectContaining({ total: expect.any(Number) })],
          usageComplete: true,
        },
      });
    } finally {
      await rm(fixture.workspace, { force: true, recursive: true });
    }
  });

  it("rejects completed when complete token usage exceeds the accepted budget", async () => {
    const fixture = await createSyntheticWorkspace();
    try {
      const report = structuredClone(fixture.report);
      exceedAcceptedTokenBudget(report);
      report.terminationReason = "completed";
      const snapshot = buildSyntheticLiveEvalSnapshot();
      snapshot.latestOutcome = "failed";
      const reportText = serializeReport(report);
      await Promise.all([
        writeFile(fixture.latestPath, reportText, "utf8"),
        writeFile(fixture.archivePath, reportText, "utf8"),
      ]);

      await expect(
        verifyLiveEvalEvidence({
          reportText,
          snapshot,
          workspace: fixture.workspace,
        }),
      ).rejects.toThrow(/Live eval termination reason drifted/u);
    } finally {
      await rm(fixture.workspace, { force: true, recursive: true });
    }
  });

  it("prioritizes incomplete usage over completed for a full 18-case run", async () => {
    const fixture = await createSyntheticWorkspace();
    try {
      const report = structuredClone(fixture.report);
      const lastResult = report.results.at(-1);
      if (!lastResult) {
        throw new Error("Synthetic live-eval report has no result rows.");
      }
      lastResult.tokenUsage.input = null;
      const lastLedgerEntry = lastResult.tokenUsage.ledger[0];
      if (!lastLedgerEntry) {
        throw new Error("Synthetic live-eval result has no token ledger row.");
      }
      lastLedgerEntry.input = null;
      lastResult.tokenUsage.usageComplete = false;
      lastResult.pass = false;
      lastResult.mismatchReason = "token_usage";
      report.budget.tokenUsageComplete = false;
      report.thresholdsPassed = false;
      report.terminationReason = "token_usage_incomplete";
      synchronizeV11Observability(report);
      const snapshot = buildSyntheticLiveEvalSnapshot();
      snapshot.latestOutcome = "failed";
      let reportText = serializeReport(report);
      await Promise.all([
        writeFile(fixture.latestPath, reportText, "utf8"),
        writeFile(fixture.archivePath, reportText, "utf8"),
      ]);

      await expect(
        verifyLiveEvalEvidence({
          reportText,
          snapshot,
          workspace: fixture.workspace,
        }),
      ).resolves.toEqual({
        sampleCount: 18,
        suiteCaseCount: 18,
        thresholdsPassed: false,
      });

      report.terminationReason = "completed";
      reportText = serializeReport(report);
      await Promise.all([
        writeFile(fixture.latestPath, reportText, "utf8"),
        writeFile(fixture.archivePath, reportText, "utf8"),
      ]);
      await expect(
        verifyLiveEvalEvidence({
          reportText,
          snapshot,
          workspace: fixture.workspace,
        }),
      ).rejects.toThrow(/Live eval termination reason drifted/u);
    } finally {
      await rm(fixture.workspace, { force: true, recursive: true });
    }
  });

  it("fails the gate when a provider exceeds the per-call output cap", async () => {
    const fixture = await createSyntheticWorkspace();
    try {
      const report = structuredClone(fixture.report);
      const firstResult = report.results[0];
      const firstLedgerEntry = firstResult?.tokenUsage.ledger[0];
      if (!firstResult || !firstLedgerEntry) {
        throw new Error("Synthetic live-eval report has no first token step.");
      }
      firstLedgerEntry.output = 1_025;
      firstLedgerEntry.total = 1_035;
      firstResult.tokenUsage.output = 1_025;
      firstResult.tokenUsage.total = 1_035;
      report.budget.totalTokens += 1_020;
      report.thresholdsPassed = false;
      synchronizeV11Observability(report);
      const snapshot = buildSyntheticLiveEvalSnapshot();
      snapshot.latestOutcome = "failed";
      let reportText = serializeReport(report);
      await Promise.all([
        writeFile(fixture.latestPath, reportText, "utf8"),
        writeFile(fixture.archivePath, reportText, "utf8"),
      ]);

      await expect(
        verifyLiveEvalEvidence({
          reportText,
          snapshot,
          workspace: fixture.workspace,
        }),
      ).resolves.toMatchObject({ thresholdsPassed: false });

      report.thresholdsPassed = true;
      reportText = serializeReport(report);
      await Promise.all([
        writeFile(fixture.latestPath, reportText, "utf8"),
        writeFile(fixture.archivePath, reportText, "utf8"),
      ]);
      await expect(
        verifyLiveEvalEvidence({
          reportText,
          snapshot,
          workspace: fixture.workspace,
        }),
      ).rejects.toThrow(/Live eval threshold result drifted/u);
    } finally {
      await rm(fixture.workspace, { force: true, recursive: true });
    }
  });

  it("rejects cases recorded after the pre-case reserve should stop the run", async () => {
    const fixture = await createSyntheticWorkspace();
    try {
      const report = structuredClone(fixture.report);
      const firstResult = report.results[0];
      const firstLedgerEntry = firstResult?.tokenUsage.ledger[0];
      if (!firstResult || !firstLedgerEntry) {
        throw new Error("Synthetic live-eval report has no first token step.");
      }
      firstLedgerEntry.input = 147_976;
      firstLedgerEntry.output = 1_024;
      firstLedgerEntry.total = 149_000;
      firstResult.tokenUsage.input = 147_976;
      firstResult.tokenUsage.output = 1_024;
      firstResult.tokenUsage.total = 149_000;
      report.budget.totalTokens += 148_985;
      synchronizeV11Observability(report);
      const reportText = serializeReport(report);
      await Promise.all([
        writeFile(fixture.latestPath, reportText, "utf8"),
        writeFile(fixture.archivePath, reportText, "utf8"),
      ]);

      await expect(
        verifyLiveEvalEvidence({
          reportText,
          snapshot: buildSyntheticLiveEvalSnapshot(),
          workspace: fixture.workspace,
        }),
      ).rejects.toThrow(/recorded after the token_reserve stop condition/u);
    } finally {
      await rm(fixture.workspace, { force: true, recursive: true });
    }
  });

  it("rejects a deterministic demo profile as live-provider evidence", async () => {
    const fixture = await createSyntheticWorkspace();
    try {
      const report = structuredClone(fixture.report);
      report.modelId = "portfolio-demo/deterministic-v1";
      report.provenance.providerProfile = {
        adapter: "portfolio-demo",
        adapterContractVersion: 1,
        enableThinking: null,
        endpointSha256: null,
        includeUsage: false,
      };
      const snapshot = buildSyntheticLiveEvalSnapshot();
      snapshot.expectedModelId = report.modelId;
      snapshot.expectedProviderProfile = report.provenance.providerProfile;
      const reportText = serializeReport(report);
      expect(() =>
        liveEvalReportSchema.parse(JSON.parse(reportText)),
      ).not.toThrow();
      await Promise.all([
        writeFile(fixture.latestPath, reportText, "utf8"),
        writeFile(fixture.archivePath, reportText, "utf8"),
      ]);

      await expect(
        verifyLiveEvalEvidence({
          reportText,
          snapshot,
          workspace: fixture.workspace,
        }),
      ).rejects.toThrow(/Live eval remote provider adapter drifted/u);
    } finally {
      await rm(fixture.workspace, { force: true, recursive: true });
    }
  });

  it("rejects a mutually consistent profile that does not request streaming usage", async () => {
    const fixture = await createSyntheticWorkspace();
    try {
      const report = structuredClone(fixture.report);
      const profile = report.provenance.providerProfile;
      if (!profile) {
        throw new Error("Synthetic live-eval provider profile is absent.");
      }
      profile.includeUsage = false;
      const snapshot = buildSyntheticLiveEvalSnapshot();
      snapshot.expectedProviderProfile = {
        ...snapshot.expectedProviderProfile,
        includeUsage: false,
      };
      const reportText = serializeReport(report);
      await Promise.all([
        writeFile(fixture.latestPath, reportText, "utf8"),
        writeFile(fixture.archivePath, reportText, "utf8"),
      ]);

      await expect(
        verifyLiveEvalEvidence({
          reportText,
          snapshot,
          workspace: fixture.workspace,
        }),
      ).rejects.toThrow(/Live eval streaming usage request drifted/u);
    } finally {
      await rm(fixture.workspace, { force: true, recursive: true });
    }
  });

  it.each(tamperCases)(
    "rejects $label tampering",
    async ({ archiveMode = "match", expectedError, mutate, schemaValid = true }) => {
      const fixture = await createSyntheticWorkspace();
      try {
        const report = structuredClone(fixture.report);
        mutate(report, fixture);
        const reportText = serializeReport(report);
        expect(liveEvalReportSchema.safeParse(JSON.parse(reportText)).success)
          .toBe(schemaValid);
        await writeFile(fixture.latestPath, reportText, "utf8");
        if (archiveMode === "match") {
          await writeFile(fixture.archivePath, reportText, "utf8");
        } else if (archiveMode === "mismatch") {
          await writeFile(fixture.archivePath, "{}\n", "utf8");
        }

        await expect(
          verifyLiveEvalEvidence({
            reportText: await readFile(fixture.latestPath, "utf8"),
            snapshot: buildSyntheticLiveEvalSnapshot(),
            workspace: fixture.workspace,
          }),
        ).rejects.toThrow(expectedError);
      } finally {
        await rm(fixture.workspace, { force: true, recursive: true });
      }
    },
  );
});
