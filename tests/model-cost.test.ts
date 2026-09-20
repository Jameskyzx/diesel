import { describe, expect, it } from "vitest";

import {
  createModelCostProfileSchema,
  estimateModelCost,
} from "@/domain/ai/model-cost";
import type { ModelObservabilityAggregate } from "@/domain/ai/model-observability";

const referenceDate = "2026-08-30";
const actualModelId = "provider/model-exact-v1";

const flatProfile = {
  asOf: "2026-08-01",
  modelId: actualModelId,
  pricingMode: "flat",
  ratesMicroUsdPerMillionTokens: {
    input: 2_000_000,
    output: 3_000_000,
  },
  validThrough: referenceDate,
  version: "pricing-2026-08-v1",
} as const;

const tieredProfile = {
  asOf: "2026-08-01",
  modelId: actualModelId,
  pricingMode: "cache-tiered",
  ratesMicroUsdPerMillionTokens: {
    cacheRead: 1_000_000,
    cacheWrite: 4_000_000,
    noCache: 2_000_000,
    output: 3_000_000,
  },
  validThrough: referenceDate,
  version: "pricing-2026-08-cache-v1",
} as const;

function aggregate(input: {
  cacheReadTokens?: number | null;
  cacheReported?: boolean;
  cacheStatus?: ModelObservabilityAggregate["cacheStatus"];
  cacheWriteTokens?: number | null;
  completedStepCount?: number;
  expectedStepCount?: number | null;
  incomplete?: boolean;
  inputReported?: boolean;
  inputTokens?: number | null;
  noCacheTokens?: number | null;
  outputReported?: boolean;
  outputTokens?: number | null;
  totalReported?: boolean;
  totalTokens?: number | null;
} = {}): ModelObservabilityAggregate {
  const inputTokens = input.inputTokens === undefined ? 100 : input.inputTokens;
  const outputTokens =
    input.outputTokens === undefined ? 20 : input.outputTokens;

  return {
    cacheHitRatePct: 25,
    cacheStatus: input.cacheStatus ?? "reported",
    completedStepCount: input.completedStepCount ?? 1,
    expectedStepCount:
      input.expectedStepCount === undefined ? 1 : input.expectedStepCount,
    incomplete: input.incomplete ?? false,
    performance: {
      modelResponseTimeMs: { reported: true, value: 100 },
      modelStepTimeMs: { reported: true, value: 110 },
      modelTimeToFirstOutputMs: { reported: true, value: 10 },
    },
    tokenUsage: {
      cacheReadTokens: {
        reported: input.cacheReported ?? true,
        value:
          input.cacheReadTokens === undefined ? 25 : input.cacheReadTokens,
      },
      cacheWriteTokens: {
        reported: input.cacheReported ?? true,
        value:
          input.cacheWriteTokens === undefined ? 10 : input.cacheWriteTokens,
      },
      inputTokens: {
        reported: input.inputReported ?? true,
        value: inputTokens,
      },
      noCacheTokens: {
        reported: input.cacheReported ?? true,
        value: input.noCacheTokens === undefined ? 65 : input.noCacheTokens,
      },
      outputTokens: {
        reported: input.outputReported ?? true,
        value: outputTokens,
      },
      totalTokens: {
        reported: input.totalReported ?? true,
        value:
          input.totalTokens === undefined &&
          inputTokens !== null &&
          outputTokens !== null
            ? inputTokens + outputTokens
            : (input.totalTokens ?? null),
      },
    },
  };
}

function estimate(input: {
  actualModelId?: string;
  observability?: ModelObservabilityAggregate;
  profile?: unknown | null;
  referenceDate?: string;
} = {}) {
  return estimateModelCost({
    actualModelId: input.actualModelId ?? actualModelId,
    observability: input.observability ?? aggregate(),
    profile: input.profile === undefined ? flatProfile : input.profile,
    referenceDate: input.referenceDate ?? referenceDate,
  });
}

