import "server-only";

import { z } from "zod";

import { MODEL_COST_ESTIMATE_STATUSES } from "@/domain/ai/model-cost";

const requestIdSchema = z.uuid();
const errorCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Z][A-Z0-9_]*$/u)
  .nullable();

const apiRequestLogSchema = z
  .object({
    durationMs: z.number().finite().nonnegative(),
    errorCode: errorCodeSchema,
    event: z.literal("api.request"),
    requestId: requestIdSchema,
    route: z.string().trim().min(1).max(160).regex(/^\/api\//u),
    status: z.number().int().min(100).max(599),
    timestamp: z.iso.datetime({ offset: true }),
  })
  .strict();

const aiCompletionLogSchema = z
  .object({
    cacheHitRatePct: z.number().finite().min(0).max(100).nullable(),
    cacheReadTokens: z.number().int().nonnegative().nullable(),
    cacheStatus: z.enum([
      "reported",
      "partial",
      "unavailable",
      "inconsistent",
    ]),
    cacheWriteTokens: z.number().int().nonnegative().nullable(),
    costProfileAsOf: z.iso.date().nullable(),
    costProfileValidThrough: z.iso.date().nullable(),
    costProfileVersion: z.string().trim().min(1).max(256).nullable(),
    costStatus: z.enum(MODEL_COST_ESTIMATE_STATUSES),
    durationMs: z.number().finite().nonnegative(),
    errorCode: errorCodeSchema,
    estimatedCostMicroUsd: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable(),
    event: z.literal("ai.completion"),
    evidenceResult: z.enum([
      "sufficient",
      "insufficient",
      "error",
      "not_applicable",
    ]),
    inputTokens: z.number().int().nonnegative().nullable(),
    loopSteps: z.number().int().nonnegative(),
    modelCallAttemptCount: z.number().int().nonnegative(),
    modelCallAttemptCoverageComplete: z.boolean(),
    modelCallCompletedCount: z.number().int().nonnegative(),
    modelPerformanceComplete: z.boolean(),
    modelResponseTimeMs: z.number().finite().nonnegative().nullable(),
    modelId: z.string().trim().min(1).max(256),
    modelStepTimeMs: z.number().finite().nonnegative().nullable(),
    modelTimeToFirstOutputMs: z.number().finite().nonnegative().nullable(),
    noCacheTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    requestId: requestIdSchema,
    timestamp: z.iso.datetime({ offset: true }),
    toolCount: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative().nullable(),
    tokenUsageComplete: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    const addConsistencyIssue = (message: string, path: string) => {
      context.addIssue({ code: "custom", message, path: [path] });
    };
    const profileMetadataExpected = ![
      "not_configured",
      "invalid_profile",
      "invalid_reference_date",
    ].includes(value.costStatus);
    const profileMetadataPresent =
      value.costProfileAsOf !== null &&
      value.costProfileValidThrough !== null &&
      value.costProfileVersion !== null;
    const profileMetadataAbsent =
      value.costProfileAsOf === null &&
      value.costProfileValidThrough === null &&
      value.costProfileVersion === null;

    if (
      (profileMetadataExpected && !profileMetadataPresent) ||
      (!profileMetadataExpected && !profileMetadataAbsent)
    ) {
      context.addIssue({
        code: "custom",
        message: "Cost profile metadata does not match cost status.",
        path: ["costStatus"],
      });
    }
    if (
      value.costProfileAsOf !== null &&
      value.costProfileValidThrough !== null &&
      value.costProfileValidThrough < value.costProfileAsOf
    ) {
      context.addIssue({
        code: "custom",
        message: "Cost profile validity cannot end before its as-of date.",
        path: ["costProfileValidThrough"],
      });
    }
    const eventUtcDate = new Date(value.timestamp)
      .toISOString()
      .slice(0, 10);
    if (
      value.costProfileAsOf !== null &&
      value.costProfileAsOf > eventUtcDate
    ) {
      context.addIssue({
        code: "custom",
        message: "Cost profile cannot be dated after the event UTC date.",
        path: ["costProfileAsOf"],
      });
    }
    if (
      value.costStatus === "stale_profile" &&
      value.costProfileValidThrough !== null &&
      value.costProfileValidThrough >= eventUtcDate
    ) {
      context.addIssue({
        code: "custom",
        message: "A stale cost profile must expire before the event UTC date.",
        path: ["costStatus"],
      });
    }
    if (
      ["estimated", "usage_incomplete", "arithmetic_overflow"].includes(
        value.costStatus,
      ) &&
      value.costProfileValidThrough !== null &&
      value.costProfileValidThrough < eventUtcDate
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A usable cost profile must remain valid on the event UTC date.",
        path: ["costStatus"],
      });
    }
    if (
      (value.costStatus === "estimated") !==
      (value.estimatedCostMicroUsd !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Estimated cost does not match cost status.",
        path: ["estimatedCostMicroUsd"],
      });
    }
    if (
      ["estimated", "arithmetic_overflow"].includes(value.costStatus) &&
      (!value.tokenUsageComplete ||
        !value.modelCallAttemptCoverageComplete)
    ) {
      addConsistencyIssue(
        "A completed cost calculation requires complete token and model-call coverage.",
        "costStatus",
      );
    }
    const streamTerminated = [
      "MODEL_STREAM_ABORTED",
      "MODEL_STREAM_ERROR",
    ].includes(value.errorCode ?? "");
    if (
      streamTerminated &&
      (value.modelCallAttemptCoverageComplete ||
        value.tokenUsageComplete ||
        value.modelPerformanceComplete ||
        ["estimated", "arithmetic_overflow"].includes(value.costStatus))
    ) {
      addConsistencyIssue(
        "An aborted or failed model stream cannot claim complete telemetry or cost calculation.",
        "errorCode",
      );
    }
    if (streamTerminated && value.evidenceResult !== "error") {
      addConsistencyIssue(
        "An aborted or failed model stream must report an evidence error.",
        "evidenceResult",
      );
    }

    if (value.modelCallCompletedCount > value.modelCallAttemptCount) {
      addConsistencyIssue(
        "Completed model calls cannot exceed attempted model calls.",
        "modelCallCompletedCount",
      );
    }
    if (value.loopSteps > value.modelCallCompletedCount) {
      addConsistencyIssue(
        "Loop steps cannot exceed completed model calls.",
        "loopSteps",
      );
    }

    const attemptCountsCoverLoop =
      value.modelCallAttemptCount > 0 &&
      value.modelCallCompletedCount === value.modelCallAttemptCount &&
      value.modelCallCompletedCount === value.loopSteps;
    if (
      value.modelCallAttemptCoverageComplete &&
      !attemptCountsCoverLoop
    ) {
      addConsistencyIssue(
        "Complete model-call coverage requires every loop step and attempt to complete.",
        "modelCallAttemptCoverageComplete",
      );
    }
    const allModelCallsCompleted =
      value.modelCallAttemptCoverageComplete && attemptCountsCoverLoop;
    if (value.tokenUsageComplete && !allModelCallsCompleted) {
      addConsistencyIssue(
        "Complete token usage requires complete coverage of completed model calls.",
        "tokenUsageComplete",
      );
    }
    if (value.modelPerformanceComplete && !allModelCallsCompleted) {
      addConsistencyIssue(
        "Complete model performance requires complete coverage of completed model calls.",
        "modelPerformanceComplete",
      );
    }

    const baseTokens = [
      value.inputTokens,
      value.outputTokens,
      value.totalTokens,
    ];
    if (value.tokenUsageComplete && baseTokens.some((tokens) => tokens === null)) {
      addConsistencyIssue(
        "Complete token usage requires input, output and total tokens.",
        "tokenUsageComplete",
      );
    }
    if (
      value.tokenUsageComplete &&
      (value.inputTokens === null ||
        value.inputTokens <= 0 ||
        value.totalTokens === null ||
        value.totalTokens <= 0)
    ) {
      addConsistencyIssue(
        "Complete token usage requires positive input and total token counts.",
        "tokenUsageComplete",
      );
    }
    if (
      value.inputTokens !== null &&
      value.outputTokens !== null &&
      value.totalTokens !== null &&
      value.totalTokens !== value.inputTokens + value.outputTokens
    ) {
      addConsistencyIssue(
        "Total tokens must equal input plus output tokens.",
        "totalTokens",
      );
    }

    const performanceValues = [
      value.modelResponseTimeMs,
      value.modelStepTimeMs,
      value.modelTimeToFirstOutputMs,
    ];
    if (
      value.modelPerformanceComplete &&
      performanceValues.some((metric) => metric === null)
    ) {
      addConsistencyIssue(
        "Complete model performance requires every performance metric.",
        "modelPerformanceComplete",
      );
    }

    const observedStepValues = [
      ...baseTokens,
      value.cacheReadTokens,
      value.cacheWriteTokens,
      value.noCacheTokens,
      ...performanceValues,
    ];
    if (
      value.modelCallCompletedCount === 0 &&
      observedStepValues.some((metric) => metric !== null)
    ) {
      addConsistencyIssue(
        "Step metrics require at least one completed model call.",
        "modelCallCompletedCount",
      );
    }

    const cacheValues = [
      value.cacheReadTokens,
      value.cacheWriteTokens,
      value.noCacheTokens,
    ];
    const cacheValueCount = cacheValues.filter((tokens) => tokens !== null).length;
    if (
      (value.cacheStatus === "unavailable" && cacheValueCount !== 0) ||
      (value.cacheStatus === "partial" &&
        (cacheValueCount === 0 || cacheValueCount === cacheValues.length)) ||
      (value.cacheStatus === "reported" &&
        cacheValueCount !== cacheValues.length)
    ) {
      addConsistencyIssue(
        "Cache fields do not match cache status.",
        "cacheStatus",
      );
    }
    for (const [name, tokens] of [
      ["cacheReadTokens", value.cacheReadTokens],
      ["cacheWriteTokens", value.cacheWriteTokens],
      ["noCacheTokens", value.noCacheTokens],
    ] as const) {
      if (
        tokens !== null &&
        value.inputTokens !== null &&
        tokens > value.inputTokens
      ) {
        addConsistencyIssue(
          "Cache token counts cannot exceed input tokens.",
          name,
        );
      }
    }
    if (
      value.cacheReadTokens !== null &&
      value.cacheWriteTokens !== null &&
      value.noCacheTokens !== null &&
      value.inputTokens !== null &&
      value.cacheReadTokens +
          value.cacheWriteTokens +
          value.noCacheTokens !==
        value.inputTokens
    ) {
      addConsistencyIssue(
        "Cache-read, cache-write and no-cache tokens must equal input tokens.",
        "noCacheTokens",
      );
    }

    if (value.cacheHitRatePct !== null) {
      const expectedCacheHitRate =
        value.inputTokens !== null &&
        value.inputTokens > 0 &&
        value.cacheReadTokens !== null
          ? (value.cacheReadTokens / value.inputTokens) * 100
          : null;
      if (
        !["partial", "reported"].includes(value.cacheStatus) ||
        !value.tokenUsageComplete ||
        expectedCacheHitRate === null ||
        Math.abs(value.cacheHitRatePct - expectedCacheHitRate) >
          Number.EPSILON * 100
      ) {
        addConsistencyIssue(
          "Cache hit rate requires complete, reported and arithmetically consistent cache usage.",
          "cacheHitRatePct",
        );
      }
    }
  });

