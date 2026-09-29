import "server-only";

import { createHash } from "node:crypto";

import { MAX_AI_TOOL_STEPS } from "@/features/ai/constants";
import { env } from "@/env";
import { getDatabase } from "@/server/db/client";
import { resolveAiChatRateLimitBackend } from "@/server/http/rate-limit";
import {
  createRateLimitRepository,
  type RateLimitRepository,
} from "@/server/repositories/rate-limit-repository";

const UTC_DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_DATE_MS = 8_640_000_000_000_000;
export const MAX_AI_CHAT_ADMISSION_UNITS = 2_000_000_000;
const DEVELOPMENT_GLOBAL_UNITS_PER_DAY = 1_000_000;
const DEVELOPMENT_CLIENT_UNITS_PER_DAY = 100_000;

const GLOBAL_SCOPE = "ai-chat-admission-provider-call-global-v1";
const CLIENT_SCOPE = "ai-chat-admission-provider-call-client-v1";
const GLOBAL_HASH_DOMAIN = "diesel:ai-chat-admission:v1:global:";
const CLIENT_HASH_DOMAIN = "diesel:ai-chat-admission:v1:client:";

/**
 * Version 1 reserves one application-side unit for each provider call the
 * public route could start. The route disables SDK retries and can execute at
 * most MAX_AI_TOOL_STEPS provider calls, so every provider-ready request
 * reserves exactly this many units before audit setup or provider execution.
 */
export const AI_CHAT_ADMISSION_UNIT_VERSION =
  "estimated-provider-call-v1" as const;
export const AI_CHAT_ADMISSION_UNITS_PER_REQUEST = MAX_AI_TOOL_STEPS;

export type AiChatAdmissionBudgetDecision = {
  allowed: boolean;
  reservedUnits: number;
  retryAfterSeconds: number;
  unitVersion: typeof AI_CHAT_ADMISSION_UNIT_VERSION;
};

export type AiChatAdmissionBudget = {
  reserve: (
    clientIdentifier: string,
    nowMs?: number,
  ) => Promise<AiChatAdmissionBudgetDecision>;
  reset: () => void;
};

export type AiChatAdmissionBudgetConfig = {
  clientUnitsPerDay: number;
  globalUnitsPerDay: number;
};

function validateConfiguredLimit(name: string, value: number): void {
  if (
    !Number.isSafeInteger(value) ||
    value < AI_CHAT_ADMISSION_UNITS_PER_REQUEST ||
    value > MAX_AI_CHAT_ADMISSION_UNITS ||
    value % AI_CHAT_ADMISSION_UNITS_PER_REQUEST !== 0
  ) {
    throw new Error(
      `${name} must be a safe integer multiple of ${AI_CHAT_ADMISSION_UNITS_PER_REQUEST} between ${AI_CHAT_ADMISSION_UNITS_PER_REQUEST} and ${MAX_AI_CHAT_ADMISSION_UNITS}.`,
    );
  }
}

export function resolveAiChatAdmissionBudgetConfig(input: {
  clientUnitsPerDay?: number;
  globalUnitsPerDay?: number;
  nodeEnv: "development" | "production" | "test";
}): AiChatAdmissionBudgetConfig {
  if (
    input.nodeEnv === "production" &&
    (input.clientUnitsPerDay === undefined ||
      input.globalUnitsPerDay === undefined)
  ) {
    throw new Error(
      "Production AI chat admission limits must be configured explicitly.",
    );
  }

  const clientUnitsPerDay =
    input.clientUnitsPerDay ?? DEVELOPMENT_CLIENT_UNITS_PER_DAY;
  const globalUnitsPerDay =
    input.globalUnitsPerDay ?? DEVELOPMENT_GLOBAL_UNITS_PER_DAY;

  validateConfiguredLimit("Client admission limit", clientUnitsPerDay);
  validateConfiguredLimit("Global admission limit", globalUnitsPerDay);
  if (clientUnitsPerDay > globalUnitsPerDay) {
    throw new Error(
      "Client AI chat admission limit cannot exceed the global limit.",
    );
  }

  return { clientUnitsPerDay, globalUnitsPerDay };
}

