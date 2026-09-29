import { spawnSync } from "node:child_process";
import { lstat, mkdir, readFile, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createHostActivationLedgerFixture, TEST_RELEASE_SHA, writeExecutable } from "./helpers/deploy-runtime-fixtures";

async function handoffFunctions(): Promise<string> {
  const source = await readFile(
    resolve("scripts/ci/linux-release-handoff-smoke.sh"),
    "utf8",
  );
  const entry = '\nlinux_release_handoff_main "$@"\n';
  expect(source.endsWith(entry)).toBe(true);
  return source.slice(0, -entry.length);
}

describe("Linux handoff failure diagnostics", () => {
  it.each([TEST_RELEASE_SHA, "invalid-unit"])("limits diagnostics to an exact CI build: %s", async (releaseId) => {
    const result = spawnSync("/bin/bash", ["-c", `${await handoffFunctions()}
timeout() {
  [[ "$1 $2 $3 $4 $5" == '--foreground --signal=TERM --kill-after=2s 10s journalctl' ]] || return 92
  [[ "$6" == "--unit=diesel-build-$TEST_RELEASE.service" && "$7 $8 \${9}" == '--lines=60 --no-pager --output=cat' ]] || return 93
  printf 'ERR_PNPM_FETCH_500\\n::error::untrusted\\nAI_API_KEY=sk-private-marker\\npostgresql://private-marker/db\\n'
  for n in {1..70}; do printf 'row %s\\n' "$n"; done
  return 1
}
linux_release_handoff_report_build_failure "$TEST_RELEASE"
exit 23
`], { env: { NODE_ENV: "test", PATH: "/usr/bin:/bin", TEST_RELEASE: releaseId }, encoding: "utf8", timeout: 5_000 });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(23);
    if (releaseId === TEST_RELEASE_SHA) {
      expect(result.stdout).toContain("CI builder | ERR_PNPM_FETCH_500");
      expect(result.stdout).toContain("CI builder | : :error: :untrusted");
      expect(result.stdout).not.toContain("::");
      expect(result.stdout).not.toContain("private-marker");
      expect(result.stdout.trimEnd().split("\n")).toHaveLength(60);
    } else {
      expect(result.stdout).toBe("");
    }
  });
});

