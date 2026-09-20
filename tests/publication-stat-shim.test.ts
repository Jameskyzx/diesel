import { spawnSync } from "node:child_process";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createPublicationStatShim } from "./helpers/publication-stat-shim";

const directories: string[] = [];

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

async function createFixture() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "diesel-publication-stat-")),
  );
  directories.push(root);
  const releaseRoot = join(root, "releases ' [literal]");
  const sharedRoot = join(root, "shared $HOME");
  const faultRoot = join(root, "faults `touch injected`");
  await Promise.all([releaseRoot, sharedRoot, faultRoot].map((path) => mkdir(path)));
  return { root, releaseRoot, sharedRoot, faultRoot };
}

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function writeExecutable(path: string, source: string): Promise<void> {
  await writeFile(path, source);
  await chmod(path, 0o755);
}

async function writeShim(fixture: Fixture, statExecutable?: string): Promise<string> {
  const shim = join(fixture.root, "stat-shim");
  await writeExecutable(shim, createPublicationStatShim({
    releaseRoot: fixture.releaseRoot,
    sharedRoot: fixture.sharedRoot,
    faultRoot: fixture.faultRoot,
    ...(statExecutable === undefined ? {} : { statExecutable }),
  }));
  return shim;
}

function execute(shim: string, format: string, path: string, cwd: string) {
  const result = spawnSync(shim, ["-c", format, "--", path], {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024,
    timeout: 5_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

async function expectHostProjection(
  fixture: Fixture,
  shim: string,
  path: string,
  owner = "root:root",
): Promise<void> {
  const metadata = await lstat(path);
  const mode = (metadata.mode & 0o7777).toString(8);
  for (const [format, value] of [
    ["%U:%G:%a", `${owner}:${mode}`],
    ["%s", String(metadata.size)],
    ["%h", String(metadata.nlink)],
    ["%a", mode],
  ]) {
    expect(execute(shim, format, path, fixture.root)).toEqual({
      code: 0,
      stdout: `${value}\n`,
      stderr: "",
    });
  }
}

async function createBackend(
  fixture: Fixture,
  path: string,
  options: { dialect: "gnu" | "bsd"; output?: string; status?: number },
) {
  const executable = join(fixture.root, "fake stat ' $(touch injected)");
  const logPath = join(fixture.root, "stat-invocations.jsonl");
  await writeFile(logPath, "");
  const source = `
const fs = require("node:fs");
const args = process.argv.slice(1);
fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(args) + "\\n");
const gnu = ["-c", "%a:%h:%s", "--", ${JSON.stringify(path)}];
const bsd = ["-f", "%OMp%03OLp:%l:%z", "--", ${JSON.stringify(path)}];
const isGnu = JSON.stringify(args) === JSON.stringify(gnu);
const isBsd = JSON.stringify(args) === JSON.stringify(bsd);
if (!isGnu && !isBsd) process.exit(91);
if (${JSON.stringify(options.dialect)} === "bsd" && isGnu) {
  process.stdout.write("rejected GNU output must be discarded\\n");
  process.stderr.write("unsupported GNU option\\n");
  process.exit(1);
}
if (${JSON.stringify(options.dialect)} === "gnu" && isBsd && ${options.status ?? 0} === 0) process.exit(92);
process.stdout.write(${JSON.stringify(options.output ?? "4750:2:17\n")});
process.exit(${options.status ?? 0});
`;
  await writeExecutable(
    executable,
    `#!/bin/bash\nexec ${shellQuote(process.execPath)} -e ${shellQuote(source)} -- "$@"\n`,
  );
  return { executable, logPath };
}

async function readInvocations(logPath: string): Promise<string[][]> {
  const text = await readFile(logPath, "utf8");
  if (text === "") return [];
  return text.trimEnd().split("\n").map((line) => {
    const value: unknown = JSON.parse(line);
    if (!Array.isArray(value) || !value.every((item: unknown) => typeof item === "string")) {
      throw new Error("Invalid stat fixture invocation record.");
    }
    return value as string[];
  });
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ));
});

