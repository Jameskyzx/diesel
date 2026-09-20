import "server-only";

import { tokenizeKnowledgeText } from "@/domain/knowledge/embedding";
import { appendKnowledgeQueryTerms, knowledgeQueryLiteralSpans, knowledgeSignedOperandSpans, maskKnowledgeQueryLiterals, maskKnowledgeSignedOperands } from "@/domain/knowledge/query-literal-spans";
import { knowledgeQuotedSpans } from "@/domain/knowledge/quoted-query-spans";
import type { KnowledgeDeliveryRequirements } from "@/domain/knowledge/delivery";
import { extractKnowledgeDeliveryCues, insideKnowledgeIdentifier as insideIdentifier, knowledgeReferencePatterns as referencePatterns } from "@/domain/knowledge/delivery-query";
import { applicationScopeMentionsIn, resolveApplicationScopeIntent } from "@/domain/ai/application-scope-intent";
import { activeConversationTaskIn, countryIso3sIn, countryMentionsIn, type ConversationBusinessContext } from "@/server/ai/conversation-context";
import { getDictionary } from "@/i18n/dictionaries";
import { applicationScopeLabel } from "@/i18n/structured-labels";

const knowledgeQueryStopTokens = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "find",
  "for",
  "give",
  "in",
  "me",
  "of",
  "on",
  "please",
  "retrieve",
  "search",
  "show",
  "the",
  "帮",
  "我",
  "查",
  "看",
  "请",
]);
const genericSourceFollowUpTokens = new Set([
  "again",
  "agriculture",
  "apr",
  "april",
  "as",
  "at",
  "aug",
  "august",
  "before",
  "but",
  "bus",
  "citation",
  "citations",
  "construction",
  "continue",
  "continuing",
  "dec",
  "december",
  "document",
  "documents",
  "evidence",
  "feb",
  "february",
  "finding",
  "generator",
  "instead",
  "in",
  "it",
  "jan",
  "january",
  "jul",
  "july",
  "jun",
  "june",
  "kw",
  "look",
  "looking",
  "mar",
  "march",
  "marine",
  "may",
  "more",
  "non",
  "nonroad",
  "now",
  "nov",
  "november",
  "no",
  "oct",
  "october",
  "on",
  "original",
  "page",
  "pages",
  "retrieving",
  "road",
  "same",
  "searching",
  "sep",
  "september",
  "set",
  "source",
  "sources",
  "text",
  "that",
  "this",
  "those",
  "truck",
  "where",
  "with",
  "about",
  "to",
  "from",
  "actually",
  "use",
  "using",
  "application",
  "scope",
  "section",
  "sections",
  "clause",
  "clauses",
  "一",
  "上",
  "个",
  "予",
  "些",
  "依",
  "为",
  "公",
  "农",
  "再",
  "前",
  "发",
  "卡",
  "原",
  "告",
  "器",
  "处",
  "出",
  "到",
  "对",
  "寻",
  "年",
  "成",
  "找",
  "改",
  "客",
  "工",
  "建",
  "换",
  "据",
  "搜",
  "日",
  "文",
  "料",
  "来",
  "查",
  "检",
  "机",
  "械",
  "源",
  "用",
  "看",
  "码",
  "程",
  "索",
  "筑",
  "章",
  "继",
  "给",
  "续",
  "节",
  "船",
  "货",
  "路",
  "车",
  "交",
  "道",
  "非",
  "业",
  "组",
  "电",
  "月",
  "的",
  "第",
  "页",
  "截",
  "至",
  "这",
  "下",
  "针",
]);

function uniqueCountries(countries: readonly string[]): string[] {
  return Array.from(new Set(countries));
}

function knowledgeIdentifierTermsIn(value: string): string[] {
  const normalized = value
    .normalize("NFKC")
    .replace(/\p{Cf}+/gu, "")
    .replace(/[‐‑‒–—−]/gu, "-")
    .toLocaleLowerCase("en");
  return [...new Set([
    ...plainKnowledgeIdentifierTermsIn(maskKnowledgeQueryLiterals(normalized)),
    ...knowledgeQueryLiteralSpans(normalized).flatMap((span) =>
      plainKnowledgeIdentifierTermsIn(normalized.slice(span.start, span.end))
        .map((term) => `literal:${term}`),
    ),
  ])];
}

