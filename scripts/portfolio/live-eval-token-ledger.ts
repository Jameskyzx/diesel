import {
  summarizeLiveEvalTokenBudget,
  type LiveEvalTokenUsage,
} from "../../src/domain/ai/live-eval";
import {
  recomputeLiveEvalCaseTokenUsageWithProviderAttempts,
  summarizeLiveEvalProviderCalls,
} from "../ai/live-eval-token-usage";

export function recomputeLiveEvalTokenLedger(
  cases: readonly {
    attemptCount: number;
    completedCount: number;
    errorCode: string | null;
    loopSteps: number;
    tokenUsage: LiveEvalTokenUsage;
  }[],
) {
  const caseUsages = cases.map(({
    attemptCount,
    completedCount,
    errorCode,
    loopSteps,
    tokenUsage,
  }) =>
    recomputeLiveEvalCaseTokenUsageWithProviderAttempts({
      aggregate: tokenUsage,
      attemptCount,
      completedCount,
      ledger: tokenUsage.ledger,
      loopSteps,
      modelStreamCompleted: errorCode !== "EVAL_CASE_ERROR",
    }).tokenUsage
  );

  return {
    caseUsages,
    providerCalls: summarizeLiveEvalProviderCalls(cases),
    tokenBudget: summarizeLiveEvalTokenBudget(caseUsages),
  };
}
