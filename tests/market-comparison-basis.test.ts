import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { buildEvidenceGapResponse } from "@/domain/ai/evidence-gap-response";
import { marketComparisonMatchesDeterministicRules } from "@/domain/marketing/comparison-consistency";

import { clientAiToolResultSchema } from "@/features/ai/client-schemas";
import {
  marketComparisonModelToolOutputSchema,
  marketComparisonResultToModelOutput,
} from "@/features/ai/model-tool-output-comparisons";
import {
  opportunityScoreModelToolOutputSchema,
  opportunityScoreResultToModelOutput,
  salesBriefModelToolOutputSchema,
  salesBriefResultToModelOutput,
} from "@/features/ai/model-tool-output";
import { aiToolResultSchema } from "@/features/ai/schemas";
import {
  buildSalesChatEvidenceContract,
  evidenceContractAllowsModelText,
} from "@/server/ai/evidence-contract";
import { buildMarketComparisonResult, buildOpportunityScoreResult, buildSalesBriefResult } from "@/server/ai/tool-results";
import { createSalesChatTools, streamSalesChat } from "@/server/ai/sales-chat";
import { getDemoDatabase } from "@/server/db/demo-client";
import * as marketRepository from "@/server/repositories/market-repository";
import { calculateOpportunityScore, compareMarkets, generateSalesBrief } from "@/server/services/marketing-analysis-service";

type Rows = Awaited<ReturnType<ReturnType<typeof marketRepository.createMarketRepository>["findForComparison"]>>;
const query = { countryIso3s: ["CHN", "BRA"], metricCodes: ["DEMO_ADDRESSABLE_UNITS"] };
const scoreQuery = { ...query, applicationScope: "non-road", asOf: "2026-08-20", powerKw: 100, productModelCode: "DEMO-ENG-100" };
const fields = [
  { field: "unitCode", issue: "MISSING_UNIT" },
  { field: "definition", issue: "MISSING_DEFINITION" },
  { field: "methodologyVersion", issue: "MISSING_METHODOLOGY" },
] as const;
const cases = fields.flatMap((field) => ["", " \t\n"].flatMap((blank) => [1, 2].map((count) => ({ ...field, blank, count }))));
const originalDatabaseMode = process.env.DATABASE_MODE;
let database: Awaited<ReturnType<typeof getDemoDatabase>>;
let rows: Rows;
let baselineScore: Awaited<ReturnType<typeof calculateOpportunityScore>>;
let baselineBrief: Awaited<ReturnType<typeof generateSalesBrief>>;

beforeAll(async () => {
  process.env.DATABASE_MODE = "pglite-demo";
  database = await getDemoDatabase();
  rows = await marketRepository.createMarketRepository(database).findForComparison(query);
  baselineScore = await calculateOpportunityScore(scoreQuery);
  baselineBrief = await generateSalesBrief({ ...scoreQuery, targetCountryIso3: "CHN" });
}, 15_000);
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  if (originalDatabaseMode === undefined) delete process.env.DATABASE_MODE;
  else process.env.DATABASE_MODE = originalDatabaseMode;
  await database?.$client.close();
});

// Vary only the in-memory response of the actual Demo repository. No database
// rows, accepted fixtures, real sources, or provider responses are created.
function withRows(observations: Rows) {
  vi.spyOn(marketRepository, "createMarketRepository").mockReturnValue({ findForComparison: async () => observations });
}

async function marketResult() {
  return buildMarketComparisonResult({ comparison: await compareMarkets(query), informationAsOf: scoreQuery.asOf });
}

const contract = buildSalesChatEvidenceContract({ selectedCountryIso3: null, userTexts: ["Compare the CHN and BRA DEMO_ADDRESSABLE_UNITS market metric."] });

