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
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Several suites boot isolated PGlite/WASM databases. Keeping the file
    // worker pool bounded avoids CPU starvation and hook timeouts on CI/VPS
    // runners without serializing the rest of the suite.
    maxWorkers: Math.max(1, Math.min(4, availableParallelism() - 1)),
  },
});
