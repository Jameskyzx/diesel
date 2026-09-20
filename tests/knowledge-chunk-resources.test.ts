import { describe, expect, it } from "vitest";

import { chunkStructuredText } from "@/domain/knowledge/chunk-document";

const headingLimit = 2048;
const chunkLimit = 5000;
const generatedTextLimit = 16 * 1024 * 1024;

function generatedTextCodeUnits(
  chunks: ReturnType<typeof chunkStructuredText>,
): number {
  return chunks.reduce(
    (total, chunk) => total + chunk.content.length + chunk.sectionLocator.length +
      chunk.headingPath.reduce((length, heading) => length + heading.length, 0),
    0,
  );
}

function outputBudgetFixture() {
  const title = "T";
  const section = "H".repeat(headingLimit - title.length - " > ".length);
  const heading = `${title} > ${section}`;
  const bodies = Array.from({ length: 2700 }, () => "b");
  let remaining = generatedTextLimit - bodies.reduce(
    (total, body, index) => total + `${heading}\n${body}`.length +
      `${heading} · paragraph ${index + 1}`.length + title.length + section.length,
    0,
  );
  // Fill only body text, keeping each paragraph within the existing 1200-unit
  // body budget. This reaches the independent aggregate-field budget exactly.
  for (let index = 0; remaining > 0 && index < bodies.length; index += 1) {
    const extra = Math.min(remaining, 1199);
    bodies[index] += "b".repeat(extra);
    remaining -= extra;
  }
  expect(remaining).toBe(0);
  return { title, text: `# ${section}\n\n${bodies.join("\n\n")}` };
}

describe("knowledge chunk output budgets", () => {
  it.each([
    { name: "one long heading", text: `# ${"H".repeat(16000)}\n\nbody` },
    {
      name: "the combined hierarchy, not just individual headings",
      text: Array.from({ length: 6 }, (_, index) =>
        `${"#".repeat(index + 1)} ${"H".repeat(400)}`
      ).join("\n") + "\n\nbody",
    },
  ])("rejects $name before producing oversized chunks", ({ text }) => {
    expect(() => chunkStructuredText("T", text))
      .toThrowError("Knowledge chunking limit exceeded: HEADING_PATH_LIMIT.");
  });

  it.each(["H".repeat(2044), "😀".repeat(1022)])(
    "accepts an exact-limit heading path without changing source characters",
    (section) => {
      const [chunk] = chunkStructuredText("T", `# ${section}\n\nbody`);
      expect(chunk?.headingPath).toEqual(["T", section]);
      expect(chunk?.headingPath.join(" > ").length).toBe(headingLimit);
      expect(chunk?.content).toBe(`T > ${section}\nbody`);
    },
  );

  it("counts the document title in the heading budget", () => {
    expect(() => chunkStructuredText("T".repeat(headingLimit + 1), "body"))
      .toThrowError("Knowledge chunking limit exceeded: HEADING_PATH_LIMIT.");
  });

  it("releases replaced sibling headings from the active-path budget", () => {
    const section = "H".repeat(2044);
    const chunks = chunkStructuredText("T", `# ${section}\n\na\n# ${section}\n\nb`);
    expect(chunks).toHaveLength(2);
    expect(chunks.map((chunk) => chunk.headingPath)).toEqual([
      ["T", section], ["T", section],
    ]);
    expect(chunks[0]?.headingPath).not.toBe(chunks[1]?.headingPath);
  });

  it("accepts exactly 5000 chunks but rejects one additional paragraph", () => {
    const text = "body\n\n".repeat(chunkLimit);
    const chunks = chunkStructuredText("T", text);
    expect(chunks).toHaveLength(chunkLimit);
    expect(chunks.at(-1)?.chunkIndex).toBe(chunkLimit - 1);
    expect(() => chunkStructuredText("T", `${text}body`))
      .toThrowError("Knowledge chunking limit exceeded: CHUNK_COUNT_LIMIT.");
  });

  it("counts chunks across page boundaries", () => {
    expect(() => chunkStructuredText("T", "body\f".repeat(chunkLimit + 1)))
      .toThrowError("Knowledge chunking limit exceeded: CHUNK_COUNT_LIMIT.");
  });

  it("counts content, every heading field and locators at the exact output limit", () => {
    const fixture = outputBudgetFixture();
    expect(Buffer.byteLength(fixture.text)).toBeLessThan(5 * 1024 * 1024);
    const chunks = chunkStructuredText(fixture.title, fixture.text);
    expect(chunks).toHaveLength(2700);
    expect(generatedTextCodeUnits(chunks)).toBe(generatedTextLimit);
    // The last paragraph remains shorter than the body limit, so this adds
    // precisely one generated code unit rather than a new chunk or locator.
    expect(() => chunkStructuredText(fixture.title, `${fixture.text}b`))
      .toThrowError("Knowledge chunking limit exceeded: GENERATED_TEXT_LIMIT.");
  });

  it("still chunks a 5 MiB plain source with a maximum-length metadata title", () => {
    const title = "T".repeat(300);
    const text = "b".repeat(5 * 1024 * 1024);
    const chunks = chunkStructuredText(title, text);
    expect(chunks).toHaveLength(Math.ceil(text.length / 1200));
    expect(chunks.map((chunk) => chunk.content.slice(title.length + 1)).join(""))
      .toBe(text);
    expect(generatedTextCodeUnits(chunks)).toBeLessThan(generatedTextLimit);
  });
});
