import { execFile } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const manifestScript = resolve(
  process.cwd(),
  "scripts/deploy/release-input-manifest.mjs",
);
const temporaryRoots: string[] = [];

type ReleaseFixture = {
  buildRoot: string;
  commit: string;
  manifestPath: string;
  sourceRoot: string;
};

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_EMAIL: "release-manifest@example.invalid",
      GIT_AUTHOR_NAME: "Release Manifest Test",
      GIT_COMMITTER_EMAIL: "release-manifest@example.invalid",
      GIT_COMMITTER_NAME: "Release Manifest Test",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  return String(result.stdout).trim();
}

async function createReleaseFixture(): Promise<ReleaseFixture> {
  const sourceRoot = await mkdtemp(join(tmpdir(), "diesel-release-source-"));
  const buildRoot = await mkdtemp(join(tmpdir(), "diesel-release-build-"));
  temporaryRoots.push(sourceRoot, buildRoot);
  await mkdir(join(sourceRoot, "scripts", "deploy"), { recursive: true });
  await Promise.all([
    copyFile(
      manifestScript,
      join(sourceRoot, "scripts", "deploy", "release-input-manifest.mjs"),
    ),
    writeFile(
      join(sourceRoot, "package.json"),
      '{"name":"release-manifest-fixture","private":true}\n',
      "utf8",
    ),
    writeFile(join(sourceRoot, "README.md"), "tracked release input\n", "utf8"),
    writeFile(
      join(sourceRoot, "scripts", "deploy", "executable-check.sh"),
      "#!/usr/bin/env bash\nexit 0\n",
      "utf8",
    ),
  ]);
  await chmod(
    join(sourceRoot, "scripts", "deploy", "executable-check.sh"),
    0o755,
  );
  await git(sourceRoot, ["init", "--quiet"]);
  await git(sourceRoot, ["add", "--all"]);
  await git(sourceRoot, ["commit", "--quiet", "-m", "release fixture"]);
  const commit = await git(sourceRoot, ["rev-parse", "HEAD"]);
  const manifestPath = join(sourceRoot, ".release-input-manifest.json");
  await execFileAsync(
    process.execPath,
    [manifestScript, "create", commit, manifestPath],
    { cwd: sourceRoot },
  );

  await mkdir(join(buildRoot, "scripts", "deploy"), { recursive: true });
  await Promise.all([
    copyFile(
      join(sourceRoot, "scripts", "deploy", "release-input-manifest.mjs"),
      join(buildRoot, "scripts", "deploy", "release-input-manifest.mjs"),
    ),
    copyFile(
      join(sourceRoot, "scripts", "deploy", "executable-check.sh"),
      join(buildRoot, "scripts", "deploy", "executable-check.sh"),
    ),
    copyFile(join(sourceRoot, "package.json"), join(buildRoot, "package.json")),
    copyFile(join(sourceRoot, "README.md"), join(buildRoot, "README.md")),
    copyFile(manifestPath, join(buildRoot, ".release-input-manifest.json")),
    mkdir(join(buildRoot, "node_modules")),
    mkdir(join(buildRoot, ".next")),
    writeFile(join(buildRoot, ".build-complete"), "", "utf8"),
  ]);

  return { buildRoot, commit, manifestPath, sourceRoot };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) =>
      rm(path, { force: true, recursive: true })
    ),
  );
});

