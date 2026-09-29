import { describe, expect, it } from "vitest";

import { applicationScopes } from "@/features/database/schemas";
import { getDictionary } from "@/i18n/dictionaries";
import {
  applicationScopeLabel,
  applicationScopeListLabel,
  certificationStatusLabel,
  countryApplicabilityMissingDataMessages,
  countryRegionLabel,
  countrySubregionLabel,
  jurisdictionDisplayName,
  jurisdictionTypeLabel,
  localizedList,
  marketMetricDisplayDefinition,
  marketMetricDisplayName,
  nameWithCode,
  productDisplayName,
  regulationDisplayName,
} from "@/i18n/structured-labels";

const demoChinaJurisdiction = {
  code: "DEMO-CHN-AUTHORITY",
  countryIso3: "CHN",
  id: "00000000-0000-4000-8000-000000000101",
  isDemo: true,
  name: "DEMO ONLY — Fictional China Emissions Authority",
  sourceId: "00000000-0000-4000-8000-000000000002",
  sourceIsDemo: true,
  sourceTitle: "DEMO ONLY — Fictional emissions bulletin",
  type: "country",
} as const;

const demoProduct100 = {
  id: "00000000-0000-4000-8000-000000000201",
  isDemo: true,
  modelCode: "DEMO-ENG-100",
  name: "DEMO ONLY — Fictional Engine 100",
  source: {
    id: "00000000-0000-4000-8000-000000000003",
    isDemo: true,
    title: "DEMO ONLY — Fictional product manual",
  },
  specificationVersion: "demo-v1",
} as const;

