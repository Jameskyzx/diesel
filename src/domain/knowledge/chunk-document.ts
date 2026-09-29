import { tokenizeKnowledgeText } from "@/domain/knowledge/embedding";

export type ExtractedChunk = {
  chunkIndex: number;
  content: string;
  headingPath: string[];
  pageFrom: number;
  pageTo: number;
  sectionLocator: string;
  tokenCount: number;
};

const maximumChunkCodeUnits = 1_200;
const maximumHeadingPathCodeUnits = 2_048;
const maximumChunks = 5_000;
const maximumGeneratedTextCodeUnits = 16 * 1024 * 1024;

export class KnowledgeChunkingError extends Error {
  constructor(
    readonly code:
      | "HEADING_PATH_LIMIT"
      | "CHUNK_COUNT_LIMIT"
      | "GENERATED_TEXT_LIMIT",
  ) {
    super(`Knowledge chunking limit exceeded: ${code}.`);
    this.name = "KnowledgeChunkingError";
  }
}

function assertHeadingPathBudget(headings: readonly { text: string }[]): void {
  const pathLength = headings.reduce((length, heading) => length + heading.text.length, 0) +
    Math.max(0, headings.length - 1) * " > ".length;
  if (pathLength > maximumHeadingPathCodeUnits) {
    throw new KnowledgeChunkingError("HEADING_PATH_LIMIT");
  }
}

function splitLongParagraph(paragraph: string): string[] {
  if (paragraph.length <= maximumChunkCodeUnits) {
    return [paragraph];
  }

  const parts: string[] = [];
  let remaining = paragraph;

  while (remaining.length > maximumChunkCodeUnits) {
    const candidate = remaining.slice(0, maximumChunkCodeUnits);
    const lastBoundary = Math.max(
      candidate.lastIndexOf("。"),
      candidate.lastIndexOf(". "),
      candidate.lastIndexOf(" "),
    );
    let splitAt =
      lastBoundary >= maximumChunkCodeUnits * 0.5
        ? lastBoundary + 1
        : maximumChunkCodeUnits;
    // Keep a supplementary code point's UTF-16 surrogate pair in one chunk.
    // Moving left preserves the existing size budget without replacing text.
    if ((remaining.codePointAt(splitAt - 1) ?? 0) > 0xffff) {
      splitAt -= 1;
    }
    parts.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) {
    parts.push(remaining);
  }

  return parts;
}

export function chunkStructuredText(
  title: string,
  text: string,
): ExtractedChunk[] {
  const chunks: Omit<ExtractedChunk, "chunkIndex">[] = [];
  const pages = text.replace(/\r\n?/g, "\n").split("\f");
  // A page boundary changes the locator, not the active document section.
  // Retain actual Markdown levels: stack depth is not a heading level when
  // the source skips a level or begins with a subheading.
  const headingStack = [{ level: 0, text: title }];
  assertHeadingPathBudget(headingStack);
  let generatedTextCodeUnits = 0;

  pages.forEach((page, pageIndex) => {
    const paragraphLines: string[] = [];
    let paragraphNumber = 0;

    function flushParagraph() {
      const paragraph = paragraphLines.join(" ").trim();
      paragraphLines.length = 0;

      if (!paragraph) {
        return;
      }

      paragraphNumber += 1;
      const headingPath = headingStack.map((heading) => heading.text);
      const heading = headingPath.join(" > ");
      const headingFieldCodeUnits = headingPath.reduce((length, text) => length + text.length, 0);
      const sectionLocator = `${heading} · paragraph ${paragraphNumber}`;
      for (const part of splitLongParagraph(paragraph)) {
        if (chunks.length >= maximumChunks) {
          throw new KnowledgeChunkingError("CHUNK_COUNT_LIMIT");
        }
        // Count every generated text field, including repeated metadata, before
        // allocating/tokenizing the next content value. This is an output budget,
        // not a process-RSS limit or permission to truncate source evidence.
        const nextTextCodeUnits = heading.length + 1 + part.length +
          headingFieldCodeUnits + sectionLocator.length;
        if (generatedTextCodeUnits + nextTextCodeUnits > maximumGeneratedTextCodeUnits) {
          throw new KnowledgeChunkingError("GENERATED_TEXT_LIMIT");
        }
        generatedTextCodeUnits += nextTextCodeUnits;
        const content = `${heading}\n${part}`;
        chunks.push({
          content,
          headingPath: [...headingPath],
          pageFrom: pageIndex + 1,
          pageTo: pageIndex + 1,
          sectionLocator,
          tokenCount: tokenizeKnowledgeText(content).length,
        });
      }
    }

    for (const line of page.split("\n")) {
      const headingMatch = /^(#{1,6})\s+(.+?)\s*$/.exec(line);

      if (headingMatch) {
        flushParagraph();
        const level = headingMatch[1]?.length ?? 1;
        const heading = headingMatch[2]?.trim();

        if (heading) {
          while ((headingStack.at(-1)?.level ?? 0) >= level) {
            headingStack.pop();
          }
          headingStack.push({ level, text: heading });
          assertHeadingPathBudget(headingStack);
        }
        continue;
      }

      if (!line.trim()) {
        flushParagraph();
        continue;
      }

      paragraphLines.push(line.trim());
    }

    flushParagraph();
  });

  return chunks.map((chunk, chunkIndex) => ({
    ...chunk,
    chunkIndex,
  }));
}
