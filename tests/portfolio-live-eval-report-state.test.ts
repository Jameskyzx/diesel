import { describe, expect, it } from "vitest";

import { deriveLiveEvalReportState } from "../scripts/portfolio/live-eval-report-state";

const suiteIds = ["first", "second", "third"] as const;

describe("portfolio live-eval report state verification", () => {
  it("accepts a canonical partial prefix as an honest failed observation", () => {
    expect(
      deriveLiveEvalReportState({
        resultErrorCodes: [null],
        resultIds: ["first"],
        runError: null,
        suiteIds,
      }),
    ).toEqual({ complete: false, outcome: "failed" });
  });

  it("accepts a complete canonical run as a threshold candidate", () => {
    expect(
      deriveLiveEvalReportState({
        resultErrorCodes: [null, null, null],
        resultIds: suiteIds,
        runError: null,
        suiteIds,
      }),
    ).toEqual({ complete: true, outcome: "passed_candidate" });
  });

  it("accepts an empty initialization failure", () => {
    expect(
      deriveLiveEvalReportState({
        resultErrorCodes: [],
        resultIds: [],
        runError: { code: "INITIALIZATION_ERROR" },
        suiteIds,
      }),
    ).toEqual({ complete: false, outcome: "failed" });
  });

  it("accepts a final EVAL_CASE_ERROR but keeps a full-length run incomplete", () => {
    expect(
      deriveLiveEvalReportState({
        resultErrorCodes: [null, null, "EVAL_CASE_ERROR"],
        resultIds: suiteIds,
        runError: null,
        suiteIds,
      }),
    ).toEqual({ complete: false, outcome: "failed" });
  });

  it("accepts a final EVAL_BUDGET_STOP but keeps a full-length run incomplete", () => {
    expect(
      deriveLiveEvalReportState({
        resultErrorCodes: [null, null, "EVAL_BUDGET_STOP"],
        resultIds: suiteIds,
        runError: null,
        suiteIds,
      }),
    ).toEqual({ complete: false, outcome: "failed" });
  });

  it.each([
    {
      label: "an out-of-order result",
      resultErrorCodes: [null],
      resultIds: ["second"],
      runError: null,
    },
    {
      label: "a skipped result",
      resultErrorCodes: [null, null],
      resultIds: ["first", "third"],
      runError: null,
    },
    {
      label: "results attached to initialization failure",
      resultErrorCodes: [null],
      resultIds: ["first"],
      runError: { code: "INITIALIZATION_ERROR" } as const,
    },
    {
      label: "an unexplained empty run",
      resultErrorCodes: [],
      resultIds: [],
      runError: null,
    },
    {
      label: "a non-terminal case execution error",
      resultErrorCodes: ["EVAL_CASE_ERROR", null, null],
      resultIds: ["first", "second", "third"],
      runError: null,
    },
    {
      label: "a non-terminal budget stop",
      resultErrorCodes: [null, "EVAL_BUDGET_STOP", null],
      resultIds: ["first", "second", "third"],
      runError: null,
    },
    {
      label: "fewer error-code rows than result rows",
      resultErrorCodes: [null],
      resultIds: ["first", "second"],
      runError: null,
    },
    {
      label: "more error-code rows than result rows",
      resultErrorCodes: [null, null],
      resultIds: ["first"],
      runError: null,
    },
  ])("rejects $label", ({ resultErrorCodes, resultIds, runError }) => {
    expect(() =>
      deriveLiveEvalReportState({
        resultErrorCodes,
        resultIds,
        runError,
        suiteIds,
      }),
    ).toThrow();
  });
});
