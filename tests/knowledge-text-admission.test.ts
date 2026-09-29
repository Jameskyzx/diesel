import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

const mocks = vi.hoisted(() => ({
  getDemoDatabase: vi.fn(),
  readDocumentFile: vi.fn(),
  saveDocumentFile: vi.fn(),
}));

vi.mock("@/server/db/environment", () => ({ getDatabaseMode: () => "pglite-demo" }));
vi.mock("@/server/db/demo-client", () => ({ getDemoDatabase: mocks.getDemoDatabase }));
vi.mock("@/server/knowledge/local-document-storage", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/knowledge/local-document-storage")>(),
  readDocumentFile: mocks.readDocumentFile,
  saveDocumentFile: mocks.saveDocumentFile,
}));
vi.mock("@/domain/knowledge/embedding", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/domain/knowledge/embedding")>();
  return { ...actual, createLocalHashEmbedding: vi.fn(actual.createLocalHashEmbedding) };
});

import { createLocalHashEmbedding } from "@/domain/knowledge/embedding";
import { documentImportMetadataSchema, type DocumentImportMetadata } from "@/features/knowledge/schemas";
import { dataChangeLogs, dataGovernanceDrafts, documentChunks, documents } from "@/server/db/schema";
import { sha256 } from "@/server/knowledge/document-file";
import { uploadGovernedDocument } from "@/server/services/governance-service";
import { getKnowledgeDocumentFile, importKnowledgeDocument } from "@/server/services/knowledge-service";
import { createTestDatabase } from "./helpers/database";

const metadata = {
  applicationScope: null, canonicalUrl: null, countryIso3: null,
  demoNotice: "FICTIONAL DEMO DATA — NOT FOR PRODUCTION.", documentType: "other",
  isDemo: true, jurisdictionId: null, languageCode: "en", licenseCode: null,
  publishedOn: null, redistributionAllowed: null, sourcePublisher: null,
  sourceTitle: "DEMO ONLY — Text admission source", sourceType: "demo", sourceUrl: null,
  title: "DEMO ONLY — Text admission document", validFrom: null, validTo: null,
} satisfies DocumentImportMetadata;
const invalidCharacters = ["\0", "\ud800", "\udc00"];
const textFields = ["title", "sourceTitle", "sourcePublisher", "licenseCode", "demoNotice", "canonicalUrl", "sourceUrl"] as const;
const paths = ["development", "governed"] as const;
type ImportPath = (typeof paths)[number];
type UploadInput = { bytes: Uint8Array; fileName: string; metadata: unknown; mimeType: string };

async function importDocument(path: ImportPath, input: UploadInput) {
  if (path === "development") {
    return importKnowledgeDocument({ ...input, governanceStatus: "draft" });
  }
  const result = await uploadGovernedDocument({
    ...input, actor: { email: "text-editor@example.test", role: "editor" },
    changeReason: "Import a fictional text admission regression document.",
  });
  return result.import;
}

describe("document metadata preserves representable text", () => {
  it.each(textFields)("rejects NUL and unpaired surrogates in %s", (field) => {
    for (const character of invalidCharacters) {
      const value = field.endsWith("Url") ? `https://example.test/${character}demo` : `DEMO ONLY ${character} text`;
      const result = documentImportMetadataSchema.safeParse({ ...metadata, [field]: value });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues.some((issue) => issue.path[0] === field)).toBe(true);
    }
  });

  it("preserves legal multilingual text, explicit replacement characters and percent-encoded URL text", () => {
    const title = "DEMO ONLY — 𠀀 😀 中文\ttext\n\f�";
    const value = { ...metadata, title, sourceTitle: title, sourceUrl: "https://example.test/%00/%F0%9F%98%80" };
    expect(documentImportMetadataSchema.parse(value)).toEqual(value);
  });
});

