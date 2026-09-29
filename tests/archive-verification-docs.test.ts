import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const documents = [
  { path: "README.md", prefix: "scripts/portfolio/", locale: "en" },
  { path: "README.zh-CN.md", prefix: "scripts/portfolio/", locale: "zh-CN" },
  { path: "docs/ARCHITECTURE.md", prefix: "../scripts/portfolio/", locale: "zh-CN" },
] as const;

describe("archive-verification documentation follows the registered policy", () => {
  it.each(documents)("keeps $path linked to the actual policy without a stale version ceiling", async ({ path, prefix, locale }) => {
    const absolutePath = resolve(process.cwd(), path);
    const markdown = await readFile(absolutePath, "utf8");
    // Historical version notes remain valid. Only claims that the current
    // archive verifier/dispatcher ends at a copied version range are forbidden.
    const staleVersionCeiling = markdown.match(
      /(?:modern\s+v3[-–]v\d+\s+archive|现代\s*v3[-–]v\d+\s*归档|版本分派\s*v3[-–]v\d+)/u,
    );
    expect(staleVersionCeiling?.[0], `${path}: stale archive policy`).toBeUndefined();
    for (const filename of ["live-eval-report-schema.ts", "verify-live-eval.ts"]) {
      const target = `${prefix}${filename}`;
      expect(markdown.includes(`](${target})`), `${path}: missing policy link ${target}`).toBe(true);
      await expect(access(resolve(dirname(absolutePath), target))).resolves.toBeUndefined();
    }
    const prose = markdown.replace(/\s+/gu, " ");
    const unknownVersionPolicy = locale === "en" ? "unknown versions fail closed" : "未知版本失败关闭";
    expect(prose.includes(unknownVersionPolicy), `${path}: unknown-version policy`).toBe(true);
    const acceptanceBoundary = locale === "en"
      ? "Schema acceptance is not a passing evaluation or a release approval."
      : "schema 校验通过不等于评估过门槛，也不等于发布获批。";
    expect(prose.includes(acceptanceBoundary), `${path}: acceptance boundary`).toBe(true);
  });
});
