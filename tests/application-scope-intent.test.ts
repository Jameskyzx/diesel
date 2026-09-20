import { describe, expect, it } from "vitest";

import { buildConversationBusinessContext } from "@/server/ai/conversation-context";
import { buildDirectChatResponse } from "@/server/ai/chat-turn-guidance";
import { buildSalesChatEvidenceContract } from "@/server/ai/evidence-contract";
import { selectPortfolioDemoTool } from "@/server/ai/portfolio-demo-model";
import { applicationScopes } from "@/features/database/schemas";

const context = (text: string) => buildConversationBusinessContext([text]);
const request = "Check CHN non-road regulations at 100 kW as of 2026-08-20.";

describe("trusted application-scope intent", () => {
  it.each(applicationScopes.flatMap((left) => applicationScopes
    .filter((right) => right !== left).map((right) => ({ left, right }))))(
    "does not prioritize either explicit alternative: $left and $right", ({ left, right }) => {
      expect(context(`Compare CHN and BRA ${left} and ${right} regulations at 100 kW.`)).toMatchObject({
        applicationScope: null, hasScopeConflict: true,
      });
    },
  );

  it.each([
    ["nonroad", "non-road"], ["non road", "non-road"], ["non-road", "non-road"],
    ["非道路", "non-road"], ["on-road", "on-road"], ["道路", "on-road"],
    ["on-road-truck", "on-road-truck"], ["卡车", "on-road-truck"],
    ["on-road-bus", "on-road-bus"], ["公交", "on-road-bus"],
    ["construction", "construction"], ["工程机械", "construction"],
    ["agriculture", "agriculture"], ["农业", "agriculture"],
    ["generator-set", "generator-set"], ["发电机组", "generator-set"],
    ["marine", "marine"], ["船用", "marine"],
  ])("recognizes the explicit scope %s", (text, scope) => {
    expect(context(`Check CHN ${text} regulations.`).applicationScope).toBe(scope);
  });

  it.each([
    "DEMO-MARINE-100", "DEMO-NON-ROAD-100", "EU_CONSTRUCTION_2026",
    "reconstruction", "submarine", "marine𠮷", "𠮷marine", "marine\u0301",
    "https://example.test/marine/reference", "https://example.test/船用/reference",
    "https://marine.example.test", "marine@example.test", "marine/2026", "marine-2026",
  ])("does not infer a scope from the identifier or unrelated text %s", (text) => {
    expect(context(`Check CHN regulations about ${text}.`).applicationScope).toBeNull();
    expect(context(`${request} Reference ${text}.`).applicationScope).toBe("non-road");
  });

  it.each([
    "non-road, not marine", "not marine but non-road", "non-road rather than marine",
    "non-road instead of marine", "non-road, neither marine nor on-road",
    "非道路，不是船用", "不是船用，而是非道路", "不用船用，使用非道路",
    "marine. Actually use non-road", "marine; instead use non-road",
    "从船用改为非道路", "change from marine to non-road",
  ])("honors bounded exclusion or correction in %s", (text) => {
    const turns = [`Check CHN ${text} regulations at 100 kW as of 2026-08-20.`];
    expect(buildConversationBusinessContext(turns).applicationScope).toBe("non-road");
    expect(selectPortfolioDemoTool(turns[0]!, turns)).toMatchObject({
      toolName: "compareRegulations",
      input: { applicationScope: "non-road", powerKw: 100, asOf: "2026-08-20" },
    });
  });

  it.each([
    ["non-road construction", "construction"], ["非道路工程机械", "construction"],
    ["non-road agriculture", "agriculture"], ["on-road on-road-truck", "on-road-truck"],
    ["道路公交", "on-road-bus"],
  ])("retains the specific member of the scope hierarchy in %s", (text, scope) => {
    expect(context(`Check CHN ${text} regulations.`).applicationScope).toBe(scope);
  });

  it.each([
    "marine and non-road", "non-road or marine", "construction and agriculture",
    "on-road-truck and on-road-bus", "not only marine but also non-road",
    "non-road except construction", "construction, not non-road",
    "non-road or construction", "non-road and agriculture",
  ])("does not silently choose one incompatible scope in %s", (text) => {
    const turns = [request, `Retrieve CHN ${text} source evidence.`, "Now BRA."];
    expect(buildConversationBusinessContext(turns)).toMatchObject({
      applicationScope: null, hasScopeConflict: true, focusedCountryIso3: "BRA",
      asOf: "2026-08-20", powerKw: 100,
    });
    expect(buildSalesChatEvidenceContract({ userTexts: turns, selectedCountryIso3: null }).missingRequiredParameters).toContain("applicationScope");
    const clarified = [...turns, "Use non-road."];
    expect(buildConversationBusinessContext(clarified)).toMatchObject({ applicationScope: "non-road", hasScopeConflict: false });
    expect(buildSalesChatEvidenceContract({ userTexts: clarified, selectedCountryIso3: null }).missingRequiredParameters).not.toContain("applicationScope");
  });

  it.each([
    "marine; do not change from marine to non-road",
    "marine; do not actually use non-road",
    "船用，不要改为非道路",
  ])("does not turn a negated correction into a scope change: %s", (text) => {
    expect(context(`Check CHN ${text} regulations.`).applicationScope).toBe("marine");
  });

  it("retains an unrelated scope when a follow-up excludes marine, but clears an excluded prior scope", () => {
    expect(buildConversationBusinessContext([request, "Not marine.", "BRA?"])).toMatchObject({ applicationScope: "non-road", hasScopeConflict: false });
    expect(buildConversationBusinessContext(["Check CHN marine regulations.", "Not marine.", "BRA?"])).toMatchObject({ applicationScope: null, hasScopeConflict: true });
    expect(buildSalesChatEvidenceContract({ userTexts: ["Retrieve CHN sources, not marine."], selectedCountryIso3: null }).missingRequiredParameters).toContain("applicationScope");
  });

  it.each(["en", "zh-CN"] as const)("asks for scope clarification even on a source-only turn in %s", (locale) => {
    const text = "Retrieve CHN marine and non-road source evidence.";
    const response = buildDirectChatResponse({ locale, text, selectedCountryIso3: null });
    expect(response).toContain(locale === "en" ? "one application scope" : "一个应用场景");
  });
});
