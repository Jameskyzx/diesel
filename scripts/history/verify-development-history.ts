import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import {
  retainedDependencyLicenseArchiveContract,
  retainedDependencyLicenseManifestContract,
  verifyRetainedDependencyLicenses,
  type RetainedDependencyLicenseObserved,
} from "./retained-dependency-licenses";

export const developmentHistoryContract = {
  archiveRef: "refs/heads/codex/fde-development-history-archive",
  archiveRemoteTrackingRef:
    "refs/remotes/origin/codex/fde-development-history-archive",
  expectedCommitCount: 50,
  expectedNonMergeCommitCount: 42,
  expectedSourceCommit: "6be02895643a3fdf8dcee1a5876c5f3d70d03036",
  masterRef: "refs/heads/master",
  sourceRef: "refs/heads/codex/fde-multimodal-global-regulations",
} as const;

export const historyRefMentionAllowlist = new Set([
  "docs/DEVELOPMENT_HISTORY.md",
  "scripts/history/verify-development-history.ts",
  "tests/development-history.test.ts",
]);

export const developmentHistoryAuditPath =
  "scripts/history/fde-development-history-audit.json" as const;
const retainedScanPrefix =
  "docs/evidence/fde-development-history-secret-scan-2026-09-05";
export const retainedHistorySecretScanManifestContract = {
  path: `${retainedScanPrefix}.manifest.json`,
  byteLength: 3370,
  sha256: "4dbd0171c75aab4791585b26df43285f85d53ce64c6ba9dfc6e60686b2728b40",
} as const;
export const retainedHistorySecretScanRawPaths = [
  `${retainedScanPrefix}.history-log.json`,
  `${retainedScanPrefix}.history-report.json`,
  `${retainedScanPrefix}.canary-log.json`,
  `${retainedScanPrefix}.canary-report.json`,
] as const;
export const retainedHistorySecretScanPaths = [
  retainedHistorySecretScanManifestContract.path,
  ...retainedHistorySecretScanRawPaths,
] as const;
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const sha1Schema = z.string().regex(/^[0-9a-f]{40}$/u);
const retainedScanObservedSchema = z.object({
  history: z.object({
    exitCode: z.literal(0),
    signal: z.null(),
    errorCode: z.null(),
    scannerReportedCommitCount: z.number().int().positive(),
    findingCount: z.literal(0),
  }).strict(),
  canary: z.object({
    exitCode: z.literal(97),
    findingCount: z.literal(1),
    ruleId: z.literal("github-pat"),
    redaction: z.literal("full"),
  }).strict(),
}).strict();
type RetainedScanObserved = z.infer<typeof retainedScanObservedSchema>;
const captureWindowSchema = z.object({
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  semantics: z.literal("enclosing-capture-window"),
}).strict();
const retainedRawDescriptorSchema = z.object({
  path: z.enum(retainedHistorySecretScanRawPaths),
  byteLength: z.number().int().positive().max(16 * 1024),
  sha256: sha256Schema,
}).strict();
const retainedRawPairSchema = z.object({
  log: retainedRawDescriptorSchema,
  report: retainedRawDescriptorSchema,
}).strict();
const retainedScanManifestSchema = z.object({
  schemaVersion: z.literal("diesel-fde-development-history-secret-scan-evidence-v1"),
  recordedDate: z.literal("2026-09-05"),
  evidenceLevel: z.literal("repository-contained-dated-run-record"),
  replayability: z.literal("external-pinned-tool-required"),
  toolMaterialsVendored: z.literal(false),
  subject: z.object({
    commit: z.literal(developmentHistoryContract.expectedSourceCommit),
    commitCount: z.literal(50),
    nonMergeCommitCount: z.literal(42),
    mergeCommitCount: z.literal(8),
  }).strict(),
  sourceScope: z.object({
    fullHistory: z.literal(true),
    rootDiffs: z.literal(true),
    mergeDiffs: z.literal("separate"),
    refSelection: z.literal("exact-commit"),
  }).strict(),
  tool: z.object({
    name: z.literal("gitleaks"),
    version: z.literal("8.21.2"),
    platform: z.literal("darwin-arm64"),
    officialReleaseUrl: z.literal("https://github.com/gitleaks/gitleaks/releases/tag/v8.21.2"),
    archiveName: z.literal("gitleaks_8.21.2_darwin_arm64.tar.gz"),
    archiveSha256: sha256Schema,
    binarySha256: sha256Schema,
    checksumManifestSha256: sha256Schema,
  }).strict(),
  policy: z.object({
    repositoryPath: z.literal(".gitleaks.toml"),
    sourceCommit: sha1Schema,
    gitBlobSha1: sha1Schema,
    sha256: sha256Schema,
  }).strict(),
  captureWindows: z.object({
    canary: captureWindowSchema,
    history: captureWindowSchema,
  }).strict(),
  observed: retainedScanObservedSchema,
  raw: z.object({
    history: retainedRawPairSchema,
    canary: retainedRawPairSchema,
  }).strict(),
  invalidatedAttempt: z.object({
    disposition: z.literal("invalidated"),
    manifestSha256: sha256Schema,
    historyLogSha256: sha256Schema,
    reasonCode: z.literal("scanner-error-diagnostic-with-zero-exit"),
  }).strict(),
  licenseReview: z.literal("not-performed"),
  publicationEffect: z.literal("none"),
}).strict();

