import { spawnSync } from "node:child_process";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  PLAYWRIGHT_PNPM_RUN_FLAGS,
  buildPlaywrightPnpmRunArguments,
  createPlaywrightEvidenceExecutionContext,
  releasePlaywrightEvidenceCaptureResources,
  withPlaywrightEvidenceCaptureBoundary,
} from "../scripts/portfolio/capture-playwright-evidence";
import {
  EXPECTED_PNPM_VERSION,
} from "../scripts/portfolio/capture-vitest-execution-evidence";
import {
  PLAYWRIGHT_TEST_SOURCE_MAX_BYTES,
  PLAYWRIGHT_FORBIDDEN_WORKSPACE_PACKAGE_MANAGER_PATHS,
  assertPlaywrightWorkspacePackageManagerConfigurationAbsent,
  assertPlaywrightEvidence,
  assertPlaywrightObservationSourceLocations,
  assertPlaywrightReceiptInventoryMatchesEvidence,
  assertPlaywrightRunReceipt,
  buildPlaywrightEvidence,
  buildPlaywrightRunReceipt,
  capturePlaywrightRepositoryState,
  capturePlaywrightSourceFingerprintAtRevision,
  parseCanonicalPlaywrightEvidence,
  parseCanonicalPlaywrightRunReceipt,
  playwrightSourcePathspecs,
  playwrightRunContracts,
  serializeCanonicalPlaywrightEvidence,
  serializeCanonicalPlaywrightRunReceipt,
  shouldForbidOnlyInPlaywrightRun,
  type PlaywrightEvidence,
  type PlaywrightRepositoryState,
  type PlaywrightRunReceipt,
  type PlaywrightTestObservation,
} from "../scripts/portfolio/playwright-evidence";
import {
  acquirePlaywrightEvidenceCaptureLock,
} from "../scripts/portfolio/playwright-evidence-capture-lock";
import {
  capturePnpmInstallationState,
} from "../scripts/portfolio/pnpm-installation-state";

const HEAD = "a".repeat(40);
const FINGERPRINT = {
  algorithm: "sha256" as const,
  digest: "b".repeat(64),
  fileCount: 235,
};
const STATE: PlaywrightRepositoryState = {
  headCommit: HEAD,
  sourceFingerprint: FINGERPRINT,
  worktreeState: "dirty",
};
const RUN_ID = "123e4567-e89b-42d3-a456-426614174000";
const temporaryWorkspaces: string[] = [];

function createWorkspace(): string {
  const workspace = mkdtempSync(join(tmpdir(), "diesel-playwright-evidence-"));
  temporaryWorkspaces.push(workspace);
  mkdirSync(resolve(workspace, "e2e"), { recursive: true });
  return workspace;
}

function writeWorkspaceFile(
  workspace: string,
  path: string,
  contents: string | Buffer,
): void {
  const absolutePath = resolve(workspace, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents);
}

