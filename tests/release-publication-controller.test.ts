import { execFile, spawn } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const controllerScript = resolve(
  process.cwd(),
  "scripts/deploy/release-publication-controller.sh",
);
const RELEASE_ID = "a".repeat(40);
const signalBlockFunction =
  "controller_signal_block() { /bin/bash --noprofile --norc -c 'trap \"exit 23\" TERM; exec 9<>\"${CONTROLLER_BLOCK}\"; printf \"ready\\n\" >\"${CONTROLLER_READY}\"; IFS= read -r _ <&9'; }";

type CommandResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

type ControllerScenario = {
  kind?: "full" | "application";
  activateStatus?: number;
  currentStatus?: number;
  entryPoint?: "reconcile" | "reconcile-committed";
  finalizeStatus?: number;
  pendingStatuses?: number[];
  prepareStatus?: number;
  publishStatus?: number;
  readFailureAt?: number;
  readFailureStatus?: number;
  strictStates?: string[];
};

type ScenarioResult = CommandResult & {
  events: string[];
};

type ProductionEntryScenarioResult = ScenarioResult & {
  deployRoot: string;
};

type ProductionEntryOptions = {
  fixedNodeStatus?: number;
  inheritedLifecycleFd?: boolean;
  reconcileCommittedStatus?: number;
  stagedPathFailureStatus?: number;
  stagedPathFailureSuffix?: string;
  stagedPathStatus?: number;
};

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      if ((await readFile(path, "utf8")) === "ready\n") {
        return;
      }
    } catch {
      await new Promise<void>((resolveDelay) => {
        setTimeout(resolveDelay, 25);
      });
    }
  }
  throw new Error(`timed out waiting for signal fixture: ${path}`);
}

