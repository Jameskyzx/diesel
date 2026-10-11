import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, mkdir, writeFile, rm, symlink, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseRuntimeMetadata, runtimeReadyArguments } from "../scripts/deploy/ci-runtime-artifact.mjs";
import { selectRuntimeArtifact } from "../scripts/deploy/stage-ci-runtime.mjs";

const release = "a".repeat(40);
const metadata = { format: "diesel-ci-runtime-v1", release, platform: "linux", arch: "x64", node: "v22.22.3", ubuntu: "22.04", inputDigest: "b".repeat(64), artifactDigest: "c".repeat(64), archiveSha256: "d".repeat(64), archiveBytes: 200 };
const authorization = { commit: release, workflow: { runId: 123, runAttempt: 2 } };
const artifact = { id: 456, name: `diesel-runtime-${release}-2`, expired: false, size_in_bytes: 200, digest: `sha256:${"e".repeat(64)}`, workflow_run: { id: 123, head_sha: release, head_branch: "master" } };
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe("CI runtime provenance", () => {
  it("packages only a ready root-owned release with the explicit runtime identity", () => {
    expect(runtimeReadyArguments(release, "998", "997").slice(1)).toEqual([
      "check-ready", release, ".build-complete", ".deploy-ready", "0", "997", "998", "997",
    ]);
    for (const id of ["0", "", "-1", "1.5", "01", "root", "2147483648"]) {
      expect(() => runtimeReadyArguments(release, id, "997")).toThrow();
      expect(() => runtimeReadyArguments(release, "998", id)).toThrow();
    }
  });
  it("binds metadata to the exact commit and production ABI", () => {
    expect(parseRuntimeMetadata(metadata, release)).toEqual(metadata);
    for (const change of [{ release: "f".repeat(40) }, { ubuntu: "24.04" }, { arch: "arm64" }, { node: "v22.22.2" }, { archiveBytes: 0 }, { archiveBytes: 2 ** 40 }, { archiveSha256: "no" }, { extra: true }]) {
      expect(() => parseRuntimeMetadata({ ...metadata, ...change }, release)).toThrow();
    }
  });
  it("accepts only one nonexpired artifact from the authorized run and attempt", () => {
    expect(selectRuntimeArtifact({ total_count: 1, artifacts: [artifact] }, authorization)).toEqual(artifact);
    for (const change of [{ expired: true }, { digest: null }, { size_in_bytes: 2 ** 40 }, { name: `diesel-runtime-${release}-1` }, { workflow_run: { ...artifact.workflow_run, id: 124 } }, { workflow_run: { ...artifact.workflow_run, head_sha: "f".repeat(40) } }, { workflow_run: { ...artifact.workflow_run, head_branch: "feature" } }]) {
      expect(() => selectRuntimeArtifact({ total_count: 1, artifacts: [{ ...artifact, ...change }] }, authorization)).toThrow();
    }
    expect(() => selectRuntimeArtifact({ total_count: 2, artifacts: [artifact] }, authorization)).toThrow();
    expect(() => selectRuntimeArtifact({ total_count: 2, artifacts: [artifact, artifact] }, authorization)).toThrow();
  });
});

