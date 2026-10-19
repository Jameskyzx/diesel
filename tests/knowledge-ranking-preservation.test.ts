import { selectPortfolioDemoTool } from "./helpers/portfolio-demo";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { projectKnowledgeRankingQuery } from "@/domain/knowledge/delivery-query";
import { createLocalHashEmbedding } from "@/domain/knowledge/embedding";
import { selectKnowledgeRankingCandidates } from "@/domain/knowledge/ranking-candidates";
import { isKnowledgeResultRelevant } from "@/domain/knowledge/retrieval-policy";
import { hybridSearchResponseMatchesDeterministicRules, recomputeKnowledgeFinalScore, roundKnowledgeScore } from "@/domain/knowledge/search-consistency";

import { hybridSearchQuerySchema } from "@/features/knowledge/schemas";

import { getDemoDatabase } from "@/server/db/demo-client";
import * as schema from "@/server/db/schema";
import { createKnowledgeRepository } from "@/server/repositories/knowledge-repository";
import { hybridSearchKnowledge } from "@/server/services/knowledge-service";

const runtimeContext = { capturedAt: "2026-08-20T12:00:00.000Z", utcDate: "2026-08-20" } as const;
const chineseTurns = [
  "检索中国船用排放法规原文、章节和来源证据，截至 2026-08-20。",
  "改为非道路。", "不要从非道路改为船用。", "现在查 BRA。",
];
const queryInput = {
  applicationScope: "non-road" as const, asOf: runtimeContext.utcDate,
  countryIso3: "CHN", jurisdictionId: null, limit: 5,
  query: "CHN non-road emissions regulations sections",
};
let database: Awaited<ReturnType<typeof getDemoDatabase>>;

beforeAll(async () => {
  vi.stubEnv("DATABASE_MODE", "pglite-demo");
  database = await getDemoDatabase();
}, 15_000);
afterAll(async () => {
  vi.unstubAllEnvs();
  await database?.$client.close();
});

function ranked(chunkId: string, rankingPath: 0 | 1, keywordScore: number, vectorScore: number) {
  return {
    candidate: { chunkId, rankingPath }, keywordScore, vectorScore,
    finalScore: recomputeKnowledgeFinalScore({ keywordScore, vectorScore, keywordWeight: 0.5, vectorWeight: 0.5 }),
  };
}

describe("complete ranking pairs are selected without manufacturing stronger evidence", () => {
  it("rejects two weak paths even when taking each channel maximum would pass", () => {
    const original = ranked("same-chunk", 0, 0.4, 0);
    const projected = ranked("same-chunk", 1, 0, 0.4);
    expect(isKnowledgeResultRelevant(original)).toBe(false);
    expect(isKnowledgeResultRelevant(projected)).toBe(false);
    expect(isKnowledgeResultRelevant(ranked("same-chunk", 0, 0.4, 0.4))).toBe(true);
    expect(selectKnowledgeRankingCandidates([original, projected])).toEqual([]);
  });

  it.each([false, true])("returns the original complete pair on a tie regardless of row order (%s)", (reversed) => {
    const original = ranked("same-chunk", 0, 0.2, 0.6);
    const projected = ranked("same-chunk", 1, 0.6, 0.2);
    expect(selectKnowledgeRankingCandidates(reversed ? [projected, original] : [original, projected]))
      .toEqual([original]);
  });

  it("keeps the higher complete pair and deduplicates before the public limit", () => {
    const original = ranked("same-chunk", 0, 0.2, 0.6);
    const projected = ranked("same-chunk", 1, 0.8, 0.1);
    expect(selectKnowledgeRankingCandidates([original, projected])).toEqual([projected]);
    expect(selectKnowledgeRankingCandidates([
      ...Array.from({ length: 100 }, (_, index) => ranked(`original-${index}`, 0, 0.5, 0.2)),
      ...Array.from({ length: 100 }, (_, index) => ranked(`projected-${index}`, 1, 0.3, 0.5)),
    ])).toHaveLength(200);
  });
});

describe("ranking preserves the original Chinese Demo correction path", () => {

  it("retains the reproduced Chinese original score pair instead of the lower projected pair", async () => {
    const selected = selectPortfolioDemoTool(chineseTurns[1]!, chineseTurns.slice(0, 2));
    const query = hybridSearchQuerySchema.parse({ ...selected.input, limit: 5 });
    expect(query.query).toBe("CHN  非道路 排放法规原文、章节和来源证据， 。");
    const original = await hybridSearchKnowledge(query);
    const combined = await hybridSearchKnowledge(query, { deliveryCueRanking: true });
    const projected = await hybridSearchKnowledge({ ...query, query: projectKnowledgeRankingQuery(query.query, true) });
    expect(original.results).toHaveLength(1);
    expect(projected.results).toEqual([]);
    expect(original.results[0]).toMatchObject({ keywordScore: 0, vectorScore: 0.614414, finalScore: 0.307207 });
    expect(combined.results).toEqual(original.results);
    expect(combined.query).toBe(query.query);
    expect(hybridSearchResponseMatchesDeterministicRules(combined)).toBe(true);
  });
});

