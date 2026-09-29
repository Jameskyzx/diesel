import { describe, expect, it } from "vitest";

import {
  aggregateModelStepObservability,
  deriveNormalizedModelStepTokenUsageComplete,
  normalizedModelStepCacheStatusMatchesMetrics,
  normalizeModelStepObservation,
  type ModelStepPerformanceSource,
  type ModelStepUsageSource,
  type NormalizedModelStepObservation,
} from "@/domain/ai/model-observability";

const defaultPerformance: ModelStepPerformanceSource = {
  responseTimeMs: 120,
  stepTimeMs: 150,
  timeToFirstOutputMs: 40,
};

function usage(input: {
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  inputTokens?: number;
  noCacheTokens?: number;
  outputTokens?: number;
  raw?: unknown;
  totalTokens?: number;
} = {}): ModelStepUsageSource {
  return {
    inputTokenDetails: {
      cacheReadTokens: input.cacheReadTokens,
      cacheWriteTokens: input.cacheWriteTokens,
      noCacheTokens: input.noCacheTokens,
    },
    inputTokens: input.inputTokens ?? 100,
    outputTokens: input.outputTokens ?? 20,
    raw: input.raw,
    totalTokens: input.totalTokens ?? 120,
  };
}

function normalize(input: {
  performance?: ModelStepPerformanceSource;
  usage?: ModelStepUsageSource;
} = {}): NormalizedModelStepObservation {
  return normalizeModelStepObservation({
    performance: input.performance ?? defaultPerformance,
    usage: input.usage ?? usage(),
  });
}

function explicitlyCachedStep(input: {
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  performance?: ModelStepPerformanceSource;
} = {}): NormalizedModelStepObservation {
  const inputTokens = input.inputTokens ?? 100;
  const outputTokens = input.outputTokens ?? 20;
  const cacheReadTokens = input.cacheReadTokens ?? 25;

  return normalize({
    performance: input.performance,
    usage: usage({
      cacheReadTokens,
      cacheWriteTokens: input.cacheWriteTokens,
      inputTokens,
      noCacheTokens:
        inputTokens - cacheReadTokens - (input.cacheWriteTokens ?? 0),
      outputTokens,
      raw: {
        completion_tokens: outputTokens,
        prompt_tokens: inputTokens,
        prompt_tokens_details: {
          cached_tokens: cacheReadTokens,
        },
        total_tokens: inputTokens + outputTokens,
      },
      totalTokens: inputTokens + outputTokens,
    }),
  });
}

