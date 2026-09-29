import { describe, expect, it } from "vitest";

import { wrapUntrustedKnowledgeExcerpt } from "@/domain/knowledge/retrieval-policy";
import {
  buildProductFitDataGapSummary,
  countryProfileTopicLabel,
  localizedCitationLocator,
  localizedCitationTitle,
  localizedRegulationComparisonCountryName,
  localizedSalesBriefAction,
  localizedSalesBriefItem,
  localizedSalesBriefSummary,
  localizedScoreComponentContent,
  localizedToolWarnings,
  productFitReasonMessage,
  toolPartErrorMessage,
} from "@/features/ai/client-tool-copy";
import type {
  ClientAiCitation,
  ClientAiToolResult,
} from "@/features/ai/client-schemas";
import { citationLocatorDescriptorSchema } from "@/features/ai/citation-locator";
import { citationTitleDescriptorSchema } from "@/features/ai/citation-title";
import { OPPORTUNITY_SCORE_RULESET_VERSION } from "@/features/marketing/constants";
import { clientAiToolResultSchema } from "@/features/ai/client-schemas";
import {
  productFitReasonCodeSchema,
  productFitEvaluationSchema,
  type ProductFitReasonCode,
} from "@/features/product-fit/schemas";
import { getDictionary } from "@/i18n/dictionaries";
import { buildToolErrorResult } from "@/server/ai/tool-results";

const tracedClientCitation = {
  chunkId: null,
  countryIso3: "CHN",
  documentId: null,
  documentTitle: null,
  isDemo: false,
  locator: null,
  pageFrom: null,
  pageTo: null,
  productCertificationId: null,
  publishedOn: "2026-01-01",
  regulationId: null,
  regulationStatus: null,
  sectionLocator: null,
  sourceId: "source-1",
  sourceTitle: "Original source title",
  sourceUrl: "https://example.com/evidence",
  title: "Original evidence title",
  verifiedAt: "2026-01-02T00:00:00.000Z",
} as const satisfies ClientAiCitation;

const knowledgeIds = {
  chunk: "00000000-0000-4000-8000-000000000831",
  document: "00000000-0000-4000-8000-000000000832",
  source: "00000000-0000-4000-8000-000000000833",
} as const;

const knowledgeCitation = {
  ...tracedClientCitation,
  chunkId: knowledgeIds.chunk,
  countryIso3: null,
  documentId: knowledgeIds.document,
  documentTitle: "Original source document title",
  sourceId: knowledgeIds.source,
  title: "Original source document title",
} as const satisfies ClientAiCitation;

const productCitation = {
  ...tracedClientCitation,
  entityId: "00000000-0000-4000-8000-000000000220",
  entityType: "product",
  locatorDescriptor: {
    availableFrom: "2025-01-01",
    availableTo: "2027-01-01",
    kind: "product_availability",
    modelCode: "DEMO-ENG-200",
    specificationVersion: "demo-v1",
  },
  locator: "DEMO-ENG-200",
  publishedOn: "2026-01-01",
  sourceId: "00000000-0000-4000-8000-000000000221",
  sourceTitle: "DEMO ONLY — Fictional product manual",
  sourceUrl: "https://example.com/product-manual",
  title: "DEMO ONLY — Fictional Engine 200",
} as const satisfies ClientAiCitation;

const countryProfileCitation = {
  ...tracedClientCitation,
  locator: "CHN",
  publishedOn: "2026-01-01",
  sourceId: "00000000-0000-4000-8000-000000000091",
  sourceTitle: "Country source",
  sourceUrl: "https://example.com/country-source",
  title: "China 国家概览",
  titleDescriptor: {
    countryIsDemo: false,
    countryIso2: "CN",
    countryIso3: "CHN",
    countryNameEn: "China",
    countryNameLocal: "中国",
    countrySourceId: "00000000-0000-4000-8000-000000000091",
    countrySourceIsDemo: false,
    countrySourceTitle: "Country source",
    kind: "country_profile",
  },
} as const satisfies ClientAiCitation;