describe("structured public labels", () => {
  it("localizes every application-scope enum without exposing its raw code", () => {
    const english = getDictionary("en");
    const chinese = getDictionary("zh-CN");

    expect(
      applicationScopes.map((scope) =>
        applicationScopeLabel(scope, english),
      ),
    ).toEqual([
      "On-road",
      "Non-road",
      "Marine",
      "Generator set",
      "Agriculture",
      "Construction equipment",
      "Truck power",
      "Bus power",
    ]);
    expect(
      applicationScopes.map((scope) =>
        applicationScopeLabel(scope, chinese),
      ),
    ).toEqual([
      "道路",
      "非道路",
      "船舶",
      "发电机组",
      "农业",
      "工程机械",
      "卡车动力",
      "客车动力",
    ]);
    expect(
      applicationScopeListLabel(
        ["non-road", "generator-set"],
        chinese,
        "zh-CN",
      ),
    ).toBe("非道路、发电机组");
    expect(applicationScopeLabel("future-scope", english)).toBe(
      "Not recorded",
    );
  });

  it.each([
    ["country", "Country", "国家"],
    ["regional", "Regional", "区域"],
    ["international", "International", "国际"],
  ] as const)("localizes the %s jurisdiction type", (type, en, zh) => {
    expect(jurisdictionTypeLabel(type, getDictionary("en"))).toBe(en);
    expect(jurisdictionTypeLabel(type, getDictionary("zh-CN"))).toBe(zh);
  });

  it.each([
    ["AFRICA", "Africa", "非洲"],
    ["AMERICAS", "Americas", "美洲"],
    ["ANTARCTICA", "Antarctica", "南极洲"],
    ["ASIA", "Asia", "亚洲"],
    ["EUROPE", "Europe", "欧洲"],
    ["OCEANIA", "Oceania", "大洋洲"],
  ] as const)("localizes country region %s", (code, en, zh) => {
    expect(countryRegionLabel(code, getDictionary("en"))).toBe(en);
    expect(countryRegionLabel(code, getDictionary("zh-CN"))).toBe(zh);
  });

  it.each([
    ["ANTARCTICA", "Antarctica", "南极洲"],
    ["AUSTRALIA_AND_NEW_ZEALAND", "Australia and New Zealand", "澳大利亚和新西兰"],
    ["CARIBBEAN", "Caribbean", "加勒比地区"],
    ["CENTRAL_AMERICA", "Central America", "中美洲"],
    ["CENTRAL_ASIA", "Central Asia", "中亚"],
    ["EASTERN_AFRICA", "Eastern Africa", "东非"],
    ["EASTERN_ASIA", "Eastern Asia", "东亚"],
    ["EASTERN_EUROPE", "Eastern Europe", "东欧"],
    ["MELANESIA", "Melanesia", "美拉尼西亚"],
    ["MIDDLE_AFRICA", "Middle Africa", "中非"],
    ["NORTHERN_AFRICA", "Northern Africa", "北非"],
    ["NORTHERN_AMERICA", "Northern America", "北美地区"],
    ["NORTHERN_EUROPE", "Northern Europe", "北欧"],
    ["SEVEN_SEAS_OPEN_OCEAN", "Seven seas (open ocean)", "七海（公海）"],
    ["SOUTHERN_AFRICA", "Southern Africa", "南部非洲"],
    ["SOUTHERN_ASIA", "Southern Asia", "南亚"],
    ["SOUTHERN_EUROPE", "Southern Europe", "南欧"],
    ["SOUTH_AMERICA", "South America", "南美洲"],
    ["SOUTH_EASTERN_ASIA", "South-Eastern Asia", "东南亚"],
    ["WESTERN_AFRICA", "Western Africa", "西非"],
    ["WESTERN_ASIA", "Western Asia", "西亚"],
    ["WESTERN_EUROPE", "Western Europe", "西欧"],
  ] as const)("localizes country subregion %s", (code, en, zh) => {
    expect(countrySubregionLabel(code, getDictionary("en"))).toBe(en);
    expect(countrySubregionLabel(code, getDictionary("zh-CN"))).toBe(zh);
  });

  it("fails unknown or missing country region codes closed", () => {
    const english = getDictionary("en");
    const chinese = getDictionary("zh-CN");

    expect(countryRegionLabel("FUTURE_REGION", english)).toBe("Not recorded");
    expect(countryRegionLabel(null, chinese)).toBe("未记录");
    expect(countrySubregionLabel("FUTURE_SUBREGION", english)).toBe(
      "Not recorded",
    );
    expect(countrySubregionLabel(undefined, chinese)).toBe("未记录");
  });

  it.each([
    {
      expected: "DEMO ONLY — Fictional China Emissions Authority",
      input: demoChinaJurisdiction,
      locale: "en",
    },
    {
      expected: "仅限 Demo — 中国（演示数据）的虚构排放主管机构",
      input: demoChinaJurisdiction,
      locale: "zh-CN",
    },
    {
      expected: "Ministry of Environment",
      input: {
        ...demoChinaJurisdiction,
        isDemo: false,
        name: "Ministry of Environment",
      },
      locale: "zh-CN",
    },
    {
      expected: "Fictional regional body",
      input: {
        ...demoChinaJurisdiction,
        id: "00000000-0000-4000-8000-000000000999",
        isDemo: true,
        name: "Fictional regional body",
        type: "regional",
      },
      locale: "zh-CN",
    },
  ] as const)(
    "formats a $locale jurisdiction display name without translating real evidence",
    ({ expected, input, locale }) => {
      expect(
        jurisdictionDisplayName(input, getDictionary(locale), locale),
      ).toBe(expected);
    },
  );

  it.each([
    { field: "id", input: { ...demoChinaJurisdiction, id: "drifted-id" } },
    { field: "code", input: { ...demoChinaJurisdiction, code: "DRIFTED" } },
    {
      field: "name",
      input: { ...demoChinaJurisdiction, name: "Drifted authority name" },
    },
    {
      field: "source id",
      input: { ...demoChinaJurisdiction, sourceId: "drifted-source" },
    },
    {
      field: "source title",
      input: { ...demoChinaJurisdiction, sourceTitle: "Drifted source title" },
    },
    {
      field: "source classification",
      input: { ...demoChinaJurisdiction, sourceIsDemo: false },
    },
  ])("fails a Demo jurisdiction $field drift closed", ({ input }) => {
    expect(
      jurisdictionDisplayName(input, getDictionary("zh-CN"), "zh-CN"),
    ).toBe(input.name);
  });

  it.each([
    {
      expected: "DEMO ONLY — Fictional addressable units",
      input: {
        isDemo: true,
        metricCode: "DEMO_ADDRESSABLE_UNITS",
        metricIds: ["00000000-0000-4000-8000-000000000701"],
        metricName: "DEMO ONLY — Fictional addressable units",
      },
      locale: "en",
    },
    {
      expected: "仅限 Demo — 虚构年度可触达台数",
      input: {
        isDemo: true,
        metricCode: "DEMO_ADDRESSABLE_UNITS",
        metricIds: [
          "00000000-0000-4000-8000-000000000701",
          "00000000-0000-4000-8000-000000000702",
        ],
        metricName: "DEMO ONLY — Fictional addressable units",
      },
      locale: "zh-CN",
    },
    {
      expected: "Real addressable units",
      input: {
        isDemo: false,
        metricCode: "DEMO_ADDRESSABLE_UNITS",
        metricIds: ["00000000-0000-4000-8000-000000000701"],
        metricName: "Real addressable units",
      },
      locale: "zh-CN",
    },
    {
      expected: "Unmapped fictional metric",
      input: {
        isDemo: true,
        metricCode: "DEMO_UNKNOWN_METRIC",
        metricIds: ["00000000-0000-4000-8000-000000000999"],
        metricName: "Unmapped fictional metric",
      },
      locale: "zh-CN",
    },
  ] as const)(
    "formats a $locale market metric without translating real or unknown metrics",
    ({ expected, input, locale }) => {
      expect(
        marketMetricDisplayName(input, getDictionary(locale), locale),
      ).toBe(expected);
    },
  );

  it("fails closed for a Demo metric whose fixture identity or canonical name drifted", () => {
    const dictionary = getDictionary("zh-CN");
    expect(
      marketMetricDisplayName(
        {
          isDemo: true,
          metricCode: "DEMO_ADDRESSABLE_UNITS",
          metricIds: ["00000000-0000-4000-8000-000000000999"],
          metricName: "DEMO ONLY — Fictional addressable units",
        },
        dictionary,
        "zh-CN",
      ),
    ).toBe("DEMO ONLY — Fictional addressable units");
    expect(
      marketMetricDisplayName(
        {
          isDemo: true,
          metricCode: "DEMO_ADDRESSABLE_UNITS",
          metricIds: ["00000000-0000-4000-8000-000000000701"],
          metricName: "DEMO ONLY — Revised fictional metric",
        },
        dictionary,
        "zh-CN",
      ),
    ).toBe("DEMO ONLY — Revised fictional metric");
  });

  it.each([
    {
      expected:
        "FICTIONAL DEMO DATA — NOT A REAL REGULATION, CERTIFICATION, OR MARKET SOURCE. Fictional annual addressable unit count.",
      input: {
        definition:
          "FICTIONAL DEMO DATA — NOT A REAL REGULATION, CERTIFICATION, OR MARKET SOURCE. Fictional annual addressable unit count.",
        isDemo: true,
        metricCode: "DEMO_ADDRESSABLE_UNITS",
        metricIds: ["00000000-0000-4000-8000-000000000701"],
        metricName: "DEMO ONLY — Fictional addressable units",
      },
      locale: "en",
    },
    {
      expected:
        "虚构 Demo 数据 — 不是实际法规、认证或市场来源。虚构年度可触达台数。",
      input: {
        definition:
          "FICTIONAL DEMO DATA — NOT A REAL REGULATION, CERTIFICATION, OR MARKET SOURCE. Fictional annual addressable unit count.",
        isDemo: true,
        metricCode: "DEMO_ADDRESSABLE_UNITS",
        metricIds: ["00000000-0000-4000-8000-000000000702"],
        metricName: "DEMO ONLY — Fictional addressable units",
      },
      locale: "zh-CN",
    },
    {
      expected: "A real metric definition must remain verbatim.",
      input: {
        definition: "A real metric definition must remain verbatim.",
        isDemo: false,
        metricCode: "DEMO_ADDRESSABLE_UNITS",
        metricIds: ["00000000-0000-4000-8000-000000000701"],
        metricName: "DEMO ONLY — Fictional addressable units",
      },
      locale: "zh-CN",
    },
    {
      expected: "An unknown Demo definition must remain verbatim.",
      input: {
        definition: "An unknown Demo definition must remain verbatim.",
        isDemo: true,
        metricCode: "DEMO_ADDRESSABLE_UNITS",
        metricIds: ["00000000-0000-4000-8000-000000000999"],
        metricName: "DEMO ONLY — Fictional addressable units",
      },
      locale: "zh-CN",
    },
    {
      expected: "A revised Demo definition must remain verbatim.",
      input: {
        definition: "A revised Demo definition must remain verbatim.",
        isDemo: true,
        metricCode: "DEMO_ADDRESSABLE_UNITS",
        metricIds: ["00000000-0000-4000-8000-000000000701"],
        metricName: "DEMO ONLY — Fictional addressable units",
      },
      locale: "zh-CN",
    },
  ] as const)(
    "formats a $locale market definition only for an exact known Demo fixture",
    ({ expected, input, locale }) => {
      expect(
        marketMetricDisplayDefinition(
          input,
          getDictionary(locale),
          locale,
        ),
      ).toBe(expected);
    },
  );

  it.each([
    {
      expected: "DEMO ONLY — Fictional China Non-road Stage A",
      input: {
        canonicalName: "DEMO ONLY — Fictional China Non-road Stage A",
        id: "00000000-0000-4000-8000-000000000201",
        isDemo: true,
      },
      locale: "en",
    },
    {
      expected: "仅限 Demo — 虚构中国非道路阶段 A",
      input: {
        canonicalName: "DEMO ONLY — Fictional China Non-road Stage A",
        id: "00000000-0000-4000-8000-000000000201",
        isDemo: true,
      },
      locale: "zh-CN",
    },
    {
      expected: "仅限 Demo — 虚构巴西非道路阶段 A",
      input: {
        canonicalName: "DEMO ONLY — Fictional Brazil Non-road Stage A",
        id: "00000000-0000-4000-8000-000000000204",
        isDemo: true,
      },
      locale: "zh-CN",
    },
    {
      expected: "仅限 Demo — 虚构中国非道路阶段 B（拟议）",
      input: {
        canonicalName:
          "DEMO ONLY — Fictional China Non-road Stage B Proposal",
        id: "00000000-0000-4000-8000-000000000202",
        isDemo: true,
      },
      locale: "zh-CN",
    },
    {
      expected: "仅限 Demo — 虚构中国非道路阶段 Z",
      input: {
        canonicalName: "DEMO ONLY — Fictional China Non-road Stage Z",
        id: "00000000-0000-4000-8000-000000000203",
        isDemo: true,
      },
      locale: "zh-CN",
    },
    {
      expected: "仅限 Demo — 虚构中国非道路阶段 C（已采纳）",
      input: {
        canonicalName:
          "DEMO ONLY — Fictional China Non-road Stage C Adopted",
        id: "00000000-0000-4000-8000-000000000205",
        isDemo: true,
      },
      locale: "zh-CN",
    },
    {
      expected: "Real regulation title",
      input: {
        canonicalName: "Real regulation title",
        id: "00000000-0000-4000-8000-000000000201",
        isDemo: false,
      },
      locale: "zh-CN",
    },
    {
      expected: "Unknown fictional regulation",
      input: {
        canonicalName: "Unknown fictional regulation",
        id: "00000000-0000-4000-8000-000000000999",
        isDemo: true,
      },
      locale: "zh-CN",
    },
    {
      expected: "DEMO ONLY — Fictional China Non-road Stage A revised",
      input: {
        canonicalName:
          "DEMO ONLY — Fictional China Non-road Stage A revised",
        id: "00000000-0000-4000-8000-000000000201",
        isDemo: true,
      },
      locale: "zh-CN",
    },
  ] as const)(
    "formats a $locale regulation name only for an exact known Demo fixture",
    ({ expected, input, locale }) => {
      expect(
        regulationDisplayName(input, getDictionary(locale), locale),
      ).toBe(expected);
    },
  );

  it.each([
    {
      expected: "DEMO ONLY — Fictional Engine 100",
      input: demoProduct100,
      locale: "en",
    },
    {
      expected: "仅限 Demo — 虚构发动机 100",
      input: demoProduct100,
      locale: "zh-CN",
    },
    {
      expected: "仅限 Demo — 虚构发动机 200",
      input: {
        ...demoProduct100,
        id: "00000000-0000-4000-8000-000000000202",
        modelCode: "DEMO-ENG-200",
        name: "DEMO ONLY — Fictional Engine 200",
      },
      locale: "zh-CN",
    },
    {
      expected: "Real Engine 100",
      input: {
        ...demoProduct100,
        isDemo: false,
        name: "Real Engine 100",
      },
      locale: "zh-CN",
    },
    {
      expected: "Unmapped fictional product",
      input: {
        ...demoProduct100,
        id: "00000000-0000-4000-8000-000000000999",
        modelCode: "DEMO-UNKNOWN",
        name: "Unmapped fictional product",
      },
      locale: "zh-CN",
    },
  ] as const)(
    "formats a $locale product display name without translating real or unknown products",
    ({ expected, input, locale }) => {
      expect(productDisplayName(input, getDictionary(locale), locale)).toBe(
        expected,
      );
    },
  );

  it.each([
    { field: "id", input: { ...demoProduct100, id: "drifted-id" } },
    {
      field: "name",
      input: { ...demoProduct100, name: "Drifted product name" },
    },
    {
      field: "source id",
      input: {
        ...demoProduct100,
        source: { ...demoProduct100.source, id: "drifted-source" },
      },
    },
    {
      field: "source title",
      input: {
        ...demoProduct100,
        source: { ...demoProduct100.source, title: "Drifted source title" },
      },
    },
    {
      field: "source classification",
      input: {
        ...demoProduct100,
        source: { ...demoProduct100.source, isDemo: false },
      },
    },
    {
      field: "specification version",
      input: { ...demoProduct100, specificationVersion: "demo-v2" },
    },
  ])("fails a Demo product $field drift closed", ({ input }) => {
    expect(productDisplayName(input, getDictionary("zh-CN"), "zh-CN")).toBe(
      input.name,
    );
  });

  it.each([
    ["pending", "Pending", "待定"],
    ["active", "Active", "有效"],
    ["expired", "Expired", "已过期"],
    ["withdrawn", "Withdrawn", "已撤销"],
    ["unknown", "Unknown", "未知"],
  ] as const)("localizes the %s certification status", (status, en, zh) => {
    expect(certificationStatusLabel(status, getDictionary("en"))).toBe(en);
    expect(certificationStatusLabel(status, getDictionary("zh-CN"))).toBe(zh);
  });

  it("uses locale-appropriate list and parenthetical punctuation", () => {
    expect(localizedList(["A", "B"], "en")).toBe("A, B");
    expect(localizedList(["甲", "乙"], "zh-CN")).toBe("甲、乙");
    expect(nameWithCode("China", "CN", "en")).toBe("China (CN)");
    expect(nameWithCode("中国", "CN", "zh-CN")).toBe("中国（CN）");
  });

  it.each([
    {
      expected: "CHN has no comparable regulation record for the selected application, power, and date.",
      locale: "en",
    },
    {
      expected: "CHN 在所选场景、功率和日期下没有可比较法规记录。",
      locale: "zh-CN",
    },
  ] as const)(
    "localizes a $locale country applicability evidence gap from structured state",
    ({ expected, locale }) => {
      expect(
        countryApplicabilityMissingDataMessages(
          {
            countryIso3: "CHN",
            countryName: "China",
            currentEffectiveRegulationCount: 0,
            futureAdoptedRegulationCount: 0,
            hasMissingData: true,
          },
          getDictionary(locale),
        ),
      ).toEqual([expected]);
    },
  );

  it("does not render raw server missing-data text or invent an absent gap", () => {
    const dictionary = getDictionary("en");
    expect(
      countryApplicabilityMissingDataMessages(
        {
          countryIso3: "CHN",
          countryName: "China",
          currentEffectiveRegulationCount: 1,
          futureAdoptedRegulationCount: 0,
          hasMissingData: true,
        },
        dictionary,
      ),
    ).toEqual([
      "CHN has an unclassified applicability evidence gap for the selected query.",
    ]);
    expect(
      countryApplicabilityMissingDataMessages(
        {
          countryIso3: "CHN",
          countryName: "China",
          currentEffectiveRegulationCount: 0,
          futureAdoptedRegulationCount: 0,
          hasMissingData: false,
        },
        dictionary,
      ),
    ).toEqual([]);
  });
});
