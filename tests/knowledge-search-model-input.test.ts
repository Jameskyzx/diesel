import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  salesChatKnowledgeSearchInputSchema,
  salesChatModelKnowledgeSearchInputSchema,
} from "@/features/ai/schemas";
import {
  hybridSearchQuerySchema,
  hybridSearchResponseSchema,
} from "@/features/knowledge/schemas";
import { createSalesChatTools, streamSalesChat } from "@/server/ai/sales-chat";

const runtimeContext = {
  capturedAt: "2026-09-11T12:00:00.000Z",
  utcDate: "2026-09-11",
} as const;
const topic = "CHN non-road Stage IV emission limits original text";
const request = `Retrieve ${topic} as of ${runtimeContext.utcDate}.`;
const validInput = {
  applicationScope: "non-road",
  asOf: runtimeContext.utcDate,
  countryIso3: "CHN",
  query: topic,
} as const;
const usage = {
  inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 1, total: 1 },
  outputTokens: { reasoning: 0, text: 1, total: 1 },
} as const;
const invalidKnobs = [
  { label: "small result count", fields: { limit: 1 } },
  { label: "legacy result count", fields: { limit: 8 } },
  { label: "jurisdiction UUID", fields: { jurisdictionId: "00000000-0000-4000-8000-000000000899" } },
  { label: "null jurisdiction", fields: { jurisdictionId: null } },
  { label: "both knobs", fields: { jurisdictionId: "00000000-0000-4000-8000-000000000899", limit: 8 } },
] as const;

function knowledgeModel(input: Readonly<Record<string, unknown>>, marker: string) {
  return new MockLanguageModelV3({
    doStream: [
      { stream: simulateReadableStream({ chunks: [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "tentative-answer" },
        { type: "text-delta", id: "tentative-answer", delta: marker },
        { type: "text-end", id: "tentative-answer" },
        { type: "tool-call", toolName: "searchKnowledgeBase", toolCallId: "knowledge-model-input",
          input: JSON.stringify(input) },
        { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage },
      ] }) },
      { stream: simulateReadableStream({ chunks: [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "answer" },
        { type: "text-delta", id: "answer", delta: marker },
        { type: "text-end", id: "answer" },
        { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
      ] }) },
    ],
    modelId: "knowledge-model-input-regression",
    provider: "mock",
  });
}

function modelRun(input: Readonly<Record<string, unknown>>, marker: string, userRequest: string | readonly string[] = request) {
  const trustedUserTexts = typeof userRequest === "string" ? [userRequest] : [...userRequest];
  const auditRepository = { recordToolCall: vi.fn(async () => undefined) };
  const hybridSearchKnowledge = vi.fn(async (input: unknown) => {
    const query = hybridSearchQuerySchema.parse(input);
    return hybridSearchResponseSchema.parse({
      embeddingModel: "local-hash-embedding-v1",
      filters: {
        applicationScope: query.applicationScope,
        asOf: query.asOf,
        countryIso3: query.countryIso3,
        jurisdictionId: query.jurisdictionId,
        limit: query.limit,
      },
      query: query.query,
      results: [],
      scoring: { keywordWeight: 0.5, vectorWeight: 0.5 },
      status: "ok",
    });
  });
  const sessionId = crypto.randomUUID();
  const model = knowledgeModel(input, marker);
  const onBoundaryRejection = vi.fn();
  const result = streamSalesChat({
    auditRepository,
    locale: "en",
    messages: trustedUserTexts.map((content) => ({ role: "user" as const, content })),
    model,
    onBoundaryRejection,
    runtimeContext,
    selectedCountryIso3: null,
    sessionId,
    tools: createSalesChatTools({
      auditRepository,
      runtimeContext,
      selectedCountryIso3: null,
      services: { hybridSearchKnowledge },
      sessionId,
    }),
    trustedUserTexts,
  });
  return { auditRepository, hybridSearchKnowledge, model, onBoundaryRejection, result };
}

