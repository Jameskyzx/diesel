import { z } from "zod";

import type { ModelObservabilityAggregate } from "./model-observability";

const MICRO_USD_PER_MILLION_TOKENS_DIVISOR = 1_000_000n;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

const exactIdentifierSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value === value.trim(), {
    message: "Must not contain leading or trailing whitespace",
  });

const rateSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

const profileMetadataShape = {
  asOf: z.iso.date(),
  modelId: exactIdentifierSchema,
  validThrough: z.iso.date(),
  version: exactIdentifierSchema,
} as const;

const modelCostProfileShapeSchema = z
  .discriminatedUnion("pricingMode", [
    z
      .object({
        ...profileMetadataShape,
        pricingMode: z.literal("flat"),
        ratesMicroUsdPerMillionTokens: z
          .object({
            input: rateSchema,
            output: rateSchema,
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        ...profileMetadataShape,
        pricingMode: z.literal("cache-tiered"),
        ratesMicroUsdPerMillionTokens: z
          .object({
            cacheRead: rateSchema,
            cacheWrite: rateSchema,
            noCache: rateSchema,
            output: rateSchema,
          })
          .strict(),
      })
      .strict(),
  ])
  .refine((profile) => profile.validThrough >= profile.asOf, {
    message: "Pricing profile validity cannot end before its as-of date",
    path: ["validThrough"],
  });

export type ModelCostProfile = z.infer<typeof modelCostProfileShapeSchema>;

export const MODEL_COST_ESTIMATE_STATUSES = [
  "not_configured",
  "invalid_profile",
  "invalid_reference_date",
  "stale_profile",
  "model_mismatch",
  "usage_incomplete",
  "arithmetic_overflow",
  "estimated",
] as const;

export type ModelCostEstimateStatus =
  (typeof MODEL_COST_ESTIMATE_STATUSES)[number];

export type ModelCostEstimate = {
  estimatedCostMicroUsd: number | null;
  profileAsOf: string | null;
  profileValidThrough: string | null;
  profileVersion: string | null;
  status: ModelCostEstimateStatus;
};

type CompleteBaseUsage = {
  inputTokens: number;
  outputTokens: number;
};

type CompleteCacheUsage = CompleteBaseUsage & {
  cacheReadTokens: number;
  cacheWriteTokens: number;
  noCacheTokens: number;
};

type CostTerm = {
  rateMicroUsdPerMillionTokens: number;
  tokens: number;
};

/**
 * Builds the strict external-input boundary for a pricing profile. Requiring
 * the caller to supply the reference date keeps validation deterministic and
 * prevents a profile dated in the future from being used accidentally.
 */
export function createModelCostProfileSchema(referenceDate: string) {
  const parsedReferenceDate = z.iso.date().safeParse(referenceDate);
  if (!parsedReferenceDate.success) {
    throw new TypeError("referenceDate must be a valid ISO calendar date");
  }

  return modelCostProfileShapeSchema.refine(
    (profile) => profile.asOf <= parsedReferenceDate.data,
    {
      message: "Pricing profile must not be dated in the future",
      path: ["asOf"],
    },
  );
}

function result(
  status: ModelCostEstimateStatus,
  profile?: ModelCostProfile,
  estimatedCostMicroUsd: number | null = null,
): ModelCostEstimate {
  return {
    estimatedCostMicroUsd,
    profileAsOf: profile?.asOf ?? null,
    profileValidThrough: profile?.validThrough ?? null,
    profileVersion: profile?.version ?? null,
    status,
  };
}

function readCompleteMetric(metric: {
  reported: boolean;
  value: number | null;
}): number | null {
  return metric.reported &&
    metric.value !== null &&
    Number.isSafeInteger(metric.value) &&
    metric.value >= 0
    ? metric.value
    : null;
}

function readCompleteBaseUsage(
  observability: ModelObservabilityAggregate,
): CompleteBaseUsage | null {
  if (
    observability.incomplete ||
    !Number.isSafeInteger(observability.completedStepCount) ||
    observability.completedStepCount <= 0 ||
    observability.expectedStepCount === null ||
    !Number.isSafeInteger(observability.expectedStepCount) ||
    observability.expectedStepCount !== observability.completedStepCount
  ) {
    return null;
  }

  const inputTokens = readCompleteMetric(
    observability.tokenUsage.inputTokens,
  );
  const outputTokens = readCompleteMetric(
    observability.tokenUsage.outputTokens,
  );
  const totalTokens = readCompleteMetric(
    observability.tokenUsage.totalTokens,
  );

  if (
    inputTokens === null ||
    inputTokens <= 0 ||
    outputTokens === null ||
    totalTokens === null ||
    totalTokens <= 0 ||
    BigInt(inputTokens) + BigInt(outputTokens) !== BigInt(totalTokens)
  ) {
    return null;
  }

  return { inputTokens, outputTokens };
}

function readCompleteCacheUsage(
  observability: ModelObservabilityAggregate,
  baseUsage: CompleteBaseUsage,
): CompleteCacheUsage | null {
  if (observability.cacheStatus !== "reported") {
    return null;
  }

  const cacheReadTokens = readCompleteMetric(
    observability.tokenUsage.cacheReadTokens,
  );
  const cacheWriteTokens = readCompleteMetric(
    observability.tokenUsage.cacheWriteTokens,
  );
  const noCacheTokens = readCompleteMetric(
    observability.tokenUsage.noCacheTokens,
  );

  if (
    cacheReadTokens === null ||
    cacheWriteTokens === null ||
    noCacheTokens === null ||
    cacheReadTokens > baseUsage.inputTokens ||
    cacheWriteTokens > baseUsage.inputTokens ||
    BigInt(noCacheTokens) +
        BigInt(cacheReadTokens) +
        BigInt(cacheWriteTokens) !==
      BigInt(baseUsage.inputTokens)
  ) {
    return null;
  }

  return {
    ...baseUsage,
    cacheReadTokens,
    cacheWriteTokens,
    noCacheTokens,
  };
}

function calculateCostMicroUsd(terms: readonly CostTerm[]): number | null {
  const numerator = terms.reduce(
    (sum, term) =>
      sum +
      BigInt(term.tokens) * BigInt(term.rateMicroUsdPerMillionTokens),
    0n,
  );
  const roundedUp =
    (numerator + MICRO_USD_PER_MILLION_TOKENS_DIVISOR - 1n) /
    MICRO_USD_PER_MILLION_TOKENS_DIVISOR;

  return roundedUp <= MAX_SAFE_INTEGER_BIGINT ? Number(roundedUp) : null;
}

/**
 * Produces a provider-neutral cost estimate from normalized, completed model
 * telemetry and an explicit pricing profile. It performs no I/O, reads no
 * environment variables, and never returns the supplied profile or its rates.
 */
export function estimateModelCost(input: {
  actualModelId: string;
  observability: ModelObservabilityAggregate;
  profile: unknown | null | undefined;
  referenceDate: string;
}): ModelCostEstimate {
  if (input.profile === null || input.profile === undefined) {
    return result("not_configured");
  }

  const parsedReferenceDate = z.iso.date().safeParse(input.referenceDate);
  if (!parsedReferenceDate.success) {
    return result("invalid_reference_date");
  }

  const parsedProfile = createModelCostProfileSchema(
    parsedReferenceDate.data,
  ).safeParse(input.profile);
  if (!parsedProfile.success) {
    return result("invalid_profile");
  }

  const profile = parsedProfile.data;
  if (profile.modelId !== input.actualModelId) {
    return result("model_mismatch", profile);
  }
  if (parsedReferenceDate.data > profile.validThrough) {
    return result("stale_profile", profile);
  }

  const baseUsage = readCompleteBaseUsage(input.observability);
  if (baseUsage === null) {
    return result("usage_incomplete", profile);
  }

  const terms: CostTerm[] = [];
  if (profile.pricingMode === "flat") {
    terms.push(
      {
        rateMicroUsdPerMillionTokens:
          profile.ratesMicroUsdPerMillionTokens.input,
        tokens: baseUsage.inputTokens,
      },
      {
        rateMicroUsdPerMillionTokens:
          profile.ratesMicroUsdPerMillionTokens.output,
        tokens: baseUsage.outputTokens,
      },
    );
  } else {
    const cacheUsage = readCompleteCacheUsage(
      input.observability,
      baseUsage,
    );
    if (cacheUsage === null) {
      return result("usage_incomplete", profile);
    }

    terms.push(
      {
        rateMicroUsdPerMillionTokens:
          profile.ratesMicroUsdPerMillionTokens.noCache,
        tokens: cacheUsage.noCacheTokens,
      },
      {
        rateMicroUsdPerMillionTokens:
          profile.ratesMicroUsdPerMillionTokens.cacheRead,
        tokens: cacheUsage.cacheReadTokens,
      },
      {
        rateMicroUsdPerMillionTokens:
          profile.ratesMicroUsdPerMillionTokens.cacheWrite,
        tokens: cacheUsage.cacheWriteTokens,
      },
      {
        rateMicroUsdPerMillionTokens:
          profile.ratesMicroUsdPerMillionTokens.output,
        tokens: cacheUsage.outputTokens,
      },
    );
  }

  const estimatedCostMicroUsd = calculateCostMicroUsd(terms);
  return estimatedCostMicroUsd === null
    ? result("arithmetic_overflow", profile)
    : result("estimated", profile, estimatedCostMicroUsd);
}
