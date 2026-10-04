import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type ChatRouteModule = typeof import("@/app/api/chat/route");
type RateLimitModule = typeof import("@/server/http/rate-limit");

let routeModule: ChatRouteModule;
let rateLimitModule: RateLimitModule;

import { selectTrustedUserMessages } from "@/server/ai/trusted-user-messages";
import {
  MAX_CHAT_HISTORY_TEXT_CHARACTERS,
  MAX_CHAT_HISTORY_USER_MESSAGES,
} from "@/features/ai/constants";
import {
  MAX_CHAT_RATE_LIMIT_CHECK_MS,
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
  it("fails closed with a sanitized 503 when the shared limiter is unavailable", async () => {
    const sensitiveText = "postgres://rate-limit:secret@example.test/database";
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    (globalThis as { __aiChatRateLimiter?: unknown }).__aiChatRateLimiter = {
      check: vi.fn().mockRejectedValue(new Error(sensitiveText)),
      reset: vi.fn(),
    };

    try {
      const response = await routeModule.POST(chatRequest());
      const body = JSON.stringify(await response.json());

      expect(response.status).toBe(503);
      expect(response.headers.get("Retry-After")).toBe("60");
      expect(response.headers.get("Cache-Control")).toBe(
        "private, no-store, max-age=0",
      );
      expect(response.headers.get("Pragma")).toBe("no-cache");
      expect(response.headers.get("X-Request-Id")).toBeTruthy();
      expect(body).not.toContain(sensitiveText);
      expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain(
        sensitiveText,
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        "AI chat rate limiter unavailable",
        { errorCode: "Error" },
      );
    } finally {
      delete (globalThis as { __aiChatRateLimiter?: unknown })
        .__aiChatRateLimiter;
      consoleSpy.mockRestore();
    }
  });

  it("bounds pending shared-limiter checks with the in-flight gate", async () => {
    vi.resetModules();
    delete (globalThis as { __aiChatInFlightGate?: unknown })
      .__aiChatInFlightGate;
    const resolveChecks: Array<
      (decision: {
        allowed: boolean;
        limit: number;
        remaining: number;
        retryAfterSeconds: number;
      }) => void
    > = [];
    const check = vi.fn(
      () =>
        new Promise<{
          allowed: boolean;
          limit: number;
          remaining: number;
          retryAfterSeconds: number;
        }>((resolve) => resolveChecks.push(resolve)),
    );
    (globalThis as { __aiChatRateLimiter?: unknown }).__aiChatRateLimiter = {
      check,
      reset: vi.fn(),
    };
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
          "x-forwarded-for": "203.0.113.40",
        },
        method: "POST",
      });

    try {
      const firstPromise = freshRoute.POST(requestForClient());
      const secondPromise = freshRoute.POST(requestForClient());
      expect(check).toHaveBeenCalledTimes(2);

      const third = await freshRoute.POST(requestForClient());
      expect(third.status).toBe(429);
      expect(third.headers.get("Retry-After")).toBe("1");
      expect(check).toHaveBeenCalledTimes(2);

      for (const resolve of resolveChecks) {
        resolve({
          allowed: false,
          limit: 10,
          remaining: 0,
          retryAfterSeconds: 60,
        });
      }
      const [first, second] = await Promise.all([
        firstPromise,
        secondPromise,
      ]);
      expect(first.status).toBe(429);
      expect(second.status).toBe(429);
    } finally {
      delete (globalThis as { __aiChatRateLimiter?: unknown })
        .__aiChatRateLimiter;
      delete (globalThis as { __aiChatInFlightGate?: unknown })
        .__aiChatInFlightGate;
    }
  });

  it.each([
    { allowed: true, expectedStatus: 200 },
    { allowed: false, expectedStatus: 429 },
  ])("honors a slow shared-limiter decision after three seconds: allowed=$allowed", async ({ allowed, expectedStatus }) => {
    vi.useFakeTimers();
    const check = vi.fn(
      () => new Promise<{
        allowed: boolean;
        limit: number;
        remaining: number;
        retryAfterSeconds: number;
      }>((resolve) => {
        setTimeout(() => resolve({
          allowed,
          limit: 10,
          remaining: allowed ? 9 : 0,
          retryAfterSeconds: allowed ? 0 : 60,
        }), 3_500);
      }),
    );
    (globalThis as { __aiChatRateLimiter?: unknown }).__aiChatRateLimiter = {
      check,
      reset: vi.fn(),
    };
    let response: Response | undefined;
    try {
      const pending = routeModule.POST(chatRequest()).then((result) => {
        response = result;
        return result;
      });
      await vi.advanceTimersByTimeAsync(3_000);
      expect(response).toBeUndefined();
      await vi.advanceTimersByTimeAsync(500);
      const completed = await pending;
      expect(completed.status).toBe(expectedStatus);
      expect(check).toHaveBeenCalledOnce();
      if (allowed) {
        expect(completed.headers.get("content-type")).toContain("text/event-stream");
        expect(await completed.text()).toContain("[DONE]");
      } else {
        expect(completed.headers.get("Retry-After")).toBe("60");
      }
    } finally {
      vi.useRealTimers();
      delete (globalThis as { __aiChatRateLimiter?: unknown })
        .__aiChatRateLimiter;
    }
  });

  it("returns at eight seconds but retains admission until the database work settles", async () => {
    vi.useFakeTimers();
    try {
      vi.resetModules();
      delete (globalThis as { __aiChatInFlightGate?: unknown })
        .__aiChatInFlightGate;
      const resolveChecks: Array<
        (decision: {
          allowed: boolean;
          limit: number;
          remaining: number;
          retryAfterSeconds: number;
        }) => void
      > = [];
      const check = vi.fn(
        () =>
          new Promise<{
            allowed: boolean;
            limit: number;
            remaining: number;
            retryAfterSeconds: number;
          }>((resolve) => resolveChecks.push(resolve)),
      );
      (globalThis as { __aiChatRateLimiter?: unknown }).__aiChatRateLimiter = {
        check,
        reset: vi.fn(),
      };
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
            "x-forwarded-for": "203.0.113.41",
          },
          method: "POST",
        });
      const denied = {
        allowed: false,
        limit: 10,
        remaining: 0,
        retryAfterSeconds: 60,
      };

      const firstPromise = freshRoute.POST(requestForClient());
      expect(check).toHaveBeenCalledOnce();
      let responseCompleted = false;
      void firstPromise.then(() => { responseCompleted = true; });
      expect(MAX_CHAT_RATE_LIMIT_CHECK_MS).toBe(8_000);
      await vi.advanceTimersByTimeAsync(7_999);
      expect(responseCompleted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const first = await firstPromise;
      expect(first.status).toBe(503);
      expect(first.headers.get("Retry-After")).toBe("60");

      const secondPromise = freshRoute.POST(requestForClient());
      expect(check).toHaveBeenCalledTimes(2);
      const blocked = await freshRoute.POST(requestForClient());
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("Retry-After")).toBe("1");
      expect(check).toHaveBeenCalledTimes(2);

      resolveChecks[0]?.(denied);
      resolveChecks[1]?.(denied);
      const second = await secondPromise;
      expect(second.status).toBe(429);
      await Promise.resolve();

      check.mockResolvedValueOnce(denied);
      const afterSettlement = await freshRoute.POST(requestForClient());
      expect(afterSettlement.status).toBe(429);
      expect(afterSettlement.headers.get("Retry-After")).toBe("60");
      expect(check).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
      delete (globalThis as { __aiChatRateLimiter?: unknown })
        .__aiChatRateLimiter;
      delete (globalThis as { __aiChatInFlightGate?: unknown })
        .__aiChatInFlightGate;
    }
  });

  it("returns promptly on client abort while retaining a pending limiter lease", async () => {
    vi.resetModules();
    delete (globalThis as { __aiChatInFlightGate?: unknown })
      .__aiChatInFlightGate;
    const resolveChecks: Array<
      (decision: {
          allowed: boolean;
          limit: number;
          remaining: number;
          retryAfterSeconds: number;
        }) => void
    > = [];
    const check = vi.fn(
      () =>
        new Promise<{
          allowed: boolean;
          limit: number;
          remaining: number;
          retryAfterSeconds: number;
        }>((resolve) => resolveChecks.push(resolve)),
    );
    (globalThis as { __aiChatRateLimiter?: unknown }).__aiChatRateLimiter = {
      check,
      reset: vi.fn(),
    };
    const freshRoute = await import("@/app/api/chat/route");
    const abortController = new AbortController();
    const body = JSON.stringify({
      messages: [
        {
          id: crypto.randomUUID(),
          parts: [{ text: "你好", type: "text" }],
          role: "user",
        },
      ],
      sessionId: crypto.randomUUID(),
    });
    const request = new Request("http://localhost/api/chat", {
      body,
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.42",
      },
      method: "POST",
      signal: abortController.signal,
    });

    try {
      const responsePromise = freshRoute.POST(request);
      expect(check).toHaveBeenCalledOnce();
      abortController.abort("client-disconnected");
      const response = await responsePromise;
      expect(response.status).toBe(408);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "REQUEST_TIMEOUT",
          message:
            "The chat request was canceled before processing completed.",
        },
      });

      const secondPromise = freshRoute.POST(
        new Request(request.url, {
          body,
          headers: request.headers,
          method: "POST",
        }),
      );
      expect(check).toHaveBeenCalledTimes(2);
      const blocked = await freshRoute.POST(
        new Request(request.url, {
          body,
          headers: request.headers,
          method: "POST",
        }),
      );
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("Retry-After")).toBe("1");
      expect(check).toHaveBeenCalledTimes(2);

      for (const resolve of resolveChecks) {
        resolve({
          allowed: false,
          limit: 10,
          remaining: 0,
          retryAfterSeconds: 60,
        });
      }
      const second = await secondPromise;
      expect(second.status).toBe(429);
    } finally {
      delete (globalThis as { __aiChatRateLimiter?: unknown })
        .__aiChatRateLimiter;
      delete (globalThis as { __aiChatInFlightGate?: unknown })
        .__aiChatInFlightGate;
    }
  });

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

  it("keeps only the newest user history within prompt budgets", () => {
    const messages = Array.from(
      { length: MAX_CHAT_HISTORY_USER_MESSAGES + 3 },
      (_, index) => ({
        id: `user-${index}`,
        parts: [{ text: `问题 ${index}`, type: "text" }],
        role: "user",
      }),
    );
    const selectedByCount = selectTrustedUserMessages(messages);
    expect(selectedByCount).toHaveLength(MAX_CHAT_HISTORY_USER_MESSAGES);
    expect(selectedByCount?.[0]).toBe(messages[3]);

    const textBudgetMessages = Array.from({ length: 8 }, (_, index) => ({
      id: `large-${index}`,
      parts: [{ text: String(index).repeat(2_000), type: "text" }],
      role: "user",
    }));
    const selectedByText = selectTrustedUserMessages(textBudgetMessages);
    expect(selectedByText).toHaveLength(
      MAX_CHAT_HISTORY_TEXT_CHARACTERS / 2_000,
    );
    expect(selectedByText?.at(-1)).toBe(textBudgetMessages.at(-1));
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
    expect(await first.text()).toContain("structured facts and traceable sources");

    const second = await routeModule.POST(chatRequest());

    expect(second.status).toBe(429);
    expect(Number(second.headers.get("Retry-After"))).toBeGreaterThan(0);
    await expect(second.json()).resolves.toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "AI chat requests are arriving too quickly. Please try again later.",
      },
    });
  });

  it("applies the global hourly ceiling across distinct deterministic direct-response clients", async () => {
    vi.resetModules();
    delete (globalThis as { __aiChatRateLimiter?: unknown })
      .__aiChatRateLimiter;
    delete (globalThis as { __aiChatInFlightGate?: unknown })
      .__aiChatInFlightGate;
    vi.stubEnv("AI_CHAT_RATE_LIMIT_PER_HOUR", "2");
    vi.stubEnv("AI_CHAT_RATE_LIMIT_GLOBAL_PER_HOUR", "2");
    const freshRoute = await import("@/app/api/chat/route");
    const directRequest = (clientIdentifier: string) =>
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          messages: [
            {
              id: crypto.randomUUID(),
              parts: [{ text: "What can you do?", type: "text" }],
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

    try {
      const first = await freshRoute.POST(directRequest("203.0.113.51"));
      expect(first.status).toBe(200);
      await first.text();
      const second = await freshRoute.POST(directRequest("203.0.113.52"));
      expect(second.status).toBe(200);
      await second.text();

      const rejected = await freshRoute.POST(
        directRequest("203.0.113.53"),
      );
      expect(rejected.status).toBe(429);
      expect(Number(rejected.headers.get("Retry-After"))).toBeGreaterThan(0);
      await expect(rejected.json()).resolves.toEqual({
        error: {
          code: "RATE_LIMITED",
          message:
            "AI chat requests are arriving too quickly. Please try again later.",
        },
      });
    } finally {
      vi.stubEnv("AI_CHAT_RATE_LIMIT_GLOBAL_PER_HOUR", "10000");
      delete (globalThis as { __aiChatRateLimiter?: unknown })
        .__aiChatRateLimiter;
      delete (globalThis as { __aiChatInFlightGate?: unknown })
        .__aiChatInFlightGate;
    }
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
        message: "The chat request is invalid. Check the messages and country context.",
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
    expect(await response.text()).toContain("structured facts and traceable sources");
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
          "The chat request is too large. Remove attachments, reduce their size, or shorten the message history.",
      },
    });
  });

  it.each(["application/json", "text/plain"] as const)(
    "returns 413 promptly and retains admission while an oversized %s body is canceled",
    async (contentType) => {
    vi.resetModules();
    delete (globalThis as { __aiChatRateLimiter?: unknown })
      .__aiChatRateLimiter;
    delete (globalThis as { __aiChatInFlightGate?: unknown })
      .__aiChatInFlightGate;
    vi.stubEnv("AI_CHAT_RATE_LIMIT_PER_HOUR", "10");
    const freshRoute = await import("@/app/api/chat/route");
    let finishCancel: (() => void) | undefined;
    const cancel = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishCancel = resolve;
        }),
    );
    const requestInit: RequestInit & { duplex: "half" } = {
      body: new ReadableStream<Uint8Array>({
        cancel,
        start(controller) {
          controller.enqueue(new Uint8Array(9 * 1024 * 1024 + 1));
        },
      }),
      duplex: "half",
      headers: {
        "content-length": "1",
        "content-type": contentType,
        "x-forwarded-for": "203.0.113.22",
      },
      method: "POST",
    };

    const oversized = await freshRoute.POST(
      new Request("http://localhost/api/chat", requestInit),
    );
    expect(oversized.status).toBe(413);
    expect(cancel).toHaveBeenCalledWith("request-body-too-large");

    const validRequest = (id: string) =>
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          messages: [
            {
              id,
              parts: [{ text: "你好", type: "text" }],
              role: "user",
            },
          ],
          sessionId: crypto.randomUUID(),
        }),
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.22",
        },
        method: "POST",
      });
    const second = await freshRoute.POST(validRequest("m-second"));
    expect(second.status).toBe(200);
    const blocked = await freshRoute.POST(validRequest("m-blocked"));
    expect(blocked.status).toBe(429);

    finishCancel?.();
    await Promise.resolve();
    await second.text();

    const afterCleanup = await freshRoute.POST(
      validRequest("m-after-cleanup"),
    );
    expect(afterCleanup.status).toBe(200);
    await afterCleanup.text();
    },
  );

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
        message:
          "Too many AI chat requests are in flight. Wait for the current request to finish and retry.",
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
          message: "The chat upload timed out. Check the connection and try again.",
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

  it("returns on upload abort but retains admission until reader cancellation settles", async () => {
    vi.resetModules();
    delete (globalThis as { __aiChatRateLimiter?: unknown })
      .__aiChatRateLimiter;
    delete (globalThis as { __aiChatInFlightGate?: unknown })
      .__aiChatInFlightGate;
    vi.stubEnv("AI_CHAT_RATE_LIMIT_PER_HOUR", "10");
    const freshRoute = await import("@/app/api/chat/route");
    const abortController = new AbortController();
    let finishCancel: (() => void) | undefined;
    const cancel = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishCancel = resolve;
        }),
    );
    const requestInit: RequestInit & { duplex: "half" } = {
      body: new ReadableStream<Uint8Array>({ cancel }),
      duplex: "half",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.21",
      },
      method: "POST",
      signal: abortController.signal,
    };
    const request = new Request("http://localhost/api/chat", requestInit);
    if (!request.body) {
      throw new Error("Expected the test request to expose a body stream.");
    }
    const getReader = vi.spyOn(request.body, "getReader");
    const responsePromise = freshRoute.POST(request);

    await vi.waitFor(() => expect(getReader).toHaveBeenCalledOnce());
    abortController.abort("client-disconnected");

    const response = await responsePromise;
    expect(response.status).toBe(408);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "REQUEST_TIMEOUT",
        message:
          "The chat request was canceled before processing completed.",
      },
    });
    expect(cancel).toHaveBeenCalledWith("request-body-aborted");

    const second = await freshRoute.POST(
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          messages: [
            {
              id: "m-after-abort",
              parts: [{ text: "你好", type: "text" }],
              role: "user",
            },
          ],
          sessionId: crypto.randomUUID(),
        }),
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.21",
        },
        method: "POST",
      }),
    );
    expect(second.status).toBe(200);
    const blockedWhileCancelPending = await freshRoute.POST(
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          messages: [
            {
              id: "m-blocked-during-cancel",
              parts: [{ text: "你好", type: "text" }],
              role: "user",
            },
          ],
          sessionId: crypto.randomUUID(),
        }),
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.21",
        },
        method: "POST",
      }),
    );
    expect(blockedWhileCancelPending.status).toBe(429);
    expect(blockedWhileCancelPending.headers.get("Retry-After")).toBe("1");

    finishCancel?.();
    await Promise.resolve();
    await second.text();

    const afterCleanup = await freshRoute.POST(
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          messages: [
            {
              id: "m-after-cleanup",
              parts: [{ text: "你好", type: "text" }],
              role: "user",
            },
          ],
          sessionId: crypto.randomUUID(),
        }),
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.21",
        },
        method: "POST",
      }),
    );
    expect(afterCleanup.status).toBe(200);
    await afterCleanup.text();
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
