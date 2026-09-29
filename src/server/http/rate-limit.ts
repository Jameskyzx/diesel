import "server-only";

import { createHash } from "node:crypto";

import { env } from "@/env";
import { getErrorCode } from "@/lib/api-error";
import { getDatabase } from "@/server/db/client";
import {
  createRateLimitRepository,
  type RateLimitRepository,
} from "@/server/repositories/rate-limit-repository";

/**
 * 固定窗口速率限制器（ADR-041）。窗口按 epoch 对齐，`nowMs` 可注入以便测试。
 * `createRateLimiter` 是开发/测试用内存实现；生产由
 * `createPostgresRateLimiter` 在数据库中跨实例原子共享计数。
 */
export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

export type RateLimiter = {
  check: (key: string, nowMs?: number) => Promise<RateLimitDecision>;
  reset: () => void;
};

export type InFlightLease = {
  release: () => void;
};

export type InFlightGate = {
  reset: () => void;
  tryAcquire: (key: string) => InFlightLease | null;
};

type Bucket = {
  count: number;
  windowStart: number;
};

export type AiChatRateLimitBackend = "memory" | "postgres";

export const RATE_LIMIT_CLEANUP_INTERVAL_MS = 60 * 1_000;
export const AI_CHAT_RATE_LIMIT_MAX_PER_HOUR = 10_000;
export const AI_CHAT_RATE_LIMIT_GLOBAL_DEFAULT_PER_HOUR =
  AI_CHAT_RATE_LIMIT_MAX_PER_HOUR;
export const AI_CHAT_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1_000;

export type AiChatRateLimitConfig = {
  globalLimitPerHour: number;
  perClientLimitPerHour: number;
};

export type RateLimitCleanupScheduler = {
  schedule: (repository: RateLimitRepository) => void;
};

function reportRateLimitCleanupFailure(error: unknown): void {
  try {
    console.error("Shared rate-limit bucket cleanup failed", {
      errorCode: getErrorCode(error),
    });
  } catch {
    // Cleanup observability must never alter a completed rate-limit decision,
    // even if the host's console transport is unavailable.
  }
}

export function createRateLimitCleanupScheduler(options: {
  now?: () => number;
} = {}): RateLimitCleanupScheduler {
  let cleanupInFlight: Promise<void> | null = null;
  let nextCleanupAtMs = Number.NEGATIVE_INFINITY;
  const now = options.now ?? Date.now;

  return {
    schedule(repository) {
      let nowMs: number;
      try {
        nowMs = now();
      } catch (error: unknown) {
        reportRateLimitCleanupFailure(error);
        return;
      }
      if (
        !Number.isFinite(nowMs) ||
        cleanupInFlight !== null ||
        nowMs < nextCleanupAtMs
      ) {
        return;
      }
      nextCleanupAtMs = nowMs + RATE_LIMIT_CLEANUP_INTERVAL_MS;

      const scheduledCleanup = Promise.resolve()
        .then(() => repository.cleanupExpiredBuckets())
        .catch(reportRateLimitCleanupFailure)
        .finally(() => {
          if (cleanupInFlight === scheduledCleanup) {
            cleanupInFlight = null;
          }
        });
      cleanupInFlight = scheduledCleanup;
      void scheduledCleanup;
    },
  };
}

const sharedRateLimitCleanupScheduler = createRateLimitCleanupScheduler();

export function resolveAiChatRateLimitBackend(options: {
  configuredBackend?: AiChatRateLimitBackend;
  nodeEnv: "development" | "production" | "test";
}): AiChatRateLimitBackend {
  const backend =
    options.configuredBackend ??
    (options.nodeEnv === "production" ? "postgres" : "memory");

  if (options.nodeEnv === "production" && backend !== "postgres") {
    throw new Error(
      "Production AI chat rate limiting requires the postgres backend.",
    );
  }

  return backend;
}

function assertHourlyLimit(name: string, value: number): void {
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > AI_CHAT_RATE_LIMIT_MAX_PER_HOUR
  ) {
    throw new Error(
      `${name} must be a positive safe integer no greater than ${AI_CHAT_RATE_LIMIT_MAX_PER_HOUR}.`,
    );
  }
}

export function resolveAiChatRateLimitConfig(options: {
  globalLimitPerHour?: number;
  perClientLimitPerHour: number;
}): AiChatRateLimitConfig {
  const globalLimitPerHour =
    options.globalLimitPerHour ??
    AI_CHAT_RATE_LIMIT_GLOBAL_DEFAULT_PER_HOUR;
  assertHourlyLimit("Global hourly rate limit", globalLimitPerHour);
  assertHourlyLimit(
    "Per-client hourly rate limit",
    options.perClientLimitPerHour,
  );
  if (options.perClientLimitPerHour > globalLimitPerHour) {
    throw new Error(
      "Per-client hourly rate limit cannot exceed the global hourly rate limit.",
    );
  }
  return {
    globalLimitPerHour,
    perClientLimitPerHour: options.perClientLimitPerHour,
  };
}

