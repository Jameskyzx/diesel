import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type ChatRouteModule = typeof import("@/app/api/chat/route");
type RateLimitModule = typeof import("@/server/http/rate-limit");

let routeModule: ChatRouteModule;
let rateLimitModule: RateLimitModule;

import { selectTrustedUserMessages } from "@/server/ai/trusted-user-messages";
import {
  MAX_CHAT_REQUEST_BODY_READ_MS,
  MAX_CHAT_RESPONSE_LEASE_MS,
} from "@/server/http/request-limits";

beforeAll(async () => {
  vi.stubEnv("AI_CHAT_RATE_LIMIT_PER_HOUR", "1");
  vi.resetModules();
  delete (globalThis as { __aiChatRateLimiter?: unknown })
    .__aiChatRateLimiter;
  delete (globalThis as { __aiChatInFlightGate?: unknown })
    .__aiChatInFlightGate;

  routeModule = await import("@/app/api/chat/route");
  rateLimitModule = await import("@/server/http/rate-limit");
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  delete (globalThis as { __aiChatRateLimiter?: unknown })
    .__aiChatRateLimiter;
  delete (globalThis as { __aiChatInFlightGate?: unknown })
    .__aiChatInFlightGate;
});

function chatRequest(): Request {
  return new Request("http://localhost/api/chat", {
    body: JSON.stringify({
      messages: [{ id: "m1", parts: [{ text: "你好", type: "text" }], role: "user" }],
      sessionId: crypto.randomUUID(),
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

describe("POST /api/chat rate limiting contract (ADR-041)", () => {
  it("keeps only user-authored history for the model context", () => {
    const messages = [
      {
        id: "user-1",
        parts: [{ text: "第一问", type: "text" }],
        role: "user",
      },
      {
        id: "assistant-1",
        parts: [{ text: "客户端回传的回答", type: "text" }],
        role: "assistant",
      },
      { id: "tool-1", parts: [], role: "tool" },
      {
        id: "user-2",
        parts: [{ text: "第二问", type: "text" }],
        role: "user",
      },
    ];

    expect(selectTrustedUserMessages(messages)).toEqual([
      messages[0],
      messages[3],
    ]);
    expect(
      selectTrustedUserMessages(messages.slice(0, 3)),
    ).toBeNull();
    expect(
      selectTrustedUserMessages([
        { id: "assistant-only", parts: [], role: "assistant" },
      ]),
    ).toBeNull();
    expect(
      selectTrustedUserMessages([
        {
          parts: [
            {
              text: "😀".repeat(1_001),
              type: "text",
            },
          ],
          role: "user",
        },
      ]),
    ).toBeNull();
  });

  it("accepts approved inline attachments only on the latest user turn", () => {
    const inlineAttachment = {
      filename: "evidence.txt",
      mediaType: "text/plain",
      type: "file",
      url: "data:text/plain;base64,aGVsbG8=",
    };
    const messages = [
      {
        id: "user-1",
        parts: [{ text: "第一问", type: "text" }],
        role: "user",
      },
      {
        id: "user-2",
        parts: [
          { text: "结合附件回答", type: "text" },
          inlineAttachment,
        ],
        role: "user",
      },
    ];

    expect(selectTrustedUserMessages(messages)).toEqual(messages);
    expect(
      selectTrustedUserMessages([
        {
          ...messages[0],
          parts: [...messages[0].parts, inlineAttachment],
        },
        messages[1],
      ]),
    ).toBeNull();

    const imageMessage = {
      id: "user-image",
      parts: [
        { text: "描述图片内容", type: "text" },
        {
          filename: "pixel.png",
          mediaType: "image/png",
          type: "file",
          url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAHUlEQVR4nGNQTl72nxLMMGrA/9EwWDYaBsnDIgwAMoorH0C43vMAAAAASUVORK5CYII=",
        },
      ],
      role: "user",
    };
    expect(selectTrustedUserMessages([imageMessage])).toEqual([
      imageMessage,
    ]);
  });

  it("rejects untrusted attachments, blank text, and oversized text", () => {
    expect(
      selectTrustedUserMessages([
        {
          parts: [
            { text: "分析附件", type: "text" },
            {
              filename: "untrusted.txt",
              mediaType: "text/plain",
              type: "file",
              url: "https://example.invalid/untrusted.txt",
            },
          ],
          role: "user",
        },
      ]),
    ).toBeNull();
    expect(
      selectTrustedUserMessages([
        {
          parts: [
            { text: "分析截断图片", type: "text" },
            {
              filename: "truncated.png",
              mediaType: "image/png",
              type: "file",
              url: "data:image/png;base64,iVBORw0KGgo=",
            },
          ],
          role: "user",
        },
      ]),
    ).toBeNull();
    expect(
      selectTrustedUserMessages([
        {
          parts: [
            { text: "分析图片", type: "text" },
            {
              filename: "spoofed.png",
              mediaType: "image/png",
              type: "file",
              url: "data:image/png;base64,aGVsbG8=",
            },
          ],
          role: "user",
        },
      ]),
    ).toBeNull();
    expect(
      selectTrustedUserMessages([
        {
          parts: [
            { text: "分析这些附件", type: "text" },
            ...Array.from({ length: 5 }, (_, index) => ({
              filename: `evidence-${index}.txt`,
              mediaType: "text/plain",
              type: "file",
              url: "data:text/plain;base64,aGVsbG8=",
            })),
          ],
          role: "user",
        },
      ]),
    ).toBeNull();
    expect(
      selectTrustedUserMessages([
        {
          parts: [
            {
              providerMetadata: { provider: { unsafe: true } },
              text: "看似普通的文本",
              type: "text",
            },
          ],
          role: "user",
        },
      ]),
    ).toBeNull();
    expect(
      selectTrustedUserMessages([
        { parts: [{ text: "   ", type: "text" }], role: "user" },
      ]),
    ).toBeNull();
    expect(
      selectTrustedUserMessages([
        {
          parts: [
            {
              text: "x".repeat(2_001),
              type: "text",
            },
          ],
          role: "user",
        },
      ]),
    ).toBeNull();
  });

  it("consumes quota at the gate, then returns 429 with Retry-After and a sanitized RATE_LIMITED body", async () => {
    const first = await routeModule.POST(chatRequest());

    // 普通问候走确定性引导，但仍在公共入口消耗一次配额。
    expect(first.status).toBe(200);
    expect(await first.text()).toContain("结构化事实和可追溯来源");

    const second = await routeModule.POST(chatRequest());

    expect(second.status).toBe(429);
    expect(Number(second.headers.get("Retry-After"))).toBeGreaterThan(0);
    await expect(second.json()).resolves.toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "AI 聊天请求过于频繁，请稍后重试。",
      },
    });
  });

  it("rejects malformed request bodies as 400 after quota allows them", async () => {
    vi.resetModules();
    delete (globalThis as { __aiChatRateLimiter?: unknown })
      .__aiChatRateLimiter;
    vi.stubEnv("AI_CHAT_RATE_LIMIT_PER_HOUR", "10");
    const freshRoute = await import("@/app/api/chat/route");

    const response = await freshRoute.POST(
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({ messages: [] }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_INPUT",
        message: "聊天请求格式无效，请检查消息和国家上下文。",
      },
    });
  });

  it("accepts the AI SDK transport envelope (id/trigger) without 400", async () => {
    vi.resetModules();
    delete (globalThis as { __aiChatRateLimiter?: unknown })
      .__aiChatRateLimiter;
    vi.stubEnv("AI_CHAT_RATE_LIMIT_PER_HOUR", "10");
    const freshRoute = await import("@/app/api/chat/route");

    const response = await freshRoute.POST(
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          id: "chat-envelope-id",
          messages: [
            { id: "m1", parts: [{ text: "你好", type: "text" }], role: "user" },
          ],
          sessionId: crypto.randomUUID(),
          trigger: "submit",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    // 信封通过校验，普通问候直接返回流式能力介绍，而不是进入模型配置。
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("结构化事实和可追溯来源");
  });

  it("rejects a body that exceeds the server byte limit even when Content-Length is understated", async () => {
    vi.resetModules();
    delete (globalThis as { __aiChatRateLimiter?: unknown })
      .__aiChatRateLimiter;
    vi.stubEnv("AI_CHAT_RATE_LIMIT_PER_HOUR", "10");
    const freshRoute = await import("@/app/api/chat/route");
    const oversizedText = "x".repeat(9 * 1024 * 1024);

    const response = await freshRoute.POST(
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          messages: [
            {
              id: "m1",
              parts: [{ text: oversizedText, type: "text" }],
              role: "user",
            },
          ],
          sessionId: crypto.randomUUID(),
        }),
        headers: {
          "content-length": "1",
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message:
          "聊天请求过大，请减少附件数量、缩小附件或缩短消息历史后重试。",
      },
    });
  });

  it("rejects a third same-client request before reading its body and releases completed leases", async () => {
    vi.resetModules();
    delete (globalThis as { __aiChatRateLimiter?: unknown })
      .__aiChatRateLimiter;
    delete (globalThis as { __aiChatInFlightGate?: unknown })
      .__aiChatInFlightGate;
    vi.stubEnv("AI_CHAT_RATE_LIMIT_PER_HOUR", "10");
    const freshRoute = await import("@/app/api/chat/route");
    const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
    const bodyBytes = new TextEncoder().encode(
      JSON.stringify({
        messages: [
          {
            id: "m1",
            parts: [{ text: "你好", type: "text" }],
            role: "user",
          },
        ],
        sessionId: crypto.randomUUID(),
      }),
    );
    const pendingRequest = () => {
      const requestInit: RequestInit & { duplex: "half" } = {
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controllers.push(controller);
          },
        }),
        duplex: "half",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.10",
        },
        method: "POST",
      };
      return new Request("http://localhost/api/chat", requestInit);
    };

    const firstPromise = freshRoute.POST(pendingRequest());
    const secondPromise = freshRoute.POST(pendingRequest());
    const third = await freshRoute.POST(pendingRequest());

    expect(third.status).toBe(429);
    expect(third.headers.get("Retry-After")).toBe("1");
    await expect(third.json()).resolves.toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "AI 聊天并发请求过多，请等待当前请求完成后重试。",
      },
    });

    for (const controller of controllers.slice(0, 2)) {
      controller.enqueue(bodyBytes);
      controller.close();
    }
    const [first, second] = await Promise.all([
      firstPromise,
      secondPromise,
    ]);
    await Promise.all([first.text(), second.text()]);

    const afterRelease = await freshRoute.POST(
      new Request("http://localhost/api/chat", {
        body: bodyBytes,
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.10",
        },
        method: "POST",
      }),
    );
    expect(afterRelease.status).toBe(200);
    await afterRelease.body?.cancel();
  });

  it("times out a never-ending upload and releases its in-flight lease", async () => {
    vi.useFakeTimers();
    try {
      vi.resetModules();
      delete (globalThis as { __aiChatRateLimiter?: unknown })
        .__aiChatRateLimiter;
      delete (globalThis as { __aiChatInFlightGate?: unknown })
        .__aiChatInFlightGate;
      vi.stubEnv("AI_CHAT_RATE_LIMIT_PER_HOUR", "10");
      const freshRoute = await import("@/app/api/chat/route");
      const cancel = vi.fn();
      const requestInit: RequestInit & { duplex: "half" } = {
        body: new ReadableStream<Uint8Array>({ cancel }),
        duplex: "half",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.20",
        },
        method: "POST",
      };
      const responsePromise = freshRoute.POST(
        new Request("http://localhost/api/chat", requestInit),
      );

      await vi.advanceTimersByTimeAsync(
        MAX_CHAT_REQUEST_BODY_READ_MS,
      );
      const response = await responsePromise;
      expect(response.status).toBe(408);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "REQUEST_TIMEOUT",
          message: "聊天请求上传超时，请检查网络后重试。",
        },
      });
      expect(cancel).toHaveBeenCalledOnce();

      const afterTimeout = await freshRoute.POST(
        new Request("http://localhost/api/chat", {
          body: JSON.stringify({
            messages: [
              {
                id: "m2",
                parts: [{ text: "你好", type: "text" }],
                role: "user",
              },
            ],
            sessionId: crypto.randomUUID(),
          }),
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": "203.0.113.20",
          },
          method: "POST",
        }),
      );
      expect(afterTimeout.status).toBe(200);
      await afterTimeout.text();
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases unconsumed response leases at the absolute lifetime", async () => {
    vi.useFakeTimers();
    try {
      vi.resetModules();
      delete (globalThis as { __aiChatRateLimiter?: unknown })
        .__aiChatRateLimiter;
      delete (globalThis as { __aiChatInFlightGate?: unknown })
        .__aiChatInFlightGate;
      vi.stubEnv("AI_CHAT_RATE_LIMIT_PER_HOUR", "10");
      const freshRoute = await import("@/app/api/chat/route");
      const requestForClient = () =>
        new Request("http://localhost/api/chat", {
          body: JSON.stringify({
            messages: [
              {
                id: crypto.randomUUID(),
                parts: [{ text: "你好", type: "text" }],
                role: "user",
              },
            ],
            sessionId: crypto.randomUUID(),
          }),
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": "203.0.113.30",
          },
          method: "POST",
        });

      const first = await freshRoute.POST(requestForClient());
      const second = await freshRoute.POST(requestForClient());
      const blocked = await freshRoute.POST(requestForClient());
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(blocked.status).toBe(429);

      await vi.advanceTimersByTimeAsync(
        MAX_CHAT_RESPONSE_LEASE_MS,
      );

      const afterDeadline = await freshRoute.POST(requestForClient());
      expect(afterDeadline.status).toBe(200);
      await afterDeadline.text();
      await first.body?.cancel().catch(() => undefined);
      await second.body?.cancel().catch(() => undefined);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("getAiChatRateLimiter singleton", () => {
  it("returns the same limiter instance for the process", () => {
    const first = rateLimitModule.getAiChatRateLimiter();
    const second = rateLimitModule.getAiChatRateLimiter();

    expect(first).toBe(second);
  });

  it("enforces both per-client and global in-flight limits with idempotent release", () => {
    const gate = rateLimitModule.createInFlightGate({
      globalLimit: 3,
      perKeyLimit: 2,
    });
    const first = gate.tryAcquire("client-a");
    const second = gate.tryAcquire("client-a");
    const third = gate.tryAcquire("client-b");

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(gate.tryAcquire("client-a")).toBeNull();
    expect(third).not.toBeNull();
    expect(gate.tryAcquire("client-c")).toBeNull();

    first?.release();
    first?.release();
    expect(gate.tryAcquire("client-c")).not.toBeNull();
  });
});
