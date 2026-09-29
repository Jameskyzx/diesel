import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  decodeRetainedLicenseArchive,
  retainedLicenseArchiveMaxBytes,
} from "../scripts/history/retained-license-archive";

function file(path: string, bytes: Uint8Array = Buffer.alloc(0)) {
  return {
    path,
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    base64: Buffer.from(bytes).toString("base64"),
  };
}

function fixture() {
  const files = Array.from({ length: 810 }, (_, index) =>
    file(`runs/fixture/${index}.stdout`)
  );
  return {
    schemaVersion: "diesel-history-license-raw-archive-v1",
    totalByteLength: 0,
    files,
  };
}

function encode(value: unknown): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(value), "utf8"));
}

describe("retained license archive inert decoder", () => {
  it("decodes exactly 810 files, including empty and arbitrary binary bytes", () => {
    const archive = fixture();
    const bytes = Buffer.from([0, 0xff, 0x80, 0x0a, 0x41]);
    archive.files[1] = file("runs/binary.payload", bytes);
    archive.totalByteLength = bytes.byteLength;
    const decoded = decodeRetainedLicenseArchive(encode(archive));
    expect(decoded.size).toBe(810);
    expect(decoded.get("runs/fixture/0.stdout")).toEqual(Buffer.alloc(0));
    expect(decoded.get("runs/binary.payload")).toEqual(bytes);
  });

  it("does not interpret saved code, paths inside content, or license statements", () => {
    const archive = fixture();
    const bytes = Buffer.from('throw new Error("must not execute"); /etc/passwd; approved=true');
    archive.files[0] = file("runs/capture.mjs", bytes);
    archive.totalByteLength = bytes.byteLength;
    expect(decodeRetainedLicenseArchive(encode(archive)).get("runs/capture.mjs"))
      .toEqual(bytes);
  });

  it("uses only the supplied typed-array slice", () => {
    const compressed = encode(fixture());
    const enclosing = Buffer.concat([Buffer.from("prefix"), compressed, Buffer.from("suffix")]);
    expect(decodeRetainedLicenseArchive(enclosing.subarray(6, 6 + compressed.length)).size)
      .toBe(810);
  });

  it.each([
    ["empty", Buffer.alloc(0)],
    ["not gzip", Buffer.from("not gzip")],
    ["truncated", encode(fixture()).subarray(0, 20)],
    ["invalid JSON", gzipSync(Buffer.from("{broken"))],
    ["invalid UTF-8", gzipSync(Buffer.from([0xff]))],
  ])("rejects %s input", (_label, bytes) => {
    expect(() => decodeRetainedLicenseArchive(bytes)).toThrow();
  });

  it("rejects a corrupted gzip checksum", () => {
    const bytes = encode(fixture());
    bytes[bytes.length - 8] = (bytes[bytes.length - 8] ?? 0) ^ 0xff;
    expect(() => decodeRetainedLicenseArchive(bytes)).toThrow(/gzip/u);
  });

  it("rejects inputs beyond the 8 MiB compressed byte limit before decompression", () => {
    expect(retainedLicenseArchiveMaxBytes).toBe(8 * 1024 * 1024);
    expect(() => decodeRetainedLicenseArchive(Buffer.alloc(retainedLicenseArchiveMaxBytes + 1)))
      .toThrow(/compressed byte limit/u);
  });

  it("bounds gzip expansion to 24 MiB", () => {
    const compressed = gzipSync(Buffer.alloc(24 * 1024 * 1024 + 1, 0x20));
    expect(compressed.length).toBeLessThan(retainedLicenseArchiveMaxBytes);
    expect(() => decodeRetainedLicenseArchive(compressed)).toThrow(/bounded gzip/u);
  });

  it.each([
    "", "/absolute", "//network/share", "../outside", "a/../outside", "./a",
    "a/./b", "a//b", "a/", "a\\b", "C:/absolute", "C:relative",
    "a\u0000b", "a\nb", "a\tb", "a\u007fb", "目录/a", "a\ufffdb", "a".repeat(501),
  ])("rejects unsafe or non-canonical path %j", (path) => {
    const archive = fixture();
    archive.files[0] = file(path);
    expect(() => decodeRetainedLicenseArchive(encode(archive))).toThrow();
  });

  it("rejects a duplicate even when its bytes and digest match", () => {
    const archive = fixture();
    archive.files[1] = file("runs/fixture/0.stdout");
    expect(() => decodeRetainedLicenseArchive(encode(archive))).toThrow(/duplicate path/u);
  });

  it.each([809, 811])("requires exactly 810 files, not %i", (count) => {
    const archive = fixture();
    archive.files = Array.from({ length: count }, (_, index) => file(`${index}.stdout`));
    expect(() => decodeRetainedLicenseArchive(encode(archive))).toThrow();
  });

  it.each([
    "Zg", "Zg=", "Zg===", "Zg==\n", "Zg== ", "Zg==!", "Zh==", "_w==", "!!!!",
  ])("rejects non-canonical base64 %j even if Buffer accepts it", (base64) => {
    const archive = fixture();
    const descriptor = file("runs/payload", Buffer.from(base64, "base64"));
    descriptor.base64 = base64;
    archive.files[0] = descriptor;
    archive.totalByteLength = descriptor.byteLength;
    expect(() => decodeRetainedLicenseArchive(encode(archive))).toThrow(/non-canonical base64/u);
  });

  it("rejects decoded bytes whose digest drifted", () => {
    const archive = fixture();
    archive.files[0] = { ...file("runs/payload"), sha256: "a".repeat(64) };
    expect(() => decodeRetainedLicenseArchive(encode(archive))).toThrow(/descriptor/u);
  });

  it("rejects decoded bytes whose length drifted", () => {
    const archive = fixture();
    archive.files[0] = { ...file("runs/payload"), byteLength: 1 };
    archive.totalByteLength = 1;
    expect(() => decodeRetainedLicenseArchive(encode(archive))).toThrow(/descriptor/u);
  });

  it.each(["A".repeat(64), "a".repeat(63), "g".repeat(64)])("rejects invalid SHA-256 %s", (sha256) => {
    const archive = fixture();
    archive.files[0] = { ...file("runs/payload"), sha256 };
    expect(() => decodeRetainedLicenseArchive(encode(archive))).toThrow();
  });

  it("rejects a file beyond the 2 MiB limit", () => {
    const archive = fixture();
    archive.files[0] = file("runs/large", Buffer.alloc(2 * 1024 * 1024 + 1));
    archive.totalByteLength = archive.files[0].byteLength;
    expect(() => decodeRetainedLicenseArchive(encode(archive))).toThrow();
  });

  it("accepts an exact 2 MiB file", () => {
    const archive = fixture();
    archive.files[0] = file("runs/limit", Buffer.alloc(2 * 1024 * 1024));
    archive.totalByteLength = archive.files[0].byteLength;
    expect(decodeRetainedLicenseArchive(encode(archive)).get("runs/limit")?.byteLength)
      .toBe(2 * 1024 * 1024);
  });

  it("rejects oversized base64 even with a forged small declared size", () => {
    const archive = fixture();
    archive.files[0] = {
      ...file("runs/large"),
      base64: "A".repeat(Math.ceil(2 * 1024 * 1024 / 3) * 4 + 1),
    };
    expect(() => decodeRetainedLicenseArchive(encode(archive))).toThrow();
  });

  it("recomputes aggregate size and rejects more than 16 MiB with a forged total", () => {
    const archive = fixture();
    const bytes = Buffer.alloc(2 * 1024 * 1024);
    for (let index = 0; index < 8; index += 1) {
      archive.files[index] = file(`runs/large-${index}`, bytes);
    }
    archive.files[8] = file("runs/extra", Buffer.from("a"));
    archive.totalByteLength = 16 * 1024 * 1024;
    expect(() => decodeRetainedLicenseArchive(encode(archive)))
      .toThrow(/aggregate decoded byte limit/u);
  });

  it("rejects a claimed total that disagrees with the decoded files", () => {
    const archive = fixture();
    archive.totalByteLength = 1;
    expect(() => decodeRetainedLicenseArchive(encode(archive))).toThrow(/total byte length/u);
  });

  it.each([-1, 0.5, 16 * 1024 * 1024 + 1, Number.MAX_SAFE_INTEGER])(
    "rejects invalid declared total %s",
    (totalByteLength) => {
      const archive = fixture();
      archive.totalByteLength = totalByteLength;
      expect(() => decodeRetainedLicenseArchive(encode(archive))).toThrow();
    },
  );

  it("rejects unknown top-level fields and schema versions", () => {
    expect(() => decodeRetainedLicenseArchive(encode({ ...fixture(), approved: true }))).toThrow();
    expect(() => decodeRetainedLicenseArchive(encode({ ...fixture(), schemaVersion: "v2" })))
      .toThrow();
  });

  it("rejects unknown descriptor fields", () => {
    const archive = fixture();
    const descriptors = archive.files.map((descriptor, index) =>
      index === 0 ? { ...descriptor, executable: true } : descriptor
    );
    expect(() => decodeRetainedLicenseArchive(encode({ ...archive, files: descriptors }))).toThrow();
  });
});
