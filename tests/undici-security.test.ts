import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// The removed CLIs must stay removed. @ai-sdk/provider-utils 5.0.83 dropped its
// undici dependency, so undici must not re-enter the runtime tree unreviewed.
const fromRepository = createRequire(resolve("package.json"));

describe("removed undici consumer security boundary", () => {
  it.each(["shadcn", "@dotenvx/dotenvx"])(
    "does not resolve removed dependency %s from the repository",
    (dependency) => {
      expect(() => fromRepository.resolve(dependency)).toThrow(
        /Cannot find module/u,
      );
    },
  );

  it("contains no removed consumers and no undici package", () => {
    const lockfile = readFileSync(resolve("pnpm-lock.yaml"), "utf8");
    // undici-types remains an unrelated, type-only dependency of @types/node.
    expect(
      lockfile
        .split("\npackages:\n")[1]
        ?.match(/^  '?(?:shadcn|@dotenvx\/dotenvx)@/mu),
    ).toBeNull();
    const packageNodes = lockfile
      .split("\npackages:\n")[1]!
      .split("\nsnapshots:\n")[0]!;
    expect(
      [...packageNodes.matchAll(/^  undici@([^:]+):/gmu)].map(
        (match) => match[1],
      ),
    ).toEqual([]);
    const fromAi = createRequire(fromRepository.resolve("ai"));
    const fromProvider = createRequire(
      fromAi.resolve("@ai-sdk/provider-utils"),
    );
    expect(() => fromProvider.resolve("undici/package.json")).toThrow(
      /Cannot find module/u,
    );
  });
});
