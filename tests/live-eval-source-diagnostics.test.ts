import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { salesChatLiveCases } from "../evals/sales-chat-live-cases";
import {
  formatFailedSourceEvidenceDiagnostic,
  observeFailedSourceEvidence,
  type FailedSourceEvidenceDiagnostic,
  type FailedSourceEvidenceObserver,
} from "../scripts/ai/live-eval-source-diagnostics";
import { searchKnowledgeBaseResultSchema, type SearchKnowledgeBaseResult } from "../src/features/ai/schemas";
import { createSalesChatTools } from "../src/server/ai/sales-chat";
import { getDemoDatabase } from "../src/server/db/demo-client";

const testCase = salesChatLiveCases.find(({ id }) => id === "source-document-retrieval")!;
const reportReceipt = { runId: "00000000-0000-4000-8000-000000000001", sha256: "a".repeat(64) };
const originalDatabaseMode = process.env.DATABASE_MODE;
let database: Awaited<ReturnType<typeof getDemoDatabase>>;
let found: SearchKnowledgeBaseResult;
let noData: SearchKnowledgeBaseResult;

beforeAll(async () => {
  process.env.DATABASE_MODE = "pglite-demo";
  database = await getDemoDatabase();
  const tools = createSalesChatTools({
    auditRepository: { recordToolCall: async () => undefined },
    selectedCountryIso3: null,
    sessionId: crypto.randomUUID(),
  });
  const execute = tools.searchKnowledgeBase.execute;
  if (!execute) throw new Error("Missing source tool");
  const search = async (query: string) => searchKnowledgeBaseResultSchema.parse(await execute({
    applicationScope: "non-road", asOf: "2026-09-13", countryIso3: "CHN", query,
  }, { context: undefined as never, messages: [], toolCallId: crypto.randomUUID() }));
  found = await search("CHN non-road emissions regulations");
  noData = await search("ZZZ_PRIVATE_DIAGNOSTIC_QUERY_99777");
  expect(found.status).toBe("ok");
  expect(found.search.results).toHaveLength(1);
  expect(noData.status).toBe("no_data");
}, 15_000);

afterAll(async () => {
  if (originalDatabaseMode === undefined) delete process.env.DATABASE_MODE;
  else process.env.DATABASE_MODE = originalDatabaseMode;
  await database?.$client.close();
});

function step(output: unknown, toolCallId = "PRIVATE_TOOL_CALL_ID") {
  return {
    metric: { reasoning: "PRIVATE_REASONING" },
    toolCalls: [{
      dynamic: false, input: { query: "PRIVATE_MODEL_QUERY" }, invalid: false,
      toolCallId, toolName: "searchKnowledgeBase",
    }],
    toolResults: [{ output, toolCallId, toolName: "searchKnowledgeBase" }],
  };
}

function fixture(output: unknown = noData) {
  return {
    observations: [{
      boundaryRejections: [], id: testCase.id,
      responseText: "PRIVATE_BOUNDARY_DENIED_RESPONSE", streamCompleted: true,
      streamErrorObserved: false, steps: [step(output)],
    }] as Array<Record<string, unknown>>,
    reportReceipt,
    results: [{
      errorCode: null, evidenceAllowed: false, expectedEvidenceAllowed: true,
      id: testCase.id, loopSteps: 1, pass: false, safetyCritical: false,
      toolSequence: ["searchKnowledgeBase"], toolTraceStatus: "complete",
      normalizedArgs: [{ query: "PRIVATE_REPORT_QUERY" }],
    }] as Array<Record<string, unknown>>,
  };
}

function observe(input = fixture()) {
  const observer = vi.fn<FailedSourceEvidenceObserver>(() => undefined);
  observeFailedSourceEvidence({ ...input, observer });
  return observer;
}

