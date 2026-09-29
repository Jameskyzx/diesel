import type {
  CountryDirectory,
  CountryMapSummary,
} from "@/features/countries/schemas";

export type CountryDirectoryDisplayIdentity = {
  isDemo: boolean;
  iso2: string;
  iso3: string;
  nameEn: string;
  nameLocal: string | null;
};

/**
 * Resolve selector copy from the governed country summary when one exists.
 * ISO3 is the canonical join key. Other identity drift is intentionally kept
 * in the returned summary so the downstream name formatter can fail closed
 * instead of laundering a Demo-looking record through the static catalog.
 */
export function countryDirectoryDisplayIdentity(
  directoryEntry: CountryDirectory[number],
  summary: CountryMapSummary | null | undefined,
): CountryDirectoryDisplayIdentity {
  if (summary?.iso3 === directoryEntry.iso3) {
    return {
      isDemo: summary.isDemo,
      iso2: summary.iso2,
      iso3: summary.iso3,
      nameEn: summary.nameEn,
      nameLocal: summary.nameLocal,
    };
  }

  return {
    isDemo: false,
    iso2: directoryEntry.iso2,
    iso3: directoryEntry.iso3,
    nameEn: directoryEntry.name,
    nameLocal: null,
  };
}
