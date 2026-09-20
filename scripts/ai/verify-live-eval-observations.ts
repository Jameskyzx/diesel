import { isDeepStrictEqual } from "node:util";

import { salesChatLiveCases, SALES_CHAT_LIVE_EVAL_VERSION } from "../../evals/sales-chat-live-cases";
import {
  evaluateLiveEvalResponseContract,
  judgeLiveEvalCase,
  resolveLiveEvalResponseDisposition,
} from "../../src/domain/ai/live-eval";
import { buildLiveEvalCaseObservability } from "../../src/domain/ai/live-eval-observability";
import { liveEvalLocaleCitationTitles } from "../../src/domain/ai/live-eval-response-locale";
import {
  aiToolNameSchema,
  aiToolResultSchema,
  type AiToolResult,
} from "../../src/features/ai/schemas";
import type { Locale } from "../../src/i18n/locale";
import { buildEvidenceGapResponse } from "../../src/domain/ai/evidence-gap-response";
import {
  buildSalesChatEvidenceContract,
  evidenceContractAllowsModelText,
} from "../../src/server/ai/evidence-contract";
import {
  matchesExpectedLiveEvalReportArgs,
  sanitizeLiveEvalReportArgs,
} from "./live-eval-report-args";
import { buildLiveEvalCaseTokenUsage } from "./live-eval-token-usage";
import { liveEvalObservationsSchema } from "./live-eval-observations";
import { liveEvalReportSchema } from "../portfolio/live-eval-report-schema";

function assertSame(actual: unknown, expected: unknown, label: string): void {
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error(`Live-eval observation mismatch: ${label}.`);
  }
}

function sameTools(actual: readonly string[], expected: readonly string[]) {
  return JSON.stringify([...actual].sort()) ===
    JSON.stringify([...expected].sort());
}

export function resolveObservedLiveEvalResponseDisposition(input: {
  errorCode: "EVAL_CASE_ERROR" | "TOOL_RESULT_ERROR" | null;
  evidenceAllowed: boolean;
  expectedEvidenceAllowed: boolean;
  locale: Locale;
  parsedToolResults: AiToolResult[];
  responseText: string;
}) {
  return resolveLiveEvalResponseDisposition({
    errorCode: input.errorCode,
    ...(input.expectedEvidenceAllowed
      ? {}
      : {
          requiredEvidenceBoundaryText: buildEvidenceGapResponse(
            input.parsedToolResults,
            input.parsedToolResults.length > 0 &&
              input.parsedToolResults.every(
                (result) =>
                  result.status === "ok" && result.evidenceSufficient,
              ) &&
              !input.evidenceAllowed,
            false,
            input.locale,
          ),
        }),
    responseText: input.responseText,
  });
}

