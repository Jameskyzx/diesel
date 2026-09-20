import {
  MAX_CHAT_ATTACHMENT_BYTES,
  MAX_CHAT_ATTACHMENT_FILENAME_CHARACTERS,
  MAX_CHAT_ATTACHMENTS,
  MAX_CHAT_ATTACHMENTS_TOTAL_BYTES,
  normalizeChatAttachmentFilename,
} from "@/features/ai/attachments";
import {
  MAX_CHAT_IMAGE_DIMENSION,
  MAX_CHAT_IMAGE_PIXELS,
  MIN_CHAT_IMAGE_DIMENSION,
} from "@/features/ai/image-attachments";
import type { Dictionary } from "@/i18n/dictionaries";
import type { Locale } from "@/i18n/locale";

export type ChatAttachmentErrorDescriptor =
  | { kind: "attachment_read_failed" }
  | { kind: "empty_file"; name: string }
  | { kind: "file_too_large"; maxBytes: number; name: string }
  | {
      kind: "image_invalid";
      maxDimension: number;
      maxPixels: number;
      minDimension: number;
      name: string;
    }
  | { kind: "image_model_unavailable" }
  | { kind: "image_read_failed"; name: string }
  | { kind: "invalid_filename"; maxCharacters: number }
  | { kind: "too_many_attachments"; maxAttachments: number }
  | { kind: "total_too_large"; maxBytes: number }
  | { kind: "unsupported_file"; name: string };

export type ChatAttachmentValidationInput = {
  file: {
    name: string;
    size: number;
  };
};

type AttachmentTemplateValue = number | string;

function interpolateAttachmentTemplate(
  template: string,
  values: Readonly<Record<string, AttachmentTemplateValue>>,
): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/gu, (placeholder, key) =>
    Object.hasOwn(values, key) ? String(values[key]) : placeholder,
  );
}

function assertNever(value: never): never {
  void value;
  throw new Error("Unhandled chat attachment error descriptor.");
}

function formatAttachmentByteLimit(bytes: number, locale: Locale): string {
  const formatter = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
  });
  if (bytes < 1024) {
    return `${formatter.format(bytes)} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${formatter.format(bytes / 1024)} KiB`;
  }
  return `${formatter.format(bytes / (1024 * 1024))} MiB`;
}

/**
 * Returns stable, non-localized attachment error facts. The UI formats these
 * facts on every render so a retained error always follows the active locale.
 */
export function validateChatAttachments(
  attachments: readonly ChatAttachmentValidationInput[],
): ChatAttachmentErrorDescriptor | null {
  if (attachments.length > MAX_CHAT_ATTACHMENTS) {
    return {
      kind: "too_many_attachments",
      maxAttachments: MAX_CHAT_ATTACHMENTS,
    };
  }

  for (const { file } of attachments) {
    const filename = normalizeChatAttachmentFilename(file.name);
    if (
      !filename ||
      filename.length > MAX_CHAT_ATTACHMENT_FILENAME_CHARACTERS ||
      /[\u0000-\u001f\u007f/\\]/u.test(filename)
    ) {
      return {
        kind: "invalid_filename",
        maxCharacters: MAX_CHAT_ATTACHMENT_FILENAME_CHARACTERS,
      };
    }
    if (file.size === 0) {
      return { kind: "empty_file", name: filename };
    }
    if (file.size > MAX_CHAT_ATTACHMENT_BYTES) {
      return {
        kind: "file_too_large",
        maxBytes: MAX_CHAT_ATTACHMENT_BYTES,
        name: filename,
      };
    }
  }

  const totalBytes = attachments.reduce(
    (total, attachment) => total + attachment.file.size,
    0,
  );
  if (totalBytes > MAX_CHAT_ATTACHMENTS_TOTAL_BYTES) {
    return {
      kind: "total_too_large",
      maxBytes: MAX_CHAT_ATTACHMENTS_TOTAL_BYTES,
    };
  }

  return null;
}

export function imageInvalidAttachmentError(
  name: string,
): ChatAttachmentErrorDescriptor {
  return {
    kind: "image_invalid",
    maxDimension: MAX_CHAT_IMAGE_DIMENSION,
    maxPixels: MAX_CHAT_IMAGE_PIXELS,
    minDimension: MIN_CHAT_IMAGE_DIMENSION,
    name,
  };
}

/**
 * Formats only the closed attachment-error union. It never accepts or renders
 * an Error instance, provider detail, or FileReader error message.
 */
export function formatChatAttachmentError(
  error: ChatAttachmentErrorDescriptor,
  dictionary: Dictionary,
  locale: Locale,
): string {
  const copy = dictionary.chat;

  switch (error.kind) {
    case "attachment_read_failed":
      return copy.attachmentReadError;
    case "empty_file":
      return interpolateAttachmentTemplate(copy.emptyFile, {
        name: error.name,
      });
    case "file_too_large":
      return interpolateAttachmentTemplate(copy.fileTooLarge, {
        max: formatAttachmentByteLimit(error.maxBytes, locale),
        name: error.name,
      });
    case "image_invalid":
      return interpolateAttachmentTemplate(copy.imageInvalid, {
        max: error.maxDimension.toLocaleString(locale),
        min: error.minDimension.toLocaleString(locale),
        name: error.name,
        pixels: error.maxPixels.toLocaleString(locale),
      });
    case "image_model_unavailable":
      return copy.imageModelUnavailable;
    case "image_read_failed":
      return interpolateAttachmentTemplate(copy.imageReadError, {
        name: error.name,
      });
    case "invalid_filename":
      return interpolateAttachmentTemplate(copy.invalidFilename, {
        max: error.maxCharacters.toLocaleString(locale),
      });
    case "too_many_attachments":
      return interpolateAttachmentTemplate(copy.maxAttachments, {
        max: error.maxAttachments.toLocaleString(locale),
      });
    case "total_too_large":
      return interpolateAttachmentTemplate(copy.totalTooLarge, {
        max: formatAttachmentByteLimit(error.maxBytes, locale),
      });
    case "unsupported_file":
      return interpolateAttachmentTemplate(copy.unsupportedFile, {
        name: error.name,
      });
    default:
      return assertNever(error);
  }
}