async function fixture(name = "node_modules/package/file.js", kind = "file", target = "file.js") {
  const root = await realpath(await mkdtemp(join(tmpdir(), "diesel-runtime-test-")));
  temporary.push(root);
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const archive = join(root, "runtime.tar.gz");
  const create = spawnSync("/usr/bin/python3", ["-I", "-S", "-c", `
import io, sys, tarfile
archive, name, kind, target = sys.argv[1:]
with tarfile.open(archive, "w:gz") as bundle:
    for path in (".next", "node_modules"):
        member = tarfile.TarInfo(path); member.type = tarfile.DIRTYPE; member.mode = 0o700
        bundle.addfile(member)
    member = tarfile.TarInfo(".build-complete"); member.size = 6; member.mode = 0o600
    bundle.addfile(member, io.BytesIO(b"marker"))
    member = tarfile.TarInfo(name); member.mode = 0o600
    if kind == "file":
        member.size = 4; bundle.addfile(member, io.BytesIO(b"test"))
    else:
        member.type = {"symlink": tarfile.SYMTYPE, "hardlink": tarfile.LNKTYPE, "device": tarfile.CHRTYPE}[kind]
        member.linkname = target; bundle.addfile(member)
`, archive, name, kind, target], { encoding: "utf8" });
  expect(create.status, create.stderr).toBe(0);
  return { root, workspace, archive, extract: () => spawnSync("/usr/bin/python3", ["-I", "-S", resolve("scripts/deploy/extract-ci-runtime.py"), archive, workspace], { encoding: "utf8" }) };
}
describe("bounded runtime extraction", () => {
  it("extracts without seeking backwards through compressed runtime bytes", async () => {
    const value = await fixture();
    const result = spawnSync("/usr/bin/python3", ["-I", "-S", "-c", `
import gzip, runpy, sys
script, archive, workspace = sys.argv[1:]
original = gzip.GzipFile.seek
def forward_only(self, offset, whence=0):
    if whence == 0 and offset < self.tell():
        raise AssertionError("compressed stream rewound")
    return original(self, offset, whence)
gzip.GzipFile.seek = forward_only
sys.argv = [script, archive, workspace]
runpy.run_path(script, run_name="__main__")
`, resolve("scripts/deploy/extract-ci-runtime.py"), value.archive, value.workspace], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(await readFile(join(value.workspace, "node_modules/package/file.js"), "utf8")).toBe("test");
  });
  it("revalidates every header if archive contents change between passes", async () => {
    const value = await fixture();
    const changed = await fixture("../escaped");
    const result = spawnSync("/usr/bin/python3", ["-I", "-S", "-c", `
import runpy, sys, tarfile
script, archive, workspace, changed = sys.argv[1:]
original = tarfile.open
opens = 0
def replaced_second_pass(*args, **kwargs):
    global opens
    opens += 1
    return original(changed, "r|gz") if opens == 2 else original(*args, **kwargs)
tarfile.open = replaced_second_pass
sys.argv = [script, archive, workspace]
runpy.run_path(script, run_name="__main__")
`, resolve("scripts/deploy/extract-ci-runtime.py"), value.archive, value.workspace, changed.archive], { encoding: "utf8" });
    expect(result.status).not.toBe(0);
    await expect(readFile(join(value.root, "escaped"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it.each(["valid", "extra", "duplicate", "oversized"])("checks ZIP member boundaries before extraction: %s", async scenario => {
    const value = await fixture();
    const zip = join(value.root, "artifact.zip");
    const create = spawnSync("/usr/bin/python3", ["-I", "-S", "-c", `
import sys, zipfile
with zipfile.ZipFile(sys.argv[1], "w") as archive:
    archive.writestr("runtime.json", "x" * (8193 if sys.argv[2] == "oversized" else 4))
    archive.writestr("runtime.tar.gz", "test")
    if sys.argv[2] == "extra": archive.writestr("../escape", "bad")
    if sys.argv[2] == "duplicate": archive.writestr("runtime.json", "duplicate")
`, zip, scenario], { encoding: "utf8" });
    expect(create.status).toBe(0);
    const result = spawnSync("/usr/bin/python3", ["-I", "-S", resolve("scripts/deploy/extract-ci-runtime.py"), "--zip", zip, value.workspace], { encoding: "utf8" });
    expect(result.status === 0).toBe(scenario === "valid");
  });
  it("imports runtime files without overwriting source inputs", async () => {
    const value = await fixture();
    await writeFile(join(value.workspace, "package.json"), "original");
    await writeFile(join(value.workspace, ".build-complete"), "");
    expect(value.extract().status).toBe(0);
    expect(await readFile(join(value.workspace, "node_modules/package/file.js"), "utf8")).toBe("test");
    expect(await readFile(join(value.workspace, "package.json"), "utf8")).toBe("original");
    expect(await readdir(join(value.workspace, ".next/cache"))).toEqual([]);
    expect(value.extract().status).not.toBe(0);
  });
  it.each(["../escape", "/tmp/escape", "node_modules/../escape", ".next/cache/value", "package.json", "node_modules//bad", ".build-complete"])("rejects unsafe or duplicate entry %s", async name => {
    expect((await fixture(name)).extract().status).not.toBe(0);
  });
  it.each(["/etc/passwd", "../../outside"])("rejects escaping symlink %s", async target => {
    expect((await fixture("node_modules/link", "symlink", target)).extract().status).not.toBe(0);
  });
  it.each(["hardlink", "device"])("rejects %s entries", async kind => {
    expect((await fixture("node_modules/file", kind)).extract().status).not.toBe(0);
  });
  it("rejects destination symlinks and occupied output slots", async () => {
    const value = await fixture();
    await symlink(value.root, join(value.workspace, "node_modules"));
    expect(value.extract().status).not.toBe(0);
  });
});
