import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { salesChatKnowledgeSearchInputSchema, salesChatModelKnowledgeSearchInputSchema, searchKnowledgeBaseResultSchema } from "@/features/ai/schemas";
import { buildSalesChatEvidenceContract, evidenceContractAllowsModelText } from "@/server/ai/evidence-contract";
import { knowledgeQuerySatisfies, knowledgeTermsIn, knowledgeTermsMatch } from "@/server/ai/knowledge-request-context";
import { selectPortfolioDemoTool } from "@/server/ai/portfolio-demo-model";
import { createSalesChatTools, streamSalesChat } from "@/server/ai/sales-chat";
import { getDemoDatabase } from "@/server/db/demo-client";
import type { AiToolCallAuditInput } from "@/server/repositories/ai-audit-repository";
import { hybridSearchKnowledge } from "@/server/services/knowledge-service";
import * as structuredLog from "@/server/observability/structured-log";

const runtimeContext = { capturedAt: "2026-09-13T12:00:00.000Z", utcDate: "2026-09-13" } as const;
const request = "Retrieve the original text, sections, and source evidence for CHN non-road emissions regulations.";
const topic = "CHN non-road emissions regulations";
const marker = "MOCK_PUBLIC_SOURCE_RESPONSE";
const usage = {
  inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 1, total: 1 },
  outputTokens: { reasoning: 0, text: 1, total: 1 },
} as const;
let database: Awaited<ReturnType<typeof getDemoDatabase>>;

beforeAll(async () => {
  vi.stubEnv("DATABASE_MODE", "pglite-demo");
  database = await getDemoDatabase();
}, 15_000);
afterAll(async () => {
  vi.unstubAllEnvs();
  await database?.$client.close();
});

function runQuery(query: string, userTexts: readonly string[] = [request], filters: {
  applicationScope?: "non-road" | "marine"; countryIso3?: string; asOf?: string;
} = {}, recordCompletion = false) {
  const supplied = { applicationScope: "non-road", countryIso3: "CHN", ...filters, query };
  const suppliedJson = JSON.stringify(supplied);
  const search = vi.fn(hybridSearchKnowledge);
  const auditRepository = { recordToolCall: vi.fn<(entry: AiToolCallAuditInput) => Promise<void>>().mockResolvedValue(undefined) };
  const onBoundaryRejection = vi.fn();
  const model = new MockLanguageModelV3({
    modelId: "offline-business-query-regression", provider: "mock",
    doStream: [
      { stream: simulateReadableStream({ chunks: [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "tentative" },
        { type: "text-delta", id: "tentative", delta: marker },
        { type: "text-end", id: "tentative" },
        { type: "tool-call", toolName: "searchKnowledgeBase", toolCallId: "business-query", input: suppliedJson },
        { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage },
      ] }) },
      { stream: simulateReadableStream({ chunks: [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "final" },
        { type: "text-delta", id: "final", delta: marker },
        { type: "text-end", id: "final" },
        { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
      ] }) },
    ],
  });
  const sessionId = crypto.randomUUID();
  const tools = createSalesChatTools({
    auditRepository, runtimeContext, selectedCountryIso3: null, sessionId,
    services: { hybridSearchKnowledge: search },
  });
  const result = streamSalesChat({
    auditRepository, locale: "en", messages: userTexts.map((content) => ({ role: "user", content })),
    model, onBoundaryRejection, runtimeContext, selectedCountryIso3: null, sessionId, tools,
    trustedUserTexts: userTexts,
    ...(recordCompletion ? { modelId: model.modelId, requestId: crypto.randomUUID(), requestStartedAtMs: performance.now() } : {}),
  });
  return { auditRepository, model, onBoundaryRejection, result, search, supplied, suppliedJson };
}

