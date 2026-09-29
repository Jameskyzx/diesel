import "server-only";

import { aiToolResultSchema } from "@/features/ai/schemas";
import {
  marketComparisonModelToolOutputSchema,
  marketComparisonResultToModelOutput,
  regulationComparisonModelToolOutputSchema,
  regulationComparisonResultToModelOutput,
} from "@/features/ai/model-tool-output-comparisons";
import {
  modelToolOutputUtf8Bytes,
  SALES_CHAT_MODEL_TOOL_OUTPUT_MAX_UTF8_BYTES_PER_STEP,
  SALES_CHAT_MODEL_TOOL_OUTPUT_MAX_UTF8_BYTES_PER_TURN,
  SALES_CHAT_MODEL_TOOL_RESULTS_MAX_PER_STEP,
} from "@/features/ai/model-tool-output-core";
import {
  opportunityScoreModelToolOutputSchema,
  opportunityScoreResultToModelOutput,
  salesBriefModelToolOutputSchema,
  salesBriefResultToModelOutput,
} from "@/features/ai/model-tool-output";
import {
  compatibleProductsModelToolOutputSchema,
  compatibleProductsResultToModelOutput,
} from "@/features/ai/model-tool-output-product-fit";
import {
  getCountryProfileModelToolOutputSchema,
  getCountryProfileResultToModelOutput,
  searchKnowledgeBaseModelToolOutputSchema,
  searchKnowledgeBaseResultToModelOutput,
} from "@/features/ai/model-tool-output-retrieval";

export {
  SALES_CHAT_MODEL_TOOL_OUTPUT_MAX_UTF8_BYTES_PER_STEP,
  SALES_CHAT_MODEL_TOOL_OUTPUT_MAX_UTF8_BYTES_PER_TURN,
  SALES_CHAT_MODEL_TOOL_RESULTS_MAX_PER_STEP,
} from "@/features/ai/model-tool-output-core";

export function salesChatToolResultToModelOutput(output: unknown) {
  const result = aiToolResultSchema.parse(output);
  switch (result.tool) {
    case "searchKnowledgeBase":
      return searchKnowledgeBaseResultToModelOutput(result);
    case "getCountryProfile":
      return getCountryProfileResultToModelOutput(result);
    case "findCompatibleProducts":
      return compatibleProductsResultToModelOutput(result);
    case "compareRegulations":
      return regulationComparisonResultToModelOutput(result);
    case "compareMarkets":
      return marketComparisonResultToModelOutput(result);
    case "calculateOpportunityScore":
      return opportunityScoreResultToModelOutput(result);
    case "generateSalesBrief":
      return salesBriefResultToModelOutput(result);
  }
}

export function salesChatToolResultToSdkModelOutput({
  output,
}: {
  output: unknown;
}) {
  try {
    return {
      type: "json" as const,
      value: salesChatToolResultToModelOutput(output),
    };
  } catch {
    // Provider-executed or otherwise non-local output is rejected by the
    // public evidence boundary. Return only a fixed marker here so the SDK can
    // finish the step without copying an unvalidated payload into history.
    return {
      type: "error-text" as const,
      value: "Tool output rejected by the application evidence boundary.",
    };
  }
}

export function parseSalesChatModelToolOutput(output: unknown): unknown {
  if (typeof output !== "object" || output === null || !("tool" in output)) {
    throw new Error("Model tool output is missing its tool identity");
  }
  switch (output.tool) {
    case "searchKnowledgeBase":
      return searchKnowledgeBaseModelToolOutputSchema.parse(output);
    case "getCountryProfile":
      return getCountryProfileModelToolOutputSchema.parse(output);
    case "findCompatibleProducts":
      return compatibleProductsModelToolOutputSchema.parse(output);
    case "compareRegulations":
      return regulationComparisonModelToolOutputSchema.parse(output);
    case "compareMarkets":
      return marketComparisonModelToolOutputSchema.parse(output);
    case "calculateOpportunityScore":
      return opportunityScoreModelToolOutputSchema.parse(output);
    case "generateSalesBrief":
      return salesBriefModelToolOutputSchema.parse(output);
    default:
      throw new Error("Unknown model tool output identity");
  }
}

export type SalesChatModelToolOutputBudgetExceededReason =
  | "invalid_projection"
  | "result_count"
  | "step_bytes"
  | "turn_bytes";

