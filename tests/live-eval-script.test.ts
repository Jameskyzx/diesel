import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import {
  salesChatLiveCases,
  SALES_CHAT_LIVE_EVAL_VERSION,
} from "../evals/sales-chat-live-cases";
import {
  captureLiveEvalRepositoryState,
  captureLiveEvalSourceFingerprint,
  formatLiveEvalArchiveFilename,
} from "../scripts/ai/live-eval-report";
import {
  LIVE_EVAL_OBSERVATIONS_VERSION,
  serializeLiveEvalObservations,
} from "../scripts/ai/live-eval-observations";
import { liveEvalReportSchema } from "../scripts/portfolio/live-eval-report-schema";
import { parseStatusSnapshot } from "../scripts/portfolio/status-snapshot";
import {
  LIVE_EVAL_CASE_TIMEOUT_MS,
  LIVE_EVAL_CASE_TOKEN_RESERVE,
  LIVE_EVAL_MAX_CASES,
  LIVE_EVAL_MAX_OUTPUT_TOKENS_PER_CALL,
  LIVE_EVAL_MAX_RETRIES_PER_MODEL_CALL,
  LIVE_EVAL_MAX_TOKENS,
  LIVE_EVAL_THRESHOLDS,
  LIVE_EVAL_TOKEN_BUDGET_ENFORCEMENT,
} from "../src/domain/ai/live-eval";
import {
  MAX_AI_TOOL_STEPS,
  SALES_CHAT_SYSTEM_PROMPT_VERSION,
} from "../src/features/ai/constants";
import {
  buildSyntheticLiveEvalFailureReport,
  buildSyntheticLiveEvalReport,
  SYNTHETIC_LIVE_EVAL_RUNTIME_CONTEXT,
} from "./helpers/live-eval-report-fixture";

type ReportReceiptFixture = {
  byteLength: number;
  evaluatedAt: string;
  runId: string;
  sha256: string;
};
type ObservationsEnvelopeFixture = {
  receipt: {
    byteLength: number;
    caseCount: number;
    evaluatedAt: string;
    runId: string;
    sha256: string;
    version: "sales-chat-live-observations-v2";
  };
  reportText: string;
};

function buildOpaqueObservations(
  report: { evaluatedAt: string; runId: string },
): ObservationsEnvelopeFixture {
  const reportText = "{}\n";
  return {
    receipt: {
      byteLength: Buffer.byteLength(reportText),
      caseCount: 18,
      evaluatedAt: report.evaluatedAt,
      runId: report.runId,
      sha256: createHash("sha256").update(reportText).digest("hex"),
      version: "sales-chat-live-observations-v2",
    },
    reportText,
  };
}

function buildStateObservationEnvelope(
  report: { evaluatedAt: string; runId: string },
  state: {
    boundaryRejections: Array<"tool_error">;
    streamCompleted: boolean;
    streamErrorObserved: boolean;
  },
): ObservationsEnvelopeFixture {
  const serialized = serializeLiveEvalObservations({
    cases: salesChatLiveCases.map(({ id }, index) => ({
      runtimeContext: SYNTHETIC_LIVE_EVAL_RUNTIME_CONTEXT,
      aggregateUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      attemptCount: 1,
      boundaryRejections: index === 0 ? state.boundaryRejections : [],
      completedCount: 1,
      id,
      latencyMs: 25,
      responseText: "evidence response",
      steps: [],
      streamCompleted: index === 0 ? state.streamCompleted : true,
      streamErrorObserved: index === 0 ? state.streamErrorObserved : false,
    })),
    evaluatedAt: report.evaluatedAt,
    runId: report.runId,
    version: LIVE_EVAL_OBSERVATIONS_VERSION,
  });
  return { receipt: serialized.receipt, reportText: serialized.reportText };
}

function runBootstrapProcess(
  bootstrapPath: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  safetyTimeoutMs = 10_000,
): Promise<{
  code: number | null;
  safetyTimedOut: boolean;
  signal: NodeJS.Signals | null;
  stderr: string;
  stdout: string;
}> {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(process.execPath, [bootstrapPath], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let stdout = "";
    let safetyTimedOut = false;
    const safetyTimeout = setTimeout(() => {
      safetyTimedOut = true;
      child.kill("SIGKILL");
    }, safetyTimeoutMs);
    child.stderr.setEncoding("utf8");
    child.stdout.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(safetyTimeout);
      rejectProcess(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(safetyTimeout);
      resolveProcess({ code, safetyTimedOut, signal, stderr, stdout });
    });
  });
}

async function writeBootstrapWithDeadlines(
  workspace: string,
  destination: string,
  deadlines: {
    initialization?: number;
    consistencyVerification?: number;
    receiptVerification?: number;
    reportExit?: number;
    run?: number;
    sigkill?: number;
    sigterm?: number;
  },
  verifierPath = resolve(
    workspace,
    "scripts/ai/live-eval-receipt-verifier.ts",
  ),
): Promise<void> {
  let source = await readFile(
    resolve(workspace, "scripts/ai/live-eval-bootstrap.mjs"),
    "utf8",
  );
  const replaceExactlyOnce = (before: string, after: string) => {
    expect(source.split(before)).toHaveLength(2);
    source = source.replace(before, after);
  };
  replaceExactlyOnce(
    "const INITIALIZATION_DEADLINE_MS = 60_000;",
    `const INITIALIZATION_DEADLINE_MS = ${deadlines.initialization ?? 3_000};`,
  );
  replaceExactlyOnce(
    "const RUN_DEADLINE_MS =\n  LIVE_EVAL_CASE_COUNT * LIVE_EVAL_CASE_TIMEOUT_MS + 120_000;",
    `const RUN_DEADLINE_MS = ${deadlines.run ?? 500};`,
  );
  replaceExactlyOnce(
    "const REPORT_CONSISTENCY_VERIFICATION_DEADLINE_MS = 5_000;",
    `const REPORT_CONSISTENCY_VERIFICATION_DEADLINE_MS = ${deadlines.consistencyVerification ?? 4_000};`,
  );
  replaceExactlyOnce(
    "const RECEIPT_VERIFICATION_DEADLINE_MS = 10_000;",
    `const RECEIPT_VERIFICATION_DEADLINE_MS = ${deadlines.receiptVerification ?? 5_000};`,
  );
  replaceExactlyOnce(
    "const REPORT_EXIT_GRACE_MS = 5_000;",
    `const REPORT_EXIT_GRACE_MS = ${deadlines.reportExit ?? 300};`,
  );
  replaceExactlyOnce(
    "const SIGTERM_GRACE_MS = 2_000;",
    `const SIGTERM_GRACE_MS = ${deadlines.sigterm ?? 100};`,
  );
  replaceExactlyOnce(
    "const SIGKILL_SETTLE_MS = 2_000;",
    `const SIGKILL_SETTLE_MS = ${deadlines.sigkill ?? 100};`,
  );
  replaceExactlyOnce(
    `const REPORT_CONSISTENCY_VERIFIER_URL = new URL(
  "./live-eval-receipt-verifier.ts",
  import.meta.url
);`,
    `const REPORT_CONSISTENCY_VERIFIER_URL = new URL(${JSON.stringify(
      pathToFileURL(
        verifierPath,
      ).href,
    )});`,
  );
  replaceExactlyOnce(
    'new URL("../../tsconfig.json", REPORT_CONSISTENCY_VERIFIER_URL)',
    `new URL(${JSON.stringify(
      pathToFileURL(resolve(workspace, "tsconfig.json")).href,
    )})`,
  );
  await writeFile(destination, source, "utf8");
}

