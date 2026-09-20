import { knowledgeQuotedSpans } from "./quoted-query-spans";

type LiteralSpan = { start: number; end: number };

/**
 * Conservative surface ranges, not a websearch parser. A standalone ASCII
 * sign and its following surface token belong to the query, even for --word.
 * PostgreSQL still decides tokenization, negation parity and Boolean meaning.
 * Whitespace after a sign is significant to metadata protection, not a reason
 * to reinterpret the next token as a country/scope/date filter.
 */
export function knowledgeSignedOperandSpans(text: string): LiteralSpan[] {
  const quoted = knowledgeQuotedSpans(text);
  // Native websearch skips parentheses between its sign and value; they do
  // not group OR branches. Other punctuation remains part of the surface token.
  const pattern = /(?<![\p{L}\p{N}\p{M}_./:@%?=+#\\-])-[\s()-]*[^\s"]*/gu;
  return Array.from(text.matchAll(pattern)).flatMap((match) => {
    if (quoted.some((span) => span.start <= match.index && span.end > match.index)) return [];
    let end = match.index + match[0].length;
    // A sign before a quote binds to the quoted operand. Quotes inside an
    // already-started surface token are separate native operands.
    const quote = quoted.find((span) => span.start > match.index &&
      (span.start < end || (span.start === end && /^-[\s()-]*$/u.test(match[0]))));
    if (quote) end = Math.max(end, quote.end);
    return [{ start: match.index, end }];
  });
}

export function knowledgeQueryLiteralSpans(text: string): LiteralSpan[] {
  const ranges = [...knowledgeQuotedSpans(text), ...knowledgeSignedOperandSpans(text)]
    .sort((left, right) => left.start - right.start);
  const merged: LiteralSpan[] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ start: range.start, end: range.end });
  }
  return merged;
}

function maskSpans(text: string, spans: readonly LiteralSpan[]): string {
  let masked = text;
  for (const span of spans) {
    masked = masked.slice(0, span.start) + " ".repeat(span.end - span.start) + masked.slice(span.end);
  }
  return masked;
}

export function maskKnowledgeQueryLiterals(text: string): string {
  return maskSpans(text, knowledgeQueryLiteralSpans(text));
}

/** Control-only source follow-ups may quote a new filter, but not negate it. */
export function maskKnowledgeSignedOperands(text: string): string {
  return maskSpans(text, knowledgeSignedOperandSpans(text));
}

export function appendKnowledgeQueryTerms(text: string, terms: readonly string[]): string {
  if (terms.length === 0) return text;
  const additional = terms.join(" ");
  const danglingSign = knowledgeSignedOperandSpans(text).some((span) => span.end === text.length &&
    !/[\p{L}\p{N}]/u.test(text.slice(span.start, span.end)));
  // Do not turn new metadata into the operand of an unfinished quote or sign.
  return danglingSign || knowledgeQuotedSpans(text).some((span) => !span.closed)
    ? `${additional} ${text}`
    : `${text} ${additional}`;
}
