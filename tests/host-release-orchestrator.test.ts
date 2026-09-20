import { execFile, spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const orchestratorScript = resolve(
  process.cwd(),
  "scripts/deploy/host-release-orchestrator.sh",
);
const RELEASE_ID = "a".repeat(40);

type CommandResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

type Scenario = {
  acquireStatus?: number;
  beginStatus?: number;
  controllerStatus?: number;
  directAbortStatus?: number;
  governanceRecoveryStatus?: number;
  installStatus?: number;
  persistStatus?: number;
  preflightStatus?: number;
  readStatusAt?: number;
  readbackStatus?: number;
  states?: string[];
};

type ScenarioResult = CommandResult & {
  events: string[];
};

async function execute(
  command: string,
  args: string[],
  environment?: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  try {
    const result = await execFileAsync(command, args, { env: environment });
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

function scenarioHarness(): string {
  return [
    'source -- "$1"',
    'HOST_RELEASE_ORCHESTRATOR_DEPLOY_ROOT="${ORCHESTRATOR_FIXTURE_ROOT}"',
    'HOST_RELEASE_ORCHESTRATOR_RELEASE_ID="$2"',
    'HOST_RELEASE_ORCHESTRATOR_CANDIDATE_PATH="${ORCHESTRATOR_FIXTURE_ROOT}/candidate"',
    'HOST_RELEASE_ORCHESTRATOR_RELEASE_DIR="${ORCHESTRATOR_FIXTURE_ROOT}/releases/$2"',
    'HOST_RELEASE_ORCHESTRATOR_STATE_DIR="${ORCHESTRATOR_FIXTURE_ROOT}/backups/$2"',
    'HOST_RELEASE_ORCHESTRATOR_ENVIRONMENT_TEMP=""',
    'orchestrator_test_log() { printf "%s\\n" "$1" >>"${ORCHESTRATOR_LOG}"; }',
    'host_release_orchestrator_preflight_candidate() { orchestrator_test_log preflight; return "${PREFLIGHT_STATUS}"; }',
    'host_release_orchestrator_acquire_lock() {',
    '  orchestrator_test_log acquire',
    '  exec 8<>/dev/null',
    '  HOST_RELEASE_ORCHESTRATOR_LOCK_OPEN=1',
    '  export DIESEL_RELEASE_LIFECYCLE_LOCK_FD=8',
    '  return "${ACQUIRE_STATUS}"',
    '}',
    'host_release_orchestrator_persist_basis() { orchestrator_test_log basis; return "${PERSIST_STATUS}"; }',
    'host_release_orchestrator_begin_activation() { orchestrator_test_log begin; return "${BEGIN_STATUS}"; }',
    'ORCHESTRATOR_READ_COUNT=0',
    'host_release_orchestrator_read_strict_state() {',
    '  ORCHESTRATOR_READ_COUNT=$((ORCHESTRATOR_READ_COUNT + 1))',
    '  if [[ "${READ_STATUS_AT}" == "${ORCHESTRATOR_READ_COUNT}" ]]; then',
    '    orchestrator_test_log "state:error"',
    '    return 70',
    '  fi',
    '  local -a fixture_states=()',
    '  local state_index',
    '  IFS="|" read -r -a fixture_states <<<"${STRICT_STATES}"',
    '  state_index=$((ORCHESTRATOR_READ_COUNT - 1))',
    '  if (( state_index >= ${#fixture_states[@]} )); then state_index=$((${#fixture_states[@]} - 1)); fi',
    '  HOST_RELEASE_ORCHESTRATOR_STRICT_STATE="${fixture_states[${state_index}]}"',
    '  orchestrator_test_log "state:${HOST_RELEASE_ORCHESTRATOR_STRICT_STATE}"',
    '}',
    'host_release_orchestrator_install_candidate() { orchestrator_test_log install; return "${INSTALL_STATUS}"; }',
    'host_release_orchestrator_readback_environment() { orchestrator_test_log readback; return "${READBACK_STATUS}"; }',
    'host_release_orchestrator_run_controller() { orchestrator_test_log controller; return "${CONTROLLER_STATUS}"; }',
    'host_release_orchestrator_cleanup_environment_temp() { orchestrator_test_log cleanup; }',
    'host_release_orchestrator_close_lock() {',
    '  if [[ "${HOST_RELEASE_ORCHESTRATOR_LOCK_OPEN:-0}" -eq 1 ]]; then',
    '    orchestrator_test_log close',
    '    exec 8>&-',
    '    unset DIESEL_RELEASE_LIFECYCLE_LOCK_FD',
    '    HOST_RELEASE_ORCHESTRATOR_LOCK_OPEN=0',
    '  fi',
    '}',
    'host_release_orchestrator_run_direct_abort() { orchestrator_test_log rollback; return "${DIRECT_ABORT_STATUS}"; }',
    'host_release_orchestrator_run_governance_recovery() { orchestrator_test_log recovery; return "${GOVERNANCE_RECOVERY_STATUS}"; }',
    'host_release_orchestrator_run_main "$2" "${HOST_RELEASE_ORCHESTRATOR_CANDIDATE_PATH}"',
  ].join("\n");
}

async function runScenario(scenario: Scenario = {}): Promise<ScenarioResult> {
  const root = await mkdtemp(join(tmpdir(), "diesel-host-orchestrator-"));
  const logPath = join(root, "events.log");
  await writeFile(logPath, "", "utf8");

  try {
    const result = await execute(
      "/bin/bash",
      [
        "--noprofile",
        "--norc",
        "-c",
        scenarioHarness(),
        "host-orchestrator-fixture",
        orchestratorScript,
        RELEASE_ID,
      ],
      {
        ...process.env,
        ACQUIRE_STATUS: String(scenario.acquireStatus ?? 0),
        BEGIN_STATUS: String(scenario.beginStatus ?? 0),
        CONTROLLER_STATUS: String(scenario.controllerStatus ?? 0),
        DIRECT_ABORT_STATUS: String(scenario.directAbortStatus ?? 0),
        GOVERNANCE_RECOVERY_STATUS: String(
          scenario.governanceRecoveryStatus ?? 0,
        ),
        INSTALL_STATUS: String(scenario.installStatus ?? 0),
        ORCHESTRATOR_FIXTURE_ROOT: root,
        ORCHESTRATOR_LOG: logPath,
        PERSIST_STATUS: String(scenario.persistStatus ?? 0),
        PREFLIGHT_STATUS: String(scenario.preflightStatus ?? 0),
        READ_STATUS_AT: String(scenario.readStatusAt ?? 0),
        READBACK_STATUS: String(scenario.readbackStatus ?? 0),
        STRICT_STATES: (scenario.states ?? ["PENDING:none"]).join("|"),
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

async function runInvalidConfigurationPreflight(
  candidateEnvironment: string,
): Promise<ScenarioResult> {
  const root = await mkdtemp(join(tmpdir(), "diesel-host-preflight-"));
  const logPath = join(root, "events.log");
  const candidatePath = join(root, "candidate.env");
  const contractPath = resolve(
    process.cwd(),
    "scripts/deploy/runtime-environment-contract.cjs",
  );
  await Promise.all([
    writeFile(logPath, "", "utf8"),
    writeFile(candidatePath, candidateEnvironment, "utf8"),
  ]);
  const preflightProbe = [
    'const { readFileSync } = require("node:fs");',
    'const { parseEnv } = require("node:util");',
    "const [candidatePath, contractPath] = process.argv.slice(1);",
    "try {",
    "  const contract = require(contractPath);",
    '  const values = parseEnv(readFileSync(candidatePath, "utf8"));',
    "  contract.validateProductionAiAdmissionConfiguration(values);",
    "  contract.validateProductionAiChatRateLimitConfiguration(values);",
    "} catch {",
    '  process.stderr.write("environment candidate validation failed\\n");',
    "  process.exit(70);",
    "}",
  ].join("\n");
  const harness = [
    'source -- "$1"',
    'HOST_RELEASE_ORCHESTRATOR_DEPLOY_ROOT="${ORCHESTRATOR_FIXTURE_ROOT}"',
    'HOST_RELEASE_ORCHESTRATOR_RELEASE_ID="$2"',
    'HOST_RELEASE_ORCHESTRATOR_CANDIDATE_PATH="${ORCHESTRATOR_CANDIDATE}"',
    'HOST_RELEASE_ORCHESTRATOR_RELEASE_DIR="${ORCHESTRATOR_FIXTURE_ROOT}/releases/$2"',
    'HOST_RELEASE_ORCHESTRATOR_STATE_DIR="${ORCHESTRATOR_FIXTURE_ROOT}/backups/$2"',
    'HOST_RELEASE_ORCHESTRATOR_NODE_BINARY="${ORCHESTRATOR_NODE}"',
    'HOST_RELEASE_ORCHESTRATOR_RUNTIME_ENVIRONMENT_CONTRACT="${ORCHESTRATOR_CONTRACT}"',
    'HOST_RELEASE_ORCHESTRATOR_ENVIRONMENT_TEMP=""',
    'preflight_log() { printf "%s\\n" "$1" >>"${ORCHESTRATOR_LOG}"; }',
    'host_release_orchestrator_preflight_candidate() {',
    '  preflight_log preflight',
    '  "${HOST_RELEASE_ORCHESTRATOR_NODE_BINARY}" -e "${ORCHESTRATOR_PREFLIGHT_PROBE}" -- "${HOST_RELEASE_ORCHESTRATOR_CANDIDATE_PATH}" "${HOST_RELEASE_ORCHESTRATOR_RUNTIME_ENVIRONMENT_CONTRACT}"',
    '}',
    'host_release_orchestrator_acquire_lock() { preflight_log acquire; }',
    'host_release_orchestrator_persist_basis() { preflight_log basis; }',
    'host_release_orchestrator_begin_activation() { preflight_log begin; }',
    'host_release_orchestrator_read_strict_state() { preflight_log state; }',
    'host_release_orchestrator_install_candidate() { preflight_log install; }',
    'host_release_orchestrator_readback_environment() { preflight_log readback; }',
    'host_release_orchestrator_run_controller() { preflight_log controller; }',
    'host_release_orchestrator_run_direct_abort() { preflight_log rollback; }',
    'host_release_orchestrator_run_governance_recovery() { preflight_log recovery; }',
    'host_release_orchestrator_cleanup_environment_temp() { preflight_log cleanup; }',
    'host_release_orchestrator_close_lock() { preflight_log close; }',
    'host_release_orchestrator_run_main "$2" "${HOST_RELEASE_ORCHESTRATOR_CANDIDATE_PATH}"',
  ].join("\n");

  try {
    const result = await execute(
      "/bin/bash",
      [
        "--noprofile",
        "--norc",
        "-c",
        harness,
        "host-orchestrator-preflight-fixture",
        orchestratorScript,
        RELEASE_ID,
      ],
      {
        ...process.env,
        ORCHESTRATOR_CANDIDATE: candidatePath,
        ORCHESTRATOR_CONTRACT: contractPath,
        ORCHESTRATOR_FIXTURE_ROOT: root,
        ORCHESTRATOR_LOG: logPath,
        ORCHESTRATOR_NODE: process.execPath,
        ORCHESTRATOR_PREFLIGHT_PROBE: preflightProbe,
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

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      if ((await readFile(path, "utf8")) === "ready\n") return;
    } catch {
      // The marker may not have been created yet.
    }
    // Creation and writing are separate: an existing marker may still be empty.
    await new Promise<void>((resolveDelay) => {
      setTimeout(resolveDelay, 25);
    });
  }
  throw new Error(`timed out waiting for signal fixture: ${path}`);
}

async function runSignalScenario(
  signal: "SIGHUP" | "SIGINT" | "SIGTERM",
  controllerStatus = 23,
  phase: "begin" | "controller" = "controller",
  registrationRace?: "before-registration" | "after-registration",
): Promise<ScenarioResult> {
  const root = await mkdtemp(join(tmpdir(), "diesel-host-signal-"));
  const logPath = join(root, "events.log");
  const readyPath = join(root, "ready");
  const blockPath = join(root, "block.fifo");
  const harness = [
    'source -- "$1"',
    'HOST_RELEASE_ORCHESTRATOR_DEPLOY_ROOT="${ORCHESTRATOR_FIXTURE_ROOT}"',
    'HOST_RELEASE_ORCHESTRATOR_RELEASE_ID="$2"',
    'HOST_RELEASE_ORCHESTRATOR_CANDIDATE_PATH="${ORCHESTRATOR_FIXTURE_ROOT}/candidate"',
    'HOST_RELEASE_ORCHESTRATOR_RELEASE_DIR="${ORCHESTRATOR_FIXTURE_ROOT}/releases/$2"',
    'HOST_RELEASE_ORCHESTRATOR_STATE_DIR="${ORCHESTRATOR_FIXTURE_ROOT}/backups/$2"',
    'HOST_RELEASE_ORCHESTRATOR_ENVIRONMENT_TEMP=""',
    'signal_log() { printf "%s\\n" "$1" >>"${ORCHESTRATOR_LOG}"; }',
    'host_release_orchestrator_preflight_candidate() { signal_log preflight; }',
    'host_release_orchestrator_acquire_lock() { signal_log acquire; exec 8<>/dev/null; HOST_RELEASE_ORCHESTRATOR_LOCK_OPEN=1; export DIESEL_RELEASE_LIFECYCLE_LOCK_FD=8; }',
    'host_release_orchestrator_persist_basis() { signal_log basis; }',
    'signal_block() {',
    '  trap \'signal_log child:HUP; exit "${SIGNAL_CONTROLLER_STATUS}"\' HUP',
    '  trap \'signal_log child:INT; exit "${SIGNAL_CONTROLLER_STATUS}"\' INT',
    '  trap \'signal_log child:TERM; exit "${SIGNAL_CONTROLLER_STATUS}"\' TERM',
    '  exec 9<>"${ORCHESTRATOR_BLOCK}"',
    '  printf "ready\\n" >"${ORCHESTRATOR_READY}"',
    '  IFS= read -r _ <&9',
    '  return "${SIGNAL_CONTROLLER_STATUS}"',
    '}',
    'host_release_orchestrator_begin_activation() { signal_log begin; if [[ "${SIGNAL_PHASE}" == begin ]]; then signal_block; fi; }',
    'host_release_orchestrator_read_strict_state() { HOST_RELEASE_ORCHESTRATOR_STRICT_STATE=PENDING:none; signal_log state:PENDING:none; }',
    'host_release_orchestrator_install_candidate() { signal_log install; }',
    'host_release_orchestrator_readback_environment() { signal_log readback; }',
    'host_release_orchestrator_run_controller() {',
    '  signal_log controller',
    '  signal_block',
    '}',
    'host_release_orchestrator_cleanup_environment_temp() { signal_log cleanup; }',
    'host_release_orchestrator_close_lock() { if [[ "${HOST_RELEASE_ORCHESTRATOR_LOCK_OPEN:-0}" -eq 1 ]]; then signal_log close; exec 8>&-; unset DIESEL_RELEASE_LIFECYCLE_LOCK_FD; HOST_RELEASE_ORCHESTRATOR_LOCK_OPEN=0; fi; }',
    'host_release_orchestrator_run_direct_abort() { signal_log rollback; }',
    'host_release_orchestrator_run_governance_recovery() { signal_log recovery; }',
    'host_release_orchestrator_forward_signal_to_active_child() {',
    '  signal_log "forward:$1"',
    '  builtin kill -s "$1" -- "-${HOST_RELEASE_ORCHESTRATOR_ACTIVE_CHILD_PID}" 2>/dev/null ||',
    '    builtin kill -s "$1" "${HOST_RELEASE_ORCHESTRATOR_ACTIVE_CHILD_PID}" 2>/dev/null || true',
    '}',
    'SIGNAL_SPAWN_COUNT=0',
    'host_release_orchestrator_after_child_spawn_before_registration() {',
    '  SIGNAL_SPAWN_COUNT=$((SIGNAL_SPAWN_COUNT + 1))',
    '  if [[ "${SIGNAL_REGISTRATION_RACE}" == before-registration && "${SIGNAL_SPAWN_COUNT}" -eq 2 ]]; then',
    '    while [[ ! -f "${ORCHESTRATOR_READY}" ]]; do /bin/sleep 0.01; done',
    '    builtin kill -TERM "$$"',
    '  fi',
    '}',
    'host_release_orchestrator_after_child_registration_before_signal_replay() {',
    '  if [[ "${SIGNAL_REGISTRATION_RACE}" == after-registration && "${SIGNAL_SPAWN_COUNT}" -eq 2 ]]; then',
    '    while [[ ! -f "${ORCHESTRATOR_READY}" ]]; do /bin/sleep 0.01; done',
    '    builtin kill -TERM "$$"',
    '  fi',
    '}',
    'host_release_orchestrator_run_main "$2" "${HOST_RELEASE_ORCHESTRATOR_CANDIDATE_PATH}"',
  ].join("\n");
  await writeFile(logPath, "", "utf8");
  await execFileAsync("/usr/bin/mkfifo", [blockPath]);

  const child = spawn(
    "/bin/bash",
    [
      "--noprofile",
      "--norc",
      "-c",
      harness,
      "host-orchestrator-signal-fixture",
      orchestratorScript,
      RELEASE_ID,
    ],
    {
      detached: true,
      env: {
        ...process.env,
        ORCHESTRATOR_FIXTURE_ROOT: root,
        ORCHESTRATOR_BLOCK: blockPath,
        ORCHESTRATOR_LOG: logPath,
        ORCHESTRATOR_READY: readyPath,
        SIGNAL_CONTROLLER_STATUS: String(controllerStatus),
        SIGNAL_PHASE: phase,
        SIGNAL_REGISTRATION_RACE: registrationRace ?? "none",
      },
      stdio: ["pipe", "pipe", "pipe"],
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
    child.once("close", (code, childSignal) => {
      if (code !== null) resolveCompletion(code);
      else rejectCompletion(new Error(`fixture exited by ${childSignal ?? "unknown"}`));
    });
  });
  let completionTimeout: ReturnType<typeof setTimeout> | undefined;

  try {
    await waitForFile(readyPath);
    if (child.pid === undefined) throw new Error("signal fixture has no pid");
    if (registrationRace === undefined) process.kill(child.pid, signal);
    const exitCode = await Promise.race([
      completion,
      new Promise<never>((_resolve, rejectTimeout) => {
        completionTimeout = setTimeout(
          () => rejectTimeout(new Error("signal fixture did not exit")),
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
    if (completionTimeout !== undefined) clearTimeout(completionTimeout);
    if (child.pid !== undefined && child.exitCode === null) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // The process group may have completed between the check and kill.
      }
    }
    await rm(root, { force: true, recursive: true });
  }
}

describe("host-release-orchestrator.sh", () => {
  it("validates the production AI admission contract before mutation and after installation", async () => {
    const source = await readFile(orchestratorScript, "utf8");
    const validationCalls = source.match(
      /validateProductionAiAdmissionConfiguration\(/gu,
    ) ?? [];
    const hourlyValidationCalls = source.match(
      /validateProductionAiChatRateLimitConfiguration\(/gu,
    ) ?? [];

    expect(source).toContain(
      "scripts/deploy/runtime-environment-contract.cjs",
    );
    expect(validationCalls).toHaveLength(2);
    expect(hourlyValidationCalls).toHaveLength(2);
    expect(source).toContain(
      "validateProductionAiAdmissionConfiguration(candidate.values);",
    );
    expect(source).toContain(
      "validateProductionAiChatRateLimitConfiguration(candidate.values);",
    );
    expect(source).toContain(
      "validateInstalledProductionEnvironmentFiles({",
    );
  });

  it.each([
    {
      environment: [
        "DATABASE_URL=postgresql://database.invalid/diesel",
        "AI_CHAT_ADMISSION_GLOBAL_PROVIDER_CALL_UNITS_PER_DAY=50000",
        "",
      ].join("\n"),
      label: "a missing client limit",
    },
    {
      environment: [
        "DATABASE_URL=postgresql://database.invalid/diesel",
        "AI_CHAT_ADMISSION_CLIENT_PROVIDER_CALL_UNITS_PER_DAY=501",
        "AI_CHAT_ADMISSION_GLOBAL_PROVIDER_CALL_UNITS_PER_DAY=50000",
        "",
      ].join("\n"),
      label: "a non-multiple client limit",
    },
    {
      environment: [
        "DATABASE_URL=postgresql://database.invalid/diesel",
        "AI_CHAT_ADMISSION_CLIENT_PROVIDER_CALL_UNITS_PER_DAY=500",
        "AI_CHAT_ADMISSION_GLOBAL_PROVIDER_CALL_UNITS_PER_DAY=50000",
        "AI_CHAT_RATE_LIMIT_BACKEND=memory",
        "",
      ].join("\n"),
      label: "the production memory backend",
    },
    {
      environment: [
        "DATABASE_URL=postgresql://database.invalid/diesel",
        "AI_CHAT_ADMISSION_CLIENT_PROVIDER_CALL_UNITS_PER_DAY=500",
        "AI_CHAT_ADMISSION_GLOBAL_PROVIDER_CALL_UNITS_PER_DAY=50000",
        "AI_CHAT_RATE_LIMIT_PER_HOUR=301",
        "AI_CHAT_RATE_LIMIT_GLOBAL_PER_HOUR=300",
        "AI_CHAT_RATE_LIMIT_BACKEND=postgres",
        "",
      ].join("\n"),
      label: "an hourly client limit above the global limit",
    },
  ])("rejects $label before every orchestration mutation", async ({
    environment,
  }) => {
    const result = await runInvalidConfigurationPreflight(environment);

    expect(result.exitCode).toBe(70);
    expect(result.stderr).toBe("environment candidate validation failed\n");
    expect(result.stdout).toBe("");
    expect(result.events).toEqual(["preflight", "cleanup", "close"]);
    for (const forbiddenEvent of [
      "acquire",
      "basis",
      "begin",
      "state",
      "install",
      "readback",
      "controller",
      "rollback",
      "recovery",
    ]) {
      expect(result.events).not.toContain(forbiddenEvent);
    }
    expect(`${result.stderr}${result.stdout}`).not.toContain(environment);
  });

  it("is Bash syntax-valid and sourceable without changing options or traps", async () => {
    await expect(
      execFileAsync("bash", ["-n", orchestratorScript]),
    ).resolves.toMatchObject({ stderr: "" });

    const probe = [
      'trap ":" USR1',
      'before_options="$(set +o)"',
      'before_trap="$(trap -p USR1)"',
      'source -- "$1"',
      '[[ "${before_options}" == "$(set +o)" ]] || exit 91',
      '[[ "${before_trap}" == "$(trap -p USR1)" ]] || exit 92',
      'declare -F host_release_orchestrator_run_main >/dev/null || exit 93',
    ].join("\n");
    const result = await execute("/bin/bash", [
      "--noprofile",
      "--norc",
      "-c",
      probe,
      "host-orchestrator-source-probe",
      orchestratorScript,
    ]);

    expect(result).toEqual({ exitCode: 0, stderr: "", stdout: "" });
  });

  it.skipIf(typeof process.getuid !== "function" || process.getuid() === 0)(
    "rejects a non-root direct CLI before reading the root-only candidate",
    async () => {
      const candidatePath = `/opt/diesel/release-inputs/${RELEASE_ID}/env.production.local`;
      const result = await execute("/bin/bash", [
        orchestratorScript,
        RELEASE_ID,
        candidatePath,
      ]);

      expect(result.exitCode).toBe(77);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("host release orchestrator must run as root\n");
      expect(result.stderr).not.toContain("bootstrap validation failed");
    },
  );

  it("rejects symlinked host directories and files before metadata lookup", async () => {
    const root = await mkdtemp(join(tmpdir(), "diesel-host-paths-"));
    const directory = join(root, "directory");
    const directoryLink = join(root, "directory-link");
    const file = join(root, "environment");
    const fileLink = join(root, "environment-link");
    await mkdir(directory);
    await writeFile(file, "DATABASE_URL=postgresql://invalid/diesel\n", {
      mode: 0o600,
    });
    await symlink(directory, directoryLink);
    await symlink(file, fileLink);

    try {
      for (const [helper, path, metadata] of [
        [
          "host_release_orchestrator_require_exact_directory",
          directoryLink,
          "0:0:700",
        ],
        [
          "host_release_orchestrator_require_exact_file",
          fileLink,
          "0:0:600:1",
        ],
      ] as const) {
        const result = await execute("/bin/bash", [
          "--noprofile",
          "--norc",
          "-c",
          'source -- "$1"; "$2" "$3" "$4"',
          "host-orchestrator-symlink-probe",
          orchestratorScript,
          helper,
          path,
          metadata,
        ]);

        expect(result).toEqual({ exitCode: 1, stderr: "", stdout: "" });
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it.each([
    ["exact root-only file", "0", "0", "600", "1", "1024", 0],
    ["empty file", "0", "0", "600", "1", "0", 1],
    ["oversized file", "0", "0", "600", "1", "1048577", 1],
    ["non-root owner", "501", "0", "600", "1", "1024", 1],
    ["non-root group", "0", "501", "600", "1", "1024", 1],
    ["group-readable file", "0", "0", "640", "1", "1024", 1],
    ["hard-linked file", "0", "0", "600", "2", "1024", 1],
  ] as const)(
    "classifies $0 candidate metadata",
    async (_name, owner, group, mode, links, size, expectedStatus) => {
      const result = await execute("/bin/bash", [
        "--noprofile",
        "--norc",
        "-c",
        'source -- "$1"; host_release_orchestrator_candidate_metadata_is_allowed "$2" "$3" "$4" "$5" "$6"',
        "host-orchestrator-candidate-metadata",
        orchestratorScript,
        owner,
        group,
        mode,
        links,
        size,
      ]);

      expect(result.exitCode).toBe(expectedStatus);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
    },
  );

  it("forwards a parent-only TERM to begin and closes a durable PENDING state", async () => {
    const result = await runSignalScenario("SIGTERM", 23, "begin");

    expect(result.exitCode).toBe(143);
    expect(result.events).toContain("child:TERM");
    expect(result.events.filter((event) => event === "rollback")).toHaveLength(1);
    expect(result.events).not.toContain("controller");
    expect(result.events.indexOf("close")).toBeLessThan(
      result.events.indexOf("rollback"),
    );
  }, 10_000);

  it.each([
    {
      expectedEvents: ["preflight", "cleanup"],
      expectedStatus: 70,
      name: "candidate preflight",
      scenario: { preflightStatus: 23 },
    },
    {
      expectedEvents: ["preflight", "acquire", "cleanup", "close"],
      expectedStatus: 70,
      name: "lifecycle acquisition",
      scenario: { acquireStatus: 23 },
    },
    {
      expectedEvents: ["preflight", "acquire", "basis", "cleanup", "close"],
      expectedStatus: 70,
      name: "rollback-basis durability",
      scenario: { persistStatus: 23 },
    },
    {
      expectedEvents: [
        "preflight",
        "acquire",
        "basis",
        "begin",
        "cleanup",
        "state:PENDING:none",
        "close",
        "rollback",
      ],
      expectedStatus: 70,
      name: "post-PENDING begin verification",
      scenario: { beginStatus: 23 },
    },
    {
      expectedEvents: [
        "preflight",
        "acquire",
        "basis",
        "begin",
        "state:PENDING:none",
        "install",
        "cleanup",
        "state:PENDING:none",
        "close",
        "rollback",
      ],
      expectedStatus: 70,
      name: "candidate installation",
      scenario: { installStatus: 23 },
    },
    {
      expectedEvents: [
        "preflight",
        "acquire",
        "basis",
        "begin",
        "state:PENDING:none",
        "install",
        "readback",
        "cleanup",
        "state:PENDING:none",
        "close",
        "rollback",
      ],
      expectedStatus: 70,
      name: "environment identity readback",
      scenario: { readbackStatus: 23 },
    },
  ] satisfies Array<{
    expectedEvents: string[];
    expectedStatus: number;
    name: string;
    scenario: Scenario;
  }>)("fails closed at $name", async ({ expectedEvents, expectedStatus, scenario }) => {
    const result = await runScenario(scenario);

    expect(result.exitCode).toBe(expectedStatus);
    expect(result.events).toEqual(expectedEvents);
    expect(result.events.filter((event) => event === "rollback")).toHaveLength(
      expectedEvents.includes("rollback") ? 1 : 0,
    );
  });

  it("preserves an unclassifiable begin failure without rollback", async () => {
    const result = await runScenario({ beginStatus: 23, readStatusAt: 1 });

    expect(result.exitCode).toBe(75);
    expect(result.events).toEqual([
      "preflight",
      "acquire",
      "basis",
      "begin",
      "cleanup",
      "state:error",
      "close",
    ]);
    expect(result.events).not.toContain("rollback");
  });

  it.each([
    {
      expectedEvents: [
        "preflight",
        "acquire",
        "basis",
        "begin",
        "state:PENDING:none",
        "install",
        "readback",
        "controller",
        "cleanup",
        "close",
      ],
      expectedStatus: 0,
      name: "controller success",
      status: 0,
    },
    {
      expectedEvents: [
        "preflight",
        "acquire",
        "basis",
        "begin",
        "state:PENDING:none",
        "install",
        "readback",
        "controller",
        "cleanup",
        "close",
      ],
      expectedStatus: 75,
      name: "controller preserve",
      status: 75,
    },
    {
      expectedEvents: [
        "preflight",
        "acquire",
        "basis",
        "begin",
        "state:PENDING:none",
        "install",
        "readback",
        "controller",
        "cleanup",
        "state:PENDING:none",
        "close",
        "rollback",
      ],
      expectedStatus: 70,
      name: "controller ordinary failure",
      status: 23,
    },
  ])("dispatches $name", async ({ expectedEvents, expectedStatus, status }) => {
    const result = await runScenario({ controllerStatus: status });

    expect(result.exitCode).toBe(expectedStatus);
    expect(result.events).toEqual(expectedEvents);
  });

  it("routes strict recovery state only after closing descriptor 8", async () => {
    const result = await runScenario({
      controllerStatus: 70,
      states: ["PENDING:none", "PENDING:RECOVERY_REQUIRED"],
    });

    expect(result.exitCode).toBe(70);
    expect(result.events.filter((event) => event === "recovery")).toHaveLength(1);
    expect(result.events.indexOf("close")).toBeLessThan(
      result.events.indexOf("recovery"),
    );
    expect(result.events).not.toContain("rollback");
  });

  it.each([
    "PENDING:PUBLISH_COMMITTED",
    "PENDING:PUBLISH_FINALIZED",
    "COMMITTED:PUBLISH_FINALIZED",
  ])("preserves commit-shaped state %s without rollback", async (state) => {
    const result = await runScenario({
      controllerStatus: 70,
      states: ["PENDING:none", state],
    });

    expect(result.exitCode).toBe(75);
    expect(result.events.at(-1)).toBe("close");
    expect(result.events).not.toContain("rollback");
    expect(result.events).not.toContain("recovery");
  });

  it("maps a rollback failure to 70 without retrying", async () => {
    const result = await runScenario({
      controllerStatus: 143,
      directAbortStatus: 23,
    });

    expect(result.exitCode).toBe(70);
    expect(result.events.filter((event) => event === "rollback")).toHaveLength(1);
  });

  it("uses the EXIT terminalizer once after an armed parent exits unexpectedly", async () => {
    const root = await mkdtemp(join(tmpdir(), "diesel-host-exit-"));
    const logPath = join(root, "events.log");
    await writeFile(logPath, "", "utf8");
    const harness = [
      scenarioHarness(),
    ].join("\n").replace(
      'host_release_orchestrator_install_candidate() { orchestrator_test_log install; return "${INSTALL_STATUS}"; }',
      "host_release_orchestrator_install_candidate() { orchestrator_test_log install; exit 23; }",
    );
    try {
      const result = await execute(
        "/bin/bash",
        [
          "--noprofile",
          "--norc",
          "-c",
          harness,
          "host-orchestrator-exit-fixture",
          orchestratorScript,
          RELEASE_ID,
        ],
        {
          ...process.env,
          ACQUIRE_STATUS: "0",
          BEGIN_STATUS: "0",
          CONTROLLER_STATUS: "0",
          DIRECT_ABORT_STATUS: "0",
          GOVERNANCE_RECOVERY_STATUS: "0",
          INSTALL_STATUS: "0",
          ORCHESTRATOR_FIXTURE_ROOT: root,
          ORCHESTRATOR_LOG: logPath,
          PERSIST_STATUS: "0",
          PREFLIGHT_STATUS: "0",
          READ_STATUS_AT: "0",
          READBACK_STATUS: "0",
          STRICT_STATES: "PENDING:none",
        },
      );
      const events = (await readFile(logPath, "utf8")).trim().split("\n");

      expect(result.exitCode).toBe(70);
      expect(events.filter((event) => event === "rollback")).toHaveLength(1);
      expect(events.indexOf("close")).toBeLessThan(events.indexOf("rollback"));
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it.each([
    ["SIGHUP", 129],
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const)(
    "records %s, closes FD8, and rolls back exactly once",
    async (signal, expectedStatus) => {
      const result = await runSignalScenario(signal);

      expect(result.exitCode).toBe(expectedStatus);
      expect(result.events).toContain(`child:${signal.slice(3)}`);
      expect(result.events.filter((event) => event === "rollback")).toHaveLength(1);
      expect(result.events.indexOf("close")).toBeLessThan(
        result.events.indexOf("rollback"),
      );
    },
    10_000,
  );

  it.each([0, 75] as const)(
    "lets controller status %i win over a concurrent TERM",
    async (controllerStatus) => {
      const result = await runSignalScenario("SIGTERM", controllerStatus);

      expect(result.exitCode).toBe(controllerStatus);
      expect(result.events).not.toContain("rollback");
      expect(result.events.at(-1)).toBe("close");
    },
    10_000,
  );

  it("forwards a signal recorded in the child-registration window", async () => {
    const result = await runSignalScenario(
      "SIGTERM",
      23,
      "controller",
      "before-registration",
    );

    expect(result.exitCode).toBe(143);
    expect(result.events).toContain("child:TERM");
    expect(result.events.filter((event) => event === "forward:TERM")).toHaveLength(
      1,
    );
    expect(result.events.filter((event) => event === "rollback")).toHaveLength(1);
  }, 10_000);

  it("does not double-forward a signal arriving before missed-signal replay", async () => {
    const result = await runSignalScenario(
      "SIGTERM",
      23,
      "controller",
      "after-registration",
    );

    expect(result.exitCode).toBe(143);
    expect(result.events).toContain("child:TERM");
    expect(result.events.filter((event) => event === "forward:TERM")).toHaveLength(
      1,
    );
    expect(result.events.filter((event) => event === "rollback")).toHaveLength(1);
  }, 10_000);

  it("ignores poisoned orchestration variables and never prints secret values", async () => {
    const secret = "DO_NOT_PRINT_DATABASE_SECRET";
    const root = await mkdtemp(join(tmpdir(), "diesel-host-poison-"));
    const logPath = join(root, "events.log");
    await writeFile(logPath, "", "utf8");
    try {
      const harness = [
        'source -- "$1"',
        'printf "%s\\n" "${HOST_RELEASE_ORCHESTRATOR_DEPLOY_ROOT}"',
        'printf "%s\\n" "${HOST_RELEASE_ORCHESTRATOR_INPUT_ROOT}"',
      ].join("\n");
      const result = await execute(
        "/bin/bash",
        [
          "--noprofile",
          "--norc",
          "-c",
          harness,
          "host-orchestrator-poison",
          orchestratorScript,
        ],
        {
          ...process.env,
          DATABASE_URL: `postgresql://root:${secret}@invalid/diesel`,
          HOST_RELEASE_ORCHESTRATOR_DEPLOY_ROOT: `${root}/poisoned`,
          HOST_RELEASE_ORCHESTRATOR_INPUT_ROOT: `${root}/poisoned-inputs`,
          ORCHESTRATOR_LOG: logPath,
        },
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("/opt/diesel\n/opt/diesel/release-inputs\n");
      expect(`${result.stdout}\n${result.stderr}`).not.toContain(secret);
      expect(await readFile(logPath, "utf8")).not.toContain(secret);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
