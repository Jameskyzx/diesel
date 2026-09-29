import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  acquireScreenshotCaptureLock,
  recoverStaleScreenshotCaptureLock,
  screenshotCaptureLockDirectoryName,
  screenshotCaptureLockOwnerName,
  screenshotCaptureLockVersion,
  screenshotCaptureStagingPrefix,
  serializeScreenshotCaptureLockOwner,
  type ScreenshotCaptureLockOwner,
} from "../scripts/portfolio/screenshot-capture-lock";

const temporaryWorkspaces = new Set<string>();
const staleToken = "123e4567-e89b-42d3-a456-426614174000";

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(
    join(tmpdir(), "diesel-screenshot-capture-lock-"),
  );
  temporaryWorkspaces.add(workspace);
  await mkdir(resolve(workspace, "public/portfolio"), { recursive: true });
  return workspace;
}

function staleOwner(
  overrides: Partial<ScreenshotCaptureLockOwner> = {},
): ScreenshotCaptureLockOwner {
  return {
    acquiredAt: "2000-01-01T00:00:00.000Z",
    hostname: hostname(),
    pid: 2_147_483_647,
    platform: process.platform,
    token: staleToken,
    version: screenshotCaptureLockVersion,
    ...overrides,
  };
}

async function writeOwnerLock(
  workspace: string,
  owner: ScreenshotCaptureLockOwner,
): Promise<string> {
  const path = resolve(workspace, screenshotCaptureLockDirectoryName);
  await mkdir(path, { mode: 0o700 });
  await chmod(path, 0o700);
  const ownerPath = resolve(path, screenshotCaptureLockOwnerName);
  await writeFile(ownerPath, serializeScreenshotCaptureLockOwner(owner), {
    mode: 0o600,
  });
  await chmod(ownerPath, 0o600);
  return path;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    [...temporaryWorkspaces].map(async (workspace) =>
      rm(workspace, { force: true, recursive: true }),
    ),
  );
  temporaryWorkspaces.clear();
});

describe("screenshot capture lock", () => {
  it("creates a private owner-bound lock and excludes another writer", async () => {
    const workspace = await createWorkspace();
    const lock = await acquireScreenshotCaptureLock(workspace);
    const ownerPath = resolve(lock.path, screenshotCaptureLockOwnerName);

    expect((await lstat(lock.path)).mode & 0o777).toBe(0o700);
    expect((await lstat(ownerPath)).mode & 0o777).toBe(0o600);
    expect(await readFile(ownerPath, "utf8")).toBe(
      serializeScreenshotCaptureLockOwner(lock.owner),
    );
    await expect(acquireScreenshotCaptureLock(workspace)).rejects.toThrow(
      /held by a live process/u,
    );

    await lock.release();
    await expect(lstat(lock.path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("requires explicit recovery and proves the same owner PID missing twice", async () => {
    const workspace = await createWorkspace();
    const path = await writeOwnerLock(workspace, staleOwner());
    const pidProbe = vi.fn(() => "missing" as const);

    await expect(
      acquireScreenshotCaptureLock(workspace, { pidProbe }),
    ).rejects.toThrow(/requires explicit --recover-stale-lock/u);
    await expect(lstat(path)).resolves.toBeDefined();

    pidProbe.mockClear();
    await recoverStaleScreenshotCaptureLock(workspace, { pidProbe });
    expect(pidProbe).toHaveBeenCalledTimes(2);
    await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves a stale lock while any unresolved staging may contain rollback data", async () => {
    const workspace = await createWorkspace();
    const path = await writeOwnerLock(workspace, staleOwner());
    const stagingPath = resolve(
      workspace,
      "public/portfolio",
      `${screenshotCaptureStagingPrefix}interrupted`,
    );
    await mkdir(stagingPath, { mode: 0o700 });

    await expect(
      recoverStaleScreenshotCaptureLock(workspace, {
        pidProbe: () => "missing",
      }),
    ).rejects.toThrow(/requires manual staging inspection/u);
    await expect(lstat(path)).resolves.toBeDefined();
    await expect(lstat(stagingPath)).resolves.toBeDefined();
  });

  it("fails closed when the owner cannot be proven missing", async () => {
    const workspace = await createWorkspace();
    const path = await writeOwnerLock(workspace, staleOwner());

    await expect(
      recoverStaleScreenshotCaptureLock(workspace, {
        pidProbe: () => "denied",
      }),
    ).rejects.toThrow(/not proven stale/u);
    await expect(lstat(path)).resolves.toBeDefined();
  });

  it("does not inspect staging through a replaced public-directory symlink", async () => {
    const workspace = await createWorkspace();
    const path = await writeOwnerLock(workspace, staleOwner());
    const publicPath = resolve(workspace, "public");
    const outsidePath = resolve(workspace, "outside-public");
    await mkdir(resolve(outsidePath, "portfolio"), { recursive: true });
    await rm(publicPath, { recursive: true });
    await symlink(outsidePath, publicPath, "dir");

    await expect(
      recoverStaleScreenshotCaptureLock(workspace, {
        pidProbe: () => "missing",
      }),
    ).rejects.toThrow(/public path is not a regular directory/u);
    await expect(lstat(path)).resolves.toBeDefined();
  });

  it("does not infer staging absence from a missing publication parent", async () => {
    const workspace = await createWorkspace();
    const path = await writeOwnerLock(workspace, staleOwner());
    await rm(resolve(workspace, "public"), { recursive: true });

    await expect(
      recoverStaleScreenshotCaptureLock(workspace, {
        pidProbe: () => "missing",
      }),
    ).rejects.toThrow(/staging absence cannot be proven/u);
    await expect(lstat(path)).resolves.toBeDefined();
  });
});
