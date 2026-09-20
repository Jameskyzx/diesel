import {
  mkdir,
  mkdtemp,
  lstat,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { formatErrorTree } from "../scripts/format-error";
import {
  IncompleteScreenshotRollbackError,
  ScreenshotPublicationCommittedCleanupError,
  captureScreenshotArtifactsWithRollback,
  screenshotArtifactPaths,
  screenshotCandidatePath,
  screenshotCaptureStagingPrefix,
} from "../scripts/portfolio/atomic-screenshot-publication";
import {
  screenshotCaptureLockDirectoryName,
  screenshotCaptureLockOwnerName,
} from "../scripts/portfolio/screenshot-capture-lock";

const temporaryWorkspaces = new Set<string>();

async function createFixture(): Promise<{
  originalBytes: Map<string, Buffer>;
  workspace: string;
}> {
  const workspace = await mkdtemp(
    join(tmpdir(), "diesel-atomic-screenshots-"),
  );
  temporaryWorkspaces.add(workspace);
  const originalBytes = new Map<string, Buffer>();
  for (const [index, artifactPath] of screenshotArtifactPaths.entries()) {
    const bytes = Buffer.from(`old-artifact-${index}\0${artifactPath}`, "utf8");
    const path = resolve(workspace, artifactPath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    originalBytes.set(artifactPath, bytes);
  }
  return { originalBytes, workspace };
}

async function writeCandidateSet(stagingRoot: string): Promise<void> {
  for (const [index, artifactPath] of screenshotArtifactPaths.entries()) {
    const path = screenshotCandidatePath(stagingRoot, artifactPath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `new-artifact-${index}\n`);
  }
}

async function expectOriginalSetUnchanged(
  workspace: string,
  originalBytes: ReadonlyMap<string, Buffer>,
): Promise<void> {
  for (const artifactPath of screenshotArtifactPaths) {
    await expect(readFile(resolve(workspace, artifactPath))).resolves.toEqual(
      originalBytes.get(artifactPath),
    );
  }
  const portfolioEntries = await readdir(resolve(workspace, "public/portfolio"));
  expect(
    portfolioEntries.filter((entry) =>
      entry.startsWith(screenshotCaptureStagingPrefix),
    ),
  ).toEqual([]);
  await expect(
    lstat(resolve(workspace, screenshotCaptureLockDirectoryName)),
  ).rejects.toMatchObject({ code: "ENOENT" });
}

afterEach(async () => {
  await Promise.all(
    [...temporaryWorkspaces].map(async (workspace) =>
      rm(workspace, { force: true, recursive: true }),
    ),
  );
  temporaryWorkspaces.clear();
});

describe("rollback-safe screenshot artifact publication", () => {
  it("rejects candidate paths that escape private staging", () => {
    expect(() =>
      screenshotCandidatePath("/tmp/screenshot-staging", "../outside.jpg"),
    ).toThrow("escapes staging");
  });

  it("publishes the complete candidate set and removes private staging", async () => {
    const { workspace } = await createFixture();
    let stagingMode: number | undefined;
    const verifyPublished = vi.fn(async (manifestText: string) => {
      expect(manifestText).toBe("new-artifact-2\n");
      await expect(
        readFile(resolve(workspace, screenshotArtifactPaths[0]), "utf8"),
      ).resolves.toBe("new-artifact-0\n");
      await expect(
        readFile(resolve(workspace, screenshotArtifactPaths[1]), "utf8"),
      ).resolves.toBe("new-artifact-1\n");
    });

    await captureScreenshotArtifactsWithRollback({
      openCaptureSession: async () => ({
        captureCandidates: async (stagingRoot) => {
          stagingMode = (await lstat(stagingRoot)).mode & 0o777;
          await writeCandidateSet(stagingRoot);
        },
        stop: async () => undefined,
      }),
      verifyCandidates: async () => undefined,
      verifyPublished,
      workspace,
    });

    expect(stagingMode).toBe(0o700);
    expect(verifyPublished).toHaveBeenCalledOnce();
    for (const [index, artifactPath] of screenshotArtifactPaths.entries()) {
      await expect(readFile(resolve(workspace, artifactPath), "utf8")).resolves.toBe(
        `new-artifact-${index}\n`,
      );
    }
    const portfolioEntries = await readdir(resolve(workspace, "public/portfolio"));
    expect(
      portfolioEntries.filter((entry) =>
        entry.startsWith(screenshotCaptureStagingPrefix),
      ),
    ).toEqual([]);
    await expect(
      lstat(resolve(workspace, screenshotCaptureLockDirectoryName)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("excludes a concurrent capture while a partial publication still needs rollback", async () => {
    const { originalBytes, workspace } = await createFixture();
    let allowFirstPublicationToFail: (() => void) | undefined;
    const firstPublicationCanFail = new Promise<void>((resolvePublication) => {
      allowFirstPublicationToFail = resolvePublication;
    });
    let signalFirstArtifactPublished: (() => void) | undefined;
    const firstArtifactPublished = new Promise<void>((resolvePublication) => {
      signalFirstArtifactPublished = resolvePublication;
    });

    const firstCapture = captureScreenshotArtifactsWithRollback({
      openCaptureSession: async () => ({
        captureCandidates: writeCandidateSet,
        stop: async () => undefined,
      }),
      publishCandidate: async (candidatePath, destinationPath, index) => {
        if (index === 1) throw new Error("first publisher must roll back");
        await rename(candidatePath, destinationPath);
        signalFirstArtifactPublished?.();
        await firstPublicationCanFail;
      },
      verifyCandidates: async () => undefined,
      verifyPublished: vi.fn(async () => undefined),
      workspace,
    });
    await firstArtifactPublished;
    const secondSession = vi.fn(async () => ({
      captureCandidates: writeCandidateSet,
      stop: async () => undefined,
    }));

    await expect(
      captureScreenshotArtifactsWithRollback({
        openCaptureSession: secondSession,
        verifyCandidates: async () => undefined,
        verifyPublished: async () => undefined,
        workspace,
      }),
    ).rejects.toThrow(/capture lock .*live process/u);
    expect(secondSession).not.toHaveBeenCalled();

    allowFirstPublicationToFail?.();
    await expect(firstCapture).rejects.toThrow("first publisher must roll back");
    await expectOriginalSetUnchanged(workspace, originalBytes);
  });

  it("preserves the complete old set when the second screenshot capture fails", async () => {
    const { originalBytes, workspace } = await createFixture();
    const stop = vi.fn(async () => undefined);

    await expect(
      captureScreenshotArtifactsWithRollback({
        openCaptureSession: async () => ({
          captureCandidates: async (stagingRoot) => {
            const firstPath = screenshotCandidatePath(
              stagingRoot,
              screenshotArtifactPaths[0],
            );
            await mkdir(dirname(firstPath), { recursive: true });
            await writeFile(firstPath, "new-first-screenshot\n");
            throw new Error("second screenshot failed");
          },
          stop,
        }),
        verifyCandidates: vi.fn(async () => undefined),
        verifyPublished: vi.fn(async () => undefined),
        workspace,
      }),
    ).rejects.toThrow("second screenshot failed");

    expect(stop).toHaveBeenCalledOnce();
    await expectOriginalSetUnchanged(workspace, originalBytes);
  });

  it("preserves the complete old set when candidate manifest validation fails", async () => {
    const { originalBytes, workspace } = await createFixture();

    await expect(
      captureScreenshotArtifactsWithRollback({
        openCaptureSession: async () => ({
          captureCandidates: writeCandidateSet,
          stop: async () => undefined,
        }),
        verifyCandidates: async () => {
          throw new Error("candidate manifest invalid");
        },
        verifyPublished: vi.fn(async () => undefined),
        workspace,
      }),
    ).rejects.toThrow("candidate manifest invalid");

    await expectOriginalSetUnchanged(workspace, originalBytes);
  });

  it("does not publish validated candidates when the server cannot stop", async () => {
    const { originalBytes, workspace } = await createFixture();
    const verifyCandidates = vi.fn(async () => undefined);

    await expect(
      captureScreenshotArtifactsWithRollback({
        openCaptureSession: async () => ({
          captureCandidates: writeCandidateSet,
          stop: async () => {
            throw new Error("server stop failed");
          },
        }),
        verifyCandidates,
        verifyPublished: vi.fn(async () => undefined),
        workspace,
      }),
    ).rejects.toThrow("server stop failed");

    expect(verifyCandidates).not.toHaveBeenCalled();
    await expectOriginalSetUnchanged(workspace, originalBytes);
  });

  it("preserves both causes when capture and server shutdown fail", async () => {
    const { originalBytes, workspace } = await createFixture();
    const captureError = new Error("capture failed first");
    const stopError = new Error("server stop failed second");

    const error = await captureScreenshotArtifactsWithRollback({
      openCaptureSession: async () => ({
        captureCandidates: async () => {
          throw captureError;
        },
        stop: async () => {
          throw stopError;
        },
      }),
      verifyCandidates: vi.fn(async () => undefined),
      verifyPublished: vi.fn(async () => undefined),
      workspace,
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([
      captureError,
      stopError,
    ]);
    await expectOriginalSetUnchanged(workspace, originalBytes);
  });

  it("preserves capture, shutdown, and staging-cleanup failures without masking", async () => {
    const { workspace } = await createFixture();
    const captureError = new Error("capture failed first");
    const stopError = new Error("server stop failed second");
    const cleanupError = new Error("staging cleanup failed third");

    const error = await captureScreenshotArtifactsWithRollback({
      cleanupStaging: async () => {
        throw cleanupError;
      },
      openCaptureSession: async () => ({
        captureCandidates: async () => {
          throw captureError;
        },
        stop: async () => {
          throw stopError;
        },
      }),
      verifyCandidates: vi.fn(async () => undefined),
      verifyPublished: vi.fn(async () => undefined),
      workspace,
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(AggregateError);
    const outerErrors = (error as AggregateError).errors;
    expect(outerErrors).toHaveLength(2);
    expect(outerErrors[0]).toBeInstanceOf(AggregateError);
    expect((outerErrors[0] as AggregateError).errors).toEqual([
      captureError,
      stopError,
    ]);
    expect(outerErrors[1]).toBe(cleanupError);
    const diagnostic = formatErrorTree(error, "screenshot-capture");
    expect(diagnostic).toContain("capture failed first");
    expect(diagnostic).toContain("server stop failed second");
    expect(diagnostic).toContain("staging cleanup failed third");
    await expect(
      lstat(resolve(workspace, screenshotCaptureLockDirectoryName)),
    ).resolves.toBeDefined();
  });

  it("rolls back old bytes when publication fails on the second artifact", async () => {
    const { originalBytes, workspace } = await createFixture();
    const verifyPublished = vi.fn(async () => undefined);

    await expect(
      captureScreenshotArtifactsWithRollback({
        openCaptureSession: async () => ({
          captureCandidates: writeCandidateSet,
          stop: async () => undefined,
        }),
        publishCandidate: async (candidatePath, destinationPath, index) => {
          if (index === 1) throw new Error("second publication failed");
          await rename(candidatePath, destinationPath);
        },
        verifyCandidates: async () => undefined,
        verifyPublished,
        workspace,
      }),
    ).rejects.toThrow("second publication failed");

    expect(verifyPublished).not.toHaveBeenCalled();
    await expectOriginalSetUnchanged(workspace, originalBytes);
  });

  it("restores an originally absent file as absent when later publication fails", async () => {
    const { originalBytes, workspace } = await createFixture();
    const originallyAbsentPath = screenshotArtifactPaths[0];
    await rm(resolve(workspace, originallyAbsentPath));
    originalBytes.delete(originallyAbsentPath);

    await expect(
      captureScreenshotArtifactsWithRollback({
        openCaptureSession: async () => ({
          captureCandidates: writeCandidateSet,
          stop: async () => undefined,
        }),
        publishCandidate: async (candidatePath, destinationPath, index) => {
          if (index === 1) throw new Error("later publication failed");
          await rename(candidatePath, destinationPath);
        },
        verifyCandidates: async () => undefined,
        verifyPublished: vi.fn(async () => undefined),
        workspace,
      }),
    ).rejects.toThrow("later publication failed");

    await expect(lstat(resolve(workspace, originallyAbsentPath))).rejects
      .toMatchObject({ code: "ENOENT" });
    for (const artifactPath of screenshotArtifactPaths.slice(1)) {
      await expect(readFile(resolve(workspace, artifactPath))).resolves.toEqual(
        originalBytes.get(artifactPath),
      );
    }
  });

  it("preserves the lock and staging when rollback itself is incomplete", async () => {
    const { workspace } = await createFixture();
    let capturedStagingRoot: string | undefined;

    const error = await captureScreenshotArtifactsWithRollback({
      openCaptureSession: async () => ({
        captureCandidates: async (stagingRoot) => {
          capturedStagingRoot = stagingRoot;
          await writeCandidateSet(stagingRoot);
        },
        stop: async () => undefined,
      }),
      publishCandidate: async (candidatePath, destinationPath, index) => {
        if (index === 1) throw new Error("publication failed");
        await rename(candidatePath, destinationPath);
        await rm(destinationPath);
        await mkdir(destinationPath);
      },
      verifyCandidates: async () => undefined,
      verifyPublished: vi.fn(async () => undefined),
      workspace,
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(IncompleteScreenshotRollbackError);
    expect((error as AggregateError).errors[0]).toEqual(
      new Error("publication failed"),
    );
    expect(capturedStagingRoot).toBeDefined();
    expect((error as IncompleteScreenshotRollbackError).stagingRoot).toBe(
      capturedStagingRoot,
    );
    await expect(lstat(capturedStagingRoot!)).resolves.toMatchObject({
      mode: expect.any(Number),
    });
    await expect(
      lstat(resolve(workspace, screenshotCaptureLockDirectoryName)),
    ).resolves.toBeDefined();
  });

  it("reports a committed publication separately when only staging cleanup fails", async () => {
    const { workspace } = await createFixture();
    const cleanupError = new Error("post-commit staging cleanup failed");

    const error = await captureScreenshotArtifactsWithRollback({
      cleanupStaging: async () => {
        throw cleanupError;
      },
      openCaptureSession: async () => ({
        captureCandidates: writeCandidateSet,
        stop: async () => undefined,
      }),
      verifyCandidates: async () => undefined,
      verifyPublished: async () => undefined,
      workspace,
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ScreenshotPublicationCommittedCleanupError);
    expect(
      (error as ScreenshotPublicationCommittedCleanupError)
        .publicationCommitted,
    ).toBe(true);
    expect(
      (error as ScreenshotPublicationCommittedCleanupError).stagingPreserved,
    ).toBe(true);
    expect((error as AggregateError).errors).toEqual([cleanupError]);
    expect(String(error)).toContain("Do not roll back");
    await expect(
      lstat(
        (error as ScreenshotPublicationCommittedCleanupError).stagingRoot,
      ),
    ).resolves.toBeDefined();
    for (const [index, artifactPath] of screenshotArtifactPaths.entries()) {
      await expect(readFile(resolve(workspace, artifactPath), "utf8")).resolves
        .toBe(`new-artifact-${index}\n`);
    }
    await expect(
      lstat(resolve(workspace, screenshotCaptureLockDirectoryName)),
    ).resolves.toBeDefined();
  });

  it("does not claim staging remains when only post-commit lock release fails", async () => {
    const { workspace } = await createFixture();

    const error = await captureScreenshotArtifactsWithRollback({
      openCaptureSession: async () => ({
        captureCandidates: writeCandidateSet,
        stop: async () => undefined,
      }),
      verifyCandidates: async () => undefined,
      verifyPublished: async () => {
        await writeFile(
          resolve(
            workspace,
            screenshotCaptureLockDirectoryName,
            screenshotCaptureLockOwnerName,
          ),
          "ownership changed\n",
        );
      },
      workspace,
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ScreenshotPublicationCommittedCleanupError);
    const committedError = error as ScreenshotPublicationCommittedCleanupError;
    expect(committedError.stagingPreserved).toBe(false);
    expect(committedError.message).toContain("Staging cleanup completed");
    expect(committedError.message).not.toContain("Staging remains");
    await expect(lstat(committedError.stagingRoot)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rolls back all three files when published manifest validation fails", async () => {
    const { originalBytes, workspace } = await createFixture();

    await expect(
      captureScreenshotArtifactsWithRollback({
        openCaptureSession: async () => ({
          captureCandidates: writeCandidateSet,
          stop: async () => undefined,
        }),
        verifyCandidates: async () => undefined,
        verifyPublished: async () => {
          throw new Error("published manifest invalid");
        },
        workspace,
      }),
    ).rejects.toThrow("published manifest invalid");

    await expectOriginalSetUnchanged(workspace, originalBytes);
  });

  it("fails closed without replacing a symlink destination", async () => {
    const { originalBytes, workspace } = await createFixture();
    const destination = resolve(workspace, screenshotArtifactPaths[1]);
    const target = resolve(workspace, "symlink-target.jpg");
    const targetBytes = Buffer.from("outside-target-bytes\n", "utf8");
    await writeFile(target, targetBytes);
    await rm(destination);
    await symlink(target, destination);

    await expect(
      captureScreenshotArtifactsWithRollback({
        openCaptureSession: async () => ({
          captureCandidates: writeCandidateSet,
          stop: async () => undefined,
        }),
        verifyCandidates: async () => undefined,
        verifyPublished: vi.fn(async () => undefined),
        workspace,
      }),
    ).rejects.toThrow("not a regular file");

    expect((await lstat(destination)).isSymbolicLink()).toBe(true);
    await expect(readFile(target)).resolves.toEqual(targetBytes);
    await expect(
      readFile(resolve(workspace, screenshotArtifactPaths[0])),
    ).resolves.toEqual(originalBytes.get(screenshotArtifactPaths[0]));
    await expect(
      readFile(resolve(workspace, screenshotArtifactPaths[2])),
    ).resolves.toEqual(originalBytes.get(screenshotArtifactPaths[2]));
    const portfolioEntries = await readdir(resolve(workspace, "public/portfolio"));
    expect(
      portfolioEntries.filter((entry) =>
        entry.startsWith(screenshotCaptureStagingPrefix),
      ),
    ).toEqual([]);
    await expect(
      lstat(resolve(workspace, screenshotCaptureLockDirectoryName)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
