import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findDocumentForReprocessing: vi.fn(),
  readDocumentFile: vi.fn(),
}));

vi.mock("@/server/db/environment", () => ({
  getDatabaseMode: () => "pglite-demo",
}));

vi.mock("@/server/db/demo-client", () => ({
  getDemoDatabase: vi.fn(async () => ({})),
}));

vi.mock("@/server/repositories/knowledge-repository", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/server/repositories/knowledge-repository")
  >();
  return {
    ...actual,
    createKnowledgeRepository: () => ({
      findDocumentForReprocessing: mocks.findDocumentForReprocessing,
    }),
  };
});

vi.mock(
  "@/server/knowledge/local-document-storage",
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import("@/server/knowledge/local-document-storage")
    >();
    return {
      ...actual,
      readDocumentFile: mocks.readDocumentFile,
    };
  },
);

import { sha256 } from "@/server/knowledge/document-file";
import {
  KnowledgeConflictError,
  KnowledgeInputError,
  prepareKnowledgeDocumentReprocessing,
} from "@/server/services/knowledge-service";

const documentId = "81000000-0000-4000-8000-000000000001";
const sourceId = "81000000-0000-4000-8000-000000000002";
const jurisdictionId = "81000000-0000-4000-8000-000000000003";
const draftId = "81000000-0000-4000-8000-000000000004";
const auditId = "81000000-0000-4000-8000-000000000005";
const supersededDraftId = "81000000-0000-4000-8000-000000000007";
const readyChunkSetFingerprint = "c".repeat(64);
const failedChunkSetFingerprint = "d".repeat(64);
const editorEmail = "editor@example.test";
const creatorAccessScope = {
  createdBy: editorEmail,
  kind: "creator" as const,
};
const bytes = new TextEncoder().encode(
  "# Preserved scope\n\nExisting document body for deterministic reprocessing.",
);

function storedMetadata() {
  return {
    applicationScope: "non-road" as const,
    canonicalUrl: "https://example.test/doc",
    countryIso3: "CHN" as const,
    demoNotice: "FICTIONAL DEMO DATA — NOT FOR PRODUCTION.",
    documentType: "government-notice" as const,
    isDemo: true,
    jurisdictionId,
    languageCode: "zh-CN",
    licenseCode: "CC-BY-4.0",
    publishedOn: "2026-01-01",
    redistributionAllowed: true,
    sourcePublisher: "Demo publisher",
    sourceTitle: "DEMO ONLY — Existing source",
    sourceType: "demo" as const,
    sourceUrl: "https://example.test/source",
    title: "DEMO ONLY — Existing document",
    validFrom: "2026-01-01",
    validTo: "2027-01-01",
  };
}

function storedDocument() {
  const metadata = storedMetadata();
  return {
    ...metadata,
    activeDraft: { createdBy: editorEmail, id: draftId, version: 1 },
    auditMarkers: [
      {
        action: "draft_created" as const,
        afterData: {
          chunkSetFingerprint: readyChunkSetFingerprint,
          contentSha256: sha256(bytes),
          documentId,
          metadata,
          processingStatus: "ready" as const,
          provenanceVersion: 2 as const,
          sourceFingerprint: "a".repeat(64),
          sourceId,
        },
        draftId,
        entityKey: documentId,
        entityType: "document" as const,
        id: auditId,
      },
    ],
    contentSha256: sha256(bytes),
    chunkSetFingerprint: readyChunkSetFingerprint,
    dataSourceId: sourceId,
    governanceStatus: "draft" as const,
    mimeType: "text/plain",
    originalFilename: "notice.txt",
    processingStatus: "ready" as const,
    sourceArchivedAt: null,
    sourceFingerprint: "a".repeat(64),
    storagePath: "knowledge/81/notice.txt",
  };
}

