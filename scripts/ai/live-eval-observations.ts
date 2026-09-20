import { createHash } from "node:crypto";

import { z } from "zod";

import { chatRuntimeContextSchema } from "../../src/domain/ai/chat-runtime-context";
import { MODEL_CACHE_OBSERVATION_STATUSES } from "../../src/domain/ai/model-observability";
import { SALES_CHAT_BOUNDARY_REJECTION_REASONS } from "../../src/features/ai/constants";

export const LIVE_EVAL_OBSERVATIONS_VERSION =
  "sales-chat-live-observations-v2" as const;
export const MAX_LIVE_EVAL_OBSERVATIONS_BYTES = 8 * 1024 * 1024;
export const MAX_LIVE_EVAL_OBSERVATION_CASE_BYTES = 1024 * 1024;
export const MAX_LIVE_EVAL_RESPONSE_BYTES = 64 * 1024;
export const MAX_LIVE_EVAL_TOOL_OUTPUT_BYTES = 512 * 1024;
export const MAX_LIVE_EVAL_OBSERVATION_STEPS = 5;
export const MAX_LIVE_EVAL_STEP_TOOL_ITEMS = 8;
export const MAX_LIVE_EVAL_CASE_TOOL_ITEMS = 32;

const canonicalBytes = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value, null, 2), "utf8");

const finiteNonnegativeNumber = z.number().finite().nonnegative();
const optionalTokenMetric = z.number().int().nonnegative().nullable();
const reportedMetricSchema = z.object({
  reported: z.boolean(),
  value: finiteNonnegativeNumber.nullable(),
}).strict();
const toolIdentitySchema = z.object({
  toolCallId: z.string().min(1).max(256),
  toolName: z.string().min(1).max(100),
}).strict();

export const liveEvalObservedToolCallSchema = toolIdentitySchema.extend({
  dynamic: z.boolean(),
  input: z.json(),
  invalid: z.boolean(),
}).strict();

export const liveEvalObservedToolResultSchema = toolIdentitySchema.extend({
  output: z.json().refine(
    (value) => canonicalBytes(value) <= MAX_LIVE_EVAL_TOOL_OUTPUT_BYTES,
    "Observed tool output exceeds its byte limit.",
  ),
}).strict();

export const liveEvalObservedStepSchema = z.object({
  metric: z.object({
    observability: z.object({
      cacheStatus: z.enum(MODEL_CACHE_OBSERVATION_STATUSES),
      performance: z.object({
        modelResponseTimeMs: reportedMetricSchema,
        modelStepTimeMs: reportedMetricSchema,
        modelTimeToFirstOutputMs: reportedMetricSchema,
      }).strict(),
      tokenUsage: z.object({
        cacheReadTokens: reportedMetricSchema,
        cacheWriteTokens: reportedMetricSchema,
        inputTokens: reportedMetricSchema,
        noCacheTokens: reportedMetricSchema,
        outputTokens: reportedMetricSchema,
        totalTokens: reportedMetricSchema,
      }).strict(),
      tokenUsageComplete: z.boolean(),
    }).strict(),
    toolCallCount: z.number().int().nonnegative(),
    usage: z.object({
      inputTokens: optionalTokenMetric,
      outputTokens: optionalTokenMetric,
      totalTokens: optionalTokenMetric,
    }).strict(),
  }).strict(),
  toolCalls: z.array(liveEvalObservedToolCallSchema).max(MAX_LIVE_EVAL_STEP_TOOL_ITEMS),
  toolResults: z.array(liveEvalObservedToolResultSchema).max(MAX_LIVE_EVAL_STEP_TOOL_ITEMS),
}).strict();

