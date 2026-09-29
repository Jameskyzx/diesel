import { isDeepStrictEqual } from "node:util";

import { z, type RefinementCtx } from "zod";

import {
  LIVE_EVAL_DETECTED_RESPONSE_LOCALES,
  LIVE_EVAL_RESPONSE_DISPOSITIONS,
  liveEvalResponseDispositionPassed,
  recomputeLiveEvalCaseTokenUsage,
  type LiveEvalResultErrorCode,
} from "../../src/domain/ai/live-eval";
import { buildLiveEvalCaseObservability } from "../../src/domain/ai/live-eval-observability";
import {
  deriveNormalizedModelStepTokenUsageComplete,
  MODEL_CACHE_OBSERVATION_STATUSES,
  normalizedModelStepCacheStatusMatchesMetrics,
} from "../../src/domain/ai/model-observability";
import {
  findCompatibleProductsInputSchema,
  getCountryProfileInputSchema,
  searchKnowledgeBaseInputSchema,
} from "../../src/features/ai/schemas";
import {
  calculateOpportunityScoreInputSchema,
  compareMarketsInputSchema,
  compareRegulationsInputSchema,
  generateSalesBriefInputSchema,
} from "../../src/features/marketing/schemas";
import { SAFE_LIVE_EVAL_ERROR_NAMES } from "../ai/live-eval-error";
import { recomputeLiveEvalCaseTokenUsageWithProviderAttempts } from "../ai/live-eval-token-usage";
import { locales } from "../../src/i18n/locale";

const safeCountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const reportedTokenMetricSchema = z
  .object({
    reported: z.boolean(),
    value: safeCountSchema.nullable(),
  })
  .strict();
const reportedPerformanceMetricSchema = z
  .object({
    reported: z.boolean(),
    value: z.number().finite().nonnegative().nullable(),
  })
  .strict();
const normalizedStepTokenMetricSchema = reportedTokenMetricSchema.superRefine(
  (metric, context) => {
    if (!metric.reported && metric.value !== null) {
      context.addIssue({
        code: "custom",
        message: "Unreported step token metrics must not contain a value.",
        path: ["value"],
      });
    }
  },
);
const normalizedStepPerformanceMetricSchema =
  reportedPerformanceMetricSchema.superRefine((metric, context) => {
    if (!metric.reported && metric.value !== null) {
      context.addIssue({
        code: "custom",
        message: "Unreported step performance metrics must not contain a value.",
        path: ["value"],
      });
    }
  });
const normalizedModelStepObservationSchema = z
  .object({
    cacheStatus: z.enum(MODEL_CACHE_OBSERVATION_STATUSES),
    performance: z
      .object({
        modelResponseTimeMs: normalizedStepPerformanceMetricSchema,
        modelStepTimeMs: normalizedStepPerformanceMetricSchema,
        modelTimeToFirstOutputMs: normalizedStepPerformanceMetricSchema,
      })
      .strict(),
    tokenUsage: z
      .object({
        cacheReadTokens: normalizedStepTokenMetricSchema,
        cacheWriteTokens: normalizedStepTokenMetricSchema,
        inputTokens: normalizedStepTokenMetricSchema,
        noCacheTokens: normalizedStepTokenMetricSchema,
        outputTokens: normalizedStepTokenMetricSchema,
        totalTokens: normalizedStepTokenMetricSchema,
      })
      .strict(),
    tokenUsageComplete: z.boolean(),
  })
  .strict()
  .superRefine((step, context) => {
    const expectedTokenUsageComplete =
      deriveNormalizedModelStepTokenUsageComplete(step.tokenUsage);
    if (step.tokenUsageComplete !== expectedTokenUsageComplete) {
      context.addIssue({
        code: "custom",
        message:
          "Step tokenUsageComplete must be derived from retained base-token metrics.",
        path: ["tokenUsageComplete"],
      });
    }
    if (!normalizedModelStepCacheStatusMatchesMetrics(step)) {
      context.addIssue({
        code: "custom",
        message:
          "Step cacheStatus is incompatible with retained cache metrics.",
        path: ["cacheStatus"],
      });
    }
  });
