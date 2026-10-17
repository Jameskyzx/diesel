

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildEvidenceGapResponse, regulatoryDisclaimer } from "@/domain/ai/evidence-gap-response";

import { aiToolResultSchema, type AiToolName } from "@/features/ai/schemas";
import type { Locale } from "@/i18n/locale";

import { buildCountryProfileResult, buildToolErrorResult } from "@/server/ai/tool-results";
import { getDemoDatabase } from "@/server/db/demo-client";
import { getCountryDetails } from "@/server/services/country-service";

const asOf = "2026-08-20";
const scoped = { applicationScope: "non-road", asOf, powerKw: 100 };
const countries = { ...scoped, countryIso3s: ["CHN", "BRA"] };
const sourceQuery = "CHN non-road emissions regulations original text sections source evidence";
const cases = [
  {
    tool: "getCountryProfile",
    input: { asOf, countryIso3: "CHN", topics: ["country"] },
    request: { en: `Give a CHN country overview as of ${asOf}.`, "zh-CN": `查询 CHN 国家基础概览，截至 ${asOf}。` },
  },
  {
    tool: "findCompatibleProducts",
    input: { ...scoped, countryIso3: "CHN" },
    request: { en: `Evaluate product fit for CHN non-road 100 kW as of ${asOf}.`, "zh-CN": `评估 CHN 非道路 100 kW 产品合规适配，截至 ${asOf}。` },
  },
  {
    tool: "compareRegulations",
    input: countries,
    request: { en: `Compare CHN and BRA non-road regulations for 100 kW as of ${asOf}.`, "zh-CN": `比较 CHN 和 BRA 非道路 100 kW 法规，截至 ${asOf}。` },
  },
  {
    tool: "compareMarkets",
    input: { countryIso3s: ["CHN", "BRA"], metricCodes: ["DEMO_ADDRESSABLE_UNITS"] },
    request: { en: "Compare the CHN and BRA DEMO_ADDRESSABLE_UNITS market metric.", "zh-CN": "比较 CHN 和 BRA 的 DEMO_ADDRESSABLE_UNITS 市场指标。" },
  },
  {
    tool: "calculateOpportunityScore",
    input: countries,
    request: { en: `Calculate opportunity scores for CHN and BRA non-road 100 kW as of ${asOf}.`, "zh-CN": `为 CHN 和 BRA 的非道路 100 kW 做 ${asOf} 机会评分。` },
  },
  {
    tool: "generateSalesBrief",
    input: { ...countries, targetCountryIso3: "CHN" },
    request: { en: `Generate a sales brief targeting CHN with BRA as a benchmark for non-road 100 kW as of ${asOf}.`, "zh-CN": `以 CHN 为目标、BRA 为对照，生成非道路 100 kW、${asOf} 的销售简报。` },
  },
  {
    tool: "searchKnowledgeBase",
    input: { applicationScope: "non-road", asOf, countryIso3: "CHN", query: sourceQuery },
    request: { en: `Retrieve ${sourceQuery} as of ${asOf}.`, "zh-CN": `检索 CHN 非道路排放法规原文、章节和来源证据，截至 ${asOf}。` },
  },
] satisfies { tool: AiToolName; input: Record<string, unknown>; request: Record<Locale, string> }[];

const failureDetail = (locale: Locale) => locale === "en"
  ? "The service could not complete this query or validate its tool parameters. This does not mean the requested data is absent. Retry the same question; no need to change valid inputs."
  : "系统未能完成本次查询或校验工具参数，这不代表没有相关数据。可以原样重试，无需修改已经正确提供的条件。";
const absentDataAssertions = /no matching source text|lacks the .* evidence|lacks sufficient evidence for a conclusive product-fit|no sufficient visible|No directly comparable market metric|Opportunity ranking needs|The sales brief lacks|知识库没有检索到|缺少本次请求所需|没有确定的适配结论|没有足够的可见|市场比较没有找到|机会排名至少需要|销售简报缺少/u;
const originalDatabaseMode = process.env.DATABASE_MODE;
let database: Awaited<ReturnType<typeof getDemoDatabase>>;

beforeAll(async () => {
  process.env.DATABASE_MODE = "pglite-demo";
  database = await getDemoDatabase();
}, 15_000);

afterAll(async () => {
  if (originalDatabaseMode === undefined) delete process.env.DATABASE_MODE;
  else process.env.DATABASE_MODE = originalDatabaseMode;
  await database?.$client.close();
});

describe("execution errors are not evidence of absent data", () => {

  for (const locale of ["en", "zh-CN"] as const) {
    it.each(cases)(`explains a canonical $tool error without inventing data absence in ${locale}`, ({ tool, input }) => {
      const result = aiToolResultSchema.parse(buildToolErrorResult(tool, asOf, input));
      const before = structuredClone(result);
      for (const explicitFailure of [false, true]) {
        const response = buildEvidenceGapResponse([result], explicitFailure, false, locale);
        expect(response).toContain(failureDetail(locale));
        expect(response.split(failureDetail(locale))).toHaveLength(2);
        expect(response).not.toMatch(absentDataAssertions);
        expect(response).toContain(regulatoryDisclaimer(locale));
      }
      expect(result).toEqual(before);
    });

    it(`preserves actual no-data guidance and successful cards beside errors in ${locale}`, async () => {
      const profile = await getCountryDetails({ asOf, iso3: "CHN" });
      const success = buildCountryProfileResult({ informationAsOf: asOf, profile, requestedTopics: ["country"], resolvedCountryIso3: "CHN" });
      const noData = buildCountryProfileResult({ informationAsOf: asOf,
        profile: await getCountryDetails({ asOf, iso3: "FJI" }), requestedTopics: ["market"], resolvedCountryIso3: "FJI" });
      expect(success.status).toBe("ok");
      expect(success.evidenceSufficient).toBe(true);
      expect(noData.status).toBe("no_data");
      const error = buildToolErrorResult("getCountryProfile", asOf, { asOf, countryIso3: "CHN", topics: ["country"] });
      const baseline = buildEvidenceGapResponse([noData], false, false, locale);
      expect(baseline).toContain(locale === "en" ? "FJI lacks the market-metric evidence" : "FJI 缺少本次请求所需的市场指标证据");
      expect(baseline).not.toContain(failureDetail(locale));
      const before = structuredClone([success, noData, error]);
      const mixed = buildEvidenceGapResponse([success, noData, error, error], true, false, locale);
      expect(mixed).toContain(locale === "en" ? "Successful structured cards remain independently reviewable." : "已成功的结构化卡片仍可单独查看。");
      expect(mixed).toContain(locale === "en" ? "FJI lacks the market-metric evidence" : "FJI 缺少本次请求所需的市场指标证据");
      expect(mixed.split(failureDetail(locale))).toHaveLength(2);
      expect(mixed).not.toContain(locale === "en" ? "CHN lacks" : "CHN 缺少");
      expect([success, noData, error]).toEqual(before);
      expect(buildEvidenceGapResponse([], true, false, locale)).toContain(failureDetail(locale));
    });
  }
});
