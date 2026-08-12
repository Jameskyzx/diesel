import { describe, expect, it } from "vitest";

import { createHealthPayload, healthResponseSchema } from "@/lib/health";

describe("createHealthPayload", () => {
  it("creates a deterministic, structured health response", () => {
    const now = new Date("2026-07-29T00:00:00.000Z");

    const payload = createHealthPayload({
      now,
      version: "test",
    });

    expect(payload).toEqual({
      service: "global-diesel-regulations",
      status: "ok",
      timestamp: "2026-07-29T00:00:00.000Z",
      version: "test",
    });
    expect(healthResponseSchema.safeParse(payload).success).toBe(true);
  });

  it("rejects an empty version", () => {
    expect(() =>
      createHealthPayload({
        version: "",
      }),
    ).toThrow();
  });
});
