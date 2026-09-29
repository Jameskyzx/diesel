import { describe, expect, it } from "vitest";

import {
  appendKnowledgeQueryTerms,
  knowledgeQueryLiteralSpans,
  maskKnowledgeQueryLiterals,
  maskKnowledgeSignedOperands,
} from "@/domain/knowledge/query-literal-spans";

describe("query literal surface ranges", () => {
  it.each([
    ["CHN source -China", ["-China"]],
    ["CHN source - China", ["- China"]],
    ["CHN source -\nChina", ["-\nChina"]],
    ["CHN source --China", ["--China"]],
    ["CHN source - - China", ["- - China"]],
    ["CHN source -(China)", ["-(China)"]],
    ["CHN source - ( China )", ["- ( China"]],
    ["CHN source - ) China", ["- ) China"]],
    ['CHN source - ( "Brazil marine" )', ['- ( "Brazil marine"']],
    ["CHN source -[China]", ["-[China]"]],
    ["CHN source -,China", ["-,China"]],
    ["CHN source -China,BRA", ["-China,BRA"]],
    ["CHN source -non-road", ["-non-road"]],
    ["CHN source -non road", ["-non"]],
    ["CHN source -section.1 -2024-01-01", ["-section.1", "-2024-01-01"]],
    ['CHN source - "Brazil marine"', ['- "Brazil marine"']],
    ['CHN source -foo"Brazil"', ['-foo"Brazil"']],
    ["CHN source -“Brazil marine”", ["-“Brazil marine”"]],
    ['CHN source "literal -Brazil" DEU', ['"literal -Brazil"']],
    ['CHN source -"Brazil\nmarine', ['-"Brazil\nmarine']],
    ["CHN source -https://example.test/China", ["-https://example.test/China"]],
    ["CHN source DOC-China https://example.test/-Brazil non-road", []],
    ["CHN source –China", []],
    ["🛠 CHN 来源 -巴西", ["-巴西"]],
    ["CHN source -", ["-"]],
  ] as const)("protects %s without changing UTF-16 offsets", (text, expected) => {
    const spans = knowledgeQueryLiteralSpans(text);
    expect(spans.map((span) => text.slice(span.start, span.end))).toEqual(expected);
    const masked = maskKnowledgeQueryLiterals(text);
    expect(masked.length).toBe(text.length);
    for (let index = 0; index < text.length; index++) {
      expect(masked[index]).toBe(spans.some((span) => span.start <= index && span.end > index) ? " " : text[index]);
    }
  });

  it("keeps positive quoted control values but masks signed quoted operands", () => {
    const control = 'Actually use "non-road" for CHN -"Brazil marine"';
    expect(maskKnowledgeSignedOperands(control)).toContain('Actually use "non-road" for CHN');
    expect(maskKnowledgeSignedOperands(control)).not.toContain("Brazil");
  });

  it.each(["source -", "source --", "source - \n", 'source -""', "source - ( )"])("does not bind appended context to a dangling sign: %s", (query) => {
    expect(appendKnowledgeQueryTerms(query, ["non-road"])).toBe(`non-road ${query}`);
    expect(appendKnowledgeQueryTerms(query, [])).toBe(query);
  });
});