function sha256DomainValue(domain: string, value: string): string {
  return createHash("sha256").update(domain).update(value).digest("hex");
}

export function getAiChatAdmissionWindow(nowMs: number): {
  resetAt: Date;
  retryAfterSeconds: number;
  windowStart: Date;
} {
  if (
    !Number.isSafeInteger(nowMs) ||
    nowMs < 0 ||
    nowMs > MAX_DATE_MS - UTC_DAY_MS
  ) {
    throw new Error("Admission clock must be a non-negative epoch millisecond.");
  }
  const windowStartMs = Math.floor(nowMs / UTC_DAY_MS) * UTC_DAY_MS;
  const resetAtMs = windowStartMs + UTC_DAY_MS;
  const retryAfterSeconds = Math.ceil((resetAtMs - nowMs) / 1_000);
  if (retryAfterSeconds < 1 || retryAfterSeconds > 86_400) {
    throw new Error("Admission retry interval fell outside one UTC day.");
  }
  return {
    resetAt: new Date(resetAtMs),
    retryAfterSeconds,
    windowStart: new Date(windowStartMs),
  };
}

type MemoryBucket = {
  count: number;
  windowStartMs: number;
};

export function createInMemoryAiChatAdmissionBudget(
  config: AiChatAdmissionBudgetConfig,
): AiChatAdmissionBudget {
  validateConfiguredLimit("Client admission limit", config.clientUnitsPerDay);
  validateConfiguredLimit("Global admission limit", config.globalUnitsPerDay);
  if (config.clientUnitsPerDay > config.globalUnitsPerDay) {
    throw new Error(
      "Client AI chat admission limit cannot exceed the global limit.",
    );
  }

  let globalBucket: MemoryBucket | undefined;
  const clientBuckets = new Map<string, MemoryBucket>();

  return {
    async reserve(clientIdentifier, nowMs = Date.now()) {
      const { retryAfterSeconds, windowStart } =
        getAiChatAdmissionWindow(nowMs);
      const windowStartMs = windowStart.getTime();
      if (globalBucket?.windowStartMs !== windowStartMs) {
        globalBucket = undefined;
        clientBuckets.clear();
      }

      const globalCount = globalBucket?.count ?? 0;
      const currentClientBucket = clientBuckets.get(clientIdentifier);
      const clientCount =
        currentClientBucket?.windowStartMs === windowStartMs
          ? currentClientBucket.count
          : 0;
      const nextGlobalCount =
        globalCount + AI_CHAT_ADMISSION_UNITS_PER_REQUEST;
      const nextClientCount =
        clientCount + AI_CHAT_ADMISSION_UNITS_PER_REQUEST;

      if (
        nextGlobalCount > config.globalUnitsPerDay ||
        nextClientCount > config.clientUnitsPerDay
      ) {
        return {
          allowed: false,
          reservedUnits: 0,
          retryAfterSeconds,
          unitVersion: AI_CHAT_ADMISSION_UNIT_VERSION,
        };
      }

      globalBucket = { count: nextGlobalCount, windowStartMs };
      clientBuckets.set(clientIdentifier, {
        count: nextClientCount,
        windowStartMs,
      });
      return {
        allowed: true,
        reservedUnits: AI_CHAT_ADMISSION_UNITS_PER_REQUEST,
        retryAfterSeconds: 0,
        unitVersion: AI_CHAT_ADMISSION_UNIT_VERSION,
      };
    },
    reset() {
      globalBucket = undefined;
      clientBuckets.clear();
    },
  };
}

