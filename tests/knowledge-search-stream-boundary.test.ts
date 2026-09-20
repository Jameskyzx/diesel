import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it, vi } from "vitest";

import type { SearchKnowledgeBaseInput } from "@/features/ai/schemas";
import {
  hybridSearchQuerySchema,
  type HybridSearchResponse,
} from "@/features/knowledge/schemas";
import {
  createSalesChatTools,
  streamSalesChat,
} from "@/server/ai/sales-chat";
import { currentUtcDate } from "@/server/ai/tool-results";

const emptyUsage = {
  inputTokens: {
    cacheRead: 0,
    cacheWrite: 0,
    noCache: 1,
    total: 1,
  },
  outputTokens: {
    reasoning: 0,
    text: 1,
    total: 1,
  },
} as const;

function knowledgeResultFor(input: unknown): HybridSearchResponse {
  const query = hybridSearchQuerySchema.parse(input);
  return {
    embeddingModel: "local-hash-embedding-v1",
    filters: {
      applicationScope: query.applicationScope,
      asOf: query.asOf,
      countryIso3: query.countryIso3,
      jurisdictionId: query.jurisdictionId,
      limit: query.limit,
    },
    query: query.query,
    results: [
      {
        applicationScope: "non-road",
        chunkId: "00000000-0000-4000-8000-000000000841",
        content: "Stage IV emission limits.",
        countryIso3: "CHN",
        document: {
          downloadUrl: null,
          id: "00000000-0000-4000-8000-000000000842",
          originalFilename: "stage-iv.txt",
          publishedOn: "2025-01-01",
          source: {
            id: "00000000-0000-4000-8000-000000000843",
            isDemo: true,
            publishedOn: "2025-01-01",
            publisher: "DEMO ONLY",
            title: "DEMO ONLY — Stage IV source",
            url: null,
            verifiedAt: "2026-01-01T00:00:00.000Z",
          },
          title: "DEMO ONLY — Stage IV source text",
        },
        finalScore: 0.8,
        headingPath: ["Limits"],
        jurisdiction: null,
        keywordScore: 0.8,
        pageFrom: 1,
        pageTo: null,
        rank: 1,
        sectionLocator: "§1",
        validFrom: "2025-01-01",
        validTo: "2027-01-01",
        vectorScore: 0.8,
        warnings: [],
      },
    ],
    scoring: { keywordWeight: 0.5, vectorWeight: 0.5 },
    status: "ok",
  };
}

function knowledgeToolThenMarkerModel(marker: string) {
  return new MockLanguageModelV3({
    doStream: [
      {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            {
              input: JSON.stringify({
                applicationScope: "non-road",
                asOf: currentUtcDate(),
                countryIso3: "CHN",
                query: "non-road Stage IV emission limits original text",
              }),
              toolCallId: "knowledge-consistency-call",
              toolName: "searchKnowledgeBase",
              type: "tool-call" as const,
            },
            {
              finishReason: {
                raw: undefined,
                unified: "tool-calls" as const,
              },
              type: "finish" as const,
              usage: emptyUsage,
            },
          ],
        }),
      },
      {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            { id: "knowledge-answer", type: "text-start" as const },
            {
              delta: marker,
              id: "knowledge-answer",
              type: "text-delta" as const,
            },
            { id: "knowledge-answer", type: "text-end" as const },
            {
              finishReason: { raw: undefined, unified: "stop" as const },
              type: "finish" as const,
              usage: emptyUsage,
            },
          ],
        }),
      },
    ],
    modelId: "knowledge-consistency-model",
    provider: "mock",
  });
}

function firstKnowledgeHit(result: HybridSearchResponse) {
  const hit = result.results[0];
  if (!hit) {
    throw new Error("Expected a knowledge-search hit fixture.");
  }
  return hit;
}

