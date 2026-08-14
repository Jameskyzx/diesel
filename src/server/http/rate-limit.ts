import "server-only";

import { createHash } from "node:crypto";

import { env } from "@/env";
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

export function createRateLimiter(options: {
  limit: number;
  windowMs: number;
}): RateLimiter {
  const buckets = new Map<string, Bucket>();
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

      if (!bucket || bucket.windowStart !== windowStart) {
        buckets.set(key, { count: 1, windowStart });
        return {
          allowed: true,
          limit: options.limit,
          remaining: options.limit - 1,
          retryAfterSeconds: 0,
        };
      }

      if (bucket.count >= options.limit) {
        return {
          allowed: false,
          limit: options.limit,
          remaining: 0,
          retryAfterSeconds,
        };
      }

      bucket.count += 1;
      return {
        allowed: true,
        limit: options.limit,
        remaining: options.limit - bucket.count,
        retryAfterSeconds: 0,
      };
    },
    reset() {
      buckets.clear();
      lastPurgeWindowStart = Number.NEGATIVE_INFINITY;
    },
  };
}

export function createPostgresRateLimiter(options: {
  limit: number;
  repository: RateLimitRepository;
  scope: string;
  windowMs: number;
}): RateLimiter {
  return {
    async check(key, nowMs = Date.now()): Promise<RateLimitDecision> {
      const windowStart =
        Math.floor(nowMs / options.windowMs) * options.windowMs;
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((windowStart + options.windowMs - nowMs) / 1000),
      );
      const requestCount = await options.repository.consumeBucket({
        expiresAt: new Date(windowStart + options.windowMs),
        keyHash: createHash("sha256").update(key).digest("hex"),
        limit: options.limit,
        now: new Date(nowMs),
        scope: options.scope,
        windowStart: new Date(windowStart),
      });

      return requestCount <= options.limit
        ? {
            allowed: true,
            limit: options.limit,
            remaining: options.limit - requestCount,
            retryAfterSeconds: 0,
          }
        : {
            allowed: false,
            limit: options.limit,
            remaining: 0,
            retryAfterSeconds,
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

const AI_CHAT_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const AI_CHAT_RATE_LIMIT_SCOPE = "ai-chat-hourly-v1";
export const AI_CHAT_MAX_IN_FLIGHT = 4;
export const AI_CHAT_MAX_IN_FLIGHT_PER_CLIENT = 2;

export function getAiChatRateLimiter(): RateLimiter {
  const runtime = globalThis as RuntimeWithRateLimiter;
  if (!runtime.__aiChatRateLimiter) {
    const backend = resolveAiChatRateLimitBackend({
      configuredBackend: env.AI_CHAT_RATE_LIMIT_BACKEND,
      nodeEnv: env.NODE_ENV,
    });

    runtime.__aiChatRateLimiter =
      backend === "postgres"
        ? createPostgresRateLimiter({
            limit: env.AI_CHAT_RATE_LIMIT_PER_HOUR,
            repository: createRateLimitRepository(getDatabase()),
            scope: AI_CHAT_RATE_LIMIT_SCOPE,
            windowMs: AI_CHAT_RATE_LIMIT_WINDOW_MS,
          })
        : createRateLimiter({
            limit: env.AI_CHAT_RATE_LIMIT_PER_HOUR,
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