export const structuredLogEventSchema = z.discriminatedUnion("event", [
  apiRequestLogSchema,
  aiCompletionLogSchema,
]);

export type AiCompletionLogInput = Omit<
  z.infer<typeof aiCompletionLogSchema>,
  "event"
>;

export function serializeStructuredLogEvent(input: unknown): string {
  return JSON.stringify(structuredLogEventSchema.parse(input));
}

function emitStructuredLog(event: z.infer<typeof structuredLogEventSchema>) {
  console.info(serializeStructuredLogEvent(event));
}

export function emitAiCompletionLog(input: AiCompletionLogInput): void {
  emitStructuredLog({
    ...input,
    event: "ai.completion",
  });
}

export function createApiRequestObserver(route: string): {
  finish: (response: Response, errorCode?: string | null) => Response;
  requestId: string;
  startedAtMs: number;
} {
  const requestId = crypto.randomUUID();
  const startedAtMs = performance.now();
  let finished = false;

  return {
    finish(response, errorCode) {
      if (finished) {
        throw new Error("API request observer was finished more than once.");
      }
      finished = true;
      const normalizedErrorCode =
        errorCode ?? (response.status >= 400 ? "HTTP_ERROR" : null);
      emitStructuredLog({
        durationMs: Math.max(0, performance.now() - startedAtMs),
        errorCode: normalizedErrorCode,
        event: "api.request",
        requestId,
        route,
        status: response.status,
        timestamp: new Date().toISOString(),
      });

      const headers = new Headers(response.headers);
      headers.set("X-Request-Id", requestId);
      return new Response(response.body, {
        headers,
        status: response.status,
        statusText: response.statusText,
      });
    },
    requestId,
    startedAtMs,
  };
}