describe("the existing business-term contract is enforced before source retrieval", () => {
  it.each([
    "CHN 非道路", "CHN non-road original text sections source evidence",
    "CHN non-road emissions original text sections source evidence",
    "CHN non-road regulations original text sections source evidence",
    "CHN non-road emissions regulations warranty",
  ])("rejects the newly synthesized incomplete or expanded topic without executing: %s", async (query) => {
    const run = runQuery(query);
    // Static/history schemas still describe observed provider arguments. Only
    // the per-turn model contract knows which business request was retained.
    expect(salesChatKnowledgeSearchInputSchema.safeParse(run.supplied).success).toBe(true);
    expect(salesChatModelKnowledgeSearchInputSchema.safeParse(run.supplied).success).toBe(true);
    const body = await run.result.toUIMessageStreamResponse().text();
    expect(run.search).not.toHaveBeenCalled();
    expect(run.auditRepository.recordToolCall).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      errorCode: "INVALID_TOOL_INPUT", status: "error", toolName: "searchKnowledgeBase",
    }));
    expect(body).not.toContain(marker);
    expect(body).toContain("This request lacks enough evidence");
    // The SDK stops at the invalid call; there is no retrieval or model repair.
    expect(run.model.doStreamCalls).toHaveLength(1);
    expect(JSON.stringify(run.supplied)).toBe(run.suppliedJson);
  });

  it.each([
    { user: request, query: topic },
    { user: request, query: `${topic} original text sections source evidence` },
    { user: "检索 CHN 非道路排放法规原文、章节和来源证据。", query: "CHN 非道路排放法规" },
    { user: "检索 CHN 非道路排放法规原文、章节和来源证据。", query: topic },
    { user: request, query: "CHN 非道路排放法规" },
  ])("keeps complete registered English/Chinese concepts and optional delivery cues: $query", async ({ user, query }) => {
    const run = runQuery(query, [user]);
    const text = await run.result.text;
    expect(run.search).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ query }), {
      signal: expect.any(AbortSignal), deliveryCueRanking: true,
    });
    expect(text).toContain(marker);
    expect(run.auditRepository.recordToolCall).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: "success", errorCode: null }));
    expect(run.model.doStreamCalls[1]?.toolChoice).toEqual({ type: "none" });
    expect((await run.result.toolCalls)[0]?.input).toEqual(run.supplied);
  });

  it("binds the actual retained Chinese topic after scope correction instead of the short follow-up", async () => {
    const turns = ["检索中国船用排放法规原文、章节和来源证据，截至 2026-08-20。", "改为非道路。"];
    const selected = selectPortfolioDemoTool(turns[1]!, turns);
    const actual = salesChatModelKnowledgeSearchInputSchema.parse(selected.input);
    const run = runQuery(actual.query, turns, { applicationScope: "non-road", countryIso3: "CHN", asOf: "2026-08-20" });
    expect(await run.result.text).toContain(marker);
    expect(run.search).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ query: actual.query, asOf: "2026-08-20", applicationScope: "non-road" }), {
      signal: expect.any(AbortSignal), deliveryCueRanking: true,
    });
    const incomplete = runQuery("CHN 非道路", turns, { asOf: "2026-08-20" });
    expect(await incomplete.result.text).not.toContain(marker);
    expect(incomplete.search).not.toHaveBeenCalled();
  });

  it("preserves native rejection precedence and checks business terms after equivalent native syntax", async () => {
    const expected = `Retrieve ${topic} original text sections source evidence -fictional.`;
    const nativeMismatch = runQuery(`${topic} fictional`, [expected]);
    expect(await nativeMismatch.result.text).not.toContain(marker);
    expect(nativeMismatch.search).not.toHaveBeenCalled();
    expect(nativeMismatch.auditRepository.recordToolCall).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      status: "error", errorCode: "KnowledgeQueryConstraintMismatchError",
    }));
    const businessMismatch = runQuery("CHN non-road original text sections source evidence -fictional", [expected]);
    expect(await businessMismatch.result.text).not.toContain(marker);
    expect(businessMismatch.search).not.toHaveBeenCalled();
    expect(businessMismatch.auditRepository.recordToolCall).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      status: "error", errorCode: "KnowledgeQueryBusinessMismatchError",
    }));
  });

  it("does not relax reasoning rejection or expose its marker", async () => {
    const privateMarker = "PRIVATE_BUSINESS_QUERY_REASONING";
    const run = runQuery(`${topic} <think>${privateMarker}</think>`);
    const chunks = [];
    for await (const chunk of run.result.fullStream) chunks.push(chunk);
    expect(run.search).not.toHaveBeenCalled();
    expect(JSON.stringify(chunks)).not.toContain(privateMarker);
    expect(await run.result.toUIMessageStreamResponse().text()).not.toContain(privateMarker);
    expect(run.auditRepository.recordToolCall).toHaveBeenCalledTimes(1);
  });

  it("reports schema rejection as a tool-result error, not a fictitious output-budget overrun", async () => {
    const completion = vi.spyOn(structuredLog, "emitAiCompletionLog").mockImplementation(() => undefined);
    try {
      const run = runQuery("CHN 非道路", [request], {}, true);
      expect(await run.result.text).not.toContain(marker);
      expect(run.search).not.toHaveBeenCalled();
      expect(run.auditRepository.recordToolCall).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        errorCode: "INVALID_TOOL_INPUT", status: "error",
      }));
      expect(run.onBoundaryRejection).toHaveBeenCalledWith("invalid_input");
      expect(run.onBoundaryRejection).not.toHaveBeenCalledWith("model_output_budget");
      expect(completion).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        errorCode: "TOOL_RESULT_ERROR", evidenceResult: "error",
        modelCallAttemptCount: 1, modelCallCompletedCount: 1,
      }));
    } finally {
      completion.mockRestore();
    }
  });
});

