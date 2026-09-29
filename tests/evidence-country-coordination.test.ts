import { describe, expect, it } from "vitest";

import { buildSalesChatEvidenceContract } from "@/server/ai/evidence-contract";

describe("country lists stay together without merging independent tasks", () => {
  it.each([
    ["Compare CHN and BRA non-road regulations for 100 kW as of 2026-08-20.", "compareRegulations", ["CHN", "BRA"]],
    ["Compare the CHN and BRA DEMO_ADDRESSABLE_UNITS market metric.", "compareMarkets", ["CHN", "BRA"]],
    ["Compare regulations for China and Brazil, non-road 100 kW, as of 2026-08-20.", "compareRegulations", ["CHN", "BRA"]],
    ["Compare market metric DEMO_ADDRESSABLE_UNITS for China and Brazil.", "compareMarkets", ["CHN", "BRA"]],
    ["Compare CHN, BRA and AUS non-road 100 kW regulations as of 2026-08-20.", "compareRegulations", ["CHN", "BRA", "AUS"]],
    ["Compare market metric DEMO_ADDRESSABLE_UNITS for CHN, BRA, and AUS.", "compareMarkets", ["CHN", "BRA", "AUS"]],
    ["比较 CHN 和 BRA 非道路 100 kW 法规，截至 2026-08-20。", "compareRegulations", ["CHN", "BRA"]],
    ["比较 CHN、BRA 和 AUS 的 DEMO_ADDRESSABLE_UNITS 市场指标。", "compareMarkets", ["CHN", "BRA", "AUS"]],
  ] as const)("retains every country in %s", (text, tool, countryIso3s) => {
    const contract = buildSalesChatEvidenceContract({ selectedCountryIso3: null, userTexts: [text] });
    expect(contract.missingRequiredParameters).toEqual([]);
    expect(contract.requirements).toHaveLength(1);
    expect(contract.requirements[0]).toMatchObject({ acceptedTools: [tool], query: { countryIso3s } });
  });

  it.each([
    "Check BRA non-road 100 kW regulations and recommend CHN product fit.",
    "Check BRA non-road 100 kW regulations, then recommend CHN product fit.",
    "核对 BRA 非道路 100 kW 法规，并推荐 CHN 产品适配。",
  ])("preserves independent country roles in %s", (text) => {
    const contract = buildSalesChatEvidenceContract({ selectedCountryIso3: null, userTexts: [text] });
    expect(contract.missingRequiredParameters).toEqual([]);
    expect(contract.requirements).toHaveLength(2);
    expect(contract.requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ acceptedTools: ["findCompatibleProducts"], query: expect.objectContaining({ countryIso3s: ["CHN"] }) }),
      expect.objectContaining({ acceptedTools: ["compareRegulations"], query: expect.objectContaining({ countryIso3s: ["BRA"] }) }),
    ]));
  });

  it("does not add an independent market country to a regulation comparison", () => {
    const contract = buildSalesChatEvidenceContract({ selectedCountryIso3: null, userTexts: [
      "Compare CHN and BRA non-road 100 kW regulations and compare AUS and DEU market metrics.",
    ] });
    expect(contract.missingRequiredParameters).toEqual([]);
    expect(contract.requirements).toHaveLength(2);
    expect(contract.requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ acceptedTools: ["compareRegulations"], query: expect.objectContaining({ countryIso3s: ["CHN", "BRA"] }) }),
      expect.objectContaining({ acceptedTools: ["compareMarkets"], query: expect.objectContaining({ countryIso3s: ["AUS", "DEU"] }) }),
    ]));
  });
});
