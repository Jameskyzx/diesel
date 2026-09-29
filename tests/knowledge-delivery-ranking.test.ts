import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  extractKnowledgeDeliveryCues,
  projectKnowledgeRankingQuery,
} from "@/domain/knowledge/delivery-query";
import { tokenizeKnowledgeText } from "@/domain/knowledge/embedding";
import { unwrapUntrustedKnowledgeExcerpt } from "@/domain/knowledge/retrieval-policy";
import {
  aiKnowledgeSearchResultMatchesDeterministicRules,
  hybridSearchResponseMatchesDeterministicRules,
} from "@/domain/knowledge/search-consistency";
import {
  salesChatModelKnowledgeSearchInputSchema,
  searchKnowledgeBaseResultSchema,
  type SearchKnowledgeBaseResult,
} from "@/features/ai/schemas";
import { hybridSearchQuerySchema } from "@/features/knowledge/schemas";
import {
  buildSalesChatEvidenceContract,
  evidenceContractAllowsModelText,
} from "@/server/ai/evidence-contract";
import { createSalesChatTools } from "@/server/ai/sales-chat";
import { getDemoDatabase } from "@/server/db/demo-client";
import { demoIds } from "@/server/db/seed/demo-data";
import { hybridSearchKnowledge } from "@/server/services/knowledge-service";

const businessQuery = "CHN non-road emissions regulations";
const asOf = "2026-09-13";
const scopedQuery = {
  applicationScope: "non-road" as const,
  asOf,
  countryIso3: "CHN",
  jurisdictionId: null,
  limit: 5,
};
let database: Awaited<ReturnType<typeof getDemoDatabase>>;

async function searchAi(query: string): Promise<SearchKnowledgeBaseResult> {
  const tools = createSalesChatTools({
    auditRepository: { recordToolCall: async () => undefined },
    selectedCountryIso3: null,
    sessionId: crypto.randomUUID(),
  });
  const execute = tools.searchKnowledgeBase.execute;
  if (!execute) throw new Error("Missing knowledge tool");
  return searchKnowledgeBaseResultSchema.parse(await execute({
    applicationScope: "non-road", asOf, countryIso3: "CHN", query,
  }, { context: undefined as never, messages: [], toolCallId: "delivery-ranking-regression" }));
}

function contract(query: string) {
  return buildSalesChatEvidenceContract({
    selectedCountryIso3: null,
    userTexts: [`Retrieve ${query} as of ${asOf}.`],
  });
}

beforeAll(async () => {
  vi.stubEnv("DATABASE_MODE", "pglite-demo");
  database = await getDemoDatabase();
}, 15_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await database?.$client.close();
});

