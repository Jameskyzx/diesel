import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ unsafe: vi.fn(), simple: vi.fn(), end: vi.fn(), postgres: vi.fn() }));
vi.mock("postgres", () => ({ default: mocks.postgres }));
vi.mock("@/server/db/environment", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/db/environment")>(),
  getDatabaseMode: () => "postgres",
  getDatabaseUrl: () => "postgres://test.invalid/readiness",
}));
import { checkDatabaseReadiness, DATABASE_READINESS_TIMEOUT_MS } from "@/server/health/readiness";
import { closeReadinessConnection, probePostgresReadiness } from "@/server/health/postgres-readiness";
import { getDatabaseTlsOptions } from "@/server/db/tls";

beforeEach(() => {
  mocks.postgres.mockReturnValue({ unsafe: mocks.unsafe, end: mocks.end });
  mocks.unsafe.mockReturnValue({ simple: mocks.simple });
  mocks.simple.mockResolvedValue([[], [{ ready: 1 }]]);
  mocks.end.mockResolvedValue(undefined);
});
afterEach(async () => {
  await closeReadinessConnection();
  vi.clearAllMocks();
});

describe("PostgreSQL readiness probe", () => {
  it("uses one round trip with an explicit transaction-local timeout for pooling proxies", async () => {
    await expect(checkDatabaseReadiness({ timeoutMs: 100 })).resolves.toBe(true);
    expect(mocks.unsafe).toHaveBeenCalledExactlyOnceWith("BEGIN READ ONLY; SET LOCAL statement_timeout = '2500ms'; SELECT 1 AS ready; COMMIT");
    expect(mocks.simple).toHaveBeenCalledOnce();
    expect(mocks.postgres).toHaveBeenCalledExactlyOnceWith("postgres://test.invalid/readiness", {
      connect_timeout: 10,
      connection: {
        application_name: `diesel-readiness-${process.pid}`,
        statement_timeout: 2500, lock_timeout: 2500, idle_in_transaction_session_timeout: 2500,
      },
      fetch_types: false, idle_timeout: 0, max: 1, max_lifetime: 1800, prepare: false,
      ssl: getDatabaseTlsOptions("postgres://test.invalid/readiness"),
    });
    expect(DATABASE_READINESS_TIMEOUT_MS).toBe(8000);
  });
  it("reuses one connection but runs fresh SQL for every settled check", async () => {
    await probePostgresReadiness();
    await probePostgresReadiness();
    expect(mocks.postgres).toHaveBeenCalledTimes(1);
    expect(mocks.unsafe).toHaveBeenCalledTimes(2);
  });
  it.each([{ rows: [] }, { rows: [[], [{ ready: 0 }]] }, { rows: [[], [{ ready: "1" }]] }, { rows: [[], [{ ready: 1 }, { ready: 1 }]] }])("fails closed on an invalid result $rows", async ({ rows }) => {
    mocks.simple.mockResolvedValue(rows);
    await expect(checkDatabaseReadiness({ probe: probePostgresReadiness })).resolves.toBe(false);
  });
  it("does not turn a query failure or slow connection into a cached success", async () => {
    await probePostgresReadiness();
    mocks.simple.mockRejectedValueOnce(new Error("unavailable"));
    await expect(checkDatabaseReadiness({ probe: probePostgresReadiness })).resolves.toBe(false);
    expect(mocks.end).toHaveBeenCalledExactlyOnceWith({ timeout: 1 });
    mocks.simple.mockReturnValueOnce(new Promise(() => undefined));
    await expect(checkDatabaseReadiness({ probe: probePostgresReadiness, timeoutMs: 5 })).resolves.toBe(false);
  });
  it("retires a failed transaction before opening a new connection", async () => {
    mocks.simple.mockRejectedValueOnce(new Error("statement timeout"));
    await expect(probePostgresReadiness()).rejects.toThrow("statement timeout");
    expect(mocks.end).toHaveBeenCalledExactlyOnceWith({ timeout: 1 });
    await expect(probePostgresReadiness()).resolves.toBeUndefined();
    expect(mocks.postgres).toHaveBeenCalledTimes(2);
  });
  it("closes its own bounded connection without touching the business pool", async () => {
    await probePostgresReadiness();
    await closeReadinessConnection();
    expect(mocks.end).toHaveBeenCalledExactlyOnceWith({ timeout: 2 });
    await probePostgresReadiness();
    expect(mocks.postgres).toHaveBeenCalledTimes(2);
  });
  it("allows a healthy cold handshake within its explicit HTTP budget without retrying", async () => {
    vi.useFakeTimers();
    try {
      const probe = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 4000)));
      const result = checkDatabaseReadiness({ probe });
      await vi.advanceTimersByTimeAsync(4000);
      await expect(result).resolves.toBe(true);
      expect(probe).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it("still fails a stuck connection at the eight-second deadline without a success cache", async () => {
    vi.useFakeTimers();
    try {
      const probe = vi.fn(() => new Promise<void>(() => undefined));
      const result = checkDatabaseReadiness({ probe });
      await vi.advanceTimersByTimeAsync(8000);
      await expect(result).resolves.toBe(false);
      expect(probe).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
});
