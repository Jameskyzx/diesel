import { describe, expect, it } from "vitest";

import {
  parseCanonicalPlaywrightEvidence,
  parseCanonicalPlaywrightRunReceipt,
  playwrightRunContracts,
  type PlaywrightRepositoryState,
} from "../scripts/portfolio/playwright-evidence";
import {
  buildPlaywrightFailureDiagnostic,
  parseCanonicalPlaywrightFailureDiagnostic,
  playwrightFailureDiagnosticPath,
  serializeCanonicalPlaywrightFailureDiagnostic,
  type BuildPlaywrightFailureDiagnosticInput,
  type PlaywrightFailureDiagnostic,
  type PlaywrightFailureObservation,
} from "../scripts/portfolio/playwright-failure-diagnostic";

const STATE: PlaywrightRepositoryState = {
  headCommit: "a".repeat(40),
  sourceFingerprint: {
    algorithm: "sha256",
    digest: "b".repeat(64),
    fileCount: 10,
  },
  worktreeState: "dirty",
};

function observation(
  index: number,
  overrides: Partial<PlaywrightFailureObservation> = {},
): PlaywrightFailureObservation {
  return {
    attempts: 1,
    expectedStatus: "passed",
    file: "e2e/smoke.spec.ts",
    finalStatus: "passed",
    id: `failure-diagnostic-${index}`,
    line: index + 1,
    outcome: "expected",
    project: "desktop-chromium",
    retryCount: 0,
    ...overrides,
  };
}

function input(
  overrides: Partial<BuildPlaywrightFailureDiagnosticInput> = {},
): BuildPlaywrightFailureDiagnosticInput {
  return {
    id: "public",
    runStatus: "failed",
    stage: "run",
    startedAt: "2026-09-12T03:00:00.000Z",
    completedAt: "2026-09-12T03:01:00.000Z",
    globalErrorCount: 0,
    provenance: { started: STATE, completed: STATE },
    tests: [observation(0)],
    ...overrides,
  };
}

