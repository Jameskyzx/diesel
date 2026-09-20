import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedModelStepObservation } from "@/domain/ai/model-observability";
import { salesChatLiveCases } from "../evals/sales-chat-live-cases";
import type { FailedPublicResponseDiagnostic } from "../scripts/ai/live-eval-diagnostics";

type CapturedReport = {
  budget: {
    attemptCount: number;
    caseCount: number;
    completedCount: number;
    modelStepCount: number;
    tokenUsageComplete: boolean;
    totalTokens: number;
  };
  complete: boolean;
  evaluatedAt: string;
  modelId: string | null;
  provenance: {
    providerProfile: {
      adapter: string;
      adapterContractVersion: number;
      enableThinking: boolean | null;
      endpointSha256: string | null;
      includeUsage: boolean;
    } | null;
  };
  results: Array<{
    id: string;
    argsPassed: boolean;
    attemptCount: number;
    completedCount: number;
    errorCode: string | null;
    evidenceAllowed: boolean;
    evidenceResult: string;
    failureMessage: string | null;
    normalizedArgs: unknown[];
    pass: boolean;
    locale: "en" | "zh-CN";
    detectedResponseLocale: string;
    matchedResponseAnchorIds: string[];
    missingResponseAnchorIds: string[];
    responseCharacterCount: number;
    responseDisposition: string;
    responseGroundingPassed: boolean;
    responseLocalePassed: boolean;
    safetyPassed: boolean | null;
    toolSelectionPassed: boolean;
    tokenUsage: {
      ledger: Array<{
        input: number | null;
        output: number | null;
        total: number | null;
      }>;
      usageComplete: boolean;
    };
  }>;
  runId: string;
  runError: {
    code: string;
    errorName: string;
    stage: string;
  } | null;
  terminationReason: string;
  thresholdsPassed: boolean;
  version: string;
};

const harness = vi.hoisted(() => ({
  configuredModelId: "server-openai-compatible/unit-eval-model",
  configuredProviderProfile: {
    adapter: "@ai-sdk/openai-compatible" as
      | "@ai-sdk/openai-compatible"
      | "portfolio-demo",
    adapterContractVersion: 1 as number,
    enableThinking: false as boolean | null,
    endpointSha256: "a".repeat(64) as string | null,
    includeUsage: true,
  },
  // The expected binding is independent of both the selected real provider in
  // STATUS and configuredProviderProfile, which the drift tests mutate.
  expectedModelId: "server-openai-compatible/unit-eval-model",
  expectedProviderProfile: {
    adapter: "@ai-sdk/openai-compatible" as const,
    adapterContractVersion: 1 as const,
    enableThinking: false,
    endpointSha256: "a".repeat(64),
    includeUsage: true,
  },
  events: [] as string[],
  invalidateFinalReport: false,
  providerMaxRetries: [] as number[],
  providerRuns: 0,
  reports: [] as unknown[],
  publicResponses: new Map<string, string>(),
  statusParseFails: false,
  statusParseRuns: 0,
  scenario: "stream_error" as
    | "completed_public_quality_failure"
    | "provider_finish_tool_abort"
    | "stream_error"
    | "stream_timeout"
    | "tool_step_then_timeout"
    | "token_budget"
    | "tool_rejection",
}));

vi.mock("../scripts/ai/live-eval-report", async (importOriginal) => ({
  captureLiveEvalRepositoryState: () => ({
    baseHeadCommit: null,
    evaluatedCommit: null,
    worktreeState: "unavailable",
  }),
  captureLiveEvalSourceFingerprint: async () => ({
    algorithm: "sha256",
    digest: null,
    fileCount: null,
    status: "unavailable",
  }),
  liveEvalRunCanSucceed: (await importOriginal<typeof import("../scripts/ai/live-eval-report")>()).liveEvalRunCanSucceed,
  persistLiveEvalReport: async (_workspace: string, report: unknown) => {
    harness.reports.push(report);
    if (harness.scenario === "completed_public_quality_failure") {
      harness.events.push("report-persisted");
    }
    const identity = report as { evaluatedAt: string; runId: string };
    return {
      archivePath: "/tmp/ai-live-eval-archive.json",
      latestPath: "/tmp/ai-live-eval-latest.json",
      latestUpdated: true,
      reportReceipt: {
        byteLength: 1,
        evaluatedAt: identity.evaluatedAt,
        runId: identity.runId,
        sha256: "a".repeat(64),
      },
    };
  },
  reconcileLiveEvalRepositoryStates: (before: unknown) => before,
  reconcileLiveEvalSourceFingerprints: (before: unknown) => before,
  resolveLiveEvalLatestReportPath: () =>
    "/tmp/ai-live-eval-latest.json",
}));

vi.mock("../src/features/ai/schemas", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../src/features/ai/schemas")
  >();
  return {
    ...actual,
    aiToolResultSchema: {
      safeParse: (value: unknown) => harness.scenario === "completed_public_quality_failure"
        ? { success: true, data: value }
        : { success: false },
    },
  };
});

vi.mock("../scripts/portfolio/live-eval-report-schema", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../scripts/portfolio/live-eval-report-schema")
  >();
  return {
    ...actual,
    liveEvalReportSchema: {
      parse(value: unknown) {
        if (harness.invalidateFinalReport) {
          throw new Error("synthetic final report schema failure");
        }
        return actual.liveEvalReportSchema.parse(value);
      },
    },
  };
});