function parseRetainedJson(contents: string): unknown {
  try {
    return JSON.parse(contents) as unknown;
  } catch {
    throw new Error("Retained history scan output is not valid JSON");
  }
}

function assertRetainedDiagnostics(diagnostics: string, label: string): void {
  if (/(?:^|\s)(?:ERR|FTL|PNC|ERROR|FATAL)(?:\s|$)|failed to scan|\berror=|\bpanic:/imu.test(diagnostics)) {
    throw new Error(`Retained ${label} scan contains an error diagnostic`);
  }
  if ([...diagnostics.matchAll(/^.*\bINF scan completed in [^\r\n]+$/gmu)].length !== 1) {
    throw new Error(`Retained ${label} scan lacks a unique completion diagnostic`);
  }
}

/** Recomputes saved output semantics; it does not run or authenticate a scanner. */
export function summarizeRetainedHistorySecretScanOutput(input: {
  historyLog: unknown;
  historyReport: unknown;
  canaryLog: unknown;
  canaryReport: unknown;
}): RetainedScanObserved {
  const history = z.object({
    exitCode: z.literal(0), signal: z.null(), errorCode: z.null(),
    stdout: z.string().max(16 * 1024), stderr: z.string().max(16 * 1024),
  }).strict().parse(input.historyLog);
  const canary = z.object({
    exitCode: z.literal(97),
    stdout: z.string().max(16 * 1024), stderr: z.string().max(16 * 1024),
  }).strict().parse(input.canaryLog);
  const historyDiagnostics = `${history.stdout}\n${history.stderr}`;
  const canaryDiagnostics = `${canary.stdout}\n${canary.stderr}`;
  assertRetainedDiagnostics(historyDiagnostics, "history");
  assertRetainedDiagnostics(canaryDiagnostics, "canary");
  z.array(z.unknown()).length(0).parse(input.historyReport);
  const counts = [...historyDiagnostics.matchAll(/^.*\bINF ([0-9]+) commits scanned\.$/gmu)];
  const scannerReportedCommitCount = Number(counts[0]?.[1]);
  if (
    counts.length !== 1 || !Number.isSafeInteger(scannerReportedCommitCount) ||
    scannerReportedCommitCount < 1
  ) throw new Error("Retained history scan lacks a unique positive scanner count");
  if ([...historyDiagnostics.matchAll(/^.*\bINF no leaks found$/gmu)].length !== 1) {
    throw new Error("Retained history scan lacks a unique no-leaks diagnostic");
  }
  const canaryFile = "/private/tmp/diesel-fde-secrets-20260905.WMbSLO/canary/canary.env";
  z.array(z.object({
    Description: z.string().max(1000),
    StartLine: z.literal(1), EndLine: z.literal(1),
    StartColumn: z.literal(14), EndColumn: z.literal(53),
    Match: z.literal("REDACTED"), Secret: z.literal("REDACTED"),
    File: z.literal(canaryFile), SymlinkFile: z.literal(""), Commit: z.literal(""),
    Entropy: z.number().finite().nonnegative(),
    Author: z.literal(""), Email: z.literal(""), Date: z.literal(""), Message: z.literal(""),
    Tags: z.array(z.string()).length(0), RuleID: z.literal("github-pat"),
    Fingerprint: z.literal(`${canaryFile}:github-pat:1`),
  }).strict()).length(1).parse(input.canaryReport);
  if ([...canaryDiagnostics.matchAll(/^.*\bWRN leaks found: 1$/gmu)].length !== 1) {
    throw new Error("Retained canary scan lacks its single-finding diagnostic");
  }
  return {
    history: { exitCode: 0, signal: null, errorCode: null, scannerReportedCommitCount, findingCount: 0 },
    canary: { exitCode: 97, findingCount: 1, ruleId: "github-pat", redaction: "full" },
  };
}

