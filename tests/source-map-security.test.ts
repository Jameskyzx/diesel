import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";
import { z } from "zod";

const rootRequire = createRequire(import.meta.url);
const tailwindRequire = createRequire(rootRequire.resolve("@tailwindcss/postcss"));
const postcssRequire = createRequire(tailwindRequire.resolve("postcss"));
const installedPackage: unknown = postcssRequire("source-map-js/package.json");
type BasicMap = { version: 3; sources: string[]; names: string[]; mappings: string };
type IndexedMap = { version: 3; sections: { offset: { line: unknown; column: unknown }; map: BasicMap | IndexedMap }[] };
type Consumer = {
  originalPositionFor(position: { line: number; column: number }): {
    source: string | null; line: number | null; column: number | null;
  };
};
const runtime: unknown = postcssRequire("source-map-js");
const { SourceMapConsumer } = z.object({
  SourceMapConsumer: z.custom<new (map: BasicMap | IndexedMap) => Consumer>(
    (value) => typeof value === "function",
  ),
}).passthrough().parse(runtime);
const basic: BasicMap = { version: 3, sources: ["entry.js"], names: [], mappings: "AAAA" };

function indexed(line: unknown, column: unknown = 0, map: BasicMap | IndexedMap = basic): IndexedMap {
  return { version: 3, sections: [{ offset: { line, column }, map }] };
}

describe("installed source-map-js security boundary (GHSA-68fv-2mgg-jv7q)", () => {
  it("resolves the patched version through the actual PostCSS dependency", () => {
    expect(z.object({ name: z.literal("source-map-js"), version: z.literal("1.2.2") }).passthrough().safeParse(installedPackage).success).toBe(true);
  });

  it("rejects an oversized indexed offset before any mapping copy or serialization", () => {
    // Construction alone is safe even in the vulnerable version: never copy or
    // serialize the unbounded map in a shared test worker.
    expect(() => new SourceMapConsumer(indexed(10_000_001))).toThrow(/must not exceed/u);
  });

  it("bounds the sum of individually valid nested offsets", () => {
    expect(() => new SourceMapConsumer(indexed(5_000_000, 0,
      indexed(5_000_000, 0, indexed(5_000_000))))).toThrow(/including offsets of nested sections/u);
  });

  it.each([
    { label: "negative", value: -1 },
    { label: "fraction", value: 0.5 },
    { label: "NaN", value: Number.NaN },
    { label: "Infinity", value: Number.POSITIVE_INFINITY },
    { label: "numeric string", value: "1" },
  ])("rejects $label line and column offsets", ({ value }) => {
    expect(() => new SourceMapConsumer(indexed(value))).toThrow(/non-negative integers/u);
    expect(() => new SourceMapConsumer(indexed(0, value))).toThrow(/non-negative integers/u);
  });

  it("keeps normal indexed source-map position lookup intact", () => {
    const consumer = new SourceMapConsumer(indexed(0));
    expect(consumer.originalPositionFor({ line: 1, column: 1 })).toEqual({
      source: "entry.js", line: 1, column: 0, name: null,
    });
  });
});
