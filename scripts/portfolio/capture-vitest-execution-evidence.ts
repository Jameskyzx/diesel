import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  accessSync,
  chownSync,
  chmodSync,
  constants,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { rename, rm, writeFile } from "node:fs/promises";
import {
  delimiter,
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import { formatErrorTree } from "../format-error";
import { runTrustedGit } from "./trusted-git";
import { assertVerificationEqual } from "./verification-issues";
import {
  acquireVitestExecutionCaptureLock,
} from "./vitest-execution-capture-lock";
import {
  assertPnpmInstallationStateUnchanged,
  capturePnpmInstallationState,
  pnpmStoreDirConfigArgument,
  type PnpmInstallationState,
} from "./pnpm-installation-state";

export {
  acquireVitestExecutionCaptureLock,
  type VitestExecutionCaptureLock,
} from "./vitest-execution-capture-lock";

import {
  EXPECTED_VITEST_VERSION,
  VITEST_EXECUTION_EVIDENCE_MAX_BYTES,
  VITEST_JSON_REPORTER_MAX_BYTES,
  buildVitestExecutionEvidence,
  captureVitestExecutionRepositoryState,
  normalizeVitestJsonReporterOutput,
  serializeCanonicalVitestExecutionEvidence,
  vitestExecutionEvidencePath,
  type NormalizedVitestJsonReport,
  type VitestExecutionEvidence,
} from "./vitest-execution-evidence";

export type VitestExecutionRunner = (input: Readonly<{
  reportPath: string;
  storeDirConfigValue: string;
  workspace: string;
}>) => number;

export class VitestWorkloadTerminationUnprovenError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "VitestWorkloadTerminationUnprovenError";
  }
}

export type CaptureVitestExecutionEvidenceOptions = Readonly<{
  /** @internal Deterministic post-rename fault injection for filesystem tests. */
  afterEvidenceCommitForTesting?: () => void;
  runId?: string;
  runner?: VitestExecutionRunner;
  workspace?: string;
}>;

const workspacePackageSchema = z.object({
  devDependencies: z.object({
    vitest: z.literal(EXPECTED_VITEST_VERSION),
  }).passthrough(),
  packageManager: z.literal("pnpm@11.9.0"),
  scripts: z.object({
    test: z.literal("vitest run"),
  }).passthrough(),
}).passthrough();
export const EXPECTED_PNPM_VERSION = "11.9.0" as const;
const pnpmPackageSchema = z.object({
  bin: z.object({
    pnpm: z.string().min(1).max(500),
  }).passthrough(),
  name: z.literal("pnpm"),
  version: z.literal(EXPECTED_PNPM_VERSION),
}).passthrough();
const PACKAGE_JSON_MAX_BYTES = 2 * 1024 * 1024;
const PNPM_NON_MUTATING_FLAGS = [
  "--config.ignore-pnpmfile=true",
  "--config.node-experimental-package-map=false",
  "--config.offline=true",
  "--config.script-shell=/bin/sh",
  "--config.shell-emulator=false",
  "--config.verify-deps-before-run=false",
] as const;
const VITEST_DISABLE_CACHE_FLAG = "--no-cache" as const;
const VITEST_SUPERVISOR_TIMEOUT_MS = 30 * 60 * 1_000;
const VITEST_SUPERVISOR_KILL_GRACE_MS = 10_000;
const VITEST_SUPERVISOR_VERSION_TIMEOUT_MS = 60_000;
// The outer synchronous watchdog must cover the helper's detached capability
// probe (up to 10 s) and post-seal absence proof (up to 5 s), in addition to
// the caller-selected kill grace. Otherwise a valid slow containment path can
// be killed by its own wrapper and leave a deliberately sticky repository lock.
const VITEST_SUPERVISOR_OUTER_MARGIN_MS = 20_000;
const VITEST_SUPERVISOR_OUTPUT_MAX_BYTES = 16 * 1024 * 1024;
const VITEST_SUPERVISOR_RECEIPT_MAX_BYTES = 1_024;
const VITEST_SUPERVISOR_DIAGNOSTIC_MAX_BYTES = 4_096;
const VITEST_SUPERVISOR_RECEIPT_PATH_VARIABLE =
  "DIESEL_BOUNDED_COMMAND_COMPLETION_RECEIPT_PATH";
const VITEST_SUPERVISOR_RECEIPT_TOKEN_VARIABLE =
  "DIESEL_BOUNDED_COMMAND_COMPLETION_RECEIPT_TOKEN";
const VITEST_EXECUTION_STAGED_FILE_PREFIX = ".vitest-execution-";
const VITEST_EXECUTION_STAGED_FILE_SUFFIX = ".tmp";
const VITEST_PROCESS_GROUP_INVENTORY_MAX_BYTES = 1024 * 1024;
const VITEST_PROCESS_GROUP_CAPABILITY_FLAG =
  "--check-process-group-inventory-v1";
const VITEST_PROCESS_GROUP_CAPABILITY_SUCCESS =
  "bounded-command-v2:process-group-inventory-ok\n";
let vitestProcessGroupInventoryCapabilityVerified = false;
const vitestSupervisorReceiptSchema = z
  .object({
    version: z.literal("bounded-command-completion-v2"),
    token: z.string().uuid(),
    exitCode: z.number().int().min(0).max(255),
    closeSeen: z.literal(true),
    groupAbsenceProven: z.literal(true),
    guardianSealed: z.literal(true),
  })
  .strict();

function currentProcessFileIdentity(): Readonly<{ gid: number; uid: number }> {
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  if (
    uid === undefined ||
    !Number.isSafeInteger(uid) ||
    uid < 0 ||
    gid === undefined ||
    !Number.isSafeInteger(gid) ||
    gid < 0
  ) {
    throw new Error("Vitest evidence requires a stable POSIX process identity.");
  }
  return { gid, uid };
}

function normalizePrivatePathIdentity(path: string): void {
  const { gid, uid } = currentProcessFileIdentity();
  chownSync(path, uid, gid);
}

function assertRegularExecutable(path: string, label: string): string {
  if (!isAbsolute(path) || normalize(path) !== path) {
    throw new Error(`${label} must be a normalized absolute path.`);
  }
  let metadata: Stats;
  try {
    metadata = lstatSync(path);
    accessSync(path, constants.X_OK);
  } catch (cause: unknown) {
    throw new Error(`${label} is missing or not executable.`, { cause });
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`${label} must be a regular non-symlink file.`);
  }
  return path;
}

function readStablePackageJson(
  path: string,
  label: string,
  requireCanonical = false,
): unknown {
  let before: Stats;
  let physicalPath: string;
  try {
    before = lstatSync(path);
    physicalPath = realpathSync(path);
  } catch (cause: unknown) {
    throw new Error(`${label} is missing.`, { cause });
  }
  if (
    before.isSymbolicLink() ||
    !before.isFile() ||
    physicalPath !== path ||
    before.size <= 0 ||
    before.size > PACKAGE_JSON_MAX_BYTES
  ) {
    throw new Error(`${label} must be a bounded regular non-symlink file.`);
  }
  const bytes = readFileSync(path);
  const after = lstatSync(path);
  if (
    bytes.byteLength !== before.size ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.mode !== after.mode ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs ||
    before.size !== after.size
  ) {
    throw new Error(`${label} changed while read.`);
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause: unknown) {
    throw new Error(`${label} is not valid UTF-8.`, { cause });
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (requireCanonical && text !== `${JSON.stringify(parsed, null, 2)}\n`) {
      throw new Error(
        `${label} must use canonical two-space JSON with one final newline.`,
      );
    }
    return parsed;
  } catch (cause: unknown) {
    if (cause instanceof Error && cause.message.startsWith(`${label} must use`)) {
      throw cause;
    }
    throw new Error(`${label} is not valid JSON.`, { cause });
  }
}

