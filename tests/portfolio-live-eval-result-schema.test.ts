import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { liveEvalResultSchema } from "../scripts/portfolio/live-eval-result-schema";

type LiveEvalResultInput = z.input<typeof liveEvalResultSchema>;

function sourceResult(): LiveEvalResultInput {
  return {
    argsPassed: true,
    errorCode: null,
    evidenceAllowed: true,
    evidenceExpectationPassed: true,
    evidenceResult: "sufficient",
    expectedEvidenceAllowed: true,
    failureMessage: null,
    id: "source-document-retrieval",
    latencyMs: 10,
    loopSteps: 1,
    mismatchReason: null,
    normalizedArgs: [
      {
        args: {
          applicationScope: "non-road",
          countryIso3: "CHN",
          query: "CHN non-road 非道路 emissions 排放 regulation 法规 source 来源",
        },
        tool: "searchKnowledgeBase",
      },
    ],
    pass: true,
    responseCharacterCount: 20,
    responseDisposition: "answered",
    responseDispositionPassed: true,
    safetyCritical: false,
    safetyPassed: null,
    tokenUsage: {
      input: 8,
      ledger: [{ input: 8, output: 3, total: 11 }],
      output: 3,
      total: 11,
      usageComplete: true,
    },
    toolBearingSteps: 1,
    toolSelectionPassed: true,
    toolSequence: ["searchKnowledgeBase"],
  };
}

describe("portfolio live-eval result schema", () => {
  it("keeps a bounded bilingual source query in a valid tool input", () => {
    expect(liveEvalResultSchema.parse(sourceResult())).toMatchObject({
      normalizedArgs: [
        {
          args: expect.objectContaining({
            query: expect.stringContaining("非道路"),
          }),
          tool: "searchKnowledgeBase",
        },
      ],
    });
  });

  it.each([
    {
      label: "a disposition pass that disagrees with its classification",
      mutate: (result: ReturnType<typeof sourceResult>) => {
        result.responseDispositionPassed = false;
      },
    },
    {
      label: "an empty disposition with a non-empty response count",
      mutate: (result: ReturnType<typeof sourceResult>) => {
        result.responseDisposition = "empty";
        result.responseDispositionPassed = false;
      },
    },
    {
      label: "missing required source query",
      mutate: (result: ReturnType<typeof sourceResult>) => {
        Reflect.deleteProperty(result.normalizedArgs[0]!.args, "query");
      },
    },
    {
      label: "unknown normalized argument",
      mutate: (result: ReturnType<typeof sourceResult>) => {
        Object.assign(result.normalizedArgs[0]!.args, {
          rawPrompt: "must not enter a report",
        });
      },
    },
    {
      label: "raw model response text",
      mutate: (result: ReturnType<typeof sourceResult>) => {
        Object.assign(result, {
          responseText: "must not enter a report",
        });
      },
    },
    {
      label: "failure message without an execution error",
      mutate: (result: ReturnType<typeof sourceResult>) => {
        result.failureMessage = "Error: Eval case execution failed.";
      },
    },
    {
      label: "a forged token-usage completeness flag",
      mutate: (result: ReturnType<typeof sourceResult>) => {
        result.tokenUsage.usageComplete = false;
      },
    },
  ])("rejects $label", ({ mutate }) => {
    const result = sourceResult();
    mutate(result);
    expect(liveEvalResultSchema.safeParse(result).success).toBe(false);
  });

  it("requires the fixed sanitized message for an execution error", () => {
    const result = sourceResult();
    result.errorCode = "EVAL_CASE_ERROR";
    result.failureMessage = "Error: Eval case execution failed.";
    result.responseCharacterCount = 0;
    result.responseDisposition = "not_evaluated";
    result.responseDispositionPassed = false;
    result.tokenUsage.usageComplete = false;

    expect(liveEvalResultSchema.safeParse(result).success).toBe(true);
    result.failureMessage = null;
    expect(liveEvalResultSchema.safeParse(result).success).toBe(false);
  });

  it("requires a tool-result error to remain not evaluated", () => {
    const result = sourceResult();
    result.errorCode = "TOOL_RESULT_ERROR";
    result.evidenceResult = "error";
    result.pass = false;
    result.responseDisposition = "not_evaluated";
    result.responseDispositionPassed = false;

    expect(liveEvalResultSchema.safeParse(result).success).toBe(true);
    result.responseDisposition = "answered";
    expect(liveEvalResultSchema.safeParse(result).success).toBe(false);
  });
});