const modelObservabilityAggregateSchema = z
  .object({
    cacheHitRatePct: z.number().finite().min(0).max(100).nullable(),
    cacheStatus: z.enum(MODEL_CACHE_OBSERVATION_STATUSES),
    completedStepCount: safeCountSchema,
    expectedStepCount: safeCountSchema.nullable(),
    incomplete: z.boolean(),
    performance: z
      .object({
        modelResponseTimeMs: reportedPerformanceMetricSchema,
        modelStepTimeMs: reportedPerformanceMetricSchema,
        modelTimeToFirstOutputMs: reportedPerformanceMetricSchema,
      })
      .strict(),
    tokenUsage: z
      .object({
        cacheReadTokens: reportedTokenMetricSchema,
        cacheWriteTokens: reportedTokenMetricSchema,
        inputTokens: reportedTokenMetricSchema,
        noCacheTokens: reportedTokenMetricSchema,
        outputTokens: reportedTokenMetricSchema,
        totalTokens: reportedTokenMetricSchema,
      })
      .strict(),
  })
  .strict();
export const liveEvalCaseModelObservabilitySchema = z
  .object({
    aggregate: modelObservabilityAggregateSchema,
    attemptCoverageComplete: z.boolean(),
    modelPerformanceComplete: z.boolean(),
    steps: z.array(normalizedModelStepObservationSchema),
  })
  .strict();
const liveEvalResponseAnchorIdSchema = z
  .string()
  .regex(/^(?:fact|decision|disclaimer):[a-z0-9][a-z0-9._-]*$/u);

const liveEvalToolNameSchema = z.enum([
  "calculateOpportunityScore",
  "compareMarkets",
  "compareRegulations",
  "findCompatibleProducts",
  "generateSalesBrief",
  "getCountryProfile",
  "searchKnowledgeBase",
]);
const liveEvalAllowedArgKeys = new Set([
  "applicationScope",
  "asOf",
  "countryIso3",
  "countryIso3s",
  "jurisdictionId",
  "limit",
  "metricCodes",
  "powerKw",
  "productModelCode",
  "query",
  "targetCountryIso3",
  "topics",
]);
const sanitizedLiveEvalArgsSchema = z
  .record(z.string(), z.unknown())
  .superRefine((args, context) => {
    for (const key of Object.keys(args)) {
      if (!liveEvalAllowedArgKeys.has(key)) {
        context.addIssue({
          code: "custom",
          message: `Unexpected live-eval argument key: ${key}.`,
        });
      }
    }
  });
