import {
  recomputeLiveEvalCaseTokenUsage,
  type LiveEvalTokenUsage,
} from "../../src/domain/ai/live-eval";
import { sumKnownTokenUsageCounts } from "../../src/domain/ai/token-usage";
import type { SalesChatStepObservation } from "../../src/server/ai/sales-chat";

type AggregateUsage = {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  totalTokens: number | undefined;
};

function toTokenCounts(usage: AggregateUsage) {
  return {
    input: usage.inputTokens,
    output: usage.outputTokens,
    total: usage.totalTokens,
  };
}

export function buildLiveEvalCaseTokenUsage(input: {
  aggregateUsage: AggregateUsage | null;
  loopSteps: number;
  metricSteps: readonly SalesChatStepObservation[];
  modelStreamCompleted: boolean;
}): { knownTokens: number; tokenUsage: LiveEvalTokenUsage } {
  const ledger = input.metricSteps.map(({ usage }) => toTokenCounts(usage));
  const aggregate = input.aggregateUsage === null
    ? sumKnownTokenUsageCounts(ledger)
    : toTokenCounts(input.aggregateUsage);

  return recomputeLiveEvalCaseTokenUsage({
    aggregate,
    ledger,
    loopSteps: input.loopSteps,
    modelStreamCompleted: input.modelStreamCompleted,
  });
}
