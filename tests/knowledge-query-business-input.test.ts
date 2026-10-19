

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { searchKnowledgeBaseResultSchema } from "@/features/ai/schemas";
import { buildSalesChatEvidenceContract, evidenceContractAllowsModelText } from "@/server/ai/evidence-contract";
import { knowledgeQuerySatisfies, knowledgeTermsIn, knowledgeTermsMatch } from "@/server/ai/knowledge-request-context";

import { createSalesChatTools } from "@/server/ai/sales-chat";
import { getDemoDatabase } from "@/server/db/demo-client";

const runtimeContext = { capturedAt: "2026-09-13T12:00:00.000Z", utcDate: "2026-09-13" } as const;
const request = "Retrieve the original text, sections, and source evidence for CHN non-road emissions regulations.";
const topic = "CHN non-road emissions regulations";
let database: Awaited<ReturnType<typeof getDemoDatabase>>;

beforeAll(async () => {
  vi.stubEnv("DATABASE_MODE", "pglite-demo");
  database = await getDemoDatabase();
}, 15_000);
afterAll(async () => {
  vi.unstubAllEnvs();
  await database?.$client.close();
});

describe("bounded model guidance is data and does not change the final evidence gate", () => {

  it("keeps the prior downstream rejection, including an old mismatched hit followed by a correct hit", async () => {
    const contract = buildSalesChatEvidenceContract({ runtimeContext, selectedCountryIso3: null, userTexts: [request] });
    const tools = createSalesChatTools({
      auditRepository: { recordToolCall: async () => undefined }, runtimeContext, selectedCountryIso3: null, sessionId: crypto.randomUUID(),
    });
    if (!tools.searchKnowledgeBase.execute) throw new Error("Missing source tool");
    const execute = async (query: string) => searchKnowledgeBaseResultSchema.parse(await tools.searchKnowledgeBase.execute!({
      applicationScope: "non-road", countryIso3: "CHN", query,
    }, { context: undefined as never, messages: [], toolCallId: crypto.randomUUID() }));
    // Direct trusted tool execution has no user-history contract. It provides
    // an independent control for the final gate, not a model-input escape hatch.
    const incomplete = await execute("CHN non-road original text sections source evidence");
    const complete = await execute(topic);
    expect(incomplete.status).toBe("ok");
    expect(complete.status).toBe("ok");
    expect(evidenceContractAllowsModelText(contract, [incomplete])).toBe(false);
    expect(evidenceContractAllowsModelText(contract, [complete])).toBe(true);
    expect(evidenceContractAllowsModelText(contract, [incomplete, complete])).toBe(false);
  });

  it("shares exactly the old nonempty business matcher semantics", () => {
    const variants: Array<readonly string[] | undefined> = [
      undefined, [], ["non", "road"], ["emissions", "regulations"], ["排", "放", "法", "规"],
      ["emissions", "regulations", "warranty"], ["123"], ["排"],
      knowledgeTermsIn(`${topic} sections`, ["CHN"]),
    ];
    for (const expected of variants) for (const actual of variants) {
      const optional = ["section", "sections"];
      const previous = expected === undefined || (expected.length > 0 && actual !== undefined && actual.length > 0 && knowledgeTermsMatch(expected, actual, optional));
      expect(knowledgeQuerySatisfies(expected, actual, optional)).toBe(previous);
    }
  });
});

describe("Chinese request wrappers do not become retained business requirements", () => {
  const wrapped = "查询 CHN 截至 2026-08-13 的非道路排放法规原文与来源。";
  const sourceQuery = "CHN non-road emissions regulation 原文 来源";
  const expectation = (text: string) => buildSalesChatEvidenceContract({
    runtimeContext, selectedCountryIso3: null, userTexts: [text],
  }).requirements[0]!.query;

  it("removes the longest request prefix and the attached date connector only", () => {
    const query = expectation(wrapped);
    expect(query.knowledgeTerms).not.toContain("询");
    expect(query.knowledgeTerms).not.toContain("的");
    expect(query.knowledgeTerms).toContain("与");
    expect(query.knowledgeOptionalTerms).toContain("与");
    expect(query.knowledgeQuery).toContain("排放法规原文与来源");
    expect(knowledgeQuerySatisfies(query.knowledgeTerms,
      knowledgeTermsIn(sourceQuery, ["CHN"]), query.knowledgeOptionalTerms)).toBe(true);
  });

  it.each(['"询"', '"查询"', "询价", "DOC-询-1", "DOC-查询-1"])(
    "preserves query-prefix characters inside business words, literals and identifiers: %s", (literal) => {
      const query = expectation(`${wrapped} ${literal}`);
      expect(query.knowledgeQuery).toContain(literal);
      expect(knowledgeQuerySatisfies(query.knowledgeTerms,
        knowledgeTermsIn(sourceQuery, ["CHN"]), query.knowledgeOptionalTerms)).toBe(false);
    },
  );

  it("does not interpret a leading identifier as the 查询 request prefix", () => {
    expect(expectation("查询-系统 CHN non-road emissions regulations original text source evidence").knowledgeQuery).toContain("查询-系统");
    expect(knowledgeTermsIn("查询-系统")).toContain("询");
    expect(knowledgeTermsIn('"查询"')).toContain("询");
  });

  it.each(['"的"', "-的", "DOC-的-1", "的确排放", "的士规则", "排放的版本"])(
    "does not make business or protected 的 optional: %s", (literal) => {
      const query = expectation(`${wrapped} ${literal}`);
      expect(query.knowledgeQuery).toContain(literal);
      expect(knowledgeQuerySatisfies(query.knowledgeTerms,
        knowledgeTermsIn(sourceQuery, ["CHN"]), query.knowledgeOptionalTerms)).toBe(false);
    },
  );

  it.each(["的确存在", "的士规则", "的-non-road"])(
    "preserves a business-word prefix after the date instead of using a global 的 stopword: %s", (words) => {
      const query = expectation(`查询 CHN 截至 2026-08-13 ${words} 非道路排放法规原文与来源。`);
      expect(query.knowledgeQuery).toContain(words);
      expect(query.knowledgeTerms).toContain("的");
    },
  );

  it.each(['"与"', "-与", "DOC-与-1", "排放与法规", "原文与业务主题", '"原文与来源"', "-原文与来源"])(
    "only makes 与 between two ordinary delivery cues optional, not %s", (literal) => {
      const query = expectation(`${wrapped} ${literal}`);
      expect(query.knowledgeQuery).toContain(literal);
      if (!literal.startsWith("DOC-")) expect(query.knowledgeOptionalTerms).not.toContain("与");
      expect(knowledgeQuerySatisfies(query.knowledgeTerms,
        knowledgeTermsIn(sourceQuery, ["CHN"]), query.knowledgeOptionalTerms)).toBe(false);
    },
  );

  it.each(['"截至 2026-08-13 的非道路"', '-"截至 2026-08-13 的非道路"', "DOC-截至2026-08-13的-1"])(
    "keeps protected date-and-的 wording intact: %s", (literal) => {
      const query = expectation(`查询 CHN 非道路排放法规原文与来源 ${literal}。`);
      expect(query.knowledgeQuery).toContain(literal);
    },
  );
});
