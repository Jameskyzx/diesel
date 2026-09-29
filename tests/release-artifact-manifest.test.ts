import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const artifactManifestScript = resolve(
  process.cwd(),
  "scripts/deploy/release-artifact-manifest.mjs",
);
const artifactCheckReadyHarness = `
import { checkReadyMarkerForTesting } from ${JSON.stringify(
  pathToFileURL(artifactManifestScript).href,
)};
const [commit, markerPath, readyPath, immutableUid, immutableGid, runtimeUid, runtimeGid] = process.argv.slice(1);
const result = await checkReadyMarkerForTesting(
  commit,
  markerPath,
  readyPath,
  {
    immutable: { gid: BigInt(immutableGid), uid: BigInt(immutableUid) },
    runtime: { gid: BigInt(runtimeGid), uid: BigInt(runtimeUid) },
  },
);
process.stdout.write(\`${"${result.artifactDigest}"}\\n\`);
`;
const TEST_RELEASE_SHA = "a".repeat(40);
const TEST_PACKAGE_JSON = '{"name":"artifact-fixture"}\n';
const TEST_NGINX_CONFIG = "server { listen 443 ssl; }\n";
const TEST_ECOSYSTEM_CONFIG = "module.exports = { apps: [] };\n";
const temporaryRoots: string[] = [];

type ArtifactFixture = {
  buildIdPath: string;
  markerPath: string;
  nextFilePath: string;
  nodeFilePath: string;
  readyPath: string;
  root: string;
};

type ArtifactMarker = {
  artifactDigest: string;
  format: string;
  inputDigest: string;
  nextBuildId: string;
  releaseCommit: string;
  roots: Array<{
    digest: string;
    directories: number;
    files: number;
    path: string;
    symlinks: number;
    totalBytes: number;
  }>;
};

type CommandFailure = Error & {
  code?: unknown;
  stderr?: unknown;
  stdout?: unknown;
};

type ActivationIdentityArguments = [string, string, string, string];

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function encodeLength(value: number): Buffer {
  const encoded = Buffer.alloc(8);
  encoded.writeBigUInt64BE(BigInt(value));
  return encoded;
}

function computeInputDigest(
  commit: string,
  files: Array<{ mode: string; path: string; sha256: string; size: number }>,
): string {
  const hash = createHash("sha256");
  hash.update("diesel-release-input-v2\0", "utf8");
  hash.update(commit, "utf8");
  for (const file of files) {
    for (const value of [file.path, file.mode]) {
      const bytes = Buffer.from(value, "utf8");
      hash.update(encodeLength(bytes.byteLength));
      hash.update(bytes);
    }
    hash.update(encodeLength(file.size));
    hash.update(Buffer.from(file.sha256, "hex"));
  }
  return hash.digest("hex");
}

const TEST_INPUT_FILES = [
  {
    mode: "100644",
    path: "deploy/nginx/jamesky.site.conf",
    sha256: sha256(TEST_NGINX_CONFIG),
    size: Buffer.byteLength(TEST_NGINX_CONFIG),
  },
  {
    mode: "100644",
    path: "ecosystem.config.cjs",
    sha256: sha256(TEST_ECOSYSTEM_CONFIG),
    size: Buffer.byteLength(TEST_ECOSYSTEM_CONFIG),
  },
  {
    mode: "100644",
    path: "package.json",
    sha256: sha256(TEST_PACKAGE_JSON),
    size: Buffer.byteLength(TEST_PACKAGE_JSON),
  },
];
const TEST_INPUT_DIGEST = computeInputDigest(
  TEST_RELEASE_SHA,
  TEST_INPUT_FILES,
);

