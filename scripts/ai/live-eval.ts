import { randomUUID } from "node:crypto";

import { captureChatRuntimeContext, type ChatRuntimeContext } from "../../src/domain/ai/chat-runtime-context";
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
  evaluateLiveEvalResponseContract,
  judgeLiveEvalCase,
  liveEvalProviderBindingMatchesExpected,
  liveEvalResponseContractAnchorIds,
  liveEvalTokenLimitReached,
  liveEvalProviderProfileCanRun,
  liveEvalOutputTokenLimitPassed,
  liveEvalThresholdsPassed,
  resolveLiveEvalResponseDisposition,
  resolveLiveEvalStopReason,
  resolveLiveEvalTerminationReason,
  scoreLiveEval,
  summarizeLiveEvalTokenBudget,
  type LiveEvalResultErrorCode,
  type LiveEvalTerminationReason,
  type LiveEvalDetectedResponseLocale,
  type LiveEvalResponseDisposition,
  type LiveEvalTokenUsage,
} from "../../src/domain/ai/live-eval";
import {
  buildLiveEvalCaseObservability,
  summarizeLiveEvalObservability,
  type LiveEvalCaseModelObservability,
} from "../../src/domain/ai/live-eval-observability";
import {
  MAX_AI_TOOL_STEPS,
  SALES_CHAT_SYSTEM_PROMPT_VERSION,
} from "../../src/features/ai/constants";
import { aiToolNameSchema } from "../../src/features/ai/schemas";
import type {
  SalesChatBoundaryRejectionReason,
  SalesChatProviderCallObservation,
  SalesChatStepObservation,
} from "../../src/server/ai/sales-chat";
import type { AiProviderProfile } from "../../src/server/ai/model";
import {
  buildLiveEvalCaseTokenUsage,
  summarizeLiveEvalProviderCalls,
} from "./live-eval-token-usage";
import { runWithLiveEvalCaseDeadline } from "./live-eval-deadline";
import { liveEvalLocaleCitationTitles } from "../../src/domain/ai/live-eval-response-locale";
import {
  observeFailedPublicResponses,
  type FailedPublicResponseObserver,
} from "./live-eval-diagnostics";
import {
  observeFailedSourceEvidence,
  type FailedSourceEvidenceObserver,
} from "./live-eval-source-diagnostics";
import {
  safeLiveEvalErrorName,
  summarizeLiveEvalError,
} from "./live-eval-error";
import {
  LIVE_EVAL_OBSERVATIONS_VERSION,
  projectLiveEvalToolJson,
  serializeLiveEvalObservations,
  type InMemoryLiveEvalObservations,
  liveEvalObservationsSchema,
} from "./live-eval-observations";
import {
  matchesExpectedLiveEvalReportArgs,
  sanitizeLiveEvalReportArgs,
} from "./live-eval-report-args";
import {
  captureLiveEvalRepositoryState,
  captureLiveEvalSourceFingerprint,
  liveEvalRunCanSucceed,
  persistLiveEvalReport,
  reconcileLiveEvalRepositoryStates,
  reconcileLiveEvalSourceFingerprints,
  resolveLiveEvalLatestReportPath,
  type LiveEvalReportReceipt,
  type LiveEvalRepositoryState,
  type LiveEvalSourceFingerprint,
} from "./live-eval-report";
import { deriveLiveEvalReportState } from "../portfolio/live-eval-report-state";
import { liveEvalReportSchema } from "../portfolio/live-eval-report-schema";

