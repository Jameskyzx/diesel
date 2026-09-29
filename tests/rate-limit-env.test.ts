import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("AI chat global hourly rate-limit environment", () => {
  it("uses the compatibility ceiling when the value is omitted", async () => {
    vi.stubEnv("AI_CHAT_RATE_LIMIT_GLOBAL_PER_HOUR", "");
    vi.resetModules();

    const { env } = await import("@/env");

    expect(env.AI_CHAT_RATE_LIMIT_GLOBAL_PER_HOUR).toBe(10_000);
  });

  it.each(["0", "1.5", "10001", "not-a-number"])(
    "rejects invalid value %s during environment parsing",
    async (value) => {
      vi.stubEnv("AI_CHAT_RATE_LIMIT_GLOBAL_PER_HOUR", value);
      vi.resetModules();

      await expect(import("@/env")).rejects.toBeInstanceOf(Error);
    },
  );
});
