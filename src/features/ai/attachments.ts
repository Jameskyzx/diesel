export const CHAT_ATTACHMENT_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
] as const;

export type ChatAttachmentMediaType =
  (typeof CHAT_ATTACHMENT_MEDIA_TYPES)[number];

export const CHAT_ATTACHMENT_ACCEPT = [
  ...CHAT_ATTACHMENT_MEDIA_TYPES,
  ".md",
].join(",");

export const CHAT_DOCUMENT_ATTACHMENT_ACCEPT = [
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  ".md",
].join(",");

export const MAX_CHAT_ATTACHMENTS = 4;
export const MAX_CHAT_ATTACHMENT_BYTES = 3 * 1024 * 1024;
export const MAX_CHAT_ATTACHMENTS_TOTAL_BYTES = 6 * 1024 * 1024;
export const MAX_CHAT_ATTACHMENT_FILENAME_CHARACTERS = 120;
export const MAX_CHAT_ATTACHMENT_TEXT_CHARACTERS = 30_000;
export const MAX_CHAT_ATTACHMENTS_TOTAL_TEXT_CHARACTERS = 40_000;
export const MAX_CHAT_PDF_PAGES = 40;
export const CHAT_ATTACHMENT_PROCESSING_TIMEOUT_MS = 15_000;

const CHAT_ATTACHMENT_MEDIA_TYPE_SET = new Set<string>(
  CHAT_ATTACHMENT_MEDIA_TYPES,
);

const EXTENSION_MEDIA_TYPES: Readonly<Record<string, ChatAttachmentMediaType>> =
  {
    ".csv": "text/csv",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".md": "text/markdown",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".txt": "text/plain",
    ".webp": "image/webp",
  };

export function isChatAttachmentMediaType(
  value: string,
): value is ChatAttachmentMediaType {
  return CHAT_ATTACHMENT_MEDIA_TYPE_SET.has(value.toLowerCase());
}

export function resolveChatAttachmentMediaType(file: {
  name: string;
  type: string;
}): ChatAttachmentMediaType | null {
  const declaredType = file.type.trim().toLowerCase();
  if (isChatAttachmentMediaType(declaredType)) {
    return declaredType;
  }
  if (declaredType && declaredType !== "application/octet-stream") {
    return null;
  }

  const normalizedName = file.name.trim().toLowerCase();
  const extension = Object.keys(EXTENSION_MEDIA_TYPES).find((candidate) =>
    normalizedName.endsWith(candidate),
  );
  return extension ? EXTENSION_MEDIA_TYPES[extension] : null;
}

export function formatChatAttachmentBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
