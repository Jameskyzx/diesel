import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";

const emptyUsage = {
  inputTokens: {
    cacheRead: 0,
    cacheWrite: 0,
    noCache: 1,
    total: 1,
  },
  outputTokens: {
    reasoning: 1,
    text: 1,
    total: 2,
  },
} as const;

const mocks = vi.hoisted(() => ({
  ensureSession: vi.fn(async () => undefined),
  getAiAuditRepository: vi.fn(),
  getCountryDetails: vi.fn(async () => ({
    iso3: "BRA",
    status: "no_data" as const,
  })),
  getConfiguredAiModel: vi.fn(),
  recordToolCall: vi.fn(async () => undefined),
}));

vi.mock("@/server/ai/model", () => ({
  AiConfigurationError: class AiConfigurationError extends Error {},
  getConfiguredAiModel: mocks.getConfiguredAiModel,
}));

vi.mock("@/server/services/country-service", () => ({
  getCountryDetails: mocks.getCountryDetails,
}));

vi.mock("@/server/services/ai-audit-service", () => ({
  getAiAuditRepository: mocks.getAiAuditRepository,
}));

import { POST } from "@/app/api/chat/route";

function insufficientEvidenceReasoningModel() {
  return new MockLanguageModelV4({
    modelId: "mock-route-sse-boundary",
    provider: "mock",
    doStream: [
      {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            {
              input: JSON.stringify({
                countryIso3: "BRA",
                topics: ["regulations"],
              }),
              toolCallId: "route-sse-country-profile",
              toolName: "getCountryProfile",
              type: "tool-call" as const,
            },
            {
              finishReason: {
                raw: undefined,
                unified: "tool-calls" as const,
              },
              type: "finish" as const,
              usage: emptyUsage,
            },
          ],
        }),
      },
      {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            { id: "route-sse-reasoning", type: "reasoning-start" as const },
            {
              delta: "SSE-REASONING-MARKER-99",
              id: "route-sse-reasoning",
              type: "reasoning-delta" as const,
            },
            { id: "route-sse-reasoning", type: "reasoning-end" as const },
            { id: "route-sse-answer", type: "text-start" as const },
            {
              delta: "SSE-FAKE-ANSWER-99：BRA 已生效法规为 MOCK-99。",
              id: "route-sse-answer",
              type: "text-delta" as const,
            },
            { id: "route-sse-answer", type: "text-end" as const },
            {
              finishReason: { raw: undefined, unified: "stop" as const },
              type: "finish" as const,
              usage: emptyUsage,
            },
          ],
        }),
      },
    ],
  });
}

describe("POST /api/chat SSE evidence boundary", () => {
  beforeEach(() => {
    mocks.ensureSession.mockClear();
    mocks.getAiAuditRepository.mockReset();
    mocks.getCountryDetails.mockClear();
    mocks.getConfiguredAiModel.mockReset();
    mocks.recordToolCall.mockClear();
    mocks.getAiAuditRepository.mockResolvedValue({
      ensureSession: mocks.ensureSession,
      recordToolCall: mocks.recordToolCall,
    });
    mocks.getConfiguredAiModel.mockReturnValue({
      model: insufficientEvidenceReasoningModel(),
      modelId: "mock/route-sse-boundary",
    });
  });

  it("streams the evidence gap but no reasoning or unsupported final answer", async () => {
    const response = await POST(
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          locale: "zh-CN",
          messages: [
            {
              id: "route-sse-message",
              parts: [
                {
                  text: "BRA 当前有哪些柴油机排放法规？",
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
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const sse = await response.text();

    expect(sse).toContain("没有足够证据");
    expect(sse).not.toContain("SSE-REASONING-MARKER-99");
    expect(sse).not.toContain("SSE-FAKE-ANSWER-99");
    expect(mocks.ensureSession).toHaveBeenCalledTimes(1);
    expect(mocks.getCountryDetails).toHaveBeenCalledTimes(1);
    expect(mocks.recordToolCall).toHaveBeenCalledTimes(1);
  });
});