vi.mock("../src/server/ai/evidence-contract", async () => {
  const { salesChatLiveCases: cases } = await import("../evals/sales-chat-live-cases");
  return {
    buildSalesChatEvidenceContract: (input: { userTexts: readonly string[] }) => ({
      asOf: null,
      expectedEvidenceAllowed: cases.find(({ userTexts }) =>
        JSON.stringify(userTexts) === JSON.stringify(input.userTexts))?.expectedEvidenceAllowed ?? false,
    }),
    evidenceContractAllowsModelText: (contract: { expectedEvidenceAllowed?: boolean }) =>
      harness.scenario === "completed_public_quality_failure" && contract.expectedEvidenceAllowed === true,
  };
});

vi.mock("../scripts/portfolio/status-snapshot", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../scripts/portfolio/status-snapshot")
  >();
  return {
    ...actual,
    parseStatusSnapshot(markdown: string) {
      harness.events.push("status-contract");
      harness.statusParseRuns += 1;
      if (harness.statusParseFails) {
        throw new Error("synthetic STATUS parse failure");
      }
      const snapshot = actual.parseStatusSnapshot(markdown);
      return {
        ...snapshot,
        liveEval: {
          ...snapshot.liveEval,
          expectedModelId: harness.expectedModelId,
          expectedProviderProfile: { ...harness.expectedProviderProfile },
        },
      };
    },
  };
});