describe("model cost profile validation", () => {
  it("accepts only explicit flat and cache-tiered profiles", () => {
    const schema = createModelCostProfileSchema(referenceDate);

    expect(schema.safeParse(flatProfile).success).toBe(true);
    expect(schema.safeParse(tieredProfile).success).toBe(true);
    expect(
      schema.safeParse({
        ...flatProfile,
        pricingMode: "provider-default",
      }).success,
    ).toBe(false);
  });

  it.each([
    ["unknown top-level field", { ...flatProfile, secret: "do-not-log" }],
    [
      "unknown rate field",
      {
        ...flatProfile,
        ratesMicroUsdPerMillionTokens: {
          ...flatProfile.ratesMicroUsdPerMillionTokens,
          cached: 1,
        },
      },
    ],
    [
      "negative rate",
      {
        ...flatProfile,
        ratesMicroUsdPerMillionTokens: {
          ...flatProfile.ratesMicroUsdPerMillionTokens,
          input: -1,
        },
      },
    ],
    [
      "fractional rate",
      {
        ...flatProfile,
        ratesMicroUsdPerMillionTokens: {
          ...flatProfile.ratesMicroUsdPerMillionTokens,
          input: 1.5,
        },
      },
    ],
    [
      "unsafe integer rate",
      {
        ...flatProfile,
        ratesMicroUsdPerMillionTokens: {
          ...flatProfile.ratesMicroUsdPerMillionTokens,
          input: Number.MAX_SAFE_INTEGER + 1,
        },
      },
    ],
    [
      "future profile",
      {
        ...flatProfile,
        asOf: "2026-08-31",
        validThrough: "2026-09-30",
      },
    ],
    ["invalid calendar date", { ...flatProfile, asOf: "2026-02-29" }],
    [
      "validity before as-of",
      { ...flatProfile, validThrough: "2026-07-31" },
    ],
    [
      "invalid validity calendar date",
      { ...flatProfile, validThrough: "2026-02-29" },
    ],
    [
      "missing validity",
      {
        asOf: flatProfile.asOf,
        modelId: flatProfile.modelId,
        pricingMode: flatProfile.pricingMode,
        ratesMicroUsdPerMillionTokens:
          flatProfile.ratesMicroUsdPerMillionTokens,
        version: flatProfile.version,
      },
    ],
    ["empty version", { ...flatProfile, version: "" }],
    ["padded model ID", { ...flatProfile, modelId: ` ${actualModelId}` }],
    [
      "wrong flat rate structure",
      {
        ...flatProfile,
        ratesMicroUsdPerMillionTokens: { input: 1 },
      },
    ],
  ])("rejects %s", (_label, profile) => {
    expect(
      createModelCostProfileSchema(referenceDate).safeParse(profile).success,
    ).toBe(false);
  });

  it("requires a valid reference ISO calendar date", () => {
    expect(() => createModelCostProfileSchema("2026-02-29")).toThrow(
      "referenceDate must be a valid ISO calendar date",
    );
  });
});