describe("model step observability normalization", () => {
  it("does not mistake adapter fallback zeroes for reported cache telemetry", () => {
    const result = normalize({
      usage: usage({
        cacheReadTokens: 0,
        noCacheTokens: 100,
        raw: {
          prompt_tokens_details: {},
          private_provider_marker: "must-not-escape",
        },
      }),
    });

    expect(result.cacheStatus).toBe("unavailable");
    expect(result.tokenUsage.cacheReadTokens).toEqual({
      reported: false,
      value: null,
    });
    expect(result.tokenUsage.noCacheTokens).toEqual({
      reported: false,
      value: null,
    });
    expect(result.tokenUsage.cacheWriteTokens).toEqual({
      reported: false,
      value: null,
    });
    expect(JSON.stringify(result)).not.toContain("private_provider_marker");
    expect(JSON.stringify(result)).not.toContain("must-not-escape");
    expect(Object.hasOwn(result, "raw")).toBe(false);
  });

  it("preserves an explicitly reported cache-read zero without inventing cache writes", () => {
    const result = explicitlyCachedStep({ cacheReadTokens: 0 });
    const aggregate = aggregateModelStepObservability({
      expectedStepCount: 1,
      modelStreamCompleted: true,
      steps: [result],
    });

    expect(result.cacheStatus).toBe("partial");
    expect(result.tokenUsage.cacheReadTokens).toEqual({
      reported: true,
      value: 0,
    });
    expect(result.tokenUsage.noCacheTokens).toEqual({
      reported: true,
      value: 100,
    });
    expect(result.tokenUsage.cacheWriteTokens).toEqual({
      reported: false,
      value: null,
    });
    expect(aggregate.cacheHitRatePct).toBe(0);
  });

  it("reports complete cache coverage when read, no-cache, and write counts exist", () => {
    const result = explicitlyCachedStep({
      cacheReadTokens: 25,
      cacheWriteTokens: 10,
    });

    expect(result.cacheStatus).toBe("reported");
    expect(result.tokenUsage).toMatchObject({
      cacheReadTokens: { reported: true, value: 25 },
      cacheWriteTokens: { reported: true, value: 10 },
      noCacheTokens: { reported: true, value: 65 },
    });
  });

  it("treats cache read, write, and no-cache counts as one input partition", () => {
    const result = normalize({
      usage: usage({
        cacheReadTokens: 25,
        cacheWriteTokens: 10,
        inputTokens: 100,
        noCacheTokens: 75,
        outputTokens: 20,
        raw: {
          completion_tokens: 20,
          prompt_tokens: 100,
          prompt_tokens_details: { cached_tokens: 25 },
          total_tokens: 120,
        },
        totalTokens: 120,
      }),
    });

    expect(result.cacheStatus).toBe("inconsistent");
  });

  it("requires cached_tokens to be an own property", () => {
    const inheritedDetails = Object.create({ cached_tokens: 0 }) as Record<
      string,
      unknown
    >;
    const result = normalize({
      usage: usage({
        cacheReadTokens: 0,
        noCacheTokens: 100,
        raw: { prompt_tokens_details: inheritedDetails },
      }),
    });

    expect(result.cacheStatus).toBe("unavailable");
    expect(result.tokenUsage.cacheReadTokens.reported).toBe(false);
  });

  it.each([
    ["negative", -1],
    ["fractional", 0.5],
    ["larger than input", 101],
    ["unsafe", Number.MAX_SAFE_INTEGER + 1],
    ["not finite", Number.POSITIVE_INFINITY],
  ])("marks %s raw cached_tokens as inconsistent", (_label, cachedTokens) => {
    const result = normalize({
      usage: usage({
        cacheReadTokens: cachedTokens,
        noCacheTokens: 100 - cachedTokens,
        raw: {
          prompt_tokens_details: { cached_tokens: cachedTokens },
        },
      }),
    });

    expect(result.cacheStatus).toBe("inconsistent");
    expect(result.tokenUsage.cacheReadTokens.reported).toBe(true);
    expect(result.tokenUsage.cacheReadTokens.value).toBeNull();
  });

  it("treats an explicitly present null cached_tokens as inconsistent, not missing", () => {
    const result = normalize({
      usage: usage({
        cacheReadTokens: 0,
        noCacheTokens: 100,
        raw: { prompt_tokens_details: { cached_tokens: null } },
      }),
    });

    expect(result.cacheStatus).toBe("inconsistent");
    expect(result.tokenUsage.cacheReadTokens).toEqual({
      reported: true,
      value: null,
    });
  });

  it.each([
    {
      cacheReadTokens: 20,
      expectedNoCacheTokens: 80,
      label: "SDK cache-read count",
      noCacheTokens: 75,
      rawCacheReadTokens: 25,
    },
    {
      cacheReadTokens: 25,
      expectedNoCacheTokens: 80,
      label: "SDK no-cache count",
      noCacheTokens: 80,
      rawCacheReadTokens: 25,
    },
  ])("rejects a conflicting $label", ({
    cacheReadTokens,
    noCacheTokens,
    rawCacheReadTokens,
  }) => {
    const result = normalize({
      usage: usage({
        cacheReadTokens,
        noCacheTokens,
        raw: {
          prompt_tokens_details: { cached_tokens: rawCacheReadTokens },
        },
      }),
    });

    expect(result.cacheStatus).toBe("inconsistent");
  });

  it("marks an invalid explicitly supplied cache-write count inconsistent", () => {
    const result = explicitlyCachedStep({ cacheWriteTokens: 101 });

    expect(result.cacheStatus).toBe("inconsistent");
    expect(result.tokenUsage.cacheWriteTokens).toEqual({
      reported: true,
      value: null,
    });
  });

  it("maps SDK latency fields and renames time to first output", () => {
    const result = normalize({
      performance: {
        responseTimeMs: 125.5,
        stepTimeMs: 180.25,
        timeToFirstOutputMs: 42.75,
      },
    });

    expect(result.performance).toEqual({
      modelResponseTimeMs: { reported: true, value: 125.5 },
      modelStepTimeMs: { reported: true, value: 180.25 },
      modelTimeToFirstOutputMs: { reported: true, value: 42.75 },
    });
    expect(Object.hasOwn(result.performance, "timeToFirstOutputMs")).toBe(false);
  });

  it("keeps missing and invalid performance distinguishable", () => {
    const result = normalize({
      performance: {
        responseTimeMs: Number.NaN,
        stepTimeMs: 0,
        timeToFirstOutputMs: undefined,
      },
    });

    expect(result.performance).toEqual({
      modelResponseTimeMs: { reported: true, value: null },
      modelStepTimeMs: { reported: true, value: 0 },
      modelTimeToFirstOutputMs: { reported: false, value: null },
    });
  });

  it("marks missing or contradictory base token counts incomplete", () => {
    const missing = normalize({
      usage: {
        ...usage(),
        outputTokens: undefined,
      },
    });
    const contradictory = normalize({
      usage: usage({ totalTokens: 119 }),
    });

    expect(missing.tokenUsage.outputTokens).toEqual({
      reported: false,
      value: null,
    });
    expect(missing.tokenUsageComplete).toBe(false);
    expect(contradictory.tokenUsageComplete).toBe(false);
  });

  it("fails closed when OpenAI-compatible raw usage omits base token fields", () => {
    const result = normalize({
      usage: usage({
        inputTokens: 0,
        outputTokens: 0,
        raw: {},
        totalTokens: 0,
      }),
    });

    expect(result.tokenUsage).toMatchObject({
      inputTokens: { reported: false, value: null },
      outputTokens: { reported: false, value: null },
      totalTokens: { reported: false, value: null },
    });
    expect(result.tokenUsageComplete).toBe(false);
  });

  it("requires raw base token fields to match the normalized SDK values", () => {
    const valid = normalize({
      usage: usage({
        raw: {
          completion_tokens: 20,
          prompt_tokens: 100,
          total_tokens: 120,
        },
      }),
    });
    const mismatched = normalize({
      usage: usage({
        raw: {
          completion_tokens: 20,
          prompt_tokens: 99,
          total_tokens: 119,
        },
      }),
    });

    expect(valid.tokenUsageComplete).toBe(true);
    expect(mismatched.tokenUsageComplete).toBe(false);
    expect(mismatched.tokenUsage.inputTokens.value).toBeNull();
  });

  it.each([
    ["null raw usage", null],
    ["missing raw total", { completion_tokens: 20, prompt_tokens: 100 }],
    [
      "inherited raw fields",
      Object.create({
        completion_tokens: 20,
        prompt_tokens: 100,
        total_tokens: 120,
      }),
    ],
    [
      "fractional raw field",
      { completion_tokens: 20.5, prompt_tokens: 100, total_tokens: 120.5 },
    ],
  ])("rejects %s as complete provider usage", (_label, raw) => {
    expect(normalize({ usage: usage({ raw }) }).tokenUsageComplete).toBe(false);
  });
});

