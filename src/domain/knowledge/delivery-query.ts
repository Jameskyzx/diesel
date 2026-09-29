import { knowledgeQueryMayHaveConstraints } from "./query-constraints";
import { knowledgeQueryLiteralSpans } from "./query-literal-spans";

export type KnowledgeRankingOptions = Readonly<{ deliveryCueRanking?: true }>;
type Span = { start: number; end: number };
type DeliveryCueKind = "excerpt" | "source" | "page" | "section";
type DeliveryCue = Span & { kind: DeliveryCueKind; value: string };

// Shared with retained-request parsing: explicit references remain terms, not
// generic instructions to deliver an excerpt or a source locator.
export const knowledgeReferencePatterns = [
  /\b(?:stage|tier|p|pp|pages?|section|clause|part|annex|appendix|version|ver|v)\s*(?:(?:no|number|code)\.?\s*)?[:#.-]?\s*(?:[ivxlcdm]+|\d+(?:[./-]\d+)*)\b/giu,
  /\d+(?:\.\d+)?\s*(?:k\s*w|kilowatts?|千瓦)/giu,
  /§\s*\d+(?:[./-]\d+)*/gu,
  /第?\s*\d+(?:\s*-\s*\d+)?\s*(?:页|条|款|章|节)/gu,
] as const;

export function insideKnowledgeIdentifier(text: string, start: number, end: number): boolean {
  return Array.from(text.matchAll(/(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>"'“”]+|[\p{L}\p{N}]+(?:[-._/@][\p{L}\p{N}]+)+/giu))
    .some((match) => match.index <= start && match.index + match[0].length >= end &&
      (match.index !== start || match.index + match[0].length !== end));
}

/** Existing delivery-cue spans only; no stopwords, stemming or translation. */
export function extractKnowledgeDeliveryCues(query: string): {
  cues: DeliveryCue[];
  connectives: Array<Span & { value: string }>;
} {
  const protectedSpans = [
    ...knowledgeQueryLiteralSpans(query),
    ...knowledgeReferencePatterns.flatMap((pattern) => Array.from(query.matchAll(pattern),
      (match) => ({ start: match.index, end: match.index + match[0].length }))),
  ];
  const patterns = [
    ["excerpt", /(?<![\p{L}\p{N}_])original\s+(?:texts?|wording)(?![\p{L}\p{N}_])|原\s*文/giu],
    ["source", /(?<![\p{L}\p{N}_])(?:sources?|citations?|evidence)(?![\p{L}\p{N}_])|来\s*源|证\s*据|出\s*处/giu],
    ["page", /(?<![\p{L}\p{N}_])(?:page\s+numbers?|pages?)(?![\p{L}\p{N}_])|页\s*码|(?<!\p{Script=Han})页(?!\p{Script=Han})/giu],
    ["section", /(?<![\p{L}\p{N}_])(?:sections?|clauses?)(?:\s+numbers?)?(?![\p{L}\p{N}_])|章\s*节|条\s*款|(?<!\p{Script=Han})[章节条款](?!\p{Script=Han})/giu],
  ] as const;
  const cues = patterns.flatMap(([kind, pattern]) => Array.from(query.matchAll(pattern)).flatMap((match) => {
    const end = match.index + match[0].length;
    return protectedSpans.some((span) => span.start < end && span.end > match.index) ||
      insideKnowledgeIdentifier(query, match.index, end) ? [] : [{ kind, start: match.index, end, value: " " }];
  }));
  const orderedCues = [...cues].sort((left, right) => left.start - right.start);
  // Only 和/与 between adjacent ordinary cues are delivery-only connectives.
  const connectives = orderedCues.flatMap((left, index) => {
    const right = orderedCues[index + 1];
    if (!right || right.start <= left.end ||
      !/^\s*[和与]\s*$/u.test(query.slice(left.end, right.start)) ||
      protectedSpans.some((span) => span.start < right.start && span.end > left.end) ||
      insideKnowledgeIdentifier(query, left.end, right.start)) return [];
    return [{ start: left.end, end: right.start, value: " " }];
  });
  return { cues, connectives };
}

/** AI-only ranking text. The original query still owns filtering and delivery. */
export function projectKnowledgeRankingQuery(query: string, deliveryCueRanking?: true): string {
  if (deliveryCueRanking !== true || query.length > 500 || knowledgeQueryMayHaveConstraints(query)) return query;
  const { cues, connectives } = extractKnowledgeDeliveryCues(query);
  if (cues.length === 0) return query;
  let projected = query;
  for (const span of [...cues, ...connectives].sort((left, right) => right.start - left.start)) {
    projected = projected.slice(0, span.start) + " ".repeat(span.end - span.start) + projected.slice(span.end);
  }
  projected = projected.trim();
  return /[\p{L}\p{N}]/u.test(projected) ? projected : query;
}
