import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
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
  LIVE_EVAL_MAX_OUTPUT_TOKENS_PER_CALL,
  LIVE_EVAL_MAX_RETRIES_PER_MODEL_CALL,
  LIVE_EVAL_MAX_TOKENS,
  LIVE_EVAL_TOKEN_BUDGET_ENFORCEMENT,
  LIVE_EVAL_THRESHOLDS,
  judgeLiveEvalCase,
  liveEvalAttemptBudgetPassed,
  liveEvalOutputTokenLimitPassed,
  liveEvalResponseContractAnchorIds,
  liveEvalResponseDispositionPassed,
  liveEvalThresholdsPassed,
  recomputeLiveEvalCaseTokenUsage,
  resolveLiveEvalStopReason,
  resolveLiveEvalTerminationReason,
  scoreLiveEval,
} from "../../src/domain/ai/live-eval";
import {
  buildLiveEvalCaseObservability,
  summarizeLiveEvalObservability,
} from "../../src/domain/ai/live-eval-observability";
import {
  MAX_AI_TOOL_STEPS,
  SALES_CHAT_SYSTEM_PROMPT_VERSION,
} from "../../src/features/ai/constants";
import {
  captureLiveEvalSourceFingerprint,
  captureLiveEvalSourceFingerprintAtRevision,
  formatLiveEvalArchiveFilename,
  parseCanonicalLiveEvalJson,
  verifyLiveEvalArchiveMatchesLatest,
} from "../ai/live-eval-report";
import {
  liveEvalQueryObservationMatchesContract,
  matchesExpectedLiveEvalReportArgs,
} from "../ai/live-eval-report-args";
import { deriveLiveEvalReportState } from "./live-eval-report-state";
import {
  liveEvalProviderProfileSchema,
  liveEvalReportSchema,
} from "./live-eval-report-schema";
import { recomputeLiveEvalTokenLedger } from "./live-eval-token-ledger";
import { assertNoConcreteCurrentLiveEvalClaims } from "./status-snapshot";
import {
  runTrustedGit,
  runTrustedGitBinaryResult,
  runTrustedGitTextResult,
} from "./trusted-git";
import {
  assertVerificationEqual,
  VerificationIssues,
} from "./verification-issues";

type LiveEvalProviderProfile = z.infer<
  typeof liveEvalProviderProfileSchema
>;

export function assertLiveEvalToolBearingStepInvariant(input: {
  errorCode?: string | null;
  id: string;
  loopSteps: number;
  toolBearingSteps: number;
  toolSequence: readonly unknown[];
  toolTraceStatus?: "complete" | "unavailable";
}): void {
  if (input.toolBearingSteps > input.loopSteps) {
    throw new Error(
      `${input.id} recorded ${input.toolBearingSteps} tool-bearing steps across only ${input.loopSteps} loop steps.`,
    );
  }
  if (input.toolTraceStatus === "unavailable") {
    if (input.errorCode !== "EVAL_CASE_ERROR" || input.toolSequence.length !== 0) {
      throw new Error(`${input.id} recorded an invalid unavailable tool trace.`);
    }
    // The v20 result schema independently enforces the full unscored error
    // sentinel. Anonymous completed-step telemetry does not identify tools.
    return;
  }
  if (input.toolSequence.length === 0 && input.toolBearingSteps !== 0) {
    throw new Error(
      `${input.id} recorded tool-bearing steps without any tool calls.`,
    );
  }
  if (input.toolSequence.length > 0 && input.toolBearingSteps === 0) {
    throw new Error(
      `${input.id} recorded tool calls without a tool-bearing step.`,
    );
  }
}

const modernLiveEvalArchiveFilenamePattern =
  /^ai-live-eval-\d{8}T\d{9}Z-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/iu;
const frozenModernV2ArchiveDigests: ReadonlyMap<string, string> = new Map([
  [
    "ai-live-eval-20260829T201950744Z-2aeb8159-8ece-4015-a396-95e9bbf537fe.json",
    "7b4921b57aea9a71505cd8247b07a55d2fea12e552b2e9db5592689a87153c6a",
  ],
  [
    "ai-live-eval-20260829T203611468Z-53fe862b-58c4-430d-9d0f-571f1beae457.json",
    "4c9cb1d0dec964d302562fb288943a165ef244ece25f2110247f4722dbbb9baa",
  ],
]);

const liveEvalReadmeSnapshotSchema = z.object({
  archivePath: z.string().regex(
    /^archive\/ai-live-eval-\d{8}T\d{9}Z-[0-9a-f-]{36}\.json$/u,
  ),
  attemptCount: z.number().int().nonnegative(),
  complete: z.boolean(),
  completedCount: z.number().int().nonnegative(),
  evaluatedAt: z.iso.datetime({ offset: true }),
  latestOutcome: z.enum(["failed", "passed"]),
  modelStepCount: z.number().int().nonnegative(),
  runId: z.string().uuid(),
  runError: z.object({
    code: z.literal("INITIALIZATION_ERROR"),
    errorName: z.string().min(1),
    stage: z.string().min(1),
  }).strict().nullable(),
  sampleCount: z.number().int().nonnegative(),
  sourceFingerprint: z.object({
    algorithm: z.literal("sha256"),
    digest: z.string().regex(/^[0-9a-f]{64}$/u),
    fileCount: z.number().int().positive(),
    status: z.literal("captured"),
  }).strict(),
  suiteCaseCount: z.number().int().positive(),
  terminationReason: z.string().min(1),
  thresholdsPassed: z.boolean(),
  tokenUsageComplete: z.boolean(),
  totalTokens: z.number().int().nonnegative(),
  version: z.string().min(1),
}).strict();

