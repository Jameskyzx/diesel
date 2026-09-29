import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fchownSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FIXED_PM2_ROOT = "/root/.pm2";
const FIXED_CONFIGURED_CWD = "/opt/diesel/current";
const FIXED_SHARED_ROOT = "/opt/diesel/shared";
const FIXED_NODE_BINARY = "/opt/node-v22.22.3-linux-x64/bin/node";
const FIXED_VPS_PATH =
  "/opt/node-v22.22.3-linux-x64/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const FAILURE_MESSAGE = "PM2 durable release state validation failed.";
const MAX_DUMP_BYTES = 16 * 1024 * 1024;
const safeReleaseIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const numericIdentityPattern = /^(?:0|[1-9][0-9]{0,9})$/u;

function fail() {
  throw new Error(FAILURE_MESSAGE);
}

function hasExactMetadata(metadata, mode) {
  return metadata.uid === 0n &&
    metadata.gid === 0n &&
    Number(metadata.mode & 0o7777n) === mode;
}

function sameInode(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function assertSafeReleaseId(expectedReleaseId) {
  if (
    typeof expectedReleaseId !== "string" ||
    !safeReleaseIdPattern.test(expectedReleaseId)
  ) {
    fail();
  }
}

function normalizeNumericIdentity(identity) {
  if (
    typeof identity === "number" &&
    Number.isInteger(identity) &&
    identity >= 0 &&
    identity <= 4294967294
  ) {
    return identity;
  }
  if (
    typeof identity !== "string" ||
    !numericIdentityPattern.test(identity)
  ) {
    fail();
  }
  const normalized = Number(identity);
  if (!Number.isSafeInteger(normalized) || normalized > 4294967294) fail();
  return normalized;
}

function visibleApplicationName(application) {
  if (typeof application !== "object" || application === null) return [];
  const names = [];
  if (typeof application.name === "string") names.push(application.name);
  if (typeof application.pm2_env?.name === "string") {
    names.push(application.pm2_env.name);
  }
  return names;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactStringArray(actual, expected) {
  return Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index]);
}

function expectedLaunchArguments(expectedReleaseId) {
  return [
    "-i",
    `HOME=${FIXED_SHARED_ROOT}`,
    `PATH=${FIXED_VPS_PATH}`,
    "NODE_ENV=production",
    `APP_VERSION=${expectedReleaseId}`,
    FIXED_NODE_BINARY,
    "--env-file=.env.production.local",
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "8788",
  ];
}

export function validatePm2DumpDocument(
  document,
  expectedReleaseId,
  expectedRuntimeUid,
  expectedRuntimeGid,
) {
  assertSafeReleaseId(expectedReleaseId);
  const expectedUid = normalizeNumericIdentity(expectedRuntimeUid);
  const expectedGid = normalizeNumericIdentity(expectedRuntimeGid);
  if (!Array.isArray(document)) fail();

  // PM2 persists each process's pm2_env object directly at the top level.
  // A nested pm2_env is therefore a decoy or an incompatible state shape,
  // never an alternate source of release identity.
  if (
    document.some(
      (application) =>
        isRecord(application) && Object.hasOwn(application, "pm2_env"),
    )
  ) {
    fail();
  }

  const matchingApplications = document.filter((application) =>
    visibleApplicationName(application).includes("diesel-demo")
  );
  if (matchingApplications.length !== 1) fail();
  const matchingApplication = matchingApplications[0];
  const matchingNames = visibleApplicationName(matchingApplication);
  if (matchingNames.some((name) => name !== "diesel-demo")) fail();

  const environment = matchingApplication.env;
  const expectedArguments = expectedLaunchArguments(expectedReleaseId);
  if (
    matchingApplication.name !== "diesel-demo" ||
    !isRecord(environment) ||
    matchingApplication.APP_VERSION !== expectedReleaseId ||
    environment.APP_VERSION !== expectedReleaseId ||
    matchingApplication.pm_cwd !== FIXED_CONFIGURED_CWD ||
    matchingApplication.pm_exec_path !== "/usr/bin/env" ||
    matchingApplication.exec_interpreter !== "none" ||
    matchingApplication.exec_mode !== "fork_mode" ||
    !hasExactStringArray(matchingApplication.node_args, []) ||
    matchingApplication.autorestart !== true ||
    matchingApplication.max_memory_restart !== 1073741824 ||
    matchingApplication.uid !== expectedUid ||
    matchingApplication.gid !== expectedGid ||
    !hasExactStringArray(matchingApplication.args, expectedArguments) ||
    (Object.hasOwn(matchingApplication, "cwd") &&
      matchingApplication.cwd !== FIXED_CONFIGURED_CWD) ||
    (Object.hasOwn(matchingApplication, "script") &&
      matchingApplication.script !== "/usr/bin/env") ||
    (Object.hasOwn(matchingApplication, "interpreter") &&
      matchingApplication.interpreter !== "none")
  ) {
    fail();
  }
  return true;
}

