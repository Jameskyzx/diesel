import { randomUUID } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { sha256 } from "@/server/knowledge/document-file";

type StorageModule = typeof import("@/server/knowledge/local-document-storage");

const storageRoot = `test-knowledge-${randomUUID()}`;
let storage: StorageModule;

beforeAll(async () => {
  vi.stubEnv("KNOWLEDGE_STORAGE_ROOT", storageRoot);
  vi.resetModules();
  storage = await import("@/server/knowledge/local-document-storage");
});

afterAll(async () => {
  await rm(resolve(process.cwd(), ".data", storageRoot), {
    force: true,
    recursive: true,
  });
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("local document storage", () => {
  it("atomically reuses one content-addressed file under concurrent writes", async () => {
    const bytes = new TextEncoder().encode("concurrent document content");
    const contentSha256 = sha256(bytes);

    const paths = await Promise.all(
      Array.from({ length: 4 }, () =>
        storage.saveDocumentFile({ bytes, contentSha256 }),
      ),
    );
    const storagePaths = paths.map(({ storagePath }) => storagePath);
    const stored = await storage.readDocumentFile(storagePaths[0]!);
    const files = await readdir(
      resolve(process.cwd(), ".data", storageRoot, contentSha256),
    );

    expect(new Set(storagePaths).size).toBe(1);
    expect(storagePaths[0]).toBe(`${contentSha256}/content`);
    expect(paths.filter(({ created }) => created)).toHaveLength(1);
    expect(stored.equals(Buffer.from(bytes))).toBe(true);
    expect(files).toEqual(["content"]);
    await storage.removeDocumentFile(storagePaths[0]!);
  });

  it("rejects bytes that do not match the requested hash", async () => {
    const bytes = new TextEncoder().encode("mismatched document content");

    await expect(
      storage.saveDocumentFile({
        bytes,
        contentSha256: "f".repeat(64),
      }),
    ).rejects.toThrow("content hash");
  });

  it("keeps a reused file while a concurrent database writer is still committing", async () => {
    const bytes = new TextEncoder().encode("interleaved database writers");
    const contentSha256 = sha256(bytes);

    // Request A wins the atomic file creation. Request B observes and reuses
    // it before either request has committed its database row.
    const requestA = await storage.saveDocumentFile({
      bytes,
      contentSha256,
    });
    const requestB = await storage.saveDocumentFile({
      bytes,
      contentSha256,
    });
    expect(requestA.created).toBe(true);
    expect(requestB).toEqual({
      created: false,
      storagePath: requestA.storagePath,
    });

    // A's DB insert fails and deliberately performs no immediate unlink. B
    // then commits the reference, so the age-gated orphan scan must preserve
    // the shared content rather than leave B pointing at a missing file.
    const referencedStoragePaths = new Set([requestB.storagePath]);
    await expect(
      storage.findOrphanedDocumentFiles({
        minimumAgeMs: 0,
        nowMs: Date.now() + 1_000,
        referencedStoragePaths,
      }),
    ).resolves.toEqual([]);
    await expect(
      storage.readDocumentFile(requestB.storagePath),
    ).resolves.toEqual(Buffer.from(bytes));

    await storage.removeDocumentFile(requestB.storagePath);
  });

  it("finds only unreferenced content-addressed files and removes them safely", async () => {
    const referencedBytes = new TextEncoder().encode("referenced document");
    const orphanedBytes = new TextEncoder().encode("orphaned document");
    const referenced = await storage.saveDocumentFile({
      bytes: referencedBytes,
      contentSha256: sha256(referencedBytes),
    });
    const orphaned = await storage.saveDocumentFile({
      bytes: orphanedBytes,
      contentSha256: sha256(orphanedBytes),
    });

    await expect(
      storage.findOrphanedDocumentFiles({
        minimumAgeMs: 0,
        nowMs: Date.now() + 1_000,
        referencedStoragePaths: new Set([referenced.storagePath]),
      }),
    ).resolves.toEqual([orphaned.storagePath]);

    await storage.removeDocumentFile(orphaned.storagePath);
    await expect(storage.readDocumentFile(orphaned.storagePath)).rejects.toThrow();
    await expect(storage.readDocumentFile(referenced.storagePath)).resolves.toEqual(
      Buffer.from(referencedBytes),
    );
    await expect(storage.removeDocumentFile("../outside/content")).rejects.toThrow(
      "content-addressed",
    );
  });
});
