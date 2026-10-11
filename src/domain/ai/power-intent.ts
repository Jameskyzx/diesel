/** Preserve a supplied sign: an invalid power must clear, not inherit, a filter. */
export function powerKwsIn(text: string): number[] {
  const prose = text.replace(/(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>"'“”]+/giu, " ");
  return [...new Set(Array.from(prose.matchAll(
    /(?<![\d.])([+\-−]?\d+(?:\.\d+)?)\s*(?:kw|千瓦)(?![\p{Script=Latin}\d_])/giu,
  ), match => Number(match[1]!.replace("−", "-"))))];
}
