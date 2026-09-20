import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  opendirSync,
  readlinkSync,
  readSync,
  realpathSync,
  type BigIntStats,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  normalize,
  resolve,
  sep,
} from "node:path";

import { z } from "zod";

export const PNPM_INSTALLATION_STATE_VERSION =
  "diesel-pnpm-installation-state-v1" as const;
export const EXPECTED_PNPM_INSTALLATION_PACKAGE_MANAGER =
  "pnpm@11.9.0" as const;
export const EXPECTED_PNPM_VIRTUAL_STORE_DIRECTORY = ".pnpm" as const;
export const EXPECTED_PNPM_STORE_VERSION_DIRECTORY = "v11" as const;

export const PNPM_MODULES_MANIFEST_MAX_BYTES = 2 * 1024 * 1024;
export const PNPM_WORKSPACE_STATE_MAX_BYTES = 2 * 1024 * 1024;
export const PNPM_LOCKFILE_MAX_BYTES = 16 * 1024 * 1024;
export const PNPM_NODE_MODULES_MAX_ENTRIES = 250_000;
const PNPM_NODE_MODULES_MAX_PATH_BYTES = 4_096;
const PNPM_NODE_MODULES_MAX_LINK_TARGET_BYTES = 4_096;
const PNPM_NODE_MODULES_MAX_TOTAL_PATH_BYTES = 64 * 1024 * 1024;

const installationFileContracts = [
  {
    key: "modulesManifest",
    maxBytes: PNPM_MODULES_MANIFEST_MAX_BYTES,
    relativePath: "node_modules/.modules.yaml",
  },
  {
    key: "workspaceState",
    maxBytes: PNPM_WORKSPACE_STATE_MAX_BYTES,
    relativePath: "node_modules/.pnpm-workspace-state-v1.json",
  },
  {
    key: "virtualStoreLockfile",
    maxBytes: PNPM_LOCKFILE_MAX_BYTES,
    relativePath: "node_modules/.pnpm/lock.yaml",
  },
  {
    key: "rootLockfile",
    maxBytes: PNPM_LOCKFILE_MAX_BYTES,
    relativePath: "pnpm-lock.yaml",
  },
] as const;

type InstallationFileKey =
  (typeof installationFileContracts)[number]["key"];

export type PnpmInstallationFileObservation = Readonly<{
  bytes: Buffer;
  ctimeNs: bigint;
  dev: bigint;
  gid: bigint;
  ino: bigint;
  mode: bigint;
  mtimeNs: bigint;
  nlink: bigint;
  relativePath: string;
  size: bigint;
  uid: bigint;
}>;

export type PnpmInstallationDirectoryObservation = Readonly<{
  ctimeNs: bigint;
  dev: bigint;
  gid: bigint;
  ino: bigint;
  mode: bigint;
  mtimeNs: bigint;
  nlink: bigint;
  path: string;
  size: bigint;
  uid: bigint;
}>;

type PnpmNodeModulesEntryBase = Readonly<{
  ctimeNs: bigint;
  dev: bigint;
  gid: bigint;
  ino: bigint;
  mode: bigint;
  mtimeNs: bigint;
  nlink: bigint;
  path: string;
  size: bigint;
  uid: bigint;
}>;

export type PnpmNodeModulesEntryObservation =
  | (PnpmNodeModulesEntryBase & Readonly<{ type: "directory" | "file" }>)
  | (PnpmNodeModulesEntryBase & Readonly<{
      target: string;
      type: "symlink";
    }>);

export type PnpmInstallationState = Readonly<{
  files: Readonly<Record<InstallationFileKey, PnpmInstallationFileObservation>>;
  /**
   * Complete metadata-only closure of node_modules. Package bytes are not
   * hashed; regular-file identity, size and write metadata are bound instead.
   */
  nodeModulesClosure: readonly PnpmNodeModulesEntryObservation[];
  packageManager: typeof EXPECTED_PNPM_INSTALLATION_PACKAGE_MANAGER;
  storeDirectory: PnpmInstallationDirectoryObservation;
  /**
   * Exact, already-versioned value accepted by pnpm's `store-dir` config.
   * Callers must pass this value as-is; pnpm detects the trailing `v11` and
   * does not append a second store-version directory.
   */
  storeDirConfigValue: string;
  version: typeof PNPM_INSTALLATION_STATE_VERSION;
  virtualStoreDir: typeof EXPECTED_PNPM_VIRTUAL_STORE_DIRECTORY;
  workspace: string;
}>;

