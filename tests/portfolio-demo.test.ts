import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildConversationBusinessContext,
  countryIso3sIn,
} from "@/server/ai/conversation-context";
import {
  createPortfolioDemoModel,
  salesBriefSummaryFromPrompt,
  selectPortfolioDemoTool,
} from "@/server/ai/portfolio-demo-model";
import { resolvePortfolioDemoMode } from "@/server/config/portfolio-demo";
import {
  buildSalesBriefResult,
  buildToolErrorResult,
} from "@/server/ai/tool-results";
import { generateSalesBrief } from "@/server/services/marketing-analysis-service";
import { salesBriefResultToModelOutput } from "@/features/ai/model-tool-output";
import { createSalesChatTools, streamSalesChat } from "@/server/ai/sales-chat";

const originalDatabaseMode = process.env.DATABASE_MODE;
const portfolioBriefInput = {
  applicationScope: "non-road" as const,
  asOf: "2026-08-13",
  countryIso3s: ["CHN", "BRA"],
  metricCodes: ["DEMO_ADDRESSABLE_UNITS"],
  powerKw: 100,
  targetCountryIso3: "CHN",
};
let canonicalBriefResult: ReturnType<typeof buildSalesBriefResult>;

beforeAll(async () => {
  process.env.DATABASE_MODE = "pglite-demo";
  canonicalBriefResult = buildSalesBriefResult({
    brief: await generateSalesBrief(portfolioBriefInput),
    informationAsOf: portfolioBriefInput.asOf,
  });
});

afterAll(() => {
  if (originalDatabaseMode === undefined) {
    delete process.env.DATABASE_MODE;
  } else {
    process.env.DATABASE_MODE = originalDatabaseMode;
  }
});