const liveEvalReadmeSnapshotStart = "<!-- live-eval-current:start -->";
const liveEvalReadmeSnapshotEnd = "<!-- live-eval-current:end -->";
const liveEvalReadmeProseStart = "<!-- live-eval-current-prose:start -->";
const liveEvalReadmeProseEnd = "<!-- live-eval-current-prose:end -->";

type LiveEvalReadmeSnapshot = z.infer<typeof liveEvalReadmeSnapshotSchema>;

function liveEvalReadmeSnapshotFromReport(
  report: z.infer<typeof liveEvalReportSchema>,
): LiveEvalReadmeSnapshot {
  if (
    !("attemptCount" in report.budget) ||
    !("completedCount" in report.budget)
  ) {
    throw new Error(
      "Latest live eval report predates provider-call accounting.",
    );
  }
  const fingerprint = report.provenance.sourceFingerprint;
  if (fingerprint.status !== "captured") {
    throw new Error("Latest live eval report has no captured source fingerprint.");
  }
  return {
    archivePath: `archive/${formatLiveEvalArchiveFilename(
      report.evaluatedAt,
      report.runId,
    )}`,
    attemptCount: report.budget.attemptCount,
    complete: report.complete,
    completedCount: report.budget.completedCount,
    evaluatedAt: report.evaluatedAt,
    latestOutcome: report.thresholdsPassed ? "passed" : "failed",
    modelStepCount: report.budget.modelStepCount,
    runId: report.runId,
    runError: report.runError,
    sampleCount: report.sampleCount,
    sourceFingerprint: fingerprint,
    suiteCaseCount: report.budget.maxCases,
    terminationReason: report.terminationReason,
    thresholdsPassed: report.thresholdsPassed,
    tokenUsageComplete: report.budget.tokenUsageComplete,
    totalTokens: report.budget.totalTokens,
    version: report.version,
  };
}

export function formatLiveEvalReadmeCurrentProse(
  snapshot: LiveEvalReadmeSnapshot,
): string {
  const runError = snapshot.runError === null
    ? "none"
    : `${snapshot.runError.stage}/${snapshot.runError.code}/${snapshot.runError.errorName}`;
  return [
    `Current report result: \`${snapshot.latestOutcome}\`; evaluatedAt \`${snapshot.evaluatedAt}\`; run ID \`${snapshot.runId}\`; ` +
      `\`${snapshot.sampleCount}/${snapshot.suiteCaseCount} cases\`; \`complete=${snapshot.complete}\`; ` +
      `\`terminationReason=${snapshot.terminationReason}\`; \`${snapshot.attemptCount} provider attempts\`; ` +
      `\`${snapshot.completedCount} completed provider calls\`; \`${snapshot.modelStepCount} model steps\`; ` +
      `\`${snapshot.totalTokens} known tokens\`; \`tokenUsageComplete=${snapshot.tokenUsageComplete}\`; ` +
      `\`thresholdsPassed=${snapshot.thresholdsPassed}\`; \`runError=${runError}\`.`,
    `Current report provenance: archive \`${snapshot.archivePath}\`; source fingerprint ` +
      `\`${snapshot.sourceFingerprint.digest}\` across \`${snapshot.sourceFingerprint.fileCount}\` files.`,
  ].join("\n");
}

function assertLiveEvalReadmeCurrentProse(
  readmeText: string,
  snapshot: LiveEvalReadmeSnapshot,
): void {
  const startCount = readmeText.split(liveEvalReadmeProseStart).length - 1;
  const endCount = readmeText.split(liveEvalReadmeProseEnd).length - 1;
  if (startCount !== 1 || endCount !== 1) {
    throw new Error("Live eval README must contain one current-result prose ledger.");
  }
  const start = readmeText.indexOf(liveEvalReadmeProseStart);
  const end = readmeText.indexOf(liveEvalReadmeProseEnd);
  if (end <= start) {
    throw new Error("Live eval README current-result prose ledger is malformed.");
  }
  const actual = readmeText.slice(
    start + liveEvalReadmeProseStart.length,
    end,
  );
  const expected = `\n${formatLiveEvalReadmeCurrentProse(snapshot)}\n`;
  if (actual !== expected) {
    throw new Error("Live eval README current-result prose ledger drifted.");
  }
  const withoutProseLedger = `${readmeText.slice(0, start)}${readmeText.slice(
    end + liveEvalReadmeProseEnd.length,
  )}`;
  const snapshotStart = withoutProseLedger.indexOf(liveEvalReadmeSnapshotStart);
  const snapshotEnd = withoutProseLedger.indexOf(liveEvalReadmeSnapshotEnd);
  if (snapshotStart < 0 || snapshotEnd <= snapshotStart) {
    throw new Error("Live eval README current-report snapshot is malformed.");
  }
  const proseOutsideLedgers = `${withoutProseLedger.slice(0, snapshotStart)}${withoutProseLedger.slice(
    snapshotEnd + liveEvalReadmeSnapshotEnd.length,
  )}`;
  assertNoConcreteCurrentLiveEvalClaims({
    documentLabel: "Live eval README",
    implicitEvalContext: true,
    markdown: proseOutsideLedgers,
  });
}

