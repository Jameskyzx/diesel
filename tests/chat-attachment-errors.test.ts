import { describe, expect, it } from "vitest";

import {
  formatChatAttachmentError,
  imageInvalidAttachmentError,
  validateChatAttachments,
  type ChatAttachmentErrorDescriptor,
} from "@/features/ai/attachment-errors";
import {
  formatChatAttachmentBytes,
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
import { getDictionary } from "@/i18n/dictionaries";
import type { Locale } from "@/i18n/locale";

const english = getDictionary("en");
const chinese = getDictionary("zh-CN");

type AttachmentErrorKind = ChatAttachmentErrorDescriptor["kind"];
type AttachmentFormattingCaseByKind = {
  [Kind in AttachmentErrorKind]: {
    descriptor: Extract<ChatAttachmentErrorDescriptor, { kind: Kind }>;
    expected: Readonly<Record<Locale, string>>;
  };
};

const maliciousImageName = "{pixels}<img onerror=alert(1)>.png";

const formattingCases = {
  attachment_read_failed: {
    descriptor: { kind: "attachment_read_failed" },
    expected: {
      en: "The attachment could not be read. Select it again.",
      "zh-CN": "附件读取失败，请重新选择后再试。",
    },
  },
  empty_file: {
    descriptor: { kind: "empty_file", name: "empty-{name}.csv" },
    expected: {
      en: "empty-{name}.csv is empty and cannot be uploaded.",
      "zh-CN": "empty-{name}.csv 是空文件，无法上传。",
    },
  },
  file_too_large: {
    descriptor: {
      kind: "file_too_large",
      maxBytes: 3 * 1024 * 1024,
      name: "oversize.pdf",
    },
    expected: {
      en: "oversize.pdf exceeds the 3 MiB per-file limit.",
      "zh-CN": "oversize.pdf 超过单文件 3 MiB 限制。",
    },
  },
  image_invalid: {
    descriptor: {
      kind: "image_invalid",
      maxDimension: 8_192,
      maxPixels: 20_000_000,
      minDimension: 11,
      name: maliciousImageName,
    },
    expected: {
      en: `${maliciousImageName} is damaged, truncated, or has unsupported dimensions. Width and height must each be 11–8,192 pixels, with no more than 20,000,000 pixels total.`,
      "zh-CN": `${maliciousImageName} 损坏、截断或像素尺寸不受支持。图片宽高均须为 11–8,192 像素、总计最多 20,000,000 像素。`,
    },
  },
  image_model_unavailable: {
    descriptor: { kind: "image_model_unavailable" },
    expected: {
      en: "The server has no vision model configured. Upload PDF, TXT, Markdown, or CSV, or ask an administrator to enable image analysis.",
      "zh-CN": "当前服务端未配置视觉模型；请上传 PDF、TXT、Markdown 或 CSV，或联系管理员启用图片分析。",
    },
  },
  image_read_failed: {
    descriptor: { kind: "image_read_failed", name: "scan-{name}.png" },
    expected: {
      en: "scan-{name}.png could not be read. Select it again.",
      "zh-CN": "scan-{name}.png 无法读取，请重新选择。",
    },
  },
  invalid_filename: {
    descriptor: {
      kind: "invalid_filename",
      maxCharacters: 1_234_567,
    },
    expected: {
      en: "The filename is invalid or exceeds 1,234,567 characters.",
      "zh-CN": "文件名无效或超过 1,234,567 个字符。",
    },
  },
  too_many_attachments: {
    descriptor: {
      kind: "too_many_attachments",
      maxAttachments: 1_234_567,
    },
    expected: {
      en: "You can upload at most 1,234,567 attachments per turn.",
      "zh-CN": "每轮最多上传 1,234,567 个附件。",
    },
  },
  total_too_large: {
    descriptor: {
      kind: "total_too_large",
      maxBytes: 6 * 1024 * 1024,
    },
    expected: {
      en: "Attachments for one turn cannot exceed 6 MiB in total.",
      "zh-CN": "本轮附件合计不能超过 6 MiB。",
    },
  },
  unsupported_file: {
    descriptor: {
      kind: "unsupported_file",
      name: "<img onerror=alert(1)>{name}.exe",
    },
    expected: {
      en: "<img onerror=alert(1)>{name}.exe has an unsupported format. Choose PNG, JPEG, WebP, PDF, TXT, Markdown, or CSV.",
      "zh-CN": "<img onerror=alert(1)>{name}.exe 的格式不受支持。请选择 PNG、JPEG、WebP、PDF、TXT、Markdown 或 CSV。",
    },
  },
} satisfies AttachmentFormattingCaseByKind;

function attachment(name: string, size: number) {
  return { file: { name, size } };
}

describe("chat attachment error descriptors", () => {
  it.each(Object.values(formattingCases))(
    "formats $descriptor.kind from the retained facts in both locales",
    ({ descriptor, expected }) => {
      expect(formatChatAttachmentError(descriptor, english, "en")).toBe(
        expected.en,
      );
      expect(formatChatAttachmentError(descriptor, chinese, "zh-CN")).toBe(
        expected["zh-CN"],
      );
    },
  );

  it("keeps filename template markers inert while localizing numeric limits", () => {
    const descriptor = formattingCases.image_invalid.descriptor;
    const englishMessage = formatChatAttachmentError(
      descriptor,
      english,
      "en",
    );
    const chineseMessage = formatChatAttachmentError(
      descriptor,
      chinese,
      "zh-CN",
    );

    expect(englishMessage).toContain(maliciousImageName);
    expect(chineseMessage).toContain(maliciousImageName);
    expect(englishMessage).toContain("8,192");
    expect(chineseMessage).toContain("20,000,000");
  });

  it("fails closed for a descriptor outside the exhaustive union", () => {
    const invalidDescriptor = {
      kind: "file_reader_internal_error",
      message: "DO NOT RENDER raw FileReader detail",
    } as unknown as ChatAttachmentErrorDescriptor;

    expect(() =>
      formatChatAttachmentError(invalidDescriptor, english, "en"),
    ).toThrow("Unhandled chat attachment error descriptor.");
    expect(() =>
      formatChatAttachmentError(invalidDescriptor, english, "en"),
    ).not.toThrow("DO NOT RENDER");
  });

  it("builds image validation facts without storing localized numbers", () => {
    expect(imageInvalidAttachmentError("scan.png")).toEqual({
      kind: "image_invalid",
      maxDimension: MAX_CHAT_IMAGE_DIMENSION,
      maxPixels: MAX_CHAT_IMAGE_PIXELS,
      minDimension: MIN_CHAT_IMAGE_DIMENSION,
      name: "scan.png",
    });
  });
});

describe("chat attachment validation", () => {
  it.each([
    {
      attachments: Array.from({ length: MAX_CHAT_ATTACHMENTS + 1 }, (_, index) =>
        attachment(`report-${index}.pdf`, 1),
      ),
      expected: {
        kind: "too_many_attachments",
        maxAttachments: MAX_CHAT_ATTACHMENTS,
      },
      name: "attachment count",
    },
    {
      attachments: [attachment("unsafe/path.pdf", 1)],
      expected: {
        kind: "invalid_filename",
        maxCharacters: MAX_CHAT_ATTACHMENT_FILENAME_CHARACTERS,
      },
      name: "invalid filename",
    },
    {
      attachments: [attachment("empty.csv", 0)],
      expected: { kind: "empty_file", name: "empty.csv" },
      name: "empty file",
    },
    {
      attachments: [
        attachment("oversize.pdf", MAX_CHAT_ATTACHMENT_BYTES + 1),
      ],
      expected: {
        kind: "file_too_large",
        maxBytes: MAX_CHAT_ATTACHMENT_BYTES,
        name: "oversize.pdf",
      },
      name: "per-file limit",
    },
    {
      attachments: [
        attachment("one.pdf", 2 * 1024 * 1024 + 1),
        attachment("two.pdf", 2 * 1024 * 1024 + 1),
        attachment("three.pdf", 2 * 1024 * 1024 + 1),
      ],
      expected: {
        kind: "total_too_large",
        maxBytes: MAX_CHAT_ATTACHMENTS_TOTAL_BYTES,
      },
      name: "aggregate limit",
    },
  ])("returns typed facts for $name", ({ attachments, expected }) => {
    expect(validateChatAttachments(attachments)).toEqual(expected);
  });

  it("accepts files exactly at the count and byte boundaries", () => {
    expect(
      validateChatAttachments([
        attachment("one.pdf", MAX_CHAT_ATTACHMENT_BYTES),
        attachment("two.pdf", MAX_CHAT_ATTACHMENT_BYTES),
      ]),
    ).toBeNull();
  });

  it("normalizes the filename used by display, ARIA, retry, and request facts", () => {
    expect(normalizeChatAttachmentFilename("  evidence-{name}.pdf  ")).toBe(
      "evidence-{name}.pdf",
    );
  });

  it.each([
    { bytes: 1_000, expected: "1,000 B", locale: "en" },
    { bytes: 1_000, expected: "1,000 B", locale: "zh-CN" },
    { bytes: 1_536, expected: "1.5 KiB", locale: "en" },
    { bytes: 1_536, expected: "1.5 KiB", locale: "zh-CN" },
    { bytes: 1.5 * 1024 * 1024, expected: "1.5 MiB", locale: "en" },
    {
      bytes: 1.5 * 1024 * 1024,
      expected: "1.5 MiB",
      locale: "zh-CN",
    },
  ] as const)(
    "formats $bytes bytes in $locale from the active locale",
    ({ bytes, expected, locale }) => {
      expect(formatChatAttachmentBytes(bytes, locale)).toBe(expected);
    },
  );
});
