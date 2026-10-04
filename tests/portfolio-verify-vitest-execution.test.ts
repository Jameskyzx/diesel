import { describe, expect, it } from "vitest";

import type {
  VitestExecutionEvidence,
  VitestExecutionRepositoryState,
  VitestExecutionSourceFingerprint,
} from "../scripts/portfolio/vitest-execution-evidence";
import {
  assertVitestExecutionCaptureIdle,
  assertVitestExecutionProvenance,
  type VerifyVitestExecutionProvenanceInput,
} from "../scripts/portfolio/verify-vitest-execution";
import type { VitestExecutionCaptureLockInspection } from "../scripts/portfolio/vitest-execution-capture-lock";

const BASE_COMMIT = "a".repeat(40);
const DESCENDANT_COMMIT = "b".repeat(40);
const UNRELATED_COMMIT = "c".repeat(40);
const RUN_ID = "123e4567-e89b-42d3-a456-426614174000";
const SOURCE_FINGERPRINT: VitestExecutionSourceFingerprint = {
  algorithm: "sha256",
  digest: "d".repeat(64),
  fileCount: 400,
};
const DRIFTED_FINGERPRINT: VitestExecutionSourceFingerprint = {
  algorithm: "sha256",
  digest: "e".repeat(64),
  fileCount: 401,
};

