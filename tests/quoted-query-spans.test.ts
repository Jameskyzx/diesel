import { describe, expect, it } from "vitest";

import { knowledgeQuotedSpans, maskKnowledgeQuotedText } from "@/domain/knowledge/quoted-query-spans";
import { appendKnowledgeQueryTerms } from "@/domain/knowledge/query-literal-spans";

describe("knowledge quoted-literal preservation ranges", () => {
  it.each([
    ['CHN "China non-road" source', ['"China non-road"'], [true]],
    ['CHN -"China\nnon-road', ['"China\nnon-road'], [false]],
    ['CHN "as of 2024-01-01\nsource" as of 2026-08-20', ['"as of 2024-01-01\nsource"'], [true]],
    ['中国 “巴西 船用” 来源', ['“巴西 船用”'], [true]],
    ['CHN “Brazil "marine"', ['“Brazil "marine"'], [false]],
    ['CHN “label "China” non-road', ['“label "China” non-road'], [false]],
    ['CHN "label “China" non-road', ['"label “China" non-road'], [false]],
    ['foo "China\\" BRA" DEU', ['"China\\"', '" DEU'], [true, false]],
    ['CHN “label "China” non-road" source', ['“label "China” non-road"'], [true]],
    ['CHN "" "China" “Brazil”', ['""', '"China"', '“Brazil”'], [true, true, true]],
    ['CHN "', ['"'], [false]],
    ["China's non-road source", [], []],
    ['🛠 CHN "中国" BRA', ['"中国"'], [true]],
  ] as const)("preserves literal boundaries in %s", (text, literalTexts, closed) => {
    const spans = knowledgeQuotedSpans(text);
    expect(spans.map((span) => text.slice(span.start, span.end))).toEqual(literalTexts);
    expect(spans.map((span) => span.closed)).toEqual(closed);
    const masked = maskKnowledgeQuotedText(text);
    expect(masked.length).toBe(text.length);
    for (let index = 0; index < text.length; index++) {
      expect(masked[index]).toBe(spans.some((span) => span.start <= index && span.end > index) ? " " : text[index]);
    }
  });

  it.each([
    ['source "China"', ['non-road'], 'source "China" non-road'],
    ['source -"China', ['non-road', 'section 2'], 'non-road section 2 source -"China'],
    ['source “China', ['non-road'], 'non-road source “China'],
    ['source -"China', [], 'source -"China'],
  ] as const)("adds control words outside an unfinished literal: %s", (text, additions, expected) => {
    expect(appendKnowledgeQueryTerms(text, additions)).toBe(expected);
  });
});
