import "server-only";

import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import { env } from "@/env";
import { sha256 } from "@/server/knowledge/document-file";

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

export async function saveDocumentFile(input: {
  bytes: Uint8Array;
  contentSha256: string;
}): Promise<string> {
  if (sha256(input.bytes) !== input.contentSha256) {
    throw new Error("Document bytes do not match the requested content hash.");
  }

  const root = resolveStorageRoot();
  const storagePath = `${input.contentSha256}/content`;
  const target = resolve(root, storagePath);
  assertInsideStorageRoot(root, target);
  await mkdir(dirname(target), { recursive: true });

  try {
    const existing = await readFile(target);
    if (sha256(existing) !== input.contentSha256) {
      throw new Error("Stored file hash does not match the requested document.");
    }
    return storagePath.replaceAll("\\", "/");
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
  try {
    await writeFile(temporaryTarget, input.bytes, { flag: "wx" });
    await rename(temporaryTarget, target);
  } catch (error: unknown) {
    try {
      await unlink(temporaryTarget);
    } catch {
      // Preserve the original storage failure.
    }
    throw error;
  }

  const stored = await readFile(target);
  if (sha256(stored) !== input.contentSha256) {
    throw new Error("Stored file hash does not match the requested document.");
  }

  return storagePath.replaceAll("\\", "/");
}

export async function readDocumentFile(storagePath: string): Promise<Buffer> {
  const root = resolveStorageRoot();
  const target = resolve(root, storagePath);
  assertInsideStorageRoot(root, target);
  await access(target, constants.R_OK);
  return readFile(target);
}
