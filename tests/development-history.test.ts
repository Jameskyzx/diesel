import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  developmentHistoryContract,
  findDisallowedHistoryRefMentions,
  parseDevelopmentHistoryAuditRecord,
  parseRepresentativeMilestones,
  readRepositoryTextFiles,
  retainedHistorySecretScanPaths,
  verifyDevelopmentHistory,
  verifyDevelopmentHistoryContract,
  type GitResult,
  type HistoryGitRunner,
} from "../scripts/history/verify-development-history";
import {
  retainedDependencyLicenseArchiveContract,
  retainedDependencyLicenseManifestContract,
} from "../scripts/history/retained-dependency-licenses";

const milestones = [
  "592d8ed",
  "77eaa07",
  "47c453b",
  "b50dae6",
  "6be0289",
] as const;

const contractMarkdown = `
\`codex/fde-multimodal-global-regulations\`
\`codex/fde-development-history-archive\`

## Representative milestones

| Commit | Evidence |
| --- | --- |
${milestones.map((commit) => `| \`${commit}\` | Evidence |`).join("\n")}

## Publication gate
`;

const auditRecord = {
  schemaVersion: "fde-development-history-audit-v3",
  subject: {
    commit: developmentHistoryContract.expectedSourceCommit,
    commitCount: 50,
    nonMergeCommitCount: 42,
  },
  recordedClaims: {
    fullHistorySecretScan: {
      recordedAt: "2026-08-20",
      reportedResult: "passed",
      evidenceLevel: "historical-operator-record-only",
      rawReportPresent: false,
    },
    dependencyLicenseMetadataScan: {
      recordedAt: "2026-08-20",
      reportedResult: "metadata-passed-with-review-items",
      evidenceLevel: "historical-operator-record-only",
      rawReportPresent: false,
    },
  },
  retainedSecretScan: {
    recordedAt: "2026-09-05",
    observedResult: "completed-zero-findings",
    evidenceLevel: "repository-contained-dated-run-record",
    rawReportPresent: true,
    replayableFromRepository: false,
    manifest: {
      path: "docs/evidence/fde-development-history-secret-scan-2026-09-05.manifest.json",
      byteLength: 3370,
      sha256: "4dbd0171c75aab4791585b26df43285f85d53ce64c6ba9dfc6e60686b2728b40",
    },
  },
  retainedDependencyLicenseScan: {
    recordedAt: "2026-09-05",
    observedResult: "metadata-collected-with-unresolved-review-items",
    evidenceLevel: "repository-contained-dated-run-record",
    rawReportPresent: true,
    replayableFromRepository: false,
    licenseApproval: "not-performed",
    manifest: retainedDependencyLicenseManifestContract,
  },
  publicationGate: {
    status: "blocked",
    publicationPermitted: false,
    machineVerifiedBlockers: [
      "source-project-license-missing",
      "source-project-notice-missing",
      "source-package-license-field-missing",
    ],
    manualBlockers: [
      "historical-assets-and-copied-material-review-incomplete",
      "weak-copyleft-and-notice-policy-missing",
    ],
  },
} as const;

const retainedFiles = await Promise.all(retainedHistorySecretScanPaths.map(async (path) => ({
  path,
  contents: await readFile(resolve(process.cwd(), path), "utf8"),
})));
const dependencyLicenseEvidence = {
  manifestText: await readFile(retainedDependencyLicenseManifestContract.path, "utf8"),
  archiveBytes: await readFile(retainedDependencyLicenseArchiveContract.path),
};

function gitKey(args: readonly string[]): string {
  return args.join("\0");
}

function gitResult(
  status: number,
  stdout = "",
  stderr = "",
): GitResult {
  return { status, stderr, stdout };
}

function milestoneCommit(shortCommit: string): string {
  return shortCommit === "6be0289"
    ? developmentHistoryContract.expectedSourceCommit
    : `${shortCommit}${"0".repeat(40 - shortCommit.length)}`;
}

function createHistoryGitRunner(
  overrides: ReadonlyMap<string, GitResult> = new Map(),
): HistoryGitRunner {
  const results = new Map<string, GitResult>([
    [
      gitKey([
        "rev-parse",
        "--verify",
        `${developmentHistoryContract.sourceRef}^{commit}`,
      ]),
      gitResult(0, `${developmentHistoryContract.expectedSourceCommit}\n`),
    ],
    [
      gitKey([
        "rev-parse",
        "--verify",
        `${developmentHistoryContract.masterRef}^{commit}`,
      ]),
      gitResult(0, `${"1".repeat(40)}\n`),
    ],
    [
      gitKey([
        "show-ref",
        "--verify",
        "--quiet",
        developmentHistoryContract.archiveRef,
      ]),
      gitResult(1),
    ],
    [
      gitKey([
        "show-ref",
        "--verify",
        "--quiet",
        developmentHistoryContract.archiveRemoteTrackingRef,
      ]),
      gitResult(1),
    ],
    [
      gitKey([
        "rev-list",
        "--count",
        developmentHistoryContract.sourceRef,
      ]),
      gitResult(0, "50\n"),
    ],
    [
      gitKey([
        "rev-list",
        "--count",
        "--no-merges",
        developmentHistoryContract.sourceRef,
      ]),
      gitResult(0, "42\n"),
    ],
    [
      gitKey([
        "rev-list",
        "--objects",
        developmentHistoryContract.sourceRef,
      ]),
      gitResult(
        0,
        `${"2".repeat(40)} package.json\n${"3".repeat(40)} pnpm-lock.yaml\n`,
      ),
    ],
    [
      gitKey([
        "rev-list",
        "--reverse",
        developmentHistoryContract.sourceRef,
        "--",
        "package.json",
      ]),
      gitResult(
        0,
        `${developmentHistoryContract.expectedSourceCommit}\n`,
      ),
    ],
    [
      gitKey([
        "show",
        `${developmentHistoryContract.expectedSourceCommit}:package.json`,
      ]),
      gitResult(0, '{"name":"global-diesel-regulations"}\n'),
    ],
    [
      gitKey([
        "merge-base",
        developmentHistoryContract.masterRef,
        developmentHistoryContract.sourceRef,
      ]),
      gitResult(1),
    ],
  ]);
  for (const milestone of milestones) {
    const commit = milestoneCommit(milestone);
    results.set(
      gitKey(["rev-parse", "--verify", `${milestone}^{commit}`]),
      gitResult(0, `${commit}\n`),
    );
    results.set(
      gitKey([
        "merge-base",
        "--is-ancestor",
        commit,
        developmentHistoryContract.sourceRef,
      ]),
      gitResult(0),
    );
  }
  for (const [key, result] of overrides) results.set(key, result);

  return (args) =>
    results.get(gitKey(args)) ??
    gitResult(127, "", `unexpected injected git command: ${args.join(" ")}`);
}

function verifyInjectedHistory(
  overrides: ReadonlyMap<string, GitResult> = new Map(),
  record: unknown = auditRecord,
) {
  return () =>
    verifyDevelopmentHistoryContract({
      auditRecord: record,
      dependencyLicenseEvidence,
      markdown: contractMarkdown,
      repositoryFiles: retainedFiles,
      runGit: createHistoryGitRunner(overrides),
    });
}

describe("read-only development-history evidence", () => {
  it("locks the authoritative refs and historical commit counts", () => {
    expect(developmentHistoryContract).toEqual({
      archiveRef: "refs/heads/codex/fde-development-history-archive",
      archiveRemoteTrackingRef:
        "refs/remotes/origin/codex/fde-development-history-archive",
      expectedCommitCount: 50,
      expectedNonMergeCommitCount: 42,
      expectedSourceCommit: "6be02895643a3fdf8dcee1a5876c5f3d70d03036",
      masterRef: "refs/heads/master",
      sourceRef: "refs/heads/codex/fde-multimodal-global-regulations",
    });
  });

  it("keeps 3–5 unique representative milestones in the documented review path", async () => {
    const markdown = await readFile(
      resolve(process.cwd(), "docs/DEVELOPMENT_HISTORY.md"),
      "utf8",
    );
    expect(parseRepresentativeMilestones(markdown)).toEqual(milestones);
  });

  it("keeps the local audit artifact blocked and labels historical claims as non-reproducible", async () => {
    const contents = await readFile(
      resolve(
        process.cwd(),
        "scripts/history/fde-development-history-audit.json",
      ),
      "utf8",
    );

    expect(parseDevelopmentHistoryAuditRecord(contents)).toEqual(auditRecord);
    expect(auditRecord.publicationGate).toMatchObject({
      publicationPermitted: false,
      status: "blocked",
    });
    expect(auditRecord.recordedClaims.fullHistorySecretScan).toMatchObject({
      evidenceLevel: "historical-operator-record-only",
      rawReportPresent: false,
    });
  });

  it("retains the bounded human review without promoting it to publication approval", async () => {
    const relativePath = "evidence/fde-development-history-human-review-2026-09-12.md";
    const [history, review] = await Promise.all([
      readFile(resolve(process.cwd(), "docs/DEVELOPMENT_HISTORY.md"), "utf8"),
      readFile(resolve(process.cwd(), "docs", relativePath), "utf8"),
    ]);

    // Both language entry points must resolve to the same retained note.
    expect(history.split(`](${relativePath})`)).toHaveLength(3);
    expect(review).toContain(developmentHistoryContract.expectedSourceCommit);
    expect(review).toContain("Observed: 2026-09-12");
    expect(review).toContain("Human review summary; not redistribution approval.");
    expect(review).toContain("原始材料未随本摘要入库");
    expect(review).toContain("No native-binary rebuild requirement is added.");
    for (const blocker of [
      ...auditRecord.publicationGate.machineVerifiedBlockers,
      ...auditRecord.publicationGate.manualBlockers,
    ]) {
      expect(review).toContain(`\`${blocker}\``);
    }
    const sourceKeys = [...review.matchAll(/^\| `(\w+)` \|/gmu)]
      .map((match) => match[1]).sort();
    expect(sourceKeys).toEqual([
      "braSenatran2022", "braSenatran2023", "chnNbs2024",
      "deuEurostatBus", "deuEurostatTruck",
      "usaFhwaMv10x2022", "usaFhwaMv10x2023",
      "usaFhwaMv1x2022", "usaFhwaMv1x2023",
    ].sort());
  });

  it("verifies an injected unrelated history without repository-local refs", () => {
    expect(verifyInjectedHistory()).not.toThrow();
  });

  it.each([
    { ...auditRecord, subject: { ...auditRecord.subject, commit: "a".repeat(40) } },
    { ...auditRecord, subject: { ...auditRecord.subject, commitCount: 49 } },
    {
      ...auditRecord,
      recordedClaims: {
        ...auditRecord.recordedClaims,
        fullHistorySecretScan: { ...auditRecord.recordedClaims.fullHistorySecretScan, recordedAt: "2026-09-05" },
      },
    },
  ])("keeps audit identity and the older dated claim bound without Git", (record) => {
    expect(() => parseDevelopmentHistoryAuditRecord(JSON.stringify(record))).toThrow(/v3 schema/u);
  });

  it("requires the retained raw evidence without acquiring the local history", () => {
    expect(() => verifyDevelopmentHistoryContract({
      auditRecord,
      dependencyLicenseEvidence,
      markdown: contractMarkdown,
      repositoryFiles: retainedFiles.filter((file) => !file.path.endsWith(".history-log.json")),
      runGit: createHistoryGitRunner(),
    })).toThrow(/raw bytes drifted/u);
  });

  it.each([
    {
      error: /Authoritative history source .* failed \(git exit 128\)/u,
      key: gitKey([
        "rev-parse",
        "--verify",
        `${developmentHistoryContract.sourceRef}^{commit}`,
      ]),
      result: gitResult(128, "", "unknown revision"),
      scenario: "missing authoritative source ref",
    },
    {
      error: /Development-history source drifted/u,
      key: gitKey([
        "rev-parse",
        "--verify",
        `${developmentHistoryContract.sourceRef}^{commit}`,
      ]),
      result: gitResult(0, `${"f".repeat(40)}\n`),
      scenario: "source SHA drift",
    },
    {
      error: /Development-history commit count drifted: expected 50, found 51/u,
      key: gitKey([
        "rev-list",
        "--count",
        developmentHistoryContract.sourceRef,
      ]),
      result: gitResult(0, "51\n"),
      scenario: "total commit-count drift",
    },
    {
      error:
        /Development-history non-merge commit count drifted: expected 42, found 41/u,
      key: gitKey([
        "rev-list",
        "--count",
        "--no-merges",
        developmentHistoryContract.sourceRef,
      ]),
      result: gitResult(0, "41\n"),
      scenario: "non-merge commit-count drift",
    },
    {
      error: /source contains a license path/u,
      key: gitKey([
        "rev-list",
        "--objects",
        developmentHistoryContract.sourceRef,
      ]),
      result: gitResult(0, `${"2".repeat(40)} LICENSE\n`),
      scenario: "a license path that invalidates the blocked audit record",
    },
    {
      error: /source contains a notice path/u,
      key: gitKey([
        "rev-list",
        "--objects",
        developmentHistoryContract.sourceRef,
      ]),
      result: gitResult(0, `${"2".repeat(40)} legal/NOTICE.md\n`),
      scenario: "a notice path that invalidates the blocked audit record",
    },
    {
      error: /package manifest .* declares a license/u,
      key: gitKey([
        "show",
        `${developmentHistoryContract.expectedSourceCommit}:package.json`,
      ]),
      result: gitResult(0, '{"license":"MIT","name":"diesel"}\n'),
      scenario: "a package license field that requires renewed review",
    },
    {
      error: /package manifest .* declares a license/u,
      key: gitKey([
        "show",
        `${developmentHistoryContract.expectedSourceCommit}:package.json`,
      ]),
      result: gitResult(0, '{"licenses":[{"type":"MIT"}]}\n'),
      scenario: "a legacy package licenses field that requires renewed review",
    },
    {
      error: /must remain unrelated to master; merge base/u,
      key: gitKey([
        "merge-base",
        developmentHistoryContract.masterRef,
        developmentHistoryContract.sourceRef,
      ]),
      result: gitResult(0, `${"2".repeat(40)}\n`),
      scenario: "unexpected merge base",
    },
    {
      error: /Representative milestone 592d8ed.*failed \(git exit 128\)/u,
      key: gitKey(["rev-parse", "--verify", "592d8ed^{commit}"]),
      result: gitResult(128, "", "unknown revision"),
      scenario: "missing milestone commit",
    },
    {
      error: /Representative milestone 592d8ed is not an ancestor/u,
      key: gitKey([
        "merge-base",
        "--is-ancestor",
        milestoneCommit("592d8ed"),
        developmentHistoryContract.sourceRef,
      ]),
      result: gitResult(1),
      scenario: "milestone ancestry drift",
    },
    {
      error: /archive ref .* exists while the documented license gate remains unresolved/u,
      key: gitKey([
        "show-ref",
        "--verify",
        "--quiet",
        developmentHistoryContract.archiveRef,
      ]),
      result: gitResult(0),
      scenario: "unexpected local archive ref",
    },
    {
      error: /archive ref .* exists while the documented license gate remains unresolved/u,
      key: gitKey([
        "show-ref",
        "--verify",
        "--quiet",
        developmentHistoryContract.archiveRemoteTrackingRef,
      ]),
      result: gitResult(0),
      scenario: "unexpected remote-tracking archive ref",
    },
  ])("fails closed for $scenario", ({ error, key, result }) => {
    expect(verifyInjectedHistory(new Map([[key, result]]))).toThrow(error);
  });

  it.each([
    {
      mutation: {
        ...auditRecord,
        publicationGate: {
          ...auditRecord.publicationGate,
          publicationPermitted: true,
          status: "ready",
        },
      },
      scenario: "an unreviewed publication-ready claim",
    },
    {
      mutation: {
        ...auditRecord,
        recordedClaims: {
          ...auditRecord.recordedClaims,
          fullHistorySecretScan: {
            ...auditRecord.recordedClaims.fullHistorySecretScan,
            evidenceLevel: "repository-verifiable",
            rawReportPresent: true,
          },
        },
      },
      scenario: "a fabricated repository-verifiable secret-scan claim",
    },
  ])("rejects $scenario", ({ mutation }) => {
    expect(verifyInjectedHistory(new Map(), mutation)).toThrow();
  });

  it(
    "verifies the opt-in real source topology without updating refs",
    async (context) => {
      if (process.env.DIESEL_VERIFY_LOCAL_HISTORY !== "1") {
        context.skip();
        return;
      }
      const refsBefore = execFileSync("git", ["show-ref"], {
        cwd: process.cwd(),
        encoding: "utf8",
      });
      await expect(verifyDevelopmentHistory()).resolves.toMatchObject({
        commitCount: 50,
        milestones: [
          "592d8ed",
          "77eaa07",
          "47c453b",
          "b50dae6",
          "6be0289",
        ],
        nonMergeCommitCount: 42,
        sourceCommit: "6be02895643a3fdf8dcee1a5876c5f3d70d03036",
      });
      expect(
        execFileSync("git", ["show-ref"], {
          cwd: process.cwd(),
          encoding: "utf8",
        }),
      ).toBe(refsBefore);
    },
  );

  it("keeps all current source/archive references inside the static allowlist", async () => {
    const files = await readRepositoryTextFiles(process.cwd());
    expect(findDisallowedHistoryRefMentions(files)).toEqual([]);
  });

  it.each([
    [
      ".github/workflows/release.yml",
      "ref: codex/fde-multimodal-global-regulations",
      "codex/fde-multimodal-global-regulations",
    ],
    [
      "scripts/deploy/release.sh",
      "git checkout codex/fde-development-history-archive",
      "codex/fde-development-history-archive",
    ],
  ])(
    "rejects protected history refs from the release surface %s",
    (path, contents, ref) => {
      expect(findDisallowedHistoryRefMentions([{ contents, path }])).toEqual([
        `${path}: ${ref}`,
      ]);
    },
  );
});
