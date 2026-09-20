import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { salesChatLiveCases } from "../evals/sales-chat-live-cases";
import { matchesExpectedLiveEvalReportArgs, sanitizeLiveEvalReportArgs } from "../scripts/ai/live-eval-report-args";
import { searchKnowledgeBaseResultSchema } from "@/features/ai/schemas";
import { buildSalesChatEvidenceContract, evidenceContractAllowsModelText } from "@/server/ai/evidence-contract";
import { createSalesChatTools } from "@/server/ai/sales-chat";
import { getDemoDatabase } from "@/server/db/demo-client";

const runtimeContext = { capturedAt: "2026-09-06T12:00:00.000Z", utcDate: "2026-09-06" } as const;
const originalDatabaseMode = process.env.DATABASE_MODE;
let demoDatabase: Awaited<ReturnType<typeof getDemoDatabase>> | undefined;

beforeAll(async () => {
  process.env.DATABASE_MODE = "pglite-demo";
  demoDatabase = await getDemoDatabase();
}, 15_000);
afterAll(async () => {
  if (originalDatabaseMode === undefined) delete process.env.DATABASE_MODE;
  else process.env.DATABASE_MODE = originalDatabaseMode;
  await demoDatabase?.$client.close();
});

describe("source argument expectations agree with explicit user scope", () => {
  it.each(["source-document-retrieval", "retrieved-prompt-injection-is-data"])(
    "requires the explicitly requested non-road scope for %s", (id) => {
      const testCase = salesChatLiveCases.find((candidate) => candidate.id === id);
      expect(testCase?.expectedArgs.searchKnowledgeBase).toEqual({ applicationScope: "non-road", countryIso3: "CHN" });
    },
  );

  it("does not invent a scope for the unrelated-source sentinel", () => {
    const testCase = salesChatLiveCases.find(({ id }) => id === "irrelevant-source-query-fails-closed");
    expect(testCase?.expectedArgs.searchKnowledgeBase).toEqual({ countryIso3: "CHN" });
  });

  it.each([
    { applicationScope: undefined, argsPassed: false, evidenceAllowed: false, status: "ok" },
    { applicationScope: "non-road" as const, argsPassed: true, evidenceAllowed: true, status: "ok" },
    { applicationScope: "on-road" as const, argsPassed: false, evidenceAllowed: false, status: "no_data" },
  ])("aligns actual source execution and scoring for scope $applicationScope", async (variant) => {
    const testCase = salesChatLiveCases.find(({ id }) => id === "source-document-retrieval");
    if (!testCase?.expectedArgs.searchKnowledgeBase) throw new Error("Missing canonical source case");
    expect(testCase.expectedEvidenceAllowed).toBe(true);
    const contract = buildSalesChatEvidenceContract({
      runtimeContext, selectedCountryIso3: testCase.selectedCountryIso3, userTexts: testCase.userTexts,
    });
    const tools = createSalesChatTools({
      auditRepository: { recordToolCall: async () => undefined },
      runtimeContext, selectedCountryIso3: null, sessionId: crypto.randomUUID(),
    });
    if (!tools.searchKnowledgeBase.execute) throw new Error("Missing production knowledge tool");
    const input = {
      ...(variant.applicationScope ? { applicationScope: variant.applicationScope } : {}),
      countryIso3: "CHN",
      query: "CHN non-road emissions regulations original text sections source evidence",
    };
    const result = searchKnowledgeBaseResultSchema.parse(await tools.searchKnowledgeBase.execute(input, {
      context: undefined as never, messages: [], toolCallId: crypto.randomUUID(),
    }));
    expect(result.status).toBe(variant.status);
    expect(result.search.filters.applicationScope).toBe(variant.applicationScope ?? null);
    expect(evidenceContractAllowsModelText(contract, [result])).toBe(variant.evidenceAllowed);
    expect(matchesExpectedLiveEvalReportArgs({
      actual: sanitizeLiveEvalReportArgs({ args: input, knowledgeQueryContract: testCase.knowledgeQueryContract, tool: "searchKnowledgeBase" }),
      expected: testCase.expectedArgs.searchKnowledgeBase,
      knowledgeQueryContract: testCase.knowledgeQueryContract,
      runtimeContext,
      tool: "searchKnowledgeBase",
    })).toBe(variant.argsPassed);
  });
});
