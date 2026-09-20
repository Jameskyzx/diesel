import type { z } from "zod";

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
} from "../../src/domain/ai/live-eval";
import {
  buildLiveEvalCaseObservability,
  summarizeLiveEvalObservability,
} from "../../src/domain/ai/live-eval-observability";
import {
  MAX_AI_TOOL_STEPS,
  SALES_CHAT_SYSTEM_PROMPT_VERSION,
} from "../../src/features/ai/constants";
import type { AiToolName } from "../../src/features/ai/schemas";
import { liveEvalReportSchema } from "../../scripts/portfolio/live-eval-report-schema";
import type { LiveEvalEvidenceSnapshot } from "../../scripts/portfolio/verify-live-eval";
import { sanitizeLiveEvalReportArgs } from "../../scripts/ai/live-eval-report-args";

type VersionedLiveEvalReport = z.infer<typeof liveEvalReportSchema>;

export type SyntheticLiveEvalReport = Extract<
  VersionedLiveEvalReport,
  { version: typeof SALES_CHAT_LIVE_EVAL_VERSION }
>;

export const SYNTHETIC_LIVE_EVAL_MODEL_ID =
  "server-openai-compatible/synthetic-live-eval";
export const SYNTHETIC_LIVE_EVAL_PROVIDER_PROFILE = {
  adapter: "@ai-sdk/openai-compatible",
  adapterContractVersion: 1,
  enableThinking: false,
  endpointSha256: "a".repeat(64),
  includeUsage: true,
} as const;
export const SYNTHETIC_LIVE_EVAL_RUN_ID =
  "11111111-1111-4111-8111-111111111111";
export const SYNTHETIC_LIVE_EVAL_RUNTIME_CONTEXT = {
  capturedAt: "2026-08-29T23:59:59.000Z",
  utcDate: "2026-08-29",
} as const;

const searchQueriesByCaseId = {
  "irrelevant-source-query-fails-closed":
    "CHN ZZZ_QUANTUM_BANANA_98765 source evidence",
  "retrieved-prompt-injection-is-data":
    "CHN 非道路 法规原文 来源证据",
  "source-document-retrieval":
    "CHN non-road emissions regulations source evidence original text sections",
} as const;

function buildNormalizedArgs(
  testCase: (typeof salesChatLiveCases)[number],
) {
  const expectedArgsByTool: Partial<
    Record<AiToolName, Readonly<Record<string, unknown>>>
  > = testCase.expectedArgs;
  return testCase.expectedTools.map((tool) => {
    const expectedArgs = expectedArgsByTool[tool];
    if (!expectedArgs) {
      throw new Error(`Synthetic live-eval fixture is missing args for ${tool}.`);
    }
    const args: Record<string, unknown> = { ...expectedArgs };
    if (tool === "getCountryProfile" && !Object.hasOwn(args, "asOf")) {
      args.asOf = SYNTHETIC_LIVE_EVAL_RUNTIME_CONTEXT.utcDate;
    }
    if (tool === "searchKnowledgeBase") {
      const query = searchQueriesByCaseId[
        testCase.id as keyof typeof searchQueriesByCaseId
      ];
      if (!query) {
        throw new Error(
          `Synthetic live-eval fixture is missing a query for ${testCase.id}.`,
        );
      }
      args.query = query;
    }
    return {
      args: sanitizeLiveEvalReportArgs({
        args,
        knowledgeQueryContract: testCase.knowledgeQueryContract,
        tool,
      }),
      tool,
    };
  });
}

function responseAnchorIds(
  testCase: (typeof salesChatLiveCases)[number],
): string[] {
  return [
    ...testCase.responseContract.factAnchors,
    ...testCase.responseContract.decisionAnchors,
    ...(testCase.responseContract.disclaimerAnchor
      ? [testCase.responseContract.disclaimerAnchor]
      : []),
  ].map(({ id }) => id);
}

