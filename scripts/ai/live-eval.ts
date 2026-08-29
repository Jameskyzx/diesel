import { randomUUID } from "node:crypto";

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
  resolveLiveEvalResponseDisposition,
  resolveLiveEvalStopReason,
  scoreLiveEval,
  summarizeLiveEvalTokenBudget,
  type LiveEvalTerminationReason,
  type LiveEvalResponseDisposition,
  type LiveEvalTokenUsage,
} from "../../src/domain/ai/live-eval";
import {
  MAX_AI_TOOL_STEPS,
  SALES_CHAT_SYSTEM_PROMPT_VERSION,
} from "../../src/features/ai/constants";
import type { SalesChatStepObservation } from "../../src/server/ai/sales-chat";
import { buildLiveEvalCaseTokenUsage } from "./live-eval-token-usage";
import { runWithLiveEvalCaseDeadline } from "./live-eval-deadline";
import {
  safeLiveEvalErrorName,
  summarizeLiveEvalError,
} from "./live-eval-error";
import {
  captureLiveEvalRepositoryState,
  captureLiveEvalSourceFingerprint,
  persistLiveEvalReport,
  reconcileLiveEvalRepositoryStates,
  reconcileLiveEvalSourceFingerprints,
  resolveLiveEvalLatestReportPath,
  type LiveEvalRepositoryState,
  type LiveEvalSourceFingerprint,
} from "./live-eval-report";

process.env.DATABASE_MODE = "pglite-demo";
process.env.PORTFOLIO_DEMO_MODE = "false";
process.env.AI_CHAT_RATE_LIMIT_BACKEND = "memory";
if (!process.env.NODE_ENV) {
  Reflect.set(process.env, "NODE_ENV", "development");
}

const workspace = process.cwd();
const reportPath = resolveLiveEvalLatestReportPath(workspace);
type LiveEvalInitializationStage =
  | "module_import"
  | "database"
  | "model_configuration";

type LiveEvalRunError = {
  code: "INITIALIZATION_ERROR";
  errorName: string;
  stage: LiveEvalInitializationStage;
};

type LiveEvalResult = {
  argsPassed: boolean;
  errorCode: string | null;
  evidenceAllowed: boolean;
  evidenceExpectationPassed: boolean;
  evidenceResult: "sufficient" | "insufficient" | "error";
  expectedEvidenceAllowed: boolean;
  failureMessage: string | null;
  id: string;
  latencyMs: number;
  loopSteps: number;
  mismatchReason: string | null;
  normalizedArgs: Array<{ args: Record<string, unknown>; tool: string }>;
  pass: boolean;
  responseCharacterCount: number;
  responseDisposition: LiveEvalResponseDisposition;
  responseDispositionPassed: boolean;
  safetyCritical: boolean;
  safetyPassed: boolean | null;
  tokenUsage: LiveEvalTokenUsage;
  toolBearingSteps: number;
  toolSelectionPassed: boolean;
  toolSequence: string[];
};
const allowedReportArgKeys = new Set([
  "applicationScope",
  "asOf",
  "countryIso3",
  "countryIso3s",
  "jurisdictionId",
  "limit",
  "metricCodes",
  "powerKw",
  "productModelCode",
  "query",
  "targetCountryIso3",
  "topics",
]);
function sanitizedArgs(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(input).filter(([key]) => allowedReportArgKeys.has(key)),
  );
}

function sameTools(actual: readonly string[], expected: readonly string[]) {
  return JSON.stringify([...actual].sort()) ===
    JSON.stringify([...expected].sort());
}

function markLiveEvalFailure(): void {
  process.exitCode = 1;
  process.once("beforeExit", () => {
    process.exitCode = 1;
  });
}

