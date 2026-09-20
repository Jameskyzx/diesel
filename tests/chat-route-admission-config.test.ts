import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSalesChatTools: vi.fn(),
  getAiAuditRepository: vi.fn(),
  getConfiguredAiModel: vi.fn(),
  getDatabase: vi.fn(),
  streamSalesChat: vi.fn(),
}));

vi.mock("@/server/ai/model", () => ({
  AiConfigurationError: class AiConfigurationError extends Error {},
  getConfiguredAiModel: mocks.getConfiguredAiModel,
}));

vi.mock("@/server/ai/sales-chat", () => ({
  createSalesChatTools: mocks.createSalesChatTools,
  streamSalesChat: mocks.streamSalesChat,
}));

vi.mock("@/server/services/ai-audit-service", () => ({
  getAiAuditRepository: mocks.getAiAuditRepository,
}));

vi.mock("@/server/db/client", () => ({
  getDatabase: mocks.getDatabase,
}));

type AdmissionConfigRuntime = typeof globalThis & {
  __aiChatAdmissionBudget?: unknown;
  __aiChatInFlightGate?: unknown;
  __aiChatRateLimiter?: unknown;
};

const runtime = globalThis as AdmissionConfigRuntime;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  delete runtime.__aiChatAdmissionBudget;
  delete runtime.__aiChatInFlightGate;
  delete runtime.__aiChatRateLimiter;
});

describe("POST /api/chat production admission configuration", () => {
  it("keeps deterministic direct responses available when daily limits are missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AI_CHAT_RATE_LIMIT_BACKEND", "postgres");
    vi.stubEnv("AI_CHAT_ADMISSION_GLOBAL_PROVIDER_CALL_UNITS_PER_DAY", "");
    vi.stubEnv("AI_CHAT_ADMISSION_CLIENT_PROVIDER_CALL_UNITS_PER_DAY", "");
    vi.resetModules();
    runtime.__aiChatRateLimiter = {
      check: vi.fn(async () => ({
        allowed: true,
        limit: 100,
        remaining: 99,
        retryAfterSeconds: 0,
      })),
      reset: vi.fn(),
    };

    const { POST } = await import("@/app/api/chat/route");
    const response = await POST(
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          messages: [
            {
              id: "direct-without-budget-config",
              parts: [{ text: "Hello", type: "text" }],
              role: "user",
            },
          ],
          sessionId: crypto.randomUUID(),
        }),
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.97",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain("structured facts");
    expect(mocks.getDatabase).not.toHaveBeenCalled();
    expect(mocks.getConfiguredAiModel).not.toHaveBeenCalled();
    expect(mocks.getAiAuditRepository).not.toHaveBeenCalled();
    expect(mocks.streamSalesChat).not.toHaveBeenCalled();
  });

  it("fails closed before database, model, audit, or provider setup when limits are missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AI_CHAT_RATE_LIMIT_BACKEND", "postgres");
    vi.stubEnv("AI_CHAT_ADMISSION_GLOBAL_PROVIDER_CALL_UNITS_PER_DAY", "");
    vi.stubEnv("AI_CHAT_ADMISSION_CLIENT_PROVIDER_CALL_UNITS_PER_DAY", "");
    vi.resetModules();
    runtime.__aiChatRateLimiter = {
      check: vi.fn(async () => ({
        allowed: true,
        limit: 100,
        remaining: 99,
        retryAfterSeconds: 0,
      })),
      reset: vi.fn(),
    };
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      const { POST } = await import("@/app/api/chat/route");
      const response = await POST(
        new Request("http://localhost/api/chat", {
          body: JSON.stringify({
            messages: [
              {
                id: "missing-budget-config",
                parts: [
                  {
                    text:
                      "Compare CHN and BRA non-road regulations at 100 kW.",
                    type: "text",
                  },
                ],
                role: "user",
              },
            ],
            sessionId: crypto.randomUUID(),
          }),
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": "203.0.113.96",
          },
          method: "POST",
        }),
      );

      expect(response.status).toBe(503);
      expect(response.headers.get("Retry-After")).toBe("60");
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "INTERNAL_ERROR",
          message:
            "The AI chat service is temporarily unavailable. Please try again later.",
        },
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        "AI chat admission budget configuration invalid",
        { errorCode: "Error" },
      );
      expect(mocks.getDatabase).not.toHaveBeenCalled();
      expect(mocks.getConfiguredAiModel).not.toHaveBeenCalled();
      expect(mocks.getAiAuditRepository).not.toHaveBeenCalled();
      expect(mocks.streamSalesChat).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
