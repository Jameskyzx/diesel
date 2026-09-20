import "server-only";

import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  link,
  mkdir,
  open,
  readdir,
  rmdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import { env } from "@/env";
import {
  MAX_KNOWLEDGE_DOCUMENT_BYTES,
  sha256,
} from "@/server/knowledge/document-file";

function resolveStorageRoot(): string {
  return resolve(process.cwd(), ".data", env.KNOWLEDGE_STORAGE_ROOT);
}

function assertInsideStorageRoot(root: string, target: string): void {
  const relativePath = relative(root, target);

  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    resolve(target) === resolve(root)
  ) {
    throw new Error("Document storage path is outside the configured root.");
  }
}

export type SavedDocumentFile = {
  created: boolean;
  storagePath: string;
};

const contentStoragePathPattern = /^[0-9a-f]{64}\/content$/;

function assertDocumentByteLimit(byteLength: number): void {
  if (byteLength > MAX_KNOWLEDGE_DOCUMENT_BYTES) {
    throw new Error("Document files must not exceed 5 MiB.");
  }
}

async function readBoundedDocumentFile(target: string): Promise<Buffer> {
  // Nonblocking open lets us reject a FIFO before waiting for a writer.
  const file = await open(target, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const metadata = await file.stat();
    if (!metadata.isFile()) {
      throw new Error("A stored document must be a regular file.");
    }
    assertDocumentByteLimit(metadata.size);

    // Stat is only a fast precheck: a file may grow before or during reads.
    // Each working buffer holds at most the payload limit plus one overflow byte.
    const readLimit = MAX_KNOWLEDGE_DOCUMENT_BYTES + 1;
    let buffer = Buffer.alloc(
      Math.min(readLimit, Math.max(64 * 1024, metadata.size + 1)),
    );
    let length = 0;
    while (true) {
      if (length === buffer.length) {
        const grown = Buffer.alloc(Math.min(readLimit, buffer.length * 2));
        buffer.copy(grown, 0, 0, length);
        buffer = grown;
      }
      const { bytesRead } = await file.read(
        buffer,
        length,
        buffer.length - length,
        length,
      );
      if (bytesRead === 0) {
        return Buffer.from(buffer.subarray(0, length));
      }
      length += bytesRead;
      assertDocumentByteLimit(length);
    }
  } finally {
    await file.close();
  }
}

export async function saveDocumentFile(input: {
  bytes: Uint8Array;
  contentSha256: string;
}): Promise<SavedDocumentFile> {
  assertDocumentByteLimit(input.bytes.byteLength);
  if (sha256(input.bytes) !== input.contentSha256) {
    throw new Error("Document bytes do not match the requested content hash.");
  }

  const root = resolveStorageRoot();
  const storagePath = `${input.contentSha256}/content`;
  const target = resolve(root, storagePath);
  assertInsideStorageRoot(root, target);
  await mkdir(dirname(target), { recursive: true });

  try {
    const existing = await readBoundedDocumentFile(target);
    if (sha256(existing) !== input.contentSha256) {
      throw new Error("Stored file hash does not match the requested document.");
    }
    return {
      created: false,
      storagePath: storagePath.replaceAll("\\", "/"),
    };
  } catch (error: unknown) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";

    if (code !== "ENOENT") {
      throw error;
    }
  }

  const temporaryTarget = `${target}.${randomUUID()}.tmp`;
  let created = false;
  try {
    await writeFile(temporaryTarget, input.bytes, { flag: "wx" });
    try {
      await link(temporaryTarget, target);
      created = true;
    } catch (error: unknown) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "";
      if (code !== "EEXIST") {
        throw error;
      }
    }
  } catch (error: unknown) {
    try {
      await unlink(temporaryTarget);
    } catch {
      // Preserve the original storage failure.
    }
    throw error;
  }
  await unlink(temporaryTarget);

  const stored = await readBoundedDocumentFile(target);
  if (sha256(stored) !== input.contentSha256) {
    throw new Error("Stored file hash does not match the requested document.");
  }

  return {
    created,
    storagePath: storagePath.replaceAll("\\", "/"),
  };
}

export async function readDocumentFile(storagePath: string): Promise<Buffer> {
  const root = resolveStorageRoot();
  const target = resolve(root, storagePath);
  assertInsideStorageRoot(root, target);
  return readBoundedDocumentFile(target);
}

export async function removeDocumentFile(storagePath: string): Promise<void> {
  if (!contentStoragePathPattern.test(storagePath)) {
    throw new Error("Only content-addressed document files can be removed.");
  }

  const root = resolveStorageRoot();
  const target = resolve(root, storagePath);
  assertInsideStorageRoot(root, target);
  await unlink(target);
  await rmdir(dirname(target));
}

export async function findOrphanedDocumentFiles(input: {
  minimumAgeMs: number;
  referencedStoragePaths: ReadonlySet<string>;
  nowMs?: number;
}): Promise<string[]> {
  if (!Number.isFinite(input.minimumAgeMs) || input.minimumAgeMs < 0) {
    throw new Error("minimumAgeMs must be a finite nonnegative number.");
  }

  const root = resolveStorageRoot();
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error: unknown) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
    if (code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const nowMs = input.nowMs ?? Date.now();
  const orphaned: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[0-9a-f]{64}$/.test(entry.name)) {
      continue;
    }
    const storagePath = `${entry.name}/content`;
    if (input.referencedStoragePaths.has(storagePath)) {
      continue;
    }
    const target = resolve(root, storagePath);
    assertInsideStorageRoot(root, target);
    try {
      const metadata = await stat(target);
      if (nowMs - metadata.mtimeMs >= input.minimumAgeMs) {
        orphaned.push(storagePath);
      }
    } catch (error: unknown) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "";
      if (code !== "ENOENT") {
        throw error;
      }
    }
  }

  return orphaned.sort();
}
