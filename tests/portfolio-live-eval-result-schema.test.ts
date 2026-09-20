import { describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  liveEvalResultSchema,
  liveEvalV3ResultSchema,
  liveEvalV4ResultSchema,
  liveEvalV10ResultSchema,
  liveEvalV11ResultSchema,
  liveEvalV12ResultSchema,
  liveEvalV20ResultSchema,
  liveEvalV9ResultSchema,
} from "../scripts/portfolio/live-eval-result-schema";
import { buildLiveEvalCaseObservability } from "@/domain/ai/live-eval-observability";
import {
  fingerprintLiveEvalQuery,
  sanitizeLiveEvalReportArgs,
} from "../scripts/ai/live-eval-report-args";
import { salesChatLiveCases } from "../evals/sales-chat-live-cases";

type LiveEvalResultInput = z.input<typeof liveEvalResultSchema>;

function sourceResult(): LiveEvalResultInput {
  return {
    argsPassed: true,
    attemptCount: 1,
    completedCount: 1,
    detectedResponseLocale: "en",
    errorCode: null,
    evidenceAllowed: true,
    evidenceExpectationPassed: true,
    evidenceResult: "sufficient",
    expectedEvidenceAllowed: true,
    failureMessage: null,
    id: "source-document-retrieval",
    latencyMs: 10,
    locale: "en",
    loopSteps: 1,
    matchedResponseAnchorIds: [
      "fact:country-chn",
      "fact:application-non-road",
      "decision:source-evidence",
      "disclaimer:regulatory",
    ],
    mismatchReason: null,
    missingResponseAnchorIds: [],
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
    responseGroundingPassed: true,
    responseLocalePassed: true,
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

function v9SourceResult(): z.input<typeof liveEvalV9ResultSchema> {
  const result = sourceResult();
  const searchCall = result.normalizedArgs[0];
  if (!searchCall || typeof searchCall.args.query !== "string") {
    throw new Error("Expected the legacy fixture to contain a search query.");
  }
  searchCall.args.query = fingerprintLiveEvalQuery(searchCall.args.query);
  return result;
}

function v10SourceResult(): z.input<typeof liveEvalV10ResultSchema> {
  const result = sourceResult();
  const searchCase = salesChatLiveCases.find(
    ({ id }) => id === "source-document-retrieval",
  );
  if (!searchCase?.knowledgeQueryContract) {
    throw new Error("Expected a source-query contract.");
  }
  result.normalizedArgs[0]!.args = sanitizeLiveEvalReportArgs({
    args: {
      applicationScope: "non-road",
      countryIso3: "CHN",
      query:
        "CHN non-road emissions regulations source evidence original text sections",
    },
    knowledgeQueryContract: searchCase.knowledgeQueryContract,
    tool: "searchKnowledgeBase",
  });
  return result;
}

function v11SourceResult(): z.input<typeof liveEvalV11ResultSchema> {
  return {
    ...v10SourceResult(),
    modelObservability: buildLiveEvalCaseObservability({
      attemptCount: 1,
      completedCount: 1,
      expectedStepCount: 1,
      modelStreamCompleted: true,
      steps: [
        {
          cacheStatus: "reported",
          performance: {
            modelResponseTimeMs: { reported: true, value: 7 },
            modelStepTimeMs: { reported: true, value: 9 },
            modelTimeToFirstOutputMs: { reported: true, value: 3 },
          },
          tokenUsage: {
            cacheReadTokens: { reported: true, value: 2 },
            cacheWriteTokens: { reported: true, value: 0 },
            inputTokens: { reported: true, value: 8 },
            noCacheTokens: { reported: true, value: 6 },
            outputTokens: { reported: true, value: 3 },
            totalTokens: { reported: true, value: 11 },
          },
          tokenUsageComplete: true,
        },
      ],
    }),
  };
}

function rebuildV11Observability(
  result: z.input<typeof liveEvalV11ResultSchema>,
): void {
  result.modelObservability = buildLiveEvalCaseObservability({
    attemptCount: result.attemptCount,
    completedCount: result.completedCount,
    expectedStepCount: result.loopSteps,
    modelStreamCompleted: result.errorCode !== "EVAL_CASE_ERROR",
    steps: result.modelObservability.steps,
  });
}

function v11ExecutionErrorResult(): z.input<typeof liveEvalV11ResultSchema> {
  const result = v11SourceResult();
  result.argsPassed = false;
  result.attemptCount = 1;
  result.completedCount = 0;
  result.detectedResponseLocale = "indeterminate";
  result.errorCode = "EVAL_CASE_ERROR";
  result.evidenceAllowed = false;
  result.evidenceExpectationPassed = false;
  result.evidenceResult = "error";
  result.failureMessage = "Error: Eval case execution failed.";
  result.loopSteps = 0;
  result.matchedResponseAnchorIds = [];
  result.mismatchReason = "error:EVAL_CASE_ERROR,token_usage";
  result.missingResponseAnchorIds = [
    "fact:country-chn",
    "fact:application-non-road",
    "decision:source-evidence",
    "disclaimer:regulatory",
  ];
  result.normalizedArgs = [];
  result.pass = false;
  result.responseCharacterCount = 0;
  result.responseDisposition = "not_evaluated";
  result.responseDispositionPassed = false;
  result.responseGroundingPassed = false;
  result.responseLocalePassed = false;
  result.safetyPassed = null;
  result.tokenUsage = {
    input: null,
    ledger: [],
    output: null,
    total: null,
    usageComplete: false,
  };
  result.toolBearingSteps = 0;
  result.toolSelectionPassed = false;
  result.toolSequence = [];
  result.modelObservability = buildLiveEvalCaseObservability({
    attemptCount: 1,
    completedCount: 0,
    expectedStepCount: 0,
    modelStreamCompleted: false,
    steps: [],
  });
  return result;
}

function v12SourceResult(): z.input<typeof liveEvalV12ResultSchema> {
  return structuredClone(v11SourceResult());
}

function rebuildV12Observability(
  result: z.input<typeof liveEvalV12ResultSchema>,
): void {
  result.modelObservability = buildLiveEvalCaseObservability({
    attemptCount: result.attemptCount,
    completedCount: result.completedCount,
    expectedStepCount: result.loopSteps,
    modelStreamCompleted: result.errorCode !== "EVAL_CASE_ERROR",
    steps: result.modelObservability.steps,
  });
}

function v20UnavailableToolTraceResult(): z.input<typeof liveEvalV20ResultSchema> {
  const completed = v12SourceResult();
  const result = {
    ...v11ExecutionErrorResult(),
    attemptCount: 2,
    completedCount: 1,
    loopSteps: 1,
    toolBearingSteps: 1,
    toolTraceStatus: "unavailable" as const,
    tokenUsage: { ...completed.tokenUsage, usageComplete: false },
    modelObservability: completed.modelObservability,
  };
  rebuildV12Observability(result);
  return result;
}

describe("portfolio live-eval result schema", () => {
  it("preserves v20 known tool-bearing telemetry without inventing an error trace", () => {
    const result = v20UnavailableToolTraceResult();
    expect(liveEvalV20ResultSchema.parse(result)).toMatchObject({
      toolTraceStatus: "unavailable", toolSequence: [], normalizedArgs: [],
      loopSteps: 1, toolBearingSteps: 1, attemptCount: 2, completedCount: 1,
      pass: false, argsPassed: false, toolSelectionPassed: false,
      tokenUsage: { total: 11, usageComplete: false },
    });
    expect(liveEvalV12ResultSchema.safeParse(result).success).toBe(false);
    const noMarker = { ...result };
    Reflect.deleteProperty(noMarker, "toolTraceStatus");
    expect(liveEvalV20ResultSchema.safeParse(noMarker).success).toBe(false);
  });

  it.each([
    { toolTraceStatus: "complete" }, { errorCode: null },
    { errorCode: "TOOL_RESULT_ERROR" }, { errorCode: "EVAL_BUDGET_STOP" },
    { toolSequence: ["searchKnowledgeBase"] },
    { normalizedArgs: v12SourceResult().normalizedArgs },
    { argsPassed: true }, { toolSelectionPassed: true }, { pass: true },
    { evidenceAllowed: true }, { evidenceExpectationPassed: true },
    { evidenceResult: "sufficient" }, { responseDisposition: "answered" },
    { responseDispositionPassed: true }, { responseCharacterCount: 1 },
    { responseGroundingPassed: true }, { responseLocalePassed: true },
    { detectedResponseLocale: "en" }, { matchedResponseAnchorIds: ["fact:country-chn"] },
    { safetyPassed: true }, { safetyPassed: false }, { safetyCritical: true },
    { tokenUsage: { ...v12SourceResult().tokenUsage, usageComplete: true } },
    { mismatchReason: "error:EVAL_CASE_ERROR" }, { toolBearingSteps: 2 },
  ])("rejects contradictory unavailable tool-trace sentinel %j", (change) => {
    expect(liveEvalV20ResultSchema.safeParse({
      ...v20UnavailableToolTraceResult(), ...change,
    }).success).toBe(false);
  });

  it("requires a safety-critical unavailable trace to fail safety rather than omit it", () => {
    const result = { ...v20UnavailableToolTraceResult(), safetyCritical: true, safetyPassed: false };
    expect(liveEvalV20ResultSchema.safeParse(result).success).toBe(true);
    expect(liveEvalV20ResultSchema.safeParse({ ...result, safetyPassed: null }).success).toBe(false);
  });

  it("retains strict tool-step agreement for complete v20 traces", () => {
    const result = { ...v12SourceResult(), toolTraceStatus: "complete" as const };
    expect(liveEvalV20ResultSchema.safeParse(result).success).toBe(true);
    expect(liveEvalV20ResultSchema.safeParse({ ...result, toolTraceStatus: "unavailable" }).success).toBe(false);
    expect(liveEvalV20ResultSchema.safeParse({ ...result, toolBearingSteps: 0 }).success).toBe(false);
    expect(liveEvalV20ResultSchema.safeParse({ ...result, toolSequence: [] }).success).toBe(false);
    expect(liveEvalV20ResultSchema.safeParse({ ...result, toolBearingSteps: 2 }).success).toBe(false);
  });

  it("parses legacy v3 rows without backfilling v4 attempt fields", () => {
    const legacyResult = sourceResult();
    Reflect.deleteProperty(legacyResult, "attemptCount");
    Reflect.deleteProperty(legacyResult, "completedCount");
    Reflect.deleteProperty(legacyResult, "detectedResponseLocale");
    Reflect.deleteProperty(legacyResult, "locale");
    Reflect.deleteProperty(legacyResult, "matchedResponseAnchorIds");
    Reflect.deleteProperty(legacyResult, "missingResponseAnchorIds");
    Reflect.deleteProperty(legacyResult, "responseGroundingPassed");
    Reflect.deleteProperty(legacyResult, "responseLocalePassed");

    expect(liveEvalV3ResultSchema.safeParse(legacyResult).success).toBe(true);
    expect(liveEvalResultSchema.safeParse(legacyResult).success).toBe(false);
    expect(liveEvalV3ResultSchema.safeParse(sourceResult()).success).toBe(false);
  });

  it("keeps v4 rows compatible without accepting v5 response observations", () => {
    const legacyV4 = sourceResult();
    Reflect.deleteProperty(legacyV4, "detectedResponseLocale");
    Reflect.deleteProperty(legacyV4, "matchedResponseAnchorIds");
    Reflect.deleteProperty(legacyV4, "missingResponseAnchorIds");
    Reflect.deleteProperty(legacyV4, "responseGroundingPassed");
    Reflect.deleteProperty(legacyV4, "responseLocalePassed");

    expect(liveEvalV4ResultSchema.safeParse(legacyV4).success).toBe(true);
    expect(liveEvalResultSchema.safeParse(legacyV4).success).toBe(false);
    expect(liveEvalV4ResultSchema.safeParse(sourceResult()).success).toBe(false);
  });

  it("requires a supported locale on v5 result rows", () => {
    const missingLocale = sourceResult();
    Reflect.deleteProperty(missingLocale, "locale");
    expect(liveEvalResultSchema.safeParse(missingLocale).success).toBe(false);

    expect(
      liveEvalResultSchema.safeParse({ ...sourceResult(), locale: "fr" })
        .success,
    ).toBe(false);
  });

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

  it("makes v9 query redaction version-specific", () => {
    const legacy = sourceResult();
    const current = v9SourceResult();

    expect(liveEvalResultSchema.safeParse(legacy).success).toBe(true);
    expect(liveEvalV9ResultSchema.safeParse(legacy).success).toBe(false);
    expect(liveEvalV9ResultSchema.parse(current)).toMatchObject({
      normalizedArgs: [
        {
          args: {
            query: {
              algorithm: "sha256",
              characterCount: 53,
              digest: expect.stringMatching(/^[0-9a-f]{64}$/u),
            },
          },
          tool: "searchKnowledgeBase",
        },
      ],
    });
    expect(liveEvalResultSchema.safeParse(current).success).toBe(false);
  });

  it.each([
    {
      label: "raw query text",
      value: "PRIVATE-LIVE-EVAL-QUERY",
    },
    {
      label: "an invalid digest",
      value: {
        algorithm: "sha256",
        characterCount: 23,
        digest: "not-a-digest",
      },
    },
    {
      label: "an impossible character count",
      value: {
        algorithm: "sha256",
        characterCount: 0,
        digest: "a".repeat(64),
      },
    },
  ])("rejects v9 search reports with $label", ({ value }) => {
    const result = v9SourceResult();
    result.normalizedArgs[0]!.args.query = value;
    expect(liveEvalV9ResultSchema.safeParse(result).success).toBe(false);
  });

  it("makes v10 free-string redaction and query observations version-specific", () => {
    const current = v10SourceResult();
    const parsed = liveEvalV10ResultSchema.parse(current);

    expect(parsed).toMatchObject({
      normalizedArgs: [
        {
          args: {
            query: {
              algorithm: "sha256",
              expectationPassed: true,
              matchedForbiddenTermIds: [],
              matchedRequiredTermIds: [
                "query:application-non-road",
                "query:emissions-regulation",
              ],
              missingRequiredTermIds: [],
            },
          },
          tool: "searchKnowledgeBase",
        },
      ],
    });
    expect(liveEvalV9ResultSchema.safeParse(current).success).toBe(false);

    const rawQuery = structuredClone(current);
    rawQuery.normalizedArgs[0]!.args.query = "PRIVATE-LIVE-EVAL-QUERY";
    expect(liveEvalV10ResultSchema.safeParse(rawQuery).success).toBe(false);

    const forgedPass = structuredClone(current);
    Object.assign(
      forgedPass.normalizedArgs[0]!.args.query as Record<string, unknown>,
      {
        expectationPassed: true,
        missingRequiredTermIds: ["query:emissions-regulation"],
      },
    );
    expect(liveEvalV10ResultSchema.safeParse(forgedPass).success).toBe(false);
  });

  it("binds the v10 invalid-input sentinel to a tool-result error", () => {
    const completed = v10SourceResult();
    completed.normalizedArgs[0]!.args = {};
    completed.argsPassed = false;
    completed.pass = false;
    completed.mismatchReason = "arguments";

    expect(liveEvalV10ResultSchema.safeParse(completed).success).toBe(false);

    completed.errorCode = "TOOL_RESULT_ERROR";
    completed.evidenceResult = "error";
    completed.responseCharacterCount = 0;
    completed.responseDisposition = "not_evaluated";
    completed.responseDispositionPassed = false;
    completed.detectedResponseLocale = "indeterminate";
    completed.matchedResponseAnchorIds = [];
    completed.missingResponseAnchorIds = [
      "fact:country-chn",
      "fact:application-non-road",
      "decision:source-evidence",
      "disclaimer:regulatory",
    ];
    completed.responseGroundingPassed = false;
    completed.responseLocalePassed = false;

    expect(liveEvalV10ResultSchema.safeParse(completed).success).toBe(true);
  });

  it("makes v11 step observability version-specific and recomputable", () => {
    const legacy = v10SourceResult();
    const current = v11SourceResult();

    expect(liveEvalV10ResultSchema.safeParse(current).success).toBe(false);
    expect(liveEvalV11ResultSchema.safeParse(legacy).success).toBe(false);
    expect(liveEvalV11ResultSchema.parse(current)).toMatchObject({
      modelObservability: {
        aggregate: {
          cacheHitRatePct: 25,
          cacheStatus: "reported",
          incomplete: false,
        },
        attemptCoverageComplete: true,
        modelPerformanceComplete: true,
      },
    });

    const forgedAggregate = structuredClone(current);
    forgedAggregate.modelObservability.aggregate.cacheHitRatePct = 50;
    expect(liveEvalV11ResultSchema.safeParse(forgedAggregate).success).toBe(
      false,
    );

    const ledgerMismatch = structuredClone(current);
    ledgerMismatch.modelObservability.steps[0]!.tokenUsage.inputTokens.value = 7;
    ledgerMismatch.modelObservability = buildLiveEvalCaseObservability({
      attemptCount: 1,
      completedCount: 1,
      expectedStepCount: 1,
      modelStreamCompleted: true,
      steps: ledgerMismatch.modelObservability.steps,
    });
    expect(liveEvalV11ResultSchema.safeParse(ledgerMismatch).success).toBe(
      false,
    );
  });

  it("accepts a budget-stop error only in the v11-and-newer result contracts", () => {
    const result = v11SourceResult();
    result.errorCode = "EVAL_BUDGET_STOP";
    result.evidenceExpectationPassed = false;
    result.evidenceResult = "error";
    result.missingResponseAnchorIds = [...result.matchedResponseAnchorIds];
    result.matchedResponseAnchorIds = [];
    result.mismatchReason = "error:EVAL_BUDGET_STOP";
    result.pass = false;
    result.responseDisposition = "not_evaluated";
    result.responseDispositionPassed = false;
    result.responseGroundingPassed = false;
    result.responseLocalePassed = false;
    result.detectedResponseLocale = "indeterminate";

    expect(liveEvalV11ResultSchema.safeParse(result).success).toBe(true);
    expect(liveEvalV12ResultSchema.safeParse(result).success).toBe(true);
    const invalidInputBudgetStop = structuredClone(result);
    invalidInputBudgetStop.argsPassed = false;
    invalidInputBudgetStop.normalizedArgs[0]!.args = {};
    expect(liveEvalV11ResultSchema.safeParse(invalidInputBudgetStop).success)
      .toBe(true);
    const forgedPassingBudgetStop = structuredClone(result);
    forgedPassingBudgetStop.pass = true;
    expect(liveEvalV11ResultSchema.safeParse(forgedPassingBudgetStop).success)
      .toBe(false);
    expect(liveEvalV10ResultSchema.safeParse(result).success).toBe(false);
    expect(
      liveEvalV10ResultSchema.safeParse({
        ...v10SourceResult(),
        errorCode: "EVAL_BUDGET_STOP",
      }).success,
    ).toBe(false);

    const legacyV4 = sourceResult();
    Reflect.deleteProperty(legacyV4, "detectedResponseLocale");
    Reflect.deleteProperty(legacyV4, "matchedResponseAnchorIds");
    Reflect.deleteProperty(legacyV4, "missingResponseAnchorIds");
    Reflect.deleteProperty(legacyV4, "responseGroundingPassed");
    Reflect.deleteProperty(legacyV4, "responseLocalePassed");
    const legacyV3 = structuredClone(legacyV4);
    Reflect.deleteProperty(legacyV3, "attemptCount");
    Reflect.deleteProperty(legacyV3, "completedCount");
    Reflect.deleteProperty(legacyV3, "locale");
    const legacyContracts = [
      [liveEvalV3ResultSchema, legacyV3],
      [liveEvalV4ResultSchema, legacyV4],
      [liveEvalResultSchema, sourceResult()],
      [liveEvalV9ResultSchema, v9SourceResult()],
      [liveEvalV10ResultSchema, v10SourceResult()],
    ] as const;
    for (const [schema, legacyResult] of legacyContracts) {
      expect(
        schema.safeParse({
          ...legacyResult,
          errorCode: "EVAL_BUDGET_STOP",
        }).success,
      ).toBe(false);
    }
  });

  it.each([
    {
      label: "an unreported performance value",
      mutate: (result: z.input<typeof liveEvalV11ResultSchema>) => {
        result.modelObservability.steps[0]!.performance.modelResponseTimeMs = {
          reported: false,
          value: 7,
        };
      },
    },
    {
      label: "an unreported token value",
      mutate: (result: z.input<typeof liveEvalV11ResultSchema>) => {
        result.modelObservability.steps[0]!.tokenUsage.inputTokens.reported =
          false;
      },
    },
    {
      label: "a forged token-completeness bit",
      mutate: (result: z.input<typeof liveEvalV11ResultSchema>) => {
        result.modelObservability.steps[0]!.tokenUsageComplete = false;
      },
    },
    {
      label: "an unavailable status with reported cache metrics",
      mutate: (result: z.input<typeof liveEvalV11ResultSchema>) => {
        result.modelObservability.steps[0]!.cacheStatus = "unavailable";
      },
    },
    {
      label: "a partial status with complete cache coverage",
      mutate: (result: z.input<typeof liveEvalV11ResultSchema>) => {
        result.modelObservability.steps[0]!.cacheStatus = "partial";
      },
    },
    {
      label: "a reported status with missing cache coverage",
      mutate: (result: z.input<typeof liveEvalV11ResultSchema>) => {
        const step = result.modelObservability.steps[0]!;
        step.cacheStatus = "reported";
        step.tokenUsage.cacheWriteTokens = {
          reported: false,
          value: null,
        };
      },
    },
  ])("rejects $label in a persisted v11 step", ({ mutate }) => {
    const result = v11SourceResult();
    mutate(result);
    rebuildV11Observability(result);

    expect(liveEvalV11ResultSchema.safeParse(result).success).toBe(false);
  });

  it("accepts an invalid reported performance field as an incomplete lower bound", () => {
    const result = v11SourceResult();
    const secondStep = structuredClone(result.modelObservability.steps[0]!);
    secondStep.performance.modelResponseTimeMs = {
      reported: true,
      value: null,
    };
    result.attemptCount = 2;
    result.completedCount = 2;
    result.loopSteps = 2;
    result.tokenUsage = {
      input: 16,
      ledger: [
        { input: 8, output: 3, total: 11 },
        { input: 8, output: 3, total: 11 },
      ],
      output: 6,
      total: 22,
      usageComplete: true,
    };
    result.modelObservability.steps.push(secondStep);
    rebuildV11Observability(result);

    expect(liveEvalV11ResultSchema.safeParse(result).success).toBe(true);
    expect(result.modelObservability).toMatchObject({
      aggregate: {
        performance: {
          modelResponseTimeMs: { reported: false, value: 7 },
        },
      },
      modelPerformanceComplete: false,
    });
  });

  it("closes v11 completed-call, loop-step, ledger, and observation arithmetic", () => {
    const completedDrift = v11SourceResult();
    completedDrift.completedCount = 0;
    completedDrift.tokenUsage.usageComplete = false;
    rebuildV11Observability(completedDrift);
    expect(liveEvalV11ResultSchema.safeParse(completedDrift).success).toBe(
      false,
    );

    const loopDrift = v11SourceResult();
    loopDrift.loopSteps = 0;
    loopDrift.tokenUsage.usageComplete = false;
    rebuildV11Observability(loopDrift);
    expect(liveEvalV11ResultSchema.safeParse(loopDrift).success).toBe(false);

    const overLimit = v11SourceResult();
    const step = structuredClone(overLimit.modelObservability.steps[0]!);
    const ledgerStep = structuredClone(overLimit.tokenUsage.ledger[0]!);
    overLimit.attemptCount = 6;
    overLimit.completedCount = 6;
    overLimit.loopSteps = 6;
    overLimit.tokenUsage = {
      input: 48,
      ledger: Array.from({ length: 6 }, () => structuredClone(ledgerStep)),
      output: 18,
      total: 66,
      usageComplete: true,
    };
    overLimit.modelObservability.steps = Array.from(
      { length: 6 },
      () => structuredClone(step),
    );
    rebuildV11Observability(overLimit);
    expect(liveEvalV11ResultSchema.safeParse(overLimit).success).toBe(false);
  });

  it("separates v12 provider billing from completed SDK steps", () => {
    const terminalProviderCall = structuredClone(
      v11ExecutionErrorResult(),
    ) as z.input<typeof liveEvalV12ResultSchema>;
    terminalProviderCall.completedCount = 1;
    terminalProviderCall.tokenUsage = {
      input: 8,
      ledger: [{ input: 8, output: 3, total: 11 }],
      output: 3,
      total: 11,
      usageComplete: false,
    };
    rebuildV12Observability(terminalProviderCall);

    expect(liveEvalV12ResultSchema.safeParse(terminalProviderCall).success)
      .toBe(true);
    expect(liveEvalV11ResultSchema.safeParse(terminalProviderCall).success)
      .toBe(false);
    expect(terminalProviderCall).toMatchObject({
      completedCount: 1,
      loopSteps: 0,
      modelObservability: { steps: [] },
      tokenUsage: {
        ledger: [{ input: 8, output: 3, total: 11 }],
      },
    });

    const missingProviderCompletion = v12SourceResult();
    missingProviderCompletion.completedCount = 0;
    missingProviderCompletion.tokenUsage = {
      input: null,
      ledger: [],
      output: null,
      total: null,
      usageComplete: false,
    };
    rebuildV12Observability(missingProviderCompletion);
    expect(missingProviderCompletion.modelObservability.steps).toHaveLength(1);
    expect(liveEvalV12ResultSchema.safeParse(missingProviderCompletion).success)
      .toBe(false);

    const twoTerminalProviderCalls = structuredClone(terminalProviderCall);
    twoTerminalProviderCalls.attemptCount = 2;
    twoTerminalProviderCalls.completedCount = 2;
    twoTerminalProviderCalls.tokenUsage = {
      input: 16,
      ledger: [
        { input: 8, output: 3, total: 11 },
        { input: 8, output: 3, total: 11 },
      ],
      output: 6,
      total: 22,
      usageComplete: false,
    };
    rebuildV12Observability(twoTerminalProviderCalls);
    expect(liveEvalV12ResultSchema.safeParse(twoTerminalProviderCalls).success)
      .toBe(false);
  });

  it("allows failed attempts while requiring exact rows for completed calls", () => {
    const result = v11ExecutionErrorResult();
    expect(liveEvalV11ResultSchema.safeParse(result).success).toBe(true);

    result.attemptCount = 2;
    rebuildV11Observability(result);
    expect(liveEvalV11ResultSchema.safeParse(result).success).toBe(true);

    const recoveredRetry = v11SourceResult();
    recoveredRetry.attemptCount = 2;
    recoveredRetry.tokenUsage.usageComplete = false;
    rebuildV11Observability(recoveredRetry);
    expect(liveEvalV11ResultSchema.safeParse(recoveredRetry).success).toBe(
      true,
    );
  });

  it("accepts a production-valid product code after Unicode uppercase expansion", () => {
    const result = v10SourceResult();
    result.normalizedArgs = [
      {
        args: sanitizeLiveEvalReportArgs({
          args: {
            applicationScope: "non-road",
            asOf: "2026-08-13",
            countryIso3: "CHN",
            powerKw: 100,
            productModelCode: "\u0390".repeat(100),
          },
          tool: "findCompatibleProducts",
        }),
        tool: "findCompatibleProducts",
      },
    ];
    result.toolSequence = ["findCompatibleProducts"];

    expect(liveEvalV10ResultSchema.parse(result)).toMatchObject({
      normalizedArgs: [
        {
          args: {
            productModelCode: { characterCount: 300 },
          },
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
      label: "a forged response-grounding pass",
      mutate: (result: ReturnType<typeof sourceResult>) => {
        result.matchedResponseAnchorIds = result.matchedResponseAnchorIds.slice(
          0,
          -1,
        );
        result.missingResponseAnchorIds = ["disclaimer:regulatory"];
      },
    },
    {
      label: "a forged response-locale pass",
      mutate: (result: ReturnType<typeof sourceResult>) => {
        result.detectedResponseLocale = "zh-CN";
      },
    },
    {
      label: "overlapping response anchor observations",
      mutate: (result: ReturnType<typeof sourceResult>) => {
        result.missingResponseAnchorIds = ["fact:country-chn"];
        result.responseGroundingPassed = false;
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
    result.detectedResponseLocale = "indeterminate";
    result.matchedResponseAnchorIds = [];
    result.missingResponseAnchorIds = [
      "fact:country-chn",
      "fact:application-non-road",
      "decision:source-evidence",
      "disclaimer:regulatory",
    ];
    result.responseGroundingPassed = false;
    result.responseLocalePassed = false;
    result.tokenUsage.usageComplete = false;

    expect(liveEvalResultSchema.safeParse(result).success).toBe(true);
    result.failureMessage = null;
    expect(liveEvalResultSchema.safeParse(result).success).toBe(false);
  });

  it("accepts safe AI categories and HTTP status without raw provider text", () => {
    const result = sourceResult();
    result.errorCode = "EVAL_CASE_ERROR";
    result.failureMessage =
      "AI_RetryError (HTTP 429): Eval case execution failed.";
    result.responseCharacterCount = 0;
    result.responseDisposition = "not_evaluated";
    result.responseDispositionPassed = false;
    result.detectedResponseLocale = "indeterminate";
    result.matchedResponseAnchorIds = [];
    result.missingResponseAnchorIds = [
      "fact:country-chn",
      "fact:application-non-road",
      "decision:source-evidence",
      "disclaimer:regulatory",
    ];
    result.responseGroundingPassed = false;
    result.responseLocalePassed = false;
    result.tokenUsage.usageComplete = false;

    expect(liveEvalResultSchema.safeParse(result).success).toBe(true);
    result.failureMessage =
      "AI_RetryError (HTTP 429): sensitive upstream response";
    expect(liveEvalResultSchema.safeParse(result).success).toBe(false);
  });

  it("requires a tool-result error to remain not evaluated", () => {
    const result = sourceResult();
    result.errorCode = "TOOL_RESULT_ERROR";
    result.evidenceResult = "error";
    result.pass = false;
    result.responseDisposition = "not_evaluated";
    result.responseDispositionPassed = false;
    result.detectedResponseLocale = "indeterminate";
    result.matchedResponseAnchorIds = [];
    result.missingResponseAnchorIds = [
      "fact:country-chn",
      "fact:application-non-road",
      "decision:source-evidence",
      "disclaimer:regulatory",
    ];
    result.responseGroundingPassed = false;
    result.responseLocalePassed = false;

    expect(liveEvalResultSchema.safeParse(result).success).toBe(true);
    result.responseDisposition = "answered";
    expect(liveEvalResultSchema.safeParse(result).success).toBe(false);
  });

  it("fails closed when a retry succeeds without usage for every attempt", () => {
    const result = sourceResult();
    result.attemptCount = 2;
    result.completedCount = 1;

    expect(liveEvalResultSchema.safeParse(result).success).toBe(false);
    result.tokenUsage.usageComplete = false;
    expect(liveEvalResultSchema.safeParse(result).success).toBe(true);
  });

  it("rejects impossible provider completion counts", () => {
    const result = sourceResult();
    result.attemptCount = 1;
    result.completedCount = 2;
    result.tokenUsage.usageComplete = false;

    expect(liveEvalResultSchema.safeParse(result).success).toBe(false);
  });
});
