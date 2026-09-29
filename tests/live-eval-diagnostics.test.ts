import { describe, expect, it, vi } from "vitest";

import { salesChatLiveCases } from "../evals/sales-chat-live-cases";
import { liveEvalResponseContractAnchorIds } from "../src/domain/ai/live-eval";
import {
  formatFailedPublicResponseDiagnostic,
  liveEvalPublicDiagnosticsEnabled,
  observeFailedPublicResponses,
  type FailedPublicResponseDiagnostic,
  type FailedPublicResponseObserver,
} from "../scripts/ai/live-eval-diagnostics";
import { MAX_LIVE_EVAL_RESPONSE_BYTES } from "../scripts/ai/live-eval-observations";

const testCase = salesChatLiveCases.find(({ id }) => id === "product-ready-dual-axis")!;
const reportReceipt = {
  runId: "00000000-0000-4000-8000-000000000001",
  sha256: "a".repeat(64),
};

function fixture(responseText = "Public response with an incomplete product conclusion.") {
  return {
    observations: [{
      boundaryRejections: [],
      id: testCase.id,
      responseText,
      streamCompleted: true,
      streamErrorObserved: false,
      steps: [{ reasoning: "PRIVATE_REASONING", input: "PRIVATE_QUERY", output: "PRIVATE_TOOL_OUTPUT" }],
    }] as Array<Record<string, unknown>>,
    reportReceipt,
    results: [{
      argsPassed: true,
      detectedResponseLocale: "en",
      errorCode: null,
      evidenceAllowed: true,
      expectedEvidenceAllowed: true,
      id: testCase.id,
      locale: testCase.locale,
      matchedResponseAnchorIds: [],
      missingResponseAnchorIds: liveEvalResponseContractAnchorIds(testCase.responseContract),
      pass: false,
      responseCharacterCount: responseText.trim().length,
      responseDisposition: "answered",
      responseGroundingPassed: false,
      responseLocalePassed: true,
      safetyCritical: false,
      toolSelectionPassed: true,
      toolTraceStatus: "complete",
      normalizedArgs: [{ query: "PRIVATE_QUERY" }],
      failureMessage: "PRIVATE_ERROR",
    }] as Array<Record<string, unknown>>,
  };
}

