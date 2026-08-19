import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

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
  shouldStopLiveEval,
} from "../../src/domain/ai/live-eval";
import { MAX_AI_TOOL_STEPS } from "../../src/features/ai/constants";

process.env.DATABASE_MODE = "pglite-demo";
process.env.PORTFOLIO_DEMO_MODE = "false";
process.env.AI_CHAT_RATE_LIMIT_BACKEND = "memory";
if (!process.env.NODE_ENV) {
  Reflect.set(process.env, "NODE_ENV", "development");
}

const reportPath = resolve(
  process.cwd(),
  "docs/evals/ai-live-eval-latest.json",
);
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
  safetyCritical: boolean;
  safetyPassed: boolean | null;
  tokenUsage: { input: number | null; output: number | null; total: number | null };
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
  "targetCountryIso3",
  "topics",
]);
const safeEvalErrorNames = new Set([
  "AiConfigurationError",
  "Error",
  "SyntaxError",
  "TypeError",
  "UnknownError",
  "ZodError",
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

function summarizeEvalError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Unknown eval case error.";
  }

  const apiKey = process.env.AI_API_KEY;
  const message = apiKey
    ? error.message.replaceAll(apiKey, "[redacted]")
    : error.message;
  return `${error.name}: ${message}`.slice(0, 500);
}

function safeEvalErrorName(error: unknown): string {
  if (!(error instanceof Error)) {
    return "UnknownError";
  }
  return safeEvalErrorNames.has(error.name) ? error.name : "Error";
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
  results: readonly LiveEvalResult[];
  runError: LiveEvalRunError | null;
  totalTokens: number;
}) {
  const scores = scoreLiveEval(input.results);
  const complete =
    input.runError === null &&
    input.results.length === salesChatLiveCases.length;
  const thresholdsPassed = liveEvalThresholdsPassed({
    complete,
    maxTokens: LIVE_EVAL_MAX_TOKENS,
    scores,
    totalTokens: input.totalTokens,
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
      totalTokens: input.totalTokens,
    },
    complete,
    evaluatedAt: new Date().toISOString(),
    modelId: input.modelId,
    results: input.results,
    runError: input.runError,
    sampleCount: input.results.length,
    scores,
    thresholds: LIVE_EVAL_THRESHOLDS,
    thresholdsPassed,
    version: SALES_CHAT_LIVE_EVAL_VERSION,
  };
}

async function persistLiveEvalReport(
  report: ReturnType<typeof buildLiveEvalReport>,
): Promise<void> {
  await mkdir(resolve(process.cwd(), "docs/evals"), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
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
  const initialized = await initializeLiveEvalRuntime();
  if (!initialized.ok) {
    const runError: LiveEvalRunError = {
      code: "INITIALIZATION_ERROR",
      errorName: safeEvalErrorName(initialized.error),
      stage: initialized.stage,
    };
    const report = buildLiveEvalReport({
      modelId: null,
      modelStepCount: 0,
      results: [],
      runError,
      totalTokens: 0,
    });
    await persistLiveEvalReport(report);
    process.stderr.write(
      `Live eval initialization failed at ${runError.stage} (${runError.errorName}). Report: ${reportPath}\n`,
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
  let totalTokens = 0;

  for (const testCase of salesChatLiveCases) {
    if (shouldStopLiveEval({ caseCount, totalTokens })) {
      break;
    }
    caseCount += 1;
    const startedAt = performance.now();

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
      const generated = streamSalesChat({
        auditRepository,
        messages: testCase.userTexts.map((text) => ({
          content: text,
          role: "user" as const,
        })),
        model,
        selectedCountryIso3: testCase.selectedCountryIso3,
        sessionId,
        tools,
        trustedUserTexts: testCase.userTexts,
        turnId,
      });
      const [responseText, toolCalls, toolResults, usage, steps] =
        await Promise.all([
          generated.text,
          generated.toolCalls,
          generated.toolResults,
          generated.usage,
          generated.steps,
        ]);
      const loopSteps = steps.length;
      modelStepCount += loopSteps;
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
      const judgement = judgeLiveEvalCase({
        argsPassed,
        errorCode,
        evidenceAllowed,
        expectedEvidenceAllowed: testCase.expectedEvidenceAllowed,
        safetyCritical: testCase.safetyCritical,
        toolSelectionPassed,
      });
      const caseTotalTokens = usage.totalTokens ?? 0;
      totalTokens += caseTotalTokens;
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
        responseCharacterCount: responseText.length,
        safetyCritical: testCase.safetyCritical,
        safetyPassed: judgement.safetyPassed,
        tokenUsage: {
          input: usage.inputTokens ?? null,
          output: usage.outputTokens ?? null,
          total: usage.totalTokens ?? null,
        },
        toolBearingSteps,
        toolSelectionPassed,
        toolSequence,
      });
    } catch (error: unknown) {
      const judgement = judgeLiveEvalCase({
        argsPassed: false,
        errorCode: "EVAL_CASE_ERROR",
        evidenceAllowed: false,
        expectedEvidenceAllowed: testCase.expectedEvidenceAllowed,
        safetyCritical: testCase.safetyCritical,
        toolSelectionPassed: false,
      });
      results.push({
        argsPassed: false,
        errorCode: "EVAL_CASE_ERROR",
        evidenceAllowed: false,
        evidenceExpectationPassed: judgement.evidenceExpectationPassed,
        evidenceResult: "error",
        expectedEvidenceAllowed: testCase.expectedEvidenceAllowed,
        failureMessage: summarizeEvalError(error),
        id: testCase.id,
        latencyMs: Math.round(performance.now() - startedAt),
        loopSteps: 0,
        mismatchReason: judgement.mismatchReason,
        normalizedArgs: [],
        pass: judgement.pass,
        responseCharacterCount: 0,
        safetyCritical: testCase.safetyCritical,
        safetyPassed: judgement.safetyPassed,
        tokenUsage: { input: null, output: null, total: null },
        toolBearingSteps: 0,
        toolSelectionPassed: false,
        toolSequence: [],
      });
    }
  }

  const report = buildLiveEvalReport({
    modelId,
    modelStepCount,
    results,
    runError: null,
    totalTokens,
  });
  await persistLiveEvalReport(report);
  process.stdout.write(
    `Live eval ${report.thresholdsPassed ? "passed" : "failed"}: ${results.length}/${salesChatLiveCases.length} cases, ${modelStepCount} model steps, ${totalTokens} tokens. Report: ${reportPath}\n`,
  );
  if (!report.thresholdsPassed) {
    markLiveEvalFailure();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `Live eval report persistence failed (${safeEvalErrorName(error)}).\n`,
  );
  markLiveEvalFailure();
});
