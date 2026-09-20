import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";

const MANIFEST_FORMAT = "diesel-release-input-v2";
const MANIFEST_NAME = ".release-input-manifest.json";
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
const gitCommitPattern = /^[0-9a-f]{40}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const unsafePathCharacterPattern = /[\u0000-\u001f\u007f\ufffd]/u;
const excludedBuildDirectories = new Set([".next", "node_modules"]);
const buildControlFiles = new Set([
  MANIFEST_NAME,
  ".build-complete",
  ".deploy-ready",
]);
const forbiddenReleaseRootNames = new Set([
  ".data",
  ".git",
  ".next",
  ".next-e2e",
  ".pnpm-store",
  "backups",
  "coverage",
  "node_modules",
  "out",
  "playwright-report",
  "test-results",
  "tmp",
]);

function fail(message) {
  throw new Error(message);
}

function assertExactKeys(value, keys, label) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    fail(`${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} contains an unexpected field set.`);
  }
}

function assertCommit(value, label) {
  if (typeof value !== "string" || !gitCommitPattern.test(value)) {
    fail(`${label} must be a full lowercase Git commit SHA.`);
  }
}

function isSafeRelativePath(path) {
  return path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !unsafePathCharacterPattern.test(path) &&
    !path.split("/").some((segment) => segment === "" || segment === "." || segment === "..");
}

function isForbiddenReleasePath(path) {
  const [rootName] = path.split("/", 1);
  if (!rootName) {
    return true;
  }
  if (rootName.startsWith(".env")) {
    return path !== ".env.example";
  }
  return forbiddenReleaseRootNames.has(rootName);
}

