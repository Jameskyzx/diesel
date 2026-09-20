import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { tokenizeKnowledgeText } from "@/domain/knowledge/embedding";
import { knowledgeDeliverySatisfied, type KnowledgeDeliveryRequirements } from "@/domain/knowledge/delivery";
import { unwrapUntrustedKnowledgeExcerpt, wrapUntrustedKnowledgeExcerpt } from "@/domain/knowledge/retrieval-policy";
import { searchKnowledgeBaseResultSchema, type SearchKnowledgeBaseResult } from "@/features/ai/schemas";
import { buildSalesChatEvidenceContract, evidenceContractAllowsModelText, knowledgeTermsIn, knowledgeTermsMatch } from "@/server/ai/evidence-contract";
import { createSalesChatTools } from "@/server/ai/sales-chat";
import { getDemoDatabase } from "@/server/db/demo-client";

const originalDatabaseMode = process.env.DATABASE_MODE;
const topic = "CHN non-road emissions regulations original text sections source evidence";
let highOverlapTopic = "";
let database: Awaited<ReturnType<typeof getDemoDatabase>>;
let baseline: SearchKnowledgeBaseResult;

async function search(query: string) {
  const tools = createSalesChatTools({ auditRepository: { recordToolCall: async () => undefined },
    selectedCountryIso3: null, sessionId: crypto.randomUUID() });
  if (!tools.searchKnowledgeBase.execute) throw new Error("Missing source tool");
  return searchKnowledgeBaseResultSchema.parse(await tools.searchKnowledgeBase.execute({
    applicationScope: "non-road", countryIso3: "CHN", asOf: "2026-08-20", query,
  }, { context: undefined as never, messages: [], toolCallId: "source-delivery-test" }));
}

const contract = (query: string) => buildSalesChatEvidenceContract({
  selectedCountryIso3: null, userTexts: [`Retrieve ${query} as of 2026-08-20.`],
});

beforeAll(async () => {
  process.env.DATABASE_MODE = "pglite-demo";
  database = await getDemoDatabase();
  const original = await search(topic);
  baseline = original;
  const hit = original.search.results[0];
  if (!hit) throw new Error("Missing existing fictional source");
  // Build the high-similarity control only from the unchanged existing source.
  // Omit native OR syntax; the test is about returned locators, not OR branches.
  const words = tokenizeKnowledgeText(unwrapUntrustedKnowledgeExcerpt(hit.content).split("中国")[0]!)
    .filter((word) => word !== "or");
  highOverlapTopic = `CHN non-road ${words.join(" ")}`;
}, 15_000);

afterAll(async () => {
  if (originalDatabaseMode === undefined) delete process.env.DATABASE_MODE;
  else process.env.DATABASE_MODE = originalDatabaseMode;
  await database?.$client.close();
});

const delivery = (pages: string[] = [], sections: string[] = []): KnowledgeDeliveryRequirements => ({
  pageLocator: pages.length > 0, sectionLocator: sections.length > 0, pages, sections,
});

/** In-memory DTO copies for pure boundary tests, not new stored sources. */
function located(...positions: Array<{ from: number | null; to?: number | null; section?: string | null; content?: string }>) {
  const result = structuredClone(baseline);
  const original = result.search.results[0]!;
  const citation = result.citations[0]!;
  result.search.results = positions.map((position, index) => ({
    ...original, chunkId: `00000000-0000-4000-8000-000000000${700 + index}`, rank: index + 1,
    pageFrom: position.from, pageTo: position.to === undefined ? position.from : position.to,
    sectionLocator: position.section === undefined ? "Section 1" : position.section,
    content: position.content ?? original.content,
  }));
  result.citations = result.search.results.map((hit) => ({
    ...citation, chunkId: hit.chunkId, pageFrom: hit.pageFrom, pageTo: hit.pageTo, sectionLocator: hit.sectionLocator,
    locator: hit.sectionLocator ?? (hit.pageFrom === null ? null : `第 ${hit.pageFrom}${hit.pageTo !== null && hit.pageTo !== hit.pageFrom ? `–${hit.pageTo}` : ""} 页`),
  }));
  return result;
}

