import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  EXPECTED_PNPM_INSTALLATION_PACKAGE_MANAGER,
  EXPECTED_PNPM_VIRTUAL_STORE_DIRECTORY,
  PNPM_INSTALLATION_STATE_VERSION,
  PNPM_MODULES_MANIFEST_MAX_BYTES,
  assertPnpmInstallationStateUnchanged,
  capturePnpmInstallationState,
  pnpmStoreDirConfigArgument,
} from "../scripts/portfolio/pnpm-installation-state";

const temporaryDirectories: string[] = [];

function writeFixtureFile(
  workspace: string,
  relativePath: string,
  contents: string | Buffer,
): void {
  const path = resolve(workspace, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function createInstallationFixture(): Readonly<{
  storeDir: string;
  workspace: string;
}> {
  const workspace = mkdtempSync(join(tmpdir(), "diesel-pnpm-state-test-"));
  const physicalWorkspace = realpathSync(workspace);
  temporaryDirectories.push(physicalWorkspace);
  const storeDir = resolve(physicalWorkspace, "store/v11");
  mkdirSync(storeDir, { recursive: true });
  writeFixtureFile(
    physicalWorkspace,
    "node_modules/.modules.yaml",
    `${JSON.stringify({
      layoutVersion: 5,
      packageManager: EXPECTED_PNPM_INSTALLATION_PACKAGE_MANAGER,
      storeDir,
      virtualStoreDir: EXPECTED_PNPM_VIRTUAL_STORE_DIRECTORY,
      virtualStoreDirMaxLength: 120,
    }, null, 2)}\n`,
  );
  writeFixtureFile(
    physicalWorkspace,
    "node_modules/.pnpm-workspace-state-v1.json",
    `${JSON.stringify({
      filteredInstall: false,
      lastValidatedTimestamp: 1,
      projects: {},
      settings: {},
    }, null, 2)}\n`,
  );
  writeFixtureFile(
    physicalWorkspace,
    "node_modules/.pnpm/example@1.0.0/node_modules/example/index.js",
    "export const value = 1;\n",
  );
  mkdirSync(resolve(physicalWorkspace, "node_modules/.bin"), {
    recursive: true,
  });
  symlinkSync(
    "../.pnpm/example@1.0.0/node_modules/example/index.js",
    resolve(physicalWorkspace, "node_modules/.bin/example"),
  );
  const lockfile = "lockfileVersion: '9.0'\npackages: {}\n";
  writeFixtureFile(physicalWorkspace, "pnpm-lock.yaml", lockfile);
  writeFixtureFile(
    physicalWorkspace,
    "node_modules/.pnpm/lock.yaml",
    lockfile,
  );
  return { storeDir, workspace: physicalWorkspace };
}

function replaceModulesManifest(
  workspace: string,
  update: (manifest: Record<string, unknown>) => void,
): void {
  const path = resolve(workspace, "node_modules/.modules.yaml");
  const manifest = JSON.parse(readFileSync(path, "utf8")) as Record<
    string,
    unknown
  >;
  update(manifest);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const path = temporaryDirectories.pop();
    if (path !== undefined) {
      rmSync(path, { force: true, recursive: true });
    }
  }
});