describe("assertVitestExecutionCaptureIdle", () => {
  it("accepts an absent capture lock", () => {
    expect(() => assertVitestExecutionCaptureIdle({
      path: "/git/common/diesel-vitest-execution-capture-v1.lock",
      status: "absent",
    })).not.toThrow();
  });

  it.each([
    {
      expectedPaths: ["/git/common/lock", "/git/common/quarantine"],
      inspection: {
        owner: {
          acquiredAt: "2026-09-04T00:00:00.000Z",
          hostname: "build-host",
          pid: 42,
          platform: "darwin",
          token: "123e4567-e89b-42d3-a456-426614174000",
          version: "vitest-execution-capture-lock-v2",
        },
        path: "/git/common/lock",
        publicationCandidatePath: null,
        quarantinePath: "/git/common/quarantine",
        quarantinePresent: true,
        reason: "pid_alive",
        status: "active",
      },
      label: "active lock",
    },
    {
      expectedPaths: ["/git/common/lock", "/git/common/candidate"],
      inspection: {
        owner: {
          acquiredAt: "2026-09-04T00:00:00.000Z",
          hostname: "build-host",
          pid: 42,
          platform: "darwin",
          token: "123e4567-e89b-42d3-a456-426614174000",
          version: "vitest-execution-capture-lock-v2",
        },
        path: "/git/common/lock",
        publicationCandidatePath: "/git/common/candidate",
        quarantinePath: "/git/common/quarantine",
        quarantinePresent: false,
        reason: "pid_missing",
        status: "stale",
      },
      label: "stale lock",
    },
    {
      expectedPaths: ["/git/common/lock", "/git/common/recovery"],
      inspection: {
        path: "/git/common/lock",
        reason: "recovery_claim_present",
        recoveryClaimPath: "/git/common/recovery",
        status: "unverifiable",
      },
      label: "recovery claim",
    },
    {
      expectedPaths: [
        "/git/common/lock",
        "/git/common/candidate-a",
        "/git/common/candidate-b",
      ],
      inspection: {
        candidatePaths: [
          "/git/common/candidate-a",
          "/git/common/candidate-b",
        ],
        path: "/git/common/lock",
        reason: "orphan_publication_candidate",
        status: "unverifiable",
      },
      label: "orphan publication candidate",
    },
  ] satisfies Array<{
    expectedPaths: string[];
    inspection: VitestExecutionCaptureLockInspection;
    label: string;
  }>)("rejects $label with exact recovery paths", ({ expectedPaths, inspection }) => {
    let thrown: unknown;
    try {
      assertVitestExecutionCaptureIdle(inspection);
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain(`status=${inspection.status}`);
    expect(message).toContain(`reason=${inspection.reason}`);
    for (const path of expectedPaths) expect(message).toContain(path);
  });
});

function buildEvidence(
  worktreeState: "clean" | "dirty",
): VitestExecutionEvidence {
  return {
    command: "pnpm test",
    complete: true,
    completedAt: "2026-09-04T02:00:00.000Z",
    configPath: "vitest.config.ts",
    provenance: {
      baseHeadCommit: BASE_COMMIT,
      evaluatedCommit: worktreeState === "clean" ? BASE_COMMIT : null,
      sourceFingerprint: SOURCE_FINGERPRINT,
      worktreeState,
    },
    runId: RUN_ID,
    startedAt: "2026-09-04T01:00:00.000Z",
    tests: [{ id: "f".repeat(64), status: "passed" }],
    totals: {
      collectedFiles: 1,
      collectedSuites: 1,
      collectedTests: 1,
      failedTests: 0,
      passedTests: 1,
      pendingTests: 0,
      skippedTests: 0,
      todoTests: 0,
    },
    version: "diesel-vitest-execution-evidence-v2",
    vitestVersion: "4.1.11",
  };
}

function repositoryState(input: {
  headCommit?: string;
  sourceFingerprint?: VitestExecutionSourceFingerprint;
  worktreeState?: "clean" | "dirty";
} = {}): VitestExecutionRepositoryState {
  return {
    headCommit: input.headCommit ?? BASE_COMMIT,
    sourceFingerprint: input.sourceFingerprint ?? SOURCE_FINGERPRINT,
    worktreeState: input.worktreeState ?? "dirty",
  };
}

function cleanInput(
  overrides: Partial<VerifyVitestExecutionProvenanceInput> = {},
): VerifyVitestExecutionProvenanceInput {
  return {
    ancestryFact: {
      ancestorCommit: BASE_COMMIT,
      descendantCommit: DESCENDANT_COMMIT,
      isAncestor: true,
    },
    currentRepositoryState: repositoryState({
      headCommit: DESCENDANT_COMMIT,
      worktreeState: "clean",
    }),
    evidence: buildEvidence("clean"),
    releaseEvidenceMode: false,
    revisionFingerprintFact: {
      revision: BASE_COMMIT,
      sourceFingerprint: SOURCE_FINGERPRINT,
    },
    ...overrides,
  };
}

describe("assertVitestExecutionProvenance", () => {
  it.each([false, true])(
    "accepts clean ancestor-bound evidence in release mode=%s",
    (releaseEvidenceMode) => {
      expect(() => assertVitestExecutionProvenance(cleanInput({
        releaseEvidenceMode,
      }))).not.toThrow();
    },
  );

  it("accepts ordinary dirty evidence only at its exact unchanged base", () => {
    expect(() => assertVitestExecutionProvenance({
      currentRepositoryState: repositoryState(),
      evidence: buildEvidence("dirty"),
      releaseEvidenceMode: false,
    })).not.toThrow();
  });

  it.each([
    {
      currentRepositoryState: repositoryState({
        headCommit: DESCENDANT_COMMIT,
      }),
      expected: /Dirty Vitest evidence base HEAD drifted/u,
      name: "a different HEAD",
    },
    {
      currentRepositoryState: repositoryState({ worktreeState: "clean" }),
      expected: /Dirty Vitest evidence current worktree state drifted/u,
      name: "a clean current worktree",
    },
    {
      currentRepositoryState: repositoryState({
        sourceFingerprint: DRIFTED_FINGERPRINT,
      }),
      expected: /Dirty Vitest evidence source fingerprint drifted/u,
      name: "source drift",
    },
  ])("rejects ordinary dirty evidence against $name", ({
    currentRepositoryState,
    expected,
  }) => {
    expect(() => assertVitestExecutionProvenance({
      currentRepositoryState,
      evidence: buildEvidence("dirty"),
      releaseEvidenceMode: false,
    })).toThrow(expected);
  });

  it("rejects dirty evidence in release-evidence mode", () => {
    expect(() => assertVitestExecutionProvenance({
      currentRepositoryState: repositoryState(),
      evidence: buildEvidence("dirty"),
      releaseEvidenceMode: true,
    })).toThrow(/must have clean exact-commit provenance/u);
  });

  it.each([
    {
      expected: /Clean Vitest evidence current worktree state drifted/u,
      name: "a dirty current worktree",
      overrides: {
        currentRepositoryState: repositoryState({
          headCommit: DESCENDANT_COMMIT,
          worktreeState: "dirty",
        }),
      },
    },
    {
      expected: /Clean Vitest evidence current source fingerprint drifted/u,
      name: "current source drift",
      overrides: {
        currentRepositoryState: repositoryState({
          headCommit: DESCENDANT_COMMIT,
          sourceFingerprint: DRIFTED_FINGERPRINT,
          worktreeState: "clean",
        }),
      },
    },
    {
      expected: /requires an exact base-to-current ancestry fact/u,
      name: "a missing ancestry fact",
      overrides: { ancestryFact: undefined },
    },
    {
      expected: /Vitest ancestry fact ancestor drifted/u,
      name: "an ancestry fact for another base",
      overrides: {
        ancestryFact: {
          ancestorCommit: UNRELATED_COMMIT,
          descendantCommit: DESCENDANT_COMMIT,
          isAncestor: true,
        },
      },
    },
    {
      expected: /Vitest ancestry fact descendant drifted/u,
      name: "an ancestry fact for another destination",
      overrides: {
        ancestryFact: {
          ancestorCommit: BASE_COMMIT,
          descendantCommit: UNRELATED_COMMIT,
          isAncestor: true,
        },
      },
    },
    {
      expected: /requires its evaluated-revision fingerprint fact/u,
      name: "a missing revision fingerprint fact",
      overrides: { revisionFingerprintFact: undefined },
    },
    {
      expected: /Vitest revision fingerprint commit drifted/u,
      name: "a fingerprint fact for another revision",
      overrides: {
        revisionFingerprintFact: {
          revision: UNRELATED_COMMIT,
          sourceFingerprint: SOURCE_FINGERPRINT,
        },
      },
    },
    {
      expected: /Vitest clean commit\/source fingerprint drifted/u,
      name: "evaluated-revision source drift",
      overrides: {
        revisionFingerprintFact: {
          revision: BASE_COMMIT,
          sourceFingerprint: DRIFTED_FINGERPRINT,
        },
      },
    },
  ])("rejects clean evidence against $name", ({ expected, overrides }) => {
    expect(() => assertVitestExecutionProvenance(cleanInput(
      overrides as Partial<VerifyVitestExecutionProvenanceInput>,
    ))).toThrow(expected);
  });

  it("rejects unrelated same-tree history even when every fingerprint matches", () => {
    expect(() => assertVitestExecutionProvenance(cleanInput({
      ancestryFact: {
        ancestorCommit: BASE_COMMIT,
        descendantCommit: DESCENDANT_COMMIT,
        isAncestor: false,
      },
    }))).toThrow(/Vitest evidence base\/current ancestry drifted/u);
  });

  it("rejects a clean receipt whose evaluated commit is not its base", () => {
    const evidence = buildEvidence("clean");
    evidence.provenance.evaluatedCommit = UNRELATED_COMMIT;
    expect(() => assertVitestExecutionProvenance(cleanInput({ evidence })))
      .toThrow(/Vitest evidence evaluated commit drifted/u);
  });
});