vi.mock("../src/server/ai/sales-chat", async () => {
  const { salesChatLiveCases: cases } = await import("../evals/sales-chat-live-cases");
  return {
  buildEvidenceGapResponse: () => "synthetic evidence-boundary response",
  createSalesChatTools: () => ({}),
  reconcileSalesChatProviderCallObservations: (input: {
    providerCalls: Array<{
      observability: NormalizedModelStepObservation;
      sequence: number;
      usage: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      };
    }>;
    steps: Array<{
      observability: NormalizedModelStepObservation;
      toolCallCount: number;
      usage: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      };
    }>;
  }) =>
    input.providerCalls.length === 0
      ? input.steps
      : input.providerCalls.map((call) => ({
          observability: call.observability,
          toolCallCount: input.steps[call.sequence]?.toolCallCount ?? 0,
          usage: call.usage,
        })),
  streamSalesChat: (input: {
    onModelCallMetrics: (metrics: {
      attemptCount: number;
      completedCount: number;
    }) => void;
    onProviderCallObservation: (observation: {
      observability: NormalizedModelStepObservation;
      sequence: number;
      usage: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      };
    }) => void;
    onStepMetrics: (step: {
      observability: NormalizedModelStepObservation;
      toolCallCount: number;
      usage: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      };
    }) => void;
    shouldStopAfterStep: (steps: Array<{
      observability: NormalizedModelStepObservation;
      toolCallCount: number;
      usage: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      };
    }>) => boolean;
    onStreamError: (error: unknown) => void;
    onBoundaryRejection: (reason: "invalid_input") => void;
    maxRetries: number;
    messages: readonly { content: string }[];
    runtimeContext: { utcDate: string };
  }) => {
    harness.events.push("provider-call");
    harness.providerRuns += 1;
    harness.providerMaxRetries.push(input.maxRetries);
    if (harness.scenario === "completed_public_quality_failure") {
      const testCase = cases.find(({ userTexts }) => JSON.stringify(userTexts) ===
        JSON.stringify(input.messages.map(({ content }) => content)));
      if (!testCase) throw new Error("Missing canonical case in public-response observer scenario");
      const toolCalls = testCase.expectedTools.map((toolName, index) => {
        const expected = testCase.expectedArgs[toolName] ?? {};
        return {
          input: {
            ...expected,
            ...(toolName === "getCountryProfile" && expected.asOf === undefined
              ? { asOf: input.runtimeContext.utcDate } : {}),
            ...(toolName === "searchKnowledgeBase" ? {
              query: `${testCase.knowledgeQueryContract?.required.map(({ anyOf }) => anyOf[0]).join(" ") ?? "source"} PRIVATE_OBSERVER_QUERY_MARKER`,
            } : {}),
          },
          toolCallId: `${testCase.id}-${index}`,
          toolName,
        };
      });
      const toolResults = toolCalls.map(({ toolCallId, toolName }) => ({
        output: {
          citations: [],
          evidenceSufficient: true,
          status: "ok",
          tool: toolName,
          privateToolField: "PRIVATE_OBSERVER_TOOL_MARKER",
          reasoning: "PRIVATE_OBSERVER_REASONING_MARKER",
        },
        toolCallId,
        toolName,
      }));
      const step = {
        observability: {
          cacheStatus: "unavailable" as const,
          performance: {
            modelResponseTimeMs: { reported: true, value: 8 },
            modelStepTimeMs: { reported: true, value: 10 },
            modelTimeToFirstOutputMs: { reported: true, value: 4 },
          },
          tokenUsage: {
            cacheReadTokens: { reported: false, value: null },
            cacheWriteTokens: { reported: false, value: null },
            inputTokens: { reported: true, value: 100 },
            noCacheTokens: { reported: false, value: null },
            outputTokens: { reported: true, value: 10 },
            totalTokens: { reported: true, value: 110 },
          },
          tokenUsageComplete: true,
        },
        toolCallCount: toolCalls.length,
        usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
      };
      input.onModelCallMetrics({ attemptCount: 1, completedCount: 1 });
      input.onProviderCallObservation({ observability: step.observability, sequence: 0, usage: step.usage });
      input.onStepMetrics(step);
      // This mocks the existing production PUBLIC result seam, not raw model
      // generation. Deliberately omit required business anchors; raw tool/query
      // markers elsewhere in the observation must never enter the callback.
      const responseText = testCase.expectedEvidenceAllowed
        ? `The public response for case ${testCase.id} is available for review.`
        : "synthetic evidence-boundary response";
      harness.publicResponses.set(testCase.id, responseText);
      return {
        steps: Promise.resolve([{ toolCalls, toolResults }]),
        text: Promise.resolve(responseText),
        toolCalls: Promise.resolve(toolCalls),
        toolResults: Promise.resolve(toolResults),
        usage: Promise.resolve(step.usage),
      };
    }
    if (harness.scenario === "stream_timeout") {
      input.onModelCallMetrics({ attemptCount: 1, completedCount: 0 });
      input.onStreamError(new DOMException(
        "private timeout reason https://sensitive.example/api?key=secret",
        "TimeoutError",
      ));
      return {
        steps: Promise.resolve([]),
        text: Promise.resolve().then(() => {
          throw { code: "AI_STREAM_FAILED" };
        }),
        toolCalls: Promise.resolve([]),
        toolResults: Promise.resolve([]),
        usage: Promise.resolve({
          inputTokens: undefined,
          outputTokens: undefined,
          totalTokens: undefined,
        }),
      };
    }
    if (harness.scenario === "provider_finish_tool_abort") {
      input.onModelCallMetrics({ attemptCount: 1, completedCount: 1 });
      input.onProviderCallObservation({
        observability: {
          cacheStatus: "unavailable",
          performance: {
            modelResponseTimeMs: { reported: true, value: 8 },
            modelStepTimeMs: { reported: false, value: null },
            modelTimeToFirstOutputMs: { reported: true, value: 4 },
          },
          tokenUsage: {
            cacheReadTokens: { reported: false, value: null },
            cacheWriteTokens: { reported: false, value: null },
            inputTokens: { reported: true, value: 100 },
            noCacheTokens: { reported: false, value: null },
            outputTokens: { reported: true, value: 10 },
            totalTokens: { reported: true, value: 110 },
          },
          tokenUsageComplete: true,
        },
        sequence: 0,
        usage: {
          inputTokens: 100,
          outputTokens: 10,
          totalTokens: 110,
        },
      });
      return {
        steps: Promise.resolve([]),
        text: Promise.resolve().then(() => {
          throw new DOMException("Aborted", "AbortError");
        }),
        toolCalls: Promise.resolve([]),
        toolResults: Promise.resolve([]),
        usage: Promise.resolve({
          inputTokens: undefined,
          outputTokens: undefined,
          totalTokens: undefined,
        }),
      };
    }
    if (harness.scenario === "token_budget") {
      const step = {
        observability: {
          cacheStatus: "unavailable" as const,
          performance: {
            modelResponseTimeMs: { reported: true, value: 8 },
            modelStepTimeMs: { reported: true, value: 10 },
            modelTimeToFirstOutputMs: { reported: true, value: 4 },
          },
          tokenUsage: {
            cacheReadTokens: { reported: false, value: null },
            cacheWriteTokens: { reported: false, value: null },
            inputTokens: { reported: true, value: 159_999 },
            noCacheTokens: { reported: false, value: null },
            outputTokens: { reported: true, value: 1 },
            totalTokens: { reported: true, value: 160_000 },
          },
          tokenUsageComplete: true,
        },
        toolCallCount: 1,
        usage: {
          inputTokens: 159_999,
          outputTokens: 1,
          totalTokens: 160_000,
        },
      };
      input.onModelCallMetrics({ attemptCount: 1, completedCount: 1 });
      input.onProviderCallObservation({
        observability: step.observability,
        sequence: 0,
        usage: step.usage,
      });
      input.onStepMetrics(step);
      if (!input.shouldStopAfterStep([step])) {
        throw new Error("The case budget hook did not stop the next call.");
      }
      const toolCall = {
        input: {
          asOf: "2026-08-13",
          countryIso3: "CHN",
          topics: ["country"],
        },
        toolName: "getCountryProfile",
      };
      return {
        steps: Promise.resolve([{ toolCalls: [toolCall] }]),
        text: Promise.resolve("budget-limited response"),
        toolCalls: Promise.resolve([toolCall]),
        toolResults: Promise.resolve([{ output: {} }]),
        usage: Promise.resolve({
          inputTokens: 159_999,
          outputTokens: 1,
          totalTokens: 160_000,
        }),
      };
    }
    if (harness.scenario === "tool_rejection") {
      const step = {
        observability: {
          cacheStatus: "unavailable" as const,
          performance: {
            modelResponseTimeMs: { reported: true, value: 8 },
            modelStepTimeMs: { reported: true, value: 10 },
            modelTimeToFirstOutputMs: { reported: true, value: 4 },
          },
          tokenUsage: {
            cacheReadTokens: { reported: false, value: null },
            cacheWriteTokens: { reported: false, value: null },
            inputTokens: { reported: true, value: 7 },
            noCacheTokens: { reported: false, value: null },
            outputTokens: { reported: true, value: 4 },
            totalTokens: { reported: true, value: 11 },
          },
          tokenUsageComplete: true,
        },
        toolCallCount: 0,
        usage: {
          inputTokens: 7,
          outputTokens: 4,
          totalTokens: 11,
        },
      };
      input.onModelCallMetrics({ attemptCount: 1, completedCount: 1 });
      input.onProviderCallObservation({
        observability: step.observability,
        sequence: 0,
        usage: step.usage,
      });
      input.onStepMetrics(step);
      input.onBoundaryRejection("invalid_input");
      return {
        steps: Promise.resolve([{ toolCalls: [] }]),
        text: Promise.resolve("fallback text that must not be scored"),
        toolCalls: Promise.resolve([]),
        toolResults: Promise.resolve([]),
        usage: Promise.resolve({
          inputTokens: 7,
          outputTokens: 4,
          totalTokens: 11,
        }),
      };
    }
    const step = {
      observability: {
        cacheStatus: "unavailable" as const,
        performance: {
          modelResponseTimeMs: { reported: true, value: 8 },
          modelStepTimeMs: { reported: true, value: 10 },
          modelTimeToFirstOutputMs: { reported: true, value: 4 },
        },
        tokenUsage: {
          cacheReadTokens: { reported: false, value: null },
          cacheWriteTokens: { reported: false, value: null },
          inputTokens: { reported: true, value: 100 },
          noCacheTokens: { reported: false, value: null },
          outputTokens: { reported: true, value: 10 },
          totalTokens: { reported: true, value: 110 },
        },
        tokenUsageComplete: true,
      },
      toolCallCount: harness.scenario === "tool_step_then_timeout" ? 1 : 0,
      usage: {
        inputTokens: 100,
        outputTokens: 10,
        totalTokens: 110,
      },
    };
    input.onModelCallMetrics({
      attemptCount: harness.scenario === "tool_step_then_timeout" ? 2 : 1,
      completedCount: 1,
    });
    input.onProviderCallObservation({
      observability: step.observability,
      sequence: 0,
      usage: step.usage,
    });
    input.onStepMetrics(step);
    input.onStreamError(harness.scenario === "tool_step_then_timeout"
      ? new DOMException("private timeout after completed tool step", "TimeoutError")
      : new Error("private upstream failure detail"));
    return {
      steps: Promise.resolve([]),
      text: Promise.resolve("fallback text that must not be scored"),
      toolCalls: Promise.resolve([]),
      toolResults: Promise.resolve([]),
      usage: Promise.resolve({
        inputTokens: 100,
        outputTokens: 10,
        totalTokens: 110,
      }),
    };
  },
  };
});

