import { describe, expect, it } from "vitest";

import { buildConversationBusinessContext } from "@/server/ai/conversation-context";
import {
  salesBriefSummaryFromPrompt,
  selectPortfolioDemoTool,
} from "@/server/ai/portfolio-demo-model";
import { resolvePortfolioDemoMode } from "@/server/config/portfolio-demo";

function salesBriefPrompt(overallScore: number | null): unknown[] {
  return [
    {
      content: [
        {
          output: {
            type: "json",
            value: {
              brief: {
                executiveSummary: "规则生成摘要",
                marketScore: {
                  components: [
                    {
                      configuredWeight: 0.5,
                      contribution: overallScore,
                      effectiveWeight: 0.5,
                      explanation: "市场证据",
                      inputFacts: ["metric=available"],
                      key: "marketPotential",
                      score: overallScore,
                      status: overallScore === null ? "missing" : "available",
                    },
                    {
                      configuredWeight: 0.3,
                      contribution: overallScore,
                      effectiveWeight: 0.3,
                      explanation: "产品证据",
                      inputFacts: ["fit=1"],
                      key: "productReadiness",
                      score: overallScore,
                      status: overallScore === null ? "missing" : "available",
                    },
                    {
                      configuredWeight: 0.2,
                      contribution: overallScore,
                      effectiveWeight: 0.2,
                      explanation: "法规证据",
                      inputFacts: ["effective=1"],
                      key: "regulatoryCoverage",
                      score: overallScore,
                      status: overallScore === null ? "missing" : "available",
                    },
                  ],
                  countryIso3: "BRA",
                  dataCoveragePct: overallScore === null ? 0 : 80,
                  missingData: overallScore === null ? ["缺少评分证据"] : [],
                  overallScore,
                },
                missingData: [],
                opportunities: [],
                query: {
                  applicationScope: "non-road",
                  asOf: "2026-08-13",
                  countryIso3s: ["CHN", "BRA"],
                  powerKw: 100,
                  targetCountryIso3: "BRA",
                },
                recommendedProducts: [],
                risks: [
                  {
                    evidenceIds: ["risk-1"],
                    text: "认证证据尚不完整",
                    title: "认证缺口",
                  },
                ],
                salesActions: [
                  {
                    action: "先补齐认证资料再联系客户",
                    kind: "rule_generated",
                    priority: "high",
                    rationale: "避免把未知状态升级为承诺",
                  },
                ],
                sources: [],
              },
              citations: [],
              evidenceSufficient: overallScore !== null,
              informationAsOf: "2026-08-13",
              latestVerifiedAt: null,
              status: overallScore === null ? "no_data" : "ok",
              tool: "generateSalesBrief",
              warnings: [],
            },
          },
          toolCallId: "portfolio-demo-generateSalesBrief",
          toolName: "generateSalesBrief",
          type: "tool-result",
        },
      ],
      role: "tool",
    },
  ];
}

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
  it("preserves country order from the user's text", () => {
    expect(
      buildConversationBusinessContext([
        "比较 BRA、CHN 和 DEU 的 non-road 100 kW 法规。",
      ]),
    ).toMatchObject({
      countryIso3s: ["BRA", "CHN", "DEU"],
      focusedCountryIso3: "BRA",
      targetCountryIso3: "BRA",
    });

    expect(
      buildConversationBusinessContext([
        "Compare Germany, Brazil, and China for non-road 100 kW regulations.",
      ]).countryIso3s,
    ).toEqual(["DEU", "BRA", "CHN"]);
  });

  it.each([
    "为 CHN 和 BRA 生成销售简报，把目标市场从 CHN 改成 BRA。",
    "Generate a sales brief for CHN and BRA; change the target market from CHN to BRA.",
  ])("uses the destination of an explicit target-market change", (text) => {
    expect(buildConversationBusinessContext([text])).toMatchObject({
      countryIso3s: ["CHN", "BRA"],
      targetCountryIso3: "BRA",
    });
  });

  it.each(["WP10", "D13K"])(
    "recognizes the common unhyphenated product model %s",
    (productModelCode) => {
      expect(
        buildConversationBusinessContext([
          `CHN 的 non-road 100 kW 产品 ${productModelCode} 是否适配？`,
        ]).productModelCode,
      ).toBe(productModelCode);
    },
  );

  it("does not treat ordinary uppercase terms as a product model", () => {
    expect(
      buildConversationBusinessContext([
        "COMPARE CHN AND BRA NON-ROAD 100 KW REGULATIONS",
      ]).productModelCode,
    ).toBeNull();
  });

  it("fails closed on multiple distinct powers and recovers on a single-power correction", () => {
    const ambiguousTurns = [
      "比较 CHN 和 BRA 的 non-road 100 kW 和 200 kW 法规。",
    ];

    expect(buildConversationBusinessContext(ambiguousTurns)).toMatchObject({
      hasPowerConflict: true,
      powerKw: null,
    });
    expect(
      selectPortfolioDemoTool(ambiguousTurns[0]!, ambiguousTurns),
    ).not.toMatchObject({ toolName: "compareRegulations" });

    const correctedTurns = [...ambiguousTurns, "改为 150 kW。"];
    expect(buildConversationBusinessContext(correctedTurns)).toMatchObject({
      hasPowerConflict: false,
      powerKw: 150,
    });
    expect(
      selectPortfolioDemoTool(correctedTurns[1]!, correctedTurns),
    ).toMatchObject({
      input: { powerKw: 150 },
      toolName: "compareRegulations",
    });
  });

  it("tracks and inherits the active product-fit task", () => {
    expect(
      buildConversationBusinessContext([
        "CHN 的 non-road 100 kW 产品 DEMO-ENG-100 是否适配？",
        "这个产品在 BRA 呢？",
      ]),
    ).toMatchObject({
      activeTask: "product_fit",
      applicationScope: "non-road",
      asOf: null,
      focusedCountryIso3: "BRA",
      powerKw: 100,
      productModelCode: "DEMO-ENG-100",
    });
    expect(
      buildConversationBusinessContext([
        "CHN 的 non-road 100 kW 产品 DEMO-ENG-100 是否适配？",
        "BRA 呢？",
      ]).activeTask,
    ).toBe("product_fit");
  });

  it("routes a regulation question to the country profile", () => {
    expect(
      selectPortfolioDemoTool("CHN 目前有哪些有效法规？"),
    ).toMatchObject({
      input: { countryIso3: "CHN", topics: ["regulations"] },
      toolName: "getCountryProfile",
    });
  });

  it("inherits a regulation profile topic for a country follow-up", () => {
    const turns = ["CHN 目前有哪些有效法规？", "BRA 呢？"];

    expect(
      buildConversationBusinessContext(turns),
    ).toMatchObject({
      activeTask: "country_profile",
      focusedCountryIso3: "BRA",
      profileTopics: ["regulations"],
    });
    expect(selectPortfolioDemoTool(turns[1]!, turns)).toMatchObject({
      input: { countryIso3: "BRA", topics: ["regulations"] },
      toolName: "getCountryProfile",
    });
  });

  it("inherits a market profile topic for a country follow-up", () => {
    const turns = ["CHN 目前有哪些市场数据？", "BRA 呢？"];

    expect(
      buildConversationBusinessContext(turns),
    ).toMatchObject({
      activeTask: "country_profile",
      focusedCountryIso3: "BRA",
      profileTopics: ["market"],
    });
    expect(selectPortfolioDemoTool(turns[1]!, turns)).toMatchObject({
      input: { countryIso3: "BRA", topics: ["market"] },
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

  it.each([
    "为 CHN 和 BRA 生成 non-road 100 kW 销售简报，目标市场 BRA。",
    "Generate a non-road 100 kW sales brief for CHN and BRA, target market BRA.",
    "Generate a non-road 100 kW sales brief for CHN and BRA with BRA as the target market.",
  ])("uses the explicitly named target market in a multi-country turn", (text) => {
    expect(buildConversationBusinessContext([text])).toMatchObject({
      countryIso3s: ["CHN", "BRA"],
      targetCountryIso3: "BRA",
    });
    expect(selectPortfolioDemoTool(text)).toMatchObject({
      input: {
        countryIso3s: ["CHN", "BRA"],
        targetCountryIso3: "BRA",
      },
      toolName: "generateSalesBrief",
    });
  });

  it("updates only the target country in a follow-up", () => {
    const turns = [
      "为 CHN 和 BRA 生成 non-road 100 kW 销售简报。",
      "把 BRA 改成目标市场。",
    ];

    expect(buildConversationBusinessContext(turns)).toMatchObject({
      countryIso3s: ["CHN", "BRA"],
      targetCountryIso3: "BRA",
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

  it("preserves structured context through the golden sales conversation", () => {
    const turns = [
      "请分析 CHN 的 non-road 100 kW 法规与产品适配，重点判断产品 DEMO-ENG-100，判断日期 2026-08-13。",
      "这个产品在 BRA 呢？",
      "比较 CHN 和 BRA 的 non-road 100 kW 法规，日期 2026-08-13。",
      "基于上面生成销售简报，给我下一步建议。",
      "把 BRA 改成目标市场，更新销售简报。",
    ];

    expect(selectPortfolioDemoTool(turns[0]!, turns.slice(0, 1))).toEqual({
      input: {
        applicationScope: "non-road",
        asOf: "2026-08-13",
        countryIso3: "CHN",
        powerKw: 100,
        productModelCode: "DEMO-ENG-100",
      },
      toolName: "findCompatibleProducts",
    });
    expect(selectPortfolioDemoTool(turns[1]!, turns.slice(0, 2))).toEqual({
      input: {
        applicationScope: "non-road",
        asOf: "2026-08-13",
        countryIso3: "BRA",
        powerKw: 100,
        productModelCode: "DEMO-ENG-100",
      },
      toolName: "findCompatibleProducts",
    });
    expect(selectPortfolioDemoTool(turns[2]!, turns.slice(0, 3))).toEqual({
      input: {
        applicationScope: "non-road",
        asOf: "2026-08-13",
        countryIso3s: ["CHN", "BRA"],
        powerKw: 100,
      },
      toolName: "compareRegulations",
    });
    expect(selectPortfolioDemoTool(turns[3]!, turns.slice(0, 4))).toEqual({
      input: {
        applicationScope: "non-road",
        asOf: "2026-08-13",
        countryIso3s: ["CHN", "BRA"],
        powerKw: 100,
        productModelCode: "DEMO-ENG-100",
        targetCountryIso3: "CHN",
      },
      toolName: "generateSalesBrief",
    });
    expect(selectPortfolioDemoTool(turns[4]!, turns)).toEqual({
      input: {
        applicationScope: "non-road",
        asOf: "2026-08-13",
        countryIso3s: ["CHN", "BRA"],
        powerKw: 100,
        productModelCode: "DEMO-ENG-100",
        targetCountryIso3: "BRA",
      },
      toolName: "generateSalesBrief",
    });
  });

  it("keeps a named product when generating a sales brief", () => {
    expect(
      selectPortfolioDemoTool(
        "为 CHN 和 BRA 生成 DEMO-ENG-100 在 non-road 100 kW 的销售简报，日期 2026-08-09。",
      ),
    ).toEqual({
      input: {
        applicationScope: "non-road",
        asOf: "2026-08-09",
        countryIso3s: ["CHN", "BRA"],
        powerKw: 100,
        productModelCode: "DEMO-ENG-100",
        targetCountryIso3: "CHN",
      },
      toolName: "generateSalesBrief",
    });
  });
});

describe("portfolio demo structured sales-brief summary", () => {
  it("turns the validated brief into a directly reusable conclusion", () => {
    const summary = salesBriefSummaryFromPrompt(salesBriefPrompt(87));

    expect(summary).toContain("BRA 总体机会分为 87/100");
    expect(summary).toContain("数据覆盖率 80%");
    expect(summary).toContain("首要风险：认证缺口：认证证据尚不完整");
    expect(summary).toContain("第一行动：先补齐认证资料再联系客户");
    expect(summary).toContain("不可用于报价、认证声明或销售承诺");
  });

  it("does not convert an unavailable score into zero", () => {
    const summary = salesBriefSummaryFromPrompt(salesBriefPrompt(null));

    expect(summary).toContain("BRA 当前证据下不可评分");
    expect(summary).not.toContain("0/100");
  });

  it("keeps the fixed English summary English without translating original card text", () => {
    const summary = salesBriefSummaryFromPrompt(salesBriefPrompt(87), "en");

    expect(summary).toContain("BRA has an overall opportunity score of 87/100");
    expect(summary).toContain("identifies 1 risk(s)");
    expect(summary).toContain("provides 1 rule-generated action(s)");
    expect(summary).toContain(
      "For information only; not a substitute for formal certification or legal advice.",
    );
    expect(summary).not.toMatch(/[\p{Script=Han}]/u);
  });

  it("rejects a non-JSON or mismatched tool result", () => {
    expect(
      salesBriefSummaryFromPrompt([
        {
          content: [
            {
              output: { type: "text", value: "untrusted" },
              toolCallId: "portfolio-demo-generateSalesBrief",
              toolName: "generateSalesBrief",
              type: "tool-result",
            },
          ],
          role: "tool",
        },
      ]),
    ).toBeNull();
  });
});