describe("same-run failed source evidence diagnostics", () => {
  it("projects a real no-data tool result into only immutable enums and counts", () => {
    const input = fixture();
    Object.defineProperty(input.observations[0], "responseText", {
      get: () => { throw new Error("Must not inspect denied text"); },
    });
    const diagnostic = observe(input).mock.calls[0][0];
    expect(diagnostic).toEqual({
      caseId: testCase.id, reportSha256: reportReceipt.sha256, runId: reportReceipt.runId,
      results: [{
        citationCount: 0, evidenceSufficient: false, ordinal: 0, searchResultCount: 0,
        status: "no_data", unknownWarningCount: 0, warningCodes: ["insufficient_evidence"],
      }],
      statusCounts: { error: 0, no_data: 1, ok: 0 },
    });
    expect(Object.isFrozen(diagnostic)).toBe(true);
    expect(Object.isFrozen(diagnostic.results)).toBe(true);
    expect(Object.isFrozen(diagnostic.results[0])).toBe(true);
    expect(Object.isFrozen(diagnostic.results[0].warningCodes)).toBe(true);
    expect(Object.isFrozen(diagnostic.statusCounts)).toBe(true);
    expect(JSON.stringify(diagnostic)).not.toContain("PRIVATE");
  });

  it("reports real returned evidence without replacing the report's denied judgement", () => {
    // A valid source result can still fail the request-specific evidence gate.
    // The observer describes this output; it must not try to rescore that gate.
    const input = fixture(found);
    const before = JSON.stringify(input);
    const observer = observe(input);
    expect(observer).toHaveBeenCalledTimes(1);
    expect(observer.mock.calls[0][0].results).toEqual([{
      citationCount: 1, evidenceSufficient: true, ordinal: 0, searchResultCount: 1,
      status: "ok", unknownWarningCount: 0, warningCodes: ["demo_data"],
    }]);
    expect(observer.mock.calls[0][0].statusCounts).toEqual({ error: 0, no_data: 0, ok: 1 });
    const line = formatFailedSourceEvidenceDiagnostic(observer.mock.calls[0][0]);
    expect(line).not.toContain(found.search.query);
    for (const citation of found.citations) {
      expect(line).not.toContain(citation.sourceTitle);
      expect(line).not.toContain(citation.title);
      if (citation.locator) expect(line).not.toContain(citation.locator);
    }
    expect(JSON.stringify(input)).toBe(before);
  });

  it("binds unique tool results to their calls and counts each status in call order", () => {
    const input = fixture();
    input.observations[0].steps = [step(found, "first"), step(noData, "second")];
    input.results[0].loopSteps = 2;
    input.results[0].toolSequence = ["searchKnowledgeBase", "searchKnowledgeBase"];
    const diagnostic = observe(input).mock.calls[0][0];
    expect(diagnostic.results.map(({ ordinal, status }) => ({ ordinal, status }))).toEqual([
      { ordinal: 0, status: "ok" }, { ordinal: 1, status: "no_data" },
    ]);
    expect(diagnostic.statusCounts).toEqual({ error: 0, no_data: 1, ok: 1 });
  });

  it.each([
    ["pass", true], ["expectedEvidenceAllowed", false], ["evidenceAllowed", true],
    ["safetyCritical", true], ["errorCode", "EVAL_CASE_ERROR"],
    ["errorCode", "EVAL_BUDGET_STOP"], ["errorCode", "TOOL_RESULT_ERROR"],
    ["toolTraceStatus", "unavailable"], ["loopSteps", 0], ["loopSteps", 2],
    ["toolSequence", []], ["toolSequence", ["getCountryProfile"]],
  ])("excludes report %s=%j", (field, value) => {
    const input = fixture();
    input.results[0][field] = value;
    expect(observe(input)).not.toHaveBeenCalled();
  });

  it.each([
    ["boundaryRejections", ["invalid_input"]], ["streamCompleted", false],
    ["streamErrorObserved", true], ["steps", []], ["id", "unknown-case"],
  ])("excludes observation %s=%j", (field, value) => {
    const input = fixture();
    input.observations[0][field] = value;
    expect(observe(input)).not.toHaveBeenCalled();
  });

  it.each(["country-profile", "retrieved-prompt-injection-is-data", "irrelevant-source-query-fails-closed"])(
    "cannot relabel canonical %s as an expected-allow source case", (id) => {
      const input = fixture();
      input.results[0].id = id;
      input.observations[0].id = id;
      expect(observe(input)).not.toHaveBeenCalled();
    },
  );

  it.each([
    { name: "duplicate calls", mutate: (value: ReturnType<typeof step>) => value.toolCalls.push(value.toolCalls[0]) },
    { name: "duplicate results", mutate: (value: ReturnType<typeof step>) => value.toolResults.push(value.toolResults[0]) },
    { name: "unpaired result", mutate: (value: ReturnType<typeof step>) => { value.toolResults[0].toolCallId = "different"; } },
    { name: "invalid call", mutate: (value: ReturnType<typeof step>) => { value.toolCalls[0].invalid = true; } },
    { name: "dynamic call", mutate: (value: ReturnType<typeof step>) => { value.toolCalls[0].dynamic = true; } },
    { name: "wrong tool", mutate: (value: ReturnType<typeof step>) => { value.toolResults[0].toolName = "getCountryProfile"; } },
    { name: "missing output", mutate: (value: ReturnType<typeof step>) => { value.toolResults[0].output = undefined; } },
  ])("excludes an incomplete or invalid trace: $name", ({ mutate }) => {
    const input = fixture();
    const value = step(noData);
    mutate(value);
    input.observations[0].steps = [value];
    expect(observe(input)).not.toHaveBeenCalled();
  });

  it.each([
    (output: SearchKnowledgeBaseResult) => { output.evidenceSufficient = true; },
    (output: SearchKnowledgeBaseResult) => { output.status = "ok"; },
    (output: SearchKnowledgeBaseResult) => { output.warnings = ["PRIVATE_UNKNOWN_WARNING\nsecret"]; },
  ])("fails closed on a schema-invalid output without echoing its fields", (mutate) => {
    const output = structuredClone(noData);
    mutate(output);
    expect(searchKnowledgeBaseResultSchema.safeParse(output).success).toBe(false);
    expect(observe(fixture(output))).not.toHaveBeenCalled();
  });

  it("refuses raw extra output fields rather than accepting a partial tool envelope", () => {
    expect(observe(fixture({ ...noData, reasoning: "PRIVATE_REASONING" }))).not.toHaveBeenCalled();
  });

  it("bounds all tool items across steps, accepting 32 and rejecting larger traces", () => {
    const input = fixture();
    const steps = Array.from({ length: 4 }, (_, index) => {
      const entries = Array.from({ length: 4 }, (_, ordinal) => step(noData, `${index}-${ordinal}`));
      return { toolCalls: entries.flatMap((entry) => entry.toolCalls), toolResults: entries.flatMap((entry) => entry.toolResults) };
    });
    input.observations[0].steps = steps;
    input.results[0].loopSteps = 4;
    input.results[0].toolSequence = Array.from({ length: 16 }, () => "searchKnowledgeBase");
    expect(observe(input).mock.calls[0][0].results).toHaveLength(16);
    steps.push(step(noData, "overflow"));
    input.results[0].loopSteps = 5;
    input.results[0].toolSequence = Array.from({ length: 17 }, () => "searchKnowledgeBase");
    expect(observe(input)).not.toHaveBeenCalled();
  });

  it("bounds individual steps and the maximum step count", () => {
    const tooManySteps = fixture();
    tooManySteps.observations[0].steps = Array.from({ length: 6 }, (_, index) => step(noData, `${index}`));
    tooManySteps.results[0].loopSteps = 6;
    expect(observe(tooManySteps)).not.toHaveBeenCalled();
    const tooManyCalls = fixture();
    const entries = Array.from({ length: 9 }, (_, index) => step(noData, `${index}`));
    tooManyCalls.observations[0].steps = [{
      toolCalls: entries.flatMap((entry) => entry.toolCalls),
      toolResults: entries.flatMap((entry) => entry.toolResults),
    }];
    tooManyCalls.results[0].toolSequence = Array.from({ length: 9 }, () => "searchKnowledgeBase");
    expect(observe(tooManyCalls)).not.toHaveBeenCalled();
  });

  it.each(["hits", "citations"])("bounds %s before inspecting their raw fields", (field) => {
    const output = structuredClone(found);
    if (field === "hits") {
      output.search.results = Array.from({ length: 6 }, () => output.search.results[0]);
      Object.defineProperty(output.search.results[0], "content", { get: () => { throw new Error("raw content"); } });
    } else {
      output.citations = Array.from({ length: 6 }, () => output.citations[0]);
      Object.defineProperty(output.citations[0], "title", { get: () => { throw new Error("raw title"); } });
    }
    expect(observe(fixture(output))).not.toHaveBeenCalled();
  });

  it.each(["results", "observations"] as const)("bounds and deduplicates canonical %s", (field) => {
    const duplicate = fixture();
    duplicate[field].push(duplicate[field][0]);
    expect(observe(duplicate)).not.toHaveBeenCalled();
    const input = fixture();
    for (let index = 1; index < 18; index += 1) input[field].push({ id: `unknown-${index}` });
    expect(observe(input)).toHaveBeenCalledTimes(1);
    input[field].push({ id: "unknown-18" });
    expect(observe(input)).not.toHaveBeenCalled();
  });

  it("does no additional parsing or property reads without an observer", () => {
    const input = fixture();
    for (const field of ["observations", "results", "reportReceipt"]) {
      Object.defineProperty(input, field, { get: () => { throw new Error("disabled"); } });
    }
    expect(() => observeFailedSourceEvidence(input)).not.toThrow();
  });

  it("rejects invalid report receipt identities", () => {
    const observer = vi.fn<FailedSourceEvidenceObserver>(() => undefined);
    for (const identity of [{ ...reportReceipt, runId: "PRIVATE_ID" }, { ...reportReceipt, sha256: "PRIVATE_HASH" }]) {
      observeFailedSourceEvidence({ ...fixture(), reportReceipt: identity, observer });
    }
    expect(observer).not.toHaveBeenCalled();
  });

  it("isolates frozen-payload mutation and synchronous or accidental asynchronous faults", async () => {
    const input = fixture();
    const before = JSON.stringify(input);
    const mutationResults: boolean[] = [];
    const faults: Array<(value: FailedSourceEvidenceDiagnostic) => unknown> = [
      () => { throw new Error("PRIVATE_CALLBACK_ERROR"); },
      (value) => {
        mutationResults.push(Reflect.set(value, "caseId", "mutated"));
        mutationResults.push(Reflect.set(value.results, "0", "mutated"));
        mutationResults.push(Reflect.set(value.results[0], "status", "mutated"));
        mutationResults.push(Reflect.set(value.results[0].warningCodes, "0", "mutated"));
        mutationResults.push(Reflect.set(value.statusCounts, "no_data", 900));
      },
      () => Promise.reject(new Error("PRIVATE_ASYNC_ERROR")),
      () => ({ get then() { throw new Error("PRIVATE_THEN_ERROR"); } }),
      () => new Promise(() => undefined),
    ];
    for (const fault of faults) {
      expect(() => observeFailedSourceEvidence({ ...input, observer: fault as FailedSourceEvidenceObserver })).not.toThrow();
    }
    await new Promise((resolve) => setImmediate(resolve));
    expect(mutationResults).toEqual([false, false, false, false, false]);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("prints only one projected JSON line, stripping caller-added raw properties", () => {
    const diagnostic = observe().mock.calls[0][0];
    const extended = {
      ...diagnostic, responseText: "PRIVATE_RESPONSE\n\u001b[31m",
      results: diagnostic.results.map((result) => ({ ...result, output: "PRIVATE_OUTPUT" })),
    };
    const line = formatFailedSourceEvidenceDiagnostic(extended);
    expect(line.split("\n")).toHaveLength(2);
    expect(line).not.toContain("PRIVATE");
    expect(JSON.parse(line)).toEqual({ type: "live_eval_failed_source_evidence", ...diagnostic });
  });
});
