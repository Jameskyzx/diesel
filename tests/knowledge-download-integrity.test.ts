import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDemoDatabase: vi.fn(),
  nodeEnv: "test" as "test" | "production",
  readDocumentFile: vi.fn(),
  saveDocumentFile: vi.fn(),
}));

vi.mock("@/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/env")>();
  return { ...actual, env: { ...actual.env, get NODE_ENV() { return mocks.nodeEnv; } } };
});
vi.mock("@/server/db/environment", () => ({ getDatabaseMode: () => "pglite-demo" }));
vi.mock("@/server/db/demo-client", () => ({ getDemoDatabase: mocks.getDemoDatabase }));
vi.mock("@/server/knowledge/local-document-storage", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/knowledge/local-document-storage")>(),
  readDocumentFile: mocks.readDocumentFile,
  saveDocumentFile: mocks.saveDocumentFile,
}));

import { GET } from "@/app/api/dev/knowledge/documents/[documentId]/file/route";
import type { DocumentImportMetadata } from "@/features/knowledge/schemas";
import { dataChangeLogs, dataGovernanceDrafts, dataSources, documentChunks, documents } from "@/server/db/schema";
import { sha256 } from "@/server/knowledge/document-file";
import { getKnowledgeDocumentFile } from "@/server/services/knowledge-service";
import { uploadGovernedDocument } from "@/server/services/governance-service";
import { createTestDatabase } from "./helpers/database";

const metadata = {
  applicationScope: null, canonicalUrl: null, countryIso3: null,
  demoNotice: "FICTIONAL DEMO DATA — NOT FOR PRODUCTION.", documentType: "other",
  isDemo: true, jurisdictionId: null, languageCode: "en", licenseCode: null,
  publishedOn: null, redistributionAllowed: null, sourcePublisher: null,
  sourceTitle: "DEMO ONLY — Download integrity source", sourceType: "demo", sourceUrl: null,
  title: "DEMO ONLY — Download integrity document", validFrom: null, validTo: null,
} satisfies DocumentImportMetadata;

const pathKinds = ["content-addressed", "legacy"] as const;
type PathKind = (typeof pathKinds)[number];
const unavailableResponse = {
  error: { code: "INTERNAL_ERROR", message: "原始文件暂时无法读取。" },
};

function download(documentId: string) {
  return GET(new Request(`http://localhost/api/dev/knowledge/documents/${documentId}/file`), {
    params: Promise.resolve({ documentId }),
  });
}