export const liveEvalQueryFingerprintSchema = z
  .object({
    algorithm: z.literal("sha256"),
    characterCount: z.number().int().min(1).max(500),
    digest: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  .strict();
const liveEvalProductFingerprintSchema = liveEvalQueryFingerprintSchema.extend({
  // The production input caps the pre-transform string at 100 code points,
  // while Unicode uppercasing can expand one code point to three.
  characterCount: z.number().int().min(1).max(300),
}).strict();
const liveEvalMetricFingerprintSchema = liveEvalQueryFingerprintSchema.extend({
  characterCount: z.number().int().min(1).max(80),
}).strict();
const liveEvalUuidFingerprintSchema = liveEvalQueryFingerprintSchema.extend({
  characterCount: z.literal(36),
}).strict();
const liveEvalQueryTermIdSchema = z
  .string()
  .regex(/^query:[a-z0-9][a-z0-9._-]*$/u);
export const liveEvalV10QueryObservationSchema =
  liveEvalQueryFingerprintSchema
    .extend({
      expectationPassed: z.boolean(),
      matchedForbiddenTermIds: z.array(liveEvalQueryTermIdSchema).max(16),
      matchedRequiredTermIds: z.array(liveEvalQueryTermIdSchema).max(16),
      missingRequiredTermIds: z.array(liveEvalQueryTermIdSchema).max(16),
    })
    .strict()
    .superRefine((observation, context) => {
      const allIds = [
        ...observation.matchedForbiddenTermIds,
        ...observation.matchedRequiredTermIds,
        ...observation.missingRequiredTermIds,
      ];
      if (new Set(allIds).size !== allIds.length) {
        context.addIssue({
          code: "custom",
          message: "Query-contract observation IDs must be unique and disjoint.",
        });
      }
      const expectedPass =
        observation.missingRequiredTermIds.length === 0 &&
        observation.matchedForbiddenTermIds.length === 0;
      if (observation.expectationPassed !== expectedPass) {
        context.addIssue({
          code: "custom",
          message:
            "Query-contract pass must agree with missing and forbidden term observations.",
          path: ["expectationPassed"],
        });
      }
    });
const sanitizedV9LiveEvalArgsSchema = sanitizedLiveEvalArgsSchema.superRefine(
  (args, context) => {
    if (
      Object.hasOwn(args, "query") &&
      !liveEvalQueryFingerprintSchema.safeParse(args.query).success
    ) {
      context.addIssue({
        code: "custom",
        message: "Persisted live-eval queries must be SHA-256 fingerprints.",
        path: ["query"],
      });
    }
  },
);
const sanitizedV10LiveEvalArgsSchema = sanitizedLiveEvalArgsSchema.superRefine(
  (args, context) => {
    if (Object.keys(args).length === 0) {
      return;
    }
    if (
      Object.hasOwn(args, "query") &&
      !liveEvalV10QueryObservationSchema.safeParse(args.query).success
    ) {
      context.addIssue({
        code: "custom",
        message: "V10 search queries require a redacted contract observation.",
        path: ["query"],
      });
    }
    if (
      Object.hasOwn(args, "productModelCode") &&
      !liveEvalProductFingerprintSchema.safeParse(args.productModelCode).success
    ) {
      context.addIssue({
        code: "custom",
        message: "V10 product model codes must be fingerprinted.",
        path: ["productModelCode"],
      });
    }
    if (
      Object.hasOwn(args, "jurisdictionId") &&
      args.jurisdictionId !== null &&
      !liveEvalUuidFingerprintSchema.safeParse(args.jurisdictionId).success
    ) {
      context.addIssue({
        code: "custom",
        message: "V10 jurisdiction IDs must be fingerprinted.",
        path: ["jurisdictionId"],
      });
    }
    if (Object.hasOwn(args, "metricCodes")) {
      const parsedMetrics = z
        .array(liveEvalMetricFingerprintSchema)
        .min(1)
        .max(8)
        .safeParse(args.metricCodes);
      if (!parsedMetrics.success) {
        context.addIssue({
          code: "custom",
          message: "V10 metric codes must be fingerprinted.",
          path: ["metricCodes"],
        });
      } else if (
        new Set(parsedMetrics.data.map(({ digest }) => digest)).size !==
          parsedMetrics.data.length
      ) {
        context.addIssue({
          code: "custom",
          message: "V10 metric-code fingerprints must be unique.",
          path: ["metricCodes"],
        });
      }
    }
  },
);
const safeEvalFailureMessageSchema = z
  .string()
  .regex(
    new RegExp(
      `^(?:${SAFE_LIVE_EVAL_ERROR_NAMES.join("|")})(?: \\(HTTP [45]\\d{2}\\))?: Eval case execution failed\\.$`,
      "u",
    ),
  )
  .nullable();
const liveEvalToolInputSchemas = {
  calculateOpportunityScore: calculateOpportunityScoreInputSchema,
  compareMarkets: compareMarketsInputSchema,
  compareRegulations: compareRegulationsInputSchema,
  findCompatibleProducts: findCompatibleProductsInputSchema,
  generateSalesBrief: generateSalesBriefInputSchema,
  getCountryProfile: getCountryProfileInputSchema,
  searchKnowledgeBase: searchKnowledgeBaseInputSchema,
} as const;
const liveEvalNormalizedArgSchema = z
  .object({
    args: sanitizedLiveEvalArgsSchema,
    tool: liveEvalToolNameSchema,
  })
  .strict()
  .superRefine((call, context) => {
    const parsed = liveEvalToolInputSchemas[call.tool].safeParse(call.args);
    if (!parsed.success) {
      context.addIssue({
        code: "custom",
        message: `Invalid normalized arguments for ${call.tool}.`,
        path: ["args"],
      });
    }
  });
const liveEvalV9NormalizedArgSchema = z
  .object({
    args: sanitizedV9LiveEvalArgsSchema,
    tool: liveEvalToolNameSchema,
  })
  .strict()
  .superRefine((call, context) => {
    if (call.tool === "searchKnowledgeBase") {
      const { query, ...nonQueryArgs } = call.args;
      if (!liveEvalQueryFingerprintSchema.safeParse(query).success) {
        context.addIssue({
          code: "custom",
          message:
            "searchKnowledgeBase reports require fingerprinted query metadata.",
          path: ["args", "query"],
        });
        return;
      }
      const parsed = searchKnowledgeBaseInputSchema.safeParse({
        ...nonQueryArgs,
        query: "redacted",
      });
      if (!parsed.success) {
        context.addIssue({
          code: "custom",
          message: "Invalid normalized arguments for searchKnowledgeBase.",
          path: ["args"],
        });
      }
      return;
    }

    const parsed = liveEvalToolInputSchemas[call.tool].safeParse(call.args);
    if (!parsed.success) {
      context.addIssue({
        code: "custom",
        message: `Invalid normalized arguments for ${call.tool}.`,
        path: ["args"],
      });
    }
  });
const liveEvalV10NormalizedArgSchema = z
  .object({
    args: sanitizedV10LiveEvalArgsSchema,
    tool: liveEvalToolNameSchema,
  })
  .strict()
  .superRefine((call, context) => {
    if (Object.keys(call.args).length === 0) {
      return;
    }

    const reconstructedArgs = { ...call.args };
    if (Object.hasOwn(reconstructedArgs, "query")) {
      reconstructedArgs.query = "redacted";
    }
    if (Object.hasOwn(reconstructedArgs, "productModelCode")) {
      reconstructedArgs.productModelCode = "REDACTED";
    }
    if (
      Object.hasOwn(reconstructedArgs, "jurisdictionId") &&
      reconstructedArgs.jurisdictionId !== null
    ) {
      reconstructedArgs.jurisdictionId =
        "00000000-0000-4000-8000-000000000001";
    }
    if (Array.isArray(reconstructedArgs.metricCodes)) {
      reconstructedArgs.metricCodes = reconstructedArgs.metricCodes.map(
        (_, index) => `REDACTED_METRIC_${index + 1}`,
      );
    }

    const parsed = liveEvalToolInputSchemas[call.tool].safeParse(
      reconstructedArgs,
    );
    if (!parsed.success) {
      context.addIssue({
        code: "custom",
        message: `Invalid v10 normalized arguments for ${call.tool}.`,
        path: ["args"],
      });
    }
  });

const liveEvalResultBaseSchema = z
  .object({
    argsPassed: z.boolean(),
    errorCode: z.enum(["EVAL_CASE_ERROR", "TOOL_RESULT_ERROR"]).nullable(),
    evidenceAllowed: z.boolean(),
    evidenceExpectationPassed: z.boolean(),
    evidenceResult: z.enum(["sufficient", "insufficient", "error"]),
    expectedEvidenceAllowed: z.boolean(),
    failureMessage: safeEvalFailureMessageSchema,
    id: z.string().min(1),
    latencyMs: z.number().int().nonnegative(),
    loopSteps: z.number().int().nonnegative(),
    mismatchReason: z.string().min(1).nullable(),
    normalizedArgs: z.array(liveEvalNormalizedArgSchema),
    pass: z.boolean(),
    responseCharacterCount: z.number().int().nonnegative(),
    responseDisposition: z.enum(LIVE_EVAL_RESPONSE_DISPOSITIONS),
    responseDispositionPassed: z.boolean(),
    safetyCritical: z.boolean(),
    safetyPassed: z.boolean().nullable(),
    tokenUsage: z
      .object({
        input: z.number().int().nonnegative().nullable(),
        ledger: z.array(
          z
            .object({
              input: z.number().int().nonnegative().nullable(),
              output: z.number().int().nonnegative().nullable(),
              total: z.number().int().nonnegative().nullable(),
            })
            .strict(),
        ),
        output: z.number().int().nonnegative().nullable(),
        total: z.number().int().nonnegative().nullable(),
        usageComplete: z.boolean(),
      })
      .strict(),
    toolBearingSteps: z.number().int().nonnegative(),
    toolSelectionPassed: z.boolean(),
    toolSequence: z.array(liveEvalToolNameSchema),
  })
  .strict();

type LiveEvalResultBase = z.infer<typeof liveEvalResultBaseSchema>;
type LiveEvalResultValidationInput = Omit<LiveEvalResultBase, "errorCode"> & {
  errorCode: LiveEvalResultErrorCode | null;
};

function validateCommonLiveEvalResult(
  result: LiveEvalResultValidationInput,
  context: RefinementCtx,
): void {
  const expectsFailureMessage = result.errorCode === "EVAL_CASE_ERROR";
  if (expectsFailureMessage !== (result.failureMessage !== null)) {
    context.addIssue({
      code: "custom",
      message:
        "failureMessage must be present only for EVAL_CASE_ERROR results.",
      path: ["failureMessage"],
    });
  }
  const completed = result.errorCode === null;
  const expectedDispositionPassed = liveEvalResponseDispositionPassed({
    completed,
    expectedEvidenceAllowed: result.expectedEvidenceAllowed,
    responseDisposition: result.responseDisposition,
  });
  if (result.responseDispositionPassed !== expectedDispositionPassed) {
    context.addIssue({
      code: "custom",
      message: "responseDispositionPassed does not match the safe classification.",
      path: ["responseDispositionPassed"],
    });
  }
  if (!completed && result.responseDisposition !== "not_evaluated") {
    context.addIssue({
      code: "custom",
      message: "Errored cases must not claim an evaluated response disposition.",
      path: ["responseDisposition"],
    });
  }
  if (completed && result.responseDisposition === "not_evaluated") {
    context.addIssue({
      code: "custom",
      message: "Completed cases require an evaluated response disposition.",
      path: ["responseDisposition"],
    });
  }
  if (
    completed &&
    (result.responseCharacterCount === 0) !==
      (result.responseDisposition === "empty")
  ) {
    context.addIssue({
      code: "custom",
      message:
        "responseCharacterCount must agree with the empty response disposition.",
      path: ["responseCharacterCount"],
    });
  }
}

export const liveEvalV3ResultSchema = liveEvalResultBaseSchema.superRefine(
  (result, context) => {
    validateCommonLiveEvalResult(result, context);
    const recomputedTokenUsage = recomputeLiveEvalCaseTokenUsage({
      aggregate: result.tokenUsage,
      ledger: result.tokenUsage.ledger,
      loopSteps: result.loopSteps,
      modelStreamCompleted: result.errorCode !== "EVAL_CASE_ERROR",
    }).tokenUsage;
    if (
      result.tokenUsage.usageComplete !== recomputedTokenUsage.usageComplete
    ) {
      context.addIssue({
        code: "custom",
        message: "tokenUsage.usageComplete does not match the token ledger.",
        path: ["tokenUsage", "usageComplete"],
      });
    }
  },
);

const liveEvalV4ResultBaseSchema = liveEvalResultBaseSchema.extend({
  attemptCount: safeCountSchema,
  completedCount: safeCountSchema,
  locale: z.enum(locales),
}).strict();

type LiveEvalV4ResultBase = z.infer<typeof liveEvalV4ResultBaseSchema>;
type LiveEvalV4ResultValidationInput = Omit<
  LiveEvalV4ResultBase,
  "errorCode"
> & {
  errorCode: LiveEvalResultErrorCode | null;
};

function validateLiveEvalProviderResult(
  result: LiveEvalV4ResultValidationInput,
  context: RefinementCtx,
): void {
  validateCommonLiveEvalResult(result, context);
  if (result.completedCount > result.attemptCount) {
    context.addIssue({
      code: "custom",
      message: "completedCount must not exceed attemptCount.",
      path: ["completedCount"],
    });
  }
  const recomputedTokenUsage =
    recomputeLiveEvalCaseTokenUsageWithProviderAttempts({
      aggregate: result.tokenUsage,
      attemptCount: result.attemptCount,
      completedCount: result.completedCount,
      ledger: result.tokenUsage.ledger,
      loopSteps: result.loopSteps,
      modelStreamCompleted: result.errorCode !== "EVAL_CASE_ERROR",
    }).tokenUsage;
  if (result.tokenUsage.usageComplete !== recomputedTokenUsage.usageComplete) {
    context.addIssue({
      code: "custom",
      message: "tokenUsage.usageComplete does not match the token ledger.",
      path: ["tokenUsage", "usageComplete"],
    });
  }
}

export const liveEvalV4ResultSchema = liveEvalV4ResultBaseSchema.superRefine(
  validateLiveEvalProviderResult,
);

const liveEvalCurrentResultExtension = {
  detectedResponseLocale: z.enum(LIVE_EVAL_DETECTED_RESPONSE_LOCALES),
  matchedResponseAnchorIds: z.array(liveEvalResponseAnchorIdSchema),
  missingResponseAnchorIds: z.array(liveEvalResponseAnchorIdSchema),
  responseGroundingPassed: z.boolean(),
  responseLocalePassed: z.boolean(),
} as const;
const liveEvalCurrentResultBaseSchema = liveEvalV4ResultBaseSchema
  .extend({
    ...liveEvalCurrentResultExtension,
  })
  .strict();

type LiveEvalCurrentResultBase = z.infer<
  typeof liveEvalCurrentResultBaseSchema
>;
type LiveEvalCurrentResultValidationInput = Omit<
  LiveEvalCurrentResultBase,
  "errorCode"
> & {
  errorCode: LiveEvalResultErrorCode | null;
};

function validateLiveEvalCurrentResult(
  result: LiveEvalCurrentResultValidationInput,
  context: RefinementCtx,
): void {
  validateLiveEvalProviderResult(result, context);
  const allAnchorIds = [
    ...result.matchedResponseAnchorIds,
    ...result.missingResponseAnchorIds,
  ];
  if (new Set(allAnchorIds).size !== allAnchorIds.length) {
    context.addIssue({
      code: "custom",
      message: "Response anchor observations must be unique and disjoint.",
      path: ["matchedResponseAnchorIds"],
    });
  }
  if (
    result.responseGroundingPassed !==
      (result.missingResponseAnchorIds.length === 0)
  ) {
    context.addIssue({
      code: "custom",
      message:
        "responseGroundingPassed must agree with the missing anchor observations.",
      path: ["responseGroundingPassed"],
    });
  }
  if (
    result.responseLocalePassed !==
      (result.detectedResponseLocale === result.locale)
  ) {
    context.addIssue({
      code: "custom",
      message:
        "responseLocalePassed must agree with the detected and expected locales.",
      path: ["responseLocalePassed"],
    });
  }
  if (
    result.errorCode !== null &&
    (
      result.detectedResponseLocale !== "indeterminate" ||
      result.matchedResponseAnchorIds.length > 0 ||
      result.responseGroundingPassed ||
      result.responseLocalePassed
    )
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Errored cases must fail closed without claiming response-contract observations.",
      path: ["detectedResponseLocale"],
    });
  }
}