vi.mock("../src/server/ai/model", () => {
  class AiConfigurationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "AiConfigurationError";
    }
  }

  return {
    AiConfigurationError,
    getConfiguredAiModel: () => ({
      model: {},
      modelId: harness.configuredModelId,
      providerProfile: { ...harness.configuredProviderProfile },
    }),
  };
});

vi.mock("../src/server/db/demo-client", () => ({
  getDemoDatabase: async () => ({}),
}));

let originalBeforeExitListeners = process.listeners("beforeExit");

beforeEach(() => {
  originalBeforeExitListeners = process.listeners("beforeExit");
});

afterEach(() => {
  // runLiveEval intentionally restores its failing exit code at beforeExit;
  // remove only callbacks created by this test, not other process listeners.
  for (const listener of process.listeners("beforeExit")) {
    if (!originalBeforeExitListeners.includes(listener)) {
      process.removeListener("beforeExit", listener);
    }
  }
  harness.configuredModelId = "server-openai-compatible/unit-eval-model";
  harness.expectedModelId = "server-openai-compatible/unit-eval-model";
  harness.configuredProviderProfile.adapter = "@ai-sdk/openai-compatible";
  harness.configuredProviderProfile.adapterContractVersion = 1;
  harness.configuredProviderProfile.enableThinking = false;
  harness.configuredProviderProfile.endpointSha256 = "a".repeat(64);
  harness.configuredProviderProfile.includeUsage = true;
  harness.events.length = 0;
  harness.reports.length = 0;
  harness.publicResponses.clear();
  harness.invalidateFinalReport = false;
  harness.providerMaxRetries.length = 0;
  harness.providerRuns = 0;
  harness.scenario = "stream_error";
  harness.statusParseFails = false;
  harness.statusParseRuns = 0;
  process.exitCode = undefined;
});

