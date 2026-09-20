export const MODEL_CACHE_OBSERVATION_STATUSES = [
  "reported",
  "partial",
  "unavailable",
  "inconsistent",
] as const;

export type ModelCacheObservationStatus =
  (typeof MODEL_CACHE_OBSERVATION_STATUSES)[number];

export type ReportedModelMetric = {
  reported: boolean;
  value: number | null;
};

/**
 * The deliberately narrow subset of an AI SDK step usage object consumed by
 * the observability boundary. Provider `raw` data is inspected only to
 * distinguish an absent cached-token field from an explicitly reported zero.
 */
export type ModelStepUsageSource = {
  inputTokenDetails: {
    cacheReadTokens: number | undefined;
    cacheWriteTokens: number | undefined;
    noCacheTokens: number | undefined;
  };
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  raw?: unknown;
  totalTokens: number | undefined;
};

/** The latency fields copied from an AI SDK step performance object. */
export type ModelStepPerformanceSource = {
  responseTimeMs: number;
  // Provider-call completion is observable before client-side tools finish,
  // so a call-level observation has no complete step duration yet.
  stepTimeMs: number | undefined;
  timeToFirstOutputMs: number | undefined;
};

export type NormalizedModelStepObservation = {
  cacheStatus: ModelCacheObservationStatus;
  performance: {
    modelResponseTimeMs: ReportedModelMetric;
    modelStepTimeMs: ReportedModelMetric;
    modelTimeToFirstOutputMs: ReportedModelMetric;
  };
  tokenUsage: {
    cacheReadTokens: ReportedModelMetric;
    cacheWriteTokens: ReportedModelMetric;
    inputTokens: ReportedModelMetric;
    noCacheTokens: ReportedModelMetric;
    outputTokens: ReportedModelMetric;
    totalTokens: ReportedModelMetric;
  };
  tokenUsageComplete: boolean;
};

export type ModelObservabilityAggregate = {
  cacheHitRatePct: number | null;
  cacheStatus: ModelCacheObservationStatus;
  completedStepCount: number;
  expectedStepCount: number | null;
  incomplete: boolean;
  performance: NormalizedModelStepObservation["performance"];
  tokenUsage: NormalizedModelStepObservation["tokenUsage"];
};

type NormalizedModelStepTokenUsage =
  NormalizedModelStepObservation["tokenUsage"];

type ExplicitRawCachedTokens =
  | { present: false }
  | { present: true; value: unknown };

