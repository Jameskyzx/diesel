import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import {
  createRateLimitRepository,
  RATE_LIMIT_CLEANUP_BATCH_SIZE,
  RATE_LIMIT_CLEANUP_GRACE_MS,
  type ReserveAiChatHourlyRequestInput,
  type ReserveAiChatAdmissionProviderCallUnitsInput,
} from "@/server/repositories/rate-limit-repository";

const utcDayStart = Date.UTC(2026, 8, 5);

function validInput(): ReserveAiChatAdmissionProviderCallUnitsInput {
  return {
    client: {
      keyHash: "b".repeat(64),
      limit: 50,
      scope: "ai-chat-admission-provider-call-client-v1",
    },
    global: {
      keyHash: "a".repeat(64),
      limit: 500,
      scope: "ai-chat-admission-provider-call-global-v1",
    },
    now: new Date(utcDayStart + 12_345),
    resetAt: new Date(utcDayStart + 86_400_000),
    units: 5,
    windowStart: new Date(utcDayStart),
  };
}

function validHourlyInput(): ReserveAiChatHourlyRequestInput {
  return {
    client: {
      keyHash: "d".repeat(64),
      limit: 30,
      scope: "ai-chat-hourly-v1",
    },
    expiresAt: new Date(utcDayStart + 60 * 60 * 1_000),
    global: {
      keyHash: "c".repeat(64),
      limit: 300,
      scope: "ai-chat-hourly-global-v1",
    },
    now: new Date(utcDayStart + 12_345),
    windowStart: new Date(utcDayStart),
  };
}

function createFakeDatabase(returnedCounts: Array<number | null>) {
  const insertedScopes: string[] = [];
  const returning = vi.fn(async () => {
    const count = returnedCounts.shift();
    return count === null || count === undefined
      ? []
      : [{ requestCount: count }];
  });
  const onConflictDoUpdate = vi.fn(() => ({ returning }));
  const values = vi.fn((value: { scope: string }) => {
    insertedScopes.push(value.scope);
    return { onConflictDoUpdate };
  });
  const transaction = {
    execute: vi.fn(async (query?: unknown) => {
      void query;
    }),
    insert: vi.fn(() => ({ values })),
  };
  const database = {
    transaction: vi.fn(
      async (callback: (value: typeof transaction) => Promise<boolean>) =>
        callback(transaction),
    ),
  };
  return { database, insertedScopes, onConflictDoUpdate, transaction };
}