async function createArtifactFixture(): Promise<ArtifactFixture> {
  const deployRoot = await mkdtemp(
    join(tmpdir(), "diesel-release-artifacts-"),
  );
  temporaryRoots.push(deployRoot);
  const root = join(deployRoot, "releases", TEST_RELEASE_SHA);
  const cachePath = join(root, ".next", "cache");
  const serverPath = join(root, ".next", "server");
  const packagePath = join(root, "node_modules", "pkg");
  const sharedDataPath = join(deployRoot, "shared", ".data");
  await Promise.all([
    mkdir(cachePath, { recursive: true }),
    mkdir(serverPath, { recursive: true }),
    mkdir(packagePath, { recursive: true }),
    mkdir(join(root, "deploy", "nginx"), { recursive: true }),
    mkdir(sharedDataPath, { recursive: true }),
  ]);

  const buildIdPath = join(root, ".next", "BUILD_ID");
  const nextFilePath = join(serverPath, "app.js");
  const nodeFilePath = join(packagePath, "index.js");
  const markerPath = join(root, ".build-complete");
  const readyPath = join(root, ".deploy-ready");
  const inputPath = join(root, ".release-input-manifest.json");
  await Promise.all([
    writeFile(buildIdPath, "next-build-1\n", "utf8"),
    writeFile(nextFilePath, "server artifact A\n", "utf8"),
    writeFile(nodeFilePath, "module artifact A\n", "utf8"),
    writeFile(join(cachePath, "mutable.bin"), "cache v1\n", "utf8"),
    writeFile(markerPath, "", "utf8"),
    writeFile(join(root, "package.json"), TEST_PACKAGE_JSON, "utf8"),
    writeFile(
      join(root, "deploy", "nginx", "jamesky.site.conf"),
      TEST_NGINX_CONFIG,
      "utf8",
    ),
    writeFile(
      join(root, "ecosystem.config.cjs"),
      TEST_ECOSYSTEM_CONFIG,
      "utf8",
    ),
    writeFile(
      join(deployRoot, "shared", ".env.production.local"),
      "DATABASE_URL=postgres://example.invalid/diesel\n",
      "utf8",
    ),
    writeFile(
      inputPath,
      `${JSON.stringify({
        commit: TEST_RELEASE_SHA,
        files: TEST_INPUT_FILES,
        format: "diesel-release-input-v2",
        inputDigest: TEST_INPUT_DIGEST,
      }, null, 2)}\n`,
      "utf8",
    ),
  ]);
  await chmod(markerPath, 0o600);
  return {
    buildIdPath,
    markerPath,
    nextFilePath,
    nodeFilePath,
    readyPath,
    root,
  };
}

async function installRuntimeLinks(fixture: ArtifactFixture): Promise<void> {
  const deployRoot = resolve(fixture.root, "..", "..");
  await Promise.all([
    chmod(deployRoot, 0o755),
    chmod(join(deployRoot, "releases"), 0o755),
    chmod(fixture.root, 0o750),
    chmod(join(fixture.root, "deploy"), 0o750),
    chmod(join(fixture.root, "deploy", "nginx"), 0o750),
    chmod(join(fixture.root, ".next"), 0o750),
    chmod(join(fixture.root, ".next", "cache"), 0o750),
    chmod(join(fixture.root, ".next", "server"), 0o750),
    chmod(join(fixture.root, "node_modules"), 0o750),
    chmod(join(fixture.root, "node_modules", "pkg"), 0o750),
    chmod(join(deployRoot, "shared"), 0o750),
    chmod(join(deployRoot, "shared", ".data"), 0o750),
    chmod(join(deployRoot, "shared", ".env.production.local"), 0o640),
    chmod(fixture.buildIdPath, 0o640),
    chmod(fixture.nextFilePath, 0o640),
    chmod(fixture.nodeFilePath, 0o640),
    chmod(join(fixture.root, "package.json"), 0o640),
    chmod(join(fixture.root, "deploy", "nginx", "jamesky.site.conf"), 0o640),
    chmod(join(fixture.root, "ecosystem.config.cjs"), 0o640),
    chmod(join(fixture.root, ".release-input-manifest.json"), 0o640),
    chmod(fixture.markerPath, 0o640),
    chmod(fixture.readyPath, 0o640),
  ]);
  await Promise.all([
    symlink(
      join(deployRoot, "shared", ".env.production.local"),
      join(fixture.root, ".env.production.local"),
    ),
    symlink(
      join(deployRoot, "shared", ".data"),
      join(fixture.root, ".data"),
    ),
  ]);
}

