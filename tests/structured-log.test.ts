import { describe, expect, it, vi } from "vitest";

import {
  createApiRequestObserver,
  emitAiCompletionLog,
  serializeStructuredLogEvent,
} from "@/server/observability/structured-log";

describe("structured observability logs", () => {
  it("emits a request correlation header and allowlisted JSON fields", () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const observer = createApiRequestObserver("/api/products");
      const response = observer.finish(Response.json({ status: "ok" }));

      expect(response.headers.get("x-request-id")).toBe(observer.requestId);
      const parsed = JSON.parse(String(consoleInfo.mock.calls[0]?.[0])) as Record<
        string,
        unknown
      >;
      expect(Object.keys(parsed).sort()).toEqual([
        "durationMs",
        "errorCode",
        "event",
        "requestId",
        "route",
        "status",
        "timestamp",
      ]);
    } finally {
      consoleInfo.mockRestore();
    }
  });

  it("rejects prompt, headers, addresses and secret-bearing extra fields", () => {
    expect(() =>
      serializeStructuredLogEvent({
        databaseUrl: "postgres://secret",
        durationMs: 1,
        errorCode: null,
        event: "api.request",
        headers: { authorization: "Bearer secret" },
        ip: "203.0.113.1",
        prompt: "private prompt",
        requestId: crypto.randomUUID(),
        route: "/api/chat",
        status: 200,
        timestamp: new Date().toISOString(),
      }),
    ).toThrow();
  });

  it("keeps AI completion logs to counts, evidence state and token usage", () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      emitAiCompletionLog({
        durationMs: 12,
        errorCode: null,
        evidenceResult: "sufficient",
        inputTokens: 20,
        loopSteps: 2,
        modelId: "provider/model",
        outputTokens: 10,
        requestId: crypto.randomUUID(),
        toolCount: 1,
        totalTokens: 30,
      });

      expect(String(consoleInfo.mock.calls[0]?.[0])).not.toContain("prompt");
      expect(String(consoleInfo.mock.calls[0]?.[0])).not.toContain("secret");
    } finally {
      consoleInfo.mockRestore();
    }
  });
});