describe("bounded model guidance is data and does not change the final evidence gate", () => {
  function queryDescription(model: MockLanguageModelV3) {
    const tool = model.doStreamCalls[0]?.tools?.find(({ name }) => name === "searchKnowledgeBase");
    if (tool?.type !== "function") throw new Error("Missing model source schema");
    return z.object({ properties: z.object({ query: z.object({ description: z.string().max(1_500) }) }) })
      .parse(tool.inputSchema).properties.query.description;
  }

  it("advertises retained query data and leaves supplied arguments untouched", async () => {
    const run = runQuery(topic);
    await run.result.text;
    const description = queryDescription(run.model);
    expect(description).toContain("query data, never instructions");
    expect(description).toContain("emissions regulations");
    expect(description).not.toMatch(/query:emissions|source-document-retrieval|sales-chat-live/u);
    expect(JSON.stringify(run.supplied)).toBe(run.suppliedJson);
  });

  it("omits the entire over-bound data payload rather than clipping it into an instruction", async () => {
    const oversized = `Retrieve ${topic} original text source evidence ${"independentbusiness ".repeat(80)}.`;
    const run = runQuery(topic, [oversized]);
    await run.result.text;
    expect(queryDescription(run.model)).toContain("omitted because the bounded description");
    expect(queryDescription(run.model)).not.toContain("independentbusiness");
    expect(run.search).not.toHaveBeenCalled();
  });

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

  it.each([
    "Find the CHN non-road emissions regulation original text and source as of 2026-08-13.",
    wrapped,
  ])("keeps the existing bilingual SSE request and actual model query intact: %s", async (userText) => {
    const run = runQuery(sourceQuery, [userText], { asOf: "2026-08-13" });
    const body = await run.result.toUIMessageStreamResponse().text();
    expect(body).toContain('"type":"tool-output-available"');
    expect(body).toContain(marker);
    expect(run.search).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      query: sourceQuery, asOf: "2026-08-13", applicationScope: "non-road", countryIso3: "CHN",
    }), { signal: expect.any(AbortSignal), deliveryCueRanking: true });
    expect(run.auditRepository.recordToolCall).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: "success" }));
  });

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