describe("model step observability aggregation", () => {
  it("computes weighted cache hit rate and totals from completed steps only", () => {
    const steps = [
      explicitlyCachedStep({
        cacheReadTokens: 20,
        inputTokens: 100,
        outputTokens: 20,
        performance: {
          responseTimeMs: 100,
          stepTimeMs: 130,
          timeToFirstOutputMs: 30,
        },
      }),
      explicitlyCachedStep({
        cacheReadTokens: 10,
        inputTokens: 50,
        outputTokens: 10,
        performance: {
          responseTimeMs: 80,
          stepTimeMs: 110,
          timeToFirstOutputMs: 20,
        },
      }),
    ];
    const result = aggregateModelStepObservability({
      expectedStepCount: 2,
      modelStreamCompleted: true,
      steps,
    });

    expect(result).toMatchObject({
      cacheStatus: "partial",
      completedStepCount: 2,
      expectedStepCount: 2,
      incomplete: false,
      performance: {
        modelResponseTimeMs: { reported: true, value: 180 },
        modelStepTimeMs: { reported: true, value: 240 },
        modelTimeToFirstOutputMs: { reported: true, value: 50 },
      },
      tokenUsage: {
        cacheReadTokens: { reported: true, value: 30 },
        cacheWriteTokens: { reported: false, value: null },
        inputTokens: { reported: true, value: 150 },
        noCacheTokens: { reported: true, value: 120 },
        outputTokens: { reported: true, value: 30 },
        totalTokens: { reported: true, value: 180 },
      },
    });
    expect(result.cacheHitRatePct).toBe(20);
  });

  it.each([
    {
      expectedReported: true,
      expectedValue: 240,
      label: "valid latency",
      metric: "modelResponseTimeMs" as const,
      performance: defaultPerformance,
    },
    {
      expectedReported: false,
      expectedValue: 40,
      label: "missing latency",
      metric: "modelTimeToFirstOutputMs" as const,
      performance: {
        ...defaultPerformance,
        timeToFirstOutputMs: undefined,
      },
    },
    {
      expectedReported: false,
      expectedValue: 120,
      label: "NaN latency",
      metric: "modelResponseTimeMs" as const,
      performance: {
        ...defaultPerformance,
        responseTimeMs: Number.NaN,
      },
    },
    {
      expectedReported: false,
      expectedValue: 150,
      label: "infinite latency",
      metric: "modelStepTimeMs" as const,
      performance: {
        ...defaultPerformance,
        stepTimeMs: Number.POSITIVE_INFINITY,
      },
    },
    {
      expectedReported: false,
      expectedValue: 120,
      label: "negative latency",
      metric: "modelResponseTimeMs" as const,
      performance: {
        ...defaultPerformance,
        responseTimeMs: -1,
      },
    },
  ])(
    "keeps the known lower bound without claiming complete $label telemetry",
    ({ expectedReported, expectedValue, metric, performance }) => {
      const result = aggregateModelStepObservability({
        expectedStepCount: 2,
        modelStreamCompleted: true,
        steps: [
          explicitlyCachedStep(),
          explicitlyCachedStep({ performance }),
        ],
      });

      expect(result.incomplete).toBe(false);
      expect(result.performance[metric]).toEqual({
        reported: expectedReported,
        value: expectedValue,
      });
      expect(
        Object.values(result.performance).every(
          (performanceMetric) =>
            performanceMetric.reported && performanceMetric.value !== null,
        ),
      ).toBe(expectedReported);
    },
  );

  it("preserves completed-step values while marking an interrupted stream incomplete", () => {
    const result = aggregateModelStepObservability({
      expectedStepCount: 2,
      modelStreamCompleted: false,
      steps: [explicitlyCachedStep({ cacheReadTokens: 25 })],
    });

    expect(result.incomplete).toBe(true);
    expect(result.completedStepCount).toBe(1);
    expect(result.tokenUsage.inputTokens).toEqual({
      reported: true,
      value: 100,
    });
    expect(result.tokenUsage.totalTokens.value).toBe(120);
    expect(result.cacheHitRatePct).toBeNull();
  });

  it("keeps known field sums when one completed step has incomplete usage", () => {
    const completeStep = explicitlyCachedStep();
    const incompleteStep = normalize({
      usage: {
        ...usage({ inputTokens: 50, totalTokens: 50 }),
        outputTokens: undefined,
      },
    });
    const result = aggregateModelStepObservability({
      expectedStepCount: 2,
      modelStreamCompleted: true,
      steps: [completeStep, incompleteStep],
    });

    expect(result.incomplete).toBe(true);
    expect(result.tokenUsage).toMatchObject({
      inputTokens: { reported: true, value: 150 },
      outputTokens: { reported: false, value: 20 },
      totalTokens: { reported: true, value: 170 },
    });
  });

  it("does not call an invalid reported token metric complete", () => {
    const validStep = explicitlyCachedStep();
    const invalidStep = normalize({
      usage: usage({ outputTokens: Number.NaN }),
    });
    const result = aggregateModelStepObservability({
      expectedStepCount: 2,
      modelStreamCompleted: true,
      steps: [validStep, invalidStep],
    });

    expect(invalidStep.tokenUsage.outputTokens).toEqual({
      reported: true,
      value: null,
    });
    expect(result.tokenUsage.outputTokens).toEqual({
      reported: false,
      value: 20,
    });
    expect(result.incomplete).toBe(true);
  });

  it("returns null hit rate when any completed step lacks explicit cached_tokens", () => {
    const result = aggregateModelStepObservability({
      expectedStepCount: 2,
      modelStreamCompleted: true,
      steps: [
        explicitlyCachedStep(),
        normalize({
          usage: usage({ cacheReadTokens: 0, noCacheTokens: 100 }),
        }),
      ],
    });

    expect(result.cacheStatus).toBe("partial");
    expect(result.cacheHitRatePct).toBeNull();
  });

  it("never computes a cache hit sample for an unavailable cache status", () => {
    const contradictory = explicitlyCachedStep({ cacheReadTokens: 0 });
    contradictory.cacheStatus = "unavailable";
    const result = aggregateModelStepObservability({
      expectedStepCount: 1,
      modelStreamCompleted: true,
      steps: [contradictory],
    });

    expect(result.cacheStatus).toBe("unavailable");
    expect(result.cacheHitRatePct).toBeNull();
  });

  it("returns null hit rate when explicit cache telemetry is inconsistent", () => {
    const inconsistent = normalize({
      usage: usage({
        cacheReadTokens: 101,
        noCacheTokens: 0,
        raw: { prompt_tokens_details: { cached_tokens: 101 } },
      }),
    });
    const result = aggregateModelStepObservability({
      expectedStepCount: 1,
      modelStreamCompleted: true,
      steps: [inconsistent],
    });

    expect(result.cacheStatus).toBe("inconsistent");
    expect(result.cacheHitRatePct).toBeNull();
  });

  it("fails closed for an invalid expected step count or an empty ledger", () => {
    const invalidExpected = aggregateModelStepObservability({
      expectedStepCount: -1,
      modelStreamCompleted: true,
      steps: [explicitlyCachedStep()],
    });
    const empty = aggregateModelStepObservability({
      expectedStepCount: 0,
      modelStreamCompleted: true,
      steps: [],
    });

    expect(invalidExpected).toMatchObject({
      expectedStepCount: null,
      incomplete: true,
    });
    expect(empty).toMatchObject({
      cacheHitRatePct: null,
      cacheStatus: "unavailable",
      completedStepCount: 0,
      incomplete: true,
    });
  });
});