describe("publication stat fixture preserves host lstat semantics", () => {
  it.each([
    { kind: "file", mode: 0o640 },
    { kind: "no-access file", mode: 0o000 },
    { kind: "setuid file", mode: 0o4750 },
    { kind: "setgid file", mode: 0o2770 },
    { kind: "combined special-bit file", mode: 0o7777 },
    { kind: "sticky directory", mode: 0o1777 },
  ])("preserves full permission bits for a $kind", async ({ kind, mode }) => {
    const fixture = await createFixture();
    const shim = await writeShim(fixture);
    const path = join(fixture.root, "target");
    if (kind === "sticky directory") await mkdir(path);
    else await writeFile(path, "binary\0payload\r\n");
    await chmod(path, mode);
    expect((await lstat(path)).mode & 0o7777).toBe(mode);

    await expectHostProjection(fixture, shim, path);
  });

  it.each(["symlink", "dangling symlink"])(
    "reports the %s itself rather than following its target",
    async (kind) => {
      const fixture = await createFixture();
      const shim = await writeShim(fixture);
      const path = join(fixture.root, "symbolic-link");
      const target = join(fixture.root, "target");
      if (kind === "symlink") {
        await writeFile(target, Buffer.alloc(1_234, 0xff));
        await chmod(target, 0o600);
      }
      await symlink("target", path);
      expect((await lstat(path)).isSymbolicLink()).toBe(true);

      await expectHostProjection(fixture, shim, path);
    },
  );

  it("refreshes hard-link counts, permissions, and bytes after every mutation", async () => {
    const fixture = await createFixture();
    const shim = await writeShim(fixture);
    const path = join(fixture.root, "original");
    const alias = join(fixture.root, "hard-link");
    await writeFile(path, "short");
    await expectHostProjection(fixture, shim, path);
    await link(path, alias);
    expect((await lstat(path)).nlink).toBe(2);
    await expectHostProjection(fixture, shim, path);
    await writeFile(alias, "longer replacement bytes\0");
    await chmod(alias, 0o4750);
    await expectHostProjection(fixture, shim, path);
    await expectHostProjection(fixture, shim, alias);
    await rm(alias);
    expect((await lstat(path)).nlink).toBe(1);
    await expectHostProjection(fixture, shim, path);
  });

  it("does not cache a pathname after deletion and recreation", async () => {
    const fixture = await createFixture();
    const shim = await writeShim(fixture);
    const path = join(fixture.root, "recreated");
    await writeFile(path, "before");
    await chmod(path, 0o600);
    await expectHostProjection(fixture, shim, path);
    await rm(path);
    const missing = execute(shim, "%s", path, fixture.root);
    expect(missing.code).not.toBe(0);
    expect(missing.stdout).toBe("");
    await writeFile(path, "after deletion and recreation");
    await chmod(path, 0o2750);
    await expectHostProjection(fixture, shim, path);
  });

  it.each([
    "quoted ' $HOME ; $(touch injected) `touch injected`",
    "中文🙂",
    "trailing newline\n",
    "back\\slash\ttab",
  ])("treats the unusual pathname %j literally", async (name) => {
    const fixture = await createFixture();
    const shim = await writeShim(fixture);
    const path = join(fixture.root, name);
    await writeFile(path, "literal file");

    await expectHostProjection(fixture, shim, path);

    await expect(lstat(join(fixture.root, "injected"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("does not emit a successful projection for a missing path", async () => {
    const fixture = await createFixture();
    const shim = await writeShim(fixture);

    const result = execute(shim, "%U:%G:%a", join(fixture.root, "missing"), fixture.root);

    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
  });
});

describe("publication stat fixture owner, faults, and format compatibility", () => {
  it.each([
    { location: "release root", owner: "root:root" },
    { location: "release child", owner: "root:diesel" },
    { location: "shared root", owner: "root:diesel" },
    { location: "shared child", owner: "root:diesel" },
    { location: "release prefix sibling", owner: "root:root" },
    { location: "shared prefix sibling", owner: "root:root" },
    { location: "unrelated", owner: "root:root" },
  ])("keeps the existing owner projection for $location", async ({ location, owner }) => {
    const fixture = await createFixture();
    const shim = await writeShim(fixture);
    const paths: Record<string, string> = {
      "release root": fixture.releaseRoot,
      "release child": join(fixture.releaseRoot, "child"),
      "shared root": fixture.sharedRoot,
      "shared child": join(fixture.sharedRoot, "child"),
      "release prefix sibling": `${fixture.releaseRoot}-sibling`,
      "shared prefix sibling": `${fixture.sharedRoot}-sibling`,
      unrelated: join(fixture.root, "other"),
    };
    const path = paths[location];
    if (location !== "release root" && location !== "shared root") {
      await writeFile(path, "owner fixture");
    }

    await expectHostProjection(fixture, shim, path, owner);
  });

  it.each(["owner", "mode", "both"])(
    "applies and removes the %s fault flags without changing other fields",
    async (fault) => {
      const fixture = await createFixture();
      const shim = await writeShim(fixture);
      const path = join(fixture.sharedRoot, "marker");
      await writeFile(path, "marker contents");
      await chmod(path, 0o4750);
      const flags = [
        ...(fault === "owner" || fault === "both" ? ["bad-marker-owner"] : []),
        ...(fault === "mode" || fault === "both" ? ["bad-marker-mode"] : []),
      ];
      await expectHostProjection(fixture, shim, path, "root:diesel");
      for (const flag of flags) await writeFile(join(fixture.faultRoot, flag), "");
      const owner = fault === "mode" ? "root:diesel" : "diesel:diesel";
      const mode = fault === "owner" ? "4750" : "640";
      expect(execute(shim, "%U:%G:%a", path, fixture.root)).toMatchObject({
        code: 0,
        stdout: `${owner}:${mode}\n`,
      });
      expect(execute(shim, "%a", path, fixture.root)).toMatchObject({ code: 0, stdout: `${mode}\n` });
      expect(execute(shim, "%s", path, fixture.root)).toMatchObject({ code: 0, stdout: `${(await lstat(path)).size}\n` });
      expect(execute(shim, "%h", path, fixture.root)).toMatchObject({ code: 0, stdout: `${(await lstat(path)).nlink}\n` });
      for (const flag of flags) await rm(join(fixture.faultRoot, flag));
      await expectHostProjection(fixture, shim, path, "root:diesel");
    },
  );

  it.each([
    { format: "prefix:%U:%G:%a:%s:%h:suffix", field: "owner" },
    { format: "%h:%s:%a", field: "size" },
    { format: "%a:%h", field: "links" },
    { format: "prefix:%a:suffix", field: "mode" },
  ])("preserves wildcard format precedence for $format", async ({ format, field }) => {
    const fixture = await createFixture();
    const shim = await writeShim(fixture);
    const path = join(fixture.sharedRoot, "file");
    await writeFile(path, "format fixture");
    await chmod(path, 0o4750);
    const metadata = await lstat(path);
    const expected: Record<string, string> = {
      owner: "root:diesel:4750",
      size: String(metadata.size),
      links: String(metadata.nlink),
      mode: "4750",
    };

    expect(execute(shim, format, path, fixture.root)).toEqual({
      code: 0,
      stdout: `${expected[field]}\n`,
      stderr: "",
    });
  });

  it("retains exit 64 for an unsupported format", async () => {
    const fixture = await createFixture();
    const shim = await writeShim(fixture);
    const path = join(fixture.root, "file");
    await writeFile(path, "fixture");

    expect(execute(shim, "%n", path, fixture.root)).toMatchObject({ code: 64, stdout: "" });
  });
});

describe("publication stat fixture tuple query contract", () => {
  it.each(["gnu", "bsd"] as const)(
    "uses one %s tuple result for each requested projection",
    async (dialect) => {
      const fixture = await createFixture();
      const path = join(fixture.sharedRoot, "file ' $(touch injected)");
      await writeFile(path, "fixture");
      const backend = await createBackend(fixture, path, { dialect });
      const shim = await writeShim(fixture, backend.executable);
      const expectedInvocations: string[][] = [];
      for (const [format, result] of [
        ["%U:%G:%a", "root:diesel:4750"],
        ["%s", "17"],
        ["%h", "2"],
        ["%a", "4750"],
      ]) {
        expect(execute(shim, format, path, fixture.root)).toEqual({
          code: 0,
          stdout: `${result}\n`,
          stderr: "",
        });
        expectedInvocations.push(["-c", "%a:%h:%s", "--", path]);
        if (dialect === "bsd") {
          expectedInvocations.push(["-f", "%OMp%03OLp:%l:%z", "--", path]);
        }
        expect(await readInvocations(backend.logPath)).toEqual(expectedInvocations);
      }
      await expect(lstat(join(fixture.root, "injected"))).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it.each([
    "",
    "644:1\n",
    "644:1:2:3\n",
    "888:1:2\n",
    "10000:1:2\n",
    "644:-1:2\n",
    "644:1:-2\n",
    "644:1:3\n644:1:3\n",
  ])("fails with exit 65 for malformed tuple %j", async (output) => {
    const fixture = await createFixture();
    const path = join(fixture.root, "file");
    await writeFile(path, "fixture");
    const backend = await createBackend(fixture, path, { dialect: "gnu", output });
    const shim = await writeShim(fixture, backend.executable);

    expect(execute(shim, "%s", path, fixture.root)).toMatchObject({ code: 65, stdout: "" });
    expect(await readInvocations(backend.logPath)).toEqual([
      ["-c", "%a:%h:%s", "--", path],
    ]);
  });

  it("does not accept valid-looking tuple output when both native attempts exit nonzero", async () => {
    const fixture = await createFixture();
    const path = join(fixture.root, "file");
    await writeFile(path, "fixture");
    const backend = await createBackend(fixture, path, { dialect: "gnu", status: 73 });
    const shim = await writeShim(fixture, backend.executable);

    const result = execute(shim, "%U:%G:%a", path, fixture.root);

    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(await readInvocations(backend.logPath)).toEqual([
      ["-c", "%a:%h:%s", "--", path],
      ["-f", "%OMp%03OLp:%l:%z", "--", path],
    ]);
  });
});