function scriptedMarketModel(marker: string) {
  const usage = {
    inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 1, total: 1 },
    outputTokens: { reasoning: 0, text: 1, total: 1 },
  };
  return new MockLanguageModelV3({ doStream: [
    { stream: simulateReadableStream({ chunks: [
      { type: "stream-start", warnings: [] },
      { type: "tool-call", toolName: "compareMarkets", toolCallId: "basis-query", input: JSON.stringify(query) },
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

describe("required market comparison basis", () => {
  it.each(cases)("retains facts but denies comparison with $count missing $field values: [$blank]", async ({ field, issue, blank, count }) => {
    const observed = rows.map((row, index) => index < count ? { ...row, [field]: blank } : row);
    withRows(observed);
    const result = await marketResult();
    expect(result).toMatchObject({ status: "no_data", evidenceSufficient: false });
    expect(result.comparison.metrics[0]).toMatchObject({ comparisonStatus: "insufficient_data", issues: [issue] });
    expect(result.comparison.metrics[0]!.observations.map(({ countryIso3 }) => countryIso3)).toEqual(query.countryIso3s);
    for (const observation of result.comparison.metrics[0]!.observations) {
      expect(observation[field]).toBe(observed.find(({ id }) => id === observation.id)![field]);
    }
    expect(result.comparison.metrics[0]!.observations).toHaveLength(2);
    expect(result.citations).toHaveLength(2);
    expect(clientAiToolResultSchema.safeParse(result).success).toBe(true);
    expect(evidenceContractAllowsModelText(contract, [result])).toBe(false);
    const projected = marketComparisonResultToModelOutput(result);
    expect(projected).toMatchObject({ status: "no_data", evidenceSufficient: false });
    expect(projected.comparison.metrics[0]!.issues).toEqual([issue]);
    expect(projected.comparison.metrics[0]!.observations).toHaveLength(2);
  });

  it.each(fields)("does not turn an absent $field into a market-potential score", async ({ field, issue }) => {
    withRows(rows.map((row) => ({ ...row, [field]: " \t\n" })));
    const scorecard = await calculateOpportunityScore(scoreQuery);
    expect(scorecard.provenance.marketComparison.metrics[0]!.issues).toEqual([issue]);
    for (const score of scorecard.scores) {
      expect(score.components.find(({ key }) => key === "marketPotential")).toMatchObject({ score: null, contribution: null, effectiveWeight: 0, status: "missing" });
      expect(score.gaps).toContainEqual({ code: "MARKET_DATA_UNAVAILABLE" });
      const baseline = baselineScore.scores.find(({ countryIso3 }) => countryIso3 === score.countryIso3)!;
      for (const key of ["productReadiness", "regulatoryCoverage"] as const) {
        expect(score.components.find((component) => component.key === key)!.score).toBe(baseline.components.find((component) => component.key === key)!.score);
      }
      if (baseline.components.some(({ key, score }) => key !== "marketPotential" && score !== null)) expect(score.overallScore).not.toBeNull();
    }
    const result = buildOpportunityScoreResult({ scorecard, informationAsOf: scoreQuery.asOf });
    expect(clientAiToolResultSchema.safeParse(result).success).toBe(true);
    const projected = opportunityScoreResultToModelOutput(result);
    expect(projected.scorecard.scores).toEqual(scorecard.scores);
    expect(projected.evidenceDigest.marketMetrics.items[0]!.issues).toEqual([issue]);
  });

  it.each(fields)("rejects coordinated affirmative full and model payloads with blank $field", async ({ field }) => {
    const result = await marketResult();
    expect(result.evidenceSufficient).toBe(true);
    const projected = marketComparisonResultToModelOutput(result);
    for (const observation of result.comparison.metrics[0]!.observations) observation[field] = " ";
    for (const observation of projected.comparison.metrics[0]!.observations) observation[field] = " ";
    expect(aiToolResultSchema.safeParse(result).success).toBe(false);
    expect(clientAiToolResultSchema.safeParse(result).success).toBe(false);
    expect(evidenceContractAllowsModelText(contract, [result])).toBe(false);
    expect(marketComparisonModelToolOutputSchema.safeParse(projected).success).toBe(false);
  });

  it("keeps genuinely comparable count observations with null currency and global scope", async () => {
    withRows(rows.map((row) => ({ ...row, applicationScope: null, currencyCode: null })));
    const result = await marketResult();
    expect(result.comparison.metrics[0]!.issues).toEqual([]);
    expect(result).toMatchObject({ status: "ok", evidenceSufficient: true });
    expect(clientAiToolResultSchema.safeParse(result).success).toBe(true);
    expect(evidenceContractAllowsModelText(contract, [result])).toBe(true);
    expect(marketComparisonResultToModelOutput(result).evidenceSufficient).toBe(true);
  });

  it("keeps independent mismatches when required basis is also missing", async () => {
    withRows(rows.map((row, index) => index === 0 ? { ...row, unitCode: " ", methodologyVersion: "demo-v2" } : row));
    const result = await marketResult();
    expect(result.comparison.metrics[0]).toMatchObject({ comparisonStatus: "insufficient_data", issues: ["MISSING_UNIT", "METHODOLOGY_MISMATCH"] });
    expect(clientAiToolResultSchema.safeParse(result).success).toBe(true);
    const reordered = structuredClone(result.comparison);
    reordered.metrics[0]!.issues.reverse();
    expect(marketComparisonMatchesDeterministicRules(reordered)).toBe(false);
  });

  it("cannot declare complete observations insufficient without a missing basis", async () => {
    const result = await marketResult();
    result.comparison.metrics[0]!.issues = ["MISSING_DEFINITION"];
    result.comparison.metrics[0]!.comparisonStatus = "insufficient_data";
    result.comparison.missingData = ["DEMO_ADDRESSABLE_UNITS 不可比较：MISSING_DEFINITION。"];
    expect(marketComparisonMatchesDeterministicRules(result.comparison)).toBe(false);
  });

  it("retains all three gaps and independent product recommendations in the brief", async () => {
    withRows(rows.map((row) => ({ ...row, definition: "", methodologyVersion: " ", unitCode: "\t" })));
    const brief = await generateSalesBrief({ ...scoreQuery, targetCountryIso3: "CHN" });
    expect(brief.provenance.marketComparison.metrics[0]!.issues).toEqual(fields.map(({ issue }) => issue));
    expect(brief.marketScore.components.find(({ key }) => key === "marketPotential")!.score).toBeNull();
    expect(brief.opportunities.some(({ ruleCode }) => ruleCode === "MARKET_POTENTIAL_AT_LEAST_50")).toBe(false);
    expect(brief.recommendedProducts).toEqual(baselineBrief.recommendedProducts);
    const result = buildSalesBriefResult({ brief, informationAsOf: scoreQuery.asOf });
    expect(clientAiToolResultSchema.safeParse(result).success).toBe(true);
    expect(salesBriefResultToModelOutput(result).evidenceDigest.marketMetrics.items[0]!.issues).toEqual(fields.map(({ issue }) => issue));
  });

  for (const kind of ["score", "brief"] as const) {
    function projection() {
      return kind === "score"
        ? opportunityScoreResultToModelOutput(buildOpportunityScoreResult({ scorecard: baselineScore, informationAsOf: scoreQuery.asOf }))
        : salesBriefResultToModelOutput(buildSalesBriefResult({ brief: baselineBrief, informationAsOf: scoreQuery.asOf }));
    }
    const schema = kind === "score" ? opportunityScoreModelToolOutputSchema : salesBriefModelToolOutputSchema;

    it(`preserves the definition needed to independently validate the ${kind} digest`, () => {
      const output = projection();
      for (const observation of output.evidenceDigest.marketMetrics.items[0]!.observations) {
        expect(observation).toHaveProperty("definition", rows.find(({ id }) => id === observation.id)!.definition);
      }
    });

    it.each(fields)(`rejects an affirmative ${kind} digest after all $field values are erased`, ({ field }) => {
      const output = projection();
      expect(schema.safeParse(output).success).toBe(true);
      for (const observation of output.evidenceDigest.marketMetrics.items[0]!.observations) Object.assign(observation, { [field]: " " });
      expect(schema.safeParse(output).success).toBe(false);
    });
  }

  for (const locale of ["en", "zh-CN"] as const) {
    it.each(fields)(`retains the missing $field card but blocks model prose in public ${locale} SSE`, async ({ field, issue }) => {
      withRows(rows.map((row) => ({ ...row, [field]: " " })));
      const request = locale === "en"
        ? "Compare the CHN and BRA DEMO_ADDRESSABLE_UNITS market metric."
        : "比较 CHN 和 BRA 的 DEMO_ADDRESSABLE_UNITS 市场指标。";
      const marker = "UNSUPPORTED_MARKET_BASIS_MODEL_CLAIM";
      const auditRepository = { recordToolCall: async () => undefined };
      const sessionId = crypto.randomUUID();
      const stream = streamSalesChat({
        auditRepository, locale, selectedCountryIso3: null, sessionId,
        messages: [{ role: "user", content: request }], trustedUserTexts: [request],
        model: scriptedMarketModel(marker),
        tools: createSalesChatTools({ auditRepository, defaultAsOf: scoreQuery.asOf, sessionId, selectedCountryIso3: null }),
      });
      const body = await stream.toUIMessageStreamResponse({ sendReasoning: false }).text();
      const parts: unknown[] = body.split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)) as unknown);
      const outputPart = z.object({ type: z.literal("tool-output-available"), output: aiToolResultSchema });
      const textPart = z.object({ type: z.literal("text-delta"), delta: z.string() });
      const outputs = parts.flatMap((part) => {
        const parsed = outputPart.safeParse(part);
        return parsed.success ? [parsed.data.output] : [];
      });
      const text = parts.flatMap((part) => {
        const parsed = textPart.safeParse(part);
        return parsed.success ? [parsed.data.delta] : [];
      }).join("");
      expect(outputs).toHaveLength(1);
      expect(outputs[0]).toMatchObject({ tool: "compareMarkets", status: "no_data", evidenceSufficient: false, comparison: { metrics: [{ comparisonStatus: "insufficient_data", issues: [issue] }] } });
      expect(clientAiToolResultSchema.safeParse(outputs[0]).success).toBe(true);
      expect(body).not.toContain(marker);
      expect(text).toBe(buildEvidenceGapResponse(outputs, false, false, locale));
    });
  }
});
