import type { FileUIPart } from "ai";
import { describe, expect, it } from "vitest";

import {
  formatReleasedAttachment,
  parseReleasedAttachmentPart,
  prepareSalesChatRequestMessages,
  releaseSalesChatMessageAttachments,
  releasedAttachmentPart,
  type SalesChatUiMessage,
} from "@/features/ai/released-attachment";
import { getDictionary } from "@/i18n/dictionaries";
import {
  MAX_CHAT_HISTORY_TEXT_CHARACTERS,
  MAX_CHAT_HISTORY_USER_MESSAGES,
} from "@/features/ai/constants";

describe("released chat attachment presentation", () => {
  it("stores only a typed filename fact and re-localizes it on every render", () => {
    const file = {
      filename: "evidence.pdf",
      mediaType: "application/pdf",
      type: "file",
      url: "data:application/pdf;base64,JVBERi0=",
    } satisfies FileUIPart;
    const part = releasedAttachmentPart(file);
    const attachment = parseReleasedAttachmentPart(part);

    expect(part).toEqual({
      data: { filename: "evidence.pdf" },
      type: "data-releasedAttachment",
    });
    expect(JSON.stringify(part)).not.toContain("Sent attachment");
    expect(JSON.stringify(part)).not.toContain("已发送附件");
    expect(attachment).not.toBeNull();
    expect(formatReleasedAttachment(attachment!, getDictionary("en"))).toBe(
      "Sent attachment: evidence.pdf; upload it again for follow-up questions",
    );
    expect(
      formatReleasedAttachment(attachment!, getDictionary("zh-CN")),
    ).toBe("已发送附件：evidence.pdf；后续追问请重新上传");
  });

  it("fails closed for malformed client-only data instead of rendering it", () => {
    const malformed = {
      data: { filename: "../internal.txt" },
      type: "data-releasedAttachment",
    } as unknown as SalesChatUiMessage["parts"][number];

    expect(parseReleasedAttachmentPart(malformed)).toBeNull();
  });

  it("uses localized unnamed-attachment copy when no filename is available", () => {
    const attachment = parseReleasedAttachmentPart(
      releasedAttachmentPart({ filename: undefined }),
    );

    expect(attachment).not.toBeNull();
    expect(formatReleasedAttachment(attachment!, getDictionary("en"))).toContain(
      "Unnamed attachment",
    );
    expect(
      formatReleasedAttachment(attachment!, getDictionary("zh-CN")),
    ).toContain("未命名附件");
  });

  it("uploads only user history, without client placeholders or historical file bytes", () => {
    const oldFile = {
      filename: "old.pdf",
      mediaType: "application/pdf",
      type: "file",
      url: "data:application/pdf;base64,JVBERi0=",
    } satisfies FileUIPart;
    const currentFile = {
      ...oldFile,
      filename: "current.pdf",
    } satisfies FileUIPart;
    const hiddenDataPart = {
      data: { secret: "DO_NOT_UPLOAD_METADATA" },
      type: "data-hiddenClientState",
    } as unknown as SalesChatUiMessage["parts"][number];
    const messages = [
      {
        id: "old-user",
        metadata: { secret: "DO_NOT_UPLOAD_MESSAGE_METADATA" },
        parts: [
          { text: "Old question", type: "text" },
          oldFile,
          releasedAttachmentPart(oldFile),
          hiddenDataPart,
        ],
        role: "user",
      },
      {
        id: "assistant",
        parts: [
          { text: "Answer", type: "text" },
          releasedAttachmentPart(oldFile),
        ],
        role: "assistant",
      },
      {
        id: "current-user",
        parts: [
          { text: "Current question", type: "text" },
          currentFile,
        ],
        role: "user",
      },
    ] satisfies SalesChatUiMessage[];

    const requestMessages = prepareSalesChatRequestMessages(messages);

    expect(requestMessages[0]?.parts).toEqual([
      { text: "Old question", type: "text" },
    ]);
    expect(requestMessages).toHaveLength(2);
    expect(requestMessages[1]?.parts).toEqual([
      { text: "Current question", type: "text" },
      currentFile,
    ]);
    expect(requestMessages.map(({ id }) => id)).toEqual([
      "old-user",
      "current-user",
    ]);
    expect(JSON.stringify(requestMessages)).not.toContain(
      "data-releasedAttachment",
    );
    expect(JSON.stringify(requestMessages)).not.toContain("DO_NOT_UPLOAD");
  });

  it("drops every base64 URL from client message state while retaining retry-safe filename facts", () => {
    const file = {
      filename: "  evidence.pdf  ",
      mediaType: "application/pdf",
      type: "file",
      url: "data:application/pdf;base64,DO_NOT_RETAIN_BASE64",
    } satisfies FileUIPart;
    const messages = [
      {
        id: "current-user",
        parts: [{ text: "Inspect this", type: "text" }, file],
        role: "user",
      },
    ] satisfies SalesChatUiMessage[];

    const released = releaseSalesChatMessageAttachments(messages);

    expect(released[0]?.parts).toEqual([
      { text: "Inspect this", type: "text" },
      {
        data: { filename: "evidence.pdf" },
        type: "data-releasedAttachment",
      },
    ]);
    expect(JSON.stringify(released)).not.toContain("DO_NOT_RETAIN_BASE64");
    expect(messages[0].parts).toContain(file);
  });

  it("uploads only the newest user history that can pass the server budget", () => {
    const messages = Array.from({ length: 41 }, (_, index) => ({
      id: `user-${index + 1}`,
      parts: [{ text: `Question ${index + 1}`, type: "text" as const }],
      role: "user" as const,
    })) satisfies SalesChatUiMessage[];

    const prepared = prepareSalesChatRequestMessages(messages);

    expect(prepared).toHaveLength(MAX_CHAT_HISTORY_USER_MESSAGES);
    expect(prepared.map(({ id }) => id)).toEqual(
      Array.from(
        { length: MAX_CHAT_HISTORY_USER_MESSAGES },
        (_, index) => `user-${30 + index}`,
      ),
    );
  });

  it("stops before uploading history beyond the shared text budget", () => {
    const text = "x".repeat(1_500);
    const messages = Array.from({ length: 12 }, (_, index) => ({
      id: `long-${index + 1}`,
      parts: [{ text, type: "text" as const }],
      role: "user" as const,
    })) satisfies SalesChatUiMessage[];

    const prepared = prepareSalesChatRequestMessages(messages);
    const uploadedCharacters = prepared.reduce(
      (total, message) =>
        total +
        message.parts.reduce(
          (messageTotal, part) =>
            part.type === "text"
              ? messageTotal + part.text.length
              : messageTotal,
          0,
        ),
      0,
    );

    expect(prepared.map(({ id }) => id)).toEqual(
      Array.from({ length: 8 }, (_, index) => `long-${index + 5}`),
    );
    expect(uploadedCharacters).toBeLessThanOrEqual(
      MAX_CHAT_HISTORY_TEXT_CHARACTERS,
    );
  });
});
