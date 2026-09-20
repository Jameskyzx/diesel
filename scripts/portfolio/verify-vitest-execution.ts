import {
  assertVitestExecutionEvidence,
  vitestExecutionRepositoryStateSchema,
  vitestExecutionSourceFingerprintSchema,
  type VitestExecutionEvidence,
  type VitestExecutionRepositoryState,
  type VitestExecutionSourceFingerprint,
} from "./vitest-execution-evidence";
import { assertVerificationEqual } from "./verification-issues";
import type { VitestExecutionCaptureLockInspection } from "./vitest-execution-capture-lock";

export function assertVitestExecutionCaptureIdle(
  inspection: VitestExecutionCaptureLockInspection,
): void {
  if (inspection.status === "absent") return;

  const paths = new Set<string>([inspection.path]);
  if ("recoveryClaimPath" in inspection) {
    paths.add(inspection.recoveryClaimPath);
  }
  if ("candidatePaths" in inspection) {
    for (const path of inspection.candidatePaths) paths.add(path);
  }
  if (
    "publicationCandidatePath" in inspection &&
    inspection.publicationCandidatePath !== null
  ) {
    paths.add(inspection.publicationCandidatePath);
  }
  if (
    "quarantinePresent" in inspection &&
    inspection.quarantinePresent
  ) {
    paths.add(inspection.quarantinePath);
  }

  throw new Error(
    "Vitest execution capture is not idle: " +
      `status=${inspection.status}; reason=${inspection.reason}; ` +
      `paths=${[...paths].join(",")}.`,
  );
}

export type VitestExecutionAncestryFact = Readonly<{
  ancestorCommit: string;
  descendantCommit: string;
  isAncestor: boolean;
}>;

export type VitestExecutionRevisionFingerprintFact = Readonly<{
  revision: string;
  sourceFingerprint: VitestExecutionSourceFingerprint;
}>;

export type VerifyVitestExecutionProvenanceInput = Readonly<{
  ancestryFact?: VitestExecutionAncestryFact;
  currentRepositoryState: VitestExecutionRepositoryState;
  evidence: VitestExecutionEvidence;
  releaseEvidenceMode: boolean;
  revisionFingerprintFact?: VitestExecutionRevisionFingerprintFact;
}>;

function requireAncestryFact(
  fact: VitestExecutionAncestryFact | undefined,
): VitestExecutionAncestryFact {
  if (fact === undefined) {
    throw new Error(
      "Clean Vitest evidence requires an exact base-to-current ancestry fact.",
    );
  }
  return fact;
}

function requireRevisionFingerprintFact(
  fact: VitestExecutionRevisionFingerprintFact | undefined,
): VitestExecutionRevisionFingerprintFact {
  if (fact === undefined) {
    throw new Error(
      "Clean Vitest evidence requires its evaluated-revision fingerprint fact.",
    );
  }
  return {
    ...fact,
    sourceFingerprint: vitestExecutionSourceFingerprintSchema.parse(
      fact.sourceFingerprint,
    ),
  };
}

/**
 * Verifies that a passing Vitest receipt still describes the exact source now
 * being evaluated. Git queries stay outside this pure assertion boundary: the
 * caller supplies commit-bound facts, and this function binds those facts to
 * the receipt and current repository identities before trusting them.
 */
export function assertVitestExecutionProvenance(
  input: VerifyVitestExecutionProvenanceInput,
): void {
  assertVitestExecutionEvidence(input.evidence);
  const current = vitestExecutionRepositoryStateSchema.parse(
    input.currentRepositoryState,
  );
  const { provenance } = input.evidence;

  if (provenance.worktreeState === "dirty") {
    if (input.releaseEvidenceMode) {
      throw new Error(
        "Release-grade Vitest evidence must have clean exact-commit provenance.",
      );
    }
    assertVerificationEqual(
      current.headCommit,
      provenance.baseHeadCommit,
      "Dirty Vitest evidence base HEAD",
    );
    assertVerificationEqual(
      current.worktreeState,
      "dirty",
      "Dirty Vitest evidence current worktree state",
    );
    assertVerificationEqual(
      current.sourceFingerprint,
      provenance.sourceFingerprint,
      "Dirty Vitest evidence source fingerprint",
    );
    return;
  }

  assertVerificationEqual(
    provenance.evaluatedCommit,
    provenance.baseHeadCommit,
    "Clean Vitest evidence evaluated commit",
  );
  assertVerificationEqual(
    current.worktreeState,
    "clean",
    "Clean Vitest evidence current worktree state",
  );
  assertVerificationEqual(
    current.sourceFingerprint,
    provenance.sourceFingerprint,
    "Clean Vitest evidence current source fingerprint",
  );

  const ancestry = requireAncestryFact(input.ancestryFact);
  assertVerificationEqual(
    ancestry.ancestorCommit,
    provenance.baseHeadCommit,
    "Vitest ancestry fact ancestor",
  );
  assertVerificationEqual(
    ancestry.descendantCommit,
    current.headCommit,
    "Vitest ancestry fact descendant",
  );
  assertVerificationEqual(
    ancestry.isAncestor,
    true,
    "Vitest evidence base/current ancestry",
  );

  const revisionFingerprint = requireRevisionFingerprintFact(
    input.revisionFingerprintFact,
  );
  assertVerificationEqual(
    revisionFingerprint.revision,
    provenance.evaluatedCommit,
    "Vitest revision fingerprint commit",
  );
  assertVerificationEqual(
    revisionFingerprint.sourceFingerprint,
    provenance.sourceFingerprint,
    "Vitest clean commit/source fingerprint",
  );
}