describe("release input manifest", () => {
  it("deterministically binds a clean commit to the exact build inputs", async () => {
    const fixture = await createReleaseFixture();
    const secondManifestPath = join(
      fixture.sourceRoot,
      ".release-input-manifest-second.json",
    );
    await execFileAsync(
      process.execPath,
      [manifestScript, "create", fixture.commit, secondManifestPath],
      { cwd: fixture.sourceRoot },
    );

    await expect(
      readFile(secondManifestPath, "utf8"),
    ).resolves.toBe(await readFile(fixture.manifestPath, "utf8"));

    const result = await execFileAsync(
      process.execPath,
      [
        join("scripts", "deploy", "release-input-manifest.mjs"),
        "verify",
        fixture.commit,
        ".release-input-manifest.json",
      ],
      { cwd: fixture.buildRoot },
    );
    const manifest = JSON.parse(
      await readFile(fixture.manifestPath, "utf8"),
    ) as {
      files: Array<{ mode: string; path: string }>;
      format: string;
      inputDigest: string;
    };
    expect(manifest.format).toBe("diesel-release-input-v2");
    expect(manifest.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mode: "100644", path: "README.md" }),
        expect.objectContaining({
          mode: "100755",
          path: "scripts/deploy/executable-check.sh",
        }),
      ]),
    );
    expect(String(result.stdout).trim()).toBe(manifest.inputDigest);
  });

  it.each([
    {
      mode: 0o755,
      path: "README.md",
      transition: "100644 to 100755",
    },
    {
      mode: 0o644,
      path: "scripts/deploy/executable-check.sh",
      transition: "100755 to 100644",
    },
  ])("fails closed when a tracked mode drifts from $transition", async ({
    mode,
    path,
  }) => {
    const fixture = await createReleaseFixture();
    await chmod(join(fixture.buildRoot, ...path.split("/")), mode);

    const result = await execFileAsync(
      process.execPath,
      [
        join("scripts", "deploy", "release-input-manifest.mjs"),
        "verify",
        fixture.commit,
        ".release-input-manifest.json",
      ],
      { cwd: fixture.buildRoot },
    ).catch((error: unknown) => error);

    expect(result).toMatchObject({ code: 1 });
    expect(String((result as { stderr?: unknown }).stderr)).toContain(
      `Build input mode drifted from the release manifest: ${path}`,
    );
  });

  it("binds each Git mode into the manifest input digest", async () => {
    const fixture = await createReleaseFixture();
    const manifest = JSON.parse(
      await readFile(fixture.manifestPath, "utf8"),
    ) as {
      files: Array<{ mode: "100644" | "100755"; path: string }>;
    };
    const readme = manifest.files.find(({ path }) => path === "README.md");
    expect(readme?.mode).toBe("100644");
    if (!readme) throw new Error("README.md is missing from the fixture manifest");
    readme.mode = "100755";
    await writeFile(
      join(fixture.buildRoot, ".release-input-manifest.json"),
      `${JSON.stringify(manifest)}\n`,
      "utf8",
    );

    const result = await execFileAsync(
      process.execPath,
      [
        join("scripts", "deploy", "release-input-manifest.mjs"),
        "verify",
        fixture.commit,
        ".release-input-manifest.json",
      ],
      { cwd: fixture.buildRoot },
    ).catch((error: unknown) => error);

    expect(result).toMatchObject({ code: 1 });
    expect(String((result as { stderr?: unknown }).stderr)).toContain(
      "manifest digest does not match its entries",
    );
  });

  it.each(["README\n.md", "README\u007f.md"])(
    "rejects a manifest path containing control characters",
    async (unsafePath) => {
      const fixture = await createReleaseFixture();
      const manifest = JSON.parse(
        await readFile(fixture.manifestPath, "utf8"),
      ) as { files: Array<{ path: string }> };
      manifest.files[0]!.path = unsafePath;
      await writeFile(
        join(fixture.buildRoot, ".release-input-manifest.json"),
        `${JSON.stringify(manifest)}\n`,
        "utf8",
      );

      const result = await execFileAsync(
        process.execPath,
        [
          join("scripts", "deploy", "release-input-manifest.mjs"),
          "verify",
          fixture.commit,
          ".release-input-manifest.json",
        ],
        { cwd: fixture.buildRoot },
      ).catch((error: unknown) => error);

      expect(result).toMatchObject({ code: 1 });
      expect(String((result as { stderr?: unknown }).stderr)).toContain(
        "has an unsafe path",
      );
    },
  );

  it("recognizes generated release control files during verification", async () => {
    const fixture = await createReleaseFixture();
    await writeFile(join(fixture.buildRoot, ".deploy-ready"), "ready\n", "utf8");

    await expect(
      execFileAsync(
        process.execPath,
        [
          join("scripts", "deploy", "release-input-manifest.mjs"),
          "verify",
          fixture.commit,
          ".release-input-manifest.json",
        ],
        { cwd: fixture.buildRoot },
      ),
    ).resolves.toMatchObject({ stderr: "" });
  });

  it("rejects a tracked reserved .deploy-ready control file", async () => {
    const fixture = await createReleaseFixture();
    const reservedName = ".deploy-ready";
    await writeFile(join(fixture.sourceRoot, reservedName), "reserved\n", "utf8");
    await git(fixture.sourceRoot, ["add", "--", reservedName]);
    await git(fixture.sourceRoot, [
      "commit",
      "--quiet",
      "-m",
      `track ${reservedName}`,
    ]);
    const commit = await git(fixture.sourceRoot, ["rev-parse", "HEAD"]);

    const result = await execFileAsync(
      process.execPath,
      [
        manifestScript,
        "create",
        commit,
        join(fixture.sourceRoot, `${reservedName}.output.json`),
      ],
      { cwd: fixture.sourceRoot },
    ).catch((error: unknown) => error);

    expect(result).toMatchObject({ code: 1 });
    expect(String((result as { stderr?: unknown }).stderr)).toContain(
      `unsafe or reserved path: ${reservedName}`,
    );
  });

  it.each([
    ".env.local",
    ".env.production.local",
    ".env.example/private.key",
    ".data/secret.json",
    ".next/BUILD_ID",
    ".next-e2e/result.json",
    ".pnpm-store/index.json",
    "backups/database.dump",
    "coverage/report.json",
    "node_modules/package/index.js",
    "out/index.html",
    "playwright-report/index.html",
    "test-results/result.json",
    "tmp/upload.bin",
  ])("rejects a tracked forbidden release root before export: %s", async (forbiddenPath) => {
    const fixture = await createReleaseFixture();
    const absolutePath = join(
      fixture.sourceRoot,
      ...forbiddenPath.split("/"),
    );
    await mkdir(resolve(absolutePath, ".."), { recursive: true });
    await writeFile(absolutePath, "must not be released\n", "utf8");
    await git(fixture.sourceRoot, ["add", "--force", "--", forbiddenPath]);
    await git(fixture.sourceRoot, [
      "commit",
      "--quiet",
      "-m",
      `track forbidden root ${forbiddenPath}`,
    ]);
    const commit = await git(fixture.sourceRoot, ["rev-parse", "HEAD"]);

    const result = await execFileAsync(
      process.execPath,
      [
        manifestScript,
        "create",
        commit,
        join(fixture.sourceRoot, "forbidden-output.json"),
      ],
      { cwd: fixture.sourceRoot },
    ).catch((error: unknown) => error);

    expect(result).toMatchObject({ code: 1 });
    expect(String((result as { stderr?: unknown }).stderr)).toContain(
      `unsafe or reserved path: ${forbiddenPath}`,
    );
  });

  it("keeps the public .env.example template in release inputs", async () => {
    const fixture = await createReleaseFixture();
    await writeFile(
      join(fixture.sourceRoot, ".env.example"),
      "DATABASE_URL=postgresql://example.invalid/template\n",
      "utf8",
    );
    await git(fixture.sourceRoot, ["add", "--", ".env.example"]);
    await git(fixture.sourceRoot, [
      "commit",
      "--quiet",
      "-m",
      "track public environment template",
    ]);
    const commit = await git(fixture.sourceRoot, ["rev-parse", "HEAD"]);
    const outputPath = join(fixture.sourceRoot, "allowed-output.json");

    await execFileAsync(
      process.execPath,
      [manifestScript, "create", commit, outputPath],
      { cwd: fixture.sourceRoot },
    );

    const manifest = JSON.parse(await readFile(outputPath, "utf8")) as {
      files: Array<{ path: string }>;
    };
    expect(manifest.files).toContainEqual({
      mode: "100644",
      path: ".env.example",
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      size: expect.any(Number),
    });
  });

  it("fails closed when a tracked input changes after manifest creation", async () => {
    const fixture = await createReleaseFixture();
    await writeFile(
      join(fixture.buildRoot, "README.md"),
      "tampered release input\n",
      "utf8",
    );

    const result = await execFileAsync(
      process.execPath,
      [
        join("scripts", "deploy", "release-input-manifest.mjs"),
        "verify",
        fixture.commit,
        ".release-input-manifest.json",
      ],
      { cwd: fixture.buildRoot },
    ).catch((error: unknown) => error);

    expect(result).toMatchObject({ code: 1 });
    expect(String((result as { stderr?: unknown }).stderr)).toContain(
      "Build input content drifted",
    );
  });

  it("rejects an unexpected file even when every manifested file is intact", async () => {
    const fixture = await createReleaseFixture();
    await writeFile(join(fixture.buildRoot, "untracked.txt"), "extra\n", "utf8");

    const result = await execFileAsync(
      process.execPath,
      [
        join("scripts", "deploy", "release-input-manifest.mjs"),
        "verify",
        fixture.commit,
        ".release-input-manifest.json",
      ],
      { cwd: fixture.buildRoot },
    ).catch((error: unknown) => error);

    expect(result).toMatchObject({ code: 1 });
    expect(String((result as { stderr?: unknown }).stderr)).toContain(
      "Build input paths do not exactly match",
    );
  });

  it("refuses to create a manifest from dirty tracked inputs", async () => {
    const fixture = await createReleaseFixture();
    await writeFile(
      join(fixture.sourceRoot, "README.md"),
      "dirty tracked release input\n",
      "utf8",
    );
    const dirtyManifestPath = join(fixture.sourceRoot, "dirty-manifest.json");

    const result = await execFileAsync(
      process.execPath,
      [manifestScript, "create", fixture.commit, dirtyManifestPath],
      { cwd: fixture.sourceRoot },
    ).catch((error: unknown) => error);

    expect(result).toMatchObject({ code: 1 });
    expect(String((result as { stderr?: unknown }).stderr)).toContain(
      "clean worktree",
    );
  });

  it("rejects a commit identity that differs from the source or manifest", async () => {
    const fixture = await createReleaseFixture();
    const otherCommit = fixture.commit.startsWith("a")
      ? "b".repeat(40)
      : "a".repeat(40);
    const createResult = await execFileAsync(
      process.execPath,
      [
        manifestScript,
        "create",
        otherCommit,
        join(fixture.sourceRoot, "wrong-commit.json"),
      ],
      { cwd: fixture.sourceRoot },
    ).catch((error: unknown) => error);
    const verifyResult = await execFileAsync(
      process.execPath,
      [
        join("scripts", "deploy", "release-input-manifest.mjs"),
        "verify",
        otherCommit,
        ".release-input-manifest.json",
      ],
      { cwd: fixture.buildRoot },
    ).catch((error: unknown) => error);

    expect(createResult).toMatchObject({ code: 1 });
    expect(String((createResult as { stderr?: unknown }).stderr)).toContain(
      "does not match the current Git HEAD",
    );
    expect(verifyResult).toMatchObject({ code: 1 });
    expect(String((verifyResult as { stderr?: unknown }).stderr)).toContain(
      "does not match BUILD_RELEASE_ID",
    );
  });

  it("reads committed blobs instead of assume-unchanged working-tree bytes", async () => {
    const fixture = await createReleaseFixture();
    await git(fixture.sourceRoot, [
      "update-index",
      "--assume-unchanged",
      "README.md",
    ]);
    await writeFile(
      join(fixture.sourceRoot, "README.md"),
      "hidden working-tree drift\n",
      "utf8",
    );
    expect(
      await git(fixture.sourceRoot, [
        "status",
        "--porcelain",
        "--untracked-files=no",
      ]),
    ).toBe("");
    const secondManifestPath = join(
      fixture.sourceRoot,
      ".release-input-from-commit.json",
    );

    await execFileAsync(
      process.execPath,
      [manifestScript, "create", fixture.commit, secondManifestPath],
      { cwd: fixture.sourceRoot },
    );

    await expect(readFile(secondManifestPath, "utf8")).resolves.toBe(
      await readFile(fixture.manifestPath, "utf8"),
    );
  });
});