function parseLiveEvalReadmeSnapshot(readmeText: string): z.infer<
  typeof liveEvalReadmeSnapshotSchema
> {
  const startCount = readmeText.split(liveEvalReadmeSnapshotStart).length - 1;
  const endCount = readmeText.split(liveEvalReadmeSnapshotEnd).length - 1;
  if (startCount !== 1 || endCount !== 1) {
    throw new Error("Live eval README must contain one current-report snapshot.");
  }
  const start = readmeText.indexOf(liveEvalReadmeSnapshotStart);
  const end = readmeText.indexOf(liveEvalReadmeSnapshotEnd);
  if (end <= start) {
    throw new Error("Live eval README current-report snapshot is malformed.");
  }
  const fenced = readmeText.slice(
    start + liveEvalReadmeSnapshotStart.length,
    end,
  );
  const match = /^\n```json\n([\s\S]+)```\n$/u.exec(fenced);
  const jsonText = match?.[1];
  if (jsonText === undefined) {
    throw new Error("Live eval README current-report snapshot is malformed.");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(jsonText) as unknown;
  } catch {
    throw new Error("Live eval README current-report snapshot is invalid JSON.");
  }
  if (jsonText !== `${JSON.stringify(decoded, null, 2)}\n`) {
    throw new Error("Live eval README current-report snapshot is not canonical JSON.");
  }
  return liveEvalReadmeSnapshotSchema.parse(decoded);
}

export function assertLiveEvalReadmeCurrentReport(input: {
  readmeText: string;
  reportText: string;
}): void {
  const report = liveEvalReportSchema.parse(
    parseCanonicalLiveEvalJson(input.reportText, "Latest live eval report"),
  );
  const expectedSnapshot = liveEvalReadmeSnapshotFromReport(report);
  const snapshot = parseLiveEvalReadmeSnapshot(input.readmeText);
  assertVerificationEqual(
    snapshot,
    expectedSnapshot,
    "Live eval README current-report snapshot",
  );
  assertLiveEvalReadmeCurrentProse(input.readmeText, expectedSnapshot);
}

type LiveEvalEvidenceSnapshotBase = {
  expectedModelId: string;
  expectedProviderProfile: LiveEvalProviderProfile;
  latestOutcome: "failed" | "passed";
  latestSampleCount: number;
  reportVersion: string;
  suiteVersion: string;
  suiteCaseCount: number;
};

type LiveEvalEvidenceReportLedger = {
  archivePath: string;
  attemptCount: number;
  complete: boolean;
  completedCount: number;
  evaluatedAt: string;
  modelStepCount: number;
  runError: {
    code: "INITIALIZATION_ERROR";
    errorName: string;
    stage: string;
  } | null;
  runId: string;
  sourceFingerprint: {
    algorithm: "sha256";
    digest: string;
    fileCount: number;
    status: "captured";
  };
  terminationReason: string;
  thresholdsPassed: boolean;
  tokenUsageComplete: boolean;
  totalTokens: number;
};

export type LiveEvalEvidenceSnapshot =
  | LiveEvalEvidenceSnapshotBase
  | (LiveEvalEvidenceSnapshotBase & LiveEvalEvidenceReportLedger);

export type VerifiedLiveEvalEvidence = {
  sampleCount: number;
  suiteCaseCount: number;
  thresholdsPassed: boolean;
};

export type LiveEvalPassCandidateExpectations = Pick<
  LiveEvalEvidenceSnapshot,
  | "expectedModelId"
  | "expectedProviderProfile"
  | "suiteVersion"
  | "suiteCaseCount"
>;

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  assertVerificationEqual(actual, expected, label);
}

function sameTools(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return JSON.stringify([...actual].sort()) ===
    JSON.stringify([...expected].sort());
}

async function verifyVersionedModernLiveEvalArchives(
  workspace: string,
): Promise<void> {
  const archiveDirectory = resolve(workspace, "docs/evals/archive");
  for (const filename of await readdir(archiveDirectory)) {
    if (!modernLiveEvalArchiveFilenamePattern.test(filename)) {
      continue;
    }
    const reportText = await readFile(resolve(archiveDirectory, filename), "utf8");
    const frozenDigest = frozenModernV2ArchiveDigests.get(filename);
    if (frozenDigest !== undefined) {
      const actualDigest = createHash("sha256").update(reportText).digest("hex");
      if (actualDigest !== frozenDigest) {
        throw new Error(
          `Frozen modern v2 live eval archive drifted: ${filename}.`,
        );
      }
      continue;
    }
    const parsedReport = parseCanonicalLiveEvalJson(
      reportText,
      `Modern live eval archive ${filename}`,
    );
    try {
      liveEvalReportSchema.parse(parsedReport);
    } catch {
      throw new Error(
        `Modern live eval archive failed versioned schema validation: ${filename}.`,
      );
    }
  }
}