export function verifyRetainedHistorySecretScan(input: {
  manifestText: string;
  rawFiles: ReadonlyMap<string, Uint8Array>;
}): RetainedScanObserved {
  const contract = retainedHistorySecretScanManifestContract;
  // This dated record is frozen, including tool/policy identities and time windows.
  // Its hash is an integrity binding, not a signature or proof of execution.
  if (
    Buffer.byteLength(input.manifestText, "utf8") !== contract.byteLength ||
    createHash("sha256").update(input.manifestText, "utf8").digest("hex") !== contract.sha256
  ) throw new Error("Retained history scan manifest differs from the reviewed dated record");
  const manifest = retainedScanManifestSchema.parse(parseRetainedJson(input.manifestText));
  function readRaw(descriptor: z.infer<typeof retainedRawDescriptorSchema>): unknown {
    const bytes = input.rawFiles.get(descriptor.path);
    if (
      bytes === undefined || bytes.byteLength !== descriptor.byteLength ||
      createHash("sha256").update(bytes).digest("hex") !== descriptor.sha256
    ) throw new Error(`Retained history scan raw bytes drifted: ${descriptor.path}`);
    return parseRetainedJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  }
  const observed = summarizeRetainedHistorySecretScanOutput({
    historyLog: readRaw(manifest.raw.history.log),
    historyReport: readRaw(manifest.raw.history.report),
    canaryLog: readRaw(manifest.raw.canary.log),
    canaryReport: readRaw(manifest.raw.canary.report),
  });
  if (JSON.stringify(observed) !== JSON.stringify(manifest.observed)) {
    throw new Error("Retained history scan summary does not match its raw outputs");
  }
  return observed;
}

