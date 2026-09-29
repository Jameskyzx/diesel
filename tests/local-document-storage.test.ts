import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { sha256 } from "@/server/knowledge/document-file";

type StorageModule = typeof import("@/server/knowledge/local-document-storage");

const execFileAsync = promisify(execFile);
const storageRoot = `test-knowledge-${randomUUID()}`;
let storage: StorageModule;

beforeAll(async () => {
  vi.stubEnv("KNOWLEDGE_STORAGE_ROOT", storageRoot);
  vi.resetModules();
  storage = await import("@/server/knowledge/local-document-storage");
});

afterEach(async () => {
  await rm(resolve(process.cwd(), ".data", storageRoot), {
    force: true,
    recursive: true,
  });
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
  it("rejects a real named pipe without waiting for a writer", async () => {
    const root = resolve(process.cwd(), ".data", storageRoot);
    await mkdir(root, { recursive: true });
    await execFileAsync("/usr/bin/mkfifo", [resolve(root, "fictional-pipe")]);
    const script = `
      import("./src/server/knowledge/local-document-storage.ts").then(async ({ readDocumentFile }) => {
        try {
          await readDocumentFile("fictional-pipe");
          process.exitCode = 2;
        } catch (error) {
          if (error instanceof Error && error.message === "A stored document must be a regular file.") {
            console.log("NON_REGULAR_FILE_REJECTED");
          } else {
            process.exitCode = 3;
          }
        }
      });
    `;
    // A separate child gives this kernel-level regression a real termination
    // bound if nonblocking open is ever removed and the FIFO read hangs.
    const result = await execFileAsync(process.execPath, [
      "--conditions=react-server", "--import", "tsx", "-e", script,
    ], {
      cwd: process.cwd(),
      env: { ...process.env, KNOWLEDGE_STORAGE_ROOT: storageRoot },
      maxBuffer: 64 * 1024,
      timeout: 5_000,
    });
    expect(result.stdout.trim()).toBe("NON_REGULAR_FILE_REJECTED");
  }, 10_000);

  it("preserves exact bytes at the existing 5 MiB document boundary", async () => {
    const bytes = Buffer.alloc(5 * 1024 * 1024, 0x61);
    const contentSha256 = sha256(bytes);
    const saved = await storage.saveDocumentFile({ bytes, contentSha256 });

    const stored = await storage.readDocumentFile(saved.storagePath);
    expect(stored.length).toBe(bytes.length);
    expect(stored.equals(bytes)).toBe(true);
    await expect(storage.saveDocumentFile({ bytes, contentSha256 })).resolves.toEqual({
      created: false, storagePath: saved.storagePath,
    });
  });

  it("rejects oversized direct storage writes before creating the hash directory", async () => {
    const bytes = Buffer.alloc(5 * 1024 * 1024 + 1, 0x62);
    const contentSha256 = sha256(bytes);

    await expect(storage.saveDocumentFile({ bytes, contentSha256 })).rejects.toThrow("5 MiB");
    await expect(readdir(resolve(process.cwd(), ".data", storageRoot, contentSha256))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects an oversized stored original on both reads and reuse without repairing it", async () => {
    const bytes = Buffer.from("DEMO ONLY — a bounded original that later grows");
    const contentSha256 = sha256(bytes);
    const saved = await storage.saveDocumentFile({ bytes, contentSha256 });
    const target = resolve(process.cwd(), ".data", storageRoot, saved.storagePath);
    const file = await open(target, "r+");
    try {
      await file.truncate(5 * 1024 * 1024 + 1);
    } finally {
      await file.close();
    }

    await expect(storage.readDocumentFile(saved.storagePath).then(() => undefined)).rejects.toThrow("5 MiB");
    await expect(storage.saveDocumentFile({ bytes, contentSha256 })).rejects.toThrow("5 MiB");
    expect((await stat(target)).size).toBe(5 * 1024 * 1024 + 1);
    expect(await readdir(resolve(process.cwd(), ".data", storageRoot, contentSha256))).toEqual(["content"]);
  });

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
