import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSalesChatTools: vi.fn(() => ({})),
  ensureSession: vi.fn(async () => undefined),
  getAiAuditRepository: vi.fn(),
  getConfiguredAiModel: vi.fn(),
  streamSalesChat: vi.fn(),
  toUIMessageStreamResponse: vi.fn(),
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

import { POST } from "@/app/api/chat/route";

describe("POST /api/chat stream boundary", () => {
  beforeEach(() => {
    mocks.createSalesChatTools.mockClear();
    mocks.ensureSession.mockClear();
    mocks.getAiAuditRepository.mockReset();
    mocks.getConfiguredAiModel.mockReset();
    mocks.streamSalesChat.mockReset();
    mocks.toUIMessageStreamResponse.mockReset();
    mocks.getAiAuditRepository.mockResolvedValue({
      ensureSession: mocks.ensureSession,
      recordToolCall: vi.fn(async () => undefined),
    });
    mocks.getConfiguredAiModel.mockReturnValue({
      model: {},
      modelId: "mock/stream-boundary",
    });
    mocks.toUIMessageStreamResponse.mockReturnValue(new Response("ok"));
    mocks.streamSalesChat.mockReturnValue({
      toUIMessageStreamResponse: mocks.toUIMessageStreamResponse,
    });
  });

  it("explicitly prevents reasoning parts from reaching the browser", async () => {
    const response = await POST(
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          messages: [
            {
              id: "stream-boundary-message",
              parts: [
                {
                  text:
                    "核对 CHN non-road 100 kW 在 2026-08-13 的法规与限值。",
                  type: "text",
                },
              ],
              role: "user",
            },
          ],
          sessionId: crypto.randomUUID(),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("ok");
    expect(mocks.toUIMessageStreamResponse).toHaveBeenCalledWith(
      expect.objectContaining({ sendReasoning: false }),
    );
  });
});
