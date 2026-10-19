

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { matchesExpectedLiveEvalReportArgs } from "../scripts/ai/live-eval-report-args";

const runtimeContext = {
  capturedAt: "2026-09-06T23:59:59.900Z",
  utcDate: "2026-09-06",
} as const;

beforeEach(() => {
  // Only freeze Date: the real SDK stream and timer scheduling still execute.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(runtimeContext.capturedAt));
});
afterEach(() => vi.useRealTimers());

describe("live eval scores the production default date, not raw provider keys", () => {

  it.each(["2026-09-05", "2026-09-07", "2031-01-01"])(
    "still rejects the wrong default date %s", (asOf) => {
      const evaluation = {
        actual: { asOf, countryIso3: "CHN", topics: ["country"] },
        expected: { countryIso3: "CHN", topics: ["country"] },
        runtimeContext,
        tool: "getCountryProfile" as const,
      };
      expect(matchesExpectedLiveEvalReportArgs(evaluation)).toBe(false);
    },
  );

  it("requires the default in the post-schema observation", () => {
    const expected = { countryIso3: "CHN", topics: ["country"] };
    const evaluation = { actual: expected, expected, runtimeContext, tool: "getCountryProfile" as const };
    expect(matchesExpectedLiveEvalReportArgs(evaluation)).toBe(false);
  });

  it("retains the historical exact-key result when no v14 runtime context exists", () => {
    expect(matchesExpectedLiveEvalReportArgs({
      actual: { asOf: runtimeContext.utcDate, countryIso3: "CHN", topics: ["country"] },
      expected: { countryIso3: "CHN", topics: ["country"] },
      tool: "getCountryProfile",
    })).toBe(false);
  });

  it("keeps an explicit user date instead of replacing it with the runtime date", () => {
    const expected = { asOf: "2026-08-13", countryIso3: "CHN", topics: ["country"] };
    expect(matchesExpectedLiveEvalReportArgs({
      actual: expected, expected, runtimeContext, tool: "getCountryProfile",
    })).toBe(true);
    expect(matchesExpectedLiveEvalReportArgs({
      actual: { ...expected, asOf: runtimeContext.utcDate }, expected, runtimeContext, tool: "getCountryProfile",
    })).toBe(false);
  });

  it("replays the captured date after the current clock crosses UTC midnight", () => {
    vi.setSystemTime(new Date("2026-09-07T00:00:00.100Z"));
    const expected = { countryIso3: "CHN", topics: ["country"] };
    expect(matchesExpectedLiveEvalReportArgs({
      actual: { ...expected, asOf: runtimeContext.utcDate }, expected, runtimeContext, tool: "getCountryProfile",
    })).toBe(true);
    expect(matchesExpectedLiveEvalReportArgs({
      actual: { ...expected, asOf: "2026-09-07" }, expected, runtimeContext, tool: "getCountryProfile",
    })).toBe(false);
  });

  it("does not permit another undeclared field when accepting the runtime date", () => {
    const expected = { countryIso3: "CHN", topics: ["country"] };
    expect(matchesExpectedLiveEvalReportArgs({
      actual: { ...expected, asOf: runtimeContext.utcDate, applicationScope: "non-road" },
      expected, runtimeContext, tool: "getCountryProfile",
    })).toBe(false);
  });

  it("rejects an inconsistent runtime clock rather than trusting its date", () => {
    const expected = { countryIso3: "CHN", topics: ["country"] };
    expect(matchesExpectedLiveEvalReportArgs({
      actual: { ...expected, asOf: "2026-09-07" }, expected,
      runtimeContext: { ...runtimeContext, utcDate: "2026-09-07" }, tool: "getCountryProfile",
    })).toBe(false);
  });
});
