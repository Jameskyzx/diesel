import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), lstat: vi.fn(), realpath: vi.fn() }));
vi.mock("node:child_process", () => ({ spawnSync: mocks.spawn }));
vi.mock("node:fs", () => ({ lstatSync: mocks.lstat, realpathSync: mocks.realpath }));
import { preparedReleaseCheckArguments, verifyPreparedReleaseInputs } from "../scripts/deploy/prepared-release-verification";

const release = "a".repeat(40);
const directory = `/opt/diesel/releases/${release}`;
const helper = `${directory}/scripts/deploy/release-artifact-manifest.mjs`;
const digest = "b".repeat(64);
const metadata = () => ({ isFile: () => true, isSymbolicLink: () => false, nlink: 1, uid: 0, mode: 0o100640 });
const result = (stdout: string) => ({ status: 0, signal: null, error: undefined, stdout: `${stdout}\n`, stderr: "" });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.lstat.mockReturnValue(metadata());
  mocks.realpath.mockImplementation((path: string) => path);
  mocks.spawn.mockImplementation((file: string) => result(file === "/usr/bin/id" ? "1001" : digest));
});

describe("prepared release verification boundary", () => {
  it("uses full check-ready with the actual runtime identity, not the build-only verifier", () => {
    expect(verifyPreparedReleaseInputs(directory, release)).toBe(digest);
    expect(mocks.spawn.mock.calls).toEqual([
      ["/usr/bin/id", ["-u", "diesel"], expect.objectContaining({ timeout: 10_000 })],
      ["/usr/bin/id", ["-g", "diesel"], expect.objectContaining({ timeout: 10_000 })],
      ["/opt/node-v22.22.3-linux-x64/bin/node", [helper, "check-ready", release,
        ".build-complete", ".deploy-ready", "0", "1001", "1001", "1001"],
      expect.objectContaining({ cwd: directory, timeout: 600_000, maxBuffer: 8192,
        env: { HOME: "/root", PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C", LC_ALL: "C", NODE_ENV: "production" } })],
    ]);
  });

  it.each(["0", "-1", "01", "2147483648", "1001\nextra", "user", ""])(
    "rejects invalid/root runtime identity %s", identity => {
      expect(() => preparedReleaseCheckArguments(release, identity, "1001")).toThrow();
      expect(() => preparedReleaseCheckArguments(release, "1001", identity)).toThrow();
    },
  );
  it.each(["", "../current", "A".repeat(40), `${release};true`])("rejects invalid release %s", value => {
    expect(() => preparedReleaseCheckArguments(value, "1001", "1001")).toThrow();
  });

  it.each([
    { uid: 1001 }, { nlink: 2 }, { mode: 0o100660 }, { mode: 0o100642 },
    { isSymbolicLink: () => true }, { isFile: () => false },
  ])("rejects untrusted helper metadata before execution %j", change => {
    mocks.lstat.mockReturnValue({ ...metadata(), ...change });
    expect(() => verifyPreparedReleaseInputs(directory, release)).toThrow("untrusted readiness helper");
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
  it("rejects symlinked helper ancestry", () => {
    mocks.realpath.mockReturnValue("/outside/helper.mjs");
    expect(() => verifyPreparedReleaseInputs(directory, release)).toThrow("untrusted readiness helper");
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
  it.each([
    { status: 1 }, { status: null, signal: "SIGTERM" }, { error: new Error("timeout") },
    { stdout: "" }, { stdout: `${digest}\nextra` },
  ])("rejects failed, interrupted or malformed full verification %j", change => {
    mocks.spawn.mockImplementation((file: string) => file === "/usr/bin/id" ? result("1001") : { ...result(digest), ...change });
    expect(() => verifyPreparedReleaseInputs(directory, release)).toThrow();
  });
  it("wires both deployed-input callers and the real Linux prepared-directory regression", async () => {
    const durable = await readFile("scripts/deploy/durable-release.ts", "utf8");
    const database = await readFile("scripts/db/verify-application-release.ts", "utf8");
    const linux = await readFile("scripts/ci/linux-release-handoff-smoke.sh", "utf8");
    expect(durable).toContain("verifyPreparedReleaseInputs(previousDirectory, previousRelease)");
    expect(durable).not.toContain("verifyInput(previousDirectory, previousRelease)");
    expect(database).toContain("verifyPreparedReleaseInputs(root, commit)");
    expect(database).not.toContain("release-input-manifest.mjs");
    expect(linux).toContain("verifyPreparedReleaseInputs(process.cwd(), process.argv[1])");
    expect(linux).toContain("build-only verifier accepted a prepared runtime");
  });
});
