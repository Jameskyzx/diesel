import { z } from "zod";

export const healthResponseSchema = z.object({
  service: z.literal("global-diesel-regulations"),
  status: z.literal("ok"),
  timestamp: z.iso.datetime(),
  version: z.string().min(1),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

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