export function assertVitestExecutionWorkspaceContract(workspace: string): void {
  const physicalWorkspace = realpathSync(resolve(workspace));
  if (physicalWorkspace !== resolve(workspace)) {
    throw new Error("Vitest workspace must not traverse a symbolic link.");
  }
  workspacePackageSchema.parse(readStablePackageJson(
    resolve(physicalWorkspace, "package.json"),
    "Vitest workspace package.json",
    true,
  ));
  const configPath = resolve(physicalWorkspace, "vitest.config.ts");
  const before = lstatSync(configPath);
  if (
    before.isSymbolicLink() ||
    !before.isFile() ||
    before.size <= 0 ||
    before.size > PACKAGE_JSON_MAX_BYTES ||
    realpathSync(configPath) !== configPath
  ) {
    throw new Error(
      "Vitest workspace config must be a bounded regular non-symlink file.",
    );
  }
  const configBytes = readFileSync(configPath);
  const after = lstatSync(configPath);
  if (
    configBytes.byteLength !== before.size ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.mode !== after.mode ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs ||
    before.size !== after.size
  ) {
    throw new Error("Vitest workspace config changed while read.");
  }
  const visibleConfig = runTrustedGit(physicalWorkspace, [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "--",
    "vitest.config.ts",
  ]);
  if (visibleConfig.toString("utf8") !== "vitest.config.ts\n") {
    throw new Error("Vitest workspace config must be Git-visible.");
  }
  assertVitestWorkspacePackageManagerConfigurationAbsent(physicalWorkspace);
}

export function assertVitestWorkspacePackageManagerConfigurationAbsent(
  workspaceInput: string,
): void {
  const configuredWorkspace = resolve(workspaceInput);
  const physicalWorkspace = realpathSync(configuredWorkspace);
  if (physicalWorkspace !== configuredWorkspace) {
    throw new Error("Vitest workspace must not traverse a symbolic link.");
  }
  for (const relativePath of [".npmrc", ".pnpmfile.cjs"] as const) {
    try {
      lstatSync(resolve(physicalWorkspace, relativePath));
    } catch (cause: unknown) {
      if (isMissingFileError(cause)) continue;
      throw new Error(
        `Vitest evidence could not verify the absence of ${relativePath}.`,
        { cause },
      );
    }
    throw new Error(`Vitest evidence requires ${relativePath} to be absent.`);
  }
}

function assertVitestDependencyBoundary(
  installationState: PnpmInstallationState,
  workspace: string,
  label: string,
): void {
  const errors: unknown[] = [];
  try {
    assertVitestWorkspacePackageManagerConfigurationAbsent(workspace);
  } catch (cause: unknown) {
    errors.push(cause);
  }
  try {
    assertPnpmInstallationStateUnchanged(
      installationState,
      capturePnpmInstallationState(workspace),
      label,
    );
  } catch (cause: unknown) {
    errors.push(cause);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(
      errors,
      `${label} package-manager boundary checks failed.`,
    );
  }
}

export function assertVitestProcessGroupInventoryCapabilityOutput(
  output: string,
): void {
  if (output !== VITEST_PROCESS_GROUP_CAPABILITY_SUCCESS) {
    throw new Error(
      "Bounded-command process-group capability output is malformed.",
    );
  }
}

export function assertVitestProcessGroupInventoryCapability(
  workspaceInput: string = process.cwd(),
): void {
  if (vitestProcessGroupInventoryCapabilityVerified) return;
  const workspace = realpathSync(resolve(workspaceInput));
  if (workspace !== resolve(workspaceInput)) {
    throw new Error("Vitest evidence workspace must not traverse a symbolic link.");
  }
  const nodeExecutable = assertRegularExecutable(
    process.execPath,
    "Vitest evidence Node executable",
  );
  const supervisorPath = resolveVitestSupervisor(workspace);
  const result = spawnSync(nodeExecutable, [
    supervisorPath,
    VITEST_PROCESS_GROUP_CAPABILITY_FLAG,
  ], {
    cwd: workspace,
    encoding: "utf8",
    env: {
      LANG: "C",
      LC_ALL: "C",
      NODE_ENV: "test",
      PATH: "/usr/bin:/bin",
    },
    killSignal: "SIGKILL",
    maxBuffer: VITEST_PROCESS_GROUP_INVENTORY_MAX_BYTES,
    shell: false,
    timeout: 15_000,
  });
  if (result.error !== undefined || result.signal !== null || result.status !== 0) {
    const diagnostic = result.stderr.trim();
    const causes = [
      ...(result.error === undefined ? [] : [result.error]),
      ...(result.signal === null
        ? []
        : [new Error(`Capability probe was terminated by ${result.signal}.`)]),
      ...(result.status === null
        ? []
        : [new Error(`Capability probe exited with status ${result.status}.`)]),
      ...(diagnostic.length === 0
        ? []
        : [new Error(`Capability probe diagnostic: ${diagnostic}`)]),
    ];
    throw new Error(
      "Vitest evidence requires the bounded-command detached process-group " +
        "inventory capability before acquiring its repository lock.",
      causes.length === 0
        ? undefined
        : {
            cause: causes.length === 1
              ? causes[0]
              : new AggregateError(causes, "Capability probe failed."),
          },
    );
  }
  assertVitestProcessGroupInventoryCapabilityOutput(result.stdout);
  if (result.stderr !== "") {
    throw new Error("Capability probe emitted unexpected diagnostics.");
  }
  vitestProcessGroupInventoryCapabilityVerified = true;
}

function assertPnpmPackageIdentity(pnpmEntrypoint: string): void {
  const packageRoot = resolve(dirname(pnpmEntrypoint), "..");
  if (realpathSync(packageRoot) !== packageRoot) {
    throw new Error("Resolved pnpm package root must be a physical directory.");
  }
  const packagePath = resolve(packageRoot, "package.json");
  let metadata: z.infer<typeof pnpmPackageSchema>;
  try {
    metadata = pnpmPackageSchema.parse(readStablePackageJson(
      packagePath,
      "Resolved pnpm package metadata",
    ));
  } catch (cause: unknown) {
    throw new Error(
      "Resolved pnpm package metadata does not identify pnpm 11.9.0.",
      { cause },
    );
  }
  const declaredEntrypoint = resolve(packageRoot, metadata.bin.pnpm);
  if (
    !declaredEntrypoint.startsWith(`${packageRoot}${sep}`) ||
    realpathSync(declaredEntrypoint) !== pnpmEntrypoint
  ) {
    throw new Error("Resolved pnpm entrypoint does not match its package metadata.");
  }
}

/**
 * Resolves the first executable `pnpm` on inherited PATH, removes symlink
 * indirection, and verifies its exact package identity. Runtime version output
 * is checked later behind the same bounded supervisor as the test workload.
 */
export function resolvePnpmEntrypoint(
  inherited: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const searchPath = inherited.PATH;
  if (!searchPath) {
    throw new Error("Vitest evidence requires PATH to locate pnpm.");
  }
  for (const directory of searchPath.split(delimiter)) {
    if (
      directory.length === 0 ||
      !isAbsolute(directory) ||
      normalize(directory) !== directory
    ) {
      continue;
    }
    const candidate = join(directory, "pnpm");
    try {
      accessSync(candidate, constants.X_OK);
    } catch {
      continue;
    }
    const entrypoint = realpathSync(candidate);
    assertRegularExecutable(entrypoint, "Resolved pnpm entrypoint");
    assertPnpmPackageIdentity(entrypoint);
    return entrypoint;
  }
  throw new Error(
    `Vitest evidence could not resolve pnpm ${EXPECTED_PNPM_VERSION} from PATH.`,
  );
}

export type VitestExecutionToolBin = Readonly<{
  directory: string;
  dispose: () => void;
  nodeExecutable: string;
  pnpmEntrypoint: string;
}>;

export type VitestExecutionToolBinOptions = Readonly<{
  temporaryRoot?: string;
}>;