describe("AI delivery-cue ranking is opt-in and keeps original query semantics", () => {
  it("removes the reproduced sections-only ranking penalty without changing the default service", async () => {
    const query = `${businessQuery} sections`;
    const baseline = await hybridSearchKnowledge({ ...scopedQuery, query: businessQuery });
    const ordinary = await hybridSearchKnowledge({ ...scopedQuery, query });
    const projected = await hybridSearchKnowledge({ ...scopedQuery, query }, { deliveryCueRanking: true });
    expect(baseline.results).toHaveLength(1);
    expect(baseline.results[0]?.chunkId).toBe(demoIds.documentChunk.regulation);
    expect(ordinary.results).toEqual([]);
    expect(ordinary.query).toBe(query);
    expect(projected.results).toEqual(baseline.results);
    expect(projected.query).toBe(query);
    expect(projected.filters).toEqual(baseline.filters);
    expect(projected.scoring).toEqual(baseline.scoring);
    expect(hybridSearchResponseMatchesDeterministicRules(projected)).toBe(true);
  });

  it.each([
    "sections",
    "original text sections source evidence",
    "original text page numbers sections source evidence",
  ])("uses identical business ranking in the actual source tool for %s", async (cues) => {
    const query = `${businessQuery} ${cues}`;
    const baseline = await searchAi(businessQuery);
    const result = await searchAi(query);
    expect(baseline.status).toBe("ok");
    expect(result.status).toBe("ok");
    expect(result.search.query).toBe(query);
    expect(result.search.results).toEqual(baseline.search.results);
    expect(result.search.scoring).toEqual(baseline.search.scoring);
    expect(result.citations).toEqual(baseline.citations);
    expect(aiKnowledgeSearchResultMatchesDeterministicRules(result)).toBe(true);
    // These are alternative model queries for one source-only user request;
    // the model's concise query must not replace the retained user intent.
    expect(evidenceContractAllowsModelText(
      contract(`${businessQuery} original text page numbers sections source evidence`), [result],
    )).toBe(true);
    if (cues.includes("page numbers")) {
      // Better recall is not permission to add query requirements absent from
      // a different user request; retain the existing term-fidelity boundary.
      expect(evidenceContractAllowsModelText(
        contract(`${businessQuery} original text sections source evidence`), [result],
      )).toBe(false);
    }
    const service = await hybridSearchKnowledge({ ...scopedQuery, query }, { deliveryCueRanking: true });
    expect(service.results.map(({ chunkId, keywordScore, vectorScore, finalScore }) =>
      ({ chunkId, keywordScore, vectorScore, finalScore })))
      .toEqual(result.search.results.map(({ chunkId, keywordScore, vectorScore, finalScore }) =>
        ({ chunkId, keywordScore, vectorScore, finalScore })));
  });

  it.each([
    '"fictional source"',
    '"source fictional"',
    "-fictional",
    "-warranty",
    'OR "fictional source"',
    "DOC-source-1",
    "section 2",
  ])("retains native constraints or protected reference terms in real service results: %s", async (suffix) => {
    const query = `${businessQuery} sections ${suffix}`;
    const ordinary = await hybridSearchKnowledge({ ...scopedQuery, query });
    const projected = await hybridSearchKnowledge({ ...scopedQuery, query }, { deliveryCueRanking: true });
    expect(projected.query).toBe(query);
    expect(projected.filters).toEqual(ordinary.filters);
    if (suffix !== "section 2") {
      // Native quotes/signs/OR/compound identifiers disable the whole ranking
      // projection, not just its cue-removal subroutine.
      expect(projected).toEqual(ordinary);
    }
    if (suffix === '"source fictional"' || suffix === "-fictional") {
      expect(projected.results).toEqual([]);
    }
    if (suffix === "section 2") {
      expect(projectKnowledgeRankingQuery(query, true)).toContain("section 2");
    }
  });

  it("cannot relax requested page/section delivery after ranking succeeds", async () => {
    const source = await searchAi(`${businessQuery} sections`);
    const sourceHit = source.search.results[0];
    if (!sourceHit) throw new Error("Missing unchanged fictional source");
    // Use the existing excerpt to ensure locator checks are not hidden behind
    // low recall. No source, embedding, fixture or stored locator is modified.
    const highOverlap = tokenizeKnowledgeText(unwrapUntrustedKnowledgeExcerpt(sourceHit.content).split("中国")[0]!)
      .filter((word) => word !== "or").join(" ");
    const query = `CHN non-road ${highOverlap} page 1 section 1`;
    const result = await searchAi(query);
    const requested = contract(query);
    expect(result.status).toBe("ok");
    expect(result.search.query).toBe(query);
    expect(result.search.results[0]).toMatchObject({
      pageFrom: 1, pageTo: 1, sectionLocator: "DEMO-SECTION-1",
    });
    expect(evidenceContractAllowsModelText(requested, [result])).toBe(true);
    const unchanged = structuredClone(result);

    for (const position of [
      { pageFrom: null, pageTo: null, sectionLocator: "DEMO-SECTION-1" },
      { pageFrom: 2, pageTo: 2, sectionLocator: "DEMO-SECTION-1" },
      { pageFrom: 1, pageTo: 1, sectionLocator: null },
      { pageFrom: 1, pageTo: 1, sectionLocator: "DEMO-SECTION-2" },
    ]) {
      // Change both matching DTO locators so a simple citation-pair mismatch
      // cannot hide a missing/wrong requested location. Never write the DB.
      const copy = structuredClone(result);
      Object.assign(copy.search.results[0]!, position);
      Object.assign(copy.citations[0]!, position, {
        locator: position.sectionLocator ?? (position.pageFrom === null ? null : `第 ${position.pageFrom} 页`),
      });
      expect(searchKnowledgeBaseResultSchema.safeParse(copy).success).toBe(true);
      expect(evidenceContractAllowsModelText(requested, [copy])).toBe(false);
    }
    expect(result).toEqual(unchanged);
  });
});

