import {
  accessSync,
  constants,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { appendFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";

import { portfolioPublicationSummary, portfolioReleaseCountryIso3s } from "../../src/domain/portfolio-evidence";
import { formatErrorTree } from "../format-error";
import {
  getApprovedRealCertificationIds,
  getApprovedRealProductIds,
} from "../../src/server/config/public-product-publication";
import { buildFixtureLimits } from "../../src/server/db/seed/acceptance-fixtures";
import { buildFullIngestSelection } from "../db/fixture-target-selection";
import {
  assertEvidenceSummaryConsistency,
  assertEvidenceSummaryProseConsistency,
  assertBrowserSnapshotConsistency,
  assertQualitySnapshotConsistency,
  assertReleaseProseConsistency,
  assertReleaseSnapshotConsistency,
  assertNoConcreteCurrentLiveEvalClaims,
  assertStatusLiveEvalProseConsistency,
  parseCurrentBrowserProse,
  parseCurrentQualityProse,
  parseCurrentReleaseProse,
  parseEvidenceSummaryProse,
  parseStatusSnapshot,
} from "./status-snapshot";
import {
  assertPlaywrightObservationSourceLocations,
  capturePlaywrightRepositoryState,
  capturePlaywrightSourceFingerprintAtRevision,
  parseCanonicalPlaywrightEvidence,
  playwrightEvidencePath,
} from "./playwright-evidence";
import {
  parseReleaseEvidenceModeArguments,
  portfolioReleaseEvidenceExplicitPaths,
  resolveReleaseEvidenceExpectedHead,
  verifyReleaseEvidenceReadiness,
} from "./release-evidence-readiness";
import {
  portfolioTrustedGitEnvironmentVariable,
  resolvePortfolioTrustedGitExecutable,
  runTrustedGit,
} from "./trusted-git";
import {
  assertCanonicalCiPackageScripts,
  assertCiGitleaksGuardSource,
  assertCiInstallBoundarySource,
  assertRequiredCiGateWorkflow,
  assertUniqueRequiredCiGateAcrossWorkflows,
  ciGitleaksGuardPath,
  ciInstallBoundaryPath,
  requiredCiWorkflowPath,
  resolveCiWorkflowSource,
} from "./verify-ci-workflow";
import {
  developmentHistoryAuditPath,
  parseDevelopmentHistoryAuditRecord,
  retainedHistorySecretScanManifestContract,
  retainedHistorySecretScanRawPaths,
  verifyRetainedHistorySecretScan,
} from "../history/verify-development-history";
import {
  retainedDependencyLicenseArchiveContract,
  retainedDependencyLicenseManifestContract,
  verifyRetainedDependencyLicenses,
} from "../history/retained-dependency-licenses";
import {
  assertLiveEvalReadmeCurrentReport,
  verifyLiveEvalEvidence,
} from "./verify-live-eval";
import {
  parseScreenshotManifest,
  screenshotManifestPath,
  verifyScreenshotManifest,
} from "./screenshot-manifest";
import {
  EXPECTED_VITEST_VERSION,
  VITEST_EXECUTION_EVIDENCE_MAX_BYTES,
  assertVitestListInventoryMatchesEvidence,
  captureVitestExecutionRepositoryState,
  captureVitestExecutionSourceFingerprintAtRevision,
  normalizeVitestListJson,
  vitestExecutionEvidencePath,
} from "./vitest-execution-evidence";
import { readVitestExecutionEvidence } from "./read-vitest-execution-evidence";
import { assertVitestExecutionProvenance } from "./verify-vitest-execution";
import { acquireVitestExecutionCaptureLock } from "./vitest-execution-capture-lock";
import { assertVerificationEqual } from "./verification-issues";
import {
  assertNoOrphanedVitestExecutionStagingFiles,
  assertVitestProcessGroupInventoryCapability,
  createVitestExecutionToolBin,
  isVitestWorkloadTerminationUnproven,
  runSupervisedVitestList,
} from "./capture-vitest-execution-evidence";
import { PortfolioVerificationInputLedger } from "./verification-input-snapshot";

export {
  countVitestRunnableJson,
  parseStatusSnapshot,
} from "./status-snapshot";

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  assertVerificationEqual(actual, expected, label);
}

function assertInstalledVitestVersion(vitestCli: string): void {
  const packagePath = realpathSync(resolve(dirname(vitestCli), "package.json"));
  const metadata = lstatSync(packagePath);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.size <= 0 ||
    metadata.size > 1024 * 1024
  ) {
    throw new Error("Installed Vitest package metadata is not a bounded file.");
  }
  let packageJson: unknown;
  try {
    packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  } catch (cause: unknown) {
    throw new Error("Installed Vitest package metadata is not valid JSON.", {
      cause,
    });
  }
  if (
    typeof packageJson !== "object" ||
    packageJson === null ||
    !("version" in packageJson) ||
    packageJson.version !== EXPECTED_VITEST_VERSION
  ) {
    throw new Error(
      `Portfolio verification requires Vitest ${EXPECTED_VITEST_VERSION}.`,
    );
  }
}