describe("original document download integrity through the real route and repositories", () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;
  const storedFiles = new Map<string, Buffer>();

  beforeAll(async () => { testDatabase = await createTestDatabase(); }, 30_000);
  afterAll(async () => { await testDatabase.client.close(); });
  afterEach(() => { vi.restoreAllMocks(); });
  beforeEach(() => {
    mocks.nodeEnv = "test";
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
      if (!bytes) throw new Error("Missing fictional download fixture.");
      return bytes;
    });
  });

  async function registerDocument(label: string, options: {
    bytes?: Buffer;
    fileName?: string;
    mimeType?: string;
    pathKind?: PathKind;
  } = {}) {
    const bytes = options.bytes ?? Buffer.from(`\ufeff\f# DEMO ONLY — ${label}\n\nOriginal fictional text 𠀀 😀.\t\n`);
    const fileName = options.fileName ?? `DEMO-${label}-原件 '😀.md`;
    const mimeType = options.mimeType ?? "text/markdown";
    const result = await uploadGovernedDocument({
      actor: { email: "download-editor@example.test", role: "editor" },
      bytes, changeReason: "Register a fictional download integrity regression document.",
      fileName, metadata, mimeType,
    });
    const documentId = result.import.document.id;
    let storagePath = `${sha256(bytes)}/content`;
    if (options.pathKind === "legacy") {
      storagePath = `${sha256(bytes)}/${fileName}`;
      storedFiles.set(storagePath, Buffer.from(bytes));
      await testDatabase.database.update(documents).set({ storagePath }).where(eq(documents.id, documentId));
    }
    mocks.readDocumentFile.mockClear();
    return { bytes, documentId, fileName, mimeType, result: result.import, storagePath };
  }

  async function snapshot(documentId: string) {
    const [document] = await testDatabase.database.select().from(documents).where(eq(documents.id, documentId));
    if (!document) throw new Error("Missing fictional registered document.");
    return {
      document,
      sources: await testDatabase.database.select().from(dataSources).where(eq(dataSources.id, document.dataSourceId)),
      chunks: await testDatabase.database.select().from(documentChunks).where(eq(documentChunks.documentId, documentId)).orderBy(documentChunks.id),
      drafts: await testDatabase.database.select().from(dataGovernanceDrafts).where(eq(dataGovernanceDrafts.entityKey, documentId)).orderBy(dataGovernanceDrafts.id),
      logs: await testDatabase.database.select().from(dataChangeLogs).where(eq(dataChangeLogs.entityKey, documentId)).orderBy(dataChangeLogs.id),
    };
  }

  it.each(pathKinds)("returns exact verified %s bytes with existing private download headers", async (pathKind) => {
    const fixture = await registerDocument(`unchanged-${pathKind}`, { pathKind });
    expect(fixture.result.status).toBe("ready");
    const response = await download(fixture.documentId);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(fixture.bytes);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-type")).toBe(fixture.mimeType);
    expect(response.headers.get("content-disposition")).toBe(`attachment; filename*=UTF-8''${encodeURIComponent(fixture.fileName)}`);
    expect(mocks.readDocumentFile).toHaveBeenCalledExactlyOnceWith(fixture.storagePath);
  });

  const corruptions = [
    { name: "same-length replacement", change: (bytes: Buffer) => { const changed = Buffer.from(bytes); changed[changed.length - 1] = 0x58; return changed; } },
    { name: "truncation", change: (bytes: Buffer) => bytes.subarray(0, bytes.length - 1) },
    { name: "empty file", change: () => Buffer.alloc(0) },
    { name: "different document", change: () => Buffer.from("DEMO ONLY — WRONG SOURCE MUST NOT BE DOWNLOADED") },
  ];

  it.each(pathKinds.flatMap((pathKind) => corruptions.map((corruption) => ({ pathKind, ...corruption }))))(
    "rejects $pathKind $name without returning bytes or mutating registered evidence", async ({ pathKind, change, name }) => {
      const fixture = await registerDocument(`${pathKind}-${name}`, { pathKind });
      const before = await snapshot(fixture.documentId);
      expect(before.chunks.length).toBeGreaterThan(0);
      expect(before.drafts).toHaveLength(1);
      expect(before.logs.map(({ action }) => action)).toEqual(["draft_created"]);
      const changed = change(fixture.bytes);
      expect(sha256(changed)).not.toBe(sha256(fixture.bytes));
      if (name === "same-length replacement") expect(changed.length).toBe(fixture.bytes.length);
      storedFiles.set(fixture.storagePath, changed);
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

      const response = await download(fixture.documentId);

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual(unavailableResponse);
      expect(response.headers.get("content-disposition")).toBeNull();
      expect(log.mock.calls).toEqual([["Knowledge download route failed", { errorCode: "Error" }]]);
      expect(mocks.readDocumentFile).toHaveBeenCalledExactlyOnceWith(fixture.storagePath);
      expect(await snapshot(fixture.documentId)).toEqual(before);
      expect(mocks.saveDocumentFile).toHaveBeenCalledTimes(1);
      expect(storedFiles.get(fixture.storagePath)).toBe(changed);
    },
  );

  it("uses the registered hash even when the path matches the wrong file's hash", async () => {
    const fixture = await registerDocument("misleading-hash-shaped-path");
    const wrongBytes = Buffer.from("DEMO ONLY — a different content-addressed document");
    const wrongPath = `${sha256(wrongBytes)}/content`;
    storedFiles.set(wrongPath, wrongBytes);
    await testDatabase.database.update(documents).set({ storagePath: wrongPath }).where(eq(documents.id, fixture.documentId));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await download(fixture.documentId);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual(unavailableResponse);
    expect(mocks.readDocumentFile).toHaveBeenCalledExactlyOnceWith(wrongPath);
  });

  it("returns the same verified read without reading the path a second time", async () => {
    const fixture = await registerDocument("one-read-only");
    const originalRead = Buffer.from(fixture.bytes);
    mocks.readDocumentFile.mockResolvedValueOnce(originalRead).mockResolvedValueOnce(Buffer.from("DEMO ONLY — later drift"));
    const file = await getKnowledgeDocumentFile({ documentId: fixture.documentId });
    expect(file?.bytes).toBe(originalRead);
    expect(mocks.readDocumentFile).toHaveBeenCalledExactlyOnceWith(fixture.storagePath);
  });

  it.each([
    { name: "NUL text", bytes: Buffer.from("DEMO ONLY — failed body before\0after"), fileName: "nul.txt", mimeType: "text/plain" },
    { name: "invalid UTF-8", bytes: Buffer.from([0xc3, 0x28, 0xff]), fileName: "invalid.txt", mimeType: "text/plain" },
    { name: "unsupported format", bytes: Buffer.from("DEMO ONLY — unsupported binary original\0"), fileName: "demo.bin", mimeType: "application/octet-stream" },
  ])("retains exact original downloads for failed $name documents", async ({ name, ...options }) => {
    const fixture = await registerDocument(name, options);
    expect(fixture.result).toMatchObject({ status: "failed", document: { chunkCount: 0 } });
    const response = await download(fixture.documentId);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(fixture.bytes);
    expect(mocks.readDocumentFile).toHaveBeenCalledExactlyOnceWith(fixture.storagePath);
  });

  it("keeps filename and MIME fallbacks without changing verified bytes", async () => {
    const fixture = await registerDocument("missing-descriptors");
    await testDatabase.database.update(documents).set({ originalFilename: null, mimeType: null }).where(eq(documents.id, fixture.documentId));
    const response = await download(fixture.documentId);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("content-disposition")).toBe("attachment; filename*=UTF-8''document.txt");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(fixture.bytes);
  });

  it("keeps missing documents and missing storage paths as 404 without a file read", async () => {
    const fixture = await registerDocument("missing-path");
    await testDatabase.database.update(documents).set({ storagePath: null }).where(eq(documents.id, fixture.documentId));
    for (const documentId of [fixture.documentId, "10000000-0000-4000-8000-000000000001"]) {
      const response = await download(documentId);
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "NOT_FOUND" } });
    }
    expect(mocks.readDocumentFile).not.toHaveBeenCalled();
  });

  it("sanitizes read failures without changing document, chunk, source, draft or audit state", async () => {
    const fixture = await registerDocument("read-error");
    const before = await snapshot(fixture.documentId);
    const error = new Error(`Fictional private path /private/demo/${fixture.storagePath} with ${fixture.bytes.toString("hex")}`);
    error.name = error.message;
    mocks.readDocumentFile.mockRejectedValue(error);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await download(fixture.documentId);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual(unavailableResponse);
    expect(log.mock.calls).toEqual([["Knowledge download route failed", { errorCode: "Error" }]]);
    expect(await snapshot(fixture.documentId)).toEqual(before);
  });

  it("rejects invalid IDs before repository or storage access", async () => {
    const response = await download("not-a-document-id");
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_INPUT" } });
    expect(mocks.getDemoDatabase).not.toHaveBeenCalled();
    expect(mocks.readDocumentFile).not.toHaveBeenCalled();
  });

  it("remains developer-only in production before repository or storage access", async () => {
    mocks.nodeEnv = "production";
    const response = await download("10000000-0000-4000-8000-000000000001");
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "DEVELOPER_ONLY" } });
    expect(mocks.getDemoDatabase).not.toHaveBeenCalled();
    expect(mocks.readDocumentFile).not.toHaveBeenCalled();
  });
});