function plainKnowledgeIdentifierTermsIn(normalized: string): string[] {
  const identifiers = new Set<string>();

  for (const match of normalized.matchAll(
    /[\p{L}\p{N}]+(?:[-._/][\p{L}\p{N}]+)+/gu,
  )) {
    const identifier = match[0];
    // A complete locator/version spelling is syntax, not a second opaque ID.
    // Larger compounds (DOC-v2.1, DOC-section.1) remain exact identifiers.
    if (referencePatterns.some((pattern) => Array.from(identifier.matchAll(pattern))
      .some((reference) => reference.index === 0 && reference[0].length === identifier.length))) continue;
    if (/\p{L}/u.test(identifier) && /\p{N}/u.test(identifier)) {
      identifiers.add(`id:${identifier}`);
    }
  }

  for (const match of normalized.matchAll(
    /\b(stage|tier|p|pp|pages?|section|clause|part|annex|appendix|cfr|gb|iso|eu|ec|un|adr|epa|regulation|directive|version|ver|v|model)\s*(?:(?:no|number|code)\.?\s*)?[:#.-]?\s*([ivxlcdm]+|\d+(?:[./-]\d+)*)\b/gu,
  )) {
    if (insideIdentifier(normalized, match.index, match.index + match[0].length)) continue;
    const label =
      match[1] === "p" || match[1] === "pp" || match[1] === "pages"
        ? "page"
        : match[1] === "v" || match[1] === "ver" ? "version" : match[1];
    const identifier = match[2];
    if (label !== undefined && identifier !== undefined) {
      identifiers.add(`ref:${label}:${identifier}`);
    }
  }

  for (const match of normalized.matchAll(
    /(\d+(?:\.\d+)?)\s*(?:k\s*w|kilowatts?|千瓦)/gu,
  )) {
    const powerKw = match[1];
    if (powerKw !== undefined) {
      identifiers.add(`power:${Number(powerKw)}kw`);
    }
  }

  for (const match of normalized.matchAll(
    /§\s*(\d+(?:[./-]\d+)*)/gu,
  )) {
    const section = match[1];
    if (section !== undefined) {
      identifiers.add(`ref:section:${section}`);
    }
  }

  for (const match of normalized.matchAll(
    /第?\s*(\d+(?:\s*-\s*\d+)?)\s*(页|条|款|章|节)/gu,
  )) {
    const locator = match[1]?.replace(/\s+/gu, "");
    const label =
      match[2] === "页"
        ? "page"
        : match[2] === "款"
          ? "clause"
          : "section";
    if (locator !== undefined) {
      identifiers.add(`ref:${label}:${locator}`);
    }
  }

  for (const match of normalized.matchAll(/型号\s*[:#.-]?\s*(\d+)/gu)) {
    const model = match[1];
    if (model !== undefined) {
      identifiers.add(`ref:model:${model}`);
    }
  }

  return [...identifiers];
}

const replaceableKnowledgeIdentifierPrefixes = [
  "power:",
  "ref:page:",
  "ref:section:",
  "ref:clause:",
  "ref:part:",
  "ref:annex:",
  "ref:appendix:",
  "ref:stage:",
  "ref:tier:",
  "ref:version:",
  "ref:ver:",
  "ref:v:",
] as const;

const nonSubstantiveKnowledgeIdentifierPrefixes = [
  "power:",
  "ref:page:",
  "ref:section:",
  "ref:clause:",
  "ref:part:",
  "ref:annex:",
  "ref:appendix:",
] as const;

function replaceableKnowledgeIdentifierPrefix(term: string): string | null {
  return (
    replaceableKnowledgeIdentifierPrefixes.find((prefix) =>
      term.startsWith(prefix),
    ) ?? null
  );
}

function nonSubstantiveKnowledgeIdentifierPrefix(
  term: string,
): string | null {
  return (
    nonSubstantiveKnowledgeIdentifierPrefixes.find((prefix) =>
      term.startsWith(prefix),
    ) ?? null
  );
}

function knowledgeIdentifierSyntaxTokens(
  terms: readonly string[],
): Set<string> {
  const syntaxTokens = new Set<string>();
  for (const term of terms) {
    if (term.startsWith("power:")) {
      syntaxTokens.add("kw");
      syntaxTokens.add("kilowatt");
      syntaxTokens.add("kilowatts");
      continue;
    }
    if (!term.startsWith("ref:")) {
      continue;
    }
    const [, label, identifier] = term.split(":");
    if (label === undefined) {
      continue;
    }
    const labelTokens: Record<string, readonly string[]> = {
      annex: ["annex"],
      appendix: ["appendix"],
      clause: ["clause"],
      model: ["model", "no", "number", "code"],
      page: ["p", "pp", "page", "pages", "no", "number"],
      part: ["part"],
      section: ["section"],
      stage: ["stage"],
      tier: ["tier"],
      v: ["v", "version", "ver", "no", "number"],
      ver: ["ver", "version", "v", "no", "number"],
      version: ["version", "ver", "v", "no", "number"],
    };
    for (const token of labelTokens[label] ?? []) {
      syntaxTokens.add(token);
    }
    if (identifier !== undefined) {
      for (const token of tokenizeKnowledgeText(identifier)) {
        syntaxTokens.add(token);
      }
    }
  }
  return syntaxTokens;
}

function mergeContextualKnowledgeIdentifiers(
  baseTerms: readonly string[],
  replacementTerms: readonly string[],
): string[] {
  let merged = [...baseTerms];
  for (const prefix of new Set(
    replacementTerms.flatMap((term) => {
      const contextualPrefix = replaceableKnowledgeIdentifierPrefix(term);
      return contextualPrefix === null ? [] : [contextualPrefix];
    }),
  )) {
    merged = merged.filter((term) => !term.startsWith(prefix));
    merged.push(...replacementTerms.filter((term) => term.startsWith(prefix)));
  }
  return Array.from(new Set(merged));
}

export function knowledgeTermsIn(
  value: string,
  excludedCountryIso3s: readonly string[] = [],
): string[] {
  value = sourceSearchTextIn(value);
  const excluded = new Set(
    excludedCountryIso3s.map((countryIso3) => countryIso3.toLowerCase()),
  );
  const identifierTerms = knowledgeIdentifierTermsIn(value);
  const identifierSyntaxTokens = knowledgeIdentifierSyntaxTokens(identifierTerms);
  const withoutReferenceSyntax = replaceSpans(value, referenceSpansIn(value)
    .map((span) => ({ ...span, value: " " })));
  // Country filters are bound separately by the evidence contract. Remove
  // only standalone aliases for those filters, never country-like text inside
  // an exact document identifier or URL.
  const lexicalText = replaceSpans(withoutReferenceSyntax, countryMentionsIn(maskKnowledgeQueryLiterals(withoutReferenceSyntax)).filter(
    (mention) => excluded.has(mention.countryIso3.toLowerCase()) &&
      !insideIdentifier(withoutReferenceSyntax, mention.index, mention.index + mention.length),
  ).map((mention) => ({ start: mention.index, end: mention.index + mention.length, value: " " })));
  // Provider queries may spell their already-bound ISO3 filter in lowercase.
  // Do not remove matching tokens globally: CHN in DOC-CHN-100 or a URL is
  // part of the user's retained topic, even after the country filter changes.
  const literalLexicalSpans = knowledgeQueryLiteralSpans(lexicalText);
  const countryNeutralText = lexicalText.replace(/\b[a-z]{3}\b/giu,
    (token, offset: number) => excluded.has(token.toLowerCase()) &&
      !literalLexicalSpans.some((span) => span.start <= offset && span.end > offset) &&
      !insideIdentifier(lexicalText, offset, offset + token.length) ? " " : token);

  return Array.from(
    new Set([
      ...tokenizeKnowledgeText(countryNeutralText).filter(
        (token) =>
          !knowledgeQueryStopTokens.has(token) &&
          !identifierSyntaxTokens.has(token) &&
          (/^\p{Script=Han}$/u.test(token) ||
            (token.length >= 2 && /\p{L}/u.test(token))),
      ),
      ...identifierTerms,
    ]),
  );
}

function latestSubstantiveKnowledgeRequestIn(
  userTexts: readonly string[],
  contextCountryIso3s: readonly string[],
): { index: number; text: string } | null {
  // Retrieval-control words, source metadata nouns, dates, and application
  // scope tokens do not identify a new business topic. A knowledge turn made
  // only from those tokens is a continuation, so it cannot replace the latest
  // source request that carried an actual topic.
  const knowledgeRequests = userTexts.map((text, index) => ({ text, index })).filter(
    ({ text }) => activeConversationTaskIn(text) === "knowledge",
  );
  const substantiveRequest = knowledgeRequests.findLast(({ text }) => {
    const excludedCountries = uniqueCountries([
      ...contextCountryIso3s,
      ...countryIso3sIn(text),
    ]);
    // A source-only refinement such as "continue sources -BRA" does not
    // replace the established business topic with the excluded country word.
    const terms = knowledgeTermsIn(maskKnowledgeSignedOperands(text), excludedCountries);
    const identifierSyntaxTokens = knowledgeIdentifierSyntaxTokens(
      terms.filter(
        (term) => nonSubstantiveKnowledgeIdentifierPrefix(term) !== null,
      ),
    );
    return terms.some(
      (term) =>
        !genericSourceFollowUpTokens.has(term) &&
        nonSubstantiveKnowledgeIdentifierPrefix(term) === null &&
        !identifierSyntaxTokens.has(term),
    );
  });

  return substantiveRequest ?? knowledgeRequests.at(-1) ?? null;
}
export function knowledgeTermsMatch(
  expected: readonly string[],
  actual: readonly string[],
  optionalExpected: readonly string[] = [],
): boolean {
  const conceptAliases = {
    document: ["文", "档", "document", "documents"],
    emissions: ["排", "放", "emission", "emissions"],
    limits: ["限", "值", "limit", "limits", "threshold", "thresholds"],
    "non-road": ["非", "道", "路", "non", "road", "nonroad"],
    "original-text": ["原", "文", "original", "text"],
    "page-locator": ["页", "码", "page", "pages"],
    regulation: ["法", "规", "regulation", "regulations", "rule", "rules"],
    section: ["章", "节", "条", "款", "section", "sections", "clause", "clauses"],
    "source-evidence": [
      "来",
      "源",
      "证",
      "据",
      "source",
      "sources",
      "citation",
      "citations",
      "evidence",
    ],
  } as const;
  const actualTerms = new Set(actual);
  const expectedTerms = new Set(expected);
  const sharedTerms = expected.filter((term) => actualTerms.has(term));
  const conceptsIn = (terms: readonly string[]): Set<string> => {
    const values = new Set(terms);
    const concepts = new Set<string>();
    const hasAll = (...tokens: string[]) => tokens.every((token) => values.has(token));
    const hasAny = (...tokens: string[]) => tokens.some((token) => values.has(token));

    if (hasAll("非", "道", "路") || hasAll("non", "road") || hasAny("nonroad")) concepts.add("non-road");
    if (hasAll("文", "档") || hasAny("document", "documents")) concepts.add("document");
    if (hasAll("排", "放") || hasAny("emission", "emissions")) concepts.add("emissions");
    if (hasAll("限", "值") || hasAny("limit", "limits", "threshold", "thresholds")) concepts.add("limits");
    if (hasAll("法", "规") || hasAny("regulation", "regulations", "rule", "rules")) concepts.add("regulation");
    if (hasAll("原", "文") || hasAll("original", "text")) concepts.add("original-text");
    if (hasAny("页", "码", "page", "pages") || terms.some((term) => term.startsWith("ref:page:"))) concepts.add("page-locator");
    if (hasAny("章", "节", "条", "款", "section", "sections", "clause", "clauses") || terms.some((term) => /^ref:(?:section|clause|part|annex|appendix):/u.test(term))) concepts.add("section");
    if (
      hasAll("来", "源") ||
      hasAll("证", "据") ||
      hasAny("source", "sources", "citation", "citations", "evidence")
    ) {
      concepts.add("source-evidence");
    }
    return concepts;
  };
  const expectedConcepts = conceptsIn(expected);
  const actualConcepts = conceptsIn(actual);
  const sharedConceptCount = [...expectedConcepts].filter((concept) =>
    actualConcepts.has(concept),
  ).length;
  const sharedConcepts = new Set(
    [...expectedConcepts].filter((concept) => actualConcepts.has(concept)),
  );
  const actualHasOnlyBoundTerms = actual.every(
    (term) =>
      expectedTerms.has(term) ||
      Object.entries(conceptAliases).some(
        ([concept, aliases]) =>
          sharedConcepts.has(concept) &&
          (aliases as readonly string[]).includes(term),
      ),
  );
  const optional = new Set(optionalExpected);
  const expectedTermsAreCovered = expected.filter((term) => !optional.has(term)).every(
    (term) =>
      actualTerms.has(term) ||
      Object.entries(conceptAliases).some(
        ([concept, aliases]) =>
          sharedConcepts.has(concept) &&
          (aliases as readonly string[]).includes(term),
      ),
  );

  return (
    actualHasOnlyBoundTerms &&
    expectedTermsAreCovered &&
    (sharedTerms.some((term) => !/^\p{Script=Han}$/u.test(term)) ||
      sharedTerms.filter((term) => /^\p{Script=Han}$/u.test(term)).length >= 2 ||
      sharedConceptCount >= 2)
  );
}

/** The same nonempty business-term contract before retrieval and after delivery. */
export function knowledgeQuerySatisfies(
  expected: readonly string[] | undefined,
  actual: readonly string[] | undefined,
  optionalExpected: readonly string[] = [],
): boolean {
  return expected === undefined || (
    expected.length > 0 && actual !== undefined && actual.length > 0 &&
    knowledgeTermsMatch(expected, actual, optionalExpected)
  );
}

type TextReplacement = { start: number; end: number; value: string };

/** Remove only request wrappers; metadata dates are enforced by asOf, not FTS. */
function sourceSearchTextIn(text: string): string {
  const trimmed = text.trim();
  const prefix = /^(?:(?:please\s+)?(?:retrieve|search(?:\s+for)?|find|show(?:\s+me)?)\s+|(?:请|帮我)?(?:检索|查询|查找|搜索|查)(?:一下)?\s*)/iu.exec(trimmed);
  const unwrapped = prefix && !insideIdentifier(trimmed, 0, prefix[0].length)
    ? trimmed.slice(prefix[0].length) : trimmed;
  const quoted = knowledgeQuotedSpans(unwrapped);
  const signed = knowledgeSignedOperandSpans(unwrapped);
  // Keep a boundary when removing metadata: adjacent wording must not become
  // part of the preceding signed operand or compound identifier.
  const metadata = /(?<![\p{L}\p{N}_/.@-])(?:as\s+of|截至|截止到|日期[：:]?)\s*\d{4}-\d{2}-\d{2}(?![\p{L}\p{N}_/-])/giu;
  return replaceSpans(unwrapped, Array.from(unwrapped.matchAll(metadata)).flatMap((match) => {
    const start = match.index;
    let end = start + match[0].length;
    if (/^(?:截至|截止到)/u.test(match[0])) {
      const connective = /^\s+的/u.exec(unwrapped.slice(end));
      if (connective) {
        const next = unwrapped.slice(end + connective[0].length);
        // Consume only a standalone metadata connector or its attachment to
        // an already-recognized scope, not words such as 的确 or 的士.
        if ((next.length === 0 || /^[\s,，;；。]/u.test(next) ||
          applicationScopeMentionsIn(next).some((mention) => mention.start === 0)) &&
          !insideIdentifier(unwrapped, end + connective[0].length - 1, end + connective[0].length)) {
          end += connective[0].length;
        }
      }
    }
    return insideIdentifier(unwrapped, start, end) ||
      quoted.some((span) => span.start < end && span.end > start) ||
      (signed.some((span) => span.start <= start && span.end > start) &&
        !/[,，;；。]/u.test(unwrapped[start - 1] ?? "")) ? [] : [{ start, end, value: " " }];
  })).trim();
}

function replaceSpans(text: string, replacements: readonly TextReplacement[]): string {
  let result = text;
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    result = result.slice(0, replacement.start) + replacement.value + result.slice(replacement.end);
  }
  return result;
}

/** Recognized request controls, never a projection of model-supplied queries. */
function projectKnowledgeRequestControls(text: string): string {
  const tailPatterns = [
    /(^|[.!?;,\n，；。！？]\s*)((?:and\s+)?(?:stop\s+if\s+no\s+(?:source\s+)?evidence\s+is\s+found|if\s+no\s+(?:source\s+)?evidence\s+is\s+found,\s*stop)|(?:如|若)?(?:没有|无)(?:来源)?证据(?:时|则)(?:停止|停止检索))[.!?。！\s]*$/iu,
    /(^|[.!?;\n。；！？]\s*)((?:用户粘贴的|用户提供的|我粘贴的)(?:不可信|未验证)(?:文字|文本|内容)(?:是)?[：:])[\s\S]+[。.!?]\s*(?:只|仅)(?:把|将)它当(?:作)?数据[。.!?\s]*$/u,
    /(^|[.!?;\n]\s*)((?:the\s+)?(?:user[- ]pasted|user[- ]provided)\s+untrusted\s+(?:text|content)\s+is:\s*)[\s\S]+[.!?]\s*(?:treat\s+it\s+only\s+as\s+data|treat\s+it\s+as\s+data\s+only)[.!?\s]*$/iu,
  ];
  for (const pattern of tailPatterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const start = match.index + match[1]!.length;
    const labelEnd = start + match[2]!.length;
    // A quoted/signed control-looking literal remains search data. Explicit
    // pasted-data labels delimit their body; no text is inspected as commands.
    const firstWordEnd = start + (match[2]!.match(/^\S+/u)?.[0].length ?? 0);
    if (knowledgeQueryLiteralSpans(text).some((span) => span.start < labelEnd && span.end > start) ||
      insideIdentifier(text, start, firstWordEnd)) continue;
    const before = text.slice(0, start);
    // Do not erase the right-hand operand of a native OR expression.
    if (/\bor\s*[.!?;,，；。！？]*\s*$/iu.test(maskKnowledgeQueryLiterals(before))) continue;
    return before.trim();
  }
  return text;
}

/** A complete search-request grammar; its captured context and term stay exact. */
function unwrapKnowledgeTermRequest(text: string): string {
  const trimmed = text.trim();
  const match = /^(?:please\s+)?search\s+(?:the\s+)?(.{1,120}?)\s+knowledge\s+base\s+for\s+(?:the\s+)?(?:nonexistent\s+)?term\s+/iu.exec(trimmed);
  if (!match || knowledgeQueryLiteralSpans(trimmed).some((span) => span.start < match[0].length) ||
    /\bor\b/iu.test(match[0]) || insideIdentifier(trimmed, 0, match[0].length)) return text;
  const term = trimmed.slice(match[0].length);
  if (!/[\p{L}\p{N}]/u.test(term)) return text;
  return `${match[1]} ${term}`;
}

function withCurrentScope(text: string, context: ConversationBusinessContext): string {
  const metadataText = maskKnowledgeQueryLiterals(text);
  const originalScope = resolveApplicationScopeIntent(metadataText, { applicationScope: null, hasScopeConflict: false });
  const scope = context.applicationScope;
  if (scope === null || originalScope.applicationScope === scope) return text;
  const mentions = applicationScopeMentionsIn(metadataText);
  if (mentions.length === 0) return appendKnowledgeQueryTerms(text, [scope]);
  return replaceSpans(text, mentions.map((mention) => ({
    start: mention.start, end: mention.end,
    value: /\p{Script=Han}/u.test(mention.value)
      ? ` ${applicationScopeLabel(scope, getDictionary("zh-CN"))} `
      : scope,
  })));
}

function withCurrentCountry(text: string, context: ConversationBusinessContext): string {
  if (context.countryIso3s.length !== 1) return text;
  return replaceSpans(text, countryMentionsIn(maskKnowledgeQueryLiterals(text)).filter((mention) =>
    !insideIdentifier(text, mention.index, mention.index + mention.length),
  ).map((mention) => ({ start: mention.index, end: mention.index + mention.length,
    value: ` ${context.countryIso3s[0]!} ` }))).trim();
}

function renderReference(term: string): string {
  if (term.startsWith("power:")) return term.slice("power:".length).replace(/kw$/u, " kW");
  const [, label, identifier] = term.split(":");
  return `${label} ${identifier}`;
}

function referenceSpansIn(text: string): Array<TextReplacement & { terms: string[] }> {
  const literals = knowledgeQueryLiteralSpans(text);
  return referencePatterns.flatMap((pattern) => Array.from(text.matchAll(pattern)).flatMap((match) => {
    const end = match.index + match[0].length;
    if (literals.some((span) => span.start < end && span.end > match.index)) return [];
    if (insideIdentifier(text, match.index, end)) return [];
    return [{ start: match.index, end, value: match[0], terms: knowledgeIdentifierTermsIn(match[0]) }];
  }));
}

function withCurrentReferences(text: string, terms: readonly string[]): string {
  const references = terms.filter((term) => replaceableKnowledgeIdentifierPrefix(term) !== null);
  const replacements = referenceSpansIn(text).flatMap((span) => {
    const old = span.terms.find((term) => replaceableKnowledgeIdentifierPrefix(term) !== null);
    const prefix = old === undefined ? null : replaceableKnowledgeIdentifierPrefix(old);
    if (prefix === null) return [];
    const current = references.filter((term) => term.startsWith(prefix));
    if (current.length === 0 || (current.length === 1 && current[0] === old)) return [];
    return [{ ...span, value: current.map(renderReference).join(" ") }];
  });
  const projected = replaceSpans(text, replacements);
  const present = new Set(knowledgeIdentifierTermsIn(projected));
  const additional = references.filter((term) => !present.has(term)).map(renderReference);
  return appendKnowledgeQueryTerms(projected, additional).trim();
}

const sourceRequirementWords = new Set([
  "document", "documents", "original", "text", "page", "pages", "section", "sections", "clause", "clauses",
  "source", "sources", "citation", "citations", "evidence", "文", "档", "原", "页", "码", "章", "节", "条", "款", "来", "源", "证", "据",
]);

function signedRefinementHasUnboundWords(text: string): boolean {
  const metadata = sourceSearchTextIn(maskKnowledgeSignedOperands(text));
  const fields = [
    ...countryMentionsIn(metadata).map((mention) => ({ start: mention.index, end: mention.index + mention.length })),
    ...applicationScopeMentionsIn(metadata),
    ...referenceSpansIn(metadata),
  ];
  const controls = replaceSpans(metadata, fields.map((span) => ({
    ...span, value: " ".repeat(span.end - span.start),
  })));
  // Complete metadata values were removed above. An orphan unit or half of
  // "non road" is now query wording, not a safe filter update to discard.
  const orphanWords = new Set(["kw", "kilowatt", "kilowatts", "non", "road", "千", "瓦"]);
  return knowledgeTermsIn(controls).some((term) => orphanWords.has(term) ||
    (!genericSourceFollowUpTokens.has(term) && !sourceRequirementWords.has(term)));
}

function knowledgeDeliveryIn(query: string, terms: readonly string[], countries: readonly string[]): {
  delivery: KnowledgeDeliveryRequirements; optionalTerms: string[];
} {
  const { cues, connectives: deliveryConnectives } = extractKnowledgeDeliveryCues(query);
  const requiredTerms = new Set(knowledgeTermsIn(replaceSpans(query, [...cues, ...deliveryConnectives]), countries));
  const pages = terms.filter((term) => term.startsWith("ref:page:")).map((term) => term.slice("ref:page:".length));
  const sections = terms.filter((term) => /^ref:(?:section|clause|part|annex|appendix):/u.test(term));
  return {
    delivery: {
      pageLocator: pages.length > 0 || cues.some(({ kind }) => kind === "page"),
      sectionLocator: sections.length > 0 || cues.some(({ kind }) => kind === "section"),
      pages, sections,
    },
    // Never make identifiers or words that also occur in a literal optional.
    optionalTerms: terms.filter((term) => !term.includes(":") && !requiredTerms.has(term)),
  };
}

/**
 * The evidence gate and deterministic Demo share the retained question, not
 * the model's proposed search. A new substantive topic replaces the old one;
 * scope/locator/control-only follow-ups cannot discard the original deliverables.
 * Query text is projected by spans so quotes, OR and native negation survive.
 */
export function buildKnowledgeRequestContext(
  userTexts: readonly string[],
  context: ConversationBusinessContext,
): { query: string; terms: string[]; requiresRestatement: boolean; delivery: KnowledgeDeliveryRequirements; optionalTerms: string[] } {
  // Only this trusted-request projection removes controls. The complete caller
  // texts still own context/safety checks, and actual tool queries remain intact.
  const requestTexts = userTexts.map(projectKnowledgeRequestControls);
  const request = latestSubstantiveKnowledgeRequestIn(requestTexts, context.countryIso3s) ??
    { index: Math.max(0, requestTexts.length - 1), text: requestTexts.at(-1) ?? "" };
  const countries = uniqueCountries([...context.countryIso3s, ...countryIso3sIn(request.text)]);
  const scopedText = withCurrentScope(sourceSearchTextIn(unwrapKnowledgeTermRequest(request.text)), context);
  let terms = knowledgeTermsIn(scopedText, countries);
  const signedRefinements: string[] = [];
  let requiresRestatement = false;
  for (const followUp of requestTexts.slice(request.index + 1)) {
    const task = activeConversationTaskIn(followUp);
    // Normalize the whole turn before slicing signed operands, just as for
    // the original request. Otherwise `-word,as of ...` becomes `-word,as`
    // and silently changes the native exclusion. Quoted dates stay literal.
    const followUpQuery = sourceSearchTextIn(followUp);
    const signed = task === null || task === "knowledge"
      ? knowledgeSignedOperandSpans(followUpQuery).map((span) => followUpQuery.slice(span.start, span.end)) : [];
    if (signed.length > 0) {
      // Appending a new operand to an OR expression would affect only its
      // final branch. Ask for the complete query rather than invent grouping
      // (websearch parentheses do not provide SQL/Boolean grouping).
      if (/\bor\b/iu.test(maskKnowledgeQueryLiterals(`${scopedText} ${followUp}`)) ||
        signedRefinementHasUnboundWords(followUpQuery)) requiresRestatement = true;
      signedRefinements.push(...signed);
    }
    const identifiers = knowledgeIdentifierTermsIn(followUp).filter((term) => replaceableKnowledgeIdentifierPrefix(term) !== null);
    terms = mergeContextualKnowledgeIdentifiers(terms, identifiers);
    if (activeConversationTaskIn(followUp) === "knowledge") {
      const requested = knowledgeTermsIn(followUp, uniqueCountries([...countries, ...countryIso3sIn(followUp)]))
        .filter((term) => sourceRequirementWords.has(term));
      // An equivalent localized spelling does not add a second requirement.
      if (!knowledgeTermsMatch(terms, [...terms, ...requested])) terms = [...new Set([...terms, ...requested])];
    }
  }
  if (context.powerKw !== null) {
    terms = mergeContextualKnowledgeIdentifiers(terms, [`power:${context.powerKw}kw`]);
  }
  let query = withCurrentReferences(withCurrentCountry(scopedText, context), terms);
  const queryTerms = knowledgeTermsIn(query, countries);
  const additionalRequirements = terms.filter((term) => sourceRequirementWords.has(term) && !queryTerms.includes(term));
  if (!knowledgeTermsMatch(terms, queryTerms) && additionalRequirements.length > 0) {
    query = appendKnowledgeQueryTerms(query, additionalRequirements);
  }
  for (const refinement of signedRefinements) {
    query = appendKnowledgeQueryTerms(query, [refinement]);
    terms = [...new Set([...terms, ...knowledgeTermsIn(refinement, countries)])];
  }
  // Never truncate a query to fit the tool cap: Zod and the evidence boundary
  // must reject an unrepresentable request instead of silently dropping terms.
  return { query, terms, requiresRestatement, ...knowledgeDeliveryIn(query, terms, countries) };
}