function comparePaths(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function encodeLength(value) {
  const encoded = Buffer.alloc(8);
  encoded.writeBigUInt64BE(BigInt(value));
  return encoded;
}

function contentSha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function computeManifestDigest(commit, files) {
  const hash = createHash("sha256");
  hash.update(`${MANIFEST_FORMAT}\0`, "utf8");
  hash.update(commit, "utf8");
  for (const file of files) {
    const pathBytes = Buffer.from(file.path, "utf8");
    const modeBytes = Buffer.from(file.mode, "utf8");
    hash.update(encodeLength(pathBytes.byteLength));
    hash.update(pathBytes);
    hash.update(encodeLength(modeBytes.byteLength));
    hash.update(modeBytes);
    hash.update(encodeLength(file.size));
    hash.update(Buffer.from(file.sha256, "hex"));
  }
  return hash.digest("hex");
}

function runGit(args, options = {}) {
  const result = spawnSync("git", [
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "diff.external=",
    ...args,
  ], {
    cwd: process.cwd(),
    encoding: options.encoding ?? "utf8",
    env: {
      HOME: "/nonexistent",
      LANG: "C",
      LC_ALL: "C",
      PATH: process.env.PATH,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_NO_REPLACE_OBJECTS: "1",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
      NO_COLOR: "1",
    },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    fail(`git ${args.join(" ")} failed while creating the release manifest.`);
  }
  return result.stdout;
}

async function readRegularFile(path, label) {
  const metadata = await lstat(path).catch(() => null);
  if (!metadata?.isFile() || metadata.isSymbolicLink()) {
    fail(`${label} must be a regular file, not a symlink.`);
  }
  return {
    content: await readFile(path),
    mode: metadata.mode & 0o111 ? "100755" : "100644",
  };
}

async function captureTrackedFiles(commit) {
  const output = runGit(
    ["ls-tree", "-r", "-z", commit],
    { encoding: "buffer" },
  );
  const entries = output
    .toString("utf8")
    .split("\0")
    .filter((record) => record.length > 0)
    .map((record) => {
      const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/u.exec(record);
      if (!match?.[2] || !match[3]) {
        fail("The release commit contains a symlink, submodule, or malformed tree entry.");
      }
      return { mode: match[1], objectId: match[2], path: match[3] };
    })
    .sort((left, right) => comparePaths(left.path, right.path));
  if (
    entries.length === 0 ||
    new Set(entries.map(({ path }) => path)).size !== entries.length
  ) {
    fail("The tracked release input list is empty or contains duplicates.");
  }

  const files = [];
  for (const { mode, objectId, path } of entries) {
    if (
      !isSafeRelativePath(path) ||
      buildControlFiles.has(path) ||
      isForbiddenReleasePath(path)
    ) {
      fail(`Tracked release input has an unsafe or reserved path: ${path}.`);
    }
    const content = runGit(
      ["show", `${commit}:${path}`],
      { encoding: "buffer" },
    );
    const computedObjectId = createHash("sha1")
      .update(`blob ${content.byteLength}\0`, "utf8")
      .update(content)
      .digest("hex");
    if (computedObjectId !== objectId) {
      fail(`Git object content does not match the release tree: ${path}.`);
    }
    files.push({
      mode,
      path,
      sha256: contentSha256(content),
      size: content.byteLength,
    });
  }
  return files;
}

function assertCleanTrackedWorktree() {
  const status = runGit([
    "status",
    "--porcelain=v1",
    "--untracked-files=no",
  ]).trim();
  if (status.length > 0) {
    fail("Tracked release inputs must come from a clean worktree.");
  }
}

async function createManifest(expectedCommit, outputPath) {
  assertCommit(expectedCommit, "Expected release commit");
  const headBefore = runGit([
    "rev-parse",
    "--verify",
    "HEAD^{commit}",
  ]).trim();
  if (headBefore !== expectedCommit) {
    fail("Expected release commit does not match the current Git HEAD.");
  }
  assertCleanTrackedWorktree();
  const files = await captureTrackedFiles(expectedCommit);
  assertCleanTrackedWorktree();
  const headAfter = runGit([
    "rev-parse",
    "--verify",
    "HEAD^{commit}",
  ]).trim();
  if (headAfter !== headBefore) {
    fail("Git HEAD changed while the release manifest was being created.");
  }

  const manifest = {
    commit: expectedCommit,
    files,
    format: MANIFEST_FORMAT,
    inputDigest: computeManifestDigest(expectedCommit, files),
  };
  await writeFile(
    resolve(outputPath),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  process.stdout.write(`${manifest.inputDigest}\n`);
}

function parseManifest(contents) {
  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch {
    fail("Release input manifest is not valid JSON.");
  }
  assertExactKeys(
    parsed,
    ["commit", "files", "format", "inputDigest"],
    "Release input manifest",
  );
  if (parsed.format !== MANIFEST_FORMAT) {
    fail("Release input manifest has an unsupported format.");
  }
  assertCommit(parsed.commit, "Manifest commit");
  if (typeof parsed.inputDigest !== "string" || !sha256Pattern.test(parsed.inputDigest)) {
    fail("Manifest inputDigest must be a lowercase SHA-256 digest.");
  }
  if (!Array.isArray(parsed.files) || parsed.files.length === 0) {
    fail("Release input manifest must contain at least one file.");
  }

  const files = parsed.files.map((file, index) => {
    assertExactKeys(
      file,
      ["mode", "path", "sha256", "size"],
      `Manifest file ${index + 1}`,
    );
    if (file.mode !== "100644" && file.mode !== "100755") {
      fail(`Manifest file ${index + 1} has an invalid Git mode.`);
    }
    if (
      typeof file.path !== "string" ||
      !isSafeRelativePath(file.path) ||
      isForbiddenReleasePath(file.path)
    ) {
      fail(`Manifest file ${index + 1} has an unsafe path.`);
    }
    if (buildControlFiles.has(file.path)) {
      fail(`Manifest file ${file.path} uses a reserved build path.`);
    }
    if (typeof file.sha256 !== "string" || !sha256Pattern.test(file.sha256)) {
      fail(`Manifest file ${file.path} has an invalid SHA-256 digest.`);
    }
    if (!Number.isSafeInteger(file.size) || file.size < 0) {
      fail(`Manifest file ${file.path} has an invalid size.`);
    }
    return {
      mode: file.mode,
      path: file.path,
      sha256: file.sha256,
      size: file.size,
    };
  });
  const sortedPaths = files.map(({ path }) => path).toSorted(comparePaths);
  if (
    new Set(sortedPaths).size !== sortedPaths.length ||
    JSON.stringify(files.map(({ path }) => path)) !== JSON.stringify(sortedPaths)
  ) {
    fail("Manifest file paths must be unique and bytewise sorted.");
  }
  const recomputedDigest = computeManifestDigest(parsed.commit, files);
  if (recomputedDigest !== parsed.inputDigest) {
    fail("Release input manifest digest does not match its entries.");
  }
  return { ...parsed, files };
}

async function listBuildInputFiles(directory, prefix = "") {
  const paths = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => comparePaths(left.name, right.name));
  for (const entry of entries) {
    const path = prefix.length > 0 ? `${prefix}/${entry.name}` : entry.name;
    if (
      prefix.length === 0 &&
      excludedBuildDirectories.has(entry.name)
    ) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        fail(`${entry.name} must be a regular build-output directory.`);
      }
      continue;
    }
    if (prefix.length === 0 && buildControlFiles.has(entry.name)) {
      if (!entry.isFile() || entry.isSymbolicLink()) {
        fail(`${entry.name} must be a regular build control file.`);
      }
      continue;
    }
    if (!isSafeRelativePath(path) || entry.isSymbolicLink()) {
      fail(`Build input contains an unsafe path or symlink: ${path}.`);
    }
    if (entry.isDirectory()) {
      paths.push(...await listBuildInputFiles(resolve(directory, entry.name), path));
    } else if (entry.isFile()) {
      paths.push(path);
    } else {
      fail(`Build input is not a regular file or directory: ${path}.`);
    }
  }
  return paths;
}

