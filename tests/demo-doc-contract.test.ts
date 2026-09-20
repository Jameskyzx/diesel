import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("interview demo deployment boundary", () => {
  it("requires STATUS-confirmed matching deployment and readback in both languages", async () => {
    const demo = await readFile(resolve(process.cwd(), "docs/DEMO.md"), "utf8");
    expect(demo).toContain("only when `STATUS.md` confirms that the same version was\ndeployed and passed production readback");
    expect(demo).toContain("Otherwise, use `pnpm demo`");
    expect(demo).toContain("只有当 `STATUS.md` 确认相同版本已经部署并通过生产读回时");
    expect(demo).toContain("否则必须使用\n`pnpm demo`");
  });

  it.each(["English", "中文"])(
    "provides matching local and hosted entry points in %s",
    async (language) => {
      const demo = await readFile(resolve(process.cwd(), "docs/DEMO.md"), "utf8");
      const section = demo.split(`## ${language}\n`)[1]?.split("\n## ")[0];
      expect(section).toBeDefined();
      const urls = [...(section ?? "").matchAll(/https?:\/\/[^\s)<>]+/gu)].map(
        ([url]) => new URL(url),
      );
      const expectedPaths = [
        "/",
        "/countries/CHN?applicationScope=non-road&powerKw=100&asOf=2026-08-13",
        "/chat?countryIso3=CHN&applicationScope=non-road&powerKw=100&asOf=2026-08-13",
      ];
      for (const origin of ["http://127.0.0.1:3000", "https://jamesky.site"]) {
        expect(
          urls.filter((url) => url.origin === origin).map((url) => `${url.pathname}${url.search}`),
        ).toEqual(expect.arrayContaining(expectedPaths));
      }
    },
  );
});
