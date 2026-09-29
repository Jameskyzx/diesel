import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { liveEvalReportSchema } from "../scripts/portfolio/live-eval-report-schema";
import {
  buildPlaywrightEvidence,
  buildPlaywrightRunReceipt,
  playwrightRunContracts,
  serializeCanonicalPlaywrightEvidence,
  sha256Text,
  type PlaywrightEvidence,
  type PlaywrightRepositoryState,
  type PlaywrightTestObservation,
} from "../scripts/portfolio/playwright-evidence";
import {
  assertBrowserSnapshotConsistency,
  assertEvidenceSummaryConsistency,
  assertEvidenceSummaryProseConsistency,
  assertQualitySnapshotConsistency,
  assertReleaseProseConsistency,
  assertReleaseSnapshotConsistency,
  assertNoConcreteCurrentLiveEvalClaims,
  assertStatusLiveEvalProseConsistency,
  countVitestRunnableJson,
  formatStatusLiveEvalProse,
  formatStatusQualityProse,
  parseCurrentBrowserProse,
  parseCurrentQualityProse,
  parseCurrentReleaseProse,
  parseEvidenceSummaryProse,
  parseStatusSnapshot,
  type EvidenceSummary,
  type StatusSnapshot,
} from "../scripts/portfolio/status-snapshot";
import {
  VITEST_EXECUTION_EVIDENCE_VERSION,
  vitestExecutionEvidencePath,
} from "../scripts/portfolio/vitest-execution-evidence";

const releaseSha = "a".repeat(40);
const previousReleaseSha = "b".repeat(40);
const alternateSha = "c".repeat(40);
const observedAt = "2026-08-31T12:00+08:00";
const browserRunId = "11111111-1111-4111-8111-111111111111";
const alternateBrowserRunId = "22222222-2222-4222-8222-222222222222";
const temporaryInventoryWorkspaces: string[] = [];

afterEach(() => {
  while (temporaryInventoryWorkspaces.length > 0) {
    const workspace = temporaryInventoryWorkspaces.pop();
    if (workspace !== undefined) {
      rmSync(workspace, { force: true, recursive: true });
    }
  }
});

function createTemporaryInventoryWorkspace(): string {
  const workspace = mkdtempSync(
    join(realpathSync(tmpdir()), "diesel-vitest-inventory-"),
  );
  temporaryInventoryWorkspaces.push(workspace);
  return workspace;
}

const browserRepositoryState: PlaywrightRepositoryState = {
  headCommit: releaseSha,
  sourceFingerprint: {
    algorithm: "sha256",
    digest: "e".repeat(64),
    fileCount: 200,
  },
  worktreeState: "dirty",
};

const browserRunExpectations = [
  { collected: 10, skipped: 2 },
  { collected: 4, skipped: 0 },
  { collected: 4, skipped: 2 },
  { collected: 1, skipped: 0 },
] as const;

function buildBrowserEvidence(): PlaywrightEvidence {
  const receipts = playwrightRunContracts.map((contract, contractIndex) => {
    const expectation = browserRunExpectations[contractIndex];
    if (!expectation) {
      throw new Error("Synthetic Playwright expectation is missing.");
    }
    const tests = Array.from(
      { length: expectation.collected },
      (_, testIndex): PlaywrightTestObservation => {
        const project = contract.projects[testIndex % contract.projects.length];
        if (!project) {
          throw new Error("Synthetic Playwright project is missing.");
        }
        const skipped = testIndex < expectation.skipped;
        return {
          attempts: 1,
          expectedStatus: skipped ? "skipped" : "passed",
          file: `e2e/browser-${contract.id}-${testIndex}.spec.ts`,
          finalStatus: skipped ? "skipped" : "passed",
          id: `${contract.id.replaceAll("-", "_")}_${testIndex}`,
          line: testIndex + 1,
          outcome: skipped ? "skipped" : "expected",
          project,
          retryCount: 0,
        };
      },
    );
    const minute = 52 + contractIndex * 2;
    return buildPlaywrightRunReceipt({
      completedAt: contractIndex === playwrightRunContracts.length - 1
        ? observedAt
        : `2026-08-31T11:${String(minute + 1).padStart(2, "0")}+08:00`,
      globalErrorCount: 0,
      id: contract.id,
      playwrightVersion: "1.62.0",
      provenance: {
        completed: browserRepositoryState,
        started: browserRepositoryState,
      },
      runStatus: "passed",
      startedAt:
        `2026-08-31T11:${String(minute).padStart(2, "0")}+08:00`,
      tests,
    });
  });
  return buildPlaywrightEvidence(receipts, browserRunId);
}

function buildBrowserArtifact(): {
  evidence: PlaywrightEvidence;
  text: string;
} {
  const evidence = buildBrowserEvidence();
  return {
    evidence,
    text: serializeCanonicalPlaywrightEvidence(evidence),
  };
}

const releaseProse = [
  "- 公开只读演示：https://example.invalid。只读核验中，",
  `  observedAt=\`${observedAt}\`；\`/api/health\` readbackAt=\`${observedAt}\` returned \`status=ok\`,`,
  `  \`version=${releaseSha}\`；服务器当前 release 链接解析为`,
  `  \`/opt/diesel/releases/${releaseSha}\`。因此当前公开 release ID`,
  "  与 Git commit 均为该完整 SHA；同时观测的本地 `master` 和只读",
  "  `git ls-remote origin master` 也均为该 SHA。",
  "  该记录的证据类型固定为 `historical-operator-record-only`。",
  "- 最后一个完整记录了发布步骤与独立读回的时间戳 release lineage 仍是",
  `  release \`20260814144537\` / Git \`${previousReleaseSha}\`。`,
].join("\n");

const evidenceProse = [
  "- `ACCEPTANCE.md` #166–#264 已发布；选择闭包为",
  "  `97 jurisdictions / 28 regulations / 651 limits / 203 sources`。",
  "| 真实产品/认证 | 0 条获准公开 fixture | 产品适配示例为 Demo |",
].join("\n");

function buildSnapshot(): StatusSnapshot {
  const { evidence, text } = buildBrowserArtifact();
  return {
    browserSnapshot: {
      artifactByteLength: Buffer.byteLength(text, "utf8"),
      artifactPath: "docs/evidence/playwright-e2e-latest.json",
      artifactSha256: sha256Text(text),
      baseHeadCommit: evidence.provenance.baseHeadCommit,
      evaluatedCommit: evidence.provenance.evaluatedCommit,
      observedAt: evidence.evaluatedAt,
      runId: evidence.runId,
      runs: evidence.runs.map(({ id, totals }) => ({
        collected: totals.collected,
        failed: totals.failed,
        flaky: totals.flaky,
        passed: totals.passed,
        skipped: totals.skipped,
        id,
      })),
      sourceFingerprint: evidence.provenance.sourceFingerprint,
      version: evidence.version,
      worktreeState: evidence.provenance.worktreeState,
    },
    currentPublicRelease: {
      commit: releaseSha,
      evidenceKind: "historical-operator-record-only",
      id: releaseSha,
      observedAt,
      releasePath: `/opt/diesel/releases/${releaseSha}`,
    },
    evidenceSummary: {
      approvedRealCertifications: 0,
      approvedRealProducts: 0,
      jurisdictions: 97,
      limits: 651,
      regulations: 28,
      sources: 203,
    },
    lastDocumentedRelease: {
      commit: previousReleaseSha,
      id: "20260814144537",
    },
    liveEval: {
      archivePath:
        "docs/evals/archive/ai-live-eval-20260831T120000000Z-11111111-1111-4111-8111-111111111111.json",
      attemptCount: 0,
      complete: false,
      completedCount: 0,
      evaluatedAt: "2026-08-31T12:00:00.000Z",
      expectedModelId: "server-openai-compatible/example-model",
      expectedProviderProfile: {
        adapter: "@ai-sdk/openai-compatible",
        adapterContractVersion: 1,
        enableThinking: false,
        endpointSha256: "d".repeat(64),
        includeUsage: true,
      },
      latestOutcome: "failed",
      latestSampleCount: 0,
      modelStepCount: 0,
      reportVersion: "sales-chat-live-v11",
      runError: null,
      runId: browserRunId,
      sourceFingerprint: {
        algorithm: "sha256",
        digest: "f".repeat(64),
        fileCount: 240,
        status: "captured",
      },
      suiteVersion: "sales-chat-live-v12",
      suiteCaseCount: 18,
      terminationReason: "initialization_error",
      thresholdsPassed: false,
      tokenUsageComplete: false,
      totalTokens: 0,
    },
    publicRuntime: {
      evidenceKind: "historical-operator-record-only",
      readbackAt: observedAt,
      status: "ok",
      version: releaseSha,
    },
    qualitySnapshot: {
      artifactPath: vitestExecutionEvidencePath,
      version: VITEST_EXECUTION_EVIDENCE_VERSION,
    },
    repositoryHead: {
      local: releaseSha,
      observedAt,
      remote: releaseSha,
    },
  };
}

