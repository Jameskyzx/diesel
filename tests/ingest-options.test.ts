import { describe, expect, it } from "vitest";

import {
  parseIngestOptions,
  selectMarketFixturesForIngestion,
} from "../scripts/db/ingest-options";

describe("accepted fixture ingest options", () => {
  it("normalizes a targeted country to canonical ISO3", () => {
    expect(parseIngestOptions(["--country=nga"])).toEqual({
      countryIso3: "NGA",
      marketOnly: false,
    });
  });

  it("preserves the existing full and market-only modes", () => {
    expect(parseIngestOptions([])).toEqual({ marketOnly: false });
    expect(parseIngestOptions(["--market-only"])).toEqual({
      marketOnly: true,
    });
  });

  it("skips global market fixtures during targeted country ingestion", () => {
    const rows = [{ id: "CHN" }, { id: "USA" }];

    expect(
      selectMarketFixturesForIngestion(rows, {
        countryIso3: "PAK",
        marketOnly: false,
      }),
    ).toEqual([]);
    expect(
      selectMarketFixturesForIngestion(rows, { marketOnly: false }),
    ).toBe(rows);
    expect(
      selectMarketFixturesForIngestion(rows, { marketOnly: true }),
    ).toBe(rows);
  });

  it.each([
    ["unsupported option", ["--all"]],
    ["invalid ISO3", ["--country=NGA1"]],
    ["duplicate country", ["--country=NGA", "--country=KEN"]],
    ["incompatible modes", ["--country=NGA", "--market-only"]],
  ])("rejects %s", (_name, args) => {
    expect(() => parseIngestOptions(args)).toThrow();
  });
});
