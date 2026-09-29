import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { buildEvidenceGapResponse, regulatoryDisclaimer } from "@/domain/ai/evidence-gap-response";
import { findCompatibleProductsResultSchema } from "@/features/ai/schemas";
import type { Locale } from "@/i18n/locale";
import { buildSalesChatEvidenceContract, evidenceContractAllowsModelText } from "@/server/ai/evidence-contract";
import { createSalesChatTools, streamSalesChat } from "@/server/ai/sales-chat";
import { getDemoDatabase } from "@/server/db/demo-client";

const originalDatabaseMode = process.env.DATABASE_MODE;
let database: Awaited<ReturnType<typeof getDemoDatabase>>;
const auditRepository = { recordToolCall: async () => undefined };
const outputPartSchema = z.object({ type: z.literal("tool-output-available"), output: findCompatibleProductsResultSchema });
const query = { applicationScope: "non-road" as const, asOf: "2026-08-12", countryIso3: "CHN", powerKw: 100 };
const cases = [
  { model: "DEMO-ENG-100", status: "fit", readiness: "ready", allowed: true },
  { model: "DEMO-ENG-200", status: "unknown", readiness: "unknown", allowed: false },
  { model: "DOES-NOT-EXIST", status: "unknown", readiness: "unknown", allowed: false },
] as const;
const explanation = (locale: Locale) => locale === "en"
  ? "CHN lacks sufficient evidence for a conclusive product-fit decision for Non-road, 100 kW, as of Aug 12, 2026. Check product, certification, and regulatory evidence."
  : "CHN 在非道路、100 kW、2026年8月12日条件下没有确定的适配结论；请核对产品目录、认证或法规证据。";
const request = (model: string, locale: Locale) => locale === "en"
  ? `Evaluate product fit for ${model} in CHN non-road 100 kW as of 2026-08-12.`
  : `评估 ${model} 在 CHN 非道路 100 kW、截至 2026-08-12 的产品合规适配。`;

beforeAll(async () => {
  process.env.DATABASE_MODE = "pglite-demo";
  database = await getDemoDatabase();
}, 15_000);
afterAll(async () => {
  if (originalDatabaseMode === undefined) delete process.env.DATABASE_MODE;
  else process.env.DATABASE_MODE = originalDatabaseMode;
  await database?.$client.close();
});

const usage = {
  inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 1, total: 1 },
  outputTokens: { reasoning: 0, text: 1, total: 1 },
};
function modelFor(model: string, marker: string) {
  return new MockLanguageModelV3({ doStream: [
    { stream: simulateReadableStream({ chunks: [
      { type: "stream-start", warnings: [] },
      { type: "tool-call", toolName: "findCompatibleProducts", toolCallId: "product-gap-call", input: JSON.stringify({ ...query, productModelCode: model }) },
      { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage },
    ] }) },
    { stream: simulateReadableStream({ chunks: [
      { type: "stream-start", warnings: [] },
      { type: "text-start", id: "product-answer" },
      { type: "text-delta", id: "product-answer", delta: marker },
      { type: "text-end", id: "product-answer" },
      { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
    ] }) },
  ] });
}

describe("product-fit evidence gaps distinguish a result from a conclusive decision", () => {
  for (const locale of ["en", "zh-CN"] as const) {
    it.each(cases)(`preserves actual $model evidence and localized copy in ${locale}`, async ({ model, status, readiness, allowed }) => {
      const tools = createSalesChatTools({ auditRepository, selectedCountryIso3: null, sessionId: crypto.randomUUID() });
      if (!tools.findCompatibleProducts.execute) throw new Error("Missing product tool");
      const result = findCompatibleProductsResultSchema.parse(await tools.findCompatibleProducts.execute(
        { ...query, productModelCode: model }, { context: undefined as never, messages: [], toolCallId: crypto.randomUUID() },
      ));
      expect(result.status).toBe(allowed ? "ok" : "no_data");
      expect(result.evidenceSufficient).toBe(allowed);
      expect(result.evaluations).toHaveLength(1);
      expect(result.evaluations[0]).toMatchObject({ status, commercialReadiness: readiness });
      expect(result.evaluations[0]?.product?.modelCode ?? null).toBe(model === "DOES-NOT-EXIST" ? null : model);
      expect(result.query).toMatchObject({ ...query, productModelCode: model });
      const contract = buildSalesChatEvidenceContract({ selectedCountryIso3: null, userTexts: [request(model, locale)] });
      expect(evidenceContractAllowsModelText(contract, [result])).toBe(allowed);
      if (allowed) return;
      const before = structuredClone(result);
      const response = buildEvidenceGapResponse([result], false, false, locale);
      expect(response).toContain(explanation(locale));
      expect(response).not.toContain("has no deterministic fit result");
      expect(response).toContain(regulatoryDisclaimer(locale));
      expect(result).toEqual(before);
    });

    it.each(cases)(`keeps the $model SSE boundary and fixed explanation in ${locale}`, async ({ model, status, readiness, allowed }) => {
      const marker = "MODEL_PRODUCT_ANSWER";
      const sessionId = crypto.randomUUID();
      const text = request(model, locale);
      const result = streamSalesChat({ auditRepository, locale, sessionId, selectedCountryIso3: null,
        messages: [{ role: "user", content: text }], trustedUserTexts: [text],
        tools: createSalesChatTools({ auditRepository, selectedCountryIso3: null, sessionId }), model: modelFor(model, marker) });
      const body = await result.toUIMessageStreamResponse({ sendReasoning: false }).text();
      const outputs = body.split("\n").filter((line) => line.startsWith("data: {")).flatMap((line) => {
        const part = outputPartSchema.safeParse(JSON.parse(line.slice("data: ".length)) as unknown);
        return part.success ? [part.data.output] : [];
      });
      expect(outputs).toHaveLength(1);
      expect(outputs[0]).toMatchObject({ status: allowed ? "ok" : "no_data", evidenceSufficient: allowed,
        query: { ...query, productModelCode: model } });
      expect(outputs[0]?.evaluations).toHaveLength(1);
      expect(outputs[0]?.evaluations[0]).toMatchObject({ status, commercialReadiness: readiness });
      expect(body.includes(marker)).toBe(allowed);
      expect(body).not.toContain("has no deterministic fit result");
      if (!allowed) {
        expect(body).toContain(explanation(locale));
        expect(body).toContain(regulatoryDisclaimer(locale));
      }
    });
  }
});
