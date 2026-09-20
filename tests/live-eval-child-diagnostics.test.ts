import { fork } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const workspace = process.cwd();
const runId = "11111111-1111-4111-8111-111111111111";
const reportReceipt = {
  byteLength: 256,
  evaluatedAt: "2026-09-13T12:00:00.000Z",
  runId,
  sha256: "a".repeat(64),
};
const diagnostic = {
  argsPassed: true,
  caseId: "single-country-market-profile",
  detectedResponseLocale: "en",
  expectedLocale: "en",
  matchedResponseAnchorIds: ["fact:country-chn"],
  missingResponseAnchorIds: ["decision:market-profile"],
  reportSha256: reportReceipt.sha256,
  responseDisposition: "answered",
  responseGroundingPassed: false,
  responseLocalePassed: true,
  responseText: "PUBLIC_DIAGNOSTIC_MARKER\n\u001b[31mquoted public text",
  runId,
  toolSelectionPassed: true,
};
const sourceDiagnostic = {
  caseId: "source-document-retrieval",
  reportSha256: reportReceipt.sha256,
  results: [{
    citationCount: 0, evidenceSufficient: false, ordinal: 0,
    searchResultCount: 0, status: "no_data", unknownWarningCount: 0,
    warningCodes: ["insufficient_evidence"],
  }],
  runId,
  statusCounts: { error: 0, no_data: 1, ok: 0 },
};
// This fixture deliberately exercises only the child's opaque transport, not
// provider execution or the independent receipt/sidecar verification contract.
const opaqueObservations = {
  reportText: "{}\n",
  receipt: {
    byteLength: 3,
    caseCount: 18,
    evaluatedAt: reportReceipt.evaluatedAt,
    runId,
    sha256: "b".repeat(64),
    version: "sales-chat-live-observations-v2",
  },
};