export function createPostgresAiChatAdmissionBudget(input: {
  config: AiChatAdmissionBudgetConfig;
  repository: RateLimitRepository;
}): AiChatAdmissionBudget {
  validateConfiguredLimit(
    "Client admission limit",
    input.config.clientUnitsPerDay,
  );
  validateConfiguredLimit(
    "Global admission limit",
    input.config.globalUnitsPerDay,
  );
  if (input.config.clientUnitsPerDay > input.config.globalUnitsPerDay) {
    throw new Error(
      "Client AI chat admission limit cannot exceed the global limit.",
    );
  }

  return {
    async reserve(clientIdentifier, nowMs = Date.now()) {
      const { resetAt, retryAfterSeconds, windowStart } =
        getAiChatAdmissionWindow(nowMs);
      const allowed =
        await input.repository.reserveAiChatAdmissionProviderCallUnits({
          client: {
            keyHash: sha256DomainValue(
              CLIENT_HASH_DOMAIN,
              clientIdentifier,
            ),
            limit: input.config.clientUnitsPerDay,
            scope: CLIENT_SCOPE,
          },
          global: {
            keyHash: sha256DomainValue(GLOBAL_HASH_DOMAIN, "all"),
            limit: input.config.globalUnitsPerDay,
            scope: GLOBAL_SCOPE,
          },
          now: new Date(nowMs),
          resetAt,
          units: AI_CHAT_ADMISSION_UNITS_PER_REQUEST,
          windowStart,
        });

      return allowed
        ? {
            allowed: true,
            reservedUnits: AI_CHAT_ADMISSION_UNITS_PER_REQUEST,
            retryAfterSeconds: 0,
            unitVersion: AI_CHAT_ADMISSION_UNIT_VERSION,
          }
        : {
            allowed: false,
            reservedUnits: 0,
            retryAfterSeconds,
            unitVersion: AI_CHAT_ADMISSION_UNIT_VERSION,
          };
    },
    reset() {
      // Committed shared reservations intentionally cannot be refunded/reset.
    },
  };
}

type RuntimeWithAiChatAdmissionBudget = typeof globalThis & {
  __aiChatAdmissionBudget?: AiChatAdmissionBudget;
};

function resolveRuntimeConfiguration(): {
  backend: "memory" | "postgres";
  config: AiChatAdmissionBudgetConfig;
} {
  const config = resolveAiChatAdmissionBudgetConfig({
    clientUnitsPerDay:
      env.AI_CHAT_ADMISSION_CLIENT_PROVIDER_CALL_UNITS_PER_DAY,
    globalUnitsPerDay:
      env.AI_CHAT_ADMISSION_GLOBAL_PROVIDER_CALL_UNITS_PER_DAY,
    nodeEnv: env.NODE_ENV,
  });
  const backend = resolveAiChatRateLimitBackend({
    configuredBackend: env.AI_CHAT_RATE_LIMIT_BACKEND,
    nodeEnv: env.NODE_ENV,
  });
  return { backend, config };
}

export function validateAiChatAdmissionBudgetConfiguration(): void {
  // This validation deliberately does not construct a database client or
  // mutate a bucket. Routes can fail closed before deterministic model and
  // attachment checks without charging requests that never become ready.
  resolveRuntimeConfiguration();
}

export function getAiChatAdmissionBudget(): AiChatAdmissionBudget {
  const runtime = globalThis as RuntimeWithAiChatAdmissionBudget;
  if (!runtime.__aiChatAdmissionBudget) {
    // Resolve and validate production settings before creating a database
    // client. Missing/invalid production configuration therefore fails closed
    // without beginning budget or model work.
    const { backend, config } = resolveRuntimeConfiguration();

    runtime.__aiChatAdmissionBudget =
      backend === "postgres"
        ? createPostgresAiChatAdmissionBudget({
            config,
            repository: createRateLimitRepository(getDatabase()),
          })
        : createInMemoryAiChatAdmissionBudget(config);
  }
  return runtime.__aiChatAdmissionBudget;
}