/**
 * Verifies the current live-eval artifact from its persisted case rows. The
 * workspace is explicit so tests can exercise the same Git, source-fingerprint,
 * archive, schema, ledger, scoring, and threshold path without a provider call.
 */
type LiveEvalVerificationInput =
  | {
      releaseHeadCommit?: string;
      reportText: string;
      snapshot: LiveEvalEvidenceSnapshot;
      workspace: string;
    }
  | {
      candidateExpectations?: LiveEvalPassCandidateExpectations;
      report: unknown;
    };

async function verifyLiveEvalReport(
  input: LiveEvalVerificationInput,
): Promise<VerifiedLiveEvalEvidence> {
  const snapshot = "snapshot" in input ? input.snapshot : null;
  const candidateExpectations = "candidateExpectations" in input
    ? input.candidateExpectations ?? null
    : null;
  const report = liveEvalReportSchema.parse(
    "reportText" in input
      ? parseCanonicalLiveEvalJson(input.reportText, "Latest live eval report")
      : input.report,
  );
  if ("reportText" in input) {
    const { reportText, workspace } = input;
    const liveEvalPreflight = new VerificationIssues();
    liveEvalPreflight.equal(
      report.provenance.promptVersion,
      SALES_CHAT_SYSTEM_PROMPT_VERSION,
      "Live eval prompt version",
    );
    liveEvalPreflight.equal(
      report.version,
      input.snapshot.reportVersion,
      "STATUS live eval report version",
    );
    liveEvalPreflight.equal(
      SALES_CHAT_LIVE_EVAL_VERSION,
      input.snapshot.suiteVersion,
      "STATUS live eval suite version",
    );
    liveEvalPreflight.equal(
      report.version,
      SALES_CHAT_LIVE_EVAL_VERSION,
      "Live eval case/report version",
    );
    liveEvalPreflight.equal(
      salesChatLiveCases.length,
      input.snapshot.suiteCaseCount,
      "Live eval suite case count",
    );
    liveEvalPreflight.equal(
      report.results.length,
      input.snapshot.latestSampleCount,
      "Latest live eval sample count",
    );
    liveEvalPreflight.equal(
      report.sampleCount,
      report.results.length,
      "Live eval sample count",
    );
    liveEvalPreflight.equal(
      report.budget.caseCount,
      report.results.length,
      "Live eval budget case count",
    );
    if (
      "archivePath" in input.snapshot &&
      "attemptCount" in report.budget &&
      "completedCount" in report.budget
    ) {
      liveEvalPreflight.equal(
        {
          archivePath: input.snapshot.archivePath,
          attemptCount: input.snapshot.attemptCount,
          complete: input.snapshot.complete,
          completedCount: input.snapshot.completedCount,
          evaluatedAt: input.snapshot.evaluatedAt,
          modelStepCount: input.snapshot.modelStepCount,
          runError: input.snapshot.runError,
          runId: input.snapshot.runId,
          sourceFingerprint: input.snapshot.sourceFingerprint,
          terminationReason: input.snapshot.terminationReason,
          thresholdsPassed: input.snapshot.thresholdsPassed,
          tokenUsageComplete: input.snapshot.tokenUsageComplete,
          totalTokens: input.snapshot.totalTokens,
        },
        {
          archivePath: `docs/evals/archive/${formatLiveEvalArchiveFilename(
            report.evaluatedAt,
            report.runId,
          )}`,
          attemptCount: report.budget.attemptCount,
          complete: report.complete,
          completedCount: report.budget.completedCount,
          evaluatedAt: report.evaluatedAt,
          modelStepCount: report.budget.modelStepCount,
          runError: report.runError,
          runId: report.runId,
          sourceFingerprint: report.provenance.sourceFingerprint,
          terminationReason: report.terminationReason,
          thresholdsPassed: report.thresholdsPassed,
          tokenUsageComplete: report.budget.tokenUsageComplete,
          totalTokens: report.budget.totalTokens,
        },
        "STATUS live eval report ledger",
      );
    } else if ("archivePath" in input.snapshot) {
      liveEvalPreflight.add(
        "STATUS live eval report ledger requires provider-call accounting.",
      );
    }

    const recordedSourceFingerprint = report.provenance.sourceFingerprint;
    if (recordedSourceFingerprint.status !== "captured") {
      liveEvalPreflight.add(
        "The checked-in live eval report does not contain a stable evaluated-source fingerprint.",
      );
    }
    const currentSourceFingerprint = await captureLiveEvalSourceFingerprint(
      workspace,
      runTrustedGitTextResult,
    );
    if (currentSourceFingerprint.status !== "captured") {
      liveEvalPreflight.add(
        "The current worktree source fingerprint could not be captured.",
      );
    }
    if (
      recordedSourceFingerprint.status === "captured" &&
      currentSourceFingerprint.status === "captured"
    ) {
      liveEvalPreflight.equal(
        currentSourceFingerprint,
        recordedSourceFingerprint,
        "Live eval evaluated-source fingerprint",
      );
    }

    const reportRepository = report.provenance.repository;
    if (reportRepository.worktreeState === "unavailable") {
      liveEvalPreflight.add(
        "The checked-in live eval report does not contain resolvable repository provenance.",
      );
    } else {
      try {
        runTrustedGit(workspace, [
          "cat-file",
          "-e",
          `${reportRepository.baseHeadCommit}^{commit}`,
        ]);
      } catch (error: unknown) {
        liveEvalPreflight.add(
          error instanceof Error
            ? error.message
            : "Live eval repository provenance could not be resolved.",
        );
      }
    }
    if (reportRepository.worktreeState === "clean") {
      liveEvalPreflight.equal(
        reportRepository.evaluatedCommit,
        reportRepository.baseHeadCommit,
        "Clean live eval repository provenance",
      );
      const commitSourceFingerprint =
        await captureLiveEvalSourceFingerprintAtRevision(
          workspace,
          reportRepository.evaluatedCommit,
          runTrustedGitTextResult,
          runTrustedGitBinaryResult,
        );
      if (commitSourceFingerprint.status !== "captured") {
        liveEvalPreflight.add(
          "The clean live eval commit fingerprint could not be reconstructed from Git objects.",
        );
      } else if (recordedSourceFingerprint.status === "captured") {
        liveEvalPreflight.equal(
          commitSourceFingerprint,
          recordedSourceFingerprint,
          "Clean live eval commit/source fingerprint",
        );
      }
    } else if (reportRepository.worktreeState === "dirty") {
      liveEvalPreflight.equal(
        reportRepository.evaluatedCommit,
        null,
        "Dirty live eval exact commit",
      );
    }
    if (input.releaseHeadCommit !== undefined) {
      if (!/^[0-9a-f]{40}$/u.test(input.releaseHeadCommit)) {
        liveEvalPreflight.add(
          "Release-grade live eval verification requires a full SHA-1 release HEAD.",
        );
      } else if (reportRepository.worktreeState !== "unavailable") {
        try {
          runTrustedGit(workspace, [
            "merge-base",
            "--is-ancestor",
            reportRepository.baseHeadCommit,
            input.releaseHeadCommit,
          ]);
        } catch {
          liveEvalPreflight.add(
            "The live eval base commit is not an ancestor of the release HEAD.",
          );
        }
        if (report.thresholdsPassed && reportRepository.worktreeState !== "clean") {
          liveEvalPreflight.add(
            "A passing release-grade live eval report must have clean exact-commit provenance.",
          );
        }
      }
    }
    try {
      await verifyLiveEvalArchiveMatchesLatest(workspace, report, reportText);
      await verifyVersionedModernLiveEvalArchives(workspace);
    } catch (error: unknown) {
      liveEvalPreflight.add(
        error instanceof Error
          ? error.message
          : "The live eval archive could not be verified.",
      );
    }
    liveEvalPreflight.throwIfAny("Live eval preflight");
  }

  if (report.version !== SALES_CHAT_LIVE_EVAL_VERSION) {
    throw new Error(
      "Live eval preflight accepted an incompatible report version.",
    );
  }
  if (candidateExpectations !== null) {
    assertEqual(
      report.version,
      candidateExpectations.suiteVersion,
      "STATUS live eval suite version",
    );
    assertEqual(
      salesChatLiveCases.length,
      candidateExpectations.suiteCaseCount,
      "STATUS live eval suite case count",
    );
    if (report.runError === null) {
      assertEqual(
        report.modelId,
        candidateExpectations.expectedModelId,
        "STATUS live eval model ID",
      );
      assertEqual(
        report.provenance.providerProfile,
        candidateExpectations.expectedProviderProfile,
        "STATUS live eval provider profile",
      );
    }
    if (report.thresholdsPassed) {
      assertEqual(report.complete, true, "Passing candidate completeness");
      assertEqual(
        report.results.length,
        candidateExpectations.suiteCaseCount,
        "Passing candidate sample count",
      );
    }
  }

  assertEqual(
    report.provenance.promptVersion,
    SALES_CHAT_SYSTEM_PROMPT_VERSION,
    "Live eval prompt version",
  );
  assertEqual(
    report.sampleCount,
    report.results.length,
    "Live eval sample count",
  );
  assertEqual(
    report.budget.caseCount,
    report.results.length,
    "Live eval budget case count",
  );
  assertEqual(
    report.budget.maxCases,
    LIVE_EVAL_MAX_CASES,
    "Live eval maximum case budget",
  );
  assertEqual(
    salesChatLiveCases.length,
    LIVE_EVAL_MAX_CASES,
    "Live eval case-suite size",
  );
  assertEqual(
    report.budget.maxTokens,
    LIVE_EVAL_MAX_TOKENS,
    "Live eval token budget",
  );
  assertEqual(
    report.budget.caseTokenReserve,
    LIVE_EVAL_CASE_TOKEN_RESERVE,
    "Live eval per-case token reserve",
  );
  assertEqual(
    report.budget.maxRetriesPerModelCall,
    LIVE_EVAL_MAX_RETRIES_PER_MODEL_CALL,
    "Live eval per-model-call retry budget",
  );
  assertEqual(
    report.budget.maxOutputTokensPerCall,
    LIVE_EVAL_MAX_OUTPUT_TOKENS_PER_CALL,
    "Live eval per-model-call output-token budget",
  );
  assertEqual(
    report.budget.maxPotentialOutputTokens,
    report.budget.maxCases *
      report.budget.maxLoopStepsPerCase *
      report.budget.maxOutputTokensPerCall,
    "Live eval maximum potential output-token budget",
  );
  assertEqual(
    report.budget.tokenBudgetEnforcement,
    LIVE_EVAL_TOKEN_BUDGET_ENFORCEMENT,
    "Live eval token-budget enforcement",
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
    resultErrorCodes: report.results.map(({ errorCode }) => errorCode),
    resultIds: report.results.map(({ id }) => id),
    runError: report.runError,
    suiteIds: salesChatLiveCases.map(({ id }) => id),
  });
  assertEqual(report.complete, reportState.complete, "Live eval completeness");
  if (report.runError !== null) {
    assertEqual(report.modelId, null, "Initialization-failure model ID");
    assertEqual(
      report.provenance.providerProfile,
      null,
      "Initialization-failure provider profile",
    );
    assertEqual(
      report.budget.modelStepCount,
      0,
      "Initialization-failure model steps",
    );
  } else {
    assertEqual(
      report.provenance.sourceFingerprint.status,
      "captured",
      "Live eval source-fingerprint availability",
    );
    if (report.provenance.repository.worktreeState === "unavailable") {
      throw new Error(
        "Completed live eval report has unavailable repository provenance.",
      );
    }
    assertEqual(
      report.provenance.providerProfile?.adapter,
      "@ai-sdk/openai-compatible",
      "Live eval remote provider adapter",
    );
    assertEqual(
      report.provenance.providerProfile?.includeUsage,
      true,
      "Live eval streaming usage request",
    );
    if (snapshot !== null) {
      assertEqual(
        snapshot.expectedProviderProfile.adapter,
        "@ai-sdk/openai-compatible",
        "STATUS live eval remote provider adapter",
      );
      assertEqual(
        snapshot.expectedProviderProfile.includeUsage,
        true,
        "STATUS live eval streaming usage request",
      );
      assertEqual(
        report.modelId,
        snapshot.expectedModelId,
        "Live eval model ID",
      );
      assertEqual(
        report.provenance.providerProfile,
        snapshot.expectedProviderProfile,
        "Live eval provider profile",
      );
    }
  }

  const {
    caseUsages: recomputedTokenUsages,
    providerCalls,
    tokenBudget,
  } = recomputeLiveEvalTokenLedger(
    report.results.map(({
      attemptCount,
      completedCount,
      errorCode,
      loopSteps,
      tokenUsage,
    }) => ({
      attemptCount,
      completedCount,
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

  let prefixCaseCount = 0;
  let prefixTokenUsageComplete = true;
  let prefixTotalTokens = 0;
  for (const [resultIndex, tokenUsage] of recomputedTokenUsages.entries()) {
    const stopReason = resolveLiveEvalStopReason({
      caseCount: prefixCaseCount,
      maxCases: report.budget.maxCases,
      maxTokens: report.budget.maxTokens,
      caseTokenReserve: report.budget.caseTokenReserve,
      tokenUsageComplete: prefixTokenUsageComplete,
      totalTokens: prefixTotalTokens,
    });
    if (stopReason !== null) {
      throw new Error(
        `Live eval result ${resultIndex + 1} was recorded after the ${stopReason} stop condition.`,
      );
    }
    prefixCaseCount += 1;
    prefixTokenUsageComplete &&= tokenUsage.usageComplete;
    prefixTotalTokens += recomputeLiveEvalCaseTokenUsage({
      aggregate: tokenUsage,
      ledger: tokenUsage.ledger,
      loopSteps: tokenUsage.ledger.length,
      modelStreamCompleted: tokenUsage.usageComplete,
    }).knownTokens;
  }

  const outputTokenLimitPassed = liveEvalOutputTokenLimitPassed(
    recomputedTokenUsages,
    report.budget.maxOutputTokensPerCall,
  );

  const expectedTerminationReason = resolveLiveEvalTerminationReason({
    caseCount: report.results.length,
    caseTokenReserve: report.budget.caseTokenReserve,
    lastResultErrorCode: report.results.at(-1)?.errorCode,
    maxCases: report.budget.maxCases,
    maxTokens: report.budget.maxTokens,
    runError: report.runError !== null,
    suiteCaseCount: salesChatLiveCases.length,
    tokenUsageComplete: tokenBudget.tokenUsageComplete,
    totalTokens: tokenBudget.totalTokens,
  });
  if (expectedTerminationReason === null) {
    throw new Error("Partial live eval report has no valid termination reason.");
  }
  assertEqual(
    report.terminationReason,
    expectedTerminationReason,
    "Live eval termination reason",
  );

  const expectedById = new Map<
    string,
    (typeof salesChatLiveCases)[number]
  >(salesChatLiveCases.map((testCase) => [testCase.id, testCase]));
  assertEqual(
    expectedById.size,
    salesChatLiveCases.length,
    "Unique live eval case-definition IDs",
  );
  assertEqual(
    new Set(report.results.map(({ id }) => id)).size,
    report.results.length,
    "Unique live eval IDs",
  );

  for (const [resultIndex, result] of report.results.entries()) {
    const expected = expectedById.get(result.id);
    if (!expected) {
      throw new Error(`Live eval report contains unknown case ${result.id}.`);
    }
    assertEqual(result.locale, expected.locale, `${result.id} locale`);
    const expectedResponseAnchorIds = liveEvalResponseContractAnchorIds(
      expected.responseContract,
    );
    assertEqual(
      [...result.matchedResponseAnchorIds, ...result.missingResponseAnchorIds]
        .toSorted(),
      expectedResponseAnchorIds.toSorted(),
      `${result.id} response anchor coverage`,
    );
    const missingResponseAnchorIds = new Set(
      result.missingResponseAnchorIds,
    );
    assertEqual(
      result.matchedResponseAnchorIds,
      expectedResponseAnchorIds.filter(
        (anchorId) => !missingResponseAnchorIds.has(anchorId),
      ),
      `${result.id} matched response anchors`,
    );
    const matchedResponseAnchorIds = new Set(
      result.matchedResponseAnchorIds,
    );
    assertEqual(
      result.missingResponseAnchorIds,
      expectedResponseAnchorIds.filter(
        (anchorId) => !matchedResponseAnchorIds.has(anchorId),
      ),
      `${result.id} missing response anchors`,
    );
    const responseGroundingPassed =
      result.missingResponseAnchorIds.length === 0;
    const responseLocalePassed =
      result.detectedResponseLocale === expected.locale;
    assertEqual(
      result.responseGroundingPassed,
      responseGroundingPassed,
      `${result.id} response grounding judgement`,
    );
    assertEqual(
      result.responseLocalePassed,
      responseLocalePassed,
      `${result.id} response locale judgement`,
    );
    assertEqual(
      result.expectedEvidenceAllowed,
      expected.expectedEvidenceAllowed,
      `${result.id} evidence expectation`,
    );
    assertEqual(
      result.safetyCritical,
      expected.safetyCritical,
      `${result.id} safety classification`,
    );
    assertEqual(
      result.normalizedArgs.map(({ tool }) => tool),
      result.toolSequence,
      `${result.id} tool sequence/argument rows`,
    );
    const queryContract = expected.knowledgeQueryContract ?? {
      forbidden: [],
      required: [],
    };
    for (const call of result.normalizedArgs) {
      if (
        call.tool === "searchKnowledgeBase" &&
        Object.keys(call.args).length > 0
      ) {
        assertEqual(
          liveEvalQueryObservationMatchesContract(
            call.args.query,
            queryContract,
          ),
          true,
          `${result.id} knowledge-query contract observation`,
        );
      }
    }
    const toolSelectionPassed = result.toolTraceStatus === "unavailable" ? false : sameTools(
      result.toolSequence,
      expected.expectedTools,
    );
    assertEqual(
      result.toolSelectionPassed,
      toolSelectionPassed,
      `${result.id} tool-selection judgement`,
    );
    const argsPassed = result.toolTraceStatus === "unavailable" ? false : Object.entries(expected.expectedArgs).every(
      ([toolName, expectedArgs]) => {
        const call = result.normalizedArgs.find(
          (candidate) => candidate.tool === toolName,
        );
        return call !== undefined &&
          expectedArgs !== undefined &&
          matchesExpectedLiveEvalReportArgs({
            actual: call.args,
            expected: expectedArgs,
            runtimeContext: result.runtimeContext,
            knowledgeQueryContract: expected.knowledgeQueryContract,
            tool: call.tool,
          });
      },
    );
    assertEqual(result.argsPassed, argsPassed, `${result.id} argument judgement`);
    if (result.loopSteps > report.budget.maxLoopStepsPerCase) {
      throw new Error(
        `${result.id} exceeded the live eval loop-step budget. Maximum ${report.budget.maxLoopStepsPerCase}, received ${result.loopSteps}.`,
      );
    }
    if (!liveEvalAttemptBudgetPassed(result)) {
      throw new Error(
        `${result.id} exceeded the zero-retry live eval provider-attempt budget.`,
      );
    }
    assertLiveEvalToolBearingStepInvariant(result);
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
    const recomputedModelObservability = buildLiveEvalCaseObservability({
      attemptCount: result.attemptCount,
      completedCount: result.completedCount,
      expectedStepCount: result.loopSteps,
      modelStreamCompleted: result.errorCode !== "EVAL_CASE_ERROR",
      steps: result.modelObservability.steps,
    });
    assertEqual(
      result.modelObservability,
      recomputedModelObservability,
      `${result.id} model observability`,
    );
    const evidenceResult = result.errorCode !== null
      ? "error"
      : result.evidenceAllowed
        ? "sufficient"
        : "insufficient";
    assertEqual(
      result.evidenceResult,
      evidenceResult,
      `${result.id} evidence result`,
    );
    const judgement = judgeLiveEvalCase({
      argsPassed: result.argsPassed,
      errorCode: result.errorCode,
      evidenceAllowed: result.evidenceAllowed,
      expectedEvidenceAllowed: result.expectedEvidenceAllowed,
      responseDisposition: result.responseDisposition,
      responseGroundingPassed,
      responseLocalePassed,
      safetyCritical: result.safetyCritical,
      tokenUsageComplete:
        recomputedTokenUsages[resultIndex]?.usageComplete === true,
      toolSelectionPassed: result.toolSelectionPassed,
    });
    assertEqual(
      result.evidenceExpectationPassed,
      judgement.evidenceExpectationPassed,
      `${result.id} evidence judgement`,
    );
    assertEqual(
      result.responseDispositionPassed,
      liveEvalResponseDispositionPassed({
        completed: result.errorCode === null,
        expectedEvidenceAllowed: result.expectedEvidenceAllowed,
        responseDisposition: result.responseDisposition,
      }),
      `${result.id} response-disposition judgement`,
    );
    assertEqual(
      result.safetyPassed,
      judgement.safetyPassed,
      `${result.id} safety judgement`,
    );
    assertEqual(result.pass, judgement.pass, `${result.id} pass judgement`);
    assertEqual(
      result.mismatchReason,
      judgement.mismatchReason,
      `${result.id} mismatch reason`,
    );
  }

  const recomputedScores = scoreLiveEval(report.results);
  assertEqual(report.scores, recomputedScores, "Live eval scores");
  assertEqual(report.thresholds, LIVE_EVAL_THRESHOLDS, "Live eval thresholds");
  assertEqual(
    report.thresholdsPassed,
    liveEvalThresholdsPassed({
      allCasesPassed:
        report.results.every(({ pass }) => pass) && outputTokenLimitPassed,
      complete: reportState.complete,
      maxTokens: report.budget.maxTokens,
      scores: recomputedScores,
      terminationReason: expectedTerminationReason,
      tokenUsageComplete: tokenBudget.tokenUsageComplete,
      totalTokens: tokenBudget.totalTokens,
    }),
    "Live eval threshold result",
  );
  const latestOutcome = report.thresholdsPassed ? "passed" : "failed";
  if (snapshot !== null) {
    assertEqual(
      latestOutcome,
      snapshot.latestOutcome,
      "STATUS live eval outcome",
    );
  }
  assertEqual(
    report.budget.modelStepCount,
    report.results.reduce((total, result) => total + result.loopSteps, 0),
    "Live eval model step total",
  );
  assertEqual(
    report.budget.attemptCount,
    providerCalls.attemptCount,
    "Live eval provider-attempt total",
  );
  assertEqual(
    report.budget.completedCount,
    providerCalls.completedCount,
    "Live eval completed-provider-call total",
  );
  assertEqual(
    report.budget.totalTokens,
    tokenBudget.totalTokens,
    "Live eval token total",
  );
  assertEqual(
    report.observability,
    summarizeLiveEvalObservability(
      report.results.map(({ latencyMs, modelObservability }) => ({
        latencyMs,
        modelObservability,
      })),
    ),
    "Live eval observability summary",
  );

  return {
    sampleCount: report.results.length,
    suiteCaseCount: salesChatLiveCases.length,
    thresholdsPassed: report.thresholdsPassed,
  };
}

/**
 * Performs the current-suite schema, case, scorer, token-ledger, termination, and
 * observability checks without reading Git, STATUS, archives, or provider state.
 */
export function verifyLiveEvalReportConsistency(
  report: unknown,
): Promise<VerifiedLiveEvalEvidence> {
  return verifyLiveEvalReport({ report });
}

/**
 * Verifies a release-grade passing candidate against static STATUS
 * expectations. Outcome and sample count are deliberately not accepted as
 * expectations: they are fixed to passing and the configured suite size.
 */
export function verifyLiveEvalPassCandidate(input: {
  expectations: LiveEvalPassCandidateExpectations;
  report: unknown;
}): Promise<VerifiedLiveEvalEvidence> {
  return verifyLiveEvalReport({
    candidateExpectations: input.expectations,
    report: input.report,
  });
}

/**
 * Verifies the current persisted portfolio evidence, including its workspace,
 * STATUS, source-fingerprint, and archive bindings.
 */
export function verifyLiveEvalEvidence(input: {
  releaseHeadCommit?: string;
  reportText: string;
  snapshot: LiveEvalEvidenceSnapshot;
  workspace: string;
}): Promise<VerifiedLiveEvalEvidence> {
  return verifyLiveEvalReport(input);
}
