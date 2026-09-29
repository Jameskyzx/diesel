import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createPrepareRealpathShim } from "./helpers/prepare-native-realpath";

const execFileAsync = promisify(execFile);
const directories: string[] = [];
const nodeResolution = 'process.stdout.write(require("node:fs").realpathSync(process.argv[1])+"\\n")';
const specialName = "quoted ' $HOME ; $(touch injected) `touch injected`";

async function createFixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "diesel-native-realpath-")));
  directories.push(directory);
  const lifecycleLock = join(directory, "lock ' $(touch injected) `touch injected`");
  await mkdir(join(directory, "directory", "nested"), { recursive: true });
  await Promise.all(
    ["file", "other", "directory/file", "-not-a-node-flag", specialName, "newline\n"]
      .map((name) => writeFile(join(directory, name), "fixture\n")),
  );
  await writeFile(lifecycleLock, "");
  await Promise.all([
    symlink("file", join(directory, "link")),
    symlink("link", join(directory, "chain")),
    symlink("missing", join(directory, "broken")),
    symlink("directory/nested", join(directory, "directory-link")),
    symlink("directory-link/../file", join(directory, "target-dot-dot")),
    symlink("target-dot-dot", join(directory, "target-dot-dot-chain")),
    symlink("cycle", join(directory, "cycle")),
  ]);
  return { directory, lifecycleLock };
}