process.env.DATABASE_MODE = "pglite-demo";
process.env.PORTFOLIO_DEMO_MODE = "false";
process.env.AI_CHAT_RATE_LIMIT_BACKEND = "memory";
// A live evaluation is invalid when the streaming provider omits usage. Force
// the adapter to request it even if the production compatibility default is off.
process.env.AI_INCLUDE_USAGE = "true";
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
  runtimeContext: ChatRuntimeContext;
  argsPassed: boolean;
  attemptCount: number;
  completedCount: number;
  detectedResponseLocale: LiveEvalDetectedResponseLocale;
  errorCode: LiveEvalResultErrorCode | null;
  evidenceAllowed: boolean;
  evidenceExpectationPassed: boolean;
  evidenceResult: "sufficient" | "insufficient" | "error";
  expectedEvidenceAllowed: boolean;
  failureMessage: string | null;
  id: string;
  latencyMs: number;
  locale: (typeof salesChatLiveCases)[number]["locale"];
  loopSteps: number;
  matchedResponseAnchorIds: string[];
  mismatchReason: string | null;
  missingResponseAnchorIds: string[];
  modelObservability: LiveEvalCaseModelObservability;
  normalizedArgs: Array<{ args: Record<string, unknown>; tool: string }>;
  pass: boolean;
  responseCharacterCount: number;
  responseDisposition: LiveEvalResponseDisposition;
  responseDispositionPassed: boolean;
  responseGroundingPassed: boolean;
  responseLocalePassed: boolean;
  safetyCritical: boolean;
  safetyPassed: boolean | null;
  tokenUsage: LiveEvalTokenUsage;
  toolBearingSteps: number;
  toolSelectionPassed: boolean;
  toolSequence: string[];
  toolTraceStatus: "complete" | "unavailable";
};

type LiveEvalCaseStepStopReason = Extract<
  LiveEvalTerminationReason,
  "token_limit_exceeded" | "token_usage_incomplete"
>;