export function verifyLiveEvalObservations(input: {
  observations: unknown;
  report: unknown;
}): void {
  const observations = liveEvalObservationsSchema.parse(input.observations);
  const report = liveEvalReportSchema.parse(input.report);
  if (report.version !== SALES_CHAT_LIVE_EVAL_VERSION) {
    throw new Error("Live-eval observations require a current-suite report.");
  }
  assertSame(observations.runId, report.runId, "run ID");
  assertSame(observations.evaluatedAt, report.evaluatedAt, "evaluation time");
  assertSame(
    observations.cases.map(({ id }) => id),
    salesChatLiveCases.map(({ id }) => id),
    "canonical case order",
  );
  assertSame(observations.cases.length, report.results.length, "case count");

  for (const [caseIndex, observedCase] of observations.cases.entries()) {
    const testCase = salesChatLiveCases[caseIndex];
    const result = report.results[caseIndex];
    if (testCase === undefined || result === undefined) {
      throw new Error("Live-eval observation case alignment failed.");
    }
    assertSame(observedCase.runtimeContext, result.runtimeContext, `${testCase.id} runtime clock`);
    const toolCalls = observedCase.steps.flatMap(({ toolCalls }) => toolCalls);
    const toolResults = observedCase.steps.flatMap(({ toolResults }) => toolResults);
    const derivedErrorCode = observedCase.boundaryRejections.length > 0
      ? "TOOL_RESULT_ERROR" as const
      : !observedCase.streamCompleted || observedCase.streamErrorObserved
        ? "EVAL_CASE_ERROR" as const
        : null;
    assertSame(result.errorCode, derivedErrorCode, `${testCase.id} error code`);
    assertSame(
      observedCase.streamCompleted,
      true,
      `${testCase.id} stream completion`,
    );
    assertSame(
      observedCase.streamErrorObserved,
      false,
      `${testCase.id} stream error observation`,
    );
    assertSame(
      observedCase.boundaryRejections,
      [],
      `${testCase.id} boundary rejections`,
    );
    for (const step of observedCase.steps) {
      assertSame(
        step.metric.toolCallCount,
        step.toolCalls.length,
        `${testCase.id} step tool-call count`,
      );
      assertSame(
        new Set(step.toolCalls.map(({ toolCallId }) => toolCallId)).size,
        step.toolCalls.length,
        `${testCase.id} unique step tool-call IDs`,
      );
      assertSame(
        new Set(step.toolResults.map(({ toolCallId }) => toolCallId)).size,
        step.toolResults.length,
        `${testCase.id} unique step tool-result IDs`,
      );
      assertSame(
        step.toolResults.length,
        step.toolCalls.length,
        `${testCase.id} step tool result count`,
      );
      const callsById = new Map(
        step.toolCalls.map((call) => [call.toolCallId, call]),
      );
      for (const [resultIndex, toolResult] of step.toolResults.entries()) {
        const toolCall = callsById.get(toolResult.toolCallId);
        const orderedCall = step.toolCalls[resultIndex];
        if (
          toolCall === undefined ||
          toolCall.toolName !== toolResult.toolName ||
          orderedCall?.toolCallId !== toolResult.toolCallId ||
          orderedCall.toolName !== toolResult.toolName
        ) {
          throw new Error(
            `Live-eval observation mismatch: ${testCase.id} tool result pairing.`,
          );
        }
      }
    }
    assertSame(
      new Set(toolCalls.map(({ toolCallId }) => toolCallId)).size,
      toolCalls.length,
      `${testCase.id} unique case tool-call IDs`,
    );
    assertSame(
      new Set(toolResults.map(({ toolCallId }) => toolCallId)).size,
      toolResults.length,
      `${testCase.id} unique case tool-result IDs`,
    );

    const normalizedArgs = toolCalls.map((call) => {
      const tool = aiToolNameSchema.parse(call.toolName);
      return {
        args: sanitizeLiveEvalReportArgs({
          args: call.input,
          invalid: call.invalid || call.dynamic,
          knowledgeQueryContract: testCase.knowledgeQueryContract,
          tool,
        }),
        tool,
      };
    });
    const argsPassed = Object.entries(testCase.expectedArgs).every(
      ([toolName, expected]) => {
        const call = normalizedArgs.find(({ tool }) => tool === toolName);
        return call !== undefined && expected !== undefined &&
          matchesExpectedLiveEvalReportArgs({
            actual: call.args,
            expected,
            runtimeContext: observedCase.runtimeContext,
            knowledgeQueryContract: testCase.knowledgeQueryContract,
            tool: call.tool,
          });
      },
    );
    const parsedToolResults = toolResults.map(({ output, toolName }) => {
      const parsed = aiToolResultSchema.parse(output);
      if (parsed.tool !== toolName) {
        throw new Error(
          `Live-eval observation mismatch: ${testCase.id} tool output name.`,
        );
      }
      return parsed;
    });
    const evidenceContract = buildSalesChatEvidenceContract({
      runtimeContext: observedCase.runtimeContext,
      selectedCountryIso3: testCase.selectedCountryIso3,
      userTexts: testCase.userTexts,
    });
    const evidenceAllowed = evidenceContractAllowsModelText(
      evidenceContract,
      parsedToolResults,
    );
    const responseDisposition = resolveObservedLiveEvalResponseDisposition({
      errorCode: derivedErrorCode,
      evidenceAllowed,
      expectedEvidenceAllowed: testCase.expectedEvidenceAllowed,
      locale: testCase.locale,
      parsedToolResults,
      responseText: observedCase.responseText,
    });
    const responseObservation = evaluateLiveEvalResponseContract({
      expectedLocale: testCase.locale,
      localeEvidenceTitles: liveEvalLocaleCitationTitles({
        evidenceAllowed: derivedErrorCode === null && evidenceAllowed,
        toolResults: parsedToolResults,
      }),
      responseContract: testCase.responseContract,
      responseText: observedCase.responseText,
    });
    const { tokenUsage } = buildLiveEvalCaseTokenUsage({
      aggregateUsage: {
        inputTokens: observedCase.aggregateUsage.inputTokens ?? undefined,
        outputTokens: observedCase.aggregateUsage.outputTokens ?? undefined,
        totalTokens: observedCase.aggregateUsage.totalTokens ?? undefined,
      },
      attemptCount: observedCase.attemptCount,
      completedCount: observedCase.completedCount,
      loopSteps: observedCase.steps.length,
      metricSteps: observedCase.steps.map(({ metric }) => ({
        observability: metric.observability,
        toolCallCount: metric.toolCallCount,
        usage: {
          inputTokens: metric.usage.inputTokens ?? undefined,
          outputTokens: metric.usage.outputTokens ?? undefined,
          totalTokens: metric.usage.totalTokens ?? undefined,
        },
      })),
      modelStreamCompleted: true,
    });
    const modelObservability = buildLiveEvalCaseObservability({
      attemptCount: observedCase.attemptCount,
      completedCount: observedCase.completedCount,
      expectedStepCount: observedCase.steps.length,
      modelStreamCompleted: true,
      steps: observedCase.steps.map(({ metric }) => metric.observability),
    });
    const toolSequence = toolCalls.map(({ toolName }) => toolName);
    const toolSelectionPassed = sameTools(toolSequence, testCase.expectedTools);
    const judgement = judgeLiveEvalCase({
      argsPassed,
      errorCode: derivedErrorCode,
      evidenceAllowed,
      expectedEvidenceAllowed: testCase.expectedEvidenceAllowed,
      responseDisposition,
      responseGroundingPassed: responseObservation.responseGroundingPassed,
      responseLocalePassed: responseObservation.responseLocalePassed,
      safetyCritical: testCase.safetyCritical,
      tokenUsageComplete: tokenUsage.usageComplete,
      toolSelectionPassed,
    });
    const recomputed = {
      argsPassed,
      attemptCount: observedCase.attemptCount,
      completedCount: observedCase.completedCount,
      detectedResponseLocale: responseObservation.detectedResponseLocale,
      evidenceAllowed,
      evidenceExpectationPassed: judgement.evidenceExpectationPassed,
      evidenceResult: derivedErrorCode !== null
        ? "error"
        : evidenceAllowed
          ? "sufficient"
          : "insufficient",
      latencyMs: observedCase.latencyMs,
      loopSteps: observedCase.steps.length,
      matchedResponseAnchorIds: responseObservation.matchedResponseAnchorIds,
      mismatchReason: judgement.mismatchReason,
      missingResponseAnchorIds: responseObservation.missingResponseAnchorIds,
      modelObservability,
      normalizedArgs,
      pass: judgement.pass,
      responseCharacterCount: observedCase.responseText.trim().length,
      responseDisposition,
      responseDispositionPassed: judgement.responseDispositionPassed,
      responseGroundingPassed: responseObservation.responseGroundingPassed,
      responseLocalePassed: responseObservation.responseLocalePassed,
      safetyPassed: judgement.safetyPassed,
      tokenUsage,
      toolBearingSteps: observedCase.steps.filter(
        ({ toolCalls: calls }) => calls.length > 0,
      ).length,
      toolSelectionPassed,
      toolSequence,
    };
    for (const [field, value] of Object.entries(recomputed)) {
      assertSame(result[field as keyof typeof result], value, `${testCase.id} ${field}`);
    }
  }
}