function runFixtureGit(workspace: string, args: readonly string[]): string {
  const result = spawnSync("/usr/bin/git", args, {
    cwd: workspace,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Synthetic Git command failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function createGitWorkspace(): string {
  const workspace = createWorkspace();
  runFixtureGit(workspace, ["init", "--quiet"]);
  return realpathSync(workspace);
}

function captureSyntheticPnpmInstallation(workspace: string) {
  const storeDir = resolve(workspace, "store/v11");
  mkdirSync(storeDir, { recursive: true });
  writeWorkspaceFile(
    workspace,
    "node_modules/.modules.yaml",
    `${JSON.stringify({
      layoutVersion: 5,
      packageManager: "pnpm@11.9.0",
      storeDir,
      virtualStoreDir: ".pnpm",
    }, null, 2)}\n`,
  );
  writeWorkspaceFile(
    workspace,
    "node_modules/.pnpm-workspace-state-v1.json",
    '{"filteredInstall":false,"projects":{},"settings":{}}\n',
  );
  const lockfile = "lockfileVersion: '9.0'\npackages: {}\n";
  writeWorkspaceFile(workspace, "pnpm-lock.yaml", lockfile);
  writeWorkspaceFile(workspace, "node_modules/.pnpm/lock.yaml", lockfile);
  return capturePnpmInstallationState(workspace);
}

afterEach(() => {
  while (temporaryWorkspaces.length > 0) {
    const workspace = temporaryWorkspaces.pop();
    if (workspace !== undefined) {
      rmSync(workspace, { force: true, recursive: true });
    }
  }
});

function observation(
  project: string,
  index: number,
  overrides: Partial<PlaywrightTestObservation> = {},
): PlaywrightTestObservation {
  return {
    attempts: 1,
    expectedStatus: "passed",
    file: `e2e/suite-${index}.spec.ts`,
    finalStatus: "passed",
    id: `test_${index}`,
    line: index + 1,
    outcome: "expected",
    project,
    retryCount: 0,
    ...overrides,
  };
}

function receipt(
  contractIndex: number,
  overrides: {
    completed?: PlaywrightRepositoryState;
    completedAt?: string;
    started?: PlaywrightRepositoryState;
    startedAt?: string;
    tests?: PlaywrightTestObservation[];
  } = {},
): PlaywrightRunReceipt {
  const contract = playwrightRunContracts[contractIndex];
  if (!contract) throw new Error("Unknown synthetic Playwright contract.");
  const minute = contractIndex * 2;
  return buildPlaywrightRunReceipt({
    completedAt: overrides.completedAt ??
      `2026-09-03T01:${String(minute + 1).padStart(2, "0")}:00.000Z`,
    globalErrorCount: 0,
    id: contract.id,
    playwrightVersion: "1.63.0",
    provenance: {
      completed: overrides.completed ?? STATE,
      started: overrides.started ?? STATE,
    },
    runStatus: "passed",
    startedAt: overrides.startedAt ??
      `2026-09-03T01:${String(minute).padStart(2, "0")}:00.000Z`,
    tests: overrides.tests ?? contract.projects.flatMap((project, index) => [
      observation(project, contractIndex * 100 + index * 2),
      observation(project, contractIndex * 100 + index * 2 + 1),
    ]),
  });
}

function receipts(): PlaywrightRunReceipt[] {
  return playwrightRunContracts.map((_, index) => receipt(index));
}

function evidence(): PlaywrightEvidence {
  return buildPlaywrightEvidence(receipts(), RUN_ID);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

describe("Playwright portfolio evidence", () => {
  it("keeps forbidOnly enabled for evidence capture after removing inherited CI", () => {
    const execution = createPlaywrightEvidenceExecutionContext({
      ...process.env,
      CI: "true",
      PLAYWRIGHT_BASE_URL: "https://attacker.invalid",
    });
    try {
      const { environment } = execution;
      expect(environment.CI).toBeUndefined();
      expect(environment.PLAYWRIGHT_BASE_URL).toBeUndefined();
      expect(environment.DIESEL_PLAYWRIGHT_EVIDENCE_CAPTURE).toBe("1");
      expect(shouldForbidOnlyInPlaywrightRun(environment)).toBe(true);
      expect(shouldForbidOnlyInPlaywrightRun({})).toBe(false);
    } finally {
      execution.dispose();
    }
  });

  it.each([
    {
      inherited: {
        HOME: "/tmp/attacker-home",
        NPM_CONFIG_GLOBALCONFIG: "/tmp/attacker-global-npmrc",
        NPM_CONFIG_IGNORE_PNPMFILE: "false",
        NPM_CONFIG_OFFLINE: "false",
        NPM_CONFIG_SCRIPT_SHELL: "/tmp/attacker-shell",
        NPM_CONFIG_SHELL_EMULATOR: "true",
        NPM_CONFIG_USERCONFIG: "/tmp/attacker-npmrc",
        NPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: "true",
        npm_config_script_shell: "/tmp/attacker-shell",
        PNPM_CONFIG_IGNORE_PNPMFILE: "false",
        PNPM_CONFIG_NODE_EXPERIMENTAL_PACKAGE_MAP: "true",
        PNPM_CONFIG_OFFLINE: "false",
        PNPM_CONFIG_SCRIPT_SHELL: "/tmp/attacker-pnpm-shell",
        PNPM_CONFIG_SHELL_EMULATOR: "true",
        PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: "true",
        PNPM_HOME: "/tmp/attacker-pnpm",
        TMPDIR: "/tmp/attacker-tmp",
        XDG_CONFIG_HOME: "/tmp/attacker-xdg-config",
      },
      label: "package-manager and runtime directories",
    },
    {
      inherited: {
        __NEXT_PROCESSED_ENV: "false",
        NODE_OPTIONS: "--require=/tmp/attacker.cjs --loader=/tmp/loader.mjs",
        NODE_PATH: "/tmp/attacker-modules",
        NODE_V8_COVERAGE: "/tmp/attacker-coverage",
        TSX_TSCONFIG_PATH: "/tmp/attacker-tsconfig.json",
      },
      label: "Node loader and tsx injection",
    },
    {
      inherited: {
        PLAYWRIGHT_BASE_URL: "https://attacker.invalid",
        PLAYWRIGHT_BROWSERS_PATH: "/tmp/attacker-browser",
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
        PWDEBUG: "1",
        PWTEST_SOURCE_TRANSFORM: "/tmp/attacker-transform.cjs",
      },
      label: "Playwright and PWTEST controls",
    },
    {
      inherited: {
        ADMIN_ROLE_BINDINGS_JSON: '{"attacker":"admin"}',
        AI_API_KEY: "inherited-secret-marker",
        AI_BASE_URL: "https://attacker.invalid/v1",
        DATABASE_MODE: "postgres",
        DATABASE_URL: "postgresql://attacker.invalid/database",
        PORTFOLIO_DEMO_MODE: "true",
      },
      label: "application AI and database configuration",
    },
  ])("removes inherited $label", ({ inherited }) => {
    const execution = createPlaywrightEvidenceExecutionContext({
      ...process.env,
      ...inherited,
    });
    try {
      for (const [name, value] of Object.entries(inherited)) {
        expect(execution.environment[name]).not.toBe(value);
        if (
          name !== "HOME" &&
          name !== "TMPDIR" &&
          name !== "NPM_CONFIG_GLOBALCONFIG" &&
          name !== "NPM_CONFIG_IGNORE_PNPMFILE" &&
          name !== "NPM_CONFIG_OFFLINE" &&
          name !== "NPM_CONFIG_USERCONFIG" &&
          name !== "NPM_CONFIG_VERIFY_DEPS_BEFORE_RUN" &&
          name !== "PNPM_CONFIG_IGNORE_PNPMFILE" &&
          name !== "PNPM_CONFIG_NODE_EXPERIMENTAL_PACKAGE_MAP" &&
          name !== "PNPM_CONFIG_OFFLINE" &&
          name !== "PNPM_CONFIG_SCRIPT_SHELL" &&
          name !== "PNPM_CONFIG_SHELL_EMULATOR" &&
          name !== "PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN" &&
          name !== "XDG_CONFIG_HOME" &&
          name !== "__NEXT_PROCESSED_ENV"
        ) {
          expect(execution.environment[name]).toBeUndefined();
        }
      }
    } finally {
      execution.dispose();
    }
  });

  it.each([
    "HOME",
    "NPM_CONFIG_GLOBALCONFIG",
    "NPM_CONFIG_USERCONFIG",
    "PATH",
    "TMPDIR",
    "XDG_CONFIG_HOME",
  ] as const)(
    "retains the canonical %s runtime boundary",
    (name) => {
      const execution = createPlaywrightEvidenceExecutionContext(process.env);
      try {
        const expected = {
          HOME: realpathSync(userInfo().homedir),
          NPM_CONFIG_GLOBALCONFIG: resolve(
            execution.toolDirectory,
            ".npmrc-global",
          ),
          NPM_CONFIG_USERCONFIG: resolve(
            execution.toolDirectory,
            ".npmrc-user",
          ),
          PATH: [execution.toolDirectory, "/usr/bin", "/bin"].join(delimiter),
          TMPDIR: resolve(execution.toolDirectory, ".tmp"),
          XDG_CONFIG_HOME: resolve(execution.toolDirectory, ".config"),
        }[name];
        expect(execution.environment[name]).toBe(expected);
        expect(Object.keys(execution.environment).sort()).toEqual([
          "DIESEL_PLAYWRIGHT_EVIDENCE_CAPTURE",
          "HOME",
          "LANG",
          "LC_ALL",
          "NO_COLOR",
          "NPM_CONFIG_GLOBALCONFIG",
          "NPM_CONFIG_IGNORE_PNPMFILE",
          "NPM_CONFIG_OFFLINE",
          "NPM_CONFIG_USERCONFIG",
          "NPM_CONFIG_VERIFY_DEPS_BEFORE_RUN",
          "PATH",
          "PNPM_CONFIG_IGNORE_PNPMFILE",
          "PNPM_CONFIG_NODE_EXPERIMENTAL_PACKAGE_MAP",
          "PNPM_CONFIG_OFFLINE",
          "PNPM_CONFIG_SCRIPT_SHELL",
          "PNPM_CONFIG_SHELL_EMULATOR",
          "PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN",
          "TMPDIR",
          "TZ",
          "XDG_CONFIG_HOME",
          "__NEXT_PROCESSED_ENV",
        ]);
        expect(execution.environment.__NEXT_PROCESSED_ENV).toBe("true");
        expect(execution.environment.NPM_CONFIG_IGNORE_PNPMFILE).toBe("true");
        expect(execution.environment.NPM_CONFIG_OFFLINE).toBe("true");
        expect(execution.environment.NPM_CONFIG_VERIFY_DEPS_BEFORE_RUN).toBe(
          "false",
        );
        expect(execution.environment.PNPM_CONFIG_IGNORE_PNPMFILE).toBe("true");
        expect(
          execution.environment.PNPM_CONFIG_NODE_EXPERIMENTAL_PACKAGE_MAP,
        ).toBe("false");
        expect(execution.environment.PNPM_CONFIG_OFFLINE).toBe("true");
        expect(execution.environment.PNPM_CONFIG_SCRIPT_SHELL).toBe("/bin/sh");
        expect(execution.environment.PNPM_CONFIG_SHELL_EMULATOR).toBe("false");
        expect(execution.environment.PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN).toBe(
          "false",
        );
        expect(
          realpathSync(resolve(execution.toolDirectory, "pnpm")),
        ).toBe(execution.pnpmEntrypoint);
        expect(
          realpathSync(resolve(execution.toolDirectory, "node")),
        ).toBe(execution.nodeExecutable);
        for (const configPath of [
          execution.environment.NPM_CONFIG_GLOBALCONFIG,
          execution.environment.NPM_CONFIG_USERCONFIG,
        ]) {
          expect(readFileSync(configPath)).toHaveLength(0);
          expect(lstatSync(configPath).mode & 0o777).toBe(0o600);
        }
      } finally {
        execution.dispose();
      }
    },
  );

  it("resolves web-server pnpm through the private verified PATH", () => {
    const execution = createPlaywrightEvidenceExecutionContext(process.env);
    try {
      const result = spawnSync("pnpm", ["--version"], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...execution.environment } as NodeJS.ProcessEnv,
        shell: false,
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout.trim()).toBe(EXPECTED_PNPM_VERSION);
      for (const [key, expected] of [
        ["ignore-pnpmfile", "true"],
        ["node-experimental-package-map", "false"],
        ["offline", "true"],
        ["script-shell", "/bin/sh"],
        ["shell-emulator", "false"],
        ["verify-deps-before-run", "false"],
      ] as const) {
        const configResult = spawnSync("pnpm", ["config", "get", key], {
          cwd: process.cwd(),
          encoding: "utf8",
          env: { ...execution.environment } as NodeJS.ProcessEnv,
          shell: false,
        });
        expect(configResult.error).toBeUndefined();
        expect(configResult.status).toBe(0);
        expect(configResult.stderr).toBe("");
        expect(configResult.stdout.trim()).toBe(expected);
      }
    } finally {
      execution.dispose();
    }
  });

  it("uses the fixed physical /tmp root instead of inherited TMPDIR", () => {
    const attackerTemporaryRoot = createWorkspace();
    const inheritedTemporaryRoot = process.env.TMPDIR;
    let execution: ReturnType<
      typeof createPlaywrightEvidenceExecutionContext
    > | undefined;
    try {
      process.env.TMPDIR = attackerTemporaryRoot;
      execution = createPlaywrightEvidenceExecutionContext(process.env);
      expect(dirname(execution.toolDirectory)).toBe(realpathSync("/tmp"));
      expect(execution.toolDirectory.startsWith(attackerTemporaryRoot)).toBe(
        false,
      );
    } finally {
      if (inheritedTemporaryRoot === undefined) {
        delete process.env.TMPDIR;
      } else {
        process.env.TMPDIR = inheritedTemporaryRoot;
      }
      execution?.dispose();
    }
  });

  it("uses the pinned Next processed-env sentinel to ignore local env files", () => {
    const workspace = createWorkspace();
    const marker = "next-env-local-file-was-loaded";
    writeWorkspaceFile(
      workspace,
      ".env.local",
      `DIESEL_PLAYWRIGHT_ENV_MARKER=${marker}\n`,
    );
    const execution = createPlaywrightEvidenceExecutionContext(process.env);
    const fixture = [
      'const { createRequire } = require("node:module");',
      'const nextPackage = require.resolve("next/package.json", { paths: [process.cwd()] });',
      "const nextVersion = require(nextPackage).version;",
      "const nextRequire = createRequire(nextPackage);",
      'const { loadEnvConfig } = nextRequire("@next/env");',
      "loadEnvConfig(process.argv[1], true);",
      'process.stdout.write(`${nextVersion}|${process.env.DIESEL_PLAYWRIGHT_ENV_MARKER ?? "absent"}`);',
    ].join("\n");
    const runFixture = (environment: Readonly<Record<string, string>>) =>
      spawnSync(execution.nodeExecutable, ["-e", fixture, workspace], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...environment } as NodeJS.ProcessEnv,
        shell: false,
      });
    try {
      const guarded = runFixture(execution.environment);
      expect(guarded.error).toBeUndefined();
      expect(guarded.status).toBe(0);
      expect(guarded.stderr).toBe("");
      expect(guarded.stdout).toBe("16.3.6|absent");

      const unguardedEnvironment = { ...execution.environment };
      delete unguardedEnvironment.__NEXT_PROCESSED_ENV;
      const control = runFixture(unguardedEnvironment);
      expect(control.error).toBeUndefined();
      expect(control.status).toBe(0);
      expect(control.stdout).toBe(`16.3.6|${marker}`);
    } finally {
      execution.dispose();
    }
  });

  it.each(PLAYWRIGHT_FORBIDDEN_WORKSPACE_PACKAGE_MANAGER_PATHS)(
    "fails closed when workspace %s exists without reading it",
    (relativePath) => {
      const workspace = createWorkspace();
      writeWorkspaceFile(workspace, relativePath, "sensitive-marker\n");
      expect(() =>
        assertPlaywrightWorkspacePackageManagerConfigurationAbsent(
          realpathSync(workspace),
        )
      ).toThrow(`Playwright evidence requires ${relativePath} to be absent.`);
    },
  );

  it("checks lock ownership and workspace package policy before and after an operation", async () => {
    const workspace = createGitWorkspace();
    const installationState = captureSyntheticPnpmInstallation(workspace);
    const lock = acquirePlaywrightEvidenceCaptureLock(workspace);
    let ownershipChecks = 0;
    const boundaryLock = {
      assertOwned() {
        ownershipChecks += 1;
        lock.assertOwned();
      },
    };
    const forbiddenPath = resolve(workspace, ".pnpmfile.cjs");
    await expect(withPlaywrightEvidenceCaptureBoundary({
      boundary: { installationState, lock: boundaryLock, workspace },
      label: "synthetic capture operation",
      operation: () => {
        writeFileSync(forbiddenPath, "module.exports = {}\n");
      },
    })).rejects.toThrow("requires .pnpmfile.cjs to be absent");
    expect(ownershipChecks).toBe(2);
    lock.assertOwned();
    rmSync(forbiddenPath);
    lock.release();
  });

  it("does not start an operation when a forbidden workspace config already exists", async () => {
    const workspace = createGitWorkspace();
    const installationState = captureSyntheticPnpmInstallation(workspace);
    const lock = acquirePlaywrightEvidenceCaptureLock(workspace);
    writeWorkspaceFile(workspace, ".npmrc", "script-shell=/tmp/attacker\n");
    let operationCalled = false;
    await expect(withPlaywrightEvidenceCaptureBoundary({
      boundary: { installationState, lock, workspace },
      label: "synthetic capture operation",
      operation: () => {
        operationCalled = true;
      },
    })).rejects.toThrow("requires .npmrc to be absent");
    expect(operationCalled).toBe(false);
    rmSync(resolve(workspace, ".npmrc"));
    lock.release();
  });

  it("fails closed when a pnpm run rewrites shared installation metadata", async () => {
    const workspace = createGitWorkspace();
    const installationState = captureSyntheticPnpmInstallation(workspace);
    const lock = acquirePlaywrightEvidenceCaptureLock(workspace);
    await expect(withPlaywrightEvidenceCaptureBoundary({
      boundary: { installationState, lock, workspace },
      label: "synthetic dependency mutation",
      operation: () => {
        writeWorkspaceFile(
          workspace,
          "node_modules/.pnpm-workspace-state-v1.json",
          '{"filteredInstall":false,"projects":{"changed":{}},"settings":{}}\n',
        );
      },
    })).rejects.toThrow(
      "Playwright pnpm installation state changed: node_modules/.pnpm-workspace-state-v1.json.",
    );
    lock.assertOwned();
    lock.release();
  });

  it("uses only offline pnpm runs with automatic dependency repair disabled", () => {
    expect(PLAYWRIGHT_PNPM_RUN_FLAGS).toEqual([
      "--config.node-experimental-package-map=false",
      "--config.offline=true",
      "--config.verify-deps-before-run=false",
    ]);
    expect(buildPlaywrightPnpmRunArguments(
      "/verified/pnpm.mjs",
      "test:e2e",
      { storeDirConfigValue: "/verified/store/v11" },
    )).toEqual([
      "/verified/pnpm.mjs",
      "--config.store-dir=/verified/store/v11",
      ...PLAYWRIGHT_PNPM_RUN_FLAGS,
      "test:e2e",
    ]);
  });

  it("serializes captures with a lock outside fingerprinted source", () => {
    const workspace = createGitWorkspace();
    const first = acquirePlaywrightEvidenceCaptureLock(workspace);
    expect(first.path.startsWith(`${resolve(workspace, ".git")}/`)).toBe(true);
    expect(() => acquirePlaywrightEvidenceCaptureLock(workspace)).toThrow(
      /already held.*explicit manual recovery/u,
    );
    first.assertOwned();
    first.release();
    const next = acquirePlaywrightEvidenceCaptureLock(workspace);
    next.release();
  });

  it("preserves a lock that is reported stale for explicit manual recovery", () => {
    const workspace = createGitWorkspace();
    const lock = acquirePlaywrightEvidenceCaptureLock(workspace);
    expect(() =>
      acquirePlaywrightEvidenceCaptureLock(workspace, {
        pidProbe: () => "missing",
      })
    ).toThrow(/lock is stale.*explicit manual recovery/u);
    expect(lstatSync(lock.path).isDirectory()).toBe(true);
    lock.assertOwned();
    lock.release();
  });

  it("preserves unverifiable and ownership-mutated locks", () => {
    const workspace = createGitWorkspace();
    const lock = acquirePlaywrightEvidenceCaptureLock(workspace);
    writeFileSync(lock.ownerPath, "{}\n");
    chmodSync(lock.ownerPath, 0o600);
    expect(() => acquirePlaywrightEvidenceCaptureLock(workspace)).toThrow(
      /lock is unverifiable.*explicit manual recovery/u,
    );
    expect(() => lock.assertOwned()).toThrow();
    expect(() => lock.release()).toThrow();
    expect(lstatSync(lock.path).isDirectory()).toBe(true);
  });

  it("aggregates capture, tool cleanup, and lock release failures", () => {
    const captureFailure = new Error("capture-failure-marker");
    const toolFailure = new Error("tool-cleanup-failure-marker");
    const releaseFailure = new Error("lock-release-failure-marker");
    const calls: string[] = [];
    let thrown: unknown;
    try {
      releasePlaywrightEvidenceCaptureResources({
        execution: {
          dispose() {
            calls.push("dispose");
            throw toolFailure;
          },
        },
        failure: { cause: captureFailure, failed: true },
        lock: {
          assertOwned() {
            calls.push("assert-owned");
          },
          release() {
            calls.push("release");
            throw releaseFailure;
          },
        },
      });
    } catch (cause: unknown) {
      thrown = cause;
    }
    expect(calls).toEqual(["dispose", "assert-owned", "release"]);
    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors).toEqual([
      captureFailure,
      toolFailure,
      releaseFailure,
    ]);
  });

  it("releases an owned capture lock while preserving the capture failure", () => {
    const workspace = createGitWorkspace();
    const lock = acquirePlaywrightEvidenceCaptureLock(workspace);
    const captureFailure = new Error("capture-failure-marker");
    expect(() =>
      releasePlaywrightEvidenceCaptureResources({
        failure: { cause: captureFailure, failed: true },
        lock,
      })
    ).toThrow(captureFailure);
    expect(() => lstatSync(lock.path)).toThrow();
    const next = acquirePlaywrightEvidenceCaptureLock(workspace);
    next.release();
  });

  it.each([
    { label: "a different pnpm version", name: "pnpm", version: "11.8.0" },
    { label: "a package-name impostor", name: "pnpm-impostor", version: "11.9.0" },
  ])("fails closed on $label at the head of PATH", ({ name, version }) => {
    const workspace = createWorkspace();
    const fakeBin = resolve(workspace, "fake-bin");
    const fakePackage = resolve(workspace, "fake-pnpm");
    const fakePnpm = resolve(fakePackage, "bin/pnpm.mjs");
    mkdirSync(fakeBin);
    writeWorkspaceFile(
      workspace,
      "fake-pnpm/package.json",
      `${JSON.stringify({
        bin: { pnpm: "bin/pnpm.mjs" },
        name,
        version,
      })}\n`,
    );
    writeWorkspaceFile(
      workspace,
      "fake-pnpm/bin/pnpm.mjs",
      "process.stdout.write('11.9.0\\n');\n",
    );
    chmodSync(fakePnpm, 0o755);
    symlinkSync(fakePnpm, resolve(fakeBin, "pnpm"));

    expect(() =>
      createPlaywrightEvidenceExecutionContext({
        ...process.env,
        PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
      })
    ).toThrow("Playwright evidence requires verified pnpm 11.9.0 from PATH.");
  });

  it("binds the pnpm workspace install policy into source fingerprints", () => {
    expect(playwrightSourcePathspecs).toContain("pnpm-workspace.yaml");
    expect(playwrightSourcePathspecs).toContain("patches");
    expect(playwrightSourcePathspecs).toContain(".npmrc");
    expect(playwrightSourcePathspecs).toContain(".pnpmfile.cjs");
  });

  it("fingerprints authored global-error fixture inputs without generated Next state", () => {
    expect(playwrightSourcePathspecs).toContain(
      "tests/fixtures/global-error-app/app",
    );
    expect(playwrightSourcePathspecs).toContain(
      "tests/fixtures/global-error-app/next.config.ts",
    );
    expect(playwrightSourcePathspecs).toContain(
      "tests/fixtures/global-error-app/tsconfig.json",
    );
    expect(playwrightSourcePathspecs).not.toContain(
      "tests/fixtures/global-error-app",
    );
    expect(playwrightSourcePathspecs).not.toContain(
      "tests/fixtures/global-error-app/next-env.d.ts",
    );
  });

  it("binds Playwright runtime helpers while ignoring guarded generated Next state", () => {
    const workspace = createWorkspace();
    const authoredPaths = [
      "scripts/format-error.ts",
      "scripts/next-build.ts",
      "scripts/next-environment-file.ts",
      "tests/fixtures/global-error-app/app/layout.tsx",
      "tests/fixtures/global-error-app/next.config.ts",
      "tests/fixtures/global-error-app/tsconfig.json",
    ] as const;
    for (const path of authoredPaths) {
      writeWorkspaceFile(workspace, path, `initial:${path}\n`);
    }
    const generatedPath = "tests/fixtures/global-error-app/next-env.d.ts";
    writeWorkspaceFile(workspace, generatedPath, "generated:initial\n");
    runFixtureGit(workspace, ["init", "--quiet"]);
    runFixtureGit(workspace, ["config", "user.email", "fixture@example.invalid"]);
    runFixtureGit(workspace, ["config", "user.name", "Fixture"]);
    runFixtureGit(workspace, ["add", "--", "."]);
    runFixtureGit(workspace, ["commit", "--quiet", "-m", "fixture"]);

    const baseline = capturePlaywrightRepositoryState(workspace)
      .sourceFingerprint;
    writeWorkspaceFile(workspace, generatedPath, "generated:dev-runtime\n");
    expect(
      capturePlaywrightRepositoryState(workspace).sourceFingerprint,
    ).toEqual(baseline);

    for (
      const path of PLAYWRIGHT_FORBIDDEN_WORKSPACE_PACKAGE_MANAGER_PATHS
    ) {
      writeWorkspaceFile(workspace, path, "forbidden-package-manager-config\n");
      expect(
        capturePlaywrightRepositoryState(workspace).sourceFingerprint,
      ).not.toEqual(baseline);
      rmSync(resolve(workspace, path));
    }

    for (const path of authoredPaths) {
      writeWorkspaceFile(workspace, path, `changed:${path}\n`);
      expect(
        capturePlaywrightRepositoryState(workspace).sourceFingerprint,
      ).not.toEqual(baseline);
      writeWorkspaceFile(workspace, path, `initial:${path}\n`);
    }
  });

  it("reconstructs a clean source fingerprint from the claimed commit tree", () => {
    const workspace = createWorkspace();
    writeWorkspaceFile(workspace, "src/app/page.tsx", "export default 1;\n");
    writeWorkspaceFile(workspace, "pnpm-workspace.yaml", "packages: []\n");
    runFixtureGit(workspace, ["init", "--quiet"]);
    runFixtureGit(workspace, ["config", "user.email", "fixture@example.invalid"]);
    runFixtureGit(workspace, ["config", "user.name", "Fixture"]);
    runFixtureGit(workspace, ["add", "--", "."]);
    runFixtureGit(workspace, ["commit", "--quiet", "-m", "fixture"]);

    const current = capturePlaywrightRepositoryState(workspace);
    expect(current.worktreeState).toBe("clean");
    expect(
      capturePlaywrightSourceFingerprintAtRevision(
        workspace,
        current.headCommit,
      ),
    ).toEqual(current.sourceFingerprint);

    writeWorkspaceFile(workspace, "src/app/page.tsx", "export default 2;\n");
    const dirty = capturePlaywrightRepositoryState(workspace);
    expect(dirty.sourceFingerprint).not.toEqual(current.sourceFingerprint);
    expect(
      capturePlaywrightSourceFingerprintAtRevision(
        workspace,
        current.headCommit,
      ),
    ).toEqual(current.sourceFingerprint);
  });

  it("aggregates the canonical four-suite matrix", () => {
    const value = evidence();

    expect(value.runs.map(({ id }) => id)).toEqual([
      "public",
      "demo",
      "fde",
      "production-csp",
    ]);
    expect(value.totals).toEqual({
      collected: 20,
      failed: 0,
      flaky: 0,
      passed: 20,
      skipped: 0,
    });
    expect(value.complete).toBe(true);
    expect(parseCanonicalPlaywrightEvidence(
      serializeCanonicalPlaywrightEvidence(value),
    )).toEqual(value);
  });

  it.each([
    ["missing final newline", (text: string) => text.trimEnd()],
    ["noncanonical indentation", (text: string) => JSON.stringify(JSON.parse(text))],
    ["duplicate key", (text: string) => text.replace(
      '  "complete": true,',
      '  "complete": false,\n  "complete": true,',
    )],
  ])("rejects %s", (_label, mutate) => {
    const canonical = serializeCanonicalPlaywrightEvidence(evidence());
    expect(() => parseCanonicalPlaywrightEvidence(mutate(canonical))).toThrow(
      /canonical two-space JSON/u,
    );
  });

  it("rejects a missing run and an additional duplicate run", () => {
    const all = receipts();
    expect(() => buildPlaywrightEvidence(all.slice(0, -1), RUN_ID)).toThrow(
      "requires every run exactly once",
    );
    expect(() =>
      buildPlaywrightEvidence([...all, clone(all[0]!)], RUN_ID)
    ).toThrow("requires every run exactly once");
  });

  it("rejects a reordered or renamed project matrix", () => {
    const reordered = clone(receipt(0));
    reordered.projects.reverse();
    expect(() => assertPlaywrightRunReceipt(reordered)).toThrow(
      "public project matrix drifted",
    );

    const renamed = clone(receipt(0));
    renamed.tests[0]!.project = "invented-project";
    expect(() => assertPlaywrightRunReceipt(renamed)).toThrow(
      "unexpected project",
    );
  });

  it("rejects duplicate test identity within a project", () => {
    const value = clone(receipt(0));
    value.tests[1] = {
      ...value.tests[1]!,
      id: value.tests[0]!.id,
      project: value.tests[0]!.project,
    };
    expect(() => assertPlaywrightRunReceipt(value)).toThrow(
      "duplicate test identity",
    );
  });

  it("rejects a project whose collected tests were all skipped", () => {
    const value = clone(receipt(0));
    const projectName = value.tests[0]!.project;
    const projectTests = value.tests.filter(
      ({ project }) => project === projectName,
    );
    for (const test of projectTests) {
      test.finalStatus = "skipped";
      test.outcome = "skipped";
    }
    const project = value.projects.find(({ name }) => name === projectName);
    if (!project) throw new Error("Synthetic test project was not summarized.");
    project.counts.passed -= projectTests.length;
    project.counts.skipped += projectTests.length;
    value.totals.passed -= projectTests.length;
    value.totals.skipped += projectTests.length;

    expect(() => assertPlaywrightRunReceipt(value)).toThrow(
      "requires at least one passing test per project",
    );
  });

  it("rejects run arithmetic, project summary, and evidence summary tampering", () => {
    const arithmetic = clone(receipt(0));
    arithmetic.totals.collected += 1;
    expect(() => assertPlaywrightRunReceipt(arithmetic)).toThrow(
      "public total result arithmetic drifted",
    );

    const project = clone(receipt(0));
    project.projects[0]!.counts.passed += 1;
    project.projects[0]!.counts.collected += 1;
    expect(() => assertPlaywrightRunReceipt(project)).toThrow(
      "public project summaries drifted",
    );

    const aggregate = clone(evidence());
    aggregate.totals.passed -= 1;
    aggregate.totals.failed += 1;
    expect(() => assertPlaywrightEvidence(aggregate)).toThrow(
      "Playwright evidence totals drifted",
    );
  });

  it.each([
    {
      label: "nonzero exit",
      mutate(value: PlaywrightRunReceipt) {
        value.exitCode = 1;
      },
    },
    {
      label: "failed run",
      mutate(value: PlaywrightRunReceipt) {
        value.runStatus = "failed";
      },
    },
    {
      label: "flaky test",
      mutate(value: PlaywrightRunReceipt) {
        const test = value.tests[0]!;
        test.attempts = 2;
        test.retryCount = 1;
        test.outcome = "flaky";
        const project = value.projects.find(({ name }) => name === test.project);
        if (!project) throw new Error("Synthetic test project was not summarized.");
        project.counts.flaky += 1;
        project.counts.passed -= 1;
        value.totals.flaky += 1;
        value.totals.passed -= 1;
      },
    },
  ])("does not allow $label to claim completion", ({ mutate }) => {
    const value = clone(receipt(0));
    mutate(value);
    value.complete = true;
    expect(() => assertPlaywrightRunReceipt(value)).toThrow(
      "public completion state drifted",
    );
  });

  it("does not count an expected failure as a passing expected outcome", () => {
    const value = clone(receipt(0));
    value.tests[0]!.expectedStatus = "failed";
    value.tests[0]!.finalStatus = "failed";
    expect(() => assertPlaywrightRunReceipt(value)).toThrow(
      "does not treat expected failures as passes",
    );
  });

  it("rejects zero-attempt results and inconsistent retry histories", () => {
    const zeroAttempt = clone(receipt(0));
    zeroAttempt.tests[0]!.attempts = 0;
    expect(() => assertPlaywrightRunReceipt(zeroAttempt)).toThrow(
      "no recorded execution attempt",
    );

    const hiddenRetry = clone(receipt(0));
    hiddenRetry.tests[0]!.attempts = 2;
    expect(() => assertPlaywrightRunReceipt(hiddenRetry)).toThrow(
      "Non-flaky Playwright test has an invalid retry history",
    );

    const disguisedFlake = clone(receipt(0));
    disguisedFlake.tests[0]!.attempts = 2;
    disguisedFlake.tests[0]!.retryCount = 1;
    expect(() => assertPlaywrightRunReceipt(disguisedFlake)).toThrow(
      "Non-flaky Playwright test has an invalid retry history",
    );
  });

  it("rejects source or HEAD drift during one run", () => {
    const changedSource = clone(STATE);
    changedSource.sourceFingerprint.digest = "c".repeat(64);
    expect(() => receipt(0, { completed: changedSource })).toThrow(
      "public evaluated source stability drifted",
    );

    const changedHead = clone(STATE);
    changedHead.headCommit = "d".repeat(40);
    expect(() => receipt(0, { completed: changedHead })).toThrow(
      "public evaluated source stability drifted",
    );
  });

  it("rejects common source drift between suite runs", () => {
    const all = receipts();
    const alternate = clone(STATE);
    alternate.sourceFingerprint.digest = "e".repeat(64);
    all[2] = receipt(2, { completed: alternate, started: alternate });

    expect(() => buildPlaywrightEvidence(all, RUN_ID)).toThrow(
      "fde common evaluated source drifted",
    );
  });

  it("rejects overlapping or out-of-order run windows", () => {
    const all = receipts();
    all[1] = receipt(1, {
      completedAt: "2026-09-03T01:02:30.000Z",
      startedAt: "2026-09-03T01:00:30.000Z",
    });
    expect(() => buildPlaywrightEvidence(all, RUN_ID)).toThrow(
      "run windows overlap or are out of order",
    );
  });

  it("rechecks run-window ordering while parsing aggregate evidence", () => {
    const value = evidence();
    value.runs[1]!.startedAt = "2026-09-03T01:00:30.000Z";
    value.runs[1]!.completedAt = "2026-09-03T01:02:30.000Z";
    const canonicalTampering = `${JSON.stringify(value, null, 2)}\n`;

    expect(() => parseCanonicalPlaywrightEvidence(canonicalTampering)).toThrow(
      "run windows overlap or are out of order",
    );
  });

  it("applies canonical validation to individual run receipts", () => {
    const canonical = serializeCanonicalPlaywrightRunReceipt(receipt(0));
    expect(parseCanonicalPlaywrightRunReceipt(canonical).id).toBe("public");
    expect(() => parseCanonicalPlaywrightRunReceipt(
      canonical.replace(
        '"playwrightVersion": "1.63.0"',
        '"playwrightVersion": "1.63.0"',
      ),
    )).toThrow();
    expect(() => parseCanonicalPlaywrightRunReceipt(canonical.trimEnd())).toThrow(
      /canonical two-space JSON/u,
    );
  });
});