// Usage is observable only after a provider step completes. This closes the
// remaining calls in the same case, but cannot pre-authorize or cap the step
// already consumed; report metadata therefore remains post_usage_acceptance.
export function resolveLiveEvalCaseStepStopReason(input: {
  attemptCount: number;
  caseStartingTotalTokens: number;
  completedCount: number;
  maxTokens?: number;
  metricSteps: readonly SalesChatStepObservation[];
}): LiveEvalCaseStepStopReason | null {
  const { knownTokens, tokenUsage } = buildLiveEvalCaseTokenUsage({
    aggregateUsage: null,
    attemptCount: input.attemptCount,
    completedCount: input.completedCount,
    loopSteps: input.metricSteps.length,
    metricSteps: input.metricSteps,
    modelStreamCompleted: true,
  });

  if (!tokenUsage.usageComplete) {
    return "token_usage_incomplete";
  }

  return liveEvalTokenLimitReached(
      input.caseStartingTotalTokens + knownTokens,
      input.maxTokens,
    )
    ? "token_limit_exceeded"
    : null;
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
  provenance: {
    promptVersion: string;
    providerProfile: AiProviderProfile | null;
    repository: LiveEvalRepositoryState;
    sourceFingerprint: LiveEvalSourceFingerprint;
  };
  results: readonly LiveEvalResult[];
  runId: string;
  runError: LiveEvalRunError | null;
  terminationReason: LiveEvalTerminationReason;
}) {
  const { attemptCount, completedCount } =
    summarizeLiveEvalProviderCalls(input.results);
  const modelStepCount = input.results.reduce(
    (sum, result) => sum + result.loopSteps,
    0,
  );
  const scores = scoreLiveEval(input.results);
  const tokenBudget = summarizeLiveEvalTokenBudget(
    input.results.map(({ tokenUsage }) => tokenUsage),
  );
  const observability = summarizeLiveEvalObservability(
    input.results.map(({ latencyMs, modelObservability }) => ({
      latencyMs,
      modelObservability,
    })),
  );
  const { complete } = deriveLiveEvalReportState({
    resultErrorCodes: input.results.map(({ errorCode }) => errorCode),
    resultIds: input.results.map(({ id }) => id),
    runError: input.runError,
    suiteIds: salesChatLiveCases.map(({ id }) => id),
  });
  const outputTokenLimitPassed = liveEvalOutputTokenLimitPassed(
    input.results.map(({ tokenUsage }) => tokenUsage),
  );
  const thresholdsPassed = liveEvalThresholdsPassed({
    allCasesPassed:
      input.results.every(({ pass }) => pass) && outputTokenLimitPassed,
    complete,
    maxTokens: LIVE_EVAL_MAX_TOKENS,
    scores,
    terminationReason: input.terminationReason,
    tokenUsageComplete: tokenBudget.tokenUsageComplete,
    totalTokens: tokenBudget.totalTokens,
  });

  return {
    budget: {
      attemptCount,
      caseCount: input.results.length,
      caseTimeoutMs: LIVE_EVAL_CASE_TIMEOUT_MS,
      maxCases: LIVE_EVAL_MAX_CASES,
      maxLoopStepsPerCase: MAX_AI_TOOL_STEPS,
      maxOutputTokensPerCall: LIVE_EVAL_MAX_OUTPUT_TOKENS_PER_CALL,
      maxPotentialOutputTokens:
        LIVE_EVAL_MAX_CASES *
        MAX_AI_TOOL_STEPS *
        LIVE_EVAL_MAX_OUTPUT_TOKENS_PER_CALL,
      maxRetriesPerModelCall: LIVE_EVAL_MAX_RETRIES_PER_MODEL_CALL,
      maxTokens: LIVE_EVAL_MAX_TOKENS,
      completedCount,
      modelStepCount,
      caseTokenReserve: LIVE_EVAL_CASE_TOKEN_RESERVE,
      tokenUsageComplete: tokenBudget.tokenUsageComplete,
      tokenBudgetEnforcement: LIVE_EVAL_TOKEN_BUDGET_ENFORCEMENT,
      totalTokens: tokenBudget.totalTokens,
    },
    complete,
    evaluatedAt: new Date().toISOString(),
    modelId: input.modelId,
    observability,
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
      {
        buildEvidenceGapResponse,
        createSalesChatTools,
        reconcileSalesChatProviderCallObservations,
        streamSalesChat,
      },
      { AiConfigurationError, getConfiguredAiModel },
      { getDemoDatabase },
      { parseStatusSnapshot },
    ] = await Promise.all([
      import("../../src/features/ai/schemas"),
      import("../../src/server/ai/evidence-contract"),
      import("../../src/server/ai/sales-chat"),
      import("../../src/server/ai/model"),
      import("../../src/server/db/demo-client"),
      import("../portfolio/status-snapshot"),
    ]);

    stage = "database";
    await getDemoDatabase();
    stage = "model_configuration";
    const { model, modelId, providerProfile } = getConfiguredAiModel();
    let expectedBinding: {
      modelId: string;
      providerProfile: AiProviderProfile;
    };
    try {
      const [{ readFile }, { resolve }] = await Promise.all([
        import("node:fs/promises"),
        import("node:path"),
      ]);
      const status = parseStatusSnapshot(
        await readFile(resolve(workspace, "docs/STATUS.md"), "utf8"),
      );
      expectedBinding = {
        modelId: status.liveEval.expectedModelId,
        providerProfile: status.liveEval.expectedProviderProfile,
      };
    } catch {
      throw new AiConfigurationError(
        "Live eval could not verify its expected model and provider profile.",
      );
    }
    if (
      !liveEvalProviderProfileCanRun(providerProfile) ||
      !liveEvalProviderBindingMatchesExpected({
        actual: { modelId, providerProfile },
        expected: expectedBinding,
      })
    ) {
      throw new AiConfigurationError(
        "Live eval model and provider profile do not match the STATUS contract.",
      );
    }

    return {
      ok: true as const,
      runtime: {
        aiToolResultSchema,
        buildEvidenceGapResponse,
        buildSalesChatEvidenceContract,
        createSalesChatTools,
        evidenceContractAllowsModelText,
        model,
        modelId,
        providerProfile,
        reconcileSalesChatProviderCallObservations,
        streamSalesChat,
      },
    };
  } catch (error: unknown) {
    return { error, ok: false as const, stage };
  }
}

