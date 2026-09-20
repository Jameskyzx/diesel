import { describe, expect, it } from "vitest";

import { chunkStructuredText } from "@/domain/knowledge/chunk-document";
import { tokenizeKnowledgeText } from "@/domain/knowledge/embedding";

const unicodeCases = ["𠮷", "😀", "𝒜"].flatMap((symbol) =>
  [1198, 1199, 1200].map((prefixLength) => ({ prefixLength, symbol })),
);

describe("knowledge long-paragraph boundaries", () => {
  it.each(unicodeCases)(
    "preserves $symbol after $prefixLength UTF-16 code units through chunk encoding",
    ({ prefixLength, symbol }) => {
      const title = "DEMO ONLY — Unicode boundary";
      const heading = `${title} > Scope`;
      const prefix = `${heading}\n`;
      const paragraph = `${"甲".repeat(prefixLength)}${symbol}${"乙".repeat(2401)}`;
      const chunks = chunkStructuredText(title, `# Scope\f${paragraph}`);
      const bodies = chunks.map((chunk, chunkIndex) => {
        expect(chunk).toMatchObject({
          chunkIndex,
          headingPath: [title, "Scope"],
          pageFrom: 2,
          pageTo: 2,
          sectionLocator: `${heading} · paragraph 1`,
          tokenCount: tokenizeKnowledgeText(chunk.content).length,
        });
        expect(chunk.content.startsWith(prefix)).toBe(true);
        return chunk.content.slice(prefix.length);
      });

      expect(bodies[0]?.length).toBe(prefixLength === 1199 ? 1199 : 1200);
      expect(bodies.every((body) => body.length > 0 && body.length <= 1200)).toBe(true);
      const encodedBodies = bodies.map((body) => Buffer.from(body, "utf8"));
      expect(encodedBodies.map((bytes, index) => bytes.toString("utf8") === bodies[index]))
        .toEqual(bodies.map(() => true));
      expect(Buffer.concat(encodedBodies).equals(Buffer.from(paragraph, "utf8"))).toBe(true);
      expect(chunkStructuredText(title, `# Scope\f${paragraph}`)).toEqual(chunks);
    },
  );

  it.each([
    {
      name: "an exact-limit paragraph",
      paragraph: "a".repeat(1200),
      expectedBodies: ["a".repeat(1200)],
    },
    {
      name: "a hard split without a natural boundary",
      paragraph: "a".repeat(1201),
      expectedBodies: ["a".repeat(1200), "a"],
    },
    {
      name: "an English word boundary after the midpoint",
      paragraph: `${"a".repeat(700)} ${"b".repeat(700)}`,
      expectedBodies: ["a".repeat(700), "b".repeat(700)],
    },
    {
      name: "a Chinese sentence boundary after the midpoint",
      paragraph: `${"甲".repeat(699)}。${"乙".repeat(700)}`,
      expectedBodies: [`${"甲".repeat(699)}。`, "乙".repeat(700)],
    },
    {
      name: "a short-prefix boundary that does not replace the hard split",
      paragraph: `${"a".repeat(500)} ${"b".repeat(800)}`,
      expectedBodies: [`${"a".repeat(500)} ${"b".repeat(699)}`, "b".repeat(101)],
    },
  ])("retains the existing policy for $name", ({ paragraph, expectedBodies }) => {
    const chunks = chunkStructuredText("DEMO ONLY", paragraph);
    expect(chunks.map((chunk) => chunk.content.slice("DEMO ONLY\n".length)))
      .toEqual(expectedBodies);
  });
});