const modulesManifestSchema = z.object({
  packageManager: z.literal(EXPECTED_PNPM_INSTALLATION_PACKAGE_MANAGER),
  storeDir: z.string().min(1).max(4_096),
  virtualStoreDir: z.literal(EXPECTED_PNPM_VIRTUAL_STORE_DIRECTORY),
}).passthrough();

const workspaceStateSchema = z.object({}).passthrough();

type FileContract = (typeof installationFileContracts)[number];
type FileObservations = Record<
  InstallationFileKey,
  PnpmInstallationFileObservation
>;

type BigIntMetadataIdentity = Pick<
  BigIntStats,
  | "ctimeNs"
  | "dev"
  | "gid"
  | "ino"
  | "mode"
  | "mtimeNs"
  | "nlink"
  | "size"
  | "uid"
>;

function sameFileMetadata(
  left: BigIntMetadataIdentity,
  right: BigIntMetadataIdentity,
): boolean {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.uid === right.uid &&
    left.gid === right.gid;
}

function compareText(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function assertSafeNodeModulesPath(path: string): void {
  if (
    path.length === 0 ||
    Buffer.byteLength(path, "utf8") > PNPM_NODE_MODULES_MAX_PATH_BYTES ||
    path.includes("\\") ||
    /[\u0000-\u001f\u007f\ufffd]/u.test(path) ||
    path.split("/").some((segment) =>
      segment === "" || segment === "." || segment === ".."
    )
  ) {
    throw new Error(`Pnpm node_modules closure contains an unsafe path: ${path}.`);
  }
}

function entryFromMetadata(
  path: string,
  metadata: BigIntStats,
  type: "directory" | "file",
): PnpmNodeModulesEntryObservation {
  return {
    ctimeNs: metadata.ctimeNs,
    dev: metadata.dev,
    gid: metadata.gid,
    ino: metadata.ino,
    mode: metadata.mode,
    mtimeNs: metadata.mtimeNs,
    nlink: metadata.nlink,
    path,
    size: metadata.size,
    type,
    uid: metadata.uid,
  };
}

function assertStableEntryMetadata(
  before: BigIntStats,
  after: BigIntStats,
  path: string,
): void {
  if (!sameFileMetadata(before, after)) {
    throw new Error(`Pnpm node_modules entry changed while read: ${path}.`);
  }
}

function readBoundedDirectoryNames(
  absolutePath: string,
  maximumEntries: number,
): string[] {
  const directory = opendirSync(absolutePath);
  const names: string[] = [];
  try {
    while (true) {
      const entry = directory.readSync();
      if (entry === null) break;
      if (names.length >= maximumEntries) {
        throw new Error("Pnpm node_modules closure exceeds its entry limit.");
      }
      names.push(entry.name);
    }
  } finally {
    directory.closeSync();
  }
  return names.sort(compareText);
}

function captureNodeModulesClosure(
  workspace: string,
): readonly PnpmNodeModulesEntryObservation[] {
  const rootPath = resolve(workspace, "node_modules");
  let physicalRoot: string;
  try {
    physicalRoot = realpathSync(rootPath);
  } catch (cause: unknown) {
    throw new Error("Pnpm node_modules root is unavailable.", { cause });
  }
  if (physicalRoot !== rootPath) {
    throw new Error("Pnpm node_modules root must be a physical directory.");
  }

  const pendingDirectories: Array<Readonly<{
    absolutePath: string;
    relativePath: string;
  }>> = [{ absolutePath: rootPath, relativePath: "node_modules" }];
  const observations: PnpmNodeModulesEntryObservation[] = [];
  let totalPathBytes = Buffer.byteLength("node_modules", "utf8");
  while (pendingDirectories.length > 0) {
    const current = pendingDirectories.pop();
    if (current === undefined) break;
    assertSafeNodeModulesPath(current.relativePath);
    const before = lstatSync(current.absolutePath, { bigint: true });
    if (before.isSymbolicLink() || !before.isDirectory()) {
      throw new Error(
        `Pnpm node_modules directory must remain physical: ${current.relativePath}.`,
      );
    }
    const remainingEntryBudget = PNPM_NODE_MODULES_MAX_ENTRIES -
      observations.length - pendingDirectories.length - 1;
    if (remainingEntryBudget < 0) {
      throw new Error("Pnpm node_modules closure exceeds its entry limit.");
    }
    const names = readBoundedDirectoryNames(
      current.absolutePath,
      remainingEntryBudget,
    );
    const childDirectories: Array<Readonly<{
      absolutePath: string;
      relativePath: string;
    }>> = [];
    for (const name of names) {
      if (
        name.length === 0 ||
        name === "." ||
        name === ".." ||
        name.includes("/") ||
        name.includes("\\") ||
        /[\u0000-\u001f\u007f\ufffd]/u.test(name)
      ) {
        throw new Error("Pnpm node_modules contains an unsafe entry name.");
      }
      const relativePath = `${current.relativePath}/${name}`;
      assertSafeNodeModulesPath(relativePath);
      totalPathBytes += Buffer.byteLength(relativePath, "utf8");
      if (totalPathBytes > PNPM_NODE_MODULES_MAX_TOTAL_PATH_BYTES) {
        throw new Error(
          "Pnpm node_modules closure exceeds its total path-byte limit.",
        );
      }
      const absolutePath = resolve(current.absolutePath, name);
      if (!absolutePath.startsWith(`${rootPath}${sep}`)) {
        throw new Error(
          `Pnpm node_modules entry escaped its root: ${relativePath}.`,
        );
      }
      const childBefore = lstatSync(absolutePath, { bigint: true });
      if (childBefore.isDirectory()) {
        childDirectories.push({ absolutePath, relativePath });
        continue;
      }
      if (childBefore.isFile()) {
        const childAfter = lstatSync(absolutePath, { bigint: true });
        assertStableEntryMetadata(childBefore, childAfter, relativePath);
        observations.push(entryFromMetadata(relativePath, childAfter, "file"));
        continue;
      }
      if (childBefore.isSymbolicLink()) {
        const target = readlinkSync(absolutePath, { encoding: "utf8" });
        const childAfter = lstatSync(absolutePath, { bigint: true });
        assertStableEntryMetadata(childBefore, childAfter, relativePath);
        if (
          target.length === 0 ||
          isAbsolute(target) ||
          Buffer.byteLength(target, "utf8") >
            PNPM_NODE_MODULES_MAX_LINK_TARGET_BYTES ||
          /[\u0000-\u001f\u007f\ufffd]/u.test(target) ||
          !resolve(dirname(absolutePath), target).startsWith(`${rootPath}${sep}`)
        ) {
          throw new Error(
            `Pnpm node_modules symlink must have a contained relative target: ${relativePath}.`,
          );
        }
        observations.push({
          ...entryFromMetadata(relativePath, childAfter, "file"),
          target,
          type: "symlink",
        });
        continue;
      }
      throw new Error(
        `Pnpm node_modules contains an unsupported entry type: ${relativePath}.`,
      );
    }
    const after = lstatSync(current.absolutePath, { bigint: true });
    assertStableEntryMetadata(before, after, current.relativePath);
    observations.push(entryFromMetadata(
      current.relativePath,
      after,
      "directory",
    ));
    for (let index = childDirectories.length - 1; index >= 0; index -= 1) {
      const child = childDirectories[index];
      if (child !== undefined) pendingDirectories.push(child);
    }
  }
  observations.sort((left, right) => compareText(left.path, right.path));
  if (
    observations.length === 0 ||
    observations.length > PNPM_NODE_MODULES_MAX_ENTRIES
  ) {
    throw new Error("Pnpm node_modules closure is empty or too large.");
  }
  return observations;
}

function readBoundedDescriptor(
  fileDescriptor: number,
  expectedSize: number,
  label: string,
): Buffer {
  const bytes = Buffer.alloc(expectedSize);
  let offset = 0;
  while (offset < bytes.byteLength) {
    const bytesRead = readSync(
      fileDescriptor,
      bytes,
      offset,
      bytes.byteLength - offset,
      null,
    );
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  if (offset !== expectedSize) {
    throw new Error(`${label} ended before its observed size.`);
  }
  return bytes;
}

function readStableInstallationFile(
  workspace: string,
  contract: FileContract,
): PnpmInstallationFileObservation {
  const absolutePath = resolve(workspace, contract.relativePath);
  if (
    absolutePath !== workspace &&
    !absolutePath.startsWith(`${workspace}${sep}`)
  ) {
    throw new Error(
      `Pnpm installation file escaped the workspace: ${contract.relativePath}.`,
    );
  }

  let pathBefore: BigIntStats;
  let physicalPath: string;
  try {
    pathBefore = lstatSync(absolutePath, { bigint: true });
    physicalPath = realpathSync(absolutePath);
  } catch (cause: unknown) {
    throw new Error(
      `Pnpm installation file is missing: ${contract.relativePath}.`,
      { cause },
    );
  }
  if (
    pathBefore.isSymbolicLink() ||
    !pathBefore.isFile() ||
    pathBefore.nlink !== 1n ||
    physicalPath !== absolutePath ||
    pathBefore.size <= 0n ||
    pathBefore.size > BigInt(contract.maxBytes)
  ) {
    throw new Error(
      `Pnpm installation file must be a bounded, single-link, physical regular file: ${contract.relativePath}.`,
    );
  }

  if (
    typeof constants.O_NOFOLLOW !== "number" ||
    typeof constants.O_NONBLOCK !== "number"
  ) {
    throw new Error(
      "Pnpm installation files require O_NOFOLLOW and O_NONBLOCK support.",
    );
  }
  const fileDescriptor = openSync(
    absolutePath,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = fstatSync(fileDescriptor, { bigint: true });
    if (!before.isFile() || !sameFileMetadata(before, pathBefore)) {
      throw new Error(
        `Pnpm installation file changed before read: ${contract.relativePath}.`,
      );
    }
    const bytes = readBoundedDescriptor(
      fileDescriptor,
      Number(before.size),
      `Pnpm installation file ${contract.relativePath}`,
    );
    const after = fstatSync(fileDescriptor, { bigint: true });
    const pathAfter = lstatSync(absolutePath, { bigint: true });
    if (
      !sameFileMetadata(before, after) ||
      !sameFileMetadata(after, pathAfter) ||
      BigInt(bytes.byteLength) !== after.size
    ) {
      throw new Error(
        `Pnpm installation file changed while read: ${contract.relativePath}.`,
      );
    }
    return {
      bytes,
      ctimeNs: after.ctimeNs,
      dev: after.dev,
      gid: after.gid,
      ino: after.ino,
      mode: after.mode,
      mtimeNs: after.mtimeNs,
      nlink: after.nlink,
      relativePath: contract.relativePath,
      size: after.size,
      uid: after.uid,
    };
  } finally {
    closeSync(fileDescriptor);
  }
}

function decodeUtf8(bytes: Buffer, label: string): string {
  try {
    return new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
  } catch (cause: unknown) {
    throw new Error(`${label} is not valid UTF-8.`, { cause });
  }
}

function parseJson(bytes: Buffer, label: string): unknown {
  try {
    return JSON.parse(decodeUtf8(bytes, label)) as unknown;
  } catch (cause: unknown) {
    if (cause instanceof Error && cause.message === `${label} is not valid UTF-8.`) {
      throw cause;
    }
    throw new Error(`${label} is not valid JSON.`, { cause });
  }
}

function observePhysicalStoreDirectory(
  configuredPath: string,
): PnpmInstallationDirectoryObservation {
  if (
    !isAbsolute(configuredPath) ||
    normalize(configuredPath) !== configuredPath ||
    basename(configuredPath) !== EXPECTED_PNPM_STORE_VERSION_DIRECTORY
  ) {
    throw new Error(
      "Pnpm installation storeDir must be a normalized absolute v11 path.",
    );
  }
  let before: BigIntStats;
  let physicalPath: string;
  try {
    before = lstatSync(configuredPath, { bigint: true });
    physicalPath = realpathSync(configuredPath);
  } catch (cause: unknown) {
    throw new Error("Pnpm installation storeDir is unavailable.", { cause });
  }
  const after = lstatSync(configuredPath, { bigint: true });
  if (
    before.isSymbolicLink() ||
    !before.isDirectory() ||
    physicalPath !== configuredPath ||
    !sameFileMetadata(before, after)
  ) {
    throw new Error(
      "Pnpm installation storeDir must be a stable physical directory.",
    );
  }
  return {
    ctimeNs: after.ctimeNs,
    dev: after.dev,
    gid: after.gid,
    ino: after.ino,
    mode: after.mode,
    mtimeNs: after.mtimeNs,
    nlink: after.nlink,
    path: configuredPath,
    size: after.size,
    uid: after.uid,
  };
}

function readInstallationFiles(workspace: string): FileObservations {
  return Object.fromEntries(
    installationFileContracts.map((contract) => [
      contract.key,
      readStableInstallationFile(workspace, contract),
    ]),
  ) as FileObservations;
}

function sameObservation(
  left: PnpmInstallationFileObservation,
  right: PnpmInstallationFileObservation,
): boolean {
  return left.relativePath === right.relativePath &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.uid === right.uid &&
    left.gid === right.gid &&
    left.bytes.equals(right.bytes);
}

function sameDirectoryObservation(
  left: PnpmInstallationDirectoryObservation,
  right: PnpmInstallationDirectoryObservation,
): boolean {
  return left.path === right.path &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.uid === right.uid &&
    left.gid === right.gid;
}

function sameNodeModulesEntry(
  left: PnpmNodeModulesEntryObservation,
  right: PnpmNodeModulesEntryObservation,
): boolean {
  return left.type === right.type &&
    left.path === right.path &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.uid === right.uid &&
    left.gid === right.gid &&
    (left.type !== "symlink" ||
      (right.type === "symlink" && left.target === right.target));
}

function assertNodeModulesClosuresEqual(
  first: readonly PnpmNodeModulesEntryObservation[],
  second: readonly PnpmNodeModulesEntryObservation[],
  label: string,
): void {
  if (first.length !== second.length) {
    throw new Error(`${label} entry count changed.`);
  }
  for (let index = 0; index < first.length; index += 1) {
    const left = first[index];
    const right = second[index];
    if (left === undefined || right === undefined ||
      !sameNodeModulesEntry(left, right)) {
      throw new Error(
        `${label} changed: ${left?.path ?? right?.path ?? "[unknown]"}.`,
      );
    }
  }
}

function observeNodeModulesRoot(workspace: string): BigIntStats {
  const rootPath = resolve(workspace, "node_modules");
  const metadata = lstatSync(rootPath, { bigint: true });
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    realpathSync(rootPath) !== rootPath
  ) {
    throw new Error("Pnpm node_modules root must be a physical directory.");
  }
  return metadata;
}

function assertNodeModulesRootBoundToClosure(
  before: BigIntStats,
  after: BigIntStats,
  closure: readonly PnpmNodeModulesEntryObservation[],
  label: string,
): void {
  const root = closure.find((entry) => entry.path === "node_modules");
  if (
    root === undefined ||
    root.type !== "directory" ||
    !sameFileMetadata(before, after) ||
    !sameFileMetadata(after, root)
  ) {
    throw new Error(`${label} node_modules root identity changed.`);
  }
}

function assertInstallationFilesBoundToClosure(
  files: FileObservations,
  closure: readonly PnpmNodeModulesEntryObservation[],
  label: string,
): void {
  for (const key of [
    "modulesManifest",
    "workspaceState",
    "virtualStoreLockfile",
  ] as const) {
    const observation = files[key];
    const entry = closure.find(({ path }) =>
      path === observation.relativePath
    );
    if (
      entry === undefined ||
      entry.type !== "file" ||
      !sameFileMetadata(observation, entry)
    ) {
      throw new Error(
        `${label} is not bound to ${observation.relativePath} in the node_modules closure.`,
      );
    }
  }
}

function assertPassesEqual(
  firstFiles: FileObservations,
  secondFiles: FileObservations,
): void {
  for (const { key, relativePath } of installationFileContracts) {
    if (!sameObservation(firstFiles[key], secondFiles[key])) {
      throw new Error(
        `Pnpm installation state changed while captured: ${relativePath}.`,
      );
    }
  }
}

function validateInstallationState(
  files: FileObservations,
): Omit<
  PnpmInstallationState,
  "files" | "nodeModulesClosure" | "version" | "workspace"
> {
  const modulesManifest = modulesManifestSchema.parse(parseJson(
    files.modulesManifest.bytes,
    "Pnpm modules manifest",
  ));
  workspaceStateSchema.parse(parseJson(
    files.workspaceState.bytes,
    "Pnpm workspace state",
  ));
  if (!files.virtualStoreLockfile.bytes.equals(files.rootLockfile.bytes)) {
    throw new Error(
      "Pnpm virtual-store lockfile does not byte-match the root lockfile.",
    );
  }
  const firstStoreDirectory = observePhysicalStoreDirectory(
    modulesManifest.storeDir,
  );
  const secondStoreDirectory = observePhysicalStoreDirectory(
    modulesManifest.storeDir,
  );
  if (!sameDirectoryObservation(firstStoreDirectory, secondStoreDirectory)) {
    throw new Error("Pnpm installation storeDir changed while captured.");
  }
  return {
    packageManager: modulesManifest.packageManager,
    storeDirectory: firstStoreDirectory,
    storeDirConfigValue: modulesManifest.storeDir,
    virtualStoreDir: modulesManifest.virtualStoreDir,
  };
}

export function capturePnpmInstallationState(
  workspaceInput: string,
): PnpmInstallationState {
  const configuredWorkspace = resolve(workspaceInput);
  let workspace: string;
  try {
    workspace = realpathSync(configuredWorkspace);
  } catch (cause: unknown) {
    throw new Error("Pnpm installation workspace is unavailable.", { cause });
  }
  if (workspace !== configuredWorkspace) {
    throw new Error(
      "Pnpm installation workspace must be a physical directory without symlink traversal.",
    );
  }

  const firstRootBefore = observeNodeModulesRoot(workspace);
  const firstFiles = readInstallationFiles(workspace);
  const firstNodeModulesClosure = captureNodeModulesClosure(workspace);
  const firstRootAfter = observeNodeModulesRoot(workspace);
  assertNodeModulesRootBoundToClosure(
    firstRootBefore,
    firstRootAfter,
    firstNodeModulesClosure,
    "First pnpm installation pass",
  );
  assertInstallationFilesBoundToClosure(
    firstFiles,
    firstNodeModulesClosure,
    "First pnpm installation pass",
  );
  const validated = validateInstallationState(firstFiles);
  const secondRootBefore = observeNodeModulesRoot(workspace);
  const secondFiles = readInstallationFiles(workspace);
  const secondNodeModulesClosure = captureNodeModulesClosure(workspace);
  const secondRootAfter = observeNodeModulesRoot(workspace);
  assertNodeModulesRootBoundToClosure(
    secondRootBefore,
    secondRootAfter,
    secondNodeModulesClosure,
    "Second pnpm installation pass",
  );
  assertInstallationFilesBoundToClosure(
    secondFiles,
    secondNodeModulesClosure,
    "Second pnpm installation pass",
  );
  if (!sameFileMetadata(firstRootBefore, secondRootAfter)) {
    throw new Error("Pnpm node_modules root changed while captured.");
  }
  assertPassesEqual(firstFiles, secondFiles);
  assertNodeModulesClosuresEqual(
    firstNodeModulesClosure,
    secondNodeModulesClosure,
    "Pnpm node_modules closure during capture",
  );
  const finalValidated = validateInstallationState(secondFiles);
  if (
    validated.packageManager !== finalValidated.packageManager ||
    validated.storeDirConfigValue !== finalValidated.storeDirConfigValue ||
    validated.virtualStoreDir !== finalValidated.virtualStoreDir ||
    !sameDirectoryObservation(
      validated.storeDirectory,
      finalValidated.storeDirectory,
    )
  ) {
    throw new Error("Pnpm installation metadata changed while captured.");
  }

  return {
    ...validated,
    files: firstFiles,
    nodeModulesClosure: firstNodeModulesClosure,
    version: PNPM_INSTALLATION_STATE_VERSION,
    workspace,
  };
}

export function pnpmStoreDirConfigArgument(
  state: Pick<PnpmInstallationState, "storeDirConfigValue">,
): string {
  return `--config.store-dir=${state.storeDirConfigValue}`;
}

export function assertPnpmInstallationStateUnchanged(
  started: PnpmInstallationState,
  completed: PnpmInstallationState,
  label = "Pnpm installation state",
): void {
  if (
    started.version !== completed.version ||
    started.workspace !== completed.workspace ||
    started.packageManager !== completed.packageManager ||
    started.storeDirConfigValue !== completed.storeDirConfigValue ||
    started.virtualStoreDir !== completed.virtualStoreDir ||
    !sameDirectoryObservation(
      started.storeDirectory,
      completed.storeDirectory,
    )
  ) {
    throw new Error(`${label} metadata or store directory changed.`);
  }
  for (const { key, relativePath } of installationFileContracts) {
    if (!sameObservation(started.files[key], completed.files[key])) {
      throw new Error(`${label} changed: ${relativePath}.`);
    }
  }
  assertNodeModulesClosuresEqual(
    started.nodeModulesClosure,
    completed.nodeModulesClosure,
    `${label} node_modules closure`,
  );
}
