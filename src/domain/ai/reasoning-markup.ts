const characterReferencePattern =
  /&(?:(?:amp|lt|gt);|#x0*([0-9a-f]{1,6})(?:;|(?![0-9a-f]))|#0*([0-9]{1,7})(?:;|(?![0-9])))/giu;
const namedCharacterReferenceSource = "&[a-z][a-z0-9]+;";
const maximumCharacterReferencePasses = 16;

function allowNamedReferencesBetweenCharacters(value: string): string {
  return value
    .split("")
    .join(`(?:${namedCharacterReferenceSource})*`);
}

const reasoningMarkupWithNamedReferencesPattern = new RegExp(
  `<(?:\\s|${namedCharacterReferenceSource})*\\/?` +
    `(?:\\s|${namedCharacterReferenceSource})*` +
    `(?:${[
      "think",
      "thinking",
      "analysis",
      "reasoning",
    ].map(allowNamedReferencesBetweenCharacters).join("|")})` +
    `(?=[\\s/>]|${namedCharacterReferenceSource})`,
  "iu",
);

function decodeCharacterReference(
  match: string,
  hexadecimal: string | undefined,
  decimal: string | undefined,
): string {
  const lower = match.toLocaleLowerCase("en-US");
  if (lower === "&amp;") {
    return "&";
  }
  if (lower === "&lt;") {
    return "<";
  }
  if (lower === "&gt;") {
    return ">";
  }

  const codePoint = Number.parseInt(
    hexadecimal ?? decimal ?? "",
    hexadecimal === undefined ? 10 : 16,
  );
  return Number.isSafeInteger(codePoint) &&
      codePoint >= 0 &&
      codePoint <= 0x10_FFFF &&
      !(codePoint >= 0xD800 && codePoint <= 0xDFFF)
    ? String.fromCodePoint(codePoint)
    : match;
}

function canonicalizeReasoningMarkupText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\p{Default_Ignorable_Code_Point}+/gu, "");
}

function normalizeReasoningMarkupEntities(text: string): string {
  let normalized = canonicalizeReasoningMarkupText(text);

  for (let pass = 0; pass < maximumCharacterReferencePasses; pass += 1) {
    const decoded = canonicalizeReasoningMarkupText(
      normalized.replace(characterReferencePattern, decodeCharacterReference),
    );
    if (decoded === normalized) {
      return normalized;
    }
    normalized = decoded;
  }

  characterReferencePattern.lastIndex = 0;
  // Excessive supported-entity nesting is provider-controlled ambiguity. It
  // is safer to classify it as private markup than to release text before a
  // complete bounded decode.
  return characterReferencePattern.test(normalized) ? "<analysis>" : normalized;
}

export function containsEmbeddedReasoningMarkup(text: string): boolean {
  const normalized = normalizeReasoningMarkupEntities(text);

  return (
    /<\s*\/?\s*(?:think(?:ing)?|analysis|reasoning)(?=[\s/>]|$)/iu.test(
      normalized,
    ) || reasoningMarkupWithNamedReferencesPattern.test(normalized)
  );
}
