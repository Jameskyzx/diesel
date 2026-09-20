import { describe, expect, it } from "vitest";

import { countryDirectoryDisplayIdentity } from "@/features/countries/directory-display";
import {
  countryDirectoryEntrySchema,
  countryMapSummarySchema,
} from "@/features/countries/schemas";
import { formatCountryDisplayName } from "@/i18n/country-name";

const chinaDirectoryEntry = countryDirectoryEntrySchema.parse({
  hasGeometry: true,
  iso2: "CN",
  iso3: "CHN",
  name: "People's Republic of China",
});

function chinaSummary(
  overrides: Partial<ReturnType<typeof countryMapSummarySchema.parse>> = {},
) {
  return countryMapSummarySchema.parse({
    dataCoverageStatus: "demo",
    isDemo: true,
    iso2: "CN",
    iso3: "CHN",
    isStale: false,
    nameEn: "China — demo fixture",
    nameLocal: "中国（演示数据）",
    verifiedAt: "2026-08-31T00:00:00.000Z",
    ...overrides,
  });
}

describe("country directory display identity", () => {
  it("uses the governed summary classification for the same canonical ISO3", () => {
    const identity = countryDirectoryDisplayIdentity(
      chinaDirectoryEntry,
      chinaSummary(),
    );

    expect(identity.isDemo).toBe(true);
    expect(formatCountryDisplayName(identity, "en")).toBe(
      "China — demo fixture",
    );
    expect(formatCountryDisplayName(identity, "zh-CN")).toBe(
      "中国（演示数据）",
    );
  });

  it("keeps Demo classification and raw copy when secondary identity drifts", () => {
    const identity = countryDirectoryDisplayIdentity(
      chinaDirectoryEntry,
      chinaSummary({ iso2: "XX" }),
    );

    expect(identity.isDemo).toBe(true);
    expect(formatCountryDisplayName(identity, "zh-CN")).toBe(
      "China — demo fixture",
    );
  });

  it("does not infer Demo classification from a canonical-looking name", () => {
    const identity = countryDirectoryDisplayIdentity(
      chinaDirectoryEntry,
      chinaSummary({ dataCoverageStatus: "covered", isDemo: false }),
    );

    expect(identity.isDemo).toBe(false);
    expect(formatCountryDisplayName(identity, "zh-CN")).toBe(
      "China — demo fixture",
    );
  });

  it("falls back to the static catalog for a missing or different ISO3 summary", () => {
    const missingIdentity = countryDirectoryDisplayIdentity(
      chinaDirectoryEntry,
      undefined,
    );
    const differentCountryIdentity = countryDirectoryDisplayIdentity(
      chinaDirectoryEntry,
      chinaSummary({ iso2: "BR", iso3: "BRA" }),
    );

    expect(missingIdentity).toEqual(differentCountryIdentity);
    expect(missingIdentity.isDemo).toBe(false);
    expect(formatCountryDisplayName(missingIdentity, "zh-CN")).toBe("中国");
  });
});
