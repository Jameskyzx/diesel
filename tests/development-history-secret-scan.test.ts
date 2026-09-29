import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
  summarizeRetainedHistorySecretScanOutput,
  verifyRetainedHistorySecretScan,
} from "../scripts/history/verify-development-history";

const evidencePrefix =
  "docs/evidence/fde-development-history-secret-scan-2026-09-05";
const rawPaths = {
  historyLog: `${evidencePrefix}.history-log.json`,
  historyReport: `${evidencePrefix}.history-report.json`,
  canaryLog: `${evidencePrefix}.canary-log.json`,
  canaryReport: `${evidencePrefix}.canary-report.json`,
} as const;

type CapturedOutput = {
  historyLog: unknown;
  historyReport: unknown;
  canaryLog: unknown;
  canaryReport: unknown;
};

type RetainedScanFixture = {
  manifestText: string;
  outputs: CapturedOutput;
  rawFiles: Map<string, Uint8Array>;
};

async function loadRetainedScan(): Promise<RetainedScanFixture> {
  const manifestText = await readFile(
    resolve(process.cwd(), `${evidencePrefix}.manifest.json`),
    "utf8",
  );
  const entries = await Promise.all(
    Object.values(rawPaths).map(async (path) => [
      path,
      await readFile(resolve(process.cwd(), path)),
    ] as const),
  );
  const rawFiles = new Map<string, Uint8Array>(entries);
  function parseRaw(path: string): unknown {
    const bytes = rawFiles.get(path);
    if (bytes === undefined) throw new Error("Retained test fixture is missing.");
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  }
  return {
    manifestText,
    outputs: {
      historyLog: parseRaw(rawPaths.historyLog),
      historyReport: parseRaw(rawPaths.historyReport),
      canaryLog: parseRaw(rawPaths.canaryLog),
      canaryReport: parseRaw(rawPaths.canaryReport),
    },
    rawFiles,
  };
}

function objectAtPath(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    throw new Error("Test mutation path does not identify an object.");
  }
  return value as Record<string, unknown>;
}

function mutateAtPath<Value>(
  source: Value,
  path: string,
  change: (value: unknown) => unknown,
): Value {
  const copy = structuredClone(source);
  const keys = path.split(".");
  const last = keys.pop();
  if (last === undefined) throw new Error("Test mutation needs a field.");
  let cursor = objectAtPath(copy);
  for (const key of keys) cursor = objectAtPath(cursor[key]);
  cursor[last] = change(cursor[last]);
  return copy;
}

function replaceText(pattern: RegExp, replacement: string) {
  return (value: unknown): string => {
    if (typeof value !== "string" || !pattern.test(value)) {
      throw new Error("Test diagnostic mutation did not match its fixture.");
    }
    return value.replace(pattern, replacement);
  };
}

const expectedObserved = {
  history: {
    exitCode: 0,
    signal: null,
    errorCode: null,
    scannerReportedCommitCount: 50,
    findingCount: 0,
  },
  canary: {
    exitCode: 97,
    findingCount: 1,
    ruleId: "github-pat",
    redaction: "full",
  },
};