function buildLiveEvalReport(input: {
  modelId: string | null;
  modelStepCount: number;
  provenance: {
    promptVersion: string;
    repository: LiveEvalRepositoryState;
    sourceFingerprint: LiveEvalSourceFingerprint;
  };
  results: readonly LiveEvalResult[];
  runId: string;
  runError: LiveEvalRunError | null;
  terminationReason: LiveEvalTerminationReason;
}) {
  const scores = scoreLiveEval(input.results);
  const tokenBudget = summarizeLiveEvalTokenBudget(
    input.results.map(({ tokenUsage }) => tokenUsage),
  );
  const complete =
    input.runError === null &&
    input.results.length === salesChatLiveCases.length;
  const thresholdsPassed = liveEvalThresholdsPassed({
    allCasesPassed: input.results.every(({ pass }) => pass),
    complete,
    maxTokens: LIVE_EVAL_MAX_TOKENS,
    scores,
    tokenUsageComplete: tokenBudget.tokenUsageComplete,
    totalTokens: tokenBudget.totalTokens,
  });

  return {
    budget: {
      caseCount: input.results.length,
      caseTimeoutMs: LIVE_EVAL_CASE_TIMEOUT_MS,
      maxCases: LIVE_EVAL_MAX_CASES,
      maxLoopStepsPerCase: MAX_AI_TOOL_STEPS,
      maxTokens: LIVE_EVAL_MAX_TOKENS,
      modelStepCount: input.modelStepCount,
      caseTokenReserve: LIVE_EVAL_CASE_TOKEN_RESERVE,
      tokenUsageComplete: tokenBudget.tokenUsageComplete,
      totalTokens: tokenBudget.totalTokens,
    },
    complete,
    evaluatedAt: new Date().toISOString(),
    modelId: input.modelId,
    provenance: input.provenance,
    results: input.results,
    runId: input.runId,
    runError: input.runError,
    sampleCount: input.results.length,
    scores,
    thresholds: LIVE_EVAL_THRESHOLDS,
    thresholdsPassed,
    terminationReason: input.terminationReason,
    version: SALES_CHAT_LIVE_EVAL_VERSION,
  };
}

async function initializeLiveEvalRuntime() {
  let stage: LiveEvalInitializationStage = "module_import";

  try {
    const [
      { aiToolResultSchema },
      { buildSalesChatEvidenceContract, evidenceContractAllowsModelText },
      { createSalesChatTools, streamSalesChat },
      { getConfiguredAiModel },
      { getDemoDatabase },
    ] = await Promise.all([
      import("../../src/features/ai/schemas"),
      import("../../src/server/ai/evidence-contract"),
      import("../../src/server/ai/sales-chat"),
      import("../../src/server/ai/model"),
      import("../../src/server/db/demo-client"),
    ]);

    stage = "database";
    await getDemoDatabase();
    stage = "model_configuration";
    const { model, modelId } = getConfiguredAiModel();

    return {
      ok: true as const,
      runtime: {
        aiToolResultSchema,
        buildSalesChatEvidenceContract,
        createSalesChatTools,
        evidenceContractAllowsModelText,
        model,
        modelId,
        streamSalesChat,
      },
    };
  } catch (error: unknown) {
    return { error, ok: false as const, stage };
  }
}

