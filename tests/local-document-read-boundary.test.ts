import { constants } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  close: vi.fn(),
  open: vi.fn(),
  read: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
}));

vi.mock("@/env", () => ({ env: { KNOWLEDGE_STORAGE_ROOT: "test-bounded-read-only" } }));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs/promises")>(),
  access: mocks.access,
  open: mocks.open,
  readFile: mocks.readFile,
}));

import { readDocumentFile } from "@/server/knowledge/local-document-storage";

const maximumBytes = 5 * 1024 * 1024;
const storagePath = `${"a".repeat(64)}/legacy-demo.txt`;

async function expectExactDocumentBytes(expected: Buffer): Promise<void> {
  const actual = await readDocumentFile(storagePath);
  expect(actual.length).toBe(expected.length);
  expect(actual.equals(expected)).toBe(true);
}

describe("bounded reads of registered local document files", () => {
  let bytes: Buffer;
  let totalRead: number;
  let largestBuffer: number;

  beforeEach(() => {
    bytes = Buffer.from("DEMO ONLY — original bytes\0\f😀");
    totalRead = 0;
    largestBuffer = 0;
    mocks.access.mockReset().mockResolvedValue(undefined);
    mocks.close.mockReset().mockResolvedValue(undefined);
    mocks.stat.mockReset().mockImplementation(async () => ({ isFile: () => true, size: bytes.length }));
    mocks.readFile.mockReset().mockImplementation(async () => Buffer.from(bytes));
    mocks.read.mockReset().mockImplementation(async (buffer: Buffer, offset: number, length: number, position: number) => {
      largestBuffer = Math.max(largestBuffer, buffer.length);
      const bytesRead = bytes.copy(buffer, offset, position, position + length);
      totalRead += bytesRead;
      return { buffer, bytesRead };
    });
    mocks.open.mockReset().mockResolvedValue({ close: mocks.close, read: mocks.read, stat: mocks.stat });
  });

  it.each([0, 1, maximumBytes])("returns all %i bytes without using an unbounded read", async (length) => {
    bytes = Buffer.alloc(length, 0x61);
    await expectExactDocumentBytes(bytes);
    expect(mocks.open).toHaveBeenCalledExactlyOnceWith(
      resolve(process.cwd(), ".data", "test-bounded-read-only", storagePath),
      constants.O_RDONLY | constants.O_NONBLOCK,
    );
    expect(totalRead).toBe(bytes.length);
    expect(largestBuffer).toBeLessThanOrEqual(maximumBytes + 1);
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.access).not.toHaveBeenCalled();
  });

  it("preserves binary and layout bytes without decoding or rewriting them", async () => {
    await expectExactDocumentBytes(bytes);
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized metadata before any content read and closes the descriptor", async () => {
    mocks.stat.mockResolvedValue({ isFile: () => true, size: maximumBytes + 1 });
    await expect(readDocumentFile(storagePath).then(() => undefined)).rejects.toThrow("5 MiB");
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it.each([maximumBytes, maximumBytes + 1, maximumBytes * 2])("bounds a file that grows from zero to %i bytes after stat", async (length) => {
    bytes = Buffer.alloc(length, 0x63);
    mocks.stat.mockResolvedValue({ isFile: () => true, size: 0 });
    if (length > maximumBytes) {
      await expect(readDocumentFile(storagePath).then(() => undefined)).rejects.toThrow("5 MiB");
    } else {
      await expectExactDocumentBytes(bytes);
    }
    expect(totalRead).toBe(Math.min(length, maximumBytes + 1));
    expect(largestBuffer).toBeLessThanOrEqual(maximumBytes + 1);
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it("continues short reads until EOF instead of returning a truncated original", async () => {
    mocks.read.mockImplementation(async (buffer: Buffer, offset: number, length: number, position: number) => {
      const bytesRead = bytes.copy(buffer, offset, position, position + Math.min(length, 3));
      return { buffer, bytesRead };
    });
    await expectExactDocumentBytes(bytes);
    expect(mocks.read.mock.calls.length).toBeGreaterThan(2);
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it("does not return uninitialized or padded bytes when the file shrinks after stat", async () => {
    mocks.stat.mockResolvedValue({ isFile: () => true, size: maximumBytes });
    await expectExactDocumentBytes(bytes);
    expect(totalRead).toBe(bytes.length);
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it("rejects non-regular descriptors without reading their content", async () => {
    mocks.stat.mockResolvedValue({ isFile: () => false, size: 0 });
    await expect(readDocumentFile(storagePath)).rejects.toThrow("regular file");
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it.each(["stat", "read"] as const)("closes the descriptor when %s fails without returning partial data", async (operation) => {
    const error = new Error("Fictional document I/O failure.");
    mocks[operation].mockRejectedValue(error);
    await expect(readDocumentFile(storagePath)).rejects.toBe(error);
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it("closes the descriptor when a later read fails after receiving part of the file", async () => {
    const error = new Error("Fictional partial-read failure.");
    mocks.read.mockImplementationOnce(async (buffer: Buffer, offset: number) => {
      bytes.copy(buffer, offset, 0, 2);
      return { buffer, bytesRead: 2 };
    }).mockRejectedValueOnce(error);
    await expect(readDocumentFile(storagePath)).rejects.toBe(error);
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it("preserves open errors without attempting to close an unopened descriptor", async () => {
    const error = Object.assign(new Error("Fictional missing document."), { code: "ENOENT" });
    mocks.open.mockRejectedValue(error);
    await expect(readDocumentFile(storagePath)).rejects.toBe(error);
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it("rejects lexical path escape before opening any file", async () => {
    await expect(readDocumentFile("../../outside-demo.txt")).rejects.toThrow("outside the configured root");
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.readFile).not.toHaveBeenCalled();
  });
});
