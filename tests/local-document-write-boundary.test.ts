import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  close: vi.fn(), link: vi.fn(), mkdir: vi.fn(), open: vi.fn(),
  read: vi.fn(), stat: vi.fn(), unlink: vi.fn(), writeFile: vi.fn(),
}));

vi.mock("@/env", () => ({ env: { KNOWLEDGE_STORAGE_ROOT: "test-bounded-write-only" } }));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs/promises")>(),
  link: mocks.link, mkdir: mocks.mkdir, open: mocks.open,
  unlink: mocks.unlink, writeFile: mocks.writeFile,
}));

import { sha256 } from "@/server/knowledge/document-file";
import { saveDocumentFile } from "@/server/knowledge/local-document-storage";

describe("bounded storage verification after atomic publication", () => {
  beforeEach(() => {
    mocks.close.mockReset().mockResolvedValue(undefined);
    mocks.link.mockReset().mockResolvedValue(undefined);
    mocks.mkdir.mockReset().mockResolvedValue(undefined);
    mocks.open.mockReset()
      .mockRejectedValueOnce(Object.assign(new Error("Fictional absent target."), { code: "ENOENT" }))
      .mockResolvedValue({ close: mocks.close, read: mocks.read, stat: mocks.stat });
    mocks.read.mockReset();
    mocks.stat.mockReset().mockResolvedValue({ isFile: () => true, size: 5 * 1024 * 1024 + 1 });
    mocks.unlink.mockReset().mockResolvedValue(undefined);
    mocks.writeFile.mockReset().mockResolvedValue(undefined);
  });

  it.each(["created", "concurrent reuse"])("rejects an oversized %s target after linking without reading or deleting it", async (state) => {
    const bytes = Buffer.from("DEMO ONLY — bounded publication verification");
    const contentSha256 = sha256(bytes);
    const target = resolve(process.cwd(), ".data", "test-bounded-write-only", contentSha256, "content");
    if (state === "concurrent reuse") {
      mocks.link.mockRejectedValue(Object.assign(new Error("Fictional concurrent link."), { code: "EEXIST" }));
    }

    await expect(saveDocumentFile({ bytes, contentSha256 })).rejects.toThrow("5 MiB");

    expect(mocks.open).toHaveBeenCalledTimes(2);
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    const temporaryTarget: unknown = mocks.writeFile.mock.calls[0]?.[0];
    expect(typeof temporaryTarget).toBe("string");
    expect(temporaryTarget).not.toBe(target);
    expect(mocks.link).toHaveBeenCalledExactlyOnceWith(temporaryTarget, target);
    expect(mocks.unlink).toHaveBeenCalledExactlyOnceWith(temporaryTarget);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });
});
