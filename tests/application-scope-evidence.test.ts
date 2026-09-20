import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compareRegulationsResultSchema, type AiToolResult } from "@/features/ai/schemas";
import { buildSalesChatEvidenceContract, evidenceContractAllowsModelText } from "@/server/ai/evidence-contract";
import { createSalesChatTools, streamSalesChat } from "@/server/ai/sales-chat";
import { resolveSalesChatLoopPolicy } from "@/server/ai/sales-chat-loop";
import { getDemoDatabase } from "@/server/db/demo-client";

const originalMode = process.env.DATABASE_MODE;
const runtimeContext = { capturedAt: "2026-08-20T12:00:00.000Z", utcDate: "2026-08-20" } as const;
const auditRepository = { recordToolCall: async () => undefined };
const query = { applicationScope: "non-road" as const, countryIso3s: ["CHN"], powerKw: 100, asOf: runtimeContext.utcDate };
const validRequests = [
  "Check CHN non-road regulations at 100 kW as of 2026-08-20, not marine.",
  "Check CHN marine regulations at 100 kW as of 2026-08-20. Actually use non-road.",
  "Check CHN nonroad regulations at 100 kW as of 2026-08-20. See https://example.test/marine/reference.",
  "查询 CHN 非道路 100 kW 法规，日期 2026-08-20，不是船用。",
];
let database: Awaited<ReturnType<typeof getDemoDatabase>> | undefined;
let evidence: AiToolResult;

function productionTools() {
  return createSalesChatTools({ auditRepository, runtimeContext, selectedCountryIso3: null, sessionId: crypto.randomUUID() });
}

beforeAll(async () => {
  process.env.DATABASE_MODE = "pglite-demo";
  database = await getDemoDatabase();
  const execute = productionTools().compareRegulations.execute;
  if (!execute) throw new Error("Missing production comparison tool");
  evidence = compareRegulationsResultSchema.parse(await execute(query, {
    context: undefined as never, messages: [], toolCallId: crypto.randomUUID(),
  }));
}, 15_000);

afterAll(async () => {
  if (originalMode === undefined) delete process.env.DATABASE_MODE;
  else process.env.DATABASE_MODE = originalMode;
  await database?.$client.close();
});

describe("application-scope intent at the production evidence boundary", () => {
  it.each(validRequests)("allows the actual sufficient non-road result for %s", (text) => {
    expect(evidence.status).toBe("ok");
    expect(evidence.evidenceSufficient).toBe(true);
    expect(evidence.citations.length).toBeGreaterThan(0);
    const contract = buildSalesChatEvidenceContract({ runtimeContext, selectedCountryIso3: null, userTexts: [text] });
    expect(evidenceContractAllowsModelText(contract, [evidence])).toBe(true);
  });

  it.each([
    "Check CHN marine and non-road regulations at 100 kW.",
    "Retrieve CHN marine and non-road source evidence.",
    "Compare CHN and BRA non-road or construction market metrics.",
  ])("does not let sufficient evidence choose an unresolved scope for %s", (text) => {
    const contract = buildSalesChatEvidenceContract({ runtimeContext, selectedCountryIso3: null, userTexts: [text] });
    expect(evidenceContractAllowsModelText(contract, [evidence])).toBe(false);
    expect(resolveSalesChatLoopPolicy({ allowToolFreeAttachmentResponse: false, contract, hasExecutionFailure: false, results: [] })).toEqual({ activeTools: [], phase: "evidence_gap", toolChoice: "none" });
  });

  it.each(validRequests.slice(0, 2))("releases verified text through the real multi-step stream for %s", async (text) => {
    const marker = "Verified non-road scope response.";
    const usage = { inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 1, total: 1 }, outputTokens: { reasoning: 0, text: 1, total: 1 } };
    const model = new MockLanguageModelV4({
      provider: "mock", modelId: "scope-intent-mock",
      doStream: [
        { stream: simulateReadableStream({ chunks: [
          { type: "stream-start", warnings: [] },
          { type: "tool-call", toolName: "compareRegulations", toolCallId: "scope-regulations", input: JSON.stringify(query) },
          { type: "finish", finishReason: { raw: undefined, unified: "tool-calls" }, usage },
        ] }) },
        { stream: simulateReadableStream({ chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "scope-answer" },
          { type: "text-delta", id: "scope-answer", delta: marker },
          { type: "text-end", id: "scope-answer" },
          { type: "finish", finishReason: { raw: undefined, unified: "stop" }, usage },
        ] }) },
      ],
    });
    const result = streamSalesChat({
      auditRepository, locale: "en", messages: [{ role: "user", content: text }], model,
      runtimeContext, selectedCountryIso3: null, sessionId: crypto.randomUUID(), tools: productionTools(), trustedUserTexts: [text],
    });
    const released = await result.text;
    expect(released).toContain(marker);
    expect(released).not.toContain("lacks enough evidence");
    expect((await result.toolResults)[0]?.output).toMatchObject({ status: "ok", evidenceSufficient: true });
    expect(model.doStreamCalls).toHaveLength(2);
  });
});
