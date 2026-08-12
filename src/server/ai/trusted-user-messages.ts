import "server-only";

import { Buffer } from "node:buffer";
import { z } from "zod";

import {
  CHAT_ATTACHMENT_MEDIA_TYPES,
  MAX_CHAT_ATTACHMENT_BYTES,
  MAX_CHAT_ATTACHMENT_FILENAME_CHARACTERS,
  MAX_CHAT_ATTACHMENTS,
  MAX_CHAT_ATTACHMENTS_TOTAL_BYTES,
} from "@/features/ai/attachments";
import { hasStructurallyValidChatImage } from "@/features/ai/image-attachments";
import { MAX_CHAT_USER_MESSAGE_CHARACTERS } from "@/features/ai/constants";

export const trustedUserTextPartSchema = z
  .object({
    text: z.string(),
    type: z.literal("text"),
  })
  .strict();

const base64Pattern = /^[A-Za-z0-9+/]*={0,2}$/;

function decodedBase64Bytes(value: string): number | null {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !base64Pattern.test(value)
  ) {
    return null;
  }

  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

function hasValidAttachmentContent(
  mediaType: (typeof CHAT_ATTACHMENT_MEDIA_TYPES)[number],
  base64: string,
): boolean {
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(Buffer.from(base64, "base64"));
  } catch {
    return false;
  }

  if (mediaType === "image/png") {
    return hasStructurallyValidChatImage(mediaType, bytes);
  }
  if (mediaType === "image/jpeg") {
    return hasStructurallyValidChatImage(mediaType, bytes);
  }
  if (mediaType === "image/webp") {
    return hasStructurallyValidChatImage(mediaType, bytes);
  }
  if (mediaType === "application/pdf") {
    return hasPrefix(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
  }

  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export const trustedUserFilePartSchema = z
  .object({
    filename: z
      .string()
      .trim()
      .min(1)
      .max(MAX_CHAT_ATTACHMENT_FILENAME_CHARACTERS)
      .regex(/^[^\u0000-\u001f\u007f/\\]+$/u),
    mediaType: z.enum(CHAT_ATTACHMENT_MEDIA_TYPES),
    type: z.literal("file"),
    url: z.string(),
  })
  .strict()
  .superRefine((part, context) => {
    const prefix = `data:${part.mediaType};base64,`;
    if (!part.url.startsWith(prefix)) {
      context.addIssue({
        code: "custom",
        message: "Attachment must be an inline data URL matching its media type.",
        path: ["url"],
      });
      return;
    }

    const base64 = part.url.slice(prefix.length);
    const bytes = decodedBase64Bytes(base64);
    if (bytes === null || bytes === 0 || bytes > MAX_CHAT_ATTACHMENT_BYTES) {
      context.addIssue({
        code: "custom",
        message: "Attachment data is invalid, empty, or too large.",
        path: ["url"],
      });
      return;
    }

    if (!hasValidAttachmentContent(part.mediaType, base64)) {
      context.addIssue({
        code: "custom",
        message: "Attachment bytes do not match the declared media type.",
        path: ["url"],
      });
    }
  });

export type TrustedUserFilePart = z.infer<typeof trustedUserFilePartSchema>;

export const trustedUserPartSchema = z.union([
  trustedUserTextPartSchema,
  trustedUserFilePartSchema,
]);

export type TrustedUserPart = z.infer<typeof trustedUserPartSchema>;

export type TrustedUserMessage = {
  id: string;
  parts: TrustedUserPart[];
  role: "user";
};

export function selectTrustedUserMessages<
  TMessage extends { parts: readonly unknown[]; role: string },
>(messages: readonly TMessage[]): TMessage[] | null {
  const userMessages = messages.filter(({ role }) => role === "user");
  if (userMessages.length === 0 || messages.at(-1)?.role !== "user") {
    return null;
  }

  for (const [messageIndex, message] of userMessages.entries()) {
    const isLatestUserMessage = messageIndex === userMessages.length - 1;
    const parts = z
      .array(
        isLatestUserMessage
          ? trustedUserPartSchema
          : trustedUserTextPartSchema,
      )
      .min(1)
      .safeParse(message.parts);
    if (!parts.success) {
      return null;
    }

    const text = parts.data
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");
    if (!text.trim() || text.length > MAX_CHAT_USER_MESSAGE_CHARACTERS) {
      return null;
    }

    if (isLatestUserMessage) {
      const attachments = parts.data.filter((part) => part.type === "file");
      if (attachments.length > MAX_CHAT_ATTACHMENTS) {
        return null;
      }

      const totalBytes = attachments.reduce((total, attachment) => {
        const prefix = `data:${attachment.mediaType};base64,`;
        return (
          total +
          (decodedBase64Bytes(attachment.url.slice(prefix.length)) ??
            MAX_CHAT_ATTACHMENTS_TOTAL_BYTES + 1)
        );
      }, 0);
      if (totalBytes > MAX_CHAT_ATTACHMENTS_TOTAL_BYTES) {
        return null;
      }
    }
  }

  return userMessages;
}
