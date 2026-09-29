import { constants, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  lstat,
  open,
  readdir,
  readlink,
  realpath,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

const BUILD_MARKER_FORMAT = "diesel-build-complete-v2";
const READY_MARKER_FORMAT = "diesel-deploy-ready-v1";
const INPUT_MANIFEST_FORMAT = "diesel-release-input-v2";
const ARTIFACT_DIGEST_FORMAT = "diesel-release-artifacts-v1";
const BUILD_MARKER_NAME = ".build-complete";
const READY_MARKER_NAME = ".deploy-ready";
const INPUT_MANIFEST_NAME = ".release-input-manifest.json";
const RUNTIME_ENVIRONMENT_LINK_NAME = ".env.production.local";
const RUNTIME_DATA_LINK_NAME = ".data";
const BUILD_ID_PATH = ".next/BUILD_ID";
const MAX_INPUT_MANIFEST_BYTES = 64 * 1024 * 1024;
const MAX_ARTIFACT_MARKER_BYTES = 64 * 1024;
const FILE_HASH_BUFFER_BYTES = 1024 * 1024;
const ROOT_PATHS = [".next", "node_modules"];
const EXCLUDED_RELEASE_INPUT_ENTRIES = new Set([
  ...ROOT_PATHS,
  BUILD_MARKER_NAME,
  READY_MARKER_NAME,
  INPUT_MANIFEST_NAME,
  RUNTIME_ENVIRONMENT_LINK_NAME,
  RUNTIME_DATA_LINK_NAME,
]);
const EXCLUDED_CACHE_PATH = ".next/cache";
const CONTROLLER_DIRECTORY_MODE = 0o755n;
const RELEASE_DIRECTORY_MODE = 0o750n;
const CONTROL_FILE_MODE = 0o640n;
const RUNTIME_ENVIRONMENT_MODE = 0o640n;
const RUNTIME_MUTABLE_DIRECTORY_MODE = 0o750n;
const IMMUTABLE_UNSAFE_MODE_BITS = 0o7022n;
const gitCommitPattern = /^[0-9a-f]{40}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const nextBuildIdPattern = /^[A-Za-z0-9._-]{1,200}$/u;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/u;

function fail(message) {
  throw new Error(message);
}

function assertExactKeys(value, keys, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
  const actual = Object.keys(value).sort(comparePaths);
  const expected = [...keys].sort(comparePaths);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} contains an unexpected field set.`);
  }
}

function assertCommit(value, label) {
  if (typeof value !== "string" || !gitCommitPattern.test(value)) {
    fail(`${label} must be a full lowercase Git commit SHA.`);
  }
}

function assertSha256(value, label) {
  if (typeof value !== "string" || !sha256Pattern.test(value)) {
    fail(`${label} must be a lowercase SHA-256 digest.`);
  }
}

function assertSafeInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail(`${label} must be a safe integer greater than or equal to ${minimum}.`);
  }
}

function assertFixedPath(path, expectedName, label) {
  if (resolve(path) !== resolve(process.cwd(), expectedName)) {
    fail(`${label} must be ${expectedName} at the build root.`);
  }
}

function isSafeRelativePath(path) {
  return path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !controlCharacterPattern.test(path) &&
    !path.includes("\uFFFD") &&
    !path.split("/").some(
      (segment) => segment === "" || segment === "." || segment === "..",
    );
}

function isSafeEntryName(name) {
  return name.length > 0 &&
    name !== "." &&
    name !== ".." &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !controlCharacterPattern.test(name) &&
    !name.includes("\uFFFD");
}

function comparePaths(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function encodeLength(value) {
  const encoded = Buffer.alloc(8);
  encoded.writeBigUInt64BE(BigInt(value));
  return encoded;
}

function updateString(hash, value) {
  const bytes = Buffer.from(value, "utf8");
  hash.update(encodeLength(bytes.byteLength));
  hash.update(bytes);
}

function updateInteger(hash, value) {
  hash.update(encodeLength(value));
}

function computeInputManifestDigest(commit, files) {
  const hash = createHash("sha256");
  hash.update(`${INPUT_MANIFEST_FORMAT}\0`, "utf8");
  hash.update(commit, "utf8");
  for (const file of files) {
    updateString(hash, file.path);
    updateString(hash, file.mode);
    updateInteger(hash, file.size);
    hash.update(Buffer.from(file.sha256, "hex"));
  }
  return hash.digest("hex");
}

function fileExecutable(metadata) {
  return (metadata.mode & 0o111n) === 0n ? 0 : 1;
}

function permissionMode(metadata) {
  return metadata.mode & 0o7777n;
}

function formatMode(mode) {
  return mode.toString(8).padStart(4, "0");
}

function assertOwnedMetadata(metadata, label, identity, exactMode = null) {
  if (!identity) return;
  if (metadata.uid !== identity.uid || metadata.gid !== identity.gid) {
    fail(`${label} has an unexpected owner or group.`);
  }
  if (metadata.isSymbolicLink()) return;
  const mode = permissionMode(metadata);
  if (exactMode === null) {
    if ((mode & IMMUTABLE_UNSAFE_MODE_BITS) !== 0n) {
      fail(`${label} has unsafe immutable permissions: ${formatMode(mode)}.`);
    }
    return;
  }
  if (mode !== exactMode) {
    fail(
      `${label} must have mode ${formatMode(exactMode)}, not ${formatMode(mode)}.`,
    );
  }
}

function metadataIdentityMatches(left, right) {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.uid === right.uid &&
    left.gid === right.gid &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs;
}

async function readBoundedRegularFile(
  path,
  label,
  maximumBytes,
  identity = null,
  exactMode = null,
) {
  const discovered = await lstat(path, { bigint: true }).catch(() => null);
  if (
    !discovered?.isFile() ||
    discovered.isSymbolicLink() ||
    discovered.nlink !== 1n ||
    discovered.size > BigInt(maximumBytes)
  ) {
    fail(`${label} must be a bounded, singly linked regular file.`);
  }
  if (identity) assertOwnedMetadata(discovered, label, identity, exactMode);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW).catch(
    () => null,
  );
  if (!handle) {
    fail(`${label} could not be opened without following symlinks.`);
  }
  try {
    const before = await handle.stat({ bigint: true });
    if (
      !before.isFile() ||
      before.nlink !== 1n ||
      before.size > BigInt(maximumBytes) ||
      before.dev !== discovered.dev ||
      before.ino !== discovered.ino
    ) {
      fail(`${label} changed before it could be read.`);
    }
    if (identity) assertOwnedMetadata(before, label, identity, exactMode);
    const contents = await handle.readFile({ encoding: "utf8" });
    const after = await handle.stat({ bigint: true });
    if (
      !metadataIdentityMatches(before, after) ||
      Buffer.byteLength(contents) !== Number(before.size)
    ) {
      fail(`${label} changed while it was being read.`);
    }
    return contents;
  } finally {
    await handle.close();
  }
}

function parseJson(contents, label) {
  try {
    return JSON.parse(contents);
  } catch {
    fail(`${label} is not valid JSON.`);
  }
}

function parseInputManifest(contents, expectedCommit) {
  const parsed = parseJson(contents, "Release input manifest");
  assertExactKeys(
    parsed,
    ["commit", "files", "format", "inputDigest"],
    "Release input manifest",
  );
  if (parsed.format !== INPUT_MANIFEST_FORMAT) {
    fail("Release input manifest has an unsupported format.");
  }
  assertCommit(parsed.commit, "Release input manifest commit");
  if (parsed.commit !== expectedCommit) {
    fail("Release input manifest commit does not match the expected release commit.");
  }
  assertSha256(parsed.inputDigest, "Release input manifest inputDigest");
  if (!Array.isArray(parsed.files) || parsed.files.length === 0) {
    fail("Release input manifest must contain at least one file.");
  }
  const files = [];
  for (const [index, file] of parsed.files.entries()) {
    const label = `Release input manifest file ${index + 1}`;
    assertExactKeys(file, ["mode", "path", "sha256", "size"], label);
    if (file.mode !== "100644" && file.mode !== "100755") {
      fail(`${label} has an unsupported Git mode.`);
    }
    if (typeof file.path !== "string" || !isSafeRelativePath(file.path)) {
      fail(`${label} has an unsafe path.`);
    }
    assertSha256(file.sha256, `${label} sha256`);
    assertSafeInteger(file.size, `${label} size`);
    files.push({
      mode: file.mode,
      path: file.path,
      sha256: file.sha256,
      size: file.size,
    });
  }
  const paths = files.map(({ path }) => path);
  const sortedPaths = [...paths].sort(comparePaths);
  if (
    new Set(paths).size !== paths.length ||
    JSON.stringify(paths) !== JSON.stringify(sortedPaths)
  ) {
    fail("Release input manifest paths must be unique and bytewise sorted.");
  }
  const recomputedDigest = computeInputManifestDigest(parsed.commit, files);
  if (recomputedDigest !== parsed.inputDigest) {
    fail("Release input manifest inputDigest does not match its entries.");
  }
  return {
    files,
    inputDigest: parsed.inputDigest,
    releaseCommit: parsed.commit,
  };
}

async function readReleaseMetadata(expectedCommit, immutableIdentity = null) {
  const inputPath = resolve(process.cwd(), INPUT_MANIFEST_NAME);
  const buildIdPath = resolve(process.cwd(), BUILD_ID_PATH);
  const input = parseInputManifest(
    await readBoundedRegularFile(
      inputPath,
      "Release input manifest",
      MAX_INPUT_MANIFEST_BYTES,
      immutableIdentity,
      immutableIdentity ? CONTROL_FILE_MODE : null,
    ),
    expectedCommit,
  );
  const nextBuildId = (
    await readBoundedRegularFile(buildIdPath, "Next BUILD_ID", 1024)
  ).trim();
  if (!nextBuildIdPattern.test(nextBuildId)) {
    fail("Next BUILD_ID has an unsafe format.");
  }
  return {
    inputDigest: input.inputDigest,
    nextBuildId,
    releaseCommit: input.releaseCommit,
  };
}

async function listCurrentReleaseInputTree(
  directory,
  immutableIdentity,
  prefix = "",
) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => comparePaths(left.name, right.name));
  const directories = [];
  const files = [];
  for (const entry of entries) {
    if (
      prefix.length === 0 &&
      EXCLUDED_RELEASE_INPUT_ENTRIES.has(entry.name)
    ) {
      continue;
    }
    const path = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
    const absolute = resolve(directory, entry.name);
    const metadata = await lstat(absolute, { bigint: true }).catch(() => null);
    const kind = metadata ? entryKind(metadata) : null;
    if (
      !isSafeRelativePath(path) ||
      entry.isSymbolicLink() ||
      !metadata ||
      kind === "symlink"
    ) {
      fail(`Release input contains an unsafe path or symlink: ${path}.`);
    }
    if (entry.isDirectory() && kind === "directory") {
      assertOwnedMetadata(
        metadata,
        `Release input directory ${path}`,
        immutableIdentity,
        RELEASE_DIRECTORY_MODE,
      );
      directories.push(path);
      const children = await listCurrentReleaseInputTree(
        absolute,
        immutableIdentity,
        path,
      );
      directories.push(...children.directories);
      files.push(...children.files);
      continue;
    }
    if (!entry.isFile() || kind !== "file") {
      fail(`Release input is not a regular file or directory: ${path}.`);
    }
    assertOwnedMetadata(
      metadata,
      `Release input file ${path}`,
      immutableIdentity,
      fileExecutable(metadata) === 1 ? 0o750n : 0o640n,
    );
    files.push(path);
  }
  return { directories, files };
}

async function verifyReleaseInputFile(file, hashBuffer, immutableIdentity) {
  const path = resolve(process.cwd(), ...file.path.split("/"));
  const discovered = await lstat(path, { bigint: true }).catch(() => null);
  if (
    !discovered?.isFile() ||
    discovered.isSymbolicLink() ||
    discovered.nlink !== 1n ||
    discovered.size !== BigInt(file.size) ||
    fileExecutable(discovered) !== (file.mode === "100755" ? 1 : 0)
  ) {
    fail(`Release input metadata drifted from the manifest: ${file.path}.`);
  }
  assertOwnedMetadata(
    discovered,
    `Release input file ${file.path}`,
    immutableIdentity,
    file.mode === "100755" ? 0o750n : 0o640n,
  );
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  ).catch(() => null);
  if (!handle) {
    fail(`Release input could not be opened without following symlinks: ${file.path}.`);
  }
  try {
    const before = await handle.stat({ bigint: true });
    if (!metadataIdentityMatches(discovered, before)) {
      fail(`Release input changed before it could be hashed: ${file.path}.`);
    }
    assertOwnedMetadata(
      before,
      `Release input file ${file.path}`,
      immutableIdentity,
      file.mode === "100755" ? 0o750n : 0o640n,
    );
    const hash = createHash("sha256");
    let totalBytes = 0n;
    while (true) {
      const { bytesRead } = await handle.read(
        hashBuffer,
        0,
        hashBuffer.byteLength,
        null,
      );
      if (bytesRead === 0) break;
      hash.update(hashBuffer.subarray(0, bytesRead));
      totalBytes += BigInt(bytesRead);
    }
    const after = await handle.stat({ bigint: true });
    if (
      !metadataIdentityMatches(before, after) ||
      totalBytes !== before.size ||
      hash.digest("hex") !== file.sha256
    ) {
      fail(`Release input content drifted from the manifest: ${file.path}.`);
    }
  } finally {
    await handle.close();
  }
}

function currentEffectiveUserId() {
  if (typeof process.getuid !== "function") {
    fail("Deploy-ready verification requires a Unix effective user ID.");
  }
  const value = process.getuid();
  if (!Number.isSafeInteger(value) || value < 0) {
    fail("Deploy-ready verification could not resolve a safe effective user ID.");
  }
  return BigInt(value);
}

function currentEffectiveGroupId() {
  if (typeof process.getgid !== "function") {
    fail("Deploy-ready verification requires a Unix effective group ID.");
  }
  const value = process.getgid();
  if (!Number.isSafeInteger(value) || value < 0) {
    fail("Deploy-ready verification could not resolve a safe effective group ID.");
  }
  return BigInt(value);
}

function parseUnixId(value, label) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    fail(`${label} must be a canonical decimal Unix ID.`);
  }
  const parsed = BigInt(value);
  if (parsed > 0xffffffffn) {
    fail(`${label} exceeds the supported Unix ID range.`);
  }
  return parsed;
}

function assertProductionActivationIdentity(activationIdentity) {
  const effectiveUid = currentEffectiveUserId();
  const effectiveGid = currentEffectiveGroupId();
  if (effectiveUid !== 0n || effectiveGid !== 0n) {
    fail("Production check-ready must run as the root controller identity.");
  }
  if (
    activationIdentity.immutable.uid !== 0n ||
    activationIdentity.immutable.gid === 0n ||
    activationIdentity.runtime.uid === 0n ||
    activationIdentity.runtime.gid === 0n ||
    activationIdentity.runtime.uid === activationIdentity.immutable.uid ||
    activationIdentity.runtime.gid !== activationIdentity.immutable.gid
  ) {
    fail(
      "Production check-ready requires root:<runtime-group> immutable ownership and a distinct non-root runtime identity.",
    );
  }
}

async function verifyCanonicalReleaseBoundary(
  expectedCommit,
  immutableIdentity,
) {
  const releaseDirectory = resolve(process.cwd());
  const releasesDirectory = dirname(releaseDirectory);
  const deployDirectory = dirname(releasesDirectory);
  if (
    basename(releaseDirectory) !== expectedCommit ||
    basename(releasesDirectory) !== "releases"
  ) {
    fail("Deploy-ready verification must run from the canonical release directory.");
  }
  const controllerIdentity = {
    gid: currentEffectiveGroupId(),
    uid: currentEffectiveUserId(),
  };
  const deployMetadata = await assertRealDirectory(
    deployDirectory,
    "Deployment root directory",
    controllerIdentity,
    CONTROLLER_DIRECTORY_MODE,
  );
  const releasesMetadata = await assertRealDirectory(
    releasesDirectory,
    "Releases directory",
    controllerIdentity,
    CONTROLLER_DIRECTORY_MODE,
  );
  const metadata = await assertRealDirectory(
    releaseDirectory,
    "Canonical release directory",
  );
  if (immutableIdentity.uid !== controllerIdentity.uid) {
    fail("Deploy-ready verification must run as the immutable release owner.");
  }
  assertOwnedMetadata(
    metadata,
    "Canonical release directory",
    immutableIdentity,
    RELEASE_DIRECTORY_MODE,
  );
  return {
    identity: immutableIdentity,
    deployDirectory,
    deployMetadata,
    metadata,
    releaseDirectory,
    releasesDirectory,
    releasesMetadata,
  };
}

async function verifyRuntimeLink(
  path,
  expectedTarget,
  expectedKind,
  expectedIdentity,
  expectedMode,
  requireSingleLink,
) {
  const discovered = await lstat(path, { bigint: true }).catch(() => null);
  if (!discovered?.isSymbolicLink()) {
    fail(`Runtime ${expectedKind} entry must be a symlink: ${basename(path)}.`);
  }
  const target = await readlink(path);
  const resolvedTarget = await realpath(resolve(dirname(path), target)).catch(
    () => null,
  );
  const resolvedExpectedTarget = await realpath(expectedTarget).catch(
    () => null,
  );
  if (!resolvedTarget || resolvedTarget !== resolvedExpectedTarget) {
    fail(`Runtime ${expectedKind} link has an unexpected target: ${basename(path)}.`);
  }
  const targetMetadata = await lstat(expectedTarget, { bigint: true }).catch(
    () => null,
  );
  if (
    expectedKind === "environment"
      ? !targetMetadata?.isFile() || targetMetadata.isSymbolicLink()
      : !targetMetadata?.isDirectory() || targetMetadata.isSymbolicLink()
  ) {
    fail(`Runtime ${expectedKind} link target has an invalid type.`);
  }
  if (requireSingleLink && targetMetadata.nlink !== 1n) {
    fail(`Runtime ${expectedKind} link target must be singly linked.`);
  }
  assertOwnedMetadata(
    targetMetadata,
    `Runtime ${expectedKind} link target`,
    expectedIdentity,
    expectedMode,
  );
  const confirmedTarget = await lstat(
    expectedTarget,
    { bigint: true },
  ).catch(() => null);
  if (
    !confirmedTarget ||
    confirmedTarget.dev !== targetMetadata.dev ||
    confirmedTarget.ino !== targetMetadata.ino ||
    confirmedTarget.mode !== targetMetadata.mode ||
    confirmedTarget.uid !== targetMetadata.uid ||
    confirmedTarget.gid !== targetMetadata.gid ||
    (requireSingleLink && !metadataIdentityMatches(targetMetadata, confirmedTarget))
  ) {
    fail(`Runtime ${expectedKind} link target changed while it was verified.`);
  }
  const after = await lstat(path, { bigint: true }).catch(() => null);
  if (!after?.isSymbolicLink() || !metadataIdentityMatches(discovered, after)) {
    fail(`Runtime ${expectedKind} link changed while it was verified.`);
  }
}

async function verifyRuntimeLinks(boundary, runtimeIdentity) {
  const {
    identity: immutableIdentity,
    releaseDirectory,
    releasesDirectory,
  } = boundary;
  const sharedDirectory = resolve(releasesDirectory, "..", "shared");
  const sharedMetadata = await assertRealDirectory(
    sharedDirectory,
    "Shared runtime directory",
    immutableIdentity,
    RELEASE_DIRECTORY_MODE,
  );
  const cacheMetadata = await assertRealDirectory(
    resolve(releaseDirectory, EXCLUDED_CACHE_PATH),
    EXCLUDED_CACHE_PATH,
  );
  assertOwnedMetadata(
    cacheMetadata,
    EXCLUDED_CACHE_PATH,
    runtimeIdentity,
    RUNTIME_MUTABLE_DIRECTORY_MODE,
  );
  await verifyRuntimeLink(
    resolve(releaseDirectory, RUNTIME_ENVIRONMENT_LINK_NAME),
    resolve(sharedDirectory, RUNTIME_ENVIRONMENT_LINK_NAME),
    "environment",
    immutableIdentity,
    RUNTIME_ENVIRONMENT_MODE,
    true,
  );
  await verifyRuntimeLink(
    resolve(releaseDirectory, RUNTIME_DATA_LINK_NAME),
    resolve(sharedDirectory, RUNTIME_DATA_LINK_NAME),
    "data",
    runtimeIdentity,
    RUNTIME_MUTABLE_DIRECTORY_MODE,
    false,
  );
  const confirmedShared = await lstat(
    sharedDirectory,
    { bigint: true },
  ).catch(() => null);
  if (!confirmedShared || !metadataIdentityMatches(sharedMetadata, confirmedShared)) {
    fail("Shared runtime directory changed while links were verified.");
  }
}

function expectedInputDirectories(files) {
  const directories = new Set();
  for (const file of files) {
    const segments = file.path.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index).join("/"));
    }
  }
  return [...directories].sort(comparePaths);
}

async function verifyReleaseInputState(expectedCommit, immutableIdentity) {
  const inputPath = resolve(process.cwd(), INPUT_MANIFEST_NAME);
  const manifestText = await readBoundedRegularFile(
    inputPath,
    "Release input manifest",
    MAX_INPUT_MANIFEST_BYTES,
    immutableIdentity,
    CONTROL_FILE_MODE,
  );
  const manifest = parseInputManifest(manifestText, expectedCommit);
  const actual = await listCurrentReleaseInputTree(
    process.cwd(),
    immutableIdentity,
  );
  actual.directories.sort(comparePaths);
  actual.files.sort(comparePaths);
  const expectedFiles = manifest.files.map(({ path }) => path);
  const expectedDirectories = expectedInputDirectories(manifest.files);
  if (
    JSON.stringify(actual.files) !== JSON.stringify(expectedFiles) ||
    JSON.stringify(actual.directories) !== JSON.stringify(expectedDirectories)
  ) {
    fail("Release input paths do not exactly match the release input manifest.");
  }
  const hashBuffer = Buffer.alloc(FILE_HASH_BUFFER_BYTES);
  for (const file of manifest.files) {
    await verifyReleaseInputFile(file, hashBuffer, immutableIdentity);
  }
  const confirmedManifestText = await readBoundedRegularFile(
    inputPath,
    "Release input manifest",
    MAX_INPUT_MANIFEST_BYTES,
    immutableIdentity,
    CONTROL_FILE_MODE,
  );
  if (confirmedManifestText !== manifestText) {
    fail("Release input manifest changed while its files were verified.");
  }
  return manifest.inputDigest;
}

function isWithin(path, root) {
  return path === root || path.startsWith(`${root}${sep}`);
}

function isInClosure(path, roots) {
  return roots.some((root) => isWithin(path, root));
}

function isInExcludedCache(path, cachePath) {
  return isWithin(path, cachePath);
}

function entryKind(metadata) {
  if (metadata.isDirectory() && !metadata.isSymbolicLink()) return "directory";
  if (metadata.isFile() && !metadata.isSymbolicLink()) return "file";
  if (metadata.isSymbolicLink()) return "symlink";
  return null;
}

async function assertRealDirectory(
  path,
  label,
  identity = null,
  exactMode = null,
) {
  const metadata = await lstat(path, { bigint: true }).catch(() => null);
  if (!metadata?.isDirectory() || metadata.isSymbolicLink()) {
    fail(`${label} must be a real directory, not a symlink.`);
  }
  if (identity) assertOwnedMetadata(metadata, label, identity, exactMode);
  return metadata;
}

async function discoverEntries(
  rootAbsolute,
  rootPath,
  immutableIdentity,
  relativePath = "",
) {
  const directoryAbsolute = relativePath.length === 0
    ? rootAbsolute
    : join(rootAbsolute, ...relativePath.split("/"));
  const before = await assertRealDirectory(
    directoryAbsolute,
    `Artifact directory ${rootPath}${relativePath ? `/${relativePath}` : ""}`,
    immutableIdentity,
    immutableIdentity ? RELEASE_DIRECTORY_MODE : null,
  );
  const names = await readdir(directoryAbsolute);
  names.sort(comparePaths);
  const entries = [];
  for (const name of names) {
    if (!isSafeEntryName(name)) {
      fail(`Artifact tree contains an unsafe entry name under ${rootPath}.`);
    }
    const childRelative = relativePath.length === 0
      ? name
      : `${relativePath}/${name}`;
    if (rootPath === ".next" && childRelative === "cache") {
      await assertRealDirectory(
        join(rootAbsolute, "cache"),
        EXCLUDED_CACHE_PATH,
      );
      continue;
    }
    const childAbsolute = join(rootAbsolute, ...childRelative.split("/"));
    const metadata = await lstat(childAbsolute, { bigint: true }).catch(() => null);
    const kind = metadata ? entryKind(metadata) : null;
    if (!metadata || !kind) {
      fail(`Artifact tree contains a missing or special node: ${rootPath}/${childRelative}.`);
    }
    assertOwnedMetadata(
      metadata,
      `Artifact ${kind} ${rootPath}/${childRelative}`,
      immutableIdentity,
      kind === "directory"
        ? RELEASE_DIRECTORY_MODE
        : kind === "file"
          ? (fileExecutable(metadata) === 1 ? 0o750n : 0o640n)
          : null,
    );
    entries.push({ absolute: childAbsolute, kind, relative: childRelative });
    if (kind === "directory") {
      const childEntries = await discoverEntries(
        rootAbsolute,
        rootPath,
        immutableIdentity,
        childRelative,
      );
      for (const childEntry of childEntries) {
        entries.push(childEntry);
      }
    }
  }
  const after = await lstat(directoryAbsolute, { bigint: true }).catch(() => null);
  if (!after?.isDirectory() || !metadataIdentityMatches(before, after)) {
    fail(`Artifact directory changed while it was being enumerated: ${rootPath}/${relativePath}.`);
  }
  return entries;
}

async function hashRegularFile(
  path,
  discoveredMetadata,
  label,
  seenInodes,
  hashBuffer,
) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW).catch(
    () => null,
  );
  if (!handle) {
    fail(`Artifact file could not be opened without following symlinks: ${label}.`);
  }
  try {
    const before = await handle.stat({ bigint: true });
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== 1n ||
      before.dev !== discoveredMetadata.dev ||
      before.ino !== discoveredMetadata.ino
    ) {
      fail(`Artifact file is a symlink, hardlink, or changed node: ${label}.`);
    }
    const inodeKey = `${before.dev}:${before.ino}`;
    if (seenInodes.has(inodeKey)) {
      fail(`Artifact files share a hardlinked inode: ${label}.`);
    }
    seenInodes.add(inodeKey);

    const hash = createHash("sha256");
    let totalBytes = 0n;
    while (true) {
      const { bytesRead } = await handle.read(
        hashBuffer,
        0,
        hashBuffer.byteLength,
        null,
      );
      if (bytesRead === 0) break;
      hash.update(hashBuffer.subarray(0, bytesRead));
      totalBytes += BigInt(bytesRead);
    }
    const after = await handle.stat({ bigint: true });
    if (
      !metadataIdentityMatches(before, after) ||
      totalBytes !== before.size
    ) {
      fail(`Artifact file changed while it was being hashed: ${label}.`);
    }
    return {
      digest: hash.digest("hex"),
      metadata: after,
      size: totalBytes,
    };
  } finally {
    await handle.close();
  }
}

async function validateSymlink(
  path,
  metadata,
  label,
  closureRoots,
  realClosureRoots,
  excludedCache,
  realExcludedCache,
) {
  const target = await readlink(path);
  if (
    target.length === 0 ||
    isAbsolute(target) ||
    target.includes("\\") ||
    controlCharacterPattern.test(target) ||
    target.includes("\uFFFD")
  ) {
    fail(`Artifact symlink must have a safe relative target: ${label}.`);
  }
  const lexicalTarget = resolve(dirname(path), target);
  if (
    !isInClosure(lexicalTarget, closureRoots) ||
    isInExcludedCache(lexicalTarget, excludedCache)
  ) {
    fail(`Artifact symlink escapes the immutable artifact closure: ${label}.`);
  }
  const finalTarget = await realpath(path).catch(() => null);
  if (
    !finalTarget ||
    !isInClosure(finalTarget, realClosureRoots) ||
    isInExcludedCache(finalTarget, realExcludedCache)
  ) {
    fail(`Artifact symlink is dangling, cyclic, or escapes the artifact closure: ${label}.`);
  }
  const after = await lstat(path, { bigint: true }).catch(() => null);
  if (!after?.isSymbolicLink() || !metadataIdentityMatches(metadata, after)) {
    fail(`Artifact symlink changed while it was being validated: ${label}.`);
  }
  return { metadata: after, target };
}

async function computeRootAggregate(
  rootPath,
  rootAbsolute,
  closureRoots,
  realClosureRoots,
  excludedCache,
  realExcludedCache,
  seenInodes,
  hashBuffer,
  immutableIdentity,
) {
  await assertRealDirectory(
    rootAbsolute,
    rootPath,
    immutableIdentity,
    RELEASE_DIRECTORY_MODE,
  );
  const entries = await discoverEntries(
    rootAbsolute,
    rootPath,
    immutableIdentity,
  );
  entries.sort((left, right) => comparePaths(left.relative, right.relative));

  const hash = createHash("sha256");
  hash.update(`${ARTIFACT_DIGEST_FORMAT}:root\0`, "utf8");
  updateString(hash, rootPath);

  let directories = 1;
  let files = 0;
  let symlinks = 0;
  let totalBytes = 0n;
  for (const entry of entries) {
    const metadata = await lstat(entry.absolute, { bigint: true }).catch(() => null);
    if (!metadata || entryKind(metadata) !== entry.kind) {
      fail(`Artifact entry changed while it was being hashed: ${rootPath}/${entry.relative}.`);
    }
    assertOwnedMetadata(
      metadata,
      `Artifact ${entry.kind} ${rootPath}/${entry.relative}`,
      immutableIdentity,
      entry.kind === "directory"
        ? RELEASE_DIRECTORY_MODE
        : entry.kind === "file"
          ? (fileExecutable(metadata) === 1 ? 0o750n : 0o640n)
          : null,
    );
    updateString(hash, entry.relative);
    updateString(hash, entry.kind);
    if (entry.kind === "directory") {
      directories += 1;
      continue;
    }
    if (entry.kind === "file") {
      const file = await hashRegularFile(
        entry.absolute,
        metadata,
        `${rootPath}/${entry.relative}`,
        seenInodes,
        hashBuffer,
      );
      updateInteger(hash, fileExecutable(file.metadata));
      updateInteger(hash, file.size);
      hash.update(Buffer.from(file.digest, "hex"));
      files += 1;
      totalBytes += file.size;
      continue;
    }
    const symlink = await validateSymlink(
      entry.absolute,
      metadata,
      `${rootPath}/${entry.relative}`,
      closureRoots,
      realClosureRoots,
      excludedCache,
      realExcludedCache,
    );
    updateString(hash, symlink.target);
    symlinks += 1;
  }
  if (totalBytes > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail(`${rootPath} contains too many bytes to represent safely in JSON.`);
  }
  await assertRealDirectory(excludedCache, EXCLUDED_CACHE_PATH);
  return {
    digest: hash.digest("hex"),
    directories,
    files,
    path: rootPath,
    symlinks,
    totalBytes: Number(totalBytes),
  };
}

async function computeRoots(immutableIdentity = null) {
  const closureRoots = ROOT_PATHS.map((path) => resolve(process.cwd(), path));
  const realClosureRoots = [];
  for (const [index, path] of closureRoots.entries()) {
    await assertRealDirectory(
      path,
      ROOT_PATHS[index],
      immutableIdentity,
      immutableIdentity ? RELEASE_DIRECTORY_MODE : null,
    );
    realClosureRoots.push(await realpath(path));
  }
  const excludedCache = resolve(process.cwd(), EXCLUDED_CACHE_PATH);
  await assertRealDirectory(excludedCache, EXCLUDED_CACHE_PATH);
  const realExcludedCache = await realpath(excludedCache);
  const seenInodes = new Set();
  const hashBuffer = Buffer.allocUnsafe(FILE_HASH_BUFFER_BYTES);
  const roots = [];
  for (const [index, rootAbsolute] of closureRoots.entries()) {
    roots.push(await computeRootAggregate(
      ROOT_PATHS[index],
      rootAbsolute,
      closureRoots,
      realClosureRoots,
      excludedCache,
      realExcludedCache,
      seenInodes,
      hashBuffer,
      immutableIdentity,
    ));
  }
  return roots;
}

function computeArtifactDigest(metadata, roots) {
  const hash = createHash("sha256");
  hash.update(`${ARTIFACT_DIGEST_FORMAT}\0`, "utf8");
  updateString(hash, metadata.releaseCommit);
  updateString(hash, metadata.inputDigest);
  updateString(hash, metadata.nextBuildId);
  for (const root of roots) {
    updateString(hash, root.path);
    hash.update(Buffer.from(root.digest, "hex"));
    updateInteger(hash, root.directories);
    updateInteger(hash, root.files);
    updateInteger(hash, root.symlinks);
    updateInteger(hash, root.totalBytes);
  }
  return hash.digest("hex");
}

async function computeCurrentManifest(
  expectedCommit,
  format,
  immutableIdentity = null,
) {
  const metadataBefore = await readReleaseMetadata(
    expectedCommit,
    immutableIdentity,
  );
  const roots = await computeRoots(immutableIdentity);
  const metadataAfter = await readReleaseMetadata(
    expectedCommit,
    immutableIdentity,
  );
  if (JSON.stringify(metadataAfter) !== JSON.stringify(metadataBefore)) {
    fail("Release metadata changed while artifacts were being hashed.");
  }
  return {
    artifactDigest: computeArtifactDigest(metadataBefore, roots),
    format,
    inputDigest: metadataBefore.inputDigest,
    nextBuildId: metadataBefore.nextBuildId,
    releaseCommit: metadataBefore.releaseCommit,
    roots,
  };
}

function parseRoot(root, index) {
  const label = `Artifact marker root ${index + 1}`;
  assertExactKeys(
    root,
    ["digest", "directories", "files", "path", "symlinks", "totalBytes"],
    label,
  );
  if (root.path !== ROOT_PATHS[index]) {
    fail("Artifact marker roots must use the fixed bytewise root order.");
  }
  assertSha256(root.digest, `${label} digest`);
  assertSafeInteger(root.directories, `${label} directories`, 1);
  assertSafeInteger(root.files, `${label} files`);
  assertSafeInteger(root.symlinks, `${label} symlinks`);
  assertSafeInteger(root.totalBytes, `${label} totalBytes`);
  return {
    digest: root.digest,
    directories: root.directories,
    files: root.files,
    path: root.path,
    symlinks: root.symlinks,
    totalBytes: root.totalBytes,
  };
}

function parseArtifactMarker(contents, expectedFormat, label) {
  const parsed = parseJson(contents, label);
  assertExactKeys(
    parsed,
    [
      "artifactDigest",
      "format",
      "inputDigest",
      "nextBuildId",
      "releaseCommit",
      "roots",
    ],
    label,
  );
  if (parsed.format !== expectedFormat) {
    fail(`${label} has an unsupported format.`);
  }
  assertSha256(parsed.artifactDigest, `${label} artifactDigest`);
  assertSha256(parsed.inputDigest, `${label} inputDigest`);
  assertCommit(parsed.releaseCommit, `${label} releaseCommit`);
  if (
    typeof parsed.nextBuildId !== "string" ||
    !nextBuildIdPattern.test(parsed.nextBuildId)
  ) {
    fail(`${label} nextBuildId has an unsafe format.`);
  }
  if (!Array.isArray(parsed.roots) || parsed.roots.length !== ROOT_PATHS.length) {
    fail(`${label} must contain exactly the fixed artifact roots.`);
  }
  const roots = parsed.roots.map(parseRoot);
  const artifactDigest = computeArtifactDigest(
    {
      inputDigest: parsed.inputDigest,
      nextBuildId: parsed.nextBuildId,
      releaseCommit: parsed.releaseCommit,
    },
    roots,
  );
  if (artifactDigest !== parsed.artifactDigest) {
    fail(`${label} artifactDigest does not match its metadata and roots.`);
  }
  return {
    artifactDigest: parsed.artifactDigest,
    format: parsed.format,
    inputDigest: parsed.inputDigest,
    nextBuildId: parsed.nextBuildId,
    releaseCommit: parsed.releaseCommit,
    roots,
  };
}

async function readArtifactMarker(
  path,
  expectedFormat,
  label,
  immutableIdentity = null,
) {
  return parseArtifactMarker(
    await readBoundedRegularFile(
      path,
      label,
      MAX_ARTIFACT_MARKER_BYTES,
      immutableIdentity,
      immutableIdentity ? CONTROL_FILE_MODE : null,
    ),
    expectedFormat,
    label,
  );
}

function serializeMarker(marker) {
  return `${JSON.stringify(marker, null, 2)}\n`;
}

async function overwriteBuildMarker(path, marker) {
  const discovered = await lstat(path, { bigint: true }).catch(() => null);
  if (
    !discovered?.isFile() ||
    discovered.isSymbolicLink() ||
    discovered.nlink !== 1n ||
    discovered.size > BigInt(MAX_ARTIFACT_MARKER_BYTES)
  ) {
    fail(`${BUILD_MARKER_NAME} must be a pre-created, singly linked regular file.`);
  }
  const handle = await open(
    path,
    constants.O_WRONLY | constants.O_NOFOLLOW,
  ).catch(() => null);
  if (!handle) {
    fail(`${BUILD_MARKER_NAME} could not be opened without following symlinks.`);
  }
  try {
    const opened = await handle.stat({ bigint: true });
    if (
      !opened.isFile() ||
      opened.nlink !== 1n ||
      opened.dev !== discovered.dev ||
      opened.ino !== discovered.ino
    ) {
      fail(`${BUILD_MARKER_NAME} changed before it could be written.`);
    }
    await handle.chmod(0o600);
    await handle.truncate(0);
    await handle.writeFile(serializeMarker(marker), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeReadyMarker(path, marker) {
  await writeFile(path, serializeMarker(marker), {
    encoding: "utf8",
    flag: "wx",
    mode: 0o640,
  });
  const handle = await open(path, constants.O_WRONLY | constants.O_NOFOLLOW);
  try {
    await handle.chmod(0o640);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function manifestsMatch(left, right) {
  return left.artifactDigest === right.artifactDigest &&
    left.inputDigest === right.inputDigest &&
    left.nextBuildId === right.nextBuildId &&
    left.releaseCommit === right.releaseCommit &&
    JSON.stringify(left.roots) === JSON.stringify(right.roots);
}

async function createBuildMarker(expectedCommit, markerPath) {
  const manifest = await computeCurrentManifest(
    expectedCommit,
    BUILD_MARKER_FORMAT,
  );
  await overwriteBuildMarker(markerPath, manifest);
  return manifest;
}

async function verifyBuildMarker(
  expectedCommit,
  markerPath,
  immutableIdentity = null,
) {
  const marker = await readArtifactMarker(
    markerPath,
    BUILD_MARKER_FORMAT,
    "Build-complete marker",
    immutableIdentity,
  );
  if (marker.releaseCommit !== expectedCommit) {
    fail("Build-complete marker releaseCommit does not match the expected release commit.");
  }
  const current = await computeCurrentManifest(
    expectedCommit,
    BUILD_MARKER_FORMAT,
    immutableIdentity,
  );
  if (!manifestsMatch(marker, current)) {
    fail("Build artifacts or bound release metadata drifted from the build-complete marker.");
  }
  return marker;
}

async function finalizeReadyMarker(expectedCommit, markerPath, readyPath) {
  const marker = await verifyBuildMarker(expectedCommit, markerPath);
  const ready = { ...marker, format: READY_MARKER_FORMAT };
  await writeReadyMarker(readyPath, ready);
  return ready;
}

async function checkReadyMarker(
  expectedCommit,
  markerPath,
  readyPath,
  activationIdentity,
) {
  const boundary = await verifyCanonicalReleaseBoundary(
    expectedCommit,
    activationIdentity.immutable,
  );
  const marker = await verifyBuildMarker(
    expectedCommit,
    markerPath,
    boundary.identity,
  );
  const verifiedInputDigest = await verifyReleaseInputState(
    expectedCommit,
    boundary.identity,
  );
  if (verifiedInputDigest !== marker.inputDigest) {
    fail("Verified release inputs do not match the build-complete marker.");
  }
  await verifyRuntimeLinks(boundary, activationIdentity.runtime);
  const ready = await readArtifactMarker(
    readyPath,
    READY_MARKER_FORMAT,
    "Deploy-ready marker",
    boundary.identity,
  );
  if (
    marker.releaseCommit !== expectedCommit ||
    ready.releaseCommit !== expectedCommit
  ) {
    fail("Artifact marker releaseCommit does not match the expected release commit.");
  }
  if (!manifestsMatch(marker, ready)) {
    fail("Deploy-ready marker metadata does not match the build-complete marker.");
  }
  for (const [path, metadata, label] of [
    [boundary.deployDirectory, boundary.deployMetadata, "Deployment root"],
    [boundary.releasesDirectory, boundary.releasesMetadata, "Releases directory"],
    [boundary.releaseDirectory, boundary.metadata, "Canonical release directory"],
  ]) {
    const confirmed = await lstat(path, { bigint: true }).catch(() => null);
    if (!confirmed || !metadataIdentityMatches(metadata, confirmed)) {
      fail(`${label} changed during deploy-ready verification.`);
    }
  }
  return ready;
}

function usage() {
  return "usage: release-artifact-manifest.mjs <create|verify> <full-git-sha> .build-complete\n" +
    "   or: release-artifact-manifest.mjs finalize <full-git-sha> .build-complete .deploy-ready\n" +
    "   or: release-artifact-manifest.mjs check-ready <full-git-sha> .build-complete .deploy-ready <immutable-uid> <immutable-gid> <runtime-uid> <runtime-gid>";
}

async function main() {
  const [command, expectedCommit, markerPath, readyPath, ...identityArguments] =
    process.argv.slice(2);
  assertCommit(expectedCommit, "Expected release commit");
  if (!markerPath) fail(usage());
  assertFixedPath(markerPath, BUILD_MARKER_NAME, "Build-complete marker path");

  let result;
  if (
    (command === "create" || command === "verify") &&
    !readyPath &&
    identityArguments.length === 0
  ) {
    result = command === "create"
      ? await createBuildMarker(expectedCommit, resolve(markerPath))
      : await verifyBuildMarker(expectedCommit, resolve(markerPath));
  } else if (
    command === "finalize" &&
    readyPath &&
    identityArguments.length === 0
  ) {
    assertFixedPath(readyPath, READY_MARKER_NAME, "Deploy-ready marker path");
    result = await finalizeReadyMarker(
      expectedCommit,
      resolve(markerPath),
      resolve(readyPath),
    );
  } else if (
    command === "check-ready" &&
    readyPath &&
    identityArguments.length === 4
  ) {
    assertFixedPath(readyPath, READY_MARKER_NAME, "Deploy-ready marker path");
    const [immutableUid, immutableGid, runtimeUid, runtimeGid] =
      identityArguments;
    const activationIdentity = {
      immutable: {
        gid: parseUnixId(immutableGid, "Immutable group ID"),
        uid: parseUnixId(immutableUid, "Immutable user ID"),
      },
      runtime: {
        gid: parseUnixId(runtimeGid, "Runtime group ID"),
        uid: parseUnixId(runtimeUid, "Runtime user ID"),
      },
    };
    assertProductionActivationIdentity(activationIdentity);
    result = await checkReadyMarker(
      expectedCommit,
      resolve(markerPath),
      resolve(readyPath),
      activationIdentity,
    );
  } else {
    fail(usage());
  }
  process.stdout.write(`${result.artifactDigest}\n`);
}

export { checkReadyMarker as checkReadyMarkerForTesting };

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
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Release artifact manifest failed."}\n`,
    );
    process.exitCode = 1;
  });
}
