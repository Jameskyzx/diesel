import { describe, expect, it, vi } from "vitest";

import {
  AI_CHAT_RATE_LIMIT_GLOBAL_DEFAULT_PER_HOUR,
  AI_CHAT_RATE_LIMIT_WINDOW_MS,
  createPostgresRateLimiter,
  createRateLimiter,
  createRateLimitCleanupScheduler,
  extractClientIdentifier,
  RATE_LIMIT_CLEANUP_INTERVAL_MS,
  resolveAiChatRateLimitBackend,
  resolveAiChatRateLimitConfig,
} from "@/server/http/rate-limit";
import type { RateLimitRepository } from "@/server/repositories/rate-limit-repository";

function createDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

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

  it("enforces one global ceiling across distinct client keys", async () => {
    const limiter = createRateLimiter({
      globalLimit: 2,
      limit: 2,
      windowMs,
    });

    expect((await limiter.check("client-a", t0)).allowed).toBe(true);
    expect((await limiter.check("client-b", t0)).allowed).toBe(true);
    expect((await limiter.check("client-c", t0)).allowed).toBe(false);
  });

  it("does not charge the global remainder for a rejected client retry", async () => {
    const limiter = createRateLimiter({
      globalLimit: 2,
      limit: 1,
      windowMs,
    });

    expect((await limiter.check("client-a", t0)).allowed).toBe(true);
    expect((await limiter.check("client-a", t0 + 1)).allowed).toBe(false);
    expect((await limiter.check("client-b", t0 + 2)).allowed).toBe(true);
    expect((await limiter.check("client-c", t0 + 3)).allowed).toBe(false);
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

describe("resolveAiChatRateLimitConfig", () => {
  it("uses the compatibility global ceiling when it is omitted", () => {
    expect(
      resolveAiChatRateLimitConfig({ perClientLimitPerHour: 30 }),
    ).toEqual({
      globalLimitPerHour: AI_CHAT_RATE_LIMIT_GLOBAL_DEFAULT_PER_HOUR,
      perClientLimitPerHour: 30,
    });
  });

  it("rejects a per-client limit above the global limit", () => {
    expect(() =>
      resolveAiChatRateLimitConfig({
        globalLimitPerHour: 29,
        perClientLimitPerHour: 30,
      }),
    ).toThrow("cannot exceed the global hourly rate limit");
  });
});

describe("PostgreSQL rate-limit retention scheduling", () => {
  it("rejects a non-hourly window before repository work can start", () => {
    const repository: RateLimitRepository = {
      cleanupExpiredBuckets: vi.fn(async () => undefined),
      reserveAiChatHourlyRequest: vi.fn(async () => ({
        allowed: false as const,
      })),
      reserveAiChatAdmissionProviderCallUnits: vi.fn(async () => true),
    };

    expect(() =>
      createPostgresRateLimiter({
        globalLimit: 300,
        globalScope: "test-hourly-global",
        limit: 30,
        repository,
        scope: "test-hourly",
        windowMs: 60_000,
      }),
    ).toThrow("requires a one-hour window");
    expect(repository.reserveAiChatHourlyRequest).not.toHaveBeenCalled();
  });

  it("is process-single-flight, interval-bound, and does not await cleanup", async () => {
    let schedulerNowMs = 1_000;
    const firstCleanup = createDeferred();
    const cleanupExpiredBuckets = vi
      .fn<RateLimitRepository["cleanupExpiredBuckets"]>()
      .mockImplementationOnce(() => firstCleanup.promise)
      .mockResolvedValue(undefined);
    const repository: RateLimitRepository = {
      cleanupExpiredBuckets,
      reserveAiChatHourlyRequest: vi.fn(async () => ({
        allowed: true,
        clientCount: 1,
        globalCount: 1,
      })),
      reserveAiChatAdmissionProviderCallUnits: vi.fn(async () => true),
    };
    const cleanupScheduler = createRateLimitCleanupScheduler({
      now: () => schedulerNowMs,
    });
    const limiterOptions = {
      cleanupScheduler,
      globalLimit: 300,
      globalScope: "test-hourly-global",
      limit: 30,
      repository,
      scope: "test-hourly",
      windowMs: AI_CHAT_RATE_LIMIT_WINDOW_MS,
    };
    const firstLimiter = createPostgresRateLimiter(limiterOptions);
    const secondLimiter = createPostgresRateLimiter(limiterOptions);

    await expect(firstLimiter.check("client-a", 1_700_000_000_000)).resolves
      .toMatchObject({ allowed: true, remaining: 29 });
    await vi.waitFor(() => expect(cleanupExpiredBuckets).toHaveBeenCalledTimes(1));

    // An unresolved cleanup cannot retain or change either request decision.
    await expect(secondLimiter.check("client-b", 1_700_000_000_001)).resolves
      .toMatchObject({ allowed: true, remaining: 29 });
    expect(cleanupExpiredBuckets).toHaveBeenCalledTimes(1);

    firstCleanup.resolve();
    await firstCleanup.promise;
    schedulerNowMs = 1_000 + RATE_LIMIT_CLEANUP_INTERVAL_MS - 1;
    await vi.waitFor(() => {
      cleanupScheduler.schedule(repository);
      expect(cleanupExpiredBuckets).toHaveBeenCalledTimes(1);
    });

    schedulerNowMs = 1_000 + RATE_LIMIT_CLEANUP_INTERVAL_MS;
    await vi.waitFor(() => {
      cleanupScheduler.schedule(repository);
      expect(cleanupExpiredBuckets).toHaveBeenCalledTimes(2);
    });
  });

  it("logs only a fixed message and error class when cleanup fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const sensitiveMessage =
      "postgres://rate-limit:secret@example.test/database";
    const repository: RateLimitRepository = {
      cleanupExpiredBuckets: vi.fn(async () => {
        throw new Error(sensitiveMessage);
      }),
      reserveAiChatHourlyRequest: vi.fn(async () => ({
        allowed: true,
        clientCount: 1,
        globalCount: 1,
      })),
      reserveAiChatAdmissionProviderCallUnits: vi.fn(async () => true),
    };
    const limiter = createPostgresRateLimiter({
      cleanupScheduler: createRateLimitCleanupScheduler({ now: () => 1_000 }),
      globalLimit: 300,
      globalScope: "test-hourly-global",
      limit: 30,
      repository,
      scope: "test-hourly",
      windowMs: AI_CHAT_RATE_LIMIT_WINDOW_MS,
    });

    try {
      await expect(limiter.check("client-a", 1_700_000_000_000)).resolves
        .toMatchObject({ allowed: true, remaining: 29 });
      await vi.waitFor(() =>
        expect(consoleError).toHaveBeenCalledWith(
          "Shared rate-limit bucket cleanup failed",
          { errorCode: "Error" },
        ),
      );
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
        sensitiveMessage,
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("preserves the decision when an injected scheduler throws synchronously", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const sensitiveMessage = "postgres://synchronous:secret@example.test/db";
    const repository: RateLimitRepository = {
      cleanupExpiredBuckets: vi.fn(async () => undefined),
      reserveAiChatHourlyRequest: vi.fn(async () => ({
        allowed: true,
        clientCount: 1,
        globalCount: 1,
      })),
      reserveAiChatAdmissionProviderCallUnits: vi.fn(async () => true),
    };
    const limiter = createPostgresRateLimiter({
      cleanupScheduler: {
        schedule() {
          throw new Error(sensitiveMessage);
        },
      },
      globalLimit: 300,
      globalScope: "test-hourly-global",
      limit: 30,
      repository,
      scope: "test-hourly",
      windowMs: AI_CHAT_RATE_LIMIT_WINDOW_MS,
    });

    try {
      await expect(limiter.check("client-a", 1_700_000_000_000)).resolves
        .toMatchObject({ allowed: true, remaining: 29 });
      expect(consoleError).toHaveBeenCalledWith(
        "Shared rate-limit bucket cleanup failed",
        { errorCode: "Error" },
      );
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
        sensitiveMessage,
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
