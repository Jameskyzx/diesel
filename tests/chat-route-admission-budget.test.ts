import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AI_CHAT_ADMISSION_UNIT_VERSION,
  createInMemoryAiChatAdmissionBudget,
  type AiChatAdmissionBudget,
} from "@/server/http/ai-admission-budget";

const mocks = vi.hoisted(() => {
  class MockAiConfigurationError extends Error {}
  class MockChatAttachmentProcessingError extends Error {
    constructor(public readonly publicMessage: string) {
      super(publicMessage);
    }
  }
  return {
    AiConfigurationError: MockAiConfigurationError,
    ChatAttachmentProcessingError: MockChatAttachmentProcessingError,
    createSalesChatTools: vi.fn(() => ({})),
    ensureSession: vi.fn(async () => undefined),
    getAiAuditRepository: vi.fn(),
    getConfiguredAiModel: vi.fn(),
    prepareTrustedUserMessagesForModel: vi.fn(
      async (messages: Array<{ parts: Array<{ mediaType?: string; type: string }> }>) => ({
        messages,
        requiresMultimodalModel: messages
          .at(-1)
          ?.parts.some(
            (part) =>
              part.type === "file" &&
              part.mediaType?.startsWith("image/") === true,
          ) ?? false,
      }),
    ),
    streamSalesChat: vi.fn(),
  };
});

vi.mock("@/server/ai/model", () => ({
  AiConfigurationError: mocks.AiConfigurationError,
  getConfiguredAiModel: mocks.getConfiguredAiModel,
}));

vi.mock("@/server/ai/sales-chat", () => ({
  createSalesChatTools: mocks.createSalesChatTools,
  streamSalesChat: mocks.streamSalesChat,
}));

vi.mock("@/server/ai/attachment-content", () => ({
  ChatAttachmentProcessingError: mocks.ChatAttachmentProcessingError,
  prepareTrustedUserMessagesForModel:
    mocks.prepareTrustedUserMessagesForModel,
}));

vi.mock("@/server/services/ai-audit-service", () => ({
  getAiAuditRepository: mocks.getAiAuditRepository,
}));

import { POST } from "@/app/api/chat/route";

type AdmissionRuntime = typeof globalThis & {
  __aiChatAdmissionBudget?: AiChatAdmissionBudget;
  __aiChatInFlightGate?: { reset: () => void };
  __aiChatRateLimiter?: {
    check: () => Promise<{
      allowed: boolean;
      limit: number;
      remaining: number;
      retryAfterSeconds: number;
    }>;
    reset: () => void;
  };
};

const runtime = globalThis as AdmissionRuntime;

function requestFor(text: string, clientIdentifier = "203.0.113.91"): Request {
  return new Request("http://localhost/api/chat", {
    body: JSON.stringify({
      messages: [
        {
          id: crypto.randomUUID(),
          parts: [{ text, type: "text" }],
          role: "user",
        },
      ],
      sessionId: crypto.randomUUID(),
    }),
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": clientIdentifier,
    },
    method: "POST",
  });
}