async function runArtifactCommand(
  fixture: ArtifactFixture,
  command: "check-ready" | "create" | "finalize" | "verify",
  commit = TEST_RELEASE_SHA,
  activationIdentity?: ActivationIdentityArguments,
): Promise<string> {
  const args = command === "check-ready"
    ? [
        "--input-type=module",
        "--eval",
        artifactCheckReadyHarness,
        commit,
        ".build-complete",
        ".deploy-ready",
      ]
    : [artifactManifestScript, command, commit, ".build-complete"];
  if (command === "finalize") args.push(".deploy-ready");
  if (command === "check-ready") {
    if (typeof process.getuid !== "function" || typeof process.getgid !== "function") {
      throw new Error("release artifact tests require Unix numeric identities");
    }
    const uid = String(process.getuid());
    const gid = String(process.getgid());
    args.push(...(activationIdentity ?? [uid, gid, uid, gid]));
  }
  const result = await execFileAsync(process.execPath, args, {
    cwd: fixture.root,
  });
  return String(result.stdout).trim();
}

async function runArtifactFailure(
  fixture: ArtifactFixture,
  command: "check-ready" | "create" | "finalize" | "verify",
  commit = TEST_RELEASE_SHA,
  activationIdentity?: ActivationIdentityArguments,
): Promise<CommandFailure> {
  const result = await runArtifactCommand(
    fixture,
    command,
    commit,
    activationIdentity,
  ).then(
    () => null,
    (error: unknown) => error,
  );
  expect(result).toMatchObject({ code: 1 });
  return result as CommandFailure;
}

async function readMarker(path: string): Promise<ArtifactMarker> {
  return JSON.parse(await readFile(path, "utf8")) as ArtifactMarker;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) =>
      rm(path, { force: true, recursive: true })
    ),
  );
});