describe("retained development-history secret scan", () => {
  let fixture: RetainedScanFixture;
  beforeAll(async () => {
    fixture = await loadRetainedScan();
  });

  it("recomputes the observed summary from the retained raw outputs", () => {
    expect(summarizeRetainedHistorySecretScanOutput(fixture.outputs))
      .toEqual(expectedObserved);
  });

  it("verifies the real manifest and all four retained byte sequences", () => {
    expect(verifyRetainedHistorySecretScan(fixture)).toEqual(expectedObserved);
  });

  it("treats the scanner count as its own observation, not Git cardinality", () => {
    const outputs = mutateAtPath(
      fixture.outputs,
      "historyLog.stderr",
      replaceText(/\bINF \d+ commits scanned\./u, "INF 49 commits scanned."),
    );
    expect(summarizeRetainedHistorySecretScanOutput(outputs)).toEqual({
      ...expectedObserved,
      history: { ...expectedObserved.history, scannerReportedCommitCount: 49 },
    });
  });

  // Exercise the semantic parser directly: stale manifest hashes must not
  // intercept these cases before the diagnostic/report contract is evaluated.
  it.each([
    {
      name: "error diagnostics alongside exit zero and success summaries",
      path: "historyLog.stderr",
      change: (value: unknown) =>
        `${String(value)}12:00PM ERR failed to scan Git repository error="synthetic"\n`,
    },
    {
      name: "a missing scanner count",
      path: "historyLog.stderr",
      change: replaceText(/^.*\bINF \d+ commits scanned\.\n/mu, ""),
    },
    {
      name: "duplicate scanner counts",
      path: "historyLog.stderr",
      change: replaceText(/^.*\bINF \d+ commits scanned\.\n/mu, "$&$&"),
    },
    {
      name: "zero scanned commits",
      path: "historyLog.stderr",
      change: replaceText(/\bINF \d+ commits scanned\./u, "INF 0 commits scanned."),
    },
    {
      name: "a missing completion diagnostic",
      path: "historyLog.stderr",
      change: replaceText(/^.*\bINF scan completed in [^\n]+\n/mu, ""),
    },
    {
      name: "duplicate completion diagnostics",
      path: "historyLog.stderr",
      change: replaceText(/^.*\bINF scan completed in [^\n]+\n/mu, "$&$&"),
    },
    {
      name: "a missing no-leaks diagnostic",
      path: "historyLog.stderr",
      change: replaceText(/^.*\bINF no leaks found\n/mu, ""),
    },
    {
      name: "duplicate no-leaks diagnostics",
      path: "historyLog.stderr",
      change: replaceText(/^.*\bINF no leaks found\n/mu, "$&$&"),
    },
    { name: "a nonzero history exit", path: "historyLog.exitCode", change: () => 1 },
    { name: "a history signal", path: "historyLog.signal", change: () => "SIGTERM" },
    { name: "nonempty history findings", path: "historyReport", change: () => [{}] },
    { name: "a successful canary exit", path: "canaryLog.exitCode", change: () => 0 },
    { name: "the wrong canary rule", path: "canaryReport.0.RuleID", change: () => "other-rule" },
    { name: "the wrong canary file", path: "canaryReport.0.File", change: () => "other.env" },
    { name: "an unredacted canary match", path: "canaryReport.0.Match", change: () => "synthetic-unredacted-match" },
    { name: "an unredacted canary secret", path: "canaryReport.0.Secret", change: () => "synthetic-unredacted-secret" },
    {
      name: "multiple canary findings",
      path: "canaryReport",
      change: (value: unknown) => {
        if (!Array.isArray(value)) throw new Error("Canary fixture is not an array.");
        return [...value, ...value];
      },
    },
  ])("rejects $name from raw semantics", ({ path, change }) => {
    const outputs = mutateAtPath(fixture.outputs, path, change);
    expect(() => summarizeRetainedHistorySecretScanOutput(outputs)).toThrow();
  });

  it("rejects a missing retained raw file", () => {
    const rawFiles = new Map(fixture.rawFiles);
    rawFiles.delete(rawPaths.historyReport);
    expect(() => verifyRetainedHistorySecretScan({
      manifestText: fixture.manifestText,
      rawFiles,
    })).toThrow();
  });

  it("rejects changed bytes even when length and decoded JSON are unchanged", () => {
    const rawFiles = new Map(fixture.rawFiles);
    const replacement = Buffer.from("[ ]", "utf8");
    expect(replacement.byteLength).toBe(rawFiles.get(rawPaths.historyReport)?.byteLength);
    expect(JSON.parse(replacement.toString("utf8")) as unknown).toEqual([]);
    rawFiles.set(rawPaths.historyReport, replacement);
    expect(() => verifyRetainedHistorySecretScan({
      manifestText: fixture.manifestText,
      rawFiles,
    })).toThrow();
  });

  it.each([
    { name: "raw byte length", path: "raw.history.report.byteLength", value: 999 },
    { name: "raw digest", path: "raw.history.report.sha256", value: "0".repeat(64) },
    { name: "raw path", path: "raw.history.report.path", value: "docs/evidence/unexpected.json" },
    { name: "observed summary", path: "observed.history.scannerReportedCommitCount", value: 49 },
    { name: "source commit", path: "subject.commit", value: "0".repeat(40) },
    { name: "source scope", path: "sourceScope.fullHistory", value: false },
    { name: "policy provenance", path: "policy.sourceCommit", value: "0".repeat(40) },
    { name: "tool version", path: "tool.version", value: "8.21.3" },
    { name: "recorded date", path: "recordedDate", value: "2026-09-06" },
    { name: "license-review claim", path: "licenseReview", value: "passed" },
    { name: "publication effect", path: "publicationEffect", value: "approved" },
    { name: "evidence level", path: "evidenceLevel", value: "independently-replayed" },
    { name: "an extra manifest field", path: "unreviewedClaim", value: true },
  ])("rejects manifest drift in $name", ({ path, value }) => {
    const manifest: unknown = JSON.parse(fixture.manifestText);
    const changed = mutateAtPath(manifest, path, () => value);
    expect(() => verifyRetainedHistorySecretScan({
      manifestText: `${JSON.stringify(changed, null, 2)}\n`,
      rawFiles: fixture.rawFiles,
    })).toThrow();
  });
});