describe("retained model-step invariants", () => {
  it("re-derives token completeness without trusting the persisted bit", () => {
    const observed = explicitlyCachedStep();
    expect(
      deriveNormalizedModelStepTokenUsageComplete(observed.tokenUsage),
    ).toBe(true);

    observed.tokenUsage.outputTokens.reported = false;
    expect(
      deriveNormalizedModelStepTokenUsageComplete(observed.tokenUsage),
    ).toBe(false);
  });

  it("rejects cache statuses that contradict retained metric coverage", () => {
    const unavailable = normalize();
    const reported = explicitlyCachedStep({ cacheWriteTokens: 0 });
    expect(normalizedModelStepCacheStatusMatchesMetrics(unavailable)).toBe(true);
    expect(normalizedModelStepCacheStatusMatchesMetrics(reported)).toBe(true);

    reported.cacheStatus = "unavailable";
    expect(normalizedModelStepCacheStatusMatchesMetrics(reported)).toBe(false);
  });

  it("allows inconsistent status when the omitted SDK/raw comparison may explain it", () => {
    const observed = explicitlyCachedStep({ cacheWriteTokens: 0 });
    observed.cacheStatus = "inconsistent";

    expect(normalizedModelStepCacheStatusMatchesMetrics(observed)).toBe(true);
  });
});
