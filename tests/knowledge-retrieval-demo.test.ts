import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLocalHashEmbedding } from "@/domain/knowledge/embedding";
import { searchKnowledgeBaseResultSchema } from "@/features/ai/schemas";
import { createSalesChatTools } from "@/server/ai/sales-chat";
import { getDemoDatabase } from "@/server/db/demo-client";
import { demoIds } from "@/server/db/seed/demo-data";
import { createKnowledgeRepository } from "@/server/repositories/knowledge-repository";
import { hybridSearchKnowledge } from "@/server/services/knowledge-service";

const originalDatabaseMode = process.env.DATABASE_MODE;

beforeAll(() => {
  process.env.DATABASE_MODE = "pglite-demo";
});

afterAll(() => {
  if (originalDatabaseMode === undefined) {
    delete process.env.DATABASE_MODE;
  } else {
    process.env.DATABASE_MODE = originalDatabaseMode;
  }
});

describe("Demo knowledge retrieval", () => {
  it("retrieves the CHN non-road source fixture from the concise live-eval query", async () => {
    const query = "CHN 非道路排放法规";
    const repository = createKnowledgeRepository(await getDemoDatabase());
    const candidates = await repository.searchCandidates(
      {
        applicationScope: null,
        asOf: "2026-08-20",
        countryIso3: "CHN",
        jurisdictionId: null,
        limit: 5,
        query,
      },
      createLocalHashEmbedding(query),
    );
    const result = await hybridSearchKnowledge({
      applicationScope: null,
      asOf: "2026-08-20",
      countryIso3: "CHN",
      jurisdictionId: null,
      limit: 5,
      query,
    });

    expect(candidates[0]?.chunkId).toBe(demoIds.documentChunk.regulation);
    expect(Number(candidates[0]?.keywordScore)).toBeGreaterThan(0);
    expect(result.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          chunkId: demoIds.documentChunk.regulation,
          countryIso3: "CHN",
        }),
      ]),
    );

    const tools = createSalesChatTools({
      auditRepository: { recordToolCall: async () => undefined },
      selectedCountryIso3: "CHN",
      sessionId: "00000000-0000-4000-8000-000000000928",
    });
    if (!tools.searchKnowledgeBase.execute) {
      throw new Error("Expected searchKnowledgeBase to be executable.");
    }
    const toolResult = searchKnowledgeBaseResultSchema.parse(
      await tools.searchKnowledgeBase.execute(
        {
          asOf: "2026-08-20",
          countryIso3: "CHN",
          query,
        },
        {
          context: undefined as never,
          messages: [],
          toolCallId: "concise-live-eval-query",
        },
      ),
    );

    expect(toolResult).toMatchObject({
      evidenceSufficient: true,
      status: "ok",
    });
    expect(toolResult.search.results[0]?.chunkId).toBe(
      demoIds.documentChunk.regulation,
    );
  });

  it("keeps an unrelated query below the evidence threshold", async () => {
    const result = await hybridSearchKnowledge({
      applicationScope: null,
      asOf: "2026-08-20",
      countryIso3: "CHN",
      jurisdictionId: null,
      limit: 5,
      query: "MEX marine warranty schedule",
    });

    expect(result.results).toEqual([]);
  });
});
