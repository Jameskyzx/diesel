import { describe, expect, it } from "vitest";

import { buildQueryContextSearch } from "@/features/ai/query-context-form";
import { initialPromptForContext } from "@/features/ai/chat-context-prompt";
import { productFitNextSteps } from "@/features/ai/client-tool-copy";
import { getDictionary } from "@/i18n/dictionaries";
import { buildSalesChatEvidenceContract } from "@/server/ai/evidence-contract";

const query = { countryIso3: "CHN", applicationScope: "construction" as const, powerKw: 120, asOf: "2026-08-12" };

describe("editable query context", () => {
  it("runs a product-free regulation query and preserves repeated unrelated parameters", () => {
    const result = buildQueryContextSearch({ ...query, productModelCode: "DEMO-ENG-100" }, "productModelCode=OLD&countryIso3=DEU&utm_term=a&utm_term=b", "regulations");
    expect(result).not.toBeNull();
    const params = new URLSearchParams(result!);
    expect(params.has("productModelCode")).toBe(false);
    expect(params.has("countryIso3")).toBe(false);
    expect(params.getAll("utm_term")).toEqual(["a", "b"]);
    expect(params.get("powerKw")).toBe("120");
  });
  it.each([
    { asOf: "2026-02-30" }, { powerKw: "garbage" }, { powerKw: -1 },
    { powerKw: "" }, { applicationScope: "" }, { applicationScope: "invalid" },
  ])("rejects invalid or incomplete regulatory conditions %j", (override) => {
    expect(buildQueryContextSearch({ ...query, ...override }, "", "regulations")).toBeNull();
  });
  it("clears optional context instead of retaining old query values", () => {
    expect(buildQueryContextSearch({ countryIso3: "deu", applicationScope: "", powerKw: "", asOf: "", productModelCode: "" }, "countryIso3=CHN&productModelCode=OLD&powerKw=100&asOf=2026-01-01", "chat")).toBe("countryIso3=DEU");
  });
  it.each(["en", "zh-CN"] as const)("keeps regulation-only prompts free of product claims in %s", (locale) => {
    const prompt = initialPromptForContext(query, locale);
    expect(prompt).toContain("CHN");
    expect(prompt).toContain("120 kW");
    expect(prompt).not.toMatch(/product fit|产品适配/);
    expect(initialPromptForContext({ ...query, productModelCode: "DEMO-ENG-100" }, locale)).toContain("DEMO-ENG-100");
    expect(initialPromptForContext({ ...query, applicationScope: undefined }, locale)).toContain("120 kW");
    expect(initialPromptForContext({ ...query, countryIso3: undefined }, locale)).toContain("120 kW");
    expect(initialPromptForContext({}, locale)).toBe("");
  });
  it.each(["en", "zh-CN"] as const)("shows only actionable failed checks, deduplicated in %s", (locale) => {
    const dictionary = getDictionary(locale);
    expect(productFitNextSteps([
      { code: "PRODUCT_AVAILABLE" }, { code: "PRODUCT_POWER_MATCH" },
      { code: "CERTIFICATION_MISSING" }, { code: "CERTIFICATION_VALIDITY_UNKNOWN" },
    ], dictionary)).toEqual([dictionary.queryEditor.certificationEvidence]);
    expect(productFitNextSteps([{ code: "NO_APPLICABLE_REGULATION_DATA" }, { code: "PRODUCT_NOT_FOUND" }], dictionary)).toEqual([dictionary.queryEditor.regulationEvidence, dictionary.queryEditor.productEvidence]);
  });
  it.each(["en", "zh-CN"] as const)("keeps the draft conditions in the production evidence contract in %s", (locale) => {
    const contract = buildSalesChatEvidenceContract({ selectedCountryIso3: "CHN", userTexts: [initialPromptForContext(query, locale)] });
    expect(contract).toMatchObject({ applicationScope: "construction", asOf: "2026-08-12", powerKw: 120, countryIso3s: ["CHN"], productModelCode: null });
    expect(contract.requirements.map(({ acceptedTools }) => acceptedTools)).toEqual([["compareRegulations"]]);
  });
});
