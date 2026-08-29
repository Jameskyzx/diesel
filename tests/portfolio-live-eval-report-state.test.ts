import { describe, expect, it } from "vitest";

import { deriveLiveEvalReportState } from "../scripts/portfolio/live-eval-report-state";

const suiteIds = ["first", "second", "third"] as const;

describe("portfolio live-eval report state verification", () => {
  it("accepts a canonical partial prefix as an honest failed observation", () => {
    expect(
      deriveLiveEvalReportState({
        resultIds: ["first"],
        runError: null,
        suiteIds,
      }),
    ).toEqual({ complete: false, outcome: "failed" });
  });

  it("accepts a complete canonical run as a threshold candidate", () => {
    expect(
      deriveLiveEvalReportState({
        resultIds: suiteIds,
        runError: null,
        suiteIds,
      }),
    ).toEqual({ complete: true, outcome: "passed_candidate" });
  });

  it("accepts an empty initialization failure", () => {
    expect(
      deriveLiveEvalReportState({
        resultIds: [],
        runError: { code: "INITIALIZATION_ERROR" },
        suiteIds,
      }),
    ).toEqual({ complete: false, outcome: "failed" });
  });

  it.each([
    {
      label: "an out-of-order result",
      resultIds: ["second"],
      runError: null,
    },
    {
      label: "a skipped result",
      resultIds: ["first", "third"],
      runError: null,
    },
    {
      label: "results attached to initialization failure",
      resultIds: ["first"],
      runError: { code: "INITIALIZATION_ERROR" } as const,
    },
    {
      label: "an unexplained empty run",
      resultIds: [],
      runError: null,
    },
  ])("rejects $label", ({ resultIds, runError }) => {
    expect(() =>
      deriveLiveEvalReportState({ resultIds, runError, suiteIds }),
    ).toThrow();
  });
});