describe("two bounded candidate views share one database statement", () => {
  function observedRepository(onQuery?: (query: string) => void) {
    const statements: Array<{ query: string; params: unknown[] }> = [];
    const observed = drizzle(database.$client, { schema, logger: {
      logQuery(query, params) { statements.push({ query, params }); onQuery?.(query); },
    } });
    return { repository: createKnowledgeRepository(observed), statements };
  }
  const isCandidateRead = (query: string) => query.includes('from "document_chunks"');

  it("uses one UNION ALL with independently bounded top-100 paths and intact whole score pairs", async () => {
    const { repository, statements } = observedRepository();
    const rows = await repository.searchCandidates(queryInput, createLocalHashEmbedding(queryInput.query), { deliveryCueRanking: true });
    const reads = statements.filter(({ query }) => isCandidateRead(query));
    expect(reads).toHaveLength(1);
    expect(reads[0]!.query.toLowerCase()).toContain("union all");
    expect(reads[0]!.query.match(/limit \$/gu)).toHaveLength(2);
    expect(reads[0]!.params.filter((parameter) => parameter === 100)).toHaveLength(2);
    expect(rows).toHaveLength(2);
    expect(rows.map(({ rankingPath }) => rankingPath).sort()).toEqual([0, 1]);
    expect(new Set(rows.map(({ chunkId }) => chunkId)).size).toBe(1);
    const scorePairs = rows.map((row) => {
      const keyword = Math.max(Number(row.keywordScore), 0);
      return ranked(row.chunkId, row.rankingPath,
        roundKnowledgeScore(keyword === 0 ? 0 : keyword / (keyword + 0.1)),
        roundKnowledgeScore(Math.max(0, Math.min(1, 1 - Number(row.vectorDistance)))));
    });
    expect(scorePairs.find(({ candidate }) => candidate.rankingPath === 0)?.finalScore).toBe(0.219737);
    expect(scorePairs.find(({ candidate }) => candidate.rankingPath === 1)?.finalScore).toBe(0.393069);
    const publicResult = await hybridSearchKnowledge(queryInput, { deliveryCueRanking: true });
    expect(publicResult.results).toHaveLength(1);
    expect(JSON.stringify(publicResult)).not.toContain("rankingPath");
    expect(publicResult.results[0]).toMatchObject({ keywordScore: 0.52381, vectorScore: 0.262329, finalScore: 0.393069 });
  });

  it.each([
    { query: queryInput.query, enabled: false },
    { query: "CHN non-road emissions regulations", enabled: true },
    { query: 'CHN non-road emissions regulations "sections"', enabled: true },
    { query: "CHN non-road emissions regulations sections -fictional", enabled: true },
    { query: "original text sections source evidence", enabled: true },
  ])("keeps a single candidate view for $query / enabled=$enabled", async ({ query, enabled }) => {
    const { repository, statements } = observedRepository();
    await repository.searchCandidates({ ...queryInput, query }, createLocalHashEmbedding(query), enabled ? { deliveryCueRanking: true } : {});
    const reads = statements.filter(({ query }) => isCandidateRead(query));
    expect(reads).toHaveLength(1);
    expect(reads[0]!.query.toLowerCase()).not.toContain("union all");
    expect(reads[0]!.params.filter((parameter) => parameter === 100)).toHaveLength(1);
  });

  it.each(["before", "during-query-parse", "during-candidate-read"])("honors cancellation %s without a second candidate read", async (stage) => {
    const controller = new AbortController();
    if (stage === "before") controller.abort();
    const { repository, statements } = observedRepository((query) => {
      if ((stage === "during-query-parse" && query.includes("knowledge_spelling_parse")) ||
        (stage === "during-candidate-read" && isCandidateRead(query))) controller.abort();
    });
    await expect(repository.searchCandidates(queryInput, createLocalHashEmbedding(queryInput.query), {
      deliveryCueRanking: true, signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(statements.filter(({ query }) => isCandidateRead(query)))
      .toHaveLength(stage === "during-candidate-read" ? 1 : 0);
  });
});
