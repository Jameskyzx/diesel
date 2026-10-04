import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// Both former fast-uri consumers (MCP SDK and dotenvx/conf) came exclusively
// from the unused shadcn CLI. Its removal eliminates those runtime edges;
// reintroducing them must trigger a fresh security review, not a skipped test.
const fromRepository = createRequire(resolve("package.json"));
const lockfile = readFileSync(resolve("pnpm-lock.yaml"), "utf8");

describe("removed fast-uri consumer security boundary", () => {
  it.each(["shadcn", "@dotenvx/dotenvx", "@modelcontextprotocol/sdk", "fast-uri"])(
    "does not resolve removed dependency %s from the repository", (dependency) => {
      expect(() => fromRepository.resolve(dependency)).toThrow(/Cannot find module/u);
    },
  );

  it("contains neither the removed consumers nor fast-uri package nodes", () => {
    // Retained override declarations are not installed package nodes.
    expect(lockfile.split("\npackages:\n")[1]?.match(
      /^  '?(?:shadcn|@dotenvx\/dotenvx|@modelcontextprotocol\/sdk|fast-uri)@/mu,
    )).toBeNull();
  });
});
