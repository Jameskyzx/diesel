import { z } from "zod";

import { chatRuntimeContextSchema } from "../../src/domain/ai/chat-runtime-context";
import { SALES_CHAT_LIVE_EVAL_VERSION } from "../../evals/sales-chat-live-cases";
import { SALES_CHAT_SYSTEM_PROMPT_VERSION } from "../../src/features/ai/constants";
import { aiModelIdSchema } from "../../src/features/ai/schemas";
import {
  liveEvalResultSchema,
  liveEvalV3ResultSchema,
  liveEvalV4ResultSchema,
  liveEvalV10ResultSchema,
  liveEvalV11ResultSchema,
  liveEvalV12ResultSchema,
  liveEvalV20ResultSchema,
  liveEvalV9ResultSchema,
} from "./live-eval-result-schema";

// Keep v7-v12 as explicit archive branches. V12 separates provider billing
// rows from completed-step observability; historical reports are never
// backfilled with semantics they did not record.
const liveEvalV7Version = "sales-chat-live-v7" as const;
const liveEvalV8Version = "sales-chat-live-v8" as const;
const liveEvalV9Version = "sales-chat-live-v9" as const;
const liveEvalV10Version = "sales-chat-live-v10" as const;
const liveEvalV11Version = "sales-chat-live-v11" as const;
const liveEvalV12Version = "sales-chat-live-v12" as const;
const liveEvalV13Version = "sales-chat-live-v13" as const;
const liveEvalV14Version = "sales-chat-live-v14" as const;
const liveEvalV15Version = "sales-chat-live-v15" as const;
const liveEvalV16Version = "sales-chat-live-v16" as const;
const liveEvalV17Version = "sales-chat-live-v17" as const;
const liveEvalV18Version = "sales-chat-live-v18" as const;
const liveEvalV19Version = "sales-chat-live-v19" as const;
const liveEvalV20Version = "sales-chat-live-v20" as const;
const liveEvalV21Version = "sales-chat-live-v21" as const;
const liveEvalV22Version = "sales-chat-live-v22" as const;
const liveEvalV23Version = "sales-chat-live-v23" as const;
const liveEvalV24Version = "sales-chat-live-v24" as const;
const liveEvalV25Version: "sales-chat-live-v25" =
  SALES_CHAT_LIVE_EVAL_VERSION;
const salesChatSystemPromptV6 = "sales-chat-system-v6" as const;
const salesChatSystemPromptV7 = "sales-chat-system-v7" as const;
const salesChatSystemPromptV8 = "sales-chat-system-v8" as const;
const salesChatSystemPromptV9: "sales-chat-system-v9" =
  SALES_CHAT_SYSTEM_PROMPT_VERSION;

