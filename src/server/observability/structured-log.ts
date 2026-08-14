import "server-only";

import { z } from "zod";

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
    durationMs: z.number().finite().nonnegative(),
    errorCode: errorCodeSchema,
    event: z.literal("ai.completion"),
    evidenceResult: z.enum([
      "sufficient",
      "insufficient",
      "error",
      "not_applicable",
    ]),
    inputTokens: z.number().int().nonnegative().nullable(),
    loopSteps: z.number().int().nonnegative(),
    modelId: z.string().trim().min(1).max(160),
    outputTokens: z.number().int().nonnegative().nullable(),
    requestId: requestIdSchema,
    timestamp: z.iso.datetime({ offset: true }),
    toolCount: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative().nullable(),
  })
  .strict();

export const structuredLogEventSchema = z.discriminatedUnion("event", [
  apiRequestLogSchema,
  aiCompletionLogSchema,
]);

export type AiCompletionLogInput = Omit<
  z.infer<typeof aiCompletionLogSchema>,
  "event" | "timestamp"
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
    timestamp: new Date().toISOString(),
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
