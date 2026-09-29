import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { salesChatLiveCases } from "../evals/sales-chat-live-cases";
import {
  observeFailedPublicResponses,
  type FailedPublicResponseObserver,
} from "../scripts/ai/live-eval-diagnostics";
import {
  evaluateLiveEvalResponseContract,
  judgeLiveEvalCase,
  resolveLiveEvalResponseDisposition,
} from "@/domain/ai/live-eval";
import { aiToolResultSchema } from "@/features/ai/schemas";
import {
  buildSalesChatEvidenceContract,
  evidenceContractAllowsModelText,
} from "@/server/ai/evidence-contract";
import {
  createSalesChatTools,
  streamSalesChat,
  type SalesChatBoundaryRejectionReason,
} from "@/server/ai/sales-chat";
import { getDemoDatabase } from "@/server/db/demo-client";
import { getCountryDetails } from "@/server/services/country-service";

const testCase = (() => {
  const candidate = salesChatLiveCases.find(({ id }) => id === "country-overview-china");
  if (!candidate) throw new Error("Missing canonical country overview case");
  return candidate;
})();
const runtimeContext = {
  capturedAt: "2026-09-13T12:00:00.000Z",
  utcDate: "2026-09-13",
} as const;
const reportReceipt = {
  runId: "00000000-0000-4000-8000-000000000001",
  sha256: "a".repeat(64),
};
const hiddenReasoning = "PRIVATE_DIAGNOSTIC_REASONING_MARKER";
const hiddenToolMetadata = "PRIVATE_DIAGNOSTIC_TOOL_METADATA_MARKER";
const hiddenReasoningFile = Buffer.from("PRIVATE_DIAGNOSTIC_REASONING_FILE").toString("base64");
const blockedAnswer = "PRIVATE_BUFFERED_ANSWER_MARKER";
const usage = {
  inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 1, total: 1 },
  outputTokens: { reasoning: 0, text: 1, total: 1 },
} as const;
const originalDatabaseMode = process.env.DATABASE_MODE;

beforeAll(async () => {
  process.env.DATABASE_MODE = "pglite-demo";
  await getDemoDatabase();
}, 15_000);

afterAll(() => {
  if (originalDatabaseMode === undefined) delete process.env.DATABASE_MODE;
  else process.env.DATABASE_MODE = originalDatabaseMode;
});

