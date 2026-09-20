import {
  aggregateModelStepObservability,
  type ModelCacheObservationStatus,
  type ModelObservabilityAggregate,
  type NormalizedModelStepObservation,
  type ReportedModelMetric,
} from "./model-observability";

export type LiveEvalCaseModelObservability = {
  aggregate: ModelObservabilityAggregate;
  attemptCoverageComplete: boolean;
  modelPerformanceComplete: boolean;
  steps: NormalizedModelStepObservation[];
};

export type LiveEvalMetricSummary = {
  max: number | null;
  p50: number | null;
  p95: number | null;
  sampleCount: number;
};

export type LiveEvalObservabilitySummary = {
  cacheHitRatePct: LiveEvalMetricSummary;
  cacheStatusCounts: Record<ModelCacheObservationStatus, number>;
  caseCounts: {
    attemptCoverageComplete: number;
    attemptCoverageIncomplete: number;
    modelPerformanceComplete: number;
    modelPerformanceIncomplete: number;
    total: number;
  };
  caseLatencyMs: LiveEvalMetricSummary;
  modelPerformance: {
    modelResponseTimeMs: LiveEvalMetricSummary;
    modelStepTimeMs: LiveEvalMetricSummary;
    modelTimeToFirstOutputMs: LiveEvalMetricSummary;
  };
};

function requireNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

function cloneMetric(metric: ReportedModelMetric): ReportedModelMetric {
  return { reported: metric.reported, value: metric.value };
}

function cloneStep(
  step: NormalizedModelStepObservation,
): NormalizedModelStepObservation {
  return {
    cacheStatus: step.cacheStatus,
    performance: {
      modelResponseTimeMs: cloneMetric(step.performance.modelResponseTimeMs),
      modelStepTimeMs: cloneMetric(step.performance.modelStepTimeMs),
      modelTimeToFirstOutputMs: cloneMetric(
        step.performance.modelTimeToFirstOutputMs,
      ),
    },
    tokenUsage: {
      cacheReadTokens: cloneMetric(step.tokenUsage.cacheReadTokens),
      cacheWriteTokens: cloneMetric(step.tokenUsage.cacheWriteTokens),
      inputTokens: cloneMetric(step.tokenUsage.inputTokens),
      noCacheTokens: cloneMetric(step.tokenUsage.noCacheTokens),
      outputTokens: cloneMetric(step.tokenUsage.outputTokens),
      totalTokens: cloneMetric(step.tokenUsage.totalTokens),
    },
    tokenUsageComplete: step.tokenUsageComplete,
  };
}

export function buildLiveEvalCaseObservability(input: {
  attemptCount: number;
  completedCount: number;
  expectedStepCount: number;
  modelStreamCompleted: boolean;
  steps: readonly NormalizedModelStepObservation[];
}): LiveEvalCaseModelObservability {
  requireNonNegativeSafeInteger(input.attemptCount, "attemptCount");
  requireNonNegativeSafeInteger(input.completedCount, "completedCount");
  requireNonNegativeSafeInteger(input.expectedStepCount, "expectedStepCount");
  if (input.completedCount > input.attemptCount) {
    throw new RangeError("completedCount cannot exceed attemptCount");
  }
  if (!Number.isSafeInteger(input.steps.length)) {
    throw new RangeError("steps length must be a safe integer");
  }

  const steps = input.steps.map(cloneStep);
  const observedAggregate = aggregateModelStepObservability({
    expectedStepCount: input.expectedStepCount,
    modelStreamCompleted: input.modelStreamCompleted,
    steps,
  });
  const attemptCoverageComplete =
    input.modelStreamCompleted &&
    input.attemptCount > 0 &&
    input.attemptCount === input.completedCount &&
    input.completedCount === steps.length;
  const aggregate = attemptCoverageComplete
    ? observedAggregate
    : {
        ...observedAggregate,
        cacheHitRatePct: null,
        incomplete: true,
      };
  const modelPerformanceComplete =
    attemptCoverageComplete &&
    !aggregate.incomplete &&
    Object.values(aggregate.performance).every(
      (metric) => metric.reported && metric.value !== null,
    );

  return {
    aggregate,
    attemptCoverageComplete,
    modelPerformanceComplete,
    steps,
  };
}