function parseAndValidateDump(
  contents,
  expectedReleaseId,
  expectedRuntimeUid,
  expectedRuntimeGid,
) {
  let document;
  try {
    document = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(contents));
  } catch {
    fail();
  }
  validatePm2DumpDocument(
    document,
    expectedReleaseId,
    expectedRuntimeUid,
    expectedRuntimeGid,
  );
}

function assertCanonicalPm2Root(pm2Root) {
  if (typeof pm2Root !== "string" || resolve(pm2Root) !== pm2Root) fail();
  const metadata = lstatSync(pm2Root, { bigint: true });
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    realpathSync(pm2Root) !== pm2Root ||
    !hasExactMetadata(metadata, 0o700)
  ) {
    fail();
  }
}

function openRegularSingleLink(path, flags) {
  const discovered = lstatSync(path, { bigint: true });
  if (
    !discovered.isFile() ||
    discovered.isSymbolicLink() ||
    discovered.nlink !== 1n ||
    realpathSync(path) !== path
  ) {
    fail();
  }
  const descriptor = openSync(path, flags | constants.O_NOFOLLOW);
  const opened = fstatSync(descriptor, { bigint: true });
  if (
    !opened.isFile() ||
    opened.nlink !== 1n ||
    !sameInode(discovered, opened)
  ) {
    closeSync(descriptor);
    fail();
  }
  return descriptor;
}

function readBoundedDump(descriptor) {
  const beforeRead = fstatSync(descriptor, { bigint: true });
  if (beforeRead.size > BigInt(MAX_DUMP_BYTES)) fail();

  const buffer = Buffer.allocUnsafe(MAX_DUMP_BYTES + 1);
  let offset = 0;
  while (offset < buffer.length) {
    const bytesRead = readSync(
      descriptor,
      buffer,
      offset,
      buffer.length - offset,
      null,
    );
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  const afterRead = fstatSync(descriptor, { bigint: true });
  if (offset > MAX_DUMP_BYTES || afterRead.size !== BigInt(offset)) fail();
  return buffer.subarray(0, offset);
}

function normalizeAndReadPrimary(
  path,
  expectedReleaseId,
  expectedRuntimeUid,
  expectedRuntimeGid,
) {
  const descriptor = openRegularSingleLink(path, constants.O_RDWR);
  try {
    fchownSync(descriptor, 0, 0);
    fchmodSync(descriptor, 0o600);
    const normalized = fstatSync(descriptor, { bigint: true });
    if (
      !normalized.isFile() ||
      normalized.nlink !== 1n ||
      !hasExactMetadata(normalized, 0o600)
    ) {
      fail();
    }
    const contents = readBoundedDump(descriptor);
    parseAndValidateDump(
      contents,
      expectedReleaseId,
      expectedRuntimeUid,
      expectedRuntimeGid,
    );
    return contents;
  } finally {
    closeSync(descriptor);
  }
}

function createDurableBackup(pm2Root, backupPath, contents) {
  let temporaryPath = resolve(
    pm2Root,
    `.dump.pm2.bak.${process.pid}.${randomUUID()}`,
  );
  let descriptor;
  try {
    descriptor = openSync(
      temporaryPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    fchownSync(descriptor, 0, 0);
    fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, contents);
    const metadata = fstatSync(descriptor, { bigint: true });
    if (
      !metadata.isFile() ||
      metadata.nlink !== 1n ||
      !hasExactMetadata(metadata, 0o600)
    ) {
      fail();
    }
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporaryPath, backupPath);
    temporaryPath = undefined;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (temporaryPath !== undefined) {
      try {
        unlinkSync(temporaryPath);
      } catch {
        // The fixed outer error handles cleanup failures without exposing paths.
      }
    }
  }
}