export const liveEvalResultSchema = liveEvalCurrentResultBaseSchema.superRefine(
  validateLiveEvalCurrentResult,
);

export const liveEvalV9ResultSchema = liveEvalCurrentResultBaseSchema
  .extend({
    normalizedArgs: z.array(liveEvalV9NormalizedArgSchema),
  })
  .strict()
  .superRefine(validateLiveEvalCurrentResult);

const liveEvalV10ResultBaseSchema = liveEvalCurrentResultBaseSchema
  .extend({
    normalizedArgs: z.array(liveEvalV10NormalizedArgSchema),
  })
  .strict();

type LiveEvalV10ResultBase = z.infer<typeof liveEvalV10ResultBaseSchema>;
type LiveEvalV10ResultValidationInput = Omit<
  LiveEvalV10ResultBase,
  "errorCode"
> & {
  errorCode: LiveEvalResultErrorCode | null;
};

function validateLiveEvalV10Result(
  result: LiveEvalV10ResultValidationInput,
  context: RefinementCtx,
): void {
  validateLiveEvalCurrentResult(result, context);
  const hasInvalidInputSentinel = result.normalizedArgs.some(
    ({ args }) => Object.keys(args).length === 0,
  );
  if (
    hasInvalidInputSentinel &&
    result.errorCode !== "TOOL_RESULT_ERROR" &&
    result.errorCode !== "EVAL_BUDGET_STOP"
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Invalid-input sentinels require a tool-result error or a terminal budget stop.",
      path: ["errorCode"],
    });
  }
}

