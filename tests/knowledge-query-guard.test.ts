import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { tokenizeKnowledgeText } from "@/domain/knowledge/embedding";

import { createSalesChatTools, streamSalesChat } from "@/server/ai/sales-chat";
import { getDemoDatabase } from "@/server/db/demo-client";
import { hybridSearchKnowledge, knowledgeQueryConstraintsMatch } from "@/server/services/knowledge-service";

const originalDatabaseMode = process.env.DATABASE_MODE;
const topic = "CHN non-road emissions regulations original text sections source evidence";
let highOverlapTopic = "";
const usage = {
  inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 1, total: 1 },
  outputTokens: { reasoning: 0, text: 1, total: 1 },
};

beforeAll(async () => {
  process.env.DATABASE_MODE = "pglite-demo";
  await getDemoDatabase();
  const source = await hybridSearchKnowledge({ query: topic, countryIso3: "CHN", applicationScope: "non-road",
    asOf: "2026-08-20", jurisdictionId: null, limit: 5 });
  const content = source.results[0]?.content;
  if (!content) throw new Error("Missing existing source");
  highOverlapTopic = `CHN non-road ${tokenizeKnowledgeText(content.split("中国")[0]!).filter((word) => word !== "or").join(" ")}`;
}, 15_000);
afterAll(() => {
  if (originalDatabaseMode === undefined) delete process.env.DATABASE_MODE;
  else process.env.DATABASE_MODE = originalDatabaseMode;
});

