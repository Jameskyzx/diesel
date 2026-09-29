import { describe, expect, it } from "vitest";

import { chunkStructuredText } from "@/domain/knowledge/chunk-document";
import {
  DocumentProcessingError,
  extractUtf8Text,
} from "@/server/knowledge/document-file";

function extract(source: string): string {
  return extractUtf8Text({
    bytes: new TextEncoder().encode(source),
    fileName: "demo-source.md",
    mimeType: "text/markdown",
  });
}

describe("knowledge document UTF-8 source extraction", () => {
  it.each([
    { name: "one leading empty page", prefix: "\f", page: 2 },
    { name: "two leading empty pages", prefix: "\f\f", page: 3 },
    { name: "a UTF-8 BOM before an empty page", prefix: "\uFEFF\f", page: 2 },
    { name: "whitespace around an empty page", prefix: " \r\n\f\r\n", page: 2 },
  ])("preserves $name and the original page locator", ({ prefix, page }) => {
    const source = `${prefix}# 范围\n正文。\n\f`;
    const text = extract(source);

    expect(text).toBe(source.replace(/^\uFEFF/u, ""));
    expect(chunkStructuredText("DEMO ONLY", text)).toMatchObject([
      {
        chunkIndex: 0,
        content: "DEMO ONLY > 范围\n正文。",
        headingPath: ["DEMO ONLY", "范围"],
        pageFrom: page,
        pageTo: page,
        sectionLocator: "DEMO ONLY > 范围 · paragraph 1",
      },
    ]);
  });

  it.each(["", " \t\r\n", "\f\f", "\uFEFF \f\n"])(
    "still rejects whitespace-only input %j without producing chunks",
    (source) => {
      expect(() => extract(source)).toThrow(DocumentProcessingError);
      expect(() => extract(source)).toThrow(
        expect.objectContaining({ code: "EMPTY_TEXT" }),
      );
    },
  );

  it("still rejects malformed UTF-8 before it can become source evidence", () => {
    expect(() => extractUtf8Text({
      bytes: new Uint8Array([0xc3, 0x28]),
      fileName: "demo-source.md",
      mimeType: "text/markdown",
    })).toThrow(expect.objectContaining({ code: "INVALID_UTF8" }));
  });

  it.each(["\0", "\0body", "before\0after", "body\0", "# scope\0heading\n\nbody"])(
    "rejects valid UTF-8 containing NUL before chunking: %j",
    (source) => {
      expect(() => extract(source)).toThrow(expect.objectContaining({ code: "UNSUPPORTED_TEXT" }));
      expect(() => extract(source)).toThrow("U+0000");
    },
  );

  it.each([
    { fileName: "demo-source.pdf", mimeType: "text/plain" },
    { fileName: "demo-source.txt", mimeType: "application/pdf" },
  ])("does not loosen file admission for $fileName / $mimeType", (metadata) => {
    expect(() => extractUtf8Text({
      ...metadata,
      bytes: new TextEncoder().encode("# Scope\nBody."),
    })).toThrow(expect.objectContaining({ code: "UNSUPPORTED_FILE" }));
  });
});
