import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { salesChatLiveCases } from "../evals/sales-chat-live-cases";
import {
  matchesExpectedLiveEvalReportArgs,
  sanitizeLiveEvalReportArgs,
} from "../scripts/ai/live-eval-report-args";
import { evaluateLiveEvalKnowledgeQuery } from "@/domain/ai/live-eval-query-contract";
import { searchKnowledgeBaseResultSchema } from "@/features/ai/schemas";
import { unwrapUntrustedKnowledgeExcerpt } from "@/domain/knowledge/retrieval-policy";
import {
  buildSalesChatEvidenceContract,
  evidenceContractAllowsModelText,
} from "@/server/ai/evidence-contract";
import { createSalesChatTools } from "@/server/ai/sales-chat";
import { getDemoDatabase } from "@/server/db/demo-client";
import { buildKnowledgeResult } from "@/server/ai/tool-results";

const runtimeContext = {
  capturedAt: "2026-09-06T18:25:00.000Z",
  utcDate: "2026-09-06",
} as const;
const originalDatabaseMode = process.env.DATABASE_MODE;
let database: Awaited<ReturnType<typeof getDemoDatabase>> | undefined;

beforeAll(async () => {
  process.env.DATABASE_MODE = "pglite-demo";
  database = await getDemoDatabase();
}, 15_000);

afterAll(async () => {
  if (originalDatabaseMode === undefined) delete process.env.DATABASE_MODE;
  else process.env.DATABASE_MODE = originalDatabaseMode;
  await database?.$client.close();
});

const variants = [
  { id: "complete English", query: "CHN non-road emissions regulations original text sections source evidence", missing: [] },
  { id: "complete singular English", query: "CHN non-road emission regulation original text section source evidence", missing: [] },
  { id: "complete Chinese", query: "CHN 非道路排放法规原文章节来源证据", missing: [] },
  { id: "complete spaced non-road", query: "CHN non road emissions regulations original text sections source evidence", missing: [] },
  { id: "complete unhyphenated nonroad", query: "CHN nonroad emissions regulations original text sections source evidence", missing: [] },
  { id: "only original text", query: "CHN non-road emission regulation original text", missing: [] },
  { id: "only sections", query: "CHN non-road emissions regulations sections", missing: [] },
  { id: "only source evidence", query: "CHN non-road emissions regulations source evidence", missing: [] },
  { id: "omits source evidence", query: "CHN non-road emissions regulations original text sections", missing: [] },
  { id: "omits sections", query: "CHN non-road emissions regulations original text source evidence", missing: [] },
  { id: "omits original text", query: "CHN non-road emissions regulations sections source evidence", missing: [] },
  { id: "Chinese omits original text", query: "CHN 非道路排放法规章节来源证据", missing: [] },
  { id: "Chinese omits sections", query: "CHN 非道路排放法规原文来源证据", missing: [] },
  { id: "Chinese omits source evidence", query: "CHN 非道路排放法规原文章节", missing: [] },
  { id: "business topic only", query: "CHN non-road emissions regulations", missing: [] },
  { id: "wrong business topic", query: "CHN non-road market original text sections source evidence", missing: ["query:emissions-regulation"] },
  { id: "missing emissions subject", query: "CHN non-road regulations original text sections source evidence", missing: ["query:emissions-regulation"] },
  { id: "wrong application words", query: "CHN marine emissions regulations original text sections source evidence", missing: ["query:application-non-road"] },
] as const;