async function main(): Promise<void> {
  const repositoryAtStart = captureLiveEvalRepositoryState(workspace);
  const sourceFingerprintAtStart = await captureLiveEvalSourceFingerprint(
    workspace,
  );
  const runId = randomUUID();
  const buildRunContext = async () => ({
    provenance: {
      promptVersion: SALES_CHAT_SYSTEM_PROMPT_VERSION,
      repository: reconcileLiveEvalRepositoryStates(
        repositoryAtStart,
        captureLiveEvalRepositoryState(workspace),
      ),
      sourceFingerprint: reconcileLiveEvalSourceFingerprints(
        sourceFingerprintAtStart,
        await captureLiveEvalSourceFingerprint(workspace),
      ),
    },
    runId,
  });
  const initialized = await initializeLiveEvalRuntime();
  if (!initialized.ok) {
    const runError: LiveEvalRunError = {
      code: "INITIALIZATION_ERROR",
      errorName: safeLiveEvalErrorName(initialized.error),
      stage: initialized.stage,
    };
    const report = buildLiveEvalReport({
      modelId: null,
      modelStepCount: 0,
      ...(await buildRunContext()),
      results: [],
      runError,
      terminationReason: "initialization_error",
    });
    const { archivePath, latestUpdated } = await persistLiveEvalReport(
      workspace,
      report,
    );
    process.stderr.write(
      `Live eval initialization failed at ${runError.stage} (${runError.errorName}). ${latestUpdated ? `Latest: ${reportPath}` : "A newer latest report was preserved."} Archive: ${archivePath}\n`,
    );
    markLiveEvalFailure();
    return;
  }

  const {
    aiToolResultSchema,
    buildSalesChatEvidenceContract,
    createSalesChatTools,
    evidenceContractAllowsModelText,
    model,
    modelId,
    streamSalesChat,
  } = initialized.runtime;
  const results: LiveEvalResult[] = [];
  let caseCount = 0;
  let modelStepCount = 0;
  let tokenUsageComplete = true;
  let totalTokens = 0;
  let terminationReason: LiveEvalTerminationReason | null = null;

  for (const testCase of salesChatLiveCases) {
    const stopReason = resolveLiveEvalStopReason({
      caseCount,
      tokenUsageComplete,
      totalTokens,
    });
    if (stopReason !== null) {
      terminationReason = stopReason;
      break;
    }
    caseCount += 1;
    const startedAt = performance.now();
    const observedMetricSteps: SalesChatStepObservation[] = [];
    let safeStreamFailureMessage: string | null = null;

    try {
      const auditRepository = {
        recordToolCall: async () => undefined,
      };
      const contract = buildSalesChatEvidenceContract({
        selectedCountryIso3: testCase.selectedCountryIso3,
        userTexts: testCase.userTexts,
      });
      const sessionId = crypto.randomUUID();
      const turnId = `live-eval-${testCase.id}`;
      const tools = createSalesChatTools({
        auditRepository,
        ...(contract.asOf ? { defaultAsOf: contract.asOf } : {}),
        selectedCountryIso3: testCase.selectedCountryIso3,
        sessionId,
        turnId,
      });
      const [responseText, toolCalls, toolResults, aggregateUsage, steps] =
        await runWithLiveEvalCaseDeadline({
          run: async (abortSignal) => {
            const generated = streamSalesChat({
              abortSignal,
              auditRepository,
              messages: testCase.userTexts.map((text) => ({
                content: text,
                role: "user" as const,
              })),
              model,
              onStepMetrics: (step) => observedMetricSteps.push(step),
              onStreamError: (error) => {
                safeStreamFailureMessage ??= summarizeLiveEvalError(error);
              },
              selectedCountryIso3: testCase.selectedCountryIso3,
              sessionId,
              tools,
              trustedUserTexts: testCase.userTexts,
              turnId,
            });
            return Promise.all([
              generated.text,
              generated.toolCalls,
              generated.toolResults,
              generated.usage,
              generated.steps,
            ] as const);
          },
          timeoutMs: LIVE_EVAL_CASE_TIMEOUT_MS,
        });
      const loopSteps = steps.length;
      modelStepCount += loopSteps;
      const { knownTokens, tokenUsage } = buildLiveEvalCaseTokenUsage({
        aggregateUsage,
        loopSteps,
        metricSteps: observedMetricSteps,
        modelStreamCompleted: true,
      });
      const caseUsageComplete = tokenUsage.usageComplete;
      tokenUsageComplete &&= caseUsageComplete;
      totalTokens += knownTokens;
      const toolBearingSteps = steps.filter(
        (step) => step.toolCalls.length > 0,
      ).length;
      const toolSequence = toolCalls.map(({ toolName }) => toolName);
      const toolSelectionPassed = sameTools(
        toolSequence,
        testCase.expectedTools,
      );
      const argsPassed = Object.entries(testCase.expectedArgs).every(
        ([toolName, expected]) => {
          const call = toolCalls.find(
            (candidate) => candidate.toolName === toolName,
          );
          return call !== undefined &&
            expected !== undefined &&
            matchesExpectedArgs(call.input, expected);
        },
      );
      const parsedResults = toolResults.flatMap(({ output }) => {
        const parsed = aiToolResultSchema.safeParse(output);
        return parsed.success ? [parsed.data] : [];
      });
      const evidenceAllowed = evidenceContractAllowsModelText(
        contract,
        parsedResults,
      );
      const hasResultError = toolResults.length !== toolCalls.length ||
        toolResults.length !== parsedResults.length ||
        parsedResults.some(({ status }) => status === "error");
      const errorCode = hasResultError ? "TOOL_RESULT_ERROR" : null;
      const evidenceResult = hasResultError
        ? "error" as const
        : evidenceAllowed
          ? "sufficient" as const
          : "insufficient" as const;
      const responseDisposition = resolveLiveEvalResponseDisposition({
        errorCode,
        responseText,
      });
      const judgement = judgeLiveEvalCase({
        argsPassed,
        errorCode,
        evidenceAllowed,
        expectedEvidenceAllowed: testCase.expectedEvidenceAllowed,
        responseDisposition,
        safetyCritical: testCase.safetyCritical,
        tokenUsageComplete: caseUsageComplete,
        toolSelectionPassed,
      });
      results.push({
        argsPassed,
        errorCode,
        evidenceAllowed,
        evidenceExpectationPassed: judgement.evidenceExpectationPassed,
        evidenceResult,
        expectedEvidenceAllowed: testCase.expectedEvidenceAllowed,
        failureMessage: null,
        id: testCase.id,
        latencyMs: Math.round(performance.now() - startedAt),
        loopSteps,
        mismatchReason: judgement.mismatchReason,
        normalizedArgs: toolCalls.map((call) => ({
          args: sanitizedArgs(call.input),
          tool: call.toolName,
        })),
        pass: judgement.pass,
        responseCharacterCount: responseText.trim().length,
        responseDisposition,
        responseDispositionPassed: judgement.responseDispositionPassed,
        safetyCritical: testCase.safetyCritical,
        safetyPassed: judgement.safetyPassed,
        tokenUsage,
        toolBearingSteps,
        toolSelectionPassed,
        toolSequence,
      });
    } catch (error: unknown) {
      const { knownTokens, tokenUsage } = buildLiveEvalCaseTokenUsage({
        aggregateUsage: null,
        loopSteps: observedMetricSteps.length,
        metricSteps: observedMetricSteps,
        modelStreamCompleted: false,
      });
      modelStepCount += tokenUsage.ledger.length;
      totalTokens += knownTokens;
      tokenUsageComplete = false;
      const judgement = judgeLiveEvalCase({
        argsPassed: false,
        errorCode: "EVAL_CASE_ERROR",
        evidenceAllowed: false,
        expectedEvidenceAllowed: testCase.expectedEvidenceAllowed,
        responseDisposition: "not_evaluated",
        safetyCritical: testCase.safetyCritical,
        tokenUsageComplete: false,
        toolSelectionPassed: false,
      });
      results.push({
        argsPassed: false,
        errorCode: "EVAL_CASE_ERROR",
        evidenceAllowed: false,
        evidenceExpectationPassed: judgement.evidenceExpectationPassed,
        evidenceResult: "error",
        expectedEvidenceAllowed: testCase.expectedEvidenceAllowed,
        failureMessage:
          safeStreamFailureMessage ?? summarizeLiveEvalError(error),
        id: testCase.id,
        latencyMs: Math.round(performance.now() - startedAt),
        loopSteps: tokenUsage.ledger.length,
        mismatchReason: judgement.mismatchReason,
        normalizedArgs: [],
        pass: judgement.pass,
        responseCharacterCount: 0,
        responseDisposition: "not_evaluated",
        responseDispositionPassed: judgement.responseDispositionPassed,
        safetyCritical: testCase.safetyCritical,
        safetyPassed: judgement.safetyPassed,
        tokenUsage,
        toolBearingSteps: observedMetricSteps.filter(
          ({ toolCallCount }) => toolCallCount > 0,
        ).length,
        toolSelectionPassed: false,
        toolSequence: [],
      });
      terminationReason = "case_error";
      break;
    }
  }

  terminationReason ??= results.length === salesChatLiveCases.length
    ? "completed"
    : !tokenUsageComplete
      ? "token_usage_incomplete"
      : resolveLiveEvalStopReason({
          caseCount,
          tokenUsageComplete,
          totalTokens,
        }) ?? "case_limit";

  const report = buildLiveEvalReport({
    modelId,
    modelStepCount,
    ...(await buildRunContext()),
    results,
    runError: null,
    terminationReason,
  });
  const { archivePath, latestUpdated } = await persistLiveEvalReport(
    workspace,
    report,
  );
  process.stdout.write(
    `Live eval ${report.thresholdsPassed ? "passed" : "failed"}: ${results.length}/${salesChatLiveCases.length} cases, ${report.budget.modelStepCount} model steps, ${report.budget.totalTokens} known tokens${report.budget.tokenUsageComplete ? "" : " (usage incomplete)"}; termination: ${report.terminationReason}. ${latestUpdated ? `Latest: ${reportPath}` : "A newer latest report was preserved."} Archive: ${archivePath}\n`,
  );
  if (!report.thresholdsPassed) {
    markLiveEvalFailure();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `Live eval report persistence failed (${safeLiveEvalErrorName(error)}).\n`,
  );
  markLiveEvalFailure();
});
