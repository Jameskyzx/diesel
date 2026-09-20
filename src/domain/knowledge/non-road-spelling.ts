const spellings = /nonroad|non-road|non\s+road/giu;
const identifierNeighbor = /[\p{Letter}\p{Number}\p{Mark}_./:@%?=+#\\]/u;
const dash = /^[-\u2010-\u2015\u2212]$/u;

function previousCharacter(text: string, index: number): string {
  return Array.from(text.slice(Math.max(0, index - 2), index)).at(-1) ?? "";
}

function isStandalone(text: string, offset: number, length: number): boolean {
  // Inspect Unicode code points, not surrogate halves, with bounded lookaround.
  const before = previousCharacter(text, offset);
  const after = text.slice(offset + length, offset + length + 3);
  const next = Array.from(after)[0] ?? "";
  const trailingProsePunctuation = /^[.?:](?:\s|$|["')\]])/u.test(after);
  if (identifierNeighbor.test(before) || dash.test(next) ||
      (!trailingProsePunctuation && identifierNeighbor.test(next))) return false;
  // Leading dashes are websearch operators; ID-internal dashes are not.
  let prefixEnd = offset;
  while (prefixEnd > 0 && dash.test(text[prefixEnd - 1]!)) prefixEnd -= 1;
  return prefixEnd === offset || !identifierNeighbor.test(previousCharacter(text, prefixEnd));
}

export function hasStandaloneNonRoadSpelling(text: string): boolean {
  for (const match of text.matchAll(spellings)) {
    if (isStandalone(text, match.index, match[0].length)) return true;
  }
  return false;
}

export function replaceStandaloneNonRoadSpellings(
  text: string,
  replace: (spelling: string) => string,
): string {
  return text.replace(spellings, (match: string, offset: number) =>
    isStandalone(text, offset, match.length) ? replace(match) : match);
}