describe("v17 source query scoring separates business terms from delivered facts", () => {
  it.each(variants)("$id agrees with the actual production evidence boundary", async (variant) => {
    const testCase = salesChatLiveCases.find(({ id }) => id === "source-document-retrieval");
    if (!testCase?.knowledgeQueryContract || !testCase.expectedArgs.searchKnowledgeBase) {
      throw new Error("Missing canonical source query contract");
    }
    expect(testCase.expectedEvidenceAllowed).toBe(true);
    const expectedArgsPassed = variant.missing.length === 0;
    const contract = buildSalesChatEvidenceContract({
      runtimeContext,
      selectedCountryIso3: testCase.selectedCountryIso3,
      userTexts: testCase.userTexts,
    });
    const tools = createSalesChatTools({
      auditRepository: { recordToolCall: async () => undefined },
      runtimeContext,
      selectedCountryIso3: testCase.selectedCountryIso3,
      sessionId: crypto.randomUUID(),
    });
    if (!tools.searchKnowledgeBase.execute) throw new Error("Missing production search tool");
    const input = { applicationScope: "non-road" as const, countryIso3: "CHN", query: variant.query };
    const result = searchKnowledgeBaseResultSchema.parse(await tools.searchKnowledgeBase.execute(input, {
      context: undefined as never,
      messages: [],
      toolCallId: crypto.randomUUID(),
    }));
    // Valid arguments do not guarantee retrieval. Delivery is established by
    // the actual cited excerpt and locator, not by query cue words alone.
    if (variant.id.startsWith("complete")) {
      expect(result.status).toBe("ok");
    }
    if (result.status === "ok") {
      expect(result.search.results[0]?.sectionLocator).toBe("DEMO-SECTION-1");
      expect(unwrapUntrustedKnowledgeExcerpt(result.search.results[0]!.content)).toContain("FICTIONAL DEMO DATA");
      expect(result.citations.length).toBeGreaterThan(0);
    }
    expect(evidenceContractAllowsModelText(contract, [result])).toBe(expectedArgsPassed && result.status === "ok");
    expect(evaluateLiveEvalKnowledgeQuery(input.query, testCase.knowledgeQueryContract)).toMatchObject({
      expectationPassed: expectedArgsPassed,
      missingRequiredTermIds: [...variant.missing].sort(),
    });
    expect(matchesExpectedLiveEvalReportArgs({
      actual: sanitizeLiveEvalReportArgs({ args: input, knowledgeQueryContract: testCase.knowledgeQueryContract, tool: "searchKnowledgeBase" }),
      expected: testCase.expectedArgs.searchKnowledgeBase,
      knowledgeQueryContract: testCase.knowledgeQueryContract,
      runtimeContext,
      tool: "searchKnowledgeBase",
    })).toBe(expectedArgsPassed);
  });

  it("rejects missing delivered sections even when the query repeats every cue word", async () => {
    const testCase = salesChatLiveCases.find(({ id }) => id === "source-document-retrieval")!;
    const tools = createSalesChatTools({ auditRepository: { recordToolCall: async () => undefined },
      runtimeContext, selectedCountryIso3: null, sessionId: crypto.randomUUID() });
    if (!tools.searchKnowledgeBase.execute) throw new Error("Missing source tool");
    const input = { applicationScope: "non-road" as const, countryIso3: "CHN", query: variants[0].query };
    const original = searchKnowledgeBaseResultSchema.parse(await tools.searchKnowledgeBase.execute(input,
      { context: undefined as never, messages: [], toolCallId: "missing-delivered-section" }));
    // A valid derived in-memory DTO retains its excerpt and page citation but
    // no longer has the requested section locator. No database row is changed.
    const result = buildKnowledgeResult({ informationAsOf: original.informationAsOf,
      resolvedCountryIso3: original.resolvedCountryIso3, search: { ...original.search,
        results: original.search.results.map((hit) => ({ ...hit,
          content: unwrapUntrustedKnowledgeExcerpt(hit.content), sectionLocator: null,
        })),
      } });
    expect(result.status).toBe("ok");
    expect(result.citations[0]?.pageFrom).toBe(1);
    expect(evaluateLiveEvalKnowledgeQuery(input.query, testCase.knowledgeQueryContract!).expectationPassed).toBe(true);
    const contract = buildSalesChatEvidenceContract({ runtimeContext, selectedCountryIso3: null, userTexts: testCase.userTexts });
    expect(evidenceContractAllowsModelText(contract, [original])).toBe(true);
    expect(evidenceContractAllowsModelText(contract, [result])).toBe(false);
  });
});
