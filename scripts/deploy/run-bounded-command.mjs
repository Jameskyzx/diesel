#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { constants as osConstants } from "node:os";
import { fileURLToPath } from "node:url";

const EXIT_USAGE = 64;
const EXIT_TIMEOUT = 124;
const EXIT_OUTPUT_LIMIT = 125;
const EXIT_INTERNAL = 126;
const MAX_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_KILL_GRACE_MS = 30 * 1000;
const MAX_CAPTURE_BYTES = 16 * 1024 * 1024;
const MAX_STDIN_BYTES = 256 * 1024;
const PROCESS_GROUP_INVENTORY_MAX_BYTES = 1024 * 1024;
const PROCESS_GROUP_INVENTORY_TIMEOUT_MS = 5_000;
const GROUP_POLL_INTERVAL_MS = 20;
const completionReceiptPathVariable =
  "DIESEL_BOUNDED_COMMAND_COMPLETION_RECEIPT_PATH";
const completionReceiptTokenVariable =
  "DIESEL_BOUNDED_COMMAND_COMPLETION_RECEIPT_TOKEN";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const capabilityModeFlag = "--check-process-group-inventory-v1";
const capabilityProbeModeFlag = "--process-group-inventory-probe-v1";
const capabilitySuccess =
  "bounded-command-v2:process-group-inventory-ok\n";
const guardianModeFlag = "--bounded-command-guardian-v1";
const guardianSignals = new Set(["SIGHUP", "SIGINT", "SIGTERM"]);
const supervisorSignals = [
  ["SIGHUP", 129],
  ["SIGINT", 130],
  ["SIGTERM", 143],
];
let activeSupervisorSignalHandler;
let queuedSupervisorSignal;

function installSupervisorSignalBridge() {
  for (const [signal, exitCode] of supervisorSignals) {
    process.on(signal, () => {
      if (activeSupervisorSignalHandler !== undefined) {
        activeSupervisorSignalHandler(exitCode, signal);
        return;
      }
      queuedSupervisorSignal ??= { exitCode, signal };
    });
  }
}

function activateSupervisorSignalHandler(handler) {
  activeSupervisorSignalHandler = handler;
  if (queuedSupervisorSignal !== undefined) {
    const pending = queuedSupervisorSignal;
    queuedSupervisorSignal = undefined;
    handler(pending.exitCode, pending.signal);
  }
}

function failUsage() {
  process.stderr.write(
    "usage: run-bounded-command.mjs <timeout-ms> <kill-grace-ms> " +
      "<max-stdout-bytes> <max-stderr-bytes> <stdin-path|-> " +
      "<stdout-path> <stderr-path> -- <absolute-command> [args...]\n",
  );
  process.exit(EXIT_USAGE);
}

function failEarlyInternal(reason, descriptors = []) {
  for (const descriptor of descriptors) {
    if (descriptor === undefined) continue;
    try {
      closeSync(descriptor);
    } catch {
      // Preserve the fixed diagnostic even when descriptor cleanup fails.
    }
  }
  try {
    writeSync(2, `bounded-command-v2:${reason}\n`);
  } catch {
    // There is no safe secondary reporting channel during bootstrap failure.
  }
  process.exit(EXIT_INTERNAL);
}

function sendGuardianMessage(message, callback = undefined) {
  if (typeof process.send !== "function") {
    callback?.(new Error("guardian IPC is unavailable"));
    return;
  }
  try {
    process.send(message, callback);
  } catch (error) {
    callback?.(error);
  }
}

