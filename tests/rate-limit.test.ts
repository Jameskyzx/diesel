import { describe, expect, it } from "vitest";

import {
  createRateLimiter,
  extractClientIdentifier,
  resolveAiChatRateLimitBackend,
} from "@/server/http/rate-limit";

describe("createRateLimiter fixed-window decisions", () => {
  const windowMs = 60_000;
  const t0 = 1_700_000_000_000;

  it("allows requests up to the limit and rejects the next one", async () => {
    const limiter = createRateLimiter({ limit: 3, windowMs });

    const first = await limiter.check("client-a", t0);
    const second = await limiter.check("client-a", t0 + 10_000);
    const third = await limiter.check("client-a", t0 + 20_000);
    const fourth = await limiter.check("client-a", t0 + 30_000);

    expect(first).toMatchObject({
      allowed: true,
      limit: 3,
      remaining: 2,
      retryAfterSeconds: 0,
    });
    expect(second.remaining).toBe(1);
    expect(third.remaining).toBe(0);
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("re-allows requests after the aligned window rolls over", async () => {
    const limiter = createRateLimiter({ limit: 1, windowMs });

    expect((await limiter.check("client-a", t0)).allowed).toBe(true);
    expect((await limiter.check("client-a", t0 + 1)).allowed).toBe(false);

    const nextWindowStart = Math.floor(t0 / windowMs) * windowMs + windowMs;
    const afterRollover = await limiter.check("client-a", nextWindowStart);

    expect(afterRollover.allowed).toBe(true);
    expect(afterRollover.remaining).toBe(0);
  });

  it("counts keys independently", async () => {
    const limiter = createRateLimiter({ limit: 1, windowMs });

    expect((await limiter.check("client-a", t0)).allowed).toBe(true);
    expect((await limiter.check("client-a", t0)).allowed).toBe(false);
    expect((await limiter.check("client-b", t0)).allowed).toBe(true);
  });

  it("computes Retry-After as seconds until the window ends", async () => {
    const limiter = createRateLimiter({ limit: 1, windowMs });
    const windowStart = Math.floor(t0 / windowMs) * windowMs;

    await limiter.check("client-a", windowStart + 45_000);
    const rejected = await limiter.check(
      "client-a",
      windowStart + 45_000,
    );

    expect(rejected.allowed).toBe(false);
    expect(rejected.retryAfterSeconds).toBe(15);
  });

  it("reset clears all buckets", async () => {
    const limiter = createRateLimiter({ limit: 1, windowMs });

    await limiter.check("client-a", t0);
    expect((await limiter.check("client-a", t0)).allowed).toBe(false);

    limiter.reset();
    expect((await limiter.check("client-a", t0)).allowed).toBe(true);
  });
});

describe("extractClientIdentifier", () => {
  it("takes the first entry of x-forwarded-for", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.7, 10.0.0.1",
    });

    expect(extractClientIdentifier(headers)).toBe("203.0.113.7");
  });

  it("falls back to a shared bucket without the header", () => {
    expect(extractClientIdentifier(new Headers())).toBe("unknown-client");
    expect(extractClientIdentifier(new Headers({ "x-forwarded-for": "  " })))
      .toBe("unknown-client");
  });
});

describe("resolveAiChatRateLimitBackend", () => {
  it("uses shared PostgreSQL in production even when the setting is omitted", () => {
    expect(
      resolveAiChatRateLimitBackend({ nodeEnv: "production" }),
    ).toBe("postgres");
  });

  it("rejects an explicit in-memory production backend", () => {
    expect(() =>
      resolveAiChatRateLimitBackend({
        configuredBackend: "memory",
        nodeEnv: "production",
      }),
    ).toThrow("requires the postgres backend");
  });

  it("keeps memory available for local development and tests", () => {
    expect(
      resolveAiChatRateLimitBackend({ nodeEnv: "development" }),
    ).toBe("memory");
    expect(resolveAiChatRateLimitBackend({ nodeEnv: "test" })).toBe(
      "memory",
    );
  });
});
