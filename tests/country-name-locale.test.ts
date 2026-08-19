import { describe, expect, it } from "vitest";

import { formatCountryDisplayName } from "@/i18n/country-name";

describe("localized country display names", () => {
  it("always preserves the canonical English name in English", () => {
    expect(
      formatCountryDisplayName(
        {
          iso2: "CN",
          iso3: "CHN",
          nameEn: "China — demo fixture",
          nameLocal: "中国（演示数据）",
        },
        "en",
      ),
    ).toBe("China — demo fixture");
  });

  it("uses a distinct trusted local or fixture name in Chinese UI", () => {
    expect(
      formatCountryDisplayName(
        {
          iso2: "CN",
          iso3: "CHN",
          nameEn: "China — demo fixture",
          nameLocal: "中国（演示数据）",
        },
        "zh-CN",
      ),
    ).toBe("中国（演示数据）");
  });

  it("uses deterministic Chinese region names for valid ISO2 codes", () => {
    expect(
      formatCountryDisplayName(
        {
          iso2: "CN",
          iso3: "CHN",
          nameEn: "China",
          nameLocal: "China",
        },
        "zh-CN",
      ),
    ).toBe("中国");
  });

  it("does not mistake an untagged non-Chinese local fixture name for Chinese copy", () => {
    expect(
      formatCountryDisplayName(
        {
          iso2: "BR",
          iso3: "BRA",
          nameEn: "Brazil — demo fixture",
          nameLocal: "Brasil — dados de demonstração",
        },
        "zh-CN",
      ),
    ).toBe("巴西（演示数据）");
  });

  it.each([
    { expected: "巴西", iso2: "BR", iso3: "BRA", nameEn: "Brazil" },
    { expected: "德国", iso2: "DE", iso3: "DEU", nameEn: "Germany" },
    { expected: "美国", iso2: "US", iso3: "USA", nameEn: "United States" },
  ])("formats $iso3 through the fixed zh-CN region locale", (country) => {
    expect(
      formatCountryDisplayName({ ...country, nameLocal: null }, "zh-CN"),
    ).toBe(country.expected);
  });

  it.each([
    {
      expected: "福克兰群岛",
      iso2: "FK",
      iso3: "FLK",
      nameEn: "Falkland Islands",
    },
    {
      expected: "巴勒斯坦",
      iso2: "PS",
      iso3: "PSE",
      nameEn: "Palestine",
    },
  ])(
    "normalizes the known $iso3 ICU alias difference for hydration stability",
    (country) => {
      expect(
        formatCountryDisplayName(
          { ...country, nameLocal: null },
          "zh-CN",
        ),
      ).toBe(country.expected);
    },
  );

  it("falls back to the canonical English name without a valid ISO2", () => {
    expect(
      formatCountryDisplayName(
        { iso2: "CHN", iso3: "CHN", nameEn: "China", nameLocal: null },
        "zh-CN",
      ),
    ).toBe("China");
  });
});
