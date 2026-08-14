import type { CountryMapSummary } from "@/features/countries/schemas";
import { hasDetailedCountryCoverage } from "@/features/database/schemas";

const shortcutPriority = new Map(
  ["CHN", "USA", "DEU", "IND", "BRA", "JPN"].map((iso3, index) => [
    iso3,
    index,
  ]),
);

export const MAX_COUNTRY_SHORTCUTS = 8;

export function selectCountryShortcuts(
  countries: readonly CountryMapSummary[],
  limit = MAX_COUNTRY_SHORTCUTS,
): CountryMapSummary[] {
  return countries
    .filter((country) =>
      hasDetailedCountryCoverage(country.dataCoverageStatus),
    )
    .toSorted((a, b) => {
      const priorityDifference =
        (shortcutPriority.get(a.iso3) ?? 100) -
        (shortcutPriority.get(b.iso3) ?? 100);
      return priorityDifference || a.nameEn.localeCompare(b.nameEn);
    })
    .slice(0, Math.max(0, limit));
}