describe("source delivery boundaries", () => {
  it.each(["章节和来源证据", "原文 和 章节", "sections 和 sources"])(
    "treats 和 only between ordinary delivered-source cues as optional: %s", (wording) => {
      const query = contract(`CHN non-road emissions regulations ${wording}`).requirements[0]!.query;
      expect(query.knowledgeQuery).toContain(wording);
      expect(query.knowledgeTerms).toContain("和");
      expect(query.knowledgeOptionalTerms).toContain("和");
      expect(knowledgeTermsMatch(query.knowledgeTerms!,
        knowledgeTermsIn("CHN non-road emissions regulations", ["CHN"]), query.knowledgeOptionalTerms)).toBe(true);
    },
  );

  it.each(['"和"', "-和", "DOC-和-1", "和平法规", "章节和业务主题", '"章节和来源"', "-章节和来源", "DOC-章节和来源-1"])(
    "keeps 和 binding in literal, signed, identifier, or business wording: %s", (literal) => {
      const query = contract(`${topic} 章节和来源证据 ${literal}`).requirements[0]!.query;
      expect(query.knowledgeQuery).toContain(literal);
      if (!literal.startsWith("DOC-")) expect(query.knowledgeOptionalTerms).not.toContain("和");
      expect(knowledgeTermsMatch(query.knowledgeTerms!,
        knowledgeTermsIn("CHN non-road emissions regulations", ["CHN"]), query.knowledgeOptionalTerms)).toBe(false);
    },
  );

  it.each([
    { name: "one complete interval", positions: [{ from: 2, to: 4 }], allowed: true },
    { name: "adjacent intervals", positions: [{ from: 2 }, { from: 3, to: 4 }], allowed: true },
    { name: "a missing middle page", positions: [{ from: 2 }, { from: 4 }], allowed: false },
    { name: "an open endpoint is only its start page", positions: [{ from: 2, to: null }], allowed: false },
  ])("requires complete page coverage: $name", ({ positions, allowed }) => {
    expect(knowledgeDeliverySatisfied(delivery(["2-4"]), located(...positions))).toBe(allowed);
  });

  it.each(["0", "2-1", "2/3", "iv", "9007199254740992"])("fails closed for an unrepresentable page reference %s", (page) => {
    expect(knowledgeDeliverySatisfied(delivery([page]), located({ from: 1, to: 10 }))).toBe(false);
  });

  it.each([
    ["Section 2", true], ["DEMO-SECTION-2", true], ["§ 2", true], ["第2节", true],
    ["Section 20", false], ["Section 2.1", false], ["Version 2", false], ["Page 2", false],
  ] as const)("matches the dedicated section locator %s without numeric substring matches", (section, allowed) => {
    expect(knowledgeDeliverySatisfied(delivery([], ["ref:section:2"]), located({ from: 1, section }))).toBe(allowed);
  });

  it("does not combine a page from the wrong section with a section from the wrong page", () => {
    const result = located({ from: 1, section: "Section 1" }, { from: 2, section: "Section 2" });
    expect(knowledgeDeliverySatisfied(delivery(["1"], ["ref:section:2"]), result)).toBe(false);
    expect(knowledgeDeliverySatisfied(delivery(["1-2"], ["ref:section:1", "ref:section:2"]), result)).toBe(true);
    expect(knowledgeDeliverySatisfied(delivery([], ["ref:section:1", "ref:section:3"]), result)).toBe(false);
  });

  it("requires an original excerpt and a citation to that same hit", () => {
    expect(knowledgeDeliverySatisfied(delivery(), located({ from: 1, content: wrapUntrustedKnowledgeExcerpt(" ") }))).toBe(false);
    expect(knowledgeDeliverySatisfied(delivery(), located({ from: 1, content: "Unwrapped text" }))).toBe(false);
    const missing = located({ from: 1 });
    missing.citations = [];
    expect(knowledgeDeliverySatisfied(delivery(), missing)).toBe(false);
    const mismatched = located({ from: 2 });
    mismatched.citations[0]!.pageFrom = 1;
    expect(knowledgeDeliverySatisfied(delivery(["2"]), mismatched)).toBe(false);
  });

  it("does not claim generic requested locators when they are absent", () => {
    const page = { ...delivery(), pageLocator: true };
    const section = { ...delivery(), sectionLocator: true };
    expect(knowledgeDeliverySatisfied(page, located({ from: null }))).toBe(false);
    expect(knowledgeDeliverySatisfied(section, located({ from: 1, section: null }))).toBe(false);
    const split = located({ from: 1, content: wrapUntrustedKnowledgeExcerpt("") }, { from: 1, section: null });
    expect(knowledgeDeliverySatisfied(section, split)).toBe(false);
  });

  it("does not make quoted, signed, or identifier words optional", () => {
    for (const literal of ['"original text"', "-source", "DOC-source-1"]) {
      const query = contract(`${topic} ${literal}`).requirements[0]!.query;
      if (literal === '"original text"') {
        expect(query.knowledgeOptionalTerms).not.toContain("original");
        expect(query.knowledgeOptionalTerms).not.toContain("text");
      }
      if (literal === "-source") expect(query.knowledgeOptionalTerms).not.toContain("source");
      expect(query.knowledgeOptionalTerms?.some((term) => term.includes(":"))).toBe(false);
    }
    const signed = contract(`${topic} -section.2 -"page 2"`).requirements[0]!.query.knowledgeDelivery;
    expect(signed).toMatchObject({ pages: [], sections: [] });
    // An optional plural cue must not manufacture coverage for a required
    // literal singular through the existing inflection/concept aliases.
    const literalSection = contract(`${topic} "section"`).requirements[0]!.query;
    expect(knowledgeTermsMatch(literalSection.knowledgeTerms!,
      knowledgeTermsIn("CHN non-road emissions regulations", ["CHN"]), literalSection.knowledgeOptionalTerms)).toBe(false);
  });

  it("keeps delivery locators aligned with later scope/country/reference corrections", () => {
    const context = buildSalesChatEvidenceContract({ selectedCountryIso3: null, userTexts: [
      `Retrieve ${topic} page 1 section 1 as of 2026-08-20.`,
      "Continue with page 2 section 3.", "Now BRA.",
    ] });
    expect(context.requirements[0]?.query).toMatchObject({ countryIso3s: ["BRA"],
      knowledgeDelivery: { pages: ["2"], sections: ["ref:section:3"] } });
  });
});