export type SalesChatModelToolOutputBudgetState =
  | { status: "open" }
  | {
      reason: SalesChatModelToolOutputBudgetExceededReason;
      resultCount: number;
      status: "exceeded";
      stepBytes: number;
      stepNumber: number;
      turnBytes: number;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function invalidProjectionState(input: {
  resultCount: number;
  stepBytes: number;
  stepNumber: number;
  turnBytes: number;
}): SalesChatModelToolOutputBudgetState {
  return { ...input, reason: "invalid_projection", status: "exceeded" };
}

/**
 * Measures each current-turn model projection once. This is the append-only
 * tool payload present in the next provider prompt, not cumulative wire bytes
 * across repeated provider requests.
 */
export function evaluateSalesChatModelToolOutputBudget(
  steps: readonly unknown[],
): SalesChatModelToolOutputBudgetState {
  let turnBytes = 0;
  for (const [stepIndex, step] of steps.entries()) {
    let resultCount = 0;
    let stepBytes = 0;
    if (!isRecord(step) || !isRecord(step.response)) {
      return invalidProjectionState({
        resultCount,
        stepBytes,
        stepNumber: stepIndex + 1,
        turnBytes,
      });
    }
    const messages = step.response.messages;
    if (!Array.isArray(messages)) {
      return invalidProjectionState({
        resultCount,
        stepBytes,
        stepNumber: stepIndex + 1,
        turnBytes,
      });
    }

    for (const message of messages) {
      if (!isRecord(message) || message.role !== "tool") continue;
      if (!Array.isArray(message.content)) {
        return invalidProjectionState({
          resultCount,
          stepBytes,
          stepNumber: stepIndex + 1,
          turnBytes,
        });
      }
      for (const part of message.content) {
        if (!isRecord(part) || part.type !== "tool-result") continue;
        resultCount += 1;
        if (!isRecord(part.output)) {
          return invalidProjectionState({
            resultCount,
            stepBytes,
            stepNumber: stepIndex + 1,
            turnBytes,
          });
        }
        if (part.output.type !== "json" || !("value" in part.output)) {
          return invalidProjectionState({
            resultCount,
            stepBytes,
            stepNumber: stepIndex + 1,
            turnBytes,
          });
        }
        try {
          const projection = parseSalesChatModelToolOutput(part.output.value);
          stepBytes += modelToolOutputUtf8Bytes(projection);
        } catch {
          return invalidProjectionState({
            resultCount,
            stepBytes,
            stepNumber: stepIndex + 1,
            turnBytes,
          });
        }
      }
    }

    turnBytes += stepBytes;
    if (resultCount > SALES_CHAT_MODEL_TOOL_RESULTS_MAX_PER_STEP) {
      return {
        reason: "result_count",
        resultCount,
        status: "exceeded",
        stepBytes,
        stepNumber: stepIndex + 1,
        turnBytes,
      };
    }
    if (stepBytes > SALES_CHAT_MODEL_TOOL_OUTPUT_MAX_UTF8_BYTES_PER_STEP) {
      return {
        reason: "step_bytes",
        resultCount,
        status: "exceeded",
        stepBytes,
        stepNumber: stepIndex + 1,
        turnBytes,
      };
    }
    if (turnBytes > SALES_CHAT_MODEL_TOOL_OUTPUT_MAX_UTF8_BYTES_PER_TURN) {
      return {
        reason: "turn_bytes",
        resultCount,
        status: "exceeded",
        stepBytes,
        stepNumber: stepIndex + 1,
        turnBytes,
      };
    }
  }
  return { status: "open" };
}

export function createSalesChatModelToolOutputBudgetGate() {
  let state: SalesChatModelToolOutputBudgetState = { status: "open" };
  return {
    getState: (): SalesChatModelToolOutputBudgetState => state,
    stopWhen: ({ steps }: { steps: readonly unknown[] }): boolean => {
      if (state.status === "exceeded") return true;
      try {
        const evaluated = evaluateSalesChatModelToolOutputBudget(steps);
        if (evaluated.status === "exceeded") state = evaluated;
      } catch {
        state = invalidProjectionState({
          resultCount: 0,
          stepBytes: 0,
          stepNumber: steps.length,
          turnBytes: 0,
        });
      }
      return state.status === "exceeded";
    },
  };
}