export const developmentHistoryAuditRecordSchema = z.object({
  schemaVersion: z.literal("fde-development-history-audit-v3"),
  subject: z.object({
    commit: z.literal(developmentHistoryContract.expectedSourceCommit),
    commitCount: z.literal(developmentHistoryContract.expectedCommitCount),
    nonMergeCommitCount: z.literal(developmentHistoryContract.expectedNonMergeCommitCount),
  }).strict(),
  retainedSecretScan: z.object({
    recordedAt: z.literal("2026-09-05"),
    observedResult: z.literal("completed-zero-findings"),
    evidenceLevel: z.literal("repository-contained-dated-run-record"),
    rawReportPresent: z.literal(true),
    replayableFromRepository: z.literal(false),
    manifest: z.object({
      path: z.literal(retainedHistorySecretScanManifestContract.path),
      byteLength: z.literal(retainedHistorySecretScanManifestContract.byteLength),
      sha256: z.literal(retainedHistorySecretScanManifestContract.sha256),
    }).strict(),
  }).strict(),
  retainedDependencyLicenseScan: z.object({
    recordedAt: z.literal("2026-09-05"),
    observedResult: z.literal("metadata-collected-with-unresolved-review-items"),
    evidenceLevel: z.literal("repository-contained-dated-run-record"),
    rawReportPresent: z.literal(true),
    replayableFromRepository: z.literal(false),
    licenseApproval: z.literal("not-performed"),
    manifest: z.object({
      path: z.literal(retainedDependencyLicenseManifestContract.path),
      byteLength: z.literal(retainedDependencyLicenseManifestContract.byteLength),
      sha256: z.literal(retainedDependencyLicenseManifestContract.sha256),
    }).strict(),
  }).strict(),
  recordedClaims: z.object({
    fullHistorySecretScan: z.object({
      recordedAt: z.literal("2026-08-20"),
      reportedResult: z.literal("passed"),
      evidenceLevel: z.literal("historical-operator-record-only"),
      rawReportPresent: z.literal(false),
    }).strict(),
    dependencyLicenseMetadataScan: z.object({
      recordedAt: z.literal("2026-08-20"),
      reportedResult: z.literal("metadata-passed-with-review-items"),
      evidenceLevel: z.literal("historical-operator-record-only"),
      rawReportPresent: z.literal(false),
    }).strict(),
  }).strict(),
  publicationGate: z.object({
    status: z.literal("blocked"),
    publicationPermitted: z.literal(false),
    machineVerifiedBlockers: z.tuple([
      z.literal("source-project-license-missing"),
      z.literal("source-project-notice-missing"),
      z.literal("source-package-license-field-missing"),
    ]),
    manualBlockers: z.tuple([
      z.literal("historical-assets-and-copied-material-review-incomplete"),
      z.literal("weak-copyleft-and-notice-policy-missing"),
    ]),
  }).strict(),
}).strict();

export type DevelopmentHistoryAuditRecord = z.infer<
  typeof developmentHistoryAuditRecordSchema
>;

export type RepositoryTextFile = {
  contents: string;
  path: string;
};

export type DevelopmentHistoryVerification = {
  commitCount: number;
  milestones: readonly string[];
  nonMergeCommitCount: number;
  publicationGateStatus: "blocked";
  secretScanEvidenceLevel: "repository-contained-dated-run-record";
  secretScanObserved: RetainedScanObserved;
  dependencyLicenseObserved: RetainedDependencyLicenseObserved;
  sourceCommit: string;
};

export type GitResult = {
  status: number;
  stderr: string;
  stdout: string;
};

export type HistoryGitRunner = (args: readonly string[]) => GitResult;

function runGitAtRoot(root: string, args: readonly string[]): GitResult {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.signal !== null) {
    throw new Error(`git ${args.join(" ")} was terminated by ${result.signal}`);
  }
  if (result.status === null) {
    throw new Error(`git ${args.join(" ")} returned no exit status`);
  }
  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

function requireGitSuccess(
  runGit: HistoryGitRunner,
  args: readonly string[],
  label: string,
): string {
  const result = runGit(args);
  if (result.status !== 0) {
    const diagnostics = [result.stderr.trim(), result.stdout.trim()]
      .filter((value) => value.length > 0)
      .join("\n");
    throw new Error(
      `${label} failed (git exit ${result.status})${diagnostics ? `:\n${diagnostics}` : ""}`,
    );
  }
  return result.stdout.trim();
}

function parseCount(value: string, label: string): number {
  if (!/^\d+$/u.test(value)) {
    throw new Error(`${label} did not return a non-negative integer`);
  }
  return Number(value);
}

export function parseDevelopmentHistoryAuditRecord(
  contents: string,
): DevelopmentHistoryAuditRecord {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new Error("Development-history audit record is not valid JSON");
  }
  const parsed = developmentHistoryAuditRecordSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Development-history audit record does not match its v3 schema: ${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}