type ExplicitRawBaseTokens =
  | { required: false }
  | {
      completionTokens: unknown;
      promptTokens: unknown;
      required: true;
      totalTokens: unknown;
      validShape: boolean;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function wasReported(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function normalizeTokenMetric(value: unknown): ReportedModelMetric {
  return {
    reported: wasReported(value),
    value: isSafeTokenCount(value) ? value : null,
  };
}

function normalizeBoundedTokenMetric(
  value: unknown,
  upperBound: number | null,
  reported = wasReported(value),
): ReportedModelMetric {
  return {
    reported,
    value:
      isSafeTokenCount(value) && upperBound !== null && value <= upperBound
        ? value
        : null,
  };
}

function normalizePerformanceMetric(value: unknown): ReportedModelMetric {
  return {
    reported: wasReported(value),
    value: isNonNegativeFiniteNumber(value) ? value : null,
  };
}

function readExplicitRawCachedTokens(raw: unknown): ExplicitRawCachedTokens {
  if (!isRecord(raw)) {
    return { present: false };
  }

  const promptTokenDetails = raw.prompt_tokens_details;
  if (
    !isRecord(promptTokenDetails) ||
    !Object.hasOwn(promptTokenDetails, "cached_tokens")
  ) {
    return { present: false };
  }

  return {
    present: true,
    value: promptTokenDetails.cached_tokens,
  };
}

function readExplicitRawBaseTokens(raw: unknown): ExplicitRawBaseTokens {
  // Some provider-neutral SDK models and test doubles do not expose raw usage.
  // In that case the normalized SDK fields remain the authoritative boundary.
  if (raw === undefined) {
    return { required: false };
  }

  if (!isRecord(raw)) {
    return {
      completionTokens: undefined,
      promptTokens: undefined,
      required: true,
      totalTokens: undefined,
      validShape: false,
    };
  }

  const validShape =
    Object.hasOwn(raw, "prompt_tokens") &&
    Object.hasOwn(raw, "completion_tokens") &&
    Object.hasOwn(raw, "total_tokens");

  return {
    completionTokens: raw.completion_tokens,
    promptTokens: raw.prompt_tokens,
    required: true,
    totalTokens: raw.total_tokens,
    validShape,
  };
}

function rawBaseTokensMatchSdk(input: {
  inputTokens: ReportedModelMetric;
  outputTokens: ReportedModelMetric;
  raw: ExplicitRawBaseTokens;
  totalTokens: ReportedModelMetric;
}): boolean {
  if (!input.raw.required) {
    return true;
  }

  const promptTokens = input.raw.promptTokens;
  const completionTokens = input.raw.completionTokens;
  const totalTokens = input.raw.totalTokens;

  return (
    input.raw.validShape &&
    isSafeTokenCount(promptTokens) &&
    isSafeTokenCount(completionTokens) &&
    isSafeTokenCount(totalTokens) &&
    promptTokens > 0 &&
    totalTokens > 0 &&
    promptTokens + completionTokens === totalTokens &&
    input.inputTokens.value === promptTokens &&
    input.outputTokens.value === completionTokens &&
    input.totalTokens.value === totalTokens
  );
}

function cacheMetricCoverage(input: {
  cacheReadTokens: ReportedModelMetric;
  cacheWriteTokens: ReportedModelMetric;
  noCacheTokens: ReportedModelMetric;
}): ModelCacheObservationStatus {
  const metrics = [
    input.cacheReadTokens,
    input.noCacheTokens,
    input.cacheWriteTokens,
  ];
  const validReportedCount = metrics.filter(
    (metric) => metric.reported && metric.value !== null,
  ).length;

  if (validReportedCount === 0) {
    return "unavailable";
  }
  return validReportedCount === metrics.length ? "reported" : "partial";
}

function hasRetainedMetricContradiction(metric: ReportedModelMetric): boolean {
  return !metric.reported && metric.value !== null;
}

/**
 * Re-derives the base-token completeness bit using only fields retained in the
 * normalized observation. When a raw OpenAI-compatible usage object is
 * present but incomplete or contradictory, the normalizer discards adapter
 * fallback values, so no raw provider object is needed to validate the
 * persisted bit.
 */
export function deriveNormalizedModelStepTokenUsageComplete(
  tokenUsage: NormalizedModelStepTokenUsage,
): boolean {
  const { inputTokens, outputTokens, totalTokens } = tokenUsage;
  if (
    !inputTokens.reported ||
    inputTokens.value === null ||
    inputTokens.value <= 0 ||
    !outputTokens.reported ||
    outputTokens.value === null ||
    !totalTokens.reported ||
    totalTokens.value === null ||
    totalTokens.value <= 0
  ) {
    return false;
  }

  const recomputedTotal = inputTokens.value + outputTokens.value;
  return Number.isSafeInteger(recomputedTotal) &&
    recomputedTotal === totalTokens.value;
}

/**
 * Checks whether a persisted cache status is compatible with the retained
 * normalized metrics. An `inconsistent` status may additionally reflect the
 * raw-vs-SDK cache-read disagreement that the normalizer observes but does not
 * persist, so it remains valid when an explicit cache-read field was reported.
 */
export function normalizedModelStepCacheStatusMatchesMetrics(input: {
  cacheStatus: ModelCacheObservationStatus;
  tokenUsage: NormalizedModelStepTokenUsage;
}): boolean {
  const {
    cacheReadTokens,
    cacheWriteTokens,
    inputTokens,
    noCacheTokens,
  } = input.tokenUsage;
  const cacheMetrics = [
    cacheReadTokens,
    cacheWriteTokens,
    noCacheTokens,
  ] as const;

  if (
    hasRetainedMetricContradiction(inputTokens) ||
    cacheMetrics.some(hasRetainedMetricContradiction) ||
    (noCacheTokens.reported && !cacheReadTokens.reported)
  ) {
    return false;
  }

  const knownCacheValues = cacheMetrics.flatMap((metric) =>
    metric.value === null ? [] : [metric.value]
  );
  const invalidReportedCacheMetric = cacheMetrics.some(
    (metric) => metric.reported && metric.value === null,
  );
  const inputTokenValue = inputTokens.value;
  const cacheValueWithoutInput =
    inputTokenValue === null && knownCacheValues.length > 0;
  const cacheValueExceedsInput =
    inputTokenValue !== null &&
    knownCacheValues.some((value) => value > inputTokenValue);
  let cachePartitionMismatch = false;
  if (
    inputTokenValue !== null &&
    cacheReadTokens.value !== null &&
    noCacheTokens.value !== null
  ) {
    const partitionTotal =
      cacheReadTokens.value +
      noCacheTokens.value +
      (cacheWriteTokens.value ?? 0);
    cachePartitionMismatch =
      !Number.isSafeInteger(partitionTotal) ||
      partitionTotal !== inputTokenValue;
  }
  const retainedMetricsAreInconsistent =
    invalidReportedCacheMetric ||
    cacheValueWithoutInput ||
    cacheValueExceedsInput ||
    cachePartitionMismatch;

  if (input.cacheStatus === "inconsistent") {
    return retainedMetricsAreInconsistent || cacheReadTokens.reported;
  }
  if (retainedMetricsAreInconsistent) {
    return false;
  }

  return input.cacheStatus === cacheMetricCoverage({
    cacheReadTokens,
    cacheWriteTokens,
    noCacheTokens,
  });
}

function cacheFieldsAreInconsistent(input: {
  cacheReadTokens: ReportedModelMetric;
  cacheWriteTokens: ReportedModelMetric;
  explicitRawCacheRead: boolean;
  inputTokens: ReportedModelMetric;
  noCacheTokens: ReportedModelMetric;
  sdkCacheReadTokens: number | undefined;
}): boolean {
  const inputTokens = input.inputTokens.value;
  const cacheReadTokens = input.cacheReadTokens.value;
  const cacheWriteTokens = input.cacheWriteTokens.value;
  const noCacheTokens = input.noCacheTokens.value;

  if (
    (input.cacheReadTokens.reported && cacheReadTokens === null) ||
    (input.cacheWriteTokens.reported && cacheWriteTokens === null) ||
    (input.noCacheTokens.reported && noCacheTokens === null)
  ) {
    return true;
  }

  if (!input.explicitRawCacheRead) {
    return cacheWriteTokens !== null &&
      (inputTokens === null || cacheWriteTokens > inputTokens);
  }

  if (
    inputTokens === null ||
    cacheReadTokens === null ||
    cacheReadTokens > inputTokens ||
    (cacheWriteTokens !== null && cacheWriteTokens > inputTokens)
  ) {
    return true;
  }

  const sdkCacheRead = input.sdkCacheReadTokens;
  if (
    wasReported(sdkCacheRead) &&
    (!isSafeTokenCount(sdkCacheRead) || sdkCacheRead !== cacheReadTokens)
  ) {
    return true;
  }

  return (
    noCacheTokens !== null &&
    noCacheTokens + cacheReadTokens + (cacheWriteTokens ?? 0) !== inputTokens
  );
}

export function normalizeModelStepObservation(input: {
  performance: ModelStepPerformanceSource;
  usage: ModelStepUsageSource;
}): NormalizedModelStepObservation {
  const sdkInputTokens = normalizeTokenMetric(input.usage.inputTokens);
  const sdkOutputTokens = normalizeTokenMetric(input.usage.outputTokens);
  const sdkTotalTokens = normalizeTokenMetric(input.usage.totalTokens);
  const explicitBaseTokens = readExplicitRawBaseTokens(input.usage.raw);
  const explicitBaseTokensMatchSdk = rawBaseTokensMatchSdk({
    inputTokens: sdkInputTokens,
    outputTokens: sdkOutputTokens,
    raw: explicitBaseTokens,
    totalTokens: sdkTotalTokens,
  });
  // When an OpenAI-compatible raw object exists, its own base-token fields
  // are the proof that adapter-normalized zeroes were actually reported. If
  // that proof is absent or contradictory, do not expose those fallback
  // values as a known lower bound.
  const discardAdapterBaseFallback =
    explicitBaseTokens.required && !explicitBaseTokensMatchSdk;
  const inputTokens = discardAdapterBaseFallback
    ? normalizeTokenMetric(undefined)
    : sdkInputTokens;
  const outputTokens = discardAdapterBaseFallback
    ? normalizeTokenMetric(undefined)
    : sdkOutputTokens;
  const totalTokens = discardAdapterBaseFallback
    ? normalizeTokenMetric(undefined)
    : sdkTotalTokens;
  const explicitCacheRead = readExplicitRawCachedTokens(input.usage.raw);

  // The current OpenAI-compatible adapter defaults a missing cached_tokens to
  // zero. Only the provider raw own-property can therefore make cache-read and
  // the adapter-derived no-cache counts reportable.
  const cacheReadTokens = explicitCacheRead.present
    ? normalizeBoundedTokenMetric(
        explicitCacheRead.value,
        inputTokens.value,
        true,
      )
    : normalizeTokenMetric(undefined);
  const noCacheTokens = explicitCacheRead.present
    ? normalizeBoundedTokenMetric(
        input.usage.inputTokenDetails.noCacheTokens,
        inputTokens.value,
      )
    : normalizeTokenMetric(undefined);
  const cacheWriteTokens = normalizeBoundedTokenMetric(
    input.usage.inputTokenDetails.cacheWriteTokens,
    inputTokens.value,
  );
  const cacheInconsistent = cacheFieldsAreInconsistent({
    cacheReadTokens,
    cacheWriteTokens,
    explicitRawCacheRead: explicitCacheRead.present,
    inputTokens,
    noCacheTokens,
    sdkCacheReadTokens: input.usage.inputTokenDetails.cacheReadTokens,
  });
  const tokenUsage = {
    cacheReadTokens,
    cacheWriteTokens,
    inputTokens,
    noCacheTokens,
    outputTokens,
    totalTokens,
  };
  const tokenUsageComplete =
    explicitBaseTokensMatchSdk &&
    deriveNormalizedModelStepTokenUsageComplete(tokenUsage);

  return {
    cacheStatus: cacheInconsistent
      ? "inconsistent"
      : cacheMetricCoverage({
          cacheReadTokens,
          cacheWriteTokens,
          noCacheTokens,
        }),
    performance: {
      modelResponseTimeMs: normalizePerformanceMetric(
        input.performance.responseTimeMs,
      ),
      modelStepTimeMs: normalizePerformanceMetric(input.performance.stepTimeMs),
      modelTimeToFirstOutputMs: normalizePerformanceMetric(
        input.performance.timeToFirstOutputMs,
      ),
    },
    tokenUsage,
    tokenUsageComplete,
  };
}

function sumKnownMetrics(
  metrics: readonly ReportedModelMetric[],
): ReportedModelMetric {
  const values = metrics.flatMap((metric) =>
    metric.value === null ? [] : [metric.value],
  );
  const sum = values.reduce((total, value) => total + value, 0);

  return {
    reported:
      metrics.length > 0 &&
      metrics.every((metric) => metric.reported && metric.value !== null),
    value:
      values.length > 0 && Number.isSafeInteger(sum) && sum >= 0 ? sum : null,
  };
}

function sumKnownPerformanceMetrics(
  metrics: readonly ReportedModelMetric[],
): ReportedModelMetric {
  const values = metrics.flatMap((metric) =>
    metric.value === null ? [] : [metric.value],
  );
  const sum = values.reduce((total, value) => total + value, 0);

  return {
    reported:
      metrics.length > 0 &&
      metrics.every((metric) => metric.reported && metric.value !== null),
    value:
      values.length > 0 && Number.isFinite(sum) && sum >= 0 ? sum : null,
  };
}

function aggregateCacheStatus(
  steps: readonly NormalizedModelStepObservation[],
): ModelCacheObservationStatus {
  if (steps.some((step) => step.cacheStatus === "inconsistent")) {
    return "inconsistent";
  }
  if (steps.length === 0 || steps.every((step) => step.cacheStatus === "unavailable")) {
    return "unavailable";
  }
  return steps.every((step) => step.cacheStatus === "reported")
    ? "reported"
    : "partial";
}

function calculateCacheHitRatePct(
  steps: readonly NormalizedModelStepObservation[],
): number | null {
  if (
    steps.length === 0 ||
    steps.some(
      (step) =>
        step.cacheStatus === "inconsistent" ||
        step.cacheStatus === "unavailable" ||
        !step.tokenUsage.inputTokens.reported ||
        step.tokenUsage.inputTokens.value === null ||
        !step.tokenUsage.cacheReadTokens.reported ||
        step.tokenUsage.cacheReadTokens.value === null ||
        step.tokenUsage.cacheReadTokens.value >
          step.tokenUsage.inputTokens.value,
    )
  ) {
    return null;
  }

  const inputTokens = steps.reduce(
    (sum, step) => sum + (step.tokenUsage.inputTokens.value ?? 0),
    0,
  );
  const cacheReadTokens = steps.reduce(
    (sum, step) => sum + (step.tokenUsage.cacheReadTokens.value ?? 0),
    0,
  );

  return inputTokens > 0 && Number.isSafeInteger(inputTokens)
    ? (cacheReadTokens / inputTokens) * 100
    : null;
}

/**
 * Aggregates only completed step observations. It deliberately accepts no SDK
 * aggregate usage, so interrupted streams retain their known step totals while
 * remaining explicitly incomplete.
 */
export function aggregateModelStepObservability(input: {
  expectedStepCount: number;
  modelStreamCompleted: boolean;
  steps: readonly NormalizedModelStepObservation[];
}): ModelObservabilityAggregate {
  const expectedStepCount =
    Number.isSafeInteger(input.expectedStepCount) && input.expectedStepCount >= 0
      ? input.expectedStepCount
      : null;
  const tokenUsage = {
    cacheReadTokens: sumKnownMetrics(
      input.steps.map((step) => step.tokenUsage.cacheReadTokens),
    ),
    cacheWriteTokens: sumKnownMetrics(
      input.steps.map((step) => step.tokenUsage.cacheWriteTokens),
    ),
    inputTokens: sumKnownMetrics(
      input.steps.map((step) => step.tokenUsage.inputTokens),
    ),
    noCacheTokens: sumKnownMetrics(
      input.steps.map((step) => step.tokenUsage.noCacheTokens),
    ),
    outputTokens: sumKnownMetrics(
      input.steps.map((step) => step.tokenUsage.outputTokens),
    ),
    totalTokens: sumKnownMetrics(
      input.steps.map((step) => step.tokenUsage.totalTokens),
    ),
  };
  const complete =
    input.modelStreamCompleted &&
    expectedStepCount !== null &&
    expectedStepCount > 0 &&
    input.steps.length === expectedStepCount &&
    input.steps.every((step) => step.tokenUsageComplete) &&
    tokenUsage.inputTokens.value !== null &&
    tokenUsage.outputTokens.value !== null &&
    tokenUsage.totalTokens.value !== null &&
    tokenUsage.totalTokens.value ===
      tokenUsage.inputTokens.value + tokenUsage.outputTokens.value;

  return {
    cacheHitRatePct: complete ? calculateCacheHitRatePct(input.steps) : null,
    cacheStatus: aggregateCacheStatus(input.steps),
    completedStepCount: input.steps.length,
    expectedStepCount,
    incomplete: !complete,
    performance: {
      modelResponseTimeMs: sumKnownPerformanceMetrics(
        input.steps.map((step) => step.performance.modelResponseTimeMs),
      ),
      modelStepTimeMs: sumKnownPerformanceMetrics(
        input.steps.map((step) => step.performance.modelStepTimeMs),
      ),
      modelTimeToFirstOutputMs: sumKnownPerformanceMetrics(
        input.steps.map((step) => step.performance.modelTimeToFirstOutputMs),
      ),
    },
    tokenUsage,
  };
}
