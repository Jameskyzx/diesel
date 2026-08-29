import {
  recomputeLiveEvalCaseTokenUsage,
  summarizeLiveEvalTokenBudget,
  type LiveEvalTokenUsage,
} from "../../src/domain/ai/live-eval";

export function recomputeLiveEvalTokenLedger(
  cases: readonly {
    errorCode: string | null;
    loopSteps: number;
    tokenUsage: LiveEvalTokenUsage;
  }[],
) {
  const caseUsages = cases.map(({ errorCode, loopSteps, tokenUsage }) =>
    recomputeLiveEvalCaseTokenUsage({
      aggregate: tokenUsage,
      ledger: tokenUsage.ledger,
      loopSteps,
      modelStreamCompleted: errorCode !== "EVAL_CASE_ERROR",
    }).tokenUsage
  );

  return {
    caseUsages,
    tokenBudget: summarizeLiveEvalTokenBudget(caseUsages),
  };
}