describe("Playwright observation source locations", () => {
  it.each([
    "e2e/example.spec.ts",
    "e2e/nested/example.test.tsx",
  ])("accepts an existing UTF-8 regular test source at %s", (file) => {
    const workspace = createWorkspace();
    writeWorkspaceFile(workspace, file, "first line\nsecond line\n");

    expect(() =>
      assertPlaywrightObservationSourceLocations(workspace, [
        observation("desktop-chromium", 1, { file, line: 2 }),
      ])
    ).not.toThrow();
  });

  it.each([
    {
      expected: /source is missing/u,
      label: "a nonexistent source",
      prepare() {
        return { file: "e2e/missing.spec.ts", line: 1 };
      },
    },
    {
      expected: /line is outside its source/u,
      label: "a line beyond EOF",
      prepare(workspace: string) {
        const file = "e2e/short.spec.ts";
        writeWorkspaceFile(workspace, file, "one\ntwo\n");
        return { file, line: 3 };
      },
    },
    {
      expected: /regular non-symlink file/u,
      label: "a directory",
      prepare(workspace: string) {
        const file = "e2e/directory.spec.ts";
        mkdirSync(resolve(workspace, file));
        return { file, line: 1 };
      },
    },
    {
      expected: /regular non-symlink file/u,
      label: "an in-workspace symlink",
      prepare(workspace: string) {
        const file = "e2e/inside-link.spec.ts";
        writeWorkspaceFile(workspace, "e2e/real.spec.ts", "test();\n");
        symlinkSync("real.spec.ts", resolve(workspace, file));
        return { file, line: 1 };
      },
    },
    {
      expected: /regular non-symlink file/u,
      label: "an out-of-workspace symlink",
      prepare(workspace: string) {
        const externalWorkspace = createWorkspace();
        const externalPath = resolve(externalWorkspace, "outside.spec.ts");
        writeWorkspaceFile(externalWorkspace, "outside.spec.ts", "test();\n");
        const file = "e2e/outside-link.spec.ts";
        symlinkSync(externalPath, resolve(workspace, file));
        return { file, line: 1 };
      },
    },
    {
      expected: /not valid UTF-8/u,
      label: "invalid UTF-8",
      prepare(workspace: string) {
        const file = "e2e/invalid.spec.ts";
        writeWorkspaceFile(workspace, file, Buffer.from([0xc3, 0x28]));
        return { file, line: 1 };
      },
    },
    {
      expected: /exceeds the 2 MiB limit/u,
      label: "an oversized source",
      prepare(workspace: string) {
        const file = "e2e/oversized.spec.ts";
        writeWorkspaceFile(
          workspace,
          file,
          Buffer.alloc(PLAYWRIGHT_TEST_SOURCE_MAX_BYTES + 1, 0x61),
        );
        return { file, line: 1 };
      },
    },
    {
      expected: /does not identify an e2e spec\/test source/u,
      label: "a non-test e2e file",
      prepare(workspace: string) {
        const file = "e2e/helper.ts";
        writeWorkspaceFile(workspace, file, "export {};\n");
        return { file, line: 1 };
      },
    },
  ])("rejects $label", ({ expected, prepare }) => {
    const workspace = createWorkspace();
    const location = prepare(workspace);

    expect(() =>
      assertPlaywrightObservationSourceLocations(workspace, [
        observation("desktop-chromium", 1, location),
      ])
    ).toThrow(expected);
  });
});

