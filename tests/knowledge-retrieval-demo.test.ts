import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLocalHashEmbedding, tokenizeKnowledgeText } from "@/domain/knowledge/embedding";
import {
  aiKnowledgeSearchResultMatchesDeterministicRules,
  hybridSearchResponseMatchesDeterministicRules,
} from "@/domain/knowledge/search-consistency";
import { searchKnowledgeBaseResultSchema } from "@/features/ai/schemas";
import { unwrapUntrustedKnowledgeExcerpt } from "@/domain/knowledge/retrieval-policy";
import {
  buildSalesChatEvidenceContract,
  evidenceContractAllowsModelText,
} from "@/server/ai/evidence-contract";
import { createSalesChatTools } from "@/server/ai/sales-chat";
import { selectPortfolioDemoTool } from "@/server/ai/portfolio-demo-model";
import { getDemoDatabase } from "@/server/db/demo-client";
import { dataSources, documentChunks, documents } from "@/server/db/schema";
import { demoIds } from "@/server/db/seed/demo-data";
import { createKnowledgeRepository } from "@/server/repositories/knowledge-repository";
import { hybridSearchKnowledge, knowledgeQueryConstraintsMatch } from "@/server/services/knowledge-service";

const originalDatabaseMode = process.env.DATABASE_MODE;
let demoDatabase: Awaited<ReturnType<typeof getDemoDatabase>>;
const englishSourceQuery =
  "CHN non-road emissions regulations original text sections source evidence";
const scopedEnglishQuery = {
  applicationScope: "non-road" as const,
  asOf: "2026-08-20",
  countryIso3: "CHN",
  jurisdictionId: demoIds.jurisdiction.china,
  limit: 5,
  query: englishSourceQuery,
};

beforeAll(async () => {
  process.env.DATABASE_MODE = "pglite-demo";
  // PGlite compiles and migrates its WASM database on first use. Keep that
  // one-time setup outside the assertions and give slower Linux CI runners a
  // realistic integration-test budget without weakening the test itself.
  demoDatabase = await getDemoDatabase();
}, 15_000);

afterAll(() => {
  if (originalDatabaseMode === undefined) {
    delete process.env.DATABASE_MODE;
  } else {
    process.env.DATABASE_MODE = originalDatabaseMode;
  }
});

