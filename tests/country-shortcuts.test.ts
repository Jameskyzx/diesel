import { describe, expect, it } from "vitest";

import {
  MAX_COUNTRY_SHORTCUTS,
  selectCountryShortcuts,
} from "@/features/countries/country-shortcuts";
import type { CountryMapSummary } from "@/features/countries/schemas";

function country(index: number): CountryMapSummary {
  const iso2 = [Math.floor(index / 26) % 26, index % 26]
    .map((digit) => String.fromCharCode("A".charCodeAt(0) + digit))
    .join("");
  const iso3 = [
    Math.floor(index / (26 * 26)),
    Math.floor(index / 26) % 26,
    index % 26,
  ]
    .map((digit) => String.fromCharCode("A".charCodeAt(0) + digit))
    .join("");

  return {
    dataCoverageStatus: "covered",
    isDemo: false,
    iso2,
    iso3,
    isStale: false,
    nameEn: `Country ${String(index).padStart(3, "0")}`,
    nameLocal: null,
    verifiedAt: "2026-08-13T00:00:00.000Z",
  };
}

describe("country shortcut selection", () => {
  it("caps a production-scale covered catalog to a short keyboard path", () => {
    const shortcuts = selectCountryShortcuts(
      Array.from({ length: 178 }, (_, index) => country(index)),
    );

    expect(shortcuts).toHaveLength(MAX_COUNTRY_SHORTCUTS);
  });

  it("excludes catalog-only countries and prioritizes interview demo markets", () => {
    const china = { ...country(1), iso3: "CHN", nameEn: "China" };
    const noData = {
      ...country(2),
      dataCoverageStatus: "no_data" as const,
      iso3: "ZZZ",
    };

    expect(selectCountryShortcuts([country(3), noData, china], 2)).toEqual([
      china,
      country(3),
    ]);
  });
});
