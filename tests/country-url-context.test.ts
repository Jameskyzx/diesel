import { describe, expect, it } from "vitest";

import { parseCountryFilters } from "@/features/countries/url-context";

describe("country URL filters", () => {
  it("keeps an absent filter context empty without injecting a date", () => {
    expect(parseCountryFilters({})).toEqual({
      canonicalQuery: "",
      filters: {},
      needsRedirect: false,
    });
    expect(parseCountryFilters({ asOf: undefined, powerKw: [] })).toEqual({
      canonicalQuery: "",
      filters: {},
      needsRedirect: false,
    });
  });

  it.each([
    "on-road",
    "non-road",
    "marine",
    "generator-set",
    "agriculture",
    "construction",
    "on-road-truck",
    "on-road-bus",
  ])("accepts the existing application scope %s", (applicationScope) => {
    expect(parseCountryFilters({ applicationScope })).toEqual({
      canonicalQuery: `applicationScope=${applicationScope}`,
      filters: { applicationScope },
      needsRedirect: false,
    });
  });

  it.each([
    ["0", 0, false],
    ["100000", 100000, false],
    ["0.001", 0.001, false],
    ["300.0", 300, true],
    ["5.6e1", 56, true],
    ["0.0010", 0.001, true],
    [" 300 ", 300, true],
    ["+300", 300, true],
    ["00300", 300, true],
    ["3e2", 300, true],
    [".125", 0.125, true],
  ] as const)("parses powerKw=%s with the existing decimal rules", (raw, powerKw, needsRedirect) => {
    expect(parseCountryFilters({ powerKw: raw })).toEqual({
      canonicalQuery: `powerKw=${powerKw}`,
      filters: { powerKw },
      needsRedirect,
    });
  });

  it.each([
    ["applicationScope", ""],
    ["applicationScope", "NON-ROAD"],
    ["applicationScope", " non-road "],
    ["applicationScope", "unknown"],
    ["asOf", ""],
    ["asOf", "not-a-date"],
    ["asOf", "2025-02-29"],
    ["asOf", "2026-04-31"],
    ["asOf", "2026-09-14T00:00:00Z"],
    ["asOf", " 2026-09-14 "],
    ["powerKw", ""],
    ["powerKw", " "],
    ["powerKw", "-0.001"],
    ["powerKw", "100000.001"],
    ["powerKw", "1.0001"],
    ["powerKw", "55.999999999999999999"],
    ["powerKw", "100000.000000000001"],
    ["powerKw", "-1e-999"],
    ["powerKw", "1e-999"],
    ["powerKw", "NaN"],
    ["powerKw", "Infinity"],
    ["powerKw", "1e999"],
    ["powerKw", "0x10"],
    ["productModelCode", ""],
    ["productModelCode", " \t "],
    ["productModelCode", "A".repeat(101)],
  ])("removes invalid %s=%s without discarding unknown metadata", (key, value) => {
    expect(parseCountryFilters({ [key]: value, utm_source: "shared" })).toEqual({
      canonicalQuery: "utm_source=shared",
      filters: {},
      needsRedirect: true,
    });
  });

  it("drops invalid fields independently and retains the remaining context", () => {
    expect(parseCountryFilters({
      applicationScope: "non-road",
      asOf: "2025-02-29",
      powerKw: "300.0",
      productModelCode: " demo-eng-300 ",
      utm_source: "interview",
    })).toEqual({
      canonicalQuery: "applicationScope=non-road&powerKw=300&productModelCode=DEMO-ENG-300&utm_source=interview",
      filters: {
        applicationScope: "non-road",
        powerKw: 300,
        productModelCode: "DEMO-ENG-300",
      },
      needsRedirect: true,
    });
  });

  it("accepts a valid leap date and a trimmed 100-character product model", () => {
    const model = "A".repeat(100);
    expect(parseCountryFilters({
      asOf: "2024-02-29",
      productModelCode: ` ${model.toLowerCase()} `,
    })).toEqual({
      canonicalQuery: `asOf=2024-02-29&productModelCode=${model}`,
      filters: { asOf: "2024-02-29", productModelCode: model },
      needsRedirect: true,
    });
  });

  it("collapses each repeated known filter to its first value", () => {
    expect(parseCountryFilters({
      applicationScope: ["non-road", "marine"],
      asOf: ["2026-09-14", "2024-02-29"],
      powerKw: ["300", "100"],
      productModelCode: ["DEMO-ENG-300", "DEMO-ENG-100"],
    })).toEqual({
      canonicalQuery: "applicationScope=non-road&asOf=2026-09-14&powerKw=300&productModelCode=DEMO-ENG-300",
      filters: {
        applicationScope: "non-road",
        asOf: "2026-09-14",
        powerKw: 300,
        productModelCode: "DEMO-ENG-300",
      },
      needsRedirect: true,
    });
  });

  it("removes a repeated known field when its first value is invalid", () => {
    expect(parseCountryFilters({
      applicationScope: ["invalid", "non-road"],
      asOf: ["", "2026-09-14"],
      powerKw: ["NaN", "300"],
      productModelCode: [" ", "DEMO-ENG-300"],
    })).toEqual({ canonicalQuery: "", filters: {}, needsRedirect: true });
  });

  it("collapses even identical repeated known values", () => {
    expect(parseCountryFilters({ powerKw: ["300", "300"] })).toEqual({
      canonicalQuery: "powerKw=300",
      filters: { powerKw: 300 },
      needsRedirect: true,
    });
  });

  it("does not round an invalid first power or replace it with a later valid value", () => {
    expect(parseCountryFilters({
      applicationScope: "non-road",
      asOf: "2026-09-14",
      powerKw: ["55.999999999999999999", "100"],
      utm_source: ["first", "second"],
    })).toEqual({
      canonicalQuery: "applicationScope=non-road&asOf=2026-09-14&utm_source=first&utm_source=second",
      filters: { applicationScope: "non-road", asOf: "2026-09-14" },
      needsRedirect: true,
    });
  });

  it("preserves unknown repeated values, empty values, and prototype-named own keys", () => {
    const raw = Object.fromEntries([
      ["__proto__", ["first", "second"]],
      ["constructor", ["original", "replacement"]],
      ["toString", ["", "custom"]],
      ["utm_source", ["中文 campaign", "a+b&c=d"]],
    ]);
    const result = parseCountryFilters(raw);
    const query = new URLSearchParams(result.canonicalQuery);

    expect(query.getAll("__proto__")).toEqual(["first", "second"]);
    expect(query.getAll("constructor")).toEqual(["original", "replacement"]);
    expect(query.getAll("toString")).toEqual(["", "custom"]);
    expect(query.getAll("utm_source")).toEqual(["中文 campaign", "a+b&c=d"]);
    expect(result.filters).toEqual({});
    expect(result.needsRedirect).toBe(false);
    expect(Object.getPrototypeOf(raw)).toBe(Object.prototype);
  });

  it("does not redirect merely because input keys have a different order", () => {
    expect(parseCountryFilters({
      utm_source: "shared",
      productModelCode: "DEMO-ENG-300",
      powerKw: "300",
      asOf: "2026-09-14",
      applicationScope: "non-road",
    }).needsRedirect).toBe(false);
  });

  it("can parse its canonical output without another redirect", () => {
    const initial = parseCountryFilters({
      applicationScope: ["non-road", "marine"],
      asOf: "invalid",
      powerKw: "300.0",
      productModelCode: " demo-eng-300 ",
      utm_source: ["first", "second"],
    });
    const query = new URLSearchParams(initial.canonicalQuery);
    const result = parseCountryFilters(Object.fromEntries(
      [...new Set(query.keys())].map((key) => [key, query.getAll(key)]),
    ));

    expect(result).toEqual({ ...initial, needsRedirect: false });
  });
});
