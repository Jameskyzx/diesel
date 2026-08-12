import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  hasStructurallyValidChatImage,
  MAX_CHAT_IMAGE_DIMENSION,
  MIN_CHAT_IMAGE_DIMENSION,
} from "@/features/ai/image-attachments";

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const sixteenPixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAHUlEQVR4nGNQTl72nxLMMGrA/9EwWDYaBsnDIgwAMoorH0C43vMAAAAASUVORK5CYII=",
  "base64",
);

describe("chat image structural validation", () => {
  it("accepts bounded PNG and JPEG files", async () => {
    const jpeg = await readFile(
      resolve(process.cwd(), "public/portfolio/live-dashboard.jpg"),
    );

    expect(
      hasStructurallyValidChatImage("image/png", sixteenPixelPng),
    ).toBe(true);
    expect(hasStructurallyValidChatImage("image/jpeg", jpeg)).toBe(true);
  });

  it("rejects undersized, truncated, and oversized PNG dimensions", () => {
    expect(MIN_CHAT_IMAGE_DIMENSION).toBe(11);
    expect(
      hasStructurallyValidChatImage("image/png", onePixelPng),
    ).toBe(false);
    expect(
      hasStructurallyValidChatImage(
        "image/png",
        sixteenPixelPng.subarray(0, 24),
      ),
    ).toBe(false);

    const oversized = Uint8Array.from(sixteenPixelPng);
    const width = MAX_CHAT_IMAGE_DIMENSION + 1;
    oversized[16] = (width >>> 24) & 0xff;
    oversized[17] = (width >>> 16) & 0xff;
    oversized[18] = (width >>> 8) & 0xff;
    oversized[19] = width & 0xff;
    expect(
      hasStructurallyValidChatImage("image/png", oversized),
    ).toBe(false);
  });

  it("requires a complete RIFF length, dimensions, and image payload for WebP", () => {
    const structuralLosslessWebp = Uint8Array.from([
      0x52, 0x49, 0x46, 0x46,
      0x16, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50,
      0x56, 0x50, 0x38, 0x4c,
      0x0a, 0x00, 0x00, 0x00,
      0x2f, 0x0f, 0xc0, 0x03, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00,
    ]);

    expect(
      hasStructurallyValidChatImage(
        "image/webp",
        structuralLosslessWebp,
      ),
    ).toBe(true);
    expect(
      hasStructurallyValidChatImage(
        "image/webp",
        structuralLosslessWebp.subarray(0, -1),
      ),
    ).toBe(false);
  });
});