function summarizeMetric(values: readonly number[]): LiveEvalMetricSummary {
  const validValues = values.filter(
    (value) => Number.isFinite(value) && value >= 0,
  );
  if (validValues.length === 0) {
    return { max: null, p50: null, p95: null, sampleCount: 0 };
  }
  const sorted = [...validValues].sort((left, right) => left - right);
  const nearestRank = (percentile: number): number => {
    const index = Math.ceil(percentile * sorted.length) - 1;
    return sorted[index] ?? sorted[sorted.length - 1]!;
  };
  return {
    max: sorted[sorted.length - 1]!,
    p50: nearestRank(0.5),
    p95: nearestRank(0.95),
    sampleCount: sorted.length,
  };
}

function metricValue(metric: ReportedModelMetric): number[] {
  return metric.value !== null &&
      Number.isFinite(metric.value) &&
      metric.value >= 0
    ? [metric.value]
    : [];
}

export function summarizeLiveEvalObservability(
  cases: readonly {
    latencyMs: number;
    modelObservability: LiveEvalCaseModelObservability;
  }[],
): LiveEvalObservabilitySummary {
  if (!Number.isSafeInteger(cases.length)) {
    throw new RangeError("case count must be a safe integer");
  }

  const cacheStatusCounts: Record<ModelCacheObservationStatus, number> = {
    inconsistent: 0,
    partial: 0,
    reported: 0,
    unavailable: 0,
  };
  let attemptCoverageComplete = 0;
  let modelPerformanceComplete = 0;
  const caseLatencies: number[] = [];
  const cacheHitRates: number[] = [];
  const modelResponseTimes: number[] = [];
  const modelStepTimes: number[] = [];
  const modelFirstOutputTimes: number[] = [];

  for (const [index, row] of cases.entries()) {
    requireNonNegativeSafeInteger(row.latencyMs, `cases[${index}].latencyMs`);
    caseLatencies.push(row.latencyMs);
    const aggregate = row.modelObservability.aggregate;
    if (row.modelObservability.attemptCoverageComplete) {
      attemptCoverageComplete += 1;
    }
    if (row.modelObservability.modelPerformanceComplete) {
      modelPerformanceComplete += 1;
    }
    cacheStatusCounts[aggregate.cacheStatus] += 1;
    if (
      aggregate.cacheHitRatePct !== null &&
      Number.isFinite(aggregate.cacheHitRatePct) &&
      aggregate.cacheHitRatePct >= 0 &&
      aggregate.cacheHitRatePct <= 100
    ) {
      cacheHitRates.push(aggregate.cacheHitRatePct);
    }
    modelResponseTimes.push(
      ...metricValue(aggregate.performance.modelResponseTimeMs),
    );
    modelStepTimes.push(...metricValue(aggregate.performance.modelStepTimeMs));
    modelFirstOutputTimes.push(
      ...metricValue(aggregate.performance.modelTimeToFirstOutputMs),
    );
  }

  return {
    cacheHitRatePct: summarizeMetric(cacheHitRates),
    cacheStatusCounts,
    caseCounts: {
      attemptCoverageComplete,
      attemptCoverageIncomplete: cases.length - attemptCoverageComplete,
      modelPerformanceComplete,
      modelPerformanceIncomplete: cases.length - modelPerformanceComplete,
      total: cases.length,
    },
    caseLatencyMs: summarizeMetric(caseLatencies),
    modelPerformance: {
      modelResponseTimeMs: summarizeMetric(modelResponseTimes),
      modelStepTimeMs: summarizeMetric(modelStepTimes),
      modelTimeToFirstOutputMs: summarizeMetric(modelFirstOutputTimes),
    },
  };
}
