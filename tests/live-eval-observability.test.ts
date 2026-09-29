import { describe, expect, it } from "vitest";

import {
  buildLiveEvalCaseObservability,
  summarizeLiveEvalObservability,
} from "@/domain/ai/live-eval-observability";
import {
  normalizeModelStepObservation,
  type ModelStepPerformanceSource,
  type NormalizedModelStepObservation,
} from "@/domain/ai/model-observability";

function step(input: {
  cacheRead?: number;
  cacheWrite?: number;
  inputTokens?: number;
  performance?: Partial<ModelStepPerformanceSource>;
  rawCache?: unknown;
} = {}): NormalizedModelStepObservation {
  const inputTokens = input.inputTokens ?? 100;
  const cacheRead = input.cacheRead;
  const cacheWrite = input.cacheWrite;
  const outputTokens = 20;
  return normalizeModelStepObservation({
    performance: {
      responseTimeMs: input.performance?.responseTimeMs ?? 10,
      stepTimeMs: input.performance?.stepTimeMs ?? 15,
      timeToFirstOutputMs:
        input.performance?.timeToFirstOutputMs === undefined
          ? 5
          : input.performance.timeToFirstOutputMs,
    },
    usage: {
      inputTokenDetails: {
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        noCacheTokens:
          cacheRead === undefined
            ? undefined
            : inputTokens - cacheRead - (cacheWrite ?? 0),
      },
      inputTokens,
      outputTokens,
      raw: {
        completion_tokens: outputTokens,
        prompt_tokens: inputTokens,
        ...(input.rawCache === undefined
          ? {}
          : { prompt_tokens_details: { cached_tokens: input.rawCache } }),
        total_tokens: inputTokens + outputTokens,
      },
      totalTokens: inputTokens + outputTokens,
    },
  });
}

function build(
  steps: readonly NormalizedModelStepObservation[],
  overrides: Partial<{
    attemptCount: number;
    completedCount: number;
    expectedStepCount: number;
    modelStreamCompleted: boolean;
  }> = {},
) {
  return buildLiveEvalCaseObservability({
    attemptCount: overrides.attemptCount ?? steps.length,
    completedCount: overrides.completedCount ?? steps.length,
    expectedStepCount: overrides.expectedStepCount ?? steps.length,
    modelStreamCompleted: overrides.modelStreamCompleted ?? true,
    steps,
  });
}

