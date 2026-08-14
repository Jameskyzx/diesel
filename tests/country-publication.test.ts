import { describe, expect, it } from "vitest";

import {
  isDemoCountryProfile,
  isDemoCountrySummary,
  isDemoJurisdiction,
  isDemoMarketMetric,
  isDemoRegulation,
  publicMapClassification,
} from "@/features/countries/publication";

describe("public country-data classification", () => {
  it.each([
    [{ dataCoverageStatus: "demo", isDemo: false }, true],
    [{ dataCoverageStatus: "covered", isDemo: true }, true],
    [{ dataCoverageStatus: "covered", isDemo: false }, false],
  ])("classifies map summaries without trusting only one flag", (input, expected) => {
    expect(isDemoCountrySummary(input)).toBe(expected);
  });

  it("treats a Demo country source as a Demo profile", () => {
    expect(
      isDemoCountryProfile({
        dataCoverageStatus: "covered",
        isDemo: false,
        source: { isDemo: true },
      }),
    ).toBe(true);
  });

  it("redacts Demo coverage in public mode and preserves it in Demo mode", () => {
    const demoSummary = { dataCoverageStatus: "demo", isDemo: true };

    expect(publicMapClassification(demoSummary, false)).toEqual({
      dataCoverageStatus: "no_data",
      isDemo: false,
    });
    expect(publicMapClassification(demoSummary, true)).toBe(demoSummary);
  });

  it.each([
    ["jurisdiction", { isDemo: true }],
    ["membership", { membershipIsDemo: true }],
    ["jurisdiction source", { source: { isDemo: true } }],
    ["membership source", { membershipSource: { isDemo: true } }],
  ])("rejects a Demo-classified %s", (_label, override) => {
    expect(
      isDemoJurisdiction({
        isDemo: false,
        membershipIsDemo: false,
        membershipSource: { isDemo: false },
        source: { isDemo: false },
        ...override,
      }),
    ).toBe(true);
  });

  it.each<
    [
      string,
      (regulation: Parameters<typeof isDemoRegulation>[0]) => void,
    ]
  >([
    ["regulation", (regulation) => { regulation.isDemo = true; }],
    [
      "regulation source",
      (regulation) => { regulation.source.isDemo = true; },
    ],
    [
      "jurisdiction",
      (regulation) => {
        regulation.applicability.jurisdictionIsDemo = true;
      },
    ],
    [
      "jurisdiction source",
      (regulation) => {
        regulation.applicability.jurisdictionSourceIsDemo = true;
      },
    ],
    [
      "membership",
      (regulation) => {
        regulation.applicability.membershipIsDemo = true;
      },
    ],
    [
      "membership source",
      (regulation) => {
        regulation.applicability.membershipSourceIsDemo = true;
      },
    ],
  ])("rejects a regulation with a Demo-classified %s", (_label, classifyAsDemo) => {
    const regulation = {
      applicability: {
        jurisdictionIsDemo: false,
        jurisdictionSourceIsDemo: false,
        membershipIsDemo: false,
        membershipSourceIsDemo: false,
      },
      isDemo: false,
      source: { isDemo: false },
    };
    classifyAsDemo(regulation);

    expect(isDemoRegulation(regulation)).toBe(true);
  });

  it("keeps a regulation whose complete evidence chain is non-Demo", () => {
    expect(
      isDemoRegulation({
        applicability: {
          jurisdictionIsDemo: false,
          jurisdictionSourceIsDemo: false,
          membershipIsDemo: false,
          membershipSourceIsDemo: false,
        },
        isDemo: false,
        source: { isDemo: false },
      }),
    ).toBe(false);
  });

  it.each([
    [{ isDemo: true, source: { isDemo: false } }, true],
    [{ isDemo: false, source: { isDemo: true } }, true],
    [{ isDemo: false, source: { isDemo: false } }, false],
  ])("classifies market metrics and their sources", (input, expected) => {
    expect(isDemoMarketMetric(input)).toBe(expected);
  });
});
