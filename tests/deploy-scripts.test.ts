import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const deployScripts = [
  "build-release.sh",
  "verify-release.sh",
  "rollback-host-release.sh",
] as const;

const buildOutputs = ["node_modules", ".next", ".build-complete"] as const;

async function createBuildFixture(
  symlinkedOutput: (typeof buildOutputs)[number],
): Promise<string> {
  const fixture = await mkdtemp(join(tmpdir(), "diesel-build-release-"));
  for (const input of ["package.json", "pnpm-lock.yaml", "next.config.ts"]) {
    await copyFile(resolve(process.cwd(), input), join(fixture, input));
  }

  for (const output of buildOutputs) {
    const outputPath = join(fixture, output);
    if (output === symlinkedOutput) {
      const target =
        output === ".build-complete"
          ? resolve(process.cwd(), "package.json")
          : process.cwd();
      await symlink(target, outputPath, output === ".build-complete" ? "file" : "dir");
    } else if (output === ".build-complete") {
      await writeFile(outputPath, "", "utf8");
    } else {
      await mkdir(outputPath);
    }
  }

  return fixture;
}

describe("versioned deployment scripts", () => {
  it.each(deployScripts)("%s passes Bash syntax validation", async (name) => {
    await expect(
      execFileAsync("bash", [
        "-n",
        resolve(process.cwd(), "scripts/deploy", name),
      ]),
    ).resolves.toMatchObject({ stderr: "" });
  });

  it("fails build preflight when a production secret is inherited", async () => {
    const result = await execFileAsync(
      "bash",
      [resolve(process.cwd(), "scripts/deploy/build-release.sh")],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          BUILD_HOME: process.cwd(),
          BUILD_RELEASE_ID: "test-release",
          DATABASE_URL: "postgresql://should-not-reach-the-build.invalid/db",
        },
      },
    ).catch((error: unknown) => error);

    expect(result).toMatchObject({ code: 64 });
    expect(String((result as { stderr?: unknown }).stderr)).toContain(
      "DATABASE_URL must not be present",
    );
  });

  it("rejects unsafe release identifiers before rollback filesystem access", async () => {
    const result = await execFileAsync("bash", [
      resolve(process.cwd(), "scripts/deploy/rollback-host-release.sh"),
      "../current",
      "--check",
    ]).catch((error: unknown) => error);

    expect(result).toMatchObject({ code: 64 });
  });

  it("replaces and verifies exactly one versioned diesel-demo process on rollback", async () => {
    const rollbackScript = await readFile(
      resolve(process.cwd(), "scripts/deploy/rollback-host-release.sh"),
      "utf8",
    );

    expect(rollbackScript).not.toContain("global-diesel-regulations");
    expect(rollbackScript).toContain("pm2 describe diesel-demo");
    expect(rollbackScript).toContain("pm2 delete diesel-demo");
    expect(rollbackScript).toContain(
      'const matches = apps.filter((app) => app.name === "diesel-demo")',
    );
    expect(rollbackScript).toContain("matches.length !== 1");
    expect(rollbackScript).toContain('app?.pm2_env?.status !== "online"');
    expect(rollbackScript).toContain(
      "appVersion !== process.env.EXPECTED_APP_VERSION",
    );
    expect(rollbackScript).toContain(
      '"${previous_release}/scripts/deploy/verify-release.sh"',
    );
  });

  it.each(buildOutputs)(
    "rejects a symlinked %s build output before install or build",
    async (output) => {
      const fixture = await createBuildFixture(output);
      const buildEnvironment = { ...process.env };
      delete buildEnvironment.DATABASE_URL;
      delete buildEnvironment.AI_API_KEY;
      delete buildEnvironment.ADMIN_ROLE_BINDINGS_JSON;

      try {
        const result = await execFileAsync(
          "bash",
          [resolve(process.cwd(), "scripts/deploy/build-release.sh")],
          {
            cwd: fixture,
            env: {
              ...buildEnvironment,
              BUILD_HOME: fixture,
              BUILD_RELEASE_ID: "symlink-preflight-test",
            },
          },
        ).catch((error: unknown) => error);

        expect(result).toMatchObject({ code: 64 });
        expect(String((result as { stderr?: unknown }).stderr)).toContain(
          `${output} must be a pre-created`,
        );
      } finally {
        await rm(fixture, { force: true, recursive: true });
      }
    },
  );

  it("keeps tracked release inputs root-owned and builds in an isolated writable copy", async () => {
    const buildScript = await readFile(
      resolve(process.cwd(), "scripts/deploy/build-release.sh"),
      "utf8",
    );
    const runbook = await readFile(
      resolve(process.cwd(), "docs/DEPLOYMENT.md"),
      "utf8",
    );

    expect(runbook).not.toContain(
      'chown -R diesel-build:diesel "${release_dir}"',
    );
    expect(buildScript).not.toContain("chown");
    expect(buildScript).toContain(
      "[[ -d node_modules && ! -L node_modules ]]",
    );
    expect(buildScript).toContain("[[ -d .next && ! -L .next ]]");
    expect(buildScript).toContain(
      "[[ -f .build-complete && ! -L .build-complete ]]",
    );
    expect(runbook).toContain(
      "for build_output in node_modules .next .build-complete; do",
    );
    expect(runbook).toContain('test ! -L "${build_output}"');
    expect(runbook).not.toContain('chown -hR root:diesel-build "${release_dir}"');
    expect(runbook).toContain(
      'build_workspace="${build_workspace_root}/${release_id}"',
    );
    expect(runbook).toContain(
      'cp -a "${release_dir}/." "${build_workspace}/"',
    );
    expect(runbook).toContain(
      'chown -hR diesel-build:diesel-build "${build_workspace}"',
    );
    expect(runbook).toContain(
      'mv "${build_workspace}/${build_output}" "${release_dir}/${build_output}"',
    );
    expect(runbook).toContain(
      'chown -hR root:diesel "${release_dir}"',
    );
  });
});
