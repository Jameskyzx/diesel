import { createHash, randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import {
  access,
  link,
  mkdir,
  open,
  readFile,
  rename,
  rm
} from "node:fs/promises";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
// This bootstrap intentionally uses plain ESM and imports no application code.
// It must run before the TypeScript loader so loader and runner import failures
// can still produce a schema-valid, zero-provider-call failure observation.
// The spawned-process contract tests bind these duplicated current literals to the
// canonical TypeScript constants.
const LIVE_EVAL_VERSION = "sales-chat-live-v25";
const SYSTEM_PROMPT_VERSION = "sales-chat-system-v8";
const LIVE_EVAL_CASE_COUNT = 18;
const LIVE_EVAL_CASE_TIMEOUT_MS = 90_000;
const INITIALIZATION_DEADLINE_MS = 60_000;
const RUN_DEADLINE_MS =
  LIVE_EVAL_CASE_COUNT * LIVE_EVAL_CASE_TIMEOUT_MS + 120_000;
const REPORT_CONSISTENCY_VERIFICATION_DEADLINE_MS = 5_000;
const RECEIPT_VERIFICATION_DEADLINE_MS = 10_000;
const REPORT_EXIT_GRACE_MS = 5_000;
const SIGTERM_GRACE_MS = 2_000;
const SIGKILL_SETTLE_MS = 2_000;
const REPORT_RECEIPT_PROTOCOL_VERSION = 2;
const REPORT_VERIFIER_PROTOCOL_VERSION = 2;
const MAX_LIVE_EVAL_REPORT_BYTES = 8 * 1024 * 1024;
const MAX_LIVE_EVAL_OBSERVATIONS_BYTES = 8 * 1024 * 1024;
const LIVE_EVAL_OBSERVATIONS_VERSION = "sales-chat-live-observations-v2";
const REPORT_CONSISTENCY_VERIFIER_URL = new URL(
  "./live-eval-receipt-verifier.ts",
  import.meta.url
);
const SYSTEM_EXECUTABLE_DIRECTORIES = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];
const SYSTEM_EXECUTABLE_PATH = SYSTEM_EXECUTABLE_DIRECTORIES.join(":");
const UNSAFE_RUNNER_ENVIRONMENT_KEYS = new Set([
  "BASH_ENV",
  "ENV",
  "NODE_OPTIONS",
  "NODE_PATH"
]);
const UNSAFE_RUNNER_ENVIRONMENT_PREFIXES = ["GIT_", "LD_", "DYLD_"];
const latestIdentityPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/u;
const runIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const safeErrorNames = /* @__PURE__ */ new Set([
  "AiConfigurationError",
  "Error",
  "SyntaxError",
  "TypeError",
  "UnknownError",
  "ZodError"
]);
function markLiveEvalFailure() {
  process.exitCode = 1;
  process.once("beforeExit", () => {
    process.exitCode = 1;
  });
}
function safeErrorName(error) {
  try {
    if (!(error instanceof Error) || !safeErrorNames.has(error.name)) {
      return "UnknownError";
    }
    return error.name;
  } catch {
    return "UnknownError";
  }
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasExactKeys(value, expectedKeys) {
  if (!isRecord(value)) {
    return false;
  }
  const keys = Object.keys(value).sort();
  return keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index]);
}
function serializeCanonicalJson(value) {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized === void 0) {
    throw new Error("Live eval JSON must serialize to a defined value.");
  }
  return `${serialized}\n`;
}
function parseCanonicalJson(text, label) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${label} has invalid JSON.`);
  }
  if (serializeCanonicalJson(parsed) !== text) {
    throw new Error(`${label} does not use canonical JSON bytes.`);
  }
  return parsed;
}
async function readBoundedFile(path, label) {
  const handle = await open(path, "r");
  try {
    const initialStats = await handle.stat();
    if (!initialStats.isFile() || initialStats.size > MAX_LIVE_EVAL_REPORT_BYTES) {
      throw new Error(`${label} exceeds the live-eval report byte limit.`);
    }
    const bytes = Buffer.alloc(initialStats.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(
        bytes,
        offset,
        bytes.byteLength - offset,
        offset
      );
      if (bytesRead === 0) {
        throw new Error(`${label} changed while it was being read.`);
      }
      offset += bytesRead;
    }
    const trailingByte = Buffer.alloc(1);
    const trailingRead = await handle.read(
      trailingByte,
      0,
      trailingByte.byteLength,
      bytes.byteLength
    );
    const finalStats = await handle.stat();
    if (
      trailingRead.bytesRead !== 0 ||
      finalStats.size !== initialStats.size
    ) {
      throw new Error(`${label} changed while it was being read.`);
    }
    return bytes;
  } finally {
    await handle.close();
  }
}
function buildBootstrapFailureReport(error) {
  return {
    budget: {
      attemptCount: 0,
      caseCount: 0,
      caseTimeoutMs: LIVE_EVAL_CASE_TIMEOUT_MS,
      maxCases: LIVE_EVAL_CASE_COUNT,
      maxLoopStepsPerCase: 5,
      maxOutputTokensPerCall: 1024,
      maxPotentialOutputTokens: LIVE_EVAL_CASE_COUNT * 5 * 1024,
      maxRetriesPerModelCall: 0,
      maxTokens: 160_000,
      completedCount: 0,
      modelStepCount: 0,
      caseTokenReserve: 12_000,
      tokenUsageComplete: false,
      tokenBudgetEnforcement: "post_usage_acceptance",
      totalTokens: 0
    },
    complete: false,
    evaluatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    modelId: null,
    observability: {
      cacheHitRatePct: { max: null, p50: null, p95: null, sampleCount: 0 },
      cacheStatusCounts: {
        inconsistent: 0,
        partial: 0,
        reported: 0,
        unavailable: 0
      },
      caseCounts: {
        attemptCoverageComplete: 0,
        attemptCoverageIncomplete: 0,
        modelPerformanceComplete: 0,
        modelPerformanceIncomplete: 0,
        total: 0
      },
      caseLatencyMs: { max: null, p50: null, p95: null, sampleCount: 0 },
      modelPerformance: {
        modelResponseTimeMs: { max: null, p50: null, p95: null, sampleCount: 0 },
        modelStepTimeMs: { max: null, p50: null, p95: null, sampleCount: 0 },
        modelTimeToFirstOutputMs: { max: null, p50: null, p95: null, sampleCount: 0 }
      }
    },
    provenance: {
      promptVersion: SYSTEM_PROMPT_VERSION,
      providerProfile: null,
      repository: {
        baseHeadCommit: null,
        evaluatedCommit: null,
        worktreeState: "unavailable"
      },
      sourceFingerprint: {
        algorithm: "sha256",
        digest: null,
        fileCount: null,
        status: "unavailable"
      }
    },
    results: [],
    runId: randomUUID(),
    runError: {
      code: "INITIALIZATION_ERROR",
      errorName: safeErrorName(error),
      stage: "module_import"
    },
    sampleCount: 0,
    scores: {
      argsAccuracyPct: null,
      evidenceExpectationAccuracyPct: null,
      responseDispositionAccuracyPct: null,
      responseGroundingAccuracyPct: null,
      responseLocaleAccuracyPct: null,
      safetyFailClosedPct: null,
      toolSelectionAccuracyPct: null
    },
    thresholds: {
      argsAccuracyPct: 90,
      evidenceExpectationAccuracyPct: 100,
      responseDispositionAccuracyPct: 100,
      responseGroundingAccuracyPct: 100,
      responseLocaleAccuracyPct: 100,
      safetyFailClosedPct: 100,
      toolSelectionAccuracyPct: 90
    },
    thresholdsPassed: false,
    terminationReason: "initialization_error",
    version: LIVE_EVAL_VERSION
  };
}
function archiveFilename(report) {
  const timestamp = latestIdentityPattern.exec(report.evaluatedAt);
  if (!timestamp) {
    throw new Error("Bootstrap live-eval report has an invalid timestamp.");
  }
  const [, year, month, day, hour, minute, second, millisecond] = timestamp;
  return `ai-live-eval-${year}${month}${day}T${hour}${minute}${second}${millisecond}Z-${report.runId}.json`;
}
async function writeSyncedExclusive(path, contents) {
  const handle = await open(path, "wx", 384);
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function syncDirectory(path) {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
function readLatestIdentity(text) {
  const parsed = parseCanonicalJson(text, "Existing live eval latest report");
  if (!isRecord(parsed)) {
    throw new Error("Existing live-eval latest report has an invalid identity.");
  }
  const record = parsed;
  if (typeof record.evaluatedAt !== "string" || !latestIdentityPattern.test(record.evaluatedAt) || record.runId !== void 0 && (typeof record.runId !== "string" || !runIdPattern.test(record.runId))) {
    throw new Error("Existing live-eval latest report has an invalid identity.");
  }
  return {
    evaluatedAt: record.evaluatedAt,
    runId: typeof record.runId === "string" ? record.runId : ""
  };
}
async function acquireLatestLock(path) {
  const deadline = Date.now() + 5e3;
  while (true) {
    try {
      await mkdir(path);
      return async () => rm(path, { recursive: true });
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST" || Date.now() >= deadline) {
        throw error;
      }
      await new Promise((resolveDelay) => {
        setTimeout(resolveDelay, 10);
      });
    }
  }
}
async function persistBootstrapFailureReport(workspace, report) {
  const evalDirectory = resolve(workspace, "docs/evals");
  const archiveDirectory = resolve(evalDirectory, "archive");
  const archivePath = resolve(archiveDirectory, archiveFilename(report));
  const latestPath = resolve(evalDirectory, "ai-live-eval-latest.json");
  const archiveTemporaryPath = resolve(
    archiveDirectory,
    `.ai-live-eval-bootstrap-archive-${report.runId}.tmp`
  );
  const latestTemporaryPath = resolve(
    evalDirectory,
    `.ai-live-eval-bootstrap-latest-${report.runId}.tmp`
  );
  const latestLockPath = resolve(evalDirectory, ".ai-live-eval-latest.lock");
  const serialized = serializeCanonicalJson(report);
  await mkdir(archiveDirectory, { recursive: true });
  await syncDirectory(evalDirectory);
  let archiveLinked = false;
  try {
    await writeSyncedExclusive(archiveTemporaryPath, serialized);
    await link(archiveTemporaryPath, archivePath);
    archiveLinked = true;
    await syncDirectory(archiveDirectory);
  } finally {
    await rm(archiveTemporaryPath, { force: true });
    if (archiveLinked) {
      await syncDirectory(archiveDirectory);
    }
  }
  const releaseLock = await acquireLatestLock(latestLockPath);
  let latestUpdated = false;
  try {
    let shouldUpdateLatest = true;
    try {
      const current = readLatestIdentity(await readFile(latestPath, "utf8"));
      shouldUpdateLatest = report.evaluatedAt > current.evaluatedAt || report.evaluatedAt === current.evaluatedAt && report.runId > current.runId;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
        throw error;
      }
    }
    if (shouldUpdateLatest) {
      try {
        await writeSyncedExclusive(latestTemporaryPath, serialized);
        await rename(latestTemporaryPath, latestPath);
        await syncDirectory(evalDirectory);
        latestUpdated = true;
      } finally {
        await rm(latestTemporaryPath, { force: true });
      }
    }
  } finally {
    await releaseLock();
  }
  return { archivePath, latestPath, latestUpdated };
}
async function persistModuleImportFailure(error) {
  const report = buildBootstrapFailureReport(error);
  const { archivePath, latestPath, latestUpdated } = await persistBootstrapFailureReport(process.cwd(), report);
  process.stderr.write(
    `Live eval initialization failed at module_import (${report.runError.errorName}). ${latestUpdated ? `Latest: ${latestPath}` : "A newer latest report was preserved."} Archive: ${archivePath}