function parseProcessGroupInventory(bytes, groupLeaderPid, inspectorPid) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("process-group inventory was not UTF-8");
  }
  if (
    text.includes("\0") ||
    text.includes("\r") ||
    !Number.isSafeInteger(groupLeaderPid) ||
    groupLeaderPid <= 0 ||
    !Number.isSafeInteger(inspectorPid) ||
    inspectorPid <= 0 ||
    inspectorPid === groupLeaderPid
  ) {
    throw new Error("process-group inventory was malformed");
  }
  const rows = text.trim().length === 0 ? [] : text.trim().split("\n");
  const seenPids = new Set();
  let residualGroup = false;
  let guardianSeen = false;
  let inspectorSeen = false;
  for (const row of rows) {
    // Linux kernel threads legitimately have PGID 0. They cannot match the
    // positive guardian PGID, and neither sentinel may belong to group zero.
    const match = /^\s*([1-9][0-9]*)\s+(0|[1-9][0-9]*)\s*$/u.exec(row);
    if (match === null) {
      throw new Error("process-group inventory was malformed");
    }
    const pid = Number(match[1]);
    const pgid = Number(match[2]);
    if (
      !Number.isSafeInteger(pid) ||
      !Number.isSafeInteger(pgid) ||
      seenPids.has(pid)
    ) {
      throw new Error("process-group inventory was malformed");
    }
    seenPids.add(pid);
    if (pid === groupLeaderPid && pgid === groupLeaderPid) guardianSeen = true;
    if (pid === inspectorPid && pgid === groupLeaderPid) inspectorSeen = true;
    if (
      pgid === groupLeaderPid &&
      pid !== groupLeaderPid &&
      pid !== inspectorPid
    ) {
      residualGroup = true;
    }
  }
  if (!guardianSeen || !inspectorSeen) {
    throw new Error("process-group inventory omitted its sentinels");
  }
  return residualGroup;
}

