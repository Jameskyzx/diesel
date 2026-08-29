import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import {
  salesChatLiveCases,
  SALES_CHAT_LIVE_EVAL_VERSION,
} from "../../evals/sales-chat-live-cases";
import {
  LIVE_EVAL_CASE_TIMEOUT_MS,
  LIVE_EVAL_CASE_TOKEN_RESERVE,
  LIVE_EVAL_MAX_CASES,
  LIVE_EVAL_MAX_TOKENS,
  LIVE_EVAL_THRESHOLDS,
  judgeLiveEvalCase,
  liveEvalResponseDispositionPassed,
  liveEvalThresholdsPassed,
  matchesExpectedArgs,
  resolveLiveEvalStopReason,
  scoreLiveEval,
} from "../../src/domain/ai/live-eval";
import {
  MAX_AI_TOOL_STEPS,
  SALES_CHAT_SYSTEM_PROMPT_VERSION,
} from "../../src/features/ai/constants";
import { portfolioReleaseCountryIso3s } from "../../src/domain/portfolio-evidence";
import {
  getApprovedRealCertificationIds,
  getApprovedRealProductIds,
} from "../../src/server/config/public-product-publication";
import { buildFixtureLimits } from "../../src/server/db/seed/acceptance-fixtures";
import {
  captureLiveEvalSourceFingerprint,
  verifyLiveEvalArchiveMatchesLatest,
} from "../ai/live-eval-report";
import { deriveLiveEvalReportState } from "./live-eval-report-state";
import { liveEvalResultSchema } from "./live-eval-result-schema";
import { buildFullIngestSelection } from "../db/fixture-target-selection";
import { recomputeLiveEvalTokenLedger } from "./live-eval-token-ledger";

const gitShaSchema = z.string().regex(/^[0-9a-f]{40}$/);
const minutePrecisionTimestampSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}[+-]\d{2}:\d{2}$/,
);

const statusSnapshotSchema = z.object({
  currentPublicRelease: z.object({
    commit: gitShaSchema,
    id: gitShaSchema,
    observedAt: minutePrecisionTimestampSchema,
    releasePath: z.string().startsWith("/opt/diesel/releases/"),
  }),
  evidenceSummary: z.object({
    approvedRealCertifications: z.number().int().nonnegative(),
    approvedRealProducts: z.number().int().nonnegative(),
    jurisdictions: z.number().int().nonnegative(),
    limits: z.number().int().nonnegative(),
    regulations: z.number().int().nonnegative(),
    sources: z.number().int().nonnegative(),
  }),
  liveEval: z.object({
    latestOutcome: z.enum(["failed", "passed"]),
    latestSampleCount: z.number().int().nonnegative(),
    reportVersion: z.string().min(1),
    suiteCaseCount: z.number().int().positive(),
  }),
  lastDocumentedRelease: z.object({
    commit: gitShaSchema,
    id: z.string().regex(/^\d{14}$/),
  }),
  publicRuntime: z.object({
    readbackAt: minutePrecisionTimestampSchema,
    status: z.literal("ok"),
    version: gitShaSchema,
  }),
  qualitySnapshot: z.object({
    vitestFiles: z.number().int().positive(),
    vitestTests: z.number().int().positive(),
  }),
  repositoryHead: z.object({
    local: gitShaSchema,
    observedAt: minutePrecisionTimestampSchema,
    remote: gitShaSchema,
  }),
});

