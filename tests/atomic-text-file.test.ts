import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fileSystemMocks = vi.hoisted(() => ({
  mkdir: vi.fn(),
  open: vi.fn(),
  rename: vi.fn(),
  rm: vi.fn(),
}));

const fileHandleMocks = vi.hoisted(() => ({
  close: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    mkdir: fileSystemMocks.mkdir,
    open: fileSystemMocks.open,
    rename: fileSystemMocks.rename,
    rm: fileSystemMocks.rm,
  };
});

import { persistAtomicTextFile } from "../scripts/portfolio/atomic-text-file";

const input = {
  combinedFailureMessage: "Persistence and cleanup both failed.",
  contents: "complete artifact\n",
  outputPath: "/workspace/evidence/report.json",
};

describe("persistAtomicTextFile", () => {
  beforeEach(() => {
    fileSystemMocks.mkdir.mockReset().mockResolvedValue(undefined);
    fileSystemMocks.open.mockReset().mockResolvedValue(fileHandleMocks);
    fileSystemMocks.rename.mockReset().mockResolvedValue(undefined);
    fileSystemMocks.rm.mockReset().mockResolvedValue(undefined);
    fileHandleMocks.close.mockReset().mockResolvedValue(undefined);
    fileHandleMocks.writeFile.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not remove a colliding temporary file when exclusive creation fails", async () => {
    const collision = Object.assign(new Error("temporary path already exists"), {
      code: "EEXIST",
    });
    fileSystemMocks.open.mockRejectedValueOnce(collision);

    await expect(persistAtomicTextFile(input)).rejects.toBe(collision);

    expect(fileSystemMocks.rename).not.toHaveBeenCalled();
    expect(fileSystemMocks.rm).not.toHaveBeenCalled();
    expect(fileHandleMocks.writeFile).not.toHaveBeenCalled();
    expect(fileHandleMocks.close).not.toHaveBeenCalled();
  });

  it("releases ownership after a successful rename without cleaning the old path", async () => {
    await persistAtomicTextFile(input);

    expect(fileSystemMocks.open).toHaveBeenCalledWith(
      expect.stringMatching(/\.tmp$/),
      "wx",
    );
    expect(fileHandleMocks.writeFile).toHaveBeenCalledWith(input.contents, {
      encoding: "utf8",
    });
    expect(fileHandleMocks.close).toHaveBeenCalledOnce();
    expect(fileSystemMocks.rename).toHaveBeenCalledOnce();
    expect(fileSystemMocks.rm).not.toHaveBeenCalled();
  });

  it("preserves both write and cleanup failures", async () => {
    const writeFailure = new Error("write failed");
    const cleanupFailure = new Error("cleanup failed");
    fileHandleMocks.writeFile.mockRejectedValueOnce(writeFailure);
    fileSystemMocks.rm.mockRejectedValueOnce(cleanupFailure);

    const failure = await persistAtomicTextFile(input).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure).toMatchObject({
      errors: [writeFailure, cleanupFailure],
      message: input.combinedFailureMessage,
    });
    expect(fileHandleMocks.close).toHaveBeenCalledOnce();
    expect(fileSystemMocks.rename).not.toHaveBeenCalled();
    expect(fileSystemMocks.rm).toHaveBeenCalledOnce();
  });

  it("preserves both rename and cleanup failures", async () => {
    const renameFailure = new Error("rename failed");
    const cleanupFailure = new Error("cleanup failed");
    fileSystemMocks.rename.mockRejectedValueOnce(renameFailure);
    fileSystemMocks.rm.mockRejectedValueOnce(cleanupFailure);

    const failure = await persistAtomicTextFile(input).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure).toMatchObject({
      errors: [renameFailure, cleanupFailure],
      message: input.combinedFailureMessage,
    });
    expect(fileHandleMocks.close).toHaveBeenCalledOnce();
    expect(fileSystemMocks.rm).toHaveBeenCalledOnce();
  });
});