function inspectCurrentProcessGroup(callback) {
  let inspector;
  const chunks = [];
  let byteLength = 0;
  let failure;
  let settled = false;
  let inventoryTimer;
  const finish = (error, residualGroup = false) => {
    if (settled) return;
    settled = true;
    if (inventoryTimer) clearTimeout(inventoryTimer);
    callback(error, residualGroup);
  };
  const failAndStopInspector = (error) => {
    failure ??= error;
    if (inspector && inspector.exitCode === null && inspector.signalCode === null) {
      // The inspector is still an unreaped direct child, so a positive-PID
      // SIGKILL cannot race PID reuse.
      try {
        inspector.kill("SIGKILL");
      } catch {
        failure = new AggregateError(
          [failure, new Error("process-group inspector could not be stopped")],
          "process-group inventory and inspector cleanup failed",
        );
      }
    }
  };
  try {
    inspector = spawn("/bin/ps", ["-axo", "pid=,pgid="], {
      detached: false,
      env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" },
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (error) {
    finish(error);
    return;
  }
  const inspectorPid = inspector.pid;
  if (!Number.isSafeInteger(inspectorPid) || inspectorPid <= 0) {
    failAndStopInspector(new Error("process-group inspector has no stable PID"));
  }
  inventoryTimer = setTimeout(() => {
    failAndStopInspector(new Error("process-group inventory timed out"));
  }, PROCESS_GROUP_INVENTORY_TIMEOUT_MS);
  inspector.stdout.on("data", (chunk) => {
    byteLength += chunk.byteLength;
    if (byteLength > PROCESS_GROUP_INVENTORY_MAX_BYTES) {
      inspector.stdout.destroy();
      failAndStopInspector(
        new Error("process-group inventory exceeded its bound"),
      );
      return;
    }
    chunks.push(chunk);
  });
  inspector.stdout.once("error", (error) => {
    failAndStopInspector(error);
  });
  inspector.once("error", (error) => {
    failAndStopInspector(error);
  });
  inspector.once("close", (code, signal) => {
    if (failure !== undefined) {
      finish(failure);
      return;
    }
    if (code !== 0 || signal !== null) {
      finish(new Error("process-group inventory did not exit normally"));
      return;
    }
    try {
      finish(
        undefined,
        parseProcessGroupInventory(
          Buffer.concat(chunks),
          process.pid,
          inspectorPid,
        ),
      );
    } catch (error) {
      finish(error);
    }
  });
}

function runProcessGroupInventoryCapabilityProbe() {
  if (process.argv.length !== 3) failEarlyInternal("process-group-capability");
  inspectCurrentProcessGroup((error, residualGroup) => {
    if (error !== undefined || residualGroup) {
      failEarlyInternal("process-group-capability");
    }
    try {
      writeSync(1, capabilitySuccess);
    } catch {
      failEarlyInternal("process-group-capability");
    }
    process.exit(0);
  });
}

function runProcessGroupInventoryCapabilityCheck(onSuccess) {
  let probe;
  try {
    const probeEnvironment = { ...process.env };
    delete probeEnvironment[completionReceiptPathVariable];
    delete probeEnvironment[completionReceiptTokenVariable];
    delete probeEnvironment.NODE_CHANNEL_FD;
    probe = spawn(
      process.execPath,
      [fileURLToPath(import.meta.url), capabilityProbeModeFlag],
      {
        detached: true,
        env: probeEnvironment,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch {
    failEarlyInternal("process-group-capability");
  }
  const stdout = [];
  const stderr = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let failed = false;
  let settled = false;
  const stopProbe = () => {
    failed = true;
    if (probe.exitCode === null && probe.signalCode === null) {
      // The detached probe is still an unreaped direct child. A positive-PID
      // kill is identity-safe and does not signal the probe's whole group.
      try {
        probe.kill("SIGKILL");
      } catch {
        // The final close/status validation remains fail-closed.
      }
    }
  };
  const timer = setTimeout(stopProbe, PROCESS_GROUP_INVENTORY_TIMEOUT_MS * 2);
  probe.stdout.on("data", (chunk) => {
    stdoutBytes += chunk.byteLength;
    if (stdoutBytes > capabilitySuccess.length) {
      probe.stdout.destroy();
      stopProbe();
      return;
    }
    stdout.push(chunk);
  });
  probe.stderr.on("data", (chunk) => {
    stderrBytes += chunk.byteLength;
    if (stderrBytes > 256) {
      probe.stderr.destroy();
      stopProbe();
      return;
    }
    stderr.push(chunk);
  });
  probe.stdout.once("error", stopProbe);
  probe.stderr.once("error", stopProbe);
  probe.once("error", stopProbe);
  probe.once("close", (code, signal) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    const output = Buffer.concat(stdout).toString("utf8");
    const diagnostic = Buffer.concat(stderr).toString("utf8");
    if (
      failed ||
      code !== 0 ||
      signal !== null ||
      output !== capabilitySuccess ||
      diagnostic !== ""
    ) {
      failEarlyInternal("process-group-capability");
    }
    onSuccess();
  });
}

function runGuardian(token, command, commandArgs) {
  if (
    typeof process.send !== "function" ||
    !uuidPattern.test(token ?? "") ||
    !command?.startsWith("/") ||
    /[\u0000-\u001f\u007f]/u.test(command)
  ) {
    failEarlyInternal("guardian-bootstrap");
  }

  let workload;
  let finalKillRequested = false;
  let workloadTerminalSent = false;
  let outboundSequence = 0;
  let expectedControlSequence = 1;
  let inventoryPending = false;
  const deferredSignals = new Set();

  const send = (message, callback = undefined) => {
    outboundSequence += 1;
    sendGuardianMessage(
      { ...message, sequence: outboundSequence, token },
      callback,
    );
  };
  const killAnchoredGroup = (signal) => {
    try {
      // This live detached process is the group leader. Every mutating
      // negative-PGID signal originates here, so its PID cannot have been
      // reaped and reused between an outside identity check and killpg().
      process.kill(-process.pid, signal);
      return true;
    } catch {
      send({ reason: "guardian-group-signal", type: "failure" });
      return false;
    }
  };
  const inspectResidualGroup = (callback) => {
    inventoryPending = true;
    inspectCurrentProcessGroup((error, residualGroup) => {
      inventoryPending = false;
      // The same-group inspector is now closed. Forward queued signals before
      // its terminal record, so a genuine signal failure still wins over exit.
      if (!finalKillRequested) {
        for (const signal of deferredSignals) killAnchoredGroup(signal);
      }
      deferredSignals.clear();
      callback(error, residualGroup);
    });
  };

  for (const signal of guardianSignals) {
    process.on(signal, () => {
      // A forwarded signal reaches the guardian too. Keep the identity anchor
      // alive until the one final self-inclusive SIGKILL seals the group.
    });
  }

  process.on("message", (message) => {
    if (
      typeof message !== "object" ||
      message === null ||
      !("type" in message) ||
      !("token" in message) ||
      !("sequence" in message) ||
      message.token !== token ||
      message.sequence !== expectedControlSequence
    ) {
      send({ reason: "guardian-control", type: "failure" });
      return;
    }
    expectedControlSequence += 1;
    if (
      message.type === "signal" &&
      "signal" in message &&
      typeof message.signal === "string" &&
      guardianSignals.has(message.signal)
    ) {
      if (!finalKillRequested) {
        if (inventoryPending) {
          // Killing our own inspector would turn a valid overflow/timeout into
          // an inventory error. The set is bounded by the three allowed signals.
          // Final seal is never queued and retains the caller's kill deadline.
          deferredSignals.add(message.signal);
        } else {
          killAnchoredGroup(message.signal);
        }
      }
      return;
    }
    if (message.type === "seal") {
      if (finalKillRequested) return;
      finalKillRequested = true;
      // This is deliberately the last mutating negative-PGID operation. It
      // includes the guardian, so no later code can signal this group number.
      killAnchoredGroup("SIGKILL");
      return;
    }
    send({ reason: "guardian-control", type: "failure" });
  });

  process.once("disconnect", () => {
    if (!finalKillRequested) {
      finalKillRequested = true;
      killAnchoredGroup("SIGKILL");
    }
  });

  const childEnvironment = { ...process.env };
  delete childEnvironment[completionReceiptPathVariable];
  delete childEnvironment[completionReceiptTokenVariable];
  delete childEnvironment.NODE_CHANNEL_FD;
  delete childEnvironment.NODE_OPTIONS;

  try {
    workload = spawn(command, commandArgs, {
      detached: false,
      env: childEnvironment,
      // Workload stdout/stderr write to the guardian's private pipes directly.
      // The IPC descriptor is omitted and is not exposed to the workload.
      stdio: ["pipe", "inherit", "inherit"],
    });
  } catch {
    send({ reason: "workload-spawn", type: "failure" }, () => {
      if (!finalKillRequested) {
        finalKillRequested = true;
        killAnchoredGroup("SIGKILL");
      }
    });
    return;
  }

  workload.once("error", () => {
    send({ reason: "workload-error", type: "failure" });
  });
  workload.once("close", (code, signal) => {
    if (workloadTerminalSent) return;
    workloadTerminalSent = true;
    inspectResidualGroup((error, residualGroup) => {
      if (error) {
        send({ reason: "group-inventory", type: "failure" });
        return;
      }
      send({ code, residualGroup, signal, type: "workload-terminal" });
    });
  });
  workload.stdin.on("error", (error) => {
    if (error?.code !== "EPIPE") {
      send({ reason: "workload-stdin", type: "failure" });
    }
  });
  process.stdin.on("error", () => {
    send({ reason: "guardian-stdin", type: "failure" });
  });
  process.stdin.pipe(workload.stdin);
  send({ type: "ready" }, (error) => {
    if (error && !finalKillRequested) {
      finalKillRequested = true;
      killAnchoredGroup("SIGKILL");
    }
  });
}

if (process.argv[2] === capabilityProbeModeFlag) {
  runProcessGroupInventoryCapabilityProbe();
} else if (process.argv[2] === guardianModeFlag) {
  runGuardian(process.argv[3], process.argv[4], process.argv.slice(5));
} else if (process.argv[2] === capabilityModeFlag) {
  if (process.argv.length !== 3) failUsage();
  runProcessGroupInventoryCapabilityCheck(() => {
    try {
      writeSync(1, capabilitySuccess);
    } catch {
      failEarlyInternal("process-group-capability");
    }
  });
} else {
  // Every caller gets the same detached-leader + same-group-inspector probe
  // before output paths are created or the requested workload can mutate state.
  // Signals received during the probe are queued so the eventual guardian can
  // seal a normal v2 receipt instead of leaving a caller's lock ambiguous.
  installSupervisorSignalBridge();
  runProcessGroupInventoryCapabilityCheck(runSupervisor);
}

function parseInteger(value, minimum, maximum) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value ?? "")) failUsage();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    failUsage();
  }
  return parsed;
}

function openExclusiveOutput(path) {
  if (!path.startsWith("/") || /[\u0000-\u001f\u007f]/u.test(path)) {
    failUsage();
  }
  return openSync(
    path,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      constants.O_NOFOLLOW,
    0o600,
  );
}

function readBoundedInput(path) {
  if (path === "-") return Buffer.alloc(0);
  if (!path.startsWith("/") || /[\u0000-\u001f\u007f]/u.test(path)) {
    failUsage();
  }
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || metadata.size > MAX_STDIN_BYTES) {
      throw new Error("bounded command stdin must be a small regular file");
    }
    const input = readFileSync(descriptor);
    if (input.byteLength !== metadata.size) {
      throw new Error("bounded command stdin changed while being read");
    }
    return input;
  } finally {
    closeSync(descriptor);
  }
}

