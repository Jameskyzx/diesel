import { spawnSync } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";

const node = "/opt/node-v22.22.3-linux-x64/bin/node";
const environment = { HOME: "/root", PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C", LC_ALL: "C", NODE_ENV: "production" } as const;

export function preparedReleaseCheckArguments(release: string, runtimeUid: string, runtimeGid: string): string[] {
  if (!/^[0-9a-f]{40}$/u.test(release)) throw new Error("invalid release");
  for (const identity of [runtimeUid, runtimeGid]) {
    if (!/^[1-9][0-9]*$/u.test(identity) || Number(identity) > 2147483647) throw new Error("invalid runtime identity");
  }
  return ["check-ready", release, ".build-complete", ".deploy-ready", "0", runtimeGid, runtimeUid, runtimeGid];
}

function run(file: string, args: string[], timeout: number, cwd?: string): string {
  const result = spawnSync(file, args, { cwd, env: environment, encoding: "utf8", timeout, maxBuffer: 8192 });
  if (result.status !== 0 || result.signal || result.error) throw new Error("prepared release verification failed");
  return result.stdout.trim();
}

/** Prepared releases contain validated runtime links. The build-input-only
 * verifier rejects those intentionally; never relax its no-secret boundary.
 * Reuse the full root-owned readiness check, including source bytes, artifacts,
 * canonical ancestry, runtime links and non-root runtime identity. */
export function verifyPreparedReleaseInputs(directory: string, release: string): string {
  const helper = `${directory}/scripts/deploy/release-artifact-manifest.mjs`;
  const metadata = lstatSync(helper);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.uid !== 0 ||
    (metadata.mode & 0o7022) !== 0 || realpathSync(helper) !== helper) throw new Error("untrusted readiness helper");
  const uid = run("/usr/bin/id", ["-u", "diesel"], 10_000);
  const gid = run("/usr/bin/id", ["-g", "diesel"], 10_000);
  const digest = run(node, [helper, ...preparedReleaseCheckArguments(release, uid, gid)], 10 * 60_000, directory);
  if (!/^[0-9a-f]{64}$/u.test(digest)) throw new Error("invalid readiness digest");
  return digest;
}