export function createRateLimiter(options: {
  globalLimit?: number;
  limit: number;
  windowMs: number;
}): RateLimiter {
  const config = resolveAiChatRateLimitConfig({
    globalLimitPerHour: options.globalLimit,
    perClientLimitPerHour: options.limit,
  });
  const buckets = new Map<string, Bucket>();
  let globalBucket: Bucket | undefined;
  let lastPurgeWindowStart = Number.NEGATIVE_INFINITY;

  function purgeStale(currentWindowStart: number): void {
    if (currentWindowStart - lastPurgeWindowStart < options.windowMs) {
      return;
    }
    lastPurgeWindowStart = currentWindowStart;
    for (const [key, bucket] of buckets) {
      if (bucket.windowStart !== currentWindowStart) {
        buckets.delete(key);
      }
    }
    if (globalBucket?.windowStart !== currentWindowStart) {
      globalBucket = undefined;
    }
  }

  return {
    async check(key, nowMs = Date.now()): Promise<RateLimitDecision> {
      const windowStart =
        Math.floor(nowMs / options.windowMs) * options.windowMs;
      purgeStale(windowStart);

      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((windowStart + options.windowMs - nowMs) / 1000),
      );
      const bucket = buckets.get(key);
      const globalCount =
        globalBucket?.windowStart === windowStart ? globalBucket.count : 0;
      const clientCount =
        bucket?.windowStart === windowStart ? bucket.count : 0;

      if (
        globalCount >= config.globalLimitPerHour ||
        clientCount >= config.perClientLimitPerHour
      ) {
        return {
          allowed: false,
          limit: config.perClientLimitPerHour,
          remaining: 0,
          retryAfterSeconds,
        };
      }

      const nextGlobalCount = globalCount + 1;
      const nextClientCount = clientCount + 1;
      globalBucket = { count: nextGlobalCount, windowStart };
      buckets.set(key, { count: nextClientCount, windowStart });
      return {
        allowed: true,
        limit: config.perClientLimitPerHour,
        remaining: Math.min(
          config.globalLimitPerHour - nextGlobalCount,
          config.perClientLimitPerHour - nextClientCount,
        ),
        retryAfterSeconds: 0,
      };
    },
    reset() {
      buckets.clear();
      globalBucket = undefined;
      lastPurgeWindowStart = Number.NEGATIVE_INFINITY;
    },
  };
}

export function createPostgresRateLimiter(options: {
  cleanupScheduler?: RateLimitCleanupScheduler;
  globalLimit: number;
  globalScope: string;
  limit: number;
  repository: RateLimitRepository;
  scope: string;
  windowMs: number;
}): RateLimiter {
  if (options.windowMs !== AI_CHAT_RATE_LIMIT_WINDOW_MS) {
    throw new Error(
      "PostgreSQL AI chat rate limiting requires a one-hour window.",
    );
  }
  const config = resolveAiChatRateLimitConfig({
    globalLimitPerHour: options.globalLimit,
    perClientLimitPerHour: options.limit,
  });
  const cleanupScheduler =
    options.cleanupScheduler ?? sharedRateLimitCleanupScheduler;
  const globalKeyHash = createHash("sha256")
    .update("diesel:ai-chat-hourly-rate-limit:v1:global")
    .digest("hex");

  return {
    async check(key, nowMs = Date.now()): Promise<RateLimitDecision> {
      const windowStart =
        Math.floor(nowMs / options.windowMs) * options.windowMs;
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((windowStart + options.windowMs - nowMs) / 1000),
      );
      const reservation = await options.repository.reserveAiChatHourlyRequest({
        client: {
          keyHash: createHash("sha256").update(key).digest("hex"),
          limit: config.perClientLimitPerHour,
          scope: options.scope,
        },
        expiresAt: new Date(windowStart + options.windowMs),
        global: {
          keyHash: globalKeyHash,
          limit: config.globalLimitPerHour,
          scope: options.globalScope,
        },
        now: new Date(nowMs),
        windowStart: new Date(windowStart),
      });
      // Retention is deliberately outside the request's counter transaction.
      // This process-local scheduler is single-flight and never awaits cleanup,
      // so maintenance failure cannot change the already-computed decision.
      try {
        cleanupScheduler.schedule(options.repository);
      } catch (error: unknown) {
        reportRateLimitCleanupFailure(error);
      }

      if (!reservation.allowed) {
        return {
          allowed: false,
          limit: config.perClientLimitPerHour,
          remaining: 0,
          retryAfterSeconds,
        };
      }
      return {
        allowed: true,
        limit: config.perClientLimitPerHour,
        remaining: Math.min(
          config.globalLimitPerHour - reservation.globalCount,
          config.perClientLimitPerHour - reservation.clientCount,
        ),
        retryAfterSeconds: 0,
      };
    },
    reset() {
      // Shared production state is intentionally not reset from the app.
    },
  };
}

