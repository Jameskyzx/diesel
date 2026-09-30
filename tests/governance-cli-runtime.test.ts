import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const stateMachine = resolve(root, "scripts/deploy/governance-publication-state-machine.sh");
const ingest = "scripts/db/ingest-accepted-fixtures.ts";
const invalidArgument = "--invalid-runtime-contract-probe";
const environment: NodeJS.ProcessEnv = {
  HOME: "/nonexistent",
  LANG: "C",
  NODE_ENV: "production",
  PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
};

function runShell(command: string, args: string[] = []) {
  return spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", command, "governance-runtime-test", stateMachine, process.execPath, ...args], {
    cwd: root,
    env: environment,
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
  });
}

describe("real governance CLI runtime (without Vitest module aliases)", () => {
  it("resolves server imports before rejecting invalid input, without database credentials", () => {
    // The deliberately invalid option stops the real entry before main/database
    // access. A plain import is unsafe here: this CLI invokes main unconditionally.
    const result = runShell('source "$1"; GOVERNANCE_FIXED_NODE_RUNNER=1; GOVERNANCE_NODE_BINARY="$2"; governance_run_tsx "$3" "$4"', [ingest, invalidArgument]);
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ZodError");
    expect(result.stderr).toContain("parseIngestOptions");
    expect(result.stderr).not.toContain("cannot be imported from a Client Component");
    expect(result.stdout).not.toContain("Ingestion and acceptance checks completed");
  });

  it("proves the unconditioned entry really hits the installed server-only guard", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", ingest, invalidArgument], {
      cwd: root,
      env: environment,
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    });
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("cannot be imported from a Client Component");
    expect(result.stderr).not.toContain("parseIngestOptions");
  });

  it("keeps the same explicit condition in the sourced pnpm fallback", () => {
    const result = runShell('source "$1"; GOVERNANCE_FIXED_NODE_RUNNER=0; corepack() { printf "%s\\n" "$@"; }; governance_run_tsx "$3" "$4"', [ingest, invalidArgument]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split("\n")).toEqual([
      "pnpm", "exec", "tsx", "--conditions=react-server", ingest, invalidArgument,
    ]);
  });
});
