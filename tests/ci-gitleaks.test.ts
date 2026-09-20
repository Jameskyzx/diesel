import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const wrapperPath = resolve(process.cwd(), "scripts/ci/run-gitleaks.py");
const privateOutputMarker = "UNREDACTED_SCANNER_PAYLOAD_DO_NOT_PRINT";
const completedLog = "12:00PM INF scan completed in 1ms\n";
const cleanHistoryLog =
  `12:00PM INF 4 commits scanned.\n${completedLog}` +
  "12:00PM INF no leaks found\n";
const canaryFinding = {
  RuleID: "github-pat",
  File: "canary.env",
  Secret: "REDACTED",
};

type FakeScan = {
  exitCode: number;
  reportText: string;
  stderr: string;
  stdout?: string;
  omitReport?: boolean;
  signal?: boolean;
};

type Scenario = {
  history?: Partial<FakeScan>;
  canary?: Partial<FakeScan>;
  missingBinary?: boolean;
};

type Fixture = {
  binary: string;
  callsPath: string;
  workspace: string;
};

const fakeExecutable = `#!/usr/bin/python3
import json
import os
from pathlib import Path
import signal
import sys

directory = Path(__file__).parent
arguments = sys.argv[1:]
scenario = json.loads((directory / "scenario.json").read_text())
kind = "canary" if "--no-git" in arguments else "history"
with (directory / "calls.jsonl").open("a") as calls:
    calls.write(json.dumps({"kind": kind, "args": arguments}) + "\\n")
scan = scenario[kind]
report_path = Path(arguments[arguments.index("--report-path") + 1])
if not scan.get("omitReport", False):
    report_path.write_text(scan["reportText"])
sys.stdout.write(scan.get("stdout", ""))
sys.stderr.write(scan["stderr"])
sys.stdout.flush()
sys.stderr.flush()
if scan.get("signal", False):
    os.kill(os.getpid(), signal.SIGTERM)
sys.exit(scan["exitCode"])
`;

