import { describe, expect, it } from "vitest";

import { salesChatLiveCases } from "../evals/sales-chat-live-cases";
import { SALES_CHAT_BOUNDARY_REJECTION_REASONS } from "../src/features/ai/constants";
import {
  LIVE_EVAL_OBSERVATIONS_VERSION,
  MAX_LIVE_EVAL_RESPONSE_BYTES,
  liveEvalObservationsSchema,
  parseCanonicalLiveEvalObservations,
  serializeLiveEvalObservations,
} from "../scripts/ai/live-eval-observations";
import {
  resolveObservedLiveEvalResponseDisposition,
  verifyLiveEvalObservations,
} from "../scripts/ai/verify-live-eval-observations";
import { buildEvidenceGapResponse } from "@/domain/ai/evidence-gap-response";
import { buildCountryProfileResult } from "@/server/ai/tool-results";
import { buildSyntheticLiveEvalReport, SYNTHETIC_LIVE_EVAL_RUNTIME_CONTEXT } from "./helpers/live-eval-report-fixture";

function buildMinimalObservations() {
  return liveEvalObservationsSchema.parse({
    cases: salesChatLiveCases.map(({ id }) => ({
      runtimeContext: SYNTHETIC_LIVE_EVAL_RUNTIME_CONTEXT,
      aggregateUsage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      },
      attemptCount: 1,
      boundaryRejections: [],
      completedCount: 1,
      id,
      latencyMs: 25,
      responseText: "insufficient evidence",
      streamCompleted: true,
      streamErrorObserved: false,
      steps: [],
    })),
    evaluatedAt: "2026-08-30T00:00:00.000Z",
    runId: "11111111-1111-4111-8111-111111111111",
    version: LIVE_EVAL_OBSERVATIONS_VERSION,
  });
}

function buildReport() {
  return buildSyntheticLiveEvalReport({
    commit: "a".repeat(40),
    fingerprintDigest: "b".repeat(64),
    fingerprintFileCount: 1,
  });
}