const observedScoreSchema = z.object({
  argsAccuracyPct: z.number().finite().nullable(),
  evidenceExpectationAccuracyPct: z.number().finite().nullable(),
  responseDispositionAccuracyPct: z.number().finite().nullable(),
  safetyFailClosedPct: z.number().finite().nullable(),
  toolSelectionAccuracyPct: z.number().finite().nullable(),
}).strict();
const thresholdSchema = z.object({
  argsAccuracyPct: z.number().finite(),
  evidenceExpectationAccuracyPct: z.number().finite(),
  responseDispositionAccuracyPct: z.number().finite(),
  safetyFailClosedPct: z.number().finite(),
  toolSelectionAccuracyPct: z.number().finite(),
}).strict();
const liveEvalRepositoryStateSchema = z.discriminatedUnion("worktreeState", [
  z.object({
    baseHeadCommit: gitShaSchema,
    evaluatedCommit: gitShaSchema,
    worktreeState: z.literal("clean"),
  }).strict(),
  z.object({
    baseHeadCommit: gitShaSchema,
    evaluatedCommit: z.null(),
    worktreeState: z.literal("dirty"),
  }).strict(),
  z.object({
    baseHeadCommit: z.null(),
    evaluatedCommit: z.null(),
    worktreeState: z.literal("unavailable"),
  }).strict(),
]);

const liveEvalSourceFingerprintSchema = z.discriminatedUnion("status", [
  z.object({
    algorithm: z.literal("sha256"),
    digest: z.string().regex(/^[0-9a-f]{64}$/u),
    fileCount: z.number().int().positive(),
    status: z.literal("captured"),
  }).strict(),
  z.object({
    algorithm: z.literal("sha256"),
    digest: z.null(),
    fileCount: z.null(),
    status: z.literal("unavailable"),
  }).strict(),
  z.object({
    algorithm: z.literal("sha256"),
    digest: z.null(),
    fileCount: z.null(),
    status: z.literal("unstable"),
  }).strict(),
]);

const liveEvalReportSchema = z.object({
  budget: z.object({
    caseCount: z.number().int().nonnegative(),
    caseTimeoutMs: z.number().int().positive(),
    caseTokenReserve: z.number().int().positive(),
    maxCases: z.number().int().positive(),
    maxLoopStepsPerCase: z.number().int().positive(),
    maxTokens: z.number().int().positive(),
    modelStepCount: z.number().int().nonnegative(),
    tokenUsageComplete: z.boolean(),
    totalTokens: z.number().int().nonnegative(),
  }).strict(),
  complete: z.boolean(),
  evaluatedAt: z.string().datetime(),
  modelId: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._/@:-]*$/u)
    .nullable(),
  provenance: z.object({
    promptVersion: z.literal(SALES_CHAT_SYSTEM_PROMPT_VERSION),
    repository: liveEvalRepositoryStateSchema,
    sourceFingerprint: liveEvalSourceFingerprintSchema,
  }).strict(),
  results: z.array(liveEvalResultSchema),
  runId: z.string().uuid(),
  runError: z
    .object({
      code: z.literal("INITIALIZATION_ERROR"),
      errorName: z.enum([
        "AiConfigurationError",
        "Error",
        "SyntaxError",
        "TypeError",
        "UnknownError",
        "ZodError",
      ]),
      stage: z.enum([
        "module_import",
        "database",
        "model_configuration",
      ]),
    })
    .strict()
    .nullable(),
  sampleCount: z.number().int().nonnegative(),
  scores: observedScoreSchema,
  thresholds: thresholdSchema,
  thresholdsPassed: z.boolean(),
  terminationReason: z.enum([
    "case_error",
    "case_limit",
    "completed",
    "initialization_error",
    "token_reserve",
    "token_usage_incomplete",
  ]),
  version: z.literal(SALES_CHAT_LIVE_EVAL_VERSION),
}).strict();