describe("knowledge-search stream evidence boundary", () => {
  it("normalizes provider-only jurisdiction and limit before service execution", async () => {
    const hybridSearchKnowledge = vi.fn(async (input: unknown) =>
      knowledgeResultFor(input),
    );
    const tools = createSalesChatTools({
      auditRepository: { recordToolCall: async () => undefined },
      selectedCountryIso3: null,
      services: { hybridSearchKnowledge },
      sessionId: crypto.randomUUID(),
    });
    if (!tools.searchKnowledgeBase.execute) {
      throw new Error("Expected an executable knowledge-search tool.");
    }

    // Trusted callers may hold the wider input type; the defensive executor
    // still cannot honor knobs that the model-facing schema no longer exposes.
    const input: SearchKnowledgeBaseInput = {
      applicationScope: "non-road",
      asOf: currentUtcDate(),
      countryIso3: "CHN",
      jurisdictionId: "00000000-0000-4000-8000-000000000899",
      limit: 1,
      query: "non-road Stage IV emission limits original text",
    };
    await tools.searchKnowledgeBase.execute(
      input,
      {
        context: undefined as never,
        messages: [],
        toolCallId: "normalized-knowledge-query",
      },
    );

    expect(hybridSearchKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({ jurisdictionId: null, limit: 5 }),
      { signal: undefined, deliveryCueRanking: true },
    );
  });

  it("turns a service query-echo mismatch into a no-facts error result", async () => {
    const tools = createSalesChatTools({
      auditRepository: { recordToolCall: async () => undefined },
      selectedCountryIso3: null,
      services: {
        hybridSearchKnowledge: async (input) => {
          const result = knowledgeResultFor(input);
          result.query = `${result.query} banana`;
          return result;
        },
      },
      sessionId: crypto.randomUUID(),
    });
    if (!tools.searchKnowledgeBase.execute) {
      throw new Error("Expected an executable knowledge-search tool.");
    }

    const result = await tools.searchKnowledgeBase.execute(
      {
        applicationScope: "non-road",
        asOf: currentUtcDate(),
        countryIso3: "CHN",
        query: "non-road Stage IV emission limits original text",
      },
      {
        context: undefined as never,
        messages: [],
        toolCallId: "drifted-knowledge-query",
      },
    );

    expect(result).toMatchObject({
      citations: [],
      evidenceSufficient: false,
      status: "error",
    });
  });

  it.each([
    ["country", (result: HybridSearchResponse) => {
      firstKnowledgeHit(result).countryIso3 = "BRA";
    }],
    ["scope", (result: HybridSearchResponse) => {
      firstKnowledgeHit(result).applicationScope = "marine";
    }],
    ["future date", (result: HybridSearchResponse) => {
      const hit = firstKnowledgeHit(result);
      hit.validFrom = "2099-01-01";
      hit.validTo = null;
    }],
    ["forged score", (result: HybridSearchResponse) => {
      firstKnowledgeHit(result).finalScore = 0.79;
    }],
  ])("withholds provider prose for drifted %s", async (label, mutate) => {
    const marker = `FORGED-KNOWLEDGE-${label.toUpperCase().replace(" ", "-")}`;
    const auditRepository = {
      recordToolCall: vi.fn(async () => undefined),
    };
    const sessionId = crypto.randomUUID();
    const hybridSearchKnowledge = vi.fn(async (input: unknown) => {
      const result = knowledgeResultFor(input);
      mutate(result);
      return result;
    });
    const tools = createSalesChatTools({
      auditRepository,
      selectedCountryIso3: null,
      services: { hybridSearchKnowledge },
      sessionId,
    });
    const result = streamSalesChat({
      auditRepository,
      messages: [
        {
          content: "查 CHN non-road Stage IV 排放限值原文。",
          role: "user",
        },
      ],
      model: knowledgeToolThenMarkerModel(marker),
      selectedCountryIso3: null,
      sessionId,
      tools,
      trustedUserTexts: ["查 CHN non-road Stage IV 排放限值原文。"],
    });
    const chunks = [];
    for await (const chunk of result.fullStream) {
      chunks.push(chunk);
    }
    const emittedText = chunks
      .flatMap((chunk) =>
        chunk.type === "text-delta" ? [chunk.text] : [],
      )
      .join("");

    expect(emittedText).toMatch(/证据|evidence/iu);
    expect(JSON.stringify(chunks)).not.toContain(marker);
    // This exercises drifted service output, not an earlier model-input denial.
    expect(hybridSearchKnowledge).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ jurisdictionId: null, limit: 5 }),
      { signal: expect.any(AbortSignal), deliveryCueRanking: true },
    );
    expect(auditRepository.recordToolCall).toHaveBeenCalledTimes(1);
  });
});