describe("release artifact manifest", () => {
  it("does not silently skip validation when its CLI entry is a symlink", async () => {
    const fixture = await createArtifactFixture();
    const entryPath = join(fixture.root, "artifact-manifest-entry.mjs");
    await symlink(artifactManifestScript, entryPath);

    const result = await execFileAsync(process.execPath, [entryPath], {
      cwd: fixture.root,
    }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(result).toMatchObject({ code: 1 });
    expect(String((result as CommandFailure).stderr)).toContain(
      "Expected release commit",
    );
  });

  it("keeps the sequential hash buffer and recursive entry append allocation-bounded", async () => {
    const source = await readFile(artifactManifestScript, "utf8");

    expect(
      source.match(/Buffer\.allocUnsafe\(FILE_HASH_BUFFER_BYTES\)/gu),
    ).toHaveLength(1);
    expect(source).toContain("hashBuffer,");
    expect(source).toContain("await handle.read(\n        hashBuffer,");
    expect(source).not.toMatch(
      /entries\.push\(\s*\.\.\.await discoverEntries/gu,
    );
  });

  it("creates a deterministic compact marker and verifies the fixed roots", async () => {
    const fixture = await createArtifactFixture();
    const firstDigest = await runArtifactCommand(fixture, "create");
    const firstContents = await readFile(fixture.markerPath, "utf8");
    const marker = await readMarker(fixture.markerPath);

    expect(firstDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(firstDigest).toBe(marker.artifactDigest);
    expect(marker).toMatchObject({
      format: "diesel-build-complete-v2",
      inputDigest: TEST_INPUT_DIGEST,
      nextBuildId: "next-build-1",
      releaseCommit: TEST_RELEASE_SHA,
    });
    expect(marker.roots.map(({ path }) => path)).toEqual([
      ".next",
      "node_modules",
    ]);
    expect(marker.roots[0]).toMatchObject({
      directories: 2,
      files: 2,
      symlinks: 0,
    });
    expect(marker.roots[1]).toMatchObject({
      directories: 2,
      files: 1,
      symlinks: 0,
    });
    expect((await stat(fixture.markerPath)).mode & 0o777).toBe(0o600);
    await expect(runArtifactCommand(fixture, "verify")).resolves.toBe(
      firstDigest,
    );

    await writeFile(fixture.markerPath, "", "utf8");
    await runArtifactCommand(fixture, "create");
    await expect(readFile(fixture.markerPath, "utf8")).resolves.toBe(
      firstContents,
    );
  });

  it("detects a same-size content substitution", async () => {
    const fixture = await createArtifactFixture();
    await runArtifactCommand(fixture, "create");
    await writeFile(fixture.nextFilePath, "server artifact B\n", "utf8");

    const failure = await runArtifactFailure(fixture, "verify");
    expect(String(failure.stderr)).toContain("artifacts or bound release metadata drifted");
  });

  it.each([
    ["added", async (fixture: ArtifactFixture) => {
      await writeFile(join(fixture.root, ".next", "extra.js"), "extra\n", "utf8");
    }],
    ["deleted", async (fixture: ArtifactFixture) => {
      await rm(fixture.nodeFilePath);
    }],
  ])("detects an %s artifact path", async (_label, mutate) => {
    const fixture = await createArtifactFixture();
    await runArtifactCommand(fixture, "create");
    await mutate(fixture);

    await runArtifactFailure(fixture, "verify");
  });

  it("binds executable permission bits", async () => {
    const fixture = await createArtifactFixture();
    await runArtifactCommand(fixture, "create");
    await chmod(fixture.nodeFilePath, 0o640);
    await chmod(join(fixture.root, ".next", "server"), 0o750);
    await expect(runArtifactCommand(fixture, "verify")).resolves.toMatch(
      /^[0-9a-f]{64}$/u,
    );

    await chmod(fixture.nodeFilePath, 0o750);

    await runArtifactFailure(fixture, "verify");
  });

  it("accepts existing relative symlinks across the two immutable roots", async () => {
    const fixture = await createArtifactFixture();
    await symlink(
      "../../.next/server/app.js",
      join(fixture.root, "node_modules", "pkg", "built-app.js"),
    );
    await symlink(
      "../../node_modules/pkg/index.js",
      join(fixture.root, ".next", "server", "installed-package.js"),
    );

    const digest = await runArtifactCommand(fixture, "create");
    const marker = await readMarker(fixture.markerPath);
    expect(marker.roots.map(({ symlinks }) => symlinks)).toEqual([1, 1]);
    await expect(runArtifactCommand(fixture, "verify")).resolves.toBe(digest);
  });

  it.each([
    ["relative escape", "../../outside.txt"],
    ["dangling target", "missing.js"],
    ["absolute target", "/tmp"],
  ])("rejects a symlink with a %s", async (_label, target) => {
    const fixture = await createArtifactFixture();
    await writeFile(join(fixture.root, "outside.txt"), "outside\n", "utf8");
    await symlink(
      target,
      join(fixture.root, "node_modules", "pkg", "unsafe-link"),
    );

    const failure = await runArtifactFailure(fixture, "create");
    expect(String(failure.stderr)).toMatch(/symlink/u);
  });

  it("rejects a cyclic symlink chain", async () => {
    const fixture = await createArtifactFixture();
    await symlink("cycle-b", join(fixture.root, "node_modules", "cycle-a"));
    await symlink("cycle-a", join(fixture.root, "node_modules", "cycle-b"));

    const failure = await runArtifactFailure(fixture, "create");
    expect(String(failure.stderr)).toContain("dangling, cyclic, or escapes");
  });

  it("rejects hardlinked artifact files", async () => {
    const fixture = await createArtifactFixture();
    await link(
      fixture.nodeFilePath,
      join(fixture.root, "node_modules", "pkg", "hardlink.js"),
    );

    const failure = await runArtifactFailure(fixture, "create");
    expect(String(failure.stderr)).toContain("hardlink");
  });

  it("rejects special filesystem nodes", async () => {
    const fixture = await createArtifactFixture();
    await execFileAsync("mkfifo", [
      join(fixture.root, "node_modules", "pkg", "unsupported.pipe"),
    ]);

    const failure = await runArtifactFailure(fixture, "create");
    expect(String(failure.stderr)).toContain("special node");
  });

  it("ignores mutable cache contents while requiring cache to remain a real directory", async () => {
    const fixture = await createArtifactFixture();
    const cachePath = join(fixture.root, ".next", "cache");
    const digest = await runArtifactCommand(fixture, "create");
    await writeFile(join(cachePath, "mutable.bin"), "cache v2 changed\n", "utf8");
    await mkdir(join(cachePath, "nested"));
    await writeFile(join(cachePath, "nested", "new.bin"), "new cache\n", "utf8");

    await expect(runArtifactCommand(fixture, "verify")).resolves.toBe(digest);

    await rm(cachePath, { recursive: true });
    await symlink("../server", cachePath);
    const failure = await runArtifactFailure(fixture, "verify");
    expect(String(failure.stderr)).toContain("must be a real directory");
  });

  it.each([
    ["Next BUILD_ID", async (fixture: ArtifactFixture) => {
      await writeFile(fixture.buildIdPath, "next-build-2\n", "utf8");
    }],
    ["input digest", async (fixture: ArtifactFixture) => {
      const inputPath = join(fixture.root, ".release-input-manifest.json");
      const input = JSON.parse(await readFile(inputPath, "utf8")) as {
        inputDigest: string;
      } & Record<string, unknown>;
      input.inputDigest = "c".repeat(64);
      await writeFile(inputPath, `${JSON.stringify(input, null, 2)}\n`, "utf8");
    }],
  ])("detects %s metadata drift", async (_label, mutate) => {
    const fixture = await createArtifactFixture();
    await runArtifactCommand(fixture, "create");
    await mutate(fixture);

    await runArtifactFailure(fixture, "verify");
  });

  it("rejects an input entry that no longer matches inputDigest before create", async () => {
    const fixture = await createArtifactFixture();
    const inputPath = join(fixture.root, ".release-input-manifest.json");
    const input = JSON.parse(await readFile(inputPath, "utf8")) as {
      files: Array<{ sha256: string }>;
    } & Record<string, unknown>;
    const firstFile = input.files[0];
    if (!firstFile) throw new Error("fixture input file is missing");
    firstFile.sha256 = "d".repeat(64);
    await writeFile(inputPath, `${JSON.stringify(input, null, 2)}\n`, "utf8");

    const failure = await runArtifactFailure(fixture, "create");
    expect(String(failure.stderr)).toContain(
      "inputDigest does not match its entries",
    );
  });

  it("rejects commit drift and unexpected marker fields", async () => {
    const fixture = await createArtifactFixture();
    await runArtifactCommand(fixture, "create");
    await runArtifactFailure(fixture, "verify", "c".repeat(40));

    const marker = await readMarker(fixture.markerPath);
    await writeFile(
      fixture.markerPath,
      `${JSON.stringify({ ...marker, unexpected: true }, null, 2)}\n`,
      "utf8",
    );
    const failure = await runArtifactFailure(fixture, "verify");
    expect(String(failure.stderr)).toContain("unexpected field set");
  });

  it("finalizes once at mode 0640 and check-ready rehashes artifacts", async () => {
    const fixture = await createArtifactFixture();
    const digest = await runArtifactCommand(fixture, "create");
    await expect(runArtifactCommand(fixture, "finalize")).resolves.toBe(digest);
    expect((await stat(fixture.readyPath)).mode & 0o777).toBe(0o640);
    expect((await readMarker(fixture.readyPath)).format).toBe(
      "diesel-deploy-ready-v1",
    );
    const exclusiveFailure = await runArtifactFailure(fixture, "finalize");
    expect(String(exclusiveFailure.stderr)).toMatch(/exist|EEXIST/u);

    await installRuntimeLinks(fixture);
    await expect(runArtifactCommand(fixture, "check-ready")).resolves.toBe(
      digest,
    );
    await writeFile(fixture.nodeFilePath, "module artifact B\n", "utf8");
    const failure = await runArtifactFailure(fixture, "check-ready");
    expect(String(failure.stderr)).toContain(
      "artifacts or bound release metadata drifted",
    );
  });

  it.each([
    ["Nginx input", async (fixture: ArtifactFixture) => {
      await writeFile(
        join(fixture.root, "deploy", "nginx", "jamesky.site.conf"),
        "server { listen 80; }\n",
        "utf8",
      );
    }],
    ["ecosystem input", async (fixture: ArtifactFixture) => {
      await writeFile(
        join(fixture.root, "ecosystem.config.cjs"),
        "module.exports = { apps: [{ name: 'tampered' }] };\n",
        "utf8",
      );
    }],
    ["unexpected input path", async (fixture: ArtifactFixture) => {
      await writeFile(join(fixture.root, "untracked-runtime.js"), "unsafe\n", "utf8");
    }],
    ["unexpected empty input directory", async (fixture: ArtifactFixture) => {
      await mkdir(join(fixture.root, "untracked-empty-directory"));
    }],
    ["group-writable release directory", async (fixture: ArtifactFixture) => {
      await chmod(fixture.root, 0o770);
    }],
    ["group-writable releases directory", async (fixture: ArtifactFixture) => {
      await chmod(resolve(fixture.root, ".."), 0o777);
    }],
    ["group-writable deploy root", async (fixture: ArtifactFixture) => {
      await chmod(resolve(fixture.root, "..", ".."), 0o777);
    }],
    ["group-writable tracked input", async (fixture: ArtifactFixture) => {
      await chmod(join(fixture.root, "package.json"), 0o660);
    }],
    ["under-permissioned tracked input", async (fixture: ArtifactFixture) => {
      await chmod(join(fixture.root, "package.json"), 0o600);
    }],
    ["group-writable tracked input directory", async (fixture: ArtifactFixture) => {
      await chmod(join(fixture.root, "deploy"), 0o770);
    }],
    ["group-writable artifact", async (fixture: ArtifactFixture) => {
      await chmod(fixture.nodeFilePath, 0o660);
    }],
    ["under-permissioned artifact", async (fixture: ArtifactFixture) => {
      await chmod(fixture.nodeFilePath, 0o600);
    }],
    ["group-writable artifact directory", async (fixture: ArtifactFixture) => {
      await chmod(join(fixture.root, ".next", "server"), 0o770);
    }],
    ["group-writable input manifest", async (fixture: ArtifactFixture) => {
      await chmod(
        join(fixture.root, ".release-input-manifest.json"),
        0o660,
      );
    }],
    ["group-writable build marker", async (fixture: ArtifactFixture) => {
      await chmod(fixture.markerPath, 0o660);
    }],
    ["group-writable deploy-ready marker", async (fixture: ArtifactFixture) => {
      await chmod(fixture.readyPath, 0o660);
    }],
    ["environment runtime link", async (fixture: ArtifactFixture) => {
      const path = join(fixture.root, ".env.production.local");
      await rm(path);
      await symlink(join(fixture.root, "package.json"), path);
    }],
    ["symlinked shared runtime directory", async (fixture: ArtifactFixture) => {
      const deployRoot = resolve(fixture.root, "..", "..");
      const sharedPath = join(deployRoot, "shared");
      const externalPath = join(deployRoot, "external-shared");
      await rename(sharedPath, externalPath);
      await symlink(externalPath, sharedPath);
    }],
    ["hardlinked environment target", async (fixture: ArtifactFixture) => {
      const sharedPath = join(fixture.root, "..", "..", "shared");
      await link(
        join(sharedPath, ".env.production.local"),
        join(sharedPath, "environment-hardlink"),
      );
    }],
    ["world-writable environment target", async (fixture: ArtifactFixture) => {
      await chmod(
        join(fixture.root, "..", "..", "shared", ".env.production.local"),
        0o666,
      );
    }],
    ["data runtime link", async (fixture: ArtifactFixture) => {
      const path = join(fixture.root, ".data");
      await rm(path);
      await symlink(join(fixture.root, "deploy"), path);
    }],
    ["group-writable data target", async (fixture: ArtifactFixture) => {
      await chmod(
        join(fixture.root, "..", "..", "shared", ".data"),
        0o770,
      );
    }],
  ])("rejects post-finalize %s drift", async (_label, mutate) => {
    const fixture = await createArtifactFixture();
    await runArtifactCommand(fixture, "create");
    await runArtifactCommand(fixture, "finalize");
    await installRuntimeLinks(fixture);
    await mutate(fixture);

    await runArtifactFailure(fixture, "check-ready");
  });

  it("allows content and directory-count changes inside mutable data", async () => {
    const fixture = await createArtifactFixture();
    await runArtifactCommand(fixture, "create");
    await runArtifactCommand(fixture, "finalize");
    await installRuntimeLinks(fixture);
    const dataPath = join(fixture.root, "..", "..", "shared", ".data");

    await mkdir(join(dataPath, "runtime-write"));
    await writeFile(
      join(dataPath, "runtime-write", "state.json"),
      "{\"ok\":true}\n",
      "utf8",
    );

    await expect(runArtifactCommand(fixture, "check-ready")).resolves.toMatch(
      /^[0-9a-f]{64}$/u,
    );
  });

  it("keeps the production check-ready CLI on the strict root/runtime profile", async () => {
    if (
      typeof process.getuid !== "function" ||
      typeof process.getgid !== "function"
    ) {
      throw new Error("release artifact tests require Unix numeric identities");
    }
    const fixture = await createArtifactFixture();
    await runArtifactCommand(fixture, "create");
    await runArtifactCommand(fixture, "finalize");
    await installRuntimeLinks(fixture);
    const uid = String(process.getuid());
    const gid = String(process.getgid());
    const result = await execFileAsync(process.execPath, [
      artifactManifestScript,
      "check-ready",
      TEST_RELEASE_SHA,
      ".build-complete",
      ".deploy-ready",
      uid,
      gid,
      uid,
      gid,
    ], { cwd: fixture.root }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(result).toMatchObject({ code: 1 });
    expect(String((result as CommandFailure).stderr)).toMatch(
      /root controller identity|distinct non-root runtime identity/u,
    );
  });

  it.each(["immutable", "runtime"] as const)(
    "fails closed when the declared %s identity does not own its boundary",
    async (identityKind) => {
      if (
        typeof process.getuid !== "function" ||
        typeof process.getgid !== "function"
      ) {
        throw new Error("release artifact tests require Unix numeric identities");
      }
      const fixture = await createArtifactFixture();
      await runArtifactCommand(fixture, "create");
      await runArtifactCommand(fixture, "finalize");
      await installRuntimeLinks(fixture);
      const uid = String(process.getuid());
      const gid = String(process.getgid());
      const wrongId = String((Number(gid) + 1) % 0xffffffff);
      const identity: ActivationIdentityArguments = identityKind === "immutable"
        ? [uid, wrongId, uid, gid]
        : [uid, gid, uid, wrongId];

      const failure = await runArtifactFailure(
        fixture,
        "check-ready",
        TEST_RELEASE_SHA,
        identity,
      );
      expect(String(failure.stderr)).toMatch(/owner|group/u);
    },
  );
});
