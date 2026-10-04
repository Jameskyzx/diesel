import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// shadcn and dotenvx were the only installed undici consumers. They are now
// removed, so assert the absence of that dependency graph instead of loading
// obsolete consumers or silently skipping their former regression tests.
const fromRepository = createRequire(resolve("package.json"));

describe("removed undici consumer security boundary", () => {
  it.each(["shadcn", "@dotenvx/dotenvx", "undici"])(
    "does not resolve removed dependency %s from the repository", (dependency) => {
      expect(() => fromRepository.resolve(dependency)).toThrow(/Cannot find module/u);
    },
  );

  it("contains no removed consumers or undici runtime package nodes", () => {
    const lockfile = readFileSync(resolve("pnpm-lock.yaml"), "utf8");
    // undici-types remains an unrelated, type-only dependency of @types/node.
    expect(lockfile.split("\npackages:\n")[1]?.match(
      /^  '?(?:shadcn|@dotenvx\/dotenvx|undici)@/mu,
    )).toBeNull();
  });
});
