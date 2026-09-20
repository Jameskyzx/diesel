import "server-only";

import { createHash } from "node:crypto";

export const MAX_KNOWLEDGE_DOCUMENT_BYTES = 5 * 1024 * 1024;

export class DocumentProcessingError extends Error {
  constructor(
    readonly code: "EMPTY_TEXT" | "UNSUPPORTED_FILE" | "INVALID_UTF8" | "UNSUPPORTED_TEXT",
    message: string,
  ) {
    super(message);
    this.name = "DocumentProcessingError";
  }
}

export function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function extractUtf8Text(input: {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
}): string {
  const normalizedName = input.fileName.toLocaleLowerCase("en");
  const supportedExtension =
    normalizedName.endsWith(".txt") ||
    normalizedName.endsWith(".md") ||
    normalizedName.endsWith(".markdown");
  const supportedMimeType = [
    "application/octet-stream",
    "text/markdown",
    "text/plain",
  ].includes(input.mimeType);

  if (!supportedExtension || !supportedMimeType) {
    throw new DocumentProcessingError(
      "UNSUPPORTED_FILE",
      "当前最小版本仅支持 UTF-8 TXT、MD 和 Markdown 文件。",
    );
  }

  let text: string;

  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
  } catch {
    throw new DocumentProcessingError(
      "INVALID_UTF8",
      "文件不是有效的 UTF-8 文本。",
    );
  }

  if (text.includes("\0")) {
    throw new DocumentProcessingError(
      "UNSUPPORTED_TEXT",
      "UTF-8 文本包含空字符（U+0000），无法保存为文档正文；请核对源文件。",
    );
  }

  // Form-feed is whitespace to trim(), but it carries source page boundaries.
  // Use trimming only to test emptiness; pass source layout to the chunker.
  const normalizedText = text.replace(/^\uFEFF/, "");

  if (!normalizedText.trim()) {
    throw new DocumentProcessingError(
      "EMPTY_TEXT",
      "文件没有可提取的文本内容。",
    );
  }

  return normalizedText;
}
