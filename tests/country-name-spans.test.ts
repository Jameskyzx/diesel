import { describe, expect, it } from "vitest";

import { countryIso3sIn, countryMentionsIn } from "@/server/ai/conversation-context";
import { buildSalesChatEvidenceContract } from "@/server/ai/evidence-contract";
import { selectPortfolioDemoTool } from "@/server/ai/portfolio-demo-model";
import { countryCatalog } from "@/server/db/seed/country-catalog";

function contractFor(text: string) {
  return buildSalesChatEvidenceContract({ selectedCountryIso3: null, userTexts: [text] });
}

describe("existing country names are indivisible identity spans", () => {
  it.each(countryCatalog)("resolves $nameEn without injecting a nested country", ({ iso3, nameEn }) => {
    for (const name of [nameEn, nameEn.toLowerCase(), nameEn.toUpperCase()]) {
      expect(countryMentionsIn(name)).toEqual([{ countryIso3: iso3, index: 0, length: name.length }]);
    }
    const prompt = `Check ${nameEn} non-road 100 kW regulations as of 2026-08-20.`;
    const contract = contractFor(prompt);
    expect(contract.missingRequiredParameters).toEqual([]);
    expect(contract.requirements).toHaveLength(1);
    expect(contract.requirements[0]).toMatchObject({
      acceptedTools: ["compareRegulations"],
      query: { countryIso3s: [iso3], applicationScope: "non-road", powerKw: 100, asOf: "2026-08-20" },
    });
    expect(selectPortfolioDemoTool(prompt)).toEqual({
      toolName: "compareRegulations",
      input: { countryIso3s: [iso3], applicationScope: "non-road", powerKw: 100, asOf: "2026-08-20" },
    });
  });

  it.each(countryCatalog)("keeps $nameEn whole in coordinated task and source requests", ({ iso3, nameEn }) => {
    const otherCountry = iso3 === "CHN" ? "BRA" : "CHN";
    const countryIso3s = [iso3, otherCountry];
    for (const [prompt, tool] of [
      [`Compare ${nameEn} and ${otherCountry} non-road 100 kW regulations as of 2026-08-20.`, "compareRegulations"],
      [`Compare ${nameEn} and ${otherCountry} market metric DEMO_ADDRESSABLE_UNITS.`, "compareMarkets"],
    ] as const) {
      const contract = contractFor(prompt);
      expect(contract.missingRequiredParameters).toEqual([]);
      expect(contract.requirements).toHaveLength(1);
      expect(contract.requirements[0]).toMatchObject({ acceptedTools: [tool], query: { countryIso3s } });
    }
    const sourceContract = contractFor(`Retrieve ${nameEn} and ${otherCountry} non-road emissions regulation sources as of 2026-08-20.`);
    expect(sourceContract.missingRequiredParameters).toEqual([]);
    expect(sourceContract.requirements).toHaveLength(2);
    expect(sourceContract.requirements.map((requirement) => requirement.query.countryIso3s)).toEqual(countryIso3s.map((country) => [country]));
    for (const requirement of sourceContract.requirements) {
      expect(requirement.acceptedTools).toEqual(["searchKnowledgeBase"]);
    }
  });

  it.each([
    ["South Sudan and Sudan", ["SSD", "SDN"]],
    ["Papua New Guinea and Guinea", ["PNG", "GIN"]],
    ["Equatorial Guinea and Guinea", ["GNQ", "GIN"]],
    ["Democratic Republic of the Congo and Republic of the Congo", ["COD", "COG"]],
    ["Guinea-Bissau and Guinea", ["GNB", "GIN"]],
    ["印度尼西亚和印度", ["IDN", "IND"]],
    ["Sudan and South Sudan", ["SDN", "SSD"]],
    ["Guinea and Papua New Guinea", ["GIN", "PNG"]],
  ])("retains genuinely separate mentions in %s", (text, countries) => {
    expect(countryIso3sIn(text)).toEqual(countries);
    const mentions = countryMentionsIn(text);
    expect(mentions).toHaveLength(countries.length);
    for (const [index, mention] of mentions.entries()) {
      const next = mentions[index + 1];
      if (next) expect(mention.index + mention.length).toBeLessThanOrEqual(next.index);
    }
  });

  it("preserves the offset of an explicit shorter name after a full name", () => {
    expect(countryMentionsIn("In South Sudan and Sudan")).toEqual([
      { countryIso3: "SSD", index: 3, length: 11 },
      { countryIso3: "SDN", index: 19, length: 5 },
    ]);
  });

  it.each([
    ["Check South Sudan non-road 100 kW regulations and recommend CHN product fit.", "SSD"],
    ["Check Trinidad and Tobago non-road 100 kW regulations and recommend CHN product fit.", "TTO"],
  ])("keeps full names separate from independent product tasks: %s", (prompt, country) => {
    const contract = contractFor(prompt);
    expect(contract.missingRequiredParameters).toEqual([]);
    expect(contract.requirements).toHaveLength(2);
    expect(contract.requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ acceptedTools: ["compareRegulations"], query: expect.objectContaining({ countryIso3s: [country] }) }),
      expect.objectContaining({ acceptedTools: ["findCompatibleProducts"], query: expect.objectContaining({ countryIso3s: ["CHN"] }) }),
    ]));
  });

  it.each([
    ["Recommend CHN product fit and retrieve Trinidad and Tobago regulation sources.", "TTO"],
    ["Retrieve South Sudan regulation sources and recommend CHN product fit.", "SSD"],
  ])("does not absorb an independent product country into source filters: %s", (prompt, country) => {
    const contract = contractFor(prompt);
    expect(contract.requirements).toHaveLength(1);
    expect(contract.requirements[0]).toMatchObject({ acceptedTools: ["searchKnowledgeBase"], query: { countryIso3s: [country] } });
  });

  it.each([["South Sudan", "SSD"], ["Trinidad and Tobago", "TTO"]])("retains exact filters when a follow-up switches to %s", (countryName, iso3) => {
    const countryIso3s = [iso3];
    const userTexts = [
      "Check BRA non-road regulations for 100 kW as of 2026-08-20.",
      `What about ${countryName}?`,
    ];
    const contract = buildSalesChatEvidenceContract({ selectedCountryIso3: null, userTexts });
    expect(contract.missingRequiredParameters).toEqual([]);
    expect(contract.requirements).toHaveLength(1);
    expect(contract.requirements[0]).toMatchObject({
      acceptedTools: ["compareRegulations"],
      query: { countryIso3s, applicationScope: "non-road", powerKw: 100, asOf: "2026-08-20" },
    });
    expect(selectPortfolioDemoTool(userTexts[1]!, userTexts)).toEqual({
      toolName: "compareRegulations",
      input: { countryIso3s, applicationScope: "non-road", powerKw: 100, asOf: "2026-08-20" },
    });
  });
});
