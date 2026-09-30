import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import ts from "typescript";
import { expect, it } from "vitest";

it("excludes only the root temporary workspace while retaining maintained TypeScript", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "diesel-typescript-boundary-"));
  const maintained = [
    "src/app/page.tsx",
    "src/tmp/example.ts",
    "scripts/example.ts",
    "scripts/tmp/example.ts",
    "tests/example.test.ts",
    "tests/tmp/example.ts",
    "e2e/example.spec.ts",
    ".next/types/example.ts",
    ".next/dev/types/example.ts",
  ];
  const temporary = [
    "tmp/closeout/candidate/src/app/page.tsx",
    "tmp/closeout/candidate/tests/example.test.ts",
    "tmp/closeout/candidate/.next/types/example.ts",
  ];
  try {
    for (const path of [...maintained, ...temporary]) {
      const absolutePath = join(workspace, path);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, "export {};\n");
    }
    const source = await readFile(join(process.cwd(), "tsconfig.json"), "utf8");
    const parsed = ts.parseConfigFileTextToJson("tsconfig.json", source);
    expect(parsed.error).toBeUndefined();
    const configuration = ts.parseJsonConfigFileContent(parsed.config, ts.sys, workspace);
    expect(configuration.errors).toEqual([]);
    expect(configuration.options.strict).toBe(true);
    expect(configuration.fileNames.map((path) => relative(workspace, path)).sort())
      .toEqual([...maintained].sort());
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
