import type { ComparisonSnapshot } from "./schemas";

type AvailableResponse = Extract<ComparisonSnapshot["responses"][number], { status: "available" }>;
type Regulation = NonNullable<AvailableResponse["applicabilitySummary"]>["country"]["currentEffectiveRegulations"][number];
type Limit = Regulation["limits"][number];

/** Presentation only: never combine pollutants, convert units or rank limits. */
export function buildComparisonRows(snapshot: ComparisonSnapshot) {
  const byCountry = snapshot.responses.map(response => response.status === "available"
    ? (response.applicabilitySummary?.country.currentEffectiveRegulations ?? []).flatMap(regulation =>
      regulation.limits.map(limit => ({ regulation, limit })))
    : []);
  const rows = new Map<string, { key: string; pollutant: string; unit: string; cells: Array<Array<{ regulation: Regulation; limit: Limit }>> }>();
  byCountry.forEach((entries, index) => entries.forEach(entry => {
    const { pollutantCode: pollutant, unitCode: unit } = entry.limit;
    const key = JSON.stringify([pollutant, unit]);
    const row = rows.get(key) ?? { key, pollutant, unit, cells: byCountry.map(() => []) };
    row.cells[index]!.push(entry);
    rows.set(key, row);
  }));
  return [...rows.values()].sort((a, b) => a.pollutant.localeCompare(b.pollutant) || a.unit.localeCompare(b.unit));
}

/** Decimal display without floating-point conversion or precision loss. */
export function formatRecordedLimit(value: string): string {
  return value.includes(".") ? value.replace(/0+$/u, "").replace(/\.$/u, "") : value;
}
