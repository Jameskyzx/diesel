import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

import { z } from "zod";

export const retainedLicenseArchiveMaxBytes = 8 * 1024 * 1024;
const maxInflatedBytes = 24 * 1024 * 1024;
const maxFileBytes = 2 * 1024 * 1024;
const maxTotalFileBytes = 16 * 1024 * 1024;
const maxBase64Characters = Math.ceil(maxFileBytes / 3) * 4;
const fileCount = 810;

const relativePathSchema = z.string().min(1).max(500).regex(/^[\x20-\x7e]+$/u)
  .refine((path) =>
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !/^[A-Za-z]:/u.test(path) &&
    path.split("/").every((segment) =>
      segment !== "" && segment !== "." && segment !== ".."
    ),
  "Archive paths must be normalized ASCII relative paths.");

const archiveSchema = z.object({
  schemaVersion: z.literal("diesel-history-license-raw-archive-v1"),
  totalByteLength: z.number().int().nonnegative().max(maxTotalFileBytes),
  files: z.array(z.object({
    path: relativePathSchema,
    byteLength: z.number().int().nonnegative().max(maxFileBytes),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    base64: z.string().max(maxBase64Characters),
  }).strict()).length(fileCount),
}).strict();

/**
 * Decodes bounded, inert evidence bytes only. The caller must verify the
 * expected archive and separately verify its records; this is not a license
 * approval, execution replay, filesystem extraction, or source attestation.
 */
export function decodeRetainedLicenseArchive(
  bytes: Uint8Array,
): ReadonlyMap<string, Uint8Array> {
  if (bytes.byteLength === 0 || bytes.byteLength > retainedLicenseArchiveMaxBytes) {
    throw new Error("Retained license archive exceeds its compressed byte limit or is empty.");
  }

  let value: unknown;
  try {
    const inflated = gunzipSync(bytes, { maxOutputLength: maxInflatedBytes });
    const text = new TextDecoder("utf-8", { fatal: true }).decode(inflated);
    value = JSON.parse(text) as unknown;
  } catch (cause: unknown) {
    throw new Error("Retained license archive is not bounded gzip UTF-8 JSON.", { cause });
  }
  const archive = archiveSchema.parse(value);
  const files = new Map<string, Uint8Array>();
  let totalByteLength = 0;
  for (const file of archive.files) {
    if (files.has(file.path)) {
      throw new Error("Retained license archive contains a duplicate path.");
    }
    totalByteLength += file.byteLength;
    if (totalByteLength > maxTotalFileBytes) {
      throw new Error("Retained license archive exceeds its aggregate decoded byte limit.");
    }
    const decoded = Buffer.from(file.base64, "base64");
    if (decoded.toString("base64") !== file.base64) {
      throw new Error("Retained license archive contains non-canonical base64.");
    }
    if (
      decoded.byteLength !== file.byteLength ||
      createHash("sha256").update(decoded).digest("hex") !== file.sha256
    ) {
      throw new Error("Retained license archive file bytes differ from their descriptor.");
    }
    files.set(file.path, decoded);
  }
  if (totalByteLength !== archive.totalByteLength) {
    throw new Error("Retained license archive total byte length does not match its files.");
  }
  return files;
}