describe("Linux handoff bounded systemd startup", () => {
  it.each([
    { state: "running", status: 0, transition: false, accepted: true },
    { state: "degraded", status: 1, transition: false, accepted: true },
    { state: "starting", status: 1, transition: true, accepted: true },
    { state: "initializing", status: 1, transition: true, accepted: true },
    { state: "starting", status: 1, transition: false, accepted: false },
    { state: "stopping", status: 1, transition: false, accepted: false },
    { state: "running", status: 124, transition: false, accepted: false },
    { state: "unknown secret marker", status: 1, transition: false, accepted: false },
  ])("handles $state/$status with transition=$transition", async (fixture) => {
    const result = spawnSync("/bin/bash", ["-c", `${await handoffFunctions()}
clock=0
linux_release_handoff_clock_seconds() { printf '%s\\n' "$clock"; }
sleep() { [[ "$1" == 2 ]] || return 91; clock=$((clock + 2)); }
timeout() {
  [[ "$1 $2 $3 $4 $5" == '--foreground --signal=TERM --kill-after=2s 10s systemctl' ]] || return 92
  if [[ "$6" == list-jobs ]]; then
    printf '123 cloud-final.service start running\\n'
    printf '124 unknown/secret start running\\n'
    printf '125 unsafe.service private-payload running\\n'
    return 0
  fi
  [[ "$6" == is-system-running ]] || return 93
  if [[ "$TEST_TRANSITION" == true && "$clock" -ge 2 ]]; then
    printf 'running\\n'
    return 0
  fi
  printf '%s\\n' "$TEST_STATE"
  return "$TEST_STATUS"
}
linux_release_handoff_wait_systemd_ready
printf 'startup-accepted\\n'
`], {
      env: { NODE_ENV: "test", PATH: "/usr/bin:/bin", TEST_STATE: fixture.state,
        TEST_STATUS: String(fixture.status), TEST_TRANSITION: String(fixture.transition) },
      encoding: "utf8", timeout: 5_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(fixture.accepted ? 0 : 70);
    expect(result.stdout.includes("startup-accepted")).toBe(fixture.accepted);
    expect(result.stdout + result.stderr).not.toMatch(/secret|private-payload/);
    if (fixture.state === "starting" && !fixture.transition) {
      expect(result.stderr).toContain("did not finish startup within 180 seconds");
      expect(result.stdout).toContain("Pending CI boot job: cloud-final.service start running");
    }
  });
});

describe("Linux handoff fixed Node fixture", () => {
  it.each([
    "fresh", "wrong-version", "existing-target", "symlink-target",
    "symlink-parent", "missing-corepack", "symlink-node",
  ] as const)("copies only a fresh pinned distribution: %s", async (scenario) => {
    const fixture = await createHostActivationLedgerFixture();
    const source = join(fixture.root, "setup-node");
    let target = join(fixture.root, "fixed-node");
    try {
      await mkdir(join(source, "bin"), { recursive: true });
      await mkdir(join(source, "lib"));
      await writeExecutable(join(source, "bin/node"), `#!/bin/bash\nprintf '${scenario === "wrong-version" ? "v22.22.2" : "v22.22.3"}\\n'\n`);
      await writeExecutable(join(source, "lib/corepack.cjs"), "#!/bin/bash\nexit 0\n");
      if (scenario !== "missing-corepack") {
        await symlink("../lib/corepack.cjs", join(source, "bin/corepack"));
      }
      if (scenario === "existing-target") {
        await mkdir(target);
        await writeFile(join(target, "keep"), "unchanged");
      } else if (scenario === "symlink-target") {
        await symlink(source, target);
      } else if (scenario === "symlink-parent") {
        await symlink(source, join(fixture.root, "linked-parent"));
        target = join(fixture.root, "linked-parent/fixed-node");
      } else if (scenario === "symlink-node") {
        await rm(join(source, "bin/node"));
        await symlink("../lib/corepack.cjs", join(source, "bin/node"));
      }
      const result = spawnSync("/bin/bash", ["-c", `${await handoffFunctions()}
# Project only GNU copy/compare flags and root ownership onto this macOS-safe
# temporary fixture. File copies, modes, links and fail-closed checks are real.
cp() {
  [[ "$1 $2 $3 $4 $5" == '-R -P --preserve=mode --reflink=never --' ]] || return 91
  shift 5
  /bin/cp -R -P "$@"
}
cmp() {
  [[ "$1 $2" == '--silent --' ]] || return 92
  shift 2
  /usr/bin/cmp -s "$@"
}
chown() {
  [[ "$#" -eq 3 && "$1" == -hR && "$2" == root:root && "$3" == "$TEST_TARGET" ]] || return 93
  printf 'owned-copy\\n'
}
linux_release_handoff_install_node_fixture "$TEST_NODE" "$TEST_TARGET"
`], {
        env: { NODE_ENV: "test", PATH: fixture.fakePath, TEST_NODE: join(source, "bin/node"), TEST_TARGET: target },
        encoding: "utf8",
        timeout: 5_000,
      });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(scenario === "fresh" ? 0 : 70);
      expect(result.stdout).toBe(scenario === "fresh" ? "owned-copy\n" : "");
      if (scenario === "fresh") {
        expect(await readFile(join(target, "bin/node"), "utf8"))
          .toBe(await readFile(join(source, "bin/node"), "utf8"));
        expect((await stat(join(target, "bin/node"))).ino)
          .not.toBe((await stat(join(source, "bin/node"))).ino);
        expect((await stat(join(target, "bin/node"))).mode & 0o7777).toBe(0o755);
        expect(await readlink(join(target, "bin/corepack"))).toBe("../lib/corepack.cjs");
      } else if (scenario === "existing-target") {
        expect(await readFile(join(target, "keep"), "utf8")).toBe("unchanged");
        await expect(lstat(join(target, "bin"))).rejects.toMatchObject({ code: "ENOENT" });
      } else if (scenario === "symlink-target") {
        expect(await readlink(target)).toBe(source);
      } else {
        await expect(lstat(target)).rejects.toMatchObject({ code: "ENOENT" });
      }
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});

describe("Linux handoff activation fixture", () => {
  it.each(["pending", "missing-lock", "live-drift"] as const)(
    "uses the real ledger and fails closed for %s",
    async (scenario) => {
      const fixture = await createHostActivationLedgerFixture();
      try {
        await rm(fixture.stateDir, { recursive: true });
        await rm(fixture.currentLink);
        const result = spawnSync("/bin/bash", ["-c", `${await handoffFunctions()}
source "$1"
# Only project Linux ownership/install flags onto this unprivileged fixture.
# The shipped ledger, record writer, parser and durability checks are real.
install() {
  local -a args=()
  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      -o|-g) shift 2 ;;
      *) args+=("$1"); shift ;;
    esac
  done
  /usr/bin/install "\${args[@]}"
}
if [[ "$TEST_SCENARIO" != missing-lock ]]; then
  exec 8<>"$TEST_DEPLOY_ROOT/.release-lifecycle.lock"
  export DIESEL_RELEASE_LIFECYCLE_LOCK_FD=8
fi
linux_release_handoff_begin_fixture "$TEST_RELEASE" "$TEST_DEPLOY_ROOT" "$TEST_NODE"
if [[ "$TEST_SCENARIO" == live-drift ]]; then
  printf 'drift\\n' >>"$TEST_DEPLOY_ROOT/ci-nginx-sites/jamesky.site"
fi
host_activation_ledger_require_live_basis \\
  "$TEST_RELEASE" "$TEST_DEPLOY_ROOT" "$TEST_DEPLOY_ROOT/ci-nginx-sites"
printf 'fixture-pending-verified\\n'
`, "handoff-activation-fixture", resolve("scripts/deploy/host-activation-ledger.sh")], {
          env: {
            NODE_ENV: "test",
            PATH: fixture.fakePath,
            TEST_SCENARIO: scenario,
            TEST_DEPLOY_ROOT: fixture.deployRoot,
            TEST_RELEASE: TEST_RELEASE_SHA,
            TEST_NODE: fixture.nodeBinary,
          },
          encoding: "utf8",
          timeout: 20_000,
        });
        expect(result.error).toBeUndefined();
        expect(result.status, result.stderr).toBe(scenario === "pending" ? 0 : 70);
        expect(result.stdout.includes("fixture-pending-verified")).toBe(scenario === "pending");
        if (scenario === "missing-lock") {
          await expect(readFile(fixture.manifest)).rejects.toMatchObject({ code: "ENOENT" });
          await expect(readFile(fixture.pending)).rejects.toMatchObject({ code: "ENOENT" });
        } else {
          expect(await readFile(fixture.pending, "utf8")).toContain(fixture.anchor);
          expect(await readFile(join(fixture.stateDir, "previous-release"), "utf8"))
            .toBe(`${fixture.deployRoot}/releases/ci-previous\n`);
        }
        await expect(readFile(fixture.committed)).rejects.toMatchObject({ code: "ENOENT" });
        await expect(readFile(join(fixture.stateDir, "PUBLISH_FINALIZED"))).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await rm(fixture.root, { recursive: true, force: true });
      }
    },
    30_000,
  );
});

describe("Linux handoff private-group cleanup", () => {
  it.each([
    { name: "retained owned group", entry: "diesel-build:x:301:", lookup: 0, numeric: 0, removed: 1, deletion: 0, status: 0, deletes: true },
    { name: "private group already removed by userdel", entry: "", lookup: 2, numeric: 2, removed: 1, deletion: 0, status: 0, deletes: false },
    { name: "missing group without successful user deletion", entry: "", lookup: 2, numeric: 2, removed: 0, deletion: 0, status: 70, deletes: false },
    { name: "failed name lookup", entry: "", lookup: 1, numeric: 2, removed: 1, deletion: 0, status: 70, deletes: false },
    { name: "reused numeric GID", entry: "", lookup: 2, numeric: 0, removed: 1, deletion: 0, status: 70, deletes: false },
    { name: "failed numeric lookup", entry: "", lookup: 2, numeric: 1, removed: 1, deletion: 0, status: 70, deletes: false },
    { name: "replaced named group", entry: "diesel-build:x:302:", lookup: 0, numeric: 2, removed: 1, deletion: 0, status: 70, deletes: false },
    { name: "unexpected group name", entry: "other:x:301:", lookup: 0, numeric: 2, removed: 1, deletion: 0, status: 70, deletes: false },
    { name: "multiple lookup records", entry: "diesel-build:x:301:\nother:x:302:", lookup: 0, numeric: 2, removed: 1, deletion: 0, status: 70, deletes: false },
    { name: "failed group deletion", entry: "diesel-build:x:301:", lookup: 0, numeric: 0, removed: 1, deletion: 6, status: 6, deletes: true },
  ])("handles $name without broadening cleanup", async (fixture) => {
    const result = spawnSync("/bin/bash", ["-c", `${await handoffFunctions()}
getent() {
  [[ "$1" == group ]] || return 91
  if [[ "$2" == diesel-build ]]; then
    [[ -z "$TEST_ENTRY" ]] || printf '%s\\n' "$TEST_ENTRY"
    return "$TEST_LOOKUP"
  fi
  [[ "$2" == 301 ]] || return 92
  return "$TEST_NUMERIC"
}
groupdel() {
  [[ "$#" -eq 1 && "$1" == diesel-build ]] || return 93
  printf 'deleted-owned-group\\n'
  return "$TEST_DELETION"
}
linux_release_handoff_remove_owned_group diesel-build 301 "$TEST_REMOVED"
`], {
      env: {
        NODE_ENV: "test",
        PATH: "/usr/bin:/bin",
        TEST_ENTRY: fixture.entry,
        TEST_LOOKUP: String(fixture.lookup),
        TEST_NUMERIC: String(fixture.numeric),
        TEST_REMOVED: String(fixture.removed),
        TEST_DELETION: String(fixture.deletion),
      },
      encoding: "utf8",
      timeout: 2_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(fixture.status);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(fixture.deletes ? "deleted-owned-group\n" : "");
  });

  it.each([false, true])("preserves the original failure after userdel auto-removal=%s", async (autoRemoval) => {
    const result = spawnSync("/bin/bash", ["-c", `${await handoffFunctions()}
LINUX_RELEASE_HANDOFF_BUILDER_USER_OWNED=1
LINUX_RELEASE_HANDOFF_BUILDER_GROUP_OWNED=1
LINUX_RELEASE_HANDOFF_BUILDER_UID=301
LINUX_RELEASE_HANDOFF_BUILDER_GID=301
removed=0
id() { [[ "$2" == diesel-build ]] || return 91; printf '301\\n'; }
linux_release_handoff_stop_uid_processes() { [[ "$1" == 301 ]]; }
userdel() { [[ "$1" == diesel-build ]] || return 92; removed=1; }
getent() {
  [[ "$1" == group ]] || return 93
  if [[ "$TEST_AUTO_REMOVAL" == true && "$removed" == 1 ]]; then return 2; fi
  printf 'diesel-build:x:301:\\n'
}
groupdel() { [[ "$1" == diesel-build ]] || return 94; printf 'deleted-owned-group\\n'; }
linux_release_handoff_cleanup 23
`], {
      env: { NODE_ENV: "test", PATH: "/usr/bin:/bin", TEST_AUTO_REMOVAL: String(autoRemoval) },
      encoding: "utf8",
      timeout: 2_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(23);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(autoRemoval ? "" : "deleted-owned-group\n");
  });
});

describe("bounded systemd build-start diagnostics", () => {
  it.each([
    { result: "exit-code", loadStatus: 0, reports: true },
    { result: "untrusted secret\nmarker", loadStatus: 0, reports: false },
    { result: "exit-code", loadStatus: 70, reports: false },
  ])("reports only safe status fields: $result/$loadStatus", (fixture) => {
    const result = spawnSync("/bin/bash", ["-c", `
set -euo pipefail
source "$1"
prepare_release_load_unit_state() {
  PREPARE_RELEASE_UNIT_LOAD_STATE=loaded
  PREPARE_RELEASE_UNIT_ACTIVE_STATE=failed
  PREPARE_RELEASE_UNIT_SUB_STATE=failed
  PREPARE_RELEASE_UNIT_RESULT="$TEST_RESULT"
  PREPARE_RELEASE_UNIT_EXEC_MAIN_CODE=1
  PREPARE_RELEASE_UNIT_EXEC_MAIN_STATUS=200
  PREPARE_RELEASE_UNIT_WORKING_DIRECTORY='must-not-print-workspace'
  return "$TEST_LOAD_STATUS"
}
prepare_release_report_build_start_failure diesel-build-fixture.service 1
`, "diagnostics-fixture", resolve("scripts/deploy/prepare-release-runtime.sh")], {
      env: { NODE_ENV: "test", PATH: "/usr/bin:/bin", TEST_RESULT: fixture.result, TEST_LOAD_STATUS: String(fixture.loadStatus) },
      encoding: "utf8",
      timeout: 2_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(fixture.reports
      ? "Build start diagnostics: start=1 load=loaded active=failed sub=failed result=exit-code code=1 status=200\n"
      : "");
  });
});
