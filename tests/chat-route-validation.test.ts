import { Buffer } from "node:buffer";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureSession: vi.fn(async () => undefined),
  getAiAuditRepository: vi.fn(),
  getConfiguredAiModel: vi.fn(),
}));

vi.mock("@/server/ai/model", () => ({
  AiConfigurationError: class AiConfigurationError extends Error {},
  getConfiguredAiModel: mocks.getConfiguredAiModel,
}));

vi.mock("@/server/services/ai-audit-service", () => ({
  getAiAuditRepository: mocks.getAiAuditRepository,
}));

import { POST } from "@/app/api/chat/route";

describe("POST /api/chat validation ordering", () => {
  beforeEach(() => {
    mocks.ensureSession.mockClear();
    mocks.getAiAuditRepository.mockReset();
    mocks.getConfiguredAiModel.mockReset();
    mocks.getAiAuditRepository.mockResolvedValue({
      ensureSession: mocks.ensureSession,
      recordToolCall: async () => undefined,
    });
    mocks.getConfiguredAiModel.mockReturnValue({
      model: {},
      modelId: "mock/validation-only",
    });
  });

  it("answers capability questions without model or audit setup", async () => {
    const response = await POST(
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          messages: [
            {
              id: "capability-message",
              parts: [
                { text: "你好，你能帮我做什么？", type: "text" },
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
    expect(await response.text()).toContain("结构化事实和可追溯来源");
    expect(mocks.getConfiguredAiModel).not.toHaveBeenCalled();
    expect(mocks.getAiAuditRepository).not.toHaveBeenCalled();
    expect(mocks.ensureSession).not.toHaveBeenCalled();
  });

  it("does not create an audit session for a remote attachment URL", async () => {
    const response = await POST(
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          messages: [
            {
              id: "attachment-message",
              parts: [
                { text: "分析这个附件", type: "text" },
                {
                  filename: "untrusted.txt",
                  mediaType: "text/plain",
                  type: "file",
                  url: "https://example.invalid/untrusted.txt",
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

    expect(response.status).toBe(400);
    expect(mocks.getConfiguredAiModel).not.toHaveBeenCalled();
    expect(mocks.getAiAuditRepository).not.toHaveBeenCalled();
    expect(mocks.ensureSession).not.toHaveBeenCalled();
  });

  it("rejects images below the provider-compatible 11 pixel boundary before setup", async () => {
    const response = await POST(
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          messages: [
            {
              id: "tiny-image-message",
              parts: [
                { text: "描述图片内容", type: "text" },
                {
                  filename: "tiny.png",
                  mediaType: "image/png",
                  type: "file",
                  url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
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

    expect(response.status).toBe(400);
    expect(mocks.getConfiguredAiModel).not.toHaveBeenCalled();
    expect(mocks.getAiAuditRepository).not.toHaveBeenCalled();
    expect(mocks.ensureSession).not.toHaveBeenCalled();
  });

  it("rejects an unreadable inline PDF after capability check but before audit setup", async () => {
    const response = await POST(
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          messages: [
            {
              id: "broken-pdf-message",
              parts: [
                { text: "分析这个 PDF", type: "text" },
                {
                  filename: "broken.pdf",
                  mediaType: "application/pdf",
                  type: "file",
                  url: `data:application/pdf;base64,${Buffer.from("%PDF-not-a-document").toString("base64")}`,
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

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        code: "INVALID_INPUT",
        message: expect.stringContaining("无法安全读取"),
      },
    });
    expect(mocks.getConfiguredAiModel).toHaveBeenCalledWith(undefined, {
      requiresMultimodalModel: false,
    });
    expect(mocks.getAiAuditRepository).not.toHaveBeenCalled();
    expect(mocks.ensureSession).not.toHaveBeenCalled();
  });

  it("rejects client-supplied AI configuration", async () => {
    const response = await POST(
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          aiConfig: {
            apiKey: "client-secret-must-not-be-accepted",
            baseUrl: "https://api.example.com/v1",
            model: "gpt-4o-mini",
          },
          messages: [
            {
              id: "valid-message",
              parts: [{ text: "查询法规", type: "text" }],
              role: "user",
            },
          ],
          sessionId: crypto.randomUUID(),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.getConfiguredAiModel).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain(
      "client-secret-must-not-be-accepted",
    );
  });

  it("rejects client provider metadata before model or database setup", async () => {
    const response = await POST(
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          messages: [
            {
              id: "provider-metadata-message",
              parts: [
                {
                  providerMetadata: {
                    provider: { untrustedOption: "client-controlled" },
                  },
                  text: "普通用户文本",
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

    expect(response.status).toBe(400);
    expect(mocks.getConfiguredAiModel).not.toHaveBeenCalled();
    expect(mocks.getAiAuditRepository).not.toHaveBeenCalled();
    expect(mocks.ensureSession).not.toHaveBeenCalled();
  });

  it("does not log sensitive details from route setup failures", async () => {
    const sensitiveText = "postgres://user:secret@example.test/database";
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mocks.getAiAuditRepository.mockRejectedValue(
      new Error(`Audit setup failed for ${sensitiveText}`),
    );

    try {
      const response = await POST(
        new Request("http://localhost/api/chat", {
          body: JSON.stringify({
            messages: [
              {
                id: "valid-message",
                parts: [{ text: "查询 CHN 法规", type: "text" }],
                role: "user",
              },
            ],
            sessionId: crypto.randomUUID(),
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );

      expect(response.status).toBe(500);
      expect(JSON.stringify(await response.json())).not.toContain(
        sensitiveText,
      );
      expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain(
        sensitiveText,
      );
      expect(consoleSpy).toHaveBeenCalledWith("Chat request failed", {
        errorCode: "Error",
      });
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
