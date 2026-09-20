import { describe, expect, it } from "vitest";

import {
  createE2eTsconfig,
  E2E_TS_BUILD_INFO_FILE,
} from "../scripts/e2e/tsconfig";

describe("Playwright TypeScript configuration", () => {
  it("isolates incremental state under the E2E Next output", () => {
    const source = {
      compilerOptions: {
        incremental: true,
        tsBuildInfoFile: ".next/cache/tsconfig.tsbuildinfo",
      },
      include: ["src/**/*.ts"],
    };

    expect(createE2eTsconfig(source)).toEqual({
      compilerOptions: {
        incremental: true,
        tsBuildInfoFile: E2E_TS_BUILD_INFO_FILE,
      },
      include: ["src/**/*.ts"],
    });
    expect(source.compilerOptions.tsBuildInfoFile).toBe(
      ".next/cache/tsconfig.tsbuildinfo",
    );
    expect(E2E_TS_BUILD_INFO_FILE).toBe(
      ".next-e2e/cache/tsconfig.tsbuildinfo",
    );
  });

  it.each([null, {}, { compilerOptions: [] }])(
    "rejects an invalid source tsconfig %#",
    (source) => {
      expect(() => createE2eTsconfig(source)).toThrow(
        "tsconfig.json must contain compilerOptions",
      );
    },
  );
});