function writePrefix(descriptor, chunk, maximumBytes, writtenBytes) {
  const remaining = Math.max(0, maximumBytes - writtenBytes);
  const length = Math.min(remaining, chunk.byteLength);
  let offset = 0;
  while (offset < length) {
    offset += writeSync(descriptor, chunk, offset, length - offset);
  }
  return writtenBytes + length;
}

function runSupervisor() {
  const args = process.argv.slice(2);
  const separatorIndex = args.indexOf("--");
  if (separatorIndex !== 7 || args.length < 9) failUsage();

  const timeoutMs = parseInteger(args[0], 1, MAX_TIMEOUT_MS);
  const killGraceMs = parseInteger(args[1], 0, MAX_KILL_GRACE_MS);
  const maxStdoutBytes = parseInteger(args[2], 0, MAX_CAPTURE_BYTES);
  const maxStderrBytes = parseInteger(args[3], 0, MAX_CAPTURE_BYTES);
  const stdinPath = args[4];
  const stdoutPath = args[5];
  const stderrPath = args[6];
  const command = args[8];
  const commandArgs = args.slice(9);
  const completionReceiptPath = process.env[completionReceiptPathVariable];
  const completionReceiptToken = process.env[completionReceiptTokenVariable];

  if (
    !command?.startsWith("/") ||
    /[\u0000-\u001f\u007f]/u.test(command) ||
    stdoutPath === stderrPath ||
    stdinPath === stdoutPath ||
    stdinPath === stderrPath ||
    ((completionReceiptPath === undefined) !==
      (completionReceiptToken === undefined)) ||
    (completionReceiptPath !== undefined &&
      (!completionReceiptPath.startsWith("/") ||
        /[\u0000-\u001f\u007f]/u.test(completionReceiptPath))) ||
    (completionReceiptToken !== undefined &&
      !uuidPattern.test(completionReceiptToken))
  ) {
    failUsage();
  }

  let stdoutDescriptor;
  let stderrDescriptor;
  let input;
  try {
    input = readBoundedInput(stdinPath);
    stdoutDescriptor = openExclusiveOutput(stdoutPath);
    stderrDescriptor = openExclusiveOutput(stderrPath);
  } catch {
    failEarlyInternal("capture-setup", [stdoutDescriptor, stderrDescriptor]);
  }

  let guardian;
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let requestedExitCode = null;
  let supervisionFailed = false;
  let supervisionFailureReason = null;
  let terminationStarted = false;
  let finalKillRequested = false;
  let guardianReady = false;
  let guardianExited = false;
  let guardianExitSignal = null;
  let closeSeen = false;
  let groupAbsenceProven = false;
  let finalized = false;
  let pendingSignal = null;
  let workloadTerminalSeen = false;
  let workloadExitCode = null;
  let workloadExitSignal = null;
  let expectedGuardianSequence = 1;
  let controlSequence = 0;
  let timeoutTimer;
  let killTimer;
  let bootstrapFailureTimer;
  let groupPollTimer;
  let postKillTimer;
  const postKillGraceMs = Math.max(100, Math.min(killGraceMs, 5_000));
  const guardianToken = randomUUID();

  function markSupervisionFailure(reason) {
    supervisionFailed = true;
    if (supervisionFailureReason === null) supervisionFailureReason = reason;
  }

  function processGroupState() {
    if (groupAbsenceProven) return "absent";
    if (!guardian.pid) return "absent";
    try {
      // Signal zero cannot mutate a reused group. Reuse can only cause a false
      // present result and therefore a fail-closed completion.
      process.kill(-guardian.pid, 0);
      return "present";
    } catch (error) {
      if (error?.code === "ESRCH") return "absent";
      if (error?.code === "EPERM") return "present";
      markSupervisionFailure("group-probe");
      return "unknown";
    }
  }

  function sendControl(message) {
    if (!guardianReady || !guardian.connected || guardianExited) return false;
    controlSequence += 1;
    try {
      guardian.send(
        { ...message, sequence: controlSequence, token: guardianToken },
        (error) => {
          if (error && !finalized) markSupervisionFailure("guardian-control");
        },
      );
      return true;
    } catch {
      markSupervisionFailure("guardian-control");
      return false;
    }
  }

  function scheduleGroupPoll() {
    if (finalized || groupPollTimer) return;
    groupPollTimer = setTimeout(() => {
      groupPollTimer = undefined;
      assessCompletion();
    }, GROUP_POLL_INTERVAL_MS);
  }

  function disconnectGuardianControl() {
    try {
      if (guardian.connected) guardian.disconnect();
    } catch {
      markSupervisionFailure("guardian-disconnect");
    }
    try {
      guardian.channel?.unref();
    } catch {
      markSupervisionFailure("guardian-channel");
    }
  }

  function abandonGuardianStreams() {
    disconnectGuardianControl();
    try {
      guardian.stdin.destroy();
      guardian.stdout.destroy();
      guardian.stderr.destroy();
      guardian.unref();
    } catch {
      markSupervisionFailure("stream-cleanup");
    }
  }

  function requestFinalKill() {
    if (finalKillRequested || finalized) return;
    finalKillRequested = true;
    if (killTimer) {
      clearTimeout(killTimer);
      killTimer = undefined;
    }
    if (!sendControl({ type: "seal" })) {
      markSupervisionFailure("guardian-final-kill");
    }
    postKillTimer = setTimeout(() => {
      if (finalized) return;
      const groupState = processGroupState();
      if (groupState === "absent") groupAbsenceProven = true;
      if (!closeSeen || !groupAbsenceProven) {
        markSupervisionFailure("post-kill-proof");
      }
      abandonGuardianStreams();
      finalize();
    }, postKillGraceMs);
  }

  function beginTermination() {
    if (!terminationStarted || !guardianReady || finalKillRequested) return;
    if (bootstrapFailureTimer) {
      clearTimeout(bootstrapFailureTimer);
      bootstrapFailureTimer = undefined;
    }
    const signal = pendingSignal?.signal ?? "SIGTERM";
    if (!sendControl({ signal, type: "signal" })) {
      markSupervisionFailure("guardian-signal");
    }
    killTimer = setTimeout(requestFinalKill, killGraceMs);
  }

  function terminate(exitCode, signal = "SIGTERM") {
    if (requestedExitCode === null) requestedExitCode = exitCode;
    if (terminationStarted || finalized) return;
    terminationStarted = true;
    pendingSignal = { exitCode, signal };
    if (!guardianReady) {
      bootstrapFailureTimer = setTimeout(() => {
        markSupervisionFailure("guardian-not-ready");
        abandonGuardianStreams();
        finalize();
      }, killGraceMs + postKillGraceMs);
    }
    beginTermination();
  }

  function failSupervision(reason) {
    markSupervisionFailure(reason);
    terminate(EXIT_INTERNAL);
  }

  function closeCaptureDescriptors() {
    try {
      closeSync(stdoutDescriptor);
    } catch {
      markSupervisionFailure("capture-close");
    }
    try {
      closeSync(stderrDescriptor);
    } catch {
      markSupervisionFailure("capture-close");
    }
  }

  function writeCompletionReceipt(exitCode) {
    if (
      completionReceiptPath === undefined ||
      completionReceiptToken === undefined
    ) {
      return true;
    }
    const temporaryPath = `${completionReceiptPath}.tmp-${process.pid}-${randomUUID()}`;
    let descriptor;
    let published = false;
    try {
      descriptor = openSync(
        temporaryPath,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          constants.O_NOFOLLOW,
        0o600,
      );
      const bytes = Buffer.from(
        `${JSON.stringify({
          version: "bounded-command-completion-v2",
          token: completionReceiptToken,
          exitCode,
          closeSeen: true,
          groupAbsenceProven: true,
          guardianSealed: true,
        })}\n`,
        "utf8",
      );
      let offset = 0;
      while (offset < bytes.byteLength) {
        offset += writeSync(descriptor, bytes, offset, bytes.byteLength - offset);
      }
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      linkSync(temporaryPath, completionReceiptPath);
      published = true;
      unlinkSync(temporaryPath);
      return true;
    } catch {
      if (descriptor !== undefined) {
        try {
          closeSync(descriptor);
        } catch {
          // A partial or ambiguously closed receipt fails wrapper validation.
        }
      }
      if (published) {
        try {
          unlinkSync(completionReceiptPath);
          published = false;
        } catch {
          // Keep the staging hard link so a surviving final path has nlink=2
          // and cannot be mistaken for a committed single-link receipt.
        }
      }
      if (!published) {
        try {
          unlinkSync(temporaryPath);
        } catch {
          // An orphaned private staging file cannot validate as the receipt.
        }
      }
      return false;
    }
  }

  function resolvedExitCode() {
    if (supervisionFailed) return EXIT_INTERNAL;
    if (requestedExitCode !== null) return requestedExitCode;
    if (
      workloadTerminalSeen &&
      Number.isInteger(workloadExitCode) &&
      workloadExitCode >= 0 &&
      workloadExitCode <= 255
    ) {
      return workloadExitCode;
    }
    const signalNumber = workloadExitSignal
      ? osConstants.signals[workloadExitSignal]
      : undefined;
    if (workloadTerminalSeen && signalNumber) return 128 + signalNumber;
    markSupervisionFailure("exit-resolution");
    return EXIT_INTERNAL;
  }

  function finalize() {
    if (finalized) return;
    finalized = true;
    clearTimeout(timeoutTimer);
    if (killTimer) clearTimeout(killTimer);
    if (bootstrapFailureTimer) clearTimeout(bootstrapFailureTimer);
    if (groupPollTimer) clearTimeout(groupPollTimer);
    if (postKillTimer) clearTimeout(postKillTimer);
    disconnectGuardianControl();
    closeCaptureDescriptors();
    const guardianProtocolProven =
      finalKillRequested && guardianExitSignal === "SIGKILL";
    if (!guardianProtocolProven) markSupervisionFailure("guardian-seal");
    let exitCode = resolvedExitCode();
    if (
      !supervisionFailed &&
      guardianProtocolProven &&
      groupAbsenceProven &&
      closeSeen &&
      !writeCompletionReceipt(exitCode)
    ) {
      markSupervisionFailure("completion-receipt");
      exitCode = resolvedExitCode();
    }
    if (supervisionFailed) {
      process.stderr.write(
        `bounded-command-v2:${supervisionFailureReason ?? "supervision"}\n`,
      );
    }
    process.exitCode = exitCode;
  }

  function assessCompletion() {
    if (finalized || !guardianExited) return;
    if (!finalKillRequested) {
      markSupervisionFailure("guardian-exit");
      if (closeSeen) {
        finalize();
      } else if (!bootstrapFailureTimer) {
        bootstrapFailureTimer = setTimeout(() => {
          abandonGuardianStreams();
          finalize();
        }, postKillGraceMs);
      }
      return;
    }
    const groupState = processGroupState();
    if (groupState === "absent") {
      groupAbsenceProven = true;
      if (closeSeen) finalize();
      return;
    }
    if (groupState === "unknown") markSupervisionFailure("group-unknown");
    if (postKillTimer) scheduleGroupPoll();
  }

  activateSupervisorSignalHandler(terminate);

  const guardianEnvironment = { ...process.env };
  delete guardianEnvironment[completionReceiptPathVariable];
  delete guardianEnvironment[completionReceiptTokenVariable];
  delete guardianEnvironment.NODE_CHANNEL_FD;
  try {
    guardian = spawn(
      process.execPath,
      [
        fileURLToPath(import.meta.url),
        guardianModeFlag,
        guardianToken,
        command,
        ...commandArgs,
      ],
      {
        detached: true,
        env: guardianEnvironment,
        stdio: ["pipe", "pipe", "pipe", "ipc"],
      },
    );
  } catch {
    failEarlyInternal("spawn", [stdoutDescriptor, stderrDescriptor]);
  }

  timeoutTimer = setTimeout(() => terminate(EXIT_TIMEOUT), timeoutMs);
  guardian.stdout.on("data", (chunk) => {
    if (finalized) return;
    try {
      const before = stdoutBytes;
      stdoutBytes = writePrefix(
        stdoutDescriptor,
        chunk,
        maxStdoutBytes,
        stdoutBytes,
      );
      if (chunk.byteLength > maxStdoutBytes - before) {
        terminate(EXIT_OUTPUT_LIMIT);
      }
    } catch {
      failSupervision("stdout-capture");
    }
  });
  guardian.stderr.on("data", (chunk) => {
    if (finalized) return;
    try {
      const before = stderrBytes;
      stderrBytes = writePrefix(
        stderrDescriptor,
        chunk,
        maxStderrBytes,
        stderrBytes,
      );
      if (chunk.byteLength > maxStderrBytes - before) {
        terminate(EXIT_OUTPUT_LIMIT);
      }
    } catch {
      failSupervision("stderr-capture");
    }
  });
  guardian.stdout.on("error", () => failSupervision("stdout-stream"));
  guardian.stderr.on("error", () => failSupervision("stderr-stream"));
  guardian.stdin.on("error", (error) => {
    if (error?.code !== "EPIPE") failSupervision("stdin-stream");
  });
  guardian.on("message", (message) => {
    if (
      typeof message !== "object" ||
      message === null ||
      !("type" in message) ||
      !("token" in message) ||
      !("sequence" in message) ||
      message.token !== guardianToken ||
      message.sequence !== expectedGuardianSequence
    ) {
      failSupervision("guardian-message");
      return;
    }
    expectedGuardianSequence += 1;
    if (message.type === "ready") {
      if (guardianReady) {
        failSupervision("guardian-message");
        return;
      }
      guardianReady = true;
      beginTermination();
      return;
    }
    if (
      message.type === "workload-terminal" &&
      !workloadTerminalSeen &&
      "code" in message &&
      "residualGroup" in message &&
      "signal" in message &&
      (message.code === null ||
        (Number.isInteger(message.code) && message.code >= 0 && message.code <= 255)) &&
      (message.signal === null ||
        (typeof message.signal === "string" &&
          Object.hasOwn(osConstants.signals, message.signal))) &&
      typeof message.residualGroup === "boolean"
    ) {
      workloadTerminalSeen = true;
      workloadExitCode = message.code;
      workloadExitSignal = message.signal;
      if (message.residualGroup) markSupervisionFailure("residual-group");
      requestFinalKill();
      return;
    }
    if (
      message.type === "failure" &&
      "reason" in message &&
      typeof message.reason === "string" &&
      /^[a-z0-9-]{1,64}$/u.test(message.reason)
    ) {
      markSupervisionFailure(message.reason);
      requestFinalKill();
      return;
    }
    failSupervision("guardian-message");
  });
  guardian.once("error", () => failSupervision("guardian-error"));
  guardian.once("exit", (_code, signal) => {
    guardianExited = true;
    guardianExitSignal = signal;
    assessCompletion();
  });
  guardian.once("close", (_code, signal) => {
    closeSeen = true;
    guardianExited = true;
    guardianExitSignal ??= signal;
    assessCompletion();
  });
  guardian.stdin.end(input);
}