describe("knowledge delivery follows returned evidence, not query cue words", () => {
  it("accepts identical Chinese delivered facts without retaining a delivery-only connective", async () => {
    const fullQuery = "CHN 非道路排放法规原文、章节和来源证据";
    const conciseQuery = "CHN 非道路排放法规";
    const original = await search(fullQuery);
    const concise = await search(conciseQuery);
    const facts = (value: SearchKnowledgeBaseResult) => value.search.results.map((hit) => ({
      chunkId: hit.chunkId, content: hit.content, document: hit.document,
      pageFrom: hit.pageFrom, pageTo: hit.pageTo, sectionLocator: hit.sectionLocator,
    }));
    expect(original.status).toBe("ok");
    expect(concise.status).toBe("ok");
    expect(facts(concise)).toEqual(facts(original));
    expect(concise.citations).toEqual(original.citations);
    const request = buildSalesChatEvidenceContract({
      selectedCountryIso3: null,
      userTexts: [`检索 ${fullQuery}，截至 2026-08-20。`],
    });
    expect(evidenceContractAllowsModelText(request, [original])).toBe(true);
    expect(evidenceContractAllowsModelText(request, [concise])).toBe(true);
  });

  it.each(["original text", "sections", "source evidence"])("accepts identical delivered facts when the query omits %s", async (omitted) => {
    const original = await search(topic);
    const result = await search(topic.replace(omitted, ""));
    const facts = (value: typeof result) => value.search.results.map((hit) => ({
      chunkId: hit.chunkId, content: hit.content, document: hit.document,
      pageFrom: hit.pageFrom, pageTo: hit.pageTo, sectionLocator: hit.sectionLocator,
    }));
    expect(result.status).toBe("ok");
    expect(facts(result)).toEqual(facts(original));
    expect(result.citations).toEqual(original.citations);
    expect(evidenceContractAllowsModelText(contract(topic), [result])).toBe(true);
  });

  it.each([
    ["page 1", true], ["page 2", false], ["第 2 页", false],
    ["section 1", true], ["section 2", false], ["第 2 节", false],
  ] as const)("checks actual source positions for %s despite high vector similarity", async (locator, allowed) => {
    const query = `${highOverlapTopic} ${locator}`;
    const result = await search(query);
    expect(result.status).toBe("ok");
    expect(result.search.results[0]).toMatchObject({ pageFrom: 1, pageTo: 1, sectionLocator: "DEMO-SECTION-1" });
    expect(result.search.results[0]?.vectorScore).toBeGreaterThan(0.45);
    expect(evidenceContractAllowsModelText(contract(query), [result])).toBe(allowed);
  });
});