export const liveEvalV10ResultSchema = liveEvalV10ResultBaseSchema.superRefine(
  validateLiveEvalV10Result,
);

const liveEvalV11ResultBaseSchema = liveEvalV10ResultBaseSchema
  .extend({
    errorCode: z
      .enum(["EVAL_BUDGET_STOP", "EVAL_CASE_ERROR", "TOOL_RESULT_ERROR"])
      .nullable(),
    modelObservability: liveEvalCaseModelObservabilitySchema,
  })
  .strict();

// V11 is permanently bound to the production five-step loop contract under
// which its reports were created. A larger loop requires a report-version bump.
const liveEvalV11MaxCompletedModelSteps = 5;

function validateLiveEvalBudgetStopResult(
  result: LiveEvalV10ResultValidationInput & {
    errorCode: "EVAL_BUDGET_STOP" | "EVAL_CASE_ERROR" | "TOOL_RESULT_ERROR" | null;
  },
  context: RefinementCtx,
  version: "V11" | "V12",
): void {
  if (result.errorCode !== "EVAL_BUDGET_STOP") {
    return;
  }
  const expectedMismatchReason = result.tokenUsage.usageComplete
    ? "error:EVAL_BUDGET_STOP"
    : "error:EVAL_BUDGET_STOP,token_usage";
  const expectedSafetyPassed = result.safetyCritical ? false : null;
  if (
    result.evidenceExpectationPassed ||
    result.evidenceResult !== "error" ||
    result.mismatchReason !== expectedMismatchReason ||
    result.pass ||
    result.safetyPassed !== expectedSafetyPassed
  ) {
    context.addIssue({
      code: "custom",
      message:
        `${version} budget-stop results must remain a recomputable, non-passing terminal observation.`,
      path: ["errorCode"],
    });
  }
}

