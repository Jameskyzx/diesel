import { describe, expect, it } from "vitest";

import {
  buildProductFitDataGapSummary,
  localizedCitationTitle,
  localizedSalesBriefAction,
  localizedSalesBriefItem,
  localizedSalesBriefSummary,
  localizedScoreComponentContent,
  localizedToolWarnings,
  productFitReasonMessage,
  toolPartErrorMessage,
} from "@/features/ai/client-tool-copy";
import { OPPORTUNITY_SCORE_RULESET_VERSION } from "@/features/marketing/constants";
import { clientAiToolResultSchema } from "@/features/ai/client-schemas";
import { productFitEvaluationSchema } from "@/features/product-fit/schemas";
import { getDictionary } from "@/i18n/dictionaries";

describe("client AI tool locale copy", () => {
  it("renders known product-fit reason codes in English without changing Chinese originals", () => {
    const reason = {
      code: "CERTIFICATION_MISSING" as const,
      message: "未找到产品与该法规之间的认证记录，结论保持未知。",
    };

    expect(productFitReasonMessage(reason, "en")).toContain(
      "No traceable certification record",
    );
    expect(productFitReasonMessage(reason, "en")).not.toMatch(/[\p{Script=Han}]/u);
    expect(productFitReasonMessage(reason, "zh-CN")).toBe(reason.message);
  });

  it("replaces server-authored Chinese warnings with typed English safety copy", () => {
    const result = clientAiToolResultSchema.parse({
      citations: [],
      evaluations: [
        {
          commercialReadiness: "unknown",
          input: { productModelCode: "DEMO-ENG-200" },
          product: {
            availableFrom: "2025-01-01",
            availableTo: "2027-01-01",
            id: "product-200",
            name: "DEMO ONLY — Fictional Engine 200",
          },
          productChecks: {
            availability: {
              code: "PRODUCT_AVAILABLE",
              message: "查询日位于产品供应期内。",
              status: "pass",
            },
          },
          reasons: [
            {
              code: "CERTIFICATION_MISSING",
              message: "未找到认证记录。",
              status: "unknown",
            },
          ],
          status: "unknown",
        },
      ],
      evidenceSufficient: false,
      informationAsOf: "2026-08-12",
      latestVerifiedAt: null,
      query: {
        applicationScope: "non-road",
        asOf: "2026-08-12",
        countryIso3: "CHN",
        powerKw: 100,
        productModelCode: "DEMO-ENG-200",
      },
      status: "no_data",
      tool: "findCompatibleProducts",
      warnings: [
        "没有足够证据支持肯定结论。",
        "1 个产品因法规或认证证据不足而标记为 unknown。",
      ],
    });

    const warnings = localizedToolWarnings(
      result,
      "en",
      getDictionary("en").chat,
    );

    expect(warnings).toEqual([
      expect.stringContaining("not enough evidence"),
      expect.stringContaining("1 product(s) remain unknown"),
    ]);
    expect(warnings.join(" ")).not.toMatch(/[\p{Script=Han}]/u);
  });

  it("builds the clipboard data-gap summary in the selected locale", () => {
    const evaluation = productFitEvaluationSchema.parse({
      asOf: "2026-08-12",
      commercialReadiness: "unknown",
      input: {
        applicationScope: "non-road",
        asOf: "2026-08-12",
        countryIso3: "CHN",
        powerKw: 100,
        productModelCode: "DEMO-ENG-200",
      },
      product: null,
      productChecks: {
        applicationScope: {
          code: "PRODUCT_NOT_FOUND",
          message: "未找到产品。",
          status: "unknown",
        },
        availability: {
          code: "PRODUCT_NOT_FOUND",
          message: "缺少产品记录，无法核对供应状态。",
          status: "unknown",
        },
        power: {
          code: "PRODUCT_NOT_FOUND",
          message: "缺少产品记录，无法核对功率。",
          status: "unknown",
        },
      },
      reasons: [
        {
          code: "PRODUCT_NOT_FOUND",
          message: "产品未知：数据库中没有该型号。",
          status: "unknown",
        },
      ],
      regulationChecks: [],
      rulesetVersion: "product-fit-v2",
      sources: [],
      status: "unknown",
    });

    const english = buildProductFitDataGapSummary({
      dictionary: getDictionary("en"),
      evaluation,
      locale: "en",
      scopeLabel: "Non-road",
    });
    const chinese = buildProductFitDataGapSummary({
      dictionary: getDictionary("zh-CN"),
      evaluation,
      locale: "zh-CN",
      scopeLabel: "非道路",
    });

    expect(english).toContain("Product-fit data-gap summary");
    expect(english).toContain("No structured record was found");
    expect(english).not.toMatch(/[\p{Script=Han}]/u);
    expect(chinese).toContain("产品适配补数摘要");
    expect(chinese).toContain("数据库中没有该型号");
  });

  it("maps terminal tool errors from typed codes", () => {
    const english = getDictionary("en").chat;

    expect(toolPartErrorMessage("execution_error", english)).toContain(
      "deterministic query failed",
    );
    expect(toolPartErrorMessage("permission_denied", english)).toContain(
      "not authorized",
    );
    expect(toolPartErrorMessage("invalid_result", english)).toContain(
      "could not be validated",
    );
  });

  it("never exposes raw service-language score details in English", () => {
    const component = {
      configuredWeight: 0.5,
      contribution: 42,
      effectiveWeight: 0.5,
      explanation: "市场指标在比较组内归一化。",
      inputFacts: ["市场规模=100", "组内归一化=84"],
      key: "marketPotential" as const,
      score: 84,
      status: "available" as const,
    };

    const english = localizedScoreComponentContent(
      component,
      "en",
      getDictionary("en").chat,
    );
    const chinese = localizedScoreComponentContent(
      component,
      "zh-CN",
      getDictionary("zh-CN").chat,
    );

    expect(english.explanation).toContain(
      "Market potential has a deterministic score of 84/100",
    );
    expect(english.inputSummary).toBe("2 validated input fact(s)");
    expect(`${english.explanation} ${english.inputSummary}`).not.toMatch(
      /[\p{Script=Han}]/u,
    );
    expect(chinese.explanation).toBe(component.explanation);
    expect(chinese.inputSummary).toContain("市场规模=100");
  });

  it("renders English sales-brief structure without raw Chinese free text", () => {
    const result = clientAiToolResultSchema.parse({
      brief: {
        executiveSummary: "规则生成摘要，不是事实来源。",
        marketScore: {
          components: [],
          countryIso3: "BRA",
          dataCoveragePct: 80,
          missingData: ["缺少认证证据"],
          overallScore: 72,
        },
        missingData: [],
        opportunities: [
          {
            evidenceIds: ["metric-1"],
            text: "目标市场指标相对占优。",
            title: "结构化市场机会",
          },
        ],
        query: {
          applicationScope: "non-road",
          asOf: "2026-08-12",
          countryIso3s: ["CHN", "BRA"],
          powerKw: 100,
          targetCountryIso3: "BRA",
        },
        recommendedProducts: [],
        risks: [
          {
            evidenceIds: ["risk-1", "risk-2"],
            text: "认证证据不足。",
            title: "产品证据缺口",
          },
        ],
        salesActions: [
          {
            action: "在未来法规生效前重新核验认证覆盖和产品配置。",
            kind: "rule_generated",
            priority: "high",
            rationale: "未来法规形成前置准备窗口。",
          },
        ],
      },
      citations: [],
      evidenceSufficient: true,
      informationAsOf: "2026-08-12",
      latestVerifiedAt: null,
      status: "ok",
      tool: "generateSalesBrief",
      warnings: [],
    });
    if (result.tool !== "generateSalesBrief") {
      throw new Error("Expected a sales brief result.");
    }
    const copy = getDictionary("en").chat;
    const actionCopy = localizedSalesBriefAction(
      result.brief.salesActions[0]!,
      0,
      "en",
      copy,
    );
    const rendered = [
      localizedSalesBriefSummary(result.brief, "en", copy),
      localizedSalesBriefItem(result.brief.risks[0]!, 0, "risk", "en", copy),
      localizedSalesBriefItem(
        result.brief.opportunities[0]!,
        0,
        "opportunity",
        "en",
        copy,
      ),
      actionCopy,
    ].join(" ");

    expect(rendered).toContain("BRA has a deterministic opportunity score");
    expect(rendered).toContain(OPPORTUNITY_SCORE_RULESET_VERSION);
    expect(rendered).toContain("Risk 1: deterministic risk linked to 2");
    expect(rendered).toContain("Action 1 (high priority)");
    expect(rendered).toContain("Validate it against the structured evidence");
    expect(actionCopy).not.toContain("ready product");
    expect(actionCopy).not.toContain("structured data gap");
    expect(rendered).not.toMatch(/[\p{Script=Han}]/u);
    expect(
      localizedSalesBriefSummary(
        result.brief,
        "zh-CN",
        getDictionary("zh-CN").chat,
      ),
    ).toBe(result.brief.executiveSummary);
  });

  it("localizes only known generated citation templates", () => {
    const copy = getDictionary("en").chat;

    expect(
      localizedCitationTitle(
        "DEMO Authority 对 CHN 的成员关系",
        "en",
        copy,
      ),
    ).toBe("DEMO Authority membership for CHN");
    expect(
      localizedCitationTitle("DEMO Stage A 适用限值", "en", copy),
    ).toBe("DEMO Stage A applicable limits");
    expect(
      localizedCitationTitle("Original source title", "en", copy),
    ).toBe("Original source title");
  });
});