type StatusSnapshot = z.infer<typeof statusSnapshotSchema>;

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label} drifted. Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`,
    );
  }
}

function run(command: string, args: readonly string[]): string {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const diagnostics = [result.stderr.trim(), result.stdout.trim()]
      .filter((value) => value.length > 0)
      .join("\n");
    throw new Error(
      `${command} ${args.join(" ")} failed with exit status ${result.status ?? "unknown"}` +
        `${diagnostics.length > 0 ? `:\n${diagnostics}` : "."}`,
    );
  }
  return result.stdout;
}

function sameTools(actual: readonly string[], expected: readonly string[]): boolean {
  return JSON.stringify([...actual].sort()) ===
    JSON.stringify([...expected].sort());
}

export function parseStatusSnapshot(markdown: string): StatusSnapshot {
  const match = markdown.match(
    /<!-- portfolio-verification:start -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- portfolio-verification:end -->/,
  );
  if (!match?.[1]) {
    throw new Error("docs/STATUS.md is missing the portfolio verification snapshot.");
  }
  return statusSnapshotSchema.parse(JSON.parse(match[1]));
}

export function countVitestList(output: string): { files: number; tests: number } {
  const ansiPattern = /\u001b\[[0-?]*[ -/]*[@-~]/g;
  const files = new Set<string>();
  let tests = 0;
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.replace(ansiPattern, "");
    const match = line.match(/^(tests\/[^>]+\.(?:test|spec)\.[cm]?[jt]sx?) > /);
    if (!match?.[1]) {
      continue;
    }
    files.add(match[1]);
    tests += 1;
  }
  if (files.size === 0 || tests === 0) {
    throw new Error("Vitest list output did not contain any discoverable tests.");
  }
  return { files: files.size, tests };
}

async function verify(): Promise<void> {
  const workspace = process.cwd();
  const [statusMarkdown, reportText] = await Promise.all([
    readFile(resolve(workspace, "docs/STATUS.md"), "utf8"),
    readFile(resolve(workspace, "docs/evals/ai-live-eval-latest.json"), "utf8"),
  ]);
  const snapshot = parseStatusSnapshot(statusMarkdown);

  const lineageShas = new Set([
    snapshot.currentPublicRelease.commit,
    snapshot.currentPublicRelease.id,
    snapshot.lastDocumentedRelease.commit,
    snapshot.publicRuntime.version,
    snapshot.repositoryHead.local,
    snapshot.repositoryHead.remote,
  ]);
  for (const sha of lineageShas) {
    run("git", ["cat-file", "-e", `${sha}^{commit}`]);
  }
  assertEqual(
    snapshot.repositoryHead.local,
    snapshot.repositoryHead.remote,
    "Observed local/remote repository head",
  );
  assertEqual(
    snapshot.currentPublicRelease.id,
    snapshot.currentPublicRelease.commit,
    "Current public release ID/commit",
  );
  assertEqual(
    snapshot.currentPublicRelease.commit,
    snapshot.repositoryHead.remote,
    "Current public release/repository head",
  );
  assertEqual(
    snapshot.publicRuntime.version,
    snapshot.currentPublicRelease.commit,
    "Public runtime/release version",
  );
  assertEqual(
    snapshot.currentPublicRelease.releasePath,
    `/opt/diesel/releases/${snapshot.currentPublicRelease.id}`,
    "Current public release path",
  );
  assertEqual(
    snapshot.repositoryHead.observedAt,
    snapshot.currentPublicRelease.observedAt,
    "Repository/public release observation time",
  );
  assertEqual(
    snapshot.publicRuntime.readbackAt,
    snapshot.currentPublicRelease.observedAt,
    "Public runtime/release observation time",
  );
  run("git", [
    "merge-base",
    "--is-ancestor",
    snapshot.lastDocumentedRelease.commit,
    snapshot.currentPublicRelease.commit,
  ]);

  const vitest = countVitestList(
    run("pnpm", ["exec", "vitest", "list", "--reporter=default"]),
  );
  assertEqual(vitest, {
    files: snapshot.qualitySnapshot.vitestFiles,
    tests: snapshot.qualitySnapshot.vitestTests,
  }, "Vitest snapshot");

  const selection = buildFullIngestSelection(
    portfolioReleaseCountryIso3s,
    buildFixtureLimits(),
  );
  const evidenceSummary = {
    approvedRealCertifications: getApprovedRealCertificationIds().length,
    approvedRealProducts: getApprovedRealProductIds().length,
    jurisdictions: selection.jurisdictionIds.size,
    limits: selection.limitRows.length,
    regulations: selection.regulationIds.size,
    sources: selection.sourceIds.size,
  };
  assertEqual(evidenceSummary, snapshot.evidenceSummary, "Evidence summary");

  const report = liveEvalReportSchema.parse(JSON.parse(reportText));
  assertEqual(
    report.provenance.promptVersion,
    SALES_CHAT_SYSTEM_PROMPT_VERSION,
    "Live eval prompt version",
  );
  const recordedSourceFingerprint = report.provenance.sourceFingerprint;
  if (recordedSourceFingerprint.status !== "captured") {
    throw new Error(
      "The checked-in live eval report does not contain a stable evaluated-source fingerprint.",
    );
  }
  const currentSourceFingerprint = await captureLiveEvalSourceFingerprint(
    workspace,
  );
  if (currentSourceFingerprint.status !== "captured") {
    throw new Error(
      "The current worktree source fingerprint could not be captured.",
    );
  }
  assertEqual(
    currentSourceFingerprint,
    recordedSourceFingerprint,
    "Live eval evaluated-source fingerprint",
  );
  const reportRepository = report.provenance.repository;
  if (reportRepository.worktreeState === "unavailable") {
    throw new Error(
      "The checked-in live eval report does not contain resolvable repository provenance.",
    );
  }
  run("git", ["cat-file", "-e", `${reportRepository.baseHeadCommit}^{commit}`]);
  if (reportRepository.worktreeState === "clean") {
    assertEqual(
      reportRepository.evaluatedCommit,
      reportRepository.baseHeadCommit,
      "Clean live eval repository provenance",
    );
  } else {
    assertEqual(
      reportRepository.evaluatedCommit,
      null,
      "Dirty live eval exact commit",
    );
  }
  await verifyLiveEvalArchiveMatchesLatest(workspace, report, reportText);
  assertEqual(report.version, SALES_CHAT_LIVE_EVAL_VERSION, "Live eval case/report version");
  assertEqual(report.version, snapshot.liveEval.reportVersion, "STATUS live eval version");
  assertEqual(
    salesChatLiveCases.length,
    snapshot.liveEval.suiteCaseCount,
    "Live eval suite case count",
  );
  assertEqual(
    report.results.length,
    snapshot.liveEval.latestSampleCount,
    "Latest live eval sample count",
  );
  assertEqual(report.sampleCount, report.results.length, "Live eval sample count");
  assertEqual(report.budget.caseCount, report.results.length, "Live eval budget case count");
  assertEqual(report.budget.maxCases, LIVE_EVAL_MAX_CASES, "Live eval maximum case budget");
  assertEqual(salesChatLiveCases.length, LIVE_EVAL_MAX_CASES, "Live eval case-suite size");
  assertEqual(report.budget.maxTokens, LIVE_EVAL_MAX_TOKENS, "Live eval token budget");
  assertEqual(
    report.budget.caseTokenReserve,
    LIVE_EVAL_CASE_TOKEN_RESERVE,
    "Live eval per-case token reserve",
  );
  assertEqual(
    report.budget.caseTimeoutMs,
    LIVE_EVAL_CASE_TIMEOUT_MS,
    "Live eval per-case timeout",
  );
  assertEqual(
    report.budget.maxLoopStepsPerCase,
    MAX_AI_TOOL_STEPS,
    "Live eval per-case loop-step budget",
  );
  const reportState = deriveLiveEvalReportState({
    resultIds: report.results.map(({ id }) => id),
    runError: report.runError,
    suiteIds: salesChatLiveCases.map(({ id }) => id),
  });
  assertEqual(report.complete, reportState.complete, "Live eval completeness");
  if (report.runError !== null) {
    assertEqual(report.modelId, null, "Initialization-failure model ID");
    assertEqual(
      report.budget.modelStepCount,
      0,
      "Initialization-failure model steps",
    );
  } else if (report.modelId === null) {
    throw new Error("A started live eval must identify its model.");
  }
  const { caseUsages: recomputedTokenUsages, tokenBudget } =
    recomputeLiveEvalTokenLedger(
      report.results.map(({ errorCode, loopSteps, tokenUsage }) => ({
        errorCode,
        loopSteps,
        tokenUsage,
      })),
    );
  assertEqual(
    report.budget.tokenUsageComplete,
    tokenBudget.tokenUsageComplete,
    "Live eval token-usage completeness",
  );
  const lastResult = report.results.at(-1);
  const expectedTerminationReason = report.runError !== null
    ? "initialization_error"
    : lastResult?.errorCode === "EVAL_CASE_ERROR"
      ? "case_error"
      : report.results.length === salesChatLiveCases.length
        ? "completed"
        : resolveLiveEvalStopReason({
            caseCount: report.results.length,
            maxCases: report.budget.maxCases,
            maxTokens: report.budget.maxTokens,
            caseTokenReserve: report.budget.caseTokenReserve,
            tokenUsageComplete: tokenBudget.tokenUsageComplete,
            totalTokens: tokenBudget.totalTokens,
          });
  if (expectedTerminationReason === null) {
    throw new Error(
      "Partial live eval report has no valid termination reason.",
    );
  }
  assertEqual(
    report.terminationReason,
    expectedTerminationReason,
    "Live eval termination reason",
  );

  const expectedById = new Map<string, (typeof salesChatLiveCases)[number]>(
    salesChatLiveCases.map((testCase) => [testCase.id, testCase]),
  );
  assertEqual(
    expectedById.size,
    salesChatLiveCases.length,
    "Unique live eval case-definition IDs",
  );
  assertEqual(new Set(report.results.map(({ id }) => id)).size, report.results.length, "Unique live eval IDs");
  for (const [resultIndex, result] of report.results.entries()) {
    const expected = expectedById.get(result.id);
    if (!expected) {
      throw new Error(`Live eval report contains unknown case ${result.id}.`);
    }
    assertEqual(result.expectedEvidenceAllowed, expected.expectedEvidenceAllowed, `${result.id} evidence expectation`);
    assertEqual(result.safetyCritical, expected.safetyCritical, `${result.id} safety classification`);
    assertEqual(
      result.normalizedArgs.map(({ tool }) => tool),
      result.toolSequence,
      `${result.id} tool sequence/argument rows`,
    );
    const toolSelectionPassed = sameTools(
      result.toolSequence,
      expected.expectedTools,
    );
    assertEqual(
      result.toolSelectionPassed,
      toolSelectionPassed,
      `${result.id} tool-selection judgement`,
    );
    const argsPassed = Object.entries(expected.expectedArgs).every(
      ([toolName, expectedArgs]) => {
        const call = result.normalizedArgs.find(
          (candidate) => candidate.tool === toolName,
        );
        return call !== undefined &&
          expectedArgs !== undefined &&
          matchesExpectedArgs(call.args, expectedArgs);
      },
    );
    assertEqual(result.argsPassed, argsPassed, `${result.id} argument judgement`);
    if (result.loopSteps > report.budget.maxLoopStepsPerCase) {
      throw new Error(
        `${result.id} exceeded the live eval loop-step budget. Maximum ${report.budget.maxLoopStepsPerCase}, received ${result.loopSteps}.`,
      );
    }
    if (result.toolBearingSteps > result.loopSteps) {
      throw new Error(
        `${result.id} recorded ${result.toolBearingSteps} tool-bearing steps across only ${result.loopSteps} loop steps.`,
      );
    }
    if (
      result.errorCode === null &&
      result.latencyMs > report.budget.caseTimeoutMs
    ) {
      throw new Error(
        `${result.id} exceeded the live eval case timeout without failing closed. Maximum ${report.budget.caseTimeoutMs}ms, received ${result.latencyMs}ms.`,
      );
    }
    assertEqual(
      result.tokenUsage.usageComplete,
      recomputedTokenUsages[resultIndex]?.usageComplete,
      `${result.id} token-usage completeness`,
    );
    const evidenceResult = result.errorCode !== null
      ? "error"
      : result.evidenceAllowed
        ? "sufficient"
        : "insufficient";
    assertEqual(result.evidenceResult, evidenceResult, `${result.id} evidence result`);
    const judgement = judgeLiveEvalCase({
      argsPassed: result.argsPassed,
      errorCode: result.errorCode,
      evidenceAllowed: result.evidenceAllowed,
      expectedEvidenceAllowed: result.expectedEvidenceAllowed,
      responseDisposition: result.responseDisposition,
      safetyCritical: result.safetyCritical,
      tokenUsageComplete:
        recomputedTokenUsages[resultIndex]?.usageComplete === true,
      toolSelectionPassed: result.toolSelectionPassed,
    });
    assertEqual(result.evidenceExpectationPassed, judgement.evidenceExpectationPassed, `${result.id} evidence judgement`);
    assertEqual(
      result.responseDispositionPassed,
      liveEvalResponseDispositionPassed({
        completed: result.errorCode === null,
        expectedEvidenceAllowed: result.expectedEvidenceAllowed,
        responseDisposition: result.responseDisposition,
      }),
      `${result.id} response-disposition judgement`,
    );
    assertEqual(result.safetyPassed, judgement.safetyPassed, `${result.id} safety judgement`);
    assertEqual(result.pass, judgement.pass, `${result.id} pass judgement`);
    assertEqual(result.mismatchReason, judgement.mismatchReason, `${result.id} mismatch reason`);
  }
  const recomputedScores = scoreLiveEval(report.results);
  assertEqual(report.scores, recomputedScores, "Live eval scores");
  assertEqual(report.thresholds, LIVE_EVAL_THRESHOLDS, "Live eval thresholds");
  assertEqual(
    report.thresholdsPassed,
    liveEvalThresholdsPassed({
      allCasesPassed: report.results.every(({ pass }) => pass),
      complete: reportState.complete,
      maxTokens: report.budget.maxTokens,
      scores: recomputedScores,
      tokenUsageComplete: tokenBudget.tokenUsageComplete,
      totalTokens: report.budget.totalTokens,
    }),
    "Live eval threshold result",
  );
  const latestOutcome = report.thresholdsPassed ? "passed" : "failed";
  assertEqual(
    latestOutcome,
    snapshot.liveEval.latestOutcome,
    "STATUS live eval outcome",
  );
  assertEqual(
    report.budget.modelStepCount,
    report.results.reduce((total, result) => total + result.loopSteps, 0),
    "Live eval model step total",
  );
  assertEqual(
    report.budget.totalTokens,
    tokenBudget.totalTokens,
    "Live eval token total",
  );

  process.stdout.write(
    `Portfolio evidence verified: public runtime ${snapshot.publicRuntime.version} matches the recorded repository head; ` +
      `last fully documented release ${snapshot.lastDocumentedRelease.id}/${snapshot.lastDocumentedRelease.commit}; ` +
      `${vitest.files} Vitest files / ${vitest.tests} tests; ` +
      `${evidenceSummary.jurisdictions} jurisdictions / ${evidenceSummary.regulations} regulations / ` +
      `${evidenceSummary.limits} limits / ${evidenceSummary.sources} sources; ` +
      `${report.results.length}/${salesChatLiveCases.length} live eval cases ` +
      `(${report.thresholdsPassed ? "thresholds passed" : "valid report; live eval failed"}).\n`,
  );
}

void verify().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Portfolio verification failed."}\n`,
  );
  process.exitCode = 1;
});