describe("pnpm installation-state snapshot", () => {
  it("captures the four control files and exposes an exact versioned store config", () => {
    const { storeDir, workspace } = createInstallationFixture();

    const state = capturePnpmInstallationState(workspace);

    expect(state.version).toBe(PNPM_INSTALLATION_STATE_VERSION);
    expect(state.workspace).toBe(workspace);
    expect(state.packageManager).toBe("pnpm@11.9.0");
    expect(state.virtualStoreDir).toBe(".pnpm");
    expect(state.storeDirConfigValue).toBe(storeDir);
    expect(pnpmStoreDirConfigArgument(state)).toBe(
      `--config.store-dir=${storeDir}`,
    );
    expect(Object.keys(state.files).sort()).toEqual([
      "modulesManifest",
      "rootLockfile",
      "virtualStoreLockfile",
      "workspaceState",
    ]);
    expect(state.files.rootLockfile.bytes.equals(
      state.files.virtualStoreLockfile.bytes,
    )).toBe(true);
    expect(state.nodeModulesClosure.some((entry) =>
      entry.path === "node_modules/.bin/example" &&
      entry.type === "symlink" &&
      entry.target ===
        "../.pnpm/example@1.0.0/node_modules/example/index.js"
    )).toBe(true);
    expect(state.nodeModulesClosure.some((entry) =>
      entry.path ===
        "node_modules/.pnpm/example@1.0.0/node_modules/example/index.js" &&
      entry.type === "file"
    )).toBe(true);
    expect(() => assertPnpmInstallationStateUnchanged(state, state)).not
      .toThrow();
  });

  it.each([
    {
      label: "modules manifest",
      path: "node_modules/.modules.yaml",
    },
    {
      label: "workspace state",
      path: "node_modules/.pnpm-workspace-state-v1.json",
    },
  ])("rejects malformed JSON in the $label", ({ path }) => {
    const { workspace } = createInstallationFixture();
    writeFixtureFile(workspace, path, "{not-json}\n");

    expect(() => capturePnpmInstallationState(workspace)).toThrow(
      /not valid JSON/u,
    );
  });

  it.each([
    {
      field: "packageManager",
      value: "pnpm@11.8.0",
    },
    {
      field: "virtualStoreDir",
      value: "node_modules/.pnpm",
    },
    {
      field: "storeDir",
      value: "store/v11",
    },
    {
      field: "storeDir",
      value: "/tmp/not-versioned-store",
    },
  ])("rejects invalid exact modules metadata: $field=$value", ({
    field,
    value,
  }) => {
    const { workspace } = createInstallationFixture();
    replaceModulesManifest(workspace, (manifest) => {
      manifest[field] = value;
    });

    expect(() => capturePnpmInstallationState(workspace)).toThrow();
  });

  it("rejects a storeDir that traverses a symlink", () => {
    const { workspace } = createInstallationFixture();
    const realStoreParent = resolve(workspace, "real-store");
    mkdirSync(resolve(realStoreParent, "v11"), { recursive: true });
    symlinkSync(realStoreParent, resolve(workspace, "linked-store"));
    replaceModulesManifest(workspace, (manifest) => {
      manifest.storeDir = resolve(workspace, "linked-store/v11");
    });

    expect(() => capturePnpmInstallationState(workspace)).toThrow(
      /physical directory/u,
    );
  });

  it("rejects a symlinked installation control file", () => {
    const { workspace } = createInstallationFixture();
    const modulesPath = resolve(workspace, "node_modules/.modules.yaml");
    const targetPath = resolve(workspace, "modules-target.json");
    writeFileSync(targetPath, readFileSync(modulesPath));
    unlinkSync(modulesPath);
    symlinkSync(targetPath, modulesPath);

    expect(() => capturePnpmInstallationState(workspace)).toThrow(
      /physical regular file/u,
    );
  });

  it("rejects an oversized installation control file before reading it", () => {
    const { workspace } = createInstallationFixture();
    writeFixtureFile(
      workspace,
      "node_modules/.modules.yaml",
      Buffer.alloc(PNPM_MODULES_MANIFEST_MAX_BYTES + 1, 0x20),
    );

    expect(() => capturePnpmInstallationState(workspace)).toThrow(
      /bounded/u,
    );
  });

  it("rejects a virtual-store lockfile that differs from the root lockfile", () => {
    const { workspace } = createInstallationFixture();
    writeFixtureFile(
      workspace,
      "node_modules/.pnpm/lock.yaml",
      "lockfileVersion: '9.0'\npackages:\n  changed: {}\n",
    );

    expect(() => capturePnpmInstallationState(workspace)).toThrow(
      /does not byte-match/u,
    );
  });

  it("detects changed raw bytes between the start and completion snapshots", () => {
    const { workspace } = createInstallationFixture();
    const started = capturePnpmInstallationState(workspace);
    writeFixtureFile(
      workspace,
      "node_modules/.pnpm-workspace-state-v1.json",
      `${JSON.stringify({ changed: true }, null, 2)}\n`,
    );
    const completed = capturePnpmInstallationState(workspace);

    expect(() => assertPnpmInstallationStateUnchanged(started, completed))
      .toThrow(/pnpm-workspace-state-v1\.json/u);
  });

  it("detects an inode replacement even when the replacement bytes are equal", () => {
    const { workspace } = createInstallationFixture();
    const started = capturePnpmInstallationState(workspace);
    const lockPath = resolve(workspace, "pnpm-lock.yaml");
    const replacementPath = resolve(workspace, "replacement-lock.yaml");
    writeFileSync(replacementPath, readFileSync(lockPath));
    renameSync(replacementPath, lockPath);
    const completed = capturePnpmInstallationState(workspace);

    expect(completed.files.rootLockfile.bytes.equals(
      started.files.rootLockfile.bytes,
    )).toBe(true);
    expect(completed.files.rootLockfile.ino).not.toBe(
      started.files.rootLockfile.ino,
    );
    expect(() => assertPnpmInstallationStateUnchanged(started, completed))
      .toThrow(/pnpm-lock\.yaml/u);
  });

  it("detects package-file metadata drift in the recursive node_modules closure", () => {
    const { workspace } = createInstallationFixture();
    const started = capturePnpmInstallationState(workspace);
    writeFixtureFile(
      workspace,
      "node_modules/.pnpm/example@1.0.0/node_modules/example/index.js",
      "export const value = 2;\n",
    );
    const completed = capturePnpmInstallationState(workspace);

    expect(() => assertPnpmInstallationStateUnchanged(started, completed))
      .toThrow(/example\/index\.js/u);
  });

  it("detects physical store-root metadata drift", () => {
    const { storeDir, workspace } = createInstallationFixture();
    const started = capturePnpmInstallationState(workspace);
    mkdirSync(resolve(storeDir, "new-entry"));
    const completed = capturePnpmInstallationState(workspace);

    expect(() => assertPnpmInstallationStateUnchanged(started, completed))
      .toThrow(/metadata or store directory changed/u);
  });

  it("detects a directory inode replacement in the node_modules closure", () => {
    const { workspace } = createInstallationFixture();
    const started = capturePnpmInstallationState(workspace);
    const packageDirectory = resolve(
      workspace,
      "node_modules/.pnpm/example@1.0.0/node_modules/example",
    );
    const oldPackageDirectory = resolve(workspace, "old-example-package");
    renameSync(packageDirectory, oldPackageDirectory);
    mkdirSync(packageDirectory, { recursive: true });
    writeFileSync(
      resolve(packageDirectory, "index.js"),
      readFileSync(resolve(oldPackageDirectory, "index.js")),
    );
    const completed = capturePnpmInstallationState(workspace);

    expect(() => assertPnpmInstallationStateUnchanged(started, completed))
      .toThrow(/node_modules closure changed/u);
  });
});
