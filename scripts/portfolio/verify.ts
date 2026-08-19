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
  liveEvalThresholdsPassed,
  matchesExpectedArgs,
  scoreLiveEval,
} from "../../src/domain/ai/live-eval";
import { MAX_AI_TOOL_STEPS } from "../../src/features/ai/constants";
import { portfolioReleaseCountryIso3s } from "../../src/domain/portfolio-evidence";
import {
  getApprovedRealCertificationIds,
  getApprovedRealProductIds,
} from "../../src/server/config/public-product-publication";
import { buildFixtureLimits } from "../../src/server/db/seed/acceptance-fixtures";
import { buildFullIngestSelection } from "../db/fixture-target-selection";

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
    caseCount: z.number().int().positive(),
    reportVersion: z.string().min(1),
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

const scoreSchema = z.object({
  argsAccuracyPct: z.number().finite(),
  evidenceExpectationAccuracyPct: z.number().finite(),
  safetyFailClosedPct: z.number().finite(),
  toolSelectionAccuracyPct: z.number().finite(),
});

const liveEvalResultSchema = z.object({
  argsPassed: z.boolean(),
  errorCode: z.string().min(1).nullable(),
  evidenceAllowed: z.boolean(),
  evidenceExpectationPassed: z.boolean(),
  evidenceResult: z.enum(["sufficient", "insufficient", "error"]),
  expectedEvidenceAllowed: z.boolean(),
  id: z.string().min(1),
  latencyMs: z.number().int().nonnegative(),
  loopSteps: z.number().int().nonnegative(),
  mismatchReason: z.string().min(1).nullable(),
  normalizedArgs: z.array(z.object({
    args: z.record(z.string(), z.unknown()),
    tool: z.string().min(1),
  })),
  pass: z.boolean(),
  responseCharacterCount: z.number().int().nonnegative(),
  safetyCritical: z.boolean(),
  safetyPassed: z.boolean().nullable(),
  tokenUsage: z.object({
    input: z.number().int().nonnegative().nullable(),
    output: z.number().int().nonnegative().nullable(),
    total: z.number().int().nonnegative().nullable(),
  }),
  toolBearingSteps: z.number().int().nonnegative(),
  toolSelectionPassed: z.boolean(),
  toolSequence: z.array(z.string().min(1)),
}).passthrough();

const liveEvalReportSchema = z.object({
  budget: z.object({
    caseCount: z.number().int().nonnegative(),
    caseTimeoutMs: z.number().int().positive(),
    caseTokenReserve: z.number().int().positive(),
    maxCases: z.number().int().positive(),
    maxLoopStepsPerCase: z.number().int().positive(),
    maxTokens: z.number().int().positive(),
    modelStepCount: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  }).passthrough(),
  complete: z.boolean(),
  evaluatedAt: z.string().datetime(),
  modelId: z.string().min(1).nullable(),
  results: z.array(liveEvalResultSchema),
  runError: z
    .object({
      code: z.literal("INITIALIZATION_ERROR"),
      errorName: z.string().regex(/^[A-Za-z][A-Za-z0-9._-]{0,63}$/),
      stage: z.enum([
        "module_import",
        "database",
        "model_configuration",
      ]),
    })
    .strict()
    .nullable()
    .optional()
    .default(null),
  sampleCount: z.number().int().nonnegative(),
  scores: scoreSchema,
  thresholds: scoreSchema,
  thresholdsPassed: z.boolean(),
  version: z.string().min(1),
}).passthrough();

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
  assertEqual(report.version, SALES_CHAT_LIVE_EVAL_VERSION, "Live eval case/report version");
  assertEqual(report.runError, null, "Live eval run-level error");
  assertEqual(report.version, snapshot.liveEval.reportVersion, "STATUS live eval version");
  assertEqual(report.results.length, snapshot.liveEval.caseCount, "Live eval case count");
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
  if (report.budget.totalTokens > report.budget.maxTokens) {
    throw new Error(
      `Live eval token budget exceeded. Maximum ${report.budget.maxTokens}, received ${report.budget.totalTokens}.`,
    );
  }

  const expectedById = new Map<string, (typeof salesChatLiveCases)[number]>(
    salesChatLiveCases.map((testCase) => [testCase.id, testCase]),
  );
  assertEqual(
    expectedById.size,
    salesChatLiveCases.length,
    "Unique live eval case-definition IDs",
  );
  assertEqual(new Set(report.results.map(({ id }) => id)).size, report.results.length, "Unique live eval IDs");
  for (const result of report.results) {
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
      safetyCritical: result.safetyCritical,
      toolSelectionPassed: result.toolSelectionPassed,
    });
    assertEqual(result.evidenceExpectationPassed, judgement.evidenceExpectationPassed, `${result.id} evidence judgement`);
    assertEqual(result.safetyPassed, judgement.safetyPassed, `${result.id} safety judgement`);
    assertEqual(result.pass, judgement.pass, `${result.id} pass judgement`);
    assertEqual(result.mismatchReason, judgement.mismatchReason, `${result.id} mismatch reason`);
  }
  assertEqual(expectedById.size, report.results.length, "Live eval complete case set");

  const recomputedScores = scoreLiveEval(report.results);
  assertEqual(report.scores, recomputedScores, "Live eval scores");
  assertEqual(report.thresholds, LIVE_EVAL_THRESHOLDS, "Live eval thresholds");
  const complete = report.results.length === salesChatLiveCases.length;
  assertEqual(report.complete, complete, "Live eval completeness");
  assertEqual(
    report.thresholdsPassed,
    liveEvalThresholdsPassed({
      complete,
      maxTokens: report.budget.maxTokens,
      scores: recomputedScores,
      totalTokens: report.budget.totalTokens,
    }),
    "Live eval threshold result",
  );
  assertEqual(
    report.budget.modelStepCount,
    report.results.reduce((total, result) => total + result.loopSteps, 0),
    "Live eval model step total",
  );
  assertEqual(
    report.budget.totalTokens,
    report.results.reduce((total, result) => total + (result.tokenUsage.total ?? 0), 0),
    "Live eval token total",
  );

  process.stdout.write(
    `Portfolio evidence verified: public runtime ${snapshot.publicRuntime.version} matches the recorded repository head; ` +
      `last fully documented release ${snapshot.lastDocumentedRelease.id}/${snapshot.lastDocumentedRelease.commit}; ` +
      `${vitest.files} Vitest files / ${vitest.tests} tests; ` +
      `${evidenceSummary.jurisdictions} jurisdictions / ${evidenceSummary.regulations} regulations / ` +
      `${evidenceSummary.limits} limits / ${evidenceSummary.sources} sources; ` +
      `${report.results.length} live eval cases (${report.thresholdsPassed ? "thresholds passed" : "honest failure recorded"}).\n`,
  );
}

void verify().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Portfolio verification failed."}\n`,
  );
  process.exitCode = 1;
});