describe("client AI tool locale copy", () => {
  it("localizes country-profile topic enums before rendering query summaries", () => {
    const cases = [
      ["en", "country", "Country overview"],
      ["en", "regulations", "Regulations"],
      ["en", "market", "Market metrics"],
      ["zh-CN", "country", "国家概览"],
      ["zh-CN", "regulations", "法规"],
      ["zh-CN", "market", "市场指标"],
    ] as const;

    for (const [locale, topic, expected] of cases) {
      expect(countryProfileTopicLabel(topic, getDictionary(locale))).toBe(
        expected,
      );
    }
  });

  it("renders only the execution warning for every canonical tool error", () => {
    const asOf = "2026-08-12";
    const analysisInput = {
      applicationScope: "non-road" as const,
      asOf,
      countryIso3s: ["CHN", "BRA"],
      metricCodes: ["DEMO_ADDRESSABLE_UNITS"],
      powerKw: 100,
    };
    const errorResults = [
      buildToolErrorResult("searchKnowledgeBase", asOf, {
        applicationScope: "non-road",
        asOf,
        countryIso3: "CHN",
        jurisdictionId: null,
        limit: 5,
        query: "CHN emissions source",
      }),
      buildToolErrorResult("getCountryProfile", asOf, {
        asOf,
        countryIso3: "CHN",
        topics: ["country", "regulations"],
      }),
      buildToolErrorResult("findCompatibleProducts", asOf, {
        applicationScope: "non-road",
        asOf,
        countryIso3: "CHN",
        powerKw: 100,
      }),
      buildToolErrorResult("compareRegulations", asOf, {
        applicationScope: "non-road",
        asOf,
        countryIso3s: ["CHN", "BRA"],
        powerKw: 100,
      }),
      buildToolErrorResult("compareMarkets", asOf, {
        applicationScope: "non-road",
        countryIso3s: ["CHN", "BRA"],
        metricCodes: ["DEMO_ADDRESSABLE_UNITS"],
      }),
      buildToolErrorResult("calculateOpportunityScore", asOf, analysisInput),
      buildToolErrorResult("generateSalesBrief", asOf, {
        ...analysisInput,
        targetCountryIso3: "CHN",
      }),
    ].map((result) => clientAiToolResultSchema.parse(result));

    for (const result of errorResults) {
      for (const locale of ["en", "zh-CN"] as const) {
        const copy = getDictionary(locale).chat;
        expect(localizedToolWarnings(result, locale, copy)).toEqual([
          copy.toolQueryFailedWarning,
        ]);
      }
    }
  });

  it("localizes regulation-comparison country headings from explicit classification", () => {
    const countryIso2ByIso3 = { BRA: "BR", CHN: "CN" };

    expect(
      localizedRegulationComparisonCountryName(
        {
          countryIsDemo: true,
          countryIso3: "CHN",
          countryName: "China — demo fixture",
          countrySource: {
            countryIso2: "CN",
            countryNameLocal: "中国",
            id: "00000000-0000-4000-8000-000000000001",
            isDemo: true,
            publishedOn: null,
            title: "DEMO ONLY — Fictional country metadata source",
            url: null,
            verifiedAt: "2026-01-02T00:00:00.000Z",
          },
        },
        "zh-CN",
        countryIso2ByIso3,
      ),
    ).toBe("中国（演示数据）");
    expect(
      localizedRegulationComparisonCountryName(
        {
          countryIsDemo: false,
          countryIso3: "CHN",
          countryName: "China — demo fixture",
          countrySource: {
            countryIso2: "CN",
            countryNameLocal: "中国",
            id: "00000000-0000-4000-8000-000000000001",
            isDemo: true,
            publishedOn: null,
            title: "DEMO ONLY — Fictional country metadata source",
            url: null,
            verifiedAt: "2026-01-02T00:00:00.000Z",
          },
        },
        "zh-CN",
        countryIso2ByIso3,
      ),
    ).toBe("China — demo fixture");
    expect(
      localizedRegulationComparisonCountryName(
        {
          countryIsDemo: true,
          countryIso3: "CHN",
          countryName: "China — demo fixture",
          countrySource: {
            countryIso2: "CN",
            countryNameLocal: "中国",
            id: "00000000-0000-4000-8000-000000000999",
            isDemo: true,
            publishedOn: null,
            title: "DEMO ONLY — Fictional country metadata source",
            url: null,
            verifiedAt: "2026-01-02T00:00:00.000Z",
          },
        },
        "zh-CN",
        countryIso2ByIso3,
      ),
    ).toBe("China — demo fixture");
    expect(
      localizedRegulationComparisonCountryName(
        {
          countryIsDemo: false,
          countryIso3: "BRA",
          countryName: "Brazil",
          countrySource: null,
        },
        "zh-CN",
        countryIso2ByIso3,
      ),
    ).toBe("巴西");
    expect(
      localizedRegulationComparisonCountryName(
        {
          countryIsDemo: true,
          countryIso3: "CHN",
          countryName: "China — demo fixture",
          countrySource: {
            countryIso2: "CN",
            countryNameLocal: "中国",
            id: "00000000-0000-4000-8000-000000000001",
            isDemo: true,
            publishedOn: null,
            title: "DEMO ONLY — Fictional country metadata source",
            url: null,
            verifiedAt: "2026-01-02T00:00:00.000Z",
          },
        },
        "en",
        countryIso2ByIso3,
      ),
    ).toBe("China — demo fixture");
    expect(
      localizedRegulationComparisonCountryName(
        {
          countryIsDemo: false,
          countryIso3: "ZZZ",
          countryName: "Original catalog name",
          countrySource: null,
        },
        "zh-CN",
        countryIso2ByIso3,
      ),
    ).toBe("Original catalog name");
    expect(
      localizedRegulationComparisonCountryName(
        {
          countryIsDemo: false,
          countryIso3: "ZZZ",
          countryName: null,
          countrySource: null,
        },
        "zh-CN",
        countryIso2ByIso3,
      ),
    ).toBeNull();
  });

  it("renders known product-fit reason codes from typed copy without exposing raw messages", () => {
    const reason = {
      code: "CERTIFICATION_MISSING" as const,
      message: "RAW_SERVER_MESSAGE 不得直接展示。",
    };

    expect(productFitReasonMessage(reason, "en")).toContain(
      "No traceable certification record",
    );
    expect(productFitReasonMessage(reason, "en")).not.toMatch(/[\p{Script=Han}]/u);
    expect(productFitReasonMessage(reason, "zh-CN")).toContain(
      "没有可追溯认证记录",
    );
    expect(productFitReasonMessage(reason, "zh-CN")).not.toContain(
      "RAW_SERVER_MESSAGE",
    );
  });

  it.each([
    {
      code: "CERTIFICATION_SCOPE_MISMATCH",
      english: "The certification does not cover the requested application.",
      message: "认证适用场景为 construction，不覆盖 non-road。",
      rawValues: ["construction", "non-road"],
      zh: "认证不覆盖请求的应用场景。",
    },
    {
      code: "CERTIFICATION_INACTIVE",
      english: "The certification is not active.",
      message: "认证状态为 expired，不是 active。",
      rawValues: ["expired"],
      zh: "认证当前不是有效状态。",
    },
    {
      code: "PRODUCT_NOT_YET_AVAILABLE",
      english: "The product is not yet available on the query date.",
      message: "产品自 9999-01-01 起供应，晚于查询日 1999-01-01。",
      rawValues: ["9999-01-01", "1999-01-01"],
      zh: "产品在查询日尚未开始供应。",
    },
    {
      code: "PRODUCT_POWER_OUT_OF_RANGE",
      english: "The product power range does not cover the requested power.",
      message: "产品功率范围 [1, 9999) kW 不覆盖 8888 kW。",
      rawValues: ["9999", "8888"],
      zh: "产品功率范围不覆盖请求的功率。",
    },
  ] as const)(
    "selects stable copy for $code without parsing server-authored facts",
    ({ code, english, message, rawValues, zh }) => {
      const englishMessage = productFitReasonMessage(
        { code, message },
        "en",
      );
      const chineseMessage = productFitReasonMessage(
        { code, message },
        "zh-CN",
      );

      expect(englishMessage).toBe(english);
      expect(chineseMessage).toBe(zh);
      for (const value of rawValues) {
        expect(englishMessage).not.toContain(value);
        expect(chineseMessage).not.toContain(value);
      }
    },
  );

  it("fails closed for unknown or noncanonical product-fit reasons", () => {
    const unknownMessage = productFitReasonMessage(
      {
        code: "FUTURE_REASON" as ProductFitReasonCode,
        message: "产品已经合规，可立即销售。",
      },
      "zh-CN",
    );
    const noncanonicalKnownMessage = productFitReasonMessage(
      {
        code: "CERTIFICATION_EXPIRED",
        message: "供应商说证书应该过期了。",
      },
      "zh-CN",
    );

    expect(unknownMessage).toContain("无法识别的原因码");
    expect(unknownMessage).not.toContain("可立即销售");
    expect(noncanonicalKnownMessage).toBe("认证在评估日期前已到期。");
    expect(noncanonicalKnownMessage).not.toContain("供应商说");
  });

  it("rebuilds server-authored warnings from typed state in both locales", () => {
    const result = clientAiToolResultSchema.parse({
      citations: [productCitation],
      evaluations: [
        {
          asOf: "2026-08-12",
          commercialReadiness: "unknown",
          input: {
            applicationScope: "non-road",
            asOf: "2026-08-12",
            countryIso3: "CHN",
            powerKw: 100,
            productModelCode: "DEMO-ENG-200",
          },
          product: {
            applicationScopes: ["non-road"],
            availableFrom: "2025-01-01",
            availableTo: "2027-01-01",
            id: "00000000-0000-4000-8000-000000000220",
            isDemo: false,
            modelCode: "DEMO-ENG-200",
            name: "DEMO ONLY — Fictional Engine 200",
            powerMaxKw: 150,
            powerMinKw: 50,
            source: {
              id: "00000000-0000-4000-8000-000000000221",
              isDemo: false,
              publishedOn: "2026-01-01",
              title: "DEMO ONLY — Fictional product manual",
              url: "https://example.com/product-manual",
              verifiedAt: "2026-01-02T00:00:00.000Z",
            },
            specificationVersion: "demo-v1",
            verifiedAt: "2026-01-02T00:00:00.000Z",
          },
          productChecks: {
            applicationScope: {
              code: "APPLICATION_SCOPE_MATCH",
              message: "产品覆盖 non-road 应用场景。",
              status: "pass",
            },
            availability: {
              code: "PRODUCT_AVAILABLE",
              message:
                "查询日 2026-08-12 位于产品供应期 [2025-01-01, 2027-01-01) 内。",
              status: "pass",
            },
            power: {
              code: "PRODUCT_POWER_MATCH",
              message:
                "产品功率范围覆盖 100 kW（区间按 [min, max) 判断）。",
              status: "pass",
            },
          },
          reasons: [
            {
              code: "NO_APPLICABLE_REGULATION_DATA",
              message:
                "未找到覆盖该国家、场景、功率和日期的有效法规，不能推断合规。",
              status: "unknown",
            },
          ],
          regulationChecks: [],
          rulesetVersion: "product-fit-v2",
          sources: [
            {
              id: "00000000-0000-4000-8000-000000000221",
              isDemo: false,
              publishedOn: "2026-01-01",
              title: "DEMO ONLY — Fictional product manual",
              url: "https://example.com/product-manual",
              verifiedAt: "2026-01-02T00:00:00.000Z",
            },
          ],
          status: "unknown",
        },
      ],
      evidenceSufficient: false,
      informationAsOf: "2026-08-12",
      latestVerifiedAt: tracedClientCitation.verifiedAt,
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
        "没有足够证据支持肯定结论；请补充结构化事实或可追溯来源。",
        "1 个产品因当前可见证据不足而标记为 unknown。",
      ],
    });

    const englishWarnings = localizedToolWarnings(
      result,
      "en",
      getDictionary("en").chat,
    );
    const chineseWarnings = localizedToolWarnings(
      result,
      "zh-CN",
      getDictionary("zh-CN").chat,
    );

    expect(englishWarnings).toEqual([
      expect.stringContaining("not enough evidence"),
      expect.stringContaining("1 product(s) remain unknown"),
    ]);
    expect(englishWarnings.join(" ")).not.toMatch(/[\p{Script=Han}]/u);
    expect(chineseWarnings).toEqual([
      expect.stringContaining("没有足够证据"),
      expect.stringContaining("1 个产品"),
    ]);
    expect(chineseWarnings.join(" ")).toContain("未知状态");
    expect(
      clientAiToolResultSchema.safeParse({
        ...result,
        warnings: [...result.warnings, "FORGED_PRODUCT_WARNING"],
      }).success,
    ).toBe(false);
    expect(chineseWarnings.join(" ")).not.toContain("unknown");
    expect(chineseWarnings.join(" ")).not.toContain("标记为");
  });

  it("derives known knowledge warnings from metadata and fails closed for drifted text", () => {
    const result = clientAiToolResultSchema.parse({
      citations: [knowledgeCitation],
      evidenceSufficient: true,
      informationAsOf: "2026-08-12",
      latestVerifiedAt: tracedClientCitation.verifiedAt,
      resolvedCountryIso3: null,
      search: {
        embeddingModel: "local-hash-embedding-v1",
        filters: {
          applicationScope: null,
          asOf: "2026-08-12",
          countryIso3: null,
          jurisdictionId: null,
          limit: 5,
        },
        query: "original knowledge excerpt",
        results: [
          {
            applicationScope: null,
            chunkId: knowledgeIds.chunk,
            content: wrapUntrustedKnowledgeExcerpt(
              "Original knowledge excerpt remains untouched.",
            ),
            countryIso3: null,
            document: {
              downloadUrl: null,
              id: knowledgeIds.document,
              originalFilename: null,
              publishedOn: "2026-01-01",
              source: {
                id: knowledgeIds.source,
                isDemo: false,
                publishedOn: "2026-01-01",
                publisher: null,
                title: "Original source title",
                url: "https://example.com/evidence",
                verifiedAt: "2026-01-02T00:00:00.000Z",
              },
              title: "Original source document title",
            },
            finalScore: 0.8,
            headingPath: null,
            jurisdiction: null,
            keywordScore: 0.8,
            pageFrom: null,
            pageTo: null,
            rank: 1,
            sectionLocator: null,
            validFrom: null,
            validTo: null,
            vectorScore: 0.8,
            warnings: [
              "该片段未记录 validFrom，日期适用性仍需人工核验。",
              "该片段未记录国家 metadata。",
              "该片段未记录应用场景 metadata。",
            ],
          },
        ],
        scoring: { keywordWeight: 0.5, vectorWeight: 0.5 },
        status: "ok",
      },
      status: "ok",
      tool: "searchKnowledgeBase",
      warnings: [
        "该片段未记录 validFrom，日期适用性仍需人工核验。",
        "该片段未记录国家 metadata。",
        "该片段未记录应用场景 metadata。",
      ],
    });

    const chineseWarnings = localizedToolWarnings(
      result,
      "zh-CN",
      getDictionary("zh-CN").chat,
    );
    const englishWarnings = localizedToolWarnings(
      result,
      "en",
      getDictionary("en").chat,
    );

    expect(chineseWarnings).toEqual([
      expect.stringContaining("1 条知识片段未记录应用场景"),
      expect.stringContaining("1 条知识片段未记录国家"),
      expect.stringContaining("1 条知识片段未记录生效日期"),
    ]);
    expect(englishWarnings).toEqual([
      expect.stringContaining("1 knowledge excerpt(s) do not record an application scope"),
      expect.stringContaining("1 knowledge excerpt(s) do not record a country"),
      expect.stringContaining("1 knowledge excerpt(s) do not record a valid-from date"),
    ]);
    expect(chineseWarnings.join(" ")).not.toContain("validFrom");
    expect(chineseWarnings.join(" ")).not.toContain("metadata");
    expect(
      clientAiToolResultSchema.safeParse({
        ...result,
        warnings: [...result.warnings, "DRIFTED_INTERNAL_WARNING"],
      }).success,
    ).toBe(false);
    const driftedHitWarning = structuredClone(result) as unknown as {
      search: { results: Array<{ warnings: string[] }> };
    };
    driftedHitWarning.search.results[0]?.warnings.push(
      "FORGED_HIT_WARNING",
    );
    expect(
      clientAiToolResultSchema.safeParse(driftedHitWarning).success,
    ).toBe(false);
    expect(chineseWarnings.join(" ")).not.toContain("DRIFTED_INTERNAL_WARNING");
  });

  it("rebuilds country-profile topic gaps from typed result state", () => {
    const result = clientAiToolResultSchema.parse({
      citations: [countryProfileCitation],
      evidenceSufficient: false,
      informationAsOf: "2026-08-12",
      latestVerifiedAt: tracedClientCitation.verifiedAt,
      profile: {
        applicabilitySummary: null,
        asOf: "2026-08-12",
        country: {
          currentEffectiveRegulations: [],
          dataCoverageStatus: "covered",
          futureAdoptedRegulations: [],
          isDemo: false,
          iso2: "CN",
          iso3: "CHN",
          isStale: false,
          jurisdictions: [],
          lastVerifiedAt: "2026-01-02T00:00:00.000Z",
          marketMetrics: [],
          nameEn: "China",
          nameLocal: "中国",
          regionCode: "ASIA",
          source: {
            id: "00000000-0000-4000-8000-000000000091",
            isDemo: false,
            publishedOn: "2026-01-01",
            publisher: null,
            title: "Country source",
            url: "https://example.com/country-source",
            verifiedAt: "2026-01-02T00:00:00.000Z",
          },
          sources: [
            {
              id: "00000000-0000-4000-8000-000000000091",
              isDemo: false,
              publishedOn: "2026-01-01",
              publisher: null,
              title: "Country source",
              url: "https://example.com/country-source",
              verifiedAt: "2026-01-02T00:00:00.000Z",
            },
          ],
          subregionCode: "EASTERN_ASIA",
          verifiedAt: "2026-01-02T00:00:00.000Z",
        },
        status: "available",
      },
      requestedTopics: ["country", "regulations", "market"],
      resolvedCountryIso3: "CHN",
      status: "no_data",
      tool: "getCountryProfile",
      warnings: [
        "没有足够证据支持肯定结论；请补充结构化事实或可追溯来源。",
        "所请求国家没有可见的当前 effective 或未来 adopted 法规证据。",
        "所请求国家没有结构化市场指标证据。",
      ],
    });

    const englishWarnings = localizedToolWarnings(
      result,
      "en",
      getDictionary("en").chat,
    );
    const chineseWarnings = localizedToolWarnings(
      result,
      "zh-CN",
      getDictionary("zh-CN").chat,
    );

    expect(englishWarnings).toEqual([
      expect.stringContaining("not enough evidence"),
      expect.stringContaining("no visible current effective"),
      expect.stringContaining("no structured market-metric evidence"),
    ]);
    expect(englishWarnings.join(" ")).not.toMatch(/[\p{Script=Han}]/u);
    expect(englishWarnings.join(" ")).not.toContain("additional evidence");
    expect(chineseWarnings).toEqual([
      expect.stringContaining("没有足够证据"),
      expect.stringContaining("当前生效或未来已采纳法规证据"),
      expect.stringContaining("结构化市场指标证据"),
    ]);
    expect(chineseWarnings.join(" ")).not.toContain("effective");
    expect(chineseWarnings.join(" ")).not.toContain("adopted");
    expect(
      clientAiToolResultSchema.safeParse({
        ...result,
        warnings: [...result.warnings, "FORGED_PROFILE_WARNING"],
      }).success,
    ).toBe(false);

    expect(
      clientAiToolResultSchema.safeParse({
        ...result,
        profile: {
          country: {
            currentEffectiveRegulations: [],
            futureAdoptedRegulations: [],
            marketMetrics: [{ unexpected: "not evidence" }],
          },
          status: "available",
        },
      }).success,
    ).toBe(false);
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
    expect(english).not.toContain("Reason codes");
    expect(english).not.toContain("PRODUCT_NOT_FOUND");
    expect(english).not.toMatch(/[\p{Script=Han}]/u);
    expect(chinese).toContain("产品适配补数摘要");
    expect(chinese).toContain("没有找到该产品型号的结构化记录");
    expect(chinese).not.toContain("原因码");
    expect(chinese).not.toContain("PRODUCT_NOT_FOUND");
    expect(chinese).not.toContain("产品未知：数据库中没有该型号");

    const chineseDemo = buildProductFitDataGapSummary({
      dictionary: getDictionary("zh-CN"),
      evaluation: productFitEvaluationSchema.parse({
        ...evaluation,
        product: {
          applicationScopes: ["non-road"],
          availableFrom: "2025-01-01",
          availableTo: "2027-01-01",
          id: "00000000-0000-4000-8000-000000000202",
          isDemo: true,
          modelCode: "DEMO-ENG-200",
          name: "DEMO ONLY — Fictional Engine 200",
          powerMaxKw: 200,
          powerMinKw: 50,
          source: {
            id: "00000000-0000-4000-8000-000000000003",
            isDemo: true,
            publishedOn: null,
            title: "DEMO ONLY — Fictional product manual",
            url: null,
            verifiedAt: "2026-08-12T00:00:00.000Z",
          },
          specificationVersion: "demo-v1",
          verifiedAt: "2026-08-12T00:00:00.000Z",
        },
      }),
      locale: "zh-CN",
      scopeLabel: "非道路",
    });

    expect(chineseDemo).toContain("仅限 Demo — 虚构发动机 200");
    expect(chineseDemo).not.toContain("Fictional Engine 200");
    expect(chineseDemo).not.toContain("(non-road)");
  });

  it("maps every typed product-fit reason to localized required fields without exposing internal codes", () => {
    const evaluation = productFitEvaluationSchema.parse({
      asOf: "2026-08-12",
      commercialReadiness: "unknown",
      input: {
        applicationScope: "non-road",
        asOf: "2026-08-12",
        countryIso3: "CHN",
        powerKw: 100,
        productModelCode: "UNKNOWN",
      },
      product: null,
      productChecks: {
        applicationScope: {
          code: "PRODUCT_NOT_FOUND",
          message: "raw product message",
          status: "unknown",
        },
        availability: {
          code: "PRODUCT_NOT_FOUND",
          message: "raw availability message",
          status: "unknown",
        },
        power: {
          code: "PRODUCT_NOT_FOUND",
          message: "raw power message",
          status: "unknown",
        },
      },
      reasons: productFitReasonCodeSchema.options.map((code) => ({
        code,
        message: `raw ${code}`,
        status: "unknown" as const,
      })),
      regulationChecks: [],
      rulesetVersion: "product-fit-v2",
      sources: [],
      status: "unknown",
    });

    for (const locale of ["en", "zh-CN"] as const) {
      const dictionary = getDictionary(locale);
      const summary = buildProductFitDataGapSummary({
        dictionary,
        evaluation,
        locale,
        scopeLabel: locale === "en" ? "Non-road" : "非道路",
      });

      for (const code of productFitReasonCodeSchema.options) {
        expect(summary).not.toContain(code);
      }
      expect(summary).not.toContain("raw ");
      expect(summary).toContain(dictionary.productFit.requiredProductFields);
      expect(summary).toContain(dictionary.productFit.requiredRegulationFields);
      expect(summary).toContain(
        dictionary.productFit.requiredCertificationFields,
      );
    }
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

  it("never exposes raw service-authored score details in either locale", () => {
    const component = {
      configuredWeight: 0.5,
      contribution: 42,
      effectiveWeight: 0.5,
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
    expect(english.explanation).toContain("typed evidence projection");
    expect(english.inputSummary).toBeNull();
    expect(`${english.explanation} ${english.inputSummary}`).not.toMatch(
      /[\p{Script=Han}]/u,
    );
    expect(chinese.explanation).toContain(
      "市场潜力 基于类型化证据投影得到确定性评分 84/100",
    );
    expect(chinese.inputSummary).toBeNull();
  });

  it("rebuilds sales-brief structure without raw service-authored free text", () => {
    const brief = {
        marketScore: {
          components: [
            {
              configuredWeight: 0.5,
              contribution: 42,
              effectiveWeight: 0.5,
              key: "marketPotential",
              score: 84,
              status: "available",
            },
            {
              configuredWeight: 0.3,
              contribution: 18,
              effectiveWeight: 0.3,
              key: "productReadiness",
              score: 60,
              status: "available",
            },
            {
              configuredWeight: 0.2,
              contribution: 12,
              effectiveWeight: 0.2,
              key: "regulatoryCoverage",
              score: 60,
              status: "available",
            },
          ],
          countryIso3: "BRA",
          dataCoveragePct: 100,
          gaps: [],
          overallScore: 72,
        },
        opportunities: [
          {
            metricCodes: ["DEMO_ADDRESSABLE_UNITS"],
            ruleCode: "MARKET_POTENTIAL_AT_LEAST_50",
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
            productIds: ["product-1", "product-2"],
            ruleCode: "PRODUCT_EVIDENCE_UNKNOWN",
          },
        ],
        salesActions: [
          {
            priority: "high",
            regulationIds: ["regulation-1"],
            ruleCode: "REVALIDATE_BEFORE_FUTURE_REGULATION",
          },
        ],
      } as unknown as Extract<
        ClientAiToolResult,
        { tool: "generateSalesBrief" }
      >["brief"];
    const renderBrief = (locale: "en" | "zh-CN") => {
      const copy = getDictionary(locale).chat;
      const actionCopy = localizedSalesBriefAction(
        brief.salesActions[0]!,
        0,
        locale,
        copy,
      );
      return {
        actionCopy,
        rendered: [
          localizedSalesBriefSummary(brief, locale, copy),
          localizedSalesBriefItem(
            brief.risks[0]!,
            0,
            "risk",
            locale,
            copy,
          ),
          localizedSalesBriefItem(
            brief.opportunities[0]!,
            0,
            "opportunity",
            locale,
            copy,
          ),
          actionCopy,
        ].join(" "),
      };
    };
    const { actionCopy, rendered } = renderBrief("en");
    const chinese = renderBrief("zh-CN").rendered;

    expect(rendered).toContain("BRA has a deterministic opportunity score");
    expect(rendered).toContain(OPPORTUNITY_SCORE_RULESET_VERSION);
    expect(rendered).toContain("Risk 1: deterministic risk linked to 2");
    expect(rendered).toContain("Action 1 (high priority)");
    expect(rendered).toContain("Validate it against the structured evidence");
    expect(actionCopy).not.toContain("ready product");
    expect(actionCopy).not.toContain("structured data gap");
    expect(rendered).not.toMatch(/[\p{Script=Han}]/u);
    expect(chinese).toContain("BRA 在 opportunity-score-v2 下的确定性机会分");
    expect(chinese).toContain("风险 1：确定性风险关联 2 条证据记录");
    expect(chinese).toContain("行动 1（高优先级）");
    expect(Reflect.has(brief, "executiveSummary")).toBe(false);
    expect(Reflect.has(brief.risks[0]!, "title")).toBe(false);
    expect(Reflect.has(brief.risks[0]!, "text")).toBe(false);
    expect(Reflect.has(brief.opportunities[0]!, "title")).toBe(false);
    expect(Reflect.has(brief.opportunities[0]!, "text")).toBe(false);
    expect(Reflect.has(brief.salesActions[0]!, "action")).toBe(false);
  });

  it("rebuilds only typed generated citation titles", () => {
    const baseCitation = {
      chunkId: null,
      countryIso3: "CHN",
      documentId: null,
      documentTitle: null,
      isDemo: false,
      locator: null,
      pageFrom: null,
      pageTo: null,
      productCertificationId: null,
      publishedOn: null,
      regulationId: null,
      regulationStatus: null,
      sectionLocator: null,
      sourceId: "source-1",
      sourceTitle: "Original source title",
      sourceUrl: null,
      title: "raw title that must not be parsed",
      verifiedAt: "2026-08-12T00:00:00.000Z",
    } satisfies ClientAiCitation;
    const english = getDictionary("en");
    const chinese = getDictionary("zh-CN");
    const cases = [
      {
        descriptor: {
          jurisdictionName: "Authority A",
          kind: "regulation_jurisdiction" as const,
          regulationName: "Regulation A",
        },
        en: "Regulation A · Applicable jurisdiction: Authority A",
        zh: "Regulation A 适用辖区：Authority A",
      },
      {
        descriptor: {
          countryIso3: "CHN",
          jurisdictionName: "Authority A",
          kind: "country_jurisdiction_membership" as const,
        },
        en: "Authority A membership for CHN",
        zh: "Authority A 对 CHN 的成员关系",
      },
      {
        descriptor: {
          countryIsDemo: true,
          countryIso2: "CN",
          countryIso3: "CHN",
          countryNameEn: "China — demo fixture",
          countryNameLocal: null,
          countrySourceId: "00000000-0000-4000-8000-000000000001",
          countrySourceIsDemo: true,
          countrySourceTitle: "DEMO ONLY — Fictional country metadata source",
          kind: "country_profile" as const,
        },
        en: "China — demo fixture country profile",
        zh: "中国（演示数据） 国家概览",
      },
      {
        descriptor: {
          kind: "regulation_limits" as const,
          regulationName: "Regulation A",
        },
        en: "Regulation A applicable limits",
        zh: "Regulation A 适用限值",
      },
      {
        descriptor: {
          kind: "regulation_pollutant_limit" as const,
          pollutantCode: "NOx",
          regulationName: "Regulation A",
        },
        en: "Regulation A NOx limit",
        zh: "Regulation A NOx 限值",
      },
      {
        descriptor: {
          kind: "product_certification_record" as const,
          productModelCode: "DEMO-ENG-100",
        },
        en: "DEMO-ENG-100 certification record",
        zh: "DEMO-ENG-100认证记录",
      },
      {
        descriptor: {
          isDemo: true,
          kind: "market_metric" as const,
          metricCode: "DEMO_ADDRESSABLE_UNITS",
          metricId: "00000000-0000-4000-8000-000000000701",
          metricName: "DEMO ONLY — Fictional addressable units",
        },
        en: "DEMO ONLY — Fictional addressable units",
        zh: "仅限 Demo — 虚构年度可触达台数",
      },
    ];

    for (const testCase of cases) {
      const citation = {
        ...baseCitation,
        titleDescriptor: testCase.descriptor,
      } satisfies ClientAiCitation;
      expect(localizedCitationTitle(citation, "en", english)).toBe(testCase.en);
      expect(localizedCitationTitle(citation, "zh-CN", chinese)).toBe(
        testCase.zh,
      );
    }
    expect(
      localizedCitationTitle(
        {
          ...baseCitation,
          titleDescriptor: {
            kind: "product_certification_record",
            productModelCode: null,
          },
        },
        "en",
        english,
      ),
    ).toBe("Product certification record");
    expect(
      localizedCitationTitle(
        {
          ...baseCitation,
          titleDescriptor: {
            kind: "product_certification_record",
            productModelCode: null,
          },
        },
        "zh-CN",
        chinese,
      ),
    ).toBe("产品认证记录");

    expect(
      localizedCitationTitle(
        {
          ...baseCitation,
          title: "真实文件 NOx 限值",
        },
        "en",
        english,
      ),
    ).toBe("真实文件 NOx 限值");
    expect(
      localizedCitationTitle(
        {
          ...baseCitation,
          title: "Original source title 适用限值",
        },
        "zh-CN",
        chinese,
      ),
    ).toBe("Original source title 适用限值");
    expect(
      localizedCitationTitle(
        {
          ...baseCitation,
          documentId: "00000000-0000-4000-8000-000000000999",
          documentTitle: "Original evidence document",
          title: "Original evidence document",
          titleDescriptor: {
            kind: "regulation_limits",
            regulationName: "Must not win",
          },
        },
        "zh-CN",
        chinese,
      ),
    ).toBe("Original evidence document");
    expect(
      localizedCitationTitle(
        {
          ...baseCitation,
          chunkId: "00000000-0000-4000-8000-000000000998",
          title: "Original evidence chunk title",
          titleDescriptor: {
            kind: "regulation_limits",
            regulationName: "Must not win",
          },
        },
        "en",
        english,
      ),
    ).toBe("Original evidence chunk title");
    expect(
      localizedCitationTitle(
        {
          ...baseCitation,
          isDemo: true,
          title: "DEMO ONLY — Fictional addressable units",
          titleDescriptor: {
            isDemo: true,
            kind: "market_metric",
            metricCode: "DEMO_ADDRESSABLE_UNITS",
            metricId: "00000000-0000-4000-8000-000000000799",
            metricName: "DEMO ONLY — Fictional addressable units",
          },
        },
        "zh-CN",
        chinese,
      ),
    ).toBe("DEMO ONLY — Fictional addressable units");
  });

  it("validates strict title descriptors while keeping them optional", () => {
    const descriptors = [
      {
        jurisdictionName: "Authority A",
        kind: "regulation_jurisdiction",
        regulationName: "Regulation A",
      },
      {
        countryIso3: "CHN",
        jurisdictionName: "Authority A",
        kind: "country_jurisdiction_membership",
      },
      {
        countryIsDemo: false,
        countryIso2: "CN",
        countryIso3: "CHN",
        countryNameEn: "China",
        countryNameLocal: "中国",
        countrySourceId: "00000000-0000-4000-8000-000000000001",
        countrySourceIsDemo: false,
        countrySourceTitle: "Country metadata source",
        kind: "country_profile",
      },
      { kind: "regulation_limits", regulationName: "Regulation A" },
      {
        kind: "regulation_pollutant_limit",
        pollutantCode: "NOx",
        regulationName: "Regulation A",
      },
      {
        kind: "product_certification_record",
        productModelCode: null,
      },
      {
        isDemo: true,
        kind: "market_metric",
        metricCode: "DEMO_ADDRESSABLE_UNITS",
        metricId: "00000000-0000-4000-8000-000000000701",
        metricName: "DEMO ONLY — Fictional addressable units",
      },
    ];

    for (const descriptor of descriptors) {
      expect(citationTitleDescriptorSchema.safeParse(descriptor).success).toBe(
        true,
      );
    }
    expect(
      citationTitleDescriptorSchema.safeParse({
        ...descriptors[0],
        unexpected: "field",
      }).success,
    ).toBe(false);
    expect(
      citationTitleDescriptorSchema.safeParse({
        countryIso3: "China",
        jurisdictionName: "Authority A",
        kind: "country_jurisdiction_membership",
      }).success,
    ).toBe(false);
    expect(
      citationTitleDescriptorSchema.safeParse({
        countryIsDemo: false,
        countryIso2: "CHN",
        countryIso3: "CHN",
        countryNameEn: "China",
        countryNameLocal: null,
        countrySourceId: "00000000-0000-4000-8000-000000000001",
        countrySourceIsDemo: false,
        countrySourceTitle: "Country metadata source",
        kind: "country_profile",
      }).success,
    ).toBe(false);
    expect(
      citationTitleDescriptorSchema.safeParse({
        ...descriptors[2],
        countryNameLocal: " ",
      }).success,
    ).toBe(false);
    expect(
      citationTitleDescriptorSchema.safeParse({
        isDemo: true,
        kind: "market_metric",
        metricCode: "DEMO_ADDRESSABLE_UNITS",
        metricId: "not-a-uuid",
        metricName: "DEMO ONLY — Fictional addressable units",
      }).success,
    ).toBe(false);
    expect(
      citationTitleDescriptorSchema.safeParse({
        kind: "regulation_limits",
        regulationName: " ",
      }).success,
    ).toBe(false);
  });

  it("localizes only typed citation locators and preserves opaque source text", () => {
    const baseCitation = {
      chunkId: null,
      countryIso3: "CHN",
      documentId: null,
      documentTitle: null,
      isDemo: false,
      locator: "raw locator",
      pageFrom: null,
      pageTo: null,
      productCertificationId: null,
      publishedOn: null,
      regulationId: null,
      regulationStatus: null,
      sectionLocator: null,
      sourceId: "source-1",
      sourceTitle: "Original source title",
      sourceUrl: null,
      title: "Original citation title",
      verifiedAt: "2026-08-12T00:00:00.000Z",
    } satisfies ClientAiCitation;
    const chinese = getDictionary("zh-CN");
    const english = getDictionary("en");

    expect(
      localizedCitationLocator(
        {
          ...baseCitation,
          locator: "2025-01-01–open",
          locatorDescriptor: {
            kind: "membership_period",
            validFrom: "2025-01-01",
            validTo: null,
          },
        },
        "zh-CN",
        chinese,
      ),
    ).toBe("2025年1月1日 → 开放");
    expect(
      localizedCitationLocator(
        {
          ...baseCitation,
          locator: "2025-01-01–2025-12-31",
          locatorDescriptor: {
            kind: "market_period",
            periodEnd: "2025-12-31",
            periodStart: "2025-01-01",
          },
        },
        "en",
        english,
      ),
    ).toBe("Jan 1, 2025 → Dec 31, 2025");
    expect(
      localizedCitationLocator(
        {
          ...baseCitation,
          locator: "NOx 2025-01-01–open",
          locatorDescriptor: {
            kind: "regulation_limit_period",
            pollutantCode: "NOx",
            validFrom: "2025-01-01",
            validTo: null,
          },
        },
        "zh-CN",
        chinese,
      ),
    ).toBe("NOx · 2025年1月1日 → 开放");
    expect(
      localizedCitationLocator(
        {
          ...baseCitation,
          locator: "DEMO-ENG-100; availability unknown–unknown",
          locatorDescriptor: {
            availableFrom: null,
            availableTo: null,
            kind: "product_availability",
            modelCode: "DEMO-ENG-100",
          },
        },
        "zh-CN",
        chinese,
      ),
    ).toBe("DEMO-ENG-100 · 产品供应期：未记录");
    expect(
      localizedCitationLocator(
        {
          ...baseCitation,
          locator: "DEMO-ENG-100; availability 2025-01-01–unknown",
          locatorDescriptor: {
            availableFrom: "2025-01-01",
            availableTo: null,
            kind: "product_availability",
            modelCode: "DEMO-ENG-100",
          },
        },
        "en",
        english,
      ),
    ).toBe(
      "DEMO-ENG-100 · Product availability period: Jan 1, 2025 → Not recorded",
    );

    const opaque = "open availability / unknown §2";
    expect(
      localizedCitationLocator(
        { ...baseCitation, locator: opaque },
        "zh-CN",
        chinese,
      ),
    ).toBe(opaque);
    const legacyProductLocator =
      "DEMO-ENG-100; availability 2025-01-01–open";
    expect(
      localizedCitationLocator(
        { ...baseCitation, locator: legacyProductLocator },
        "en",
        english,
      ),
    ).toBe(legacyProductLocator);
    expect(
      localizedCitationLocator(
        {
          ...baseCitation,
          locator: "generated locator must not win",
          locatorDescriptor: {
            kind: "membership_period",
            validFrom: "2025-01-01",
            validTo: null,
          },
          sectionLocator: opaque,
        },
        "zh-CN",
        chinese,
      ),
    ).toBe(opaque);
    expect(
      localizedCitationLocator(
        {
          ...baseCitation,
          locatorDescriptor: {
            kind: "membership_period",
            validFrom: "2025-01-01",
            validTo: null,
          },
          pageFrom: 2,
          pageTo: 4,
          sectionLocator: opaque,
        },
        "zh-CN",
        chinese,
      ),
    ).toBe("第 2–4 页");

    expect(
      localizedCitationLocator(
        {
          locator: "2000-01-01–open",
          locatorDescriptor: {
            kind: "membership_period",
            validFrom: "2000-01-01",
            validTo: null,
          },
        },
        "zh-CN",
        chinese,
        chinese.country.noLocator,
      ),
    ).toBe("2000年1月1日 → 开放");
    expect(
      localizedCitationLocator(
        { locator: "DEMO-CHN-NR-A" },
        "zh-CN",
        chinese,
        chinese.country.noLocator,
      ),
    ).toBe("DEMO-CHN-NR-A");
    expect(
      localizedCitationLocator(
        { locator: null },
        "zh-CN",
        chinese,
        chinese.country.noLocator,
      ),
    ).toBe(chinese.country.noLocator);
  });

  it("validates locator descriptors without requiring them on legacy citations", () => {
    for (const descriptor of [
      {
        kind: "membership_period",
        validFrom: "2025-01-01",
        validTo: null,
      },
      {
        kind: "market_period",
        periodEnd: "2025-12-31",
        periodStart: "2025-01-01",
      },
      {
        kind: "regulation_limit_period",
        pollutantCode: "NOx",
        validFrom: "2025-01-01",
        validTo: null,
      },
      {
        availableFrom: null,
        availableTo: "2030-01-01",
        kind: "product_availability",
        modelCode: "DEMO-ENG-100",
      },
    ]) {
      expect(citationLocatorDescriptorSchema.safeParse(descriptor).success).toBe(
        true,
      );
    }
    expect(
      citationLocatorDescriptorSchema.safeParse({
        kind: "membership_period",
        validFrom: "not-a-date",
        validTo: null,
      }).success,
    ).toBe(false);
    expect(
      citationLocatorDescriptorSchema.safeParse({
        kind: "product_availability",
        modelCode: "DEMO-ENG-100",
        validFrom: "2025-01-01",
        validTo: null,
      }).success,
    ).toBe(false);

    for (const descriptor of [
      {
        kind: "membership_period",
        validFrom: "2025-12-31",
        validTo: "2025-01-01",
      },
      {
        kind: "market_period",
        periodEnd: "2025-01-01",
        periodStart: "2025-12-31",
      },
      {
        kind: "regulation_limit_period",
        pollutantCode: "NOx",
        validFrom: "2025-12-31",
        validTo: "2025-01-01",
      },
      {
        availableFrom: "2025-12-31",
        availableTo: "2025-01-01",
        kind: "product_availability",
        modelCode: "DEMO-ENG-100",
      },
    ]) {
      expect(
        citationLocatorDescriptorSchema.safeParse(descriptor).success,
      ).toBe(false);
    }
  });
});