async function runDetachedSignalHarness(
  signalHarness: string,
  options: {
    environment?: Record<string, string>;
    initialState?: string;
  } = {},
): Promise<ScenarioResult> {
  const root = await mkdtemp(join(tmpdir(), "diesel-controller-signal-"));
  const logPath = join(root, "events.log");
  const readyPath = join(root, "ready");
  const blockPath = join(root, "block.fifo");
  const statePath = join(root, "state");
  await writeFile(logPath, "", "utf8");
  if (options.initialState !== undefined) {
    await writeFile(statePath, `${options.initialState}\n`, "utf8");
  }
  await execFileAsync("/usr/bin/mkfifo", [blockPath]);

  const child = spawn(
    "/bin/bash",
    [
      "--noprofile",
      "--norc",
      "-c",
      signalHarness,
      "controller-signal-harness",
      controllerScript,
      RELEASE_ID,
    ],
    {
      detached: true,
      env: {
        ...process.env,
        CONTROLLER_BLOCK: blockPath,
        CONTROLLER_DEPLOY_ROOT: join(root, "diesel"),
        CONTROLLER_LOG: logPath,
        CONTROLLER_READY: readyPath,
        CONTROLLER_STATE: statePath,
        ...options.environment,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "";
  let stdout = "";
  child.stderr.setEncoding("utf8");
  child.stdout.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  const completion = new Promise<number>((resolveCompletion, rejectCompletion) => {
    child.once("error", rejectCompletion);
    child.once("close", (code, signal) => {
      if (code !== null) {
        resolveCompletion(code);
      } else {
        rejectCompletion(
          new Error(`controller signal fixture exited via ${signal ?? "unknown"}`),
        );
      }
    });
  });

  try {
    await waitForFile(readyPath);
    if (child.pid === undefined) {
      throw new Error("controller signal fixture did not expose a process ID");
    }
    process.kill(-child.pid, "SIGTERM");
    const exitCode = await Promise.race([
      completion,
      new Promise<never>((_resolve, rejectTimeout) => {
        setTimeout(
          () => rejectTimeout(new Error("controller signal fixture did not exit")),
          5_000,
        );
      }),
    ]);
    const eventText = await readFile(logPath, "utf8");
    return {
      events: eventText.trim() === "" ? [] : eventText.trim().split("\n"),
      exitCode,
      stderr,
      stdout,
    };
  } finally {
    if (child.pid !== undefined && child.exitCode === null) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // The process group may already have completed between the check and kill.
      }
    }
    await rm(root, { force: true, recursive: true });
  }
}

async function runProcessGroupSignalScenario(
  phase: "prepare" | "publish",
): Promise<ScenarioResult> {
  const signalHarness = [
    'source -- "$1"',
    'RELEASE_PUBLICATION_CONTROLLER_DEPLOY_ROOT="${CONTROLLER_DEPLOY_ROOT}"',
    'controller_signal_log() { printf "%s\\n" "$1" >>"${CONTROLLER_LOG}"; }',
    signalBlockFunction,
    'release_publication_controller_require_pending_state() { controller_signal_log "pending"; }',
    'release_publication_controller_run_prepare() {',
    '  controller_signal_log "prepare"',
    '  if [[ "${SIGNAL_PHASE}" == prepare ]]; then',
    '    controller_signal_block',
    '  fi',
    '}',
    'release_publication_controller_run_activate() { controller_signal_log "activate"; }',
    'release_publication_controller_require_current() { controller_signal_log "current"; }',
    'release_publication_controller_run_governance_mode() {',
    '  controller_signal_log "governance:$1"',
    '  if [[ "$1" == publish ]]; then',
    '    controller_signal_block',
    '  fi',
    '}',
    'release_publication_controller_read_strict_state() {',
    '  controller_signal_log "read:PENDING:PUBLISH_COMMITTED"',
    '  printf "%s\\n" "PENDING:PUBLISH_COMMITTED"',
    '}',
    'release_publication_controller_impl() { release_publication_controller_reconcile "$1"; }',
    'release_publication_controller_run_main "$2"',
  ].join("\n");

  return runDetachedSignalHarness(signalHarness, {
    environment: { SIGNAL_PHASE: phase },
  });
}

async function runSupervisorLayerSignalScenario(
  entryPoint: "main" | "wrapper",
): Promise<ScenarioResult> {
  const entryHarness =
    entryPoint === "main"
      ? [
          'release_publication_controller() { controller_signal_log "child"; controller_signal_block; }',
          'release_publication_controller_run_main "$2"',
        ]
      : [
          "trap ':' TERM",
          'release_publication_controller_impl() { controller_signal_log "child"; controller_signal_block; }',
          'if release_publication_controller "$2"; then controller_status=0; else controller_status="$?"; fi',
          "trap - TERM",
          'exit "${controller_status}"',
        ];
  const signalHarness = [
    'source -- "$1"',
    'RELEASE_PUBLICATION_CONTROLLER_DEPLOY_ROOT="${CONTROLLER_DEPLOY_ROOT}"',
    'controller_signal_log() { printf "%s\\n" "$1" >>"${CONTROLLER_LOG}"; }',
    signalBlockFunction,
    ...entryHarness,
  ].join("\n");

  return runDetachedSignalHarness(signalHarness);
}

async function runFinalizeSignalScenario(
  writeTerminalState: boolean,
): Promise<ScenarioResult> {
  const signalHarness = [
    'source -- "$1"',
    'RELEASE_PUBLICATION_CONTROLLER_DEPLOY_ROOT="${CONTROLLER_DEPLOY_ROOT}"',
    'controller_signal_log() { printf "%s\\n" "$1" >>"${CONTROLLER_LOG}"; }',
    signalBlockFunction,
    'release_publication_controller_read_strict_state() {',
    '  IFS= read -r strict_state <"${CONTROLLER_STATE}"',
    '  controller_signal_log "read:${strict_state}"',
    '  printf "%s\\n" "${strict_state}"',
    '}',
    'release_publication_controller_run_governance_mode() {',
    '  [[ "$1" == finalize-committed ]] || return 97',
    '  controller_signal_log "finalize:start"',
    '  if [[ "${CONTROLLER_WRITE_TERMINAL}" == 1 ]]; then',
    '    printf "%s\\n" COMMITTED:PUBLISH_FINALIZED >"${CONTROLLER_STATE}"',
    '    controller_signal_log "finalize:terminal"',
    '  fi',
    '  controller_signal_block',
    '}',
    'release_publication_controller_impl() { release_publication_controller_reconcile_committed "$1"; }',
    'release_publication_controller_run_main "$2"',
  ].join("\n");

  return runDetachedSignalHarness(signalHarness, {
    environment: {
      CONTROLLER_WRITE_TERMINAL: writeTerminalState ? "1" : "0",
    },
    initialState: "PENDING:PUBLISH_COMMITTED",
  });
}

const reconcileHarness = [
  'source -- "$1"',
  'controller_test_log() { printf "%s\\n" "$1" >>"${CONTROLLER_LOG}"; }',
  'release_publication_controller_run_prepare() {',
  '  controller_test_log "prepare:$1"',
  '  return "${PREPARE_STATUS}"',
  '}',
  'release_publication_controller_run_activate() {',
  '  controller_test_log "activate:$1"',
  '  return "${ACTIVATE_STATUS}"',
  '}',
  'release_publication_controller_require_current() {',
  '  controller_test_log "current:$1"',
  '  return "${CURRENT_STATUS}"',
  '}',
  'release_publication_controller_require_pending_state() {',
  '  local pending_count=0',
  '  local status_index',
  '  local pending_status',
  '  local -a pending_statuses=()',
  '  IFS= read -r pending_count <"${PENDING_COUNT_FILE}" || return 96',
  '  pending_count=$((pending_count + 1))',
  '  printf "%s\\n" "${pending_count}" >"${PENDING_COUNT_FILE}"',
  '  IFS="|" read -r -a pending_statuses <<<"${PENDING_STATUSES}"',
  '  status_index=$((pending_count - 1))',
  '  if (( status_index >= ${#pending_statuses[@]} )); then',
  '    status_index=$((${#pending_statuses[@]} - 1))',
  '  fi',
  '  pending_status="${pending_statuses[${status_index}]}"',
  '  controller_test_log "pending:${pending_status}:$1"',
  '  return "${pending_status}"',
  '}',
  'release_publication_controller_run_governance_mode() {',
  '  controller_test_log "governance:$1:$2"',
  '  case "$1" in',
  '    publish | application) return "${PUBLISH_STATUS}" ;;',
  '    finalize-committed | finalize-application) return "${FINALIZE_STATUS}" ;;',
  '    *) return 64 ;;',
  '  esac',
  '}',
  'release_publication_controller_read_strict_state() {',
  '  local read_count=0',
  '  local state_index',
  '  local strict_state',
  '  local -a strict_states=()',
  '  IFS= read -r read_count <"${READ_COUNT_FILE}" || return 96',
  '  read_count=$((read_count + 1))',
  '  printf "%s\\n" "${read_count}" >"${READ_COUNT_FILE}"',
  '  if [[ "${READ_FAILURE_AT}" == "${read_count}" ]]; then',
  '    controller_test_log "read:error:$1"',
  '    return "${READ_FAILURE_STATUS}"',
  '  fi',
  '  IFS="|" read -r -a strict_states <<<"${STRICT_STATES}"',
  '  state_index=$((read_count - 1))',
  '  if (( state_index >= ${#strict_states[@]} )); then',
  '    state_index=$((${#strict_states[@]} - 1))',
  '  fi',
  '  strict_state="${strict_states[${state_index}]}"',
  '  controller_test_log "read:${strict_state}:$1"',
  '  printf "%s\\n" "${strict_state}"',
  '}',
  'case "${CONTROLLER_ENTRY}" in',
  '  reconcile) release_publication_controller_reconcile "$2" ;;',
  '  reconcile-committed) release_publication_controller_reconcile_committed "$2" ;;',
  '  *) exit 64 ;;',
  'esac',
].join("\n");

async function execute(
  file: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  try {
    const result = await execFileAsync(file, args, { env });
    return {
      exitCode: 0,
      stderr: String(result.stderr),
      stdout: String(result.stdout),
    };
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    const commandError = error as Error & {
      code?: unknown;
      stderr?: unknown;
      stdout?: unknown;
    };
    return {
      exitCode:
        typeof commandError.code === "number" ? commandError.code : -1,
      stderr: String(commandError.stderr ?? ""),
      stdout: String(commandError.stdout ?? ""),
    };
  }
}

async function runScenario(
  scenario: ControllerScenario = {},
): Promise<ScenarioResult> {
  const root = await mkdtemp(join(tmpdir(), "diesel-publication-controller-"));
  const logPath = join(root, "events.log");
  const pendingCountPath = join(root, "pending-count");
  const readCountPath = join(root, "read-count");
  await Promise.all([
    writeFile(logPath, "", "utf8"),
    writeFile(pendingCountPath, "0\n", "utf8"),
    writeFile(readCountPath, "0\n", "utf8"),
  ]);

  try {
    const result = await execute(
      "bash",
      [
        "--noprofile",
        "--norc",
        "-c",
        reconcileHarness,
        "controller-test-harness",
        controllerScript,
        RELEASE_ID,
      ],
      {
        ...process.env,
        DIESEL_RELEASE_KIND: scenario.kind ?? "full",
        ACTIVATE_STATUS: String(scenario.activateStatus ?? 0),
        CONTROLLER_ENTRY: scenario.entryPoint ?? "reconcile",
        CONTROLLER_LOG: logPath,
        CURRENT_STATUS: String(scenario.currentStatus ?? 0),
        FINALIZE_STATUS: String(scenario.finalizeStatus ?? 0),
        PENDING_COUNT_FILE: pendingCountPath,
        PENDING_STATUSES: (scenario.pendingStatuses ?? [0]).join("|"),
        PREPARE_STATUS: String(scenario.prepareStatus ?? 0),
        PUBLISH_STATUS: String(scenario.publishStatus ?? 0),
        READ_COUNT_FILE: readCountPath,
        READ_FAILURE_AT: String(scenario.readFailureAt ?? 0),
        READ_FAILURE_STATUS: String(scenario.readFailureStatus ?? 71),
        STRICT_STATES: (scenario.strictStates ?? ["PENDING:none"]).join("|"),
      },
    );
    const eventText = await readFile(logPath, "utf8");
    return {
      ...result,
      events: eventText.trim() === "" ? [] : eventText.trim().split("\n"),
    };
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

describe("application-only controller extension", () => {
  it("prepares once and delegates activation/readback to the maintenance-locked application protocol", async () => {
    const result = await runScenario({ kind: "application", strictStates: ["COMMITTED:APPLICATION_VERIFIED_V2"] });
    expect(result.exitCode).toBe(0);
    expect(result.events).toContain(`governance:application:${RELEASE_ID}`);
    expect(result.events.some((event) => event.startsWith("activate:") || event.startsWith("governance:publish:") || event.startsWith("governance:finalize-committed:"))).toBe(false);
  });
  it.each([
    { publishStatus: 75, strictStates: ["PENDING:none"], expected: 75 },
    { publishStatus: 70, strictStates: ["PENDING:none"], expected: 70 },
    { publishStatus: 0, strictStates: ["PENDING:none"], expected: 70 },
    { publishStatus: 70, strictStates: ["PENDING:APPLICATION_VERIFIED_V2"], expected: 75 },
    { publishStatus: 70, strictStates: ["COMMITTED:APPLICATION_VERIFIED_V2"], expected: 75 },
    { publishStatus: 0, strictStates: ["COMMITTED:PUBLISH_FINALIZED"], expected: 75 },
    { publishStatus: 0, readFailureAt: 1, expected: 75 },
  ])("preserves honest application failure classification %j", async ({ expected, ...scenario }) => {
    expect((await runScenario({ kind: "application", ...scenario })).exitCode).toBe(expected);
  });
});

async function runProductionEntryScenario(
  ledgerState: string,
  rootUid = 0,
  options: ProductionEntryOptions = {},
): Promise<ProductionEntryScenarioResult> {
  const root = await mkdtemp(join(tmpdir(), "diesel-controller-entry-"));
  const deployRoot = join(root, "diesel");
  const logPath = join(root, "events.log");
  await writeFile(logPath, "", "utf8");
  const entryHarness = [
    'source -- "$1"',
    'RELEASE_PUBLICATION_CONTROLLER_DEPLOY_ROOT="$3"',
    'controller_entry_log() { printf "%s\\n" "$1" >>"${CONTROLLER_LOG}"; }',
    'release_publication_controller_effective_uid() { printf "%s\\n" "${CONTROLLER_ROOT_UID}"; }',
    'release_publication_controller_diesel_gid() { printf "%s\\n" 1001; }',
    'find() { :; }',
    'flock() { :; }',
    'mktemp() { :; }',
    'mv() { :; }',
    'readlink() { :; }',
    'realpath() { :; }',
    'sha256sum() { :; }',
    'sort() { :; }',
    'stat() { :; }',
    'release_publication_controller_require_fixed_node_runtime() { return "${CONTROLLER_FIXED_NODE_STATUS}"; }',
    'release_publication_controller_require_fixed_host_commands() { :; }',
    'release_publication_controller_require_trusted_host_executable() { :; }',
    'release_publication_controller_require_trusted_staged_path() {',
    '  if [[ -n "${CONTROLLER_STAGED_PATH_FAILURE_SUFFIX}" && "$1" == *"${CONTROLLER_STAGED_PATH_FAILURE_SUFFIX}" ]]; then',
    '    controller_entry_log "staged-reject:$1"',
    '    return "${CONTROLLER_STAGED_PATH_FAILURE_STATUS}"',
    '  fi',
    '  return "${CONTROLLER_STAGED_PATH_STATUS}"',
    '}',
    'host_activation_ledger_require_directory() { :; }',
    'host_activation_ledger_require_file() { :; }',
    'host_activation_ledger_require_lifecycle_lock() { :; }',
    'host_activation_ledger_scan_all() { :; }',
    'host_activation_ledger_validate_release_state() {',
    '  HOST_ACTIVATION_LEDGER_PROTOCOL=v1',
    '  HOST_ACTIVATION_LEDGER_STATE="${CONTROLLER_LEDGER_STATE%%:*}"',
    '  HOST_ACTIVATION_LEDGER_GOVERNANCE_STATE="${CONTROLLER_LEDGER_STATE#*:}"',
    '}',
    'host_activation_ledger_require_pending() { controller_entry_log "require-pending"; }',
    'release_publication_controller_reconcile() { controller_entry_log "reconcile"; }',
    'release_publication_controller_reconcile_committed() { controller_entry_log "reconcile-committed"; return "${CONTROLLER_RECONCILE_COMMITTED_STATUS}"; }',
    'if [[ "${CONTROLLER_INHERIT_LIFECYCLE_FD}" == 1 ]]; then',
    '  exec 8</dev/null',
    '  export DIESEL_RELEASE_LIFECYCLE_LOCK_FD=8',
    'else',
    '  unset DIESEL_RELEASE_LIFECYCLE_LOCK_FD',
    'fi',
    'release_publication_controller "$2"',
  ].join("\n");

  try {
    const result = await execute(
      "/bin/bash",
      [
        "--noprofile",
        "--norc",
        "-c",
        entryHarness,
        "controller-entry-harness",
        controllerScript,
        RELEASE_ID,
        deployRoot,
      ],
      {
        ...process.env,
        CONTROLLER_FIXED_NODE_STATUS: String(options.fixedNodeStatus ?? 0),
        CONTROLLER_INHERIT_LIFECYCLE_FD:
          options.inheritedLifecycleFd === false ? "0" : "1",
        CONTROLLER_LEDGER_STATE: ledgerState,
        CONTROLLER_LOG: logPath,
        CONTROLLER_RECONCILE_COMMITTED_STATUS: String(
          options.reconcileCommittedStatus ?? 0,
        ),
        CONTROLLER_ROOT_UID: String(rootUid),
        CONTROLLER_STAGED_PATH_FAILURE_STATUS: String(
          options.stagedPathFailureStatus ?? 23,
        ),
        CONTROLLER_STAGED_PATH_FAILURE_SUFFIX:
          options.stagedPathFailureSuffix ?? "",
        CONTROLLER_STAGED_PATH_STATUS: String(
          options.stagedPathStatus ?? 0,
        ),
      },
    );
    const eventText = await readFile(logPath, "utf8");
    return {
      ...result,
      deployRoot,
      events: eventText.trim() === "" ? [] : eventText.trim().split("\n"),
    };
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

function actionEvents(events: string[]): string[] {
  return events
    .filter((event) => !event.startsWith("read:"))
    .map((event) =>
      event.endsWith(`:${RELEASE_ID}`)
        ? event.slice(0, -(RELEASE_ID.length + 1))
        : event,
    );
}

describe("release-publication-controller.sh", () => {
  it.each([
    { args: [], expectedStatus: 64, name: "missing release ID" },
    { args: ["A".repeat(40)], expectedStatus: 64, name: "uppercase release ID" },
    { args: ["a".repeat(39)], expectedStatus: 64, name: "short release ID" },
    {
      args: [RELEASE_ID, "/tmp/attempted-path-override"],
      expectedStatus: 64,
      name: "extra production path override",
    },
    { args: [RELEASE_ID], expectedStatus: 70, name: "non-production entry path" },
  ])("rejects $name at the CLI boundary", async ({ args, expectedStatus }) => {
    const result = await execute("/bin/bash", [controllerScript, ...args]);

    expect(result.exitCode).toBe(expectedStatus);
  });

  it("is Bash syntax-valid and sourceable without executing or changing traps/options", async () => {
    await expect(
      execFileAsync("bash", ["-n", controllerScript]),
    ).resolves.toMatchObject({ stderr: "" });

    const sourceProbe = [
      'trap ":" USR1',
      'before_options="$(set +o)"',
      'before_trap="$(trap -p USR1)"',
      'source -- "$1"',
      'after_options="$(set +o)"',
      'after_trap="$(trap -p USR1)"',
      '[[ "${before_options}" == "${after_options}" ]] || exit 91',
      '[[ "${before_trap}" == "${after_trap}" ]] || exit 92',
      'declare -F release_publication_controller_reconcile >/dev/null || exit 93',
    ].join("\n");
    const result = await execute("bash", [
      "--noprofile",
      "--norc",
      "-c",
      sourceProbe,
      "controller-source-probe",
      controllerScript,
    ]);

    expect(result).toEqual({ exitCode: 0, stderr: "", stdout: "" });
  });

  it("propagates a sourced controller ledger failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "diesel-controller-source-"));
    const copiedController = join(root, "release-publication-controller.sh");
    const ledger = join(root, "host-activation-ledger.sh");
    await Promise.all([
      copyFile(controllerScript, copiedController),
      writeFile(ledger, "return 23\n", "utf8"),
    ]);

    try {
      const result = await execute("/bin/bash", [
        "--noprofile",
        "--norc",
        "-c",
        'source -- "$1"',
        "controller-source-failure-fixture",
        copiedController,
      ]);

      expect(result).toEqual({ exitCode: 23, stderr: "", stdout: "" });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it.each([
    {
      command: 'release_publication_controller_main "$2"',
      expectedError:
        "production release publication main is unavailable when sourced",
      name: "main",
    },
    {
      command: 'release_publication_controller "$2"',
      expectedError:
        "production release publication is unavailable from a sourced shell",
      name: "default production root",
    },
  ])("rejects the sourced controller $name", async ({ command, expectedError }) => {
    const result = await execute("/bin/bash", [
      "--noprofile",
      "--norc",
      "-c",
      ['source -- "$1"', command].join("\n"),
      "controller-sourced-production-fixture",
      controllerScript,
      RELEASE_ID,
    ]);

    expect(result.exitCode).toBe(64);
    expect(result.stderr).toContain(expectedError);
  });

  it.each([
    {
      command: 'release_publication_controller_run_prepare "$2"',
      expectedError:
        "runtime preparation child cannot target production from a sourced controller",
      name: "runtime preparation child",
    },
    {
      command: 'release_publication_controller_run_activate "$2"',
      expectedError:
        "host activation child cannot target production from a sourced controller",
      name: "host activation child",
    },
    {
      command:
        'release_publication_controller_run_governance_mode publish "$2"',
      expectedError:
        "governance child cannot target production from a sourced controller",
      name: "governance child",
    },
  ])(
    "rejects the sourced controller $name at the production root",
    async ({ command, expectedError }) => {
      const result = await execute("/bin/bash", [
        "--noprofile",
        "--norc",
        "-c",
        ['source -- "$1"', command].join("\n"),
        "controller-sourced-child-fixture",
        controllerScript,
        RELEASE_ID,
      ]);

      expect(result.exitCode).toBe(64);
      expect(result.stderr).toContain(expectedError);
    },
  );

  it.each([
    ["/opt/diesel", 0],
    ["/opt/diesel/", 0],
    ["/opt//diesel", 0],
  ] as const)(
    "classifies sourced controller deployment root %s as %i",
    async (deployRoot, expectedStatus) => {
      const result = await execute("/bin/bash", [
        "--noprofile",
        "--norc",
        "-c",
        'source -- "$1"; release_publication_controller_sourced_production_root_is_selected "$2"',
        "controller-sourced-root-fixture",
        controllerScript,
        deployRoot,
      ]);

      expect(result).toEqual({
        exitCode: expectedStatus,
        stderr: "",
        stdout: "",
      });
    },
  );

  it("allows a canonical temporary controller deployment root", async () => {
    const deployRoot = await mkdtemp(join(tmpdir(), "diesel-controller-root-"));

    try {
      const result = await execute("/bin/bash", [
        "--noprofile",
        "--norc",
        "-c",
        'source -- "$1"; release_publication_controller_sourced_production_root_is_selected "$2"',
        "controller-sourced-root-fixture",
        controllerScript,
        deployRoot,
      ]);

      expect(result).toEqual({ exitCode: 1, stderr: "", stdout: "" });
    } finally {
      await rm(deployRoot, { force: true, recursive: true });
    }
  });

  it("bootstraps PATH trust with Bash identity and absolute host inspectors", async () => {
    const source = await readFile(controllerScript, "utf8");

    expect(source).toContain(
      'release_publication_controller_effective_uid() {\n  printf \'%s\\n\' "${EUID}"',
    );
    expect(source).not.toContain("$(id -u)");
    expect(source).toContain(
      "$(/usr/bin/realpath -e -- \"${path}\")",
    );
    expect(source).toContain(
      "$(/usr/bin/stat -c '%u:%g:%a' -- \"${path}\")",
    );
    for (const commandSpec of [
      "find:/usr/bin/find",
      "flock:/usr/bin/flock",
      "id:/usr/bin/id",
      "realpath:/usr/bin/realpath",
      "stat:/usr/bin/stat",
    ]) {
      expect(source).toContain(`"${commandSpec}"`);
    }
    expect(source).toContain(
      '"${release_dir}/scripts/db/with-governance-maintenance-lock.ts"',
    );
    expect(source).toContain(
      '"${release_dir}/scripts/deploy/governance-publication-state-machine.sh"',
    );
  });

  it.each([
    ["system directory", "system-directory", "root:root:755", 0],
    ["staged release directory", "release-directory", "root:root:755", 0],
    ["normalized release directory", "release-directory", "root:diesel:750", 0],
    ["staged release executable", "release-executable", "root:root:755:1", 0],
    ["normalized release executable", "release-executable", "root:diesel:750:1", 0],
    ["group-owned system directory", "system-directory", "root:diesel:750", 1],
    ["hard-linked release executable", "release-executable", "root:diesel:750:2", 1],
    ["group-writable release executable", "release-executable", "root:diesel:770:1", 1],
  ] as const)(
    "classifies %s at the direct controller source boundary",
    async (_name, profile, metadata, expectedStatus) => {
      const result = await execute("/bin/bash", [
        "--noprofile",
        "--norc",
        "-c",
        'source -- "$1"; release_publication_controller_cli_bootstrap_metadata_is_allowed "$2" "$3"',
        "controller-cli-metadata-fixture",
        controllerScript,
        profile,
        metadata,
      ]);

      expect(result).toEqual({
        exitCode: expectedStatus,
        stderr: "",
        stdout: "",
      });
    },
  );

  it.each(["/opt/diesel", "/opt/diesel/", "/opt//diesel"])(
    "rejects sourced controller bootstrap root %s before inspecting paths",
    async (deployRoot) => {
      const root = await mkdtemp(join(tmpdir(), "diesel-controller-bootstrap-"));
      const marker = join(root, "path-inspected");
      const productionEntry = `${deployRoot}/releases/${RELEASE_ID}/scripts/deploy/release-publication-controller.sh`;

      try {
        const result = await execute("/bin/bash", [
          "--noprofile",
          "--norc",
          "-c",
          [
            'source -- "$1"',
            'BOOTSTRAP_MARKER="$3"',
            "release_publication_controller_require_cli_bootstrap_path() {",
            '  printf "inspected\\n" >"${BOOTSTRAP_MARKER}"',
            "}",
            'release_publication_controller_cli_bootstrap "$2" "$4" "$5"',
          ].join("\n"),
          "controller-sourced-bootstrap-fixture",
          controllerScript,
          RELEASE_ID,
          marker,
          deployRoot,
          productionEntry,
        ]);

        expect(result).toEqual({ exitCode: 64, stderr: "", stdout: "" });
        await expect(readFile(marker, "utf8")).rejects.toMatchObject({
          code: "ENOENT",
        });
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
  );

  it("binds the direct controller and ledger before sourcing release code", async () => {
    const source = await readFile(controllerScript, "utf8");
    const entryBindingIndex = source.indexOf(
      'local expected_entry="${expected_release}/scripts/deploy/release-publication-controller.sh"',
    );
    const ledgerValidationIndex = source.indexOf(
      '"${expected_ledger}" release-executable',
    );
    const rootPathIndex = source.indexOf(
      'export PATH="/usr/sbin:/usr/bin:/sbin:/bin"',
    );
    const ledgerSourceIndex = source.indexOf(
      'source -- "${expected_ledger}"',
    );

    expect(entryBindingIndex).toBeGreaterThanOrEqual(0);
    expect(ledgerValidationIndex).toBeGreaterThan(entryBindingIndex);
    expect(rootPathIndex).toBeGreaterThan(ledgerValidationIndex);
    expect(ledgerSourceIndex).toBeGreaterThan(rootPathIndex);
    expect(source.indexOf("source --")).toBe(ledgerSourceIndex);
    expect(source.slice(0, ledgerSourceIndex)).not.toMatch(
      /^[ \t]*(?:source|\.)[ \t]+/mu,
    );
  });

  it.each(["entry", "ledger"] as const)(
    "does not execute a poisoned controller ledger when %s validation fails",
    async (rejectedObject) => {
      const root = await mkdtemp(join(tmpdir(), "diesel-controller-bootstrap-"));
      const deployRoot = join(root, "diesel");
      const releaseDirectory = join(deployRoot, "releases", RELEASE_ID);
      const deployDirectory = join(releaseDirectory, "scripts", "deploy");
      const entry = join(deployDirectory, "release-publication-controller.sh");
      const ledger = join(deployDirectory, "host-activation-ledger.sh");
      const marker = join(root, "ledger-executed");
      const validationLog = join(root, "validation.log");
      const rejectedPath = rejectedObject === "entry" ? entry : ledger;
      await mkdir(deployDirectory, { recursive: true });
      await writeFile(
        ledger,
        'printf "ledger-executed\\n" >"${BOOTSTRAP_MARKER:?}"\n',
        "utf8",
      );

      try {
        const harness = [
          'source -- "$1"',
          'BOOTSTRAP_REJECT="$5"',
          'BOOTSTRAP_LOG="$6"',
          'BOOTSTRAP_MARKER="$7"',
          'release_publication_controller_require_cli_bootstrap_path() {',
          '  printf "%s|%s\\n" "$1" "$2" >>"${BOOTSTRAP_LOG}"',
          '  [[ "$1" != "${BOOTSTRAP_REJECT}" ]]',
          '}',
          'release_publication_controller_cli_bootstrap "$2" "$3" "$4"',
        ].join("\n");
        const result = await execute("/bin/bash", [
          "--noprofile",
          "--norc",
          "-c",
          harness,
          "controller-bootstrap-fixture",
          controllerScript,
          RELEASE_ID,
          deployRoot,
          entry,
          rejectedPath,
          validationLog,
          marker,
        ]);

        expect(result).toEqual({ exitCode: 75, stderr: "", stdout: "" });
        await expect(readFile(marker, "utf8")).rejects.toMatchObject({
          code: "ENOENT",
        });
        const validatedPaths = (await readFile(validationLog, "utf8"))
          .trim()
          .split("\n");
        const expectedValidationSequence = [
          "/opt|system-directory",
          `${deployRoot}|system-directory`,
          `${deployRoot}/releases|system-directory`,
          `${releaseDirectory}|release-directory`,
          `${releaseDirectory}/scripts|release-directory`,
          `${deployDirectory}|release-directory`,
          `${entry}|release-executable`,
          `${ledger}|release-executable`,
        ];
        const rejectedIndex = expectedValidationSequence.findIndex((line) =>
          line.startsWith(`${rejectedPath}|`),
        );
        expect(rejectedIndex).toBeGreaterThanOrEqual(0);
        expect(validatedPaths).toEqual(
          expectedValidationSequence.slice(0, rejectedIndex + 1),
        );
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
  );

  it("sources the controller ledger only after every bootstrap validation succeeds", async () => {
    const root = await mkdtemp(join(tmpdir(), "diesel-controller-bootstrap-"));
    const deployRoot = join(root, "diesel");
    const releaseDirectory = join(deployRoot, "releases", RELEASE_ID);
    const deployDirectory = join(releaseDirectory, "scripts", "deploy");
    const entry = join(deployDirectory, "release-publication-controller.sh");
    const ledger = join(deployDirectory, "host-activation-ledger.sh");
    const marker = join(root, "ledger-executed");
    const validationLog = join(root, "validation.log");
    await mkdir(deployDirectory, { recursive: true });
    await writeFile(
      ledger,
      'printf "ledger-executed\\n" >"${BOOTSTRAP_MARKER:?}"\n',
      "utf8",
    );

    try {
      const harness = [
        'source -- "$1"',
        'BOOTSTRAP_LOG="$5"',
        'BOOTSTRAP_MARKER="$6"',
        'release_publication_controller_require_cli_bootstrap_path() {',
        '  printf "%s|%s\\n" "$1" "$2" >>"${BOOTSTRAP_LOG}"',
        '}',
        'release_publication_controller_cli_bootstrap "$2" "$3" "$4"',
      ].join("\n");
      const result = await execute("/bin/bash", [
        "--noprofile",
        "--norc",
        "-c",
        harness,
        "controller-bootstrap-fixture",
        controllerScript,
        RELEASE_ID,
        deployRoot,
        entry,
        validationLog,
        marker,
      ]);

      expect(result).toEqual({ exitCode: 0, stderr: "", stdout: "" });
      await expect(readFile(marker, "utf8")).resolves.toBe(
        "ledger-executed\n",
      );
      const validatedPaths = (await readFile(validationLog, "utf8"))
        .trim()
        .split("\n");
      expect(validatedPaths).toEqual([
        "/opt|system-directory",
        `${deployRoot}|system-directory`,
        `${deployRoot}/releases|system-directory`,
        `${releaseDirectory}|release-directory`,
        `${releaseDirectory}/scripts|release-directory`,
        `${deployDirectory}|release-directory`,
        `${entry}|release-executable`,
        `${ledger}|release-executable`,
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("preserves the release when the validated controller ledger fails while sourcing", async () => {
    const root = await mkdtemp(join(tmpdir(), "diesel-controller-bootstrap-"));
    const deployRoot = join(root, "diesel");
    const releaseDirectory = join(deployRoot, "releases", RELEASE_ID);
    const deployDirectory = join(releaseDirectory, "scripts", "deploy");
    const entry = join(deployDirectory, "release-publication-controller.sh");
    const ledger = join(deployDirectory, "host-activation-ledger.sh");
    await mkdir(deployDirectory, { recursive: true });
    await writeFile(ledger, "return 23\n", "utf8");

    try {
      const result = await execute("/bin/bash", [
        "--noprofile",
        "--norc",
        "-c",
        [
          'source -- "$1"',
          "release_publication_controller_require_cli_bootstrap_path() { :; }",
          'release_publication_controller_cli_bootstrap "$2" "$3" "$4"',
        ].join("\n"),
        "controller-bootstrap-fixture",
        controllerScript,
        RELEASE_ID,
        deployRoot,
        entry,
      ]);

      expect(result).toEqual({ exitCode: 75, stderr: "", stdout: "" });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it.each([
    ["fresh directory", "directory", "no", "0", "0", "755", "2", "1001", 0],
    ["normalized directory", "directory", "no", "0", "1001", "750", "2", "1001", 0],
    ["fresh executable", "file", "yes", "0", "0", "755", "1", "1001", 0],
    ["normalized executable", "file", "yes", "0", "1001", "750", "1", "1001", 0],
    ["fresh regular file", "file", "no", "0", "0", "644", "1", "1001", 0],
    ["normalized regular file", "file", "no", "0", "1001", "640", "1", "1001", 0],
    ["private staged directory", "directory", "no", "0", "0", "700", "2", "1001", 1],
    ["mixed normalized directory", "directory", "no", "0", "1001", "755", "2", "1001", 1],
    ["mixed staged executable", "file", "yes", "0", "0", "750", "1", "1001", 1],
    ["private normalized file", "file", "no", "0", "1001", "600", "1", "1001", 1],
    ["hard-linked staged file", "file", "no", "0", "0", "644", "2", "1001", 1],
    ["non-root owner", "file", "yes", "501", "0", "755", "1", "1001", 1],
    ["unexpected group", "file", "yes", "0", "999", "755", "1", "1001", 1],
    ["special mode bits", "file", "yes", "0", "0", "4755", "1", "1001", 1],
    ["root diesel group", "file", "yes", "0", "0", "750", "1", "0", 1],
  ] as const)(
    "classifies $0 in the exact staged metadata closure",
    async (
      _name,
      pathType,
      executablePolicy,
      owner,
      group,
      mode,
      linkCount,
      dieselGid,
      expectedStatus,
    ) => {
      const result = await execute("/bin/bash", [
        "--noprofile",
        "--norc",
        "-c",
        'source -- "$1"; release_publication_controller_staged_metadata_is_allowed "$2" "$3" "$4" "$5" "$6" "$7" "$8"',
        "controller-metadata-harness",
        controllerScript,
        pathType,
        executablePolicy,
        owner,
        group,
        mode,
        linkCount,
        dieselGid,
      ]);

      expect(result).toEqual({
        exitCode: expectedStatus,
        stderr: "",
        stdout: "",
      });
    },
  );

  it("delegates all durable transitions and excludes rollback or recovery modes", async () => {
    const source = await readFile(controllerScript, "utf8");

    expect(source).toContain("release_publication_controller_reconcile");
    expect(source.includes("publish | finalize-committed | application | finalize-application)")).toBe(true);
    expect(source).not.toMatch(
      /host_activation_ledger_(?:begin|transition|write_record)/,
    );
    expect(
      source.match(
        /"\$\{release_dir\}\/scripts\/deploy\/rollback-host-release\.sh"/gu,
      ),
    ).toHaveLength(1);
    expect(source).not.toContain("release_publication_controller_run_rollback");
    expect(source).not.toContain("recover-required");
    expect(source).not.toMatch(
      /\b(?:cp|install|ln|mv|rm)\b[^\n]*(?:HOST_ACTIVATION_|PUBLISH_)/,
    );
  });

  it.each([
    {
      expectedEvents: ["require-pending", "reconcile"],
      ledgerState: "PENDING:none",
    },
    {
      expectedEvents: ["reconcile-committed"],
      ledgerState: "PENDING:PUBLISH_COMMITTED",
    },
    {
      expectedEvents: ["reconcile-committed"],
      ledgerState: "PENDING:PUBLISH_FINALIZED",
    },
    {
      expectedEvents: ["reconcile-committed"],
      ledgerState: "COMMITTED:PUBLISH_FINALIZED",
    },
  ])(
    "routes production entry state $ledgerState through the closed reconciler",
    async ({ expectedEvents, ledgerState }) => {
      const result = await runProductionEntryScenario(ledgerState);

      expect(result.exitCode).toBe(0);
      expect(result.events).toEqual(expectedEvents);
    },
  );

  it.each([
    "PENDING:RECOVERY_REQUIRED",
    "PENDING:HOST_ROLLBACK_REQUIRED",
    "ROLLED_BACK:none",
    "ROLLED_BACK:HOST_ROLLBACK_COMPLETED",
    "COMMITTED:none",
  ])("rejects production entry state %s", async (ledgerState) => {
    const result = await runProductionEntryScenario(ledgerState);

    expect(result.exitCode).toBe(70);
    expect(result.events).toEqual([]);
  });

  it.each([
    { expectedStatus: 70, ledgerState: "PENDING:none" },
    {
      expectedStatus: 75,
      ledgerState: "PENDING:PUBLISH_COMMITTED",
    },
  ])(
    "rejects an untrusted rollback helper in $ledgerState as $expectedStatus",
    async ({ expectedStatus, ledgerState }) => {
      const result = await runProductionEntryScenario(ledgerState, 0, {
        stagedPathFailureStatus: 23,
        stagedPathFailureSuffix: "/rollback-host-release.sh",
      });

      expect(result.exitCode).toBe(expectedStatus);
      expect(result.events).toEqual([
        `staged-reject:${result.deployRoot}/releases/${RELEASE_ID}/scripts/deploy/rollback-host-release.sh`,
      ]);
      expect(result.events[0]).not.toContain("/opt/diesel");
    },
  );

  it("preserves the distinct non-root CLI status", async () => {
    const result = await runProductionEntryScenario("PENDING:none", 501);

    expect(result.exitCode).toBe(77);
    expect(result.events).toEqual([]);
  });

  it("preserves an unclassified bootstrap failure instead of claiming rollback is safe", async () => {
    const result = await runProductionEntryScenario("PENDING:none", 0, {
      fixedNodeStatus: 23,
    });

    expect(result.exitCode).toBe(75);
    expect(result.events).toEqual([]);
  });

  it("preserves unknown state when production entry lacks lifecycle descriptor 8", async () => {
    const result = await runProductionEntryScenario("PENDING:none", 0, {
      inheritedLifecycleFd: false,
    });

    expect(result.exitCode).toBe(75);
    expect(result.events).toEqual([]);
    expect(result.stderr).toContain(
      "requires inherited lifecycle lock descriptor 8",
    );
  });

  it.each([
    "PENDING:PUBLISH_COMMITTED",
    "PENDING:PUBLISH_FINALIZED",
    "COMMITTED:PUBLISH_FINALIZED",
  ])(
    "maps a staged preflight failure in known state %s to preserve status",
    async (ledgerState) => {
      const result = await runProductionEntryScenario(ledgerState, 0, {
        stagedPathStatus: 23,
      });

      expect(result.exitCode).toBe(75);
      expect(result.events).toEqual([]);
    },
  );

  it.each([
    { expectedStatus: 70, stagedPathStatus: 23 },
    { expectedStatus: 143, stagedPathStatus: 143 },
  ])(
    "maps classified PENDING:none staged status $stagedPathStatus to $expectedStatus",
    async ({ expectedStatus, stagedPathStatus }) => {
      const result = await runProductionEntryScenario("PENDING:none", 0, {
        stagedPathStatus,
      });

      expect(result.exitCode).toBe(expectedStatus);
      expect(result.events).toEqual([]);
    },
  );

  it("normalizes every nonzero committed reconciler result to preserve status", async () => {
    const result = await runProductionEntryScenario(
      "PENDING:PUBLISH_COMMITTED",
      0,
      { reconcileCommittedStatus: 143 },
    );

    expect(result.exitCode).toBe(75);
    expect(result.events).toEqual(["reconcile-committed"]);
  });

  it("orders prepare, activation, publication, and terminal finalization", async () => {
    const result = await runScenario({
      strictStates: [
        "PENDING:PUBLISH_COMMITTED",
        "COMMITTED:PUBLISH_FINALIZED",
      ],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.events).toEqual([
      `pending:0:${RELEASE_ID}`,
      `prepare:${RELEASE_ID}`,
      `pending:0:${RELEASE_ID}`,
      `activate:${RELEASE_ID}`,
      `current:${RELEASE_ID}`,
      `governance:publish:${RELEASE_ID}`,
      `read:PENDING:PUBLISH_COMMITTED:${RELEASE_ID}`,
      `governance:finalize-committed:${RELEASE_ID}`,
      `read:COMMITTED:PUBLISH_FINALIZED:${RELEASE_ID}`,
    ]);
  });

  it.each([
    {
      expectedActions: ["pending:23"],
      name: "initial pending proof",
      scenario: { pendingStatuses: [23] },
    },
    {
      expectedActions: ["pending:0", "prepare"],
      name: "prepare",
      scenario: { prepareStatus: 23 },
    },
    {
      expectedActions: ["pending:0", "prepare", "pending:23"],
      name: "post-prepare pending proof",
      scenario: { pendingStatuses: [0, 23] },
    },
    {
      expectedActions: ["pending:0", "prepare", "pending:0", "activate"],
      name: "activation",
      scenario: { activateStatus: 23 },
    },
    {
      expectedActions: [
        "pending:0",
        "prepare",
        "pending:0",
        "activate",
        "current",
      ],
      name: "activated-current proof",
      scenario: { currentStatus: 23 },
    },
    {
      expectedActions: [
        "pending:0",
        "prepare",
        "pending:0",
        "activate",
        "current",
        "governance:publish",
      ],
      name: "pre-commit publish",
      scenario: {
        publishStatus: 23,
        strictStates: ["PENDING:none"],
      },
    },
  ] satisfies Array<{
    expectedActions: string[];
    name: string;
    scenario: ControllerScenario;
  }>)("normalizes an ordinary $name failure to 70 and stops", async ({
    expectedActions,
    scenario,
  }) => {
    const result = await runScenario(scenario);

    expect(result.exitCode).toBe(70);
    expect(actionEvents(result.events)).toEqual(expectedActions);
    expect(actionEvents(result.events)).not.toContain(
      "governance:finalize-committed",
    );
  });

  it.each(
    ([129, 130, 137, 143] as const).flatMap((status) => [
      {
        expectedActions: ["pending:0", "prepare"],
        name: `prepare ${status}`,
        scenario: { prepareStatus: status },
        status,
      },
      {
        expectedActions: [
          "pending:0",
          "prepare",
          "pending:0",
          "activate",
        ],
        name: `activation ${status}`,
        scenario: { activateStatus: status },
        status,
      },
      {
        expectedActions: [
          "pending:0",
          "prepare",
          "pending:0",
          "activate",
          "current",
        ],
        name: `current proof ${status}`,
        scenario: { currentStatus: status },
        status,
      },
      {
        expectedActions: [
          "pending:0",
          "prepare",
          "pending:0",
          "activate",
          "current",
          "governance:publish",
        ],
        name: `pre-commit publish ${status}`,
        scenario: {
          publishStatus: status,
          strictStates: ["PENDING:none"],
        },
        status,
      },
    ]),
  )("preserves signal-shaped status for $name", async ({
    expectedActions,
    scenario,
    status,
  }) => {
    const result = await runScenario(scenario);

    expect(result.exitCode).toBe(status);
    expect(actionEvents(result.events)).toEqual(expectedActions);
    expect(actionEvents(result.events)).not.toContain(
      "governance:finalize-committed",
    );
  });

  it("fails closed when publish returns zero without a commit-shaped ledger", async () => {
    const result = await runScenario({ strictStates: ["PENDING:none"] });

    expect(result.exitCode).toBe(70);
    expect(actionEvents(result.events)).toEqual([
      "pending:0",
      "prepare",
      "pending:0",
      "activate",
      "current",
      "governance:publish",
    ]);
    expect(result.stderr).toContain(
      "publish returned success without a commit-shaped ledger",
    );
  });

  it.each([
    "PENDING:none",
    "PENDING:RECOVERY_REQUIRED",
    "PENDING:HOST_ROLLBACK_REQUIRED",
    "ROLLED_BACK:HOST_ROLLBACK_REQUIRED",
    "ROLLED_BACK:none",
    "ROLLED_BACK:HOST_ROLLBACK_COMPLETED",
  ])(
    "returns a rollback-capable failure for strict post-publish state %s",
    async (strictState) => {
      const result = await runScenario({
        publishStatus: 23,
        strictStates: [strictState],
      });

      expect(result.exitCode).toBe(70);
      expect(actionEvents(result.events)).not.toContain(
        "governance:finalize-committed",
      );
    },
  );

  it("preserves an unknown strict post-publish state", async () => {
    const result = await runScenario({
      publishStatus: 23,
      strictStates: ["COMMITTED:none"],
    });

    expect(result.exitCode).toBe(75);
    expect(actionEvents(result.events)).not.toContain(
      "governance:finalize-committed",
    );
  });

  it.each([
    {
      publishState: "PENDING:PUBLISH_COMMITTED",
      publishStatus: 23,
    },
    {
      publishState: "PENDING:PUBLISH_FINALIZED",
      publishStatus: 41,
    },
  ])(
    "finalizes $publishState even when publish exits $publishStatus",
    async ({ publishState, publishStatus }) => {
      const result = await runScenario({
        publishStatus,
        strictStates: [publishState, "COMMITTED:PUBLISH_FINALIZED"],
      });

      expect(result.exitCode).toBe(0);
      expect(actionEvents(result.events)).toContain(
        "governance:finalize-committed",
      );
      expect(result.events.at(-1)).toBe(
        `read:COMMITTED:PUBLISH_FINALIZED:${RELEASE_ID}`,
      );
    },
  );

  it.each([129, 130, 137, 143])(
    "preserves commit-shaped state as 75 when publish exits %s",
    async (publishStatus) => {
      const result = await runScenario({
        publishStatus,
        strictStates: ["PENDING:PUBLISH_COMMITTED"],
      });

      expect(result.exitCode).toBe(75);
      expect(actionEvents(result.events)).not.toContain(
        "governance:finalize-committed",
      );
      expect(result.events.at(-1)).toBe(
        `read:PENDING:PUBLISH_COMMITTED:${RELEASE_ID}`,
      );
    },
  );

  it.each([
    {
      finalState: "PENDING:PUBLISH_COMMITTED",
      finalizeStatus: 23,
      name: "ordinary finalize failure",
    },
    {
      finalState: "PENDING:PUBLISH_FINALIZED",
      finalizeStatus: 143,
      name: "signal-shaped finalize failure",
    },
    {
      finalState: "PENDING:PUBLISH_FINALIZED",
      finalizeStatus: 0,
      name: "zero exit without terminal convergence",
    },
  ])("returns 75 after $name", async ({ finalState, finalizeStatus }) => {
    const result = await runScenario({
      finalizeStatus,
      strictStates: ["PENDING:PUBLISH_COMMITTED", finalState],
    });

    expect(result.exitCode).toBe(75);
    expect(actionEvents(result.events).at(-1)).toBe(
      "governance:finalize-committed",
    );
    expect(result.events.at(-1)).toBe(`read:${finalState}:${RELEASE_ID}`);
  });

  it.each([23, 143])(
    "lets exact terminal fact win after finalize exits %s",
    async (finalizeStatus) => {
      const result = await runScenario({
        finalizeStatus,
        strictStates: [
          "PENDING:PUBLISH_COMMITTED",
          "COMMITTED:PUBLISH_FINALIZED",
        ],
      });

      expect(result.exitCode).toBe(0);
      expect(result.events.at(-1)).toBe(
        `read:COMMITTED:PUBLISH_FINALIZED:${RELEASE_ID}`,
      );
    },
  );

  it("preserves state when the strict read fails after publish", async () => {
    const result = await runScenario({
      readFailureAt: 1,
      readFailureStatus: 28,
    });

    expect(result.exitCode).toBe(75);
    expect(result.events.at(-1)).toBe(`read:error:${RELEASE_ID}`);
    expect(actionEvents(result.events)).not.toContain(
      "governance:finalize-committed",
    );
  });

  it("does not republish an exact terminal retry", async () => {
    const result = await runScenario({
      entryPoint: "reconcile-committed",
      strictStates: ["COMMITTED:PUBLISH_FINALIZED"],
    });

    expect(result.exitCode).toBe(0);
    expect(result.events.at(-1)).toBe(
      `read:COMMITTED:PUBLISH_FINALIZED:${RELEASE_ID}`,
    );
    expect(actionEvents(result.events)).toEqual([
      "governance:finalize-committed",
    ]);
  });

  it.each(["PENDING:PUBLISH_COMMITTED", "PENDING:PUBLISH_FINALIZED"])(
    "resumes a %s retry with finalize only",
    async (entryState) => {
    const result = await runScenario({
      entryPoint: "reconcile-committed",
      strictStates: [
        entryState,
        "COMMITTED:PUBLISH_FINALIZED",
      ],
    });

    expect(result.exitCode).toBe(0);
    expect(actionEvents(result.events)).toEqual([
      "governance:finalize-committed",
    ]);
    expect(actionEvents(result.events)).not.toContain("governance:publish");
    },
  );

  it.each([23, 143])(
    "does not let a pre-existing terminal ledger hide finalize status %s",
    async (finalizeStatus) => {
      const result = await runScenario({
        entryPoint: "reconcile-committed",
        finalizeStatus,
        strictStates: [
          "COMMITTED:PUBLISH_FINALIZED",
          "COMMITTED:PUBLISH_FINALIZED",
        ],
      });

      expect(result.exitCode).toBe(75);
      expect(actionEvents(result.events)).toEqual([
        "governance:finalize-committed",
      ]);
      expect(result.events.at(-1)).toBe(
        `read:COMMITTED:PUBLISH_FINALIZED:${RELEASE_ID}`,
      );
    },
  );

  it("returns the real pre-commit process-group signal without publishing", async () => {
    const result = await runProcessGroupSignalScenario("prepare");

    expect(result.exitCode).toBe(143);
    expect(result.events).toEqual(["pending", "prepare"]);
  }, 10_000);

  it("preserves commit-shaped state after a real process-group signal", async () => {
    const result = await runProcessGroupSignalScenario("publish");

    expect(result.exitCode).toBe(75);
    expect(result.events).toEqual([
      "pending",
      "prepare",
      "pending",
      "activate",
      "current",
      "governance:publish",
      "read:PENDING:PUBLISH_COMMITTED",
    ]);
    expect(result.events).not.toContain("governance:finalize-committed");
  }, 10_000);

  it.each(["main", "wrapper"] as const)(
    "keeps the controller %s supervisor seam alive for a real process-group signal",
    async (entryPoint) => {
      const result = await runSupervisorLayerSignalScenario(entryPoint);

      expect(result.exitCode).toBe(143);
      expect(result.events).toEqual(["child"]);
      expect(result.stderr).toBe("");
    },
    10_000,
  );

  it("preserves a non-terminal committed retry interrupted during finalize", async () => {
    const result = await runFinalizeSignalScenario(false);

    expect(result.exitCode).toBe(75);
    expect(result.events).toEqual([
      "read:PENDING:PUBLISH_COMMITTED",
      "finalize:start",
      "read:PENDING:PUBLISH_COMMITTED",
    ]);
    expect(result.stderr).toContain(
      "publication finalization did not reach an exact terminal ledger",
    );
  }, 10_000);

  it("lets a fresh durable terminal fact win over a finalize signal tail", async () => {
    const result = await runFinalizeSignalScenario(true);

    expect(result.exitCode).toBe(0);
    expect(result.events).toEqual([
      "read:PENDING:PUBLISH_COMMITTED",
      "finalize:start",
      "finalize:terminal",
      "read:COMMITTED:PUBLISH_FINALIZED",
    ]);
    expect(result.stderr).toBe("");
  }, 10_000);
});
