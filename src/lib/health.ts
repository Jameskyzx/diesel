import { z } from "zod";

export const healthResponseSchema = z.object({
  service: z.literal("global-diesel-regulations"),
  status: z.literal("ok"),
  timestamp: z.iso.datetime(),
  version: z.string().min(1),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const readinessResponseSchema = z.object({
  service: z.literal("global-diesel-regulations"),
  status: z.enum(["ok", "unavailable"]),
  timestamp: z.iso.datetime(),
  version: z.string().min(1),
  checks: z.object({
    database: z.enum(["ok", "unavailable"]),
  }),
});

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
  ready: boolean;
};

export function createReadinessPayload({
  now = new Date(),
  ready,
  version,
}: CreateReadinessPayloadOptions): ReadinessResponse {
  return readinessResponseSchema.parse({
    service: "global-diesel-regulations",
    status: ready ? "ok" : "unavailable",
    timestamp: now.toISOString(),
    version,
    checks: {
      database: ready ? "ok" : "unavailable",
    },
  });
}
