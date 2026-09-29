import { describe, expect, it, vi } from "vitest";

import {
  AI_CHAT_ADMISSION_UNIT_VERSION,
  AI_CHAT_ADMISSION_UNITS_PER_REQUEST,
  createInMemoryAiChatAdmissionBudget,
  createPostgresAiChatAdmissionBudget,
  getAiChatAdmissionWindow,
  resolveAiChatAdmissionBudgetConfig,
} from "@/server/http/ai-admission-budget";
import type {
  RateLimitRepository,
  ReserveAiChatAdmissionProviderCallUnitsInput,
} from "@/server/repositories/rate-limit-repository";

describe("AI chat estimated provider-call admission budget", () => {
  const utcDayStart = Date.UTC(2026, 8, 5);

  it("reserves five v1 provider-call units atomically across global and client limits", async () => {
    expect(AI_CHAT_ADMISSION_UNITS_PER_REQUEST).toBe(5);
    const budget = createInMemoryAiChatAdmissionBudget({
      clientUnitsPerDay: 5,
      globalUnitsPerDay: 10,
    });

    await expect(budget.reserve("client-a", utcDayStart)).resolves.toEqual({
      allowed: true,
      reservedUnits: 5,
      retryAfterSeconds: 0,
      unitVersion: AI_CHAT_ADMISSION_UNIT_VERSION,
    });

    const rejectedClientRetry = await budget.reserve(
      "client-a",
      utcDayStart + 1_000,
    );
    expect(rejectedClientRetry).toMatchObject({
      allowed: false,
      reservedUnits: 0,
      retryAfterSeconds: 86_399,
    });

    // The rejected client reservation did not consume the global remainder.
    await expect(
      budget.reserve("client-b", utcDayStart + 2_000),
    ).resolves.toMatchObject({ allowed: true, reservedUnits: 5 });
    await expect(
      budget.reserve("client-c", utcDayStart + 3_000),
    ).resolves.toMatchObject({ allowed: false, reservedUnits: 0 });
  });

  it("uses UTC-day windows and returns a bounded positive Retry-After", async () => {
    const budget = createInMemoryAiChatAdmissionBudget({
      clientUnitsPerDay: 5,
      globalUnitsPerDay: 5,
    });
    await budget.reserve("client-a", utcDayStart + 86_399_999);
    const atEnd = await budget.reserve(
      "client-a",
      utcDayStart + 86_399_999,
    );
    expect(atEnd.retryAfterSeconds).toBe(1);

    const nextDay = await budget.reserve("client-a", utcDayStart + 86_400_000);
    expect(nextDay).toMatchObject({
      allowed: true,
      reservedUnits: 5,
      retryAfterSeconds: 0,
    });
    expect(getAiChatAdmissionWindow(utcDayStart)).toEqual({
      resetAt: new Date(utcDayStart + 86_400_000),
      retryAfterSeconds: 86_400,
      windowStart: new Date(utcDayStart),
    });
    expect(() => getAiChatAdmissionWindow(Number.NaN)).toThrow(
      "non-negative epoch millisecond",
    );
    expect(() =>
      getAiChatAdmissionWindow(8_640_000_000_000_000),
    ).toThrow("non-negative epoch millisecond");
  });

  it("fails closed on missing production settings and rejects invalid relationships", () => {
    expect(() =>
      resolveAiChatAdmissionBudgetConfig({ nodeEnv: "production" }),
    ).toThrow("must be configured explicitly");
    expect(() =>
      resolveAiChatAdmissionBudgetConfig({
        clientUnitsPerDay: 10,
        globalUnitsPerDay: 5,
        nodeEnv: "production",
      }),
    ).toThrow("cannot exceed the global limit");
    expect(() =>
      resolveAiChatAdmissionBudgetConfig({
        clientUnitsPerDay: 6,
        globalUnitsPerDay: 10,
        nodeEnv: "test",
      }),
    ).toThrow("multiple of 5");

    expect(
      resolveAiChatAdmissionBudgetConfig({ nodeEnv: "test" }),
    ).toEqual({
      clientUnitsPerDay: 100_000,
      globalUnitsPerDay: 1_000_000,
    });
  });

  it("passes only domain-separated hashes and a validated UTC window to PostgreSQL", async () => {
    let captured:
      | ReserveAiChatAdmissionProviderCallUnitsInput
      | undefined;
    const repository: RateLimitRepository = {
      cleanupExpiredBuckets: vi.fn(async () => undefined),
      reserveAiChatHourlyRequest: vi.fn(async () => ({
        allowed: false as const,
      })),
      reserveAiChatAdmissionProviderCallUnits: vi.fn(async (input) => {
        captured = input;
        return true;
      }),
    };
    const budget = createPostgresAiChatAdmissionBudget({
      config: { clientUnitsPerDay: 50, globalUnitsPerDay: 500 },
      repository,
    });

    await expect(
      budget.reserve("203.0.113.44", utcDayStart + 12_345),
    ).resolves.toMatchObject({ allowed: true, reservedUnits: 5 });

    expect(captured).toBeDefined();
    expect(captured?.global.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(captured?.client.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(captured?.client.keyHash).not.toBe(captured?.global.keyHash);
    expect(JSON.stringify(captured)).not.toContain("203.0.113.44");
    expect(captured).toMatchObject({
      client: {
        limit: 50,
        scope: "ai-chat-admission-provider-call-client-v1",
      },
      global: {
        limit: 500,
        scope: "ai-chat-admission-provider-call-global-v1",
      },
      now: new Date(utcDayStart + 12_345),
      resetAt: new Date(utcDayStart + 86_400_000),
      units: 5,
      windowStart: new Date(utcDayStart),
    });
  });
});
