import { randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import { formatErrorTree } from "../format-error";
import { persistAtomicTextFile } from "./atomic-text-file";
import {
  EXPECTED_PNPM_VERSION,
  createVitestExecutionToolBin,
  type VitestExecutionToolBin,
} from "./capture-vitest-execution-evidence";
import {
  assertPlaywrightObservationSourceLocations,
  assertPlaywrightWorkspacePackageManagerConfigurationAbsent,
  buildPlaywrightEvidenceCaptureEnvironment,
  buildPlaywrightEvidence,
  parseCanonicalPlaywrightRunReceipt,
  playwrightEvidencePath,
  playwrightRunContracts,
  serializeCanonicalPlaywrightEvidence,
  sha256Text,
  type PlaywrightRunId,
  type PlaywrightRunReceipt,
} from "./playwright-evidence";
import {
  acquirePlaywrightEvidenceCaptureLock,
  type PlaywrightEvidenceCaptureLock,
} from "./playwright-evidence-capture-lock";
import { playwrightFailureDiagnosticPath } from "./playwright-failure-diagnostic";
import {
  assertPnpmInstallationStateUnchanged,
  capturePnpmInstallationState,
  pnpmStoreDirConfigArgument,
  type PnpmInstallationState,
} from "./pnpm-installation-state";

export type PlaywrightEvidenceExecutionContext = Readonly<{
  dispose: () => void;
  environment: Readonly<Record<string, string>>;
  nodeExecutable: string;
  pnpmEntrypoint: string;
  toolDirectory: string;
}>;

const commandScripts: Readonly<Record<PlaywrightRunId, string>> = {
  demo: "test:e2e:demo",
  fde: "test:e2e:fde",
  "production-csp": "test:e2e:csp:production",
  public: "test:e2e",
};

export const PLAYWRIGHT_PNPM_RUN_FLAGS = [
  "--config.node-experimental-package-map=false",
  "--config.offline=true",
  "--config.verify-deps-before-run=false",
] as const;

export function buildPlaywrightPnpmRunArguments(
  pnpmEntrypoint: string,
  script: string,
  installationState: Pick<PnpmInstallationState, "storeDirConfigValue">,
): string[] {
  return [
    pnpmEntrypoint,
    pnpmStoreDirConfigArgument(installationState),
    ...PLAYWRIGHT_PNPM_RUN_FLAGS,
    script,
  ];
}

export function createPlaywrightEvidenceExecutionContext(
  inheritedEnvironment: Readonly<Record<string, string | undefined>> =
    process.env,
): PlaywrightEvidenceExecutionContext {
  let tools: VitestExecutionToolBin;
  try {
    tools = createVitestExecutionToolBin(inheritedEnvironment, {
      // os.tmpdir() is environment-sensitive. Resolve the conventional Unix
      // root once instead of allowing inherited TMPDIR/TMP/TEMP to select the
      // executable/tool boundary.
      temporaryRoot: realpathSync("/tmp"),
    });
  } catch (cause: unknown) {
    throw new Error(
      `Playwright evidence requires verified pnpm ${EXPECTED_PNPM_VERSION} from PATH.`,
      { cause },
    );
  }
  try {
    const privateTemporaryDirectory = resolve(tools.directory, ".tmp");
    const privateConfigurationDirectory = resolve(tools.directory, ".config");
    const privateUserConfig = resolve(tools.directory, ".npmrc-user");
    const privateGlobalConfig = resolve(tools.directory, ".npmrc-global");
    mkdirSync(privateTemporaryDirectory, { mode: 0o700 });
    chmodSync(privateTemporaryDirectory, 0o700);
    mkdirSync(privateConfigurationDirectory, { mode: 0o700 });
    chmodSync(privateConfigurationDirectory, 0o700);
    writeFileSync(privateUserConfig, "", { flag: "wx", mode: 0o600 });
    chmodSync(privateUserConfig, 0o600);
    writeFileSync(privateGlobalConfig, "", { flag: "wx", mode: 0o600 });
    chmodSync(privateGlobalConfig, 0o600);
    return {
      dispose: tools.dispose,
      environment: buildPlaywrightEvidenceCaptureEnvironment({
        toolDirectory: tools.directory,
      }),
      nodeExecutable: tools.nodeExecutable,
      pnpmEntrypoint: tools.pnpmEntrypoint,
      toolDirectory: tools.directory,
    };
  } catch (cause: unknown) {
    try {
      tools.dispose();
    } catch (cleanupCause: unknown) {
      throw new AggregateError(
        [cause, cleanupCause],
        "Playwright evidence execution setup and cleanup both failed.",
      );
    }
    throw cause;
  }
}

type PlaywrightEvidenceCaptureBoundary = Readonly<{
  installationState: PnpmInstallationState;
  lock: Pick<PlaywrightEvidenceCaptureLock, "assertOwned">;
  workspace: string;
}>;

function assertPlaywrightEvidenceCaptureBoundary(
  boundary: PlaywrightEvidenceCaptureBoundary,
): void {
  boundary.lock.assertOwned();
  assertPlaywrightWorkspacePackageManagerConfigurationAbsent(
    boundary.workspace,
  );
  assertPnpmInstallationStateUnchanged(
    boundary.installationState,
    capturePnpmInstallationState(boundary.workspace),
    "Playwright pnpm installation state",
  );
}

export async function withPlaywrightEvidenceCaptureBoundary<T>(input: Readonly<{
  boundary: PlaywrightEvidenceCaptureBoundary;
  label: string;
  operation: () => Promise<T> | T;
}>): Promise<T> {
  assertPlaywrightEvidenceCaptureBoundary(input.boundary);
  let outcome:
    | Readonly<{ status: "failed"; cause: unknown }>
    | Readonly<{ status: "passed"; value: T }>;
  try {
    outcome = { status: "passed", value: await input.operation() };
  } catch (cause: unknown) {
    outcome = { cause, status: "failed" };
  }
  try {
    assertPlaywrightEvidenceCaptureBoundary(input.boundary);
  } catch (boundaryCause: unknown) {
    if (outcome.status === "failed") {
      throw new AggregateError(
        [outcome.cause, boundaryCause],
        `${input.label} and its capture-boundary readback both failed.`,
      );
    }
    throw boundaryCause;
  }
  if (outcome.status === "failed") throw outcome.cause;
  return outcome.value;
}

function runPnpm(
  script: string,
  execution: PlaywrightEvidenceExecutionContext,
  boundary: PlaywrightEvidenceCaptureBoundary,
): number {
  const result = spawnSync(
    execution.nodeExecutable,
    buildPlaywrightPnpmRunArguments(
      execution.pnpmEntrypoint,
      script,
      boundary.installationState,
    ),
    {
      cwd: boundary.workspace,
      // The builder returns an exact string-only allowlist. Convert only at
      // the Node spawn boundary; NODE_ENV deliberately remains absent so each
      // canonical Next/Playwright command selects its normal mode.
      env: { ...execution.environment } as NodeJS.ProcessEnv,
      shell: false,
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  if (result.signal) {
    throw new Error(`pnpm ${script} was terminated by ${result.signal}.`);
  }
  if (result.status === null) {
    throw new Error(`pnpm ${script} returned no exit status.`);
  }
  return result.status;
}

async function captureRun(
  id: PlaywrightRunId,
  execution: PlaywrightEvidenceExecutionContext,
  boundary: PlaywrightEvidenceCaptureBoundary,
): Promise<PlaywrightRunReceipt> {
  const contract = playwrightRunContracts.find((candidate) => candidate.id === id);
  if (!contract) throw new Error(`Unknown Playwright run contract: ${id}`);
  return withPlaywrightEvidenceCaptureBoundary({
    boundary,
    label: `${id} Playwright evidence run`,
    operation: async () => {
      const receiptPath = resolve(boundary.workspace, contract.receiptPath);
      await rm(receiptPath, { force: true });
      const diagnosticPath = playwrightFailureDiagnosticPath(id);
      await rm(resolve(boundary.workspace, diagnosticPath), { force: true });
      const exitCode = runPnpm(
        commandScripts[id],
        execution,
        boundary,
      );
      if (exitCode !== 0) {
        throw new Error(
          `${id} failed with exit ${exitCode}. Reporter diagnostics, if persistence succeeded: ${diagnosticPath}; not release evidence.`,
        );
      }
      let receiptText: string;
      try {
        receiptText = await readFile(receiptPath, "utf8");
      } catch (cause: unknown) {
        throw new Error(`${id} did not produce its Playwright evidence receipt.`, {
          cause,
        });
      }
      const receipt = parseCanonicalPlaywrightRunReceipt(receiptText);
      assertPlaywrightObservationSourceLocations(
        boundary.workspace,
        receipt.tests,
      );
      if (receipt.exitCode !== exitCode) {
        throw new Error(`${id} receipt/runner exit status drifted.`);
      }
      if (exitCode !== 0 || !receipt.complete) {
        throw new Error(`${id} did not complete with passing evidence.`);
      }
      return receipt;
    },
  });
}

async function persistEvidence(
  receipts: readonly PlaywrightRunReceipt[],
  workspace: string,
) {
  const evidence = buildPlaywrightEvidence(receipts, randomUUID());
  const serialized = serializeCanonicalPlaywrightEvidence(evidence);
  const outputPath = resolve(workspace, playwrightEvidencePath);
  await persistAtomicTextFile({
    combinedFailureMessage:
      "Playwright evidence persistence and cleanup failed.",
    contents: serialized,
    outputPath,
  });
  process.stdout.write(
    `Captured ${evidence.totals.collected} Playwright results in ${playwrightEvidencePath}; ` +
      `sha256=${sha256Text(serialized)}; runId=${evidence.runId}; ` +
      `source=${evidence.provenance.sourceFingerprint.fileCount} files/` +
      `${evidence.provenance.sourceFingerprint.digest}.\n`,
  );
}

type PlaywrightEvidenceCaptureFailure =
  | Readonly<{ failed: false }>
  | Readonly<{ cause: unknown; failed: true }>;

export function releasePlaywrightEvidenceCaptureResources(input: Readonly<{
  execution?: Pick<PlaywrightEvidenceExecutionContext, "dispose">;
  failure: PlaywrightEvidenceCaptureFailure;
  lock: Pick<
    PlaywrightEvidenceCaptureLock,
    "assertOwned" | "release"
  >;
}>): void {
  const errors: unknown[] = input.failure.failed ? [input.failure.cause] : [];
  if (input.execution !== undefined) {
    try {
      input.execution.dispose();
    } catch (cause: unknown) {
      errors.push(cause);
    }
  }
  try {
    input.lock.assertOwned();
    input.lock.release();
  } catch (cause: unknown) {
    errors.push(cause);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(
      errors,
      "Playwright evidence capture and resource release reported multiple failures.",
    );
  }
}

async function main(): Promise<void> {
  const workspace = realpathSync(resolve(process.cwd()));
  const lock = acquirePlaywrightEvidenceCaptureLock(workspace);
  let execution: PlaywrightEvidenceExecutionContext | undefined;
  let failure: PlaywrightEvidenceCaptureFailure = { failed: false };
  try {
    assertPlaywrightWorkspacePackageManagerConfigurationAbsent(workspace);
    const installationState = capturePnpmInstallationState(workspace);
    const boundary = { installationState, lock, workspace };
    assertPlaywrightEvidenceCaptureBoundary(boundary);
    execution = createPlaywrightEvidenceExecutionContext();
    const activeExecution = execution;
    assertPlaywrightEvidenceCaptureBoundary(boundary);
    const receipts: PlaywrightRunReceipt[] = [];
    receipts.push(await captureRun("public", activeExecution, boundary));
    receipts.push(await captureRun("demo", activeExecution, boundary));
    receipts.push(await captureRun("fde", activeExecution, boundary));
    const buildExitCode = await withPlaywrightEvidenceCaptureBoundary({
      boundary,
      label: "production Playwright evidence build",
      operation: () => runPnpm("build", activeExecution, boundary),
    });
    if (buildExitCode !== 0) {
      throw new Error("Production build failed before the CSP evidence run.");
    }
    receipts.push(
      await captureRun("production-csp", activeExecution, boundary),
    );
    await withPlaywrightEvidenceCaptureBoundary({
      boundary,
      label: "Playwright evidence persistence",
      operation: () => persistEvidence(receipts, workspace),
    });
  } catch (cause: unknown) {
    failure = { cause, failed: true };
  }
  releasePlaywrightEvidenceCaptureResources({ execution, failure, lock });
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(resolve(invokedPath)).href
) {
  void main().catch((error: unknown) => {
    process.stderr.write(
      "Playwright evidence capture failed closed.\n" +
        formatErrorTree(error, "playwright-evidence-capture"),
    );
    process.exitCode = 1;
  });
}