export function createInFlightGate(options: {
  globalLimit: number;
  perKeyLimit: number;
}): InFlightGate {
  if (
    !Number.isInteger(options.globalLimit) ||
    !Number.isInteger(options.perKeyLimit) ||
    options.globalLimit < 1 ||
    options.perKeyLimit < 1
  ) {
    throw new Error("In-flight limits must be positive integers.");
  }

  const activeByKey = new Map<string, number>();
  let activeGlobal = 0;

  return {
    reset() {
      activeByKey.clear();
      activeGlobal = 0;
    },
    tryAcquire(key) {
      const activeForKey = activeByKey.get(key) ?? 0;
      if (
        activeGlobal >= options.globalLimit ||
        activeForKey >= options.perKeyLimit
      ) {
        return null;
      }

      activeGlobal += 1;
      activeByKey.set(key, activeForKey + 1);
      let released = false;

      return {
        release() {
          if (released) {
            return;
          }
          released = true;
          activeGlobal = Math.max(0, activeGlobal - 1);
          const currentForKey = activeByKey.get(key) ?? 0;
          if (currentForKey <= 1) {
            activeByKey.delete(key);
          } else {
            activeByKey.set(key, currentForKey - 1);
          }
        },
      };
    },
  };
}

/**
 * 请求客户端标识。优先取可信代理注入的 `x-forwarded-for` 第一段；
 * 无代理部署时客户端可伪造该头绕过按客户端限流（限流是缓解手段，
 * 不是访问控制，见 DEPLOYMENT.md 发布前检查单）。
 */
export function extractClientIdentifier(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first && first.length > 0 ? first : "unknown-client";
}

type RuntimeWithRateLimiter = typeof globalThis & {
  __aiChatInFlightGate?: InFlightGate;
  __aiChatRateLimiter?: RateLimiter;
};

const AI_CHAT_RATE_LIMIT_CLIENT_SCOPE = "ai-chat-hourly-v1";
const AI_CHAT_RATE_LIMIT_GLOBAL_SCOPE = "ai-chat-hourly-global-v1";
export const AI_CHAT_MAX_IN_FLIGHT = 4;
export const AI_CHAT_MAX_IN_FLIGHT_PER_CLIENT = 2;

function resolveRuntimeAiChatRateLimitConfiguration(): {
  backend: AiChatRateLimitBackend;
  config: AiChatRateLimitConfig;
} {
  const config = resolveAiChatRateLimitConfig({
    globalLimitPerHour: env.AI_CHAT_RATE_LIMIT_GLOBAL_PER_HOUR,
    perClientLimitPerHour: env.AI_CHAT_RATE_LIMIT_PER_HOUR,
  });
  const backend = resolveAiChatRateLimitBackend({
    configuredBackend: env.AI_CHAT_RATE_LIMIT_BACKEND,
    nodeEnv: env.NODE_ENV,
  });
  return { backend, config };
}

export function validateAiChatRateLimitConfiguration(): void {
  resolveRuntimeAiChatRateLimitConfiguration();
}

export function getAiChatRateLimiter(): RateLimiter {
  const runtime = globalThis as RuntimeWithRateLimiter;
  if (!runtime.__aiChatRateLimiter) {
    const { backend, config } =
      resolveRuntimeAiChatRateLimitConfiguration();

    runtime.__aiChatRateLimiter =
      backend === "postgres"
        ? createPostgresRateLimiter({
            globalLimit: config.globalLimitPerHour,
            globalScope: AI_CHAT_RATE_LIMIT_GLOBAL_SCOPE,
            limit: config.perClientLimitPerHour,
            repository: createRateLimitRepository(getDatabase()),
            scope: AI_CHAT_RATE_LIMIT_CLIENT_SCOPE,
            windowMs: AI_CHAT_RATE_LIMIT_WINDOW_MS,
          })
        : createRateLimiter({
            globalLimit: config.globalLimitPerHour,
            limit: config.perClientLimitPerHour,
            windowMs: AI_CHAT_RATE_LIMIT_WINDOW_MS,
          });
  }

  return runtime.__aiChatRateLimiter;
}

export function getAiChatInFlightGate(): InFlightGate {
  const runtime = globalThis as RuntimeWithRateLimiter;
  runtime.__aiChatInFlightGate ??= createInFlightGate({
    globalLimit: AI_CHAT_MAX_IN_FLIGHT,
    perKeyLimit: AI_CHAT_MAX_IN_FLIGHT_PER_CLIENT,
  });

  return runtime.__aiChatInFlightGate;
}