function modelFor(answer: string) {
  return new MockLanguageModelV4({
    modelId: "public-diagnostic-boundary-mock",
    provider: "mock",
    doStream: [
      { stream: simulateReadableStream({ chunks: [
        { type: "stream-start", warnings: [] },
        {
          type: "tool-call", toolName: "getCountryProfile", toolCallId: "country-profile-call",
          input: JSON.stringify({ countryIso3: "CHN", topics: ["country"], asOf: "2026-08-13" }),
          providerMetadata: { mock: { privateValue: hiddenToolMetadata } },
        },
        { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage },
      ] }) },
      { stream: simulateReadableStream({ chunks: [
        { type: "stream-start", warnings: [] },
        { type: "reasoning-start", id: "private-reasoning" },
        { type: "reasoning-delta", id: "private-reasoning", delta: hiddenReasoning },
        { type: "reasoning-end", id: "private-reasoning" },
        { type: "reasoning-file", mediaType: "text/plain", data: { type: "data", data: hiddenReasoningFile } },
        { type: "text-start", id: "answer" },
        { type: "text-delta", id: "answer", delta: answer },
        { type: "text-end", id: "answer" },
        { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
      ] }) },
    ],
  });
}

// This composes the real public stream with the diagnostic projection. It is
// intentionally not a runLiveEval/report-persistence or provider integration.
async function observePublicStream(answer: string, noData = false) {
  const auditRepository = { recordToolCall: vi.fn(async () => undefined) };
  const sessionId = crypto.randomUUID();
  const boundaryRejections: SalesChatBoundaryRejectionReason[] = [];
  const model = modelFor(answer);
  const tools = createSalesChatTools({
    auditRepository, runtimeContext, selectedCountryIso3: null, sessionId,
    services: {
      getCountryDetails: noData
        ? async () => ({ iso3: "CHN", status: "no_data" as const })
        : getCountryDetails,
    },
  });
  const generated = streamSalesChat({
    auditRepository, locale: testCase.locale, model, runtimeContext,
    messages: testCase.userTexts.map((content) => ({ role: "user" as const, content })),
    onBoundaryRejection: (reason) => { boundaryRejections.push(reason); },
    selectedCountryIso3: null, sessionId, tools, trustedUserTexts: testCase.userTexts,
  });
  const publicChunks = (async () => {
    const chunks = [];
    for await (const chunk of generated.fullStream) chunks.push(chunk);
    return chunks;
  })();
  const [responseText, toolCalls, toolResults, chunks] = await Promise.all([
    generated.text, generated.toolCalls, generated.toolResults, publicChunks,
  ]);
  expect(model.doStreamCalls).toHaveLength(2);
  expect(toolCalls).toHaveLength(1);
  expect(toolCalls[0]?.input).toEqual({ countryIso3: "CHN", topics: ["country"], asOf: "2026-08-13" });
  expect(chunks.flatMap((chunk) => chunk.type === "text-delta" ? [chunk.text] : []).join("")).toBe(responseText);
  expect(chunks.some(({ type }) => type.startsWith("reasoning"))).toBe(false);
  const visible = JSON.stringify({ responseText, toolCalls, toolResults, chunks });
  for (const marker of [hiddenReasoning, hiddenReasoningFile, hiddenToolMetadata]) {
    expect(visible).not.toContain(marker);
  }

  const contract = buildSalesChatEvidenceContract({
    runtimeContext, selectedCountryIso3: null, userTexts: testCase.userTexts,
  });
  const evidenceAllowed = evidenceContractAllowsModelText(contract,
    toolResults.map(({ output }) => aiToolResultSchema.parse(output)));
  const errorCode = boundaryRejections.length > 0 ? "TOOL_RESULT_ERROR" : null;
  const responseDisposition = resolveLiveEvalResponseDisposition({ errorCode, responseText });
  const response = evaluateLiveEvalResponseContract({
    expectedLocale: testCase.locale, responseContract: testCase.responseContract, responseText,
  });
  const judgement = judgeLiveEvalCase({
    argsPassed: true, errorCode, evidenceAllowed,
    expectedEvidenceAllowed: testCase.expectedEvidenceAllowed,
    responseDisposition, responseGroundingPassed: response.responseGroundingPassed,
    responseLocalePassed: response.responseLocalePassed,
    safetyCritical: testCase.safetyCritical, tokenUsageComplete: true, toolSelectionPassed: true,
  });
  const observer = vi.fn<FailedPublicResponseObserver>(() => undefined);
  observeFailedPublicResponses({
    reportReceipt, observer,
    observations: [{
      boundaryRejections, id: testCase.id, responseText,
      streamCompleted: true, streamErrorObserved: false,
    }],
    results: [{
      ...response, ...judgement, errorCode, evidenceAllowed,
      expectedEvidenceAllowed: testCase.expectedEvidenceAllowed,
      id: testCase.id, locale: testCase.locale, responseCharacterCount: responseText.trim().length,
      responseDisposition, safetyCritical: testCase.safetyCritical, toolTraceStatus: "complete",
      argsPassed: true, toolSelectionPassed: true,
    }],
  });
  return { boundaryRejections, evidenceAllowed, judgement, observer, response, responseText };
}

describe("failed diagnostics consume only the actual public evidence-boundary text", () => {
  it("observes the exact public answer and verified date with a missing topic anchor, without hidden stream fields", async () => {
    const answer = "  CHN has documented national information.\n";
    const run = await observePublicStream(answer);
    expect(run.evidenceAllowed).toBe(true);
    expect(run.boundaryRejections).toEqual([]);
    expect(run.judgement.pass).toBe(false);
    expect(run.response.missingResponseAnchorIds).toEqual(["decision:country-overview"]);
    expect(run.observer).toHaveBeenCalledOnce();
    expect(run.responseText).toBe(`${answer}\n\nEvidence as-of date: 2026-08-13.`);
    expect(run.observer.mock.calls[0][0].responseText).toBe(run.responseText);
    expect(run.observer.mock.calls[0][0].missingResponseAnchorIds).toEqual(["decision:country-overview"]);
    for (const marker of [hiddenReasoning, hiddenReasoningFile, hiddenToolMetadata]) {
      expect(JSON.stringify(run.observer.mock.calls)).not.toContain(marker);
    }
  });

  it("does not observe buffered model text after the real no-data boundary replaces it", async () => {
    const run = await observePublicStream(blockedAnswer, true);
    expect(run.evidenceAllowed).toBe(false);
    expect(run.responseText).toContain("lacks enough evidence");
    expect(run.responseText).not.toContain(blockedAnswer);
    expect(run.observer).not.toHaveBeenCalled();
  });

  it("does not observe a reasoning-tainted answer even when the structured evidence is sufficient", async () => {
    const run = await observePublicStream(`<reasoning>${blockedAnswer}</reasoning> CHN country overview.`);
    expect(run.evidenceAllowed).toBe(true);
    expect(run.boundaryRejections).toContain("embedded_reasoning_markup");
    expect(run.responseText).toContain("The model explanation was withheld because it contained private reasoning markup.");
    expect(run.responseText).not.toContain(blockedAnswer);
    expect(run.observer).not.toHaveBeenCalled();
  });
});
