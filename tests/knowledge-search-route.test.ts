import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hybridSearchKnowledge: vi.fn(),
}));

vi.mock("@/server/services/knowledge-service", () => ({
  hybridSearchKnowledge: mocks.hybridSearchKnowledge,
  isKnowledgeDebugEnabled: () => true,
}));

import { POST } from "@/app/api/dev/knowledge/search/route";
import { MAX_KNOWLEDGE_SEARCH_REQUEST_BYTES } from "@/server/http/request-limits";

const sensitiveText = "postgres://knowledge:secret@example.test/database";

describe("POST /api/dev/knowledge/search request limits", () => {
  beforeEach(() => {
    mocks.hybridSearchKnowledge.mockReset();
  });

  it("returns a structured 413 before search setup", async () => {
    const response = await POST(
      new Request("http://localhost/api/dev/knowledge/search", {
        body: "{}",
        headers: {
          "content-length": String(
            MAX_KNOWLEDGE_SEARCH_REQUEST_BYTES + 1,
          ),
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "检索请求过大，请缩小请求后重试。",
      },
    });
    expect(mocks.hybridSearchKnowledge).not.toHaveBeenCalled();
  });

  it("does not log search failure details", async () => {
    const error = new Error(`Search failed at ${sensitiveText}`);
    error.name = sensitiveText;
    mocks.hybridSearchKnowledge.mockRejectedValue(error);
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      const response = await POST(
        new Request("http://localhost/api/dev/knowledge/search", {
          body: JSON.stringify({ query: "emissions" }),
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
      expect(consoleSpy).toHaveBeenCalledWith(
        "Knowledge search route failed",
        { errorCode: "Error" },
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
