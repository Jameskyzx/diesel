import { describe, expect, it } from "vitest";

import { selectPortfolioDemoTool } from "@/server/ai/portfolio-demo-model";
import { resolvePortfolioDemoMode } from "@/server/config/portfolio-demo";

describe("portfolio demo runtime", () => {
  it("only enables the simulation for development + pglite-demo", () => {
    expect(
      resolvePortfolioDemoMode({
        databaseMode: "pglite-demo",
        enabled: true,
        nodeEnv: "development",
      }),
    ).toBe(true);
    expect(
      resolvePortfolioDemoMode({
        databaseMode: "postgres",
        enabled: false,
        nodeEnv: "production",
      }),
    ).toBe(false);
  });

  it.each([
    { databaseMode: "postgres" as const, nodeEnv: "development" as const },
    { databaseMode: "pglite-demo" as const, nodeEnv: "test" as const },
    { databaseMode: "pglite-demo" as const, nodeEnv: "production" as const },
  ])("rejects unsafe enabled runtime %o", ({ databaseMode, nodeEnv }) => {
    expect(() =>
      resolvePortfolioDemoMode({
        databaseMode,
        enabled: true,
        nodeEnv,
      }),
    ).toThrow("requires development + pglite-demo");
  });
});

describe("portfolio demo deterministic tool routing", () => {
  it("routes a regulation question to the country profile", () => {
    expect(
      selectPortfolioDemoTool("CHN 目前有哪些有效法规？"),
    ).toMatchObject({
      input: { countryIso3: "CHN", topics: ["regulations"] },
      toolName: "getCountryProfile",
    });
  });

  it("routes a complete product-fit question without inventing inputs", () => {
    expect(
      selectPortfolioDemoTool(
        "CHN 的 non-road 100 kW 产品在 2026-08-09 是否适配？",
      ),
    ).toEqual({
      input: {
        applicationScope: "non-road",
        asOf: "2026-08-09",
        countryIso3: "CHN",
        powerKw: 100,
      },
      toolName: "findCompatibleProducts",
    });
  });

  it("preserves an explicitly named product instead of returning the catalog", () => {
    expect(
      selectPortfolioDemoTool(
        "CHN 的 non-road 100 kW 产品 DEMO-ENG-200 在 2026-08-09 是否适配？",
      ),
    ).toEqual({
      input: {
        applicationScope: "non-road",
        asOf: "2026-08-09",
        countryIso3: "CHN",
        powerKw: 100,
        productModelCode: "DEMO-ENG-200",
      },
      toolName: "findCompatibleProducts",
    });
  });

  it("routes an explicit same-basis regulation comparison", () => {
    expect(
      selectPortfolioDemoTool(
        "比较 CHN 和 BRA 的 non-road 100 kW 法规，日期 2026-08-09。",
      ),
    ).toEqual({
      input: {
        applicationScope: "non-road",
        asOf: "2026-08-09",
        countryIso3s: ["CHN", "BRA"],
        powerKw: 100,
      },
      toolName: "compareRegulations",
    });
  });

  it("routes a complete sales-brief request to the existing brief tool", () => {
    expect(
      selectPortfolioDemoTool(
        "为 CHN 和 BRA 生成 non-road 100 kW 的销售简报，日期 2026-08-09。",
      ),
    ).toEqual({
      input: {
        applicationScope: "non-road",
        asOf: "2026-08-09",
        countryIso3s: ["CHN", "BRA"],
        powerKw: 100,
        targetCountryIso3: "CHN",
      },
      toolName: "generateSalesBrief",
    });
  });

  it("reuses explicit prior-turn filters for a sales-brief follow-up", () => {
    expect(
      selectPortfolioDemoTool(
        "基于上面的比较生成销售简报。",
        "比较 CHN 和 BRA 的 non-road 100 kW 法规，日期 2026-08-09。\n基于上面的比较生成销售简报。",
      ),
    ).toMatchObject({
      input: {
        applicationScope: "non-road",
        asOf: "2026-08-09",
        countryIso3s: ["CHN", "BRA"],
        powerKw: 100,
      },
      toolName: "generateSalesBrief",
    });
  });

  it("uses the most recent complete comparison when earlier history conflicts", () => {
    expect(
      selectPortfolioDemoTool(
        "基于上面的比较生成销售简报。",
        [
          "比较 DEU 和 JPN 的 on-road 200 kW 法规，日期 2026-01-01。",
          "比较 CHN 和 BRA 的 non-road 100 kW 法规，日期 2026-08-09。",
          "基于上面的比较生成销售简报。",
        ],
      ),
    ).toEqual({
      input: {
        applicationScope: "non-road",
        asOf: "2026-08-09",
        countryIso3s: ["CHN", "BRA"],
        powerKw: 100,
        targetCountryIso3: "CHN",
      },
      toolName: "generateSalesBrief",
    });
  });
});