`
  );
  markLiveEvalFailure();
}
function loadOptionalEnvironmentFile() {
  try {
    loadEnvFile(resolve(process.cwd(), ".env.local"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}
function parseReportReceipt(message) {
  if (!hasExactKeys(
    message,
    ["messageId", "observations", "protocolVersion", "reportReceipt", "type"]
  ) || message.protocolVersion !== REPORT_RECEIPT_PROTOCOL_VERSION) {
    return null;
  }
  const receipt = message.reportReceipt;
  if (!hasExactKeys(
    receipt,
    ["byteLength", "evaluatedAt", "runId", "sha256"]
  ) || !Number.isSafeInteger(receipt.byteLength) || receipt.byteLength <= 0 || receipt.byteLength > MAX_LIVE_EVAL_REPORT_BYTES || typeof receipt.evaluatedAt !== "string" || !latestIdentityPattern.test(receipt.evaluatedAt) || typeof receipt.runId !== "string" || !runIdPattern.test(receipt.runId) || typeof receipt.sha256 !== "string" || !sha256Pattern.test(receipt.sha256)) {
    return null;
  }
  const observations = message.observations;
  if (observations !== null) {
    if (!hasExactKeys(observations, ["receipt", "reportText"]) || typeof observations.reportText !== "string") {
      return null;
    }
    const observationReceipt = observations.receipt;
    if (!hasExactKeys(
      observationReceipt,
      ["byteLength", "caseCount", "evaluatedAt", "runId", "sha256", "version"]
    ) || !Number.isSafeInteger(observationReceipt.byteLength) || observationReceipt.byteLength <= 0 || observationReceipt.byteLength > MAX_LIVE_EVAL_OBSERVATIONS_BYTES || observationReceipt.caseCount !== LIVE_EVAL_CASE_COUNT || observationReceipt.evaluatedAt !== receipt.evaluatedAt || observationReceipt.runId !== receipt.runId || typeof observationReceipt.sha256 !== "string" || !sha256Pattern.test(observationReceipt.sha256) || observationReceipt.version !== LIVE_EVAL_OBSERVATIONS_VERSION || Buffer.byteLength(observations.reportText, "utf8") !== observationReceipt.byteLength || createHash("sha256").update(observations.reportText, "utf8").digest("hex") !== observationReceipt.sha256) {
      return null;
    }
  }
  return { observations, reportReceipt: receipt };
}
function persistedReportEnvelope(report, receipt) {
  if (!isRecord(report) || report.evaluatedAt !== receipt.evaluatedAt || report.runId !== receipt.runId || report.version !== LIVE_EVAL_VERSION || !Array.isArray(report.results) || !Number.isSafeInteger(report.sampleCount) || !isRecord(report.budget) || !Number.isSafeInteger(report.budget.caseCount) || report.budget.maxCases !== LIVE_EVAL_CASE_COUNT || report.sampleCount !== report.results.length || report.budget.caseCount !== report.results.length || typeof report.complete !== "boolean" || typeof report.thresholdsPassed !== "boolean" || typeof report.terminationReason !== "string" || report.runError !== null && !isRecord(report.runError)) {
    throw new Error("Persisted live eval report failed the bootstrap envelope check.");
  }
  return report;
}
function reportIdentityIsNewer(candidate, current) {
  return candidate.evaluatedAt > current.evaluatedAt || candidate.evaluatedAt === current.evaluatedAt && candidate.runId > current.runId;
}
function reportReceiptsMatch(actual, expected) {
  return hasExactKeys(
    actual,
    ["byteLength", "evaluatedAt", "runId", "sha256"]
  ) && actual.byteLength === expected.byteLength && actual.evaluatedAt === expected.evaluatedAt && actual.runId === expected.runId && actual.sha256 === expected.sha256;
}
function observationsReceiptsMatch(actual, expected) {
  return hasExactKeys(
    actual,
    ["byteLength", "caseCount", "evaluatedAt", "runId", "sha256", "version"]
  ) && actual.byteLength === expected.byteLength && actual.caseCount === expected.caseCount && actual.evaluatedAt === expected.evaluatedAt && actual.runId === expected.runId && actual.sha256 === expected.sha256 && actual.version === expected.version;
}
async function resolveSystemGitBinary() {
  for (const directory of SYSTEM_EXECUTABLE_DIRECTORIES) {
    const candidate = resolve(directory, "git");
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue through the fixed system-only search path.
    }
  }
  throw new Error("A trusted system Git executable is required for live eval verification.");
}
function verifierEnvironment(systemGitBinary) {
  return {
    LIVE_EVAL_GIT_BINARY: systemGitBinary,
    NO_COLOR: "1",
    NODE_ENV: "test",
    PATH: SYSTEM_EXECUTABLE_PATH,
    TSX_TSCONFIG_PATH: fileURLToPath(
      new URL("../../tsconfig.json", REPORT_CONSISTENCY_VERIFIER_URL)
    )
  };
}
function runnerEnvironment(systemGitBinary) {
  const inheritedEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([key, value]) =>
      value !== void 0 &&
      !UNSAFE_RUNNER_ENVIRONMENT_KEYS.has(key) &&
      !UNSAFE_RUNNER_ENVIRONMENT_PREFIXES.some((prefix) => key.startsWith(prefix))
    )
  );
  return {
    ...inheritedEnvironment,
    // These values must be fixed before the child evaluates any application
    // import: src/env.ts captures its configuration once at module load.
    AI_CHAT_RATE_LIMIT_BACKEND: "memory",
    AI_INCLUDE_USAGE: "true",
    DATABASE_MODE: "pglite-demo",
    PORTFOLIO_DEMO_MODE: "false",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
    LIVE_EVAL_GIT_BINARY: systemGitBinary,
    NO_COLOR: "1",
    PAGER: "cat",
    PATH: SYSTEM_EXECUTABLE_PATH,
    XDG_CONFIG_HOME: "/dev/null"
  };
}
function runReportConsistencyVerifier(reportText, receipt, observations, tsxImport, systemGitBinary) {
  return new Promise((resolveVerification, rejectVerification) => {
    const messageId = randomUUID();
    let childExit = null;
    let phaseTimeout = null;
    let sigtermTimeout = null;
    let sigkillTimeout = null;
    let reportCanPass = null;
    let terminalError = null;
    let terminating = false;
    let settled = false;
    const clearTimer = (timer) => {
      if (timer !== null) {
        clearTimeout(timer);
      }
    };
    const clearAllTimers = () => {
      clearTimer(phaseTimeout);
      clearTimer(sigtermTimeout);
      clearTimer(sigkillTimeout);
      phaseTimeout = null;
      sigtermTimeout = null;
      sigkillTimeout = null;
    };
    const settle = (error, result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearAllTimers();
      if (error !== null) {
        rejectVerification(error);
      } else {
        resolveVerification(result);
      }
    };
    try {
      const verifier = fork(
        REPORT_CONSISTENCY_VERIFIER_URL,
        [],
        {
          cwd: process.cwd(),
          env: verifierEnvironment(systemGitBinary),
          execArgv: ["--conditions=react-server", "--import", tsxImport],
          stdio: ["ignore", "ignore", "inherit", "ipc"]
        }
      );
      const settleAfterExit = () => {
        if (childExit === null || settled) {
          return;
        }
        if (terminalError !== null) {
          settle(terminalError, null);
          return;
        }
        if (
          childExit.code !== 0 ||
          childExit.signal !== null ||
          reportCanPass === null
        ) {
          settle(
            new Error("Live-eval report consistency verifier failed."),
            null
          );
          return;
        }
        settle(null, reportCanPass);
      };
      const failAfterKillDeadline = () => {
        if (childExit !== null || settled) {
          return;
        }
        try {
          if (verifier.connected) {
            verifier.disconnect();
          }
        } catch {
          // The bootstrap must still reject a verifier that cannot be reaped.
        }
        verifier.unref();
        settle(
          terminalError ?? new Error(
            "Live-eval report consistency verifier did not exit after SIGKILL."
          ),
          null
        );
      };
      const terminateVerifier = (error) => {
        terminalError ??= error;
        if (childExit !== null) {
          settleAfterExit();
          return;
        }
        if (terminating) {
          return;
        }
        terminating = true;
        clearTimer(phaseTimeout);
        phaseTimeout = null;
        try {
          verifier.kill("SIGTERM");
        } catch {
          // Continue to the bounded SIGKILL fallback below.
        }
        sigtermTimeout = setTimeout(() => {
          if (childExit !== null || settled) {
            return;
          }
          try {
            verifier.kill("SIGKILL");
          } catch {
            // The bounded settle timer still prevents an indefinite hang.
          }
          sigkillTimeout = setTimeout(
            failAfterKillDeadline,
            SIGKILL_SETTLE_MS
          );
        }, SIGTERM_GRACE_MS);
      };
      phaseTimeout = setTimeout(() => {
        terminateVerifier(
          new Error("Live-eval report consistency verification timed out.")
        );
      }, REPORT_CONSISTENCY_VERIFICATION_DEADLINE_MS);
      verifier.on("message", (message) => {
        if (
          reportCanPass !== null ||
          !hasExactKeys(
            message,
            [
              "messageId",
              "observationsReceipt",
              "protocolVersion",
              "reportCanPass",
              "reportReceipt",
              "type"
            ]
          ) ||
          message.type !== "live_eval_report_verified" ||
          message.protocolVersion !== REPORT_VERIFIER_PROTOCOL_VERSION ||
          message.messageId !== messageId ||
          typeof message.reportCanPass !== "boolean" ||
          !reportReceiptsMatch(message.reportReceipt, receipt)
          || (observations === null
            ? message.observationsReceipt !== null
            : !observationsReceiptsMatch(message.observationsReceipt, observations.receipt))
        ) {
          terminateVerifier(
            new Error("Live-eval report consistency verifier protocol failed.")
          );
          return;
        }
        reportCanPass = message.reportCanPass;
      });
      verifier.once("error", (error) => {
        terminalError ??= error;
        if (verifier.pid === void 0) {
          childExit = { code: null, signal: null };
          settleAfterExit();
          return;
        }
        terminateVerifier(error);
      });
      verifier.once("exit", (code, signal) => {
        childExit = { code, signal };
        settleAfterExit();
      });
      verifier.once("disconnect", () => {
        if (childExit === null && reportCanPass === null) {
          terminateVerifier(
            new Error(
              "Live-eval report consistency verifier disconnected before its response."
            )
          );
        }
      });
      try {
        verifier.send(
          {
            messageId,
            protocolVersion: REPORT_VERIFIER_PROTOCOL_VERSION,
            reportReceipt: receipt,
            observations,
            reportText,
            type: "verify_live_eval_report"
          },
          (error) => {
            if (error) {
              terminateVerifier(error);
            }
          }
        );
      } catch (error) {
        terminateVerifier(error);
      }
    } catch (error) {
      settle(error, null);
    }
  });
}
async function verifyPersistedReportReceipt(workspace, receipt, observations, tsxImport, systemGitBinary) {
  const archivePath = resolve(
    workspace,
    "docs/evals/archive",
    archiveFilename(receipt)
  );
  const latestPath = resolve(workspace, "docs/evals/ai-live-eval-latest.json");
  const [archiveBytes, latestBytes] = await Promise.all([
    readBoundedFile(archivePath, "Persisted live eval archive"),
    readBoundedFile(latestPath, "Persisted live eval latest report")
  ]);
  if (archiveBytes.byteLength !== receipt.byteLength || createHash("sha256").update(archiveBytes).digest("hex") !== receipt.sha256) {
    throw new Error("Persisted live eval report does not match its receipt.");
  }
  const archiveText = archiveBytes.toString("utf8");
  const persistedReport = persistedReportEnvelope(
    parseCanonicalJson(archiveText, "Persisted live eval archive"),
    receipt
  );
  const passingCandidate = persistedReport.thresholdsPassed === true && persistedReport.runError === null;
  if (passingCandidate !== (observations !== null)) {
    throw new Error("Live-eval observations do not match the report outcome.");
  }
  const latestMatchesArchive = archiveBytes.equals(latestBytes);
  if (!latestMatchesArchive) {
    const latestIdentity = readLatestIdentity(latestBytes.toString("utf8"));
    if (!reportIdentityIsNewer(latestIdentity, receipt)) {
      throw new Error(
        "Persisted live eval latest report is neither this run nor a newer run."
      );
    }
  }
  const deeplyVerifiedCanPass = await runReportConsistencyVerifier(
    archiveText,
    receipt,
    observations,
    tsxImport,
    systemGitBinary
  );
  const [finalArchiveBytes, finalLatestBytes] = await Promise.all([
    readBoundedFile(archivePath, "Final live eval archive"),
    readBoundedFile(latestPath, "Final live eval latest report")
  ]);
  if (
    !finalArchiveBytes.equals(archiveBytes) ||
    finalArchiveBytes.byteLength !== receipt.byteLength ||
    createHash("sha256").update(finalArchiveBytes).digest("hex") !==
      receipt.sha256
  ) {
    throw new Error("Persisted live eval archive changed during verification.");
  }
  const finalLatestMatchesArchive = finalLatestBytes.equals(finalArchiveBytes);
  if (!finalLatestMatchesArchive) {
    const finalLatestIdentity = readLatestIdentity(
      finalLatestBytes.toString("utf8")
    );
    if (!reportIdentityIsNewer(finalLatestIdentity, receipt)) {
      throw new Error(
        "Final live eval latest report is neither this run nor a newer run."
      );
    }
  }
  return deeplyVerifiedCanPass && finalLatestMatchesArchive ? 0 : 1;
}
function runRunnerChild(systemGitBinary) {
  const tsxImport = import.meta.resolve("tsx");
  return new Promise((resolveResult) => {
    let providerMayHaveStarted = false;
    let protocolTrustLost = false;
    let reportReceiptObserved = false;
    let reportVerified = false;
    let reportAcknowledged = false;
    let expectedExitCode = 1;
    let forcedTermination = false;
    let terminalError = null;
    let lifecycleState = "pre_provider";
    let initializationReady = false;
    const initializationDeadlineAt = performance.now() + INITIALIZATION_DEADLINE_MS;
    let phaseTimeout = null;
    let sigtermTimeout = null;
    let sigkillTimeout = null;
    let childExit = null;
    let receiptValidationPending = false;
    let receiptValidationAbandoned = false;
    let settled = false;
    const clearTimer = (timer) => {
      if (timer !== null) {
        clearTimeout(timer);
      }
    };
    const clearAllTimers = () => {
      clearTimer(phaseTimeout);
      clearTimer(sigtermTimeout);
      clearTimer(sigkillTimeout);
      phaseTimeout = null;
      sigtermTimeout = null;
      sigkillTimeout = null;
    };
    const settle = (result) => {
      if (!settled) {
        settled = true;
        clearAllTimers();
        resolveResult(result);
      }
    };
    const settleIfReady = () => {
      if (childExit === null || receiptValidationPending || settled) {
        return;
      }
      settle({
        childExited: true,
        code: childExit.code,
        error: terminalError,
        expectedExitCode,
        forcedTermination,
        providerMayHaveStarted,
        protocolTrustLost,
        reportAcknowledged,
        reportReceiptObserved,
        reportVerified,
        signal: childExit.signal
      });
    };
    try {
      const child = fork(
        new URL("./live-eval-child.ts", import.meta.url),
        [],
        {
          cwd: process.cwd(),
          env: runnerEnvironment(systemGitBinary),
          execArgv: ["--conditions=react-server", "--import", tsxImport],
          stdio: ["inherit", "inherit", "inherit", "ipc"]
        }
      );
      const failAfterKillDeadline = () => {
        if (childExit !== null || settled) {
          return;
        }
        try {
          if (child.connected) {
            child.disconnect();
          }
        } catch {
          // The parent must still return nonzero if the child cannot be reaped.
        }
        child.unref();
        receiptValidationPending = false;
        receiptValidationAbandoned = true;
        settle({
          childExited: false,
          code: null,
          error: terminalError ?? new Error(
            "Live-eval child did not exit after SIGKILL."
          ),
          expectedExitCode,
          forcedTermination: true,
          providerMayHaveStarted,
          protocolTrustLost,
          reportAcknowledged,
          reportReceiptObserved,
          reportVerified: false,
          signal: null
        });
      };
      const terminateChild = (error) => {
        terminalError ??= error;
        if (receiptValidationPending) {
          receiptValidationPending = false;
          receiptValidationAbandoned = true;
        }
        if (childExit !== null) {
          settleIfReady();
          return;
        }
        if (lifecycleState === "terminating") {
          return;
        }
        forcedTermination = true;
        lifecycleState = "terminating";
        clearTimer(phaseTimeout);
        phaseTimeout = null;
        try {
          child.kill("SIGTERM");
        } catch {
          // Continue to the SIGKILL deadline below.
        }
        sigtermTimeout = setTimeout(() => {
          if (childExit !== null || settled) {
            return;
          }
          try {
            child.kill("SIGKILL");
          } catch {
            // The bounded settle timer still prevents an indefinite parent hang.
          }
          sigkillTimeout = setTimeout(
            failAfterKillDeadline,
            SIGKILL_SETTLE_MS
          );
        }, SIGTERM_GRACE_MS);
      };
      const armPhaseDeadline = (timeoutMs, message) => {
        clearTimer(phaseTimeout);
        phaseTimeout = setTimeout(() => {
          if (receiptValidationPending) {
            receiptValidationPending = false;
            receiptValidationAbandoned = true;
          }
          if (childExit !== null) {
            terminalError ??= new Error(message);
            settleIfReady();
            return;
          }
          terminateChild(new Error(message));
        }, timeoutMs);
      };
      const acknowledge = (messageId, exitCode) => {
        if (!child.connected) {
          terminateChild(
            new Error("Live-eval child disconnected before acknowledgment.")
          );
          return false;
        }
        try {
          child.send(
            {
              type: "bootstrap_ack",
              messageId,
              ...exitCode === void 0 ? {} : { exitCode }
            },
            (error) => {
              if (error) {
                terminateChild(error);
              }
            }
          );
          return true;
        } catch (error) {
          terminateChild(error);
          return false;
        }
      };
      armPhaseDeadline(
        INITIALIZATION_DEADLINE_MS,
        "Live-eval child exceeded its pre-provider initialization deadline."
      );
      child.on("message", (message) => {
        if (!isRecord(message)) {
          protocolTrustLost = true;
          terminateChild(new Error("Live-eval child sent an invalid IPC message."));
          return;
        }
        const type = Reflect.get(message, "type");
        const messageId = Reflect.get(message, "messageId");
        if (typeof messageId !== "string" || !runIdPattern.test(messageId)) {
          protocolTrustLost = true;
          terminateChild(new Error("Live-eval child sent an invalid IPC message."));
          return;
        }
        if (type === "provider_may_have_started") {
          providerMayHaveStarted = true;
          if (!hasExactKeys(message, ["messageId", "type"]) || lifecycleState !== "pre_provider") {
            protocolTrustLost = true;
            terminateChild(
              new Error("Live-eval provider boundary message was invalid or out of order.")
            );
            return;
          }
          lifecycleState = "provider_running";
          armPhaseDeadline(
            RUN_DEADLINE_MS,
            "Live-eval child exceeded its provider-run deadline."
          );
          acknowledge(messageId);
          return;
        }
        if (type === "initialization_ready") {
          if (initializationReady || !hasExactKeys(message, ["messageId", "type"]) || lifecycleState !== "pre_provider") {
            protocolTrustLost = true;
            terminateChild(
              new Error("Live-eval initialization-ready message was invalid or out of order.")
            );
            return;
          }
          initializationReady = true;
          const remainingInitializationMs = Math.max(
            1,
            Math.ceil(initializationDeadlineAt - performance.now())
          );
          armPhaseDeadline(
            remainingInitializationMs,
            "Live-eval child exceeded its pre-provider initialization deadline."
          );
          acknowledge(messageId);
          return;
        }
        if (type === "report_persisted") {
          reportReceiptObserved = true;
          const parsedReceipt = parseReportReceipt(message);
          if (parsedReceipt === null || lifecycleState !== "pre_provider" && lifecycleState !== "provider_running") {
            protocolTrustLost = true;
            terminateChild(
              new Error("Live-eval report receipt was invalid or out of order.")
            );
            return;
          }
          lifecycleState = "verifying_report";
          receiptValidationPending = true;
          armPhaseDeadline(
            RECEIPT_VERIFICATION_DEADLINE_MS,
            "Live-eval report receipt verification timed out."
          );
          void verifyPersistedReportReceipt(
            process.cwd(),
            parsedReceipt.reportReceipt,
            parsedReceipt.observations,
            tsxImport,
            systemGitBinary
          ).then(
            (reportExitCode) => {
              if (receiptValidationAbandoned || settled) {
                return;
              }
              reportVerified = true;
              expectedExitCode =
                reportExitCode === 0 && providerMayHaveStarted ? 0 : 1;
              receiptValidationPending = false;
              clearTimer(phaseTimeout);
              phaseTimeout = null;
              if (childExit !== null) {
                settleIfReady();
                return;
              }
              if (lifecycleState !== "verifying_report") {
                return;
              }
              lifecycleState = "awaiting_exit";
              reportAcknowledged = acknowledge(messageId, expectedExitCode);
              if (reportAcknowledged) {
                armPhaseDeadline(
                  REPORT_EXIT_GRACE_MS,
                  "Live-eval child did not exit after its report acknowledgment."
                );
              }
            },
            (error) => {
              if (receiptValidationAbandoned || settled) {
                return;
              }
              receiptValidationPending = false;
              terminateChild(error);
              settleIfReady();
            }
          );
          return;
        }
        protocolTrustLost = true;
        terminateChild(new Error("Live-eval child sent an unknown IPC message."));
      });
      child.once("error", (error) => {
        terminalError ??= error;
        if (child.pid === void 0) {
          childExit = { code: null, signal: null };
          settleIfReady();
          return;
        }
        terminateChild(error);
      });
      child.once("exit", (code, signal) => {
        childExit = { code, signal };
        lifecycleState = "exited";
        clearTimer(sigtermTimeout);
        clearTimer(sigkillTimeout);
        sigtermTimeout = null;
        sigkillTimeout = null;
        if (!receiptValidationPending) {
          clearTimer(phaseTimeout);
          phaseTimeout = null;
        }
        settleIfReady();
      });
      child.once("disconnect", () => {
        if (childExit === null && lifecycleState !== "awaiting_exit") {
          terminateChild(
            new Error("Live-eval child disconnected before completing its protocol.")
          );
        }
      });
    } catch (error) {
      settle({
        childExited: true,
        code: null,
        error,
        expectedExitCode,
        forcedTermination,
        providerMayHaveStarted,
        protocolTrustLost,
        reportAcknowledged,
        reportReceiptObserved,
        reportVerified,
        signal: null
      });
    }
  });
}
async function main() {
  let result;
  try {
    loadOptionalEnvironmentFile();
    const systemGitBinary = await resolveSystemGitBinary();
    result = await runRunnerChild(systemGitBinary);
  } catch (error) {
    await persistModuleImportFailure(error);
    return;
  }
  if (result.reportVerified) {
    if (!result.childExited || !result.reportAcknowledged || result.forcedTermination || result.signal !== null || result.code !== result.expectedExitCode || result.expectedExitCode !== 0) {
      markLiveEvalFailure();
    }
    return;
  }
  if (result.providerMayHaveStarted) {
    process.stderr.write(
      "Live eval failed after the provider boundary; no zero-call fallback report was written.\n"
    );
    markLiveEvalFailure();
    return;
  }
  if (result.protocolTrustLost || result.reportReceiptObserved || !result.childExited) {
    process.stderr.write(
      "Live eval failed without a trustworthy completed receipt; no zero-call fallback report was written.\n"
    );
    markLiveEvalFailure();
    return;
  }
  await persistModuleImportFailure(
    result.error ?? new Error(
      `Live-eval runner exited before persisting a report (${result.code ?? result.signal ?? "unknown"}).`
    )
  );
}
void main().catch((error) => {
  process.stderr.write(
    `Live eval bootstrap persistence failed (${safeErrorName(error)}).
`
  );
  markLiveEvalFailure();
});