describe("Demo knowledge retrieval", () => {
  it.each([
    ["-China", 1], ["- China", 1], ["-BRA", 1], ["--China", 0], ["-CHN", 0],
  ] as const)("keeps the actual result of signed query %s when projecting application context", async (operand, expectedCount) => {
    const query = `${englishSourceQuery} ${operand}`;
    const text = `Retrieve ${query} as of 2026-08-20.`;
    const selected = selectPortfolioDemoTool(text, [text]);
    if (typeof selected.input.query !== "string") throw new Error("Expected source query");
    expect(selected.input.query).toContain(operand);
    expect((await hybridSearchKnowledge({ ...scopedEnglishQuery, query })).results).toHaveLength(expectedCount);
    expect((await hybridSearchKnowledge({ ...scopedEnglishQuery, query: selected.input.query })).results).toHaveLength(expectedCount);
    expect(buildSalesChatEvidenceContract({ selectedCountryIso3: null, userTexts: [text] }).requirements
      .map((requirement) => requirement.query.countryIso3s)).toEqual([["CHN"]]);
  });

  it("keeps a Chinese query exclusion separate from comma-delimited as-of metadata", async () => {
    const text = "检索 CHN 非道路排放法规原文、章节和来源证据 -CHN，截至 2026-08-20。";
    const selected = selectPortfolioDemoTool(text, [text]);
    if (typeof selected.input.query !== "string") throw new Error("Expected source query");
    expect(selected.input.asOf).toBe("2026-08-20");
    expect(selected.input.query).not.toContain("截至");
    expect((await hybridSearchKnowledge({ ...scopedEnglishQuery, query: selected.input.query })).results).toEqual([]);
  });

  it.each([
    ["Continue", ",as of 2026-08-21."],
    ["继续", "，截至 2026-08-21。"],
  ])("keeps dated %s refinements faithful through the actual knowledge tool", async (prefix, dateClause) => {
    const tools = createSalesChatTools({ auditRepository: { recordToolCall: async () => undefined },
      selectedCountryIso3: null, sessionId: crypto.randomUUID() });
    const execute = tools.searchKnowledgeBase.execute;
    if (!execute) throw new Error("Expected knowledge tool");
    for (const [operand, expectedCount] of [["-fictional", 0], ["-China", 1]] as const) {
      const turns = [`Retrieve ${englishSourceQuery} as of 2026-08-20.`, `${prefix} ${operand}${dateClause}`];
      const selected = selectPortfolioDemoTool(turns[1]!, turns);
      if (typeof selected.input.query !== "string") throw new Error("Expected source query");
      const expected = `${englishSourceQuery} ${operand}`;
      expect(await knowledgeQueryConstraintsMatch({ expected, actual: selected.input.query })).toBe(true);
      expect((await hybridSearchKnowledge({ ...scopedEnglishQuery, asOf: "2026-08-21", query: expected })).results).toHaveLength(expectedCount);
      const result = searchKnowledgeBaseResultSchema.parse(await execute({
        applicationScope: "non-road", countryIso3: "CHN", asOf: "2026-08-21", query: selected.input.query,
      }, { context: undefined as never, messages: [], toolCallId: "dated-source-refinement" }));
      expect(result.status).toBe(expectedCount === 0 ? "no_data" : "ok");
      const contract = buildSalesChatEvidenceContract({ selectedCountryIso3: null, userTexts: turns });
      expect(evidenceContractAllowsModelText(contract, [result])).toBe(expectedCount > 0);
    }
  });

  it("requires an actually matching native OR branch for a Chinese source query", async () => {
    // PostgreSQL simple does not segment the concatenated Han topic into the
    // lexemes of this fixture. A high vector score must not bypass OR anchors.
    const base = "检索 CHN 非道路排放法规原文、章节和来源证据 -China -BRA OR ";
    for (const [branch, expectedCount] of [["warranty", 0], ['"fictional source"', 1]] as const) {
      const text = `${base}${branch}，截至 2026-08-20。`;
      const selected = selectPortfolioDemoTool(text, [text]);
      if (typeof selected.input.query !== "string") throw new Error("Expected source query");
      const result = await hybridSearchKnowledge({ ...scopedEnglishQuery, query: selected.input.query });
      expect(result.results).toHaveLength(expectedCount);
      if (expectedCount === 1) expect(result.results[0]?.content).toContain("fictional source");
    }
  });

  it("does not manufacture a hit by canonicalizing a country name inside a literal phrase", async () => {
    const literal = '"China non-road"';
    const query = `${englishSourceQuery} ${literal}`;
    const text = `Retrieve ${query} as of 2026-08-20.`;
    const selected = selectPortfolioDemoTool(text, [text]);
    if (typeof selected.input.query !== "string") throw new Error("Expected source query");
    const original = await hybridSearchKnowledge({ ...scopedEnglishQuery, query });
    // The unchanged existing fixture says CHN, not the literal word China.
    const alias = await hybridSearchKnowledge({ ...scopedEnglishQuery, query: query.replace(literal, '"CHN non-road"') });
    expect(original.results).toEqual([]);
    expect(alias.results.map((hit) => hit.chunkId)).toContain(demoIds.documentChunk.regulation);
    expect(selected.input.query).toContain(literal);
    const projected = await hybridSearchKnowledge({ ...scopedEnglishQuery, query: selected.input.query });
    expect(projected.results).toEqual([]);
  });

  it("does not let a strong vector score override an explicit exclusion", async () => {
    const [stored] = await demoDatabase.select().from(documentChunks)
      .where(eq(documentChunks.id, demoIds.documentChunk.regulation));
    if (!stored) throw new Error("Expected the existing fictional source");
    const topic = tokenizeKnowledgeText(stored.content)
      .filter((token) => token !== "fictional" && token !== "or").join(" ");
    const original = await demoDatabase.select().from(documentChunks)
      .where(eq(documentChunks.id, stored.id));
    const included = await hybridSearchKnowledge({ ...scopedEnglishQuery, query: topic });
    expect(included.results[0]?.chunkId).toBe(stored.id);
    expect(included.results[0]?.vectorScore).toBeGreaterThan(0.9);
    const excluded = await hybridSearchKnowledge({ ...scopedEnglishQuery, query: `${topic} -fictional` });
    expect(excluded.results).toEqual([]);
    const allowed = await hybridSearchKnowledge({ ...scopedEnglishQuery, query: `${topic} -warranty` });
    expect(allowed.results[0]?.chunkId).toBe(stored.id);
    expect(await demoDatabase.select().from(documentChunks)
      .where(eq(documentChunks.id, stored.id))).toEqual(original);
  });

  it("requires the order of an explicit phrase even when vector similarity is high", async () => {
    const [stored] = await demoDatabase.select().from(documentChunks)
      .where(eq(documentChunks.id, demoIds.documentChunk.regulation));
    if (!stored) throw new Error("Expected the existing fictional source");
    const topic = tokenizeKnowledgeText(stored.content)
      .filter((token) => token !== "or").join(" ");
    const matched = await hybridSearchKnowledge({ ...scopedEnglishQuery, query: `${topic} "fictional source"` });
    expect(matched.results[0]?.chunkId).toBe(stored.id);
    const reversed = await hybridSearchKnowledge({ ...scopedEnglishQuery, query: `${topic} "source fictional"` });
    expect(reversed.results).toEqual([]);
  });

  it.each(["CHN", "China", "中国"])("uses the retained %s question through real tools after a scope correction", async (country) => {
    const turns = [
      `Retrieve ${country} marine emissions regulations original text sections source evidence as of 2026-08-20.`,
      "Actually use non-road.",
      "Do not switch from non-road to marine.",
      "Retrieve nonroad source evidence again.",
    ];
    const selected = selectPortfolioDemoTool(turns.at(-1)!, turns);
    const query = selected.input.query;
    if (typeof query !== "string") throw new Error("Expected retained query");
    expect(query).toContain("emissions regulations original text sections");
    expect(query).not.toContain("marine");
    const tools = createSalesChatTools({
      auditRepository: { recordToolCall: async () => undefined },
      selectedCountryIso3: null,
      sessionId: "00000000-0000-4000-8000-000000000932",
    });
    const execute = tools.searchKnowledgeBase.execute;
    if (!execute) throw new Error("Expected knowledge tool");
    const contract = buildSalesChatEvidenceContract({ selectedCountryIso3: null, userTexts: turns });
    const run = async (search: string) => searchKnowledgeBaseResultSchema.parse(await execute({
      applicationScope: "non-road", countryIso3: "CHN", asOf: "2026-08-20", query: search,
    }, { context: undefined as never, messages: [], toolCallId: "retained-source-question" }));
    const result = await run(query);
    expect(result.status).toBe("ok");
    expect(result.citations).toEqual(expect.arrayContaining([expect.objectContaining({
      documentId: demoIds.document.regulation, isDemo: true,
    })]));
    expect(evidenceContractAllowsModelText(contract, [result])).toBe(true);
    for (const missing of ["original text", "sections", "source evidence"]) {
      const incomplete = await run(query.replace(missing, ""));
      // v17 validates the delivered text/locator/citations; these cue words
      // are not mandatory search terms when the same evidence was returned.
      expect(incomplete.status).toBe("ok");
      expect(incomplete.search.results.map(({ content, sectionLocator }) => ({ content, sectionLocator })))
        .toEqual(result.search.results.map(({ content, sectionLocator }) => ({ content, sectionLocator })));
      expect(incomplete.citations).toEqual(result.citations);
      expect(evidenceContractAllowsModelText(contract, [incomplete])).toBe(true);
    }
  });

  it.each([
    "CHN non-road emissions regulations",
    "CHN non-road emissions regulations original text sections source evidence",
  ])("retrieves English inflections without changing the query: %s", async (query) => {
    const result = await hybridSearchKnowledge({
      applicationScope: "non-road",
      asOf: "2026-08-20",
      countryIso3: "CHN",
      jurisdictionId: demoIds.jurisdiction.china,
      limit: 5,
      query,
    });

    expect(result.query).toBe(query);
    expect(result.filters).toEqual({
      applicationScope: "non-road",
      asOf: "2026-08-20",
      countryIso3: "CHN",
      jurisdictionId: demoIds.jurisdiction.china,
      limit: 5,
    });
    expect(result.results.map(({ chunkId }) => chunkId)).toContain(
      demoIds.documentChunk.regulation,
    );
    expect(hybridSearchResponseMatchesDeterministicRules(result)).toBe(true);
  });

  it("retrieves the CHN non-road source fixture from the concise live-eval query", async () => {
    const query = "CHN 非道路排放法规";
    const repository = createKnowledgeRepository(demoDatabase);
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
    expect(hybridSearchResponseMatchesDeterministicRules(result)).toBe(true);

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
    expect(aiKnowledgeSearchResultMatchesDeterministicRules(toolResult)).toBe(
      true,
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

  it.each([
    { query: "CHN non-road emissions regulations", supported: true },
    { query: "CHN 非道路排放法规", supported: true },
    { query: "CHN non-road emissions regulations 非道路 排放", supported: false },
  ])("retains actual user terms and the existing retrieval boundary: $query", async ({ query, supported }) => {
    const original = await demoDatabase.select().from(documentChunks)
      .where(eq(documentChunks.id, demoIds.documentChunk.regulation));
    const input = { ...scopedEnglishQuery, jurisdictionId: null, query };
    const candidates = await createKnowledgeRepository(demoDatabase).searchCandidates(
      input, createLocalHashEmbedding(query),
    );
    expect(candidates.map(({ chunkId }) => chunkId)).toContain(demoIds.documentChunk.regulation);
    const candidate = candidates.find(({ chunkId }) => chunkId === demoIds.documentChunk.regulation)!;
    // PostgreSQL simple retains 非道路排放法规 as one lexeme, so appended
    // standalone 非道路 / 排放 operands can eliminate the keyword match.
    // Model guidance discourages inventing those translations; execution must
    // still preserve them if the user actually supplied them, not lower the
    // relevance threshold or silently remove words to force a successful hit.
    if (supported) expect(Number(candidate.keywordScore)).toBeGreaterThan(0);
    else expect(Number(candidate.keywordScore)).toBe(0);
    const tools = createSalesChatTools({
      auditRepository: { recordToolCall: async () => undefined },
      selectedCountryIso3: null,
      sessionId: crypto.randomUUID(),
    });
    if (!tools.searchKnowledgeBase.execute) throw new Error("Expected knowledge tool");
    const result = searchKnowledgeBaseResultSchema.parse(await tools.searchKnowledgeBase.execute({
      applicationScope: "non-road", asOf: input.asOf, countryIso3: "CHN", query,
    }, { context: undefined as never, messages: [], toolCallId: "query-language-preservation" }));
    expect(result.search.query).toBe(query);
    expect(result.status).toBe(supported ? "ok" : "no_data");
    expect(result.evidenceSufficient).toBe(supported);
    expect(result.search.scoring).toEqual({ keywordWeight: 0.5, vectorWeight: 0.5 });
    expect(aiKnowledgeSearchResultMatchesDeterministicRules(result)).toBe(true);
    if (supported) {
      expect(result.citations).toEqual(expect.arrayContaining([expect.objectContaining({
        chunkId: demoIds.documentChunk.regulation,
        documentId: demoIds.document.regulation,
        sourceId: demoIds.source.regulation,
        pageFrom: 1,
        sectionLocator: "DEMO-SECTION-1",
      })]));
    } else {
      expect(result.search.results).toEqual([]);
      expect(result.citations).toEqual([]);
    }
    expect(await demoDatabase.select().from(documentChunks)
      .where(eq(documentChunks.id, demoIds.documentChunk.regulation))).toEqual(original);
  });

  it.each([
    { label: "country", filter: { countryIso3: "BRA" } },
    { label: "application", filter: { applicationScope: "marine" } },
    { label: "jurisdiction", filter: { jurisdictionId: demoIds.jurisdiction.brazil } },
    { label: "pre-validity date", filter: { asOf: "2024-12-31" } },
  ])("does not broaden the $label filter for English inflections", async ({ filter }) => {
    const result = await hybridSearchKnowledge({ ...scopedEnglishQuery, ...filter });
    expect(result.results).toEqual([]);
    expect(result.query).toBe(englishSourceQuery);
    expect(hybridSearchResponseMatchesDeterministicRules(result)).toBe(true);
  });

  it("keeps both ends of the half-open validity interval", async () => {
    const rollback = new Error("rollback isolated validity probe");
    await expect(demoDatabase.transaction(async (transaction) => {
      await transaction.update(documentChunks)
        .set({ validTo: "2026-08-20" })
        .where(eq(documentChunks.id, demoIds.documentChunk.regulation));
      const repository = createKnowledgeRepository(transaction);
      const embedding = createLocalHashEmbedding(englishSourceQuery);
      for (const asOf of ["2025-01-01", "2026-08-19"]) {
        const results = await repository.searchCandidates(
          { ...scopedEnglishQuery, asOf }, embedding,
        );
        expect(results.map(({ chunkId }) => chunkId)).toContain(demoIds.documentChunk.regulation);
      }
      const expired = await repository.searchCandidates(scopedEnglishQuery, embedding);
      expect(expired).toEqual([]);
      throw rollback;
    })).rejects.toBe(rollback);
  });

  it.each([
    { label: "draft", patch: { governanceStatus: "draft" as const } },
    { label: "reviewed", patch: { governanceStatus: "reviewed" as const } },
    { label: "not ready", patch: { processingStatus: "pending" as const } },
    { label: "archived", patch: { archivedAt: new Date("2026-08-19T00:00:00Z") } },
  ])("does not retrieve a $label document after keyword expansion", async ({ patch }) => {
    const rollback = new Error("rollback isolated document visibility probe");
    await expect(demoDatabase.transaction(async (transaction) => {
      await transaction.update(documents).set(patch)
        .where(eq(documents.id, demoIds.document.regulation));
      const candidates = await createKnowledgeRepository(transaction).searchCandidates(
        scopedEnglishQuery, createLocalHashEmbedding(englishSourceQuery),
      );
      expect(candidates).toEqual([]);
      throw rollback;
    })).rejects.toBe(rollback);
  });

  it("does not retrieve evidence from an archived source", async () => {
    const rollback = new Error("rollback isolated source visibility probe");
    await expect(demoDatabase.transaction(async (transaction) => {
      await transaction.update(dataSources)
        .set({ archivedAt: new Date("2026-08-19T00:00:00Z") })
        .where(eq(dataSources.id, demoIds.source.regulation));
      const candidates = await createKnowledgeRepository(transaction).searchCandidates(
        scopedEnglishQuery, createLocalHashEmbedding(englishSourceQuery),
      );
      expect(candidates).toEqual([]);
      throw rollback;
    })).rejects.toBe(rollback);
  });

  it.each([
    "ZZZ_QUANTUM_BANANA_98765",
    "CHN non-road ZZZ_QUANTUM_BANANA_98765",
  ])("keeps a specific nonexistent query below the evidence threshold: %s", async (query) => {
    const result = await hybridSearchKnowledge({ ...scopedEnglishQuery, query });
    expect(result.results).toEqual([]);
  });

  it.each(["non-road", "nonroad", "non road"])("admits %s source evidence without changing stored text or embeddings", async (scope) => {
    const query = englishSourceQuery.replace("non-road", scope);
    const original = await demoDatabase.select().from(documentChunks)
      .where(eq(documentChunks.id, demoIds.documentChunk.regulation));
    const tools = createSalesChatTools({
      auditRepository: { recordToolCall: async () => undefined },
      selectedCountryIso3: null,
      sessionId: "00000000-0000-4000-8000-000000000930",
    });
    if (!tools.searchKnowledgeBase.execute) throw new Error("Expected knowledge tool");
    const result = searchKnowledgeBaseResultSchema.parse(await tools.searchKnowledgeBase.execute({
      applicationScope: "non-road",
      asOf: scopedEnglishQuery.asOf,
      countryIso3: "CHN",
      query,
    }, { context: undefined as never, messages: [], toolCallId: "English-inflections" }));
    expect(result.status).toBe("ok");
    expect(result.search.query).toBe(query);
    expect(result.search.embeddingModel).toBe("local-hash-embedding-v1");
    expect(result.search.scoring).toEqual({ keywordWeight: 0.5, vectorWeight: 0.5 });
    expect(unwrapUntrustedKnowledgeExcerpt(result.search.results[0]!.content)).toBe(original[0]?.content);
    expect(result.citations).toEqual(expect.arrayContaining([expect.objectContaining({
      chunkId: demoIds.documentChunk.regulation,
      documentId: demoIds.document.regulation,
      sourceId: demoIds.source.regulation,
      isDemo: true,
      pageFrom: 1,
      sectionLocator: "DEMO-SECTION-1",
    })]));
    const contract = buildSalesChatEvidenceContract({
      selectedCountryIso3: null,
      userTexts: [`Retrieve original text, sections, and source evidence for CHN ${scope} emissions regulations as of 2026-08-20.`],
    });
    expect(contract.applicationScope).toBe("non-road");
    expect(result.search.filters.applicationScope).toBe("non-road");
    expect(evidenceContractAllowsModelText(contract, [result])).toBe(true);
    const unscopedResult = searchKnowledgeBaseResultSchema.parse({
      ...result,
      search: { ...result.search, filters: { ...result.search.filters, applicationScope: null } },
    });
    expect(evidenceContractAllowsModelText(contract, [unscopedResult])).toBe(false);
    expect(await demoDatabase.select().from(documentChunks)
      .where(eq(documentChunks.id, demoIds.documentChunk.regulation))).toEqual(original);
  });

  it("accepts a business-only query when it actually delivers the requested excerpt and section", async () => {
    const tools = createSalesChatTools({
      auditRepository: { recordToolCall: async () => undefined },
      selectedCountryIso3: null,
      sessionId: "00000000-0000-4000-8000-000000000931",
    });
    if (!tools.searchKnowledgeBase.execute) throw new Error("Expected knowledge tool");
    const result = searchKnowledgeBaseResultSchema.parse(await tools.searchKnowledgeBase.execute({
      applicationScope: "non-road",
      asOf: scopedEnglishQuery.asOf,
      countryIso3: "CHN",
      query: "CHN non-road emissions regulations",
    }, { context: undefined as never, messages: [], toolCallId: "delivered-source-intent" }));
    expect(result.status).toBe("ok");
    expect(result.citations.length).toBeGreaterThan(0);
    const contract = buildSalesChatEvidenceContract({
      selectedCountryIso3: null,
      userTexts: ["Retrieve original text, sections, and source evidence for CHN non-road emissions regulations as of 2026-08-20."],
    });
    expect(result.search.results[0]?.sectionLocator).toBe("DEMO-SECTION-1");
    expect(unwrapUntrustedKnowledgeExcerpt(result.search.results[0]!.content)).toContain("FICTIONAL DEMO DATA");
    expect(evidenceContractAllowsModelText(contract, [result])).toBe(true);
  });
});