describe("model-facing knowledge-search inputs expose only effective choices", () => {
  it("sends the narrow strict JSON schema through the actual SDK model call", async () => {
    const { model, result } = modelRun(validInput, "UNSUPPORTED_MODEL_ANSWER");
    await result.text;
    const knowledgeTool = model.doStreamCalls[0]?.tools?.find((tool) => tool.name === "searchKnowledgeBase");
    expect(knowledgeTool?.type).toBe("function");
    if (knowledgeTool?.type !== "function") throw new Error("Missing model-facing knowledge function");
    const schema = z.object({
      additionalProperties: z.literal(false),
      properties: z.record(z.string(), z.unknown()),
      required: z.array(z.string()),
      type: z.literal("object"),
    }).parse(knowledgeTool.inputSchema);
    expect(Object.keys(schema.properties).sort()).toEqual(["applicationScope", "asOf", "countryIso3", "query"]);
    expect(schema.required).toEqual(["applicationScope", "query"]);
    expect(schema.properties.applicationScope).toMatchObject({ type: "string", enum: ["non-road"] });
    expect(knowledgeTool.description).toContain("pass that exact applicationScope");
    expect(knowledgeTool.description).toContain("Correct missing filters without inventing different topics");
    expect(knowledgeTool.description).toContain("Do not append unrequested translations or synonyms");
    expect(knowledgeTool.description).toContain("ordinary keyword terms are combined with AND");
    expect(knowledgeTool.description).toContain("English, Chinese, or mixed-language terms the user actually supplied");
    expect(knowledgeTool.description).toContain("quoted phrases, OR branches and exclusions");
    expect(knowledgeTool.description).toContain("does not segment Chinese compounds");
    expect(knowledgeTool.description).toContain("Never delete user-supplied terms just to obtain a hit");
  });

  it.each([
    { label: "omitted", applicationScope: undefined },
    { label: "null", applicationScope: null },
    { label: "wrong", applicationScope: "marine" },
  ])("rejects $label explicit source scope before retrieval without filling or retrying it", async ({ applicationScope }) => {
    const { applicationScope: omittedScope, ...withoutScope } = validInput;
    expect(omittedScope).toBe("non-road");
    const input = { ...withoutScope, ...(applicationScope === undefined ? {} : { applicationScope }) };
    // Historical/general parsing stays optional; only the trusted current
    // source requirement narrows the model's actual SDK schema.
    expect(salesChatModelKnowledgeSearchInputSchema.safeParse(input).success).toBe(true);
    const { auditRepository, hybridSearchKnowledge, model, onBoundaryRejection, result } = modelRun(input, "UNSCOPED_SOURCE_CLAIM");
    const body = await result.toUIMessageStreamResponse({ sendReasoning: false }).text();
    expect(hybridSearchKnowledge).not.toHaveBeenCalled();
    expect(auditRepository.recordToolCall).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      status: "error", errorCode: "INVALID_TOOL_INPUT", toolName: "searchKnowledgeBase",
    }));
    expect(onBoundaryRejection).toHaveBeenCalledWith("invalid_input");
    expect(model.doStreamCalls).toHaveLength(1);
    expect(body).not.toContain("UNSCOPED_SOURCE_CLAIM");
  });

  it("does not invent a scope when the user only supplies an unscoped source topic", async () => {
    const { applicationScope: omittedScope, ...input } = { ...validInput, query: "CHN emissions regulations" };
    expect(omittedScope).toBe("non-road");
    const { hybridSearchKnowledge, model, result } = modelRun(input, "UNSCOPED_TOPIC",
      `Retrieve CHN emissions regulations original text as of ${runtimeContext.utcDate}.`);
    await result.text;
    const knowledgeTool = model.doStreamCalls[0]?.tools?.find(({ name }) => name === "searchKnowledgeBase");
    if (knowledgeTool?.type !== "function") throw new Error("Missing model-facing knowledge function");
    expect(knowledgeTool.inputSchema).toMatchObject({ required: ["query"] });
    expect(hybridSearchKnowledge).toHaveBeenCalledExactlyOnceWith(
      { ...input, applicationScope: null, jurisdictionId: null, limit: 5 }, { signal: expect.any(AbortSignal), deliveryCueRanking: true },
    );
  });

  it.each([
    { label: "Chinese explicit scope", scope: "non-road", texts: ["检索 CHN 非道路排放法规原文。"] },
    { label: "inherited scope after country change", scope: "non-road",
      texts: ["Retrieve BRA non-road emissions regulations source evidence.", "Now CHN."] },
    { label: "corrected scope", scope: "marine",
      texts: ["Retrieve CHN non-road emissions regulations source evidence.", "Actually use marine."] },
    { label: "scope correction followed by country change", scope: "non-road",
      texts: ["Retrieve BRA marine emissions regulations source evidence.", "Actually use non-road.", "Now CHN."] },
  ])("binds $label from resolved user context rather than the model query", async ({ scope, texts }) => {
    const input = { ...validInput, applicationScope: scope, query: `CHN ${scope} emissions regulations` };
    const { model, result } = modelRun(input, "SCOPED_SOURCE_CONTEXT", texts);
    await result.text;
    const knowledgeTool = model.doStreamCalls[0]?.tools?.find(({ name }) => name === "searchKnowledgeBase");
    if (knowledgeTool?.type !== "function") throw new Error("Missing model-facing knowledge function");
    expect(knowledgeTool.inputSchema).toMatchObject({
      properties: { applicationScope: { type: "string", enum: [scope] } },
      required: ["applicationScope", "query"],
    });
  });

  it.each([
    "Retrieve CHN non-road and marine emissions regulations original text.",
    "检索 CHN 非道路和船用排放法规原文。",
  ])("does not arbitrarily select a conflicting source scope: %s", async (userRequest) => {
    const { hybridSearchKnowledge, model, result } = modelRun(validInput, "CONFLICTING_SOURCE_SCOPE", userRequest);
    await result.text;
    expect(model.doStreamCalls[0]?.toolChoice).toEqual({ type: "none" });
    expect(model.doStreamCalls[0]?.tools).toBeUndefined();
    expect(hybridSearchKnowledge).not.toHaveBeenCalled();
  });

  it("retains the reasoning-query refinement on the dynamically narrowed scope schema", async () => {
    const queryMarker = "PRIVATE_SCOPED_QUERY_REASONING";
    const answerMarker = "UNSUPPORTED_SCOPED_REASONING_ANSWER";
    const { auditRepository, hybridSearchKnowledge, model, result } = modelRun({
      ...validInput, query: `${topic} <reasoning>${queryMarker}</reasoning>`,
    }, answerMarker);
    const body = await result.toUIMessageStreamResponse({ sendReasoning: false }).text();
    expect(hybridSearchKnowledge).not.toHaveBeenCalled();
    expect(model.doStreamCalls).toHaveLength(1);
    expect(auditRepository.recordToolCall).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      status: "error", errorCode: "INVALID_TOOL_INPUT", toolName: "searchKnowledgeBase",
    }));
    for (const serialized of [body, JSON.stringify(auditRepository.recordToolCall.mock.calls)]) {
      expect(serialized).not.toContain(queryMarker);
      expect(serialized).not.toContain(answerMarker);
    }
  });

  it.each([
    "CHN non-road emissions regulations",
    "CHN 非道路排放法规",
    "CHN non-road emissions regulations 非道路 排放",
  ])("preserves the user's query language without adding or removing terms: %s", async (query) => {
    const input = { ...validInput, query };
    const userRequest = `Retrieve original text and source evidence for ${query} as of ${runtimeContext.utcDate}.`;
    const { hybridSearchKnowledge, result } = modelRun(input, "UNSUPPORTED_QUERY_REWRITE", userRequest);
    await result.text;
    expect(hybridSearchKnowledge).toHaveBeenCalledExactlyOnceWith(
      { ...input, jurisdictionId: null, limit: 5 },
      { signal: expect.any(AbortSignal), deliveryCueRanking: true },
    );
  });

  it.each(invalidKnobs)("keeps historical parsing separate from the model's $label", ({ fields }) => {
    const input = { ...validInput, ...fields };
    expect(salesChatKnowledgeSearchInputSchema.parse(input)).toEqual(input);
    expect(salesChatModelKnowledgeSearchInputSchema.safeParse(input).success).toBe(false);
  });

  it.each(invalidKnobs)("rejects model $label before retrieval and redacts both public streams", async ({ fields }) => {
    const inputMarker = "PRIVATE_REJECTED_KNOWLEDGE_QUERY";
    const answerMarker = "UNVERIFIED_KNOWLEDGE_KNOB_ANSWER";
    const run = modelRun({ ...validInput, ...fields, query: `${topic} ${inputMarker}` }, answerMarker);
    const chunks = [];
    const sse = run.result.toUIMessageStreamResponse({ sendReasoning: false }).text();
    for await (const chunk of run.result.fullStream) chunks.push(chunk);
    const publicSse = await sse;
    expect(run.hybridSearchKnowledge).not.toHaveBeenCalled();
    expect(run.auditRepository.recordToolCall).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      errorCode: "INVALID_TOOL_INPUT",
      status: "error",
      toolName: "searchKnowledgeBase",
    }));
    expect(run.onBoundaryRejection).toHaveBeenCalledWith("invalid_input");
    for (const serialized of [JSON.stringify(chunks), publicSse, JSON.stringify(run.auditRepository.recordToolCall.mock.calls)]) {
      expect(serialized).not.toContain(inputMarker);
      expect(serialized).not.toContain(answerMarker);
    }
    expect(publicSse).toContain("evidence");
  });

  it("executes a normal authorized model call once using the fixed server count and jurisdiction", async () => {
    const { auditRepository, hybridSearchKnowledge, onBoundaryRejection, result } = modelRun(validInput, "UNSUPPORTED_MODEL_ANSWER");
    await result.text;
    expect(hybridSearchKnowledge).toHaveBeenCalledExactlyOnceWith(
      { ...validInput, jurisdictionId: null, limit: 5 },
      { signal: expect.any(AbortSignal), deliveryCueRanking: true },
    );
    expect(auditRepository.recordToolCall).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: "no_data" }));
    expect(onBoundaryRejection).not.toHaveBeenCalledWith("invalid_input");
  });

  it.each([
    ["historical", salesChatKnowledgeSearchInputSchema],
    ["model-facing", salesChatModelKnowledgeSearchInputSchema],
  ] as const)(
    "keeps the reasoning-query guard on the %s schema", (_label, schema) => {
      expect(schema.safeParse({ ...validInput, query: `${topic} <reasoning>PRIVATE_REASONING</reasoning>` }).success).toBe(false);
    },
  );
});