export function parseRepresentativeMilestones(markdown: string): string[] {
  const section = markdown.match(
    /## Representative milestones\s+([\s\S]*?)\s+## Publication gate/u,
  )?.[1];
  if (!section) {
    throw new Error(
      "docs/DEVELOPMENT_HISTORY.md is missing its representative milestone section",
    );
  }

  const milestones = Array.from(
    section.matchAll(/^\| `([0-9a-f]{7,40})` \|/gmu),
    (match) => match[1]!,
  );
  if (milestones.length < 3 || milestones.length > 5) {
    throw new Error(
      `docs/DEVELOPMENT_HISTORY.md must list 3–5 representative milestones; found ${milestones.length}`,
    );
  }
  if (new Set(milestones).size !== milestones.length) {
    throw new Error(
      "docs/DEVELOPMENT_HISTORY.md contains duplicate representative milestones",
    );
  }
  return milestones;
}

export function findDisallowedHistoryRefMentions(
  files: readonly RepositoryTextFile[],
): string[] {
  const protectedRefs = [
    developmentHistoryContract.sourceRef.replace(/^refs\/heads\//u, ""),
    developmentHistoryContract.archiveRef.replace(/^refs\/heads\//u, ""),
  ];
  return files.flatMap((file) =>
    historyRefMentionAllowlist.has(file.path)
      ? []
      : protectedRefs.flatMap((ref) =>
          file.contents.includes(ref) ? [`${file.path}: ${ref}`] : [],
        ),
  );
}

export async function readRepositoryTextFiles(
  root: string,
): Promise<RepositoryTextFile[]> {
  const output = requireGitSuccess(
    (args) => runGitAtRoot(root, args),
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    "Repository file inventory",
  );
  const paths = output.split("\0").filter((path) => path.length > 0);
  const files = await Promise.all(
    paths.map(async (path): Promise<RepositoryTextFile | null> => {
      const absolutePath = resolve(root, path);
      const metadata = await lstat(absolutePath);
      if (!metadata.isFile()) return null;
      const contents = await readFile(absolutePath, "utf8");
      return contents.includes("\0") ? null : { contents, path };
    }),
  );
  return files.filter((file): file is RepositoryTextFile => file !== null);
}

export function verifyDevelopmentHistoryContract(input: {
  auditRecord: unknown;
  dependencyLicenseEvidence: { manifestText: string; archiveBytes: Uint8Array };
  markdown: string;
  repositoryFiles: readonly RepositoryTextFile[];
  runGit: HistoryGitRunner;
}): DevelopmentHistoryVerification {
  const contract = developmentHistoryContract;
  const auditRecord = developmentHistoryAuditRecordSchema.parse(
    input.auditRecord,
  );
  const dependencyLicenseObserved = verifyRetainedDependencyLicenses(input.dependencyLicenseEvidence);
  const retainedManifest = input.repositoryFiles.find(
    (file) => file.path === retainedHistorySecretScanManifestContract.path,
  );
  if (retainedManifest === undefined) {
    throw new Error("Development-history retained scan manifest is missing");
  }
  const secretScanObserved = verifyRetainedHistorySecretScan({
    manifestText: retainedManifest.contents,
    rawFiles: new Map(input.repositoryFiles.map((file) => [
      file.path, Buffer.from(file.contents, "utf8"),
    ])),
  });
  const sourceName = contract.sourceRef.replace(/^refs\/heads\//u, "");
  const archiveName = contract.archiveRef.replace(/^refs\/heads\//u, "");
  if (!input.markdown.includes(`\`${sourceName}\``)) {
    throw new Error(`Development-history document must name ${sourceName}`);
  }
  if (!input.markdown.includes(`\`${archiveName}\``)) {
    throw new Error(`Development-history document must name ${archiveName}`);
  }

  const sourceCommit = requireGitSuccess(
    input.runGit,
    ["rev-parse", "--verify", `${contract.sourceRef}^{commit}`],
    `Authoritative history source ${contract.sourceRef}`,
  );
  if (sourceCommit !== contract.expectedSourceCommit) {
    throw new Error(
      `Development-history source drifted: expected ${contract.expectedSourceCommit}, found ${sourceCommit}`,
    );
  }
  requireGitSuccess(
    input.runGit,
    ["rev-parse", "--verify", `${contract.masterRef}^{commit}`],
    `Canonical release source ${contract.masterRef}`,
  );

  for (const unpublishedRef of [
    contract.archiveRef,
    contract.archiveRemoteTrackingRef,
  ]) {
    const archive = input.runGit([
      "show-ref",
      "--verify",
      "--quiet",
      unpublishedRef,
    ]);
    if (archive.status === 0) {
      throw new Error(
        `Development-history archive ref ${unpublishedRef} exists while the documented license gate remains unresolved`,
      );
    }
    if (archive.status !== 1) {
      throw new Error(
        `Unable to prove development-history archive ref ${unpublishedRef} is absent (git show-ref exited ${archive.status})`,
      );
    }
  }

  const commitCount = parseCount(
    requireGitSuccess(
      input.runGit,
      ["rev-list", "--count", contract.sourceRef],
      "Development-history commit count",
    ),
    "Development-history commit count",
  );
  if (commitCount !== contract.expectedCommitCount) {
    throw new Error(
      `Development-history commit count drifted: expected ${contract.expectedCommitCount}, found ${commitCount}`,
    );
  }

  const nonMergeCommitCount = parseCount(
    requireGitSuccess(
      input.runGit,
      ["rev-list", "--count", "--no-merges", contract.sourceRef],
      "Development-history non-merge commit count",
    ),
    "Development-history non-merge commit count",
  );
  if (nonMergeCommitCount !== contract.expectedNonMergeCommitCount) {
    throw new Error(
      `Development-history non-merge commit count drifted: expected ${contract.expectedNonMergeCommitCount}, found ${nonMergeCommitCount}`,
    );
  }

  if (
    auditRecord.subject.commit !== sourceCommit ||
    auditRecord.subject.commitCount !== commitCount ||
    auditRecord.subject.nonMergeCommitCount !== nonMergeCommitCount
  ) {
    throw new Error(
      "Development-history audit subject does not match the verified source topology",
    );
  }

  const historicalPaths = requireGitSuccess(
    input.runGit,
    ["rev-list", "--objects", contract.sourceRef],
    "Development-history object inventory",
  ).split("\n").flatMap((line) => {
    const separator = line.indexOf(" ");
    return separator === -1 ? [] : [line.slice(separator + 1)];
  });
  if (
    historicalPaths.some((path) =>
      /(^|\/)licen[cs]e(?:\.[^/]+)?$/iu.test(path)
    )
  ) {
    throw new Error(
      "Development-history source contains a license path; the blocked audit record must be reviewed",
    );
  }
  if (
    historicalPaths.some((path) =>
      /(^|\/)notice(?:\.[^/]+)?$/iu.test(path)
    )
  ) {
    throw new Error(
      "Development-history source contains a notice path; the blocked audit record must be reviewed",
    );
  }

  const packageManifestCommits = requireGitSuccess(
    input.runGit,
    ["rev-list", "--reverse", contract.sourceRef, "--", "package.json"],
    "Development-history package manifest revisions",
  ).split("\n").filter(Boolean);
  if (packageManifestCommits.length === 0) {
    throw new Error("Development-history contains no package manifest revision");
  }
  for (const commit of packageManifestCommits) {
    if (!/^[0-9a-f]{40}$/u.test(commit)) {
      throw new Error(
        "Development-history package manifest revisions returned an invalid commit",
      );
    }
    const packageJsonText = requireGitSuccess(
      input.runGit,
      ["show", `${commit}:package.json`],
      `Development-history package manifest at ${commit}`,
    );
    let packageJson: unknown;
    try {
      packageJson = JSON.parse(packageJsonText);
    } catch {
      throw new Error(
        `Development-history package manifest at ${commit} is not valid JSON`,
      );
    }
    if (
      typeof packageJson !== "object" ||
      packageJson === null ||
      Array.isArray(packageJson)
    ) {
      throw new Error(
        `Development-history package manifest at ${commit} must be a JSON object`,
      );
    }
    if (
      Object.hasOwn(packageJson, "license") ||
      Object.hasOwn(packageJson, "licenses")
    ) {
      throw new Error(
        `Development-history package manifest at ${commit} declares a license; the blocked audit record must be reviewed`,
      );
    }
  }

  const mergeBase = input.runGit([
    "merge-base",
    contract.masterRef,
    contract.sourceRef,
  ]);
  if (mergeBase.status === 0) {
    throw new Error(
      `Development history must remain unrelated to master; merge base ${mergeBase.stdout.trim()} was found`,
    );
  }
  if (mergeBase.status !== 1) {
    throw new Error(
      `Unable to prove unrelated histories (git merge-base exited ${mergeBase.status}): ${mergeBase.stderr.trim()}`,
    );
  }

  const milestones = parseRepresentativeMilestones(input.markdown);
  for (const milestone of milestones) {
    const commit = requireGitSuccess(
      input.runGit,
      ["rev-parse", "--verify", `${milestone}^{commit}`],
      `Representative milestone ${milestone}`,
    );
    const ancestor = input.runGit([
      "merge-base",
      "--is-ancestor",
      commit,
      contract.sourceRef,
    ]);
    if (ancestor.status !== 0) {
      throw new Error(
        `Representative milestone ${milestone} is not an ancestor of ${contract.sourceRef}`,
      );
    }
  }

  const disallowedMentions = findDisallowedHistoryRefMentions(
    input.repositoryFiles,
  );
  if (disallowedMentions.length > 0) {
    throw new Error(
      "Development-history refs appear outside the static documentation/verifier allowlist:\n- " +
        disallowedMentions.join("\n- "),
    );
  }

  return {
    commitCount,
    milestones,
    nonMergeCommitCount,
    publicationGateStatus: auditRecord.publicationGate.status,
    secretScanEvidenceLevel:
      auditRecord.retainedSecretScan.evidenceLevel,
    secretScanObserved,
    dependencyLicenseObserved,
    sourceCommit,
  };
}

export async function verifyDevelopmentHistory(
  root = process.cwd(),
): Promise<DevelopmentHistoryVerification> {
  const [auditRecordContents, markdown, repositoryFiles, dependencyManifestText, dependencyArchiveBytes] = await Promise.all([
    readFile(
      resolve(
        root,
        developmentHistoryAuditPath,
      ),
      "utf8",
    ),
    readFile(resolve(root, "docs/DEVELOPMENT_HISTORY.md"), "utf8"),
    readRepositoryTextFiles(root),
    readFile(resolve(root, retainedDependencyLicenseManifestContract.path), "utf8"),
    readFile(resolve(root, retainedDependencyLicenseArchiveContract.path)),
  ]);
  return verifyDevelopmentHistoryContract({
    auditRecord: parseDevelopmentHistoryAuditRecord(auditRecordContents),
    dependencyLicenseEvidence: { manifestText: dependencyManifestText, archiveBytes: dependencyArchiveBytes },
    markdown,
    repositoryFiles,
    runGit: (args) => runGitAtRoot(root, args),
  });
}

async function main(): Promise<void> {
  const result = await verifyDevelopmentHistory();
  process.stdout.write(
    `Development history verified read-only: ${result.sourceCommit}; ` +
      `${result.commitCount} commits / ${result.nonMergeCommitCount} non-merge commits; ` +
      `unrelated to master; ${result.milestones.length} representative milestones. ` +
      `Publication gate: ${result.publicationGateStatus}; secret-scan evidence: ` +
      `${result.secretScanEvidenceLevel} (` +
      `${result.secretScanObserved.history.scannerReportedCommitCount} scanner-counted commits, ` +
      `zero findings, canary exit 97). Saved outputs were recomputed; no scanner was run. ` +
      `Dependency records: ${result.dependencyLicenseObserved.successfulFrozenInstalls} completed installs, ` +
      `${result.dependencyLicenseObserved.platformLicenseReports} platform license reports, ` +
      `${result.dependencyLicenseObserved.registryQueries} registry declarations; no license approval or execution replay. ` +
      `No refs were created or updated.\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