export const liveEvalV11ResultSchema = liveEvalV11ResultBaseSchema.superRefine(
  (result, context) => {
    validateLiveEvalV10Result(result, context);
    validateLiveEvalBudgetStopResult(result, context, "V11");
    const recomputed = buildLiveEvalCaseObservability({
      attemptCount: result.attemptCount,
      completedCount: result.completedCount,
      expectedStepCount: result.loopSteps,
      modelStreamCompleted: result.errorCode !== "EVAL_CASE_ERROR",
      steps: result.modelObservability.steps,
    });
    if (!isDeepStrictEqual(result.modelObservability, recomputed)) {
      context.addIssue({
        code: "custom",
        message:
          "V11 model observability must be recomputable from its normalized step rows.",
        path: ["modelObservability"],
      });
    }
    const observationStepCount = result.modelObservability.steps.length;
    const ledgerStepCount = result.tokenUsage.ledger.length;
    if (
      result.completedCount !== result.loopSteps ||
      result.completedCount !== ledgerStepCount ||
      result.completedCount !== observationStepCount
    ) {
      context.addIssue({
        code: "custom",
        message:
          "V11 completed calls, loop steps, token-ledger rows, and observability rows must align.",
        path: ["modelObservability", "steps"],
      });
      return;
    }
    if (result.completedCount > liveEvalV11MaxCompletedModelSteps) {
      context.addIssue({
        code: "custom",
        message: "V11 completed model calls must remain within the five-step loop.",
        path: ["completedCount"],
      });
    }
    for (const [index, step] of result.modelObservability.steps.entries()) {
      const ledgerStep = result.tokenUsage.ledger[index];
      if (
        !ledgerStep ||
        step.tokenUsage.inputTokens.value !== ledgerStep.input ||
        step.tokenUsage.outputTokens.value !== ledgerStep.output ||
        step.tokenUsage.totalTokens.value !== ledgerStep.total
      ) {
        context.addIssue({
          code: "custom",
          message:
            "V11 model observability base tokens must match the token ledger.",
          path: ["modelObservability", "steps", index, "tokenUsage"],
        });
      }
    }
  },
);