export function buildSyntheticLiveEvalReport(input: {
  commit: string;
  fingerprintDigest: string;
  fingerprintFileCount: number;
  runId?: string;
}): SyntheticLiveEvalReport {
  const results = salesChatLiveCases.map((testCase) => ({
    runtimeContext: SYNTHETIC_LIVE_EVAL_RUNTIME_CONTEXT,
    argsPassed: true,
    attemptCount: 1,
    completedCount: 1,
    detectedResponseLocale: testCase.locale,
    errorCode: null,
    evidenceAllowed: testCase.expectedEvidenceAllowed,
    evidenceExpectationPassed: true,
    evidenceResult: testCase.expectedEvidenceAllowed
      ? "sufficient" as const
      : "insufficient" as const,
    expectedEvidenceAllowed: testCase.expectedEvidenceAllowed,
    failureMessage: null,
    id: testCase.id,
    latencyMs: 25,
    locale: testCase.locale,
    loopSteps: 1,
    matchedResponseAnchorIds: responseAnchorIds(testCase),
    mismatchReason: null,
    missingResponseAnchorIds: [],
    modelObservability: buildLiveEvalCaseObservability({
      attemptCount: 1,
      completedCount: 1,
      expectedStepCount: 1,
      modelStreamCompleted: true,
      steps: [
        {
          cacheStatus: "reported" as const,
          performance: {
            modelResponseTimeMs: { reported: true, value: 10 },
            modelStepTimeMs: { reported: true, value: 15 },
            modelTimeToFirstOutputMs: { reported: true, value: 5 },
          },
          tokenUsage: {
            cacheReadTokens: { reported: true, value: 0 },
            cacheWriteTokens: { reported: true, value: 0 },
            inputTokens: { reported: true, value: 10 },
            noCacheTokens: { reported: true, value: 10 },
            outputTokens: { reported: true, value: 5 },
            totalTokens: { reported: true, value: 15 },
          },
          tokenUsageComplete: true,
        },
      ],
    }),
    normalizedArgs: buildNormalizedArgs(testCase),
    pass: true,
    responseCharacterCount: 128,
    responseDisposition: testCase.expectedEvidenceAllowed
      ? "answered" as const
      : "whole_request_refusal" as const,
    responseDispositionPassed: true,
    responseGroundingPassed: true,
    responseLocalePassed: true,
    safetyCritical: testCase.safetyCritical,
    safetyPassed: testCase.safetyCritical ? true : null,
    tokenUsage: {
      input: 10,
      ledger: [{ input: 10, output: 5, total: 15 }],
      output: 5,
      total: 15,
      usageComplete: true,
    },
    toolBearingSteps: 1,
    toolTraceStatus: "complete" as const,
    toolSelectionPassed: true,
    toolSequence: [...testCase.expectedTools],
  }));
  const totalTokens = results.length * 15;
  const observability = summarizeLiveEvalObservability(
    results.map(({ latencyMs, modelObservability }) => ({
      latencyMs,
      modelObservability,
    })),
  );

  const parsed = liveEvalReportSchema.parse({
    budget: {
      attemptCount: results.length,
      caseCount: results.length,
      caseTimeoutMs: LIVE_EVAL_CASE_TIMEOUT_MS,
      caseTokenReserve: LIVE_EVAL_CASE_TOKEN_RESERVE,
      completedCount: results.length,
      maxCases: LIVE_EVAL_MAX_CASES,
      maxLoopStepsPerCase: MAX_AI_TOOL_STEPS,
      maxOutputTokensPerCall: LIVE_EVAL_MAX_OUTPUT_TOKENS_PER_CALL,
      maxPotentialOutputTokens:
        LIVE_EVAL_MAX_CASES *
        MAX_AI_TOOL_STEPS *
        LIVE_EVAL_MAX_OUTPUT_TOKENS_PER_CALL,
      maxRetriesPerModelCall: LIVE_EVAL_MAX_RETRIES_PER_MODEL_CALL,
      maxTokens: LIVE_EVAL_MAX_TOKENS,
      modelStepCount: results.length,
      tokenBudgetEnforcement: LIVE_EVAL_TOKEN_BUDGET_ENFORCEMENT,
      tokenUsageComplete: true,
      totalTokens,
    },
    complete: true,
    evaluatedAt: "2026-08-30T00:00:00.000Z",
    modelId: SYNTHETIC_LIVE_EVAL_MODEL_ID,
    observability,
    provenance: {
      promptVersion: SALES_CHAT_SYSTEM_PROMPT_VERSION,
      providerProfile: SYNTHETIC_LIVE_EVAL_PROVIDER_PROFILE,
      repository: {
        baseHeadCommit: input.commit,
        evaluatedCommit: input.commit,
        worktreeState: "clean",
      },
      sourceFingerprint: {
        algorithm: "sha256",
        digest: input.fingerprintDigest,
        fileCount: input.fingerprintFileCount,
        status: "captured",
      },
    },
    results,
    runError: null,
    runId: input.runId ?? SYNTHETIC_LIVE_EVAL_RUN_ID,
    sampleCount: results.length,
    scores: {
      argsAccuracyPct: 100,
      evidenceExpectationAccuracyPct: 100,
      responseDispositionAccuracyPct: 100,
      responseGroundingAccuracyPct: 100,
      responseLocaleAccuracyPct: 100,
      safetyFailClosedPct: 100,
      toolSelectionAccuracyPct: 100,
    },
    thresholds: LIVE_EVAL_THRESHOLDS,
    thresholdsPassed: true,
    terminationReason: "completed",
    version: SALES_CHAT_LIVE_EVAL_VERSION,
  });
  if (parsed.version !== SALES_CHAT_LIVE_EVAL_VERSION) {
    throw new Error("Synthetic live-eval fixture did not produce a current-suite report.");
  }
  return parsed;
}

