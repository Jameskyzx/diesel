import { describe, expect, it } from "vitest";

import { chunkStructuredText } from "@/domain/knowledge/chunk-document";
import { tokenizeKnowledgeText } from "@/domain/knowledge/embedding";

type ExpectedChunk = {
  body: string;
  headings: string[];
  page: number;
  paragraph: number;
};

const cases: {
  name: string;
  text: string;
  expected: ExpectedChunk[];
}[] = [
  {
    name: "keeps a section active when its body continues on the next page",
    text: "# Scope\n\nFirst.\fSecond.",
    expected: [
      { body: "First.", headings: ["Scope"], page: 1, paragraph: 1 },
      { body: "Second.", headings: ["Scope"], page: 2, paragraph: 1 },
    ],
  },
  {
    name: "preserves section ancestry across an empty intervening page",
    text: "# Scope\n## Limits\nFirst.\f\fThird.",
    expected: [
      { body: "First.", headings: ["Scope", "Limits"], page: 1, paragraph: 1 },
      { body: "Third.", headings: ["Scope", "Limits"], page: 3, paragraph: 1 },
    ],
  },
  {
    name: "carries a heading on an otherwise empty page into its body",
    text: "# Scope\fBody.",
    expected: [
      { body: "Body.", headings: ["Scope"], page: 2, paragraph: 1 },
    ],
  },
  {
    name: "retains the parent of a child heading introduced after a page break",
    text: "# Scope\nFirst.\f## Requirements\nSecond.",
    expected: [
      { body: "First.", headings: ["Scope"], page: 1, paragraph: 1 },
      { body: "Second.", headings: ["Scope", "Requirements"], page: 2, paragraph: 1 },
    ],
  },
  {
    name: "allows a new top-level heading to close the previous page's section",
    text: "# Scope\n## Limits\nFirst.\f# Appendix\nSecond.",
    expected: [
      { body: "First.", headings: ["Scope", "Limits"], page: 1, paragraph: 1 },
      { body: "Second.", headings: ["Appendix"], page: 2, paragraph: 1 },
    ],
  },
  {
    name: "replaces sibling headings even when their Markdown level skips a level",
    text: "# Scope\n### Alpha\nFirst.\n### Beta\nSecond.",
    expected: [
      { body: "First.", headings: ["Scope", "Alpha"], page: 1, paragraph: 1 },
      { body: "Second.", headings: ["Scope", "Beta"], page: 1, paragraph: 2 },
    ],
  },
  {
    name: "does not invent a parent for a document starting at a deeper level",
    text: "### Detail\nFirst.\n## Group\nSecond.\n## Other\nThird.",
    expected: [
      { body: "First.", headings: ["Detail"], page: 1, paragraph: 1 },
      { body: "Second.", headings: ["Group"], page: 1, paragraph: 2 },
      { body: "Third.", headings: ["Other"], page: 1, paragraph: 3 },
    ],
  },
  {
    name: "unwinds skipped child levels while retaining only real ancestors",
    text: "# 范围\r\n## 限值\r\n###### 细则\r\n甲。\r\n### 条件\r\n乙。\r\n# 附录\r\n丙。",
    expected: [
      { body: "甲。", headings: ["范围", "限值", "细则"], page: 1, paragraph: 1 },
      { body: "乙。", headings: ["范围", "限值", "条件"], page: 1, paragraph: 2 },
      { body: "丙。", headings: ["附录"], page: 1, paragraph: 3 },
    ],
  },
];

describe("knowledge chunk source locators", () => {
  it.each(cases)("$name", ({ text, expected }) => {
    const title = "DEMO ONLY — Locator fixture";
    const chunks = chunkStructuredText(title, text);

    expect(chunks).toEqual(expected.map((chunk, chunkIndex) => {
      const headingPath = [title, ...chunk.headings];
      const heading = headingPath.join(" > ");
      const content = `${heading}\n${chunk.body}`;
      return {
        chunkIndex,
        content,
        headingPath,
        pageFrom: chunk.page,
        pageTo: chunk.page,
        sectionLocator: `${heading} · paragraph ${chunk.paragraph}`,
        tokenCount: tokenizeKnowledgeText(content).length,
      };
    }));
    expect(chunkStructuredText(title, text)).toEqual(chunks);
  });
});