async function execute(file: string, args: string[], cwd: string) {
  try {
    const result = await execFileAsync(file, args, { cwd });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error: unknown) {
    if (!(error instanceof Error) || !("code" in error) || !("stdout" in error) || !("stderr" in error)) {
      throw error;
    }
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

async function writeShim(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  mode: "host" | "Node fallback",
  fd8LogPath?: string,
) {
  const source = await createPrepareRealpathShim(
    fixture.lifecycleLock,
    fixture.directory,
    {
      ...(mode === "Node fallback" ? { platform: "freebsd" as const } : {}),
      ...(fd8LogPath === undefined ? {} : { fd8LogPath }),
    },
  );
  const shim = join(fixture.directory, "realpath-shim");
  await writeFile(shim, source);
  await chmod(shim, 0o755);
  return { source, shim };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("prepare fixture native realpath capability selection", () => {
  it.each([
    { platform: "darwin", file: "/bin/realpath", args: ["--"] },
    { platform: "linux", file: "/usr/bin/realpath", args: ["-e", "--"] },
  ] as const)("uses the fixed $platform command contract (simulated capability responses)", async ({ platform, file, args }) => {
    const fixture = await createFixture();
    const runCommand = vi.fn(async (_file: string, operands: string[]) => (
      operands.at(-1) === fixture.directory
        ? { code: 0, stdout: `${fixture.directory}\n` }
        : { code: 1, stdout: "" }
    ));
    const source = await createPrepareRealpathShim(fixture.lifecycleLock, fixture.directory, { platform, runCommand });
    expect(runCommand).toHaveBeenCalledTimes(2);
    expect(runCommand).toHaveBeenNthCalledWith(1, file, [...args, fixture.directory]);
    expect(runCommand).toHaveBeenNthCalledWith(2, file, [...args, expect.stringMatching(/\/\.realpath-probe-[0-9a-f-]+$/)]);
    expect(source).toContain([file, ...args].map((value) => `'${value}'`).join(" "));
    expect(source).toContain('[[ "$native_path" == "$path" ]]');
  });

  it.each([
    "unavailable",
    "wrong existing result",
    "missing leaf accepted",
    "abnormal missing exit",
    "missing result contains output",
  ])("keeps Node for an incompatible native backend: %s", async (failure) => {
    const fixture = await createFixture();
    const runCommand = async (_file: string, operands: string[]) => {
      if (failure === "unavailable") throw new Error("native command unavailable");
      if (operands.at(-1) === fixture.directory) {
        return { code: 0, stdout: failure === "wrong existing result" ? "/wrong\n" : `${fixture.directory}\n` };
      }
      return {
        code: failure === "missing leaf accepted" ? 0 : failure === "abnormal missing exit" ? null : 1,
        stdout: failure === "missing result contains output" ? "unexpected\n" : "",
      };
    };
    const source = await createPrepareRealpathShim(fixture.lifecycleLock, fixture.directory, { platform: "linux", runCommand });
    expect(source).not.toContain("native_path=");
    expect(source).toContain("realpathSync(process.argv[1])");
  });

  it("does not probe an unsupported platform", async () => {
    const fixture = await createFixture();
    const runCommand = vi.fn();
    const source = await createPrepareRealpathShim(fixture.lifecycleLock, fixture.directory, { platform: "freebsd", runCommand });
    expect(runCommand).not.toHaveBeenCalled();
    expect(source).not.toContain("native_path=");
  });

  it("verifies the real host command before selecting the identity-only fast path", async () => {
    const fixture = await createFixture();
    const { source } = await writeShim(fixture, "host");
    if (process.platform === "darwin") {
      expect(source).toContain("'/bin/realpath' '--'");
      expect(source).not.toContain("'-e'");
    } else if (process.platform === "linux") {
      expect(source).toContain("'/usr/bin/realpath' '-e' '--'");
    } else {
      expect(source).not.toContain("native_path=");
    }
  });
});

describe.each(["host", "Node fallback"] as const)("prepare fixture fresh realpath via %s", (mode) => {
  it.each([
    { name: "file", operand: "file", absolute: true },
    { name: "directory", operand: "directory", absolute: true },
    { name: "symlink chain", operand: "chain", absolute: true },
    { name: "broken symlink", operand: "broken", absolute: true },
    { name: "missing leaf", operand: "missing", absolute: true },
    { name: "missing parent", operand: "missing/child", absolute: true },
    { name: "symlink cycle", operand: "cycle", absolute: true },
    { name: "dot component", operand: "./file", absolute: true },
    { name: "dot-dot after a symlink", operand: "directory-link/../file", absolute: true },
    { name: "dot-dot after a missing directory", operand: "missing/../file", absolute: true },
    { name: "dot-dot in symlink target", operand: "target-dot-dot", absolute: true },
    { name: "dot-dot in chained symlink target", operand: "target-dot-dot-chain", absolute: true },
    { name: "repeated slash", operand: "directory//file", absolute: true },
    { name: "trailing slash on a file", operand: "file/", absolute: true },
    { name: "trailing slash on a directory", operand: "directory/", absolute: true },
    { name: "shell syntax in the path", operand: specialName, absolute: true },
    { name: "trailing newline", operand: "newline\n", absolute: true },
    { name: "relative path", operand: "file", absolute: false },
    { name: "option-shaped relative path", operand: "-not-a-node-flag", absolute: false },
    { name: "option delimiter operand", operand: "--", absolute: false },
    { name: "empty path", operand: "", absolute: false },
  ])("matches the original Node shim for $name", async ({ operand, absolute }) => {
    const fixture = await createFixture();
    const { shim } = await writeShim(fixture, mode);
    // Do not use path.join here: it would erase the dot/dot-dot inputs under test.
    const path = absolute ? `${fixture.directory}/${operand}` : operand;
    const expected = await execute(process.execPath, ["-e", nodeResolution, path], fixture.directory);
    const actual = await execute(shim, ["--", path], fixture.directory);
    expect(actual.code).toBe(expected.code);
    expect(actual.stdout).toBe(expected.stdout);
    if (expected.code !== 0) {
      expect(actual.stderr).toBe(expected.stderr);
    }
    await expect(stat(join(fixture.directory, "injected"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reads retargeted links and removed paths afresh using the same shim", async () => {
    const fixture = await createFixture();
    const { shim } = await writeShim(fixture, mode);
    const link = join(fixture.directory, "link");
    const file = join(fixture.directory, "file");
    const compare = async (path: string) => {
      const expected = await execute(process.execPath, ["-e", nodeResolution, path], fixture.directory);
      const actual = await execute(shim, ["--", path], fixture.directory);
      expect(actual.code).toBe(expected.code);
      expect(actual.stdout).toBe(expected.stdout);
      return actual;
    };
    expect((await compare(link)).stdout).toBe(`${file}\n`);
    expect((await compare(file)).code).toBe(0);
    await rm(link);
    await symlink("other", link);
    expect((await compare(link)).stdout).toBe(`${fixture.directory}/other\n`);
    await rm(join(fixture.directory, "other"));
    expect((await compare(link)).code).toBe(1);
    await rm(file);
    expect((await compare(file)).code).toBe(1);
    await writeFile(file, "recreated\n");
    expect((await compare(file)).stdout).toBe(`${file}\n`);
  });

  it("preserves only the existing proc FD 8 special case with safe lock quoting", async () => {
    const fixture = await createFixture();
    const { shim, source } = await writeShim(fixture, mode);
    expect(source).not.toContain("realpath-fd8");
    for (const path of ["/proc/self/fd/8", "/proc/123/fd/8"]) {
      expect(await execute(shim, ["--", path], fixture.directory)).toMatchObject({ code: 0, stdout: `${fixture.lifecycleLock}\n` });
    }
    for (const path of ["/proc/diesel-nonexistent/fd/80", "/proc/diesel-nonexistent/fd/9"]) {
      expect(await execute(shim, ["--", path], fixture.directory)).toMatchObject({ code: 1, stdout: "" });
    }
    await expect(stat(join(fixture.directory, "injected"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("appends exactly one optional FD 8 event and safely quotes the log path", async () => {
    const fixture = await createFixture();
    const logPath = join(fixture.directory, `events ${specialName}\n.log`);
    const { shim } = await writeShim(fixture, mode, logPath);
    await writeFile(logPath, "existing event\n");

    const ordinaryPath = join(fixture.directory, "file");
    expect(await execute(shim, ["--", ordinaryPath], fixture.directory)).toEqual({
      code: 0,
      stdout: `${ordinaryPath}\n`,
      stderr: "",
    });
    await expect(readFile(logPath, "utf8")).resolves.toBe("existing event\n");

    for (const [index, path] of ["/proc/self/fd/8", "/proc/123/fd/8"].entries()) {
      expect(await execute(shim, ["--", path], fixture.directory)).toEqual({
        code: 0,
        stdout: `${fixture.lifecycleLock}\n`,
        stderr: "",
      });
      await expect(readFile(logPath, "utf8")).resolves.toBe(
        `existing event\n${"realpath-fd8\n".repeat(index + 1)}`,
      );
    }

    expect(await execute(shim, ["--", ordinaryPath], fixture.directory)).toEqual({
      code: 0,
      stdout: `${ordinaryPath}\n`,
      stderr: "",
    });
    expect(await execute(shim, ["--", "/proc/diesel-nonexistent/fd/80"], fixture.directory))
      .toMatchObject({ code: 1, stdout: "" });
    await expect(readFile(logPath, "utf8")).resolves.toBe(
      "existing event\nrealpath-fd8\nrealpath-fd8\n",
    );
    await expect(stat(join(fixture.directory, "injected"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("prints the FD 8 identity before propagating a log append failure", async () => {
    const fixture = await createFixture();
    const { shim } = await writeShim(fixture, mode, join(fixture.directory, "absent", "events.log"));

    const result = await execute(shim, ["--", "/proc/self/fd/8"], fixture.directory);

    expect(result.code).toBe(1);
    expect(result.stdout).toBe(`${fixture.lifecycleLock}\n`);
    expect(result.stderr).not.toBe("");
  });

  it("keeps caller stdin and inherited FD 8 at their original offsets while logging", async () => {
    const fixture = await createFixture();
    const logPath = join(fixture.directory, "fd8-events.log");
    const inputPath = join(fixture.directory, "caller-input");
    const ordinaryPath = join(fixture.directory, "file");
    const { shim } = await writeShim(fixture, mode, logPath);
    await writeFile(fixture.lifecycleLock, "fd8 first\nfd8 second\n");
    await writeFile(inputPath, "stdin first\nstdin second\n");

    const result = await execute("/bin/bash", [
      "--noprofile",
      "--norc",
      "-c",
      [
        "set -euo pipefail",
        'exec 8<"$2"',
        'exec <"$3"',
        'IFS= read -r fd8_before <&8',
        'IFS= read -r stdin_before',
        '"$1" -- /proc/self/fd/8',
        '"$1" -- "$4"',
        'IFS= read -r fd8_after <&8',
        'IFS= read -r stdin_after',
        'printf "%s|%s\\n" "$fd8_before" "$fd8_after"',
        'printf "%s|%s\\n" "$stdin_before" "$stdin_after"',
      ].join("\n"),
      "realpath-fd8-log-fixture",
      shim,
      fixture.lifecycleLock,
      inputPath,
      ordinaryPath,
    ], fixture.directory);

    expect(result).toEqual({
      code: 0,
      stdout: `${fixture.lifecycleLock}\n${ordinaryPath}\nfd8 first|fd8 second\nstdin first|stdin second\n`,
      stderr: "",
    });
    await expect(readFile(logPath, "utf8")).resolves.toBe("realpath-fd8\n");
    await expect(readFile(fixture.lifecycleLock, "utf8")).resolves.toBe("fd8 first\nfd8 second\n");
    await expect(readFile(inputPath, "utf8")).resolves.toBe("stdin first\nstdin second\n");
  });
});
