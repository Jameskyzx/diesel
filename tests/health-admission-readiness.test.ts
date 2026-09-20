import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkDatabaseReadiness: vi.fn(),
}));

vi.mock("@/server/health/readiness", () => ({
  checkDatabaseReadiness: mocks.checkDatabaseReadiness,
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function requestProductionReadiness(input: {
  backend?: "memory" | "postgres";
  clientLimit: string;
  databaseReady: boolean;
  globalLimit: string;
  hourlyClientLimit?: string;
  hourlyGlobalLimit?: string;
}): Promise<{
  log: Record<string, unknown>;
  payload: unknown;
  response: Response;
}> {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("APP_VERSION", "readiness-test");
  vi.stubEnv("AI_CHAT_RATE_LIMIT_BACKEND", input.backend ?? "postgres");
  vi.stubEnv(
    "AI_CHAT_RATE_LIMIT_GLOBAL_PER_HOUR",
    input.hourlyGlobalLimit ?? "300",
  );
  vi.stubEnv(
    "AI_CHAT_RATE_LIMIT_PER_HOUR",
    input.hourlyClientLimit ?? "30",
  );
  vi.stubEnv(
    "AI_CHAT_ADMISSION_CLIENT_PROVIDER_CALL_UNITS_PER_DAY",
    input.clientLimit,
  );
  vi.stubEnv(
    "AI_CHAT_ADMISSION_GLOBAL_PROVIDER_CALL_UNITS_PER_DAY",
    input.globalLimit,
  );
  mocks.checkDatabaseReadiness.mockResolvedValue(input.databaseReady);
  const consoleInfo = vi
    .spyOn(console, "info")
    .mockImplementation(() => undefined);

  const { GET } = await import("@/app/api/health/ready/route");
  const response = await GET();
  const payload = await response.json();
  const serializedLog = consoleInfo.mock.calls.at(-1)?.[0];
  if (typeof serializedLog !== "string") {
    throw new TypeError("Readiness did not emit a structured request log.");
  }

  return {
    log: JSON.parse(serializedLog) as Record<string, unknown>,
    payload,
    response,
  };
}

describe("production AI admission readiness", () => {
  it("returns all three readiness checks for a valid production configuration", async () => {
    const result = await requestProductionReadiness({
      clientLimit: "500",
      databaseReady: true,
      globalLimit: "50000",
      hourlyClientLimit: "30",
      hourlyGlobalLimit: "300",
    });

    expect(result.response.status).toBe(200);
    expect(result.payload).toEqual({
      checks: {
        aiChatAdmission: "ok",
        aiChatRateLimit: "ok",
        database: "ok",
      },
      service: "global-diesel-regulations",
      status: "ok",
      timestamp: expect.any(String),
      version: "readiness-test",
    });
    expect(result.log.errorCode).toBeNull();
  });

  it.each([
    {
      clientLimit: "",
      globalLimit: "",
      label: "missing limits",
    },
    {
      clientLimit: "505",
      globalLimit: "500",
      label: "client limit above the global limit",
    },
  ])("returns 503 for $label while preserving database status", async (input) => {
    const result = await requestProductionReadiness({
      ...input,
      databaseReady: true,
    });

    expect(result.response.status).toBe(503);
    expect(result.payload).toEqual({
      checks: {
        aiChatAdmission: "unavailable",
        aiChatRateLimit: "ok",
        database: "ok",
      },
      service: "global-diesel-regulations",
      status: "unavailable",
      timestamp: expect.any(String),
      version: "readiness-test",
    });
    expect(result.log.errorCode).toBe(
      "AI_CHAT_ADMISSION_CONFIG_NOT_READY",
    );
  });

  it("classifies a database-only readiness failure", async () => {
    const result = await requestProductionReadiness({
      clientLimit: "500",
      databaseReady: false,
      globalLimit: "50000",
    });

    expect(result.response.status).toBe(503);
    expect(result.payload).toEqual({
      checks: {
        aiChatAdmission: "ok",
        aiChatRateLimit: "ok",
        database: "unavailable",
      },
      service: "global-diesel-regulations",
      status: "unavailable",
      timestamp: expect.any(String),
      version: "readiness-test",
    });
    expect(result.log.errorCode).toBe("DATABASE_NOT_READY");
  });

  it("classifies simultaneous readiness failures without hiding either check", async () => {
    const result = await requestProductionReadiness({
      clientLimit: "",
      databaseReady: false,
      globalLimit: "",
    });

    expect(result.response.status).toBe(503);
    expect(result.payload).toEqual({
      checks: {
        aiChatAdmission: "unavailable",
        aiChatRateLimit: "ok",
        database: "unavailable",
      },
      service: "global-diesel-regulations",
      status: "unavailable",
      timestamp: expect.any(String),
      version: "readiness-test",
    });
    expect(result.log.errorCode).toBe("READINESS_CHECKS_FAILED");
  });

  it("classifies an hourly rate-limit configuration failure independently", async () => {
    const result = await requestProductionReadiness({
      clientLimit: "500",
      databaseReady: true,
      globalLimit: "50000",
      hourlyClientLimit: "31",
      hourlyGlobalLimit: "30",
    });

    expect(result.response.status).toBe(503);
    expect(result.payload).toEqual({
      checks: {
        aiChatAdmission: "ok",
        aiChatRateLimit: "unavailable",
        database: "ok",
      },
      service: "global-diesel-regulations",
      status: "unavailable",
      timestamp: expect.any(String),
      version: "readiness-test",
    });
    expect(result.log.errorCode).toBe(
      "AI_CHAT_RATE_LIMIT_CONFIG_NOT_READY",
    );
  });

  it("classifies a production memory backend as multiple failed checks", async () => {
    const result = await requestProductionReadiness({
      backend: "memory",
      clientLimit: "500",
      databaseReady: true,
      globalLimit: "50000",
    });

    expect(result.response.status).toBe(503);
    expect(result.payload).toEqual({
      checks: {
        aiChatAdmission: "unavailable",
        aiChatRateLimit: "unavailable",
        database: "ok",
      },
      service: "global-diesel-regulations",
      status: "unavailable",
      timestamp: expect.any(String),
      version: "readiness-test",
    });
    expect(result.log.errorCode).toBe("READINESS_CHECKS_FAILED");
  });
});