// V12 keeps the v11 JSON fields but assigns the two row collections their
// actual meanings: tokenUsage.ledger is provider-call billing, while
// modelObservability.steps contains only SDK steps that reached onStepEnd.
export const liveEvalV12ResultSchema = liveEvalV11ResultBaseSchema.superRefine(
  (result, context) => {
    validateLiveEvalV10Result(result, context);
    validateLiveEvalBudgetStopResult(result, context, "V12");
    const recomputed = buildLiveEvalCaseObservability({
      attemptCount: result.attemptCount,
      completedCount: result.completedCount,
      expectedStepCount: result.loopSteps,
      modelStreamCompleted: result.errorCode !== "EVAL_CASE_ERROR",
      steps: result.modelObservability.steps,
    });
    if (!isDeepStrictEqual(result.modelObservability, recomputed)) {
      context.addIssue({
        code: "custom",
        message:
          "V12 model observability must be recomputable from its completed-step rows.",
        path: ["modelObservability"],
      });
    }

    const completedStepCount = result.modelObservability.steps.length;
    const providerBillingCallCount = result.tokenUsage.ledger.length;
    if (
      result.loopSteps !== completedStepCount ||
      result.completedCount !== providerBillingCallCount
    ) {
      context.addIssue({
        code: "custom",
        message:
          "V12 loop steps must match completed-step rows and completed provider calls must match billing rows.",
        path: ["modelObservability", "steps"],
      });
      return;
    }
    if (
      result.completedCount < completedStepCount ||
      result.completedCount - completedStepCount > 1
    ) {
      context.addIssue({
        code: "custom",
        message:
          "V12 can retain only one terminal provider call that finished before its SDK step.",
        path: ["completedCount"],
      });
    }
    if (
      result.completedCount > liveEvalV11MaxCompletedModelSteps ||
      completedStepCount > liveEvalV11MaxCompletedModelSteps
    ) {
      context.addIssue({
        code: "custom",
        message:
          "V12 provider calls and completed model steps must remain within the five-step loop.",
        path: ["completedCount"],
      });
    }

    const alignedRowCount = Math.min(
      completedStepCount,
      providerBillingCallCount,
    );
    for (let index = 0; index < alignedRowCount; index += 1) {
      const step = result.modelObservability.steps[index];
      const billingCall = result.tokenUsage.ledger[index];
      if (
        !step ||
        !billingCall ||
        step.tokenUsage.inputTokens.value !== billingCall.input ||
        step.tokenUsage.outputTokens.value !== billingCall.output ||
        step.tokenUsage.totalTokens.value !== billingCall.total
      ) {
        context.addIssue({
          code: "custom",
          message:
            "V12 aligned completed-step base tokens must match provider billing.",
          path: ["modelObservability", "steps", index, "tokenUsage"],
        });
      }
    }
  },
);