function salesBriefPrompt(hasScore: boolean): unknown[] {
  const result = hasScore
    ? canonicalBriefResult
    : buildToolErrorResult(
        "generateSalesBrief",
        portfolioBriefInput.asOf,
        portfolioBriefInput,
      );
  const value = salesBriefResultToModelOutput(result);
  return [
    {
      content: [
        {
          output: { type: "json", value },
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
  it.each(["en", "zh-CN"] as const)("keeps the structured brief summary through actual Demo tool calls in %s", async (locale) => {
    const text = locale === "en"
      ? "Generate a sales brief for DEMO-ENG-100 in CHN and BRA non-road 100 kW as of 2026-08-12, targeting CHN."
      : "为 CHN 和 BRA 生成 DEMO-ENG-100 在 non-road 100 kW 的销售简报，日期 2026-08-12，目标 CHN。";
    const auditRepository = { recordToolCall: async () => undefined };
    const sessionId = crypto.randomUUID();
    const errors: unknown[] = [];
    const result = streamSalesChat({
      auditRepository, locale, model: createPortfolioDemoModel(), messages: [{ role: "user", content: text }],
      onStreamError: (error) => errors.push(error), selectedCountryIso3: null, sessionId,
      tools: createSalesChatTools({ auditRepository, selectedCountryIso3: null, sessionId }), trustedUserTexts: [text],
    });
    const parts = await Array.fromAsync(result.fullStream);
    expect(errors).toEqual([]);
    expect(parts.filter((part) => part.type === "tool-result")).toHaveLength(1);
    const answer = parts.flatMap((part) => part.type === "text-delta" ? [part.text] : []).join("");
    expect(answer).toContain(locale === "en" ? "The structured brief identifies" : "结构化简报识别到");
    expect(answer).toContain(locale === "en" ? "rule-generated action(s)" : "项规则生成行动");
  });

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
  it.each([
    ["compareMarkets", "Compare CHN and BRA market metric DEMO_ADDRESSABLE_UNITS."],
    ["compareMarkets", "比较 CHN 和 BRA 的 DEMO_ADDRESSABLE_UNITS 市场指标。"],
    ["calculateOpportunityScore", "Calculate opportunity scores for CHN and BRA non-road 100 kW as of 2026-08-20 using DEMO_ADDRESSABLE_UNITS."],
    ["calculateOpportunityScore", "为 CHN 和 BRA 非道路 100 kW 做 2026-08-20 机会评分，使用 DEMO_ADDRESSABLE_UNITS。"],
    ["generateSalesBrief", "Generate a sales brief targeting CHN with BRA as a benchmark, non-road 100 kW, as of 2026-08-20 using DEMO_ADDRESSABLE_UNITS."],
    ["generateSalesBrief", "以 CHN 为目标、BRA 为对照，生成非道路 100 kW、2026-08-20 的销售简报，使用 DEMO_ADDRESSABLE_UNITS。"],
  ] as const)("preserves requested metric codes for %s: %s", (toolName, text) => {
    expect(selectPortfolioDemoTool(text)).toMatchObject({ toolName, input: { metricCodes: ["DEMO_ADDRESSABLE_UNITS"] } });
    expect(selectPortfolioDemoTool("Continue.", [text, "Continue."])).toMatchObject({ toolName, input: { metricCodes: ["DEMO_ADDRESSABLE_UNITS"] } });
    expect(selectPortfolioDemoTool("Use DEMO_METRIC_REPLACEMENT.", [text, "Use DEMO_METRIC_REPLACEMENT."]))
      .toMatchObject({ toolName, input: { metricCodes: ["DEMO_METRIC_REPLACEMENT"] } });
  });

  it("does not invent a metric filter or transfer it to a different task", () => {
    const market = "Compare CHN and BRA market metrics.";
    expect(selectPortfolioDemoTool(market).input).not.toHaveProperty("metricCodes");
    const score = "Calculate opportunity scores for CHN and BRA non-road 100 kW as of 2026-08-20.";
    expect(selectPortfolioDemoTool(score, ["Compare CHN and BRA DEMO_ADDRESSABLE_UNITS market metrics.", score]).input)
      .not.toHaveProperty("metricCodes");
  });

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
    {
      expectedAsOf: null,
      text: "Can you show the source for CHN market metrics?",
    },
    {
      expectedAsOf: null,
      text: "What are the sources for CHN regulations?",
    },
    {
      expectedAsOf: "2026-03-01",
      text: "Show the source for CHN regulations as of Mar 1, 2026.",
    },
  ])(
    "does not interpret ordinary English as an ISO3 country in: $text",
    ({ expectedAsOf, text }) => {
      expect(buildConversationBusinessContext([text])).toMatchObject({
        activeTask: "knowledge",
        asOf: expectedAsOf,
        countryIso3s: ["CHN"],
        focusedCountryIso3: "CHN",
      });
    },
  );

  it("accepts only canonical uppercase bare ISO3 tokens", () => {
    expect(countryIso3sIn("CHN BRA chn bra Can are Mar")).toEqual([
      "CHN",
      "BRA",
    ]);
  });

  it("keeps country names and aliases case-insensitive", () => {
    expect(countryIso3sIn("gErMaNy, bRaZiL, and CHINA")).toEqual([
      "DEU",
      "BRA",
      "CHN",
    ]);
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

  it.each([
    "as of Aug 12, 2026",
    "截止 2026年8月12日",
    "asOf 2026-08-12",
  ])("normalizes the localized explicit date in %s", (text) => {
    expect(
      buildConversationBusinessContext([
        `CHN 的 non-road 100 kW 产品 DEMO-ENG-100，${text}`,
      ]).asOf,
    ).toBe("2026-08-12");
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

  it.each([
    "Check FJI non-road regulations for 100 kW as of 2026-08-13. Do not extrapolate if evidence is missing.",
    "查询 FJI 在 2026-08-13 的 non-road 100 kW 法规，证据不足时不要推断。",
  ])("preserves exact single-country regulation filters: %s", (text) => {
    expect(selectPortfolioDemoTool(text)).toEqual({
      input: {
        applicationScope: "non-road",
        asOf: "2026-08-13",
        countryIso3s: ["FJI"],
        powerKw: 100,
      },
      toolName: "compareRegulations",
    });
  });

  it("keeps exact regulation filters when the next turn changes the country", () => {
    const turns = [
      "Check CHN non-road regulations for 100 kW as of 2026-08-13.",
      "What about FJI?",
    ];
    expect(selectPortfolioDemoTool(turns[1]!, turns)).toEqual({
      input: {
        applicationScope: "non-road",
        asOf: "2026-08-13",
        countryIso3s: ["FJI"],
        powerKw: 100,
      },
      toolName: "compareRegulations",
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
    const summary = salesBriefSummaryFromPrompt(salesBriefPrompt(true), "zh-CN");
    const score = canonicalBriefResult.brief.marketScore;

    expect(summary).toContain(
      `${score.countryIso3} 总体机会分为 ${score.overallScore}/100`,
    );
    expect(summary).toContain(`数据覆盖率 ${score.dataCoveragePct}%`);
    expect(summary).toContain(
      `结构化简报识别到 ${canonicalBriefResult.brief.risks.length} 项风险`,
    );
    expect(summary).toContain(
      `结构化简报提供 ${canonicalBriefResult.brief.salesActions.length} 项规则生成行动`,
    );
    expect(summary).not.toContain("认证缺口");
    expect(summary).not.toContain("认证证据尚不完整");
    expect(summary).not.toContain("先补齐认证资料再联系客户");
    expect(summary).toContain("不可用于报价、认证声明或销售承诺");
  });

  it("does not convert an unavailable score into zero", () => {
    const summary = salesBriefSummaryFromPrompt(
      salesBriefPrompt(false),
      "zh-CN",
    );

    expect(summary).toContain("CHN 当前证据下不可评分");
    expect(summary).not.toContain("0/100");
  });

  it("defaults the fixed summary to English without translating original card text", () => {
    const summary = salesBriefSummaryFromPrompt(salesBriefPrompt(true));
    const score = canonicalBriefResult.brief.marketScore;

    expect(summary).toContain(
      `${score.countryIso3} has an overall opportunity score of ${score.overallScore}/100`,
    );
    expect(summary).toContain(
      `identifies ${canonicalBriefResult.brief.risks.length} risk(s)`,
    );
    expect(summary).toContain(
      `provides ${canonicalBriefResult.brief.salesActions.length} rule-generated action(s)`,
    );
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