describe("POST /api/chat application-side admission budget", () => {
  beforeEach(() => {
    runtime.__aiChatInFlightGate?.reset();
    runtime.__aiChatRateLimiter = {
      check: vi.fn(async () => ({
        allowed: true,
        limit: 100,
        remaining: 99,
        retryAfterSeconds: 0,
      })),
      reset: vi.fn(),
    };
    mocks.createSalesChatTools.mockClear();
    mocks.ensureSession.mockClear();
    mocks.getAiAuditRepository.mockReset();
    mocks.getConfiguredAiModel.mockReset();
    mocks.prepareTrustedUserMessagesForModel.mockClear();
    mocks.streamSalesChat.mockReset();
    mocks.getAiAuditRepository.mockResolvedValue({
      ensureSession: mocks.ensureSession,
      recordToolCall: vi.fn(async () => undefined),
    });
    mocks.getConfiguredAiModel.mockReturnValue({
      costProfile: null,
      model: {},
      modelId: "mock/admission-budget",
    });
    mocks.streamSalesChat.mockReturnValue({
      toUIMessageStreamResponse: () =>
        new Response("ok", {
          headers: { "content-type": "text/event-stream" },
        }),
    });
  });

  it("does not reserve units for a deterministic direct response", async () => {
    const reserve = vi.fn();
    runtime.__aiChatAdmissionBudget = { reserve, reset: vi.fn() };

    const response = await POST(requestFor("Hello"));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("structured facts");
    expect(reserve).not.toHaveBeenCalled();
    expect(mocks.getConfiguredAiModel).not.toHaveBeenCalled();
  });

  it("rejects exhausted admission after deterministic checks but before audit setup", async () => {
    const reserve = vi.fn(async () => ({
      allowed: false,
      reservedUnits: 0,
      retryAfterSeconds: 43_210,
      unitVersion: AI_CHAT_ADMISSION_UNIT_VERSION,
    }));
    runtime.__aiChatAdmissionBudget = { reserve, reset: vi.fn() };
    const sessionIdMarker = "00000000-0000-4000-8000-000000000001";
    const request = new Request("http://localhost/api/chat", {
      body: JSON.stringify({
        messages: [
          {
            id: "fact-message",
            parts: [
              {
                text:
                  "Compare CHN and BRA non-road regulations at 100 kW on 2026-09-05.",
                type: "text",
              },
            ],
            role: "user",
          },
        ],
        sessionId: sessionIdMarker,
      }),
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.92",
      },
      method: "POST",
    });

    const response = await POST(request);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("43210");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "RATE_LIMITED",
        message:
          "The daily AI admission budget has been reached. Please try again after the next UTC day begins.",
      },
    });
    expect(reserve).toHaveBeenCalledWith("203.0.113.92");
    expect(JSON.stringify(reserve.mock.calls)).not.toContain(sessionIdMarker);
    expect(mocks.getConfiguredAiModel).toHaveBeenCalledOnce();
    expect(mocks.getAiAuditRepository).not.toHaveBeenCalled();
    expect(mocks.streamSalesChat).not.toHaveBeenCalled();
  });

  it("fails closed with a sanitized 503 when reservation is unavailable", async () => {
    const secretMarker = "203.0.113.93 postgres://budget-secret";
    runtime.__aiChatAdmissionBudget = {
      reserve: vi.fn(async () => {
        throw new Error(secretMarker);
      }),
      reset: vi.fn(),
    };
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      const response = await POST(
        requestFor(
          "Compare CHN and BRA non-road regulations at 100 kW.",
          "203.0.113.93",
        ),
      );
      const body = JSON.stringify(await response.json());

      expect(response.status).toBe(503);
      expect(response.headers.get("Retry-After")).toBe("60");
      expect(body).not.toContain(secretMarker);
      expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain(secretMarker);
      expect(consoleSpy).toHaveBeenCalledWith(
        "AI chat admission budget unavailable",
        { errorCode: "Error" },
      );
      expect(mocks.getConfiguredAiModel).toHaveBeenCalledOnce();
      expect(mocks.getAiAuditRepository).not.toHaveBeenCalled();
      expect(mocks.streamSalesChat).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("does not reserve when deterministic model configuration fails", async () => {
    const reserve = vi.fn();
    runtime.__aiChatAdmissionBudget = { reserve, reset: vi.fn() };
    mocks.getConfiguredAiModel.mockImplementation(() => {
      throw new mocks.AiConfigurationError("provider secret");
    });
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      const response = await POST(
        requestFor("Compare CHN and BRA non-road regulations at 100 kW."),
      );
      expect(response.status).toBe(503);
      expect(reserve).not.toHaveBeenCalled();
      expect(mocks.getAiAuditRepository).not.toHaveBeenCalled();
      expect(mocks.streamSalesChat).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("does not reserve when attachment preparation fails", async () => {
    const reserve = vi.fn();
    runtime.__aiChatAdmissionBudget = { reserve, reset: vi.fn() };
    mocks.prepareTrustedUserMessagesForModel.mockRejectedValueOnce(
      new mocks.ChatAttachmentProcessingError("invalid image"),
    );

    const response = await POST(
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          messages: [
            {
              id: "attachment-message",
              parts: [
                {
                  mediaType: "image/png",
                  filename: "invalid.png",
                  type: "file",
                  url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAHUlEQVR4nGNQTl72nxLMMGrA/9EwWDYaBsnDIgwAMoorH0C43vMAAAAASUVORK5CYII=",
                },
                { text: "Describe this attachment.", type: "text" },
              ],
              role: "user",
            },
          ],
          sessionId: crypto.randomUUID(),
        }),
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.95",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.prepareTrustedUserMessagesForModel).toHaveBeenCalledOnce();
    expect(reserve).not.toHaveBeenCalled();
    expect(mocks.getAiAuditRepository).not.toHaveBeenCalled();
    expect(mocks.streamSalesChat).not.toHaveBeenCalled();
  });

  it("does not refund a committed reservation when later audit setup fails", async () => {
    runtime.__aiChatAdmissionBudget = createInMemoryAiChatAdmissionBudget({
      clientUnitsPerDay: 5,
      globalUnitsPerDay: 10,
    });
    mocks.getAiAuditRepository.mockRejectedValue(
      new Error("audit database unavailable"),
    );
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      const first = await POST(
        requestFor(
          "Compare CHN and BRA non-road regulations at 100 kW.",
          "203.0.113.94",
        ),
      );
      expect(first.status).toBe(500);

      const second = await POST(
        requestFor(
          "Compare CHN and BRA non-road regulations at 100 kW.",
          "203.0.113.94",
        ),
      );
      expect(second.status).toBe(429);
      expect(mocks.getConfiguredAiModel).toHaveBeenCalledTimes(2);
      expect(mocks.getAiAuditRepository).toHaveBeenCalledTimes(1);
      expect(mocks.streamSalesChat).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
