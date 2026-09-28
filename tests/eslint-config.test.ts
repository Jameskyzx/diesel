import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: process.cwd() });

describe("ESLint source boundary", () => {
  it.each([
    "tmp/closeout/candidate/.next/server/app/page.js",
    "tmp/closeout/candidate/.next-e2e/dev/server/app/page.js",
    "tmp/closeout/playwright-transform-cache/example.js",
    "tmp/closeout/candidate/src/app/page.tsx",
  ])("ignores the root temporary workspace: %s", async (path) => {
    await expect(eslint.isPathIgnored(path)).resolves.toBe(true);
  });

  it.each([
    "src/app/page.tsx",
    "src/app/api/chat/route.ts",
    "scripts/security/check-pnpm-audit.ts",
    "tests/security-config.test.ts",
    "eslint.config.mjs",
    "src/tmp/example.ts",
  ])("continues linting maintained source: %s", async (path) => {
    await expect(eslint.isPathIgnored(path)).resolves.toBe(false);
  });
});