describe("live eval observability", () => {
  it("persists normalized steps and complete multi-step aggregates", () => {
    const steps = [
      step({ cacheRead: 20, cacheWrite: 5, rawCache: 20 }),
      step({ cacheRead: 30, cacheWrite: 0, rawCache: 30 }),
    ];
    const result = build(steps);

    expect(result).toMatchObject({
      attemptCoverageComplete: true,
      modelPerformanceComplete: true,
      aggregate: {
        cacheHitRatePct: 25,
        cacheStatus: "reported",
        completedStepCount: 2,
        expectedStepCount: 2,
        incomplete: false,
        tokenUsage: { inputTokens: { reported: true, value: 200 } },
      },
    });
    expect(result.steps).toEqual(steps);
    expect(result.steps).not.toBe(steps);
    expect(result.steps[0]).not.toBe(steps[0]);
  });

  it("fails attempt coverage closed while retaining known lower bounds", () => {
    const result = build(
      [step({ cacheRead: 25, cacheWrite: 0, rawCache: 25 })],
      { attemptCount: 2, completedCount: 1 },
    );

    expect(result.attemptCoverageComplete).toBe(false);
    expect(result.modelPerformanceComplete).toBe(false);
    expect(result.aggregate.incomplete).toBe(true);
    expect(result.aggregate.cacheHitRatePct).toBeNull();
    expect(result.aggregate.tokenUsage.totalTokens.value).toBe(120);
    expect(result.aggregate.performance.modelStepTimeMs.value).toBe(15);
  });

  it("marks missing and invalid performance incomplete without losing valid sums", () => {
    const missing = step();
    missing.performance.modelTimeToFirstOutputMs = {
      reported: false,
      value: null,
    };
    const invalid = step();
    invalid.performance.modelResponseTimeMs = { reported: true, value: null };
    const result = build([missing, invalid]);

    expect(result.modelPerformanceComplete).toBe(false);
    expect(result.aggregate.performance).toMatchObject({
      modelResponseTimeMs: { reported: false, value: 10 },
      modelStepTimeMs: { reported: true, value: 30 },
      modelTimeToFirstOutputMs: { reported: false, value: 5 },
    });
  });

  it.each([
    ["reported", step({ cacheRead: 25, cacheWrite: 0, rawCache: 25 })],
    ["partial", step({ cacheRead: 25, rawCache: 25 })],
    ["unavailable", step()],
    ["inconsistent", step({ cacheRead: 25, rawCache: 101 })],
  ] as const)("preserves %s cache status", (status, observedStep) => {
    expect(build([observedStep]).aggregate.cacheStatus).toBe(status);
  });

  it("uses nearest-rank percentiles and summarizes only case rows", () => {
    const rows = Array.from({ length: 20 }, (_, index) => {
      const value = index + 1;
      return {
        latencyMs: value,
        modelObservability: build([
          step({
            cacheRead: value,
            cacheWrite: 0,
            inputTokens: 100,
            performance: {
              responseTimeMs: value,
              stepTimeMs: value * 2,
              timeToFirstOutputMs: value * 3,
            },
            rawCache: value,
          }),
        ]),
      };
    });

    expect(summarizeLiveEvalObservability(rows)).toMatchObject({
      cacheHitRatePct: { max: 20, p50: 10, p95: 19, sampleCount: 20 },
      cacheStatusCounts: {
        inconsistent: 0,
        partial: 0,
        reported: 20,
        unavailable: 0,
      },
      caseCounts: {
        attemptCoverageComplete: 20,
        attemptCoverageIncomplete: 0,
        modelPerformanceComplete: 20,
        modelPerformanceIncomplete: 0,
        total: 20,
      },
      caseLatencyMs: { max: 20, p50: 10, p95: 19, sampleCount: 20 },
      modelPerformance: {
        modelResponseTimeMs: { max: 20, p50: 10, p95: 19, sampleCount: 20 },
        modelStepTimeMs: { max: 40, p50: 20, p95: 38, sampleCount: 20 },
        modelTimeToFirstOutputMs: {
          max: 60,
          p50: 30,
          p95: 57,
          sampleCount: 20,
        },
      },
    });
  });

  it("counts every cache status and complete versus incomplete cases", () => {
    const reported = build([
      step({ cacheRead: 25, cacheWrite: 0, rawCache: 25 }),
    ]);
    const partial = build([step({ cacheRead: 25, rawCache: 25 })]);
    const unavailable = build([step()]);
    const inconsistent = build([step({ cacheRead: 25, rawCache: 101 })]);
    const retried = build([step()], { attemptCount: 2, completedCount: 1 });

    expect(
      summarizeLiveEvalObservability(
        [reported, partial, unavailable, inconsistent, retried].map(
          (modelObservability) => ({ latencyMs: 1, modelObservability }),
        ),
      ),
    ).toMatchObject({
      cacheStatusCounts: {
        inconsistent: 1,
        partial: 1,
        reported: 1,
        unavailable: 2,
      },
      caseCounts: {
        attemptCoverageComplete: 4,
        attemptCoverageIncomplete: 1,
        modelPerformanceComplete: 4,
        modelPerformanceIncomplete: 1,
        total: 5,
      },
    });
  });

  it("returns null metrics and zero counts for empty or unavailable samples", () => {
    const emptyMetric = { max: null, p50: null, p95: null, sampleCount: 0 };
    expect(summarizeLiveEvalObservability([])).toEqual({
      cacheHitRatePct: emptyMetric,
      cacheStatusCounts: {
        inconsistent: 0,
        partial: 0,
        reported: 0,
        unavailable: 0,
      },
      caseCounts: {
        attemptCoverageComplete: 0,
        attemptCoverageIncomplete: 0,
        modelPerformanceComplete: 0,
        modelPerformanceIncomplete: 0,
        total: 0,
      },
      caseLatencyMs: emptyMetric,
      modelPerformance: {
        modelResponseTimeMs: emptyMetric,
        modelStepTimeMs: emptyMetric,
        modelTimeToFirstOutputMs: emptyMetric,
      },
    });

    const observed = build([step()]);
    observed.aggregate.performance = {
      modelResponseTimeMs: { reported: false, value: null },
      modelStepTimeMs: { reported: false, value: null },
      modelTimeToFirstOutputMs: { reported: false, value: null },
    };
    const summary = summarizeLiveEvalObservability([
      { latencyMs: 0, modelObservability: observed },
    ]);
    expect(summary.modelPerformance).toEqual({
      modelResponseTimeMs: emptyMetric,
      modelStepTimeMs: emptyMetric,
      modelTimeToFirstOutputMs: emptyMetric,
    });
    expect(summary.cacheHitRatePct).toEqual(emptyMetric);
  });

  it("rejects unsafe counts and case latency", () => {
    expect(() =>
      buildLiveEvalCaseObservability({
        attemptCount: Number.MAX_SAFE_INTEGER + 1,
        completedCount: 0,
        expectedStepCount: 0,
        modelStreamCompleted: false,
        steps: [],
      }),
    ).toThrow(RangeError);
    expect(() =>
      summarizeLiveEvalObservability([
        { latencyMs: Number.POSITIVE_INFINITY, modelObservability: build([]) },
      ]),
    ).toThrow(RangeError);
  });
});