function openValidatedFinalDump(
  path,
  expectedReleaseId,
  expectedRuntimeUid,
  expectedRuntimeGid,
) {
  const descriptor = openRegularSingleLink(path, constants.O_RDONLY);
  try {
    const metadata = fstatSync(descriptor, { bigint: true });
    if (!hasExactMetadata(metadata, 0o600)) fail();
    const contents = readBoundedDump(descriptor);
    parseAndValidateDump(
      contents,
      expectedReleaseId,
      expectedRuntimeUid,
      expectedRuntimeGid,
    );
    return { contents, descriptor };
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

function assertPathStillNamesDescriptor(path, descriptor) {
  const discovered = lstatSync(path, { bigint: true });
  const opened = fstatSync(descriptor, { bigint: true });
  if (
    !discovered.isFile() ||
    discovered.isSymbolicLink() ||
    discovered.nlink !== 1n ||
    !sameInode(discovered, opened) ||
    !hasExactMetadata(discovered, 0o600)
  ) {
    fail();
  }
}

function persistPm2ReleaseStateUnchecked(
  expectedReleaseId,
  pm2Root,
  expectedRuntimeUid,
  expectedRuntimeGid,
) {
  assertSafeReleaseId(expectedReleaseId);
  assertCanonicalPm2Root(pm2Root);
  const primaryPath = resolve(pm2Root, "dump.pm2");
  const backupPath = resolve(pm2Root, "dump.pm2.bak");
  const primaryContents = normalizeAndReadPrimary(
    primaryPath,
    expectedReleaseId,
    expectedRuntimeUid,
    expectedRuntimeGid,
  );

  createDurableBackup(pm2Root, backupPath, primaryContents);
  let primary;
  let backup;
  let directoryDescriptor;
  try {
    primary = openValidatedFinalDump(
      primaryPath,
      expectedReleaseId,
      expectedRuntimeUid,
      expectedRuntimeGid,
    );
    backup = openValidatedFinalDump(
      backupPath,
      expectedReleaseId,
      expectedRuntimeUid,
      expectedRuntimeGid,
    );
    if (!primary.contents.equals(backup.contents)) fail();
    assertPathStillNamesDescriptor(primaryPath, primary.descriptor);
    assertPathStillNamesDescriptor(backupPath, backup.descriptor);
    fsyncSync(primary.descriptor);
    fsyncSync(backup.descriptor);
    assertCanonicalPm2Root(pm2Root);
    directoryDescriptor = openSync(
      pm2Root,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const directoryMetadata = fstatSync(directoryDescriptor, { bigint: true });
    if (
      !directoryMetadata.isDirectory() ||
      !hasExactMetadata(directoryMetadata, 0o700)
    ) {
      fail();
    }
    fsyncSync(directoryDescriptor);
    assertPathStillNamesDescriptor(primaryPath, primary.descriptor);
    assertPathStillNamesDescriptor(backupPath, backup.descriptor);
  } finally {
    if (directoryDescriptor !== undefined) closeSync(directoryDescriptor);
    if (primary !== undefined) closeSync(primary.descriptor);
    if (backup !== undefined) closeSync(backup.descriptor);
  }
}

export function persistPm2ReleaseState(
  expectedReleaseId,
  pm2Root,
  expectedRuntimeUid,
  expectedRuntimeGid,
) {
  try {
    persistPm2ReleaseStateUnchecked(
      expectedReleaseId,
      pm2Root,
      expectedRuntimeUid,
      expectedRuntimeGid,
    );
  } catch {
    fail();
  }
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(resolve(process.argv[1])) ===
      realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  try {
    if (process.argv.length !== 5 || process.getuid?.() !== 0) fail();
    persistPm2ReleaseState(
      process.argv[2],
      FIXED_PM2_ROOT,
      process.argv[3],
      process.argv[4],
    );
  } catch {
    process.stderr.write(`${FAILURE_MESSAGE}\n`);
    process.exitCode = 70;
  }
}
