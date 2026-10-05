import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execute = promisify(execFile);
const sourcePath = new URL("../scripts/ci/linux-durable-release-smoke.sh", import.meta.url);

describe("Linux durable smoke archive permissions", () => {
  it.each(["0000", "0002", "0777"])(
    "pins archive modes despite repository tar.umask=%s and permissive extraction",
    async (repositoryMask) => {
      const source = await readFile(sourcePath, "utf8");
      const pipelines = source.split("\n").filter((line) => line.includes('archive "${release_id}" |'));
      expect(pipelines).toHaveLength(1);
      const pipeline = pipelines[0].trim();
      const root = await mkdtemp(join(tmpdir(), "diesel-durable-archive-"));
      const fixture = join(root, "repository");
      const releaseDir = join(root, "release");
      const plain = "scripts/deploy/runner.mjs";
      const executable = "scripts/deploy/runner.sh";
      const payload = "synthetic non-secret fixture\n";
      const environment = {
        NODE_ENV: "test" as const,
        PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C",
        GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_ATTR_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0",
      };
      try {
        await mkdir(join(fixture, "scripts/deploy"), { recursive: true });
        await mkdir(releaseDir);
        await writeFile(join(fixture, plain), payload);
        await writeFile(join(fixture, executable), "#!/bin/bash\nexit 0\n");
        await chmod(join(fixture, executable), 0o755);
        const git = (args: string[]) => execute("/usr/bin/git", ["-C", fixture, ...args], {
          env: environment, timeout: 10_000,
        });
        await git(["-c", "init.defaultBranch=fixture", "init", "--quiet", "--template="]);
        await git(["config", "tar.umask", repositoryMask]);
        await git(["config", "core.fileMode", "true"]);
        await git(["add", "scripts"]);
        await git(["-c", "user.name=CI", "-c", "user.email=ci@example.invalid",
          "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null",
          "commit", "--quiet", "-m", "Synthetic archive fixture"]);
        const releaseId = (await git(["rev-parse", "HEAD"])).stdout.trim();
        expect(releaseId).toMatch(/^[0-9a-f]{40}$/u);
        // Execute the shipped pipeline, not a test reimplementation. A 0000
        // extraction mask retains archive modes even without root privileges.
        await execute("/bin/bash", ["-c", `set -euo pipefail\numask 0000\n${pipeline}`], {
          env: { ...environment, fixture, release_id: releaseId, release_dir: releaseDir },
          timeout: 10_000,
        });
        for (const directory of ["scripts", "scripts/deploy"]) {
          expect((await stat(join(releaseDir, directory))).mode & 0o7777).toBe(0o755);
        }
        expect((await stat(join(releaseDir, plain))).mode & 0o7777).toBe(0o644);
        expect((await stat(join(releaseDir, executable))).mode & 0o7777).toBe(0o755);
        expect(await readFile(join(releaseDir, plain), "utf8")).toBe(payload);
        expect(await readFile(join(releaseDir, executable)))
          .toEqual(await readFile(join(fixture, executable)));
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
