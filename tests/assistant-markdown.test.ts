import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AssistantMarkdown,
  safeAssistantMarkdownUrl,
} from "@/components/ai/assistant-markdown";

describe("assistant Markdown", () => {
  it("renders CommonMark and GFM structure", () => {
    const html = renderToStaticMarkup(
      createElement(AssistantMarkdown, {
        allowedExternalUrls: ["https://authority.example/evidence"],
        content: [
          "# 结论",
          "",
          "**已验证**，请查看 `fit` 结果。",
          "",
          "- [x] 法规证据",
          "- [ ] 商业审批",
          "",
          "| 国家 | 状态 |",
          "| --- | --- |",
          "| CHN | fit |",
          "",
          "[官方来源](https://authority.example/evidence)",
        ].join("\n"),
      }),
    );

    expect(html).toContain("<h3");
    expect(html).toContain("<strong>已验证</strong>");
    expect(html).toContain("<code");
    expect(html).toContain("type=\"checkbox\"");
    expect(html).toContain("<table");
    expect(html).toContain('href="https://authority.example/evidence"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("drops raw HTML, blocks unsafe links and never loads model images", () => {
    const html = renderToStaticMarkup(
      createElement(AssistantMarkdown, {
        content: [
          '<script>alert("xss")</script>',
          "[unsafe](javascript:alert(1))",
          "![tracking pixel](https://evil.example/pixel.png)",
        ].join("\n\n"),
      }),
    );

    expect(html).not.toContain("<script");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("src=");
    expect(html).toContain("已隐藏模型图片：tracking pixel");
  });

  it("allows in-app links and only citation-approved external URLs", () => {
    expect(
      safeAssistantMarkdownUrl("https://example.com/a", [
        "https://example.com/a",
      ]),
    ).toBe(
      "https://example.com/a",
    );
    expect(safeAssistantMarkdownUrl("https://example.com/a")).toBe("");
    expect(
      safeAssistantMarkdownUrl("https://evil.example/phishing", [
        "https://example.com/a",
      ]),
    ).toBe("");
    expect(safeAssistantMarkdownUrl("/countries/CHN")).toBe(
      "/countries/CHN",
    );
    expect(safeAssistantMarkdownUrl("#sources")).toBe("#sources");
    expect(safeAssistantMarkdownUrl("?asOf=2026-08-14")).toBe(
      "?asOf=2026-08-14",
    );
    expect(safeAssistantMarkdownUrl("//evil.example/path")).toBe("");
    expect(safeAssistantMarkdownUrl("/\\evil.example/path")).toBe("");
    expect(safeAssistantMarkdownUrl("https://user:pass@example.com")).toBe(
      "",
    );
    expect(safeAssistantMarkdownUrl("javascript:alert(1)")).toBe("");
    expect(safeAssistantMarkdownUrl("data:text/html;base64,WA==")).toBe("");
  });
});