describe("Playwright receipt inventory binding", () => {
  it("matches the five stable collection fields and ignores result fields", () => {
    const aggregate = evidence();
    const current = clone(receipt(0));
    for (const test of current.tests) {
      test.attempts = 7;
      test.finalStatus = "failed";
      test.outcome = "unexpected";
      test.retryCount = 6;
    }

    expect(() =>
      assertPlaywrightReceiptInventoryMatchesEvidence(current, aggregate)
    ).not.toThrow();
  });

  it.each([
    {
      label: "project",
      mutate(test: PlaywrightTestObservation) {
        test.project = "mobile-chromium";
      },
    },
    {
      label: "fake ID",
      mutate(test: PlaywrightTestObservation) {
        test.id = "invented_test_id";
      },
    },
    {
      label: "file",
      mutate(test: PlaywrightTestObservation) {
        test.file = "e2e/invented.spec.ts";
      },
    },
    {
      label: "line",
      mutate(test: PlaywrightTestObservation) {
        test.line += 1;
      },
    },
    {
      label: "expected status",
      mutate(test: PlaywrightTestObservation) {
        test.expectedStatus = "skipped";
      },
    },
  ])("rejects $label drift", ({ mutate }) => {
    const current = clone(receipt(0));
    const first = current.tests[0];
    if (!first) throw new Error("Synthetic receipt has no test inventory.");
    mutate(first);

    expect(() =>
      assertPlaywrightReceiptInventoryMatchesEvidence(current, evidence())
    ).toThrow("receipt/checked-in Playwright inventory drifted");
  });

  it("rejects a fake ID inserted into an otherwise valid aggregate", () => {
    const aggregate = clone(evidence());
    const first = aggregate.runs[0]?.tests[0];
    if (!first) throw new Error("Synthetic aggregate has no test inventory.");
    first.id = "invented_aggregate_test_id";
    expect(() => assertPlaywrightEvidence(aggregate)).not.toThrow();

    expect(() =>
      assertPlaywrightReceiptInventoryMatchesEvidence(receipt(0), aggregate)
    ).toThrow("receipt/checked-in Playwright inventory drifted");
  });

  it("rejects an omitted test even when the fresh receipt is internally valid", () => {
    const baseline = receipt(0);
    const omitted = receipt(0, { tests: baseline.tests.slice(1) });
    expect(() => assertPlaywrightRunReceipt(omitted)).not.toThrow();

    expect(() =>
      assertPlaywrightReceiptInventoryMatchesEvidence(omitted, evidence())
    ).toThrow("receipt/checked-in Playwright inventory drifted");
  });

  it("rejects an internally valid aggregate with an omitted inventory row", () => {
    const aggregateReceipts = receipts();
    const publicReceipt = aggregateReceipts[0];
    if (!publicReceipt) throw new Error("Synthetic public receipt is missing.");
    aggregateReceipts[0] = receipt(0, {
      tests: publicReceipt.tests.slice(1),
    });
    const aggregate = buildPlaywrightEvidence(aggregateReceipts, RUN_ID);

    expect(() =>
      assertPlaywrightReceiptInventoryMatchesEvidence(receipt(0), aggregate)
    ).toThrow("receipt/checked-in Playwright inventory drifted");
  });
});