function diagnostic(): PlaywrightFailureDiagnostic {
  return buildPlaywrightFailureDiagnostic(input());
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

describe("Playwright failure diagnostics", () => {
  it("preserves the observed 268-case partial run without treating not-run tests as skips", () => {
    const tests = [
      ...Array.from({ length: 234 }, (_, index) => observation(index)),
      observation(234, { finalStatus: "failed", outcome: "unexpected" }),
      ...Array.from({ length: 31 }, (_, index) => observation(index + 235, {
        finalStatus: "skipped",
        outcome: "skipped",
      })),
      ...Array.from({ length: 2 }, (_, index) => observation(index + 266, {
        attempts: 0,
        finalStatus: null,
        outcome: "skipped",
      })),
    ];
    const value = buildPlaywrightFailureDiagnostic(input({ tests }));
    expect(value.totals).toEqual({
      collected: 268,
      passed: 234,
      failed: 1,
      timedOut: 0,
      interrupted: 0,
      skipped: 31,
      notRun: 2,
    });
    expect(value.tests.at(-1)).toMatchObject({
      attempts: 0,
      finalStatus: null,
      outcome: "skipped",
      retryCount: 0,
    });
    expect(value.projects.map(({ name }) => name)).toEqual(playwrightRunContracts[0].projects);
    expect(value.projects.slice(1).every(({ counts }) => counts.collected === 0)).toBe(true);
    expect(parseCanonicalPlaywrightFailureDiagnostic(
      serializeCanonicalPlaywrightFailureDiagnostic(value),
    )).toEqual(value);
  });

  it("partitions actual final statuses without interpreting native expected outcomes as passes", () => {
    const value = buildPlaywrightFailureDiagnostic(input({ tests: [
      observation(0, { finalStatus: "failed", expectedStatus: "failed", outcome: "expected" }),
      observation(1, { finalStatus: "timedOut", outcome: "unexpected" }),
      observation(2, { finalStatus: "interrupted", outcome: "skipped" }),
      observation(3, { finalStatus: "passed", outcome: "flaky", attempts: 2, retryCount: 1 }),
    ] }));
    expect(value.totals).toEqual({
      collected: 4, passed: 1, failed: 1, timedOut: 1, interrupted: 1, skipped: 0, notRun: 0,
    });
    expect(value.tests[0]?.outcome).toBe("expected");
    expect(value.tests[3]?.outcome).toBe("flaky");
  });

  it.each(["passed", "failed", "timedout", "interrupted"] as const)(
    "keeps the real run status %s while the reporter remains failed",
    (runStatus) => {
      const value = buildPlaywrightFailureDiagnostic(input({ runStatus }));
      expect(value.runStatus).toBe(runStatus);
      expect(value.reporterExitCode).toBe(1);
      expect(value.purpose).toBe("execution-diagnostics-only");
    },
  );

  it.each(["run", "receipt-validation", "receipt-persistence"] as const)(
    "round-trips the %s failure stage", (stage) => {
      const value = buildPlaywrightFailureDiagnostic(input({ stage }));
      expect(parseCanonicalPlaywrightFailureDiagnostic(
        serializeCanonicalPlaywrightFailureDiagnostic(value),
      ).stage).toBe(stage);
    },
  );

  it("records missing completion provenance and an empty collected suite without fabrication", () => {
    const value = buildPlaywrightFailureDiagnostic(input({
      globalErrorCount: 1,
      provenance: { started: STATE, completed: null },
      tests: [],
    }));
    expect(value.provenance.completed).toBeNull();
    expect(value.totals.collected).toBe(0);
    expect(value.projects.every(({ counts }) => counts.passed === 0)).toBe(true);
    expect(serializeCanonicalPlaywrightFailureDiagnostic(value)).not.toContain("evaluatedCommit");
  });

  it("preserves source drift for diagnosis instead of claiming one evaluated snapshot", () => {
    const changed = { ...STATE, headCommit: "c".repeat(40) };
    const value = buildPlaywrightFailureDiagnostic(input({
      provenance: { started: STATE, completed: changed },
    }));
    expect(value.provenance).toEqual({ started: STATE, completed: changed });
  });

  it.each(playwrightRunContracts)("places $id diagnostics next to its receipt", ({ id, receiptPath }) => {
    expect(playwrightFailureDiagnosticPath(id)).toBe(receiptPath.replace("playwright-run.json", "playwright-failure.json"));
  });

  it.each([
    { attempts: 0, finalStatus: "skipped" as const },
    { attempts: 0, finalStatus: null, retryCount: 1 },
    { attempts: 1, finalStatus: null },
  ])("rejects illegal unexecuted combinations: %j", (overrides) => {
    expect(() => buildPlaywrightFailureDiagnostic(input({
      tests: [observation(0, overrides)],
    }))).toThrow();
  });

  it("rejects duplicate identity and unknown projects", () => {
    expect(() => buildPlaywrightFailureDiagnostic(input({
      tests: [observation(0), observation(0)],
    }))).toThrow("duplicate test identity");
    expect(() => buildPlaywrightFailureDiagnostic(input({
      tests: [observation(0, { project: "invented-project" })],
    }))).toThrow("unknown project");
  });

  it("rejects an observation inventory beyond its fixed bound", () => {
    expect(() => buildPlaywrightFailureDiagnostic(input({
      tests: Array.from({ length: 2_001 }, (_, index) => observation(index)),
    }))).toThrow();
  });

  it("rejects a completion before its start", () => {
    expect(() => buildPlaywrightFailureDiagnostic(input({
      completedAt: "2026-09-12T02:59:59.999Z",
    }))).toThrow("completion precedes");
  });

  it.each([
    ["total counts", (value: PlaywrightFailureDiagnostic) => { value.totals.passed += 1; }],
    ["project counts", (value: PlaywrightFailureDiagnostic) => { value.projects[0]!.counts.notRun += 1; }],
    ["project matrix", (value: PlaywrightFailureDiagnostic) => { value.projects.reverse(); }],
  ] as const)("recomputes and rejects tampered %s", (_label, mutate) => {
    const value = diagnostic();
    mutate(value);
    expect(() => parseCanonicalPlaywrightFailureDiagnostic(json(value))).toThrow("drifted");
    expect(() => serializeCanonicalPlaywrightFailureDiagnostic(value)).toThrow("drifted");
  });

  it("sorts observations deterministically without mutating the input", () => {
    const tests = [observation(1), observation(0)];
    const value = buildPlaywrightFailureDiagnostic(input({ tests }));
    expect(value.tests.map(({ line }) => line)).toEqual([1, 2]);
    expect(tests.map(({ line }) => line)).toEqual([2, 1]);
    value.tests.reverse();
    expect(() => parseCanonicalPlaywrightFailureDiagnostic(json(value))).toThrow("drifted");
  });

  it.each([
    ["missing newline", (text: string) => text.trimEnd()],
    ["minified JSON", (text: string) => JSON.stringify(JSON.parse(text))],
    ["duplicate keys", (text: string) => text.replace('  "reporterExitCode": 1,', '  "reporterExitCode": 0,\n  "reporterExitCode": 1,')],
    ["invalid JSON", () => "{"],
  ] as const)("rejects %s", (_label, mutate) => {
    expect(() => parseCanonicalPlaywrightFailureDiagnostic(
      mutate(serializeCanonicalPlaywrightFailureDiagnostic(diagnostic())),
    )).toThrow();
  });

  it.each([
    { title: "private title" },
    { error: "private error" },
    { apiKey: "private credential" },
    { complete: true },
    { reporterExitCode: 0 },
  ])("rejects unapproved or success-claiming root fields: %j", (extra) => {
    expect(() => parseCanonicalPlaywrightFailureDiagnostic(json({
      ...diagnostic(), ...extra,
    }))).toThrow();
  });

  it("rejects unapproved observation fields instead of persisting arbitrary text", () => {
    const value = diagnostic();
    expect(() => parseCanonicalPlaywrightFailureDiagnostic(json({
      ...value, tests: [{ ...value.tests[0], title: "private test title" }],
    }))).toThrow();
  });

  it("cannot be admitted as a passing receipt or aggregate even when all recorded statuses passed", () => {
    const text = serializeCanonicalPlaywrightFailureDiagnostic(diagnostic());
    expect(() => parseCanonicalPlaywrightRunReceipt(text)).toThrow();
    expect(() => parseCanonicalPlaywrightEvidence(text)).toThrow();
  });
});