function buildBrowserProse(
  snapshot: StatusSnapshot["browserSnapshot"] = buildSnapshot().browserSnapshot,
): string {
  const totals = snapshot.runs.reduce(
    (result, run) => ({
      collected: result.collected + run.collected,
      failed: result.failed + run.failed,
      flaky: result.flaky + run.flaky,
      passed: result.passed + run.passed,
      skipped: result.skipped + run.skipped,
    }),
    { collected: 0, failed: 0, flaky: 0, passed: 0, skipped: 0 },
  );
  return [
    `- 当前浏览器证据快照：format \`${snapshot.version}\`，run ID \`${snapshot.runId}\`，artifact SHA-256 \`${snapshot.artifactSha256}\`；`,
    `  observedAt \`${snapshot.observedAt}\`，${snapshot.worktreeState} worktree / base HEAD \`${snapshot.baseHeadCommit}\`；`,
    ...snapshot.runs.map(({ collected, failed, flaky, id, passed, skipped }) =>
      `  \`${id}\` = \`${passed} passed / ${skipped} skipped / ${failed} failed / ${flaky} flaky / ${collected} collected\`；`
    ),
    `  聚合为 ${totals.passed} passed / ${totals.skipped} skipped / ${totals.failed} failed / ${totals.flaky} flaky / ${totals.collected} collected。artifact 为 ${snapshot.artifactByteLength} bytes；`,
    `  browser source fingerprint 为 ${snapshot.sourceFingerprint.fileCount} files / \`${snapshot.sourceFingerprint.digest}\`。`,
    `  因运行发生在 ${snapshot.worktreeState} worktree，\`evaluatedCommit=${snapshot.evaluatedCommit ?? "null"}\`；它绑定实际源码。`,
  ].join("\n");
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function snapshotMarkdownFromJson(
  snapshotJson: string,
  lineEnding = "\n",
): string {
  return [
    "# Status",
    "<!-- portfolio-verification:start -->",
    "```json",
    snapshotJson,
    "```",
    "<!-- portfolio-verification:end -->",
  ].join(lineEnding);
}

function snapshotMarkdown(snapshot: unknown): string {
  return snapshotMarkdownFromJson(JSON.stringify(snapshot, null, 2));
}

describe("portfolio status snapshot parsing", () => {
  it("parses the marked JSON block without reading surrounding prose", () => {
    expect(parseStatusSnapshot(snapshotMarkdown(buildSnapshot()))).toEqual(
      buildSnapshot(),
    );
  });

  it("accepts CRLF and boundary whitespace around canonical JSON", () => {
    const snapshot = buildSnapshot();
    const json = ` \r\n${JSON.stringify(snapshot, null, 2).replaceAll(
      "\n",
      "\r\n",
    )}\r\n\t`;

    expect(parseStatusSnapshot(snapshotMarkdownFromJson(json, "\r\n"))).toEqual(
      snapshot,
    );
  });

  it.each([
    {
      name: "non-canonical formatting",
      json: JSON.stringify(buildSnapshot()),
    },
    {
      name: "duplicate top-level key",
      json: JSON.stringify(buildSnapshot(), null, 2).replace(
        '  "currentPublicRelease": {',
        '  "currentPublicRelease": null,\n  "currentPublicRelease": {',
      ),
    },
    {
      name: "duplicate nested key",
      json: JSON.stringify(buildSnapshot(), null, 2).replace(
        '    "sources": 203',
        '    "sources": 999,\n    "sources": 203',
      ),
    },
  ])("rejects $name in the machine snapshot", ({ json }) => {
    expect(() => parseStatusSnapshot(snapshotMarkdownFromJson(json))).toThrow(
      "canonical two-space JSON without duplicate keys",
    );
  });

  it.each([
    {
      name: "invalid release SHA",
      mutate(snapshot: StatusSnapshot) {
        snapshot.currentPublicRelease.commit = "not-a-sha";
      },
    },
    {
      name: "negative evidence count",
      mutate(snapshot: StatusSnapshot) {
        snapshot.evidenceSummary.sources = -1;
      },
    },
    {
      name: "invalid provider profile coupling",
      mutate(snapshot: StatusSnapshot) {
        snapshot.liveEval.expectedProviderProfile = {
          adapter: "portfolio-demo",
          adapterContractVersion: 1,
          enableThinking: false,
          endpointSha256: null,
          includeUsage: false,
        };
      },
    },
  ])("rejects $name", ({ mutate }) => {
    const snapshot = buildSnapshot();
    mutate(snapshot);
    expect(() => parseStatusSnapshot(snapshotMarkdown(snapshot))).toThrow();
  });

  it.each([
    {
      name: "top level",
      snapshot: { ...buildSnapshot(), unexpected: true },
    },
    {
      name: "browser snapshot",
      snapshot: {
        ...buildSnapshot(),
        browserSnapshot: {
          ...buildSnapshot().browserSnapshot,
          unexpected: true,
        },
      },
    },
    {
      name: "browser source fingerprint",
      snapshot: {
        ...buildSnapshot(),
        browserSnapshot: {
          ...buildSnapshot().browserSnapshot,
          sourceFingerprint: {
            ...buildSnapshot().browserSnapshot.sourceFingerprint,
            unexpected: true,
          },
        },
      },
    },
    {
      name: "browser run summary",
      snapshot: {
        ...buildSnapshot(),
        browserSnapshot: {
          ...buildSnapshot().browserSnapshot,
          runs: buildSnapshot().browserSnapshot.runs.map((run, index) =>
            index === 0 ? { ...run, unexpected: true } : run
          ),
        },
      },
    },
    {
      name: "current public release",
      snapshot: {
        ...buildSnapshot(),
        currentPublicRelease: {
          ...buildSnapshot().currentPublicRelease,
          unexpected: true,
        },
      },
    },
    {
      name: "evidence summary",
      snapshot: {
        ...buildSnapshot(),
        evidenceSummary: {
          ...buildSnapshot().evidenceSummary,
          unexpected: true,
        },
      },
    },
    {
      name: "live eval",
      snapshot: {
        ...buildSnapshot(),
        liveEval: { ...buildSnapshot().liveEval, unexpected: true },
      },
    },
    {
      name: "live eval provider profile",
      snapshot: {
        ...buildSnapshot(),
        liveEval: {
          ...buildSnapshot().liveEval,
          expectedProviderProfile: {
            ...buildSnapshot().liveEval.expectedProviderProfile,
            unexpected: true,
          },
        },
      },
    },
    {
      name: "last documented release",
      snapshot: {
        ...buildSnapshot(),
        lastDocumentedRelease: {
          ...buildSnapshot().lastDocumentedRelease,
          unexpected: true,
        },
      },
    },
    {
      name: "public runtime",
      snapshot: {
        ...buildSnapshot(),
        publicRuntime: { ...buildSnapshot().publicRuntime, unexpected: true },
      },
    },
    {
      name: "quality snapshot",
      snapshot: {
        ...buildSnapshot(),
        qualitySnapshot: {
          ...buildSnapshot().qualitySnapshot,
          unexpected: true,
        },
      },
    },
    {
      name: "repository head",
      snapshot: {
        ...buildSnapshot(),
        repositoryHead: { ...buildSnapshot().repositoryHead, unexpected: true },
      },
    },
  ])("rejects unknown fields at the $name object level", ({ snapshot }) => {
    expect(() => parseStatusSnapshot(snapshotMarkdown(snapshot))).toThrow();
  });

  it.each([
    ["an invalid month", "2026-13-31T12:00+08:00"],
    ["an invalid calendar date", "2026-02-30T12:00+08:00"],
    ["an invalid offset", "2026-08-31T12:00+99:99"],
    ["second precision", "2026-08-31T12:00:00+08:00"],
    ["no UTC offset", "2026-08-31T12:00"],
  ])("rejects %s in minute-precision observations", (_name, timestamp) => {
    const snapshot = buildSnapshot();
    snapshot.currentPublicRelease.observedAt = timestamp;
    expect(() => parseStatusSnapshot(snapshotMarkdown(snapshot))).toThrow();
  });

  it("rejects duplicate machine snapshot blocks", () => {
    const first = snapshotMarkdown(buildSnapshot());
    const second = buildSnapshot();
    second.evidenceSummary.sources = 999;
    expect(() =>
      parseStatusSnapshot(`${first}\n${snapshotMarkdown(second)}`)
    ).toThrow("exactly one portfolio verification snapshot");
  });

  it.each([
    {
      name: "missing marker",
      markdown: "# Status\nNo machine snapshot.",
      message:
        "docs/STATUS.md must contain exactly one portfolio verification snapshot.",
    },
    {
      name: "malformed JSON",
      markdown:
        "<!-- portfolio-verification:start -->\n```json\n{\n```\n<!-- portfolio-verification:end -->",
      message: "Expected property name or '}'",
    },
  ])("rejects $name", ({ markdown, message }) => {
    expect(() => parseStatusSnapshot(markdown)).toThrow(message);
  });
});

describe("portfolio browser evidence semantics", () => {
  it("parses the canonical prose and binds it to the canonical artifact", () => {
    const snapshot = buildSnapshot().browserSnapshot;
    const prose = parseCurrentBrowserProse(buildBrowserProse(snapshot));
    const { evidence, text } = buildBrowserArtifact();

    expect(prose).toEqual({
      artifactByteLength: snapshot.artifactByteLength,
      artifactSha256: snapshot.artifactSha256,
      baseHeadCommit: snapshot.baseHeadCommit,
      evaluatedCommit: snapshot.evaluatedCommit,
      observedAt: snapshot.observedAt,
      runId: snapshot.runId,
      runs: snapshot.runs,
      sourceFingerprint: snapshot.sourceFingerprint,
      totals: {
        collected: 19,
        failed: 0,
        flaky: 0,
        passed: 15,
        skipped: 4,
      },
      version: snapshot.version,
      worktreeState: snapshot.worktreeState,
    });
    expect(snapshot.artifactByteLength).toBe(Buffer.byteLength(text, "utf8"));
    expect(snapshot.artifactSha256).toBe(sha256Text(text));
    expect(() =>
      assertBrowserSnapshotConsistency(snapshot, prose, evidence, text)
    ).not.toThrow();
  });

  it("ignores HTML-comment and fenced-code decoys", () => {
    const canonical = buildBrowserProse();
    const driftedSnapshot = clone(buildSnapshot().browserSnapshot);
    driftedSnapshot.artifactSha256 = "d".repeat(64);
    const drifted = buildBrowserProse(driftedSnapshot);

    expect(
      parseCurrentBrowserProse(
        `<!--\n${drifted}\n-->\n~~~~md\n${drifted}\n~~~~\n${canonical}`,
      ),
    ).toEqual(parseCurrentBrowserProse(canonical));
  });

  it.each([
    {
      name: "a missing browser bullet",
      markdown: "# Status",
      message: "exactly one current Playwright evidence bullet",
    },
    {
      name: "duplicate visible browser bullets",
      markdown: `${buildBrowserProse()}\n${buildBrowserProse()}`,
      message: "exactly one current Playwright evidence bullet",
    },
    {
      name: "a missing suite result",
      markdown: buildBrowserProse()
        .split("\n")
        .filter((line) => !line.includes("`demo` ="))
        .join("\n"),
      message: "missing the demo Playwright result",
    },
    {
      name: "a duplicate suite result inside one bullet",
      markdown: `${buildBrowserProse()}\n  \`public\` = \`8 passed / 2 skipped / 0 failed / 0 flaky / 10 collected\`；`,
      message: "missing the public Playwright result",
    },
    {
      name: "a malformed evidence identity",
      markdown: buildBrowserProse().replace(browserRunId, "not-a-uuid"),
      message: "canonical Playwright evidence identity",
    },
  ])("rejects $name", ({ markdown, message }) => {
    expect(() => parseCurrentBrowserProse(markdown)).toThrow(message);
  });

  it.each([
    {
      name: "artifact byte length",
      mutate(snapshot: StatusSnapshot["browserSnapshot"]) {
        snapshot.artifactByteLength += 1;
      },
    },
    {
      name: "artifact hash",
      mutate(snapshot: StatusSnapshot["browserSnapshot"]) {
        snapshot.artifactSha256 = "d".repeat(64);
      },
    },
    {
      name: "base HEAD",
      mutate(snapshot: StatusSnapshot["browserSnapshot"]) {
        snapshot.baseHeadCommit = alternateSha;
      },
    },
    {
      name: "evaluated commit",
      mutate(snapshot: StatusSnapshot["browserSnapshot"]) {
        snapshot.evaluatedCommit = alternateSha;
      },
    },
    {
      name: "observation time",
      mutate(snapshot: StatusSnapshot["browserSnapshot"]) {
        snapshot.observedAt = "2026-08-31T12:01+08:00";
      },
    },
    {
      name: "run ID",
      mutate(snapshot: StatusSnapshot["browserSnapshot"]) {
        snapshot.runId = alternateBrowserRunId;
      },
    },
    {
      name: "run result",
      mutate(snapshot: StatusSnapshot["browserSnapshot"]) {
        const run = snapshot.runs[0];
        if (!run) throw new Error("Synthetic browser run is missing.");
        run.passed -= 1;
        run.failed += 1;
      },
    },
    {
      name: "run matrix order",
      mutate(snapshot: StatusSnapshot["browserSnapshot"]) {
        snapshot.runs.reverse();
      },
    },
    {
      name: "source fingerprint",
      mutate(snapshot: StatusSnapshot["browserSnapshot"]) {
        snapshot.sourceFingerprint.digest = "d".repeat(64);
      },
    },
    {
      name: "worktree state",
      mutate(snapshot: StatusSnapshot["browserSnapshot"]) {
        snapshot.worktreeState = "clean";
      },
    },
  ])("fails closed on machine snapshot $name drift", ({ mutate }) => {
    const snapshot = clone(buildSnapshot().browserSnapshot);
    const { evidence, text } = buildBrowserArtifact();
    mutate(snapshot);

    expect(() =>
      assertBrowserSnapshotConsistency(
        snapshot,
        parseCurrentBrowserProse(buildBrowserProse()),
        evidence,
        text,
      )
    ).toThrow("STATUS Playwright artifact snapshot drifted");
  });

  it.each([
    ["an appended byte", (text: string) => `${text} `],
    [
      "a changed payload byte",
      (text: string) => text.replace(browserRunId, alternateBrowserRunId),
    ],
  ])("fails closed when the artifact has %s", (_name, mutate) => {
    const snapshot = buildSnapshot().browserSnapshot;
    const { evidence, text } = buildBrowserArtifact();

    expect(() =>
      assertBrowserSnapshotConsistency(
        snapshot,
        parseCurrentBrowserProse(buildBrowserProse(snapshot)),
        evidence,
        mutate(text),
      )
    ).toThrow("STATUS Playwright artifact snapshot drifted");
  });

  it.each([
    {
      name: "artifact hash",
      mutate(prose: ReturnType<typeof parseCurrentBrowserProse>) {
        prose.artifactSha256 = "d".repeat(64);
      },
    },
    {
      name: "base HEAD",
      mutate(prose: ReturnType<typeof parseCurrentBrowserProse>) {
        prose.baseHeadCommit = alternateSha;
      },
    },
    {
      name: "observation time",
      mutate(prose: ReturnType<typeof parseCurrentBrowserProse>) {
        prose.observedAt = "2026-08-31T12:01+08:00";
      },
    },
    {
      name: "run ID",
      mutate(prose: ReturnType<typeof parseCurrentBrowserProse>) {
        prose.runId = alternateBrowserRunId;
      },
    },
    {
      name: "run result",
      mutate(prose: ReturnType<typeof parseCurrentBrowserProse>) {
        const run = prose.runs[0];
        if (!run) throw new Error("Synthetic browser prose run is missing.");
        run.passed -= 1;
        run.failed += 1;
      },
    },
    {
      name: "format version",
      mutate(prose: ReturnType<typeof parseCurrentBrowserProse>) {
        prose.version = "diesel-playwright-evidence-v2";
      },
    },
    {
      name: "worktree state",
      mutate(prose: ReturnType<typeof parseCurrentBrowserProse>) {
        prose.worktreeState = "clean";
      },
    },
    {
      name: "artifact byte length",
      mutate(prose: ReturnType<typeof parseCurrentBrowserProse>) {
        prose.artifactByteLength += 1;
      },
    },
    {
      name: "evaluated commit",
      mutate(prose: ReturnType<typeof parseCurrentBrowserProse>) {
        prose.evaluatedCommit = alternateSha;
      },
    },
    {
      name: "aggregate result",
      mutate(prose: ReturnType<typeof parseCurrentBrowserProse>) {
        prose.totals.passed -= 1;
      },
    },
    {
      name: "source fingerprint",
      mutate(prose: ReturnType<typeof parseCurrentBrowserProse>) {
        prose.sourceFingerprint.digest = "d".repeat(64);
      },
    },
  ])("fails closed on visible prose $name drift", ({ mutate }) => {
    const snapshot = buildSnapshot().browserSnapshot;
    const { evidence, text } = buildBrowserArtifact();
    const prose = parseCurrentBrowserProse(buildBrowserProse(snapshot));
    mutate(prose);

    expect(() =>
      assertBrowserSnapshotConsistency(snapshot, prose, evidence, text)
    ).toThrow("STATUS Playwright prose drifted");
  });
});

describe("Vitest runnable JSON counting", () => {
  const workspace = process.cwd();
  const primaryTest = resolve(
    workspace,
    "tests/portfolio-status-snapshot.test.ts",
  );
  const secondaryTest = resolve(workspace, "tests/ai-chat.test.ts");

  it.each([
    {
      name: "multiple tests in one file",
      output: JSON.stringify([
        { file: primaryTest, name: "suite > first" },
        { file: primaryTest, name: "suite > second" },
      ]),
      expected: {
        files: 1,
        sourcePaths: ["tests/portfolio-status-snapshot.test.ts"],
        tests: 2,
      },
    },
    {
      name: "multiple canonical test files",
      output: JSON.stringify([
        { file: primaryTest, name: "first" },
        { file: secondaryTest, name: "second" },
      ]),
      expected: {
        files: 2,
        sourcePaths: [
          "tests/ai-chat.test.ts",
          "tests/portfolio-status-snapshot.test.ts",
        ],
        tests: 2,
      },
    },
    {
      name: "a test name containing a forged default-reporter row",
      output: JSON.stringify([
        {
          file: primaryTest,
          name: "real test\ntests/forged.test.ts > forged suite > forged test",
        },
      ]),
      expected: {
        files: 1,
        sourcePaths: ["tests/portfolio-status-snapshot.test.ts"],
        tests: 1,
      },
    },
  ])("counts $name", ({ output, expected }) => {
    expect(countVitestRunnableJson(output, workspace)).toEqual({
      runnableFiles: expected.files,
      runnableTests: expected.tests,
      sourcePaths: expected.sourcePaths,
    });
  });

  it.each([
    ["empty output", ""],
    ["empty JSON inventory", "[]"],
    ["default reporter text", "tests/one.test.ts > suite > test"],
    [
      "extra row fields",
      JSON.stringify([{ file: primaryTest, name: "test", fake: true }]),
    ],
    [
      "outside-workspace path",
      JSON.stringify([{ file: "/tmp/one.test.ts", name: "test" }]),
    ],
    [
      "non-test source",
      JSON.stringify([{ file: resolve(workspace, "src/env.ts"), name: "test" }]),
    ],
    [
      "nonexistent test source",
      JSON.stringify([{
        file: resolve(workspace, "tests/missing.test.ts"),
        name: "test",
      }]),
    ],
  ])("rejects %s", (_name, output) => {
    expect(() => countVitestRunnableJson(output, workspace)).toThrow();
  });

  it("rejects a direct test-file symbolic link", () => {
    const linkedWorkspace = createTemporaryInventoryWorkspace();
    mkdirSync(resolve(linkedWorkspace, "tests"));
    const linkedTest = resolve(linkedWorkspace, "tests/linked.test.ts");
    symlinkSync(primaryTest, linkedTest);

    expect(() => countVitestRunnableJson(
      JSON.stringify([{ file: linkedTest, name: "test" }]),
      linkedWorkspace,
    )).toThrow(/not a regular file/u);
  });

  it("rejects a test source below a symbolic-link ancestor", () => {
    const linkedWorkspace = createTemporaryInventoryWorkspace();
    symlinkSync(resolve(workspace, "tests"), resolve(linkedWorkspace, "tests"));
    const linkedTest = resolve(linkedWorkspace, "tests/ai-chat.test.ts");

    expect(() => countVitestRunnableJson(
      JSON.stringify([{ file: linkedTest, name: "test" }]),
      linkedWorkspace,
    )).toThrow(/traverses a symbolic link/u);
  });
});

describe("portfolio quality evidence semantics", () => {
  const snapshot = buildSnapshot().qualitySnapshot;
  const prose = formatStatusQualityProse(snapshot);

  it("keeps the checked-in STATUS pointer aligned with its machine snapshot", async () => {
    const markdown = await readFile(resolve(process.cwd(), "docs/STATUS.md"), "utf8");
    const statusSnapshot = parseStatusSnapshot(markdown);

    expect(() =>
      assertQualitySnapshotConsistency(
        statusSnapshot.qualitySnapshot,
        parseCurrentQualityProse(markdown),
      )
    ).not.toThrow();
  });

  it("parses and binds the single static execution-evidence pointer", () => {
    expect(parseCurrentQualityProse(prose)).toEqual({
      artifactPath: vitestExecutionEvidencePath,
      version: VITEST_EXECUTION_EVIDENCE_VERSION,
    });
    expect(() =>
      assertQualitySnapshotConsistency(
        snapshot,
        parseCurrentQualityProse(prose),
      )
    ).not.toThrow();
  });

  it("keeps dynamic observations out of the STATUS pointer prose", () => {
    expect(prose).not.toContain("129");
    expect(prose).not.toContain("2465");
    expect(prose).not.toContain(observedAt);
    expect(prose).not.toContain(releaseSha);
    expect(prose).not.toContain("e".repeat(64));
    expect(prose).toContain(
      "动态测试计数、执行时间、HEAD 与 source fingerprint 仅从该 artifact 派生",
    );
  });

  it("ignores HTML-comment and fenced-code pointer decoys", () => {
    const drifted = prose
      .replace(vitestExecutionEvidencePath, "docs/evidence/forged.json")
      .replace(VITEST_EXECUTION_EVIDENCE_VERSION, "forged-v99");

    expect(parseCurrentQualityProse(`<!--\n${drifted}\n-->\n${prose}`)).toEqual({
      artifactPath: vitestExecutionEvidencePath,
      version: VITEST_EXECUTION_EVIDENCE_VERSION,
    });
    expect(
      parseCurrentQualityProse(`~~~~md\n${drifted}\n~~~~\n${prose}`),
    ).toEqual({
      artifactPath: vitestExecutionEvidencePath,
      version: VITEST_EXECUTION_EVIDENCE_VERSION,
    });
  });

  it("does not let a hidden correct pointer mask visible drift", () => {
    const visibleDrift = prose.replace(
      vitestExecutionEvidencePath,
      "docs/evidence/forged.json",
    );

    expect(() =>
      assertQualitySnapshotConsistency(
        snapshot,
        parseCurrentQualityProse(`<!-- ${prose} -->\n${visibleDrift}`),
      )
    ).toThrow("STATUS Vitest execution-evidence pointer drifted");
  });

  it("rejects duplicate visible pointer bullets", () => {
    expect(() => parseCurrentQualityProse(`${prose}\n${prose}`)).toThrow(
      "exactly one current Vitest execution-evidence pointer bullet",
    );
  });

  it("rejects duplicate pointer claims inside the canonical bullet", () => {
    const duplicateClaim = prose.replace(/^-\s+/u, "  ");
    expect(() =>
      parseCurrentQualityProse(`${prose}\n${duplicateClaim}`)
    ).toThrow("exactly one canonical Vitest execution-evidence pointer");
  });

  it.each([
    {
      name: "artifact path",
      prose: prose.replace(
        vitestExecutionEvidencePath,
        "docs/evidence/forged.json",
      ),
    },
    {
      name: "format version",
      prose: prose.replace(VITEST_EXECUTION_EVIDENCE_VERSION, "forged-v99"),
    },
  ])("fails closed for visible $name drift", ({ prose: driftedProse }) => {
    expect(() =>
      assertQualitySnapshotConsistency(
        snapshot,
        parseCurrentQualityProse(driftedProse),
      )
    ).toThrow("STATUS Vitest execution-evidence pointer drifted");
  });

  it.each([
    {
      name: "legacy dynamic ledger",
      qualitySnapshot: { vitestFiles: 129, vitestTests: 2_465 },
    },
    {
      name: "drifted artifact path",
      qualitySnapshot: {
        artifactPath: "docs/evidence/forged.json",
        version: VITEST_EXECUTION_EVIDENCE_VERSION,
      },
    },
    {
      name: "drifted format version",
      qualitySnapshot: {
        artifactPath: vitestExecutionEvidencePath,
        version: "diesel-vitest-execution-evidence-v99",
      },
    },
  ])("rejects $name at the snapshot schema boundary", ({ qualitySnapshot }) => {
    expect(() =>
      parseStatusSnapshot(snapshotMarkdown({
        ...buildSnapshot(),
        qualitySnapshot,
      }))
    ).toThrow();
  });

  it("rejects dynamic observation copies inside the canonical pointer bullet", () => {
    expect(() =>
      parseCurrentQualityProse(
        prose.replace(
          "。\n  动态测试计数",
          "；154 files / 4033 tests。\n  动态测试计数",
        ),
      )
    ).toThrow("exactly one canonical Vitest execution-evidence pointer");
  });
});

describe("portfolio live-eval visible ledger", () => {
  it("binds the visible current result to the machine snapshot", () => {
    const snapshot = buildSnapshot().liveEval;
    const prose = formatStatusLiveEvalProse(snapshot);
    expect(() => assertStatusLiveEvalProseConsistency(snapshot, prose)).not
      .toThrow();
    expect(() => assertStatusLiveEvalProseConsistency(
      snapshot,
      prose.replace("`0/18 cases`", "`18/18 cases`"),
    )).toThrow("STATUS live-eval prose drifted");
  });

  it("ignores hidden decoys and rejects duplicate visible ledgers", () => {
    const snapshot = buildSnapshot().liveEval;
    const prose = formatStatusLiveEvalProse(snapshot);
    const falseProse = prose.replace("`0/18 cases`", "`18/18 cases`");
    expect(() => assertStatusLiveEvalProseConsistency(
      snapshot,
      `<!--\n${prose}\n-->\n\`\`\`md\n${prose}\n\`\`\`\n${falseProse}`,
    )).toThrow("STATUS live-eval prose drifted");
    expect(() => assertStatusLiveEvalProseConsistency(
      snapshot,
      `${prose}\n${prose}`,
    )).toThrow("exactly one current live-eval evidence ledger bullet");
  });

  it.each([
    "- 当前 `sales-chat-live-v11` latest 声称 `18/18 cases`。",
    "- 当前报告 run ID 为 `11111111-1111-4111-8111-111111111111`。",
    "- 换一种说法：current live eval outcome passed 18 / 18。",
    "The live eval currently passed 18/18 cases.",
    "The current run passed 18/18 cases.",
    "At present, the live eval passed all eighteen cases.",
    "live-eval 当前通过 18/18 条 case。",
    "本次最新运行通过全部十八条 case。",
    "The live eval now has a 100% pass rate.",
    "The latest live eval met every acceptance threshold.",
    "本次 live-eval 所有 case 均达标。",
    "本次评估准确率为 100%。",
    "The current live eval result follows. It passed 18/18 cases.",
    "The current [live eval](evals/latest.json) passed 18/18 cases.",
    "The current **live eval** passed 18/18 cases.",
    "The current `live-eval` passed 18/18 cases.",
    "The most recent live eval passed 18/18 cases.",
    "As of today, the live eval passed 18/18 cases.",
    "截至目前的 live-eval 已通过 18/18 条 case。",
    "最近一次 live-eval 已通过 18/18 条 case。",
    "The current live eval result is shown here. It passed 18/18 cases.",
    "The current live eval recorded 18 of 18 cases.",
    "The current live eval passed 18/18; the live eval contract defines the thresholds.",
    "The live eval contract documents that the current live eval passed 18/18 cases.",
    "The current [live eval] passed 18/18 cases.",
    "The current&nbsp;live eval passed 18/18 cases.",
    "The current live‑eval passed 18/18 cases.",
    "As of now, the live eval passed 18/18 cases.",
    "Our latest attempt passed 18/18 cases.",
    "本轮 live-eval 已通过 18/18 条 case。",
    "The current live eval passed 18 out of 18 cases.",
    "The current live eval reached 100 percent.",
    "The current live eval result is shown below. Summary. It passed 18/18 cases.",
    "Current v11: passed 18/18 cases.",
    "当前 v11：18/18 条 case 通过。",
    "The current sales-chat-live-v11 run passed 18/18 cases.",
    "sales-chat-live-v11 is now passing 18/18 cases.",
    "The current live eval contract says the suite passed.",
    "According to the current live eval contract, all cases passed.",
    "The live eval just completed and passed 18/18 cases.",
    "刚跑完的 live-eval 18/18 通过。",
    "新鲜出炉的评估结果：18/18。",
    "The latest live eval is complete.",
    "The latest live eval result:\n\n18/18 cases passed.",
    "The last live eval passed 18/18 cases.",
    "The current live eval p&#97;ssed 18/18 cases.",
    "The current sales-chat-live-v12 run passed 18/18 cases.",
    "Current sales-chat-live-v42.",
    "The current live eval result follows:\n- 18/18 cases passed.",
  ])("rejects a second current-result claim outside the ledger: %s", (claim) => {
    const snapshot = buildSnapshot().liveEval;
    const claimBullet = claim.startsWith("- ") ? claim : `- ${claim}`;
    expect(() => assertStatusLiveEvalProseConsistency(
      snapshot,
      `${formatStatusLiveEvalProse(snapshot)}\n${claimBullet}`,
    )).toThrow(/only in the canonical ledger/u);
  });

  it.each([
    "本轮 lint、typecheck、production build 通过，7 文件 311 条聚焦回归和 21 条离线 AI eval 通过；",
    "The offline AI eval passed 21/21 cases.",
    "The latest offline AI-eval passed 21/21 cases.",
    "离线评估通过 21 条用例。",
    "离线 AI evaluation 通过 21 条用例。",
    "The **offline AI eval** passed 21/21 cases.",
    "离线ＡＩ eval 通过 21 条用例。",
    "当前离线 AI 评估通过 21 条用例。",
    "Lint and the offline AI eval passed 21/21 cases.",
    "The non-offline AI eval parser validates parameters; the production build passed.",
  ])("distinguishes explicitly offline results from live evidence: %s", (statement) => {
    expect(() => assertNoConcreteCurrentLiveEvalClaims({
      documentLabel: "test document", markdown: statement,
    })).not.toThrow();
  });

  it.each([
    "The offline AI eval passed 21/21, but the latest live eval passed 18/18.",
    "离线 AI eval 通过 21 条；当前 live-eval 18/18 通过。",
    "The offline AI eval passed 21/21. The current live eval passed 18/18.",
    "The offline AI eval passed 21/21.\n\nThe latest live eval passed 18/18.",
    "The current live eval report follows. The offline AI eval passed. It passed 18/18.",
    "The offline AI eval passed 21/21, and the AI eval passed 18/18.",
    "The not offline AI eval passed 18/18 cases.",
    "A non-offline AI eval passed 18/18 cases.",
    "This is not an offline AI eval; it passed 18/18 cases.",
    "非离线 AI eval 通过 18 条用例。",
    "并非离线评估，18/18 通过。",
    "不是离线 AI eval，18/18 通过。",
    "The online/offline AI eval passed 18/18 cases.",
    "The offline live-eval passed 18/18 cases.",
    "这不是 offline AI eval；18/18 通过。",
    "This is not 离线 AI eval; it passed 18/18.",
    "This is not merely an offline AI eval; it passed 18/18.",
    "The online-to-offline AI eval passed 18/18.",
    "The offline AI eval and the latest live eval passed 18/18.",
    "A non-offline evaluation passed 18/18 cases.",
    "A non-offline eval passed 18/18 cases.",
    "The live and offline AI eval passed 18/18 cases.",
    "The online and offline AI eval passed 18/18 cases.",
    "The online / offline AI eval passed 18/18 cases.",
    "The live or offline AI eval passed 18/18 cases.",
    "线上及离线 AI 评估通过 18 条用例。",
    "Offline harness passed; current sales-chat-live-v25 passed 18/18.",
  ])("does not let offline wording hide a live or ambiguous result: %s", (statement) => {
    expect(() => assertNoConcreteCurrentLiveEvalClaims({
      documentLabel: "test document", markdown: statement,
    })).toThrow(/only in the canonical ledger/u);
  });

  it.each([
    "The current documentation explains why the historical live eval failed.",
    "The latest contract requires a failed live-eval report to be archived.",
    "当前文档不把历史 live-eval 成功记录视为现行成绩。",
    "The current live eval contract defines passed as meeting every threshold.",
    "The latest live-eval parser rejects a failed historical report.",
    "The current live eval documentation retains failed reports for audit.",
    "The current live eval contract passed its documentation review.",
    "The current live eval documentation failed its link check.",
    "The latest evaluation schema succeeded in parsing the legacy fixture.",
    "The current live eval contract requires 100% evidence accuracy.",
    "The offline harness does not claim a live-eval success rate.",
    "离线评估不冒充真实 provider 成功率评估。",
    "The current live eval report follows. Report consistency passing alone does not constitute provider model-quality evidence.",
    "当前 live-eval 报告如下。报告自洽性通过本身不形成 provider 模型质量证据。",
    "The current live eval documentation describes archived failures.\n- Production archiving completed with a serializable transaction.",
  ])("allows historical or contract prose: %s", (statement) => {
    expect(() => assertNoConcreteCurrentLiveEvalClaims({
      documentLabel: "test document",
      markdown: statement,
    })).not.toThrow();
  });

  it.each([
    "The current live eval report follows. It passed; report consistency passing alone does not constitute provider model-quality evidence.",
    "当前 live-eval 报告如下。当前评估通过；报告自洽性通过本身不形成 provider 模型质量证据。",
    "当前 live-eval 报告如下。报告自洽性通过，且 18/18 case 通过；这本身不形成 provider 模型质量证据。",
  ])("does not let a consistency disclaimer hide a current result: %s", (statement) => {
    expect(() => assertNoConcreteCurrentLiveEvalClaims({
      documentLabel: "test document",
      markdown: statement,
    })).toThrow(/only in the canonical ledger/u);
  });

  it("accepts the repository STATUS outside its canonical live-eval ledger", async () => {
    const markdown = await readFile(resolve(process.cwd(), "docs/STATUS.md"), "utf8");
    const snapshot = parseStatusSnapshot(markdown);

    expect(() => assertStatusLiveEvalProseConsistency(
      snapshot.liveEval,
      markdown,
    )).not.toThrow();
  });
});

describe("portfolio release drift", () => {
  it("parses and accepts the public release prose", () => {
    const parsed = parseCurrentReleaseProse(releaseProse);
    expect(parsed).toEqual({
      currentPublicReleaseCommit: releaseSha,
      currentPublicReleaseEvidenceKind: "historical-operator-record-only",
      currentPublicReleaseObservedAt: observedAt,
      currentPublicReleasePath: `/opt/diesel/releases/${releaseSha}`,
      lastDocumentedReleaseCommit: previousReleaseSha,
      lastDocumentedReleaseId: "20260814144537",
      publicRuntimeReadbackAt: observedAt,
      publicRuntimeEvidenceKind: "historical-operator-record-only",
      publicRuntimeStatus: "ok",
      publicRuntimeVersion: releaseSha,
    });
    expect(() =>
      assertReleaseProseConsistency(buildSnapshot(), parsed)
    ).not.toThrow();
  });

  it("rejects missing or drifted public release prose", () => {
    expect(() => parseCurrentReleaseProse("# Status")).toThrow(
      "current public release observation",
    );
    const parsed = parseCurrentReleaseProse(releaseProse);
    expect(() =>
      assertReleaseProseConsistency(
        {
          ...buildSnapshot(),
          lastDocumentedRelease: {
            commit: alternateSha,
            id: "20260814144537",
          },
        },
        parsed,
      )
    ).toThrow("STATUS public release prose drifted");
  });

  it("ignores comment decoys and rejects duplicate release prose", () => {
    const drifted = releaseProse.replaceAll(releaseSha, alternateSha);
    const parsed = parseCurrentReleaseProse(
      `<!--\n${releaseProse}\n-->\n~~~~md\n${releaseProse}\n~~~~\n${drifted}`,
    );
    expect(() =>
      assertReleaseProseConsistency(buildSnapshot(), parsed)
    ).toThrow("STATUS public release prose drifted");
    expect(() =>
      parseCurrentReleaseProse(`${releaseProse}\n${releaseProse}`)
    ).toThrow("exactly one current public release observation bullet");
    const releaseClaim = releaseProse.split("\n").slice(1, 6).join("\n");
    expect(() =>
      parseCurrentReleaseProse(
        releaseProse.replace(releaseClaim, `${releaseClaim}\n${releaseClaim}`),
      )
    ).toThrow("exactly one canonical current public release observation");
  });

  it("accepts a self-consistent release snapshot", () => {
    expect(() => assertReleaseSnapshotConsistency(buildSnapshot())).not
      .toThrow();
  });

  it.each([
    {
      name: "local and remote head",
      label: "Observed local/remote repository head drifted",
      mutate(snapshot: StatusSnapshot) {
        snapshot.repositoryHead.local = alternateSha;
      },
    },
    {
      name: "release ID and commit",
      label: "Current public release ID/commit drifted",
      mutate(snapshot: StatusSnapshot) {
        snapshot.currentPublicRelease.id = alternateSha;
      },
    },
    {
      name: "release and repository head",
      label: "Current public release/repository head drifted",
      mutate(snapshot: StatusSnapshot) {
        snapshot.currentPublicRelease = {
          ...snapshot.currentPublicRelease,
          commit: alternateSha,
          id: alternateSha,
          releasePath: `/opt/diesel/releases/${alternateSha}`,
        };
        snapshot.publicRuntime.version = alternateSha;
      },
    },
    {
      name: "runtime and release version",
      label: "Public runtime/release version drifted",
      mutate(snapshot: StatusSnapshot) {
        snapshot.publicRuntime.version = alternateSha;
      },
    },
    {
      name: "release path",
      label: "Current public release path drifted",
      mutate(snapshot: StatusSnapshot) {
        snapshot.currentPublicRelease.releasePath =
          `/opt/diesel/releases/${alternateSha}`;
      },
    },
    {
      name: "repository observation time",
      label: "Repository/public release observation time drifted",
      mutate(snapshot: StatusSnapshot) {
        snapshot.repositoryHead.observedAt = "2026-08-31T12:01+08:00";
      },
    },
    {
      name: "runtime observation time",
      label: "Public runtime/release observation time drifted",
      mutate(snapshot: StatusSnapshot) {
        snapshot.publicRuntime.readbackAt = "2026-08-31T12:01+08:00";
      },
    },
  ])("fails closed on $name drift", ({ label, mutate }) => {
    const snapshot = buildSnapshot();
    mutate(snapshot);
    expect(() => assertReleaseSnapshotConsistency(snapshot)).toThrow(label);
  });
});

describe("portfolio evidence drift", () => {
  it("parses and accepts the public evidence prose", () => {
    const parsed = parseEvidenceSummaryProse(evidenceProse);
    expect(parsed).toEqual({
      approvedRealFixtures: 0,
      jurisdictions: 97,
      limits: 651,
      regulations: 28,
      sources: 203,
    });
    expect(() =>
      assertEvidenceSummaryProseConsistency(
        buildSnapshot().evidenceSummary,
        parsed,
      )
    ).not.toThrow();
  });

  it("rejects missing or drifted public evidence prose", () => {
    expect(() => parseEvidenceSummaryProse("# Status")).toThrow(
      "exactly one current evidence-closure bullet",
    );
    const parsed = parseEvidenceSummaryProse(evidenceProse);
    const snapshot = buildSnapshot().evidenceSummary;
    expect(() =>
      assertEvidenceSummaryProseConsistency(
        { ...snapshot, sources: snapshot.sources + 1 },
        parsed,
      )
    ).toThrow("STATUS public evidence summary prose drifted");
  });

  it("ignores comment decoys and rejects duplicate evidence prose", () => {
    const drifted = evidenceProse.replace("97 jurisdictions", "999 jurisdictions");
    const parsed = parseEvidenceSummaryProse(
      `<!--\n${evidenceProse}\n-->\n\`\`\`\`md\n${evidenceProse}\n\`\`\`\`\n${drifted}`,
    );
    expect(() =>
      assertEvidenceSummaryProseConsistency(
        buildSnapshot().evidenceSummary,
        parsed,
      )
    ).toThrow("STATUS public evidence summary prose drifted");
    expect(() =>
      parseEvidenceSummaryProse(`${evidenceProse}\n${evidenceProse}`)
    ).toThrow("exactly one current evidence-closure bullet");
    const closureClaim = evidenceProse.split("\n")[1];
    if (!closureClaim) {
      throw new Error("Synthetic evidence prose is missing its closure claim.");
    }
    expect(() =>
      parseEvidenceSummaryProse(
        evidenceProse.replace(
          closureClaim,
          `${closureClaim}\n${closureClaim}`,
        ),
      )
    ).toThrow("current public evidence summary");
  });

  it("accepts identical evidence summaries", () => {
    const summary = buildSnapshot().evidenceSummary;
    expect(() => assertEvidenceSummaryConsistency(summary, summary)).not
      .toThrow();
  });

  it.each([
    "approvedRealCertifications",
    "approvedRealProducts",
    "jurisdictions",
    "limits",
    "regulations",
    "sources",
  ] satisfies readonly (keyof EvidenceSummary)[])(
    "fails closed when %s drifts",
    (field) => {
      const expected = buildSnapshot().evidenceSummary;
      const actual = { ...expected, [field]: expected[field] + 1 };
      expect(() =>
        assertEvidenceSummaryConsistency(actual, expected),
      ).toThrow("Evidence summary drifted");
    },
  );
});

describe("public portfolio fact mirrors", () => {
  it("keeps both READMEs and the bilingual case study bound to STATUS and the latest eval", async () => {
    const [status, readme, chineseReadme, caseStudy, architecture, evalReadme, rawReport] =
      await Promise.all([
        readFile(resolve(process.cwd(), "docs/STATUS.md"), "utf8"),
        readFile(resolve(process.cwd(), "README.md"), "utf8"),
        readFile(resolve(process.cwd(), "README.zh-CN.md"), "utf8"),
        readFile(resolve(process.cwd(), "docs/FDE_CASE_STUDY.md"), "utf8"),
        readFile(resolve(process.cwd(), "docs/ARCHITECTURE.md"), "utf8"),
        readFile(resolve(process.cwd(), "docs/evals/README.md"), "utf8"),
        readFile(
          resolve(process.cwd(), "docs/evals/ai-live-eval-latest.json"),
          "utf8",
        ),
      ]);
    const snapshot = parseStatusSnapshot(status);
    const report = liveEvalReportSchema.parse(JSON.parse(rawReport));
    expect(report.version).toBe(snapshot.liveEval.reportVersion);
    if (report.provenance.sourceFingerprint.status !== "captured") {
      throw new Error("The current portfolio mirror test requires a captured report.");
    }
    const normalizedReadme = readme.replace(/\s+/gu, " ");
    const normalizedChineseReadme = chineseReadme.replace(/\s+/gu, " ");
    const normalizedCaseStudy = caseStudy.replace(/\s+/gu, " ");
    const evidence = snapshot.evidenceSummary;

    expect(normalizedReadme).toContain(
      `${evidence.jurisdictions} jurisdictions, ${evidence.regulations} regulations, ` +
        `${evidence.limits} limits, and ${evidence.sources} sources`,
    );
    expect(normalizedChineseReadme).toContain(
      `${evidence.jurisdictions} 个辖区、${evidence.regulations} 条法规、` +
        `${evidence.limits} 条限值、${evidence.sources} 个来源`,
    );
    expect(normalizedCaseStudy).toContain(
      `${evidence.jurisdictions} jurisdictions, ${evidence.regulations} regulations, ` +
        `${evidence.limits} limits, and ${evidence.sources} sources`,
    );
    expect(normalizedCaseStudy).toContain(
      `${evidence.jurisdictions} 个辖区、${evidence.regulations} 条法规、` +
        `${evidence.limits} 条限值和 ${evidence.sources} 个来源`,
    );
    expect(evidence.approvedRealProducts).toBe(0);
    expect(evidence.approvedRealCertifications).toBe(0);
    expect(normalizedReadme).toContain(
      "Approved real-product and certification fixtures: **0**.",
    );
    expect(normalizedChineseReadme).toContain(
      "获准公开的真实产品和认证 fixture：**0**。",
    );

    const protectionObservation = status.match(
      /(\d{4}-\d{2}-\d{2}) 的只读 GitHub API 读回确认/u,
    )?.[1];
    expect(protectionObservation).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(readme).toContain(
      `protection rule was last observed on ${protectionObservation}`,
    );
    expect(chineseReadme).toContain(
      `保护最后于 ${protectionObservation} 在线读回`,
    );

    const englishCommands = readme.match(
      /## Verification\s+```bash\s+([\s\S]*?)\s+```/u,
    )?.[1];
    const chineseCommands = chineseReadme.match(
      /## 验证命令\s+```bash\s+([\s\S]*?)\s+```/u,
    )?.[1];
    expect(englishCommands).toBeDefined();
    expect(chineseCommands).toBe(englishCommands);

    const [englishCaseStudy, chineseCaseStudy] = caseStudy.split("## 中文");
    const normalizedEnglishCaseStudy = englishCaseStudy.replace(/\s+/gu, " ");
    const normalizedChineseCaseStudy = chineseCaseStudy.replace(/\s+/gu, " ");
    expect(normalizedEnglishCaseStudy).toContain(
      "Historical scoring-contract evolution through v12",
    );
    expect(normalizedChineseCaseStudy).toContain("截至 v12 的历史评分合同演进");
    expect(normalizedEnglishCaseStudy).toContain(
      "registered version-specific strict schemas",
    );
    expect(normalizedChineseCaseStudy).toContain("已注册的版本专属 strict schema");
    expect(normalizedEnglishCaseStudy).toContain(
      "the two pre-schema modern v2 files are accepted only at their frozen full-file SHA-256",
    );
    expect(normalizedChineseCaseStudy).toContain(
      "两份早于该 schema 的现代 v2 文件只以冻结全文 SHA-256 兼容",
    );
    expect(normalizedEnglishCaseStudy).toContain(
      "Current suite and observed report identities are kept separately in [STATUS.md](STATUS.md)",
    );
    expect(normalizedChineseCaseStudy).toContain(
      "当前 suite 与已观察报告的身份分别记录在 [STATUS.md](STATUS.md)",
    );
    expect(normalizedEnglishCaseStudy).toContain(
      "For a run that fails during initialization,",
    );
    expect(normalizedChineseCaseStudy).toContain("若某次运行在初始化阶段失败，");
    expect(normalizedEnglishCaseStudy).not.toMatch(
      /(?:The scoring contract is now|distinguishes the v\d+ suite contract|strictly parses every modern v3-v\d+ archive)/u,
    );
    expect(normalizedChineseCaseStudy).not.toMatch(
      /(?:当前评分合同已升级为|台账会把尚未真实执行 provider 的 v\d+ suite contract|严格解析所有现代 v3[–-]v\d+ 归档)/u,
    );
    // The current-state pointer must not erase the bounded historical evidence.
    for (const historicalMarker of ["v9", "2026-08-19", "2026-08-29", "v3"]) {
      expect(normalizedEnglishCaseStudy).toContain(historicalMarker);
      expect(normalizedChineseCaseStudy).toContain(historicalMarker);
    }
    expect(englishCaseStudy).toContain(
      "exact report identity, result, counts, provenance, and archive path are recorded only in\n[STATUS.md](STATUS.md)",
    );
    expect(chineseCaseStudy).toContain(
      "报告的精确身份、结果、\n计数、provenance 与归档路径只记录在 [STATUS.md](STATUS.md)",
    );
    expect(architecture).toContain(
      "latest 的身份、逐项计数、\n  provenance 与归档路径只以 `STATUS.md` 的受控台账为当前来源",
    );
    for (const secondaryDocument of [caseStudy, architecture]) {
      expect(secondaryDocument).not.toContain(report.evaluatedAt);
      expect(secondaryDocument).not.toContain(report.runId);
      expect(secondaryDocument).not.toContain(
        report.provenance.sourceFingerprint.digest,
      );
    }
    for (const [documentLabel, document] of [
      ["README.md", readme],
      ["README.zh-CN.md", chineseReadme],
      ["FDE case study", caseStudy],
      ["Architecture", architecture],
    ] as const) {
      expect(() => assertNoConcreteCurrentLiveEvalClaims({
        documentLabel,
        markdown: document,
      })).not.toThrow();
      for (const conflictingClaim of [
        "The live eval currently passed 18/18 cases.",
        "本次最新运行通过全部十八条 case。",
      ]) {
        expect(() => assertNoConcreteCurrentLiveEvalClaims({
          documentLabel,
          markdown: `${document}\n${conflictingClaim}\n`,
        })).toThrow(/only in the canonical ledger/u);
      }
    }
    expect(status).toContain(report.runId);
    expect(evalReadme).toContain(report.runId);
    expect(status).toContain(report.provenance.sourceFingerprint.digest);
    expect(evalReadme).toContain(report.provenance.sourceFingerprint.digest);
    const compactTimestamp = report.evaluatedAt.replace(/[-:.]/gu, "");
    const archiveFilename =
      `ai-live-eval-${compactTimestamp}-${report.runId}.json`;
    expect(status).toContain(archiveFilename);
    expect(evalReadme).toContain(archiveFilename);
  });
});