function modelFor(query: string, marker: string, asOf?: string) {
  return new MockLanguageModelV3({
    doStream: [{ stream: simulateReadableStream({ chunks: [
      { type: "stream-start", warnings: [] },
      { type: "tool-call", toolName: "searchKnowledgeBase", toolCallId: "native-query-call", input: JSON.stringify({
        applicationScope: "non-road", countryIso3: "CHN", query, ...(asOf === undefined ? {} : { asOf }),
      }) },
      { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage },
    ] }) }, { stream: simulateReadableStream({ chunks: [
      { type: "stream-start", warnings: [] },
      { type: "text-start", id: "answer" },
      { type: "text-delta", id: "answer", delta: marker },
      { type: "text-end", id: "answer" },
      { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
    ] }) }],
  });
}

function guardedRun(expected: string | string[], actual: string, marker: string, asOf?: string) {
  const auditRepository = { recordToolCall: vi.fn(async () => undefined) };
  const search = vi.fn(hybridSearchKnowledge);
  const sessionId = crypto.randomUUID();
  const tools = createSalesChatTools({ auditRepository, selectedCountryIso3: null, sessionId,
    services: { hybridSearchKnowledge: search } });
  const trustedUserTexts = typeof expected === "string" ? [`Retrieve ${expected}`] : expected;
  const model = modelFor(actual, marker, asOf);
  const result = streamSalesChat({ auditRepository, locale: "en", sessionId, selectedCountryIso3: null,
    messages: trustedUserTexts.map((content) => ({ role: "user" as const, content })),
    trustedUserTexts, tools, model });
  return { result, search, auditRepository, model };
}

describe("production stream native knowledge-query guard", () => {
  it.each([
    { label: "English request", query: "non-road emissions regulations",
      requests: ["Retrieve the original text, sections, and source evidence for CHN non-road emissions regulations as of 2026-08-20."] },
    { label: "Chinese request", query: "CHN 非道路排放法规",
      requests: ["检索 CHN 非道路排放法规原文、章节和来源证据，截至 2026-08-20。"] },
    { label: "inherited corrected scope and country", query: "CHN non-road emissions regulations",
      requests: ["Retrieve BRA marine emissions regulations original text as of 2026-08-20.", "Actually use non-road.", "Now CHN."] },
  ])("stops source expansion immediately after scoped evidence for $label", async ({ query, requests }) => {
    const marker = "COMPLETE_SCOPED_SOURCE_ANSWER";
    const { result, search, model } = guardedRun(requests, query, marker, "2026-08-20");
    const body = await result.toUIMessageStreamResponse({ sendReasoning: false }).text();
    expect(search).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      applicationScope: "non-road", countryIso3: "CHN", asOf: "2026-08-20", query,
    }), { signal: expect.any(AbortSignal), deliveryCueRanking: true });
    expect(model.doStreamCalls).toHaveLength(2);
    expect(model.doStreamCalls[0]?.toolChoice).toEqual({ type: "required" });
    expect(model.doStreamCalls[1]?.toolChoice).toEqual({ type: "none" });
    expect(model.doStreamCalls[1]?.tools).toBeUndefined();
    expect(body).toContain(marker);
    expect(body).toContain("DEMO-SECTION-1");
  });

  it.each(["original text", "sections", "source evidence"])("emits supported SSE prose when only the delivery cue %s is omitted", async (omitted) => {
    const marker = "DELIVERED_SOURCE_ANSWER";
    const query = topic.replace(omitted, "");
    const { result, search } = guardedRun([`Retrieve ${topic} as of 2026-08-20.`], query, marker, "2026-08-20");
    const body = await result.toUIMessageStreamResponse().text();
    expect(search).toHaveBeenCalledTimes(1);
    expect(body).toContain(marker);
  });

  it.each([["page 1", true], ["page 2", false], ["section 1", true], ["section 2", false]] as const)("validates delivered %s before releasing final SSE text", async (locator, allowed) => {
    const query = `${highOverlapTopic} ${locator}`;
    const marker = "REQUESTED_SOURCE_LOCATION_ANSWER";
    const { result, search, auditRepository } = guardedRun([`Retrieve ${query} as of 2026-08-20.`], query, marker, "2026-08-20");
    const body = await result.toUIMessageStreamResponse().text();
    expect(search).toHaveBeenCalledTimes(1);
    expect(auditRepository.recordToolCall).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: "success" }));
    expect(body.includes(marker)).toBe(allowed);
    if (!allowed) expect(body).toContain("This request lacks enough evidence");
  });

  it("does not let delivery-cue omission discard an explicitly quoted section word", async () => {
    const marker = "MISSING_LITERAL_SECTION_ANSWER";
    const expected = `${topic} "section"`;
    const { result } = guardedRun([`Retrieve ${expected} as of 2026-08-20.`], "CHN non-road emissions regulations", marker, "2026-08-20");
    const body = await result.toUIMessageStreamResponse().text();
    expect(body).not.toContain(marker);
  });

  it.each([
    ["Continue", ",as of 2026-08-21.", ",as"],
    ["继续", "，截至 2026-08-21。", "，截至"],
  ])("rejects a date-contaminated %s refinement before retrieval", async (prefix, dateClause, poisonedSuffix) => {
    const turns = [`Retrieve ${topic} as of 2026-08-20.`, `${prefix} -fictional${dateClause}`];
    const marker = "DATE_CONTAMINATED_SOURCE_ANSWER";
    const { result, search, auditRepository } = guardedRun(turns, `${topic} -fictional${poisonedSuffix}`, marker, "2026-08-21");
    const body = await result.toUIMessageStreamResponse().text();
    expect(search).not.toHaveBeenCalled();
    expect(auditRepository.recordToolCall).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      errorCode: "KnowledgeQueryConstraintMismatchError", status: "error",
    }));
    expect(body).not.toContain(marker);
    expect(body).toContain("evidence");
  });

  it.each([
    ["Continue", ",as of 2026-08-21."],
    ["继续", "，截至 2026-08-21。"],
  ])("accepts only actual evidence for an unaltered dated %s refinement", async (prefix, dateClause) => {
    for (const [operand, supported] of [["-fictional", false], ["-China", true]] as const) {
      const turns = [`Retrieve ${topic} as of 2026-08-20.`, `${prefix} ${operand}${dateClause}`];
      const marker = "DATED_SOURCE_ANSWER";
      const query = `${topic} ${operand}`;
      const { result, search } = guardedRun(turns, query, marker, "2026-08-21");
      const body = await result.toUIMessageStreamResponse().text();
      expect(search).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ query, asOf: "2026-08-21" }), { signal: expect.any(AbortSignal), deliveryCueRanking: true });
      expect(body.includes(marker)).toBe(supported);
      if (!supported) expect(body).toContain("evidence");
    }
  });

  it.each([
    ["exclusion removed", `${topic} -fictional`, `${topic} fictional`],
    ["Chinese delivery connective quotation removed", `${topic} 章节和来源证据 "和"`, `${topic} 章节和来源证据 和`],
    ["Chinese delivery connective exclusion removed", `${topic} 章节和来源证据 -和`, `${topic} 章节和来源证据 和`],
    ["exclusion parity", `${topic} -fictional`, `${topic} --fictional`],
    ["phrase reordered", `${topic} "source evidence"`, `${topic} "evidence source"`],
    ["phrase unquoted", `${topic} "source evidence"`, `${topic} source evidence`],
    ["literal country canonicalized", `${topic} "China non-road"`, `${topic} "CHN non-road"`],
    ["signed country canonicalized", `${topic} -China`, `${topic} -CHN`],
    ["OR branch changed", `${topic} OR warranty -fictional`, `${topic} -fictional OR warranty`],
  ])("rejects %s before retrieval and audits once", async (_label, expected, actual) => {
    const marker = "UNVERIFIED_NATIVE_QUERY_ANSWER";
    const { result, search, auditRepository } = guardedRun(expected, actual, marker);
    const chunks = [];
    for await (const chunk of result.fullStream) chunks.push(chunk);
    expect(search).not.toHaveBeenCalled();
    expect(auditRepository.recordToolCall).toHaveBeenCalledTimes(1);
    expect(auditRepository.recordToolCall).toHaveBeenCalledWith(expect.objectContaining({
      errorCode: "KnowledgeQueryConstraintMismatchError", status: "error", toolName: "searchKnowledgeBase",
    }));
    expect(JSON.stringify(chunks)).not.toContain(marker);
    expect(chunks.filter((chunk) => chunk.type === "text-delta").map((chunk) => chunk.text).join("")).toMatch(/evidence/iu);
  });

  it("also suppresses rejected-query prose in the public SSE serialization", async () => {
    const marker = "UNVERIFIED_NATIVE_QUERY_SSE";
    const { result, search } = guardedRun(`${topic} -fictional`, `${topic} fictional`, marker);
    const body = await result.toUIMessageStreamResponse().text();
    expect(search).not.toHaveBeenCalled();
    expect(body).not.toContain(marker);
    expect(body).toMatch(/evidence/iu);
  });

  it("allows equivalent exclusions without altering the tool query echo", async () => {
    const expected = `${topic} -warranty -unicorn`;
    const actual = `${topic} - unicorn -warranty`;
    const { result, search, auditRepository } = guardedRun(expected, actual, "SUPPORTED_SOURCE_ANSWER");
    for await (const chunk of result.fullStream) void chunk;
    expect(search).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ query: actual }), { signal: expect.any(AbortSignal), deliveryCueRanking: true });
    expect(auditRepository.recordToolCall).toHaveBeenCalledTimes(1);
    expect(auditRepository.recordToolCall).toHaveBeenCalledWith(expect.objectContaining({ errorCode: null, status: "success" }));
  });

  it("allows an unchanged literal phrase that actually matches the existing source", async () => {
    const query = `${topic} "CHN non-road"`;
    const marker = "SUPPORTED_LITERAL_SOURCE_ANSWER";
    const { result, search, auditRepository } = guardedRun(query, query, marker);
    const chunks = [];
    for await (const chunk of result.fullStream) chunks.push(chunk);
    expect(search).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ query }), { signal: expect.any(AbortSignal), deliveryCueRanking: true });
    expect(auditRepository.recordToolCall).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ errorCode: null, status: "success" }));
    expect(chunks.filter((chunk) => chunk.type === "text-delta").map((chunk) => chunk.text).join("")).toContain(marker);
  });

  it.each(["-China", "-BRA", "--CHN"])("accepts supported evidence without rewriting %s or adding country requirements", async (operand) => {
    const query = `${topic} ${operand}`;
    const marker = "SUPPORTED_SIGNED_QUERY_ANSWER";
    const { result, search } = guardedRun(query, query, marker);
    const body = await result.toUIMessageStreamResponse().text();
    expect(search).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ query, countryIso3: "CHN" }), { signal: expect.any(AbortSignal), deliveryCueRanking: true });
    expect(body).toContain(marker);
    expect(body).toContain(operand);
  });

  it("rejects a double-signed alias change at the complete query-term boundary", async () => {
    const marker = "UNSUPPORTED_DOUBLE_SIGN_ALIAS";
    const { result, search, auditRepository } = guardedRun(`${topic} --China`, `${topic} --CHN`, marker);
    const body = await result.toUIMessageStreamResponse().text();
    // Even parity is a native positive term, so the hard-constraint guard
    // alone cannot reject this change. The unchanged complete topic check now
    // runs before retrieval rather than waiting for the final evidence gate.
    expect(search).not.toHaveBeenCalled();
    expect(auditRepository.recordToolCall).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      errorCode: "KnowledgeQueryBusinessMismatchError", status: "error",
    }));
    expect(body).not.toContain(marker);
    expect(body).toContain("evidence");
  });

  it("validates external comparison inputs and cancellation before the equality fast path", async () => {
    await expect(knowledgeQueryConstraintsMatch({ expected: "", actual: "" })).rejects.toThrow();
    await expect(knowledgeQueryConstraintsMatch({ expected: "source", actual: "source", extra: true })).rejects.toThrow();
    const controller = new AbortController(); controller.abort();
    await expect(knowledgeQueryConstraintsMatch({ expected: "source", actual: "source" }, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});
