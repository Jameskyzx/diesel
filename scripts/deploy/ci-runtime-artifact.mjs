import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ciRuntimeMetadataSchema, parseReleaseAuthorizationOutput } from "./verify-release-authorization.bundle.mjs";

const commitPattern = /^[0-9a-f]{40}$/u;
const nodeVersion = "v22.22.3";
const helperRoot = dirname(fileURLToPath(import.meta.url));
function check(value, message) { if (!value) throw new Error(message); }
export async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest("hex");
}
export function parseRuntimeMetadata(value, release) {
  check(commitPattern.test(release), "invalid release");
  const parsed = ciRuntimeMetadataSchema.parse(value);
  check(parsed.release === release, "CI runtime metadata mismatch");
  return parsed;
}
async function readMetadata(path, release) {
  const stat = await lstat(path);
  check(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 8192, "invalid metadata file");
  return parseRuntimeMetadata(JSON.parse(await readFile(path, "utf8")), release);
}
function command(file, args, cwd = process.cwd()) {
  const result = spawnSync(file, args, { cwd, env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" }, encoding: "utf8", timeout: 20 * 60_000, maxBuffer: 8192 });
  check(result.status === 0 && !result.error && !result.signal, `CI runtime command failed: ${file}`);
  return result.stdout.trim();
}
async function verifyPackage(release, archive, metadata) {
  const parsed = await readMetadata(metadata, release);
  const stat = await lstat(archive);
  check(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size === parsed.archiveBytes, "invalid runtime archive file");
  check(await hashFile(archive) === parsed.archiveSha256, "runtime archive digest mismatch");
  return parsed;
}
async function pack(release, output) {
  check(process.platform === "linux" && process.arch === "x64" && process.version === nodeVersion, "unsupported CI build platform");
  check((await readFile("/etc/os-release", "utf8")).includes('VERSION_ID="22.04"'), "build on the production Ubuntu baseline");
  const inputDigest = command(process.execPath, [resolve(helperRoot, "release-input-manifest.mjs"), "verify", release, ".release-input-manifest.json"]);
  const artifactDigest = command(process.execPath, [resolve(helperRoot, "release-artifact-manifest.mjs"), "verify", release, ".build-complete"]);
  await mkdir(output, { mode: 0o700 });
  const archive = resolve(output, "runtime.tar.gz");
  command("/usr/bin/tar", ["--create", "--gzip", "--format=posix", "--file", archive, "--exclude=.next/cache", ".next", "node_modules", ".build-complete"]);
  check(command(process.execPath, [resolve(helperRoot, "release-artifact-manifest.mjs"), "verify", release, ".build-complete"]) === artifactDigest, "artifact changed during packaging");
  const metadata = parseRuntimeMetadata({ format: "diesel-ci-runtime-v1", release, platform: "linux", arch: "x64", node: nodeVersion,
    ubuntu: "22.04", inputDigest, artifactDigest, archiveSha256: await hashFile(archive), archiveBytes: (await lstat(archive)).size }, release);
  await writeFile(resolve(output, "runtime.json"), `${JSON.stringify(metadata)}\n`, { flag: "wx", mode: 0o600 });
}
export async function verifyStaged(release, directory) {
  check(process.getuid?.() === 0, "staged runtime verification requires root");
  for (let current = directory; current !== "/"; current = dirname(current)) {
    const stat = await lstat(current);
    check(stat.isDirectory() && stat.uid === 0 && !(stat.mode & 0o7022) && await realpath(current) === current, "untrusted runtime parent");
  }
  for (const name of ["runtime.tar.gz", "runtime.json", "authorization.json"]) {
    const stat = await lstat(resolve(directory, name));
    check(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.uid === 0 && stat.gid === 0 && (stat.mode & 0o7777) === 0o600, "untrusted staged runtime file");
  }
  check((await lstat(resolve(directory, "authorization.json"))).size <= 65536, "oversized authorization");
  parseReleaseAuthorizationOutput(await readFile(resolve(directory, "authorization.json"), "utf8"), release);
  return verifyPackage(release, resolve(directory, "runtime.tar.gz"), resolve(directory, "runtime.json"));
}
async function unpack(release, archive, metadata) {
  check(process.getuid?.() !== 0 && process.platform === "linux" && process.arch === "x64" && process.version === nodeVersion, "import requires the isolated production build user");
  const parsed = await verifyPackage(release, archive, metadata);
  const inputDigest = command(process.execPath, [resolve(helperRoot, "release-input-manifest.mjs"), "verify", release, ".release-input-manifest.json"]);
  check(inputDigest === parsed.inputDigest, "runtime inputs differ from staged source");
  command("/usr/bin/python3", ["-I", "-S", resolve(helperRoot, "extract-ci-runtime.py"), archive, process.cwd()]);
  const artifactDigest = command(process.execPath, [resolve(helperRoot, "release-artifact-manifest.mjs"), "verify", release, ".build-complete"]);
  check(artifactDigest === parsed.artifactDigest, "imported artifact closure mismatch");
}
async function main() {
  const [mode, release, path, metadata, ...rest] = process.argv.slice(2);
  check(commitPattern.test(release ?? "") && rest.length === 0, "invalid CI artifact arguments");
  if (mode === "pack" && path && !metadata) await pack(release, resolve(path));
  else if (mode === "verify-staged" && path && !metadata) {
    const parsed = await verifyStaged(release, resolve(path));
    process.stdout.write(`${parsed.artifactDigest}\n`);
  }
  else if (mode === "verify" && path && metadata) await verifyPackage(release, resolve(path), resolve(metadata));
  else if (mode === "unpack" && path && metadata) await unpack(release, resolve(path), resolve(metadata));
  else throw new Error("usage: ci-runtime-artifact.mjs <pack|verify|unpack> <sha> <output|archive> [metadata]");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { process.stderr.write("CI runtime artifact verification failed\n"); process.exitCode = 70; });
}