export const liveEvalCaseObservationSchema = z.object({
  runtimeContext: chatRuntimeContextSchema,
  aggregateUsage: z.object({
    inputTokens: optionalTokenMetric,
    outputTokens: optionalTokenMetric,
    totalTokens: optionalTokenMetric,
  }).strict(),
  attemptCount: z.number().int().nonnegative(),
  boundaryRejections: z.array(
    z.enum(SALES_CHAT_BOUNDARY_REJECTION_REASONS),
  ).max(SALES_CHAT_BOUNDARY_REJECTION_REASONS.length).refine(
    (reasons) => new Set(reasons).size === reasons.length,
    "Observed boundary rejection reasons must be unique.",
  ),
  completedCount: z.number().int().nonnegative(),
  id: z.string().min(1).max(200),
  latencyMs: z.number().int().nonnegative(),
  responseText: z.string().refine(
    (value) => Buffer.byteLength(value, "utf8") <= MAX_LIVE_EVAL_RESPONSE_BYTES,
    "Observed response exceeds its byte limit.",
  ),
  streamCompleted: z.boolean(),
  streamErrorObserved: z.boolean(),
  steps: z.array(liveEvalObservedStepSchema).max(MAX_LIVE_EVAL_OBSERVATION_STEPS),
}).strict().superRefine((observedCase, context) => {
  const toolItems = observedCase.steps.reduce(
    (total, step) => total + step.toolCalls.length + step.toolResults.length,
    0,
  );
  if (toolItems > MAX_LIVE_EVAL_CASE_TOOL_ITEMS) {
    context.addIssue({
      code: "custom",
      message: "Observed case exceeds its tool-item limit.",
      path: ["steps"],
    });
  }
  if (canonicalBytes(observedCase) > MAX_LIVE_EVAL_OBSERVATION_CASE_BYTES) {
    context.addIssue({
      code: "custom",
      message: "Observed case exceeds its byte limit.",
    });
  }
});

export const liveEvalObservationsSchema = z.object({
  cases: z.array(liveEvalCaseObservationSchema).length(18),
  evaluatedAt: z.string().datetime({ offset: false }),
  runId: z.string().uuid(),
  version: z.literal(LIVE_EVAL_OBSERVATIONS_VERSION),
}).strict();

export type LiveEvalCaseObservation = z.infer<
  typeof liveEvalCaseObservationSchema
>;
export type LiveEvalObservations = z.infer<typeof liveEvalObservationsSchema>;

export type LiveEvalObservationsReceipt = {
  byteLength: number;
  caseCount: number;
  evaluatedAt: string;
  runId: string;
  sha256: string;
  version: typeof LIVE_EVAL_OBSERVATIONS_VERSION;
};

export type InMemoryLiveEvalObservations = {
  reportText: string;
  receipt: LiveEvalObservationsReceipt;
};

export function serializeLiveEvalObservations(
  input: LiveEvalObservations,
): InMemoryLiveEvalObservations {
  const parsed = liveEvalObservationsSchema.parse(input);
  const reportText = `${JSON.stringify(parsed, null, 2)}\n`;
  const bytes = Buffer.from(reportText, "utf8");
  try {
    if (bytes.byteLength > MAX_LIVE_EVAL_OBSERVATIONS_BYTES) {
      throw new Error("Live-eval observations exceed the total byte limit.");
    }
    return {
      receipt: {
        byteLength: bytes.byteLength,
        caseCount: parsed.cases.length,
        evaluatedAt: parsed.evaluatedAt,
        runId: parsed.runId,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        version: LIVE_EVAL_OBSERVATIONS_VERSION,
      },
      reportText,
    };
  } finally {
    bytes.fill(0);
  }
}

export function parseCanonicalLiveEvalObservations(
  reportText: string,
): LiveEvalObservations {
  if (
    Buffer.byteLength(reportText, "utf8") > MAX_LIVE_EVAL_OBSERVATIONS_BYTES
  ) {
    throw new Error("Live-eval observations exceed the total byte limit.");
  }
  const parsed = liveEvalObservationsSchema.parse(JSON.parse(reportText));
  if (`${JSON.stringify(parsed, null, 2)}\n` !== reportText) {
    throw new Error("Live-eval observations do not use canonical JSON bytes.");
  }
  return parsed;
}
