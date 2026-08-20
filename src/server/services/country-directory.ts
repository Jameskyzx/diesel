import "server-only";

import rawGeometryIndex from "../../../public/geo/world-countries-index.json";

import {
  countryDirectorySchema,
  countryGeoIndexSchema,
  type CountryDirectory,
} from "@/features/countries/schemas";
import { countryCatalog } from "@/server/db/seed/country-catalog";

const geometryIso3s = new Set(
  countryGeoIndexSchema.parse(rawGeometryIndex).map(({ iso3 }) => iso3),
);

const directory = countryDirectorySchema.parse(
  countryCatalog
    .map(({ iso2, iso3, nameEn }) => ({
      hasGeometry: geometryIso3s.has(iso3),
      iso2,
      iso3,
      name: nameEn,
    }))
    .toSorted((a, b) => a.name.localeCompare(b.name)),
);

const directoryIso3s = new Set(directory.map(({ iso3 }) => iso3));

export function getCountryDirectory(): CountryDirectory {
  return directory;
}

export function isKnownCountryIso3(iso3: string): boolean {
  return directoryIso3s.has(iso3);
}