async function writeReceiptFixture(
  workspace: string,
  report: { evaluatedAt: string; runId: string },
  reportText = `${JSON.stringify(report, null, 2)}\n`,
) {
  const evaluatedAt = String(report.evaluatedAt);
  const runId = String(report.runId);
  const archiveDirectory = resolve(workspace, "docs/evals/archive");
  const latestPath = resolve(workspace, "docs/evals/ai-live-eval-latest.json");
  const archivePath = resolve(
    archiveDirectory,
    formatLiveEvalArchiveFilename(evaluatedAt, runId),
  );
  await mkdir(archiveDirectory, { recursive: true });
  await Promise.all([
    writeFile(archivePath, reportText, "utf8"),
    writeFile(latestPath, reportText, "utf8"),
  ]);
  return {
    byteLength: Buffer.byteLength(reportText, "utf8"),
    evaluatedAt,
    runId,
    sha256: createHash("sha256").update(reportText, "utf8").digest("hex"),
  } satisfies ReportReceiptFixture;
}

async function buildFailureReceiptReport(
  repositoryWorkspace: string,
  runId: string,
) {
  const [sourceFingerprint, repository] = await Promise.all([
    captureLiveEvalSourceFingerprint(repositoryWorkspace),
    Promise.resolve(captureLiveEvalRepositoryState(repositoryWorkspace)),
  ]);
  if (
    sourceFingerprint.status !== "captured" ||
    repository.worktreeState === "unavailable"
  ) {
    throw new Error("Failure receipt fixture requires stable Git provenance.");
  }
  const report = buildSyntheticLiveEvalFailureReport({
    commit: repository.baseHeadCommit,
    fingerprintDigest: sourceFingerprint.digest,
    fingerprintFileCount: sourceFingerprint.fileCount,
    runId,
  });
  report.provenance.repository = repository;
  report.evaluatedAt = "2026-09-02T22:00:00.000Z";
  return report;
}

async function buildPassingReceiptReport(
  repositoryWorkspace: string,
  runId: string,
) {
  const [sourceFingerprint, repository] = await Promise.all([
    captureLiveEvalSourceFingerprint(repositoryWorkspace),
    Promise.resolve(captureLiveEvalRepositoryState(repositoryWorkspace)),
  ]);
  if (
    sourceFingerprint.status !== "captured" ||
    repository.worktreeState === "unavailable"
  ) {
    throw new Error("Passing receipt fixture requires stable Git provenance.");
  }
  const report = buildSyntheticLiveEvalReport({
    commit: repository.baseHeadCommit,
    fingerprintDigest: sourceFingerprint.digest,
    fingerprintFileCount: sourceFingerprint.fileCount,
    runId,
  });
  report.provenance.repository = repository;
  const status = parseStatusSnapshot(
    await readFile(resolve(repositoryWorkspace, "docs/STATUS.md"), "utf8"),
  );
  report.modelId = status.liveEval.expectedModelId;
  report.provenance.providerProfile =
    status.liveEval.expectedProviderProfile;
  return report;
}

function buildReceiptChildSource(input: {
  exitAfterAcknowledgment: boolean;
  observations?: unknown;
  receipt: ReportReceiptFixture;
  sendProviderBoundary: boolean;
}) {
  const receiptLiteral = JSON.stringify(input.receipt);
  const observationsLiteral = JSON.stringify(input.observations ?? null);
  return `
    import { writeFileSync } from "node:fs";
    import { resolve } from "node:path";

    if (typeof process.send !== "function") {
      throw new Error("Missing IPC channel.");
    }
    const providerMessageId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const reportMessageId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const receipt = ${receiptLiteral};
    let reportSent = false;
    const sendReport = () => {
      if (reportSent) return;
      reportSent = true;
      process.send({
        messageId: reportMessageId,
        observations: ${observationsLiteral},
        protocolVersion: 2,
        reportReceipt: receipt,
        type: "report_persisted",
      });
    };
    process.on("message", (message) => {
      if (
        message?.type === "bootstrap_ack" &&
        message.messageId === providerMessageId
      ) {
        sendReport();
        return;
      }
      if (
        message?.type === "bootstrap_ack" &&
        message.messageId === reportMessageId
      ) {
        writeFileSync(
          resolve(process.cwd(), "report-ack.json"),
          JSON.stringify(message),
          "utf8",
        );
        if (${String(input.exitAfterAcknowledgment)}) {
          if (process.connected) process.disconnect();
          process.exit(message.exitCode);
        }
      }
    });
    if (${String(input.sendProviderBoundary)}) {
      process.send({
        messageId: providerMessageId,
        type: "provider_may_have_started",
      });
    } else {
      sendReport();
    }
    ${input.exitAfterAcknowledgment ? "" : "setInterval(() => undefined, 1_000);"}
  `;
}