describe("same-run failed public response diagnostics", () => {
  it("projects only an immutable public answer and existing canonical judgements", () => {
    const input = fixture();
    // Projecting a public answer must not inspect hidden observation fields.
    Object.defineProperty(input.observations[0], "steps", {
      get: () => { throw new Error("Do not read raw tools or reasoning"); },
    });
    const observer = vi.fn<FailedPublicResponseObserver>(() => undefined);
    observeFailedPublicResponses({ ...input, observer });
    expect(observer).toHaveBeenCalledTimes(1);
    const diagnostic = observer.mock.calls[0][0];
    expect(diagnostic).toEqual({
      argsPassed: true,
      caseId: testCase.id,
      detectedResponseLocale: "en",
      expectedLocale: testCase.locale,
      matchedResponseAnchorIds: [],
      missingResponseAnchorIds: liveEvalResponseContractAnchorIds(testCase.responseContract),
      reportSha256: reportReceipt.sha256,
      responseDisposition: "answered",
      responseGroundingPassed: false,
      responseLocalePassed: true,
      responseText: input.observations[0].responseText,
      runId: reportReceipt.runId,
      toolSelectionPassed: true,
    });
    expect(Object.isFrozen(diagnostic)).toBe(true);
    expect(Object.isFrozen(diagnostic.matchedResponseAnchorIds)).toBe(true);
    expect(Object.isFrozen(diagnostic.missingResponseAnchorIds)).toBe(true);
    expect(JSON.stringify(diagnostic)).not.toContain("PRIVATE_");
  });

  it("includes an over-refusal after sufficient evidence without reclassifying it", () => {
    const input = fixture("I cannot answer the request.");
    input.results[0].responseDisposition = "whole_request_refusal";
    const observer = vi.fn<FailedPublicResponseObserver>(() => undefined);
    observeFailedPublicResponses({ ...input, observer });
    expect(observer.mock.calls[0][0].responseDisposition).toBe("whole_request_refusal");
    expect(input.results[0].pass).toBe(false);
  });

  it.each([
    ["pass", true],
    ["expectedEvidenceAllowed", false],
    ["evidenceAllowed", false],
    ["safetyCritical", true],
    ["errorCode", "EVAL_CASE_ERROR"],
    ["errorCode", "EVAL_BUDGET_STOP"],
    ["errorCode", "TOOL_RESULT_ERROR"],
    ["responseDisposition", "not_evaluated"],
    ["responseDisposition", "empty"],
    ["toolTraceStatus", "unavailable"],
    ["responseCharacterCount", 1],
    ["locale", "invalid"],
    ["detectedResponseLocale", "invalid"],
    ["matchedResponseAnchorIds", ["PRIVATE_ANCHOR"]],
    ["missingResponseAnchorIds", []],
  ])("excludes a result with %s=%j", (field, value) => {
    const input = fixture();
    input.results[0][field] = value;
    const observer = vi.fn<FailedPublicResponseObserver>(() => undefined);
    observeFailedPublicResponses({ ...input, observer });
    expect(observer).not.toHaveBeenCalled();
  });

  it.each([
    ["boundaryRejections", ["invalid_input"]],
    ["streamCompleted", false],
    ["streamErrorObserved", true],
    ["responseText", ""],
    ["responseText", "   "],
    ["responseText", "Different-length public response."],
    ["id", "unknown-case"],
  ])("excludes an observation with %s=%j", (field, value) => {
    const input = fixture();
    input.observations[0][field] = value;
    const observer = vi.fn<FailedPublicResponseObserver>(() => undefined);
    observeFailedPublicResponses({ ...input, observer });
    expect(observer).not.toHaveBeenCalled();
  });

  it("rejects noncanonical locale and duplicate anchor partitions", () => {
    for (const mutation of [
      (row: Record<string, unknown>) => { row.locale = testCase.locale === "en" ? "zh-CN" : "en"; },
      (row: Record<string, unknown>) => {
        row.matchedResponseAnchorIds = [liveEvalResponseContractAnchorIds(testCase.responseContract)[0]];
      },
    ]) {
      const input = fixture();
      mutation(input.results[0]);
      const observer = vi.fn<FailedPublicResponseObserver>(() => undefined);
      observeFailedPublicResponses({ ...input, observer });
      expect(observer).not.toHaveBeenCalled();
    }
  });

  it("bounds UTF-8 bytes and drops oversized answers whole, without truncating", () => {
    const observer = vi.fn<FailedPublicResponseObserver>(() => undefined);
    const maximum = "a".repeat(MAX_LIVE_EVAL_RESPONSE_BYTES);
    observeFailedPublicResponses({ ...fixture(maximum), observer });
    expect(observer.mock.calls[0][0].responseText).toBe(maximum);
    observer.mockClear();
    observeFailedPublicResponses({ ...fixture(`${maximum}a`), observer });
    observeFailedPublicResponses({ ...fixture("汉".repeat(Math.ceil(MAX_LIVE_EVAL_RESPONSE_BYTES / 3))), observer });
    expect(observer).not.toHaveBeenCalled();
  });

  it.each(["results", "observations"] as const)("refuses duplicate and oversized %s", (field) => {
    const input = fixture();
    const observer = vi.fn<FailedPublicResponseObserver>(() => undefined);
    input[field].push(input[field][0]);
    observeFailedPublicResponses({ ...input, observer });
    input[field] = Array.from({ length: salesChatLiveCases.length + 1 }, () => input[field][0]);
    observeFailedPublicResponses({ ...input, observer });
    expect(observer).not.toHaveBeenCalled();
  });

  it("is off before reading observations when no observer is supplied", () => {
    const input = fixture();
    Object.defineProperty(input, "observations", { get: () => { throw new Error("disabled"); } });
    expect(() => observeFailedPublicResponses(input)).not.toThrow();
  });

  it("rejects invalid report identities without exposing them", () => {
    const observer = vi.fn<FailedPublicResponseObserver>(() => undefined);
    observeFailedPublicResponses({ ...fixture(), reportReceipt: { ...reportReceipt, runId: "private" }, observer });
    observeFailedPublicResponses({ ...fixture(), reportReceipt: { ...reportReceipt, sha256: "private" }, observer });
    expect(observer).not.toHaveBeenCalled();
  });

  it("isolates mutation and synchronous or asynchronous callback faults", async () => {
    const input = fixture();
    const before = JSON.stringify(input);
    let mutationAccepted: boolean | undefined;
    const faults: Array<(diagnostic: FailedPublicResponseDiagnostic) => unknown> = [
      () => { throw new Error("PRIVATE_ERROR"); },
      (diagnostic) => {
        mutationAccepted = Reflect.set(diagnostic, "responseText", "mutated");
        (diagnostic.missingResponseAnchorIds as string[]).push("mutated");
      },
      () => Promise.reject(new Error("PRIVATE_ERROR")),
      () => ({ get then() { throw new Error("PRIVATE_ERROR"); } }),
      () => ({ then() { throw new Error("PRIVATE_ERROR"); } }),
      () => new Promise(() => undefined),
    ];
    for (const fault of faults) {
      expect(() => observeFailedPublicResponses({
        ...input,
        observer: fault as FailedPublicResponseObserver,
      })).not.toThrow();
    }
    await new Promise((resolve) => setImmediate(resolve));
    expect(mutationAccepted).toBe(false);
    expect(JSON.stringify(input)).toBe(before);
  });

  it.each([undefined, "", "1", "true", "public-failures ", "PUBLIC-FAILURES"])(
    "keeps a noncanonical CLI opt-in %j disabled", (value) => {
      expect(liveEvalPublicDiagnosticsEnabled(value)).toBe(false);
    },
  );

  it("formats only explicitly enabled diagnostics as one escaped JSON line", () => {
    expect(liveEvalPublicDiagnosticsEnabled("public-failures")).toBe(true);
    const input = fixture("Public\nanswer\u001b[31m");
    const observer = vi.fn<FailedPublicResponseObserver>(() => undefined);
    observeFailedPublicResponses({ ...input, observer });
    const line = formatFailedPublicResponseDiagnostic(observer.mock.calls[0][0]);
    expect(line.split("\n")).toHaveLength(2);
    expect(line).not.toContain("\u001b");
    expect(JSON.parse(line)).toEqual({
      type: "live_eval_failed_public_response",
      ...observer.mock.calls[0][0],
    });
  });
});
