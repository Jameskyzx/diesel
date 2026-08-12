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
    const stored = await storage.readDocumentFile(paths[0]!);
    const files = await readdir(
      resolve(process.cwd(), ".data", storageRoot, contentSha256),
    );

    expect(new Set(paths).size).toBe(1);
    expect(paths[0]).toBe(`${contentSha256}/content`);
    expect(stored.equals(Buffer.from(bytes))).toBe(true);
    expect(files).toEqual(["content"]);
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
});