describe("live eval runner stream failures", () => {
  it("reaches the observed stream error with an independently selected matching model", async () => {
    harness.expectedModelId = "server-openai-compatible/another-unit-model";
    harness.configuredModelId = harness.expectedModelId;
    const { runLiveEval } = await import("../scripts/ai/live-eval");

    await runLiveEval();

    expect(harness.providerRuns).toBe(1);
    expect(harness.reports[0] as CapturedReport).toMatchObject({
      modelId: harness.expectedModelId,
      runError: null,
      terminationReason: "case_error",
      thresholdsPassed: false,
    });
  });

  it.each([
    {
      drift: () => {
        harness.configuredModelId =
          "server-openai-compatible/unapproved-model";
      },
      field: "modelId",
    },
    {
      drift: () => {
        harness.configuredProviderProfile.adapter = "portfolio-demo";
      },
      field: "adapter",
    },
    {
      drift: () => {
        harness.configuredProviderProfile.adapterContractVersion = 2;
      },
      field: "adapterContractVersion",
    },
    {
      drift: () => {
        harness.configuredProviderProfile.enableThinking = true;
      },
      field: "enableThinking",
    },
    {
      drift: () => {
        harness.configuredProviderProfile.endpointSha256 = "b".repeat(64);
      },
      field: "endpointSha256",
    },
    {
      drift: () => {
        harness.configuredProviderProfile.includeUsage = false;
      },
      field: "includeUsage",
    },
  ])(
    "fails closed before the provider boundary when $field drifts from STATUS",
    async ({ drift }) => {
      drift();
      const onProviderMayStart = vi.fn(async () => undefined);
      const { runLiveEval } = await import("../scripts/ai/live-eval");

      await runLiveEval({ onProviderMayStart });

      expect(onProviderMayStart).not.toHaveBeenCalled();
      expect(harness.providerRuns).toBe(0);
      expect(harness.events).toEqual(["status-contract"]);
      expect(harness.statusParseRuns).toBe(1);
      expect(harness.reports).toHaveLength(1);
      expect(harness.reports[0] as CapturedReport).toMatchObject({
        budget: {
          attemptCount: 0,
          caseCount: 0,
          completedCount: 0,
          modelStepCount: 0,
          tokenUsageComplete: false,
          totalTokens: 0,
        },
        complete: false,
        modelId: null,
        provenance: { providerProfile: null },
        results: [],
        runError: {
          code: "INITIALIZATION_ERROR",
          errorName: "AiConfigurationError",
          stage: "model_configuration",
        },
        terminationReason: "initialization_error",
        thresholdsPassed: false,
      });
      expect(process.exitCode).toBe(1);
    },
  );

  it("normalizes an invalid STATUS contract before the provider boundary", async () => {
    harness.statusParseFails = true;
    const onProviderMayStart = vi.fn(async () => undefined);
    const { runLiveEval } = await import("../scripts/ai/live-eval");

    await runLiveEval({ onProviderMayStart });

    expect(harness.statusParseRuns).toBe(1);
    expect(onProviderMayStart).not.toHaveBeenCalled();
    expect(harness.providerRuns).toBe(0);
    expect(harness.reports).toHaveLength(1);
    expect(harness.reports[0] as CapturedReport).toMatchObject({
      budget: {
        attemptCount: 0,
        caseCount: 0,
        completedCount: 0,
        modelStepCount: 0,
        tokenUsageComplete: false,
        totalTokens: 0,
      },
      complete: false,
      modelId: null,
      provenance: { providerProfile: null },
      results: [],
      runError: {
        code: "INITIALIZATION_ERROR",
        errorName: "AiConfigurationError",
        stage: "model_configuration",
      },
      terminationReason: "initialization_error",
      thresholdsPassed: false,
    });
    expect(process.exitCode).toBe(1);
  });

  it("does not persist or exit successfully when final report parsing fails", async () => {
    harness.invalidateFinalReport = true;
    const { runLiveEval } = await import("../scripts/ai/live-eval");

    await expect(runLiveEval()).rejects.toThrow(
      "synthetic final report schema failure",
    );
    expect(harness.reports).toHaveLength(0);
  });

  it("does not score fallback text after an observed provider error", async () => {
    const { runLiveEval } = await import("../scripts/ai/live-eval");

    await runLiveEval();

    expect(harness.reports).toHaveLength(1);
    const report = harness.reports[0] as CapturedReport;
    expect(report).toMatchObject({
      budget: {
        attemptCount: 1,
        completedCount: 1,
        tokenUsageComplete: false,
        totalTokens: 110,
      },
      complete: false,
      observability: {
        cacheStatusCounts: { unavailable: 1 },
        caseCounts: {
          attemptCoverageComplete: 0,
          attemptCoverageIncomplete: 1,
          modelPerformanceComplete: 0,
          modelPerformanceIncomplete: 1,
          total: 1,
        },
      },
      terminationReason: "case_error",
      thresholdsPassed: false,
      version: "sales-chat-live-v25",
    });
    expect(report.results).toHaveLength(1);
    expect(report.results[0]).toMatchObject({
      attemptCount: 1,
      completedCount: 1,
      errorCode: "EVAL_CASE_ERROR",
      failureMessage: "Error: Eval case execution failed.",
      normalizedArgs: [],
      modelObservability: {
        aggregate: {
          cacheHitRatePct: null,
          cacheStatus: "unavailable",
          incomplete: true,
        },
        attemptCoverageComplete: false,
        modelPerformanceComplete: false,
      },
      pass: false,
      responseCharacterCount: 0,
      responseDisposition: "not_evaluated",
      safetyPassed: null,
      tokenUsage: {
        ledger: [{ input: 100, output: 10, total: 110 }],
        usageComplete: false,
      },
    });
    expect(JSON.stringify(report)).not.toContain(
      "private upstream failure detail",
    );
    expect(JSON.stringify(report)).not.toContain(
      "fallback text that must not be scored",
    );
  });

  it("preserves an observed timeout as an incomplete case error without retrying", async () => {
    harness.scenario = "stream_timeout";
    const { runLiveEval } = await import("../scripts/ai/live-eval");

    await runLiveEval();

    expect(harness.providerRuns).toBe(1);
    expect(harness.providerMaxRetries).toEqual([0]);
    expect(harness.reports).toHaveLength(1);
    const report = harness.reports[0] as CapturedReport;
    expect(report).toMatchObject({
      budget: {
        attemptCount: 1,
        caseCount: 1,
        completedCount: 0,
        modelStepCount: 0,
        tokenUsageComplete: false,
        totalTokens: 0,
      },
      complete: false,
      runError: null,
      terminationReason: "case_error",
      thresholdsPassed: false,
      version: "sales-chat-live-v25",
    });
    expect(report.results).toHaveLength(1);
    expect(report.results[0]).toMatchObject({
      attemptCount: 1,
      completedCount: 0,
      errorCode: "EVAL_CASE_ERROR",
      evidenceResult: "error",
      failureMessage: "TimeoutError: Eval case execution failed.",
      loopSteps: 0,
      normalizedArgs: [],
      pass: false,
      responseCharacterCount: 0,
      responseDisposition: "not_evaluated",
      safetyPassed: null,
      tokenUsage: {
        input: null,
        ledger: [],
        output: null,
        total: null,
        usageComplete: false,
      },
    });
    expect(JSON.stringify(report)).not.toMatch(/private|sensitive|secret/u);
  });

  it("preserves known tool-bearing steps when a later timeout makes the complete tool trace unavailable", async () => {
    harness.scenario = "tool_step_then_timeout";
    const { runLiveEval } = await import("../scripts/ai/live-eval");
    await runLiveEval();
    expect(harness.providerRuns).toBe(1);
    expect(harness.providerMaxRetries).toEqual([0]);
    expect(harness.reports).toHaveLength(1);
    const report = harness.reports[0] as CapturedReport;
    expect(report).toMatchObject({
      version: "sales-chat-live-v25",
      complete: false,
      terminationReason: "case_error",
      thresholdsPassed: false,
      budget: { attemptCount: 2, completedCount: 1, modelStepCount: 1, totalTokens: 110, tokenUsageComplete: false },
    });
    expect(report.results[0]).toMatchObject({
      toolTraceStatus: "unavailable",
      loopSteps: 1,
      toolBearingSteps: 1,
      toolSequence: [],
      normalizedArgs: [],
      argsPassed: false,
      toolSelectionPassed: false,
      errorCode: "EVAL_CASE_ERROR",
      failureMessage: "TimeoutError: Eval case execution failed.",
      responseCharacterCount: 0,
      responseDisposition: "not_evaluated",
      pass: false,
      safetyPassed: null,
      tokenUsage: { ledger: [{ input: 100, output: 10, total: 110 }], usageComplete: false },
    });
    expect(JSON.stringify(report)).not.toContain("private timeout after completed tool step");
    expect(JSON.stringify(report)).not.toContain("fallback text that must not be scored");
    expect(process.exitCode).toBe(1);
  });

  it("retains provider-finished usage when a tool abort prevents onStepEnd", async () => {
    harness.scenario = "provider_finish_tool_abort";
    const { runLiveEval } = await import("../scripts/ai/live-eval");

    await runLiveEval();

    expect(harness.reports).toHaveLength(1);
    const report = harness.reports[0] as CapturedReport;
    expect(report).toMatchObject({
      budget: {
        attemptCount: 1,
        completedCount: 1,
        modelStepCount: 0,
        tokenUsageComplete: false,
        totalTokens: 110,
      },
      complete: false,
      terminationReason: "case_error",
      thresholdsPassed: false,
    });
    expect(report.results).toHaveLength(1);
    expect(report.results[0]).toMatchObject({
      attemptCount: 1,
      completedCount: 1,
      errorCode: "EVAL_CASE_ERROR",
      loopSteps: 0,
      modelObservability: {
        aggregate: {
          completedStepCount: 0,
          incomplete: true,
          tokenUsage: {
            inputTokens: { reported: false, value: null },
            outputTokens: { reported: false, value: null },
            totalTokens: { reported: false, value: null },
          },
        },
        attemptCoverageComplete: false,
        modelPerformanceComplete: false,
        steps: [],
      },
      pass: false,
      tokenUsage: {
        input: 100,
        ledger: [{ input: 100, output: 10, total: 110 }],
        output: 10,
        total: 110,
        usageComplete: false,
      },
    });
  });

  it("records a production tool-boundary rejection as a tool-result error", async () => {
    harness.scenario = "tool_rejection";
    const { runLiveEval } = await import("../scripts/ai/live-eval");

    await runLiveEval();

    expect(harness.reports).toHaveLength(1);
    const report = harness.reports[0] as CapturedReport;
    expect(report).toMatchObject({
      budget: {
        attemptCount: 18,
        completedCount: 18,
        tokenUsageComplete: true,
        totalTokens: 198,
      },
      complete: true,
      observability: {
        cacheStatusCounts: { unavailable: 18 },
        caseCounts: {
          attemptCoverageComplete: 18,
          attemptCoverageIncomplete: 0,
          modelPerformanceComplete: 18,
          modelPerformanceIncomplete: 0,
          total: 18,
        },
      },
      terminationReason: "completed",
      thresholdsPassed: false,
      version: "sales-chat-live-v25",
    });
    expect(report.results).toHaveLength(18);
    expect(report.results[0]).toMatchObject({
      argsPassed: false,
      attemptCount: 1,
      completedCount: 1,
      errorCode: "TOOL_RESULT_ERROR",
      failureMessage: null,
      normalizedArgs: [],
      modelObservability: {
        aggregate: {
          cacheHitRatePct: null,
          cacheStatus: "unavailable",
          incomplete: false,
        },
        attemptCoverageComplete: true,
        modelPerformanceComplete: true,
      },
      pass: false,
      responseCharacterCount: 37,
      responseDisposition: "not_evaluated",
      tokenUsage: {
        ledger: [{ input: 7, output: 4, total: 11 }],
        usageComplete: true,
      },
    });
    expect(JSON.stringify(report)).not.toContain(
      "fallback text that must not be scored",
    );
  });

  it("maps an in-case budget stop to the run termination reason", async () => {
    harness.scenario = "token_budget";
    const { runLiveEval } = await import("../scripts/ai/live-eval");

    await runLiveEval({
      onProviderMayStart: async () => {
        harness.events.push("provider-boundary");
      },
    });

    expect(harness.providerRuns).toBe(1);
    expect(harness.events).toEqual([
      "status-contract",
      "provider-boundary",
      "provider-call",
    ]);
    expect(harness.reports).toHaveLength(1);
    const report = harness.reports[0] as CapturedReport;
    expect(report).toMatchObject({
      budget: {
        attemptCount: 1,
        completedCount: 1,
        tokenUsageComplete: true,
        totalTokens: 160_000,
      },
      complete: false,
      terminationReason: "token_limit_exceeded",
      thresholdsPassed: false,
    });
    expect(report.results).toHaveLength(1);
    expect(report.results[0]).toMatchObject({
      errorCode: "EVAL_BUDGET_STOP",
      evidenceResult: "error",
      normalizedArgs: [
        {
          args: {
            asOf: "2026-08-13",
            countryIso3: "CHN",
            topics: ["country"],
          },
          tool: "getCountryProfile",
        },
      ],
      pass: false,
      responseDisposition: "not_evaluated",
      tokenUsage: {
        ledger: [{ input: 159_999, output: 1, total: 160_000 }],
        usageComplete: true,
      },
    });
    expect(JSON.stringify(report)).not.toContain("budget-limited response");
  });
});

