import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  link,
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

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createFixtureSha256sumShim,
  type FixtureSha256CapabilityProbe,
} from "./helpers/fixture-sha256sum";

const directories: string[] = [];
const backendMarker = "PRIVATE_NATIVE_BACKEND_DIAGNOSTIC";

type BackendMode =
  | "valid-binary"
  | "nonzero"
  | "valid-digest-nonzero"
  | "wrong-digest"
  | "wrong-binary-digest"
  | "short-digest"
  | "long-digest"
  | "extra-nul"
  | "text-hex"
  | "multiline-hex"
  | "empty-output"
  | "prefix"
  | "suffix";

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function createFixture() {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "diesel-fixture-sha256sum-")),
  );
  directories.push(directory);
  return { directory };
}

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function writeExecutable(path: string, source: string): Promise<void> {
  await writeFile(path, source);
  await chmod(path, 0o755);
}

async function writeShim(
  fixture: Fixture,
  options: {
    nativeExecutable?: string | null;
    runCapabilityProbe?: FixtureSha256CapabilityProbe;
  } = {},
): Promise<string> {
  const path = join(fixture.directory, "sha256sum-shim");
  const source = createFixtureSha256sumShim(options);
  expect(typeof source).toBe("string");
  await writeExecutable(path, source);
  return path;
}

