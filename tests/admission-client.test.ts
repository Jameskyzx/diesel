import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  database: {},
  drizzle: vi.fn(),
  end: vi.fn(),
  postgres: vi.fn(),
  url: vi.fn(() => "postgres://test.invalid/admission"),
}));
vi.mock("postgres", () => ({ default: mocks.postgres }));
vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: mocks.drizzle }));
vi.mock("@/server/db/environment", () => ({ getDatabaseUrl: mocks.url }));

import {
  closeAdmissionConnection,
  getAdmissionDatabase,
} from "@/server/db/admission-client";
import { MAX_CHAT_RATE_LIMIT_CHECK_MS } from "@/server/http/request-limits";
import {
  RATE_LIMIT_LOCK_TIMEOUT_MS,
  RATE_LIMIT_STATEMENT_TIMEOUT_MS,
} from "@/server/repositories/rate-limit-repository";

beforeEach(() => {
  mocks.end.mockResolvedValue(undefined);
  mocks.postgres.mockReturnValue({ end: mocks.end });
  mocks.drizzle.mockReturnValue(mocks.database);
});
afterEach(async () => {
  await closeAdmissionConnection();
  vi.clearAllMocks();
});

describe("dedicated PostgreSQL admission pool", () => {
  it("does not open a connection at module import", () => {
    expect(mocks.postgres).not.toHaveBeenCalled();
  });

  it("retains a bounded pool without unnecessary type catalog discovery", () => {
    expect(getAdmissionDatabase()).toBe(mocks.database);
    expect(mocks.postgres).toHaveBeenCalledExactlyOnceWith(
      "postgres://test.invalid/admission",
      {
        connect_timeout: 10,
        connection: { application_name: `diesel-admission-${process.pid}` },
        fetch_types: false,
        idle_timeout: 0,
        max: 2,
        max_lifetime: 1800,
        prepare: false,
      },
    );
  });

  it("shares the same pool across repeated hourly and budget repository access", () => {
    const hourly = getAdmissionDatabase();
    const daily = getAdmissionDatabase();
    expect(hourly).toBe(daily);
    expect(mocks.postgres).toHaveBeenCalledOnce();
    expect(mocks.drizzle).toHaveBeenCalledOnce();
  });

  it("releases only its own client and creates a fresh pool after explicit close", async () => {
    getAdmissionDatabase();
    await closeAdmissionConnection();
    expect(mocks.end).toHaveBeenCalledExactlyOnceWith({ timeout: 2 });
    getAdmissionDatabase();
    expect(mocks.postgres).toHaveBeenCalledTimes(2);
  });

  it("does not relax the public admission, statement or lock deadlines", () => {
    expect(MAX_CHAT_RATE_LIMIT_CHECK_MS).toBe(3000);
    expect(RATE_LIMIT_STATEMENT_TIMEOUT_MS).toBe(2500);
    expect(RATE_LIMIT_LOCK_TIMEOUT_MS).toBe(1500);
  });

  it("propagates configuration and client creation failures without a cached fallback", () => {
    mocks.postgres.mockImplementationOnce(() => { throw new Error("offline"); });
    expect(() => getAdmissionDatabase()).toThrow("offline");
    expect(getAdmissionDatabase()).toBe(mocks.database);
    expect(mocks.postgres).toHaveBeenCalledTimes(2);
  });
});
