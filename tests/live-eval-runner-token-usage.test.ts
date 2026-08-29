import { describe, expect, it } from "vitest";

import { buildLiveEvalCaseTokenUsage } from "../scripts/ai/live-eval-token-usage";
import type { SalesChatStepObservation } from "@/server/ai/sales-chat";

function metricStep(input: {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  totalTokens: number | undefined;
}): SalesChatStepObservation {
  return {
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
      expectedComplete: false,
      expectedKnownTokens: 15,
      label: "an interrupted stream with one observed completed step",
      loopSteps: 1,
      metricSteps: [
        metricStep({ inputTokens: 10, outputTokens: 5, totalTokens: 15 }),
      ],
      modelStreamCompleted: false,
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
});