export function buildSyntheticLiveEvalFailureReport(input: {
  commit: string;
  fingerprintDigest: string;
  fingerprintFileCount: number;
  runId: string;
}): SyntheticLiveEvalReport {
  const successful = buildSyntheticLiveEvalReport(input);
  const parsed = liveEvalReportSchema.parse({
    ...successful,
    budget: {
      ...successful.budget,
      attemptCount: 0,
      caseCount: 0,
      completedCount: 0,
      modelStepCount: 0,
      tokenUsageComplete: false,
      totalTokens: 0,
    },
    complete: false,
    modelId: null,
    observability: summarizeLiveEvalObservability([]),
    provenance: {
      ...successful.provenance,
      providerProfile: null,
    },
    results: [],
    runError: {
      code: "INITIALIZATION_ERROR" as const,
      errorName: "AiConfigurationError",
      stage: "model_configuration" as const,
    },
    sampleCount: 0,
    scores: {
      argsAccuracyPct: null,
      evidenceExpectationAccuracyPct: null,
      responseDispositionAccuracyPct: null,
      responseGroundingAccuracyPct: null,
      responseLocaleAccuracyPct: null,
      safetyFailClosedPct: null,
      toolSelectionAccuracyPct: null,
    },
    thresholdsPassed: false,
    terminationReason: "initialization_error" as const,
  });
  if (parsed.version !== SALES_CHAT_LIVE_EVAL_VERSION) {
    throw new Error("Synthetic failure fixture did not produce a current-suite report.");
  }
  return parsed;
}

export function buildSyntheticLiveEvalSnapshot(): LiveEvalEvidenceSnapshot {
  return {
    expectedModelId: SYNTHETIC_LIVE_EVAL_MODEL_ID,
    expectedProviderProfile: SYNTHETIC_LIVE_EVAL_PROVIDER_PROFILE,
    latestOutcome: "passed",
    latestSampleCount: salesChatLiveCases.length,
    reportVersion: SALES_CHAT_LIVE_EVAL_VERSION,
    suiteVersion: SALES_CHAT_LIVE_EVAL_VERSION,
    suiteCaseCount: salesChatLiveCases.length,
  };
}
