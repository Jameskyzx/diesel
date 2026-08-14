/**
 * Formats a database decimal without crossing the JavaScript Number boundary.
 * This preserves every digit in numeric(18,6) and numeric(24,6) values.
 */
export function formatDecimalForDisplay(value: string): string {
  const match = value.match(/^([+-]?)(\d+)(?:\.(\d*))?$/u);
  if (!match) {
    return value;
  }

  const sign = match[1] ?? "";
  const integer = match[2] ?? "0";
  const fractional = (match[3] ?? "").replace(/0+$/u, "");
  const groupedInteger = integer.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");

  return fractional
    ? `${sign}${groupedInteger}.${fractional}`
    : `${sign}${groupedInteger}`;
}