type AcknowledgmentMode = "valid" | "disconnect" | "invalid" | "timeout";
type Execution = {
  code: number | null;
  signal: NodeJS.Signals | null;
  safetyTimedOut: boolean;
  processExitedBeforeSafety: boolean;
  stdout: string;
  stderr: string;
  stdoutBeforeAcknowledgment: string;
  observerEnabled: boolean | null;
  providerBoundaryCount: number;
  persistedMessage: Record<string, unknown> | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function runChild(input: {
  acknowledgment?: AcknowledgmentMode;
  exitCode?: 0 | 1;
  flag?: string;
  observations?: typeof opaqueObservations | null;
  sinkThrows?: boolean;
  sourceDiagnostic?: boolean;
} = {}): Promise<Execution> {
  const directory = await mkdtemp(resolve(tmpdir(), "diesel-child-diagnostics-"));
  try {
    await symlink(resolve(workspace, "node_modules"), resolve(directory, "node_modules"), "dir");
    let source = await readFile(resolve(workspace, "scripts/ai/live-eval-child.ts"), "utf8");
    const replaceExactlyOnce = (before: string, after: string): void => {
      expect(source.split(before)).toHaveLength(2);
      source = source.replace(before, after);
    };
    // Keep the authored lifecycle intact; replace only the provider runner and
    // relocate real helper imports for this isolated, credential-free process.
    replaceExactlyOnce('from "./live-eval"', 'from "./runner-fixture.mjs"');
    for (const name of ["live-eval-error", "live-eval-diagnostics", "live-eval-source-diagnostics"]) {
      replaceExactlyOnce(`from "./${name}"`, `from ${JSON.stringify(
        pathToFileURL(resolve(workspace, `scripts/ai/${name}.ts`)).href,
      )}`);
    }
    if (input.acknowledgment === "timeout") {
      replaceExactlyOnce(
        "const REPORT_ACKNOWLEDGMENT_TIMEOUT_MS = 20_000;",
        "const REPORT_ACKNOWLEDGMENT_TIMEOUT_MS = 50;",
      );
    }
    await writeFile(resolve(directory, "child.ts"), source, "utf8");
    await writeFile(resolve(directory, "runner-fixture.mjs"), `
      export async function runLiveEval(options) {
        if (typeof process.send !== "function") throw new Error("Missing fixture IPC.");
        await options.onProviderMayStart();
        await options.onProviderMayStart();
        process.send({ type: "fixture_observer", enabled: typeof options.onFailedPublicResponse === "function" });
        options.onFailedPublicResponse?.(${JSON.stringify(diagnostic)});
        if (${String(input.sourceDiagnostic ?? false)}) options.onFailedSourceEvidence?.(${JSON.stringify(sourceDiagnostic)});
        if (${String(input.sinkThrows ?? false)}) {
          process.stdout.write = () => { throw new Error("PRIVATE_SINK_FAILURE_MARKER"); };
        }
        return ${JSON.stringify({
          observations: input.observations ?? null,
          reportReceipt,
        })};
      }
    `, "utf8");

    return await new Promise<Execution>((resolveExecution, rejectExecution) => {
      const child = fork(resolve(directory, "child.ts"), [], {
        cwd: directory,
        env: {
          NODE_ENV: "test",
          TSX_TSCONFIG_PATH: resolve(workspace, "tsconfig.json"),
          ...(input.flag === undefined ? {} : { DIESEL_LIVE_EVAL_DIAGNOSTICS: input.flag }),
        },
        execArgv: ["--conditions=react-server", "--import", pathToFileURL(require.resolve("tsx")).href],
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      let stdout = "";
      let stderr = "";
      let safetyTimedOut = false;
      let processExitedBeforeSafety = false;
      let stdoutBeforeAcknowledgment = "";
      let observerEnabled: boolean | null = null;
      let providerBoundaryCount = 0;
      let persistedMessage: Record<string, unknown> | null = null;
      let exit: { code: number | null; signal: NodeJS.Signals | null } | null = null;
      let stdoutEnded = child.stdout === null;
      let stderrEnded = child.stderr === null;
      let acknowledgmentTimer: ReturnType<typeof setTimeout> | undefined;
      const safetyTimer = setTimeout(() => {
        safetyTimedOut = true;
        child.kill("SIGKILL");
      }, 5_000);
      // Observe process termination and drained pipes directly. Manual IPC
      // disconnection need not produce a usable composite "close" event here.
      const settle = (): void => {
        if (exit === null || !stdoutEnded || !stderrEnded) return;
        clearTimeout(safetyTimer);
        clearTimeout(acknowledgmentTimer);
        resolveExecution({
          code: exit.code, signal: exit.signal, safetyTimedOut, processExitedBeforeSafety,
          stdout, stderr, stdoutBeforeAcknowledgment, observerEnabled,
          providerBoundaryCount, persistedMessage,
        });
      };
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => { stdout += chunk; });
      child.stderr?.on("data", (chunk: string) => { stderr += chunk; });
      child.stdout?.once("end", () => { stdoutEnded = true; settle(); });
      child.stderr?.once("end", () => { stderrEnded = true; settle(); });
      child.on("message", (message: unknown) => {
        if (!isRecord(message)) return;
        if (message.type === "fixture_observer") {
          observerEnabled = message.enabled === true;
          return;
        }
        if (message.type === "initialization_ready" || message.type === "provider_may_have_started") {
          if (message.type === "provider_may_have_started") providerBoundaryCount += 1;
          child.send({ type: "bootstrap_ack", messageId: message.messageId });
          return;
        }
        if (message.type !== "report_persisted") return;
        persistedMessage = message;
        acknowledgmentTimer = setTimeout(() => {
          stdoutBeforeAcknowledgment = stdout;
          if (input.acknowledgment === "timeout") return;
          if (input.acknowledgment === "disconnect") {
            child.disconnect();
            return;
          }
          if (input.acknowledgment === "invalid") {
            child.send({
              type: "bootstrap_ack",
              messageId: "22222222-2222-4222-8222-222222222222",
              exitCode: 0,
            }, () => child.disconnect());
            return;
          }
          child.send({ type: "bootstrap_ack", messageId: message.messageId, exitCode: input.exitCode ?? 1 });
        }, 25);
      });
      child.once("error", (error) => {
        clearTimeout(safetyTimer);
        clearTimeout(acknowledgmentTimer);
        rejectExecution(error);
      });
      child.once("exit", (code, signal) => {
        processExitedBeforeSafety = !safetyTimedOut;
        exit = { code, signal };
        settle();
      });
    });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

function expectUnchangedReceipt(execution: Execution, observations: typeof opaqueObservations | null = null): void {
  expect(execution.safetyTimedOut, JSON.stringify(execution)).toBe(false);
  expect(execution.processExitedBeforeSafety).toBe(true);
  expect(execution.signal).toBeNull();
  expect(execution.providerBoundaryCount, execution.stderr).toBe(1);
  expect(execution.persistedMessage).toEqual({
    messageId: expect.any(String), observations, protocolVersion: 2,
    reportReceipt, type: "report_persisted",
  });
  expect(JSON.stringify(execution.persistedMessage)).not.toContain("PUBLIC_DIAGNOSTIC_MARKER");
}

describe("live-eval child opt-in diagnostics lifecycle", () => {
  it.each([undefined, "", "1", "true", "PUBLIC-FAILURES", "public-failures "])(
    "does not register or print diagnostics for non-opt-in value %s", async (flag) => {
      const execution = await runChild({ flag, sourceDiagnostic: true });
      expectUnchangedReceipt(execution);
      expect(execution.observerEnabled).toBe(false);
      expect(execution.code).toBe(1);
      expect(execution.stdout).toBe("");
      expect(execution.stderr).toBe("");
    },
  );

  it.each([0, 1] as const)("prints escaped JSON only after ACK%d and preserves opaque transport", async (exitCode) => {
    const observations = exitCode === 0 ? opaqueObservations : null;
    const execution = await runChild({ flag: "public-failures", exitCode, observations });
    expectUnchangedReceipt(execution, observations);
    expect(execution.observerEnabled).toBe(true);
    expect(execution.stdoutBeforeAcknowledgment).toBe("");
    expect(execution.code).toBe(exitCode);
    expect(execution.stderr).toBe("");
    expect(execution.stdout).toBe(`${JSON.stringify({ type: "live_eval_failed_public_response", ...diagnostic })}\n`);
    expect(execution.stdout).not.toContain("\u001b");
    expect(JSON.parse(execution.stdout)).toEqual({ type: "live_eval_failed_public_response", ...diagnostic });
  });

  it.each(["disconnect", "invalid", "timeout"] as const)("withholds buffered public text after report acknowledgment %s", async (acknowledgment) => {
    const execution = await runChild({ flag: "public-failures", acknowledgment, sourceDiagnostic: true });
    expectUnchangedReceipt(execution);
    expect(execution.observerEnabled).toBe(true);
    expect(execution.code).toBe(1);
    expect(execution.stdoutBeforeAcknowledgment).toBe("");
    expect(execution.stdout).toBe("");
    expect(execution.stderr).toBe("Live eval report persistence failed (Error).\n");
    expect(execution.stderr).not.toContain("PUBLIC_DIAGNOSTIC_MARKER");
  }, 8_000);

  it.each([0, 1] as const)("does not replace ACK%d when the optional diagnostic sink throws", async (exitCode) => {
    const execution = await runChild({ flag: "public-failures", exitCode, sinkThrows: true, sourceDiagnostic: true });
    expectUnchangedReceipt(execution);
    expect(execution.observerEnabled).toBe(true);
    expect(execution.code).toBe(exitCode);
    expect(execution.stdout).toBe("");
    expect(execution.stderr).toBe("");
  });

  it("prints source counts only after ACK without adding them to the report IPC", async () => {
    const execution = await runChild({ flag: "public-failures", sourceDiagnostic: true });
    expectUnchangedReceipt(execution);
    expect(execution.code).toBe(1);
    expect(execution.stdoutBeforeAcknowledgment).toBe("");
    expect(execution.stdout.trimEnd().split("\n").map((line) => JSON.parse(line))).toEqual([
      { type: "live_eval_failed_public_response", ...diagnostic },
      { type: "live_eval_failed_source_evidence", ...sourceDiagnostic },
    ]);
    expect(execution.stderr).toBe("");
  });
});