describe("live eval initialization reporting", () => {
  it("keeps report acknowledgment beyond the bounded deep-verifier lifecycle", async () => {
    const workspace = process.cwd();
    const [bootstrapSource, childSource] = await Promise.all([
      readFile(resolve(workspace, "scripts/ai/live-eval-bootstrap.mjs"), "utf8"),
      readFile(resolve(workspace, "scripts/ai/live-eval-child.ts"), "utf8"),
    ]);
    const readDeadline = (source: string, name: string) => {
      const match = new RegExp(`const ${name} = ([\\d_]+);`, "u").exec(source);
      if (!match?.[1]) {
        throw new Error(`Missing ${name} deadline constant.`);
      }
      return Number(match[1].replaceAll("_", ""));
    };
    const consistencyDeadline = readDeadline(
      bootstrapSource,
      "REPORT_CONSISTENCY_VERIFICATION_DEADLINE_MS",
    );
    const receiptDeadline = readDeadline(
      bootstrapSource,
      "RECEIPT_VERIFICATION_DEADLINE_MS",
    );
    const sigtermGrace = readDeadline(bootstrapSource, "SIGTERM_GRACE_MS");
    const sigkillSettle = readDeadline(bootstrapSource, "SIGKILL_SETTLE_MS");
    const runnerExitGrace = readDeadline(
      bootstrapSource,
      "REPORT_EXIT_GRACE_MS",
    );
    const reportAcknowledgmentDeadline = readDeadline(
      childSource,
      "REPORT_ACKNOWLEDGMENT_TIMEOUT_MS",
    );

    expect(receiptDeadline).toBeGreaterThan(
      consistencyDeadline + sigtermGrace + sigkillSettle,
    );
    expect(reportAcknowledgmentDeadline).toBeGreaterThan(
      receiptDeadline + runnerExitGrace,
    );
    const verifierEnvironmentSource = bootstrapSource.slice(
      bootstrapSource.indexOf("function verifierEnvironment("),
      bootstrapSource.indexOf("function runReportConsistencyVerifier("),
    );
    expect(verifierEnvironmentSource).toContain(
      'new URL("../../tsconfig.json", REPORT_CONSISTENCY_VERIFIER_URL)',
    );
    expect(verifierEnvironmentSource).not.toContain(
      "process.env.TSX_TSCONFIG_PATH",
    );
    expect(verifierEnvironmentSource).not.toContain("process.env.PATH");
    expect(verifierEnvironmentSource).toContain("PATH: SYSTEM_EXECUTABLE_PATH");
    const runnerEnvironmentSource = bootstrapSource.slice(
      bootstrapSource.indexOf("function runnerEnvironment("),
      bootstrapSource.indexOf("function runReportConsistencyVerifier("),
    );
    expect(runnerEnvironmentSource).toContain("Object.entries(process.env)");
    expect(runnerEnvironmentSource).toContain(
      "UNSAFE_RUNNER_ENVIRONMENT_PREFIXES",
    );
    expect(runnerEnvironmentSource).toContain(
      "LIVE_EVAL_GIT_BINARY: systemGitBinary",
    );
    expect(runnerEnvironmentSource).toContain("PATH: SYSTEM_EXECUTABLE_PATH");
    expect(runnerEnvironmentSource).toContain(
      'GIT_TERMINAL_PROMPT: "0"',
    );
    const runnerChildSource = bootstrapSource.slice(
      bootstrapSource.indexOf("function runRunnerChild("),
      bootstrapSource.indexOf("async function main("),
    );
    expect(runnerChildSource).toContain(
      "env: runnerEnvironment(systemGitBinary)",
    );
    expect(runnerChildSource).not.toContain("env: { ...process.env }");
  });

  it.each([
    {
      linkMigrations: false,
      stage: "module_import",
      useWorkspaceTsconfig: false,
    },
    {
      linkMigrations: false,
      stage: "database",
      useWorkspaceTsconfig: true,
    },
    {
      linkMigrations: true,
      stage: "model_configuration",
      useWorkspaceTsconfig: true,
    },
  ] as const)(
    "persists an honest current-suite report for a $stage failure before any case",
    async ({ linkMigrations, stage, useWorkspaceTsconfig }) => {
      const workspace = process.cwd();
      const temporaryWorkspace = await mkdtemp(
        resolve(tmpdir(), "diesel-live-eval-init-"),
      );

      try {
        if (linkMigrations) {
          await symlink(
            resolve(workspace, "drizzle"),
            resolve(temporaryWorkspace, "drizzle"),
            "dir",
          );
        }
        const secret = "INIT-SECRET-SHOULD-NOT-APPEAR";
        const childEnvironment: NodeJS.ProcessEnv = {
          ...process.env,
          AI_API_KEY: secret,
          AI_BASE_URL: "",
          AI_ENABLE_THINKING: "",
          AI_MODEL: "",
          AI_MULTIMODAL_MODEL: "",
          AI_PROVIDER: "openai-compatible",
          NODE_ENV: "development",
        };
        if (useWorkspaceTsconfig) {
          childEnvironment.TSX_TSCONFIG_PATH = resolve(
            workspace,
            "tsconfig.json",
          );
        } else {
          delete childEnvironment.TSX_TSCONFIG_PATH;
        }
        const execution = spawnSync(
          process.execPath,
          [
            "--conditions=react-server",
            resolve(workspace, "scripts/ai/live-eval-bootstrap.mjs"),
          ],
          {
            cwd: temporaryWorkspace,
            encoding: "utf8",
            env: childEnvironment,
            timeout: 30_000,
          },
        );

        expect(execution.error).toBeUndefined();
        expect(
          execution.status,
          `${execution.stderr}\n${execution.stdout}`,
        ).toBe(1);
        const reportText = await readFile(
          resolve(
            temporaryWorkspace,
            "docs/evals/ai-live-eval-latest.json",
          ),
          "utf8",
        );
        const report = JSON.parse(reportText) as Record<string, unknown>;

        expect(report).toMatchObject({
          budget: {
            attemptCount: 0,
            caseCount: 0,
            completedCount: 0,
            maxOutputTokensPerCall: 1_024,
            maxPotentialOutputTokens: 92_160,
            maxRetriesPerModelCall: 0,
            modelStepCount: 0,
            tokenBudgetEnforcement: "post_usage_acceptance",
            tokenUsageComplete: false,
            totalTokens: 0,
          },
          complete: false,
          modelId: null,
          observability: {
            cacheHitRatePct: {
              max: null,
              p50: null,
              p95: null,
              sampleCount: 0,
            },
            cacheStatusCounts: {
              inconsistent: 0,
              partial: 0,
              reported: 0,
              unavailable: 0,
            },
            caseCounts: {
              attemptCoverageComplete: 0,
              attemptCoverageIncomplete: 0,
              modelPerformanceComplete: 0,
              modelPerformanceIncomplete: 0,
              total: 0,
            },
          },
          provenance: {
            promptVersion: "sales-chat-system-v7",
            providerProfile: null,
            repository: {
              baseHeadCommit: null,
              evaluatedCommit: null,
              worktreeState: "unavailable",
            },
            sourceFingerprint: {
              algorithm: "sha256",
              digest: null,
              fileCount: null,
              status: "unavailable",
            },
          },
          results: [],
          runError: {
            code: "INITIALIZATION_ERROR",
            stage,
          },
          sampleCount: 0,
          thresholdsPassed: false,
          terminationReason: "initialization_error",
          version: "sales-chat-live-v25",
        });
        expect(liveEvalReportSchema.safeParse(report).success).toBe(true);
        expect(report.runId).toEqual(expect.any(String));
        expect(report.evaluatedAt).toEqual(expect.any(String));
        expect(report.runId).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
        );
        const archiveFiles = await readdir(
          resolve(temporaryWorkspace, "docs/evals/archive"),
        );
        expect(archiveFiles).toEqual([
          formatLiveEvalArchiveFilename(
            String(report.evaluatedAt),
            String(report.runId),
          ),
        ]);
        const archiveText = await readFile(
          resolve(temporaryWorkspace, "docs/evals/archive", archiveFiles[0] ?? ""),
          "utf8",
        );
        expect(archiveText).toBe(reportText);
        expect(reportText).toMatch(
          /"errorName": "[A-Za-z][A-Za-z0-9._-]{0,63}"/u,
        );
        expect(
          Object.keys(report.runError as Record<string, unknown>).sort(),
        ).toEqual(["code", "errorName", "stage"]);
        expect(reportText).not.toContain(secret);
        expect(archiveText).not.toContain(secret);
        expect(execution.stderr).not.toContain(secret);
      } finally {
        await rm(temporaryWorkspace, { force: true, recursive: true });
      }
    },
    30_000,
  );

  it("persists a schema-valid current-suite failure when the runner module cannot load", async () => {
    const workspace = process.cwd();
    const temporaryWorkspace = await mkdtemp(
      resolve(tmpdir(), "diesel-live-eval-bootstrap-"),
    );
    const bootstrapPath = resolve(
      temporaryWorkspace,
      "live-eval-bootstrap.mjs",
    );

    try {
      await copyFile(
        resolve(workspace, "scripts/ai/live-eval-bootstrap.mjs"),
        bootstrapPath,
      );
      const secret = "BOOTSTRAP-SECRET-SHOULD-NOT-APPEAR";
      const execution = spawnSync(
        process.execPath,
        [bootstrapPath],
        {
          cwd: temporaryWorkspace,
          encoding: "utf8",
          env: {
            ...process.env,
            AI_API_KEY: secret,
            TSX_TSCONFIG_PATH: resolve(workspace, "tsconfig.json"),
          },
          timeout: 30_000,
        },
      );

      expect(execution.error).toBeUndefined();
      expect(
        execution.status,
        `${execution.stderr}\n${execution.stdout}`,
      ).toBe(1);
      const latestPath = resolve(
        temporaryWorkspace,
        "docs/evals/ai-live-eval-latest.json",
      );
      const reportText = await readFile(latestPath, "utf8");
      const parsed: unknown = JSON.parse(reportText);
      const report = liveEvalReportSchema.parse(parsed);

      expect(report).toMatchObject({
        budget: {
          attemptCount: 0,
          caseCount: 0,
          caseTimeoutMs: LIVE_EVAL_CASE_TIMEOUT_MS,
          caseTokenReserve: LIVE_EVAL_CASE_TOKEN_RESERVE,
          completedCount: 0,
          maxCases: LIVE_EVAL_MAX_CASES,
          maxLoopStepsPerCase: MAX_AI_TOOL_STEPS,
          maxOutputTokensPerCall: LIVE_EVAL_MAX_OUTPUT_TOKENS_PER_CALL,
          maxPotentialOutputTokens:
            salesChatLiveCases.length *
            MAX_AI_TOOL_STEPS *
            LIVE_EVAL_MAX_OUTPUT_TOKENS_PER_CALL,
          maxRetriesPerModelCall: LIVE_EVAL_MAX_RETRIES_PER_MODEL_CALL,
          maxTokens: LIVE_EVAL_MAX_TOKENS,
          modelStepCount: 0,
          tokenBudgetEnforcement: LIVE_EVAL_TOKEN_BUDGET_ENFORCEMENT,
          tokenUsageComplete: false,
          totalTokens: 0,
        },
        complete: false,
        modelId: null,
        provenance: {
          promptVersion: SALES_CHAT_SYSTEM_PROMPT_VERSION,
          providerProfile: null,
          repository: { worktreeState: "unavailable" },
          sourceFingerprint: { status: "unavailable" },
        },
        results: [],
        runError: {
          code: "INITIALIZATION_ERROR",
          stage: "module_import",
        },
        sampleCount: 0,
        thresholds: LIVE_EVAL_THRESHOLDS,
        thresholdsPassed: false,
        terminationReason: "initialization_error",
        version: SALES_CHAT_LIVE_EVAL_VERSION,
      });
      expect(report.budget.maxCases).toBe(salesChatLiveCases.length);
      const archiveFiles = await readdir(
        resolve(temporaryWorkspace, "docs/evals/archive"),
      );
      expect(archiveFiles).toEqual([
        formatLiveEvalArchiveFilename(report.evaluatedAt, report.runId),
      ]);
      const archiveText = await readFile(
        resolve(temporaryWorkspace, "docs/evals/archive", archiveFiles[0] ?? ""),
        "utf8",
      );
      expect(archiveText).toBe(reportText);
      expect(reportText).not.toContain(secret);
      expect(execution.stderr).not.toContain(secret);
    } finally {
      await rm(temporaryWorkspace, { force: true, recursive: true });
    }
  }, 30_000);

  it.each([
    {
      childSource: "process.exitCode = 1;\n",
      expectFallback: true,
      name: "before the provider boundary",
    },
    {
      childSource: `
        if (typeof process.send !== "function") {
          throw new Error("Missing IPC channel.");
        }
        const messageId = "00000000-0000-4000-8000-000000000001";
        const onMessage = (message) => {
          if (
            message?.type === "bootstrap_ack" &&
            message.messageId === messageId
          ) {
            process.off("message", onMessage);
            process.disconnect();
            process.exitCode = 1;
          }
        };
        process.on("message", onMessage);
        process.send({
          type: "provider_may_have_started",
          messageId,
        }, (error) => {
          if (error) {
            throw error;
          }
        });
      `,
      expectFallback: false,
      name: "after the provider boundary",
    },
  ] as const)(
    "handles a runner crash $name without inventing provider history",
    async ({ childSource, expectFallback }) => {
      const workspace = process.cwd();
      const sourceDirectory = await mkdtemp(
        resolve(workspace, ".live-eval-bootstrap-test-"),
      );
      const reportWorkspace = await mkdtemp(
        resolve(tmpdir(), "diesel-live-eval-phase-"),
      );
      const bootstrapPath = resolve(
        sourceDirectory,
        "live-eval-bootstrap.mjs",
      );

      try {
        await copyFile(
          resolve(workspace, "scripts/ai/live-eval-bootstrap.mjs"),
          bootstrapPath,
        );
        await writeFile(
          resolve(sourceDirectory, "live-eval-child.ts"),
          childSource,
          "utf8",
        );
        const execution = spawnSync(process.execPath, [bootstrapPath], {
          cwd: reportWorkspace,
          encoding: "utf8",
          env: {
            ...process.env,
            TSX_TSCONFIG_PATH: resolve(workspace, "tsconfig.json"),
          },
          timeout: 30_000,
        });

        expect(execution.error).toBeUndefined();
        expect(execution.status).toBe(1);
        const latestPath = resolve(
          reportWorkspace,
          "docs/evals/ai-live-eval-latest.json",
        );
        if (expectFallback) {
          const report = liveEvalReportSchema.parse(
            JSON.parse(await readFile(latestPath, "utf8")) as unknown,
          );
          expect(report).toMatchObject({
            budget: { attemptCount: 0, completedCount: 0 },
            runError: {
              code: "INITIALIZATION_ERROR",
              stage: "module_import",
            },
            thresholdsPassed: false,
          });
        } else {
          await expect(readFile(latestPath, "utf8")).rejects.toMatchObject({
            code: "ENOENT",
          });
          expect(execution.stderr).toContain(
            "failed after the provider boundary",
          );
        }
      } finally {
        await rm(sourceDirectory, { force: true, recursive: true });
        await rm(reportWorkspace, { force: true, recursive: true });
      }
    },
    30_000,
  );

  it("bounds a pre-provider hang and writes a zero-call fallback only after exit", async () => {
    const workspace = process.cwd();
    const sourceDirectory = await mkdtemp(
      resolve(workspace, ".live-eval-watchdog-test-"),
    );
    const reportWorkspace = await mkdtemp(
      resolve(tmpdir(), "diesel-live-eval-watchdog-report-"),
    );
    const bootstrapPath = resolve(sourceDirectory, "live-eval-bootstrap.mjs");
    try {
      await writeBootstrapWithDeadlines(workspace, bootstrapPath, {
        initialization: 250,
        sigkill: 100,
        sigterm: 100,
      });
      await writeFile(
        resolve(sourceDirectory, "live-eval-child.ts"),
        `
          import { writeFileSync } from "node:fs";
          import { resolve } from "node:path";
          process.on("SIGTERM", () => {
            writeFileSync(
              resolve(process.cwd(), "sigterm-observed"),
              "yes",
              "utf8",
            );
          });
          if (typeof process.send !== "function") throw new Error("Missing IPC.");
          const readyMessageId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
          process.on("message", (message) => {
            if (message?.type === "bootstrap_ack" && message.messageId === readyMessageId) {
              setInterval(() => undefined, 1_000);
            }
          });
          process.send({ messageId: readyMessageId, type: "initialization_ready" });
        `,
        "utf8",
      );

      const execution = await runBootstrapProcess(
        bootstrapPath,
        reportWorkspace,
        {
          ...process.env,
          TSX_TSCONFIG_PATH: resolve(workspace, "tsconfig.json"),
        },
        5_000,
      );

      expect(execution.safetyTimedOut).toBe(false);
      expect(execution.code).toBe(1);
      expect(execution.signal).toBeNull();
      expect(
        await readFile(resolve(reportWorkspace, "sigterm-observed"), "utf8"),
      ).toBe("yes");
      const report = liveEvalReportSchema.parse(
        JSON.parse(
          await readFile(
            resolve(reportWorkspace, "docs/evals/ai-live-eval-latest.json"),
            "utf8",
          ),
        ),
      );
      expect(report).toMatchObject({
        budget: { attemptCount: 0, completedCount: 0 },
        results: [],
        thresholdsPassed: false,
        terminationReason: "initialization_error",
      });
    } finally {
      await rm(sourceDirectory, { force: true, recursive: true });
      await rm(reportWorkspace, { force: true, recursive: true });
    }
  }, 10_000);

  it("bounds a post-provider hang without fabricating a zero-call report", async () => {
    const workspace = process.cwd();
    const sourceDirectory = await mkdtemp(
      resolve(workspace, ".live-eval-watchdog-test-"),
    );
    const reportWorkspace = await mkdtemp(
      resolve(tmpdir(), "diesel-live-eval-watchdog-report-"),
    );
    const bootstrapPath = resolve(sourceDirectory, "live-eval-bootstrap.mjs");
    try {
      await writeBootstrapWithDeadlines(workspace, bootstrapPath, { run: 250 });
      await writeFile(
        resolve(sourceDirectory, "live-eval-child.ts"),
        `
          import { writeFileSync } from "node:fs";
          import { resolve } from "node:path";
          if (typeof process.send !== "function") throw new Error("Missing IPC channel.");
          const messageId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
          process.on("message", (message) => {
            if (message?.type === "bootstrap_ack" && message.messageId === messageId) {
              writeFileSync(resolve(process.cwd(), "provider-crossed"), "yes", "utf8");
              setInterval(() => undefined, 1_000);
            }
          });
          process.send({ messageId, type: "provider_may_have_started" });
        `,
        "utf8",
      );

      const execution = await runBootstrapProcess(
        bootstrapPath,
        reportWorkspace,
        {
          ...process.env,
          TSX_TSCONFIG_PATH: resolve(workspace, "tsconfig.json"),
        },
        5_000,
      );

      expect(execution.safetyTimedOut).toBe(false);
      expect(execution.code).toBe(1);
      expect(await readFile(resolve(reportWorkspace, "provider-crossed"), "utf8"))
        .toBe("yes");
      await expect(
        readFile(
          resolve(reportWorkspace, "docs/evals/ai-live-eval-latest.json"),
          "utf8",
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(execution.stderr).toContain("after the provider boundary");
    } finally {
      await rm(sourceDirectory, { force: true, recursive: true });
      await rm(reportWorkspace, { force: true, recursive: true });
    }
  }, 10_000);

  it("does not claim zero calls after an unknown pre-provider IPC message", async () => {
    const workspace = process.cwd();
    const sourceDirectory = await mkdtemp(
      resolve(workspace, ".live-eval-watchdog-test-"),
    );
    const reportWorkspace = await mkdtemp(
      resolve(tmpdir(), "diesel-live-eval-watchdog-report-"),
    );
    const bootstrapPath = resolve(sourceDirectory, "live-eval-bootstrap.mjs");
    try {
      await writeBootstrapWithDeadlines(workspace, bootstrapPath, {});
      await writeFile(
        resolve(sourceDirectory, "live-eval-child.ts"),
        `
          if (typeof process.send !== "function") throw new Error("Missing IPC channel.");
          process.send({
            messageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            type: "unknown_pre_provider_message",
          });
          setInterval(() => undefined, 1_000);
        `,
        "utf8",
      );

      const execution = await runBootstrapProcess(
        bootstrapPath,
        reportWorkspace,
        {
          ...process.env,
          TSX_TSCONFIG_PATH: resolve(workspace, "tsconfig.json"),
        },
        5_000,
      );

      expect(execution.safetyTimedOut).toBe(false);
      expect(execution.code).toBe(1);
      await expect(
        readFile(
          resolve(reportWorkspace, "docs/evals/ai-live-eval-latest.json"),
          "utf8",
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(execution.stderr).toContain("without a trustworthy completed receipt");
    } finally {
      await rm(sourceDirectory, { force: true, recursive: true });
      await rm(reportWorkspace, { force: true, recursive: true });
    }
  }, 10_000);

  it("acknowledges a durable failure receipt but fails a child that stays alive", async () => {
    const workspace = process.cwd();
    const sourceDirectory = await mkdtemp(
      resolve(workspace, ".live-eval-receipt-test-"),
    );
    const reportWorkspace = await mkdtemp(
      resolve(tmpdir(), "diesel-live-eval-receipt-report-"),
    );
    const bootstrapPath = resolve(sourceDirectory, "live-eval-bootstrap.mjs");
    try {
      await writeBootstrapWithDeadlines(workspace, bootstrapPath, {
        reportExit: 250,
      });
      const report = await buildFailureReceiptReport(
        workspace,
        "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      );
      const receipt = await writeReceiptFixture(reportWorkspace, report);
      await writeFile(
        resolve(sourceDirectory, "live-eval-child.ts"),
        buildReceiptChildSource({
          exitAfterAcknowledgment: false,
          receipt,
          sendProviderBoundary: false,
        }),
        "utf8",
      );

      const execution = await runBootstrapProcess(
        bootstrapPath,
        reportWorkspace,
        {
          ...process.env,
          TSX_TSCONFIG_PATH: resolve(workspace, "tsconfig.json"),
        },
        5_000,
      );

      expect(execution.safetyTimedOut).toBe(false);
      expect(execution.code).toBe(1);
      expect(
        JSON.parse(
          await readFile(resolve(reportWorkspace, "report-ack.json"), "utf8"),
        ),
      ).toMatchObject({ exitCode: 1, type: "bootstrap_ack" });
      expect(
        await readFile(
          resolve(reportWorkspace, "docs/evals/ai-live-eval-latest.json"),
          "utf8",
        ),
      ).toBe(`${JSON.stringify(report, null, 2)}\n`);
    } finally {
      await rm(sourceDirectory, { force: true, recursive: true });
      await rm(reportWorkspace, { force: true, recursive: true });
    }
  }, 10_000);

  it("does not accept a passing receipt when the acknowledged child stays alive", async () => {
    const workspace = process.cwd();
    const sourceDirectory = await mkdtemp(
      resolve(workspace, ".live-eval-receipt-test-"),
    );
    const reportWorkspace = await mkdtemp(
      resolve(tmpdir(), "diesel-live-eval-receipt-report-"),
    );
    const bootstrapPath = resolve(sourceDirectory, "live-eval-bootstrap.mjs");
    try {
      await writeBootstrapWithDeadlines(workspace, bootstrapPath, {
        reportExit: 250,
      });
      const report = await buildPassingReceiptReport(
        workspace,
        "abababab-abab-4bab-8bab-abababababab",
      );
      const receipt = await writeReceiptFixture(reportWorkspace, report);
      await writeFile(
        resolve(sourceDirectory, "live-eval-child.ts"),
        buildReceiptChildSource({
          exitAfterAcknowledgment: false,
          receipt,
          sendProviderBoundary: true,
        }),
        "utf8",
      );

      const execution = await runBootstrapProcess(
        bootstrapPath,
        reportWorkspace,
        {
          ...process.env,
          TSX_TSCONFIG_PATH: resolve(workspace, "tsconfig.json"),
        },
        5_000,
      );

      expect(execution.safetyTimedOut).toBe(false);
      expect(execution.code).toBe(1);
      await expect(
        readFile(resolve(reportWorkspace, "report-ack.json"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(sourceDirectory, { force: true, recursive: true });
      await rm(reportWorkspace, { force: true, recursive: true });
    }
  }, 10_000);

  it.each([
    { expectedExitCode: 1, kind: "passing" },
    { expectedExitCode: 1, kind: "failing" },
  ] as const)(
    "derives exit $expectedExitCode from a $kind persisted report",
    async ({ expectedExitCode, kind }) => {
      const workspace = process.cwd();
      const sourceDirectory = await mkdtemp(
        resolve(workspace, ".live-eval-receipt-test-"),
      );
      const reportWorkspace = await mkdtemp(
        resolve(tmpdir(), "diesel-live-eval-receipt-report-"),
      );
      const bootstrapPath = resolve(sourceDirectory, "live-eval-bootstrap.mjs");
      try {
        await writeBootstrapWithDeadlines(workspace, bootstrapPath, {});
        const report = kind === "passing"
          ? await buildPassingReceiptReport(
              workspace,
              "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            )
          : await buildFailureReceiptReport(
              workspace,
              "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            );
        const receipt = await writeReceiptFixture(reportWorkspace, report);
        await writeFile(
          resolve(sourceDirectory, "live-eval-child.ts"),
          buildReceiptChildSource({
            exitAfterAcknowledgment: true,
            receipt,
            sendProviderBoundary: true,
          }),
          "utf8",
        );

        const execution = await runBootstrapProcess(
          bootstrapPath,
          reportWorkspace,
          {
            ...process.env,
            TSX_TSCONFIG_PATH: resolve(workspace, "tsconfig.json"),
          },
          5_000,
        );

        expect(execution.safetyTimedOut).toBe(false);
        expect(execution.code, execution.stderr).toBe(expectedExitCode);
        if (kind === "passing") {
          await expect(
            readFile(resolve(reportWorkspace, "report-ack.json"), "utf8"),
          ).rejects.toMatchObject({ code: "ENOENT" });
        } else {
          expect(
            JSON.parse(
              await readFile(resolve(reportWorkspace, "report-ack.json"), "utf8"),
            ),
          ).toMatchObject({ exitCode: expectedExitCode, type: "bootstrap_ack" });
        }
      } finally {
        await rm(sourceDirectory, { force: true, recursive: true });
        await rm(reportWorkspace, { force: true, recursive: true });
      }
    },
    10_000,
  );

  it("does not execute a caller-PATH git while verifying a passing receipt", async () => {
    const workspace = process.cwd();
    const sourceDirectory = await mkdtemp(
      resolve(workspace, ".live-eval-receipt-test-"),
    );
    const reportWorkspace = await mkdtemp(
      resolve(tmpdir(), "diesel-live-eval-receipt-report-"),
    );
    const poisonDirectory = await mkdtemp(
      resolve(tmpdir(), "diesel-live-eval-poison-path-"),
    );
    const poisonMarker = resolve(reportWorkspace, "poison-git-ran");
    const bootstrapPath = resolve(sourceDirectory, "live-eval-bootstrap.mjs");
    const verifierPath = resolve(sourceDirectory, "path-verifier.ts");
    try {
      await writeBootstrapWithDeadlines(
        workspace,
        bootstrapPath,
        {},
        verifierPath,
      );
      await writeFile(
        resolve(poisonDirectory, "git"),
        `#!/bin/sh\nprintf poison > ${JSON.stringify(poisonMarker)}\nexit 1\n`,
        "utf8",
      );
      await chmod(resolve(poisonDirectory, "git"), 0o755);
      const report = await buildPassingReceiptReport(
        workspace,
        "21212121-2121-4121-8121-212121212121",
      );
      const receipt = await writeReceiptFixture(reportWorkspace, report);
      await Promise.all([
        writeFile(
          resolve(sourceDirectory, "live-eval-child.ts"),
          buildReceiptChildSource({
            exitAfterAcknowledgment: true,
            observations: buildOpaqueObservations(report),
            receipt,
            sendProviderBoundary: true,
          }),
          "utf8",
        ),
        writeFile(
          verifierPath,
          `
            import { spawnSync } from "node:child_process";
            if (typeof process.send !== "function") throw new Error("Missing IPC.");
            process.once("message", (message) => {
              const git = spawnSync("git", ["--version"], { encoding: "utf8" });
              if (git.status !== 0) process.exit(1);
              process.send({
                messageId: message.messageId,
                observationsReceipt: message.observations.receipt,
                protocolVersion: 2,
                reportCanPass: true,
                reportReceipt: message.reportReceipt,
                type: "live_eval_report_verified",
              }, () => { process.disconnect(); process.exit(0); });
            });
          `,
          "utf8",
        ),
      ]);

      const execution = await runBootstrapProcess(
        bootstrapPath,
        reportWorkspace,
        {
          ...process.env,
          PATH: poisonDirectory,
          TSX_TSCONFIG_PATH: resolve(workspace, "tsconfig.json"),
        },
        5_000,
      );

      expect(execution.safetyTimedOut).toBe(false);
      expect(execution.code, execution.stderr).toBe(0);
      await expect(readFile(poisonMarker, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(sourceDirectory, { force: true, recursive: true });
      await rm(reportWorkspace, { force: true, recursive: true });
      await rm(poisonDirectory, { force: true, recursive: true });
    }
  }, 10_000);

  it.each([
    {
      kind: "result-pass",
      runId: "12121212-1212-4212-8212-121212121212",
    },
    {
      kind: "score",
      runId: "13131313-1313-4313-8313-131313131313",
    },
    {
      kind: "token-total",
      runId: "14141414-1414-4414-8414-141414141414",
    },
    {
      kind: "source-unavailable",
      runId: "15151515-1515-4515-8515-151515151515",
    },
    {
      kind: "repository-unavailable",
      runId: "16161616-1616-4616-8616-161616161616",
    },
    {
      kind: "model-drift",
      runId: "22222222-2222-4222-8222-222222222222",
    },
    {
      kind: "profile-drift",
      runId: "23232323-2323-4323-8323-232323232323",
    },
    {
      kind: "head-drift",
      runId: "24242424-2424-4424-8424-242424242424",
    },
  ] as const)(
    "rejects a receipt whose $kind field contradicts its recomputable rows",
    async ({ kind, runId }) => {
      const workspace = process.cwd();
      const sourceDirectory = await mkdtemp(
        resolve(workspace, ".live-eval-receipt-test-"),
      );
      const reportWorkspace = await mkdtemp(
        resolve(tmpdir(), "diesel-live-eval-receipt-report-"),
      );
      const bootstrapPath = resolve(sourceDirectory, "live-eval-bootstrap.mjs");
      try {
        await writeBootstrapWithDeadlines(workspace, bootstrapPath, {});
        const report = await buildPassingReceiptReport(workspace, runId);
        if (kind === "result-pass") {
          const firstResult = report.results[0];
          if (!firstResult) {
            throw new Error("Synthetic live-eval report has no result rows.");
          }
          firstResult.pass = false;
        } else if (kind === "score") {
          report.scores.argsAccuracyPct = 99;
        } else if (kind === "token-total") {
          report.budget.totalTokens += 1;
        } else if (kind === "source-unavailable") {
          report.provenance.sourceFingerprint = {
            algorithm: "sha256",
            digest: null,
            fileCount: null,
            status: "unavailable",
          };
        } else if (kind === "repository-unavailable") {
          report.provenance.repository = {
            baseHeadCommit: null,
            evaluatedCommit: null,
            worktreeState: "unavailable",
          };
        } else if (kind === "model-drift") {
          report.modelId = "server-openai-compatible/forged-model";
        } else if (kind === "profile-drift") {
          const providerProfile = report.provenance.providerProfile;
          if (providerProfile === null) {
            throw new Error("Passing report has no provider profile.");
          }
          providerProfile.endpointSha256 = "f".repeat(64);
        } else {
          report.provenance.repository.baseHeadCommit = "0".repeat(40);
        }
        const receipt = await writeReceiptFixture(reportWorkspace, report);
        await writeFile(
          resolve(sourceDirectory, "live-eval-child.ts"),
          buildReceiptChildSource({
            exitAfterAcknowledgment: true,
            receipt,
            sendProviderBoundary: true,
          }),
          "utf8",
        );

        const execution = await runBootstrapProcess(
          bootstrapPath,
          reportWorkspace,
          {
            ...process.env,
            TSX_TSCONFIG_PATH: resolve(workspace, "tsconfig.json"),
          },
          10_000,
        );

        expect(execution.safetyTimedOut).toBe(false);
        expect(execution.code).toBe(1);
        await expect(
          readFile(resolve(reportWorkspace, "report-ack.json"), "utf8"),
        ).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await rm(sourceDirectory, { force: true, recursive: true });
        await rm(reportWorkspace, { force: true, recursive: true });
      }
    },
    15_000,
  );

  it.each([
    "bad-nonce",
    "replace-latest-before-exit",
    "response-without-exit",
  ] as const)(
    "rejects a deep verifier with $case protocol behavior",
    async (failureMode) => {
      const workspace = process.cwd();
      const sourceDirectory = await mkdtemp(
        resolve(workspace, ".live-eval-receipt-test-"),
      );
      const reportWorkspace = await mkdtemp(
        resolve(tmpdir(), "diesel-live-eval-receipt-report-"),
      );
      const bootstrapPath = resolve(sourceDirectory, "live-eval-bootstrap.mjs");
      const verifierPath = resolve(sourceDirectory, "fake-receipt-verifier.ts");
      try {
        await writeBootstrapWithDeadlines(
          workspace,
          bootstrapPath,
          {
            consistencyVerification: 800,
            receiptVerification: 1_500,
            sigkill: 100,
            sigterm: 100,
          },
          verifierPath,
        );
        const report = await buildPassingReceiptReport(
          workspace,
          failureMode === "bad-nonce"
            ? "17171717-1717-4717-8717-171717171717"
            : failureMode === "replace-latest-before-exit"
              ? "18181818-1818-4818-8818-181818181818"
              : "20202020-2020-4020-8020-202020202020",
        );
        const receipt = await writeReceiptFixture(reportWorkspace, report);
        await Promise.all([
          writeFile(
            resolve(sourceDirectory, "live-eval-child.ts"),
            buildReceiptChildSource({
              exitAfterAcknowledgment: true,
              observations: buildOpaqueObservations(report),
              receipt,
              sendProviderBoundary: true,
            }),
            "utf8",
          ),
          writeFile(
            verifierPath,
            `
              import { writeFileSync } from "node:fs";
              import { resolve } from "node:path";
              if (typeof process.send !== "function") throw new Error("Missing IPC channel.");
              process.once("message", (message) => {
                ${failureMode === "replace-latest-before-exit"
                  ? `writeFileSync(
                      resolve(process.cwd(), "docs/evals/ai-live-eval-latest.json"),
                      "{}\\n",
                      "utf8",
                    );`
                  : ""}
                process.send({
                  messageId: ${failureMode === "bad-nonce" ? '"19191919-1919-4919-8919-191919191919"' : "message.messageId"},
                  observationsReceipt: message.observations.receipt,
                  protocolVersion: 2,
                  reportCanPass: true,
                  reportReceipt: message.reportReceipt,
                  type: "live_eval_report_verified",
                }, (error) => {
                  if (error) throw error;
                  ${failureMode === "bad-nonce" ||
                  failureMode === "replace-latest-before-exit"
                    ? "process.disconnect(); process.exit(0);"
                    : ""}
                });
              });
              ${failureMode === "response-without-exit"
                ? `process.on("SIGTERM", () => {
                    writeFileSync(resolve(process.cwd(), "verifier-sigterm-observed"), "yes", "utf8");
                  });
                  setInterval(() => undefined, 1_000);`
                : ""}
            `,
            "utf8",
          ),
        ]);

        const execution = await runBootstrapProcess(
          bootstrapPath,
          reportWorkspace,
          {
            ...process.env,
            TSX_TSCONFIG_PATH: resolve(workspace, "tsconfig.json"),
          },
          5_000,
        );

        expect(execution.safetyTimedOut).toBe(false);
        expect(execution.code).toBe(1);
        await expect(
          readFile(resolve(reportWorkspace, "report-ack.json"), "utf8"),
        ).rejects.toMatchObject({ code: "ENOENT" });
        if (failureMode === "response-without-exit") {
          expect(
            await readdir(reportWorkspace),
            execution.stderr,
          ).toContain("verifier-sigterm-observed");
        }
      } finally {
        await rm(sourceDirectory, { force: true, recursive: true });
        await rm(reportWorkspace, { force: true, recursive: true });
      }
    },
    10_000,
  );

  it.each(["digest", "canonical-bytes"] as const)(
    "rejects a forged report receipt with invalid $case",
    async (failureMode) => {
      const workspace = process.cwd();
      const sourceDirectory = await mkdtemp(
        resolve(workspace, ".live-eval-receipt-test-"),
      );
      const reportWorkspace = await mkdtemp(
        resolve(tmpdir(), "diesel-live-eval-receipt-report-"),
      );
      const bootstrapPath = resolve(sourceDirectory, "live-eval-bootstrap.mjs");
      try {
        await writeBootstrapWithDeadlines(workspace, bootstrapPath, {});
        const report = await buildFailureReceiptReport(
          workspace,
          "ffffffff-ffff-4fff-8fff-ffffffffffff",
        );
        const canonicalText = `${JSON.stringify(report, null, 2)}\n`;
        const reportText = failureMode === "canonical-bytes"
          ? canonicalText.replace(
              '  "thresholdsPassed": false,',
              '  "thresholdsPassed": true,\n  "thresholdsPassed": false,',
            )
          : canonicalText;
        const receipt = await writeReceiptFixture(
          reportWorkspace,
          report,
          reportText,
        );
        const sentReceipt = failureMode === "digest"
          ? { ...receipt, sha256: "0".repeat(64) }
          : receipt;
        await writeFile(
          resolve(sourceDirectory, "live-eval-child.ts"),
          buildReceiptChildSource({
            exitAfterAcknowledgment: false,
            receipt: sentReceipt,
            sendProviderBoundary: false,
          }),
          "utf8",
        );

        const execution = await runBootstrapProcess(
          bootstrapPath,
          reportWorkspace,
          {
            ...process.env,
            TSX_TSCONFIG_PATH: resolve(workspace, "tsconfig.json"),
          },
          5_000,
        );

        expect(execution.safetyTimedOut).toBe(false);
        expect(execution.code).toBe(1);
        await expect(
          readFile(resolve(reportWorkspace, "report-ack.json"), "utf8"),
        ).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await rm(sourceDirectory, { force: true, recursive: true });
        await rm(reportWorkspace, { force: true, recursive: true });
      }
    },
    10_000,
  );

  it.each([
    "digest",
    "identity",
    "oversize",
    "noncanonical",
  ] as const)(
    "rejects a passing report with $case observation bytes before ACK0",
    async (failureMode) => {
      const workspace = process.cwd();
      const sourceDirectory = await mkdtemp(
        resolve(workspace, ".live-eval-receipt-test-"),
      );
      const reportWorkspace = await mkdtemp(
        resolve(tmpdir(), "diesel-live-eval-receipt-report-"),
      );
      const bootstrapPath = resolve(sourceDirectory, "live-eval-bootstrap.mjs");
      try {
        await writeBootstrapWithDeadlines(workspace, bootstrapPath, {});
        const report = await buildPassingReceiptReport(
          workspace,
          "25252525-2525-4525-8525-252525252525",
        );
        const receipt = await writeReceiptFixture(reportWorkspace, report);
        const observations = buildOpaqueObservations(report);
        if (failureMode === "digest") {
          observations.receipt.sha256 = "0".repeat(64);
        } else if (failureMode === "identity") {
          observations.receipt.runId =
            "26262626-2626-4626-8626-262626262626";
        } else if (failureMode === "oversize") {
          observations.receipt.byteLength = 8 * 1024 * 1024 + 1;
        } else {
          observations.reportText = "{ }\n";
          observations.receipt.byteLength = Buffer.byteLength(
            observations.reportText,
          );
          observations.receipt.sha256 = createHash("sha256")
            .update(observations.reportText)
            .digest("hex");
        }
        await writeFile(
          resolve(sourceDirectory, "live-eval-child.ts"),
          buildReceiptChildSource({
            exitAfterAcknowledgment: true,
            observations,
            receipt,
            sendProviderBoundary: true,
          }),
          "utf8",
        );

        const execution = await runBootstrapProcess(
          bootstrapPath,
          reportWorkspace,
          {
            ...process.env,
            TSX_TSCONFIG_PATH: resolve(workspace, "tsconfig.json"),
          },
          8_000,
        );

        expect(execution.safetyTimedOut).toBe(false);
        expect(execution.code).toBe(1);
        await expect(
          readFile(resolve(reportWorkspace, "report-ack.json"), "utf8"),
        ).rejects.toMatchObject({ code: "ENOENT" });
        expect(await readdir(resolve(reportWorkspace, "docs/evals"))).not
          .toContain("live-eval-observations.json");
      } finally {
        await rm(sourceDirectory, { force: true, recursive: true });
        await rm(reportWorkspace, { force: true, recursive: true });
      }
    },
    12_000,
  );

  it.each([
    {
      boundaryRejections: ["tool_error"] as const,
      label: "boundary rejection",
      streamCompleted: true,
      streamErrorObserved: false,
    },
    {
      boundaryRejections: [] as const,
      label: "stream error",
      streamCompleted: true,
      streamErrorObserved: true,
    },
  ])(
    "does not ACK0 a schema-valid sidecar with $label",
    async ({ boundaryRejections, streamCompleted, streamErrorObserved }) => {
      const workspace = process.cwd();
      const sourceDirectory = await mkdtemp(
        resolve(workspace, ".live-eval-receipt-test-"),
      );
      const reportWorkspace = await mkdtemp(
        resolve(tmpdir(), "diesel-live-eval-receipt-report-"),
      );
      const bootstrapPath = resolve(sourceDirectory, "live-eval-bootstrap.mjs");
      try {
        await writeBootstrapWithDeadlines(workspace, bootstrapPath, {});
        const report = await buildPassingReceiptReport(
          workspace,
          streamErrorObserved
            ? "27272727-2727-4727-8727-272727272727"
            : "28282828-2828-4828-8828-282828282828",
        );
        const receipt = await writeReceiptFixture(reportWorkspace, report);
        await writeFile(
          resolve(sourceDirectory, "live-eval-child.ts"),
          buildReceiptChildSource({
            exitAfterAcknowledgment: true,
            observations: buildStateObservationEnvelope(report, {
              boundaryRejections: [...boundaryRejections],
              streamCompleted,
              streamErrorObserved,
            }),
            receipt,
            sendProviderBoundary: true,
          }),
          "utf8",
        );

        const execution = await runBootstrapProcess(
          bootstrapPath,
          reportWorkspace,
          {
            ...process.env,
            TSX_TSCONFIG_PATH: resolve(workspace, "tsconfig.json"),
          },
          8_000,
        );
        expect(execution.safetyTimedOut).toBe(false);
        expect(execution.code).toBe(1);
        await expect(
          readFile(resolve(reportWorkspace, "report-ack.json"), "utf8"),
        ).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await rm(sourceDirectory, { force: true, recursive: true });
        await rm(reportWorkspace, { force: true, recursive: true });
      }
    },
    12_000,
  );

  it("keeps concurrent bootstrap failures archived and advances latest by identity", async () => {
    const workspace = process.cwd();
    const sourceDirectory = await mkdtemp(
      resolve(tmpdir(), "diesel-live-eval-concurrent-source-"),
    );
    const reportWorkspace = await mkdtemp(
      resolve(tmpdir(), "diesel-live-eval-concurrent-report-"),
    );
    const bootstrapPath = resolve(
      sourceDirectory,
      "live-eval-bootstrap.mjs",
    );

    try {
      await copyFile(
        resolve(workspace, "scripts/ai/live-eval-bootstrap.mjs"),
        bootstrapPath,
      );
      const secret = "CONCURRENT-BOOTSTRAP-SECRET-SHOULD-NOT-APPEAR";
      const executions = await Promise.all([
        runBootstrapProcess(bootstrapPath, reportWorkspace, {
          ...process.env,
          AI_API_KEY: secret,
        }),
        runBootstrapProcess(bootstrapPath, reportWorkspace, {
          ...process.env,
          AI_API_KEY: secret,
        }),
      ]);

      for (const execution of executions) {
        expect(execution.code).toBe(1);
        expect(execution.signal).toBeNull();
        expect(execution.stderr).not.toContain(secret);
        expect(execution.stdout).not.toContain(secret);
      }

      const evalDirectory = resolve(reportWorkspace, "docs/evals");
      const archiveDirectory = resolve(evalDirectory, "archive");
      const archiveFiles = (await readdir(archiveDirectory)).sort();
      expect(archiveFiles).toHaveLength(2);
      const archived = await Promise.all(
        archiveFiles.map(async (filename) => {
          const text = await readFile(resolve(archiveDirectory, filename), "utf8");
          expect(text).not.toContain(secret);
          const report = liveEvalReportSchema.parse(
            JSON.parse(text) as unknown,
          );
          expect(filename).toBe(
            formatLiveEvalArchiveFilename(report.evaluatedAt, report.runId),
          );
          return { report, text };
        }),
      );
      const expectedLatest = [...archived].sort((left, right) =>
        left.report.evaluatedAt.localeCompare(right.report.evaluatedAt) ||
        left.report.runId.localeCompare(right.report.runId)
      ).at(-1);
      expect(expectedLatest).toBeDefined();
      const latestText = await readFile(
        resolve(evalDirectory, "ai-live-eval-latest.json"),
        "utf8",
      );
      expect(latestText).toBe(expectedLatest?.text);
      const residualEntries = [
        ...(await readdir(evalDirectory)),
        ...(await readdir(archiveDirectory)),
      ].filter((entry) =>
        entry.startsWith(".ai-live-eval-") || entry.endsWith(".tmp")
      );
      expect(residualEntries).toEqual([]);
    } finally {
      await rm(sourceDirectory, { force: true, recursive: true });
      await rm(reportWorkspace, { force: true, recursive: true });
    }
  }, 30_000);
});