describe("same-run failed public response diagnostics", () => {
  const eligibleCases = salesChatLiveCases.filter((testCase) =>
    testCase.expectedEvidenceAllowed && !testCase.safetyCritical);

  it("observes only the completed public response after the failed report has been persisted", async () => {
    harness.scenario = "completed_public_quality_failure";
    const diagnostics: FailedPublicResponseDiagnostic[] = [];
    const callbackState: Array<{
      event: string | undefined;
      exitCode: typeof process.exitCode;
      providerRuns: number;
      reportCount: number;
    }> = [];
    const { runLiveEval } = await import("../scripts/ai/live-eval");

    const returned = await runLiveEval({
      onFailedPublicResponse: (diagnostic) => {
        diagnostics.push(diagnostic);
        callbackState.push({
          event: harness.events.at(-1),
          exitCode: process.exitCode,
          providerRuns: harness.providerRuns,
          reportCount: harness.reports.length,
        });
        return undefined;
      },
    });

    expect(harness.reports).toHaveLength(1);
    const report = harness.reports[0] as CapturedReport;
    expect(report).toMatchObject({
      budget: {
        attemptCount: 18,
        caseCount: 18,
        completedCount: 18,
        modelStepCount: 18,
        tokenUsageComplete: true,
        totalTokens: 1980,
      },
      complete: true,
      runError: null,
      terminationReason: "completed",
      thresholdsPassed: false,
    });
    expect(report.results).toHaveLength(18);
    expect(returned.observations).toBeNull();
    expect(harness.providerRuns).toBe(18);
    expect(harness.providerMaxRetries).toEqual(Array.from({ length: 18 }, () => 0));
    expect(diagnostics.map(({ caseId }) => caseId)).toEqual(eligibleCases.map(({ id }) => id));
    expect(callbackState).toEqual(eligibleCases.map(() => ({
      event: "report-persisted",
      exitCode: 1,
      providerRuns: 18,
      reportCount: 1,
    })));
    for (const diagnostic of diagnostics) {
      const row = report.results.find(({ id }) => id === diagnostic.caseId);
      expect(row).toMatchObject({
        argsPassed: true,
        errorCode: null,
        evidenceAllowed: true,
        pass: false,
        responseDisposition: "answered",
        responseGroundingPassed: false,
        toolSelectionPassed: true,
      });
      expect(diagnostic).toEqual({
        argsPassed: row?.argsPassed,
        caseId: row?.id,
        detectedResponseLocale: row?.detectedResponseLocale,
        expectedLocale: row?.locale,
        matchedResponseAnchorIds: row?.matchedResponseAnchorIds,
        missingResponseAnchorIds: row?.missingResponseAnchorIds,
        reportSha256: returned.reportReceipt.sha256,
        responseDisposition: row?.responseDisposition,
        responseGroundingPassed: row?.responseGroundingPassed,
        responseLocalePassed: row?.responseLocalePassed,
        responseText: harness.publicResponses.get(diagnostic.caseId),
        runId: report.runId,
        toolSelectionPassed: row?.toolSelectionPassed,
      });
      expect(row?.responseCharacterCount).toBe(diagnostic.responseText.length);
      expect(diagnostic.reportSha256).toBe("a".repeat(64));
      expect(JSON.stringify(report)).not.toContain(diagnostic.responseText);
    }
    expect(diagnostics.some(({ expectedLocale, responseLocalePassed }) =>
      expectedLocale === "zh-CN" && !responseLocalePassed)).toBe(true);
    expect(JSON.stringify(diagnostics)).not.toMatch(/PRIVATE_OBSERVER_(?:QUERY|TOOL|REASONING)_MARKER/u);
    expect(JSON.stringify(report)).not.toMatch(/PRIVATE_OBSERVER_(?:QUERY|TOOL|REASONING)_MARKER/u);
    expect(process.exitCode).toBe(1);
  });

  it("keeps reports, provider calls, token ledgers and failure exits identical with observation off or on", async () => {
    harness.scenario = "completed_public_quality_failure";
    // Only wall-clock measurement is held constant; run identities/timestamps
    // are the sole excluded report fields below, not scoring or billing data.
    const now = vi.spyOn(performance, "now").mockReturnValue(100);
    const canonicalReport = (report: unknown): unknown => JSON.parse(JSON.stringify(
      report,
      (key, value: unknown) => ["runId", "evaluatedAt", "runtimeContext"].includes(key)
        ? undefined : value,
    ));
    const { runLiveEval } = await import("../scripts/ai/live-eval");
    try {
      const withoutObserver = await runLiveEval();
      const baseline = {
        exitCode: process.exitCode,
        providerMaxRetries: [...harness.providerMaxRetries],
        providerRuns: harness.providerRuns,
        report: canonicalReport(harness.reports[0]),
      };
      harness.events.length = 0;
      harness.reports.length = 0;
      harness.providerRuns = 0;
      harness.providerMaxRetries.length = 0;
      harness.publicResponses.clear();
      process.exitCode = undefined;
      const observed = vi.fn<(_diagnostic: FailedPublicResponseDiagnostic) => undefined>(() => undefined);

      const withObserver = await runLiveEval({ onFailedPublicResponse: observed });

      expect({
        exitCode: process.exitCode,
        providerMaxRetries: [...harness.providerMaxRetries],
        providerRuns: harness.providerRuns,
        report: canonicalReport(harness.reports[0]),
      }).toEqual(baseline);
      expect(observed).toHaveBeenCalledTimes(eligibleCases.length);
      expect(withoutObserver.observations).toBeNull();
      expect(withObserver.observations).toBeNull();
      expect(withObserver.reportReceipt.sha256).toBe(withoutObserver.reportReceipt.sha256);
      expect(baseline.exitCode).toBe(1);
      expect(baseline.providerRuns).toBe(18);
    } finally {
      now.mockRestore();
    }
  });

  it("isolates callback throws and payload mutation without logging raw diagnostic errors", async () => {
    harness.scenario = "completed_public_quality_failure";
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const attempts: Array<{
      anchorsFrozen: boolean;
      caseIdChanged: boolean;
      matchedChanged: boolean;
      missingChanged: boolean;
      payloadFrozen: boolean;
      reportBeforeCallback: string;
    }> = [];
    const { runLiveEval } = await import("../scripts/ai/live-eval");
    try {
      const returned = await runLiveEval({
        onFailedPublicResponse: (diagnostic): undefined => {
          attempts.push({
            anchorsFrozen: Object.isFrozen(diagnostic.matchedResponseAnchorIds) &&
              Object.isFrozen(diagnostic.missingResponseAnchorIds),
            caseIdChanged: Reflect.set(diagnostic, "caseId", "MUTATED"),
            matchedChanged: Reflect.set(diagnostic.matchedResponseAnchorIds, "0", "MUTATED"),
            missingChanged: Reflect.set(diagnostic.missingResponseAnchorIds, "0", "MUTATED"),
            payloadFrozen: Object.isFrozen(diagnostic),
            reportBeforeCallback: JSON.stringify(harness.reports[0]),
          });
          throw new Error("PRIVATE_OBSERVER_THROW_MARKER");
        },
      });

      expect(attempts).toHaveLength(eligibleCases.length);
      expect(attempts).toEqual(eligibleCases.map(() => ({
        anchorsFrozen: true,
        caseIdChanged: false,
        matchedChanged: false,
        missingChanged: false,
        payloadFrozen: true,
        reportBeforeCallback: JSON.stringify(harness.reports[0]),
      })));
      expect(returned.observations).toBeNull();
      expect(harness.reports[0]).toMatchObject({
        budget: { attemptCount: 18, completedCount: 18, totalTokens: 1980 },
        complete: true,
        thresholdsPassed: false,
      });
      expect(harness.providerRuns).toBe(18);
      expect(process.exitCode).toBe(1);
      const capturedOutput = JSON.stringify([stdout.mock.calls, stderr.mock.calls]);
      expect(capturedOutput).not.toContain("PRIVATE_OBSERVER");
      for (const publicText of harness.publicResponses.values()) {
        expect(capturedOutput).not.toContain(publicText);
      }
      expect(JSON.stringify(harness.reports[0])).not.toContain("MUTATED");
      expect(JSON.stringify(harness.reports[0])).not.toContain("PRIVATE_OBSERVER");
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });

  it.each([
    "stream_error",
    "stream_timeout",
    "provider_finish_tool_abort",
    "tool_step_then_timeout",
    "token_budget",
    "tool_rejection",
  ] as const)("does not observe public diagnostics after %s", async (scenario) => {
    harness.scenario = scenario;
    const observed = vi.fn<(_diagnostic: FailedPublicResponseDiagnostic) => undefined>(() => undefined);
    const { runLiveEval } = await import("../scripts/ai/live-eval");

    const returned = await runLiveEval({ onFailedPublicResponse: observed });

    expect(observed).not.toHaveBeenCalled();
    expect(harness.reports).toHaveLength(1);
    expect(returned.observations).toBeNull();
    expect(process.exitCode).toBe(1);
  });

  it("does not observe diagnostics when initialization fails", async () => {
    harness.statusParseFails = true;
    const observed = vi.fn<(_diagnostic: FailedPublicResponseDiagnostic) => undefined>(() => undefined);
    const { runLiveEval } = await import("../scripts/ai/live-eval");

    const returned = await runLiveEval({ onFailedPublicResponse: observed });

    expect(observed).not.toHaveBeenCalled();
    expect(harness.providerRuns).toBe(0);
    expect(harness.reports).toHaveLength(1);
    expect(returned.observations).toBeNull();
    expect(process.exitCode).toBe(1);
  });

  it("does not observe diagnostics if the completed final report cannot be validated", async () => {
    harness.scenario = "completed_public_quality_failure";
    harness.invalidateFinalReport = true;
    const observed = vi.fn<(_diagnostic: FailedPublicResponseDiagnostic) => undefined>(() => undefined);
    const { runLiveEval } = await import("../scripts/ai/live-eval");

    await expect(runLiveEval({ onFailedPublicResponse: observed })).rejects.toThrow(
      "synthetic final report schema failure",
    );

    expect(harness.providerRuns).toBe(18);
    expect(harness.reports).toHaveLength(0);
    expect(observed).not.toHaveBeenCalled();
  });
});