describe("knowledge document reprocessing preparation", () => {
  beforeEach(() => {
    mocks.findDocumentForReprocessing.mockReset();
    mocks.readDocumentFile.mockReset();
    mocks.findDocumentForReprocessing.mockResolvedValue(storedDocument());
    mocks.readDocumentFile.mockResolvedValue(bytes);
  });

  it("merges a partial admin patch without erasing rich stored metadata", async () => {
    const prepared = await prepareKnowledgeDocumentReprocessing({
      accessScope: creatorAccessScope,
      documentId,
      metadata: {
        sourceTitle: "DEMO ONLY — Updated source",
        title: "DEMO ONLY — Updated document",
      },
    });

    expect(prepared.metadata).toEqual({
      applicationScope: "non-road",
      canonicalUrl: "https://example.test/doc",
      countryIso3: "CHN",
      demoNotice: "FICTIONAL DEMO DATA — NOT FOR PRODUCTION.",
      documentType: "government-notice",
      isDemo: true,
      jurisdictionId,
      languageCode: "zh-CN",
      licenseCode: "CC-BY-4.0",
      publishedOn: "2026-01-01",
      redistributionAllowed: true,
      sourcePublisher: "Demo publisher",
      sourceTitle: "DEMO ONLY — Updated source",
      sourceType: "demo",
      sourceUrl: "https://example.test/source",
      title: "DEMO ONLY — Updated document",
      validFrom: "2026-01-01",
      validTo: "2027-01-01",
    });
    expect(prepared.outcome.processingStatus).toBe("ready");
    expect(prepared.expected.activeDraftCreatedBy).toBe(editorEmail);
    expect(mocks.findDocumentForReprocessing).toHaveBeenCalledWith({
      accessScope: creatorAccessScope,
      documentId,
    });
    expect(prepared.outcome.chunks[0]).toMatchObject({
      applicationScope: "non-road",
      countryIso3: "CHN",
      jurisdictionId,
    });
  });

  it.each([
    { name: "no leading empty page", prefix: "", pageOffset: 0 },
    { name: "one leading empty page", prefix: "\f", pageOffset: 1 },
    { name: "two leading empty pages", prefix: "\f\f", pageOffset: 2 },
    { name: "a BOM and an empty page", prefix: "\uFEFF\f", pageOffset: 1 },
  ])("rebuilds hash-verified source locators with $name", async ({ prefix, pageOffset }) => {
    const sourceBytes = new TextEncoder().encode(
      `${prefix}# Scope\n### First subsection\nFirst body.\f### Second subsection\nSecond body.`,
    );
    const contentSha256 = sha256(sourceBytes);
    const stored = storedDocument();
    mocks.readDocumentFile.mockResolvedValue(sourceBytes);
    mocks.findDocumentForReprocessing.mockResolvedValue({
      ...stored,
      contentSha256,
      auditMarkers: stored.auditMarkers.map((audit) => ({
        ...audit,
        afterData: { ...audit.afterData, contentSha256 },
      })),
    });

    const prepared = await prepareKnowledgeDocumentReprocessing({
      accessScope: creatorAccessScope,
      documentId,
      metadata: {},
    });

    expect(prepared.expected.contentSha256).toBe(contentSha256);
    expect(prepared.outcome.processingStatus).toBe("ready");
    expect(prepared.outcome.chunks).toHaveLength(2);
    for (const [index, subsection] of ["First subsection", "Second subsection"].entries()) {
      const headingPath = [stored.title, "Scope", subsection];
      const chunk = prepared.outcome.chunks[index]!;
      expect(chunk).toMatchObject({
        applicationScope: "non-road",
        chunkIndex: index,
        countryIso3: "CHN",
        headingPath,
        jurisdictionId,
        pageFrom: index + pageOffset + 1,
        pageTo: index + pageOffset + 1,
        sectionLocator: `${headingPath.join(" > ")} · paragraph 1`,
        validFrom: stored.validFrom,
        validTo: stored.validTo,
      });
      expect(chunk.contentHash).toBe(sha256(chunk.content));
    }
  });

  it("preserves supplementary source characters through prepared chunk encoding and hashes", async () => {
    const paragraph = `${"甲".repeat(1199)}𠮷${"乙".repeat(1201)}`;
    const sourceBytes = new TextEncoder().encode(`# Scope\n\n${paragraph}`);
    const contentSha256 = sha256(sourceBytes);
    const stored = storedDocument();
    mocks.readDocumentFile.mockResolvedValue(sourceBytes);
    mocks.findDocumentForReprocessing.mockResolvedValue({
      ...stored,
      contentSha256,
      auditMarkers: stored.auditMarkers.map((audit) => ({
        ...audit,
        afterData: { ...audit.afterData, contentSha256 },
      })),
    });

    const prepared = await prepareKnowledgeDocumentReprocessing({
      accessScope: creatorAccessScope,
      documentId,
      metadata: {},
    });

    expect(prepared.outcome.processingStatus).toBe("ready");
    expect(prepared.expected.contentSha256).toBe(contentSha256);
    const prefix = `${stored.title} > Scope\n`;
    const encodedBodies = prepared.outcome.chunks.map((chunk, chunkIndex) => {
      expect(chunk.content.startsWith(prefix)).toBe(true);
      expect(chunk).toMatchObject({
        chunkIndex,
        countryIso3: "CHN",
        headingPath: [stored.title, "Scope"],
        pageFrom: 1,
        pageTo: 1,
        sectionLocator: `${stored.title} > Scope · paragraph 1`,
      });
      const encodedContent = Buffer.from(chunk.content, "utf8");
      expect(encodedContent.toString("utf8") === chunk.content).toBe(true);
      expect(chunk.contentHash).toBe(sha256(encodedContent));
      const body = chunk.content.slice(prefix.length);
      expect(body.length).toBeLessThanOrEqual(1200);
      return Buffer.from(body, "utf8");
    });
    expect(Buffer.concat(encodedBodies).equals(Buffer.from(paragraph, "utf8"))).toBe(true);
  });

  it("recovers chunk-only metadata from the active draft audit after a failed upload", async () => {
    const governanceMetadata = storedMetadata();
    const stored = storedDocument();
    mocks.findDocumentForReprocessing.mockResolvedValue({
      ...stored,
      applicationScope: null,
      chunkSetFingerprint: failedChunkSetFingerprint,
      auditMarkers: stored.auditMarkers.map((audit) => ({
        ...audit,
        afterData: {
          ...audit.afterData,
          chunkSetFingerprint: failedChunkSetFingerprint,
          processingStatus: "failed" as const,
        },
      })),
      countryIso3: null,
      jurisdictionId: null,
      processingStatus: "failed",
    });

    const prepared = await prepareKnowledgeDocumentReprocessing({
      accessScope: creatorAccessScope,
      documentId,
      metadata: {},
    });

    expect(prepared.metadata).toEqual(governanceMetadata);
    expect(prepared.outcome.chunks[0]).toMatchObject({
      applicationScope: "non-road",
      countryIso3: "CHN",
      jurisdictionId,
    });
  });

  it.each(["ready", "failed"] as const)(
    "handles output-limit failure without a partial replacement for a %s document",
    async (processingStatus) => {
      const sourceBytes = Buffer.from(`# ${"H".repeat(3000)}\n\nbody`);
      const contentSha256 = sha256(sourceBytes);
      const stored = storedDocument();
      const chunkSetFingerprint = processingStatus === "ready"
        ? readyChunkSetFingerprint : failedChunkSetFingerprint;
      mocks.readDocumentFile.mockResolvedValue(sourceBytes);
      mocks.findDocumentForReprocessing.mockResolvedValue({
        ...stored, contentSha256, chunkSetFingerprint, processingStatus,
        auditMarkers: stored.auditMarkers.map((audit) => ({
          ...audit,
          afterData: { ...audit.afterData, contentSha256, chunkSetFingerprint, processingStatus },
        })),
      });

      const preparation = prepareKnowledgeDocumentReprocessing({
        accessScope: creatorAccessScope, documentId, metadata: {},
      });
      if (processingStatus === "ready") {
        await expect(preparation).rejects.toThrow("未修改现有 ready 文档");
      } else {
        const prepared = await preparation;
        expect(prepared.outcome.processingStatus).toBe("failed");
        expect(prepared.outcome.chunks).toEqual([]);
        expect(prepared.outcome.processingError).toContain("标题路径超过 2048");
        expect(prepared.expected.contentSha256).toBe(contentSha256);
      }
    },
  );

  it("fails closed on malformed governance metadata before reading the stored file", async () => {
    const stored = storedDocument();
    mocks.findDocumentForReprocessing.mockResolvedValue({
      ...stored,
      chunkSetFingerprint: failedChunkSetFingerprint,
      auditMarkers: stored.auditMarkers.map((audit) => ({
        ...audit,
        afterData: {
          ...audit.afterData,
          chunkSetFingerprint: failedChunkSetFingerprint,
          metadata: { applicationScope: "invented-scope" },
          processingStatus: "failed" as const,
        },
      })),
      processingStatus: "failed",
    });

    await expect(
      prepareKnowledgeDocumentReprocessing({
        accessScope: creatorAccessScope,
        documentId,
        metadata: {},
      }),
    ).rejects.toBeInstanceOf(KnowledgeConflictError);
    expect(mocks.readDocumentFile).not.toHaveBeenCalled();
  });

  it.each(["title", "sourceUrl"])("rejects non-persistable %s patches before reading the original file", async (field) => {
    for (const character of ["\0", "\ud800", "\udc00"]) {
      const value = field === "sourceUrl" ? `https://example.test/${character}demo` : `DEMO ONLY ${character} title`;
      await expect(prepareKnowledgeDocumentReprocessing({
        accessScope: creatorAccessScope, documentId, metadata: { [field]: value },
      })).rejects.toMatchObject({ name: "ZodError" });
    }
    expect(mocks.readDocumentFile).not.toHaveBeenCalled();
  });

  it.each(["ready", "failed"] as const)("does not prepare partial NUL text for a %s document", async (processingStatus) => {
    const sourceBytes = Buffer.from("DEMO ONLY — preserved before\0after");
    const contentSha256 = sha256(sourceBytes);
    const stored = storedDocument();
    const chunkSetFingerprint = processingStatus === "ready" ? readyChunkSetFingerprint : failedChunkSetFingerprint;
    mocks.readDocumentFile.mockResolvedValue(sourceBytes);
    mocks.findDocumentForReprocessing.mockResolvedValue({
      ...stored, contentSha256, chunkSetFingerprint, processingStatus,
      auditMarkers: stored.auditMarkers.map((audit) => ({
        ...audit,
        afterData: { ...audit.afterData, contentSha256, chunkSetFingerprint, processingStatus },
      })),
    });
    const preparation = prepareKnowledgeDocumentReprocessing({ accessScope: creatorAccessScope, documentId, metadata: {} });
    if (processingStatus === "ready") {
      await expect(preparation).rejects.toThrow("未修改现有 ready 文档");
    } else {
      const prepared = await preparation;
      expect(prepared.outcome).toMatchObject({ chunks: [], processingStatus: "failed" });
      expect(prepared.outcome.processingError).toContain("U+0000");
      expect(prepared.outcome.processingError).not.toContain("before");
      expect(prepared.expected.contentSha256).toBe(contentSha256);
    }
  });

  it("fails closed when a failed document has no provenance audit", async () => {
    mocks.findDocumentForReprocessing.mockResolvedValue({
      ...storedDocument(),
      applicationScope: null,
      auditMarkers: [],
      chunkSetFingerprint: failedChunkSetFingerprint,
      countryIso3: null,
      jurisdictionId: null,
      processingStatus: "failed",
    });

    await expect(
      prepareKnowledgeDocumentReprocessing({
        accessScope: creatorAccessScope,
        documentId,
        metadata: {},
      }),
    ).rejects.toBeInstanceOf(KnowledgeConflictError);
    expect(mocks.readDocumentFile).not.toHaveBeenCalled();
  });

  it("uses the strict reprocessed marker as the sole metadata source", async () => {
    const stored = storedDocument();
    const governanceMetadata = storedMetadata();
    mocks.findDocumentForReprocessing.mockResolvedValue({
      ...stored,
      activeDraft: {
        createdBy: editorEmail,
        id: draftId,
        version: 2,
      },
      applicationScope: null,
      chunkSetFingerprint: failedChunkSetFingerprint,
      auditMarkers: [
        {
          ...stored.auditMarkers[0],
          afterData: { documentId },
        },
        {
          action: "document_reprocessed" as const,
          afterData: {
            chunkSetFingerprint: failedChunkSetFingerprint,
            contentSha256: sha256(bytes),
            documentId,
            metadata: governanceMetadata,
            operationFingerprint: "b".repeat(64),
            processingStatus: "failed" as const,
            provenanceVersion: 2 as const,
            sourceFingerprint: "a".repeat(64),
            sourceId,
            status: "failed" as const,
            supersededDraftIds: [supersededDraftId],
          },
          draftId,
          entityKey: documentId,
          entityType: "document" as const,
          id: "81000000-0000-4000-8000-000000000006",
        },
      ],
      countryIso3: null,
      jurisdictionId: null,
      processingStatus: "failed",
    });

    const prepared = await prepareKnowledgeDocumentReprocessing({
      accessScope: creatorAccessScope,
      documentId,
      metadata: {},
    });

    expect(prepared.metadata).toEqual(governanceMetadata);
    expect(prepared.expected.provenanceAuditId).toBe(
      "81000000-0000-4000-8000-000000000006",
    );
  });

  it("rejects an audit marker bound to the wrong entity", async () => {
    const stored = storedDocument();
    mocks.findDocumentForReprocessing.mockResolvedValue({
      ...stored,
      auditMarkers: stored.auditMarkers.map((audit) => ({
        ...audit,
        entityKey: "81000000-0000-4000-8000-000000000099",
      })),
    });

    await expect(
      prepareKnowledgeDocumentReprocessing({
        accessScope: creatorAccessScope,
        documentId,
        metadata: {},
      }),
    ).rejects.toBeInstanceOf(KnowledgeConflictError);
    expect(mocks.readDocumentFile).not.toHaveBeenCalled();
  });

  it("rejects archived evidence sources before reading the stored file", async () => {
    mocks.findDocumentForReprocessing.mockResolvedValue({
      ...storedDocument(),
      sourceArchivedAt: new Date("2026-08-30T01:00:00.000Z"),
    });

    await expect(
      prepareKnowledgeDocumentReprocessing({
        accessScope: creatorAccessScope,
        documentId,
        metadata: {},
      }),
    ).rejects.toBeInstanceOf(KnowledgeConflictError);
    expect(mocks.readDocumentFile).not.toHaveBeenCalled();
  });

  it("rejects unknown patch fields before reading the stored file", async () => {
    await expect(
      prepareKnowledgeDocumentReprocessing({
        accessScope: creatorAccessScope,
        documentId,
        metadata: { unexpected: true },
      }),
    ).rejects.toThrow();
    expect(mocks.readDocumentFile).not.toHaveBeenCalled();
  });

  it.each([
    "Document files must not exceed 5 MiB.",
    "A stored document must be a regular file.",
  ])("does not prepare replacement evidence after a bounded-read rejection: %s", async (message) => {
    const stored = storedDocument();
    const before = structuredClone(stored);
    mocks.findDocumentForReprocessing.mockResolvedValue(stored);
    mocks.readDocumentFile.mockRejectedValue(new Error(message));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(prepareKnowledgeDocumentReprocessing({
        accessScope: creatorAccessScope,
        documentId,
        metadata: {},
      })).rejects.toMatchObject({
        code: "EMPTY_FILE",
        message: "文档原文件不可读，未修改现有文档。",
      });
      expect(mocks.readDocumentFile).toHaveBeenCalledTimes(1);
      expect(stored).toEqual(before);
      expect(log.mock.calls).toEqual([["Knowledge document reprocessing file read failed", { errorCode: "Error" }]]);
    } finally {
      log.mockRestore();
    }
  });

  it("fails closed when the repository returns another editor's active draft", async () => {
    const victimEmail = "victim-editor@example.test";
    const stored = storedDocument();
    mocks.findDocumentForReprocessing.mockResolvedValue({
      ...stored,
      activeDraft: {
        ...stored.activeDraft,
        createdBy: victimEmail,
      },
    });

    const error = await prepareKnowledgeDocumentReprocessing({
      accessScope: creatorAccessScope,
      documentId,
      metadata: {},
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(KnowledgeInputError);
    expect(error).toMatchObject({
      code: "EMPTY_FILE",
      message: "文档不存在、已归档或没有可重新处理的原文件。",
    });
    expect(JSON.stringify(error)).not.toContain(victimEmail);
    expect(mocks.readDocumentFile).not.toHaveBeenCalled();
  });
});
