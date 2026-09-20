import type { FileUIPart, UIMessage } from "ai";
import { z } from "zod";

import {
  MAX_CHAT_ATTACHMENT_FILENAME_CHARACTERS,
  normalizeChatAttachmentFilename,
} from "@/features/ai/attachments";
import {
  MAX_CHAT_HISTORY_TEXT_CHARACTERS,
  MAX_CHAT_HISTORY_USER_MESSAGES,
  MAX_CHAT_USER_MESSAGE_CHARACTERS,
} from "@/features/ai/constants";
import { interpolate, type Dictionary } from "@/i18n/dictionaries";

const releasedAttachmentDataSchema = z
  .object({
    filename: z
      .string()
      .trim()
      .min(1)
      .max(MAX_CHAT_ATTACHMENT_FILENAME_CHARACTERS)
      .regex(/^[^\u0000-\u001f\u007f/\\]+$/u)
      .nullable(),
  })
  .strict();

export type ReleasedAttachmentData = z.infer<
  typeof releasedAttachmentDataSchema
>;

export type SalesChatDataParts = {
  releasedAttachment: ReleasedAttachmentData;
};

export type SalesChatUiMessage = UIMessage<unknown, SalesChatDataParts>;

export type ReleasedAttachmentPart = Extract<
  SalesChatUiMessage["parts"][number],
  { type: "data-releasedAttachment" }
>;

export function releasedAttachmentPart(
  file: Pick<FileUIPart, "filename">,
): ReleasedAttachmentPart {
  const parsed = releasedAttachmentDataSchema.safeParse({
    filename: file.filename
      ? normalizeChatAttachmentFilename(file.filename) || null
      : null,
  });

  return {
    data: parsed.success ? parsed.data : { filename: null },
    type: "data-releasedAttachment",
  };
}

export function parseReleasedAttachmentPart(
  part: SalesChatUiMessage["parts"][number],
): ReleasedAttachmentData | null {
  if (part.type !== "data-releasedAttachment") {
    return null;
  }

  const parsed = releasedAttachmentDataSchema.safeParse(part.data);
  return parsed.success ? parsed.data : null;
}

export function formatReleasedAttachment(
  attachment: ReleasedAttachmentData,
  dictionary: Dictionary,
): string {
  return interpolate(dictionary.chat.sentAttachment, {
    name: attachment.filename ?? dictionary.chat.unnamedAttachment,
  });
}

export function releaseSalesChatMessageAttachments(
  messages: readonly SalesChatUiMessage[],
): SalesChatUiMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.flatMap((part) =>
      part.type === "file" ? [releasedAttachmentPart(part)] : [part],
    ),
  }));
}

export function prepareSalesChatRequestMessages(
  messages: readonly SalesChatUiMessage[],
): SalesChatUiMessage[] {
  const latestUserMessageIndex = messages.findLastIndex(
    (message) => message.role === "user",
  );

  const sanitizedUserMessages = messages.flatMap((message, index) =>
    message.role !== "user"
      ? []
      : [
          {
            id: message.id,
            parts: message.parts.filter(
              (part) =>
                part.type === "text" ||
                (index === latestUserMessageIndex && part.type === "file"),
            ),
            role: "user" as const,
          },
        ],
  );

  const selected: SalesChatUiMessage[] = [];
  let selectedTextCharacters = 0;
  for (const message of sanitizedUserMessages.toReversed()) {
    const textLength = message.parts.reduce(
      (length, part) =>
        part.type === "text" ? length + part.text.length : length,
      0,
    );
    const isLatestUserMessage = message === sanitizedUserMessages.at(-1);

    // Historical client state predates the current request limits in some
    // sessions. Do not upload a stale message the server must reject; the
    // latest message remains visible to server-side validation.
    if (
      !isLatestUserMessage &&
      (textLength === 0 || textLength > MAX_CHAT_USER_MESSAGE_CHARACTERS)
    ) {
      continue;
    }
    if (
      selected.length >= MAX_CHAT_HISTORY_USER_MESSAGES ||
      selectedTextCharacters + textLength > MAX_CHAT_HISTORY_TEXT_CHARACTERS
    ) {
      break;
    }
    selected.push(message);
    selectedTextCharacters += textLength;
  }

  return selected.toReversed();
}
