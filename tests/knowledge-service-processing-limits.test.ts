import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ saveDocumentFile: vi.fn() }));

vi.mock("@/server/knowledge/local-document-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/knowledge/local-document-storage")>();
  return { ...actual, saveDocumentFile: mocks.saveDocumentFile };
});

vi.mock("@/domain/knowledge/embedding", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/domain/knowledge/embedding")>();
  return { ...actual, createLocalHashEmbedding: vi.fn(actual.createLocalHashEmbedding) };
});

import { createLocalHashEmbedding } from "@/domain/knowledge/embedding";
import type { DocumentImportMetadata } from "@/features/knowledge/schemas";
import { sha256 } from "@/server/knowledge/document-file";
import { prepareKnowledgeDocument } from "@/server/services/knowledge-service";

const metadata = {
  applicationScope: null,
  canonicalUrl: null,
  countryIso3: null,
  demoNotice: "FICTIONAL DEMO DATA — NOT FOR PRODUCTION.",
  documentType: "other",
  isDemo: true,
  jurisdictionId: null,
  languageCode: "en",
  licenseCode: null,
  publishedOn: null,
  redistributionAllowed: null,
  sourcePublisher: null,
  sourceTitle: "DEMO ONLY — Output budget source",
  sourceType: "demo",
  sourceUrl: null,
  title: "DEMO ONLY — Output budget document",
  validFrom: null,
  validTo: null,
} satisfies DocumentImportMetadata;

describe("knowledge upload preparation output limits", () => {
  beforeEach(() => {
    mocks.saveDocumentFile.mockReset();
    mocks.saveDocumentFile.mockResolvedValue({ created: true, storagePath: "synthetic/content" });
    vi.mocked(createLocalHashEmbedding).mockClear();
  });

  it.each([
    { name: "heading path", text: `# ${"H".repeat(3000)}\n\nbody`, message: "标题路径超过 2048" },
    { name: "chunk count", text: "body\n\n".repeat(5001), message: "超过 5000 个分块" },
    {
      name: "aggregate generated fields",
      text: `# ${"H".repeat(1900)}\n\n${"body\n\n".repeat(3000)}`,
      message: "超过 16 Mi 个 UTF-16 单元",
    },
  ])("fails $name before embedding without returning a partial chunk set", async ({ text, message }) => {
    const bytes = Buffer.from(text);
    const prepared = await prepareKnowledgeDocument({ bytes, fileName: "demo.md", metadata, mimeType: "text/markdown" });

    expect(prepared.outcome.processingStatus).toBe("failed");
    expect(prepared.outcome.chunks).toEqual([]);
    expect(prepared.outcome.processingError).toContain(message);
    expect(prepared.outcome.processingError).not.toContain("HHHH");
    expect(createLocalHashEmbedding).not.toHaveBeenCalled();
    expect(prepared.contentSha256).toBe(sha256(bytes));
    expect(prepared.byteSize).toBe(bytes.byteLength);
    expect(mocks.saveDocumentFile).toHaveBeenCalledExactlyOnceWith({ bytes, contentSha256: sha256(bytes) });
  });

  it("keeps ordinary complete preparation and per-chunk hashes unchanged", async () => {
    const prepared = await prepareKnowledgeDocument({
      bytes: Buffer.from("# Scope\n\nFirst paragraph.\n\nSecond paragraph."),
      fileName: "demo.md", metadata, mimeType: "text/markdown",
    });
    expect(prepared.outcome.processingStatus).toBe("ready");
    expect(prepared.outcome.processingError).toBeNull();
    expect(prepared.outcome.chunks).toHaveLength(2);
    expect(createLocalHashEmbedding).toHaveBeenCalledTimes(2);
    for (const chunk of prepared.outcome.chunks) {
      expect(chunk.contentHash).toBe(sha256(chunk.content));
      expect(chunk.embedding).toHaveLength(128);
    }
  });
});
