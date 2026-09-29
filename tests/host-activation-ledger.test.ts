import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { promisify } from "node:util";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  TEST_RELEASE_SHA,
  createHostActivationLedgerFixture,
  createPreparePreflightFixture,
  writeHostActivationBasis,
  type CommandResult,
  type HostActivationLedgerFixture,
} from "./helpers/deploy-runtime-fixtures";

const execFileAsync = promisify(execFile);

const prepareReleaseRuntimeScript = resolve(
  process.cwd(),
  "scripts/deploy/prepare-release-runtime.sh",
);

const hostActivationLedgerScript = resolve(
  process.cwd(),
  "scripts/deploy/host-activation-ledger.sh",
);

type HostActivationState = "COMMITTED" | "PENDING" | "ROLLED_BACK";

type HostActivationGovernanceState =
  | "HOST_ROLLBACK_COMPLETED"
  | "HOST_ROLLBACK_REQUIRED"
  | "PUBLISH_COMMITTED"
  | "PUBLISH_FINALIZED"
  | "RECOVERY_REQUIRED"
  | "none";

async function executeHostActivationCommand(
  fixture: HostActivationLedgerFixture,
  command: string,
  args: string[] = [],
  options?: { descriptor?: "missing" | "valid" | "wrong" },
): Promise<CommandResult> {
  const descriptor = options?.descriptor ?? "valid";
  const descriptorSetup = descriptor === "missing"
    ? "unset DIESEL_RELEASE_LIFECYCLE_LOCK_FD"
    : descriptor === "wrong"
      ? 'exec 7<>"$2"; export DIESEL_RELEASE_LIFECYCLE_LOCK_FD=7'
      : 'exec 8<>"$2"; export DIESEL_RELEASE_LIFECYCLE_LOCK_FD=8';
  try {
    const result = await execFileAsync(
      "/bin/bash",
      [
        "-c",
        `set -Eeuo pipefail
${descriptorSetup}
source "$1"
shift 2
${command}`,
        "host-activation-fixture",
        hostActivationLedgerScript,
        fixture.lifecycleLock,
        ...args,
      ],
      {
        env: {
          ...process.env,
          PATH: fixture.fakePath,
        },
      },
    );
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

async function executeHostActivationMode(
  fixture: HostActivationLedgerFixture,
  mode:
    | "begin"
    | "initialize-protocol"
    | "mark-committed"
    | "mark-rolled-back"
    | "require-pending"
    | "validate",
  releaseId = TEST_RELEASE_SHA,
  options?: { descriptor?: "missing" | "valid" | "wrong" },
): Promise<CommandResult> {
  return executeHostActivationCommand(
    fixture,
    'host_activation_ledger_state_machine "$1" "$2" "$3" "$4"',
    [mode, releaseId, fixture.deployRoot, fixture.nodeBinary],
    options,
  );
}

async function initializeHostActivationProtocol(
  fixture: HostActivationLedgerFixture,
  enablingRelease = TEST_RELEASE_SHA,
): Promise<CommandResult> {
  await rm(fixture.stateDir, { force: true, recursive: true });
  const result = await executeHostActivationMode(
    fixture,
    "initialize-protocol",
    enablingRelease,
  );
  await writeHostActivationBasis(fixture);
  return result;
}

async function sha256File(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function writeGovernanceLedgerMarker(
  deployRoot: string,
  releaseId: string,
  markerName: Exclude<HostActivationGovernanceState, "none">,
): Promise<string> {
  const stateDir = join(deployRoot, "backups", releaseId);
  const snapshotPath = join(stateDir, "governance-before.json");
  const markerPath = join(stateDir, markerName);
  if (!(await lstat(snapshotPath).then(() => true, () => false))) {
    await writeFile(snapshotPath, '{"fixture":true}\n', "utf8");
    await chmod(snapshotPath, 0o600);
  }
  await writeFile(
    markerPath,
    `${await sha256File(snapshotPath)}\t${snapshotPath}\n`,
    "utf8",
  );
  await chmod(markerPath, 0o600);
  return markerPath;
}

async function writeV1HostActivationState(
  fixture: HostActivationLedgerFixture,
  hostState: HostActivationState,
  governanceState: HostActivationGovernanceState,
  releaseId = TEST_RELEASE_SHA,
): Promise<{ anchor: string; marker: string; stateDir: string }> {
  const stateDir = join(fixture.backupsRoot, releaseId);
  const previousReleaseState = join(stateDir, "previous-release");
  const environmentBackup = join(
    stateDir,
    "env.production.local.pre-switch",
  );
  const nginxPrimaryBackup = join(stateDir, "jamesky.site.pre-switch");
  const nginxAlternateBackup = join(stateDir, "diesel-demo.pre-switch");
  const anchor = join(stateDir, "HOST_ACTIVATION_V1");
  const marker = join(stateDir, `HOST_ACTIVATION_${hostState}`);
  for (const markerName of [
    "HOST_ACTIVATION_PENDING",
    "HOST_ACTIVATION_ROLLED_BACK",
    "HOST_ACTIVATION_COMMITTED",
    "RECOVERY_REQUIRED",
    "HOST_ROLLBACK_REQUIRED",
    "HOST_ROLLBACK_COMPLETED",
    "PUBLISH_COMMITTED",
    "PUBLISH_FINALIZED",
  ]) {
    await rm(join(stateDir, markerName), { force: true });
  }
  const anchorPayload = [
    `${releaseId}\t${fixture.previousRelease}`,
    `${await sha256File(previousReleaseState)}\t${previousReleaseState}`,
    `${await sha256File(environmentBackup)}\t${environmentBackup}`,
    `${await sha256File(nginxPrimaryBackup)}\t${nginxPrimaryBackup}`,
    `${await sha256File(nginxAlternateBackup)}\t${nginxAlternateBackup}`,
  ].join("\n");
  await writeFile(anchor, `${anchorPayload}\n`, "utf8");
  await chmod(anchor, 0o600);
  await writeFile(marker, `${await sha256File(anchor)}\t${anchor}\n`, "utf8");
  await chmod(marker, 0o600);
  if (governanceState !== "none") {
    await writeGovernanceLedgerMarker(
      fixture.deployRoot,
      releaseId,
      governanceState,
    );
  }
  return { anchor, marker, stateDir };
}

async function writeLegacyTerminalLedger(
  fixture: HostActivationLedgerFixture,
  releaseId: string,
  markerName: "HOST_ROLLBACK_COMPLETED" | "PUBLISH_FINALIZED",
): Promise<{ markerPath: string; snapshotPath: string }> {
  const stateDir = await writeHostActivationBasis(fixture, releaseId);
  const markerPath = await writeGovernanceLedgerMarker(
    fixture.deployRoot,
    releaseId,
    markerName,
  );
  return {
    markerPath,
    snapshotPath: join(stateDir, "governance-before.json"),
  };
}

async function executePrepareWithContendedLifecycleLock(
  fixture: Awaited<ReturnType<typeof createPreparePreflightFixture>>,
): Promise<CommandResult> {
  try {
    const result = await execFileAsync(
      "/bin/bash",
      [
        "-c",
        [
          'exec 8<>"$7"',
          "export DIESEL_RELEASE_LIFECYCLE_LOCK_FD=8",
          'source "$1"',
          'source "$2"',
          'prepare_release_effective_uid() { printf "0\\n"; }',
          'prepare_release_require_fixed_root_command_boundary() { export PATH="$1"; }',
          "prepare_release_require_transient_build_commands() { return 0; }",
          "prepare_release_require_systemd_host() { return 0; }",
          'prepare_release_runtime "$3" "$4" "$5" "$6" "$8"',
        ].join("\n"),
        "prepare-contended-lifecycle-fixture",
        hostActivationLedgerScript,
        prepareReleaseRuntimeScript,
        TEST_RELEASE_SHA,
        fixture.deployRoot,
        fixture.fakePath,
        fixture.nodeBinary,
        fixture.lifecycleLock,
        fixture.root,
      ],
      {
        env: {
          ...process.env,
          PATH: fixture.fakePath,
          PREPARE_TEST_FLOCK_STATUS: "1",
        },
      },
    );
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

describe("host activation ledger", { timeout: 30_000 }, () => {
  it("keeps public CLI mutation modes internal-only", async () => {
    for (const mode of [
      "begin",
      "require-pending",
      "mark-rolled-back",
      "mark-committed",
    ]) {
      const result = await execFileAsync(
        "/bin/bash",
        [hostActivationLedgerScript, mode, TEST_RELEASE_SHA],
      ).catch((error: unknown) => error);
      expect(result).toMatchObject({ code: 64 });
      expect(String((result as { stderr?: unknown }).stderr)).toContain(
        "<initialize-protocol|validate>",
      );
    }
  });

  it("fails begin without the protocol manifest before writing candidate state", async () => {
    const fixture = await createHostActivationLedgerFixture();
    try {
      const result = await executeHostActivationCommand(
        fixture,
        'host_activation_ledger_begin "$1" "$2" "$3" "$4"',
        [
          TEST_RELEASE_SHA,
          fixture.deployRoot,
          fixture.nodeBinary,
          fixture.nginxSitesRoot,
        ],
      );

      expect(result.exitCode).toBe(70);
      expect(result.stderr).toContain("host activation protocol manifest");
      await expect(lstat(fixture.anchor)).rejects.toThrow();
      await expect(lstat(fixture.pending)).rejects.toThrow();
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("initializes an empty protocol once and keeps same-release retries byte and inode stable", async () => {
    const fixture = await createHostActivationLedgerFixture();
    try {
      await rm(fixture.stateDir, { force: true, recursive: true });
      const initialized = await executeHostActivationMode(
        fixture,
        "initialize-protocol",
      );
      expect(initialized).toMatchObject({ exitCode: 0, stderr: "" });
      const beforeContents = await readFile(fixture.manifest, "utf8");
      const beforeInode = (await stat(fixture.manifest)).ino;
      expect(beforeContents).toBe(
        `HOST_ACTIVATION_PROTOCOL_V1\t1\t${TEST_RELEASE_SHA}\n`,
      );

      const retried = await executeHostActivationMode(
        fixture,
        "initialize-protocol",
      );
      expect(retried).toMatchObject({ exitCode: 0, stderr: "" });
      expect(await readFile(fixture.manifest, "utf8")).toBe(beforeContents);
      expect((await stat(fixture.manifest)).ino).toBe(beforeInode);

      const otherRelease = await executeHostActivationMode(
        fixture,
        "initialize-protocol",
        "b".repeat(40),
      );
      expect(otherRelease.exitCode).toBe(70);
      expect(otherRelease.stderr).toContain(
        "initialized by another release",
      );
      expect(await readFile(fixture.manifest, "utf8")).toBe(beforeContents);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("binds sorted legacy terminal marker and snapshot paths with raw hashes", async () => {
    const fixture = await createHostActivationLedgerFixture();
    try {
      await rm(fixture.stateDir, { force: true, recursive: true });
      const laterRelease = "d".repeat(40);
      const earlierRelease = "c".repeat(40);
      const later = await writeLegacyTerminalLedger(
        fixture,
        laterRelease,
        "PUBLISH_FINALIZED",
      );
      const earlier = await writeLegacyTerminalLedger(
        fixture,
        earlierRelease,
        "HOST_ROLLBACK_COMPLETED",
      );

      const result = await executeHostActivationMode(
        fixture,
        "initialize-protocol",
      );

      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      expect(await readFile(fixture.manifest, "utf8")).toBe(
        [
          `HOST_ACTIVATION_PROTOCOL_V1\t1\t${TEST_RELEASE_SHA}`,
          `${earlierRelease}\tHOST_ROLLBACK_COMPLETED\t${earlier.markerPath}\t${await sha256File(earlier.markerPath)}\t${earlier.snapshotPath}\t${await sha256File(earlier.snapshotPath)}`,
          `${laterRelease}\tPUBLISH_FINALIZED\t${later.markerPath}\t${await sha256File(later.markerPath)}\t${later.snapshotPath}\t${await sha256File(later.snapshotPath)}`,
          "",
        ].join("\n"),
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it.each([
    "basis-only",
    "active",
    "anchor-only",
    "unknown",
    "temporary",
    "symlink",
  ] as const)("rejects %s pre-protocol state without creating a manifest", async (kind) => {
    const fixture = await createHostActivationLedgerFixture();
    try {
      if (kind === "active") {
        await writeGovernanceLedgerMarker(
          fixture.deployRoot,
          TEST_RELEASE_SHA,
          "RECOVERY_REQUIRED",
        );
      } else if (kind === "anchor-only") {
        await writeFile(fixture.anchor, "incomplete\n", "utf8");
        await chmod(fixture.anchor, 0o600);
      } else if (kind === "unknown") {
        await writeFile(
          join(fixture.stateDir, "HOST_ACTIVATION_UNKNOWN"),
          "unknown\n",
          "utf8",
        );
      } else if (kind === "temporary") {
        await writeFile(join(fixture.stateDir, ".activation.tmp"), "tmp\n", "utf8");
      } else if (kind === "symlink") {
        await rm(fixture.stateDir, { force: true, recursive: true });
        await symlink(fixture.previousRelease, join(fixture.backupsRoot, "unsafe-link"));
      }

      const result = await executeHostActivationMode(
        fixture,
        "initialize-protocol",
      );

      expect(result.exitCode).toBe(70);
      await expect(lstat(fixture.manifest)).rejects.toThrow();
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("rejects grandfathered marker and snapshot drift on later scans", async () => {
    for (const driftTarget of ["marker", "snapshot"] as const) {
      const fixture = await createHostActivationLedgerFixture();
      try {
        await rm(fixture.stateDir, { force: true, recursive: true });
        const historicalRelease = "c".repeat(40);
        const legacy = await writeLegacyTerminalLedger(
          fixture,
          historicalRelease,
          "PUBLISH_FINALIZED",
        );
        expect(
          await executeHostActivationMode(fixture, "initialize-protocol"),
        ).toMatchObject({ exitCode: 0 });
        if (driftTarget === "marker") {
          await writeFile(legacy.snapshotPath, "drifted\n", "utf8");
          await writeFile(
            legacy.markerPath,
            `${await sha256File(legacy.snapshotPath)}\t${legacy.snapshotPath}\n`,
            "utf8",
          );
        } else {
          await writeFile(legacy.snapshotPath, "drifted\n", "utf8");
        }

        const result = await executeHostActivationCommand(
          fixture,
          'host_activation_ledger_scan_all "$1" "$2" allow-active',
          [fixture.deployRoot, fixture.nodeBinary],
        );
        expect(result.exitCode).toBe(70);
        expect(result.stderr).toContain(
          driftTarget === "marker"
            ? "marker hash changed"
            : "publication marker payload is invalid",
        );
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    }
  });

  it("rejects post-initialization protocol manifest extension without candidate mutation", async () => {
    const fixture = await createHostActivationLedgerFixture();
    try {
      expect(await initializeHostActivationProtocol(fixture)).toMatchObject({
        exitCode: 0,
      });
      await writeFile(
        fixture.manifest,
        `${await readFile(fixture.manifest, "utf8")}unexpected-extension\n`,
        "utf8",
      );

      const result = await executeHostActivationCommand(
        fixture,
        'host_activation_ledger_scan_all "$1" "$2" allow-active',
        [fixture.deployRoot, fixture.nodeBinary],
      );

      expect(result.exitCode).toBe(70);
      expect(result.stderr).toContain("protocol manifest entry is invalid");
      await expect(lstat(fixture.anchor)).rejects.toThrow();
      await expect(lstat(fixture.pending)).rejects.toThrow();
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("accepts only the canonical global protocol manifest and rejects a nested protocol object", async () => {
    const fixture = await createHostActivationLedgerFixture();
    try {
      expect(await initializeHostActivationProtocol(fixture)).toMatchObject({
        exitCode: 0,
      });
      const canonicalContents = await readFile(fixture.manifest, "utf8");
      expect(
        await executeHostActivationCommand(
          fixture,
          'host_activation_ledger_parse_protocol_manifest "$1"',
          [fixture.deployRoot],
        ),
      ).toMatchObject({ exitCode: 0, stderr: "" });
      const nestedDirectory = join(fixture.stateDir, "nested");
      const nestedProtocol = join(
        nestedDirectory,
        "HOST_ACTIVATION_PROTOCOL_V1",
      );
      await mkdir(nestedDirectory);
      await writeFile(nestedProtocol, canonicalContents, "utf8");
      await chmod(nestedProtocol, 0o600);

      const result = await executeHostActivationCommand(
        fixture,
        'host_activation_ledger_scan_all "$1" "$2" allow-active',
        [fixture.deployRoot, fixture.nodeBinary],
      );

      expect(result.exitCode).toBe(70);
      expect(result.stderr).toContain(
        "symlink or incomplete activation record blocks host activation",
      );
      await expect(readFile(fixture.manifest, "utf8")).resolves.toBe(
        canonicalContents,
      );
      await expect(readFile(nestedProtocol, "utf8")).resolves.toBe(
        canonicalContents,
      );
      await expect(lstat(fixture.anchor)).rejects.toThrow();
      await expect(lstat(fixture.pending)).rejects.toThrow();
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("begins unarmed state as anchor then PENDING and resumes an anchor-only crash without rewriting it", async () => {
    const fixture = await createHostActivationLedgerFixture();
    try {
      expect(await initializeHostActivationProtocol(fixture)).toMatchObject({
        exitCode: 0,
      });
      await writeFile(join(fixture.root, "fail-after-anchor"), "", "utf8");
      const first = await executeHostActivationCommand(
        fixture,
        'host_activation_ledger_begin "$1" "$2" "$3" "$4"',
        [
          TEST_RELEASE_SHA,
          fixture.deployRoot,
          fixture.nodeBinary,
          fixture.nginxSitesRoot,
        ],
      );
      expect(first.exitCode).toBe(97);
      expect((await lstat(fixture.anchor)).isFile()).toBe(true);
      await expect(lstat(fixture.pending)).rejects.toThrow();
      const anchorBytes = await readFile(fixture.anchor);
      const anchorInode = (await stat(fixture.anchor)).ino;

      await rm(join(fixture.root, "fail-after-anchor"));
      const retried = await executeHostActivationCommand(
        fixture,
        'host_activation_ledger_begin "$1" "$2" "$3" "$4"',
        [
          TEST_RELEASE_SHA,
          fixture.deployRoot,
          fixture.nodeBinary,
          fixture.nginxSitesRoot,
        ],
      );

      expect(retried).toMatchObject({ exitCode: 0, stderr: "" });
      expect(await readFile(fixture.anchor)).toEqual(anchorBytes);
      expect((await stat(fixture.anchor)).ino).toBe(anchorInode);
      expect(await readFile(fixture.pending, "utf8")).toBe(
        `${await sha256File(fixture.anchor)}\t${fixture.anchor}\n`,
      );
      const validated = await executeHostActivationCommand(
        fixture,
        'host_activation_ledger_validate_release_state "$1" "$2"; printf "%s:%s:%s\\n" "$HOST_ACTIVATION_LEDGER_STATE" "$HOST_ACTIVATION_LEDGER_GOVERNANCE_STATE" "$HOST_ACTIVATION_LEDGER_CLASSIFICATION"',
        [TEST_RELEASE_SHA, fixture.deployRoot],
      );
      expect(validated).toMatchObject({
        exitCode: 0,
        stdout: "PENDING:none:active\n",
      });
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("isolates an anchor-only crash from global scans, non-begin modes, and another release", async () => {
    const fixture = await createHostActivationLedgerFixture();
    try {
      expect(await initializeHostActivationProtocol(fixture)).toMatchObject({
        exitCode: 0,
      });
      await writeFile(join(fixture.root, "fail-after-anchor"), "", "utf8");
      expect(
        await executeHostActivationCommand(
          fixture,
          'host_activation_ledger_begin "$1" "$2" "$3" "$4"',
          [
            TEST_RELEASE_SHA,
            fixture.deployRoot,
            fixture.nodeBinary,
            fixture.nginxSitesRoot,
          ],
        ),
      ).toMatchObject({ exitCode: 97 });
      const anchorBytes = await readFile(fixture.anchor);
      const anchorInode = (await stat(fixture.anchor)).ino;
      const otherRelease = "b".repeat(40);
      await writeHostActivationBasis(fixture, otherRelease);

      const globalScan = await executeHostActivationCommand(
        fixture,
        'host_activation_ledger_scan_all "$1" "$2" allow-active',
        [fixture.deployRoot, fixture.nodeBinary],
      );
      const nonBegin = await executeHostActivationMode(
        fixture,
        "require-pending",
      );
      const otherBegin = await executeHostActivationCommand(
        fixture,
        'host_activation_ledger_begin "$1" "$2" "$3" "$4"',
        [
          otherRelease,
          fixture.deployRoot,
          fixture.nodeBinary,
          fixture.nginxSitesRoot,
        ],
      );

      for (const result of [globalScan, nonBegin, otherBegin]) {
        expect(result.exitCode).toBe(70);
      }
      expect(await readFile(fixture.anchor)).toEqual(anchorBytes);
      expect((await stat(fixture.anchor)).ino).toBe(anchorInode);
      await expect(lstat(fixture.pending)).rejects.toThrow();
      await expect(
        lstat(
          join(
            fixture.backupsRoot,
            otherRelease,
            "HOST_ACTIVATION_V1",
          ),
        ),
      ).rejects.toThrow();
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, 45_000);

  it("requires a real descriptor 8 and exactly PENDING:none for runtime preparation", async () => {
    const fixture = await createHostActivationLedgerFixture();
    try {
      expect(await initializeHostActivationProtocol(fixture)).toMatchObject({
        exitCode: 0,
      });
      const missingState = await executeHostActivationMode(
        fixture,
        "require-pending",
      );
      expect(missingState.exitCode).toBe(70);

      expect(
        await executeHostActivationCommand(
          fixture,
          'host_activation_ledger_begin "$1" "$2" "$3" "$4"',
          [
            TEST_RELEASE_SHA,
            fixture.deployRoot,
            fixture.nodeBinary,
            fixture.nginxSitesRoot,
          ],
        ),
      ).toMatchObject({ exitCode: 0 });
      for (const descriptor of ["missing", "wrong"] as const) {
        const result = await executeHostActivationMode(
          fixture,
          "require-pending",
          TEST_RELEASE_SHA,
          { descriptor },
        );
        expect(result.exitCode).toBe(70);
        expect(result.stderr).toContain(
          "release lifecycle lock descriptor 8 is required",
        );
      }
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it.skipIf(process.platform !== "linux")("checks the actual subshell descriptor with native procfs and flock, not the outer Bash PID", async () => {
    const fixture = await createHostActivationLedgerFixture();
    const governanceScript = resolve(
      process.cwd(), "scripts/deploy/governance-publication-state-machine.sh",
    );
    try {
      await writeFile(join(fixture.deployRoot, "validator.sh"), "true <&8\n", { mode: 0o600 });
      for (const validator of ["ledger", "isolated-governance"] as const) {
        for (const scenario of ["child-only", "wrong-child", "closed-child", "contended"] as const) {
          if (validator === "isolated-governance" && scenario === "contended") continue;
          const result = await execFileAsync("/bin/bash", [
            "--noprofile", "--norc", "-c", `
set -uo pipefail
source "$1"
source "$2"
lock="$3/.release-lifecycle.lock"
scenario="$4"
validator="$5"
# Do not let Bash tail-exec optimization collapse the outer process.
exec 8>&-
if [[ "$scenario" == wrong-child || "$scenario" == closed-child ]]; then
  exec 8<>"$lock"
elif [[ "$scenario" == contended ]]; then
  exec 9<>"$lock"
  flock -n 9
fi
run_in_child() (
  set -Eeuo pipefail
  case "$scenario" in
    wrong-child) exec 8<>"$3/wrong.lock" ;;
    closed-child) exec 8>&- ;;
    *) exec 8<>"$lock" ;;
  esac
  export DIESEL_RELEASE_LIFECYCLE_LOCK_FD=8
  if [[ "$validator" == ledger ]]; then
    host_activation_ledger_require_lifecycle_lock "$3"
  else
    GOVERNANCE_RELEASE_LIFECYCLE_LOCK_PATH="$lock"
    governance_run_isolated_host_validator "$3/validator.sh"
  fi
)
run_in_child "$@"
status=$?
printf '%s\\n' "$status"
exit 0
`, "native-lifecycle-fd-regression", hostActivationLedgerScript,
            governanceScript, fixture.deployRoot, scenario, validator,
          ], {
            env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", NODE_ENV: "test" },
            timeout: 10_000,
          });
          expect(result.stdout.trim(), `${validator}:${scenario}: ${result.stderr}`)
            .toBe(scenario === "child-only" ? "0" : "70");
        }
      }
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("rejects a distinct unlocked descriptor while another lifecycle owner exists, before begin or require mutation", async () => {
    const fixture = await createHostActivationLedgerFixture();
    try {
      expect(await initializeHostActivationProtocol(fixture)).toMatchObject({
        exitCode: 0,
      });
      await writeFile(
        join(fixture.root, "lifecycle-lock-contended"),
        "owned-by-process-a\n",
        "utf8",
      );

      const begin = await executeHostActivationCommand(
        fixture,
        'host_activation_ledger_begin "$1" "$2" "$3" "$4"',
        [
          TEST_RELEASE_SHA,
          fixture.deployRoot,
          fixture.nodeBinary,
          fixture.nginxSitesRoot,
        ],
      );

      expect(begin.exitCode).toBe(70);
      expect(begin.stderr).toContain("descriptor 8 is not exclusively locked");
      await expect(lstat(fixture.anchor)).rejects.toThrow();
      await expect(lstat(fixture.pending)).rejects.toThrow();

      await rm(join(fixture.root, "lifecycle-lock-contended"));
      expect(
        await executeHostActivationCommand(
          fixture,
          'host_activation_ledger_begin "$1" "$2" "$3" "$4"',
          [
            TEST_RELEASE_SHA,
            fixture.deployRoot,
            fixture.nodeBinary,
            fixture.nginxSitesRoot,
          ],
        ),
      ).toMatchObject({ exitCode: 0, stderr: "" });
      const pendingBytes = await readFile(fixture.pending);
      const pendingInode = (await stat(fixture.pending)).ino;

      await writeFile(
        join(fixture.root, "lifecycle-lock-contended"),
        "owned-by-process-a\n",
        "utf8",
      );
      const required = await executeHostActivationMode(
        fixture,
        "require-pending",
      );

      expect(required.exitCode).toBe(70);
      expect(required.stderr).toContain(
        "descriptor 8 is not exclusively locked",
      );
      expect(await readFile(fixture.pending)).toEqual(pendingBytes);
      expect((await stat(fixture.pending)).ino).toBe(pendingInode);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("rejects runtime preparation when descriptor 8 is open but its lifecycle flock is held elsewhere", async () => {
    const fixture = await createPreparePreflightFixture("absent");
    try {
      const result = await executePrepareWithContendedLifecycleLock(fixture);

      expect(result.exitCode).toBe(70);
      expect(result.stderr).toContain(
        "descriptor 8 is not exclusively locked",
      );
      expect(await readFile(fixture.operationLog, "utf8").catch(() => ""))
        .toBe("");
      await expect(lstat(fixture.buildWorkspaceRoot)).rejects.toThrow();
      await expect(
        lstat(join(fixture.releaseDir, ".deploy-ready")),
      ).rejects.toThrow();
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("blocks a second release while another activation ledger is active", async () => {
    const fixture = await createHostActivationLedgerFixture();
    try {
      expect(await initializeHostActivationProtocol(fixture)).toMatchObject({
        exitCode: 0,
      });
      await writeV1HostActivationState(fixture, "PENDING", "none");
      const otherRelease = "b".repeat(40);
      await writeHostActivationBasis(fixture, otherRelease);

      const result = await executeHostActivationCommand(
        fixture,
        'host_activation_ledger_begin "$1" "$2" "$3" "$4"',
        [
          otherRelease,
          fixture.deployRoot,
          fixture.nodeBinary,
          fixture.nginxSitesRoot,
        ],
      );

      expect(result.exitCode).toBe(70);
      expect(result.stderr).toContain("active release ledger blocks");
      await expect(
        lstat(join(fixture.backupsRoot, otherRelease, "HOST_ACTIVATION_V1")),
      ).rejects.toThrow();
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  const allowedMatrix = new Map<string, "active" | "terminal">([
    ["PENDING:none", "active"],
    ["PENDING:RECOVERY_REQUIRED", "active"],
    ["PENDING:HOST_ROLLBACK_REQUIRED", "active"],
    ["PENDING:PUBLISH_COMMITTED", "active"],
    ["PENDING:PUBLISH_FINALIZED", "active"],
    ["ROLLED_BACK:HOST_ROLLBACK_REQUIRED", "active"],
    ["ROLLED_BACK:none", "terminal"],
    ["ROLLED_BACK:HOST_ROLLBACK_COMPLETED", "terminal"],
    ["COMMITTED:PUBLISH_FINALIZED", "terminal"],
  ]);
  const matrixCases = (["PENDING", "ROLLED_BACK", "COMMITTED"] as const)
    .flatMap((hostState) => ([
      "none",
      "RECOVERY_REQUIRED",
      "HOST_ROLLBACK_REQUIRED",
      "HOST_ROLLBACK_COMPLETED",
      "PUBLISH_COMMITTED",
      "PUBLISH_FINALIZED",
    ] as const).map((governanceState) => ({ governanceState, hostState })));

  it.each(matrixCases)(
    "strictly classifies $hostState:$governanceState",
    async ({ governanceState, hostState }) => {
      const fixture = await createHostActivationLedgerFixture();
      try {
        expect(await initializeHostActivationProtocol(fixture)).toMatchObject({
          exitCode: 0,
        });
        await writeV1HostActivationState(
          fixture,
          hostState,
          governanceState,
        );
        const result = await executeHostActivationCommand(
          fixture,
          'host_activation_ledger_validate_release_state "$1" "$2"; printf "%s\\n" "$HOST_ACTIVATION_LEDGER_CLASSIFICATION"',
          [TEST_RELEASE_SHA, fixture.deployRoot],
        );
        const expected = allowedMatrix.get(`${hostState}:${governanceState}`);
        if (expected === undefined) {
          expect(result.exitCode).toBe(70);
          expect(result.stderr).toContain("invalid coexistence");
        } else {
          expect(result).toMatchObject({
            exitCode: 0,
            stderr: "",
            stdout: `${expected}\n`,
          });
        }
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    },
  );
});
