import { beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_CHAT_RESPONSE_LEASE_MS } from "@/server/http/request-limits";

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
      costProfile: { profileMarker: "server-only-cost-profile" },
      model: {},
      modelId: "mock/stream-boundary",
    });
    mocks.toUIMessageStreamResponse.mockImplementation(
      ({ sendReasoning }: { sendReasoning?: boolean }) => {
        const visibleParts = ["没有足够证据"];
        if (sendReasoning) {
          visibleParts.unshift("REASONING-API-MOCK-FAKE-99");
        }
        return new Response(visibleParts.join("\n"), {
          headers: { "content-type": "text/event-stream" },
        });
      },
    );
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
    expect(response.headers.get("Cache-Control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("Pragma")).toBe("no-cache");
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("X-Request-Id")).toBeTruthy();
    const body = await response.text();
    expect(body).toContain("没有足够证据");
    expect(body).not.toContain("REASONING-API-MOCK-FAKE-99");
    expect(mocks.toUIMessageStreamResponse).toHaveBeenCalledWith(
      expect.objectContaining({ sendReasoning: false }),
    );
    expect(mocks.streamSalesChat).toHaveBeenCalledWith(
      expect.objectContaining({
        costProfile: { profileMarker: "server-only-cost-profile" },
        maxRetries: 0,
      }),
    );
  });

  it("aborts the provider stream when the client cancels the response", async () => {
    const underlyingCancel = vi.fn();
    mocks.toUIMessageStreamResponse.mockReturnValue(
      new Response(
        new ReadableStream<Uint8Array>({ cancel: underlyingCancel }),
        { headers: { "content-type": "text/event-stream" } },
      ),
    );
    const response = await POST(
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          messages: [
            {
              id: "cancel-stream-message",
              parts: [
                {
                  text: "核对 CHN non-road 100 kW 当前法规。",
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
    const signal = mocks.streamSalesChat.mock.calls.at(-1)?.[0]
      .abortSignal as AbortSignal;

    expect(signal.aborted).toBe(false);
    await response.body?.cancel("client-disconnected");

    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe("client-disconnected");
    expect(underlyingCancel).toHaveBeenCalledWith("client-disconnected");
  });

  it("retains admission after reader cancellation while a started tool remains pending", async () => {
    const underlyingCancel = vi.fn(async () => undefined);
    mocks.toUIMessageStreamResponse.mockImplementation(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({ cancel: underlyingCancel }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    );
    const requestForClient = () =>
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          messages: [
            {
              id: crypto.randomUUID(),
              parts: [
                {
                  text: "核对 CHN non-road 100 kW 当前法规。",
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
          "x-forwarded-for": "203.0.113.88",
        },
        method: "POST",
      });

    const first = await POST(requestForClient());
    const second = await POST(requestForClient());
    const toolCreationInputs = mocks.createSalesChatTools.mock
      .calls as unknown as Array<
      [{ beginDeferredWork?: () => (() => void) | null }]
    >;
    const firstBegin = toolCreationInputs[0]?.[0].beginDeferredWork;
    const secondBegin = toolCreationInputs[1]?.[0].beginDeferredWork;
    const finishFirstTool = firstBegin?.();
    const finishSecondTool = secondBegin?.();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(finishFirstTool).toEqual(expect.any(Function));
    expect(finishSecondTool).toEqual(expect.any(Function));

    await first.body?.cancel("client-disconnected");
    await second.body?.cancel("client-disconnected");
    expect(underlyingCancel).toHaveBeenCalledTimes(2);
    expect(firstBegin?.()).toBeNull();
    expect(secondBegin?.()).toBeNull();

    const blocked = await POST(requestForClient());
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("1");

    finishFirstTool?.();
    finishSecondTool?.();
    for (let microtask = 0; microtask < 4; microtask += 1) {
      await Promise.resolve();
    }

    mocks.toUIMessageStreamResponse.mockReturnValueOnce(
      new Response("complete", {
        headers: { "content-type": "text/event-stream" },
      }),
    );
    const afterToolsSettle = await POST(requestForClient());
    expect(afterToolsSettle.status).toBe(200);
    await expect(afterToolsSettle.text()).resolves.toBe("complete");
  });

  it("seals normal responses but retains admission until started tools settle", async () => {
    mocks.toUIMessageStreamResponse.mockImplementation(
      () =>
        new Response("complete", {
          headers: { "content-type": "text/event-stream" },
        }),
    );
    const requestForClient = () =>
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          messages: [
            {
              id: crypto.randomUUID(),
              parts: [
                {
                  text: "核对 CHN non-road 100 kW 当前法规。",
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
          "x-forwarded-for": "203.0.113.89",
        },
        method: "POST",
      });

    const first = await POST(requestForClient());
    const second = await POST(requestForClient());
    const toolCreationInputs = mocks.createSalesChatTools.mock
      .calls as unknown as Array<
      [{ beginDeferredWork?: () => (() => void) | null }]
    >;
    const firstBegin = toolCreationInputs[0]?.[0].beginDeferredWork;
    const secondBegin = toolCreationInputs[1]?.[0].beginDeferredWork;
    const finishFirstTool = firstBegin?.();
    const finishSecondTool = secondBegin?.();

    await Promise.all([first.text(), second.text()]);
    expect(firstBegin?.()).toBeNull();
    expect(secondBegin?.()).toBeNull();

    const blocked = await POST(requestForClient());
    expect(blocked.status).toBe(429);

    finishFirstTool?.();
    finishSecondTool?.();

    const afterToolsSettle = await POST(requestForClient());
    expect(afterToolsSettle.status).toBe(200);
    await expect(afterToolsSettle.text()).resolves.toBe("complete");
  });

  it("aborts the provider stream when reading the provider response fails", async () => {
    const readFailure = new Error("provider stream read failed");
    mocks.toUIMessageStreamResponse.mockReturnValue(
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.error(readFailure);
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
    );
    const response = await POST(
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          messages: [
            {
              id: "read-error-stream-message",
              parts: [
                {
                  text: "核对 CHN non-road 100 kW 当前法规。",
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
    const signal = mocks.streamSalesChat.mock.calls.at(-1)?.[0]
      .abortSignal as AbortSignal;

    await expect(response.body?.getReader().read()).rejects.toBe(readFailure);
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe(readFailure);
  });

  it("aborts the provider stream at the absolute response lifetime", async () => {
    vi.useFakeTimers();
    try {
      const underlyingCancel = vi.fn();
      mocks.toUIMessageStreamResponse.mockReturnValue(
        new Response(
          new ReadableStream<Uint8Array>({ cancel: underlyingCancel }),
          { headers: { "content-type": "text/event-stream" } },
        ),
      );
      await POST(
        new Request("http://localhost/api/chat", {
          body: JSON.stringify({
            messages: [
              {
                id: "timeout-stream-message",
                parts: [
                  {
                    text: "核对 CHN non-road 100 kW 当前法规。",
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
      const signal = mocks.streamSalesChat.mock.calls.at(-1)?.[0]
        .abortSignal as AbortSignal;

      expect(signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(MAX_CHAT_RESPONSE_LEASE_MS);

      expect(signal.aborted).toBe(true);
      expect(signal.reason).toBe("chat-response-timeout");
      expect(underlyingCancel).toHaveBeenCalledWith("chat-response-timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  it("retains admission after the response lifetime until provider cancellation settles", async () => {
    vi.useFakeTimers();
    try {
      const finishCancels: Array<() => void> = [];
      const underlyingCancel = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishCancels.push(resolve);
          }),
      );
      mocks.toUIMessageStreamResponse.mockImplementation(
        () =>
          new Response(
            new ReadableStream<Uint8Array>({ cancel: underlyingCancel }),
            { headers: { "content-type": "text/event-stream" } },
          ),
      );
      const requestForClient = () =>
        new Request("http://localhost/api/chat", {
          body: JSON.stringify({
            messages: [
              {
                id: crypto.randomUUID(),
                parts: [
                  {
                    text: "核对 CHN non-road 100 kW 当前法规。",
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
            "x-forwarded-for": "203.0.113.77",
          },
          method: "POST",
        });

      const first = await POST(requestForClient());
      const second = await POST(requestForClient());
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);

      await vi.advanceTimersByTimeAsync(MAX_CHAT_RESPONSE_LEASE_MS);
      expect(underlyingCancel).toHaveBeenCalledTimes(2);

      const blocked = await POST(requestForClient());
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("Retry-After")).toBe("1");

      for (const finishCancel of finishCancels) {
        finishCancel();
      }
      for (let microtask = 0; microtask < 8; microtask += 1) {
        await Promise.resolve();
      }

      mocks.toUIMessageStreamResponse.mockReturnValueOnce(
        new Response("complete", {
          headers: { "content-type": "text/event-stream" },
        }),
      );
      const afterCleanup = await POST(requestForClient());
      expect(afterCleanup.status).toBe(200);
      await expect(afterCleanup.text()).resolves.toBe("complete");
    } finally {
      vi.useRealTimers();
    }
  });
});