export function createVitestExecutionToolBin(
  inherited: Readonly<Record<string, string | undefined>> = process.env,
  options: VitestExecutionToolBinOptions = {},
): VitestExecutionToolBin {
  const nodeExecutable = assertRegularExecutable(
    process.execPath,
    "Vitest evidence Node executable",
  );
  const pnpmEntrypoint = resolvePnpmEntrypoint(inherited);
  const configuredTemporaryRoot = resolve(options.temporaryRoot ?? "/tmp");
  const physicalTemporaryRoot = realpathSync(configuredTemporaryRoot);
  const temporaryRootMetadata = lstatSync(physicalTemporaryRoot);
  if (
    (options.temporaryRoot !== undefined &&
      physicalTemporaryRoot !== configuredTemporaryRoot) ||
    temporaryRootMetadata.isSymbolicLink() ||
    !temporaryRootMetadata.isDirectory()
  ) {
    throw new Error(
      "Vitest evidence explicit temporary root must be a physical directory.",
    );
  }
  const directory = mkdtempSync(
    resolve(physicalTemporaryRoot, "diesel-vitest-tools-"),
  );
  try {
    // Darwin's shared /private/tmp assigns group wheel to new children. Pin
    // the private hierarchy to the invoking POSIX identity before any test
    // fixture inherits it; the ambient TMPDIR remains intentionally ignored.
    normalizePrivatePathIdentity(directory);
    chmodSync(directory, 0o700);
    mkdirSync(resolve(directory, ".home"), { mode: 0o700 });
    normalizePrivatePathIdentity(resolve(directory, ".home"));
    symlinkSync(nodeExecutable, resolve(directory, "node"));
    symlinkSync(pnpmEntrypoint, resolve(directory, "pnpm"));
    const entries = readdirSync(directory).sort();
    if (JSON.stringify(entries) !== JSON.stringify([".home", "node", "pnpm"])) {
      throw new Error("Vitest private tool bin contains an unexpected entry.");
    }
    return {
      directory,
      dispose: () => rmSync(directory, { force: true, recursive: true }),
      nodeExecutable,
      pnpmEntrypoint,
    };
  } catch (cause: unknown) {
    try {
      rmSync(directory, { force: true, recursive: true });
    } catch (cleanupCause: unknown) {
      throw new AggregateError(
        [cause, cleanupCause],
        "Vitest private tool setup and cleanup both failed.",
      );
    }
    throw cause;
  }
}

export function initializeVitestExecutionCaptureToolState(
  tools: VitestExecutionToolBin,
): void {
  const configuredDirectory = resolve(tools.directory);
  const physicalDirectory = realpathSync(configuredDirectory);
  const { gid, uid } = currentProcessFileIdentity();
  const rootMetadata = lstatSync(physicalDirectory);
  if (physicalDirectory !== configuredDirectory) {
    throw new Error("Vitest private tool directory must remain physical.");
  }
  if (
    rootMetadata.uid !== uid ||
    rootMetadata.gid !== gid ||
    (rootMetadata.mode & 0o777) !== 0o700
  ) {
    throw new Error("Vitest private tool directory identity changed.");
  }
  const initialEntries = readdirSync(physicalDirectory).sort();
  if (JSON.stringify(initialEntries) !== JSON.stringify([
    ".home",
    "node",
    "pnpm",
  ])) {
    throw new Error("Vitest private tool directory is not pristine.");
  }
  if (
    realpathSync(resolve(physicalDirectory, "node")) !== tools.nodeExecutable ||
    realpathSync(resolve(physicalDirectory, "pnpm")) !== tools.pnpmEntrypoint
  ) {
    throw new Error("Vitest private tool links changed before initialization.");
  }
  const privateTemporaryDirectory = resolve(physicalDirectory, ".tmp");
  const privateConfigurationDirectory = resolve(physicalDirectory, ".config");
  const privateUserConfig = resolve(physicalDirectory, ".npmrc-user");
  const privateGlobalConfig = resolve(physicalDirectory, ".npmrc-global");
  mkdirSync(privateTemporaryDirectory, { mode: 0o700 });
  normalizePrivatePathIdentity(privateTemporaryDirectory);
  chmodSync(privateTemporaryDirectory, 0o700);
  mkdirSync(privateConfigurationDirectory, { mode: 0o700 });
  normalizePrivatePathIdentity(privateConfigurationDirectory);
  chmodSync(privateConfigurationDirectory, 0o700);
  writeFileSync(privateUserConfig, "", { flag: "wx", mode: 0o600 });
  normalizePrivatePathIdentity(privateUserConfig);
  chmodSync(privateUserConfig, 0o600);
  writeFileSync(privateGlobalConfig, "", { flag: "wx", mode: 0o600 });
  normalizePrivatePathIdentity(privateGlobalConfig);
  chmodSync(privateGlobalConfig, 0o600);
}

export function buildVitestExecutionCaptureEnvironment(
  toolDirectory: string,
): NodeJS.ProcessEnv {
  const physicalToolDirectory = realpathSync(resolve(toolDirectory));
  const { gid, uid } = currentProcessFileIdentity();
  const metadata = lstatSync(physicalToolDirectory);
  const privateHome = resolve(physicalToolDirectory, ".home");
  const privateHomeMetadata = lstatSync(privateHome);
  const privateTemporaryDirectory = resolve(physicalToolDirectory, ".tmp");
  const privateConfigurationDirectory = resolve(
    physicalToolDirectory,
    ".config",
  );
  const privateUserConfig = resolve(physicalToolDirectory, ".npmrc-user");
  const privateGlobalConfig = resolve(physicalToolDirectory, ".npmrc-global");
  if (
    physicalToolDirectory !== resolve(toolDirectory) ||
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    metadata.uid !== uid ||
    metadata.gid !== gid ||
    (metadata.mode & 0o077) !== 0 ||
    privateHomeMetadata.isSymbolicLink() ||
    !privateHomeMetadata.isDirectory() ||
    realpathSync(privateHome) !== privateHome ||
    privateHomeMetadata.uid !== uid ||
    privateHomeMetadata.gid !== gid ||
    (privateHomeMetadata.mode & 0o077) !== 0
  ) {
    throw new Error("Vitest private tool bin must be a private physical directory.");
  }
  for (const [path, label] of [
    [privateTemporaryDirectory, "temporary"],
    [privateConfigurationDirectory, "configuration"],
  ] as const) {
    const directoryMetadata = lstatSync(path);
    if (
      directoryMetadata.isSymbolicLink() ||
      !directoryMetadata.isDirectory() ||
      realpathSync(path) !== path ||
      directoryMetadata.uid !== uid ||
      directoryMetadata.gid !== gid ||
      (directoryMetadata.mode & 0o777) !== 0o700
    ) {
      throw new Error(`Vitest private ${label} directory is not trustworthy.`);
    }
  }
  for (const [path, label] of [
    [privateUserConfig, "user"],
    [privateGlobalConfig, "global"],
  ] as const) {
    const configMetadata = lstatSync(path);
    if (
      configMetadata.isSymbolicLink() ||
      !configMetadata.isFile() ||
      realpathSync(path) !== path ||
      configMetadata.uid !== uid ||
      configMetadata.gid !== gid ||
      configMetadata.size !== 0 ||
      (configMetadata.mode & 0o777) !== 0o600
    ) {
      throw new Error(`Vitest private npm ${label} config is not trustworthy.`);
    }
  }
  return {
    HOME: privateHome,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    NPM_CONFIG_GLOBALCONFIG: privateGlobalConfig,
    NPM_CONFIG_IGNORE_PNPMFILE: "true",
    NPM_CONFIG_OFFLINE: "true",
    NPM_CONFIG_USERCONFIG: privateUserConfig,
    NPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: "false",
    NODE_ENV: "test",
    NO_COLOR: "1",
    PATH: `${physicalToolDirectory}${delimiter}/usr/bin${delimiter}/bin`,
    PNPM_CONFIG_IGNORE_PNPMFILE: "true",
    PNPM_CONFIG_NODE_EXPERIMENTAL_PACKAGE_MAP: "false",
    PNPM_CONFIG_OFFLINE: "true",
    PNPM_CONFIG_SCRIPT_SHELL: "/bin/sh",
    PNPM_CONFIG_SHELL_EMULATOR: "false",
    PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: "false",
    TMPDIR: privateTemporaryDirectory,
    TZ: "UTC",
    XDG_CONFIG_HOME: privateConfigurationDirectory,
  } satisfies NodeJS.ProcessEnv;
}