const gitShaSchema = z.string().regex(/^[0-9a-f]{40}$/);
const legacyObservedScoreSchema = z.object({
  argsAccuracyPct: z.number().finite().nullable(),
  evidenceExpectationAccuracyPct: z.number().finite().nullable(),
  responseDispositionAccuracyPct: z.number().finite().nullable(),
  safetyFailClosedPct: z.number().finite().nullable(),
  toolSelectionAccuracyPct: z.number().finite().nullable(),
}).strict();
const observedScoreSchema = z.object({
  argsAccuracyPct: z.number().finite().nullable(),
  evidenceExpectationAccuracyPct: z.number().finite().nullable(),
  responseGroundingAccuracyPct: z.number().finite().nullable(),
  responseDispositionAccuracyPct: z.number().finite().nullable(),
  responseLocaleAccuracyPct: z.number().finite().nullable(),
  safetyFailClosedPct: z.number().finite().nullable(),
  toolSelectionAccuracyPct: z.number().finite().nullable(),
}).strict();
const legacyThresholdSchema = z.object({
  argsAccuracyPct: z.number().finite(),
  evidenceExpectationAccuracyPct: z.number().finite(),
  responseDispositionAccuracyPct: z.number().finite(),
  safetyFailClosedPct: z.number().finite(),
  toolSelectionAccuracyPct: z.number().finite(),
}).strict();
const thresholdSchema = z.object({
  argsAccuracyPct: z.number().finite(),
  evidenceExpectationAccuracyPct: z.number().finite(),
  responseGroundingAccuracyPct: z.number().finite(),
  responseDispositionAccuracyPct: z.number().finite(),
  responseLocaleAccuracyPct: z.number().finite(),
  safetyFailClosedPct: z.number().finite(),
  toolSelectionAccuracyPct: z.number().finite(),
}).strict();
const repositoryStateSchema = z.discriminatedUnion("worktreeState", [
  z.object({
    baseHeadCommit: gitShaSchema,
    evaluatedCommit: gitShaSchema,
    worktreeState: z.literal("clean"),
  }).strict(),
  z.object({
    baseHeadCommit: gitShaSchema,
    evaluatedCommit: z.null(),
    worktreeState: z.literal("dirty"),
  }).strict(),
  z.object({
    baseHeadCommit: z.null(),
    evaluatedCommit: z.null(),
    worktreeState: z.literal("unavailable"),
  }).strict(),
]);
const sourceFingerprintSchema = z.discriminatedUnion("status", [
  z.object({
    algorithm: z.literal("sha256"),
    digest: z.string().regex(/^[0-9a-f]{64}$/u),
    fileCount: z.number().int().positive(),
    status: z.literal("captured"),
  }).strict(),
  z.object({
    algorithm: z.literal("sha256"),
    digest: z.null(),
    fileCount: z.null(),
    status: z.literal("unavailable"),
  }).strict(),
  z.object({
    algorithm: z.literal("sha256"),
    digest: z.null(),
    fileCount: z.null(),
    status: z.literal("unstable"),
  }).strict(),
]);
export const liveEvalProviderProfileSchema = z.object({
  adapter: z.enum(["@ai-sdk/openai-compatible", "portfolio-demo"]),
  adapterContractVersion: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  enableThinking: z.boolean().nullable(),
  endpointSha256: z.string().regex(/^[0-9a-f]{64}$/u).nullable(),
  includeUsage: z.boolean(),
}).strict().superRefine((profile, context) => {
  const isDemo = profile.adapter === "portfolio-demo";
  if (
    isDemo !== (profile.endpointSha256 === null) ||
    (isDemo &&
      (profile.adapterContractVersion !== 1 ||
        profile.enableThinking !== null || profile.includeUsage)) ||
    (profile.adapterContractVersion >= 2 && profile.enableThinking !== false)
  ) {
    context.addIssue({
      code: "custom",
      message: "Provider profile fields do not match the selected adapter.",
    });
  }
});
const legacyProvenanceSchema = z.object({
  promptVersion: z.literal("sales-chat-system-v5"),
  repository: repositoryStateSchema,
  sourceFingerprint: sourceFingerprintSchema,
}).strict();
const currentProvenanceSchema = legacyProvenanceSchema.extend({
  promptVersion: z.union([
    z.literal("sales-chat-system-v5"),
    z.literal(salesChatSystemPromptV6),
    z.literal(salesChatSystemPromptV7),
    z.literal(salesChatSystemPromptV8),
    z.literal(salesChatSystemPromptV9),
  ]),
  providerProfile: liveEvalProviderProfileSchema.nullable(),
}).strict();
const budgetV3Schema = z.object({
  caseCount: z.number().int().nonnegative(),
  caseTimeoutMs: z.number().int().positive(),
  caseTokenReserve: z.number().int().positive(),
  maxCases: z.number().int().positive(),
  maxLoopStepsPerCase: z.number().int().positive(),
  maxTokens: z.number().int().positive(),
  modelStepCount: z.number().int().nonnegative(),
  tokenUsageComplete: z.boolean(),
  totalTokens: z.number().int().nonnegative(),
}).strict();
const budgetV4Schema = budgetV3Schema.extend({
  attemptCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  completedCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict();
const budgetV6Schema = budgetV4Schema.extend({
  maxRetriesPerModelCall: z.literal(0),
}).strict();
const budgetV7Schema = budgetV6Schema.extend({
  maxOutputTokensPerCall: z.number().int().positive(),
  maxPotentialOutputTokens: z.number().int().positive(),
  tokenBudgetEnforcement: z.literal("post_usage_acceptance"),
}).strict();
const safeSummaryCountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
function createMetricSummarySchema(maximum?: number) {
  const metricSchema = z.number().finite().nonnegative();
  const boundedMetricSchema = maximum === undefined
    ? metricSchema
    : metricSchema.max(maximum);
  return z
    .object({
      max: boundedMetricSchema.nullable(),
      p50: boundedMetricSchema.nullable(),
      p95: boundedMetricSchema.nullable(),
      sampleCount: safeSummaryCountSchema,
    })
    .strict()
    .superRefine((summary, context) => {
      const values = [summary.p50, summary.p95, summary.max];
      if (summary.sampleCount === 0) {
        if (values.some((value) => value !== null)) {
          context.addIssue({
            code: "custom",
            message: "Empty metric summaries must contain only null values.",
          });
        }
        return;
      }
      if (
        summary.p50 === null ||
        summary.p95 === null ||
        summary.max === null ||
        summary.p50 > summary.p95 ||
        summary.p95 > summary.max
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Non-empty metric summaries require ordered p50, p95, and max values.",
        });
      }
    });
}
const latencyMetricSummarySchema = createMetricSummarySchema();
const cacheHitMetricSummarySchema = createMetricSummarySchema(100);
export const liveEvalObservabilitySummarySchema = z
  .object({
    cacheHitRatePct: cacheHitMetricSummarySchema,
    cacheStatusCounts: z
      .object({
        inconsistent: safeSummaryCountSchema,
        partial: safeSummaryCountSchema,
        reported: safeSummaryCountSchema,
        unavailable: safeSummaryCountSchema,
      })
      .strict(),
    caseCounts: z
      .object({
        attemptCoverageComplete: safeSummaryCountSchema,
        attemptCoverageIncomplete: safeSummaryCountSchema,
        modelPerformanceComplete: safeSummaryCountSchema,
        modelPerformanceIncomplete: safeSummaryCountSchema,
        total: safeSummaryCountSchema,
      })
      .strict(),
    caseLatencyMs: latencyMetricSummarySchema,
    modelPerformance: z
      .object({
        modelResponseTimeMs: latencyMetricSummarySchema,
        modelStepTimeMs: latencyMetricSummarySchema,
        modelTimeToFirstOutputMs: latencyMetricSummarySchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((summary, context) => {
    const total = summary.caseCounts.total;
    const cacheStatusTotal = Object.values(summary.cacheStatusCounts).reduce(
      (sum, value) => sum + value,
      0,
    );
    if (!Number.isSafeInteger(cacheStatusTotal) || cacheStatusTotal !== total) {
      context.addIssue({
        code: "custom",
        message: "Cache-status counts must sum to the recorded case total.",
        path: ["cacheStatusCounts"],
      });
    }
    if (
      summary.caseCounts.attemptCoverageComplete +
          summary.caseCounts.attemptCoverageIncomplete !==
        total ||
      summary.caseCounts.modelPerformanceComplete +
          summary.caseCounts.modelPerformanceIncomplete !==
        total
    ) {
      context.addIssue({
        code: "custom",
        message: "Observability completeness counts must sum to the case total.",
        path: ["caseCounts"],
      });
    }
    if (summary.caseLatencyMs.sampleCount !== total) {
      context.addIssue({
        code: "custom",
        message: "Case-latency samples must cover every recorded case.",
        path: ["caseLatencyMs", "sampleCount"],
      });
    }
    const boundedSamples = [
      summary.cacheHitRatePct.sampleCount,
      summary.modelPerformance.modelResponseTimeMs.sampleCount,
      summary.modelPerformance.modelStepTimeMs.sampleCount,
      summary.modelPerformance.modelTimeToFirstOutputMs.sampleCount,
    ];
    if (boundedSamples.some((sampleCount) => sampleCount > total)) {
      context.addIssue({
        code: "custom",
        message: "Metric sample counts must not exceed the recorded case total.",
      });
    }
  });
const legacyTerminationReasonSchema = z.enum([
  "case_error",
  "case_limit",
  "completed",
  "initialization_error",
  "token_reserve",
  "token_usage_incomplete",
]);
const currentTerminationReasonSchema = z.union([
  legacyTerminationReasonSchema,
  z.literal("token_limit_exceeded"),
]);
const commonShape = {
  complete: z.boolean(),
  evaluatedAt: z.string().datetime(),
  modelId: aiModelIdSchema.nullable(),
  provenance: legacyProvenanceSchema,
  runId: z.string().uuid(),
  runError: z
    .object({
      code: z.literal("INITIALIZATION_ERROR"),
      errorName: z.enum([
        "AiConfigurationError",
        "Error",
        "SyntaxError",
        "TypeError",
        "UnknownError",
        "ZodError",
      ]),
      stage: z.enum([
        "module_import",
        "database",
        "model_configuration",
      ]),
    })
    .strict()
    .nullable(),
  sampleCount: z.number().int().nonnegative(),
  thresholdsPassed: z.boolean(),
  terminationReason: legacyTerminationReasonSchema,
} as const;

const capturedClockV12ResultSchema = liveEvalV12ResultSchema.safeExtend({
  runtimeContext: chatRuntimeContextSchema,
});
const capturedClockV20ResultSchema = liveEvalV20ResultSchema.safeExtend({
  runtimeContext: chatRuntimeContextSchema,
});

function capturedClockReportSchema<
  const Version extends "sales-chat-live-v14" | "sales-chat-live-v15" | "sales-chat-live-v16" | "sales-chat-live-v17" | "sales-chat-live-v18" | "sales-chat-live-v19" | "sales-chat-live-v20" | "sales-chat-live-v21" | "sales-chat-live-v22" | "sales-chat-live-v23" | "sales-chat-live-v24" | "sales-chat-live-v25",
  ResultSchema extends typeof capturedClockV12ResultSchema | typeof capturedClockV20ResultSchema,
>(version: Version, resultSchema: ResultSchema) {
  return z.object({
    ...commonShape,
    budget: budgetV7Schema,
    observability: liveEvalObservabilitySummarySchema,
    provenance: currentProvenanceSchema,
    results: z.array(resultSchema),
    scores: observedScoreSchema,
    thresholds: thresholdSchema,
    terminationReason: currentTerminationReasonSchema,
    version: z.literal(version),
  }).strict().superRefine((report, context) => {
    const evaluatedAt = Date.parse(report.evaluatedAt);
    let previousCapture = Number.NEGATIVE_INFINITY;
    for (const [index, result] of report.results.entries()) {
      const capturedAt = Date.parse(result.runtimeContext.capturedAt);
      if (capturedAt > evaluatedAt || capturedAt < previousCapture) {
        context.addIssue({
          code: "custom",
          message: "V14+ case clocks must be ordered and no later than report completion.",
          path: ["results", index, "runtimeContext", "capturedAt"],
        });
      }
      previousCapture = capturedAt;
    }
  });
}

export const liveEvalReportSchema = z.discriminatedUnion("version", [
  z.object({
    ...commonShape,
    budget: budgetV3Schema,
    results: z.array(liveEvalV3ResultSchema),
    scores: legacyObservedScoreSchema,
    thresholds: legacyThresholdSchema,
    version: z.literal("sales-chat-live-v3"),
  }).strict(),
  z.object({
    ...commonShape,
    budget: budgetV4Schema,
    results: z.array(liveEvalV4ResultSchema),
    scores: legacyObservedScoreSchema,
    thresholds: legacyThresholdSchema,
    version: z.literal("sales-chat-live-v4"),
  }).strict(),
  z.object({
    ...commonShape,
    budget: budgetV4Schema,
    provenance: currentProvenanceSchema,
    results: z.array(liveEvalResultSchema),
    scores: observedScoreSchema,
    thresholds: thresholdSchema,
    version: z.literal("sales-chat-live-v5"),
  }).strict(),
  z.object({
    ...commonShape,
    budget: budgetV6Schema,
    provenance: currentProvenanceSchema,
    results: z.array(liveEvalResultSchema),
    scores: observedScoreSchema,
    thresholds: thresholdSchema,
    version: z.literal("sales-chat-live-v6"),
  }).strict(),
  z.object({
    ...commonShape,
    budget: budgetV7Schema,
    provenance: currentProvenanceSchema,
    results: z.array(liveEvalResultSchema),
    scores: observedScoreSchema,
    terminationReason: currentTerminationReasonSchema,
    thresholds: thresholdSchema,
    version: z.literal(liveEvalV7Version),
  }).strict(),
  z.object({
    ...commonShape,
    budget: budgetV7Schema,
    provenance: currentProvenanceSchema,
    results: z.array(liveEvalResultSchema),
    scores: observedScoreSchema,
    terminationReason: currentTerminationReasonSchema,
    thresholds: thresholdSchema,
    version: z.literal(liveEvalV8Version),
  }).strict(),
  z.object({
    ...commonShape,
    budget: budgetV7Schema,
    provenance: currentProvenanceSchema,
    results: z.array(liveEvalV9ResultSchema),
    scores: observedScoreSchema,
    terminationReason: currentTerminationReasonSchema,
    thresholds: thresholdSchema,
    version: z.literal(liveEvalV9Version),
  }).strict(),
  z.object({
    ...commonShape,
    budget: budgetV7Schema,
    provenance: currentProvenanceSchema,
    results: z.array(liveEvalV10ResultSchema),
    scores: observedScoreSchema,
    terminationReason: currentTerminationReasonSchema,
    thresholds: thresholdSchema,
    version: z.literal(liveEvalV10Version),
  }).strict(),
  z.object({
    ...commonShape,
    budget: budgetV7Schema,
    observability: liveEvalObservabilitySummarySchema,
    provenance: currentProvenanceSchema,
    results: z.array(liveEvalV11ResultSchema),
    scores: observedScoreSchema,
    terminationReason: currentTerminationReasonSchema,
    thresholds: thresholdSchema,
    version: z.literal(liveEvalV11Version),
  }).strict(),
  z.object({
    ...commonShape,
    budget: budgetV7Schema,
    observability: liveEvalObservabilitySummarySchema,
    provenance: currentProvenanceSchema,
    results: z.array(liveEvalV12ResultSchema),
    scores: observedScoreSchema,
    terminationReason: currentTerminationReasonSchema,
    thresholds: thresholdSchema,
    version: z.literal(liveEvalV12Version),
  }).strict(),
  // V13 retains v12's persisted ledger semantics, but recognizes the exact
  // localized dates rendered by the app as equivalent response fact anchors.
  z.object({
    ...commonShape,
    budget: budgetV7Schema,
    observability: liveEvalObservabilitySummarySchema,
    provenance: currentProvenanceSchema,
    results: z.array(liveEvalV12ResultSchema),
    scores: observedScoreSchema,
    thresholds: thresholdSchema,
    terminationReason: currentTerminationReasonSchema,
    version: z.literal(liveEvalV13Version),
  }).strict(),
  // V14 preserves v13 archives and records the server clock used to apply
  // production input defaults. Recomputing it from the verifier's clock (or
  // the report's end time) would mis-score turns crossing UTC midnight.
  capturedClockReportSchema(liveEvalV14Version, capturedClockV12ResultSchema),
  // V15 preserves the stored clock/ledger format but versions the corrected
  // source-scope and response-claim scoring contract. V14 is not rescored.
  capturedClockReportSchema(liveEvalV15Version, capturedClockV12ResultSchema),
  // V16 requires each explicitly requested source locator concept. The stored
  // clock/ledger format is unchanged; v15 query observations are not rescored.
  capturedClockReportSchema(liveEvalV16Version, capturedClockV12ResultSchema),
  // V17 separates business query terms from delivered excerpts and locators.
  // Keep v16 independently readable; its query observations are not rescored.
  capturedClockReportSchema(liveEvalV17Version, capturedClockV12ResultSchema),
  // V18 recognizes additional semantically equivalent response anchor forms.
  // Keep v17 independently readable without rewriting its lexical judgements.
  capturedClockReportSchema(liveEvalV18Version, capturedClockV12ResultSchema),
  // V19 recognizes additional equivalent regulation-topic wording. Preserve
  // the stored v18 contract without reinterpreting its lexical judgements.
  capturedClockReportSchema(liveEvalV19Version, capturedClockV12ResultSchema),
  // V20 explicitly distinguishes unavailable execution-error tool traces from
  // complete traces while retaining known anonymous step/billing telemetry.
  capturedClockReportSchema(liveEvalV20Version, capturedClockV20ResultSchema),
  // V21 changes scoring semantics, not persisted tool-trace/clock fields.
  // Keep v20 readable without applying the new scorer to its observations.
  capturedClockReportSchema(liveEvalV21Version, capturedClockV20ResultSchema),
  // V22 distinguishes supported nested-list prose from indented code during
  // scoring. V21 remains readable with its original stored judgements.
  capturedClockReportSchema(liveEvalV22Version, capturedClockV20ResultSchema),
  // V23 corrects the bounded bare-URL scoring projection. Keep v22's stored
  // contract independently readable without rescoring its observations.
  capturedClockReportSchema(liveEvalV23Version, capturedClockV20ResultSchema),
  // V24 corrects bounded supply-readiness and inline-URL scoring semantics.
  // V23 retains its original stored judgements and is never rescored here.
  capturedClockReportSchema(liveEvalV24Version, capturedClockV20ResultSchema),
  // V25 changes bounded response scoring, not persisted clock/trace fields.
  // Keep v24 readable with its original stored judgements, never rescored.
  capturedClockReportSchema(liveEvalV25Version, capturedClockV20ResultSchema),
]);
