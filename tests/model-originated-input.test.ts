import { describe, expect, it } from "vitest";

import { modelOriginatedProductModelCodeSchema } from "@/domain/ai/model-originated-input";
import { findCompatibleProductsInputSchema } from "@/features/ai/schemas";
import {
  calculateOpportunityScoreInputSchema,
  generateSalesBriefInputSchema,
} from "@/features/marketing/schemas";

const productFitInput = {
  applicationScope: "non-road" as const,
  asOf: "2026-08-13",
  countryIso3: "CHN",
  powerKw: 100,
};

const scoreInput = {
  applicationScope: "non-road" as const,
  asOf: "2026-08-13",
  countryIso3s: ["CHN", "BRA"],
  powerKw: 100,
};

describe("model-originated product model codes", () => {
  it("retains the canonical product-code normalization", () => {
    expect(modelOriginatedProductModelCodeSchema.parse(" demo-eng-100 ")).toBe(
      "DEMO-ENG-100",
    );
  });

  it.each([
    "<analysis>PRIVATE-MODEL-CODE</analysis>",
    "&lt;analysis&gt;PRIVATE-MODEL-CODE&lt;/analysis&gt;",
  ])("rejects private reasoning markup in every sales tool input: %s", (productModelCode) => {
    expect(
      findCompatibleProductsInputSchema.safeParse({
        ...productFitInput,
        productModelCode,
      }).success,
    ).toBe(false);
    expect(
      calculateOpportunityScoreInputSchema.safeParse({
        ...scoreInput,
        productModelCode,
      }).success,
    ).toBe(false);
    expect(
      generateSalesBriefInputSchema.safeParse({
        ...scoreInput,
        productModelCode,
        targetCountryIso3: "CHN",
      }).success,
    ).toBe(false);
  });
});