function runVitestListJson(workspace: string): string {
  const nodeExecutable = process.execPath;
  if (
    !isAbsolute(nodeExecutable) ||
    normalize(nodeExecutable) !== nodeExecutable
  ) {
    throw new Error("Portfolio verification requires an absolute Node executable.");
  }
  const nodeMetadata = lstatSync(nodeExecutable);
  accessSync(nodeExecutable, constants.X_OK);
  if (nodeMetadata.isSymbolicLink() || !nodeMetadata.isFile()) {
    throw new Error("Portfolio verification requires a regular Node executable.");
  }

  const nodeModules = realpathSync(resolve(workspace, "node_modules"));
  const vitestCli = realpathSync(
    resolve(workspace, "node_modules/vitest/vitest.mjs"),
  );
  if (
    vitestCli !== nodeModules &&
    !vitestCli.startsWith(`${nodeModules}${sep}`)
  ) {
    throw new Error("Vitest CLI resolved outside node_modules.");
  }
  const vitestMetadata = lstatSync(vitestCli);
  if (!vitestMetadata.isFile() || vitestMetadata.isSymbolicLink()) {
    throw new Error("Vitest CLI must resolve to a regular file.");
  }
  assertInstalledVitestVersion(vitestCli);

  const tools = createVitestExecutionToolBin();
  let inventoryDirectory: string | null = null;
  let executionError: unknown;
  let executionFailed = false;
  let containmentUnproven = false;
  try {
    inventoryDirectory = mkdtempSync(
      join(realpathSync("/tmp"), "diesel-vitest-inventory-"),
    );
    const inventoryPath = join(inventoryDirectory, "inventory.json");
    if (tools.nodeExecutable !== nodeExecutable) {
      throw new Error("Vitest inventory Node executable changed during setup.");
    }
    runSupervisedVitestList({ inventoryPath, tools, workspace });
    const inventoryMetadata = lstatSync(inventoryPath);
    if (
      inventoryMetadata.isSymbolicLink() ||
      !inventoryMetadata.isFile() ||
      inventoryMetadata.size <= 0 ||
      inventoryMetadata.size > 32 * 1024 * 1024 ||
      realpathSync(inventoryPath) !== inventoryPath
    ) {
      throw new Error("Vitest did not produce a bounded regular JSON inventory.");
    }
    const bytes = readFileSync(inventoryPath);
    const after = lstatSync(inventoryPath);
    if (
      bytes.byteLength !== inventoryMetadata.size ||
      inventoryMetadata.dev !== after.dev ||
      inventoryMetadata.ino !== after.ino ||
      inventoryMetadata.mode !== after.mode ||
      inventoryMetadata.mtimeMs !== after.mtimeMs ||
      inventoryMetadata.ctimeMs !== after.ctimeMs ||
      inventoryMetadata.size !== after.size
    ) {
      throw new Error("Vitest JSON inventory changed while it was read.");
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause: unknown) {
    executionError = cause;
    executionFailed = true;
    containmentUnproven = isVitestWorkloadTerminationUnproven(cause);
    throw cause;
  } finally {
    if (containmentUnproven) {
      throw new AggregateError(
        [
          executionError,
          new Error(
            "Vitest inventory containment is unproven; preserved " +
              `tool directory ${tools.directory} and inventory directory ${inventoryDirectory ?? "[not-created]"}.`,
          ),
        ],
        "Portfolio verification preserved its unproven Vitest inventory state.",
      );
    }
    const cleanupErrors: unknown[] = [];
    try {
      if (inventoryDirectory !== null) {
        rmSync(inventoryDirectory, { force: true, recursive: true });
      }
    } catch (cause: unknown) {
      cleanupErrors.push(cause);
    }
    try {
      tools.dispose();
    } catch (cause: unknown) {
      cleanupErrors.push(cause);
    }
    if (cleanupErrors.length > 0) {
      if (executionFailed) {
        throw new AggregateError(
          [executionError, ...cleanupErrors],
          "Vitest inventory execution and cleanup both failed.",
        );
      }
      if (cleanupErrors.length === 1) throw cleanupErrors[0];
      throw new AggregateError(
        cleanupErrors,
        "Vitest inventory cleanup failed.",
      );
    }
  }
}

async function readWorkflowSources(input: {
  gitExecutable: string;
  headBound: boolean;
  inputs: PortfolioVerificationInputLedger;
  revision: string;
  workspace: string;
}): Promise<Array<{ path: string; source: string }>> {
  if (input.headBound) {
    const paths = runTrustedGit(input.workspace, [
      "ls-tree",
      "-r",
      "--name-only",
      "-z",
      input.revision,
      "--",
      ".github/workflows",
    ], input.gitExecutable)
      .toString("utf8")
      .split("\0")
      .filter((path) => /\.ya?ml$/u.test(path))
      .sort();
    return paths.map((path) => ({
      path,
      source: runTrustedGit(input.workspace, [
        "cat-file",
        "blob",
        `${input.revision}:${path}`,
      ], input.gitExecutable).toString("utf8"),
    }));
  }

  const paths = await input.inputs.snapshotDirectoryFiles(
    ".github/workflows",
    {
      include: (filename) => /\.ya?ml$/u.test(filename),
      label: "GitHub workflow directory",
      maxBytesPerFile: 4 * 1024 * 1024,
    },
  );
  return Promise.all(
    paths.map(async (path) => ({
      path,
      source: await input.inputs.readUtf8(path, {
        label: "GitHub workflow",
        maxBytes: 4 * 1024 * 1024,
      }),
    })),
  );
}

async function verify(): Promise<void> {
  const requestedWorkspace = resolve(process.cwd());
  const workspace = realpathSync(requestedWorkspace);
  if (workspace !== requestedWorkspace) {
    throw new Error("Portfolio workspace must not traverse a symbolic link.");
  }
  const verificationInputs = new PortfolioVerificationInputLedger(workspace);
  assertVitestProcessGroupInventoryCapability(workspace);
  const captureLock = acquireVitestExecutionCaptureLock(workspace);
  let releaseAttempted = false;
  try {
  assertNoOrphanedVitestExecutionStagingFiles(workspace);
  const releaseEvidenceMode = parseReleaseEvidenceModeArguments(
    process.argv.slice(2),
  );
  const githubActions = process.env.GITHUB_ACTIONS === "true";
  const gitExecutable = resolvePortfolioTrustedGitExecutable({
    configuredGitExecutable:
      process.env[portfolioTrustedGitEnvironmentVariable],
    githubActions,
    releaseEvidenceMode,
  });
  const expectedHeadCommit = resolveReleaseEvidenceExpectedHead({
    configuredSha: process.env.PORTFOLIO_EXPECTED_HEAD_SHA,
    githubActions,
    githubSha: process.env.GITHUB_SHA,
    releaseEvidenceMode,
  });
  const workflowRevision = expectedHeadCommit ?? "HEAD";
  const headBoundWorkflows = githubActions || releaseEvidenceMode;
  const initialVitestEvidence = readVitestExecutionEvidence(workspace);
  const vitestEvidenceText = initialVitestEvidence.text;
  const vitestEvidence = initialVitestEvidence.evidence;
  const ledgerVitestEvidenceText = await verificationInputs.readUtf8(
    vitestExecutionEvidencePath,
    {
      label: "Vitest execution evidence",
      maxBytes: VITEST_EXECUTION_EVIDENCE_MAX_BYTES,
    },
  );
  assertEqual(
    ledgerVitestEvidenceText,
    vitestEvidenceText,
    "Vitest execution evidence initial stable read",
  );
  const [
    statusMarkdown,
    reportText,
    liveEvalReadmeText,
    browserEvidenceText,
    workspaceCiWorkflow,
    screenshotManifest,
    workflowSources,
    rootReadme,
    chineseReadme,
    caseStudy,
    architecture,
    packageManifest,
    installBoundarySource,
    gitleaksGuardSource,
    historyAuditText,
    retainedScanManifestText,
  ] = await Promise.all([
    verificationInputs.readUtf8("docs/STATUS.md", {
      label: "Portfolio STATUS",
    }),
    verificationInputs.readUtf8("docs/evals/ai-live-eval-latest.json", {
      label: "Latest live eval report",
    }),
    verificationInputs.readUtf8("docs/evals/README.md", {
      label: "Live eval README",
    }),
    verificationInputs.readUtf8(playwrightEvidencePath, {
      label: "Playwright evidence receipt",
    }),
    verificationInputs.readBytes(requiredCiWorkflowPath, {
      label: "Required CI workflow",
      maxBytes: 4 * 1024 * 1024,
    }),
    verificationInputs.readUtf8(screenshotManifestPath, {
      label: "Screenshot manifest",
    }),
    readWorkflowSources({
      gitExecutable,
      headBound: headBoundWorkflows,
      inputs: verificationInputs,
      revision: workflowRevision,
      workspace,
    }),
    verificationInputs.readUtf8("README.md", {
      label: "English README",
    }),
    verificationInputs.readUtf8("README.zh-CN.md", {
      label: "Chinese README",
    }),
    verificationInputs.readUtf8("docs/FDE_CASE_STUDY.md", {
      label: "FDE case study",
    }),
    verificationInputs.readUtf8("docs/ARCHITECTURE.md", {
      label: "Architecture document",
    }),
    verificationInputs.readUtf8("package.json", {
      label: "Package manifest",
      maxBytes: 2 * 1024 * 1024,
    }),
    verificationInputs.readUtf8(ciInstallBoundaryPath, {
      label: "CI install-boundary guard",
      maxBytes: 64 * 1024,
    }),
    verificationInputs.readUtf8(ciGitleaksGuardPath, {
      label: "CI gitleaks guard",
      maxBytes: 64 * 1024,
    }),
    verificationInputs.readUtf8(developmentHistoryAuditPath, {
      label: "Development-history blocked audit",
      maxBytes: 16 * 1024,
    }),
    verificationInputs.readUtf8(retainedHistorySecretScanManifestContract.path, {
      label: "Retained development-history scan manifest",
      maxBytes: 16 * 1024,
    }),
    verificationInputs.snapshotDirectoryFiles("docs/evals/archive", {
      include: (filename) => filename.endsWith(".json"),
      label: "Live eval archive directory",
    }),
  ]);
  parseDevelopmentHistoryAuditRecord(historyAuditText);
  const retainedScanRawFiles = new Map(await Promise.all(
    retainedHistorySecretScanRawPaths.map(async (path) => [
      path,
      await verificationInputs.readBytes(path, {
        label: "Retained development-history scan raw output",
        maxBytes: 16 * 1024,
      }),
    ] as const),
  ));
  verifyRetainedHistorySecretScan({
    manifestText: retainedScanManifestText,
    rawFiles: retainedScanRawFiles,
  });
  const [dependencyManifestText, dependencyArchiveBytes] = await Promise.all([
    verificationInputs.readUtf8(retainedDependencyLicenseManifestContract.path, {
      label: "Retained development-history dependency manifest", maxBytes: 16 * 1024,
    }),
    verificationInputs.readBytes(retainedDependencyLicenseArchiveContract.path, {
      label: "Retained development-history dependency raw archive", maxBytes: 8 * 1024 * 1024,
    }),
  ]);
  verifyRetainedDependencyLicenses({ manifestText: dependencyManifestText, archiveBytes: dependencyArchiveBytes });
  const parsedScreenshotManifest = parseScreenshotManifest(
    JSON.parse(screenshotManifest) as unknown,
  );
  const screenshotInputs = [...new Set(
    parsedScreenshotManifest.assets.flatMap((asset) => [
      asset.path,
      ...asset.sourceFiles,
    ]),
  )].sort();
  for (const path of screenshotInputs) {
    await verificationInputs.readBytes(path, {
      label: path.endsWith(".jpg")
        ? "Published screenshot asset"
        : "Screenshot source input",
      maxBytes: path.endsWith(".jpg") ? 16 * 1024 * 1024 : undefined,
    });
  }
  await verifyScreenshotManifest(workspace, screenshotManifest);
  const ciWorkflow = resolveCiWorkflowSource({
    headBound: headBoundWorkflows,
    readHeadSource: () =>
      runTrustedGit(workspace, [
        "cat-file",
        "blob",
        `${workflowRevision}:${requiredCiWorkflowPath}`,
      ], gitExecutable),
    workspaceSource: workspaceCiWorkflow,
  });
  assertCanonicalCiPackageScripts(packageManifest);
  assertCiInstallBoundarySource(installBoundarySource);
  assertCiGitleaksGuardSource(gitleaksGuardSource);
  assertRequiredCiGateWorkflow(Buffer.from(ciWorkflow).toString("utf8"));
  assertUniqueRequiredCiGateAcrossWorkflows(workflowSources);
  const snapshot = parseStatusSnapshot(statusMarkdown);
  const browserEvidence = parseCanonicalPlaywrightEvidence(browserEvidenceText);
  for (const runEvidence of browserEvidence.runs) {
    assertPlaywrightObservationSourceLocations(workspace, runEvidence.tests);
  }
  const browserProse = parseCurrentBrowserProse(statusMarkdown);
  const qualityProse = parseCurrentQualityProse(statusMarkdown);
  const releaseProse = parseCurrentReleaseProse(statusMarkdown);
  const evidenceSummaryProse = parseEvidenceSummaryProse(statusMarkdown);
  const vitestInventory = normalizeVitestListJson(
    runVitestListJson(workspace),
    workspace,
  );
  assertQualitySnapshotConsistency(
    snapshot.qualitySnapshot,
    qualityProse,
  );
  assertVitestListInventoryMatchesEvidence(vitestInventory, vitestEvidence);
  const currentVitestSource = captureVitestExecutionRepositoryState(
    workspace,
    gitExecutable,
  );
  const cleanVitestEvidence =
    vitestEvidence.provenance.worktreeState === "clean";
  if (cleanVitestEvidence) {
    runTrustedGit(workspace, [
      "merge-base",
      "--is-ancestor",
      vitestEvidence.provenance.baseHeadCommit,
      currentVitestSource.headCommit,
    ], gitExecutable);
  }
  assertVitestExecutionProvenance({
    ancestryFact: cleanVitestEvidence
      ? {
          ancestorCommit: vitestEvidence.provenance.baseHeadCommit,
          descendantCommit: currentVitestSource.headCommit,
          isAncestor: true,
        }
      : undefined,
    currentRepositoryState: currentVitestSource,
    evidence: vitestEvidence,
    releaseEvidenceMode,
    revisionFingerprintFact: cleanVitestEvidence
      ? {
          revision: vitestEvidence.provenance.baseHeadCommit,
          sourceFingerprint: captureVitestExecutionSourceFingerprintAtRevision(
            workspace,
            vitestEvidence.provenance.baseHeadCommit,
            gitExecutable,
          ),
        }
      : undefined,
  });
  assertBrowserSnapshotConsistency(
    snapshot.browserSnapshot,
    browserProse,
    browserEvidence,
    browserEvidenceText,
  );
  assertReleaseProseConsistency(snapshot, releaseProse);
  assertStatusLiveEvalProseConsistency(snapshot.liveEval, statusMarkdown);
  for (const [documentLabel, markdown] of [
    ["README.md", rootReadme],
    ["README.zh-CN.md", chineseReadme],
    ["FDE case study", caseStudy],
    ["Architecture", architecture],
  ] as const) {
    assertNoConcreteCurrentLiveEvalClaims({ documentLabel, markdown });
  }
  assertEvidenceSummaryProseConsistency(
    snapshot.evidenceSummary,
    evidenceSummaryProse,
  );

  const lineageShas = new Set([
    snapshot.currentPublicRelease.commit,
    snapshot.currentPublicRelease.id,
    snapshot.lastDocumentedRelease.commit,
    snapshot.publicRuntime.version,
    snapshot.repositoryHead.local,
    snapshot.repositoryHead.remote,
  ]);
  for (const sha of lineageShas) {
    runTrustedGit(workspace, ["cat-file", "-e", `${sha}^{commit}`], gitExecutable);
  }
  runTrustedGit(workspace, [
    "cat-file",
    "-e",
    `${browserEvidence.provenance.baseHeadCommit}^{commit}`,
  ], gitExecutable);
  const currentBrowserSource = capturePlaywrightRepositoryState(
    workspace,
    gitExecutable,
  );
  assertEqual(
    currentBrowserSource.sourceFingerprint,
    browserEvidence.provenance.sourceFingerprint,
    "Playwright evaluated-source fingerprint",
  );
  if (browserEvidence.provenance.worktreeState === "clean") {
    const evaluatedCommit = browserEvidence.provenance.evaluatedCommit;
    if (evaluatedCommit === null) {
      throw new Error("Clean Playwright evidence is missing an evaluated commit.");
    }
    assertEqual(
      capturePlaywrightSourceFingerprintAtRevision(
        workspace,
        evaluatedCommit,
        gitExecutable,
      ),
      browserEvidence.provenance.sourceFingerprint,
      "Playwright clean commit/source fingerprint",
    );
  }
  assertReleaseSnapshotConsistency(snapshot);
  runTrustedGit(workspace, [
    "merge-base",
    "--is-ancestor",
    snapshot.lastDocumentedRelease.commit,
    snapshot.currentPublicRelease.commit,
  ], gitExecutable);

  const selection = buildFullIngestSelection(
    portfolioReleaseCountryIso3s,
    buildFixtureLimits(),
  );
  const evidenceSummary = {
    approvedRealCertifications: getApprovedRealCertificationIds().length,
    approvedRealProducts: getApprovedRealProductIds().length,
    jurisdictions: selection.jurisdictionIds.size,
    limits: selection.limitRows.length,
    regulations: selection.regulationIds.size,
    sources: selection.sourceIds.size,
  };
  assertEvidenceSummaryConsistency(evidenceSummary, snapshot.evidenceSummary);
  assertEvidenceSummaryConsistency(evidenceSummary, portfolioPublicationSummary);

  assertLiveEvalReadmeCurrentReport({
    readmeText: liveEvalReadmeText,
    reportText,
  });
  const verifyPublishedReleaseEvidence = () =>
    verifyReleaseEvidenceReadiness({
        bindVitestExecutionInputs: true,
        expectedHeadCommit,
        explicitPaths: [
          ...portfolioReleaseEvidenceExplicitPaths,
          vitestExecutionEvidencePath,
          ciInstallBoundaryPath,
          ciGitleaksGuardPath,
          ...vitestInventory.sourcePaths,
          ...workflowSources.map(({ path }) => path),
        ],
        liveEvalLatestPath: "docs/evals/ai-live-eval-latest.json",
        playwrightEvidencePath,
        screenshotManifestPath,
        workspace,
      });
  const releaseEvidence = releaseEvidenceMode
      ? verifyPublishedReleaseEvidence()
    : null;
  if (releaseEvidence !== null) {
    const evaluatedCommit = browserEvidence.provenance.evaluatedCommit;
    if (
      browserEvidence.provenance.worktreeState !== "clean" ||
      evaluatedCommit === null
    ) {
      throw new Error(
        "Release-grade Playwright evidence must have clean exact-commit provenance.",
      );
    }
    runTrustedGit(workspace, [
      "merge-base",
      "--is-ancestor",
      evaluatedCommit,
      releaseEvidence.headCommit,
    ], gitExecutable);
    const vitestEvaluatedCommit = vitestEvidence.provenance.evaluatedCommit;
    if (
      vitestEvidence.provenance.worktreeState !== "clean" ||
      vitestEvaluatedCommit === null
    ) {
      throw new Error(
        "Release-grade Vitest evidence must have clean exact-commit provenance.",
      );
    }
    runTrustedGit(workspace, [
      "merge-base",
      "--is-ancestor",
      vitestEvaluatedCommit,
      releaseEvidence.headCommit,
    ], gitExecutable);
  }
  const liveEval = await verifyLiveEvalEvidence({
    releaseHeadCommit: releaseEvidence?.headCommit,
    reportText,
    snapshot: snapshot.liveEval,
    workspace,
  });
  const completedReleaseEvidence = releaseEvidenceMode
    ? verifyPublishedReleaseEvidence()
    : null;
  assertEqual(
    completedReleaseEvidence,
    releaseEvidence,
    "Release evidence state across asynchronous verification",
  );
  assertEqual(
    captureVitestExecutionRepositoryState(workspace, gitExecutable),
    currentVitestSource,
    "Vitest source state across portfolio verification",
  );
  assertEqual(
    readVitestExecutionEvidence(workspace).text,
    vitestEvidenceText,
    "Vitest execution evidence across portfolio verification",
  );
  assertNoOrphanedVitestExecutionStagingFiles(workspace);
  await verificationInputs.assertUnchanged();
  const vitestProvenanceSummary =
    vitestEvidence.provenance.worktreeState === "dirty"
      ? "dirty source provenance; evaluatedCommit=null; local-only, not release-grade"
      : `clean source provenance; evaluatedCommit=${vitestEvidence.provenance.evaluatedCommit}`;

  releaseAttempted = true;
  captureLock.release();

  process.stdout.write(
    `Portfolio summary consistency verified: historical operator-recorded public observation ${snapshot.publicRuntime.version} is internally consistent with the recorded repository head (not externally authenticated); ` +
      `last fully documented release ${snapshot.lastDocumentedRelease.id}/${snapshot.lastDocumentedRelease.commit}; ` +
      `${vitestEvidence.totals.collectedFiles} Vitest files / ` +
      `${vitestEvidence.totals.collectedTests} collected tests; ` +
      `execution ${vitestEvidence.runId} completed ${vitestEvidence.completedAt}: ` +
      `${vitestEvidence.totals.passedTests} passed / ` +
      `${vitestEvidence.totals.skippedTests} skipped / ` +
      `${vitestEvidence.totals.todoTests} todo ` +
      `(${vitestProvenanceSummary}); ` +
      `${browserEvidence.totals.passed} Playwright passes / ` +
      `${browserEvidence.totals.skipped} skipped across ` +
      `${browserEvidence.runs.length} evidence runs; ` +
      `${evidenceSummary.jurisdictions} jurisdictions / ${evidenceSummary.regulations} regulations / ` +
      `${evidenceSummary.limits} limits / ${evidenceSummary.sources} sources; ` +
      `${liveEval.sampleCount}/${liveEval.suiteCaseCount} live eval cases ` +
      `(${liveEval.thresholdsPassed ? "thresholds passed" : "valid report; live eval failed"}); ` +
      `${completedReleaseEvidence === null
        ? "release-evidence commit inclusion not requested"
        : `${completedReleaseEvidence.paths.length} release-evidence paths bound to ${completedReleaseEvidence.headCommit}`}.\n`,
  );

  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput !== undefined) {
    if (githubOutput.trim().length === 0) {
      throw new Error("GITHUB_OUTPUT must name the current step output file.");
    }
    await appendFile(githubOutput, "verified=true\n", "utf8");
  }
  } catch (cause: unknown) {
    if (isVitestWorkloadTerminationUnproven(cause)) {
      let ownershipError: unknown;
      try {
        captureLock.assertOwned();
      } catch (ownershipCause: unknown) {
        ownershipError = ownershipCause;
      }
      throw new AggregateError(
        [
          cause,
          ...(ownershipError === undefined ? [] : [ownershipError]),
          new Error(
            ownershipError === undefined
              ? `The Vitest capture lock ${captureLock.path} and guard link ${captureLock.guardPath} were verified and preserved because inventory workload termination is unproven.`
              : "Inventory workload termination is unproven and lock " +
                `preservation could not be verified; lock=${captureLock.path}; guard=${captureLock.guardPath}.`,
          ),
        ],
        "Portfolio verification halted without releasing its Vitest containment state.",
      );
    }
    if (releaseAttempted) throw cause;
    releaseAttempted = true;
    try {
      captureLock.release();
    } catch (releaseCause: unknown) {
      throw new AggregateError(
        [cause, releaseCause],
        "Portfolio verification and Vitest capture-lock release both failed.",
      );
    }
    throw cause;
  }
}

void verify().catch((error: unknown) => {
  process.stderr.write(formatErrorTree(error, "portfolio-verify"));
  process.exitCode = 1;
});
