import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

async function handoffFunctions(): Promise<string> {
  const source = await readFile(
    resolve("scripts/ci/linux-release-handoff-smoke.sh"),
    "utf8",
  );
  const entry = '\nlinux_release_handoff_main "$@"\n';
  expect(source.endsWith(entry)).toBe(true);
  return source.slice(0, -entry.length);
}

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
