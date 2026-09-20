import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([
    ".next/**",
    ".next-e2e/**",
    ".claude/worktrees/**",
    "coverage/**",
    "next-env.d.ts",
    "out/**",
    "playwright-report/**",
    "public/maplibre/**",
    "scripts/deploy/verify-release-authorization.bundle.mjs",
    "test-results/**",
    "tests/fixtures/**/.next/**",
  ]),
]);
