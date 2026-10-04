import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ unsafe: vi.fn(), end: vi.fn(), postgres: vi.fn() }));
vi.mock("postgres", () => ({ default: mocks.postgres }));
vi.mock("@/server/db/environment", () => ({
  getDatabaseMode: () => "postgres",
  getDatabaseUrl: () => "postgres://test.invalid/readiness",
}));
import { checkDatabaseReadiness, DATABASE_READINESS_TIMEOUT_MS } from "@/server/health/readiness";
import { closeReadinessConnection, probePostgresReadiness } from "@/server/health/postgres-readiness";

beforeEach(() => {
  mocks.postgres.mockReturnValue({ unsafe: mocks.unsafe, end: mocks.end });
  mocks.unsafe.mockResolvedValue([{ ready: 1 }]);
  mocks.end.mockResolvedValue(undefined);
});
afterEach(async () => {
  await closeReadinessConnection();
  vi.clearAllMocks();
});

describe("PostgreSQL readiness probe", () => {
  it("uses one SQL round trip with a connection-level statement timeout", async () => {
    await expect(checkDatabaseReadiness({ timeoutMs: 100 })).resolves.toBe(true);
    expect(mocks.unsafe).toHaveBeenCalledExactlyOnceWith("select 1 as ready");
    expect(mocks.postgres).toHaveBeenCalledExactlyOnceWith("postgres://test.invalid/readiness", {
      connect_timeout: 10,
      connection: {
        application_name: `diesel-readiness-${process.pid}`,
        statement_timeout: 2500, lock_timeout: 2500, idle_in_transaction_session_timeout: 2500,
      },
      fetch_types: false, idle_timeout: 0, max: 1, max_lifetime: 1800, prepare: false,
    });
    expect(DATABASE_READINESS_TIMEOUT_MS).toBe(3000);
  });
  it("reuses one connection but runs fresh SQL for every settled check", async () => {
    await probePostgresReadiness();
    await probePostgresReadiness();
    expect(mocks.postgres).toHaveBeenCalledTimes(1);
    expect(mocks.unsafe).toHaveBeenCalledTimes(2);
  });
  it.each([{ rows: [] }, { rows: [{ ready: 0 }] }, { rows: [{ ready: "1" }] }, { rows: [{ ready: 1 }, { ready: 1 }] }])("fails closed on an invalid result $rows", async ({ rows }) => {
    mocks.unsafe.mockResolvedValue(rows);
    await expect(checkDatabaseReadiness({ probe: probePostgresReadiness })).resolves.toBe(false);
  });
  it("does not turn a query failure or slow connection into a cached success", async () => {
    await probePostgresReadiness();
    mocks.unsafe.mockRejectedValueOnce(new Error("unavailable"));
    await expect(checkDatabaseReadiness({ probe: probePostgresReadiness })).resolves.toBe(false);
    mocks.unsafe.mockReturnValueOnce(new Promise(() => undefined));
    await expect(checkDatabaseReadiness({ probe: probePostgresReadiness, timeoutMs: 5 })).resolves.toBe(false);
  });
  it("closes its own bounded connection without touching the business pool", async () => {
    await probePostgresReadiness();
    await closeReadinessConnection();
    expect(mocks.end).toHaveBeenCalledExactlyOnceWith({ timeout: 2 });
    await probePostgresReadiness();
    expect(mocks.postgres).toHaveBeenCalledTimes(2);
  });
});
