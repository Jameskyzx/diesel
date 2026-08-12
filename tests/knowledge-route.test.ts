import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getKnowledgeDocumentFile: vi.fn(),
  getKnowledgeOptions: vi.fn(),
  importKnowledgeDocument: vi.fn(),
  parseDocumentImportFormData: vi.fn(() => ({ title: "Debug document" })),
}));

vi.mock("@/server/services/knowledge-service", () => ({
  getKnowledgeDocumentFile: mocks.getKnowledgeDocumentFile,
  getKnowledgeOptions: mocks.getKnowledgeOptions,
  importKnowledgeDocument: mocks.importKnowledgeDocument,
  isKnowledgeDebugEnabled: () => true,
  KnowledgeInputError: class KnowledgeInputError extends Error {
    code = "INVALID_INPUT";
  },
  parseDocumentImportFormData: mocks.parseDocumentImportFormData,
}));

import { POST } from "@/app/api/dev/knowledge/documents/route";
import { MAX_KNOWLEDGE_IMPORT_REQUEST_BYTES } from "@/server/http/request-limits";
import { GET as downloadDocument } from "@/app/api/dev/knowledge/documents/[documentId]/file/route";
import { GET as getKnowledgeOptions } from "@/app/api/dev/knowledge/options/route";

const sensitiveText = "postgres://knowledge:secret@example.test/database";

async function expectSafeKnowledgeLog(
  action: () => Promise<Response>,
  eventName: string,
) {
  const consoleSpy = vi
    .spyOn(console, "error")
    .mockImplementation(() => undefined);

  try {
    const response = await action();

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain(sensitiveText);
    expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain(sensitiveText);
    expect(consoleSpy).toHaveBeenCalledWith(eventName, {
      errorCode: "Error",
    });
  } finally {
    consoleSpy.mockRestore();
  }
}

describe("POST /api/dev/knowledge/documents", () => {
  beforeEach(() => {
    mocks.getKnowledgeDocumentFile.mockReset();
    mocks.getKnowledgeOptions.mockReset();
    mocks.importKnowledgeDocument.mockReset();
    mocks.parseDocumentImportFormData.mockClear();
    mocks.importKnowledgeDocument.mockResolvedValue({
      document: {
        byteSize: 12,
        chunkCount: 1,
        contentSha256: "a".repeat(64),
        createdAt: "2026-08-05T22:45:00.000Z",
        downloadUrl: "/api/dev/knowledge/documents/test/file",
        governanceStatus: "published",
        id: "10000000-0000-4000-8000-000000000001",
        isDemo: true,
        mimeType: "text/plain",
        originalFilename: "debug.txt",
        processedAt: "2026-08-05T22:45:01.000Z",
        processingError: null,
        processingStatus: "ready",
        sourceTitle: "DEMO ONLY - Debug source",
        title: "DEMO ONLY - Debug document",
        type: "other",
      },
      status: "ready",
    });
  });

  it("makes the developer-only immediate-publication exception explicit", async () => {
    const formData = new FormData();
    formData.set(
      "file",
      new File(["debug text"], "debug.txt", { type: "text/plain" }),
    );

    const response = await POST(
      new Request("http://localhost/api/dev/knowledge/documents", {
        body: formData,
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.importKnowledgeDocument).toHaveBeenCalledWith({
      bytes: new Uint8Array(Buffer.from("debug text")),
      fileName: "debug.txt",
      governanceStatus: "published",
      metadata: { title: "Debug document" },
      mimeType: "text/plain",
    });
  });

  it("rejects an oversized multipart request before importing", async () => {
    const response = await POST(
      new Request("http://localhost/api/dev/knowledge/documents", {
        body: "x",
        headers: {
          "content-length": String(
            MAX_KNOWLEDGE_IMPORT_REQUEST_BYTES + 1,
          ),
          "content-type": "multipart/form-data; boundary=oversized",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "FILE_TOO_LARGE" },
    });
    expect(mocks.importKnowledgeDocument).not.toHaveBeenCalled();
  });

  it("does not log import failure details", async () => {
    const error = new Error(`Import failed at ${sensitiveText}`);
    error.name = sensitiveText;
    mocks.importKnowledgeDocument.mockRejectedValue(error);
    const formData = new FormData();
    formData.set(
      "file",
      new File(["debug text"], "debug.txt", { type: "text/plain" }),
    );

    await expectSafeKnowledgeLog(
      () =>
        POST(
          new Request("http://localhost/api/dev/knowledge/documents", {
            body: formData,
            method: "POST",
          }),
        ),
      "Knowledge import route failed",
    );
  });

  it("does not log download failure details", async () => {
    const error = new Error(`Download failed at ${sensitiveText}`);
    error.name = sensitiveText;
    mocks.getKnowledgeDocumentFile.mockRejectedValue(error);

    await expectSafeKnowledgeLog(
      () =>
        downloadDocument(
          new Request("http://localhost/api/dev/knowledge/documents/test/file"),
          {
            params: Promise.resolve({
              documentId: "10000000-0000-4000-8000-000000000001",
            }),
          },
        ),
      "Knowledge download route failed",
    );
  });

  it("does not log options failure details", async () => {
    const error = new Error(`Options failed at ${sensitiveText}`);
    error.name = sensitiveText;
    mocks.getKnowledgeOptions.mockRejectedValue(error);

    await expectSafeKnowledgeLog(
      () => getKnowledgeOptions(),
      "Knowledge options route failed",
    );
  });
});
