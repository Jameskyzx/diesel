/** Reject text that PostgreSQL cannot store or UTF-8 encoding would replace. */
export function isPersistableDocumentText(value: string): boolean {
  // Iteration groups valid surrogate pairs, while isolated surrogates remain
  // single code units. Do not repair or strip characters from source metadata.
  for (const character of value) {
    const codeUnit = character.charCodeAt(0);
    if (
      codeUnit === 0 ||
      (character.length === 1 && codeUnit >= 0xd800 && codeUnit <= 0xdfff)
    ) {
      return false;
    }
  }
  return true;
}
