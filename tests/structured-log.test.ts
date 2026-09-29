import { describe, expect, it, vi } from "vitest";

import {
  createApiRequestObserver,
  emitAiCompletionLog,
  serializeStructuredLogEvent,
} from "@/server/observability/structured-log";

describe("structured observability logs", () => {
  it("emits a request correlation header and allowlisted JSON fields", () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const observer = createApiRequestObserver("/api/products");
      const response = observer.finish(Response.json({ status: "ok" }));

      expect(response.headers.get("x-request-id")).toBe(observer.requestId);
      const parsed = JSON.parse(String(consoleInfo.mock.calls[0]?.[0])) as Record<
        string,
        unknown
      >;
      expect(Object.keys(parsed).sort()).toEqual([
        "durationMs",
        "errorCode",
        "event",
        "requestId",
        "route",
        "status",
        "timestamp",
      ]);
    } finally {
      consoleInfo.mockRestore();
    }
  });

  it("rejects prompt, headers, addresses and secret-bearing extra fields", () => {
    expect(() =>
      serializeStructuredLogEvent({
        databaseUrl: "postgres://secret",
        durationMs: 1,
        errorCode: null,
        event: "api.request",
        headers: { authorization: "Bearer secret" },
        ip: "203.0.113.1",
        prompt: "private prompt",
        requestId: crypto.randomUUID(),
        route: "/api/chat",
        status: 200,
        timestamp: new Date().toISOString(),
      }),
    ).toThrow();
  });

  it("keeps AI completion logs to counts, evidence state and token usage", () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      emitAiCompletionLog({
        cacheHitRatePct: 25,
        cacheReadTokens: 5,
        cacheStatus: "partial",
        cacheWriteTokens: null,
        costProfileAsOf: null,
        costProfileValidThrough: null,
        costProfileVersion: null,
        costStatus: "not_configured",
        durationMs: 12,
        errorCode: null,
        estimatedCostMicroUsd: null,
        evidenceResult: "sufficient",
        inputTokens: 20,
        loopSteps: 2,
        modelCallAttemptCount: 2,
        modelCallAttemptCoverageComplete: true,
        modelCallCompletedCount: 2,
        modelPerformanceComplete: true,
        modelResponseTimeMs: 8,
        modelId: "provider/model",
        modelStepTimeMs: 10,
        modelTimeToFirstOutputMs: 3,
        noCacheTokens: 15,
        outputTokens: 10,
        requestId: crypto.randomUUID(),
        timestamp: "2026-09-01T00:00:00.000Z",
        tokenUsageComplete: true,
        toolCount: 1,
        totalTokens: 30,
      });

      const serialized = String(consoleInfo.mock.calls[0]?.[0]);
      expect(serialized).not.toContain("prompt");
      expect(serialized).not.toContain("secret");
      expect(serialized).not.toContain("raw");
      expect(JSON.parse(serialized)).toEqual(
        expect.objectContaining({
          cacheHitRatePct: 25,
          cacheReadTokens: 5,
          cacheStatus: "partial",
          cacheWriteTokens: null,
          costProfileAsOf: null,
          costProfileValidThrough: null,
          costProfileVersion: null,
          costStatus: "not_configured",
          estimatedCostMicroUsd: null,
          modelPerformanceComplete: true,
          modelCallAttemptCount: 2,
          modelCallAttemptCoverageComplete: true,
          modelCallCompletedCount: 2,
          modelResponseTimeMs: 8,
          modelStepTimeMs: 10,
          modelTimeToFirstOutputMs: 3,
          noCacheTokens: 15,
          tokenUsageComplete: true,
        }),
      );
    } finally {
      consoleInfo.mockRestore();
    }
  });

  it("rejects raw usage and internally inconsistent cost fields", () => {
    const validEvent = {
      cacheHitRatePct: null,
      cacheReadTokens: null,
      cacheStatus: "unavailable",
      cacheWriteTokens: null,
      costProfileAsOf: null,
      costProfileValidThrough: null,
      costProfileVersion: null,
      costStatus: "not_configured",
      durationMs: 12,
      errorCode: null,
      estimatedCostMicroUsd: null,
      event: "ai.completion",
      evidenceResult: "insufficient",
      inputTokens: 20,
      loopSteps: 1,
      modelCallAttemptCount: 1,
      modelCallAttemptCoverageComplete: true,
      modelCallCompletedCount: 1,
      modelId: "provider/model",
      modelPerformanceComplete: true,
      modelResponseTimeMs: 8,
      modelStepTimeMs: 10,
      modelTimeToFirstOutputMs: 3,
      noCacheTokens: null,
      outputTokens: 10,
      requestId: crypto.randomUUID(),
      timestamp: "2026-09-01T00:00:00.000Z",
      tokenUsageComplete: true,
      toolCount: 1,
      totalTokens: 30,
    };

    expect(() =>
      serializeStructuredLogEvent({
        ...validEvent,
        raw: { prompt_tokens_details: { cached_tokens: 10 } },
      }),
    ).toThrow();
    expect(() =>
      serializeStructuredLogEvent({
        ...validEvent,
        costProfileAsOf: "2026-08-30",
        costProfileValidThrough: "2026-09-30",
        costProfileVersion: "pricing-v1",
        costStatus: "estimated",
        estimatedCostMicroUsd: null,
      }),
    ).toThrow();
    expect(() =>
      serializeStructuredLogEvent({
        ...validEvent,
        costProfileValidThrough: "2026-09-30",
      }),
    ).toThrow();
    expect(() =>
      serializeStructuredLogEvent({
        ...validEvent,
        costProfileAsOf: "2026-09-30",
        costProfileValidThrough: "2026-08-30",
        costProfileVersion: "pricing-v1",
        costStatus: "usage_incomplete",
      }),
    ).toThrow();
    expect(() =>
      serializeStructuredLogEvent({
        ...validEvent,
        costProfileAsOf: "2026-08-30",
        costProfileValidThrough: "2026-09-30",
        costProfileVersion: "pricing-v1",
        costStatus: "stale_profile",
      }),
    ).toThrow();
    expect(() =>
      serializeStructuredLogEvent({
        ...validEvent,
        costProfileAsOf: "2026-08-30",
        costProfileValidThrough: "2026-09-30",
        costProfileVersion: "pricing-v1",
        costStatus: "stale_profile",
        timestamp: "2026-10-01T00:00:00.000Z",
      }),
    ).not.toThrow();
    expect(() =>
      serializeStructuredLogEvent({
        ...validEvent,
        costProfileAsOf: "2026-08-30",
        costProfileValidThrough: "2026-09-30",
        costProfileVersion: "pricing-v1",
        costStatus: "usage_incomplete",
        timestamp: "2026-10-01T00:00:00.000Z",
      }),
    ).toThrow();
    expect(() =>
      serializeStructuredLogEvent({
        ...validEvent,
        costProfileAsOf: "2026-08-30",
        costProfileValidThrough: "2026-09-30",
        costProfileVersion: "pricing-v1",
        costStatus: "usage_incomplete",
        timestamp: "2026-09-30T23:59:59.999Z",
      }),
    ).not.toThrow();
    expect(() =>
      serializeStructuredLogEvent({
        ...validEvent,
        costProfileAsOf: "2026-10-01",
        costProfileValidThrough: "2026-10-31",
        costProfileVersion: "pricing-v1",
        costStatus: "usage_incomplete",
        timestamp: "2026-10-01T00:30:00.000+01:00",
      }),
    ).toThrow();
    expect(() =>
      serializeStructuredLogEvent({
        ...validEvent,
        costProfileAsOf: "2026-08-30",
        costProfileValidThrough: "2026-09-30",
        costProfileVersion: "pricing-v1",
        costStatus: "model_mismatch",
        timestamp: "2026-10-01T00:00:00.000Z",
      }),
    ).not.toThrow();
  });

  it.each([
    {
      name: "more completed calls than attempts",
      overrides: { modelCallAttemptCount: 1, modelCallCompletedCount: 2 },
    },
    {
      name: "complete tokens with incomplete attempt coverage",
      overrides: { modelCallAttemptCoverageComplete: false },
    },
    {
      name: "complete performance with an unfinished attempt",
      overrides: { modelCallAttemptCount: 2 },
    },
    {
      name: "claimed attempt coverage with a failed attempt",
      overrides: {
        modelCallAttemptCount: 2,
        modelPerformanceComplete: false,
        tokenUsageComplete: false,
      },
    },
    {
      name: "claimed attempt coverage without a matching loop step",
      overrides: { loopSteps: 2 },
    },
    {
      name: "more loop steps than completed calls without coverage",
      overrides: {
        loopSteps: 5,
        modelCallAttemptCoverageComplete: false,
        modelCallCompletedCount: 0,
        modelPerformanceComplete: false,
        tokenUsageComplete: false,
      },
    },
    {
      name: "complete tokens with a missing base count",
      overrides: { inputTokens: null },
    },
    {
      name: "contradictory base token arithmetic",
      overrides: { totalTokens: 31 },
    },
    {
      name: "adapter fallback zero-only base tokens",
      overrides: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    },
    {
      name: "complete performance with a missing metric",
      overrides: { modelStepTimeMs: null },
    },
    {
      name: "step metrics without a completed call",
      overrides: {
        modelCallAttemptCount: 0,
        modelCallCompletedCount: 0,
        modelPerformanceComplete: false,
        tokenUsageComplete: false,
      },
    },
    {
      name: "unavailable cache with a reported cache count",
      overrides: { cacheReadTokens: 0 },
    },
    {
      name: "reported cache with a missing cache count",
      overrides: {
        cacheReadTokens: 5,
        cacheStatus: "reported" as const,
        noCacheTokens: 15,
      },
    },
    {
      name: "partial cache with every cache count present",
      overrides: {
        cacheReadTokens: 5,
        cacheWriteTokens: 0,
        noCacheTokens: 15,
      },
    },
    {
      name: "cache tokens exceeding input tokens",
      overrides: {
        cacheReadTokens: 21,
        cacheStatus: "partial" as const,
      },
    },
    {
      name: "cache partition not adding up to input tokens",
      overrides: {
        cacheReadTokens: 5,
        cacheStatus: "reported" as const,
        cacheWriteTokens: 0,
        noCacheTokens: 14,
      },
    },
    {
      name: "cache partition double counting written tokens",
      overrides: {
        cacheReadTokens: 5,
        cacheStatus: "reported" as const,
        cacheWriteTokens: 2,
        noCacheTokens: 15,
      },
    },
    {
      name: "cache hit rate without complete reported cache usage",
      overrides: { cacheHitRatePct: 25 },
    },
    {
      name: "cache hit rate inconsistent with token counts",
      overrides: {
        cacheHitRatePct: 30,
        cacheReadTokens: 5,
        cacheStatus: "partial" as const,
        noCacheTokens: 15,
      },
    },
    {
      name: "estimated cost with incomplete usage",
      overrides: {
        costProfileAsOf: "2026-08-30",
        costProfileValidThrough: "2026-09-30",
        costProfileVersion: "pricing-v1",
        costStatus: "estimated" as const,
        estimatedCostMicroUsd: 1,
        modelCallAttemptCoverageComplete: false,
        modelPerformanceComplete: false,
        tokenUsageComplete: false,
      },
    },
    {
      name: "overflow result with incomplete usage",
      overrides: {
        costProfileAsOf: "2026-08-30",
        costProfileValidThrough: "2026-09-30",
        costProfileVersion: "pricing-v1",
        costStatus: "arithmetic_overflow" as const,
        modelCallAttemptCoverageComplete: false,
        modelPerformanceComplete: false,
        tokenUsageComplete: false,
      },
    },
    {
      name: "failed stream claiming complete telemetry",
      overrides: { errorCode: "MODEL_STREAM_ERROR" },
    },
    {
      name: "aborted stream claiming complete telemetry and estimated cost",
      overrides: {
        costProfileAsOf: "2026-08-30",
        costProfileValidThrough: "2026-09-30",
        costProfileVersion: "pricing-v1",
        costStatus: "estimated" as const,
        errorCode: "MODEL_STREAM_ABORTED",
        estimatedCostMicroUsd: 1,
      },
    },
    {
      name: "failed stream claiming sufficient evidence",
      overrides: {
        errorCode: "MODEL_STREAM_ERROR",
        evidenceResult: "sufficient" as const,
        modelCallAttemptCoverageComplete: false,
        modelPerformanceComplete: false,
        tokenUsageComplete: false,
      },
    },
  ])("rejects $name", ({ overrides }) => {
    const validEvent = {
      cacheHitRatePct: null,
      cacheReadTokens: null,
      cacheStatus: "unavailable" as const,
      cacheWriteTokens: null,
      costProfileAsOf: null,
      costProfileValidThrough: null,
      costProfileVersion: null,
      costStatus: "not_configured" as const,
      durationMs: 12,
      errorCode: null,
      estimatedCostMicroUsd: null,
      event: "ai.completion" as const,
      evidenceResult: "insufficient" as const,
      inputTokens: 20,
      loopSteps: 1,
      modelCallAttemptCount: 1,
      modelCallAttemptCoverageComplete: true,
      modelCallCompletedCount: 1,
      modelId: "provider/model",
      modelPerformanceComplete: true,
      modelResponseTimeMs: 8,
      modelStepTimeMs: 10,
      modelTimeToFirstOutputMs: 3,
      noCacheTokens: null,
      outputTokens: 10,
      requestId: crypto.randomUUID(),
      timestamp: "2026-09-01T00:00:00.000Z",
      tokenUsageComplete: true,
      toolCount: 1,
      totalTokens: 30,
    };

    expect(() =>
      serializeStructuredLogEvent({ ...validEvent, ...overrides }),
    ).toThrow();
  });

  it("accepts a failed attempt with completed-step lower bounds", () => {
    expect(() =>
      serializeStructuredLogEvent({
        cacheHitRatePct: null,
        cacheReadTokens: null,
        cacheStatus: "unavailable",
        cacheWriteTokens: null,
        costProfileAsOf: "2026-08-30",
        costProfileValidThrough: "2026-09-30",
        costProfileVersion: "pricing-v1",
        costStatus: "usage_incomplete",
        durationMs: 12,
        errorCode: "MODEL_STREAM_ERROR",
        estimatedCostMicroUsd: null,
        event: "ai.completion",
        evidenceResult: "error",
        inputTokens: 20,
        loopSteps: 1,
        modelCallAttemptCount: 2,
        modelCallAttemptCoverageComplete: false,
        modelCallCompletedCount: 1,
        modelId: "provider/model",
        modelPerformanceComplete: false,
        modelResponseTimeMs: 8,
        modelStepTimeMs: 10,
        modelTimeToFirstOutputMs: 3,
        noCacheTokens: null,
        outputTokens: 10,
        requestId: crypto.randomUUID(),
        timestamp: "2026-09-01T00:00:00.000Z",
        tokenUsageComplete: false,
        toolCount: 1,
        totalTokens: 30,
      }),
    ).not.toThrow();
  });
});