async function withScenario(
  scenario: Scenario,
  run: (fixture: Fixture) => Promise<void> | void,
): Promise<void> {
  const workspace = await realpath(
    await mkdtemp(join(tmpdir(), "diesel-ci-gitleaks-")),
  );
  const binary = join(workspace, "fake-gitleaks");
  const fixture: Fixture = {
    binary: scenario.missingBinary ? join(workspace, "missing-gitleaks") : binary,
    callsPath: join(workspace, "calls.jsonl"),
    workspace,
  };
  try {
    await Promise.all([
      writeFile(binary, fakeExecutable, { mode: 0o755 }),
      writeFile(
        join(workspace, ".gitleaks.toml"),
        "[extend]\nuseDefault = true\n",
      ),
      writeFile(join(workspace, "scenario.json"), JSON.stringify({
        history: {
          exitCode: 0,
          reportText: "[]\n",
          stderr: cleanHistoryLog,
          ...scenario.history,
        },
        canary: {
          exitCode: 97,
          reportText: JSON.stringify([canaryFinding]),
          stderr: `${completedLog}12:00PM WRN leaks found: 1\n`,
          ...scenario.canary,
        },
      })),
    ]);
    await run(fixture);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

function runWrapper(fixture: Fixture): SpawnSyncReturns<string> {
  return spawnSync(
    "/usr/bin/python3",
    ["-I", "-S", wrapperPath, fixture.binary],
    {
      cwd: fixture.workspace,
      encoding: "utf8",
      env: { NODE_ENV: "test", LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" },
      maxBuffer: 64 * 1024,
      timeout: 5_000,
    },
  );
}

function expectRejected(result: SpawnSyncReturns<string>): void {
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.status).toBe(1);
  const output = `${result.stdout}${result.stderr}`;
  expect(output.trim()).not.toBe("");
  expect(output.length).toBeLessThan(2_000);
  expect(output).not.toContain(privateOutputMarker);
  expect(output).not.toContain("Traceback (most recent call last)");
}

describe("CI gitleaks scan completion and canary evidence", () => {
  it("accepts completed history plus the expected canary finding", async () => {
    await withScenario({}, async (fixture) => {
      const result = runWrapper(fixture);
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status).toBe(0);
      const calls: unknown[] = (await readFile(fixture.callsPath, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as unknown);
      expect(calls).toHaveLength(2);
      expect(calls).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "history" }),
        expect.objectContaining({ kind: "canary" }),
      ]));
      for (const call of calls) {
        if (
          typeof call !== "object" || call === null ||
          !("args" in call) || !Array.isArray(call.args) ||
          !call.args.every((arg: unknown) => typeof arg === "string") ||
          !("kind" in call)
        ) {
          throw new Error("Fake scanner did not record a valid invocation.");
        }
        const args = call.args as string[];
        expect(args[args.indexOf("--exit-code") + 1]).toBe("97");
        expect(basename(args[args.indexOf("--config") + 1] ?? ""))
          .toBe(".gitleaks.toml");
        expect(args[args.indexOf("--report-format") + 1]).toBe("json");
        expect(args).toContain("--no-color");
        expect(args).toContain("--no-banner");
        expect(args).toContain("--redact=100");
        if (call.kind === "history") {
          expect(args).toContain(
            "--log-opts=--all --full-history --diff-merges=separate --root",
          );
          expect(args).not.toContain("--no-git");
        } else {
          expect(args).toContain("--no-git");
        }
      }
    });
  });

  it.each([
    {
      name: "exit zero and empty findings after the observed Git scan error",
      history: {
        stderr:
          "12:00PM ERR [git] git: warning: confstr() failed with code 5\n" +
          `12:00PM ERR failed to scan Git repository error="${privateOutputMarker}"\n` +
          `${completedLog}12:00PM INF no leaks found\n`,
      },
    },
    {
      name: "an error diagnostic even when success messages are also present",
      history: {
        stderr: `${cleanHistoryLog}12:00PM ERR ${privateOutputMarker}\n`,
      },
    },
    {
      name: "a missing scanned-commit count",
      history: { stderr: `${completedLog}12:00PM INF no leaks found\n` },
    },
    {
      name: "zero scanned commits",
      history: { stderr: cleanHistoryLog.replace("4 commits", "0 commits") },
    },
    {
      name: "duplicate scanned-commit counts",
      history: { stderr: `12:00PM INF 4 commits scanned.\n${cleanHistoryLog}` },
    },
    {
      name: "missing scan completion",
      history: { stderr: cleanHistoryLog.replace(completedLog, "") },
    },
    {
      name: "a missing clean-scan summary",
      history: {
        stderr: cleanHistoryLog.replace("12:00PM INF no leaks found\n", ""),
      },
    },
    {
      name: "a panic diagnostic despite otherwise successful output",
      history: {
        stderr: `${cleanHistoryLog}12:00PM PNC panic: ${privateOutputMarker}\n`,
      },
    },
    {
      name: "invalid JSON findings",
      history: { reportText: `{${privateOutputMarker}` },
    },
    {
      name: "a missing findings report",
      history: { omitReport: true },
    },
    {
      name: "a non-array findings report",
      history: { reportText: JSON.stringify({ findings: [] }) },
    },
    {
      name: "nonempty findings despite exit zero",
      history: {
        reportText: JSON.stringify([{
          ...canaryFinding,
          Secret: privateOutputMarker,
        }]),
      },
    },
    {
      name: "a findings exit code despite an empty report",
      history: { exitCode: 97 },
    },
    {
      name: "a scanner execution error",
      history: { exitCode: 1, stderr: privateOutputMarker },
    },
  ])("rejects history with $name", async ({ history }) => {
    await withScenario({ history }, (fixture) => {
      expectRejected(runWrapper(fixture));
    });
  });

  it.each([
    { name: "exit zero", canary: { exitCode: 0 } },
    { name: "generic exit one", canary: { exitCode: 1 } },
    { name: "command-not-found exit 127", canary: { exitCode: 127 } },
    { name: "empty findings", canary: { reportText: "[]" } },
    {
      name: "the wrong rule",
      canary: {
        reportText: JSON.stringify([{ ...canaryFinding, RuleID: "other-rule" }]),
      },
    },
    {
      name: "the wrong file",
      canary: {
        reportText: JSON.stringify([{ ...canaryFinding, File: "other.env" }]),
      },
    },
    {
      name: "a scanner error together with the expected finding",
      canary: {
        stderr: `${completedLog}12:00PM ERR ${privateOutputMarker}\n`,
      },
    },
    {
      name: "multiple findings",
      canary: { reportText: JSON.stringify([canaryFinding, canaryFinding]) },
    },
    {
      name: "an unredacted token",
      canary: {
        reportText: JSON.stringify([{
          ...canaryFinding,
          Secret: privateOutputMarker,
        }]),
      },
    },
  ])("rejects canary evidence with $name", async ({ canary }) => {
    await withScenario({ canary }, (fixture) => {
      expectRejected(runWrapper(fixture));
    });
  });

  it.each(["history", "canary"] as const)(
    "rejects a %s scanner terminated by a signal",
    async (kind) => {
      await withScenario({ [kind]: { signal: true } }, (fixture) => {
        expectRejected(runWrapper(fixture));
      });
    },
  );

  it("rejects a scanner that cannot be started", async () => {
    await withScenario({ missingBinary: true }, (fixture) => {
      expectRejected(runWrapper(fixture));
    });
  });

  it.each([
    { canary: false, label: "history", timeout: 450 },
    { canary: true, label: "canary", timeout: 30 },
  ])("handles the fixed $label timeout without exposing partial output", ({
    canary,
    label,
    timeout,
  }) => {
    const probe = `
from pathlib import Path
import runpy
import subprocess
import sys
from unittest import mock

namespace = runpy.run_path(sys.argv[1])
marker = sys.argv[2]
canary = sys.argv[3] == "true"
expected_timeout = int(sys.argv[4])
expected_message = sys.argv[5] + " scan timed out"
failure = subprocess.TimeoutExpired(
    cmd=[marker], timeout=expected_timeout, output=marker, stderr=marker,
)
with mock.patch("subprocess.run", side_effect=failure) as child:
    try:
        namespace["run_scan"](
            Path("/fake/scanner"), Path("/fake/config"), Path("/fake/source"),
            Path("/fake/report"), Path("/fake/ignore"), canary=canary,
        )
    except namespace["ScanFailure"] as result:
        assert str(result) == expected_message
        assert child.call_count == 1
        assert child.call_args.kwargs["timeout"] == expected_timeout
        print(str(result))
    else:
        raise AssertionError("Scanner timeout did not fail closed")
`;
    const result = spawnSync(
      "/usr/bin/python3",
      ["-I", "-S", "-c", probe, wrapperPath, privateOutputMarker,
        String(canary), String(timeout), label],
      {
        encoding: "utf8",
        env: { NODE_ENV: "test", LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" },
        maxBuffer: 64 * 1024,
        timeout: 5_000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(`${label} scan timed out`);
    expect(result.stderr).not.toContain(privateOutputMarker);
    expect(result.stderr).not.toContain("Traceback (most recent call last)");
    expect(result.stdout).not.toContain(privateOutputMarker);
  });
});