export function assertVitestVersionOutput(output: string): void {
  if (output.includes("\0") || output.includes("\r")) {
    throw new Error("Installed Vitest version output is malformed.");
  }
  const normalized = output.endsWith("\n") ? output.slice(0, -1) : output;
  if (
    normalized.length === 0 ||
    normalized.includes("\n") ||
    normalized.split(/\s+/u)[0] !== `vitest/${EXPECTED_VITEST_VERSION}`
  ) {
    throw new Error(
      `Vitest evidence requires installed Vitest ${EXPECTED_VITEST_VERSION}.`,
    );
  }
}

export function buildVitestPnpmCommandArguments(input: Readonly<{
  args: readonly string[];
  installationState: Pick<PnpmInstallationState, "storeDirConfigValue">;
  pnpmEntrypoint: string;
}>): string[] {
  return [
    input.pnpmEntrypoint,
    pnpmStoreDirConfigArgument(input.installationState),
    ...input.args,
  ];
}

export function buildSupervisedVitestCommandArguments(input: Readonly<{
  args: readonly string[];
  installationState: Pick<PnpmInstallationState, "storeDirConfigValue">;
  maxOutputBytes: number;
  nodeExecutable: string;
  pnpmEntrypoint: string;
  stderrPath: string;
  stdoutPath: string;
  supervisorPath: string;
  timeoutMs: number;
}>): string[] {
  return [
    input.supervisorPath,
    String(input.timeoutMs),
    String(VITEST_SUPERVISOR_KILL_GRACE_MS),
    String(input.maxOutputBytes),
    String(input.maxOutputBytes),
    "-",
    input.stdoutPath,
    input.stderrPath,
    "--",
    input.nodeExecutable,
    ...buildVitestPnpmCommandArguments({
      args: input.args,
      installationState: input.installationState,
      pnpmEntrypoint: input.pnpmEntrypoint,
    }),
  ];
}

export function buildVitestSupervisorArguments(input: Readonly<{
  installationState: Pick<PnpmInstallationState, "storeDirConfigValue">;
  nodeExecutable: string;
  pnpmEntrypoint: string;
  reportPath: string;
  stderrPath: string;
  stdoutPath: string;
  supervisorPath: string;
}>): string[] {
  return buildSupervisedVitestCommandArguments({
    args: [
      ...PNPM_NON_MUTATING_FLAGS,
      "test",
      "--config=vitest.config.ts",
      VITEST_DISABLE_CACHE_FLAG,
      "--reporter=./scripts/portfolio/vitest-json-reporter.ts",
      `--outputFile=${input.reportPath}`,
    ],
    installationState: input.installationState,
    maxOutputBytes: VITEST_SUPERVISOR_OUTPUT_MAX_BYTES,
    nodeExecutable: input.nodeExecutable,
    pnpmEntrypoint: input.pnpmEntrypoint,
    stderrPath: input.stderrPath,
    stdoutPath: input.stdoutPath,
    supervisorPath: input.supervisorPath,
    timeoutMs: VITEST_SUPERVISOR_TIMEOUT_MS,
  });
}

function resolveVitestSupervisor(workspace: string): string {
  const path = resolve(workspace, "scripts/deploy/run-bounded-command.mjs");
  const metadata = lstatSync(path);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.size <= 0 ||
    metadata.size > 256 * 1024 ||
    realpathSync(path) !== path
  ) {
    throw new Error(
      "Vitest process-group supervisor must be a bounded physical file.",
    );
  }
  return path;
}

function readVitestSupervisorOutput(path: string): Buffer {
  let metadata: Stats;
  try {
    metadata = lstatSync(path);
  } catch (cause: unknown) {
    if (isMissingFileError(cause)) return Buffer.alloc(0);
    throw cause;
  }
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.size < 0 ||
    metadata.size > VITEST_SUPERVISOR_OUTPUT_MAX_BYTES ||
    realpathSync(path) !== path
  ) {
    throw new Error("Vitest supervisor output is not a bounded physical file.");
  }
  const bytes = readFileSync(path);
  const after = lstatSync(path);
  if (
    bytes.byteLength !== metadata.size ||
    metadata.dev !== after.dev ||
    metadata.ino !== after.ino ||
    metadata.mode !== after.mode ||
    metadata.mtimeMs !== after.mtimeMs ||
    metadata.ctimeMs !== after.ctimeMs ||
    metadata.size !== after.size
  ) {
    throw new Error("Vitest supervisor output changed while it was replayed.");
  }
  return bytes;
}

