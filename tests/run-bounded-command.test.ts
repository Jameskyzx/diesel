import { spawn, type ChildProcess } from "node:child_process";
import {
  lstat,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const boundedCommandHelper = resolve(
  process.cwd(),
  "scripts/deploy/run-bounded-command.mjs",
);
const groupInventoryFixture = resolve(
  process.cwd(),
  "tests/fixtures/bounded-command-group-inventory-preload.cjs",
);

function helperEnvironment(
  inherited: NodeJS.ProcessEnv = process.env,
  residualPidPath?: string,
): NodeJS.ProcessEnv {
  return {
    ...inherited,
    ...(residualPidPath === undefined
      ? {}
      : {
          DIESEL_BOUNDED_COMMAND_TEST_RESIDUAL_PID_PATH: residualPidPath,
        }),
    NODE_OPTIONS: [
      inherited.NODE_OPTIONS,
      `--require=${groupInventoryFixture}`,
    ].filter((value) => value !== undefined && value.length > 0).join(" "),
  };
}

type CommandResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

function executeHelper(
  args: string[],
  stdin: Buffer | string = "",
  nodeArgs: string[] = [],
  env: NodeJS.ProcessEnv = process.env,
): Promise<CommandResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [...nodeArgs, boundedCommandHelper, ...args], {
      cwd: process.cwd(),
      env: helperEnvironment(env),
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      resolveResult({
        exitCode: code ?? -1,
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdout: Buffer.concat(stdout).toString("utf8"),
      });
    });
    child.stdin.end(stdin);
  });
}

function helperArguments(options: {
  commandArgs: string[];
  killGraceMs?: number;
  maxStderrBytes?: number;
  maxStdoutBytes?: number;
  stderrPath: string;
  stdinPath: string;
  stdoutPath: string;
  timeoutMs?: number;
}): string[] {
  return [
    String(options.timeoutMs ?? 1_000),
    String(options.killGraceMs ?? 100),
    String(options.maxStdoutBytes ?? 1_024),
    String(options.maxStderrBytes ?? 1_024),
    options.stdinPath,
    options.stdoutPath,
    options.stderrPath,
    "--",
    process.execPath,
    ...options.commandArgs,
  ];
}

async function expectOutputAtMost(
  path: string,
  maximumBytes: number,
): Promise<Buffer> {
  const metadata = await stat(path);
  expect(metadata.isFile()).toBe(true);
  expect(metadata.mode & 0o777).toBe(0o600);
  expect(metadata.size).toBeLessThanOrEqual(maximumBytes);
  return readFile(path);
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

async function waitForProcessExit(pid: number, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processIsRunning(pid)) return;
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 20));
  }
  expect(processIsRunning(pid)).toBe(false);
}

async function waitForFile(path: string, timeoutMs = 2_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const contents = await readFile(path, "utf8").catch(() => undefined);
    if (contents !== undefined) return contents;
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 20));
  }
  throw new Error(`timed out waiting for ${path}`);
}

function waitForPromiseSettlement(
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolveSettlement) => {
    const timer = setTimeout(() => resolveSettlement(false), timeoutMs);
    void promise.then(
      () => {
        clearTimeout(timer);
        resolveSettlement(true);
      },
      () => {
        clearTimeout(timer);
        resolveSettlement(true);
      },
    );
  });
}

async function settleTestSupervisor(
  supervisor: ChildProcess,
  resultPromise: Promise<unknown>,
  cleanupPath: string,
): Promise<void> {
  await writeFile(cleanupPath, "cleanup\n", "utf8").catch(() => undefined);
  let settled = await waitForPromiseSettlement(resultPromise, 1_000);
  for (const signal of ["SIGTERM", "SIGKILL"] as const) {
    if (settled) break;
    if (supervisor.exitCode === null && supervisor.signalCode === null) {
      supervisor.kill(signal);
    }
    settled = await waitForPromiseSettlement(resultPromise, 1_000);
  }
  if (!settled) {
    supervisor.stdout?.destroy();
    supervisor.stderr?.destroy();
    supervisor.unref();
    throw new Error("test supervisor did not settle after bounded cleanup");
  }
}

async function waitForManagedProcessCleanup(
  pid: number | undefined,
  exitConfirmed: boolean,
  cleanupAckPath: string,
  timeoutMs = 2_000,
): Promise<void> {
  if (pid === undefined || exitConfirmed) return;
  const expectedAck = `${pid}\n`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ack = await readFile(cleanupAckPath, "utf8").catch(
      () => undefined,
    );
    if (ack === expectedAck || !processIsRunning(pid)) return;
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 20));
  }
  throw new Error(`managed test process ${pid} did not acknowledge cleanup`);
}

