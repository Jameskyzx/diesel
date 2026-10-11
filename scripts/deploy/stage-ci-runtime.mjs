// Run from the same clean, authorized master checkout after stage-release.sh.
// This never downloads a "latest" artifact or transfers GitHub credentials.
import { spawnSync } from "node:child_process";
import { closeSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { mkdtemp, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hashFile, parseRuntimeMetadata } from "./ci-runtime-artifact.mjs";
import { ciRuntimeArtifactListSchema, createReleaseCommandEnvironment, verifyReleaseAuthorization } from "./verify-release-authorization.bundle.mjs";

const repository = "Jameskyzx/diesel";
const MAX_BYTES = 2 * 1024 ** 3;
const sshOptions = ["-F", "/dev/null", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3", "-o", "ForwardAgent=no", "-o", "ClearAllForwardings=yes"];
function check(value, message) { if (!value) throw new Error(message); }
function command(file, args, options = {}) {
  const result = spawnSync(file, args, { env: createReleaseCommandEnvironment("gh"), encoding: "utf8", timeout: 15 * 60_000, maxBuffer: 1024 * 1024, ...options });
  check(result.status === 0 && !result.signal && !result.error, `${file} failed; preserve staging diagnostics`);
  return result.stdout?.trim();
}
export function selectRuntimeArtifact(response, authorization) {
  const { runId, runAttempt } = authorization.workflow;
  const parsed = ciRuntimeArtifactListSchema.parse(response);
  check(parsed.total_count === parsed.artifacts.length, "truncated artifact list");
  const matches = parsed.artifacts.filter(item => item.name === `diesel-runtime-${authorization.commit}-${runAttempt}`);
  check(matches.length === 1, "missing or ambiguous exact-attempt runtime artifact");
  const artifact = matches[0];
  check(Number.isSafeInteger(artifact.id) && artifact.id > 0 && artifact.expired === false &&
    Number.isSafeInteger(artifact.size_in_bytes) && artifact.size_in_bytes > 0 && artifact.size_in_bytes <= MAX_BYTES &&
    /^sha256:[0-9a-f]{64}$/u.test(artifact.digest) && artifact.workflow_run?.id === runId &&
    artifact.workflow_run?.head_sha === authorization.commit && artifact.workflow_run?.head_branch === "master",
  "runtime artifact provenance mismatch");
  return artifact;
}
function toFile(file, args, path, options = {}) {
  const descriptor = openSync(path, "wx", 0o600);
  try { command(file, args, { ...options, stdio: ["ignore", descriptor, "pipe"] }); }
  finally { closeSync(descriptor); }
}
async function main() {
  const [release, ...rest] = process.argv.slice(2);
  check(/^[0-9a-f]{40}$/u.test(release ?? "") && rest.length === 0 && process.version === "v22.22.3", "expected release SHA and pinned Node");
  const root = realpathSync(process.cwd());
  check(fileURLToPath(import.meta.url) === resolve(root, "scripts/deploy/stage-ci-runtime.mjs"), "run committed helper from repository root");
  const authorization = verifyReleaseAuthorization(release, root);
  const response = JSON.parse(command("gh", ["api", `repos/${repository}/actions/runs/${authorization.workflow.runId}/artifacts?per_page=100`]));
  const artifact = selectRuntimeArtifact(response, authorization);
  const temporary = await mkdtemp(resolve(tmpdir(), "diesel-ci-runtime-"));
  // Keep a named diagnostic directory on failure; no broad cleanup or overwrite.
  process.stderr.write(`CI runtime staging: ${temporary}\n`);
  const zip = resolve(temporary, "artifact.zip");
  toFile("gh", ["api", `repos/${repository}/actions/artifacts/${artifact.id}/zip`], zip);
  check((await lstat(zip)).size <= MAX_BYTES && await hashFile(zip) === artifact.digest.slice(7), "GitHub artifact digest mismatch");
  // Bound advertised decompressed sizes before opening exclusive output files.
  command("/usr/bin/python3", ["-I", "-S", resolve(root, "scripts/deploy/extract-ci-runtime.py"), "--zip", zip, temporary]);
  check((await lstat(resolve(temporary, "runtime.json"))).size <= 8192, "oversized metadata");
  const metadata = parseRuntimeMetadata(JSON.parse(readFileSync(resolve(temporary, "runtime.json"), "utf8")), release);
  check((await lstat(resolve(temporary, "runtime.tar.gz"))).size === metadata.archiveBytes &&
    await hashFile(resolve(temporary, "runtime.tar.gz")) === metadata.archiveSha256, "runtime package digest mismatch");
  const fresh = verifyReleaseAuthorization(release, root);
  check(fresh.workflow.runId === authorization.workflow.runId && fresh.workflow.runAttempt === authorization.workflow.runAttempt, "CI attempt changed while downloading");
  writeFileSync(resolve(temporary, "authorization.json"), `${JSON.stringify(fresh)}\n`, { flag: "wx", mode: 0o600 });
  const destination = `/opt/diesel/release-inputs/${release}/ci-runtime`;
  const environment = createReleaseCommandEnvironment("git", "isolated");
  const preflight = `set -Eeuo pipefail
umask 077
test "$(id -u)" = 0
test "$(realpath /opt/diesel)" = /opt/diesel
test "$(stat -c '%u:%g:%a' /opt/diesel)" = 0:0:755
for parent in /opt/diesel/release-inputs /opt/diesel/release-inputs/${release}; do
  if [ ! -e "$parent" ] && [ ! -L "$parent" ]; then mkdir -m 700 "$parent"; fi
  test "$(realpath "$parent")" = "$parent"
  test "$(stat -c '%u:%g:%a' "$parent")" = 0:0:700
done
cd /opt/diesel/releases/${release}
/opt/node-v22.22.3-linux-x64/bin/node scripts/deploy/release-input-manifest.mjs verify ${release} .release-input-manifest.json
test ! -e '${destination}' && test ! -L '${destination}'
mkdir -m 700 '${destination}'
`;
  command("/usr/bin/ssh", [...sshOptions, "root@111.228.50.85", "/usr/bin/env -i HOME=/root PATH=/usr/sbin:/usr/bin:/sbin:/bin /bin/bash --noprofile --norc -s"], { env: environment, input: preflight });
  command("/usr/bin/scp", [...sshOptions, ...["runtime.tar.gz", "runtime.json", "authorization.json"].map(name => resolve(temporary, name)), `root@111.228.50.85:${destination}/`], { env: environment });
  command("/usr/bin/ssh", [...sshOptions, "root@111.228.50.85", `/usr/bin/env -i HOME=/root PATH=/usr/bin:/bin /opt/node-v22.22.3-linux-x64/bin/node /opt/diesel/releases/${release}/scripts/deploy/ci-runtime-artifact.mjs verify-staged ${release} ${destination}`], { env: environment });
  process.stdout.write(`${JSON.stringify({ release, runId: fresh.workflow.runId, runAttempt: fresh.workflow.runAttempt, artifactId: artifact.id, archiveSha256: metadata.archiveSha256, destination, temporary, staged: true, deployed: false })}\n`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { process.stderr.write("CI runtime staging failed; no deployment started\n"); process.exitCode = 70; });
}
