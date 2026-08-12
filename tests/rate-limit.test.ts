import { describe, expect, it } from "vitest";

import {
  createRateLimiter,
  extractClientIdentifier,
} from "@/server/http/rate-limit";

describe("createRateLimiter fixed-window decisions", () => {
  const windowMs = 60_000;
  const t0 = 1_700_000_000_000;

  it("allows requests up to the limit and rejects the next one", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs });

    const first = limiter.check("client-a", t0);
    const second = limiter.check("client-a", t0 + 10_000);
    const third = limiter.check("client-a", t0 + 20_000);
    const fourth = limiter.check("client-a", t0 + 30_000);

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

  it("re-allows requests after the aligned window rolls over", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs });

    expect(limiter.check("client-a", t0).allowed).toBe(true);
    expect(limiter.check("client-a", t0 + 1).allowed).toBe(false);

    const nextWindowStart = Math.floor(t0 / windowMs) * windowMs + windowMs;
    const afterRollover = limiter.check("client-a", nextWindowStart);

    expect(afterRollover.allowed).toBe(true);
    expect(afterRollover.remaining).toBe(0);
  });

  it("counts keys independently", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs });

    expect(limiter.check("client-a", t0).allowed).toBe(true);
    expect(limiter.check("client-a", t0).allowed).toBe(false);
    expect(limiter.check("client-b", t0).allowed).toBe(true);
  });

  it("computes Retry-After as seconds until the window ends", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs });
    const windowStart = Math.floor(t0 / windowMs) * windowMs;

    limiter.check("client-a", windowStart + 45_000);
    const rejected = limiter.check("client-a", windowStart + 45_000);

    expect(rejected.allowed).toBe(false);
    expect(rejected.retryAfterSeconds).toBe(15);
  });

  it("reset clears all buckets", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs });

    limiter.check("client-a", t0);
    expect(limiter.check("client-a", t0).allowed).toBe(false);

    limiter.reset();
    expect(limiter.check("client-a", t0).allowed).toBe(true);
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