describe("live eval in-memory observations", () => {
  it.each(["sales-chat-live-v17", "sales-chat-live-v18", "sales-chat-live-v19", "sales-chat-live-v20", "sales-chat-live-v21", "sales-chat-live-v22", "sales-chat-live-v23", "sales-chat-live-v24", "sales-chat-live-v25"] as const)("does not apply current response scoring to a schema-readable %s report", (version) => {
    const report = buildReport();
    const results = report.results.map((result) => {
      const legacy = { ...result };
      if (version !== "sales-chat-live-v20" && version !== "sales-chat-live-v21" && version !== "sales-chat-live-v22" && version !== "sales-chat-live-v23" && version !== "sales-chat-live-v24" && version !== "sales-chat-live-v25") {
        Reflect.deleteProperty(legacy, "toolTraceStatus");
      }
      return legacy;
    });
    expect(() => verifyLiveEvalObservations({
      observations: buildMinimalObservations(),
      report: { ...report, results, version },
    })).toThrow(/require a current-suite report/u);
  });

  it("rejects a sidecar clock different from the persisted case clock", () => {
    const observations = buildMinimalObservations();
    observations.cases[0]!.runtimeContext = {
      capturedAt: "2026-08-28T00:00:00.000Z", utcDate: "2026-08-28",
    };
    expect(() => verifyLiveEvalObservations({ observations, report: buildReport() }))
      .toThrow(/runtime clock/u);
  });

  it("does not accept a v1 sidecar which has no captured-clock contract", () => {
    expect(liveEvalObservationsSchema.safeParse({
      ...buildMinimalObservations(), version: "sales-chat-live-observations-v1",
    }).success).toBe(false);
  });

  it("independently rejects text appended to the production evidence boundary", () => {
    const result = buildCountryProfileResult({
      informationAsOf: "2026-08-13",
      profile: null,
      requestedTopics: ["market"],
      resolvedCountryIso3: "FJI",
    });
    const exactBoundary = buildEvidenceGapResponse(
      [result],
      false,
      false,
      "zh-CN",
    );

    expect(
      resolveObservedLiveEvalResponseDisposition({
        errorCode: null,
        evidenceAllowed: false,
        expectedEvidenceAllowed: false,
        locale: "zh-CN",
        parsedToolResults: [result],
        responseText: exactBoundary,
      }),
    ).toBe("whole_request_refusal");
    expect(
      resolveObservedLiveEvalResponseDisposition({
        errorCode: null,
        evidenceAllowed: false,
        expectedEvidenceAllowed: false,
        locale: "zh-CN",
        parsedToolResults: [result],
        responseText: `${exactBoundary}\n不过该市场已确认可立即供货。`,
      }),
    ).toBe("answered");
  });

  it("serializes canonical v2 bytes and binds their digest", () => {
    const serialized = serializeLiveEvalObservations(buildMinimalObservations());

    expect(parseCanonicalLiveEvalObservations(serialized.reportText)).toEqual(
      buildMinimalObservations(),
    );
    expect(serialized.receipt).toMatchObject({
      byteLength: Buffer.byteLength(serialized.reportText),
      caseCount: 18,
      evaluatedAt: "2026-08-30T00:00:00.000Z",
      runId: "11111111-1111-4111-8111-111111111111",
      version: LIVE_EVAL_OBSERVATIONS_VERSION,
    });
    expect(serialized.receipt.sha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("rejects non-canonical observation bytes", () => {
    const serialized = serializeLiveEvalObservations(buildMinimalObservations());
    expect(() =>
      parseCanonicalLiveEvalObservations(serialized.reportText.trimEnd())
    ).toThrow(/canonical/u);
  });

  it("rejects response and case-count limits", () => {
    const observations = buildMinimalObservations();
    expect(() =>
      liveEvalObservationsSchema.parse({
        ...observations,
        cases: observations.cases.slice(0, 17),
      })
    ).toThrow();
    expect(() =>
      liveEvalObservationsSchema.parse({
        ...observations,
        cases: observations.cases.map((observedCase, index) =>
          index === 0
            ? { ...observedCase, responseText: "x".repeat(MAX_LIVE_EVAL_RESPONSE_BYTES + 1) }
            : observedCase
        ),
      })
    ).toThrow(/response exceeds/u);
  });

  it("rejects reordered, duplicate, and missing canonical cases", () => {
    const report = buildReport();
    const observations = buildMinimalObservations();
    const reordered = structuredClone(observations);
    [reordered.cases[0], reordered.cases[1]] = [
      reordered.cases[1]!,
      reordered.cases[0]!,
    ];
    expect(() =>
      verifyLiveEvalObservations({ observations: reordered, report })
    ).toThrow(/canonical case order/u);

    const duplicate = structuredClone(observations);
    duplicate.cases[1]!.id = duplicate.cases[0]!.id;
    expect(() =>
      verifyLiveEvalObservations({ observations: duplicate, report })
    ).toThrow(/canonical case order/u);

    expect(() =>
      verifyLiveEvalObservations({
        observations: { ...observations, cases: observations.cases.slice(0, 17) },
        report,
      })
    ).toThrow();
  });

  it("rejects duplicate calls, mismatched results, invalid outputs, and raw response drift", () => {
    const report = buildReport();
    const base = buildMinimalObservations();
    const metric = {
      observability: report.results[0]!.modelObservability.steps[0]!,
      toolCallCount: 2,
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    };
    const duplicateCalls = structuredClone(base);
    duplicateCalls.cases[0]!.steps = [{
      metric,
      toolCalls: [
        { dynamic: false, input: {}, invalid: false, toolCallId: "dup", toolName: "getCountryProfile" },
        { dynamic: false, input: {}, invalid: false, toolCallId: "dup", toolName: "getCountryProfile" },
      ],
      toolResults: [
        { output: null, toolCallId: "dup", toolName: "getCountryProfile" },
        { output: null, toolCallId: "other", toolName: "getCountryProfile" },
      ],
    }];
    expect(() =>
      verifyLiveEvalObservations({ observations: duplicateCalls, report })
    ).toThrow(/unique step tool-call IDs/u);

    const mismatchedResult = structuredClone(base);
    mismatchedResult.cases[0]!.steps = [{
      metric: { ...metric, toolCallCount: 1 },
      toolCalls: [{ dynamic: false, input: {}, invalid: false, toolCallId: "one", toolName: "getCountryProfile" }],
      toolResults: [{ output: null, toolCallId: "one", toolName: "compareMarkets" }],
    }];
    expect(() =>
      verifyLiveEvalObservations({ observations: mismatchedResult, report })
    ).toThrow(/tool result pairing/u);

    const invalidOutput = structuredClone(base);
    invalidOutput.cases[0]!.steps = [{
      metric: { ...metric, toolCallCount: 1 },
      toolCalls: [{ dynamic: false, input: {}, invalid: false, toolCallId: "one", toolName: "getCountryProfile" }],
      toolResults: [{ output: null, toolCallId: "one", toolName: "getCountryProfile" }],
    }];
    expect(() =>
      verifyLiveEvalObservations({ observations: invalidOutput, report })
    ).toThrow();

    expect(() =>
      verifyLiveEvalObservations({ observations: base, report })
    ).toThrow(/mismatch/u);
  });

  it.each(SALES_CHAT_BOUNDARY_REJECTION_REASONS)(
    "rejects an otherwise retained case observation with %s boundary rejection",
    (reason) => {
      const observations = buildMinimalObservations();
      observations.cases[0]!.boundaryRejections = [reason];
      expect(() =>
        verifyLiveEvalObservations({ observations, report: buildReport() })
      ).toThrow(/error code/u);
    },
  );

  it.each([
    { streamCompleted: false, streamErrorObserved: false },
    { streamCompleted: true, streamErrorObserved: true },
    { streamCompleted: false, streamErrorObserved: true },
  ])(
    "rejects stream state completed=$streamCompleted error=$streamErrorObserved",
    ({ streamCompleted, streamErrorObserved }) => {
      const observations = buildMinimalObservations();
      Object.assign(observations.cases[0]!, {
        streamCompleted,
        streamErrorObserved,
      });
      expect(() =>
        verifyLiveEvalObservations({ observations, report: buildReport() })
      ).toThrow(/error code/u);
    },
  );

  it("rejects duplicate boundary reason records", () => {
    const observations = buildMinimalObservations();
    expect(() =>
      liveEvalObservationsSchema.parse({
        ...observations,
        cases: observations.cases.map((observedCase, index) =>
          index === 0
            ? { ...observedCase, boundaryRejections: ["tool_error", "tool_error"] }
            : observedCase
        ),
      })
    ).toThrow(/unique/u);
  });
});