function execute(
  file: string,
  args: string[],
  cwd: string,
  input?: string,
) {
  const result = spawnSync(file, args, {
    cwd,
    encoding: "utf8",
    input,
    maxBuffer: 1_024 * 1_024,
    timeout: 5_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  return {
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function expectDigest(
  shim: string,
  path: string,
  bytes: Uint8Array | string,
  cwd: string,
  precedingArguments = ["--"],
): void {
  expect(execute(shim, [...precedingArguments, path], cwd)).toEqual({
    code: 0,
    stdout: `${sha256(bytes)}  ${path}\n`,
    stderr: "",
  });
}

async function createBackend(
  fixture: Fixture,
  mode: BackendMode,
  failureMutation?: { path: string; content: string },
) {
  const executable = join(
    fixture.directory,
    "native ' $(touch injected) `touch injected`",
  );
  const modePath = join(fixture.directory, "backend-mode.json");
  const logPath = join(fixture.directory, "backend-invocations.jsonl");
  await writeFile(modePath, JSON.stringify(mode));
  await writeFile(logPath, "");
  const source = `
const fs = require("node:fs");
const crypto = require("node:crypto");
const bytes = fs.readFileSync(0);
const args = process.argv.slice(1);
fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({ args, inputBase64: bytes.toString("base64") }) + "\\n");
if (JSON.stringify(args) !== JSON.stringify(["dgst", "-sha256", "-binary"])) process.exit(91);
const mode = JSON.parse(fs.readFileSync(${JSON.stringify(modePath)}, "utf8"));
const digest = crypto.createHash("sha256").update(bytes).digest();
const failureMutation = ${JSON.stringify(failureMutation ?? null)};
let output = digest;
switch (mode) {
  case "nonzero": process.stdout.write(output.subarray(0, 17)); process.stderr.write(${JSON.stringify(backendMarker)}); process.exit(73);
  case "valid-digest-nonzero":
    if (failureMutation) fs.writeFileSync(failureMutation.path, failureMutation.content);
    process.stdout.write(output);
    process.stderr.write(${JSON.stringify(backendMarker)});
    process.exit(73);
  case "wrong-digest": output = Buffer.alloc(32); break;
  case "wrong-binary-digest": if (bytes.length > 0) output = Buffer.alloc(32); break;
  case "short-digest": output = digest.subarray(0, 31); break;
  case "long-digest": output = Buffer.concat([digest, Buffer.from([1])]); break;
  case "extra-nul": output = Buffer.concat([digest, Buffer.from([0])]); break;
  case "text-hex": output = Buffer.from(digest.toString("hex")); break;
  case "multiline-hex": output = Buffer.from(digest.toString("hex") + "\\n\\n"); break;
  case "empty-output": output = Buffer.alloc(0); break;
  case "prefix": output = Buffer.concat([Buffer.from(${JSON.stringify(backendMarker)}), digest]); break;
  case "suffix": output = Buffer.concat([digest, Buffer.from(${JSON.stringify(backendMarker)})]); break;
}
process.stderr.write(${JSON.stringify(backendMarker)});
process.stdout.write(output);
`;
  await writeExecutable(
    executable,
    `#!/bin/bash\nexec ${shellQuote(process.execPath)} -e ${shellQuote(source)} "$@"\n`,
  );
  return {
    executable,
    logPath,
    setMode: async (nextMode: BackendMode) => {
      await writeFile(modePath, JSON.stringify(nextMode));
    },
  };
}

async function readInvocations(logPath: string): Promise<
  Array<{ args: string[]; inputBase64: string }>
> {
  const text = await readFile(logPath, "utf8");
  if (!text) return [];
  return text.trimEnd().split("\n").map((line) => {
    const value: unknown = JSON.parse(line);
    if (
      typeof value !== "object" || value === null ||
      !("args" in value) || !Array.isArray(value.args) ||
      !value.args.every((argument: unknown) => typeof argument === "string") ||
      !("inputBase64" in value) || typeof value.inputBase64 !== "string"
    ) {
      throw new Error("Invalid native fixture invocation record.");
    }
    return { args: value.args as string[], inputBase64: value.inputBase64 };
  });
}

const nativeCapabilityInputs = [
  Buffer.alloc(0),
  Buffer.from([0, 255, 10, 13, 65, 194, 181, 0, 127]),
];
const converterCapabilityDigest = createHash("sha256")
  .update("fixture-converter-probe")
  .digest();

function expectedNativeCapabilityCalls(executable: string, count: 1 | 2) {
  return nativeCapabilityInputs.slice(0, count).map((input) => [
    executable,
    ["dgst", "-sha256", "-binary"],
    { input, maxBuffer: 4_096, timeout: 2_000 },
  ]);
}

function nativeCapabilityResult(
  mode: BackendMode,
  input: Buffer,
): ReturnType<FixtureSha256CapabilityProbe> {
  const digest = createHash("sha256").update(input).digest();
  switch (mode) {
    case "nonzero": return { status: 73, stdout: digest.subarray(0, 17) };
    case "valid-digest-nonzero": return { status: 73, stdout: digest };
    case "wrong-digest": return { status: 0, stdout: Buffer.alloc(32) };
    case "wrong-binary-digest":
      return { status: 0, stdout: input.length === 0 ? digest : Buffer.alloc(32) };
    case "short-digest": return { status: 0, stdout: digest.subarray(0, 31) };
    case "long-digest": return { status: 0, stdout: Buffer.concat([digest, Buffer.from([1])]) };
    case "extra-nul": return { status: 0, stdout: Buffer.concat([digest, Buffer.from([0])]) };
    case "text-hex": return { status: 0, stdout: Buffer.from(digest.toString("hex")) };
    case "multiline-hex": return { status: 0, stdout: Buffer.from(`${digest.toString("hex")}\n\n`) };
    case "empty-output": return { status: 0, stdout: Buffer.alloc(0) };
    case "prefix": return { status: 0, stdout: Buffer.concat([Buffer.from(backendMarker), digest]) };
    case "suffix": return { status: 0, stdout: Buffer.concat([digest, Buffer.from(backendMarker)]) };
    case "valid-binary": return { status: 0, stdout: digest };
  }
}

async function expectRejectedCapabilityFallback(
  fixture: Fixture,
  backend: Awaited<ReturnType<typeof createBackend>>,
  shim: string,
): Promise<void> {
  const source = await readFile(shim, "utf8");
  expect(source).not.toContain(shellQuote(backend.executable));
  expect(source).toContain(shellQuote(process.execPath));
  // Decision tests inject probe results; they do not claim an OS backend ran.
  // A now-valid executable must still not be consulted by the generated fallback.
  expect(await readInvocations(backend.logPath)).toEqual([]);
  await backend.setMode("valid-binary");
  const path = join(fixture.directory, "payload");
  const bytes = Buffer.from("actual fresh fallback payload\0\r\n");
  await writeFile(path, bytes);
  expectDigest(shim, path, bytes, fixture.directory);
  expect(await readInvocations(backend.logPath)).toEqual([]);
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe.each(["default selection", "captured Node fallback"] as const)(
  "fresh fixture SHA-256 through %s",
  (mode) => {
    const options = mode === "captured Node fallback"
      ? { nativeExecutable: null }
      : {};

    it.each([
      { name: "empty file", bytes: Buffer.alloc(0) },
      {
        name: "binary data including NUL and invalid UTF-8",
        bytes: Buffer.from([0, 0xff, 0xc3, 0x28, 1, 0, 0xfe, 0x80, 0x7f]),
      },
      { name: "UTF-8 and CRLF", bytes: Buffer.from("中文🙂\r\nsecond line\r\n") },
      { name: "large binary file", bytes: Buffer.alloc(1_048_593, 0xa5) },
    ])("hashes the exact bytes of $name", async ({ bytes }) => {
      const fixture = await createFixture();
      const shim = await writeShim(fixture, options);
      const path = join(fixture.directory, "payload");
      await writeFile(path, bytes);

      expectDigest(shim, path, bytes, fixture.directory);
    });

    it("selects only the last argument, preserving the original output pathname", async () => {
      const fixture = await createFixture();
      const shim = await writeShim(fixture, options);
      const path = join(fixture.directory, "payload");
      await writeFile(path, "selected content");

      expectDigest(shim, path, "selected content", fixture.directory, [
        "ignored-nonexistent-first-argument",
        "--",
        "ignored-nonexistent-second-argument",
      ]);
    });

    it.each([
      "space in path",
      "single'and\"double quote",
      "$HOME;$(touch injected)`touch injected`",
      "中文🙂",
      "line\nbreak",
      "trailing-newline\n",
      "back\\slash",
      "tab\tname",
      "-option-shaped-name",
    ])("treats unusual absolute pathname %j literally", async (name) => {
      const fixture = await createFixture();
      const shim = await writeShim(fixture, options);
      const path = join(fixture.directory, name);
      await writeFile(path, "literal pathname fixture\0\r\n");

      expectDigest(shim, path, "literal pathname fixture\0\r\n", fixture.directory);
      await expect(stat(join(fixture.directory, "injected"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    });

    it("reads same-length mutations and deletion/recreation afresh with the same shim", async () => {
      const fixture = await createFixture();
      const shim = await writeShim(fixture, options);
      const path = join(fixture.directory, "mutable");
      const original = "before!!";
      const changed = "after!!!";
      expect(original.length).toBe(changed.length);
      await writeFile(path, original);
      expectDigest(shim, path, original, fixture.directory);

      await writeFile(path, changed);
      expectDigest(shim, path, changed, fixture.directory);
      await rm(path);
      expect(execute(shim, ["--", path], fixture.directory)).toMatchObject({
        code: 1,
        stdout: "",
      });
      await writeFile(path, "created!");
      expectDigest(shim, path, "created!", fixture.directory);
    });

    it("observes writes through a hard link without caching either pathname", async () => {
      const fixture = await createFixture();
      const shim = await writeShim(fixture, options);
      const path = join(fixture.directory, "original");
      const alias = join(fixture.directory, "hard-link");
      await writeFile(path, "first!");
      await link(path, alias);
      expectDigest(shim, path, "first!", fixture.directory);
      expectDigest(shim, alias, "first!", fixture.directory);

      await writeFile(alias, "later!");
      expectDigest(shim, path, "later!", fixture.directory);
      expectDigest(shim, alias, "later!", fixture.directory);
    });

    it("follows each fresh symlink target while retaining the symlink pathname in output", async () => {
      const fixture = await createFixture();
      const shim = await writeShim(fixture, options);
      const path = join(fixture.directory, "symbolic-link");
      await writeFile(join(fixture.directory, "first"), "first target");
      await writeFile(join(fixture.directory, "other"), "other target");
      await symlink("first", path);
      expectDigest(shim, path, "first target", fixture.directory);

      await rm(path);
      await symlink("other", path);
      expectDigest(shim, path, "other target", fixture.directory);
      await rm(join(fixture.directory, "other"));
      expect(execute(shim, ["--", path], fixture.directory)).toMatchObject({
        code: 1,
        stdout: "",
      });
    });

    it.each(["missing", "directory", "dangling symlink"])(
      "returns nonzero without partial stdout for a %s",
      async (kind) => {
        const fixture = await createFixture();
        const shim = await writeShim(fixture, options);
        const path = join(fixture.directory, "invalid-target");
        if (kind === "directory") await mkdir(path);
        if (kind === "dangling symlink") await symlink("missing-target", path);

        const result = execute(shim, ["--", path], fixture.directory);
        expect(result.code).not.toBe(0);
        expect(result.stdout).toBe("");
      },
    );

    it("leaves caller stdin and inherited FD 8 unread and open", async () => {
      const fixture = await createFixture();
      const shim = await writeShim(fixture, options);
      const path = join(fixture.directory, "payload");
      const descriptorPath = join(fixture.directory, "descriptor-eight");
      await writeFile(path, Buffer.from([0, 1, 0xff]));
      await writeFile(descriptorPath, "fd-eight-preserved\n");
      const result = execute("/bin/bash", [
        "-c",
        'set -euo pipefail\nexec 8< "$3"\n"$1" -- "$2"\nIFS= read -r caller_input\nIFS= read -r descriptor_input <&8\nprintf "stdin:%s\\nfd8:%s\\n" "$caller_input" "$descriptor_input"\n',
        "fixture-parent",
        shim,
        path,
        descriptorPath,
      ], fixture.directory, "caller-input-preserved\n");

      expect(result).toEqual({
        code: 0,
        stdout: `${sha256(Buffer.from([0, 1, 0xff]))}  ${path}\n` +
          "stdin:caller-input-preserved\nfd8:fd-eight-preserved\n",
        stderr: "",
      });
    });
  },
);

describe("fixture SHA-256 native capability and runtime fallback", () => {
  it("uses captured process.execPath for the forced fallback, without resolving node from PATH", async () => {
    const fixture = await createFixture();
    const shim = await writeShim(fixture, { nativeExecutable: null });
    const path = join(fixture.directory, "payload");
    await writeFile(path, "captured runtime");
    await writeExecutable(
      join(fixture.directory, "node"),
      `#!/bin/bash\nprintf '%s' ${shellQuote(backendMarker)} >&2\nexit 89\n`,
    );

    const result = spawnSync(shim, ["--", path], {
      cwd: fixture.directory,
      encoding: "utf8",
      env: { NODE_ENV: "test", PATH: fixture.directory },
      timeout: 5_000,
    });

    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${sha256("captured runtime")}  ${path}\n`);
    expect(result.stderr).toBe("");
  });

  it(
    "accepts exact binary digests using the fixed argv and stdin capability probes",
    async () => {
      const fixture = await createFixture();
      const backend = await createBackend(fixture, "valid-binary");
      const shim = await writeShim(fixture, { nativeExecutable: backend.executable });
      const probes = await readInvocations(backend.logPath);
      expect(probes).toHaveLength(2);
      for (const probe of probes) {
        expect(probe.args).toEqual(["dgst", "-sha256", "-binary"]);
      }
      expect(probes[0]?.inputBase64).toBe("");
      expect(Buffer.from(probes[1]?.inputBase64 ?? "", "base64").length).toBeGreaterThan(0);
      const path = join(fixture.directory, "payload");
      const bytes = Buffer.from([0xff, 0, 0xc3, 0x28, 0x0d, 0x0a]);
      await writeFile(path, bytes);

      expectDigest(shim, path, bytes, fixture.directory);

      const invocations = await readInvocations(backend.logPath);
      expect(invocations).toHaveLength(3);
      expect(invocations[2]).toEqual({
        args: ["dgst", "-sha256", "-binary"],
        inputBase64: bytes.toString("base64"),
      });
      await expect(stat(join(fixture.directory, "injected"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );

  it("falls back when the native executable is unavailable", async () => {
    const fixture = await createFixture();
    const shim = await writeShim(fixture, {
      nativeExecutable: join(fixture.directory, "does-not-exist"),
    });
    const path = join(fixture.directory, "payload");
    await writeFile(path, "fallback bytes\0");

    expectDigest(shim, path, "fallback bytes\0", fixture.directory);
  });

  it("preserves NUL bytes inside a valid raw digest instead of losing them in shell substitution", async () => {
    const fixture = await createFixture();
    const backend = await createBackend(fixture, "valid-binary");
    const shim = await writeShim(fixture, { nativeExecutable: backend.executable });
    let bytes: Buffer | undefined;
    for (let index = 0; index < 4_096; index += 1) {
      const candidate = Buffer.from(`payload with a binary digest ${index}`);
      if (createHash("sha256").update(candidate).digest().includes(0)) {
        bytes = candidate;
        break;
      }
    }
    if (bytes === undefined) throw new Error("No NUL-containing digest fixture found.");
    const path = join(fixture.directory, "nul-digest-payload");
    await writeFile(path, bytes);

    expectDigest(shim, path, bytes, fixture.directory);

    expect(await readInvocations(backend.logPath)).toHaveLength(3);
  });

  it("falls back silently if a previously accepted native executable disappears", async () => {
    const fixture = await createFixture();
    const backend = await createBackend(fixture, "valid-binary");
    const shim = await writeShim(fixture, { nativeExecutable: backend.executable });
    await rm(backend.executable);
    const path = join(fixture.directory, "payload");
    await writeFile(path, "fresh fallback after executable removal");

    expectDigest(shim, path, "fresh fallback after executable removal", fixture.directory);

    expect(await readInvocations(backend.logPath)).toHaveLength(2);
  });

  it.each([
    "nonzero",
    "valid-digest-nonzero",
    "wrong-digest",
    "wrong-binary-digest",
    "short-digest",
    "long-digest",
    "extra-nul",
    "text-hex",
    "multiline-hex",
    "empty-output",
    "prefix",
    "suffix",
  ] as const)("decision unit rejects incompatible native capability: %s", async (mode) => {
    const fixture = await createFixture();
    const backend = await createBackend(fixture, mode);
    const runCapabilityProbe = vi.fn<FixtureSha256CapabilityProbe>(
      (_command, _args, { input }) => nativeCapabilityResult(mode, input),
    );
    const shim = await writeShim(fixture, {
      nativeExecutable: backend.executable,
      runCapabilityProbe,
    });
    const expectedCount = mode === "wrong-binary-digest" ? 2 : 1;
    expect(runCapabilityProbe).toHaveBeenCalledTimes(expectedCount);
    expect(runCapabilityProbe.mock.calls).toStrictEqual(
      expectedNativeCapabilityCalls(backend.executable, expectedCount),
    );

    await expectRejectedCapabilityFallback(fixture, backend, shim);
  });

  it.each(["error", "throw", "null output", "text output"] as const)(
    "decision unit rejects native probe %s without claiming backend execution",
    async (failure) => {
      const fixture = await createFixture();
      const backend = await createBackend(fixture, "valid-binary");
      const runCapabilityProbe = vi.fn<FixtureSha256CapabilityProbe>(
        (_command, _args, { input }) => {
          const digest = createHash("sha256").update(input).digest();
          if (failure === "throw") throw new Error(backendMarker);
          if (failure === "error") {
            return { error: new Error(backendMarker), status: 0, stdout: digest };
          }
          return { status: 0, stdout: failure === "null output" ? null : digest.toString("hex") };
        },
      );
      const shim = await writeShim(fixture, {
        nativeExecutable: backend.executable,
        runCapabilityProbe,
      });
      expect(runCapabilityProbe).toHaveBeenCalledTimes(1);
      expect(runCapabilityProbe.mock.calls).toStrictEqual(
        expectedNativeCapabilityCalls(backend.executable, 1),
      );

      await expectRejectedCapabilityFallback(fixture, backend, shim);
    },
  );

  it.each([
    "error",
    "throw",
    "nonzero",
    "wrong digest",
    "trailing NUL",
    "buffer output",
  ] as const)("decision unit rejects fixed od converter %s", async (failure) => {
    const fixture = await createFixture();
    const backend = await createBackend(fixture, "valid-binary");
    const runCapabilityProbe = vi.fn<FixtureSha256CapabilityProbe>(
      (command, _args, { input }) => {
        if (command === backend.executable) {
          return nativeCapabilityResult("valid-binary", input);
        }
        const validText = `${Array.from(input, (byte) => byte.toString(16).padStart(2, "0")).join(" ")}\n`;
        if (failure === "throw") throw new Error(backendMarker);
        if (failure === "error") {
          return { error: new Error(backendMarker), status: 0, stdout: validText };
        }
        if (failure === "nonzero") return { status: 73, stdout: validText };
        if (failure === "wrong digest") {
          return { status: 0, stdout: `${"00 ".repeat(32).trimEnd()}\n` };
        }
        return {
          status: 0,
          stdout: failure === "buffer output" ? Buffer.from(validText) : `${validText}\0`,
        };
      },
    );
    const shim = await writeShim(fixture, {
      nativeExecutable: backend.executable,
      runCapabilityProbe,
    });
    expect(runCapabilityProbe).toHaveBeenCalledTimes(3);
    expect(runCapabilityProbe.mock.calls).toStrictEqual([
      ...expectedNativeCapabilityCalls(backend.executable, 2),
      [
        "/usr/bin/od",
        ["-An", "-v", "-tx1"],
        {
          encoding: "utf8",
          input: converterCapabilityDigest,
          maxBuffer: 4_096,
          timeout: 2_000,
        },
      ],
    ]);

    await expectRejectedCapabilityFallback(fixture, backend, shim);
  });

  it.each([
    "nonzero",
    "valid-digest-nonzero",
    "short-digest",
    "long-digest",
    "extra-nul",
    "text-hex",
    "multiline-hex",
    "empty-output",
    "prefix",
    "suffix",
  ] as const)(
    "silently falls back for runtime native %s without publishing partial output",
    async (mode) => {
      const fixture = await createFixture();
      const path = join(fixture.directory, "payload");
      const changedContent = "changed after native read; fallback must rehash\0\r\n";
      // A complete correct digest plus nonzero exit otherwise looks identical to
      // fallback output. Changing the file proves fallback actually read it anew.
      const backend = await createBackend(
        fixture,
        "valid-binary",
        mode === "valid-digest-nonzero"
          ? { path, content: changedContent }
          : undefined,
      );
      const shim = await writeShim(fixture, { nativeExecutable: backend.executable });
      expect(await readInvocations(backend.logPath)).toHaveLength(2);
      await backend.setMode(mode);
      const originalContent = "fresh runtime fallback\0\r\n";
      await writeFile(path, originalContent);

      expectDigest(
        shim,
        path,
        mode === "valid-digest-nonzero" ? changedContent : originalContent,
        fixture.directory,
      );

      const invocations = await readInvocations(backend.logPath);
      expect(invocations).toHaveLength(3);
      expect(invocations[2]?.inputBase64).toBe(Buffer.from(originalContent).toString("base64"));
    },
  );

  it("uses Node for a relative regular file even after a native backend was accepted", async () => {
    const fixture = await createFixture();
    const backend = await createBackend(fixture, "valid-binary");
    const shim = await writeShim(fixture, { nativeExecutable: backend.executable });
    await writeFile(join(fixture.directory, "relative-file"), "relative bytes");

    expectDigest(shim, "relative-file", "relative bytes", fixture.directory);

    expect(await readInvocations(backend.logPath)).toHaveLength(2);
  });

  it.each(["missing", "directory", "dangling symlink"])(
    "does not invoke an accepted native backend for a %s",
    async (kind) => {
      const fixture = await createFixture();
      const backend = await createBackend(fixture, "valid-binary");
      const shim = await writeShim(fixture, { nativeExecutable: backend.executable });
      const path = join(fixture.directory, "invalid-target");
      if (kind === "directory") await mkdir(path);
      if (kind === "dangling symlink") await symlink("missing-target", path);

      const result = execute(shim, ["--", path], fixture.directory);

      expect(result.code).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(await readInvocations(backend.logPath)).toHaveLength(2);
    },
  );

  it("uses native stdin for a symlink to a regular file without changing the reported pathname", async () => {
    const fixture = await createFixture();
    const backend = await createBackend(fixture, "valid-binary");
    const shim = await writeShim(fixture, { nativeExecutable: backend.executable });
    const path = join(fixture.directory, "symbolic-link");
    await writeFile(join(fixture.directory, "target"), "target bytes\0");
    await symlink("target", path);

    expectDigest(shim, path, "target bytes\0", fixture.directory);

    expect((await readInvocations(backend.logPath))[2]).toEqual({
      args: ["dgst", "-sha256", "-binary"],
      inputBase64: Buffer.from("target bytes\0").toString("base64"),
    });
  });
});
