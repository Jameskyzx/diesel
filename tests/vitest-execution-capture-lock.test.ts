import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  VITEST_EXECUTION_CAPTURE_LOCK_NAME,
  VITEST_EXECUTION_CAPTURE_LOCK_VERSION,
  VITEST_EXECUTION_CAPTURE_RECOVERY_CLAIM_NAME,
  acquireVitestExecutionCaptureLock,
  inspectVitestExecutionCaptureLock,
  parseVitestExecutionCaptureLockOwner,
  probeVitestExecutionCaptureLockOwner,
  recoverStaleVitestExecutionCaptureLock,
  serializeVitestExecutionCaptureLockOwner,
  type VitestExecutionCaptureLockOwner,
} from "../scripts/portfolio/vitest-execution-capture-lock";

const temporaryDirectories: string[] = [];
const OWNER_TOKEN = "123e4567-e89b-42d3-a456-426614174000";

function git(workspace: string, args: readonly string[]): string {
  const result = spawnSync("/usr/bin/git", args, {
    cwd: workspace,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Synthetic Git command failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function createWorkspace(): string {
  const workspace = mkdtempSync(
    join(realpathSync(tmpdir()), "diesel-vitest-lock-test-"),
  );
  temporaryDirectories.push(workspace);
  writeFileSync(join(workspace, "README.md"), "fixture\n");
  git(workspace, ["init", "--quiet"]);
  git(workspace, ["config", "user.email", "fixture@example.invalid"]);
  git(workspace, ["config", "user.name", "Fixture"]);
  git(workspace, ["add", "--", "README.md"]);
  git(workspace, ["commit", "--quiet", "-m", "fixture"]);
  return workspace;
}

function owner(
  overrides: Partial<VitestExecutionCaptureLockOwner> = {},
): VitestExecutionCaptureLockOwner {
  return {
    version: VITEST_EXECUTION_CAPTURE_LOCK_VERSION,
    token: OWNER_TOKEN,
    pid: process.pid,
    platform: process.platform,
    hostname: hostname(),
    acquiredAt: "2000-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function lockPath(workspace: string): string {
  return resolve(workspace, ".git", VITEST_EXECUTION_CAPTURE_LOCK_NAME);
}

function writeOwnerLock(
  workspace: string,
  lockOwner: VitestExecutionCaptureLockOwner,
): string {
  const path = lockPath(workspace);
  writeFileSync(path, serializeVitestExecutionCaptureLockOwner(lockOwner), {
    mode: 0o600,
  });
  chmodSync(path, 0o600);
  return path;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) {
      rmSync(directory, { force: true, recursive: true });
    }
  }
});

describe("Vitest capture-lock owner format", () => {
  it("round-trips one canonical, strict owner document", () => {
    const expected = owner();
    const serialized = serializeVitestExecutionCaptureLockOwner(expected);

    expect(serialized).toBe(
      '{\n' +
        '  "version": "vitest-execution-capture-lock-v2",\n' +
        '  "token": "123e4567-e89b-42d3-a456-426614174000",\n' +
        `  "pid": ${process.pid},\n` +
        `  "platform": "${process.platform}",\n` +
        `  "hostname": ${JSON.stringify(hostname())},\n` +
        '  "acquiredAt": "2000-01-01T00:00:00.000Z"\n' +
        '}\n',
    );
    expect(parseVitestExecutionCaptureLockOwner(serialized)).toEqual(expected);
  });

  it.each([
    "{}\n",
    `${JSON.stringify(owner())}\n`,
    `${serializeVitestExecutionCaptureLockOwner(owner()).trimEnd()} \n`,
    serializeVitestExecutionCaptureLockOwner(owner()).replace(
      '  "pid":',
      '  "extra": true,\n  "pid":',
    ),
    serializeVitestExecutionCaptureLockOwner(owner()).replace(
      '  "pid":',
      `  "token": "${OWNER_TOKEN}",\n  "pid":`,
    ),
    `\ufeff${serializeVitestExecutionCaptureLockOwner(owner())}`,
    `${serializeVitestExecutionCaptureLockOwner(owner())}\0`,
  ])("rejects malformed or non-canonical owner input %#", (input) => {
    expect(() => parseVitestExecutionCaptureLockOwner(input)).toThrow();
  });
});

describe("Vitest capture-lock PID proof", () => {
  it.each([
    ["alive", "active", "pid_alive"],
    ["missing", "stale", "pid_missing"],
    ["denied", "unverifiable", "pid_probe_denied"],
    ["unknown", "unverifiable", "pid_probe_unknown"],
  ] as const)(
    "maps %s without using lock age",
    (probeResult, status, reason) => {
      expect(
        probeVitestExecutionCaptureLockOwner(
          owner({ acquiredAt: "2099-01-01T00:00:00.000Z" }),
          { probePid: () => probeResult },
        ),
      ).toEqual({ reason, status });
    },
  );

  it("does not probe an owner from another host or platform", () => {
    const probePid = vi.fn(() => "missing" as const);
    expect(
      probeVitestExecutionCaptureLockOwner(owner({ hostname: "remote-host" }), {
        probePid,
      }),
    ).toEqual({ reason: "foreign_host", status: "unverifiable" });
    expect(
      probeVitestExecutionCaptureLockOwner(owner({ platform: "remote-os" }), {
        probePid,
      }),
    ).toEqual({ reason: "foreign_platform", status: "unverifiable" });
    expect(probePid).not.toHaveBeenCalled();
  });
});

describe("Vitest capture-lock acquisition", () => {
  it("publishes a private regular file and excludes another capture", () => {
    const workspace = createWorkspace();
    const lock = acquireVitestExecutionCaptureLock(workspace);
    const metadata = lstatSync(lock.path);

    expect(metadata.isFile()).toBe(true);
    expect(metadata.nlink).toBe(2);
    expect(metadata.mode & 0o777).toBe(0o600);
    expect(dirname(lock.path)).toBe(realpathSync(resolve(workspace, ".git")));
    expect(parseVitestExecutionCaptureLockOwner(readFileSync(lock.path))).toMatchObject({
      pid: process.pid,
      platform: process.platform,
      hostname: hostname(),
    });
    expect(lstatSync(lock.guardPath).nlink).toBe(2);
    expect(
      readdirSync(dirname(lock.path)).filter((name) =>
        name.includes(".candidate-"),
      ),
    ).toEqual([lock.guardPath.split("/").at(-1)]);
    expect(inspectVitestExecutionCaptureLock(workspace)).toMatchObject({
      publicationCandidatePath: lock.guardPath,
      reason: "pid_alive",
      status: "active",
    });
    expect(() => lock.assertOwned()).not.toThrow();
    expect(() => acquireVitestExecutionCaptureLock(workspace)).toThrow(
      /already held or requires explicit operator recovery/u,
    );

    lock.release();
    expect(inspectVitestExecutionCaptureLock(workspace)).toMatchObject({
      status: "absent",
    });
    expect(() => lstatSync(lock.guardPath)).toThrow();
    expect(() => lock.release()).toThrow(/already released/u);
  });

  it("uses the Git common directory across worktrees", () => {
    const workspace = createWorkspace();
    const worktree = resolve(workspace, "..", `${process.pid}-linked-worktree`);
    temporaryDirectories.push(worktree);
    git(workspace, ["worktree", "add", "--quiet", "--detach", worktree, "HEAD"]);
    const lock = acquireVitestExecutionCaptureLock(workspace);
    try {
      expect(inspectVitestExecutionCaptureLock(worktree)).toMatchObject({
        path: lock.path,
        reason: "pid_alive",
        status: "active",
      });
      expect(() => acquireVitestExecutionCaptureLock(worktree)).toThrow(
        /already held/u,
      );
    } finally {
      lock.release();
    }
  });

  it("refuses to release a modified owner file", () => {
    const workspace = createWorkspace();
    const lock = acquireVitestExecutionCaptureLock(workspace);
    writeFileSync(lock.path, "modified\n");

    expect(() => lock.release()).toThrow(/ownership changed/u);
    expect(readFileSync(lock.path, "utf8")).toBe("modified\n");
  });

  it("keeps a guard link when the canonical lock is unexpectedly removed", () => {
    const workspace = createWorkspace();
    const lock = acquireVitestExecutionCaptureLock(workspace);
    unlinkSync(lock.path);

    expect(() => lock.assertOwned()).toThrow(/ownership changed/u);
    expect(lstatSync(lock.guardPath).isFile()).toBe(true);
    expect(() => acquireVitestExecutionCaptureLock(workspace)).toThrow(
      /orphan_publication_candidate/u,
    );
  });

  it.each([
    {
      options: { currentHostname: "remote-host" },
      reason: "foreign_host",
    },
    {
      options: { probePid: () => "denied" as const },
      reason: "pid_probe_denied",
    },
  ] as const)(
    "recognizes the lifecycle guard while reporting $reason",
    ({ options, reason }) => {
      const workspace = createWorkspace();
      const lock = acquireVitestExecutionCaptureLock(workspace);
      try {
        expect(inspectVitestExecutionCaptureLock(workspace, options))
          .toMatchObject({
            publicationCandidatePath: lock.guardPath,
            reason,
            status: "unverifiable",
          });
      } finally {
        lock.release();
      }
    },
  );
});

describe("Vitest capture-lock recovery", () => {
  it("quarantines a lock only after a same-host missing-PID proof", () => {
    const workspace = createWorkspace();
    const path = writeOwnerLock(workspace, owner({ pid: 2_147_483_647 }));
    const original = readFileSync(path);
    const inspection = inspectVitestExecutionCaptureLock(workspace, {
      probePid: () => "missing",
    });

    expect(inspection).toMatchObject({
      reason: "pid_missing",
      status: "stale",
    });
    const quarantinePath = recoverStaleVitestExecutionCaptureLock(workspace, {
      operatorConfirmedNoWorkload: true,
      probePid: () => "missing",
    });

    expect(() => lstatSync(path)).toThrow();
    expect(readFileSync(quarantinePath)).toEqual(original);
    expect(lstatSync(quarantinePath).nlink).toBe(1);

    const nextLock = acquireVitestExecutionCaptureLock(workspace);
    nextLock.release();
    expect(readFileSync(quarantinePath)).toEqual(original);
  });

  it("never automatically recovers a missing owner because descendants may remain", () => {
    const workspace = createWorkspace();
    const child = spawnSync(process.execPath, ["--eval", "void 0"]);
    expect(child.status).toBe(0);
    expect(child.pid).toBeGreaterThan(0);
    const path = writeOwnerLock(workspace, owner({ pid: child.pid }));
    const original = readFileSync(path);

    expect(() => acquireVitestExecutionCaptureLock(workspace)).toThrow(
      /requires explicit operator recovery/u,
    );
    expect(readFileSync(path)).toEqual(original);

    const quarantinePath = recoverStaleVitestExecutionCaptureLock(workspace, {
      operatorConfirmedNoWorkload: true,
    });
    const lock = acquireVitestExecutionCaptureLock(workspace);
    lock.release();

    const quarantines = readdirSync(dirname(path)).filter((name) =>
      name.startsWith(`${VITEST_EXECUTION_CAPTURE_LOCK_NAME}.stale-`),
    );
    expect(quarantines).toHaveLength(1);
    expect(resolve(dirname(path), quarantines[0]!)).toBe(quarantinePath);
    expect(readFileSync(quarantinePath)).toEqual(original);
  });

  it("recovers an interrupted hard-link publication after its owner exits", () => {
    const workspace = createWorkspace();
    const child = spawnSync(process.execPath, ["--eval", "void 0"]);
    expect(child.status).toBe(0);
    const lockOwner = owner({ pid: child.pid });
    const ownerBytes = Buffer.from(
      serializeVitestExecutionCaptureLockOwner(lockOwner),
      "utf8",
    );
    const path = lockPath(workspace);
    const candidatePath = resolve(
      dirname(path),
      `.${VITEST_EXECUTION_CAPTURE_LOCK_NAME}.candidate-${lockOwner.token}`,
    );
    writeFileSync(candidatePath, ownerBytes, { mode: 0o600 });
    chmodSync(candidatePath, 0o600);
    linkSync(candidatePath, path);

    expect(inspectVitestExecutionCaptureLock(workspace)).toMatchObject({
      publicationCandidatePath: candidatePath,
      reason: "pid_missing",
      status: "stale",
    });
    expect(() => acquireVitestExecutionCaptureLock(workspace)).toThrow(
      /stale\/pid_missing/u,
    );
    recoverStaleVitestExecutionCaptureLock(workspace, {
      operatorConfirmedNoWorkload: true,
    });
    const lock = acquireVitestExecutionCaptureLock(workspace);
    lock.release();

    expect(() => lstatSync(candidatePath)).toThrow();
    const quarantines = readdirSync(dirname(path)).filter((name) =>
      name.startsWith(`${VITEST_EXECUTION_CAPTURE_LOCK_NAME}.stale-`),
    );
    expect(quarantines).toHaveLength(1);
    expect(readFileSync(resolve(dirname(path), quarantines[0]!))).toEqual(
      ownerBytes,
    );
  });

  it("resumes an interrupted recovery without removing its quarantine", () => {
    const workspace = createWorkspace();
    const path = writeOwnerLock(workspace, owner({ pid: 2_147_483_647 }));
    const ownerBytes = readFileSync(path);
    const digest = createHash("sha256").update(ownerBytes).digest("hex");
    const quarantinePath = `${path}.stale-${digest}`;
    linkSync(path, quarantinePath);

    expect(inspectVitestExecutionCaptureLock(workspace, {
      probePid: () => "missing",
    })).toMatchObject({
      quarantinePresent: true,
      reason: "pid_missing",
      status: "stale",
    });
    expect(recoverStaleVitestExecutionCaptureLock(workspace, {
      operatorConfirmedNoWorkload: true,
      probePid: () => "missing",
    })).toBe(quarantinePath);
    expect(() => lstatSync(path)).toThrow();
    expect(readFileSync(quarantinePath)).toEqual(ownerBytes);
    expect(lstatSync(quarantinePath).nlink).toBe(1);
  });

  it("fails closed on an orphan publication candidate", () => {
    const workspace = createWorkspace();
    const path = lockPath(workspace);
    const candidatePath = resolve(
      dirname(path),
      `.${VITEST_EXECUTION_CAPTURE_LOCK_NAME}.candidate-${OWNER_TOKEN}`,
    );
    writeFileSync(candidatePath, "orphan\n", { mode: 0o600 });

    expect(inspectVitestExecutionCaptureLock(workspace)).toEqual({
      candidatePaths: [candidatePath],
      path,
      reason: "orphan_publication_candidate",
      status: "unverifiable",
    });
    expect(() => acquireVitestExecutionCaptureLock(workspace)).toThrow(
      /orphan_publication_candidate/u,
    );
    expect(readFileSync(candidatePath, "utf8")).toBe("orphan\n");
    expect(() => lstatSync(path)).toThrow();
  });

  it("reports and preserves an existing recovery claim", () => {
    const workspace = createWorkspace();
    const path = writeOwnerLock(workspace, owner({ pid: 2_147_483_647 }));
    const originalLock = readFileSync(path);
    const claimPath = resolve(
      dirname(path),
      VITEST_EXECUTION_CAPTURE_RECOVERY_CLAIM_NAME,
    );
    writeFileSync(claimPath, "interrupted recovery\n", { mode: 0o600 });

    expect(inspectVitestExecutionCaptureLock(workspace)).toEqual({
      path,
      reason: "recovery_claim_present",
      recoveryClaimPath: claimPath,
      status: "unverifiable",
    });
    expect(() => acquireVitestExecutionCaptureLock(workspace)).toThrow(
      /recovery is in progress or requires operator inspection/u,
    );
    expect(() => recoverStaleVitestExecutionCaptureLock(workspace, {
      operatorConfirmedNoWorkload: true,
      probePid: () => "missing",
    })).toThrow(/already claimed or requires operator inspection/u);
    expect(readFileSync(path)).toEqual(originalLock);
    expect(readFileSync(claimPath, "utf8")).toBe("interrupted recovery\n");
  });

  it("requires runtime operator confirmation before stale recovery", () => {
    const workspace = createWorkspace();
    const path = writeOwnerLock(workspace, owner({ pid: 2_147_483_647 }));
    const originalLock = readFileSync(path);

    expect(() => recoverStaleVitestExecutionCaptureLock(workspace, {
      operatorConfirmedNoWorkload: false as true,
      probePid: () => "missing",
    })).toThrow(/requires an explicit operator confirmation/u);
    expect(readFileSync(path)).toEqual(originalLock);
  });

  it.each(["alive", "denied", "unknown"] as const)(
    "does not recover when PID probing returns %s",
    (probeResult) => {
      const workspace = createWorkspace();
      const path = writeOwnerLock(workspace, owner());
      const original = readFileSync(path);

      expect(() =>
        recoverStaleVitestExecutionCaptureLock(workspace, {
          operatorConfirmedNoWorkload: true,
          probePid: () => probeResult,
        }),
      ).toThrow(/not provably stale/u);
      expect(readFileSync(path)).toEqual(original);
    },
  );

  it("preserves legacy directories, symlinks, and malformed files", () => {
    const workspace = createWorkspace();
    const path = lockPath(workspace);
    mkdirSync(path, { mode: 0o700 });
    expect(inspectVitestExecutionCaptureLock(workspace)).toMatchObject({
      reason: "legacy_directory_unverifiable",
      status: "unverifiable",
    });
    expect(() => acquireVitestExecutionCaptureLock(workspace)).toThrow(
      /legacy_directory_unverifiable/u,
    );
    expect(lstatSync(path).isDirectory()).toBe(true);

    rmSync(path, { recursive: true });
    const target = resolve(workspace, ".git", "foreign-owner");
    writeFileSync(target, "foreign\n");
    symlinkSync(target, path);
    expect(inspectVitestExecutionCaptureLock(workspace)).toMatchObject({
      reason: "non_regular_lock_path",
      status: "unverifiable",
    });
    expect(() => acquireVitestExecutionCaptureLock(workspace)).toThrow(
      /non_regular_lock_path/u,
    );
    expect(lstatSync(path).isSymbolicLink()).toBe(true);

    rmSync(path);
    writeFileSync(path, "not canonical\n", { mode: 0o600 });
    expect(inspectVitestExecutionCaptureLock(workspace)).toMatchObject({
      reason: "invalid_lock_file",
      status: "unverifiable",
    });
    expect(() => acquireVitestExecutionCaptureLock(workspace)).toThrow(
      /invalid_lock_file/u,
    );
    expect(readFileSync(path, "utf8")).toBe("not canonical\n");
  });
});
