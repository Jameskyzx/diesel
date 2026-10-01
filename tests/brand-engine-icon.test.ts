import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

describe("generated diesel-engine brand icon", () => {
  it("ships the original square PNG with genuine transparency", async () => {
    const bytes = readFileSync(resolve("public/brand/diesel-chibi.png"));
    const image = sharp(bytes);
    const metadata = await image.metadata();
    const statistics = await image.stats();

    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(1254);
    expect(metadata.height).toBe(1254);
    expect(metadata.hasAlpha).toBe(true);
    expect(statistics.channels).toHaveLength(4);
    expect(statistics.channels[3]?.min).toBe(0);
    expect(statistics.channels[3]?.max).toBe(255);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      "be8a11494dbb6281f011d3387bd8da65c1f6e4682d82f74af866287c34e0cb57",
    );
  });
});
