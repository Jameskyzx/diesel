import { resolve } from "node:path";

import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
} from "@playwright/test/reporter";
import { z } from "zod";

import { formatErrorTree } from "../format-error";
import { persistAtomicTextFile } from "./atomic-text-file";
import {
  buildPlaywrightRunReceipt,
  capturePlaywrightRepositoryState,
  playwrightRunContracts,
  playwrightTestObservationSchema,
  serializeCanonicalPlaywrightRunReceipt,
  toRepositoryRelativePath,
  type PlaywrightRepositoryState,
  type PlaywrightRunId,
} from "./playwright-evidence";
import {
  buildPlaywrightFailureDiagnostic,
  playwrightFailureDiagnosticPath,
  serializeCanonicalPlaywrightFailureDiagnostic,
  type PlaywrightFailureObservation,
} from "./playwright-failure-diagnostic";

const reporterOptionsSchema = z.object({
  id: z.enum(
    playwrightRunContracts.map(({ id }) => id) as [
      PlaywrightRunId,
      ...PlaywrightRunId[],
    ],
  ),
});

type ReporterState = {
  config: FullConfig;
  repository: PlaywrightRepositoryState;
  startedAt: string;
  suite: Suite;
};

function toObservation(
  workspace: string,
  test: TestCase,
): PlaywrightFailureObservation {
  const project = test.parent.project()?.name;
  if (!project) {
    throw new Error("A Playwright test was not associated with a project.");
  }
  return {
    attempts: test.results.length,
    expectedStatus: test.expectedStatus,
    file: toRepositoryRelativePath(workspace, test.location.file),
    // Dependency-blocked tests have no result. They are not declared skips.
    finalStatus: test.results.at(-1)?.status ?? null,
    id: test.id,
    line: test.location.line,
    outcome: test.outcome(),
    project,
    retryCount: test.results.reduce(
      (maximum, result) => Math.max(maximum, result.retry),
      0,
    ),
  };
}

export default class PortfolioPlaywrightRunReporter implements Reporter {
  private readonly active: boolean;
  private readonly id: PlaywrightRunId;
  private globalErrorCount = 0;
  private state: ReporterState | null = null;

  constructor(options: unknown) {
    this.id = reporterOptionsSchema.parse(options).id;
    this.active = process.env.DIESEL_PLAYWRIGHT_EVIDENCE_CAPTURE === "1";
  }

  onBegin(config: FullConfig, suite: Suite): void {
    if (!this.active) return;
    const workspace = process.cwd();
    const contract = playwrightRunContracts.find(({ id }) => id === this.id);
    if (!contract) throw new Error(`Unknown Playwright evidence suite: ${this.id}`);
    if (!config.configFile) {
      throw new Error("Playwright evidence requires an explicit config file.");
    }
    const configPath = toRepositoryRelativePath(workspace, config.configFile);
    if (configPath !== contract.configPath) {
      throw new Error(
        `Playwright evidence expected ${contract.configPath}, received ${configPath}.`,
      );
    }
    const cliArguments = config.argv.slice(2);
    if (JSON.stringify(cliArguments) !== JSON.stringify(contract.cliArguments)) {
      throw new Error(
        `Playwright evidence requires the canonical ${contract.command} invocation.`,
      );
    }
    const projectNames = config.projects.map(({ name }) => name);
    if (JSON.stringify(projectNames) !== JSON.stringify(contract.projects)) {
      throw new Error(
        `Playwright evidence requires the complete ${this.id} project matrix.`,
      );
    }
    this.state = {
      config,
      repository: capturePlaywrightRepositoryState(workspace),
      startedAt: new Date().toISOString(),
      suite,
    };
  }

  onError(): void {
    this.globalErrorCount += 1;
  }

  async onEnd(result: FullResult): Promise<{ status?: FullResult["status"] }> {
    if (!this.active) return { status: result.status };
    const state = this.state;
    if (!state) {
      process.stderr.write(
        "Playwright evidence reporter did not initialize; failing the run.\n",
      );
      return { status: "failed" };
    }
    const workspace = process.cwd();
    const contract = playwrightRunContracts.find(({ id }) => id === this.id);
    if (!contract) return { status: "failed" };

    const completedAt = new Date().toISOString();
    let completed: PlaywrightRepositoryState | null = null;
    let stage: "run" | "receipt-validation" | "receipt-persistence" = "run";
    let failurePersistenceAttempted = false;
    const persistFailure = async () => {
      failurePersistenceAttempted = true;
      const diagnostic = buildPlaywrightFailureDiagnostic({
        completedAt,
        globalErrorCount: this.globalErrorCount,
        id: this.id,
        provenance: { completed, started: state.repository },
        runStatus: result.status,
        stage,
        startedAt: state.startedAt,
        tests: state.suite.allTests().map((test) => toObservation(workspace, test)),
      });
      const diagnosticPath = playwrightFailureDiagnosticPath(this.id);
      await persistAtomicTextFile({
        combinedFailureMessage:
          "Playwright failure diagnostic persistence and cleanup failed.",
        contents: serializeCanonicalPlaywrightFailureDiagnostic(diagnostic),
        outputPath: resolve(workspace, diagnosticPath),
      });
      process.stderr.write(
        `Playwright failure diagnostics retained at ${diagnosticPath}; not release evidence.\n`,
      );
    };

    try {
      completed = capturePlaywrightRepositoryState(workspace);
      if (result.status !== "passed" || this.globalErrorCount > 0) {
        await persistFailure();
        return { status: "failed" };
      }
      stage = "receipt-validation";
      const receipt = buildPlaywrightRunReceipt({
        completedAt,
        globalErrorCount: this.globalErrorCount,
        id: this.id,
        playwrightVersion: state.config.version,
        provenance: {
          completed,
          started: state.repository,
        },
        runStatus: result.status,
        startedAt: state.startedAt,
        tests: state.suite.allTests().map((test) =>
          playwrightTestObservationSchema.parse(toObservation(workspace, test))
        ),
      });
      if (!receipt.complete) {
        await persistFailure();
        return { status: "failed" };
      }
      stage = "receipt-persistence";
      const outputPath = resolve(workspace, contract.receiptPath);
      await persistAtomicTextFile({
        combinedFailureMessage:
          "Playwright receipt persistence and cleanup failed.",
        contents: serializeCanonicalPlaywrightRunReceipt(receipt),
        outputPath,
      });
      return { status: result.status };
    } catch (error: unknown) {
      process.stderr.write(
        `Playwright evidence reporter failed closed for suite ${this.id}.\n` +
          formatErrorTree(error, "playwright-evidence-reporter"),
      );
      if (!failurePersistenceAttempted) {
        try {
          await persistFailure();
        } catch (diagnosticError: unknown) {
          process.stderr.write(
            "Playwright failure diagnostics could not be persisted.\n" +
              formatErrorTree(diagnosticError, "playwright-failure-diagnostic"),
          );
        }
      }
      return { status: "failed" };
    }
  }
}
