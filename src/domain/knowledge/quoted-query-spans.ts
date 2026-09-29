export type KnowledgeQuotedSpan = { start: number; end: number; closed: boolean };

/**
 * Text-preservation ranges, not a parser for PostgreSQL Boolean operators.
 * ASCII quotes match the existing native phrase boundary (including EOF and
 * newlines). Curly quotes are also protected from application rewriting, but
 * this does not turn them into PostgreSQL phrase operators.
 */
export function knowledgeQuotedSpans(text: string): KnowledgeQuotedSpan[] {
  // Scan independently: a curly quote must not conceal an ASCII quote whose
  // native phrase continues beyond the closing curly quote (or vice versa).
  const ranges = [/"[^"]*(?:"|$)/gu, /“[^”]*(?:”|$)/gu].flatMap((pattern) =>
    Array.from(text.matchAll(pattern), (match) => ({
      start: match.index,
      end: match.index + match[0].length,
      closed: match[0].length > 1 && match[0].endsWith(match[0][0] === '"' ? '"' : "”"),
    })),
  ).sort((left, right) => left.start - right.start);
  const merged: KnowledgeQuotedSpan[] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start < previous.end) {
      previous.end = Math.max(previous.end, range.end);
      previous.closed = previous.closed && range.closed;
    } else merged.push({ ...range });
  }
  return merged;
}

/** Keeps UTF-16 offsets stable for callers that project original text spans. */
export function maskKnowledgeQuotedText(text: string): string {
  let masked = text;
  for (const span of knowledgeQuotedSpans(text)) {
    masked = masked.slice(0, span.start) + " ".repeat(span.end - span.start) + masked.slice(span.end);
  }
  return masked;
}
