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

const maximumChunkCharacters = 1_200;

function splitLongParagraph(paragraph: string): string[] {
  if (paragraph.length <= maximumChunkCharacters) {
    return [paragraph];
  }

  const parts: string[] = [];
  let remaining = paragraph;

  while (remaining.length > maximumChunkCharacters) {
    const candidate = remaining.slice(0, maximumChunkCharacters);
    const lastBoundary = Math.max(
      candidate.lastIndexOf("。"),
      candidate.lastIndexOf(". "),
      candidate.lastIndexOf(" "),
    );
    const splitAt =
      lastBoundary >= maximumChunkCharacters * 0.5
        ? lastBoundary + 1
        : maximumChunkCharacters;
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

  pages.forEach((page, pageIndex) => {
    const headingStack: string[] = [title];
    const paragraphLines: string[] = [];
    let paragraphNumber = 0;

    function flushParagraph() {
      const paragraph = paragraphLines.join(" ").trim();
      paragraphLines.length = 0;

      if (!paragraph) {
        return;
      }

      paragraphNumber += 1;
      for (const part of splitLongParagraph(paragraph)) {
        const heading = headingStack.join(" > ");
        const content = `${heading}\n${part}`;
        chunks.push({
          content,
          headingPath: [...headingStack],
          pageFrom: pageIndex + 1,
          pageTo: pageIndex + 1,
          sectionLocator: `${heading} · paragraph ${paragraphNumber}`,
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
          const slot = Math.min(level, headingStack.length);
          headingStack.splice(slot);
          headingStack[slot] = heading;
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
