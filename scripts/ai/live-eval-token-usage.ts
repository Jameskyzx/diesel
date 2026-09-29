import {
  recomputeLiveEvalCaseTokenUsage,
  type LiveEvalTokenUsage,
} from "../../src/domain/ai/live-eval";
import { sumKnownTokenUsageCounts } from "../../src/domain/ai/token-usage";
import type { TokenUsageCounts } from "../../src/domain/ai/token-usage";
import type { SalesChatStepObservation } from "../../src/server/ai/sales-chat";

type AggregateUsage = {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  totalTokens: number | undefined;
};

export function summarizeLiveEvalProviderCalls(
  cases: readonly { attemptCount: number; completedCount: number }[],
): { attemptCount: number; completedCount: number } {
  return cases.reduce(
    (totals, result) => ({
      attemptCount: totals.attemptCount + result.attemptCount,
      completedCount: totals.completedCount + result.completedCount,
    }),
    { attemptCount: 0, completedCount: 0 },
  );
}

function toTokenCounts(usage: AggregateUsage) {
  return {
    input: usage.inputTokens,
    output: usage.outputTokens,
    total: usage.totalTokens,
  };
}

export function buildLiveEvalCaseTokenUsage(input: {
  aggregateUsage: AggregateUsage | null;
  attemptCount: number;
  completedCount: number;
  loopSteps: number;
  metricSteps: readonly SalesChatStepObservation[];
  modelStreamCompleted: boolean;
}): { knownTokens: number; tokenUsage: LiveEvalTokenUsage } {
  const ledger = input.metricSteps.map(({ usage }) => toTokenCounts(usage));
  const aggregate = input.aggregateUsage === null
    ? sumKnownTokenUsageCounts(ledger)
    : toTokenCounts(input.aggregateUsage);

  return recomputeLiveEvalCaseTokenUsageWithProviderAttempts({
    aggregate,
    attemptCount: input.attemptCount,
    completedCount: input.completedCount,
    ledger,
    loopSteps: input.loopSteps,
    modelStreamCompleted: input.modelStreamCompleted,
  });
}

/**
 * Recomputes usage completeness without treating a successful retry as fully
 * observed. Failed provider attempts have no completed-step usage, so their
 * token cost is unknowable even when the final attempt succeeds.
 */
export function recomputeLiveEvalCaseTokenUsageWithProviderAttempts(input: {
  aggregate: TokenUsageCounts;
  attemptCount: number;
  completedCount: number;
  ledger: readonly TokenUsageCounts[];
  loopSteps: number;
  modelStreamCompleted: boolean;
}): { knownTokens: number; tokenUsage: LiveEvalTokenUsage } {
  const recomputed = recomputeLiveEvalCaseTokenUsage(input);
  const providerAttemptCoverageComplete =
    Number.isSafeInteger(input.attemptCount) &&
    input.attemptCount > 0 &&
    Number.isSafeInteger(input.completedCount) &&
    input.completedCount > 0 &&
    input.attemptCount === input.completedCount &&
    input.completedCount === input.loopSteps;

  return {
    knownTokens: recomputed.knownTokens,
    tokenUsage: {
      ...recomputed.tokenUsage,
      usageComplete:
        recomputed.tokenUsage.usageComplete &&
        providerAttemptCoverageComplete,
    },
  };
}