describe("model cost estimation", () => {
  it("does not estimate when no profile is configured", () => {
    expect(estimate({ profile: null })).toEqual({
      estimatedCostMicroUsd: null,
      profileAsOf: null,
      profileValidThrough: null,
      profileVersion: null,
      status: "not_configured",
    });
  });

  it("fails closed for invalid profiles without echoing their contents", () => {
    const result = estimate({
      profile: {
        ...flatProfile,
        prompt: "private-prompt-marker",
        raw: "private-raw-marker",
        secret: "private-secret-marker",
      },
    });

    expect(result).toEqual({
      estimatedCostMicroUsd: null,
      profileAsOf: null,
      profileValidThrough: null,
      profileVersion: null,
      status: "invalid_profile",
    });
    expect(JSON.stringify(result)).not.toMatch(/private|prompt|raw|secret/u);
  });

  it("does not grant legacy profiles an implicit unlimited validity", () => {
    const result = estimate({
      profile: {
        asOf: flatProfile.asOf,
        modelId: flatProfile.modelId,
        pricingMode: flatProfile.pricingMode,
        ratesMicroUsdPerMillionTokens:
          flatProfile.ratesMicroUsdPerMillionTokens,
        version: flatProfile.version,
      },
    });

    expect(result).toEqual({
      estimatedCostMicroUsd: null,
      profileAsOf: null,
      profileValidThrough: null,
      profileVersion: null,
      status: "invalid_profile",
    });
  });

  it("rejects an invalid reference date without inspecting profile metadata", () => {
    expect(
      estimate({ profile: flatProfile, referenceDate: "not-a-date" }),
    ).toEqual({
      estimatedCostMicroUsd: null,
      profileAsOf: null,
      profileValidThrough: null,
      profileVersion: null,
      status: "invalid_reference_date",
    });
  });

  it("keeps a reference date before as-of classified as an invalid profile", () => {
    expect(
      estimate({ referenceDate: "2026-07-31" }),
    ).toEqual({
      estimatedCostMicroUsd: null,
      profileAsOf: null,
      profileValidThrough: null,
      profileVersion: null,
      status: "invalid_profile",
    });
  });

  it("requires an exact, case-sensitive model ID match", () => {
    expect(
      estimate({ actualModelId: actualModelId.toUpperCase() }),
    ).toEqual({
      estimatedCostMicroUsd: null,
      profileAsOf: flatProfile.asOf,
      profileValidThrough: flatProfile.validThrough,
      profileVersion: flatProfile.version,
      status: "model_mismatch",
    });
  });

  it("reports an exact-model mismatch before considering profile expiry", () => {
    expect(
      estimate({
        actualModelId: actualModelId.toUpperCase(),
        referenceDate: "2026-08-31",
      }),
    ).toEqual({
      estimatedCostMicroUsd: null,
      profileAsOf: flatProfile.asOf,
      profileValidThrough: flatProfile.validThrough,
      profileVersion: flatProfile.version,
      status: "model_mismatch",
    });
  });

  it("fails closed after validity expiry but estimates on the inclusive boundary", () => {
    expect(estimate()).toMatchObject({
      estimatedCostMicroUsd: expect.any(Number),
      profileAsOf: flatProfile.asOf,
      profileValidThrough: referenceDate,
      profileVersion: flatProfile.version,
      status: "estimated",
    });
    expect(
      estimate({ referenceDate: "2026-08-31" }),
    ).toEqual({
      estimatedCostMicroUsd: null,
      profileAsOf: flatProfile.asOf,
      profileValidThrough: flatProfile.validThrough,
      profileVersion: flatProfile.version,
      status: "stale_profile",
    });
  });

  it("estimates flat input/output pricing and rounds the combined sum upward once", () => {
    const result = estimate({
      observability: aggregate({
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
      }),
      profile: {
        ...flatProfile,
        ratesMicroUsdPerMillionTokens: { input: 1, output: 1 },
      },
    });

    expect(result).toEqual({
      estimatedCostMicroUsd: 1,
      profileAsOf: flatProfile.asOf,
      profileValidThrough: flatProfile.validThrough,
      profileVersion: flatProfile.version,
      status: "estimated",
    });
  });

  it("allows flat pricing when cache telemetry is unavailable", () => {
    expect(
      estimate({
        observability: aggregate({
          cacheReadTokens: null,
          cacheReported: false,
          cacheStatus: "unavailable",
          cacheWriteTokens: null,
          inputTokens: 500_000,
          noCacheTokens: null,
          outputTokens: 250_000,
          totalTokens: 750_000,
        }),
      }),
    ).toMatchObject({
      estimatedCostMicroUsd: 1_750_000,
      status: "estimated",
    });
  });

  it.each([
    ["stream incomplete", aggregate({ incomplete: true })],
    ["missing input", aggregate({ inputReported: false })],
    ["missing output", aggregate({ outputReported: false })],
    ["missing total", aggregate({ totalReported: false })],
    ["inconsistent total", aggregate({ totalTokens: 121 })],
    [
      "adapter fallback zero-only usage",
      aggregate({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
    ],
    ["missing expected steps", aggregate({ expectedStepCount: null })],
    ["step count mismatch", aggregate({ completedStepCount: 2 })],
  ])("fails closed for flat pricing when %s", (_label, observability) => {
    expect(estimate({ observability })).toMatchObject({
      estimatedCostMicroUsd: null,
      status: "usage_incomplete",
    });
  });

  it("estimates every explicit cache tier using reported token counts", () => {
    expect(
      estimate({
        observability: aggregate({
          cacheReadTokens: 200_000,
          cacheWriteTokens: 100_000,
          inputTokens: 1_000_000,
          noCacheTokens: 700_000,
          outputTokens: 500_000,
          totalTokens: 1_500_000,
        }),
        profile: tieredProfile,
      }),
    ).toEqual({
      estimatedCostMicroUsd: 3_500_000,
      profileAsOf: tieredProfile.asOf,
      profileValidThrough: tieredProfile.validThrough,
      profileVersion: tieredProfile.version,
      status: "estimated",
    });
  });

  it.each(["unavailable", "partial", "inconsistent"] as const)(
    "fails closed for %s cache telemetry",
    (cacheStatus) => {
      expect(
        estimate({
          observability: aggregate({ cacheStatus }),
          profile: tieredProfile,
        }),
      ).toMatchObject({
        estimatedCostMicroUsd: null,
        status: "usage_incomplete",
      });
    },
  );

  it.each([
    ["unreported fields", aggregate({ cacheReported: false })],
    ["missing cache read", aggregate({ cacheReadTokens: null })],
    ["missing cache write", aggregate({ cacheWriteTokens: null })],
    ["missing no-cache", aggregate({ noCacheTokens: null })],
    ["cache read exceeds input", aggregate({ cacheReadTokens: 101 })],
    ["cache write exceeds input", aggregate({ cacheWriteTokens: 101 })],
    ["cache tiers double count written tokens", aggregate({ noCacheTokens: 75 })],
    ["tiers do not cover input", aggregate({ noCacheTokens: 64 })],
    ["stream incomplete", aggregate({ incomplete: true })],
  ])("fails closed for tiered pricing when %s", (_label, observability) => {
    expect(
      estimate({ observability, profile: tieredProfile }),
    ).toMatchObject({
      estimatedCostMicroUsd: null,
      status: "usage_incomplete",
    });
  });

  it("uses BigInt arithmetic and fails closed if the rounded cost is unsafe", () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    const result = estimate({
      observability: aggregate({
        inputTokens: maximum,
        outputTokens: 0,
        totalTokens: maximum,
      }),
      profile: {
        ...flatProfile,
        ratesMicroUsdPerMillionTokens: {
          input: maximum,
          output: maximum,
        },
      },
    });

    expect(result).toEqual({
      estimatedCostMicroUsd: null,
      profileAsOf: flatProfile.asOf,
      profileValidThrough: flatProfile.validThrough,
      profileVersion: flatProfile.version,
      status: "arithmetic_overflow",
    });
  });

  it("returns a safe integer for the largest non-overflowing exact cost", () => {
    const result = estimate({
      observability: aggregate({
        inputTokens: 1_000_000,
        outputTokens: 0,
        totalTokens: 1_000_000,
      }),
      profile: {
        ...flatProfile,
        ratesMicroUsdPerMillionTokens: {
          input: Number.MAX_SAFE_INTEGER,
          output: 0,
        },
      },
    });

    expect(result).toMatchObject({
      estimatedCostMicroUsd: Number.MAX_SAFE_INTEGER,
      status: "estimated",
    });
    expect(Number.isSafeInteger(result.estimatedCostMicroUsd)).toBe(true);
  });
});
