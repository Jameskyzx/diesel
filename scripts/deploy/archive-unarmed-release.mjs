// Incident-specific archival, NOT a generic ledger repair or protocol reset.
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync,
  openSync, readFileSync, readdirSync, readlinkSync, realpathSync,
  renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FAILED = "9cbeeef340ca7570b7f84175451383363acc42bb";
const PREVIOUS = "5b35ced1e6e52ca1df9fec9d46f355b73b033ec6";
const PROTOCOL_HASH = "ed6eaa7ce32451df8e7490f0689fe4dcd7f8ea26fddab0a6862f354cfbfcc054";
const ARCHIVE_NAME = "20260930-unarmed-9cbeeef";
const BASIS = ["diesel-demo.pre-switch", "env.production.local.pre-switch",
  "jamesky.site.pre-switch", "previous-release"];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (message) => { throw new Error(`Unarmed archival: ${message}`); };
const identity = (s) => [s.dev, s.ino, s.mode, s.uid, s.gid, s.nlink,
  s.size, s.mtimeNs, s.ctimeNs].map(String).join(":");

function absent(path) {
  try { lstatSync(path); } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  fail("an exclusive destination or forbidden state already exists");
}

function engine({ root, nginx, uid, gid, runtimeGid, protocolHash, production, checkpoint }) {
  const backups = join(root, "backups");
  const state = join(backups, FAILED);
  const migrations = join(root, "host-migrations");
  const archive = join(migrations, ARCHIVE_NAME);
  const guard = join(backups, ".unarmed-archive-in-progress");
  const protocol = join(backups, "HOST_ACTIVATION_PROTOCOL_V1");

  function metadata(path, mode, directory = false, group = gid) {
    const s = lstatSync(path, { bigint: true });
    if (s.uid !== BigInt(uid) || s.gid !== BigInt(group) ||
        Number(s.mode & 0o7777n) !== mode ||
        (directory ? !s.isDirectory() : !s.isFile() || s.nlink !== 1n) ||
        realpathSync(path) !== path) fail("unsafe filesystem metadata");
    return s;
  }

  function read(path, mode = 0o600, group = gid) {
    const before = metadata(path, mode, false, group);
    if (before.size < 1n || before.size > 2n * 1024n * 1024n) fail("invalid bounded file size");
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (identity(fstatSync(fd, { bigint: true })) !== identity(before)) fail("file replaced");
      const bytes = readFileSync(fd);
      if (identity(fstatSync(fd, { bigint: true })) !== identity(before) ||
          identity(lstatSync(path, { bigint: true })) !== identity(before) ||
          BigInt(bytes.length) !== before.size) fail("file changed during read");
      return { bytes, identity: identity(before), sha256: sha256(bytes),
        device: String(before.dev), inode: String(before.ino), byteLength: bytes.length };
    } finally { closeSync(fd); }
  }

  function sync(path) {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { fsyncSync(fd); } finally { closeSync(fd); }
  }

  function write(path, bytes) {
    const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT |
      constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
    return read(path);
  }

  function lockProof() {
    for (const [name, fd] of [[".release-lifecycle.lock", 8], [".release-build.lock", 9]]) {
      const path = join(root, name);
      const expected = metadata(path, 0o600);
      if (!production) continue;
      const inherited = fstatSync(fd, { bigint: true });
      if (identity(expected) !== identity(inherited) || readlinkSync(`/proc/self/fd/${fd}`) !== path)
        fail("lock descriptor does not identify the permanent inode");
      const stdio = ["ignore", "ignore", "ignore", "ignore", "ignore", "ignore", "ignore", "ignore", 8, 9];
      const shared = spawnSync("/usr/bin/flock", ["-n", String(fd)], { stdio, timeout: 5000, env: {} });
      const competing = spawnSync("/usr/bin/flock", ["-n", path, "/usr/bin/true"],
        { stdio: "ignore", timeout: 5000, env: {} });
      if (shared.status !== 0 || competing.status !== 1) fail("both exclusive locks are required");
    }
  }

  function inspect() {
    metadata(root, 0o755, true);
    metadata(backups, 0o700, true);
    metadata(migrations, 0o700, true);
    metadata(join(root, "releases"), 0o755, true);
    metadata(join(root, "releases", FAILED), 0o750, true, runtimeGid);
    metadata(join(root, "shared"), 0o750, true, runtimeGid);
    metadata(nginx, 0o755, true);
    lockProof();
    absent(guard);
    absent(archive);
    if (JSON.stringify(readdirSync(backups).sort()) !==
        JSON.stringify([FAILED, "HOST_ACTIVATION_PROTOCOL_V1"].sort())) fail("unexpected backup inventory");
    metadata(state, 0o700, true);
    if (JSON.stringify(readdirSync(state).sort()) !== JSON.stringify(BASIS)) fail("not the exact four-file unarmed state");
    const protocolProof = read(protocol);
    if (protocolProof.sha256 !== protocolHash) fail("permanent protocol manifest drift");
    const files = Object.fromEntries(BASIS.map((name) => [name, read(join(state, name))]));
    const previous = join(root, "releases", PREVIOUS);
    if (files["previous-release"].bytes.toString("utf8") !== `${previous}\n`) fail("previous release drift");
    const current = lstatSync(join(root, "current"), { bigint: true });
    if (!current.isSymbolicLink() || current.uid !== BigInt(uid) || current.gid !== BigInt(gid) ||
        readlinkSync(join(root, "current")) !== previous || realpathSync(previous) !== previous)
      fail("current is not the persisted previous release");
    absent(join(root, "current.next"));
    for (const relative of [".build-complete", ".deploy-ready", ".next", "node_modules"])
      absent(join(root, "releases", FAILED, relative));
    absent(join(root, "build", FAILED));
    const live = [
      ["env.production.local.pre-switch", join(root, "shared", ".env.production.local"), 0o640, runtimeGid],
      ["jamesky.site.pre-switch", join(nginx, "jamesky.site"), 0o644, gid],
      ["diesel-demo.pre-switch", join(nginx, "diesel-demo"), 0o644, gid],
    ].map(([name, path, mode, group]) => {
      const value = read(path, mode, group);
      if (!value.bytes.equals(files[name].bytes)) fail("live configuration differs from pre-switch basis");
      return { name, identity: value.identity, sha256: value.sha256 };
    });
    return { files, protocolProof, stateIdentity: identity(lstatSync(state, { bigint: true })),
      currentIdentity: identity(current), live };
  }

  return (controller, mode) => {
    if (!/^[a-f0-9]{40}$/u.test(controller) || controller === FAILED ||
        !["--check", "--apply"].includes(mode)) fail("invalid controller or mode");
    const proof = inspect();
    const inventory = Object.fromEntries(BASIS.map((name) => {
      const value = proof.files[name];
      return [name, { identity: value.identity, sha256: value.sha256,
        device: value.device, inode: value.inode, byteLength: value.byteLength }];
    }));
    const receipt = { format: "diesel-unarmed-archive-v1", controllerCommit: controller,
      failedRelease: FAILED, previousRelease: PREVIOUS, protocolSha256: protocolHash,
      classification: "never-activated", originalPath: state, archivePath: archive,
      inventory, live: proof.live, stateIdentity: proof.stateIdentity,
      currentIdentity: proof.currentIdentity, observedAt: new Date().toISOString() };
    if (mode === "--check") return { ...receipt, action: "check-only" };
    // Revalidate every byte/identity immediately before the first write.
    const again = inspect();
    if (JSON.stringify(again) !== JSON.stringify(proof)) fail("preflight drift");
    const guardProof = write(guard, `${JSON.stringify({ ...receipt, nonce: randomUUID() })}\n`);
    sync(backups);
    checkpoint("guard-durable");
    // There is intentionally no cleanup trap: interruption retains this guard,
    // which the normal ledger scanner rejects even after originals are moved.
    mkdirSync(archive, { mode: 0o700 });
    sync(migrations);
    const copy = join(archive, "independent-copy");
    mkdirSync(copy, { mode: 0o700 });
    const copyProofs = {};
    for (const name of BASIS) {
      const value = write(join(copy, name), proof.files[name].bytes);
      if (value.sha256 !== proof.files[name].sha256 || value.inode === proof.files[name].inode)
        fail("independent copy verification failed");
      copyProofs[name] = value.identity;
    }
    sync(copy);
    write(join(archive, "prepared.json"), `${JSON.stringify(receipt, null, 2)}\n`);
    sync(archive);
    checkpoint("copy-durable");
    lockProof();
    if (read(protocol).identity !== proof.protocolProof.identity) fail("protocol changed");
    if (identity(lstatSync(join(root, "current"), { bigint: true })) !== proof.currentIdentity)
      fail("current changed before archival");
    for (const [name, path, mode, group] of [
      ["env.production.local.pre-switch", join(root, "shared", ".env.production.local"), 0o640, runtimeGid],
      ["jamesky.site.pre-switch", join(nginx, "jamesky.site"), 0o644, gid],
      ["diesel-demo.pre-switch", join(nginx, "diesel-demo"), 0o644, gid],
    ]) {
      const expected = proof.live.find((item) => item.name === name);
      const actual = read(path, mode, group);
      if (actual.identity !== expected.identity || actual.sha256 !== expected.sha256)
        fail("live configuration changed before archival");
    }
    for (const name of BASIS)
      if (read(join(state, name)).identity !== proof.files[name].identity) fail("basis changed");
    for (const name of BASIS)
      if (read(join(copy, name)).identity !== copyProofs[name]) fail("independent copy changed");
    if (readdirSync(state).sort().join("\n") !== BASIS.join("\n")) fail("basis inventory changed");
    const originals = join(archive, "originals");
    absent(originals);
    renameSync(state, originals);
    sync(archive);
    sync(backups);
    checkpoint("originals-renamed");
    for (const name of BASIS)
      if (read(join(originals, name)).identity !== proof.files[name].identity) fail("original identity changed");
    for (const name of BASIS)
      if (read(join(copy, name)).identity !== copyProofs[name]) fail("independent copy changed");
    if (read(protocol).identity !== proof.protocolProof.identity) fail("protocol changed");
    write(join(archive, "archived.json"), `${JSON.stringify({ ...receipt,
      archivedAt: new Date().toISOString(), action: "archived-without-activation" }, null, 2)}\n`);
    sync(archive);
    sync(migrations);
    checkpoint("receipt-durable");
    if (read(guard).identity !== guardProof.identity || read(guard).sha256 !== guardProof.sha256)
      fail("recovery guard changed");
    unlinkSync(guard);
    sync(backups);
    return { archivePath: archive, failedRelease: FAILED, protocolSha256: protocolHash,
      action: "archived-without-activation", originalsPreserved: true, independentCopyVerified: true };
  };
}

