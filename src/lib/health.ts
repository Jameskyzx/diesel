import { z } from "zod";

export const healthResponseSchema = z.object({
  service: z.literal("global-diesel-regulations"),
  status: z.literal("ok"),
  timestamp: z.iso.datetime(),
  version: z.string().min(1),
}).strict();

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const readinessResponseSchema = z.object({
  service: z.literal("global-diesel-regulations"),
  status: z.enum(["ok", "unavailable"]),
  timestamp: z.iso.datetime(),
  version: z.string().min(1),
  checks: z.object({
    aiChatAdmission: z.enum(["ok", "unavailable"]),
    aiChatRateLimit: z.enum(["ok", "unavailable"]),
    database: z.enum(["ok", "unavailable"]),
  }).strict(),
}).strict();

export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;

type CreateHealthPayloadOptions = {
  now?: Date;
  version: string;
};

export function createHealthPayload({
  now = new Date(),
  version,
}: CreateHealthPayloadOptions): HealthResponse {
  return healthResponseSchema.parse({
    service: "global-diesel-regulations",
    status: "ok",
    timestamp: now.toISOString(),
    version,
  });
}

type CreateReadinessPayloadOptions = CreateHealthPayloadOptions & {
  aiChatAdmissionReady: boolean;
  aiChatRateLimitReady: boolean;
  databaseReady: boolean;
};

export function createReadinessPayload({
  aiChatAdmissionReady,
  aiChatRateLimitReady,
  databaseReady,
  now = new Date(),
  version,
}: CreateReadinessPayloadOptions): ReadinessResponse {
  const ready =
    aiChatAdmissionReady && aiChatRateLimitReady && databaseReady;
  return readinessResponseSchema.parse({
    service: "global-diesel-regulations",
    status: ready ? "ok" : "unavailable",
    timestamp: now.toISOString(),
    version,
    checks: {
      aiChatAdmission: aiChatAdmissionReady ? "ok" : "unavailable",
      aiChatRateLimit: aiChatRateLimitReady ? "ok" : "unavailable",
      database: databaseReady ? "ok" : "unavailable",
    },
  });
}
