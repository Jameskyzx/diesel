import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// The removed CLIs must stay removed. The reviewed AI SDK update now uses
// undici through provider-utils; pin that new runtime edge, not its old absence.
const fromRepository = createRequire(resolve("package.json"));

describe("removed undici consumer security boundary", () => {
  it.each(["shadcn", "@dotenvx/dotenvx"])(
    "does not resolve removed dependency %s from the repository", (dependency) => {
      expect(() => fromRepository.resolve(dependency)).toThrow(/Cannot find module/u);
    },
  );

  it("contains no removed consumers and only the reviewed undici version", () => {
    const lockfile = readFileSync(resolve("pnpm-lock.yaml"), "utf8");
    // undici-types remains an unrelated, type-only dependency of @types/node.
    expect(lockfile.split("\npackages:\n")[1]?.match(
      /^  '?(?:shadcn|@dotenvx\/dotenvx)@/mu,
    )).toBeNull();
    const packageNodes = lockfile.split("\npackages:\n")[1]!.split("\nsnapshots:\n")[0]!;
    expect([...packageNodes.matchAll(/^  undici@([^:]+):/gmu)].map((match) => match[1])).toEqual(["7.29.1"]);
    const fromAi = createRequire(fromRepository.resolve("ai"));
    const fromProvider = createRequire(fromAi.resolve("@ai-sdk/provider-utils"));
    const manifest: unknown = JSON.parse(readFileSync(fromProvider.resolve("undici/package.json"), "utf8"));
    expect(manifest).toMatchObject({ name: "undici", version: "7.29.1" });
  });
});
