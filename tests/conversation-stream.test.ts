import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureChatRuntimeContext } from "@/domain/ai/chat-runtime-context";
import { prepareConversationPlan } from "@/server/ai/conversation-plan";
import { conversationAnswerMatchesFacts } from "@/server/ai/conversation-answer";
import { createSalesChatTools, streamSalesChat } from "@/server/ai/sales-chat";
import { getDemoDatabase } from "@/server/db/demo-client";
import { knowledgeSearchSuggestion } from "@/server/ai/knowledge-request-context";
import type { ConversationState } from "@/features/ai/conversation-state";

const runtimeContext = captureChatRuntimeContext(new Date("2026-08-20T00:00:00.000Z"));
const state: ConversationState = { tasks: ["regulations"], countryIso3s: ["CHN", "BRA"], applicationScope: "non-road", powerKw: 100, asOf: "2026-08-20", productModelCode: null };
const query = "Compare CHN and BRA non-road 100 kW regulations as of 2026-08-20.";
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
const originalMode = process.env.DATABASE_MODE;
let database: Awaited<ReturnType<typeof getDemoDatabase>>;
beforeAll(async () => { process.env.DATABASE_MODE = "pglite-demo"; database = await getDemoDatabase(); }, 15_000);
afterAll(async () => { if (originalMode === undefined) delete process.env.DATABASE_MODE; else process.env.DATABASE_MODE = originalMode; await database?.$client.close(); });