function readVitestSupervisorReceipt(
  path: string,
  expectedToken: string,
): z.infer<typeof vitestSupervisorReceiptSchema> {
  const before = lstatSync(path);
  if (
    before.isSymbolicLink() ||
    !before.isFile() ||
    before.nlink !== 1 ||
    (before.mode & 0o777) !== 0o600 ||
    before.size <= 0 ||
    before.size > VITEST_SUPERVISOR_RECEIPT_MAX_BYTES ||
    realpathSync(path) !== path
  ) {
    throw new Error("Vitest supervisor completion receipt is not trustworthy.");
  }
  const bytes = readFileSync(path);
  const after = lstatSync(path);
  if (
    bytes.byteLength !== before.size ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.mode !== after.mode ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs ||
    before.nlink !== after.nlink ||
    before.size !== after.size
  ) {
    throw new Error(
      "Vitest supervisor completion receipt changed while it was read.",
    );
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause: unknown) {
    throw new Error("Vitest supervisor completion receipt is not UTF-8.", {
      cause,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (cause: unknown) {
    throw new Error("Vitest supervisor completion receipt is not JSON.", {
      cause,
    });
  }
  const receipt = vitestSupervisorReceiptSchema.parse(parsed);
  if (
    receipt.token !== expectedToken ||
    text !== `${JSON.stringify(receipt)}\n`
  ) {
    throw new Error(
      "Vitest supervisor completion receipt is not canonical or bound to this run.",
    );
  }
  return receipt;
}

type SupervisedVitestCommandResult = Readonly<{
  status: number;
  stderr: Buffer;
  stdout: Buffer;
}>;

function decodeSupervisorText(bytes: Buffer, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause: unknown) {
    throw new Error(`${label} is not valid UTF-8.`, { cause });
  }
}

export function parseVitestSupervisorDiagnostic(
  bytes: Buffer,
): string | null {
  if (bytes.byteLength === 0) return null;
  if (bytes.byteLength > VITEST_SUPERVISOR_DIAGNOSTIC_MAX_BYTES) {
    throw new Error("Supervisor diagnostic exceeded its bound.");
  }
  const text = decodeSupervisorText(bytes, "Supervisor diagnostic");
  const match = /^bounded-command-v2:([a-z0-9-]{1,64})\n$/u.exec(text);
  if (match === null) {
    throw new Error("Supervisor diagnostic was not one fixed canonical line.");
  }
  return match[1] ?? null;
}

function runSupervisedVitestCommand(input: Readonly<{
  args: readonly string[];
  installationState: PnpmInstallationState;
  label: string;
  maxOutputBytes: number;
  supervisorPath: string;
  timeoutMs: number;
  tools: VitestExecutionToolBin;
  workspace: string;
}>): SupervisedVitestCommandResult {
  const invocationId = randomUUID();
  const stdoutPath = resolve(
    input.tools.directory,
    `${input.label}-${invocationId}.stdout`,
  );
  const stderrPath = resolve(
    input.tools.directory,
    `${input.label}-${invocationId}.stderr`,
  );
  const receiptPath = resolve(
    input.tools.directory,
    `${input.label}-${invocationId}.completion.json`,
  );
  const receiptToken = randomUUID();
  const result = spawnSync(input.tools.nodeExecutable,
    buildSupervisedVitestCommandArguments({
      args: input.args,
      installationState: input.installationState,
      maxOutputBytes: input.maxOutputBytes,
      nodeExecutable: input.tools.nodeExecutable,
      pnpmEntrypoint: input.tools.pnpmEntrypoint,
      stderrPath,
      stdoutPath,
      supervisorPath: input.supervisorPath,
      timeoutMs: input.timeoutMs,
    }), {
    cwd: input.workspace,
    env: {
      ...buildVitestExecutionCaptureEnvironment(input.tools.directory),
      [VITEST_SUPERVISOR_RECEIPT_PATH_VARIABLE]: receiptPath,
      [VITEST_SUPERVISOR_RECEIPT_TOKEN_VARIABLE]: receiptToken,
    },
    stdio: ["ignore", "inherit", "pipe"],
    killSignal: "SIGKILL",
    maxBuffer: VITEST_SUPERVISOR_DIAGNOSTIC_MAX_BYTES,
    timeout:
      input.timeoutMs +
      VITEST_SUPERVISOR_KILL_GRACE_MS +
      VITEST_SUPERVISOR_OUTER_MARGIN_MS,
  });

  const containmentErrors: unknown[] = [];
  const supervisorStderr = result.stderr ?? Buffer.alloc(0);
  if (supervisorStderr.byteLength > 0) {
    try {
      process.stderr.write(supervisorStderr);
    } catch (cause: unknown) {
      containmentErrors.push(
        new Error("Supervisor diagnostic replay failed.", { cause }),
      );
    }
    try {
      const reason = parseVitestSupervisorDiagnostic(supervisorStderr);
      containmentErrors.push(
        new Error(`Supervisor reported bounded-command-v2:${reason}.`),
      );
    } catch (cause: unknown) {
      containmentErrors.push(cause);
    }
  }
  let receipt: z.infer<typeof vitestSupervisorReceiptSchema> | undefined;
  try {
    receipt = readVitestSupervisorReceipt(receiptPath, receiptToken);
  } catch (cause: unknown) {
    containmentErrors.push(
      new Error("Supervisor completion receipt could not be validated.", {
        cause,
      }),
    );
  }
  if (result.error !== undefined) containmentErrors.push(result.error);
  if (result.signal !== null) {
    containmentErrors.push(
      new Error(`Supervisor was terminated by ${result.signal}.`),
    );
  }
  if (result.status === null) {
    containmentErrors.push(
      new Error("Supervisor returned no numeric exit status."),
    );
  } else if (receipt !== undefined && result.status !== receipt.exitCode) {
    containmentErrors.push(
      new Error("Supervisor exit status does not match its completion receipt."),
    );
  } else if (receipt === undefined) {
    containmentErrors.push(
      new Error(
        `Supervisor exited with status ${result.status} without a completion receipt.`,
      ),
    );
  }
  if (containmentErrors.length > 0) {
    const cause = containmentErrors.length === 1
      ? containmentErrors[0]
      : new AggregateError(
          containmentErrors,
          "Supervisor process state and containment receipt were inconsistent.",
        );
    throw new VitestWorkloadTerminationUnprovenError(
      "The Vitest process-group supervisor did not prove the workload group " +
        `empty; the repository capture lock and tool directory ${input.tools.directory} ` +
        "must remain for operator inspection.",
      { cause },
    );
  }
  if (result.status === null) {
    throw new VitestWorkloadTerminationUnprovenError(
      "The supervisor status remained unavailable after containment validation.",
    );
  }
  return {
    status: result.status,
    stderr: readVitestSupervisorOutput(stderrPath),
    stdout: readVitestSupervisorOutput(stdoutPath),
  };
}

function assertPnpmRuntimeVersion(
  installationState: PnpmInstallationState,
  tools: VitestExecutionToolBin,
  supervisorPath: string,
  workspace: string,
): void {
  const result = runSupervisedVitestCommand({
    args: [...PNPM_NON_MUTATING_FLAGS, "--version"],
    installationState,
    label: "pnpm-version",
    maxOutputBytes: 64 * 1024,
    supervisorPath,
    timeoutMs: VITEST_SUPERVISOR_VERSION_TIMEOUT_MS,
    tools,
    workspace,
  });
  if (
    result.status !== 0 ||
    decodeSupervisorText(result.stdout, "pnpm version output").trim() !==
      EXPECTED_PNPM_VERSION
  ) {
    if (result.stderr.byteLength > 0) process.stderr.write(result.stderr);
    throw new Error(`Vitest evidence requires pnpm ${EXPECTED_PNPM_VERSION}.`);
  }
}

function assertInstalledVitestVersion(
  installationState: PnpmInstallationState,
  tools: VitestExecutionToolBin,
  supervisorPath: string,
  workspace: string,
): void {
  const result = runSupervisedVitestCommand({
    args: [...PNPM_NON_MUTATING_FLAGS, "exec", "vitest", "--version"],
    installationState,
    label: "vitest-version",
    maxOutputBytes: 64 * 1024,
    supervisorPath,
    timeoutMs: VITEST_SUPERVISOR_VERSION_TIMEOUT_MS,
    tools,
    workspace,
  });
  if (result.status !== 0) {
    if (result.stderr.byteLength > 0) process.stderr.write(result.stderr);
    throw new Error("Installed Vitest version could not be verified.");
  }
  assertVitestVersionOutput(
    decodeSupervisorText(result.stdout, "Vitest version output"),
  );
}

export function isVitestWorkloadTerminationUnproven(error: unknown): boolean {
  const visited = new Set<object>();
  const inspect = (value: unknown): boolean => {
    if (value instanceof VitestWorkloadTerminationUnprovenError) return true;
    if (typeof value !== "object" || value === null || visited.has(value)) {
      return false;
    }
    visited.add(value);
    if (value instanceof AggregateError) {
      if (value.errors.some(inspect)) return true;
    }
    if (value instanceof Error && value.cause !== undefined) {
      return inspect(value.cause);
    }
    return false;
  };
  return inspect(error);
}

export function runSupervisedVitestList(input: Readonly<{
  inventoryPath: string;
  tools: VitestExecutionToolBin;
  workspace: string;
}>): void {
  assertVitestWorkspacePackageManagerConfigurationAbsent(input.workspace);
  initializeVitestExecutionCaptureToolState(input.tools);
  const installationState = capturePnpmInstallationState(input.workspace);
  const supervisorPath = resolveVitestSupervisor(input.workspace);
  let operationError: unknown;
  let operationFailed = false;
  try {
    assertPnpmRuntimeVersion(
      installationState,
      input.tools,
      supervisorPath,
      input.workspace,
    );
    assertInstalledVitestVersion(
      installationState,
      input.tools,
      supervisorPath,
      input.workspace,
    );
    const result = runSupervisedVitestCommand({
      args: [
        ...PNPM_NON_MUTATING_FLAGS,
        "exec",
        "vitest",
        "list",
        "--config",
        resolve(input.workspace, "vitest.config.ts"),
        VITEST_DISABLE_CACHE_FLAG,
        `--json=${input.inventoryPath}`,
      ],
      installationState,
      label: "vitest-list",
      maxOutputBytes: VITEST_SUPERVISOR_OUTPUT_MAX_BYTES,
      supervisorPath,
      timeoutMs: 120_000,
      tools: input.tools,
      workspace: input.workspace,
    });
    if (result.status !== 0) {
      const diagnostics = [result.stderr, result.stdout]
        .filter((bytes) => bytes.byteLength > 0)
        .map((bytes) =>
          decodeSupervisorText(bytes, "Vitest list diagnostics").trim()
        )
        .filter((value) => value.length > 0)
        .join("\n");
      throw new Error(
        `Vitest list failed with exit status ${result.status}` +
          `${diagnostics.length > 0 ? `:\n${diagnostics}` : "."}`,
      );
    }
  } catch (cause: unknown) {
    operationError = cause;
    operationFailed = true;
  }

  let stateError: unknown;
  let stateFailed = false;
  try {
    assertVitestDependencyBoundary(
      installationState,
      input.workspace,
      "Vitest list pnpm installation state",
    );
  } catch (cause: unknown) {
    stateError = cause;
    stateFailed = true;
  }
  if (operationFailed && stateFailed) {
    throw new AggregateError(
      [operationError, stateError],
      "Vitest list execution and dependency-state verification both failed.",
    );
  }
  if (operationFailed) throw operationError;
  if (stateFailed) throw stateError;
}

export function runCanonicalVitestExecution(input: Readonly<{
  reportPath: string;
  storeDirConfigValue: string;
  workspace: string;
}>): number {
  assertVitestExecutionWorkspaceContract(input.workspace);
  const installationState = capturePnpmInstallationState(input.workspace);
  if (installationState.storeDirConfigValue !== input.storeDirConfigValue) {
    throw new Error(
      "Vitest execution store directory changed before runner entry.",
    );
  }
  assertVitestProcessGroupInventoryCapability(input.workspace);
  const tools = createVitestExecutionToolBin();
  let executionError: unknown;
  let executionFailed = false;
  try {
    initializeVitestExecutionCaptureToolState(tools);
    const supervisorPath = resolveVitestSupervisor(input.workspace);
    assertPnpmRuntimeVersion(
      installationState,
      tools,
      supervisorPath,
      input.workspace,
    );
    assertInstalledVitestVersion(
      installationState,
      tools,
      supervisorPath,
      input.workspace,
    );
    const result = runSupervisedVitestCommand({
      args: [
        ...PNPM_NON_MUTATING_FLAGS,
        "test",
        "--config=vitest.config.ts",
        VITEST_DISABLE_CACHE_FLAG,
        "--reporter=./scripts/portfolio/vitest-json-reporter.ts",
        `--outputFile=${input.reportPath}`,
      ],
      installationState,
      label: "vitest-run",
      maxOutputBytes: VITEST_SUPERVISOR_OUTPUT_MAX_BYTES,
      supervisorPath,
      timeoutMs: VITEST_SUPERVISOR_TIMEOUT_MS,
      tools,
      workspace: input.workspace,
    });
    const exitStatusError = result.status === 0
      ? null
      : new Error(`Vitest execution exited with status ${result.status}.`);
    if (exitStatusError !== null) {
      executionFailed = true;
      executionError = exitStatusError;
    }
    try {
      if (result.stdout.byteLength > 0) process.stdout.write(result.stdout);
      if (result.stderr.byteLength > 0) process.stderr.write(result.stderr);
      assertInstalledVitestVersion(
        installationState,
        tools,
        supervisorPath,
        input.workspace,
      );
    } catch (cause: unknown) {
      if (exitStatusError !== null) {
        throw new AggregateError(
          [exitStatusError, cause],
          "Vitest returned nonzero and post-run verification also failed.",
        );
      }
      throw cause;
    }
    return result.status;
  } catch (cause: unknown) {
    executionError = cause;
    executionFailed = true;
    throw cause;
  } finally {
    const finalizationErrors: unknown[] = [];
    try {
      assertVitestDependencyBoundary(
        installationState,
        input.workspace,
        "Vitest execution pnpm installation state",
      );
    } catch (stateCause: unknown) {
      finalizationErrors.push(stateCause);
    }
    if (
      !executionFailed ||
      !isVitestWorkloadTerminationUnproven(executionError)
    ) {
      try {
        tools.dispose();
      } catch (cleanupCause: unknown) {
        finalizationErrors.push(cleanupCause);
      }
    }
    if (finalizationErrors.length > 0) {
      if (executionFailed) {
        throw new AggregateError(
          [executionError, ...finalizationErrors],
          "Vitest execution and final dependency/cleanup verification failed.",
        );
      }
      if (finalizationErrors.length === 1) throw finalizationErrors[0];
      throw new AggregateError(
        finalizationErrors,
        "Vitest final dependency and cleanup verification failed.",
      );
    }
  }
}

export function formatVitestExecutionCaptureError(error: unknown): string {
  return formatErrorTree(error, "capture");
}

function readBoundedReporterOutput(reportPath: string): string {
  let metadata: Stats;
  let physicalPath: string;
  try {
    metadata = lstatSync(reportPath);
    physicalPath = realpathSync(reportPath);
  } catch (cause: unknown) {
    throw new Error("Vitest did not produce its JSON reporter output.", { cause });
  }
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    physicalPath !== reportPath ||
    metadata.size <= 0 ||
    metadata.size > VITEST_JSON_REPORTER_MAX_BYTES
  ) {
    throw new Error(
      "Vitest JSON reporter output must be a bounded regular non-symlink file.",
    );
  }
  const bytes = readFileSync(reportPath);
  const after = lstatSync(reportPath);
  if (
    bytes.byteLength !== metadata.size ||
    metadata.dev !== after.dev ||
    metadata.ino !== after.ino ||
    metadata.mtimeMs !== after.mtimeMs ||
    metadata.ctimeMs !== after.ctimeMs ||
    metadata.size !== after.size
  ) {
    throw new Error("Vitest JSON reporter output changed while read.");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause: unknown) {
    throw new Error("Vitest JSON reporter output is not valid UTF-8.", { cause });
  }
}

function assertEvidenceDirectory(workspace: string, outputPath: string): void {
  const outputDirectory = dirname(outputPath);
  const workspacePrefix = `${workspace}${sep}`;
  if (!outputDirectory.startsWith(workspacePrefix)) {
    throw new Error("Vitest evidence output directory escaped the workspace.");
  }
  const metadata = lstatSync(outputDirectory);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    realpathSync(outputDirectory) !== outputDirectory
  ) {
    throw new Error(
      "Vitest evidence output directory must be a contained non-symlink directory.",
    );
  }
}

