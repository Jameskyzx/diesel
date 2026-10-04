import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ESLint } from "eslint";
import { afterAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const pluginRequire = createRequire(require.resolve("eslint-config-next"));
const pluginPath = dirname(pluginRequire.resolve("@next/eslint-plugin-next"));
const { getRootDirs } = require(join(pluginPath, "utils/get-root-dirs.js")) as {
  getRootDirs: (context: { cwd: string; settings: { next?: { rootDir?: unknown } } }) => string[];
};
const root = mkdtempSync(join(tmpdir(), "diesel-lint-glob-"));
for (const directory of ["apps/web/pages", "apps/admin/pages", "apps/.hidden/pages"]) {
  mkdirSync(join(root, directory), { recursive: true });
}
writeFileSync(join(root, "apps/web/pages/index.tsx"), "export default function Page() { return null; }");
writeFileSync(join(root, "apps/file.txt"), "not a directory");
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("Next lint glob dependency replacement", () => {
  it("preserves the default project root", () => {
    expect(getRootDirs({ cwd: root, settings: {} })).toEqual([root]);
  });
  it.each(["apps/*", "apps/{web,admin}", "apps/@(web|admin)"])("resolves directory pattern %s", (pattern) => {
    expect(getRootDirs({ cwd: root, settings: { next: { rootDir: join(root, pattern) } } }).sort())
      .toEqual([join(root, "apps/admin"), join(root, "apps/web")]);
  });
  it("preserves string arrays, slash normalization and missing paths", () => {
    expect(getRootDirs({ cwd: root, settings: { next: { rootDir: [join(root, "apps/web").replaceAll("/", "\\"), join(root, "missing"), 123] } } }))
      .toEqual([join(root, "apps/web")]);
  });
  it("keeps Next internal-link errors enabled against the resolved page tree", async () => {
    const eslint = new ESLint({ overrideConfig: { settings: { next: { rootDir: join(root, "apps/*") } } } });
    const [result] = await eslint.lintText('export default function Page() { return <a href="/">Home</a>; }', { filePath: "src/app/glob-regression.tsx" });
    expect(result?.messages.some(message => message.ruleId === "@next/next/no-html-link-for-pages" && message.severity === 2)).toBe(true);
  });
  it("removes both vulnerable dependency routes instead of suppressing their audit", () => {
    const lockfile = readFileSync(new URL("../pnpm-lock.yaml", import.meta.url), "utf8");
    expect(lockfile).not.toMatch(/^  (?:braces|micromatch|fast-glob|shadcn)@/mu);
    expect(readFileSync(join(pluginPath, "utils/get-root-dirs.js"), "utf8")).toContain('require("tinyglobby")');
    expect(readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8")).not.toContain("shadcn/tailwind.css");
  });
});
