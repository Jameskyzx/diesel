/**
 * Locale-independent UTF-16 code-unit order for evidence identities and keys.
 * Do not normalize, case-fold, or use host/browser/ICU collation here: producers
 * and validators must derive the same exact order from the same source text.
 * Human-facing alphabetical lists may use their own localized display order.
 */
export function compareCanonicalText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