function assertExistingEvidenceIsRegular(outputPath: string): void {
  try {
    const existing = lstatSync(outputPath);
    if (existing.isSymbolicLink() || !existing.isFile()) {
      throw new Error(
        "Existing Vitest evidence must be a regular non-symlink file.",
      );
    }
  } catch (cause: unknown) {
    if (
      cause instanceof Error &&
      "code" in cause &&
      (cause as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return;
    }
    throw cause;
  }
}

export function assertNoOrphanedVitestExecutionStagingFiles(
  workspaceInput: string,
): void {
  const workspace = realpathSync(resolve(workspaceInput));
  if (workspace !== resolve(workspaceInput)) {
    throw new Error("Vitest evidence workspace must not traverse a symbolic link.");
  }
  const evidenceDirectory = dirname(
    resolve(workspace, vitestExecutionEvidencePath),
  );
  assertEvidenceDirectory(workspace, resolve(
    workspace,
    vitestExecutionEvidencePath,
  ));
  const orphanPaths = readdirSync(evidenceDirectory)
    .filter(
      (name) =>
        name.startsWith(VITEST_EXECUTION_STAGED_FILE_PREFIX) &&
        name.endsWith(VITEST_EXECUTION_STAGED_FILE_SUFFIX),
    )
    .sort()
    .map((name) => resolve(evidenceDirectory, name));
  if (orphanPaths.length > 0) {
    throw new Error(
      "Orphaned Vitest execution-evidence staging files require operator " +
        `inspection before capture or verification: ${orphanPaths.join(",")}.`,
    );
  }
}

type BoundEvidenceSink =
  | Readonly<{ kind: "absent" }>
  | Readonly<{
    bytes: Buffer;
    ctimeMs: number;
    dev: number;
    fileMode: number;
    ino: number;
    kind: "file";
    mtimeMs: number;
    size: number;
  }>;

function isMissingFileError(cause: unknown): boolean {
  return cause instanceof Error &&
    "code" in cause &&
    (cause as NodeJS.ErrnoException).code === "ENOENT";
}

function bindEvidenceSink(workspace: string): BoundEvidenceSink {
  const outputPath = resolve(workspace, vitestExecutionEvidencePath);
  assertEvidenceDirectory(workspace, outputPath);
  try {
    const before = lstatSync(outputPath);
    if (
      before.isSymbolicLink() ||
      !before.isFile() ||
      realpathSync(outputPath) !== outputPath ||
      before.size > VITEST_EXECUTION_EVIDENCE_MAX_BYTES
    ) {
      throw new Error(
        "Existing Vitest evidence must be a bounded regular non-symlink file.",
      );
    }
    const bytes = readFileSync(outputPath);
    const after = lstatSync(outputPath);
    if (
      bytes.byteLength !== before.size ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.mode !== after.mode ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      before.size !== after.size
    ) {
      throw new Error("Existing Vitest evidence changed while it was bound.");
    }
    return {
      bytes,
      ctimeMs: before.ctimeMs,
      dev: before.dev,
      fileMode: before.mode,
      ino: before.ino,
      kind: "file",
      mtimeMs: before.mtimeMs,
      size: before.size,
    };
  } catch (cause: unknown) {
    if (isMissingFileError(cause)) return { kind: "absent" };
    throw cause;
  }
}

function evidenceSinkStillMatches(
  outputPath: string,
  bound: BoundEvidenceSink,
): boolean {
  let metadata: Stats;
  try {
    metadata = lstatSync(outputPath);
  } catch (cause: unknown) {
    if (isMissingFileError(cause)) return bound.kind === "absent";
    throw cause;
  }
  if (bound.kind === "absent") return false;
  if (metadata.isSymbolicLink() || !metadata.isFile()) return false;
  if (
    metadata.dev !== bound.dev ||
    metadata.ino !== bound.ino ||
    metadata.mode !== bound.fileMode ||
    metadata.mtimeMs !== bound.mtimeMs ||
    metadata.ctimeMs !== bound.ctimeMs ||
    metadata.size !== bound.size
  ) {
    return false;
  }
  return readFileSync(outputPath).equals(bound.bytes);
}

function assertEvidenceSinkStillMatches(
  outputPath: string,
  bound: BoundEvidenceSink,
  phase: string,
): void {
  if (!evidenceSinkStillMatches(outputPath, bound)) {
    throw new Error(
      `Vitest execution-evidence sink changed ${phase}.`,
    );
  }
}

type AtomicEvidencePersistenceOptions = Readonly<{
  assertPrecommit?: (temporaryPath: string) => void;
  onCommitted?: () => void;
}>;

async function persistVitestExecutionEvidenceAtomic(
  workspaceInput: string,
  evidence: VitestExecutionEvidence,
  options: AtomicEvidencePersistenceOptions = {},
): Promise<string> {
  const workspace = realpathSync(resolve(workspaceInput));
  if (workspace !== resolve(workspaceInput)) {
    throw new Error("Vitest evidence workspace must not traverse a symbolic link.");
  }
  const serialized = serializeCanonicalVitestExecutionEvidence(evidence);
  const outputPath = resolve(workspace, vitestExecutionEvidencePath);
  assertEvidenceDirectory(workspace, outputPath);
  assertExistingEvidenceIsRegular(outputPath);
  const temporaryPath = resolve(
    dirname(outputPath),
    `.vitest-execution-${process.pid}-${randomUUID()}.tmp`,
  );
  let persistenceError: unknown;
  let persistenceFailed = false;
  try {
    await writeFile(temporaryPath, serialized, {
      encoding: "utf8",
      flag: "wx",
    });
    const metadata = lstatSync(temporaryPath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error("Staged Vitest evidence is not a regular file.");
    }
    options.assertPrecommit?.(temporaryPath);
    await rename(temporaryPath, outputPath);
    options.onCommitted?.();
    return serialized;
  } catch (cause: unknown) {
    persistenceError = cause;
    persistenceFailed = true;
    throw cause;
  } finally {
    try {
      await rm(temporaryPath, { force: true });
    } catch (cleanupCause: unknown) {
      if (persistenceFailed) {
        throw new AggregateError(
          [persistenceError, cleanupCause],
          "Vitest evidence persistence and staged-file cleanup both failed.",
        );
      }
      throw cleanupCause;
    }
  }
}

/**
 * Low-level atomic artifact replacement. This helper deliberately does not
 * acquire the repository capture lock or compare-and-swap a previously bound
 * sink. Use `captureVitestExecutionEvidence` for the guarded capture workflow.
 */
export async function persistVitestExecutionEvidence(
  workspaceInput: string,
  evidence: VitestExecutionEvidence,
): Promise<void> {
  await persistVitestExecutionEvidenceAtomic(workspaceInput, evidence);
}

function assertCommittedEvidenceMatches(
  sink: BoundEvidenceSink,
  serialized: string,
): void {
  if (
    sink.kind !== "file" ||
    !sink.bytes.equals(Buffer.from(serialized, "utf8"))
  ) {
    throw new Error("Committed Vitest execution evidence does not match its run.");
  }
}

export async function captureVitestExecutionEvidence(
  options: CaptureVitestExecutionEvidenceOptions = {},
): Promise<VitestExecutionEvidence> {
  const workspace = realpathSync(resolve(options.workspace ?? process.cwd()));
  if (workspace !== resolve(options.workspace ?? process.cwd())) {
    throw new Error("Vitest evidence workspace must not traverse a symbolic link.");
  }
  if (options.runner === undefined) {
    assertVitestProcessGroupInventoryCapability(workspace);
  }
  const captureLock = acquireVitestExecutionCaptureLock(workspace);
  let temporaryDirectory: string | null = null;
  let captureError: unknown;
  let captureFailed = false;
  let containmentUnproven = false;
  let committedEvidenceIntegrityUnproven = false;
  try {
    assertNoOrphanedVitestExecutionStagingFiles(workspace);
    temporaryDirectory = mkdtempSync(
      resolve(realpathSync("/tmp"), "diesel-vitest-evidence-"),
    );
    const reportPath = resolve(temporaryDirectory, "vitest-report.json");
    const runner = options.runner ?? runCanonicalVitestExecution;
    assertVitestExecutionWorkspaceContract(workspace);
    const boundSink = bindEvidenceSink(workspace);
    const outputPath = resolve(workspace, vitestExecutionEvidencePath);
    const installationState = capturePnpmInstallationState(workspace);
    let persistenceCommitted = false;
    let sinkReplacedByCapture = false;
    try {
      const started = captureVitestExecutionRepositoryState(workspace);
      let exitCode: number | undefined;
      let runnerError: unknown;
      let runnerFailed = false;
      try {
        exitCode = runner({
          reportPath,
          storeDirConfigValue: installationState.storeDirConfigValue,
          workspace,
        });
      } catch (cause: unknown) {
        runnerFailed = true;
        runnerError = cause;
        containmentUnproven = isVitestWorkloadTerminationUnproven(cause);
      }
      let installationStateError: unknown;
      let installationStateFailed = false;
      try {
        assertVitestDependencyBoundary(
          installationState,
          workspace,
          "Vitest runner pnpm installation state",
        );
      } catch (cause: unknown) {
        installationStateError = cause;
        installationStateFailed = true;
      }
      let sinkMatchesAfterRunner: boolean;
      try {
        sinkMatchesAfterRunner = evidenceSinkStillMatches(
          outputPath,
          boundSink,
        );
      } catch (sinkCause: unknown) {
        if (runnerFailed || installationStateFailed) {
          throw new AggregateError(
            [
              ...(runnerFailed ? [runnerError] : []),
              ...(installationStateFailed ? [installationStateError] : []),
              sinkCause,
            ],
            "Vitest runner, dependency-state verification, or post-run evidence-sink inspection failed.",
          );
        }
        throw sinkCause;
      }
      if (!sinkMatchesAfterRunner) {
        const sinkMutationError = new Error(
          "Vitest runner modified the protected execution-evidence sink.",
          runnerFailed ? { cause: runnerError } : undefined,
        );
        if (installationStateFailed) {
          throw new AggregateError(
            [sinkMutationError, installationStateError],
            "Vitest runner changed the evidence sink and dependency state.",
          );
        }
        throw sinkMutationError;
      }
      if (runnerFailed && installationStateFailed) {
        throw new AggregateError(
          [runnerError, installationStateError],
          "Vitest runner and dependency-state verification both failed.",
        );
      }
      if (runnerFailed) throw runnerError;
      if (installationStateFailed) throw installationStateError;
      let normalizedReport: NormalizedVitestJsonReport;
      try {
        normalizedReport = normalizeVitestJsonReporterOutput(
          readBoundedReporterOutput(reportPath),
          workspace,
        );
      } catch (reportCause: unknown) {
        if (exitCode !== 0) {
          throw new AggregateError(
            [
              new Error(`Vitest execution exited with status ${exitCode}.`),
              reportCause,
            ],
            "Vitest execution failed and its JSON reporter output was unavailable or invalid.",
          );
        }
        throw reportCause;
      }
      if (exitCode !== 0) {
        const failedIds = normalizedReport.failureDiagnostics
          .map(({ id }) => id)
          .join(",");
        const omitted = normalizedReport.totals.failedTests -
          normalizedReport.failureDiagnostics.length;
        throw new Error(
          `Vitest execution failed with exit status ${exitCode}; reporter recorded ` +
            `${normalizedReport.totals.collectedFiles} files / ` +
            `${normalizedReport.totals.collectedTests} tests / ` +
            `${normalizedReport.totals.failedTests} failed / ` +
            `${normalizedReport.totals.pendingTests} pending` +
            `${failedIds.length > 0 ? `; first failed IDs=${failedIds}` : ""}` +
            `; failure diagnostics=${JSON.stringify(normalizedReport.failureDiagnostics)}` +
            `; omitted failures=${omitted}.`,
        );
      }
      const completed = captureVitestExecutionRepositoryState(workspace);
      const evidence = buildVitestExecutionEvidence({
        completed,
        normalizedReport,
        runId: options.runId ?? randomUUID(),
        started,
      });
      assertEvidenceSinkStillMatches(
        outputPath,
        boundSink,
        "before persistence",
      );
      const serializedEvidence = await persistVitestExecutionEvidenceAtomic(
        workspace,
        evidence,
        {
          assertPrecommit(temporaryPath) {
            const transientRepositoryPath = relative(workspace, temporaryPath)
              .split(sep)
              .join("/");
            assertVerificationEqual(
              captureVitestExecutionRepositoryState(
                workspace,
                undefined,
                [transientRepositoryPath],
              ),
              completed,
              "Vitest execution persistence-precommit source",
            );
            assertEvidenceSinkStillMatches(
              outputPath,
              boundSink,
              "at the persistence precommit boundary",
            );
            assertVitestDependencyBoundary(
              installationState,
              workspace,
              "Vitest execution persistence-precommit pnpm installation state",
            );
          },
          onCommitted() {
            sinkReplacedByCapture = true;
            options.afterEvidenceCommitForTesting?.();
          },
        },
      );
      const committedSink = bindEvidenceSink(workspace);
      assertCommittedEvidenceMatches(committedSink, serializedEvidence);
      assertVerificationEqual(
        captureVitestExecutionRepositoryState(workspace),
        completed,
        "Vitest execution post-persistence source",
      );
      assertEvidenceSinkStillMatches(
        outputPath,
        committedSink,
        "after the post-persistence source check",
      );
      assertVitestDependencyBoundary(
        installationState,
        workspace,
        "Vitest execution post-persistence pnpm installation state",
      );
      persistenceCommitted = true;
      return evidence;
    } catch (cause: unknown) {
      if (!persistenceCommitted) {
        if (sinkReplacedByCapture) {
          committedEvidenceIntegrityUnproven = true;
          throw new AggregateError(
            [
              cause,
              new Error(
                "The capture replaced the evidence sink before final verification failed; the replacement was preserved for operator inspection.",
              ),
            ],
            "Vitest execution capture failed after its atomic evidence commit.",
          );
        }
        let sinkStillMatches: boolean;
        try {
          sinkStillMatches = evidenceSinkStillMatches(outputPath, boundSink);
        } catch (sinkInspectionCause: unknown) {
          throw new AggregateError(
            [cause, sinkInspectionCause],
            "Vitest capture failure and evidence-sink inspection both failed.",
          );
        }
        if (!sinkStillMatches) {
          throw new AggregateError(
            [
              cause,
              new Error(
                "The evidence sink changed outside the capture commit and was preserved without rollback.",
              ),
            ],
            "Vitest execution capture failed with an unknown evidence-sink mutation.",
          );
        }
      }
      throw cause;
    }
  } catch (cause: unknown) {
    captureFailed = true;
    captureError = cause;
    throw cause;
  } finally {
    const cleanupErrors: unknown[] = [];
    const preserveCaptureLock =
      containmentUnproven || committedEvidenceIntegrityUnproven;
    if (!preserveCaptureLock) {
      try {
        if (temporaryDirectory !== null) {
          rmSync(temporaryDirectory, { force: true, recursive: true });
        }
      } catch (cleanupError: unknown) {
        cleanupErrors.push(cleanupError);
      }
    }
    if (!preserveCaptureLock) {
      try {
        captureLock.release();
      } catch (releaseError: unknown) {
        cleanupErrors.push(releaseError);
      }
    }
    if (cleanupErrors.length > 0) {
      if (captureFailed) {
        throw new AggregateError(
          [captureError, ...cleanupErrors],
          "Vitest execution capture and cleanup both failed.",
        );
      }
      if (cleanupErrors.length === 1) throw cleanupErrors[0];
      throw new AggregateError(
        cleanupErrors,
        "Vitest execution capture cleanup failed.",
      );
    }
    if (preserveCaptureLock) {
      const preservationErrors: unknown[] = [captureError];
      let preservationVerified = true;
      try {
        captureLock.assertOwned();
      } catch (ownershipCause: unknown) {
        preservationVerified = false;
        preservationErrors.push(ownershipCause);
      }
      if (temporaryDirectory !== null) {
        try {
          const metadata = lstatSync(temporaryDirectory);
          if (
            metadata.isSymbolicLink() ||
            !metadata.isDirectory() ||
            realpathSync(temporaryDirectory) !== temporaryDirectory
          ) {
            throw new Error(
              "The preserved Vitest evidence directory is not trustworthy.",
            );
          }
        } catch (directoryCause: unknown) {
          preservationVerified = false;
          preservationErrors.push(directoryCause);
        }
      }
      preservationErrors.push(
        new Error(
          preservationVerified
            ? "The capture lock, guard link " +
              `${captureLock.guardPath}, and temporary evidence directory ` +
              `${temporaryDirectory ?? "[not-created]"} were verified and ` +
              "preserved because " +
              (containmentUnproven && committedEvidenceIntegrityUnproven
                ? "workload termination and committed evidence integrity are unproven."
                : containmentUnproven
                ? "workload termination is unproven."
                : "committed evidence integrity is unproven.")
            : "Capture safety is unproven and at least one intended " +
              `preservation postcondition could not be verified; lock=${captureLock.path}; ` +
              `guard=${captureLock.guardPath}; evidenceDirectory=${temporaryDirectory ?? "[not-created]"}.`,
        ),
      );
      throw new AggregateError(
        preservationErrors,
        containmentUnproven
          ? "Vitest execution capture halted without releasing its containment state."
          : "Vitest execution capture halted without releasing its committed-evidence inspection state.",
      );
    }
  }
}

async function main(): Promise<void> {
  const evidence = await captureVitestExecutionEvidence();
  process.stdout.write(
    `Captured ${evidence.totals.collectedFiles} Vitest files / ` +
      `${evidence.totals.collectedTests} tests in ${vitestExecutionEvidencePath}; ` +
      `runId=${evidence.runId}; source=` +
      `${evidence.provenance.sourceFingerprint.fileCount} files/` +
      `${evidence.provenance.sourceFingerprint.digest}.\n`,
  );
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(resolve(invokedPath)).href
) {
  void main().catch((error: unknown) => {
    process.stderr.write(formatVitestExecutionCaptureError(error));
    process.exitCode = 1;
  });
}
