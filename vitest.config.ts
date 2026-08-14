import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./tests/helpers/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    coverage: {
      exclude: [
        "src/server/db/schema.ts",
        "src/server/db/seed/**",
        "src/**/*.d.ts",
      ],
      include: [
        "src/domain/**/*.ts",
        "src/lib/**/*.ts",
        "src/server/**/*.ts",
      ],
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      thresholds: {
        branches: 69,
        functions: 79,
        lines: 78,
        statements: 79,
        "src/domain/**/*.ts": {
          branches: 72,
          functions: 98,
          lines: 85,
          statements: 85,
        },
        "src/server/auth/**/*.ts": {
          branches: 90,
          functions: 100,
          lines: 95,
          statements: 95,
        },
        "src/server/http/**/*.ts": {
          branches: 85,
          functions: 88,
          lines: 90,
          statements: 90,
        },
        "src/server/health/**/*.ts": {
          branches: 70,
          functions: 100,
          lines: 90,
          statements: 90,
        },
      },
    },
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Several suites boot isolated PGlite/WASM databases. Keeping the file
    // worker pool bounded avoids CPU starvation and hook timeouts on CI/VPS
    // runners without serializing the rest of the suite.
    maxWorkers: Math.max(1, Math.min(4, availableParallelism() - 1)),
  },
});