// V20 distinguishes an unavailable execution-error trace from an observed
// empty trace. Counts/usage survive SDK aborts even when all summary promises
// reject, but those metrics cannot establish tool identities or arguments.
export const liveEvalV20ResultSchema = liveEvalV12ResultSchema.safeExtend({
  toolTraceStatus: z.enum(["complete", "unavailable"]),
}).superRefine((result, context) => {
  const unavailable = result.toolTraceStatus === "unavailable";
  if (unavailable !== (result.errorCode === "EVAL_CASE_ERROR")) {
    context.addIssue({
      code: "custom",
      message: "V20 unavailable tool traces are required only for execution errors.",
      path: ["toolTraceStatus"],
    });
  }
  if (result.toolBearingSteps > result.loopSteps) {
    context.addIssue({
      code: "custom",
      message: "V20 tool-bearing steps cannot exceed known completed loop steps.",
      path: ["toolBearingSteps"],
    });
  }
  if (unavailable) {
    if (
      result.toolSequence.length !== 0 || result.normalizedArgs.length !== 0 ||
      result.argsPassed || result.toolSelectionPassed || result.pass ||
      result.evidenceAllowed || result.evidenceExpectationPassed ||
      result.evidenceResult !== "error" ||
      result.responseDisposition !== "not_evaluated" ||
      result.responseDispositionPassed || result.responseCharacterCount !== 0 ||
      result.responseGroundingPassed || result.responseLocalePassed ||
      result.detectedResponseLocale !== "indeterminate" ||
      result.matchedResponseAnchorIds.length !== 0 ||
      result.safetyPassed !== (result.safetyCritical ? false : null) ||
      result.tokenUsage.usageComplete ||
      result.mismatchReason !== "error:EVAL_CASE_ERROR,token_usage"
    ) {
      context.addIssue({
        code: "custom",
        message: "V20 unavailable tool traces must remain an unscored execution-error sentinel.",
        path: ["toolTraceStatus"],
      });
    }
  } else if (
    (result.toolSequence.length === 0) !== (result.toolBearingSteps === 0)
  ) {
    context.addIssue({
      code: "custom",
      message: "V20 complete tool traces must agree with tool-bearing step telemetry.",
      path: ["toolBearingSteps"],
    });
  }
});
