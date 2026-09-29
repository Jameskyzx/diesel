import { describe, expect, it } from "vitest";

import { resolveLiveEvalCaseStepStopReason } from "../scripts/ai/live-eval";
import { buildLiveEvalCaseTokenUsage } from "../scripts/ai/live-eval-token-usage";
import type { SalesChatStepObservation } from "@/server/ai/sales-chat";
import { normalizeModelStepObservation } from "@/domain/ai/model-observability";

function metricStep(input: {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  totalTokens: number | undefined;
}): SalesChatStepObservation {
  return {
    observability: normalizeModelStepObservation({
      performance: {
        responseTimeMs: 0,
        stepTimeMs: 0,
        timeToFirstOutputMs: undefined,
      },
      usage: {
        inputTokenDetails: {
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
          noCacheTokens: undefined,
        },
        ...input,
      },
    }),
    toolCallCount: 0,
    usage: {
      ...input,
    },
  };
}

describe("live eval runner token ledger", () => {
  it.each([
    {
      aggregateUsage: {
        inputTokens: 18,
        outputTokens: 7,
        totalTokens: 25,
      },
      attemptCount: 2,
      completedCount: 2,
      expectedComplete: true,
      expectedKnownTokens: 25,
      label: "matching positive provider steps and SDK aggregate",
      loopSteps: 2,
      metricSteps: [
        metricStep({ inputTokens: 10, outputTokens: 5, totalTokens: 15 }),
        metricStep({ inputTokens: 8, outputTokens: 2, totalTokens: 10 }),
      ],
      modelStreamCompleted: true,
    },
    {
      aggregateUsage: {
        inputTokens: 100_000,
        outputTokens: 100_000,
        totalTokens: 1,
      },
      attemptCount: 1,
      completedCount: 1,
      expectedComplete: false,
      expectedKnownTokens: 200_000,
      label: "an understated provider total",
      loopSteps: 1,
      metricSteps: [
        metricStep({
          inputTokens: 100_000,
          outputTokens: 100_000,
          totalTokens: 1,
        }),
      ],
      modelStreamCompleted: true,
    },
    {
      aggregateUsage: {
        inputTokens: 11,
        outputTokens: 5,
        totalTokens: 16,
      },
      attemptCount: 1,
      completedCount: 1,
      expectedComplete: false,
      expectedKnownTokens: 16,
      label: "an SDK aggregate that differs from the step ledger",
      loopSteps: 1,
      metricSteps: [
        metricStep({ inputTokens: 10, outputTokens: 5, totalTokens: 15 }),
      ],
      modelStreamCompleted: true,
    },
    {
      aggregateUsage: {
        inputTokens: 10,
        outputTokens: 10,
        totalTokens: 101,
      },
      attemptCount: 2,
      completedCount: 2,
      expectedComplete: false,
      expectedKnownTokens: 110,
      label: "per-step lower bounds larger than the aggregate lower bound",
      loopSteps: 2,
      metricSteps: [
        metricStep({ inputTokens: 10, outputTokens: undefined, totalTokens: 100 }),
        metricStep({ inputTokens: undefined, outputTokens: 10, totalTokens: 1 }),
      ],
      modelStreamCompleted: true,
    },
    {
      aggregateUsage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      },
      attemptCount: 2,
      completedCount: 2,
      expectedComplete: false,
      expectedKnownTokens: 15,
      label: "a missing onStepEnd ledger row",
      loopSteps: 2,
      metricSteps: [
        metricStep({ inputTokens: 10, outputTokens: 5, totalTokens: 15 }),
      ],
      modelStreamCompleted: true,
    },
    {
      aggregateUsage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
      attemptCount: 1,
      completedCount: 1,
      expectedComplete: false,
      expectedKnownTokens: 0,
      label: "a zero-only successful step",
      loopSteps: 1,
      metricSteps: [
        metricStep({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
      ],
      modelStreamCompleted: true,
    },
    {
      aggregateUsage: null,
      attemptCount: 2,
      completedCount: 1,
      expectedComplete: false,
      expectedKnownTokens: 15,
      label: "an interrupted stream with one observed completed step",
      loopSteps: 1,
      metricSteps: [
        metricStep({ inputTokens: 10, outputTokens: 5, totalTokens: 15 }),
      ],
      modelStreamCompleted: false,
    },
    {
      aggregateUsage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      },
      attemptCount: 2,
      completedCount: 1,
      expectedComplete: false,
      expectedKnownTokens: 15,
      label: "a retry that succeeds after an unobserved failed attempt",
      loopSteps: 1,
      metricSteps: [
        metricStep({ inputTokens: 10, outputTokens: 5, totalTokens: 15 }),
      ],
      modelStreamCompleted: true,
    },
  ] as const)(
    "builds a fail-closed ledger for $label",
    ({ expectedComplete, expectedKnownTokens, ...input }) => {
      const result = buildLiveEvalCaseTokenUsage(input);

      expect(result.knownTokens).toBe(expectedKnownTokens);
      expect(result.tokenUsage.usageComplete).toBe(expectedComplete);
      for (const ledgerStep of result.tokenUsage.ledger) {
        expect(Object.keys(ledgerStep).sort()).toEqual([
          "input",
          "output",
          "total",
        ]);
      }
    },
  );

  it.each([
    {
      attemptCount: 1,
      caseStartingTotalTokens: 100,
      completedCount: 1,
      expected: null,
      label: "complete usage below the remaining budget",
      metricSteps: [
        metricStep({ inputTokens: 10, outputTokens: 5, totalTokens: 15 }),
      ],
    },
    {
      attemptCount: 2,
      caseStartingTotalTokens: 170,
      completedCount: 2,
      expected: "token_limit_exceeded",
      label: "completed steps exactly consume the remaining budget",
      metricSteps: [
        metricStep({ inputTokens: 10, outputTokens: 5, totalTokens: 15 }),
        metricStep({ inputTokens: 10, outputTokens: 5, totalTokens: 15 }),
      ],
    },
    {
      attemptCount: 1,
      caseStartingTotalTokens: 186,
      completedCount: 1,
      expected: "token_limit_exceeded",
      label: "a completed step exceeds the remaining budget",
      metricSteps: [
        metricStep({ inputTokens: 10, outputTokens: 5, totalTokens: 15 }),
      ],
    },
    {
      attemptCount: 1,
      caseStartingTotalTokens: 100,
      completedCount: 1,
      expected: "token_usage_incomplete",
      label: "a completed step omits a usage field",
      metricSteps: [
        metricStep({
          inputTokens: 10,
          outputTokens: undefined,
          totalTokens: 10,
        }),
      ],
    },
    {
      attemptCount: 1,
      caseStartingTotalTokens: 100,
      completedCount: 1,
      expected: "token_usage_incomplete",
      label: "a completed step reports inconsistent usage",
      metricSteps: [
        metricStep({ inputTokens: 10, outputTokens: 5, totalTokens: 12 }),
      ],
    },
    {
      attemptCount: 2,
      caseStartingTotalTokens: 100,
      completedCount: 1,
      expected: "token_usage_incomplete",
      label: "a failed retry has no completed-step usage",
      metricSteps: [
        metricStep({ inputTokens: 10, outputTokens: 5, totalTokens: 15 }),
      ],
    },
  ] as const)(
    "resolves the next-call stop reason for $label",
    ({ expected, ...input }) => {
      expect(
        resolveLiveEvalCaseStepStopReason({
          ...input,
          maxTokens: 200,
        }),
      ).toBe(expected);
    },
  );
});
