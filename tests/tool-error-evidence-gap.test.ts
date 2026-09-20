import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { buildEvidenceGapResponse, regulatoryDisclaimer } from "@/domain/ai/evidence-gap-response";
import { aiToolResultSchema, type AiToolName } from "@/features/ai/schemas";
import type { Locale } from "@/i18n/locale";
import { createSalesChatTools, streamSalesChat } from "@/server/ai/sales-chat";
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
  ? "At least one query or parameter validation failed. Check the input and retry."
  : "至少一项查询执行或参数校验失败，请检查输入后重试。";
const absentDataAssertions = /no matching source text|lacks the .* evidence|lacks sufficient evidence for a conclusive product-fit|no sufficient visible|No directly comparable market metric|Opportunity ranking needs|The sales brief lacks|知识库没有检索到|缺少本次请求所需|没有确定的适配结论|没有足够的可见|市场比较没有找到|机会排名至少需要|销售简报缺少/u;
const outputPartSchema = z.object({ type: z.literal("tool-output-available"), output: aiToolResultSchema });
const textPartSchema = z.object({ type: z.literal("text-delta"), delta: z.string() });
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

function mockModel(tool: AiToolName, input: Record<string, unknown>, marker: string) {
  const usage = {
    inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 1, total: 1 },
    outputTokens: { reasoning: 0, text: 1, total: 1 },
  };
  return new MockLanguageModelV3({ doStream: [
    { stream: simulateReadableStream({ chunks: [
      { type: "stream-start", warnings: [] },
      { type: "tool-call", toolName: tool, toolCallId: "gap-query", input: JSON.stringify(input) },
      { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage },
    ] }) },
    { stream: simulateReadableStream({ chunks: [
      { type: "stream-start", warnings: [] },
      { type: "text-start", id: "answer" },
      { type: "text-delta", id: "answer", delta: marker },
      { type: "text-end", id: "answer" },
      { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
    ] }) },
  ] });
}

function readPublicSse(body: string) {
  const parts: unknown[] = body.split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice(6)) as unknown);
  return {
    outputs: parts.flatMap((part) => {
      const parsed = outputPartSchema.safeParse(part);
      return parsed.success ? [parsed.data.output] : [];
    }),
    finalText: parts.flatMap((part) => {
      const parsed = textPartSchema.safeParse(part);
      return parsed.success ? [parsed.data.delta] : [];
    }).join(""),
  };
}

describe("execution errors are not evidence of absent data", () => {
  it.each(cases.filter(({ tool }) => tool === "compareRegulations" || tool === "compareMarkets"))(
    "releases an English $tool explanation only after actual two-country evidence",
    async ({ tool, input, request }) => {
      const auditRepository = { recordToolCall: async () => undefined };
      const sessionId = crypto.randomUUID();
      const marker = "ACTUAL_DEMO_EVIDENCE_ANSWER";
      const stream = streamSalesChat({ auditRepository, locale: "en", selectedCountryIso3: null, sessionId,
        messages: [{ role: "user", content: request.en }], trustedUserTexts: [request.en],
        model: mockModel(tool, input, marker),
        tools: createSalesChatTools({ auditRepository, defaultAsOf: asOf, sessionId, selectedCountryIso3: null }),
      });
      const body = await stream.toUIMessageStreamResponse({ sendReasoning: false }).text();
      const { outputs, finalText } = readPublicSse(body);
      expect(outputs).toHaveLength(1);
      expect(outputs[0]).toMatchObject({ tool, status: "ok", evidenceSufficient: true,
        comparison: { query: { countryIso3s: ["CHN", "BRA"] } } });
      expect(finalText).toContain(marker);
      expect(finalText).not.toContain(failureDetail("en"));
    },
  );

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

    it.each(cases)(`keeps a real $tool service error fail-closed in public ${locale} SSE`, async ({ tool, input, request }) => {
      const privateMarker = "PRIVATE_SIMULATED_QUERY_FAILURE";
      const modelMarker = "UNVERIFIED_MODEL_ANSWER";
      const fail = vi.fn(async () => { throw new Error(privateMarker); });
      const audits: string[] = [];
      const auditRepository = { recordToolCall: async ({ status }: { status: string }) => { audits.push(status); } };
      const sessionId = crypto.randomUUID();
      const model = mockModel(tool, input, modelMarker);
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        const tools = createSalesChatTools({ auditRepository, defaultAsOf: asOf, sessionId, selectedCountryIso3: null,
          services: {
            calculateOpportunityScore: fail, compareMarkets: fail, compareRegulations: fail,
            findCompatibleProducts: fail, generateSalesBrief: fail, getCountryDetails: fail, hybridSearchKnowledge: fail,
          },
        });
        const text = request[locale];
        const stream = streamSalesChat({ auditRepository, locale, model, sessionId, selectedCountryIso3: null,
          messages: [{ role: "user", content: text }], trustedUserTexts: [text], tools });
        const body = await stream.toUIMessageStreamResponse({ sendReasoning: false }).text();
        const { outputs, finalText } = readPublicSse(body);
        expect(fail).toHaveBeenCalledTimes(1);
        expect(audits).toEqual(["error"]);
        expect(outputs).toHaveLength(1);
        expect(outputs[0]).toMatchObject({ tool, status: "error", evidenceSufficient: false, citations: [] });
        expect(body).not.toContain(privateMarker);
        expect(body).not.toContain(modelMarker);
        expect(model.doStreamCalls).toHaveLength(2);
        expect(finalText).toContain(failureDetail(locale));
        expect(finalText).not.toMatch(absentDataAssertions);
        expect(finalText).toContain(regulatoryDisclaimer(locale));
      } finally {
        consoleError.mockRestore();
      }
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
