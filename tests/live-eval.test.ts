import { describe, expect, it } from "vitest";

import {
  matchesExpectedArgs,
  scoreLiveEval,
  shouldStopLiveEval,
} from "@/domain/ai/live-eval";
import { salesChatLiveCases } from "../evals/sales-chat-live-cases";

describe("live eval scoring and budget", () => {
  it("stops at either request or token budget", () => {
    expect(shouldStopLiveEval({ requestCount: 18, totalTokens: 1 })).toBe(true);
    expect(shouldStopLiveEval({ requestCount: 1, totalTokens: 80_000 })).toBe(true);
    expect(shouldStopLiveEval({ requestCount: 17, totalTokens: 73_999 })).toBe(false);
    expect(shouldStopLiveEval({ requestCount: 17, totalTokens: 74_001 })).toBe(true);
    expect(
      shouldStopLiveEval({
        maxTokens: 100,
        requestCount: 1,
        requestTokenReserve: 20,
        totalTokens: 81,
      }),
    ).toBe(true);
  });

  it("matches only the expected normalized argument subset", () => {
    expect(
      matchesExpectedArgs(
        { countryIso3: "CHN", powerKw: 100, extra: true },
        { countryIso3: "CHN", powerKw: 100 },
      ),
    ).toBe(true);
    expect(
      matchesExpectedArgs(
        { countryIso3: "BRA", powerKw: 100 },
        { countryIso3: "CHN" },
      ),
    ).toBe(false);
  });

  it("scores tool, argument and fail-closed dimensions independently", () => {
    expect(
      scoreLiveEval([
        {
          argsPassed: true,
          safetyCritical: true,
          safetyPassed: true,
          toolSelectionPassed: true,
        },
        {
          argsPassed: false,
          safetyCritical: false,
          safetyPassed: true,
          toolSelectionPassed: true,
        },
      ]),
    ).toEqual({
      argsAccuracyPct: 50,
      safetyFailClosedPct: 100,
      toolSelectionAccuracyPct: 100,
    });
  });

  it("expects missing products and injected retrieval text to fail closed", () => {
    const expectedById = new Map(
      salesChatLiveCases.map((testCase) => [testCase.id, testCase]),
    );
    expect(expectedById.get("unknown-product-fails-closed")?.expectedEvidenceAllowed)
      .toBe(false);
    expect(expectedById.get("source-document-retrieval")?.expectedEvidenceAllowed)
      .toBe(true);
    expect(expectedById.get("retrieved-prompt-injection-is-data")?.expectedEvidenceAllowed)
      .toBe(false);
  });
});