// Isolated fixture seam: never accepts the production root or a symlink alias.
export function createArchiveFixtureDriver(root, nginx, protocolHash, checkpoint = () => {}) {
  const canonical = realpathSync(root);
  if (canonical !== root || canonical === "/opt/diesel" || canonical.startsWith("/opt/diesel/"))
    fail("fixture must be isolated from production");
  if (!/^[a-f0-9]{64}$/u.test(protocolHash)) fail("invalid fixture protocol hash");
  return engine({ root, nginx, uid: process.getuid(), gid: process.getgid(),
    runtimeGid: process.getgid(), protocolHash, production: false, checkpoint });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [controller, mode, ...extra] = process.argv.slice(2);
    if (extra.length || !/^[a-f0-9]{40}$/u.test(controller ?? "") || process.getuid() !== 0 ||
        process.execPath !== "/opt/node-v22.22.3-linux-x64/bin/node" ||
        fileURLToPath(import.meta.url) !== `/opt/diesel/releases/${controller}/scripts/deploy/archive-unarmed-release.mjs`)
      fail("fixed production entry required");
    const runtime = spawnSync("/usr/bin/id", ["-g", "diesel"],
      { encoding: "utf8", timeout: 5000, env: {} });
    if (runtime.status !== 0 || !/^[1-9][0-9]*\n$/u.test(runtime.stdout)) fail("runtime group unavailable");
    const result = engine({ root: "/opt/diesel", nginx: "/etc/nginx/sites-available", uid: 0, gid: 0,
      runtimeGid: Number(runtime.stdout.trim()), protocolHash: PROTOCOL_HASH, production: true,
      checkpoint: () => {} })(controller, mode);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write("Unarmed archival failed closed; preserve all state and any recovery guard.\n");
    process.exitCode = 70;
  }
}
