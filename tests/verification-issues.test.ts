import { describe, expect, it } from "vitest";

import {
  assertVerificationEqual,
  VerificationIssues,
} from "../scripts/portfolio/verification-issues";

describe("portfolio verification equality", () => {
  it("treats object key order as presentation rather than data", () => {
    expect(() =>
      assertVerificationEqual(
        { id: "public", counts: { passed: 1, failed: 0 } },
        { counts: { failed: 0, passed: 1 }, id: "public" },
        "same evidence",
      )
    ).not.toThrow();
  });

  it("retains array order and distinguishes missing fields", () => {
    expect(() =>
      assertVerificationEqual(["public", "demo"], ["demo", "public"], "runs")
    ).toThrow("runs drifted");
    expect(() =>
      assertVerificationEqual({ complete: true }, {
        complete: true,
        evaluatedCommit: undefined,
      }, "provenance")
    ).toThrow("provenance drifted");
  });

  it("collects every mismatch before failing", () => {
    const issues = new VerificationIssues();
    issues.equal(1, 2, "first");
    issues.equal("a", "b", "second");

    expect(() => issues.throwIfAny("verification")).toThrow(
      /found 2 issues[\s\S]*first drifted[\s\S]*second drifted/u,
    );
  });
});
