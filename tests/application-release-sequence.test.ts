import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execute = promisify(execFile);
const candidate = "a".repeat(40);
const previous = "b".repeat(40);
const script = resolve("scripts/deploy/governance-publication-state-machine.sh");

// Exercise the shipped shell function, replacing only its host/DB dependencies.
// Real ledger bytes, fingerprint SQL and systemd are tested separately.
const fixtureScript = String.raw`
set -Eeuo pipefail
source "$1"
root="$2"; candidate="$3"; previous="$4"; failure="$5"; mode="$6"; terminal="$7"
event() { printf '%s\n' "$1" >>"$root/events"; [[ "$failure" != "$1" ]] || return 71; }
governance_validate_common_layout() { event layout; }
governance_validate_release_directory() { event release; }
governance_resolve_node_binary() { GOVERNANCE_NODE_BINARY=/fixture/node; }
governance_require_stable_database_identity() { event identity; }
host_activation_ledger_scan_all() { event ledgers; }
governance_require_exact_file() { event trusted-file; }
governance_assert_maintenance_lock() { event lock; }
host_activation_ledger_require_pending() { event pending; }
governance_require_absent() { event absent; }
governance_require_safe_release_id() { event previous-id; }
host_activation_ledger_validate_release_state() {
  event state
  if [[ "$1" == "$previous" ]]; then
    HOST_ACTIVATION_LEDGER_CLASSIFICATION=terminal
    HOST_ACTIVATION_LEDGER_STATE=COMMITTED
  else
    HOST_ACTIVATION_LEDGER_STATE="$terminal"
    HOST_ACTIVATION_LEDGER_GOVERNANCE_STATE=APPLICATION_VERIFIED_V2
  fi
}
governance_run_tsx() { event "db:$2"; }
governance_run_isolated_host_validator() { event "host:$(basename "$1")"; }
governance_validate_current_release() { event current; }
governance_run_isolated_runtime_verifier() { event public-readback; }
host_activation_ledger_application_payload() { event payload; HOST_ACTIVATION_LEDGER_APPLICATION_PAYLOAD=fixture; }
host_activation_ledger_write_record() { event marker; }
host_activation_ledger_parse_application_marker() { event parse-marker; }
host_activation_ledger_transition() { event "transition:$4"; }
host_activation_ledger_revalidate_terminal() { event terminal-readback; }
governance_application_release "$mode" "$candidate" "$root"
`;

async function run(failure = "none", mode = "application", terminal = "PENDING") {
  const root = await mkdtemp(join(tmpdir(), "diesel-application-sequence-"));
  try {
    await mkdir(join(root, "releases", candidate), { recursive: true });
    await mkdir(join(root, "backups", candidate), { recursive: true });
    await writeFile(join(root, "backups", candidate, "previous-release"), `${root}/releases/${previous}\n`);
    let status = 0;
    try {
      await execute("/bin/bash", ["-c", fixtureScript, "fixture", script, root, candidate, previous, failure, mode, terminal]);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || typeof error.code !== "number") throw error;
      status = error.code;
    }
    return { status, events: (await readFile(join(root, "events"), "utf8")).trim().split("\n") };
  } finally { await rm(root, { recursive: true, force: true }); }
}

describe("application-only release sequence", () => {
  it("holds the maintenance boundary around before/activate/public/after and only then commits its own marker", async () => {
    const result = await run();
    expect(result.status).toBe(0);
    const significant = result.events.filter((event) => /^(?:db:|host:|public-|marker|transition:|terminal-)/u.test(event));
    expect(significant).toEqual([
      "db:before", "host:activate-host-release.sh", "public-readback", "db:after", "marker",
      "host:rollback-host-release.sh", "transition:COMMITTED", "terminal-readback",
    ]);
    expect(result.events[result.events.indexOf("db:after") - 1]).toBe("lock");
    expect(result.events).not.toContain("publish");
  });

  it.each([
    { failure: "db:before", status: 70, forbidden: "host:activate-host-release.sh" },
    { failure: "host:activate-host-release.sh", status: 71, forbidden: "db:after" },
    { failure: "public-readback", status: 71, forbidden: "db:after" },
    { failure: "db:after", status: 75, forbidden: "marker" },
    { failure: "marker", status: 71, forbidden: "transition:COMMITTED" },
    { failure: "host:rollback-host-release.sh", status: 71, forbidden: "transition:COMMITTED" },
    { failure: "lock", status: 71, forbidden: "db:before" },
  ])("stops at $failure without certifying later steps", async ({ failure, status, forbidden }) => {
    const result = await run(failure);
    expect(result.status).toBe(status);
    expect(result.events).not.toContain(forbidden);
  });

  it.each(["PENDING", "COMMITTED"])("revalidates %s application completion without reactivation/publication", async (terminal) => {
    const result = await run("none", "finalize-application", terminal);
    expect(result.status).toBe(0);
    expect(result.events).toContain("db:revalidate");
    expect(result.events).toContain("public-readback");
    expect(result.events).not.toContain("host:activate-host-release.sh");
    expect(result.events).not.toContain("marker");
  });

  it("preserves an already marked release when fresh database revalidation fails", async () => {
    const result = await run("db:revalidate", "finalize-application", "COMMITTED");
    expect(result.status).toBe(75);
    expect(result.events).not.toContain("transition:COMMITTED");
  });
});