describe("bounded deployment command supervisor", () => {
  it("proves the detached process-group inventory capability explicitly", async () => {
    await expect(executeHelper([
      "--check-process-group-inventory-v1",
    ])).resolves.toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "bounded-command-v2:process-group-inventory-ok\n",
    });
  });

  it("writes a bound containment receipt without exposing its capability to the child", async () => {
    const root = await mkdtemp(join(tmpdir(), "diesel-bounded-receipt-"));
    const stdoutPath = join(root, "stdout.txt");
    const stderrPath = join(root, "stderr.txt");
    const receiptPath = join(root, "completion.json");
    const token = "123e4567-e89b-42d3-a456-426614174000";
    try {
      const result = await executeHelper(
        helperArguments({
          commandArgs: [
            "-e",
            'process.stdout.write(`${process.env.DIESEL_BOUNDED_COMMAND_COMPLETION_RECEIPT_PATH ?? "missing"}|${process.env.DIESEL_BOUNDED_COMMAND_COMPLETION_RECEIPT_TOKEN ?? "missing"}|${process.send === undefined ? "missing" : "present"}|${process.env.NODE_OPTIONS ?? "missing"}|${process.env.DIESEL_BOUNDED_COMMAND_TEST_RESIDUAL_PID_PATH ?? "missing"}`);',
          ],
          stderrPath,
          stdinPath: "-",
          stdoutPath,
        }),
        "",
        [],
        {
          ...process.env,
          DIESEL_BOUNDED_COMMAND_COMPLETION_RECEIPT_PATH: receiptPath,
          DIESEL_BOUNDED_COMMAND_COMPLETION_RECEIPT_TOKEN: token,
        },
      );

      expect(result.exitCode).toBe(0);
      expect(await readFile(stdoutPath, "utf8")).toBe(
        "missing|missing|missing|missing|missing",
      );
      expect(await readFile(stderrPath, "utf8")).toBe("");
      expect(await readFile(receiptPath, "utf8")).toBe(
        `${JSON.stringify({
          version: "bounded-command-completion-v2",
          token,
          exitCode: 0,
          closeSeen: true,
          groupAbsenceProven: true,
          guardianSealed: true,
        })}\n`,
      );
      expect((await stat(receiptPath)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("writes a containment receipt after the timeout seal completes", async () => {
    const root = await mkdtemp(join(tmpdir(), "diesel-bounded-receipt-"));
    const stdoutPath = join(root, "stdout.txt");
    const stderrPath = join(root, "stderr.txt");
    const receiptPath = join(root, "completion.json");
    const token = "123e4567-e89b-42d3-a456-426614174001";
    try {
      const result = await executeHelper(
        helperArguments({
          commandArgs: [
            "-e",
            'process.on("SIGTERM", () => {}); setInterval(() => {}, 1_000);',
          ],
          killGraceMs: 50,
          stderrPath,
          stdinPath: "-",
          stdoutPath,
          timeoutMs: 100,
        }),
        "",
        [],
        {
          ...process.env,
          DIESEL_BOUNDED_COMMAND_COMPLETION_RECEIPT_PATH: receiptPath,
          DIESEL_BOUNDED_COMMAND_COMPLETION_RECEIPT_TOKEN: token,
        },
      );

      expect(result).toEqual({ exitCode: 124, stderr: "", stdout: "" });
      const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as {
        exitCode: number;
        guardianSealed: boolean;
        token: string;
      };
      expect(receipt).toMatchObject({
        exitCode: 124,
        guardianSealed: true,
        token,
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("emits no receipt when the workload kills its guardian before sealing", async () => {
    const root = await mkdtemp(join(tmpdir(), "diesel-bounded-guardian-crash-"));
    const stdoutPath = join(root, "stdout.txt");
    const stderrPath = join(root, "stderr.txt");
    const receiptPath = join(root, "completion.json");
    const workloadPidPath = join(root, "workload.pid");
    const token = "123e4567-e89b-42d3-a456-426614174002";
    let workloadPid: number | undefined;
    try {
      const result = await executeHelper(
        helperArguments({
          commandArgs: [
            "-e",
            [
              'const { writeFileSync } = require("node:fs");',
              "writeFileSync(process.argv[1], String(process.pid));",
              'process.kill(process.ppid, "SIGKILL");',
              "setInterval(() => {}, 1_000);",
            ].join("\n"),
            workloadPidPath,
          ],
          killGraceMs: 50,
          stderrPath,
          stdinPath: "-",
          stdoutPath,
          timeoutMs: 500,
        }),
        "",
        [],
        {
          ...process.env,
          DIESEL_BOUNDED_COMMAND_COMPLETION_RECEIPT_PATH: receiptPath,
          DIESEL_BOUNDED_COMMAND_COMPLETION_RECEIPT_TOKEN: token,
        },
      );

      workloadPid = Number(await readFile(workloadPidPath, "utf8"));
      expect(Number.isSafeInteger(workloadPid)).toBe(true);
      expect(result.exitCode).toBe(126);
      expect(result.stderr).toContain("bounded-command-v2:guardian-exit");
      await expect(lstat(receiptPath)).rejects.toMatchObject({ code: "ENOENT" });
      expect(processIsRunning(workloadPid)).toBe(true);
    } finally {
      if (workloadPid !== undefined) {
        try {
          process.kill(workloadPid, "SIGKILL");
        } catch (error: unknown) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
        await waitForProcessExit(workloadPid);
      }
      await rm(root, { force: true, recursive: true });
    }
  });

  it("emits one fixed diagnostic when capture setup fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "diesel-bounded-command-"));
    const missingRoot = join(root, "missing");
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const result = await executeHelper(
          helperArguments({
            commandArgs: ["-e", "process.exit(0);"],
            stderrPath: join(missingRoot, `stderr-${attempt}.txt`),
            stdinPath: "-",
            stdoutPath: join(missingRoot, `stdout-${attempt}.txt`),
          }),
        );

        expect(result).toEqual({
          exitCode: 126,
          stderr: "bounded-command-v2:capture-setup\n",
          stdout: "",
        });
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("captures child stdout and stderr while forwarding the selected stdin file", async () => {
    const root = await mkdtemp(join(tmpdir(), "diesel-bounded-command-"));
    const stdinPath = join(root, "stdin.bin");
    const stdoutPath = join(root, "stdout.bin");
    const stderrPath = join(root, "stderr.bin");
    const input = Buffer.from([0x00, 0x44, 0x69, 0x65, 0x73, 0x65, 0x6c, 0xff]);
    const diagnostic = "captured diagnostic\n";
    try {
      await writeFile(stdinPath, input);

      const result = await executeHelper(
        helperArguments({
          commandArgs: [
            "-e",
            [
              'const { readFileSync, writeFileSync } = require("node:fs");',
              "writeFileSync(1, readFileSync(0));",
              `writeFileSync(2, ${JSON.stringify(diagnostic)});`,
            ].join("\n"),
          ],
          stderrPath,
          stdinPath,
          stdoutPath,
        }),
      );

      expect(result.exitCode).toBe(0);
      expect(await expectOutputAtMost(stdoutPath, 1_024)).toEqual(input);
      expect((await expectOutputAtMost(stderrPath, 1_024)).toString("utf8"))
        .toBe(diagnostic);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("gives the child immediate EOF when the stdin path is a dash", async () => {
    const root = await mkdtemp(join(tmpdir(), "diesel-bounded-command-"));
    const stdoutPath = join(root, "stdout.txt");
    const stderrPath = join(root, "stderr.txt");
    try {
      const result = await executeHelper(
        helperArguments({
          commandArgs: [
            "-e",
            [
              'const { readFileSync, writeFileSync } = require("node:fs");',
              'writeFileSync(1, String(readFileSync(0).byteLength) + "\\n");',
            ].join("\n"),
          ],
          stderrPath,
          stdinPath: "-",
          stdoutPath,
        }),
        "this inherited helper input must not reach the child",
      );

      expect(result.exitCode).toBe(0);
      expect((await expectOutputAtMost(stdoutPath, 1_024)).toString("utf8"))
        .toBe("0\n");
      expect(await expectOutputAtMost(stderrPath, 1_024)).toHaveLength(0);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("propagates an ordinary child exit status after capturing both streams", async () => {
    const root = await mkdtemp(join(tmpdir(), "diesel-bounded-command-"));
    const stdoutPath = join(root, "stdout.txt");
    const stderrPath = join(root, "stderr.txt");
    try {
      const result = await executeHelper(
        helperArguments({
          commandArgs: [
            "-e",
            [
              'const { writeFileSync } = require("node:fs");',
              'writeFileSync(1, "ordinary stdout\\n");',
              'writeFileSync(2, "ordinary stderr\\n");',
              "process.exitCode = 23;",
            ].join("\n"),
          ],
          stderrPath,
          stdinPath: "-",
          stdoutPath,
        }),
      );

      expect(result.exitCode).toBe(23);
      expect(result.stderr).toBe("");
      expect((await expectOutputAtMost(stdoutPath, 1_024)).toString("utf8"))
        .toBe("ordinary stdout\n");
      expect((await expectOutputAtMost(stderrPath, 1_024)).toString("utf8"))
        .toBe("ordinary stderr\n");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("does not label an ordinary child exit 126 as a supervision failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "diesel-bounded-command-"));
    const stdoutPath = join(root, "stdout.txt");
    const stderrPath = join(root, "stderr.txt");
    try {
      const result = await executeHelper(
        helperArguments({
          commandArgs: [
            "-e",
            [
              'const { writeFileSync } = require("node:fs");',
              'writeFileSync(1, "child 126 stdout\\n");',
              'writeFileSync(2, "child 126 stderr\\n");',
              "process.exitCode = 126;",
            ].join("\n"),
          ],
          stderrPath,
          stdinPath: "-",
          stdoutPath,
        }),
      );

      expect(result).toEqual({ exitCode: 126, stderr: "", stdout: "" });
      expect((await expectOutputAtMost(stdoutPath, 1_024)).toString("utf8"))
        .toBe("child 126 stdout\n");
      expect((await expectOutputAtMost(stderrPath, 1_024)).toString("utf8"))
        .toBe("child 126 stderr\n");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("waits through a transient pre-close process-group observation", async () => {
    const root = await mkdtemp(join(tmpdir(), "diesel-bounded-command-"));
    const stdoutPath = join(root, "stdout.txt");
    const stderrPath = join(root, "stderr.txt");
    const preloaderPath = join(root, "pre-close-group.cjs");
    try {
      await writeFile(
        preloaderPath,
        [
          'const childProcess = require("node:child_process");',
          'const { syncBuiltinESMExports } = require("node:module");',
          "const originalSpawn = childProcess.spawn;",
          "const originalKill = process.kill.bind(process);",
          "childProcess.spawn = function (...args) {",
          "  const child = originalSpawn.apply(this, args);",
          "  if (!Array.isArray(args[1]) || !args[1].includes(\"--bounded-command-guardian-v1\")) return child;",
          "  const originalEmit = child.emit;",
          "  let closeDelivered = false;",
          "  let exitSeen = false;",
          "  child.emit = function (event, ...eventArgs) {",
          '    if (event === "exit") exitSeen = true;',
          '    if (event === "close") {',
          "      setTimeout(() => {",
          "        closeDelivered = true;",
          "        originalEmit.call(child, event, ...eventArgs);",
          "      }, 50);",
          "      return true;",
          "    }",
          "    return originalEmit.call(child, event, ...eventArgs);",
          "  };",
          "  process.kill = function (pid, signal) {",
          "    if (",
          "      signal === 0 &&",
          "      pid === -child.pid &&",
          "      exitSeen &&",
          "      !closeDelivered",
          "    ) return true;",
          "    return originalKill(pid, signal);",
          "  };",
          "  return child;",
          "};",
          "syncBuiltinESMExports();",
          "",
        ].join("\n"),
        "utf8",
      );

      const result = await executeHelper(
        helperArguments({
          commandArgs: ["-e", "process.exit(0);"],
          stderrPath,
          stdinPath: "-",
          stdoutPath,
        }),
        "",
        ["--require", preloaderPath],
      );

      expect(result).toEqual({ exitCode: 0, stderr: "", stdout: "" });
      await expectOutputAtMost(stdoutPath, 1_024);
      await expectOutputAtMost(stderrPath, 1_024);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it(
    "terminates a child that ignores SIGTERM and returns the timeout status",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "diesel-bounded-command-"));
      const stdoutPath = join(root, "stdout.txt");
      const stderrPath = join(root, "stderr.txt");
      const startedAt = Date.now();
      try {
        const result = await executeHelper(
          helperArguments({
            commandArgs: [
              "-e",
              [
                'const { writeFileSync } = require("node:fs");',
                'writeFileSync(1, "child started\\n");',
                'process.on("SIGTERM", () => {});',
                "setInterval(() => {}, 1_000);",
              ].join("\n"),
            ],
            killGraceMs: 60,
            stderrPath,
            stdinPath: "-",
            stdoutPath,
            timeoutMs: 120,
          }),
        );

        expect(result.exitCode).toBe(124);
        expect(Date.now() - startedAt).toBeLessThan(2_000);
        expect(await expectOutputAtMost(stdoutPath, 1_024)).toEqual(
          Buffer.from("child started\n"),
        );
        await expectOutputAtMost(stderrPath, 1_024);
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
    5_000,
  );

  it.each([
    { limitedStream: "stdout", maxStderrBytes: 256, maxStdoutBytes: 32 },
    { limitedStream: "stderr", maxStderrBytes: 32, maxStdoutBytes: 256 },
  ] as const)(
    "returns the overflow status and bounds $limitedStream capture",
    async ({ limitedStream, maxStderrBytes, maxStdoutBytes }) => {
      const root = await mkdtemp(join(tmpdir(), "diesel-bounded-command-"));
      const stdoutPath = join(root, "stdout.bin");
      const stderrPath = join(root, "stderr.bin");
      const targetDescriptor = limitedStream === "stdout" ? 1 : 2;
      try {
        const result = await executeHelper(
          helperArguments({
            commandArgs: [
              "-e",
              [
                'const { writeFileSync } = require("node:fs");',
                `writeFileSync(${targetDescriptor}, Buffer.alloc(4_096, 0x78));`,
              ].join("\n"),
            ],
            maxStderrBytes,
            maxStdoutBytes,
            stderrPath,
            stdinPath: "-",
            stdoutPath,
            timeoutMs: 5_000,
          }),
        );

        expect(result.exitCode).toBe(125);
        await expectOutputAtMost(stdoutPath, maxStdoutBytes);
        await expectOutputAtMost(stderrPath, maxStderrBytes);
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
    10_000,
  );

  it.each(
    (["stdout", "stderr"] as const).flatMap((stream) =>
      (["valid", "held", "malformed", "denied"] as const).map((mode) => ({
        mode,
        stream,
      }))
    ),
  )(
    "resolves $stream overflow during a $mode guardian inventory without weakening containment",
    async ({ mode, stream }) => {
      const root = await mkdtemp(join(tmpdir(), "diesel-inventory-barrier-"));
      const stdoutPath = join(root, "stdout.bin");
      const stderrPath = join(root, "stderr.bin");
      const receiptPath = join(root, "completion.json");
      const token = "123e4567-e89b-42d3-a456-426614174000";
      const preloader = resolve(
        process.cwd(),
        "tests/fixtures/bounded-command-inventory-barrier-preload.cjs",
      );
      const startedAt = Date.now();
      try {
        const result = await executeHelper(
          helperArguments({
            commandArgs: [
              "-e",
              `require("node:fs").writeFileSync(${stream === "stdout" ? 1 : 2}, Buffer.alloc(4_096, 0x78));`,
            ],
            maxStdoutBytes: 32,
            maxStderrBytes: 32,
            stderrPath,
            stdinPath: "-",
            stdoutPath,
            timeoutMs: 5_000,
          }),
          "",
          [],
          {
            ...process.env,
            DIESEL_BOUNDED_COMMAND_COMPLETION_RECEIPT_PATH: receiptPath,
            DIESEL_BOUNDED_COMMAND_COMPLETION_RECEIPT_TOKEN: token,
            DIESEL_BOUNDED_COMMAND_TEST_INVENTORY_BARRIER: JSON.stringify({
              mode, root, stream,
            }),
            NODE_OPTIONS: `--require=${preloader}`,
          },
        );
        const failure = mode === "malformed" || mode === "denied";
        expect(result).toEqual({
          exitCode: failure ? 126 : 125,
          stderr: mode === "malformed"
            ? "bounded-command-v2:group-inventory\n"
            : mode === "denied"
              ? "bounded-command-v2:guardian-group-signal\n"
              : "",
          stdout: "",
        });
        expect(Date.now() - startedAt).toBeLessThan(2_000);
        expect(await readFile(join(root, "signal.received"), "utf8"))
          .toBe("SIGTERM\n");
        expect(await readFile(join(root, "group-signals.log"), "utf8"))
          .toBe(mode === "held"
            ? "SIGKILL:pending\n"
            : "SIGTERM:complete\nSIGKILL:complete\n");
        expect(await expectOutputAtMost(stdoutPath, 32)).toEqual(
          stream === "stdout" ? Buffer.alloc(32, 0x78) : Buffer.alloc(0),
        );
        expect(await expectOutputAtMost(stderrPath, 32)).toEqual(
          stream === "stderr" ? Buffer.alloc(32, 0x78) : Buffer.alloc(0),
        );
        if (failure) {
          await expect(lstat(receiptPath)).rejects.toMatchObject({ code: "ENOENT" });
        } else {
          expect(await readFile(receiptPath, "utf8")).toBe(
            `${JSON.stringify({
              version: "bounded-command-completion-v2",
              token,
              exitCode: 125,
              closeSeen: true,
              groupAbsenceProven: true,
              guardianSealed: true,
            })}\n`,
          );
          const receipt = await lstat(receiptPath);
          expect(receipt.isFile()).toBe(true);
          expect(receipt.mode & 0o777).toBe(0o600);
          expect(receipt.nlink).toBe(1);
        }
      } finally {
        try {
          const pidText = await readFile(join(root, "inventory.ready"), "utf8")
            .catch(() => undefined);
          if (pidText !== undefined) {
            const pid = Number(pidText);
            expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
            await waitForProcessExit(pid, 2_500);
          }
        } finally {
          await rm(root, { force: true, recursive: true });
        }
      }
    },
    10_000,
  );

  it("fails closed after a transient guardian group-signal denial", async () => {
    const root = await mkdtemp(join(tmpdir(), "diesel-bounded-command-"));
    const stdoutPath = join(root, "stdout.bin");
    const stderrPath = join(root, "stderr.bin");
    const preloaderPath = join(root, "transient-group-signal.cjs");
    try {
      await writeFile(
        preloaderPath,
        [
          'const { syncBuiltinESMExports } = require("node:module");',
          "const originalKill = process.kill.bind(process);",
          "let denied = false;",
          "process.kill = function (pid, signal) {",
          "  if (!denied && pid < 0 && signal === \"SIGTERM\") {",
          "    denied = true;",
          '    const error = new Error("transient process-group denial");',
          '    error.code = "EPERM";',
          "    throw error;",
          "  }",
          "  return originalKill(pid, signal);",
          "};",
          "syncBuiltinESMExports();",
          "",
        ].join("\n"),
        "utf8",
      );

      const result = await executeHelper(
        helperArguments({
          commandArgs: [
            "-e",
            [
              'const { writeFileSync } = require("node:fs");',
              "writeFileSync(1, Buffer.alloc(4_096, 0x78));",
              "setInterval(() => {}, 1_000);",
            ].join("\n"),
          ],
          killGraceMs: 60,
          maxStdoutBytes: 32,
          stderrPath,
          stdinPath: "-",
          stdoutPath,
        }),
        "",
        [],
        {
          ...process.env,
          NODE_OPTIONS: `--require=${preloaderPath}`,
        },
      );

      expect(result).toEqual({
        exitCode: 126,
        stderr: "bounded-command-v2:guardian-group-signal\n",
        stdout: "",
      });
      await expectOutputAtMost(stdoutPath, 32);
      await expectOutputAtMost(stderrPath, 1_024);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it(
    "keeps all mutating group signals inside the guardian",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "diesel-bounded-command-"));
      const stdoutPath = join(root, "stdout.bin");
      const stderrPath = join(root, "stderr.bin");
      const preloaderPath = join(root, "denied-group-signals.cjs");
      const descendantPidPath = join(root, "descendant.pid");
      const descendantReadyPath = join(root, "descendant.ready");
      const cleanupPath = join(root, "descendant.cleanup");
      const cleanupAckPath = join(root, "descendant.cleanup-ack");
      let descendantPid: number | undefined;
      try {
        await writeFile(
          preloaderPath,
          [
            'const childProcess = require("node:child_process");',
            'const { syncBuiltinESMExports } = require("node:module");',
            "const originalSpawn = childProcess.spawn;",
            "const originalKill = process.kill.bind(process);",
            "let managedPid;",
            "childProcess.spawn = function (...args) {",
            "  const child = originalSpawn.apply(this, args);",
            "  if (Array.isArray(args[1]) && args[1].includes(\"--bounded-command-guardian-v1\")) managedPid = child.pid;",
            "  return child;",
            "};",
            "process.kill = function (pid, signal) {",
            "  if (managedPid !== undefined && pid === -managedPid && signal !== 0) {",
            '    const error = new Error("persistent process-group denial");',
            '    error.code = "EPERM";',
            "    throw error;",
            "  }",
            "  return originalKill(pid, signal);",
            "};",
            "syncBuiltinESMExports();",
            "",
          ].join("\n"),
          "utf8",
        );

        const descendantSource = [
          'const { existsSync, writeFileSync } = require("node:fs");',
          'writeFileSync(process.argv[1], "ready\\n");',
          "setInterval(() => {",
          "  if (existsSync(process.argv[2])) {",
          '    writeFileSync(process.argv[3], String(process.pid) + "\\n");',
          "    process.exit(0);",
          "  }",
          "}, 20);",
        ].join("\n");
        const leaderSource = [
          'const { spawn } = require("node:child_process");',
          'const { existsSync, writeFileSync } = require("node:fs");',
          'process.on("SIGTERM", () => {});',
          `const descendant = spawn(process.execPath, ["-e", ${JSON.stringify(descendantSource)}, process.argv[2], process.argv[3], process.argv[4]], { detached: false, stdio: "ignore" });`,
          "writeFileSync(process.argv[1], String(descendant.pid));",
          "descendant.unref();",
          "const deadline = Date.now() + 2_000;",
          "while (!existsSync(process.argv[2]) && Date.now() < deadline) {",
          "  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);",
          "}",
          "if (!existsSync(process.argv[2])) process.exit(44);",
          "writeFileSync(1, Buffer.alloc(4_096, 0x78));",
          "setInterval(() => {}, 1_000);",
        ].join("\n");

        const result = await executeHelper(
          helperArguments({
            commandArgs: [
              "-e",
              leaderSource,
              descendantPidPath,
              descendantReadyPath,
              cleanupPath,
              cleanupAckPath,
            ],
            killGraceMs: 60,
            maxStdoutBytes: 32,
            stderrPath,
            stdinPath: "-",
            stdoutPath,
          }),
          "",
          ["--require", preloaderPath],
        );

        descendantPid = Number(await readFile(descendantPidPath, "utf8"));
        expect(Number.isSafeInteger(descendantPid)).toBe(true);
        expect(result).toEqual({ exitCode: 125, stderr: "", stdout: "" });
        expect(processIsRunning(descendantPid)).toBe(false);
        await expectOutputAtMost(stdoutPath, 32);
        await expectOutputAtMost(stderrPath, 1_024);
      } finally {
        await writeFile(cleanupPath, "cleanup\n", "utf8").catch(
          () => undefined,
        );
        if (descendantPid === undefined) {
          const pidText = await readFile(descendantPidPath, "utf8").catch(
            () => undefined,
          );
          const parsedPid = Number(pidText);
          if (Number.isSafeInteger(parsedPid)) descendantPid = parsedPid;
        }
        if (descendantPid !== undefined) {
          try {
            await waitForProcessExit(descendantPid);
          } catch {
            try {
              process.kill(descendantPid, "SIGKILL");
            } catch (error: unknown) {
              if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
            }
            await waitForProcessExit(descendantPid);
          }
        }
        await rm(root, { force: true, recursive: true });
      }
    },
    5_000,
  );

  it.each([
    { expectedExitCode: 129, signal: "SIGHUP" },
    { expectedExitCode: 130, signal: "SIGINT" },
    { expectedExitCode: 143, signal: "SIGTERM" },
  ] as const)(
    "forwards $signal from the supervisor PID and returns $expectedExitCode",
    async ({ expectedExitCode, signal }) => {
      const root = await mkdtemp(join(tmpdir(), "diesel-bounded-command-"));
      const stdoutPath = join(root, "stdout.txt");
      const stderrPath = join(root, "stderr.txt");
      const childPidPath = join(root, "child.pid");
      const readyPath = join(root, "child.ready");
      const signalPath = join(root, "child.signal");
      const cleanupPath = join(root, "child.cleanup");
      const cleanupAckPath = join(root, "child.cleanup-ack");
      let childPid: number | undefined;
      let childExitConfirmed = false;
      const childSource = [
        'const { existsSync, writeFileSync } = require("node:fs");',
        "const [pidPath, readyPath, signalPath, signal, cleanupPath, cleanupAckPath] = process.argv.slice(1);",
        "process.on(signal, () => {",
        '  writeFileSync(signalPath, signal + "\\n");',
        "  process.exit(0);",
        "});",
        "writeFileSync(pidPath, String(process.pid));",
        'writeFileSync(readyPath, "ready\\n");',
        "setInterval(() => {",
        "  if (existsSync(cleanupPath)) {",
        '    writeFileSync(cleanupAckPath, String(process.pid) + "\\n");',
        "    process.exit(0);",
        "  }",
        "}, 20);",
      ].join("\n");
      const supervisor = spawn(
        process.execPath,
        [
          boundedCommandHelper,
          ...helperArguments({
            commandArgs: [
              "-e",
              childSource,
              childPidPath,
              readyPath,
              signalPath,
              signal,
              cleanupPath,
              cleanupAckPath,
            ],
            killGraceMs: 100,
            stderrPath,
            stdinPath: "-",
            stdoutPath,
            timeoutMs: 5_000,
          }),
        ],
        {
          cwd: process.cwd(),
          env: helperEnvironment(),
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const supervisorStdout: Buffer[] = [];
      const supervisorStderr: Buffer[] = [];
      supervisor.stdout.on("data", (chunk: Buffer) => supervisorStdout.push(chunk));
      supervisor.stderr.on("data", (chunk: Buffer) => supervisorStderr.push(chunk));
      const resultPromise = new Promise<CommandResult>((resolveResult, reject) => {
        supervisor.once("error", reject);
        supervisor.once("close", (code) => {
          resolveResult({
            exitCode: code ?? -1,
            stderr: Buffer.concat(supervisorStderr).toString("utf8"),
            stdout: Buffer.concat(supervisorStdout).toString("utf8"),
          });
        });
      });

      try {
        await waitForFile(readyPath);
        childPid = Number(await readFile(childPidPath, "utf8"));
        expect(Number.isSafeInteger(childPid)).toBe(true);
        expect(supervisor.kill(signal)).toBe(true);

        const result = await resultPromise;
        expect(result).toEqual({
          exitCode: expectedExitCode,
          stderr: "",
          stdout: "",
        });
        expect(await readFile(signalPath, "utf8")).toBe(`${signal}\n`);
        await waitForProcessExit(childPid);
        childExitConfirmed = true;
      } finally {
        try {
          try {
            await settleTestSupervisor(supervisor, resultPromise, cleanupPath);
          } finally {
            await waitForManagedProcessCleanup(
              childPid,
              childExitConfirmed,
              cleanupAckPath,
            );
          }
        } finally {
          await rm(root, { force: true, recursive: true });
        }
      }
    },
    5_000,
  );

  it(
    "contains the child group when signalled before spawn returns",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "diesel-bounded-command-"));
      const stdoutPath = join(root, "stdout.txt");
      const stderrPath = join(root, "stderr.txt");
      const preloaderPath = join(root, "spawn-barrier.cjs");
      const managedPidPath = join(root, "managed.pid");
      const cleanupPath = join(root, "managed.cleanup");
      const cleanupAckPath = join(root, "managed.cleanup-ack");
      let managedPid: number | undefined;
      let managedExitConfirmed = false;
      await writeFile(
        preloaderPath,
        [
          'const childProcess = require("node:child_process");',
          'const { writeFileSync } = require("node:fs");',
          'const { syncBuiltinESMExports } = require("node:module");',
          "const originalSpawn = childProcess.spawn;",
          "let intercepted = false;",
          "childProcess.spawn = function (...args) {",
          "  const child = originalSpawn.apply(this, args);",
          "  if (!intercepted && Array.isArray(args[1]) && args[1].includes(\"--bounded-command-guardian-v1\")) {",
          "    intercepted = true;",
          `    writeFileSync(${JSON.stringify(managedPidPath)}, String(child.pid));`,
          "    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);",
          "  }",
          "  return child;",
          "};",
          "syncBuiltinESMExports();",
          "",
        ].join("\n"),
        "utf8",
      );
      const supervisor = spawn(
        process.execPath,
        [
          "--require",
          preloaderPath,
          boundedCommandHelper,
          ...helperArguments({
            commandArgs: [
              "-e",
              [
                'const { existsSync, writeFileSync } = require("node:fs");',
                "const cleanupPath = process.argv[1];",
                "const cleanupAckPath = process.argv[2];",
                "setInterval(() => {",
                "  if (existsSync(cleanupPath)) {",
                '    writeFileSync(cleanupAckPath, String(process.pid) + "\\n");',
                "    process.exit(0);",
                "  }",
                "}, 20);",
              ].join("\n"),
              cleanupPath,
              cleanupAckPath,
            ],
            killGraceMs: 60,
            stderrPath,
            stdinPath: "-",
            stdoutPath,
            timeoutMs: 5_000,
          }),
        ],
        {
          cwd: process.cwd(),
          env: helperEnvironment(),
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const supervisorStdout: Buffer[] = [];
      const supervisorStderr: Buffer[] = [];
      supervisor.stdout.on("data", (chunk: Buffer) => supervisorStdout.push(chunk));
      supervisor.stderr.on("data", (chunk: Buffer) => supervisorStderr.push(chunk));
      const resultPromise = new Promise<CommandResult>((resolveResult, reject) => {
        supervisor.once("error", reject);
        supervisor.once("close", (code) => {
          resolveResult({
            exitCode: code ?? -1,
            stderr: Buffer.concat(supervisorStderr).toString("utf8"),
            stdout: Buffer.concat(supervisorStdout).toString("utf8"),
          });
        });
      });

      try {
        managedPid = Number(await waitForFile(managedPidPath));
        expect(Number.isSafeInteger(managedPid)).toBe(true);
        const signalledAt = Date.now();
        expect(supervisor.kill("SIGTERM")).toBe(true);

        const result = await resultPromise;
        expect(result.exitCode).toBe(143);
        expect(Date.now() - signalledAt).toBeLessThan(2_000);
        await waitForProcessExit(managedPid);
        managedExitConfirmed = true;
      } finally {
        try {
          try {
            await settleTestSupervisor(supervisor, resultPromise, cleanupPath);
          } finally {
            await waitForManagedProcessCleanup(
              managedPid,
              managedExitConfirmed,
              cleanupAckPath,
            );
          }
        } finally {
          await rm(root, { force: true, recursive: true });
        }
      }
    },
    5_000,
  );

  it(
    "keeps SIGKILL escalation active after the leader closes during termination",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "diesel-bounded-command-"));
      const stdoutPath = join(root, "stdout.txt");
      const stderrPath = join(root, "stderr.txt");
      const descendantPidPath = join(root, "descendant.pid");
      const descendantReadyPath = join(root, "descendant.ready");
      const leaderPidPath = join(root, "leader.pid");
      const leaderReadyPath = join(root, "leader.ready");
      const cleanupPath = join(root, "group.cleanup");
      const cleanupAckPath = join(root, "descendant.cleanup-ack");
      const leaderCleanupAckPath = join(root, "leader.cleanup-ack");
      let descendantPid: number | undefined;
      let descendantExitConfirmed = false;
      let leaderPid: number | undefined;
      let leaderExitConfirmed = false;
      const descendantSource = [
        'const { existsSync, writeFileSync } = require("node:fs");',
        'process.on("SIGTERM", () => {});',
        'writeFileSync(process.argv[1], "ready\\n");',
        "setInterval(() => {",
        "  if (existsSync(process.argv[2])) {",
        '    writeFileSync(process.argv[3], String(process.pid) + "\\n");',
        "    process.exit(0);",
        "  }",
        "}, 20);",
      ].join("\n");
      const leaderSource = [
        'const { spawn } = require("node:child_process");',
        'const { existsSync, writeFileSync } = require("node:fs");',
        "writeFileSync(process.argv[6], String(process.pid));",
        `const descendant = spawn(process.execPath, ["-e", ${JSON.stringify(descendantSource)}, process.argv[2], process.argv[4], process.argv[5]], { stdio: "ignore" });`,
        "writeFileSync(process.argv[1], String(descendant.pid));",
        "descendant.unref();",
        "const deadline = Date.now() + 2_000;",
        "while (!existsSync(process.argv[2]) && Date.now() < deadline) {",
        "  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);",
        "}",
        "if (!existsSync(process.argv[2])) process.exit(44);",
        'writeFileSync(process.argv[3], "ready\\n");',
        "setInterval(() => {",
        "  if (existsSync(process.argv[4])) {",
        '    writeFileSync(process.argv[7], String(process.pid) + "\\n");',
        "    process.exit(0);",
        "  }",
        "}, 20);",
      ].join("\n");
      const supervisor = spawn(
        process.execPath,
        [
          boundedCommandHelper,
          ...helperArguments({
            commandArgs: [
              "-e",
              leaderSource,
              descendantPidPath,
              descendantReadyPath,
              leaderReadyPath,
              cleanupPath,
              cleanupAckPath,
              leaderPidPath,
              leaderCleanupAckPath,
            ],
            killGraceMs: 60,
            stderrPath,
            stdinPath: "-",
            stdoutPath,
            timeoutMs: 5_000,
          }),
        ],
        {
          cwd: process.cwd(),
          env: helperEnvironment(),
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const supervisorStdout: Buffer[] = [];
      const supervisorStderr: Buffer[] = [];
      supervisor.stdout.on("data", (chunk: Buffer) => supervisorStdout.push(chunk));
      supervisor.stderr.on("data", (chunk: Buffer) => supervisorStderr.push(chunk));
      const resultPromise = new Promise<CommandResult>((resolveResult, reject) => {
        supervisor.once("error", reject);
        supervisor.once("close", (code) => {
          resolveResult({
            exitCode: code ?? -1,
            stderr: Buffer.concat(supervisorStderr).toString("utf8"),
            stdout: Buffer.concat(supervisorStdout).toString("utf8"),
          });
        });
      });

      try {
        await waitForFile(leaderReadyPath);
        descendantPid = Number(await readFile(descendantPidPath, "utf8"));
        leaderPid = Number(await readFile(leaderPidPath, "utf8"));
        expect(Number.isSafeInteger(descendantPid)).toBe(true);
        expect(Number.isSafeInteger(leaderPid)).toBe(true);
        const signalledAt = Date.now();
        expect(supervisor.kill("SIGTERM")).toBe(true);

        const result = await resultPromise;
        expect(result.exitCode).toBe(143);
        expect(Date.now() - signalledAt).toBeLessThan(2_000);
        await waitForProcessExit(descendantPid);
        descendantExitConfirmed = true;
        await waitForProcessExit(leaderPid);
        leaderExitConfirmed = true;
      } finally {
        try {
          try {
            await settleTestSupervisor(supervisor, resultPromise, cleanupPath);
          } finally {
            await Promise.all([
              waitForManagedProcessCleanup(
                descendantPid,
                descendantExitConfirmed,
                cleanupAckPath,
              ),
              waitForManagedProcessCleanup(
                leaderPid,
                leaderExitConfirmed,
                leaderCleanupAckPath,
              ),
            ]);
          }
        } finally {
          await rm(root, { force: true, recursive: true });
        }
      }
    },
    5_000,
  );

  it.each([
    { label: "closes its stdio", stdioMode: "ignore" },
    { label: "inherits the leader stdio", stdioMode: "inherit" },
  ] as const)(
    "fails closed and seals a same-group descendant that $label",
    async ({ stdioMode }) => {
      const root = await mkdtemp(join(tmpdir(), "diesel-bounded-command-"));
      const stdoutPath = join(root, "stdout.txt");
      const stderrPath = join(root, "stderr.txt");
      const descendantPidPath = join(root, "descendant.pid");
      const descendantReadyPath = join(root, "descendant.ready");
      const cleanupPath = join(root, "descendant.cleanup");
      const cleanupAckPath = join(root, "descendant.cleanup-ack");
      let descendantPid: number | undefined;
      let descendantExitConfirmed = false;
      const startedAt = Date.now();
      try {
        const descendantSource = [
          'const { existsSync, writeFileSync } = require("node:fs");',
          'process.on("SIGTERM", () => {});',
          'writeFileSync(process.argv[1], "ready\\n");',
          "setInterval(() => {",
          "  if (existsSync(process.argv[2])) {",
          '    writeFileSync(process.argv[3], String(process.pid) + "\\n");',
          "    process.exit(0);",
          "  }",
          "}, 20);",
        ].join("\n");
        const leaderSource = [
          'const { spawn } = require("node:child_process");',
          'const { existsSync, writeFileSync } = require("node:fs");',
          "const stdio = process.argv[3] === \"inherit\"",
          '  ? ["ignore", "inherit", "inherit"]',
          '  : "ignore";',
          `const descendant = spawn(process.execPath, ["-e", ${JSON.stringify(descendantSource)}, process.argv[2], process.argv[4], process.argv[5]], { stdio });`,
          "writeFileSync(process.argv[1], String(descendant.pid));",
          "descendant.unref();",
          "const deadline = Date.now() + 2_000;",
          "while (!existsSync(process.argv[2]) && Date.now() < deadline) {",
          "  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);",
          "}",
          "if (!existsSync(process.argv[2])) process.exit(44);",
        ].join("\n");

        const result = await executeHelper(
          helperArguments({
            commandArgs: [
              "-e",
              leaderSource,
              descendantPidPath,
              descendantReadyPath,
              stdioMode,
              cleanupPath,
              cleanupAckPath,
            ],
            killGraceMs: 60,
            stderrPath,
            stdinPath: "-",
            stdoutPath,
            timeoutMs: 5_000,
          }),
          "",
          [],
          helperEnvironment(process.env, descendantPidPath),
        );

        descendantPid = Number(await readFile(descendantPidPath, "utf8"));
        expect(Number.isSafeInteger(descendantPid)).toBe(true);
        expect(result.exitCode).toBe(126);
        expect(result.stderr).toBe("bounded-command-v2:residual-group\n");
        expect(Date.now() - startedAt).toBeLessThan(2_000);
        await waitForProcessExit(descendantPid);
        descendantExitConfirmed = true;
        await expectOutputAtMost(stdoutPath, 1_024);
        await expectOutputAtMost(stderrPath, 1_024);
      } finally {
        try {
          await writeFile(cleanupPath, "cleanup\n", "utf8").catch(
            () => undefined,
          );
          await waitForManagedProcessCleanup(
            descendantPid,
            descendantExitConfirmed,
            cleanupAckPath,
          );
        } finally {
          await rm(root, { force: true, recursive: true });
        }
      }
    },
    5_000,
  );
});
