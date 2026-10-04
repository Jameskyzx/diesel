import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

const repository = createRequire(resolve("package.json"));
const eslint = createRequire(repository.resolve("eslint"));
const consumers = [
  ["eslint/minimatch", eslint, "1.1.21"],
  ["typescript-estree/minimatch", createRequire(eslint.resolve("@typescript-eslint/typescript-estree")), "5.0.12"],
] as const;
type Expand = (pattern: string, options?: { max: number; maxLength: number; maxDepth: number }) => string[];

describe.each(consumers)("installed brace-expansion security: %s", (_name, consumer, version) => {
  const minimatch = createRequire(consumer.resolve("minimatch"));
  const loaded: Expand | { expand: Expand } = minimatch("brace-expansion");
  const expand = typeof loaded === "function" ? loaded : loaded.expand;

  it("uses the patched version through the real consumer edge", () => {
    expect(() => z.object({ version: z.literal(version) }).parse(JSON.parse(
      readFileSync(minimatch.resolve("brace-expansion/package.json"), "utf8"),
    ))).not.toThrow();
  });

  it("preserves ordinary nested alternatives and ranges", () => {
    expect(expand("x{a,{b,c}}{1..2}")).toEqual(["xa1", "xa2", "xb1", "xb2", "xc1", "xc2"]);
  });

  it.each([
    ["nested comma groups", "{a,".repeat(4000) + "z" + "}".repeat(4000)],
    ["nested single sets", "{".repeat(3200) + "a,b" + "}".repeat(3200)],
    ["comma parser tail", "{" + "{a},".repeat(8000) + "b}"],
    ["large comma array", "{{x}," + "a,".repeat(125000) + "b}"],
  ])("does not overflow on %s", (_label, pattern) => {
    let result: string[] = [];
    expect(() => { result = expand(pattern, { max: 16, maxLength: 1_000_000, maxDepth: 32 }); }).not.toThrow();
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((item) => typeof item === "string")).toBe(true);
  });
});