describe("document text admission through real repositories", () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;
  const storedFiles = new Map<string, Buffer>();

  beforeAll(async () => { testDatabase = await createTestDatabase(); }, 30_000);
  afterAll(async () => { await testDatabase.client.close(); });
  beforeEach(() => {
    storedFiles.clear();
    mocks.getDemoDatabase.mockReset().mockResolvedValue(testDatabase.database);
    mocks.saveDocumentFile.mockReset().mockImplementation(async ({ bytes, contentSha256 }: { bytes: Uint8Array; contentSha256: string }) => {
      const storagePath = `${contentSha256}/content`;
      const created = !storedFiles.has(storagePath);
      storedFiles.set(storagePath, Buffer.from(bytes));
      return { created, storagePath };
    });
    mocks.readDocumentFile.mockReset().mockImplementation(async (storagePath: string) => {
      const bytes = storedFiles.get(storagePath);
      if (!bytes) throw new Error("Missing fictional stored document.");
      return Buffer.from(bytes);
    });
    vi.mocked(createLocalHashEmbedding).mockClear();
  });

  it.each(paths)("retains a failed %s NUL document without chunks, embedding or repeated writes", async (path) => {
    const bytes = Buffer.from(`DEMO ONLY — ${path} before\0after`);
    const input = { bytes, fileName: `${path}-nul.txt`, metadata, mimeType: "text/plain" };
    const result = await importDocument(path, input);
    expect(result).toMatchObject({ status: "failed", document: { processingStatus: "failed", chunkCount: 0, contentSha256: sha256(bytes) } });
    expect(result.document.processingError).toContain("U+0000");
    expect(result.document.processingError).not.toContain("before");
    expect(createLocalHashEmbedding).not.toHaveBeenCalled();
    expect(await testDatabase.database.select().from(documentChunks).where(eq(documentChunks.documentId, result.document.id))).toEqual([]);
    const preserved = await getKnowledgeDocumentFile({ documentId: result.document.id });
    expect(preserved?.bytes).toEqual(bytes);
    const drafts = await testDatabase.database.select().from(dataGovernanceDrafts).where(eq(dataGovernanceDrafts.entityKey, result.document.id));
    const logs = await testDatabase.database.select().from(dataChangeLogs).where(eq(dataChangeLogs.entityKey, result.document.id));
    expect(drafts).toHaveLength(path === "governed" ? 1 : 0);
    expect(logs.map(({ action }) => action)).toEqual(path === "governed" ? ["draft_created"] : []);
    const repeated = await importDocument(path, input);
    expect(repeated).toMatchObject({ status: "duplicate", document: { id: result.document.id, processingStatus: "failed", chunkCount: 0 } });
    expect(await testDatabase.database.select().from(dataGovernanceDrafts).where(eq(dataGovernanceDrafts.entityKey, result.document.id))).toEqual(drafts);
    expect(await testDatabase.database.select().from(dataChangeLogs).where(eq(dataChangeLogs.entityKey, result.document.id))).toEqual(logs);
  });

  it.each(paths)("rejects invalid %s metadata before storage or repository access", async (path) => {
    for (const character of invalidCharacters) {
      await expect(importDocument(path, {
        bytes: Buffer.from("DEMO ONLY — rejected metadata"), fileName: "demo.txt", mimeType: "text/plain",
        metadata: { ...metadata, title: `DEMO ONLY ${character} title` },
      })).rejects.toBeInstanceOf(ZodError);
    }
    expect(mocks.saveDocumentFile).not.toHaveBeenCalled();
    expect(mocks.getDemoDatabase).not.toHaveBeenCalled();
    expect(createLocalHashEmbedding).not.toHaveBeenCalled();
  });

  it.each(paths.flatMap((path) => (["fileName", "mimeType"] as const).map((field) => ({ path, field }))))(
    "rejects invalid $path $field before storage or repository access", async ({ path, field }) => {
      for (const character of invalidCharacters) {
        await expect(importDocument(path, {
          bytes: Buffer.from("DEMO ONLY — rejected descriptor"), fileName: "demo.txt", mimeType: "text/plain", metadata,
          [field]: field === "fileName" ? `demo${character}.txt` : `text/plain${character}`,
        })).rejects.toBeInstanceOf(ZodError);
      }
      expect(mocks.saveDocumentFile).not.toHaveBeenCalled();
      expect(mocks.getDemoDatabase).not.toHaveBeenCalled();
      expect(createLocalHashEmbedding).not.toHaveBeenCalled();
    },
  );

  it.each(paths)("round-trips legal %s metadata and source text through database and download", async (path) => {
    const title = `DEMO ONLY — ${path} 𠀀 😀 中文 �`;
    const bytes = Buffer.from(`\f# Scope\n\nDEMO ONLY — ${path} 𠀀 😀 text\twith spaces.\n`);
    const result = await importDocument(path, { bytes, fileName: `${path}-𠀀-😀.txt`, mimeType: "text/plain", metadata: { ...metadata, title } });
    expect(result.status).toBe("ready");
    const [document] = await testDatabase.database.select().from(documents).where(eq(documents.id, result.document.id));
    expect(document?.title).toBe(title);
    expect(document?.originalFilename).toBe(`${path}-𠀀-😀.txt`);
    const chunks = await testDatabase.database.select().from(documentChunks).where(eq(documentChunks.documentId, result.document.id));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ contentHash: sha256(chunks[0]!.content), headingPath: [title, "Scope"], pageFrom: 2, pageTo: 2 });
    expect((await getKnowledgeDocumentFile({ documentId: result.document.id }))?.bytes).toEqual(bytes);
  });
});