async function verifyManifest(expectedCommit, manifestPath) {
  assertCommit(expectedCommit, "Expected release commit");
  const absoluteManifestPath = resolve(manifestPath);
  if (absoluteManifestPath !== resolve(process.cwd(), MANIFEST_NAME)) {
    fail(`Release input manifest must be named ${MANIFEST_NAME} at the build root.`);
  }
  const metadata = await lstat(absoluteManifestPath).catch(() => null);
  if (
    !metadata?.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size > MAX_MANIFEST_BYTES
  ) {
    fail("Release input manifest must be a bounded regular file, not a symlink.");
  }
  const manifest = parseManifest(await readFile(absoluteManifestPath, "utf8"));
  if (manifest.commit !== expectedCommit) {
    fail("Release input manifest commit does not match BUILD_RELEASE_ID.");
  }
  const actualPaths = (await listBuildInputFiles(process.cwd())).sort(comparePaths);
  const expectedPaths = manifest.files.map(({ path }) => path);
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    fail("Build input paths do not exactly match the release input manifest.");
  }
  for (const file of manifest.files) {
    const { content, mode } = await readRegularFile(
      resolve(process.cwd(), ...file.path.split("/")),
      `Build input ${file.path}`,
    );
    if (mode !== file.mode) {
      fail(`Build input mode drifted from the release manifest: ${file.path}.`);
    }
    if (
      content.byteLength !== file.size ||
      contentSha256(content) !== file.sha256
    ) {
      fail(`Build input content drifted from the release manifest: ${file.path}.`);
    }
  }
  process.stdout.write(`${manifest.inputDigest}\n`);
}

async function main() {
  const [command, expectedCommit, path, ...extra] = process.argv.slice(2);
  if (
    extra.length > 0 ||
    !expectedCommit ||
    !path ||
    (command !== "create" && command !== "verify")
  ) {
    fail(
      "usage: release-input-manifest.mjs <create|verify> <full-git-sha> <manifest-path>",
    );
  }
  if (command === "create") {
    await createManifest(expectedCommit, path);
    return;
  }
  await verifyManifest(expectedCommit, path);
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Release input manifest failed."}\n`,
  );
  process.exitCode = 1;
});
