import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAiAuditRepository: vi.fn(),
}));

vi.mock("@/server/config/portfolio-demo", () => ({
  isPortfolioDemoMode: () => true,
}));

vi.mock("@/server/services/ai-audit-service", () => ({
  getAiAuditRepository: mocks.getAiAuditRepository,
}));

import { POST } from "@/app/api/chat/route";

describe("POST /api/chat in portfolio demo mode", () => {
  it("rejects image turns before returning the text-only demo model", async () => {
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      const response = await POST(
        new Request("http://localhost/api/chat", {
          body: JSON.stringify({
            messages: [
              {
                id: "demo-image-message",
                parts: [
                  { text: "描述图片内容", type: "text" },
                  {
                    filename: "engine-plate.png",
                    mediaType: "image/png",
                    type: "file",
                    url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAHUlEQVR4nGNQTl72nxLMMGrA/9EwWDYaBsnDIgwAMoorH0C43vMAAAAASUVORK5CYII=",
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

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        error: { code: "AI_NOT_CONFIGURED" },
      });
      expect(mocks.getAiAuditRepository).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
