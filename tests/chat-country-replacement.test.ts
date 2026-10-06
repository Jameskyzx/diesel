import { describe, expect, it } from "vitest";

import { buildConversationBusinessContext } from "@/server/ai/conversation-context";
import { buildSalesChatEvidenceContract } from "@/server/ai/evidence-contract";

const initial = "比较 CHN 和 JPN 在 2026-08-13 的工程机械 120 kW 排放要求。";

describe("country replacement in a retained comparison", () => {
  it.each([
    "把日本换成德国，其余条件不变。",
    "将 JPN 改为 DEU，其他条件保持不变。",
    "Replace Japan with Germany, keeping the other conditions unchanged.",
    "Change JPN to DEU; keep the rest unchanged.",
    "Switch from Japan to Germany.",
  ])("retains the other country, application, power and date: %s", (followUp) => {
    const userTexts = [initial, followUp];
    expect(buildConversationBusinessContext(userTexts)).toMatchObject({
      activeTask: "regulation_compare",
      countryIso3s: ["CHN", "DEU"],
      applicationScope: "construction",
      powerKw: 120,
      asOf: "2026-08-13",
      focusedCountryIso3: "CHN",
    });
    expect(buildSalesChatEvidenceContract({ selectedCountryIso3: null, userTexts }))
      .toMatchObject({
        missingRequiredParameters: [],
        requirements: [{ acceptedTools: ["compareRegulations"], query: {
          countryIso3s: ["CHN", "DEU"], applicationScope: "construction",
          powerKw: 120, asOf: "2026-08-13",
        } }],
      });
  });

  it("updates a replaced focused country without dropping its peer", () => {
    expect(buildConversationBusinessContext([initial, "把中国换成美国。"]))
      .toMatchObject({ countryIso3s: ["USA", "JPN"], focusedCountryIso3: "USA", targetCountryIso3: "USA" });
  });

  it("does not infer peers when the country being replaced is absent", () => {
    const contract = buildSalesChatEvidenceContract({ selectedCountryIso3: null,
      userTexts: [initial, "把法国换成德国。"] });
    expect(contract.countryIso3s).toEqual([]);
    expect(contract.missingRequiredParameters).toContain("countryIso3s");
  });

  it("does not invent a second peer when replacement collapses the set", () => {
    const contract = buildSalesChatEvidenceContract({ selectedCountryIso3: null,
      userTexts: [initial, "把日本换成中国。"] });
    expect(contract.countryIso3s).toEqual(["CHN"]);
    expect(contract.missingRequiredParameters).toContain("countryIso3s");
  });

  it("keeps explicit new comparisons and target updates distinct", () => {
    expect(buildConversationBusinessContext([initial, "比较日本和德国的排放要求。"]).countryIso3s)
      .toEqual(["JPN", "DEU"]);
    expect(buildConversationBusinessContext([
      "为 CHN 与 JPN 的 non-road 120 kW 生成销售简报，目标市场 JPN。",
      "目标市场改为德国。",
    ])).toMatchObject({ countryIso3s: ["CHN", "JPN", "DEU"], targetCountryIso3: "DEU" });
  });
});
