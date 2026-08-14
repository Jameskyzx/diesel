import "server-only";

import {
  aiToolNames,
  aiToolResultSchema,
  type AiToolName,
  type AiToolResult,
} from "@/features/ai/schemas";
import {
  evidenceContractAllowsModelText,
  remainingEvidenceTools,
  type SalesChatEvidenceContract,
} from "@/server/ai/evidence-contract";

export const SALES_CHAT_TOOL_ORDER: readonly AiToolName[] = aiToolNames;

export type SalesChatLoopPhase =
  | "attachment_only"
  | "evidence_gap"
  | "final_answer"
  | "gather_evidence";

export type SalesChatLoopPolicy = {
  activeTools: AiToolName[];
  phase: SalesChatLoopPhase;
  toolChoice: "none" | "required";
};

type SalesChatStepLike = {
  content: readonly { type: string }[];
  toolResults: readonly { output: unknown }[];
};

export function collectSalesChatStepEvidence(
  steps: readonly SalesChatStepLike[],
): {
  hasExecutionFailure: boolean;
  results: AiToolResult[];
} {
  const results: AiToolResult[] = [];
  let hasExecutionFailure = false;

  for (const step of steps) {
    if (
      step.content.some(
        ({ type }) =>
          type === "tool-error" ||
          type === "tool-output-denied" ||
          type === "error",
      )
    ) {
      hasExecutionFailure = true;
    }

    for (const toolResult of step.toolResults) {
      const parsed = aiToolResultSchema.safeParse(toolResult.output);
      if (!parsed.success) {
        hasExecutionFailure = true;
        continue;
      }
      results.push(parsed.data);
    }
  }

  return { hasExecutionFailure, results };
}

export function resolveSalesChatLoopPolicy(input: {
  allowToolFreeAttachmentResponse: boolean;
  contract: SalesChatEvidenceContract;
  hasExecutionFailure: boolean;
  results: readonly AiToolResult[];
}): SalesChatLoopPolicy {
  if (
    input.allowToolFreeAttachmentResponse &&
    !input.hasExecutionFailure &&
    input.results.length === 0
  ) {
    return {
      activeTools: [],
      phase: "attachment_only",
      toolChoice: "none",
    };
  }

  if (
    input.hasExecutionFailure ||
    input.results.some(
      (result) => result.status !== "ok" || !result.evidenceSufficient,
    )
  ) {
    return {
      activeTools: [],
      phase: "evidence_gap",
      toolChoice: "none",
    };
  }

  if (evidenceContractAllowsModelText(input.contract, input.results)) {
    return {
      activeTools: [],
      phase: "final_answer",
      toolChoice: "none",
    };
  }

  const activeTools = remainingEvidenceTools(input.contract, input.results);
  if (activeTools.length === 0) {
    return {
      activeTools: [],
      phase: "evidence_gap",
      toolChoice: "none",
    };
  }

  return {
    activeTools,
    phase: "gather_evidence",
    toolChoice: "required",
  };
}