describe("rate-limit repository AI admission transaction", () => {
  it("keeps retention cleanup out of the request counter transaction", async () => {
    const fake = createFakeDatabase([1, 1]);
    const repository = createRateLimitRepository(fake.database as never);

    await expect(
      repository.reserveAiChatHourlyRequest(validHourlyInput()),
    ).resolves.toEqual({
      allowed: true,
      clientCount: 1,
      globalCount: 1,
    });

    expect(fake.transaction.execute).toHaveBeenCalledTimes(1);
    expect(fake.insertedScopes).toEqual([
      "ai-chat-hourly-global-v1",
      "ai-chat-hourly-v1",
    ]);
  });

  it("fails hourly admission atomically in fixed global-to-client order", async () => {
    const globalExhausted = createFakeDatabase([null]);
    await expect(
      createRateLimitRepository(
        globalExhausted.database as never,
      ).reserveAiChatHourlyRequest(validHourlyInput()),
    ).resolves.toEqual({ allowed: false });
    expect(globalExhausted.insertedScopes).toEqual([
      "ai-chat-hourly-global-v1",
    ]);

    const clientExhausted = createFakeDatabase([2, null]);
    await expect(
      createRateLimitRepository(
        clientExhausted.database as never,
      ).reserveAiChatHourlyRequest(validHourlyInput()),
    ).resolves.toEqual({ allowed: false });
    expect(clientExhausted.insertedScopes).toEqual([
      "ai-chat-hourly-global-v1",
      "ai-chat-hourly-v1",
    ]);
  });

  it.each([
    ["client above global", {
      client: { ...validHourlyInput().client, limit: 301 },
    }],
    ["unaligned window", {
      windowStart: new Date(utcDayStart + 1),
    }],
    ["wrong expiry", {
      expiresAt: new Date(utcDayStart + 60_000),
    }],
    ["invalid hash", {
      global: { ...validHourlyInput().global, keyHash: "global" },
    }],
    ["shared scope", {
      global: {
        ...validHourlyInput().global,
        scope: validHourlyInput().client.scope,
      },
    }],
  ] as const)("rejects invalid hourly input: %s", async (_label, patch) => {
    const fake = createFakeDatabase([]);
    await expect(
      createRateLimitRepository(
        fake.database as never,
      ).reserveAiChatHourlyRequest({
        ...validHourlyInput(),
        ...patch,
      }),
    ).rejects.toBeInstanceOf(Error);
    expect(fake.database.transaction).not.toHaveBeenCalled();
  });

  it("builds a DB-clock bounded cleanup with stable SKIP LOCKED ordering", async () => {
    const fake = createFakeDatabase([]);
    const repository = createRateLimitRepository(fake.database as never);

    await expect(repository.cleanupExpiredBuckets()).resolves.toBeUndefined();
    expect(fake.transaction.execute).toHaveBeenCalledTimes(2);

    const cleanupSql = fake.transaction.execute.mock.calls[1]?.[0] as SQL;
    const rendered = new PgDialect().sqlToQuery(cleanupSql).sql;
    expect(RATE_LIMIT_CLEANUP_BATCH_SIZE).toBe(500);
    expect(RATE_LIMIT_CLEANUP_GRACE_MS).toBe(10 * 60 * 1_000);
    expect(rendered).toContain("statement_timestamp()");
    expect(rendered).toContain("interval '1 millisecond'");
    expect(rendered).toContain("order by");
    expect(rendered).toContain("\"expires_at\" asc");
    expect(rendered).toContain("\"scope\" asc");
    expect(rendered).toContain("\"key_hash\" asc");
    expect(rendered).toContain("\"window_start\" asc");
    expect(rendered).toContain("limit $");
    expect(rendered).toContain("for update skip locked");
    expect(rendered).toContain("delete from \"api_rate_limit_buckets\"");
  });

  it("reserves the global bucket before the client bucket", async () => {
    const fake = createFakeDatabase([5, 5]);
    const repository = createRateLimitRepository(fake.database as never);

    await expect(
      repository.reserveAiChatAdmissionProviderCallUnits(validInput()),
    ).resolves.toBe(true);
    expect(fake.insertedScopes).toEqual([
      "ai-chat-admission-provider-call-global-v1",
      "ai-chat-admission-provider-call-client-v1",
    ]);
    expect(fake.onConflictDoUpdate).toHaveBeenCalledTimes(2);
  });

  it("reports exhaustion when either conditional UPSERT returns no row", async () => {
    const globalExhausted = createFakeDatabase([null]);
    await expect(
      createRateLimitRepository(
        globalExhausted.database as never,
      ).reserveAiChatAdmissionProviderCallUnits(validInput()),
    ).resolves.toBe(false);
    expect(globalExhausted.insertedScopes).toEqual([
      "ai-chat-admission-provider-call-global-v1",
    ]);

    const clientExhausted = createFakeDatabase([10, null]);
    await expect(
      createRateLimitRepository(
        clientExhausted.database as never,
      ).reserveAiChatAdmissionProviderCallUnits(validInput()),
    ).resolves.toBe(false);
    expect(clientExhausted.insertedScopes).toEqual([
      "ai-chat-admission-provider-call-global-v1",
      "ai-chat-admission-provider-call-client-v1",
    ]);
  });

  it.each([
    ["zero units", { units: 0 }],
    ["fractional units", { units: 1.5 }],
    ["oversized units", { units: 2_000_000_001 }],
    ["invalid current date", { now: new Date(Number.NaN) }],
    ["non-midnight window", { windowStart: new Date(utcDayStart + 1) }],
    ["wrong reset date", { resetAt: new Date(utcDayStart + 1_000) }],
  ] as const)("rejects %s before opening a transaction", async (_name, patch) => {
    const fake = createFakeDatabase([]);
    const repository = createRateLimitRepository(fake.database as never);

    await expect(
      repository.reserveAiChatAdmissionProviderCallUnits({
        ...validInput(),
        ...patch,
      }),
    ).rejects.toBeInstanceOf(Error);
    expect(fake.database.transaction).not.toHaveBeenCalled();
  });

  it("rejects invalid limits, hashes, domain separation, and returned counts", async () => {
    const invalidInputs: ReserveAiChatAdmissionProviderCallUnitsInput[] = [
      {
        ...validInput(),
        client: { ...validInput().client, limit: 4 },
      },
      {
        ...validInput(),
        client: { ...validInput().client, limit: 6 },
      },
      {
        ...validInput(),
        client: { ...validInput().client, limit: 505 },
      },
      {
        ...validInput(),
        client: { ...validInput().client, keyHash: "raw-client-ip" },
      },
      {
        ...validInput(),
        client: {
          ...validInput().client,
          keyHash: validInput().global.keyHash,
        },
      },
      {
        ...validInput(),
        client: {
          ...validInput().client,
          scope: validInput().global.scope,
        },
      },
    ];

    for (const input of invalidInputs) {
      const fake = createFakeDatabase([]);
      await expect(
        createRateLimitRepository(
          fake.database as never,
        ).reserveAiChatAdmissionProviderCallUnits(input),
      ).rejects.toBeInstanceOf(Error);
      expect(fake.database.transaction).not.toHaveBeenCalled();
    }

    for (const invalidCount of [0, 6, 505, Number.NaN]) {
      const fake = createFakeDatabase([invalidCount]);
      await expect(
        createRateLimitRepository(
          fake.database as never,
        ).reserveAiChatAdmissionProviderCallUnits(validInput()),
      ).rejects.toThrow("invalid reserved count");
    }
  });
});