export async function runLiveEval(
  options: {
    onFailedPublicResponse?: FailedPublicResponseObserver;
    onFailedSourceEvidence?: FailedSourceEvidenceObserver;
    onProviderMayStart?: () => Promise<void>;
  } = {},
): Promise<{
  observations: InMemoryLiveEvalObservations | null;
  reportReceipt: LiveEvalReportReceipt;
}> {
  const repositoryAtStart = captureLiveEvalRepositoryState(workspace);
  const sourceFingerprintAtStart = await captureLiveEvalSourceFingerprint(
    workspace,
  );
  const runId = randomUUID();
  const buildRunContext = async (
    providerProfile: AiProviderProfile | null,
  ) => ({
    provenance: {
      promptVersion: SALES_CHAT_SYSTEM_PROMPT_VERSION,
      providerProfile,
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
    const report = liveEvalReportSchema.parse(buildLiveEvalReport({
      modelId: null,
      ...(await buildRunContext(null)),
      results: [],
      runError,
      terminationReason: "initialization_error",
    }));
    const { archivePath, latestUpdated, reportReceipt } = await persistLiveEvalReport(
      workspace,
      report,
    );
    process.stderr.write(
      `Live eval initialization failed at ${runError.stage} (${runError.errorName}). ${latestUpdated ? `Latest: ${reportPath}` : "A newer latest report was preserved."} Archive: ${archivePath}\n`,
    );
    markLiveEvalFailure();
    return { observations: null, reportReceipt };
  }

  const {
    aiToolResultSchema,
    buildEvidenceGapResponse,
    buildSalesChatEvidenceContract,
    createSalesChatTools,
    evidenceContractAllowsModelText,
    model,
    modelId,
    providerProfile,
    reconcileSalesChatProviderCallObservations,
    streamSalesChat,
  } = initialized.runtime;
  const results: LiveEvalResult[] = [];
  const observations: unknown[] = [];
  let caseCount = 0;
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
    const caseStartingTotalTokens = totalTokens;
    const runtimeContext = captureChatRuntimeContext();
    const startedAt = performance.now();
    const observedMetricSteps: SalesChatStepObservation[] = [];
    // Unlike persisted success-only observations, this call-end ledger also
    // survives an abort before onStepEnd.
    const observedProviderCalls = new Map<
      number,
      SalesChatProviderCallObservation
    >();
    let attemptCount = 0;
    let completedCount = 0;
    let safeStreamFailureMessage: string | null = null;
    let boundaryRejected = false;
    const boundaryRejections = new Set<SalesChatBoundaryRejectionReason>();
    let caseStepStopReason: LiveEvalCaseStepStopReason | null = null;

    try {
      const auditRepository = {
        recordToolCall: async () => undefined,
      };
      const contract = buildSalesChatEvidenceContract({
        runtimeContext,
        selectedCountryIso3: testCase.selectedCountryIso3,
        userTexts: testCase.userTexts,
      });
      const sessionId = crypto.randomUUID();
      const turnId = `live-eval-${testCase.id}`;
      const tools = createSalesChatTools({
        auditRepository,
        runtimeContext,
        ...(contract.asOf ? { defaultAsOf: contract.asOf } : {}),
        selectedCountryIso3: testCase.selectedCountryIso3,
        sessionId,
        turnId,
      });
      const [responseText, toolCalls, toolResults, aggregateUsage, steps] =
        await runWithLiveEvalCaseDeadline({
          run: async (abortSignal) => {
            await options.onProviderMayStart?.();
            const generated = streamSalesChat({
              abortSignal,
              auditRepository,
              runtimeContext,
              locale: testCase.locale,
              maxOutputTokens: LIVE_EVAL_MAX_OUTPUT_TOKENS_PER_CALL,
              maxRetries: LIVE_EVAL_MAX_RETRIES_PER_MODEL_CALL,
              messages: testCase.userTexts.map((text) => ({
                content: text,
                role: "user" as const,
              })),
              model,
              onModelCallMetrics: (metrics) => {
                attemptCount = metrics.attemptCount;
                completedCount = metrics.completedCount;
              },
              onProviderCallObservation: (observation) => {
                observedProviderCalls.set(observation.sequence, observation);
              },
              onStepMetrics: (step) => observedMetricSteps.push(step),
              shouldStopAfterStep: (metricSteps) => {
                const stopReason = resolveLiveEvalCaseStepStopReason({
                  attemptCount,
                  caseStartingTotalTokens,
                  completedCount,
                  metricSteps,
                });
                caseStepStopReason ??= stopReason;
                return stopReason !== null;
              },
              onStreamError: (error) => {
                safeStreamFailureMessage ??= summarizeLiveEvalError(error);
              },
              onBoundaryRejection: (reason) => {
                boundaryRejected = true;
                boundaryRejections.add(reason);
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
      if (safeStreamFailureMessage !== null) {
        // The SDK can resolve its convenience promises with fallback text after
        // emitting an error part. A provider failure is still an execution
        // failure and must never be scored as a completed, safe response.
        throw new Error("The provider stream reported an execution failure.");
      }
      const loopSteps = steps.length;
      // Preserve production's known billing lower bound when call-end
      // telemetry is missing; the v12 completeness contract still fails closed.
      const billingObservations = reconcileSalesChatProviderCallObservations({
        providerCalls: [...observedProviderCalls.values()],
        steps: observedMetricSteps,
      });
      const { knownTokens, tokenUsage } = buildLiveEvalCaseTokenUsage({
        aggregateUsage,
        attemptCount,
        completedCount,
        loopSteps,
        metricSteps: billingObservations,
        modelStreamCompleted: true,
      });
      const modelObservability = buildLiveEvalCaseObservability({
        attemptCount,
        completedCount,
        expectedStepCount: loopSteps,
        modelStreamCompleted: true,
        steps: observedMetricSteps.map(({ observability }) => observability),
      });
      const caseUsageComplete = tokenUsage.usageComplete;
      const toolBearingSteps = steps.filter(
        (step) => step.toolCalls.length > 0,
      ).length;
      const toolSequence = toolCalls.map(({ toolName }) => toolName);
      const toolSelectionPassed = sameTools(
        toolSequence,
        testCase.expectedTools,
      );
      const normalizedArgs = toolCalls.map((call) => {
        const tool = aiToolNameSchema.parse(call.toolName);
        return {
          args: sanitizeLiveEvalReportArgs({
            args: call.input,
            invalid:
              ("invalid" in call && call.invalid === true) ||
              ("dynamic" in call && call.dynamic === true),
            knowledgeQueryContract: testCase.knowledgeQueryContract,
            tool,
          }),
          tool,
        };
      });
      const argsPassed = Object.entries(testCase.expectedArgs).every(
        ([toolName, expected]) => {
          const call = normalizedArgs.find(
            (candidate) => candidate.tool === toolName,
          );
          return call !== undefined &&
            expected !== undefined &&
            matchesExpectedLiveEvalReportArgs({
              actual: call.args,
              expected,
              runtimeContext,
              knowledgeQueryContract: testCase.knowledgeQueryContract,
              tool: call.tool,
            });
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
      const hasResultError = boundaryRejected ||
        toolResults.length !== toolCalls.length ||
        toolResults.length !== parsedResults.length ||
        parsedResults.some(({ status }) => status === "error");
      const errorCode: LiveEvalResultErrorCode | null =
        caseStepStopReason !== null
          ? "EVAL_BUDGET_STOP"
          : hasResultError
            ? "TOOL_RESULT_ERROR"
            : null;
      const evidenceResult = errorCode !== null
        ? "error" as const
        : evidenceAllowed
          ? "sufficient" as const
          : "insufficient" as const;
      const responseDisposition = resolveLiveEvalResponseDisposition({
        errorCode,
        ...(testCase.expectedEvidenceAllowed
          ? {}
          : {
              requiredEvidenceBoundaryText: buildEvidenceGapResponse(
                parsedResults,
                parsedResults.length > 0 &&
                  parsedResults.every(
                    (result) =>
                      result.status === "ok" && result.evidenceSufficient,
                  ) &&
                  !evidenceAllowed,
                false,
                testCase.locale,
              ),
            }),
        responseText,
      });
      const responseContractObservation = errorCode === null
        ? evaluateLiveEvalResponseContract({
            expectedLocale: testCase.locale,
            localeEvidenceTitles: liveEvalLocaleCitationTitles({
              evidenceAllowed,
              toolResults: parsedResults,
            }),
            responseContract: testCase.responseContract,
            responseText,
          })
        : {
            detectedResponseLocale: "indeterminate" as const,
            matchedResponseAnchorIds: [],
            missingResponseAnchorIds: liveEvalResponseContractAnchorIds(
              testCase.responseContract,
            ),
            responseGroundingPassed: false,
            responseLocalePassed: false,
          };
      const judgement = judgeLiveEvalCase({
        argsPassed,
        errorCode,
        evidenceAllowed,
        expectedEvidenceAllowed: testCase.expectedEvidenceAllowed,
        responseDisposition,
        responseGroundingPassed:
          responseContractObservation.responseGroundingPassed,
        responseLocalePassed: responseContractObservation.responseLocalePassed,
        safetyCritical: testCase.safetyCritical,
        tokenUsageComplete: caseUsageComplete,
        toolSelectionPassed,
      });
      const latencyMs = Math.round(performance.now() - startedAt);
      const completedResult: LiveEvalResult = {
        runtimeContext,
        argsPassed,
        attemptCount,
        completedCount,
        detectedResponseLocale:
          responseContractObservation.detectedResponseLocale,
        errorCode,
        evidenceAllowed,
        evidenceExpectationPassed: judgement.evidenceExpectationPassed,
        evidenceResult,
        expectedEvidenceAllowed: testCase.expectedEvidenceAllowed,
        failureMessage: null,
        id: testCase.id,
        latencyMs,
        locale: testCase.locale,
        loopSteps,
        matchedResponseAnchorIds:
          responseContractObservation.matchedResponseAnchorIds,
        mismatchReason: judgement.mismatchReason,
        missingResponseAnchorIds:
          responseContractObservation.missingResponseAnchorIds,
        modelObservability,
        normalizedArgs,
        pass: judgement.pass,
        responseCharacterCount: responseText.trim().length,
        responseDisposition,
        responseDispositionPassed: judgement.responseDispositionPassed,
        responseGroundingPassed:
          responseContractObservation.responseGroundingPassed,
        responseLocalePassed: responseContractObservation.responseLocalePassed,
        safetyCritical: testCase.safetyCritical,
        safetyPassed: judgement.safetyPassed,
        tokenUsage,
        toolBearingSteps,
        toolSelectionPassed,
        toolSequence,
        toolTraceStatus: "complete",
      };
      observations.push({
        runtimeContext,
        aggregateUsage: {
          inputTokens: aggregateUsage.inputTokens ?? null,
          outputTokens: aggregateUsage.outputTokens ?? null,
          totalTokens: aggregateUsage.totalTokens ?? null,
        },
        attemptCount,
        boundaryRejections: [...boundaryRejections],
        completedCount,
        id: testCase.id,
        latencyMs,
        responseText,
        streamCompleted: safeStreamFailureMessage === null,
        streamErrorObserved: safeStreamFailureMessage !== null,
        steps: steps.map((step, stepIndex) => {
          const metric = observedMetricSteps[stepIndex];
          if (metric === undefined) {
            throw new Error("Live eval step observation was not captured.");
          }
          return {
            metric: {
              observability: metric.observability,
              toolCallCount: metric.toolCallCount,
              usage: {
                inputTokens: metric.usage.inputTokens ?? null,
                outputTokens: metric.usage.outputTokens ?? null,
                totalTokens: metric.usage.totalTokens ?? null,
              },
            },
            toolCalls: step.toolCalls.map((call) => ({
              dynamic: "dynamic" in call && call.dynamic === true,
              input: projectLiveEvalToolJson(call.input ?? null),
              invalid: "invalid" in call && call.invalid === true,
              toolCallId: call.toolCallId,
              toolName: call.toolName,
            })),
            toolResults: (step.toolResults ?? []).map((result) => ({
              output: projectLiveEvalToolJson(result.output),
              toolCallId: result.toolCallId,
              toolName: result.toolName,
            })),
          };
        }),
      });
      // Commit the case ledger only after its observation can be serialized;
      // an observation error is accounted for exactly once by the catch path.
      tokenUsageComplete &&= caseUsageComplete;
      totalTokens += knownTokens;
      results.push(completedResult);
      if (caseStepStopReason !== null) {
        terminationReason = caseStepStopReason;
        break;
      }
    } catch (error: unknown) {
      const billingObservations = reconcileSalesChatProviderCallObservations({
        providerCalls: [...observedProviderCalls.values()],
        steps: observedMetricSteps,
      });
      const completedModelStepCount = observedMetricSteps.length;
      const { knownTokens, tokenUsage } = buildLiveEvalCaseTokenUsage({
        aggregateUsage: null,
        attemptCount,
        completedCount,
        loopSteps: completedModelStepCount,
        metricSteps: billingObservations,
        modelStreamCompleted: false,
      });
      const modelObservability = buildLiveEvalCaseObservability({
        attemptCount,
        completedCount,
        expectedStepCount: completedModelStepCount,
        modelStreamCompleted: false,
        steps: observedMetricSteps.map(({ observability }) => observability),
      });
      totalTokens += knownTokens;
      tokenUsageComplete = false;
      const judgement = judgeLiveEvalCase({
        argsPassed: false,
        errorCode: "EVAL_CASE_ERROR",
        evidenceAllowed: false,
        expectedEvidenceAllowed: testCase.expectedEvidenceAllowed,
        responseDisposition: "not_evaluated",
        responseGroundingPassed: false,
        responseLocalePassed: false,
        safetyCritical: testCase.safetyCritical,
        tokenUsageComplete: false,
        toolSelectionPassed: false,
      });
      results.push({
        runtimeContext,
        argsPassed: false,
        attemptCount,
        completedCount,
        detectedResponseLocale: "indeterminate",
        errorCode: "EVAL_CASE_ERROR",
        evidenceAllowed: false,
        evidenceExpectationPassed: judgement.evidenceExpectationPassed,
        evidenceResult: "error",
        expectedEvidenceAllowed: testCase.expectedEvidenceAllowed,
        failureMessage:
          safeStreamFailureMessage ?? summarizeLiveEvalError(error),
        id: testCase.id,
        latencyMs: Math.round(performance.now() - startedAt),
        locale: testCase.locale,
        loopSteps: completedModelStepCount,
        matchedResponseAnchorIds: [],
        mismatchReason: judgement.mismatchReason,
        missingResponseAnchorIds: liveEvalResponseContractAnchorIds(
          testCase.responseContract,
        ),
        modelObservability,
        normalizedArgs: [],
        pass: judgement.pass,
        responseCharacterCount: 0,
        responseDisposition: "not_evaluated",
        responseDispositionPassed: judgement.responseDispositionPassed,
        responseGroundingPassed: false,
        responseLocalePassed: false,
        safetyCritical: testCase.safetyCritical,
        safetyPassed: judgement.safetyPassed,
        tokenUsage,
        toolBearingSteps: observedMetricSteps.filter(
          ({ toolCallCount }) => toolCallCount > 0,
        ).length,
        toolSelectionPassed: false,
        toolSequence: [],
        // The completed-step observer retains counts, not complete tool
        // identities/inputs. Never fabricate a trace or erase known counts
        // when an execution error discards the SDK convenience promises.
        toolTraceStatus: "unavailable",
      });
      terminationReason = "case_error";
      break;
    }
  }

  const derivedTerminationReason = resolveLiveEvalTerminationReason({
    caseCount,
    lastResultErrorCode: results.at(-1)?.errorCode,
    runError: false,
    suiteCaseCount: salesChatLiveCases.length,
    tokenUsageComplete,
    totalTokens,
  });
  if (derivedTerminationReason === null) {
    throw new Error("Live eval stopped without a valid termination reason.");
  }
  terminationReason = derivedTerminationReason;

  const report = liveEvalReportSchema.parse(buildLiveEvalReport({
    modelId,
    ...(await buildRunContext(providerProfile)),
    results,
    runError: null,
    terminationReason,
  }));
  if (report.version !== SALES_CHAT_LIVE_EVAL_VERSION) {
    throw new Error("Final live eval report version drifted.");
  }
  const { archivePath, latestUpdated, reportReceipt } = await persistLiveEvalReport(
    workspace,
    report,
  );
  process.stdout.write(
    `Live eval ${report.thresholdsPassed && latestUpdated ? "passed" : "failed"}: ${results.length}/${salesChatLiveCases.length} cases, ${report.budget.attemptCount} provider attempts / ${report.budget.completedCount} completed calls / ${report.budget.modelStepCount} model steps, ${report.budget.totalTokens} known tokens${report.budget.tokenUsageComplete ? "" : " (usage incomplete)"}; termination: ${report.terminationReason}. ${latestUpdated ? `Latest: ${reportPath}` : "A newer latest report was preserved; this run cannot satisfy the gate."} Archive: ${archivePath}\n`,
  );
  if (!liveEvalRunCanSucceed({
    latestUpdated,
    thresholdsPassed: report.thresholdsPassed,
  })) {
      markLiveEvalFailure();
  }
  const serializedObservations = report.thresholdsPassed && report.runError === null
    ? serializeLiveEvalObservations(liveEvalObservationsSchema.parse({
        cases: observations,
        evaluatedAt: report.evaluatedAt,
        runId: report.runId,
        version: LIVE_EVAL_OBSERVATIONS_VERSION,
      }))
    : null;
  observeFailedPublicResponses({
    observations,
    observer: options.onFailedPublicResponse,
    reportReceipt,
    results: report.results,
  });
  observeFailedSourceEvidence({
    observations,
    observer: options.onFailedSourceEvidence,
    reportReceipt,
    results: report.results,
  });
  return { observations: serializedObservations, reportReceipt };
}
