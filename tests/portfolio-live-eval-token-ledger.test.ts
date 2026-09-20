import { describe, expect, it } from "vitest";

import { recomputeLiveEvalTokenLedger } from "../scripts/portfolio/live-eval-token-ledger";

describe("portfolio live-eval token-ledger verification", () => {
  it.each([
    {
      expectedComplete: true,
      expectedTotal: 15,
      label: "consistent counts",
      reportCase: {
        attemptCount: 1,
        completedCount: 1,
        errorCode: null,
        loopSteps: 1,
        tokenUsage: {
          input: 10,
          ledger: [{ input: 10, output: 5, total: 15 }],
          output: 5,
          total: 15,
          usageComplete: false,
        },
      },
    },
    {
      expectedComplete: false,
      expectedTotal: 200_000,
      label: "a forged low total",
      reportCase: {
        attemptCount: 1,
        completedCount: 1,
        errorCode: null,
        loopSteps: 1,
        tokenUsage: {
          input: 100_000,
          ledger: [{ input: 100_000, output: 100_000, total: 1 }],
          output: 100_000,
          total: 1,
          usageComplete: true,
        },
      },
    },
    {
      expectedComplete: false,
      expectedTotal: 10,
      label: "a missing provider output count",
      reportCase: {
        attemptCount: 1,
        completedCount: 1,
        errorCode: null,
        loopSteps: 1,
        tokenUsage: {
          input: 10,
          ledger: [{ input: 10, output: null, total: 10 }],
          output: null,
          total: 10,
          usageComplete: true,
        },
      },
    },
    {
      expectedComplete: false,
      expectedTotal: 15,
      label: "a ledger shorter than loopSteps",
      reportCase: {
        attemptCount: 2,
        completedCount: 2,
        errorCode: null,
        loopSteps: 2,
        tokenUsage: {
          input: 10,
          ledger: [{ input: 10, output: 5, total: 15 }],
          output: 5,
          total: 15,
          usageComplete: true,
        },
      },
    },
    {
      expectedComplete: false,
      expectedTotal: 16,
      label: "a case aggregate that differs from its ledger",
      reportCase: {
        attemptCount: 1,
        completedCount: 1,
        errorCode: null,
        loopSteps: 1,
        tokenUsage: {
          input: 11,
          ledger: [{ input: 10, output: 5, total: 15 }],
          output: 5,
          total: 16,
          usageComplete: true,
        },
      },
    },
    {
      expectedComplete: false,
      expectedTotal: 0,
      label: "a zero-only provider ledger",
      reportCase: {
        attemptCount: 1,
        completedCount: 1,
        errorCode: null,
        loopSteps: 1,
        tokenUsage: {
          input: 0,
          ledger: [{ input: 0, output: 0, total: 0 }],
          output: 0,
          total: 0,
          usageComplete: true,
        },
      },
    },
    {
      expectedComplete: false,
      expectedTotal: 15,
      label: "an execution error with otherwise consistent usage",
      reportCase: {
        attemptCount: 1,
        completedCount: 0,
        errorCode: "EVAL_CASE_ERROR",
        loopSteps: 1,
        tokenUsage: {
          input: 10,
          ledger: [{ input: 10, output: 5, total: 15 }],
          output: 5,
          total: 15,
          usageComplete: true,
        },
      },
    },
    {
      expectedComplete: false,
      expectedTotal: 15,
      label: "a successful retry with an unobserved failed attempt",
      reportCase: {
        attemptCount: 2,
        completedCount: 1,
        errorCode: null,
        loopSteps: 1,
        tokenUsage: {
          input: 10,
          ledger: [{ input: 10, output: 5, total: 15 }],
          output: 5,
          total: 15,
          usageComplete: true,
        },
      },
    },
  ] as const)(
    "recomputes $label without trusting the report boolean",
    ({ expectedComplete, expectedTotal, reportCase }) => {
      expect(recomputeLiveEvalTokenLedger([reportCase])).toEqual({
        caseUsages: [{
          ...reportCase.tokenUsage,
          usageComplete: expectedComplete,
        }],
        providerCalls: {
          attemptCount: reportCase.attemptCount,
          completedCount: reportCase.completedCount,
        },
        tokenBudget: {
          tokenUsageComplete: expectedComplete,
          totalTokens: expectedTotal,
        },
      });
    },
  );

  it("recomputes report-level provider totals from case rows", () => {
    const regularCase = {
      attemptCount: 1,
      completedCount: 1,
      errorCode: null,
      loopSteps: 1,
      tokenUsage: {
        input: 10,
        ledger: [{ input: 10, output: 5, total: 15 }],
        output: 5,
        total: 15,
        usageComplete: true,
      },
    };
    const retriedCase = {
      ...regularCase,
      attemptCount: 2,
    };

    expect(
      recomputeLiveEvalTokenLedger([regularCase, retriedCase]),
    ).toMatchObject({
      caseUsages: [
        { usageComplete: true },
        { usageComplete: false },
      ],
      providerCalls: {
        attemptCount: 3,
        completedCount: 2,
      },
      tokenBudget: { tokenUsageComplete: false },
    });
  });
});