describe("ranking projection only removes existing unprotected delivery cues", () => {
  it("does not add a public or model-controlled ranking option to input payloads", () => {
    const servicePayload = { ...scopedQuery, query: `${businessQuery} sections` };
    expect(hybridSearchQuerySchema.safeParse(servicePayload).success).toBe(true);
    expect(hybridSearchQuerySchema.safeParse({ ...servicePayload, deliveryCueRanking: true }).success).toBe(false);
    const modelPayload = { applicationScope: "non-road", asOf, countryIso3: "CHN", query: servicePayload.query };
    expect(salesChatModelKnowledgeSearchInputSchema.safeParse(modelPayload).success).toBe(true);
    expect(salesChatModelKnowledgeSearchInputSchema.safeParse({ ...modelPayload, deliveryCueRanking: true }).success).toBe(false);
  });

  it("is disabled by default and keeps an empty or cue-only projection unchanged", () => {
    const full = `${businessQuery} original text sections source evidence`;
    expect(projectKnowledgeRankingQuery(full)).toBe(full);
    expect(projectKnowledgeRankingQuery(full, true)).toBe(businessQuery);
    for (const query of ["", "original text sections source evidence", "章节和来源证据", "original text, sections"]) {
      expect(projectKnowledgeRankingQuery(query, true)).toBe(query);
    }
  });

  it("requires literal true even for untyped internal callers", () => {
    const query = `${businessQuery} sections`;
    for (const flag of [false, 1, "true", {}, []]) {
      expect(projectKnowledgeRankingQuery(query, flag as unknown as true)).toBe(query);
    }
  });

  it.each([
    '"original text"', '“original text”', '"sections', "-sections", "--sections",
    "sections OR warranty", "DOC-source-1", "source.v1", "source/sections", "section 2", "page 2",
    "第 2 节", "ISO 8178", "Stage V", "100 kW", "sectional warranty metallurgy", "非道路排放法规与市场表现",
  ])("preserves quoted, signed, OR, identifier, reference and business terms: %s", (suffix) => {
    const query = `${businessQuery} ${suffix}`;
    expect(projectKnowledgeRankingQuery(query, true)).toBe(query);
  });

  it("retains business words and punctuation instead of adding synonyms or translating", () => {
    const query = "CHN non-road emissions regulations; sections; warranty";
    expect(projectKnowledgeRankingQuery(query, true)).toBe("CHN non-road emissions regulations;         ; warranty");
    const chinese = "CHN 非道路排放法规 章节和来源证据";
    expect(projectKnowledgeRankingQuery(chinese, true)).toBe("CHN 非道路排放法规");
    expect(projectKnowledgeRankingQuery(`${businessQuery} 章节和业务主题`, true)).toContain("和业务主题");
  });

  it("shares the existing four cue kinds and protects literal/reference spans", () => {
    const extracted = extractKnowledgeDeliveryCues("original text sources pages sections");
    expect(new Set(extracted.cues.map(({ kind }) => kind))).toEqual(new Set(["excerpt", "source", "page", "section"]));
    expect(extractKnowledgeDeliveryCues('"original text" -sections DOC-source-1 page 2 section 2'))
      .toEqual({ cues: [], connectives: [] });
    const chinese = "章节和来源证据";
    const connectives = extractKnowledgeDeliveryCues(chinese).connectives;
    expect(connectives.map(({ start, end }) => chinese.slice(start, end))).toEqual(["和"]);
  });

  it("preserves over-bound input rather than partially projecting it", () => {
    const query = `${"business ".repeat(56)}sections`;
    expect(query.length).toBeGreaterThan(500);
    expect(projectKnowledgeRankingQuery(query, true)).toBe(query);
  });
});