function answeringModel(answer: string, compare = true) {
  return new MockLanguageModelV4({ doStream: [
    ...(compare ? [{ stream: simulateReadableStream({ chunks: [
      { type: "stream-start" as const, warnings: [] },
      { type: "tool-call" as const, toolCallId: "comparison", toolName: "compareRegulations", input: JSON.stringify({ countryIso3s: ["CHN", "BRA"], applicationScope: "non-road", powerKw: 100, asOf: "2026-08-20" }) },
      { type: "finish" as const, finishReason: { unified: "tool-calls" as const, raw: undefined }, usage },
    ] }) }] : []),
    { stream: simulateReadableStream({ chunks: [
      { type: "stream-start", warnings: [] },
      { type: "reasoning-start", id: "private" }, { type: "reasoning-delta", id: "private", delta: "PRIVATE_CHAIN_MARKER" }, { type: "reasoning-end", id: "private" },
      { type: "text-start", id: "answer" }, { type: "text-delta", id: "answer", delta: answer }, { type: "text-end", id: "answer" },
      { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
    ] }) },
  ] });
}
function execute(answer: string, mode: "compose" | "explain" | "general", userTexts = [query, "Write a short customer message about those results."]) {
  const model = answeringModel(answer, mode !== "general");
  const conversationTurn = prepareConversationPlan({ plan: { mode, state: mode === "general" ? { ...state, tasks: [] } : state },
    userTexts, previous: null, selectedCountryIso3: null, runtimeContext });
  const sessionId = crypto.randomUUID();
  const auditRepository = { recordToolCall: async () => undefined };
  const stream = streamSalesChat({ conversationTurn, model, runtimeContext, maxSteps: 4,
    messages: userTexts.map(content => ({ role: "user", content })), trustedUserTexts: userTexts,
    selectedCountryIso3: null, sessionId, auditRepository,
    tools: createSalesChatTools({ auditRepository, sessionId, selectedCountryIso3: null, defaultAsOf: "2026-08-20" }),
  });
  return { model, stream };
}

describe("conversational prose still crosses the production evidence boundary", () => {
  it.each(["research", "explain"] as const)("continues independent comparisons after source no-data; %s publishes only a qualified partial answer", async mode => {
    const question = `${query} Also find the original unindexed inspection dossier sources.`;
    const conversationTurn = prepareConversationPlan({ plan: { mode, state: { ...state, tasks: ["regulations", "knowledge"] } },
      userTexts: [question], previous: null, selectedCountryIso3: null, runtimeContext });
    const sourceCalls = conversationTurn.contract.requirements.filter(requirement => requirement.acceptedTools.includes("searchKnowledgeBase")).map(({ query: q }, index) => ({
      type: "tool-call" as const, toolCallId: `source-${index}`, toolName: "searchKnowledgeBase", input: JSON.stringify({
        countryIso3: q.countryIso3s?.[0], applicationScope: q.applicationScope, asOf: q.asOf,
        query: knowledgeSearchSuggestion(q.knowledgeQuery!, q.knowledgeTerms ?? [], q.knowledgeOptionalTerms),
      }),
    }));
    const model = answeringModel("UNSUPPORTED_MODEL_CONCLUSION");
    const modelWithSources = new MockLanguageModelV4({ doStream: async options => {
      if (modelWithSources.doStreamCalls.length === 1) return { stream: simulateReadableStream({ chunks: [
        { type: "stream-start", warnings: [] }, ...sourceCalls,
        { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage },
      ] }) };
      return model.doStream(options);
    } });
    const sessionId = crypto.randomUUID();
    const auditRepository = { recordToolCall: async () => undefined };
    const stream = streamSalesChat({ conversationTurn, model: modelWithSources, runtimeContext, maxSteps: 4,
      messages: [{ role: "user", content: question }], trustedUserTexts: [question], selectedCountryIso3: null, sessionId, auditRepository,
      tools: createSalesChatTools({ auditRepository, sessionId, selectedCountryIso3: null, defaultAsOf: state.asOf! }),
    });
    const text = await stream.text;
    const results = await stream.toolResults;
    expect(results.filter(result => result.toolName === "searchKnowledgeBase").map(result => result.output.status)).toEqual(["no_data", "no_data"]);
    expect(results.find(result => result.toolName === "compareRegulations")?.output.status).toBe("ok");
    expect(text).toContain("Some requested evidence is still missing");
    if (mode === "research") expect(text).toContain("NOX");
    else expect(text).not.toContain("Regulatory comparison:");
    expect(text).not.toContain("UNSUPPORTED_MODEL_CONCLUSION");
    expect(modelWithSources.doStreamCalls[1]?.tools?.map(tool => "name" in tool ? tool.name : "")).toEqual(["compareRegulations"]);
  });
  it.each(["compose", "explain"] as const)("does not overwrite %s with the standard comparison template", async mode => {
    const answer = "Dear customer, the recorded requirements are in the cards. Test cycles were not returned, so this is not a sales approval. Please obtain the applicable certification evidence.";
    const { stream, model } = execute(answer, mode);
    const sse = await stream.toUIMessageStreamResponse({ sendReasoning: true }).text();
    expect(sse).toContain(answer);
    expect(sse).not.toContain("PRIVATE_CHAIN_MARKER");
    expect(sse).not.toContain("the effective records have equal numeric values");
    expect(model.doStreamCalls).toHaveLength(2);
    expect(await stream.toolResults).toHaveLength(1);
  });
  it("withholds invented quantities in a requested rewrite", async () => {
    const { stream } = execute("These engines meet the 999.95 g/kWh limit and are legally sold.", "compose");
    const text = await stream.text;
    expect(text).not.toContain("999.95");
    expect(text).toContain("withheld");
    expect(await stream.toolResults).toHaveLength(1);
  });
  it("does not turn a general concept response into country-specific facts", async () => {
    const { stream } = execute("China permits all these engines without certification.", "general", [query, "What does NOx mean?"]);
    expect(await stream.text).not.toContain("permits all");
  });
  it("allows a concept explanation without falsely reporting missing database evidence", async () => {
    const answer = "NOx is a collective name for nitrogen oxides, including NO and NO2. It describes pollutants, not a product approval.";
    const { stream } = execute(answer, "general", [query, "What does NOx mean?"]);
    expect(await stream.text).toBe(answer);
    expect(await stream.toolResults).toHaveLength(0);
  });
  it("does not treat the prose guard as an arbitrary semantic proof", () => {
    expect(conversationAnswerMatchesFacts("Country A is stricter.", [])).toBe(false);
    expect(conversationAnswerMatchesFacts("We cannot say which is stricter.", [])).toBe(true);
    expect(conversationAnswerMatchesFacts("The test cycles differ.", [])).toBe(false);
  });
});
